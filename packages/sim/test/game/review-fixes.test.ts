// Regression tests for the step 3 code review flags (R1 to R5, L1 to L3) and test-writer T3.

import { describe, expect, it } from "vitest";
import { Rng } from "../../src/rng";
import { callTimeout, startOvertime } from "../../src/game/machine";
import { stateViolations } from "../../src/game/invariants";
import { fixtureRules } from "../support/rules";
import { defenseEnd, expectRule, incomplete, offenseEnd, overtimeKickoff, play, real, run, scrimmage } from "./helpers";

const R = real();
const falseStart = { kind: "noPlay" as const, seconds: 0, fouls: [{ penalty: "falseStart", by: "offense" as const }] };
const encroachment = { kind: "noPlay" as const, seconds: 0, fouls: [{ penalty: "encroachment", by: "defense" as const }] };
const decline = { penalty: { kind: "decline" as const } };
const accept = { penalty: { kind: "accept" as const, foul: 0 } };

describe("declined fouls are timed as fouls (R1, Rule 4-3-2 (e))", () => {
  it("Q4 1:40, in-bounds run, offensive holding declined: clock stopped until the snap", () => {
    const s0 = scrimmage({ period: 4, clock: 105, twoMinuteWarningDone: true, clockRunning: true });
    const s = play(s0, run(30, 5, { fouls: [{ penalty: "offensiveHolding", by: "offense" }] }), decline);
    expect([s.clock, s.spot, s.clockRunning]).toEqual([100, 30, false]);
  });

  it("Q1, clock stopped, false start declined: clock still stopped", () => {
    expect(play(scrimmage({ clockRunning: false }), falseStart, decline).clockRunning).toBe(false);
  });

  it("Q1, clock running, false start declined: clock still running", () => {
    expect(play(scrimmage({ clockRunning: true }), falseStart, decline).clockRunning).toBe(true);
  });
});

describe("a pre-snap foul does not use up an untimed down (R2, Rule 4-8-2)", () => {
  it("Q2 0:03, defensive foul earns the untimed down, encroachment on it, the untimed down still happens", () => {
    const s0 = scrimmage({ period: 2, clock: 3, twoMinuteWarningDone: true });
    const owed = play(s0, incomplete(s0, 6, [{ penalty: "defensivePassInterference", by: "defense", spot: 50 }]), accept);
    expect(owed.untimedDown).toBe(true);
    const s = play(owed, encroachment);
    expect([s.period, s.clock, s.untimedDown, s.phase, s.spot]).toEqual([2, 0, true, "scrimmage", 55]);
    expect(play(s, run(60, 5)).period).toBe(3);
  });
});

describe("a timeout spent on the run-off counts for the dead ball (R3, T3)", () => {
  const late = scrimmage({ period: 4, clock: 90, clockRunning: true, twoMinuteWarningDone: true });

  it("charges the dead-ball timeout, so a second one is rejected", () => {
    const s = play(late, falseStart, { runoffTimeout: true });
    expect(s.timeoutsThisDeadBall.home).toBe(1);
    expectRule(() => callTimeout(s, R, "home"), "timeoutNotAllowed");
    expect(callTimeout(s, R, "away").timeouts.away).toBe(R.timeouts.perHalf - 1);
  });

  it("is rejected when the offense has none", () => {
    expectRule(() => play({ ...late, timeouts: { home: 0, away: 3 } }, falseStart, { runoffTimeout: true }), "noTimeouts");
  });

  it("the invariant checker flags more dead-ball timeouts than allowed", () => {
    expect(stateViolations({ ...late, timeoutsThisDeadBall: { home: 2, away: 0 } }, R).length).toBeGreaterThan(0);
  });
});

describe("a double foul extends only a period that ends a half (R4, Rule 4-8-2 (h))", () => {
  const double = run(30, 6, { fouls: [{ penalty: "offensiveHolding", by: "offense" }, { penalty: "defensiveHolding", by: "defense" }] });

  it.each([1, 3])("period %i is not extended", (period) => {
    const s = play(scrimmage({ period, clock: 3 }), double);
    expect([s.period, s.untimedDown]).toEqual([period + 1, false]);
  });

  it.each([2, 4])("period %i is extended", (period) => {
    const s = play(scrimmage({ period, clock: 3, twoMinuteWarningDone: true }), double);
    expect([s.period, s.clock, s.untimedDown]).toEqual([period, 0, true]);
  });
});

describe("possession gained and lost within one down (R5, Rule 16-1-5 (b))", () => {
  const fumbledBack = { kind: "pass" as const, seconds: 7, defensePossessedDuringPlay: true, end: offenseEnd(40) };

  it("counts as the second team possessing in overtime", () => {
    const k = overtimeKickoff("regularSeason");
    const r = play(k, { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" });
    const s = play(r, fumbledBack);
    expect([s.possession, s.overtime?.secondTeamPossessed, s.overtime?.suddenDeath]).toEqual([k.overtime?.firstTeam, true, true]);
  });

  it("stops the clock and gives the offense a new series", () => {
    const s = play(scrimmage({ spot: 35, down: 3, distance: 8 }), fumbledBack);
    expect([s.down, s.distance, s.clockRunning, s.playClock]).toEqual([1, 10, false, R.clock.playClockAfterStoppage]);
  });

  it("cannot happen on an incomplete pass", () => {
    const s0 = scrimmage();
    const p = { kind: "pass" as const, seconds: 5, incomplete: true, defensePossessedDuringPlay: true, end: offenseEnd(s0.spot) };
    expectRule(() => play(s0, p), "contradictoryPlay");
  });

  it("makes fouls by both teams unsupported", () => {
    const p = { ...fumbledBack, fouls: [{ penalty: "offensiveHolding", by: "offense" as const }, { penalty: "defensiveHolding", by: "defense" as const }] };
    expectRule(() => play(scrimmage(), p), "unsupportedFouls");
  });
});

describe("canEndTied is read from data (L1)", () => {
  it("a format that cannot end tied plays on past its period limit", () => {
    const rules = fixtureRules({ overtime: { postseason: { maxPeriods: 1, canEndTied: false } } });
    const k = overtimeKickoff("postseason", rules);
    const r = play(k, { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" }, {}, rules);
    const s = play({ ...r, clock: 3 }, run(40, 5), {}, rules);
    expect([s.phase, s.period, s.result]).toEqual(["scrimmage", k.period + 1, null]);
  });

  it("the same limit with a leader ends the game", () => {
    const rules = fixtureRules({ overtime: { postseason: { maxPeriods: 1, canEndTied: false } } });
    const k = overtimeKickoff("postseason", rules);
    const r = play(k, { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" }, {}, rules);
    const fg = play(play(r, run(80, 5), {}, rules), { kind: "fieldGoal", seconds: 4, good: true, kickSpot: 73 }, {}, rules);
    const r2 = play(fg, { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" }, {}, rules);
    const s = play({ ...r2, clock: 3 }, run(r2.spot + 2, 5), {}, rules);
    expect(s.result).toEqual({ reason: "overtimeExpired", winner: k.overtime?.firstTeam });
  });

  it("a regular-season format that cannot end tied goes to another toss instead of a tie", () => {
    const rules = fixtureRules({ overtime: { regularSeason: { canEndTied: false } } });
    const k = overtimeKickoff("regularSeason", rules);
    const r = play(k, { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" }, {}, rules);
    const s = play({ ...r, clock: 3, twoMinuteWarningDone: true }, run(40, 5), {}, rules);
    expect([s.phase, s.result]).toEqual(["overtimeToss", null]);
    expect(startOvertime(s, rules, Rng.fromSeed(4)).period).toBe(k.period + 1);
  });
});

describe("invariant checker additions (L2)", () => {
  it("flags an untimed down owed with time left", () => {
    expect(stateViolations(scrimmage({ untimedDown: true, clock: 30 }), R).length).toBeGreaterThan(0);
  });

  it("flags a running clock outside scrimmage", () => {
    expect(stateViolations({ ...scrimmage(), phase: "kickoff", down: 0, distance: 0, spot: 35, clockRunning: true }, R).length).toBeGreaterThan(0);
  });

  it("flags goal-to-go unset when the line to gain is the goal line", () => {
    expect(stateViolations(scrimmage({ spot: 95, distance: 5, goalToGo: false }), R).length).toBeGreaterThan(0);
  });
});

describe("defensive time-conserving foul after the warning (L3, Rule 4-7-1, Item 2)", () => {
  const late = scrimmage({ period: 4, clock: 90, clockRunning: true, twoMinuteWarningDone: true });

  it("restarts on the ready signal with a 40-second play clock", () => {
    const s = play(late, encroachment);
    expect([s.clock, s.clockRunning, s.playClock, s.spot]).toEqual([90, true, R.clock.playClockAfterPlay, 30]);
  });

  it("starts on the snap when the offense chooses", () => {
    expect(play(late, encroachment, { clockOnSnap: true }).clockRunning).toBe(false);
  });

  it("not before the warning, where the snap-start window still holds the clock", () => {
    const s = play(scrimmage({ period: 4, clock: 250, clockRunning: true }), encroachment);
    expect(s.clockRunning).toBe(false);
  });

  it("a defensive foul during a live play keeps the usual window rule", () => {
    const s = play(late, run(30, 5, { fouls: [{ penalty: "defensiveOffside", by: "defense" }] }), accept);
    expect(s.clockRunning).toBe(false);
  });
});

describe("play clock after a stop that is not administrative (T1)", () => {
  it("an incompletion leaves the 40-second play clock; a turnover leaves 25", () => {
    const s0 = scrimmage();
    expect(play(s0, incomplete(s0)).playClock).toBe(R.clock.playClockAfterPlay);
    expect(play(s0, { kind: "pass", seconds: 5, turnover: "interception", end: defenseEnd(50) }).playClock).toBe(R.clock.playClockAfterStoppage);
  });
});
