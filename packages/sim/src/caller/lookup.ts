// Backoff lookup in a fitted factor table.

import type { FactorTable } from "../../../shared/src/types";
import { levelKey, type BinLabels, type LevelContext } from "./bins";

export interface Lookup {
  /** Index of the level whose cell was used. */
  readonly level: number;
  readonly key: string;
  /** The cell's integer weights with unavailable targets set to 0. */
  readonly weights: readonly number[];
  readonly total: number;
}

/**
 * Walks the factor's levels from finest to global and returns the first stored cell that
 * still has weight after masking. mask[i] false means target i is unavailable.
 * Returns null only when every level masks to nothing.
 */
export function lookup(
  table: FactorTable,
  labels: BinLabels,
  context: LevelContext = {},
  mask?: readonly boolean[],
): Lookup | null {
  for (let i = 0; i < table.levels.length; i++) {
    const level = table.levels[i];
    if (level === undefined) continue;
    const key = levelKey(level, labels, context);
    if (key === null) continue;
    const cell = table.cells[i]?.[key];
    if (cell === undefined) continue;
    const weights = cell.map((w, j) => (mask !== undefined && mask[j] === false ? 0 : w));
    const total = weights.reduce((a, b) => a + b, 0);
    if (total > 0) return { level: i, key, weights, total };
  }
  return null;
}

export function requireLookup(
  name: string,
  table: FactorTable | undefined,
  labels: BinLabels,
  context: LevelContext = {},
): Lookup {
  if (table === undefined) throw new RangeError(`missing factor table ${name}`);
  const found = lookup(table, labels, context);
  if (found === null) throw new RangeError(`factor ${name} has no usable cell`);
  return found;
}
