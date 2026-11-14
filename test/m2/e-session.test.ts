// M2 milestone E, the step-wise loop (docs/specs/m2-engine-and-game-loop.md E1-E7; review fix 1,
// dde779a: every request carries the state it is decided in; review fix 5, a26af71: tempo-mode
// cells are data/game/tempo-modes.json). Human answers come from a scripted bot whose answer is a
// pure function of the request, so a resumed run answers exactly as an uninterrupted one.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { decisionRequestSchema } from "../../packages/shared/src/m2-schema";
import type { CoachView, DecisionAnswer, DecisionRequest, RequestEvent, RequestState } from "../../packages/shared/src/types";
import { MAX_CHOICES_PER_SCREEN } from "../../packages/shared/src/types";
import { REASON_CODES } from "../../packages/shared/src/game";
import { averageCoach, labelOf, tempoShares, tempoModeView, type CoachPolicies } from "../../packages/sim/src/loop/coach";
import { averageCoachFor, setupGame } from "../../packages/sim/src/loop/league";
import { playGame, prepareGame, type GameEvent, type GameRecord, type GameSetup, type Seat } from "../../packages/sim/src/loop/play";
import { answerSession, replaySession, sessionRecord, startSession, type Session } from "../../packages/sim/src/loop/session";
import { Rng } from "../../packages/sim/src/rng";
import { REPO, loadGameData } from "../../scripts/game/data";
import { LEAGUE_SEED, coach, data, deepFreeze, finalPaths, kit, offPaths, playSession, scriptedBot, setupFor, sliceGames, teams, type Asked, type Bot, type BotStyle } from "./support";

// Whole games per test: the default 5 s is too short when the full suite runs in parallel.
vi.setConfig({ testTimeout: 120_000 });

type Team = "home" | "away";
const other = (t: Team): Team => (t === "home" ? "away" : "home");
const KICK_KNEEL_SPIKE = new Set(["punt", "fieldGoal", "extraPoint", "kneel", "spike"]);

// ------------------------------------------------------------------ the scripted games (E4's set)

const lead = (r: DecisionRequest, human: Team): number => (r.state === null ? 0 : r.state.score[human] - r.state.score[other(human)]);
/** Kneel out a lead and hurry when behind, late in the 4th. */
const lateGame = (human: Team): NonNullable<BotStyle["prefer"]> => (r) => {
  const st = r.state;
  if (r.kind !== "offenseCall" || st === null || st.period !== 4 || st.clock >= 150) return null;
  if (lead(r, human) > 0) return ["clock", "kneel"];
  if (lead(r, human) < 0 && r.tempo !== "hurryUp") return ["clock", "hurryUp"];
  return null;
};
const BUSY: BotStyle = { timeout: 0.05, onside: 0.3, two: 0.5, clock: 0.2 };

interface Played {
  readonly seed: number;
  readonly human: Team;
  readonly setup: GameSetup;
  readonly bot: Bot;
  readonly session: Session;
  readonly asked: Asked[];
  readonly record: GameRecord;
}

function play(seed: number, human: Team, style: BotStyle): Played {
  const setup = setupFor(seed);
  const bot = scriptedBot(seed, style);
  const { session, asked } = playSession(setup, kit, human, bot);
  return { seed, human, setup, bot, session, asked, record: sessionRecord(session, setup, kit) };
}

const GAMES: Played[] = [
  ...Array.from({ length: 16 }, (_, i) => play(i + 1, i % 2 === 0 ? "away" : "home", BUSY)),
  play(13, "away", BUSY),
  play(45, "away", BUSY),
  play(30, "home", { prefer: lateGame("home") }),
  play(44, "home", { prefer: lateGame("home") }),
  play(286, "home", { prefer: lateGame("home") }),
];

const short = (e: GameEvent): RequestEvent | { t: string } => {
  // The seconds the clock really ran (the log keeps the drawn value): a two-minute warning or the
  // end of the period can cut the run-off short; at a period end the clock ran out from before.clock.
  if (e.t === "runoff") return { t: "runoff", seconds: e.after.period === e.before.period ? e.before.clock - e.after.clock : e.before.clock };
  if (e.t === "timeout") return { t: "timeout", team: e.team, side: e.side, left: e.left };
  if (e.t === "twoMinuteWarning") return { t: "twoMinuteWarning", period: e.period };
  if (e.t === "endPeriod") return { t: "endPeriod", period: e.period };
  return { t: e.t };
};
const stateOf = (s: Extract<GameEvent, { t: "play" }>["before"]): RequestState => ({
  period: s.period, clock: s.clock, clockRunning: s.clockRunning, phase: s.phase, possession: s.possession, spot: s.spot, down: s.down, distance: s.distance,
  goalToGo: s.goalToGo, score: s.score, timeouts: s.timeouts, safetyKick: s.safetyKick,
});
/** The record's events from this request's dead ball on. */
const deadBall = (g: Played, a: Asked): readonly GameEvent[] => g.record.events.slice(a.before.run?.events.length ?? 0);

// ------------------------------------------------------------------ E1

describe("E1: with no human seat the step-wise loop is playGame", () => {
  it("records are deep-equal for the first 40 CI slice games", () => {
    for (const { seed, setup } of sliceGames(40)) {
      const s = startSession(setup, kit, null);
      expect(s.request).toBeNull();
      expect(s.inputs).toEqual([]);
      expect(sessionRecord(s, setup, kit)).toStrictEqual(playGame(setup, kit, Rng.fromSeed(seed)));
    }
  });
});

// ------------------------------------------------------------------ E2

describe("E2: seed plus input log replays the game exactly", () => {
  const g = GAMES[0] as Played;

  it("the same seed and answers give a deep-equal record, played twice", () => {
    const again = play(g.seed, g.human, BUSY);
    expect(again.record).toStrictEqual(g.record);
    expect(again.session.inputs).toStrictEqual(g.session.inputs);
  });

  it("replaySession from the setup and the input log alone (through JSON) rebuilds the session and record", () => {
    const inputs = JSON.parse(JSON.stringify(g.session.inputs)) as DecisionAnswer[];
    expect(inputs.length).toBe(g.asked.length);
    const r = replaySession(setupFor(g.seed), kit, g.human, inputs);
    expect(r).toStrictEqual(g.session);
    expect(sessionRecord(r, setupFor(g.seed), kit)).toStrictEqual(g.record);
    expect(r.request).toBeNull();
  });

  it("a different answer at one request changes the game", () => {
    const i = g.asked.findIndex((a, j) => j > 30 && a.request.kind === "offenseCall" && finalPaths(a.request, true).length > 10);
    const a = g.asked[i] as Asked;
    const alt = finalPaths(a.request, true).find((p) => p[0] !== a.answer.path[0] && p[0] !== "timeout" && p[0] !== "clock") as string[];
    const r = answerSession(a.before, g.setup, kit, { seq: a.request.seq, path: alt });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rest = playSession(g.setup, kit, g.human, g.bot, r.session);
    expect(sessionRecord(rest.session, g.setup, kit).events).not.toEqual(g.record.events);
  });

  it("a log whose toss answer is flipped replays a different game, or is rejected where it no longer fits", () => {
    const t = GAMES.find((x) => x.asked[0]?.request.kind === "toss") as Played;
    expect(t).toBeDefined();
    const flip = t.session.inputs.map((x, j) => (j === 0 ? { ...x, path: [x.path[0] === "receive" ? "defer" : "receive"] } : x));
    let rec: GameRecord;
    try {
      rec = sessionRecord(replaySession(t.setup, kit, t.human, flip), t.setup, kit);
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
      return;
    }
    expect(rec.events).not.toEqual(t.record.events);
  });
});

// ------------------------------------------------------------------ E3, and answerSession never mutates

describe("E3: save and resume at every request", () => {
  const g = GAMES.find((x) => x.seed === 44) as Played;

  it("the game holds a pending penalty and run-off request among its saves", () => {
    expect(g.asked.some((a) => a.request.kind === "penalty")).toBe(true);
    expect(g.asked.some((a) => a.request.kind === "runoff")).toBe(true);
  });

  it("at every request, a JSON and a structuredClone copy are plain data and resume to the same game", () => {
    for (const [i, a] of g.asked.entries()) {
      const viaJson = JSON.parse(JSON.stringify(a.before)) as Session;
      expect(viaJson, `request ${i}`).toStrictEqual(a.before);
      const viaClone = structuredClone(a.before);
      expect(viaClone, `request ${i}`).toStrictEqual(a.before);
      if (i % 4 !== 0 && a.request.kind !== "penalty" && a.request.kind !== "runoff" && a.request.kind !== "continue") continue;
      for (const copy of [viaJson, viaClone]) {
        const rest = playSession(g.setup, kit, g.human, g.bot, copy);
        expect(sessionRecord(rest.session, g.setup, kit), `resume at request ${i} (${a.request.kind})`).toStrictEqual(g.record);
      }
    }
  }, 120_000);
});

describe("answerSession never changes the session it is given", () => {
  it("every answer of two games, given a deep-frozen session, works and leaves it byte-identical", () => {
    for (const g of [GAMES[1] as Played, GAMES.find((x) => x.seed === 44) as Played]) {
      let s = startSession(g.setup, kit, g.human);
      let n = 0;
      while (s.request !== null) {
        const before = JSON.stringify(s);
        deepFreeze(s);
        const r = answerSession(s, g.setup, kit, { seq: s.request.seq, path: g.bot(s.request) });
        expect(JSON.stringify(s)).toBe(before);
        expect(r.ok).toBe(true);
        if (!r.ok) break;
        s = r.session;
        n++;
      }
      expect(sessionRecord(s, g.setup, kit)).toStrictEqual(g.record);
      expect(n).toBe(g.asked.length);
    }
  });

  it("a rejected answer leaves the session unchanged, with a typed error", () => {
    const g = GAMES[2] as Played;
    for (const a of g.asked.slice(0, 120)) {
      const before = JSON.stringify(a.before);
      deepFreeze(a.before);
      for (const [path, code] of [
        [["noSuchOption"], "unknownOption"],
        [[], "incompletePath"],
        ...offPaths(a.request).map((o) => [o.path, "illegalOption"] as const),
      ] as [string[], string][]) {
        const r = answerSession(a.before, g.setup, kit, { seq: a.request.seq, path });
        expect(r.ok, `${a.request.kind} ${path.join(">")}`).toBe(false);
        if (!r.ok) expect(r.error.code).toBe(code);
      }
      const stale = answerSession(a.before, g.setup, kit, { seq: a.request.seq - 1, path: a.answer.path });
      expect(stale.ok === false && stale.error.code).toBe("staleRequest");
      expect(JSON.stringify(a.before)).toBe(before);
    }
    const done = answerSession(g.session, g.setup, kit, { seq: g.session.seq, path: ["continue"] });
    expect(done.ok === false && done.error.code).toBe("noRequest");
  });

  it("a path that stops on an option that opens a screen is incomplete", () => {
    const a = (GAMES[2] as Played).asked.find((x) => x.request.kind === "offenseCall") as Asked;
    const r = answerSession(a.before, (GAMES[2] as Played).setup, kit, { seq: a.request.seq, path: ["pass"] });
    expect(r.ok === false && r.error.code).toBe("incompletePath");
  });
});

// ------------------------------------------------------------------ E4

describe("E4: every request kind is reached in the scripted games", () => {
  const tags = new Set<string>();
  for (const g of GAMES) {
    const plays = g.record.events.filter((e): e is Extract<GameEvent, { t: "play" }> => e.t === "play");
    for (const a of g.asked) {
      const r = a.request;
      const p = a.answer.path;
      tags.add(r.kind);
      if (r.kind === "toss") tags.add("humanWinsToss");
      if (r.kind === "continue" && r.about.what === "tossResult") tags.add("humanLosesToss");
      if (r.kind === "kickoff" && p[0] === "onsideKick") tags.add("humanOnside");
      if (r.kind === "continue" && r.about.what === "theyKickOff" && r.about.onside) tags.add("aiOnside");
      if (r.kind === "offenseCall" && r.state?.down === 4 && (p[0] === "run" || p[0] === "pass")) tags.add("fourthDownGo");
      if (r.kind === "offenseCall" && p[0] === "kick") tags.add(p[1] as string);
      if (r.kind === "try" && p[0] === "goForTwo") tags.add("humanTwo");
      if (r.kind === "defenseCall" && r.onTry) tags.add("aiTwo");
      if (r.kind === "offenseCall" && p[0] === "clock" && (p[1] === "hurryUp" || p[1] === "runClock")) tags.add(`tempo:${p[1]}`);
      if (r.kind === "continue" && r.about.what === "theyLineUp") tags.add(`theyLineUp:${r.about.call}`);
    }
    for (const e of g.record.events) if (e.t === "timeout") tags.add(`timeout:${e.team === g.human ? "human" : "ai"}:${e.side}`);
    if (g.record.final.period > 4) tags.add("overtime");
    if (g.record.final.score.home === g.record.final.score.away) tags.add("tie");
    const last = plays[plays.length - 1];
    if (last?.play.kind === "kneel" && last.before.possession === g.human) tags.add("endsOnHumanKneel");
  }

  it.each([
    "toss", "overtimeToss", "kickoff", "try", "offenseCall", "defenseCall", "penalty", "runoff", "continue",
    "humanWinsToss", "humanLosesToss", "humanOnside", "aiOnside", "fourthDownGo", "punt", "fieldGoal", "humanTwo", "aiTwo",
    "tempo:hurryUp", "tempo:runClock", "timeout:human:offense", "timeout:human:defense", "timeout:ai:offense", "timeout:ai:defense",
    "overtime", "tie", "endsOnHumanKneel", "theyLineUp:punt", "theyLineUp:fieldGoal", "theyLineUp:kneel", "theyLineUp:extraPoint",
  ])("%s", (tag) => {
    expect(tags).toContain(tag);
  });
});

// ------------------------------------------------------------------ E5

describe("E5: only legal options, reasons on every off option, at most seven choices", () => {
  const all = GAMES.flatMap((g) => g.asked.map((a) => ({ g, a })));

  it("every request parses, every screen has at most six options plus Esc, ids unique, every screen it opens is in it", () => {
    for (const { a } of all) {
      const r = a.request;
      expect(() => decisionRequestSchema.parse(r)).not.toThrow();
      expect(r.screens.length).toBeGreaterThan(0);
      for (const s of r.screens) {
        expect(s.options.length + 1, `${r.kind} ${s.id}`).toBeLessThanOrEqual(MAX_CHOICES_PER_SCREEN);
        expect(new Set(s.options.map((o) => o.id)).size).toBe(s.options.length);
        for (const o of s.options) {
          if (o.opens !== undefined) expect(r.screens.map((x) => x.id), `${s.id} ${o.id}`).toContain(o.opens);
          if (o.legal) expect(o.reason, `${s.id} ${o.id}`).toBeUndefined();
          else expect(REASON_CODES as readonly string[], `${s.id} ${o.id}`).toContain(o.reason);
        }
      }
      expect(finalPaths(r, true).length, r.kind).toBeGreaterThan(0);
    }
  });

  it("legality follows the state the request carries: timeouts, kicks, Same call", () => {
    const perDeadBall = data.engine.rules.timeouts.perTeamPerDeadBall;
    for (const { g, a } of all) {
      const r = a.request;
      const st = r.state;
      if (st === null) continue;
      const first = r.screens[0]?.options ?? [];
      const to = first.find((o) => o.id === "timeout");
      if (to !== undefined) {
        const taken = r.events.filter((e) => e.t === "timeout" && e.team === g.human).length;
        if (st.timeouts[g.human] <= 0) expect(to.reason, `${r.kind}`).toBe("noTimeouts");
        else if (taken >= perDeadBall) expect(to.reason).toBe("timeoutTaken");
        else expect(to.legal, `${r.kind} with ${st.timeouts[g.human]} timeouts`).toBe(true);
      }
      if (r.kind === "offenseCall" && st.period <= 4) {
        const kick = first.find((o) => o.id === "kick");
        const late = (st.period === 2 || st.period === 4) && st.clock <= 120;
        expect(kick?.legal, `kick on down ${st.down}, period ${st.period} ${st.clock}s`).toBe(st.down === 4 || late);
        if (kick?.legal === false) expect(kick.reason).toBe("kickNotNow");
      }
    }
    // Same call is off with noEarlierCall on this side's first call of the game.
    for (const g of GAMES) {
      const firstOffense = g.asked.find((a) => a.request.kind === "offenseCall")?.request;
      const sc = firstOffense?.screens[0]?.options.find((o) => o.id === "sameCall");
      expect(sc?.legal).toBe(false);
      expect(sc?.reason).toBe("noEarlierCall");
      const firstDefense = g.asked.find((a) => a.request.kind === "defenseCall")?.request;
      const sd = firstDefense?.screens[0]?.options.find((o) => o.id === "sameCall");
      expect(sd?.reason).toBe("noEarlierCall");
    }
  });

  it("every legal final path of every request in two games is accepted", () => {
    for (const g of [GAMES[3] as Played, GAMES.find((x) => x.seed === 44) as Played]) {
      for (const a of g.asked) {
        for (const path of finalPaths(a.request, true)) {
          const r = answerSession(a.before, g.setup, kit, { seq: a.request.seq, path });
          expect(r.ok, `${a.request.kind}: ${path.join(" > ")}`).toBe(true);
        }
      }
    }
  });
});

// ------------------------------------------------------------------ E6 and review fix 1

/** Every string reachable in an object (keys and values), outside the menu screens. */
function strings(x: unknown, path: string, out: { path: string; value: string }[]): void {
  if (typeof x === "string") out.push({ path, value: x });
  else if (typeof x === "function") out.push({ path, value: "<function>" });
  else if (Array.isArray(x)) x.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (x !== null && typeof x === "object") {
    for (const [k, v] of Object.entries(x)) {
      if (path === "" && k === "screens") continue;
      out.push({ path: `${path}.${k}#key`, value: k });
      strings(v, `${path}.${k}`, out);
    }
  }
}

describe("E6: no request holds the opponent's call before the snap", () => {
  it("walking every request of the E4 games finds no opponent call, formation or preset, except a visible kick, kneel or spike", () => {
    const leaks: string[] = [];
    let checked = 0;
    for (const g of GAMES) {
      for (const a of g.asked) {
        const r = a.request;
        if (r.kind === "penalty" || r.kind === "runoff") continue; // after the snap: both calls are public
        const next = deadBall(g, a).find((e): e is Extract<GameEvent, { t: "play" }> => e.t === "play");
        if (next === undefined) continue;
        const humanSnaps = next.before.possession === g.human;
        const secret = humanSnaps ? [next.defense] : [next.offense.call, next.offense.formation, next.offense.twoPointPlay];
        const hidden = new Set(secret.filter((x): x is string => typeof x === "string"));
        const found: { path: string; value: string }[] = [];
        strings(r, "", found);
        for (const f of found) {
          if (f.value === "<function>") leaks.push(`${r.kind} ${f.path}: a function`);
          if (!hidden.has(f.value)) continue;
          // The game state's phase ("kickoff", "try") is not a call.
          if (f.path === ".state.phase" || f.path === ".about.what") continue;
          if (r.kind === "continue" && r.about.what === "theyLineUp" && f.path === ".about.call" && KICK_KNEEL_SPIKE.has(f.value)) continue;
          leaks.push(`${r.kind} ${f.path} = ${f.value}`);
        }
        if (r.kind === "continue" && r.about.what === "theyLineUp") {
          expect(KICK_KNEEL_SPIKE.has(r.about.call), r.about.call).toBe(true);
          expect(r.about.call).toBe(next.offense.call);
          expect(humanSnaps).toBe(false);
        }
        // An AI run or pass is never shown as a line-up: the human defense gets a call request.
        if (!humanSnaps && next.before.phase === "scrimmage" && !KICK_KNEEL_SPIKE.has(next.offense.call) && r.kind === "continue") expect(r.about.what).not.toBe("theyLineUp");
        checked++;
      }
    }
    expect(leaks.slice(0, 20)).toEqual([]);
    expect(checked).toBeGreaterThan(2000);
  });

  it("the menus a defense request shows are the same whatever the offense called (only Same call and Timeout legality vary)", () => {
    const shape = (r: DecisionRequest): string => JSON.stringify(r.screens.map((s) => ({ id: s.id, o: s.options.map((o) => (o.id === "sameCall" || o.id === "timeout" ? o.id : `${o.id}:${o.legal}:${o.opens ?? ""}`)) })));
    const forms = new Set<string>();
    for (const g of GAMES) for (const a of g.asked) if (a.request.kind === "defenseCall") forms.add(`${a.request.onTry}:${shape(a.request)}`);
    // One menu for a scrimmage play and one for a two-point try, whatever the offense called.
    expect(forms.size).toBeLessThanOrEqual(2);
  });

  it("request types carry no call of the other side before the snap (type level)", () => {
    type Keys<K extends DecisionRequest["kind"]> = keyof Extract<DecisionRequest, { kind: K }>;
    type Base = "seq" | "state" | "events" | "team" | "screens" | "kind";
    expectTypeOf<Keys<"defenseCall">>().toEqualTypeOf<Base | "onTry" | "sameCall">();
    expectTypeOf<Keys<"offenseCall">>().toEqualTypeOf<Base | "tempo" | "clockRunning" | "sameCall" | "fieldGoalYards">();
    expectTypeOf<Keys<"try">>().toEqualTypeOf<Base | "sameCall">();
    expectTypeOf<Keys<"kickoff">>().toEqualTypeOf<Base | "safetyKick">();
    expectTypeOf<Keys<"toss">>().toEqualTypeOf<Base>();
    expectTypeOf<Keys<"continue">>().toEqualTypeOf<Base | "about">();
    expectTypeOf<Extract<DecisionRequest, { kind: "defenseCall" }>["sameCall"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Extract<Extract<DecisionRequest, { kind: "continue" }>["about"], { what: "theyLineUp" }>>().toEqualTypeOf<{ readonly what: "theyLineUp"; readonly call: string }>();
    // The human seat asks with a request it can only make, and gets back the option path.
    expectTypeOf<Parameters<Seat["ask"]>>().toEqualTypeOf<[make: () => Parameters<Parameters<Seat["ask"]>[0] extends () => infer R ? (r: R) => void : never>[0]]>();
    expectTypeOf<ReturnType<Seat["ask"]>>().toEqualTypeOf<readonly string[]>();
    // The AI policies still see only the shared views (step 5 A4, test/game/step5.spec-check.test.ts).
    expectTypeOf<Parameters<CoachPolicies["tempo"]>[0]>().toEqualTypeOf<CoachView>();
  });
});

describe("review fix 1: every request's state and events are the game at that moment", () => {
  it("state is the `before` of the first event after the request's events, and events are this dead ball's so far", () => {
    const bad: string[] = [];
    let n = 0;
    for (const g of GAMES) {
      for (const a of g.asked) {
        const r = a.request;
        if (a.before.run === null) {
          if (r.state !== null) bad.push(`${r.kind}: state before the game exists`);
          continue;
        }
        if (r.state === null) {
          bad.push(`${r.kind}: null state in a game`);
          continue;
        }
        const evs = deadBall(g, a);
        const k = r.events.length;
        if (JSON.stringify(evs.slice(0, k).map(short)) !== JSON.stringify(r.events)) bad.push(`${r.kind}: events ${JSON.stringify(r.events)} vs ${JSON.stringify(evs.slice(0, k).map(short))}`);
        const next = evs[k];
        if (next === undefined || !("before" in next)) {
          bad.push(`${r.kind}: no event with a state after the request (${next?.t})`);
          continue;
        }
        if (JSON.stringify(stateOf(next.before)) !== JSON.stringify(r.state)) bad.push(`${r.kind}: state ${JSON.stringify(r.state)} vs ${JSON.stringify(stateOf(next.before))}`);
        n++;
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
    expect(n).toBeGreaterThan(2000);
  });

  it("each run-off a request lists is the seconds the clock really ran, and the state's clock is the checkpoint's minus them", () => {
    const bad: string[] = [];
    let moved = 0;
    for (const g of GAMES) {
      for (const a of g.asked) {
        const r = a.request;
        if (r.state === null || a.before.run === null) continue;
        const real = deadBall(g, a).slice(0, r.events.length);
        r.events.forEach((e, i) => {
          const x = real[i];
          if (e.t !== "runoff" || x?.t !== "runoff" || x.after.period !== x.before.period) return;
          if (e.seconds !== x.before.clock - x.after.clock) bad.push(`${r.kind} seq ${r.seq}: run-off of ${e.seconds} s listed, the clock ran ${x.before.clock - x.after.clock} s (${x.before.clock} to ${x.after.clock})`);
        });
        const ran = r.events.reduce((t, e) => t + (e.t === "runoff" ? e.seconds : 0), 0);
        if (ran > 0 && !r.events.some((e) => e.t === "endPeriod")) {
          if (r.state.clock !== a.before.run.state.clock - ran) bad.push(`${r.kind} seq ${r.seq}: clock ${r.state.clock}, checkpoint ${a.before.run.state.clock} minus run-offs ${ran}`);
          moved++;
        }
        if (r.events.some((e) => e.t === "timeout" || e.t === "twoMinuteWarning") && r.state.clockRunning) bad.push(`${r.kind} seq ${r.seq}: clock running after a timeout or the warning`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
    expect(moved).toBeGreaterThan(50);
  });
});

// ------------------------------------------------------------------ E7: tempo

/** A coach whose tempo draws are logged once per distinct (view, Rng state): replays repeat draws. */
function spyCoach(log: Map<string, { view: CoachView; drawn: number }>): CoachPolicies {
  return {
    ...coach,
    tempo: (v, rng) => {
      const key = JSON.stringify([rng.getState(), v]);
      const drawn = coach.tempo(v, rng);
      if (!log.has(key)) log.set(key, { view: v, drawn });
      return drawn;
    },
  };
}

function withTempo(seed: number, tempo: "hurryUp" | "normal" | "runClock"): Bot {
  const base = scriptedBot(seed, { clock: 0 });
  return (r) => (r.kind === "offenseCall" && r.tempo !== tempo ? ["clock", tempo] : base(r));
}

function humanRunoffs(rec: GameRecord, human: Team): Extract<GameEvent, { t: "runoff" }>[] {
  return rec.events.filter((e): e is Extract<GameEvent, { t: "runoff" }> => e.t === "runoff" && e.before.possession === human);
}

describe("E7: tempo modes", () => {
  const modesFile = JSON.parse(readFileSync(join(REPO, "data/game/tempo-modes.json"), "utf8")) as { modes: Record<string, Record<string, number>> };

  it("Normal draws are the human team's average-coach draws (same view, same Rng)", () => {
    let matched = 0;
    for (const seed of [3, 4, 5, 6]) {
      const human: Team = seed % 2 === 0 ? "home" : "away";
      const log = new Map<string, { view: CoachView; drawn: number }>();
      const humanName = setupFor(seed).home.name;
      const setup = setupGame(teams, LEAGUE_SEED, seed, (t) => ((t.name === humanName) === (human === "home") ? spyCoach(log) : coach));
      const { session } = playSession(setup, kit, human, withTempo(seed, "normal"));
      const rec = sessionRecord(session, setup, kit);
      const spied = [...log.values()].map((x) => x.drawn).filter((d) => d > 0);
      const drawn = humanRunoffs(rec, human).map((e) => e.drawn);
      expect(drawn).toEqual(spied.slice(0, drawn.length));
      matched += drawn.length;
    }
    expect(matched).toBeGreaterThan(100);
  });

  it("Hurry-up and Run the clock never consult the average coach's tempo for the human offense", () => {
    for (const tempo of ["hurryUp", "runClock"] as const) {
      const seed = 7;
      const log = new Map<string, { view: CoachView; drawn: number }>();
      const humanName = setupFor(seed).home.name;
      const setup = setupGame(teams, LEAGUE_SEED, seed, (t) => (t.name === humanName ? spyCoach(log) : coach));
      const { session } = playSession(setup, kit, "home", withTempo(seed, tempo));
      expect(humanRunoffs(sessionRecord(session, setup, kit), "home").length).toBeGreaterThan(20);
      expect(log.size, tempo).toBe(0);
    }
  });

  it("the mode cells are the spec's: Hurry-up a trailing offense in the final 2:00, Run the clock a leading one in the final 5:00", () => {
    const dims = data.config.dimensions;
    const view = { quarter: 1, secondsLeftInHalf: 1500, secondsLeftInGame: 3300, scoreDiff: 14 } as unknown as CoachView;
    const label = (v: CoachView, d: string): string | null => labelOf(v as unknown as Record<string, number>, dims[d] as never, d);
    const hu = tempoModeView(view, "hurryUp", data.tempoModes);
    expect([label(hu, "time5"), label(hu, "final"), label(hu, "score3")]).toEqual(["GF", "c120", "T"]);
    const rc = tempoModeView(view, "runClock", data.tempoModes);
    expect([label(rc, "time5"), label(rc, "final"), label(rc, "score3")]).toEqual(["G5", "-", "L"]);
    expect(hu.quarter).toBe(4);
    expect(rc.quarter).toBe(4);
  });

  it("the cells are read from data/game/tempo-modes.json: swapping the file's modes swaps the games", () => {
    expect(data.tempoModes.modes).toEqual(modesFile.modes);
    const swapped = { ...modesFile, modes: { hurryUp: modesFile.modes["runClock"], runClock: modesFile.modes["hurryUp"] } };
    const kit2 = prepareGame(loadGameData({ override: { "data/game/tempo-modes.json": swapped } }));
    const coach2 = averageCoachFor(kit2.data);
    for (const seed of [8, 9]) {
      const a = sessionRecord(playSession(setupFor(seed), kit, "away", withTempo(seed, "runClock")).session, setupFor(seed), kit);
      const s2 = setupGame(teams, LEAGUE_SEED, seed, () => coach2);
      const b = sessionRecord(playSession(s2, kit2, "away", withTempo(seed, "hurryUp")).session, s2, kit2);
      expect(b.events).toEqual(a.events);
      const c = sessionRecord(playSession(s2, kit2, "away", withTempo(seed, "runClock")).session, s2, kit2);
      expect(c.events).not.toEqual(a.events);
    }
  });

  it("mean run-off: Hurry-up below Normal and Run the clock above it in every time5 bucket", () => {
    const log = new Map<string, { view: CoachView; drawn: number }>();
    for (const { seed, setup } of sliceGames(40)) playGame({ ...setup, home: { ...setup.home, coach: spyCoach(log) }, away: { ...setup.away, coach: spyCoach(log) } }, kit, Rng.fromSeed(seed));
    const mean = (w: readonly number[]): number => w.reduce((a, x, i) => a + x * i, 0) / w.reduce((a, x) => a + x, 0);
    const by = new Map<string, { n: number; hurry: number; normal: number; run: number }>();
    for (const { view } of log.values()) {
      if (!view.clockRunning || view.beforeTimeout) continue;
      const b = labelOf(view as unknown as Record<string, number>, data.config.dimensions["time5"] as never, "time5") as string;
      const o = by.get(b) ?? { n: 0, hurry: 0, normal: 0, run: 0 };
      o.n++;
      o.normal += mean(tempoShares(view, data.tables, data.config.dimensions).value);
      o.hurry += mean(tempoShares(tempoModeView(view, "hurryUp", data.tempoModes), data.tables, data.config.dimensions).value);
      o.run += mean(tempoShares(tempoModeView(view, "runClock", data.tempoModes), data.tables, data.config.dimensions).value);
      by.set(b, o);
    }
    expect([...by.keys()].sort()).toEqual(["G5", "GF", "H1", "H1F", "H2"]);
    for (const [b, o] of by) {
      expect(o.hurry / o.n, `${b} hurry-up vs normal`).toBeLessThan(o.normal / o.n);
      expect(o.run / o.n, `${b} run the clock vs normal`).toBeGreaterThan(o.normal / o.n);
    }
  });

  it("in games, the human's Hurry-up runs less clock than Normal, and Run the clock more", () => {
    const avg = (tempo: "hurryUp" | "normal" | "runClock"): number => {
      const xs = [11, 12, 14, 15].flatMap((seed) => humanRunoffs(sessionRecord(playSession(setupFor(seed), kit, "home", withTempo(seed, tempo)).session, setupFor(seed), kit), "home").map((e) => e.seconds));
      return xs.reduce((a, x) => a + x, 0) / xs.length;
    };
    const [h, n, r] = [avg("hurryUp"), avg("normal"), avg("runClock")];
    expect(h).toBeLessThan(n);
    expect(r).toBeGreaterThan(n);
  });

  it("tempo holds through a drive and resets to Normal at each new drive", () => {
    let firsts = 0;
    let carried = 0;
    for (const seed of [21, 22, 23, 24]) {
      const human: Team = "away";
      const base = scriptedBot(seed, { clock: 0 });
      // Hurry-up at the first call of every drive, then plain calls.
      const bot: Bot = (r) => (r.kind === "offenseCall" && r.tempo === "normal" ? ["clock", "hurryUp"] : base(r));
      const { asked } = playSession(setupFor(seed), kit, human, bot);
      let newDrive = true;
      for (const a of asked) {
        const r = a.request;
        const st = r.state;
        if (st !== null && (st.phase !== "scrimmage" || st.possession !== human)) newDrive = true;
        if (r.kind !== "offenseCall") continue;
        if (newDrive) {
          expect(r.tempo, `seq ${r.seq}`).toBe("normal");
          firsts++;
          newDrive = false;
        } else if (a.before.inputs.length > 0) {
          const prev = asked[asked.indexOf(a) - 1];
          if (prev?.request.kind === "offenseCall") {
            expect(r.tempo, `seq ${r.seq}`).toBe("hurryUp");
            carried++;
          }
        }
      }
    }
    expect(firsts).toBeGreaterThan(20);
    expect(carried).toBeGreaterThan(50);
  });
});

void averageCoach;
