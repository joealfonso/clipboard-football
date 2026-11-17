// Engineer's checks for two code-review flags on the Broadcast build, and the rail's snap phase:
// - the player card on the play screen is placed from the drawn stage, never on the field column
//   when there is room beside it, and never over the player whose card it is;
// - the score bug's fit steps keep score, clock and down and distance to the last (U5);
// - the animator reports the snap once, before a play resolves (the rail's This play card).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Animator } from "../src/ui/animator";
import type { FieldScene, FrameOpts } from "../src/ui/field";
import { layoutFor, playStage, type Box } from "../src/ui/layout";
import { CARD_FLOAT_WIDTH, floatingCardPlacement, OVERLAY_MARGIN, playCardPlacement, type CardBox } from "../src/ui/overlay";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { timeline } from "../src/ui/timeline";
import { fitBar, TOP_BAR_FIT_STEPS } from "../src/ui/topbar";
import { COMPLETE, INTERCEPTION, KICKOFF_TOUCHBACK } from "./fixtures";

const root = join(import.meta.dirname, "../../..");
const read = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));
const templates = parseTemplates(read("data/ui/templates.json"));
const motion = parseMotion(read("data/ui/motion.json"));
const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };

/** The column in window px (the canvas starts under the top bar at x 0). */
const columnRect = (col: Box, top: number): Box => ({ left: col.left, top, width: col.width, height: col.height });
const intersects = (a: CardBox, b: Box): boolean => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.maxHeight;

describe("the player card on the play screen (code review flag 1)", () => {
  const windows = [
    [1280, 720],
    [1200, 800],
    [1024, 600],
    [800, 536],
    [1920, 1080],
    [1440, 900],
  ] as const;

  for (const [w, hgt] of windows) {
    for (const scale of [1, 1.25, 2]) {
      it(`${w}x${hgt} at ${scale * 100}%: with a rail the card sits over the rail, at its width and top, and never on the drawn column`, () => {
        const l = layoutFor(w, hgt, templates.field);
        const stage = playStage(l, scale);
        const card = playCardPlacement(stage);
        const col = columnRect(stage.column, l.field.top);
        if (stage.rail === null) {
          expect(card).toBeNull();
          return;
        }
        expect(card).not.toBeNull();
        const c = card as CardBox;
        expect(intersects(c, col), JSON.stringify({ c, col })).toBe(false);
        expect(c.left).toBe(stage.rail.left);
        expect(c.width).toBe(stage.rail.width);
        expect(c.top).toBe(stage.rail.top);
        expect(c.left + c.width).toBeLessThanOrEqual(w);
      });
    }
  }

  it("the drawn stage has a rail at 1280x720 and 1024x600, and none at 1200x800 or 800x536", () => {
    expect(playStage(layoutFor(1280, 720, templates.field), 1).rail).not.toBeNull();
    expect(playStage(layoutFor(1024, 600, templates.field), 1).rail).not.toBeNull();
    expect(playStage(layoutFor(1200, 800, templates.field), 1).rail).toBeNull();
    expect(playStage(layoutFor(800, 536, templates.field), 1).rail).toBeNull();
  });

  // Why the card floats without a rail: no margin beside the centered column holds even the 280 px card.
  it("without a rail no margin beside the centered column holds a CARD_FLOAT_WIDTH card (so it has to float)", () => {
    for (const [w, hgt] of windows) {
      for (const scale of [1, 1.25, 1.5, 2]) {
        const l = layoutFor(w, hgt, templates.field);
        const stage = playStage(l, scale);
        if (stage.rail !== null) continue;
        const margin = Math.max(stage.column.left, w - stage.column.left - stage.column.width);
        expect(margin - 2 * OVERLAY_MARGIN, `${w}x${hgt} at ${scale}`).toBeLessThan(CARD_FLOAT_WIDTH);
      }
    }
  });

  it("floating (1200x800, 800x536): the card never covers the player whose card it is, anywhere across the column", () => {
    for (const [w, hgt] of [[1200, 800], [800, 536]] as const) {
      const l = layoutFor(w, hgt, templates.field);
      const stage = playStage(l, 1);
      const r = l.markPx / 2;
      for (let x = stage.column.left + r; x <= stage.column.left + stage.column.width - r; x += 4) {
        const c = floatingCardPlacement(l, x);
        const covers = x + r > c.left && x - r < c.left + c.width;
        expect(covers, `${w}x${hgt}, mark at x ${x}: card ${c.left} to ${c.left + c.width}`).toBe(false);
        // DESIGN.md Broadcast build review 7: min(280px, field width - 16px), 8 px from the window edge, 8 px under the top bar.
        expect(c.width).toBe(Math.min(280, w - 16));
        expect(c.left === OVERLAY_MARGIN || c.left + c.width === w - OVERLAY_MARGIN).toBe(true);
        expect(c.top).toBe(l.field.top + 8);
      }
    }
  });
});

describe("the score bug's fit steps (code review flag 2, U5)", () => {
  const css = readFileSync(join(root, "packages/app/src/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("DESIGN.md's three come first, in its order, then the rest; nine steps, each a class styles.css styles", () => {
    expect(TOP_BAR_FIT_STEPS.slice(0, 3)).toEqual(["fit-1", "fit-2", "fit-3"]);
    expect(TOP_BAR_FIT_STEPS).toHaveLength(9);
    for (const s of TOP_BAR_FIT_STEPS) expect(css, s).toMatch(new RegExp(`\\.top-bar\\.${s}\\b`));
  });

  it("no fit step hides or shrinks away the score, the clock or the down and distance", () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: (m[1] ?? "").trim(), body: m[2] ?? "" }));
    const fitRules = rules.filter((r) => /\.top-bar\.fit-\d+/.test(r.sel));
    expect(fitRules.length).toBeGreaterThan(0);
    for (const r of fitRules) {
      for (const part of r.sel.split(",")) {
        expect(part, r.sel).not.toMatch(/\.(score|clock|bar-dd|bar-spot|situation|game|poss)(?![\w-])/);
        if (/\.cell\b/.test(part)) expect(r.body).not.toMatch(/display:\s*none|clip-path|width:\s*1px/);
      }
    }
    // The last size step keeps the bug's type at 85%, not smaller; then names go to 16 px, never cut or hidden.
    expect(css).toMatch(/\.top-bar\.fit-8\s*\{\s*--bar-scale:\s*0\.85;/);
    expect(css).toMatch(/\.top-bar\.fit-9 \.name\s*\{\s*font-size:\s*calc\(16px \* var\(--bar-scale\)\);\s*\}/);
    for (const r of fitRules) {
      if (!/\.(name|team-name|team-id)(?![\w-])/.test(r.sel)) continue;
      expect(r.body, r.sel).not.toMatch(/display:\s*none|clip-path|max-width|text-overflow|width:\s*1px/);
    }
  });

  it("fitBar adds steps in order only while the bar overflows", () => {
    const added: string[] = [];
    let width = 1000;
    const out = fitBar(
      () => width > 800,
      (s) => {
        added.push(s);
        width -= 70;
      },
    );
    expect(out).toEqual(["fit-1", "fit-2", "fit-3"]);
    expect(added).toEqual(out);
    expect(fitBar(() => false, () => undefined)).toEqual([]);
    expect(fitBar(() => true, () => undefined)).toEqual([...TOP_BAR_FIT_STEPS]);
  });

  it("the bar's type follows the text size only up to 125%, so the 64 px bar holds it at 200%", () => {
    expect(css).toMatch(/--bar-scale:\s*min\(var\(--text-scale\),\s*1\.25\)/);
    const topBarSection = css.slice(css.indexOf(".top-bar {"), css.indexOf(".chip {"));
    expect(topBarSection).not.toContain("var(--text-scale))");
  });
});

describe("the rail's phase: the animator reports the snap once, before a play resolves", () => {
  const layout = layoutFor(1280, 720, templates.field);
  const opts: FrameOpts = { numbers: {}, ratings: {}, labelContent: "number", focused: null, markLabels: "involved", routeAlpha: 1, textScale: 1 };
  const scene: FieldScene = { los: 35, firstDown: null, bottomName: "Home", topName: "Away", endZoneYards: 10 };
  let animator: Animator;

  beforeEach(() => {
    const g = globalThis as Record<string, unknown>;
    g["window"] = { devicePixelRatio: 1 };
    g["requestAnimationFrame"] = (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16);
    g["cancelAnimationFrame"] = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : k === "measureText" ? (s: string) => ({ width: s.length * 7 }) : () => undefined),
      set: (t, k: string, v: unknown) => ((t[k] = v), true),
    }) as unknown as CanvasRenderingContext2D;
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

  for (const [name, ev] of [["interception", INTERCEPTION], ["completion", COMPLETE], ["touchback", KICKOFF_TOUCHBACK]] as const) {
    for (const o of [{ speed: "1x", reducedMotion: false }, { speed: "skip", reducedMotion: false }, { speed: "1x", reducedMotion: true }] as const) {
      it(`${name}, ${o.speed}${o.reducedMotion ? " reduced motion" : ""}: the snap is reported once, at the timeline's snap, before the play resolves`, async () => {
        const tl = timeline({ event: ev, runoffSeconds: 0 }, templates, { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: layout.s, markPx: layout.markPx, motion });
        const snaps: number[] = [];
        let resolvedAt: number | null = null;
        const t0 = performance.now();
        void animator.play(tl, scene, { ...o, onClock: () => undefined, onSnap: () => snaps.push(performance.now() - t0) }).then(() => (resolvedAt = performance.now() - t0));
        await vi.advanceTimersByTimeAsync(tl.total + 10000);
        expect(resolvedAt).not.toBeNull();
        expect(snaps).toHaveLength(1);
        expect(snaps[0] as number).toBeLessThan(resolvedAt as unknown as number);
        if (o.speed === "1x" && !o.reducedMotion) expect(snaps[0] as number).toBeGreaterThanOrEqual(tl.snapAt - 20);
      });
    }
  }
});
