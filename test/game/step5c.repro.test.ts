// M1 step 5c: the playtest repro seeds as regression tests, one block per milestone
// (docs/specs/m1-step5c-playtest-fixes.md). The test-writer's spec checks are separate.

import { describe, expect, it } from "vitest";
import type { PlayResult, Situation } from "../../packages/shared/src/types";
import { offenseShares } from "../../packages/sim/src/caller/offense";
import { fieldGoalMakeChance } from "../../packages/sim/src/caller/range";
import { averageCoachFor, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { GameLoopError, playGame, prepareGame, snapCapAt, type GameKit } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { loadGameData } from "../../scripts/game/data";
import { digest } from "../../scripts/game/metrics";
import { simGame } from "../../scripts/game/sim-game";

const data = loadGameData();
const kit = prepareGame(data);
const coach = averageCoachFor(data);
const league = (seed: number) => leagueFromSeed(data, seed).teams;

describe("A: postseason overtime finishes", () => {
  it("A1: league 4242 seed 599, postseason, returns a record with a winner, the same twice", () => {
    const teams = league(4242);
    const play = () => playGame(setupGame(teams, 4242, 599, () => coach, "postseason"), kit, Rng.fromSeed(599));
    const a = play();
    expect(a.final.phase).toBe("final");
    expect(a.final.result?.winner).not.toBeNull();
    expect(a.final.period).toBeGreaterThan(4);
    expect(digest(play())).toBe(digest(a));
  });

  it("A4: the cap grows by a regulation period's share per overtime period only", () => {
    expect(snapCapAt(1, 260, 4)).toBe(260);
    expect(snapCapAt(4, 260, 4)).toBe(260);
    expect(snapCapAt(5, 260, 4)).toBe(325);
    expect(snapCapAt(8, 260, 4)).toBe(520);
  });

  it("A4: a loop that makes no progress still throws snapCap", () => {
    // Every scrimmage snap is a 0-second incompletion: downs turn over, the clock never moves.
    const stuck: GameKit = {
      data,
      resolve: (s, o, d, p, rng) => {
        const r = kit.resolve(s, o, d, p, rng);
        if (s.phase !== "scrimmage") return r;
        return { kind: "pass", seconds: 0, incomplete: true, end: { spot: s.spot, possession: "offense" } } as PlayResult;
      },
    };
    let err: unknown;
    try {
      playGame(setupGame(league(2026), 2026, 1, () => coach), stuck, Rng.fromSeed(1));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(GameLoopError);
    expect((err as GameLoopError).code).toBe("snapCap");
  });

  it("A5: --game-type postseason prints the game type on the header; the default is regular", () => {
    const post = simGame(["--game-type", "postseason", "--league-seed", "4242", "--seed", "599"]);
    expect(post.split("\n")[1]).toContain("postseason");
    expect(post).toContain("FINAL:");
    expect(simGame(["--seed", "3"])).toBe(simGame(["--seed", "3", "--game-type", "regular"]));
    expect(simGame(["--seed", "3"]).split("\n")[1]).toContain("regularSeason");
    expect(() => simGame(["--game-type", "playoff"])).toThrow(/--game-type/);
  });
});

describe("B: field goal range", () => {
  const fg = data.engine.special.fieldGoals;
  const range = { minDistance: fg.minDistance, maxDistance: fg.maxDistance, makePer10000: fg.makePer10000, kickDepth: fg.kickDepth, endZoneYards: data.engine.rules.field.endZoneYards };
  const sit = (o: Partial<Situation>): Situation => ({
    phase: "scrimmage", down: 4, yardsToGo: 8, yardLine100: 50, scoreDiff: 0, quarter: 1, secondsLeftInHalf: 1647, secondsLeftInGame: 3447, offenseTimeouts: 3, defenseTimeouts: 3, ...o,
  });
  const pFG = (s: Situation, r = range): number => offenseShares(s, data.engine.caller, r).leaves.find((l) => l.call === "fieldGoal")?.p ?? 0;

  it("B1b: no try where the engine's make chance is 0, and the mask follows maxDistance in the data", () => {
    expect(fieldGoalMakeChance(52, range)).toBe(0); // 70 yards: the designed zero
    expect(fieldGoalMakeChance(51, range)).toBeGreaterThan(0);
    for (const yl of [52, 60, 70, 85]) for (const down of [1, 2, 3, 4]) expect(pFG(sit({ yardLine100: yl, down, quarter: 2, secondsLeftInHalf: 4, secondsLeftInGame: 1804 })), `yl ${yl} down ${down}`).toBe(0);
    // A fixture with maxDistance 60: a 62-yard try (opp 44) is masked; with the real data it is not.
    const short = { ...range, maxDistance: 60 };
    const s = sit({ yardLine100: 44, quarter: 2, secondsLeftInHalf: 4, secondsLeftInGame: 1804 });
    expect(pFG(s)).toBeGreaterThan(0);
    expect(pFG(s, short)).toBe(0);
    // Without a range the shares are the fitted tables' alone (the pipeline's mirror).
    expect(offenseShares(sit({ yardLine100: 60 }), data.engine.caller).leaves.map((l) => l.p)).toEqual(offenseShares(sit({ yardLine100: 60 }), data.engine.caller, { ...range, maxDistance: 99, makePer10000: Array(82).fill(5000) }).leaves.map((l) => l.p));
  });

  it("B1b: when a try is masked the other calls keep their relative fitted weights", () => {
    const s = sit({ yardLine100: 46, down: 2, quarter: 2, secondsLeftInHalf: 4, secondsLeftInGame: 1804 });
    const open = offenseShares(s, data.engine.caller, { ...range, maxDistance: 99, makePer10000: Array(82).fill(5000) }).leaves;
    const masked = offenseShares(s, data.engine.caller, { ...range, maxDistance: 60 }).leaves;
    const kept = open.filter((l) => l.call !== "fieldGoal");
    const total = kept.reduce((a, l) => a + l.p, 0);
    for (const l of kept) expect(masked.find((m) => m.call === l.call)?.p ?? 0).toBeCloseTo(l.p / total, 12);
  });

  it("B2: league 2026 seed 10 (80-yard try at Q2 0:04) and seed 30 (68 yards at midfield) no longer try those kicks", () => {
    // Seed 10, ev 139: 2nd and 10 at the own 38 (yl 62) with 0:04 left in Q2: masked.
    expect(pFG(sit({ down: 2, yardsToGo: 10, yardLine100: 62, quarter: 2, secondsLeftInHalf: 4, secondsLeftInGame: 1804 }))).toBe(0);
    // Seed 30, ev 11: 4th and 8 at midfield, Q1 12:27, 0-0: the opp 42-50 cell, not the pooled opp 36-50.
    expect(pFG(sit({ secondsLeftInHalf: 1647, secondsLeftInGame: 3447 }))).toBeLessThan(0.01);
    for (const seed of [10, 30]) {
      const r = playGame(setupGame(league(2026), 2026, seed, () => coach), kit, Rng.fromSeed(seed));
      const long = r.events.filter((e) => e.t === "play" && e.play.kind === "fieldGoal" && 100 - e.play.kickSpot + 10 >= (seed === 10 ? 70 : 68));
      expect(long, `seed ${seed}`).toEqual([]);
    }
  });
});
