// What drafted leagues look like beside quick-play leagues, for tuning data/franchise and for the A5,
// A6a, A10, A11, B13, B14, B16, B17 and B18 checks (docs/specs/m4-franchise-core.md). Simulated leagues only.
// Everything is measured the same way on both, from card ratings (no home field).
//
// Deployed: a position's on-field players are its first n in depth order, so the mean over run and
// pass snaps of the on-field mean is a weighted mean over depth slots. `deploymentWeights` counts
// those weights from quick-play games. K and P are slot 1.

import { BASE_RATINGS, PLAYER_SCHEMA_VERSION, POSITION_SKILLS, POSITIONS } from "../../packages/shared/src/engine";
import type { Position, StandoutKindId, TeamPool } from "../../packages/shared/src/engine";
import type { FranchiseData, FranchiseState, PlayerView, PoolPlayer, TeamId } from "../../packages/shared/src/franchise";
import type { GameData } from "../../packages/shared/src/game";
import type { OnField, OnFieldSide } from "../../packages/shared/src/play";
import { createEngine } from "../../packages/sim/src/engine/resolve";
import { createFranchise, depthChart, overall, overalls, playerIndex, rosterLimits, runDraft, setAutoDraft } from "../../packages/sim/src/franchise/index";
import { boxScore } from "../../packages/sim/src/loop/box";
import { averageCoachFor, generateLeague, leagueFromSeed, setupGame, teamLabel } from "../../packages/sim/src/loop/league";
import type { LeagueTeam } from "../../packages/sim/src/loop/league";
import { playGame, prepareGame } from "../../packages/sim/src/loop/play";
import type { GameKit } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import * as tol from "../../packages/sim/test/franchise/tolerances";

/** The depth slot weights: 500 quick-play games of league DEPLOYMENT_LEAGUE, seeds 1 to 500. */
const DEPLOYMENT_LEAGUE = 2026;
const DEPLOYMENT_GAMES = 500;
const SNAP_KINDS: ReadonlySet<string> = new Set(["run", "pass", "sack", "scramble"]);

export type DeploymentWeights = Readonly<Record<Position, readonly number[]>>;

export function deploymentWeights(game: GameData, games = DEPLOYMENT_GAMES): DeploymentWeights {
  const sum = Object.fromEntries(POSITIONS.map((p) => [p, [] as number[]])) as Record<Position, number[]>;
  const snaps = Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>;
  const { teams } = leagueFromSeed(game, DEPLOYMENT_LEAGUE);
  const coach = averageCoachFor(game);
  const kit = prepareGame(game);
  for (let seed = 1; seed <= games; seed++) {
    const record = playGame(setupGame(teams, DEPLOYMENT_LEAGUE, seed, () => coach), kit, Rng.fromSeed(seed));
    for (const e of record.events) {
      if (e.t !== "play" || !SNAP_KINDS.has(e.play.kind)) continue;
      const field = (e.play.detail as { readonly onField: OnField }).onField;
      for (const side of [field.offense, field.defense] as readonly OnFieldSide[]) {
        for (const p of POSITIONS) {
          const n = side[p]?.length ?? 0;
          if (n === 0) continue;
          snaps[p]++;
          for (let i = 0; i < n; i++) sum[p][i] = (sum[p][i] ?? 0) + 1 / n;
        }
      }
    }
  }
  return { ...(Object.fromEntries(POSITIONS.map((p) => [p, sum[p].map((x) => x / snaps[p])])) as Record<Position, number[]>), K: [1], P: [1] };
}

// ---------------------------------------------------------------- one league

/** Sums only, so tallies from different processes add up. */
export type Sums = Record<string, number>;

export interface LeagueRow {
  readonly seed: number;
  /** SD across the teams of the mean overall of the projected starters, and the best and worst team's mean. */
  readonly sd: number;
  readonly best: number;
  readonly worst: number;
  /** Drafted only: the user's (auto-drafted) team's rank and mean, and the AI teams' mean. */
  readonly userRank: number;
  readonly userMean: number;
  readonly aiMean: number;
  /** Drafted only: the largest share of one position in any round, and the share of depth or extra picks in the early rounds. */
  readonly worstRound: number;
  readonly worstRoundAt: string;
  /** Drafted only (B17): the first round an AI team took an ordinary (under B17_STANDOUT_OVERALL) kicker or punter, the first the user's auto-pick did, and how many teams end with two kickers or two punters. */
  readonly aiKickRound: number;
  readonly userKickRound: number;
  readonly secondTeams: number;
  /** Drafted only (B17): the first round anyone took a kicker or punter, the pool's best kicker's overall and the round he went (Infinity if undrafted). */
  readonly anyKickRound: number;
  readonly bestKicker: number;
  readonly bestKickerRound: number;
  /** Drafted only (B18): how many teams end with each number of quarterbacks, index = count. */
  readonly qbTeams: readonly number[];
}

export interface Tally {
  readonly sums: Sums;
  readonly rows: LeagueRow[];
}

export function newTally(): Tally {
  return { sums: {}, rows: [] };
}

export function mergeTally(into: Tally, from: Tally): void {
  for (const [k, v] of Object.entries(from.sums)) into.sums[k] = (into.sums[k] ?? 0) + v;
  into.rows.push(...from.rows);
}

function add(s: Sums, key: string, x: number): void {
  s[key] = (s[key] ?? 0) + x;
}

type Rated = Pick<PoolPlayer, "position" | "ratings" | "skills">;
export function ratingNames(p: Position): readonly string[] {
  return [...BASE_RATINGS, ...POSITION_SKILLS[p]];
}
function value(p: Rated, r: string): number {
  return (p.ratings as Readonly<Record<string, number>>)[r] ?? (p.skills[r] as number);
}

/** Adds one team's players at one position, in the order they take the field. */
function addUnit(s: Sums, position: Position, inOrder: readonly Rated[], weights: DeploymentWeights, min: number): void {
  const w = weights[position];
  for (const r of ratingNames(position)) {
    const key = `${position}.${r}`;
    inOrder.forEach((p, i) => {
      const v = value(p, r);
      const wi = w[i] ?? 0;
      if (wi > 0) {
        add(s, `${key}.w`, wi);
        add(s, `${key}.x`, wi * v);
        add(s, `${key}.xx`, wi * v * v);
        add(s, `${key}.hi`, v >= 90 ? wi : 0);
      }
      if (i < min) {
        add(s, `${key}.un`, 1);
        add(s, `${key}.ux`, v);
      }
    });
  }
}

function spread(means: readonly number[]): { sd: number; best: number; worst: number } {
  const m = means.reduce((a, b) => a + b, 0) / means.length;
  return { sd: Math.sqrt(means.reduce((a, b) => a + (b - m) ** 2, 0) / (means.length - 1)), best: Math.max(...means), worst: Math.min(...means) };
}

export function percentile(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const at = p * (s.length - 1);
  const lo = Math.floor(at);
  return (s[lo] as number) + (at - lo) * ((s[Math.min(lo + 1, s.length - 1)] as number) - (s[lo] as number));
}

/** A drafted league, every pick by the AI policy and the user's by auto-draft. */
export function draftedLeague(data: FranchiseData, seed: number): FranchiseState {
  const made = createFranchise(data, { seed, userTeam: "T00" });
  if (!made.ok) throw new Error(JSON.stringify(made.error));
  const on = setAutoDraft(made.value, true);
  if (!on.ok) throw new Error(JSON.stringify(on.error));
  const run = runDraft(on.value, data);
  if (!run.ok) throw new Error(`seed ${seed}: ${JSON.stringify(run.error)}`);
  return run.value.state;
}

export function addDrafted(t: Tally, data: FranchiseData, state: FranchiseState, weights: DeploymentWeights): void {
  const s = t.sums;
  const limits = rosterLimits(data);
  const starters: Record<string, number[]> = {};
  const backups: Record<string, number[]> = {};
  const means: number[] = [];
  for (const team of state.teams) {
    const chart = depthChart(state, data, team.id);
    const all: number[] = [];
    for (const p of POSITIONS) {
      const { min, target } = limits[p];
      addUnit(s, p, chart[p], weights, min);
      chart[p].slice(0, min).forEach((x) => {
        all.push(x.overall);
        (starters[p] ??= []).push(x.overall);
        add(s, `${p}.ovr.n`, 1);
        add(s, `${p}.ovr.x`, x.overall);
        add(s, `${p}.ovr.xx`, x.overall ** 2);
      });
      const backup = chart[p][min];
      if (target > min) {
        // A team with no first backup is left out of the bench figures, so its share is reported beside them.
        add(s, `${p}.first.missing`, backup === undefined ? 1 : 0);
        if (backup !== undefined) {
          (backups[p] ??= []).push(backup.overall);
          add(s, `${p}.first.n`, 1);
          add(s, `${p}.first.x`, backup.overall);
        }
      }
      // A team short of the target has no player there: it counts as missing, not as zero.
      const last = chart[p][target - 1];
      if (last !== undefined) {
        add(s, `${p}.target.n`, 1);
        add(s, `${p}.target.x`, last.overall);
      } else add(s, `${p}.target.missing`, 1);
      add(s, `${p}.count.n`, 1);
      add(s, `${p}.count.x`, chart[p].length);
      add(s, `${p}.count.min`, chart[p].length < target ? 1 : 0);
    }
    means.push(all.reduce((a, b) => a + b, 0) / all.length);
  }
  for (const p of POSITIONS) {
    if (backups[p] === undefined) continue;
    const cut = percentile(starters[p] as number[], tol.A11_OVERLAP_PERCENTILE);
    add(s, `${p}.over.n`, (backups[p] as number[]).length);
    add(s, `${p}.over.x`, (backups[p] as number[]).filter((x) => x >= cut).length);
  }
  // B13: the rounds, and what each pick was for when made.
  const index = playerIndex(state.players);
  const ovr = overalls(state.players, data.overallWeights);
  const counts = new Map<string, number>();
  const teams = state.teams.length;
  let worstRound = 0;
  let worstRoundAt = "";
  const kickRound = { ai: Number.POSITIVE_INFINITY, user: Number.POSITIVE_INFINITY, any: Number.POSITIVE_INFINITY };
  let bestKicker = { id: "", overall: -1 };
  for (const x of state.players) {
    const o = ovr.get(x.id) as number;
    if (x.position === "K" && (o > bestKicker.overall || (o === bestKicker.overall && x.id < bestKicker.id))) bestKicker = { id: x.id, overall: o };
  }
  let bestKickerRound = Number.POSITIVE_INFINITY;
  for (let r = 0; r * teams < state.draft.picks.length; r++) {
    const here: Partial<Record<Position, number>> = {};
    for (const pick of state.draft.picks.slice(r * teams, (r + 1) * teams)) {
      const p = (index.get(pick.playerId) as PoolPlayer).position;
      const teamId = state.draft.slots[pick.overallPick - 1] as TeamId;
      const key = `${teamId}.${p}`;
      if (p === "K" || p === "P") {
        kickRound.any = Math.min(kickRound.any, r + 1);
        const who = teamId === state.settings.userTeam ? "user" : "ai";
        if ((ovr.get(pick.playerId) as number) < tol.B17_STANDOUT_OVERALL) kickRound[who] = Math.min(kickRound[who], r + 1);
        if (pick.playerId === bestKicker.id) bestKickerRound = r + 1;
      }
      const held = counts.get(key) ?? 0;
      counts.set(key, held + 1);
      here[p] = (here[p] ?? 0) + 1;
      if (r < tol.B13_EARLY_ROUNDS) {
        add(s, "early.n", 1);
        if (held >= limits[p].min) add(s, "early.depth", 1);
      }
    }
    for (const p of POSITIONS) {
      const n = here[p] ?? 0;
      add(s, `round.${r + 1}.${p}`, n);
      if (n / teams > worstRound) {
        worstRound = n / teams;
        worstRoundAt = `round ${r + 1} ${p}`;
      }
    }
  }
  const user = state.teams.findIndex((x) => x.id === state.settings.userTeam);
  const userMean = means[user] as number;
  t.rows.push({ seed: state.seed, ...spread(means), userRank: 1 + means.filter((x) => x > userMean).length, userMean, aiMean: means.filter((_, i) => i !== user).reduce((a, b) => a + b, 0) / (teams - 1), worstRound, worstRoundAt, aiKickRound: kickRound.ai, userKickRound: kickRound.user, secondTeams: state.teams.filter((x) => (counts.get(`${x.id}.K`) ?? 0) > 1 || (counts.get(`${x.id}.P`) ?? 0) > 1).length, anyKickRound: kickRound.any, bestKicker: bestKicker.overall, bestKickerRound, qbTeams: qbHistogram(state.teams.map((x) => counts.get(`${x.id}.QB`) ?? 0)) });
}

function qbHistogram(counts: readonly number[]): number[] {
  const h: number[] = [];
  for (const c of counts) {
    for (let i = h.length; i <= c; i++) h[i] = 0;
    h[c] = (h[c] as number) + 1;
  }
  return h;
}

/** A quick-play league beside the drafted one: the pools as generated, in pool order. */
export function addQuickPlay(t: Tally, data: FranchiseData, seed: number, weights: DeploymentWeights): void {
  const limits = rosterLimits(data);
  const teams = generateLeague(Rng.fromSeed(seed), data.game, data.game.config.league.teams);
  const means = teams.map((team) => {
    const all: number[] = [];
    for (const p of POSITIONS) {
      const players = team.pool.players.filter((x) => x.position === p);
      addUnit(t.sums, p, players, weights, limits[p].min);
      for (const x of players) {
        const o = overall(x, data.overallWeights);
        all.push(o);
        add(t.sums, `${p}.ovr.n`, 1);
        add(t.sums, `${p}.ovr.x`, o);
        add(t.sums, `${p}.ovr.xx`, o ** 2);
      }
    }
    return all.reduce((a, b) => a + b, 0) / all.length;
  });
  t.rows.push({ seed, ...spread(means), userRank: 0, userMean: 0, aiMean: 0, worstRound: 0, worstRoundAt: "", aiKickRound: 0, userKickRound: 0, secondTeams: 0, anyKickRound: 0, bestKicker: 0, bestKickerRound: 0, qbTeams: [] });
}

export interface Moments {
  readonly mean: number;
  readonly sd: number;
  /** Share of deployed players at 90 and up. */
  readonly hi: number;
  /** The uniform mean over projected starters. */
  readonly uniform: number;
}

export function moments(t: Tally, position: Position, rating: string): Moments {
  const g = (k: string): number => t.sums[`${position}.${rating}.${k}`] ?? 0;
  const mean = g("x") / g("w");
  return { mean, sd: Math.sqrt(Math.max(0, g("xx") / g("w") - mean * mean)), hi: g("hi") / g("w"), uniform: g("ux") / g("un") };
}

export function overallMoments(t: Tally, position: Position): { mean: number; sd: number } {
  const g = (k: string): number => t.sums[`${position}.ovr.${k}`] ?? 0;
  const mean = g("x") / g("n");
  return { mean, sd: Math.sqrt(Math.max(0, g("xx") / g("n") - mean * mean)) };
}

const avg = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x: number): string => `${(100 * x).toFixed(2)}%`;

/** What drafted leagues look like against the B13, B14, B16, B17 and B18 bounds, as lines. */
export function draftReadings(drafted: Tally, quick: Tally | null, teams: number, rounds: number): string[] {
  const { rows, sums } = drafted;
  const n = rows.length;
  const round = (r: number, p: string): number => sums[`round.${r}.${p}`] ?? 0;
  let top = { share: 0, at: "" };
  for (let r = 1; r <= rounds; r++) for (const p of POSITIONS) if (round(r, p) / (teams * n) > top.share) top = { share: round(r, p) / (teams * n), at: `round ${r} ${p}` };
  const single = [...rows].sort((a, b) => b.worstRound - a.worstRound)[0] as LeagueRow;
  const b = b17(rows, teams);
  const bands = [[1, 2], [3, 8], [9, 11], [12, 15], [16, 20], [21, 25], [26, 30], [31, 35], [36, 40], [41, 45], [46, 50], [51, 53]] as const;
  const spread = (p: "K" | "P"): string => {
    const all = Array.from({ length: rounds }, (_, i) => round(i + 1, p)).reduce((a, b) => a + b, 0);
    return bands.map(([a, b]) => `${a}-${b} ${(100 * Array.from({ length: b - a + 1 }, (_, i) => round(a + i, p)).reduce((x, y) => x + y, 0) / all).toFixed(1)}`).join(", ");
  };
  const q = b18(rows, teams);
  return [
    `B13: highest mean share ${pct(top.share)} (${top.at}, at most ${pct(tol.B13_ROUND_MEAN_SHARE_MAX)}); highest single round ${pct(single.worstRound)} (seed ${single.seed}, ${single.worstRoundAt}, at most ${pct(tol.B13_SINGLE_ROUND_SHARE_MAX)}); depth or extra early ${pct((sums["early.depth"] ?? 0) / (sums["early.n"] ?? 1))} (at least ${pct(tol.B13_EARLY_DEPTH_SHARE_MIN)})`,
    ...(quick === null ? [] : [`B14: SD across teams ${avg(rows.map((x) => x.sd)).toFixed(3)} over quick play's ${avg(quick.rows.map((x) => x.sd)).toFixed(3)} = ${(avg(rows.map((x) => x.sd)) / avg(quick.rows.map((x) => x.sd))).toFixed(3)} (target ${tol.B14_RATIO_MIN} to ${tol.B14_RATIO_MAX})`]),
    `B16: auto-drafted user rank ${avg(rows.map((x) => x.userRank)).toFixed(2)}, team average ${avg(rows.map((x) => x.userMean)).toFixed(2)} against ${avg(rows.map((x) => x.aiMean)).toFixed(2)}`,
    `B17: leagues with a K or P in rounds 1 to ${tol.B17_NONE_THROUGH_ROUND}: ${b.earlyLeagues} (none allowed; earliest round ${b.earliest})`,
    `B17: leagues with no K or P under ${tol.B17_STANDOUT_OVERALL} before round ${tol.B17_FIRST_ROUND_MIN}: AI teams ${pct(b.aiShare)} (earliest round ${b.aiEarliest}), auto-pick ${pct(b.userShare)} (earliest round ${b.userEarliest}) (at least ${pct(tol.B17_LEAGUE_SHARE_MIN)})`,
    `B17: a second K or P: ${pct(b.secondTeamShare)} of teams (at most ${pct(tol.B17_SECOND_TEAM_SHARE_MAX)}), ${pct(b.secondLeagueShare)} of leagues (at most ${pct(tol.B17_SECOND_LEAGUE_SHARE_MAX)})`,
    `B17: the pool's best K is ${tol.B17_STANDOUT_OVERALL} or more in ${b.standoutLeagues} of ${n} leagues; drafted by round ${tol.B17_BEST_KICKER_ROUND_MAX} in ${pct(b.bestShare)} of them (at least ${pct(tol.B17_BEST_KICKER_SHARE_MIN)}); his round ${b.bestRounds}`,
    `B17: round of the first K or P in each league: ${b.firstRounds}`,
    `B18: teams by number of QBs ${q.histogram}; under ${tol.B18_QB_MIN}: ${q.short} teams (at most ${tol.B18_SHORT_TEAMS_MAX}); at the max of ${q.max}: ${pct(q.atMaxShare)} (at most ${pct(tol.B18_AT_MAX_SHARE_MAX)})`,
    `B17: % of kickers by round ${spread("K")}`,
    `B17: % of punters by round ${spread("P")}`,
  ];
}

const quantiles = (xs: readonly number[]): string => {
  if (xs.length === 0) return "none";
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number): number => s[Math.floor(p * (s.length - 1))] as number;
  return `min ${at(0)}, p10 ${at(0.1)}, p25 ${at(0.25)}, median ${at(0.5)}, p75 ${at(0.75)}, p90 ${at(0.9)}, max ${at(1)}`;
};

/** B17's readings over drafted rows. */
export function b17(rows: readonly LeagueRow[], teams: number): { earlyLeagues: number; earliest: number; aiShare: number; userShare: number; aiEarliest: number; userEarliest: number; secondTeamShare: number; secondLeagueShare: number; standoutLeagues: number; bestShare: number; bestRounds: string; firstRounds: string } {
  const n = rows.length;
  const standout = rows.filter((x) => x.bestKicker >= tol.B17_STANDOUT_OVERALL);
  return {
    earlyLeagues: rows.filter((x) => x.anyKickRound <= tol.B17_NONE_THROUGH_ROUND).length,
    earliest: Math.min(...rows.map((x) => x.anyKickRound)),
    aiShare: rows.filter((x) => x.aiKickRound >= tol.B17_FIRST_ROUND_MIN).length / n,
    userShare: rows.filter((x) => x.userKickRound >= tol.B17_FIRST_ROUND_MIN).length / n,
    aiEarliest: Math.min(...rows.map((x) => x.aiKickRound)),
    userEarliest: Math.min(...rows.map((x) => x.userKickRound)),
    secondTeamShare: rows.reduce((a, x) => a + x.secondTeams, 0) / (teams * n),
    secondLeagueShare: rows.filter((x) => x.secondTeams > 0).length / n,
    standoutLeagues: standout.length,
    bestShare: standout.filter((x) => x.bestKickerRound <= tol.B17_BEST_KICKER_ROUND_MAX).length / standout.length,
    bestRounds: quantiles(standout.map((x) => x.bestKickerRound)),
    firstRounds: quantiles(rows.map((x) => x.anyKickRound)),
  };
}

/** B18's readings over drafted rows. */
export function b18(rows: readonly LeagueRow[], teams: number): { histogram: string; short: number; max: number; atMaxShare: number } {
  const h: number[] = [];
  for (const x of rows) x.qbTeams.forEach((c, i) => (h[i] = (h[i] ?? 0) + c));
  const max = h.length - 1;
  return {
    histogram: h.map((c, i) => `${i}: ${c ?? 0}`).join(", "),
    short: h.slice(0, tol.B18_QB_MIN).reduce((a, c) => a + (c ?? 0), 0),
    max,
    atMaxShare: (h[max] ?? 0) / (teams * rows.length),
  };
}

// ---------------------------------------------------------------- games

/** A drafted team as the engine takes it: depth order, with the numbers the draft gave. */
export function teamPool(state: FranchiseState, data: FranchiseData, teamId: TeamId, name: string): TeamPool {
  const chart = depthChart(state, data, teamId);
  return {
    schemaVersion: PLAYER_SCHEMA_VERSION,
    name,
    players: POSITIONS.flatMap((p) => chart[p]).map(({ id, name: who, position, number, ratings, skills }: PlayerView) => ({ schemaVersion: PLAYER_SCHEMA_VERSION, id, name: who, position, number: number as number, ratings, skills })),
  };
}

export function draftedTeams(state: FranchiseState, data: FranchiseData): LeagueTeam[] {
  return state.teams.map((t) => ({ name: teamLabel(t), strength: 0, pool: teamPool(state, data, t.id, teamLabel(t)) }));
}

export interface GameSums {
  games: number;
  points: number;
  turnovers: number;
  margin: number;
  marginSquared: number;
  /** Per standout kind: class draws it applied to, and the sum of the applied factors. */
  factors: Record<string, { n: number; x: number }>;
}

export function newGameSums(): GameSums {
  return { games: 0, points: 0, turnovers: 0, margin: 0, marginSquared: 0, factors: {} };
}

/**
 * The kit, its plays decided by its own resolve. A kit has no way to see the standout factors, so a
 * second engine on the kit's data makes the same call on a copy of the generator for the observer. The
 * two must return the same play every time, or the factors are not the kit's and this throws.
 */
export function observedKit(kit: GameKit, sums: GameSums, standouts: boolean): GameKit {
  const observer = createEngine(kit.data.engine, {
    standouts,
    closeCalls: kit.closeCalls === true,
    observeStandouts: (applied) => {
      for (const a of applied) {
        const f = (sums.factors[a.kind.id] ??= { n: 0, x: 0 });
        f.n++;
        f.x += a.factor;
      }
    },
  });
  return {
    ...kit,
    resolve: (state, offense, defense, players, rng) => {
      const copy = Rng.fromState(rng.getState());
      const play = kit.resolve(state, offense, defense, players, rng);
      if (JSON.stringify(observer(state, offense, defense, players, copy)) !== JSON.stringify(play)) throw new Error("the kit's resolve is not the engine its data describes");
      return play;
    },
  };
}

/** Plays `games` games between randomly paired teams (setupGame's pairing), game seeds leagueSeed x 1000 + 1 and up. */
export function playLeague(sums: GameSums, kit: GameKit, teams: readonly LeagueTeam[], leagueSeed: number, games: number, standouts: boolean): void {
  const observed = observedKit(kit, sums, standouts);
  const coach = averageCoachFor(kit.data);
  for (let g = 1; g <= games; g++) {
    const seed = leagueSeed * 1000 + g;
    const record = playGame(setupGame(teams, leagueSeed, seed, () => coach), observed, Rng.fromSeed(seed));
    const box = boxScore(record, kit.data.engine.rules);
    const margin = box.home.points - box.away.points;
    sums.games++;
    sums.points += box.home.points + box.away.points;
    sums.turnovers += box.home.interceptions + box.home.fumblesLost + box.away.interceptions + box.away.fumblesLost;
    sums.margin += margin;
    sums.marginSquared += margin * margin;
  }
}

export function mergeGames(into: GameSums, from: GameSums): void {
  into.games += from.games;
  into.points += from.points;
  into.turnovers += from.turnovers;
  into.margin += from.margin;
  into.marginSquared += from.marginSquared;
  for (const [k, f] of Object.entries(from.factors)) {
    const at = (into.factors[k] ??= { n: 0, x: 0 });
    at.n += f.n;
    at.x += f.x;
  }
}

export function gameMeans(s: GameSums): { points: number; turnovers: number; marginSd: number; factors: Partial<Record<StandoutKindId, number>> } {
  const m = s.margin / s.games;
  return { points: s.points / (2 * s.games), turnovers: s.turnovers / (2 * s.games), marginSd: Math.sqrt(s.marginSquared / s.games - m * m), factors: Object.fromEntries(Object.entries(s.factors).map(([k, f]) => [k, f.x / f.n])) };
}
