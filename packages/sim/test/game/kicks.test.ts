// B8 to B10: kickoff end states, onside kicks, punts. Spots are read from the rule set.

import { describe, expect, it } from "vitest";
import { defenseEnd, expectRule, kickoffState, offenseEnd, play, real, scrimmage } from "./helpers";
import { fixtureRules } from "../support/rules";

const R = real();
const K = R.kickoff;

describe("kickoff end states (B8)", () => {
  it("in the air into the end zone, downed or out the back: touchback at the end-zone spot", () => {
    const s = play(kickoffState(), { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" });
    expect([s.phase, s.possession, s.spot, s.down]).toEqual(["scrimmage", "away", K.touchbackFromEndZone, 1]);
    expect(s.clock).toBe(R.game.periodSeconds);
  });

  it("touched the landing zone, then into the end zone: touchback at the landing-zone spot", () => {
    const s = play(kickoffState(), { kind: "kickoff", seconds: 0, outcome: "touchbackLandingZone" });
    expect([s.possession, s.spot]).toEqual(["away", K.touchbackAfterLandingZone]);
  });

  it("every touchback after a kick from the midfield spot goes to the midfield touchback spot", () => {
    for (const outcome of ["touchbackEndZone", "touchbackLandingZone"] as const) {
      const s = play(kickoffState({ spot: K.midfieldKickSpot }), { kind: "kickoff", seconds: 0, outcome });
      expect(s.spot).toBe(K.touchbackFromMidfield);
    }
  });

  it.each(["short", "outOfBounds"] as const)("%s: the receivers take it the set yards from the spot of the kick", (outcome) => {
    const s = play(kickoffState(), { kind: "kickoff", seconds: 0, outcome });
    expect([s.possession, s.spot]).toEqual(["away", 100 - (K.spot + K.shortOrOutOfBoundsYards)]);
  });

  it("a kick out of bounds closer to the kicker than the set yards gives the receivers the out-of-bounds spot", () => {
    const s = play(kickoffState(), { kind: "kickoff", seconds: 0, outcome: "outOfBounds", landingSpot: K.spot + 12 });
    expect(s.spot).toBe(100 - (K.spot + 12));
  });

  it("a safety kick short or out of bounds uses the safety-kick yards", () => {
    const s = play(kickoffState({ spot: K.safetyKickSpot, safetyKick: true }), { kind: "kickoff", seconds: 0, outcome: "short" });
    expect(s.spot).toBe(100 - (K.safetyKickSpot + K.safetyKickShortOrOutOfBoundsYards));
  });

  it("a fair catch puts the receivers' ball at the spot of the catch", () => {
    const s = play(kickoffState(), { kind: "kickoff", seconds: 0, outcome: "fairCatch", end: defenseEnd(88) });
    expect([s.possession, s.spot]).toEqual(["away", 12]);
  });

  it("no fair catch when the rule set does not allow one", () => {
    const rules = fixtureRules({ kickoff: { fairCatchAllowed: false } });
    expectRule(() => play(kickoffState({}, rules), { kind: "kickoff", seconds: 0, outcome: "fairCatch", end: defenseEnd(88) }, {}, rules), "fairCatchNotAllowed");
  });

  it("a return gives the receivers 1st and 10 at the dead-ball spot and runs the clock", () => {
    const s = play(kickoffState(), { kind: "kickoff", seconds: 6, outcome: "inPlay", end: defenseEnd(72) });
    expect([s.possession, s.spot, s.down, s.distance]).toEqual(["away", 28, 1, 10]);
    expect(s.clock).toBe(R.game.periodSeconds - 6);
    expect(s.clockRunning).toBe(false);
  });

  it("a return touchdown scores for the receivers", () => {
    const s = play(kickoffState(), { kind: "kickoff", seconds: 11, outcome: "inPlay", end: defenseEnd(-1) });
    expect(s.score).toEqual({ home: 0, away: R.scoring.touchdown });
    expect([s.phase, s.possession]).toEqual(["try", "away"]);
  });

  it("a muff recovered by the kickers in the landing zone is the kickers' ball", () => {
    const s = play(kickoffState(), { kind: "kickoff", seconds: 4, outcome: "inPlay", end: offenseEnd(88) });
    expect([s.possession, s.spot, s.down]).toEqual(["home", 88, 1]);
  });

  it("a muff recovered by the receivers is their ball", () => {
    const s = play(kickoffState(), { kind: "kickoff", seconds: 4, outcome: "inPlay", end: defenseEnd(90) });
    expect([s.possession, s.spot]).toEqual(["away", 10]);
  });

  it("a returner downed in his own end zone after carrying the ball in gives up a safety", () => {
    const s = play(kickoffState(), { kind: "kickoff", seconds: 4, outcome: "inPlay", end: defenseEnd(101, "defense") });
    expect(s.score).toEqual({ home: R.scoring.safety, away: 0 });
    expect([s.phase, s.possession, s.safetyKick]).toEqual(["kickoff", "away", true]);
  });

  it("the clock does not start on a touchback", () => {
    expectRule(() => play(kickoffState(), { kind: "kickoff", seconds: 3, outcome: "touchbackEndZone" }), "contradictoryPlay");
  });

  it("an undeclared kick recovered by the kickers short of the landing zone is rejected", () => {
    expectRule(() => play(kickoffState(), { kind: "kickoff", seconds: 3, outcome: "inPlay", end: offenseEnd(50) }), "contradictoryPlay");
  });
});

describe("onside kicks (B9)", () => {
  it("recovered by the kickers: their ball at the recovery spot", () => {
    const s = play(kickoffState(), { kind: "onsideKick", seconds: 3, outcome: "inPlay", end: offenseEnd(47) });
    expect([s.possession, s.spot, s.down]).toEqual(["home", 47, 1]);
  });

  it("recovered by the receivers: their ball at the recovery spot", () => {
    const s = play(kickoffState(), { kind: "onsideKick", seconds: 3, outcome: "inPlay", end: defenseEnd(48) });
    expect([s.possession, s.spot]).toEqual(["away", 52]);
  });

  it("allowed at any time under the 2026 rules, even when leading in the first quarter", () => {
    const s = play(kickoffState({ score: { home: 7, away: 0 } }), { kind: "onsideKick", seconds: 3, outcome: "inPlay", end: defenseEnd(48) });
    expect(s.phase).toBe("scrimmage");
  });

  it("rejected when a rule set allows it only while trailing and the kicker is not", () => {
    const rules = fixtureRules({ kickoff: { onside: { allowedWhen: "trailing", declarationRequired: true } } });
    const p = { kind: "onsideKick" as const, seconds: 3, outcome: "inPlay" as const, end: defenseEnd(48) };
    expectRule(() => play(kickoffState({ score: { home: 7, away: 7 } }, rules), p, {}, rules), "onsideNotAllowed");
    expect(play(kickoffState({ score: { home: 0, away: 7 } }, rules), p, {}, rules).phase).toBe("scrimmage");
  });

  it("rejected outside the final period when a rule set allows it only then", () => {
    const rules = fixtureRules({ kickoff: { onside: { allowedWhen: "trailingInFinalPeriod", declarationRequired: true } } });
    const p = { kind: "onsideKick" as const, seconds: 3, outcome: "inPlay" as const, end: defenseEnd(48) };
    expectRule(() => play(kickoffState({ score: { home: 0, away: 7 }, period: 3 }, rules), p, {}, rules), "onsideNotAllowed");
    expect(play(kickoffState({ score: { home: 0, away: 7 }, period: 4 }, rules), p, {}, rules).phase).toBe("scrimmage");
  });
});

describe("punts (B10)", () => {
  const s0 = scrimmage({ down: 4, distance: 6, spot: 30 });
  const punt = (end: ReturnType<typeof defenseEnd>, extra: Record<string, unknown> = {}) => ({
    kind: "punt" as const,
    seconds: 6,
    crossedLine: true,
    touchedByReceivers: false,
    end,
    ...extra,
  });

  it("touchback: receivers at the punt touchback spot", () => {
    const s = play(s0, punt(defenseEnd(102)));
    expect([s.possession, s.spot]).toEqual(["away", R.punt.touchbackSpot]);
  });

  it("fair catch: receivers at the spot of the catch", () => {
    const s = play(s0, punt(defenseEnd(75), { fairCatch: true }));
    expect([s.possession, s.spot]).toEqual(["away", 25]);
  });

  it("downed by the kickers or out of bounds: receivers at the dead-ball spot", () => {
    expect(play(s0, punt(defenseEnd(92))).spot).toBe(8);
    expect(play(s0, punt(defenseEnd(80))).spot).toBe(20);
  });

  it("returned: receivers at the end of the return", () => {
    const s = play(s0, punt(defenseEnd(60)));
    expect([s.possession, s.spot, s.down]).toEqual(["away", 40, 1]);
  });

  it("return touchdown scores for the receivers", () => {
    const s = play(s0, punt(defenseEnd(-1)));
    expect([s.phase, s.possession, s.score.away]).toEqual(["try", "away", R.scoring.touchdown]);
  });

  it("muffed by the receivers and recovered by the kickers: kickers' 1st and 10", () => {
    const s = play(s0, punt(offenseEnd(70), { touchedByReceivers: true }));
    expect([s.possession, s.spot, s.down, s.distance]).toEqual(["home", 70, 1, 10]);
  });

  it("muffed and recovered by the receivers: their ball", () => {
    const s = play(s0, punt(defenseEnd(70), { touchedByReceivers: true }));
    expect([s.possession, s.spot]).toEqual(["away", 30]);
  });

  it("recovered by the kickers beyond the line without a receiver touching it: receivers' ball there", () => {
    const s = play(s0, punt(offenseEnd(70)));
    expect([s.possession, s.spot]).toEqual(["away", 30]);
  });

  it("blocked behind the line and recovered by the kickers short of the line to gain: turnover on downs (Rule 9-3-1)", () => {
    const s = play(s0, { kind: "punt", seconds: 4, crossedLine: false, touchedByReceivers: false, end: offenseEnd(24) });
    expect([s.possession, s.spot, s.down]).toEqual(["away", 76, 1]);
  });

  it("blocked and recovered by the kickers past the line to gain: kickers' first down", () => {
    const s = play(s0, { kind: "punt", seconds: 4, crossedLine: false, touchedByReceivers: false, end: offenseEnd(37) });
    expect([s.possession, s.spot, s.down]).toEqual(["home", 37, 1]);
  });

  it("blocked and recovered by the defense: its ball", () => {
    const s = play(s0, { kind: "punt", seconds: 4, crossedLine: false, touchedByReceivers: false, end: defenseEnd(22) });
    expect([s.possession, s.spot]).toEqual(["away", 78]);
  });

  it("a punt returner downed in his own end zone after carrying it in gives up a safety", () => {
    const s = play(s0, punt(defenseEnd(101, "defense")));
    expect([s.score.home, s.phase, s.possession]).toEqual([R.scoring.safety, "kickoff", "away"]);
  });
});
