// Types for the M1 step 5 full-game loop: the coach's view of a dead ball, the designed game
// config, the fitted coach decision tables (tempo, timeouts, onside), the league settings and the
// team names. Plain types only, no zod, so packages/sim can import them; the zod schemas live in
// game-schema.ts. docs/MODEL.md says which parts are fitted, designed or mixed.

import type { EngineData } from "./engine";
import type { OnFieldSide, PlayResult } from "./play";
import type { Situation } from "./situation";

/**
 * What a coach sees before a snap: the step 2 Situation (offense's perspective) plus the clock
 * state both sidelines can see. Built by the loop from the game state (spec resolved question
 * 13: type-only; give it a schemaVersion if it is ever serialized). Nothing here describes
 * either side's call, formation, personnel or ratings. Its clockRunning is a boolean; the
 * Situation's numeric clockRunning (step 5d) is the same fact for the play caller.
 */
export interface CoachView extends Omit<Situation, "clockRunning"> {
  /** The game clock runs before this snap (it restarted on the ready-for-play signal). */
  readonly clockRunning: boolean;
  /** Seconds left on the play clock. */
  readonly playClock: number;
  /** The previous snap, by the same offense in this period, was a kneel. */
  readonly previousSnapKneel: boolean;
  /** The previous snap by the same offense in this period: 0 neither, 1 went out of bounds, 2 drew a flag. */
  readonly previousSnapRestart: 0 | 1 | 2;
  /** Asked for the seconds that run before a timeout being called now (tempo only). */
  readonly beforeTimeout: boolean;
  /** Timeouts each side has already taken in this dead-ball period. */
  readonly offenseTimeoutsThisDeadBall: number;
  readonly defenseTimeoutsThisDeadBall: number;
}

/**
 * Step 5d milestone D: states (from `quarterMin` on, overtime included) where the average coach
 * never kneels. A state matches when every bound it sets holds: scoreDiff in [scoreMin, scoreMax],
 * more than `secondsAbove` seconds left in the game (overtime: the period), yardLine100 above
 * `yardLine100Above`.
 */
export interface LateKneelMask {
  readonly quarterMin: number;
  readonly states: readonly { readonly scoreMin?: number; readonly scoreMax?: number; readonly secondsAbove?: number; readonly yardLine100Above?: number; readonly realKneels: number; readonly realSnaps: number }[];
}

/** What the kicking team's coach sees before a kickoff, from the kicker's perspective. */
export interface KickView {
  readonly quarter: number;
  readonly secondsLeftInHalf: number;
  readonly secondsLeftInGame: number;
  /** Kicking team score minus receiving team score. */
  readonly scoreDiff: number;
  readonly safetyKick: boolean;
}

// ---------------------------------------------------------------- designed: game config

export interface DecisionCondition {
  readonly field: string;
  readonly min?: number;
  readonly max?: number;
}

/** A designed decision bin: the value of one numeric view field, or the first bucket whose conditions all hold. */
export type DecisionDim =
  | { readonly exact: string }
  | { readonly buckets: readonly { readonly label: string | null; readonly if: readonly DecisionCondition[] }[] };

export interface DecisionLevel {
  readonly dims: readonly string[];
}

export interface GameConfig {
  readonly schemaVersion: number;
  readonly designed: true;
  readonly seasons: {
    readonly from: number;
    readonly to: number;
    readonly tempoFrom: number;
    readonly neverTrainFrom: number;
    readonly holdout: readonly number[];
    readonly weightAnchor: number;
    readonly halfLifeSeasons: number;
    readonly homeFieldExclude: readonly number[];
  };
  readonly dimensions: Readonly<Record<string, DecisionDim>>;
  readonly tempo: { readonly levels: readonly DecisionLevel[]; readonly minN: number; readonly maxSeconds: number; readonly cellTotal: number };
  readonly timeouts: { readonly levels: readonly DecisionLevel[]; readonly minN: number };
  /** Step 5c milestone D: levels for timeouts before a kickoff or a try ("role" is a context dimension). */
  readonly specialTimeouts?: { readonly levels: readonly DecisionLevel[]; readonly minN: number };
  readonly onside: { readonly levels: readonly DecisionLevel[]; readonly minN: number; readonly designedRule: OnsideRule };
  readonly expectedPoints: { readonly levels: readonly DecisionLevel[]; readonly minN: number };
  readonly runoffTimeout: { readonly finalSeconds: number };
  /** Step 5c milestones E and F: designed clock rules of the average coach. */
  readonly clockRules?: {
    readonly clockOut?: { readonly trailingMin: number; readonly trailingMax: number };
    readonly kneelOutDrain?: boolean;
    readonly kneelOutDrainWindow?: { readonly quarterMin: number; readonly secondsLeftInGame: number };
    readonly timeoutBeforeExpiry?: boolean;
    readonly callerMasks?: {
      readonly spikeNeedsRunningClock?: boolean;
      readonly earlyKneel?: { readonly quarters: readonly number[]; readonly halfEndQuarter: number; readonly secondsAbove: number };
      /** Step 5d milestone D (designed): no kneel in these late states, each with 0 real kneels in 2016-2023 (docs/MODEL.md). */
      readonly lateKneel?: LateKneelMask;
    };
  };
  readonly loop: { readonly maxInputsPerGame: number; readonly maxScrimmageSnapsPerGame: number };
  readonly league: {
    readonly teams: number;
    readonly leagues: number;
    readonly gamesPerLeague: number;
    readonly calibrationSeed: number;
    readonly ciSliceGames: number;
  };
  readonly driveResults: Readonly<Record<string, readonly string[] | string>>;
}

export interface OnsideRule {
  readonly trailingBy: number;
  readonly secondsLeftInGame: number;
  readonly quarterMin: number;
}

// ---------------------------------------------------------------- fitted: coach decision tables

export interface TempoTable {
  readonly generated: true;
  readonly levels: readonly DecisionLevel[];
  readonly minN: number;
  readonly maxSeconds: number;
  readonly cellTotal: number;
  /** Per level: cell key -> integer weights for 0..maxSeconds seconds of run-off. */
  readonly cells: readonly Readonly<Record<string, readonly number[]>>[];
}

export interface RateTable {
  readonly generated: true;
  readonly levels: readonly DecisionLevel[];
  readonly minN: number;
  /** Per level: cell key -> [rate per 1,000,000, observations]. */
  readonly cells: readonly Readonly<Record<string, readonly number[]>>[];
}

/** Dead balls before a kickoff or a try. */
export type SpecialTimeoutRole = "kickKicker" | "kickReceiver" | "tryOffense" | "tryDefense";

export interface TimeoutTable extends RateTable {
  /** Fitted rate per dead ball before a kickoff or a try, by role: [rate per 1,000,000, observations]. */
  readonly beforeKickoffOrTry: Readonly<Record<SpecialTimeoutRole, readonly number[]>>;
  /** Step 5c milestone D: the same rates in designed time bins; a missing cell backs off to the role's rate. */
  readonly special?: { readonly levels: readonly DecisionLevel[]; readonly minN: number; readonly cells: readonly Readonly<Record<string, readonly number[]>>[] };
}

export interface OnsideTable extends RateTable {
  readonly designedRule: OnsideRule;
}

/** Fitted expected points for the team with the ball, by down, distance and field position. */
export interface ExpectedPointsTable {
  readonly generated: true;
  /** Cell values are expected points x scale. */
  readonly scale: number;
  readonly levels: readonly DecisionLevel[];
  readonly minN: number;
  /** Per level: cell key -> [expected points x scale, snaps]. */
  readonly cells: readonly Readonly<Record<string, readonly number[]>>[];
}

export interface CoachTables {
  readonly ep: ExpectedPointsTable;
  readonly tempo: TempoTable;
  readonly timeouts: TimeoutTable;
  readonly onside: OnsideTable;
}

// ---------------------------------------------------------------- designed: league and home field

export interface LeagueSettings {
  readonly schemaVersion: number;
  readonly designed: true;
  readonly homeField: {
    /** Rating points added to every home player's ratings and taken from every away player's, for the game. */
    readonly ratingEdge: number;
    /** Offensive pre-snap foul rates are x (1 - c) for the home offense and x (1 + c) for the away offense. */
    readonly crowdNoise: number;
  };
  readonly teamStrength: {
    /** SD, in rating points, of the per-team shift drawn for every player of a generated team. */
    readonly sd: number;
  };
  readonly tuning: Readonly<Record<string, unknown>>;
}

export interface TeamName {
  readonly place: string;
  readonly nickname: string;
}

export interface TeamNames {
  readonly schemaVersion: number;
  readonly designed: true;
  readonly teams: readonly TeamName[];
}

/** The cell fields a tempo mode reads its run-off with (data/game/tempo-modes.json, designed; M2 E). */
export interface TempoModeCell {
  readonly quarter: number;
  readonly secondsLeftInGame: number;
  readonly secondsLeftInHalf: number;
  readonly scoreDiff: number;
}

export interface TempoModes {
  readonly schemaVersion: number;
  readonly designed: true;
  readonly modes: { readonly hurryUp: TempoModeCell; readonly runClock: TempoModeCell };
}

/** data/game/challenge-policy.json (designed, M2 G). */
export interface ChallengePolicy {
  readonly schemaVersion: number;
  readonly designed: true;
  /** The calibrated baseline has no close calls; the app turns them on. */
  readonly enabled: boolean;
  /** Prompt per close-call kind (the request's question key is the kind). */
  readonly questions: Readonly<Record<string, string>>;
  /** The average coach: challenge when rate x swing - (1 - rate) x timeoutCost > threshold. */
  readonly ai: { readonly timeoutCost: number; readonly threshold: number };
}

/** Everything the full-game loop reads, validated by game-schema.ts before it reaches the sim. */
export interface GameData {
  readonly engine: EngineData;
  readonly config: GameConfig;
  readonly tables: CoachTables;
  readonly league: LeagueSettings;
  readonly teamNames: TeamNames;
  /** M2 E: the human offense's tempo modes (designed). */
  readonly tempoModes: TempoModes;
  /** M2 G: close calls and the AI challenge policy (designed). */
  readonly challengePolicy: ChallengePolicy;
  /** sha256 of the rule set file's bytes. */
  readonly rulesHash: string;
  /** sha256 of each data file the game reads, by repo path. */
  readonly dataHashes: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------- M2 C: per-player box score, rating ranks

// The per-player box score and league-wide rating ranks, as the UI reads them; zod schemas in
// m2-schema.ts. Every stat is computed from a game record's event log (packages/sim/src/loop/
// player-box.ts) and decides nothing. A category a player has no stat in is absent (the UI
// shows a dash), never 0 (C4). Definitions: docs/MODEL.md, "Per-player box score".

export interface PassingLine {
  readonly completions: number;
  readonly attempts: number;
  readonly yards: number;
  readonly touchdowns: number;
  readonly interceptions: number;
  /** Times sacked, and the yards lost. */
  readonly sacked: number;
  readonly sackYards: number;
}

export interface RushingLine {
  readonly attempts: number;
  readonly yards: number;
  readonly touchdowns: number;
  /** Longest run. */
  readonly long: number;
}

export interface ReceivingLine {
  readonly targets: number;
  readonly catches: number;
  readonly yards: number;
  readonly touchdowns: number;
  /** Longest catch; absent with no catch. */
  readonly long?: number;
}

export interface DefenseLine {
  readonly tackles: number;
  readonly sacks: number;
  readonly interceptions: number;
  readonly forcedFumbles: number;
  readonly recoveries: number;
}

export interface KickingLine {
  readonly fieldGoalsMade: number;
  readonly fieldGoalAttempts: number;
  /** Longest field goal made; absent with none made. */
  readonly long?: number;
  readonly extraPointsMade: number;
  readonly extraPointAttempts: number;
}

export interface PuntingLine {
  readonly punts: number;
  /** Gross yards. */
  readonly yards: number;
  /** yards / punts. */
  readonly average: number;
}

export interface PlayerLine {
  readonly id: string;
  readonly team: "home" | "away";
  readonly passing?: PassingLine;
  readonly rushing?: RushingLine;
  readonly receiving?: ReceivingLine;
  readonly defense?: DefenseLine;
  readonly kicking?: KickingLine;
  readonly punting?: PuntingLine;
}

/** Players with at least one stat, by id, in order of their first stat in the game. */
export interface PlayerBoxScore {
  readonly players: Readonly<Record<string, PlayerLine>>;
  /** M2 G: coach's challenges won (reversed) and lost, per team; present once a team has challenged. */
  readonly challenges?: { readonly home: { readonly won: number; readonly lost: number }; readonly away: { readonly won: number; readonly lost: number } };
}

/** One rating's rank within the player's position across the league: 1 is the highest. */
export interface RatingRank {
  readonly value: number;
  readonly rank: number;
  /** Players at the position in the league. */
  readonly of: number;
}

/** Player id -> rating name (base ratings and the position's skills) -> rank (C6). */
export type RatingRanks = Readonly<Record<string, Readonly<Record<string, RatingRank>>>>;

// ---------------------------------------------------------------- M2 E: the step-wise loop's requests

/**
 * Tempo for the human offense (design decision 3; spec resolved 13): Normal draws the run-off as
 * the average coach does; Hurry-up from the fitted cells for a trailing offense in the final 2:00;
 * Run the clock from the cells for a leading offense in the final 5:00. Resets to Normal each drive.
 */
export const TEMPOS = ["hurryUp", "normal", "runClock"] as const;
export type Tempo = (typeof TEMPOS)[number];

/** Why an option is off (design decision 9). The UI words each one. */
export const REASON_CODES = [
  /** The team has no timeouts left. */
  "noTimeouts",
  /** The team already took a timeout in this dead ball (rules.timeouts.perTeamPerDeadBall). */
  "timeoutTaken",
  /** The rule set does not let a timeout replace the ten-second run-off. */
  "timeoutNotAllowed",
  /** Kick: only on 4th down or in the last 2:00 of a half (catalog rule). */
  "kickNotNow",
  /** Kick or Clock on a two-point try. */
  "notOnTry",
  /** Same call with no earlier call by this side in this game. */
  "noEarlierCall",
  /** Same call whose last call is not legal now. */
  "lastCallNotLegal",
  /** The rule set's onside rule does not allow one now. */
  "onsideNotAllowed",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export interface RequestOption {
  readonly id: string;
  readonly legal: boolean;
  /** Set exactly when the option is off. */
  readonly reason?: ReasonCode;
  /** The screen this option opens; absent for a final option. */
  readonly opens?: string;
}

/**
 * One menu screen. Every screen also has Esc (Back, or the pause menu on the first screen), so
 * options.length + 1 <= MAX_CHOICES_PER_SCREEN (7).
 */
export interface RequestScreen {
  readonly id: string;
  readonly options: readonly RequestOption[];
}

/** An offense call as the loop takes it (the sim's OffenseCall). */
export interface OffenseCallChoice {
  readonly call: string;
  readonly formation?: string;
  readonly twoPointPlay?: string;
}

/** What a penalty option leaves, as both sidelines see it. */
export interface PenaltyPreview {
  readonly phase: "kickoff" | "scrimmage" | "try" | "overtimeToss" | "final";
  readonly possession: "home" | "away";
  readonly spot: number;
  readonly down: number;
  readonly distance: number;
  readonly score: { readonly home: number; readonly away: number };
}

/**
 * The game state a request is decided in (code review, M2 E). The session's saved state is the
 * start of the dead ball; by a request, a run-off, a timeout or the two-minute warning may have
 * moved it, so the UI shows this, not its own copy.
 */
export interface RequestState {
  readonly period: number;
  /** Seconds left in the period. */
  readonly clock: number;
  readonly clockRunning: boolean;
  readonly phase: "kickoff" | "scrimmage" | "try" | "overtimeToss" | "final";
  /** The team that snaps or kicks next. */
  readonly possession: "home" | "away";
  /** Yards from the possessing team's own goal line. */
  readonly spot: number;
  readonly down: number;
  readonly distance: number;
  readonly goalToGo: boolean;
  readonly score: { readonly home: number; readonly away: number };
  readonly timeouts: { readonly home: number; readonly away: number };
  readonly safetyKick: boolean;
}

/** What happened in this dead ball before the request, in order (the loop's events, short form). */
export type RequestEvent =
  /** Seconds the game clock really ran before the snap (or before a timeout): the drawn run-off, cut short by a two-minute warning or the end of the period. */
  | { readonly t: "runoff"; readonly seconds: number }
  | { readonly t: "timeout"; readonly team: "home" | "away"; readonly side: "offense" | "defense"; readonly left: number }
  | { readonly t: "twoMinuteWarning"; readonly period: number }
  | { readonly t: "endPeriod"; readonly period: number };

interface RequestBase {
  /** Increases with every request of a session; an answer names the request it answers. */
  readonly seq: number;
  /** The state the decision is made in; null only for the opening toss, before the game exists. */
  readonly state: RequestState | null;
  /** This dead ball's events before the request: run-off, timeouts, the two-minute warning. */
  readonly events: readonly RequestEvent[];
  /** The human's team. */
  readonly team: "home" | "away";
  /** screens[0] is the first screen; an option's `opens` names another screen here. */
  readonly screens: readonly RequestScreen[];
}

/** Dead balls with nothing to call still wait for the human (design decision 17). */
export type ContinueAbout =
  | { readonly what: "tossResult"; readonly winner: "home" | "away"; readonly choice: "receive" | "kick" | "defer" }
  | { readonly what: "theyKickOff"; readonly onside: boolean; readonly safetyKick: boolean }
  /** The other team lines up for a kick, a kneel or a spike (visible before the snap). */
  | { readonly what: "theyLineUp"; readonly call: string }
  /** M2 G: a review starts: by your challenge, theirs, or the Replay Official (the rules call for it). */
  | { readonly what: "underReview"; readonly kind: string; readonly question: string; readonly by: "you" | "them" | "booth" }
  /** M2 G: what the review found, and what it cost. `play` is the play as it now stands. */
  | {
      readonly what: "reviewResult";
      readonly kind: string;
      readonly by: "you" | "them" | "booth";
      readonly verdict: "stands" | "reversed";
      readonly play: PlayResult;
      /** A failed challenge charged the challenger a timeout. */
      readonly timeoutCharged: boolean;
    };

/**
 * A decision the loop is waiting for (spec E; design "Needs from the engine" 1). Nothing here
 * says what the other team called for the coming snap, except a kick, kneel or spike it has
 * visibly lined up for (`theyLineUp`).
 */
export type DecisionRequest =
  | (RequestBase & { readonly kind: "toss" })
  | (RequestBase & { readonly kind: "overtimeToss" })
  | (RequestBase & { readonly kind: "kickoff"; readonly safetyKick: boolean })
  | (RequestBase & { readonly kind: "try"; readonly sameCall: OffenseCallChoice | null; readonly lineups?: Lineups })
  | (RequestBase & {
      readonly kind: "offenseCall";
      readonly tempo: Tempo;
      readonly clockRunning: boolean;
      /** This side's last call in this game; legality is the sameCall option's. */
      readonly sameCall: OffenseCallChoice | null;
      /** Field goal distance from here, a fact for the Kick screen ("Field goal (47 yd)"). */
      readonly fieldGoalYards: number;
      readonly lineups?: Lineups;
    })
  | (RequestBase & { readonly kind: "defenseCall"; readonly onTry: boolean; readonly sameCall: string | null; readonly lineups?: Lineups })
  | (RequestBase & {
      readonly kind: "penalty";
      /** The play just run (after the snap, so both calls are public). */
      readonly play: PlayResult;
      readonly offenseCall: OffenseCallChoice;
      readonly defenseCall: string | null;
      /** One per option on the first screen, same ids. */
      readonly outcomes: readonly { readonly option: string; readonly after: PenaltyPreview }[];
    })
  | (RequestBase & {
      readonly kind: "runoff";
      readonly play: PlayResult;
      readonly offenseCall: OffenseCallChoice;
      readonly defenseCall: string | null;
      /** Game clock before the run-off and after it. */
      readonly clock: number;
      readonly clockAfter: number;
    })
  | (RequestBase & { readonly kind: "continue"; readonly about: ContinueAbout })
  /**
   * M2 G: a close call went against you and the rules let you challenge it. `play` is the ruling
   * on the field (its closeCall carries no verdict); the risk numbers come from the rule set.
   */
  | (RequestBase & {
      readonly kind: "challenge";
      readonly closeCall: { readonly kind: string; readonly question: string };
      readonly play: PlayResult;
      readonly offenseCall: OffenseCallChoice;
      readonly defenseCall: string | null;
      readonly challengesLeft: number;
      readonly timeoutsLeft: number;
      /** What a failed challenge costs, from the rule set. */
      readonly failedCostsTimeout: boolean;
    });

export type RequestKind = DecisionRequest["kind"];

/**
 * The human side's own players for each formation (offense, try) or defense package on offer:
 * exactly the players resolvePlay's onField puts on the field at the snap. Never the opponent's.
 * Set by the session on every offenseCall, try and defenseCall request (docs/specs/
 * m2-play-calling-and-motion.md, Need 1; approved by Joseph as a shared type change).
 */
export type Lineups = Readonly<Record<string, OnFieldSide>>;

/**
 * The human's answer: the option ids from the first screen to a final option, for example
 * ["pass", "shotgun", "deepPass"], ["timeout"], ["sameCall"], ["clock", "hurryUp"], ["accept:0"].
 */
export interface DecisionAnswer {
  readonly seq: number;
  readonly path: readonly string[];
}

export type SessionErrorCode = "noRequest" | "staleRequest" | "unknownOption" | "illegalOption" | "incompletePath";
