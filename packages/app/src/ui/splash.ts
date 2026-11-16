// The main menu's play diagram (docs/specs/m2-main-menu.md, "Splash composition"): a designed
// illustration from the play-card templates, never model output. Shotgun play action against
// nickel Cover 3, generic slots, no labels, no ball path, no zones, no first-down line.
// No field under it (Joseph, 2026-11-15): just the X's and O's, running the play on a loop and
// leaving a dotted trail behind them. Reduced motion: one still frame of the finished play.
//
// splashFrame, splashMovers, pointAlong, splashPhase and artShown are pure; SplashLoop paints.

import { defenseArt, offenseArt, slotsFromCounts, type Art } from "./art";
import { drawMark, type FieldScene, type FrameOpts, type View } from "./field";
import { COLUMN_YARDS } from "./layout";
import { MID_X, type Key, type Pt } from "./motion";
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

/**
 * The plays the splash runs, one per loop, in order (designed, Joseph 2026-11-15: "add a
 * different play"). Each is a different look: play action, a run, a four-wide intermediate pass from empty, a
 * screen against the blitz. The first is SPLASH's own play, the still frame under reduced motion.
 */
export const SPLASH_PLAYS: readonly { readonly formation: string; readonly play: string; readonly pkg: string; readonly preset: string }[] = [
  { formation: SPLASH.formation, play: SPLASH.play, pkg: SPLASH.pkg, preset: SPLASH.preset },
  { formation: "underCenter", play: "insideRun", pkg: "base", preset: "runStuff" },
  { formation: "empty", play: "intermediatePass", pkg: "dime", preset: "dimeCover4" },
  { formation: "pistol", play: "screenPass", pkg: "nickel", preset: "nickelCover1Blitz" },
];

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
export function splashFrame(templates: Templates, personnel: SplashPersonnel, pxPerYard: number, call: (typeof SPLASH_PLAYS)[number] = SPLASH_PLAYS[0] as (typeof SPLASH_PLAYS)[number]): Timeline {
  const los = SPLASH.los;
  const off = offenseArt(call.formation, call.play, slotsFromCounts(personnel.offense), templates, los, pxPerYard);
  const def = defenseArt(call.pkg, call.preset, slotsFromCounts(personnel.defense), templates, los, pxPerYard);
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

/** One mark's run: where it lines up and the polyline it follows (its start first). */
export interface Mover {
  readonly side: "O" | "X";
  readonly points: readonly Pt[];
}

/** Each mark with its path from the preview art (a mark with no path stands still). */
export function splashMovers(tl: Timeline): Mover[] {
  const paths = tl.preview?.paths ?? [];
  return tl.marks.map((m) => {
    const k = m.keys[0] ?? { x: MID_X, y: tl.los };
    const start = { x: k.x, y: k.y };
    const p = paths.find((q) => q.slot === m.slot && q.side === m.side);
    if (p === undefined || p.points.length === 0) return { side: m.side, points: [start] };
    const first = p.points[0] as Pt;
    const same = Math.hypot(first.x - start.x, first.y - start.y) < 1e-6;
    return { side: m.side, points: same ? p.points : [start, ...p.points] };
  });
}

/** The point a fraction `f` (0 to 1) of the way along a polyline, by length. */
export function pointAlong(points: readonly Pt[], f: number): Pt {
  const first = points[0] ?? { x: 0, y: 0 };
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot((points[i] as Pt).x - (points[i - 1] as Pt).x, (points[i] as Pt).y - (points[i - 1] as Pt).y);
  if (total === 0) return first;
  let left = Math.min(1, Math.max(0, f)) * total;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Pt;
    const b = points[i] as Pt;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= d && d > 0) return { x: a.x + ((b.x - a.x) * left) / d, y: a.y + ((b.y - a.y) * left) / d };
    left -= d;
  }
  return points[points.length - 1] ?? first;
}

/** One loop of the splash (ms): lined up, the play, a hold at the end, then fade out and back in. */
export const SPLASH_LOOP = { set: 900, play: 2800, hold: 1300, fadeOut: 450, fadeIn: 350 } as const;
export const LOOP_MS = SPLASH_LOOP.set + SPLASH_LOOP.play + SPLASH_LOOP.hold + SPLASH_LOOP.fadeOut + SPLASH_LOOP.fadeIn;

/** Which of `n` plays is up `ms` into the run: the next one each loop, back to the first after the last. */
export function splashPlayIndex(ms: number, n: number): number {
  if (n <= 0) return 0;
  return Math.floor(Math.max(0, ms) / LOOP_MS) % n;
}

const easeInOut = (f: number): number => (f < 0.5 ? 4 * f ** 3 : 1 - (-2 * f + 2) ** 3 / 2);

/** How far along the play is (eased, 0 to 1) and the diagram's opacity, `ms` into the loop. */
export function splashPhase(ms: number): { readonly f: number; readonly alpha: number } {
  const L = SPLASH_LOOP;
  const t = ((ms % LOOP_MS) + LOOP_MS) % LOOP_MS;
  if (t < L.fadeIn) return { f: 0, alpha: t / L.fadeIn };
  const u = t - L.fadeIn;
  if (u < L.set) return { f: 0, alpha: 1 };
  if (u < L.set + L.play) return { f: easeInOut((u - L.set) / L.play), alpha: 1 };
  if (u < L.set + L.play + L.hold) return { f: 1, alpha: 1 };
  return { f: 1, alpha: 1 - (u - L.set - L.play - L.hold) / L.fadeOut };
}

const sx = (v: View, x: number): number => v.ox + (1 + x) * v.s;
const sy = (v: View, y: number): number => (v.cameraY - y) * v.s;

/** One frame: each mark's dotted trail from where it lined up to where it is, then the marks. No field. */
export function paintSplash(g: CanvasRenderingContext2D, v: View, movers: readonly Mover[], f: number, alpha: number): void {
  const o = splashOpts(1).ink ?? { O: { fill: SPLASH_INK.O, ring: SPLASH_INK.outline }, X: { fill: SPLASH_INK.X, ring: SPLASH_INK.outline } };
  g.clearRect(0, 0, v.width, v.height);
  if (alpha <= 0) return;
  const r = v.markPx / 2;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.lineWidth = 2;
  g.strokeStyle = SPLASH_INK.O;
  g.setLineDash([1, 6]);
  for (const m of movers) {
    if (m.points.length < 2 || f <= 0) continue;
    const end = pointAlong(m.points, f);
    // The trail: every corner it has passed, then where the mark is now.
    let total = 0;
    for (let i = 1; i < m.points.length; i++) total += Math.hypot((m.points[i] as Pt).x - (m.points[i - 1] as Pt).x, (m.points[i] as Pt).y - (m.points[i - 1] as Pt).y);
    let left = f * total;
    g.globalAlpha = alpha * (m.side === "O" ? 0.7 : 0.45);
    g.beginPath();
    g.moveTo(sx(v, (m.points[0] as Pt).x), sy(v, (m.points[0] as Pt).y));
    for (let i = 1; i < m.points.length; i++) {
      const a = m.points[i - 1] as Pt;
      const b = m.points[i] as Pt;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (left <= d) break;
      g.lineTo(sx(v, b.x), sy(v, b.y));
      left -= d;
    }
    g.lineTo(sx(v, end.x), sy(v, end.y));
    g.stroke();
  }
  g.setLineDash([]);
  g.lineCap = "butt";
  g.globalAlpha = alpha;
  for (const m of movers) {
    const p = pointAlong(m.points, f);
    drawMark(g, m.side, o[m.side], sx(v, p.x), sy(v, p.y), r);
  }
  g.globalAlpha = 1;
}

/**
 * Runs the diagram on `canvas`: sizes it for `width` CSS px, then animates until the canvas
 * leaves the page or `stop` is called, one play per loop from `frames` in order. `frames` empty
 * (templates still loading): an empty box, so the layout doesn't jump. `still`: one frame of the
 * first play finished, no loop (reduced motion).
 */
export class SplashLoop {
  private raf = 0;
  private born = 0;
  running = false;

  run(canvas: HTMLCanvasElement, width: number, style: { readonly markYards: number; readonly markMinPx: number }, frames: readonly ((pxPerYard: number) => Timeline)[], still: boolean): void {
    this.stop();
    const v = splashView(width, (s) => Math.max(style.markMinPx, style.markYards * s));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(v.width * dpr));
    canvas.height = Math.max(1, Math.round(v.height * dpr));
    canvas.style.width = `${v.width}px`;
    canvas.style.height = `${v.height}px`;
    const g = canvas.getContext("2d");
    if (g === null) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (frames.length === 0) {
      g.clearRect(0, 0, v.width, v.height);
      return;
    }
    const plays = frames.map((f) => splashMovers(f(v.s)));
    if (still) {
      paintSplash(g, v, plays[0] ?? [], 1, 1);
      return;
    }
    this.running = true;
    this.born = performance.now();
    const tick = (now: number): void => {
      if (!this.running) return;
      if (!canvas.isConnected) {
        this.stop();
        return;
      }
      const ms = now - this.born;
      const ph = splashPhase(ms);
      paintSplash(g, v, plays[splashPlayIndex(ms, plays.length)] ?? [], ph.f, ph.alpha);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
