// Layout math from docs/specs/m2-playable-game-design.md ("Layout"). Pure: window size in, pixel
// boxes out. The field column is the smaller of half the width and 0.95 x its height; the scale is
// the column width over 55.3 yards (53.3 sideline to sideline plus a yard of margin each side).

export const MIN_WIDTH = 1024;
export const MIN_HEIGHT = 600;
export const TOP_BAR = 48;
export const FIELD_WIDTH_YARDS = 53.3;
export const COLUMN_YARDS = FIELD_WIDTH_YARDS + 2;
export const PANEL_MAX = 560;

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Layout {
  readonly tooSmall: boolean;
  readonly field: Box;
  readonly panel: Box;
  /** Pixels per yard. */
  readonly s: number;
  /** Yards of field length the column shows. */
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
  const columnHeight = Math.max(0, height - TOP_BAR);
  const fieldWidth = Math.floor(Math.min(width * 0.5, 0.95 * columnHeight));
  const s = fieldWidth / COLUMN_YARDS;
  const panelLeft = fieldWidth;
  const panelWidth = Math.max(0, width - fieldWidth);
  return {
    tooSmall,
    field: { left: 0, top: TOP_BAR, width: fieldWidth, height: columnHeight },
    panel: { left: panelLeft, top: TOP_BAR, width: panelWidth, height: columnHeight },
    s,
    visibleYards: s > 0 ? columnHeight / s : 0,
    markPx: Math.max(style.markMinPx, style.markYards * s),
  };
}

/** Screen x of a field x (yards from the offense's left sideline). */
export function screenX(l: Layout, x: number): number {
  return l.field.left + (1 + x) * l.s;
}

/** Screen y of a field y (yards from the offense's goal line; grows up the screen). */
export function screenY(l: Layout, cameraY: number, y: number): number {
  return l.field.top + (cameraY - y) * l.s;
}

/** The camera (field y at the column's top edge) that puts the line of scrimmage 70% down. */
export function cameraAt(los: number, visibleYards: number, fromTop = 0.7): number {
  return los + fromTop * visibleYards;
}

/** Pans only when the ball comes within `edge` yards of the top or bottom (design "Camera"). */
export function panCamera(cameraY: number, ballY: number, visibleYards: number, edge = 5): number {
  if (ballY > cameraY - edge) return ballY + edge;
  if (ballY < cameraY - visibleYards + edge) return ballY - edge + visibleYards;
  return cameraY;
}
