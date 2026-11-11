// Types for the baseline play caller's designed config (data/caller/config.json) and its
// generated tables (data/caller/*.table.json). Plain types only, no zod.

import type { Catalog } from "./catalog";
import type { Phase, NumericSituationField } from "./situation";

export interface RangeBucket {
  readonly label: string;
  /** Inclusive. null means unbounded. */
  readonly min: number | null;
  readonly max: number | null;
}

export interface RuleBucket extends RangeBucket {
  readonly quarterMin: number;
  readonly quarterMax: number;
  readonly field: NumericSituationField;
}

interface DimensionBase {
  /** Phases where the dimension has a value. In any other phase it is null. */
  readonly phases: readonly Phase[];
}

export type Dimension =
  | (DimensionBase & { readonly type: "exact"; readonly field: NumericSituationField })
  | (DimensionBase & {
      readonly type: "range";
      readonly field: NumericSituationField;
      readonly buckets: readonly RangeBucket[];
      readonly coarseOf?: string;
    })
  | (DimensionBase & {
      readonly type: "clip";
      readonly field: NumericSituationField;
      readonly min: number;
      readonly max: number;
      readonly coarse?: string;
    })
  | (DimensionBase & { readonly type: "rules"; readonly buckets: readonly RuleBucket[] })
  | (DimensionBase & {
      readonly type: "group";
      readonly of: string;
      readonly groups: readonly { readonly label: string; readonly members: readonly string[] }[];
    })
  | (DimensionBase & {
      readonly type: "endState";
      readonly of: string;
      readonly appliesTo: readonly string[];
      readonly otherwise: string;
      readonly parts: readonly {
        readonly field: NumericSituationField;
        readonly buckets: readonly RangeBucket[];
      }[];
    });

/**
 * Context dimensions are not read from the Situation: "leaf" is the offense's chosen play
 * (formation factor) and "front" is the defense's sampled front (coverage factor).
 */
export const CONTEXT_DIMENSIONS = ["leaf", "front"] as const;
export type ContextDimension = (typeof CONTEXT_DIMENSIONS)[number];

export interface Level {
  /** A tagged level only ever looks up the cell named by its tag (for example "try"). */
  readonly tag?: string;
  readonly dims: readonly string[];
}

export interface SeasonRange {
  readonly from: number;
  readonly to: number;
}

export interface FactorConfig {
  readonly side: "offense" | "defense";
  readonly predicts: string;
  /** Scrimmage downs the factor is fitted on and used for. Absent means any. */
  readonly downs?: readonly number[];
  readonly seasons: SeasonRange & { readonly byDown?: Readonly<Record<string, SeasonRange>> };
  readonly minPlays: number;
  readonly targets: readonly string[];
  readonly levels: readonly Level[];
}

export const FACTOR_IDS = [
  "oTop",
  "o4Top",
  "o4Kick",
  "oRun",
  "oPassType",
  "oDepth",
  "oFormation",
  "oTry",
  "tpTop",
  "tpRun",
  "tpPassType",
  "tpDepth",
  "dFront",
  "dCoverage",
  "dTry",
] as const;
export type FactorId = (typeof FACTOR_IDS)[number];

export type PresetCell = string | { readonly if: "boxHeavy" | "blitz"; readonly then: string; readonly else: string };

export interface DefenseMapping {
  readonly coverage: Readonly<Record<string, string | null>>;
  readonly manZone: Readonly<Record<string, string | null>>;
  readonly groups: {
    readonly goalLineMaxDB: number;
    readonly base: number;
    readonly nickel: number;
    readonly dime: number;
    readonly preventMinDB: number;
  };
  readonly boxHeavyMin: number;
  readonly blitzMinRushers: number;
  readonly presetTable: Readonly<Record<"base" | "nickel" | "dime", Readonly<Record<string, PresetCell>>>>;
  readonly presets: Readonly<
    Record<
      string,
      {
        readonly group: string;
        readonly box: string;
        readonly shell: string;
        readonly manZone: string;
        readonly rush: string;
      }
    >
  >;
}

export interface CallerConfig {
  readonly version: number;
  readonly designed: true;
  readonly seasons: {
    readonly weightAnchor: number;
    readonly halfLifeSeasons: number;
    readonly holdout: readonly number[];
    readonly neverTrainFrom: number;
    readonly seasonType: string;
  };
  readonly dimensions: Readonly<Record<string, Dimension>>;
  readonly tags: Readonly<Record<string, unknown>>;
  readonly factors: Readonly<Record<FactorId, FactorConfig>>;
  readonly offenseMapping: Readonly<Record<string, unknown>>;
  readonly defenseMapping: DefenseMapping;
}

/** One fitted factor, as baked by the pipeline. */
export interface FactorTable {
  readonly targets: readonly string[];
  readonly levels: readonly Level[];
  readonly minPlays: number;
  /** Seasons that fed any cell, and the weight each play from that season carried. */
  readonly seasons: readonly number[];
  readonly seasonWeights: Readonly<Record<string, number>>;
  readonly byDown?: Readonly<Record<string, SeasonRange>>;
  readonly downs?: readonly number[];
  /** Plays used, before the minimum-count rule. */
  readonly plays: number;
  /** One map per level: cell key to integer weights (one per target, summing to 10,000). */
  readonly cells: readonly Readonly<Record<string, readonly number[]>>[];
}

export interface CallerTables {
  readonly generated: true;
  readonly side: "offense" | "defense";
  readonly configHash: string;
  readonly halfLifeSeasons: number;
  readonly weightAnchor: number;
  readonly factors: Readonly<Partial<Record<FactorId, FactorTable>>>;
}

/** Everything the runtime caller needs, already validated. */
export interface CallerData {
  readonly catalog: Catalog;
  readonly config: CallerConfig;
  readonly offense: CallerTables;
  readonly defense: CallerTables;
}

export const CELL_TOTAL = 10000;
