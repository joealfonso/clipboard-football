import { describe, expect, it } from "vitest";
import { Rng, uint32ToUnitFloat } from "../src/index";

function draws(rng: Rng, n: number): number[] {
  return Array.from({ length: n }, () => rng.nextUint32());
}

describe("seeding", () => {
  it("gives identical sequences for the same seed over 10,000 draws", () => {
    const a = Rng.fromSeed(20261111);
    const b = Rng.fromSeed(20261111);
    for (let i = 0; i < 10_000; i++) {
      expect(a.nextUint32()).toBe(b.nextUint32());
    }
  });

  it.each([
    [1, 2],
    [0, 1], // differ in one bit
    [0x7fff_ffff, 0x7fff_fffe], // differ in one bit
    [2 ** 52, 2 ** 52 + 2 ** 40], // differ in one high bit
  ])("gives different first 16 outputs for seeds %d and %d", (s1, s2) => {
    expect(draws(Rng.fromSeed(s1), 16)).not.toEqual(draws(Rng.fromSeed(s2), 16));
  });

  it.each([-1, 1.5, Number.NaN, 2 ** 53])("rejects seed %d", (seed) => {
    expect(() => Rng.fromSeed(seed)).toThrow(RangeError);
  });
});

describe("float draws", () => {
  it("stay in [0, 1) over 1,000,000 draws", () => {
    const rng = Rng.fromSeed(7);
    let bad = 0;
    for (let i = 0; i < 1_000_000; i++) {
      const x = rng.nextFloat();
      if (!(x >= 0 && x < 1)) bad++;
    }
    expect(bad).toBe(0);
  });

  it("maps the extreme uint32 values inside [0, 1)", () => {
    expect(uint32ToUnitFloat(0)).toBe(0);
    expect(uint32ToUnitFloat(0xffffffff)).toBeLessThan(1);
  });

  it("fills 10 equal bins within 10% plus or minus 0.5 points over 1,000,000 draws", () => {
    const rng = Rng.fromSeed(12345);
    const n = 1_000_000;
    const bins = new Array<number>(10).fill(0);
    for (let i = 0; i < n; i++) {
      const bin = Math.floor(rng.nextFloat() * 10);
      bins[bin] = (bins[bin] ?? 0) + 1;
    }
    for (const count of bins) {
      expect(Math.abs(count / n - 0.1)).toBeLessThanOrEqual(0.005);
    }
  });
});

describe("fork", () => {
  it("gives a child whose first 1,000 outputs differ from the parent's next 1,000", () => {
    const parent = Rng.fromSeed(99);
    const child = parent.fork();
    const childOut = draws(child, 1000);
    const parentOut = draws(parent, 1000);
    const parentSet = new Set(parentOut);
    expect(childOut.filter((x, i) => x === parentOut[i])).toEqual([]);
    expect(childOut.filter((x) => parentSet.has(x))).toEqual([]);
  });

  it("is deterministic for the same parent state", () => {
    const p1 = Rng.fromSeed(5);
    const p2 = Rng.fromSeed(5);
    draws(p1, 37);
    draws(p2, 37);
    expect(draws(p1.fork(), 1000)).toEqual(draws(p2.fork(), 1000));
    expect(p1.getState()).toEqual(p2.getState());
  });

  it("gives distinct children on successive forks", () => {
    const parent = Rng.fromSeed(5);
    const a = parent.fork();
    const b = parent.fork();
    expect(draws(a, 16)).not.toEqual(draws(b, 16));
  });

  it("does not change the parent's sequence when the child draws", () => {
    const p1 = Rng.fromSeed(11);
    const p2 = Rng.fromSeed(11);
    const c1 = p1.fork();
    p2.fork();
    draws(c1, 500);
    expect(draws(p1, 1000)).toEqual(draws(p2, 1000));
  });
});

describe("save and restore", () => {
  it("continues identically from a restored mid-sequence state", () => {
    const rng = Rng.fromSeed(2024);
    draws(rng, 500);
    const saved = rng.getState();
    const original = draws(rng, 1000);
    const restored = Rng.fromState(saved);
    expect(draws(restored, 1000)).toEqual(original);
  });

  it("returns a copy, so later draws do not change a saved state", () => {
    const rng = Rng.fromSeed(1);
    const saved = rng.getState();
    const copy = [...saved];
    draws(rng, 10);
    expect(saved).toEqual(copy);
  });

  it.each([
    [[0, 0, 0, 0]],
    [[1, 2, 3, -1]],
    [[1, 2, 3, 2 ** 32]],
    [[1, 2, 3, 0.5]],
    [[1, 2, 3]],
    [[1, 2, 3, 4, 5]],
    [[]],
    ["1,2,3,4"],
    [null],
    [{ 0: 1, 1: 2, 2: 3, 3: 4, length: 4 }],
  ])("rejects invalid state %j", (state) => {
    expect(() => Rng.fromState(state as unknown as [number, number, number, number])).toThrow(
      RangeError,
    );
  });
});
