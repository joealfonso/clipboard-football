// Engineer's tests for the moment hold in the animator (DESIGN.md Moments, Prime Time chunk 3): the
// whistle hold becomes the larger of its own and the moment's, 2x halves it, Space ends it at once,
// Skip keeps a banner's minimum, reduced motion adds none, and the bug's change (onMoment) comes on
// the frame the banner's sub line appears. Stub canvas and fake timers, as the U8 animator tests.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Animator } from "../src/ui/animator";
import type { FieldScene, FrameOpts } from "../src/ui/field";
import { layoutFor } from "../src/ui/layout";
import { momentEnd, NO_MOMENT, playMoment, type Moment } from "../src/ui/moments";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { timeline, type Timeline } from "../src/ui/timeline";
import { uiDataOf } from "../src/engine/session";
import { TOUCHDOWN } from "./fixtures";
import { prepared } from "./support";

const root = join(import.meta.dirname, "../../..");
const read = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));
const templates = parseTemplates(read("data/ui/templates.json"));
const motion = parseMotion(read("data/ui/motion.json"));
const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };
const layout = layoutFor(1280, 720, templates.field);
const rules = uiDataOf(prepared(), null, null).rules;

const opts: FrameOpts = { numbers: {}, ratings: {}, labelContent: "number", focused: null, markLabels: "none", routeAlpha: 1, textScale: 1 };
const scene: FieldScene = { los: 40, firstDown: null, bottomName: "Outriders", topName: "Cranes", endZoneYards: 10 };
const tl: Timeline = timeline({ event: TOUCHDOWN, runoffSeconds: 0 }, templates, { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: layout.s, markPx: layout.markPx, motion });
const td: Moment = playMoment(TOUCHDOWN, { teams: { home: { nickname: "Outriders" }, away: { nickname: "Cranes" } }, human: "home", endZoneYards: 10, penalties: rules.penalties, moments: motion.moments });

function stubCtx(): CanvasRenderingContext2D {
  const state: Record<string, unknown> = {};
  return new Proxy(state, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === "measureText") return (s: string) => ({ width: s.length * 7 });
      return () => undefined;
    },
    set(t, k: string, v: unknown) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

let animator: Animator;
beforeEach(() => {
  const g = globalThis as Record<string, unknown>;
  g["window"] = { devicePixelRatio: 1 };
  g["requestAnimationFrame"] = (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16);
  g["cancelAnimationFrame"] = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
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

function start(o: { speed: "1x" | "2x" | "skip"; reducedMotion: boolean }, moment: Moment = td) {
  let resolvedAt: number | null = null;
  let toldAt: number | null = null;
  const t0 = performance.now();
  void animator.play(tl, scene, { ...o, onClock: () => undefined, moment: { moment, ink: null }, onMoment: () => (toldAt ??= performance.now()) }).then(() => (resolvedAt = performance.now()));
  return { t0, resolved: () => resolvedAt, told: () => toldAt };
}

describe("the moment hold", () => {
  it("the touchdown fixture's own hold is shorter than the moment's (so the moment decides it)", () => {
    expect(tl.total - tl.liveEnd).toBeLessThan(td.minHoldMs);
    expect(momentEnd(tl, td)).toBe(tl.liveEnd + 1800);
  });

  it("1x: resolves once the moment's hold has run from the whistle; the bug changes 320 ms after the whistle", async () => {
    const p = start({ speed: "1x", reducedMotion: false });
    await vi.advanceTimersByTimeAsync(tl.liveEnd + 1800 - 100);
    expect(p.resolved()).toBeNull();
    const told = p.told();
    expect(told).not.toBeNull();
    expect((told as number) - p.t0).toBeGreaterThanOrEqual(tl.liveEnd + 320 - 1);
    expect((told as number) - p.t0).toBeLessThan(tl.liveEnd + 320 + 50);
    await vi.advanceTimersByTimeAsync(200);
    expect(p.resolved()).not.toBeNull();
  });

  it("2x halves every figure", async () => {
    const p = start({ speed: "2x", reducedMotion: false });
    await vi.advanceTimersByTimeAsync((tl.liveEnd + 1800) / 2 + 100);
    expect(p.resolved()).not.toBeNull();
    expect((p.resolved() as number) - p.t0).toBeGreaterThanOrEqual((tl.liveEnd + 1800) / 2 - 20);
  });

  it("2x: the banner's own motion stays wall-clock: the bug changes 320 wall ms after the whistle", async () => {
    const p = start({ speed: "2x", reducedMotion: false });
    await vi.advanceTimersByTimeAsync(tl.liveEnd / 2 + 600);
    const told = (p.told() as number) - p.t0;
    expect(told).toBeGreaterThanOrEqual(tl.liveEnd / 2 + 320 - 20);
    expect(told).toBeLessThan(tl.liveEnd / 2 + 320 + 40);
  });

  it("Space mid-play at 2x keeps half the banner's minimum hold (900 ms); Skip speed keeps all of it", async () => {
    expect(Math.max(tl.holdMs, tl.settleMs, templates.timing.holdMs)).toBeLessThan(900);
    const p = start({ speed: "2x", reducedMotion: false });
    await vi.advanceTimersByTimeAsync(200);
    animator.skip();
    await vi.advanceTimersByTimeAsync(20);
    const from = performance.now();
    await vi.advanceTimersByTimeAsync(900 - 40);
    expect(p.resolved()).toBeNull();
    await vi.advanceTimersByTimeAsync(80);
    expect(p.resolved()).not.toBeNull();
    expect((p.resolved() as number) - from).toBeLessThan(1000);
  });

  it("Space during the moment hold ends it at once", async () => {
    const p = start({ speed: "1x", reducedMotion: false });
    await vi.advanceTimersByTimeAsync(tl.liveEnd + 500);
    expect(p.resolved()).toBeNull();
    animator.skip();
    await vi.advanceTimersByTimeAsync(40);
    expect(p.resolved()).not.toBeNull();
    expect((p.resolved() as number) - p.t0).toBeLessThan(tl.liveEnd + 600);
  });

  it("Skip shows the end state at once (the bug too) and keeps the banner's minimum hold", async () => {
    const p = start({ speed: "skip", reducedMotion: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(p.told()).toBe(p.t0);
    await vi.advanceTimersByTimeAsync(1800 - 10);
    expect(p.resolved()).toBeNull();
    await vi.advanceTimersByTimeAsync(20);
    expect(p.resolved()).not.toBeNull();
  });

  it("reduced motion: the end state at once and no hold added for the moment", async () => {
    const plain = start({ speed: "skip", reducedMotion: true }, NO_MOMENT);
    await vi.advanceTimersByTimeAsync(5000);
    const base = (plain.resolved() as number) - plain.t0;
    const p = start({ speed: "skip", reducedMotion: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(p.told()).toBe(p.t0);
    await vi.advanceTimersByTimeAsync(5000);
    expect((p.resolved() as number) - p.t0).toBe(base);
  });
});

describe("replayMoment: a play shown during a pending request fires its committed moment afterwards", () => {
  async function shown(): Promise<void> {
    const p = start({ speed: "skip", reducedMotion: true }, NO_MOMENT);
    await vi.advanceTimersByTimeAsync(5000);
    expect(p.resolved()).not.toBeNull();
  }
  function replay(o: { speed: "1x" | "2x" | "skip"; reducedMotion: boolean }, moment: Moment = td) {
    let resolvedAt: number | null = null;
    let toldAt: number | null = null;
    const t0 = performance.now();
    void animator.replayMoment({ moment, ink: null }, { ...o, onMoment: () => (toldAt ??= performance.now()) }).then(() => (resolvedAt = performance.now()));
    return { t0, resolved: () => resolvedAt, told: () => toldAt };
  }

  it("1x: the banner runs on the shown whistle frame; the bug changes at 320 ms; it holds the moment's minimum", async () => {
    await shown();
    const p = replay({ speed: "1x", reducedMotion: false });
    await vi.advanceTimersByTimeAsync(400);
    expect((p.told() as number) - p.t0).toBeGreaterThanOrEqual(320);
    expect((p.told() as number) - p.t0).toBeLessThan(360);
    await vi.advanceTimersByTimeAsync(1300);
    expect(p.resolved()).toBeNull();
    await vi.advanceTimersByTimeAsync(150);
    expect(p.resolved()).not.toBeNull();
  });

  it("2x halves the hold; Space ends it at once", async () => {
    await shown();
    const p = replay({ speed: "2x", reducedMotion: false });
    await vi.advanceTimersByTimeAsync(960);
    expect(p.resolved()).not.toBeNull();
    const q = replay({ speed: "1x", reducedMotion: false });
    await vi.advanceTimersByTimeAsync(100);
    animator.skip();
    await vi.advanceTimersByTimeAsync(40);
    expect(q.resolved()).not.toBeNull();
  });

  it("Skip: the end state at once, the banner's full minimum; reduced motion: at once, no hold", async () => {
    await shown();
    const p = replay({ speed: "skip", reducedMotion: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(p.told()).toBe(p.t0);
    await vi.advanceTimersByTimeAsync(1790);
    expect(p.resolved()).toBeNull();
    await vi.advanceTimersByTimeAsync(20);
    expect(p.resolved()).not.toBeNull();
    const r = replay({ speed: "1x", reducedMotion: true });
    await vi.advanceTimersByTimeAsync(5);
    expect(r.told()).toBe(r.t0);
    expect(r.resolved()).not.toBeNull();
  });

  it("no moment: nothing to show, the bug changes at once", async () => {
    await shown();
    const p = replay({ speed: "1x", reducedMotion: false }, NO_MOMENT);
    await vi.advanceTimersByTimeAsync(0);
    expect(p.told()).toBe(p.t0);
    expect(p.resolved()).not.toBeNull();
  });
});
