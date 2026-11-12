// Rule scenarios written by test-writer from the spec and docs/RULES.md (2026 rulebook), not
// from the machine's code. Each block names the rule it checks. Every number comes from the
// real rule set, so a rule change is still a data edit.

import { describe, expect, it } from "vitest";
import type { Foul, PlayResult, RuleSet } from "../../../shared/src/types";
import { Rng } from "../../src/rng";
import { callTimeout, penaltyOptions, runPreSnap, startOvertime } from "../../src/game/machine";
import { stateViolations } from "../../src/game/invariants";
import { toSituation } from "../../src/game/situation";
import { GameRuleError } from "../../src/game/errors";
import type { GameState, GameType, Team } from "../../src/game/types";
import { defenseEnd, incomplete, kickoffState, offenseEnd, play, real, run, scrimmage, tryState } from "./helpers";

const R = real();
const K = R.kickoff;
const W = R.clock.twoMinuteWarningSeconds;
const P = R.penalties;
const PS = R.game.periodSeconds;
const FIRST_DOWN = R.downs.yardsForFirstDown;
const accept = { penalty: { kind: "accept" as const, foul: 0 } };
const decline = { penalty: { kind: "decline" as const } };
const foul = (penalty: string, by: Foul["by"], spot?: number): Foul => (spot === undefined ? { penalty, by } : { penalty, by, spot });
const withFoul = (p: PlayResult, ...fouls: Foul[]): PlayResult => ({ ...p, fouls });
const otherTeam = (t: Team): Team => (t === "home" ? "away" : "home");
const falseStart: PlayResult = { kind: "noPlay", seconds: 0, fouls: [foul("falseStart", "offense")] };

/** A rejected input throws a GameRuleError with one of `codes` and leaves the state as it was. */
function expectRejected(s: GameState, fn: () => unknown, codes: readonly string[]): void {
  const before = JSON.parse(JSON.stringify(s)) as GameState;
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, "expected a rejection").toBeInstanceOf(GameRuleError);
  expect(codes).toContain((caught as GameRuleError).code);
  expect(s).toEqual(before);
}

describe("an incomplete pass at 2:05 of the 4th quarter (Rule 3-41, Rule 4-3)", () => {
  const snapAt = W + 5;
  const s0 = scrimmage({ period: 4, clock: snapAt, clockRunning: true, spot: 40, down: 2, distance: 6 });

  it("taking 3 seconds: the clock stops at 2:02 for the incompletion, no warning yet, same spot, next down", () => {
    const s = play(s0, incomplete(s0, 3));
    expect([s.clock, s.clockRunning, s.twoMinuteWarningDone]).toEqual([W + 2, false, false]);
    expect([s.spot, s.down, s.distance, s.possession]).toEqual([40, 3, 6, "home"]);
    expect(s.playClock).toBe(R.clock.playClockAfterPlay);
  });

  it("the offense may use the whole 40-second play clock before the next snap, and the stopped game clock does not run", () => {
    const s = play(s0, incomplete(s0, 3));
    const ready = runPreSnap(s, R, R.clock.playClockAfterPlay);
    expect([ready.clock, ready.clockRunning]).toEqual([W + 2, false]);
  });

  it("the next down, snapped at 2:02, brings the warning after it", () => {
    const s = play(s0, incomplete(s0, 3));
    const t = play(s, run(44, 6));
    expect([t.clock, t.clockRunning, t.twoMinuteWarningDone]).toEqual([W - 4, false, true]);
  });

  it("taking 6 seconds: the down was snapped before 2:00, so the warning follows it at 1:59", () => {
    const s = play(s0, incomplete(s0, 6));
    expect([s.clock, s.clockRunning, s.twoMinuteWarningDone]).toEqual([W - 1, false, true]);
  });

  it("taking 5 seconds to reach 2:00 exactly: the warning is given and the clock stays at 2:00", () => {
    const s = play(s0, incomplete(s0, 5));
    expect([s.clock, s.clockRunning, s.twoMinuteWarningDone]).toEqual([W, false, true]);
  });
});

describe("a run that spans the two-minute warning (Rule 3-41, Rule 4-6-2)", () => {
  it.each([2, 4])("in period %i: the run finishes, then the clock stops for the warning at the time left", (period) => {
    const s0 = scrimmage({ period, clock: W + 4, clockRunning: true, spot: 30 });
    const s = play(s0, run(37, 7));
    expect([s.clock, s.clockRunning, s.twoMinuteWarningDone]).toEqual([W - 3, false, true]);
    expect([s.spot, s.down, s.distance]).toEqual([37, 2, 3]);
  });

  it("after the warning the play clock is the administrative one, and the game clock waits for the snap", () => {
    const s = play(scrimmage({ period: 4, clock: W + 4, clockRunning: true }), run(37, 7));
    expect(s.playClock).toBe(R.clock.playClockAfterStoppage);
    expect(runPreSnap(s, R, R.clock.playClockAfterStoppage).clock).toBe(W - 3);
  });

  it("a run that ends with time still above 2:00 brings no warning and the clock keeps running", () => {
    const s = play(scrimmage({ period: 2, clock: W + 10, clockRunning: true }), run(30, 6));
    expect([s.clock, s.clockRunning, s.twoMinuteWarningDone]).toEqual([W + 4, true, false]);
  });

  it("a run spanning 2:00 in a period with no warning keeps the clock running", () => {
    const s = play(scrimmage({ period: 3, clock: W + 4, clockRunning: true }), run(30, 7));
    expect([s.clock, s.clockRunning, s.twoMinuteWarningDone]).toEqual([W - 3, true, false]);
  });
});

describe("safety by impetus versus a touchback (Rule 11-5-1, Rule 11-6-1)", () => {
  const s0 = scrimmage({ spot: 2, down: 2, distance: 10, possession: "home" });

  it("the offense fumbles into its own end zone and recovers there: its impetus, a safety", () => {
    const s = play(s0, { kind: "run", seconds: 4, end: offenseEnd(-3, "offense") });
    expect(s.score).toEqual({ home: 0, away: R.scoring.safety });
    expect([s.phase, s.possession, s.spot, s.safetyKick]).toEqual(["kickoff", "home", K.safetyKickSpot, true]);
  });

  it("the defense knocks the ball into the offense's end zone and the offense recovers: defense's impetus, a touchback", () => {
    const s = play(s0, { kind: "run", seconds: 4, end: offenseEnd(-3, "defense") });
    expect(s.score).toEqual({ home: 0, away: 0 });
    expect([s.phase, s.possession, s.spot, s.down, s.distance]).toEqual(["scrimmage", "home", R.touchback.scrimmageSpot, 1, FIRST_DOWN]);
  });

  it("the defense recovers the fumble in the offense's end zone: a defensive touchdown, not a safety", () => {
    const s = play(s0, { kind: "run", seconds: 4, turnover: "fumble", end: defenseEnd(-3) });
    expect(s.score).toEqual({ home: 0, away: R.scoring.touchdown });
    expect([s.phase, s.possession]).toEqual(["try", "away"]);
  });

  it("the same ball dead behind the goal line out of bounds with the offense's impetus is still a safety", () => {
    const s = play(s0, { kind: "run", seconds: 4, fumbleOutOfBounds: true, end: offenseEnd(-1, "offense") });
    expect(s.score.away).toBe(R.scoring.safety);
  });
});

describe("an end-zone interception (Rule 11-6-1, Rule 11-6-3)", () => {
  const s0 = scrimmage({ spot: 70, down: 3, distance: 8, clock: 500, clockRunning: true });

  it("intercepted and downed in the defense's end zone: touchback, its ball at the touchback spot, no score", () => {
    const s = play(s0, { kind: "pass", seconds: 6, turnover: "interception", end: defenseEnd(106) });
    expect(s.score).toEqual({ home: 0, away: 0 });
    expect([s.phase, s.possession, s.spot, s.down, s.distance, s.goalToGo]).toEqual(["scrimmage", "away", R.touchback.scrimmageSpot, 1, FIRST_DOWN, false]);
    expect([s.clock, s.clockRunning]).toEqual([494, false]);
  });

  it("intercepted in the end zone and returned out to the 8: ball at the 8, not a touchback", () => {
    const s = play(s0, { kind: "pass", seconds: 8, turnover: "interception", end: defenseEnd(92) });
    expect([s.possession, s.spot]).toEqual(["away", 8]);
  });

  it("intercepted in the end zone and returned for a touchdown", () => {
    const s = play(s0, { kind: "pass", seconds: 12, turnover: "interception", end: defenseEnd(-1) });
    expect([s.score.away, s.phase, s.possession]).toEqual([R.scoring.touchdown, "try", "away"]);
  });
});

describe("a punt downed at the 1 (Rule 9)", () => {
  it("receivers' 1st and 10 at their 1, not goal to go, clock stopped for the change of possession", () => {
    const s0 = scrimmage({ spot: 45, down: 4, distance: 7 });
    const s = play(s0, { kind: "punt", seconds: 7, crossedLine: true, touchedByReceivers: false, end: defenseEnd(99) });
    expect([s.phase, s.possession, s.spot, s.down, s.distance, s.goalToGo, s.clockRunning]).toEqual(["scrimmage", "away", 1, 1, FIRST_DOWN, false, false]);
    expect(toSituation(s, R).yardLine100).toBe(99);
    expect(stateViolations(s, R)).toEqual([]);
  });
});

describe("half the distance from the 3 (Rule 14-2-1, designed whole-yard rounding)", () => {
  it("a false start at the offense's own 3: ball to its 2, distance grows by the yard lost", () => {
    const s = play(scrimmage({ spot: 3, down: 1, distance: 10 }), falseStart);
    expect([s.spot, s.down, s.distance]).toEqual([2, 1, 11]);
  });

  it("offensive holding at its own 3 from the previous spot: ball to its 2", () => {
    const s0 = scrimmage({ spot: 3, down: 2, distance: 10 });
    const s = play(s0, withFoul(run(5), foul("offensiveHolding", "offense")), accept);
    expect([s.spot, s.down, s.distance]).toEqual([2, 2, 11]);
  });

  it("encroachment on 3rd and goal from the 3: ball to the 2, still 3rd and goal", () => {
    const s0 = scrimmage({ spot: 97, down: 3, distance: 3, goalToGo: true });
    const s = play(s0, { kind: "noPlay", seconds: 0, fouls: [foul("encroachment", "defense")] });
    expect([s.spot, s.down, s.distance, s.goalToGo]).toEqual([98, 3, 2, true]);
  });

  it("defensive holding on 3rd and goal from the 3: ball to the 2, automatic 1st and goal", () => {
    const s0 = scrimmage({ spot: 97, down: 3, distance: 3, goalToGo: true });
    const s = play(s0, withFoul(incomplete(s0), foul("defensiveHolding", "defense")), accept);
    expect([s.spot, s.down, s.distance, s.goalToGo]).toEqual([98, 1, 2, true]);
  });
});

describe("defensive holding on 3rd and 15 (Rule 12-1-5: 5 yards and an automatic first down)", () => {
  const s0 = scrimmage({ spot: 30, down: 3, distance: 15 });
  const holding = foul("defensiveHolding", "defense");

  it("on an incompletion: 5 yards from the previous spot and 1st and 10, though 5 is short of 15", () => {
    expect(P.defensiveHolding!.automaticFirstDown).toBe(true);
    const s = play(s0, withFoul(incomplete(s0), holding), accept);
    expect([s.spot, s.down, s.distance, s.possession]).toEqual([30 + P.defensiveHolding!.yards, 1, FIRST_DOWN, "home"]);
  });

  it("the offense may accept or decline", () => {
    expect(penaltyOptions(s0, R, withFoul(incomplete(s0), holding))).toEqual(expect.arrayContaining([{ kind: "decline" }, { kind: "accept", foul: 0 }]));
  });

  it("the default accepts on an incompletion and on a short gain", () => {
    expect(play(s0, withFoul(incomplete(s0), holding)).down).toBe(1);
    const short = play(s0, withFoul(run(33), holding));
    expect([short.spot, short.down, short.distance]).toEqual([35, 1, FIRST_DOWN]);
  });

  it("the default declines when the play itself gained a longer first down", () => {
    const s = play(s0, withFoul(run(52), holding));
    expect([s.spot, s.down, s.distance]).toEqual([52, 1, FIRST_DOWN]);
  });

  it("declined on an incompletion: 4th and 15", () => {
    const s = play(s0, withFoul(incomplete(s0), holding), decline);
    expect([s.spot, s.down, s.distance]).toEqual([30, 4, 15]);
  });
});

describe("a defensive foul on an untimed down at the end of a half (Rule 4-8-2)", () => {
  const dpi = (s: GameState, at: number) => withFoul(incomplete(s, 5), foul("defensivePassInterference", "defense", at));
  const earned = () => {
    const s0 = scrimmage({ period: 2, clock: 3, twoMinuteWarningDone: true, spot: 40 });
    const s = play(s0, dpi(s0, 55), accept);
    expect([s.untimedDown, s.clock, s.period]).toEqual([true, 0, 2]);
    return s;
  };

  it("another accepted defensive foul on the untimed down extends the half again", () => {
    const u = earned();
    const s = play(u, dpi(u, 75), accept);
    expect([s.period, s.phase, s.clock, s.untimedDown, s.spot, s.down]).toEqual([2, "scrimmage", 0, true, 75, 1]);
    const t = play(s, run(80, 5));
    expect([t.period, t.phase]).toEqual([3, "kickoff"]);
  });

  it("an offensive foul on the untimed down ends the half", () => {
    const u = earned();
    const s = play(u, withFoul(incomplete(u, 5), foul("offensiveHolding", "offense")), accept);
    expect([s.period, s.phase]).toEqual([3, "kickoff"]);
  });

  it("a declined defensive foul on the untimed down ends the half", () => {
    const u = earned();
    const s = play(u, withFoul(run(70, 5), foul("defensiveOffside", "defense")), decline);
    expect([s.period, s.phase]).toEqual([3, "kickoff"]);
  });

  it("a declined defensive foul as time expires earns no untimed down", () => {
    const s0 = scrimmage({ period: 2, clock: 3, twoMinuteWarningDone: true, spot: 40 });
    const s = play(s0, withFoul(run(48, 5), foul("defensiveOffside", "defense")), decline);
    expect([s.period, s.phase]).toEqual([3, "kickoff"]);
  });

  it("a touchdown on the untimed down gets its try, at 0:00", () => {
    const u = earned();
    const s = play(u, run(101, 6, { touchdown: true }));
    expect([s.phase, s.period, s.clock]).toEqual(["try", 2, 0]);
  });

  it("the untimed down uses no clock: the clock stays at 0:00, never below", () => {
    const u = earned();
    const s = play(u, dpi(u, 70), accept);
    expect(s.clock).toBe(0);
  });
});

// Overtime helpers built here so this file does not import another test file.
function otKickoff(gameType: GameType, seed = 11): GameState {
  const end = play(scrimmage({ period: 4, clock: 3, score: { home: 17, away: 17 }, twoMinuteWarningDone: true }, R, gameType), run(30, 5));
  expect(end.phase).toBe("overtimeToss");
  return startOvertime(end, R, Rng.fromSeed(seed));
}
const tb = (s: GameState) => play(s, { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" });
const to = (s: GameState, spot: number) => play(s, run(spot, 5));
const fieldGoal = (s: GameState) => play(s, { kind: "fieldGoal", seconds: 4, good: true, kickSpot: s.spot - 7 });
const touchdown = (s: GameState) => play(s, run(101, 5, { touchdown: true }));

describe("regular-season overtime (Rule 16-1-3)", () => {
  const k = otKickoff("regularSeason");
  const first = k.overtime!.firstTeam;
  const second = k.overtime!.secondTeam;

  it("first possession field goal, second possession field goal ties it: sudden death, and the next score of any kind wins", () => {
    const afterFirst = fieldGoal(to(tb(k), 75));
    expect([afterFirst.phase, afterFirst.possession, afterFirst.result]).toEqual(["kickoff", first, null]);
    expect(afterFirst.score[first]).toBe(17 + R.scoring.fieldGoal);
    const tied = fieldGoal(to(tb(afterFirst), 75));
    expect(tied.score).toEqual({ home: 17 + R.scoring.fieldGoal, away: 17 + R.scoring.fieldGoal });
    expect([tied.phase, tied.possession, tied.result, tied.overtime?.suddenDeath]).toEqual(["kickoff", second, null, true]);
    // Sudden death: the first team receives and gives up a safety; the second team wins.
    const backed = to(tb(tied), 3);
    const s = play(backed, { kind: "sack", seconds: 5, end: offenseEnd(-1) });
    expect(s.phase).toBe("final");
    expect(s.result).toEqual({ reason: "overtimeScore", winner: second });
  });

  it("first possession touchdown: the try is played and the second team still gets the ball", () => {
    const s = touchdown(to(tb(k), 95));
    expect([s.phase, s.possession, s.result]).toEqual(["try", first, null]);
    const kicked = play(s, { kind: "extraPoint", seconds: 0, good: true });
    expect([kicked.phase, kicked.possession, kicked.result]).toEqual(["kickoff", first, null]);
    expect(kicked.score[first]).toBe(17 + R.scoring.touchdown + R.scoring.tryKick);
  });

  it("first possession touchdown, then a second-team field goal that still trails: the first team wins", () => {
    const kicked = play(touchdown(to(tb(k), 95)), { kind: "extraPoint", seconds: 0, good: true });
    const s = fieldGoal(to(tb(kicked), 75));
    expect(s.phase).toBe("final");
    expect(s.result?.winner).toBe(first);
  });

  it("first possession touchdown, then the second team fails on fourth down: the first team wins", () => {
    let s = play(play(touchdown(to(tb(k), 95)), { kind: "twoPoint", seconds: 4, incomplete: true, end: offenseEnd(100 - R.try.twoPointSpot) }), { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" });
    expect(s.possession).toBe(second);
    for (let i = 0; i < R.downs.perSeries; i++) s = play(s, incomplete(s, 5));
    expect(s.phase).toBe("final");
    expect(s.result?.winner).toBe(first);
  });
});

describe("postseason overtime past the first period (Rule 16-1-4)", () => {
  const fmt = R.overtime.postseason;

  it("plays on through the first and second periods to a third, and a score there wins", () => {
    const k = otKickoff("postseason");
    const first = k.overtime!.firstTeam;
    const second = k.overtime!.secondTeam;
    expect([k.period, k.clock]).toEqual([R.game.regulationPeriods + 1, fmt.periodSeconds]);

    // First period: the first team kicks a field goal; the second team is driving when time runs out.
    const fg1 = fieldGoal(to(tb(k), 75));
    const drive = tb(fg1);
    const p2 = play({ ...drive, clock: 4 }, run(drive.spot + 4, 6));
    expect([p2.phase, p2.period, p2.clock, p2.possession, p2.down, p2.result]).toEqual(["scrimmage", k.period + 1, fmt.periodSeconds, second, 2, null]);
    // The first two overtime periods are one half: timeouts carry from period 1 to period 2.
    expect(p2.timeouts).toEqual(drive.timeouts);
    expect(toSituation(p2, R).quarter).toBe(5);

    // Second period: the second team ties it with a field goal. Now sudden death.
    const tied = fieldGoal(to(p2, 75));
    expect([tied.phase, tied.result, tied.overtime?.suddenDeath]).toEqual(["kickoff", null, true]);
    expect(tied.score.home).toBe(tied.score.away);

    // The second period runs out tied: the third opens with a kickoff and fresh timeouts.
    const recv = tb(tied);
    const p3 = play({ ...recv, clock: 4, twoMinuteWarningDone: true, timeouts: { home: 1, away: 0 } }, run(recv.spot + 4, 6));
    expect([p3.phase, p3.period, p3.clock, p3.result]).toEqual(["kickoff", k.period + 2, fmt.periodSeconds, null]);
    expect(p3.timeouts).toEqual({ home: fmt.timeoutsPerHalf, away: fmt.timeoutsPerHalf });

    // Third period: the receiving team kicks a field goal and wins.
    const receiver = otherTeam(p3.possession);
    const won = fieldGoal(to(tb(p3), 75));
    expect(won.phase).toBe("final");
    expect(won.result).toEqual({ reason: "overtimeScore", winner: receiver });
    expect([first, second]).toContain(receiver);
  });

  it("a period that ends tied never ends the game", () => {
    const k = otKickoff("postseason", 12);
    let s = tb(k);
    for (let i = 0; i < fmt.periodsPerCoinToss + 1; i++) {
      if (s.phase === "overtimeToss") s = startOvertime(s, R, Rng.fromSeed(100 + i));
      if (s.phase === "kickoff") s = tb(s);
      s = play({ ...s, clock: 4, twoMinuteWarningDone: true }, run(Math.min(s.spot + 1, 99), 6));
      expect(s.result).toBeNull();
      expect(s.phase).not.toBe("final");
    }
  });
});

describe("a kickoff out of bounds (Rule 6-2-4)", () => {
  const kick = (landingSpot?: number) => ({ kind: "kickoff" as const, seconds: 0, outcome: "outOfBounds" as const, ...(landingSpot === undefined ? {} : { landingSpot }) });

  it("with no spot given: receivers 25 yards from the spot of the kick, their 40, 1st and 10, no time off", () => {
    const s = play(kickoffState({ clock: 700 }), kick());
    expect([s.phase, s.possession, s.spot, s.down, s.distance]).toEqual(["scrimmage", "away", 100 - (K.spot + K.shortOrOutOfBoundsYards), 1, FIRST_DOWN]);
    expect([s.clock, s.clockRunning]).toEqual([700, false]);
  });

  it("out of bounds deep at the receivers' 10: still 25 yards from the kick, the spot closer to the kicker", () => {
    const s = play(kickoffState(), kick(90));
    expect(s.spot).toBe(100 - (K.spot + K.shortOrOutOfBoundsYards));
  });

  it("out of bounds 15 yards from the kick: receivers at the out-of-bounds spot", () => {
    const s = play(kickoffState(), kick(K.spot + 15));
    expect(s.spot).toBe(100 - (K.spot + 15));
  });
});

describe("a kickoff landing short of the landing zone (Rule 6-2-4)", () => {
  const short = (landingSpot?: number) => ({ kind: "kickoff" as const, seconds: 0, outcome: "short" as const, ...(landingSpot === undefined ? {} : { landingSpot }) });

  it("landing at the receivers' 30: receivers 25 yards from the spot of the kick, their 40", () => {
    const landsAt = 100 - (K.landingZone.to + 10);
    const s = play(kickoffState(), short(landsAt));
    expect([s.phase, s.possession, s.spot, s.down]).toEqual(["scrimmage", "away", 100 - (K.spot + K.shortOrOutOfBoundsYards), 1]);
  });

  it("landing 20 yards from the kick: receivers at the landing spot", () => {
    const s = play(kickoffState(), short(K.spot + 20));
    expect(s.spot).toBe(100 - (K.spot + 20));
  });

  it("a 'short' kick reported as landing inside the landing zone contradicts itself and is rejected", () => {
    const s0 = kickoffState();
    expectRejected(s0, () => play(s0, short(100 - (K.landingZone.to - 5))), ["contradictoryPlay", "badPlay"]);
  });
});

describe("a touchback from the end zone versus one after the landing zone (Rule 6-1-5)", () => {
  it("in the air into the end zone: the 35; touched the landing zone first: the 20; both 1st and 10, no time off", () => {
    const air = play(kickoffState({ clock: 650 }), { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" });
    const lz = play(kickoffState({ clock: 650 }), { kind: "kickoff", seconds: 0, outcome: "touchbackLandingZone" });
    expect([air.possession, air.spot, air.down, air.distance, air.clock, air.clockRunning]).toEqual(["away", K.touchbackFromEndZone, 1, FIRST_DOWN, 650, false]);
    expect([lz.possession, lz.spot, lz.down, lz.distance, lz.clock, lz.clockRunning]).toEqual(["away", K.touchbackAfterLandingZone, 1, FIRST_DOWN, 650, false]);
    expect(K.touchbackFromEndZone).not.toBe(K.touchbackAfterLandingZone);
  });

  it("a kickoff touchback uses the kickoff spots, not the scrimmage touchback spot", () => {
    const air = play(kickoffState(), { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" });
    expect(air.spot).toBe(K.touchbackFromEndZone);
  });
});

describe("an onside kick under the 2026 rules (Rule 6-1-6: declared, any time)", () => {
  const onside = (end: ReturnType<typeof offenseEnd>, seconds = 3) => ({ kind: "onsideKick" as const, seconds, outcome: "inPlay" as const, end });

  it("trailing late in the 4th: recovered by the kickers at their 46, their 1st and 10, the clock stopped after the free kick", () => {
    const s0 = kickoffState({ period: 4, clock: W - 10, twoMinuteWarningDone: true, score: { home: 20, away: 24 } });
    const s = play(s0, onside(offenseEnd(46)));
    expect([s.phase, s.possession, s.spot, s.down, s.distance]).toEqual(["scrimmage", "home", 46, 1, FIRST_DOWN]);
    expect([s.clock, s.clockRunning]).toEqual([W - 13, false]);
  });

  it("leading, tied, or in any quarter: still legal under the 2026 rule set", () => {
    for (const over of [{ score: { home: 21, away: 0 } }, { score: { home: 0, away: 0 }, period: 2 }, { score: { home: 3, away: 3 }, period: 3 }]) {
      expect(play(kickoffState(over), onside(defenseEnd(46))).phase).toBe("scrimmage");
    }
  });

  it("legal on the opening overtime kickoff", () => {
    const k = otKickoff("regularSeason");
    const s = play(k, onside(offenseEnd(47)));
    expect([s.phase, s.possession]).toEqual(["scrimmage", k.possession]);
  });

  it("recovered by the receivers: their ball at the recovery spot", () => {
    const s = play(kickoffState(), onside(defenseEnd(47)));
    expect([s.possession, s.spot]).toEqual(["away", 53]);
  });

  it("out of bounds 10 yards from the kick: receivers at the out-of-bounds spot", () => {
    const s = play(kickoffState(), { kind: "onsideKick", seconds: 0, outcome: "outOfBounds", landingSpot: K.spot + 10 });
    expect([s.possession, s.spot]).toEqual(["away", 100 - (K.spot + 10)]);
  });
});

describe("two-point try spots (Rule 11-3-1)", () => {
  it("after an offensive touchdown: snapped from the two-point spot, the kick from the kick spot", () => {
    const s = touchdown(scrimmage({ spot: 80 }));
    expect([s.phase, s.possession, s.spot]).toEqual(["try", "home", 100 - R.try.twoPointSpot]);
    expect(s.trySpots).toEqual({ kick: 100 - R.try.kickSpot, twoPoint: 100 - R.try.twoPointSpot });
  });

  it("after a defensive touchdown the scoring team's try uses the same spots in its own frame", () => {
    const s = play(scrimmage({ spot: 30 }), { kind: "pass", seconds: 9, turnover: "interception", end: defenseEnd(-1) });
    expect([s.phase, s.possession, s.spot]).toEqual(["try", "away", 100 - R.try.twoPointSpot]);
    expect(s.trySpots).toEqual({ kick: 100 - R.try.kickSpot, twoPoint: 100 - R.try.twoPointSpot });
    const sit = toSituation(s, R);
    expect([sit.yardLine100, sit.yardsToGo, sit.down]).toEqual([R.try.twoPointSpot, R.try.twoPointSpot, 1]);
  });

  it("a two-point run stopped a yard short adds nothing; one that crosses adds the try points", () => {
    const t = touchdown(scrimmage({ spot: 80 }));
    expect(play(t, { kind: "twoPoint", seconds: 4, end: offenseEnd(99) }).score.home).toBe(R.scoring.touchdown);
    expect(play(t, { kind: "twoPoint", seconds: 4, end: offenseEnd(101) }).score.home).toBe(R.scoring.touchdown + R.scoring.tryTouchdown);
  });

  it("a false start before a two-point try moves the snap back 5 yards", () => {
    const t = touchdown(scrimmage({ spot: 80 }));
    const s = play(t, falseStart);
    expect(s.trySpots?.twoPoint).toBe(100 - R.try.twoPointSpot - P.falseStart!.yards);
    expect(s.phase).toBe("try");
  });
});

describe("a timeout when a team has none left (Rule 4-5-1)", () => {
  it("in scrimmage: rejected with a typed error, state unchanged", () => {
    const s0 = scrimmage({ timeouts: { home: 0, away: 2 }, clockRunning: true, clock: 300 });
    expectRejected(s0, () => callTimeout(s0, R, "home"), ["noTimeouts"]);
    expect(callTimeout(s0, R, "away").timeouts).toEqual({ home: 0, away: 1 });
  });

  it("before a try: rejected", () => {
    const s0 = tryState({ timeouts: { home: 3, away: 0 } });
    expectRejected(s0, () => callTimeout(s0, R, "away"), ["noTimeouts"]);
  });

  it("spending a timeout to avoid the ten-second run-off when the offense has none: rejected", () => {
    const s0 = scrimmage({ period: 4, clock: 90, clockRunning: true, twoMinuteWarningDone: true, timeouts: { home: 0, away: 3 } });
    expectRejected(s0, () => play(s0, falseStart, { runoffTimeout: true }), ["noTimeouts", "badChoice"]);
    const s = play(s0, falseStart);
    expect([s.clock, s.timeouts.home]).toEqual([90 - R.clock.runoffSeconds, 0]);
  });

  it("the last timeout of a half takes the count to 0 and no lower", () => {
    let s = scrimmage({ period: 2, clock: 100, twoMinuteWarningDone: true });
    for (let i = 0; i < R.timeouts.perHalf; i++) s = play(callTimeout(s, R, "home"), run(s.spot + 1, 3));
    expect(s.timeouts.home).toBe(0);
    expectRejected(s, () => callTimeout(s, R, "home"), ["noTimeouts"]);
  });

  it("no timeout while the game waits for the overtime toss", () => {
    const end = play(scrimmage({ period: 4, clock: 3, score: { home: 7, away: 7 }, twoMinuteWarningDone: true }), run(30, 5));
    expect(end.phase).toBe("overtimeToss");
    expectRejected(end, () => callTimeout(end, R, "home"), ["wrongPhase", "timeoutNotAllowed"]);
  });
});

describe("the clock never goes negative", () => {
  const ok = (s: GameState, rules: RuleSet = R) => {
    expect(s.clock).toBeGreaterThanOrEqual(0);
    expect(stateViolations(s, rules)).toEqual([]);
  };

  it("a play longer than the time left ends the period at 0:00", () => {
    const s = play(scrimmage({ clock: 3 }), run(30, 12));
    expect([s.period, s.clock]).toEqual([2, PS]);
    ok(s);
  });

  it("the same at the end of regulation: final, clock at 0", () => {
    const s = play(scrimmage({ period: 4, clock: 3, twoMinuteWarningDone: true, score: { home: 7, away: 0 } }), run(30, 12));
    expect([s.phase, s.clock]).toEqual(["final", 0]);
    ok(s);
  });

  it("a touchdown longer than the time left: try at 0:00", () => {
    const s = play(scrimmage({ period: 2, clock: 2, spot: 50, twoMinuteWarningDone: true }), run(101, 9, { touchdown: true }));
    expect([s.phase, s.clock]).toEqual(["try", 0]);
    ok(s);
  });

  it("a kickoff return longer than the time left ends the period", () => {
    const s = play(kickoffState({ clock: 4 }), { kind: "kickoff", seconds: 9, outcome: "inPlay", end: defenseEnd(75) });
    expect([s.period, s.clock]).toEqual([2, PS]);
    ok(s);
  });

  it("pre-snap run-off longer than the time left stops at 0:00 and ends the period", () => {
    const s = runPreSnap(scrimmage({ clock: 10, clockRunning: true, playClock: R.clock.playClockAfterPlay }), R, 30);
    expect([s.period, s.clock]).toEqual([2, PS]);
    ok(s);
  });

  it("a ten-second run-off with less than ten seconds left ends the game at 0, not below", () => {
    const s = play(scrimmage({ period: 4, clock: 4, clockRunning: true, twoMinuteWarningDone: true, score: { home: 0, away: 7 } }), falseStart);
    expect([s.phase, s.clock]).toEqual(["final", 0]);
    ok(s);
  });

  it("an overtime play longer than the time left ends the period at 0", () => {
    const k = otKickoff("regularSeason");
    const s = play({ ...tb(k), clock: 2, twoMinuteWarningDone: true }, run(40, 8));
    expect([s.phase, s.clock]).toEqual(["final", 0]);
    ok(s);
  });
});
