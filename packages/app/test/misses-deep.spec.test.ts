// Spec tests for docs/specs/m2-play-calling-and-motion.md, "Amended (Joseph, 2026-11-15): misses
// that read as misses, deep catches that read deep", criteria R-C16 to R-C23 (and the R-C7 and
// R-C9 amendments they name), written by test-writer from the spec, not the code.
//
// The 1,000-game sweeps (R-C16, R-C17, R-C21, R-C22 and the R-C24 report) are in
// test/game/routes-pace.heavy.test.ts. Here: the same rules over built plays and a few simulated
// games, the forced-miss hook (R-C20) and the template geometry (R-C23).
//
// Readings of the spec, where it needed one:
// - "top" is the mark's own top (natural-motion revision: "Every top ... becomes the mark's own
//   top"), read from his natural-motion record, or his group speed in motion.json without one.
// - R-C16's miss bound is the one the spec prints, 2.5 yd at current values: the smallest of
//   overYards, behindYards and shortYards, less reachYards.
// - "Non-rushing" (A3) is read from the calls: a defender with a zone or a man target in his
//   preset is in coverage; one with neither is rushing.
// - R-C19 is checked on unclamped plays only: a clamped play is scaled in time (States, "Live time
//   clamped ... as today"), so its track is not his template track on the template's clock.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlayResult } from "@clipboard-football/shared";
import { readDetail, type PlayEvent } from "../src/engine/types";
import type { Pt } from "../src/ui/motion";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { at, FIELD_WIDTH, MID_X, scaleAt, timeline, type Key, type MissKind, type Timeline, type TimelineCtx } from "../src/ui/timeline";
import { snap } from "./fixtures";
import { playGame } from "./support";

const root = join(import.meta.dirname, "../../..");
const read = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));
const templatesRaw = read("data/ui/templates.json") as Record<string, unknown>;
const templates = parseTemplates(templatesRaw);
const motionRaw = read("data/ui/motion.json") as Record<string, unknown>;
const motion = parseMotion(motionRaw);
const personnel = read("data/engine/personnel.json") as {
  offense: Record<string, Record<string, number>>;
  packages: Record<string, Record<string, number>>;
  presetPackage: Record<string, string>;
};
const ctx: TimelineCtx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion };
const tlOf = (event: PlayEvent, c: TimelineCtx = ctx): Timeline => timeline({ event, runoffSeconds: 0 }, templates, c);

const FORMATIONS = ["shotgun", "underCenter", "pistol", "empty", "heavy"] as const;
const KEY = motion.keyMs;
const MISS = motion.miss;
const KINDS: readonly MissKind[] = ["breakup", "overthrow", "behind", "short"];
const FLOOR = (templatesRaw["catchFloorYards"] as Record<string, number>)["deepPass"] as number;

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const posOf = (s: string): string => s.replace(/\d+$/, "");
const unclamped = (tl: Timeline): boolean => tl.liveEnd - tl.snapAt > motion.live.minMs + 1e-6 && tl.liveEnd - tl.snapAt < motion.live.maxMs - 1e-6;
const topOf = (m: Timeline["marks"][number]): number => m.nat?.top ?? motion.speed[m.position] ?? 10;
const say = (p: Pt, los: number): string => `(${(p.x - MID_X).toFixed(2)}, ${(p.y - los).toFixed(2)})`;

// ---------------------------------------------------------------- events shaped like the engine's

const ids = (prefix: string, counts: Record<string, number>): Record<string, string[]> => Object.fromEntries(Object.entries(counts).map(([pos, n]) => [pos, Array.from({ length: n }, (_, i) => `${prefix}-${pos}${i + 1}`)]));
interface EvSpec {
  readonly formation: string;
  readonly call: string;
  readonly preset: string;
  readonly result: "complete" | "incomplete";
  readonly gain?: number;
  readonly spot?: number;
  readonly parts?: Record<string, string>;
  readonly airYards?: number;
}
function mk(e: EvSpec): PlayEvent {
  const los = e.spot ?? 35;
  const gain = e.gain ?? 0;
  const onField = { offense: ids("O", personnel.offense[e.formation] as Record<string, number>), defense: ids("X", personnel.packages[personnel.presetPackage[e.preset] as string] as Record<string, number>) };
  const detail: Record<string, unknown> = { participants: e.parts ?? {}, onField, headline: "h", yards: gain };
  if (e.airYards !== undefined) detail["airYards"] = e.airYards;
  const play = (e.result === "complete" ? { kind: "pass", seconds: 6, end: { spot: los + gain, possession: "offense" }, detail } : { kind: "pass", seconds: 5, incomplete: true, end: { spot: los, possession: "offense" }, detail }) as PlayResult;
  return { t: "play", before: snap({ spot: los, down: 1, distance: 10 }), offense: { call: e.call, formation: e.formation } as PlayEvent["offense"], defense: e.preset, play, penalty: null, runoffTimeout: false, after: snap({ spot: los + gain, down: 1, distance: 10 }) };
}
const markOf = (tl: Timeline, id: string): Timeline["marks"][number] => {
  const m = tl.marks.find((x) => x.playerId === id);
  if (m === undefined) throw new Error(`no mark ${id}`);
  return m;
};
const flightOf = (tl: Timeline): Timeline["paths"][number] | undefined => tl.paths.find((p) => p.kind === "ball");

/**
 * His template track: the same event with him unnamed, a completion thrown behind the QB (air yards
 * -60, so the ball in flight pushes nobody) on a 6 s flight with no live cap, so every receiver runs
 * his template and finish well past any throw window. On the raw clock (k = 1).
 *
 * The reference's ball stays in the QB's hands at least as long as the miss's does. On the miss the
 * QB holds it to the miss's throw (R8 times it for the target), and an unnamed receiver on that play
 * is kept off the held ball by the offense's 1.5 yd ring (contract 3) until then. A reference with
 * no receiver is thrown at the drop end + hitchMs, so from that early throw on a back near the QB is
 * no longer ringed off a held ball (and is steered off the ball in flight instead): measured on
 * underCenter intermediatePass to RB1, the reference throws at 1030 ms, the miss at 2143 ms, the two
 * tracks are identical to 1000 ms and 0.50 yd apart at 1050 ms, 1.36 yd at 1150 ms, with the miss
 * target exactly 1.50 yd from the held ball. That gap is the reference's, not the miss's. So the
 * reference's receiver is a lineman (never a miss target here) with the catch 60 yd behind the
 * line, far off his track (at his 5 yd/s it is more than the hold plus the flight away), which R8
 * caps at the latest throw, drop end + the hold, never earlier than the miss's throw. The QB's
 * pocket creep does not depend on the throw time (timeline.ts settleLeg), so the ball he holds is the
 * same on both up to the miss's throw.
 */
const longCtx: TimelineCtx = { ...ctx, motion: { ...motion, flight: { ...motion.flight, minMs: 6000, maxMs: 6000 }, live: { ...motion.live, maxMs: 1e6 } } };
function templateOf(ev: PlayEvent): Timeline {
  const d = readDetail(ev.play);
  const passer = d.participants?.passer;
  const late = d.onField?.offense.find((x) => x.position === "OL")?.id;
  if (late === undefined) throw new Error("no lineman to receive the reference throw");
  const detail = { ...(ev.play.detail as Record<string, unknown>), participants: { ...(passer === undefined ? {} : { passer }), receiver: late }, airYards: -60, yards: 5 };
  const play = { kind: "pass", seconds: 6, end: { spot: ev.before.spot + 5, possession: "offense" }, detail } as PlayResult;
  return tlOf({ ...ev, play }, longCtx);
}

/** The drawn miss of an incompletion with a known offensive target, and what R-C16 to R-C19 read. */
interface Miss {
  readonly ev: PlayEvent;
  readonly tl: Timeline;
  readonly target: Timeline["marks"][number];
  readonly kind: MissKind;
  readonly P: Pt;
  readonly throwT: number;
  readonly catchT: number;
}
function missOf(ev: PlayEvent, c: TimelineCtx = ctx): Miss | null {
  if (ev.play.kind !== "pass" || ev.play.incomplete !== true) return null;
  const id = readDetail(ev.play).participants?.target;
  const tl = tlOf(ev, c);
  const target = tl.marks.find((m) => m.playerId === id && m.side === "O");
  const fl = flightOf(tl);
  if (target === undefined || fl === undefined) return null;
  const m = tl.miss;
  if (m === undefined) throw new Error(`incompletion to a known target with no tl.miss: ${ev.offense.call}`);
  if (m.kind === null) throw new Error(`incompletion to a known target drawn with no miss kind: ${ev.offense.call}`);
  return { ev, tl, target, kind: m.kind, P: m.at, throwT: fl.start, catchT: fl.end };
}

/**
 * A3: a non-rushing defender is not blitzing in his preset: he has a zone or a man target, or his
 * drop steps (slot, then position, in the preset's drop set) end deeper than his set spot.
 */
function inCoverage(preset: string, slot: string): boolean {
  if (templates.zones[preset]?.[slot] !== undefined || templates.manTargets[preset]?.[slot] !== undefined) return true;
  const drops = (templatesRaw["drops"] as Record<string, Record<string, unknown>>)[templates.presetDrops[preset] ?? ""];
  const steps = (drops?.[slot] ?? drops?.[posOf(slot)]) as unknown[] | undefined;
  const last = steps?.at(-1);
  if (last === undefined) return false;
  const p = (Array.isArray(last) ? last : (last as { p: number[] }).p) as number[];
  return (p[1] ?? 0) > 0;
}

const peakOver = (keys: readonly Key[], t0: number, t1: number): number => {
  let peak = 0;
  for (let t = t0; t + KEY <= t1 + 1e-9; t += KEY) peak = Math.max(peak, (dist(at(keys, t), at(keys, t + KEY)) / KEY) * 1000);
  return peak;
};

// ---------------------------------------------------------------- the sample

/** Eight simulated games, every incompletion with a known offensive target in them. */
const games: PlayEvent[] = [41, 42, 43, 44, 45, 46, 47, 48].flatMap((seed) => playGame(seed, seed % 2 === 0 ? "home" : "away", seed).events.filter((e): e is PlayEvent => e.t === "play"));
const sampleMisses: Miss[] = games.map((e) => missOf(e)).filter((m): m is Miss => m !== null);

/** Built incompletions over every formation and pass class, to WRs, TEs and backs, three looks. */
const built: Miss[] = [];
for (const f of FORMATIONS)
  for (const call of ["shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"])
    for (const preset of ["nickelCover3", "nickel2Man", "baseCover2"])
      for (const target of ["O-WR1", "O-WR2", "O-TE1", "O-RB1"]) {
        const counts = personnel.offense[f] as Record<string, number>;
        if ((counts[posOf(target.slice(2))] ?? 0) === 0) continue;
        const m = missOf(mk({ formation: f, call, preset, result: "incomplete", parts: { passer: "O-QB1", target } }));
        if (m !== null) built.push(m);
      }
const allMisses = [...sampleMisses, ...built];
const label = (m: Miss): string => `${m.ev.offense.formation ?? ""} ${m.ev.offense.call} vs ${m.ev.defense} to ${m.target.slot} (${m.kind})`;

describe("the sample", () => {
  it("has incompletions with a known target, and every kind of miss shows up", () => {
    expect(sampleMisses.length).toBeGreaterThan(40);
    const kinds = new Set(allMisses.map((m) => m.kind));
    // Geometry picks the kind (A3); over this many plays the spec's four kinds should all occur.
    expect([...kinds].sort()).toEqual([...KINDS].sort());
  });
});

// ================================================================ R-C16

describe("R-C16: the ball at the arrival is off the target", () => {
  const missNeed = Math.min(MISS.overYards, MISS.behindYards, MISS.shortYards) - MISS.reachYards;
  const breakNeed = MISS.breakup.gapYards - MISS.reachYards;

  it("the bounds are the spec's at current values (2.5 yd on a miss, 1.0 yd on a break-up)", () => {
    expect(missNeed).toBeCloseTo(2.5, 9);
    expect(breakNeed).toBeCloseTo(1.0, 9);
  });

  it("on every incompletion with a known target (simulated and built), the gap is at least the miss or break-up bound", () => {
    const bad: string[] = [];
    for (const m of allMisses) {
      const gap = dist(at(m.tl.ball, m.catchT), at(m.target.keys, m.catchT));
      const need = m.kind === "breakup" ? breakNeed : missNeed;
      if (gap < need - 1e-6) bad.push(`${label(m)}: ${gap.toFixed(2)} yd, need ${need}`);
    }
    expect(bad).toEqual([]);
  });

  it("the ball at the arrival is the drawn miss point P", () => {
    const bad = allMisses.filter((m) => dist(at(m.tl.ball, m.catchT), m.P) > 1e-6).map(label);
    expect(bad).toEqual([]);
  });

  it("an unknown target: the ball is aimed at the fixed point, nobody reaches and there is no breaker", () => {
    // States: "Target unknown or not offense. Aim at today's fixed point. The ball lands and rolls."
    const tl = tlOf(mk({ formation: "shotgun", call: "deepPass", preset: "nickelCover3", result: "incomplete", parts: { passer: "O-QB1" } }));
    const fl = flightOf(tl);
    expect(fl).toBeDefined();
    expect(tl.miss?.breaker ?? null).toBeNull();
    expect(tl.miss?.kind ?? null).toBeNull();
    const P = (fl as { points: readonly Pt[] }).points.at(-1) as Pt;
    expect(P.y - tl.los).toBeCloseTo(templates.passDepth["deepPass"] as number, 6);
  });
});

// ================================================================ R-C17

describe("R-C17: break-ups have a breaker at the ball; other misses have nobody near", () => {
  it("every break-up: the breaker is a non-rushing CB, S or LB, within handYards + 0.2 of the ball and nearer than the target, at no more than 1.15 x top", () => {
    const bad: string[] = [];
    let n = 0;
    for (const m of allMisses.filter((x) => x.kind === "breakup")) {
      n++;
      const id = m.tl.miss?.breaker ?? null;
      if (id === null) {
        bad.push(`${label(m)}: no breaker`);
        continue;
      }
      const b = markOf(m.tl, id);
      const ball = at(m.tl.ball, m.catchT);
      const dB = dist(at(b.keys, m.catchT), ball);
      const dT = dist(at(m.target.keys, m.catchT), ball);
      if (b.side !== "X" || !["CB", "S", "LB"].includes(b.position)) bad.push(`${label(m)}: breaker ${b.slot} is not a CB, S or LB`);
      if (!inCoverage(m.ev.defense ?? "", b.slot)) bad.push(`${label(m)}: breaker ${b.slot} rushes in ${m.ev.defense}`);
      if (dB > MISS.breakup.handYards + 0.2 + 1e-9) bad.push(`${label(m)}: breaker ${dB.toFixed(2)} yd from the ball`);
      if (!(dB < dT)) bad.push(`${label(m)}: breaker ${dB.toFixed(2)} yd, target ${dT.toFixed(2)} yd`);
      const peak = peakOver(b.keys, m.tl.snapAt, m.catchT);
      if (peak > 1.15 * topOf(b) + 1e-9) bad.push(`${label(m)}: breaker peaks at ${peak.toFixed(2)} yd/s`);
    }
    expect(n).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });

  it("every other miss: no defender within clearYards of P at the arrival, and no breaker is named", () => {
    const bad: string[] = [];
    let n = 0;
    for (const m of allMisses.filter((x) => x.kind !== "breakup")) {
      n++;
      if ((m.tl.miss?.breaker ?? null) !== null) bad.push(`${label(m)}: a breaker on a ${m.kind}`);
      for (const d of m.tl.marks.filter((x) => x.side === "X")) {
        const g = dist(at(d.keys, m.catchT), m.P);
        if (g < MISS.clearYards) bad.push(`${label(m)}: ${d.slot} ${g.toFixed(2)} yd from P`);
      }
    }
    expect(n).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });

  // A3: the breaker is "unnamed, since no defender is named on an incompletion", and A4: "No text,
  // box score or card credits the breaker". A defender the event names (a fouler, say) shows his
  // number, so he can't be the drawn breaker.
  it("the breaker is a defender the event doesn't name: not among the involved, no ring", () => {
    const bad: string[] = [];
    for (const m of allMisses.filter((x) => x.kind === "breakup")) {
      const id = m.tl.miss?.breaker as string;
      if (m.tl.involved.includes(id)) bad.push(`${label(m)}: breaker is involved`);
      if (m.tl.rings.includes(id)) bad.push(`${label(m)}: breaker has a ring`);
    }
    expect(bad).toEqual([]);
  });
});

// ================================================================ R-C18

describe("R-C18: no implied catch", () => {
  /** A mark holds the ball when the ball stays within 0.5 yd of him for 150 ms or more. */
  function holder(tl: Timeline, t0: number, t1: number): string | null {
    for (const mk2 of tl.marks) {
      let run = 0;
      for (let t = t0; t <= t1; t += KEY) {
        run = dist(at(mk2.keys, t), at(tl.ball, t)) < 0.5 ? run + KEY : 0;
        if (run >= 150) return `${mk2.slot} at ${(t - tl.snapAt).toFixed(0)} ms`;
      }
    }
    return null;
  }

  it("from the throw to the whistle no mark holds the ball, and the timeline names no holder", () => {
    const bad: string[] = [];
    for (const m of allMisses) {
      if (m.tl.holder !== null) bad.push(`${label(m)}: holder ${m.tl.holder}`);
      // Up to the whistle, before the ball jumps to the spot.
      const h = holder(m.tl, m.throwT + 4 * KEY, m.tl.liveEnd - KEY);
      if (h !== null) bad.push(`${label(m)}: held by ${h}`);
    }
    expect(bad).toEqual([]);
  });

  it("the flight ends at P with endScale at most 0.6", () => {
    const bad: string[] = [];
    for (const m of allMisses) {
      const end = (flightOf(m.tl) as { points: readonly Pt[] }).points.at(-1) as Pt;
      if (dist(end, m.P) > 1e-6) bad.push(`${label(m)}: flight ends at ${say(end, m.tl.los)}, P ${say(m.P, m.tl.los)}`);
      const s = scaleAt(m.tl.ballScale, m.catchT);
      if (s > 0.6 + 1e-9) bad.push(`${label(m)}: scale ${s.toFixed(2)} at the arrival`);
    }
    expect(bad).toEqual([]);
  });

  it("'Incomplete' sits at the ball's final point, 300 ms after the arrival (A4)", () => {
    const bad: string[] = [];
    for (const m of allMisses) {
      const l = m.tl.labels.find((x) => x.text.includes("Incomplete"));
      if (l === undefined) {
        bad.push(`${label(m)}: no Incomplete label`);
        continue;
      }
      // On a clamped play every phase is scaled alike (States), so the 300 ms is checked unclamped.
      if (unclamped(m.tl) && Math.abs(l.t - (m.catchT + 300)) > 1) bad.push(`${label(m)}: label at ${(l.t - m.catchT).toFixed(0)} ms after the arrival`);
      // The ball's final point: where it rests before the jump to the spot (which may come at the
      // label's own time, when the whistle is the label time).
      const final = lastBefore(m.tl.ball, l.t);
      if (dist(l.at, final) > 1e-6) bad.push(`${label(m)}: label at ${say(l.at, m.tl.los)}, ball at ${say(final, m.tl.los)}`);
      // The ball rests there until the whistle (then jumps to the spot).
      for (let t = l.t; t < m.tl.liveEnd - KEY; t += KEY)
        if (dist(at(m.tl.ball, t), final) > 1e-6) {
          bad.push(`${label(m)}: the ball moves after its final point`);
          break;
        }
    }
    expect(bad).toEqual([]);
  });

  /** The ball's point just before t: its last key earlier than t, or at t if none jumps there. */
  function lastBefore(keys: readonly Key[], t: number): Pt {
    const jumpAt = keys.findIndex((k, i) => i > 0 && Math.abs(k.t - t) < 1e-6 && dist(k, keys[i - 1] as Key) > 1);
    return jumpAt > 0 ? (keys[jumpAt - 1] as Key) : at(keys, t);
  }

  it("A4: after P a break-up deflects deflectYards, any other miss rolls rollYards on along its flight", () => {
    const bad: string[] = [];
    for (const m of allMisses) {
      const final = (m.tl.labels.find((x) => x.text.includes("Incomplete")) as { at: Pt }).at;
      const want = m.kind === "breakup" ? MISS.breakup.deflectYards : MISS.rollYards;
      const got = dist(final, m.P);
      // Off the field the ball is clamped outYards past the line (A3), which can shorten it.
      const out = final.x <= -MISS.outYards + 1e-6 || final.x >= FIELD_WIDTH + MISS.outYards - 1e-6 || final.y >= 110 + MISS.outYards - 1e-6;
      if (!out && Math.abs(got - want) > 1e-6) bad.push(`${label(m)}: ${got.toFixed(2)} yd after P, want ${want}`);
      if (m.kind !== "breakup" && !out) {
        const fl = flightOf(m.tl) as { points: readonly Pt[] };
        const from = fl.points[0] as Pt;
        const cos = ((m.P.x - from.x) * (final.x - m.P.x) + (m.P.y - from.y) * (final.y - m.P.y)) / (dist(from, m.P) * got);
        if (cos < 1 - 1e-6) bad.push(`${label(m)}: the roll leaves the line of flight`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ================================================================ R-C19

describe("R-C19 (amends R-C7 for incompletions): the target stays on his template track", () => {
  it("within 0.1 yd of his template track at every t to the whistle, and within reachYards + 0.1 in the reach window", () => {
    const bad: string[] = [];
    let n = 0;
    for (const m of allMisses.filter((x) => unclamped(x.tl))) {
      const ref = templateOf(m.ev);
      if (ref.snapAt !== m.tl.snapAt) {
        bad.push(`${label(m)}: the snaps differ`);
        continue;
      }
      // The reference holds the ball at least as long as the miss does (see templateOf).
      const refThrow = (flightOf(ref) as { start: number }).start;
      if (refThrow < m.throwT - 1e-6) {
        bad.push(`${label(m)}: the reference throws at ${(refThrow - ref.snapAt).toFixed(0)} ms, before the miss's ${(m.throwT - m.tl.snapAt).toFixed(0)} ms`);
        continue;
      }
      n++;
      const tpl = markOf(ref, m.target.playerId);
      for (let t = m.tl.snapAt; t <= m.tl.liveEnd; t += KEY) {
        const inReach = t >= m.catchT - MISS.reachMs - 1e-9 && t <= m.catchT + MISS.reachMs + 1e-9;
        const bound = inReach ? MISS.reachYards + 0.1 : 0.1;
        const d = dist(at(m.target.keys, t), at(tpl.keys, t));
        if (d > bound) {
          bad.push(`${label(m)}: ${d.toFixed(2)} yd off at ${(t - m.tl.snapAt).toFixed(0)} ms (throw ${(m.throwT - m.tl.snapAt).toFixed(0)}, arrival ${(m.catchT - m.tl.snapAt).toFixed(0)})`);
          break;
        }
      }
    }
    expect(n).toBeGreaterThan(50);
    expect(bad).toEqual([]);
  });
});

// ================================================================ R-C20

describe("R-C20 (extends R-C9): the miss can't leak before the throw", () => {
  const cases: EvSpec[] = [
    { formation: "shotgun", call: "deepPass", preset: "nickelCover3", result: "incomplete", parts: { passer: "O-QB1", target: "O-WR1" } },
    { formation: "pistol", call: "intermediatePass", preset: "nickelCover1", result: "incomplete", parts: { passer: "O-QB1", target: "O-TE1" } },
    { formation: "empty", call: "shortPass", preset: "nickel2Man", result: "incomplete", parts: { passer: "O-QB1", target: "O-WR3" } },
    { formation: "underCenter", call: "playAction", preset: "baseCover2", result: "incomplete", parts: { passer: "O-QB1", target: "O-WR2" } },
    { formation: "heavy", call: "deepPass", preset: "baseCover3", result: "incomplete", parts: { passer: "O-QB1", target: "O-RB1" } },
    { formation: "shotgun", call: "screenPass", preset: "dimeCover4", result: "incomplete", parts: { passer: "O-QB1", target: "O-RB1" } },
  ];
  for (const e of cases)
    it(`${e.formation} ${e.call} vs ${e.preset} to ${e.parts?.["target"] ?? ""}: each forced kind draws identical frames, all 22 marks and the ball, up to the throw`, () => {
      const ev = mk(e);
      const tls = KINDS.map((k) => tlOf(ev, { ...ctx, forceMiss: k }));
      // The hook does what it says: each kind is drawn.
      expect(tls.map((t) => t.miss?.kind)).toEqual([...KINDS]);
      const a = tls[0] as Timeline;
      expect(a.marks.length).toBe(22);
      const throwT = (flightOf(a) as { start: number }).start;
      const diffs: string[] = [];
      for (const b of tls.slice(1)) {
        expect(b.snapAt).toBe(a.snapAt);
        expect((flightOf(b) as { start: number }).start).toBe(throwT);
        for (let t = 0; t <= throwT; t += 5) {
          for (const m of a.marks) {
            const d = dist(at(m.keys, t), at(markOf(b, m.playerId).keys, t));
            if (d > 1e-9) {
              diffs.push(`${b.miss?.kind ?? ""}: ${m.slot} ${d.toFixed(4)} yd at ${(t - a.snapAt).toFixed(0)} ms`);
              break;
            }
          }
          const db = dist(at(a.ball, t), at(b.ball, t));
          if (db > 1e-9) diffs.push(`${b.miss?.kind ?? ""}: ball ${db.toFixed(4)} yd at ${(t - a.snapAt).toFixed(0)} ms`);
          if (Math.abs(scaleAt(a.ballScale, t) - scaleAt(b.ballScale, t)) > 1e-9) diffs.push(`${b.miss?.kind ?? ""}: ball scale at ${(t - a.snapAt).toFixed(0)} ms`);
          if (diffs.length > 0) break;
        }
      }
      expect(diffs).toEqual([]);
    });

  it("the forced kinds differ after the throw (the hook is load-bearing, so the check above can fail)", () => {
    const ev = mk(cases[0] as EvSpec);
    const Ps = KINDS.map((k) => tlOf(ev, { ...ctx, forceMiss: k }).miss?.at as Pt);
    for (let i = 0; i < Ps.length; i++) for (let j = i + 1; j < Ps.length; j++) expect(dist(Ps[i] as Pt, Ps[j] as Pt), `${KINDS[i] ?? ""} vs ${KINDS[j] ?? ""}`).toBeGreaterThan(0.5);
  });

  it("the same event drawn twice gives an identical timeline (simulated incompletions and the built set)", () => {
    for (const m of allMisses.slice(0, 80)) expect(tlOf(m.ev), label(m)).toEqual(m.tl);
  });
});

// ================================================================ R-C21

describe("R-C21: deep completions are caught deep", () => {
  const catchY = (tl: Timeline): number => ((flightOf(tl) as { points: readonly Pt[] }).points.at(-1) as Pt).y;

  for (const f of FORMATIONS)
    for (const target of ["O-WR1", "O-WR2", "O-TE1", "O-RB1"])
      for (const gain of [8, 17, 24, 41]) {
        const counts = personnel.offense[f] as Record<string, number>;
        if ((counts[posOf(target.slice(2))] ?? 0) === 0) continue;
        it(`${f} deepPass to ${target}, gain ${gain}: caught at least min(${FLOOR}, gain) past the line, no further than the dead spot`, () => {
          const los = 35;
          const tl = tlOf(mk({ formation: f, call: "deepPass", preset: "nickelCover3", result: "complete", gain, spot: los, parts: { passer: "O-QB1", target, receiver: target, tackler: "X-S1" } }));
          const y = catchY(tl) - los;
          expect(y).toBeGreaterThanOrEqual(Math.min(FLOOR, gain) - 1e-6);
          expect(y).toBeLessThanOrEqual(gain + 1e-6);
          // He is there to catch it.
          expect(dist(at(markOf(tl, target).keys, (flightOf(tl) as { end: number }).end), (flightOf(tl) as { points: readonly Pt[] }).points.at(-1) as Pt)).toBeLessThan(1);
        });
      }

  it("the floor is load-bearing data: catchFloorYards.deepPass is 20, and a gain under it is caught at the dead spot", () => {
    expect(FLOOR).toBe(20);
    const tl = tlOf(mk({ formation: "heavy", call: "deepPass", preset: "baseCover3", result: "complete", gain: 12, parts: { passer: "O-QB1", target: "O-RB1", receiver: "O-RB1", tackler: "X-S1" } }));
    expect(catchY(tl) - 35).toBeCloseTo(12, 6);
  });

  it("with airYards the floor does not apply: the catch stays at the air yards", () => {
    const tl = tlOf(mk({ formation: "shotgun", call: "deepPass", preset: "nickelCover3", result: "complete", gain: 30, airYards: 9, parts: { passer: "O-QB1", target: "O-RB1", receiver: "O-RB1", tackler: "X-S1" } }));
    expect(catchY(tl) - 35).toBeCloseTo(9, 6);
  });

  it("no floor on intermediatePass or playAction (B1 rejected it): a back's check-down stays short", () => {
    expect(Object.keys(templatesRaw["catchFloorYards"] as object)).toEqual(["deepPass"]);
  });

  it("every deepPass completion with no airYards in the simulated games is caught within the floor and the dead spot", () => {
    const bad: string[] = [];
    let n = 0;
    for (const ev of games) {
      if (ev.offense.call !== "deepPass" || ev.play.kind !== "pass" || ev.play.incomplete === true || ev.play.turnover !== undefined) continue;
      const d = readDetail(ev.play);
      if (d.airYards !== undefined) continue;
      const tl = tlOf(ev);
      if (flightOf(tl) === undefined) continue;
      n++;
      const gain = ev.play.end.spot - ev.before.spot;
      const y = catchY(tl) - tl.los;
      // On a loss the catch is in the band between the line and the dead spot (DECISIONS, "Neutral catch depth").
      if (y < Math.min(FLOOR, gain) - 1e-6 || y > Math.max(0, gain) + 1e-6) bad.push(`${ev.offense.formation ?? ""} to ${d.participants?.receiver ?? "?"}: caught ${y.toFixed(2)} yd past the line, gain ${gain}`);
    }
    expect(n).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  });
});

// ================================================================ R-C23

describe("R-C23: every deepPass route can get 20 yd deep in a throw window", () => {
  // The R8 window: a throw between the drop end + hitchMs and the drop end + the hold, caught
  // a flight later. A track point counts when a throw in that window, flying to it, arrives as he does.
  // The hold is deepPass's own when it has one: the spec amendment ("Amended (Joseph, 2026-11-15)",
  // Open item 2, approved by Joseph 2026-11-15) gives deepPass a longer hold, throwHold.leafMaxMs,
  // and R8 times the throw with it (timeline.ts reads leafMaxMs[leaf] ?? maxMs the same way).
  const holdMs = motion.throwHold.leafMaxMs["deepPass"] ?? motion.throwHold.maxMs;
  for (const f of FORMATIONS)
    it(`${f}, line at midfield: every WR, TE and RB track reaches 20 yd past the line at a timeable point`, () => {
      const los = 50;
      const tl = tlOf(mk({ formation: f, call: "deepPass", preset: "nickelCover3", result: "complete", gain: 5, spot: los, airYards: -30, parts: { passer: "O-QB1" } }), longCtx);
      const drop = tl.snapAt + (motion.dropMs["deepPass"] as number);
      const qb = markOf(tl, "O-QB1");
      const throwMin = drop + motion.hitchMs;
      const throwMax = drop + holdMs;
      const bad: string[] = [];
      for (const m of tl.marks.filter((x) => x.side === "O" && ["WR", "TE", "RB"].includes(x.position))) {
        let ok = false;
        let deepest = -Infinity;
        for (let t = throwMin; t <= throwMax + motion.flight.maxMs && !ok; t += KEY) {
          const q = at(m.keys, t);
          const dropPt = at(qb.keys, drop);
          const fl = Math.max(motion.flight.minMs, Math.min(motion.flight.maxMs, motion.flight.baseMs + motion.flight.perYardMs * dist(dropPt, q)));
          const thr = t - fl;
          if (thr < throwMin - 1e-9 || thr > throwMax + 1e-9) continue;
          deepest = Math.max(deepest, q.y - los);
          if (q.y - los >= 20 - 1e-9) ok = true;
        }
        if (!ok) bad.push(`${m.slot}: deepest timeable point ${deepest.toFixed(1)} yd`);
      }
      expect(bad).toEqual([]);
    });
});
