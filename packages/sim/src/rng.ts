// xoshiro128** 1.1 (Blackman and Vigna, https://prng.di.unimi.it/xoshiro128starstar.c).
// Chosen over PCG32 because it needs only 32-bit integer math, which JS does natively
// with Math.imul, and it has a published jump() for independent streams.

import { SplitMix64 } from "./splitmix64";

/** Four uint32 words. Never all zero. */
export type RngState = readonly [number, number, number, number];

const TWO_POW_32 = 4294967296;

// Jump polynomial for 2^64 steps, from the reference implementation.
const JUMP = [0x8764000b, 0xf542d2d3, 0x6fa035c3, 0x77f2db5b] as const;

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/** Maps a uint32 to [0, 1). The largest input, 0xFFFFFFFF, maps to 1 - 2^-32. */
export function uint32ToUnitFloat(x: number): number {
  return x / TWO_POW_32;
}

function assertUint32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= TWO_POW_32) {
    throw new RangeError(`${label} must be a uint32, got ${value}`);
  }
}

export class Rng {
  // Words are kept as int32 between draws; getState converts back to uint32.
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  private constructor(state: RngState) {
    this.s0 = state[0] | 0;
    this.s1 = state[1] | 0;
    this.s2 = state[2] | 0;
    this.s3 = state[3] | 0;
  }

  /**
   * Builds a generator from a game seed. The seed is a non-negative safe integer so it
   * can be logged and typed back in exactly.
   */
  static fromSeed(seed: number): Rng {
    if (!Number.isSafeInteger(seed) || seed < 0) {
      throw new RangeError(`seed must be a non-negative safe integer, got ${seed}`);
    }
    const sm = new SplitMix64(BigInt(seed));
    const a = sm.next();
    const b = sm.next();
    // SplitMix64's output step is a bijection, so two consecutive outputs cannot both
    // be zero: the state is never all zero.
    return new Rng([
      Number(a & 0xffffffffn),
      Number(a >> 32n),
      Number(b & 0xffffffffn),
      Number(b >> 32n),
    ]);
  }

  /** Restores a generator saved with getState. */
  static fromState(state: RngState): Rng {
    // A saved state from elsewhere (a save file) may not match the type, so check shape.
    if (!Array.isArray(state) || state.length !== 4) {
      throw new RangeError("state must be an array of four uint32 words");
    }
    state.forEach((word, i) => assertUint32(word, `state[${i}]`));
    if (state.every((word) => word === 0)) {
      throw new RangeError("state must not be all zero");
    }
    return new Rng(state);
  }

  getState(): RngState {
    return [this.s0 >>> 0, this.s1 >>> 0, this.s2 >>> 0, this.s3 >>> 0];
  }

  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = this.s1 << 9;

    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);

    return result;
  }

  /** Uniform in [0, 1). */
  nextFloat(): number {
    return uint32ToUnitFloat(this.nextUint32());
  }

  /**
   * Returns a child that continues this generator's sequence from here, and moves this
   * generator 2^64 draws ahead. The two streams cannot overlap for 2^64 draws, and
   * successive forks give distinct children.
   */
  fork(): Rng {
    const child = new Rng(this.getState());
    this.jump();
    return child;
  }

  /** Equivalent to 2^64 calls to nextUint32. */
  jump(): void {
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    for (const word of JUMP) {
      for (let b = 0; b < 32; b++) {
        if ((word >>> b) & 1) {
          s0 ^= this.s0;
          s1 ^= this.s1;
          s2 ^= this.s2;
          s3 ^= this.s3;
        }
        this.nextUint32();
      }
    }
    this.s0 = s0;
    this.s1 = s1;
    this.s2 = s2;
    this.s3 = s3;
  }
}
