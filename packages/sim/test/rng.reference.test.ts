// Known-answer tests against published output of the authors' reference code.
//
// xoshiro128** and jump vectors: rand_xoshiro (rust-random/rngs), whose tests state the
// values were produced with the reference implementation v1.1,
// https://prng.di.unimi.it/xoshiro128starstar.c
// Source of the vectors:
// https://github.com/rust-random/rngs/blob/master/rand_xoshiro/src/xoshiro128starstar.rs
// (tests `reference` and `test_jump`). Those tests seed from bytes
// [1,0,0,0, 2,0,0,0, 3,0,0,0, 4,0,0,0], which is the state words [1, 2, 3, 4].
//
// SplitMix64 vectors: same crate, produced with https://prng.di.unimi.it/splitmix64.c,
// https://github.com/rust-random/rngs/blob/master/rand_xoshiro/src/splitmix64.rs
// (test `reference`, first 10 of its 50 values).

import { describe, expect, it } from "vitest";
import { Rng } from "../src/index";
import { SplitMix64 } from "../src/splitmix64";

describe("xoshiro128** reference output", () => {
  it("matches the first 10 outputs from state [1, 2, 3, 4]", () => {
    const rng = Rng.fromState([1, 2, 3, 4]);
    const expected = [
      11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849, 3729100597,
      4258142804,
    ];
    expect(Array.from({ length: 10 }, () => rng.nextUint32())).toEqual(expected);
  });

  it("matches the reference jump() from state [1, 2, 3, 4]", () => {
    const rng = Rng.fromState([1, 2, 3, 4]);
    rng.jump();
    expect(rng.getState()).toEqual([2843103750, 2038079848, 1533207345, 44816753]);
  });
});

describe("SplitMix64 reference output", () => {
  it("matches the first 10 outputs for seed 1477776061723855037", () => {
    const sm = new SplitMix64(1477776061723855037n);
    const expected = [
      1985237415132408290n,
      2979275885539914483n,
      13511426838097143398n,
      8488337342461049707n,
      15141737807933549159n,
      17093170987380407015n,
      16389528042912955399n,
      13177319091862933652n,
      10841969400225389492n,
      17094824097954834098n,
    ];
    expect(Array.from({ length: 10 }, () => sm.next())).toEqual(expected);
  });
});
