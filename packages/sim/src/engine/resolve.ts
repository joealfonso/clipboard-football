// The play engine. createEngine(data) returns resolvePlay(state, offenseCall, defenseCall,
// players, rng): the only function that sees both calls. It decides every outcome; the state
// machine (packages/sim/src/game) applies the rules to the PlayResult it returns.
//
// For a run or pass: the baseline cell gives the fitted class probabilities for the leaf in
// this situation (backoff in data/engine/config.json). Matchup, formation and rating
// multipliers tilt them, the class is drawn, and a real play of that class is drawn from its
// pool with its season weight, untouched. Its yards are applied at the current spot. Fouls are
// drawn separately at fitted rates and paired with a physical play by the designed pairing
// table. Every draw goes through the Rng passed in, in a fixed order.

import type { BallEnd, Foul, PlayResult, PlaySide, Situation } from "../../../shared/src/types";
import type { Dimension } from "../../../shared/src/types";
import type { EngineData, PairingRule, RatingEffect, TeamPool, WhyTemplate } from "../../../shared/src/engine";
import { binSituation, type BinLabels } from "../caller/bins";
import type { OffenseCall } from "../caller/offense";
import { makeChanceAt } from "../caller/range";
import { FIELD_LENGTH, flip } from "../game/frame";
import { toSituation } from "../game/situation";
import type { GameState } from "../game/types";
import type { Rng } from "../rng";
import { applyEffect, leagueMeans, type Field } from "./effects";
import { fail } from "./errors";
import { onField } from "./players";
import { backoff, drawIndex, drawTuple, drawWeighted } from "./tables";
import { dominant, isFluke, render, round2, templateFor, variantFor, type TraceEntry } from "./why";

/** Both teams' player pools. The offense is the team in possession. */
export interface Players {
  readonly home: TeamPool;
  readonly away: TeamPool;
  /**
   * Optional (M1 step 5 home field, designed): a factor on the offense's own pre-snap foul rates
   * (false start, delay of game) by the team in possession. Absent means 1 for both.
   */
  readonly offensePreSnapFoulScale?: { readonly home: number; readonly away: number };
}

export type ResolvePlay = (state: GameState, offenseCall: OffenseCall, defenseCall: string | null, players: Players, rng: Rng) => PlayResult;

// Outcome tuple flags (pipeline/engine/classes.py).
const OB = 1;
const TD = 2;
const INT = 4;
const FUM_LOST = 8;
const DEF_TD = 16;
const FUM_OOB = 32;
const REGAINED = 64;
// Punt tuple flags (pipeline/engine/special.py).
const P_KICKERS = 1;
const P_DEF_TD = 2;
const P_SAFETY = 4;
// Blocked field goal tuple flags.
const B_KICKERS = 1;
const B_DEF_TD = 2;

const IN_OWN_END_ZONE = -1;
/** Inside this many yards of the goal the second pool level (zoneR) is also 5-yard bands. */
const FINE_BAND_YARDS = 10;
const IN_OPP_END_ZONE = FIELD_LENGTH + 1;
const PER_MILLION = 1_000_000;
const SHARE_TOTAL = 10_000;

/**
 * A base class chance in percent, rounded down to 0.1 (step 5c, lead's call): the fluke line quotes it,
 * and a chance under the fluke threshold must never print at or above it (4.97% prints as 4.9%). The
 * 1e-9 keeps an exact tenth (for example 3.1%) from flooring to the tenth below.
 */
function pctDown(share: number): number {
  return Math.floor(share * PCT * 10 + 1e-9) / 10;
}
const PCT = 100;

interface FoulDef {
  readonly id: string;
  readonly idx: number;
  readonly pairing: PairingRule;
  readonly timing: string;
  readonly committedBy: string;
}

interface Compiled {
  readonly dims: Readonly<Record<string, Dimension>>;
  readonly leafFamily: Readonly<Record<string, string>>;
  readonly classEffects: Readonly<Record<string, readonly { effect: RatingEffect; classes: readonly number[] }[]>>;
  readonly penaltyEffects: Readonly<Record<string, readonly RatingEffect[]>>;
  readonly kickEffects: Readonly<Record<string, readonly { effect: RatingEffect; classes: readonly number[] }[]>>;
  readonly fouls: readonly FoulDef[];
  readonly means: ReturnType<typeof leagueMeans>;
  readonly presetLabel: Readonly<Record<string, string>>;
  /** Pre-snap fouls only the offense commits (the home-field crowd-noise factor applies to them). */
  readonly offensePreSnap: ReadonlySet<string>;
}

function compile(data: EngineData): Compiled {
  const leafFamily: Record<string, string> = {};
  for (const [fam, def] of Object.entries(data.scrimmage.families)) for (const l of def.leaves) leafFamily[l] = fam;
  const classEffects: Record<string, { effect: RatingEffect; classes: number[] }[]> = {};
  const penaltyEffects: Record<string, RatingEffect[]> = {};
  const kickClasses: Record<string, readonly string[]> = {
    punt: data.special.punts.classes,
    fieldGoal: ["good", "miss", "blocked"],
    extraPoint: data.special.extraPoints.classes,
    kickoff: data.kickoff.kickoff.classes,
  };
  const kickEffects: Record<string, { effect: RatingEffect; classes: number[] }[]> = {};
  for (const e of data.ratings.effects) {
    const t = e.target;
    if (t.kind === "class") {
      for (const fam of t.families) {
        const classes = data.scrimmage.families[fam]?.classes ?? [];
        (classEffects[fam] ??= []).push({ effect: e, classes: t.classes.map((c) => classes.indexOf(c)) });
      }
    } else if (t.kind === "penalty") {
      for (const p of t.penalties) (penaltyEffects[p] ??= []).push(e);
    } else {
      const classes = kickClasses[t.kind] ?? [];
      (kickEffects[t.kind] ??= []).push({ effect: e, classes: t.classes.map((c) => classes.indexOf(c)) });
    }
  }
  const fouls: FoulDef[] = [];
  data.penalties.ids.forEach((id, idx) => {
    const pairing = data.config.penalties.pairing[id];
    const rule = data.rules.penalties[id];
    if (pairing === undefined || typeof pairing === "string" || rule === undefined) return;
    fouls.push({ id, idx, pairing, timing: rule.timing, committedBy: rule.committedBy });
  });
  const presetLabel: Record<string, string> = {};
  for (const s of data.caller.catalog.screens) for (const c of s.choices) presetLabel[c.id] = c.label;
  return {
    dims: { ...data.caller.config.dimensions, ...data.config.dimensions },
    leafFamily,
    classEffects,
    penaltyEffects,
    kickEffects,
    fouls,
    means: leagueMeans(data.distributions),
    presetLabel,
    offensePreSnap: new Set(fouls.filter((f) => f.timing === "preSnap" && f.committedBy === "offense").map((f) => f.id)),
  };
}

const RUN_PASS_CALLS = new Set(["insideRun", "outsideRun", "qbSneak", "shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"]);

export function createEngine(data: EngineData): ResolvePlay {
  const c = compile(data);
  const why = data.why;
  const label = (k: string): string => why.labels[k] ?? k;
  const minS = data.config.durations.minSeconds;

  // ------------------------------------------------------------ shared pieces

  interface Ctx {
    readonly state: GameState;
    readonly rng: Rng;
    readonly trace: TraceEntry[];
    readonly offense: Field;
    readonly defense: Field;
    /** Factor on the offense's pre-snap foul rates (home field); 1 by default. */
    readonly preSnapScale: number;
  }

  function seconds(hist: readonly number[] | undefined, rng: Rng): number {
    if (hist === undefined) return fail("noCell", "no duration histogram");
    return minS + drawIndex(hist, rng);
  }

  /**
   * Rating multipliers per class. A class effect on a group of classes with baseline share q
   * uses m + q (m - 1)^2 instead of m: renormalizing within the family is concave in m, so
   * without this second-order term a spread of generated teams averages slightly below the
   * baseline (D5). Exactly 1 at edge 0 either way.
   */
  function effectProduct(
    effects: readonly { effect: RatingEffect; classes: readonly number[] }[] | undefined,
    n: number,
    ctx: Ctx,
    applies: (e: RatingEffect) => boolean,
    base: ArrayLike<number>,
  ): { mult: Float64Array; applied: { id: string; label: string; classes: readonly number[]; m: number }[] } {
    const mult = new Float64Array(n).fill(1);
    const applied: { id: string; label: string; classes: readonly number[]; m: number }[] = [];
    for (const { effect, classes } of effects ?? []) {
      if (!applies(effect)) continue;
      const a = applyEffect(effect, ctx.offense, ctx.defense, c.means);
      if (a.multiplier === 1) continue;
      let q = 0;
      for (const k of classes) if (k >= 0) q += base[k] as number;
      const d = a.multiplier - 1;
      const m = Math.min(effect.max, Math.max(effect.min, a.multiplier + q * d * d));
      for (const k of classes) if (k >= 0) mult[k] = (mult[k] as number) * m;
      applied.push({ id: effect.id, label: effect.label, classes, m });
    }
    return { mult, applied };
  }

  /** Foul probabilities per snap for a penalty family in this situation, rating effects applied. */
  function foulRates(pfamily: string, labels: BinLabels, ctx: Ctx): Float64Array {
    const tables = data.penalties.families[pfamily];
    if (tables === undefined) return fail("noCell", `no penalty table for ${pfamily}`);
    const row = backoff(data.penalties.levels, tables, labels, { pfamily }, `penalty ${pfamily}`).value;
    const out = new Float64Array(row.length);
    for (let i = 0; i < row.length; i++) {
      let r = (row[i] as number) / PER_MILLION;
      if (r > 0) {
        const id = data.penalties.ids[i] as string;
        for (const e of c.penaltyEffects[id] ?? []) r *= applyEffect(e, ctx.offense, ctx.defense, c.means).multiplier;
        if (ctx.preSnapScale !== 1 && c.offensePreSnap.has(id)) r *= ctx.preSnapScale;
      }
      out[i] = r;
    }
    return out;
  }

  function sideFor(f: FoulDef, rng: Rng): PlaySide {
    if (f.committedBy === "offense" || f.committedBy === "defense") return f.committedBy;
    const share = data.penalties.offenseSharePer10000[f.id] ?? SHARE_TOTAL / 2;
    return rng.nextFloat() * SHARE_TOTAL < share ? "offense" : "defense";
  }

  /** Live fouls that can go into a both-teams pair, for one side. */
  function doubleCands(family: string, side: PlaySide): FoulDef[] {
    return c.fouls.filter(
      (f) => f.pairing.families.includes(family) && f.pairing.pairs === "sampled" && f.timing === "live" && (f.committedBy === side || f.committedBy === "either"),
    );
  }

  function doubleRate(family: string, onTry: boolean): number {
    return (family === "run" || family === "pass") && !onTry ? data.penalties.doublePer1000000 / PER_MILLION : 0;
  }

  /**
   * Every foul the play could draw, recorded before any draw (detail.foulRates): for each id the
   * probability that the snap carries it (one-team fouls plus its share of both-teams pairs),
   * plus anyFlag (at least one foul) and twoFlags (fouls by both teams).
   */
  function recordRates(family: string, rates: Float64Array, out: Record<string, number>, onTry: boolean): void {
    let any = 0;
    for (const f of c.fouls) {
      if (!f.pairing.families.includes(family) || (onTry && f.timing === "afterPlay")) continue;
      out[f.id] = rates[f.idx] as number;
      any += rates[f.idx] as number;
    }
    const d = doubleRate(family, onTry);
    if (d > 0) {
      for (const side of ["offense", "defense"] as const) {
        const xs = doubleCands(family, side);
        const tot = xs.reduce((a, x) => a + (rates[x.idx] as number), 0);
        if (tot > 0) for (const x of xs) out[x.id] = (out[x.id] ?? 0) + (d * (rates[x.idx] as number)) / tot;
      }
    }
    out["anyFlag"] = any + d;
    out["twoFlags"] = d;
  }

  /** Sum of the pre-snap foul rates for a family: the share of snaps that never reach a live draw. */
  function preSnapTotal(family: string, rates: Float64Array): number {
    let t = 0;
    for (const f of c.fouls) if (allowed(f, family, false)) t += rates[f.idx] as number;
    return t;
  }

  function allowed(f: FoulDef, family: string, live: boolean): boolean {
    if (!f.pairing.families.includes(family)) return false;
    return live ? f.timing !== "preSnap" : f.timing === "preSnap";
  }

  /** One draw: a pre-snap foul (which replaces the play) or none. */
  function preSnap(family: string, rates: Float64Array, ctx: Ctx): Foul | null {
    const cands = c.fouls.filter((f) => allowed(f, family, false));
    const u = ctx.rng.nextFloat();
    let acc = 0;
    let hit: FoulDef | null = null;
    for (const f of cands) {
      const r = rates[f.idx] as number;
      acc += r;
      if (hit === null && u < acc) hit = f;
    }
    if (hit === null) return null;
    return { penalty: hit.id, by: sideFor(hit, ctx.rng) };
  }

  function noPlay(foul: Foul, callLabel: string, callId: string, ctx: Ctx, detail: Record<string, unknown>): PlayResult {
    ctx.trace.push({ factor: "call", label: callLabel, leaf: callId, kind: callId });
    ctx.trace.push({ factor: "penalty", id: foul.penalty, label: label(foul.penalty), side: label(foul.by) });
    return finish({ kind: "noPlay", seconds: 0, fouls: [foul] }, ctx, "penalty", detail);
  }

  function finish(play: PlayResult, ctx: Ctx, when: string, detail: Record<string, unknown>): PlayResult {
    const t: WhyTemplate = templateFor(why, when, play.kind, variantFor(why, when, ctx.trace));
    const r = render(t, ctx.trace);
    return { ...play, detail: { ...detail, why: r.text, whyTemplate: r.template, trace: ctx.trace } } as PlayResult;
  }

  function whenFor(ctx: Ctx, fouls: readonly Foul[] | undefined, fluke: boolean, fallback: string): string {
    if (fluke) return "fluke";
    if (fouls !== undefined && fouls.length > 0) return "penalty";
    if (fallback !== "scrimmage") return fallback;
    const d = dominant(ctx.trace, why.order, why.minLogEffect);
    return d === null ? "baseline" : d.factor;
  }

  // ------------------------------------------------------------ runs and passes

  interface Physical {
    play: PlayResult & { kind: "run" | "pass" | "sack" | "scramble" | "twoPoint" };
    turnover: boolean;
    inField: boolean;
  }

  function physicalScrimmage(kind: "run" | "pass" | "sack" | "scramble", cls: string, tuple: readonly number[], at: number, los: number, secs: number, sameBand: boolean): Physical {
    const y = tuple[at] as number;
    const flags = tuple[at + 1] as number;
    const ty = tuple[at + 2] as number;
    const ry = tuple[at + 3] as number;
    if (cls === "inc") {
      return { play: { kind: "pass", seconds: secs, incomplete: true, end: { spot: los, possession: "offense" } }, turnover: false, inField: true };
    }
    if ((flags & (INT | FUM_LOST)) !== 0) {
      const lostAt = los + ty;
      let end: BallEnd;
      if ((flags & DEF_TD) !== 0) end = { spot: IN_OWN_END_ZONE, possession: "defense" };
      else {
        const spot = lostAt - ry;
        if ((flags & INT) !== 0 && lostAt >= FIELD_LENGTH && spot >= FIELD_LENGTH) end = { spot: IN_OPP_END_ZONE, possession: "defense" };
        else end = { spot: Math.min(FIELD_LENGTH - 1, Math.max(1, spot)), possession: "defense" };
      }
      const play = {
        kind,
        seconds: secs,
        end,
        turnover: (flags & INT) !== 0 ? ("interception" as const) : ("fumble" as const),
        ...((flags & DEF_TD) !== 0 ? { touchdown: true } : {}),
      };
      return { play, turnover: true, inField: end.spot > 0 && end.spot < FIELD_LENGTH };
    }
    let spot = los + y;
    let td = false;
    // Post-validation revision 8: a pooled play that scored is a touchdown here only when it was
    // drawn from this spot's own band (`sameBand`: 5 yards or fewer inside the 10), where its yards stop at most 4 yards
    // short of what it would have gained; drawn from a coarser backoff pool, it scores only if
    // its yards reach the goal line from this spot. Before, the flag scored it from anywhere in
    // a 10-yard band or wider.
    if ((sameBand && (flags & TD) !== 0) || spot >= FIELD_LENGTH) {
      spot = IN_OPP_END_ZONE;
      td = true;
    } else if (spot <= 0) spot = IN_OWN_END_ZONE;
    const inField = spot > 0 && spot < FIELD_LENGTH;
    const play = {
      kind,
      seconds: secs,
      end: { spot, possession: "offense" as const },
      ...(inField && (flags & OB) !== 0 ? { outOfBounds: true } : {}),
      ...(inField && (flags & FUM_OOB) !== 0 ? { fumbleOutOfBounds: true } : {}),
      ...((flags & REGAINED) !== 0 ? { defensePossessedDuringPlay: true } : {}),
      ...(td ? { touchdown: true } : {}),
    };
    return { play, turnover: (flags & REGAINED) !== 0, inField };
  }

  function kindFor(family: string, cls: string): "run" | "pass" | "sack" | "scramble" {
    if (family === "run") return "run";
    if (cls === "sack") return "sack";
    if (cls === "scramble") return "scramble";
    return "pass";
  }

  interface ClassDraw {
    readonly cls: string;
    readonly k: number;
    readonly base: number;
    readonly p: number;
    readonly probs: Record<string, number>;
    readonly classes: readonly string[];
    /** Trace entries (class, and the multipliers on it) for class index j. */
    readonly entries: (j: number) => TraceEntry[];
    readonly baseOf: (j: number) => number;
  }

  /** Multipliers, the draw, and the trace entries for the drawn class. */
  function drawClass(
    family: string,
    leaf: string,
    formation: string,
    preset: string,
    pkg: string,
    baseW: readonly number[],
    sit: Situation,
    ctx: Ctx,
  ): ClassDraw {
    const classes = data.scrimmage.families[family]?.classes ?? [];
    const n = classes.length;
    const mm = data.matchup.matchup[leaf]?.[preset];
    const fm = data.matchup.formation[leaf]?.[formation]?.[pkg];
    if (mm === undefined || fm === undefined) return fail("noCell", `no centered matchup for ${leaf} ${preset} ${formation} ${pkg}`);
    let baseTotal = 0;
    for (let k = 0; k < n; k++) baseTotal += baseW[k] as number;
    const baseP = Array.from({ length: n }, (_x, k) => (baseW[k] as number) / baseTotal);
    const eff = effectProduct(c.classEffects[family], n, ctx, (e) => {
      const t = e.target;
      if (t.kind !== "class") return false;
      if (t.leaves !== undefined && !t.leaves.includes(leaf)) return false;
      if (t.maxYardsToGo !== undefined && !(sit.phase === "scrimmage" && sit.yardsToGo <= t.maxYardsToGo)) return false;
      return true;
    }, baseP);
    let total = 0;
    const w = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      w[k] = ((baseW[k] as number) / baseTotal) * (mm[k] as number) * (fm[k] as number) * (eff.mult[k] as number);
      total += w[k] as number;
    }
    const k = drawIndex(w, ctx.rng);
    const cls = classes[k] as string;
    const base = (baseW[k] as number) / baseTotal;
    const p = (w[k] as number) / total;
    const probs: Record<string, number> = {};
    classes.forEach((cl, i) => (probs[cl] = (w[i] as number) / total));
    const entries = (j: number): TraceEntry[] => {
      const cj = classes[j] as string;
      const out: TraceEntry[] = [
        { factor: "class", name: cj, label: label(cj), basePct: pctDown((baseW[j] as number) / baseTotal), pct: Math.round(((w[j] as number) / total) * PCT) },
      ];
      if (mm[j] !== 1) out.push({ factor: "matchup", preset, presetLabel: c.presetLabel[preset] ?? preset, class: cj, multiplier: round2(mm[j] as number) });
      if (fm[j] !== 1) out.push({ factor: "formation", formation, formationLabel: label(formation), package: pkg, packageLabel: label(pkg), class: cj, multiplier: round2(fm[j] as number) });
      for (const a of eff.applied) if (a.classes.includes(j)) out.push({ factor: "rating", effect: a.id, label: a.label, class: cj, multiplier: round2(a.m) });
      return out;
    };
    const baseOf = (j: number): number => (baseW[j] as number) / baseTotal;
    return { cls, k, base, p, probs, classes, entries, baseOf };
  }

  function liveFouls(
    family: string,
    rates: Float64Array,
    ph: Physical,
    los: number,
    ctx: Ctx,
    onTry: boolean,
  ): { fouls: Foul[]; replace: "incompletePass" | null } {
    // Step 5c G2 (designed): a scrambling quarterback is a runner, not a passer (docs/RULES.md).
    const noScramble = ph.play.kind === "scramble" ? (data.config.penalties.notOnScrambles ?? []) : [];
    const cands = c.fouls.filter((f) => allowed(f, family, true) && !(onTry && f.timing === "afterPlay") && !noScramble.includes(f.id));
    const double = doubleRate(family, onTry);
    // The live draw only happens when no pre-snap foul was drawn, so scale the uniform to the
    // remaining mass: each live category is then emitted at exactly its fitted per-snap rate.
    const u = ctx.rng.nextFloat() * (1 - preSnapTotal(family, rates));
    let acc = 0;
    let hit: FoulDef | null = null;
    for (const f of cands) {
      const r = rates[f.idx] as number;
      acc += r;
      if (hit === null && u < acc) hit = f;
    }
    if (hit === null && u < acc + double) {
      // Fouls by both teams: one each, in proportion to the sampled-pairing live rates.
      if (ph.turnover) return { fouls: [], replace: null };
      const pickSide = (side: PlaySide): Foul | null => {
        const xs = doubleCands(family, side).filter((f) => !noScramble.includes(f.id));
        if (xs.length === 0) return null;
        const f = xs[drawIndex(xs.map((x) => rates[x.idx] as number), ctx.rng)] as FoulDef;
        return { penalty: f.id, by: side };
      };
      const a = pickSide("offense");
      const b = pickSide("defense");
      return { fouls: a !== null && b !== null ? [a, b] : [], replace: null };
    }
    if (hit === null) return { fouls: [], replace: null };
    const by = sideFor(hit, ctx.rng);
    if (hit.pairing.pairs === "incompletePass") {
      if (hit.pairing.spot === "fitted") {
        const d = data.penalties.dpiYards;
        const yards = d.min + drawIndex(d.weights, ctx.rng);
        const spot = los + yards >= FIELD_LENGTH - 1 ? IN_OPP_END_ZONE : los + yards;
        return { fouls: [{ penalty: hit.id, by, spot }], replace: "incompletePass" };
      }
      if (hit.pairing.spot === "passer") return { fouls: [{ penalty: hit.id, by, spot: los - (hit.pairing.passerDepth ?? 0) }], replace: "incompletePass" };
      return { fouls: [{ penalty: hit.id, by }], replace: "incompletePass" };
    }
    if (hit.pairing.onlyWhenBallDeadInField === true && !(ph.inField && ph.play.end.spot > 0 && ph.play.end.spot < FIELD_LENGTH)) return { fouls: [], replace: null };
    return { fouls: [{ penalty: hit.id, by }], replace: null };
  }

  function runOrPass(ctx: Ctx, leaf: string, formation: string, preset: string, pkg: string, onTry: boolean): PlayResult {
    const s = ctx.state;
    const sit = toSituation(s, data.rules);
    const labels = binSituation(sit, c.dims);
    const family = c.leafFamily[leaf] as string;
    const callLabel = label(leaf);
    const rates_out: Record<string, number> = {};
    const detail: Record<string, unknown> = { preset, formation, foulRates: rates_out };
    const rates = foulRates(family, labels, ctx);
    recordRates(family, rates, rates_out, onTry);
    const pre = preSnap(family, rates, ctx);
    if (pre !== null) return noPlay(pre, callLabel, leaf, ctx, detail);
    ctx.trace.push({ factor: "call", label: callLabel, leaf, kind: leaf });
    const los = s.spot;
    const classes = data.scrimmage.families[family]?.classes ?? [];
    if (onTry) {
      const t = data.scrimmage.twoPoint[leaf];
      if (t === undefined) return fail("noCell", `no two-point table for ${leaf}`);
      ctx.trace.push({ factor: "cell", family, level: 0, key: `try:${t.source}` });
      const cd = drawClass(family, leaf, formation, preset, pkg, t.weights, sit, ctx);
      detail["classProbabilities"] = cd.probs;
      return finishRunPass(ctx, family, cd, t.pools[cd.cls], null, los, rates, onTry, detail, true);
    }
    const cell = backoff(data.scrimmage.levels, data.scrimmage.cells, labels, { leaf, formation, family }, `scrimmage ${leaf}`);
    ctx.trace.push({ factor: "cell", family, level: cell.level, key: cell.key });
    const p975 = (cell.value[classes.length] as number | undefined) ?? null;
    const cd = drawClass(family, leaf, formation, preset, pkg, cell.value.slice(0, classes.length), sit, ctx);
    detail["classProbabilities"] = cd.probs;
    const found = backoff(data.scrimmage.poolLevels, data.scrimmage.pools, labels, { leaf, class: cd.cls, family }, `pool ${leaf} ${cd.cls}`);
    return finishRunPass(ctx, family, cd, found.value, p975, los, rates, onTry, detail, found.level === 0 || (found.level === 1 && FIELD_LENGTH - los <= FINE_BAND_YARDS));
  }

  function finishRunPass(
    ctx: Ctx,
    family: string,
    cd: ClassDraw,
    pool: readonly number[] | undefined,
    p975: number | null,
    los: number,
    rates: Float64Array,
    onTry: boolean,
    detail: Record<string, unknown>,
    sameBand: boolean,
  ): PlayResult {
    if (pool === undefined) return fail("noCell", `no pool for ${family} ${cd.cls}`);
    const stride = data.scrimmage.poolFields.length + 1;
    const at = drawTuple(pool, stride, ctx.rng) * stride;
    const y = pool[at] as number;
    const durations = data.scrimmage.durations[family] ?? {};
    let ph = physicalScrimmage(kindFor(family, cd.cls), cd.cls, pool, at, los, 0, sameBand);
    const foul = liveFouls(family, rates, ph, los, ctx, onTry);
    const secs = seconds(durations[foul.replace === "incompletePass" ? "inc" : cd.cls] ?? durations["*"], ctx.rng);
    if (foul.replace === "incompletePass") {
      ph = { play: { kind: "pass", seconds: secs, incomplete: true, end: { spot: los, possession: "offense" } }, turnover: false, inField: true };
    } else {
      ph = { ...ph, play: { ...ph.play, seconds: secs } };
    }
    let play: PlayResult = ph.play;
    if (onTry) {
      const p = ph.play;
      play = {
        kind: "twoPoint",
        seconds: secs,
        end: p.end,
        ...("incomplete" in p && p.incomplete === true ? { incomplete: true } : {}),
      };
    }
    // The play as enforced: a foul paired with an incompletion replaces the sampled play, so the
    // class, yards, trace and fluke check describe the incompletion, not the discarded draw.
    const replaced = foul.replace === "incompletePass";
    const kEnf = replaced ? cd.classes.indexOf("inc") : cd.k;
    const clsEnf = replaced ? "inc" : cd.cls;
    const yEnf = replaced ? 0 : y;
    for (const e of cd.entries(kEnf)) ctx.trace.push(e);
    if (foul.fouls.length > 0) {
      play = { ...play, fouls: foul.fouls };
      for (const f of foul.fouls) ctx.trace.push({ factor: "penalty", id: f.penalty, label: label(f.penalty), side: label(f.by) });
    }
    const yards = ph.turnover || clsEnf === "inc" ? null : yEnf;
    const fluke = isFluke(cd.baseOf(kEnf), yards, p975, data.config.fluke.classProbabilityBelow);
    if (fluke !== null) ctx.trace.push({ factor: "fluke", reason: fluke, what: label(fluke), ...(fluke === "yardsLong" ? { pctile: Math.round(data.config.fluke.yardsPercentile * 1000) / 10 } : {}) });
    detail["yards"] = yEnf;
    detail["class"] = clsEnf;
    // The class and yards drawn before any foul pairing (independent of the foul draw), which
    // the component validation compares with real plays that had no accepted foul.
    detail["sampledClass"] = cd.cls;
    detail["sampledYards"] = y;
    detail["fluke"] = fluke !== null;
    return finish(play, ctx, whenFor(ctx, play.fouls, fluke !== null, "scrimmage"), detail);
  }

  // ------------------------------------------------------------ kicks

  function kickClassDraw(
    kind: string,
    baseW: ArrayLike<number>,
    classes: readonly string[],
    ctx: Ctx,
    applies: (e: RatingEffect) => boolean = () => true,
  ): Pick<ClassDraw, "cls" | "k" | "base" | "p" | "probs"> {
    const n = classes.length;
    let bt = 0;
    for (let i = 0; i < n; i++) bt += baseW[i] as number;
    const eff = effectProduct(c.kickEffects[kind], n, ctx, applies, Array.from({ length: n }, (_x, i) => (baseW[i] as number) / bt));
    const w = new Float64Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      w[i] = ((baseW[i] as number) / bt) * (eff.mult[i] as number);
      total += w[i] as number;
    }
    const k = drawIndex(w, ctx.rng);
    const cls = classes[k] as string;
    const base = (baseW[k] as number) / bt;
    const p = (w[k] as number) / total;
    const probs: Record<string, number> = {};
    classes.forEach((cl, i) => (probs[cl] = (w[i] as number) / total));
    ctx.trace.push({ factor: "class", name: cls, label: label(cls), basePct: pctDown(base), pct: Math.round(p * PCT) });
    for (const a of eff.applied) if (a.classes.includes(k)) ctx.trace.push({ factor: "rating", effect: a.id, label: a.label, class: cls, multiplier: round2(a.m) });
    return { cls, k, base, p, probs };
  }

  function kickFoul(family: string, rates: Float64Array, ctx: Ctx, rates_out: Record<string, number>, ok: (f: FoulDef) => boolean, spot?: number): Foul[] {
    const cands = c.fouls.filter((f) => allowed(f, family, true));
    // The live draw only happens when no pre-snap foul was drawn, so scale the uniform to the
    // remaining mass: each live category is then emitted at exactly its fitted per-snap rate.
    const u = ctx.rng.nextFloat() * (1 - preSnapTotal(family, rates));
    let acc = 0;
    let hit: FoulDef | null = null;
    for (const f of cands) {
      const r = rates[f.idx] as number;
      acc += r;
      if (hit === null && u < acc) hit = f;
    }
    if (hit === null || !ok(hit)) return [];
    const by = sideFor(hit, ctx.rng);
    const needsSpot = data.rules.penalties[hit.id]?.enforcement === "spotOfFoul";
    if (needsSpot && spot === undefined) return [];
    return [needsSpot ? { penalty: hit.id, by, spot: spot as number } : { penalty: hit.id, by }];
  }

  function withFouls(play: PlayResult, fouls: Foul[], ctx: Ctx): PlayResult {
    if (fouls.length === 0) return play;
    for (const f of fouls) ctx.trace.push({ factor: "penalty", id: f.penalty, label: label(f.penalty), side: label(f.by) });
    return { ...play, fouls };
  }

  function clampField(x: number): number {
    return Math.min(FIELD_LENGTH - 1, Math.max(1, x));
  }

  function punt(ctx: Ctx): PlayResult {
    const s = ctx.state;
    const sit = toSituation(s, data.rules);
    const labels = binSituation(sit, c.dims);
    const rates_out: Record<string, number> = {};
    const detail: Record<string, unknown> = { foulRates: rates_out };
    const rates = foulRates("punt", labels, ctx);
    recordRates("punt", rates, rates_out, false);
    const pre = preSnap("punt", rates, ctx);
    if (pre !== null) return noPlay(pre, label("punt"), "punt", ctx, detail);
    ctx.trace.push({ factor: "call", label: label("punt"), leaf: "punt", kind: "punt" });
    const P = data.special.punts;
    const cell = backoff(P.levels, P.cells, labels, {}, "punt");
    const cd = kickClassDraw("punt", cell.value, P.classes, ctx);
    detail["classProbabilities"] = cd.probs;
    const pool = backoff(P.poolLevels, P.pools, labels, { class: cd.cls }, `punt pool ${cd.cls}`).value;
    const stride = P.fields.length + 1;
    const at = drawTuple(pool, stride, ctx.rng) * stride;
    const gross = pool[at] as number;
    const ret = pool[at + 1] as number;
    const flags = pool[at + 2] as number;
    const los = s.spot;
    const land = los + gross;
    const behind = data.config.punts.blockedEndBehindLine;
    let play: PlayResult & { kind: "punt" };
    let returnEnd: number | null = null;
    const base = { kind: "punt" as const, seconds: 0 };
    switch (cd.cls) {
      case "blocked": {
        let end: BallEnd;
        if ((flags & P_SAFETY) !== 0) end = { spot: IN_OWN_END_ZONE, possession: "offense" };
        else if ((flags & P_KICKERS) !== 0) end = { spot: Math.max(los - behind, IN_OWN_END_ZONE), possession: "offense" };
        else if ((flags & P_DEF_TD) !== 0) end = { spot: IN_OWN_END_ZONE, possession: "defense" };
        else end = { spot: clampField(los - behind - ret), possession: "defense" };
        if (end.spot === 0) end = { ...end, spot: IN_OWN_END_ZONE };
        play = { ...base, crossedLine: false, touchedByReceivers: false, end };
        break;
      }
      case "touchback":
        play = { ...base, crossedLine: true, touchedByReceivers: false, end: { spot: Math.max(IN_OPP_END_ZONE, Math.min(FIELD_LENGTH + 9, land)), possession: "defense" } };
        break;
      case "muffed":
        play =
          (flags & P_KICKERS) !== 0
            ? { ...base, crossedLine: true, touchedByReceivers: true, end: { spot: clampField(land), possession: "offense" } }
            : { ...base, crossedLine: true, touchedByReceivers: true, end: { spot: clampField(land - ret), possession: "defense" } };
        break;
      case "returnTD":
        play = { ...base, crossedLine: true, touchedByReceivers: false, end: { spot: IN_OWN_END_ZONE, possession: "defense" } };
        break;
      case "fairCatchShort":
      case "fairCatchLong":
        play = { ...base, crossedLine: true, touchedByReceivers: false, fairCatch: true, end: { spot: clampField(land), possession: "defense" } };
        break;
      case "returnedShort":
      case "returnedLong":
        returnEnd = clampField(land - ret);
        play = { ...base, crossedLine: true, touchedByReceivers: false, end: { spot: returnEnd, possession: "defense" } };
        break;
      default:
        play = { ...base, crossedLine: true, touchedByReceivers: false, end: { spot: clampField(land), possession: "defense" } };
    }
    // Post-validation revision 13: a pooled punt fielded, downed or out of bounds where it was,
    // but drawn from a line further back in its band, would here reach the goal line: it is a
    // touchback, not a ball at the receivers' 1 (the field clamp put 0.25 snaps a game there).
    let effCls = cd.cls;
    if ((cd.cls.startsWith("fairCatch") || cd.cls.startsWith("downed") || cd.cls.startsWith("outOfBounds")) && land >= FIELD_LENGTH) {
      play = { ...base, crossedLine: true, touchedByReceivers: false, end: { spot: Math.max(IN_OPP_END_ZONE, Math.min(FIELD_LENGTH + 9, land)), possession: "defense" } };
      effCls = "touchback";
    }
    // A receiving-team foul needs the receivers holding the ball in the field after the kick
    // (returned, fair catch, downed or out of bounds; post-validation revision 9: before, only a
    // return); spot 5 yards behind where they have it.
    const held = play.end !== undefined && play.end.possession === "defense" && play.end.spot > 0 && play.end.spot < FIELD_LENGTH && cd.cls !== "blocked";
    const holdAt = held ? (returnEnd ?? play.end.spot) : null;
    const fouls = kickFoul("punt", rates, ctx, rates_out, (f) => f.committedBy !== "defense" || holdAt !== null, holdAt === null ? undefined : clampField(holdAt + 5));
    play = { ...play, seconds: seconds(P.durations[cd.cls] ?? P.durations["*"], ctx.rng) };
    ctx.trace.push({ factor: "special", event: effCls, gross });
    const fluke = cd.base < data.config.fluke.classProbabilityBelow;
    if (fluke) ctx.trace.push({ factor: "fluke", reason: "classRare", what: label("classRare") });
    detail["class"] = effCls;
    detail["gross"] = gross;
    detail["returnYards"] = ret;
    detail["fluke"] = fluke;
    const out = withFouls(play, fouls, ctx);
    return finish(out, ctx, whenFor(ctx, out.fouls, fluke, "punt"), detail);
  }

  function fieldGoal(ctx: Ctx): PlayResult {
    const s = ctx.state;
    const sit = toSituation(s, data.rules);
    const labels = binSituation(sit, c.dims);
    const rates_out: Record<string, number> = {};
    const detail: Record<string, unknown> = { foulRates: rates_out };
    const rates = foulRates("fieldGoal", labels, ctx);
    recordRates("fieldGoal", rates, rates_out, false);
    const pre = preSnap("fieldGoal", rates, ctx);
    if (pre !== null) return noPlay(pre, label("fieldGoal"), "fieldGoal", ctx, detail);
    ctx.trace.push({ factor: "call", label: label("fieldGoal"), leaf: "fieldGoal", kind: "fieldGoal" });
    const F = data.special.fieldGoals;
    const kickSpot = Math.max(1, s.spot - F.kickDepth);
    const distance = flip(kickSpot) + data.rules.field.endZoneYards;
    const make = makeChanceAt(distance, { ...F, endZoneYards: data.rules.field.endZoneYards });
    const band = F.bands.findIndex((b) => distance >= b.min && distance <= b.max);
    const block = (F.blockPer10000[band < 0 ? F.bands.length - 1 : band] as number) / SHARE_TOTAL;
    const baseW = [(1 - block) * make, (1 - block) * (1 - make), block];
    const cd = kickClassDraw("fieldGoal", baseW, ["good", "miss", "blocked"], ctx, (e) => e.target.kind === "fieldGoal" && (e.target.minDistance === undefined || distance >= e.target.minDistance));
    detail["classProbabilities"] = cd.probs;
    ctx.trace.push({ factor: "fieldGoal", distance, pct: Math.round(cd.p * PCT) });
    let play: PlayResult & { kind: "fieldGoal" };
    if (cd.cls === "good") play = { kind: "fieldGoal", seconds: 0, good: true, kickSpot };
    else if (cd.cls === "miss") play = { kind: "fieldGoal", seconds: 0, good: false, kickSpot };
    else {
      const bp = F.blockedPool;
      const stride = bp.fields.length + 1;
      const at = drawTuple(bp.tuples, stride, ctx.rng) * stride;
      const ret = bp.tuples[at] as number;
      const flags = bp.tuples[at + 1] as number;
      const behind = data.config.fieldGoals.blockedEndBehindLine;
      const end: BallEnd =
        (flags & B_KICKERS) !== 0
          ? { spot: Math.max(1, s.spot - behind), possession: "offense" }
          : (flags & B_DEF_TD) !== 0
            ? { spot: IN_OWN_END_ZONE, possession: "defense" }
            : { spot: clampField(s.spot - behind - ret), possession: "defense" };
      play = { kind: "fieldGoal", seconds: 0, good: false, kickSpot, end, crossedLine: false, touchedByReceivers: false };
    }
    play = { ...play, seconds: seconds(F.durations[cd.cls] ?? F.durations["*"], ctx.rng) };
    const fouls = kickFoul("fieldGoal", rates, ctx, rates_out, () => true);
    const fluke = cd.base < data.config.fluke.classProbabilityBelow;
    if (fluke) ctx.trace.push({ factor: "fluke", reason: "classRare", what: label("classRare") });
    detail["class"] = cd.cls;
    detail["distance"] = distance;
    detail["fluke"] = fluke;
    const out = withFouls(play, fouls, ctx);
    return finish(out, ctx, whenFor(ctx, out.fouls, fluke, "fieldGoal"), detail);
  }

  function extraPoint(ctx: Ctx): PlayResult {
    const s = ctx.state;
    const sit = toSituation(s, data.rules);
    const labels = binSituation(sit, c.dims);
    const rates_out: Record<string, number> = {};
    const detail: Record<string, unknown> = { foulRates: rates_out };
    const rates = foulRates("extraPoint", labels, ctx);
    recordRates("extraPoint", rates, rates_out, false);
    const pre = preSnap("extraPoint", rates, ctx);
    if (pre !== null) return noPlay(pre, label("extraPoint"), "extraPoint", ctx, detail);
    ctx.trace.push({ factor: "call", label: label("extraPoint"), leaf: "extraPoint", kind: "extraPoint" });
    const X = data.special.extraPoints;
    const cd = kickClassDraw("extraPoint", X.weights, X.classes, ctx);
    detail["classProbabilities"] = cd.probs;
    const kickAt = s.trySpots?.kick ?? flip(data.rules.try.kickSpot);
    let play: PlayResult & { kind: "extraPoint" };
    if (cd.cls === "good") play = { kind: "extraPoint", seconds: 0, good: true };
    else if (cd.cls === "miss") play = { kind: "extraPoint", seconds: 0, good: false };
    else play = { kind: "extraPoint", seconds: 0, good: false, end: { spot: clampField(kickAt - data.special.fieldGoals.kickDepth), possession: "defense" } };
    const fouls = kickFoul("extraPoint", rates, ctx, rates_out, () => true);
    const fluke = cd.base < data.config.fluke.classProbabilityBelow;
    if (fluke) ctx.trace.push({ factor: "fluke", reason: "classRare", what: label("classRare") });
    detail["class"] = cd.cls;
    detail["fluke"] = fluke;
    const out = withFouls(play, fouls, ctx);
    return finish(out, ctx, whenFor(ctx, out.fouls, fluke, "extraPoint"), detail);
  }

  function clockPlay(ctx: Ctx, call: "kneel" | "spike"): PlayResult {
    const s = ctx.state;
    const sit = toSituation(s, data.rules);
    const labels = binSituation(sit, c.dims);
    const rates_out: Record<string, number> = {};
    const detail: Record<string, unknown> = { foulRates: rates_out };
    const rates = foulRates("clock", labels, ctx);
    recordRates(call, rates, rates_out, false);
    const pre = preSnap(call, rates, ctx);
    if (pre !== null) return noPlay(pre, label(call), call, ctx, detail);
    ctx.trace.push({ factor: "call", label: label(call), leaf: call, kind: call });
    const durations = data.scrimmage.durations[call] ?? {};
    if (call === "spike") {
      const play: PlayResult = { kind: "spike", seconds: seconds(durations["spike"] ?? durations["*"], ctx.rng), incomplete: true, end: { spot: s.spot, possession: "offense" } };
      return finish(play, ctx, "spike", detail);
    }
    const pool = data.scrimmage.clock["kneel"];
    if (pool === undefined) return fail("noCell", "no kneel pool");
    const stride = pool.fields.length + 1;
    const at = drawTuple(pool.tuples, stride, ctx.rng) * stride;
    // Post-validation revision 12: a kneel never carries the ball back into the own end zone.
    // The pooled yards come from kneels anywhere on the field; the real kneels inside the own 5
    // of 2016-2023 (49, own 4 or closer) all ended in the field of play.
    const spot = Math.max(Math.min(s.spot, 1), s.spot + (pool.tuples[at] as number));
    const play: PlayResult = {
      kind: "kneel",
      seconds: seconds(durations["kneel"] ?? durations["*"], ctx.rng),
      end: { spot, possession: "offense" },
    };
    return finish(play, ctx, "kneel", detail);
  }

  function kickoff(ctx: Ctx, onside: boolean): PlayResult {
    const s = ctx.state;
    const K = data.kickoff;
    const rates_out: Record<string, number> = {};
    const detail: Record<string, unknown> = { foulRates: rates_out };
    const callId = onside ? "onsideKick" : "kickoff";
    ctx.trace.push({ factor: "call", label: label(callId), leaf: callId, kind: callId });
    if (onside) {
      const o = K.onside;
      const w = [o.outOfBounds, (1 - o.outOfBounds) * o.recover, (1 - o.outOfBounds) * (1 - o.recover)];
      const names = ["onsideOutOfBounds", "onsideRecovered", "onsideLost"];
      const k = drawIndex(w, ctx.rng);
      const cls = names[k] as string;
      const base = w[k] as number;
      ctx.trace.push({ factor: "class", name: cls, label: label(cls), basePct: pctDown(base), pct: Math.round(base * PCT) });
      detail["class"] = cls;
      let play: PlayResult;
      if (k === 0) play = { kind: "onsideKick", seconds: 0, outcome: "outOfBounds" };
      else {
        const at = clampField(s.spot + drawWeighted(k === 1 ? o.kickersAt : o.receiversAt, ctx.rng));
        play = { kind: "onsideKick", seconds: drawWeighted(o.seconds, ctx.rng), outcome: "inPlay", end: { spot: at, possession: k === 1 ? "offense" : "defense" } };
      }
      const fluke = base < data.config.fluke.classProbabilityBelow;
      if (fluke) ctx.trace.push({ factor: "fluke", reason: "classRare", what: label("classRare") });
      detail["fluke"] = fluke;
      return finish(play, ctx, fluke ? "fluke" : "onsideKick", detail);
    }
    const table = s.safetyKick ? K.safetyKick : K.kickoff;
    const cd = kickClassDraw("kickoff", table.weights, table.classes, ctx);
    detail["classProbabilities"] = cd.probs;
    detail["class"] = cd.cls;
    let play: PlayResult & { kind: "kickoff" };
    let returnEnd: number | null = null;
    switch (cd.cls) {
      case "touchbackEndZone":
      case "touchbackLandingZone":
      case "short":
      case "outOfBounds":
        play = { kind: "kickoff", seconds: 0, outcome: cd.cls };
        break;
      case "fairCatch":
        play = { kind: "kickoff", seconds: 0, outcome: "fairCatch", end: { spot: flip(drawWeighted(table.fairCatchAt, ctx.rng)), possession: "defense" } };
        break;
      case "returnTD":
        play = { kind: "kickoff", seconds: drawWeighted(table.returnSeconds, ctx.rng), outcome: "inPlay", end: { spot: IN_OWN_END_ZONE, possession: "defense" } };
        break;
      case "kickersRecover":
        play = { kind: "kickoff", seconds: drawWeighted(table.returnSeconds, ctx.rng), outcome: "inPlay", end: { spot: flip(drawWeighted(table.kickersRecoverAt, ctx.rng)), possession: "offense" } };
        break;
      default:
        returnEnd = clampField(flip(drawWeighted(table.returnEnd, ctx.rng)));
        play = { kind: "kickoff", seconds: drawWeighted(table.returnSeconds, ctx.rng), outcome: "inPlay", end: { spot: returnEnd, possession: "defense" } };
    }
    // Kickoff fouls (designed rates): one draw. A return-team foul needs a return to happen on.
    const u = ctx.rng.nextFloat();
    let acc = 0;
    let foul: Foul | null = null;
    for (const [id, r] of Object.entries(K.fouls)) {
      const rule = data.rules.penalties[id];
      if (typeof r !== "number" || rule === undefined) continue;
      const rate = r / PER_MILLION;
      rates_out[id] = rate;
      const hit = foul === null && u >= acc && u < acc + rate;
      acc += rate;
      rates_out["anyFlag"] = acc;
      if (!hit) continue;
      const by: PlaySide = rule.committedBy === "defense" ? "defense" : "offense";
      if (rule.enforcement !== "spotOfFoul") foul = { penalty: id, by };
      else if (returnEnd !== null) foul = { penalty: id, by, spot: clampField(returnEnd + 5) };
    }
    const fluke = cd.base < data.config.fluke.classProbabilityBelow;
    if (fluke) ctx.trace.push({ factor: "fluke", reason: "classRare", what: label("classRare") });
    detail["fluke"] = fluke;
    const fouls = foul !== null ? [foul] : [];
    const out = withFouls(play, fouls, ctx);
    return finish(out, ctx, whenFor(ctx, out.fouls, fluke, "kickoff"), detail);
  }

  // ------------------------------------------------------------ entry point

  return function resolvePlay(state: GameState, offenseCall: OffenseCall, defenseCall: string | null, players: Players, rng: Rng): PlayResult {
    if (state.phase !== "scrimmage" && state.phase !== "try" && state.phase !== "kickoff") return fail("wrongPhase", `no play in phase ${state.phase}`);
    const offPool = players[state.possession];
    const defPool = players[state.possession === "home" ? "away" : "home"];
    const call = offenseCall.call;
    const P = data.personnel;
    const ctxFor = (offSlots: string, offGroup: "offense" | "kick", pkg: string): Ctx => {
      const os = offGroup === "offense" ? P.offense[offSlots] : P.kick[offSlots];
      const ds = P.packages[pkg];
      if (os === undefined || ds === undefined) return fail("badCall", `no personnel for ${offSlots} or ${pkg}`);
      const preSnapScale = players.offensePreSnapFoulScale?.[state.possession] ?? 1;
      return { state, rng, trace: [], offense: onField(offPool, os, offSlots), defense: onField(defPool, ds, pkg), preSnapScale };
    };
    const needDefense = (): { preset: string; pkg: string } => {
      if (defenseCall === null) return fail("missingDefenseCall", `${call} needs a defensive preset`);
      const pkg = P.presetPackage[defenseCall];
      if (pkg === undefined) return fail("badDefenseCall", `unknown preset ${defenseCall}`);
      return { preset: defenseCall, pkg };
    };
    const needFormation = (): string => {
      const f = offenseCall.formation;
      if (f === undefined || P.offense[f] === undefined) return fail("badCall", `${call} needs a formation`);
      return f;
    };

    /** Kicks, kneels and spikes take no defense call; one given is ignored and recorded as ignored. */
    const ignoring = (p: PlayResult): PlayResult =>
      defenseCall === null ? p : ({ ...p, detail: { ...p.detail, defenseCallIgnored: defenseCall } } as PlayResult);

    if (state.phase === "kickoff") {
      if (call !== "kickoff" && call !== "onsideKick") return fail("badCall", `${call} is not a kickoff call`);
      if (call === "onsideKick") {
        const k = data.rules.kickoff.onside.allowedWhen;
        const kicker = state.possession;
        const trailing = state.score[kicker] < state.score[kicker === "home" ? "away" : "home"];
        const ok = k === "always" || (k === "trailing" && trailing) || (k === "trailingInFinalPeriod" && trailing && state.period === data.rules.game.regulationPeriods);
        if (!ok) return fail("badCall", `onside kicks are allowed only when "${k}"`);
      }
      return ignoring(kickoff(ctxFor("kickoff", "kick", "base"), call === "onsideKick"));
    }
    if (state.phase === "try") {
      if (call === "extraPoint") return ignoring(extraPoint(ctxFor("extraPoint", "kick", "base")));
      if (call !== "goForTwo") return fail("badCall", `${call} is not a try call`);
      const leaf = offenseCall.twoPointPlay;
      if (leaf === undefined || !RUN_PASS_CALLS.has(leaf)) return fail("badCall", "a two-point try needs a run or pass play");
      const formation = needFormation();
      const { preset, pkg } = needDefense();
      return runOrPass(ctxFor(formation, "offense", pkg), leaf, formation, preset, pkg, true);
    }
    if (RUN_PASS_CALLS.has(call)) {
      const formation = needFormation();
      const { preset, pkg } = needDefense();
      return runOrPass(ctxFor(formation, "offense", pkg), call, formation, preset, pkg, false);
    }
    switch (call) {
      case "punt":
        return ignoring(punt(ctxFor("punt", "kick", "base")));
      case "fieldGoal":
        return ignoring(fieldGoal(ctxFor("fieldGoal", "kick", "base")));
      case "kneel":
      case "spike":
        return ignoring(clockPlay(ctxFor("underCenter", "offense", "base"), call));
      default:
        return fail("badCall", `${call} is not a scrimmage call`);
    }
  };
}
