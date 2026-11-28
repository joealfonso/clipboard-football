// Calling screen pass U5 (docs/specs/m2-calling-screen-pass.md): "5 Earlier call" on the offense's
// first screen. 7 choices on every request (RC1); on exactly when an earlier call meets rules 1 to 3,
// submitting that call's own path, which the engine accepts (RC2); built from your own offense plays
// only (RC3); rows 1 to 4 and T unchanged (RC4); the play log counts the picks (RC5).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Catalog } from "@clipboard-football/shared";
import { checkPath } from "@clipboard-football/sim";
import type { FromWorker } from "../src/engine/protocol";
import { Session } from "../src/engine/session";
import type { DecisionAnswer, DecisionRequest, GameEvent, OffenseCallChoice, PlayEvent, Team } from "../src/engine/types";
import { EARLIER_CALL, openMenu, press, rows, type MenuData } from "../src/ui/menu";
import { earlierCall, NO_EARLIER, NO_OTHER } from "../src/ui/recent";
import { readLog } from "../src/ui/storage";
import { catalogLabels } from "../src/ui/text";
import { appHarness, installFakeDom } from "./fake-dom";
import { COMPLETE, RUN } from "./fixtures";
import { prepared, scriptedAnswer } from "./support";

const catalog = JSON.parse(readFileSync(join(import.meta.dirname, "../../../data/calls/catalog.json"), "utf8")) as Catalog;
const data: MenuData = { catalog, labels: catalogLabels(catalog) };
const GAMES = 100;

interface Seen {
  readonly req: Extract<DecisionRequest, { kind: "offenseCall" }>;
  readonly events: readonly GameEvent[];
}

/**
 * A game through the worker Session where the scripted human sometimes picks Earlier call when it
 * is on (every third offense request), so the engine is asked to take those paths. Returns every
 * offense request with the events before it, and every answer error.
 */
function play(seed: number, human: Team): { seen: Seen[]; errors: string[]; earlierSent: number } {
  const sent: FromWorker[] = [];
  const s = new Session(prepared(), (m) => sent.push(structuredClone(m)));
  s.handle({ t: "newGame", leagueSeed: 2026, seed, human });
  const events: GameEvent[] = [];
  const seen: Seen[] = [];
  const errors: string[] = [];
  let earlierSent = 0;
  let n = 0;
  for (let guard = 0; guard < 6000; guard++) {
    const last = sent[sent.length - 1];
    if (last === undefined) break;
    if (last.t === "answerError") {
      errors.push(`${seed}: ${last.code} ${last.message}`);
      break;
    }
    if (last.t !== "step") break;
    events.push(...last.events);
    const req = last.request;
    if (req === null) break;
    let a: DecisionAnswer = scriptedAnswer(req, seed);
    if (req.kind === "offenseCall") {
      seen.push({ req, events: [...events] });
      const e = earlierCall(events, human, req);
      if (e.on && n++ % 3 === 0) {
        a = { seq: req.seq, path: [...e.path] };
        earlierSent++;
      }
    }
    s.handle({ t: "answer", answer: a });
  }
  return { seen, errors, earlierSent };
}

const runs: ReturnType<typeof play>[] = [];
const humans: Team[] = [];
beforeAll(() => {
  for (let i = 0; i < GAMES; i++) {
    const human: Team = i % 2 === 0 ? "home" : "away";
    humans.push(human);
    runs.push(play(500 + i, human));
  }
}, 600_000);

/** An independent reading of rules 1 to 3: the newest own scrimmage call, not Same call, whose path checkPath accepts. */
function oracle(events: readonly GameEvent[], human: Team, req: Extract<DecisionRequest, { kind: "offenseCall" }>): { call: OffenseCallChoice; path: string[] } | null {
  const runs_ = new Set(catalog.screens.find((x) => x.id === "offense.run")?.choices.map((c) => c.id));
  const plays = events.filter((e): e is PlayEvent => e.t === "play" && e.before.possession === human && e.before.phase === "scrimmage");
  for (let i = plays.length - 1; i >= 0; i--) {
    const c = (plays[i] as PlayEvent).offense;
    if (c.call === "goForTwo") continue;
    if (req.sameCall !== null && c.call === req.sameCall.call && c.formation === req.sameCall.formation) continue;
    const path = c.formation !== undefined ? ["formation", c.formation, runs_.has(c.call) ? "run" : "pass", c.call] : c.call === "punt" || c.call === "fieldGoal" ? ["kick", c.call] : c.call === "kneel" || c.call === "spike" ? ["clock", c.call] : null;
    if (path === null) continue;
    if (checkPath(req, path) === null) return { call: c, path };
  }
  return null;
}

describe("RC1: offense.playType has 7 choices with Earlier call, every request", () => {
  it("1 Formation, 2 Kick, 3 Clock, 4 Same call, 5 Earlier call, T, Esc on every offense call request", () => {
    let n = 0;
    runs.forEach((r, i) => {
      for (const { req, events } of r.seen) {
        const list = rows(openMenu(req), data, { earlierCall: earlierCall(events, humans[i] as Team, req) });
        expect(list).toHaveLength(7);
        expect(list.map((x) => x.key)).toEqual(["1", "2", "3", "4", "5", "T", "Esc"]);
        expect(list[4]?.option).toBe(EARLIER_CALL);
        n++;
      }
    });
    expect(n).toBeGreaterThan(GAMES * 20);
  });

  it("the try and the defense screens have no Earlier call", () => {
    const s = new Session(prepared(), () => undefined);
    void s;
    const r = runs[0] as ReturnType<typeof play>;
    const req = r.seen[0]?.req as DecisionRequest;
    const tryReq = { ...req, kind: "try", screens: [{ id: "offense.try", options: [{ id: "extraPoint", legal: true }] }], sameCall: null } as unknown as DecisionRequest;
    expect(rows(openMenu(tryReq), data).some((x) => x.option === EARLIER_CALL)).toBe(false);
  });
});

describe(`RC2: over ${GAMES} games, Earlier call is on exactly when rules 1 to 3 find a call, and the engine takes its path`, () => {
  it("on exactly when the oracle finds one; its path is the oracle's and checkPath accepts it; never Same call", () => {
    let on = 0;
    runs.forEach((r, i) => {
      const human = humans[i] as Team;
      for (const { req, events } of r.seen) {
        const e = earlierCall(events, human, req);
        const o = oracle(events, human, req);
        expect(e.on, `seq ${req.seq}`).toBe(o !== null);
        if (!e.on || o === null) continue;
        on++;
        expect(e.path).toEqual(o.path);
        expect(checkPath(req, e.path)).toBeNull();
        expect(req.sameCall !== null && e.call.call === req.sameCall.call && e.call.formation === req.sameCall.formation).toBe(false);
        // The row submits exactly that path, as the menus would build it.
        expect(press(openMenu(req), "5", data, { earlierCall: e }).effect).toEqual({ t: "submit", answer: { seq: req.seq, path: [...o.path] } });
      }
    });
    expect(on).toBeGreaterThan(GAMES * 5);
  });

  it("the engine accepts every Earlier call answer (no answerError)", () => {
    expect(runs.flatMap((r) => r.errors)).toEqual([]);
    expect(runs.reduce((a, r) => a + r.earlierSent, 0)).toBeGreaterThan(GAMES);
  });

  it("off with its reason in words: no call yet, or no other recent call", () => {
    const first = (runs[0] as ReturnType<typeof play>).seen[0] as Seen;
    const off = earlierCall([], humans[0] as Team, first.req);
    expect(off).toEqual({ on: false, reason: NO_EARLIER });
    const r = press(openMenu(first.req), "5", data, { earlierCall: off });
    expect(r.effect).toEqual({ t: "note", text: "no earlier call" });
    expect(rows(openMenu(first.req), data, { earlierCall: off })[4]).toMatchObject({ key: "5", label: "Earlier call", on: false, reasonText: "no earlier call" });
    const only = { ...first.req, sameCall: { call: "shortPass", formation: "shotgun" } };
    const ev: PlayEvent = { ...COMPLETE, before: { ...COMPLETE.before, possession: humans[0] as Team } };
    expect(earlierCall([ev, ev], humans[0] as Team, only)).toEqual({ on: false, reason: NO_OTHER });
  });
});

describe("RC3: built only from plays where the human was on offense", () => {
  it("a log of only opponent offense plays gives no earlier call", () => {
    const first = (runs[0] as ReturnType<typeof play>).seen[0] as Seen;
    const human = humans[0] as Team;
    const them: Team = human === "home" ? "away" : "home";
    const theirs: PlayEvent[] = [COMPLETE, RUN].map((e) => ({ ...e, before: { ...e.before, possession: them } }));
    expect(earlierCall(theirs, human, { ...first.req, sameCall: null })).toEqual({ on: false, reason: NO_EARLIER });
  });
});

describe("RC4: keys and numbers of rows 1 to 4 and T are unchanged", () => {
  it("Formation 1, Kick 2, Clock 3, Same call 4 and Timeout T keep their options and keys", () => {
    const { req, events } = (runs[1] as ReturnType<typeof play>).seen[5] as Seen;
    const list = rows(openMenu(req), data, { earlierCall: earlierCall(events, humans[1] as Team, req) });
    expect(list.slice(0, 4).map((r) => [r.key, r.option])).toEqual([
      ["1", "formation"],
      ["2", "kick"],
      ["3", "clock"],
      ["4", "sameCall"],
    ]);
    expect(list.find((r) => r.option === "timeout")?.key).toBe("T");
  });
});

describe("RC5: the local play log counts Earlier call picks", () => {
  const store = new Map<string, string>();
  beforeAll(() => {
    installFakeDom(1280, 720);
    (globalThis as unknown as Record<string, unknown>)["localStorage"] = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    (globalThis as unknown as Record<string, unknown>)["performance"] ??= { now: () => 0 };
  });

  it("an old log without the field reads 0, and picking 5 adds one", () => {
    store.set("clipboard-football.log", JSON.stringify({ gamesStarted: 1, gamesFinished: 0, detailsOpens: 0, challenges: 0, sameCalls: 0, escBackOuts: 0, deadBallSeconds: [] }));
    expect(readLog()?.earlierCalls).toBe(0);
    const i = runs.findIndex((r) => r.seen.some((x) => earlierCall(x.events, humans[runs.indexOf(r)] as Team, x.req).on));
    const r = runs[i] as ReturnType<typeof play>;
    const human = humans[i] as Team;
    const seen = r.seen.find((x) => earlierCall(x.events, human, x.req).on) as Seen;
    const first = new Session(prepared(), () => undefined);
    void first;
    const sentAnswers: unknown[] = [];
    const h = appHarness({ matchup: { leagueSeed: 2026, seed: 1, gameType: "regularSeason", home: { index: 0, name: "h", place: "h", nickname: "H", pool: { players: [] } }, away: { index: 1, name: "a", place: "a", nickname: "A", pool: { players: [] } } } as never, human, events: [...seen.events] });
    Object.assign(h.app, { client: { send: (m: unknown) => sentAnswers.push(m) }, render: () => undefined, reducedMotion: () => true });
    h.game["request"] = seen.req;
    h.game["menu"] = openMenu(seen.req);
    h.call("pickInGame", "5");
    expect(readLog()?.earlierCalls).toBe(1);
    expect(sentAnswers).toEqual([{ t: "answer", answer: { seq: seen.req.seq, path: [...(earlierCall(seen.events, human, seen.req) as unknown as { path: string[] }).path] } }]);
    // Earlier call starts both sides in the huddle, like Same call.
    expect(h.game["lastSame"]).toBe(true);
  });
});
