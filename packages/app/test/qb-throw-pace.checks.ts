// Measurements for "QB throws feel quick" (pass-play animation, acceptance criteria A1 to A4),
// shared by the fast suite (qb-throw-pace.spec.test.ts, a few seeds) and the wide sweep
// (test/game/qb-throw-pace.heavy.test.ts). Written by test-writer from the criteria, not the code.
//
// Measured on the Timeline from timeline() at 1x, natural motion on (the default ctx), drawn keys
// sampled every 25 ms (speed over [t, t + 25] in yd/s):
// - Throw = the start of the ball's flight path; catch = its end. QB = the engine's passer (else
//   the offense QB mark).
// - Drop end = the first sample after his peak speed from the snap to the throw (the drop, or the
//   boot on play action) where he is below 1 yd/s; the throw itself when he never drops below it.
//   Hold = throw - drop end.
// - Drop peak = his peak speed from the snap to the drop end.
// - Longest hold movement = the longest run of consecutive samples at more than 1 yd/s between
//   the drop end and the throw.
// - A3 on completions: pre = his mean speed over [catch - 150, catch], early = over
//   [catch - 400, catch - 250]. Exempt: a route whose finish is "sit" (hitch, curl, sit ends) and a
//   play whose dead spot is the catch spot.
// - A4: peak drawn QB speed from the snap to the throw against his own rating-scaled top speed
//   (mark.nat.top).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readDetail, type PlayEvent } from "../src/engine/types";
import { lookup, receiverRoles, routeChain, type SlotRef } from "../src/ui/art";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { at, timeline, type Timeline, type TimelineCtx } from "../src/ui/timeline";
import { playGame } from "./support";

const read = (p: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", p), "utf8"));
export const templates = parseTemplates(read("data/ui/templates.json"));
export const motion = parseMotion(read("data/ui/motion.json"));
const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };
export const ctx: TimelineCtx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion };
export const tlOf = (ev: PlayEvent): Timeline => timeline({ event: ev, runoffSeconds: 0 }, templates, ctx);

/** The criteria's constants (test floors, never read from data). */
export const C = {
  dt: 25,
  holdP90Ms: 600,
  /** R-C25 (spec revision 2026-11-16, deeper drops): the intermediate and deep hold p90 bounds. */
  holdP90ClassMs: { intermediatePass: 900, deepPass: 1250 } as Readonly<Record<string, number>>,
  dropPeakYps: 5,
  moveYps: 1,
  holdMoveMaxMs: 600,
  keepRatio: 0.69,
  keepExceptShare: 0.05,
  topRatio: 1.05,
} as const;

type Keys = Timeline["ball"];
const speed = (keys: Keys, t: number): number => {
  const a = at(keys, t);
  const b = at(keys, t + C.dt);
  return (Math.hypot(b.x - a.x, b.y - a.y) / C.dt) * 1000;
};
const mean = (keys: Keys, t0: number, t1: number): number => {
  let s = 0;
  let n = 0;
  for (let t = t0; t < t1 - 1e-9; t += C.dt) {
    s += speed(keys, t);
    n++;
  }
  return n > 0 ? s / n : NaN;
};

export interface Row {
  readonly where: string;
  readonly call: string;
  readonly hold: number;
  readonly dropPeak: number;
  readonly holdMoveMs: number;
  readonly qbPeak: number;
  readonly qbTop: number;
  readonly qbPeakAt: number;
  /** A3, completions only. */
  readonly keep?: { readonly ratio: number; readonly pre: number; readonly early: number; readonly exempt: boolean; readonly finish: string };
}

export function measure(ev: PlayEvent, where: string): Row | null {
  if (ev.play.kind !== "pass") return null;
  const tl = tlOf(ev);
  const det = readDetail(ev.play);
  const qb = tl.marks.find((m) => m.playerId === det.participants?.passer) ?? tl.marks.find((m) => m.side === "O" && m.position === "QB");
  const fl = tl.paths.find((p) => p.kind === "ball");
  if (qb === undefined || fl === undefined) return null;
  const S = tl.snapAt;
  const tThrow = fl.start;
  const tCatch = fl.end;
  let peak = 0;
  let peakAt = S;
  for (let t = S; t + C.dt <= tThrow + 1e-9; t += C.dt) {
    const v = speed(qb.keys, t);
    if (v > peak) {
      peak = v;
      peakAt = t;
    }
  }
  let dropEnd = tThrow;
  for (let t = peakAt; t < tThrow; t += C.dt) {
    if (speed(qb.keys, t) < C.moveYps) {
      dropEnd = t;
      break;
    }
  }
  let dropPeak = 0;
  for (let t = S; t < dropEnd; t += C.dt) dropPeak = Math.max(dropPeak, speed(qb.keys, t));
  let run = 0;
  let longest = 0;
  for (let t = dropEnd; t + C.dt <= tThrow + 1e-9; t += C.dt) {
    if (speed(qb.keys, t) > C.moveYps) {
      run += C.dt;
      longest = Math.max(longest, run);
    } else run = 0;
  }
  const row: { -readonly [K in keyof Row]: Row[K] } = {
    where: `${where} ${ev.offense.formation ?? ""} ${ev.offense.call} vs ${ev.defense ?? ""}`,
    call: ev.offense.call,
    hold: tThrow - dropEnd,
    dropPeak,
    holdMoveMs: longest,
    qbPeak: peak,
    qbTop: qb.nat?.top ?? NaN,
    qbPeakAt: peakAt - S,
  };
  const complete = ev.play.incomplete !== true && ev.play.turnover === undefined;
  const rc = tl.marks.find((m) => m.playerId === det.participants?.receiver && m.side === "O");
  if (complete && rc !== undefined) {
    const offs = tl.marks.filter((m) => m.side === "O");
    const { roles } = receiverRoles(
      offs.map((m) => ({ slot: m.slot, position: m.position }) as SlotRef),
      offs.map((m) => at(m.keys, S)),
    );
    const route = lookup(templates.routes[ev.offense.call], routeChain(roles.get(rc.slot), rc.position));
    const finish = route?.finish ?? "none";
    const catchPt = at(tl.ball, tCatch);
    const endsAtCatch = ev.play.end !== undefined && Math.abs(catchPt.y - ev.play.end.spot) < 0.05;
    const pre = mean(rc.keys, tCatch - 150, tCatch);
    const early = mean(rc.keys, tCatch - 400, tCatch - 250);
    row.keep = { ratio: pre / Math.max(0.05, early), pre, early, exempt: finish === "sit" || endsAtCatch, finish };
  }
  return row;
}

/**
 * A sack (spec revision 2026-11-16, R-C26 and R-C30), measured on the same 25 ms samples:
 * - Drop end: the first sample under 1 yd/s after he first moves at 1 yd/s or more. (The passes'
 *   "first slow sample after his peak" can't be used: on a sack his step up to the sack spot may
 *   be his fastest stretch, QD3.) Drop peak: his peak from the snap to the drop end.
 * - Sack time: the whistle less 300 ms (Motion, Sacks: the whistle follows the sack by 300 ms), or
 *   earlier when the ball leaves him first (a strip-sack: the fumble legs after it are excluded).
 * - Peak to the sack: his peak drawn speed from the snap to the sack time.
 */
export interface SackRow {
  readonly where: string;
  readonly call: string;
  readonly dropPeak: number;
  readonly dropEnd: number;
  readonly sackAt: number;
  readonly peakToSack: number;
  readonly peakAt: number;
  readonly qbTop: number;
  readonly unclamped: boolean;
}

/** The sack time as SackRow reads it: the whistle less 300 ms, or the first sample the ball is 0.5 yd off the QB. */
export function sackTimeOf(tl: Timeline, qbKeys: Keys): number {
  let sackAt = tl.liveEnd - 300;
  for (let t = Math.max(tl.snapAt, tl.snapWindowEnd); t <= sackAt; t += C.dt) {
    const b = at(tl.ball, t);
    const p = at(qbKeys, t);
    if (Math.hypot(b.x - p.x, b.y - p.y) > 0.5) {
      sackAt = t;
      break;
    }
  }
  return sackAt;
}

export function measureSack(ev: PlayEvent, where: string): SackRow | null {
  if (ev.play.kind !== "sack") return null;
  const tl = tlOf(ev);
  const det = readDetail(ev.play);
  const qb = tl.marks.find((m) => m.playerId === det.participants?.passer) ?? tl.marks.find((m) => m.side === "O" && m.position === "QB");
  if (qb === undefined) return null;
  const S = tl.snapAt;
  const sackAt = sackTimeOf(tl, qb.keys);
  let moving = -1;
  let dropEnd = sackAt;
  for (let t = S; t + C.dt <= sackAt + 1e-9; t += C.dt) {
    const v = speed(qb.keys, t);
    if (moving < 0) {
      if (v >= C.moveYps) moving = t;
    } else if (v < C.moveYps) {
      dropEnd = t;
      break;
    }
  }
  let dropPeak = 0;
  for (let t = S; t < dropEnd; t += C.dt) dropPeak = Math.max(dropPeak, speed(qb.keys, t));
  let peak = 0;
  let peakAt = S;
  for (let t = S; t + C.dt <= sackAt + 1e-9; t += C.dt) {
    const v = speed(qb.keys, t);
    if (v > peak) {
      peak = v;
      peakAt = t;
    }
  }
  const live = tl.liveEnd - S;
  return {
    where: `${where} ${ev.offense.formation ?? ""} ${ev.offense.call} vs ${ev.defense ?? ""} (sack)`,
    call: ev.offense.call,
    dropPeak,
    dropEnd: dropEnd - S,
    sackAt: sackAt - S,
    peakToSack: peak,
    peakAt: peakAt - S,
    qbTop: qb.nat?.top ?? NaN,
    unclamped: live > motion.live.minMs + 1e-6 && live < motion.live.maxMs - 1e-6,
  };
}

/** The passes (Row) and the sacks (SackRow) of the given playGame seeds. */
export function sweepAll(seeds: readonly number[]): { rows: Row[]; sacks: SackRow[] } {
  const rows: Row[] = [];
  const sacks: SackRow[] = [];
  for (const seed of seeds) {
    let i = 0;
    for (const ev of playGame(seed, seed % 2 === 0 ? "home" : "away", seed).events) {
      if (ev.t !== "play") continue;
      i++;
      const r = measure(ev as PlayEvent, `seed ${seed} play ${i}`);
      if (r !== null) rows.push(r);
      const s = measureSack(ev as PlayEvent, `seed ${seed} play ${i}`);
      if (s !== null) sacks.push(s);
    }
  }
  return { rows, sacks };
}

export function sweep(seeds: readonly number[]): Row[] {
  return sweepAll(seeds).rows;
}

export const q = (xs: readonly number[], p: number): number => {
  const s = [...xs].filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  return s.length === 0 ? NaN : (s[Math.min(s.length - 1, Math.floor(p * s.length))] as number);
};
const f = (x: number): string => x.toFixed(2);

// Each check returns a list of failures, empty when the criterion holds.

/** A1: hold p90 <= 600 ms for the class (R-C25: its own bound on intermediatePass and deepPass). */
export function holdP90(rows: readonly Row[], call: string, limit: number = C.holdP90ClassMs[call] ?? C.holdP90Ms): { readonly n: number; readonly p50: number; readonly p90: number; readonly bad: string[] } {
  const R = rows.filter((r) => r.call === call);
  const holds = R.map((r) => r.hold);
  const p90 = q(holds, 0.9);
  const worst = [...R].sort((a, b) => b.hold - a.hold).slice(0, 5).map((r) => `${r.where}: hold ${r.hold} ms`);
  return { n: R.length, p50: q(holds, 0.5), p90, bad: p90 <= limit ? [] : [`${call} hold p90 ${p90} ms > ${limit} (n ${R.length}); longest: ${worst.join("; ")}`] };
}

/** A2a: drop peak >= 5 yd/s on every play of the class. */
export function dropPeak(rows: readonly Row[], call: string): string[] {
  return rows.filter((r) => r.call === call && !(r.dropPeak >= C.dropPeakYps)).map((r) => `${r.where}: drop peak ${f(r.dropPeak)} yd/s`);
}

/** A2b: no run of QB movement over 1 yd/s longer than 600 ms between the drop end and the throw. */
export function holdMovement(rows: readonly Row[], call: string): string[] {
  return rows.filter((r) => r.call === call && r.holdMoveMs > C.holdMoveMaxMs).map((r) => `${r.where}: moves ${r.holdMoveMs} ms on end in the hold`);
}

/** A3: at most 5% of the non-exempt completions keep under 0.69 x their earlier speed into the catch. */
export function keepSpeed(rows: readonly Row[], calls: readonly string[]): { readonly n: number; readonly under: number; readonly bad: string[] } {
  const R = rows.filter((r) => calls.includes(r.call) && r.keep !== undefined && !r.keep.exempt);
  const under = R.filter((r) => !((r.keep?.ratio ?? NaN) >= C.keepRatio));
  const share = R.length === 0 ? NaN : under.length / R.length;
  const sample = under.slice(0, 8).map((r) => `${r.where}: ${f(r.keep?.ratio ?? NaN)} (${f(r.keep?.pre ?? NaN)} vs ${f(r.keep?.early ?? NaN)} yd/s, ${r.keep?.finish})`);
  return { n: R.length, under: under.length, bad: share <= C.keepExceptShare ? [] : [`${under.length} of ${R.length} (${(100 * share).toFixed(1)}%) under ${C.keepRatio}: ${sample.join("; ")}`] };
}

/** A4: QB never drawn over 1.05 x his own top speed from the snap to the throw. */
export function qbTop(rows: readonly Row[]): string[] {
  return rows.filter((r) => !(r.qbPeak <= C.topRatio * r.qbTop + 1e-9)).map((r) => `${r.where}: ${f(r.qbPeak)} yd/s at ${r.qbPeakAt} ms, top ${f(r.qbTop)} (${f(r.qbPeak / r.qbTop)} x)`);
}


// Spec revision 2026-11-16, "deeper drops, shorter holds" (R-C26, R-C30).

/** R-C26: the drop peak is in [5.0 yd/s, his own top] on every pass and sack of the class. */
export function dropBand(rows: readonly Row[], sacks: readonly SackRow[], call: string): string[] {
  const bad = (where: string, v: number, top: number): string | null =>
    v >= C.dropPeakYps && v <= top + 1e-9 ? null : `${where}: drop peak ${f(v)} yd/s, top ${f(top)} (${f(v / top)} x)`;
  return [
    ...rows.filter((r) => r.call === call).map((r) => bad(r.where, r.dropPeak, r.qbTop)),
    ...sacks.filter((r) => r.call === call).map((r) => bad(`${r.where} drop end ${r.dropEnd} ms`, r.dropPeak, r.qbTop)),
  ].filter((x): x is string => x !== null);
}

/** R-C30: from the snap to the sack time the QB peaks at no more than his own top. */
export function sackTop(sacks: readonly SackRow[], calls: readonly string[]): string[] {
  return sacks
    .filter((r) => calls.includes(r.call) && !(r.peakToSack <= r.qbTop + 1e-9))
    .map((r) => `${r.where}: ${f(r.peakToSack)} yd/s at ${r.peakAt} ms (sack at ${r.sackAt} ms), top ${f(r.qbTop)} (${f(r.peakToSack / r.qbTop)} x)${r.unclamped ? "" : ", clamped play"}`);
}
