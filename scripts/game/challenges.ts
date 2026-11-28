// M2 milestone G7 (docs/specs/m2-engine-and-game-loop.md): the in-sample run with close calls,
// challenges and reviews on vs off, on the same seeds, AI on both sides, against the
// pre-registered data/game/m2-challenge-tolerances.json. Also G3: every engine call in the on run
// is shadowed by the same call with close calls off, from a copy of the outcome stream; the
// result (minus detail.closeCall) and the stream after it must be identical.
//
//   node --import ./scripts/engine/register.mjs scripts/game/challenges.ts
//
// Writes data/game/m2-challenge-check.json and docs/CHALLENGE_REPORT.md; exits 1 when any check
// fails (the stop rule).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GameData } from "../../packages/shared/src/types";
import { createEngine, type ResolvePlay } from "../../packages/sim/src/engine/resolve";
import type { GameKit, GameRecord } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { rows, TARGETS, type Tolerances } from "./calibrate";
import { REPO, loadGameData, sha256 } from "./data";
import { runLeagues, type LeagueRun } from "./metrics";

const TOL_FILE = "data/game/m2-challenge-tolerances.json";
/** Joseph's accepted deviations (the tolerance file stays frozen). */
const APPROVALS_FILE = "data/game/m2-challenge-approvals.json";

interface ChallengeTolerances {
  readonly challenges: Readonly<Record<"perTeamGame" | "reversalShare", { readonly actual: number; readonly interval: { readonly lo: number; readonly hi: number } }>>;
  readonly againstNoChallengeRun: { readonly scrimmageClassSharePp: number; readonly pointsPerTeamGameMean: number; readonly turnoversPerTeamGame: number };
}

interface Tally {
  run: LeagueRun;
  classes: Record<string, Record<string, number>>;
  points: number[];
  turnovers: number[];
  teamGames: number;
  coach: number;
  coachReversed: number;
  booth: number;
  boothReversed: number;
  byKind: Record<string, { coach: number; booth: number; reversed: number }>;
  charged: number;
}

const RUN = new Set(["fumble", "loss", "r1_3", "r4_9", "r10_19", "r20"]);
const PASS = new Set(["sack", "scramble", "int", "inc", "fumbleCatch", "c0", "c1_9", "c10_19", "c20"]);

function tally(data: GameData, kit: GameKit): Tally {
  const lg = data.config.league;
  const t: Tally = { run: undefined as unknown as LeagueRun, classes: {}, points: [], turnovers: [], teamGames: 0, coach: 0, coachReversed: 0, booth: 0, boothReversed: 0, byKind: {}, charged: 0 };
  t.run = runLeagues(data, {
    runSeed: lg.calibrationSeed, leagues: lg.leagues, gamesPerLeague: lg.gamesPerLeague,
    onGame: (record: GameRecord, box) => {
      t.teamGames += 2;
      for (const side of ["home", "away"] as const) {
        t.points.push(box[side].points);
        t.turnovers.push(box[side].interceptions + box[side].fumblesLost);
      }
      for (const e of record.events) {
        if (e.t === "review") {
          const k = (t.byKind[e.kind] ??= { coach: 0, booth: 0, reversed: 0 });
          if (e.by === "booth") {
            t.booth++;
            k.booth++;
            if (e.verdict === "reversed") t.boothReversed++;
          } else {
            t.coach++;
            k.coach++;
            if (e.verdict === "reversed") t.coachReversed++;
          }
          if (e.verdict === "reversed") k.reversed++;
          if (e.timeoutCharged) t.charged++;
          continue;
        }
        if (e.t !== "play" || e.play.kind === "noPlay") continue;
        // The class as finally ruled (a reversal's alternative carries its own class).
        const cls = ((e.play.detail ?? {}) as Record<string, unknown>)["class"];
        if (typeof cls !== "string") continue;
        const fam = RUN.has(cls) ? "run" : PASS.has(cls) ? "pass" : null;
        if (fam !== null) (t.classes[fam] ??= {})[cls] = ((t.classes[fam] ?? {})[cls] ?? 0) + 1;
      }
    },
  }, kit);
  return t;
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const shares = (c: Record<string, number>): Record<string, number> => {
  const tot = Object.values(c).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v / tot]));
};

/** G3: the on engine, shadowed call by call by the off engine on a copy of the stream. */
function shadowed(data: GameData, g3: { calls: number; closeCalls: number; bad: string[] }): ResolvePlay {
  const on = createEngine(data.engine, { closeCalls: true });
  const off = createEngine(data.engine, { closeCalls: false });
  return (state, o, d, players, rng) => {
    const copy = Rng.fromState(rng.getState());
    const a = on(state, o, d, players, rng);
    const b = off(state, o, d, players, copy);
    g3.calls++;
    const det = { ...(a.detail ?? {}) } as Record<string, unknown>;
    if ("closeCall" in det) g3.closeCalls++;
    delete det["closeCall"];
    const same = JSON.stringify({ ...a, detail: det }) === JSON.stringify(b) && JSON.stringify(rng.getState()) === JSON.stringify(copy.getState());
    if (!same && g3.bad.length < 5) g3.bad.push(`seed ${state.seed} play ${state.playCount}`);
    else if (!same) g3.bad.push("");
    return a;
  };
}

function main(): number {
  const data = loadGameData();
  const tolBytes = readFileSync(join(REPO, TOL_FILE));
  const tol = JSON.parse(tolBytes.toString("utf8")) as ChallengeTolerances;
  const t0 = performance.now();
  const off = tally(data, { data, resolve: createEngine(data.engine, { closeCalls: false }) });
  const g3 = { calls: 0, closeCalls: 0, bad: [] as string[] };
  const on = tally(data, { data, resolve: shadowed(data, g3), closeCalls: true });
  const checks: { id: string; off: number | null; on: number; target: string; pass: boolean }[] = [];
  const perTeamGame = on.coach / on.teamGames;
  const reversalShare = on.coach === 0 ? 0 : on.coachReversed / on.coach;
  const inBand = (v: number, i: { lo: number; hi: number }): boolean => v >= i.lo - 1e-9 && v <= i.hi + 1e-9;
  checks.push({ id: "challenges.perTeamGame", off: null, on: perTeamGame, target: `${tol.challenges.perTeamGame.interval.lo} to ${tol.challenges.perTeamGame.interval.hi} (actual ${tol.challenges.perTeamGame.actual})`, pass: inBand(perTeamGame, tol.challenges.perTeamGame.interval) });
  checks.push({ id: "challenges.reversalShare", off: null, on: reversalShare, target: `${tol.challenges.reversalShare.interval.lo} to ${tol.challenges.reversalShare.interval.hi} (actual ${tol.challenges.reversalShare.actual})`, pass: inBand(reversalShare, tol.challenges.reversalShare.interval) });
  const vs = tol.againstNoChallengeRun;
  for (const fam of ["run", "pass"]) {
    const a = shares(off.classes[fam] ?? {});
    const b = shares(on.classes[fam] ?? {});
    for (const k of Object.keys(a)) {
      const diff = ((b[k] ?? 0) - (a[k] ?? 0)) * 100;
      checks.push({ id: `classShare.${fam}.${k}`, off: (a[k] ?? 0) * 100, on: (b[k] ?? 0) * 100, target: `within ${vs.scrimmageClassSharePp} pp`, pass: Math.abs(diff) <= vs.scrimmageClassSharePp + 1e-9 });
    }
  }
  const pm = [mean(off.points), mean(on.points)] as const;
  checks.push({ id: "points.perTeamGame.mean", off: pm[0], on: pm[1], target: `within ${vs.pointsPerTeamGameMean}`, pass: Math.abs(pm[1] - pm[0]) <= vs.pointsPerTeamGameMean + 1e-9 });
  const tv = [mean(off.turnovers), mean(on.turnovers)] as const;
  checks.push({ id: "turnovers.perTeamGame", off: tv[0], on: tv[1], target: `within ${vs.turnoversPerTeamGame}`, pass: Math.abs(tv[1] - tv[0]) <= vs.turnoversPerTeamGame + 1e-9 });
  const gameTol = JSON.parse(readFileSync(join(REPO, "data/game/tolerances.json"), "utf8")) as Tolerances;
  const actual = (JSON.parse(readFileSync(join(REPO, "data/game/actuals.json"), "utf8")) as Record<string, { metrics: Record<string, never> }>)[TARGETS.insample]?.metrics ?? {};
  const rOff = rows(off.run.all, off.run.byLeague, actual, gameTol, "insample");
  const rOn = rows(on.run.all, on.run.byLeague, actual, gameTol, "insample");
  const flips = rOff.filter((r, i) => r.status === "pass" && rOn[i]?.status === "fail").map((r) => r.id);
  const statusChanges = rOff.map((r, i) => ({ id: r.id, off: r.status, on: rOn[i]?.status ?? "", predictedOff: r.predicted, predictedOn: rOn[i]?.predicted ?? 0 })).filter((r) => r.off !== r.on);
  const approvals = (JSON.parse(readFileSync(join(REPO, APPROVALS_FILE), "utf8")) as { known_deviations: { metric: string; scope: string; approved_by: string }[] }).known_deviations;
  const accepted = new Set(approvals.filter((a) => a.approved_by === "Joseph" && a.scope === "insample").map((a) => a.metric));
  const status = (c: { id: string; pass: boolean }): string => (c.pass ? "pass" : accepted.has(c.id) ? "accepted" : "outside");
  const pass = checks.every((c) => status(c) !== "outside") && flips.length === 0 && g3.bad.length === 0;
  const out = {
    generated: true,
    tolerancesSha256: sha256(tolBytes),
    games: on.run.games,
    pass,
    checks: checks.map((c) => ({ ...c, status: status(c) })),
    flips,
    statusChanges,
    g3: { engineCalls: g3.calls, closeCalls: g3.closeCalls, mismatches: g3.bad.length, examples: g3.bad.filter((x) => x !== "") },
    reviews: { coach: on.coach, coachReversed: on.coachReversed, booth: on.booth, boothReversed: on.boothReversed, timeoutsCharged: on.charged, perGame: (on.coach + on.booth) / on.run.games, byKind: on.byKind },
    perf: { msPerGameOff: off.run.msPerGame, msPerGameOn: on.run.msPerGame },
  };
  writeFileSync(join(REPO, "data/game/m2-challenge-check.json"), JSON.stringify(out, null, 1) + "\n");
  writeFileSync(join(REPO, "docs/CHALLENGE_REPORT.md"), report(out));
  process.stderr.write(`[challenges] ${on.run.games} games x 2 in ${((performance.now() - t0) / 1000).toFixed(0)} s; G7 ${pass ? "pass" : "FAIL"}; G3 ${g3.bad.length === 0 ? "pass" : "FAIL"} (${g3.calls} engine calls, ${g3.closeCalls} close calls)\n`);
  for (const c of checks.filter((x) => !x.pass)) process.stderr.write(`  ${status(c)}: ${c.id} on ${c.on.toFixed(4)} (${c.target})\n`);
  for (const f of flips) process.stderr.write(`  status flip to fail: ${f}\n`);
  return pass ? 0 : 1;
}

function report(o: { games: number; tolerancesSha256: string; pass: boolean; checks: { id: string; off: number | null; on: number; target: string; pass: boolean; status: string }[]; flips: string[]; statusChanges: { id: string; off: string; on: string; predictedOff: number; predictedOn: number }[]; g3: { engineCalls: number; closeCalls: number; mismatches: number }; reviews: { coach: number; coachReversed: number; booth: number; boothReversed: number; timeoutsCharged: number; perGame: number; byKind: Record<string, { coach: number; booth: number; reversed: number }> } }): string {
  const f = (x: number | null, d = 3): string => (x === null ? "-" : x.toFixed(d));
  const L: string[] = ["# CHALLENGE_REPORT.md", ""];
  L.push("M2 milestone G, close calls, challenges and reviews (docs/specs/m2-engine-and-game-loop.md; rules cited in docs/RULES.md, rates fitted in data/game/challenges.json, AI policy designed in data/game/challenge-policy.json). Generated by `node --import ./scripts/engine/register.mjs scripts/game/challenges.ts`; numbers in data/game/m2-challenge-check.json. In-sample run (10 leagues x 1,000 games, the step 5 seeds), AI on both sides, close calls on vs off on the same seeds. No holdout run.", "");
  L.push(`Pre-registered tolerances: data/game/m2-challenge-tolerances.json, sha256 \`${o.tolerancesSha256}\` (recorded in docs/DECISIONS.md before any G run).`, "");
  L.push(`## G7 (${o.pass ? "pass" : "FAIL"})`, "", "| Check | Off | On | Target | Status |", "|---|---|---|---|---|");
  for (const c of o.checks) L.push(`| \`${c.id}\` | ${f(c.off, 4)} | ${f(c.on, 4)} | ${c.target} | ${c.status} |`);
  L.push("", "accepted: outside the pre-registered tolerance, accepted by Joseph (data/game/m2-challenge-approvals.json, with the reason).");
  L.push("", "Challenges count coach's challenges of the five modeled kinds; class shares are percent, by the class as finally ruled.", "");
  L.push(o.flips.length === 0 ? "No in-sample gated step 5 metric goes from pass to fail." : `Gated metrics that go from pass to fail: ${o.flips.join(", ")}.`, "");
  if (o.statusChanges.length > 0) {
    L.push("Status changes of step 5 metrics (any direction):", "", "| Metric | Off | On | Predicted off | Predicted on |", "|---|---|---|---|---|");
    for (const s of o.statusChanges) L.push(`| \`${s.id}\` | ${s.off} | ${s.on} | ${f(s.predictedOff)} | ${f(s.predictedOn)} |`);
    L.push("");
  }
  L.push("## G3: no extra outcome draw", "", `Every engine call of the on run (${o.g3.engineCalls}, ${o.g3.closeCalls} of them close calls) was shadowed by the same call with close calls off from a copy of the outcome stream: results apart from \`detail.closeCall\`, and the stream after the call, differed ${o.g3.mismatches} times.`, "");
  L.push("## Reviews (report)", "", `${f(o.reviews.perGame)} reviews per game: ${o.reviews.coach} coach's challenges (${o.reviews.coachReversed} reversed, ${o.reviews.timeoutsCharged} timeouts charged) and ${o.reviews.booth} Replay Official reviews (${o.reviews.boothReversed} reversed) over ${o.games} games.`, "", "| Kind | Challenges | Replay Official | Reversed |", "|---|---|---|---|");
  for (const [k, v] of Object.entries(o.reviews.byKind)) L.push(`| ${k} | ${v.coach} | ${v.booth} | ${v.reversed} |`);
  L.push("");
  return L.join("\n");
}

if (import.meta.main) process.exitCode = main();
