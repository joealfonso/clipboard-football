// Layout math. Pure: window size in, pixel boxes out.
//
// Joseph's amendment (docs/specs/m2-play-calling-and-motion.md, "Amended (Joseph, 2026-11-14):
// full-screen field, menus over it"): the field takes the whole window under the top bar, and the
// menus are overlays over it (ui/overlay.ts places them). The field stays portrait (DESIGN.md
// decision 3). The scale is the largest that still shows the full width (sideline to sideline plus
// a yard of margin each side) and at least VISIBLE_YARDS of field length; the column is centered.

/**
 * The smallest window the field still fits in: at 800x520 the scale is 9.44 px per yard, so marks
 * stay 14 px with a gap on the line (layout.test, art.test), and an overlay still has room.
 */
export const MIN_WIDTH = 800;
export const MIN_HEIGHT = 520;
export const TOP_BAR = 48;
export const FIELD_WIDTH_YARDS = 53.3;
export const COLUMN_YARDS = FIELD_WIDTH_YARDS + 2;
/** Field length the canvas always shows, so there is room above or below the line for an overlay. */
export const VISIBLE_YARDS = 50;

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Layout {
  readonly tooSmall: boolean;
  /** The canvas: the whole window under the top bar, in window px. */
  readonly field: Box;
  /** The field column (sideline to sideline plus a yard each side), centered, in canvas px. */
  readonly column: Box;
  /** Pixels per yard. */
  readonly s: number;
  /** Yards of field length the canvas shows. */
  readonly visibleYards: number;
  /** Mark diameter in px: 1.4 yards, never under 14 px. */
  readonly markPx: number;
}

export interface FieldStyle {
  readonly markYards: number;
  readonly markMinPx: number;
}

export function layoutFor(width: number, height: number, style: FieldStyle = { markYards: 1.4, markMinPx: 14 }): Layout {
  const tooSmall = width < MIN_WIDTH || height < MIN_HEIGHT;
  const fieldHeight = Math.max(0, height - TOP_BAR);
  const s = Math.max(0, Math.min(width / COLUMN_YARDS, fieldHeight / VISIBLE_YARDS));
  const columnWidth = Math.floor(COLUMN_YARDS * s);
  return {
    tooSmall,
    field: { left: 0, top: TOP_BAR, width, height: fieldHeight },
    column: { left: Math.floor((width - columnWidth) / 2), top: 0, width: columnWidth, height: fieldHeight },
    s,
    visibleYards: s > 0 ? fieldHeight / s : 0,
    markPx: Math.max(style.markMinPx, style.markYards * s),
  };
}

/** Canvas x of a field x (yards from the offense's left sideline). */
export function screenX(l: Layout, x: number): number {
  return l.column.left + (1 + x) * l.s;
}

/** Canvas y of a field y (yards from the offense's goal line; grows up the screen). */
export function screenY(l: Layout, cameraY: number, y: number): number {
  return (cameraY - y) * l.s;
}

/** The camera (field y at the canvas's top edge) that puts the line of scrimmage 70% down. */
export function cameraAt(los: number, visibleYards: number, fromTop = 0.7): number {
  return los + fromTop * visibleYards;
}

/** Pans only when the ball comes within `edge` yards of the top or bottom (design "Camera"). */
export function panCamera(cameraY: number, ballY: number, visibleYards: number, edge = 5): number {
  if (ballY > cameraY - edge) return ballY + edge;
  if (ballY < cameraY - visibleYards + edge) return ballY - edge + visibleYards;
  return cameraY;
}
