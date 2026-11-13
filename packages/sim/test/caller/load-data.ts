// Loads and validates the real caller data for tests. Validation goes through the shared
// zod schemas here in the test, never inside packages/sim/src.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { checkCallerTables, withRulePlayClock, parseCallerConfig, parseCallerTables, parseCatalog } from "../../../shared/src/schema";
import type { CallerData } from "../../../shared/src/types";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}

let cached: CallerData | undefined;

/** sha256 of catalog.json and config.json, each followed by a NUL (pipeline/caller/config.py). */
export function callerConfigHash(root = repoRoot): string {
  const h = createHash("sha256");
  for (const f of ["data/calls/catalog.json", "data/caller/config.json"]) {
    h.update(readFileSync(join(root, f)));
    h.update(Buffer.from([0]));
  }
  return h.digest("hex");
}

export function loadCallerData(): CallerData {
  if (cached === undefined) {
    const data: CallerData = {
      catalog: parseCatalog(readJson("data/calls/catalog.json")),
      config: withRulePlayClock(parseCallerConfig(readJson("data/caller/config.json")), readJson("data/rules/nfl-2026.json")),
      offense: parseCallerTables(readJson("data/caller/offense.table.json")),
      defense: parseCallerTables(readJson("data/caller/defense.table.json")),
    };
    checkCallerTables(data.config, callerConfigHash(), [data.offense, data.defense]);
    cached = data;
  }
  return cached;
}
