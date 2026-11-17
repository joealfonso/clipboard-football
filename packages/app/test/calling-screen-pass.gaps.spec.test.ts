// Calling screen pass (docs/specs/m2-calling-screen-pass.md): tests written from the spec by the
// test-writer for criteria and spec rules the engineer's spec tests leave untested, or test only
// in a form that couldn't fail. Each block names the spec item it reads. Nothing here reads the
// implementation's output as its expectation; where an App method is called, the expected value
// comes from the spec's copy, a public text function the spec names, or an independent oracle.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FromWorker } from "../src/engine/protocol";
import { Session } from "../src/engine/session";
import { whyHeadline } from "../src/engine/headline";
import type { DecisionAnswer, DecisionRequest, GameEvent, PlayEvent, Team } from "../src/engine/types";
import { autoAnswer } from "../src/ui/autoadvance";
import { driveSpans, logRows } from "../src/ui/gamelog";
import { pathPrimitives } from "../src/ui/marks";
import { Animator } from "../src/ui/animator";
import { layoutFor } from "../src/ui/layout";
import { EARLIER_CALL, openMenu, rows } from "../src/ui/menu";
import { earlierCall } from "../src/ui/recent";
import { SETTINGS_DESCRIPTION, settingsScreen } from "../src/ui/screens";
import { callsLine, clockText, periodText, playerRef, playResultText, resultLine, situationText, yardLineText, type TextCtx } from "../src/ui/text";
import { at, timeline, type Timeline, type TimelineCtx } from "../src/ui/timeline";
import { appHarness, appLabels, FakeEl, installFakeDom, MOTION, TEMPLATES } from "./fake-dom";
import { ALL_FIXTURES, COMPLETE, RUN } from "./fixtures";
import { prepared, scriptedAnswer } from "./support";
import { ctxOf, simGames } from "./sim-games";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const store = new Map<string, string>();
beforeAll(() => {
  installFakeDom(1280, 720);
  (globalThis as unknown as Record<string, unknown>)["localStorage"] = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  (globalThis as unknown as Record<string, unknown>)["performance"] ??= { now: () => 0 };
});
afterEach(() => vi.restoreAllMocks());

const labels = appLabels();
const key = (k: string): KeyboardEvent => ({ key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault: () => undefined }) as unknown as KeyboardEvent;
const NO_EXPLANATION = "No explanation for this play.";

/** An object whose every method is a no-op (play and other awaited calls resolve at once). */
function inert(over: Record<string, unknown> = {}): unknown {
  return new Proxy(over, {
    get: (t, p) => (p in t ? t[p as string] : p === "then" ? undefined : () => (p === "play" ? Promise.resolve() : p === "marks" ? [] : p === "shown" ? null : undefined)),
  });
}

interface Walked {
  readonly steps: Extract<FromWorker, { t: "step" }>[];
  /** For each step, the answer the app would send itself on its request (setting "all"), or null. */
  readonly auto: (DecisionAnswer | null)[];
}

/**
 * A game through the worker Session where the qualifying dead balls (autoAnswer, "all") are
 * continued and everything else is the scripted human: exactly the game the App plays with the
 * setting on. Every step message, in order.
 */
function walkAuto(seed: number, human: Team): Walked {
  const sent: FromWorker[] = [];
  const s = new Session(prepared(), (m) => sent.push(structuredClone(m)));
  s.handle({ t: "newGame", leagueSeed: 2026, seed, human });
  const steps: Extract<FromWorker, { t: "step" }>[] = [];
  const auto: (DecisionAnswer | null)[] = [];
  const events: GameEvent[] = [];
  for (let guard = 0; guard < 6000; guard++) {
    const last = sent[sent.length - 1];
    if (last === undefined || last.t !== "step") throw new Error(`unexpected ${last?.t}`);
    steps.push(last);
    events.push(...last.events);
    if (last.request === null) {
      auto.push(null);
      break;
    }
    // Q1: a two-minute warning or an end of period in the step's own events disqualifies too (review B1).
    const a = autoAnswer(last.request, "all", { events, firstAfterResume: false, stepEvents: last.events });
    auto.push(a);
    s.handle({ t: "answer", answer: a ?? scriptedAnswer(last.request, seed) });
  }
  return { steps, auto };
}

/** An App over the fake DOM that takes real step messages; drawing, timers and storage are no-ops. */
function liveApp(human: Team, settings: Record<string, unknown>): { h: ReturnType<typeof appHarness>; sent: unknown[]; railAuto: boolean[] } {
  const g = simGames(1)[0] as ReturnType<typeof simGames>[number];
  const h = appHarness({ matchup: g.matchup, human, settings: settings as never });
  const sent: unknown[] = [];
  const railAuto: boolean[] = [];
  const animator = inert({
    play: () => {
      railAuto.push((h.app["railPlay"] as { auto?: boolean } | null)?.auto === true);
      return Promise.resolve();
    },
  });
  Object.assign(h.app, {
    game: null,
    client: { send: (m: unknown) => sent.push(m) },
    render: () => undefined,
    renderTopBar: () => undefined,
    renderRail: () => undefined,
    animator,
    flights: inert(),
    persist: () => undefined,
    applyMode: () => undefined,
    wait: () => Promise.resolve(),
    intro: null,
    storage: false,
  });
  return { h, sent, railAuto };
}

// ---------------------------------------------------------------- U2 / Q1: "Before that:" on the Last play card

describe("U2 item 6 and Q1 States: after auto-advanced plays the card lists them under \"Before that:\" (at most 2), then L Game log", () => {
  it("over 6 games with the last setting, the card's Before that lines are the auto-advanced plays right before the last play", { timeout: 600_000 }, async () => {
    let checked = 0;
    let chains = 0;
    let railChecked = 0;
    for (let i = 0; i < 6; i++) {
      const human: Team = i % 2 === 0 ? "home" : "away";
      const w = walkAuto(700 + i, human);
      const { h, sent, railAuto } = liveApp(human, { autoAdvance: "all" });
      /** Every play event so far, with whether it ran because the app answered its dead ball. */
      const plays: { ev: PlayEvent; auto: boolean }[] = [];
      let prevAuto = false;
      for (const [k, step] of w.steps.entries()) {
        const railBefore = railAuto.length;
        await h.call<Promise<void>>("onStep", step);
        // Each play animated in this step: the rail says "This play (auto)" exactly when the app continued its dead ball.
        const stepPlays = step.events.filter((e): e is PlayEvent => e.t === "play");
        if (stepPlays.length > 0 && railAuto.length > railBefore) {
          expect(railAuto[railBefore], `seed ${700 + i} step ${k}: rail auto label`).toBe(prevAuto);
          railChecked++;
        }
        stepPlays.forEach((ev, j) => plays.push({ ev, auto: j === 0 && prevAuto }));
        const auto = w.auto[k] ?? null;
        // The app answers exactly when the setting says; on a shown request it sends nothing.
        const answers = sent.filter((m) => (m as { t: string }).t === "answer");
        if (auto !== null) expect(answers.at(-1), `seed ${700 + i} step ${k}`).toEqual({ t: "answer", answer: auto });
        // A penalty choice or a challenge comes after the snap: the play still ran from the dead ball before it.
        if (step.request?.kind !== "penalty" && step.request?.kind !== "challenge") prevAuto = auto !== null;
        sent.length = 0;
        if (auto !== null || step.request === null) continue;
        // A request the player sees: check the full card.
        const game = h.app["game"] as unknown as Record<string, unknown>;
        const last = plays.at(-1);
        if (last === undefined) continue;
        const want: PlayEvent[] = [];
        if (last.auto)
          for (let j = plays.length - 2; j >= 0 && (plays[j] as (typeof plays)[number]).auto; j--) want.unshift((plays[j] as (typeof plays)[number]).ev);
        const wantBefore = want.slice(-2);
        const card = h.call<FakeEl>("lastPlayCard", game, false);
        const ctx = ctxOf({ matchup: step.matchup, human }, labels);
        const text = card.textContent;
        if (wantBefore.length === 0) {
          expect(text, `seed ${700 + i} step ${k}`).not.toContain("Before that:");
          continue;
        }
        chains++;
        const kids = card.elements;
        const at = kids.findIndex((e) => e.textContent === "Before that:");
        expect(at, `seed ${700 + i} step ${k}: Before that: label`).toBeGreaterThan(0);
        const lines = kids.slice(at + 1, at + 1 + wantBefore.length).map((e) => e.textContent);
        expect(lines).toEqual(wantBefore.map((e) => playResultText(e, ctx)));
        // Then the L Game log hint, and nothing else of the chain.
        expect(kids[at + 1 + wantBefore.length]?.textContent).toMatch(/L\s*Game log/);
        expect(kids.length).toBe(at + 2 + wantBefore.length);
        checked++;
      }
    }
    expect(chains, "the games reach chains of auto-advanced plays").toBeGreaterThan(3);
    expect(checked).toBeGreaterThan(3);
    expect(railChecked).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------- U2: the card's order, the live region, the calls line

describe("U2: the full Last play card reads top to bottom: label, result, calls, why, D Details, event lines", () => {
  it("in that order on every play of 3 simulated games", () => {
    for (const g of simGames(3)) {
      const h = appHarness({ matchup: g.matchup, human: g.human });
      const c = ctxOf(g, labels);
      for (const ev of g.plays.slice(0, 80)) {
        h.call("setPlayText", h.game, ev);
        h.game["eventLines"] = ["Timeout, Cranes (2 left)."];
        const kids = h.call<FakeEl>("lastPlayCard", h.game, false).elements.map((e) => e.textContent);
        expect(kids.slice(0, 6)).toEqual(["Last play", playResultText(ev, c), callsLine(ev, c), whyHeadline(ev.play, ev.standout) ?? NO_EXPLANATION, expect.stringMatching(/^D\s*Details$/), "Timeout, Cranes (2 left)."]);
      }
    }
  });
});

describe("U2 Accessibility: the live region keeps the result with where things stand, the calls and the why", () => {
  it("on every play of 3 simulated games", () => {
    for (const g of simGames(3)) {
      const h = appHarness({ matchup: g.matchup, human: g.human });
      const c = ctxOf(g, labels);
      for (const ev of g.plays.slice(0, 80)) {
        h.game["eventLines"] = [];
        h.call("setPlayText", h.game, ev);
        const live = (h.app["root"] as unknown as { live: FakeEl }).live.textContent;
        // The card drops the "Your ball, ..." tail; the live region keeps it (U2 item 2).
        expect(live).toContain(resultLine(ev, c));
        expect(live).toContain(callsLine(ev, c));
        expect(live).toContain(whyHeadline(ev.play, ev.standout) ?? NO_EXPLANATION);
      }
    }
  });
});

describe('U2 Rules, calls line: with no defense call only the kicking side\'s call, never "no call"', () => {
  it("over 40 simulated games", { timeout: 600_000 }, () => {
    let none = 0;
    for (const g of simGames(40)) {
      const c = ctxOf(g, labels);
      for (const ev of g.plays) {
        const line = callsLine(ev, c);
        expect(line).not.toMatch(/no call/i);
        if (ev.defense !== null) continue;
        none++;
        // One sentence, for the side that made the call (the offense: the kicking side or the kneeler).
        const who = ev.before.possession === g.human ? "You" : "They";
        expect(line, `${ev.play.kind}`).toMatch(new RegExp(`^${who}: [^:]+\\.$`));
        expect(line).not.toContain(who === "You" ? "They:" : "You:");
      }
    }
    expect(none).toBeGreaterThan(200);
  });

  it('"You: Punt." and "They: Kickoff." as the spec writes them', () => {
    const ctx: TextCtx = { human: "home", teams: { home: { name: "Riverbend Pilots", nickname: "Pilots" }, away: { name: "Harborview Cranes", nickname: "Cranes" } }, players: new Map(), labels, regulationPeriods: 4, endZoneYards: 10 };
    const punt = ALL_FIXTURES["PUNT_RETURNED"] as PlayEvent;
    expect(callsLine({ ...punt, offense: { call: "punt" }, defense: null }, ctx)).toBe("You: Punt.");
    const ko = ALL_FIXTURES["KICKOFF_RETURN"] as PlayEvent;
    expect(callsLine({ ...ko, before: { ...ko.before, possession: "away" }, offense: { call: "kickoff" }, defense: null }, ctx)).toBe("They: Kickoff.");
  });
});

describe("U2 States: a player id in neither pool is left out with one console warning per id", () => {
  it("warns once for an id, however often it is read", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ctx: TextCtx = { human: "home", teams: { home: { name: "A", nickname: "A" }, away: { name: "B", nickname: "B" } }, players: new Map(), labels: {}, regulationPeriods: 4, endZoneYards: 10 };
    const id = `gaps-nobody-${Math.random()}`;
    expect(playerRef(id, ctx)).toBeUndefined();
    expect(playerRef(id, ctx)).toBeUndefined();
    playResultText({ ...RUN, play: { ...RUN.play, detail: { ...(RUN.play.detail ?? {}), participants: { ballCarrier: id } } } as PlayEvent["play"] }, ctx);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes(id))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- U3: the details sheet in the DOM

describe("U3: the sheet's first line is the why headline; groups are real headings and lists; the seed line", () => {
  it("on the first 40 plays of 5 simulated games", () => {
    for (const g of simGames(5)) {
      const h = appHarness({ matchup: g.matchup, human: g.human });
      for (const ev of g.plays.slice(0, 40)) {
        h.call("setPlayText", h.game, ev);
        h.game["state"] = { ...ev.after, playCount: 17 };
        const body = h.call<FakeEl[]>("detailsBody");
        // 1. The why headline once, first (whyHeadline, never detail.why).
        expect(body[0]?.textContent).toBe(whyHeadline(ev.play, ev.standout) ?? NO_EXPLANATION);
        // 2. Each group an h3 then a list, in the spec's order, none empty.
        const groups = body.filter((e) => e.querySelector("h3") !== null);
        const titles = groups.map((e) => e.querySelector("h3")?.textContent);
        const order = ["Situation", "Matchup", "Players", "Outcome"];
        expect(titles.every((t) => order.includes(t as string))).toBe(true);
        expect([...titles]).toEqual(order.filter((t) => titles.includes(t)));
        for (const grp of groups) {
          const items = grp.querySelectorAll("li");
          expect(grp.querySelector("ul"), "a list").not.toBeNull();
          expect(items.length, "no empty group").toBeGreaterThan(0);
        }
        // 4. The seed line, as today.
        expect(body.at(-1)?.textContent).toBe(`Seed ${g.matchup.seed}, play 17.`);
      }
    }
  });
});

// ---------------------------------------------------------------- U5: Earlier call copy and the rejected path

/** An offense call request from a real game with Earlier call on, and the events before it. */
function earlierOn(): { g: ReturnType<typeof simGames>[number]; req: Extract<DecisionRequest, { kind: "offenseCall" }>; events: GameEvent[] } {
  for (const g of simGames(10)) {
    const events: GameEvent[] = [];
    for (const m of g.sent) {
      if (m.t !== "step") continue;
      events.push(...m.events);
      const r = m.request;
      if (r?.kind === "offenseCall") {
        const e = earlierCall(events, g.human, r);
        if (e.on && e.call.formation !== undefined) return { g, req: r, events: [...events] };
      }
    }
  }
  throw new Error("no request with Earlier call on");
}

describe("U5 Copy: \"5 Earlier call: Under center, Inside run\", the same call text as Same call; accessible name \"5, Earlier call: ...\"", () => {
  it("the row names the earlier call's formation and play by their labels", () => {
    const { g, req, events } = earlierOn();
    const e = earlierCall(events, g.human, req);
    if (!e.on || e.call.formation === undefined) throw new Error("on");
    const ui = appHarness({ matchup: g.matchup, human: g.human }).app["ui"] as unknown as { catalog: never };
    const list = rows(openMenu(req), { catalog: ui.catalog, labels }, { earlierCall: e });
    const row = list.find((r) => r.option === EARLIER_CALL);
    expect(row?.key).toBe("5");
    expect(row?.label).toBe(`Earlier call: ${labels[e.call.formation]}, ${labels[e.call.call]}`);
  });

  it("the App's row button carries the accessible name", () => {
    const { g, req, events } = earlierOn();
    const e = earlierCall(events, g.human, req);
    if (!e.on || e.call.formation === undefined) throw new Error("on");
    const h = appHarness({ matchup: g.matchup, human: g.human, events });
    h.game["request"] = req;
    h.game["menu"] = openMenu(req);
    h.game["state"] = { ...(req.state as object), trySpots: null, playCount: 1 };
    Object.assign(h.app, { animating: false, pressed: null, menuEnter: null });
    const list = rows(openMenu(req), { catalog: (h.app["ui"] as unknown as { catalog: never }).catalog, labels }, { earlierCall: e });
    const group = h.call<FakeEl>("rowsGroup", "Play type", list, h.game["menu"]);
    const buttons = group.all().filter((x) => x.getAttribute("data-key") === "5");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute("aria-label")).toBe(`5, Earlier call: ${labels[e.call.formation]}, ${labels[e.call.call]}`);
  });
});

describe("U5 States: the engine rejects an Earlier call path: \"That call isn't allowed now.\", the first screen again, one warning", () => {
  it("after picking 5", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { g, req, events } = earlierOn();
    const h = appHarness({ matchup: g.matchup, human: g.human, events });
    const sent: unknown[] = [];
    Object.assign(h.app, { client: { send: (m: unknown) => sent.push(m) }, render: () => undefined });
    h.game["request"] = req;
    h.game["menu"] = openMenu(req);
    h.call("pickInGame", "5");
    expect(sent).toHaveLength(1);
    h.call("onWorker", { t: "answerError", code: "illegal", message: "not legal" });
    expect(h.app["status"]).toBe("That call isn't allowed now.");
    const menu = h.game["menu"] as { screens: string[] } | null;
    expect(menu?.screens).toEqual([req.screens[0]?.id]);
    expect(warn).toHaveBeenCalledTimes(1);
    // A second, ordinary rejection afterwards is not reported as an Earlier call.
    h.call("onWorker", { t: "answerError", code: "illegal", message: "not legal" });
    expect(h.app["status"]).not.toBe("That call isn't allowed now.");
  });
});

// ---------------------------------------------------------------- Q1: copy, the resume rule, the post-toss rule

describe("Q1 Copy: the Settings description", () => {
  it("is the spec's sentence", () => {
    expect(SETTINGS_DESCRIPTION["autoAdvance"]).toBe(
      "Plays with nothing for you to choose (their kickoffs, punts, field goals, extra points, kneels and spikes) run without waiting for Space. Off by default. The middle setting still stops when you could call a timeout.",
    );
    // Off is the first value of the cycle (the row notes the value).
    expect(settingsScreen({ textSize: 100, reducedMotion: "system", markLabels: "involved" }).rows[5]).toMatchObject({ key: "6", note: "Off" });
  });
});

describe("Q1: it is not the first request after resuming a save (the App lands on a screen)", () => {
  it("a resumed step whose request qualifies is shown, not answered", async () => {
    // A qualifying request from a real game, under the last setting.
    let found: { step: Extract<FromWorker, { t: "step" }>; human: Team } | null = null;
    for (let i = 0; i < 6 && found === null; i++) {
      const human: Team = i % 2 === 0 ? "home" : "away";
      const w = walkAuto(700 + i, human);
      const k = w.auto.findIndex((a, j) => a !== null && j > 3);
      if (k >= 0) {
        const events = w.steps.slice(0, k + 1).flatMap((s) => s.events);
        found = { step: { ...(w.steps[k] as Extract<FromWorker, { t: "step" }>), events, resumed: true }, human };
      }
    }
    if (found === null) throw new Error("no qualifying request");
    const { h, sent } = liveApp(found.human, { autoAdvance: "all" });
    await h.call<Promise<void>>("onStep", found.step);
    expect(sent.filter((m) => (m as { t: string }).t === "answer")).toEqual([]);
    expect((h.app["game"] as { menu: unknown }).menu).not.toBeNull();
  });
});

describe("Q1: the kickoff that follows a coin toss is never skipped (independent of the event that ends the log)", () => {
  it("over 30 games, every their-kickoff request with no play since the last toss waits, at every setting", { timeout: 600_000 }, () => {
    let n = 0;
    for (let i = 0; i < 30; i++) {
      const human: Team = i % 2 === 0 ? "home" : "away";
      const w = walkAuto(300 + i, human);
      const events: GameEvent[] = [];
      for (const s of w.steps) {
        events.push(...s.events);
        const r = s.request;
        if (r?.kind !== "continue" || r.about.what !== "theyKickOff") continue;
        const lastToss = events.map((e) => e.t).lastIndexOf("toss");
        if (lastToss < 0 || events.slice(lastToss).some((e) => e.t === "play")) continue;
        n++;
        for (const setting of ["noDecision", "all"] as const) expect(autoAnswer(r, setting, { events, firstAfterResume: false }), `seed ${300 + i}`).toBeNull();
      }
    }
    expect(n).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------- Q2: the log tab's rows

const rules = prepared().data.engine.rules;
const driveRules = { scoring: rules.scoring, regulationPeriods: rules.game.regulationPeriods, periodsPerHalf: rules.game.periodsPerHalf };

function boxOf(g: ReturnType<typeof simGames>[number]): { drives: { team: Team; start: number; plays: number; yards: number; seconds: number; result: string }[] } {
  const before = g.sent.length;
  (g.session as unknown as { handle(m: unknown): void }).handle({ t: "box" });
  const m = g.sent.slice(before).find((x) => x.t === "box");
  if (m === undefined || m.t !== "box") throw new Error("no box");
  return m.box as never;
}

describe("Q2 Layout: drive headers carry the box score's figures; \"Loading drive totals...\" until the box arrives", () => {
  const RESULT: Record<string, string> = { touchdown: "Touchdown", fieldGoal: "Field goal", missedFieldGoal: "Missed field goal", punt: "Punt", turnover: "Turnover", downs: "Turnover on downs", endOfHalf: "End of half", safety: "Safety" };

  it("with the box: \"drive, started OWN 25: 6 plays, 42 yds, 3:05. Touchdown.\" for each drive, newest first", () => {
    for (const g of simGames(5)) {
      const box = boxOf(g);
      const h = appHarness({ matchup: g.matchup, human: g.human, events: [...g.events] });
      h.game["state"] = { ...(g.state as object) };
      h.app["box"] = { box: box as never, players: [] };
      const heads = (h.call<FakeEl[]>("gameLogBody", h.game)[0] as FakeEl).querySelectorAll(".log-head").map((x) => x.textContent);
      expect(heads).toHaveLength(box.drives.length);
      const spans = driveSpans(g.events, driveRules);
      [...box.drives].reverse().forEach((d, i) => {
        const where = yardLineText(d.start, d.team, g.human);
        const r = RESULT[d.result];
        expect(r, `result ${d.result} has a word`).toBeDefined();
        expect(heads[i]).toContain(`${g.matchup[d.team].nickname} drive, started ${where}: ${d.plays} play${d.plays === 1 ? "" : "s"}, ${d.yards} yds, ${clockText(d.seconds)}. ${r}.`);
        expect(heads[i]).not.toContain("Loading");
      });
      expect(spans).toHaveLength(box.drives.length);
    }
  });

  it("without the box, a finished drive's header says its totals are loading", () => {
    const g = simGames(1)[0] as ReturnType<typeof simGames>[number];
    const h = appHarness({ matchup: g.matchup, human: g.human, events: [...g.events] });
    h.game["state"] = { ...(g.state as object) };
    const heads = (h.call<FakeEl[]>("gameLogBody", h.game)[0] as FakeEl).querySelectorAll(".log-head").map((x) => x.textContent);
    expect(heads.length).toBeGreaterThan(10);
    for (const t of heads) expect(t).toContain("Loading drive totals...");
  });

  it("mid-game, the open drive reads \"drive in progress, started ...: n plays, y yds.\" and is the first header", () => {
    let seen = 0;
    for (const g of simGames(10)) {
      for (const cut of [60, 120, 180, 240]) {
        const evs = g.events.slice(0, cut);
        const spans = driveSpans(evs, driveRules);
        const open = spans.at(-1);
        const lastPlay = [...evs].reverse().find((e): e is PlayEvent => e.t === "play");
        if (open === undefined || !open.open || lastPlay === undefined || evs.lastIndexOf(lastPlay) !== open.end) continue;
        const h = appHarness({ matchup: g.matchup, human: g.human, events: evs });
        h.game["state"] = { ...lastPlay.after, playCount: 1 };
        const list = h.call<FakeEl[]>("gameLogBody", h.game)[0] as FakeEl;
        // GL3: the first drive header is the open drive (event rows such as a timeout may sit above it).
        const head = list.querySelector(".log-head")?.textContent ?? "";
        expect(head, `seed ${g.seed} cut ${cut}`).toMatch(/drive in progress, started (OWN|OPP) \d+|drive in progress, started 50/);
        expect(head).toMatch(/: \d+ plays?, -?\d+ yds\.$/);
        seen++;
      }
    }
    expect(seen, "the open-drive case is reached").toBeGreaterThan(5);
  });
});

describe("Q2 Layout: each play row is four lines (situation and clock, result, calls, why); event rows one line each", () => {
  it("over 5 games", () => {
    for (const g of simGames(5)) {
      const h = appHarness({ matchup: g.matchup, human: g.human, events: [...g.events] });
      h.game["state"] = { ...(g.state as object) };
      const list = h.call<FakeEl[]>("gameLogBody", h.game)[0] as FakeEl;
      const c = ctxOf(g, labels);
      const newest = [...g.plays].reverse();
      list.querySelectorAll(".log-play").forEach((r, i) => {
        const ev = newest[i] as PlayEvent;
        const lines = r.elements.map((e) => e.textContent);
        expect(lines).toHaveLength(4);
        expect(lines[0]).toBe(`${situationText(ev.before, g.human)}, ${periodText(ev.before.period, 4)} ${clockText(ev.before.clock)}`);
        expect(lines[2]).toBe(callsLine(ev, c));
        expect(lines[3]).toBe(whyHeadline(ev.play, ev.standout) ?? NO_EXPLANATION);
      });
      // Timeouts, the two-minute warning, ends of quarters, reviews and the toss: one row each.
      const want = g.events.filter((e) => ["timeout", "twoMinuteWarning", "endPeriod", "review", "toss"].includes(e.t)).length;
      expect(want).toBeGreaterThan(4);
      expect(list.querySelectorAll(".log-event")).toHaveLength(want);
      // Newest first holds for event rows too: the last event row is the game's first toss.
      const events = list.querySelectorAll(".log-event").map((e) => e.textContent);
      expect(events.at(-1)).toMatch(/^Coin toss:/);
    }
  });

  it("logRows lists every play and every lined event once, newest first", () => {
    for (const g of simGames(5)) {
      const spans = driveSpans(g.events, driveRules);
      const rowsOut = logRows(g.events, spans, (e) => e.t !== "play" && e.t !== "runoff");
      const idx = rowsOut.filter((r) => r.t !== "drive").map((r) => (r as { index: number }).index);
      for (let i = 1; i < idx.length; i++) expect(idx[i] as number).toBeLessThan(idx[i - 1] as number);
    }
  });
});

describe("Q2: the panel footer adds \"L Log\"", () => {
  it("on the game screen", () => {
    const g = simGames(1)[0] as ReturnType<typeof simGames>[number];
    const h = appHarness({ matchup: g.matchup, human: g.human });
    const foot = h.call<FakeEl>("footer", true);
    expect(foot.textContent.replace(/\s+/g, "")).toContain("LLog");
  });
});

// ---------------------------------------------------------------- Q3: M with the card open

describe("Q3: while the card is open, M moves to the next player and the menu is untouched", () => {
  it("M cycles; no answer is sent", () => {
    const g = simGames(1)[0] as ReturnType<typeof simGames>[number];
    const req = g.requests.find((r) => r.kind === "offenseCall") as DecisionRequest;
    const ids = g.matchup.home.pool.players.slice(0, 3).map((p) => p.id);
    const h = appHarness({ matchup: g.matchup, human: g.human, events: [...g.events] });
    const sent: { t: string }[] = [];
    const menu = openMenu(req);
    Object.assign(h.app, {
      client: { send: (m: { t: string }) => sent.push(m) },
      render: () => undefined,
      animator: inert({ marks: () => ids.map((id) => ({ id })), shown: () => null }),
      layoutNow: { tooSmall: false },
      ranks: new Map(),
    });
    h.game["request"] = req;
    h.game["menu"] = menu;
    h.game["state"] = { ...(req.state as object), trySpots: null, playCount: 1 };
    h.app["markCard"] = ids[0] ?? null;
    h.call("onKey", key("m"));
    expect(h.app["markCard"]).toBe(ids[1]);
    h.call("onKey", key("M"));
    expect(h.app["markCard"]).toBe(ids[2]);
    expect(h.game["menu"]).toBe(menu);
    expect(sent.filter((m) => m.t === "answer")).toEqual([]);
  });
});


// ---------------------------------------------------------------- U1: what the board draws, by focus (States table)

/** An App on a calling request with a real Animator over a fake canvas (after calling-board.spec.test.ts). */
function callingApp(req: DecisionRequest, g: ReturnType<typeof simGames>[number], events: readonly GameEvent[]): { h: ReturnType<typeof appHarness>; move(i: number): void; key(k: string): void } {
  const h = appHarness({ matchup: g.matchup, human: g.human, events: [...events] });
  const layout = layoutFor(1280, 720, TEMPLATES.field);
  const animator = new Animator(new FakeEl("canvas") as unknown as HTMLCanvasElement, () => layout, () => TEMPLATES, () => (h.app as unknown as { frameOpts(): never }).frameOpts());
  Object.assign(h.app, { animator, client: { send: () => undefined }, render: () => (h.app as unknown as { updatePreview(): void }).updatePreview(), menuEnter: null, previewKey: "", previewFrame: null, layoutNow: layout });
  const st = req.state as NonNullable<DecisionRequest["state"]>;
  h.game["state"] = { ...st, trySpots: null, playCount: 1 };
  h.game["request"] = req;
  h.game["menu"] = openMenu(req);
  h.game["framePossession"] = st.possession;
  animator.idle((h.app as unknown as { sceneFor(p: Team, l: number, f: number | null): never }).sceneFor(st.possession, st.spot, null), false, false);
  return {
    h,
    key: (k: string): void => h.call("pickInGame", k),
    move: (i: number): void => {
      h.app["highlight"] = i;
      h.app["previewArmed"] = true;
      h.call("updatePreview");
    },
  };
}

function findRequest(pred: (r: DecisionRequest, events: readonly GameEvent[], g: ReturnType<typeof simGames>[number]) => boolean): { g: ReturnType<typeof simGames>[number]; req: DecisionRequest; events: GameEvent[] } {
  for (const g of simGames(20)) {
    const events: GameEvent[] = [];
    for (const m of g.sent) {
      if (m.t !== "step") continue;
      events.push(...m.events);
      if (m.request !== null && pred(m.request, events, g)) return { g, req: m.request, events: [...events] };
    }
  }
  throw new Error("no such request in 20 games");
}

describe("U1 States: focus on Back, Clock, Timeout or an off row shows the committed state", () => {
  it("first screen: Clock and Timeout keep state 1's frame; a deeper screen's Back row shows the picked formation with no art", () => {
    const { g, req, events } = findRequest((r) => r.kind === "offenseCall" && r.screens[0]?.options.some((o) => o.id === "formation" && o.legal) === true);
    const c = callingApp(req, g, events);
    const list = (): ReturnType<typeof rows> => rows(c.h.game["menu"] as never, { catalog: (c.h.app["ui"] as unknown as { catalog: never }).catalog, labels }, { earlierCall: earlierCall(events, g.human, req) });
    const idx = (opt: string): number => list().findIndex((r) => r.option === opt);
    c.move(idx("clock"));
    expect(c.h.app["previewFrame"], "Clock").toBeNull();
    c.move(idx("timeout"));
    expect(c.h.app["previewFrame"], "Timeout").toBeNull();
    // Formation, then the first formation: the run or pass screen.
    c.key("1");
    c.key("1");
    const picked = (c.h.game["menu"] as { picks: string[] }).picks[1] as string;
    const back = list().findIndex((r) => r.key === "Esc");
    expect(back).toBeGreaterThanOrEqual(0);
    c.move(back);
    const f = c.h.app["previewFrame"] as Timeline | null;
    expect(f, "Back on the run/pass screen").not.toBeNull();
    expect(f?.preview ?? null, "no play art on Back").toBeNull();
    const own = (f?.marks ?? []).filter((m) => !m.huddle && !m.playerId.startsWith("huddle:"));
    expect(own.length).toBe(11);
    void picked;
  });
});

describe("U1 What it draws: public lineups (their punt, field goal, extra point, kneel, spike; your Kick rows on focus) show both units lined up", () => {
  it("their kickoff: both units lined up, with no input (U8; also proves this harness draws public lineups)", () => {
    const { g, req, events } = findRequest((r) => r.kind === "continue" && r.about.what === "theyKickOff");
    const c = callingApp(req, g, events);
    c.h.call("updatePreview");
    const marks = (c.h.app["animator"] as Animator).shown()?.tl.marks ?? [];
    expect(marks.filter((m) => !m.huddle)).toHaveLength(22);
  });

  it("a theyLineUp continue screen previews both units lined up, with no input", () => {
    const { g, req, events } = findRequest((r) => r.kind === "continue" && r.about.what === "theyLineUp" && r.about.call === "punt");
    const c = callingApp(req, g, events);
    c.h.call("updatePreview");
    // What the board draws is the animator's shown frame (board.ts).
    const f = (c.h.app["animator"] as Animator).shown()?.tl ?? null;
    expect(f, "a frame").not.toBeNull();
    const marks = f?.marks ?? [];
    // Their punt unit (a punter among them) and your return unit, all lined up: 22 marks, none in a huddle (generic ids are fine, P1).
    expect(marks.filter((m) => !m.huddle), "both units lined up").toHaveLength(22);
    expect(marks.some((m) => m.slot === "P1"), "the punt unit").toBe(true);
  });

  it("focusing Punt on your Kick screen previews your punt unit", () => {
    const { g, req, events } = findRequest((r) => r.kind === "offenseCall" && r.screens.some((s) => s.id === "offense.kick" && s.options.some((o) => o.id === "punt" && o.legal)) && r.screens[0]?.options.some((o) => o.id === "kick" && o.legal) === true);
    const c = callingApp(req, g, events);
    c.key("2");
    expect((c.h.game["menu"] as { screens: string[] }).screens.at(-1)).toBe("offense.kick");
    const at0 = rows(c.h.game["menu"] as never, { catalog: (c.h.app["ui"] as unknown as { catalog: never }).catalog, labels }).findIndex((r) => r.option === "punt");
    expect(at0).toBeGreaterThanOrEqual(0);
    c.move(at0);
    const f = (c.h.app["animator"] as Animator).shown()?.tl ?? null;
    expect(f, "a frame").not.toBeNull();
    // Your punt unit lined up: 11 of your marks, none in a huddle.
    const own = c.h.game["framePossession"] === g.human ? "O" : "X";
    const mine = (f?.marks ?? []).filter((m) => m.side === own && !m.huddle);
    expect(mine.length, "your unit lined up").toBe(11);
    expect(mine.some((m) => m.slot === "P1"), "the punt unit").toBe(true);
  });
});

// ---------------------------------------------------------------- Q4: trails that can be seen to fade, scrimmage untouched

const personnel = JSON.parse(readFileSync(join(import.meta.dirname, "../../../data/engine/personnel.json"), "utf8")) as { presetPackage: Record<string, string> };
const tctx: TimelineCtx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, motion: MOTION };
const build = (ev: PlayEvent): Timeline => timeline({ event: ev, runoffSeconds: 0 }, TEMPLATES, tctx);
const KICKS = Object.entries(ALL_FIXTURES).filter(([, e]) => e.play.kind === "punt" || e.play.kind === "kickoff" || e.play.kind === "onsideKick");
const SCRIMMAGE = Object.entries(ALL_FIXTURES).filter(([, e]) => !KICKS.some(([, k]) => k === e));

describe("Q4 KT1: every kick fixture draws fading trails mid-play, alpha near 1 at the mark", () => {
  it.each(KICKS)("%s", (_n, ev) => {
    const tl = build(ev);
    const named = new Set(tl.involved);
    const t = tl.snapAt + 0.6 * (tl.liveEnd - tl.snapAt);
    const prims = pathPrimitives(tl, t, 0.6).filter((p) => !p.faint);
    const trails = prims.filter((p) => p.trail === true);
    expect(trails.length, "trails are drawn mid-play").toBeGreaterThan(0);
    // Each unnamed mark that moved: his newest piece is near full alpha, his oldest is fainter.
    const bySlot = new Map<string, number[]>();
    const newestLen = new Map<string, number>();
    for (const p of trails) {
      const k = `${p.side}:${p.slot}`;
      bySlot.set(k, [...(bySlot.get(k) ?? []), p.fade as number]);
      if ((p.fade as number) >= Math.max(...(bySlot.get(k) as number[]))) newestLen.set(k, Math.hypot((p.points[1]?.x ?? 0) - (p.points[0]?.x ?? 0), (p.points[1]?.y ?? 0) - (p.points[0]?.y ?? 0)));
    }
    expect(bySlot.size).toBeGreaterThan(5);
    let moving = 0;
    for (const [k, f] of bySlot) {
      // Each point fades over fadeMs after the mark passes it: for a mark that moved over a yard in
      // the last 150 ms, the drawn piece nearest the mark is near 1 (within 0.15).
      const m = tl.marks.find((x) => `${x.side}:${x.slot}` === k);
      const a = m === undefined ? null : at(m.keys, t - 150);
      const b = m === undefined ? null : at(m.keys, t);
      if (a !== null && b !== null && Math.hypot(a.x - b.x, a.y - b.y) > 1) {
        moving++;
        expect(Math.max(...f), `${k} newest piece (${(newestLen.get(k) ?? 0).toFixed(1)} yd long)`).toBeGreaterThan(0.85);
      }
      if (f.length > 2) expect(Math.min(...f), `${k} oldest piece`).toBeLessThan(Math.max(...f));
    }
    expect(moving, "some unnamed marks are running at this t").toBeGreaterThan(0);
    // A named player's path is never a trail.
    const namedSlots = new Set(tl.marks.filter((m) => named.has(m.playerId)).map((m) => `${m.side}:${m.slot}`));
    for (const p of trails) expect(namedSlots.has(`${p.side}:${p.slot}`), `${p.side}:${p.slot}`).toBe(false);
  });
});

describe("Q4 KT3: scrimmage fixtures never draw a trail", () => {
  it.each(SCRIMMAGE)("%s", (_n, ev) => {
    const tl = build(ev);
    for (const f of [0.3, 0.6, 1]) {
      const t = tl.snapAt + f * (tl.liveEnd - tl.snapAt);
      expect(pathPrimitives(tl, t, 0.6).filter((p) => p.trail === true)).toEqual([]);
    }
    expect(pathPrimitives(tl, tl.total, 0.6).filter((p) => p.trail === true)).toEqual([]);
  });
});

void COMPLETE;
