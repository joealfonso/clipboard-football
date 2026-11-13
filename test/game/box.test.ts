// Box score punt and drive accounting (step 5 post-validation revision 10).

import { describe, expect, it } from "vitest";
import type { PlayResult } from "../../packages/shared/src/types";
import { boxScore, kickStands } from "../../packages/sim/src/loop/box";
import type { GameEvent, GameRecord, Snapshot } from "../../packages/sim/src/loop/play";
import { loadGameData } from "../../scripts/game/data";

const rules = loadGameData().engine.rules;

function snap(over: Partial<Snapshot>): Snapshot {
  return {
    period: 1, clock: 600, phase: "scrimmage", possession: "home", spot: 30, down: 4, distance: 5, goalToGo: false,
    score: { home: 0, away: 0 }, timeouts: { home: 3, away: 3 }, clockRunning: false, safetyKick: false, ...over,
  };
}

type PlayEvent = Extract<GameEvent, { t: "play" }>;

function play(before: Snapshot, after: Snapshot, p: PlayResult, penalty: PlayEvent["penalty"]): GameEvent {
  return { t: "play", before, offense: { call: p.kind }, defense: null, play: p, penalty, runoffTimeout: false, after };
}

function record(events: GameEvent[]): GameRecord {
  return { schemaVersion: 1, seed: 1, leagueSeed: null, gameType: "regularSeason", rules: { id: "x", hash: "x" }, dataHashes: {}, teams: { home: "H", away: "A" }, events, final: { period: 4, score: { home: 0, away: 0 } } as GameRecord["final"], inputs: 0 };
}

const first = (before: Snapshot, after: Snapshot): GameEvent =>
  play(before, after, { kind: "run", seconds: 5, end: { spot: before.spot + 2, possession: "offense" } }, null);

describe("punts with an accepted foul (revision 10)", () => {
  const b3 = snap({ down: 3, spot: 28 });
  const b4 = snap({ down: 4, spot: 30 });

  it("a punt with an accepted receiving-team foul counts as a punt and ends the drive as a punt", () => {
    const punt: PlayResult = { kind: "punt", seconds: 8, crossedLine: true, touchedByReceivers: false, end: { spot: 75, possession: "defense" }, fouls: [{ penalty: "returnTeamIllegalBlock", by: "defense", spot: 80 }] };
    const after = snap({ possession: "away", spot: 15, down: 1, distance: 10 });
    const ev = play(b4, after, punt, { kind: "accept", foul: 0 });
    expect(kickStands(ev as Extract<GameEvent, { t: "play" }>, rules)).toBe(true);
    const box = boxScore(record([first(b3, b4), ev]), rules);
    expect(box.home.punts).toBe(1);
    expect(box.drives[0]?.result).toBe("punt");
  });

  it("a punt replayed after a kicking-team foul is not a punt and does not end the drive", () => {
    const punt: PlayResult = { kind: "punt", seconds: 8, crossedLine: true, touchedByReceivers: false, end: { spot: 75, possession: "defense" }, fouls: [{ penalty: "offensiveHolding", by: "offense" }] };
    const replay = snap({ down: 4, spot: 20, distance: 15 });
    const ev = play(b4, replay, punt, { kind: "accept", foul: 0 });
    expect(kickStands(ev as Extract<GameEvent, { t: "play" }>, rules)).toBe(false);
    const box = boxScore(record([first(b3, b4), ev]), rules);
    expect(box.home.punts).toBe(0);
    expect(box.drives[0]?.result).toBe("endOfHalf");
  });
});


describe("drives that end the game on a score (code review fix)", () => {
  const b3 = snap({ period: 4, clock: 5, down: 3, spot: 95, distance: 5, goalToGo: true, score: { home: 20, away: 20 } });
  const runTd: PlayResult = { kind: "run", seconds: 5, end: { spot: 101, possession: "offense" }, touchdown: true };

  it("a touchdown whose try is skipped (moot try, final) closes as a touchdown with a 3rd-down conversion", () => {
    const after = snap({ period: 4, clock: 0, phase: "final", score: { home: 26, away: 20 } });
    const box = boxScore(record([first(snap({ period: 4, clock: 40, down: 2, spot: 93 }), b3), play(b3, after, runTd, null)]), rules);
    expect(box.drives.at(-1)?.result).toBe("touchdown");
    expect(box.home.thirdDownConversions).toBe(1);
    expect(box.home.firstDowns).toBeGreaterThanOrEqual(1);
  });

  it("an overtime walk-off touchdown closes as a touchdown", () => {
    const ot = snap({ period: 5, clock: 300, down: 1, spot: 90, distance: 10, goalToGo: true, score: { home: 20, away: 20 } });
    const after = snap({ period: 5, clock: 295, phase: "final", score: { home: 26, away: 20 } });
    const box = boxScore(record([play(ot, after, { ...runTd, seconds: 5 }, null)]), rules);
    expect(box.drives.at(-1)?.result).toBe("touchdown");
  });

  it("a pick-six on the last play closes the offense's drive as a turnover", () => {
    const pass: PlayResult = { kind: "pass", seconds: 6, turnover: "interception", end: { spot: -1, possession: "defense" }, touchdown: true };
    const before = snap({ period: 4, clock: 3, down: 1, spot: 60, distance: 10, score: { home: 20, away: 20 } });
    const after = snap({ period: 4, clock: 0, phase: "final", possession: "away", score: { home: 20, away: 26 } });
    const box = boxScore(record([play(before, after, pass, null)]), rules);
    expect(box.drives.at(-1)?.result).toBe("turnover");
    expect(box.home.interceptions).toBe(1);
  });

  it("a safety on the last play closes as a safety", () => {
    const sack: PlayResult = { kind: "sack", seconds: 4, end: { spot: -1, possession: "offense" } };
    const before = snap({ period: 4, clock: 3, down: 2, spot: 2, distance: 10, score: { home: 20, away: 20 } });
    const after = snap({ period: 4, clock: 0, phase: "final", score: { home: 20, away: 22 } });
    const box = boxScore(record([play(before, after, sack, null)]), rules);
    expect(box.drives.at(-1)?.result).toBe("safety");
  });
});

describe("a kick wiped out by an accepted foul with a first down (code review fix)", () => {
  it("is not a field goal try and does not end the drive", () => {
    const b4 = snap({ down: 4, spot: 70, distance: 3 });
    const fg: PlayResult = { kind: "fieldGoal", seconds: 4, good: false, kickSpot: 62, fouls: [{ penalty: "roughingThePasser", by: "defense" }] };
    const after = snap({ down: 1, spot: 85, distance: 10 });
    const ev = play(b4, after, fg, { kind: "accept", foul: 0 });
    expect(kickStands(ev as Extract<GameEvent, { t: "play" }>, rules)).toBe(false);
    const box = boxScore(record([first(snap({ down: 3, spot: 68 }), b4), ev]), rules);
    expect(box.home.fieldGoalAttempts).toBe(0);
    expect(box.drives).toHaveLength(1);
    expect(box.drives[0]?.result).toBe("endOfHalf");
  });

  it("a muffed punt the kickers recover is still a punt", () => {
    const b4 = snap({ down: 4, spot: 30 });
    const punt: PlayResult = { kind: "punt", seconds: 8, crossedLine: true, touchedByReceivers: true, end: { spot: 70, possession: "offense" } };
    const after = snap({ down: 1, spot: 70, distance: 10 });
    const ev = play(b4, after, punt, null);
    expect(kickStands(ev as Extract<GameEvent, { t: "play" }>, rules)).toBe(true);
  });
});

describe("first downs count only when a new set of downs is earned (code review fix)", () => {
  const firstDowns = (before: Snapshot, after: Snapshot, p: PlayResult, penalty: PlayEvent["penalty"]): number =>
    boxScore(record([play(before, after, p, penalty)]), rules).home.firstDowns;
  const run = (gain: number, fouls?: { penalty: string; by: "offense" | "defense" }[]): PlayResult =>
    ({ kind: "run", seconds: 5, end: { spot: 30 + gain, possession: "offense" }, ...(fouls === undefined ? {} : { fouls }) }) as PlayResult;

  it("accepted offensive holding on 1st and 10 is a replayed 1st down, not a first down", () => {
    const b = snap({ down: 1, distance: 10, spot: 30 });
    expect(firstDowns(b, snap({ down: 1, distance: 20, spot: 20 }), run(4, [{ penalty: "offensiveHolding", by: "offense" }]), { kind: "accept", foul: 0 })).toBe(0);
  });

  it("a non-automatic defensive foul on 1st and 10 short of the line to gain is not a first down", () => {
    const b = snap({ down: 1, distance: 10, spot: 30 });
    expect(firstDowns(b, snap({ down: 1, distance: 5, spot: 35 }), run(2, [{ penalty: "defensiveOffside", by: "defense" }]), { kind: "accept", foul: 0 })).toBe(0);
  });

  it("a muffed punt the kickers recover past the line to gain is not a first down (nflverse counts none)", () => {
    const b = snap({ down: 4, distance: 5, spot: 30 });
    const punt: PlayResult = { kind: "punt", seconds: 8, crossedLine: true, touchedByReceivers: true, end: { spot: 70, possession: "offense" } };
    expect(firstDowns(b, snap({ down: 1, distance: 10, spot: 70 }), punt, null)).toBe(0);
  });

  it("a gain to the line to gain on 1st down is a first down", () => {
    const b = snap({ down: 1, distance: 10, spot: 30 });
    expect(firstDowns(b, snap({ down: 1, distance: 10, spot: 42 }), run(12), null)).toBe(1);
  });

  it("an accepted automatic-first-down defensive foul short of the line to gain is a first down", () => {
    const b = snap({ down: 3, distance: 15, spot: 30 });
    expect(firstDowns(b, snap({ down: 1, distance: 10, spot: 35 }), run(1, [{ penalty: "defensiveHolding", by: "defense" }]), { kind: "accept", foul: 0 })).toBe(1);
  });

  it("a defensive foul whose yards reach the line to gain is a first down, on a punt too", () => {
    const b = snap({ down: 4, distance: 2, spot: 30 });
    const punt: PlayResult = { kind: "punt", seconds: 8, crossedLine: true, touchedByReceivers: false, end: { spot: 70, possession: "defense" }, fouls: [{ penalty: "defensiveOffside", by: "defense" }] };
    expect(firstDowns(b, snap({ down: 1, distance: 10, spot: 35 }), punt, { kind: "accept", foul: 0 })).toBe(1);
  });
});
