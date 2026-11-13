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
      /**
       * Step 5a: a range of `field` inside a window of another dimension (`of` labelled one of
       * `members`), and outside it the label of the dimension `otherwise` names, or null (the
       * dimension does not apply, so a level using it is skipped).
       */
      readonly type: "window";
      readonly of: string;
      readonly members: readonly string[];
      readonly field: NumericSituationField;
      readonly buckets: readonly RangeBucket[];
      readonly otherwise: string | null;
    })
  | (DimensionBase & {
      /**
       * Step 5b: whether a leading offense on downs 1-3 can kneel out the clock: with d the down,
       * t the defense's timeouts and P the rule set's play clock,
       * (4 - d) x P + kneelSeconds - P x min(t, 4 - d) >= seconds left in the game.
       * "K1" or "K0" inside `of` labelled one of `members`; null otherwise (not leading, 4th down,
       * or outside the window). `playClock` is filled from the rule set (`playClockRule`) by the
       * loader, never written in the config.
       */
      readonly type: "kneelOut";
      readonly of: string;
      readonly members: readonly string[];
      readonly kneelSeconds: number;
      readonly playClockRule: string;
      readonly playClock?: number;
      /** Step 5c F: split K0 into K0c.d01 / K0c.d23 (kneels run the clock out if the defense, holding 0-1 or 2-3 timeouts, uses none) and K0x (not even then). */
      readonly concede?: boolean;
      /** Step 5c F: K1 is null here, so a level using this dimension serves K0 states only. */
      readonly shortOnly?: boolean;
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

export interface SeasonRange {
  readonly from: number;
  readonly to: number;
}

export interface Level {
  /** A tagged level only ever looks up the cell named by its tag (for example "try"). */
  readonly tag?: string;
  readonly dims: readonly string[];
  /** Step 5a: fit this level on these seasons instead of the factor's (fitting only; lookup ignores it). */
  readonly seasons?: SeasonRange;
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
  /** Step 5c milestone C: the designed late try chart. A charted cell decides the try outright. */
  readonly tryChart?: TryChart;
}

export interface TryChart {
  readonly note: string;
  /** Dimension giving the late window label, and dimension giving the score after the touchdown. */
  readonly window: string;
  readonly score: string;
  /** "window|score" -> the call. Cells not listed keep the fitted oTry backoff. */
  readonly cells: Readonly<Record<string, "extraPoint" | "goForTwo">>;
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
  /** The data/caller/config.json version and hash the tables were built from. */
  readonly configVersion: number;
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
