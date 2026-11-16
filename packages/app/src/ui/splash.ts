// The main menu's play diagram (docs/specs/m2-main-menu.md, "Splash composition"): a designed
// illustration from the play-card templates, never model output. Shotgun play action against
// nickel Cover 3, generic slots, no labels, no ball path, no zones, no first-down line. Static:
// drawn once when shown, again on a resize or a text-size change; no animation loop.
//
// splashFrame and artShown are pure; drawSplash paints with the field's own drawing code.

import { defenseArt, offenseArt, slotsFromCounts, type Art } from "./art";
import { drawField, drawFrame, type FieldScene, type FrameOpts, type View } from "./field";
import { COLUMN_YARDS } from "./layout";
import { MID_X, type Key } from "./motion";
import type { Templates } from "./templates";
import type { Timeline, TLMark } from "./timeline";
import { SPLASH_INK } from "./tokens";

/** What the diagram shows and where (designed; art-director reviews, spec Open 3). */
export const SPLASH = {
  formation: "shotgun",
  play: "playAction",
  pkg: "nickel",
  preset: "nickelCover3",
  /** Ball at OWN 35, the line of scrimmage 62% down the box. */
  los: 35,
  losFromTop: 0.62,
  /** Canvas height over width (fixed ratio, about 38 yards of field at full width). */
  ratio: 0.68,
  /** Layout (CSS px at 100% text): the frame, its padding, the left column and the gap. */
  frameMax: 1040,
  frameMargin: 64,
  framePadding: 32,
  leftColumn: 440,
  gap: 48,
  /** The art hides when its column is narrower than this, or text is 150% or more (art-director, 2026-11-15). */
  minArtWidth: 360,
  maxTextSize: 150,
} as const;

/** Personnel counts for the two units (personnel.json, via the worker's UiData). */
export interface SplashPersonnel {
  readonly offense: Readonly<Partial<Record<string, number>>>;
  readonly defense: Readonly<Partial<Record<string, number>>>;
}

/** The art column's width in CSS px for a window width and text scale (0 or less: no room). */
export function artColumnWidth(windowWidth: number, textScale: number): number {
  const frame = Math.min(SPLASH.frameMax, windowWidth - SPLASH.frameMargin);
  return frame - 2 * SPLASH.framePadding - SPLASH.leftColumn * textScale - SPLASH.gap;
}

/** Whether the diagram shows: text under 150%, the art column at least 360 px, Canvas 2D present. */
export function artShown(o: { readonly textSize: number; readonly windowWidth: number; readonly canvas2d: boolean }): boolean {
  return o.canvas2d && o.textSize < SPLASH.maxTextSize && artColumnWidth(o.windowWidth, o.textSize / 100) >= SPLASH.minArtWidth;
}

/** The canvas view for a box `width` px wide: sideline to sideline plus a yard each side. */
export function splashView(width: number, markPx: (s: number) => number): View {
  const s = width / COLUMN_YARDS;
  const height = Math.round(width * SPLASH.ratio);
  return { s, ox: 0, width, columnWidth: width, height, cameraY: SPLASH.los + SPLASH.losFromTop * (height / s), markPx: markPx(s) };
}

/** The field under the diagram: no first-down line, no end zone names (none is in view). */
export function splashScene(): FieldScene {
  return { los: SPLASH.los, firstDown: null, bottomName: "", topName: "", endZoneYards: 10 };
}

/**
 * The diagram as a still timeline: 11 O's and 11 X's on generic slots (`splash:` ids, so no mark
 * has a number), and the two calls' paths as its preview art, with no zones, bands or tethers.
 */
export function splashFrame(templates: Templates, personnel: SplashPersonnel, pxPerYard: number): Timeline {
  const los = SPLASH.los;
  const off = offenseArt(SPLASH.formation, SPLASH.play, slotsFromCounts(personnel.offense), templates, los, pxPerYard);
  const def = defenseArt(SPLASH.pkg, SPLASH.preset, slotsFromCounts(personnel.defense), templates, los, pxPerYard);
  const mark = (m: Art["marks"][number]): TLMark => ({ slot: m.slot, side: m.side, position: m.position, playerId: `splash:${m.side}:${m.slot}`, keys: [{ t: 0, x: m.x, y: m.y }], roles: [], fact: false, pathEnd: 0, pathStyle: "none", huddle: false });
  const art: Art = { marks: [...off.marks, ...def.marks], paths: [...off.paths, ...def.paths], bands: [], zones: [], tethers: [] };
  const ball: Key[] = [{ t: 0, x: MID_X, y: los }];
  return {
    los,
    firstDown: null,
    lineUpMs: 0,
    runoffMs: 0,
    runoff: null,
    setAt: Infinity,
    snapAt: Infinity,
    liveEnd: Infinity,
    settleMs: 0,
    holdMs: 0,
    total: 0,
    marks: art.marks.map(mark),
    ball,
    ballScale: [{ t: 0, s: 1 }],
    paths: [],
    labels: [],
    flags: [],
    holder: null,
    tackler: null,
    involved: [],
    rings: [],
    snapWindowEnd: 0,
    read: 0,
    preview: art,
  };
}

/** No labels (no mark has a number), paths at full strength, the splash ink. */
export function splashOpts(textScale: number): FrameOpts {
  const ink = { O: { fill: SPLASH_INK.O, ring: SPLASH_INK.outline }, X: { fill: SPLASH_INK.X, ring: SPLASH_INK.outline } };
  return { numbers: {}, ratings: {}, labelContent: "rating", focused: null, markLabels: "none", routeAlpha: 1, textScale, ink };
}

/**
 * Paints the diagram on `canvas`, `width` CSS px wide: the field, then the marks and paths when
 * the templates are in (`frame` null while loading: turf only, so the layout doesn't jump).
 */
export function drawSplash(canvas: HTMLCanvasElement, width: number, textScale: number, style: { readonly markYards: number; readonly markMinPx: number }, frame: ((pxPerYard: number) => Timeline) | null): void {
  const v = splashView(width, (s) => Math.max(style.markMinPx, style.markYards * s));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(v.width * dpr));
  canvas.height = Math.max(1, Math.round(v.height * dpr));
  canvas.style.width = `${v.width}px`;
  canvas.style.height = `${v.height}px`;
  const g = canvas.getContext("2d");
  if (g === null) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawField(g, v, splashScene(), textScale);
  if (frame !== null) drawFrame(g, v, frame(v.s), 0, splashOpts(textScale));
}
