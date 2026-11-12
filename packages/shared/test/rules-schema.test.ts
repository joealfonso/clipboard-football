// A1: the rule set file parses, and bad rule sets are rejected.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRuleSet, ruleSetSchema } from "../src/rules-schema";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
type Json = { [k: string]: unknown };
const raw = (): Json => JSON.parse(readFileSync(join(repoRoot, "data/rules/nfl-2026.json"), "utf8")) as Json;

/** Sets (or, for undefined, deletes) the value at a dotted path. */
function edit(r: Json, path: string, value: unknown): Json {
  const keys = path.split(".");
  const last = keys.pop() as string;
  const parent = keys.reduce<Json>((o, k) => o[k] as Json, r);
  if (value === undefined) delete parent[last];
  else parent[last] = value;
  return r;
}

describe("rule set schema (A1)", () => {
  it("parses the real rule set", () => {
    const r = parseRuleSet(raw());
    expect([r.id, r.season]).toEqual(["nfl-2026", 2026]);
  });

  const bad: [string, string, unknown][] = [
    ["a negative quarter length", "game.periodSeconds", -900],
    ["a touchback spot outside 1 to 99", "kickoff.touchbackFromEndZone", 100],
    ["a touchback spot of 0", "touchback.scrimmageSpot", 0],
    ["a landing zone whose start is past its end", "kickoff.landingZone", { from: 25, to: 20 }],
    ["a penalty with an unknown enforcement spot", "penalties.falseStart.enforcement", "spotOfTheMoon"],
    ["an overtime format missing a field", "overtime.postseason.guaranteedPossession", undefined],
    ["an overtime period length of 0", "overtime.postseason.periodSeconds", 0],
    ["an unknown top-level key", "extra", 1],
    ["a two-minute warning period outside regulation", "clock.twoMinuteWarningPeriods", [2, 5]],
  ];
  it.each(bad)("rejects %s", (_n, path, value) => {
    expect(ruleSetSchema.safeParse(edit(raw(), path, value)).success).toBe(false);
  });
});
