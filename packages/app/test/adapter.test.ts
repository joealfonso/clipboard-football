// The step-wise loop adapter over the M1 engine, and the worker session around it: the AI's call
// never reaches the UI before the snap (F5), illegal answers are refused and change nothing (E5),
// a save resumes to the same game (S2), Same call and tempo behave (F6, decision 3), and every
// real request's menus stay within seven rows (F3).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Catalog } from "@clipboard-football/shared";
import { AdapterError, StepLoop, type Seat } from "../src/engine/adapter";
import type { FromWorker } from "../src/engine/protocol";
import { Session } from "../src/engine/session";
import type { Answer, DecisionRequest, PlayEvent } from "../src/engine/types";
import { MAX_ROWS, openMenu, press, rows, type MenuData, type MenuKey, type MenuState } from "../src/ui/menu";
import { catalogLabels } from "../src/ui/text";
import { prepared, scriptedAnswer } from "./support";

const seat = (seed: number, human: "home" | "away" = "home"): Seat => ({ leagueSeed: 2026, seed, human, gameType: "regularSeason" });

interface Played {
  loop: StepLoop;
  requests: DecisionRequest[];
  answers: Answer[];
}

function play(s: Seat, salt = 0): Played {
  const { loop, first } = StepLoop.begin(prepared(), s);
  const requests: DecisionRequest[] = [];
  const answers: Answer[] = [];
  let req = first.request;
  while (req !== null) {
    requests.push(req);
    const a = scriptedAnswer(req, salt);
    answers.push(a);
    req = loop.answer(a).request;
  }
  return { loop, requests, answers };
}

describe("a full game through the adapter", () => {
  const g = play(seat(3));

  it("reaches the end with a final state and a sane score", () => {
    expect(g.loop.state.phase).toBe("final");
    expect(g.requests.length).toBeGreaterThan(100);
    const kinds = new Set(g.requests.map((r) => r.kind));
    for (const k of ["kickoffType", "offenseCall", "defenseCall", "continue"]) expect(kinds).toContain(k);
  });

  it("is deterministic: the same seed and answers give the same record", () => {
    const again = StepLoop.begin(prepared(), g.loop.seat, g.answers);
    expect(again.loop.record()).toEqual(g.loop.record());
  });

  it("a different answer at one request changes the game", () => {
    const i = g.requests.findIndex((r) => r.kind === "offenseCall" && r.calls.find((c) => c.id === "deepPass")?.on === true);
    const changed = [...g.answers];
    changed[i] = { kind: "offense", call: { call: "deepPass", formation: "empty" } };
    const { loop, first } = StepLoop.begin(prepared(), g.loop.seat, changed.slice(0, i + 1));
    let req = first.request;
    while (req !== null) req = loop.answer(scriptedAnswer(req)).request;
    expect(JSON.stringify(loop.record().events)).not.toEqual(JSON.stringify(g.loop.record().events));
  });

  it("every screen of every real request has at most seven rows (F3)", () => {
    const catalog = JSON.parse(readFileSync(join(import.meta.dirname, "../../../data/calls/catalog.json"), "utf8")) as Catalog;
    const data: MenuData = { catalog, labels: catalogLabels(catalog) };
    const keys: MenuKey[] = ["1", "2", "3", "4", "5", "6", "7", "Esc"];
    for (const req of g.requests) {
      const seen = new Set<string>();
      const stack: MenuState[] = [openMenu(req)];
      while (stack.length > 0) {
        const m = stack.pop() as MenuState;
        const id = JSON.stringify([m.path, m.formation, m.playType]);
        if (seen.has(id)) continue;
        seen.add(id);
        expect(rows(m, data).length).toBeLessThanOrEqual(MAX_ROWS);
        for (const k of keys) stack.push(press(m, k, data).menu);
      }
    }
  });
});

describe("the opponent's call never reaches the UI before the snap (F5)", () => {
  it.each([
    [5, "home"],
    [6, "away"],
  ] as const)("seed %i, human %s: no request names the AI's call for the coming snap", (seed, human) => {
    const p = prepared();
    const sent: FromWorker[] = [];
    const session = new Session(p, (m) => sent.push(structuredClone(m)));
    session.handle({ t: "newGame", leagueSeed: 2026, seed, human });
    let checked = 0;
    for (let guard = 0; guard < 2000; guard++) {
      const last = sent[sent.length - 1];
      if (last === undefined || last.t !== "step" || last.request === null) break;
      const req = last.request;
      const a = scriptedAnswer(req, seed);
      session.handle({ t: "answer", seq: req.seq, answer: a });
      const reply = sent[sent.length - 1];
      if (reply?.t !== "step") throw new Error(`unexpected ${reply?.t}`);
      // The next committed snap (if this answer finished the dead ball) is the one the request preceded.
      const snapEv = reply.events.find((e): e is PlayEvent => e.t === "play");
      if (snapEv === undefined || req.kind === "penaltyChoice") continue;
      const text = JSON.stringify(req);
      const aiCall = snapEv.before.possession === human ? snapEv.defense : snapEv.offense.call;
      if (aiCall === null) continue;
      // A continue request may show what lining up shows (a kick, kneel or spike: decision 17), nothing else.
      if (req.kind === "continue") {
        expect(["kickoff", "onsideKick", "punt", "fieldGoal", "extraPoint", "kneel", "spike", "clock"]).toContain(req.lineUp);
        continue;
      }
      const aiOptionIds = new Set(req.kind === "defenseCall" || req.kind === "offenseCall" || req.kind === "try" ? req.calls.map((c) => c.id) : []);
      // The AI's call can only appear as one of the human's own options, never on its own.
      const stripped = text.replace(/"id":"[^"]*"/g, "");
      if (!aiOptionIds.has(aiCall)) expect(text).not.toContain(`"${aiCall}"`);
      expect(stripped).not.toContain(`"${aiCall}"`);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe("answers (E5)", () => {
  const fresh = (): StepLoop => StepLoop.begin(prepared(), seat(9)).loop;

  it("an off or unknown answer is refused with a typed error and changes nothing", () => {
    const loop = fresh();
    const before = JSON.stringify([loop.state, loop.pending, loop.save()]);
    const req = loop.pending as DecisionRequest;
    const bad: Answer[] = [
      { kind: "defense", call: "nickelCover3" },
      { kind: "offense", call: { call: "teleport" } },
      { kind: "penalty", index: 0 },
      { kind: "challenge", throwFlag: true },
    ];
    if (req.kind !== "continue") bad.push({ kind: "continue" });
    for (const a of bad) {
      expect(() => loop.answer(a)).toThrow(AdapterError);
      expect(JSON.stringify([loop.state, loop.pending, loop.save()])).toBe(before);
    }
  });

  it("a run or pass without a formation, and a kick with one, are refused", () => {
    const g = play(seat(10));
    const i = g.requests.findIndex((r) => r.kind === "offenseCall");
    const { loop } = StepLoop.begin(prepared(), g.loop.seat, g.answers.slice(0, i));
    expect(() => loop.answer({ kind: "offense", call: { call: "insideRun" } })).toThrow(/needs formation/);
    expect(() => loop.answer({ kind: "offense", call: { call: "kneel", formation: "shotgun" } })).toThrow(/takes no formation/);
  });

  it("a Kick call outside 4th down and the last 2:00 is refused", () => {
    const g = play(seat(10));
    const i = g.requests.findIndex((r) => r.kind === "offenseCall" && r.calls.find((c) => c.id === "punt")?.on === false);
    const { loop } = StepLoop.begin(prepared(), g.loop.seat, g.answers.slice(0, i));
    expect(loop.pending?.kind).toBe("offenseCall");
    expect(() => loop.answer({ kind: "offense", call: { call: "punt" } })).toThrow(AdapterError);
  });
});

describe("save and resume (S2)", () => {
  it("resuming from the save at any request finishes the same game as not quitting", () => {
    const g = play(seat(11), 4);
    for (const cut of [0, 1, 17, 60, Math.floor(g.answers.length / 2), g.answers.length - 1]) {
      const save = JSON.parse(JSON.stringify({ ...g.loop.save(), log: g.answers.slice(0, cut) })) as ReturnType<StepLoop["save"]>;
      const { loop, first } = StepLoop.begin(prepared(), save, save.log);
      let req = first.request;
      let n = cut;
      while (req !== null) {
        req = loop.answer(g.answers[n] as Answer).request;
        n++;
      }
      expect(loop.record()).toEqual(g.loop.record());
    }
  });

  it("the session refuses a save from other data as older, and junk as damaged", () => {
    const p = prepared();
    const sent: FromWorker[] = [];
    const s = new Session(p, (m) => sent.push(m));
    const save = StepLoop.begin(p, seat(12)).loop.save();
    s.handle({ t: "resume", save: { ...save, dataHash: "other" } });
    s.handle({ t: "resume", save: { nonsense: true } });
    s.handle({ t: "resume", save: { ...save, log: [{ kind: "defense", call: "nickelCover3" }] } });
    expect(sent.map((m) => (m.t === "saveError" ? m.reason : m.t))).toEqual(["older", "damaged", "damaged"]);
    s.handle({ t: "resume", save });
    expect(sent[sent.length - 1]?.t).toBe("step");
  });
});

describe("Same call and tempo", () => {
  it("Same call is off before the human's first call", () => {
    const g = play(seat(13));
    const firstOffense = g.requests.find((r) => r.kind === "offenseCall");
    expect(firstOffense?.kind === "offenseCall" && firstOffense.sameCall).toEqual({ on: false, reason: "noEarlierCall" });
    const firstDefense = g.requests.find((r) => r.kind === "defenseCall");
    expect(firstDefense?.kind === "defenseCall" && firstDefense.sameCall).toEqual({ on: false, reason: "noEarlierCall" });
  });

  it("Same call submits exactly the last call, and leaves the tempo unchanged (F6)", () => {
    const { loop, first } = StepLoop.begin(prepared(), seat(14, "home"));
    let req = first.request;
    let lastOffense: { call: string; formation?: string } | null = null;
    let sameUsed = 0;
    while (req !== null) {
      if (req.kind === "offenseCall" && req.sameCall.on && lastOffense !== null) {
        expect(req.sameCall.offense).toEqual(lastOffense);
        const r = loop.answer({ kind: "tempo", tempo: "hurryUp" });
        expect(r.request?.kind === "offenseCall" && r.request.tempo).toBe("hurryUp");
        const req2 = r.request as Extract<DecisionRequest, { kind: "offenseCall" }>;
        const n = loop.events.length;
        req = loop.answer({ kind: "offense", call: req2.sameCall.offense as { call: string } }).request;
        const ev = loop.events.slice(n).find((e): e is PlayEvent => e.t === "play");
        if (ev !== undefined) expect({ call: ev.offense.call, ...(ev.offense.formation === undefined ? {} : { formation: ev.offense.formation }) }).toEqual(lastOffense);
        sameUsed++;
        continue;
      }
      const a = scriptedAnswer(req, 14);
      if (a.kind === "offense" && req.kind === "offenseCall") lastOffense = a.call;
      req = loop.answer(a).request;
    }
    expect(sameUsed).toBeGreaterThan(3);
  });

  it("tempo resets to Normal at each new drive", () => {
    const { loop, first } = StepLoop.begin(prepared(), seat(15, "home"));
    let req = first.request;
    let prevPossession = loop.state.possession;
    let checked = 0;
    while (req !== null) {
      if (req.kind === "offenseCall") {
        if (prevPossession !== loop.state.possession) {
          expect(req.tempo).toBe("normal");
          checked++;
        }
        if (req.tempo === "normal") req = loop.answer({ kind: "tempo", tempo: "runClock" }).request as DecisionRequest;
      }
      prevPossession = loop.state.possession;
      req = loop.answer(scriptedAnswer(req, 15)).request;
    }
    expect(checked).toBeGreaterThan(3);
  });
});

describe("dead balls with no call still wait (decision 17)", () => {
  it("the human on defense sees 'they line up' for the AI's kicks", () => {
    const g = play(seat(16, "away"));
    const lineUps = new Set(g.requests.flatMap((r) => (r.kind === "continue" ? [r.lineUp] : [])));
    expect(lineUps).toContain("kickoff");
    expect(lineUps.has("punt") || lineUps.has("fieldGoal") || lineUps.has("extraPoint")).toBe(true);
  });
});
