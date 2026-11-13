// Baseline offense play caller. Shares first (no RNG), then sampling. The pipeline's
// pipeline/caller/shares.py computes the same shares with the same arithmetic in the same
// order; data/caller/golden.json pins the two together.

import type { CallerData, FactorTable, LateKneelMask, Situation } from "../../../shared/src/types";
import type { Rng } from "../rng";
import { indexCatalog, type AvailabilityIndex } from "./availability";
import { binSituation, type BinLabels } from "./bins";
import { lookup, requireLookup, type Lookup } from "./lookup";
import { fieldGoalMakeChance, type FieldGoalRange } from "./range";
import { sampleIndex } from "./sample";

export const RUN_PLAYS = ["insideRun", "outsideRun", "qbSneak"] as const;
export const PASS_PLAYS = ["shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"] as const;
/** Every offense play that takes a formation, in catalog order. */
export const FORMATION_PLAYS: readonly string[] = [...RUN_PLAYS, ...PASS_PLAYS];
const TOP_ALWAYS_AVAILABLE = ["run", "pass"];

export interface OffenseLeaf {
  /** Catalog id of the call: a scrimmage play, "extraPoint" or "goForTwo". */
  readonly call: string;
  /** For "goForTwo", the play run on the try. */
  readonly twoPointPlay?: string;
  readonly p: number;
}

export interface OffenseShares {
  /** Every leaf call in catalog order, with its probability. Sums to 1. */
  readonly leaves: readonly OffenseLeaf[];
  /** The factor cells used, for the golden file and for debugging. */
  readonly trace: Readonly<Record<string, Lookup>>;
}

export interface OffenseCall {
  readonly call: string;
  readonly twoPointPlay?: string;
  readonly formation?: string;
}

const indexCache = new WeakMap<object, AvailabilityIndex>();
function availability(data: CallerData): AvailabilityIndex {
  let idx = indexCache.get(data.catalog);
  if (idx === undefined) {
    idx = indexCatalog(data.catalog);
    indexCache.set(data.catalog, idx);
  }
  return idx;
}

function w(l: Lookup, i: number): number {
  return (l.weights[i] ?? 0) / l.total;
}

/** Run and pass leaves under a run share and a pass share, in catalog order. */
function playLeaves(pRun: number, pPass: number, run: Lookup, passType: Lookup, depth: Lookup): number[] {
  const pPlain = pPass * w(passType, 2);
  return [
    pRun * w(run, 0),
    pRun * w(run, 1),
    pRun * w(run, 2),
    pPlain * w(depth, 0),
    pPlain * w(depth, 1),
    pPlain * w(depth, 2),
    pPass * w(passType, 0),
    pPass * w(passType, 1),
  ];
}

/**
 * The average coach's designed masks (M1 step 5c). The fitted tables and their Python mirror
 * (pipeline/caller/shares.py) are unmasked; only the game applies these. A masked call gets
 * share 0 and every other call keeps its relative fitted weight.
 */
export interface CallerMasks {
  /** Milestone B (Resolved 3): no field goal try where the engine's make chance is 0 (range.ts). */
  readonly fieldGoals?: FieldGoalRange;
  /** Milestone E: the game clock is stopped before this snap, so a spike would only lose a down. */
  readonly clockStopped?: boolean;
  /** Milestone F: no kneel in `quarters`, nor in `halfEndQuarter` with more than `secondsAbove` left in the half. */
  readonly earlyKneel?: { readonly quarters: readonly number[]; readonly halfEndQuarter: number; readonly secondsAbove: number };
  /** Step 5d milestone D: no kneel in these late states (each with 0 real kneels in 2016-2023). */
  readonly lateKneel?: LateKneelMask;
}

/** Whether a step 5d late-kneel state covers this situation. */
export function inLateKneelMask(situation: Situation, m: LateKneelMask): boolean {
  if (situation.quarter < m.quarterMin) return false;
  return m.states.some(
    (st) =>
      (st.scoreMin === undefined || situation.scoreDiff >= st.scoreMin) &&
      (st.scoreMax === undefined || situation.scoreDiff <= st.scoreMax) &&
      (st.secondsAbove === undefined || situation.secondsLeftInGame > st.secondsAbove) &&
      (st.yardLine100Above === undefined || situation.yardLine100 > st.yardLine100Above),
  );
}

/** Top-level targets the masks remove in this situation. */
export function maskedCalls(situation: Situation, masks: CallerMasks): ReadonlySet<string> {
  const out = new Set<string>();
  if (masks.fieldGoals !== undefined && fieldGoalMakeChance(situation.yardLine100, masks.fieldGoals) === 0) out.add("fieldGoal");
  if (masks.clockStopped === true) out.add("spike");
  const k = masks.earlyKneel;
  if (k !== undefined && (k.quarters.includes(situation.quarter) || (situation.quarter === k.halfEndQuarter && situation.secondsLeftInHalf > k.secondsAbove))) out.add("kneel");
  if (masks.lateKneel !== undefined && inLateKneelMask(situation, masks.lateKneel)) out.add("kneel");
  return out;
}

export function offenseShares(situation: Situation, data: CallerData, masks: CallerMasks = {}): OffenseShares {
  const labels = binSituation(situation, data.config.dimensions);
  const f = data.offense.factors;
  if (situation.phase === "try") {
    const tryCell = tryChartLookup(data, labels) ?? requireLookup("oTry", f.oTry, labels);
    const top = requireLookup("tpTop", f.tpTop, labels);
    const run = requireLookup("tpRun", f.tpRun, labels);
    const passType = requireLookup("tpPassType", f.tpPassType, labels);
    const depth = requireLookup("tpDepth", f.tpDepth, labels);
    const pTwo = w(tryCell, 1);
    const plays = playLeaves(pTwo * w(top, 0), pTwo * w(top, 1), run, passType, depth);
    return {
      leaves: [
        { call: "extraPoint", p: w(tryCell, 0) },
        ...FORMATION_PLAYS.map((play, i) => ({ call: "goForTwo", twoPointPlay: play, p: plays[i] ?? 0 })),
      ],
      trace: { oTry: tryCell, tpTop: top, tpRun: run, tpPassType: passType, tpDepth: depth },
    };
  }

  const topTable = f.oTop;
  if (topTable === undefined) throw new RangeError("missing factor table oTop");
  const avail = availability(data);
  const trace: Record<string, Lookup> = {};
  // Top-level shares in oTop target order: run, pass, punt, fieldGoal, spike, kneel.
  let top: number[];
  const blocked = maskedCalls(situation, masks);
  const fourth = f.o4Top;
  if (fourth !== undefined && fourth.downs?.includes(situation.down) === true) {
    // 4th down: go, kick or clock from o4Top, then punt or field goal given a kick.
    const go = maskedLookup(fourth, labels, fourth.targets.map((t) => avail.isAvailable(t, situation)));
    const kick = requireLookup("o4Kick", f.o4Kick, labels);
    trace["o4Top"] = go;
    trace["o4Kick"] = kick;
    const pKick = w(go, 2);
    top = [w(go, 0), w(go, 1), pKick * w(kick, 0), pKick * w(kick, 1), w(go, 3), w(go, 4)];
    // Top order: run, pass, punt, fieldGoal, spike, kneel (oTop's targets).
    const gone = topTable.targets.map((t) => blocked.has(t));
    const lost = top.reduce((a, x, i) => a + (gone[i] === true ? x : 0), 0);
    if (lost > 0) {
      const rest = 1 - lost;
      // A cell of masked calls only (none in the fitted tables) leaves a punt.
      top = rest > 0 ? top.map((x, i) => (gone[i] === true ? 0 : x / rest)) : [0, 0, 1, 0, 0, 0];
    }
  } else {
    const t = maskedLookup(topTable, labels, topTable.targets.map((x) => avail.isAvailable(x, situation) && !blocked.has(x)));
    trace["oTop"] = t;
    top = topTable.targets.map((_, i) => w(t, i));
  }
  const run = requireLookup("oRun", f.oRun, labels);
  const passType = requireLookup("oPassType", f.oPassType, labels);
  const depth = requireLookup("oDepth", f.oDepth, labels);
  const plays = playLeaves(top[0] ?? 0, top[1] ?? 0, run, passType, depth);
  const leaves: OffenseLeaf[] = FORMATION_PLAYS.map((play, i) => ({ call: play, p: plays[i] ?? 0 }));
  // Kicks and clock calls: oTop targets after run and pass, already in catalog order.
  for (let i = 2; i < topTable.targets.length; i++) {
    leaves.push({ call: topTable.targets[i] as string, p: top[i] ?? 0 });
  }
  trace["oRun"] = run;
  trace["oPassType"] = passType;
  trace["oDepth"] = depth;
  return { leaves, trace };
}

/**
 * Step 5c milestone C: the designed late try chart (config `tryChart`) decides a charted cell
 * outright; level -2 marks it in the trace. Mirrors pipeline/caller/shares.py `_try_chart`.
 */
function tryChartLookup(data: CallerData, labels: BinLabels): Lookup | null {
  const chart = data.config.tryChart;
  if (chart === undefined) return null;
  const w = labels[chart.window];
  const sc = labels[chart.score];
  if (w === undefined || w === null || sc === undefined || sc === null) return null;
  const choice = chart.cells[`${w}|${sc}`];
  if (choice === undefined) return null;
  return { level: -2, key: `chart|${w}|${sc}`, weights: choice === "goForTwo" ? [0, 1] : [1, 0], total: 1 };
}

/**
 * Masked backoff lookup for a top-level factor. The catalog guarantees Run and Pass are
 * always available; if every level masks to nothing (never with real tables, whose global
 * cell has run and pass weight), split evenly between them.
 */
function maskedLookup(table: FactorTable, labels: BinLabels, mask: readonly boolean[]): Lookup {
  return (
    lookup(table, labels, {}, mask) ?? {
      level: -1,
      key: "",
      weights: table.targets.map((t) => (TOP_ALWAYS_AVAILABLE.includes(t) ? 1 : 0)),
      total: TOP_ALWAYS_AVAILABLE.length,
    }
  );
}

/** Formation weights for a run or pass play in this situation. No RNG. */
export function formationShares(situation: Situation, play: string, data: CallerData, labels?: BinLabels): Lookup {
  const l = labels ?? binSituation(situation, data.config.dimensions);
  return requireLookup("oFormation", data.offense.factors.oFormation, l, { leaf: play });
}

/** Picks a leaf call, then (for a run or pass) a formation given that play. Two draws. */
export function chooseOffenseCall(situation: Situation, data: CallerData, rng: Rng, masks: CallerMasks = {}): OffenseCall {
  const shares = offenseShares(situation, data, masks);
  const leaf = shares.leaves[sampleIndex(shares.leaves.map((l) => l.p), rng)];
  if (leaf === undefined) throw new RangeError("sampled leaf out of range");
  const play = leaf.twoPointPlay ?? leaf.call;
  if (!FORMATION_PLAYS.includes(play)) return { call: leaf.call };
  const form = formationShares(situation, play, data);
  const targets = data.offense.factors.oFormation?.targets ?? [];
  const formation = targets[sampleIndex(form.weights, rng)];
  if (formation === undefined) throw new RangeError("sampled formation out of range");
  return leaf.twoPointPlay === undefined
    ? { call: leaf.call, formation }
    : { call: leaf.call, twoPointPlay: leaf.twoPointPlay, formation };
}
