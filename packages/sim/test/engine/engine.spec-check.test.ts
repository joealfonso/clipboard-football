// Spec checks for M1 step 4 (docs/specs/m1-step4-play-engine.md) that the existing engine tests
// cover only weakly or not at all. Written from the spec by test-writer; the implementation was
// read only for the interface.
//
// - C1: the sampled states really include the situations the criterion lists.
// - C2 and the designed pairing: which fouls go with which physical play, and who can foul.
// - C4: no input (state, calls, players, data) is mutated, on every phase and call kind.
// - D7: edges are relative to the same slot's league average, with position-specific means.
// - Formation layer (resolved question 12): its documented directions are visible.
// - Edge cases: every leaf x preset pair resolves; long field goals; onside when leading;
//   kickoff after a safety; kneel and spike take no matchup and only pre-snap fouls.

import { describe, expect, it } from "vitest";
import { BASE_RATINGS, POSITION_SKILLS, POSITIONS, type EngineData, type Player, type TeamPool } from "../../../shared/src/engine";
import type { PlayResult } from "../../../shared/src/types";
import { generateTeam, slotNeeds } from "../../src/engine/players";
import { createEngine } from "../../src/engine/resolve";
import { applyPlay } from "../../src/game/machine";
import type { GameState } from "../../src/game/types";
import { Rng } from "../../src/rng";
import { loadCallerData } from "../caller/load-data";
import { callsFor, type Calls } from "../support/engine-calls";
import { loadEngineData } from "../support/engine-data";
import { flatTeam, meansAt, scrimmageState } from "../support/engine-fixtures";
import { randomGame } from "../support/random-game";
import { loadRules } from "../support/rules";

const data = loadEngineData();
const { rules, hash } = loadRules();
const caller = loadCallerData();
const LEAVES = Object.values(data.scrimmage.families).flatMap((f) => f.leaves);
const PRESETS = Object.keys(data.personnel.presetPackage);

function sampleStates(n: number, seedBase: number): GameState[] {
  const out: GameState[] = [];
  for (let g = 0; out.length < n; g++) {
    const game = randomGame(rules, { gameType: g % 2 === 0 ? "regularSeason" : "postseason", seed: seedBase + g, rulesHash: hash }, seedBase + 2000 + g);
    for (const s of game.states) if (s.phase === "scrimmage" || s.phase === "try" || s.phase === "kickoff") out.push(s);
  }
  return out.slice(0, n);
}

/** The play family of a call, as the pairing table names families. */
function familyOf(c: Calls): string {
  const call = c.offense.call === "goForTwo" ? (c.offense.twoPointPlay as string) : c.offense.call;
  for (const [fam, def] of Object.entries(data.scrimmage.families)) if (def.leaves.includes(call)) return fam;
  return call;
}

describe("C1: the sampled states cover what the criterion lists", () => {
  // Same generator and seeds as contract.test.ts, so this checks the states C1 actually ran on.
  const states = (() => {
    const out: GameState[] = [];
    for (let g = 0; out.length < 100_000; g++) {
      const game = randomGame(rules, { gameType: g % 2 === 0 ? "regularSeason" : "postseason", seed: 7000 + g, rulesHash: hash }, 9000 + g);
      for (const s of game.states) if (s.phase === "scrimmage" || s.phase === "try" || s.phase === "kickoff") out.push(s);
    }
    return out.slice(0, 100_000);
  })();
  const reg = rules.game.regulationPeriods;

  it.each([
    ["every down 1-4", (s: GameState) => s.phase === "scrimmage", (xs: GameState[]) => new Set(xs.map((s) => s.down)).size === 4],
    ["tries", (s: GameState) => s.phase === "try", (xs: GameState[]) => xs.length > 0],
    ["kickoffs", (s: GameState) => s.phase === "kickoff" && !s.safetyKick, (xs: GameState[]) => xs.length > 0],
    ["safety kicks", (s: GameState) => s.phase === "kickoff" && s.safetyKick, (xs: GameState[]) => xs.length > 0],
    ["first half's final 2:00", (s: GameState) => s.period === 2 && s.clock <= 120 && s.phase === "scrimmage", (xs: GameState[]) => xs.length > 0],
    ["second half's final 2:00", (s: GameState) => s.period === reg && s.clock <= 120 && s.phase === "scrimmage", (xs: GameState[]) => xs.length > 0],
    ["overtime", (s: GameState) => s.period > reg && s.phase === "scrimmage", (xs: GameState[]) => xs.length > 0],
  ])("%s", (_l, pick, ok) => {
    expect(ok(states.filter(pick))).toBe(true);
  });
});

describe("C2 and the designed pairing: fouls go only with the plays the spec allows", () => {
  const resolve = createEngine(data);
  const r = Rng.fromSeed(31);
  const players = { home: generateTeam(r, data, "H"), away: generateTeam(r, data, "A") };
  const pairing = data.config.penalties.pairing;
  const rule = (id: string) => {
    const x = pairing[id];
    return typeof x === "object" ? x : undefined;
  };
  const states = sampleStates(60_000, 12_000);
  const rng = Rng.fromSeed(77);
  const rows: { s: GameState; c: Calls; p: PlayResult }[] = [];
  for (let i = 0; i < states.length; i++) {
    const s = states[i] as GameState;
    const c = callsFor(s, rules, caller, rng, i % 2 === 1);
    rows.push({ s, c, p: resolve(s, c.offense, c.defense, players, rng) });
  }
  const fouled = rows.filter((x) => (x.p.fouls ?? []).length > 0);

  it("draws enough fouled plays to check (sanity)", () => {
    expect(fouled.length).toBeGreaterThan(500);
  });

  it("a pre-snap (noPlay) foul always produces a noPlay with that one foul, and only pre-snap fouls produce noPlay", () => {
    const bad: string[] = [];
    for (const { p } of fouled) {
      for (const f of p.fouls ?? []) {
        const pr = rule(f.penalty);
        if (pr?.pairs === "noPlay" && (p.kind !== "noPlay" || (p.fouls ?? []).length !== 1)) bad.push(`${f.penalty} on ${p.kind}`);
      }
      if (p.kind === "noPlay") for (const f of p.fouls ?? []) if (rule(f.penalty)?.pairs !== "noPlay") bad.push(`noPlay with ${f.penalty}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("an incompletePass foul (DPI, OPI, intentional grounding) pairs with an incomplete pass on a pass leaf", () => {
    const bad: string[] = [];
    for (const { c, p } of fouled) {
      for (const f of p.fouls ?? []) {
        if (rule(f.penalty)?.pairs !== "incompletePass") continue;
        const incomplete = (p.kind === "pass" || p.kind === "twoPoint") && (p as { incomplete?: boolean }).incomplete === true;
        if (!incomplete || familyOf(c) !== "pass") bad.push(`${f.penalty} on ${p.kind} (${familyOf(c)})`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("every foul's play family is one its pairing rule lists", () => {
    const bad: string[] = [];
    for (const { c, p } of fouled) {
      if (p.kind === "kickoff" || p.kind === "onsideKick") continue;
      const fam = familyOf(c);
      for (const f of p.fouls ?? []) {
        const pr = rule(f.penalty);
        if (pr !== undefined && !pr.families.includes(fam)) bad.push(`${f.penalty} on ${fam}`);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it("fouls by both teams only on run or pass plays without a change of possession; kicks and turnovers are fouled by one team only", () => {
    const bad: string[] = [];
    for (const { c, p } of fouled) {
      const sides = new Set((p.fouls ?? []).map((f) => f.by));
      if (sides.size < 2) continue;
      const end = (p as { end?: { possession: string } }).end;
      const changed = end?.possession === "defense" || (p as { turnover?: string }).turnover !== undefined;
      const fam = familyOf(c);
      if ((fam !== "run" && fam !== "pass") || changed) bad.push(`${p.kind} (${fam}, changed ${changed})`);
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it("kneels and spikes draw no foul other than a pre-snap one, and take no matchup", () => {
    const bad: string[] = [];
    for (const { c, p } of rows) {
      if (c.offense.call !== "kneel" && c.offense.call !== "spike") continue;
      for (const f of p.fouls ?? []) if (rule(f.penalty)?.pairs !== "noPlay") bad.push(`${c.offense.call}: ${f.penalty}`);
      const trace = (p.detail as { trace: { factor: string }[] }).trace;
      if (trace.some((e) => e.factor === "matchup" || e.factor === "formation")) bad.push(`${c.offense.call}: matchup in trace`);
    }
    expect(bad).toEqual([]);
  });
});

/** Freezes an object graph in place, so any write throws (ES modules are strict). */
function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as object)) deepFreeze(v);
  }
  return x;
}

describe("C4: inputs are never mutated, on every phase and call kind", () => {
  it("frozen state, calls, players and data resolve without a write, over 20,000 plays of every kind", () => {
    const frozenData = deepFreeze(structuredClone(data));
    const resolve = createEngine(frozenData);
    const r = Rng.fromSeed(4);
    const players = deepFreeze({ home: generateTeam(r, data, "H"), away: generateTeam(r, data, "A") });
    const states = sampleStates(20_000, 31_000);
    const rng = Rng.fromSeed(9);
    const errors: string[] = [];
    const kinds = new Set<string>();
    for (let i = 0; i < states.length; i++) {
      const s = deepFreeze(structuredClone(states[i] as GameState));
      const c = deepFreeze(callsFor(s, rules, caller, rng, i % 2 === 1));
      try {
        kinds.add(resolve(s, c.offense, c.defense, players, rng).kind);
      } catch (e) {
        if (errors.length < 5) errors.push(`${c.offense.call}: ${(e as Error).message}`);
      }
    }
    expect(errors).toEqual([]);
    expect([...kinds].sort()).toEqual(expect.arrayContaining(["extraPoint", "fieldGoal", "kickoff", "kneel", "pass", "punt", "run", "twoPoint"]));
  }, 120_000);
});

/** Data whose league mean for each position is a distinct integer, every rating at that value. */
function positionMeans(d: EngineData): { data: EngineData; level: Record<string, number> } {
  const level: Record<string, number> = {};
  POSITIONS.forEach((p, i) => (level[p] = 40 + 4 * i));
  const ratings = Object.fromEntries(
    Object.entries(d.distributions.ratings).map(([pos, rs]) => [pos, Object.fromEntries(Object.entries(rs).map(([r, x]) => [r, { ...x, mean: level[pos] as number }]))]),
  );
  return { data: { ...d, distributions: { ...d.distributions, ratings } }, level };
}

function averageTeam(d: EngineData, level: Record<string, number>, name: string): TeamPool {
  const need = slotNeeds(d.personnel);
  const players: Player[] = [];
  for (const position of POSITIONS) {
    const v = level[position] as number;
    for (let i = 0; i < need[position]; i++) {
      players.push({
        schemaVersion: 1,
        id: `${name}-${position}${i + 1}`,
        name: `${name} ${position}${i + 1}`,
        position,
        ratings: Object.fromEntries(BASE_RATINGS.map((r) => [r, v])) as Player["ratings"],
        skills: Object.fromEntries(POSITION_SKILLS[position].map((s) => [s, v])),
      });
    }
  }
  return { schemaVersion: 1, name, players };
}

describe("D7: edges are relative to the same slots' league average", () => {
  // Every player sits exactly at his own position's league mean, but the means differ by
  // position, so Base (more LBs) and Dime (more DBs) put different raw ratings on the field.
  // The spec: the edge is the unit rating minus the league-average unit rating for the same
  // personnel slots, so both packages must show zero edge and the effects must change nothing.
  const { data: pm, level } = positionMeans(data);
  const team = averageTeam(pm, level, "M");
  const withEffects = createEngine(pm);
  const without = createEngine({ ...pm, ratings: { ...pm.ratings, effects: [] } });
  const s = scrimmageState(40, 1, 10);

  it.each([
    ["insideRun", "underCenter", "baseCover3"],
    ["insideRun", "underCenter", "dimeCover4"],
    ["deepPass", "shotgun", "baseCover3"],
    ["deepPass", "shotgun", "dimeCover4"],
    ["screenPass", "empty", "nickelCover3"],
  ])("%s from %s against %s: no rating factor and the class probabilities equal the no-effect engine's", (leaf, formation, preset) => {
    for (let seed = 1; seed < 60; seed++) {
      const a = withEffects(s, { call: leaf, formation }, preset, { home: team, away: team }, Rng.fromSeed(seed));
      const da = a.detail as { classProbabilities?: Record<string, number>; trace: { factor: string }[] };
      if (da.classProbabilities === undefined) continue;
      expect(da.trace.filter((e) => e.factor === "rating")).toEqual([]);
      const b = without(s, { call: leaf, formation }, preset, { home: team, away: team }, Rng.fromSeed(seed));
      const db = b.detail as { classProbabilities?: Record<string, number> };
      expect(da.classProbabilities).toEqual(db.classProbabilities);
      return;
    }
    throw new Error("only pre-snap fouls");
  });
});

describe("formation layer (resolved question 12): documented directions are visible", () => {
  const flat = meansAt(data, 65);
  const team = flatTeam(flat, "F", 65);
  const real = createEngine(flat);
  const ones = (xs: readonly number[]): number[] => xs.map(() => 1);
  const noLayer = createEngine({
    ...flat,
    matchup: {
      ...flat.matchup,
      formation: Object.fromEntries(
        Object.entries(flat.matchup.formation).map(([leaf, fs]) => [
          leaf,
          Object.fromEntries(Object.entries(fs).map(([f, ks]) => [f, Object.fromEntries(Object.entries(ks).map(([k, xs]) => [k, ones(xs)]))])),
        ]),
      ),
    },
  });
  const probs = (e: ReturnType<typeof createEngine>, s: GameState, leaf: string, formation: string, preset: string): Record<string, number> => {
    for (let seed = 1; seed < 200; seed++) {
      const d = e(s, { call: leaf, formation }, preset, { home: team, away: team }, Rng.fromSeed(seed)).detail as { classProbabilities?: Record<string, number> };
      if (d.classProbabilities !== undefined) return d.classProbabilities;
    }
    throw new Error("only pre-snap fouls");
  };
  /** How much the layer moves `cls` for this formation, relative to the same formation without it. */
  const lift = (s: GameState, leaf: string, formation: string, preset: string, cls: string): number =>
    (probs(real, s, leaf, formation, preset)[cls] as number) / (probs(noLayer, s, leaf, formation, preset)[cls] as number);

  const short = scrimmageState(50, 3, 1);
  const open = scrimmageState(35, 1, 10);

  it("Heavy helps short-yardage runs: fewer stuffs and more 1-3 than Shotgun gets from the layer", () => {
    expect(lift(short, "insideRun", "heavy", "baseCover3", "loss")).toBeLessThan(lift(short, "insideRun", "shotgun", "baseCover3", "loss"));
    expect(lift(short, "insideRun", "heavy", "baseCover3", "r1_3")).toBeGreaterThan(lift(short, "insideRun", "shotgun", "baseCover3", "r1_3"));
  });

  it("Shotgun and Empty help quick passes against Under Center", () => {
    expect(lift(open, "shortPass", "shotgun", "nickelCover3", "c1_9")).toBeGreaterThan(lift(open, "shortPass", "underCenter", "nickelCover3", "c1_9"));
    expect(lift(open, "shortPass", "empty", "nickelCover3", "inc")).toBeLessThan(lift(open, "shortPass", "underCenter", "nickelCover3", "inc"));
  });

  it("Shotgun costs run efficiency against Under Center", () => {
    expect(lift(open, "insideRun", "shotgun", "nickelCover3", "r4_9")).toBeLessThan(lift(open, "insideRun", "underCenter", "nickelCover3", "r4_9"));
  });

  it("Empty raises sack exposure, most against Dime", () => {
    const vsNickel = lift(open, "deepPass", "empty", "nickelCover3", "sack");
    expect(vsNickel).toBeGreaterThan(lift(open, "deepPass", "shotgun", "nickelCover3", "sack"));
    expect(lift(open, "deepPass", "empty", "dimeCover4", "sack")).toBeGreaterThan(vsNickel);
  });
});

describe("edge cases the spec lists as reachable", () => {
  const resolve = createEngine(data);
  const r = Rng.fromSeed(15);
  const players = { home: generateTeam(r, data, "H"), away: generateTeam(r, data, "A") };
  const play = (s: GameState, call: Parameters<typeof resolve>[1], def: string | null, seed: number): PlayResult => resolve(s, call, def, players, Rng.fromSeed(seed));
  const withRules = (s: GameState): GameState => ({ ...s, rules: { id: rules.id, hash } });

  it("every scrimmage leaf against every preset resolves and is accepted, including Goal Line vs a deep pass at midfield and Prevent on 1st and 10", () => {
    const states = [scrimmageState(50, 1, 10), scrimmageState(97, 1, 3), scrimmageState(20, 3, 12), scrimmageState(60, 4, 1)].map(withRules);
    const bad: string[] = [];
    for (const s of states) {
      for (const leaf of LEAVES) {
        for (const pre of PRESETS) {
          for (const formation of ["shotgun", "underCenter", "pistol", "empty", "heavy"]) {
            try {
              applyPlay(s, rules, play(s, { call: leaf, formation }, pre, s.spot + leaf.length));
            } catch (e) {
              bad.push(`${leaf}/${formation} vs ${pre} at ${s.spot}: ${(e as Error).message}`);
            }
          }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("every two-point leaf against every preset resolves and is accepted", () => {
    const t = withRules({ ...scrimmageState(98, 0, 0), phase: "try", down: 0, distance: 0, trySpots: { kick: 85, twoPoint: 98 } });
    const bad: string[] = [];
    for (const leaf of LEAVES) {
      for (const pre of PRESETS) {
        try {
          applyPlay(t, rules, play(t, { call: "goForTwo", twoPointPlay: leaf, formation: "shotgun" }, pre, 3));
        } catch (e) {
          bad.push(`${leaf} vs ${pre}: ${(e as Error).message}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("long field goals: make probability never NaN, never rises with distance past 40 yards, never above the capped value, 0 at 70+", () => {
    const pGood: { distance: number; p: number }[] = [];
    // spot = own yard line of the line of scrimmage; the kick is 8 yards behind it.
    for (let spot = 5; spot <= 75; spot++) {
      const s = scrimmageState(spot, 4, 10);
      for (let seed = 1; seed < 200; seed++) {
        const d = play(s, { call: "fieldGoal" }, null, seed).detail as { classProbabilities?: Record<string, number>; distance?: number };
        if (d.classProbabilities === undefined) continue;
        pGood.push({ distance: d.distance as number, p: d.classProbabilities["good"] as number });
        break;
      }
    }
    pGood.sort((a, b) => a.distance - b.distance);
    for (const x of pGood) expect(Number.isFinite(x.p), `${x.distance}`).toBe(true);
    const long = pGood.filter((x) => x.distance >= 40);
    for (let i = 1; i < long.length; i++) expect((long[i] as { p: number }).p, `${(long[i] as { distance: number }).distance}`).toBeLessThanOrEqual((long[i - 1] as { p: number }).p + 1e-12);
    const capAt = data.special.fieldGoals.capAt;
    const atCap = pGood.find((x) => x.distance === capAt)?.p ?? 1;
    for (const x of pGood.filter((y) => y.distance > capAt)) expect(x.p, `${x.distance}`).toBeLessThanOrEqual(atCap + 1e-12);
    for (const x of pGood.filter((y) => y.distance >= 70)) expect(x.p, `${x.distance}`).toBe(0);
    expect(pGood.some((x) => x.distance >= 70)).toBe(true);
  });

  it("a field goal from beyond any training attempt is never good, over 2,000 tries", () => {
    const s = scrimmageState(25, 4, 10); // kick from the own 17: 93 yards
    for (let seed = 1; seed <= 2000; seed++) {
      const p = play(s, { call: "fieldGoal" }, null, seed);
      if (p.kind === "fieldGoal") expect(p.good).toBe(false);
    }
  });

  it("a kickoff after a safety (from the 20) resolves and is accepted", () => {
    const s = withRules({ ...scrimmageState(20, 0, 0), phase: "kickoff", down: 0, distance: 0, safetyKick: true, score: { home: 0, away: 2 } });
    for (let seed = 1; seed <= 300; seed++) applyPlay(s, rules, play(s, { call: "kickoff" }, null, seed));
  });

  it("an onside kick is legal when trailing and when leading (2026), and is accepted", () => {
    for (const score of [{ home: 0, away: 7 }, { home: 7, away: 0 }]) {
      const s = withRules({ ...scrimmageState(35, 0, 0), phase: "kickoff", down: 0, distance: 0, score });
      for (let seed = 1; seed <= 100; seed++) applyPlay(s, rules, play(s, { call: "onsideKick" }, null, seed));
    }
  });

  it("a defensive foul on a try and on an untimed down are both reachable and accepted", () => {
    const t = withRules({ ...scrimmageState(98, 0, 0), phase: "try", down: 0, distance: 0, trySpots: { kick: 85, twoPoint: 98 } });
    const u = withRules({ ...scrimmageState(70, 1, 10), period: 2, clock: 0, untimedDown: true });
    for (const [label, s] of [["try", t], ["untimed", u]] as const) {
      let seen = 0;
      for (let seed = 1; seed <= 6000 && seen === 0; seed++) {
        const call = s.phase === "try" ? { call: "goForTwo", twoPointPlay: "shortPass", formation: "shotgun" } : { call: "deepPass", formation: "shotgun" };
        const p = play(s, call, "nickelCover1Blitz", seed);
        if ((p.fouls ?? []).some((f) => f.by === "defense")) {
          applyPlay(s, rules, p);
          seen++;
        }
      }
      expect(seen, label).toBeGreaterThan(0);
    }
  });
});
