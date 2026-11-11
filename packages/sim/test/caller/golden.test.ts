// D3: TypeScript shares equal the pipeline's for every situation in data/caller/golden.json.

import { describe, expect, it } from "vitest";
import type { Situation } from "../../../shared/src/types";
import { defenseShares, formationShares, offenseShares } from "../../src/caller/index";
import { loadCallerData, readJson } from "./load-data";

interface TraceEntry {
  level: number;
  key: string;
  weights?: number[];
}
interface GoldenEntry {
  situation: Situation;
  offense: {
    leaves: { call: string; twoPointPlay?: string; p: number }[];
    trace: Record<string, TraceEntry>;
    formations: Record<string, TraceEntry>;
  };
  defense: { presets: { call: string; p: number }[]; trace: Record<string, TraceEntry> };
}

const golden = readJson("data/caller/golden.json") as { configHash: string; situations: GoldenEntry[] };
const data = loadCallerData();

describe("golden shares", () => {
  it("has at least 200 situations, including tries, from the current tables", () => {
    expect(golden.situations.length).toBeGreaterThanOrEqual(200);
    expect(golden.situations.some((g) => g.situation.phase === "try")).toBe(true);
    expect(golden.configHash).toBe(data.offense.configHash);
    expect(golden.configHash).toBe(data.defense.configHash);
  });

  it.each(golden.situations.map((g, i) => [i, g] as const))("situation %i matches", (_i, g) => {
    const off = offenseShares(g.situation, data);
    expect(off.leaves.map((l) => [l.call, l.twoPointPlay ?? null])).toEqual(
      g.offense.leaves.map((l) => [l.call, l.twoPointPlay ?? null]),
    );
    off.leaves.forEach((l, i) => expect(Math.abs(l.p - (g.offense.leaves[i]?.p ?? NaN))).toBeLessThanOrEqual(1e-9));
    for (const [name, t] of Object.entries(g.offense.trace)) {
      const mine = off.trace[name];
      expect(mine?.level, name).toBe(t.level);
      expect(mine?.key, name).toBe(t.key);
      if (t.weights !== undefined) expect(mine?.weights, name).toEqual(t.weights);
    }
    for (const [play, t] of Object.entries(g.offense.formations)) {
      const f = formationShares(g.situation, play, data);
      expect([f.level, f.key]).toEqual([t.level, t.key]);
    }
    const def = defenseShares(g.situation, data);
    expect(def.presets.map((p) => p.call)).toEqual(g.defense.presets.map((p) => p.call));
    def.presets.forEach((p, i) => expect(Math.abs(p.p - (g.defense.presets[i]?.p ?? NaN))).toBeLessThanOrEqual(1e-9));
    expect(Object.keys(def.trace).sort()).toEqual(Object.keys(g.defense.trace).sort());
    for (const [name, t] of Object.entries(g.defense.trace)) {
      expect([def.trace[name]?.level, def.trace[name]?.key], name).toEqual([t.level, t.key]);
    }
  });
});
