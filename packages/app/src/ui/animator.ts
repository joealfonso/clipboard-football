// Plays a timeline on the field canvas with requestAnimationFrame. Speed 1x, 2x or skip; Space
// skips to the whistle. Reduced motion shows only the final frame with paths, and cuts the camera
// and the possession flip. A jump to the end (reduced motion, skip) still holds the whistle frame
// for at least the designed hold, so it is painted before a flip replaces it (Space ends the
// hold; a player card pauses it).
// The animator reads the timeline and decides nothing.

import { drawField, drawFrame, markPositions, viewOf, type FieldScene, type FrameOpts, type SideInk } from "./field";
import { BANNER_T, momentEnd, type Moment } from "./moments";
import { cameraAt, panCamera, screenX, type Layout } from "./layout";
import { at, type Timeline } from "./timeline";
import type { Templates } from "./templates";
import type { SpeedSetting } from "./screens";

export interface PlayOpts {
  readonly speed: SpeedSetting;
  readonly reducedMotion: boolean;
  /** The game clock to show during the run-off beat. */
  readonly onClock: (seconds: number) => void;
  /** The snap, when the animation reaches it (the play rail shows the calls from then). */
  readonly onSnap?: () => void;
  /** The moment the committed play fired (DESIGN.md Moments) and its banner team's colors. */
  readonly moment?: { readonly moment: Moment; readonly ink: SideInk | null };
  /**
   * Once, when a banner's sub line appears (or at once on a jump to the end): the bug shows the
   * new score and possession on that frame, so the two never disagree.
   */
  readonly onMoment?: () => void;
}

/** The scene's team colors and down tag, when it has them, over the frame options. */
export function withScene(o: FrameOpts, scene: FieldScene): FrameOpts {
  return { ...o, ...(scene.ink === undefined ? {} : { ink: scene.ink }), ...(scene.downTag === undefined ? {} : { downTag: scene.downTag }) };
}

export class Animator {
  private raf = 0;
  private current: { tl: Timeline; scene: FieldScene } | null = null;
  private idleScene: FieldScene | null = null;
  private t = 0;
  private camera = 0;
  private speedFactor = 1;
  private finish: (() => void) | null = null;
  private skipRequested = false;
  private paused = false;
  /** The last play's final frame, for the dead ball's state 1 (Pre-snap). */
  private last: { tl: Timeline; scene: FieldScene; t: number; camera: number } | null = null;
  private stillRaf = 0;
  /** The whistle-frame hold after a jump to the end (reduced motion, skip), so the frame is painted. */
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  /** Ms of that hold still to run, and when its timer started (a player card pauses it). */
  private holdLeft = 0;
  private holdFrom = 0;
  /** A jump-to-end hold is pending (running, or paused by a player card). */
  private holding = false;
  /** Timeline ms per wall ms while a play runs in real time; null otherwise (reduced motion, Skip, a still). The carrier trail draws only then. */
  private liveSpeed: number | null = null;
  /** Fires the playing timeline's onMoment once. */
  private tellMoment: (() => void) | null = null;
  /**
   * The playing timeline's moment: `bt` is wall-clock ms since it began (-1 before the whistle),
   * `holdMs` its whole hold in wall ms, `still` the end state at once (reduced motion, Skip).
   */
  private moment: { readonly moment: Moment; readonly ink: SideInk | null; bt: number; holdMs: number; still: boolean } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly layout: () => Layout,
    private readonly templates: () => Templates,
    private readonly frameOpts: () => FrameOpts,
  ) {}

  get playing(): boolean {
    return this.finish !== null;
  }

  private ctx(): CanvasRenderingContext2D | null {
    const l = this.layout();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(l.field.width * dpr));
    const h = Math.max(1, Math.round(l.field.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.canvas.style.width = `${l.field.width}px`;
      this.canvas.style.height = `${l.field.height}px`;
    }
    const g = this.canvas.getContext("2d");
    g?.setTransform(dpr, 0, 0, dpr, 0, 0);
    return g;
  }

  private startCamera(los: number): number {
    const l = this.layout();
    return cameraAt(los, l.visibleYards, this.templates().field.losFromTop);
  }

  /**
   * The dead-ball view: the last play's final frame if it's in this frame, else an empty field.
   * Without keepLast the last play's frame is gone for good (a possession flip): restoreLast never
   * brings it back in the old orientation.
   */
  idle(scene: FieldScene, keepLast: boolean, crossfade: boolean): void {
    const before = crossfade ? this.snapshot() : null;
    this.idleScene = scene;
    if (this.finish === null) this.liveSpeed = null;
    if (!keepLast) {
      this.current = null;
      this.last = null;
    }
    if (this.current === null) this.camera = this.startCamera(scene.los);
    this.redraw();
    if (before !== null) this.fade(before);
  }

  /** Called after every redraw: the calling screen's board draws the same frame (U1). */
  onRedraw: (() => void) | null = null;

  /**
   * The frame the field shows now: the play or still on it at its time, or the idle field (the ball
   * on the line). The calling screen's board draws exactly this (U1, CB2); null before any.
   */
  shown(): { readonly tl: Timeline; readonly scene: FieldScene; readonly t: number } | null {
    if (this.current !== null) return { tl: this.current.tl, scene: this.current.scene, t: this.t };
    if (this.idleScene !== null) return { tl: emptyTimeline(this.idleScene.los), scene: this.idleScene, t: 0 };
    return null;
  }

  /** Redraws whatever is on the field now (after a resize or a settings change). */
  redraw(): void {
    this.paint();
    this.onRedraw?.();
  }

  private paint(): void {
    const g = this.ctx();
    if (g === null) return;
    const l = this.layout();
    const v = viewOf(l, this.camera);
    if (this.current !== null) {
      drawField(g, v, this.current.scene, this.frameOpts().textScale);
      const o = withScene(this.frameOpts(), this.current.scene);
      const m = this.moment;
      drawFrame(g, v, this.current.tl, this.t, { ...o, ...(this.liveSpeed === null ? {} : { live: { speed: this.liveSpeed } }), ...(m === null ? {} : { moment: { moment: m.moment, ink: m.ink, bt: m.bt, holdMs: m.holdMs, still: m.still } }) });
    } else if (this.idleScene !== null) {
      drawField(g, v, this.idleScene, this.frameOpts().textScale);
      // The ball waits on the line.
      drawFrame(g, v, { ...emptyTimeline(this.idleScene.los) }, 0, withScene(this.frameOpts(), this.idleScene));
    }
  }

  private snapshot(): HTMLCanvasElement | null {
    if (this.canvas.width === 0) return null;
    const c = document.createElement("canvas");
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    c.getContext("2d")?.drawImage(this.canvas, 0, 0);
    return c;
  }

  private fade(from: HTMLCanvasElement): void {
    const ms = this.templates().timing.crossfadeMs;
    const t0 = performance.now();
    const step = (): void => {
      const f = (performance.now() - t0) / ms;
      this.redraw();
      if (f >= 1) return;
      const g = this.canvas.getContext("2d");
      if (g === null) return;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1 - f;
      g.drawImage(from, 0, 0);
      g.restore();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /**
   * A still frame (the Calling state): your lineup and their huddle. With `glideMs` the marks slide
   * from the frame shown before (the timeline already carries the glide keys); 0 cuts.
   */
  still(tl: Timeline, scene: FieldScene, glideMs: number): void {
    cancelAnimationFrame(this.stillRaf);
    this.liveSpeed = null;
    this.current = { tl, scene };
    this.camera = this.startCamera(tl.los);
    if (glideMs <= 0) {
      this.t = 1e9;
      this.redraw();
      return;
    }
    const t0 = performance.now();
    const step = (): void => {
      this.t = Math.min(glideMs, performance.now() - t0);
      this.redraw();
      if (this.t < glideMs) this.stillRaf = requestAnimationFrame(step);
    };
    this.t = 0;
    this.redraw();
    this.stillRaf = requestAnimationFrame(step);
  }

  /** Back to the last play's whistle frame (Esc to a first screen, or the mouse leaving the cards). */
  restoreLast(scene: FieldScene): void {
    cancelAnimationFrame(this.stillRaf);
    this.liveSpeed = null;
    if (this.last === null) {
      this.current = null;
      this.idleScene = scene;
      this.camera = this.startCamera(scene.los);
    } else {
      this.current = { tl: this.last.tl, scene: this.last.scene };
      this.t = this.last.t;
      this.camera = this.last.camera;
    }
    this.redraw();
  }

  /** The camera now (field y at the canvas's top edge), for placing overlays. */
  cameraY(): number {
    return this.camera;
  }

  /** The ball's canvas x in the frame shown, or null with no play on the field. */
  ballX(): number | null {
    if (this.current === null) return null;
    return screenX(this.layout(), at(this.current.tl.ball, this.t).x);
  }

  /** The current frame's marks in canvas px, for hovering a mark. */
  marks(): { id: string; x: number; y: number }[] {
    if (this.current === null) return [];
    return markPositions(viewOf(this.layout(), this.camera), this.current.tl, this.t);
  }

  /** A player card is open: hold the play where it is (the whistle hold after a jump too). */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    if (this.holding && this.holdTimer !== null) {
      this.clearHoldTimer();
      this.holdLeft = Math.max(0, this.holdLeft - (performance.now() - this.holdFrom));
    }
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.holding && this.holdTimer === null) this.startHold();
  }

  /** Plays one timeline; resolves at the end of the hold. */
  play(tl: Timeline, scene: FieldScene, o: PlayOpts): Promise<void> {
    this.stop();
    this.current = { tl, scene };
    this.camera = this.startCamera(tl.los);
    this.skipRequested = false;
    this.speedFactor = o.speed === "2x" ? 2 : 1;
    const toEnd = o.reducedMotion || o.speed === "skip";
    this.liveSpeed = toEnd ? null : this.speedFactor;
    const mo = o.moment;
    const end = mo === undefined ? tl.total : momentEnd(tl, mo.moment);
    this.moment = mo === undefined ? null : { moment: mo.moment, ink: mo.ink, bt: -1, holdMs: (end - tl.liveEnd) / this.speedFactor, still: false };
    let told = false;
    const tell = (): void => {
      if (told) return;
      told = true;
      o.onMoment?.();
    };
    this.tellMoment = tell;
    return new Promise((resolve) => {
      this.finish = () => {
        this.finish = null;
        this.liveSpeed = null;
        this.moment = null;
        tell();
        resolve();
      };
      if (toEnd) {
        this.jumpToEnd(o, true);
        return;
      }
      let last = performance.now();
      this.t = 0;
      let snapped = false;
      const frame = (now: number): void => {
        const wall = this.paused ? 0 : now - last;
        const dt = wall * this.speedFactor;
        last = now;
        if (this.skipRequested) {
          // Space during the whistle hold ends it at once (moments included); during the live play it jumps to the whistle.
          if (this.t >= tl.liveEnd) {
            this.last = { tl, scene, t: tl.total, camera: this.camera };
            this.finish?.();
            return;
          }
          this.jumpToEnd(o, false);
          return;
        }
        this.t = Math.min(end, this.t + dt);
        if (!snapped && this.t >= tl.snapAt) {
          snapped = true;
          o.onSnap?.();
        }
        if (tl.runoff !== null && this.t <= tl.runoffMs) {
          const f = tl.runoffMs === 0 ? 1 : this.t / tl.runoffMs;
          o.onClock(Math.round(tl.runoff.from - (tl.runoff.from - tl.runoff.to) * f));
        }
        if (this.t >= tl.snapAt) {
          const l = this.layout();
          this.camera = panCamera(this.camera, at(tl.ball, Math.min(this.t, tl.liveEnd)).y, l.visibleYards, this.templates().field.panEdgeYards);
        }
        // The moment's own clock is wall time (Motion (UI) durations never scale); only the hold halves at 2x.
        const mm = this.moment;
        if (mm !== null && this.t >= tl.liveEnd) {
          mm.bt = mm.bt < 0 ? (this.t - tl.liveEnd) / this.speedFactor : mm.bt + wall;
          mm.holdMs = (end - tl.liveEnd) / this.speedFactor;
          // A banner's sub line appears 320 ms after the whistle: the bug changes on that frame.
          if (mm.moment.banner !== null && mm.bt >= BANNER_T.subAt) tell();
        }
        this.redraw();
        if (this.t >= end) {
          this.last = { tl, scene, t: tl.total, camera: this.camera };
          this.finish?.();
          return;
        }
        this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    });
  }

  /** The final frame with paths drawn, held for the whistle hold (respecting pause) before resolving, so a possession flip never replaces it unpainted. */
  private jumpToEnd(o: PlayOpts, fromStart: boolean): void {
    cancelAnimationFrame(this.raf);
    this.liveSpeed = null;
    const cur = this.current;
    if (cur === null) return;
    const tl = cur.tl;
    if (tl.runoff !== null) o.onClock(tl.runoff.to);
    o.onSnap?.();
    const l = this.layout();
    // Cut the camera to where a pan would have left it.
    let cam = this.startCamera(tl.los);
    for (let t = tl.snapAt; t <= tl.liveEnd; t += 50) cam = panCamera(cam, at(tl.ball, t).y, l.visibleYards, this.templates().field.panEdgeYards);
    this.camera = cam;
    this.t = tl.total;
    this.last = { tl, scene: cur.scene, t: tl.total, camera: cam };
    // Moments show their end state at once; the bug changes with them.
    if (this.moment !== null) {
      this.moment.still = true;
      this.moment.bt = 0;
    }
    this.tellMoment?.();
    this.redraw();
    void fromStart;
    // Hold the whistle frame before resolving, so the next change (a possession flip's idle field)
    // can't replace it before it is ever painted. At least the normal path's hold or settle, and
    // never under the designed hold (timing.holdMs): a touchback or fair catch has a hold of 0 but
    // its label still shows. Space during the hold ends it; a player card pauses it.
    // Skip keeps a banner's minimum hold; Space at 2x keeps half of it (2x halves every hold);
    // reduced motion adds no hold for a moment.
    const min = this.moment?.moment.banner != null && !o.reducedMotion ? (this.moment?.moment.minHoldMs ?? 0) : 0;
    const banner = o.speed === "skip" ? min : min / this.speedFactor;
    this.holdLeft = Math.max(tl.holdMs, tl.settleMs, this.templates().timing.holdMs, banner);
    this.holding = true;
    if (!this.paused) this.startHold();
  }

  /**
   * A play already shown (a pending penalty, run-off, challenge or review) whose committed result
   * fires a moment: its banner or chips on the last play's whistle frame, from now. Same rules as
   * play(): the hold is the moment's minimum (halved at 2x), Space ends it, Skip shows the end state
   * and keeps a banner's minimum, reduced motion shows the end state with no hold. `onMoment` fires
   * once, on the banner's sub-line frame (at once with no banner or no motion).
   */
  replayMoment(mo: { readonly moment: Moment; readonly ink: SideInk | null }, o: Pick<PlayOpts, "speed" | "reducedMotion" | "onMoment">): Promise<void> {
    const m = mo.moment;
    const last = this.last;
    if (last === null || (m.banner === null && !m.firstDown && m.bigPlay === null)) {
      o.onMoment?.();
      return Promise.resolve();
    }
    this.stop();
    cancelAnimationFrame(this.stillRaf);
    this.current = { tl: last.tl, scene: last.scene };
    this.t = last.t;
    this.camera = last.camera;
    this.skipRequested = false;
    this.speedFactor = o.speed === "2x" ? 2 : 1;
    const still = o.reducedMotion || o.speed === "skip";
    const holdMs = o.reducedMotion ? 0 : o.speed === "skip" ? (m.banner === null ? 0 : m.minHoldMs) : m.minHoldMs / this.speedFactor;
    this.moment = { moment: m, ink: mo.ink, bt: 0, holdMs, still };
    let told = false;
    const tell = (): void => {
      if (told) return;
      told = true;
      o.onMoment?.();
    };
    this.tellMoment = tell;
    return new Promise((resolve) => {
      this.finish = () => {
        this.finish = null;
        this.moment = null;
        this.holding = false;
        tell();
        resolve();
      };
      if (still) {
        tell();
        this.redraw();
        this.holdLeft = holdMs;
        this.holding = true;
        if (!this.paused) this.startHold();
        return;
      }
      if (m.banner === null) tell();
      let prev = performance.now();
      const frame = (now: number): void => {
        const mm = this.moment;
        if (this.skipRequested || mm === null) {
          this.finish?.();
          return;
        }
        mm.bt += this.paused ? 0 : now - prev;
        prev = now;
        if (mm.moment.banner !== null && mm.bt >= BANNER_T.subAt) tell();
        this.redraw();
        if (mm.bt >= mm.holdMs) {
          this.finish?.();
          return;
        }
        this.raf = requestAnimationFrame(frame);
      };
      this.redraw();
      this.raf = requestAnimationFrame(frame);
    });
  }

  private startHold(): void {
    this.holdFrom = performance.now();
    this.holdTimer = setTimeout(() => this.endHold(), this.holdLeft);
  }

  private clearHoldTimer(): void {
    if (this.holdTimer !== null) clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  private endHold(): void {
    this.clearHoldTimer();
    this.holding = false;
    this.finish?.();
  }

  /** Space during the animation; during the whistle hold after a jump, ends the hold. */
  skip(): void {
    if (this.holding) this.endHold();
    else if (this.playing) this.skipRequested = true;
  }

  /** S during the animation: 1x, 2x, skip. Returns the new setting. */
  cycleSpeed(current: SpeedSetting): SpeedSetting {
    const next: SpeedSetting = current === "1x" ? "2x" : current === "2x" ? "skip" : "1x";
    if (this.playing) {
      if (next === "skip") this.skipRequested = true;
      else {
        this.speedFactor = next === "2x" ? 2 : 1;
        if (this.liveSpeed !== null) this.liveSpeed = this.speedFactor;
      }
    }
    return next;
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.clearHoldTimer();
    this.holding = false;
    if (this.finish !== null) this.finish();
  }
}

function emptyTimeline(los: number): Timeline {
  return {
    los,
    firstDown: null,
    lineUpMs: 0,
    runoffMs: 0,
    runoff: null,
    setAt: 0,
    snapAt: 0,
    liveEnd: 0,
    settleMs: 0,
    holdMs: 0,
    total: 0,
    marks: [],
    ball: [{ t: 0, x: 53.3 / 2, y: los }],
    ballScale: [{ t: 0, s: 1 }],
    read: 0,
    preview: null,
    paths: [],
    labels: [],
    flags: [],
    holder: null,
    tackler: null,
    involved: [],
    rings: [],
    snapWindowEnd: 0,
  };
}
