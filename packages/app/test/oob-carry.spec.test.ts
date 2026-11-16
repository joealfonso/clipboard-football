// Spec tests for docs/DECISIONS.md, "Out-of-bounds carry runs upfield first" (lead, 2026-11-15;
// designed, display only), written by test-writer from the stated behavior, not the code:
//
// On a carried play the engine ends out of bounds (play.outOfBounds === true), the ball carrier
// after the catch or handoff
//   1. ends at the engine's dead spot on the sideline (x = 0 or the field width, y = end.spot);
//   2. when the depth left from his start-of-carry point to the dead spot is greater than the
//      lateral distance left, runs straight upfield at his x first, then makes one 45-degree cut to
//      the dead spot, the cut starting where the depth left equals the lateral left;
//   3. when the depth left is at most the lateral left, runs a straight line to the dead spot;
//   4. never moves backward (away from the dead spot's y) and stays on the field to the sideline;
//   5. plays that are not out of bounds are unchanged (a completion's carry stays the straight line);
//   6. the same input gives the same plan.
//
// Everything is read off the drawn keys: the start of the carry is where the ball first meets the
// holder's mark after the snap (the catch on a completion), the end is his mark at the whistle.
// The drive fillet rounds the one corner: points within CORNER_BAND yards (in y) of the cut are not
// held to either straight piece.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlayEvent } from "../src/engine/types";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { at, FIELD_WIDTH, timeline, type Pt, type Timeline, type TimelineCtx, type TLMark } from "../src/ui/timeline";
import { COMPLETE } from "./fixtures";
import { playGame } from "./support";

const read = (p: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", p), "utf8"));
const templates = parseTemplates(read("data/ui/templates.json"));
const motion = parseMotion(read("data/ui/motion.json"));
const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };
const ctx: TimelineCtx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion };
const build = (event: PlayEvent): Timeline => timeline({ event, runoffSeconds: 0, human: null, ownStart: "lined" }, templates, ctx);

const STEP = 25;
/** How far from a straight piece a drawn point may sit (key sampling and interpolation). */
const ON_LINE = 0.25;
/** Points this close (in y) to the cut belong to the fillet and are held to neither piece. */
const CORNER_BAND = 1.5;

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
/** Distance from p to the segment a-b. */
const toSegment = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  const s = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
  return dist(p, { x: a.x + s * dx, y: a.y + s * dy });
};

interface Carry {
  readonly ev: PlayEvent;
  readonly tl: Timeline;
  readonly mark: TLMark;
  /** When and where the ball first meets his mark after the snap. */
  readonly t0: number;
  readonly start: Pt;
  /** His mark at the whistle. */
  readonly end: Pt;
  /** His drawn points from t0 to the whistle, every 25 ms. */
  readonly pts: readonly Pt[];
  readonly label: string;
}

function carryOf(ev: PlayEvent, label: string): Carry | null {
  const tl = build(ev);
  if (tl.holder === null) return null;
  const mark = tl.marks.find((m) => m.playerId === tl.holder);
  if (mark === undefined) return null;
  let t0 = -1;
  for (let t = tl.snapAt; t <= tl.liveEnd; t += STEP) {
    if (dist(at(mark.keys, t), at(tl.ball, t)) < 0.05) {
      t0 = t;
      break;
    }
  }
  if (t0 < 0) return null;
  const pts: Pt[] = [];
  for (let t = t0; t < tl.liveEnd; t += STEP) pts.push(at(mark.keys, t));
  pts.push(at(mark.keys, tl.liveEnd));
  return { ev, tl, mark, t0, start: at(mark.keys, t0), end: at(mark.keys, tl.liveEnd), pts, label };
}

const deadY = (ev: PlayEvent): number => {
  const p = ev.play as { end?: { spot: number } };
  if (p.end === undefined) throw new Error("no end");
  return p.end.spot;
};
const isOob = (ev: PlayEvent): boolean => (ev.play as { outOfBounds?: boolean }).outOfBounds === true;
const isCompletion = (ev: PlayEvent): boolean => {
  const p = ev.play as { kind: string; incomplete?: boolean; turnover?: string };
  return p.kind === "pass" && p.incomplete !== true && p.turnover === undefined;
};
const isHandoffRun = (ev: PlayEvent): boolean => ev.play.kind === "run" && ev.offense.call !== "qbSneak" && (ev.play as { turnover?: string }).turnover === undefined;

const SEEDS = [71, 72, 73, 74, 75, 76, 77, 78, 79, 80];
const games = SEEDS.map((seed) => ({ seed, events: playGame(seed, seed % 2 === 0 ? "home" : "away", seed).events.filter((e): e is PlayEvent => e.t === "play") }));
const tag = (seed: number, ev: PlayEvent, i: number): string => `seed ${seed} play ${i} ${ev.play.kind} ${ev.offense.call} los ${ev.before.spot} spot ${deadY(ev)}`;

const carries = (pick: (ev: PlayEvent) => boolean): Carry[] =>
  games.flatMap(({ seed, events }) =>
    events.flatMap((ev, i) => {
      if (!pick(ev)) return [];
      const c = carryOf(ev, tag(seed, ev, i));
      return c === null ? [] : [c];
    }),
  );

/** Out-of-bounds completions where the receiver runs after the catch. */
const obCompletions = carries((ev) => isOob(ev) && isCompletion(ev)).filter((c) => dist(c.start, c.end) >= 0.5);
const obRuns = carries((ev) => isOob(ev) && isHandoffRun(ev));
const deep = obCompletions.filter((c) => Math.abs(c.end.y - c.start.y) > Math.abs(c.end.x - c.start.x) + 1e-6);
const shallow = obCompletions.filter((c) => Math.abs(c.end.y - c.start.y) <= Math.abs(c.end.x - c.start.x) + 1e-6);

/**
 * Checks spec 2 on one carry; returns the problems. The plan: up at his x to the cut, where the
 * depth left equals the lateral left, then 45 degrees to the dead spot.
 */
function upfieldThenCut(c: Carry): string[] {
  const out: string[] = [];
  const a = c.start;
  const b = c.end;
  const lat = Math.abs(b.x - a.x);
  const dir = Math.sign(b.y - a.y);
  const cutY = b.y - dir * lat;
  const cut: Pt = { x: a.x, y: cutY };
  let onUp = 0;
  let onCut = 0;
  for (const p of c.pts) {
    const left = dir * (cutY - p.y); // depth left before the cut
    if (left > CORNER_BAND) {
      onUp++;
      if (Math.abs(p.x - a.x) > ON_LINE) out.push(`${c.label}: before the cut at y ${p.y.toFixed(2)} x is ${p.x.toFixed(2)}, not his x ${a.x.toFixed(2)}`);
    } else if (left < -CORNER_BAND) {
      onCut++;
      if (toSegment(p, cut, b) > ON_LINE) out.push(`${c.label}: after the cut (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) is off the 45-degree line to the dead spot`);
      const depthLeft = Math.abs(b.y - p.y);
      const latLeft = Math.abs(b.x - p.x);
      if (Math.abs(depthLeft - latLeft) > ON_LINE * 1.5) out.push(`${c.label}: after the cut depth left ${depthLeft.toFixed(2)} vs lateral left ${latLeft.toFixed(2)} (not 45 degrees)`);
    }
  }
  // The pieces must actually be drawn, or the checks above say nothing.
  if (dir * (cutY - a.y) > 2 * CORNER_BAND && onUp < 2) out.push(`${c.label}: no points on the upfield piece`);
  if (lat > 2 * CORNER_BAND && onCut < 2) out.push(`${c.label}: no points on the cut`);
  return out;
}

function straight(c: Carry): string[] {
  return c.pts.filter((p) => toSegment(p, c.start, c.end) > ON_LINE).map((p) => `${c.label}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) is off the straight line from the start of the carry to the dead spot`);
}

function forwardAndOnField(c: Carry): string[] {
  const out: string[] = [];
  const dir = Math.sign(deadY(c.ev) - c.start.y);
  for (let i = 0; i < c.pts.length; i++) {
    const p = c.pts[i] as Pt;
    if (p.x < -1e-6 || p.x > FIELD_WIDTH + 1e-6) out.push(`${c.label}: off the field at x ${p.x.toFixed(3)}`);
    if (i > 0 && dir * (p.y - (c.pts[i - 1] as Pt).y) < -1e-6) out.push(`${c.label}: moves backward at y ${p.y.toFixed(3)}`);
    // On the field until the sideline: only the last point may touch it.
    if (i < c.pts.length - 1 && (p.x <= 1e-6 || p.x >= FIELD_WIDTH - 1e-6) && dist(p, c.end) > 0.5) out.push(`${c.label}: on the sideline at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) before the dead spot`);
  }
  return out;
}

describe("the sample has the cases the spec names", () => {
  it("out-of-bounds completions with depth > lateral and with depth <= lateral, and out-of-bounds runs", () => {
    expect(deep.length).toBeGreaterThanOrEqual(3);
    expect(shallow.length).toBeGreaterThanOrEqual(3);
    expect(obRuns.length).toBeGreaterThanOrEqual(3);
    // At least one deep case with enough lateral room that a straight line would sit far off the upfield piece.
    expect(deep.some((c) => Math.abs(c.end.x - c.start.x) >= 4)).toBe(true);
  });

  it("seed 71 has a play-action completion caught near the left sideline that goes out deeper upfield", () => {
    const pa = deep.filter((c) => c.label.startsWith("seed 71 ") && c.ev.offense.call === "playAction" && c.start.x < 8 && c.end.x === 0);
    expect(pa.length).toBeGreaterThanOrEqual(1);
  });
});

describe("1. the carry ends at the engine's dead spot on the sideline", () => {
  it("every out-of-bounds completion and run: the holder's mark at the whistle is at x = 0 or the field width and y = end.spot", () => {
    const bad = [...obCompletions, ...obRuns].filter((c) => !(Math.abs(c.end.x) < 0.05 || Math.abs(c.end.x - FIELD_WIDTH) < 0.05) || Math.abs(c.end.y - deadY(c.ev)) > 0.05).map((c) => `${c.label}: ends (${c.end.x.toFixed(2)}, ${c.end.y.toFixed(2)})`);
    expect(bad).toEqual([]);
  });
});

describe("2. depth left > lateral left: straight upfield at his x, then one 45-degree cut", () => {
  it("every such out-of-bounds completion follows the upfield-then-cut plan from the catch", () => {
    expect(deep.flatMap(upfieldThenCut)).toEqual([]);
  });

  it("on the upfield piece he is not on the straight line from the catch to the dead spot (the plan is not the old diagonal)", () => {
    // Pins that the test above would fail against a straight line: halfway up the upfield piece
    // the straight line sits well off his x (more than three times the on-line tolerance).
    const wide = deep.filter((c) => Math.abs(c.end.x - c.start.x) >= 4 && Math.abs(c.end.y - c.start.y) - Math.abs(c.end.x - c.start.x) >= 4);
    expect(wide.length).toBeGreaterThanOrEqual(1);
    for (const c of wide) {
      const dir = Math.sign(c.end.y - c.start.y);
      const cutY = c.end.y - dir * Math.abs(c.end.x - c.start.x);
      const midY = (c.start.y + cutY) / 2;
      const p = c.pts.reduce((best, q) => (Math.abs(q.y - midY) < Math.abs(best.y - midY) ? q : best));
      expect(Math.abs(p.x - c.start.x), c.label).toBeLessThan(ON_LINE);
      expect(toSegment(p, c.start, c.end), c.label).toBeGreaterThan(3 * ON_LINE);
    }
  });
});

describe("3. depth left <= lateral left: the straight line to the dead spot", () => {
  it("every such out-of-bounds completion runs straight from the catch to the dead spot", () => {
    expect(shallow.flatMap(straight)).toEqual([]);
  });
});

describe("4. never backward, on the field until the sideline", () => {
  it("out-of-bounds completions, from the catch to the whistle", () => {
    expect(obCompletions.flatMap(forwardAndOnField)).toEqual([]);
  });

  it("out-of-bounds handoff runs, from the handoff to the whistle", () => {
    expect(obRuns.flatMap(forwardAndOnField)).toEqual([]);
  });
});

describe("5. plays that are not out of bounds are unchanged", () => {
  it("every in-bounds completion with a run after the catch is the straight line from the catch to the dead spot", () => {
    const inb = carries((ev) => !isOob(ev) && isCompletion(ev) && (ev.play as { touchdown?: boolean }).touchdown !== true).filter((c) => dist(c.start, c.end) >= 0.5);
    expect(inb.length).toBeGreaterThan(50);
    // Include deep-and-wide ones, where an upfield-then-cut path would show.
    expect(inb.some((c) => Math.abs(c.end.y - c.start.y) > Math.abs(c.end.x - c.start.x) + 4 && Math.abs(c.end.x - c.start.x) >= 4)).toBe(true);
    expect(inb.flatMap(straight)).toEqual([]);
  });
});

describe("6. same input, same plan", () => {
  it("building each out-of-bounds play twice gives identical keys for every mark and the ball", () => {
    for (const c of [...obCompletions, ...obRuns]) {
      const again = build(c.ev);
      expect(again.marks.map((m) => m.keys), c.label).toEqual(c.tl.marks.map((m) => m.keys));
      expect(again.ball, c.label).toEqual(c.tl.ball);
      expect(again.liveEnd, c.label).toBe(c.tl.liveEnd);
    }
  });
});

describe("constructed out-of-bounds completions (fixture shape)", () => {
  // COMPLETE: shotgun vs nickel, LOS 40, receiver H-WR2. Made out of bounds with set air yards.
  const make = (spot: number, airYards: number, passLocation: "left" | "middle" | "right", outOfBounds: boolean): PlayEvent => {
    const p = COMPLETE.play as PlayEvent["play"] & { detail: Record<string, unknown> };
    return {
      ...COMPLETE,
      play: { ...p, ...(outOfBounds ? { outOfBounds: true } : {}), end: { spot, possession: "offense" }, detail: { ...p.detail, yards: spot - 40, airYards, passLocation } } as PlayEvent["play"],
      after: { ...COMPLETE.after, spot },
    };
  };

  it("a catch 8 yards past the line in the left third going out 30 yards past the line: upfield, then the cut", () => {
    const c = carryOf(make(70, 8, "left", true), "constructed left deep");
    expect(c).not.toBeNull();
    if (c === null) return;
    expect(c.start.y).toBeCloseTo(48, 1);
    expect(c.end.x).toBeCloseTo(0, 2);
    expect(c.end.y).toBeCloseTo(70, 2);
    expect(Math.abs(c.end.y - c.start.y)).toBeGreaterThan(Math.abs(c.end.x - c.start.x));
    expect(upfieldThenCut(c)).toEqual([]);
    expect(forwardAndOnField(c)).toEqual([]);
  });

  it("the same play to the right sideline: upfield, then the cut to x = field width", () => {
    const c = carryOf(make(75, 10, "right", true), "constructed right deep");
    expect(c).not.toBeNull();
    if (c === null) return;
    expect(c.end.x).toBeCloseTo(FIELD_WIDTH, 2);
    expect(c.end.y).toBeCloseTo(75, 2);
    expect(upfieldThenCut(c)).toEqual([]);
    expect(forwardAndOnField(c)).toEqual([]);
  });

  it("a catch in the middle third going out 2 yards further on: the straight line", () => {
    const c = carryOf(make(50, 8, "middle", true), "constructed middle shallow");
    expect(c).not.toBeNull();
    if (c === null) return;
    expect(c.end.x === 0 || Math.abs(c.end.x - FIELD_WIDTH) < 0.05 || Math.abs(c.end.x) < 0.05).toBe(true);
    expect(Math.abs(c.end.y - c.start.y)).toBeLessThanOrEqual(Math.abs(c.end.x - c.start.x));
    expect(straight(c)).toEqual([]);
  });

  it("the deep left play without the out-of-bounds flag keeps the straight line", () => {
    const c = carryOf(make(70, 8, "left", false), "constructed left deep in bounds");
    expect(c).not.toBeNull();
    if (c === null) return;
    expect(c.end.y).toBeCloseTo(70, 2);
    expect(straight(c)).toEqual([]);
  });

  it("the constructed play gives the same keys when built twice", () => {
    const ev = make(70, 8, "left", true);
    expect(build(ev).marks.map((m) => m.keys)).toEqual(build(ev).marks.map((m) => m.keys));
  });
});
