// M1 step 5a, A1, A2, A4 and B1: late-game score bins, refinement of score7, version check, and
// shares outside the late windows unchanged from the frozen pre-5a golden file.

import { describe, expect, it } from "vitest";
import { checkCallerTables, parseCallerConfig, parseCallerTables } from "../../../shared/src/schema";
import type { Situation } from "../../../shared/src/types";
import { binSituation } from "../../src/caller/bins";
import { offenseShares } from "../../src/caller/offense";
import { defenseShares } from "../../src/caller/defense";
import { callerConfigHash, loadCallerData, readJson } from "./load-data";

const data = loadCallerData();
const dims = data.config.dimensions;
const fixture = readJson("test/fixtures/caller-late-bins.json") as { cases: { name: string; situation: Situation; bins: Record<string, string | null> }[] };

describe("late score bins (A1)", () => {
  it("covers every edge and both window boundaries", () => {
    const diffs = new Set(fixture.cases.map((c) => c.situation.scoreDiff));
    for (const d of [-17, -16, -9, -8, -4, -3, -1, 0, 1, 3, 4, 8, 9, 16, 17]) expect(diffs.has(d), `diff ${d}`).toBe(true);
    const secs = new Set(fixture.cases.map((c) => c.situation.secondsLeftInGame));
    for (const s of [301, 300, 121, 120]) expect(secs.has(s), `seconds ${s}`).toBe(true);
    expect(fixture.cases.some((c) => c.situation.quarter === 5)).toBe(true);
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    const labels = binSituation(c.situation, dims);
    for (const [dim, want] of Object.entries(c.bins)) expect(labels[dim], dim).toBe(want);
  });
});

describe("late buckets refine score7 and score3 (A2)", () => {
  it("every late bucket lies inside one score7 bucket and one score3 bucket", () => {
    for (let d = -40; d <= 40; d++) {
      const sit: Situation = { phase: "scrimmage", down: 1, yardsToGo: 10, yardLine100: 50, scoreDiff: d, quarter: 4, secondsLeftInHalf: 100, secondsLeftInGame: 100, offenseTimeouts: 1, defenseTimeouts: 1 };
      const l = binSituation(sit, dims);
      const late = l["scoreLateOnly"] as string;
      // Every diff with this late label has the same score7 and score3 label.
      for (let e = -40; e <= 40; e++) {
        const m = binSituation({ ...sit, scoreDiff: e }, dims);
        if (m["scoreLateOnly"] === late) {
          expect(m["score7"], `late ${late} at ${e}`).toBe(l["score7"]);
          expect(m["score3"], `late ${late} at ${e}`).toBe(l["score3"]);
        }
      }
    }
  });
});

describe("tables built from another config are refused (A4)", () => {
  it("names both versions and hashes, with a real version-1 table and config", () => {
    const hash = callerConfigHash();
    expect(() => checkCallerTables(data.config, hash, [data.offense, data.defense])).not.toThrow();
    // The offense table and config of commit 29e2650, the last version-1 build (test/fixtures/caller-v1).
    const v1 = parseCallerTables(readJson("test/fixtures/caller-v1/offense.table.json"));
    const v1Config = parseCallerConfig(readJson("test/fixtures/caller-v1/config.json"));
    expect(v1.configVersion).toBe(1);
    // Amended by step 5b: the current config is version 3 (was 2); the check is unchanged.
    const now = data.config.version;
    expect(() => checkCallerTables(data.config, hash, [v1])).toThrow(new RegExp(`version 1 \\(sha256 [0-9a-f]{64}\\).*version ${now} \\(sha256`, "s"));
    // And the reverse: current tables with the version-1 config.
    expect(() => checkCallerTables(v1Config, v1.configHash, [data.offense])).toThrow(new RegExp(`version ${now} \\(sha256 [0-9a-f]{64}\\).*version 1 \\(sha256`, "s"));
  });
});

describe("outside the late windows nothing moves (B1)", () => {
  const frozen = readJson("test/fixtures/caller-golden-v1.json") as { situations: { situation: Situation; offense: { leaves: { call: string; twoPointPlay?: string; p: number }[] }; defense: { presets: { call: string; p: number }[] } }[] };
  // Amended by step 5b: overtime is now a late window too (5b spec, "Overtime bucket"), so the
  // late test is the 5a window (scoreLateOnly applies) or overtime.
  const late = (s: Situation): boolean => s.phase === "scrimmage" && (binSituation(s, dims)["scoreLateOnly"] !== null || binSituation(s, dims)["lateTime"] === "OT");

  it("every pre-5a golden situation outside the late windows has the same offense and defense shares", () => {
    let checked = 0;
    for (const g of frozen.situations) {
      const d = defenseShares(g.situation, data);
      g.defense.presets.forEach((p, i) => expect(d.presets[i]?.p, `defense ${JSON.stringify(g.situation)}`).toBeCloseTo(p.p, 12));
      if (late(g.situation)) continue;
      const o = offenseShares(g.situation, data);
      g.offense.leaves.forEach((lf, i) => expect(o.leaves[i]?.p, `offense ${JSON.stringify(g.situation)}`).toBeCloseTo(lf.p, 12));
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });
});
