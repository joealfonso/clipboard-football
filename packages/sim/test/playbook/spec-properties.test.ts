// Properties of the classifier over seeded random canonical paths (B1, B2, B4, B5) and library
// agreement (B3), docs/specs/m3-playbook-and-custom-routes.md. The generator is this file's own.
// The full 100,000-path run of B2 is the engineer's; this is a second, smaller sample.

import { describe, expect, it, vi } from "vitest";
import { REASON_CODES } from "../../../shared/src/playbook";
import type { Pair, SlotAlignment } from "../../../shared/src/playbook";
import { CAUGHT_AT_END, drawnFrom, files, ref, seeded } from "../../../shared/test/spec-support";
import { classifyPath, defenseContext, isCanonical, offenseContext, quantizePath } from "../../src/playbook/classify";
import type { ClassifyContext, ClassifyResult } from "../../src/playbook/classify";
import { config, feat, flipX, offCtx, offense, ownBreak, ownHeading, playbook } from "./spec-support";
import type { P } from "./spec-support";

vi.setConfig({ testTimeout: 60_000 });

const FAMILIES = ["flat", "swing", "screen", "drag", "slant", "hitch", "out", "in", "corner", "post", "go", "wheel"];
const THIRDS = ["left", "middle", "right"];

/** A canonical path: half-yard grid, up to 12 points, up to 60 yards, few sharp turns. */
function canonical(r: () => number): P[] {
  const n = Math.floor(r() * 7);
  const path: P[] = [[0, 0]];
  let head = (r() < 0.75 ? 1 : -1) * Math.PI * (0.15 + 0.7 * r());
  let len = 0;
  const scale = 1 + r() * 12;
  for (let i = 0; i < n; i++) {
    const last = path[path.length - 1] as P;
    const step = 0.5 + r() * scale;
    const next: P = [Math.round((last[0] + Math.cos(head) * step) * 2) / 2 + 0, Math.round((last[1] + Math.sin(head) * step) * 2) / 2 + 0];
    const d = Math.hypot(next[0] - last[0], next[1] - last[1]);
    if (d === 0 || len + d > 60) continue;
    path.push(next);
    len += d;
    head += (r() - 0.5) * (r() < 0.5 ? 1 : 4);
  }
  return path;
}

const KEYS: Record<string, string> = { route: "breakDepth,bucket,catchDepth,crossesMiddle,direction,endSide,family,kind", block: "block,kind", runPath: "gap,kind,side", blitz: "kind,lane,side", zone: "kind,level,third", spy: "kind" };

/** What is wrong with a result, or null. Plain comparisons: an expect per path is too slow on a busy machine. */
function wrong(res: ClassifyResult): string | null {
  if (!res.ok) return Object.keys(res).sort().join() === "ok,reason" && REASON_CODES.includes(res.reason) ? null : "reason";
  const f = res.features;
  if (Object.keys(f).sort().join() !== KEYS[f.kind]) return "keys";
  switch (f.kind) {
    case "route": {
      if (!FAMILIES.includes(f.family)) return "family";
      if (!Number.isInteger(f.breakDepth) || Object.is(f.breakDepth, -0)) return "breakDepth";
      if (!Number.isInteger(f.catchDepth) || Object.is(f.catchDepth, -0)) return "catchDepth";
      // One set of edges (B8), read at the catch depth (R1).
      if (f.bucket !== (f.catchDepth < 0 ? "behind" : f.catchDepth < 10 ? "short" : f.catchDepth < 20 ? "intermediate" : "deep")) return "bucket";
      if (!["in", "out", "vertical", "back"].includes(f.direction)) return "direction";
      return THIRDS.includes(f.endSide) && typeof f.crossesMiddle === "boolean" ? null : "end";
    }
    case "block":
      return f.block === "pass" ? null : "block";
    case "runPath":
      return ["A", "B", "C", "edge"].includes(f.gap) && THIRDS.includes(f.side) ? null : "runPath";
    case "blitz":
      return ["inside", "edge"].includes(f.lane) && THIRDS.includes(f.side) ? null : "blitz";
    case "zone":
      return ["under", "deep"].includes(f.level) && THIRDS.includes(f.third) ? null : "zone";
    case "spy":
      return null;
  }
}
/** R17: one rounding to whole yards for every depth. It names no direction for a half: half up is held. */
const whole = (y: number) => Math.floor(y + 0.5) + 0;
/** R1, R2, R11, R12 and R17 on one route, from this file's own geometry. null when they hold. */
function rulings(path: P[], align: Pair, f: Extract<ClassifyResult, { ok: true }>["features"]): string | null {
  if (f.kind !== "route") return null;
  const { y, breaks } = ownBreak(path, align[1]);
  // R17: rounded once, before the family and the bucket read it, so 9.5 is 10 to both.
  const end = whole((path.at(-1) as P)[1] - align[1]);
  if (f.breakDepth !== whole(y)) return "R12 breakDepth";
  if (f.catchDepth !== (CAUGHT_AT_END.includes(f.family) ? end : f.breakDepth)) return "R1 catchDepth";
  if (end <= 0) return null;
  const { heading, way } = ownHeading(path, align[0]);
  const is = (want: string) => (f.family === want ? null : `expected ${want}`);
  if (heading === "diagonal" && way === "in") return is(breaks > 0 ? (f.breakDepth >= 0 && f.breakDepth <= 9 && end < 10 ? "slant" : "post") : end < 10 ? "slant" : "post");
  if (breaks > 0) return null;
  if (heading === "vertical") return is("go");
  if (heading === "diagonal" && way === "out") return is(end < 10 ? "flat" : "corner");
  if (heading === "sideways") return is(way === "in" ? "drag" : "flat");
  return null;
}
/** R3: only a short move by a defender inside the core box is a spy, unless spying is his job. */
function badSpy(path: P[], ctx: ClassifyContext, kind: string): boolean {
  const [x, depth] = ctx.alignment[ctx.slot] as Pair;
  const box = playbook.config.classifier.coreBox;
  const [ex, ey] = path.at(-1) as P;
  const short = Math.hypot(ex, ey) < playbook.config.classifier.spyRadiusYards;
  return kind === "spy" && !(short && (ctx.base?.kind === "spy" || (Math.abs(x) <= box.halfWidthYards && depth <= box.maxDepthYards)));
}
/** Key-order-free comparison by value. */
const text = (o: unknown): string => JSON.stringify(o, (_, v: unknown) => (typeof v === "object" && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1))) : v));
const same = (a: unknown, b: unknown): boolean => text(a) === text(b);

/** Every real (formation, leaf) and preset, every slot, through its default design. */
const contexts: ClassifyContext[] = [
  ...playbook.offense.designs.filter((d) => d.default).flatMap((d) => Object.keys(playbook.alignments.offense[d.formation] as SlotAlignment).map((s) => offenseContext(d, playbook, s, 40))),
  ...playbook.defense.designs.filter((d) => d.default).flatMap((d) => Object.keys(playbook.alignments.defense[d.package] as SlotAlignment).map((s) => defenseContext(d, playbook, s, 40))),
];
const GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S"];
const groupOf = (c: ClassifyContext) => c.slot.replace(/\d+$/, "");

describe("B1 and B2: deterministic and total, 2,000 canonical paths per slot group", () => {
  for (const g of GROUPS) {
    it(g, () => {
      const pool = contexts.filter((c) => groupOf(c) === g);
      expect(pool.length).toBeGreaterThan(0);
      const r = seeded(1000 + GROUPS.indexOf(g));
      const seen = new Set<string>();
      const bad: string[] = [];
      const again = structuredClone(config);
      const kinds: Record<string, string[]> = { QB: [], OL: [], RB: ["route", "block", "runPath"], TE: ["route", "block"], WR: ["route"] };
      for (let k = 0; k < 2000; k++) {
        const path = canonical(r);
        const base = pool[Math.floor(r() * pool.length)] as ClassifyContext;
        const ctx = { ...base, spot: 1 + Math.floor(r() * 99) };
        const a = classifyPath(path, ctx, config);
        const w = wrong(a);
        if (w !== null) bad.push(`${w} ${text([path, a])}`);
        const at = ctx.alignment[ctx.slot] as Pair;
        const rule = a.ok ? rulings(path, at, a.features) : null;
        if (rule !== null) bad.push(`${rule} ${text([path, ctx.slot, a])}`);
        if (a.ok && badSpy(path, ctx, a.features.kind)) bad.push(`R3 spy ${text([path, ctx.slot, at])}`);
        if (!same(classifyPath(path.map(([x, y]): P => [x, y]), { ...ctx }, again), a)) bad.push(`not repeatable ${text(path)}`);
        seen.add(a.ok ? a.features.kind : a.reason);
        // Inside the canonical limits, so the form can't be the reason.
        if (!a.ok && ["notCanonical", "noSuchSlot", "tooLong"].includes(a.reason)) bad.push(`${a.reason} ${text(path)}`);
        if (a.ok && !(kinds[g] ?? ["blitz", "zone", "spy"]).includes(a.features.kind)) bad.push(`${g} got ${a.features.kind}`);
      }
      expect(bad.slice(0, 5)).toEqual([]);
      // R3: a corner lines up outside the core box in every default design, so no drawing of his is a spy.
      if (["DL", "LB", "S"].includes(g)) for (const k of ["blitz", "zone", "spy"]) expect([...seen], g).toContain(k);
      if (g === "CB") {
        const box = playbook.config.classifier.coreBox;
        for (const c of pool) expect(Math.abs((c.alignment[c.slot] as Pair)[0]), `${c.call} ${c.slot}`).toBeGreaterThan(box.halfWidthYards);
        for (const k of ["blitz", "zone"]) expect([...seen]).toContain(k);
        expect([...seen]).not.toContain("spy");
      }
      if (g === "RB") for (const k of ["route", "block", "runPath"]) expect([...seen]).toContain(k);
    });
  }
  it("every family is reachable and every bucket with it, from random drawings of the three route positions", () => {
    const r = seeded(4);
    const fams = new Set<string>();
    const buckets = new Set<string>();
    for (let k = 0; k < 10000; k++) {
      const res = classifyPath(canonical(r), offCtx(["WR1", "WR4", "TE1", "RB1"][k % 4] as string), config);
      if (res.ok && res.features.kind === "route") {
        fams.add(res.features.family);
        buckets.add(res.features.bucket);
      }
    }
    expect([...fams].sort()).toEqual([...FAMILIES].sort());
    expect(buckets.size).toBe(4);
  });
  it("does not mutate path, context or config, and works on frozen input", () => {
    const deep = <T>(o: T): T => {
      if (typeof o === "object" && o !== null) {
        Object.values(o).forEach(deep);
        Object.freeze(o);
      }
      return o;
    };
    const path = deep([[0, 0], [0, 12], [-4, 12]] as P[]);
    const ctx = deep(structuredClone(offCtx("WR1")));
    const cfg = deep(structuredClone(config));
    expect(classifyPath(path, ctx, cfg)).toEqual(classifyPath([[0, 0], [0, 12], [-4, 12]], offCtx("WR1"), config));
  });
});

const flip = { left: "right", middle: "middle", right: "left" } as const;
function mirrored(res: ClassifyResult): ClassifyResult {
  if (!res.ok) return res;
  const f = res.features;
  if (f.kind === "route") return { ok: true, features: { ...f, endSide: flip[f.endSide] } };
  if (f.kind === "runPath" || f.kind === "blitz") return { ok: true, features: { ...f, side: flip[f.side] } };
  if (f.kind === "zone") return { ok: true, features: { ...f, third: flip[f.third] } };
  return res;
}
const flipAlign = (a: SlotAlignment): SlotAlignment => Object.fromEntries(Object.entries(a).map(([k, p]) => [k, [0 - p[0], p[1]] as Pair]));

describe("B4: mirroring path and alignment flips the side and nothing else", () => {
  for (const g of ["RB", "WR", "TE", "DL", "LB", "CB", "S"]) {
    it(g, () => {
      const pool = contexts.filter((c) => groupOf(c) === g);
      const r = seeded(2000 + g.charCodeAt(0));
      let ok = 0;
      const bad: string[] = [];
      for (let k = 0; k < 2000; k++) {
        const path = canonical(r);
        const base = pool[Math.floor(r() * pool.length)] as ClassifyContext;
        const a = classifyPath(path, base, config);
        const b = classifyPath(flipX(path), { ...base, alignment: flipAlign(base.alignment) }, config);
        if (!same(b, mirrored(a))) bad.push(text([path, base.slot, base.call, a, b]));
        if (a.ok) ok++;
      }
      expect(bad.slice(0, 5)).toEqual([]);
      expect(ok).toBeGreaterThan(300);
    });
  }
  it("library routes too, for every player on the middle of the field: he may go either way", () => {
    for (const path of [[[0, 0], [5, 8]], [[0, 0], [0, 9], [5, 14]], [[0, 0], [3, 7], [10, 8]]] as P[][]) {
      const a = classifyPath(path, offCtx("RB1"), config);
      expect(classifyPath(flipX(path), offCtx("RB1"), config)).toEqual(mirrored(a));
    }
  });
});

describe("B4 and B9: a raw stroke and its mirror quantize to mirrors", () => {
  const raw = (path: readonly (readonly [number, number])[]) => quantizePath(path, config);
  const flipRaw = (path: readonly (readonly [number, number])[]): P[] => path.map(([x, y]) => [0 - x, y]);
  const want = (q: ReturnType<typeof raw>) => (q.ok ? { ok: true, path: flipX(q.path) } : q);
  it("one point on every quarter-yard tie across the field", () => {
    for (let x = 0.25; x < 27; x += 0.5) {
      const q = raw([[0, 0], [x, 10.1]]);
      // A tie may go either way, but half a yard at most, and the mirror goes with it.
      if (!q.ok) throw new Error(q.reason);
      expect(Math.abs((q.path.at(-1) as P)[0] - x), `${x}`).toBe(0.25);
      expect(raw([[0, 0], [-x, 10.1]]), `${x}`).toEqual(want(q));
    }
  });
  it("3,000 strokes on the quarter yard, 3,000 anywhere and 1,000 long ones that must be thinned", () => {
    const r = seeded(4242);
    let ties = 0;
    let ok = 0;
    let uneven = 0;
    for (let k = 0; k < 7000; k++) {
      const points = k < 6000 ? 1 + Math.floor(r() * 8) : 40 + Math.floor(r() * 60);
      const reach = k < 6000 ? 5 : 0.8;
      const path: [number, number][] = [[0, 0]];
      for (let i = 0; i < points; i++) {
        const [x, y] = path.at(-1) as [number, number];
        const step: [number, number] = [(r() * 2 - 1) * reach, (r() * 2 - 0.6) * reach];
        path.push(k < 3000 ? [Math.round((x + step[0]) * 4) / 4, Math.round((y + step[1]) * 4) / 4] : [x + step[0], y + step[1]]);
      }
      const q = raw(path);
      expect(raw(flipRaw(path)), JSON.stringify(path)).toEqual(want(q));
      if (!q.ok) continue;
      ok++;
      if (path.some(([x]) => x * 4 === Math.round(x * 4) && x * 2 !== Math.round(x * 2))) ties++;
      if (q.path.some(([x]) => x !== 0)) uneven++;
    }
    expect(ok).toBeGreaterThan(4000);
    expect(ties).toBeGreaterThan(1500);
    expect(uneven).toBeGreaterThan(4000);
  });
});

/** Inserts on-grid points along a path's own segments while the point limit allows. */
function thicken(path: P[], r: () => number): P[] {
  const out: P[] = [path[0] as P];
  let room = 12 - path.length;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as P;
    const b = path[i] as P;
    const ux = Math.round((b[0] - a[0]) * 2);
    const uy = Math.round((b[1] - a[1]) * 2);
    let [m, n] = [Math.abs(ux), Math.abs(uy)];
    while (n !== 0) [m, n] = [n, m % n];
    for (let k = 1; k < m; k++) {
      if (room > 0 && r() < 0.5) {
        out.push([a[0] + (ux / m) * (k / 2), a[1] + (uy / m) * (k / 2)]);
        room--;
      }
    }
    out.push(b);
  }
  return out;
}

describe("B5: collinear points and re-quantizing change nothing", () => {
  it("by hand: a dig with extra points on both legs", () => {
    const plain = feat([[0, 0], [0, 15], [12, 15]], offCtx("WR1"));
    expect(feat([[0, 0], [0, 1], [0, 4], [0, 14.5], [0, 15], [0.5, 15], [6, 15], [12, 15]], offCtx("WR1"))).toEqual(plain);
  });
  for (const g of ["RB", "WR", "TE", "LB", "S"]) {
    it(g, () => {
      const pool = contexts.filter((c) => groupOf(c) === g);
      const r = seeded(3000 + g.charCodeAt(0));
      let thick = 0;
      const bad: string[] = [];
      for (let k = 0; k < 2000; k++) {
        const path = canonical(r);
        const ctx = pool[Math.floor(r() * pool.length)] as ClassifyContext;
        const base = classifyPath(path, ctx, config);
        const more = thicken(path, r);
        if (more.length > path.length) thick++;
        if (!same(classifyPath(more, ctx, config), base)) bad.push(`collinear ${text([path, more, ctx.slot])}`);
        const q = quantizePath(path, config);
        if (!q.ok) bad.push(`canonical path refused: ${q.reason} ${text(path)}`);
        else if (!same(classifyPath(q.path, ctx, config), base)) bad.push(`requantized ${text([path, q.path, ctx.slot])}`);
      }
      expect(bad.slice(0, 5)).toEqual([]);
      expect(thick).toBeGreaterThan(500);
    });
  }
});

describe("B3: library agreement, every route at every slot that uses it", () => {
  const f = files();
  let uses = 0;
  for (const d of f.offense.designs) {
    const routes = Object.entries(d.assignments).filter(([, v]) => f.library.assignments[ref(v).use]?.kind === "route");
    if (routes.length === 0) continue;
    it(d.id, () => {
      for (const [slot, v] of routes) {
        const e = f.library.assignments[ref(v).use];
        if (e?.kind !== "route") continue;
        const align = (f.alignments.offense[d.formation] as Record<string, Pair>)[slot] as Pair;
        const exact = drawnFrom(e, align, ref(v), e.breakAt);
        const snapped = exact.map(([x, y]): P => [Math.round(x * 2) / 2 + 0, Math.round(y * 2) / 2 + 0]).filter((p, i, a) => i === 0 || p[0] !== (a[i - 1] as P)[0] || p[1] !== (a[i - 1] as P)[1]);
        expect(isCanonical(snapped, config), slot).toBe(true);
        // R1: a go, post, corner or wheel is caught at its end, any other route at its break.
        const declared = (CAUGHT_AT_END.includes(e.family) ? (exact.at(-1) as P) : (exact[e.breakAt + 1] as P))[1] - align[1];
        // A half yard may go either way to whole yards.
        const depths = [Math.floor(declared + 0.5), Math.ceil(declared - 0.5)];
        const bucketsOk = depths.map((n) => (n < 0 ? "behind" : n < 10 ? "short" : n < 20 ? "intermediate" : "deep"));
        const ctx = offenseContext(offense(d.id), playbook, slot, 40);
        const q = quantizePath(exact, config);
        if (!q.ok) throw new Error(`${slot} ${q.reason}`);
        for (const path of [snapped, q.path]) {
          // The route's own meaning, without the concept check (a fake back's route breaks nothing in the library).
          const res = classifyPath(path, { ...ctx, call: "shortPass" }, config);
          expect(res, `${slot} ${ref(v).use} ${JSON.stringify(path)}`).toMatchObject({ ok: true, features: { kind: "route", family: e.family, direction: e.direction } });
          if (!res.ok || res.features.kind !== "route") continue;
          expect(bucketsOk, `${slot} ${ref(v).use}`).toContain(res.features.bucket);
          expect(depths, `${slot} ${ref(v).use} catch depth`).toContain(res.features.catchDepth);
          expect(res.features.breakDepth, `${slot} ${ref(v).use} break depth`).toBe(whole(ownBreak(path, align[1]).y));
          // R11: the library declares what the rule gives, so the rule is applied here by hand.
          expect(rulings([...path] as P[], align, res.features), `${slot} ${ref(v).use}`).toBeNull();
        }
        uses++;
      }
      expect(uses).toBeGreaterThan(0);
    });
  }
  it("run paths drawn as the library has them classify to their declared gap", () => {
    for (const d of f.offense.designs.filter((x) => x.carrier?.startsWith("RB") === true)) {
      const slot = d.carrier as string;
      const v = ref(d.assignments[slot] as string);
      const e = f.library.assignments[v.use];
      if (e?.kind !== "runPath") throw new Error(d.id);
      const align = (f.alignments.offense[d.formation] as Record<string, Pair>)[slot] as Pair;
      const dir = e.axis === "none" ? 0 : v.to === "left" ? -1 : 1;
      const raw: P[] = [[0, 0], ...e.pts.map((p): P => [dir * p[0] - align[0], p[1] + align[1]])];
      const q = quantizePath(raw, config);
      if (!q.ok) throw new Error(`${d.id} ${q.reason}`);
      expect(classifyPath(q.path, offenseContext(offense(d.id), playbook, slot, 40), config), d.id).toMatchObject({ ok: true, features: { kind: "runPath", gap: e.gap } });
    }
  });
});
