// Spec tests for docs/specs/m2-usability-pass.md U8 (kickoffs visible to the whistle) and the key
// repeat fix, by test-writer:
// - after a play that changes possession, the whistle frame is drawn and held for the timeline's
//   hold before the animator resolves, at 1x, under skip and under reduced motion (U8 item 3);
// - once the possession has flipped (idle with keepLast = false), restoreLast draws the scene it
//   is given, never the previous play's frame (item 13, AC 12);
// - a held Space or Enter (a key repeat) never skips the play or picks a row (debugger, U8 (a)).
// The animator runs on a stub canvas with fake timers; drawField and drawFrame are wrapped so the
// test sees which frame was painted, and when.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldScene, FrameOpts } from "../src/ui/field";
import type { Timeline } from "../src/ui/timeline";
import { FAIR_CATCH, KICKOFF_RETURN, KICKOFF_TOUCHBACK } from "./fixtures";

const drawn = vi.hoisted(() => ({ frames: [] as { tl: unknown; t: number; at: number }[], fields: [] as { scene: unknown; at: number }[] }));

vi.mock("../src/ui/field", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/ui/field")>();
  return {
    ...real,
    drawField: (...a: Parameters<typeof real.drawField>) => {
      drawn.fields.push({ scene: a[2], at: performance.now() });
      real.drawField(...a);
    },
    drawFrame: (...a: Parameters<typeof real.drawFrame>) => {
      drawn.frames.push({ tl: a[2], t: a[3], at: performance.now() });
      real.drawFrame(...a);
    },
  };
});

const { Animator } = await import("../src/ui/animator");
const { layoutFor } = await import("../src/ui/layout");
const { parseMotion, parseTemplates } = await import("../src/ui/templates");
const { timeline } = await import("../src/ui/timeline");

const root = join(import.meta.dirname, "../../..");
const read = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));
const templates = parseTemplates(read("data/ui/templates.json"));
const motion = parseMotion(read("data/ui/motion.json"));
const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };
const layout = layoutFor(1280, 720, templates.field);

function stubCtx(): CanvasRenderingContext2D {
  const state: Record<string, unknown> = {};
  return new Proxy(state, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === "measureText") return (s: string) => ({ width: s.length * 7 });
      if (k === "getLineDash") return () => [];
      return () => undefined;
    },
    set(t, k: string, v: unknown) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const opts: FrameOpts = { numbers: {}, ratings: {}, labelContent: "number", focused: null, markLabels: "involved", routeAlpha: 1, textScale: 1 };
const sceneHome: FieldScene = { los: 35, firstDown: null, bottomName: "Home", topName: "Away", endZoneYards: 10 };
// After the flip: the receiving team's frame, its own spot.
const sceneAway: FieldScene = { los: 28, firstDown: 38, bottomName: "Away", topName: "Home", endZoneYards: 10 };

const tlOf = (ev: typeof KICKOFF_RETURN): Timeline => timeline({ event: ev, runoffSeconds: 0 }, templates, { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: layout.s, markPx: layout.markPx, motion });

let animator: InstanceType<typeof Animator>;

beforeEach(() => {
  drawn.frames.length = 0;
  drawn.fields.length = 0;
  const g = globalThis as Record<string, unknown>;
  g["window"] = { devicePixelRatio: 1 };
  g["requestAnimationFrame"] = (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16);
  g["cancelAnimationFrame"] = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
  const ctx = stubCtx();
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx } as unknown as HTMLCanvasElement;
  animator = new Animator(canvas, () => layout, () => templates, () => opts);
});

afterEach(() => {
  vi.useRealTimers();
  const g = globalThis as Record<string, unknown>;
  delete g["window"];
  delete g["requestAnimationFrame"];
  delete g["cancelAnimationFrame"];
});

/** Starts a play; `done()` says whether it has resolved. */
function start(tl: Timeline, o: { speed: "1x" | "2x" | "skip"; reducedMotion: boolean }) {
  let resolvedAt: number | null = null;
  const t0 = performance.now();
  void animator.play(tl, sceneHome, { ...o, onClock: () => undefined }).then(() => {
    resolvedAt = performance.now();
  });
  return { t0, done: () => resolvedAt !== null, resolvedAt: () => resolvedAt };
}

const finalDraws = (tl: Timeline) => drawn.frames.filter((f) => f.tl === tl && f.t === tl.total);

describe("U8 item 3: the whistle frame holds for the timeline's hold before a possession flip", () => {
  for (const ev of [KICKOFF_RETURN, KICKOFF_TOUCHBACK]) {
    const label = ev === KICKOFF_RETURN ? "kickoff return" : "touchback";
    it(`${label}: the fixture flips possession`, () => {
      expect(ev.after.possession).not.toBe(ev.before.possession);
      // A tackled return has a hold; a touchback has none (motion spec: holds only after a catch,
      // tackle or score), so its "hold" is 0 ms.
      if (ev === KICKOFF_RETURN) expect(tlOf(ev).holdMs).toBeGreaterThan(0);
    });

    for (const o of [
      { speed: "1x", reducedMotion: true },
      { speed: "skip", reducedMotion: false },
    ] as const) {
      it(`${label}, ${o.reducedMotion ? "reduced motion" : "speed skip"}: the final frame is painted, then held holdMs, then the play resolves`, async () => {
        const tl = tlOf(ev);
        const p = start(tl, o);
        // The whistle frame is painted synchronously, before any timer runs.
        expect(finalDraws(tl).length, "the whistle frame is painted at once").toBeGreaterThan(0);
        if (tl.holdMs > 0) {
          await vi.advanceTimersByTimeAsync(0);
          expect(p.done(), "not resolved before the hold").toBe(false);
          await vi.advanceTimersByTimeAsync(tl.holdMs - 1);
          expect(p.done(), "still holding at holdMs - 1").toBe(false);
        }
        // The spec sets only a minimum for the hold; it must still end.
        await vi.advanceTimersByTimeAsync(5000);
        expect(p.done(), "resolved after the hold").toBe(true);
        // The frame painted last before the flip is the whistle frame.
        const before = drawn.frames.filter((f) => f.at <= (p.resolvedAt() as number));
        expect(before[before.length - 1]?.tl).toBe(tl);
        expect(before[before.length - 1]?.t).toBe(tl.total);
      });
    }

    it(`${label}, 1x: the play runs to the end of its hold, painting the whistle frame, before resolving`, async () => {
      const tl = tlOf(ev);
      const p = start(tl, { speed: "1x", reducedMotion: false });
      await vi.advanceTimersByTimeAsync(tl.liveEnd);
      expect(p.done()).toBe(false);
      await vi.advanceTimersByTimeAsync(tl.total + 200);
      expect(p.done()).toBe(true);
      expect((p.resolvedAt() as number) - p.t0).toBeGreaterThanOrEqual(tl.total);
      expect(finalDraws(tl).length).toBeGreaterThan(0);
      // The whistle (liveEnd) was on screen for at least the hold before the play resolved.
      const firstWhistle = drawn.frames.find((f) => f.tl === tl && f.t >= tl.liveEnd);
      expect(firstWhistle).toBeDefined();
      expect((p.resolvedAt() as number) - (firstWhistle?.at as number)).toBeGreaterThanOrEqual(tl.holdMs - 20);
    });

    it(`${label}, Space mid-play at 1x: the jump to the whistle still paints and holds it`, async () => {
      const tl = tlOf(ev);
      const p = start(tl, { speed: "1x", reducedMotion: false });
      await vi.advanceTimersByTimeAsync(200);
      animator.skip();
      await vi.advanceTimersByTimeAsync(20);
      expect(finalDraws(tl).length).toBeGreaterThan(0);
      const painted = finalDraws(tl)[0]?.at as number;
      if (tl.holdMs > 20) expect(p.done()).toBe(false);
      await vi.advanceTimersByTimeAsync(5000);
      expect(p.done()).toBe(true);
      expect((p.resolvedAt() as number) - painted).toBeGreaterThanOrEqual(tl.holdMs - 1);
    });
  }
});

describe("the jump-to-end hold: never shorter than the normal path's, and it respects pause()", () => {
  // Coordinator, 2026-11-14: under reduced motion or skip the whistle frame holds at least as long
  // as the 1x path shows it (tl.total - tl.liveEnd: the hold, or the settle when there is no
  // hold), even when tl.holdMs is 0 (a touchback, a fair catch).
  const normalMin = (tl: Timeline): number => Math.max(tl.holdMs, tl.total - tl.liveEnd);

  for (const ev of [KICKOFF_TOUCHBACK, FAIR_CATCH, KICKOFF_RETURN]) {
    const label = ev === KICKOFF_TOUCHBACK ? "touchback" : ev === FAIR_CATCH ? "fair catch" : "kickoff return";
    for (const o of [
      { speed: "1x", reducedMotion: true },
      { speed: "skip", reducedMotion: false },
    ] as const) {
      it(`${label}, ${o.reducedMotion ? "reduced motion" : "skip"}: holds at least the 1x path's whistle time`, async () => {
        const tl = tlOf(ev);
        if (ev !== KICKOFF_RETURN) expect(tl.holdMs, "fixture has no hold of its own").toBe(0);
        const min = normalMin(tl);
        expect(min, "the 1x path shows the whistle frame for some time").toBeGreaterThan(0);
        const p = start(tl, o);
        expect(finalDraws(tl).length).toBeGreaterThan(0);
        await vi.advanceTimersByTimeAsync(min - 1);
        expect(p.done(), `resolved before ${min} ms`).toBe(false);
        await vi.advanceTimersByTimeAsync(5000);
        expect(p.done()).toBe(true);
      });
    }
  }

  it("1x reference: a touchback's whistle frame shows for total - liveEnd before resolving", async () => {
    const tl = tlOf(KICKOFF_TOUCHBACK);
    const p = start(tl, { speed: "1x", reducedMotion: false });
    await vi.advanceTimersByTimeAsync(tl.total + 200);
    expect(p.done()).toBe(true);
    const firstWhistle = drawn.frames.find((f) => f.tl === tl && f.t >= tl.liveEnd);
    expect((p.resolvedAt() as number) - (firstWhistle?.at as number)).toBeGreaterThanOrEqual(tl.total - tl.liveEnd - 20);
  });

  /** How long the jump-to-end hold lasts unpaused for this timeline (measured, not assumed). */
  async function holdLength(tl: Timeline, o: { speed: "1x" | "skip"; reducedMotion: boolean }): Promise<number> {
    const p = start(tl, o);
    await vi.advanceTimersByTimeAsync(10000);
    expect(p.done()).toBe(true);
    return (p.resolvedAt() as number) - p.t0;
  }

  for (const ev of [KICKOFF_RETURN, KICKOFF_TOUCHBACK]) {
    const label = ev === KICKOFF_RETURN ? "kickoff return" : "touchback";
    it(`${label}, reduced motion: pause() during the hold stops it; resume() finishes only the rest`, async () => {
      const tl = tlOf(ev);
      const o = { speed: "1x", reducedMotion: true } as const;
      const H = await holdLength(tl, o);
      expect(H).toBeGreaterThanOrEqual(normalMin(tl));
      const p = start(tl, o);
      const half = Math.floor(H / 2);
      await vi.advanceTimersByTimeAsync(half);
      animator.pause();
      await vi.advanceTimersByTimeAsync(H * 5 + 1000);
      expect(p.done(), "the hold ran out while paused").toBe(false);
      animator.resume();
      await vi.advanceTimersByTimeAsync(H - half - 5);
      expect(p.done(), "resolved before the rest of the hold").toBe(false);
      await vi.advanceTimersByTimeAsync(15);
      expect(p.done(), "the rest of the hold, not a fresh one").toBe(true);
    });

    it(`${label}, skip: paused from the start, the hold doesn't begin until resume()`, async () => {
      const tl = tlOf(ev);
      const o = { speed: "skip", reducedMotion: false } as const;
      const H = await holdLength(tl, o);
      animator.pause();
      const p = start(tl, o);
      await vi.advanceTimersByTimeAsync(H * 5 + 1000);
      expect(p.done()).toBe(false);
      animator.resume();
      await vi.advanceTimersByTimeAsync(H - 5);
      expect(p.done(), "resolved before a full hold after resume").toBe(false);
      await vi.advanceTimersByTimeAsync(15);
      expect(p.done()).toBe(true);
    });
  }
});

describe("item 13, AC 12: after a possession flip restoreLast never redraws the old frame", () => {
  async function playToEnd(tl: Timeline): Promise<void> {
    const p = start(tl, { speed: "skip", reducedMotion: false });
    await vi.advanceTimersByTimeAsync(tl.holdMs + 50);
    expect(p.done()).toBe(true);
  }

  it("idle(scene, keepLast = false) then restoreLast(scene): the passed scene, empty of the old play", async () => {
    const tl = tlOf(KICKOFF_RETURN);
    await playToEnd(tl);
    animator.idle(sceneAway, false, false);
    drawn.frames.length = 0;
    drawn.fields.length = 0;
    animator.restoreLast(sceneAway);
    expect(drawn.fields.length).toBeGreaterThan(0);
    expect(drawn.fields[drawn.fields.length - 1]?.scene).toBe(sceneAway);
    expect(drawn.frames.some((f) => f.tl === tl), "the previous play's frame came back").toBe(false);
    // And the ball waits on the new spot, with no marks.
    const last = drawn.frames[drawn.frames.length - 1]?.tl as Timeline;
    expect(last.marks).toHaveLength(0);
    expect(last.los).toBe(sceneAway.los);
  });

  it("the same after a still Calling frame in between (Esc back to the first screen)", async () => {
    const tl = tlOf(KICKOFF_RETURN);
    await playToEnd(tl);
    animator.idle(sceneAway, false, false);
    const other = tlOf(KICKOFF_TOUCHBACK);
    animator.still(other, sceneAway, 0);
    drawn.frames.length = 0;
    animator.restoreLast(sceneAway);
    expect(drawn.frames.some((f) => f.tl === tl || f.tl === other)).toBe(false);
    expect(drawn.fields[drawn.fields.length - 1]?.scene).toBe(sceneAway);
  });

  it("control: with keepLast = true (no flip) restoreLast does bring the last play's frame back", async () => {
    const tl = tlOf(KICKOFF_RETURN);
    await playToEnd(tl);
    animator.idle(sceneHome, true, false);
    drawn.frames.length = 0;
    animator.restoreLast(sceneHome);
    expect(drawn.frames.some((f) => f.tl === tl && f.t === tl.total)).toBe(true);
  });
});

describe("U8 (a): a held Space or Enter (key repeat) is ignored", () => {
  // App needs the DOM to construct, so these call its key handler on a bare instance with only
  // the fields the handler reads before it acts (no DOM, no worker).
  async function bareApp(animating: boolean) {
    const { App } = await import("../src/ui/app");
    const app = Object.create(App.prototype) as Record<string, unknown>;
    const skip = vi.fn();
    const currentRows = vi.fn(() => []);
    Object.assign(app, {
      layoutNow: { tooSmall: false },
      fatal: null,
      loading: null,
      markCard: null,
      animating,
      animator: { skip, cycleSpeed: vi.fn(() => "1x") },
      settings: { speed: "1x" },
      currentRows,
    });
    const key = (k: string, repeat: boolean) => {
      const e = { key: k, repeat, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault: vi.fn() };
      (app["onKey"] as (e: unknown) => void).call(app, e);
      return e;
    };
    return { key, skip, currentRows };
  }

  it("during the play: a repeated Space or Enter doesn't skip; a fresh press does", async () => {
    const a = await bareApp(true);
    a.key(" ", true);
    a.key("Enter", true);
    expect(a.skip).not.toHaveBeenCalled();
    a.key(" ", false);
    expect(a.skip).toHaveBeenCalledTimes(1);
  });

  it("on a menu: a repeated Space or Enter doesn't reach the rows", async () => {
    const a = await bareApp(false);
    const e1 = a.key(" ", true);
    const e2 = a.key("Enter", true);
    expect(a.currentRows).not.toHaveBeenCalled();
    expect(e1.preventDefault).toHaveBeenCalled();
    expect(e2.preventDefault).toHaveBeenCalled();
  });
});
