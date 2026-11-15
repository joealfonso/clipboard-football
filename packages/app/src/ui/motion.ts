// The motion builder (docs/specs/m2-play-calling-and-motion.md, Motion): turns waypoints and the
// engine's anchors into dense keys, every 25 ms, that already carry acceleration, rounded breaks,
// reaction, pursuit and the settle. Pure: no Rng, no DOM, no clock. at() stays linear between
// keys, so every drawn frame is a frame the tests check.

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export interface Key extends Pt {
  readonly t: number;
}

export const FIELD_WIDTH = 53.3;
export const MID_X = FIELD_WIDTH / 2;

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const clampX = (x: number): number => Math.max(0, Math.min(FIELD_WIDTH, x));

/** Times from t0 to t1: t0, the multiples of `step` between, and t1. */
export function grid(t0: number, t1: number, step: number): number[] {
  const out = [t0];
  for (let t = Math.floor(t0 / step) * step + step; t < t1 - 1e-6; t += step) out.push(t);
  if (t1 > t0 + 1e-6) out.push(t1);
  return out;
}

/** Position on piecewise-linear keys at time t (held before the first and after the last). */
export function at(keys: readonly Key[], t: number): Pt {
  const first = keys[0];
  if (first === undefined) return { x: MID_X, y: 0 };
  if (t <= first.t) return { x: first.x, y: first.y };
  const last = keys[keys.length - 1] as Key;
  if (t >= last.t) return { x: last.x, y: last.y };
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((keys[mid] as Key).t <= t) lo = mid;
    else hi = mid;
  }
  const a = keys[lo] as Key;
  const b = keys[hi] as Key;
  const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

export interface FilletOpts {
  readonly roundRadius: number;
  readonly sharpRadius: number;
  readonly sharpDeg: number;
}

/**
 * Joins waypoints with circular fillets: a round break (at most `sharpDeg`) gets the round radius
 * and 85% speed, a sharp break the sharp radius and 55% speed. Returns a dense polyline with a speed
 * factor for each segment.
 */
export function fillet(points: readonly Pt[], o: FilletOpts): { pts: Pt[]; speed: number[] } {
  const p = points.filter((q, i) => i === 0 || dist(q, points[i - 1] as Pt) > 1e-6);
  if (p.length < 3) return { pts: [...p], speed: p.length > 1 ? [1] : [] };
  const pts: Pt[] = [p[0] as Pt];
  const speed: number[] = [];
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1] as Pt;
    const b = p[i] as Pt;
    const c = p[i + 1] as Pt;
    const u = { x: (a.x - b.x) / dist(a, b), y: (a.y - b.y) / dist(a, b) };
    const v = { x: (c.x - b.x) / dist(b, c), y: (c.y - b.y) / dist(b, c) };
    const inner = Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y)));
    const turnDeg = 180 - (inner * 180) / Math.PI;
    const sharp = turnDeg > o.sharpDeg;
    const want = sharp ? o.sharpRadius : o.roundRadius;
    const tanLen = Math.min(want / Math.tan(inner / 2), dist(a, b) / 2, dist(b, c) / 2);
    if (!Number.isFinite(tanLen) || tanLen < 1e-3 || turnDeg < 1) {
      speed.push(1);
      pts.push(b);
      continue;
    }
    const p1 = { x: b.x + u.x * tanLen, y: b.y + u.y * tanLen };
    const p2 = { x: b.x + v.x * tanLen, y: b.y + v.y * tanLen };
    speed.push(1);
    pts.push(p1);
    // A quadratic through the corner approximates the arc well at these sizes.
    const n = 6;
    for (let k = 1; k <= n; k++) {
      const s = k / n;
      const q = { x: (1 - s) * (1 - s) * p1.x + 2 * (1 - s) * s * b.x + s * s * p2.x, y: (1 - s) * (1 - s) * p1.y + 2 * (1 - s) * s * b.y + s * s * p2.y };
      speed.push(sharp ? 0.55 : 0.85);
      pts.push(q);
    }
  }
  speed.push(1);
  pts.push(p[p.length - 1] as Pt);
  return { pts, speed };
}

export interface DriveOpts {
  readonly accelMs: number;
  readonly decelMs: number;
  readonly restStart: boolean;
  readonly restEnd: boolean;
  readonly keyMs: number;
  readonly fillet?: FilletOpts;
}

/**
 * Moves along the waypoints from t0 to t1, arriving exactly at t1: from rest over accelMs when
 * restStart, to rest over decelMs when restEnd, slower through breaks. Keys on the global grid.
 */
export function drive(points: readonly Pt[], t0: number, t1: number, o: DriveOpts): Key[] {
  const start = points[0] ?? { x: MID_X, y: 0 };
  if (points.length < 2 || t1 <= t0) return [{ t: t0, ...start }];
  const f = o.fillet === undefined ? { pts: [...points], speed: points.slice(1).map(() => 1) } : fillet(points, o.fillet);
  const eff: number[] = [0];
  for (let i = 1; i < f.pts.length; i++) eff.push((eff[i - 1] as number) + dist(f.pts[i - 1] as Pt, f.pts[i] as Pt) / Math.max(0.2, f.speed[i - 1] ?? 1));
  const total = eff[eff.length - 1] as number;
  const T = t1 - t0;
  const a = o.restStart ? Math.min(o.accelMs, T / 2) : 0;
  const d = o.restEnd ? Math.min(o.decelMs, T / 2) : 0;
  const v = 1 / (T - a / 2 - d / 2);
  const frac = (tau: number): number => {
    if (tau <= 0) return 0;
    if (tau >= T) return 1;
    if (a > 0 && tau < a) return (0.5 * v * tau * tau) / a;
    if (d > 0 && tau > T - d) return 1 - (0.5 * v * (T - tau) * (T - tau)) / d;
    return v * (tau - a / 2);
  };
  return grid(t0, t1, o.keyMs).map((t) => {
    if (total < 1e-9) return { t, ...start };
    const e = frac(t - t0) * total;
    let i = 1;
    while (i < eff.length - 1 && (eff[i] as number) < e) i++;
    const e0 = eff[i - 1] as number;
    const e1 = eff[i] as number;
    const s = e1 === e0 ? 1 : (e - e0) / (e1 - e0);
    const p0 = f.pts[i - 1] as Pt;
    const p1 = f.pts[i] as Pt;
    return { t, x: p0.x + (p1.x - p0.x) * s, y: p0.y + (p1.y - p0.y) * s };
  });
}

/** Joins key runs in time order, dropping a run's first key where it repeats the previous run's last time. */
export function join(...runs: readonly (readonly Key[])[]): Key[] {
  const out: Key[] = [];
  for (const r of runs)
    for (const k of r) {
      const last = out[out.length - 1];
      if (last !== undefined && k.t <= last.t + 1e-9) {
        if (Math.abs(k.t - last.t) < 1e-9) out[out.length - 1] = k;
        continue;
      }
      out.push(k);
    }
  return out;
}

export interface PursueOpts {
  readonly start: Pt;
  /** Velocity at t0 in yards per ms, from the mark's motion before the read. */
  readonly vel: Pt;
  readonly t0: number;
  readonly t1: number;
  readonly ball: (t: number) => Pt;
  readonly topSpeed: number;
  readonly accelMs: number;
  readonly leadMs: number;
  readonly turnDegPerS: number;
  readonly ring: number;
  readonly brakeYards: number;
  /** The carrier's lane: stay out of a half-width band along his next `corridorMs` of path. */
  readonly corridor?: { readonly half: number; readonly ms: number };
  /** Never go below this y (a DL past the OL he faced) or above it (an OL). */
  readonly minY?: number;
  readonly maxY?: number;
  readonly keyMs: number;
}

/**
 * Pursuit after the read: steer toward where the ball will be `leadMs` ahead, turning at most
 * turnDegPerS, slowing as the ring nears, never inside the ring or the carrier's lane.
 */
export function pursue(o: PursueOpts): Key[] {
  const dt = o.keyMs;
  let x = o.start.x;
  let y = o.start.y;
  let speed = Math.hypot(o.vel.x, o.vel.y) * 1000;
  let heading = speed > 1e-6 ? Math.atan2(o.vel.y, o.vel.x) : Math.atan2(o.ball(o.t0).y - y, o.ball(o.t0).x - x);
  const out: Key[] = [{ t: o.t0, x, y }];
  const maxTurn = ((o.turnDegPerS * Math.PI) / 180) * (dt / 1000);
  const accel = (o.topSpeed / Math.max(1, o.accelMs)) * dt;
  for (const t of grid(o.t0, o.t1, dt).slice(1)) {
    const step = (t - (out[out.length - 1] as Key).t) / 1000;
    const tgt = o.ball(Math.min(t + o.leadMs, o.t1));
    const want = Math.atan2(tgt.y - y, tgt.x - x);
    const diff = ((want - heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    // A player turns faster as he slows (he plants and turns), and slows when facing the wrong way.
    const slow = 1 - Math.min(1, speed / Math.max(1e-6, o.topSpeed));
    const turn = maxTurn * (1 + 3 * slow);
    heading += Math.max(-turn, Math.min(turn, diff));
    const b = o.ball(t);
    const gap = Math.hypot(b.x - x, b.y - y) - o.ring;
    const facing = Math.max(0.25, Math.cos(Math.min(Math.PI, Math.abs(diff))));
    const target = o.topSpeed * facing * Math.max(0, Math.min(1, gap / o.brakeYards));
    speed = speed < target ? Math.min(target, speed + accel) : Math.max(target, speed - 2 * accel);
    x += Math.cos(heading) * speed * step;
    y += Math.sin(heading) * speed * step;
    if (o.corridor !== undefined) {
      const lane: Pt[] = [b];
      for (let k = 1; k <= 5; k++) lane.push(o.ball(Math.min(o.t1, t + (k * o.corridor.ms) / 5)));
      for (let i = 1; i < lane.length; i++) {
        const p = pushOutOfSegment({ x, y }, lane[i - 1] as Pt, lane[i] as Pt, o.corridor.half);
        x = p.x;
        y = p.y;
      }
    }
    const r = Math.hypot(x - b.x, y - b.y);
    if (r < o.ring) {
      const ux = r < 1e-9 ? (x <= MID_X ? -1 : 1) : (x - b.x) / r;
      const uy = r < 1e-9 ? 0 : (y - b.y) / r;
      x = b.x + ux * o.ring;
      y = b.y + uy * o.ring;
    }
    if (o.minY !== undefined) y = Math.max(o.minY, y);
    if (o.maxY !== undefined) y = Math.min(o.maxY, y);
    x = clampX(x);
    out.push({ t, x, y });
  }
  return out;
}

/** Moves p out of a band of half-width h around the segment a-b (perpendicular push). */
function pushOutOfSegment(p: Pt, a: Pt, b: Pt, h: number): Pt {
  const L = dist(a, b);
  if (L < 1e-6) return p;
  const ux = (b.x - a.x) / L;
  const uy = (b.y - a.y) / L;
  const s = (p.x - a.x) * ux + (p.y - a.y) * uy;
  if (s < 0 || s > L) return p;
  const nx = -uy;
  const ny = ux;
  const off = (p.x - a.x) * nx + (p.y - a.y) * ny;
  if (Math.abs(off) >= h) return p;
  const side = off === 0 ? (p.x <= MID_X ? -1 : 1) * Math.sign(nx || 1) : Math.sign(off);
  return { x: p.x + nx * (side * h - off), y: p.y + ny * (side * h - off) };
}

/**
 * Keeps keys at least `ring` from the ball, key by key: pushed radially (turning at most 45
 * degrees a key, so never across the ball), or for linemen sideways only, holding their depth.
 */
export function ringFix(keys: readonly Key[], ball: (t: number) => Pt, ring: number, from: number, to: number, mode: "radial" | "sideways", away: -1 | 1): Key[] {
  const raw = ringFixRaw(keys, ball, ring, from, to, mode, away);
  // A mark that was pushed eases back to his own path, at most `back` yards a key beyond his own
  // movement, so a ball that has just passed can't be clipped between two keys.
  const back = 0.25;
  const out: Key[] = [];
  let off = { x: 0, y: 0 };
  raw.forEach((k, i) => {
    const nat = keys[i] as Key;
    const want = { x: k.x - nat.x, y: k.y - nat.y };
    const pushing = Math.hypot(want.x, want.y) > Math.hypot(off.x, off.y);
    if (pushing || k.t < from || k.t > to) off = want;
    else {
      const dx = want.x - off.x;
      const dy = want.y - off.y;
      const len = Math.hypot(dx, dy);
      off = len <= back ? want : { x: off.x + (dx / len) * back, y: off.y + (dy / len) * back };
      // Never ease back inside the ring: then the pushed point stands.
      const b = ball(Math.min(k.t, to - 1));
      if (Math.hypot(clampX(nat.x + off.x) - b.x, nat.y + off.y - b.y) < ring) off = want;
    }
    out.push({ t: k.t, x: clampX(nat.x + off.x), y: nat.y + off.y });
  });
  return out;
}

function ringFixRaw(keys: readonly Key[], ball: (t: number) => Pt, ring: number, from: number, to: number, mode: "radial" | "sideways", away: -1 | 1): Key[] {
  let dir: number | null = null;
  let side = 0;
  return keys.map((k) => {
    if (k.t < from || k.t > to) return k;
    const b = ball(Math.min(k.t, to - 1));
    const d = dist(k, b);
    if (mode === "sideways") {
      const dy = k.y - b.y;
      const mySide = k.x === b.x ? (k.x <= MID_X ? -1 : 1) : Math.sign(k.x - b.x);
      // A pushed mark goes back only once the ball is well clear, so the step back can't clip it between keys.
      const clear = side === 0 ? d >= ring : d >= ring * 1.5;
      if (clear && (side === 0 || mySide === side || Math.abs(dy) >= ring)) {
        side = 0;
        return k;
      }
      if (side === 0) side = mySide;
      const want = b.x + side * Math.max(Math.sqrt(Math.max(0, ring * ring - dy * dy)), side * (k.x - b.x));
      const x = clampX(want);
      if (x === want) return { t: k.t, x, y: k.y };
      const back = Math.sqrt(Math.max(0, ring * ring - (x - b.x) * (x - b.x)));
      const dirY = Math.abs(dy) < 1e-9 ? away : Math.sign(dy);
      return { t: k.t, x, y: dirY < 0 ? Math.min(k.y, b.y - back) : Math.max(k.y, b.y + back) };
    }
    const own = d < 1e-9 ? (dir ?? (k.x <= MID_X ? Math.PI : 0)) : Math.atan2(k.y - b.y, k.x - b.x);
    if (dir === null) {
      if (d >= ring) return k;
      dir = own;
    } else {
      const diff = ((own - dir + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      const next = Math.abs(diff) <= Math.PI / 4 ? own : dir + Math.sign(diff) * (Math.PI / 4);
      if (next === own && d >= ring * 1.5) {
        dir = null;
        return k;
      }
      dir = next;
    }
    const r = Math.max(ring, d);
    const want = b.x + r * Math.cos(dir);
    const x = clampX(want);
    if (x === want) return { t: k.t, x, y: b.y + r * Math.sin(dir) };
    // A sideline clips the push: stay on the ring by moving up or down instead, on the side he is on.
    const dy = Math.sqrt(Math.max(0, r * r - (x - b.x) * (x - b.x)));
    const up = Math.abs(k.y - b.y) < 1e-9 ? away > 0 : k.y > b.y;
    dir = Math.atan2(up ? dy : -dy, x - b.x);
    return { t: k.t, x, y: b.y + (up ? dy : -dy) };
  });
}

/**
 * The settle (300 ms after the whistle): the mark eases to rest along its last direction, at most
 * `maxYards`, and a defender stops at the ring around the ball's dead spot.
 */
export function settle(keys: readonly Key[], whistle: number, ms: number, maxYards: number, keyMs: number, ballEnd: Pt, ring: number | null): Key[] {
  const p1 = at(keys, whistle);
  const p0 = at(keys, whistle - keyMs);
  const vx = (p1.x - p0.x) / keyMs;
  const vy = (p1.y - p0.y) / keyMs;
  // Decelerating linearly to rest over ms covers half of v x ms.
  let dx = (vx * ms) / 2;
  let dy = (vy * ms) / 2;
  const len = Math.hypot(dx, dy);
  if (len > maxYards) {
    dx *= maxYards / len;
    dy *= maxYards / len;
  }
  const before = keys.filter((k) => k.t < whistle - 1e-9);
  const out: Key[] = [...before, { t: whistle, ...p1 }];
  for (const t of grid(whistle, whistle + ms, keyMs).slice(1)) {
    const s = (t - whistle) / ms;
    const e = 1 - (1 - s) * (1 - s);
    let x = p1.x + dx * e;
    let y = p1.y + dy * e;
    if (ring !== null) {
      const r = Math.hypot(x - ballEnd.x, y - ballEnd.y);
      if (r < ring && Math.hypot(p1.x - ballEnd.x, p1.y - ballEnd.y) >= ring) {
        const ux = r < 1e-9 ? 1 : (x - ballEnd.x) / r;
        const uy = r < 1e-9 ? 0 : (y - ballEnd.y) / r;
        x = ballEnd.x + ux * ring;
        y = ballEnd.y + uy * ring;
      } else if (r < ring) {
        x = p1.x;
        y = p1.y;
      }
    }
    out.push({ t, x: clampX(x), y });
  }
  return out;
}

/** Velocity (yards per ms) at t from the keys. */
export function velocity(keys: readonly Key[], t: number, keyMs: number): Pt {
  const a = at(keys, t - keyMs);
  const b = at(keys, t);
  return { x: (b.x - a.x) / keyMs, y: (b.y - a.y) / keyMs };
}
