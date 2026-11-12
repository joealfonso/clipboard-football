// The coordinate frame and the arithmetic every rule shares. These are not rule values: the
// frame is fixed by docs/DECISIONS.md ("Coordinate frame"), and "half" in half-the-distance
// is the meaning of the word. A grep test allows numeric literals only here.

import type { RuleSet } from "../../../shared/src/types";
import type { Team } from "./types";

/** Goal line to goal line. Spots run 0 (own goal) to FIELD_LENGTH (opponent's goal). */
export const FIELD_LENGTH = 100;
const HALF_DIVISOR = 2;

export function other(team: Team): Team {
  return team === "home" ? "away" : "home";
}

/** The same yard line seen from the other team. */
export function flip(spot: number): number {
  return FIELD_LENGTH - spot;
}

/** Whole yards moved by a half-the-distance penalty from `yardsToGoal` out. Designed: rounds down. */
export function halfDistance(yardsToGoal: number): number {
  return Math.floor(yardsToGoal / HALF_DIVISOR);
}

/** Down, distance and goal-to-go for a new series at `spot`. */
export function newSeries(spot: number, rules: RuleSet): { down: number; distance: number; goalToGo: boolean } {
  const toGoal = flip(spot);
  const goalToGo = toGoal <= rules.downs.yardsForFirstDown;
  return { down: 1, distance: goalToGo ? toGoal : rules.downs.yardsForFirstDown, goalToGo };
}

/** Lowest and highest legal scrimmage spot: never on a goal line. */
export const MIN_SNAP_SPOT = 1;
export const MAX_SNAP_SPOT = FIELD_LENGTH - 1;

export function clampToField(spot: number): number {
  return Math.min(MAX_SNAP_SPOT, Math.max(MIN_SNAP_SPOT, spot));
}
