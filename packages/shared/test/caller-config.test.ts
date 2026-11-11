// A7, C2, C3, C6, C8, C9: the designed config and the generated tables.

import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Dimension, RangeBucket } from "../src/caller";
import { parseCallerConfig, parseCallerTables, parseCatalog } from "../src/schema";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string): unknown => JSON.parse(readFileSync(join(repoRoot, p), "utf8"));
const config = parseCallerConfig(read("data/caller/config.json"));
const catalog = parseCatalog(read("data/calls/catalog.json"));
const TABLE_FILES = ["data/caller/offense.table.json", "data/caller/defense.table.json"];

function rangeOf(b: RangeBucket): [number, number] {
  return [b.min ?? -Infinity, b.max ?? Infinity];
}

describe("coarse buckets are unions of fine buckets (A7)", () => {
  const dims = config.dimensions;
  const ranged = Object.entries(dims).filter(
    (e): e is [string, Extract<Dimension, { type: "range" }>] => e[1].type === "range" && e[1].coarseOf !== undefined,
  );

  it("checks every coarse range dimension", () => {
    expect(ranged.map(([n]) => n).sort()).toEqual(["dist3", "score3", "zone3", "zoneF"]);
  });

  it.each(ranged)("%s: every fine bucket sits inside exactly one coarse bucket", (_name, dim) => {
    const fine = dims[dim.coarseOf as string];
    if (fine?.type !== "range") throw new Error("fine dimension must be a range");
    for (const f of fine.buckets) {
      const [lo, hi] = rangeOf(f);
      const containing = dim.buckets.filter((c) => {
        const [clo, chi] = rangeOf(c);
        return clo <= lo && hi <= chi;
      });
      expect(containing.length, `${f.label}`).toBe(1);
    }
  });

  it("fine and coarse range buckets do not overlap or leave gaps", () => {
    for (const [name, d] of Object.entries(dims)) {
      if (d.type !== "range") continue;
      for (let i = 1; i < d.buckets.length; i++) {
        const prev = d.buckets[i - 1] as RangeBucket;
        const cur = d.buckets[i] as RangeBucket;
        expect(cur.min, `${name} ${cur.label}`).toBe((prev.max as number) + 1);
      }
    }
  });

  it("time2 groups every time5 label exactly once", () => {
    const t5 = dims["time5"];
    const t2 = dims["time2"];
    if (t5?.type !== "rules" || t2?.type !== "group") throw new Error("unexpected time dims");
    const members = t2.groups.flatMap((g) => g.members).sort();
    expect(members).toEqual(t5.buckets.map((b) => b.label).sort());
  });

  it("clipped exact score differences each fall in one score7 bucket", () => {
    const diff = dims["diff"];
    const s7 = dims["score7"];
    if (diff?.type !== "clip" || s7?.type !== "range") throw new Error("unexpected score dims");
    for (let v = diff.min; v <= diff.max; v++) {
      expect(s7.buckets.filter((b) => rangeOf(b)[0] <= v && v <= rangeOf(b)[1])).toHaveLength(1);
    }
  });

  it("4th down drops the fine field zone last", () => {
    const levels = config.factors.o4Top.levels.map((l) => l.dims);
    expect(levels.at(-1)).toEqual([]);
    expect(levels.at(-2)).toEqual(["zone6"]);
    for (const dims of levels.slice(0, -1)) expect(dims).toContain("zone6");
  });

  it("every factor ends in a global level and keeps score sign and the final-2:00 flag until down-only", () => {
    for (const id of ["oTop", "dFront"] as const) {
      const levels = config.factors[id].levels.map((l) => l.dims);
      expect(levels.at(-1)).toEqual([]);
      expect(levels.at(-2)).toEqual(["down"]);
      for (const dims of levels.slice(0, -2)) {
        expect(dims.some((d) => d.startsWith("score"))).toBe(true);
        expect(dims.some((d) => d.startsWith("time"))).toBe(true);
      }
    }
  });
});

describe("factor targets", () => {
  const order = catalog.screens.flatMap((s) => s.choices.map((c) => c.id));

  it.each(Object.entries(config.factors))("%s: catalog targets exist and follow catalog order", (_id, f) => {
    const inCatalog = f.targets.filter((t) => order.includes(t));
    const pseudo = f.targets.filter((t) => !order.includes(t));
    for (const t of pseudo) expect(t === "plain" || t.includes(".")).toBe(true);
    const idx = inCatalog.map((t) => order.indexOf(t));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it("dTry lists the 13 presets in catalog order", () => {
    const presets = catalog.screens
      .filter((s) => ["defense.base", "defense.nickel", "defense.dime", "defense.specials"].includes(s.id))
      .flatMap((s) => s.choices.map((c) => c.id));
    expect(config.factors.dTry.targets).toEqual(presets);
    expect(Object.keys(config.defenseMapping.presets).sort()).toEqual([...presets].sort());
  });

  it("never trains on 2024 or later (C2, from config)", () => {
    for (const f of Object.values(config.factors)) {
      expect(f.seasons.to).toBeLessThan(2024);
      for (const r of Object.values(f.seasons.byDown ?? {})) expect(r.to).toBeLessThan(2024);
    }
  });
});

describe("generated tables", () => {
  const tables = TABLE_FILES.map((p) => parseCallerTables(read(p)));

  it("validate against the zod schema (C9), with every cell summing to 10,000 (C6)", () => {
    expect(tables.map((t) => t.side)).toEqual(["offense", "defense"]);
  });

  it("record seasons and weights, none 2024 or later (C2)", () => {
    for (const t of tables) {
      for (const [id, f] of Object.entries(t.factors)) {
        expect(f.seasons.length, id).toBeGreaterThan(0);
        expect(Math.max(...f.seasons), id).toBeLessThan(2024);
        expect(Object.keys(f.seasonWeights).map(Number), id).toEqual(f.seasons);
        for (const s of f.seasons) {
          expect(f.seasonWeights[String(s)]).toBeCloseTo(0.5 ** ((t.weightAnchor - s) / t.halfLifeSeasons), 12);
        }
      }
    }
  });

  it("use the season ranges the lead set (C3)", () => {
    const [off, def] = tables;
    const range = (s: readonly number[]) => [s[0], s.at(-1)];
    expect(range(off?.factors.oTop?.seasons ?? [])).toEqual([2016, 2023]);
    expect(off?.factors.oTop?.downs).toEqual([1, 2, 3]);
    expect(off?.factors.o4Top?.downs).toEqual([4]);
    expect(range(off?.factors.o4Top?.seasons ?? [])).toEqual([2021, 2023]);
    expect(range(off?.factors.o4Kick?.seasons ?? [])).toEqual([2016, 2023]);
    expect(off?.factors.oPassType?.seasons).toEqual([2022, 2023]);
    expect(off?.factors.oDepth?.seasons).toEqual([2022, 2023]);
    for (const f of Object.values(def?.factors ?? {})) expect(range(f.seasons)).toEqual([2018, 2023]);
  });

  it("match the config they were built from", () => {
    for (const t of tables) {
      for (const [id, f] of Object.entries(t.factors)) {
        const cfg = config.factors[id as keyof typeof config.factors];
        expect(f.targets).toEqual(cfg.targets);
        expect(f.levels).toEqual(cfg.levels);
        expect(f.minPlays).toBe(cfg.minPlays);
      }
    }
  });

  it("total at most 300 KB as written (C8)", () => {
    const bytes = TABLE_FILES.reduce((n, p) => n + statSync(join(repoRoot, p)).size, 0);
    expect(bytes).toBeLessThanOrEqual(300 * 1024);
  });
});
