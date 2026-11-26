// Player reactions, the "all slices" criteria (docs/specs/m2-player-reactions.md): PR-C8 (no leak),
// PR-C9 (outcomes and anchors), PR-C10 (everything standing still stands with ratings) and PR-C15
// (the schema), written by test-writer from the spec, not the code. Headless, on the Timeline from
// timeline() at 1x, on the spec's Fixtures (the fixed rating table) and Sample S (the app's ratings).
//
// The bar for the standing checks (the spec, "Standing checks: the pre-build baseline", the lead's
// ruling of 2026-11-23): several checks from earlier specs were red before this build, with the
// ratings bands that already existed or with no ratings at all. So PR-C10 holds them to no
// regression, not to green. On Sample S with the app's ratings each check fails on no more plays
// than it did on the tree the build started from, and every (check, fixture) pair that passed there
// still passes. The counts are constants below, measured by these same functions on a copy of that
// tree (timeline.ts sha256 f8474557..., git 59e1f6f plus the work recorded in pr-baseline.json).
//
// PR-C9 is two comparisons. (a) Engine facts, with ratings against none. (b) What the old bands
// already moved (a catch's lateral place, the handoff's screen time) is compared A/B instead: the
// shipped build against the same build with every band pair of ratings.scrimmage at [0, 0].
// Brought to the criterion's exceptions 2026-11-24 for slice 2 (the lead's ruling). Every run, sneak,
// sack and scramble keeps every equality. On a pass (exception 2) his own break pace may move the
// throw by R8, and with it the catch, the whistle and the dead spot's x: the throw is held to R8's
// window, the engine facts and the fact-mark set to equality, and the size of the moves is printed,
// not held, because the spec sets no distance. On an incompletion a mark with no slice 2 effect of
// his own (the same breakPaceShare, manLagMs, cushionYards, stalkLagMs and biteShare in both builds, and
// not a defender sinking in a zone while a receiver's track moved, R9) is identical up to the earlier of the two throws, on plays of one clock. The rest are printed.
//
// PR-C8's R-C7 is held for its leak clause (the target is on his template track to the throw) and
// the catch (he is at the catch point at catch time). Its two other clauses, the DECISIONS.md catch
// point and R8's throw time, stay in routes-pace.spec.test.ts with no ratings: they need that
// file's neutral-catch arithmetic, which is not exported.
//
// PR-C15's last clause (the build's own diff touches nothing under packages/sim, packages/shared or
// data/engine) is checked by the lead on the engineer's list of changed files, not here: this
// checkout holds other sessions' uncommitted sim work, so git status can't tell whose it is.

import { describe, expect, it } from "vitest";
import type { PlayEvent } from "../src/engine/types";
import { MotionError, parseMotion } from "../src/ui/templates";
import { at, scaleAt, type Key, type MissKind, type Timeline } from "../src/ui/timeline";
import { COMPLETE, INCOMPLETE, RUN, SACK } from "./fixtures";
import { atTheBall, build, dist, FIXTURES, firstDiff, flightOf, frozenBeforeRead, isLive, KEY, longMotion, m5, m7, markOf, mk, motion, motionRaw, n1, n3, n4, n5Engaged, n5Moving, n6Anchors, n6Settle, natOf, peakCheck, rc19Rated, reactOf, ring, S, SCRIMMAGE_KINDS, specRead, tableRatings, templates, throwWindow, unclamped, zeroedScrimmage, type Built, type EvSpec, type Ratings, type Sample } from "./player-reactions.checks";

const rated = (ev: PlayEvent, extra: Parameters<typeof build>[3] = {}, human: Parameters<typeof build>[4] = null): Timeline => build(ev, tableRatings(ev), motion, extra, human);
const KINDS: readonly MissKind[] = ["breakup", "overthrow", "behind", "short"];
/** One assertion over several clauses: every clause's failures are shown together, so none hides another. */
const expectNone = (clauses: Readonly<Record<string, readonly string[]>>): void => {
  expect(Object.fromEntries(Object.entries(clauses).filter(([, lines]) => lines.length > 0))).toEqual({});
};

// ================================================================ PR-C8: no leak

describe("PR-C8: no leak with ratings on (R-C9, R-C7, R-C19, R-C20, P3, N7)", () => {
  /** Defender positions from the snap to the earlier read, every 5 ms; the first difference. */
  function leak(a: Timeline, b: Timeline): string | null {
    const t1 = Math.min(specRead(a), specRead(b));
    for (const m of a.marks.filter((x) => x.side === "X")) {
      const d = firstDiff(m.keys, markOf(b, m.playerId).keys, a.snapAt, t1);
      if (d !== null) return `${m.slot} differs by ${d.d.toFixed(4)} yd at ${(d.t - a.snapAt).toFixed(0)} ms`;
    }
    return null;
  }
  const pass = (result: EvSpec["result"], gain: number, parts: Record<string, string>, f = "shotgun", call = "shortPass", preset = "nickelCover3"): PlayEvent => mk({ formation: f, call, preset, result, gain, parts: { passer: "O-QB1", ...parts } });

  for (const [f, call, preset] of [
    ["shotgun", "shortPass", "nickelCover3"],
    ["shotgun", "deepPass", "nickel2Man"],
    ["pistol", "intermediatePass", "nickelCover1"],
    ["empty", "playAction", "dimeCover4"],
    ["underCenter", "screenPass", "baseCover2"],
  ] as const)
    it(`R-C9, ${f} ${call} vs ${preset}: different targets, catch points and results draw the same rated defense to the read`, () => {
      const tls = [
        rated(pass("complete", 18, { target: "O-WR1", receiver: "O-WR1", tackler: "X-CB1" }, f, call, preset)),
        rated(pass("incomplete", 0, { target: "O-TE1" }, f, call, preset)),
        rated(pass("complete", 9, { target: "O-WR2", receiver: "O-WR2", tackler: "X-LB1" }, f, call, preset)),
        rated(pass("complete", 26, { target: "O-TE1", receiver: "O-TE1", tackler: "X-S2" }, f, call, preset)),
      ].filter(unclamped);
      expect(tls.length).toBeGreaterThanOrEqual(2);
      for (const t of tls.slice(1)) expect(leak(tls[0] as Timeline, t)).toBeNull();
    });

  it("R-C9, runs to the same side: different gains and tacklers draw the same rated defense to the handoff", () => {
    for (const f of ["shotgun", "pistol", "heavy"])
      for (const call of ["insideRun", "outsideRun"]) {
        const a = rated(mk({ formation: f, call, preset: "baseCover3", result: "run", gain: 3, runLocation: "left", parts: { ballCarrier: "O-RB1", tackler: "X-LB2" } }));
        const b = rated(mk({ formation: f, call, preset: "baseCover3", result: "run", gain: 14, runLocation: "left", parts: { ballCarrier: "O-RB1", tackler: "X-S1" } }));
        expect(unclamped(a) && unclamped(b), `${f} ${call}: both unclamped`).toBe(true);
        expect(leak(a, b), `${f} ${call}`).toBeNull();
      }
  });

  it("R-C9, an interception and a sack against a completion: the rated defense is the same up to the earlier read", () => {
    const base = rated(pass("complete", 12, { target: "O-WR1", receiver: "O-WR1", tackler: "X-CB1" }, "shotgun", "intermediatePass"));
    expect(leak(base, rated(pass("interception", 14, { target: "O-WR2", interceptor: "X-S1", tackler: "O-WR2" }, "shotgun", "intermediatePass")))).toBeNull();
    expect(leak(base, rated(pass("sack", -7, { sacker: "X-DL2", tackler: "X-DL2" }, "shotgun", "intermediatePass")))).toBeNull();
  });

  it("R-C9 can fail here: the same defense at other awareness ratings is drawn differently before the read", () => {
    const ev = pass("complete", 12, { target: "O-WR1", receiver: "O-WR1", tackler: "X-CB1" }, "shotgun", "intermediatePass");
    const all = (a: number): Ratings => Object.fromEntries(Object.entries(tableRatings(ev)).map(([id, r]) => [id, { ...r, awareness: a }]));
    expect(leak(build(ev, all(40)), build(ev, all(90)))).not.toBeNull();
  });

  const targets: { f: string; leaf: string; target: string; gain: number }[] = [
    { f: "shotgun", leaf: "shortPass", target: "O-WR1", gain: 7 },
    { f: "shotgun", leaf: "intermediatePass", target: "O-WR2", gain: 14 },
    { f: "shotgun", leaf: "deepPass", target: "O-WR1", gain: 31 },
    { f: "pistol", leaf: "deepPass", target: "O-WR1", gain: 25 },
    { f: "empty", leaf: "intermediatePass", target: "O-WR3", gain: 12 },
    { f: "underCenter", leaf: "playAction", target: "O-TE2", gain: 16 },
    { f: "heavy", leaf: "shortPass", target: "O-TE3", gain: 6 },
    { f: "shotgun", leaf: "screenPass", target: "O-RB1", gain: 5 },
  ];
  for (const c of targets)
    it(`R-C7, ${c.f} ${c.leaf} to ${c.target}: with ratings he is on his template track to the throw and at the catch point at catch time`, () => {
      const ev = mk({ formation: c.f, call: c.leaf, preset: "nickelCover3", result: "complete", gain: c.gain, parts: { passer: "O-QB1", target: c.target, receiver: c.target, tackler: "X-CB1" } });
      const tl = rated(ev);
      expect(unclamped(tl), "an unclamped play").toBe(true);
      // His template track: the same calls with nobody targeted, thrown behind the QB on a long flight.
      const tplEv = mk({ formation: c.f, call: c.leaf, preset: "nickelCover3", result: "complete", gain: c.gain, airYards: -30, parts: { passer: "O-QB1" } });
      const tplTl = build(tplEv, tableRatings(ev), longMotion());
      expect(tplTl.snapAt).toBe(tl.snapAt);
      const flight = flightOf(tl);
      if (flight === undefined) throw new Error("no flight");
      const me = markOf(tl, c.target);
      const off = firstDiff(me.keys, markOf(tplTl, c.target).keys, tl.snapAt, flight.start, KEY, 0.1);
      expect(off === null ? null : `${off.d.toFixed(2)} yd off his template ${(off.t - tl.snapAt).toFixed(0)} ms after the snap (throw at ${(flight.start - tl.snapAt).toFixed(0)})`).toBeNull();
      expect(dist(at(me.keys, flight.end), flight.points.at(-1) as { x: number; y: number }), "at the catch point at catch time").toBeLessThan(0.1);
    });

  // The sample: every formation, pass class and target, each against one of the three presets in
  // turn. The whole product (every one against all three, three times the builds on a 6 s reference
  // flight) runs in test/game/player-reactions.heavy.test.ts.
  it("R-C19, built incompletions over every formation, pass class and target: with ratings the target stays within 0.1 yd of his template track to the whistle (reachYards + 0.1 in the reach window)", { timeout: 300_000 }, () => {
    const r = rc19Rated(false);
    expectNone({ "off his template track": r.bad, "incompletions compared": r.n > 25 ? [] : [`${r.n}, under 25`] });
  });

  const misses: EvSpec[] = [
    { formation: "shotgun", call: "deepPass", preset: "nickelCover3", result: "incomplete", parts: { passer: "O-QB1", target: "O-WR1" } },
    { formation: "pistol", call: "intermediatePass", preset: "nickelCover1", result: "incomplete", parts: { passer: "O-QB1", target: "O-TE1" } },
    { formation: "empty", call: "shortPass", preset: "nickel2Man", result: "incomplete", parts: { passer: "O-QB1", target: "O-WR3" } },
    { formation: "underCenter", call: "playAction", preset: "baseCover2", result: "incomplete", parts: { passer: "O-QB1", target: "O-WR2" } },
    { formation: "heavy", call: "deepPass", preset: "baseCover3", result: "incomplete", parts: { passer: "O-QB1", target: "O-RB1" } },
    { formation: "shotgun", call: "screenPass", preset: "dimeCover4", result: "incomplete", parts: { passer: "O-QB1", target: "O-RB1" } },
  ];
  for (const e of misses)
    it(`R-C20, ${e.formation} ${e.call} vs ${e.preset} to ${e.parts?.["target"] ?? ""}: with ratings each forced kind draws identical frames, all 22 marks and the ball, up to the throw`, () => {
      const ev = mk(e);
      const tls = KINDS.map((k) => rated(ev, { forceMiss: k }));
      expect(tls.map((t) => t.miss?.kind)).toEqual([...KINDS]);
      const a = tls[0] as Timeline;
      expect(a.marks.length).toBe(22);
      const throwT = flightOf(a)?.start as number;
      const diffs: string[] = [];
      for (const b of tls.slice(1)) {
        expect(b.snapAt).toBe(a.snapAt);
        expect(flightOf(b)?.start).toBe(throwT);
        for (const m of a.marks) {
          const d = firstDiff(m.keys, markOf(b, m.playerId).keys, 0, throwT);
          if (d !== null) diffs.push(`${b.miss?.kind ?? ""}: ${m.slot} ${d.d.toFixed(4)} yd at ${(d.t - a.snapAt).toFixed(0)} ms`);
        }
        const db = firstDiff(a.ball, b.ball, 0, throwT);
        if (db !== null) diffs.push(`${b.miss?.kind ?? ""}: ball ${db.d.toFixed(4)} yd at ${(db.t - a.snapAt).toFixed(0)} ms`);
        for (let t = 0; t <= throwT; t += 5) if (Math.abs(scaleAt(a.ballScale, t) - scaleAt(b.ballScale, t)) > 1e-9) diffs.push(`${b.miss?.kind ?? ""}: ball scale at ${(t - a.snapAt).toFixed(0)} ms`);
      }
      expect(diffs.slice(0, 10)).toEqual([]);
    });

  it("P3: with ratings, the same calls with different results draw the same frames before the snap and the same preview", () => {
    const ratings = tableRatings(COMPLETE);
    const a = build(COMPLETE, ratings, motion, {}, "offense");
    const b = build({ ...INCOMPLETE, offense: COMPLETE.offense, defense: COMPLETE.defense }, ratings, motion, {}, "offense");
    for (const t of [0, 100, a.setAt, a.snapAt - 1]) {
      expect(b.marks.map((m) => [m.playerId, at(m.keys, t)])).toEqual(a.marks.map((m) => [m.playerId, at(m.keys, t)]));
      expect(at(b.ball, t)).toEqual(at(a.ball, t));
    }
    expect(a.preview).not.toBeNull();
    expect(b.preview).toEqual(a.preview);
  });

  it("PR12: no frame before the snap, and no preview, changes with ratings (every fixture, either side coached)", () => {
    const bad: string[] = [];
    for (const f of FIXTURES)
      for (const human of ["offense", "defense"] as const) {
        const a = build(f.ev, f.ratings, motion, {}, human);
        const b = build(f.ev, undefined, motion, {}, human);
        if (a.snapAt !== b.snapAt || a.setAt !== b.setAt) bad.push(`${f.name} (${human}): the set or the snap moved`);
        for (const m of a.marks) if (firstDiff(m.keys, markOf(b, m.playerId).keys, 0, a.snapAt, KEY) !== null) bad.push(`${f.name} (${human}): ${m.side}${m.slot} before the snap`);
        if (JSON.stringify(a.preview) !== JSON.stringify(b.preview)) bad.push(`${f.name} (${human}): the preview`);
      }
    expect(bad).toEqual([]);
  });

  it("N7: with ratings, two runs of the same input give identical timelines", () => {
    for (const f of FIXTURES) expect(build(structuredClone(f.ev), f.ratings), f.name).toEqual(build(f.ev, f.ratings));
  });

  it("N7 extended to nat.react: unchanged when only target, result or end spot change (delayMs and pursueAt of a named player excepted)", () => {
    const ratings = tableRatings(COMPLETE);
    const d = COMPLETE.play.detail as { participants: Record<string, string> };
    const variants: Record<string, PlayEvent> = {
      "another target": { ...COMPLETE, play: { ...COMPLETE.play, detail: { ...d, participants: { ...d.participants, receiver: "H-WR1", target: "H-WR1" } } } as PlayEvent["play"] },
      "another end spot": { ...COMPLETE, play: { ...COMPLETE.play, end: { spot: 70, possession: "offense" } } as PlayEvent["play"] },
      "an incompletion": { ...COMPLETE, play: { kind: "pass", seconds: 5, incomplete: true, end: { spot: COMPLETE.before.spot, possession: "offense" }, detail: { ...d, participants: { passer: d.participants["passer"] as string, target: "H-TE1" } } } as PlayEvent["play"] },
    };
    const base = build(COMPLETE, ratings);
    const bad: string[] = [];
    for (const [name, ev] of Object.entries(variants)) {
      const tl = build(ev, ratings);
      for (const m of base.marks) {
        const n = markOf(tl, m.playerId);
        const a = reactOf(m);
        const b = reactOf(n);
        const named = base.involved.includes(m.playerId) || tl.involved.includes(m.playerId);
        // NM4's values first, as natural-motion.spec.test.ts N7 has them.
        for (const k of ["top", "accelMs", "reactionMs", "startSpreadMs"] as const) if (natOf(m)[k] !== natOf(n)[k]) bad.push(`${name}: ${m.side}${m.slot} nat.${k} ${natOf(m)[k]} against ${natOf(n)[k]}`);
        for (const k of ["readMs", "vary", "leadMs", "turnShare", "lateralAccel"] as const) if (a[k] !== b[k]) bad.push(`${name}: ${m.side}${m.slot} react.${k} ${a[k]} against ${b[k]}`);
        if (named) continue;
        if (a.delayMs !== b.delayMs) bad.push(`${name}: ${m.side}${m.slot} (unnamed) react.delayMs ${a.delayMs} against ${b.delayMs}`);
        // pursueAt is a screen time after the read, and the read moves with the target and the
        // result. What can't change for an unnamed mark is whether he pursues, and how long after
        // the read (the DL's release follows the carrier or the throw, so it is left out).
        if ((a.pursueAt === null) !== (b.pursueAt === null)) bad.push(`${name}: ${m.side}${m.slot} (unnamed) pursues on one and not the other`);
        else if (a.pursueAt !== null && b.pursueAt !== null && m.position !== "DL" && Math.abs(a.pursueAt - base.read - (b.pursueAt - tl.read)) > 1e-6) bad.push(`${name}: ${m.side}${m.slot} (unnamed) pursues ${(a.pursueAt - base.read).toFixed(1)} ms after the read against ${(b.pursueAt - tl.read).toFixed(1)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ================================================================ PR-C9 and PR-C10: one pass over the samples

/** The standing checks of the spec's baseline table ("Standing checks: the pre-build baseline"). */
const STANDING = ["N1", "N3", "N4", "N5 moving", "N5 engaged and M6", "N6 settle", "N6 anchors", "A3 ring", "R-C5 frozen", "M5", "M7"] as const;
type Standing = (typeof STANDING)[number];

/**
 * The bar on Sample S with the app's ratings: the plays failing each check on the tree this build
 * started from (timeline.ts sha256 f8474557..., git 59e1f6f plus the work recorded in
 * pr-baseline.json), measured by these same functions. Test constants: the build may not fail more
 * plays than this, and nobody raises one to make a build pass. M7's 4 was captured 2026-11-24.
 * One bar is not the pre-build count: N4 was 77 and its bar is 88, the spec's stated allowance
 * ("The N4 allowance", PR-Open 8, the lead's ruling of 2026-11-24, Joseph to confirm at G-PR).
 */
const S_BAR: Readonly<Record<Standing, number>> = { N1: 547, N3: 54, N4: 88, "N5 moving": 369, "N5 engaged and M6": 384, "N6 settle": 334, "N6 anchors": 1, "A3 ring": 2, "R-C5 frozen": 7, M5: 2, M7: 4 };
/** The plays of S behind the small bars, so a failure can say which lines are older than the build. */
const S_RED_BEFORE: Readonly<Partial<Record<Standing, readonly string[]>>> = {
  "N6 anchors": ["seed 4 play 124 pass shortPass"],
  "A3 ring": ["seed 5 play 70 run outsideRun", "seed 5 play 77 pass shortPass"],
  "R-C5 frozen": ["seed 2 play 68 pass playAction", "seed 2 play 175 pass playAction", "seed 5 play 36 pass playAction", "seed 5 play 39 pass playAction", "seed 5 play 45 pass playAction", "seed 5 play 68 pass playAction", "seed 5 play 80 pass playAction"],
  M5: ["seed 3 play 116 pass screenPass", "seed 5 play 158 pass playAction"],
  M7: ["seed 3 play 141 pass playAction", "seed 4 play 67 pass deepPass", "seed 5 play 137 pass playAction", "seed 6 play 40 pass playAction"],
};
/**
 * The (check, fixture) pairs that already failed on that tree with this file's fixture rating
 * table (captured 2026-11-24 from the same pre-build copy). Every other pair passed there and must
 * still pass. A pair listed here may pass or fail.
 */
const FIXTURES_RED_BEFORE: Readonly<Record<Standing, readonly string[]>> = {
  N1: ["COMPLETE", "INCOMPLETE", "INTERCEPTION", "RUN", "RUN_OUT_OF_BOUNDS", "TOUCHDOWN", "SACK", "FUMBLE_LOST", "PUNT_RETURNED", "FAIR_CATCH", "FIELD_GOAL_GOOD", "FIELD_GOAL_MISS", "KICKOFF_TOUCHBACK", "KICKOFF_RETURN", "HOLDING_ON_RUN", "KNEEL", "UNNAMED_COMPLETE", "STANDOUT_RUN"],
  N3: ["FIELD_GOAL_MISS", "KNEEL"],
  N4: ["INCOMPLETE", "INTERCEPTION", "TOUCHDOWN", "KICKOFF_RETURN", "STANDOUT_RUN"],
  "N5 moving": ["COMPLETE", "INCOMPLETE", "INTERCEPTION", "RUN", "SACK", "FAIR_CATCH", "FIELD_GOAL_GOOD", "UNNAMED_COMPLETE"],
  "N5 engaged and M6": ["INCOMPLETE", "RUN", "TOUCHDOWN", "SACK", "FUMBLE_LOST", "PUNT_RETURNED", "FAIR_CATCH", "FIELD_GOAL_GOOD", "FIELD_GOAL_MISS", "HOLDING_ON_RUN", "UNNAMED_COMPLETE", "STANDOUT_RUN"],
  "N6 settle": ["INTERCEPTION", "RUN_OUT_OF_BOUNDS", "TOUCHDOWN", "SACK", "FUMBLE_LOST", "PUNT_RETURNED", "FIELD_GOAL_GOOD", "FIELD_GOAL_MISS", "HOLDING_ON_RUN", "UNNAMED_COMPLETE", "STANDOUT_RUN"],
  "N6 anchors": [],
  "A3 ring": [],
  "R-C5 frozen": [],
  M5: [],
  M7: [],
};

/** The checks outside the baseline (expected green) and PR-C9's two comparisons. */
const OTHER = ["live time", "A2", "C9a facts", "C9a ball y", "C9a anchors", "C9b ball", "C9b anchor place", "C9b anchor time", "C9b handoff", "C9b fact marks", "C9b whistle", "C9b before the throw", "C9b throw window", "C9b pass facts"] as const;
type Other = (typeof OTHER)[number];

interface Tally {
  plays: number;
  /** The plays failing each check with ratings, and one line per violation. */
  readonly failing: Record<string, Set<string>>;
  readonly lines: Record<string, string[]>;
  n3Pairs: number;
  windows: number;
  anchors: number;
  frozenChecked: number;
  m5Plays: number;
  runs: number;
  incompletions: number;
  abCompared: number;
  /** PR-C9 (b): the plays held to every equality (no pass), and the passes of exception (2). */
  exact: number;
  passes: number;
  /** How far the block moves a pass, printed for PERF.md: the throw (screen ms), the catch and the ball at the whistle (yd). */
  readonly throwMoves: number[];
  readonly catchMoves: number[];
  readonly whistleMoves: number[];
  /** Thrown before E by QD2, and passes whose throw stands still while the ball at the whistle moves. */
  plants: number;
  ballOnly: number;
  /** Incompletions: plays on two clocks (skipped), marks held to identity, and marks with an effect of their own (those that differ, and the worst). */
  twoClocks: number;
  held: number;
  ownEffect: number;
  ownDiffer: number;
  ownWorst: number;
}

function tally(samples: readonly Sample[], rawEvery: number): Tally {
  const out: Tally = { plays: 0, failing: {}, lines: {}, n3Pairs: 0, windows: 0, anchors: 0, frozenChecked: 0, m5Plays: 0, runs: 0, incompletions: 0, abCompared: 0, exact: 0, passes: 0, throwMoves: [], catchMoves: [], whistleMoves: [], plants: 0, ballOnly: 0, twoClocks: 0, held: 0, ownEffect: 0, ownDiffer: 0, ownWorst: 0 };
  for (const c of [...STANDING, ...OTHER]) {
    out.failing[c] = new Set();
    out.lines[c] = [];
  }
  // PR-C9 (b) needs the ratings.scrimmage block; a build without it has no scrimmage play to compare.
  const zeroed = zeroedScrimmage();
  samples.forEach((s, i) => {
    const put = (c: Standing | Other, bad: readonly string[]): void => {
      if (bad.length === 0) return;
      (out.lines[c] as string[]).push(...bad);
      (out.failing[c] as Set<string>).add(s.name);
    };
    const kind = s.ev.play.kind;
    const scrimmage = SCRIMMAGE_KINDS.includes(kind);
    const tl = build(s.ev, s.ratings);
    const b: Built = { name: s.name, ev: s.ev, tl };
    if (!isLive(b)) return;
    out.plays++;

    // ---- the standing checks, with ratings
    put("N1", n1(b));
    const r3 = n3(b);
    out.n3Pairs += r3.pairs;
    put("N3", r3.bad);
    put("N4", n4(b));
    put("N5 moving", n5Moving(b));
    // "Nobody wins" needs the raw build: on every play of the fixtures, every 5th play of S (as the bars were measured).
    const r5 = n5Engaged(b, i % rawEvery === 0 ? build(s.ev, s.ratings, motion, { natural: false }) : null);
    out.windows += r5.windows;
    put("N5 engaged and M6", r5.bad);
    put("N6 settle", n6Settle(b));
    const r6 = n6Anchors(b);
    out.anchors += r6.n;
    put("N6 anchors", [...r6.bad, ...atTheBall(b)]);
    put("A3 ring", ring(b));
    // R-C5's no-freeze rule is the scrimmage plays' (routes-pace.spec.test.ts: every run, pass and sack).
    if (scrimmage) {
      const fr = frozenBeforeRead(b);
      if (fr.checked) out.frozenChecked++;
      put("R-C5 frozen", fr.bad);
      const r = m5(b);
      if (r !== null) {
        out.m5Plays++;
        if (r.closer < Math.ceil(r.of / 2)) put("M5", [`${s.name}: ${r.closer} of ${r.of} unnamed defenders end closer to the ball`]);
      }
    }
    put("M7", m7(b));

    // ---- outside the baseline, expected green
    const live = tl.liveEnd - tl.snapAt;
    if (kind !== "kneel" && kind !== "spike" && (live < 1800 - 1e-6 || live > 14000 + 1e-6)) put("live time", [`${s.name}: ${live.toFixed(0)} ms`]);
    const fin = at(tl.ball, tl.liveEnd);
    if ("end" in s.ev.play && s.ev.play.end !== undefined && Math.abs(fin.y - s.ev.play.end.spot) > 1e-6) put("A2", [`${s.name}: ball y ${fin.y} at the whistle, the engine's spot is ${s.ev.play.end.spot}`]);
    for (const m of tl.marks) if (m.side === "O" && !(at(m.keys, tl.snapAt).y < tl.los)) put("A2", [`${s.name}: ${m.slot} is not below the line at the set`]);

    // ---- PR-C9 (a): engine facts, with the ratings against none
    const u = build(s.ev);
    const facts: string[] = [];
    if (u.holder !== tl.holder) facts.push(`${s.name}: holder ${String(tl.holder)} with ratings, ${String(u.holder)} without`);
    if (u.tackler !== tl.tackler) facts.push(`${s.name}: tackler ${String(tl.tackler)} with ratings, ${String(u.tackler)} without`);
    if (JSON.stringify(u.involved) !== JSON.stringify(tl.involved)) facts.push(`${s.name}: involved`);
    const texts = (x: Timeline): string => JSON.stringify([x.labels.map((l) => [l.text, l.source]), x.flags.map((l) => [l.text, l.source])]);
    if (texts(u) !== texts(tl)) facts.push(`${s.name}: label or flag texts and sources`);
    put("C9a facts", facts);
    const finU = at(u.ball, u.liveEnd);
    if (Math.abs(fin.y - finU.y) > 1e-6) put("C9a ball y", [`${s.name}: ${fin.y} with ratings, ${finU.y} without`]);
    const inOrder = (a: readonly { t: number }[]): boolean => a.every((q, j) => j === 0 || q.t >= (a[j - 1] as { t: number }).t - 1e-9);
    for (const id of tl.involved) {
      const m = tl.marks.find((x) => x.playerId === id);
      const n = u.marks.find((x) => x.playerId === id);
      if (m === undefined || n === undefined) continue;
      const a = natOf(m).anchors;
      const w = natOf(n).anchors;
      if (a.length !== w.length) put("C9a anchors", [`${s.name} ${m.side}${m.slot}: ${a.length} fact anchors with ratings, ${w.length} without`]);
      else if (!inOrder(a) || !inOrder(w)) put("C9a anchors", [`${s.name} ${m.side}${m.slot}: his fact anchors are not in time order`]);
    }

    // ---- PR-C9 (b): the shipped build against the same build with every ratings.scrimmage band pair at [0, 0]
    if (!scrimmage) return;
    out.abCompared++;
    const z = build(s.ev, s.ratings, zeroed);
    const factsOf = (x: Timeline): string[] => x.marks.filter((m) => m.fact).map((m) => m.playerId).sort();
    if (kind === "pass") {
      // Exception (2): R8 may move the throw, inside its window, and what follows from it. No engine fact moves.
      out.passes++;
      const win = throwWindow(tl, s.ev, s.ratings);
      if (win !== null) {
        if (win.plant) out.plants++;
        if (win.throwMs < win.lo - 1e-6 || win.throwMs > win.hi + 1e-6) put("C9b throw window", [`${s.name}: thrown ${win.throwMs.toFixed(1)} ms after the snap (raw clock), R8's window is ${win.lo.toFixed(1)} to ${win.hi.toFixed(1)}`]);
      }
      const bad: string[] = [];
      if (z.holder !== tl.holder) bad.push(`holder ${String(tl.holder)}, ${String(z.holder)} with the block zeroed`);
      if (z.tackler !== tl.tackler) bad.push(`tackler ${String(tl.tackler)}, ${String(z.tackler)} with the block zeroed`);
      if (JSON.stringify(z.involved) !== JSON.stringify(tl.involved)) bad.push("involved");
      if (texts(z) !== texts(tl)) bad.push("label or flag texts and sources");
      if (Math.abs(at(z.ball, z.liveEnd).y - fin.y) > 1e-6) bad.push(`ball y at the whistle ${fin.y}, ${at(z.ball, z.liveEnd).y} with the block zeroed`);
      for (const id of tl.involved) {
        const m = tl.marks.find((x) => x.playerId === id);
        const n = z.marks.find((x) => x.playerId === id);
        if (m !== undefined && n !== undefined && (natOf(m).anchors.length !== natOf(n).anchors.length || !inOrder(natOf(m).anchors))) bad.push(`${m.side}${m.slot}: ${natOf(m).anchors.length} fact anchors, ${natOf(n).anchors.length} with the block zeroed, or out of order`);
      }
      put("C9b pass facts", bad.map((x) => `${s.name}: ${x}`));
      const f0 = flightOf(tl);
      const f1 = flightOf(z);
      if (f0 !== undefined && f1 !== undefined) {
        const moved = Math.abs(f0.start - tl.snapAt - (f1.start - z.snapAt));
        const ball = dist(fin, at(z.ball, z.liveEnd));
        out.throwMoves.push(moved);
        // An incompletion's point is the drawn miss, which exception (1) moves: not a catch.
        if (!("incomplete" in s.ev.play && s.ev.play.incomplete === true)) out.catchMoves.push(dist(f0.points.at(-1) as Key, f1.points.at(-1) as Key));
        out.whistleMoves.push(ball);
        if (moved <= 1e-6 && ball > 1e-6) out.ballOnly++;
      }
    }
    if ("incomplete" in s.ev.play && s.ev.play.incomplete === true) {
      // Exception (1): the drawn miss reads the drawn defenders, so the miss point, its kind and the
      // break-up defender may differ, and the two fact-mark sets by at most that one defender on each
      // build. Exception (2) from slice 2: a mark with an effect of his own differs before the throw
      // too. A mark with none is identical, with the ball, up to the earlier of the two throws.
      out.incompletions++;
      const throwT = Math.min(flightOf(tl)?.start ?? tl.read, flightOf(z)?.start ?? z.read);
      // On a clamped play a moved throw changes k, and with it every screen time (exception 2).
      if (tl.snapAt !== z.snapAt || natOf(tl.marks[0] as Timeline["marks"][number]).k !== natOf(z.marks[0] as Timeline["marks"][number]).k) out.twoClocks++;
      else {
        // R9's zone sink follows the receivers' templates: a defender with a landmark is affected when a receiver's own track moved.
        const receiverMoved = tl.marks.some((m) => m.side === "O" && ["WR", "TE", "RB"].includes(m.position) && firstDiff(m.keys, markOf(z, m.playerId).keys, 0, throwT, KEY) !== null);
        const own = (m: Timeline["marks"][number]): boolean => {
          if (receiverMoved && m.side === "X" && templates.zones[s.ev.defense ?? ""]?.[m.slot] !== undefined) return true;
          const a = reactOf(m);
          const w = reactOf(markOf(z, m.playerId));
          return (["breakPaceShare", "manLagMs", "cushionYards", "stalkLagMs", "biteShare"] as const).some((f) => a[f] !== w[f]);
        };
        for (const m of tl.marks) {
          const d = firstDiff(m.keys, markOf(z, m.playerId).keys, 0, throwT, KEY);
          if (own(m)) {
            out.ownEffect++;
            if (d !== null) {
              out.ownDiffer++;
              for (let t = tl.snapAt; t <= throwT + 1e-9; t += KEY) out.ownWorst = Math.max(out.ownWorst, dist(at(m.keys, t), at(markOf(z, m.playerId).keys, t)));
            }
            continue;
          }
          out.held++;
          if (d !== null) put("C9b before the throw", [`${s.name} ${m.side}${m.slot} (no effect of his own): ${d.d.toFixed(3)} yd at ${(d.t - tl.snapAt).toFixed(0)} ms, before the throw at ${(throwT - tl.snapAt).toFixed(0)}`]);
        }
        if (firstDiff(tl.ball, z.ball, 0, throwT, KEY) !== null) put("C9b before the throw", [`${s.name}: the ball, before the throw`]);
      }
      const breakers = [tl.miss?.breaker, z.miss?.breaker];
      const a = factsOf(tl);
      const w = factsOf(z);
      const extra = [...a.filter((id) => !w.includes(id)), ...w.filter((id) => !a.includes(id))].filter((id) => !breakers.includes(id));
      if (extra.length > 0) put("C9b fact marks", [`${s.name}: ${extra.join(", ")} is a fact mark on one build only, and is not a break-up defender`]);
      return;
    }
    if (factsOf(tl).join(",") !== factsOf(z).join(",")) put("C9b fact marks", [`${s.name}: ${factsOf(tl).join(",")} against ${factsOf(z).join(",")} with the block zeroed`]);
    if (kind === "pass") return;
    // Runs, sneaks, sacks and scrambles have no exception in slice 2: every place and time is equal.
    out.exact++;
    const finZ = at(z.ball, z.liveEnd);
    if (dist(fin, finZ) > 1e-6) put("C9b ball", [`${s.name}: the ball at the whistle is ${dist(fin, finZ).toFixed(3)} yd from where the zeroed build has it`]);
    if (Math.abs(tl.liveEnd - z.liveEnd) > 1e-6 || Math.abs(tl.snapAt - z.snapAt) > 1e-6) put("C9b whistle", [`${s.name}: live ${(tl.liveEnd - tl.snapAt).toFixed(1)} ms, ${(z.liveEnd - z.snapAt).toFixed(1)} with the block zeroed`]);
    for (const m of tl.marks) {
      const a = natOf(m).anchors;
      const w = natOf(markOf(z, m.playerId)).anchors;
      if (a.length !== w.length) {
        put("C9b anchor place", [`${s.name} ${m.side}${m.slot}: ${a.length} fact anchors, ${w.length} with the block zeroed`]);
        continue;
      }
      const moved = a.findIndex((q, j) => dist(q, w[j] as typeof q) > 1e-6);
      if (moved >= 0) put("C9b anchor place", [`${s.name} ${m.side}${m.slot} (${m.roles.join("+") || "no role"}): anchor ${moved + 1} of ${a.length} is ${dist(a[moved] as Key, w[moved] as Key).toFixed(3)} yd from its place with the block zeroed`]);
      const late = a.findIndex((q, j) => Math.abs(q.t - (w[j] as typeof q).t) > 1e-6);
      if (late >= 0) put("C9b anchor time", [`${s.name} ${m.side}${m.slot} (${m.roles.join("+") || "no role"}): anchor ${late + 1} of ${a.length} at ${((a[late] as Key).t - tl.snapAt).toFixed(1)} ms, ${((w[late] as Key).t - z.snapAt).toFixed(1)} with the block zeroed`]);
    }
    if (kind === "run" && s.ev.offense.call !== "qbSneak") {
      out.runs++;
      if (Math.abs(tl.read - tl.snapAt - (z.read - z.snapAt)) > 1e-6) put("C9b handoff", [`${s.name}: ${(tl.read - tl.snapAt).toFixed(1)} ms, ${(z.read - z.snapAt).toFixed(1)} with the block zeroed`]);
    }
  });
  return out;
}

let fixturesTally: Tally | null = null;
let sTally: Tally | null = null;
/** The Fixtures with the fixed table. */
const onFixtures = (): Tally => (fixturesTally ??= tally(FIXTURES, 1));
/** Sample S with the app's ratings. */
const onS = (): Tally => (sTally ??= tally(S(), 5));
const SAMPLES = [["the fixtures", onFixtures], ["Sample S", onS]] as const;
const linesOf = (t: Tally, c: Standing | Other): string[] => (t.lines[c] as string[]).slice(0, 30);

describe("PR-C9 (a): engine facts, the same event with the ratings and with none", () => {
  for (const [where, get] of SAMPLES) {
    it(`${where}: the same holder, tackler, involved players, and label and flag texts and sources`, { timeout: 600_000 }, () => {
      const t = get();
      const need = where === "Sample S" ? 400 : 15;
      expectNone({ "an engine fact differs": linesOf(t, "C9a facts"), "plays read": t.plays > need ? [] : [`${t.plays}, under ${need}`] });
    });

    it(`${where}: the ball's y at the whistle is the same (and is the engine's dead spot), and every involved player has the same number of fact anchors, in time order`, { timeout: 600_000 }, () => {
      const t = get();
      expectNone({ "ball y at the whistle": linesOf(t, "C9a ball y"), "A2": linesOf(t, "A2"), "fact anchors of an involved player": linesOf(t, "C9a anchors") });
    });
  }
});

describe("PR-C9 (b): the ratings.scrimmage block moves no place and no time it has no rule for (shipped against every band pair at [0, 0])", () => {
  for (const [where, get] of SAMPLES) {
    it(`${where}, every run, sneak, sack and scramble: the ball's place at the whistle and every fact anchor's place are equal (1e-6 yd)`, { timeout: 600_000 }, () => {
      const t = get();
      const need = where === "Sample S" ? 200 : 5;
      expectNone({ "the ball at the whistle": linesOf(t, "C9b ball"), "a fact anchor's place": linesOf(t, "C9b anchor place"), "plays compared": t.exact > need ? [] : [`${t.exact}, under ${need}`] });
    });

    it(`${where}, every run, sneak, sack and scramble: every anchor's time, the whistle and (on runs) the handoff time are equal`, { timeout: 600_000 }, () => {
      const t = get();
      expectNone({ "an anchor's time": linesOf(t, "C9b anchor time"), "the snap or the whistle": linesOf(t, "C9b whistle"), "the handoff time": linesOf(t, "C9b handoff"), "runs compared": where !== "Sample S" || t.runs > 200 ? [] : [`${t.runs}, under 200`] });
    });

    it(`${where}, passes (exception 2): the throw stays inside R8's window (QD2's plant throw allowed), and the holder, the tackler, the involved players, the label texts, the ball's y at the whistle and the count and order of their fact anchors are equal`, { timeout: 600_000 }, () => {
      const t = get();
      const q = (xs: readonly number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? NaN;
      const say = (xs: readonly number[], unit: string): string => {
        const moved = xs.filter((x) => x > 1e-6);
        return `${moved.length} of ${xs.length} move${moved.length === 0 ? "" : `, median ${q(moved, 0.5).toFixed(2)}, p90 ${q(moved, 0.9).toFixed(2)}, max ${q(moved, 1).toFixed(2)} ${unit}`}`;
      };
      console.info(`PR-C9 (b), ${where}, passes, shipped against the block zeroed (for PERF.md; medians and p90 over those that move): throw ${say(t.throwMoves, "ms")}; catch or interception point ${say(t.catchMoves, "yd")}; ball at the whistle ${say(t.whistleMoves, "yd")}; ${t.ballOnly} with the throw still and the whistle's ball moved; ${t.plants} plant throws`);
      const need = where === "Sample S" ? 200 : 2;
      expectNone({ "outside R8's window": linesOf(t, "C9b throw window"), "an engine fact differs": linesOf(t, "C9b pass facts"), "passes compared": t.passes > need ? [] : [`${t.passes}, at most ${need}`] });
    });

    it(`${where}: the set of fact marks is equal; on an incompletion it may differ by the break-up defender only`, { timeout: 600_000 }, () => {
      expect(linesOf(get(), "C9b fact marks")).toEqual([]);
    });

    it(`${where}, incompletions (exceptions 1 and 2): every mark with no slice 2 effect of his own, and the ball, are identical up to the earlier of the two throws`, { timeout: 600_000 }, () => {
      const t = get();
      const need = where === "Sample S" ? 50 : 0;
      console.info(`PR-C9 (b), ${where}, incompletions: ${t.incompletions}, ${t.twoClocks} of them on two clocks (skipped); ${t.held} marks with no effect of their own held to identity; of ${t.ownEffect} with one, ${t.ownDiffer} differ before the throw, at most ${t.ownWorst.toFixed(2)} yd`);
      expectNone({ "differs before the throw": linesOf(t, "C9b before the throw"), "incompletions compared": t.incompletions > need ? [] : [`${t.incompletions}, at most ${need}`], "marks held to identity": where !== "Sample S" || t.held > 300 ? [] : [`${t.held}, at most 300`] });
    });
  }

  it("the comparison can fail: the two builds do differ (the block changes how COMPLETE's defenders are drawn after the read)", () => {
    const ratings = tableRatings(COMPLETE);
    const a = build(COMPLETE, ratings);
    const z = build(COMPLETE, ratings, zeroedScrimmage());
    expect(a.marks.some((m) => firstDiff(m.keys, markOf(z, m.playerId).keys, a.snapAt, a.liveEnd, KEY) !== null)).toBe(true);
  });
});

describe("PR-C10: no regression in what stands, with ratings", () => {
  it.each(STANDING.map((c) => [c] as const))("Sample S, %s: no more plays fail than before the build", { timeout: 600_000 }, (c) => {
    const t = onS();
    expect(t.plays).toBeGreaterThan(400);
    const now = t.failing[c] as Set<string>;
    const known = S_RED_BEFORE[c];
    const fresh = known === undefined ? [] : [...now].filter((p) => !known.includes(p));
    const note = known === undefined ? "" : fresh.length === 0 ? " (all of them failed it before the build)" : ` (not among the plays that failed it before the build: ${fresh.slice(0, 10).join("; ")})`;
    console.info(`PR-C10, Sample S, ${c}: ${now.size} plays fail with ratings, the bar is ${S_BAR[c]}${note}`);
    expect(now.size, `${c}: plays of S failing with ratings, at most ${S_BAR[c]}${note}. First lines: ${linesOf(t, c).slice(0, 5).join(" | ")}`).toBeLessThanOrEqual(S_BAR[c]);
  });

  it.each(STANDING.map((c) => [c] as const))("the fixtures, %s: every fixture that passed it before the build still passes", { timeout: 600_000 }, (c) => {
    const t = onFixtures();
    expect(t.plays).toBeGreaterThan(15);
    const newly = [...(t.failing[c] as Set<string>)].filter((name) => !FIXTURES_RED_BEFORE[c].includes(name));
    expect(newly, linesOf(t, c).filter((l) => newly.some((n) => l.startsWith(n))).slice(0, 10).join(" | ")).toEqual([]);
  });

  it("the samples are the ones the bars were measured on: 571 plays of S, 18 live fixtures, and each check had something to read", { timeout: 600_000 }, () => {
    const t = onS();
    // S is fixed by the sim games (PR-C1's inputs test holds seeds 1 to 4): a different count means the bars no longer apply.
    expect(t.plays).toBe(571);
    expect(onFixtures().plays).toBe(18);
    expect(t.n3Pairs).toBeGreaterThan(50);
    expect(t.windows).toBeGreaterThan(20);
    expect(t.anchors).toBeGreaterThan(20);
    expect(t.frozenChecked).toBeGreaterThan(400);
    expect(t.m5Plays).toBeGreaterThan(50);
  });

  for (const [where, get] of SAMPLES)
    it(`${where}: live time stays inside the 1.8 s floor and the 14 s cap (not in the baseline, expected green)`, { timeout: 600_000 }, () => {
      expect(linesOf(get(), "live time")).toEqual([]);
    });

  it("A1: with ratings the same event gives a deep-equal timeline (every fixture, and every 20th play of S)", { timeout: 300_000 }, () => {
    for (const f of FIXTURES) expect(build(structuredClone(f.ev), f.ratings), f.name).toEqual(build(f.ev, f.ratings));
    for (const s of S().filter((_, i) => i % 20 === 0)) expect(build(structuredClone(s.ev), s.ratings), s.name).toEqual(build(s.ev, s.ratings));
  });

  it("N6's anchors are exact at any ratings: COMPLETE, RUN and SACK with every player at 40 and at 90", () => {
    for (const r of [40, 90])
      for (const ev of [COMPLETE, RUN, SACK]) {
        const all: Ratings = Object.fromEntries(Object.keys(tableRatings(ev)).map((id) => [id, { speed: r, agility: r, awareness: r }]));
        expect(n6Anchors({ name: `${ev.play.kind} at ${r}`, ev, tl: build(ev, all) }).bad).toEqual([]);
      }
  });

  it("R-C15: timeline() with ratings takes 20 ms or less per play, median over the fixtures (wall clock: a loaded machine can fail it)", () => {
    const ms: number[] = [];
    for (let r = 0; r < 5; r++)
      for (const f of FIXTURES) {
        const t0 = performance.now();
        build(f.ev, f.ratings);
        ms.push(performance.now() - t0);
      }
    ms.sort((a, b) => a - b);
    expect(ms[Math.floor(ms.length / 2)] as number).toBeLessThanOrEqual(20);
  });
});

// ================================================================ per-mark peak speed

// N1's count is of plays, so a mark can get far worse on a play that already failed it (the slice 2
// review of 2026-11-24). This holds every mark: at most 1.5 x his own top, or 1.10 x what the same
// mark drew on the same play before the build (pr-peaks.json). Seeds 1 to 12 are in
// test/game/player-reactions.heavy.test.ts.
describe("PR-C10, per mark: nobody is drawn far faster than before the build (seeds 1 to 3, the app's ratings)", () => {
  let checked: ReturnType<typeof peakCheck> | null = null;
  const check = (): ReturnType<typeof peakCheck> => (checked ??= peakCheck([1, 2, 3]));
  it("every unnamed mark: his peak speed over top is at most 1.5, or 1.10 x the same mark's before the build", { timeout: 300_000 }, () => {
    const r = check();
    console.info(`PR-C10 per mark, seeds 1 to 3: ${r.read} marks read; over the bar ${r.over.offense.length} offense, ${r.over.defense.length} defense, ${r.over.tackler.length} tackler`);
    expectNone({ [`offense (${r.over.offense.length})`]: r.over.offense.slice(0, 10), [`defense (${r.over.defense.length})`]: r.over.defense.slice(0, 10), "another game than the one captured": r.otherGames, "marks read": r.read > 5000 ? [] : [`${r.read}, under 5000`] });
  });
  it("every tackler: the same bar", { timeout: 300_000 }, () => {
    const r = check();
    expectNone({ [`tacklers (${r.over.tackler.length})`]: r.over.tackler.slice(0, 10), "another game than the one captured": r.otherGames });
  });
});

// ================================================================ PR-C15: the schema

describe("PR-C15: motion.json version 6 and the ratings.scrimmage block", () => {
  /**
   * The block as the spec's table lists it, every key at its starting value, but three that Joseph
   * changed on 2026-11-24 (relayed by the lead): man.lagMs, man.receiverLagMs and stalk.lagMs.
   * Version 6 (Joseph's approval, relayed by the lead) adds one key, stalk.clearYards.
   */
  const BLOCK = {
    by: {
      read: { default: "awareness" },
      lead: { default: "awareness" },
      bite: { default: "awareness" },
      getOff: { default: "awareness" },
      turn: { default: "agility" },
      manLag: { default: "coverage" },
      receiverLag: { default: "routeRunning" },
      cushion: { default: "speed" },
      stalkLag: { default: "awareness", TE: "runBlock" },
      breakPace: { default: "agility", WR: "routeRunning", TE: "routeRunning" },
      air: { default: "coverage", CB: "ballSkills", S: "ballSkills" },
    },
    read: { minMs: 80, defenseMs: [320, -100], offenseMs: [350, 80], releaseMs: [250, 0], varyMs: [140, 30] },
    pursuit: { leadMs: [-250, 250], leadVaryMs: [120, 20], leadMinMs: 50, leadMaxMs: 800, turnShare: [-0.25, 0.25] },
    man: { lagMs: [300, -110], receiverLagMs: [-80, 180], minLagMs: 40, cushionYards: [1.0, -0.5] },
    stalk: { lagMs: [150, -40], clearYards: 1.2 },
    biteShare: [0.6, -0.6],
    breakPaceShare: [-0.25, 0.25],
    air: { baseMs: 250, minMs: 80, manExtraMs: 150, ms: [250, -150], varyMs: [120, 30] },
    getOff: { stepPace: 0.35, offenseMs: [80, 0], defenseMs: [240, 40], varyMs: [60, 10] },
  };
  /** Every key of the block, as a path under ratings.scrimmage. */
  const leaves = (o: Record<string, unknown>, at0: string[] = []): string[][] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v !== null && !Array.isArray(v) && at0[0] !== "by" ? leaves(v as Record<string, unknown>, [...at0, k]) : [[...at0, k]]));
  const KEYS = leaves(BLOCK);

  const rawBlock = (): unknown => (motionRaw["ratings"] as Record<string, unknown> | undefined)?.["scrimmage"];
  /** The shipped file with one value under ratings.scrimmage replaced (undefined removes the key). */
  const withKey = (path: readonly string[], v: unknown): unknown => {
    const o = structuredClone(motionRaw);
    let cur = (o["ratings"] as Record<string, unknown>)["scrimmage"] as Record<string, unknown>;
    for (const k of path.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
    if (v === undefined) delete cur[path.at(-1) as string];
    else cur[path.at(-1) as string] = v;
    return o;
  };

  it("motion.json is version 6, and ratings.scrimmage holds every key of the spec's table at its starting value", () => {
    expect(motionRaw["version"]).toBe(6);
    expect(rawBlock()).toMatchObject(BLOCK);
    // And the parsed Motion carries the same block, so the timeline reads the data, not a constant.
    expect((motion.ratings as unknown as { scrimmage?: unknown }).scrimmage).toMatchObject(BLOCK);
    expect(KEYS.length).toBe(38);
  });

  it("no existing key changed value: the bands the unrated and the kick plays still read, and the values the new bands add to", () => {
    expect(motion.ratings.lo).toBe(40);
    expect(motion.ratings.hi).toBe(90);
    expect(motion.ratings.default).toEqual({ topShare: [-0.12, 0.12], accelShare: [0.15, -0.15], reactionMs: [60, -60], startMs: [20, -20] });
    expect(motion.ratings.byPosition).toEqual({});
    expect(motion.reactionMs).toEqual({ LB: 150, CB: 200, S: 200, DL: 250, other: 150 });
    expect(motion.pursuit).toMatchObject({ leadMs: 400, turnDegPerS: 180 });
    expect(motion.man.lagMs).toBe(150);
    expect(motion.stalk.lagMs).toBe(150);
    expect(motion.maxStartMs).toBe(150);
  });

  it("parseMotion takes the shipped file, and refuses it at version 5 (or 4) or with no ratings.scrimmage block", () => {
    expect(() => parseMotion(structuredClone(motionRaw))).not.toThrow();
    for (const version of [5, 4]) expect(() => parseMotion({ ...structuredClone(motionRaw), version }), `version ${version}`).toThrow(MotionError);
    const o = structuredClone(motionRaw);
    delete (o["ratings"] as Record<string, unknown>)["scrimmage"];
    expect(() => parseMotion(o)).toThrow(MotionError);
  });

  it.each(KEYS.map((k) => [k.join("."), k] as const))("parseMotion refuses a file with ratings.scrimmage.%s missing", (_name, path) => {
    expect(() => parseMotion(withKey(path, undefined))).toThrow(MotionError);
  });

  it.each([
    ["by.read.default is not a rating", ["by", "read", "default"], "vision"],
    ["by.lead.default is not a rating", ["by", "lead", "default"], "leadership"],
    ["by.stalkLag.TE is a skill of another position (ballSkills)", ["by", "stalkLag", "TE"], "ballSkills"],
    ["by.breakPace.WR is a skill of another position (tackling)", ["by", "breakPace", "WR"], "tackling"],
    ["by.air.CB is a skill of another position (runBlock)", ["by", "air", "CB"], "runBlock"],
    ["by.read gains a position whose rating is not its own (LB: routeRunning)", ["by", "read"], { default: "awareness", LB: "routeRunning" }],
    // The varyMs span rule, pair by pair: span(V) < span(B) for every band B the variation V is added to.
    ["read.varyMs spans as much as its smallest band (read.releaseMs, 250)", ["read", "varyMs"], [280, 30]],
    ["read.varyMs (110) against a read.defenseMs of the same span", ["read", "defenseMs"], [110, 0]],
    ["read.varyMs (110) against a narrower read.defenseMs (100)", ["read", "defenseMs"], [50, -50]],
    ["read.varyMs (110) against a read.offenseMs of the same span", ["read", "offenseMs"], [190, 80]],
    ["read.varyMs (110) against a read.releaseMs of the same span", ["read", "releaseMs"], [110, 0]],
    ["pursuit.leadVaryMs spans as much as pursuit.leadMs (500)", ["pursuit", "leadVaryMs"], [520, 20]],
    ["pursuit.leadVaryMs (100) against a pursuit.leadMs of the same span", ["pursuit", "leadMs"], [-50, 50]],
    ["air.varyMs spans as much as air.ms (400)", ["air", "varyMs"], [430, 30]],
    ["air.varyMs (90) against an air.ms of the same span", ["air", "ms"], [45, -45]],
    ["getOff.varyMs spans as much as its smaller band (getOff.offenseMs, 80)", ["getOff", "varyMs"], [90, 10]],
    ["getOff.varyMs (50) against a getOff.offenseMs of the same span", ["getOff", "offenseMs"], [50, 0]],
    ["getOff.varyMs (50) against a getOff.defenseMs of the same span", ["getOff", "defenseMs"], [90, 40]],
    ["pursuit.turnShare below -0.3", ["pursuit", "turnShare"], [-0.31, 0.25]],
    ["pursuit.turnShare above 0.3", ["pursuit", "turnShare"], [-0.25, 0.31]],
    ["breakPaceShare below -0.3", ["breakPaceShare"], [-0.31, 0.25]],
    ["breakPaceShare above 0.3", ["breakPaceShare"], [-0.25, 0.31]],
    ["biteShare above 0.8", ["biteShare"], [0.81, -0.6]],
    ["biteShare below -0.8", ["biteShare"], [0.6, -0.81]],
    ["getOff.stepPace at 0", ["getOff", "stepPace"], 0],
    ["getOff.stepPace below 0", ["getOff", "stepPace"], -0.1],
    ["getOff.stepPace above 1", ["getOff", "stepPace"], 1.01],
    ["getOff.defenseMs above 400", ["getOff", "defenseMs"], [401, 40]],
    ["getOff.offenseMs above 400", ["getOff", "offenseMs"], [401, 0]],
    ["pursuit.leadMinMs above pursuit.leadMaxMs (900 against 800)", ["pursuit", "leadMinMs"], 900],
    ["pursuit.leadMaxMs below pursuit.leadMinMs (40 against 50)", ["pursuit", "leadMaxMs"], 40],
    ["a negative read.minMs", ["read", "minMs"], -1],
    ["stalk.clearYards above stalk.contactYards (1.41 against 1.4)", ["stalk", "clearYards"], 1.41],
    ["stalk.clearYards at 0", ["stalk", "clearYards"], 0],
    ["a negative stalk.clearYards", ["stalk", "clearYards"], -0.1],
    ["stalk.clearYards not a number (NaN)", ["stalk", "clearYards"], NaN],
    ["stalk.clearYards infinite", ["stalk", "clearYards"], Infinity],
    ["stalk.clearYards a string", ["stalk", "clearYards"], "1.2"],
    ["a band that is not a pair (read.defenseMs)", ["read", "defenseMs"], 320],
    ["a number that is a string (read.minMs)", ["read", "minMs"], "soon"],
  ] as const)("parseMotion refuses: %s", (_name, path, v) => {
    expect(() => parseMotion(withKey(path, v))).toThrow(MotionError);
  });

  it("the limits are where the spec puts them: the edge values still parse (turnShare and breakPaceShare at 0.3, biteShare at 0.8, stepPace at 1, a getOff value of 400, a varyMs span one under its smallest band, a position's own skill in a by table)", () => {
    const ok: (readonly [readonly string[], unknown])[] = [
      [["pursuit", "turnShare"], [-0.3, 0.3]],
      [["breakPaceShare"], [-0.3, 0.3]],
      [["biteShare"], [0.8, -0.8]],
      [["getOff", "stepPace"], 1],
      [["getOff", "defenseMs"], [400, 40]],
      // The span rule is strict and no stricter: one under the smallest band's span still parses.
      [["read", "varyMs"], [279, 30]],
      [["pursuit", "leadVaryMs"], [519, 20]],
      [["air", "varyMs"], [429, 30]],
      [["getOff", "varyMs"], [89, 10]],
      // leadMinMs may equal leadMaxMs (the rule refuses "above"), and read.minMs may be 0 (it refuses "negative").
      [["pursuit", "leadMinMs"], 800],
      [["read", "minMs"], 0],
      // clearYards may equal stalk.contactYards (the rule refuses "above"), and may be small (it refuses "non-positive").
      [["stalk", "clearYards"], motion.stalk.contactYards],
      [["stalk", "clearYards"], 0.01],
      [["by", "read"], { default: "awareness", LB: "coverage" }],
      [["by", "turn"], { default: "agility", RB: "elusiveness" }],
      [["by", "cushion"], { default: "strength" }],
    ];
    for (const [path, v] of ok) expect(() => parseMotion(withKey(path, v)), path.join(".")).not.toThrow();
  });
});
