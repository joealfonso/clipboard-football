// The lead's rulings of 2026-11-24 (R1 to R15 at the top of
// docs/specs/m3-playbook-and-custom-routes.md) on the classifier, from the rulings' words. Expected
// values are worked out by hand from the fixture alignments in spec-support.ts: WR1 (-20, 1 back),
// WR2 (20, 1), WR3 (-13, 1), TE1 (-6, 1), RB1 (0, 7), RB2 (-4, 6), so a receiver's y is 1 more than
// yards past the line. Inside is +x for a player on the left. Heading angles come from the config: a
// diagonal is 25 to 70 degrees above sideways.

import { describe, expect, it } from "vitest";
import type { DefenseDesign, OffenseDesign, Pair, SlotAlignment } from "../../../shared/src/playbook";
import { caller, CAUGHT_AT_END, defAlign, defEntries, drawnFrom, files, holeBy, onField, personnel, pos, ref, runnerTrack } from "../../../shared/test/spec-support";
import type { Files } from "../../../shared/test/spec-support";
import { classifyConfig, classifyPath, defenseContext, offenseContext, quantizePath, resolveDrawing } from "../../src/playbook/classify";
import type { ClassifyContext, DrawingResult, Features } from "../../src/playbook/classify";
import { config, configWith, DEF, defCtx, defense, feat, flipX, offCtx, offense, playbook, reason, run } from "./spec-support";
import type { P } from "./spec-support";

const f = files();
const BASE: DrawingResult = { ok: true, base: true };
const other = (want: Partial<Extract<Features, { kind: "route" }>> | Record<string, unknown>) => ({ ok: true, base: false, features: want });
const R = (v: number) => Math.round(v * 2) / 2 + 0;
const mirror: Record<string, string> = { WR1: "WR2", WR3: "WR4", TE1: "TE2" };
/** The same drawing on the left and mirrored on the right. */
const bothSides = (slot: string, path: P[], call = "shortPass"): Features[] => [feat(path, offCtx(slot, { call })), feat(flipX(path), offCtx(mirror[slot] as string, { call }))];

describe("R2: a stroke with no break at 9 and at 10 yards past the line", () => {
  // [0,0] to [8, 10] is 51 degrees. It ends 9 past the line. One more yard up and it ends at 10.
  const rows: [string, string, P[], Record<string, unknown>][] = [
    ["slant at 9", "WR1", [[0, 0], [8, 10]], { family: "slant", breakDepth: 9, catchDepth: 9, bucket: "short", direction: "in" }],
    ["post at 10", "WR1", [[0, 0], [8, 11]], { family: "post", breakDepth: 10, catchDepth: 10, bucket: "intermediate", direction: "in" }],
    ["flat at 9", "WR3", [[0, 0], [-8, 10]], { family: "flat", breakDepth: 9, catchDepth: 9, bucket: "short", direction: "out" }],
    ["corner at 10", "WR3", [[0, 0], [-8, 11]], { family: "corner", breakDepth: 10, catchDepth: 10, bucket: "intermediate", direction: "out" }],
    ["go at 9", "WR1", [[0, 0], [1, 10]], { family: "go", breakDepth: 9, catchDepth: 9, bucket: "short", direction: "vertical" }],
    ["go at 10", "WR1", [[0, 0], [1, 11]], { family: "go", breakDepth: 10, catchDepth: 10, bucket: "intermediate", direction: "vertical" }],
  ];
  for (const [name, slot, path, want] of rows) it(name, () => bothSides(slot, path).forEach((got) => expect(got).toMatchObject(want)));
  it("R17: 9.5 is rounded to 10 before the family reads it, so family and bucket agree", () => {
    // Was a slant and a flat before R17, which read the raw 9.5.
    for (const got of bothSides("WR1", [[0, 0], [8, 10.5]])) expect(got).toMatchObject({ family: "post", breakDepth: 10, catchDepth: 10, bucket: "intermediate" });
    for (const got of bothSides("WR3", [[0, 0], [-8, 10.5]])) expect(got).toMatchObject({ family: "corner", breakDepth: 10, catchDepth: 10, bucket: "intermediate" });
    for (const got of bothSides("WR1", [[0, 0], [8, 9.5]])) expect(got).toMatchObject({ family: "slant", breakDepth: 9, catchDepth: 9, bucket: "short" });
    for (const got of bothSides("WR3", [[0, 0], [-8, 9.5]])) expect(got).toMatchObject({ family: "flat", breakDepth: 9, catchDepth: 9, bucket: "short" });
  });
  it("sideways is a drag in and a flat out, however deep it drifts", () => {
    for (const got of bothSides("WR1", [[0, 0], [10, 3]])) expect(got).toMatchObject({ family: "drag", breakDepth: 2, catchDepth: 2 });
    for (const got of bothSides("WR1", [[0, 0], [36, 13]])) expect(got).toMatchObject({ family: "drag", breakDepth: 12, catchDepth: 12, bucket: "intermediate", crossesMiddle: true });
    for (const got of bothSides("WR3", [[0, 0], [-10, 3]])) expect(got).toMatchObject({ family: "flat", breakDepth: 2, catchDepth: 2 });
  });
  it("a gentle bend under 30 degrees is no break: read by the last heading and the end", () => {
    // 59 then 45 degrees, a 14 degree turn.
    for (const got of bothSides("WR1", [[0, 0], [3, 5], [8, 10]])) expect(got).toMatchObject({ family: "slant", breakDepth: 9 });
    for (const got of bothSides("WR1", [[0, 0], [3, 5], [9, 11]])) expect(got).toMatchObject({ family: "post", breakDepth: 10 });
  });
  it("the edge is the pass leaves' edge: moving it in the caller's mapping moves all four families", () => {
    const moved = classifyConfig(playbook.config, { shortBelow: 7, deepFrom: 20 }, 10);
    expect(feat([[0, 0], [5, 7]], offCtx("WR1"), moved)).toMatchObject({ family: "slant", bucket: "short" });
    expect(feat([[0, 0], [5, 8]], offCtx("WR1"), moved)).toMatchObject({ family: "post", bucket: "intermediate" });
    expect(feat([[0, 0], [-5, 7]], offCtx("WR3"), moved)).toMatchObject({ family: "flat" });
    expect(feat([[0, 0], [-5, 8]], offCtx("WR3"), moved)).toMatchObject({ family: "corner" });
  });
});

describe("R11: slant against post with a break, and the deep crosser", () => {
  it("a 5-yard break is a slant ending at 9 and a post ending at 10", () => {
    for (const got of bothSides("WR1", [[0, 0], [0, 6], [4, 10]])) expect(got).toMatchObject({ family: "slant", breakDepth: 5, catchDepth: 5, bucket: "short" });
    for (const got of bothSides("WR1", [[0, 0], [0, 6], [5, 11]])) expect(got).toMatchObject({ family: "post", breakDepth: 5, catchDepth: 10, bucket: "intermediate" });
  });
  it("a break at 9 is a slant if it ends under 10, a break at 10 never is (R17: in whole yards)", () => {
    // Breaks at 8.5, 9 in whole yards, and ends at 9.
    for (const got of bothSides("WR1", [[0, 0], [0, 9.5], [0.5, 10]])) expect(got).toMatchObject({ family: "slant", breakDepth: 9, catchDepth: 9, bucket: "short" });
    // Breaks at 9 and ends at 9.5, 10 in whole yards: a post caught at 10 (a slant before R17).
    for (const got of bothSides("WR1", [[0, 0], [0, 10], [0.5, 10.5]])) expect(got).toMatchObject({ family: "post", breakDepth: 9, catchDepth: 10, bucket: "intermediate" });
    for (const got of bothSides("WR1", [[0, 0], [0, 11], [1, 12]])) expect(got).toMatchObject({ family: "post", breakDepth: 10, catchDepth: 11 });
  });
  it("a break at the line (0) is a slant", () => {
    for (const got of bothSides("WR1", [[0, 0], [0, 1], [4, 5]])) expect(got).toMatchObject({ family: "slant", breakDepth: 0, catchDepth: 0 });
  });
  it("a break behind the line is not 0 to 9, so by the ruling's words it is a post, caught short", () => {
    // RB2 (-4, 6): breaks 1 behind the line, ends 3 past it.
    expect(feat([[0, 0], [0, 5], [4, 9]], offCtx("RB2"))).toMatchObject({ family: "post", breakDepth: -1, catchDepth: 3, bucket: "short" });
    expect(feat([[0, 0], [0, 6], [4, 10]], offCtx("RB2"))).toMatchObject({ family: "slant", breakDepth: 0, catchDepth: 0 });
  });
  it("a deep crosser that breaks at 5 and ends deep: a post on a deep diagonal, an in when nearly sideways", () => {
    // 35.5 degrees, ends 15 past the line. 17 degrees, ends 11 past it.
    for (const got of bothSides("WR1", [[0, 0], [0, 6], [14, 16]])) expect(got).toMatchObject({ family: "post", breakDepth: 5, catchDepth: 15, bucket: "intermediate", direction: "in" });
    for (const got of bothSides("WR1", [[0, 0], [0, 6], [20, 12]])) expect(got).toMatchObject({ family: "in", breakDepth: 5, catchDepth: 5, bucket: "short", direction: "in", crossesMiddle: true });
  });
  it("the heading edge between them is the config's diagonal angle", () => {
    const path: P[] = [[0, 0], [0, 6], [20, 12]];
    expect(feat(path, offCtx("WR1"), configWith({ diagonalFromDegrees: 15 }))).toMatchObject({ family: "post", catchDepth: 11 });
  });
  it("the library's deep crossers: over ends on a diagonal, cross nearly sideways", () => {
    // Over: 6 up, then 14 in and 10 up (35.5 degrees). Cross: 13 up, then 26 in and 4 up (8.7 degrees).
    expect(f.library.assignments["route.over"]).toMatchObject({ family: "post", pts: [[0, 6], [14, 16]] });
    expect(f.library.assignments["route.cross"]).toMatchObject({ family: "in", pts: [[0, 13], [26, 17]] });
  });
});

describe("R12: depth is measured from the line, not from the player", () => {
  it("a back 7 yards deep and a receiver 1 yard deep who finish at the same place compare alike", () => {
    // Both turn out 8 past the line.
    expect(feat([[0, 0], [0, 9], [-4, 9]], offCtx("WR1"))).toMatchObject({ breakDepth: 8, catchDepth: 8, bucket: "short" });
    expect(feat([[0, 0], [0, 15], [-5, 15]], offCtx("RB1"))).toMatchObject({ breakDepth: 8, catchDepth: 8, bucket: "short" });
    // Both end straight up 20 and 19 past it.
    for (const past of [19, 20]) {
      const want = { family: "go", breakDepth: past, catchDepth: past, bucket: past < 20 ? "intermediate" : "deep" };
      expect(feat([[0, 0], [0, past + 1]], offCtx("WR1"))).toMatchObject(want);
      expect(feat([[0, 0], [0, past + 7]], offCtx("RB1"))).toMatchObject(want);
    }
  });
  it("the 10-yard edge for a back's straight diagonal is 10 past the line", () => {
    // RB2 is 6 deep at x -4, so inside is +x. [12, 15] ends 9 past the line, [12, 16] ends 10.
    expect(feat([[0, 0], [12, 15]], offCtx("RB2"))).toMatchObject({ family: "slant", breakDepth: 9, catchDepth: 9 });
    expect(feat([[0, 0], [12, 16]], offCtx("RB2"))).toMatchObject({ family: "post", breakDepth: 10, catchDepth: 10 });
  });
  it("a back's wheel keeps its break behind the line and is caught where it ends", () => {
    expect(feat([[0, 0], [-9, 2], [-10, 27]], offCtx("RB1"))).toMatchObject({ family: "wheel", breakDepth: -5, catchDepth: 20, bucket: "deep" });
    expect(feat([[0, 0], [-9, 2], [-10, 26]], offCtx("RB1"))).toMatchObject({ family: "wheel", breakDepth: -5, catchDepth: 19, bucket: "intermediate" });
  });
});

describe("R1: the bucket and the depth tag read the catch depth", () => {
  it("a post that breaks at 12 is not shallower than a dig that breaks at 14", () => {
    const post = feat([[0, 0], [0, 13], [8, 25]], offCtx("WR1"));
    const dig = feat([[0, 0], [0, 15], [7, 15]], offCtx("WR1"));
    if (post.kind !== "route" || dig.kind !== "route") throw new Error("kind");
    expect([post.breakDepth, post.catchDepth, post.bucket]).toEqual([12, 24, "deep"]);
    expect([dig.breakDepth, dig.catchDepth, dig.bucket]).toEqual([14, 14, "intermediate"]);
  });
  it("19 and 20 at the end of a corner", () => {
    for (const got of bothSides("TE1", [[0, 0], [0, 12], [-8, 20]])) expect(got).toMatchObject({ family: "corner", breakDepth: 11, catchDepth: 19, bucket: "intermediate" });
    for (const got of bothSides("TE1", [[0, 0], [0, 12], [-8, 21]])) expect(got).toMatchObject({ family: "corner", breakDepth: 11, catchDepth: 20, bucket: "deep" });
  });
  it("which families are caught at their end is the ruling's four", () => expect([...playbook.config.classifier.catchAtEnd].sort()).toEqual([...CAUGHT_AT_END].sort()));
  it("every pass design's depth tag is its first read's catch depth", () => {
    for (const d of f.offense.designs) {
      const first = Object.entries(d.assignments).find(([, v]) => ref(v).primary === true);
      if (first === undefined) continue;
      const [slot, v] = first;
      const e = f.library.assignments[ref(v).use];
      if (e?.kind !== "route") throw new Error(d.id);
      const a = (f.alignments.offense[d.formation] as Record<string, Pair>)[slot] as Pair;
      const path = drawnFrom(e, a, ref(v), e.breakAt);
      const y = (CAUGHT_AT_END.includes(e.family) ? (path.at(-1) as P) : (path[e.breakAt + 1] as P))[1] - a[1];
      // Half a yard may go either way to whole yards, so a tie at an edge may take either tag.
      const ok = [Math.floor(y + 0.5), Math.ceil(y - 0.5)].map((n) => (n < 0 ? "behind" : n < 10 ? "short" : n < 20 ? "intermediate" : "deep"));
      expect(ok, `${d.id} ${slot} at ${y}`).toContain(d.tags.depth);
    }
  });
});

describe("R4 and R13: a back's short path", () => {
  it("the library's checkdown is a swing, and reads as one wherever it is used", () => {
    expect(f.library.assignments["back.checkdown"]).toMatchObject({ family: "swing" });
    // Shotgun, 5 deep, to the right: [-1, 0.5] then [4, 2], level, 3 behind the line.
    expect(feat([[0, 0], [-1, 0.5], [4, 2]], offenseContext(offense("shotgun.intermediatePass.smash"), playbook, "RB1", 40))).toMatchObject({ family: "swing", bucket: "behind" });
  });
  const level: P[] = [[0, 0], [1, 0.5], [5, -0.5]];
  it("level and behind the line is a swing on every pass that is not a screen, and a screen on one", () => {
    for (const call of ["shortPass", "intermediatePass", "deepPass"]) expect(feat(level, offCtx("RB1", { call })), call).toMatchObject({ family: "swing", bucket: "behind" });
    expect(feat(level, offCtx("RB1", { call: "screenPass" }))).toMatchObject({ family: "screen", bucket: "behind" });
    expect(feat(level, offenseContext(offense("shotgun.screenPass.backScreen"), playbook, "RB1", 40))).toMatchObject({ family: "screen" });
  });
  it("only a back's: a receiver level and behind the line is still a screen", () => {
    expect(feat([[0, 0], [-2, -1.5], [-5, -1.5]], offCtx("WR3"))).toMatchObject({ family: "screen" });
  });
});

describe("R3: a spy is a short move by a defender lined up inside the core box", () => {
  const box = playbook.config.classifier.coreBox;
  const from = (x: number, depth: number) => defCtx("LB2", { alignment: { ...DEF, LB2: [x, depth] as Pair } });
  const short: P[] = [[0, 0], [1, 0.5]];
  for (const s of [1, -1] as const) {
    it(`half a yard each side of its ${s === 1 ? "right" : "left"} edge`, () => {
      expect(feat(short, from(s * (box.halfWidthYards - 0.5), 5))).toEqual({ kind: "spy" });
      expect(feat(short, from(s * (box.halfWidthYards + 0.5), 5)).kind).toBe("zone");
    });
  }
  it("half a yard each side of its back edge", () => {
    expect(feat(short, from(0, box.maxDepthYards - 0.5))).toEqual({ kind: "spy" });
    expect(feat(short, from(0, box.maxDepthYards + 0.5)).kind).toBe("zone");
  });
  it("it is where he lines up that counts, not where he goes", () => {
    expect(feat([[0, 0], [1.5, 0]], from(box.halfWidthYards - 0.5, 5))).toEqual({ kind: "spy" });
    expect(feat([[0, 0], [-1.5, 0]], from(box.halfWidthYards + 0.5, 5)).kind).toBe("zone");
  });
  it("outside the box even a tap is a zone, with the level and third of where he stands", () => {
    expect(feat([[0, 0]], defCtx("CB1"))).toEqual({ kind: "zone", level: "under", third: "left" });
    expect(feat([[0, 0]], defCtx("S2"))).toEqual({ kind: "zone", level: "deep", third: "middle" });
    expect(feat([[0, 0], [1, 1]], defCtx("CB2"))).toEqual({ kind: "zone", level: "under", third: "right" });
  });
  it("the box is data", () => {
    expect(feat(short, from(10, 5), configWith({ coreBox: { halfWidthYards: 11, maxDepthYards: 8 } }))).toEqual({ kind: "spy" });
    expect(feat(short, from(0, 5), configWith({ coreBox: { halfWidthYards: 8, maxDepthYards: 4 } })).kind).toBe("zone");
  });
});

describe("R3: a tap, and a short move near the landmark", () => {
  // Base Cover 3 Sky: LB2 lines up at (0, 5) and his zone is at (0, 6).
  const hook = defenseContext(defense("baseCover3.sky"), playbook, "LB2", 40);
  it("the fixture is what this test assumes", () => {
    expect(hook.alignment["LB2"]).toEqual([0, 5]);
    expect(f.defense.designs.find((d) => d.id === "baseCover3.sky")?.assignments["LB2"]).toMatchObject({ at: [0, 6] });
  });
  it("a tap is a spy", () => expect(resolveDrawing([[0, 0]], hook, config)).toEqual(other({ kind: "spy" })));
  it("his landmark, or a short move that ends beside it, is his own zone", () => {
    for (const end of [[0, 1], [0.5, 1], [-0.5, 1], [0, 1.5]] as P[]) expect(resolveDrawing([[0, 0], end], hook, config), `${end}`).toEqual(BASE);
  });
  it("a short move the other way is a spy", () => {
    for (const end of [[0, -1], [1, -0.5], [-1.5, 0]] as P[]) expect(resolveDrawing([[0, 0], end], hook, config), `${end}`).toEqual(other({ kind: "spy" }));
  });
  it("every zone in the catalog: a short move ending within half a yard of the landmark is that zone", () => {
    let n = 0;
    for (const d of f.defense.designs) {
      const align = defAlign(f, d);
      for (const { slot, entry } of defEntries(f, d)) {
        if (entry.kind !== "zone") continue;
        const a = align[slot] as Pair;
        const mark = ref(d.assignments[slot] as string).at as Pair;
        for (const [dx, dy] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]] as P[]) {
          const end: P = [R(mark[0] - a[0] + dx), R(mark[1] - a[1] + dy)];
          const net = Math.hypot(...end);
          // "Near" has no number in the ruling: only moves at least twice as far from where he stands are held.
          if (net >= 2 || net < 1) continue;
          expect(resolveDrawing([[0, 0], end], defenseContext(defense(d.id), playbook, slot, 40), config), `${d.id} ${slot} ${end}`).toEqual(BASE);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(20);
  });
  it("a real drop elsewhere is another zone", () => expect(resolveDrawing([[0, 0], [12, 1]], hook, config)).toEqual(other({ kind: "zone", level: "under", third: "right" })));
  it("a tap by a man defender in the box is a spy: he has no landmark to be near", () => {
    const man = defenseContext(defense("nickel2Man.twoMan"), playbook, "LB2", 40);
    for (const path of [[[0, 0]], [[0, 0], [0, 1]], [[0, 0], [1, -1]]] as P[][]) expect(resolveDrawing(path, man, config)).toEqual(other({ kind: "spy" }));
  });
  it("a spy drawn as a spy is the base, and sent deep is not", () => {
    for (const id of ["nickelCover1.spy", "nickel2Man.spy", "prevent.spy"]) {
      const slot = Object.entries(defense(id).assignments).find(([, v]) => ref(v).use === "spy.qb")?.[0] as string;
      const ctx = defenseContext(defense(id), playbook, slot, 40);
      expect(resolveDrawing([[0, 0]], ctx, config), id).toEqual(BASE);
      expect(resolveDrawing([[0, 0], [0, 15]], ctx, config), id).toEqual(other({ kind: "zone", level: "deep", third: "middle" }));
    }
  });
});

describe("R3: every catalog assignment, drawn, resolves to itself", () => {
  const drawn = (raw: [number, number][]) => {
    const q = quantizePath(raw, config);
    if (!q.ok) throw new Error(q.reason);
    return q.path;
  };
  // Everyone with a drawable assignment: OL and QB are never drawn, and on a run only the carrier is.
  for (const d of f.offense.designs) {
    const runCall = ["insideRun", "outsideRun", "qbSneak"].includes(d.concept);
    const slots = Object.keys(d.assignments).filter((s) => !["OL", "QB"].includes(pos(s)) && (!runCall || s === d.carrier));
    if (slots.length === 0) continue;
    it(d.id, () => {
      const align = f.alignments.offense[d.formation] as Record<string, Pair>;
      for (const slot of slots) {
        const v = ref(d.assignments[slot] as string);
        const e = f.library.assignments[v.use];
        if (e === undefined || !("pts" in e)) throw new Error(slot);
        const a = align[slot] as Pair;
        const raw = e.kind === "runPath" ? runnerTrack(f, d).map(([x, y]): P => [x - a[0], y + a[1]]) : drawnFrom(e, a, v, e.kind === "route" ? e.breakAt : undefined, holeBy(f, d));
        expect(resolveDrawing(drawn(raw), offenseContext(offense(d.id), playbook, slot, 40), config), `${slot} ${v.use}`).toEqual(BASE);
      }
    });
  }
  for (const d of f.defense.designs) {
    it(d.id, () => {
      const align = defAlign(f, d);
      let n = 0;
      for (const slot of onField(personnel.packages[d.package] as Record<string, number>)) {
        const a = align[slot] as Pair;
        const listed = d.assignments[slot];
        // config.json: an unlisted lineman rushes, the outermost on each side at the edge.
        const line = Object.entries(align).filter(([k]) => pos(k) === "DL").map(([, p]) => p[0]);
        const v = listed === undefined ? { use: a[0] === Math.min(...line) || a[0] === Math.max(...line) ? "rush.edge" : "rush.inside" } : ref(listed);
        const e = f.library.assignments[v.use];
        if (e === undefined) throw new Error(slot);
        if (e.kind === "man") continue; // Can't be drawn (assignment kinds table).
        const raw: P[] = e.kind === "spy" ? [[0, 0]] : e.kind === "zone" ? [[0, 0], [R((v.at as Pair)[0] - a[0]), R((v.at as Pair)[1] - a[1])]] : "pts" in e ? drawnFrom(e, a, v) : [];
        expect(resolveDrawing(drawn(raw), defenseContext(defense(d.id), playbook, slot, 40), config), `${slot} ${v.use}`).toEqual(BASE);
        n++;
      }
      expect(n).toBeGreaterThan(3);
    });
  }
  it("by features, not by points: another drawing with the same features is the base, a yard deeper is not", () => {
    // Shotgun Slant Flat: WR1 at (-21, 1) runs 3 up, then [5, 8]: breaks at 2, ends on the left.
    const ctx = offenseContext(offense("shotgun.shortPass.slantFlat"), playbook, "WR1", 40);
    expect(resolveDrawing([[0, 0], [0, 3], [4, 6.5]], ctx, config)).toEqual(BASE);
    expect(resolveDrawing([[0, 0], [0, 4], [4, 7.5]], ctx, config)).toMatchObject(other({ kind: "route", family: "slant", breakDepth: 3, catchDepth: 3 }));
  });
  it("R1: two posts with the same break and different ends are different", () => {
    // Shotgun PA Post: WR1 (1 back) goes up 6 and then 14 in and 10 up, so it breaks at 5 and ends at 15.
    const ctx = offenseContext(offense("shotgun.playAction.paPost"), playbook, "WR1", 40);
    expect(resolveDrawing([[0, 0], [0, 6], [14, 16]], ctx, config)).toEqual(BASE);
    expect(resolveDrawing([[0, 0], [0, 6], [14, 18]], ctx, config)).toMatchObject(other({ family: "post", breakDepth: 5, catchDepth: 17 }));
  });
  it("R1 again, on PA Flood's post, which breaks at 11 and ends 23 past the line", () => {
    const ctx = offenseContext(offense("shotgun.playAction.paFlood"), playbook, "WR1", 40);
    expect(resolveDrawing([[0, 0], [0, 12], [8, 24]], ctx, config)).toEqual(BASE);
    expect(resolveDrawing([[0, 0], [0, 12], [9, 26]], ctx, config)).toMatchObject(other({ family: "post", breakDepth: 11, catchDepth: 25 }));
  });
  it("a refused drawing keeps its reason", () => {
    expect(resolveDrawing([[0, 0], [0, 1]], offCtx("WR1"), config)).toEqual({ ok: false, reason: "tooShort" });
    expect(resolveDrawing([[0, 0], [0, 15]], offCtx("OL1"), config)).toEqual({ ok: false, reason: "ineligible" });
    expect(resolveDrawing([[0, 0], [0, 5.2]], defCtx("LB2"), config)).toEqual({ ok: false, reason: "notCanonical" });
  });
  it("with no design behind it there is no base, so nothing resolves to one", () => {
    expect(resolveDrawing([[0, 0], [0, 15]], offCtx("WR1"), config)).toMatchObject(other({ family: "go" }));
  });
});

describe("R17: whole yards, once", () => {
  it("a half goes the same way for a break and for an end, at every bucket edge", () => {
    for (const [half, depth, bucket] of [[-0.5, 0, "short"], [9.5, 10, "intermediate"], [19.5, 20, "deep"]] as const) {
      // Out at that depth from RB1, 7 back. Straight up to it from WR1 where that is past the line.
      expect(feat([[0, 0], [-3, 7 + half], [-12, 7 + half]], offCtx("RB1"))).toMatchObject({ breakDepth: depth, catchDepth: depth, bucket });
      if (half > 2) expect(feat([[0, 0], [0, half + 1]], offCtx("WR1"))).toMatchObject({ family: "go", breakDepth: depth, catchDepth: depth, bucket });
    }
  });
  it("a post and a corner caught at 19.5 are 20, and deep", () => {
    for (const got of bothSides("TE1", [[0, 0], [0, 12], [-8, 20.5]])) expect(got).toMatchObject({ family: "corner", breakDepth: 11, catchDepth: 20, bucket: "deep" });
    for (const got of bothSides("WR1", [[0, 0], [0, 12], [8, 20.5]])) expect(got).toMatchObject({ family: "post", breakDepth: 11, catchDepth: 20, bucket: "deep" });
  });
  it("no slant or flat is ever in the intermediate bucket by its end, and no post with a short break is under 10", () => {
    for (let y = 2; y <= 14; y += 0.5) {
      const s = feat([[0, 0], [7, y]], offCtx("WR1"));
      if (s.kind !== "route") throw new Error("kind");
      if (s.family === "slant") expect(s.bucket, `${y}`).toBe("short");
      if (s.family === "post") expect(s.bucket, `${y}`).toBe("intermediate");
    }
  });
});

describe("R16: the base assignment drawn again is legal at every spot", () => {
  /** Each drawable slot's own path, as drawn, in both files. */
  const own: { id: string; slot: string; raw: P[]; ctx: (spot: number) => ClassifyContext }[] = [];
  for (const d of f.offense.designs) {
    const runCall = ["insideRun", "outsideRun", "qbSneak"].includes(d.concept);
    for (const slot of Object.keys(d.assignments).filter((s) => !["OL", "QB"].includes(pos(s)) && (!runCall || s === d.carrier))) {
      const v = ref(d.assignments[slot] as string);
      const e = f.library.assignments[v.use];
      const a = (f.alignments.offense[d.formation] as Record<string, Pair>)[slot] as Pair;
      if (e === undefined || !("pts" in e)) throw new Error(slot);
      const raw = e.kind === "runPath" ? runnerTrack(f, d).map(([x, y]): P => [x - a[0], y + a[1]]) : drawnFrom(e, a, v, e.kind === "route" ? e.breakAt : undefined, holeBy(f, d));
      own.push({ id: d.id, slot, raw, ctx: (spot) => offenseContext(offense(d.id), playbook, slot, spot) });
    }
  }
  for (const d of f.defense.designs)
    for (const { slot, entry, listed } of defEntries(f, d)) {
      if (!listed || entry.kind === "man") continue;
      const a = defAlign(f, d)[slot] as Pair;
      const v = ref(d.assignments[slot] as string);
      const raw: P[] = entry.kind === "spy" ? [[0, 0]] : entry.kind === "zone" ? [[0, 0], [R((v.at as Pair)[0] - a[0]), R((v.at as Pair)[1] - a[1])]] : "pts" in entry ? drawnFrom(entry, a, v) : [];
      own.push({ id: d.id, slot, raw, ctx: (spot) => defenseContext(defense(d.id), playbook, slot, spot) });
    }
  for (const spot of [1, 2, 5, 80, 95, 98, 99]) {
    it(`at ${spot} yards from the offense's goal line`, () => {
      let past = 0;
      for (const o of own) {
        const q = quantizePath(o.raw, config);
        if (!q.ok) throw new Error(`${o.id} ${o.slot} ${q.reason}`);
        const ctx = o.ctx(spot);
        expect(resolveDrawing(q.path, ctx, config), `${o.id} ${o.slot}`).toEqual(BASE);
        const back = (ctx.alignment[o.slot] as Pair)[1] * (ctx.side === "offense" ? -1 : 1);
        if (q.path.some((p) => back + p[1] > 110 - spot)) past++;
      }
      // At the far end plenty of them run past the end line, so the spot matters here.
      if (spot >= 95) expect(past).toBeGreaterThan(40);
    });
  }
  it("by features: another drawing of the base past the end line is the base, a different depth is out of bounds", () => {
    // Shotgun Four Verticals WR1: a go that ends 29 past the line. From the 98 the end line is 12 past it.
    const ctx = offenseContext(offense("shotgun.deepPass.fourVerticals"), playbook, "WR1", 98);
    expect(resolveDrawing([[0, 0], [-0.5, 30]], ctx, config)).toEqual(BASE);
    for (const y of [13.5, 20, 28, 31]) expect(resolveDrawing([[0, 0], [0, y]], ctx, config), `${y}`).toEqual({ ok: false, reason: "outOfBounds" });
    expect(resolveDrawing([[0, 0], [0, 12.5]], ctx, config)).toMatchObject(other({ family: "go" }));
  });
  it("any other path stays in bounds at both ends and for defenders", () => {
    const rb = (spot: number) => offenseContext(offense("underCenter.shortPass.slantFlat"), playbook, "RB1", spot);
    expect(reason([[0, 0], [-4, -4.5], [-9, -4.5]], rb(1))).toBe("outOfBounds");
    expect(run([[0, 0], [-4, -3.5], [-9, -3.5]], rb(1))).toMatchObject({ ok: true });
    expect(reason([[0, 0], [0, 19]], rb(99))).toBe("outOfBounds");
    // From the 98 the end line is 12 past the line, where he lines up. His own zone is deep middle, so
    // deep left is another, and 3 yards past the end line.
    const s1 = defenseContext(defense("baseCover3.sky"), playbook, "S1", 98);
    expect(reason([[0, 0], [-5, 3]], s1)).toBe("outOfBounds");
    expect(run([[0, 0], [0, -6]], s1)).toMatchObject({ ok: true });
    const lb = defenseContext(defense("baseCover3.sky"), playbook, "LB2", 1);
    expect(reason([[0, 0], [0, -17]], lb)).toBe("outOfBounds");
    expect(run([[0, 0], [0, -15.5]], lb)).toMatchObject({ ok: true });
  });
  it("the sidelines still bind a drawing with the base's features, on either side and at any spot", () => {
    // Four Verticals' go: WR1 lines up at -21 and the sideline is at -26.67, so 6 outside is off.
    for (const spot of [40, 98]) {
      for (const [slot, s] of [["WR1", -1], ["WR2", 1]] as const) {
        const ctx = offenseContext(offense("shotgun.deepPass.fourVerticals"), playbook, slot, spot);
        expect(resolveDrawing([[0, 0], [s, 2], [5.5 * s, 30]], ctx, config), `${slot} ${spot}`).toEqual(BASE);
        expect(resolveDrawing([[0, 0], [s, 2], [6 * s, 30]], ctx, config), `${slot} ${spot}`).toEqual({ ok: false, reason: "outOfBounds" });
      }
    }
  });
});

describe("R14: the back on play action", () => {
  const ids = f.offense.designs.filter((d) => d.concept === "playAction" && d.formation !== "empty").map((d) => d.id);
  it("every play-action back may stay in and block, and may be drawn his own assignment", () => {
    expect(ids).toHaveLength(13);
    for (const id of ids) {
      const ctx = offenseContext(offense(id), playbook, "RB1", 40);
      for (const path of [[[0, 0]], [[0, 0], [0, 1]], [[0, 0], [-1, -1]]] as P[][]) expect(run(path, ctx), id).toEqual({ ok: true, features: { kind: "block", block: "pass" } });
    }
  });
  it("a route that removes the fake is still refused", () => {
    for (const id of ids) expect(reason([[0, 0], [0, 20]], offenseContext(offense(id), playbook, "RB1", 40)), id).toBe("breaksConcept");
  });
  it("nobody else on play action, and no back on a drop-back pass, can break the concept", () => {
    for (const id of ids)
      for (const slot of Object.keys(offense(id).assignments).filter((s) => ["WR", "TE"].includes(pos(s)))) expect(run([[0, 0], [0, 12]], offenseContext(offense(id), playbook, slot, 40)), `${id} ${slot}`).toMatchObject({ ok: true });
    for (const d of f.offense.designs.filter((x) => ["shortPass", "intermediatePass", "deepPass"].includes(x.concept) && x.formation !== "empty"))
      for (const path of [[[0, 0]], [[0, 0], [0, 20]]] as P[][]) expect(run(path, offenseContext(offense(d.id), playbook, "RB1", 40)), d.id).toMatchObject({ ok: true });
  });
});

describe("R15: a screen is judged by where the route ends", () => {
  /** A playbook copy with one assignment of one design changed. */
  const withRoute = (id: string, slot: string, v: unknown, lib: Record<string, unknown> = {}) => {
    const pb = structuredClone(playbook) as unknown as { offense: { designs: { id: string; assignments: Record<string, unknown> }[] }; library: { assignments: Record<string, unknown> } };
    (pb.offense.designs.find((d) => d.id === id) as { assignments: Record<string, unknown> }).assignments[slot] = v;
    Object.assign(pb.library.assignments, lib);
    return pb as unknown as typeof playbook;
  };
  const ctxIn = (pb: typeof playbook, id: string, slot: string) => offenseContext(pb.offense.designs.find((d) => d.id === id) as OffenseDesign, pb, slot, 40);
  const id = "shotgun.screenPass.bubbleScreen";
  const deep: P[] = [[0, 0], [0, 15]];
  it("the swing's end counts though its family is swing, so the bubble may go", () => {
    // RB1 is 5 deep and back.swing ends 4 up: 1 behind the line.
    expect(run(deep, ctxIn(playbook, id, "WR3"))).toMatchObject({ ok: true });
  });
  it("a swing that ends past the line does not count, so the bubble must stay", () => {
    const lib = { "back.longSwing": { ...(playbook.library.assignments["back.swing"] as object), pts: [[2, 1.5], [6, 2], [8, 6]] } };
    const pb = withRoute(id, "RB1", { use: "back.longSwing", to: "left" }, lib);
    expect(reason(deep, ctxIn(pb, id, "WR3"))).toBe("breaksConcept");
    expect(run(deep, ctxIn(pb, id, "RB1"))).toMatchObject({ ok: true });
  });
  it("a route declared screen but pushed past the line by its depth does not count either", () => {
    const pb = withRoute(id, "WR3", { use: "route.bubble", depth: 5, primary: true });
    expect(run(deep, ctxIn(pb, id, "WR3"))).toMatchObject({ ok: true });
    expect(reason(deep, ctxIn(pb, id, "RB1"))).toBe("breaksConcept");
  });
  it("a route declared anything else that ends behind the line does count", () => {
    const lib = { "route.backOut": { ...(playbook.library.assignments["route.bubble"] as object), family: "flat" } };
    const pb = withRoute(id, "WR1", { use: "route.backOut" }, lib);
    for (const slot of ["WR1", "WR3", "RB1"]) expect(run(deep, ctxIn(pb, id, slot)), slot).toMatchObject({ ok: true });
    expect(run(deep, ctxIn(withRoute(id, "RB1", { use: "block.protect", to: "left" }, lib), id, "WR1"))).toMatchObject({ ok: true });
  });
  it("the drawing too: the last one may be any family that ends at or behind the line, and none past it", () => {
    const back = offenseContext(offense("shotgun.screenPass.backScreen"), playbook, "RB1", 40);
    // 5 deep: up 5 ends on the line, up 5.5 ends half a yard past it.
    expect(run([[0, 0], [-6, 5]], back)).toMatchObject({ ok: true });
    expect(run([[0, 0], [-1, 3], [-4, 5]], back)).toMatchObject({ ok: true });
    expect(reason([[0, 0], [-6, 5.5]], back)).toBe("breaksConcept");
  });
});

describe("R9: prototype keys and numbers that overflow", () => {
  const KEYS = ["constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__proto__", "__defineGetter__", "__lookupSetter__"];
  for (const k of KEYS) {
    it(k, () => {
      for (const path of [[[0, 0]], [[0, 0], [0, 6]], [[0, 0], [0, -6]]] as P[][]) {
        for (const ctx of [offCtx(k), defCtx(k), offCtx(k, { call: "insideRun", carrier: k }), offenseContext(offense("shotgun.shortPass.mesh"), playbook, k, 40), defenseContext(defense("baseCover3.sky"), playbook, k, 40)] as ClassifyContext[]) {
          expect(reason(path, ctx)).toBe("noSuchSlot");
          expect(resolveDrawing(path, ctx, config)).toEqual({ ok: false, reason: "noSuchSlot" });
        }
      }
      expect(reason([[0, 0], [0, 15]], offCtx("WR1", { call: k }))).toBe("notOnThisCall");
      // A design that names a formation or package like one has nobody on the field.
      expect(reason([[0, 0], [0, 15]], offenseContext({ ...offense("shotgun.shortPass.mesh"), formation: k } as OffenseDesign, playbook, "WR1", 40))).toBe("noSuchSlot");
      expect(() => defenseContext({ ...defense("baseCover3.sky"), coverage: k } as DefenseDesign, playbook, "LB2", 40)).not.toThrow();
    });
  }
  it("finite input whose result is not finite is refused", () => {
    const M = Number.MAX_VALUE;
    for (const raw of [[[0, 0], [M, 0]], [[0, 0], [0, -M]], [[M, M], [-M, -M]], [[0, 0], [M, 0], [-M, 0]], [[0, 0], [1.7e308, 1.7e308], [0, 5]], [[0, 0], [1, 1], [M, 1e-300]], [[0, 0], [9e307, 1], [9e307, 0]], [[0, 0], [1, 9e307], [0, 9e307]], [[0, 0], [-1e308, 5], [-1e308, 0]]]) {
      const q = quantizePath(raw, config);
      expect(q.ok, JSON.stringify(raw)).toBe(false);
      if (!q.ok) expect(["notCanonical", "tooLong"]).toContain(q.reason);
    }
  });
  it("a start point far away is moved to the origin, or refused, and never gives a point that is not finite", () => {
    for (const raw of [[[1e308, 0], [1e308, 10]], [[-1e308, 1e308], [1e308, -1e308], [0, 5]], [[1e16, 0], [1e16, 8]]]) {
      const q = quantizePath(raw, config);
      if (q.ok) for (const p of q.path) expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true);
    }
  });
});

describe("R10: two designs in a group differ in the features the engine reads", () => {
  // Worked out here: no ids, labels, paths, tags, drops or traits. Routes are what the classifier
  // reads of them, since the engine reads the same.
  const thirds = (x: number) => (x < -160 / 18 ? "left" : x > 160 / 18 ? "right" : "middle");
  const side = (x: number) => (Math.abs(x) <= playbook.config.classifier.sideMiddleYards ? "middle" : x > 0 ? "right" : "left");
  function readOffense(fs: Files, d: OffenseDesign): string {
    const align = fs.alignments.offense[d.formation] as Record<string, Pair>;
    const routes: string[] = [];
    let protectors = 0;
    const blocks: string[] = [];
    let carry = "";
    for (const slot of onField(personnel.offense[d.formation] as Record<string, number>)) {
      const listed = d.assignments[slot] ?? d.line;
      const v = listed === undefined ? undefined : ref(listed);
      const e = v === undefined ? undefined : fs.library.assignments[v.use];
      const lineBlock = fs.config.concepts[d.concept]?.line as Record<string, string>;
      const block = e ?? fs.library.assignments[lineBlock["OL"] as string];
      if (block?.kind === "block") {
        if (block.block === "pass" && ["OL", "RB", "TE"].includes(pos(slot)) && block.technique !== "stalk") protectors++;
        if (block.block === "run" && pos(slot) !== "WR") blocks.push(block.technique);
      }
      if (e?.kind === "route" && v !== undefined) {
        const q = quantizePath(drawnFrom(e, align[slot] as Pair, v, e.breakAt), config);
        if (!q.ok) throw new Error(`${d.id} ${slot}`);
        const got = classifyPath(q.path, { side: "offense", slot, alignment: align as SlotAlignment, call: "shortPass", screen: d.concept === "screenPass", spot: 40 }, config);
        if (!got.ok || got.features.kind !== "route") throw new Error(`${d.id} ${slot}`);
        routes.push(JSON.stringify([got.features, v.primary === true]));
      }
      if (e?.kind === "runPath") carry = JSON.stringify([e.gap, e.counter, holeBy(fs, d) === null ? "middle" : side((holeBy(fs, d) as { x: number }).x), pos(slot)]);
    }
    return JSON.stringify({ routes: routes.sort(), protectors, carry, scheme: blocks.filter((t) => ["zone", "wedge", "pull", "lead", "draw"].includes(t)).sort() });
  }
  function readDefense(fs: Files, d: DefenseDesign): string {
    const align = defAlign(fs, d);
    const out: string[] = [];
    for (const { slot, entry, listed } of defEntries(fs, d)) {
      const a = align[slot] as Pair;
      const v = listed ? ref(d.assignments[slot] as string) : undefined;
      if (entry.kind === "zone") out.push(`zone ${entry.level} ${thirds((v?.at as Pair)[0])}`);
      if (entry.kind === "man") out.push(`man ${entry.covers.join()}`);
      if (entry.kind === "spy") out.push("spy");
      if (entry.kind === "stunt") out.push(`stunt ${entry.lane} ${side(a[0])}`);
      // A rusher is his lane and the side of the line he rushes: unlisted ends rush the edge.
      if (entry.kind === "rush" || entry.kind === "blitz") {
        const pts = drawnFrom(entry, a, v ?? { use: "" });
        const end = a[0] + (pts.at(-1) as P)[0];
        const line = Object.entries(align).filter(([k]) => pos(k) === "DL").map(([, p]) => p[0]);
        const lane = !listed && (a[0] === Math.min(...line) || a[0] === Math.max(...line)) ? "edge" : entry.lane;
        const moved = Math.abs(end) < Math.abs(a[0]) - 1.5 ? "inside move" : "";
        out.push(`rush ${lane} ${side(end)} ${moved}`);
      }
    }
    const c = fs.config.box;
    const box = Object.values(align).filter((p) => Math.abs(p[0]) <= c.halfWidthYards && p[1] <= c.maxDepthYards).length;
    const press = Object.entries(align).filter(([k, p]) => pos(k) === "CB" && p[1] <= c.pressMaxDepthYards).length;
    return JSON.stringify({ jobs: out.sort(), box, press });
  }
  const clashes = (fs: Files): string[] => {
    const seen = new Map<string, string>();
    const bad: string[] = [];
    const put = (key: string, id: string) => {
      const was = seen.get(key);
      if (was !== undefined) bad.push(`${was} = ${id}`);
      else seen.set(key, id);
    };
    for (const d of fs.offense.designs) put(`${d.formation}/${d.concept}/${readOffense(fs, d)}`, d.id);
    for (const d of fs.defense.designs) put(`${d.coverage}/${readDefense(fs, d)}`, d.id);
    return bad;
  };
  it("no two in any group", () => expect(clashes(f)).toEqual([]));
  it("the check can see a copy: a design that differs only in its path, label and drop is caught", () => {
    const fs = files();
    const mesh = fs.offense.designs.find((d) => d.id === "shotgun.shortPass.mesh") as OffenseDesign;
    const copy = { ...structuredClone(mesh), id: "copy", label: "Copy", assignments: { ...mesh.assignments, QB1: "qb.quick" } };
    const sky = fs.defense.designs.find((d) => d.id === "baseCover3.sky") as DefenseDesign;
    const skyCopy = { ...structuredClone(sky), id: "skyCopy", assignments: { ...sky.assignments, S1: { use: "zone.deep.middle", at: [1, 19] as Pair } } };
    fs.offense.designs.push(copy);
    fs.defense.designs.push(skyCopy);
    expect(clashes(fs)).toEqual(["shotgun.shortPass.mesh = copy", "baseCover3.sky = skyCopy"]);
  });
  it("the caller's presets group the defense designs", () => {
    for (const d of f.defense.designs) expect(Object.keys(caller.defenseMapping.presets), d.id).toContain(d.coverage);
  });
});
