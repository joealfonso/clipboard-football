// Sampling from a distribution with the seeded RNG. One draw per call.

import type { Rng } from "../rng";

/**
 * Walks the weights in order and returns the index the draw lands in. Works for integer
 * weights and for float shares; zero weights are never returned.
 */
export function sampleIndex(weights: readonly number[], rng: Rng): number {
  let total = 0;
  for (const w of weights) {
    if (!(w >= 0) || !Number.isFinite(w)) throw new RangeError(`bad weight ${w}`);
    total += w;
  }
  if (!(total > 0)) throw new RangeError("cannot sample from an all-zero distribution");
  const u = rng.nextFloat() * total;
  let acc = 0;
  let last = -1;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] ?? 0;
    if (w <= 0) continue;
    acc += w;
    last = i;
    if (u < acc) return i;
  }
  // Float rounding can leave u a hair above the running sum; the last positive weight wins.
  return last;
}
