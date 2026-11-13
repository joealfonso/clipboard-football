// The structured trace of the factors a play used, and the one-line "why" rendered from it
// through the designed templates in data/engine/why.json. A sentence can only name what the
// trace holds: a slot that does not bind throws, there is no fallback text.

import { TRACE_FIELDS } from "../../../shared/src/engine";
import type { WhyTemplate, WhyTemplates } from "../../../shared/src/engine";
import { fail } from "./errors";

export { TRACE_FIELDS };
export type TraceFactor = keyof typeof TRACE_FIELDS;
export type TraceEntry = { readonly factor: TraceFactor } & Readonly<Record<string, string | number | boolean>>;

/** Factors that carry a multiplier on the drawn class, the candidates for the dominant factor. */
const MULTIPLIER_FACTORS = new Set<string>(["matchup", "formation", "rating"]);

/**
 * E5: the trace entry with the largest absolute log multiplier on the drawn class; ties go by
 * `order`, then by trace order. null when no entry reaches minLogEffect.
 */
export function dominant(trace: readonly TraceEntry[], order: readonly string[], minLogEffect: number): TraceEntry | null {
  let best: TraceEntry | null = null;
  let bestAbs = -1;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const e of trace) {
    if (!MULTIPLIER_FACTORS.has(e.factor)) continue;
    const m = e["multiplier"];
    if (typeof m !== "number" || !(m > 0)) continue;
    const abs = Math.abs(Math.log(m));
    const rank = order.indexOf(e.factor) === -1 ? order.length : order.indexOf(e.factor);
    if (abs > bestAbs + 1e-12 || (Math.abs(abs - bestAbs) <= 1e-12 && rank < bestRank)) {
      best = e;
      bestAbs = abs;
      bestRank = rank;
    }
  }
  return best !== null && bestAbs >= minLogEffect ? best : null;
}

/** E4: a fluke is a drawn class with baseline probability below the threshold, or yards beyond the cell's percentile. */
export function isFluke(baseP: number, yards: number | null, yardsPercentile: number | null, classBelow: number): "classRare" | "yardsLong" | null {
  if (baseP < classBelow) return "classRare";
  if (yards !== null && yardsPercentile !== null && yards > yardsPercentile) return "yardsLong";
  return null;
}

const SLOT = /\{([a-zA-Z]+)\.([a-zA-Z]+)\}/g;

export interface Rendered {
  readonly text: string;
  readonly template: string;
}

/** Fills every slot from the trace. Throws EngineError("unboundSlot") on a slot with no value. */
export function render(t: WhyTemplate, trace: readonly TraceEntry[]): Rendered {
  const text = t.text.replace(SLOT, (_all, factor: string, field: string) => {
    const e = trace.find((x) => x.factor === factor && x[field] !== undefined);
    if (e === undefined) fail("unboundSlot", `template ${t.id}: {${factor}.${field}} has no value in the trace`);
    return String(e[field]);
  });
  return { text, template: t.id };
}

/** The slots a template uses, as [factor, field] pairs. */
export function slotsOf(t: WhyTemplate): [string, string][] {
  return [...t.text.matchAll(SLOT)].map((m) => [m[1] as string, m[2] as string]);
}

export function templateFor(why: WhyTemplates, when: string, kind: string, variant?: string): WhyTemplate {
  const t = why.templates.find((x) => x.when === when && (x.kinds === undefined || x.kinds.includes(kind)) && (x.variant === undefined || x.variant === variant));
  if (t === undefined) fail("unboundSlot", `no why template for ${when} (${kind})`);
  return t;
}

/**
 * Step 5c G1: which case of `when` the line describes, from the trace alone: the dominant matchup
 * multiplier's direction, the fluke's reason, or whether the baseline class share is common.
 */
export function variantFor(why: WhyTemplates, when: string, trace: readonly TraceEntry[]): string | undefined {
  if (when === "matchup") {
    const d = dominant(trace, why.order, why.minLogEffect);
    const m = d?.["multiplier"];
    return typeof m === "number" ? (m >= 1 ? "up" : "down") : undefined;
  }
  if (when === "fluke") {
    const r = trace.find((e) => e.factor === "fluke")?.["reason"];
    return typeof r === "string" ? r : undefined;
  }
  if (when === "baseline") {
    const pct = trace.find((e) => e.factor === "class")?.["pct"];
    return typeof pct === "number" && pct >= (why.commonAtLeastPct ?? 0) ? "common" : "plain";
  }
  return undefined;
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
