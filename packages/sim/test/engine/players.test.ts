// A4, A5, A6: the measurement mapping, the team generator and its distributions.

import { describe, expect, it } from "vitest";
import { BASE_RATINGS, POSITION_SKILLS, POSITIONS, type Position, type TeamPool } from "../../../shared/src/engine";
import { generateTeam, onField, ratingFromMeasurements, ratingOf } from "../../src/engine/players";
import { Rng } from "../../src/rng";
import { loadEngineData } from "../support/engine-data";

const data = loadEngineData();

describe("measurement mapping (A4)", () => {
  const positions = Object.keys(data.distributions.drills) as Position[];

  it.each(positions)("%s: a faster 40 never gives lower Speed, more bench reps never lower Strength", (pos) => {
    const forty = data.distributions.drills[pos]?.["forty"];
    if (forty !== undefined) {
      const lo = forty.cuts[0] as number;
      const hi = forty.cuts[forty.cuts.length - 1] as number;
      let prev = Number.POSITIVE_INFINITY;
      for (let t = lo - 0.1; t <= hi + 0.1; t += 0.01) {
        const r = ratingFromMeasurements(data.ratings, data.distributions, pos, "speed", { forty: t }) as number;
        expect(r).toBeLessThanOrEqual(prev);
        prev = r;
      }
    }
    const bench = data.distributions.drills[pos]?.["bench"];
    if (bench !== undefined) {
      let prev = Number.NEGATIVE_INFINITY;
      for (let reps = 0; reps <= 50; reps++) {
        const r = ratingFromMeasurements(data.ratings, data.distributions, pos, "strength", { bench: reps, wt: 250 }) as number;
        expect(r).toBeGreaterThanOrEqual(prev);
        prev = r;
      }
    }
  });

  it("a rating with no usable drill is null (designed for that position)", () => {
    expect(ratingFromMeasurements(data.ratings, data.distributions, "QB", "awareness", { forty: 4.5 })).toBeNull();
  });
});

describe("generateTeam (A5)", () => {
  it("same seed gives deep-equal teams; different seeds differ", () => {
    const a = generateTeam(Rng.fromSeed(9), data, "A");
    const b = generateTeam(Rng.fromSeed(9), data, "A");
    const c = generateTeam(Rng.fromSeed(10), data, "A");
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("fills every slot of every formation, package and kick unit; every rating an integer 0-99", () => {
    const t = generateTeam(Rng.fromSeed(3), data, "T");
    const units = [...Object.entries(data.personnel.offense), ...Object.entries(data.personnel.kick), ...Object.entries(data.personnel.packages)];
    for (const [name, slots] of units) expect(() => onField(t, slots, name)).not.toThrow();
    for (const p of t.players) {
      for (const r of [...BASE_RATINGS, ...POSITION_SKILLS[p.position]]) {
        const v = ratingOf(p, r);
        expect(Number.isInteger(v) && v >= 0 && v <= 99, `${p.id} ${r} ${v}`).toBe(true);
      }
    }
  });
});

describe("generated distributions (A6)", () => {
  it("over 10,000 teams, each rating's per-position mean and p10/p50/p90 match distributions.json within 1 point", () => {
    const rng = Rng.fromSeed(77);
    const values: Record<string, number[]> = {};
    for (let i = 0; i < 10_000; i++) {
      const t: TeamPool = generateTeam(rng, data, "G");
      for (const p of t.players) {
        for (const r of [...BASE_RATINGS, ...POSITION_SKILLS[p.position]]) (values[`${p.position}.${r}`] ??= []).push(ratingOf(p, r));
      }
    }
    const q = (xs: number[], p: number): number => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] as number;
    for (const pos of POSITIONS) {
      for (const r of [...BASE_RATINGS, ...POSITION_SKILLS[pos]]) {
        const xs = (values[`${pos}.${r}`] ?? []).sort((a, b) => a - b);
        const d = data.distributions.ratings[pos]?.[r];
        expect(d, `${pos}.${r}`).toBeDefined();
        if (d === undefined) continue;
        const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
        expect(Math.abs(mean - d.mean), `${pos}.${r} mean`).toBeLessThanOrEqual(1);
        expect(Math.abs(q(xs, 0.1) - d.p10), `${pos}.${r} p10`).toBeLessThanOrEqual(1);
        expect(Math.abs(q(xs, 0.5) - d.p50), `${pos}.${r} p50`).toBeLessThanOrEqual(1);
        expect(Math.abs(q(xs, 0.9) - d.p90), `${pos}.${r} p90`).toBeLessThanOrEqual(1);
      }
    }
  }, 120_000);
});
