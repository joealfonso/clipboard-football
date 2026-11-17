// Spec tests for chunk 2 of the "Prime Time" revision in DESIGN.md (art-director, 2026-11-15), written
// by test-writer from DESIGN.md, not the implementation. "Build order (Prime Time)" item 2: the cased
// blue line of scrimmage and the down tag; end zone names sized to fill; the midfield wordmark; solid
// paths by weight and end cap and solid zone edges; paths that draw on behind their runners; the
// carrier trail. Every expected value is typed in from DESIGN.md (Tokens, Field, Marks, Motion).
//
// Checked through what runs in node: drawField and drawFrame against a recording canvas written here
// (it keeps the path geometry of every stroke and fill, the state at each draw, and gradients; its
// measureText is proportional to the font size so text sizing can be checked), the pure timeline,
// and the Animator driven with a fake canvas and a hand-stepped requestAnimationFrame.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Animator } from "../src/ui/animator";
import { drawField, drawFrame, viewOf, type FieldInk, type FieldScene, type FrameOpts, type View } from "../src/ui/field";
import { cameraAt, FIELD_WIDTH_YARDS, layoutFor, playStage, type Layout } from "../src/ui/layout";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { at, timeline, type Timeline } from "../src/ui/timeline";
import { COLOR, DUR } from "../src/ui/tokens";
import type { PlayEvent } from "../src/engine/types";
import { ALL_FIXTURES, COMPLETE, RUN } from "./fixtures";

const root = join(import.meta.dirname, "../../..");
const appDir = join(import.meta.dirname, "..");
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));
const templates = parseTemplates(readJson("data/ui/templates.json"));
const motion = parseMotion(readJson("data/ui/motion.json"));
const personnel = readJson("data/engine/personnel.json") as { presetPackage: Record<string, string> };
const css = readFileSync(join(appDir, "src/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// ---------------------------------------------------------------- colors

type Rgba = [number, number, number, number];
function rgba(s: string): Rgba {
  const t = s.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(t);
  if (hex) {
    const n = hex[1] as string;
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16), 1];
  }
  const m = /^rgba?\(([^)]*)\)$/i.exec(t);
  if (!m) throw new Error(`not a color: ${s}`);
  const p = (m[1] as string).split(",").map((x) => Number(x.trim()));
  return [p[0] as number, p[1] as number, p[2] as number, p[3] ?? 1];
}
const same = (a: unknown, b: string): boolean => typeof a === "string" && /^(#|rgb)/i.test(a) && JSON.stringify(rgba(a)) === JSON.stringify(rgba(b));

// ---------------------------------------------------------------- a recording canvas that keeps geometry

interface Pt {
  readonly x: number;
  readonly y: number;
}
interface Arc {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}
interface Sub {
  pts: Pt[];
  arcs: Arc[];
}
interface Op {
  readonly i: number;
  readonly op: string;
  readonly fillStyle: unknown;
  readonly strokeStyle: unknown;
  readonly lineWidth: number;
  readonly lineCap: string;
  readonly lineJoin: string;
  readonly dash: readonly number[];
  readonly alpha: number;
  readonly font: string;
  readonly letterSpacing: string;
  readonly textAlign: string;
  readonly shadowBlur: number;
  readonly args: readonly number[];
  readonly text?: string;
  /** The current path's subpaths at a stroke or fill. */
  readonly subs: readonly Sub[];
}
interface LinGrad {
  readonly args: readonly number[];
  readonly stops: [number, string][];
}

function fontPx(font: string): number {
  return Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
}
function emOf(spacing: string, px: number): number {
  const em = /^(-?\d*\.?\d+)em$/.exec(spacing);
  if (em) return Number(em[1]) * px;
  const p = /^(-?\d*\.?\d+)px$/.exec(spacing);
  return p ? Number(p[1]) : 0;
}
/** The recorder's text width: 0.5 em per character plus the letter-spacing per character (as a real canvas counts it). */
const textWidth = (s: string, font: string, spacing: string): number => s.length * (0.5 * fontPx(font) + emOf(spacing, fontPx(font)));

function recorder(): { g: CanvasRenderingContext2D; ops: Op[]; lin: LinGrad[]; transforms: string[] } {
  const ops: Op[] = [];
  const lin: LinGrad[] = [];
  const transforms: string[] = [];
  let dash: number[] = [];
  let subs: Sub[] = [];
  const cur = (): Sub => {
    if (subs.length === 0) subs.push({ pts: [], arcs: [] });
    return subs[subs.length - 1] as Sub;
  };
  const fresh: Record<string, unknown> = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    font: "10px sans-serif",
    letterSpacing: "0px",
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    shadowBlur: 0,
    shadowColor: "rgba(0, 0, 0, 0)",
    shadowOffsetY: 0,
    textAlign: "start",
    textBaseline: "alphabetic",
  };
  const state: Record<string, unknown> = { ...fresh };
  const stack: Record<string, unknown>[] = [];
  const log = (op: string, args: number[], text?: string): void => {
    ops.push({
      i: ops.length,
      op,
      fillStyle: state["fillStyle"],
      strokeStyle: state["strokeStyle"],
      lineWidth: Number(state["lineWidth"]),
      lineCap: String(state["lineCap"]),
      lineJoin: String(state["lineJoin"]),
      dash: [...dash],
      alpha: Number(state["globalAlpha"]),
      font: String(state["font"]),
      letterSpacing: String(state["letterSpacing"]),
      textAlign: String(state["textAlign"]),
      shadowBlur: Number(state["shadowBlur"]),
      args,
      ...(text === undefined ? {} : { text }),
      subs: subs.map((s) => ({ pts: [...s.pts], arcs: [...s.arcs] })),
    });
  };
  const methods: Record<string, (...a: never[]) => unknown> = {
    measureText: (s: string) => ({ width: textWidth(s, String(state["font"]), String(state["letterSpacing"])), actualBoundingBoxAscent: 0.7 * fontPx(String(state["font"])), actualBoundingBoxDescent: 0 }),
    setLineDash: (d: number[]) => {
      dash = [...d];
    },
    getLineDash: () => [...dash],
    save: () => {
      stack.push({ ...state, __dash: [...dash] });
    },
    restore: () => {
      const s = stack.pop();
      if (s === undefined) return;
      dash = s["__dash"] as number[];
      delete s["__dash"];
      Object.assign(state, s);
    },
    beginPath: () => {
      subs = [];
    },
    moveTo: (x: number, y: number) => {
      subs.push({ pts: [{ x, y }], arcs: [] });
    },
    lineTo: (x: number, y: number) => {
      cur().pts.push({ x, y });
    },
    closePath: () => undefined,
    arc: (cx: number, cy: number, r: number) => {
      cur().arcs.push({ cx, cy, r });
    },
    ellipse: (cx: number, cy: number, rx: number, ry: number) => {
      cur().arcs.push({ cx, cy, r: Math.max(rx, ry) });
      cur().pts.push({ x: cx - rx, y: cy - ry }, { x: cx + rx, y: cy + ry });
    },
    arcTo: (x1: number, y1: number, x2: number, y2: number) => {
      cur().pts.push({ x: x1, y: y1 }, { x: x2, y: y2 });
    },
    quadraticCurveTo: (_cx: number, _cy: number, x: number, y: number) => {
      cur().pts.push({ x, y });
    },
    bezierCurveTo: (_a: number, _b: number, _c: number, _d: number, x: number, y: number) => {
      cur().pts.push({ x, y });
    },
    rect: (x: number, y: number, w: number, h: number) => {
      subs.push({ pts: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], arcs: [] });
    },
    roundRect: (x: number, y: number, w: number, h: number) => {
      subs.push({ pts: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], arcs: [] });
    },
    createLinearGradient: (...args: number[]) => {
      const gr = { args, stops: [] as [number, string][], addColorStop: (o: number, c: string) => void gr.stops.push([o, c]) };
      lin.push(gr);
      return gr;
    },
    createRadialGradient: (...args: number[]) => ({ kind: "radial", args, addColorStop: () => undefined }),
    fillText: (s: string, ...a: number[]) => log("fillText", a, String(s)),
    strokeText: (s: string, ...a: number[]) => log("strokeText", a, String(s)),
    stroke: () => log("stroke", []),
    fill: () => log("fill", []),
    fillRect: (...a: number[]) => log("fillRect", a),
    strokeRect: (...a: number[]) => log("strokeRect", a),
    clearRect: (...a: number[]) => log("clearRect", a),
    rotate: (a: number) => void transforms.push(`rotate ${a}`),
    transform: () => void transforms.push("transform"),
    setTransform: () => undefined,
    translate: () => undefined,
    scale: () => undefined,
    drawImage: () => undefined,
    clip: () => undefined,
  };
  const g = new Proxy(state, {
    get(target, prop: string) {
      if (prop in methods) return methods[prop];
      if (prop in target) return target[prop];
      return () => undefined;
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      return true;
    },
    has(target, prop: string) {
      return prop in target || prop in methods;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { g, ops, lin, transforms };
}

const segs = (op: Op): [Pt, Pt][] => op.subs.flatMap((s) => s.pts.slice(1).map((p, i) => [s.pts[i] as Pt, p] as [Pt, Pt]));
const len = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);
const allPts = (op: Op): Pt[] => op.subs.flatMap((s) => [...s.pts, ...s.arcs.flatMap((a) => [{ x: a.cx - a.r, y: a.cy - a.r }, { x: a.cx + a.r, y: a.cy + a.r }])]);
function bbox(op: Op): { x0: number; y0: number; x1: number; y1: number } {
  const ps = allPts(op);
  return { x0: Math.min(...ps.map((p) => p.x)), y0: Math.min(...ps.map((p) => p.y)), x1: Math.max(...ps.map((p) => p.x)), y1: Math.max(...ps.map((p) => p.y)) };
}
const strokeIs = (o: Op, color: string): boolean => o.op === "stroke" && same(o.strokeStyle, color);

// ---------------------------------------------------------------- the scene

const l = layoutFor(1280, 720, templates.field);
const stageCol = playStage(l, 1).column;
const layout: Layout = { ...l, column: stageCol };
const viewAt = (los: number): View => viewOf(layout, cameraAt(los, l.visibleYards, templates.field.losFromTop));
const X = (v: View, x: number): number => v.ox + (1 + x) * v.s;
const Y = (v: View, y: number): number => (v.cameraY - y) * v.s;

/** Team ink with four distinct colors, so every stroke says whose pass it is. */
// Rings are not color.line or outlineDark here, so no field paint, ball path or carrier ring is taken for a path.
const INK: FieldInk = { O: { fill: "#C62F2F", ring: "#1A2B3C" }, X: { fill: "#45A8E6", ring: "#3C2B1A" } };
const baseScene: FieldScene = { los: 40, firstDown: 50, bottomName: "Outriders", topName: "Cranes", endZoneYards: 10 };

function tlOf(event: PlayEvent, human: "offense" | "defense" | null = null): Timeline {
  return timeline({ event, runoffSeconds: 0, human }, templates, { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: l.s, markPx: l.markPx, motion });
}
function optsFor(tl: Timeline, extra: Partial<FrameOpts> = {}): FrameOpts {
  const ids = tl.marks.map((m) => m.playerId);
  return { numbers: Object.fromEntries(ids.map((id, i) => [id, i + 1])), ratings: Object.fromEntries(ids.map((id, i) => [id, 50 + i])), labelContent: "rating", focused: null, markLabels: "all", routeAlpha: 0.4, textScale: 1, ink: INK, ...extra };
}
function frame(tl: Timeline, t: number, extra: Partial<FrameOpts> = {}): ReturnType<typeof recorder> & { v: View } {
  const r = recorder();
  const v = viewAt(tl.los);
  drawFrame(r.g, v, tl, t, optsFor(tl, extra));
  return { ...r, v };
}
const isPathStroke = (o: Op): boolean => o.op === "stroke" && [INK.O.fill, INK.O.ring as string, INK.X.fill, INK.X.ring as string].some((c) => same(o.strokeStyle, c)) && [3, 5.5, 2, 4].includes(o.lineWidth);

// ================================================================ Tokens

describe("Tokens: the Prime Time field colors, in tokens.ts and mirrored in styles.css :root", () => {
  const rootVars: Record<string, string> = {};
  for (const m of css.matchAll(/:root\s*\{([^}]*)\}/g)) for (const d of (m[1] as string).split(";")) {
    const k = d.indexOf(":");
    if (k > 0 && d.slice(0, k).trim().startsWith("--")) rootVars[d.slice(0, k).trim()] = d.slice(k + 1).trim();
  }
  const kebab = (k: string): string => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const C = COLOR as unknown as Record<string, string>;

  it.each([
    ["los", "#3D8BFF"],
    ["midfieldPaint", "rgba(245, 247, 242, 0.18)"],
    ["trail", "rgba(245, 247, 242, 0.45)"],
  ])("color.%s is %s in tokens.ts", (k, want) => {
    expect(C[k], k).toBeDefined();
    expect(rgba(C[k] as string)).toEqual(rgba(want));
  });

  it.each(["los", "midfieldPaint", "trail"])("color.%s is mirrored as its kebab-case :root variable", (k) => {
    const v = rootVars[`--${kebab(k)}`];
    expect(v, `--${kebab(k)}`).toBeDefined();
    expect(rgba(v as string)).toEqual(rgba(C[k] as string));
  });

  it("every COLOR token is in :root with the same value (the mirror stays whole with the new ones)", () => {
    for (const k of Object.keys(C)) {
      const v = rootVars[`--${kebab(k)}`];
      expect(v, k).toBeDefined();
      expect(rgba(v as string), k).toEqual(rgba(C[k] as string));
    }
  });

  it("midfield paint is never above 0.18 (Contrast: at 0.22 the lit white ring drops to 3.04)", () => {
    expect(rgba(C["midfieldPaint"] as string)[3]).toBeLessThanOrEqual(0.18);
  });
});

// ================================================================ Line of scrimmage

describe("Field, line of scrimmage: a solid color.los 3 px core over a 1 px color.outlineDark casing each side (5 px), round caps, sideline to sideline", () => {
  const v = viewAt(40);
  const r = recorder();
  drawField(r.g, v, baseScene, 1);
  const core = r.ops.filter((o) => strokeIs(o, COLOR.los));

  it("the core: color.los, 3 px, solid, round caps, at the line of scrimmage, from sideline to sideline", () => {
    expect(core.length).toBe(1);
    const o = core[0] as Op;
    expect([o.lineWidth, o.lineCap, o.dash.length]).toEqual([3, "round", 0]);
    const b = bbox(o);
    expect(b.y0).toBeCloseTo(Y(v, 40), 0);
    expect(b.y1).toBeCloseTo(Y(v, 40), 0);
    expect(b.x0).toBeCloseTo(X(v, 0), 0);
    expect(b.x1).toBeCloseTo(X(v, FIELD_WIDTH_YARDS), 0);
  });

  it("the casing: color.outlineDark, 5 px, round caps, the same line, drawn just before the core", () => {
    const o = core[0] as Op;
    const casing = r.ops.slice(0, o.i).filter((c) => strokeIs(c, COLOR.outlineDark) && c.lineWidth === 5 && Math.abs(bbox(c).y0 - Y(v, 40)) < 1);
    expect(casing.length).toBeGreaterThan(0);
    const c = casing.at(-1) as Op;
    expect([c.lineCap, c.dash.length]).toEqual(["round", 0]);
    expect(bbox(c).x0).toBeCloseTo(bbox(o).x0, 0);
    expect(bbox(c).x1).toBeCloseTo(bbox(o).x1, 0);
  });

  it("the first-down line keeps its signal core over the same casing, and the two lines are both drawn", () => {
    const fd = r.ops.filter((o) => strokeIs(o, COLOR.signal));
    expect(fd.length).toBe(1);
    expect(bbox(fd[0] as Op).y0).toBeCloseTo(Y(v, 50), 0);
  });

  it("no first-down line when the line to gain is the goal line; the blue line stays", () => {
    const g = recorder();
    drawField(g.g, viewAt(95), { ...baseScene, los: 95, firstDown: null }, 1);
    expect(g.ops.filter((o) => strokeIs(o, COLOR.signal)).length).toBe(0);
    expect(g.ops.filter((o) => strokeIs(o, COLOR.los)).length).toBe(1);
  });

  it("the lines sit under every mark and path: drawField paints them, and drawFrame (marks, paths) draws over that", () => {
    // drawFrame never repaints either line.
    const f = frame(tlOf(COMPLETE), tlOf(COMPLETE).total);
    expect(f.ops.filter((o) => strokeIs(o, COLOR.los) || strokeIs(o, COLOR.signal)).length).toBe(0);
  });
});

// ================================================================ The down tag

describe("Field, down tag: a color.tag pill 22 px tall, 8 px padding, display 700 16 px caps color.line, 4 px above the line, 1 yard in; fades at the snap", () => {
  const tl = tlOf(COMPLETE);
  const setT = (tl.setAt + tl.snapAt) / 2;
  const pillOf = (ops: readonly Op[]): Op | undefined => ops.find((o) => o.op === "fill" && same(o.fillStyle, COLOR.tag) && Math.abs(bbox(o).y1 - bbox(o).y0 - 22) < 0.6);
  const textOf = (ops: readonly Op[]): Op | undefined => ops.find((o) => o.op === "fillText" && /&/.test(o.text ?? ""));

  it("precondition: the play has a set phase before the snap", () => {
    expect(tl.snapAt).toBeGreaterThan(tl.setAt);
  });

  it("in the set phase: the text is the bug's down block in caps, display 700 16 px, color.line, full opacity", () => {
    const f = frame(tl, setT, { downTag: "3rd & 4" });
    const t = textOf(f.ops);
    expect(t?.text).toBe("3RD & 4");
    expect(t?.font).toMatch(/700/);
    expect(fontPx(t?.font ?? "")).toBe(16);
    expect(t?.font).toMatch(/Barlow Condensed/);
    expect(same(t?.fillStyle, COLOR.line)).toBe(true);
    expect(t?.alpha).toBe(1);
  });

  it("the pill: color.tag, 22 px tall, fully round (radius.pill), text width plus 8 px each side, the text centered in it", () => {
    const f = frame(tl, setT, { downTag: "1st & goal" });
    const p = pillOf(f.ops);
    expect(p).toBeDefined();
    const b = bbox(p as Op);
    const t = textOf(f.ops) as Op;
    const w = textWidth(t.text ?? "", t.font, t.letterSpacing);
    expect(b.x1 - b.x0).toBeCloseTo(w + 16, 0);
    // Centered: the text's center is the pill's center (by its alignment).
    const tx = t.textAlign === "center" ? (t.args[0] as number) : t.textAlign === "right" || t.textAlign === "end" ? (t.args[0] as number) - w / 2 : (t.args[0] as number) + w / 2;
    expect(tx).toBeCloseTo((b.x0 + b.x1) / 2, 0);
    // Round ends: arcs of radius 11, or a roundRect at least that round.
    const arcs = (p as Op).subs.flatMap((s) => s.arcs);
    if (arcs.length > 0) for (const a of arcs) expect(a.r).toBeCloseTo(11, 0);
  });

  it("placement: the pill's bottom sits 4 px above the line of scrimmage (from its casing or its center), its left edge 1 yard inside the left sideline", () => {
    // A line at the 45: no yard number within the tag's height, so the tag is at its home spot.
    const tl45 = { ...tl, los: 45 } as Timeline;
    const f = frame(tl45, setT, { downTag: "3rd & 4" });
    const b = bbox(pillOf(f.ops) as Op);
    const lineY = Y(f.v, 45);
    // "4 px above the line": DESIGN.md does not say from the 5 px casing's edge or the line's center; either passes.
    expect(b.y1).toBeGreaterThanOrEqual(lineY - 2.5 - 4 - 0.6);
    expect(b.y1).toBeLessThanOrEqual(lineY - 4 + 0.6);
    expect(b.x0).toBeCloseTo(X(f.v, 1), 0);
  });

  it("when it would overlap a yard number it moves right until it clears it", () => {
    // A line of scrimmage 2 yards short of the 30: the tag sits where the 30's left numbers are.
    const v = viewAt(28);
    const fld = recorder();
    drawField(fld.g, v, { ...baseScene, los: 28, firstDown: 38 }, 1);
    const tl28 = { ...tl, los: 28 } as Timeline;
    const r = recorder();
    drawFrame(r.g, v, tl28, setT, optsFor(tl28, { downTag: "2nd & 10" }));
    const b = bbox(pillOf(r.ops) as Op);
    // The yard numbers drawn on the left half within the tag's height band.
    const nums = fld.ops.filter((o) => o.op === "fillText" && /^\d+$/.test(o.text ?? "") && (o.args[0] as number) < X(v, FIELD_WIDTH_YARDS / 2));
    const boxes = nums.map((o) => {
      const w = textWidth(o.text ?? "", o.font, o.letterSpacing);
      const x = o.args[0] as number;
      const x0 = o.textAlign === "center" ? x - w / 2 : o.textAlign === "right" || o.textAlign === "end" ? x - w : x;
      const px = fontPx(o.font);
      return { x0, x1: x0 + w, yc: o.args[1] as number, px };
    });
    const near = boxes.filter((n) => Math.abs(n.yc - Y(v, 30)) < n.px * 1.5);
    expect(near.length, "precondition: the 30's numbers are drawn on the left").toBeGreaterThan(0);
    const right = Math.max(...near.map((n) => n.x1));
    // Precondition: at its home spot (1 yard in) the tag would overlap them.
    expect(X(v, 1)).toBeLessThan(right);
    expect(b.x0).toBeGreaterThanOrEqual(right - 0.5);
  });

  it("fades out over dur.base from the snap: about half at dur.base / 2, gone at dur.base", () => {
    const half = frame(tl, tl.snapAt + DUR.base / 2, { downTag: "3rd & 4" });
    const a = pillOf(half.ops)?.alpha ?? textOf(half.ops)?.alpha;
    expect(a).toBeDefined();
    expect(a as number).toBeGreaterThan(0.3);
    expect(a as number).toBeLessThan(0.7);
    const gone = frame(tl, tl.snapAt + DUR.base + 1, { downTag: "3rd & 4" });
    expect(textOf(gone.ops)).toBeUndefined();
    expect(pillOf(gone.ops)).toBeUndefined();
  });

  it("not in the live play or after the whistle, and not drawn without a down text", () => {
    for (const t of [(tl.snapAt + tl.liveEnd) / 2, tl.liveEnd, tl.total]) expect(textOf(frame(tl, t, { downTag: "3rd & 4" }).ops), `t ${t}`).toBeUndefined();
    expect(textOf(frame(tl, setT).ops)).toBeUndefined();
    expect(textOf(frame(tl, setT, { downTag: "" }).ops)).toBeUndefined();
  });
});

// ================================================================ End zones

describe("Field, end zones: flat team end zone color, 10 yards deep; the defending team's name in color.line, display 700 caps, sized to fill", () => {
  const EZ = { bottom: "#B85A1E", top: "#3263D2" };
  const sizeFor = (v: View, name: string): number => {
    const cap = (5 * v.s) / 0.7;
    // The recorder's width per px of size, with 0.06em letter-spacing: name.length * (0.5 + 0.06).
    const byWidth = (0.8 * FIELD_WIDTH_YARDS * v.s) / (name.length * 0.56);
    return Math.max(28, Math.min(cap, byWidth));
  };
  const run = (los: number, scene: Partial<FieldScene> = {}, vw?: View): { r: ReturnType<typeof recorder>; v: View } => {
    const v = vw ?? viewAt(los);
    const r = recorder();
    drawField(r.g, v, { ...baseScene, los, firstDown: null, endZones: EZ, ...scene }, 1);
    return { r, v };
  };

  it("the bottom end zone (the offense's own) is a flat fill in its color, 10 yards deep, full field width", () => {
    const { r, v } = run(5);
    const f = r.ops.filter((o) => o.op === "fillRect" && same(o.fillStyle, EZ.bottom));
    expect(f.length).toBeGreaterThan(0);
    const [x, y, w, h] = (f[0] as Op).args as number[];
    expect(Math.abs(h as number)).toBeCloseTo(10 * v.s, 0);
    expect(Math.abs(w as number)).toBeCloseTo(FIELD_WIDTH_YARDS * v.s, 0);
    expect(x).toBeCloseTo(X(v, 0), 0);
    expect(Math.min(y as number, (y as number) + (h as number))).toBeCloseTo(Y(v, 0), 0);
  });

  it("the top end zone is the other team's color", () => {
    const { r } = run(95);
    expect(r.ops.some((o) => o.op === "fillRect" && same(o.fillStyle, EZ.top))).toBe(true);
  });

  it("each end zone shows the name of the team defending it, in caps, color.line, display 700, no outline, upright", () => {
    const b = run(5);
    const bt = b.r.ops.filter((o) => o.op === "fillText" && o.text === "OUTRIDERS");
    expect(bt.length).toBe(1);
    const o = bt[0] as Op;
    expect(same(o.fillStyle, COLOR.line)).toBe(true);
    expect(o.font).toMatch(/700/);
    expect(o.font).toMatch(/Barlow Condensed/);
    expect(b.r.ops.some((x) => x.op === "strokeText")).toBe(false);
    expect(b.r.transforms.filter((x) => x.startsWith("rotate"))).toEqual([]);
    // Centered in the end zone.
    expect(o.textAlign).toBe("center");
    expect(o.args[0]).toBeCloseTo(X(b.v, FIELD_WIDTH_YARDS / 2), 0);
    expect(o.args[1] as number).toBeGreaterThan(Y(b.v, 0));
    expect(o.args[1] as number).toBeLessThan(Y(b.v, -10));
    const t = run(95);
    expect(t.r.ops.filter((x) => x.op === "fillText" && x.text === "CRANES").length).toBe(1);
  });

  it("letter-spacing 0.06em on the names", () => {
    const o = run(5).r.ops.find((x) => x.op === "fillText" && x.text === "OUTRIDERS") as Op;
    expect(o.letterSpacing).toBe("0.06em");
  });

  it.each([
    ["a short name: the 5-yard cap height wins", "Owls"],
    ["a long name: the width wins (0.8 of 53.3 yards)", "Thunderbirds"],
  ])("size: the smaller of a 5-yard cap height and 0.8 of the field's width, %s", (_n, name) => {
    const { r, v } = run(5, { bottomName: name });
    const o = r.ops.find((x) => x.op === "fillText" && x.text === name.toUpperCase()) as Op;
    expect(o).toBeDefined();
    const want = sizeFor(v, name.toUpperCase());
    expect(Math.abs(fontPx(o.font) - want), `${fontPx(o.font)} vs ${want}`).toBeLessThanOrEqual(1);
    // The drawn width never passes 0.8 of the field's width.
    expect(textWidth(o.text ?? "", o.font, o.letterSpacing)).toBeLessThanOrEqual(0.8 * FIELD_WIDTH_YARDS * v.s + 1);
  });

  it("never under 28 px, even on a small view with a long name", () => {
    const small = viewOf(layoutFor(800, 536, templates.field), cameraAt(5, layoutFor(800, 536, templates.field).visibleYards, templates.field.losFromTop));
    const { r } = run(5, { bottomName: "Thunderbirds of the plains" }, small);
    const o = r.ops.find((x) => x.op === "fillText" && x.text === "THUNDERBIRDS OF THE PLAINS") as Op;
    expect(o).toBeDefined();
    expect(fontPx(o.font)).toBeGreaterThanOrEqual(28);
  });
});

// ================================================================ Midfield wordmark

describe("Field, midfield wordmark: the home name in caps at the 50, color.midfieldPaint, cap height 3 yards, under every line and number", () => {
  const run = (home: string | undefined, los = 45): { r: ReturnType<typeof recorder>; v: View } => {
    const v = viewAt(los);
    const r = recorder();
    drawField(r.g, v, { ...baseScene, los, firstDown: los + 10, ...(home === undefined ? {} : { homeName: home }) }, 1);
    return { r, v };
  };
  const mark = (r: ReturnType<typeof recorder>, text: string): Op | undefined => r.ops.find((o) => o.op === "fillText" && o.text === text);
  /** The paint as composited: the fill color's alpha times globalAlpha. */
  const painted = (o: Op): Rgba => {
    const c = rgba(String(o.fillStyle));
    return [c[0], c[1], c[2], Math.round(c[3] * o.alpha * 1000) / 1000];
  };

  it("centered on the 50 and the field's center line, upright, display 700, white at 0.18, no outline", () => {
    const { r, v } = run("Outriders");
    const o = mark(r, "OUTRIDERS");
    expect(o).toBeDefined();
    expect(o?.textAlign).toBe("center");
    expect(o?.args[0]).toBeCloseTo(X(v, FIELD_WIDTH_YARDS / 2), 0);
    expect(o?.font).toMatch(/700/);
    expect(o?.font).toMatch(/Barlow Condensed/);
    expect(painted(o as Op)).toEqual(rgba("rgba(245, 247, 242, 0.18)"));
    expect(r.ops.some((x) => x.op === "strokeText")).toBe(false);
    expect(r.transforms.filter((x) => x.startsWith("rotate"))).toEqual([]);
    // Vertically centered on the 50: its baseline is within one cap height of Y(50).
    expect(Math.abs((o?.args[1] as number) - Y(v, 50))).toBeLessThanOrEqual((3 * v.s) / 0.7);
  });

  it("cap height 3 yards (size 3 * s / 0.70), letter-spacing 0.04em", () => {
    const { r, v } = run("Owls");
    const o = mark(r, "OWLS") as Op;
    expect(Math.abs(fontPx(o.font) - (3 * v.s) / 0.7)).toBeLessThanOrEqual(1);
    expect(o.letterSpacing).toBe("0.04em");
  });

  it("shrunk to fit when wider than 30 yards", () => {
    const name = "Thunderbirds of the plains";
    const { r, v } = run(name);
    const o = mark(r, name.toUpperCase()) as Op;
    expect(o).toBeDefined();
    expect(textWidth(o.text ?? "", o.font, o.letterSpacing)).toBeLessThanOrEqual(30 * v.s + 1);
    expect(fontPx(o.font)).toBeLessThan((3 * v.s) / 0.7);
  });

  it("paint order: after the turf and the turf light, before every line (stroke) and every yard number", () => {
    const { r } = run("Outriders");
    const o = mark(r, "OUTRIDERS") as Op;
    const light = r.ops.findIndex((x) => typeof x.fillStyle === "object" && (x.fillStyle as { kind?: string } | null)?.kind === "radial");
    expect(light).toBeGreaterThanOrEqual(0);
    expect(o.i).toBeGreaterThan(light);
    const firstStroke = r.ops.findIndex((x) => x.op === "stroke" || x.op === "strokeRect");
    expect(o.i).toBeLessThan(firstStroke);
    for (const n of r.ops.filter((x) => x.op === "fillText" && /^\d+$/.test(x.text ?? ""))) expect(o.i).toBeLessThan(n.i);
  });

  it("no wordmark without a home name; it is the only text at midfield", () => {
    const { r } = run(undefined);
    expect(r.ops.filter((o) => o.op === "fillText" && /^[A-Z ]{3,}$/.test(o.text ?? "") && !["OUTRIDERS", "CRANES"].includes(o.text ?? ""))).toEqual([]);
  });
});

// ================================================================ Paths

describe("Marks, paths: solid, told apart by weight and end cap; the ball path the only dotted line", () => {
  const tl = tlOf(COMPLETE);
  const end = frame(tl, tl.total);
  const v = end.v;

  it("offense routes: team fill 3 px over the ring color 5.5 px, round caps and joins", () => {
    const fill = end.ops.filter((o) => strokeIs(o, INK.O.fill) && o.lineWidth === 3);
    const ring = end.ops.filter((o) => strokeIs(o, INK.O.ring as string) && o.lineWidth === 5.5);
    expect(fill.length).toBeGreaterThan(0);
    expect(ring.length).toBeGreaterThanOrEqual(fill.length);
    for (const o of [...fill, ...ring]) expect([o.lineCap, o.lineJoin, o.dash.length]).toEqual(["round", "round", 0]);
    // Each fill pass follows its ring pass.
    for (const o of fill) expect(ring.some((r) => r.i < o.i)).toBe(true);
  });

  it("defense paths: team fill 2 px over the ring color 4 px, round caps and joins, no dashes", () => {
    const fill = end.ops.filter((o) => strokeIs(o, INK.X.fill) && o.lineWidth === 2);
    const ring = end.ops.filter((o) => strokeIs(o, INK.X.ring as string) && o.lineWidth === 4);
    expect(fill.length).toBeGreaterThan(0);
    expect(ring.length).toBeGreaterThanOrEqual(fill.length);
    for (const o of [...fill, ...ring]) expect([o.lineCap, o.lineJoin, o.dash.length]).toEqual(["round", "round", 0]);
  });

  /** The drawn path ends (canvas px) of one side's fill pass, with the direction they arrive from. */
  const ends = (side: "O" | "X"): { tip: Pt; back: Pt }[] => {
    const w = side === "O" ? 3 : 2;
    const out: { tip: Pt; back: Pt }[] = [];
    for (const o of end.ops.filter((x) => strokeIs(x, INK[side].fill) && x.lineWidth === w)) {
      for (const s of o.subs) {
        const pts = s.pts;
        if (pts.length < 2) continue;
        let total = 0;
        for (let i = 1; i < pts.length; i++) total += len(pts[i - 1] as Pt, pts[i] as Pt);
        if (total <= 12) continue; // an arrowhead stroke or a tick, not a path
        out.push({ tip: pts[pts.length - 1] as Pt, back: pts[pts.length - 2] as Pt });
      }
    }
    return out;
  };
  const angle = (a: Pt, b: Pt, c: Pt, d: Pt): number => {
    const u = [b.x - a.x, b.y - a.y];
    const w = [d.x - c.x, d.y - c.y];
    const dot = (u[0] as number) * (w[0] as number) + (u[1] as number) * (w[1] as number);
    return (Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(u[0] as number, u[1] as number) * Math.hypot(w[0] as number, w[1] as number))))) * 180) / Math.PI;
  };

  it("an ended offense route carries an arrowhead: two 8 px strokes at 30 degrees off its line, at its tip, in both passes", () => {
    const segsO = end.ops.filter((o) => strokeIs(o, INK.O.fill) && o.lineWidth === 3).flatMap(segs);
    let arrowed = 0;
    for (const { tip, back } of ends("O")) {
      const wings = segsO.filter(([a, b]) => Math.abs(len(a, b) - 8) < 0.5 && (len(a, tip) < 0.75 || len(b, tip) < 0.75));
      if (wings.length < 2) continue;
      arrowed++;
      for (const [a, b] of wings) {
        const [from, to] = len(a, tip) < 0.75 ? [a, b] : [b, a];
        expect(angle(tip, back, from, to), "30 degrees off the line, pointing back").toBeCloseTo(30, 0);
      }
    }
    expect(arrowed, "at least one route ends in an arrowhead").toBeGreaterThan(0);
  });

  it("an ended defense path carries a filled dot 6 px across in the team fill, with a 1.5 px ring in the ring color", () => {
    const tips = ends("X");
    expect(tips.length).toBeGreaterThan(0);
    const dots = end.ops.filter((o) => o.op === "fill" && same(o.fillStyle, INK.X.fill)).flatMap((o) => o.subs.flatMap((s) => s.arcs)).filter((a) => a.r >= 2.2 && a.r <= 3.8);
    const rings = end.ops.filter((o) => strokeIs(o, INK.X.ring as string) && o.lineWidth === 1.5).flatMap((o) => o.subs.flatMap((s) => s.arcs));
    let dotted = 0;
    for (const { tip } of tips) {
      const d = dots.find((a) => Math.hypot(a.cx - tip.x, a.cy - tip.y) <= 4);
      if (d === undefined) continue;
      dotted++;
      // "6 px across": the dot plus its ring spans 6 px, or the fill alone does.
      expect([3, 2.25].some((r) => Math.abs(d.r - r) < 0.3), `dot radius ${d.r}`).toBe(true);
      expect(rings.some((a) => Math.hypot(a.cx - d.cx, a.cy - d.cy) < 0.5)).toBe(true);
    }
    expect(dotted, "every defense path that ended has its dot").toBe(tips.length);
  });

  it("no dashes anywhere except the ball path: dotted color.line, 2 px, dot 2 gap 5, round caps, above the routes", { timeout: 120000 }, () => {
    let dottedSeen = 0;
    for (const [name, ev] of Object.entries(ALL_FIXTURES)) {
      const t = tlOf(ev, "offense");
      for (const at_ of [t.setAt, (t.snapAt + t.liveEnd) / 2, t.total]) {
        const f = frame(t, at_);
        const fld = recorder();
        drawField(fld.g, f.v, { ...baseScene, los: t.los, firstDown: t.firstDown, homeName: "Outriders", endZones: { bottom: "#B85A1E", top: "#3263D2" } }, 1);
        for (const o of [...f.ops, ...fld.ops].filter((x) => x.dash.length > 0 && (x.op === "stroke" || x.op === "strokeRect"))) {
          expect(same(o.strokeStyle, COLOR.line), `${name}: dashed ${String(o.strokeStyle)}`).toBe(true);
          expect(o.lineWidth, name).toBe(2);
          expect(o.dash, name).toEqual([2, 5]);
          expect(o.lineCap, name).toBe("round");
          // Above the routes: after every route stroke of the same frame.
          const routes = f.ops.filter((x) => isPathStroke(x) && x.dash.length === 0);
          if (f.ops.includes(o)) for (const r of routes) expect(o.i, name).toBeGreaterThan(r.i);
          dottedSeen++;
        }
      }
    }
    expect(dottedSeen, "precondition: a pass draws its ball path").toBeGreaterThan(0);
  });

  it("pre-snap preview zones: edges solid, 1.5 px in the defense fill over 3 px of its ring color, round caps and joins", { timeout: 120000 }, () => {
    let zones = 0;
    for (const ev of Object.values(ALL_FIXTURES)) {
      const t = tlOf(ev, "defense");
      if ((t.preview?.zones.length ?? 0) === 0) continue;
      const f = frame(t, (t.setAt + t.snapAt) / 2);
      const fill = f.ops.filter((o) => o.op === "strokeRect" && same(o.strokeStyle, INK.X.fill));
      const ring = f.ops.filter((o) => o.op === "strokeRect" && same(o.strokeStyle, INK.X.ring as string));
      expect(fill.length).toBeGreaterThan(0);
      for (const o of fill) expect([o.lineWidth, o.dash.length, o.lineJoin]).toEqual([1.5, 0, "round"]);
      for (const o of ring) expect([o.lineWidth, o.dash.length, o.lineJoin]).toEqual([3, 0, "round"]);
      zones++;
    }
    expect(zones, "precondition: a fixture's defense preview has zones").toBeGreaterThan(0);
  });

  it("the drawn paths stay under the marks: every path stroke comes before the first mark (shadow.mark) draw", () => {
    const firstMark = end.ops.findIndex((o) => o.shadowBlur === 4);
    expect(firstMark).toBeGreaterThan(0);
    for (const o of end.ops.filter(isPathStroke)) expect(o.i).toBeLessThan(firstMark);
    void v;
  });
});

// ================================================================ Draw-on

describe("Marks, draw-on: faint preview at 40% before the snap, fading over dur.base; each path drawn behind its mark, never ahead; full after the whistle", () => {
  const tl = tlOf(COMPLETE, "offense");
  const v = viewAt(tl.los);
  const edgePx = v.markPx / 2 + 2;

  it("precondition: the offense preview has routes", () => {
    expect((tl.preview?.paths.length ?? 0)).toBeGreaterThan(0);
  });

  it("before the snap the preview routes are drawn faint, at the route alpha (0.4), in full", () => {
    const f = frame(tl, (tl.setAt + tl.snapAt) / 2);
    const faint = f.ops.filter((o) => isPathStroke(o) && o.alpha < 1);
    expect(faint.length).toBeGreaterThan(0);
    for (const o of faint) expect(o.alpha).toBeCloseTo(0.4, 5);
    // No path is drawn at full strength before the snap.
    expect(f.ops.filter((o) => isPathStroke(o) && o.alpha === 1)).toEqual([]);
  });

  it("at the snap the faint preview fades out over dur.base: about half at dur.base / 2, gone by dur.base", () => {
    const half = frame(tl, tl.snapAt + DUR.base / 2).ops.filter((o) => isPathStroke(o) && o.alpha < 1);
    expect(half.length).toBeGreaterThan(0);
    for (const o of half) expect(o.alpha).toBeCloseTo(0.2, 1);
    expect(frame(tl, tl.snapAt + DUR.base + 1).ops.filter((o) => isPathStroke(o) && o.alpha < 1)).toEqual([]);
  });

  it("at 2x the fade is still dur.base of wall time (double the timeline ms)", () => {
    const half = frame(tl, tl.snapAt + DUR.base, { live: { speed: 2 } }).ops.filter((o) => isPathStroke(o) && o.alpha < 1);
    expect(half.length).toBeGreaterThan(0);
    for (const o of half) expect(o.alpha).toBeCloseTo(0.2, 1);
  });

  it("during the live play no path runs ahead of its player: every drawn path ends where a mark is or has already been", () => {
    const span = tl.liveEnd - tl.snapAt;
    let checked = 0;
    for (const f of [0.25, 0.5, 0.75]) {
      const t = tl.snapAt + DUR.base + 1 + f * (span - DUR.base - 1);
      const r = frame(tl, t);
      // Every mark's track from the snap to now, in canvas px.
      const tracks = tl.marks.map((m) => {
        const pts: Pt[] = [];
        for (let s = tl.snapAt; s <= t; s += 5) {
          const p = at(m.keys, s);
          pts.push({ x: X(v, p.x), y: Y(v, p.y) });
        }
        return pts;
      });
      for (const o of r.ops.filter((x) => isPathStroke(x) && x.alpha === 1 && (x.lineWidth === 3 || x.lineWidth === 2))) {
        for (const s of o.subs) {
          if (s.pts.length < 2) continue;
          let total = 0;
          for (let i = 1; i < s.pts.length; i++) total += len(s.pts[i - 1] as Pt, s.pts[i] as Pt);
          if (total <= 12) continue;
          const tip = s.pts[s.pts.length - 1] as Pt;
          const reached = tracks.some((tr) => tr.some((p) => len(p, tip) <= edgePx));
          expect(reached, `t ${Math.round(t)}: a path ends at (${Math.round(tip.x)}, ${Math.round(tip.y)}), where no mark has been`).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("during the live play a path is shorter than it is at the whistle (it is drawing on, not shown in full)", () => {
    const pathLen = (t: number): number =>
      frame(tl, t)
        .ops.filter((o) => isPathStroke(o) && o.alpha === 1 && (o.lineWidth === 3 || o.lineWidth === 2))
        .flatMap(segs)
        .reduce((a, [p, q]) => a + len(p, q), 0);
    const early = pathLen(tl.snapAt + DUR.base + 1 + 0.2 * (tl.liveEnd - tl.snapAt));
    const whistle = pathLen(tl.liveEnd);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(whistle);
  });

  it("after the whistle every path is drawn in full and stays until the next snap (the frame at the whistle and at the end of the hold match)", () => {
    const geo = (t: number): string =>
      JSON.stringify(
        frame(tl, t)
          .ops.filter(isPathStroke)
          .map((o) => [String(o.strokeStyle), o.lineWidth, o.subs.map((s) => s.pts.map((p) => [Math.round(p.x), Math.round(p.y)]))]),
      );
    expect(geo(tl.total)).toBe(geo(tl.liveEnd + 1));
    expect(frame(tl, tl.total).ops.filter(isPathStroke).length).toBeGreaterThan(0);
  });
});

// ================================================================ Carrier trail

describe("fx.carrierTrail: a tapered streak behind the ball over the last 0.5 s, at most 8 yards, markPx * 0.45 wide at the mark, gradient.trail; only in live real-time play", () => {
  const tl = tlOf(RUN);
  const v = viewAt(tl.los);
  const midT = tl.snapAt + 0.6 * (tl.liveEnd - tl.snapAt);
  const trailOf = (r: ReturnType<typeof recorder>): Op | undefined => r.ops.find((o) => o.op === "fill" && r.lin.some((g) => (o.fillStyle as unknown) === g));
  const ballAt = (t: number): Pt => {
    const p = at(tl.ball, t);
    return { x: X(v, p.x), y: Y(v, p.y) };
  };
  /** The ball's travel over [t0, t] along its keys, px. */
  const travel = (t0: number, t: number): number => {
    let d = 0;
    let prev = ballAt(Math.max(tl.snapAt, t0));
    for (let s = Math.max(tl.snapAt, t0) + 5; s <= t; s += 5) {
      const p = ballAt(s);
      d += len(prev, p);
      prev = p;
    }
    return d;
  };

  /** How far from the ball, px, it was at its farthest over [t0, t]: the straight reach a trail over that window has. */
  const reachOver = (t0: number, t: number): number => {
    const b = ballAt(t);
    let m = 0;
    for (let s = Math.max(tl.snapAt, t0); s <= t; s += 5) m = Math.max(m, len(ballAt(s), b));
    return m;
  };

  it("precondition: the ball moves in the middle of the run", () => {
    expect(travel(midT - 500, midT)).toBeGreaterThan(v.s);
  });

  it("in live play at 1x: a fill with a linear gradient from color.trail at the ball to transparent at the tail", () => {
    const f = frame(tl, midT, { live: { speed: 1 } });
    const o = trailOf(f);
    expect(o).toBeDefined();
    const g = f.lin.find((x) => x === (o?.fillStyle as unknown)) as LinGrad;
    const stops = [...g.stops].sort((a, b) => a[0] - b[0]);
    expect(stops.map(([s]) => s)).toEqual([0, 1]);
    const [x0, y0, x1, y1] = g.args as [number, number, number, number];
    const ball = ballAt(midT);
    const headIs0 = Math.hypot(x0 - ball.x, y0 - ball.y) < Math.hypot(x1 - ball.x, y1 - ball.y);
    const head = rgba((headIs0 ? stops[0] : stops[1])?.[1] ?? "");
    const tail = rgba((headIs0 ? stops[1] : stops[0])?.[1] ?? "");
    expect(head).toEqual(rgba(COLOR.trail));
    expect(tail).toEqual([245, 247, 242, 0]);
  });

  it("its head is at the ball, its length at most 8 yards and about the ball's travel over the last 0.5 s", () => {
    const f = frame(tl, midT, { live: { speed: 1 } });
    const o = trailOf(f) as Op;
    const ball = ballAt(midT);
    const pts = allPts(o);
    const reach = Math.max(...pts.map((p) => len(p, ball)));
    const nearest = Math.min(...pts.map((p) => len(p, ball)));
    expect(nearest).toBeLessThanOrEqual(v.markPx / 2 + 1);
    expect(reach).toBeLessThanOrEqual(8 * v.s + v.markPx);
    const want = Math.min(8 * v.s, reachOver(midT - 500, midT));
    expect(reach).toBeGreaterThan(0.6 * want);
    expect(reach).toBeLessThan(1.25 * want + v.markPx);
  });

  it("tapered: markPx * 0.45 wide at the mark, narrowing to nothing at the tail", () => {
    const f = frame(tl, midT, { live: { speed: 1 } });
    const o = trailOf(f) as Op;
    const ball = ballAt(midT);
    const pts = o.subs.flatMap((s) => s.pts);
    // Pair up opposite edges: the widest cross-section is near the head, the farthest point is the tip.
    const far = pts.reduce((a, p) => (len(p, ball) > len(a, ball) ? p : a), pts[0] as Pt);
    const dir = { x: (far.x - ball.x) / len(far, ball), y: (far.y - ball.y) / len(far, ball) };
    const off = (p: Pt): number => Math.abs((p.x - ball.x) * dir.y - (p.y - ball.y) * dir.x);
    const widest = 2 * Math.max(...pts.map(off));
    expect(widest).toBeGreaterThan(v.markPx * 0.45 * 0.8);
    expect(widest).toBeLessThan(v.markPx * 0.45 * 1.2 + 0.5);
    expect(off(far)).toBeLessThan(1);
  });

  it("at 2x it covers the last 0.5 s of wall time, twice the timeline ms: reaching where the ball was 1000 timeline ms ago, not 500", () => {
    const reach = (speed: number): number => {
      const o = trailOf(frame(tl, midT, { live: { speed } })) as Op;
      const ball = ballAt(midT);
      return Math.max(...allPts(o).map((p) => len(p, ball)));
    };
    // The ball's along-path travel over 1000 ms stays under the 8-yard cap, so the cap does not decide it.
    expect(travel(midT - 1000, midT)).toBeLessThan(8 * v.s);
    const want1 = reachOver(midT - 500, midT);
    const want2 = reachOver(midT - 1000, midT);
    expect(want2, "precondition: the window matters for this play").toBeGreaterThan(want1 + 4);
    expect(Math.abs(reach(1) - want1)).toBeLessThanOrEqual(2);
    expect(Math.abs(reach(2) - want2)).toBeLessThanOrEqual(2);
  });

  it("drawn above the paths and below every mark, label and the ball", () => {
    const f = frame(tl, midT, { live: { speed: 1 } });
    const o = trailOf(f) as Op;
    for (const p of f.ops.filter(isPathStroke)) expect(p.i).toBeLessThan(o.i);
    const firstMark = f.ops.findIndex((x) => x.shadowBlur === 4);
    expect(o.i).toBeLessThan(firstMark);
    for (const t of f.ops.filter((x) => x.op === "fillText")) expect(o.i).toBeLessThan(t.i);
    const ball = f.ops.filter((x) => x.op === "fill" && same(x.fillStyle, COLOR.ball));
    expect(ball.length).toBeGreaterThan(0);
    for (const b of ball) expect(o.i).toBeLessThan(b.i);
  });

  it("gone at the whistle and after; not before the snap", () => {
    for (const t of [tl.liveEnd, tl.liveEnd + 1, tl.total, (tl.setAt + tl.snapAt) / 2]) expect(trailOf(frame(tl, t, { live: { speed: 1 } })), `t ${t}`).toBeUndefined();
  });

  it("not drawn under reduced motion or Skip (no live play): the frame has no trail", () => {
    expect(trailOf(frame(tl, midT))).toBeUndefined();
  });
});

// ================================================================ The animator: reduced motion, Skip and live play

describe("Animator: live play draws the trail; reduced motion and Skip show the final frame with full paths and no trail", () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { window: g["window"], document: g["document"], raf: g["requestAnimationFrame"], caf: g["cancelAnimationFrame"] };
  let rafQ: ((now: number) => void)[] = [];
  beforeAll(() => {
    g["window"] = { devicePixelRatio: 1 };
    g["document"] = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
    g["requestAnimationFrame"] = (cb: (now: number) => void): number => rafQ.push(cb);
    g["cancelAnimationFrame"] = (): void => undefined;
  });
  afterAll(() => {
    g["window"] = saved.window;
    g["document"] = saved.document;
    g["requestAnimationFrame"] = saved.raf;
    g["cancelAnimationFrame"] = saved.caf;
  });

  const tl = tlOf(RUN, "offense");
  const scene: FieldScene = { ...baseScene, los: tl.los, firstDown: tl.firstDown, ink: INK };
  const make = (): { anim: Animator; rec: () => ReturnType<typeof recorder> } => {
    let r = recorder();
    const canvas = { width: 0, height: 0, style: {}, getContext: () => r.g } as unknown as HTMLCanvasElement;
    const anim = new Animator(canvas, () => layout, () => templates, () => optsFor(tl));
    return {
      anim,
      rec: () => {
        const cur = r;
        r = recorder();
        return cur;
      },
    };
  };
  const linFill = (r: ReturnType<typeof recorder>): boolean => r.ops.some((o) => o.op === "fill" && r.lin.some((x) => (o.fillStyle as unknown) === x));

  it.each([
    ["reduced motion", { speed: "1x" as const, reducedMotion: true }],
    ["Skip", { speed: "skip" as const, reducedMotion: false }],
  ])("%s: one frame, the final one, with every path drawn in full and no trail", (_n, o) => {
    rafQ = [];
    const { anim, rec } = make();
    rec();
    void anim.play(tl, scene, { ...o, onClock: () => undefined });
    const r = rec();
    expect(linFill(r)).toBe(false);
    // The same paths as the whistle frame drawn directly.
    const want = frame(tl, tl.total).ops.filter(isPathStroke).length;
    expect(r.ops.filter(isPathStroke).length).toBe(want);
    expect(want).toBeGreaterThan(0);
    anim.stop();
  });

  it("live play at 1x: a frame in the middle of the run draws the carrier trail", () => {
    rafQ = [];
    const { anim, rec } = make();
    void anim.play(tl, scene, { speed: "1x", reducedMotion: false, onClock: () => undefined });
    rec();
    // Step the clock to the middle of the run in one frame from now.
    const t0 = performance.now();
    let cb = rafQ.shift();
    cb?.(t0);
    rec();
    cb = rafQ.shift();
    cb?.(t0 + (tl.snapAt + 0.6 * (tl.liveEnd - tl.snapAt)));
    expect(linFill(rec())).toBe(true);
    anim.stop();
  });
});
