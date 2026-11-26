// Defenders' drawings (B7 of docs/specs/m3-playbook-and-custom-routes.md): blitz, zone and spy,
// each side of each threshold. Paths are in the offense's frame, so a defender starts at his depth
// past the line and a blitz has falling y. LB2 is at (0, 5), LB3 at (4, 5), S2 at (8, 12).

import { describe, expect, it } from "vitest";
import type { Pair } from "../../../shared/src/playbook";
import { caller, defAlign, defEntries, drawnFrom, files, ref } from "../../../shared/test/spec-support";
import { classifyConfig, classifyPath, defenseContext, quantizePath } from "../../src/playbook/classify";
import { config, configWith, DEF, defCtx, defense, feat, flipX, playbook, reason } from "./spec-support";
import type { P } from "./spec-support";

const at = (x: number, depth: number) => defCtx("LB2", { alignment: { ...DEF, LB2: [x, depth] as Pair } });

describe("blitz or zone: which side of the line the path ends on", () => {
  it("half a yard behind the line is a blitz, half a yard short of it is an underneath zone", () => {
    expect(feat([[0, 0], [0, -5.5]], at(0, 5)).kind).toBe("blitz");
    expect(feat([[0, 0], [0, -4.5]], at(0, 5))).toMatchObject({ kind: "zone", level: "under" });
  });
  it("only the end counts: a fake into the backfield that drops back out is a zone", () => {
    expect(feat([[0, 0], [0, -6], [0, 6]], at(0, 5))).toMatchObject({ kind: "zone", level: "deep", third: "middle" });
  });
  it("a deep safety sent all the way in is a blitz", () => expect(feat([[0, 0], [-3, -14]], at(5, 12))).toMatchObject({ kind: "blitz" }));
});

describe("blitz lane and side, from where the path crosses the line", () => {
  // Straight down, so x at the line is the alignment's x. The edge threshold in data is 5 yards.
  const down: P[] = [[0, 0], [0, -8]];
  it("the edge threshold is in data", () => expect(playbook.config.classifier.blitzEdgeFromYards).toBe(5));
  for (const s of [1, -1] as const) {
    const side = s === 1 ? "right" : "left";
    it(`${side}: 4.5 is inside, 5.5 is the edge`, () => {
      expect(feat(down, at(4.5 * s, 5))).toEqual({ kind: "blitz", lane: "inside", side });
      expect(feat(down, at(5.5 * s, 5))).toEqual({ kind: "blitz", lane: "edge", side });
    });
    it(`${side}: 0.5 is the middle, 1.5 is a side`, () => {
      expect(feat(down, at(0.5 * s, 5))).toMatchObject({ kind: "blitz", lane: "inside", side: "middle" });
      expect(feat(down, at(1.5 * s, 5))).toMatchObject({ kind: "blitz", lane: "inside", side });
    });
    it(`${side}: crossing wide then bending inside is still the edge`, () => {
      const path: P[] = [[0, 0], [0, -6], [-8, -8]];
      expect(feat(s === 1 ? path : flipX(path), at(6 * s, 5))).toEqual({ kind: "blitz", lane: "edge", side });
    });
    it(`${side}: crossing inside then bending wide is inside`, () => {
      const path: P[] = [[0, 0], [0, -6], [8, -8]];
      expect(feat(s === 1 ? path : flipX(path), at(3 * s, 5))).toEqual({ kind: "blitz", lane: "inside", side });
    });
  }
  it("the crossing is worked out along the slanted segment", () => {
    // From (0, 5) to (9, -5): at the line x is 4.5. From (0, 5) to (11, -5): 5.5.
    expect(feat([[0, 0], [9, -10]], at(0, 5))).toMatchObject({ lane: "inside", side: "right" });
    expect(feat([[0, 0], [11, -10]], at(0, 5))).toMatchObject({ lane: "edge", side: "right" });
  });
  it("edge and side thresholds come from the config", () => {
    expect(feat(down, at(4.5, 5), configWith({ blitzEdgeFromYards: 4 }))).toMatchObject({ lane: "edge" });
    expect(feat(down, at(5.5, 5), configWith({ blitzEdgeFromYards: 6 }))).toMatchObject({ lane: "inside" });
    expect(feat(down, at(1.5, 5), configWith({ sideMiddleYards: 2 }))).toMatchObject({ side: "middle" });
  });
  it("a lineman's drawing can be a blitz with a lane", () => expect(feat([[0, 0], [1, -5]], defCtx("DL1"))).toEqual({ kind: "blitz", lane: "inside", side: "left" }));
});

describe("zone level by depth, third by x", () => {
  const thirds: [number, "left" | "middle" | "right"][] = [[-15, "left"], [0, "middle"], [15, "right"]];
  for (const [x, third] of thirds) {
    it(`under ${third} and deep ${third}`, () => {
      expect(feat([[0, 0], [x, 2.5]], at(0, 5))).toEqual({ kind: "zone", level: "under", third });
      expect(feat([[0, 0], [x, 13]], at(0, 5))).toEqual({ kind: "zone", level: "deep", third });
    });
  }
  it("the thirds' edges: a 53.3 yard field splits at 8.9", () => {
    for (const [x, third] of [[8.5, "middle"], [9, "right"], [-8.5, "middle"], [-9, "left"]] as const) expect(feat([[0, 0], [x, 2]], at(0, 5)), `${x}`).toMatchObject({ third });
  });
  it("the third is where he ends on the field, not how far he moved", () => {
    expect(feat([[0, 0], [3, 4]], at(20, 6))).toMatchObject({ third: "right" });
    expect(feat([[0, 0], [-14, 4]], at(20, 6))).toMatchObject({ third: "middle" });
  });
  // R13: the under and deep edge is the caller's 10-yard edge, read from one place.
  const edge = caller.offenseMapping.depth.shortBelow;
  it("just under the edge is under, at it is deep, measured from the line and not from the defender", () => {
    for (const d of [4, 7]) {
      expect(feat([[0, 0], [0, edge - 0.5 - d]], at(0, d)), `from ${d}`).toMatchObject({ level: "under" });
      expect(feat([[0, 0], [0, edge - d]], at(0, d)), `from ${d}`).toMatchObject({ level: "deep" });
    }
    // A robber: a safety 12 deep who comes up 4 is under, one who goes back 4 is deep.
    expect(feat([[0, 0], [0, -4]], at(0, 12))).toMatchObject({ kind: "zone", level: "under" });
    expect(feat([[0, 0], [0, 4]], at(0, 12))).toMatchObject({ kind: "zone", level: "deep" });
  });
  it("the edge moves with the data", () => {
    const moved = classifyConfig(playbook.config, { shortBelow: 14, deepFrom: 20 }, 10);
    expect(feat([[0, 0], [0, 7]], at(0, 5), moved)).toMatchObject({ level: "under" });
  });
});

describe("R13: a path ending exactly on the line is a blitz", () => {
  it("with the lane and side where it reaches the line", () => {
    expect(feat([[0, 0], [0, -5]], at(0, 5))).toEqual({ kind: "blitz", lane: "inside", side: "middle" });
    expect(feat([[0, 0], [2, -5]], at(1, 5))).toEqual({ kind: "blitz", lane: "inside", side: "right" });
    expect(feat([[0, 0], [-2, -5]], at(-5, 5))).toEqual({ kind: "blitz", lane: "edge", side: "left" });
    expect(feat([[0, 0], [-2, -5], [-4, -5]], at(0, 5)).kind).toBe("blitz");
  });
  it("the crossing is where he first reaches the line, even when a point of the path is on it", () => {
    // Reaches the line at x 4 (inside), then bends to 7.
    expect(feat([[0, 0], [0, -5], [3, -8]], at(4, 5))).toEqual({ kind: "blitz", lane: "inside", side: "right" });
    expect(feat([[0, 0], [0, -5], [-3, -8]], at(6, 5))).toEqual({ kind: "blitz", lane: "edge", side: "right" });
  });
  it("from deep too, and half a yard short of it is still a zone", () => {
    expect(feat([[0, 0], [0, -12]], at(5.5, 12))).toEqual({ kind: "blitz", lane: "edge", side: "right" });
    expect(feat([[0, 0], [0, -11.5]], at(5.5, 12))).toMatchObject({ kind: "zone", level: "under" });
  });
});

describe("spy: a net move under the radius, inside the core box (R3)", () => {
  it("1.5 yards is a spy, 2 yards is not, any direction", () => {
    for (const [x, y] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      expect(feat([[0, 0], [1.5 * x, 1.5 * y]], at(0, 5)), `${x},${y}`).toEqual({ kind: "spy" });
      expect(feat([[0, 0], [2 * x, 2 * y]], at(0, 5)).kind, `${x},${y}`).toBe("zone");
    }
    expect(feat([[0, 0], [1, 1.5]], at(0, 5)).kind).toBe("spy");
    expect(feat([[0, 0], [1.5, 1.5]], at(0, 5)).kind).toBe("zone");
  });
  it("net, so a loop that comes home is a spy", () => {
    expect(feat([[0, 0], [4, 0], [4, 4], [0.5, 0.5]], at(0, 5))).toEqual({ kind: "spy" });
  });
  it("the radius comes from the config", () => {
    expect(feat([[0, 0], [0, 3]], at(0, 5), configWith({ spyRadiusYards: 4 })).kind).toBe("spy");
    expect(feat([[0, 0], [0, 1.5]], at(0, 5), configWith({ spyRadiusYards: 1 })).kind).toBe("zone");
  });
});

describe("the preset does not change what a drawing means", () => {
  it("same path, same result in every preset", () => {
    const first = feat([[0, 0], [-9, 4]], at(0, 5));
    for (const call of Object.keys(caller.defenseMapping.presets)) expect(feat([[0, 0], [-9, 4]], { ...at(0, 5), call }), call).toEqual(first);
  });
});

describe("catalog agreement: what a design assigns, drawn, reads as that assignment", () => {
  const f = files();
  const R = (v: number) => Math.round(v * 2) / 2 + 0;
  for (const d of f.defense.designs) {
    it(d.id, () => {
      const align = defAlign(f, d);
      for (const { slot, entry, listed } of defEntries(f, d)) {
        if (!listed) continue;
        const v = ref(d.assignments[slot] as string);
        const a = align[slot] as Pair;
        const ctx = defenseContext(defense(d.id), playbook, slot, 40);
        if (entry.kind === "zone") {
          const p: P = [R((v.at as Pair)[0] - a[0]), R((v.at as Pair)[1] - a[1])];
          // R3: every zone reads as itself, one whose landmark is under 2 yards away included (it was a spy).
          expect(p, slot).not.toEqual([0, 0]);
          expect(feat([[0, 0], p], ctx), slot).toEqual({ kind: "zone", level: entry.level, third: entry.third });
        }
        if (entry.kind === "blitz") {
          const raw = drawnFrom(entry, a, v);
          const q = quantizePath(raw, config);
          if (!q.ok) throw new Error(q.reason);
          expect(classifyPath(q.path, ctx, config), slot).toMatchObject({ ok: true, features: { kind: "blitz", lane: entry.lane } });
        }
      }
    });
  }
});

describe("hostile defense drawings still answer", () => {
  it("a path that runs past the offense's own end line is out of bounds", () => expect(reason([[0, 0], [0, -20]], { ...at(0, 5), spot: 3 })).toBe("outOfBounds"));
});
