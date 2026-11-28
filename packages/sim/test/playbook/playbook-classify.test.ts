// M3 milestone B (docs/specs/m3-playbook-and-custom-routes.md): the assignment classifier.
// Tests are named by criterion, B0 to B10. The playbook is validated through the shared zod
// schema here in the test, never inside packages/sim/src.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REASON_CODES, ROUTE_DIRECTIONS, ROUTE_FAMILIES, DEPTH_BUCKETS, RUN_GAPS, declaredCatchDepth, declaredDepth, defenseAlignment, depthBucket, placePath, positionOf, resolveDefense, resolveOffense, slotsOf, wholeYards } from "../../../shared/src/playbook";
import type { DefenseDesign, OffenseDesign, PathPoint, SlotAlignment } from "../../../shared/src/playbook";
import { loadPlaybook, playbookRefs, repoRoot } from "../../../shared/test/playbook-load";
import { classifyConfig, classifyPath, defenseContext, isCanonical, offenseContext, quantizePath } from "../../src/playbook/classify";
import type { ClassifyConfig, ClassifyContext, ClassifyResult, Features } from "../../src/playbook/classify";
import { Rng } from "../../src/rng";
import { loadRules } from "../support/rules";

const pb = loadPlaybook();
const refs = playbookRefs();
const { rules } = loadRules();
const cfg = classifyConfig(pb.config, refs.depthEdges, rules.field.endZoneYards);

const offense = (id: string): OffenseDesign => pb.offense.designs.find((d) => d.id === id) as OffenseDesign;
const defense = (id: string): DefenseDesign => pb.defense.designs.find((d) => d.id === id) as DefenseDesign;
const octx = (id: string, slot: string, spot = 50): ClassifyContext => offenseContext(offense(id), pb, slot, spot);
const dctx = (id: string, slot: string, spot = 50): ClassifyContext => defenseContext(defense(id), pb, slot, spot);
const classify = (path: readonly PathPoint[], context: ClassifyContext, config: ClassifyConfig = cfg): ClassifyResult => classifyPath(path, context, config);
const featuresOf = (r: ClassifyResult): Features => {
  if (!r.ok) throw new Error(`expected features, got ${r.reason}`);
  return r.features;
};
const reasonOf = (r: ClassifyResult): string => (r.ok ? `ok:${r.features.kind}` : r.reason);

/** Every design and slot, offense and defense: the contexts the property tests cycle through. */
const CONTEXTS: ((spot: number) => ClassifyContext)[] = [
  ...pb.offense.designs.flatMap((d) => Object.keys(pb.alignments.offense[d.formation] ?? {}).map((slot) => (spot: number) => offenseContext(d, pb, slot, spot))),
  ...pb.defense.designs.flatMap((d) => Object.keys(defenseAlignment(d, pb.alignments)).map((slot) => (spot: number) => defenseContext(d, pb, slot, spot))),
  ...["punt", "fieldGoal", "kneel", "spike"].map((call) => (spot: number): ClassifyContext => ({ ...offenseContext(offense("shotgun.shortPass.mesh"), pb, "WR1", spot), call })),
];

function pathLength(path: readonly PathPoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot((path[i] as PathPoint)[0] - (path[i - 1] as PathPoint)[0], (path[i] as PathPoint)[1] - (path[i - 1] as PathPoint)[1]);
  return total;
}

/** A seeded random canonical path: 1 to 12 points on the half-yard grid, at most 60 yards. */
function randomPath(rng: Rng, maxPoints = 12): PathPoint[] {
  const n = 1 + Math.floor(rng.nextFloat() * maxPoints);
  const reach = [1, 3, 8, 20][Math.floor(rng.nextFloat() * 4)] as number;
  const pts: PathPoint[] = [[0, 0]];
  while (pts.length < n) {
    const last = pts[pts.length - 1] as PathPoint;
    const dx = Math.round((rng.nextFloat() * 2 - 1) * reach * 2) / 2;
    const dy = Math.round((rng.nextFloat() * 2 - 1) * reach * 2) / 2;
    if (dx === 0 && dy === 0) continue;
    pts.push([last[0] + dx, last[1] + dy]);
  }
  while (pathLength(pts) > 60) pts.pop();
  return pts;
}

/** A raw stroke as a finger would draw it: many points along a few legs, off the grid, with jitter. */
function randomStroke(rng: Rng, points: number): [number, number][] {
  const legs = 1 + Math.floor(rng.nextFloat() * 4);
  const corners: [number, number][] = [[rng.nextFloat() - 0.5, rng.nextFloat() - 0.5]];
  for (let i = 0; i < legs; i++) {
    const last = corners[corners.length - 1] as [number, number];
    corners.push([last[0] + (rng.nextFloat() * 2 - 1) * 9, last[1] + (rng.nextFloat() * 2 - 1) * 9]);
  }
  const out: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const at = (i / Math.max(1, points - 1)) * legs;
    const leg = Math.min(legs - 1, Math.floor(at));
    const a = corners[leg] as [number, number];
    const b = corners[leg + 1] as [number, number];
    const f = at - leg;
    out.push([a[0] + (b[0] - a[0]) * f + (rng.nextFloat() - 0.5) * 0.3, a[1] + (b[1] - a[1]) * f + (rng.nextFloat() - 0.5) * 0.3]);
  }
  return out;
}

const THIRDS = ["left", "middle", "right"];

/** The closed shape of a result: one kind with exactly its features, or one reason. */
function shapeProblem(r: ClassifyResult): string | null {
  const keys = (o: object) => Object.keys(o).sort().join(",");
  if (!r.ok) return keys(r) === "ok,reason" && (REASON_CODES as readonly string[]).includes(r.reason) ? null : `bad reason ${JSON.stringify(r)}`;
  if (keys(r) !== "features,ok") return `bad result ${JSON.stringify(r)}`;
  const f = r.features;
  const good =
    f.kind === "route"
      ? keys(f) === "breakDepth,bucket,catchDepth,crossesMiddle,direction,endSide,family,kind" && ROUTE_FAMILIES.includes(f.family) && Number.isInteger(f.breakDepth) && Number.isInteger(f.catchDepth) && DEPTH_BUCKETS.includes(f.bucket) && ROUTE_DIRECTIONS.includes(f.direction) && THIRDS.includes(f.endSide) && typeof f.crossesMiddle === "boolean"
      : f.kind === "block"
        ? keys(f) === "block,kind" && f.block === "pass"
        : f.kind === "runPath"
          ? keys(f) === "gap,kind,side" && RUN_GAPS.includes(f.gap) && THIRDS.includes(f.side)
          : f.kind === "blitz"
            ? keys(f) === "kind,lane,side" && ["inside", "edge"].includes(f.lane) && THIRDS.includes(f.side)
            : f.kind === "zone"
              ? keys(f) === "kind,level,third" && ["under", "deep"].includes(f.level) && THIRDS.includes(f.third)
              : f.kind === "spy" && keys(f) === "kind";
  return good ? null : `bad features ${JSON.stringify(f)}`;
}

describe("B0: who may be drawn and the field's size are read from data", () => {
  it("the end zone depth comes from the cited rule set and the field width from data/plays/config.json", () => {
    expect(cfg.endZoneYards).toBe(rules.field.endZoneYards);
    expect(cfg.fieldWidthYards).toBe(pb.config.field.widthYards);
    const wide: PathPoint[] = [[0, 0], [-5, 0]];
    expect(reasonOf(classify(wide, octx("shotgun.shortPass.mesh", "WR1")))).toBe("ok:route");
    expect(reasonOf(classify(wide, octx("shotgun.shortPass.mesh", "WR1"), { ...cfg, fieldWidthYards: 50 }))).toBe("outOfBounds");
    const deep: PathPoint[] = [[0, 0], [0, 14]];
    expect(reasonOf(classify(deep, octx("shotgun.shortPass.mesh", "WR1", 98)))).toBe("outOfBounds");
    expect(reasonOf(classify(deep, octx("shotgun.shortPass.mesh", "WR1", 98), { ...cfg, endZoneYards: 20 }))).toBe("ok:route");
  });

  it("the positions that may be drawn come from data/plays/config.json", () => {
    const path: PathPoint[] = [[0, 0], [0, 6]];
    expect(reasonOf(classify(path, octx("shotgun.shortPass.mesh", "TE1")))).toBe("ok:route");
    expect(reasonOf(classify(path, octx("shotgun.shortPass.mesh", "TE1"), { ...cfg, routePositions: ["WR", "RB"] }))).toBe("ineligible");
  });

  it("eligibility and field width are confirmed, and cited in docs/RULES.md (R8)", () => {
    expect(pb.config.eligibility.status).toBe("confirmed");
    expect(pb.config.field.status).toBe("confirmed");
    expect([pb.config.field.widthFeet, pb.config.field.widthYards]).toEqual([160, 160 / 3]);
    const doc = readFileSync(join(repoRoot, "docs/RULES.md"), "utf8");
    expect(doc).toMatch(/## Field dimensions[\s\S]*160 feet wide[\s\S]*## Eligible pass receivers/);
  });
});

describe("B1: the same path, context and config give the same result", () => {
  it("is deterministic and leaves its inputs alone", () => {
    const rng = Rng.fromSeed(101);
    for (let i = 0; i < 5000; i++) {
      const path = randomPath(rng);
      const context = (CONTEXTS[i % CONTEXTS.length] as (typeof CONTEXTS)[number])(1 + Math.floor(rng.nextFloat() * 99));
      const before = JSON.stringify([path, context]);
      const a = classify(path, context);
      const b = classify(path.map((p): PathPoint => [p[0], p[1]]), { ...context }, classifyConfig(pb.config, { ...refs.depthEdges }, rules.field.endZoneYards));
      expect(b).toEqual(a);
      expect(JSON.stringify([path, context])).toBe(before);
    }
  });

  it("takes no random source: its only arguments are the path, the context and the config", () => {
    expect(classifyPath.length).toBe(3);
    expect(quantizePath.length).toBe(2);
    const source = readFileSync(join(repoRoot, "packages/sim/src/playbook/classify.ts"), "utf8");
    expect(source).not.toMatch(/\brng\b|Rng|Date\.|performance|document|window/);
  });
});

describe("B2: total over 100,000 random canonical paths and every slot", () => {
  it("always returns one kind with its features or one reason from the closed list", () => {
    const rng = Rng.fromSeed(202);
    const seen = new Map<string, number>();
    const slots = new Set<string>();
    for (let i = 0; i < 100_000; i++) {
      const path = randomPath(rng);
      const context = (CONTEXTS[i % CONTEXTS.length] as (typeof CONTEXTS)[number])(1 + Math.floor(rng.nextFloat() * 99));
      const r = classify(path, context);
      const problem = shapeProblem(r);
      if (problem !== null) throw new Error(`${problem} for ${JSON.stringify(path)} at ${context.call} ${context.slot}`);
      seen.set(reasonOf(r), (seen.get(reasonOf(r)) ?? 0) + 1);
      slots.add(`${context.side}:${context.call}:${context.slot}`);
    }
    for (const kind of ["route", "block", "runPath", "blitz", "zone", "spy"]) expect(seen.get(`ok:${kind}`) ?? 0, kind).toBeGreaterThan(0);
    for (const reason of ["ineligible", "notOnThisCall", "tooShort", "tooManyBreaks", "outOfBounds", "wrongGap", "breaksConcept"]) expect(seen.get(reason) ?? 0, reason).toBeGreaterThan(0);
    // Every slot of every formation and concept, and of every preset.
    for (const d of pb.offense.designs) for (const s of slotsOf(refs.personnel.offense[d.formation] ?? {})) expect(slots.has(`offense:${d.concept}:${s}`), `${d.id} ${s}`).toBe(true);
    for (const d of pb.defense.designs) for (const s of slotsOf(refs.personnel.packages[d.package] ?? {})) expect(slots.has(`defense:${d.coverage}:${s}`), `${d.id} ${s}`).toBe(true);
  });

  it("never throws on junk that is not a canonical path", () => {
    const context = octx("shotgun.shortPass.mesh", "WR1");
    const junk: unknown[] = [[], [[0, 0], [NaN, 1]], [[0, 0], [Infinity, 1]], [[1, 1]], [[0, 0], [0, 0]], [[0, 0], [0.25, 3]], "path", null, [[0, 0], [1]], [[0, 0], ["a", "b"]]];
    for (const j of junk) expect(reasonOf(classify(j as PathPoint[], context)), JSON.stringify(j)).toBe("notCanonical");
  });
});

describe("B3: every library route classifies to its declared family, bucket and direction", () => {
  it("at every slot of every design that uses it", () => {
    let checked = 0;
    const used = new Set<string>();
    for (const d of pb.offense.designs) {
      const alignment = pb.alignments.offense[d.formation] as SlotAlignment;
      for (const r of resolveOffense(d, pb, slotsOf(refs.personnel.offense[d.formation] ?? {}))) {
        if (r.entry.kind !== "route") continue;
        const align = alignment[r.slot] as [number, number];
        const q = quantizePath(placePath(r.entry, align, r.to, r.ref.depth), cfg);
        if (!q.ok) throw new Error(`${d.id} ${r.slot}: ${q.reason}`);
        // The geometry alone: a plain pass call, so the screen and play action guards stay out of it.
        const f = featuresOf(classify(q.path, { ...offenseContext(d, pb, r.slot, 50), call: "shortPass" }));
        // The bucket reads the catch depth (R1). A vertical route's declared waypoint is its end, not a break.
        const depth = declaredCatchDepth(r.entry, align, r.ref.depth, cfg.thresholds.catchAtEnd);
        expect([d.id, r.slot, r.use, f.kind === "route" ? [f.family, f.direction, f.bucket, f.catchDepth] : f.kind]).toEqual([d.id, r.slot, r.use, [r.entry.family, r.entry.direction, depthBucket(depth, refs.depthEdges), depth]]);
        if (f.kind === "route" && r.entry.direction !== "vertical") expect([d.id, r.slot, f.breakDepth]).toEqual([d.id, r.slot, wholeYards(declaredDepth(r.entry, align, r.ref.depth))]);
        used.add(r.use);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(250);
    const routes = Object.entries(pb.library.assignments).filter(([, e]) => e.kind === "route").map(([id]) => id);
    expect([...used].sort()).toEqual(routes.sort());
  });

  it("the shipped designs' own routes are legal in their own call, at midfield, a faking back's too (R14)", () => {
    for (const d of pb.offense.designs) {
      const alignment = pb.alignments.offense[d.formation] as SlotAlignment;
      for (const r of resolveOffense(d, pb, slotsOf(refs.personnel.offense[d.formation] ?? {}))) {
        if (r.entry.kind !== "route") continue;
        const q = quantizePath(placePath(r.entry, alignment[r.slot] as [number, number], r.to, r.ref.depth), cfg);
        expect(q.ok && reasonOf(classify(q.path, offenseContext(d, pb, r.slot, 50))), `${d.id} ${r.slot}`).toBe("ok:route");
      }
    }
  });

  it("library run paths, rushes, blitzes and stunts classify to their declared gap and lane", () => {
    for (const d of pb.offense.designs) {
      const alignment = pb.alignments.offense[d.formation] as SlotAlignment;
      for (const r of resolveOffense(d, pb, slotsOf(refs.personnel.offense[d.formation] ?? {}))) {
        // The quarterback is never drawn, so only a back's run path can go through the classifier.
        if (r.entry.kind !== "runPath" || r.position !== "RB") continue;
        const q = quantizePath(placePath(r.entry, alignment[r.slot] as [number, number], r.to), cfg);
        expect(q.ok && classify(q.path, offenseContext(d, pb, r.slot, 50)), `${d.id} ${r.use}`).toMatchObject({ ok: true, features: { kind: "runPath", gap: r.entry.gap } });
      }
    }
    for (const d of pb.defense.designs) {
      const alignment = defenseAlignment(d, pb.alignments);
      for (const r of resolveDefense(d, pb, slotsOf(refs.personnel.packages[d.package] ?? {}))) {
        if (r.entry.kind === "rush" || r.entry.kind === "blitz" || r.entry.kind === "stunt") {
          const q = quantizePath(placePath(r.entry, alignment[r.slot] as [number, number]), cfg);
          expect(q.ok && classify(q.path, defenseContext(d, pb, r.slot, 50)), `${d.id} ${r.slot} ${r.use}`).toMatchObject({ ok: true, features: { kind: "blitz", lane: r.entry.lane } });
        }
        if (r.entry.kind === "zone" && r.ref.at !== undefined) {
          const a = alignment[r.slot] as [number, number];
          const q = quantizePath([[0, 0], [r.ref.at[0] - a[0], r.ref.at[1] - a[1]]], cfg);
          const f = q.ok ? classify(q.path, defenseContext(d, pb, r.slot, 50)) : q;
          // A short drop too (a linebacker's 1-yard hook): the base assignment is known (R3).
          expect(f, `${d.id} ${r.slot}`).toMatchObject({ ok: true, features: { kind: "zone", level: r.entry.level, third: r.entry.third } });
        }
      }
    }
  });
});

const flip = (side: string): string => (side === "left" ? "right" : side === "right" ? "left" : side);
function mirrored(f: Features): Features {
  if (f.kind === "route") return { ...f, endSide: flip(f.endSide) as typeof f.endSide };
  if (f.kind === "runPath" || f.kind === "blitz") return { ...f, side: flip(f.side) as typeof f.side };
  if (f.kind === "zone") return { ...f, third: flip(f.third) as typeof f.third };
  return f;
}

describe("B4: mirroring the path and the alignment in x flips the end side and nothing else", () => {
  it("holds over 20,000 random paths across every slot", () => {
    const rng = Rng.fromSeed(404);
    let routes = 0;
    for (let i = 0; i < 20_000; i++) {
      const path = randomPath(rng);
      const context = (CONTEXTS[(i * 7) % CONTEXTS.length] as (typeof CONTEXTS)[number])(1 + Math.floor(rng.nextFloat() * 99));
      const mirrorContext: ClassifyContext = { ...context, alignment: Object.fromEntries(Object.entries(context.alignment).map(([k, a]) => [k, [-a[0] + 0, a[1]] as const])) };
      const a = classify(path, context);
      const b = classify(path.map((p): PathPoint => [-p[0] + 0, p[1]]), mirrorContext);
      if (a.ok && a.features.kind === "route") routes++;
      expect(b, `${JSON.stringify(path)} at ${context.call} ${context.slot}`).toEqual(a.ok ? { ok: true, features: mirrored(a.features) } : a);
    }
    expect(routes).toBeGreaterThan(1000);
  });

  it("a named case: a slant from the left and from the right", () => {
    const left = featuresOf(classify([[0, 0], [0, 3], [5, 8]], octx("shotgun.shortPass.mesh", "WR1")));
    const right = featuresOf(classify([[0, 0], [0, 3], [-5, 8]], octx("shotgun.shortPass.mesh", "WR2")));
    expect(left).toEqual({ kind: "route", family: "slant", breakDepth: 2, catchDepth: 2, bucket: "short", direction: "in", endSide: "left", crossesMiddle: false });
    expect(right).toEqual({ ...left, endSide: "right" });
  });
});

describe("B5: collinear points and quantizing a canonical path change nothing", () => {
  it("adding points on a straight segment changes no feature", () => {
    const rng = Rng.fromSeed(505);
    let compared = 0;
    for (let i = 0; i < 20_000; i++) {
      const path = randomPath(rng, 6);
      const dense: PathPoint[] = [[0, 0]];
      for (let k = 1; k < path.length; k++) {
        const a = path[k - 1] as PathPoint;
        const b = path[k] as PathPoint;
        // Every half-yard grid point strictly inside the segment, up to the point limit.
        const steps = [4, 3, 2].find((n) => Number.isInteger(((b[0] - a[0]) / n) * 2) && Number.isInteger(((b[1] - a[1]) / n) * 2)) ?? 1;
        for (let s = 1; s <= steps; s++) dense.push(s === steps ? b : [a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
      }
      if (dense.length === path.length || dense.length > cfg.thresholds.maxPoints) continue;
      const context = (CONTEXTS[(i * 11) % CONTEXTS.length] as (typeof CONTEXTS)[number])(50);
      expect(classify(dense, context), JSON.stringify(dense)).toEqual(classify(path, context));
      compared++;
    }
    expect(compared).toBeGreaterThan(2000);
  });

  it("quantizing an already canonical path changes no feature, even one with a sharp break between tiny legs", () => {
    const rng = Rng.fromSeed(506);
    for (let i = 0; i < 20_000; i++) {
      const path = randomPath(rng);
      const q = quantizePath(path, cfg);
      if (!q.ok) throw new Error(`a canonical path was refused: ${q.reason}`);
      const context = (CONTEXTS[(i * 13) % CONTEXTS.length] as (typeof CONTEXTS)[number])(50);
      expect(classify(q.path, context)).toEqual(classify(path, context));
    }
    const sharp: PathPoint[] = [[0, 0], [0.5, 0], [1, 0.5], [1, 8]];
    expect(quantizePath(sharp, cfg)).toEqual({ ok: true, path: sharp });
  });
});

describe("B6: one fixture per reason code", () => {
  const go: PathPoint[] = [[0, 0], [0, 12]];
  const zigzag = (turns: number, leg: number): PathPoint[] => Array.from({ length: turns + 2 }, (_, i): PathPoint => [i % 2 === 0 ? 0 : leg, i * leg]);

  const cases: [string, string, readonly (readonly number[])[], ClassifyContext][] = [
    ["noSuchSlot", "a slot the formation does not have", go, octx("shotgun.shortPass.mesh", "WR4")],
    ["noSuchSlot", "a defense slot the package does not have", go, dctx("baseCover3.sky", "CB3")],
    ["ineligible", "a lineman", go, octx("shotgun.shortPass.mesh", "OL3")],
    ["ineligible", "the quarterback", go, octx("shotgun.shortPass.mesh", "QB1")],
    ["ineligible", "the quarterback on his own run", [[0, 0], [0, 8]], octx("empty.insideRun.qbDraw", "QB1")],
    ["notOnThisCall", "a punt", go, { ...octx("shotgun.shortPass.mesh", "WR1"), call: "punt" }],
    ["notOnThisCall", "a kneel", go, { ...octx("shotgun.shortPass.mesh", "WR1"), call: "kneel" }],
    ["notOnThisCall", "a spike", go, { ...octx("shotgun.shortPass.mesh", "WR1"), call: "spike" }],
    ["notOnThisCall", "a QB sneak", go, octx("shotgun.qbSneak.sneak", "RB1")],
    ["notOnThisCall", "a receiver on a run", go, octx("shotgun.insideRun.insideZone", "WR1")],
    ["notOnThisCall", "a tight end on a run", [[0, 0]], octx("shotgun.insideRun.insideZone", "TE1")],
    ["notCanonical", "a point off the half-yard grid", [[0, 0], [0.3, 6]], octx("shotgun.shortPass.mesh", "WR1")],
    ["notCanonical", "a path that does not start at the alignment", [[1, 0], [1, 6]], octx("shotgun.shortPass.mesh", "WR1")],
    ["notCanonical", "a repeated point", [[0, 0], [0, 6], [0, 6]], octx("shotgun.shortPass.mesh", "WR1")],
    ["notCanonical", "thirteen points", Array.from({ length: 13 }, (_, i) => [0, i]), octx("shotgun.shortPass.mesh", "WR1")],
    ["notCanonical", "an empty path", [], octx("shotgun.shortPass.mesh", "WR1")],
    ["tooShort", "a wide receiver's path under 2 yards", [[0, 0], [0, 1.5]], octx("shotgun.shortPass.mesh", "WR1")],
    ["tooShort", "a wide receiver's tap", [[0, 0]], octx("shotgun.shortPass.mesh", "WR1")],
    ["tooLong", "more than 60 yards of path", zigzag(9, 6), octx("shotgun.shortPass.mesh", "WR1", 20)],
    ["tooManyBreaks", "four breaks", zigzag(4, 2), octx("shotgun.shortPass.mesh", "WR1")],
    ["outOfBounds", "a deep route near the goal line", [[0, 0], [0, 20]], octx("shotgun.shortPass.mesh", "WR1", 95)],
    ["outOfBounds", "a route past the end line on a two-point try", [[0, 0], [0, 13.5]], octx("shotgun.shortPass.mesh", "WR1", 98)],
    ["outOfBounds", "the left sideline", [[0, 0], [0, 5], [-6, 5]], octx("shotgun.shortPass.mesh", "WR1")],
    ["outOfBounds", "the right sideline", [[0, 0], [0, 5], [6, 5]], octx("shotgun.shortPass.mesh", "WR2")],
    ["outOfBounds", "the offense's own end line", [[0, 0], [0, -7]], octx("shotgun.shortPass.mesh", "RB1", 1)],
    ["outOfBounds", "a defender past the sideline", [[0, 0], [-6, 4]], dctx("baseCover3.sky", "CB1")],
    ["wrongGap", "an inside run drawn around the edge", [[0, 0], [12, 3], [12, 9]], octx("shotgun.insideRun.insideZone", "RB1")],
    ["wrongGap", "an outside run drawn up the middle", [[0, 0], [2, 9]], octx("shotgun.outsideRun.outsideZone", "RB1")],
    ["wrongGap", "a run path that never reaches the line", [[0, 0], [6, 2]], octx("shotgun.insideRun.insideZone", "RB1")],
    ["breaksConcept", "the faking back on play action", [[0, 0], [8, 8]], octx("shotgun.playAction.paPost", "RB1")],
    ["breaksConcept", "a screen's only route behind the line, drawn downfield", [[0, 0], [6, 10]], octx("shotgun.screenPass.backScreen", "RB1")],
    ["breaksConcept", "a screen's only route behind the line, kept in to block", [[0, 0]], octx("shotgun.screenPass.backScreen", "RB1")],
  ];
  it.each(cases)("%s: %s", (reason, _name, path, context) => {
    expect(reasonOf(classify(path as PathPoint[], context))).toBe(reason);
  });

  it("covers every reason code", () => {
    expect([...new Set(cases.map((c) => c[0]))].sort()).toEqual([...REASON_CODES].sort());
  });

  it("the near side of each limit is accepted", () => {
    expect(reasonOf(classify([[0, 0], [0, 2]], octx("shotgun.shortPass.mesh", "WR1")))).toBe("ok:route");
    expect(reasonOf(classify(zigzag(3, 2), octx("shotgun.shortPass.mesh", "WR1")))).toBe("ok:route");
    expect(reasonOf(classify([[0, 0], [0, 13]], octx("shotgun.shortPass.mesh", "WR1", 98)))).toBe("ok:route");
    expect(reasonOf(classify([[0, 0], [0, 5], [-5.5, 5]], octx("shotgun.shortPass.mesh", "WR1")))).toBe("ok:route");
    expect(reasonOf(classify([[0, 0], [0, 60]], octx("shotgun.shortPass.mesh", "WR1", 20)))).toBe("ok:route");
    expect(reasonOf(classify([[0, 0], [0, 60.5]], octx("shotgun.shortPass.mesh", "WR1", 20)))).toBe("tooLong");
    expect(reasonOf(classify([[0, 0], [5, 0]], octx("shotgun.screenPass.backScreen", "RB1")))).toBe("ok:route");
    expect(reasonOf(classify([[0, 0], [6, 10]], octx("shotgun.screenPass.backScreen", "WR3")))).toBe("ok:route");
  });

  it("a tap or a tiny path: a block for a back or tight end, a spy for a defender", () => {
    expect(classify([[0, 0]], octx("shotgun.shortPass.mesh", "RB1"))).toEqual({ ok: true, features: { kind: "block", block: "pass" } });
    expect(classify([[0, 0], [1, 1]], octx("shotgun.shortPass.mesh", "TE1"))).toEqual({ ok: true, features: { kind: "block", block: "pass" } });
    expect(classify([[0, 0]], dctx("baseCover3.sky", "LB2"))).toEqual({ ok: true, features: { kind: "spy" } });
  });

  it("the ball carrier's drawn path gives its gap and side", () => {
    expect(classify([[0, 0], [5, 4], [5, 9]], octx("shotgun.insideRun.insideZone", "RB1"))).toEqual({ ok: true, features: { kind: "runPath", gap: "B", side: "right" } });
    expect(classify([[0, 0], [2, 4], [2, 9]], octx("shotgun.insideRun.insideZone", "RB1"))).toEqual({ ok: true, features: { kind: "runPath", gap: "A", side: "middle" } });
    expect(classify([[0, 0], [-8, 3], [-8, 9]], octx("shotgun.outsideRun.outsideZone", "RB1"))).toEqual({ ok: true, features: { kind: "runPath", gap: "edge", side: "left" } });
  });
});

describe("B7: defense kinds, with a fixture on each side of every threshold", () => {
  // LB2 in Base Cover 3 lines up at [0, 5]; S1 at [-7, 12]; LB3 at [4, 5].
  const lb = (path: PathPoint[]) => classify(path, dctx("baseCover3.sky", "LB2"));
  const from = (slot: string, path: PathPoint[]) => classify(path, dctx("baseCover3.sky", slot));

  it("spy radius: a net move under 2 yards is a spy, 2 yards is not", () => {
    expect(lb([[0, 0], [1.5, 0]])).toEqual({ ok: true, features: { kind: "spy" } });
    expect(lb([[0, 0], [2, 0]])).toEqual({ ok: true, features: { kind: "zone", level: "under", third: "middle" } });
    // Net move, not path length: out and back is still a spy.
    expect(lb([[0, 0], [6, 0], [0.5, 0.5]])).toEqual({ ok: true, features: { kind: "spy" } });
  });

  it("blitz or zone: ending on or behind the offense's line is a blitz (R13), half a yard short of it a zone", () => {
    expect(lb([[0, 0], [0, -5.5]])).toEqual({ ok: true, features: { kind: "blitz", lane: "inside", side: "middle" } });
    expect(lb([[0, 0], [0, -5]])).toEqual({ ok: true, features: { kind: "blitz", lane: "inside", side: "middle" } });
    expect(lb([[0, 0], [0, -4.5]])).toEqual({ ok: true, features: { kind: "zone", level: "under", third: "middle" } });
  });

  it("blitz lane: inside under 5 yards from the ball where it crosses the line, edge from 5", () => {
    expect(from("LB3", [[0, 0], [0.5, -5], [0.5, -6]])).toMatchObject({ features: { kind: "blitz", lane: "inside", side: "right" } });
    expect(from("LB3", [[0, 0], [1, -5], [1, -6]])).toMatchObject({ features: { kind: "blitz", lane: "edge", side: "right" } });
    expect(from("LB1", [[0, 0], [-1, -5], [-1, -6]])).toMatchObject({ features: { kind: "blitz", lane: "edge", side: "left" } });
  });

  it("blitz side: within a yard of the ball is the middle", () => {
    expect(lb([[0, 0], [1, -5], [1, -6]])).toMatchObject({ features: { kind: "blitz", side: "middle" } });
    expect(lb([[0, 0], [1.5, -5], [1.5, -6]])).toMatchObject({ features: { kind: "blitz", side: "right" } });
    expect(lb([[0, 0], [-1.5, -5], [-1.5, -6]])).toMatchObject({ features: { kind: "blitz", side: "left" } });
  });

  it("zone level: under below 10 yards past the line, deep from 10", () => {
    expect(lb([[0, 0], [0, 4.5]])).toEqual({ ok: true, features: { kind: "zone", level: "under", third: "middle" } });
    expect(lb([[0, 0], [0, 5]])).toEqual({ ok: true, features: { kind: "zone", level: "deep", third: "middle" } });
  });

  it("zone third: each third at each level, with the edge a sixth of the field's width from the middle", () => {
    const edge = pb.config.field.widthYards / 6;
    expect(edge > 8.5 && edge < 9).toBe(true);
    for (const [dy, level] of [[1, "under"], [8, "deep"]] as const) {
      expect(lb([[0, 0], [8.5, dy]])).toEqual({ ok: true, features: { kind: "zone", level, third: "middle" } });
      expect(lb([[0, 0], [9, dy]])).toEqual({ ok: true, features: { kind: "zone", level, third: "right" } });
      expect(lb([[0, 0], [-8.5, dy]])).toEqual({ ok: true, features: { kind: "zone", level, third: "middle" } });
      expect(lb([[0, 0], [-9, dy]])).toEqual({ ok: true, features: { kind: "zone", level, third: "left" } });
    }
    expect(from("S1", [[0, 0], [-5, 6]])).toEqual({ ok: true, features: { kind: "zone", level: "deep", third: "left" } });
  });

  it("a lineman can be drawn too: dropped into a zone or sent on a blitz", () => {
    expect(from("DL1", [[0, 0], [-2, 4]])).toEqual({ ok: true, features: { kind: "zone", level: "under", third: "middle" } });
    expect(from("DL1", [[0, 0], [0, -3]])).toEqual({ ok: true, features: { kind: "blitz", lane: "edge", side: "left" } });
  });
});

describe("B8: depth buckets read the pass leaves' edges from one place", () => {
  it("data/plays/config.json holds no depth edges of its own", () => {
    const text = readFileSync(join(repoRoot, "data/plays/config.json"), "utf8");
    expect(text).not.toMatch(/"shortBelow"|"deepFrom"/);
    expect(cfg.depthEdges).toEqual({ shortBelow: 10, deepFrom: 20 });
  });

  const stem = (yards: number): PathPoint[] => [[0, 0], [0, yards + 1]]; // WR1 lines up a yard off the ball
  it("buckets sit on the leaves' edges: behind below 0, short to 9, intermediate to 19, deep from 20", () => {
    const bucket = (path: PathPoint[], slot = "WR1") => {
      const f = featuresOf(classify(path, octx("shotgun.shortPass.mesh", slot)));
      return f.kind === "route" ? f.bucket : f.kind;
    };
    expect([9, 10, 19, 20].map((y) => bucket(stem(y)))).toEqual(["short", "intermediate", "intermediate", "deep"]);
    expect(bucket([[0, 0], [3, 3]], "RB1")).toBe("behind");
    expect([-1, 0, 9, 10, 19, 20].map((y) => depthBucket(y, refs.depthEdges))).toEqual(["behind", "short", "short", "intermediate", "intermediate", "deep"]);
  });

  it("moving the caller's edges moves the route bucket and the zone level together", () => {
    const moved = classifyConfig(pb.config, { shortBelow: 8, deepFrom: 15 }, rules.field.endZoneYards);
    expect(featuresOf(classify(stem(9), octx("shotgun.shortPass.mesh", "WR1"), moved))).toMatchObject({ bucket: "intermediate" });
    expect(featuresOf(classify(stem(16), octx("shotgun.shortPass.mesh", "WR1"), moved))).toMatchObject({ bucket: "deep" });
    expect(featuresOf(classify([[0, 0], [0, 3.5]], dctx("baseCover3.sky", "LB2"), moved))).toMatchObject({ level: "deep" });
    expect(featuresOf(classify([[0, 0], [0, 3.5]], dctx("baseCover3.sky", "LB2")))).toMatchObject({ level: "under" });
  });
});

describe("B9: quantizePath is idempotent and returns a canonical path or a reason", () => {
  it("holds over 20,000 raw strokes and 20,000 canonical paths", () => {
    const rng = Rng.fromSeed(909);
    let ok = 0;
    for (let i = 0; i < 40_000; i++) {
      const raw = i % 2 === 0 ? randomStroke(rng, 2 + Math.floor(rng.nextFloat() * 400)) : randomPath(rng);
      const q = quantizePath(raw, cfg);
      if (!q.ok) {
        expect(REASON_CODES, JSON.stringify(q)).toContain(q.reason);
        continue;
      }
      ok++;
      expect(isCanonical(q.path, cfg), JSON.stringify(q.path)).toBe(true);
      expect(q.path.length).toBeLessThanOrEqual(cfg.thresholds.maxPoints);
      expect(quantizePath(q.path, cfg)).toEqual(q);
    }
    expect(ok).toBeGreaterThan(30_000);
  });

  it("named inputs: a stroke becomes a few grid points, a long one is refused, junk is refused", () => {
    expect(quantizePath([[0.1, -0.1], [0.2, 2.9], [0.1, 6.1], [2.4, 8.6], [5.1, 11.2]], cfg)).toEqual({ ok: true, path: [[0, 0], [0, 6], [5, 11]] });
    expect(quantizePath([[0.2, 0.1]], cfg)).toEqual({ ok: true, path: [[0, 0]] });
    expect(quantizePath([[0, 0], [0.1, 0.1], [0.2, -0.1]], cfg)).toEqual({ ok: true, path: [[0, 0]] });
    expect(quantizePath([[0, 0], [0, 70]], cfg)).toEqual({ ok: false, reason: "tooLong" });
    for (const junk of [[], [[0, 0], [NaN, 2]], [[0, 0], [1, Infinity]], [[0, 0], [1]], "stroke", null] as unknown[]) {
      expect(quantizePath(junk as number[][], cfg), JSON.stringify(junk)).toEqual({ ok: false, reason: "notCanonical" });
    }
  });

  it("a stroke and its mirror snap to mirrored paths, ties on the quarter yard included", () => {
    const mirror = (path: readonly (readonly number[])[]) => path.map((p): [number, number] => [0 - (p[0] as number) + 0, p[1] as number]);
    expect(quantizePath([[0, 0], [0.25, 3], [-0.75, 6]], cfg)).toEqual({ ok: true, path: [[0, 0], [0.5, 3], [-1, 6]] });
    expect(quantizePath([[0, 0], [-0.25, 3], [0.75, 6]], cfg)).toEqual({ ok: true, path: [[0, 0], [-0.5, 3], [1, 6]] });
    const rng = Rng.fromSeed(910);
    let ties = 0;
    for (let i = 0; i < 4_000; i++) {
      const n = 2 + Math.floor(rng.nextFloat() * 12);
      const raw: [number, number][] = [[0, 0]];
      // Quarter yards, so half the coordinates are ties.
      for (let k = 1; k < n; k++) raw.push([Math.round((rng.nextFloat() * 2 - 1) * 24) / 4, (raw[k - 1] as [number, number])[1] + Math.round(rng.nextFloat() * 8) / 4]);
      if (raw.some((p) => p[0] % 0.5 !== 0)) ties++;
      const q = quantizePath(raw, cfg);
      const m = quantizePath(mirror(raw), cfg);
      expect(m).toEqual(q.ok ? { ok: true, path: mirror(q.path) } : q);
      if (q.ok) expect(quantizePath(q.path, cfg)).toEqual(q);
    }
    expect(ties).toBeGreaterThan(2_000);
  });

  it("a stroke with far more turns than the point limit still comes back within it", () => {
    const wiggle = Array.from({ length: 200 }, (_, i): [number, number] => [i % 2 === 0 ? 0 : 1.5, i * 0.25]);
    const q = quantizePath(wiggle, cfg);
    expect(q.ok && q.path.length <= cfg.thresholds.maxPoints && isCanonical(q.path, cfg)).toBe(true);
  });
});

// B10 budget, fixed before the first timing run (designed, for live feedback while drawing):
// p99 at most 1 ms per call on a developer machine, with the 3x CI allowance the engine's speed
// test uses. Never raise it after a slow run: fix the code or take the number to Joseph.
const P99_BUDGET_MS = process.env["CI"] === undefined ? 1 : 3;

describe("B10: speed", () => {
  const p99 = (times: number[]): number => [...times].sort((a, b) => a - b)[Math.floor(times.length * 0.99)] as number;

  it("classifyPath: p99 within budget over 20,000 calls on full-length paths", () => {
    const rng = Rng.fromSeed(1010);
    const jobs = Array.from({ length: 22_000 }, (_, i) => ({ path: randomPath(rng), context: (CONTEXTS[(i * 17) % CONTEXTS.length] as (typeof CONTEXTS)[number])(50) }));
    const times: number[] = [];
    jobs.forEach((j, i) => {
      const t0 = performance.now();
      classify(j.path, j.context);
      if (i >= 2000) times.push(performance.now() - t0);
    });
    const worst = p99(times);
    console.log(`B10 classifyPath p99 ${(worst * 1000).toFixed(1)} us over ${times.length} calls`);
    expect(worst).toBeLessThanOrEqual(P99_BUDGET_MS);
  });

  it("quantizePath then classifyPath on a 300-point stroke: p99 within budget over 5,000 calls", () => {
    const rng = Rng.fromSeed(1011);
    const jobs = Array.from({ length: 5500 }, (_, i) => ({ raw: randomStroke(rng, 300), context: (CONTEXTS[(i * 19) % CONTEXTS.length] as (typeof CONTEXTS)[number])(50) }));
    const times: number[] = [];
    jobs.forEach((j, i) => {
      const t0 = performance.now();
      const q = quantizePath(j.raw, cfg);
      if (q.ok) classify(q.path, j.context);
      if (i >= 500) times.push(performance.now() - t0);
    });
    const worst = p99(times);
    console.log(`B10 quantizePath + classifyPath p99 ${(worst * 1000).toFixed(1)} us over ${times.length} calls`);
    expect(worst).toBeLessThanOrEqual(P99_BUDGET_MS);
  });
});

describe("positions", () => {
  it("every slot the contexts use has a known position", () => {
    for (const make of CONTEXTS) expect(["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S"]).toContain(positionOf(make(50).slot));
  });
});
