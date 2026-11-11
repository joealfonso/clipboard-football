// SplitMix64 (Vigna, https://prng.di.unimi.it/splitmix64.c), used only to expand a
// seed into xoshiro128** state, as the xoshiro authors recommend. BigInt is fine here
// because it runs once per seed, never per draw.

const MASK64 = (1n << 64n) - 1n;
const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n;

export class SplitMix64 {
  private x: bigint;

  constructor(seed: bigint) {
    this.x = BigInt.asUintN(64, seed);
  }

  next(): bigint {
    this.x = (this.x + GOLDEN_GAMMA) & MASK64;
    let z = this.x;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return z ^ (z >> 31n);
  }
}
