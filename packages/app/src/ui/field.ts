// Canvas 2D drawing of the portrait field and one frame of a timeline. Reads the timeline only;
// decides nothing. DESIGN.md "Broadcast" (2026-11-15): the canvas is transparent outside the field
// column (the CSS stage shows through), the column casts a soft shadow onto the stage, the turf has
// a center light, and marks are team-colored discs and X's with a ring and a soft shadow. Every
// small word on the grass sits on a tag pill.

import { FIELD_WIDTH_YARDS, type Layout } from "./layout";
import { at, MID_X, scaleAt, type Timeline } from "./timeline";
import { numberShown, pathPrimitives, placeHuddleLabel, placeNumbers, previewFade, RING_GAP, type MarkPx, type P } from "./marks";
import type { LabelContent } from "./screens";
import { BANNER, BANNER_STILL, BANNER_T, bannerBox, bannerCovers, bannerPose, bigPlayCount, type Banner, type Moment } from "./moments";
import { CHIP_RING, COLOR, darkTier, DUR, EASE, ease, FONT_DISPLAY, FONT_UI, GRADIENT, NO_SHADOW, RADIUS, SHADOW, type CanvasShadow } from "./tokens";

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
  /** field.midfield: the home team's name, painted at the 50 (absent or empty: no wordmark). */
  readonly homeName?: string;
  /** field.downTag: the bug's down block text for the play ("3rd & 4"); absent or empty: no tag. */
  readonly downTag?: string;
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
  /** field.downTag's text, from the scene (drawn in the set phase and faded out at the snap). */
  readonly downTag?: string;
  /**
   * Present only while the animator plays the timeline in real time (not under reduced motion or
   * Skip): `speed` is timeline ms per wall ms (1 or 2). The carrier trail draws only then, and the
   * wall-clock fades (dur.base) scale by it.
   */
  readonly live?: { readonly speed: number };
  /** The play's moment (banner or chips) after the whistle; absent: none drawn. */
  readonly moment?: MomentFrame;
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
/** Kick trails draw in this many alpha steps (one stroke each per side): 0.1 apart. */
export const TRAIL_ALPHA_STEPS = 10;
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

/** field.yardNumber: display 700 26 px times the text scale, never under 24. */
const yardNumberPx = (textScale: number): number => Math.round(Math.max(24, 26 * textScale));

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
  // field.midfield: the home name at the 50, under every line and number (they run over it).
  if (scene.homeName !== undefined && scene.homeName !== "") {
    const text = scene.homeName.toUpperCase();
    const px = fitDisplayPx(g, text, MIDFIELD.capYards * v.s, MIDFIELD.maxWidthYards * v.s, MIDFIELD.spacingEm);
    g.fillStyle = COLOR.midfieldPaint;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.fillText(text, X(v, MID_X), Y(v, 50) + (px * CAP_HEIGHT_EM) / 2);
    setSpacing(g, 0);
  }
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
  const numberPx = yardNumberPx(textScale);
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
  // End zone names, upright, display 700 caps, sized to fill the end zone: a 5-yard cap height or
  // 0.8 of the field's width, whichever is smaller, never under 28 px; centered in the end zone.
  g.fillStyle = COLOR.line;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  for (const [name, cy] of [[scene.topName, 100 + ez / 2], [scene.bottomName, -ez / 2]] as const) {
    if (name === "") continue;
    const text = name.toUpperCase();
    const px = Math.max(ENDZONE.minPx, fitDisplayPx(g, text, ENDZONE.capYards * v.s, ENDZONE.widthShare * W, ENDZONE.spacingEm));
    if (px === ENDZONE.minPx) setDisplay(g, px, ENDZONE.spacingEm);
    g.fillText(text, X(v, MID_X), Y(v, cy) + (px * CAP_HEIGHT_EM) / 2);
  }
  setSpacing(g, 0);
  g.textBaseline = "middle";
  // field.scrimmageLine: solid color.los 3 px over a 5 px outlineDark casing (1 px each side), round caps.
  casedLine(g, v, scene.los, COLOR.los);
  // First-down line: solid signal 3 px over a 5 px outlineDark casing (1 px each side), round caps.
  if (scene.firstDown !== null && scene.firstDown < 100) casedLine(g, v, scene.firstDown, COLOR.signal);
  g.lineCap = "butt";
}

/** A sideline-to-sideline line: a 3 px core over a 5 px color.outlineDark casing, round caps. */
function casedLine(g: CanvasRenderingContext2D, v: View, y: number, core: string): void {
  g.lineCap = "round";
  for (const [style, width] of [[COLOR.outlineDark, 5], [core, 3]] as const) {
    g.strokeStyle = style;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(X(v, 0), Y(v, y));
    g.lineTo(X(v, FIELD_WIDTH_YARDS), Y(v, y));
    g.stroke();
  }
}

/** Barlow Condensed's cap height in em: assumed 0.70 until it is measured at intake (DESIGN.md Still open). */
export const CAP_HEIGHT_EM = 0.7;

/** field.endzone names (DESIGN.md Field): a 5-yard cap height, at most 0.8 of the width, never under 28 px, 0.06em. */
export const ENDZONE = { capYards: 5, widthShare: 0.8, minPx: 28, spacingEm: 0.06 } as const;

/** field.midfield (DESIGN.md Field): a 3-yard cap height, shrunk to fit 30 yards, 0.04em. */
export const MIDFIELD = { capYards: 3, maxWidthYards: 30, spacingEm: 0.04 } as const;

function setSpacing(g: CanvasRenderingContext2D, em: number): void {
  if ("letterSpacing" in g) g.letterSpacing = em === 0 ? "0px" : `${em}em`;
}

function setDisplay(g: CanvasRenderingContext2D, px: number, spacingEm: number): void {
  g.font = `700 ${px}px ${FONT_DISPLAY}`;
  setSpacing(g, spacingEm);
}

/**
 * The display 700 size, px, at which `text` has a cap height of `capPx`, shrunk until it is no
 * wider than `maxW` (letter-spacing included). Leaves g.font and the spacing set to that size.
 */
export function fitDisplayPx(g: CanvasRenderingContext2D, text: string, capPx: number, maxW: number, spacingEm: number): number {
  const ref = 100;
  setDisplay(g, ref, spacingEm);
  let w = g.measureText(text).width;
  // Where the canvas has no letterSpacing, size as if it had: the text then draws a little narrower.
  if (!("letterSpacing" in g)) w += text.length * spacingEm * ref;
  const px = Math.max(1, Math.floor(Math.min(capPx / CAP_HEIGHT_EM, w > 0 ? (ref * maxW) / w : Infinity)));
  setDisplay(g, px, spacingEm);
  return px;
}

/**
 * Path geometry, px (DESIGN.md Marks, Paths, Prime Time): side is told by weight and end cap, never
 * by dashes. Offense routes and blocks: 3 px fill over 5.5 px ring, an arrowhead of two 8 px
 * strokes at 30 degrees or a 10 px tick. Defense: 2 px over 4 px, ending in a 6 px dot with a
 * 1.5 px ring. Preview zone edges: 1.5 px fill over 3 px ring.
 */
export const PATH = {
  offense: { fill: 3, ring: 5.5 },
  defense: { fill: 2, ring: 4 },
  zone: { fill: 1.5, ring: 3 },
  arrowPx: 8,
  arrowRad: Math.PI / 6,
  tickPx: 10,
  dotPx: 6,
  dotRing: 1.5,
} as const;

type Weight = { readonly fill: number; readonly ring: number };

/** Path strokes: the ring color at the ring weight, then the fill at the fill weight, round caps and joins. */
function inked(g: CanvasRenderingContext2D, ink: FieldInk, side: "O" | "X", w: Weight, draw: () => void): void {
  const s = ink[side];
  g.lineCap = "round";
  g.lineJoin = "round";
  if (s.ring !== null) {
    g.strokeStyle = s.ring;
    g.lineWidth = w.ring;
    draw();
  }
  g.strokeStyle = s.fill;
  g.lineWidth = w.fill;
  draw();
}

function polyline(g: CanvasRenderingContext2D, v: View, pts: readonly { x: number; y: number }[]): void {
  g.beginPath();
  pts.forEach((p, i) => (i === 0 ? g.moveTo(X(v, p.x), Y(v, p.y)) : g.lineTo(X(v, p.x), Y(v, p.y))));
  g.stroke();
}

function arrowhead(g: CanvasRenderingContext2D, v: View, a: { x: number; y: number }, b: { x: number; y: number }): void {
  const ang = Math.atan2(Y(v, b.y) - Y(v, a.y), X(v, b.x) - X(v, a.x));
  const len = PATH.arrowPx;
  g.beginPath();
  g.moveTo(X(v, b.x), Y(v, b.y));
  g.lineTo(X(v, b.x) - len * Math.cos(ang - PATH.arrowRad), Y(v, b.y) - len * Math.sin(ang - PATH.arrowRad));
  g.moveTo(X(v, b.x), Y(v, b.y));
  g.lineTo(X(v, b.x) - len * Math.cos(ang + PATH.arrowRad), Y(v, b.y) - len * Math.sin(ang + PATH.arrowRad));
  g.stroke();
}

/** A defense path's end: a filled dot 6 px across in the fill, its 1.5 px ring's outer edge at 3 px. */
function endDot(g: CanvasRenderingContext2D, s: SideInk, cx: number, cy: number): void {
  const rr = PATH.dotPx / 2 - (s.ring === null ? 0 : PATH.dotRing / 2);
  g.fillStyle = s.fill;
  g.beginPath();
  g.arc(cx, cy, rr, 0, Math.PI * 2);
  g.fill();
  if (s.ring !== null) {
    g.strokeStyle = s.ring;
    g.lineWidth = PATH.dotRing;
    g.stroke();
  }
}

/** path.block: a 10 px tick across the end of a lineman's path. */
function blockTick(g: CanvasRenderingContext2D, v: View, a: { x: number; y: number }, b: { x: number; y: number }): void {
  const ang = Math.atan2(Y(v, b.y) - Y(v, a.y), X(v, b.x) - X(v, a.x)) + Math.PI / 2;
  const half = PATH.tickPx / 2;
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

/** field.downTag (DESIGN.md Field): display 700 16 px caps on a 22 px pill, 8 px padding, 4 px above the line, 1 yard in. */
export const DOWN_TAG = { px: 16, extraH: 6, padX: 8, gapPx: 4, insetYards: 1 } as const;

/** Half the cased line's width (5 px): the tag's gap is from the casing's edge. */
const LINE_HALF = 2.5;

/** The down tag's opacity at t: 0 before the set, 1 in the set phase, fading to 0 over `fadeMs` from the snap. */
export function downTagAlpha(tl: Pick<Timeline, "setAt" | "snapAt">, t: number, fadeMs: number): number {
  if (t < tl.setAt) return 0;
  if (t < tl.snapAt) return 1;
  if (fadeMs <= 0) return 0;
  return Math.max(0, 1 - (t - tl.snapAt) / fadeMs);
}

export interface PxBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const hits = (a: PxBox, b: PxBox): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * The down tag's box, canvas px: its bottom 4 px above the line of scrimmage's casing, its left
 * edge 1 yard inside the left sideline; moved right past any yard number it would overlap.
 */
export function downTagBox(v: View, los: number, w: number, h: number, numbers: readonly PxBox[]): PxBox {
  const y1 = Y(v, los) - LINE_HALF - DOWN_TAG.gapPx;
  let x0 = X(v, DOWN_TAG.insetYards);
  for (let k = 0; k <= numbers.length; k++) {
    const box = { x0, y0: y1 - h, x1: x0 + w, y1 };
    const hit = numbers.find((n) => hits(box, n));
    if (hit === undefined) return box;
    x0 = hit.x1 + DOWN_TAG.gapPx;
  }
  return { x0, y0: y1 - h, x1: x0 + w, y1 };
}

/** The yard numbers' boxes as drawField paints them (the same font, centered on their lines). */
function yardNumberBoxes(g: CanvasRenderingContext2D, v: View, textScale: number): PxBox[] {
  const px = yardNumberPx(textScale);
  g.font = `700 ${px}px ${FONT_DISPLAY}`;
  const out: PxBox[] = [];
  for (let y = 10; y <= 90; y += 10) {
    const label = String(y <= 50 ? y : 100 - y);
    const w = g.measureText(label).width;
    for (const nx of [4, FIELD_WIDTH_YARDS - 4]) out.push({ x0: X(v, nx) - w / 2, y0: Y(v, y) - px / 2, x1: X(v, nx) + w / 2, y1: Y(v, y) + px / 2 });
  }
  return out;
}

function drawDownTag(g: CanvasRenderingContext2D, v: View, los: number, text: string, textScale: number, alpha: number): void {
  const numbers = yardNumberBoxes(g, v, textScale);
  const px = Math.round(DOWN_TAG.px * textScale);
  const h = px + DOWN_TAG.extraH;
  const caps = text.toUpperCase();
  g.font = `700 ${px}px ${FONT_DISPLAY}`;
  const w = g.measureText(caps).width + 2 * DOWN_TAG.padX;
  const box = downTagBox(v, los, w, h, numbers);
  g.globalAlpha = alpha;
  taggedText(g, caps, (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, w, h);
  g.globalAlpha = 1;
}

/**
 * fx.carrierTrail (DESIGN.md Marks): the last 0.5 s of travel (timeline ms scale with the speed),
 * at most 8 yards, `markPx * 0.45` wide at the head. Sampled 16 times; the ball counts as stopped
 * under 0.0075 yd per 15 ms step (0.5 yd/s).
 */
export const TRAIL = { windowMs: 500, maxYards: 8, widthMark: 0.45, samples: 16, stepMs: 15, stillYards: 0.0075 } as const;

/**
 * The trail's points, head first, in field yards: the last `windowMs` of the ball's travel (the
 * carrier, or the ball in flight), at most `maxYards` long. `f` (1 to 0) shrinks its length and
 * width over `fadeMs` once the ball stops. Null before the snap, at and after the whistle, and
 * when there is nothing to draw.
 */

export function carrierTrail(tl: Pick<Timeline, "ball" | "snapAt" | "liveEnd">, t: number, windowMs: number, maxYards: number, fadeMs: number): { readonly pts: P[]; readonly f: number } | null {
  if (t <= tl.snapAt || t >= tl.liveEnd || windowMs <= 0) return null;
  // How long the ball has been still (under TRAIL.stillYards a step), up to fadeMs.
  let still = 0;
  while (still < fadeMs) {
    const a = at(tl.ball, t - still - TRAIL.stepMs);
    const b = at(tl.ball, t - still);
    if (Math.hypot(a.x - b.x, a.y - b.y) > TRAIL.stillYards) break;
    still += TRAIL.stepMs;
  }
  const f = fadeMs > 0 ? Math.max(0, 1 - still / fadeMs) : still > 0 ? 0 : 1;
  if (f <= 0) return null;
  const t0 = Math.max(tl.snapAt, t - windowMs);
  const limit = maxYards;
  const pts: P[] = [at(tl.ball, t)];
  let len = 0;
  for (let i = 1; i <= TRAIL.samples && len < limit; i++) {
    const p = at(tl.ball, t - ((t - t0) * i) / TRAIL.samples);
    const q = pts[pts.length - 1] as P;
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < 1e-6) continue;
    if (len + d > limit) {
      const k = (limit - len) / d;
      pts.push({ x: q.x + (p.x - q.x) * k, y: q.y + (p.y - q.y) * k });
      len = limit;
      break;
    }
    pts.push(p);
    len += d;
  }
  // Shrinking after a stop: keep the first f of the streak (its width scales by f when drawn).
  if (f < 1) {
    const keep = len * f;
    const cut: P[] = [pts[0] as P];
    let run = 0;
    for (let i = 1; i < pts.length; i++) {
      const q = pts[i - 1] as P;
      const p = pts[i] as P;
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (run + d >= keep) {
        const k = d === 0 ? 0 : (keep - run) / d;
        cut.push({ x: q.x + (p.x - q.x) * k, y: q.y + (p.y - q.y) * k });
        run = keep;
        break;
      }
      cut.push(p);
      run += d;
    }
    if (run < 0.05) return null;
    return { pts: cut, f };
  }
  if (len < 0.05) return null;
  return { pts, f };
}

/** The trail as a tapered streak: `headPx * f` wide at the carrier to 0 at the tail, filled with gradient.trail. */
function drawTrail(g: CanvasRenderingContext2D, v: View, tr: { readonly pts: readonly P[]; readonly f: number }, headPx: number): void {
  if (typeof g.createLinearGradient !== "function") return;
  const c = tr.pts.map((p) => ({ x: X(v, p.x), y: Y(v, p.y) }));
  const head = c[0];
  const tail = c[c.length - 1];
  if (head === undefined || tail === undefined || c.length < 2) return;
  const arc = [0];
  for (let i = 1; i < c.length; i++) arc.push((arc[i - 1] as number) + Math.hypot((c[i] as P).x - (c[i - 1] as P).x, (c[i] as P).y - (c[i - 1] as P).y));
  const total = arc[arc.length - 1] as number;
  if (total <= 0) return;
  const left: P[] = [];
  const right: P[] = [];
  for (let i = 0; i < c.length; i++) {
    const a = c[Math.max(0, i - 1)] as P;
    const b = c[Math.min(c.length - 1, i + 1)] as P;
    const dl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / dl;
    const ny = (b.x - a.x) / dl;
    const half = (headPx * tr.f * (1 - (arc[i] as number) / total)) / 2;
    const p = c[i] as P;
    left.push({ x: p.x + nx * half, y: p.y + ny * half });
    right.push({ x: p.x - nx * half, y: p.y - ny * half });
  }
  const grad = g.createLinearGradient(head.x, head.y, tail.x, tail.y);
  if (grad === undefined || grad === null || typeof grad.addColorStop !== "function") return;
  grad.addColorStop(0, GRADIENT.trail.head);
  grad.addColorStop(1, GRADIENT.trail.tail);
  g.fillStyle = grad;
  g.beginPath();
  [...left, ...right.reverse()].forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
  g.closePath();
  g.fill();
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


/** One frame of the timeline at time t (ms at 1x). */
export function drawFrame(g: CanvasRenderingContext2D, v: View, tl: Timeline, t: number, o: FrameOpts): void {
  const ink = o.ink ?? NEUTRAL_INK;
  const whistle = t >= tl.liveEnd;
  const r = v.markPx / 2;
  // Wall-clock fades (dur.base) in timeline ms at the current speed.
  const fadeMs = DUR.base * (o.live?.speed ?? 1);
  // The preview art's zones and depth bands sit under everything else, faint; after the snap the
  // whole preview fades out over dur.base while the drawn paths take over.
  const fade = tl.preview === null ? 0 : previewFade(tl, t, fadeMs);
  if (fade > 0 && tl.preview !== null) {
    // Bands and zones: color.line at 10%, at the faint route opacity.
    g.globalAlpha = o.routeAlpha * 0.1 * fade;
    g.fillStyle = COLOR.line;
    for (const b of tl.preview.bands) g.fillRect(X(v, 0), Y(v, b.y1), FIELD_WIDTH_YARDS * v.s, (b.y1 - b.y0) * v.s);
    for (const z of tl.preview.zones) g.fillRect(X(v, Math.min(z.x0, z.x1)), Y(v, Math.max(z.y0, z.y1)), Math.abs(z.x1 - z.x0) * v.s, Math.abs(z.y1 - z.y0) * v.s);
    // Zone edges solid (1.5 px fill over 3 px ring), tethers at the defense weight and the generic
    // offense circle at the offense weight, each over its ring.
    g.globalAlpha = o.routeAlpha * fade;
    for (const z of tl.preview.zones) {
      inked(g, ink, "X", PATH.zone, () => g.strokeRect(X(v, Math.min(z.x0, z.x1)), Y(v, Math.max(z.y0, z.y1)), Math.abs(z.x1 - z.x0) * v.s, Math.abs(z.y1 - z.y0) * v.s));
    }
    for (const tt of tl.preview.tethers) {
      inked(g, ink, "X", PATH.defense, () => polyline(g, v, [tt.from, tt.to]));
      inked(g, ink, "O", PATH.offense, () => {
        g.beginPath();
        g.arc(X(v, tt.to.x), Y(v, tt.to.y), 4, 0, Math.PI * 2);
        g.stroke();
      });
    }
    g.globalAlpha = 1;
  }
  // field.downTag: on the line of scrimmage in the set phase, fading out over dur.base at the snap.
  const tagAlpha = downTagAlpha(tl, t, fadeMs);
  if (o.downTag !== undefined && o.downTag !== "" && tagAlpha > 0) drawDownTag(g, v, tl.los, o.downTag, o.textScale, tagAlpha);
  // Paths (pure: marks.pathPrimitives), each drawn on behind its mark and stopping at its edge.
  const prims = pathPrimitives(tl, t, (r + 1) / v.s, fadeMs);
  // Kick trails (Q4): a kickoff can have about 2,000 pieces in a frame, so they are stroked as one
  // path per side and alpha step (the alpha rounded to TRAIL_ALPHA_STEPS), under every other path.
  const buckets = new Map<string, { side: "O" | "X"; alpha: number; pieces: (typeof prims)[number][] }>();
  for (const p of prims) {
    if (p.trail !== true) continue;
    const alpha = Math.round(p.fade * TRAIL_ALPHA_STEPS) / TRAIL_ALPHA_STEPS;
    if (alpha <= 0) continue;
    const k = `${p.side}${alpha}`;
    const b = buckets.get(k) ?? { side: p.side, alpha, pieces: [] };
    b.pieces.push(p);
    buckets.set(k, b);
  }
  // Faintest first, O before X at one alpha: a deterministic draw order (review N-a).
  for (const b of [...buckets.values()].sort((p, q) => p.alpha - q.alpha || (p.side < q.side ? -1 : p.side > q.side ? 1 : 0))) {
    g.globalAlpha = b.alpha;
    inked(g, ink, b.side, b.side === "O" ? PATH.offense : PATH.defense, () => {
      g.beginPath();
      for (const p of b.pieces) p.points.forEach((q, i) => (i === 0 ? g.moveTo(X(v, q.x), Y(v, q.y)) : g.lineTo(X(v, q.x), Y(v, q.y))));
      g.stroke();
    });
    g.globalAlpha = 1;
  }
  for (const p of prims) {
    if (p.trail === true) continue;
    g.globalAlpha = p.faint ? o.routeAlpha * p.fade : 1;
    const a = p.points[p.points.length - 2];
    const b = p.points[p.points.length - 1];
    inked(g, ink, p.side, p.side === "O" ? PATH.offense : PATH.defense, () => {
      polyline(g, v, p.points);
      if (a !== undefined && b !== undefined) {
        if (p.end === "block") blockTick(g, v, a, b);
        else if (p.end === "arrow") arrowhead(g, v, a, b);
      }
    });
    if (p.end === "dot" && b !== undefined) endDot(g, ink[p.side], X(v, b.x), Y(v, b.y));
    g.globalAlpha = 1;
  }
  // The ball's flight, dotted white, round caps: the only dotted line on the field.
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
  // fx.carrierTrail: above the paths, under every mark, label and the ball; live play only.
  if (o.live !== undefined) {
    const tr = carrierTrail(tl, t, TRAIL.windowMs * o.live.speed, TRAIL.maxYards, fadeMs);
    if (tr !== null) drawTrail(g, v, tr, v.markPx * TRAIL.widthMark);
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
  // The play's labels ("No good", "Fumble", "Touchback"): on-field tags above their spot. The
  // Broadcast toast is retired; the score words a moment banner says are drawn there instead.
  const banner = o.moment?.moment.banner ?? null;
  g.font = `600 ${wordPx}px ${FONT_UI}`;
  for (const l of tl.labels) {
    if (t < l.t || (banner !== null && bannerCovers(l.source, l.text))) continue;
    const w = g.measureText(l.text).width + 2 * TAG.wordPadX;
    const lx = Math.min(Math.max(X(v, l.at.x), X(v, -1) + w / 2 + 4), X(v, FIELD_WIDTH_YARDS + 1) - w / 2 - 4);
    taggedText(g, l.text, lx, Y(v, l.at.y) - r - 10 - wordH / 2, w, wordH);
  }
  // fx.firstDown and fx.bigPlay: chips beside the ball's final spot, from the whistle (never with a banner).
  if (o.moment !== undefined && banner === null && t >= tl.liveEnd && o.moment.bt >= 0) drawChips(g, v, tl, o.moment, o.textScale);
  // The ball, always on top; its size shows its height in flight.
  const b = at(tl.ball, t);
  drawBall(g, v, b.x, b.y, scaleAt(tl.ballScale, t));
  // fx.score and fx.turnover: the moment banner, after the whistle, on the half away from the ball.
  if (o.moment !== undefined && banner !== null && t >= tl.liveEnd && o.moment.bt >= 0) drawBanner(g, v, tl, o.moment, banner);
}

/**
 * A moment for the frame (DESIGN.md Moments): what the committed play fired, the team colors of
 * its banner, its wall-clock time and hold, and whether to show the end state at once (reduced
 * motion, Skip, a redraw after the play).
 */
export interface MomentFrame {
  readonly moment: Moment;
  readonly ink: SideInk | null;
  /**
   * Wall-clock ms since the moment began (the whistle, or the committed result when the play was
   * already shown): the banner and chips move on Motion (UI) durations, which never scale with speed.
   */
  readonly bt: number;
  /** Wall-clock ms the moment holds in all (the hold halves at 2x; the motion inside it does not). */
  readonly holdMs: number;
  readonly still: boolean;
}

/** type.chip: display 700 24 px; the chip pill is the text plus 12 px tall, 12 px padding each side. */
export const CHIP = { px: 24, extraH: 12, padX: 12, gapPx: 8, stackPx: 4, accentW: 3, outline: 1.5, popFrom: 0.92 } as const;

function drawChips(g: CanvasRenderingContext2D, v: View, tl: Timeline, mf: MomentFrame, textScale: number): void {
  const m = mf.moment;
  if (!m.firstDown && m.bigPlay === null) return;
  const bt = mf.still ? Infinity : mf.bt;
  const ball = at(tl.ball, tl.liveEnd);
  const bx = X(v, ball.x);
  const by = Y(v, ball.y);
  const px = Math.round(CHIP.px * textScale);
  const h = px + CHIP.extraH;
  g.font = `700 ${px}px ${FONT_DISPLAY}`;
  g.textBaseline = "middle";
  g.textAlign = "center";
  const items: { text: string; kind: "big" | "first" }[] = [];
  if (m.bigPlay !== null) items.push({ text: `+${bigPlayCount(m.bigPlay, bt)}`, kind: "big" });
  if (m.firstDown) items.push({ text: "FIRST DOWN", kind: "first" });
  const right = X(v, FIELD_WIDTH_YARDS + 1);
  let y = by - ((items.length - 1) * (h + CHIP.stackPx)) / 2;
  for (const it of items) {
    // Width from the final text, so the count never shifts the chip.
    const final = it.kind === "big" ? `+${m.bigPlay ?? 0}` : it.text;
    const w = g.measureText(final).width + 2 * CHIP.padX + (it.kind === "big" ? CHIP.accentW : 0);
    const gap = v.markPx / 2 + CHIP.gapPx;
    const x0 = bx + gap + w > right ? bx - gap - w : bx + gap;
    const pop = it.kind === "first" ? ease(EASE.out, bt / DUR.base) : 1;
    const scale = CHIP.popFrom + (1 - CHIP.popFrom) * pop;
    g.save();
    g.globalAlpha = pop;
    g.translate(x0 + w / 2, y);
    g.scale(scale, scale);
    shadow(g, SHADOW.toast);
    g.fillStyle = it.kind === "first" ? COLOR.signal : COLOR.tag;
    roundedPath(g, -w / 2, -h / 2, w, h, RADIUS.pill);
    g.fill();
    shadow(g, NO_SHADOW);
    if (it.kind === "first") {
      g.strokeStyle = COLOR.outlineDark;
      g.lineWidth = CHIP.outline;
      g.stroke();
      g.fillStyle = COLOR.ink;
    } else {
      g.fillStyle = COLOR.signal;
      roundedPath(g, -w / 2 + h / 4, -h / 2 + 6, CHIP.accentW, h - 12, CHIP.accentW / 2);
      g.fill();
      g.fillStyle = COLOR.chalk;
    }
    g.fillText(it.text, it.kind === "big" ? CHIP.accentW : 0, 0);
    g.restore();
    y += h + CHIP.stackPx;
  }
}

function drawBanner(g: CanvasRenderingContext2D, v: View, tl: Timeline, mf: MomentFrame, banner: Banner): void {
  const pose = mf.still ? BANNER_STILL : bannerPose(mf.bt, mf.holdMs);
  if (pose.right <= pose.left) return;
  // Never over the ball, the carrier or the tackler: their final spots, from the timeline.
  const people = tl.marks.filter((mk) => mk.playerId === tl.holder || mk.playerId === tl.tackler).map((mk) => Y(v, at(mk.keys, tl.total).y));
  const box = bannerBox({ left: v.ox, width: v.columnWidth }, v.height, Y(v, at(tl.ball, tl.total).y), people, v.markPx / 2 + RING_GAP + 2);
  const fill = mf.ink?.fill ?? COLOR.surfaceSolid;
  const text = mf.ink?.ring ?? COLOR.chalk;
  const dark = darkTier(fill);
  const { x, y, w, blockH, stripH } = box;
  g.save();
  // The wipe: a clip from `left` to `right` across the banner (clip-path inset in DESIGN's CSS terms).
  g.beginPath();
  g.rect(x + w * pose.left, y - BANNER_T.subRisePx - 24, w * (pose.right - pose.left), blockH + stripH + BANNER_T.subRisePx + 48);
  g.clip();
  // Team block: gradient.teamBlock (the sheen over the solid fill), radius.md top corners, shadow.toast.
  shadow(g, SHADOW.toast);
  g.fillStyle = fill;
  topRounded(g, x, y, w, blockH, RADIUS.md);
  g.fill();
  shadow(g, NO_SHADOW);
  if (typeof g.createLinearGradient === "function") {
    const sheen = g.createLinearGradient(x, y, x, y + blockH);
    if (sheen !== undefined && sheen !== null && typeof sheen.addColorStop === "function") {
      sheen.addColorStop(0, "rgba(255, 255, 255, 0.05)");
      sheen.addColorStop(0.4, "rgba(255, 255, 255, 0)");
      g.fillStyle = sheen;
      topRounded(g, x, y, w, blockH, RADIUS.md);
      g.fill();
    }
  }
  // The tier's inset ring, then the 1 px hairlineStrong edge.
  g.lineWidth = 1;
  g.strokeStyle = dark ? CHIP_RING.dark : CHIP_RING.light;
  topRounded(g, x + 1.5, y + 1.5, w - 3, blockH - 1.5, RADIUS.md - 1);
  g.stroke();
  g.strokeStyle = COLOR.hairlineStrong;
  topRounded(g, x + 0.5, y + 0.5, w - 1, blockH - 0.5, RADIUS.md);
  g.stroke();
  // The word: type.momentWord in the slot's outline color, slamming in.
  const wordPx = v.columnWidth < BANNER.narrowBelow ? BANNER.wordPxNarrow : BANNER.wordPx;
  g.globalAlpha = pose.wordAlpha;
  g.fillStyle = text;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `700 ${wordPx}px ${FONT_DISPLAY}`;
  if ("letterSpacing" in g) g.letterSpacing = "0.02em";
  g.translate(x + w / 2, y + blockH / 2);
  g.scale(pose.wordScale, pose.wordScale);
  // Long words ("TURNOVER ON DOWNS") shrink to fit the block, never under 48 px.
  const fit = Math.min(1, (w - 32) / Math.max(1, g.measureText(banner.word).width));
  if (fit < 1) g.font = `700 ${Math.max(48, Math.floor(wordPx * fit))}px ${FONT_DISPLAY}`;
  g.fillText(banner.word, 0, 0);
  if ("letterSpacing" in g) g.letterSpacing = "0px";
  g.restore();
  // The sub strip: color.bannerStrip, radius.md bottom corners, type.momentSub chalk, dropping in.
  if (pose.subAlpha <= 0) return;
  g.save();
  g.beginPath();
  g.rect(x + w * pose.left, y + blockH, w * (pose.right - pose.left), stripH);
  g.clip();
  g.globalAlpha = pose.subAlpha;
  const sy = y + blockH - pose.subLift;
  g.fillStyle = COLOR.bannerStrip;
  bottomRounded(g, x, sy, w, stripH, RADIUS.md);
  g.fill();
  g.fillStyle = COLOR.chalk;
  g.font = `600 ${BANNER.subPx}px ${FONT_UI}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(banner.sub, x + w / 2, sy + stripH / 2);
  g.restore();
}

function topRounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  if (typeof g.roundRect === "function") g.roundRect(x, y, w, h, [r, r, 0, 0]);
  else g.rect(x, y, w, h);
}

function bottomRounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  if (typeof g.roundRect === "function") g.roundRect(x, y, w, h, [0, 0, r, r]);
  else g.rect(x, y, w, h);
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
