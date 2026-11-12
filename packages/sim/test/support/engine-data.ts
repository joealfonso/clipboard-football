// Loads and validates the real engine data for tests, through the shared zod schemas, here in
// the test and never inside packages/sim/src.

import { parseEngineData } from "../../../shared/src/engine-schema";
import type { EngineData } from "../../../shared/src/engine";
import { loadCallerData, readJson } from "../caller/load-data";
import { loadRules } from "./rules";

export const ENGINE_FILES = {
  config: "data/engine/config.json",
  scrimmage: "data/engine/baseline.scrimmage.json",
  special: "data/engine/baseline.special.json",
  penalties: "data/engine/baseline.penalties.json",
  kickoff: "data/engine/kickoff.json",
  matchup: "data/engine/matchup.centered.json",
  personnel: "data/engine/personnel.json",
  ratings: "data/players/ratings.json",
  distributions: "data/players/distributions.json",
  names: "data/players/names.json",
  why: "data/engine/why.json",
} as const;

let cached: EngineData | undefined;

export function loadEngineData(): EngineData {
  cached ??= parseEngineData(
    Object.fromEntries(Object.entries(ENGINE_FILES).map(([k, p]) => [k, readJson(p)])) as unknown as Parameters<typeof parseEngineData>[0],
    loadRules().rules,
    loadCallerData(),
  );
  return cached;
}
