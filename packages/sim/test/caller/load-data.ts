// Loads and validates the real caller data for tests. Validation goes through the shared
// zod schemas here in the test, never inside packages/sim/src.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCallerConfig, parseCallerTables, parseCatalog } from "../../../shared/src/schema";
import type { CallerData } from "../../../shared/src/types";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}

let cached: CallerData | undefined;

export function loadCallerData(): CallerData {
  cached ??= {
    catalog: parseCatalog(readJson("data/calls/catalog.json")),
    config: parseCallerConfig(readJson("data/caller/config.json")),
    offense: parseCallerTables(readJson("data/caller/offense.table.json")),
    defense: parseCallerTables(readJson("data/caller/defense.table.json")),
  };
  return cached;
}
