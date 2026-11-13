// A6: the shared binning fixture, checked here and in pipeline/tests/test_caller_fit.py.

import { describe, expect, it } from "vitest";
import type { Situation } from "../../../shared/src/types";
import { binSituation, levelKey } from "../../src/caller/bins";
import { loadCallerData, readJson } from "./load-data";

const fixture = readJson("test/fixtures/caller-bins.json") as {
  cases: { name: string; situation: Situation; bins: Record<string, string | null> }[];
};
const { config } = loadCallerData();

describe("binning fixture", () => {
  it("covers every distance and yard-line edge in the bin table", () => {
    const scrim = fixture.cases.filter((c) => c.situation.phase === "scrimmage");
    const dist = new Set(scrim.map((c) => c.situation.yardsToGo));
    const yl = new Set(scrim.map((c) => c.situation.yardLine100));
    for (const d of [1, 3, 4, 6, 7, 10, 11]) expect(dist.has(d), `distance ${d}`).toBe(true);
    for (const y of [5, 6, 20, 21, 35, 36, 50, 51, 89, 90]) expect(yl.has(y), `yard line ${y}`).toBe(true);
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const labels = binSituation(c.situation, config.dimensions);
    for (const [dim, expected] of Object.entries(c.bins)) expect(labels[dim], dim).toBe(expected);
    // Every backoff level of every factor.
    const ctx = { leaf: "insideRun", front: "front.nickelLight" };
    for (const f of Object.values(config.factors)) {
      for (const level of f.levels) {
        const parts = [...(level.tag === undefined ? [] : [level.tag]), ...level.dims.map((d) => (d in ctx ? ctx[d as keyof typeof ctx] : labels[d]))];
        const expected = parts.some((p) => p === null || p === undefined) ? null : parts.join("|");
        expect(levelKey(level, labels, ctx)).toBe(expected);
      }
    }
  });

  it("throws on a value outside every bucket", () => {
    const sit = { ...(fixture.cases[0]?.situation as Situation), yardsToGo: 0 };
    expect(() => binSituation(sit, config.dimensions)).toThrow(RangeError);
  });

  it("gives 4th-down level keys for the 4th-and-goal edge case", () => {
    const c = fixture.cases.find((x) => x.name.startsWith("4th and goal")) as (typeof fixture.cases)[number];
    const labels = binSituation(c.situation, config.dimensions);
    // Amended by step 5a: outside the last 5:00 the late-only levels do not apply (null) and every
    // other level gives the same key, in the same order, as before. Amended by step 5b: the
    // new late levels are null here; the regulation levels keep their keys. Amended again for
    // the o4Top reorder (Joseph, 2026-11-12): the score3 levels now come before the late levels.
    expect(config.factors.o4Top.levels.map((l) => levelKey(l, labels))).toEqual([
      "1|GL|-8..-1|H1F|c40.o1+.d1",
      null,
      "1|GL|-8..-1|H1F",
      null,
      null,
      null,
      null,
      null,
      "1|GL|T|H1F",
      "1|GL|T|F",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      "1|GL",
      "1-3|GL",
      "GL",
      "",
    ]);
    expect(config.factors.o4Kick.levels.map((l) => levelKey(l, labels))).toEqual([null, null, null, "GL|F", "GL", ""]);
  });
});
