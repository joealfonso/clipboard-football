// C1 to C7: clock stops and restarts, run-off, two-minute warning, timeouts, ten-second
// run-off, untimed downs, quarters and halftime.

import { describe, expect, it } from "vitest";
import { callTimeout, runPreSnap } from "../../src/game/machine";
import { defenseEnd, expectRule, incomplete, offenseEnd, play, real, run, scrimmage, tryState } from "./helpers";

const R = real();
const W = R.clock.twoMinuteWarningSeconds;
const Q4_WINDOW = R.clock.startsOnSnapWithin["4"] as number;
const Q2_WINDOW = R.clock.startsOnSnapWithin["2"] as number;
const falseStart = { kind: "noPlay" as const, seconds: 0, fouls: [{ penalty: "falseStart", by: "offense" as const }] };

describe("clock after each kind of event (C1)", () => {
  it("in-bounds play: the clock keeps running, 40-second play clock", () => {
    const s = play(scrimmage(), run(30));
    expect([s.clockRunning, s.playClock]).toEqual([true, R.clock.playClockAfterPlay]);
  });

  it("incomplete pass: stopped until the snap", () => {
    const s0 = scrimmage();
    expect(play(s0, incomplete(s0)).clockRunning).toBe(false);
  });

  it.each([
    ["first quarter", 1, 600, true],
    ["second quarter before the warning", 2, 300, true],
    ["second quarter after the warning", 2, Q2_WINDOW - 10, false],
    ["fourth quarter outside the last five minutes", 4, Q4_WINDOW + 30, true],
    ["fourth quarter inside the last five minutes", 4, Q4_WINDOW - 10, false],
  ] as const)("out of bounds in the %s: running %s", (_n, period, clockAfter, running) => {
    const s = play(scrimmage({ period, clock: clockAfter + 5, twoMinuteWarningDone: true }), run(30, 5, { outOfBounds: true }));
    expect(s.clock).toBe(clockAfter);
    expect(s.clockRunning).toBe(running);
  });

  it("a fumble out of bounds restarts on the ready signal even late in a half", () => {
    const s = play(scrimmage({ period: 4, clock: 100, twoMinuteWarningDone: true }), run(30, 5, { fumbleOutOfBounds: true }));
    expect(s.clockRunning).toBe(true);
  });

  it("score: stopped", () => {
    expect(play(scrimmage({ spot: 95, distance: 5, goalToGo: true }), run(101)).clockRunning).toBe(false);
  });

  it("change of possession: stopped", () => {
    expect(play(scrimmage(), { kind: "pass", seconds: 5, turnover: "interception", end: defenseEnd(50) }).clockRunning).toBe(false);
  });

  it("accepted penalty: restarts as if no foul, with a 25-second play clock", () => {
    const p = run(28, 5, { fouls: [{ penalty: "defensiveHolding", by: "defense" }] });
    const s = play(scrimmage({ clockRunning: true }), p, { penalty: { kind: "accept", foul: 0 } });
    expect([s.clockRunning, s.playClock]).toEqual([true, R.clock.playClockAfterStoppage]);
  });

  it("accepted penalty inside the last five minutes: stopped until the snap", () => {
    const p = run(28, 5, { fouls: [{ penalty: "defensiveHolding", by: "defense" }] });
    const s = play(scrimmage({ period: 4, clock: Q4_WINDOW - 20 }), p, { penalty: { kind: "accept", foul: 0 } });
    expect(s.clockRunning).toBe(false);
  });

  it("pre-snap foul: the clock keeps the state it had, except an offensive one in the fourth quarter", () => {
    expect(play(scrimmage({ clockRunning: true, clock: 600 }), falseStart).clockRunning).toBe(true);
    expect(play(scrimmage({ clockRunning: false, clock: 600 }), falseStart).clockRunning).toBe(false);
    expect(play(scrimmage({ period: 4, clockRunning: true, clock: 800 }), falseStart).clockRunning).toBe(false);
  });

  it("timeout: stopped, 25-second play clock", () => {
    const s = callTimeout(scrimmage({ clockRunning: true }), R, "home");
    expect([s.clockRunning, s.playClock]).toEqual([false, R.clock.playClockAfterStoppage]);
  });

  it("run-off applies when the clock restarted on the ready signal, not when it waits for the snap", () => {
    expect(runPreSnap(scrimmage({ clockRunning: true, clock: 600 }), R, 20).clock).toBe(580);
    expect(runPreSnap(scrimmage({ clockRunning: false, clock: 600 }), R, 20).clock).toBe(600);
  });

  it("end of period: stopped", () => {
    const s = play(scrimmage({ clock: 4 }), run(30, 6));
    expect([s.period, s.clock, s.clockRunning]).toEqual([2, R.game.periodSeconds, false]);
  });
});

describe("pre-snap run-off (C2)", () => {
  it("rejects more than the play clock", () => {
    const s = scrimmage({ clockRunning: true, playClock: R.clock.playClockAfterPlay });
    expectRule(() => runPreSnap(s, R, R.clock.playClockAfterPlay + 1), "runoffTooLong");
    const after = runPreSnap(s, R, 20);
    expectRule(() => runPreSnap(after, R, R.clock.playClockAfterPlay - 19), "runoffTooLong");
  });

  it("run-off to 0:00 ends the period with no play", () => {
    const s = runPreSnap(scrimmage({ clock: 20, clockRunning: true, down: 3, distance: 4, spot: 44 }), R, 20);
    expect([s.period, s.clock, s.possession, s.down, s.distance, s.spot]).toEqual([2, R.game.periodSeconds, "home", 3, 4, 44]);
  });

  it("is only for a snap", () => {
    expectRule(() => runPreSnap(tryState(), R, 5), "wrongPhase");
  });
});

describe("two-minute warning (C3)", () => {
  it("stops the clock exactly at the warning during run-off", () => {
    const s = runPreSnap(scrimmage({ period: 2, clock: W + 7, clockRunning: true }), R, 20);
    expect([s.clock, s.clockRunning, s.twoMinuteWarningDone]).toEqual([W, false, true]);
  });

  it("stops after a play that crosses it, at whatever time is left", () => {
    const s = play(scrimmage({ period: 4, clock: W + 3 }), run(30, 7));
    expect([s.clock, s.clockRunning, s.twoMinuteWarningDone]).toEqual([W - 4, false, true]);
  });

  it("happens once per half", () => {
    const s = play(scrimmage({ period: 4, clock: W + 3 }), run(30, 7));
    const t = play(s, run(33, 6));
    expect(t.clockRunning).toBe(true);
  });

  it("does not happen in a period the rule set does not name", () => {
    const s = play(scrimmage({ period: 1, clock: W + 3 }), run(30, 7));
    expect([s.clockRunning, s.twoMinuteWarningDone]).toEqual([true, false]);
  });
});

describe("timeouts (C4)", () => {
  it("each team starts a half with the rule set's count, and a timeout takes one", () => {
    const s = scrimmage();
    expect(s.timeouts).toEqual({ home: R.timeouts.perHalf, away: R.timeouts.perHalf });
    expect(callTimeout(s, R, "away").timeouts).toEqual({ home: R.timeouts.perHalf, away: R.timeouts.perHalf - 1 });
  });

  it("a team with none left is rejected", () => {
    expectRule(() => callTimeout(scrimmage({ timeouts: { home: 0, away: 1 } }), R, "home"), "noTimeouts");
  });

  it("a second timeout by one team in the same dead-ball period is rejected; the other team may take one", () => {
    const s = callTimeout(scrimmage(), R, "home");
    expectRule(() => callTimeout(s, R, "home"), "timeoutNotAllowed");
    expect(callTimeout(s, R, "away").timeouts.away).toBe(R.timeouts.perHalf - 1);
    expect(callTimeout(play(s, run(30)), R, "home").timeouts.home).toBe(R.timeouts.perHalf - 2);
  });

  it("is allowed during a try", () => {
    expect(callTimeout(tryState(), R, "away").timeouts.away).toBe(R.timeouts.perHalf - 1);
  });

  it("counts reset at halftime and unused ones do not carry over", () => {
    const s = play(scrimmage({ period: 2, clock: 3, timeouts: { home: 0, away: 2 }, twoMinuteWarningDone: true }), run(30, 5));
    expect([s.period, s.phase]).toEqual([3, "kickoff"]);
    expect(s.timeouts).toEqual({ home: R.timeouts.perHalf, away: R.timeouts.perHalf });
  });
});

describe("ten-second run-off (C5)", () => {
  const late = scrimmage({ period: 4, clock: 90, clockRunning: true, twoMinuteWarningDone: true });

  it("an offensive foul that stops a running clock after the warning runs off the set seconds", () => {
    const s = play(late, falseStart);
    expect([s.clock, s.clockRunning, s.playClock, s.spot]).toEqual([90 - R.clock.runoffSeconds, true, R.clock.playClockAfterRunoff, 20]);
  });

  it("the offense can use a timeout to avoid it", () => {
    const s = play(late, falseStart, { runoffTimeout: true });
    expect([s.clock, s.clockRunning, s.timeouts.home]).toEqual([90, false, R.timeouts.perHalf - 1]);
  });

  it("declining the penalty declines the run-off", () => {
    const s = play(late, falseStart, { penalty: { kind: "decline" } });
    expect([s.clock, s.spot]).toEqual([90, 25]);
  });

  it("not before the warning, and never against the defense", () => {
    expect(play(scrimmage({ period: 4, clock: 400, clockRunning: true }), falseStart).clock).toBe(400);
    const enc = { kind: "noPlay" as const, seconds: 0, fouls: [{ penalty: "encroachment", by: "defense" as const }] };
    expect(play(late, enc).clock).toBe(90);
  });

  it("a run-off that reaches 0:00 ends the half", () => {
    const s = play(scrimmage({ period: 2, clock: 8, clockRunning: true, twoMinuteWarningDone: true }), falseStart);
    expect([s.period, s.phase]).toEqual([3, "kickoff"]);
  });

  it("intentional grounding after the warning carries the run-off", () => {
    const p = { kind: "pass" as const, seconds: 4, incomplete: true, end: offenseEnd(25), fouls: [{ penalty: "intentionalGrounding", by: "offense" as const, spot: 18 }] };
    const s = play(late, p, { penalty: { kind: "accept", foul: 0 } });
    expect(s.clock).toBe(90 - 4 - R.clock.runoffSeconds);
  });
});

describe("untimed downs and the last play (C6)", () => {
  const dpi = (s: ReturnType<typeof scrimmage>) => incomplete(s, 6, [{ penalty: "defensivePassInterference", by: "defense", spot: s.spot + 20 }]);

  it("an accepted defensive foul as time expires earns one untimed down", () => {
    const s0 = scrimmage({ period: 2, clock: 3, twoMinuteWarningDone: true });
    const s = play(s0, dpi(s0), { penalty: { kind: "accept", foul: 0 } });
    expect([s.period, s.clock, s.untimedDown, s.phase, s.spot, s.down]).toEqual([2, 0, true, "scrimmage", 45, 1]);
    const t = play(s, run(50, 5));
    expect([t.period, t.phase]).toEqual([3, "kickoff"]);
  });

  it("an offensive foul as time expires does not", () => {
    const s0 = scrimmage({ period: 2, clock: 3, twoMinuteWarningDone: true });
    const s = play(s0, incomplete(s0, 6, [{ penalty: "offensiveHolding", by: "offense" }]), { penalty: { kind: "accept", foul: 0 } });
    expect([s.period, s.phase]).toEqual([3, "kickoff"]);
  });

  it("a touchdown on the last play of the half still gets its try at 0:00", () => {
    const s = play(scrimmage({ period: 2, clock: 3, spot: 90, goalToGo: true, twoMinuteWarningDone: true }), run(101, 5));
    expect([s.phase, s.clock, s.period]).toEqual(["try", 0, 2]);
    const t = play(s, { kind: "extraPoint", seconds: 0, good: true });
    expect([t.period, t.phase]).toEqual([3, "kickoff"]);
  });

  it("a touchdown that wins the game on the last play skips the try", () => {
    const s = play(scrimmage({ period: 4, clock: 3, spot: 90, goalToGo: true, twoMinuteWarningDone: true, score: { home: 10, away: 10 } }), run(101, 5));
    expect(s.result).toEqual({ reason: "regulation", winner: "home" });
  });

  it("a touchdown on the last play that leaves the try able to tie or win keeps the try", () => {
    const s = play(scrimmage({ period: 4, clock: 3, spot: 90, goalToGo: true, twoMinuteWarningDone: true, score: { home: 10, away: 17 } }), run(101, 5));
    expect([s.phase, s.score.home]).toEqual(["try", 16]);
    expect(play(s, { kind: "extraPoint", seconds: 0, good: true }).phase).toBe("overtimeToss");
    expect(play(s, { kind: "extraPoint", seconds: 0, good: false }).result).toEqual({ reason: "regulation", winner: "away" });
  });

  it("a defensive foul at 0:00 on goal to go at the 1 gives an untimed down from half the distance", () => {
    const s0 = scrimmage({ period: 4, clock: 2, spot: 99, distance: 1, goalToGo: true, twoMinuteWarningDone: true, score: { home: 0, away: 3 } });
    const s = play(s0, run(99, 4, { fouls: [{ penalty: "defensiveHolding", by: "defense" }] }), { penalty: { kind: "accept", foul: 0 } });
    expect([s.untimedDown, s.spot, s.down, s.distance]).toEqual([true, 99, 1, 1]);
  });
});

describe("quarters and halftime (C7)", () => {
  it("quarter one to two carries possession, down, distance and spot", () => {
    const s = play(scrimmage({ clock: 4, down: 2, distance: 10, spot: 40 }), run(43, 6));
    expect([s.period, s.possession, s.down, s.distance, s.spot]).toEqual([2, "home", 3, 7, 43]);
  });

  it("quarter three to four carries over too", () => {
    const s = play(scrimmage({ period: 3, clock: 4, spot: 40 }), run(43, 6));
    expect([s.period, s.phase, s.down]).toEqual([4, "scrimmage", 2]);
  });

  it("halftime resets to a kickoff by the team that does not receive the second half", () => {
    const s0 = scrimmage({ period: 2, clock: 4, twoMinuteWarningDone: true });
    const s = play(s0, run(43, 6));
    const kicker = s0.toss.secondHalfReceiver === "home" ? "away" : "home";
    expect([s.period, s.phase, s.possession, s.spot, s.clock]).toEqual([3, "kickoff", kicker, R.kickoff.spot, R.game.periodSeconds]);
  });
});
