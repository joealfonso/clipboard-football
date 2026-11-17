// Spec tests for chunk 3 of the "Prime Time" revision in DESIGN.md (art-director, 2026-11-15), written
// by test-writer from DESIGN.md, not the implementation. "Build order (Prime Time)" item 3: the
// banner, the five banner moments, the first-down and big-play chips, the quarter-end line score,
// the two-minute bug change, the `moments` block in data/ui/motion.json and the hold rule. Every
// expected value is typed in from DESIGN.md (Motion: Moments, banner anatomy and the moments table;
// Motion (UI) tokens; Typography).
//
// Event-driven checks use seeded games through the real worker Session (the scripted human of
// support.ts) and the box score the worker sends: what each committed play fires is derived here
// from the play's own fields, independently of the app. Drawing is checked on a small recording
// canvas; the hold rule on the real Animator with a hand-stepped requestAnimationFrame and fake
// timers.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { acceptedFoul, playStands } from "@clipboard-football/sim";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FromWorker } from "../src/engine/protocol";
import { Session } from "../src/engine/session";
import type { GameEvent, PlayEvent, Team } from "../src/engine/types";
import { Animator, type PlayOpts } from "../src/ui/animator";
import { drawFrame, viewOf, type FieldScene, type FrameOpts, type SideInk } from "../src/ui/field";
import { cameraAt, layoutFor, playStage } from "../src/ui/layout";
import { bannerBox, bannerPose, lineScore, playMoment, type Moment, type MomentCtx } from "../src/ui/moments";
import { MotionError, parseMotion, parseTemplates } from "../src/ui/templates";
import { resultLine, yardLineText, type TextCtx } from "../src/ui/text";
import { timeline, type Timeline } from "../src/ui/timeline";
import { COLOR, DUR } from "../src/ui/tokens";
import * as tokens from "../src/ui/tokens";
import { COMPLETE, RUN, TOUCHDOWN } from "./fixtures";
import { prepared, scriptedAnswer } from "./support";

const root = join(import.meta.dirname, "../../..");
const appDir = join(import.meta.dirname, "..");
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));
const motionJson = readJson("data/ui/motion.json") as Record<string, unknown>;
const templates = parseTemplates(readJson("data/ui/templates.json"));
const motion = parseMotion(motionJson);
const personnel = readJson("data/engine/personnel.json") as { presetPackage: Record<string, string> };
const css = readFileSync(join(appDir, "src/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const appSource = readFileSync(join(appDir, "src/ui/app.ts"), "utf8");

const rootVars: Record<string, string> = {};
for (const m of css.matchAll(/:root\s*\{([^}]*)\}/g))
  for (const d of (m[1] as string).split(";")) {
    const k = d.indexOf(":");
    if (k > 0 && d.slice(0, k).trim().startsWith("--")) rootVars[d.slice(0, k).trim()] = d.slice(k + 1).trim();
  }
const kebab = (k: string): string => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const norm = (s: string | undefined): string => (s ?? "").toLowerCase().replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").replace(/(\d*\.\d+|\d+)/g, (n) => String(Number(n))).trim();
function rgba(s: string): [number, number, number, number] {
  const t = s.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(t);
  if (hex) {
    const n = hex[1] as string;
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16), 1];
  }
  const m = /^rgba?\(([^)]*)\)$/i.exec(t);
  if (!m) throw new Error(`not a color: ${s}`);
  const p = (m[1] as string).split(",").map((x) => Number(x.trim()));
  return [p[0] as number, p[1] as number, p[2] as number, p[3] ?? 1];
}
const same = (a: unknown, b: string): boolean => typeof a === "string" && /^(#|rgb)/i.test(a) && JSON.stringify(rgba(a)) === JSON.stringify(rgba(b));

/** cubic-bezier(x1, y1, x2, y2) at linear progress f, written for this file. */
function bezier(x1: number, y1: number, x2: number, y2: number, f: number): number {
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  const c = (a: number, b: number, u: number): number => 3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (c(x1, x2, mid) < f) lo = mid;
    else hi = mid;
  }
  return c(y1, y2, (lo + hi) / 2);
}
const OUT = [0, 0, 0.2, 1] as const;
const SLAM = [0.05, 0.7, 0.1, 1] as const;
const EXIT = [0.4, 0, 1, 1] as const;

// ================================================================ Tokens

describe("Tokens: the moment timings and colors, in tokens.ts and mirrored in styles.css :root", () => {
  it("dur.wipe 220 ms (and dur.snap 320, dur.tick 360) beside the unchanged durations", () => {
    expect(DUR).toMatchObject({ fast: 120, base: 180, slow: 260, screen: 240, tick: 360, snap: 320, wipe: 220 });
  });

  it.each(Object.keys(DUR))("dur.%s is mirrored as --dur-* in :root", (k) => {
    expect(norm(rootVars[`--dur-${kebab(k)}`])).toBe(`${(DUR as Record<string, number>)[k]}ms`);
  });

  it("ease.slam cubic-bezier(0.05, 0.7, 0.1, 1) and ease.exit cubic-bezier(0.4, 0, 1, 1) in :root, no overshoot", () => {
    expect(norm(rootVars["--ease-slam"])).toBe("cubic-bezier(0.05, 0.7, 0.1, 1)");
    expect(norm(rootVars["--ease-exit"])).toBe("cubic-bezier(0.4, 0, 1, 1)");
    for (const k of Object.keys(rootVars).filter((x) => x.startsWith("--ease-"))) {
      const m = /cubic-bezier\(([^)]*)\)/.exec(rootVars[k] ?? "");
      for (const n of (m?.[1] ?? "").split(",").map(Number)) expect(n >= 0 && n <= 1, `${k} ${n}`).toBe(true);
    }
  });

  it("if tokens.ts carries the easing curves, they are the same control points as :root", () => {
    const E = (tokens as unknown as Record<string, unknown>)["EASE"] as Record<string, readonly number[]> | undefined;
    if (E === undefined) return;
    for (const [k, pts] of Object.entries(E)) expect(norm(rootVars[`--ease-${kebab(k)}`]), k).toBe(norm(`cubic-bezier(${pts.join(", ")})`));
  });

  it("color.bannerStrip is color.surfaceSolid #12223F at 0.96, mirrored as --banner-strip", () => {
    const C = COLOR as unknown as Record<string, string>;
    expect(rgba(C["bannerStrip"] ?? "")).toEqual([18, 34, 63, 0.96]);
    expect(rgba(rootVars["--banner-strip"] ?? "")).toEqual([18, 34, 63, 0.96]);
  });

  it("every COLOR token is mirrored in :root with the same value", () => {
    for (const [k, v] of Object.entries(COLOR as Record<string, string>)) expect(rgba(rootVars[`--${kebab(k)}`] ?? "#000000"), k).toEqual(rgba(v));
  });
});

// ================================================================ motion.json moments

describe("data/ui/motion.json `moments`: the designed defaults, and bad values rejected", () => {
  it("minimum holds at 1x: touchdown 1800, field goal 1400, safety 1400, two-point 1200, turnover 1400, big play 900; big play at 20 yards; the first-down flash 900", () => {
    const m = motion.moments;
    expect([m.touchdown.minHoldMs, m.fieldGoal.minHoldMs, m.safety.minHoldMs, m.twoPoint.minHoldMs, m.turnover.minHoldMs, m.bigPlay.minHoldMs]).toEqual([1800, 1400, 1400, 1200, 1400, 900]);
    expect(m.bigPlay.minYards).toBe(20);
    expect(m.firstDown.flashMs).toBe(900);
    // The flash in data matches the CSS mirror.
    expect(norm(rootVars["--first-down-flash"])).toBe(`${m.firstDown.flashMs}ms`);
  });

  const withMoments = (moments: unknown): unknown => ({ ...structuredClone(motionJson), moments });
  const good = (): Record<string, Record<string, unknown>> => structuredClone(motionJson["moments"]) as Record<string, Record<string, unknown>>;

  it.each([
    ["no moments block", undefined],
    ["moments not an object", 7],
    ["a missing moment", (() => {
      const g = good();
      delete g["safety"];
      return g;
    })()],
    ["a negative hold", (() => {
      const g = good();
      (g["touchdown"] as Record<string, unknown>)["minHoldMs"] = -1;
      return g;
    })()],
    ["a hold as a string", (() => {
      const g = good();
      (g["turnover"] as Record<string, unknown>)["minHoldMs"] = "1400";
      return g;
    })()],
    ["no big-play yards", (() => {
      const g = good();
      delete (g["bigPlay"] as Record<string, unknown>)["minYards"];
      return g;
    })()],
    ["no first-down flash", (() => {
      const g = good();
      delete g["firstDown"];
      return g;
    })()],
  ])("rejected with a MotionError: %s", (_n, moments) => {
    expect(() => parseMotion(withMoments(moments))).toThrow(MotionError);
  });

  it("the shipped file parses", () => {
    expect(() => parseMotion(withMoments(good()))).not.toThrow();
  });
});

// ================================================================ Seeded games: which moment fires

const NICK: Record<Team, string> = { home: "Outriders", away: "Cranes" };
const SCRIMMAGE = new Set(["run", "pass", "sack", "scramble", "kneel", "spike"]);
const rules = prepared().data.engine.rules;
const ctxFor = (human: Team): MomentCtx => ({ teams: { home: { nickname: NICK.home }, away: { nickname: NICK.away } }, human, endZoneYards: rules.field.endZoneYards, penalties: rules.penalties as MomentCtx["penalties"], moments: motion.moments });
const textCtx = (human: Team): TextCtx => ({ human, teams: { home: { name: `Sundown ${NICK.home}`, nickname: NICK.home }, away: { name: `Glass Lake ${NICK.away}`, nickname: NICK.away } }, players: new Map(), labels: {}, regulationPeriods: rules.game.regulationPeriods, endZoneYards: rules.field.endZoneYards });

interface Game {
  readonly seed: number;
  readonly human: Team;
  readonly events: GameEvent[];
  readonly byPeriod: Record<Team, number[]>;
}
function play(seed: number, human: Team): Game {
  const sent: FromWorker[] = [];
  const session = new Session(prepared(), (m) => sent.push(structuredClone(m)));
  session.handle({ t: "newGame", leagueSeed: 2026, seed, human });
  const events: GameEvent[] = [];
  for (let guard = 0; guard < 5000; guard++) {
    const last = sent[sent.length - 1];
    if (last === undefined || last.t !== "step") throw new Error("no step");
    events.push(...last.events);
    if (last.request === null) break;
    session.handle({ t: "answer", answer: scriptedAnswer(last.request, seed) });
  }
  session.handle({ t: "box" });
  const box = [...sent].reverse().find((m) => m.t === "box");
  if (box?.t !== "box") throw new Error("no box");
  return { seed, human, events, byPeriod: { home: [...box.box.home.byPeriod], away: [...box.box.away.byPeriod] } };
}

/** The moment DESIGN.md's table says this committed play fires, derived from the play's own fields. */
interface Expect {
  readonly word: string | null;
  readonly team: Team | null;
}
function expected(ev: PlayEvent): Expect {
  const { before, after, play: p } = ev;
  const off = before.possession;
  const def: Team = off === "home" ? "away" : "home";
  const gained = (t: Team): number => after.score[t] - before.score[t];
  // Touchdown: six points for either team (a pick six or a fumble return included), from any play but a try.
  if (before.phase !== "try") {
    if (gained(off) >= 6) return { word: "TOUCHDOWN", team: off };
    if (gained(def) >= 6) return { word: "TOUCHDOWN", team: def };
    // Safety: two points to the defense from a scrimmage down.
    if (before.phase === "scrimmage" && gained(def) === 2) return { word: "SAFETY", team: def };
  }
  // Turnover: a scrimmage down after which the other team has the ball.
  if (before.phase === "scrimmage" && SCRIMMAGE.has(p.kind) && after.possession !== off && (after.phase === "scrimmage" || after.phase === "try")) {
    const kind = "turnover" in p ? p.turnover : undefined;
    const lost = "end" in p && p.end !== undefined && p.end.possession === "defense";
    if (kind === "interception") return { word: "INTERCEPTION", team: after.possession };
    if (kind === "fumble") return { word: "FUMBLE", team: after.possession };
    if (!lost && before.down === 4) return { word: "TURNOVER ON DOWNS", team: after.possession };
    return { word: "TURNOVER", team: after.possession };
  }
  if (p.kind === "fieldGoal" && gained(off) === 3) return { word: "FIELD GOAL", team: off };
  if (before.phase === "try" && p.kind === "twoPoint" && gained(off) === 2) return { word: "TWO-POINT GOOD", team: off };
  return { word: null, team: null };
}
const isKick = (ev: PlayEvent): boolean => ["kickoff", "onsideKick", "punt"].includes(ev.play.kind);

describe("Moments: what each committed play fires, over seeded games through the worker", { timeout: 120000 }, () => {
  const games = ([[41, "home"], [42, "away"], [43, "home"], [44, "away"], [45, "home"], [46, "away"]] as const).map(([s, h]) => play(s, h));
  const plays = games.flatMap((g) => g.events.filter((e): e is PlayEvent => e.t === "play").map((ev) => ({ g, ev, m: playMoment(ev, ctxFor(g.human)), want: expected(ev) })));
  const count = (w: string): number => plays.filter((p) => p.want.word === w).length;

  it("precondition: the games have touchdowns, field goals, interceptions or fumbles, first downs and big plays", () => {
    expect(count("TOUCHDOWN")).toBeGreaterThan(10);
    expect(count("FIELD GOAL")).toBeGreaterThan(3);
    expect(count("INTERCEPTION") + count("FUMBLE") + count("TURNOVER ON DOWNS") + count("TURNOVER")).toBeGreaterThan(3);
  });

  it("every touchdown (a pick six or a return included) gets a TOUCHDOWN banner in the scorer's color; every field goal made, FIELD GOAL; every safety, SAFETY; every two-point try made, TWO-POINT GOOD", () => {
    for (const { g, ev, m, want } of plays) {
      if (want.word === null || !["TOUCHDOWN", "FIELD GOAL", "SAFETY", "TWO-POINT GOOD"].includes(want.word)) continue;
      expect(m.banner?.word, `seed ${g.seed} ${ev.play.kind} p${ev.before.period} ${ev.before.clock}`).toBe(want.word);
      expect(m.banner?.team).toBe(want.team);
    }
  });

  it("a scrimmage down that hands the other team the ball gets the turnover banner: INTERCEPTION, FUMBLE or TURNOVER ON DOWNS when the result names it, else TURNOVER, in the color of the team that gains it", () => {
    let n = 0;
    for (const { g, ev, m, want } of plays) {
      if (want.word === null || !want.word.startsWith("INTERCEPTION") && !want.word.startsWith("FUMBLE") && !want.word.startsWith("TURNOVER")) continue;
      expect(m.banner?.word, `seed ${g.seed} ${ev.play.kind} ${ev.before.down}&${ev.before.distance}`).toBe(want.word);
      expect(m.banner?.team).toBe(want.team);
      n++;
    }
    expect(n).toBeGreaterThan(3);
  });

  it("no banner on any other scrimmage play, try or kick that scores nothing and keeps the ball (a missed field goal, a good or missed extra point, a punt, a kickoff)", () => {
    const offenders: string[] = [];
    for (const { g, ev, m, want } of plays) {
      if (want.word !== null) continue;
      // A kick's change of possession (a muff recovered) is left to the spec ambiguity in the report.
      if (isKick(ev) && ev.after.possession === ev.before.possession) continue;
      if (m.banner !== null && !isKick(ev)) offenders.push(`seed ${g.seed} ${ev.play.kind}: ${m.banner.word}`);
      if (m.banner !== null && isKick(ev) && ev.after.score.home === ev.before.score.home && ev.after.score.away === ev.before.score.away) {
        // A punt or kickoff that ends with the receivers' ball is normal, not a turnover.
        if (ev.play.kind !== "punt" || ("end" in ev.play && ev.play.end?.possession === "defense")) offenders.push(`seed ${g.seed} ${ev.play.kind}: ${m.banner.word}`);
      }
    }
    expect(offenders).toEqual([]);
    // Missed kicks and extra points: never a banner.
    for (const { ev, m } of plays) if ((ev.play.kind === "fieldGoal" && ev.after.score[ev.before.possession] === ev.before.score[ev.before.possession]) || ev.play.kind === "extraPoint") expect(m.banner).toBeNull();
  });

  it("sub lines: the score with the scoring team first; a field goal's 'N yds.' first, the same yards the result line gives; a turnover's 'Cranes ball at OPP 41'", () => {
    for (const { g, ev, m } of plays) {
      const b = m.banner;
      if (b === null) continue;
      const o: Team = b.team === "home" ? "away" : "home";
      const score = `${NICK[b.team]} ${ev.after.score[b.team]}, ${NICK[o]} ${ev.after.score[o]}`;
      if (["TOUCHDOWN", "SAFETY", "TWO-POINT GOOD"].includes(b.word)) expect(b.sub, `seed ${g.seed}`).toBe(score);
      if (b.word === "FIELD GOAL") {
        const mm = /^(\d+) yds\. (.*)$/.exec(b.sub);
        expect(mm, b.sub).not.toBeNull();
        expect(mm?.[2]).toBe(score);
        // A moment never says anything the result line does not.
        expect(resultLine(ev, textCtx(g.human))).toContain(mm?.[1] ?? "x");
      }
      if (["INTERCEPTION", "FUMBLE", "TURNOVER ON DOWNS", "TURNOVER"].includes(b.word) && ev.after.phase === "scrimmage") expect(b.sub).toBe(`${NICK[ev.after.possession]} ball at ${yardLineText(ev.after.spot, ev.after.possession, g.human)}`);
    }
  });

  it("one banner per play, and a banner suppresses both chips", () => {
    for (const { m } of plays) if (m.banner !== null) expect([m.firstDown, m.bigPlay]).toEqual([false, null]);
  });

  it("the moment's minimum hold is the data's for its banner kind, the big play's for a big play, else 0", () => {
    const hold: Record<string, number> = { TOUCHDOWN: 1800, "FIELD GOAL": 1400, SAFETY: 1400, "TWO-POINT GOOD": 1200, INTERCEPTION: 1400, FUMBLE: 1400, "TURNOVER ON DOWNS": 1400, TURNOVER: 1400 };
    for (const { m } of plays) {
      if (m.banner !== null) expect(m.minHoldMs).toBe(hold[m.banner.word]);
      else expect(m.minHoldMs).toBe(m.bigPlay === null ? 0 : 900);
    }
  });

  // Big play: "a gain from scrimmage at or over moments.bigPlay.minYards (designed, default 20) that did not score".
  it("big play: every clean scrimmage gain of 20 yards or more that did not score, and nothing under 20", () => {
    let big = 0;
    for (const { ev, m } of plays) {
      const p = ev.play;
      if (ev.before.phase !== "scrimmage" || !SCRIMMAGE.has(p.kind) || acceptedFoul(ev, rules) !== null || !("end" in p) || p.end === undefined) continue;
      if (m.banner !== null) continue;
      const kept = p.end.possession === "offense";
      const gain = kept && !("incomplete" in p && p.incomplete === true) ? Math.min(100, p.end.spot) - ev.before.spot : 0;
      if (gain >= 20) {
        expect(m.bigPlay, `${p.kind} ${gain}`).toBe(gain);
        big++;
      } else expect(m.bigPlay, `${p.kind} ${gain}`).toBeNull();
    }
    expect(big, "precondition: big plays happen").toBeGreaterThan(3);
  });

  // First down: "a new first down for the same team, not a score, not by penalty alone".
  it("first down: a clean scrimmage play that reaches the line to gain with the same team on 1st down after; never a kick", () => {
    let fd = 0;
    for (const { ev, m } of plays) {
      const p = ev.play;
      if (isKick(ev) || p.kind === "fieldGoal") {
        expect(m.firstDown).toBe(false);
        continue;
      }
      if (ev.before.phase !== "scrimmage" || !SCRIMMAGE.has(p.kind) || acceptedFoul(ev, rules) !== null || !playStands(ev, rules) || m.banner !== null) continue;
      const reached = "end" in p && p.end !== undefined && !("incomplete" in p && p.incomplete === true) && p.end.possession === "offense" && p.end.spot >= ev.before.spot + ev.before.distance;
      const want = reached && ev.after.phase === "scrimmage" && ev.after.possession === ev.before.possession && ev.after.down === 1;
      expect(m.firstDown, `${p.kind} ${ev.before.down}&${ev.before.distance} at ${ev.before.spot}`).toBe(want);
      if (want) fd++;
    }
    expect(fd).toBeGreaterThan(50);
  });

  it("quarter-end line score: points by quarter match the box score's (the worker), and each row sums to the final score", () => {
    for (const g of games) {
      const ls = lineScore(g.events, rules.game.regulationPeriods);
      for (const t of ["home", "away"] as const) {
        expect(ls[t], `seed ${g.seed} ${t}`).toEqual(g.byPeriod[t].slice(0, rules.game.regulationPeriods).map((n) => n ?? 0));
      }
    }
  });
});

// ================================================================ A built event: the app path for a big play that is also a first down

describe("App path: a stood pass for 21 yards on 2nd & 20 that gains a first down", () => {
  const ev: PlayEvent = {
    ...COMPLETE,
    before: { ...COMPLETE.before, down: 2, distance: 20, spot: 30, goalToGo: false },
    play: { ...COMPLETE.play, end: { spot: 51, possession: "offense" }, detail: { ...(COMPLETE.play.detail ?? {}), yards: 21 } } as PlayEvent["play"],
    penalty: null,
    after: { ...COMPLETE.after, down: 1, distance: 10, spot: 51, goalToGo: false, possession: COMPLETE.before.possession, score: COMPLETE.before.score },
  };
  // The app's own call (app.ts: playMoment with the game's teams, human, rules and motion.json).
  const m = playMoment(ev, ctxFor("home"));

  it("fires a big play of 21 and a first down, no banner, holding at least moments.bigPlay.minHoldMs", () => {
    expect(m.banner).toBeNull();
    expect(m.bigPlay).toBe(21);
    expect(m.firstDown).toBe(true);
    expect(m.minHoldMs).toBeGreaterThanOrEqual(motion.moments.bigPlay.minHoldMs);
  });

  it("the whistle frame draws both chips: '+21' and 'FIRST DOWN'", () => {
    const tl = tlOf(ev);
    const texts = drawn(tl, tl.liveEnd + 600, { moment: m, ink: null, endT: tl.liveEnd + 900, still: false }).ops.filter((o) => o.op === "fillText").map((o) => o.text);
    expect(texts).toContain("+21");
    expect(texts).toContain("FIRST DOWN");
  });

  it("the Animator holds the whistle frame at least moments.bigPlay ms at 1x", async () => {
    const tl = tlOf(ev);
    const done = await runLive(tl, m, "1x");
    expect(done.resolvedAtT).toBeGreaterThanOrEqual(tl.liveEnd + motion.moments.bigPlay.minHoldMs - 1);
    expect(done.resolvedAtT).toBeGreaterThanOrEqual(tl.total - 1);
  });
});

// ================================================================ Drawing: banner, chips

interface Op {
  readonly i: number;
  readonly op: string;
  readonly fillStyle: unknown;
  readonly font: string;
  readonly alpha: number;
  readonly shadowBlur: number;
  readonly x: number;
  readonly y: number;
  readonly text?: string;
  readonly box: { x0: number; y0: number; x1: number; y1: number } | null;
}
function recorder(): { g: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = [];
  const state: Record<string, unknown> = { fillStyle: "#000", strokeStyle: "#000", font: "10px sans-serif", globalAlpha: 1, lineWidth: 1, shadowBlur: 0, letterSpacing: "0px", textAlign: "start", textBaseline: "alphabetic" };
  let tx = 0;
  let ty = 0;
  const stack: { s: Record<string, unknown>; tx: number; ty: number }[] = [];
  let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  const add = (x0: number, y0: number, x1: number, y1: number): void => {
    const b = { x0: Math.min(x0, x1) + tx, y0: Math.min(y0, y1) + ty, x1: Math.max(x0, x1) + tx, y1: Math.max(y0, y1) + ty };
    box = box === null ? b : { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) };
  };
  const log = (op: string, x = 0, y = 0, text?: string): void => {
    ops.push({ i: ops.length, op, fillStyle: state["fillStyle"], font: String(state["font"]), alpha: Number(state["globalAlpha"]), shadowBlur: Number(state["shadowBlur"]), x: x + tx, y: y + ty, ...(text === undefined ? {} : { text }), box });
  };
  const px = (): number => Number(/(\d+(?:\.\d+)?)px/.exec(String(state["font"]))?.[1] ?? 10);
  const methods: Record<string, (...a: never[]) => unknown> = {
    measureText: (s: string) => ({ width: s.length * 0.5 * px() }),
    save: () => void stack.push({ s: { ...state }, tx, ty }),
    restore: () => {
      const s = stack.pop();
      if (s === undefined) return;
      Object.assign(state, s.s);
      tx = s.tx;
      ty = s.ty;
    },
    translate: (x: number, y: number) => {
      tx += x;
      ty += y;
    },
    beginPath: () => {
      box = null;
    },
    rect: (x: number, y: number, w: number, h: number) => add(x, y, x + w, y + h),
    roundRect: (x: number, y: number, w: number, h: number) => add(x, y, x + w, y + h),
    moveTo: (x: number, y: number) => add(x, y, x, y),
    lineTo: (x: number, y: number) => add(x, y, x, y),
    arcTo: (a: number, b: number, c: number, d: number) => add(Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)),
    arc: (x: number, y: number, r: number) => add(x - r, y - r, x + r, y + r),
    ellipse: (x: number, y: number, rx: number, ry: number) => add(x - rx, y - ry, x + rx, y + ry),
    fillText: (s: string, x: number, y: number) => log("fillText", x, y, String(s)),
    fill: () => log("fill"),
    fillRect: (x: number, y: number, w: number, h: number) => {
      box = null;
      add(x, y, x + w, y + h);
      log("fillRect");
    },
    stroke: () => log("stroke"),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    setLineDash: () => undefined,
    getLineDash: () => [],
  };
  const g = new Proxy(state, {
    get: (t, p: string) => (p in methods ? methods[p] : p in t ? t[p] : () => undefined),
    set: (t, p: string, v: unknown) => {
      t[p] = v;
      return true;
    },
    has: (t, p: string) => p in t || p in methods,
  }) as unknown as CanvasRenderingContext2D;
  return { g, ops };
}

const lay = layoutFor(1280, 720, templates.field);
const layout = { ...lay, column: playStage(lay, 1).column };
function tlOf(event: PlayEvent): Timeline {
  return timeline({ event, runoffSeconds: 0, human: null }, templates, { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: lay.s, markPx: lay.markPx, motion });
}
const frameOpts = (tl: Timeline): FrameOpts => ({ numbers: {}, ratings: Object.fromEntries(tl.marks.map((mk) => [mk.playerId, 60])), labelContent: "rating", focused: null, markLabels: "none", routeAlpha: 0.4, textScale: 1 });
/** What the test says about a moment frame: the moment, its banner ink, when its hold ends (timeline ms, at 1x) and whether it shows its end state. */
interface MF {
  readonly moment: Moment;
  readonly ink: SideInk | null;
  readonly endT: number;
  readonly still: boolean;
}
/**
 * At 1x, wall ms after the whistle are timeline ms after it: `bt` is t - liveEnd and the hold is
 * endT - liveEnd. Both the frame's field names are passed (the moment frame's shape is the engineer's).
 */
function drawn(tl: Timeline, t: number, mf: MF, lyt = layout): ReturnType<typeof recorder> & { v: ReturnType<typeof viewOf> } {
  const r = recorder();
  const v = viewOf(lyt, cameraAt(tl.los, lyt.visibleYards, templates.field.losFromTop));
  const moment = { ...mf, bt: t - tl.liveEnd, holdMs: mf.endT - tl.liveEnd } as unknown as NonNullable<FrameOpts["moment"]>;
  drawFrame(r.g, v, tl, t, { ...frameOpts(tl), moment });
  return { ...r, v };
}

const TD_INK: SideInk = { fill: "#C62F2F", ring: "#F5F7F2" };
const tdMoment: Moment = playMoment(TOUCHDOWN, ctxFor("home"));

describe("Banner anatomy: team block, the word in type.momentWord in the outline color, the sub strip in color.bannerStrip; only after the whistle", () => {
  const tl = tlOf(TOUCHDOWN);
  const still = { moment: tdMoment, ink: TD_INK, endT: tl.liveEnd + 1800, still: true };

  it("precondition: the touchdown fixture fires a touchdown banner", () => {
    expect(tdMoment.banner?.word).toBe("TOUCHDOWN");
  });

  it("end state: the word 'TOUCHDOWN', display 700 72 px, in the team's outline color; the sub in ui 600 18 px chalk", () => {
    const r = drawn(tl, tl.total, still);
    const word = r.ops.find((o) => o.op === "fillText" && o.text === "TOUCHDOWN");
    expect(word).toBeDefined();
    expect(word?.font).toMatch(/700 72px/);
    expect(word?.font).toMatch(/Barlow Condensed/);
    expect(same(word?.fillStyle, TD_INK.ring as string)).toBe(true);
    const sub = r.ops.find((o) => o.op === "fillText" && o.text === tdMoment.banner?.sub);
    expect(sub?.font).toMatch(/600 18px/);
    expect(same(sub?.fillStyle, COLOR.chalk)).toBe(true);
  });

  it("the block is the team fill under shadow.toast (12 px), 112 px tall and min(column - 48, 720) wide; the strip under it is color.bannerStrip, 36 px", () => {
    const r = drawn(tl, tl.total, still);
    const block = r.ops.find((o) => o.op === "fill" && same(o.fillStyle, TD_INK.fill) && o.shadowBlur === 12);
    expect(block).toBeDefined();
    const b = block?.box as NonNullable<Op["box"]>;
    expect(b.y1 - b.y0).toBeCloseTo(112, 0);
    expect(b.x1 - b.x0).toBeCloseTo(Math.min(r.v.columnWidth - 48, 720), 0);
    // Centered on the column.
    expect((b.x0 + b.x1) / 2).toBeCloseTo(r.v.ox + r.v.columnWidth / 2, 0);
    const strip = r.ops.find((o) => o.op === "fill" && same(o.fillStyle, COLOR.bannerStrip));
    const s = strip?.box as NonNullable<Op["box"]>;
    expect(s.y1 - s.y0).toBeCloseTo(36, 0);
    expect(s.y0).toBeCloseTo(b.y1, 0);
  });

  it("a column under 600 px: an 88 px block and a 56 px word, never under 48 px for a long word", () => {
    const small = layoutFor(800, 536, templates.field);
    const sl = { ...small, column: playStage(small, 1).column };
    expect(sl.column.width).toBeLessThan(600);
    const r = drawn(tl, tl.total, still, sl);
    expect(r.ops.find((o) => o.op === "fillText" && o.text === "TOUCHDOWN")?.font).toMatch(/700 56px/);
    const b = r.ops.find((o) => o.op === "fill" && same(o.fillStyle, TD_INK.fill) && o.shadowBlur === 12)?.box as NonNullable<Op["box"]>;
    expect(b.y1 - b.y0).toBeCloseTo(88, 0);
    const tod: Moment = { ...tdMoment, banner: { kind: "turnover", team: "away", word: "TURNOVER ON DOWNS", sub: "Cranes ball at OWN 40" } };
    const w = drawn(tl, tl.total, { ...still, moment: tod }, sl).ops.find((o) => o.op === "fillText" && o.text === "TURNOVER ON DOWNS");
    expect(Number(/(\d+)px/.exec(w?.font ?? "")?.[1])).toBeGreaterThanOrEqual(48);
  });

  it("nothing before the whistle; no chips with a banner even when the moment also carries them", () => {
    const pre = drawn(tl, tl.liveEnd - 1, still);
    expect(pre.ops.some((o) => o.text === "TOUCHDOWN")).toBe(false);
    const both: Moment = { ...tdMoment, firstDown: true, bigPlay: 34 };
    const r = drawn(tl, tl.total, { ...still, moment: both });
    expect(r.ops.some((o) => o.text === "FIRST DOWN" || /^\+\d+$/.test(o.text ?? ""))).toBe(false);
  });

  it("the score words a banner says are not drawn again as a field tag", () => {
    const r = drawn(tl, tl.total, still);
    const tags = r.ops.filter((o) => o.op === "fillText" && /touchdown/i.test(o.text ?? "") && o.text !== "TOUCHDOWN");
    expect(tags).toEqual([]);
  });
});

describe("Banner placement: centered on the column, at 30% of its height with the ball in the lower half, 70% otherwise; never over the ball", () => {
  const col = { left: 100, width: 700 };
  it.each([
    [600, 500, 0.3],
    [600, 100, 0.7],
    [900, 450, 0.3],
    [900, 449, 0.7],
  ])("view %i px tall, ball at y %i: center at %d of the height", (h, ballY, share) => {
    const b = bannerBox(col, h, ballY);
    expect(b.y + (b.blockH + b.stripH) / 2).toBeCloseTo(share * h, 6);
    expect(b.w).toBe(Math.min(700 - 48, 720));
    expect(b.x + b.w / 2).toBeCloseTo(col.left + col.width / 2, 6);
    expect([b.blockH, b.stripH]).toEqual([112, 36]);
  });

  it("over every ball spot in a 600 px view, the banner never covers the ball's row (nor within a mark of it)", () => {
    for (let y = 0; y <= 600; y += 3) {
      const b = bannerBox(col, 600, y);
      const top = b.y - 8;
      const bottom = b.y + b.blockH + b.stripH;
      expect(y < top - 10 || y > bottom + 10, `ball at ${y}: banner ${top} to ${bottom}`).toBe(true);
    }
  });

  it("width is capped at 720 on a wide column", () => {
    expect(bannerBox({ left: 0, width: 1200 }, 800, 100).w).toBe(720);
  });
});

describe("Banner timing: in from the left over dur.wipe (ease.out), the word slams at 120 ms for 200 ms (ease.slam, 1.15 to 1), the sub drops from 8 px above at 320 ms over dur.base (ease.out); out to the right over the hold's last dur.wipe (ease.exit)", () => {
  const hold = 1800;
  it("the wipe in: the visible right edge follows ease.out over 220 ms, from the left edge", () => {
    for (const bt of [0, 55, 110, 165, 220, 400]) {
      const p = bannerPose(bt, hold);
      expect(p.left).toBe(0);
      expect(p.right).toBeCloseTo(bezier(...OUT, bt / 220), 3);
    }
  });

  it("the word: invisible until 120 ms, then opacity by ease.slam over 200 ms and scale from 1.15 to 1.0, never below 1 (no overshoot)", () => {
    for (const bt of [0, 119, 120, 170, 220, 270, 320, 600]) {
      const p = bannerPose(bt, hold);
      const f = bezier(...SLAM, (bt - 120) / 200);
      expect(p.wordAlpha, `${bt}`).toBeCloseTo(f, 3);
      expect(p.wordScale, `${bt}`).toBeCloseTo(1.15 - 0.15 * f, 3);
      expect(p.wordScale).toBeGreaterThanOrEqual(1);
    }
  });

  it("the sub strip: hidden until 320 ms, then fades in by ease.out over 180 ms, dropping from 8 px above to its place", () => {
    for (const bt of [0, 319, 320, 410, 500, 700]) {
      const p = bannerPose(bt, hold);
      const f = bezier(...OUT, (bt - 320) / 180);
      expect(p.subAlpha, `${bt}`).toBeCloseTo(f, 3);
      expect(p.subLift, `${bt}`).toBeCloseTo(8 * (1 - f), 3);
    }
  });

  it("out: in the hold's last 220 ms the left edge moves right by ease.exit; gone at the end of the hold", () => {
    expect(bannerPose(hold - 221, hold).left).toBe(0);
    for (const bt of [hold - 165, hold - 110, hold - 55]) expect(bannerPose(bt, hold).left).toBeCloseTo(bezier(...EXIT, (bt - (hold - 220)) / 220), 3);
    expect(bannerPose(hold, hold).left).toBeCloseTo(1, 6);
  });
});

describe("Chips: FIRST DOWN in ink on a signal pill with an outlineDark edge; the big-play count from +0 to the gain over 500 ms ease.out, beside the ball", () => {
  const tl = tlOf(RUN);
  const big: Moment = { banner: null, firstDown: false, bigPlay: 34, minHoldMs: 900 };
  const text = (bt: number): string | undefined => drawn(tl, tl.liveEnd + bt, { moment: big, ink: null, endT: tl.liveEnd + 900, still: false }).ops.find((o) => o.op === "fillText" && /^\+\d+$/.test(o.text ?? ""))?.text;

  it.each([0, 100, 250, 400, 500, 800])("at %i ms after the whistle the chip reads +round(34 * ease.out(t / 500))", (bt) => {
    expect(text(bt)).toBe(`+${Math.round(34 * bezier(...OUT, bt / 500))}`);
  });

  it("the big-play chip is a color.tag pill with chalk text in type.chip (display 700 24 px)", () => {
    const r = drawn(tl, tl.liveEnd + 600, { moment: big, ink: null, endT: tl.liveEnd + 900, still: false });
    const t = r.ops.find((o) => o.text === "+34");
    expect(same(t?.fillStyle, COLOR.chalk)).toBe(true);
    expect(t?.font).toMatch(/700 24px/);
    expect(r.ops.some((o) => o.op === "fill" && same(o.fillStyle, COLOR.tag))).toBe(true);
  });

  it("the FIRST DOWN chip: ink text on a signal pill, display 700 24 px; only after the whistle", () => {
    const fd: Moment = { banner: null, firstDown: true, bigPlay: null, minHoldMs: 0 };
    const r = drawn(tl, tl.liveEnd + 400, { moment: fd, ink: null, endT: tl.total, still: false });
    const t = r.ops.find((o) => o.text === "FIRST DOWN");
    expect(same(t?.fillStyle, COLOR.ink)).toBe(true);
    expect(t?.font).toMatch(/700 24px/);
    expect(r.ops.some((o) => o.op === "fill" && same(o.fillStyle, COLOR.signal))).toBe(true);
    expect(drawn(tl, tl.liveEnd - 1, { moment: fd, ink: null, endT: tl.total, still: false }).ops.some((o) => o.text === "FIRST DOWN")).toBe(false);
  });

  it("the chip sits 8 px beside the ball's final spot (right of it, or left if it would leave the column)", () => {
    const r = drawn(tl, tl.liveEnd + 600, { moment: big, ink: null, endT: tl.liveEnd + 900, still: false });
    const pill = r.ops.find((o) => o.op === "fill" && same(o.fillStyle, COLOR.tag) && o.box !== null && o.box.y1 - o.box.y0 > 30);
    expect(pill).toBeDefined();
    const ball = r.ops.filter((o) => o.op === "fill" && same(o.fillStyle, COLOR.ball)).at(-1);
    const bb = ball?.box as NonNullable<Op["box"]>;
    const pb = pill?.box as NonNullable<Op["box"]>;
    const bx = (bb.x0 + bb.x1) / 2;
    // "8 px right of the ball's final spot": from the ball itself or from the mark around it.
    const gapRight = pb.x0 - bx;
    const gapLeft = bx - pb.x1;
    const gap = gapRight > 0 ? gapRight : gapLeft;
    expect(gap).toBeGreaterThanOrEqual(8 - 0.5);
    expect(gap).toBeLessThanOrEqual(8 + r.v.markPx / 2 + 0.5);
  });
});

// ================================================================ The hold rule on the Animator

const G = globalThis as unknown as Record<string, unknown>;
const saved = { window: G["window"], document: G["document"], raf: G["requestAnimationFrame"], caf: G["cancelAnimationFrame"] };
let rafQ: ((now: number) => void)[] = [];
beforeAll(() => {
  G["window"] = { devicePixelRatio: 1 };
  G["document"] = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
  G["requestAnimationFrame"] = (cb: (now: number) => void): number => rafQ.push(cb);
  G["cancelAnimationFrame"] = (): void => {
    rafQ = [];
  };
});
afterAll(() => {
  G["window"] = saved.window;
  G["document"] = saved.document;
  G["requestAnimationFrame"] = saved.raf;
  G["cancelAnimationFrame"] = saved.caf;
});
afterEach(() => {
  vi.useRealTimers();
});

function animator(tl: Timeline): Animator {
  const canvas = { width: 0, height: 0, style: {}, getContext: () => recorder().g } as unknown as HTMLCanvasElement;
  return new Animator(canvas, () => layout, () => templates, () => frameOpts(tl));
}
const scene = (tl: Timeline): FieldScene => ({ los: tl.los, firstDown: tl.firstDown, bottomName: "Outriders", topName: "Cranes", endZoneYards: 10 });

/**
 * Plays `tl` in real time on hand-stepped frames of 16 ms wall time; returns the timeline ms at which
 * the play resolved, when onMoment fired, and the frame at which Space was pressed (if asked).
 */
async function runLive(tl: Timeline, m: Moment, speed: "1x" | "2x", spaceAtT?: number): Promise<{ resolvedAtT: number; momentAtT: number | null }> {
  rafQ = [];
  const a = animator(tl);
  const f = speed === "2x" ? 2 : 1;
  let resolved = false;
  let momentAtT: number | null = null;
  let wall = 0;
  const p0 = performance.now();
  const opts: PlayOpts = { speed, reducedMotion: false, onClock: () => undefined, moment: { moment: m, ink: TD_INK }, onMoment: () => (momentAtT ??= wall * f) } as PlayOpts;
  void a.play(tl, scene(tl), opts).then(() => (resolved = true));
  let pressed = false;
  for (let i = 0; i < 20000 && !resolved; i++) {
    const cb = rafQ.shift();
    if (cb === undefined) break;
    wall += 16;
    if (spaceAtT !== undefined && !pressed && wall * f >= spaceAtT) {
      a.skip();
      pressed = true;
    }
    cb(p0 + wall);
    await Promise.resolve();
  }
  await Promise.resolve();
  expect(resolved, "the play resolves").toBe(true);
  return { resolvedAtT: wall * f, momentAtT };
}

describe("The hold: the larger of the play's own hold and the moment's minimum from the whistle; 2x halves it; Space ends it; the bug changes when the sub line appears", () => {
  const tl = tlOf(TOUCHDOWN);
  const want = Math.max(tl.total, tl.liveEnd + 1800);

  it("precondition: the touchdown's moment lengthens this play's hold", () => {
    expect(tl.liveEnd + 1800).toBeGreaterThan(tl.total);
  });

  it("at 1x the play resolves 1800 ms after the whistle, not before", async () => {
    const r = await runLive(tl, tdMoment, "1x");
    expect(r.resolvedAtT).toBeGreaterThanOrEqual(want - 1);
    expect(r.resolvedAtT).toBeLessThanOrEqual(want + 40);
  });

  it("at 2x every figure halves: the same timeline ms in half the wall time", async () => {
    const r = await runLive(tl, tdMoment, "2x");
    expect(r.resolvedAtT).toBeGreaterThanOrEqual(want - 1);
    expect(r.resolvedAtT).toBeLessThanOrEqual(want + 70);
  });

  it("the bug's score changes on the frame the sub line appears: onMoment fires at whistle + 320 ms, not before", async () => {
    const r = await runLive(tl, tdMoment, "1x");
    expect(r.momentAtT).not.toBeNull();
    expect(r.momentAtT as number).toBeGreaterThanOrEqual(tl.liveEnd + 320 - 1);
    expect(r.momentAtT as number).toBeLessThanOrEqual(tl.liveEnd + 320 + 20);
  });

  it("Space during the hold ends it at once", async () => {
    const r = await runLive(tl, tdMoment, "1x", tl.liveEnd + 400);
    expect(r.resolvedAtT).toBeLessThan(tl.liveEnd + 400 + 50);
    expect(r.momentAtT).not.toBeNull();
  });

  it("a play with no moment ends at its own hold", async () => {
    const r = await runLive(tl, { banner: null, firstDown: false, bigPlay: null, minHoldMs: 0 }, "1x");
    expect(r.resolvedAtT).toBeLessThanOrEqual(tl.total + 40);
  });

  /** Jump-to-end modes: when the hold timer resolves the play, ms. */
  async function jumpHold(m: Moment, o: Pick<PlayOpts, "speed" | "reducedMotion">): Promise<{ resolvesAfter: number; momentAtOnce: boolean }> {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    rafQ = [];
    const a = animator(tl);
    let resolved = false;
    let told = false;
    void a.play(tl, scene(tl), { ...o, onClock: () => undefined, moment: { moment: m, ink: TD_INK }, onMoment: () => (told = true) } as PlayOpts).then(() => (resolved = true));
    const momentAtOnce = told;
    let ms = 0;
    for (; ms < 10000 && !resolved; ms += 10) {
      await vi.advanceTimersByTimeAsync(10);
    }
    return { resolvesAfter: ms, momentAtOnce };
  }
  const base = Math.max(tl.holdMs, tl.settleMs, templates.timing.holdMs);

  it("Skip: the end state at once and the banner's minimum hold kept", async () => {
    const r = await jumpHold(tdMoment, { speed: "skip", reducedMotion: false });
    expect(r.momentAtOnce).toBe(true);
    expect(r.resolvesAfter).toBeGreaterThanOrEqual(Math.max(base, 1800));
    expect(r.resolvesAfter).toBeLessThanOrEqual(Math.max(base, 1800) + 10);
  });

  it("Skip keeps the minimum hold only for banners: a big play adds none", async () => {
    const r = await jumpHold({ banner: null, firstDown: false, bigPlay: 34, minHoldMs: 900 }, { speed: "skip", reducedMotion: false });
    expect(r.resolvesAfter).toBeLessThanOrEqual(base + 10);
  });

  it("reduced motion: the end state at once and no hold added for the moment", async () => {
    const r = await jumpHold(tdMoment, { speed: "1x", reducedMotion: true });
    expect(r.momentAtOnce).toBe(true);
    expect(r.resolvesAfter).toBeLessThanOrEqual(base + 10);
  });
});

// ================================================================ The bug: quarter end and the two-minute warning

describe("Quarter end and the two-minute warning (static reads of app.ts and styles.css; no jsdom)", () => {
  it("moment.periodEnd only at the end of the 1st and 3rd quarters (not the half or the game); the bug says 'End 1st'; the next snap clears it", () => {
    const cond = /if \(ev\.t === "endPeriod"[^\n]*\{\s*\n\s*g\.periodEnd = ev\.period;/.exec(appSource)?.[0] ?? "";
    expect(cond).not.toBe("");
    expect(cond).toMatch(/ev\.period < this\.ui\.rules\.game\.regulationPeriods/);
    expect(cond).toMatch(/ev\.period % this\.ui\.rules\.game\.periodsPerHalf !== 0/);
    // For a 4-quarter, 2-per-half game that is periods 1 and 3 only.
    const fires = [1, 2, 3, 4].filter((p) => p < rules.game.regulationPeriods && p % rules.game.periodsPerHalf !== 0);
    expect(fires).toEqual([1, 3]);
    expect(appSource).toMatch(/`End \$\{periodText\(g\.periodEnd, regulation\)\}`/);
    expect(appSource).toMatch(/g\.periodEnd = null;/);
  });

  it("the plate shows the line score in place of the drive tracker while the quarter-end moment holds, wiping in over dur.wipe", () => {
    expect(appSource).toMatch(/g\.periodEnd != null \? this\.lineScorePlate\(g, now, still\) : this\.driveTracker\(g, s, now, still\)/);
    const wipe = /\.line-score-wrap\.wipe-in\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(norm(wipe)).toMatch(/var\(--dur-wipe\) var\(--ease-out\)/);
  });

  it("two-minute warning: the clock turns signal over dur.base and the Under 2:00 tag comes in from 8 px left with a fade", () => {
    const clock = /\.clock\.late\.two-min\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(norm(clock)).toMatch(/var\(--dur-base\)/);
    const kfClock = /@keyframes two-min-clock\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(kfClock).toMatch(/to\s*\{\s*color:\s*var\(--signal\)/);
    const tag = /\.late-tag\.two-min\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(norm(tag)).toMatch(/var\(--dur-base\) var\(--ease-out\)/);
    const kfTag = /@keyframes two-min-tag\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(norm(kfTag)).toMatch(/from \{ opacity: 0; transform: translatex\(-8px\)/);
    // Fired by the warning event.
    expect(appSource).toMatch(/e\.t === "twoMinuteWarning"\)\) this\.flights\.start\("twoMin"/);
  });
});
