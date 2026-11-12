// B12: rejected inputs leave the state untouched. B13: the invariant checker.

import { describe, expect, it } from "vitest";
import type { PlayResult } from "../../../shared/src/types";
import { Rng } from "../../src/rng";
import { applyPlay, callTimeout, runPreSnap, startOvertime } from "../../src/game/machine";
import { stateViolations, transitionViolations } from "../../src/game/invariants";
import type { GameState } from "../../src/game/types";
import { defenseEnd, expectRule, kickoffState, offenseEnd, real, scrimmage, tryState } from "./helpers";

const R = real();

function frozenCopy<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

describe("rejected plays (B12)", () => {
  const cases: [string, GameState, PlayResult, string][] = [
    ["a punt during a try", tryState(), { kind: "punt", seconds: 5, crossedLine: true, touchedByReceivers: false, end: defenseEnd(60) }, "wrongPhase"],
    ["a kickoff in scrimmage", scrimmage(), { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" }, "wrongPhase"],
    ["a run during a kickoff", kickoffState(), { kind: "run", seconds: 5, end: offenseEnd(40) }, "wrongPhase"],
    ["an extra point in scrimmage", scrimmage(), { kind: "extraPoint", seconds: 0, good: true }, "wrongPhase"],
    ["a spot past the back of an end zone", scrimmage(), { kind: "run", seconds: 5, end: offenseEnd(111) }, "badPlay"],
    ["a half-yard spot", scrimmage(), { kind: "run", seconds: 5, end: offenseEnd(30.5) }, "badPlay"],
    ["negative seconds", scrimmage(), { kind: "run", seconds: -1, end: offenseEnd(30) }, "badPlay"],
    ["incomplete and out of bounds", scrimmage(), { kind: "pass", seconds: 5, incomplete: true, outOfBounds: true, end: offenseEnd(25) }, "contradictoryPlay"],
    ["incomplete at a spot downfield", scrimmage(), { kind: "pass", seconds: 5, incomplete: true, end: offenseEnd(40) }, "contradictoryPlay"],
    ["a touchdown short of the goal line", scrimmage(), { kind: "run", seconds: 5, touchdown: true, end: offenseEnd(97) }, "contradictoryPlay"],
    ["a turnover kept by the offense", scrimmage(), { kind: "pass", seconds: 5, turnover: "interception", end: offenseEnd(40) }, "contradictoryPlay"],
    ["a field goal kicked from beyond the line", scrimmage({ spot: 70 }), { kind: "fieldGoal", seconds: 4, good: true, kickSpot: 75 }, "contradictoryPlay"],
    ["an unknown penalty", scrimmage(), { kind: "run", seconds: 5, end: offenseEnd(30), fouls: [{ penalty: "illegalJuggling", by: "offense" }] }, "unknownPenalty"],
    ["a defensive penalty called on the offense", scrimmage(), { kind: "run", seconds: 5, end: offenseEnd(30), fouls: [{ penalty: "defensiveHolding", by: "offense" }] }, "badPlay"],
    ["a pre-snap foul on a live play", scrimmage(), { kind: "run", seconds: 5, end: offenseEnd(30), fouls: [{ penalty: "falseStart", by: "offense" }] }, "badPlay"],
    ["a noPlay that uses clock", scrimmage(), { kind: "noPlay", seconds: 3, fouls: [{ penalty: "falseStart", by: "offense" }] }, "contradictoryPlay"],
    ["fouls by both teams with a change of possession", scrimmage(), { kind: "pass", seconds: 5, turnover: "interception", end: defenseEnd(40), fouls: [{ penalty: "offensiveHolding", by: "offense" }, { penalty: "defensiveHolding", by: "defense" }] }, "unsupportedFouls"],
    ["fouls by both teams on a punt", scrimmage({ down: 4 }), { kind: "punt", seconds: 5, crossedLine: true, touchedByReceivers: false, end: defenseEnd(60), fouls: [{ penalty: "offensiveHolding", by: "offense" }, { penalty: "defensiveHolding", by: "defense" }] }, "unsupportedFouls"],
  ];

  it.each(cases)("%s", (_name, s, p, code) => {
    const before = frozenCopy(s);
    expectRule(() => applyPlay(s, R, p), code as never);
    expect(s).toEqual(before);
  });

  it("every input to a final state is rejected", () => {
    const f: GameState = { ...scrimmage(), phase: "final", down: 0, distance: 0, result: { reason: "regulation", winner: "home" } };
    expectRule(() => applyPlay(f, R, { kind: "run", seconds: 5, end: offenseEnd(30) }), "gameOver");
    expectRule(() => runPreSnap(f, R, 0), "gameOver");
    expectRule(() => callTimeout(f, R, "home"), "gameOver");
    expectRule(() => startOvertime(f, R, Rng.fromSeed(1)), "gameOver");
  });

  it("an untyped error never escapes: every rejection is a GameRuleError", () => {
    expectRule(() => applyPlay(scrimmage(), R, { kind: "fieldGoal", seconds: 4, good: true, kickSpot: 0 }), "badPlay");
  });
});

describe("invariant checker (B13)", () => {
  const good = scrimmage();

  it("a good state has no violations", () => {
    expect(stateViolations(good, R)).toEqual([]);
    expect(stateViolations(tryState(), R)).toEqual([]);
    expect(stateViolations(kickoffState(), R)).toEqual([]);
  });

  const badStates: [string, Partial<GameState>][] = [
    ["down 0 in scrimmage", { down: 0 }],
    ["down 5", { down: 5 }],
    ["distance 0", { distance: 0 }],
    ["distance past the goal", { spot: 95, distance: 10, goalToGo: false }],
    ["goal to go with the wrong distance", { spot: 95, distance: 4, goalToGo: true }],
    ["scrimmage spot on a goal line", { spot: 0, distance: 10 }],
    ["spot past the field", { spot: 101 }],
    ["negative clock", { clock: -1 }],
    ["clock longer than the period", { clock: R.game.periodSeconds + 1 }],
    ["clock running at 0:00", { clock: 0, clockRunning: true }],
    ["too many timeouts", { timeouts: { home: R.timeouts.perHalf + 1, away: 3 } }],
    ["negative timeouts", { timeouts: { home: -1, away: 3 } }],
    ["final without a result", { phase: "final", down: 0, distance: 0 }],
  ];
  it.each(badStates)("flags %s", (_n, over) => {
    expect(stateViolations({ ...good, ...over }, R).length).toBeGreaterThan(0);
  });

  it("flags a down on a try or a kickoff", () => {
    expect(stateViolations({ ...tryState(), down: 1 }, R).length).toBeGreaterThan(0);
    expect(stateViolations({ ...kickoffState(), down: 1, distance: 10 }, R).length).toBeGreaterThan(0);
  });

  const badTransitions: [string, GameState, GameState][] = [
    ["clock rising within a period", { ...good, clock: good.clock - 10 }, good],
    ["score falling", { ...good, score: { home: 7, away: 0 } }, { ...good, score: { home: 6, away: 0 } }],
    ["an illegal score change", { ...good, score: { home: 4, away: 0 } }, { ...good, score: { home: 8, away: 0 } }],
    ["both scores changing", good, { ...good, score: { home: 6, away: 6 } }],
    ["timeouts rising within a half", { ...good, timeouts: { home: 2, away: 3 } }, good],
    ["play count falling", { ...good, playCount: 5 }, good],
  ];
  it.each(badTransitions)("flags %s", (_n, prev, next) => {
    expect(transitionViolations(prev, next, R).length).toBeGreaterThan(0);
  });

  it("flags any transition out of a final state", () => {
    const f: GameState = { ...good, phase: "final", down: 0, distance: 0, result: { reason: "regulation", winner: "home" } };
    expect(transitionViolations(f, f, R)).toContain("final state is absorbing");
  });

  it("flags a tied postseason result", () => {
    const f: GameState = { ...scrimmage({}, R, "postseason"), phase: "final", down: 0, distance: 0, result: { reason: "overtimeExpired", winner: null } };
    expect(stateViolations(f, R).length).toBeGreaterThan(0);
  });

  it("a good transition is not flagged", () => {
    const next = applyPlay(good, R, { kind: "run", seconds: 5, end: offenseEnd(30) });
    expect(transitionViolations(good, next, R)).toEqual([]);
  });

  it("the machine throws a typed error naming the violation instead of returning a bad state", () => {
    const bad = { ...good, timeouts: { home: 9, away: 3 } };
    expectRule(() => applyPlay(bad, R, { kind: "run", seconds: 5, end: offenseEnd(30) }), "invariantViolation");
  });
});
