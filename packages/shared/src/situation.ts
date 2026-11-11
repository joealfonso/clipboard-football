// The game situation a play caller sees. Always from the perspective of the team with
// the ball: the defense caller receives the same object, so there is one sign convention.
// Nothing here describes either side's call, personnel, formation or ratings.

export type Phase = "scrimmage" | "try";

export interface Situation {
  /** "try" is the play after a touchdown (extra point or two-point attempt). */
  readonly phase: Phase;
  /** 1 to 4. Ignored on a try. */
  readonly down: number;
  /** Ignored on a try. */
  readonly yardsToGo: number;
  /** Yards to the opponent's goal line, 1 to 99. */
  readonly yardLine100: number;
  /** Offense score minus defense score. On a try, after the touchdown. */
  readonly scoreDiff: number;
  /** 1 to 4, 5 for overtime. */
  readonly quarter: number;
  /** In overtime, seconds left in the period. */
  readonly secondsLeftInHalf: number;
  /** In overtime, seconds left in the period. */
  readonly secondsLeftInGame: number;
  readonly offenseTimeouts: number;
  readonly defenseTimeouts: number;
}

/** Every field an availability rule or a bin may read. Kept in sync with Situation by a test. */
export const SITUATION_FIELDS = [
  "phase",
  "down",
  "yardsToGo",
  "yardLine100",
  "scoreDiff",
  "quarter",
  "secondsLeftInHalf",
  "secondsLeftInGame",
  "offenseTimeouts",
  "defenseTimeouts",
] as const satisfies readonly (keyof Situation)[];

export type SituationField = (typeof SITUATION_FIELDS)[number];
export type NumericSituationField = Exclude<SituationField, "phase">;
