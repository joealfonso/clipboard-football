// M1 step 5c: the playtest repro seeds as regression tests, one block per milestone
// (docs/specs/m1-step5c-playtest-fixes.md). The test-writer's spec checks are separate.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CoachView, KickView, PlayResult, Situation, SpecialTimeoutRole } from "../../packages/shared/src/types";
import { offenseShares, type CallerMasks } from "../../packages/sim/src/caller/offense";
import { fieldGoalMakeChance } from "../../packages/sim/src/caller/range";
import { specialTimeoutShare } from "../../packages/sim/src/loop/coach";
import { averageCoachFor, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { GameLoopError, playGame, prepareGame, snapCapAt, type GameKit, type GameRecord } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { REPO, loadGameData } from "../../scripts/game/data";
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
  const pFG = (s: Situation, r = range): number => offenseShares(s, data.engine.caller, { fieldGoals: r }).leaves.find((l) => l.call === "fieldGoal")?.p ?? 0;

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
    expect(offenseShares(sit({ yardLine100: 60 }), data.engine.caller).leaves.map((l) => l.p)).toEqual(offenseShares(sit({ yardLine100: 60 }), data.engine.caller, { fieldGoals: { ...range, maxDistance: 99, makePer10000: Array(82).fill(5000) } }).leaves.map((l) => l.p));
  });

  it("B1b: when a try is masked the other calls keep their relative fitted weights", () => {
    const s = sit({ yardLine100: 46, down: 2, quarter: 2, secondsLeftInHalf: 4, secondsLeftInGame: 1804 });
    const open = offenseShares(s, data.engine.caller, { fieldGoals: { ...range, maxDistance: 99, makePer10000: Array(82).fill(5000) } }).leaves;
    const masked = offenseShares(s, data.engine.caller, { fieldGoals: { ...range, maxDistance: 60 } }).leaves;
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

describe("C: the try choice reads the late score", () => {
  const trySit = (scoreDiff: number, quarter: number, secs: number, yardLine100 = 2): Situation => ({
    phase: "try", down: 1, yardsToGo: yardLine100, yardLine100, scoreDiff, quarter, secondsLeftInHalf: secs, secondsLeftInGame: secs, offenseTimeouts: 1, defenseTimeouts: 1,
  });
  const pXP = (s: Situation): number => offenseShares(s, data.engine.caller).leaves.find((l) => l.call === "extraPoint")?.p ?? 0;

  it("C2: league 2026 seed 543, a 2-point deficit at 0:00 goes for two, and so does the try replayed from a new spot", () => {
    expect(pXP(trySit(-2, 4, 0))).toBe(0);
    expect(pXP(trySit(-2, 4, 0, 1))).toBe(0); // replayed after roughing: half the distance, same rule
    const r = playGame(setupGame(league(2026), 2026, 543, () => coach), kit, Rng.fromSeed(543));
    for (const e of r.events) {
      if (e.t !== "play" || e.before.phase !== "try" || e.before.period !== 4 || e.before.clock > 120) continue;
      const d = e.before.score[e.before.possession] - e.before.score[e.before.possession === "home" ? "away" : "home"];
      if (d === -2) expect(e.offense.call).toBe("goForTwo");
    }
  });

  it("C: tied after the touchdown in the final 5:00 kicks; outside the late windows the fitted shares stand", () => {
    expect(pXP(trySit(0, 4, 250))).toBe(1);
    expect(pXP(trySit(0, 4, 60))).toBe(1);
    expect(pXP(trySit(0, 5, 250))).toBe(1); // overtime reads the late regulation cell with the same clock
    const early = offenseShares(trySit(-2, 3, 600 + 900), data.engine.caller).trace["oTry"];
    expect(early?.level).toBeGreaterThanOrEqual(0);
  });
});

describe("D: kickoff and try timeouts by period", () => {
  it("D2: league 2026 seed 1 has no timeout before a Q3 kickoff", () => {
    const r = playGame(setupGame(league(2026), 2026, 1, () => coach), kit, Rng.fromSeed(1));
    expect(r.events.filter((e) => e.t === "timeout" && e.before.phase === "kickoff" && e.before.period === 3)).toEqual([]);
  });

  it("D: TypeScript special-timeout rates equal the pipeline's golden views", () => {
    const golden = JSON.parse(readFileSync(join(REPO, "data/game/golden.json"), "utf8")) as { specialTimeouts: { view: KickView; role: SpecialTimeoutRole; p: number }[] };
    expect(golden.specialTimeouts.length).toBeGreaterThanOrEqual(100);
    const dims = data.config.dimensions;
    for (const g of golden.specialTimeouts) expect(specialTimeoutShare(g.role, 3, 0, data.tables, 1, { ...g.view, safetyKick: false }, dims)).toBeCloseTo(g.p, 12);
    // Q1-Q3 and the final 2:00 sit in different cells for at least one role.
    const at = (q: number, secs: number): number => specialTimeoutShare("kickReceiver", 3, 0, data.tables, 1, { quarter: q, secondsLeftInHalf: secs, secondsLeftInGame: secs, scoreDiff: 0, safetyKick: false }, dims);
    expect(at(1, 600 + 1800)).toBeLessThan(at(4, 60));
  });
});

describe("E: the trailing team uses its clock", () => {
  const trailerRunsOut = (r: GameRecord): string[] => {
    const out: string[] = [];
    for (const e of r.events) {
      if (e.t !== "runoff" || e.before.period < 4 || e.after.clock > 0) continue;
      const o = e.before.possession;
      const d = e.before.score[o] - e.before.score[o === "home" ? "away" : "home"];
      if (d >= -8 && d <= -1 && e.before.timeouts[o] >= 1) out.push(`${e.before.period} ${e.before.clock} trailing ${-d}`);
    }
    return out;
  };

  it("E2: seeds 93, 3 and 12 (league 2026): no 1-8 trailer holding a timeout lets a run-off end Q4 or OT", () => {
    for (const seed of [93, 3, 12]) expect(trailerRunsOut(playGame(setupGame(league(2026), 2026, seed, () => coach), kit, Rng.fromSeed(seed))), `seed ${seed}`).toEqual([]);
  });

  it("E2: the clock-out rule calls the timeout; a tied team or one down 9 may let it run", () => {
    const v = (scoreDiff: number, offenseTimeouts = 2): CoachView => ({
      phase: "scrimmage", down: 1, yardsToGo: 10, yardLine100: 12, scoreDiff, quarter: 4, secondsLeftInHalf: 8, secondsLeftInGame: 8, offenseTimeouts, defenseTimeouts: 1,
      clockRunning: true, playClock: 40, previousSnapKneel: false, previousSnapRestart: 0, beforeTimeout: false, offenseTimeoutsThisDeadBall: 0, defenseTimeoutsThisDeadBall: 0,
    });
    expect(coach.clockOut?.(v(-4))).toBe(true);
    expect(coach.clockOut?.(v(-8))).toBe(true);
    expect(coach.clockOut?.(v(0))).toBe(false);
    expect(coach.clockOut?.(v(-9))).toBe(false);
    expect(coach.clockOut?.(v(-4, 0))).toBe(false);
  });

  it("E2: seed 12 has no spike with the clock stopped, and a stopped clock masks the spike", () => {
    const r = playGame(setupGame(league(2026), 2026, 12, () => coach), kit, Rng.fromSeed(12));
    expect(r.events.filter((e) => e.t === "play" && e.play.kind === "spike" && !e.before.clockRunning)).toEqual([]);
    const s: Situation = { phase: "scrimmage", down: 1, yardsToGo: 10, yardLine100: 60, scoreDiff: 0, quarter: 4, secondsLeftInHalf: 71, secondsLeftInGame: 71, offenseTimeouts: 2, defenseTimeouts: 2 };
    const spike = (m: CallerMasks): number => offenseShares(s, data.engine.caller, m).leaves.find((l) => l.call === "spike")?.p ?? 0;
    expect(spike({ clockStopped: true })).toBe(0);
  });
});
