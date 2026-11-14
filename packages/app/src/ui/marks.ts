// Pure geometry for drawing marks: paths that stop at a mark's edge, and where each jersey number
// goes (DESIGN.md Shapes and Spacing). No canvas here, so the rules can be tested.

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

export type NumberMode = "involved" | "all" | "none";

/**
 * Which marks show their number at time t. Default (DESIGN.md Spacing): every mark at the set,
 * only the players the engine named during the live play, every mark again at the whistle.
 */
export function numberShown(mode: NumberMode, phase: "set" | "live" | "whistle", named: boolean): boolean {
  if (mode === "none") return false;
  if (mode === "all") return true;
  return phase !== "live" || named;
}

export interface MarkPx {
  readonly id: string;
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
    const w = String(m.number).length * numberPx * 0.62 + 2;
    const h = numberPx;
    const reach = (m.ringed ? r + RING_GAP + 1 : r) + 2;
    const candidates: NumberBox[] = [
      { id: m.id, x: m.x, y: m.side === "O" ? m.y + reach + h / 2 : m.y - reach - h / 2, w, h },
      { id: m.id, x: m.x + reach + w / 2, y: m.y, w, h },
      { id: m.id, x: m.x - reach - w / 2, y: m.y, w, h },
    ];
    const free = (b: NumberBox): boolean => marks.every((o) => o.id === m.id || !boxHitsCircle(b, o, r)) && placed.every((p) => !boxesHit(b, p));
    const pick = candidates.find(free) ?? (m.named ? candidates[0] : undefined);
    if (pick !== undefined) placed.push(pick);
  }
  return placed;
}
