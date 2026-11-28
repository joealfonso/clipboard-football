// The twelve route families, drawn by hand as a coach would, on both sides of the ball (milestone
// B of docs/specs/m3-playbook-and-custom-routes.md). Expected values are worked out from the spec's
// words and the fixture alignments in spec-support.ts: receivers line up 1 yard off the ball, so a
// break drawn at y is y - 1 yards past the line. The field's thirds are |x| below 8.9 yards.
//
// Changed by the rulings of 2026-11-24. R1: every route has a catch depth, the end point's y for a
// go, post, corner or wheel and the break depth for the rest, and the bucket reads it, so the posts
// and corners below moved bucket. The break depths did not move. R11 and R13 changed the two
// fixtures that say so.

import { describe, expect, it } from "vitest";
import { caller, seeded } from "../../../shared/test/spec-support";
import { classifyConfig, quantizePath } from "../../src/playbook/classify";
import { config, configWith, feat, flipX, offCtx, playbook } from "./spec-support";
import type { P } from "./spec-support";

type Fam = "flat" | "swing" | "screen" | "drag" | "slant" | "hitch" | "out" | "in" | "corner" | "post" | "go" | "wheel";
interface Fixture {
  name: string;
  /** Left-side slot and its mirror on the right. */
  slots: [string, string];
  path: P[];
  family: Fam;
  /** The last break, or the end of a route with no break. */
  depth: number;
  /** R1: the end point's depth, only written where it differs from the break's. */
  catch?: number;
  /** The engine call, when the family depends on it (R13). */
  call?: string;
  bucket: "behind" | "short" | "intermediate" | "deep";
  direction: "in" | "out" | "vertical" | "back";
  /** End side for the left-side player. */
  end: "left" | "middle" | "right";
  crosses: boolean;
}
const WR: [string, string] = ["WR1", "WR2"]; // x 20
const SLOT: [string, string] = ["WR3", "WR4"]; // x 13
const TE: [string, string] = ["TE1", "TE2"]; // x 6
const RB: [string, string] = ["RB1", "RB1"]; // x 0, 7 deep

// Paths are for the left-side player: inside is +x.
const FIXTURES: Fixture[] = [
  { name: "three-step slant", slots: WR, path: [[0, 0], [0, 3], [5, 8]], family: "slant", depth: 2, bucket: "short", direction: "in", end: "left", crosses: false },
  { name: "slot slant that crosses nothing", slots: SLOT, path: [[0, 0], [0, 4], [6, 8]], family: "slant", depth: 3, bucket: "short", direction: "in", end: "middle", crosses: false },
  // R11: breaks at 5 (0 to 9) and ends at 9 (under 10), so a slant. Was a FLAG before the ruling.
  { name: "five-yard slant: short and in on a diagonal", slots: WR, path: [[0, 0], [0, 6], [5, 10]], family: "slant", depth: 5, bucket: "short", direction: "in", end: "left", crosses: false },
  { name: "tight end drag across the formation", slots: TE, path: [[0, 0], [1, 3], [10, 4], [16, 4]], family: "drag", depth: 2, bucket: "short", direction: "in", end: "right", crosses: true },
  { name: "split end drag that stops over the ball", slots: WR, path: [[0, 0], [0, 4], [18, 5]], family: "drag", depth: 3, bucket: "short", direction: "in", end: "middle", crosses: false },
  { name: "hitch", slots: WR, path: [[0, 0], [0, 6], [1, 5]], family: "hitch", depth: 5, bucket: "short", direction: "back", end: "left", crosses: false },
  { name: "curl", slots: WR, path: [[0, 0], [0, 13], [1.5, 11.5]], family: "hitch", depth: 12, bucket: "intermediate", direction: "back", end: "left", crosses: false },
  { name: "comeback to the sideline", slots: WR, path: [[0, 0], [0, 16], [-3, 13.5]], family: "hitch", depth: 15, bucket: "intermediate", direction: "back", end: "left", crosses: false },
  { name: "ten-yard out", slots: WR, path: [[0, 0], [0, 11], [-5, 11]], family: "out", depth: 10, bucket: "intermediate", direction: "out", end: "left", crosses: false },
  { name: "deep slot out", slots: SLOT, path: [[0, 0], [0, 15], [-8, 15.5]], family: "out", depth: 14, bucket: "intermediate", direction: "out", end: "left", crosses: false },
  { name: "dig", slots: WR, path: [[0, 0], [0, 15], [12, 15]], family: "in", depth: 14, bucket: "intermediate", direction: "in", end: "middle", crosses: false },
  { name: "deep in from the slot, across the field", slots: SLOT, path: [[0, 0], [0, 21], [24, 22]], family: "in", depth: 20, bucket: "deep", direction: "in", end: "right", crosses: true },
  { name: "tight end flat", slots: TE, path: [[0, 0], [-1, 2], [-8, 3]], family: "flat", depth: 1, bucket: "short", direction: "out", end: "left", crosses: false },
  { name: "slot arrow to the flat", slots: SLOT, path: [[0, 0], [0, 2], [-8, 2.5]], family: "flat", depth: 1, bucket: "short", direction: "out", end: "left", crosses: false },
  { name: "back out of the backfield to the flat", slots: RB, path: [[0, 0], [-4, 7.5], [-11, 9]], family: "flat", depth: 1, bucket: "short", direction: "out", end: "left", crosses: false },
  { name: "corner from the tight end", slots: TE, path: [[0, 0], [0, 12], [-6, 19]], family: "corner", depth: 11, catch: 18, bucket: "intermediate", direction: "out", end: "left", crosses: false },
  { name: "corner off an inside stem", slots: SLOT, path: [[0, 0], [1.5, 13], [-7, 22]], family: "corner", depth: 12, catch: 21, bucket: "deep", direction: "out", end: "left", crosses: false },
  { name: "post", slots: WR, path: [[0, 0], [0, 13], [6, 23]], family: "post", depth: 12, catch: 22, bucket: "deep", direction: "in", end: "left", crosses: false },
  { name: "deep post", slots: SLOT, path: [[0, 0], [0, 21], [8, 32]], family: "post", depth: 20, catch: 31, bucket: "deep", direction: "in", end: "middle", crosses: false },
  { name: "post-corner keeps its last heading", slots: SLOT, path: [[0, 0], [0, 10], [2, 13], [-5, 21]], family: "corner", depth: 12, catch: 20, bucket: "deep", direction: "out", end: "left", crosses: false },
  { name: "go", slots: WR, path: [[0, 0], [0, 25]], family: "go", depth: 24, bucket: "deep", direction: "vertical", end: "left", crosses: false },
  { name: "fade", slots: WR, path: [[0, 0], [-2, 4], [-3, 25]], family: "go", depth: 24, bucket: "deep", direction: "vertical", end: "left", crosses: false },
  { name: "seam", slots: SLOT, path: [[0, 0], [1.5, 5], [1.5, 26]], family: "go", depth: 25, bucket: "deep", direction: "vertical", end: "left", crosses: false },
  { name: "bubble screen", slots: SLOT, path: [[0, 0], [-2, -1.5], [-5, -1.5]], family: "screen", depth: -2.5, bucket: "behind", direction: "out", end: "left", crosses: false },
  { name: "tunnel screen", slots: WR, path: [[0, 0], [-0.5, -1], [4, -1]], family: "screen", depth: -2, bucket: "behind", direction: "in", end: "left", crosses: false },
  // R13: the same short path is a screen on a screen call and a swing on any other.
  { name: "back screen", slots: RB, call: "screenPass", path: [[0, 0], [0, 2], [-6, 2]], family: "screen", depth: -5, bucket: "behind", direction: "out", end: "middle", crosses: false },
  { name: "back screen's path on a pass that is not a screen", slots: RB, path: [[0, 0], [0, 2], [-6, 2]], family: "swing", depth: -5, bucket: "behind", direction: "out", end: "middle", crosses: false },
  { name: "back swing", slots: RB, path: [[0, 0], [-3, -0.5], [-7, 1], [-10, 5]], family: "swing", depth: -6, bucket: "behind", direction: "out", end: "left", crosses: false },
];

const OTHER = { left: "right", middle: "middle", right: "left" } as const;

describe("route families, both sides (B, classifier in words)", () => {
  for (const f of FIXTURES) {
    for (const side of [0, 1] as const) {
      it(`${f.name}, ${side === 0 ? "left" : "right"} side`, () => {
        const got = feat(side === 0 ? f.path : flipX(f.path), offCtx(f.slots[side], f.call === undefined ? {} : { call: f.call }));
        if (got.kind !== "route") throw new Error(`kind ${got.kind}`);
        const { breakDepth, catchDepth, ...rest } = got;
        expect(rest).toEqual({ kind: "route", family: f.family, bucket: f.bucket, direction: f.direction, endSide: side === 0 ? f.end : OTHER[f.end], crossesMiddle: f.crosses });
        // Whole yards: a half yard may round either way.
        expect(Number.isInteger(breakDepth)).toBe(true);
        expect(Math.abs(breakDepth - f.depth)).toBeLessThanOrEqual(0.5);
        expect(Number.isInteger(catchDepth)).toBe(true);
        expect(Math.abs(catchDepth - (f.catch ?? f.depth)), "R1 catch depth").toBeLessThanOrEqual(0.5);
      });
    }
  }

  // R1: a wheel keeps its break depth, the last break (where it turns up), and is caught at its end,
  // so its bucket is deep. Before the ruling only the bucket was held.
  for (const [slots, path, breakDepth, catchDepth] of [
    [TE, [[0, 0], [-6, 1], [-7, 23]], 0, 22],
    [SLOT, [[0, 0], [-5, 1], [-5.5, 24]], 0, 23],
    [RB, [[0, 0], [-9, 2], [-10, 30]], -5, 23],
  ] as [[string, string], P[], number, number][]) {
    for (const side of [0, 1] as const) {
      it(`wheel from ${slots[side]}, ${side === 0 ? "left" : "right"} side`, () => {
        const got = feat(side === 0 ? path : flipX(path), offCtx(slots[side]));
        expect(got).toMatchObject({ kind: "route", family: "wheel", breakDepth, catchDepth, bucket: "deep", direction: "vertical", endSide: side === 0 ? "left" : "right", crossesMiddle: false });
      });
    }
  }
  it("a hook up the seam after an inside stem is a go, not a wheel: wheel goes out then up", () => {
    expect(feat([[0, 0], [5, 1], [5, 24]], offCtx("WR3"))).toMatchObject({ family: "go", direction: "vertical", breakDepth: 0, catchDepth: 23, bucket: "deep" });
  });
  it("in and out are relative to the middle: the same drawing is out on one side and in on the other", () => {
    const path: P[] = [[0, 0], [0, 13], [-5, 13]];
    expect(feat(path, offCtx("WR1"))).toMatchObject({ family: "out", direction: "out" });
    expect(feat(path, offCtx("WR2"))).toMatchObject({ family: "in", direction: "in" });
    const diag: P[] = [[0, 0], [0, 13], [-6, 20]];
    expect(feat(diag, offCtx("TE1"))).toMatchObject({ family: "corner", direction: "out" });
    expect(feat(diag, offCtx("WR2"))).toMatchObject({ family: "post", direction: "in" });
  });
  it("a back on the middle swings to either side as out", () => {
    expect(feat([[0, 0], [4, 7.5], [11, 9]], offCtx("RB1"))).toMatchObject({ family: "flat", direction: "out", endSide: "right" });
  });
  it("an offset back drawn across the ball goes in and crosses the middle", () => {
    expect(feat([[0, 0], [2, 8], [14, 9]], offCtx("RB2"))).toMatchObject({ direction: "in", endSide: "right", crossesMiddle: true });
  });
  it("a route that only reaches its own side of the middle does not cross it", () => {
    expect(feat([[0, 0], [0, 15], [19, 15]], offCtx("WR1"))).toMatchObject({ crossesMiddle: false, endSide: "middle" });
    expect(feat([[0, 0], [0, 15], [22, 15]], offCtx("WR1"))).toMatchObject({ crossesMiddle: true, endSide: "middle" });
  });
  it("crossing and coming back is still crossing (the feature is about the path, not the end)", () => {
    expect(feat([[0, 0], [1, 3], [10, 4], [4, 3]], offCtx("TE1"))).toMatchObject({ endSide: "middle", crossesMiddle: true });
  });
});

describe("drawn by a finger: quantizing a wobbly 120-point trace keeps the family", () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      const rnd = seeded(7);
      const raw: P[] = [];
      const segs = f.path.slice(1).map((p, i) => [f.path[i] as P, p] as const);
      for (const [a, b] of segs) for (let k = 0; k < 40; k++) raw.push([a[0] + ((b[0] - a[0]) * k) / 40 + (rnd() - 0.5) * 0.1, a[1] + ((b[1] - a[1]) * k) / 40 + (rnd() - 0.5) * 0.1]);
      raw[0] = [0, 0];
      raw.push(f.path.at(-1) as P);
      const q = quantizePath(raw, config);
      if (!q.ok) throw new Error(q.reason);
      expect(feat(q.path, offCtx(f.slots[0], f.call === undefined ? {} : { call: f.call }))).toMatchObject({ family: f.family, direction: f.direction });
    });
  }
});

describe("B8: depth buckets", () => {
  const out = (y: number): P[] => [[0, 0], [0, y], [-4, y]];
  const bucket = (y: number) => feat(out(y), offCtx("WR1"));
  it("9 is short, 10 intermediate, 19 intermediate, 20 deep", () => {
    expect(bucket(10)).toMatchObject({ breakDepth: 9, bucket: "short" });
    expect(bucket(11)).toMatchObject({ breakDepth: 10, bucket: "intermediate" });
    expect(bucket(20)).toMatchObject({ breakDepth: 19, bucket: "intermediate" });
    expect(bucket(21)).toMatchObject({ breakDepth: 20, bucket: "deep" });
  });
  it("0 yards is short, 1 yard behind the line is behind", () => {
    expect(feat([[0, 0], [-3, 7], [-10, 7]], offCtx("RB1"))).toMatchObject({ breakDepth: 0, bucket: "short" });
    expect(feat([[0, 0], [-3, 6], [-10, 6]], offCtx("RB1"))).toMatchObject({ breakDepth: -1, bucket: "behind" });
  });
  it("without a break the depth is the end point's", () => {
    expect(feat([[0, 0], [0, 10]], offCtx("WR1"))).toMatchObject({ breakDepth: 9, bucket: "short" });
    expect(feat([[0, 0], [0, 11]], offCtx("WR1"))).toMatchObject({ breakDepth: 10, bucket: "intermediate" });
    expect(feat([[0, 0], [0, 20]], offCtx("WR1"))).toMatchObject({ breakDepth: 19, bucket: "intermediate" });
    expect(feat([[0, 0], [0, 21]], offCtx("WR1"))).toMatchObject({ breakDepth: 20, bucket: "deep" });
  });
  it("the LAST break sets the depth", () => {
    expect(feat([[0, 0], [0, 6], [4, 9], [4, 15], [0, 15]], offCtx("WR1"))).toMatchObject({ breakDepth: 14 });
  });
  it("depth is measured from the line, so 10 drawn yards mean less from deeper alignments", () => {
    expect(feat([[0, 0], [-3, 14], [-10, 14]], offCtx("RB1"))).toMatchObject({ breakDepth: 7, bucket: "short" });
  });
  it("the edges are the pass leaves' edges: moving them in the caller mapping moves the buckets", () => {
    const moved = classifyConfig(playbook.config, { shortBelow: 8, deepFrom: 15 }, 10);
    expect(feat(out(9), offCtx("WR1"), moved)).toMatchObject({ bucket: "intermediate" });
    expect(feat(out(16), offCtx("WR1"), moved)).toMatchObject({ bucket: "deep" });
    expect(caller.offenseMapping.depth).toEqual({ shortBelow: 10, deepFrom: 20 });
  });
});

describe("a break is a turn of 30 degrees or more", () => {
  it("26.6 degrees is not a break, 33.7 is", () => {
    expect(feat([[0, 0], [0, 4], [2, 8]], offCtx("WR1"))).toMatchObject({ breakDepth: 7 });
    expect(feat([[0, 0], [0, 4], [2, 7]], offCtx("WR1"))).toMatchObject({ breakDepth: 3 });
  });
  it("the angle comes from the config", () => {
    expect(feat([[0, 0], [0, 4], [2, 8]], offCtx("WR1"), configWith({ breakDegrees: 20 }))).toMatchObject({ breakDepth: 3 });
    expect(feat([[0, 0], [0, 4], [2, 7]], offCtx("WR1"), configWith({ breakDegrees: 40 }))).toMatchObject({ breakDepth: 6 });
  });
});

describe("thirds come from the field's width in data", () => {
  it("a narrower field moves the end side", () => {
    const path: P[] = [[0, 0], [0, 12], [0.5, 25]];
    expect(feat(path, offCtx("TE1"))).toMatchObject({ endSide: "middle" });
    expect(feat(path, offCtx("TE1"), configWith({}, { field: { ...playbook.config.field, widthYards: 30 } }))).toMatchObject({ endSide: "left" });
  });
});
