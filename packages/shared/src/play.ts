// PlayResult: the contract between the play engine (step 4, resolvePlay) and the game state
// machine (step 3). The play engine says what physically happened; the machine applies the
// rules to it. Plain types only, so packages/sim can import them.
//
// Frame: every spot is yards from the goal line of the team that snapped or kicked (the
// "offense"), so 0 is its own goal line and 100 the other team's. Values below 0 or above
// 100 mean the ball is dead in an end zone. Spots are whole yards.
//
// Constraints step 4 must respect (the machine rejects anything else with a typed error):
// - Fouls by both teams on a play with a change of possession, or on a kick, are not
//   supported. Fouls by both teams on any other play offset and the down is replayed.
// - No momentum exception: `impetus` says which team put the ball into an end zone.
// - At most one foul per team is enforced; the offended team picks which.
// - Possession gained and lost within one down is reported with `defensePossessedDuringPlay`;
//   `end.possession` is always who held the ball when it became dead.

/** Relative to the play: "offense" snapped or kicked the ball, "defense" is the other team. */
export type PlaySide = "offense" | "defense";

export interface BallEnd {
  /** Dead-ball spot in the offense's frame. Below 0 or above 100 is an end zone. */
  readonly spot: number;
  /** Team holding the ball when it became dead. */
  readonly possession: PlaySide;
  /**
   * Team whose action put the ball into the end zone it is dead in. Only read when the ball
   * is dead in an end zone. Defaults to the team that last had the ball before it got there:
   * the offense for its own runner, the kicker's team for a kick.
   */
  readonly impetus?: PlaySide;
}

export interface Foul {
  /** Id in the rule set's penalty table. */
  readonly penalty: string;
  readonly by: PlaySide;
  /** Spot of the foul in the offense's frame, where the enforcement needs it. */
  readonly spot?: number;
}

interface PlayBase {
  /** Seconds of game clock the play used. */
  readonly seconds: number;
  readonly fouls?: readonly Foul[];
  /** Fields the machine ignores: the one-line "why", animation detail. */
  readonly detail?: Readonly<Record<string, unknown>>;
}

export type ScrimmageKind = "run" | "pass" | "sack" | "scramble" | "kneel" | "spike";

export interface ScrimmagePlay extends PlayBase {
  readonly kind: ScrimmageKind;
  readonly end: BallEnd;
  /** Incomplete forward pass. The ball returns to the previous spot. */
  readonly incomplete?: boolean;
  /** The runner (or a fumble) went out of bounds. */
  readonly outOfBounds?: boolean;
  /** A fumble or backward pass went out of bounds (clock restarts on the ready signal). */
  readonly fumbleOutOfBounds?: boolean;
  /** Informational: how possession changed, if it did. */
  readonly turnover?: "interception" | "fumble";
  /** Informational: a touchdown is claimed. Checked against the spot. */
  readonly touchdown?: boolean;
  /**
   * The defense intercepted or recovered the ball at some point during the down, even if the
   * offense got it back. Stops the clock, makes an offense recovery a new series (Rule 7-3-1-c)
   * and counts as the defense possessing in overtime (Rule 16-1-5-b).
   */
  readonly defensePossessedDuringPlay?: boolean;
}

export interface PuntPlay extends PlayBase {
  readonly kind: "punt";
  readonly end: BallEnd;
  /** The kick crossed the line of scrimmage. False for a punt blocked behind the line. */
  readonly crossedLine: boolean;
  /** A receiver touched the kick beyond the line (muff), making a kicking-team recovery legal. */
  readonly touchedByReceivers: boolean;
  readonly fairCatch?: boolean;
}

export interface FieldGoalPlay extends PlayBase {
  readonly kind: "fieldGoal";
  readonly good: boolean;
  /** Spot of the kick in the offense's frame (behind the line of scrimmage). */
  readonly kickSpot: number;
  /**
   * For a miss: absent when the ball was not touched by the receivers and became dead under
   * the missed-field-goal rule. Present when it was blocked, returned or recovered, in which
   * case the general kick rules apply.
   */
  readonly end?: BallEnd;
  readonly crossedLine?: boolean;
  readonly touchedByReceivers?: boolean;
}

export interface ExtraPointPlay extends PlayBase {
  readonly kind: "extraPoint";
  readonly good: boolean;
  /** For a blocked or returned kick. */
  readonly end?: BallEnd;
}

export interface TwoPointPlay extends PlayBase {
  readonly kind: "twoPoint";
  readonly end: BallEnd;
  readonly incomplete?: boolean;
}

export type KickoffOutcome =
  /** Reached the end zone without touching the landing zone, then downed there or out the back. */
  | "touchbackEndZone"
  /** Touched the landing zone, then downed in the end zone or out of bounds behind it. */
  | "touchbackLandingZone"
  /** First touched the ground or a player short of the landing zone. */
  | "short"
  | "outOfBounds"
  | "fairCatch"
  /** Caught or recovered and played out; `end` says where and by whom. */
  | "inPlay";

export interface KickoffPlay extends PlayBase {
  readonly kind: "kickoff";
  readonly outcome: KickoffOutcome;
  /** Required for "fairCatch" and "inPlay". */
  readonly end?: BallEnd;
  /**
   * For "short" and "outOfBounds": where the ball landed or went out, in the kicking team's
   * frame. The receivers take it there instead when that is closer to the kicker.
   */
  readonly landingSpot?: number;
}

export interface OnsideKickPlay extends PlayBase {
  readonly kind: "onsideKick";
  readonly outcome: "inPlay" | "outOfBounds";
  readonly end?: BallEnd;
  readonly landingSpot?: number;
}

/** A pre-snap foul blew the play dead before the snap. Uses no game clock. */
export interface NoPlay extends PlayBase {
  readonly kind: "noPlay";
}

export type PlayResult =
  | ScrimmagePlay
  | PuntPlay
  | FieldGoalPlay
  | ExtraPointPlay
  | TwoPointPlay
  | KickoffPlay
  | OnsideKickPlay
  | NoPlay;
