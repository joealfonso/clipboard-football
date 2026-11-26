// Loads and validates the franchise data bundle for the scripts and the tests, through the shared
// zod schemas, never inside packages/sim/src.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FranchiseData } from "../../packages/shared/src/franchise";
import { parseFranchiseData } from "../../packages/shared/src/franchise-schema";
import type { FranchiseFiles } from "../../packages/shared/src/franchise-schema";
import type { GameData } from "../../packages/shared/src/game";
import { loadGameData, REPO } from "../game/data";

export const FRANCHISE_FILES = {
  league: "data/franchise/league.json",
  roster: "data/franchise/roster.json",
  pool: "data/franchise/pool.json",
  draftAi: "data/franchise/draft-ai.json",
} as const;
/** The overall weights have one home, read by the app and the sim (A7). */
export const OVERALL_WEIGHTS_FILE = "data/ui/templates.json";

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(REPO, path), "utf8"));
}

export function franchiseFiles(): FranchiseFiles {
  return {
    ...(Object.fromEntries(Object.entries(FRANCHISE_FILES).map(([k, f]) => [k, readJson(f)])) as Record<keyof typeof FRANCHISE_FILES, unknown>),
    overallWeights: (readJson(OVERALL_WEIGHTS_FILE) as { overallWeights: unknown }).overallWeights,
  };
}

/** `files` replaces a file's parsed JSON (tuning uses this for designed parameters). */
export function loadFranchise(files: Partial<FranchiseFiles> = {}, game: GameData = loadGameData()): FranchiseData {
  return parseFranchiseData({ ...franchiseFiles(), ...files }, game);
}
