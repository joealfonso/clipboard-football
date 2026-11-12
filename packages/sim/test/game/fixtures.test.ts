// C10: rule changes are data edits. Each fixture changes values in the rule set and the
// machine follows them with no code change.

import { describe, expect, it } from "vitest";
import { Rng } from "../../src/rng";
import { callTimeout, newGame, runPreSnap, startOvertime } from "../../src/game/machine";
import type { GameState } from "../../src/game/types";
import { fixtureRules } from "../support/rules";
import { defenseEnd, expectRule, kickoffState, play, run, scrimmage } from "./helpers";

describe("rule changes are data edits (C10)", () => {
  it("quarter length", () => {
    const rules = fixtureRules({ game: { periodSeconds: 720, regulationPeriods: 4, periodsPerHalf: 2 } });
    const s = newGame(rules, { gameType: "regularSeason", seed: 1, rulesHash: "f" }, Rng.fromSeed(1));
    expect(s.clock).toBe(720);
    const q2 = play(scrimmage({ clock: 3 }, rules), run(30, 5), {}, rules);
    expect([q2.period, q2.clock]).toEqual([2, 720]);
  });

  it("timeouts per half", () => {
    const rules = fixtureRules({ timeouts: { perHalf: 1, perTeamPerDeadBall: 1 } });
    const s = newGame(rules, { gameType: "regularSeason", seed: 1, rulesHash: "f" }, Rng.fromSeed(1));
    expect(s.timeouts).toEqual({ home: 1, away: 1 });
    const t = callTimeout({ ...s, phase: "scrimmage", down: 1, distance: 10, spot: 25 }, rules, "home");
    expectRule(() => callTimeout(play(t, run(27), {}, rules), rules, "home"), "noTimeouts");
  });

  it("two-minute warning time", () => {
    const rules = fixtureRules({ clock: { twoMinuteWarningSeconds: 180 } });
    const s = runPreSnap(scrimmage({ period: 4, clock: 190, clockRunning: true }, rules), rules, 20);
    expect([s.clock, s.twoMinuteWarningDone]).toEqual([180, true]);
  });

  it("every kickoff and touchback spot", () => {
    const rules = fixtureRules({
      kickoff: {
        spot: 30,
        safetyKickSpot: 15,
        touchbackAfterLandingZone: 22,
        touchbackFromEndZone: 30,
        midfieldKickSpot: 45,
        touchbackFromMidfield: 18,
        shortOrOutOfBoundsYards: 20,
        safetyKickShortOrOutOfBoundsYards: 35,
      },
      punt: { touchbackSpot: 25, fairCatchAllowed: true },
      touchback: { scrimmageSpot: 24 },
      fieldGoal: { missedMinimumSpot: 25 },
    });
    const k = (over: Partial<GameState>, outcome: "touchbackEndZone" | "touchbackLandingZone" | "short") =>
      play(kickoffState(over, rules), { kind: "kickoff", seconds: 0, outcome }, {}, rules).spot;
    expect(newGame(rules, { gameType: "regularSeason", seed: 1, rulesHash: "f" }, Rng.fromSeed(1)).spot).toBe(30);
    expect(k({ spot: 30 }, "touchbackEndZone")).toBe(30);
    expect(k({ spot: 30 }, "touchbackLandingZone")).toBe(22);
    expect(k({ spot: 45 }, "touchbackEndZone")).toBe(18);
    expect(k({ spot: 30 }, "short")).toBe(50);
    expect(k({ spot: 15, safetyKick: true }, "short")).toBe(50);
    const safety = play(scrimmage({ spot: 2 }, rules), { kind: "sack", seconds: 4, end: { spot: -1, possession: "offense" } }, {}, rules);
    expect(safety.spot).toBe(15);
    const punt = play(scrimmage({ spot: 40, down: 4 }, rules), { kind: "punt", seconds: 5, crossedLine: true, touchedByReceivers: false, end: defenseEnd(105) }, {}, rules);
    expect(punt.spot).toBe(25);
    const pick = play(scrimmage({ spot: 60 }, rules), { kind: "pass", seconds: 5, turnover: "interception", end: defenseEnd(103) }, {}, rules);
    expect(pick.spot).toBe(24);
    const miss = play(scrimmage({ spot: 90, down: 4, goalToGo: true }, rules), { kind: "fieldGoal", seconds: 5, good: false, kickSpot: 83 }, {}, rules);
    expect(miss.spot).toBe(25);
  });

  it("the older modified sudden death: a first-possession touchdown ends it, a field goal does not", () => {
    const rules = fixtureRules({
      overtime: { regularSeason: { guaranteedPossession: false, firstPossessionEndsOn: ["touchdown"], periodSeconds: 600 } },
    });
    const end = play(scrimmage({ period: 4, clock: 3, score: { home: 7, away: 7 }, twoMinuteWarningDone: true }, rules), run(30, 5), {}, rules);
    const k = startOvertime(end, rules, Rng.fromSeed(2));
    const first = k.overtime?.firstTeam;
    const r = play(k, { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" }, {}, rules);
    const atGoal = play(r, run(95, 5), {}, rules);
    expect(play(atGoal, run(101, 5), {}, rules).result).toEqual({ reason: "overtimeScore", winner: first });
    const fgd = play(atGoal, { kind: "fieldGoal", seconds: 4, good: true, kickSpot: 88 }, {}, rules);
    expect(fgd.result).toBeNull();
  });

  it("the same play under the 2026 rules does not end on a first-possession touchdown", () => {
    const rules = fixtureRules({});
    const end = play(scrimmage({ period: 4, clock: 3, score: { home: 7, away: 7 }, twoMinuteWarningDone: true }, rules), run(30, 5), {}, rules);
    const r = play(startOvertime(end, rules, Rng.fromSeed(2)), { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" }, {}, rules);
    expect(play(play(r, run(95, 5), {}, rules), run(101, 5), {}, rules).phase).toBe("try");
  });

  it("an overtime that allows more than one regular-season period and different timeouts", () => {
    const rules = fixtureRules({ overtime: { regularSeason: { maxPeriods: 2, timeoutsPerHalf: 1, periodsPerCoinToss: 2 } } });
    const end = play(scrimmage({ period: 4, clock: 3, score: { home: 7, away: 7 }, twoMinuteWarningDone: true }, rules), run(30, 5), {}, rules);
    const k = startOvertime(end, rules, Rng.fromSeed(2));
    expect(k.timeouts).toEqual({ home: 1, away: 1 });
    const r = play(k, { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" }, {}, rules);
    const p2 = play({ ...r, clock: 3, twoMinuteWarningDone: true }, run(40, 5), {}, rules);
    expect([p2.phase, p2.period]).toEqual(["kickoff", 6]);
    expect(play({ ...play(p2, { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" }, {}, rules), clock: 3, twoMinuteWarningDone: true }, run(40, 5), {}, rules).result).toEqual({ reason: "overtimeExpired", winner: null });
  });
});
