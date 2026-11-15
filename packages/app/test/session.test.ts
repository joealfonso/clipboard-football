// The worker Session over the engine's step-wise loop: a whole game, no opponent call in any
// message before the snap (F5), refused answers change nothing (E5), and saves resume to the same
// game (S2) or are refused as older or damaged.

import { describe, expect, it } from "vitest";
import type { FromWorker } from "../src/engine/protocol";
import { SAVE_SCHEMA_VERSION, Session, checkSave, type SaveData } from "../src/engine/session";
import type { PlayEvent } from "../src/engine/types";
import { playGame, prepared, scriptedAnswer } from "./support";

describe("a whole game through the worker session", () => {
  const g = playGame(31, "home");

  it("ends, with every play naming its players and carrying a headline and onField", () => {
    expect(g.state?.phase).toBe("final");
    const plays = g.events.filter((e): e is PlayEvent => e.t === "play");
    expect(plays.length).toBeGreaterThan(100);
    for (const p of plays) {
      const d = p.play.detail as Record<string, unknown>;
      expect(typeof d["headline"]).toBe("string");
      expect(d["participants"]).toBeTypeOf("object");
      expect(d["onField"]).toBeTypeOf("object");
    }
  });

  it("every step message carries the save, version 2, with the engine's answer log", () => {
    const last = g.sent[g.sent.length - 1];
    if (last?.t !== "step") throw new Error("no step");
    expect(last.save).toMatchObject({ schemaVersion: SAVE_SCHEMA_VERSION, dataHash: "test-data-hash", codeHash: "test-code-hash", leagueSeed: 2026, seed: 31, human: "home", gameType: "regularSeason" });
    expect(last.save.log).toEqual(g.answers);
  });
});

describe("the opponent's call never reaches the UI before the snap (F5)", () => {
  it.each([
    [32, "home"],
    [33, "away"],
  ] as const)("seed %i, human %s", (seed, human) => {
    const g = playGame(seed, human, 3);
    let checked = 0;
    let reqIndex = 0;
    // Pair each request with the play the answer to it led to.
    for (let i = 0; i < g.sent.length - 1; i++) {
      const msg = g.sent[i];
      const reply = g.sent[i + 1];
      if (msg?.t !== "step" || msg.request === null || reply?.t !== "step") continue;
      const req = msg.request;
      reqIndex++;
      const snap = reply.events.find((e): e is PlayEvent => e.t === "play");
      if (snap === undefined || req.kind === "penalty" || req.kind === "runoff") continue;
      const ai = snap.before.possession === human ? snap.defense : snap.offense.call;
      if (ai === null) continue;
      if (req.kind === "continue") {
        // Only what lining up shows: a kick, kneel or spike, or the kickoff.
        if (req.about.what === "theyLineUp") expect(["punt", "fieldGoal", "extraPoint", "kneel", "spike"]).toContain(req.about.call);
        continue;
      }
      // The AI's call may appear only as one of the human's own option ids, never anywhere else.
      const withoutOptions = JSON.stringify({ ...req, screens: [] });
      expect(withoutOptions, `${req.kind} ${ai}`).not.toContain(`"${ai}"`);
      if (snap.before.possession === human) {
        // A human offense never sees a defense preset anywhere in its request.
        expect(JSON.stringify(req)).not.toContain(`"${ai}"`);
      }
      checked++;
    }
    expect(reqIndex).toBeGreaterThan(100);
    expect(checked).toBeGreaterThan(50);
  });
});

describe("answers and saves", () => {
  it("an illegal or stale answer is refused and changes nothing (E5)", () => {
    const sent: FromWorker[] = [];
    const s = new Session(prepared(), (m) => sent.push(m));
    s.handle({ t: "newGame", leagueSeed: 2026, seed: 34, human: "away" });
    const first = sent[0];
    if (first?.t !== "step" || first.request === null) throw new Error("no request");
    for (const path of [["teleport"], [], ["receive", "more"]]) s.handle({ t: "answer", answer: { seq: first.request.seq, path } });
    s.handle({ t: "answer", answer: { seq: first.request.seq + 5, path: [first.request.screens[0]?.options[0]?.id ?? ""] } });
    expect(sent.slice(1).map((m) => m.t)).toEqual(["answerError", "answerError", "answerError", "answerError"]);
    // The same request still takes a good answer.
    s.handle({ t: "answer", answer: scriptedAnswer(first.request) });
    expect(sent[sent.length - 1]?.t).toBe("step");
  });

  it("resuming the save from any point finishes the same game as not quitting (S2)", () => {
    const g = playGame(35, "home", 5);
    const steps = g.sent.filter((m): m is Extract<FromWorker, { t: "step" }> => m.t === "step");
    for (const cut of [1, 20, Math.floor(steps.length / 2), steps.length - 2]) {
      const at = steps[cut];
      if (at === undefined) continue;
      const sent: FromWorker[] = [];
      const s = new Session(prepared(), (m) => sent.push(structuredClone(m)));
      s.handle({ t: "resume", save: JSON.parse(JSON.stringify(at.save)) });
      const resumed = sent[0];
      if (resumed?.t !== "step") throw new Error(`resume gave ${resumed?.t}`);
      expect(resumed.resumed).toBe(true);
      expect(resumed.request).toEqual(at.request);
      const events = [...resumed.events];
      let req = resumed.request;
      let n = at.save.log.length;
      while (req !== null) {
        s.handle({ t: "answer", answer: g.answers[n] as ReturnType<typeof scriptedAnswer> });
        n++;
        const r = sent[sent.length - 1];
        if (r?.t !== "step") throw new Error(`answer gave ${r?.t}`);
        events.push(...r.events);
        req = r.request;
      }
      expect(events).toEqual(g.events);
    }
  });

  const good: SaveData = { schemaVersion: SAVE_SCHEMA_VERSION, dataHash: "test-data-hash", codeHash: "test-code-hash", standouts: true, leagueSeed: 2026, seed: 36, human: "home", gameType: "regularSeason", log: [] };

  it("reads a save from other data, other engine code or an earlier version as older", () => {
    const sent: FromWorker[] = [];
    const s = new Session(prepared(), (m) => sent.push(m));
    s.handle({ t: "resume", save: { ...good, dataHash: "other" } });
    s.handle({ t: "resume", save: { ...good, codeHash: "an-older-build" } });
    const { codeHash: _drop, ...v2 } = good;
    void _drop;
    s.handle({ t: "resume", save: { ...v2, schemaVersion: 2 } });
    s.handle({ t: "resume", save: { ...good, schemaVersion: 1, log: [{ kind: "continue" }] } });
    expect(sent.map((m) => (m.t === "saveError" ? m.reason : m.t))).toEqual(["older", "older", "older", "older"]);
  });

  it("reads junk, answers the schema rejects, and any log that fails to replay as damaged, never a sim error", () => {
    const sent: FromWorker[] = [];
    const s = new Session(prepared(), (m) => sent.push(m));
    const g = playGame(36, "home");
    const bad: unknown[] = [
      { nonsense: true },
      null,
      [],
      { ...good, seed: -1 },
      { ...good, human: "both" },
      { ...good, log: [{ kind: "continue" }] },
      { ...good, log: [{ seq: 0, path: ["continue"] }] },
      { ...good, log: [{ seq: 1, path: [] }] },
      { ...good, log: [{ seq: 1, path: ["teleport"] }] },
      // A real log with one answer changed so the replay rejects it part way through.
      { ...good, log: g.answers.map((a, i) => (i === 40 ? { seq: a.seq, path: ["teleport"] } : a)) },
      // A real log with an answer out of order (stale seq).
      { ...good, log: [g.answers[1], g.answers[0]] },
    ];
    for (const save of bad) s.handle({ t: "resume", save });
    expect(sent.map((m) => (m.t === "saveError" ? m.reason : m.t))).toEqual(bad.map(() => "damaged"));
    s.handle({ t: "resume", save: { ...good, log: g.answers.slice(0, 30) } });
    expect(sent[sent.length - 1]?.t).toBe("step");
  });

  it("checkSave says why", () => {
    expect(checkSave(good, "test-data-hash", "test-code-hash")).toEqual({ ok: true, save: good });
    expect(checkSave(good, "test-data-hash", "new-code")).toEqual({ ok: false, reason: "older" });
    expect(checkSave("save", "test-data-hash", "test-code-hash")).toEqual({ ok: false, reason: "damaged" });
  });

  it("box and ranks come from the engine", () => {
    const g = playGame(37, "away");
    g.session.handle({ t: "box" });
    const box = g.sent[g.sent.length - 1];
    if (box?.t !== "box") throw new Error("no box");
    expect(Object.keys(box.players.players).length).toBeGreaterThan(10);
    const anyPlayer = Object.keys(box.players.players)[0] as string;
    g.session.handle({ t: "ranks", playerId: anyPlayer, leagueSeed: 2026 });
    const ranks = g.sent[g.sent.length - 1];
    expect(ranks?.t === "ranks" && Object.keys(ranks.ranks).length).toBeGreaterThan(3);
  });
});
