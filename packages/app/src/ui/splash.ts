// The main menu's play diagram (docs/specs/m2-main-menu.md, "Splash composition"): a designed
// illustration from the play-card templates, never model output. Shotgun play action against
// nickel Cover 3, generic slots, no labels, no ball path, no zones, no first-down line.
// No field under it (Joseph, 2026-11-15): just the X's and O's. Each loop generates a new call for
// both sides and plays it out live (splashSim.ts), dotted trails behind every player. Reduced
// motion: one still frame of the designed play, finished.
//
// splashFrame, splashPlay, splashClock and artShown are pure; SplashLoop paints.

import { defenseArt, offenseArt, slotsFromCounts, type Art } from "./art";
import { drawBall, drawMark, type FieldScene, type FrameOpts, type View } from "./field";
import { COLUMN_YARDS } from "./layout";
import { MID_X, type Key, type Pt } from "./motion";
import { DT, fitShift, pointAtDistance, randomCall, rng, simulateSplash, type SimMark, type SplashCall, type SplashScript } from "./splashSim";
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

/** The play the still frame and the play cards' own tests use: shotgun play action against nickel Cover 3. */
export const SPLASH_CALL: SplashCall = { formation: SPLASH.formation, play: SPLASH.play, pkg: SPLASH.pkg, preset: SPLASH.preset };

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
export function splashFrame(templates: Templates, personnel: SplashPersonnel, pxPerYard: number, call: SplashCall = SPLASH_CALL): Timeline {
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

/** The art's marks as the simulation takes them: start, position and every path the art gives each one. */
export function simMarks(tl: Timeline): SimMark[] {
  const paths = tl.preview?.paths ?? [];
  return tl.marks.map((m) => {
    const k = m.keys[0] ?? { x: MID_X, y: tl.los };
    return { side: m.side, position: m.position, slot: m.slot, start: { x: k.x, y: k.y }, paths: paths.filter((q) => q.slot === m.slot && q.side === m.side).map((q) => ({ kind: q.kind, points: q.points })) };
  });
}

/** The point a fraction `f` (0 to 1) of the way along a polyline, by length. */
export function pointAlong(points: readonly Pt[], f: number): Pt {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot((points[i] as Pt).x - (points[i - 1] as Pt).x, (points[i] as Pt).y - (points[i - 1] as Pt).y);
  return pointAtDistance(points, Math.min(1, Math.max(0, f)) * total);
}

/** The field yards the splash box shows, bottom to top. */
export function splashBounds(v: View): { readonly bottom: number; readonly top: number } {
  return { bottom: v.cameraY - v.height / v.s, top: v.cameraY };
}

/**
 * One generated, played-out snap for loop `seed`: a random call for each side, lined up from
 * the play-card art (`art`), shifted downfield so it fits the box, then simulated.
 */
export function splashPlay(art: (call: SplashCall, pxPerYard: number) => Timeline, v: View, seed: number, call?: SplashCall): SplashScript {
  const c = call ?? randomCall(rng(seed));
  const marks = simMarks(art(c, v.s));
  const box = splashBounds(v);
  const dy = fitShift(marks, box.bottom, box.top);
  const moved = marks.map((m) => ({ ...m, start: { x: m.start.x, y: m.start.y + dy }, paths: m.paths.map((p) => ({ kind: p.kind, points: p.points.map((q) => ({ x: q.x, y: q.y + dy })) })) }));
  return simulateSplash(c, moved, { ...box, los: SPLASH.los + dy }, seed);
}

/** One loop around a snap (ms): fade in, set, the live play (its own length), a hold on the result, fade out. */
export const SPLASH_LOOP = { fadeIn: 300, set: 700, hold: 1400, fadeOut: 400 } as const;

/** Where `ms` falls in a loop around `script`: the step to show, the opacity, and whether the loop is over. */
export function splashClock(ms: number, script: SplashScript): { readonly step: number; readonly alpha: number; readonly done: boolean } {
  const L = SPLASH_LOOP;
  const live = (script.steps - 1) * DT * 1000;
  const last = script.steps - 1;
  if (ms < L.fadeIn) return { step: 0, alpha: Math.max(0, ms / L.fadeIn), done: false };
  let u = ms - L.fadeIn;
  if (u < L.set) return { step: 0, alpha: 1, done: false };
  u -= L.set;
  if (u < live) return { step: Math.min(last, Math.floor(u / (DT * 1000))), alpha: 1, done: false };
  u -= live;
  if (u < L.hold) return { step: last, alpha: 1, done: false };
  u -= L.hold;
  if (u < L.fadeOut) return { step: last, alpha: 1 - u / L.fadeOut, done: false };
  return { step: last, alpha: 0, done: true };
}

const sx = (v: View, x: number): number => v.ox + (1 + x) * v.s;
const sy = (v: View, y: number): number => (v.cameraY - y) * v.s;
/** Trails sample every few steps: smooth enough, and a dotted dash pattern that doesn't crawl. */
const TRAIL_EVERY = 3;

/** One frame of a snap at `step`: dotted trails behind every mark and behind the ball in the air, then the marks and the ball. No field. */
export function paintSplash(g: CanvasRenderingContext2D, v: View, script: SplashScript, step: number, alpha: number): void {
  const ink = splashOpts(1).ink ?? { O: { fill: SPLASH_INK.O, ring: SPLASH_INK.outline }, X: { fill: SPLASH_INK.X, ring: SPLASH_INK.outline } };
  g.clearRect(0, 0, v.width, v.height);
  if (alpha <= 0) return;
  const n = script.sides.length;
  const at = Math.max(0, Math.min(script.steps - 1, Math.floor(step)));
  const px = (i: number, j: number): Pt => ({ x: script.pos[(i * n + j) * 2] ?? 0, y: script.pos[(i * n + j) * 2 + 1] ?? 0 });
  g.lineCap = "round";
  g.lineJoin = "round";
  g.lineWidth = 2;
  g.strokeStyle = SPLASH_INK.O;
  g.setLineDash([1, 6]);
  if (at > 0) {
    for (let j = 0; j < n; j++) {
      g.globalAlpha = alpha * (script.sides[j] === "O" ? 0.7 : 0.45);
      g.beginPath();
      const p0 = px(0, j);
      g.moveTo(sx(v, p0.x), sy(v, p0.y));
      for (let i = TRAIL_EVERY; i < at; i += TRAIL_EVERY) {
        const p = px(i, j);
        g.lineTo(sx(v, p.x), sy(v, p.y));
      }
      const p = px(at, j);
      g.lineTo(sx(v, p.x), sy(v, p.y));
      g.stroke();
    }
  }
  // The ball's flight, dotted, from the throw to where it is (or came down).
  if (script.throwStep >= 0 && at > script.throwStep) {
    const end = script.landStep >= 0 ? Math.min(at, script.landStep) : at;
    g.globalAlpha = alpha;
    g.setLineDash([2, 5]);
    g.beginPath();
    g.moveTo(sx(v, script.ball[script.throwStep * 3] ?? 0), sy(v, script.ball[script.throwStep * 3 + 1] ?? 0));
    g.lineTo(sx(v, script.ball[end * 3] ?? 0), sy(v, script.ball[end * 3 + 1] ?? 0));
    g.stroke();
  }
  g.setLineDash([]);
  g.lineCap = "butt";
  g.globalAlpha = alpha;
  const r = v.markPx / 2;
  for (let j = 0; j < n; j++) {
    const p = px(at, j);
    const side = script.sides[j] === "X" ? "X" : "O";
    drawMark(g, side, ink[side], sx(v, p.x), sy(v, p.y), r);
  }
  drawBall(g, v, script.ball[at * 3] ?? 0, script.ball[at * 3 + 1] ?? 0, script.ball[at * 3 + 2] ?? 1);
  g.globalAlpha = 1;
}

/**
 * Runs the splash on `canvas`: sizes it for `width` CSS px, then plays one generated snap after
 * another until the canvas leaves the page or `stop` is called. `art` null (templates still
 * loading): an empty box, so the layout doesn't jump. `still` (reduced motion): the designed
 * play's finished frame, no loop.
 */
export class SplashLoop {
  private raf = 0;
  running = false;
  /** The next loop's seed: random per visit, so the menu never opens on the same snap. */
  private seed = Math.floor(Math.random() * 2 ** 31);

  run(canvas: HTMLCanvasElement, width: number, style: { readonly markYards: number; readonly markMinPx: number }, art: ((call: SplashCall, pxPerYard: number) => Timeline) | null, still: boolean): void {
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
    if (art === null) {
      g.clearRect(0, 0, v.width, v.height);
      return;
    }
    if (still) {
      const s = splashPlay(art, v, 1, SPLASH_CALL);
      paintSplash(g, v, s, s.steps - 1, 1);
      return;
    }
    this.running = true;
    let script = splashPlay(art, v, this.seed++);
    let born = performance.now();
    const tick = (now: number): void => {
      if (!this.running) return;
      if (!canvas.isConnected) {
        this.stop();
        return;
      }
      let c = splashClock(now - born, script);
      if (c.done) {
        script = splashPlay(art, v, this.seed++);
        born = now;
        c = splashClock(0, script);
      }
      paintSplash(g, v, script, c.step, c.alpha);
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
