// Pure geometry for drawing marks: paths that stop at a mark's edge, and where each jersey number
// goes (DESIGN.md Shapes and Spacing). No canvas here, so the rules can be tested.

import type { Art } from "./art";
import type { Key as TKey, Timeline } from "./timeline";
import { at as atKeys } from "./motion";

export interface P {
  readonly x: number;
  readonly y: number;
}

const dist = (a: P, b: P): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The polyline cut back by `d` from its end, so a path stops at the edge of the mark it leads to
 * (its arrowhead tip or block tick sits there, not under the mark). Null when the path is shorter than `d`.
 */
export function trimEnd(points: readonly P[], d: number): P[] | null {
  if (points.length < 2) return null;
  let left = d;
  const out = [...points];
  while (out.length >= 2) {
    const b = out[out.length - 1] as P;
    const a = out[out.length - 2] as P;
    const len = dist(a, b);
    if (len > left) {
      const f = (len - left) / len;
      out[out.length - 1] = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      return out;
    }
    left -= len;
    out.pop();
  }
  return null;
}

/** Designed: how far a short block's preview tick shows past the edge of the blocker's mark, yards. */
export const BLOCK_TICK_YARDS = 0.4;

/**
 * A run block's set path can be shorter than the edge-of-mark trim, so it would draw nothing. It
 * gets a minimum tick instead, in the block's direction, so every blocker has a preview path.
 */
export function blockTick(points: readonly P[], edgeYards: number): P[] | null {
  const a = points[0];
  const b = points[points.length - 1];
  if (a === undefined || b === undefined) return null;
  const len = dist(a, b);
  if (len < 1e-9) return null;
  const k = (edgeYards + BLOCK_TICK_YARDS) / len;
  return [a, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }];
}

export type NumberMode = "involved" | "all" | "none";

/**
 * Which marks show their number at time t. Default (DESIGN.md Spacing): every mark at the set,
 * only the players the engine named during the live play, every mark again at the whistle. In the
 * huddle (`lineup`, before the set) the side still in its huddle shows no numbers.
 */
export function numberShown(mode: NumberMode, phase: "lineup" | "set" | "live" | "whistle", named: boolean, inHuddle = false): boolean {
  if (mode === "none") return false;
  if (phase === "lineup" && inHuddle) return false;
  if (mode === "all") return true;
  return phase !== "live" || named;
}

// ---------------------------------------------------------------- paths as drawn

export interface PathPrim {
  readonly side: "O" | "X";
  readonly points: readonly P[];
  /**
   * How the path ends (DESIGN.md Paths, Prime Time): an arrowhead for offense routes, a tick for
   * blocks, a dot for defense; "none" while the path is still drawing on behind its mark.
   */
  readonly end: "arrow" | "block" | "dot" | "none";
  /** True for the preview art of your call (drawn at the route alpha), false for a drawn path. */
  readonly faint: boolean;
  /** 1, except the preview's fade-out over the first `fadeMs` after the snap (1 to 0), and a kick trail piece's alpha (Q4). */
  readonly fade: number;
  readonly slot: string;
  /** A piece of a kick trail (Q4): drawn at `fade`, its alpha falling from 1 at the mark to 0 at the tail. */
  readonly trail?: boolean;
}

/** A kick trail's longest piece, in timeline ms: its alpha changes by at most step / fadeMs along it. */
export const TRAIL_STEP_MS = 25;

/**
 * A kick trail (calling screen pass Q4): the last `fadeMs` of an unnamed player's travel up to t,
 * in pieces between his keys, each at the alpha of its middle (1 at the mark, 0 at the tail), cut
 * back to the mark's edge. Nothing at the whistle and after.
 */
export function trailPieces(m: Timeline["marks"][number], tl: Pick<Timeline, "snapAt" | "liveEnd">, t: number, fadeMs: number, edgeYards: number): PathPrim[] {
  if (t <= tl.snapAt || t >= tl.liveEnd || fadeMs <= 0) return [];
  const from = Math.max(tl.snapAt, t - fadeMs);
  // Cut at his keys and at least every TRAIL_STEP_MS, so a piece's alpha (taken at its middle) is
  // about 1 at the mark however far apart his keys are (code review S3).
  const steps: number[] = [];
  for (let x = t - TRAIL_STEP_MS; x > from; x -= TRAIL_STEP_MS) steps.push(x);
  const times = [...new Set([from, ...m.keys.filter((k: TKey) => k.t > from && k.t < t).map((k) => k.t), ...steps, t])].sort((a, b) => a - b);
  const pts: P[] = times.map((x) => atKeys(m.keys, x));
  const trimmed = trimEnd(pts, edgeYards);
  if (trimmed === null) return [];
  const out: PathPrim[] = [];
  for (let i = 1; i < trimmed.length; i++) {
    const a = trimmed[i - 1] as P;
    const b = trimmed[i] as P;
    if (dist(a, b) < 1e-6) continue;
    const mid = ((times[i - 1] as number) + (times[i] as number)) / 2;
    out.push({ side: m.side, points: [a, b], end: "none", faint: false, fade: Math.max(0, Math.min(1, 1 - (t - mid) / fadeMs)), slot: m.slot, trail: true });
  }
  return out;
}

/** The preview art's opacity factor at t: 1 before the snap, fading to 0 over `fadeMs` after it. */
export function previewFade(tl: Pick<Timeline, "snapAt">, t: number, fadeMs: number): number {
  if (t < tl.snapAt) return 1;
  if (fadeMs <= 0 || t >= tl.snapAt + fadeMs) return 0;
  return 1 - (t - tl.snapAt) / fadeMs;
}

/**
 * Every path the field draws at time t, in field yards: before the snap the preview art of your
 * call (from the calls, never the result: P3), fading out over `fadeMs` after the snap; from the
 * snap each mark's path drawn on behind him, up to where he is now and never past his path end
 * (the read for unnamed players, the whistle for named ones: decision 13), cut back to the mark's
 * edge (DESIGN.md Shapes). Once a path has ended it takes its end cap: a block tick for linemen
 * who blocked, an arrowhead for other offense, a dot for defense. Every path is solid.
 */
export function pathPrimitives(tl: Timeline, t: number, edgeYards: number, fadeMs = 0): PathPrim[] {
  const out: PathPrim[] = [];
  const fade = previewFade(tl, t, fadeMs);
  if (fade > 0) {
    const art: Art | null = tl.preview;
    for (const p of art?.paths ?? []) {
      const pts = trimEnd(p.points, edgeYards) ?? (p.kind === "block" ? blockTick(p.points, edgeYards) : null);
      if (pts !== null) out.push({ side: p.side, points: pts, end: p.side === "X" ? "dot" : p.end, faint: true, fade, slot: p.slot });
    }
  }
  if (t < tl.snapAt) return out;
  const trail = tl.kickTrail;
  for (const m of tl.marks) {
    // Q4: on a kick, a player the result doesn't name draws a fading trail, and nothing at the whistle.
    if (trail !== undefined && !tl.involved.includes(m.playerId)) {
      out.push(...trailPieces(m, tl, t, trail.fadeMs, edgeYards));
      continue;
    }
    const upto = Math.min(t, m.pathEnd);
    if (upto <= tl.snapAt) continue;
    const keys = m.keys.filter((k: TKey) => k.t >= tl.snapAt && k.t < upto);
    const pts: P[] = [atKeys(m.keys, tl.snapAt), ...keys.map((k) => ({ x: k.x, y: k.y })), atKeys(m.keys, upto)];
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1] as P, pts[i] as P);
    if (len < 0.25) continue;
    // Cut back to the edge of the mark only where the mark is (the path's end is the mark now).
    const atMark = upto >= t - 1e-9;
    const drawn = atMark ? trimEnd(pts, edgeYards) : pts;
    if (drawn === null) continue;
    const ended = t >= m.pathEnd;
    out.push({ side: m.side, points: drawn, end: !ended ? "none" : m.side === "X" ? "dot" : m.pathStyle, faint: false, fade: 1, slot: m.slot });
  }
  return out;
}

export interface MarkPx {
  readonly id: string;
  readonly side: "O" | "X";
  /** Center in canvas px. */
  readonly x: number;
  readonly y: number;
  readonly ringed: boolean;
  readonly named: boolean;
  /** The one label: the overall, or the jersey number (the label content setting, U7). */
  readonly number: number;
  readonly show: boolean;
}

export interface NumberBox {
  readonly id: string;
  /** The label as drawn. */
  readonly number: string;
  /** Center of the box, px. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The width a label's tag pill takes at `px`: 0.62 em per character (an upper bound for Inter's
 * digits) plus the pill's 2 px padding each side (DESIGN.md Marks, mark.label).
 */
export function labelWidth(text: string, px: number): number {
  return text.length * px * 0.62 + 4;
}

/** The height of a label's tag pill at `px`: 14 px at the 12 px label (DESIGN.md Marks). */
export function labelHeight(px: number): number {
  return px + 2;
}

/** Ring 6 px outside the mark (DESIGN.md mark.ballCarrier), 2 px stroke. */
export const RING_GAP = 6;

function boxHitsCircle(b: NumberBox, c: P, r: number): boolean {
  const nx = Math.max(b.x - b.w / 2, Math.min(c.x, b.x + b.w / 2));
  const ny = Math.max(b.y - b.h / 2, Math.min(c.y, b.y + b.h / 2));
  return Math.hypot(nx - c.x, ny - c.y) < r;
}

function boxesHit(a: NumberBox, b: NumberBox): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
}

/**
 * Places every shown label (one per mark): under an O, above an X, 2 px off the mark (outside the
 * ring when ringed); to the right, then the left, when that spot is on another mark. Named players
 * go first; a label that would still collide is hidden, except a named player's, which always
 * draws (DESIGN.md Spacing: "the named player's number is drawn and the other is hidden").
 */
export function placeNumbers(marks: readonly MarkPx[], markPx: number, numberPx: number): NumberBox[] {
  const r = markPx / 2;
  const placed: NumberBox[] = [];
  const order = [...marks.filter((m) => m.show && m.named), ...marks.filter((m) => m.show && !m.named)];
  for (const m of order) {
    const h = labelHeight(numberPx);
    const reach = (m.ringed ? r + RING_GAP + 1 : r) + 2;
    const number = String(m.number);
    const w = labelWidth(number, numberPx);
    const candidates: NumberBox[] = [
      { id: m.id, number, x: m.x, y: m.side === "O" ? m.y + reach + h / 2 : m.y - reach - h / 2, w, h },
      { id: m.id, number, x: m.x + reach + w / 2, y: m.y, w, h },
      { id: m.id, number, x: m.x - reach - w / 2, y: m.y, w, h },
    ];
    const free = (b: NumberBox): boolean => marks.every((o) => o.id === m.id || !boxHitsCircle(b, o, r)) && placed.every((p) => !boxesHit(b, p));
    const pick = candidates.find(free) ?? (m.named ? candidates[0] : undefined);
    if (pick !== undefined) placed.push(pick);
  }
  return placed;
}

/**
 * Where field.huddleLabel goes (usability pass U6), in canvas px: the label's center, or null when
 * no spot is free. It never crosses a line (the line of scrimmage, the line to gain, a goal line:
 * `lineYs`, canvas y) or touches a mark, and stays between the sidelines. First choice is 1 yard
 * right of the horseshoe, centered on it; then the same spot stepped up and down; then the left
 * side; then above and below the horseshoe.
 */
export function placeHuddleLabel(
  huddle: readonly P[],
  marks: readonly P[],
  lineYs: readonly number[],
  o: { readonly w: number; readonly h: number; readonly markPx: number; readonly yardPx: number; readonly left: number; readonly right: number },
): P | null {
  if (huddle.length === 0) return null;
  const r = o.markPx / 2;
  const xs = huddle.map((p) => p.x);
  const ys = huddle.map((p) => p.y);
  const x0 = Math.min(...xs) - r;
  const x1 = Math.max(...xs) + r;
  const y0 = Math.min(...ys) - r;
  const y1 = Math.max(...ys) + r;
  const cy = (y0 + y1) / 2;
  const cx = (x0 + x1) / 2;
  const pad = 2;
  const box = (c: P): NumberBox => ({ id: "", number: "", x: c.x, y: c.y, w: o.w + 2 * pad, h: o.h + 2 * pad });
  const free = (c: P): boolean => {
    const b = box(c);
    if (b.x - b.w / 2 < o.left || b.x + b.w / 2 > o.right) return false;
    if (lineYs.some((ly) => Math.abs(ly - b.y) * 2 < b.h)) return false;
    return marks.every((m) => !boxHitsCircle(b, m, r));
  };
  const steps = [0, -1, 1, -2, 2, -3, 3, -4, 4].map((k) => k * o.h);
  const candidates: P[] = [
    ...steps.map((dy) => ({ x: x1 + o.yardPx + o.w / 2, y: cy + dy })),
    ...steps.map((dy) => ({ x: x0 - o.yardPx - o.w / 2, y: cy + dy })),
    { x: cx, y: y0 - o.yardPx / 2 - o.h / 2 },
    { x: cx, y: y1 + o.yardPx / 2 + o.h / 2 },
  ];
  return candidates.find(free) ?? null;
}
