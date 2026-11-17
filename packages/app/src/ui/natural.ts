// Natural motion (docs/specs/m2-play-calling-and-motion.md, "Revision 2026-11-15: natural motion",
// as built). Pure: no Rng, no DOM, no clock. Two parts:
// - a small tie-breaker spread from the FNV-1a hash of the player id, stratified within each side
//   and position group, so two players with the same ratings never move as clones;
// - `decorate`: the designed offsets on a mark's built keys: the cruise wobble (a time warp, NM5),
//   the line's hand fight and the idle sway (NM7), and steering clear of a ball in the air
//   (NM-Open 1), each blended out before a fact anchor so anchors stay exact (NM3).
// Every value comes from data/ui/motion.json `natural` (designed, not fitted).

import { at, clampX, type Key, type Pt } from "./motion";

/** FNV-1a, 32 bit, over the string's UTF-16 code units. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** u in [0, 1) for a player and a salt. */
export const hashUnit = (id: string, salt: string): number => fnv1a(`${id}|${salt}`) / 2 ** 32;

/** Ranked by u within one group, the r-th of n gets -1 + 2r / (n - 1); a group of one gets 2u - 1. */
export function stratify(ids: readonly string[], salt: string): Map<string, number> {
  const ranked = ids.map((id) => ({ id, u: hashUnit(id, salt) })).sort((a, b) => a.u - b.u || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = ranked.length;
  const out = new Map<string, number>();
  ranked.forEach((r, i) => out.set(r.id, n === 1 ? 2 * r.u - 1 : -1 + (2 * i) / (n - 1)));
  return out;
}

/** A period between lo and hi (ms) and a phase, from the hash. */
export function periodOf(id: string, salt: string, lo: number, hi: number): { period: number; phase: number } {
  return { period: lo + (hi - lo) * hashUnit(id, `${salt}:p`), phase: 2 * Math.PI * hashUnit(id, `${salt}:f`) };
}

const smooth = (x: number): number => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};
const len = (p: Pt): number => Math.hypot(p.x, p.y);
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });

/** The ball a mark keeps clear of while it is in the air (contract 3 as amended for flight). */
export interface DecorateRing {
  readonly ball: (t: number) => Pt;
  /** The ring while the ball is in the air, and the rest of the time. */
  readonly radius: number;
  readonly heldRadius: number;
  /** The ring holds from here (the snap window's end) to `to`. */
  readonly from: number;
  readonly to: number;
  /** A lineman only steps sideways. */
  readonly sideways: boolean;
  readonly flights: readonly (readonly [number, number])[];
}

export interface DecorateOpts {
  readonly keyMs: number;
  /** First decorated key (the snap) and the whistle. */
  readonly from: number;
  readonly live: number;
  /** He leaves his unnamed track here (NM2): an anchor after it blends no earlier than it. */
  readonly dep: number;
  /** His own top speed (yd per ms), for the cruise mask. */
  readonly top: number;
  readonly anchors: readonly number[];
  readonly blendMs: number;
  /** Designed break arcs (the wobble is off there, so a plant keeps its shape). */
  readonly arcs: readonly (readonly [number, number])[];
  readonly wobble: { readonly share: number; readonly period: number; readonly phase: number } | null;
  /** The hand fight (NM7), or null. */
  readonly offset: ((t: number) => Pt) | null;
  readonly idle: { readonly yards: number; readonly period: number; readonly phase: number; readonly minYps: number; readonly rampMs: number; readonly from: number; readonly holds: readonly (readonly [number, number])[] } | null;
  readonly ring: DecorateRing | null;
  /** The settle's slow-down starts here (motion.ts settleWarp, applied after); the sway decides on the speed he had then. */
  readonly settleFrom: number;
  /** Anchor-demanded legs: no cap on the wobble there (N1 is the leg's own). */
  readonly demanded: readonly (readonly [number, number])[];
}

/**
 * Past a flight's end he still keeps clear for this long (ms). On keys he keeps FLIGHT_KEY_YARDS past
 * the flight ring and steers for FLIGHT_MARGIN past it: a ball in the air moves up to 0.75 yd between
 * keys, so a ring held on keys alone could be cut between them.
 */
const FLIGHT_AFTER_MS = 300;
const FLIGHT_KEY_YARDS = 0.3;
const FLIGHT_MARGIN = 0.45;

const inAny = (t: number, iv: readonly (readonly [number, number])[]): boolean => iv.some(([a, b]) => t >= a - 1e-9 && t <= b + 1e-9);

/**
 * The designed offsets on a mark's keys from `from` to `live` (keys before are kept). Causal: the
 * key at t uses his raw keys up to t, and a thrown ball's path only from the first key after the throw.
 */
export function decorate(raw: readonly Key[], o: DecorateOpts): Key[] {
  const step = o.keyMs;
  if (raw.length === 0 || o.live <= o.from) return [...raw];
  const set = new Set<number>();
  for (let t = Math.ceil(o.from / step - 1e-9) * step; t < o.live - 1e-6; t += step) set.add(t);
  // No key at the departure or the throw: their times depend on the result, and a key there would
  // change how the frames just before it are drawn (R-C9). Anchors are fact times after them.
  for (const t of [o.from, o.live, ...o.anchors]) if (t >= o.from - 1e-9 && t <= o.live + 1e-9) set.add(t);
  // While a ball is in the air, ringed marks get a key every half step too, so the ring holds
  // between keys as well (a kick can pass more than a yard in one key). Only from the throw or kick.
  if (o.ring !== null)
    for (const [a, b] of o.ring.flights)
      for (let t = Math.ceil(a / step) * step + step / 2; t < Math.min(b + FLIGHT_AFTER_MS, o.live, o.ring.to); t += step) if (t > a) set.add(t);
  const ts = [...set].sort((a, b) => a - b).filter((t, i, all) => i === 0 || t - (all[i - 1] as number) > 1e-6);
  const R = (t: number): Pt => at(raw, t);
  const rawV = (t: number): number => len(sub(R(t), R(t - step))) / step;
  // NM3: every offset fades out before an anchor (never before the departure for one after it).
  const keep = (t: number): number => {
    let s = 0;
    for (const a of o.anchors) {
      if (t > a + 1e-9) continue;
      const w0 = a < o.dep - 1e-9 ? a - o.blendMs : Math.max(a - o.blendMs, o.dep);
      if (t < w0 - 1e-9) continue;
      s = Math.max(s, a - w0 < 1e-6 ? 1 : smooth((t - w0) / (a - w0)));
    }
    return 1 - s;
  };
  // NM5: the wobble, a time warp on steady stretches above half his top, off arcs; faded in slowly, out quickly.
  const delta: number[] = [];
  let m = 0;
  ts.forEach((t, i) => {
    // His raw speed one key back: a knot just after a throw never depends on motion after it (R-C9).
    const tl = Math.min(t, o.live) - step;
    const v0 = rawV(tl);
    const v1 = rawV(tl - step);
    const want = o.wobble !== null && t < o.settleFrom && v0 >= 0.5 * o.top && v1 >= 0.5 * o.top && Math.abs(v0 - v1) <= 0.1 * o.top && !inAny(tl, o.arcs) ? 1 : 0;
    const dt = i === 0 ? step : t - (ts[i - 1] as number);
    m = want > m ? Math.min(want, m + dt / 300) : Math.max(want, m - dt / 100);
    const w = o.wobble;
    // A mark already near 1.14 x his top (a carry anchored to the whistle) breathes less, never past it.
    const room = w === null || v0 < 1e-9 || inAny(t, o.demanded) ? 1 : Math.max(0, Math.min(1, (1.145 * o.top - v0) / (w.share * v0)));
    m = Math.min(m, room);
    delta.push(w === null ? 0 : ((w.share * w.period) / (2 * Math.PI)) * m * Math.sin((2 * Math.PI * t) / w.period + w.phase));
  });
  // A thrown or kicked ball: from the throw he eases out of where it will pass, and back.
  const avoid: { a: number; tc: number; b: number; n: Pt; need: number }[] = [];
  const rg = o.ring;
  if (rg !== null)
    for (const [a0, b] of rg.flights) {
      // From the first key at or after the throw, so no frame before the throw changes (R-C9).
      const a = Math.ceil(a0 / step - 1e-9) * step;
      if (a0 < o.from || a > Math.min(o.live, rg.to)) continue;
      let best = Infinity;
      let tc = a;
      for (let tau = a; tau <= Math.min(o.live, b + FLIGHT_AFTER_MS, rg.to) + 1e-9; tau += step) {
        const dd = len(sub(R(tau), rg.ball(tau))) - rg.radius;
        if (dd < best) {
          best = dd;
          tc = tau;
        }
      }
      if (best >= FLIGHT_MARGIN || tc <= a + 1e-6) continue;
      // Across the ball's line of flight (a mark on the line can't step clear along it).
      const bv = sub(rg.ball(tc + step / 2), rg.ball(tc - step / 2));
      const bl = len(bv);
      const rel = sub(R(tc), rg.ball(tc));
      let n = rel;
      if (bl > 1e-9) {
        const along = (rel.x * bv.x + rel.y * bv.y) / bl;
        n = { x: rel.x - (bv.x / bl) * along, y: rel.y - (bv.y / bl) * along };
        if (len(n) < 1e-3) n = { x: -bv.y / bl, y: bv.x / bl };
      }
      // A lineman steps clear across the line of flight too: sideways alone can put the ball on top of him.
      if (len(n) < 1e-9) n = { x: R(tc).x <= rg.ball(tc).x ? -1 : 1, y: 0 };
      const nl = len(n);
      if (nl > 1e-9) avoid.push({ a, tc, b: tc + FLIGHT_AFTER_MS, n: { x: n.x / nl, y: n.y / nl }, need: FLIGHT_MARGIN - best });
    }
  const out: Key[] = raw.filter((q) => q.t < (ts[0] as number) - 1e-9);
  let idleW = 0;
  let sideMem = 0;
  ts.forEach((t, i) => {
    const dt = i === 0 ? step : t - (ts[i - 1] as number);
    const base = R(t + (delta[i] as number));
    let ox = 0;
    let oy = 0;
    if (o.offset !== null) {
      const f = o.offset(t);
      ox += f.x;
      oy += f.y;
    }
    for (const v of avoid) {
      if (t <= v.a || t >= v.b) continue;
      const w = t <= v.tc ? smooth((t - v.a) / (v.tc - v.a)) : 1 - smooth((t - v.tc) / (v.b - v.tc));
      ox += v.n.x * v.need * w;
      oy += v.n.y * v.need * w;
    }
    // NM7: the idle sway once his own motion has died away (never with the ball): an ellipse, so he
    // is never still; near the ball along the ring and outward only.
    if (o.idle !== null) {
      const I = o.idle;
      const want = t >= I.from && !inAny(t, I.holds) && rawV(Math.min(t, o.settleFrom) - step) * 1000 < I.minYps ? 1 : 0;
      idleW = want > idleW ? Math.min(1, idleW + dt / I.rampMs) : Math.max(0, idleW - dt / I.rampMs);
      if (idleW > 0) {
        const ph = (2 * Math.PI * t) / I.period + I.phase;
        // Mirrored with his side of the field, so a mirrored formation sways as a mirror image (R-C2).
        const sideX = R(o.from).x < 53.3 / 2 ? -1 : 1;
        let u: Pt = { x: Math.cos(I.phase), y: Math.sin(I.phase) };
        let near = false;
        // The ball one key back: the sway's direction never depends on a throw at most one key old (R-C9).
        const bLag = rg === null ? null : rg.ball(Math.ceil(t / step - 1e-9) * step - step);
        if (rg !== null && bLag !== null && t <= rg.to) {
          const b = bLag;
          const d = len(sub(base, b));
          if (d < rg.radius + 1 && d > 1e-6) {
            u = { x: -(base.y - b.y) / d, y: (base.x - b.x) / d };
            near = true;
          }
        }
        const nrm = { x: -u.y, y: u.x };
        let sign = 1;
        if (near && bLag !== null) {
          const b = bLag;
          sign = nrm.x * (base.x - b.x) + nrm.y * (base.y - b.y) >= 0 ? 1 : -1;
        }
        const along = I.yards * Math.sin(ph) * idleW;
        const across = (I.yards / 2) * (near ? 0.5 * (1 + Math.cos(ph)) : Math.cos(ph)) * idleW * sign;
        // Away from the ball the ellipse is drawn for his side of the field and mirrored on the other.
        ox += (u.x * along + nrm.x * across) * (near ? 1 : sideX);
        oy += u.y * along + nrm.y * across;
      }
    }
    // Inside a blend the wobble's warp fades with the offsets, so at the anchor he is exactly on his raw key.
    const k = keep(t);
    const r = k < 1 ? R(t) : base;
    let x = clampX(r.x + (base.x + ox - r.x) * k);
    let y = r.y + (base.y + oy - r.y) * k;
    // Contract 3 is a hard rule: no offset takes him inside the ring.
    if (rg !== null && t >= rg.from && t <= rg.to) {
      const b = rg.ball(t);
      const flying = rg.flights.some(([a, e]) => t >= a && t <= e);
      const Rr = flying ? rg.radius + FLIGHT_KEY_YARDS : rg.heldRadius;
      const d = Math.hypot(x - b.x, y - b.y);
      if (d >= 1.5 * Rr) sideMem = 0;
      const bv = flying ? sub(rg.ball(t + step / 2), rg.ball(t - step / 2)) : { x: 0, y: 0 };
      if (d < Rr && flying && len(bv) > 1e-6) {
        // Out across the ball's line of flight, not along it.
        const bh = { x: bv.x / len(bv), y: bv.y / len(bv) };
        const along = (x - b.x) * bh.x + (y - b.y) * bh.y;
        const ax = { x: -bh.y, y: bh.x };
        const c = (x - b.x) * ax.x + (y - b.y) * ax.y;
        const side = Math.abs(c) < 1e-6 ? (x <= b.x ? -1 : 1) * Math.sign(ax.x || 1) : Math.sign(c);
        const need = Math.sqrt(Math.max(0, Rr * Rr - along * along));
        x = clampX(b.x + bh.x * along + ax.x * side * need);
        y = b.y + bh.y * along + ax.y * side * need;
      } else if (d < Rr) {
        if (rg.sideways) {
          const dy = y - b.y;
          // He keeps the side he was pushed to (as ringFix does), never across the ball.
          const rs = R(t).x - b.x;
          if (Math.abs(rs) > 0.3 || sideMem === 0) sideMem = Math.abs(rs) > 1e-9 ? Math.sign(rs) : x >= b.x ? 1 : -1;
          if (Math.abs(dy) < Rr) x = clampX(b.x + sideMem * Math.sqrt(Rr * Rr - dy * dy));
        } else if (d > 1e-9) {
          x = clampX(b.x + ((x - b.x) / d) * Rr);
          y = b.y + ((y - b.y) / d) * Rr;
        }
      }
    }
    out.push({ t, x, y });
  });
  // His raw keys between knots (a key at an incompletion's throw, a leg's start) stay keys: there he
  // is his raw key plus the offsets interpolated between the knots, so a frame before a throw never
  // depends on the knot after it (R-C9, R-C20).
  const knots = out.filter((q) => q.t >= (ts[0] as number) - 1e-9);
  const offAt = (i: number): Pt => sub(knots[i] as Key, R((knots[i] as Key).t));
  const extra: Key[] = [];
  let j = 0;
  for (const q of raw) {
    if (q.t <= (ts[0] as number) + 1e-9 || q.t >= o.live - 1e-9 || set.has(q.t)) continue;
    while (j < knots.length - 2 && (knots[j + 1] as Key).t < q.t) j++;
    const a = knots[j] as Key;
    const b = knots[j + 1] as Key;
    if (q.t <= a.t + 1e-6 || q.t >= b.t - 1e-6) continue;
    const f = (q.t - a.t) / (b.t - a.t);
    const oa = offAt(j);
    const ob = offAt(j + 1);
    extra.push({ t: q.t, x: clampX(q.x + oa.x + (ob.x - oa.x) * f), y: q.y + oa.y + (ob.y - oa.y) * f });
  }
  return extra.length === 0 ? out : [...out, ...extra].sort((p, q) => p.t - q.t);
}
