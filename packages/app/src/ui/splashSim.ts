// The main menu's live plays (Joseph, 2026-11-15: "procedurally generate plays that happen live").
// A designed toy simulation for the splash only, never the engine and never model output: it
// picks a random call for each side from the play-card templates, lines both units up from the
// same art the play cards draw, then plays the snap out step by step. Players run at their
// position's speed after their own reaction time, linemen engage, the ball is handed off or
// thrown, defenders chase whoever has it, and the play ends on a tackle, an incompletion, a sack
// or a breakaway whistled near the top of the picture. Same seed, same play.
//
// Pure: no DOM. The splash (splash.ts) paints what this returns.

import type { Pt } from "./motion";

/** One mark as the art lines it up: its side, position, start and the paths the art gives it. */
export interface SimMark {
  readonly side: "O" | "X";
  readonly position: string;
  readonly slot: string;
  readonly start: Pt;
  readonly paths: readonly { readonly kind: string; readonly points: readonly Pt[] }[];
}

/** One generated call for each side (ids as in data/calls/catalog.json and templates.json). */
export interface SplashCall {
  readonly formation: string;
  readonly play: string;
  readonly pkg: string;
  readonly preset: string;
}

export type SplashOutcome = "tackle" | "incomplete" | "sack" | "runaway" | "timeout";

/** A played-out snap, sampled every DT seconds from the snap. */
export interface SplashScript {
  readonly call: SplashCall;
  readonly sides: readonly ("O" | "X")[];
  readonly positions: readonly string[];
  /** Step count; positions for step i, mark j at pos[(i * n + j) * 2]. */
  readonly steps: number;
  readonly pos: Float32Array;
  /** Ball per step: x, y and its height scale (1 on the ground or held, up to 1.5 at the top of a throw). */
  readonly ball: Float32Array;
  /** Step the ball leaves the passer's hand, or -1 (no throw). */
  readonly throwStep: number;
  /** Step the ball comes down (caught or not), or -1 (no throw). */
  readonly landStep: number;
  /** Step of the whistle (the play is over; everyone eases to a stop after it). */
  readonly whistleStep: number;
  readonly outcome: SplashOutcome;
  /** Mark index of the last ball carrier (-1: none, an incompletion). */
  readonly carrier: number;
}

/** Simulation step, seconds. */
export const DT = 1 / 60;

/** Top speeds, yards per second, by position (designed, roughly NFL tracking speeds). */
export const SPEED: Readonly<Record<string, number>> = { WR: 9.2, CB: 9.0, S: 8.6, RB: 8.8, TE: 7.6, LB: 7.9, QB: 6.6, OL: 4.4, DL: 5.6 };

const OFFENSE_FORMATIONS = ["shotgun", "underCenter", "pistol", "empty", "heavy"] as const;
const RUNS = ["insideRun", "outsideRun"] as const;
const PASSES = ["shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"] as const;
/** Each package's coverages (catalog.json defense.<package>; specials left out: goal line and prevent at midfield read wrong). */
export const DEFENSE_CALLS: Readonly<Record<string, readonly string[]>> = {
  base: ["baseCover3", "baseCover2", "runStuff"],
  nickel: ["nickelCover3", "nickelCover4", "nickelCover2", "nickel2Man", "nickelCover1", "nickelCover1Blitz"],
  dime: ["dimeCover4", "dimeCover0Blitz"],
};

/** A small fast seeded RNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length] as T;

/** A random call for each side. Empty (no back) never runs or screens; heavy (no receivers) runs or play-actions. */
export function randomCall(r: () => number): SplashCall {
  const formation = pick(r, OFFENSE_FORMATIONS);
  let play: string;
  if (formation === "empty") play = pick(r, ["shortPass", "intermediatePass", "deepPass"]);
  else if (formation === "heavy") play = r() < 0.65 ? pick(r, RUNS) : "playAction";
  else play = r() < 0.4 ? pick(r, RUNS) : pick(r, PASSES);
  // Defense leans to the offense's personnel, like a coordinator would, with room for surprises.
  const pkg = formation === "heavy" ? (r() < 0.8 ? "base" : "nickel") : formation === "empty" ? (r() < 0.6 ? "dime" : "nickel") : r() < 0.6 ? "nickel" : pick(r, ["base", "dime"]);
  return { formation, play, pkg, preset: pick(r, DEFENSE_CALLS[pkg] ?? ["nickelCover3"]) };
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(pts: readonly Pt[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += dist(pts[i] as Pt, pts[i - 1] as Pt);
  return d;
}

/** The point `d` yards along a polyline (its end past the end). */
export function pointAtDistance(pts: readonly Pt[], d: number): Pt {
  let left = Math.max(0, d);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Pt;
    const b = pts[i] as Pt;
    const seg = dist(a, b);
    if (left <= seg && seg > 0) return { x: a.x + ((b.x - a.x) * left) / seg, y: a.y + ((b.y - a.y) * left) / seg };
    left -= seg;
  }
  return pts[pts.length - 1] ?? { x: 0, y: 0 };
}

/**
 * One mark's route: its paths in order, joined, from where it lines up. A run that forks (outside
 * run: both edges) takes one branch at random.
 */
function routeOf(m: SimMark, r: () => number): { kind: string; points: Pt[] } {
  const runs = m.paths.filter((p) => p.kind === "run");
  const chosen = runs.length > 1 ? [...m.paths.filter((p) => p.kind !== "run"), pick(r, runs)] : m.paths;
  const pts: Pt[] = [m.start];
  let kind = "none";
  for (const p of chosen) {
    if (kind === "none" || p.kind === "run" || p.kind === "route") kind = p.kind;
    for (const q of p.points) if (dist(q, pts[pts.length - 1] as Pt) > 1e-6) pts.push(q);
  }
  return { kind, points: pts };
}

/** How far the whole picture shifts downfield (yards) so every route fits between `bottom` and `top`, a margin inside each. */
export function fitShift(marks: readonly SimMark[], bottom: number, top: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of marks) {
    for (const p of [m.start, ...m.paths.flatMap((q) => q.points)]) {
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
    }
  }
  if (!Number.isFinite(lo)) return 0;
  const margin = 2.5;
  // Room above the deepest route for a run after the catch: center the picture when it can't all fit.
  const wantHi = top - margin - 4;
  const wantLo = bottom + margin;
  if (hi - lo > wantHi - wantLo) return (wantHi + wantLo) / 2 - (hi + lo) / 2;
  if (hi > wantHi) return wantHi - hi;
  if (lo < wantLo) return wantLo - lo;
  return 0;
}

interface Body {
  readonly side: "O" | "X";
  readonly position: string;
  p: Pt;
  dir: Pt;
  readonly vmax: number;
  readonly react: number;
  readonly route: Pt[];
  readonly kind: string;
  readonly routeLen: number;
  along: number;
  /** Seconds left knocked off balance (a broken tackle). */
  stun: number;
  /** A rusher: seconds into the play he gets off a block (designed; the line mostly holds). */
  readonly shed: number;
}

const MAX_LIVE = 7;
const SETTLE = 0.6;

/**
 * Plays out one snap. `marks` come from the play-card art for `call`, already shifted to fit the
 * box; `bounds` is the box in field yards (x across, y downfield). Deterministic in `seed`.
 */
export function simulateSplash(call: SplashCall, marks: readonly SimMark[], bounds: { readonly bottom: number; readonly top: number; readonly los: number }, seed: number): SplashScript {
  const r = rng(seed ^ 0x9e3779b9);
  const n = marks.length;
  const bodies: Body[] = marks.map((m) => {
    const route = routeOf(m, r);
    return {
      side: m.side,
      position: m.position,
      p: { x: m.start.x, y: Math.min(bounds.top - 0.6, Math.max(bounds.bottom + 0.6, m.start.y)) },
      dir: { x: 0, y: m.side === "O" ? 1 : -1 },
      vmax: (SPEED[m.position] ?? 7) * (0.92 + 0.16 * r()),
      react: m.position === "OL" || m.position === "DL" ? 0.02 + 0.08 * r() : 0.05 + 0.2 * r(),
      route: route.points,
      kind: route.kind,
      routeLen: pathLength(route.points),
      along: 0,
      stun: 0,
      shed: 2.9 + 3 * r() * r() + (r() < 0.08 ? -1.2 : 0),
    };
  });
  const idx = (pred: (b: Body) => boolean): number[] => bodies.flatMap((b, i) => (pred(b) ? [i] : []));
  const qb = idx((b) => b.side === "O" && b.position === "QB")[0] ?? 0;
  const isRun = call.play === "insideRun" || call.play === "outsideRun";
  const runner = isRun ? (idx((b) => b.side === "O" && b.kind === "run")[0] ?? qb) : -1;
  const eligible = idx((b) => b.side === "O" && b.position !== "QB" && b.position !== "OL" && b.kind === "route");
  const screenTarget = call.play === "screenPass" ? (idx((b) => b.side === "O" && b.position === "RB" && b.kind === "route")[0] ?? -1) : -1;
  const throwAt = call.play === "screenPass" ? 0.9 + 0.4 * r() : call.play === "shortPass" ? 1.3 + 0.5 * r() : call.play === "deepPass" ? 2.3 + 0.6 * r() : 1.8 + 0.7 * r();
  const handoffAt = 0.35 + 0.2 * r();

  // Ball state: who holds it, or its flight.
  let holder = -1;
  const center = { x: bodies[qb]?.p.x ?? 26.6, y: bounds.los };
  let ballP: Pt = { ...center };
  let ballH = 1;
  let flight: { from: Pt; to: Pt; t0: number; dur: number; target: number } | null = null;
  let carrier = -1;
  let carrierAt = Infinity;
  let throwStep = -1;
  let landStep = -1;
  let whistle = -1;
  let outcome: SplashOutcome = "timeout";
  const tried = new Set<number>();

  const totalSteps = Math.ceil((MAX_LIVE + SETTLE) / DT);
  const pos = new Float32Array((totalSteps + 1) * n * 2);
  const ball = new Float32Array((totalSteps + 1) * 3);
  let step = 0;

  const record = (): void => {
    bodies.forEach((b, j) => {
      pos[(step * n + j) * 2] = b.p.x;
      pos[(step * n + j) * 2 + 1] = b.p.y;
    });
    ball[step * 3] = ballP.x;
    ball[step * 3 + 1] = ballP.y;
    ball[step * 3 + 2] = ballH;
  };
  record();

  /** Steps toward `to`. `turn` under 1 rounds off cuts in the open field; a path is followed exactly. */
  const move = (b: Body, to: Pt, speed: number, turn = 1): void => {
    const d = dist(b.p, to);
    if (d < 1e-6) return;
    const s = Math.min(d, speed * DT);
    const want = { x: (to.x - b.p.x) / d, y: (to.y - b.p.y) / d };
    const blend = { x: b.dir.x * (1 - turn) + want.x * turn, y: b.dir.y * (1 - turn) + want.y * turn };
    const m = Math.hypot(blend.x, blend.y);
    // Never step away from where he's going: a near-reversal turns on the spot.
    b.dir = m < 1e-6 || blend.x * want.x + blend.y * want.y < 0.5 * m ? want : { x: blend.x / m, y: blend.y / m };
    b.p = { x: b.p.x + b.dir.x * s, y: b.p.y + b.dir.y * s };
  };
  const nearest = (from: Pt, among: readonly number[]): { i: number; d: number } => {
    let best = { i: -1, d: Infinity };
    for (const i of among) {
      const d = dist(from, (bodies[i] as Body).p);
      if (d < best.d) best = { i, d };
    }
    return best;
  };
  const defense = idx((b) => b.side === "X");
  const blockers = idx((b) => b.side === "O" && (b.kind === "block" || b.position === "OL"));
  /** A rusher is held while a blocker stands within reach between him and the ball, until he sheds. */
  const engaged = (b: Body, goal: Pt, t: number): boolean =>
    t < b.shed && blockers.some((o) => {
      const q = (bodies[o] as Body).p;
      return dist(q, b.p) < 1.8 && dist(q, goal) < dist(b.p, goal) + 0.3;
    });

  for (step = 1; step <= totalSteps; step++) {
    const t = step * DT;
    const live = whistle < 0;
    const ballOwner = carrier >= 0 ? carrier : holder;
    const ownerP = ballOwner >= 0 ? (bodies[ballOwner] as Body).p : ballP;

    for (let j = 0; j < n; j++) {
      const b = bodies[j] as Body;
      if (!live) {
        // After the whistle: ease off in the direction of travel.
        const ease = Math.max(0, 1 - (step - whistle) * DT / SETTLE);
        b.p = { x: Math.min(53.3, Math.max(0, b.p.x + b.dir.x * b.vmax * 0.5 * ease * ease * DT)), y: Math.min(bounds.top - 0.6, Math.max(bounds.bottom + 0.6, b.p.y + b.dir.y * b.vmax * 0.5 * ease * ease * DT)) };
        continue;
      }
      if (t < b.react) continue;
      if (b.stun > 0) {
        b.stun -= DT;
        continue;
      }
      const speed = b.vmax * Math.min(1, (t - b.react) / 0.55);
      const onRoute = b.along < b.routeLen;
      // A defender reads the ball a beat after it changes hands (his own reaction time again).
      const pursuing = b.side === "X" && carrier >= 0 && t - carrierAt > 0.15 + b.react;

      if (j === carrier) {
        // The ball carrier: his path first (a run), then upfield, bending away from tacklers.
        if (onRoute && j === runner) {
          b.along += speed * DT;
          move(b, pointAtDistance(b.route, b.along), speed);
        } else {
          let ax = 0;
          let ay = 1.6;
          for (const d of defense) {
            const q = (bodies[d] as Body).p;
            const dd = dist(b.p, q);
            if (dd > 0.05 && dd < 6 && q.y > b.p.y - 1) {
              ax += ((b.p.x - q.x) / (dd * dd)) * 2.2;
              ay += ((b.p.y - q.y) / (dd * dd)) * 0.8;
            }
          }
          ax += (r() - 0.5) * 0.25;
          if (b.p.x < 3) ax += 0.8;
          if (b.p.x > 50.3) ax -= 0.8;
          move(b, { x: b.p.x + ax, y: b.p.y + Math.max(0.3, ay) }, speed, 0.3);
        }
      } else if (b.side === "O") {
        if (onRoute && !(carrier >= 0 && b.kind === "route")) {
          b.along += speed * (b.kind === "block" ? 0.6 : 1) * DT;
          move(b, pointAtDistance(b.route, b.along), speed);
        } else if (flight !== null && j === flight.target) {
          move(b, flight.to, speed);
        } else if (carrier >= 0 && j !== carrier && b.position !== "OL") {
          // Downfield blocking: drift to the nearest chaser between him and the carrier.
          const d = nearest(ownerP, defense);
          if (d.i >= 0) move(b, (bodies[d.i] as Body).p, speed * 0.6);
        } else if (blockers.includes(j)) {
          // Hold the point: square up to the nearest rusher in reach.
          const d = nearest(b.p, defense);
          if (d.i >= 0 && d.d < 3.5 && d.d > 0.9) move(b, (bodies[d.i] as Body).p, 2.2);
        } else if (j === qb && holder === qb && !isRun) {
          // Climb or slide away from the nearest rusher.
          const d = nearest(b.p, idx((x) => x.side === "X" && x.position === "DL"));
          if (d.i >= 0 && d.d < 3) {
            const q = (bodies[d.i] as Body).p;
            move(b, { x: b.p.x + (b.p.x - q.x), y: b.p.y + 0.4 }, 2.5);
          }
        }
      } else {
        // Defense.
        if (pursuing) {
          const c = bodies[carrier] as Body;
          const lead = Math.min(0.6, dist(b.p, c.p) / b.vmax);
          const aim = { x: c.p.x + c.dir.x * c.vmax * lead, y: c.p.y + c.dir.y * c.vmax * lead };
          move(b, aim, b.position === "DL" && engaged(b, aim, t) ? 0.9 : speed, 0.35);
        } else if (flight !== null && b.position !== "DL" && t - flight.t0 > 0.2 + b.react && dist(b.p, flight.to) < 12) {
          // Breaking on the throw: the men in range, a beat late.
          move(b, flight.to, speed * 0.9, 0.35);
        } else if (b.position === "DL" || b.kind === "rush") {
          const target = holder >= 0 ? (bodies[holder] as Body).p : ballP;
          move(b, target, engaged(b, target, t) ? 0.25 + 0.3 * r() : speed);
        } else if (onRoute) {
          b.along += speed * DT;
          move(b, pointAtDistance(b.route, b.along), speed);
        } else {
          // Zone: float over the nearest receiver in the area, keeping a cushion.
          const d = nearest(b.p, eligible);
          if (d.i >= 0 && d.d < 8) {
            const q = (bodies[d.i] as Body).p;
            move(b, { x: b.p.x + (q.x - b.p.x) * 0.6, y: q.y + 3 }, speed * 0.6, 0.35);
          }
        }
      }
      // Everyone but the man with the ball stays in the picture.
      b.p = { x: Math.min(53.3, Math.max(0, b.p.x)), y: Math.min(bounds.top - 0.6, Math.max(bounds.bottom + 0.6, b.p.y)) };
    }

    if (live) {
      // The snap, the handoff, the throw, the catch.
      if (holder < 0 && carrier < 0 && flight === null && t >= 0.12) holder = qb;
      if (isRun && carrier < 0 && t >= handoffAt) {
        carrier = runner;
        holder = runner;
        carrierAt = t;
      }
      if (!isRun && holder === qb && carrier < 0 && flight === null && t >= throwAt) {
        let target = screenTarget;
        if (target < 0) {
          // Throw to the most open man, with a coach's hunch thrown in.
          let best = -Infinity;
          for (const e of eligible) {
            const open = nearest((bodies[e] as Body).p, defense).d + r() * 3 + ((bodies[e] as Body).p.y - bounds.los) * 0.08;
            if (open > best) {
              best = open;
              target = e;
            }
          }
        }
        if (target >= 0) {
          const from = { ...(bodies[qb] as Body).p };
          const tb = bodies[target] as Body;
          let to = { ...tb.p };
          let dur = 0.3;
          for (let k = 0; k < 3; k++) {
            dur = Math.max(0.3, dist(from, to) / 19);
            to = { x: tb.p.x + tb.dir.x * tb.vmax * dur * 0.8, y: tb.p.y + tb.dir.y * tb.vmax * dur * 0.8 };
          }
          to = { x: Math.min(52, Math.max(1.3, to.x)), y: Math.min(bounds.top - 1.5, to.y) };
          flight = { from, to, t0: t, dur, target };
          holder = -1;
          throwStep = step;
        }
      }
      if (flight !== null) {
        const f = Math.min(1, (t - flight.t0) / flight.dur);
        ballP = { x: flight.from.x + (flight.to.x - flight.from.x) * f, y: flight.from.y + (flight.to.y - flight.from.y) * f };
        ballH = 1 + 0.5 * Math.sin(Math.PI * f) * Math.min(1, flight.dur / 0.8);
        if (f >= 1) {
          landStep = step;
          const tgt = bodies[flight.target] as Body;
          const cover = nearest(flight.to, defense).d;
          const chance = dist(tgt.p, flight.to) > 3 ? 0 : cover < 1.2 ? 0.5 : cover < 2.5 ? 0.72 : 0.9;
          if (r() < chance) {
            carrier = flight.target;
            holder = flight.target;
            carrierAt = t;
          } else {
            outcome = "incomplete";
            whistle = step;
          }
          ballH = 1;
          flight = null;
        }
      } else if (holder >= 0) {
        const h = bodies[holder] as Body;
        ballP = { x: h.p.x + 0.35, y: h.p.y + 0.1 };
        ballH = 1;
      }
      // Sacks and tackles.
      if (whistle < 0 && !isRun && holder === qb && carrier < 0) {
        if (defense.some((d) => dist((bodies[d] as Body).p, (bodies[qb] as Body).p) < 0.9)) {
          outcome = "sack";
          whistle = step;
        }
      }
      if (whistle < 0 && carrier >= 0) {
        const c = bodies[carrier] as Body;
        for (const d of defense) {
          const b = bodies[d] as Body;
          if (b.stun > 0 || dist(b.p, c.p) > 0.95) continue;
          if (tried.has(d) || r() < 0.8) {
            outcome = "tackle";
            whistle = step;
            break;
          }
          // Broken tackle: the defender goes down for a beat.
          tried.add(d);
          b.stun = 0.7;
        }
        // Broken free near the top of the picture: whistle him there, clear of the chase (a big gain).
        if (whistle < 0 && c.p.y > bounds.top - 3) {
          outcome = "runaway";
          whistle = step;
        }
      }
      if (whistle < 0 && t >= MAX_LIVE) whistle = step;
    }
    record();
    if (whistle >= 0 && step - whistle >= Math.round(SETTLE / DT)) break;
  }
  const steps = Math.min(step, totalSteps) + 1;
  return {
    call,
    sides: bodies.map((b) => b.side),
    positions: bodies.map((b) => b.position),
    steps,
    pos: pos.slice(0, steps * n * 2),
    ball: ball.slice(0, steps * 3),
    throwStep,
    landStep,
    whistleStep: whistle < 0 ? steps - 1 : whistle,
    outcome,
    carrier: outcome === "incomplete" ? -1 : carrier,
  };
}
