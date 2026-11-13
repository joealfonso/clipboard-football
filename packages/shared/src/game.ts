// Types for the M1 step 5 full-game loop: the coach's view of a dead ball, the designed game
// config, the fitted coach decision tables (tempo, timeouts, onside), the league settings and the
// team names. Plain types only, no zod, so packages/sim can import them; the zod schemas live in
// game-schema.ts. docs/MODEL.md says which parts are fitted, designed or mixed.

import type { EngineData } from "./engine";
import type { Situation } from "./situation";

/**
 * What a coach sees before a snap: the step 2 Situation (offense's perspective) plus the clock
 * state both sidelines can see. Built by the loop from the game state (spec resolved question
 * 13: type-only; give it a schemaVersion if it is ever serialized). Nothing here describes
 * either side's call, formation, personnel or ratings.
 */
export interface CoachView extends Situation {
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
    readonly callerMasks?: { readonly spikeNeedsRunningClock?: boolean; readonly earlyKneel?: { readonly quarters: readonly number[]; readonly halfEndQuarter: number; readonly secondsAbove: number } };
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

/** Everything the full-game loop reads, validated by game-schema.ts before it reaches the sim. */
export interface GameData {
  readonly engine: EngineData;
  readonly config: GameConfig;
  readonly tables: CoachTables;
  readonly league: LeagueSettings;
  readonly teamNames: TeamNames;
  /** sha256 of the rule set file's bytes. */
  readonly rulesHash: string;
  /** sha256 of each data file the game reads, by repo path. */
  readonly dataHashes: Readonly<Record<string, string>>;
}
