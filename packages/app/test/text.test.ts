// HUD and panel text: clock, down and distance, yard lines from the human's side, the result
// line naming only the players the engine named (H2), the calls line, event lines, reasons.

import { describe, expect, it } from "vitest";
import { callsLine, clockText, continueText, eventLine, nextText, penaltyChoiceText, penaltyText, periodText, playerRef, reasonText, resultLine, sideText, situationText, yardLineText, type TextCtx } from "../src/ui/text";
import { REASON_CODES } from "@clipboard-football/shared";
import { whyHeadline } from "../src/engine/headline";
import { ALL_FIXTURES, COMPLETE, FALSE_START, FIELD_GOAL_GOOD, HOLDING_ON_RUN, INCOMPLETE, INTERCEPTION, KICKOFF_RETURN, KICKOFF_TOUCHBACK, PUNT_RETURNED, RUN, SACK, STANDOUT_RUN, TOUCHDOWN, UNNAMED_COMPLETE, fixturePlayers, snap } from "./fixtures";

const ctx: TextCtx = {
  human: "home",
  teams: { home: { name: "Riverbend Pilots", nickname: "Pilots" }, away: { name: "Harborview Lanterns", nickname: "Lanterns" } },
  players: fixturePlayers(),
  labels: { shotgun: "Shotgun", shortPass: "Short pass", nickelCover3: "Nickel Cover 3", deepPass: "Deep pass", insideRun: "Inside run", falseStart: "a false start", offensiveHolding: "holding", punt: "Punt", returnedShort: "a returned punt" },
  regulationPeriods: 4,
  endZoneYards: 10,
};

describe("clock and periods", () => {
  it("formats the game clock as m:ss", () => {
    expect(clockText(900)).toBe("15:00");
    expect(clockText(119)).toBe("1:59");
    expect(clockText(5)).toBe("0:05");
    expect(clockText(0)).toBe("0:00");
    expect(clockText(-3)).toBe("0:00");
  });

  it("names quarters and overtime periods", () => {
    expect([1, 2, 3, 4, 5, 6].map((p) => periodText(p, 4))).toEqual(["1st", "2nd", "3rd", "4th", "OT", "OT2"]);
  });
});

describe("down, distance and yard lines", () => {
  it("OPP always means the opponent's half, whoever has the ball", () => {
    expect(yardLineText(62, "home", "home")).toBe("OPP 38");
    expect(yardLineText(20, "home", "home")).toBe("OWN 20");
    // The opponent has the ball at its own 20: that is the human's opponent's half.
    expect(yardLineText(20, "away", "home")).toBe("OPP 20");
    expect(yardLineText(75, "away", "home")).toBe("OWN 25");
    expect(yardLineText(50, "away", "home")).toBe("50");
  });

  it("situation header", () => {
    expect(situationText(snap({ down: 3, distance: 4, spot: 62 }), "home")).toBe("3rd & 4 at OPP 38");
    expect(situationText(snap({ down: 1, distance: 9, spot: 91, goalToGo: true }), "home")).toBe("1st & goal at OPP 9");
    expect(situationText(snap({ phase: "kickoff" }), "home")).toBe("Kickoff");
    expect(situationText(snap({ phase: "kickoff", safetyKick: true }), "home")).toBe("Safety kick");
    expect(situationText(snap({ phase: "try" }), "home")).toBe("Try");
  });

  it("says which side the human is on", () => {
    expect(sideText(snap({ possession: "home" }), "home")).toBe("You're on offense");
    expect(sideText(snap({ possession: "away" }), "home")).toBe("You're on defense");
    expect(sideText(snap({ phase: "kickoff", possession: "away" }), "home")).toBe("You're receiving");
  });
});

describe("the result line names only players the engine named (H2)", () => {
  it("a completion describes the play and names nobody", () => {
    expect(resultLine(COMPLETE, ctx)).toBe("Pass complete for 7. Your ball, 1st & 10 at OWN 47.");
  });

  it("with no participants it names nobody", () => {
    const line = resultLine(UNNAMED_COMPLETE, ctx);
    expect(line).toMatch(/^Pass complete for 12\./);
    expect(line).not.toMatch(/#/);
  });

  it("no fixture's line names a player or a jersey number", () => {
    const names = [...fixturePlayers().values()].map((v) => v.name.split(" ").slice(1).join(" "));
    for (const [k, ev] of Object.entries(ALL_FIXTURES)) {
      const line = resultLine(ev, ctx);
      expect(line, k).not.toMatch(/#\d/);
      for (const n of names) expect(line.includes(n), `${k}: ${line}`).toBe(false);
    }
  });

  it("an incompletion says so without the target", () => {
    expect(resultLine(INCOMPLETE, ctx)).toMatch(/^Pass incomplete\. /);
  });

  it("an interception, a sack, a run, a punt, a field goal, a kickoff", () => {
    expect(resultLine(INTERCEPTION, ctx)).toMatch(/^Pass intercepted\. Lanterns ball, 1st & 10 at OPP 48\./);
    expect(resultLine(SACK, ctx)).toMatch(/^Quarterback sacked for a loss of 7\./);
    expect(resultLine(RUN, ctx)).toBe("Run for 4. Your ball, 3rd & 3 at OWN 44.");
    expect(resultLine(PUNT_RETURNED, ctx)).toMatch(/^Punt 45 yards, returned\./);
    expect(resultLine(FIELD_GOAL_GOOD, ctx)).toMatch(/47-yard field goal is good\. Kickoff next\./);
    expect(resultLine(KICKOFF_TOUCHBACK, ctx)).toMatch(/^Kickoff, touchback\. /);
    expect(resultLine(KICKOFF_RETURN, ctx)).toMatch(/^Kickoff, returned\. /);
  });

  it("a touchdown says so", () => {
    expect(resultLine(TOUCHDOWN, ctx)).toMatch(/for 60\. Touchdown\. Try next\./);
  });

  it("flags name the foul and the team, not the player", () => {
    expect(penaltyText(FALSE_START, ctx)).toBe("Flag: a false start on the Pilots, accepted.");
    expect(resultLine(HOLDING_ON_RUN, ctx)).toMatch(/Flag: holding on the Pilots, accepted\./);
  });

  it("a standout play starts with Standout", () => {
    expect(resultLine(STANDOUT_RUN, ctx)).toMatch(/^Standout: /);
  });

  it("playerRef returns nothing for an id it doesn't know", () => {
    expect(playerRef("nobody", ctx)).toBeUndefined();
    expect(playerRef(undefined, ctx)).toBeUndefined();
  });
});

describe("calls, events and reasons", () => {
  it("shows both calls after the snap, from the human's side", () => {
    expect(callsLine(COMPLETE, ctx)).toBe("You: Shotgun, Short pass. They: Nickel Cover 3.");
    expect(callsLine(COMPLETE, { ...ctx, human: "away" })).toBe("You: Nickel Cover 3. They: Shotgun, Short pass.");
    expect(callsLine(PUNT_RETURNED, { ...ctx, human: "away" })).toBe("You: no call. They: Punt.");
  });

  it("event lines", () => {
    const before = snap();
    expect(eventLine({ t: "timeout", before, team: "away", side: "defense", left: 2 }, ctx)).toBe("Timeout, Lanterns (2 left).");
    expect(eventLine({ t: "runoff", before, seconds: 31, drawn: 31, after: before }, ctx)).toBe("Clock ran 31 s before the snap.");
    expect(eventLine({ t: "twoMinuteWarning", period: 2 }, ctx)).toBe("Two-minute warning.");
    expect(eventLine({ t: "endPeriod", period: 1, score: { home: 0, away: 0 } }, ctx)).toBe("End of the 1st quarter.");
    expect(eventLine({ t: "endPeriod", period: 4, score: { home: 0, away: 0 } }, ctx)).toBe("End of regulation.");
    expect(eventLine(COMPLETE, ctx)).toBeNull();
  });

  it("every reason code has words", () => {
    // Every code the engine can send has words of its own.
    for (const c of REASON_CODES) expect(reasonText(c), c).not.toBe("not now");
    expect(reasonText("kickNotNow")).toBe("4th down or last 2:00 only");
    expect(reasonText("noTimeouts")).toBe("No timeouts left");
  });

  it("penalty options show the state each leaves", () => {
    expect(penaltyChoiceText("accept:0", snap({ down: 1, distance: 10, spot: 67 }), ctx, [{ penalty: "offensiveHolding", by: "defense" }])).toBe("Accept holding: 1st & 10 at OPP 33");
    expect(penaltyChoiceText("decline", snap({ down: 3, distance: 2, spot: 52 }), ctx, [])).toBe("Decline: 3rd & 2 at OPP 48");
  });

  it("next line after a change of possession names the team with the ball", () => {
    expect(nextText(snap({ possession: "away", spot: 20, down: 1, distance: 10 }), ctx)).toBe("Lanterns ball, 1st & 10 at OPP 20.");
  });
});

describe("the why line", () => {
  it("is the engine's headline when there is one", () => {
    expect(whyHeadline(COMPLETE.play)).toBe("A short completion, a common result here.");
  });

  it("is null with no headline, never the detail sentence or UI text", () => {
    expect(whyHeadline({ ...COMPLETE.play, detail: { why: "The detail line, with x1.34." } })).toBeNull();
    expect(whyHeadline({ ...COMPLETE.play, detail: {} })).toBeNull();
  });
});

describe("continue dead balls", () => {
  it("say what the other team visibly lines up for, and the toss result", () => {
    expect(continueText({ what: "theyLineUp", call: "punt" }, ctx)).toBe("The Lanterns line up to punt.");
    expect(continueText({ what: "theyKickOff", onside: true, safetyKick: false }, ctx)).toBe("The Lanterns declare an onside kick.");
    expect(continueText({ what: "tossResult", winner: "away", choice: "defer" }, ctx)).toBe("The Lanterns won the toss and chose to defer.");
  });
});
