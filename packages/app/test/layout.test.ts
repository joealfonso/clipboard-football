// Layout (L1), the seven-choice cap on every non-menu screen (F3), the UI templates covering
// every unit the engine puts on the field, and reading the engine's onField into slots.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { onFieldSlots } from "../src/engine/types";
import { cameraAt, layoutFor, panCamera } from "../src/ui/layout";
import * as S from "../src/ui/screens";
import { MotionError, parseMotion, parseTemplates, TemplateError } from "../src/ui/templates";

const read = (p: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", p), "utf8"));
const templatesRaw = read("data/ui/templates.json");
const templates = parseTemplates(templatesRaw);
const motionRaw = read("data/ui/motion.json");

describe("layout (L1)", () => {
  it.each([
    [1024, 600, 512],
    [1280, 720, 638],
    [1440, 900, 720],
    // The design spec's table says 980 here, but its own rule (the smaller of 50% of the width and
    // 0.95 x the column height) gives 960. The rule is what's built; the table needs a fix.
    [1920, 1080, 960],
  ])("%ix%i: the field column follows the width rule", (w, hgt, col) => {
    const l = layoutFor(w, hgt, templates.field);
    expect(l.tooSmall).toBe(false);
    expect(Math.abs(l.field.width - col)).toBeLessThanOrEqual(1);
    expect(l.field.width).toBe(Math.floor(Math.min(w * 0.5, 0.95 * (hgt - 48))));
    // Marks at least 14 px; interior line marks 2 yards apart leave a gap.
    expect(l.markPx).toBeGreaterThanOrEqual(14);
    const spacing = Math.min(...[["OL1", "OL2"], ["OL2", "OL3"]].map(([a, b]) => Math.abs((templates.offense["shotgun"]?.[a as string]?.[0] ?? 0) - (templates.offense["shotgun"]?.[b as string]?.[0] ?? 0)))) * l.s;
    expect(spacing - l.markPx).toBeGreaterThanOrEqual(4);
    // The panel starts where the field column ends: it never covers the field.
    expect(l.panel.left).toBeGreaterThanOrEqual(l.field.left + l.field.width);
  });

  it("below 1024x600 the make-the-window-larger state is on", () => {
    expect(layoutFor(1023, 700).tooSmall).toBe(true);
    expect(layoutFor(1200, 599).tooSmall).toBe(true);
  });

  it("the line of scrimmage sits 70% down the column, and the camera pans only near an edge", () => {
    const l = layoutFor(1280, 720);
    const cam = cameraAt(40, l.visibleYards);
    expect((cam - 40) / l.visibleYards).toBeCloseTo(0.7, 6);
    expect(panCamera(cam, 50, l.visibleYards)).toBe(cam);
    expect(panCamera(cam, cam - 2, l.visibleYards)).toBe(cam + 3);
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
    // Text size, motion, mark labels, rating labels (Joseph's amendment), Back.
    expect(S.settingsScreen({ textSize: 100, reducedMotion: "on", markLabels: "all", ratingLabels: true }).rows).toHaveLength(5);
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
