// D1 to D7: penalty enforcement, using real penalties from the rule set's table.

import { describe, expect, it } from "vitest";
import type { Foul, PlayResult } from "../../../shared/src/types";
import { penaltyOptions } from "../../src/game/machine";
import { fixtureRules } from "../support/rules";
import { defenseEnd, expectRule, incomplete, kickoffState, offenseEnd, play, real, run, scrimmage, tryState } from "./helpers";

const R = real();
const P = R.penalties;
const accept = { penalty: { kind: "accept" as const, foul: 0 } };
const foul = (penalty: string, by: Foul["by"], spot?: number): Foul => (spot === undefined ? { penalty, by } : { penalty, by, spot });
const withFoul = (p: PlayResult, ...fouls: Foul[]): PlayResult => ({ ...p, fouls });

describe("enforcement spots (D1)", () => {
  const s0 = scrimmage({ spot: 25, down: 2, distance: 8 });

  it("previous spot: offensive holding moves the ball back from the line, same down", () => {
    const s = play(s0, withFoul(run(40), foul("offensiveHolding", "offense")), accept);
    expect([s.spot, s.down, s.distance]).toEqual([25 - P.offensiveHolding!.yards, 2, 8 + P.offensiveHolding!.yards]);
  });

  it("previous spot: defensive holding moves the ball up from the line, automatic first down", () => {
    const s = play(s0, withFoul(run(26), foul("defensiveHolding", "defense")), accept);
    expect([s.spot, s.down, s.distance]).toEqual([25 + P.defensiveHolding!.yards, 1, 10]);
  });

  it("spot of foul: pass interference gives a first down at the spot", () => {
    const s = play(s0, withFoul(incomplete(s0), foul("defensivePassInterference", "defense", 52)), accept);
    expect([s.spot, s.down, s.distance]).toEqual([52, 1, 10]);
  });

  it("succeeding spot: a dead-ball foul by the defense after the play adds to where the play ended", () => {
    const s = play(s0, withFoul(run(29), foul("unnecessaryRoughnessDeadBall", "defense")), accept);
    expect([s.spot, s.down]).toEqual([29 + P.unnecessaryRoughnessDeadBall!.yards, 1]);
  });

  it("succeeding spot: a dead-ball foul by the offense after the play counts the down (half the distance from the 29)", () => {
    const s = play(s0, withFoul(run(29), foul("unnecessaryRoughnessDeadBall", "offense")), accept);
    expect([s.spot, s.down, s.distance]).toEqual([15, 3, 18]);
  });

  it("dead-ball spot: roughing the passer on a completion is enforced from the end of the play when that is better", () => {
    const s = play(s0, withFoul({ kind: "pass", seconds: 5, end: offenseEnd(45) }, foul("roughingThePasser", "defense")), accept);
    expect(s.spot).toBe(45 + P.roughingThePasser!.yards);
    const t = play(s0, withFoul(incomplete(s0), foul("roughingThePasser", "defense")), accept);
    expect(t.spot).toBe(25 + P.roughingThePasser!.yards);
  });
});

describe("half the distance (D2)", () => {
  it.each([
    [1, 1],
    [2, 1],
    [3, 2],
    [10, 5],
  ])("offense fouls at its own %i: ball to its %i", (from, to) => {
    const s0 = scrimmage({ spot: from });
    expect(play(s0, withFoul(incomplete(s0), foul("offensiveHolding", "offense")), accept).spot).toBe(to);
  });

  it.each([
    [1, 1],
    [2, 1],
    [3, 2],
    [10, 5],
  ])("defense fouls with the ball at its %i: ball to its %i", (from, to) => {
    const s0 = scrimmage({ spot: 100 - from, distance: from, goalToGo: true });
    const s = play(s0, withFoul(incomplete(s0), foul("roughingThePasser", "defense")), accept);
    expect(100 - s.spot).toBe(to);
    expect(s.spot).toBeLessThan(100);
  });

  it("pass interference in the end zone: first down at the 1", () => {
    const s0 = scrimmage({ spot: 80, distance: 10 });
    const s = play(s0, withFoul(incomplete(s0), foul("defensivePassInterference", "defense", 104)), accept);
    expect([100 - s.spot, s.down, s.goalToGo]).toEqual([P.defensivePassInterference!.endZoneSpot, 1, true]);
  });
});

describe("downs after a penalty (D3)", () => {
  it("loss of down: intentional grounding is a down lost and the worse of 10 yards or the spot of the pass", () => {
    const s0 = scrimmage({ spot: 40, down: 2, distance: 10 });
    const near = play(s0, withFoul(incomplete(s0), foul("intentionalGrounding", "offense", 36)), accept);
    expect([near.spot, near.down, near.distance]).toEqual([30, 3, 20]);
    const deep = play(s0, withFoul(incomplete(s0), foul("intentionalGrounding", "offense", 25)), accept);
    expect([deep.spot, deep.down]).toEqual([25, 3]);
  });

  it("grounding from the end zone is a safety", () => {
    const s0 = scrimmage({ spot: 3 });
    const s = play(s0, withFoul(incomplete(s0), foul("intentionalGrounding", "offense", -2)), accept);
    expect([s.score.away, s.phase, s.safetyKick]).toEqual([R.scoring.safety, "kickoff", true]);
  });

  it("loss of down on fourth down turns the ball over", () => {
    const s0 = scrimmage({ spot: 40, down: 4, distance: 5 });
    const s = play(s0, withFoul(incomplete(s0), foul("intentionalGrounding", "offense", 33)), accept);
    expect([s.possession, s.spot, s.down]).toEqual(["away", 70, 1]);
  });

  it("a defensive foul whose yards reach the line to gain gives a first down without the automatic flag", () => {
    const s0 = scrimmage({ spot: 40, down: 3, distance: 3 });
    expect(P.defensiveOffside!.automaticFirstDown).toBe(false);
    const s = play(s0, withFoul(incomplete(s0), foul("defensiveOffside", "defense")), accept);
    expect([s.spot, s.down, s.distance]).toEqual([45, 1, 10]);
  });

  it("a defensive foul short of the line to gain without the flag replays the down", () => {
    const s0 = scrimmage({ spot: 40, down: 3, distance: 8 });
    const s = play(s0, withFoul(incomplete(s0), foul("defensiveOffside", "defense")), accept);
    expect([s.spot, s.down, s.distance]).toEqual([45, 3, 3]);
  });

  it("a defensive foul on goal to go at the 1 keeps it 1st and goal at the 1", () => {
    const s0 = scrimmage({ spot: 99, down: 3, distance: 1, goalToGo: true });
    const s = play(s0, withFoul(run(99), foul("defensiveHolding", "defense")), accept);
    expect([s.spot, s.down, s.distance, s.goalToGo]).toEqual([99, 1, 1, true]);
  });
});

describe("accept or decline (D4)", () => {
  const s0 = scrimmage({ spot: 25, down: 2, distance: 8 });

  it("lists accept and decline for the offended team", () => {
    expect(penaltyOptions(s0, R, withFoul(run(40), foul("defensiveHolding", "defense")))).toEqual([{ kind: "decline" }, { kind: "accept", foul: 0 }]);
  });

  it("lists one accept per foul when one team commits several", () => {
    const p = withFoul(run(40), foul("defensiveHolding", "defense"), foul("defensiveOffside", "defense"));
    expect(penaltyOptions(s0, R, p)).toEqual([{ kind: "decline" }, { kind: "accept", foul: 0 }, { kind: "accept", foul: 1 }]);
  });

  it("applies a supplied choice", () => {
    const p = withFoul(run(40), foul("defensiveHolding", "defense"));
    expect(play(s0, p, { penalty: { kind: "decline" } }).spot).toBe(40);
    expect(play(s0, p, accept).spot).toBe(30);
  });

  it("the default declines when the play is better for the offended team, and is deterministic", () => {
    const p = withFoul(run(40), foul("defensiveHolding", "defense"));
    expect(play(s0, p).spot).toBe(40);
    expect(play(s0, p)).toEqual(play(s0, p));
  });

  it("the default accepts when the play is worse for the offended team", () => {
    const p = withFoul(run(22), foul("defensiveHolding", "defense"));
    expect([play(s0, p).spot, play(s0, p).down]).toEqual([30, 1]);
  });

  it("the default declines an offensive foul on a play the defense intercepted", () => {
    const p = withFoul({ kind: "pass", seconds: 5, turnover: "interception", end: defenseEnd(50) }, foul("offensiveHolding", "offense"));
    expect(play(s0, p).possession).toBe("away");
  });

  it("the default declines a defensive foul on an offensive touchdown", () => {
    const p = withFoul(run(101), foul("defensiveHolding", "defense"));
    expect(play(scrimmage({ spot: 80 }), p).phase).toBe("try");
  });

  it("a penalty that cannot be declined has no decline option", () => {
    const rules = fixtureRules({ penalties: { ...R.penalties, defensiveHolding: { ...P.defensiveHolding!, declinable: false } } });
    const p = withFoul(run(40), foul("defensiveHolding", "defense"));
    expect(penaltyOptions(s0, rules, p)).toEqual([{ kind: "accept", foul: 0 }]);
    expectRule(() => play(s0, p, { penalty: { kind: "decline" } }, rules), "badChoice");
    expect(play(s0, p, {}, rules).spot).toBe(30);
  });
});

describe("offsetting fouls (D5)", () => {
  it("replay the down from the previous spot with down and distance unchanged", () => {
    const s0 = scrimmage({ spot: 25, down: 3, distance: 6 });
    const p = withFoul(run(45), foul("offensiveHolding", "offense"), foul("defensiveHolding", "defense"));
    expect(penaltyOptions(s0, R, p)).toEqual([{ kind: "offset" }]);
    const s = play(s0, p);
    expect([s.spot, s.down, s.distance, s.possession]).toEqual([25, 3, 6, "home"]);
  });

  it("on a fourth-down play short of the line, still a replay", () => {
    const s0 = scrimmage({ spot: 25, down: 4, distance: 6 });
    const s = play(s0, withFoul(run(26), foul("offensiveHolding", "offense"), foul("defensiveHolding", "defense")));
    expect([s.possession, s.down]).toEqual(["home", 4]);
  });
});

describe("penalties on tries, kickoffs and punts (D6)", () => {
  it("a defensive foul on a try replays it closer, half the distance where needed", () => {
    const s = play(tryState(), withFoul({ kind: "extraPoint", seconds: 0, good: false }, foul("defensiveOffside", "defense")), accept);
    expect(s.phase).toBe("try");
    expect(s.trySpots).toEqual({ kick: 100 - R.try.kickSpot + 5, twoPoint: 99 });
  });

  it("an offensive foul on a good try replays it from further back", () => {
    const s = play(tryState(), withFoul({ kind: "extraPoint", seconds: 0, good: true }, foul("offensiveHolding", "offense")), accept);
    expect([s.phase, s.score.home]).toEqual(["try", 6]);
    expect(s.trySpots?.kick).toBe(100 - R.try.kickSpot - 10);
  });

  it("a kicking-team foul on a kickoff the receivers keep adds the yards to the dead-ball spot", () => {
    const s = play(kickoffState(), withFoul({ kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" }, foul("kickoffIllegalFormation", "offense")), accept);
    expect([s.possession, s.spot]).toEqual(["away", R.kickoff.touchbackFromEndZone + P.kickoffIllegalFormation!.alternate!.yards]);
  });

  it("a kicking-team foul on a kickoff the kickers recover is a re-kick from further back", () => {
    const s = play(kickoffState(), withFoul({ kind: "onsideKick", seconds: 3, outcome: "inPlay", end: offenseEnd(46) }, foul("kickoffIllegalFormation", "offense")), accept);
    expect([s.phase, s.possession, s.spot]).toEqual(["kickoff", "home", R.kickoff.spot - 5]);
  });

  it("a return-team foul on a kickoff is enforced from the spot of the foul against the receivers", () => {
    const s = play(kickoffState(), withFoul({ kind: "kickoff", seconds: 6, outcome: "inPlay", end: defenseEnd(65) }, foul("returnTeamIllegalBlock", "defense", 75)), accept);
    expect([s.possession, s.spot]).toEqual(["away", 25 - P.returnTeamIllegalBlock!.yards]);
  });

  it("a return-team foul on a punt is enforced from the spot of the foul", () => {
    const s0 = scrimmage({ down: 4, spot: 30 });
    const p = withFoul({ kind: "punt", seconds: 8, crossedLine: true, touchedByReceivers: false, end: defenseEnd(55) }, foul("returnTeamIllegalBlock", "defense", 60));
    const s = play(s0, p, accept);
    expect([s.possession, s.spot]).toEqual(["away", 40 - P.returnTeamIllegalBlock!.yards]);
  });

  it("a kicking-team foul on a punt the receivers keep is added to the dead-ball spot", () => {
    const s0 = scrimmage({ down: 4, spot: 30 });
    const p = withFoul({ kind: "punt", seconds: 8, crossedLine: true, touchedByReceivers: false, end: defenseEnd(70) }, foul("offensiveHolding", "offense"));
    const s = play(s0, p, accept);
    expect([s.possession, s.spot]).toEqual(["away", 30 + P.offensiveHolding!.yards]);
  });
});

describe("pre-snap fouls (D7)", () => {
  it("no play yards, no play time, same down", () => {
    const s0 = scrimmage({ spot: 30, down: 2, distance: 7, clock: 600 });
    const s = play(s0, { kind: "noPlay", seconds: 0, fouls: [foul("falseStart", "offense")] });
    expect([s.spot, s.down, s.distance, s.clock, s.playCount]).toEqual([25, 2, 12, 600, s0.playCount + 1]);
  });

  it("a defensive pre-snap foul that reaches the line to gain is a first down", () => {
    const s0 = scrimmage({ spot: 30, down: 3, distance: 2 });
    const s = play(s0, { kind: "noPlay", seconds: 0, fouls: [foul("encroachment", "defense")] });
    expect([s.spot, s.down]).toEqual([35, 1]);
  });

  it("delay of game on a try moves both try spots back", () => {
    const s = play(tryState(), { kind: "noPlay", seconds: 0, fouls: [foul("delayOfGame", "offense")] });
    expect(s.trySpots).toEqual({ kick: 100 - R.try.kickSpot - 5, twoPoint: 100 - R.try.twoPointSpot - 5 });
  });
});
