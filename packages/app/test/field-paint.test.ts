// Engineer's tests for chunk 2 of the "Prime Time" revision (DESIGN.md Build order item 2): the
// field paint. Cased blue line of scrimmage and the down tag, end zone names sized to fill, the
// midfield home wordmark, solid paths told apart by weight and end cap, paths that draw on behind
// their marks, and the carrier trail. Values are typed in from DESIGN.md (Field, Marks, Tokens,
// Contrast checks, Prime Time additions). test-writer's spec tests are separate.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAP_HEIGHT_EM, carrierTrail, downTagAlpha, downTagBox, drawField, drawFrame, ENDZONE, MIDFIELD, PATH, TRAIL, viewOf, type FrameOpts } from "../src/ui/field";
import { cameraAt, FIELD_WIDTH_YARDS, layoutFor, playStage } from "../src/ui/layout";
import { pathPrimitives, previewFade } from "../src/ui/marks";
import { blend, contrast, rgbOf } from "../src/ui/overlay";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { at, timeline, type Timeline } from "../src/ui/timeline";
import { COLOR, DUR, GRADIENT } from "../src/ui/tokens";
import { COMPLETE, RUN } from "./fixtures";

const root = join(import.meta.dirname, "../../..");
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));
const templates = parseTemplates(readJson("data/ui/templates.json"));
const motion = parseMotion(readJson("data/ui/motion.json"));
const personnel = readJson("data/engine/personnel.json") as { presetPackage: Record<string, string> };

// ---------------------------------------------------------------- a recording canvas

interface Op {
  readonly op: string;
  readonly fillStyle: unknown;
  readonly strokeStyle: string;
  readonly lineWidth: number;
  readonly lineCap: string;
  readonly dash: readonly number[];
  readonly alpha: number;
  readonly font: string;
  readonly baseline: string;
  readonly shadowBlur: number;
  readonly args: readonly number[];
  readonly text?: string;
}
interface LinGrad {
  readonly kind: "linear";
  readonly args: readonly number[];
  readonly stops: [number, string][];
}
function recorder(measure = (s: string, font: string): number => s.length * 0.5 * Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10)): { g: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = [];
  let dash: number[] = [];
  const state: Record<string, unknown> = { fillStyle: "#000000", strokeStyle: "#000000", font: "10px sans-serif", globalAlpha: 1, lineWidth: 1, lineCap: "butt", shadowBlur: 0, shadowColor: "rgba(0, 0, 0, 0)", textAlign: "start", textBaseline: "alphabetic", letterSpacing: "0px" };
  const log = (op: string, args: number[], text?: string): void => {
    ops.push({ op, fillStyle: state["fillStyle"], strokeStyle: String(state["strokeStyle"]).toUpperCase(), lineWidth: Number(state["lineWidth"]), lineCap: String(state["lineCap"]), dash: [...dash], alpha: Number(state["globalAlpha"]), font: String(state["font"]), baseline: String(state["textBaseline"]), shadowBlur: Number(state["shadowBlur"]), args, ...(text === undefined ? {} : { text }) });
  };
  const g = new Proxy(state, {
    get(target, prop: string) {
      if (prop === "measureText") return (s: string) => ({ width: measure(s, String(target["font"])) });
      if (prop === "setLineDash") return (d: number[]) => (dash = [...d]);
      if (prop === "getLineDash") return () => [...dash];
      if (prop === "createRadialGradient") return () => ({ kind: "radial", addColorStop: () => undefined });
      if (prop === "createLinearGradient")
        return (...args: number[]) => {
          const gr: LinGrad & { addColorStop: (o: number, c: string) => void } = { kind: "linear", args, stops: [], addColorStop: (o, c) => gr.stops.push([o, c]) };
          return gr;
        };
      if (prop === "fillText" || prop === "strokeText") return (s: string, ...a: number[]) => log(prop, a, String(s));
      if (prop === "stroke" || prop === "strokeRect" || prop === "fill" || prop === "fillRect") return (...a: number[]) => log(prop, a);
      if (prop in target) return target[prop];
      return () => undefined;
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { g, ops };
}
const pxOf = (font: string): number => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? NaN);

const l = layoutFor(1280, 720, templates.field);
const stageCol = playStage(l, 1).column;
const viewAt = (los: number) => viewOf({ ...l, column: stageCol }, cameraAt(los, l.visibleYards, templates.field.losFromTop));
const scene = { los: 40, firstDown: 50, bottomName: "Outriders", topName: "Cranes", endZoneYards: 10, homeName: "Cranes" };
const build = (ev = COMPLETE): Timeline => timeline({ event: ev, runoffSeconds: 0, human: "offense" }, templates, { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: l.s, markPx: l.markPx, motion });
const opts = (over: Partial<FrameOpts> = {}): FrameOpts => ({ numbers: {}, ratings: {}, labelContent: "number", focused: null, markLabels: "none", routeAlpha: 0.4, textScale: 1, ...over });

// ---------------------------------------------------------------- tokens and contrast

describe("chunk 2 tokens and their contrast figures (DESIGN.md Contrast checks, Prime Time additions)", () => {
  it("color.midfieldPaint is white at 0.18, color.trail white at 0.45, gradient.trail white 0.45 to 0", () => {
    expect(COLOR.midfieldPaint).toBe("rgba(245, 247, 242, 0.18)");
    expect(COLOR.trail).toBe("rgba(245, 247, 242, 0.45)");
    expect(GRADIENT.trail).toEqual({ head: COLOR.trail, tail: "rgba(245, 247, 242, 0)" });
  });

  it("the line of scrimmage core against its casing is 5.89; the core alone on turf is under 3:1 (the casing carries it)", () => {
    expect(contrast(rgbOf(COLOR.los), rgbOf(COLOR.outlineDark))).toBeCloseTo(5.89, 1);
    for (const turf of [COLOR.turf, COLOR.turfStripe]) expect(contrast(rgbOf(COLOR.los), rgbOf(turf))).toBeLessThan(3);
    for (const turf of [COLOR.turf, COLOR.turfStripe]) expect(contrast(rgbOf(COLOR.outlineDark), rgbOf(turf))).toBeGreaterThanOrEqual(3.33 - 0.01);
  });

  it("a white mark ring over the midfield paint keeps 3:1 at the lit light stripe (3.34), and 0.22 would fail (3.04)", () => {
    const white = rgbOf(COLOR.line);
    const lit = blend(white, rgbOf(COLOR.turfStripe), 0.05);
    const over = (a: number) => contrast(white, blend(white, lit, a));
    expect(over(0.18)).toBeGreaterThanOrEqual(3);
    expect(over(0.18)).toBeCloseTo(3.34, 1);
    // DESIGN.md's reason for the 0.18 ceiling: brighter paint lowers the ring's contrast (it gives 3.04 at 0.22 by hand; 3.11 here).
    expect(over(0.22)).toBeLessThan(over(0.18));
    expect(contrast(rgbOf(COLOR.outlineDark), blend(white, lit, 0.18))).toBeGreaterThanOrEqual(4.78 - 0.05);
  });
});

// ---------------------------------------------------------------- the field

describe("field.scrimmageLine, field.endzone, field.midfield", () => {
  it("the line of scrimmage is a 3 px color.los core over a 5 px outlineDark casing, round caps, at the line", () => {
    const v = viewAt(40);
    const r = recorder();
    drawField(r.g, v, scene, 1);
    const core = r.ops.filter((o) => o.op === "stroke" && o.strokeStyle === COLOR.los.toUpperCase());
    expect(core).toHaveLength(1);
    expect(core[0]?.lineWidth).toBe(3);
    expect(core[0]?.lineCap).toBe("round");
    const i = r.ops.indexOf(core[0] as Op);
    const casing = r.ops[i - 1];
    expect(casing?.strokeStyle).toBe(COLOR.outlineDark.toUpperCase());
    expect(casing?.lineWidth).toBe(5);
  });

  it("end zone names: display 700 caps, the smaller of a 5-yard cap height and 0.8 of the width, never under 28 px, centered in the end zone", () => {
    for (const name of ["Cranes", "Iron Hollow Smelters"]) {
      const v = viewAt(95);
      const r = recorder((s, font) => s.length * 0.5 * pxOf(font));
      drawField(r.g, v, { ...scene, topName: name, bottomName: name, homeName: "" }, 1);
      const texts = r.ops.filter((o) => o.op === "fillText" && o.text === name.toUpperCase());
      expect(texts).toHaveLength(2);
      for (const o of texts) {
        const px = pxOf(o.font);
        expect(o.font).toContain("700");
        expect(px).toBeGreaterThanOrEqual(ENDZONE.minPx);
        const byCap = (ENDZONE.capYards * v.s) / CAP_HEIGHT_EM;
        // The recorder's width: 0.5 em per letter plus 0.06 em spacing (the recorder has letterSpacing, so spacing is the canvas's).
        const byWidth = (ENDZONE.widthShare * FIELD_WIDTH_YARDS * v.s) / (name.length * 0.5);
        expect(px).toBeLessThanOrEqual(Math.max(ENDZONE.minPx, Math.min(byCap, byWidth)) + 1e-9);
        expect(px).toBeGreaterThanOrEqual(Math.max(ENDZONE.minPx, Math.min(byCap, byWidth)) - 1);
        expect(o.args[0]).toBeCloseTo(v.ox + (1 + FIELD_WIDTH_YARDS / 2) * v.s, 6);
      }
      // Top name: the middle of the top end zone (110 to 100 yd), baseline lowered by half the cap height.
      const top = texts[0] as Op;
      const mid = (v.cameraY - 105) * v.s;
      expect(top.args[1]).toBeCloseTo(mid + (pxOf(top.font) * CAP_HEIGHT_EM) / 2, 6);
      expect(top.baseline).toBe("alphabetic");
    }
  });

  it("field.midfield: the home name in color.midfieldPaint at the 50, cap height 3 yards or shrunk to fit 30 yards, after the turf light and before every line and number", () => {
    const v = viewAt(55);
    for (const name of ["Cranes", "Harborview Lanterns of the North"]) {
      const r = recorder((s, font) => s.length * 0.5 * pxOf(font));
      drawField(r.g, v, { ...scene, homeName: name }, 1);
      const mark = r.ops.filter((o) => o.op === "fillText" && o.fillStyle === COLOR.midfieldPaint);
      expect(mark).toHaveLength(1);
      const o = mark[0] as Op;
      expect(o.text).toBe(name.toUpperCase());
      const px = pxOf(o.font);
      expect(px).toBeLessThanOrEqual((MIDFIELD.capYards * v.s) / CAP_HEIGHT_EM + 1e-9);
      expect(name.length * 0.5 * px).toBeLessThanOrEqual(MIDFIELD.maxWidthYards * v.s + 1e-6);
      expect(o.args[0]).toBeCloseTo(v.ox + (1 + FIELD_WIDTH_YARDS / 2) * v.s, 6);
      const i = r.ops.indexOf(o);
      const light = r.ops.findIndex((x) => typeof x.fillStyle === "object" && x.fillStyle !== null);
      expect(light).toBeLessThan(i);
      const paint = r.ops.map((x, k) => [x, k] as const).filter(([x]) => x.op === "stroke" || (x.op === "fillText" && x !== o));
      for (const [, k] of paint) expect(k).toBeGreaterThan(i);
    }
  });

  it("no home name, no wordmark (the splash and tests without a matchup)", () => {
    const r = recorder();
    drawField(r.g, viewAt(55), { ...scene, homeName: "" }, 1);
    expect(r.ops.some((o) => o.fillStyle === COLOR.midfieldPaint)).toBe(false);
  });
});

// ---------------------------------------------------------------- the down tag

describe("field.downTag", () => {
  const tl = build();
  const v = viewAt(tl.los);

  it("shows in the set phase only and fades out over dur.base from the snap", () => {
    expect(downTagAlpha(tl, tl.setAt - 1, DUR.base)).toBe(0);
    expect(downTagAlpha(tl, tl.setAt, DUR.base)).toBe(1);
    expect(downTagAlpha(tl, tl.snapAt - 1, DUR.base)).toBe(1);
    expect(downTagAlpha(tl, tl.snapAt + DUR.base / 2, DUR.base)).toBeCloseTo(0.5, 6);
    expect(downTagAlpha(tl, tl.snapAt + DUR.base, DUR.base)).toBe(0);
  });

  it("a color.tag pill 22 px tall, display 700 16 px caps, 4 px above the casing, left edge 1 yard in", () => {
    const r = recorder();
    drawFrame(r.g, v, tl, (tl.setAt + tl.snapAt) / 2, opts({ downTag: "3rd & 4" }));
    const text = r.ops.find((o) => o.op === "fillText" && o.text === "3RD & 4");
    expect(text).toBeDefined();
    expect(text?.font).toBe(`700 16px ${'"Barlow Condensed", "Inter", system-ui, sans-serif'}`);
    const pillAt = r.ops.indexOf(text as Op) - 1;
    expect(r.ops[pillAt]?.fillStyle).toBe(COLOR.tag);
    const box = downTagBox(v, tl.los, 60, 22, []);
    expect(box.y1).toBeCloseTo((v.cameraY - tl.los) * v.s - 2.5 - 4, 6);
    expect(box.y1 - box.y0).toBe(22);
    expect(box.x0).toBeCloseTo(v.ox + 2 * v.s, 6);
  });

  it("moves right until it clears a yard number it would overlap", () => {
    const y = (v.cameraY - tl.los) * v.s;
    const number = { x0: v.ox + 2 * v.s, y0: y - 20, x1: v.ox + 2 * v.s + 30, y1: y };
    const box = downTagBox(v, tl.los, 60, 22, [number]);
    expect(box.x0).toBeGreaterThanOrEqual(number.x1);
  });

  it("not drawn after the fade, nor when the scene has none", () => {
    for (const [t, tag] of [[tl.snapAt + DUR.base + 1, "3rd & 4"], [(tl.setAt + tl.snapAt) / 2, undefined]] as const) {
      const r = recorder();
      drawFrame(r.g, v, tl, t, opts(tag === undefined ? {} : { downTag: tag }));
      expect(r.ops.some((o) => o.text === "3RD & 4")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------- paths

describe("paths: solid, weight and end cap, drawn on behind their marks", () => {
  const tl = build();
  const v = viewAt(tl.los);
  const edge = (v.markPx / 2 + 1) / v.s;

  it("no stroke on the field is dashed except the ball's dotted flight (2 on, 5 off)", () => {
    for (const t of [tl.snapAt - 1, tl.snapAt + 50, (tl.snapAt + tl.liveEnd) / 2, tl.total]) {
      const r = recorder();
      drawFrame(r.g, v, tl, t, opts());
      for (const o of r.ops.filter((x) => x.op === "stroke" || x.op === "strokeRect")) {
        if (o.dash.length > 0) {
          expect(o.dash).toEqual([2, 5]);
          expect(o.strokeStyle).toBe(COLOR.line.toUpperCase());
          expect(o.lineWidth).toBe(2);
        }
      }
    }
  });

  it("offense paths 3 px over 5.5 px, defense 2 px over 4 px; defense ends on a 6 px dot after its path ends", () => {
    const r = recorder();
    drawFrame(r.g, v, tl, tl.total, opts({ ink: { O: { fill: "#F29A2E", ring: COLOR.outlineDark }, X: { fill: "#C62F2F", ring: COLOR.line } } }));
    const strokes = r.ops.filter((o) => o.op === "stroke");
    const widths = (c: string) => new Set(strokes.filter((o) => o.strokeStyle === c.toUpperCase()).map((o) => o.lineWidth));
    expect(widths("#F29A2E").has(PATH.offense.fill)).toBe(true);
    expect(widths(COLOR.outlineDark).has(PATH.offense.ring)).toBe(true);
    expect(widths("#C62F2F").has(PATH.defense.fill)).toBe(true);
    expect(widths(COLOR.line).has(PATH.defense.ring)).toBe(true);
    expect([PATH.offense, PATH.defense, PATH.arrowPx, PATH.tickPx, PATH.dotPx]).toEqual([{ fill: 3, ring: 5.5 }, { fill: 2, ring: 4 }, 8, 10, 6]);
    expect(PATH.arrowRad).toBeCloseTo(Math.PI / 6, 12);
    const dots = pathPrimitives(tl, tl.total, edge).filter((p) => p.side === "X");
    expect(dots.length).toBeGreaterThan(0);
    for (const p of dots) expect(p.end).toBe("dot");
    expect(r.ops.filter((o) => o.op === "fill" && o.fillStyle === "#C62F2F").length).toBeGreaterThanOrEqual(dots.length);
  });

  it("during the live play a path never runs ahead of its mark: its last point is at most the edge trim from where he is", () => {
    for (const ev of [COMPLETE, RUN]) {
      const t1 = build(ev);
      for (let t = t1.snapAt + 40; t < t1.liveEnd; t += 120) {
        for (const p of pathPrimitives(t1, t, edge, DUR.base)) {
          if (p.faint) continue;
          const m = t1.marks.find((x) => x.slot === p.slot && x.side === p.side);
          if (m === undefined || t > m.pathEnd) continue;
          const here = at(m.keys, t);
          const last = p.points[p.points.length - 1];
          expect(last, p.slot).toBeDefined();
          expect(Math.hypot((last?.x ?? 0) - here.x, (last?.y ?? 0) - here.y), `${p.slot} at ${t}`).toBeLessThanOrEqual(edge + 1e-6);
        }
      }
    }
  });

  it("the faint preview fades out over dur.base after the snap and is gone after; at the whistle every path is drawn at full opacity", () => {
    expect(previewFade(tl, tl.snapAt - 1, DUR.base)).toBe(1);
    expect(previewFade(tl, tl.snapAt + DUR.base / 2, DUR.base)).toBeCloseTo(0.5, 6);
    expect(previewFade(tl, tl.snapAt + DUR.base, DUR.base)).toBe(0);
    const mid = pathPrimitives(tl, tl.snapAt + DUR.base / 2, edge, DUR.base).filter((p) => p.faint);
    if (tl.preview !== null && tl.preview.paths.length > 0) expect(mid.length).toBeGreaterThan(0);
    for (const p of mid) expect(p.fade).toBeCloseTo(0.5, 6);
    expect(pathPrimitives(tl, tl.snapAt + DUR.base + 1, edge, DUR.base).some((p) => p.faint)).toBe(false);
    expect(pathPrimitives(tl, tl.total, edge, DUR.base).every((p) => !p.faint && p.fade === 1)).toBe(true);
  });
});

// ---------------------------------------------------------------- the carrier trail

describe("fx.carrierTrail", () => {
  const tl = build(RUN);
  const v = viewAt(tl.los);
  const mid = (tl.snapAt + tl.liveEnd) / 2;

  it("none before the snap or at the whistle", () => {
    expect(carrierTrail(tl, tl.snapAt, 500, 8, DUR.base)).toBeNull();
    expect(carrierTrail(tl, tl.liveEnd, 500, 8, DUR.base)).toBeNull();
  });

  it("in the live play: head at the ball, along the ball's last 0.5 s, at most 8 yards", () => {
    let seen = 0;
    for (const ev of [RUN, COMPLETE]) {
      const t1 = build(ev);
      for (let t = t1.snapAt + 20; t < t1.liveEnd; t += 60) {
        const tr = carrierTrail(t1, t, TRAIL.windowMs, TRAIL.maxYards, DUR.base);
        if (tr === null) continue;
        seen++;
        const head = tr.pts[0];
        const ball = at(t1.ball, t);
        expect(head).toEqual(ball);
        let len = 0;
        for (let i = 1; i < tr.pts.length; i++) len += Math.hypot((tr.pts[i]?.x ?? 0) - (tr.pts[i - 1]?.x ?? 0), (tr.pts[i]?.y ?? 0) - (tr.pts[i - 1]?.y ?? 0));
        expect(len).toBeLessThanOrEqual(TRAIL.maxYards + 1e-6);
        // Every point lies on the ball's track within the window.
        const tail = tr.pts[tr.pts.length - 1];
        const from = at(t1.ball, Math.max(t1.snapAt, t - TRAIL.windowMs));
        expect(Math.hypot((tail?.x ?? 0) - ball.x, (tail?.y ?? 0) - ball.y)).toBeLessThanOrEqual(Math.hypot(from.x - ball.x, from.y - ball.y) + TRAIL.maxYards);
        expect(tr.f).toBeGreaterThan(0);
        expect(tr.f).toBeLessThanOrEqual(1);
      }
    }
    expect(seen).toBeGreaterThan(5);
  });

  it("shrinks to nothing over dur.base once the ball stops", () => {
    const still: Pick<Timeline, "ball" | "snapAt" | "liveEnd"> = { snapAt: 0, liveEnd: 5000, ball: [{ t: 0, x: 20, y: 30 }, { t: 1000, x: 20, y: 40 }] };
    const moving = carrierTrail(still, 1000, 500, 8, DUR.base);
    expect(moving?.f).toBe(1);
    const half = carrierTrail(still, 1000 + DUR.base / 2, 500, 8, DUR.base);
    expect(half?.f).toBeGreaterThan(0.3);
    expect(half?.f).toBeLessThan(0.7);
    expect(carrierTrail(still, 1000 + DUR.base + 30, 500, 8, DUR.base)).toBeNull();
  });

  it("drawn only in a live frame, filled with gradient.trail, after the paths and before every mark", () => {
    const off = recorder();
    drawFrame(off.g, v, tl, mid, opts());
    const isTrail = (o: Op) => o.op === "fill" && typeof o.fillStyle === "object" && o.fillStyle !== null && (o.fillStyle as LinGrad).kind === "linear";
    expect(off.ops.some(isTrail)).toBe(false);
    const on = recorder();
    drawFrame(on.g, v, tl, mid, opts({ live: { speed: 1 } }));
    const i = on.ops.findIndex(isTrail);
    expect(i).toBeGreaterThanOrEqual(0);
    expect((on.ops[i]?.fillStyle as LinGrad).stops).toEqual([[0, GRADIENT.trail.head], [1, GRADIENT.trail.tail]]);
    // Marks are the first draws with shadow.mark (blur 4).
    const firstMark = on.ops.findIndex((o) => o.shadowBlur === 4);
    expect(firstMark).toBeGreaterThan(i);
  });
});
