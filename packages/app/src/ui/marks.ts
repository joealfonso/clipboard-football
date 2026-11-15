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
  readonly end: "arrow" | "block" | "none";
  readonly dashed: boolean;
  /** 1 for a drawn path, the route alpha for the preview art. */
  readonly faint: boolean;
  readonly slot: string;
}

/**
 * Every path the field draws at time t, in field yards: before the snap the preview art of your
 * call (from the calls, never the result: P3); from the snap each mark's path up to its path end
 * (the read for unnamed players, the whistle for named ones: decision 13), cut back to the mark's
 * edge (DESIGN.md Shapes), ending in a block tick for linemen who blocked and an arrowhead for other
 * offense.
 */
export function pathPrimitives(tl: Timeline, t: number, edgeYards: number): PathPrim[] {
  const out: PathPrim[] = [];
  if (t < tl.snapAt) {
    const art: Art | null = tl.preview;
    for (const p of art?.paths ?? []) {
      const pts = trimEnd(p.points, edgeYards) ?? (p.kind === "block" ? blockTick(p.points, edgeYards) : null);
      if (pts !== null) out.push({ side: p.side, points: pts, end: p.end, dashed: p.side === "X" || p.kind === "fake", faint: true, slot: p.slot });
    }
    return out;
  }
  for (const m of tl.marks) {
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
    out.push({ side: m.side, points: drawn, end: !ended ? "none" : m.pathStyle, dashed: m.side === "X", faint: false, slot: m.slot });
  }
  return out;
}

export interface MarkPx {
  readonly id: string;
  /** The key rating beside the number, when the rating labels are on. */
  readonly rating?: number;
  readonly side: "O" | "X";
  /** Center in canvas px. */
  readonly x: number;
  readonly y: number;
  readonly ringed: boolean;
  readonly named: boolean;
  readonly number: number;
  readonly show: boolean;
}

export interface NumberBox {
  readonly id: string;
  /** What to draw: the number, or the number and the rating. */
  readonly text: string;
  /** Center of the text box, px. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
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
 * Places every shown number: under an O, above an X, 2 px off the mark (outside the ring when
 * ringed); to the right, then the left, when that spot is on another mark. Named players go first;
 * a number that would still collide is hidden, except a named player's, which always draws
 * (DESIGN.md Spacing: "the named player's number is drawn and the other is hidden").
 */
export function placeNumbers(marks: readonly MarkPx[], markPx: number, numberPx: number): NumberBox[] {
  const r = markPx / 2;
  const placed: NumberBox[] = [];
  const order = [...marks.filter((m) => m.show && m.named), ...marks.filter((m) => m.show && !m.named)];
  for (const m of order) {
    const h = numberPx;
    const reach = (m.ringed ? r + RING_GAP + 1 : r) + 2;
    // With the rating first; when space is short the rating hides before the number does.
    const texts = m.rating === undefined ? [String(m.number)] : [`${m.number} ${m.rating}`, String(m.number)];
    const candidates: NumberBox[] = texts.flatMap((text) => {
      const w = text.length * numberPx * 0.62 + 2;
      return [
        { id: m.id, text, x: m.x, y: m.side === "O" ? m.y + reach + h / 2 : m.y - reach - h / 2, w, h },
        { id: m.id, text, x: m.x + reach + w / 2, y: m.y, w, h },
        { id: m.id, text, x: m.x - reach - w / 2, y: m.y, w, h },
      ];
    });
    const free = (b: NumberBox): boolean => marks.every((o) => o.id === m.id || !boxHitsCircle(b, o, r)) && placed.every((p) => !boxesHit(b, p));
    const numberOnly = candidates.filter((c) => c.text === String(m.number));
    const pick = candidates.find(free) ?? (m.named ? numberOnly[0] : undefined);
    if (pick !== undefined) placed.push(pick);
  }
  return placed;
}
