// Game-level metrics of simulated games, with the same ids and definitions as the real-game
// aggregates (pipeline/game/actuals.py), and the league runs the calibration and tuning share.

import { createHash } from "node:crypto";
import type { GameData } from "../../packages/shared/src/types";
import { boxScore, type BoxScore } from "../../packages/sim/src/loop/box";
import { averageCoachFor, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { playGame, prepareGame, type GameKit, type GameRecord } from "../../packages/sim/src/loop/play";
import type { GameType } from "../../packages/sim/src/game/types";
import { Rng } from "../../packages/sim/src/rng";

export const POINT_BINS: readonly [string, number, number][] = [["0-9", 0, 9], ["10-16", 10, 16], ["17-23", 17, 23], ["24-30", 24, 30], ["31-37", 31, 37], ["38+", 38, 1e9]];
export const MARGIN_BINS: readonly [string, number, number][] = [["0", 0, 0], ["1-3", 1, 3], ["4-7", 4, 7], ["8-14", 8, 14], ["15-21", 15, 21], ["22+", 22, 1e9]];
export const DRIVE_KEYS = ["touchdown", "fieldGoal", "missedFieldGoal", "punt", "turnover", "downs", "endOfHalf", "safety"] as const;

export type Kind = "mean" | "sd" | "share";

export class Acc {
  private n = 0;
  private s = 0;
  private s2 = 0;
  readonly kind: Kind;
  constructor(kind: Kind) {
    this.kind = kind;
  }
  add(x: number): void {
    this.n++;
    this.s += x;
    this.s2 += x * x;
  }
  get count(): number {
    return this.n;
  }
  value(): number {
    if (this.n === 0) return 0;
    const m = this.s / this.n;
    return this.kind === "sd" ? Math.sqrt(Math.max(0, this.s2 / this.n - m * m)) : m;
  }
}

export type Metrics = Map<string, Acc>;

function m(ms: Metrics, id: string, kind: Kind): Acc {
  let a = ms.get(id);
  if (a === undefined) {
    a = new Acc(kind);
    ms.set(id, a);
  }
  return a;
}

/** Adds one game's box score to the metric accumulators. */
export function addGame(ms: Metrics, b: BoxScore): void {
  const hs = b.home.points;
  const as = b.away.points;
  const margin = hs - as;
  for (const p of [hs, as]) {
    m(ms, "points.mean", "mean").add(p);
    m(ms, "points.sd", "sd").add(p);
    for (const [lab, lo, hi] of POINT_BINS) m(ms, `points.share.${lab}`, "share").add(p >= lo && p <= hi ? 1 : 0);
  }
  m(ms, "total.mean", "mean").add(hs + as);
  m(ms, "total.sd", "sd").add(hs + as);
  m(ms, "margin.sd", "sd").add(margin);
  for (const [lab, lo, hi] of MARGIN_BINS) m(ms, `absMargin.share.${lab}`, "share").add(Math.abs(margin) >= lo && Math.abs(margin) <= hi ? 1 : 0);
  m(ms, "homeMargin.mean", "mean").add(margin);
  m(ms, "homeWin.rate", "share").add(margin > 0 ? 1 : margin === 0 ? 0.5 : 0);
  m(ms, "overtime.rate", "share").add(b.overtime ? 1 : 0);
  m(ms, "tie.rate", "share").add(margin === 0 ? 1 : 0);
  const h = b.home;
  const a = b.away;
  const sum = (f: (t: typeof h) => number): number => f(h) + f(a);
  m(ms, "scrimmagePlays.perGame", "mean").add(sum((t) => t.scrimmagePlays));
  m(ms, "penalties.supported.perGame", "mean").add(sum((t) => t.penalties));
  m(ms, "penaltyYards.supported.perGame", "mean").add(sum((t) => t.penaltyYards));
  m(ms, "penalties.all.perGame", "mean").add(sum((t) => t.penalties));
  m(ms, "penaltyYards.all.perGame", "mean").add(sum((t) => t.penaltyYards));
  m(ms, "fourthDownGo.perGame", "mean").add(sum((t) => t.fourthDownGo));
  m(ms, "punts.perGame", "mean").add(sum((t) => t.punts));
  m(ms, "fieldGoalAttempts.perGame", "mean").add(sum((t) => t.fieldGoalAttempts));
  m(ms, "twoPointTries.perGame", "mean").add(sum((t) => t.twoPointTries));
  m(ms, "onside.perGame", "mean").add(sum((t) => t.onsideKicks));
  for (const d of b.drives) {
    m(ms, "driveStart.mean", "mean").add(d.start);
    m(ms, "driveDuration.mean", "mean").add(d.seconds);
    for (const k of DRIVE_KEYS) m(ms, `driveResult.share.${k}`, "share").add(d.result === k ? 1 : 0);
  }
  for (const [side, t] of [["home", h], ["away", a]] as const) {
    m(ms, "drives.perTeamGame", "mean").add(b.drives.filter((d) => d.team === side).length);
    m(ms, "turnovers.perTeamGame", "mean").add(t.interceptions + t.fumblesLost);
    m(ms, "interceptions.perTeamGame", "mean").add(t.interceptions);
    m(ms, "fumblesLost.perTeamGame", "mean").add(t.fumblesLost);
    m(ms, "sacks.perTeamGame", "mean").add(t.sacks);
    m(ms, "timeouts.perTeamGame", "mean").add(t.timeouts);
    m(ms, "top.sd", "sd").add(t.possessionSeconds);
  }
  if (margin !== 0) m(ms, "top.winnerMean", "mean").add(margin > 0 ? h.possessionSeconds : a.possessionSeconds);
}

const LATE_GROUPS: readonly [string, number, number][] = [["trailing4-8", -8, -4], ["trailing1-3", -3, -1], ["tied", 0, 0], ["leading1-3", 1, 3], ["leading4-8", 4, 8]];

/**
 * Step 5a (D2) diagnostics, not gated: late 4th-down field goal rate (Q4, 5:00 or less, inside the
 * opponent's 37) and field goal attempts in the final 2:00 of Q4 per game, by the offense's score.
 */
export function addDiagnostics(ms: Metrics, record: GameRecord): void {
  const fga: Record<string, number> = {};
  // Step 5b (C3): timeout rate per scrimmage dead ball by side x score3 (own view) x G5/GF, Q4.
  const called = new Set<string>();
  for (const e of record.events) {
    if (e.t === "timeout") called.add(e.team);
    if (e.t === "play" && e.before.phase === "scrimmage" && e.before.period === 4 && e.before.clock <= 300) {
      const b = e.before;
      const win = b.clock <= 120 ? "GF" : "G5";
      for (const side of ["offense", "defense"] as const) {
        const t = side === "offense" ? b.possession : b.possession === "home" ? "away" : "home";
        const d = b.score[t] - b.score[t === "home" ? "away" : "home"];
        const s3 = d < 0 ? "T" : d === 0 ? "0" : "L";
        m(ms, `diag.timeoutRate.${side}.${s3}.${win}`, "share").add(called.has(t) ? 1 : 0);
      }
    }
    if (e.t === "play") called.clear();
  }
  // Step 5b (C3, COACH_REPORT.md): timeouts per team-game in the dead ball before a Q4 scrimmage
  // snap with 5:00 or less left, by side x score3 (the calling team's view) x G5/GF. Each game
  // adds one value per team, so the mean is per team-game.
  const perTeam = { home: new Map<string, number>(), away: new Map<string, number>() };
  for (const e of record.events) {
    if (e.t !== "timeout" || e.before.phase !== "scrimmage" || e.before.period !== 4 || e.before.clock > 300) continue;
    const b = e.before;
    const d = b.score[e.team] - b.score[e.team === "home" ? "away" : "home"];
    const k = `${e.side}.${d < 0 ? "T" : d === 0 ? "0" : "L"}.${b.clock <= 120 ? "GF" : "G5"}`;
    perTeam[e.team].set(k, (perTeam[e.team].get(k) ?? 0) + 1);
  }
  for (const side of ["offense", "defense"]) {
    for (const s3 of ["T", "0", "L"]) {
      for (const win of ["G5", "GF"]) {
        const k = `${side}.${s3}.${win}`;
        for (const t of ["home", "away"] as const) m(ms, `diag.timeoutsPerTeamGame.${k}`, "mean").add(perTeam[t].get(k) ?? 0);
      }
    }
  }
  for (const e of record.events) {
    if (e.t !== "play" || e.before.phase !== "scrimmage") continue;
    const b = e.before;
    const k = e.play.kind;
    if (k === "noPlay") continue;
    const diff = b.score[b.possession] - b.score[b.possession === "home" ? "away" : "home"];
    const g = LATE_GROUPS.find(([, lo, hi]) => diff >= lo && diff <= hi)?.[0];
    if (g === undefined || b.period !== 4) continue;
    if (b.down === 4 && b.clock <= 300 && 100 - b.spot <= 37 && k !== "kneel" && k !== "spike") m(ms, `diag.late4thFieldGoal.${g}`, "share").add(k === "fieldGoal" ? 1 : 0);
    if (k === "fieldGoal" && b.clock <= 120) fga[g] = (fga[g] ?? 0) + 1;
  }
  for (const [g] of LATE_GROUPS) m(ms, `diag.final2FieldGoalAttempts.${g}`, "mean").add(fga[g] ?? 0);
}

/** sha256 of a record's JSON: the per-game digest the calibration summary and CI compare. */
export function digest(record: GameRecord): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

export interface RunGame {
  readonly league: number;
  readonly leagueSeed: number;
  readonly seed: number;
}

/** The seeds of a calibration run: each league seed, then each game seed, through Rng.fork. */
export function runSeeds(runSeed: number, leagues: number, gamesPerLeague: number): { leagueSeeds: number[]; games: (data: GameData, league: number) => number[] } {
  const run = Rng.fromSeed(runSeed);
  const leagueSeeds = Array.from({ length: leagues }, () => run.fork().nextUint32());
  return {
    leagueSeeds,
    games: (data, league) => {
      const { seeds } = leagueFromSeed(data, leagueSeeds[league] as number);
      return Array.from({ length: gamesPerLeague }, () => seeds.nextUint32());
    },
  };
}

export interface LeagueRunOptions {
  readonly runSeed: number;
  readonly leagues: number;
  readonly gamesPerLeague: number;
  readonly gameType?: GameType;
  /** Called with each record (digests, invariants); records are not kept. */
  readonly onGame?: (record: GameRecord, box: BoxScore, g: RunGame, ms: number) => void;
}

export interface LeagueRun {
  readonly all: Metrics;
  readonly byLeague: Metrics[];
  readonly leagueSeeds: number[];
  readonly games: number;
  readonly msPerGame: number;
  readonly wallSeconds: number;
}

export function runLeagues(data: GameData, opts: LeagueRunOptions, kit: GameKit = prepareGame(data)): LeagueRun {
  const t0 = performance.now();
  const all: Metrics = new Map();
  const byLeague: Metrics[] = [];
  const seeds = runSeeds(opts.runSeed, opts.leagues, opts.gamesPerLeague);
  const coach = averageCoachFor(data);
  let simMs = 0;
  let games = 0;
  for (let l = 0; l < opts.leagues; l++) {
    const leagueSeed = seeds.leagueSeeds[l] as number;
    const { teams } = leagueFromSeed(data, leagueSeed);
    const mine: Metrics = new Map();
    for (const seed of seeds.games(data, l)) {
      const g0 = performance.now();
      const record = playGame(setupGame(teams, leagueSeed, seed, () => coach, opts.gameType ?? "regularSeason"), kit, Rng.fromSeed(seed));
      const ms = performance.now() - g0;
      simMs += ms;
      games++;
      const box = boxScore(record, data.engine.rules);
      addGame(all, box);
      addGame(mine, box);
      addDiagnostics(all, record);
      opts.onGame?.(record, box, { league: l, leagueSeed, seed }, ms);
    }
    byLeague.push(mine);
  }
  return { all, byLeague, leagueSeeds: seeds.leagueSeeds, games, msPerGame: simMs / Math.max(1, games), wallSeconds: (performance.now() - t0) / 1000 };
}
