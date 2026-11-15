// Plays a timeline on the field canvas with requestAnimationFrame. Speed 1x, 2x or skip; Space
// skips to the whistle. Reduced motion shows only the final frame with paths, and cuts the camera
// and the possession flip. A jump to the end (reduced motion, skip) still holds the whistle frame
// for at least the designed hold, so it is painted before a flip replaces it (Space ends the
// hold; a player card pauses it).
// The animator reads the timeline and decides nothing.

import { drawField, drawFrame, markPositions, viewOf, type FieldScene, type FrameOpts } from "./field";
import { cameraAt, panCamera, screenX, type Layout } from "./layout";
import { at, type Timeline } from "./timeline";
import type { Templates } from "./templates";
import type { SpeedSetting } from "./screens";

export interface PlayOpts {
  readonly speed: SpeedSetting;
  readonly reducedMotion: boolean;
  /** The game clock to show during the run-off beat. */
  readonly onClock: (seconds: number) => void;
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
    if (!keepLast) {
      this.current = null;
      this.last = null;
    }
    if (this.current === null) this.camera = this.startCamera(scene.los);
    this.redraw();
    if (before !== null) this.fade(before);
  }

  /** Redraws whatever is on the field now (after a resize or a settings change). */
  redraw(): void {
    const g = this.ctx();
    if (g === null) return;
    const l = this.layout();
    const v = viewOf(l, this.camera);
    if (this.current !== null) {
      drawField(g, v, this.current.scene, this.frameOpts().textScale);
      drawFrame(g, v, this.current.tl, this.t, this.frameOpts());
    } else if (this.idleScene !== null) {
      drawField(g, v, this.idleScene, this.frameOpts().textScale);
      // The ball waits on the line.
      drawFrame(g, v, { ...emptyTimeline(this.idleScene.los) }, 0, this.frameOpts());
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
    return new Promise((resolve) => {
      this.finish = () => {
        this.finish = null;
        resolve();
      };
      if (toEnd) {
        this.jumpToEnd(o, true);
        return;
      }
      let last = performance.now();
      this.t = 0;
      const frame = (now: number): void => {
        const dt = this.paused ? 0 : (now - last) * this.speedFactor;
        last = now;
        if (this.skipRequested) {
          this.jumpToEnd(o, false);
          return;
        }
        this.t = Math.min(tl.total, this.t + dt);
        if (tl.runoff !== null && this.t <= tl.runoffMs) {
          const f = tl.runoffMs === 0 ? 1 : this.t / tl.runoffMs;
          o.onClock(Math.round(tl.runoff.from - (tl.runoff.from - tl.runoff.to) * f));
        }
        if (this.t >= tl.snapAt) {
          const l = this.layout();
          this.camera = panCamera(this.camera, at(tl.ball, Math.min(this.t, tl.liveEnd)).y, l.visibleYards, this.templates().field.panEdgeYards);
        }
        this.redraw();
        if (this.t >= tl.total) {
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
    const cur = this.current;
    if (cur === null) return;
    const tl = cur.tl;
    if (tl.runoff !== null) o.onClock(tl.runoff.to);
    const l = this.layout();
    // Cut the camera to where a pan would have left it.
    let cam = this.startCamera(tl.los);
    for (let t = tl.snapAt; t <= tl.liveEnd; t += 50) cam = panCamera(cam, at(tl.ball, t).y, l.visibleYards, this.templates().field.panEdgeYards);
    this.camera = cam;
    this.t = tl.total;
    this.last = { tl, scene: cur.scene, t: tl.total, camera: cam };
    this.redraw();
    void fromStart;
    // Hold the whistle frame before resolving, so the next change (a possession flip's idle field)
    // can't replace it before it is ever painted. At least the normal path's hold or settle, and
    // never under the designed hold (timing.holdMs): a touchback or fair catch has a hold of 0 but
    // its label still shows. Space during the hold ends it; a player card pauses it.
    this.holdLeft = Math.max(tl.holdMs, tl.settleMs, this.templates().timing.holdMs);
    this.holding = true;
    if (!this.paused) this.startHold();
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
      else this.speedFactor = next === "2x" ? 2 : 1;
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
