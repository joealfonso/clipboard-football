// GameState is plain JSON data (no classes, Maps or Dates) so a save can store it and resume.

export type Team = "home" | "away";
export type GameType = "regularSeason" | "postseason";
export type TossChoice = "receive" | "kick" | "defer";

/**
 * kickoff: a free kick (kickoff or safety kick) is next. scrimmage: a snap is next.
 * try: the scoring team's try is next. overtimeToss: regulation (or an overtime cycle)
 * ended tied and a coin toss is next. final: the game is over and accepts no input.
 */
export type GamePhase = "kickoff" | "scrimmage" | "try" | "overtimeToss" | "final";

export interface Score {
  readonly home: number;
  readonly away: number;
}

export interface Toss {
  readonly winner: Team;
  readonly choice: TossChoice;
  /** Receives the kickoff that opens the next half (or third overtime period). */
  readonly secondHalfReceiver: Team;
}

export interface OvertimeState {
  /** Received the opening overtime kickoff. */
  readonly firstTeam: Team;
  /** Kicked the opening overtime kickoff. */
  readonly secondTeam: Team;
  /** The second team has had its opportunity to possess. */
  readonly secondTeamPossessed: boolean;
  /** The next score by either team ends the game. */
  readonly suddenDeath: boolean;
  readonly toss: Toss;
}

export type EndReason = "regulation" | "overtimeScore" | "overtimeExpired";

export interface GameResult {
  readonly reason: EndReason;
  /** null for a tie. */
  readonly winner: Team | null;
}

export interface GameState {
  readonly rules: { readonly id: string; readonly hash: string };
  readonly seed: number;
  readonly gameType: GameType;
  /** 1 to the number of regulation periods, then overtime periods. */
  readonly period: number;
  /** Seconds left in the period. */
  readonly clock: number;
  /** The game clock runs before the next snap (it restarted on the ready-for-play signal). */
  readonly clockRunning: boolean;
  /** Seconds left on the play clock before the next snap; bounds pre-snap run-off. */
  readonly playClock: number;
  readonly phase: GamePhase;
  /** scrimmage and try: the offense. kickoff: the kicking team. */
  readonly possession: Team;
  /**
   * Yards from the possessing team's own goal line. scrimmage: the line of scrimmage.
   * kickoff: the kicking team's restraining line. try: the two-point spot.
   */
  readonly spot: number;
  /** 1 to 4 in scrimmage, 0 otherwise. */
  readonly down: number;
  /** Yards to the line to gain in scrimmage, 0 otherwise. */
  readonly distance: number;
  readonly goalToGo: boolean;
  /** try only: the kick and two-point spots in the offense's frame, after any penalties. */
  readonly trySpots: { readonly kick: number; readonly twoPoint: number } | null;
  /** kickoff only: the free kick follows a safety. */
  readonly safetyKick: boolean;
  readonly score: Score;
  readonly timeouts: Score;
  /** Timeouts each team has taken in the current dead-ball period. */
  readonly timeoutsThisDeadBall: Score;
  readonly twoMinuteWarningDone: boolean;
  /** Time expired on a play that earned one more untimed down. */
  readonly untimedDown: boolean;
  readonly toss: Toss;
  readonly overtime: OvertimeState | null;
  readonly playCount: number;
  readonly result: GameResult | null;
}
