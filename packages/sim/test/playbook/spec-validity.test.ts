// Reason codes, the canonical form and the boundaries of validity (B6, B9 and the edge cases of
// docs/specs/m3-playbook-and-custom-routes.md). Limits are the spec's proposed values: quantum 0.5,
// 12 points, 60 yards, minimum route 2, breaks of 30 degrees, at most 3.

import { describe, expect, it, vi } from "vitest";
import { REASON_CODES } from "../../../shared/src/playbook";
import type { PathPoint } from "../../../shared/src/playbook";
import { seeded } from "../../../shared/test/spec-support";
import { classifyPath, offenseContext, quantizePath } from "../../src/playbook/classify";
import type { ClassifyContext } from "../../src/playbook/classify";
import { config, configWith, defCtx, feat, offCtx, offense, playbook, reason, run } from "./spec-support";
import type { P } from "./spec-support";

vi.setConfig({ testTimeout: 60_000 });

const GO: P[] = [[0, 0], [0, 15]];

describe("the spec's limits are the data's", () => {
  it("quantum, points, length, minimum, break and breaks", () => {
    const t = playbook.config.classifier;
    expect([t.quantumYards, t.maxPoints, t.maxLengthYards, t.minRouteYards, t.breakDegrees, t.maxBreaks]).toEqual([0.5, 12, 60, 2, 30, 3]);
  });
  it("the reason list is the spec's ten", () => {
    expect([...REASON_CODES].sort()).toEqual(["breaksConcept", "ineligible", "noSuchSlot", "notCanonical", "notOnThisCall", "outOfBounds", "tooLong", "tooManyBreaks", "tooShort", "wrongGap"]);
  });
});

describe("noSuchSlot", () => {
  it("a slot that is not on the field in this formation", () => {
    expect(reason(GO, offenseContext(offense("shotgun.shortPass.mesh"), playbook, "WR4", 40))).toBe("noSuchSlot");
    expect(reason(GO, offenseContext(offense("empty.shortPass.mesh"), playbook, "RB1", 40))).toBe("noSuchSlot");
    expect(reason(GO, defCtx("CB3"))).toBe("noSuchSlot");
    expect(reason(GO, defCtx("WR1"))).toBe("noSuchSlot");
  });
  // R9: own keys only.
  for (const s of ["", "wr1", "WR", "constructor", "toString", "__proto__", "hasOwnProperty"]) it(`hostile slot "${s}"`, () => expect(reason(GO, offCtx(s))).toBe("noSuchSlot"));
  for (const s of ["", "WR1", "constructor", "toString", "__proto__", "hasOwnProperty"]) it(`hostile slot "${s}" on defense`, () => expect(reason([[0, 0], [0, 6]], defCtx(s))).toBe("noSuchSlot"));
});

describe("ineligible: OL and QB, read from data", () => {
  for (const s of ["OL1", "OL3", "OL5", "QB1"]) it(s, () => expect(reason(GO, offCtx(s))).toBe("ineligible"));
  it("the quarterback who carries a QB run is still not drawable (non-goals, and reason code ineligible)", () => {
    expect(reason([[0, 0], [1, 4], [1, 9]], offenseContext(offense("empty.insideRun.qbPower"), playbook, "QB1", 40))).toBe("ineligible");
  });
  it("every position the data lists may be drawn a route", () => {
    for (const p of playbook.config.eligibility.routePositions) expect(run(GO, offCtx(`${p}1`)), p).toMatchObject({ ok: true, features: { kind: "route" } });
  });
  it("taking a position off the data's list makes it ineligible", () => {
    const e = playbook.config.eligibility;
    expect(reason(GO, offCtx("TE1"), configWith({}, { eligibility: { ...e, routePositions: e.routePositions.filter((p) => p !== "TE") } }))).toBe("ineligible");
  });
  it("any defender may be drawn", () => {
    for (const s of ["DL1", "LB1", "CB1", "S1"]) expect(run([[0, 0], [0, 6]], defCtx(s)), s).toMatchObject({ ok: true });
  });
});

describe("notOnThisCall", () => {
  for (const call of ["punt", "fieldGoal", "extraPoint", "kickoff", "onsideKick", "kneel", "spike", "qbSneak"]) it(call, () => expect(reason(GO, offCtx("WR1", { call }))).toBe("notOnThisCall"));
  it("qb sneak: not even the backs", () => expect(reason([[0, 0], [1, 9]], offCtx("RB1", { call: "qbSneak", carrier: "QB1" }))).toBe("notOnThisCall"));
  for (const call of ["insideRun", "outsideRun"]) {
    for (const s of ["WR1", "TE1", "RB2"]) it(`${s} on ${call}, not the carrier`, () => expect(reason(GO, offCtx(s, { call, carrier: "RB1" }))).toBe("notOnThisCall"));
  }
  it("an unknown call is refused with a reason", () => expect(reason(GO, offCtx("WR1", { call: "hailMary" }))).toBe("notOnThisCall"));
  // R9: own keys only.
  it("an unknown call named like an Object.prototype member is refused too", () => expect(reason(GO, offCtx("WR1", { call: "constructor" }))).toBe("notOnThisCall"));
  it("each pass leaf allows a receiver", () => {
    for (const call of ["shortPass", "intermediatePass", "deepPass", "playAction"]) expect(run(GO, offCtx("WR1", { call })), call).toMatchObject({ ok: true });
  });
});

describe("notCanonical", () => {
  const bad: [string, unknown][] = [
    ["empty", []],
    ["first point not the origin", [[1, 0], [1, 10]]],
    ["off the quantum in x", [[0, 0], [0.25, 10]]],
    ["off the quantum in y", [[0, 0], [0, 10.3]]],
    ["two equal points in a row", [[0, 0], [0, 5], [0, 5], [0, 10]]],
    ["NaN", [[0, 0], [0, NaN]]],
    ["Infinity", [[0, 0], [Infinity, 5]]],
    ["-Infinity", [[0, 0], [0, -Infinity]]],
    ["a triple", [[0, 0], [0, 5, 1]]],
    ["a single number point", [[0, 0], [5]]],
    ["strings", [[0, 0], ["0", "5"]]],
    ["a null point", [[0, 0], null]],
  ];
  for (const [name, path] of bad) it(name, () => expect(reason(path as PathPoint[], offCtx("WR1"))).toBe("notCanonical"));
  const straight = (n: number): P[] => Array.from({ length: n }, (_, i) => [0, i]);
  it("12 points pass, 13 do not", () => {
    expect(run(straight(12), offCtx("WR1"))).toMatchObject({ ok: true });
    expect(reason(straight(13), offCtx("WR1"))).toBe("notCanonical");
  });
  it("the point limit and the quantum come from the config", () => {
    expect(reason(straight(8), offCtx("WR1"), configWith({ maxPoints: 7 }))).toBe("notCanonical");
    expect(reason([[0, 0], [0, 10.5]], offCtx("WR1"), configWith({ quantumYards: 1 }))).toBe("notCanonical");
    expect(run([[0, 0], [0, 10.25]], offCtx("WR1"), configWith({ quantumYards: 0.25 }))).toMatchObject({ ok: true });
  });
  it("defense paths are held to the same form", () => expect(reason([[0, 0], [0, 5.2]], defCtx("LB2"))).toBe("notCanonical"));
});

describe("tooShort and the minimum route", () => {
  it("a wide receiver under 2 yards", () => {
    expect(reason([[0, 0], [0, 1.5]], offCtx("WR1"))).toBe("tooShort");
    expect(reason([[0, 0], [1, 1]], offCtx("WR1"))).toBe("tooShort");
    expect(run([[0, 0], [0, 2]], offCtx("WR1"))).toMatchObject({ ok: true, features: { kind: "route" } });
  });
  for (const s of ["RB1", "TE1"]) {
    it(`${s} under the minimum stays in to block, at the minimum runs a route`, () => {
      expect(feat([[0, 0], [0, 1.5]], offCtx(s))).toEqual({ kind: "block", block: "pass" });
      expect(feat([[0, 0], [1, -1]], offCtx(s))).toEqual({ kind: "block", block: "pass" });
      expect(feat([[0, 0], [0, 2]], offCtx(s)).kind).toBe("route");
      expect(feat([[0, 0], [-2, 0]], offCtx(s)).kind).toBe("route");
    });
  }
  it("a tap: block for a back or tight end, spy for a defender, tooShort for a receiver (edge cases)", () => {
    const q = quantizePath([[0, 0]], config);
    if (!q.ok) throw new Error(q.reason);
    expect(feat(q.path, offCtx("RB1"))).toEqual({ kind: "block", block: "pass" });
    expect(feat(q.path, offCtx("TE2"))).toEqual({ kind: "block", block: "pass" });
    expect(feat(q.path, defCtx("LB2"))).toEqual({ kind: "spy" });
    expect(reason(q.path, offCtx("WR1"))).toBe("tooShort");
  });
  it("a wobbly tap on glass ends the same way", () => {
    const q = quantizePath([[0, 0], [0.05, 0.1], [-0.1, 0.05], [0.02, -0.02]], config);
    if (!q.ok) throw new Error(q.reason);
    expect(feat(q.path, offCtx("RB1"))).toEqual({ kind: "block", block: "pass" });
    expect(reason(q.path, offCtx("WR1"))).toBe("tooShort");
  });
  it("the minimum comes from the config", () => {
    expect(reason([[0, 0], [0, 4]], offCtx("WR1"), configWith({ minRouteYards: 5 }))).toBe("tooShort");
    expect(feat([[0, 0], [0, 4]], offCtx("RB1"), configWith({ minRouteYards: 5 })).kind).toBe("block");
  });
});

describe("tooLong", () => {
  it("60 yards is allowed, half a yard more is not", () => {
    expect(run([[0, 0], [0, 60]], offCtx("WR1", { spot: 20 }))).toMatchObject({ ok: true, features: { kind: "route", family: "go", bucket: "deep" } });
    expect(reason([[0, 0], [0, 60.5]], offCtx("WR1", { spot: 20 }))).toBe("tooLong");
  });
  it("the whole path counts, not the distance it covers", () => {
    expect(run([[0, 0], [0, 30], [30, 30]], offCtx("WR1", { spot: 20 }))).toMatchObject({ ok: true });
    expect(reason([[0, 0], [0, 30], [30.5, 30]], offCtx("WR1", { spot: 20 }))).toBe("tooLong");
  });
  it("the limit comes from the config, for defenders too", () => {
    expect(reason([[0, 0], [0, 15.5]], offCtx("WR1"), configWith({ maxLengthYards: 15 }))).toBe("tooLong");
    expect(reason([[0, 0], [0, 15.5]], defCtx("LB2"), configWith({ maxLengthYards: 15 }))).toBe("tooLong");
  });
});

describe("tooManyBreaks", () => {
  const three: P[] = [[0, 0], [0, 4], [3, 7], [3, 11], [6, 14]];
  const four: P[] = [...three, [6, 18]];
  it("three breaks pass, four do not", () => {
    expect(run(three, offCtx("WR1"))).toMatchObject({ ok: true });
    expect(reason(four, offCtx("WR1"))).toBe("tooManyBreaks");
  });
  it("four gentle bends under 30 degrees are not breaks", () => {
    expect(run([[0, 0], [0, 4], [1, 8], [0.5, 12], [1.5, 16], [1, 20]], offCtx("WR1"))).toMatchObject({ ok: true });
  });
  it("the limit comes from the config", () => {
    expect(reason(three, offCtx("WR1"), configWith({ maxBreaks: 2 }))).toBe("tooManyBreaks");
    expect(run(four, offCtx("WR1"), configWith({ maxBreaks: 4 }))).toMatchObject({ ok: true });
  });
  it("applies to a defender's path", () => expect(reason(four, defCtx("LB2"))).toBe("tooManyBreaks"));
});

describe("outOfBounds", () => {
  // Half the field is 26.65 yards (width from data). WR1 is at -20, WR2 at +20.
  const half = playbook.config.field.widthYards / 2;
  it("each sideline", () => {
    expect(half).toBeGreaterThan(26.5);
    expect(half).toBeLessThan(27);
    expect(run([[0, 0], [0, 8], [-6.5, 8]], offCtx("WR1"))).toMatchObject({ ok: true });
    expect(reason([[0, 0], [0, 8], [-7, 8]], offCtx("WR1"))).toBe("outOfBounds");
    expect(run([[0, 0], [0, 8], [6.5, 8]], offCtx("WR2"))).toMatchObject({ ok: true });
    expect(reason([[0, 0], [0, 8], [7, 8]], offCtx("WR2"))).toBe("outOfBounds");
  });
  it("any point, not only the last", () => expect(reason([[0, 0], [-7, 8], [-4, 15]], offCtx("WR1"))).toBe("outOfBounds"));
  it("the end line from the 2: 12 yards past the line, so a go drawn deeper is refused and not clipped", () => {
    const at2 = { spot: 98 };
    expect(run([[0, 0], [0, 12.5]], offCtx("WR1", at2))).toMatchObject({ ok: true });
    expect(reason([[0, 0], [0, 13.5]], offCtx("WR1", at2))).toBe("outOfBounds");
    expect(reason([[0, 0], [0, 25]], offCtx("WR1", at2))).toBe("outOfBounds");
    expect(run([[0, 0], [0, 25]], offCtx("WR1", { spot: 40 }))).toMatchObject({ ok: true });
  });
  it("depth is counted from where the player lines up: a back 7 yards deep has 7 more", () => {
    expect(run([[0, 0], [0, 18.5]], offCtx("RB1", { spot: 98 }))).toMatchObject({ ok: true });
    expect(reason([[0, 0], [0, 19.5]], offCtx("RB1", { spot: 98 }))).toBe("outOfBounds");
  });
  it("the offense's own end line, backed up on the 1", () => {
    expect(run([[0, 0], [-4, -3], [-9, -3]], offCtx("RB1", { spot: 1 }))).toMatchObject({ ok: true });
    expect(reason([[0, 0], [-4, -4.5], [-9, -4.5]], offCtx("RB1", { spot: 1 }))).toBe("outOfBounds");
  });
  it("a defender's drop: sidelines and the end line", () => {
    expect(reason([[0, 0], [-7, 3]], defCtx("CB1"))).toBe("outOfBounds");
    expect(reason([[0, 0], [7, 3]], defCtx("CB2"))).toBe("outOfBounds");
    expect(reason([[0, 0], [0, 8]], defCtx("LB2", { spot: 98 }))).toBe("outOfBounds");
    expect(run([[0, 0], [0, 6]], defCtx("LB2", { spot: 98 }))).toMatchObject({ ok: true });
  });
  it("the field's width comes from data", () => {
    const narrow = configWith({}, { field: { ...playbook.config.field, widthYards: 48 } });
    expect(reason([[0, 0], [0, 8], [-5, 8]], offCtx("WR1"), narrow)).toBe("outOfBounds");
  });
});

describe("run paths and wrongGap", () => {
  // RB1 is at (0, 7): he crosses the line at y = 7. Lanes in the middle of each gap, with the
  // linemen at 0, 2 and 4 and the tight end at 6: A 1, B 3, C 5, edge 10.
  const through = (x: number): P[] => [[0, 0], [x, 5], [x, 10]];
  const inside = offCtx("RB1", { call: "insideRun", carrier: "RB1" });
  const outside = offCtx("RB1", { call: "outsideRun", carrier: "RB1" });
  for (const [x, gap, ok] of [[1, "A", "in"], [3, "B", "in"], [5, "C", "out"], [10, "edge", "out"]] as const) {
    for (const s of [1, -1] as const) {
      it(`${gap} gap ${s === 1 ? "right" : "left"}`, () => {
        const side = s === 1 ? "right" : "left";
        const good = ok === "in" ? inside : outside;
        const bad = ok === "in" ? outside : inside;
        const f = feat(through(x * s), good);
        expect(f).toMatchObject({ kind: "runPath", gap });
        if (gap !== "A") expect(f).toMatchObject({ side });
        expect(reason(through(x * s), bad)).toBe("wrongGap");
      });
    }
  }
  it("the gap is where the path crosses the line, not where it ends", () => {
    expect(feat([[0, 0], [1, 6], [1, 8], [10, 12]], inside)).toMatchObject({ gap: "A" });
    expect(reason([[0, 0], [10, 6], [10, 8], [1, 12]], inside)).toBe("wrongGap");
  });
  it("the gap edges come from the config", () => {
    expect(reason(through(3), inside, configWith({ gapEdgesYards: [1, 2, 4] }))).toBe("wrongGap");
  });
  it("a run path that leaves the field is refused", () => {
    expect(run([[0, 0], [10, 5], [27, 9]], outside)).toEqual({ ok: false, reason: "outOfBounds" });
  });
});

describe("breaksConcept", () => {
  const back = (slot: string) => offenseContext(offense("shotgun.screenPass.backScreen"), playbook, slot, 40);
  it("the only route behind the line redrawn downfield", () => expect(reason([[0, 0], [0, 15]], back("RB1"))).toBe("breaksConcept"));
  it("the only route behind the line told to stay in and block", () => expect(reason([[0, 0]], back("RB1"))).toBe("breaksConcept"));
  it("the screen redrawn as another route behind the line is fine", () => {
    expect(run([[0, 0], [0, 1.5], [6, 1.5]], back("RB1"))).toMatchObject({ ok: true, features: { family: "screen", bucket: "behind" } });
  });
  it("redrawing anyone else keeps the screen", () => expect(run([[0, 0], [0, 15]], back("WR2"))).toMatchObject({ ok: true }));
  it("a screen with two routes behind the line can lose one", () => {
    // Shotgun Bubble Screen: the bubble and the back's swing both end behind the line.
    expect(run([[0, 0], [0, 15]], offenseContext(offense("shotgun.screenPass.bubbleScreen"), playbook, "WR3", 40))).toMatchObject({ ok: true });
    expect(run([[0, 0], [0, 15]], offenseContext(offense("shotgun.screenPass.bubbleScreen"), playbook, "RB1", 40))).toMatchObject({ ok: true });
  });
  it("the same drawing on a drop-back pass is fine", () => expect(run([[0, 0], [0, 15]], offCtx("RB1"))).toMatchObject({ ok: true }));
  for (const id of ["shotgun.playAction.paPost", "underCenter.playAction.bootleg", "pistol.playAction.paDig", "heavy.playAction.paSeam"]) {
    it(`${id}: the faking back sent out on a route`, () => expect(reason([[0, 0], [0, 15]], offenseContext(offense(id), playbook, "RB1", 40))).toBe("breaksConcept"));
    it(`${id}: a tight end can be redrawn`, () => expect(run([[0, 0], [0, 12]], offenseContext(offense(id), playbook, "TE1", 40))).toMatchObject({ ok: true }));
  }
  it("Empty play action has no back, so every receiver can be redrawn", () => {
    for (const s of ["WR1", "WR2", "WR3", "WR4", "TE1"]) expect(run([[0, 0], [0, 12]], offenseContext(offense("empty.playAction.paSeam"), playbook, s, 40)), s).toMatchObject({ ok: true });
  });
});

describe("B9: quantizePath", () => {
  const isCanon = (path: readonly PathPoint[]): string | null => {
    if (path.length < 1 || path.length > 12) return "points";
    if (path[0]?.[0] !== 0 || path[0][1] !== 0) return "origin";
    let len = 0;
    for (let i = 0; i < path.length; i++) {
      const p = path[i] as PathPoint;
      if (p.length !== 2 || p.some((v) => !Number.isInteger(v * 2))) return "quantum";
      if (p.some((v) => Object.is(v, -0))) return "negative zero";
      const q = path[i - 1];
      if (q === undefined) continue;
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d === 0) return "repeat";
      len += d;
    }
    return len <= 60 + 1e-9 ? null : "length";
  };
  const check = (raw: readonly (readonly number[])[]) => {
    const r = quantizePath(raw, config);
    const fail = (why: string): never => {
      throw new Error(`${why}: ${JSON.stringify(raw).slice(0, 400)} gave ${JSON.stringify(r)}`);
    };
    if (JSON.stringify(quantizePath(raw, config)) !== JSON.stringify(r)) fail("not repeatable");
    if (!r.ok) {
      if (!REASON_CODES.includes(r.reason)) fail("unknown reason");
      return r;
    }
    const bad = isCanon(r.path);
    if (bad !== null) fail(`not canonical (${bad})`);
    if (JSON.stringify(quantizePath(r.path, config)) !== JSON.stringify(r)) fail("not idempotent");
    const c = classifyPath(r.path, offCtx("WR1"), config);
    if (!c.ok && c.reason === "notCanonical") fail("the classifier refuses it");
    return r;
  };

  const hostile: [string, number[][]][] = [
    ["empty", []],
    ["one point at the origin", [[0, 0]]],
    ["one point elsewhere", [[7, 3]]],
    ["two equal points", [[0, 0], [0, 0]]],
    ["a thousand equal points", Array.from({ length: 1000 }, () => [3, 4])],
    ["NaN first", [[NaN, 0], [0, 5]]],
    ["NaN later", [[0, 0], [0, 5], [NaN, NaN]]],
    ["Infinity", [[0, 0], [Infinity, 0]]],
    ["-Infinity", [[0, 0], [0, -Infinity]]],
    ["huge", [[0, 0], [1e300, 1e300]]],
    ["max value both ways", [[-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 0]]],
    ["beyond safe integers", [[0, 0], [2 ** 60, 1]]],
    ["denormal", [[0, 0], [5e-324, 5e-324]]],
    ["negative zeros", [[-0, -0], [-0, 5]]],
    ["a missing coordinate", [[0, 0], [5]]],
    ["an empty point", [[]]],
    ["a triple", [[0, 0], [1, 2, 3]]],
    ["not starting at the origin", [[4, 4], [4, 14]]],
    ["tiny negatives that round to zero", [[0, 0], [-0.1, 8]]],
    ["exactly 60 yards", [[0, 0], [0, 60]]],
    ["60.2 yards, which snaps to 60", [[0, 0], [0, 60.2]]],
    ["61 yards", [[0, 0], [0, 61]]],
    ["a spiral", Array.from({ length: 1000 }, (_, i) => [Math.cos(i / 10) * (i / 100), Math.sin(i / 10) * (i / 100)])],
    ["a thousand points straight up", Array.from({ length: 1000 }, (_, i) => [0, i / 50])],
    ["a thousand points of sawtooth", Array.from({ length: 1000 }, (_, i) => [i % 2, i / 50])],
    ["a thousand wild points", (() => { const r = seeded(3); return Array.from({ length: 1000 }, () => [(r() - 0.5) * 1e6, (r() - 0.5) * 1e6]); })()],
  ];
  for (const [name, raw] of hostile) it(`hostile: ${name}`, () => expect(() => check(raw)).not.toThrow());
  for (const name of ["empty", "NaN first", "NaN later", "Infinity", "-Infinity", "huge", "max value both ways", "61 yards"]) {
    it(`refused: ${name}`, () => expect(quantizePath((hostile.find((h) => h[0] === name) as [string, number[][]])[1], config).ok).toBe(false));
  }
  it("too long is said as tooLong", () => expect(quantizePath([[0, 0], [0, 61]], config)).toEqual({ ok: false, reason: "tooLong" }));
  it("a thousand points straight up is one straight line", () => {
    expect(quantizePath(Array.from({ length: 1000 }, (_, i) => [0, i / 50]), config)).toEqual({ ok: true, path: [[0, 0], [0, 20]] });
  });
  it("snaps to the nearest half yard", () => expect(quantizePath([[0, 0], [0.1, 9.9], [-5.2, 10.1]], config)).toEqual({ ok: true, path: [[0, 0], [0, 10], [-5, 10]] }));
  it("does not mutate its input", () => {
    const raw = [[0, 0], [0.1, 9.9], [-5.2, 10.1]];
    const copy = structuredClone(raw);
    quantizePath(raw, config);
    expect(raw).toEqual(copy);
  });
  it("2,000 random drawings give a canonical path or a reason, and quantizing again changes nothing", () => {
    const r = seeded(99);
    let ok = 0;
    for (let k = 0; k < 2000; k++) {
      const n = 1 + Math.floor(r() * 80);
      const step = r() * 3;
      let [x, y] = r() < 0.5 ? [0, 0] : [(r() - 0.5) * 4, (r() - 0.5) * 4];
      let head = r() * Math.PI * 2;
      const raw = Array.from({ length: n }, () => {
        const p = [x, y];
        head += (r() - 0.5) * 1.2;
        x += Math.cos(head) * step;
        y += Math.sin(head) * step;
        return p;
      });
      if (check(raw).ok) ok++;
    }
    expect(ok).toBeGreaterThan(300);
  });
  it("what the hand drew stays within a yard of what is kept, for ordinary smooth drawings", () => {
    const r = seeded(5);
    for (let k = 0; k < 200; k++) {
      let [x, y] = [0, 0];
      let head = Math.PI / 2 + (r() - 0.5);
      const bend = (r() - 0.5) * 0.06;
      const raw = Array.from({ length: 80 }, () => {
        const p: P = [x, y];
        head += bend;
        x += Math.cos(head) * 0.25;
        y += Math.sin(head) * 0.25;
        return p;
      });
      const q = quantizePath(raw, config);
      if (!q.ok) continue;
      let worst = 0;
      for (const p of raw) {
        let best = Infinity;
        q.path.slice(1).forEach((b, i) => {
          const a = q.path[i] as PathPoint;
          const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)));
          best = Math.min(best, Math.hypot(p[0] - a[0] - t * (b[0] - a[0]), p[1] - a[1] - t * (b[1] - a[1])));
        });
        worst = Math.max(worst, best);
      }
      expect(worst).toBeLessThanOrEqual(1);
    }
  });
});

describe("the context it is given is enough: an answer never depends on call order", () => {
  it("interleaved calls give the same results", () => {
    const ctxs: ClassifyContext[] = [offCtx("WR1"), offCtx("RB1"), defCtx("LB2"), offCtx("OL1")];
    const paths: P[][] = [[[0, 0], [0, 15]], [[0, 0], [4, 3]], [[0, 0], [0, -8]]];
    const first = ctxs.map((c) => paths.map((p) => run(p, c)));
    const second = [...ctxs].reverse().map((c) => [...paths].reverse().map((p) => run(p, c)).reverse()).reverse();
    expect(second).toEqual(first);
  });
});
