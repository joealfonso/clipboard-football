// The lead's rulings of 2026-11-24 on the classifier (docs/specs/m3-playbook-and-custom-routes.md,
// "Revision 2026-11-24"): R1 to R4, R9 and R11 to R17.

import { describe, expect, it } from "vitest";
import { defenseAlignment, holeOf, placePath, resolveDefense, resolveOffense, slotsOf } from "../../../shared/src/playbook";
import type { DefenseDesign, OffenseDesign, Pair, PathPoint, SlotAlignment } from "../../../shared/src/playbook";
import { loadPlaybook, playbookRefs } from "../../../shared/test/playbook-load";
import { classifyConfig, classifyPath, defenseContext, offenseContext, quantizePath, resolveDrawing } from "../../src/playbook/classify";
import type { ClassifyContext, Features } from "../../src/playbook/classify";
import { loadRules } from "../support/rules";

const pb = loadPlaybook();
const refs = playbookRefs();
const cfg = classifyConfig(pb.config, refs.depthEdges, loadRules().rules.field.endZoneYards);
const offense = (id: string) => pb.offense.designs.find((d) => d.id === id) as OffenseDesign;
const defense = (id: string) => pb.defense.designs.find((d) => d.id === id) as DefenseDesign;
/** WR1 at -20 and TE1 at -6, a yard off the ball; RB1 on the ball's line, 7 deep; RB2 offset. */
const ALIGN: SlotAlignment = { WR1: [-20, 1], WR2: [20, 1], TE1: [-6, 1], RB1: [0, 7], RB2: [-4, 6] };
const ctx = (slot: string, more: Partial<ClassifyContext> = {}): ClassifyContext => ({ side: "offense", slot, alignment: ALIGN, call: "shortPass", spot: 50, ...more });
const read = (path: PathPoint[], c: ClassifyContext): Features => {
  const r = classifyPath(path, c, cfg);
  if (!r.ok) throw new Error(r.reason);
  return r.features;
};
const reason = (path: PathPoint[], c: ClassifyContext): string => {
  const r = classifyPath(path, c, cfg);
  return r.ok ? `ok ${r.features.kind}` : r.reason;
};

describe("R1 and R12: catch depth, from the line", () => {
  it.each([
    ["a post is as deep as it ends", [[0, 0], [0, 13], [6, 23]], { family: "post", breakDepth: 12, catchDepth: 22, bucket: "deep" }],
    ["a corner too", [[0, 0], [0, 13], [-5, 18]], { family: "corner", breakDepth: 12, catchDepth: 17, bucket: "intermediate" }],
    ["a wheel: its break is its turn upfield", [[0, 0], [-4, 1], [-5, 23]], { family: "wheel", breakDepth: 0, catchDepth: 22, bucket: "deep" }],
    ["a go with a hard release keeps its last break", [[0, 0], [-2, 3], [-3, 26]], { family: "go", breakDepth: 2, catchDepth: 25, bucket: "deep" }],
    ["a dig is as deep as its break", [[0, 0], [0, 15], [7, 15.5]], { family: "in", breakDepth: 14, catchDepth: 14, bucket: "intermediate" }],
    ["a slant too", [[0, 0], [0, 3], [5, 8]], { family: "slant", breakDepth: 2, catchDepth: 2, bucket: "short" }],
  ] as [string, PathPoint[], Partial<Features>][])("%s", (_n, path, want) => expect(read(path, ctx("WR1"))).toMatchObject(want));
  it("a back's depth is measured from the same line as a receiver's", () => {
    expect(read([[0, 0], [0, 18], [8, 18]], ctx("RB1"))).toMatchObject({ breakDepth: 11, catchDepth: 11 });
    expect(read([[0, 0], [0, 12], [8, 12]], ctx("WR1"))).toMatchObject({ breakDepth: 11, catchDepth: 11 });
  });
});

describe("R2: a stroke with no break is read by its heading and its end", () => {
  it.each([
    ["vertical is go", [[0, 0], [0, 8]], "go"],
    ["in, ending at 9, is a slant", [[0, 0], [10, 10]], "slant"],
    ["in, ending at 10, is a post", [[0, 0], [10, 11]], "post"],
    ["out, ending at 9, is a flat", [[0, 0], [-6, 10]], "flat"],
    ["out, ending at 10, is a corner", [[0, 0], [-6, 11]], "corner"],
    ["sideways in is a drag", [[0, 0], [20, 8]], "drag"],
    ["sideways out is a flat, even past 4 yards", [[0, 0], [-6, 2.5]], "flat"],
  ] as [string, PathPoint[], string][])("%s", (_n, path, family) => expect(read(path, ctx("WR1"))).toMatchObject({ family }));
  it("the edge is the caller's", () => {
    const moved = classifyConfig(pb.config, { shortBelow: 14, deepFrom: 20 }, 10);
    const r = classifyPath([[0, 0], [10, 11]], ctx("WR1"), moved);
    expect(r).toMatchObject({ ok: true, features: { family: "slant" } });
  });
});

describe("R11: slant against post, and the deep crosser", () => {
  it.each([
    ["breaks at 5, ends at 9", [[0, 0], [0, 6], [5, 10]], "slant"],
    ["breaks at 5, ends at 10", [[0, 0], [0, 6], [6, 11]], "post"],
    ["breaks at 9, ends at 9.5 (a sideways finish) is an in", [[0, 0], [0, 10], [6, 10.5]], "in"],
    ["breaks at 10", [[0, 0], [0, 11], [5, 16]], "post"],
    ["a deep crosser that ends on a diagonal", [[0, 0], [0, 6], [14, 16]], "post"],
    ["the same that ends nearly sideways", [[0, 0], [0, 6], [26, 16]], "in"],
    ["a shallow cross", [[0, 0], [0, 6], [26, 9]], "drag"],
  ] as [string, PathPoint[], string][])("%s", (_n, path, family) => expect(read(path, ctx("WR1"))).toMatchObject({ family }));
});

describe("R3: spies, zones and base paths", () => {
  const spy = { kind: "spy" };
  const at = (x: number, depth: number): ClassifyContext => ({ side: "defense", slot: "LB2", alignment: { LB2: [x, depth] }, call: "baseCover3", spot: 50 });
  it("a short move is a spy inside the core box and a zone outside it", () => {
    const box = cfg.thresholds.coreBox;
    expect(read([[0, 0]], at(box.halfWidthYards, box.maxDepthYards))).toEqual(spy);
    expect(read([[0, 0]], at(box.halfWidthYards + 0.5, 5))).toMatchObject({ kind: "zone", level: "under" });
    expect(read([[0, 0]], at(0, box.maxDepthYards + 0.5))).toMatchObject({ kind: "zone", level: "under" });
    expect(read([[0, 0]], at(0, 14))).toMatchObject({ kind: "zone", level: "deep" });
  });
  it("a hook linebacker's one-yard drop is his zone, and a tap makes him a spy", () => {
    const lb = defenseContext(defense("baseCover3.sky"), pb, "LB2", 50);
    expect(resolveDrawing([[0, 0], [0, 1]], lb, cfg)).toEqual({ ok: true, base: true });
    expect(read([[0, 0], [0, 1]], lb)).toEqual({ kind: "zone", level: "under", third: "middle" });
    expect(resolveDrawing([[0, 0]], lb, cfg)).toEqual({ ok: true, base: false, features: spy });
  });

  let drawable = 0;
  it("every defense assignment with a path round-trips to itself, all zones included", () => {
    for (const d of pb.defense.designs) {
      const a = defenseAlignment(d, pb.alignments);
      for (const r of resolveDefense(d, pb, slotsOf(refs.personnel.packages[d.package] ?? {}))) {
        if (r.entry.kind === "man") continue;
        const here = a[r.slot] as Pair;
        const raw: PathPoint[] = "pts" in r.entry ? placePath(r.entry, here) : r.entry.kind === "spy" ? [[0, 0]] : [[0, 0], [(r.ref.at as Pair)[0] - here[0], (r.ref.at as Pair)[1] - here[1]]];
        const q = quantizePath(raw, cfg);
        if (!q.ok) throw new Error(`${d.id} ${r.slot} ${q.reason}`);
        const c = defenseContext(d, pb, r.slot, 50);
        expect(resolveDrawing(q.path, c, cfg), `${d.id} ${r.slot} ${r.use}`).toEqual({ ok: true, base: true });
        if (r.entry.kind === "zone") expect(read(q.path, c), `${d.id} ${r.slot}`).toEqual({ kind: "zone", level: r.entry.level, third: r.entry.third });
        if (r.entry.kind === "spy") expect(read(q.path, c), `${d.id} ${r.slot}`).toEqual(spy);
        drawable++;
      }
    }
    expect(drawable).toBeGreaterThan(300);
  });
  it("every offense assignment a player may draw round-trips to itself, in its own call (R14)", () => {
    let n = 0;
    for (const d of pb.offense.designs) {
      const a = pb.alignments.offense[d.formation] as SlotAlignment;
      const res = resolveOffense(d, pb, slotsOf(refs.personnel.offense[d.formation] ?? {}));
      const isRun = pb.config.concepts[d.concept]?.family === "run";
      for (const r of res) {
        // Linemen and the quarterback are never drawn, nor anyone but the carrier on a run.
        if (r.position === "OL" || r.position === "QB" || (isRun && r.slot !== d.carrier) || !("pts" in r.entry)) continue;
        const q = quantizePath(placePath(r.entry, a[r.slot] as Pair, r.to, r.ref.depth, holeOf(res, a) ?? undefined), cfg);
        if (!q.ok) throw new Error(`${d.id} ${r.slot} ${q.reason}`);
        expect(resolveDrawing(q.path, offenseContext(d, pb, r.slot, 50), cfg), `${d.id} ${r.slot} ${r.use}`).toEqual({ ok: true, base: true });
        n++;
      }
    }
    expect(n).toBeGreaterThan(330);
  });
  it("another route is a change", () => {
    expect(resolveDrawing([[0, 0], [0, 12], [-4, 12]], offenseContext(offense("shotgun.shortPass.slantFlat"), pb, "WR1", 50), cfg)).toMatchObject({ ok: true, base: false, features: { family: "out" } });
  });
  it("staying in is not the same as blocking downfield for a screen", () => {
    const te = offenseContext(offense("underCenter.screenPass.backScreen"), pb, "TE2", 50);
    expect(resolveDrawing([[0, 0]], te, cfg)).toEqual({ ok: true, base: false, features: { kind: "block", block: "pass" } });
  });
});

/** Every slot of every design with a base path, as it is drawn again. */
const REDRAWS = [
  ...pb.offense.designs.flatMap((d) => {
    const a = pb.alignments.offense[d.formation] as SlotAlignment;
    const res = resolveOffense(d, pb, slotsOf(refs.personnel.offense[d.formation] ?? {}));
    const run = pb.config.concepts[d.concept]?.family === "run";
    return res.flatMap((r) => {
      if (!("pts" in r.entry)) return [];
      const barred = pb.config.notOnThisCall.includes(d.concept) ? "notOnThisCall" : pb.config.eligibility.neverDrawn.includes(r.position) ? "ineligible" : run && r.slot !== d.carrier ? "notOnThisCall" : null;
      return [{ id: `${d.id} ${r.slot} ${r.use}`, barred, raw: placePath(r.entry, a[r.slot] as Pair, r.to, r.ref.depth, holeOf(res, a) ?? undefined), at: (spot: number) => offenseContext(d, pb, r.slot, spot) }];
    });
  }),
  ...pb.defense.designs.flatMap((d) => {
    const a = defenseAlignment(d, pb.alignments);
    return resolveDefense(d, pb, slotsOf(refs.personnel.packages[d.package] ?? {})).flatMap((r) => {
      if (r.entry.kind === "man") return [];
      const here = a[r.slot] as Pair;
      const raw: PathPoint[] = "pts" in r.entry ? placePath(r.entry, here) : r.entry.kind === "spy" ? [[0, 0]] : [[0, 0], [(r.ref.at as Pair)[0] - here[0], (r.ref.at as Pair)[1] - here[1]]];
      return [{ id: `${d.id} ${r.slot} ${r.use}`, barred: null, raw, at: (spot: number) => defenseContext(d, pb, r.slot, spot) }];
    });
  }),
];

describe("R16 and R14: the base assignment may be drawn again at every spot", () => {
  it("covers the catalog", () => {
    expect(REDRAWS.filter((x) => x.barred === null).length).toBeGreaterThan(700);
    for (const reason of ["ineligible", "notOnThisCall"]) expect(REDRAWS.filter((x) => x.barred === reason).length, reason).toBeGreaterThan(50);
  });
  for (const spot of [1, 3, 15, 50, 85, 92, 97, 99])
    it(`on the ${spot}: base for a drawable slot, its own reason for any other`, () => {
      const bad: string[] = [];
      for (const x of REDRAWS) {
        const q = quantizePath(x.raw, cfg);
        const got = q.ok ? resolveDrawing(q.path, x.at(spot), cfg) : q;
        if (JSON.stringify(got) !== JSON.stringify(x.barred === null ? { ok: true, base: true } : { ok: false, reason: x.barred })) bad.push(`${x.id} ${JSON.stringify(got)}`);
      }
      expect(bad).toEqual([]);
    });
  it("another path must stay in bounds, the same one at midfield need not", () => {
    const wr1 = (spot: number) => offenseContext(offense("shotgun.shortPass.stick"), pb, "WR1", spot);
    const out: PathPoint[] = [[0, 0], [0, 21], [4, 21]];
    expect(reason(out, wr1(50))).toBe("ok route");
    expect(reason(out, wr1(92))).toBe("outOfBounds");
    expect(resolveDrawing(out, wr1(92), cfg)).toEqual({ ok: false, reason: "outOfBounds" });
  });
  it("the sidelines do not move with the spot, so they hold for every drawing", () => {
    const cb = defenseContext(defense("baseCover3.sky"), pb, "CB1", 97);
    expect(resolveDrawing([[0, 0], [0, 10]], cb, cfg)).toEqual({ ok: true, base: true });
    expect(resolveDrawing([[0, 0], [-6, 10]], cb, cfg)).toEqual({ ok: false, reason: "outOfBounds" });
  });
});

describe("R17: whole yards, once", () => {
  it.each([
    ["in, ending at 9.5", [[0, 0], [10, 10.5]], { family: "post", catchDepth: 10, bucket: "intermediate" }],
    ["in, ending at 9", [[0, 0], [10, 10]], { family: "slant", catchDepth: 9, bucket: "short" }],
    ["out, ending at 9.5", [[0, 0], [-6, 10.5]], { family: "corner", catchDepth: 10, bucket: "intermediate" }],
    ["out, ending at 9", [[0, 0], [-6, 10]], { family: "flat", catchDepth: 9, bucket: "short" }],
    ["breaks at 5, ends at 9.5", [[0, 0], [0, 6], [5, 10.5]], { family: "post", catchDepth: 10, bucket: "intermediate" }],
    ["breaks at 9, ends at 9.5", [[0, 0], [0, 10], [0.5, 10.5]], { family: "post", catchDepth: 10, bucket: "intermediate" }],
  ] as [string, PathPoint[], Partial<Features>][])("%s", (_n, path, want) => expect(read(path, ctx("WR1"))).toMatchObject(want));
  it("no diagonal that is a slant or a flat is caught past the short bucket, at any half yard", () => {
    for (const side of [1, -1])
      for (let up = 2; up <= 30; up += 0.5)
        for (const stem of [0, 3, 6, 9.5, 10]) {
          const f = read(stem === 0 ? [[0, 0], [side * 6, up]] : [[0, 0], [0, stem], [side * 6, stem + up]], ctx("WR1"));
          if (f.kind === "route" && (f.family === "slant" || (f.family === "flat" && stem === 0))) expect(f.bucket, JSON.stringify([side, up, stem])).toBe("short");
        }
  });
});

describe("R4 and R13: a back behind the line swings unless the design is a screen", () => {
  const level: PathPoint[] = [[0, 0], [-1, 0.5], [4, 2]];
  it("swing on a pass, screen on a screen, and a receiver's is still a screen", () => {
    expect(read(level, ctx("RB1"))).toMatchObject({ family: "swing", bucket: "behind" });
    expect(read(level, ctx("RB1", { call: "screenPass", behindLine: ["RB1"] }))).toMatchObject({ family: "screen" });
    expect(read([[0, 0], [-1, -1], [-5, -1]], ctx("WR1"))).toMatchObject({ family: "screen" });
  });
  it("who is a back comes from the config", () => {
    expect(classifyPath(level, ctx("RB1"), { ...cfg, backs: [] })).toMatchObject({ features: { family: "screen" } });
  });
  it("the library's checkdown is a swing", () => expect(pb.library.assignments["back.checkdown"]).toMatchObject({ family: "swing" }));
  it("a defender who ends exactly on the line blitzes, with the lane where he reaches it", () => {
    const d: ClassifyContext = { side: "defense", slot: "LB2", alignment: { LB2: [0, 5] }, call: "baseCover3", spot: 50 };
    expect(read([[0, 0], [0, -5]], d)).toEqual({ kind: "blitz", lane: "inside", side: "middle" });
    expect(read([[0, 0], [5, -5]], d)).toEqual({ kind: "blitz", lane: "edge", side: "right" });
    expect(read([[0, 0], [0, -4.5]], d)).toMatchObject({ kind: "zone", level: "under" });
  });
});

describe("R14: breaksConcept is only for a route that removes the fake or the screen", () => {
  const back = (id: string) => offenseContext(offense(id), pb, "RB1", 50);
  it.each(["shotgun.playAction.paPost", "underCenter.playAction.bootleg", "heavy.playAction.paSeam", "shotgun.playAction.paFlood"])("%s: the back may stay in", (id) => {
    expect(read([[0, 0]], back(id))).toEqual({ kind: "block", block: "pass" });
  });
  it("his own fake may be drawn again, and still reads as a block", () => {
    expect(read([[0, 0], [-2, 1.5], [-3, 3]], back("shotgun.playAction.paPost"))).toEqual({ kind: "block", block: "pass" });
  });
  it("PA Flood's back keeps his own route to the flat, and no other", () => {
    for (const id of ["shotgun.playAction.paFlood", "underCenter.playAction.paFlood"]) {
      expect(read([[0, 0], [4, 2], [12, 8]], back(id)), id).toMatchObject({ kind: "route", family: "flat" });
      expect(reason([[0, 0], [0, 15]], back(id)), id).toBe("breaksConcept");
      expect(reason([[0, 0], [-4, 2], [-12, 8]], back(id)), id).toBe("breaksConcept");
    }
  });
});

describe("R15: a screen is judged by where its routes end", () => {
  it("a swing that ends past the line does not count as the route behind it", () => {
    const d = offense("shotgun.screenPass.bubbleScreen");
    const two = offenseContext(d, pb, "WR3", 50);
    expect(two.behindLine).toEqual(["RB1", "WR3"]);
    const moved = { ...d, assignments: { ...d.assignments, RB1: { use: "back.swing", to: "left" as const, depth: 6 } } };
    const one = offenseContext(moved, pb, "WR3", 50);
    expect(one.behindLine).toEqual(["WR3"]);
    expect(reason([[0, 0], [0, 15]], one)).toBe("breaksConcept");
    expect(reason([[0, 0], [0, 15]], two)).toBe("ok route");
  });
});

describe("R9: untrusted input", () => {
  const names = ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"];
  it.each(names)("%s as a slot or a call, on both sides", (k) => {
    expect(reason([[0, 0], [0, 8]], ctx(k))).toBe("noSuchSlot");
    expect(reason([[0, 0], [0, 8]], ctx("WR1", { call: k }))).toBe("notOnThisCall");
    expect(reason([[0, 0], [0, 8]], offenseContext(offense("shotgun.shortPass.mesh"), pb, k, 50))).toBe("noSuchSlot");
    expect(reason([[0, 0], [0, 4]], defenseContext(defense("baseCover3.sky"), pb, k, 50))).toBe("noSuchSlot");
    expect(Object.keys(offenseContext({ ...offense("shotgun.shortPass.mesh"), formation: k }, pb, "WR1", 50).alignment)).toEqual([]);
    expect(resolveDrawing([[0, 0], [0, 8]], ctx(k), cfg)).toEqual({ ok: false, reason: "noSuchSlot" });
  });
  it.each([
    [[[0, 0], [1.7e308, 0]]],
    [[[0, 0], [1.7e308, 0.1], [1.7e308, 5]]],
    [[[0.1, 0], [0, -1.7e308], [3, 1.7e308]]],
    [[[0, 0], [1e308, 1e308], [-1e308, 1e308], [0.1, 0.1]]],
  ])("quantizePath refuses %j", (raw) => {
    const q = quantizePath(raw, cfg);
    expect(q.ok).toBe(false);
  });
});
