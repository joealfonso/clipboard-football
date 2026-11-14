// Messages across the worker boundary are checked both ways (messages.ts), and every request
// carries the state it is decided in (the engine's request.state and request.events).

import { describe, expect, it } from "vitest";
import { isAnswerShape, isFromWorker, isToWorker } from "../src/engine/messages";
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

describe("request state", () => {
  it("every request after the toss carries its state, and a human defense sees the run-off before the snap", () => {
    const g = playGame(42, "away");
    const later = g.requests.slice(2);
    for (const r of later) expect(r.state, r.kind).not.toBeNull();
    const runoffBeforeDefense = g.requests.some((r) => r.kind === "defenseCall" && r.events.some((e) => e.t === "runoff"));
    expect(runoffBeforeDefense).toBe(true);
  });
});
