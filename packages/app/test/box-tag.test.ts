// Code review R1 (calling screen pass Q2): a box score request is tagged with the game and its event
// count, and the worker echoes the tag. A request it can't answer (no run yet, at the opening coin
// toss) strands nothing: the next reply carries its own tag and the game log uses it.

import { beforeAll, describe, expect, it } from "vitest";
import { isFromWorker, isToWorker } from "../src/engine/messages";
import type { FromWorker } from "../src/engine/protocol";
import { Session } from "../src/engine/session";
import { appHarness, installFakeDom, type FakeEl } from "./fake-dom";
import { prepared, scriptedAnswer } from "./support";
import { simGames } from "./sim-games";

beforeAll(() => installFakeDom(1280, 720));

describe("the worker echoes the box tag", () => {
  it("no reply before the opening toss is settled; afterwards the reply carries the request's tag", () => {
    const sent: FromWorker[] = [];
    const s = new Session(prepared(), (m) => sent.push(structuredClone(m)));
    s.handle({ t: "newGame", leagueSeed: 2026, seed: 41, human: "home" });
    const n = sent.length;
    s.handle({ t: "box", tag: { seed: 41, events: 0 } });
    expect(sent.length, "no run yet: no reply").toBe(n);
    for (let i = 0; i < 6; i++) {
      const last = sent[sent.length - 1];
      if (last?.t !== "step" || last.request === null) break;
      s.handle({ t: "answer", answer: scriptedAnswer(last.request, 1) });
    }
    s.handle({ t: "box", tag: { seed: 41, events: 7 } });
    const reply = sent[sent.length - 1];
    expect(reply?.t).toBe("box");
    expect(reply?.t === "box" ? reply.tag : null).toEqual({ seed: 41, events: 7 });
    expect(isFromWorker(reply)).toBe(true);
  });

  it("the message checks accept a tag and refuse a malformed one", () => {
    expect(isToWorker({ t: "box" })).toBe(true);
    expect(isToWorker({ t: "box", tag: { seed: 1, events: 2 } })).toBe(true);
    expect(isToWorker({ t: "box", tag: { seed: "1" } })).toBe(false);
  });
});

describe("the App: an unanswered request at the toss doesn't stick the log on loading", () => {
  it("Box score at the coin toss (no reply), then a later request: the log shows that reply's drive totals", () => {
    const g = simGames(1)[0] as ReturnType<typeof simGames>[number];
    const h = appHarness({ matchup: g.matchup, human: g.human, events: [] });
    const asked: unknown[] = [];
    Object.assign(h.app, { client: { send: (m: unknown) => asked.push(m) }, render: () => undefined });
    // At the toss: the request goes out tagged with no events, and the worker never answers it.
    h.call("requestBox");
    expect(asked.at(-1)).toEqual({ t: "box", tag: { seed: g.matchup.seed, events: 0 } });
    // Later, the whole game: a new request, and the worker's reply to it.
    h.game["events"] = [...g.events];
    h.call("requestBox");
    const tag = (asked.at(-1) as { tag: unknown }).tag;
    const box = g.sent.find((m) => m.t === "box");
    const s = g.session as unknown as { handle(m: unknown): void };
    const before = g.sent.length;
    s.handle({ t: "box", tag });
    const reply = g.sent.slice(before).find((m) => m.t === "box");
    expect(reply).toBeDefined();
    void box;
    h.call("onWorker", reply);
    const list = h.call<FakeEl[]>("gameLogBody", h.game)[0] as FakeEl;
    const heads = list.querySelectorAll(".log-head").map((x) => x.textContent);
    expect(heads.length).toBeGreaterThan(5);
    for (const t of heads) expect(t).not.toContain("Loading drive totals");
  });
});
