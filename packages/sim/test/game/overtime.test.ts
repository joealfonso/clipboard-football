// C8, C9, C11: regular-season and postseason overtime, and every way a game ends.

import { describe, expect, it } from "vitest";
import { Rng } from "../../src/rng";
import { callTimeout, runPreSnap, startOvertime } from "../../src/game/machine";
import type { GameState } from "../../src/game/types";
import { defenseEnd, expectRule, overtimeKickoff, play, real, run, scrimmage } from "./helpers";

const R = real();
const td = (s: GameState) => play(s, run(101, 6, { touchdown: true }));
const fg = (s: GameState) => play(s, { kind: "fieldGoal", seconds: 5, good: true, kickSpot: s.spot - 7 });
const touchback = (s: GameState) => play(s, { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" });
const xp = (s: GameState, good = true) => play(s, { kind: "extraPoint", seconds: 0, good });
const punt = (s: GameState) => play(s, { kind: "punt", seconds: 6, crossedLine: true, touchedByReceivers: false, end: defenseEnd(s.spot + 40) });
const advance = (s: GameState, to: number) => play(s, run(to, 5));

describe("regular-season overtime (C8)", () => {
  const k = overtimeKickoff("regularSeason");
  const first = k.overtime?.firstTeam as string;
  const second = k.overtime?.secondTeam as string;
  const fmt = R.overtime.regularSeason;

  it("starts with a toss: period, clock, timeouts and the kickoff", () => {
    expect([k.period, k.clock, k.phase, k.timeouts.home, k.timeouts.away]).toEqual([R.game.regulationPeriods + 1, fmt.periodSeconds, "kickoff", fmt.timeoutsPerHalf, fmt.timeoutsPerHalf]);
    expect(k.possession).toBe(second);
    expect(k.toss.winner).toBeDefined();
  });

  it("the toss is one draw from the Rng", () => {
    const end = { ...k, phase: "overtimeToss" as const, period: R.game.regulationPeriods, overtime: null };
    const rng = Rng.fromSeed(3);
    const probe = Rng.fromSeed(3);
    probe.nextUint32();
    startOvertime(end, R, rng);
    expect(rng.getState()).toEqual(probe.getState());
  });

  it("a first-possession field goal does not end it; the second team gets the ball", () => {
    const s = fg(advance(touchback(k), 75));
    expect(s.phase).toBe("kickoff");
    expect(s.possession).toBe(first);
  });

  it("then a field goal by the second team ties it and the next score wins", () => {
    const s = fg(advance(touchback(fg(advance(touchback(k), 75))), 75));
    expect(s.phase).toBe("kickoff");
    expect(s.overtime?.suddenDeath).toBe(true);
    const done = fg(advance(touchback(s), 80));
    expect(done.result).toEqual({ reason: "overtimeScore", winner: first });
  });

  it("then a second-team touchdown wins at once, with no try", () => {
    const s = td(advance(touchback(fg(advance(touchback(k), 75))), 95));
    expect(s.result).toEqual({ reason: "overtimeScore", winner: second });
  });

  it("then a second-team punt ends it for the first team", () => {
    const s = punt(touchback(fg(advance(touchback(k), 75))));
    expect(s.result).toEqual({ reason: "overtimeScore", winner: first });
  });

  it("a first-possession touchdown does not end it; the try is played", () => {
    const s = td(advance(touchback(k), 95));
    expect(s.phase).toBe("try");
    const after = xp(s);
    expect([after.phase, after.possession]).toEqual(["kickoff", first]);
  });

  it("the second team answering with a touchdown and the kick ties it; then sudden death", () => {
    const s = xp(td(advance(touchback(xp(td(advance(touchback(k), 95)))), 95)));
    expect([s.phase, s.overtime?.suddenDeath]).toEqual(["kickoff", true]);
  });

  it("the second team answering with a touchdown and a two-point try wins", () => {
    const t = td(advance(touchback(xp(td(advance(touchback(k), 95)))), 95));
    expect(t.phase).toBe("try");
    const s = play(t, { kind: "twoPoint", seconds: 4, end: { spot: 101, possession: "offense" } });
    expect(s.result).toEqual({ reason: "overtimeScore", winner: second });
  });

  it("a safety by the kicking team on the first possession wins for the kicking team", () => {
    const s = play(advance(touchback(k), 5), { kind: "sack", seconds: 5, end: { spot: -1, possession: "offense" } });
    expect(s.result).toEqual({ reason: "overtimeScore", winner: second });
  });

  it("a defensive touchdown on the first possession wins at once", () => {
    const s = play(touchback(k), { kind: "pass", seconds: 8, turnover: "interception", end: defenseEnd(-1) });
    expect(s.result).toEqual({ reason: "overtimeScore", winner: second });
  });

  it("a turnover on the first play makes it sudden death with the second team holding the ball", () => {
    const s = play(touchback(k), { kind: "pass", seconds: 8, turnover: "interception", end: defenseEnd(50) });
    expect([s.phase, s.possession, s.overtime?.suddenDeath]).toEqual(["scrimmage", second, true]);
    expect(fg(advance(s, 80)).result).toEqual({ reason: "overtimeScore", winner: second });
  });

  it("the period ending tied is a tie", () => {
    const s = play({ ...touchback(k), clock: 4, twoMinuteWarningDone: true }, run(40, 6));
    expect(s.result).toEqual({ reason: "overtimeExpired", winner: null });
  });

  it("the period ending during the second team's possession, first team ahead, is a first-team win", () => {
    const s = touchback(fg(advance(touchback(k), 75)));
    const end = play({ ...s, clock: 4, twoMinuteWarningDone: true }, run(s.spot + 3, 6));
    expect(end.result).toEqual({ reason: "overtimeExpired", winner: first });
  });

  it("has a two-minute warning, as the fourth quarter does", () => {
    const s = runPreSnap({ ...touchback(k), clock: R.clock.twoMinuteWarningSeconds + 5, clockRunning: true }, R, 10);
    expect([s.clock, s.twoMinuteWarningDone]).toEqual([R.clock.twoMinuteWarningSeconds, true]);
  });

  it("allows the overtime timeouts and no more", () => {
    let s = touchback(k);
    for (let i = 0; i < fmt.timeoutsPerHalf; i++) s = advance(callTimeout(s, R, "home"), s.spot + 1);
    expectRule(() => callTimeout(s, R, "home"), "noTimeouts");
  });
});

describe("postseason overtime (C9)", () => {
  const fmt = R.overtime.postseason;
  const k = overtimeKickoff("postseason");
  const first = k.overtime?.firstTeam as string;

  it("starts with the postseason period length and timeouts", () => {
    expect([k.clock, k.timeouts.home]).toEqual([fmt.periodSeconds, fmt.timeoutsPerHalf]);
  });

  it("a first-possession field goal does not end it", () => {
    expect(fg(advance(touchback(k), 75)).phase).toBe("kickoff");
  });

  it("tied at the end of a period: another period follows, carrying possession and down", () => {
    const s = play({ ...touchback(k), clock: 4 }, run(40, 6));
    expect([s.phase, s.period, s.clock, s.possession, s.down]).toEqual(["scrimmage", k.period + 1, fmt.periodSeconds, first, 2]);
  });

  it("second team's possession not ended at a period's end: play goes on", () => {
    const s = touchback(fg(advance(touchback(k), 75)));
    const end = play({ ...s, clock: 4 }, run(s.spot + 3, 6));
    expect([end.phase, end.period]).toEqual(["scrimmage", k.period + 1]);
  });

  it("the second overtime period has a two-minute warning; the first does not", () => {
    const s1 = play({ ...touchback(k), clock: R.clock.twoMinuteWarningSeconds + 3 }, run(40, 6));
    expect(s1.twoMinuteWarningDone).toBe(false);
    const p2 = play({ ...touchback(k), clock: 4 }, run(40, 6));
    const s2 = play({ ...p2, clock: R.clock.twoMinuteWarningSeconds + 3 }, run(45, 6));
    expect(s2.twoMinuteWarningDone).toBe(true);
  });

  it("after the second period, a kickoff and fresh timeouts, as at halftime", () => {
    const p2 = play({ ...touchback(k), clock: 4, timeouts: { home: 1, away: 0 } }, run(40, 6));
    expect(p2.timeouts).toEqual({ home: 1, away: 0 });
    const p3 = play({ ...p2, clock: 4, twoMinuteWarningDone: true }, run(45, 6));
    expect([p3.period, p3.phase, p3.timeouts.home, p3.timeouts.away]).toEqual([k.period + 2, "kickoff", fmt.timeoutsPerHalf, fmt.timeoutsPerHalf]);
    expect(p3.possession).toBe(k.overtime?.toss.secondHalfReceiver === "home" ? "away" : "home");
  });

  it("after the fourth period, another coin toss", () => {
    let s: GameState = touchback(k);
    for (let i = 0; i < fmt.periodsPerCoinToss; i++) {
      s = play({ ...s, clock: 4, twoMinuteWarningDone: true }, s.phase === "kickoff" ? { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" } : run(s.spot + 1, 6));
      if (s.phase === "kickoff") s = touchback(s);
    }
    expect(s.phase).toBe("overtimeToss");
    const again = startOvertime(s, R, Rng.fromSeed(9));
    expect([again.phase, again.period]).toEqual(["kickoff", k.period + fmt.periodsPerCoinToss]);
  });

  it("never ends tied", () => {
    expect(fmt.canEndTied).toBe(false);
    expect(fmt.maxPeriods).toBeNull();
  });
});

describe("every way a game ends (C11)", () => {
  it("regulation with a leader", () => {
    expect(play(scrimmage({ period: 4, clock: 2, score: { home: 3, away: 0 } }), run(30, 5)).result).toEqual({ reason: "regulation", winner: "home" });
  });

  it("regulation tied goes to the overtime toss, not to final", () => {
    const s = play(scrimmage({ period: 4, clock: 2, score: { home: 3, away: 3 } }), run(30, 5));
    expect([s.phase, s.result]).toEqual(["overtimeToss", null]);
    expectRule(() => play(s, run(30)), "wrongPhase");
  });

  it("an overtime score, an overtime expiry tie, and the next period in the postseason", () => {
    const rs = overtimeKickoff("regularSeason");
    expect(play({ ...touchback(rs), clock: 3 }, run(30, 5)).result?.reason).toBe("overtimeExpired");
    const ps = overtimeKickoff("postseason");
    expect(play({ ...touchback(ps), clock: 3 }, run(30, 5)).result).toBeNull();
  });
});
