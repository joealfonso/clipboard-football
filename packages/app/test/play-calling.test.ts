// Visual play calling (docs/specs/m2-play-calling-and-motion.md) and Joseph's two amendments:
// cards (K2, K3), the Calling-state lineup (P2), ratings on marks with a hover card, and the seeds
// in the Esc menu.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Catalog } from "@clipboard-football/shared";
import { offenseArt, slotsFromCounts } from "../src/ui/art";
import { cardArt, cardSvg, personnelLine } from "../src/ui/cards";
import { callingFrame, glide, ownSlots } from "../src/ui/presnap";
import { NO_PLAY_STAT, playLines, ratingValue } from "../src/ui/ratings";
import { pauseScreen, seedLine } from "../src/ui/screens";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { at, timeline } from "../src/ui/timeline";
import type { DecisionRequest, PlayEvent } from "../src/engine/types";
import { ALL_FIXTURES, COMPLETE, fixturePlayers } from "./fixtures";
import { playGame } from "./support";

const read = (p: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", p), "utf8"));
const templates = parseTemplates(read("data/ui/templates.json"));
const motion = parseMotion(read("data/ui/motion.json"));
const catalog = read("data/calls/catalog.json") as Catalog;
const personnel = read("data/engine/personnel.json") as { offense: Record<string, Record<string, number>>; packages: Record<string, Record<string, number>>; presetPackage: Record<string, string> };
const choices = (screen: string): string[] => catalog.screens.find((s) => s.id === screen)?.choices.map((c) => c.id) ?? [];

describe("card art (K2, K3)", () => {
  it("there is art for every formation and every play class in it, and every defense package and preset (K2)", () => {
    for (const f of Object.keys(personnel.offense)) {
      expect(cardArt("formation", f, null, personnel.offense[f] as Record<string, number>, templates).marks.length, f).toBe(11);
      for (const leaf of [...choices("offense.run"), ...choices("offense.pass")]) {
        const art = cardArt("play", f, leaf, personnel.offense[f] as Record<string, number>, templates);
        expect(art.marks.length).toBe(11);
        expect(art.paths.length, `${f} ${leaf}`).toBeGreaterThan(0);
      }
    }
    for (const [preset, pkg] of Object.entries(personnel.presetPackage)) {
      const art = cardArt("coverage", pkg, preset, personnel.packages[pkg] as Record<string, number>, templates);
      expect(art.marks.length, preset).toBe(11);
      expect(art.paths.length + art.zones.length + art.tethers.length, preset).toBeGreaterThan(0);
    }
  });

  it("never shows a ball, a ball path or a highlighted player; pass bands are the class definition; outside runs fork (K3)", () => {
    const counts = personnel.offense["shotgun"] as Record<string, number>;
    for (const leaf of [...choices("offense.run"), ...choices("offense.pass")]) {
      const svg = cardSvg(cardArt("play", "shotgun", leaf, counts, templates), "offense");
      expect(svg).not.toMatch(/ball|target|highlight/i);
    }
    const bands: Record<string, [number, number]> = { shortPass: [0, 9], intermediatePass: [10, 19], deepPass: [20, 35], screenPass: [-4, 0], playAction: [10, 19] };
    for (const [leaf, [a, b]] of Object.entries(bands)) {
      const art = cardArt("play", "shotgun", leaf, counts, templates);
      expect(art.bands).toEqual([{ y0: 50 + a, y1: 50 + b }]);
    }
    const out = cardArt("play", "shotgun", "outsideRun", counts, templates).paths.filter((p) => p.kind === "run");
    expect(out).toHaveLength(2);
    const ends = out.map((p) => (p.points[p.points.length - 1] as { x: number }).x).sort((x, y) => x - y);
    expect(ends[0]).toBeLessThan(26.65);
    expect(ends[1]).toBeGreaterThan(26.65);
  });

  it("formation and package cards read their personnel line from personnel.json", () => {
    expect(personnelLine(personnel.offense["shotgun"] as Record<string, number>, "offense")).toBe("1 RB, 3 WR, 1 TE");
    expect(personnelLine(personnel.packages["nickel"] as Record<string, number>, "defense")).toBe("4 DL, 2 LB, 5 DB");
  });
});

describe("the Calling state (P2)", () => {
  const g = playGame(81, "home");
  const offense = g.requests.filter((r): r is Extract<DecisionRequest, { kind: "offenseCall" }> => r.kind === "offenseCall");

  it("lines up the engine's own players for every formation, the same players onField puts on the field", () => {
    for (const r of offense.slice(0, 20)) for (const f of Object.keys(personnel.offense)) expect(ownSlots(r.lineups, f, {}).every((s) => !s.id.startsWith("own:"))).toBe(true);
  });

  it("puts each player where the timeline sets him for the same formation, at the same layout", () => {
    const px = 9.26;
    const ev = COMPLETE;
    const tl = timeline({ event: ev, runoffSeconds: 0, human: "offense" }, templates, { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: px, markPx: 14, motion });
    const lineup = { shotgun: Object.fromEntries(Object.entries((ev.play.detail as { onField: { offense: Record<string, string[]> } }).onField.offense)) };
    const frame = callingFrame({ side: "offense", los: ev.before.spot, firstDown: null, unit: "shotgun", call: "shortPass", lineups: lineup, counts: {}, opponentCount: 11, templates, motion, pxPerYard: px, markPx: 14, endZoneYards: 10 });
    for (const m of frame.marks.filter((x) => !x.huddle)) {
      const t = tl.marks.find((x) => x.playerId === m.playerId);
      expect(t, m.playerId).toBeDefined();
      expect(at(m.keys, 0)).toEqual(at(t?.keys ?? [], tl.snapAt));
    }
    // Their huddle: 11 marks, no numbers, from the layout only.
    expect(frame.marks.filter((x) => x.huddle)).toHaveLength(11);
    // And the preview art is the call's, the same as the timeline's at the set.
    expect(frame.preview).toEqual(tl.preview);
  });

  it("a focus change glides the marks over 150 ms", () => {
    const base = { side: "offense" as const, los: 40, firstDown: null, lineups: undefined, opponentCount: 11, templates, motion, pxPerYard: 9.26, markPx: 14, endZoneYards: 10 };
    const a = callingFrame({ ...base, unit: "shotgun", call: null, counts: personnel.offense["shotgun"] as Record<string, number> });
    const b = callingFrame({ ...base, unit: "empty", call: null, counts: personnel.offense["empty"] as Record<string, number> });
    const gl = glide(a, b, motion.preSnap.glideMs);
    const qb = gl.marks.find((m) => m.slot === "QB1");
    expect(qb?.keys.length).toBeGreaterThan(2);
    expect(at(qb?.keys ?? [], motion.preSnap.glideMs)).toEqual(at(b.marks.find((m) => m.slot === "QB1")?.keys ?? [], 0));
  });
});

describe("ratings on marks and the hover card (Joseph's amendment)", () => {
  it("a card's play section lists exactly the roles the engine credited this player, and no others", () => {
    for (const ev of Object.values(ALL_FIXTURES)) {
      const parts = ((ev.play.detail ?? {}) as { participants?: Record<string, unknown> }).participants ?? {};
      for (const id of fixturePlayers().keys()) {
        const lines = playLines(id, ev);
        const credited = Object.entries(parts).filter(([k, v]) => k !== "foulers" && v === id).length + (((parts["foulers"] as string[] | undefined) ?? []).filter((f) => f === id).length);
        expect(lines.length, `${id}`).toBe(credited);
      }
    }
    expect(playLines("nobody", COMPLETE)).toEqual([]);
    expect(NO_PLAY_STAT).toBe("No recorded stat on this play");
  });

  it("the yards on a card come from the result", () => {
    expect(playLines("H-WR2", COMPLETE)).toEqual(["Target", "Receiver, 7 yards"]);
  });

  it("the ratings shown equal the card ratings (the pool, before the home-field shift)", () => {
    const g = playGame(82, "away");
    const step = g.sent.find((m) => m.t === "step");
    if (step?.t !== "step") throw new Error("no step");
    for (const p of step.matchup.home.pool.players) {
      for (const [k, v] of [...Object.entries(p.ratings), ...Object.entries(p.skills)]) expect(ratingValue(p, k)).toBe(v);
      expect(ratingValue(p, templates.keyRating[p.position] ?? "")).toBeTypeOf("number");
    }
  });

  it("every mark on the field has a reachable card: a real player id with a number", () => {
    const g = playGame(83, "home");
    const step = g.sent.find((m) => m.t === "step");
    if (step?.t !== "step") throw new Error("no step");
    const ids = new Set([...step.matchup.home.pool.players, ...step.matchup.away.pool.players].map((p) => p.id));
    for (const ev of g.events.filter((e): e is PlayEvent => e.t === "play").slice(0, 40)) {
      const tl = timeline({ event: ev, runoffSeconds: 0 }, templates, { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, motion });
      for (const m of tl.marks) expect(ids.has(m.playerId), m.playerId).toBe(true);
    }
  });
});

describe("seeds (Joseph: off Pregame, still in the menus)", () => {
  it("the in-game Esc menu shows the game's seed and league seed", () => {
    const m = pauseScreen({ hasPlay: true, speed: "1x", seed: 123456, leagueSeed: 2026 });
    expect(m.lines).toEqual([seedLine(123456, 2026)]);
    expect(m.lines?.[0]).toMatch(/123456/);
    expect(m.lines?.[0]).toMatch(/2026/);
    expect(m.rows.length).toBeLessThanOrEqual(7);
  });

  it("the Pregame screen no longer prints the seeds", () => {
    const src = readFileSync(join(import.meta.dirname, "../src/ui/app.ts"), "utf8");
    const pregame = src.slice(src.indexOf("private pregameBody"), src.indexOf("private rosterBody"));
    expect(pregame).not.toMatch(/league seed/);
  });
});

describe("generic slots", () => {
  it("come in the engine's order", () => {
    expect(slotsFromCounts({ QB: 1, WR: 2, OL: 1 }).map((s) => s.slot)).toEqual(["QB1", "WR1", "WR2", "OL1"]);
    expect(offenseArt("shotgun", null, slotsFromCounts(personnel.offense["shotgun"] as Record<string, number>), templates, 40).marks).toHaveLength(11);
  });
});
