// Canvas 2D drawing of the portrait field and one frame of a timeline. Reads the timeline only;
// decides nothing. DESIGN.md "Broadcast" (2026-11-15): the canvas is transparent outside the field
// column (the CSS stage shows through), the column casts a soft shadow onto the stage, the turf has
// a center light, and marks are team-colored discs and X's with a ring and a soft shadow. Every
// small word on the grass sits on a tag pill.

import { FIELD_WIDTH_YARDS, type Layout } from "./layout";
import { at, MID_X, scaleAt, type Timeline } from "./timeline";
import { numberShown, pathPrimitives, placeHuddleLabel, placeNumbers, RING_GAP, type MarkPx } from "./marks";
import type { LabelContent } from "./screens";
import { COLOR, DUR, FONT_DISPLAY, FONT_UI, NO_SHADOW, RADIUS, SHADOW, type CanvasShadow } from "./tokens";

export type MarkLabels = "involved" | "all" | "none";

/** One side's mark colors: the fill, and the ring around it (null: no ring). */
export interface SideInk {
  readonly fill: string;
  readonly ring: string | null;
}

/** Mark and path colors by side: O is the team with the ball, X the other. */
export interface FieldInk {
  readonly O: SideInk;
  readonly X: SideInk;
}

/** No team known (tests, a frame with no matchup): white marks over a dark ring, like the splash. */
export const NEUTRAL_INK: FieldInk = { O: { fill: COLOR.line, ring: COLOR.outlineDark }, X: { fill: COLOR.line, ring: COLOR.outlineDark } };

export interface FieldScene {
  readonly los: number;
  readonly firstDown: number | null;
  /** Names for the end zones: bottom is the offense's own, top the other team's. */
  readonly bottomName: string;
  readonly topName: string;
  readonly endZoneYards: number;
  /** Team end zone colors (team.<id>.endZone): bottom is the offense's, top the defense's. Absent: turf. */
  readonly endZones?: { readonly bottom: string; readonly top: string };
  /** The matchup's mark colors for this possession (marks, paths). Absent: FrameOpts.ink. */
  readonly ink?: FieldInk;
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
  /** Mark and path colors by side (team colors in a game, the splash ink on the main menu). Absent: NEUTRAL_INK. */
  readonly ink?: FieldInk;
}

/** Field-to-canvas mapping; the canvas covers the window under the top bar, the column in it. */
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
/** A 1 px line's coordinate on a half pixel, so it stays sharp. */
const crisp = (p: number): number => Math.round(p - 0.5) + 0.5;

function shadow(g: CanvasRenderingContext2D, s: CanvasShadow): void {
  g.shadowColor = s.color;
  g.shadowBlur = s.blur;
  g.shadowOffsetX = 0;
  g.shadowOffsetY = s.offsetY;
}

/** A rounded rectangle path (falls back to a plain one where roundRect is missing). */
function roundedPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  const rr = Math.min(r, w / 2, h / 2);
  if (typeof g.roundRect === "function") g.roundRect(x, y, w, h, rr);
  else g.rect(x, y, w, h);
}

/** A tag pill (color.tag, radius.pill) centered on (cx, cy). */
function pill(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  g.fillStyle = COLOR.tag;
  roundedPath(g, cx - w / 2, cy - h / 2, w, h, RADIUS.pill);
  g.fill();
}

/** On-field text on its tag: the pill, then the text in color.line, centered on (cx, cy). */
function taggedText(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, w: number, h: number): void {
  pill(g, cx, cy, w, h);
  g.fillStyle = COLOR.line;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, cx, cy);
}

/** The radial turf light over the column (gradient.turfLight); skipped where gradients are missing. */
function turfLight(g: CanvasRenderingContext2D, v: View): void {
  if (typeof g.createRadialGradient !== "function") return;
  const cx = v.ox + v.columnWidth / 2;
  const cy = v.height / 2;
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, 0.6 * Math.hypot(v.columnWidth, v.height));
  if (grad === undefined || grad === null || typeof grad.addColorStop !== "function") return;
  grad.addColorStop(0, COLOR.turfLight);
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  g.fillStyle = grad;
  g.fillRect(v.ox, 0, v.columnWidth, v.height);
}

export function drawField(g: CanvasRenderingContext2D, v: View, scene: FieldScene, textScale: number): void {
  const ez = scene.endZoneYards;
  const W = FIELD_WIDTH_YARDS * v.s;
  // Transparent outside the column: the stage gradient shows from CSS (DESIGN.md Field).
  g.clearRect(0, 0, v.width, v.height);
  // field.shadow: the column lifts off the stage, left and right, only when there is stage beside it.
  if (v.width > v.columnWidth + 1) shadow(g, SHADOW.field);
  g.fillStyle = COLOR.sideline;
  g.fillRect(v.ox, 0, v.columnWidth, v.height);
  shadow(g, NO_SHADOW);
  // End zones: flat team.<id>.endZone (turf when no team is known).
  g.fillStyle = scene.endZones?.top ?? COLOR.turf;
  g.fillRect(X(v, 0), Y(v, 100 + ez), W, ez * v.s);
  g.fillStyle = scene.endZones?.bottom ?? COLOR.turf;
  g.fillRect(X(v, 0), Y(v, 0), W, ez * v.s);
  // Mowing stripes: 5-yard bands, turf at each goal line, alternating toward the 50 (so the 50
  // sits between two matching bands).
  for (let y = 0; y < 100; y += 5) {
    const k = y < 50 ? y / 5 : (95 - y) / 5;
    g.fillStyle = k % 2 === 0 ? COLOR.turf : COLOR.turfStripe;
    g.fillRect(X(v, 0), Y(v, y + 5), W, 5 * v.s);
  }
  // field.light: fixed to the view, over turf, stripes and end zones, under all paint.
  turfLight(g, v);
  // Hash marks: a 1-yard tick each yard, two columns at the NFL hash positions.
  const hashIn = (70 * 12 + 9) / 36;
  g.strokeStyle = COLOR.hash;
  g.lineWidth = 1;
  g.lineCap = "butt";
  g.beginPath();
  for (let y = 1; y < 100; y++) {
    if (y % 5 === 0) continue;
    for (const hx of [hashIn, FIELD_WIDTH_YARDS - hashIn]) {
      g.moveTo(X(v, hx - 0.5), crisp(Y(v, y)));
      g.lineTo(X(v, hx + 0.5), crisp(Y(v, y)));
    }
  }
  g.stroke();
  // Yard lines every 5 at 0.8 alpha, 1 px; goal lines full, 3 px. Yard numbers every 10 with the
  // line broken behind the digits (no box: a box would cut across two stripes).
  const numberPx = Math.round(Math.max(24, 26 * textScale));
  g.font = `700 ${numberPx}px ${FONT_DISPLAY}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.strokeStyle = COLOR.line;
  g.fillStyle = COLOR.line;
  for (let y = 0; y <= 100; y += 5) {
    const goal = y === 0 || y === 100;
    const numbered = y % 10 === 0 && !goal;
    const label = String(y <= 50 ? y : 100 - y);
    const gap = numbered ? g.measureText(label).width + 6 : 0;
    const ly = goal ? Y(v, y) : crisp(Y(v, y));
    g.lineWidth = goal ? 3 : 1;
    g.globalAlpha = goal ? 1 : 0.8;
    g.beginPath();
    if (numbered) {
      const [l, r] = [X(v, 4), X(v, FIELD_WIDTH_YARDS - 4)];
      g.moveTo(X(v, 0), ly);
      g.lineTo(l - gap / 2, ly);
      g.moveTo(l + gap / 2, ly);
      g.lineTo(r - gap / 2, ly);
      g.moveTo(r + gap / 2, ly);
      g.lineTo(X(v, FIELD_WIDTH_YARDS), ly);
    } else {
      g.moveTo(X(v, 0), ly);
      g.lineTo(X(v, FIELD_WIDTH_YARDS), ly);
    }
    g.stroke();
    g.globalAlpha = 1;
    if (numbered) for (const nx of [4, FIELD_WIDTH_YARDS - 4]) g.fillText(label, X(v, nx), Y(v, y));
  }
  // Boundary: sidelines and end lines.
  g.lineWidth = 3;
  g.strokeRect(X(v, 0), Y(v, 100 + ez), W, (100 + 2 * ez) * v.s);
  // Goal posts on each end line, seen from above: crossbar 18 ft 6 in, a dot for each upright.
  // Departs from DESIGN.md's literal sizes (2 px crossbar, 4 px dots, no casing) so the posts read
  // against the 3 px white end line: the crossbar is 2 px line over a 4 px outlineDark casing and
  // each upright a radius-4 line dot with a 1.5 px outlineDark ring. Round caps per Broadcast.
  const half = (18.5 / 3) / 2;
  g.lineCap = "round";
  for (const ey of [100 + ez, -ez]) {
    for (const [style, width] of [[COLOR.outlineDark, 4], [COLOR.line, 2]] as const) {
      g.strokeStyle = style;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(X(v, MID_X - half), Y(v, ey));
      g.lineTo(X(v, MID_X + half), Y(v, ey));
      g.stroke();
    }
    g.strokeStyle = COLOR.outlineDark;
    g.lineWidth = 1.5;
    for (const ux of [MID_X - half, MID_X + half]) {
      g.beginPath();
      g.arc(X(v, ux), Y(v, ey), 4, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }
  // End zone names, upright, block caps in the display face (32 px, never under 28: large text).
  g.font = `700 ${Math.round(Math.max(28, 32 * textScale))}px ${FONT_DISPLAY}`;
  if ("letterSpacing" in g) g.letterSpacing = "0.06em";
  // Toward the end line, clear of the goal line where the play happens.
  const nameIn = Math.min(ez / 2, 2.5);
  g.fillText(scene.topName.toUpperCase(), X(v, MID_X), Y(v, 100 + ez - nameIn));
  g.fillText(scene.bottomName.toUpperCase(), X(v, MID_X), Y(v, -ez + nameIn));
  if ("letterSpacing" in g) g.letterSpacing = "0px";
  // Line of scrimmage: solid outlineDark, 3 px, round caps.
  g.strokeStyle = COLOR.outlineDark;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(X(v, 0), Y(v, scene.los));
  g.lineTo(X(v, FIELD_WIDTH_YARDS), Y(v, scene.los));
  g.stroke();
  // First-down line: solid signal 3 px over a 5 px outlineDark casing (1 px each side), round caps.
  if (scene.firstDown !== null && scene.firstDown < 100) {
    for (const [style, width] of [[COLOR.outlineDark, 5], [COLOR.signal, 3]] as const) {
      g.strokeStyle = style;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(X(v, 0), Y(v, scene.firstDown));
      g.lineTo(X(v, FIELD_WIDTH_YARDS), Y(v, scene.firstDown));
      g.stroke();
    }
  }
  g.lineCap = "butt";
}

/** Path strokes: 5 px in the side's ring color, then 2.5 px in its fill (DESIGN.md Paths). */
function inked(g: CanvasRenderingContext2D, ink: FieldInk, side: "O" | "X", draw: () => void): void {
  const s = ink[side];
  g.lineCap = "round";
  g.lineJoin = "round";
  if (s.ring !== null) {
    g.strokeStyle = s.ring;
    g.lineWidth = 5;
    draw();
  }
  g.strokeStyle = s.fill;
  g.lineWidth = 2.5;
  draw();
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

/** path.block: a 10 px tick across the end of a lineman's path. */
function blockTick(g: CanvasRenderingContext2D, v: View, a: { x: number; y: number }, b: { x: number; y: number }): void {
  const ang = Math.atan2(Y(v, b.y) - Y(v, a.y), X(v, b.x) - X(v, a.x)) + Math.PI / 2;
  const half = 5;
  g.beginPath();
  g.moveTo(X(v, b.x) - half * Math.cos(ang), Y(v, b.y) - half * Math.sin(ang));
  g.lineTo(X(v, b.x) + half * Math.cos(ang), Y(v, b.y) + half * Math.sin(ang));
  g.stroke();
}

/** One mark (DESIGN.md Marks): a filled disc for O, a rounded X for D, each ringed, with shadow.mark. */
export function drawMark(g: CanvasRenderingContext2D, side: "O" | "X", s: SideInk, cx: number, cy: number, r: number): void {
  if (side === "O") {
    const rr = Math.max(0.5, r - 0.75);
    shadow(g, SHADOW.mark);
    g.fillStyle = s.fill;
    g.beginPath();
    g.arc(cx, cy, rr, 0, Math.PI * 2);
    g.fill();
    shadow(g, NO_SHADOW);
    if (s.ring !== null) {
      g.strokeStyle = s.ring;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(cx, cy, rr, 0, Math.PI * 2);
      g.stroke();
    }
    return;
  }
  const k = (r - 1) * Math.SQRT1_2 * 1.2;
  const cross = (): void => {
    g.beginPath();
    g.moveTo(cx - k, cy - k);
    g.lineTo(cx + k, cy + k);
    g.moveTo(cx + k, cy - k);
    g.lineTo(cx - k, cy + k);
    g.stroke();
  };
  g.lineCap = "round";
  if (s.ring !== null) {
    shadow(g, SHADOW.mark);
    g.strokeStyle = s.ring;
    g.lineWidth = 6;
    cross();
    shadow(g, NO_SHADOW);
  }
  g.strokeStyle = s.fill;
  g.lineWidth = 3.5;
  cross();
}

/** field.huddleLabel's text (usability pass U6). */
export const HUDDLE_LABEL = "Huddle";

/** Tag sizes (DESIGN.md Marks): mark labels 14 px tall, 2 px padding; other tags 18 px tall, 6 px padding (at text scale 1). */
export const TAG = { labelPadX: 2, labelExtraH: 2, wordPadX: 6, wordExtraH: 4 } as const;

/** A mark's position on the canvas at t, for hit-testing a hover (the player card). */
export function markPositions(v: View, tl: Timeline, t: number): { id: string; x: number; y: number }[] {
  return tl.marks.filter((m) => !m.playerId.startsWith("huddle:") && !m.playerId.startsWith("own:")).map((m) => {
    const p = at(m.keys, t);
    return { id: m.playerId, x: X(v, p.x), y: Y(v, p.y) };
  });
}

/** ease.out (cubic-bezier(0, 0, 0.2, 1)), close enough for a 6 px rise: a cubic ease-out. */
const easeOut = (f: number): number => 1 - (1 - f) ** 3;

/** One frame of the timeline at time t (ms at 1x). */
export function drawFrame(g: CanvasRenderingContext2D, v: View, tl: Timeline, t: number, o: FrameOpts): void {
  const ink = o.ink ?? NEUTRAL_INK;
  const whistle = t >= tl.liveEnd;
  const r = v.markPx / 2;
  // The preview art's zones and depth bands sit under everything else, faint.
  if (t < tl.snapAt && tl.preview !== null) {
    // Bands and zones: color.line at 10%, at the faint route opacity.
    g.globalAlpha = o.routeAlpha * 0.1;
    g.fillStyle = COLOR.line;
    for (const b of tl.preview.bands) g.fillRect(X(v, 0), Y(v, b.y1), FIELD_WIDTH_YARDS * v.s, (b.y1 - b.y0) * v.s);
    for (const z of tl.preview.zones) g.fillRect(X(v, Math.min(z.x0, z.x1)), Y(v, Math.max(z.y0, z.y1)), Math.abs(z.x1 - z.x0) * v.s, Math.abs(z.y1 - z.y0) * v.s);
    // Zone edges dashed, tethers and the generic offense circle, each over its ring.
    g.globalAlpha = o.routeAlpha;
    for (const z of tl.preview.zones) {
      inked(g, ink, "X", () => {
        g.setLineDash([4, 3]);
        g.strokeRect(X(v, Math.min(z.x0, z.x1)), Y(v, Math.max(z.y0, z.y1)), Math.abs(z.x1 - z.x0) * v.s, Math.abs(z.y1 - z.y0) * v.s);
        g.setLineDash([]);
      });
    }
    for (const tt of tl.preview.tethers) {
      inked(g, ink, "X", () => polyline(g, v, [tt.from, tt.to]));
      inked(g, ink, "O", () => {
        g.beginPath();
        g.arc(X(v, tt.to.x), Y(v, tt.to.y), 4, 0, Math.PI * 2);
        g.stroke();
      });
    }
    g.globalAlpha = 1;
  }
  // Paths (pure: marks.pathPrimitives), each stopping at the mark's edge.
  for (const p of pathPrimitives(tl, t, (r + 1) / v.s)) {
    g.globalAlpha = p.faint ? o.routeAlpha : 1;
    inked(g, ink, p.side, () => {
      g.setLineDash(p.dashed ? [6, 4] : []);
      polyline(g, v, p.points);
      g.setLineDash([]);
      const a = p.points[p.points.length - 2];
      const b = p.points[p.points.length - 1];
      if (a !== undefined && b !== undefined) {
        if (p.end === "block") blockTick(g, v, a, b);
        else if (p.end === "arrow") arrowhead(g, v, a, b);
      }
    });
    g.globalAlpha = 1;
  }
  // The ball's flight, dotted white, round caps.
  g.lineCap = "round";
  for (const p of tl.paths) {
    if (p.kind !== "ball" || t < p.start) continue;
    const a = p.points[0];
    const b = p.points[p.points.length - 1];
    if (a === undefined || b === undefined) continue;
    const f = Math.min(1, (t - p.start) / Math.max(1, p.end - p.start));
    g.strokeStyle = COLOR.line;
    g.lineWidth = 2;
    g.setLineDash([2, 5]);
    polyline(g, v, [a, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }]);
    g.setLineDash([]);
  }
  // Marks, then the ball-carrier ring (with glow.carrier) or the player-card focus ring (no glow).
  for (const m of tl.marks) {
    const p = at(m.keys, t);
    const cx = X(v, p.x);
    const cy = Y(v, p.y);
    drawMark(g, m.side, ink[m.side], cx, cy, r);
    const carrier = whistle && tl.rings.includes(m.playerId);
    if (carrier || o.focused === m.playerId) {
      if (carrier) shadow(g, SHADOW.carrier);
      g.strokeStyle = COLOR.line;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, r + RING_GAP, 0, Math.PI * 2);
      g.stroke();
      shadow(g, NO_SHADOW);
    }
  }
  g.lineCap = "butt";
  // Mark labels: all at the set, named players during the live play, all at the whistle; the side
  // still in its huddle shows none until the set. One label per mark on a tag pill: the overall,
  // or the jersey number (Joseph, 2026-11-14).
  const numberPx = Math.round(12 * o.textScale);
  const pillH = numberPx + TAG.labelExtraH;
  g.font = `600 ${numberPx}px ${FONT_UI}`;
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
  const labelW = (text: string): number => g.measureText(text).width + 2 * TAG.labelPadX;
  if (inside) {
    for (const m of placedMarks) {
      if (!m.show) continue;
      const text = String(m.number);
      taggedText(g, text, m.x, m.y, labelW(text), pillH);
    }
  } else {
    for (const b of placeNumbers(placedMarks, v.markPx, numberPx)) taggedText(g, b.number, b.x, b.y, labelW(b.number), pillH);
  }
  // field.huddleLabel: "Huddle" on a tag beside their horseshoe, only in a still Calling frame (in a
  // timeline the huddle breaks within the line-up, so it needs no label).
  const wordPx = Math.round(14 * o.textScale);
  const wordH = wordPx + TAG.wordExtraH;
  const huddle = tl.setAt === Infinity ? tl.marks.filter((m) => m.huddle) : [];
  if (huddle.length > 0) {
    const toPx = (m: (typeof tl.marks)[number]): { x: number; y: number } => {
      const p = at(m.keys, t);
      return { x: X(v, p.x), y: Y(v, p.y) };
    };
    g.font = `600 ${wordPx}px ${FONT_UI}`;
    // Clear of the line of scrimmage, the line to gain, the goal lines and every mark: the pill's box.
    const lines = [tl.los, ...(tl.firstDown === null ? [] : [tl.firstDown]), 0, 100].map((y) => Y(v, y));
    const w = g.measureText(HUDDLE_LABEL).width + 2 * TAG.wordPadX;
    const spot = placeHuddleLabel(huddle.map(toPx), tl.marks.map(toPx), lines, { w, h: wordH, markPx: v.markPx, yardPx: v.s, left: X(v, 0), right: X(v, FIELD_WIDTH_YARDS) });
    if (spot !== null) taggedText(g, HUDDLE_LABEL, spot.x, spot.y, w, wordH);
  }
  // fx.flag: a 12 px signal square, radius 3, 2 px outlineDark outline, at the spot, plus its tag.
  for (const f of tl.flags) {
    if (t < f.t) continue;
    const fx = X(v, f.at.x);
    const fy = Y(v, f.at.y);
    g.fillStyle = COLOR.signal;
    g.strokeStyle = COLOR.outlineDark;
    g.lineWidth = 2;
    roundedPath(g, fx - 6, fy - 6, 12, 12, 3);
    g.fill();
    g.stroke();
    g.font = `600 ${wordPx}px ${FONT_UI}`;
    const w = g.measureText(f.text).width + 2 * TAG.wordPadX;
    taggedText(g, f.text, fx + 10 + w / 2, fy, w, wordH);
  }
  // fx.score and fx.turnover: a toast above the spot (surfaceSolid at 0.92, radius.md, hairlineStrong,
  // shadow.toast, a 3 px signal accent bar inside the left edge), fading and rising 6 px in over dur.slow.
  const toastPx = Math.round(22 * o.textScale);
  g.font = `700 ${toastPx}px ${FONT_DISPLAY}`;
  for (const l of tl.labels) {
    if (t < l.t) continue;
    // The final frame (skip, reduced motion, the whistle hold) always shows the toast whole.
    const f = t >= tl.total ? 1 : easeOut(Math.min(1, (t - l.t) / DUR.slow));
    const text = l.text.toUpperCase();
    const w = g.measureText(text).width + 24;
    const h = toastPx + 12;
    const lx = Math.min(Math.max(X(v, l.at.x), X(v, -1) + w / 2 + 4), X(v, FIELD_WIDTH_YARDS + 1) - w / 2 - 4);
    const bottom = Y(v, l.at.y) - r - 10 + 6 * (1 - f);
    const x0 = lx - w / 2;
    const y0 = bottom - h;
    shadow(g, SHADOW.toast);
    g.fillStyle = COLOR.surfaceSolid;
    g.globalAlpha = f * 0.92;
    roundedPath(g, x0, y0, w, h, RADIUS.md);
    g.fill();
    shadow(g, NO_SHADOW);
    g.globalAlpha = f;
    g.strokeStyle = COLOR.hairlineStrong;
    g.lineWidth = 1;
    roundedPath(g, x0 + 0.5, y0 + 0.5, w - 1, h - 1, RADIUS.md);
    g.stroke();
    g.fillStyle = COLOR.signal;
    roundedPath(g, x0 + 4, y0 + 6, 3, h - 12, 2);
    g.fill();
    g.fillStyle = COLOR.chalk;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, lx + 2, y0 + h / 2);
    g.globalAlpha = 1;
  }
  // The ball, always on top; its size shows its height in flight.
  const b = at(tl.ball, t);
  drawBall(g, v, b.x, b.y, scaleAt(tl.ballScale, t));
}

export function drawBall(g: CanvasRenderingContext2D, v: View, x: number, y: number, scale = 1): void {
  g.fillStyle = COLOR.ball;
  g.strokeStyle = COLOR.line;
  g.lineWidth = 1.5;
  shadow(g, SHADOW.mark);
  g.beginPath();
  g.ellipse(X(v, x), Y(v, y), 2.5 * scale, 3.5 * scale, 0, 0, Math.PI * 2);
  g.fill();
  shadow(g, NO_SHADOW);
  g.stroke();
}
