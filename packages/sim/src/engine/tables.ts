// Backoff lookups and weighted draws over the engine's generated tables.

import type { Level } from "../../../shared/src/types";
import type { Weighted } from "../../../shared/src/engine";
import { levelKey, type BinLabels, type LevelContext } from "../caller/bins";
import type { Rng } from "../rng";
import { fail } from "./errors";

export interface Found<T> {
  readonly level: number;
  readonly key: string;
  readonly value: T;
}

/** First stored entry from the finest level to the coarsest. */
export function backoff<T>(
  levels: readonly Level[],
  maps: readonly Readonly<Record<string, T>>[],
  labels: BinLabels,
  context: LevelContext,
  what: string,
): Found<T> {
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i] as Level;
    const key = levelKey(level, labels, context);
    if (key === null) continue;
    const v = maps[i]?.[key];
    if (v !== undefined) return { level: i, key, value: v };
  }
  return fail("noCell", `no ${what} cell for ${JSON.stringify(context)}`);
}

/** Cumulative weights of a flat tuple array (`stride` numbers per tuple, weight last), cached. */
const cumCache = new WeakMap<readonly number[], Float64Array>();
function cumulative(flat: readonly number[], stride: number): Float64Array {
  let c = cumCache.get(flat);
  if (c === undefined) {
    const n = flat.length / stride;
    c = new Float64Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += flat[i * stride + stride - 1] as number;
      c[i] = acc;
    }
    cumCache.set(flat, c);
  }
  return c;
}

/** Index of the tuple one draw lands on. Weights are positive integers. */
export function drawTuple(flat: readonly number[], stride: number, rng: Rng): number {
  const c = cumulative(flat, stride);
  const n = c.length;
  if (n === 0) fail("noCell", "empty pool");
  const u = rng.nextFloat() * (c[n - 1] as number);
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (u < (c[mid] as number)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function drawWeighted(xs: readonly Weighted[], rng: Rng): number {
  let total = 0;
  for (const x of xs) total += x.w;
  const u = rng.nextFloat() * total;
  let acc = 0;
  for (const x of xs) {
    acc += x.w;
    if (u < acc) return x.value;
  }
  const last = xs[xs.length - 1];
  if (last === undefined) fail("noCell", "empty weighted list");
  return last.value;
}

/** Index into weights (floats or integers, any total). Zero weights are never returned. */
export function drawIndex(weights: ArrayLike<number>, rng: Rng): number {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i] as number;
  if (!(total > 0)) fail("noCell", "all-zero distribution");
  const u = rng.nextFloat() * total;
  let acc = 0;
  let last = -1;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] as number;
    if (w <= 0) continue;
    acc += w;
    last = i;
    if (u < acc) return i;
  }
  return last;
}
