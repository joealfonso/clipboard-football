// Property tests written from docs/specs/m1-step2-call-menus-and-baseline-caller.md (and
// DECISIONS.md "Post-validation revision 1"), not from the implementation. They sweep
// situations drawn from the seeded Rng instead of a fixed list.
//
// Covers: D1 per call, D2 over a sweep, D3 golden coverage, D6 at the type level and at
// run time, kick availability (A5 / runtime masking), overtime binning, the designed
// preset table with Nickel Cover 2.

import { describe, expect, expectTypeOf, it } from "vitest";
import { SITUATION_FIELDS, type Situation } from "../../../shared/src/types";
import { indexCatalog } from "../../src/caller/availability";
import { binSituation } from "../../src/caller/bins";
import { chooseDefenseCall, chooseOffenseCall, defenseShares, formationShares, offenseShares, presetFor } from "../../src/caller/index";
import { Rng } from "../../src/rng";
import { loadCallerData, readJson } from "./load-data";

const data = loadCallerData();
const avail = indexCatalog(data.catalog);
const KICKS = ["punt", "fieldGoal"];
const RUN_PASS = ["insideRun", "outsideRun", "qbSneak", "shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"];

function int(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng.nextFloat() * (hi - lo + 1));
}
function pick<T>(rng: Rng, xs: readonly T[]): T {
  return xs[int(rng, 0, xs.length - 1)] as T;
}

/** A valid random situation. Clock values lean toward the end of each half. */
function randomSituation(rng: Rng, tryShare = 0.05): Situation {
  const quarter = pick(rng, [1, 2, 3, 4, 4, 5]);
  const firstOfHalf = quarter === 1 || quarter === 3;
  const half = firstOfHalf ? int(rng, 901, 1800) : pick(rng, [int(rng, 0, 900), int(rng, 0, 130), int(rng, 110, 130), int(rng, 0, 45)]);
  const game = quarter <= 2 ? half + 1800 : half;
  const yardLine100 = int(rng, 1, 99);
  const phase = rng.nextFloat() < tryShare ? "try" : "scrimmage";
  return {
    phase,
    down: int(rng, 1, 4),
    yardsToGo: int(rng, 1, Math.max(1, Math.min(yardLine100, 30))),
    yardLine100,
    scoreDiff: int(rng, -35, 35),
    quarter,
    secondsLeftInHalf: half,
    secondsLeftInGame: game,
    offenseTimeouts: int(rng, 0, 3),
    defenseTimeouts: int(rng, 0, 3),
    // Step 5d fields, from values already drawn (no extra draw, so the sampled situations are unchanged).
    clockRunning: phase === "try" ? 0 : half % 2,
    otBothPossessed: quarter === 5 ? game % 2 : 0,
  };
}

function sweep(n: number, seed: number, tryShare = 0.05): Situation[] {
  const rng = Rng.fromSeed(seed);
  return Array.from({ length: n }, () => randomSituation(rng, tryShare));
}

const kickAllowed = (s: Situation): boolean => s.phase === "scrimmage" && (s.down === 4 || s.secondsLeftInHalf <= 120);

describe("kick is never offered outside 4th down or the final 2:00 of a half", () => {
  const sits = sweep(4000, 101, 0.1);

  it("gives punt and field goal zero share, and the catalog marks Kick unavailable", () => {
    let checked = 0;
    for (const s of sits) {
      const leaves = offenseShares(s, data).leaves;
      const kickShare = leaves.filter((l) => KICKS.includes(l.call)).reduce((a, l) => a + l.p, 0);
      if (!kickAllowed(s)) {
        checked += 1;
        expect(kickShare, JSON.stringify(s)).toBe(0);
        expect(avail.isAvailable("kick", s)).toBe(false);
        for (const k of KICKS) expect(avail.isAvailable(k, s)).toBe(false);
      } else {
        expect(avail.isAvailable("kick", s)).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("never samples a punt or field goal there, over many draws", () => {
    const rng = Rng.fromSeed(202);
    const outside = sits.filter((s) => !kickAllowed(s));
    for (let i = 0; i < 20000; i++) {
      const s = outside[i % outside.length] as Situation;
      const o = chooseOffenseCall(s, data, rng);
      expect(KICKS).not.toContain(o.call);
      expect(KICKS).not.toContain(o.twoPointPlay ?? "");
    }
  });

  it("does offer a kick on 4th down and in the final 2:00 when the data has one", () => {
    // 4th and 8 from the opponent 30 and 3rd and 10 at the opponent 20 with 0:10 left in the half:
    // both are field goal situations in real data, so the share must be positive.
    const fourth = offenseShares({ ...sits[0]!, phase: "scrimmage", down: 4, yardsToGo: 8, yardLine100: 30, quarter: 1, secondsLeftInHalf: 1500, secondsLeftInGame: 3300, scoreDiff: 0 }, data);
    expect(fourth.leaves.filter((l) => KICKS.includes(l.call)).reduce((a, l) => a + l.p, 0)).toBeGreaterThan(0);
    const late = offenseShares({ ...sits[0]!, phase: "scrimmage", down: 3, yardsToGo: 10, yardLine100: 20, quarter: 2, secondsLeftInHalf: 10, secondsLeftInGame: 1810, scoreDiff: 0, offenseTimeouts: 0 }, data);
    expect(late.leaves.find((l) => l.call === "fieldGoal")?.p ?? 0).toBeGreaterThan(0);
  });

  it("on a try offers only Kick extra point or Go for two, then Run or Pass", () => {
    const rng = Rng.fromSeed(303);
    for (const s of sweep(300, 304, 1)) {
      for (const l of offenseShares(s, data).leaves) {
        if (l.call === "extraPoint") expect(l.twoPointPlay).toBeUndefined();
        else {
          expect(l.call).toBe("goForTwo");
          expect(RUN_PASS).toContain(l.twoPointPlay);
        }
      }
      const o = chooseOffenseCall(s, data, rng);
      expect(["extraPoint", "goForTwo"]).toContain(o.call);
      if (o.call === "extraPoint") expect(o.formation).toBeUndefined();
    }
  });
});

describe("same seed and inputs give the same call (D1, per call)", () => {
  it("holds for every situation in a sweep, and leaves the rng in the same state", () => {
    const sits = sweep(1500, 404);
    sits.forEach((s, i) => {
      const a = Rng.fromSeed(9000 + i);
      const b = Rng.fromSeed(9000 + i);
      expect(chooseOffenseCall(s, data, a)).toEqual(chooseOffenseCall(s, data, b));
      expect(chooseDefenseCall(s, data, a)).toBe(chooseDefenseCall(s, data, b));
      expect(a.getState()).toEqual(b.getState());
    });
  });

  it("share functions have no hidden state: repeated and interleaved calls agree", () => {
    const sits = sweep(300, 505);
    const first = sits.map((s) => [offenseShares(s, data).leaves, defenseShares(s, data).presets]);
    const rng = Rng.fromSeed(1);
    for (const s of sits) chooseOffenseCall(s, data, rng);
    expect(sits.map((s) => [offenseShares(s, data).leaves, defenseShares(s, data).presets])).toEqual(first);
  });
});

describe("share distributions over a sweep (D2)", () => {
  it("sum to 1 within 1e-9, have no negative share, and give unavailable calls nothing", () => {
    for (const s of sweep(3000, 606)) {
      const off = offenseShares(s, data).leaves;
      expect(Math.abs(off.reduce((a, l) => a + l.p, 0) - 1)).toBeLessThanOrEqual(1e-9);
      for (const l of off) {
        expect(l.p).toBeGreaterThanOrEqual(0);
        if (!avail.isAvailable(l.call, s)) expect(l.p, `${l.call} ${JSON.stringify(s)}`).toBe(0);
      }
      const def = defenseShares(s, data).presets;
      expect(def.map((p) => p.call)).toEqual(data.defense.factors.dTry?.targets);
      expect(Math.abs(def.reduce((a, p) => a + p.p, 0) - 1)).toBeLessThanOrEqual(1e-9);
      for (const p of def) expect(p.p).toBeGreaterThanOrEqual(0);
    }
  });

  it("formation shares exist for every run or pass play and sum to 10,000", () => {
    for (const s of sweep(300, 707)) {
      for (const play of RUN_PASS) {
        const f = formationShares(s, play, data);
        expect(f.weights.reduce((a, b) => a + b, 0)).toBe(10000);
      }
    }
  });
});

describe("overtime is binned as the second half", () => {
  // Amended by step 5b: overtime is its own late time state for the late oTop and o4Top levels
  // only (lateTime and the dimensions windowed on it, and the regulation-only copies time5R, time2R and scoreLateOnlyR). Every other label,
  // every other factor's lookup and the defense stay exactly as the 4th quarter with the same clock.
  // Amended 2026-11-12 (M1 step 5c milestone F): kneelGap is kneelOut with K0 split, windowed on lateTime the same way.
  // Amended 2026-11-13 (M1 step 5d milestone C): scoreTrail is scoreLate5Only's trailing buckets and
  // timeGF is lateClockAll's GF, both read the same way.
  const OT_AWARE = new Set(["lateTime", "scoreLate5Only", "kneelOut", "kneelGap", "lateClockAll", "lateClock", "time5x", "time5R", "time2R", "scoreLateOnlyR", "scoreTrail", "timeGF"]);
  it("an overtime situation gets the same labels and shares as the 4th quarter with the same clock", () => {
    for (const s of sweep(500, 808, 0.1)) {
      const secs = Math.min(s.secondsLeftInHalf, 600);
      const ot: Situation = { ...s, quarter: 5, secondsLeftInHalf: secs, secondsLeftInGame: secs };
      const q4: Situation = { ...ot, quarter: 4 };
      const strip = (l: Record<string, string | null>): Record<string, string | null> => Object.fromEntries(Object.entries(l).filter(([k]) => !OT_AWARE.has(k)));
      expect(strip(binSituation(ot, data.config.dimensions))).toEqual(strip(binSituation(q4, data.config.dimensions)));
      if (ot.phase === "scrimmage") expect(binSituation(ot, data.config.dimensions)["lateTime"]).toBe("OT");
      const a = offenseShares(ot, data);
      const b = offenseShares(q4, data);
      for (const name of Object.keys(b.trace)) {
        if (name === "oTop" || name === "o4Top") continue;
        expect([a.trace[name]?.level, a.trace[name]?.key, a.trace[name]?.weights], name).toEqual([b.trace[name]?.level, b.trace[name]?.key, b.trace[name]?.weights]);
      }
      if (ot.phase !== "scrimmage") expect(a.leaves).toEqual(b.leaves);
      expect(defenseShares(ot, data).presets).toEqual(defenseShares(q4, data).presets);
    }
  });
});

describe("the defense caller cannot receive offense call data (D6)", () => {
  it("takes a Situation whose fields are exactly the shared Situation fields", () => {
    type DefenseInput = Parameters<typeof chooseDefenseCall>[0];
    expectTypeOf<keyof DefenseInput>().toEqualTypeOf<(typeof SITUATION_FIELDS)[number]>();
    expectTypeOf<Parameters<typeof defenseShares>[0]>().toEqualTypeOf<Situation>();
    expectTypeOf<Parameters<typeof chooseDefenseCall>["length"]>().toEqualTypeOf<3>();
    for (const f of SITUATION_FIELDS) expect(f).not.toMatch(/call|play|formation|personnel|preset/i);
  });

  it("rejects an offense call at compile time", () => {
    const s = sweep(1, 909)[0] as Situation;
    const rng = Rng.fromSeed(1);
    // @ts-expect-error the defense caller has no parameter for the offense's call
    chooseDefenseCall(s, data, rng, { call: "deepPass", formation: "empty" });
    // @ts-expect-error a Situation cannot carry the offense's call
    defenseShares({ ...s, offenseCall: "deepPass" }, data);
    // @ts-expect-error a Situation cannot carry the offense's formation
    chooseDefenseCall({ ...s, formation: "empty" }, data, rng);
    expect(true).toBe(true);
  });

  it("ignores offense data smuggled in at run time", () => {
    for (const [i, s] of sweep(300, 910).entries()) {
      const smuggled = { ...s, offenseCall: "deepPass", call: "deepPass", formation: "empty", offensePersonnel: "10" } as unknown as Situation;
      expect(defenseShares(smuggled, data).presets).toEqual(defenseShares(s, data).presets);
      expect(chooseDefenseCall(smuggled, data, Rng.fromSeed(i))).toBe(chooseDefenseCall(s, data, Rng.fromSeed(i)));
    }
  });
});

describe("designed preset table, with the resolved preset set and Nickel Cover 2", () => {
  const map = data.config.defenseMapping;
  const covers = (shell: string, rush: "le4" | "ge5"): string[] => [`${shell}.man.${rush}`, `${shell}.zone.${rush}`];
  // [front, shell, rush, expected]. Spec table, then resolved question 1 (no Base Cover 1, a
  // 4-man Nickel Cover 1) and revision 1 (Nickel Cover 2; Dime Cover 2 still Dime Cover 4).
  const cases: [string, string, "le4" | "ge5", string][] = [
    ["front.baseLight", "cover0", "le4", "runStuff"],
    ["front.baseHeavy", "cover1", "le4", "runStuff"],
    // Base Cover 1 was dropped; DECISIONS.md "Defensive preset set" sends a light-box base
    // Cover 1 to Run Stuff and a dime Cover 1 to Nickel Cover 1 or Blitz by rush.
    ["front.baseLight", "cover1", "le4", "runStuff"],
    ["front.dimeLight", "cover1", "le4", "nickelCover1"],
    ["front.baseLight", "cover2", "le4", "baseCover2"],
    ["front.baseHeavy", "cover2", "ge5", "baseCover2"],
    ["front.baseLight", "twoMan", "le4", "baseCover2"],
    ["front.baseLight", "cover3", "le4", "baseCover3"],
    ["front.baseLight", "cover3", "ge5", "baseCover3"],
    ["front.baseHeavy", "cover3", "le4", "runStuff"],
    ["front.baseLight", "cover4", "le4", "baseCover2"],
    ["front.nickelLight", "cover0", "ge5", "dimeCover0Blitz"],
    ["front.nickelLight", "cover1", "le4", "nickelCover1"],
    ["front.nickelHeavy", "cover1", "le4", "nickelCover1"],
    ["front.nickelLight", "cover1", "ge5", "nickelCover1Blitz"],
    ["front.nickelLight", "cover2", "le4", "nickelCover2"],
    ["front.nickelHeavy", "cover2", "le4", "nickelCover2"],
    ["front.nickelLight", "twoMan", "le4", "nickel2Man"],
    ["front.nickelLight", "cover3", "le4", "nickelCover3"],
    ["front.nickelHeavy", "cover3", "le4", "nickelCover3"],
    ["front.nickelLight", "cover4", "le4", "nickelCover4"],
    ["front.dimeLight", "cover0", "ge5", "dimeCover0Blitz"],
    ["front.dimeLight", "cover1", "ge5", "nickelCover1Blitz"],
    ["front.dimeLight", "cover2", "le4", "dimeCover4"],
    ["front.dimeHeavy", "cover2", "le4", "dimeCover4"],
    ["front.dimeLight", "twoMan", "le4", "nickel2Man"],
    ["front.dimeLight", "cover3", "le4", "nickelCover3"],
    ["front.dimeLight", "cover4", "le4", "dimeCover4"],
    // Goal Line first, then Prevent by personnel or shell.
    ["front.goalLine", "prevent", "le4", "goalLine"],
    ["front.goalLine", "cover0", "ge5", "goalLine"],
    ["front.prevent", "cover1", "ge5", "prevent"],
    ["front.nickelLight", "prevent", "le4", "prevent"],
    ["front.baseLight", "prevent", "le4", "prevent"],
  ];
  it.each(cases)("%s + %s (%s rush) -> %s, for man and zone alike", (front, shell, rush, preset) => {
    for (const c of covers(shell, rush)) expect(presetFor(front, c, map), c).toBe(preset);
  });

  it("every front and coverage target maps to one of the 13 presets", () => {
    const presets = new Set(data.defense.factors.dTry?.targets);
    expect(presets.size).toBe(13);
    expect(presets.has("baseCover1")).toBe(false);
    for (const front of data.defense.factors.dFront?.targets ?? []) {
      for (const cov of data.defense.factors.dCoverage?.targets ?? []) expect(presets.has(presetFor(front, cov, map))).toBe(true);
    }
  });
});

describe("golden file coverage (D3)", () => {
  interface TraceEntry {
    level: number;
    key: string;
  }
  interface GoldenEntry {
    situation: Situation;
    offense: { trace: Record<string, TraceEntry>; formations: Record<string, TraceEntry> };
    defense: { trace: Record<string, TraceEntry> };
  }
  const golden = readJson("data/caller/golden.json") as { situations: GoldenEntry[] };

  function levelsOf(entries: { off: Record<string, TraceEntry>; form: TraceEntry[]; def: Record<string, TraceEntry> }[]): Map<string, Set<number>> {
    const out = new Map<string, Set<number>>();
    const add = (k: string, l: number) => {
      const set = out.get(k) ?? new Set<number>();
      set.add(l);
      out.set(k, set);
    };
    for (const e of entries) {
      for (const [k, t] of Object.entries(e.off)) add(k, t.level);
      for (const t of e.form) add("oFormation", t.level);
      for (const [k, t] of Object.entries(e.def)) add(k.split(":")[0] as string, t.level);
    }
    return out;
  }

  it("covers every backoff level the caller reaches over a broad sweep", () => {
    const reached = levelsOf(
      sweep(30000, 1111, 0.05).map((s) => ({
        off: offenseShares(s, data).trace,
        form: RUN_PASS.map((p) => formationShares(s, p, data)),
        def: defenseShares(s, data).trace,
      })),
    );
    const inGolden = levelsOf(golden.situations.map((g) => ({ off: g.offense.trace, form: Object.values(g.offense.formations), def: g.defense.trace })));
    const missing: string[] = [];
    for (const [factor, levels] of reached) {
      for (const l of levels) if (!(inGolden.get(factor)?.has(l) ?? false)) missing.push(`${factor}@${l}`);
    }
    expect(missing).toEqual([]);
  }, 30_000);

  it("includes masked situations, where availability zeroes weight the stored cell has", () => {
    // Masking past a stored cell entirely does not happen with the real tables (every
    // down-only cell has run and pass); D5 covers that path with fixture tables.
    const masked = golden.situations.filter((g) => {
      if (g.situation.phase !== "scrimmage" || kickAllowed(g.situation)) return false;
      const fid = g.offense.trace["oTop"] !== undefined ? "oTop" : "o4Top";
      const t = g.offense.trace[fid] as (TraceEntry & { weights?: number[] }) | undefined;
      const stored = data.offense.factors[fid]?.cells[t?.level ?? -1]?.[t?.key ?? ""];
      return t?.weights !== undefined && stored !== undefined && stored.some((w, i) => w > 0 && t.weights?.[i] === 0);
    });
    expect(masked.length).toBeGreaterThan(0);
  });
});
