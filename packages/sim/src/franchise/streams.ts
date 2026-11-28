// Every random choice in a franchise comes from a generator derived from the franchise seed
// (Locked 1). A stream's seed is a pure function of the franchise seed, the stream's id and up to
// two counters already in the state, so no generator state is ever stored.

import { Rng } from "../rng";

/** Stream ids. Never renumber one: a franchise is replayed from its seed. */
export const STREAMS = {
  league: 1,
  pool: 2,
  draftOrder: 3,
  // 4 was draftAi (noise redrawn each pick), retired on 2026-11-24. Never reuse it.
  numbers: 5,
  draftProfile: 6,
  draftEvaluation: 7,
} as const;

/** The 32-bit finalizer of MurmurHash3 (Appleby, public domain): every input bit reaches every output bit. */
function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Whether `seed` can seed a franchise: a non-negative safe integer, as Rng.fromSeed needs. */
export function validSeed(seed: unknown): seed is number {
  return typeof seed === "number" && Number.isSafeInteger(seed) && seed >= 0;
}

/**
 * A non-negative safe integer from the franchise seed and the stream's coordinates. Two hash
 * chains with different starts give 53 bits; Rng.fromSeed then expands it with SplitMix64.
 */
export function streamSeed(seed: number, stream: number, a = 0, b = 0): number {
  const words = [seed >>> 0, Math.floor(seed / 4294967296) >>> 0, stream >>> 0, a >>> 0, b >>> 0];
  let lo = 0x9e3779b9;
  let hi = 0x85ebca77;
  for (const w of words) {
    lo = fmix(lo ^ w);
    hi = fmix(Math.imul(hi, 31) + w + 0x165667b1);
  }
  return (hi & 0x1fffff) * 4294967296 + lo;
}

export function stream(seed: number, id: number, a = 0, b = 0): Rng {
  return Rng.fromSeed(streamSeed(seed, id, a, b));
}

/**
 * The same kind of stream for the many short ones (a misreading per team and player): the state
 * words come straight from the hash, since Rng.fromSeed's BigInt expansion costs more than the draws.
 */
export function shortStream(seed: number, id: number, a: number, b: number): Rng {
  const s = streamSeed(seed, id, a, b);
  const lo = s >>> 0;
  const hi = Math.floor(s / 4294967296) >>> 0;
  return Rng.fromState([lo, fmix(hi ^ 0x9e3779b9), fmix(lo ^ 0x85ebca77) || 1, fmix(hi ^ lo)]);
}

/** A 32-bit key for an id, so a stream can be named by a player. */
export function idKey(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return h;
}

/** A uniform index below n. */
export function below(rng: Rng, n: number): number {
  return Math.floor(rng.nextFloat() * n);
}

/** A new array in a seeded order (Fisher-Yates). */
export function shuffled<T>(xs: readonly T[], rng: Rng): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = below(rng, i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
