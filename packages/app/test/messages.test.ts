// Messages across the worker boundary are checked both ways (messages.ts), and the request
// snapshot the engine is adding is read defensively (readSnapshot).

import { describe, expect, it } from "vitest";
import { isAnswerShape, isFromWorker, isToWorker } from "../src/engine/messages";
import { readSnapshot } from "../src/engine/types";
import { playGame } from "./support";

describe("messages to the worker", () => {
  it("accepts the protocol's messages", () => {
    for (const m of [
      { t: "init" },
      { t: "box" },
      { t: "matchup", leagueSeed: 2026, seed: 4 },
      { t: "rematch", leagueSeed: 2026, seed: 4 },
      { t: "newGame", leagueSeed: 2026, seed: 4, human: "away" },
      { t: "resume", save: {} },
      { t: "answer", answer: { seq: 3, path: ["pass", "shotgun", "deepPass"] } },
      { t: "ranks", playerId: "x", leagueSeed: 2026 },
    ])
      expect(isToWorker(m), JSON.stringify(m)).toBe(true);
  });

  it("drops anything else", () => {
    for (const m of [null, "init", { t: "explode" }, { t: "newGame", leagueSeed: 1, seed: 2, human: "both" }, { t: "answer", answer: { seq: 0, path: ["x"] } }, { t: "answer", answer: { seq: 1, path: [] } }, { t: "answer", answer: { seq: 1, path: [7] } }, { t: "matchup", leagueSeed: "2026", seed: 1 }])
      expect(isToWorker(m), JSON.stringify(m)).toBe(false);
    expect(isAnswerShape({ seq: 2, path: ["continue"] })).toBe(true);
  });
});

describe("messages from the worker", () => {
  it("every message of a real game passes", () => {
    const g = playGame(41, "away");
    for (const m of g.sent) expect(isFromWorker(m), m.t).toBe(true);
  });

  it("malformed ones fail", () => {
    for (const m of [null, { t: "step" }, { t: "step", matchup: {}, human: "home", events: [], request: { kind: "toss" }, state: null, save: {}, resumed: false }, { t: "saveError", reason: "lost" }, { t: "nope" }])
      expect(isFromWorker(m), JSON.stringify(m)).toBe(false);
  });
});

describe("the request snapshot (ASSUMED shape until the engine adds it)", () => {
  it("is read when complete, under either name the description allows", () => {
    expect(readSnapshot({ snapshot: { clock: 95, clockRunning: true, period: 4, timeouts: { home: 2, away: 1 }, down: 3, distance: 4, spot: 62, runoffSeconds: 31, twoMinuteWarning: false, aiTimeout: true } })).toEqual({
      clock: 95,
      clockRunning: true,
      period: 4,
      timeouts: { home: 2, away: 1 },
      down: 3,
      distance: 4,
      spot: 62,
      runoffSeconds: 31,
      twoMinuteWarning: false,
      aiTimeout: true,
    });
    expect(readSnapshot({ snapshot: { clock: 95, running: false, quarter: 2, timeouts: { home: 2, away: 1 }, down: 1, distance: 10, spot: 25, runoff: 0 } })?.period).toBe(2);
  });

  it("is ignored when missing or incomplete, so the HUD falls back to the committed state", () => {
    expect(readSnapshot({})).toBeNull();
    expect(readSnapshot(null)).toBeNull();
    expect(readSnapshot({ snapshot: { clock: 95 } })).toBeNull();
  });
});
