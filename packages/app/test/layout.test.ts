// Layout (L1: the full-screen field), the overlay rules (Joseph's full-screen amendment), the seven-choice cap on every non-menu screen (F3), the UI templates covering
// every unit the engine puts on the field, and reading the engine's onField into slots.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { onFieldSlots } from "../src/engine/types";
import type { PlayEvent } from "../src/engine/types";
import { cameraAt, COLUMN_YARDS, layoutFor, MIN_HEIGHT, MIN_WIDTH, panCamera, screenX, screenY, SIDE_MARGIN_MIN, TOP_BAR, VISIBLE_YARDS } from "../src/ui/layout";
import { blend, CARD_MIN_WINDOW_WIDTH, contrast, FocusTrail, OVERLAY_ALPHA, OVERLAY_IDS, OVERLAY_MARGIN, overlaysShown, placeOverlay, rgbOf, unitDepth } from "../src/ui/overlay";
import { at, timeline } from "../src/ui/timeline";
import { COLOR } from "../src/ui/tokens";
import { playGame } from "./support";
import * as S from "../src/ui/screens";
import { MotionError, parseMotion, parseTemplates, TemplateError } from "../src/ui/templates";

const read = (p: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", p), "utf8"));
const templatesRaw = read("data/ui/templates.json");
const templates = parseTemplates(templatesRaw);
const motionRaw = read("data/ui/motion.json");

describe("layout (L1, the full-screen field)", () => {
  it.each([
    [800, 520],
    [1024, 600],
    [1280, 720],
    [1440, 900],
    [1920, 1080],
  ])("%ix%i: the field fills the window under the top bar, sideline to sideline in view", (w, hgt) => {
    const l = layoutFor(w, hgt, templates.field);
    expect(l.tooSmall).toBe(false);
    expect(l.field).toEqual({ left: 0, top: TOP_BAR, width: w, height: hgt - TOP_BAR });
    // The whole width of the field shows, and at least VISIBLE_YARDS of its length.
    expect(l.column.width).toBeLessThanOrEqual(w);
    expect(l.column.width).toBeGreaterThanOrEqual(Math.floor(COLUMN_YARDS * l.s));
    const spare = w - l.column.width;
    if (spare >= SIDE_MARGIN_MIN) {
      // A margin wide enough for the overlays: the column flush left, the margin all on the right.
      expect(l.column.left).toBe(0);
      expect(l.side).toEqual({ left: l.column.width, top: TOP_BAR, width: spare, height: hgt - TOP_BAR });
    } else {
      expect(l.side).toBeNull();
      expect(Math.abs(l.column.left * 2 + l.column.width - w)).toBeLessThanOrEqual(1);
    }
    expect(l.visibleYards).toBeGreaterThanOrEqual(VISIBLE_YARDS - 1e-9);
    expect(screenX(l, -1)).toBe(l.column.left);
    // Marks at least 14 px; interior line marks 2 yards apart leave a gap.
    expect(l.markPx).toBeGreaterThanOrEqual(14);
    const spacing = Math.min(...[["OL1", "OL2"], ["OL2", "OL3"]].map(([a, b]) => Math.abs((templates.offense["shotgun"]?.[a as string]?.[0] ?? 0) - (templates.offense["shotgun"]?.[b as string]?.[0] ?? 0)))) * l.s;
    expect(spacing - l.markPx).toBeGreaterThanOrEqual(4);
  });

  it("the make-the-window-larger floor is lowered to 800x520, where the field still fits", () => {
    expect([MIN_WIDTH, MIN_HEIGHT]).toEqual([800, 520]);
    expect(layoutFor(1023, 599).tooSmall).toBe(false);
    expect(layoutFor(799, 700).tooSmall).toBe(true);
    expect(layoutFor(1200, 519).tooSmall).toBe(true);
  });

  it("the line of scrimmage sits 70% down the canvas, and the camera pans only near an edge", () => {
    const l = layoutFor(1280, 720);
    const cam = cameraAt(40, l.visibleYards);
    expect((cam - 40) / l.visibleYards).toBeCloseTo(0.7, 6);
    expect(screenY(l, cam, 40) / l.field.height).toBeCloseTo(0.7, 6);
    expect(panCamera(cam, 50, l.visibleYards)).toBe(cam);
    expect(panCamera(cam, cam - 2, l.visibleYards)).toBe(cam + 3);
  });
});

describe("overlays over the field (Joseph, 2026-11-14)", () => {
  const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };
  const games = [{ g: playGame(91, "home"), human: "home" as const }, { g: playGame(92, "away"), human: "away" as const }];
  // Every scrimmage call that lines a formation up against a defense preset: the sets the human sees while calling.
  const sets = games.flatMap(({ g, human }) =>
    g.events.filter((e): e is PlayEvent => e.t === "play" && e.before.phase === "scrimmage" && e.offense.formation !== undefined && e.defense !== null).map((ev) => ({ ev, human })),
  );
  // Margins under SIDE_MARGIN_MIN, so the overlay goes over the field: the floor and two tall windows.
  const overField = [
    [800, 520],
    [1024, 900],
    [1280, 1024],
  ] as const;
  // Margins wide enough: the overlay goes beside the field.
  const beside = [
    [1024, 600],
    [1280, 720],
    [1440, 900],
    [1920, 1080],
  ] as const;

  it("the windows above are the right kind", () => {
    for (const [w, hgt] of overField) expect(layoutFor(w, hgt).side, `${w}x${hgt}`).toBeNull();
    for (const [w, hgt] of beside) expect(layoutFor(w, hgt).side, `${w}x${hgt}`).not.toBeNull();
  });

  // Amended 2026-11-14 (usability pass U1, AC 6): the panel fills the side column, full bleed.
  it.each(beside)("%ix%i: with a wide margin the overlay sits in it and covers no part of the field", (w, hgt) => {
    const l = layoutFor(w, hgt, templates.field);
    const g = { los: 40, lineToGain: 50, side: "defense" as const, depth: 23 };
    for (const p of [placeOverlay(l, cameraAt(40, l.visibleYards), g, 1.4, 0), placeOverlay(l, cameraAt(40, l.visibleYards), g, 1.4, w), placeOverlay(l, 0, null, 1.4)]) {
      expect(p.where).toBe("side");
      expect(p.left).toBeGreaterThanOrEqual(l.column.left + l.column.width);
      expect(p.left + p.width).toBeLessThanOrEqual(w);
      expect(p.width).toBeGreaterThanOrEqual(SIDE_MARGIN_MIN - 2 * OVERLAY_MARGIN);
      expect(p.maxHeight).toBe(l.field.height);
    }
  });

  it("there are sets on both sides of the ball to check", () => {
    expect(sets.filter((s) => s.ev.before.possession === s.human).length).toBeGreaterThan(50);
    expect(sets.filter((s) => s.ev.before.possession !== s.human).length).toBeGreaterThan(50);
  });

  it.each(overField)("%ix%i: over the field it never covers the line of scrimmage, the line to gain or your lineup at the set", (w, hgt) => {
    const l = layoutFor(w, hgt, templates.field);
    const markYards = l.markPx / l.s;
    const heights: number[] = [];
    for (const { ev, human } of sets) {
      const side = ev.before.possession === human ? "offense" : "defense";
      const tl = timeline({ event: ev, runoffSeconds: 0, human: side }, templates, { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: l.s, markPx: l.markPx, motion: parseMotion(motionRaw) });
      const pkg = personnel.presetPackage[ev.defense as string] ?? "base";
      const depth = side === "offense" ? unitDepth(templates, "offense", ev.offense.formation as string, null) : unitDepth(templates, "defense", pkg, ev.defense);
      const ltg = ev.before.goalToGo ? null : ev.before.spot + ev.before.distance;
      const camera = cameraAt(tl.los, l.visibleYards, templates.field.losFromTop);
      const p = placeOverlay(l, camera, { los: tl.los, lineToGain: ltg, side, depth }, markYards, w / 2);
      expect(p.where).not.toBe("side");
      const top = p.top;
      const bottom = p.top + p.maxHeight;
      const y = (fy: number): number => l.field.top + screenY(l, camera, fy);
      const clear = (a: number, b: number): boolean => b <= top || a >= bottom;
      expect(clear(y(tl.los) - 1, y(tl.los) + 1), `LOS ${w}x${hgt}`).toBe(true);
      if (ltg !== null) expect(clear(y(ltg) - 1, y(ltg) + 1), `line to gain ${w}x${hgt}`).toBe(true);
      const own = tl.marks.filter((m) => m.side === (side === "offense" ? "O" : "X") && !m.huddle);
      expect(own.length).toBe(11);
      for (const m of own) {
        const my = y(at(m.keys, tl.snapAt).y);
        expect(clear(my - l.markPx / 2, my + l.markPx / 2), `${m.slot} ${w}x${hgt}`).toBe(true);
      }
      heights.push(p.maxHeight);
    }
    // Room to call in on every set, even at the floor: a title and two lines of compact rows (100 px).
    // The worst case is a prevent defense, with the overlay below the line; past that it scrolls.
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(100);
  });

  it("off the field (title, pregame, settings) with narrow margins the overlay is a centered sheet", () => {
    const l = layoutFor(1280, 1024);
    const p = placeOverlay(l, 0, null, 1.4);
    expect(p.where).toBe("sheet");
    expect(Math.abs(p.left * 2 + p.width - 1280)).toBeLessThanOrEqual(1);
  });

  it("over the field, sits on the side away from the ball", () => {
    const l = layoutFor(1920, 1600);
    expect(l.side).toBeNull();
    const g = { los: 40, lineToGain: 50, side: "offense" as const, depth: 7 };
    const leftBall = placeOverlay(l, cameraAt(40, l.visibleYards), g, 1.4, 300);
    const rightBall = placeOverlay(l, cameraAt(40, l.visibleYards), g, 1.4, 1600);
    expect(leftBall.left + leftBall.width).toBe(1920 - OVERLAY_MARGIN);
    expect(leftBall.where).not.toBe("side");
    expect(rightBall.left).toBe(OVERLAY_MARGIN);
  });

  it("card art from 1024 wide up, whichever way the overlay is placed; text rows below that", () => {
    const g = { los: 40, lineToGain: 50, side: "offense" as const, depth: 7 };
    for (const [w, hgt] of [...overField, ...beside, [1023, 600] as const]) {
      const l = layoutFor(w, hgt);
      expect(placeOverlay(l, cameraAt(40, l.visibleYards), g, 1.4).compact, `${w}x${hgt}`).toBe(w < CARD_MIN_WINDOW_WIDTH);
      expect(placeOverlay(l, 0, null, 1.4).compact, `${w}x${hgt} sheet`).toBe(w < CARD_MIN_WINDOW_WIDTH);
    }
    expect(CARD_MIN_WINDOW_WIDTH).toBe(1024);
  });

  it("no overlay during the live play: every overlay element is hidden; the player card only with the play paused for it", () => {
    // Every overlay element in the page is one the rule covers.
    const html = readFileSync(join(import.meta.dirname, "../index.html"), "utf8");
    const ids = [...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*\bclass="[^"]*\boverlay\b[^"]*"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect([...ids].sort()).toEqual([...OVERLAY_IDS].sort());
    const live = overlaysShown({ animating: true, markCard: false });
    for (const id of OVERLAY_IDS) expect(live[id], id).toBe(false);
    expect(overlaysShown({ animating: false, markCard: false })).toEqual({ panel: true, "mark-card": false });
    expect(overlaysShown({ animating: true, markCard: true })).toEqual({ panel: false, "mark-card": true });
    // A hidden overlay stays hidden whatever class it has: the bug where .panel.wide (display: grid)
    // outranked [hidden] and left the result and why lines over the live play.
    const css = readFileSync(join(import.meta.dirname, "../src/styles.css"), "utf8");
    expect(css).toMatch(/\.overlay\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });

  // Amended 2026-11-14 (usability pass U1, AC 2): the backing is the opaque dark board, with chalk text.
  it("text on the panel backing keeps 4.5:1 over the darkest field pixel", () => {
    for (const under of [COLOR.ink, COLOR.offense, COLOR.defense, COLOR.ball, COLOR.paper]) {
      const backing = blend(rgbOf(COLOR.panel), rgbOf(under), OVERLAY_ALPHA);
      for (const text of [COLOR.chalk, COLOR.chalkSoft]) expect(contrast(rgbOf(text), backing), `${text} over ${under}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("focus goes back to where it was when an overlay closes; Esc on a lower one closes the ones over it", () => {
    const t = new FocusTrail<string, number>();
    t.open("box", 2);
    t.open("details", 0);
    expect(t.top()).toBe("details");
    expect(t.close("details")).toBe(0);
    expect(t.close("box")).toBe(2);
    expect(t.close("box")).toBeUndefined();
    t.open("pause", 4);
    t.open("settings", 1);
    expect(t.close("pause")).toBe(4);
    expect(t.top()).toBeUndefined();
  });
});

describe("every non-menu screen has at most seven choices (F3)", () => {
  const models: S.ScreenModel[] = [
    S.titleScreen({ hasSave: true, storage: true }),
    S.titleScreen({ hasSave: false, storage: false }),
    S.pregameScreen(),
    ...S.UNITS.map((unit) => S.rosterScreen({ team: "T", unit, empty: false })),
    S.cardScreen({ hasPrev: true, hasNext: false }),
    S.ratingDetailScreen(),
    S.noticeScreen("toss", "Coin toss"),
    S.halftimeScreen(),
    S.endScreen(),
    ...S.BOX_TABS.map((t) => S.boxScreen(t)),
    S.pauseScreen({ hasPlay: true, speed: "1x" }),
    S.settingsScreen({ textSize: 200, reducedMotion: "system", markLabels: "involved" }),
    S.controlsScreen(),
    S.detailsScreen(),
    S.saveErrorScreen("older"),
    S.saveErrorScreen("damaged"),
    S.simErrorScreen(),
  ];
  it.each(models.map((m) => [m.id, m] as const))("%s", (_id, m) => {
    expect(m.rows.length).toBeLessThanOrEqual(7);
    expect(new Set(m.rows.map((r) => r.key)).size).toBe(m.rows.length);
    for (const r of m.rows) if (!r.on) expect(r.reason, `${m.id} ${r.label}`).toBeTruthy();
  });

  it("counts match the design's screen table", () => {
    expect(S.pregameScreen().rows).toHaveLength(6);
    expect(S.pauseScreen({ hasPlay: true, speed: "1x" }).rows).toHaveLength(7);
    // Text size, motion, mark labels, what the mark label shows (usability pass U7), Back.
    expect(S.settingsScreen({ textSize: 100, reducedMotion: "on", markLabels: "all", labelContent: "rating" }).rows).toHaveLength(5);
    expect(S.boxScreen("Team").rows).toHaveLength(6);
    expect(S.endScreen().rows).toHaveLength(4);
    expect(S.titleScreen({ hasSave: false, storage: true }).rows[1]).toMatchObject({ on: false, reason: "no saved game" });
  });
});

describe("UI templates", () => {
  it("cover every slot of every unit the engine fields (no fallback placement in a real game)", () => {
    const personnel = read("data/engine/personnel.json") as { offense: Record<string, Record<string, number>>; kick: Record<string, Record<string, number>>; packages: Record<string, Record<string, number>> };
    const covers = (group: Record<string, readonly [number, number]> | undefined, slots: Record<string, number>, what: string): void => {
      for (const [pos, n] of Object.entries(slots)) for (let i = 1; i <= n; i++) expect(group?.[`${pos}${i}`], `${what} ${pos}${i}`).toBeDefined();
    };
    for (const [f, slots] of Object.entries(personnel.offense)) covers(templates.offense[f], slots, f);
    for (const [k, slots] of Object.entries(personnel.kick)) covers(templates.kick[k], slots, k);
    for (const [p, slots] of Object.entries(personnel.packages)) covers(templates.defense[p], slots, p);
    // The receiving units on kicks: participants.json's return units (kickoffs, onside kicks,
    // punts), and the base package for field goals and extra points.
    const participants = read("data/engine/participants.json") as { returnUnits: Record<string, Record<string, number>>; receivingUnit: Record<string, string> };
    const ru = participants.returnUnits;
    covers(templates.returnUnits["kickoff"], ru[participants.receivingUnit["kickoff"] as string] as Record<string, number>, "kickoff return");
    covers(templates.returnUnits["kickoff"], ru[participants.receivingUnit["onsideKick"] as string] as Record<string, number>, "onside return");
    covers(templates.returnUnits["punt"], ru[participants.receivingUnit["punt"] as string] as Record<string, number>, "punt return");
    covers(templates.returnUnits["fieldGoal"], personnel.packages["base"] as Record<string, number>, "field goal defense");
  });

  it("every preset has a drop, every pass play a neutral depth", () => {
    const catalog = read("data/calls/catalog.json") as { screens: { id: string; choices: { id: string }[] }[] };
    for (const s of catalog.screens.filter((x) => x.id.startsWith("defense.") && x.id !== "defense.package")) for (const c of s.choices) expect(templates.drops[templates.presetDrops[c.id] ?? ""], c.id).toBeDefined();
    for (const c of catalog.screens.find((x) => x.id === "offense.pass")?.choices ?? []) expect(templates.passDepth[c.id], c.id).toBeTypeOf("number");
  });

  it("a malformed file is refused with the file named", () => {
    expect(() => parseTemplates({ ...(templatesRaw as object), timing: { setMs: "slow" } })).toThrow(TemplateError);
    expect(() => parseTemplates({})).toThrow(/data\/ui\/templates\.json/);
    for (const k of ["presetAlignment", "zones", "manTargets", "depthBands", "keyRating"]) expect(() => parseTemplates({ ...(templatesRaw as object), [k]: "x" }), k).toThrow(TemplateError);
    expect(parseMotion(motionRaw).maxStartMs).toBeLessThanOrEqual(150);
    expect(() => parseMotion({})).toThrow(MotionError);
    expect(() => parseMotion({ ...(motionRaw as object), maxStartMs: 151 })).toThrow(MotionError);
  });

  it("every defense preset has zones or man targets, one or the other, never empty", () => {
    const catalog = read("data/calls/catalog.json") as { screens: { id: string; choices: { id: string }[] }[] };
    for (const s of catalog.screens.filter((x) => x.id.startsWith("defense.") && x.id !== "defense.package"))
      for (const c of s.choices) {
        const z = Object.keys(templates.zones[c.id] ?? {}).length;
        const m = Object.keys(templates.manTargets[c.id] ?? {}).length;
        expect(z > 0 !== m > 0, c.id).toBe(true);
      }
  });
});


describe("the engine's onField as slots", () => {
  it("numbers each position's ids in slot order, offense and defense", () => {
    const f = onFieldSlots({ offense: { QB: ["q"], WR: ["w1", "w2"] }, defense: { CB: ["c1"] } });
    expect(f?.offense).toEqual([
      { slot: "QB1", position: "QB", id: "q" },
      { slot: "WR1", position: "WR", id: "w1" },
      { slot: "WR2", position: "WR", id: "w2" },
    ]);
    expect(f?.defense).toEqual([{ slot: "CB1", position: "CB", id: "c1" }]);
  });

  it("drops a malformed onField instead of guessing", () => {
    expect(onFieldSlots({ offense: { QB: "q" }, defense: {} })).toBeUndefined();
    expect(onFieldSlots(null)).toBeUndefined();
  });
});
