// M1 step 5d: keeps each milestone's in-sample game metrics for the before/after table (H1).
// Run right after `calibrate.ts --target insample`; copies that summary's metric rows, invariants
// and speed into data/game/calibration.insample.stages5d.json under a label.
//
//   node --import ./scripts/engine/register.mjs scripts/game/stage5d.ts --label <name> [--what "<text>"]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./data";

export const STAGES_FILE = "data/game/calibration.insample.stages5d.json";

export interface Stage5d {
  readonly what: string;
  readonly metrics: readonly { readonly id: string; readonly predicted: number; readonly actual: number; readonly tolerance: number | null; readonly status: string; readonly spread: readonly [number, number] }[];
  readonly invariants: unknown;
  readonly msPerGame: number;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const label = args[args.indexOf("--label") + 1];
  if (!args.includes("--label") || label === undefined) throw new Error("--label is required");
  const what = args.includes("--what") ? (args[args.indexOf("--what") + 1] ?? "") : "";
  const s = JSON.parse(readFileSync(join(REPO, "data/game/calibration.insample.json"), "utf8")) as {
    metrics: { id: string; predicted: number; actual: number; tolerance: number | null; status: string; spread: [number, number] }[];
    invariants: unknown;
    perf: { msPerGame: number };
  };
  const path = join(REPO, STAGES_FILE);
  const prev = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { stages: Record<string, Stage5d> }) : { stages: {} };
  const stage: Stage5d = {
    what,
    metrics: s.metrics.map((m) => ({ id: m.id, predicted: m.predicted, actual: m.actual, tolerance: m.tolerance, status: m.status, spread: m.spread })),
    invariants: s.invariants,
    msPerGame: s.perf.msPerGame,
  };
  writeFileSync(path, JSON.stringify({ generated: true, stages: { ...prev.stages, [label]: stage } }, null, 1) + "\n");
  process.stdout.write(`wrote ${STAGES_FILE} (${label}: ${stage.metrics.filter((m) => m.status === "fail").length} gated failures)\n`);
}
