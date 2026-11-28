// Calling screen pass Q1 (docs/specs/m2-calling-screen-pass.md): the Auto-advance setting. Settings
// gains row 6 and the value persists (AA1); Off shows every continue (AA2); the middle value skips
// exactly the qualifying dead balls with no legal timeout (AA3); the last skips them whatever the
// timeout row says, never the two-minute warning, toss, reviews or the post-toss kickoff (AA4); the
// setting changes only who presses Continue (AA5); the play log counts skips (AA6).

import { beforeAll, describe, expect, it } from "vitest";
import type { FromWorker } from "../src/engine/protocol";
import { Session } from "../src/engine/session";
import type { DecisionAnswer, DecisionRequest, GameEvent, Team } from "../src/engine/types";
import { autoAnswer } from "../src/ui/autoadvance";
import { gameScreen } from "../src/ui/overlay";
import { settingsScreen, type AutoAdvance } from "../src/ui/screens";
import { DEFAULT_SETTINGS, loadSettings, readLog, saveSettings } from "../src/ui/storage";
import { appHarness, installFakeDom } from "./fake-dom";
import { prepared, scriptedAnswer } from "./support";

const store = new Map<string, string>();
beforeAll(() => {
  installFakeDom(1280, 720);
  (globalThis as unknown as Record<string, unknown>)["localStorage"] = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
});

interface Asked {
  readonly req: DecisionRequest;
  /** The committed events before the request (the step's events included). */
  readonly events: readonly GameEvent[];
  /** The events of the step that delivered the request (the play and what its advance implied). */
  readonly stepEvents: readonly GameEvent[];
}

/** A game through the worker Session; `answer` picks each answer. Every request with the events before it, and the events. */
function walk(seed: number, human: Team, answer: (a: Asked) => DecisionAnswer): { asked: Asked[]; events: GameEvent[] } {
  const sent: FromWorker[] = [];
  const s = new Session(prepared(), (m) => sent.push(structuredClone(m)));
  s.handle({ t: "newGame", leagueSeed: 2026, seed, human });
  const events: GameEvent[] = [];
  const asked: Asked[] = [];
  for (let guard = 0; guard < 6000; guard++) {
    const last = sent[sent.length - 1];
    if (last === undefined || last.t !== "step") throw new Error(`unexpected ${last?.t}`);
    events.push(...last.events);
    if (last.request === null) break;
    const a = { req: last.request, events: [...events], stepEvents: [...last.events] };
    asked.push(a);
    s.handle({ t: "answer", answer: answer(a) });
  }
  return { asked, events };
}

/** Independent reading of "Qualifying dead balls" and its exceptions. */
function qualifies(a: Asked, setting: AutoAdvance): boolean {
  const r = a.req;
  if (setting === "off" || r.kind !== "continue") return false;
  const lineUp = r.about.what === "theyLineUp" && ["punt", "fieldGoal", "extraPoint", "kneel", "spike"].includes(r.about.call);
  if (!(r.about.what === "theyKickOff" || lineUp)) return false;
  const timeout = r.screens[0]?.options.find((o) => o.id === "timeout");
  if (setting === "noDecision" && timeout?.legal === true) return false;
  if ([...r.events, ...a.stepEvents].some((e) => e.t === "twoMinuteWarning" || e.t === "endPeriod")) return false;
  if (r.about.what === "theyKickOff" && postToss(a)) return false;
  return true;
}

/**
 * The kickoff that follows a coin toss, read on its own terms (test-writer): no play has been run
 * since the game's latest toss. Unlike autoAnswer it doesn't rely on the toss being the last event.
 */
function postToss(a: Asked): boolean {
  const toss = a.events.map((e) => e.t).lastIndexOf("toss");
  return toss >= 0 && !a.events.slice(toss + 1).some((e) => e.t === "play");
}

const GAMES = 50;
const games: { asked: Asked[]; events: GameEvent[] }[] = [];
beforeAll(() => {
  for (let i = 0; i < GAMES; i++) games.push(walk(900 + i, i % 2 === 0 ? "home" : "away", (a) => scriptedAnswer(a.req, i)));
}, 600_000);

describe("AA1: Settings row 6, the value persists, an older setting loads as Off", () => {
  it("settingsScreen has 7 choices with 6 Auto-advance, noting the value", () => {
    for (const [v, note] of [["off", "Off"], ["noDecision", "When there's nothing to decide"], ["all", "Also skip my timeout chances"]] as const) {
      const s = settingsScreen({ textSize: 100, reducedMotion: "system", markLabels: "involved", autoAdvance: v });
      expect(s.rows).toHaveLength(7);
      expect(s.rows[5]).toMatchObject({ key: "6", label: "Auto-advance", note, action: "autoAdvance" });
    }
  });

  it("saved and loaded; a stored setting without the field is Off; the default is Off", () => {
    expect(DEFAULT_SETTINGS.autoAdvance).toBe("off");
    saveSettings({ ...DEFAULT_SETTINGS, autoAdvance: "all" });
    expect(loadSettings().autoAdvance).toBe("all");
    store.set("clipboard-football.settings", JSON.stringify({ textSize: 125, reducedMotion: "on", markLabels: "all", speed: "2x", labelContent: "number" }));
    expect(loadSettings().autoAdvance).toBe("off");
    expect(loadSettings().textSize).toBe(125);
  });
});

describe("AA2: Off shows and waits on every continue request (decision 17)", () => {
  it("no request of 50 games is answered by the app", () => {
    let n = 0;
    for (const g of games)
      for (const a of g.asked) {
        expect(autoAnswer(a.req, "off", { events: a.events, firstAfterResume: false, stepEvents: a.stepEvents })).toBeNull();
        if (a.req.kind === "continue") n++;
      }
    expect(n).toBeGreaterThan(GAMES * 5);
  });
});

describe(`AA3: "When there's nothing to decide", over ${GAMES} games`, () => {
  it("exactly the qualifying requests with no legal timeout are answered; every one with a legal timeout waits", () => {
    let skipped = 0;
    let waitedOnTimeout = 0;
    for (const g of games)
      for (const a of g.asked) {
        const got = autoAnswer(a.req, "noDecision", { events: a.events, firstAfterResume: false, stepEvents: a.stepEvents });
        expect(got !== null, `${a.req.kind} ${JSON.stringify(a.req.kind === "continue" ? a.req.about : null)}`).toBe(qualifies(a, "noDecision"));
        if (got !== null) {
          expect(got).toEqual({ seq: a.req.seq, path: ["continue"] });
          skipped++;
        }
        if (a.req.kind === "continue" && a.req.screens[0]?.options.some((o) => o.id === "timeout" && o.legal)) {
          expect(got).toBeNull();
          waitedOnTimeout++;
        }
      }
    // A sanity floor (not a spec figure): about two skips a game in practice.
    expect(skipped).toBeGreaterThan(GAMES);
    expect(waitedOnTimeout).toBeGreaterThan(0);
  });

  it("the App answers Continue itself and never shows the calling screen for it", async () => {
    const g = games[0] as (typeof games)[number];
    const a = g.asked.find((x) => qualifies(x, "noDecision")) as Asked;
    const sent: unknown[] = [];
    let renders = 0;
    const first = { leagueSeed: 2026, seed: 900, gameType: "regularSeason", home: { index: 0, name: "h", place: "h", nickname: "H", pool: { players: [] } }, away: { index: 1, name: "a", place: "a", nickname: "A", pool: { players: [] } } };
    const h = appHarness({ matchup: first as never, human: "home", events: [...a.events], settings: { autoAdvance: "noDecision" } });
    store.delete("clipboard-football.log");
    Object.assign(h.app, { storage: false, client: { send: (m: unknown) => sent.push(m) }, render: () => void renders++, animator: { idle: () => undefined }, flights: { start: () => undefined } });
    h.game["state"] = { possession: "away", phase: "scrimmage", spot: 40, down: 4, distance: 5, goalToGo: false };
    h.game["framePossession"] = "away";
    await h.call<Promise<void>>("onStep", { t: "step", matchup: first, human: "home", events: [], request: a.req, state: h.game["state"], save: {}, resumed: false, drive: null });
    expect(sent).toEqual([{ t: "answer", answer: { seq: a.req.seq, path: ["continue"] } }]);
    expect(h.game["menu"]).toBeNull();
    expect(gameScreen({ inGame: true, animating: (h.app as unknown as { animating: boolean; autoAdvancing: boolean }).animating || (h.app as unknown as { autoAdvancing: boolean }).autoAdvancing })).toBe("play");
    // AA6: the local play log counts it.
    expect(readLog()?.autoAdvanced).toBe(1);
    expect(renders).toBeGreaterThan(0);
  });

  it("the first request after resuming a save always shows", () => {
    const a = games.flatMap((g) => g.asked).find((x) => qualifies(x, "all")) as Asked;
    expect(autoAnswer(a.req, "all", { events: a.events, firstAfterResume: true, stepEvents: a.stepEvents })).toBeNull();
  });
});

describe('AA4: "Also skip my timeout chances"', () => {
  it("qualifying requests advance whatever the timeout row says; the exceptions still wait", () => {
    let withTimeout = 0;
    let exceptions = 0;
    for (const g of games)
      for (const a of g.asked) {
        const got = autoAnswer(a.req, "all", { events: a.events, firstAfterResume: false, stepEvents: a.stepEvents });
        expect(got !== null).toBe(qualifies(a, "all"));
        if (got !== null && a.req.screens[0]?.options.some((o) => o.id === "timeout" && o.legal)) withTimeout++;
        if (a.req.kind === "continue") {
          const about = a.req.about.what;
          const afterToss = about === "theyKickOff" && postToss(a);
          const tmw = [...a.req.events, ...a.stepEvents].some((e) => e.t === "twoMinuteWarning" || e.t === "endPeriod");
          if (about === "tossResult" || about === "underReview" || about === "reviewResult" || afterToss || tmw) {
            expect(got, about).toBeNull();
            exceptions++;
          }
        } else expect(got).toBeNull();
      }
    expect(withTimeout).toBeGreaterThan(0);
    expect(exceptions).toBeGreaterThan(GAMES);
    // Every game has an opening kickoff; half of them are theirs.
    const tossKicks = games.flatMap((g) => g.asked).filter((a) => a.req.kind === "continue" && a.req.about.what === "theyKickOff" && postToss(a)).length;
    expect(tossKicks).toBeGreaterThanOrEqual(GAMES / 2 - 5);
  });
});

describe("AA5: the same seed and answers give the same game with the setting on and off", () => {
  it("the app's Continue is the same answer Space sends: identical event logs", () => {
    for (let i = 0; i < 5; i++) {
      const human: Team = i % 2 === 0 ? "home" : "away";
      // Off: the player presses Space (Continue) on the qualifying requests, his script elsewhere.
      const off = walk(900 + i, human, (a) => (qualifies(a, "all") ? { seq: a.req.seq, path: ["continue"] } : scriptedAnswer(a.req, i)));
      // On: the app answers them.
      const on = walk(900 + i, human, (a) => autoAnswer(a.req, "all", { events: a.events, firstAfterResume: false, stepEvents: a.stepEvents }) ?? scriptedAnswer(a.req, i));
      expect(on.events).toEqual(off.events);
    }
  });
});

// Code review B1: the sim logs a two-minute warning or an end of period in the step's events while
// the play advances (loop/play.ts stateEvents), not in request.events. Walked through the real steps.
describe("Q1: a warning or period end in the step's own events always waits", () => {
  it("over 120 seeded games, at both skip settings, no such dead ball is answered by the app", { timeout: 600_000 }, () => {
    let seen = 0;
    for (let i = 0; i < 120; i++) {
      const { asked } = walk(i + 1, i % 2 === 0 ? "home" : "away", (a) => scriptedAnswer(a.req, i));
      for (const a of asked) {
        if (a.req.kind !== "continue" || !a.stepEvents.some((e) => e.t === "twoMinuteWarning" || e.t === "endPeriod")) continue;
        seen++;
        for (const setting of ["noDecision", "all"] as const) expect(autoAnswer(a.req, setting, { events: a.events, firstAfterResume: false, stepEvents: a.stepEvents }), `game ${i + 1} seq ${a.req.seq} ${setting}`).toBeNull();
      }
    }
    expect(seen).toBeGreaterThan(100);
  });
});
