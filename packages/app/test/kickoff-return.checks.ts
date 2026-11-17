// Checks for the kickoff return pass, KR1 to KR9 (docs/specs/m2-play-calling-and-motion.md,
// "Amended (Joseph, 2026-11-15): kickoff return pass"), shared by the fixture suite
// (kickoff-return.spec.test.ts) and the 1,000-return heavy sweep (test/game/kickoff-return.heavy.test.ts).
// Each check returns a list of failures, empty when the criterion holds.
//
// Measured the spec's way, on the Timeline from timeline() at 1x, on 25 ms keys:
// - Frame: the kick goes up the screen, the return comes back down (decreasing y).
// - Kick = the start of the ball's flight path; catch = tl.read; whistle = tl.liveEnd; on a return
//   fumble the carrier's part ends at the first key after the catch where the ball leaves him.
// - Blockers = return-unit marks (side X) the engine names in no role and not as a fouler (so never
//   the returner, a fouler or a fumble recoverer). Coverage = kicking-team marks (side O) named the
//   same way (so never the kicker or the tackler).
// - Behind by b = blocker.y - carrier.y. Engaged (KR4) = within engageYards of a coverage mark in
//   a contact (a run of consecutive keys within engageYards of that mark) that began at a key where
//   he was not behind by more than behindToleranceYards.
// The floors are the spec's test constants, never data: the data can tighten them, never loosen them.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readDetail, type PlayEvent } from "../src/engine/types";
import { kickoffFrame } from "../src/ui/presnap";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { at, FIELD_WIDTH, timeline, type Pt, type Timeline, type TimelineCtx, type TLMark } from "../src/ui/timeline";

const read = (p: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", p), "utf8"));
export const motionRaw = read("data/ui/motion.json") as Record<string, unknown>;
export const templates = parseTemplates(read("data/ui/templates.json"));
export const motion = parseMotion(motionRaw);
const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };
export const ctx: TimelineCtx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion };
export const tlOf = (ev: PlayEvent, c: TimelineCtx = ctx): Timeline => timeline({ event: ev, runoffSeconds: 0 }, templates, c);

/** The kickReturn block as the spec names its keys (read raw so a missing key reads as NaN, which fails every comparison). */
export const KRD = (motionRaw["kickReturn"] ?? {}) as Record<string, number>;
const num = (k: string): number => (typeof KRD[k] === "number" ? KRD[k] : NaN);

// The spec's test floors (KR2 to KR6, KR9) and test constants.
export const FLOOR = {
  setupYards: 3,
  behindToleranceYards: 1.0,
  laneSpreadYards: 20,
  whistleWindowMs: 500,
  engageYards: 2.0,
  cutYards: 4,
  corridorHalfYards: 2.0,
  corridorMs: 1000,
} as const;
/** KR2 still speed and allowance, KR5 block length, KR6 angles and heading window (spec constants). */
export const STILL_YPS = 0.3;
export const STILL_MAX_MS = 300;
export const BLOCK_MS = 300;
export const UPFIELD_DEG = 20;
export const CUT_DEG = 25;
export const HEADING_MS = 300;
/** N2's breakLateralAccel as the natural-motion spec gives it (35 yd/s^2, x 1.25 as N2 allows); motion.json has no such key. */
export const BREAK_LATERAL_LIMIT = 1.25 * 35;

/** The thresholds each check uses: the data's value, held to its floor. */
export const T = {
  wallDepthYards: num("wallDepthYards"),
  setupYards: Math.max(num("setupYards"), FLOOR.setupYards),
  behind: Math.min(num("behindToleranceYards"), FLOOR.behindToleranceYards),
  laneSpread: Math.max(num("laneSpreadYards"), FLOOR.laneSpreadYards),
  whistleWindowMs: Math.min(num("whistleWindowMs"), FLOOR.whistleWindowMs),
  engage: Math.min(num("engageYards"), FLOOR.engageYards),
  upfieldYards: num("upfieldYards"),
  cutYards: Math.max(num("cutYards"), FLOOR.cutYards),
  cutMinReturnYards: num("cutMinReturnYards"),
  corridorHalf: Math.max(motion.pursuit.corridorHalfYards, FLOOR.corridorHalfYards),
  corridorMs: Math.max(motion.pursuit.corridorMs, FLOOR.corridorMs),
};
// NaN thresholds (a missing key) would make Math.max/min NaN and every check below fail loudly.

const KEY = 25;
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const keysFrom = (t0: number, t1: number): number[] => {
  const out: number[] = [];
  for (let t = Math.ceil(t0 / KEY - 1e-9) * KEY; t <= t1 + 1e-9; t += KEY) out.push(t);
  return out;
};
const deg = (a: Pt, b: Pt): number => {
  const c = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
};
const UP: Pt = { x: 0, y: -1 };

// ---------------------------------------------------------------- the play's parts

export interface Ret {
  readonly ev: PlayEvent;
  readonly tl: Timeline;
  readonly returner: TLMark;
  readonly blockers: readonly TLMark[];
  readonly coverage: readonly TLMark[];
  readonly tackler: TLMark | undefined;
  readonly kickT: number;
  readonly catchT: number;
  readonly whistle: number;
  /** The fumble (the ball leaves the returner) or the whistle: the end of the carrier's part. */
  readonly carryEnd: number;
  readonly fumbled: boolean;
  readonly land: Pt;
  readonly catchPt: Pt;
  /** Landing y - dead spot y. */
  readonly returnYards: number;
}

/** A kickoff the returner carries back (outcome inPlay, a named returner on the field, a dead spot short of the landing). */
export function isReturn(ev: PlayEvent): boolean {
  const p = ev.play;
  if (p.kind !== "kickoff" || p.outcome !== "inPlay" || p.end === undefined) return false;
  return readDetail(p).participants?.returner !== undefined;
}

export function partsOf(ev: PlayEvent, tl: Timeline = tlOf(ev)): Ret {
  const parts = readDetail(ev.play).participants ?? {};
  const returner = tl.marks.find((m) => m.playerId === parts.returner);
  if (returner === undefined) throw new Error("no returner mark");
  const flight = tl.paths.find((p) => p.kind === "ball");
  if (flight === undefined) throw new Error("no kick flight");
  const land = flight.points[flight.points.length - 1] as Pt;
  const catchT = tl.read;
  const whistle = tl.liveEnd;
  let carryEnd = whistle;
  for (const t of keysFrom(catchT, whistle))
    if (dist(at(tl.ball, t), at(returner.keys, t)) > 0.3) {
      carryEnd = t;
      break;
    }
  const end = "end" in ev.play && ev.play.end !== undefined ? ev.play.end.spot : land.y;
  const foulers = new Set(parts.foulers ?? []);
  const named = (m: TLMark): boolean => m.roles.length > 0 || foulers.has(m.playerId);
  return {
    ev,
    tl,
    returner,
    blockers: tl.marks.filter((m) => m.side === "X" && !named(m)),
    coverage: tl.marks.filter((m) => m.side === "O" && !named(m)),
    tackler: tl.marks.find((m) => m.playerId === parts.tackler),
    kickT: flight.start,
    catchT,
    whistle,
    carryEnd,
    fumbled: carryEnd < whistle - 1e-6,
    land,
    catchPt: at(returner.keys, catchT),
    returnYards: land.y - end,
  };
}

const behindBy = (r: Ret, b: TLMark, t: number): number => at(b.keys, t).y - at(r.returner.keys, t).y;

export interface Contact {
  readonly blocker: string;
  readonly cover: string;
  readonly from: number;
  readonly to: number;
  /** Began at a key where the blocker was not behind the carrier by more than the tolerance. */
  readonly valid: boolean;
}

/** Every contact (a run of keys within engageYards) between each blocker and each mark in `others`, from the kick to `until`. */
export function contacts(r: Ret, others: readonly TLMark[], until: number = r.carryEnd): Contact[] {
  const out: Contact[] = [];
  const ts = keysFrom(r.kickT, until);
  for (const b of r.blockers)
    for (const c of others) {
      let from: number | null = null;
      let last = 0;
      for (const t of ts) {
        const close = dist(at(b.keys, t), at(c.keys, t)) <= T.engage + 1e-9;
        if (close && from === null) from = t;
        if (!close && from !== null) {
          out.push({ blocker: b.playerId, cover: c.playerId, from, to: last, valid: behindBy(r, b, from) <= T.behind + 1e-9 });
          from = null;
        }
        if (close) last = t;
      }
      if (from !== null) out.push({ blocker: b.playerId, cover: c.playerId, from, to: last, valid: behindBy(r, b, from) <= T.behind + 1e-9 });
    }
  return out;
}

/** KR4's engaged: in a valid contact with a coverage mark at key t. */
export function engagedAt(cs: readonly Contact[], id: string, t: number): boolean {
  return cs.some((c) => c.valid && c.blocker === id && t >= c.from - 1e-9 && t <= c.to + 1e-9);
}

// ---------------------------------------------------------------- KR1

/** KR1: the facts and the existing criteria hold on a kickoff (return or not). */
export function kr1(ev: PlayEvent, tl: Timeline = tlOf(ev), opts: { natural?: boolean; frame?: boolean } = {}): string[] {
  const bad: string[] = [];
  const p = ev.play;
  const parts = readDetail(p).participants ?? {};
  const fin = at(tl.ball, tl.liveEnd);
  // A2 and N6: the ball at the dead spot y at the whistle; the holder and tackler at the ball.
  if ("end" in p && p.end !== undefined && Math.abs(fin.y - p.end.spot) > 1e-6) bad.push(`A2: ball ends at y ${fin.y.toFixed(3)}, engine says ${p.end.spot}`);
  if (parts.tackler !== undefined && tl.marks.some((m) => m.playerId === parts.tackler) && tl.tackler !== parts.tackler) bad.push(`A2: tackler ${String(tl.tackler)} is not the engine's ${parts.tackler}`);
  for (const id of [tl.holder, tl.tackler]) {
    const m = id === null ? undefined : tl.marks.find((x) => x.playerId === id);
    if (m !== undefined && dist(at(m.keys, tl.liveEnd), fin) > 1e-6) bad.push(`N6: ${m.slot} not at the ball at the whistle`);
  }
  // N6: the returner holds the ball from the catch to the whistle (to the fumble).
  if (isReturn(ev)) {
    const r = partsOf(ev, tl);
    const fumbled = readDetail(p).class === "fumble" || ("turnover" in p && p.turnover === "fumble");
    if (!fumbled && r.fumbled) bad.push(`N6: the ball leaves the returner at ${(r.carryEnd - tl.snapAt).toFixed(0)} ms on a play with no fumble`);
    if (!fumbled && tl.holder !== parts.returner) bad.push(`A2: holder ${String(tl.holder)}, the engine's returner is ${String(parts.returner)}`);
    if (dist(r.catchPt, r.land) > 1e-6) bad.push(`N6: the returner is ${dist(r.catchPt, r.land).toFixed(3)} yd from the landing spot at the catch`);
  }
  // N6: every fact anchor exact.
  for (const m of tl.marks) for (const a of m.nat?.anchors ?? []) if (dist(at(m.keys, a.t), a) > 1e-6) bad.push(`N6: ${m.side}${m.slot} anchor at ${(a.t - tl.snapAt).toFixed(0)} ms off by ${dist(at(m.keys, a.t), a).toExponential(2)} yd`);
  // A3: no unnamed mark touches the ball (1 yd, every 12.5 ms); side X unnamed keeps the ring on keys.
  const ring = templates.field.clearOfBallYards;
  const inAir = (t: number): boolean => tl.paths.some((f) => f.kind === "ball" && t >= f.start && t <= f.end);
  for (const m of tl.marks) {
    if (m.fact) continue;
    for (let t = tl.snapWindowEnd; t < tl.liveEnd - 1; t += 12.5) {
      const onKey = Math.abs(t / 25 - Math.round(t / 25)) < 1e-6;
      const rr = dist(at(m.keys, t), at(tl.ball, Math.min(t, tl.liveEnd - 1)));
      if (rr < 1) {
        bad.push(`A3: ${m.side}${m.slot} touches the ball at ${(t - tl.snapAt).toFixed(0)} ms`);
        break;
      }
      if (onKey && m.side === "X" && rr < (inAir(t) ? Math.min(ring, motion.natural.flightRingYards) : ring) - 1e-6) {
        bad.push(`A3: ${m.side}${m.slot} inside the ring at ${(t - tl.snapAt).toFixed(0)} ms (${rr.toFixed(2)} yd)`);
        break;
      }
    }
  }
  // usability-pass AC 11: kickoffFrame is the timeline at t = 0.
  if (opts.frame !== false && (p.kind === "kickoff" || p.kind === "onsideKick")) {
    const f = kickoffFrame({ los: tl.los, humanKicks: true, templates, pxPerYard: ctx.pxPerYard ?? 9.26 });
    for (const m of f.marks) {
      const live = tl.marks.find((x) => x.side === m.side && x.slot === m.slot);
      if (live === undefined) bad.push(`AC 11: ${m.side}${m.slot} missing from the timeline`);
      else if (dist(at(m.keys, 0), at(live.keys, 0)) > 1e-6) bad.push(`AC 11: ${m.side}${m.slot} at t = 0 is ${dist(at(m.keys, 0), at(live.keys, 0)).toFixed(3)} yd off the frame`);
    }
  }
  bad.push(...natural(tl));
  return bad;
}

/** N1, N3, N4, N5 and N6's settle, measured as natural-motion.spec.test.ts measures them. */
export function natural(tl: Timeline): string[] {
  const bad: string[] = [];
  const meas = (m: TLMark): { t: number[]; p: Pt[]; v: number[] } => {
    const t: number[] = [];
    const p: Pt[] = [];
    for (let s = tl.snapAt; s <= tl.liveEnd + tl.settleMs + 1e-9; s += KEY) {
      t.push(s);
      p.push(at(m.keys, s));
    }
    const n = t.length;
    return { t, p, v: t.map((_, i) => (i === 0 || i === n - 1 ? NaN : dist(p[i + 1] as Pt, p[i - 1] as Pt) / 0.05)) };
  };
  const M = new Map(tl.marks.map((m) => [m.playerId, meas(m)]));
  for (const m of tl.marks) {
    const nat = m.nat;
    if (nat === undefined) {
      bad.push(`N: ${m.side}${m.slot} has no natural-motion record`);
      continue;
    }
    const q = M.get(m.playerId) as ReturnType<typeof meas>;
    const top = nat.top / nat.k;
    // N1: no teleports.
    for (const [i, v] of q.v.entries()) {
      if (Number.isNaN(v)) continue;
      const t = q.t[i] as number;
      const dm = nat.demanded.find((d) => t >= d.t0 - 1e-9 && t <= d.t1 + 1e-9);
      const cap = dm !== undefined ? 1.25 * dm.mean : 1.15 * top;
      if (v > cap + 1e-9) {
        bad.push(`N1: ${m.side}${m.slot} ${v.toFixed(2)} yd/s > ${cap.toFixed(2)} at ${(t - tl.snapAt).toFixed(0)} ms`);
        break;
      }
    }
    // N4: no cruise plateau.
    const W = 500 / KEY;
    for (let i = 0; i + W < q.v.length; i++) {
      const win = q.v.slice(i, i + W + 1);
      if (win.some((v) => Number.isNaN(v) || v <= 0.5 * top)) continue;
      if (Math.max(...win) - Math.min(...win) < 0.02 * top) {
        bad.push(`N4: ${m.side}${m.slot} plateau from ${((q.t[i] as number) - tl.snapAt).toFixed(0)} ms`);
        break;
      }
    }
    // N5: never frozen (the holder and tackler exempt in the last convergeMs).
    const set = at(m.keys, tl.snapAt);
    const i0 = q.p.findIndex((x) => dist(x, set) > 1e-6);
    if (i0 < 0) bad.push(`N5: ${m.side}${m.slot} never moves`);
    else {
      const t1 = m.playerId === tl.holder || m.playerId === tl.tackler ? tl.liveEnd - motion.convergeMs : tl.liveEnd;
      let n = 0;
      let ok = 0;
      q.v.forEach((v, i) => {
        if (i < i0 || (q.t[i] as number) > t1 || Number.isNaN(v)) return;
        n++;
        if (v >= 0.3) ok++;
      });
      if (n > 0 && ok / n < 0.95) bad.push(`N5: ${m.side}${m.slot} moving on ${((100 * ok) / n).toFixed(0)}% of ${n} keys`);
    }
    // N6: the settle eases down.
    const ks = q.t.map((t, i) => ({ t, v: q.v[i] as number })).filter((x) => x.t > tl.liveEnd && !Number.isNaN(x.v));
    for (let i = 1; i < ks.length; i++)
      if ((ks[i] as { v: number }).v > (ks[i - 1] as { v: number }).v + 0.05) {
        bad.push(`N6: ${m.side}${m.slot} speeds up in the settle`);
        break;
      }
    const endV = dist(at(m.keys, tl.liveEnd + tl.settleMs), at(m.keys, tl.liveEnd + tl.settleMs - KEY)) / 0.025;
    if (endV > 0.2) bad.push(`N6: ${m.side}${m.slot} ${endV.toFixed(2)} yd/s at the end of the settle`);
  }
  // N3: no clones.
  for (const [i, a] of tl.marks.entries())
    for (const b of tl.marks.slice(i + 1)) {
      if (a.side !== b.side || a.position !== b.position) continue;
      const A = M.get(a.playerId) as ReturnType<typeof meas>;
      const B = M.get(b.playerId) as ReturnType<typeof meas>;
      let n = 0;
      let s = 0;
      A.v.forEach((v, j) => {
        const w = B.v[j] as number;
        if (Number.isNaN(v) || Number.isNaN(w) || v < 1 || w < 1) return;
        n++;
        s += (v - w) ** 2;
      });
      if (n * KEY >= 400 && Math.sqrt(s / n) < 0.2) bad.push(`N3: ${a.side}${a.slot} and ${b.slot} are clones (RMS ${Math.sqrt(s / n).toFixed(3)} yd/s)`);
    }
  return bad;
}

// ---------------------------------------------------------------- KR2 to KR9

/** KR2: blockers set up during the hang. */
export function kr2(r: Ret): string[] {
  const bad: string[] = [];
  const ts = keysFrom(r.kickT, r.catchT);
  for (const b of r.blockers) {
    const set = at(b.keys, r.tl.snapAt);
    if (r.land.y - set.y > T.wallDepthYards + 1e-9) {
      const gain = at(b.keys, r.catchT).y - at(b.keys, r.kickT).y;
      if (!(gain >= T.setupYards - 1e-9)) bad.push(`KR2: ${b.slot} (set ${(r.land.y - set.y).toFixed(1)} yd short of the landing) gains ${gain.toFixed(2)} yd toward it in the hang, needs ${T.setupYards}`);
    }
    let still = 0;
    for (const t of ts) {
      const v = dist(at(b.keys, t + KEY), at(b.keys, t - KEY)) / 0.05;
      if (v < STILL_YPS) still += KEY;
    }
    if (still > STILL_MAX_MS) bad.push(`KR2: ${b.slot} is still for ${still} ms of the hang`);
  }
  return bad;
}

/** KR3: the wall at the catch. */
export function kr3(r: Ret): string[] {
  const bad: string[] = [];
  for (const b of r.blockers) {
    const by = behindBy(r, b, r.catchT);
    if (!(by <= T.behind + 1e-9)) bad.push(`KR3: ${b.slot} is ${by.toFixed(2)} yd behind the returner at the catch (tolerance ${T.behind})`);
  }
  const xs = r.blockers.map((b) => at(b.keys, r.catchT).x);
  const span = Math.max(...xs) - Math.min(...xs);
  if (!(span >= T.laneSpread - 1e-9)) bad.push(`KR3: the blockers span ${span.toFixed(2)} yd across at the catch, needs ${T.laneSpread}`);
  return bad;
}

/** KR4: every blocker leads the return or is engaged, catch to whistle - whistleWindowMs (to the fumble). */
export function kr4(r: Ret): string[] {
  const bad: string[] = [];
  const cs = contacts(r, r.coverage);
  const t1 = r.fumbled ? r.carryEnd : r.whistle - T.whistleWindowMs;
  for (const b of r.blockers)
    for (const t of keysFrom(r.catchT, t1)) {
      const by = behindBy(r, b, t);
      if (by <= T.behind + 1e-9 || engagedAt(cs, b.playerId, t)) continue;
      bad.push(`KR4: ${b.slot} trails the carrier by ${by.toFixed(2)} yd, not engaged, at ${(t - r.catchT).toFixed(0)} ms after the catch`);
      break;
    }
  return bad;
}

/** Maximum matching of blockers to distinct coverage marks over the given pairs. */
function matching(pairs: readonly { blocker: string; cover: string }[]): number {
  const adj = new Map<string, string[]>();
  for (const p of pairs) adj.set(p.blocker, [...new Set([...(adj.get(p.blocker) ?? []), p.cover])]);
  const owner = new Map<string, string>();
  const tryB = (b: string, seen: Set<string>): boolean => {
    for (const c of adj.get(b) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      const o = owner.get(c);
      if (o === undefined || tryB(o, seen)) {
        owner.set(c, b);
        return true;
      }
    }
    return false;
  };
  let n = 0;
  for (const b of adj.keys()) if (tryB(b, new Set())) n++;
  return n;
}

/** KR5: blocks happen on returns of at least cutMinReturnYards. */
export function kr5(r: Ret): string[] {
  const bad: string[] = [];
  if (!(r.returnYards >= T.cutMinReturnYards)) return bad;
  const until = r.whistle;
  const cs = contacts(r, r.coverage, until).filter((c) => c.valid && c.to - c.from >= BLOCK_MS - 1e-9);
  const need = Math.ceil(r.blockers.length / 2);
  const got = matching(cs);
  if (got < need) bad.push(`KR5: ${got} blockers engaged 300 ms or more with distinct coverage marks, needs ${need} of ${r.blockers.length}`);
  // The engine's tackler is never engaged (catch to whistle - whistleWindowMs).
  if (r.tackler !== undefined) {
    const t1 = r.whistle - T.whistleWindowMs;
    for (const b of r.blockers)
      for (const t of keysFrom(r.catchT, t1))
        if (dist(at(b.keys, t), at(r.tackler.keys, t)) <= T.engage + 1e-9) {
          bad.push(`KR5: ${b.slot} engages the tackler ${r.tackler.slot} at ${(t - r.catchT).toFixed(0)} ms after the catch`);
          break;
        }
  }
  // While engaged the pair holds contact and neither is drawn winning: the N5 rule for linemen, as
  // natural-motion.spec.test.ts measures it on the builder's block record (nat.engaged): the pair
  // keeps the distance it engaged at within 0.3 yd (M6), and the blocker's mean offset along the
  // pair's axis from his raw (natural: false) keys is within 0.15 yd. A contact long enough to count
  // for KR5 with no such record can't be checked this way and is listed.
  const byId = new Map(r.tl.marks.map((m) => [m.playerId, m]));
  const raw = tlOf(r.ev, { ...ctx, natural: false });
  for (const id of new Set(cs.map((c) => c.blocker))) {
    const b = byId.get(id) as TLMark;
    const e = b.nat?.engaged;
    if (e === undefined || e.partner === null || !cs.some((c) => c.blocker === id && c.cover === e.partner)) {
      bad.push(`KR5: ${b.slot} blocks 300 ms or more with no block record (nat.engaged) naming that coverage man`);
      continue;
    }
    const v = byId.get(e.partner) as TLMark;
    const ref = dist(at(b.keys, e.from), at(v.keys, e.from));
    for (const t of keysFrom(e.from, e.to))
      if (Math.abs(dist(at(b.keys, t), at(v.keys, t)) - ref) > 0.3) {
        bad.push(`KR5: ${b.slot} and ${v.slot} lose contact (${ref.toFixed(2)} to ${dist(at(b.keys, t), at(v.keys, t)).toFixed(2)} yd at ${(t - r.catchT).toFixed(0)} ms after the catch)`);
        break;
      }
    const q = raw.marks.find((m) => m.playerId === id);
    if (q !== undefined) {
      let off = 0;
      let n = 0;
      for (const t of keysFrom(e.from, e.to)) {
        const g = at(b.keys, t);
        const w = at(q.keys, t);
        off += (g.x - w.x) * e.axis.x + (g.y - w.y) * e.axis.y;
        n++;
      }
      if (n > 0 && Math.abs(off / n) > 0.15) bad.push(`KR5: ${b.slot} drawn winning or losing against ${v.slot}: mean offset ${(off / n).toFixed(3)} yd along the pair's axis`);
    }
  }
  return bad;
}

export interface Cut {
  readonly t: number;
  /** Sign of the new heading's x: -1 left, +1 right. */
  readonly dir: number;
}

const heading = (r: Ret, t0: number, t1: number): Pt => {
  const a = at(r.returner.keys, t0);
  const b = at(r.returner.keys, t1);
  return { x: b.x - a.x, y: b.y - a.y };
};

/** The end of KR6's upfield phase: the first key where he is upfieldYards past the catch. */
function upfieldEnd(r: Ret): number {
  for (const t of keysFrom(r.catchT, r.carryEnd)) if (r.catchPt.y - at(r.returner.keys, t).y >= T.upfieldYards - 1e-9) return t;
  return Infinity;
}

/** KR6's first heading change of CUT_DEG or more after the upfield phase. */
export function firstCut(r: Ret): Cut | null {
  const tU = upfieldEnd(r);
  if (tU === Infinity) return null;
  for (const t of keysFrom(Math.max(tU, r.catchT + HEADING_MS), r.carryEnd - HEADING_MS)) {
    const before = heading(r, t - HEADING_MS, t);
    const after = heading(r, t, t + HEADING_MS);
    // A heading is defined only while he moves (1 yd/s over the window).
    if (Math.hypot(before.x, before.y) < 0.3 || Math.hypot(after.x, after.y) < 0.3) continue;
    if (deg(before, after) >= CUT_DEG - 1e-9) return { t, dir: Math.sign(after.x) };
  }
  return null;
}

/** KR6: the returner starts upfield, then cuts, on returns of at least cutMinReturnYards (up to a fumble). */
export function kr6(r: Ret): string[] {
  const bad: string[] = [];
  if (!(r.returnYards >= T.cutMinReturnYards)) return bad;
  const tU = upfieldEnd(r);
  if (tU === Infinity) bad.push(`KR6: he never gets ${T.upfieldYards} yd upfield of the catch`);
  for (const t of keysFrom(r.catchT, r.carryEnd - HEADING_MS)) {
    const end = at(r.returner.keys, t + HEADING_MS);
    if (r.catchPt.y - end.y > T.upfieldYards + 1e-9) break;
    const h = heading(r, t, t + HEADING_MS);
    if (Math.hypot(h.x, h.y) < 0.1) continue;
    if (deg(h, UP) > UPFIELD_DEG + 1e-9) {
      bad.push(`KR6: ${deg(h, UP).toFixed(1)} degrees off straight upfield at ${(t - r.catchT).toFixed(0)} ms after the catch, inside the first ${T.upfieldYards} yd`);
      break;
    }
  }
  const cut = firstCut(r);
  if (cut === null) bad.push(`KR6: no heading change of ${CUT_DEG} degrees or more after the first ${T.upfieldYards} yd`);
  let maxOff = 0;
  for (const t of keysFrom(r.catchT, r.carryEnd)) maxOff = Math.max(maxOff, Math.abs(at(r.returner.keys, t).x - r.catchPt.x));
  if (!(maxOff >= T.cutYards - 1e-9)) bad.push(`KR6: his x never gets more than ${maxOff.toFixed(2)} yd from his catch x, needs ${T.cutYards}`);
  if (cut !== null) {
    // Cut arcs are flagged, and the lateral acceleration inside them meets breakLateralAccel.
    const ks = r.returner.keys.filter((k) => k.t >= cut.t - HEADING_MS && k.t <= cut.t + HEADING_MS);
    if (!ks.some((k) => k.arc === true)) bad.push(`KR6: no flagged arc key within ${HEADING_MS} ms of the cut at ${(cut.t - r.catchT).toFixed(0)} ms`);
    for (const k of r.returner.keys) {
      if (k.arc !== true || k.t < r.catchT || k.t > r.carryEnd) continue;
      const p0 = at(r.returner.keys, k.t - 2 * KEY);
      const pm = at(r.returner.keys, k.t - KEY);
      const p1 = at(r.returner.keys, k.t);
      const pp = at(r.returner.keys, k.t + KEY);
      const p2 = at(r.returner.keys, k.t + 2 * KEY);
      const v = dist(pp, pm) / 0.05;
      const h0 = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const h1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      if (v < 1 || dist(p1, p0) < 0.025 || dist(p2, p1) < 0.025) continue;
      let d = h1 - h0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const lat = (v * Math.abs(d)) / 0.05;
      if (lat > BREAK_LATERAL_LIMIT + 1e-9) {
        bad.push(`KR6: lateral ${lat.toFixed(1)} yd/s^2 in a cut arc at ${(k.t - r.catchT).toFixed(0)} ms, over ${BREAK_LATERAL_LIMIT}`);
        break;
      }
    }
  }
  const ob = "outOfBounds" in r.ev.play && r.ev.play.outOfBounds === true;
  if (!ob)
    for (const t of keysFrom(r.catchT, r.whistle)) {
      const x = at(r.returner.keys, t).x;
      if (x < motion.sidelineMarginYards - 1e-9 || x > FIELD_WIDTH - motion.sidelineMarginYards + 1e-9) {
        bad.push(`KR6: the returner at x ${x.toFixed(2)}, inside the ${motion.sidelineMarginYards} yd sideline margin, at ${(t - r.catchT).toFixed(0)} ms after the catch`);
        break;
      }
    }
  return bad;
}

/**
 * KR7's direction rule at the first cut: the side (left or right of his x) with more engaged
 * blockers. Returns the failures and the cut's direction (null with no cut), and whether it was a tie.
 */
export function kr7Direction(r: Ret): { bad: string[]; dir: number | null; tie: boolean } {
  const cut = firstCut(r);
  if (cut === null) return { bad: [], dir: null, tie: false };
  const cs = contacts(r, r.coverage);
  const cx = at(r.returner.keys, cut.t).x;
  let left = 0;
  let right = 0;
  for (const b of r.blockers) {
    if (!engagedAt(cs, b.playerId, cut.t)) continue;
    const x = at(b.keys, cut.t).x;
    if (x < cx) left++;
    else if (x > cx) right++;
  }
  if (left === right) return { bad: [], dir: cut.dir, tie: true };
  const want = right > left ? 1 : -1;
  return { bad: cut.dir === want ? [] : [`KR7: cuts ${cut.dir < 0 ? "left" : "right"} at ${(cut.t - r.catchT).toFixed(0)} ms after the catch, but ${left} engaged blockers are left of him and ${right} right`], dir: cut.dir, tie: false };
}

/** KR9: coverage keeps out of the carrier's corridor from the catch to the whistle (the fumble). */
export function kr9(r: Ret): string[] {
  const bad: string[] = [];
  const pathFrom = (t0: number): Pt[] => keysFrom(t0, Math.min(t0 + T.corridorMs, r.carryEnd)).map((t) => at(r.returner.keys, t));
  const segDist = (p: Pt, a: Pt, b: Pt): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = dx * dx + dy * dy;
    const u = L < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
    return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
  };
  for (const c of r.coverage)
    for (const t of keysFrom(r.catchT, r.carryEnd)) {
      const path = pathFrom(t);
      const q = at(c.keys, t);
      let d = path.length === 1 ? dist(q, path[0] as Pt) : Infinity;
      for (let i = 1; i < path.length; i++) d = Math.min(d, segDist(q, path[i - 1] as Pt, path[i] as Pt));
      if (d < T.corridorHalf - 1e-9) {
        bad.push(`KR9: ${c.slot} ${d.toFixed(2)} yd from the carrier's next ${T.corridorMs} ms of path at ${(t - r.catchT).toFixed(0)} ms after the catch`);
        break;
      }
    }
  return bad;
}

/** Every per-return check, keyed by criterion (KR7's no-leak and share checks live in the tests). */
export function allChecks(ev: PlayEvent, tl: Timeline = tlOf(ev)): Record<string, string[]> {
  const r = partsOf(ev, tl);
  return { KR1: kr1(ev, tl), KR2: kr2(r), KR3: kr3(r), KR4: kr4(r), KR5: kr5(r), KR6: kr6(r), KR7: kr7Direction(r).bad, KR9: kr9(r) };
}

/**
 * KR7, no leak (return-team results): every return-unit mark (side X, the returner included, named
 * or not) is at the same place at every 25 ms key from t = 0 to the catch in `v` as in `base`. The
 * time scale must match first, or uniform scaling (not a leak) moves the hang.
 */
export function returnUnitSameToCatch(base: Ret, v: Ret, label: string): string[] {
  const bad: string[] = [];
  if (v.returner.nat?.k !== base.returner.nat?.k) return [`${label}: time scale ${String(v.returner.nat?.k)}, base ${String(base.returner.nat?.k)}`];
  if (Math.abs(v.catchT - base.catchT) > 1e-9) return [`${label}: catch at ${v.catchT} ms, base ${base.catchT} ms`];
  for (const a of base.tl.marks.filter((m) => m.side === "X")) {
    const b = v.tl.marks.find((m) => m.playerId === a.playerId);
    if (b === undefined) {
      bad.push(`${label}: ${a.slot} missing`);
      continue;
    }
    let first = -1;
    let worst = 0;
    for (let t = 0; t <= base.catchT + 1e-9; t += KEY) {
      const d = dist(at(a.keys, t), at(b.keys, t));
      if (d > 1e-9 && first < 0) first = t;
      worst = Math.max(worst, d);
    }
    if (first >= 0) bad.push(`${label}: ${a.slot} differs from ${first.toFixed(0)} ms, by up to ${worst.toFixed(2)} yd before the catch at ${base.catchT.toFixed(0)} ms`);
  }
  return bad;
}

/** The same return with a return-team fouler (holding on the return, accepted) naming `fouler`. */
export function withReturnFouler(ev: PlayEvent, fouler: string): PlayEvent {
  const p = ev.play as Extract<PlayEvent["play"], { kind: "kickoff" }>;
  const d = p.detail as Record<string, unknown> & { participants?: Record<string, unknown> };
  const spot = (p.end?.spot ?? 72) + 5;
  return {
    ...ev,
    play: { ...p, fouls: [{ penalty: "offensiveHolding", by: "defense", spot }], detail: { ...d, participants: { ...(d.participants ?? {}), foulers: [fouler] } } } as PlayEvent["play"],
    penalty: { kind: "accept", foul: 0 },
  };
}

/** The same return where the returner fumbles at the dead spot and return-unit teammate `rec` recovers. */
export function withReturnTeamRecovery(ev: PlayEvent, rec: string): PlayEvent {
  const p = ev.play as Extract<PlayEvent["play"], { kind: "kickoff" }>;
  const d = p.detail as Record<string, unknown> & { participants?: Record<string, unknown> };
  const spot = p.end?.spot ?? 72;
  // Nobody is tackled: the recoverer's fall ends it.
  const rest = Object.fromEntries(Object.entries(d.participants ?? {}).filter(([k]) => k !== "tackler"));
  return {
    ...ev,
    play: { ...p, turnover: undefined, end: { spot, possession: "defense" }, detail: { ...d, class: "fumble", fumbleSpot: spot, participants: { ...rest, fumbleForcer: (d.participants?.["tackler"] as string | undefined) ?? "H-LB2", fumbleRecoverer: rec } } } as PlayEvent["play"],
  };
}
