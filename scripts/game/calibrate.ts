// The M1 gate (step 5, milestones F and G): 10 generated leagues x 1,000 games against real
// regular-season game aggregates, with the pre-registered tolerances in data/game/tolerances.json.
//
//   node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --target insample
//   node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --target holdout
//   node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --report-only
//
// insample compares with 2016-2023 (season-weighted, as the fits are) and writes
// data/game/calibration.insample.json; holdout compares with 2024-2025 and writes
// data/game/calibration.json. Both rewrite docs/GAME_REPORT.md from whichever summaries exist.
// Every run also plays a 1,000-game postseason soak (no ties allowed). Exits 1 on any gated
// failure, after writing everything.

import { cpus, arch, platform } from "node:os";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { prepareGame } from "../../packages/sim/src/loop/play";
import { REPO, loadGameData, sha256 } from "./data";
import { digest, runLeagues, type Metrics } from "./metrics";
import { renderReport, type Step5bInputs, type Step5cInputs } from "./report";

export const TARGETS = { insample: "inSample", holdout: "holdout" } as const;
export type Target = keyof typeof TARGETS;
export const SUMMARY = { insample: "data/game/calibration.insample.json", holdout: "data/game/calibration.json" } as const;
const POSTSEASON_GAMES = 1000;
/** Step 5c sim runs shown in GAME_REPORT.md, in order (labels in data/game/checks5c.sim.json). */
export const STEP5C_RUNS: readonly (readonly [string, string])[] = [
  ["baseline", "before step 5c (commit 3de880d)"],
  ["rev1", "after revision 1 (timeouts in clock order, refit)"],
];

export interface ToleranceMetric {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly tolerance: number;
  readonly minN: number;
  readonly gated: boolean;
}

export interface Tolerances {
  readonly metrics: readonly ToleranceMetric[];
  readonly known_deviations: readonly { readonly metric: string; readonly approved_by?: string; readonly scope?: "insample" | "holdout" }[];
}

/**
 * Metrics Joseph accepted for one sample (code review, 2026-11-12). An entry applies only to its
 * own scope; an entry without a scope applies to the holdout validation only, as before.
 */
export function approvedFor(tol: Pick<Tolerances, "known_deviations">, scope: "insample" | "holdout"): Set<string> {
  return new Set(tol.known_deviations.filter((d) => d.approved_by === "Joseph" && (d.scope ?? "holdout") === scope).map((d) => d.metric));
}

export interface ActualMetric {
  readonly value: number;
  readonly n: number;
  readonly count: number;
  readonly lo: number;
  readonly hi: number;
}

export interface Row {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly predicted: number;
  readonly actual: number;
  readonly n: number;
  readonly lo: number;
  readonly hi: number;
  readonly tolerance: number | null;
  readonly minN: number;
  readonly gateN: number;
  readonly spread: readonly [number, number];
  readonly status: string;
}

/** Status of one metric, from its numbers alone (the CI summary check recomputes it this way). */
export function statusOf(r: { predicted: number; actual: number; tolerance: number | null; gateN: number; minN: number; gated: boolean; id: string }, approved: ReadonlySet<string>): string {
  if (!r.gated || r.tolerance === null) return "not gated";
  if (r.gateN < r.minN) return "not gated (n below minN)";
  if (Math.abs(r.predicted - r.actual) <= r.tolerance + 1e-9) return "pass";
  return approved.has(r.id) ? "accepted" : "fail";
}

export function rows(all: Metrics, byLeague: readonly Metrics[], actual: Readonly<Record<string, ActualMetric>>, tol: Tolerances, scope: "insample" | "holdout"): Row[] {
  const approved = approvedFor(tol, scope);
  const out: Row[] = [];
  for (const t of tol.metrics) {
    if (t.id.startsWith("coach.")) continue;
    const a = actual[t.id];
    const sim = all.get(t.id);
    if (a === undefined || sim === undefined) throw new Error(`metric ${t.id} missing (${a === undefined ? "actual" : "sim"})`);
    const scale = t.unit === "pp" ? 100 : 1;
    const spreadVals = byLeague.map((m) => (m.get(t.id)?.value() ?? 0) * scale);
    const gateN = t.id === "onside.perGame" ? a.value * a.count : a.count;
    const base = { id: t.id, predicted: sim.value() * scale, actual: a.value * scale, tolerance: t.gated ? t.tolerance : null, gateN, minN: t.minN, gated: t.gated };
    out.push({
      id: t.id,
      label: t.label,
      unit: t.unit,
      predicted: base.predicted,
      actual: base.actual,
      n: a.n,
      lo: a.lo * scale,
      hi: a.hi * scale,
      tolerance: base.tolerance,
      minN: t.minN,
      gateN,
      spread: [Math.min(...spreadVals), Math.max(...spreadVals)],
      status: statusOf(base, approved),
    });
  }
  return out;
}

/** Every source file in the import graph of the calibration script, sorted, for the code hash. */
export function codeFiles(entry = join(REPO, "scripts/game/calibrate.ts")): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  const rx = /(?:import|export)\s[^;]*?from\s*"(\.{1,2}\/[^"]+)"/g;
  while (stack.length > 0) {
    const f = stack.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const m of readFileSync(f, "utf8").matchAll(rx)) {
      const spec = m[1] as string;
      const t = resolve(dirname(f), spec);
      stack.push(t.endsWith(".ts") ? t : `${t}.ts`);
    }
  }
  return [...seen].map((f) => relative(REPO, f)).sort();
}

export function codeHash(): string {
  return sha256(codeFiles().map((f) => `${f}\0${readFileSync(join(REPO, f), "utf8")}\0`).join(""));
}

/** Data files the summary pins: everything the game reads plus the real aggregates and tolerances. */
export function pinnedFiles(dataHashes: Readonly<Record<string, string>>): Record<string, string> {
  const extra = ["data/game/actuals.json", "data/game/tolerances.json", "data/game/coach.validation.json"];
  return { ...dataHashes, ...Object.fromEntries(extra.map((f) => [f, sha256(readFileSync(join(REPO, f)))])) };
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--report-only")) {
    writeReport(JSON.parse(readFileSync(join(REPO, "data/game/tolerances.json"), "utf8")) as Tolerances);
    return 0;
  }
  const target = (args[args.indexOf("--target") + 1] ?? "holdout") as Target;
  if (!(target in TARGETS)) throw new Error("--target must be insample or holdout");
  const data = loadGameData();
  const kit = prepareGame(data);
  const lg = data.config.league;
  const actuals = JSON.parse(readFileSync(join(REPO, "data/game/actuals.json"), "utf8")) as Record<string, { seasons: number[]; metrics: Record<string, ActualMetric> } | undefined>;
  const block = actuals[TARGETS[target]];
  if (block === undefined) throw new Error(`data/game/actuals.json has no ${TARGETS[target]} block; run the game pipeline first`);
  const tolBytes = readFileSync(join(REPO, "data/game/tolerances.json"));
  const tol = JSON.parse(tolBytes.toString("utf8")) as Tolerances;
  const slice: { league: number; seed: number; digest: string }[] = [];
  const violations: string[] = [];
  const run = runLeagues(
    data,
    {
      runSeed: lg.calibrationSeed,
      leagues: lg.leagues,
      gamesPerLeague: lg.gamesPerLeague,
      onGame: (record, box, g) => {
        if (slice.length < lg.ciSliceGames) slice.push({ league: g.league, seed: g.seed, digest: digest(record) });
        if (record.final.phase !== "final" || record.final.result === null) violations.push(`game ${g.seed} did not end`);
        if (record.events.some((e) => e.t === "timeout" && e.left < 0)) violations.push(`game ${g.seed}: timeouts below 0`);
        if (box.home.scrimmagePlays + box.away.scrimmagePlays > data.config.loop.maxScrimmageSnapsPerGame) violations.push(`game ${g.seed}: too many snaps`);
      },
    },
    kit,
  );
  let postTies = 0;
  const post = runLeagues(data, {
    runSeed: lg.calibrationSeed + 1,
    leagues: 1,
    gamesPerLeague: POSTSEASON_GAMES,
    gameType: "postseason",
    onGame: (record) => {
      if (record.final.result?.winner === null) postTies++;
    },
  }, kit);
  const table = rows(run.all, run.byLeague, block.metrics, tol, target);
  const summary = {
    generated: true,
    target,
    actualSeasons: block.seasons,
    tolerancesSha256: sha256(tolBytes),
    codeHash: codeHash(),
    codeFiles: codeFiles(),
    fileHashes: pinnedFiles(data.dataHashes),
    rulesHash: data.rulesHash,
    runSeed: lg.calibrationSeed,
    leagueSeeds: run.leagueSeeds,
    leagues: lg.leagues,
    gamesPerLeague: lg.gamesPerLeague,
    games: run.games,
    league: data.league,
    invariants: { violations: violations.length, examples: violations.slice(0, 10), postseasonGames: post.games, postseasonTies: postTies },
    perf: {
      msPerGame: Math.round(run.msPerGame * 1000) / 1000,
      wallSeconds: Math.round(run.wallSeconds * 10) / 10,
      machine: `${platform()} ${arch()}, ${cpus()[0]?.model ?? "?"}, Node ${process.version}`,
    },
    metrics: table,
    diagnostics: Object.fromEntries(
      [...run.all.entries()].filter(([id]) => id.startsWith("diag.")).sort().map(([id, a]) => [id, { predicted: a.value(), actual: block.metrics[id]?.value ?? null, n: block.metrics[id]?.count ?? 0 }]),
    ),
    slice,
  };
  writeFileSync(join(REPO, SUMMARY[target]), JSON.stringify(summary, null, 1) + "\n");
  writeReport(tol);
  const failed = table.filter((r) => r.status === "fail");
  process.stderr.write(`[calibrate] ${target}: ${run.games} games, ${summary.perf.msPerGame} ms per game, ${summary.perf.wallSeconds} s; ${failed.length} gated failures; ${violations.length} invariant violations; ${postTies} postseason ties\n`);
  for (const r of failed) process.stderr.write(`  FAIL ${r.id}: predicted ${r.predicted.toFixed(2)}, actual ${r.actual.toFixed(2)}, tolerance ${r.tolerance}\n`);
  return failed.length > 0 || violations.length > 0 || postTies > 0 ? 1 : 0;
}

/** Rewrites docs/GAME_REPORT.md from whichever summaries and step files exist (no games played). */
function writeReport(tol: Tolerances): void {
  const present = (Object.keys(SUMMARY) as Target[]).filter((t) => existsSync(join(REPO, SUMMARY[t])));
  const summaries = Object.fromEntries(present.map((t) => [t, JSON.parse(readFileSync(join(REPO, SUMMARY[t]), "utf8"))]));
  const coach = JSON.parse(readFileSync(join(REPO, "data/game/coach.validation.json"), "utf8"));
  const prePath = join(REPO, "data/game/calibration.insample.pre5a.json");
  const pre = existsSync(prePath) ? JSON.parse(readFileSync(prePath, "utf8")) : undefined;
  const opt = (f: string): unknown => (existsSync(join(REPO, f)) ? JSON.parse(readFileSync(join(REPO, f), "utf8")) : undefined);
  const real = opt("data/game/investigations.real.json") as { games: number; counts: Record<string, number> } | undefined;
  const sim = opt("data/game/investigations.json") as { games: number; counts: Record<string, number> } | undefined;
  const step5b: Step5bInputs = {
    stages: opt("data/game/calibration.insample.stages5b.json") as Step5bInputs["stages"],
    lateBackoff: opt("data/game/late-backoff.json") as Step5bInputs["lateBackoff"],
    investigations: real !== undefined && sim !== undefined ? { sim, real } : undefined,
    acceptedInSample: [...approvedFor(tol, "insample")],
  };
  const c5real = opt("data/game/checks5c.real.json") as Step5cInputs["real"] | undefined;
  const c5sim = opt("data/game/checks5c.sim.json") as Step5cInputs["sim"] | undefined;
  const step5c: Step5cInputs | undefined = c5real !== undefined && c5sim !== undefined ? { real: c5real, sim: c5sim, order: STEP5C_RUNS } : undefined;
  writeFileSync(join(REPO, "docs/GAME_REPORT.md"), renderReport(summaries, coach, pre, step5b, step5c));
}

if (import.meta.main) process.exit(main());
