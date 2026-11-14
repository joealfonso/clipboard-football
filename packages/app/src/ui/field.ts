// Canvas 2D drawing of the portrait field and one frame of a timeline. Reads the timeline only;
// decides nothing. Flat colors from DESIGN.md, no gradients or shadows. Team colors never appear
// here (spec H3): marks are offense blue O's and defense orange-brown X's for both teams.

import { FIELD_WIDTH_YARDS, type Layout } from "./layout";
import { at, MID_X, type Key, type Timeline, type TLMark } from "./timeline";
import { numberShown, placeNumbers, RING_GAP, trimEnd, type MarkPx } from "./marks";
import { COLOR, FONT_MONO, FONT_UI } from "./tokens";

export type MarkLabels = "involved" | "all" | "none";

export interface FieldScene {
  readonly los: number;
  readonly firstDown: number | null;
  /** Names for the end zones: bottom is the offense's own, top the other team's. */
  readonly bottomName: string;
  readonly topName: string;
  readonly endZoneYards: number;
}

export interface FrameOpts {
  readonly numbers: Readonly<Record<string, number>>;
  readonly markLabels: MarkLabels;
  readonly routeAlpha: number;
  readonly textScale: number;
}

/** Field-to-canvas mapping; the canvas covers the field column only. */
export interface View {
  readonly s: number;
  readonly width: number;
  readonly height: number;
  readonly cameraY: number;
  readonly markPx: number;
}

export function viewOf(l: Layout, cameraY: number): View {
  return { s: l.s, width: l.field.width, height: l.field.height, cameraY, markPx: l.markPx };
}

const X = (v: View, x: number): number => (1 + x) * v.s;
const Y = (v: View, y: number): number => (v.cameraY - y) * v.s;

export function drawField(g: CanvasRenderingContext2D, v: View, scene: FieldScene, textScale: number): void {
  const ez = scene.endZoneYards;
  g.fillStyle = COLOR.paper;
  g.fillRect(0, 0, v.width, v.height);
  // End zones.
  g.fillStyle = COLOR.paperShade;
  g.fillRect(X(v, 0), Y(v, 100 + ez), FIELD_WIDTH_YARDS * v.s, ez * v.s);
  g.fillRect(X(v, 0), Y(v, 0), FIELD_WIDTH_YARDS * v.s, ez * v.s);
  // Hash marks: a 1-yard tick each yard, two columns at the NFL hash positions.
  const hashIn = (70 * 12 + 9) / 36;
  g.strokeStyle = COLOR.hash;
  g.lineWidth = 1;
  g.beginPath();
  for (let y = 1; y < 100; y++) {
    if (y % 5 === 0) continue;
    for (const hx of [hashIn, FIELD_WIDTH_YARDS - hashIn]) {
      g.moveTo(X(v, hx - 0.5), Y(v, y));
      g.lineTo(X(v, hx + 0.5), Y(v, y));
    }
  }
  g.stroke();
  // Yard lines every 5, goal lines in ink.
  const numberPx = Math.max(24, 24 * textScale);
  g.font = `500 ${numberPx}px ${FONT_MONO}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let y = 0; y <= 100; y += 5) {
    const goal = y === 0 || y === 100;
    g.strokeStyle = goal ? COLOR.ink : COLOR.line;
    g.lineWidth = goal ? 2 : 1;
    g.beginPath();
    g.moveTo(X(v, 0), Y(v, y));
    g.lineTo(X(v, FIELD_WIDTH_YARDS), Y(v, y));
    g.stroke();
    if (y % 10 === 0 && !goal) {
      const label = String(y <= 50 ? y : 100 - y);
      for (const nx of [4, FIELD_WIDTH_YARDS - 4]) {
        const w = g.measureText(label).width + 6;
        g.fillStyle = COLOR.paper;
        g.fillRect(X(v, nx) - w / 2, Y(v, y) - numberPx / 2, w, numberPx);
        g.fillStyle = COLOR.line;
        g.fillText(label, X(v, nx), Y(v, y));
      }
    }
  }
  // Boundary.
  g.strokeStyle = COLOR.ink;
  g.lineWidth = 2;
  g.strokeRect(X(v, 0), Y(v, 100 + ez), FIELD_WIDTH_YARDS * v.s, (100 + 2 * ez) * v.s);
  // Goal posts on each end line, seen from above: crossbar 18 ft 6 in, a dot for each upright.
  const half = (18.5 / 3) / 2;
  for (const ey of [100 + ez, -ez]) {
    g.beginPath();
    g.moveTo(X(v, MID_X - half), Y(v, ey));
    g.lineTo(X(v, MID_X + half), Y(v, ey));
    g.stroke();
    g.fillStyle = COLOR.ink;
    for (const ux of [MID_X - half, MID_X + half]) {
      g.beginPath();
      g.arc(X(v, ux), Y(v, ey), 4, 0, Math.PI * 2);
      g.fill();
    }
  }
  // End zone names, upright.
  g.fillStyle = COLOR.inkSoft;
  g.font = `600 ${Math.round(20 * textScale)}px ${FONT_UI}`;
  // Toward the end line, clear of the goal line where the play happens.
  const nameIn = Math.min(ez / 2, 2.5);
  g.fillText(scene.topName.toUpperCase(), X(v, MID_X), Y(v, 100 + ez - nameIn));
  g.fillText(scene.bottomName.toUpperCase(), X(v, MID_X), Y(v, -ez + nameIn));
  // Line of scrimmage and the line to gain.
  g.strokeStyle = COLOR.ink;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(X(v, 0), Y(v, scene.los));
  g.lineTo(X(v, FIELD_WIDTH_YARDS), Y(v, scene.los));
  g.stroke();
  if (scene.firstDown !== null && scene.firstDown < 100) {
    g.setLineDash([8, 6]);
    g.beginPath();
    g.moveTo(X(v, 0), Y(v, scene.firstDown));
    g.lineTo(X(v, FIELD_WIDTH_YARDS), Y(v, scene.firstDown));
    g.stroke();
    g.setLineDash([]);
  }
}

function polyline(g: CanvasRenderingContext2D, v: View, pts: readonly { x: number; y: number }[]): void {
  g.beginPath();
  pts.forEach((p, i) => (i === 0 ? g.moveTo(X(v, p.x), Y(v, p.y)) : g.lineTo(X(v, p.x), Y(v, p.y))));
  g.stroke();
}

/** Keys from the snap up to time t, ending at the position at t. */
function trail(keys: readonly Key[], from: number, t: number): { x: number; y: number }[] {
  const pts = keys.filter((k) => k.t >= from && k.t < t).map((k) => ({ x: k.x, y: k.y }));
  return [at(keys, from), ...pts, at(keys, t)];
}

function arrowhead(g: CanvasRenderingContext2D, v: View, a: { x: number; y: number }, b: { x: number; y: number }): void {
  const ang = Math.atan2(Y(v, b.y) - Y(v, a.y), X(v, b.x) - X(v, a.x));
  const len = 7;
  g.beginPath();
  g.moveTo(X(v, b.x), Y(v, b.y));
  g.lineTo(X(v, b.x) - len * Math.cos(ang - 0.45), Y(v, b.y) - len * Math.sin(ang - 0.45));
  g.moveTo(X(v, b.x), Y(v, b.y));
  g.lineTo(X(v, b.x) - len * Math.cos(ang + 0.45), Y(v, b.y) - len * Math.sin(ang + 0.45));
  g.stroke();
}

/** path.block: a short tick across the end of a lineman's path. */
function blockTick(g: CanvasRenderingContext2D, v: View, a: { x: number; y: number }, b: { x: number; y: number }): void {
  const ang = Math.atan2(Y(v, b.y) - Y(v, a.y), X(v, b.x) - X(v, a.x)) + Math.PI / 2;
  const half = 5;
  g.beginPath();
  g.moveTo(X(v, b.x) - half * Math.cos(ang), Y(v, b.y) - half * Math.sin(ang));
  g.lineTo(X(v, b.x) + half * Math.cos(ang), Y(v, b.y) + half * Math.sin(ang));
  g.stroke();
}

function moves(m: TLMark, snapAt: number): boolean {
  const last = m.keys[m.keys.length - 1] as Key;
  const a = at(m.keys, snapAt);
  return last.t > snapAt && Math.hypot(last.x - a.x, last.y - a.y) > 0.25;
}

/** One frame of the timeline at time t (ms at 1x). */
export function drawFrame(g: CanvasRenderingContext2D, v: View, tl: Timeline, t: number, o: FrameOpts): void {
  const whistle = t >= tl.liveEnd;
  // Paths: faint previews of diagram routes at the set (never a fact path, which would show the
  // result early), then each path as far as the play has gone.
  for (const m of tl.marks) {
    if (!moves(m, tl.snapAt)) continue;
    const color = m.side === "O" ? COLOR.offense : COLOR.defense;
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.setLineDash(m.side === "X" ? [6, 4] : []);
    // Every path stops at the edge of the mark it leads to (DESIGN.md Shapes), 1 px clear.
    const edge = (v.markPx / 2 + 1) / v.s;
    const preview = t < tl.snapAt;
    if (preview && m.fact) continue;
    const pts = trimEnd(trail(m.keys, tl.snapAt, preview ? Infinity : t), edge);
    if (pts === null) continue;
    if (preview) g.globalAlpha = o.routeAlpha;
    polyline(g, v, pts);
    const last = m.keys[m.keys.length - 1] as Key;
    const ended = preview || t >= last.t;
    if (m.side === "O" && ended && pts.length >= 2) {
      const a = pts[pts.length - 2] as { x: number; y: number };
      const b = pts[pts.length - 1] as { x: number; y: number };
      if (m.position === "OL") blockTick(g, v, a, b);
      else arrowhead(g, v, a, b);
    }
    g.globalAlpha = 1;
  }
  g.setLineDash([]);
  // The ball's flight, dotted.
  for (const p of tl.paths) {
    if (p.kind !== "ball" || t < p.start) continue;
    const a = p.points[0];
    const b = p.points[p.points.length - 1];
    if (a === undefined || b === undefined) continue;
    const f = Math.min(1, (t - p.start) / Math.max(1, p.end - p.start));
    g.strokeStyle = COLOR.ball;
    g.lineWidth = 2;
    g.setLineDash([2, 5]);
    polyline(g, v, [a, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }]);
    g.setLineDash([]);
  }
  // Marks.
  const r = v.markPx / 2;
  const numberPx = Math.round(12 * o.textScale);
  g.font = `600 ${numberPx}px ${FONT_MONO}`;
  g.textAlign = "center";
  for (const m of tl.marks) {
    const p = at(m.keys, t);
    const cx = X(v, p.x);
    const cy = Y(v, p.y);
    g.lineWidth = 2;
    g.strokeStyle = m.side === "O" ? COLOR.offense : COLOR.defense;
    g.beginPath();
    if (m.side === "O") g.arc(cx, cy, r - 1, 0, Math.PI * 2);
    else {
      const k = (r - 1) * Math.SQRT1_2 * 1.2;
      g.moveTo(cx - k, cy - k);
      g.lineTo(cx + k, cy + k);
      g.moveTo(cx + k, cy - k);
      g.lineTo(cx - k, cy + k);
    }
    g.stroke();
    if (whistle && tl.rings.includes(m.playerId)) {
      g.strokeStyle = COLOR.ink;
      g.beginPath();
      g.arc(cx, cy, r + RING_GAP, 0, Math.PI * 2);
      g.stroke();
    }
  }
  // Jersey numbers: all at the set, named players during the live play, all at the whistle.
  const phase = t < tl.snapAt ? "set" : whistle ? "whistle" : "live";
  const inside = o.markLabels === "all" && v.markPx >= 20;
  const placedMarks: MarkPx[] = tl.marks.flatMap((m) => {
    const n = o.numbers[m.playerId];
    if (n === undefined) return [];
    const p = at(m.keys, t);
    const named = tl.involved.includes(m.playerId);
    return [{ id: m.playerId, side: m.side, x: X(v, p.x), y: Y(v, p.y), ringed: whistle && tl.rings.includes(m.playerId), named, number: n, show: numberShown(o.markLabels, phase, named) }];
  });
  const sideOf = new Map(tl.marks.map((m) => [m.playerId, m.side]));
  g.textBaseline = "middle";
  if (inside) {
    for (const m of placedMarks) {
      if (!m.show) continue;
      g.fillStyle = m.side === "O" ? COLOR.offense : COLOR.defense;
      g.fillText(String(m.number), m.x, m.y);
    }
  } else {
    for (const b of placeNumbers(placedMarks, v.markPx, numberPx)) {
      g.fillStyle = sideOf.get(b.id) === "O" ? COLOR.offense : COLOR.defense;
      g.fillText(String(o.numbers[b.id]), b.x, b.y);
    }
  }
  // Flags and labels at the whistle.
  for (const f of tl.flags) {
    if (t < f.t) continue;
    const fx = X(v, f.at.x);
    const fy = Y(v, f.at.y);
    g.fillStyle = COLOR.signal;
    g.strokeStyle = COLOR.ink;
    g.lineWidth = 2;
    g.fillRect(fx - 6, fy - 6, 12, 12);
    g.strokeRect(fx - 6, fy - 6, 12, 12);
    g.fillStyle = COLOR.ink;
    g.font = `600 ${Math.round(14 * o.textScale)}px ${FONT_UI}`;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(f.text, fx + 10, fy);
  }
  g.font = `700 ${Math.round(18 * o.textScale)}px ${FONT_UI}`;
  g.textAlign = "center";
  g.textBaseline = "bottom";
  for (const l of tl.labels) {
    if (t < l.t) continue;
    const lx = Math.min(Math.max(X(v, l.at.x), 60), v.width - 60);
    const ly = Y(v, l.at.y) - r - 10;
    const w = g.measureText(l.text).width + 8;
    g.fillStyle = COLOR.paper;
    g.fillRect(lx - w / 2, ly - 20 * o.textScale, w, 22 * o.textScale);
    g.fillStyle = COLOR.ink;
    g.fillText(l.text, lx, ly);
  }
  // The ball, always on top.
  const b = at(tl.ball, t);
  drawBall(g, v, b.x, b.y);
}

export function drawBall(g: CanvasRenderingContext2D, v: View, x: number, y: number): void {
  g.fillStyle = COLOR.ball;
  g.beginPath();
  g.ellipse(X(v, x), Y(v, y), 2.5, 3.5, 0, 0, Math.PI * 2);
  g.fill();
}
