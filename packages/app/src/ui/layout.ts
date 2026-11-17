// Layout math. Pure: window size in, pixel boxes out.
//
// Joseph's amendment (docs/specs/m2-play-calling-and-motion.md, "Amended (Joseph, 2026-11-14):
// full-screen field, menus over it"): the field takes the whole window under the top bar, and the
// menus are overlays over it (ui/overlay.ts places them). The field stays portrait (DESIGN.md
// decision 3). The scale is the largest that still shows the full width (sideline to sideline plus
// a yard of margin each side) and at least VISIBLE_YARDS of field length. With a wide enough margin
// the column sits flush left and overlays go in the margin (SIDE_MARGIN_MIN); otherwise it is centered.

/**
 * The smallest window the field still fits in: at 800x536 the scale is 9.44 px per yard, so marks
 * stay 14 px with a gap on the line (layout.test, art.test), and an overlay still has room.
 * DESIGN.md Prime Time (2026-11-15) raised it from 528 with the 64 px top bar, keeping that scale.
 */
export const MIN_WIDTH = 800;
export const MIN_HEIGHT = 536;
export const TOP_BAR = 64;
export const FIELD_WIDTH_YARDS = 53.3;
export const COLUMN_YARDS = FIELD_WIDTH_YARDS + 2;
/** Field length the canvas always shows, so there is room above or below the line for an overlay. */
export const VISIBLE_YARDS = 50;
/**
 * Spare width beside the field at which overlays go in a side margin and cover nothing: the column
 * moves flush left and the spare width is one margin on the right (field left, menus right, as in
 * the design's decision 5). Narrower than this, the column is centered and overlays sit over it.
 */
export const SIDE_MARGIN_MIN = 300;

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
  /** The field column (sideline to sideline plus a yard each side), in canvas px: flush left with a side margin, else centered. */
  readonly column: Box;
  /** The margin right of the column, in window px, when it is at least SIDE_MARGIN_MIN wide; else null. */
  readonly side: Box | null;
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
  const spare = width - columnWidth;
  const sided = spare >= SIDE_MARGIN_MIN;
  return {
    tooSmall,
    field: { left: 0, top: TOP_BAR, width, height: fieldHeight },
    column: { left: sided ? 0 : Math.floor(spare / 2), top: 0, width: columnWidth, height: fieldHeight },
    side: sided ? { left: columnWidth, top: TOP_BAR, width: spare, height: fieldHeight } : null,
    s,
    visibleYards: s > 0 ? fieldHeight / s : 0,
    markPx: Math.max(style.markMinPx, style.markYards * s),
  };
}

/** The play rail (DESIGN.md Play screen): width clamp(300, 340 * text scale, 420), gap and stage padding. */
export const RAIL = { min: 300, base: 340, max: 420, gap: 24, pad: 24, inset: 16 } as const;

export interface PlayStage {
  /** The field column, in canvas px (the canvas covers the window under the top bar). */
  readonly column: Box;
  /** The read-only play rail, in window px; null when the column and rail don't fit side by side. */
  readonly rail: Box | null;
}

/**
 * The play screen (DESIGN.md Layout, Play screen): the field column and the rail centered together
 * on the stage when `column + gap + rail` fits inside the window less the stage padding; otherwise
 * the column centered alone and no rail. The rail runs the field's height less 16 px top and bottom.
 */
export function playStage(l: Layout, textScale: number): PlayStage {
  const w = l.field.width;
  const cw = l.column.width;
  const railW = Math.min(RAIL.max, Math.max(RAIL.min, Math.round(RAIL.base * textScale)));
  const group = cw + RAIL.gap + railW;
  if (group <= w - 2 * RAIL.pad) {
    const left = Math.floor((w - group) / 2);
    return {
      column: { ...l.column, left },
      rail: { left: left + cw + RAIL.gap, top: l.field.top + RAIL.inset, width: railW, height: Math.max(0, l.field.height - 2 * RAIL.inset) },
    };
  }
  return { column: { ...l.column, left: Math.floor((w - cw) / 2) }, rail: null };
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

// ---------------------------------------------------------------- the calling screen's board (U1)

/**
 * The calling screen's board (docs/specs/m2-calling-screen-pass.md, U1): 56 yards across (53.3 plus
 * 1.35 yards each side), never under 529 px (9.44 px per yard, the floor the art tests prove).
 */
export const BOARD = { maxW: 560, minW: 529, yards: 56, gap: 24, minCallW: 400, minH: 180, maxTextScale: 1.25, rowGap: 16, twoColumnMin: 760, contentMax: 1160, padX: 24 } as const;

/**
 * Estimates of the calling screen's fixed blocks at 100% text (styles.css: the 24 px panel top
 * padding, the 96 px situation plate, about 75 px of legend). The app measures the real ones;
 * these stand in where there is no DOM (tests). Measured figures: docs/PERF.md.
 */
export const CALLING_ESTIMATE = { panelTop: 24, plate: 96, legend: 75 } as const;

/** The calling screen's content width: the window less 24 px each side, at most 1160 px. */
export function callingContent(windowWidth: number): number {
  return Math.min(BOARD.contentMax, windowWidth - 2 * BOARD.padX);
}

export interface CardsRow {
  /** Window y of the cards row's top (16 px under the situation plate). */
  readonly top: number;
  /** Window y of the legend's top; the cards row ends 16 px above it. */
  readonly legendTop: number;
}

/** The cards row from the estimates (no DOM): under the top bar, the panel padding, the plate and a 16 px gap; above the legend. */
export function estimatedCardsRow(windowHeight: number, textScale = 1): CardsRow {
  const top = TOP_BAR + CALLING_ESTIMATE.panelTop + Math.round(CALLING_ESTIMATE.plate * Math.max(1, textScale)) + BOARD.rowGap;
  return { top, legendTop: windowHeight - Math.round(CALLING_ESTIMATE.legend * textScale) };
}

export interface BoardLayout {
  /** Board column width (px), its scale (px per yard) and height (px). */
  readonly boardW: number;
  readonly sB: number;
  readonly boardH: number;
  /** The call column's width: content - 24 - boardW. */
  readonly callW: number;
  readonly content: number;
  /** Window y of the board's top: under the Last play card and a 16 px gap. */
  readonly top: number;
}

/**
 * Where the board goes, or null when it doesn't show (U1 "When it shows"): the two-column layout,
 * text at 125% or less, a call column of at least 400 px and a board at least 180 px tall. The
 * height is what the cards row leaves under the Last play card, so the board never adds height.
 */
export function boardLayout(window: { readonly width: number; readonly height: number }, textScale: number, lastPlayHeight: number, row: CardsRow = estimatedCardsRow(window.height, textScale)): BoardLayout | null {
  const content = callingContent(window.width);
  if (content < BOARD.twoColumnMin || textScale > BOARD.maxTextScale) return null;
  const boardW = Math.max(BOARD.minW, Math.min(BOARD.maxW, Math.floor((content - BOARD.gap) / 2)));
  const callW = content - BOARD.gap - boardW;
  if (callW < BOARD.minCallW) return null;
  const top = row.top + lastPlayHeight + BOARD.rowGap;
  const boardH = Math.floor(row.legendTop - BOARD.rowGap - top);
  if (boardH < BOARD.minH) return null;
  return { boardW, sB: boardW / BOARD.yards, boardH, callW, content, top };
}

/**
 * The board's camera (field y at its top edge): the line of scrimmage 70% of the way down, moved
 * only as far as needed to keep your deepest lined-up mark plus 1 yard in view. `ownYs`: your
 * lined-up marks' field y; `own` says which way your unit is deep: "O" below the line (offense,
 * kicking team), "X" above it (defense, return unit).
 */
export function boardCamera(los: number, visibleYards: number, ownYs: readonly number[], own: "O" | "X", fromTop = 0.7): number {
  const base = cameraAt(los, visibleYards, fromTop);
  if (ownYs.length === 0) return base;
  if (own === "O") return Math.min(base, Math.min(...ownYs) - 1 + visibleYards);
  return Math.max(base, Math.max(...ownYs) + 1);
}

/**
 * Q3: the player card on the calling screen opens over the call column, top aligned with the cards
 * row, min(360, call column) wide, down to the legend's top; it never covers the plate, the Last
 * play card or the board.
 */
export function callingCardBox(callColumn: { readonly left: number; readonly top: number; readonly width: number }, legendTop: number, windowBottom = Number.POSITIVE_INFINITY): { readonly left: number; readonly top: number; readonly width: number; readonly maxHeight: number } {
  // A usable minimum (code review S4): in one column at large text the call card can start near the
  // legend; the card then runs over the legend, never off the window, and scrolls inside its box.
  // When the call card starts below the window (the screen scrolled, code review N1), the card's top
  // comes up so that minimum fits, never above the top bar.
  const room = Math.max(0, windowBottom - TOP_BAR - 16);
  const min = Math.min(CARD_MIN_HEIGHT, room);
  // Pulled up into the window, the card can cover the Last play card or the plate (review N-b): kept
  // on purpose, since a usable card beats one off-screen, and the covered rows are inert while it is open.
  const top = Number.isFinite(windowBottom) ? Math.max(TOP_BAR + 8, Math.min(callColumn.top, windowBottom - 8 - min)) : callColumn.top;
  return { left: callColumn.left, top, width: Math.min(360, callColumn.width), maxHeight: Math.max(min, legendTop - top) };
}

/** The smallest card art the call card shrinks to before it falls back to text rows, px (designed). */
export const CARD_ART_MIN = 56;

/**
 * The call card must end above the legend (calling spec K5: no call screen scrolls). Given how far
 * it runs past (`over`, px), how many rows of cards it has and how tall their art is now, the art
 * height that makes it fit, or "rows" when even CARD_ART_MIN doesn't (the screen then uses the text
 * rows with personnel notes, the existing compact fallback), or null when it already fits.
 */
export function callCardFit(over: number, cardRows: number, artHeight: number): number | "rows" | null {
  if (over <= 0.5) return null;
  if (cardRows <= 0) return "rows";
  const target = Math.floor(artHeight - over / cardRows);
  return target >= CARD_ART_MIN ? target : "rows";
}

/** The calling screen player card's smallest height, px (S4): the header band and a few rating rows. */
export const CARD_MIN_HEIGHT = 240;
