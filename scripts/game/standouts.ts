// M2 milestone F (docs/specs/m2-engine-and-game-loop.md): standout plays.
//
//   node --import ./scripts/engine/register.mjs scripts/game/standouts.ts --center
//     Runs the in-sample leagues with standouts on and every centering at 1, and prints the mean
//     raw factor per kind over the class draws it applied to; the centering is its inverse
//     (written to data/engine/standouts.json with --write).
//   node --import ./scripts/engine/register.mjs scripts/game/standouts.ts --check
//     F1: the in-sample run, standouts on vs off on the same seeds, against the pre-registered
//     tolerances (data/game/m2-standout-tolerances.json); F2: each kind's visible effect at a fixed
//     seed; F6: standouts per game and per kind. Writes data/game/m2-standout-check.json and
//     docs/STANDOUT_REPORT.md; exits 1 when any check fails (the stop rule).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EngineData, GameData, Player, StandoutKindId, TeamPool } from "../../packages/shared/src/types";
import type { GameState } from "../../packages/sim/src/game/types";
import { createEngine } from "../../packages/sim/src/engine/resolve";
import { standoutsFor, type Applied } from "../../packages/sim/src/engine/standouts";
import { averageCoachFor, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { gamePlayers } from "../../packages/sim/src/loop/play";
import { generateTeam } from "../../packages/sim/src/engine/players";
import { kickStands, playStands } from "../../packages/sim/src/loop/box";
import type { GameEvent, GameKit, GameRecord } from "../../packages/sim/src/loop/play";
import { newGame } from "../../packages/sim/src/game/machine";
import { Rng } from "../../packages/sim/src/rng";
import { rows, TARGETS, type Tolerances } from "./calibrate";
import { REPO, loadGameData, sha256 } from "./data";
import { runLeagues, type LeagueRun } from "./metrics";

const KINDS: readonly StandoutKindId[] = ["breakawayRun", "bigCatch", "sack", "pick", "longKick"];
const TOL_FILE = "data/game/m2-standout-tolerances.json";

interface StandoutTolerances {
  readonly threshold: { readonly cardRating: number };
  readonly kinds: readonly { readonly id: StandoutKindId }[];
  readonly f1: { readonly scrimmageClassSharePp: number; readonly pointsPerTeamGameMean: number; readonly pointsPerTeamGameSd: number; readonly turnoversPerTeamGame: number; readonly fieldGoalMakeRate50PlusPp: number };
  readonly f2: { readonly minRelativeEffect: Readonly<Record<StandoutKindId, number>> };
}

function kitOf(data: GameData, standouts: boolean, observe?: (a: readonly Applied[]) => void): GameKit & { standouts: boolean } {
  return { data, standouts, resolve: createEngine(data.engine, { standouts, ...(observe === undefined ? {} : { observeStandouts: observe }) }) };
}

function withCentering(data: GameData, centering: Readonly<Record<StandoutKindId, number>>): GameData {
  return { ...data, engine: { ...data.engine, standouts: { ...data.engine.standouts, centering } } };
}

type Plays = Extract<GameEvent, { t: "play" }>;

/** Everything F1 and F6 read from one in-sample run. */
interface Tally {
  run: LeagueRun;
  classes: Record<string, Record<string, number>>;
  points: number[];
  turnovers: number[];
  fg50: { att: number; good: number };
  standouts: number[];
  byKind: Record<string, number>;
  /** A standout entry whose play did not stand (a flag took it away). */
  wiped: number;
  /**
   * F3 both ways (code review): recomputed from the record alone (on-field players, class drawn,
   * the player credited), a candidate exactly where all three hold, and a final standout exactly
   * where a candidate's play stands.
   */
  f3Bad: string[];
  /** Plays whose recomputed conditions all hold (should equal the candidates). */
  f3Expected: number;
}

const RUN_LEAVES = new Set(["insideRun", "outsideRun", "qbSneak"]);
const PASS_LEAVES = new Set(["shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"]);

/** Whether the engine should have made this play a standout candidate, from the record alone (F3). */
function expectCandidate(data: GameData, ev: Plays, players: ReturnType<typeof gamePlayers>, cards: Map<string, Player>): { kind: string; player: string } | null {
  const d = (ev.play.detail ?? {}) as Record<string, unknown>;
  const trace = (d["trace"] ?? []) as Record<string, unknown>[];
  const leaf = String(trace.find((x) => x["factor"] === "call")?.["leaf"] ?? "");
  const family = ev.play.kind === "fieldGoal" ? "fieldGoal" : RUN_LEAVES.has(leaf) ? "run" : PASS_LEAVES.has(leaf) ? "pass" : null;
  const cls = d["class"];
  if (family === null || typeof cls !== "string" || ev.play.kind === "noPlay") return null;
  const of = d["onField"] as { offense: Record<string, string[]>; defense: Record<string, string[]> } | undefined;
  if (of === undefined) return null;
  const byId = new Map([...players.home.players, ...players.away.players].map((p) => [p.id, p]));
  const unit = (side: Record<string, string[]>): Record<string, Player[]> => Object.fromEntries(Object.entries(side).map(([pos, ids]) => [pos, ids.map((id) => byId.get(id) as Player)]));
  const classes = family === "fieldGoal" ? ["good", "miss", "blocked"] : (data.engine.scrimmage.families[family]?.classes ?? []);
  const distance = typeof d["distance"] === "number" ? d["distance"] : null;
  const applied = standoutsFor(data.engine.standouts, data.engine.participants, family, leaf, distance, unit(of.offense), unit(of.defense), (p) => cards.get(p.id) ?? p).filter((a) => classes.includes(a.kind.class));
  const hit = applied.find((a) => a.kind.class === cls && a.elites.length > 0);
  if (hit === undefined || !(hit.factor > 1)) return null;
  const credited = ((d["participants"] ?? {}) as Record<string, string>)[hit.kind.role];
  return hit.elites.some((e) => e.player.id === credited) ? { kind: hit.kind.id, player: credited as string } : null;
}

function tally(data: GameData, kit: GameKit & { standouts: boolean }, runSeed?: number, leagues?: number): Tally {
  const lg = data.config.league;
  const rules = data.engine.rules;
  const t: Tally = { run: undefined as unknown as LeagueRun, classes: {}, points: [], turnovers: [], fg50: { att: 0, good: 0 }, standouts: [], byKind: {}, wiped: 0, f3Bad: [], f3Expected: 0 };
  const coach = averageCoachFor(data);
  const leagueCache = new Map<number, ReturnType<typeof leagueFromSeed>["teams"]>();
  t.run = runLeagues(data, {
    runSeed: runSeed ?? lg.calibrationSeed, leagues: leagues ?? lg.leagues, gamesPerLeague: lg.gamesPerLeague,
    onGame: (record: GameRecord, box, g) => {
      let teams = leagueCache.get(g.leagueSeed);
      if (teams === undefined) {
        teams = leagueFromSeed(data, g.leagueSeed).teams;
        leagueCache.set(g.leagueSeed, teams);
      }
      const setup = setupGame(teams, g.leagueSeed, g.seed, () => coach);
      const players = gamePlayers(setup, data);
      const cards = new Map([...setup.home.pool.players, ...setup.away.pool.players].map((p) => [p.id, p]));
      for (const side of ["home", "away"] as const) {
        t.points.push(box[side].points);
        t.turnovers.push(box[side].interceptions + box[side].fumblesLost);
      }
      let n = 0;
      for (const e of record.events) {
        if (e.t !== "play") continue;
        const ev = e as Plays;
        const d = (ev.play.detail ?? {}) as Record<string, unknown>;
        const sampled = d["sampledClass"];
        const fam = typeof sampled === "string" ? (["fumble", "loss", "r1_3", "r4_9", "r10_19", "r20"].includes(sampled) ? "run" : "pass") : null;
        if (fam !== null && typeof sampled === "string") (t.classes[fam] ??= {})[sampled] = ((t.classes[fam] ?? {})[sampled] ?? 0) + 1;
        if (ev.play.kind === "fieldGoal" && typeof d["distance"] === "number" && d["distance"] >= 50 && kickStands(ev, rules)) {
          t.fg50.att++;
          if (ev.play.good) t.fg50.good++;
        }
        const trace = (d["trace"] ?? []) as Record<string, unknown>[];
        const cand = trace.find((x) => x["factor"] === "standoutCandidate");
        const want = kit.standouts ? expectCandidate(data, ev, players, cards) : null;
        if (want !== null) t.f3Expected++;
        const got = cand === undefined ? null : { kind: String(cand["kind"]), player: String(cand["player"]) };
        if (JSON.stringify(want) !== JSON.stringify(got)) t.f3Bad.push(`seed ${record.seed} play ${ev.before.period}/${ev.before.clock}: expected ${JSON.stringify(want)}, tagged ${JSON.stringify(got)}`);
        const stands = ev.play.kind === "fieldGoal" || ev.play.kind === "punt" ? kickStands(ev, rules) : playStands(ev, rules);
        // The loop's final call: a standout exactly when a candidate's play stands.
        if ((cand !== undefined && stands) !== (ev.standout !== undefined)) t.f3Bad.push(`seed ${record.seed}: final standout ${ev.standout !== undefined} for a candidate ${cand !== undefined} that stands ${stands}`);
        if (cand === undefined) continue;
        if (!stands) {
          t.wiped++;
          continue;
        }
        n++;
        t.byKind[String(cand["kind"])] = (t.byKind[String(cand["kind"])] ?? 0) + 1;
      }
      t.standouts.push(n);
    },
  }, kit);
  return t;
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: readonly number[]): number => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const shares = (c: Record<string, number>): Record<string, number> => {
  const tot = Object.values(c).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v / tot]));
};

type Check = { id: string; off: number; on: number; diff: number; tolerance: number; pass: boolean };

function f1Checks(off: Tally, on: Tally, tol: StandoutTolerances): Check[] {
  const checks: Check[] = [];
  const add = (id: string, a: number, b: number, tolerance: number, scale = 1): void => {
    const diff = (b - a) * scale;
    checks.push({ id, off: a * scale, on: b * scale, diff, tolerance, pass: Math.abs(diff) <= tolerance + 1e-9 });
  };
  for (const fam of ["run", "pass"]) {
    const a = shares(off.classes[fam] ?? {});
    const b = shares(on.classes[fam] ?? {});
    for (const k of Object.keys(a)) add(`classShare.${fam}.${k}`, a[k] ?? 0, b[k] ?? 0, tol.f1.scrimmageClassSharePp, 100);
  }
  add("points.perTeamGame.mean", mean(off.points), mean(on.points), tol.f1.pointsPerTeamGameMean);
  add("points.perTeamGame.sd", sd(off.points), sd(on.points), tol.f1.pointsPerTeamGameSd);
  add("turnovers.perTeamGame", mean(off.turnovers), mean(on.turnovers), tol.f1.turnoversPerTeamGame);
  add("fieldGoal.makeRate.50plus", off.fg50.good / off.fg50.att, on.fg50.good / on.fg50.att, tol.f1.fieldGoalMakeRate50PlusPp, 100);
  return checks;
}

function center(data: GameData): Record<StandoutKindId, number> {
  const ones = Object.fromEntries(KINDS.map((k) => [k, 1])) as Record<StandoutKindId, number>;
  const sum: Record<string, number> = {};
  const n: Record<string, number> = {};
  const d1 = withCentering(data, ones);
  const lg = data.config.league;
  runLeagues(d1, { runSeed: lg.calibrationSeed, leagues: lg.leagues, gamesPerLeague: lg.gamesPerLeague }, kitOf(d1, true, (applied) => {
    for (const a of applied) {
      sum[a.kind.id] = (sum[a.kind.id] ?? 0) + a.factor;
      n[a.kind.id] = (n[a.kind.id] ?? 0) + 1;
    }
  }));
  const out = Object.fromEntries(KINDS.map((k) => [k, Math.round((n[k] ?? 0) / (sum[k] ?? 1) * 1e6) / 1e6])) as Record<StandoutKindId, number>;
  for (const k of KINDS) process.stderr.write(`[standouts] ${k}: ${n[k] ?? 0} class draws, mean raw factor ${((sum[k] ?? 0) / (n[k] ?? 1)).toFixed(6)}, centering ${out[k]}\n`);
  return out;
}

// ---------------------------------------------------------------- F2

/** Every rating at `v`; one player per slot any unit needs, as in the step 4 D6 fixtures. */
function flat(data: EngineData, name: string, v: number): TeamPool {
  const base = generateTeam(Rng.fromSeed(1), data, name);
  return { ...base, players: base.players.map((p) => ({ ...p, ratings: Object.fromEntries(Object.keys(p.ratings).map((k) => [k, v])) as Player["ratings"], skills: Object.fromEntries(Object.keys(p.skills).map((k) => [k, v])) })) };
}

function withPlayer(pool: TeamPool, id: string, ratings: readonly string[], v: number): TeamPool {
  return {
    ...pool,
    players: pool.players.map((p) =>
      p.id !== id ? p : { ...p, ratings: Object.fromEntries(Object.entries(p.ratings).map(([k, x]) => [k, ratings.includes(k) ? v : x])) as Player["ratings"], skills: Object.fromEntries(Object.entries(p.skills).map(([k, x]) => [k, ratings.includes(k) ? v : x])) },
    ),
  };
}

interface F2Case { readonly kind: StandoutKindId; readonly side: "offense" | "defense"; readonly slot: string; readonly call: { call: string; formation?: string }; readonly defense: string | null; readonly spot: number; readonly cls: string }

function f2(data: GameData, tol: StandoutTolerances): { kind: string; average: number; elite: number; relative: number; standoutOnly: number; min: number; pass: boolean }[] {
  const e = data.engine;
  const rules = e.rules;
  const cases: F2Case[] = [
    { kind: "breakawayRun", side: "offense", slot: "RB1", call: { call: "outsideRun", formation: "shotgun" }, defense: "nickelCover3", spot: 30, cls: "r20" },
    { kind: "bigCatch", side: "offense", slot: "WR1", call: { call: "deepPass", formation: "shotgun" }, defense: "nickelCover3", spot: 30, cls: "c20" },
    { kind: "sack", side: "defense", slot: "DL1", call: { call: "intermediatePass", formation: "shotgun" }, defense: "nickelCover3", spot: 30, cls: "sack" },
    { kind: "pick", side: "defense", slot: "CB1", call: { call: "deepPass", formation: "shotgun" }, defense: "nickelCover3", spot: 30, cls: "int" },
    { kind: "longKick", side: "offense", slot: "K1", call: { call: "fieldGoal" }, defense: null, spot: 62, cls: "good" },
  ];
  const N = 40_000;
  const s0 = newGame(rules, { gameType: "regularSeason", seed: 1, rulesHash: "f2" }, Rng.fromSeed(1));
  const state: GameState = { ...s0, phase: "scrimmage", possession: "home", down: 1, distance: 10, period: 1, clock: 600, playClock: 40, clockRunning: true };
  return cases.map((c) => {
    const kind = e.standouts.kinds.find((k) => k.id === c.kind);
    if (kind === undefined) throw new Error(`no kind ${c.kind}`);
    const rate = (v: number, on: boolean): number => {
      const home = flat(e, "H", 65);
      const away = flat(e, "A", 65);
      const pick = (pool: TeamPool) => withPlayer(pool, `${pool.name}-${c.slot}`, kind.ratings, v);
      const players = c.side === "offense" ? { home: pick(home), away } : { home, away: pick(away) };
      const st: GameState = c.kind === "longKick" ? { ...state, down: 4, spot: c.spot } : { ...state, spot: c.spot };
      const resolve = createEngine(e, { standouts: on });
      const rng = Rng.fromSeed(20261114);
      let hit = 0;
      for (let i = 0; i < N; i++) {
        const p = resolve(st, c.call, c.defense, players, rng);
        if ((p.detail as Record<string, unknown>)["class"] === c.cls) hit++;
      }
      return hit / N;
    };
    const avg = rate(65, true);
    const elite = rate(tol.threshold.cardRating, true);
    const eliteOff = rate(tol.threshold.cardRating, false);
    const min = tol.f2.minRelativeEffect[c.kind];
    const relative = elite / avg - 1;
    return { kind: c.kind, average: avg, elite, relative, standoutOnly: elite / eliteOff - 1, min, pass: relative >= min };
  });
}

// ---------------------------------------------------------------- F1 and F6

function main(): number {
  const args = process.argv.slice(2);
  const data = loadGameData();
  if (args.includes("--center")) {
    const c = center(data);
    if (args.includes("--write")) {
      const f = join(REPO, "data/engine/standouts.json");
      const j = JSON.parse(readFileSync(f, "utf8"));
      j.centering = c;
      writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
    }
    process.stdout.write(JSON.stringify(c) + "\n");
    return 0;
  }
  const tolBytes = readFileSync(join(REPO, TOL_FILE));
  const tol = JSON.parse(tolBytes.toString("utf8")) as StandoutTolerances;
  const cfg = data.engine.standouts;
  const pre = { threshold: tol.threshold.cardRating, kinds: tol.kinds.map((k) => k.id) };
  if (pre.threshold !== cfg.threshold || JSON.stringify(pre.kinds) !== JSON.stringify(cfg.kinds.map((k) => k.id))) throw new Error("standouts.json does not match the pre-registered threshold and kinds");
  const t0 = performance.now();
  const off = tally(data, kitOf(data, false));
  const on = tally(data, kitOf(data, true));
  const checks = f1Checks(off, on, tol);
  // Not gated (code review): the same F1 on three leagues outside the ten calibration leagues.
  const OUTSIDE_SEED = data.config.league.calibrationSeed + 7_000_000;
  const offOut = tally(data, kitOf(data, false), OUTSIDE_SEED, 3);
  const onOut = tally(data, kitOf(data, true), OUTSIDE_SEED, 3);
  const calibrationLeagues = new Set(off.run.leagueSeeds);
  if (onOut.run.leagueSeeds.some((s) => calibrationLeagues.has(s))) throw new Error("an outside league is a calibration league");
  const outside = { runSeed: OUTSIDE_SEED, leagueSeeds: onOut.run.leagueSeeds, games: onOut.run.games, checks: f1Checks(offOut, onOut, tol), f3Bad: onOut.f3Bad.length };
  // No in-sample gated step 5 metric from pass to fail.
  const gameTol = JSON.parse(readFileSync(join(REPO, "data/game/tolerances.json"), "utf8")) as Tolerances;
  const actual = (JSON.parse(readFileSync(join(REPO, "data/game/actuals.json"), "utf8")) as Record<string, { metrics: Record<string, never> }>)[TARGETS.insample]?.metrics ?? {};
  const rowsOff = rows(off.run.all, off.run.byLeague, actual, gameTol, "insample");
  const rowsOn = rows(on.run.all, on.run.byLeague, actual, gameTol, "insample");
  const flips = rowsOff.filter((r, i) => r.status === "pass" && rowsOn[i]?.status === "fail").map((r) => r.id);
  const statusChanges = rowsOff.map((r, i) => ({ id: r.id, off: r.status, on: rowsOn[i]?.status ?? "", predictedOff: r.predicted, predictedOn: rowsOn[i]?.predicted ?? 0 })).filter((r) => r.off !== r.on);
  const f2rows = f2(data, tol);
  const hist: Record<string, number> = {};
  for (const n of on.standouts) hist[String(Math.min(n, 6))] = (hist[String(Math.min(n, 6))] ?? 0) + 1;
  const f1Pass = checks.every((c) => c.pass) && flips.length === 0;
  const out = {
    generated: true,
    tolerancesSha256: sha256(tolBytes),
    standoutsSha256: data.dataHashes["data/engine/standouts.json"],
    games: on.run.games,
    f1: { pass: f1Pass, checks, flips, statusChanges },
    f2: { pass: f2rows.every((r) => r.pass), rows: f2rows },
    f3: { bad: on.f3Bad.length + off.f3Bad.length, examples: [...on.f3Bad, ...off.f3Bad].slice(0, 5), expected: on.f3Expected, standoutsOffEntries: off.standouts.reduce((a, b) => a + b, 0) + off.wiped },
    outside,
    f6: { perGame: { mean: mean(on.standouts), sd: sd(on.standouts) }, distribution: hist, byKindPerGame: Object.fromEntries(KINDS.map((k) => [k, (on.byKind[k] ?? 0) / on.run.games])), wipedByFlags: on.wiped },
    perf: { msPerGameOff: off.run.msPerGame, msPerGameOn: on.run.msPerGame },
  };
  writeFileSync(join(REPO, "data/game/m2-standout-check.json"), JSON.stringify(out, null, 1) + "\n");
  writeFileSync(join(REPO, "docs/STANDOUT_REPORT.md"), report(out, cfg.centering));
  process.stderr.write(`[standouts] ${on.run.games} games x 2 in ${((performance.now() - t0) / 1000).toFixed(0)} s; F1 ${f1Pass ? "pass" : "FAIL"}, F2 ${out.f2.pass ? "pass" : "FAIL"}, F3 ${out.f3.bad === 0 && out.f3.standoutsOffEntries === 0 ? "pass" : "FAIL"}\n`);
  for (const c of outside.checks.filter((x) => !x.pass)) process.stderr.write(`  outside leagues (not gated): ${c.id} diff ${c.diff.toFixed(3)} > ${c.tolerance}\n`);
  for (const c of checks.filter((x) => !x.pass)) process.stderr.write(`  F1 outside: ${c.id} off ${c.off.toFixed(3)} on ${c.on.toFixed(3)} (diff ${c.diff.toFixed(3)}, tolerance ${c.tolerance})\n`);
  for (const f of flips) process.stderr.write(`  F1 status flip to fail: ${f}\n`);
  for (const r of f2rows.filter((x) => !x.pass)) process.stderr.write(`  F2 below minimum: ${r.kind} ${r.relative.toFixed(3)} < ${r.min}\n`);
  return f1Pass && out.f2.pass && out.f3.bad === 0 && out.f3.standoutsOffEntries === 0 ? 0 : 1;
}

function report(o: {
  games: number; tolerancesSha256: string; standoutsSha256: string | undefined;
  f1: { pass: boolean; checks: { id: string; off: number; on: number; diff: number; tolerance: number; pass: boolean }[]; flips: string[]; statusChanges: { id: string; off: string; on: string; predictedOff: number; predictedOn: number }[] };
  f2: { pass: boolean; rows: { kind: string; average: number; elite: number; relative: number; standoutOnly: number; min: number; pass: boolean }[] };
  f3: { bad: number; expected: number; standoutsOffEntries: number };
  outside: { runSeed: number; leagueSeeds: number[]; games: number; checks: Check[]; f3Bad: number };
  f6: { perGame: { mean: number; sd: number }; distribution: Record<string, number>; byKindPerGame: Record<string, number>; wipedByFlags: number };
}, centering: Readonly<Record<string, number>>): string {
  const f = (x: number, d = 3): string => x.toFixed(d);
  const L: string[] = [];
  L.push("# STANDOUT_REPORT.md", "");
  L.push("M2 milestone F, standout plays (docs/specs/m2-engine-and-game-loop.md; designed, centered; docs/MODEL.md, Standout plays). Generated by `node --import ./scripts/engine/register.mjs scripts/game/standouts.ts --check`; numbers in data/game/m2-standout-check.json. In-sample run only (10 leagues x 1,000 games, the step 5 seeds), standouts on vs off on the same seeds. No holdout run: the layer is designed and centered.", "");
  L.push(`Pre-registered tolerances: data/game/m2-standout-tolerances.json, sha256 \`${o.tolerancesSha256}\` (recorded in docs/DECISIONS.md before any run). standouts.json sha256 \`${o.standoutsSha256 ?? "?"}\`. Centering: ${Object.entries(centering).map(([k, v]) => `${k} ${v}`).join(", ")}.`, "");
  L.push(`## F1: calibration, on vs off (${o.f1.pass ? "pass" : "FAIL"})`, "");
  L.push("| Check | Off | On | Difference | Tolerance | Status |", "|---|---|---|---|---|---|");
  for (const c of o.f1.checks) L.push(`| \`${c.id}\` | ${f(c.off)} | ${f(c.on)} | ${f(c.diff)} | ${c.tolerance} | ${c.pass ? "pass" : "outside"} |`);
  L.push("", "Class shares and the 50+ make rate are in percent (pp tolerances). Class shares count every run and pass snap that reached a class draw, by the class drawn (`detail.sampledClass`).", "");
  L.push(o.f1.flips.length === 0 ? "No in-sample gated step 5 metric goes from pass to fail." : `Gated metrics that go from pass to fail: ${o.f1.flips.join(", ")}.`, "");
  if (o.f1.statusChanges.length > 0) {
    L.push("Status changes of step 5 metrics (any direction):", "", "| Metric | Off | On | Predicted off | Predicted on |", "|---|---|---|---|---|");
    for (const s of o.f1.statusChanges) L.push(`| \`${s.id}\` | ${s.off} | ${s.on} | ${f(s.predictedOff)} | ${f(s.predictedOn)} |`);
    L.push("");
  }
  L.push(`## F2: visible effect (${o.f2.pass ? "pass" : "FAIL"})`, "");
  L.push("Fixed seed, 40,000 plays per arm, league-average (65) teams, one slot at the threshold (90) in the kind's ratings vs 65. Relative effect = elite rate / average rate - 1, standouts on in both arms (it includes the step 4 rating effects that rating also has). Standout only = elite with standouts on vs the same elite with them off.", "");
  L.push("| Kind | Average | Elite | Relative | Standout only | Minimum | Status |", "|---|---|---|---|---|---|---|");
  for (const r of o.f2.rows) L.push(`| ${r.kind} | ${f(r.average, 4)} | ${f(r.elite, 4)} | ${f(r.relative)} | ${f(r.standoutOnly)} | ${r.min} | ${r.pass ? "pass" : "below"} |`);
  L.push("", "## F1 outside the calibration leagues (report, not gated)", "", `Three leagues from run seed ${o.outside.runSeed} (league seeds ${o.outside.leagueSeeds.join(", ")}, none a calibration league), ${o.outside.games} games, standouts on vs off on the same seeds. The centering was set on the calibration leagues.`, "");
  L.push("| Check | Off | On | Difference | Tolerance | Within |", "|---|---|---|---|---|---|");
  for (const c of o.outside.checks) L.push(`| \`${c.id}\` | ${f(c.off)} | ${f(c.on)} | ${f(c.diff)} | ${c.tolerance} | ${c.pass ? "yes" : "no"} |`);
  L.push("", `## F3: tagging, both ways`, "", `From the record alone (the on-field players, the class drawn, the player credited, the factor recomputed), ${o.f3.expected} plays met all three conditions (factor applied and above 1, its class drawn, the elite player credited). Plays where the engine's candidate and the recomputation disagree, either way, or where the loop's final standout is not exactly "a candidate whose play stands": ${o.f3.bad} (outside leagues: ${o.outside.f3Bad}). Candidates with standouts off: ${o.f3.standoutsOffEntries}.`, "");
  L.push("## F6: standouts per game (report, not gated)", "", `The loop's final standouts (GameEvent \`standout\`: a candidate whose play stands after penalty enforcement): ${f(o.f6.perGame.mean)} per game (SD ${f(o.f6.perGame.sd)}); ${o.f6.wipedByFlags} more were taken away by accepted flags over ${o.games} games.`, "");
  L.push("| Standouts in a game | Games |", "|---|---|");
  for (const [k, v] of Object.entries(o.f6.distribution).sort((a, b) => Number(a[0]) - Number(b[0]))) L.push(`| ${k === "6" ? "6 or more" : k} | ${v} |`);
  L.push("", "| Kind | Per game |", "|---|---|");
  for (const [k, v] of Object.entries(o.f6.byKindPerGame)) L.push(`| ${k} | ${f(v)} |`);
  L.push("", "Joseph judges the rate in the playtest; no target is set (spec F6).", "");
  return L.join("\n");
}

if (import.meta.main) process.exitCode = main();
