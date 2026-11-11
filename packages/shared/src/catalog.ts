// Types for data/calls/catalog.json. Plain types only, no zod, so packages/sim can import
// them. The zod schema that produces these lives in schema.ts.

import type { SituationField } from "./situation";

export type CompareOp = "eq" | "ne" | "lt" | "lte" | "gt" | "gte";

export interface CompareRule {
  readonly field: SituationField;
  readonly op: CompareOp;
  readonly value: number | string;
}

export type Rule =
  | CompareRule
  | { readonly all: readonly Rule[] }
  | { readonly any: readonly Rule[] }
  | { readonly not: Rule };

export interface Choice {
  /** Number key on its screen, 1..n in order. */
  readonly key: number;
  /** Unique across the whole catalog. */
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Screen this choice opens. A choice without one is a final call. */
  readonly opens?: string;
  /** Absent means always available. */
  readonly availableWhen?: Rule;
}

export interface Screen {
  readonly id: string;
  readonly title: string;
  readonly side: "offense" | "defense";
  /** Plain-language note on when the screen appears. */
  readonly when: string;
  readonly choices: readonly Choice[];
}

export interface Catalog {
  readonly version: number;
  readonly designed: true;
  readonly roots: readonly string[];
  readonly screens: readonly Screen[];
}

export const MAX_CHOICES_PER_SCREEN = 7;
