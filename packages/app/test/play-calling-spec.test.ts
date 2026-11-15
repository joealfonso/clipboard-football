// Spec checks for docs/specs/m2-play-calling-and-motion.md written by test-writer, filling gaps the
// engineer's tests leave:
// - P3 on what is drawn: the faint set art comes from the calls only, for every player, fact or
//   not (decision 9; Problem 3: the engine's target lost his preview route). The existing P3 test
//   compares `tl.preview`; this one checks the primitives the field draws before the snap.
// - Ratings on marks (Amended): the rating is the card rating, before the home-field shift, and
//   the key rating is the one the position is judged on (the spec's examples: Speed for a WR, Pass
//   Rush for a DL).
// - Player cards (Amended): the play section lists only roles the engine credited, one line per
//   role, and a line names that role (no role is shown under another role's name).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gamePlayers } from "../../sim/src/loop/play";
import { pathPrimitives } from "../src/ui/marks";
import { playLines } from "../src/ui/ratings";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { timeline, type Timeline } from "../src/ui/timeline";
import { matchupOf } from "../src/engine/session";
import type { PlayEvent } from "../src/engine/types";
import { COMPLETE, INCOMPLETE, INTERCEPTION } from "./fixtures";
import { playGame, prepared } from "./support";

const read = (p: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", p), "utf8"));
const templates = parseTemplates(read("data/ui/templates.json"));
const motion = parseMotion(read("data/ui/motion.json"));
const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };
const ctx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion };
const build = (event: PlayEvent, human: "offense" | "defense"): Timeline => timeline({ event, runoffSeconds: 0, human, ownStart: "lined" }, templates, ctx);
// The trim the field uses: a path stops one mark radius plus 1 px short of the mark (field.ts drawFrame).
const EDGE = (ctx.markPx / 2 + 1) / ctx.pxPerYard;

describe("P3 on the drawn layer: the set art is the call's, for every player", () => {
  // Three results of the same call with three different targets (WR2 caught, WR1 incomplete, WR3 picked off).
  const same = { offense: COMPLETE.offense, defense: COMPLETE.defense };
  const results = [COMPLETE, { ...INCOMPLETE, ...same }, { ...INTERCEPTION, ...same }];

  it("the fixtures really differ in who the engine targeted", () => {
    const targets = results.map((e) => ((e.play.detail ?? {}) as { participants?: { target?: string } }).participants?.target);
    expect(new Set(targets).size).toBe(3);
  });

  it("what is drawn before the snap is identical whatever the result", () => {
    const tls = results.map((e) => build(e, "offense"));
    const a = tls[0] as Timeline;
    for (const t of [0, a.setAt, (a.setAt + a.snapAt) / 2, a.snapAt - 1]) {
      const drawn = tls.map((tl) => JSON.stringify(pathPrimitives(tl, t, EDGE)));
      expect(new Set(drawn).size, `t=${t}`).toBe(1);
    }
  });

  it("every offensive player on the field has his preview path drawn, the engine's target and passer included", () => {
    for (const ev of results) {
      const tl = build(ev, "offense");
      const own = tl.marks.filter((m) => m.side === "O");
      expect(own).toHaveLength(11);
      const drawn = new Set(pathPrimitives(tl, tl.snapAt - 1, EDGE).filter((p) => p.side === "O").map((p) => p.slot));
      for (const m of own) expect(drawn.has(m.slot), `${m.slot} (fact: ${String(m.fact)})`).toBe(true);
      // The fact marks are there too: the case the leak was about.
      expect(own.some((m) => m.fact)).toBe(true);
    }
  });

  it("over a real game, every human run or pass call draws a preview path for all 11 of his players", () => {
    const g = playGame(61, "home");
    let n = 0;
    for (const ev of g.events.filter((e): e is PlayEvent => e.t === "play" && e.before.possession === "home" && e.before.phase === "scrimmage" && e.offense.formation !== undefined && e.play.kind !== "noPlay")) {
      const tl = build(ev, "offense");
      const slots = new Set(tl.marks.filter((m) => m.side === "O").map((m) => m.slot));
      const drawn = new Set(pathPrimitives(tl, tl.snapAt - 1, EDGE).filter((p) => p.side === "O").map((p) => p.slot));
      expect([...drawn].sort(), `${ev.offense.formation} ${ev.offense.call}`).toEqual([...slots].sort());
      n++;
    }
    expect(n).toBeGreaterThan(20);
  });
});

describe("ratings on marks are card ratings (Amended: before the home-field shift)", () => {
  it("the key rating is the one the position is judged on (the spec's examples)", () => {
    expect(templates.keyRating["WR"]).toBe("speed");
    expect(templates.keyRating["DL"]).toBe("passRush");
  });

  it("the pools the UI shows are the league's pools, not the game's home-field-shifted ones", () => {
    const p = prepared();
    const edge = p.data.league.homeField.ratingEdge;
    expect(edge).not.toBe(0);
    for (const [seed, human] of [[82, "away"], [83, "home"]] as const) {
      const g = playGame(seed, human);
      const step = g.sent.find((m) => m.t === "step");
      if (step?.t !== "step") throw new Error("no step");
      const setup = matchupOf(p, 2026, seed);
      const shifted = gamePlayers(setup, p.data);
      for (const t of ["home", "away"] as const) {
        expect(step.matchup[t].pool).toEqual(setup[t].pool);
        expect(step.matchup[t].pool).not.toEqual(shifted[t]);
      }
    }
  });
});

describe("player cards list only the roles the engine credited (Amended)", () => {
  const plays = [91, 92, 93].flatMap((seed) => playGame(seed, seed % 2 === 0 ? "home" : "away").events.filter((e): e is PlayEvent => e.t === "play"));
  const partsOf = (ev: PlayEvent): Record<string, unknown> => ((ev.play.detail ?? {}) as { participants?: Record<string, unknown> }).participants ?? {};

  it("over real games: one line per credited role or foul for every player on the field, none for anyone else", () => {
    let lines = 0;
    for (const ev of plays) {
      const parts = partsOf(ev);
      const onField = ((ev.play.detail ?? {}) as { onField?: { offense: Record<string, string[]>; defense: Record<string, string[]> } }).onField;
      const ids = new Set([...Object.values(onField?.offense ?? {}), ...Object.values(onField?.defense ?? {})].flat());
      for (const id of ids) {
        const credited = Object.entries(parts).filter(([k, v]) => k !== "foulers" && v === id).length + ((parts["foulers"] as string[] | undefined) ?? []).filter((f) => f === id).length;
        const got = playLines(id, ev);
        expect(got.length, `${id} ${ev.play.kind}`).toBe(credited);
        lines += got.length;
      }
    }
    expect(lines).toBeGreaterThan(1000);
  });

  it("each role is shown under one name of its own: a line never names another role", () => {
    // From players credited with exactly one role: the line's name (before any yards).
    const names = new Map<string, Set<string>>();
    for (const ev of plays) {
      const parts = partsOf(ev);
      const roles = Object.entries(parts).filter(([k, v]) => k !== "foulers" && typeof v === "string") as [string, string][];
      for (const [role, id] of roles) {
        if (roles.filter(([, x]) => x === id).length !== 1 || ((parts["foulers"] as string[] | undefined) ?? []).includes(id)) continue;
        const [line] = playLines(id, ev);
        const name = (line ?? "").split(",")[0] as string;
        if (!names.has(role)) names.set(role, new Set());
        names.get(role)?.add(name);
      }
    }
    expect(names.size).toBeGreaterThanOrEqual(8);
    const all: string[] = [];
    for (const [role, set] of names) {
      expect([...set], role).toHaveLength(1);
      all.push(...set);
    }
    expect(new Set(all).size).toBe(all.length);
  });
});
