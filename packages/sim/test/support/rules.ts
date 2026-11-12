// Loads the real rule set through the shared zod schema, here in the test and never inside
// packages/sim/src, and builds fixture rule sets that change one group of values.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRuleSet } from "../../../shared/src/rules-schema";
import type { RuleSet } from "../../../shared/src/types";
import { repoRoot } from "../caller/load-data";

export const RULES_PATH = "data/rules/nfl-2026.json";

export function readRulesBytes(path = RULES_PATH): Buffer {
  return readFileSync(join(repoRoot, path));
}

export function rulesHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

let cached: { rules: RuleSet; hash: string } | undefined;

export function loadRules(): { rules: RuleSet; hash: string } {
  if (cached === undefined) {
    const bytes = readRulesBytes();
    cached = { rules: parseRuleSet(JSON.parse(bytes.toString("utf8"))), hash: rulesHash(bytes) };
  }
  return cached;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

function merge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) out[k] = merge(out[k], v);
  return out;
}

/** A fixture rule set: the real one with `patch` merged in, validated by the same schema. */
export function fixtureRules(patch: DeepPartial<RuleSet>, id = "fixture"): RuleSet {
  return parseRuleSet(merge({ ...JSON.parse(readRulesBytes().toString("utf8")), id }, patch));
}
