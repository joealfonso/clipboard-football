// D1, D2, D4, D5, D6: the runtime callers.

import { describe, expect, expectTypeOf, it } from "vitest";
import type { CallerData, CallerTables, FactorTable, Situation } from "../../../shared/src/types";
import { chooseDefenseCall, chooseOffenseCall, defenseShares, formationShares, offenseShares } from "../../src/caller/index";
import type { CallerMasks } from "../../src/caller/offense";
import { sampleIndex } from "../../src/caller/sample";
import { Rng } from "../../src/rng";
import { loadCallerData } from "./load-data";

const data = loadCallerData();

function sit(over: Partial<Situation> = {}): Situation {
  return {
    phase: "scrimmage",
    down: 1,
    yardsToGo: 10,
    yardLine100: 75,
    scoreDiff: 0,
    quarter: 1,
    secondsLeftInHalf: 1500,
    secondsLeftInGame: 3300,
    offenseTimeouts: 3,
    defenseTimeouts: 3,
    clockRunning: 0,
    otBothPossessed: 0,
    ...over,
  };
}

// A spread of situations, including tries and late-game ones.
const SITUATIONS: Situation[] = [];
for (const down of [1, 2, 3, 4]) {
  for (const [ytg, yl] of [[1, 1], [2, 40], [7, 25], [10, 75], [15, 92]] as const) {
    for (const [q, h, g] of [[1, 1500, 3300], [2, 90, 1890], [4, 400, 400], [4, 30, 30]] as const) {
      for (const sd of [-10, 0, 7]) SITUATIONS.push(sit({ down, yardsToGo: ytg, yardLine100: yl, quarter: q, secondsLeftInHalf: h, secondsLeftInGame: g, scoreDiff: sd }));
    }
  }
}
for (const sd of [-8, -1, 0, 6, 25]) SITUATIONS.push(sit({ phase: "try", yardLine100: 2, scoreDiff: sd, quarter: 4, secondsLeftInHalf: 200, secondsLeftInGame: 200 }));

describe("determinism (D1)", () => {
  it("same seed, situations and tables give the same 10,000 calls", () => {
    const run = (seed: number) => {
      const rng = Rng.fromSeed(seed);
      const out: string[] = [];
      for (let i = 0; i < 10000; i++) {
        const s = SITUATIONS[i % SITUATIONS.length] as Situation;
        const o = chooseOffenseCall(s, data, rng);
        out.push(`${o.call}/${o.twoPointPlay ?? ""}/${o.formation ?? ""}|${chooseDefenseCall(s, data, rng)}`);
      }
      return out;
    };
    const a = run(20261111);
    expect(run(20261111)).toEqual(a);
    expect(run(20261112)).not.toEqual(a);
  }, 30_000);
});

describe("shares (D2)", () => {
  it.each(SITUATIONS.map((s, i) => [i, s] as const))("situation %i sums to 1 over available calls", (_i, s) => {
    const off = offenseShares(s, data);
    expect(Math.abs(off.leaves.reduce((a, l) => a + l.p, 0) - 1)).toBeLessThanOrEqual(1e-9);
    for (const l of off.leaves) expect(l.p).toBeGreaterThanOrEqual(0);
    if (s.phase === "scrimmage") {
      const kickOk = s.down === 4 || s.secondsLeftInHalf <= 120;
      if (!kickOk) {
        expect(off.leaves.find((l) => l.call === "punt")?.p).toBe(0);
        expect(off.leaves.find((l) => l.call === "fieldGoal")?.p).toBe(0);
      }
      expect(off.leaves.some((l) => l.call === "extraPoint")).toBe(false);
    } else {
      expect(off.leaves.every((l) => l.call === "extraPoint" || l.call === "goForTwo")).toBe(true);
    }
    const def = defenseShares(s, data);
    expect(Math.abs(def.presets.reduce((a, p) => a + p.p, 0) - 1)).toBeLessThanOrEqual(1e-9);
    expect(def.presets).toHaveLength(13);
  });

  it("share functions take no RNG", () => {
    // Amended 2026-11-12 (M1 step 5c milestones B, E, F): an optional set of designed masks, data only.
    expectTypeOf(offenseShares).parameters.toEqualTypeOf<[Situation, CallerData, (CallerMasks | undefined)?]>();
    expectTypeOf(defenseShares).parameters.toEqualTypeOf<[Situation, CallerData]>();
  });
});

describe("sampling (D4)", () => {
  it("100,000 draws land within 0.5 points of each share", () => {
    const s = sit({ down: 3, yardsToGo: 4, yardLine100: 45 });
    const shares = offenseShares(s, data).leaves.map((l) => l.p);
    const rng = Rng.fromSeed(7);
    const counts = shares.map(() => 0);
    const N = 100000;
    for (let i = 0; i < N; i++) counts[sampleIndex(shares, rng)]! += 1;
    counts.forEach((c, i) => expect(Math.abs(c / N - (shares[i] ?? 0))).toBeLessThan(0.005));

    const def = defenseShares(s, data).presets.map((p) => p.p);
    const dc = def.map(() => 0);
    for (let i = 0; i < N; i++) dc[sampleIndex(def, rng)]! += 1;
    dc.forEach((c, i) => expect(Math.abs(c / N - (def[i] ?? 0))).toBeLessThan(0.005));
  });

  it("never returns a zero weight and rejects an empty distribution", () => {
    const rng = Rng.fromSeed(1);
    for (let i = 0; i < 1000; i++) expect(sampleIndex([0, 3, 0, 1, 0], rng)).toBeOneOf([1, 3]);
    expect(() => sampleIndex([0, 0], rng)).toThrow(RangeError);
    expect(() => sampleIndex([1, -1], rng)).toThrow(RangeError);
  });

  it("formation is drawn only for run and pass plays", () => {
    const rng = Rng.fromSeed(3);
    for (let i = 0; i < 2000; i++) {
      const o = chooseOffenseCall(sit({ down: 4, yardsToGo: 8, yardLine100: 60 }), data, rng);
      if (["punt", "fieldGoal", "spike", "kneel"].includes(o.call)) expect(o.formation).toBeUndefined();
      else expect(o.formation).toBeDefined();
    }
  });
});

// Fixture tables for masking: one level keyed on down, then global.
function table(targets: string[], cells: Record<string, number[]>[], levels = [{ dims: ["down"] }, { dims: [] }]): FactorTable {
  return { targets, levels, minPlays: 1, seasons: [2023], seasonWeights: { "2023": 1 }, plays: 1, cells };
}
function single(targets: string[]): FactorTable {
  const w = targets.map((_, i) => (i === 0 ? 10000 : 0));
  return table(targets, [{ "": w }], [{ dims: [] }]);
}
function withOffense(oTop: FactorTable): CallerData {
  const f = data.offense.factors;
  const offense: CallerTables = {
    ...data.offense,
    factors: { ...f, oTop, oRun: single(f.oRun?.targets as string[]), oPassType: single(f.oPassType?.targets as string[]), oDepth: single(f.oDepth?.targets as string[]) },
  };
  return { ...data, offense };
}
const TOP = ["run", "pass", "punt", "fieldGoal", "spike", "kneel"];

describe("masking (D5)", () => {
  it("falls through to the next level when the finest cell's only call is unavailable", () => {
    const d = withOffense(table(TOP, [{ "1": [0, 0, 10000, 0, 0, 0] }, { "": [6000, 4000, 0, 0, 0, 0] }]));
    const off = offenseShares(sit({ down: 1 }), d);
    expect(off.trace["oTop"]?.level).toBe(1);
    expect(off.leaves.find((l) => l.call === "insideRun")?.p).toBeCloseTo(0.6, 12);
    // In the final 2:00 of a half Kick is available, so the same cell is usable.
    const late = offenseShares(sit({ down: 1, quarter: 2, secondsLeftInHalf: 100, secondsLeftInGame: 1900 }), d);
    expect(late.trace["oTop"]?.level).toBe(0);
    expect(late.leaves.find((l) => l.call === "punt")?.p).toBe(1);
  });

  it("4th down uses the go-or-kick factor and splits a kick into punt or field goal", () => {
    const s4 = sit({ down: 4, yardsToGo: 8, yardLine100: 30 });
    const off = offenseShares(s4, data);
    expect(off.trace["oTop"]).toBeUndefined();
    const go = off.trace["o4Top"];
    const kick = off.trace["o4Kick"];
    if (go === undefined || kick === undefined) throw new Error("missing 4th-down trace");
    const pKick = (go.weights[2] ?? 0) / go.total;
    expect(off.leaves.find((l) => l.call === "punt")?.p).toBeCloseTo((pKick * (kick.weights[0] ?? 0)) / kick.total, 12);
    expect(off.leaves.find((l) => l.call === "fieldGoal")?.p).toBeCloseTo((pKick * (kick.weights[1] ?? 0)) / kick.total, 12);
  });

  it("still returns a run or pass when every level masks to nothing", () => {
    const d = withOffense(table(TOP, [{ "1": [0, 0, 10000, 0, 0, 0] }, { "": [0, 0, 5000, 5000, 0, 0] }]));
    const off = offenseShares(sit({ down: 1 }), d);
    expect(off.trace["oTop"]?.level).toBe(-1);
    expect(off.leaves.filter((l) => l.p > 0).map((l) => l.call).sort()).toEqual(["insideRun", "screenPass"]);
    const rng = Rng.fromSeed(5);
    for (let i = 0; i < 200; i++) expect(["insideRun", "screenPass"]).toContain(chooseOffenseCall(sit({ down: 1 }), d, rng).call);
  });

  it("formation lookup backs off when a play's finest cell is missing", () => {
    const f = formationShares(sit({ phase: "try", yardLine100: 2 }), "qbSneak", data);
    expect(f.level).toBeGreaterThan(0);
  });
});

describe("defense inputs (D6)", () => {
  it("takes only the situation, the tables and the rng", () => {
    expectTypeOf(chooseDefenseCall).parameters.toEqualTypeOf<[Situation, CallerData, Rng]>();
    expectTypeOf(chooseDefenseCall).returns.toEqualTypeOf<string>();
  });

  it("returns a preset id from the catalog", () => {
    const rng = Rng.fromSeed(11);
    const presets = new Set(data.defense.factors.dTry?.targets);
    for (const s of SITUATIONS) expect(presets.has(chooseDefenseCall(s, data, rng))).toBe(true);
  });
});
