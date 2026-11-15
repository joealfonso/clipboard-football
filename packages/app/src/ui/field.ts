// Canvas 2D drawing of the portrait field and one frame of a timeline. Reads the timeline only;
// decides nothing. Flat colors from DESIGN.md, no gradients or shadows. Team colors never appear
// here (spec H3): marks are offense blue O's and defense orange-brown X's for both teams.

import { FIELD_WIDTH_YARDS, type Layout } from "./layout";
import { at, MID_X, scaleAt, type Timeline } from "./timeline";
import { numberShown, pathPrimitives, placeHuddleLabel, placeNumbers, RING_GAP, type MarkPx } from "./marks";
import type { LabelContent } from "./screens";
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
  /** Each player's overall (position-weighted card ratings, before home field), for the mark label. */
  readonly ratings: Readonly<Record<string, number>>;
  /** What a mark's one label shows: the overall or the jersey number (usability pass U7). */
  readonly labelContent: LabelContent;
  /** The mark whose player card is open (ringed so the keyboard user sees which). */
  readonly focused: string | null;
  readonly markLabels: MarkLabels;
  readonly routeAlpha: number;
  readonly textScale: number;
}

/** Field-to-canvas mapping; the canvas covers the window under the top bar, the column centered in it. */
export interface View {
  readonly s: number;
  /** Canvas x of the column's left edge (a yard outside the left sideline). */
  readonly ox: number;
  readonly width: number;
  /** Width of the field column (sideline to sideline plus a yard each side), px. */
  readonly columnWidth: number;
  readonly height: number;
  readonly cameraY: number;
  readonly markPx: number;
}

export function viewOf(l: Layout, cameraY: number): View {
  return { s: l.s, ox: l.column.left, width: l.field.width, columnWidth: l.column.width, height: l.field.height, cameraY, markPx: l.markPx };
}

const X = (v: View, x: number): number => v.ox + (1 + x) * v.s;
const Y = (v: View, y: number): number => (v.cameraY - y) * v.s;

export function drawField(g: CanvasRenderingContext2D, v: View, scene: FieldScene, textScale: number): void {
  const ez = scene.endZoneYards;
  // Paper across the field column only; the canvas outside it is the dark board, so the side
  // column stays dark during the live play when the panel is hidden (usability pass U1).
  g.fillStyle = COLOR.panel;
  g.fillRect(0, 0, v.width, v.height);
  g.fillStyle = COLOR.paper;
  g.fillRect(v.ox, 0, v.columnWidth, v.height);
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

/** field.huddleLabel's text (usability pass U6). */
export const HUDDLE_LABEL = "Huddle";

/** A mark's position on the canvas at t, for hit-testing a hover (the player card). */
export function markPositions(v: View, tl: Timeline, t: number): { id: string; x: number; y: number }[] {
  return tl.marks.filter((m) => !m.playerId.startsWith("huddle:") && !m.playerId.startsWith("own:")).map((m) => {
    const p = at(m.keys, t);
    return { id: m.playerId, x: X(v, p.x), y: Y(v, p.y) };
  });
}

/** One frame of the timeline at time t (ms at 1x). */
export function drawFrame(g: CanvasRenderingContext2D, v: View, tl: Timeline, t: number, o: FrameOpts): void {
  const whistle = t >= tl.liveEnd;
  const r = v.markPx / 2;
  // The preview art's zones and depth bands sit under everything else, faint.
  if (t < tl.snapAt && tl.preview !== null) {
    g.globalAlpha = o.routeAlpha;
    g.fillStyle = COLOR.paperShade;
    for (const b of tl.preview.bands) g.fillRect(X(v, 0), Y(v, b.y1), FIELD_WIDTH_YARDS * v.s, (b.y1 - b.y0) * v.s);
    g.strokeStyle = COLOR.defense;
    g.lineWidth = 1.5;
    g.setLineDash([4, 3]);
    for (const z of tl.preview.zones) {
      g.fillRect(X(v, Math.min(z.x0, z.x1)), Y(v, Math.max(z.y0, z.y1)), Math.abs(z.x1 - z.x0) * v.s, Math.abs(z.y1 - z.y0) * v.s);
      g.strokeRect(X(v, Math.min(z.x0, z.x1)), Y(v, Math.max(z.y0, z.y1)), Math.abs(z.x1 - z.x0) * v.s, Math.abs(z.y1 - z.y0) * v.s);
    }
    g.setLineDash([]);
    for (const tt of tl.preview.tethers) {
      g.strokeStyle = COLOR.defense;
      polyline(g, v, [tt.from, tt.to]);
      g.strokeStyle = COLOR.offense;
      g.beginPath();
      g.arc(X(v, tt.to.x), Y(v, tt.to.y), 4, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  // Paths (pure: marks.pathPrimitives), each stopping at the mark's edge.
  for (const p of pathPrimitives(tl, t, (r + 1) / v.s)) {
    g.globalAlpha = p.faint ? o.routeAlpha : 1;
    g.strokeStyle = p.side === "O" ? COLOR.offense : COLOR.defense;
    g.lineWidth = 2;
    g.setLineDash(p.dashed ? [6, 4] : []);
    polyline(g, v, p.points);
    g.setLineDash([]);
    const a = p.points[p.points.length - 2];
    const b = p.points[p.points.length - 1];
    if (a !== undefined && b !== undefined) {
      if (p.end === "block") blockTick(g, v, a, b);
      else if (p.end === "arrow") arrowhead(g, v, a, b);
    }
    g.globalAlpha = 1;
  }
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
    if ((whistle && tl.rings.includes(m.playerId)) || o.focused === m.playerId) {
      g.strokeStyle = COLOR.ink;
      g.beginPath();
      g.arc(cx, cy, r + RING_GAP, 0, Math.PI * 2);
      g.stroke();
    }
  }
  // Mark labels: all at the set, named players during the live play, all at the whistle; the side
  // still in its huddle shows none until the set. One label per mark, in the side's color: the
  // overall, or the jersey number (Joseph, 2026-11-14).
  const numberPx = Math.round(12 * o.textScale);
  g.font = `600 ${numberPx}px ${FONT_MONO}`;
  g.textAlign = "center";
  const phase = t < tl.setAt ? "lineup" : t < tl.snapAt ? "set" : whistle ? "whistle" : "live";
  const inside = o.markLabels === "all" && v.markPx >= 20;
  const placedMarks: MarkPx[] = tl.marks.flatMap((m) => {
    // Only real players have a label (the huddle and generic slots have no number).
    if (o.numbers[m.playerId] === undefined) return [];
    const label = o.labelContent === "rating" ? o.ratings[m.playerId] : o.numbers[m.playerId];
    if (label === undefined) return [];
    const p = at(m.keys, t);
    const named = tl.involved.includes(m.playerId);
    return [{ id: m.playerId, side: m.side, x: X(v, p.x), y: Y(v, p.y), ringed: (whistle && tl.rings.includes(m.playerId)) || o.focused === m.playerId, named, number: label, show: numberShown(o.markLabels, phase, named, m.huddle) }];
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
      g.fillText(b.number, b.x, b.y);
    }
  }
  // field.huddleLabel: "Huddle" beside their horseshoe, only in a still Calling frame (in a
  // timeline the huddle breaks within the line-up, so it needs no label).
  const huddle = tl.setAt === Infinity ? tl.marks.filter((m) => m.huddle) : [];
  if (huddle.length > 0) {
    const toPx = (m: (typeof tl.marks)[number]): { x: number; y: number } => {
      const p = at(m.keys, t);
      return { x: X(v, p.x), y: Y(v, p.y) };
    };
    const labelPx = Math.round(14 * o.textScale);
    g.font = `600 ${labelPx}px ${FONT_UI}`;
    // Clear of the line of scrimmage, the line to gain, the goal lines and every mark.
    const lines = [tl.los, ...(tl.firstDown === null ? [] : [tl.firstDown]), 0, 100].map((y) => Y(v, y));
    const w = g.measureText(HUDDLE_LABEL).width;
    const spot = placeHuddleLabel(huddle.map(toPx), tl.marks.map(toPx), lines, { w, h: labelPx, markPx: v.markPx, yardPx: v.s, left: X(v, 0), right: X(v, FIELD_WIDTH_YARDS) });
    if (spot !== null) {
      g.fillStyle = COLOR.inkSoft;
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillText(HUDDLE_LABEL, spot.x - w / 2, spot.y);
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
    const lx = Math.min(Math.max(X(v, l.at.x), X(v, -1) + 60), X(v, FIELD_WIDTH_YARDS + 1) - 60);
    const ly = Y(v, l.at.y) - r - 10;
    const w = g.measureText(l.text).width + 8;
    g.fillStyle = COLOR.paper;
    g.fillRect(lx - w / 2, ly - 20 * o.textScale, w, 22 * o.textScale);
    g.fillStyle = COLOR.ink;
    g.fillText(l.text, lx, ly);
  }
  // The ball, always on top; its size shows its height in flight.
  const b = at(tl.ball, t);
  drawBall(g, v, b.x, b.y, scaleAt(tl.ballScale, t));
}

export function drawBall(g: CanvasRenderingContext2D, v: View, x: number, y: number, scale = 1): void {
  g.fillStyle = COLOR.ball;
  g.beginPath();
  g.ellipse(X(v, x), Y(v, y), 2.5 * scale, 3.5 * scale, 0, 0, Math.PI * 2);
  g.fill();
}
