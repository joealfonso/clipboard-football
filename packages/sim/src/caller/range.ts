// The engine's base field-goal make chance from a spot, shared by the engine (resolvePlay) and the
// caller's make-chance mask (M1 step 5c milestone B, Resolved 3). The zero comes from the step 4
// designed rule in data/engine/baseline.special.json `fieldGoals`: the fitted curve is capped at
// `capAt` and falls linearly to 0 at `maxDistance`. This module has no limit of its own.

/** The data values the make chance reads: the engine's field-goal table and the end zone depth. */
export interface FieldGoalRange {
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly makePer10000: readonly number[];
  readonly kickDepth: number;
  readonly endZoneYards: number;
}

/** Kick distance from a snap at `yardLine100` (yards to the goal), as the engine kicks it. */
export function fieldGoalDistance(yardLine100: number, r: FieldGoalRange): number {
  const spot = 100 - yardLine100;
  const kickSpot = Math.max(1, spot - r.kickDepth);
  return 100 - kickSpot + r.endZoneYards;
}

/** Make probability among unblocked kicks at `distance`, before any rating effect. */
export function makeChanceAt(distance: number, r: FieldGoalRange): number {
  if (distance > r.maxDistance) return 0;
  const di = Math.min(r.maxDistance, Math.max(r.minDistance, distance)) - r.minDistance;
  return (r.makePer10000[di] as number) / 10000;
}

export function fieldGoalMakeChance(yardLine100: number, r: FieldGoalRange): number {
  return makeChanceAt(fieldGoalDistance(yardLine100, r), r);
}
