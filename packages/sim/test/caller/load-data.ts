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

/**
 * Step 5d (code review): binning fails on a missing Situation field. Fixtures made before step 5d
 * get the two new fields here, explicitly (clock stopped, overtime flag 0), so no production code
 * has to tolerate a missing field.
 */
export function readFixture(path: string): unknown {
  const fill = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(fill);
    if (x !== null && typeof x === "object") {
      const o = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fill(v)]));
      if ("phase" in o && "defenseTimeouts" in o) return { clockRunning: 0, otBothPossessed: 0, ...o };
      return o;
    }
    return x;
  };
  return fill(readJson(path));
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
