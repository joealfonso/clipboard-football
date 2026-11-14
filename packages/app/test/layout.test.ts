// Layout (L1), the seven-choice cap on every non-menu screen (F3), the UI templates covering
// every unit the engine puts on the field, and the per-player box adapter (C4: no stat is a dash,
// not 0).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RuleSet } from "@clipboard-football/shared";
import { playerBox } from "../src/engine/playerBox";
import { numbersFor, onFieldFor, ratingRanks } from "../src/engine/roster";
import { cameraAt, layoutFor, panCamera } from "../src/ui/layout";
import * as S from "../src/ui/screens";
import { parseTemplates, TemplateError } from "../src/ui/templates";
import { COMPLETE, INTERCEPTION, RUN, SACK } from "./fixtures";
import { prepared } from "./support";

const read = (p: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", p), "utf8"));
const templatesRaw = read("data/ui/templates.json");
const templates = parseTemplates(templatesRaw);

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
    expect(S.settingsScreen({ textSize: 100, reducedMotion: "on", markLabels: "all" }).rows).toHaveLength(4);
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
    // The M1 engine fields the base package on every kick (the return units are milestone B).
    for (const unit of ["kickoff", "punt", "fieldGoal"]) covers(templates.returnUnits[unit], personnel.packages["base"] as Record<string, number>, `return ${unit}`);
  });

  it("every preset has a drop, every pass play a neutral depth", () => {
    const catalog = read("data/calls/catalog.json") as { screens: { id: string; choices: { id: string }[] }[] };
    for (const s of catalog.screens.filter((x) => x.id.startsWith("defense.") && x.id !== "defense.package")) for (const c of s.choices) expect(templates.drops[templates.presetDrops[c.id] ?? ""], c.id).toBeDefined();
    for (const c of catalog.screens.find((x) => x.id === "offense.pass")?.choices ?? []) expect(templates.passDepth[c.id], c.id).toBeTypeOf("number");
  });

  it("a malformed file is refused with the file named", () => {
    expect(() => parseTemplates({ ...(templatesRaw as object), timing: { setMs: "slow" } })).toThrow(TemplateError);
    expect(() => parseTemplates({})).toThrow(/data\/ui\/templates\.json/);
  });
});

describe("roster adapters", () => {
  const p = prepared();
  const league = p.league(2026);

  it("placeholder jersey numbers are unique within each team and stable", () => {
    for (const t of league) {
      const n = numbersFor(t.pool);
      expect(new Set(n.values()).size).toBe(t.pool.players.length);
      for (const v of n.values()) expect(v >= 0 && v <= 99).toBe(true);
      expect([...numbersFor(t.pool)]).toEqual([...n]);
    }
  });

  it("rating ranks match a rank recomputed from the league (P1)", () => {
    const pools = league.map((t) => t.pool);
    const player = pools[3]?.players.find((x) => x.position === "WR");
    if (player === undefined) throw new Error("no WR");
    const peers = pools.flatMap((t) => t.players.filter((x) => x.position === "WR"));
    for (const r of ratingRanks(pools, player)) {
      const values = peers.map((x) => (x.ratings as Record<string, number>)[r.rating] ?? x.skills[r.rating] ?? 0).sort((a, b) => b - a);
      expect(r.rank).toBe(values.indexOf(r.value) + 1);
      expect(r.of).toBe(peers.length);
    }
  });

  it("onField mirrors the engine's pool-order fill", () => {
    const [a, b] = league;
    const f = onFieldFor(p.data.engine.personnel, a?.pool ?? league[0]!.pool, b?.pool ?? league[0]!.pool, { group: "offense", name: "shotgun" }, "nickel");
    expect(f?.offense.map((s) => s.slot)).toEqual(["QB1", "RB1", "WR1", "WR2", "WR3", "TE1", "OL1", "OL2", "OL3", "OL4", "OL5"]);
    expect(f?.defense).toHaveLength(11);
  });
});

describe("per-player box adapter (milestone C stand-in)", () => {
  const rules = prepared().data.engine.rules as RuleSet;

  it("credits only named players, and a player with no stat in a category has none (C4)", () => {
    const box = playerBox([COMPLETE, RUN, SACK, INTERCEPTION], rules);
    expect(box.get("H-QB1")?.passing).toEqual({ completions: 1, attempts: 2, yards: 7, touchdowns: 0, interceptions: 1, sacked: 1 });
    expect(box.get("H-WR2")?.receiving).toEqual({ targets: 1, catches: 1, yards: 7, touchdowns: 0, long: 7 });
    expect(box.get("H-RB1")?.rushing).toEqual({ attempts: 1, yards: 4, touchdowns: 0, long: 4 });
    expect(box.get("H-RB1")?.receiving).toBeUndefined();
    expect(box.get("A-DL2")?.defense?.sacks).toBe(1);
    expect(box.get("A-S1")?.defense?.interceptions).toBe(1);
  });

  it("is empty when no play names its players (the M1 engine)", () => {
    const none = playerBox([{ ...COMPLETE, play: { ...COMPLETE.play, detail: {} } }], rules);
    expect(none.size).toBe(0);
  });
});
