// B1 to B7, B11, B14: toss, downs, scoring, tries, field goals, safeties, turnovers, game end.

import { describe, expect, it } from "vitest";
import { Rng } from "../../src/rng";
import { newGame } from "../../src/game/machine";
import { defenseEnd, incomplete, offenseEnd, play, real, run, scrimmage, start, tryState } from "./helpers";

const rules = real();
const R = rules;

describe("new game and coin toss (B1)", () => {
  it("uses exactly one Rng draw and stores the seed", () => {
    const rng = Rng.fromSeed(42);
    const probe = Rng.fromSeed(42);
    probe.nextUint32();
    const s = newGame(rules, { gameType: "regularSeason", seed: 42, rulesHash: "h" }, rng);
    expect(rng.getState()).toEqual(probe.getState());
    expect(s.seed).toBe(42);
    expect(s.rules).toEqual({ id: "nfl-2026", hash: "h" });
  });

  it("gives the same toss for the same seed, and both winners occur across seeds", () => {
    const winners = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      const a = newGame(rules, { gameType: "regularSeason", seed, rulesHash: "h" }, Rng.fromSeed(seed));
      const b = newGame(rules, { gameType: "regularSeason", seed, rulesHash: "h" }, Rng.fromSeed(seed));
      expect(a).toEqual(b);
      winners.add(a.toss.winner);
    }
    expect(winners.size).toBe(2);
  });

  // defer: winner kicks, winner receives the second half. receive: winner receives, loser
  // receives the second half. kick: winner kicks, loser receives the second half.
  it.each(["defer", "receive", "kick"] as const)("toss choice %s sets the opening kicker and second-half receiver", (choice) => {
    const s = newGame(rules, { gameType: "regularSeason", seed: 3, rulesHash: "h", tossChoice: choice }, Rng.fromSeed(3));
    const w = s.toss.winner;
    const l = w === "home" ? "away" : "home";
    const receiver = s.possession === "home" ? "away" : "home";
    expect(s.phase).toBe("kickoff");
    expect(s.spot).toBe(R.kickoff.spot);
    if (choice === "receive") {
      expect(receiver).toBe(w);
      expect(s.toss.secondHalfReceiver).toBe(l);
    } else if (choice === "kick") {
      expect(receiver).toBe(l);
      expect(s.toss.secondHalfReceiver).toBe(l);
    } else {
      expect(receiver).toBe(l);
      expect(s.toss.secondHalfReceiver).toBe(w);
    }
  });
});

describe("downs (B2, B3)", () => {
  it("a short gain increments the down and cuts the distance", () => {
    const s = play(scrimmage(), run(29));
    expect([s.down, s.distance, s.spot, s.possession]).toEqual([2, 6, 29, "home"]);
  });

  it("a loss adds to the distance", () => {
    const s = play(scrimmage({ down: 2, distance: 6 }), run(22));
    expect([s.down, s.distance]).toEqual([3, 9]);
  });

  it("reaching the line to gain is 1st and the rule set's distance", () => {
    const s = play(scrimmage({ down: 3, distance: 4 }), run(29));
    expect([s.down, s.distance, s.goalToGo]).toEqual([1, R.downs.yardsForFirstDown, false]);
  });

  it("a first down inside the 10 is goal to go with distance to the goal", () => {
    const s = play(scrimmage({ spot: 80 }), run(93));
    expect([s.down, s.distance, s.goalToGo]).toEqual([1, 7, true]);
  });

  it("failing on the last down turns the ball over at the dead-ball spot, flipped", () => {
    const s = play(scrimmage({ down: 4, distance: 3, spot: 40 }), run(41));
    expect([s.possession, s.spot, s.down, s.distance]).toEqual(["away", 59, 1, 10]);
  });

  it("a turnover on downs inside the opponent's 10 gives goal to go to the new offense", () => {
    const s = play(scrimmage({ down: 4, distance: 3, spot: 6 }), run(5));
    expect([s.possession, s.spot, s.down, s.distance, s.goalToGo]).toEqual(["away", 95, 1, 5, true]);
  });
});

describe("touchdowns and tries (B4, B5)", () => {
  it("an offensive touchdown scores and the scoring team tries", () => {
    const s = play(scrimmage({ spot: 90, distance: 10, goalToGo: true }), run(101, 5, { touchdown: true }));
    expect(s.score).toEqual({ home: R.scoring.touchdown, away: 0 });
    expect([s.phase, s.possession, s.spot]).toEqual(["try", "home", 100 - R.try.twoPointSpot]);
    expect(s.trySpots).toEqual({ kick: 100 - R.try.kickSpot, twoPoint: 100 - R.try.twoPointSpot });
  });

  it.each([
    ["interception return", { kind: "pass" as const, seconds: 6, turnover: "interception" as const, end: defenseEnd(-2) }],
    ["fumble return", { kind: "run" as const, seconds: 6, turnover: "fumble" as const, end: defenseEnd(-1) }],
  ])("a defensive touchdown on a %s scores for the defense", (_n, p) => {
    const s = play(scrimmage({ spot: 30 }), p);
    expect(s.score).toEqual({ home: 0, away: R.scoring.touchdown });
    expect([s.phase, s.possession]).toEqual(["try", "away"]);
  });

  it("a good kick adds the kick points, takes no clock, and the scoring team kicks off", () => {
    const t = tryState({ clock: 300 });
    const s = play(t, { kind: "extraPoint", seconds: 4, good: true });
    expect(s.score.home).toBe(6 + R.scoring.tryKick);
    expect(s.clock).toBe(300);
    expect([s.phase, s.possession, s.spot]).toEqual(["kickoff", "home", R.kickoff.spot]);
  });

  it("a good two-point try adds its points; a failed one adds none", () => {
    const t = tryState();
    expect(play(t, { kind: "twoPoint", seconds: 4, end: offenseEnd(101) }).score.home).toBe(6 + R.scoring.tryTouchdown);
    const failed = play(t, { kind: "twoPoint", seconds: 4, incomplete: true, end: offenseEnd(t.spot) });
    expect(failed.score).toEqual({ home: 6, away: 0 });
    expect(failed.possession).toBe("home");
    expect(failed.phase).toBe("kickoff");
  });

  it("a two-point try returned by the defense scores the defense's try points", () => {
    const s = play(tryState(), { kind: "twoPoint", seconds: 8, end: defenseEnd(-3) });
    expect(s.score).toEqual({ home: 6, away: R.scoring.tryTouchdown });
    expect([s.phase, s.possession]).toEqual(["kickoff", "home"]);
  });

  it("a blocked kick returned by the defense scores for the defense", () => {
    const s = play(tryState(), { kind: "extraPoint", seconds: 8, good: false, end: defenseEnd(-1) });
    expect(s.score.away).toBe(R.scoring.tryTouchdown);
  });

  it("what would be a safety on a try gives one point to the opponent", () => {
    const s = play(tryState(), { kind: "twoPoint", seconds: 8, end: offenseEnd(-1) });
    expect(s.score).toEqual({ home: 6, away: R.scoring.trySafety });
  });
});

describe("field goals (B6)", () => {
  it("a good kick scores and the kicking team kicks off", () => {
    const s = play(scrimmage({ spot: 70, down: 4 }), { kind: "fieldGoal", seconds: 4, good: true, kickSpot: 63 });
    expect(s.score.home).toBe(R.scoring.fieldGoal);
    expect([s.phase, s.possession]).toEqual(["kickoff", "home"]);
  });

  it("a miss gives the other team the ball at the spot of the kick", () => {
    const s = play(scrimmage({ spot: 62, down: 4 }), { kind: "fieldGoal", seconds: 4, good: false, kickSpot: 55 });
    expect([s.possession, s.spot, s.down]).toEqual(["away", 45, 1]);
  });

  it("a miss from inside the minimum spot gives the ball at the minimum spot", () => {
    const s = play(scrimmage({ spot: 90, down: 4, distance: 10, goalToGo: true }), { kind: "fieldGoal", seconds: 4, good: false, kickSpot: 83 });
    expect([s.possession, s.spot]).toEqual(["away", R.fieldGoal.missedMinimumSpot]);
  });

  it("a blocked kick recovered by the defense is its ball at the dead-ball spot", () => {
    const s = play(scrimmage({ spot: 70, down: 4 }), { kind: "fieldGoal", seconds: 4, good: false, kickSpot: 63, end: defenseEnd(55) });
    expect([s.possession, s.spot]).toEqual(["away", 45]);
  });
});

describe("safeties and touchbacks (B7)", () => {
  it("a ball dead in the offense's own end zone with its impetus is a safety", () => {
    const s = play(scrimmage({ spot: 3 }), { kind: "sack", seconds: 5, end: offenseEnd(-1) });
    expect(s.score).toEqual({ home: 0, away: R.scoring.safety });
    expect([s.phase, s.possession, s.spot, s.safetyKick]).toEqual(["kickoff", "home", R.kickoff.safetyKickSpot, true]);
  });

  it("a ball dead in the defense's end zone with the offense's impetus is a touchback", () => {
    const s = play(scrimmage({ spot: 60 }), { kind: "pass", seconds: 5, turnover: "interception", end: defenseEnd(104) });
    expect([s.possession, s.spot, s.score.home, s.score.away]).toEqual(["away", R.touchback.scrimmageSpot, 0, 0]);
  });

  it("an interceptor who carries the ball back into his own end zone and is downed gives up a safety", () => {
    const s = play(scrimmage({ spot: 60 }), { kind: "pass", seconds: 5, turnover: "interception", end: defenseEnd(101, "defense") });
    expect(s.score).toEqual({ home: R.scoring.safety, away: 0 });
    expect([s.phase, s.possession]).toEqual(["kickoff", "away"]);
  });

  it("an offense recovery in its own end zone from the defense's impetus is a touchback for the offense", () => {
    const s = play(scrimmage({ spot: 4 }), { kind: "run", seconds: 5, end: offenseEnd(-1, "defense") });
    expect([s.possession, s.spot, s.score.away]).toEqual(["home", R.touchback.scrimmageSpot, 0]);
  });
});

describe("turnovers (B11)", () => {
  it("an interception flips possession at the return's end, 1st and 10", () => {
    const s = play(scrimmage({ spot: 40, down: 2, distance: 7 }), { kind: "pass", seconds: 7, turnover: "interception", end: defenseEnd(55) });
    expect([s.possession, s.spot, s.down, s.distance]).toEqual(["away", 45, 1, 10]);
  });

  it("a lost fumble flips possession at the dead-ball spot", () => {
    const s = play(scrimmage({ spot: 40 }), { kind: "run", seconds: 4, turnover: "fumble", end: defenseEnd(38) });
    expect([s.possession, s.spot]).toEqual(["away", 62]);
  });

  it("an offense fumble it recovers itself keeps the series", () => {
    const s = play(scrimmage({ spot: 40 }), { kind: "run", seconds: 4, end: offenseEnd(37) });
    expect([s.possession, s.down, s.distance]).toEqual(["home", 2, 13]);
  });
});

describe("end of regulation (B14)", () => {
  it("time running out in the last period with a leader ends the game", () => {
    const s = play(scrimmage({ period: 4, clock: 5, score: { home: 10, away: 3 } }), run(30, 6));
    expect(s.phase).toBe("final");
    expect(s.result).toEqual({ reason: "regulation", winner: "home" });
  });

  it("an incomplete pass as time expires ends the game with the trailing team losing", () => {
    const s0 = scrimmage({ period: 4, clock: 4, score: { home: 10, away: 13 }, timeouts: { home: 0, away: 1 }, down: 4 });
    const s = play(s0, incomplete(s0, 5));
    expect(s.result).toEqual({ reason: "regulation", winner: "away" });
  });

  it("starts in phase kickoff with nothing on the scoreboard", () => {
    const s = start();
    expect([s.phase, s.period, s.clock, s.score.home, s.score.away]).toEqual(["kickoff", 1, R.game.periodSeconds, 0, 0]);
  });
});
