// M1 step 5b, B2 to B5, B7 and B8: late time state, five-bucket late score and can-kneel-out
// bins, coarse-is-union, nothing moves outside the late windows (against the frozen pre-5b
// golden file), the version check against real version-2 tables, backoff routing and golden
// coverage of the new levels.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkCallerTables, parseCallerConfig, parseCallerTables, withRulePlayClock } from "../../../shared/src/schema";
import type { FactorTable, Situation } from "../../../shared/src/types";
import { binSituation, levelKey } from "../../src/caller/bins";
import { lookup } from "../../src/caller/lookup";
import { defenseShares } from "../../src/caller/defense";
import { formationShares, offenseShares } from "../../src/caller/offense";
import { callerConfigHash, loadCallerData, readJson } from "./load-data";

const data = loadCallerData();
const dims = data.config.dimensions;

describe("5b binning fixture (B2)", () => {
  const fixture = readJson("test/fixtures/caller-5b-bins.json") as { cases: { name: string; situation: Situation; bins: Record<string, string | null> }[] };

  it("covers the score edges, the window seconds, quarter 4 vs 5 and both kneel-out values at every down and timeout count", () => {
    const diffs = new Set(fixture.cases.map((c) => c.situation.scoreDiff));
    for (const d of [-9, -8, -1, 0, 1, 8, 9]) expect(diffs.has(d), `diff ${d}`).toBe(true);
    for (const s of [301, 300, 121, 120]) {
      for (const q of [4, 5]) expect(fixture.cases.some((c) => c.situation.secondsLeftInGame === s && c.situation.quarter === q), `q${q} ${s}s`).toBe(true);
    }
    for (let down = 1; down <= 3; down++) {
      for (let t = 0; t <= 3; t++) {
        const at = fixture.cases.filter((c) => c.situation.down === down && c.situation.defenseTimeouts === t && c.bins["kneelOut"] !== null);
        expect(at.some((c) => c.bins["kneelOut"] === "K0"), `down ${down} TO ${t} K0`).toBe(true);
        expect(at.some((c) => c.bins["kneelOut"] === "K1") || at.every((c) => c.name.includes("past")), `down ${down} TO ${t} K1`).toBe(true);
      }
    }
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    const labels = binSituation(c.situation, dims);
    for (const [dim, want] of Object.entries(c.bins)) expect(labels[dim], dim).toBe(want);
  });

  it("other dimensions keep binning overtime as before (time5 is not OT)", () => {
    const ot: Situation = { phase: "scrimmage", down: 1, yardsToGo: 10, yardLine100: 50, scoreDiff: 0, quarter: 5, secondsLeftInHalf: 100, secondsLeftInGame: 100, offenseTimeouts: 1, defenseTimeouts: 1 };
    const l = binSituation(ot, dims);
    expect(l["lateTime"]).toBe("OT");
    expect(l["time5"]).not.toBe("OT");
  });
});

describe("scoreLate5 is a union of finer buckets (B3)", () => {
  it("every diff sharing a scoreLate5 bucket shares its scoreLate (5a), score7 and score3 parents' coarseness", () => {
    // scoreLate5 must be a union of 5a late buckets, and must lie inside one score3 bucket.
    const base: Situation = { phase: "scrimmage", down: 1, yardsToGo: 10, yardLine100: 50, scoreDiff: 0, quarter: 4, secondsLeftInHalf: 100, secondsLeftInGame: 100, offenseTimeouts: 1, defenseTimeouts: 1 };
    const of = (d: number): Record<string, string | null> => binSituation({ ...base, scoreDiff: d }, dims);
    for (let d = -40; d <= 40; d++) {
      for (let e = -40; e <= 40; e++) {
        const a = of(d);
        const b = of(e);
        // Same 5a late bucket implies the same scoreLate5 bucket: a 5a bucket never straddles.
        if (a["scoreLateOnly"] === b["scoreLateOnly"]) expect(b["scoreLate5Only"], `5a ${d} vs ${e}`).toBe(a["scoreLate5Only"]);
        // Same scoreLate5 bucket implies the same score3 bucket (it keeps the sign).
        if (a["scoreLate5Only"] === b["scoreLate5Only"]) expect(b["score3"], `score3 ${d} vs ${e}`).toBe(a["score3"]);
      }
    }
  });

  it("every score7 bucket edge that keeps the sign is a scoreLate5 edge or inside a 5a bucket", () => {
    const base: Situation = { phase: "scrimmage", down: 1, yardsToGo: 10, yardLine100: 50, scoreDiff: 0, quarter: 4, secondsLeftInHalf: 100, secondsLeftInGame: 100, offenseTimeouts: 1, defenseTimeouts: 1 };
    for (let d = -40; d < 40; d++) {
      const a = binSituation({ ...base, scoreDiff: d }, dims);
      const b = binSituation({ ...base, scoreDiff: d + 1 }, dims);
      if (a["scoreLate5Only"] !== b["scoreLate5Only"]) expect(a["scoreLateOnly"], `edge ${d}`).not.toBe(b["scoreLateOnly"]);
    }
  });
});

interface Trace {
  level: number;
  key: string;
  weights?: number[];
}
interface Frozen {
  situation: Situation;
  offense: { leaves: { call: string; twoPointPlay?: string; p: number }[]; trace: Record<string, Trace>; formations: Record<string, Trace> };
  defense: { presets: { call: string; p: number }[]; trace: Record<string, Trace> };
}

describe("outside the late windows nothing moves (B4)", () => {
  const frozen = readJson("test/fixtures/caller-golden-pre5b.json") as { situations: Frozen[] };
  const late = (s: Situation): boolean => s.phase === "scrimmage" && binSituation(s, dims)["lateTime"] !== "-";
  const LATE_FACTORS = new Set(["oTop", "o4Top"]);
  const v2o4Kick = (readJson("test/fixtures/caller-v2/offense.table.json") as { factors: { o4Kick: { levels: { dims: string[] }[] } } }).factors.o4Kick;
  // Step 5c's changed cells: o4Kick at the opp 36-50 (milestone B) and tries in a cell of the designed late chart (milestone C).
  const b5c = (s: Situation): boolean =>
    (s.phase === "scrimmage" && s.down === 4 && s.yardLine100 >= 36 && s.yardLine100 <= 50) || (s.phase === "try" && charted(s));
  const charted = (s: Situation): boolean => {
    const c = data.config.tryChart;
    const l = binSituation(s, dims);
    return c !== undefined && c.cells[`${l[c.window]}|${l[c.score]}`] !== undefined;
  };

  it("defense table cells are byte-identical to the pre-5b build", () => {
    const pre5b = "ee2897e62bb658add49b2cfef58c68354522b21ea6e1d1bf6000eed1f21a3f4d";
    const defense = readJson("data/caller/defense.table.json") as { factors: unknown };
    expect(createHash("sha256").update(JSON.stringify(defense.factors)).digest("hex")).toBe(pre5b);
  });

  it("every offense factor but oTop and o4Top has the same levels and cells as the real version-2 table", () => {
    const v2 = readJson("test/fixtures/caller-v2/offense.table.json") as { factors: Record<string, { levels: unknown; cells: unknown }> };
    expect(Object.keys(data.offense.factors).sort()).toEqual(Object.keys(v2.factors).sort());
    for (const [name, t] of Object.entries(v2.factors)) {
      if (LATE_FACTORS.has(name)) continue;
      const mine = (data.offense.factors as Readonly<Record<string, FactorTable | undefined>>)[name] as unknown as { levels: unknown[]; cells: unknown[] };
      if (name === "o4Kick") {
        // Amended 2026-11-12 (M1 step 5c milestone B): o4Kick gained zoneFG levels on purpose; every
        // version-2 level is still there, in the same order, with identical cells.
        const old = t as { levels: unknown[]; cells: unknown[] };
        const at = old.levels.map((lv) => mine.levels.findIndex((m) => JSON.stringify(m) === JSON.stringify(lv)));
        expect(at.every((i) => i >= 0), "every v2 o4Kick level kept").toBe(true);
        expect([...at].sort((a, b) => a - b), "same order").toEqual(at);
        at.forEach((i, j) => expect(mine.cells[i], `o4Kick level ${j}`).toEqual(old.cells[j]));
        continue;
      }
      expect([mine.levels, mine.cells], name).toEqual([t.levels, t.cells]);
    }
  });

  it("every frozen situation: identical defense, identical weights for every factor but oTop and o4Top, and identical offense outside the windows", () => {
    let outside = 0;
    let inside = 0;
    for (const g of frozen.situations) {
      const tag = JSON.stringify(g.situation);
      const d = defenseShares(g.situation, data);
      expect(d.presets.map((p) => p.p), `defense ${tag}`).toEqual(g.defense.presets.map((p) => p.p));
      for (const [name, t] of Object.entries(g.defense.trace)) expect([d.trace[name]?.level, d.trace[name]?.key], `${name} ${tag}`).toEqual([t.level, t.key]);
      const o = offenseShares(g.situation, data);
      // Amended 2026-11-12 (M1 step 5c milestones B and C; narrowed after code review the same day):
      // o4Kick's kick cells at the opp 36-50 were split at the opp 41 (zoneFG), and late tries follow the
      // designed chart, on purpose. In those situations (b5c) only the o4Kick and oTry traces and the
      // combined leaves are skipped; every other factor, the formations and the try play traces are compared.
      const changed = b5c(g.situation);
      for (const [name, t] of Object.entries(g.offense.trace)) {
        if (LATE_FACTORS.has(name)) continue;
        if (changed && (name === "o4Kick" || name === "oTry")) continue;
        // o4Kick's levels moved down when zoneFG levels were added before them (step 5c B): compare the level's dims.
        // Outside the opp 36-50 zoneFG labels equal zone6's, so a zoneFG level there is the same cell.
        const lv = name === "o4Kick" ? (i: number | undefined, tb: { levels: readonly { dims: readonly string[] }[] }): string => JSON.stringify(tb.levels[i ?? -1]?.dims.map((d) => (d === "zoneFG" ? "zone6" : d))) : null;
        if (lv !== null) expect([lv(o.trace[name]?.level, data.offense.factors.o4Kick as FactorTable), o.trace[name]?.key], `${name} ${tag}`).toEqual([lv(t.level, v2o4Kick), t.key]);
        else expect([o.trace[name]?.level, o.trace[name]?.key], `${name} ${tag}`).toEqual([t.level, t.key]);
        if (t.weights !== undefined) expect(o.trace[name]?.weights, `${name} ${tag}`).toEqual(t.weights);
      }
      for (const [play, t] of Object.entries(g.offense.formations)) {
        const f = formationShares(g.situation, play, data);
        expect([f.level, f.key, f.weights], `formation ${play} ${tag}`).toEqual([t.level, t.key, t.weights ?? f.weights]);
      }
      if (late(g.situation) || changed) {
        if (!changed) inside++;
        if (changed && !late(g.situation)) for (const name of LATE_FACTORS) {
          const t = g.offense.trace[name];
          if (t !== undefined) expect(o.trace[name]?.weights, `${name} ${tag}`).toEqual(t.weights);
        }
        continue;
      }
      outside++;
      expect(o.leaves.map((l) => [l.call, l.twoPointPlay ?? null, l.p]), `offense ${tag}`).toEqual(g.offense.leaves.map((l) => [l.call, l.twoPointPlay ?? null, l.p]));
      for (const name of LATE_FACTORS) {
        const t = g.offense.trace[name];
        if (t !== undefined) expect(o.trace[name]?.weights, `${name} ${tag}`).toEqual(t.weights);
      }
    }
    expect(outside).toBeGreaterThanOrEqual(100);
    expect(inside).toBeGreaterThan(0);
  });
});

describe("tables from another config version are refused (B5)", () => {
  it("v2 tables with the v3 config, and v3 tables with the v2 config, name both versions and hashes", () => {
    expect(data.config.version).toBe(3);
    const v2 = parseCallerTables(readJson("test/fixtures/caller-v2/offense.table.json"));
    const v2Config = withRulePlayClock(parseCallerConfig(readJson("test/fixtures/caller-v2/config.json")), readJson("data/rules/nfl-2026.json"));
    expect(v2.configVersion).toBe(2);
    expect(() => checkCallerTables(data.config, callerConfigHash(), [v2])).toThrow(/version 2 \(sha256 [0-9a-f]{64}\).*version 3 \(sha256/s);
    expect(() => checkCallerTables(v2Config, v2.configHash, [data.offense])).toThrow(/version 3 \(sha256 [0-9a-f]{64}\).*version 2 \(sha256/s);
    // The real v2 pair is consistent with itself.
    expect(() => checkCallerTables(v2Config, v2.configHash, [v2])).not.toThrow();
  });
});

describe("backoff on each new level lands on the specified parent (B7)", () => {
  // Routing: a situation whose cell is stored at a level is served there; with that cell
  // removed (the N-1 case, where the pipeline does not store it), it is served by the next
  // level of the chain that has its key. pytest covers the N-1 / N storage rule itself.
  // Amended 2026-11-12 (M1 step 5c milestone F): oTop gained a first level [down,kneelGap,scoreLate5,lateTime],
  // so every oTop index below moved up by one; the new level's own case is first.
  const cases: { factor: "oTop" | "o4Top"; situation: Situation; level: number; parent: number }[] = [
    // Leading by 4 with 1:30 left, 1st down, the defense holding 3 timeouts (can't kneel out, K0F): [down,kneelGap,scoreLate5,lateTime] -> [down,kneelOut,scoreLate5,lateTime].
    { factor: "oTop", situation: { phase: "scrimmage", down: 1, yardsToGo: 10, yardLine100: 60, scoreDiff: 4, quarter: 4, secondsLeftInHalf: 90, secondsLeftInGame: 90, offenseTimeouts: 1, defenseTimeouts: 3 }, level: 0, parent: 1 },
    // Leading by 4 in the final 2:00, 1st down, can kneel out: [down,kneelOut,scoreLate5,lateTime] -> [down,kneelOut,lateTime].
    { factor: "oTop", situation: { phase: "scrimmage", down: 1, yardsToGo: 10, yardLine100: 60, scoreDiff: 4, quarter: 4, secondsLeftInHalf: 90, secondsLeftInGame: 90, offenseTimeouts: 1, defenseTimeouts: 0 }, level: 1, parent: 2 },
    // [down,kneelOut,lateTime] -> the regulation chain's first level.
    { factor: "oTop", situation: { phase: "scrimmage", down: 1, yardsToGo: 10, yardLine100: 60, scoreDiff: 4, quarter: 4, secondsLeftInHalf: 90, secondsLeftInGame: 90, offenseTimeouts: 1, defenseTimeouts: 0 }, level: 2, parent: 3 },
    // Overtime, tied, 3rd down at the 30: [down,zoneK,scoreLate5,lateTime] -> [zoneK,scoreLate5,lateTime] -> [fieldHalf,scoreLate5,lateTime].
    { factor: "oTop", situation: { phase: "scrimmage", down: 3, yardsToGo: 5, yardLine100: 30, scoreDiff: 0, quarter: 5, secondsLeftInHalf: 400, secondsLeftInGame: 400, offenseTimeouts: 2, defenseTimeouts: 2 }, level: 6, parent: 7 },
    { factor: "oTop", situation: { phase: "scrimmage", down: 3, yardsToGo: 5, yardLine100: 30, scoreDiff: 0, quarter: 5, secondsLeftInHalf: 400, secondsLeftInGame: 400, offenseTimeouts: 2, defenseTimeouts: 2 }, level: 7, parent: 8 },
    // Overtime with no overtime cell backs off to the G5/GF cells (resolved question 2):
    // [fieldHalf,scoreLate5,lateTime] -> [down,zoneK,scoreLate5,lateClock].
    { factor: "oTop", situation: { phase: "scrimmage", down: 1, yardsToGo: 10, yardLine100: 60, scoreDiff: -3, quarter: 5, secondsLeftInHalf: 400, secondsLeftInGame: 400, offenseTimeouts: 2, defenseTimeouts: 2 }, level: 8, parent: 9 },
    { factor: "oTop", situation: { phase: "scrimmage", down: 1, yardsToGo: 10, yardLine100: 60, scoreDiff: -3, quarter: 5, secondsLeftInHalf: 400, secondsLeftInGame: 400, offenseTimeouts: 2, defenseTimeouts: 2 }, level: 9, parent: 10 },
    { factor: "o4Top", situation: { phase: "scrimmage", down: 4, yardsToGo: 3, yardLine100: 40, scoreDiff: -3, quarter: 5, secondsLeftInHalf: 300, secondsLeftInGame: 300, offenseTimeouts: 2, defenseTimeouts: 2 }, level: 13, parent: 14 },
    // o4Top, overtime, trailing 3 at the 40: late zoneK level -> its 2016-2023 twin -> fieldHalf.
    { factor: "o4Top", situation: { phase: "scrimmage", down: 4, yardsToGo: 3, yardLine100: 40, scoreDiff: -3, quarter: 5, secondsLeftInHalf: 300, secondsLeftInGame: 300, offenseTimeouts: 2, defenseTimeouts: 2 }, level: 10, parent: 11 },
    { factor: "o4Top", situation: { phase: "scrimmage", down: 4, yardsToGo: 3, yardLine100: 40, scoreDiff: -3, quarter: 5, secondsLeftInHalf: 300, secondsLeftInGame: 300, offenseTimeouts: 2, defenseTimeouts: 2 }, level: 11, parent: 12 },
    { factor: "o4Top", situation: { phase: "scrimmage", down: 4, yardsToGo: 3, yardLine100: 40, scoreDiff: -3, quarter: 5, secondsLeftInHalf: 300, secondsLeftInGame: 300, offenseTimeouts: 2, defenseTimeouts: 2 }, level: 12, parent: 13 },
  ];

  it.each(cases.map((c) => [`${c.factor} level ${c.level} -> ${c.parent}`, c] as const))("%s", (_n, c) => {
    const real = data.offense.factors[c.factor] as FactorTable;
    const labels = binSituation(c.situation, dims);
    const keyAt = (i: number): string | null => levelKey(real.levels[i] as FactorTable["levels"][number], labels);
    expect(keyAt(c.level), "the level applies").not.toBeNull();
    expect(keyAt(c.parent), "the parent applies").not.toBeNull();
    for (let i = c.level + 1; i < c.parent; i++) expect(keyAt(i), `level ${i} between them does not apply`).toBeNull();
    // A table with a cell only at `level` (the N case) and `parent`, or only at `parent` (N-1).
    const synth = (withLevel: boolean): FactorTable => ({
      ...real,
      cells: real.levels.map((_l, i) => (i === c.parent || (withLevel && i === c.level) ? { [keyAt(i) as string]: real.targets.map(() => 1) } : {})),
    });
    expect(lookup(synth(true), labels)?.level).toBe(c.level);
    expect(lookup(synth(false), labels)?.level).toBe(c.parent);
  });
});

describe("overtime falls back to the G5/GF cells (resolved question 2)", () => {
  it("every lateClock cell is the same cell as the lateTime level it mirrors, and holds no overtime key", () => {
    for (const name of ["oTop", "o4Top"] as const) {
      const t = data.offense.factors[name] as FactorTable;
      t.levels.forEach((l, i) => {
        if (!l.dims.includes("lateClock")) return;
        const mirror = t.levels.findIndex((m) => JSON.stringify(m.dims) === JSON.stringify(l.dims.map((d) => (d === "lateClock" ? "lateTime" : d))) && JSON.stringify(m.seasons) === JSON.stringify(l.seasons));
        expect(mirror, `${name} level ${i}`).toBeGreaterThanOrEqual(0);
        const mine = t.cells[i] ?? {};
        const theirs = Object.fromEntries(Object.entries(t.cells[mirror] ?? {}).filter(([k]) => !k.endsWith("|OT")));
        expect(mine, `${name} level ${i}`).toEqual(theirs);
      });
    }
  });

  it("an overtime 1st down trailing by 3 with no overtime cell is served by a G5 cell, not a score-free level", () => {
    const sit: Situation = { phase: "scrimmage", down: 1, yardsToGo: 10, yardLine100: 60, scoreDiff: -3, quarter: 5, secondsLeftInHalf: 400, secondsLeftInGame: 400, offenseTimeouts: 2, defenseTimeouts: 2 };
    const t = offenseShares(sit, data).trace["oTop"];
    const top = data.offense.factors["oTop"] as FactorTable;
    expect(top.levels[t?.level ?? -1]?.dims).toContain("scoreLate5Only");
    expect(t?.key.endsWith("|G5") || t?.key.endsWith("|OT")).toBe(true);
  });
});

describe("golden file covers the new levels (B8)", () => {
  const golden = readJson("data/caller/golden.json") as { configVersion: number; situations: Frozen[] };

  it("has at least 50 situations served by a new late level, covering OT, every scoreLate5 bucket and both kneel-out values", () => {
    const top = data.offense.factors["oTop"] as FactorTable;
    const four = data.offense.factors["o4Top"] as FactorTable;
    const isNew = (t: FactorTable, level: number): boolean => ["lateTime", "lateClock"].some((d) => (t.levels[level]?.dims ?? []).includes(d));
    const hits = golden.situations.filter((g) => {
      const a = g.offense.trace["oTop"];
      const b = g.offense.trace["o4Top"];
      return (a !== undefined && isNew(top, a.level)) || (b !== undefined && isNew(four, b.level));
    });
    expect(golden.configVersion).toBe(3);
    expect(hits.length).toBeGreaterThanOrEqual(50);
    const labels = hits.map((g) => binSituation(g.situation, dims));
    expect(labels.some((l) => l["lateTime"] === "OT")).toBe(true);
    for (const b of ["<=-9", "-8..-1", "0", "1..8", ">=9"]) expect(labels.some((l) => l["scoreLate5Only"] === b), b).toBe(true);
    for (const k of ["K0", "K1"]) expect(labels.some((l) => l["kneelOut"] === k), k).toBe(true);
  });
});
