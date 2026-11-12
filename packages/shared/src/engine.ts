// Types for the play engine's data files (data/engine, data/players) and for players. Plain
// types only, no zod, so packages/sim can import them. The zod schemas that produce these live
// in engine-schema.ts. docs/MODEL.md says which parts are fitted, designed or mixed.

import type { CallerData, Dimension, Level } from "./caller";
import type { RuleSet } from "./rules";

// ---------------------------------------------------------------- players

export const BASE_RATINGS = ["speed", "strength", "agility", "awareness"] as const;
export type BaseRating = (typeof BASE_RATINGS)[number];

export const POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"] as const;
export type Position = (typeof POSITIONS)[number];

/** Position skills by position. Every player has the four base ratings plus these. */
export const POSITION_SKILLS = {
  QB: ["throwPower", "accuracy"],
  RB: ["ballSecurity", "elusiveness"],
  WR: ["hands", "routeRunning"],
  TE: ["hands", "routeRunning", "runBlock"],
  OL: ["passBlock", "runBlock"],
  DL: ["passRush", "runStop"],
  LB: ["tackling", "coverage"],
  CB: ["coverage", "ballSkills"],
  S: ["coverage", "ballSkills"],
  K: ["kickPower", "kickAccuracy"],
  P: ["kickPower", "kickAccuracy"],
} as const satisfies Readonly<Record<Position, readonly string[]>>;

export const PLAYER_SCHEMA_VERSION = 1;

export interface Player {
  readonly schemaVersion: number;
  readonly id: string;
  readonly name: string;
  readonly position: Position;
  /** Integers 0 to 99. */
  readonly ratings: Readonly<Record<BaseRating, number>>;
  /** The position's skills (POSITION_SKILLS), integers 0 to 99. */
  readonly skills: Readonly<Record<string, number>>;
}

/** One team's players. Order within a position is the order slots are filled (M1 has no depth chart). */
export interface TeamPool {
  readonly schemaVersion: number;
  readonly name: string;
  readonly players: readonly Player[];
}

// ---------------------------------------------------------------- designed: personnel

export type Slots = Readonly<Partial<Record<Position, number>>>;

export interface Personnel {
  readonly schemaVersion: number;
  readonly designed: true;
  readonly positions: readonly Position[];
  /** Offense on the field by formation. */
  readonly offense: Readonly<Record<string, Slots>>;
  /** Kicking units: punt, fieldGoal, extraPoint, kickoff. */
  readonly kick: Readonly<Record<string, Slots>>;
  /** Defense on the field by package. */
  readonly packages: Readonly<Record<string, Slots>>;
  readonly presetPackage: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------- designed: ratings

export interface RatingInput {
  readonly side: "offense" | "defense";
  readonly position: Position;
  /** A base rating or one of the position's skills. */
  readonly rating: string;
  /** Log multiplier per rating point of the on-field average's distance from league average. */
  readonly coef: number;
}

export type EffectTarget =
  | { readonly kind: "class"; readonly families: readonly string[]; readonly leaves?: readonly string[]; readonly classes: readonly string[]; readonly maxYardsToGo?: number }
  | { readonly kind: "penalty"; readonly penalties: readonly string[] }
  | { readonly kind: "punt"; readonly classes: readonly string[] }
  | { readonly kind: "fieldGoal"; readonly classes: readonly string[]; readonly minDistance?: number }
  | { readonly kind: "extraPoint"; readonly classes: readonly string[] }
  | { readonly kind: "kickoff"; readonly classes: readonly string[] };

export interface RatingEffect {
  readonly id: string;
  readonly label: string;
  readonly target: EffectTarget;
  readonly inputs: readonly RatingInput[];
  /** Bounds on the multiplier. */
  readonly min: number;
  readonly max: number;
}

export interface CurvePoint {
  /** Percentile within position, 0 to 1. */
  readonly p: number;
  readonly rating: number;
}

export interface RatingsConfig {
  readonly schemaVersion: number;
  readonly designed: true;
  /** Percentile within position to a 0-99 rating. Piecewise linear, increasing. */
  readonly curve: readonly CurvePoint[];
  /** Which ratings come from a combine measurement (mixed) and which are designed. */
  readonly measured: Readonly<Record<string, { readonly drills: readonly string[]; readonly lowerIsBetter: readonly boolean[]; readonly drillWeights: readonly number[] }>>;
  readonly effects: readonly RatingEffect[];
  /** D6: the smallest relative change a rating must cause, p10 to p90, on one player. */
  readonly minRelativeEffect: number;
}

// ---------------------------------------------------------------- generated: distributions

export interface RatingDistribution {
  readonly source: "measured" | "designed";
  readonly mean: number;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
}

export interface DrillTable {
  /** Measurement at the file's `percentiles` (5% to 95%) within position, each the mean of five players' results. */
  readonly cuts: readonly number[];
  readonly n: number;
}

export interface Distributions {
  readonly generated: true;
  readonly schemaVersion: number;
  readonly ratingsHash: string;
  readonly draftClasses: { readonly from: number; readonly to: number };
  /** The percentile (0 to 1) of each drill cut point. */
  readonly percentiles: readonly number[];
  /** Position -> rating -> distribution of the 0-99 rating. */
  readonly ratings: Readonly<Record<string, Readonly<Record<string, RatingDistribution>>>>;
  /** Position -> drill -> percentile cut points of the measurement. */
  readonly drills: Readonly<Record<string, Readonly<Record<string, DrillTable>>>>;
}

export interface Names {
  readonly designed: true;
  readonly first: readonly string[];
  readonly last: readonly string[];
}

// ---------------------------------------------------------------- generated: baseline tables

export interface FamilyDef {
  readonly leaves: readonly string[];
  readonly classes: readonly string[];
}

export interface BaselineScrimmage {
  readonly generated: true;
  readonly configHash: string;
  readonly seasons: readonly number[];
  readonly families: Readonly<Record<string, FamilyDef>>;
  readonly levels: readonly Level[];
  /** Per level: cell key -> class weights (summing to 10,000) then the cell's yards percentile. */
  readonly cells: readonly Readonly<Record<string, readonly number[]>>[];
  readonly poolLevels: readonly Level[];
  /** Fields of one pooled play, followed by its integer weight. */
  readonly poolFields: readonly string[];
  readonly pools: readonly Readonly<Record<string, readonly number[]>>[];
  /** Group -> class -> weights for seconds minSeconds..maxSeconds ("*" is the whole group). */
  readonly durations: Readonly<Record<string, Readonly<Record<string, readonly number[]>>>>;
  readonly twoPoint: Readonly<
    Record<string, { readonly source: string; readonly plays: number; readonly weights: readonly number[]; readonly pools: Readonly<Record<string, readonly number[]>> }>
  >;
  readonly clock: Readonly<Record<string, { readonly fields: readonly string[]; readonly tuples: readonly number[]; readonly plays: number }>>;
}

export interface BaselineSpecial {
  readonly generated: true;
  readonly configHash: string;
  readonly punts: {
    readonly classes: readonly string[];
    readonly levels: readonly Level[];
    readonly poolLevels: readonly Level[];
    readonly fields: readonly string[];
    readonly cells: readonly Readonly<Record<string, readonly number[]>>[];
    readonly pools: readonly Readonly<Record<string, readonly number[]>>[];
    readonly durations: Readonly<Record<string, readonly number[]>>;
  };
  readonly fieldGoals: {
    readonly minDistance: number;
    readonly maxDistance: number;
    readonly capAt: number;
    /** Make probability x 10,000 among unblocked kicks, minDistance..maxDistance. */
    readonly makePer10000: readonly number[];
    readonly bands: readonly { readonly label: string; readonly min: number; readonly max: number }[];
    readonly blockPer10000: readonly number[];
    /** Yards from the line of scrimmage back to the kick spot. */
    readonly kickDepth: number;
    readonly blockedPool: { readonly fields: readonly string[]; readonly tuples: readonly number[] };
    readonly durations: Readonly<Record<string, readonly number[]>>;
  };
  readonly extraPoints: { readonly classes: readonly string[]; readonly weights: readonly number[] };
}

export interface BaselinePenalties {
  readonly generated: true;
  readonly configHash: string;
  /** Rule set ids in the order of every rate array. */
  readonly ids: readonly string[];
  readonly levels: readonly Level[];
  /** Family -> per level: cell key -> rate per 1,000,000 snaps for each id. */
  readonly families: Readonly<Record<string, readonly Readonly<Record<string, readonly number[]>>[]>>;
  readonly doublePer1000000: number;
  /** For fouls either team can commit: share committed by the offense, per 10,000. */
  readonly offenseSharePer10000: Readonly<Record<string, number>>;
  readonly dpiYards: { readonly min: number; readonly max: number; readonly weights: readonly number[] };
}

// ---------------------------------------------------------------- designed: engine config

export interface PairingRule {
  readonly pairs: "noPlay" | "sampled" | "incompletePass";
  readonly families: readonly string[];
  readonly spot?: "fitted" | "passer";
  readonly passerDepth?: number;
  readonly onlyWhenBallDeadInField?: boolean;
}

export interface EngineConfig {
  readonly version: number;
  readonly designed: true;
  readonly dimensions: Readonly<Record<string, Dimension>>;
  readonly families: Readonly<Record<string, FamilyDef>>;
  readonly punts: { readonly classes: readonly string[]; readonly blockedEndBehindLine: number };
  readonly fieldGoals: { readonly blockedEndBehindLine: number };
  readonly durations: { readonly minSeconds: number; readonly maxSeconds: number };
  readonly fluke: { readonly classProbabilityBelow: number; readonly yardsPercentile: number };
  readonly penalties: { readonly pairing: Readonly<Record<string, PairingRule | string>> };
}

// ---------------------------------------------------------------- designed: kickoffs

export interface Weighted {
  readonly value: number;
  readonly w: number;
}

export interface KickoffOutcomes {
  /** Classes in order with weights: touchbackEndZone, touchbackLandingZone, short, outOfBounds, fairCatch, returned, returnTD, kickersRecover. */
  readonly classes: readonly string[];
  readonly weights: readonly number[];
  /** Receiving team's own yard line where a return ends. */
  readonly returnEnd: readonly Weighted[];
  /** Receiving team's own yard line of a fair catch. */
  readonly fairCatchAt: readonly Weighted[];
  /** Receiving team's own yard line where the kickers recover a live kick. */
  readonly kickersRecoverAt: readonly Weighted[];
  readonly returnSeconds: readonly Weighted[];
}

export interface KickoffTable {
  readonly version: number;
  readonly designed: true;
  readonly tunedTo: number;
  readonly kickoff: KickoffOutcomes;
  readonly safetyKick: KickoffOutcomes;
  readonly onside: {
    readonly recover: number;
    readonly outOfBounds: number;
    /** Yards past the kick spot where a recovered onside kick is dead. */
    readonly kickersAt: readonly Weighted[];
    readonly receiversAt: readonly Weighted[];
    readonly seconds: readonly Weighted[];
  };
  /** Rate per 1,000,000 kickoffs. */
  readonly fouls: Readonly<Record<string, number>>;
}

// ---------------------------------------------------------------- matchup

export interface MatchupCentered {
  readonly generated: true;
  readonly matchupHash: string;
  readonly configHash: string;
  /** leaf -> preset -> multiplier per class of the leaf's family. */
  readonly matchup: Readonly<Record<string, Readonly<Record<string, readonly number[]>>>>;
  /** leaf -> formation -> package -> multiplier per class. */
  readonly formation: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, readonly number[]>>>>>>;
}

// ---------------------------------------------------------------- designed: why sentences

/** Every trace factor the engine records and the fields a why template slot may bind to (E3). */
export const TRACE_FIELDS = {
  call: ["label", "leaf", "kind"],
  cell: ["family", "level", "key"],
  class: ["name", "label", "basePct", "pct"],
  matchup: ["preset", "presetLabel", "class", "multiplier"],
  formation: ["formation", "formationLabel", "package", "packageLabel", "class", "multiplier"],
  rating: ["effect", "label", "class", "multiplier"],
  penalty: ["id", "label", "side"],
  fluke: ["reason", "what"],
  special: ["event", "gross"],
  fieldGoal: ["distance", "pct"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export interface WhyTemplate {
  readonly id: string;
  /** The trace factor this template explains (the dominant factor, or "fluke"). */
  readonly when: string;
  /** Optional: only for these play kinds. */
  readonly kinds?: readonly string[];
  /** Text with {factor.field} slots. */
  readonly text: string;
  /** Fixed factor phrases in the text, by the factor they name (E2). */
  readonly factors: readonly string[];
}

export interface WhyTemplates {
  readonly version: number;
  readonly designed: true;
  /** Below this absolute log multiplier no factor is dominant (the baseline template). */
  readonly minLogEffect: number;
  /** Tie order for the dominant factor. */
  readonly order: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  readonly templates: readonly WhyTemplate[];
}

// ---------------------------------------------------------------- everything the engine needs

export interface EngineData {
  readonly rules: RuleSet;
  readonly caller: CallerData;
  readonly config: EngineConfig;
  readonly scrimmage: BaselineScrimmage;
  readonly special: BaselineSpecial;
  readonly penalties: BaselinePenalties;
  readonly kickoff: KickoffTable;
  readonly matchup: MatchupCentered;
  readonly personnel: Personnel;
  readonly ratings: RatingsConfig;
  readonly distributions: Distributions;
  readonly names: Names;
  readonly why: WhyTemplates;
}
