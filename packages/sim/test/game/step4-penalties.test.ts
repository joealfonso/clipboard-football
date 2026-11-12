// M1 step 4 added offensive pass interference, illegal contact and live-ball unnecessary
// roughness to the rule set (spec resolved question 5). Enforcement through the machine.

import { describe, expect, it } from "vitest";
import type { Foul, PlayResult } from "../../../shared/src/types";
import { penaltyOptions } from "../../src/game/machine";
import { defenseEnd, incomplete, offenseEnd, play, real, run, scrimmage, tryState } from "./helpers";

const R = real();
const P = R.penalties;
const accept = { penalty: { kind: "accept" as const, foul: 0 } };
const decline = { penalty: { kind: "decline" as const } };
const withFoul = (p: PlayResult, ...fouls: Foul[]): PlayResult => ({ ...p, fouls });

describe("offensive pass interference", () => {
  const s0 = scrimmage({ spot: 40, down: 2, distance: 6 });

  it("is 10 yards from the previous spot, down repeated, no loss of down", () => {
    expect(P.offensivePassInterference?.yards).toBe(10);
    const s = play(s0, withFoul(incomplete(s0), { penalty: "offensivePassInterference", by: "offense" }), accept);
    expect([s.spot, s.down, s.distance]).toEqual([30, 2, 16]);
  });

  it("is half the distance inside the offense's own 20", () => {
    const s1 = scrimmage({ spot: 8, down: 1, distance: 10 });
    expect(play(s1, withFoul(incomplete(s1), { penalty: "offensivePassInterference", by: "offense" }), accept).spot).toBe(4);
  });

  it("cannot be called on the defense", () => {
    expect(() => play(s0, withFoul(incomplete(s0), { penalty: "offensivePassInterference", by: "defense" }))).toThrow();
  });
});

describe("illegal contact", () => {
  it("is 5 yards from the previous spot and an automatic first down", () => {
    const s0 = scrimmage({ spot: 40, down: 3, distance: 9 });
    const s = play(s0, withFoul(incomplete(s0), { penalty: "illegalContact", by: "defense" }), accept);
    expect([s.spot, s.down, s.distance]).toEqual([45, 1, 10]);
  });

  it("on a try moves the try spots", () => {
    const t0 = tryState();
    const s = play(t0, withFoul({ kind: "twoPoint", seconds: 4, incomplete: true, end: offenseEnd(t0.spot) }, { penalty: "illegalContact", by: "defense" }), accept);
    expect(s.phase).toBe("try");
    expect(s.trySpots?.twoPoint).toBe(99);
  });
});

describe("unnecessary roughness during the down", () => {
  const s0 = scrimmage({ spot: 30, down: 2, distance: 10 });

  it("by the defense: 15 from the previous spot or the dead-ball spot, whichever is better, and a first down", () => {
    const shortRun = play(s0, withFoul(run(32), { penalty: "unnecessaryRoughness", by: "defense" }), accept);
    expect([shortRun.spot, shortRun.down]).toEqual([47, 1]);
    const loss = play(s0, withFoul(run(26), { penalty: "unnecessaryRoughness", by: "defense" }), accept);
    expect([loss.spot, loss.down]).toEqual([45, 1]);
  });

  it("by the offense: 15 yards, the worse of the two spots for the offense (designed)", () => {
    const s = play(s0, withFoul(run(38), { penalty: "unnecessaryRoughness", by: "offense" }), accept);
    expect([s.spot, s.down]).toEqual([15, 2]);
  });

  it("by the defense on an interception: the offense keeps the ball", () => {
    const s = play(s0, withFoul({ kind: "pass", seconds: 5, turnover: "interception", end: defenseEnd(60) }, { penalty: "unnecessaryRoughness", by: "defense" }), accept);
    expect([s.possession, s.spot, s.down]).toEqual(["home", 45, 1]);
  });

  it("is declinable, and either team can commit it", () => {
    const p = withFoul(run(32), { penalty: "unnecessaryRoughness", by: "offense" });
    expect(penaltyOptions(s0, R, p).map((o) => o.kind)).toEqual(["decline", "accept"]);
    expect(play(s0, p, decline).spot).toBe(32);
  });
});
