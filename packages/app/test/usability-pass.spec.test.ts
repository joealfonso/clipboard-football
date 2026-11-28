// Spec tests for docs/specs/m2-usability-pass.md (P1, U1 to U9), written from the spec's
// acceptance criteria (AC 1 to 13) by test-writer. Expected values come from the spec and
// DESIGN.md, not from the implementation: the contrast figures and the swatch table are typed in
// from the spec, and the swatch rule is re-implemented here from its words.
// The animator and key-repeat fixes are in usability-pass-animator.spec.test.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Catalog } from "@clipboard-football/shared";
import type { DecisionRequest } from "../src/engine/types";
import { huddleSpots } from "../src/ui/art";
import { drawField, drawFrame, HUDDLE_LABEL, viewOf, type FrameOpts } from "../src/ui/field";
import { cameraAt, layoutFor } from "../src/ui/layout";
import { labelWidth, placeNumbers, type MarkPx } from "../src/ui/marks";
import { breadcrumb, openMenu, press, title, type MenuData, type MenuKey, type MenuState } from "../src/ui/menu";
import { MID_X } from "../src/ui/motion";
import { blend, contrast, overlayBackground, placeOverlay, rgbOf, type Guard } from "../src/ui/overlay";
import { callingFrame, kickoffFrame } from "../src/ui/presnap";
import { settingsScreen, titleScreen } from "../src/ui/screens";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../src/ui/storage";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { catalogLabels } from "../src/ui/text";
import { at, timeline } from "../src/ui/timeline";
import { COLOR, FONT_UI, matchupSwatches, SWATCH_FAMILY, SWATCHES, TEAM_END_ZONE, TEAM_OUTLINE } from "../src/ui/tokens";
import { COMPLETE, KICKOFF_RETURN } from "./fixtures";
import { playGame } from "./support";

const root = join(import.meta.dirname, "../../..");
const read = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));
const templates = parseTemplates(read("data/ui/templates.json"));
const motionJson = read("data/ui/motion.json") as { huddle: { offenseBehind: number; defensePast: number; markGapPx: number } };
const motion = parseMotion(motionJson);
const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string>; offense: Record<string, Record<string, number>> };
const c = (a: string, b: string): number => contrast(rgbOf(a), rgbOf(b));

// ---------------------------------------------------------------- a recording canvas context

interface Fill {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly style: string;
}
interface Text {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly style: string;
  readonly font: string;
  readonly align: string;
  readonly baseline: string;
}

interface Stroked {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly style: string;
  readonly width: number;
}

/** A rounded rectangle filled as a path (DESIGN.md Broadcast: tag pills, toasts, the flag marker). */
type Pill = Fill;

function recorder(): { g: CanvasRenderingContext2D; fills: Fill[]; texts: Text[]; strokedTexts: Stroked[]; pills: Pill[]; clears: Omit<Fill, "style">[] } {
  const fills: Fill[] = [];
  const texts: Text[] = [];
  const strokedTexts: Stroked[] = [];
  const pills: Pill[] = [];
  const clears: Omit<Fill, "style">[] = [];
  let path: { x: number; y: number; w: number; h: number }[] = [];
  const state: Record<string, unknown> = { fillStyle: "#000000", font: "10px sans-serif", globalAlpha: 1, textAlign: "start", textBaseline: "alphabetic" };
  const g = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === "measureText") return (s: string) => ({ width: s.length * 7 });
      if (prop === "beginPath") return () => (path = []);
      if (prop === "roundRect") return (x: number, y: number, w: number, h: number) => path.push({ x, y, w, h });
      if (prop === "fill") return () => pills.push(...path.map((r) => ({ ...r, style: String(target["fillStyle"]) })));
      if (prop === "clearRect") return (x: number, y: number, w: number, h: number) => clears.push({ x, y, w, h });
      if (prop === "fillRect") return (x: number, y: number, w: number, h: number) => fills.push({ x, y, w, h, style: String(target["fillStyle"]) });
      if (prop === "fillText") return (text: string, x: number, y: number) => texts.push({ text, x, y, style: String(target["fillStyle"]), font: String(target["font"]), align: String(target["textAlign"]), baseline: String(target["textBaseline"]) });
      if (prop === "strokeText") return (text: string, x: number, y: number) => strokedTexts.push({ text, x, y, style: String(target["strokeStyle"]), width: Number(target["lineWidth"]) });
      if (prop === "getLineDash") return () => [];
      return () => undefined;
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { g, fills, texts, strokedTexts, pills, clears };
}

/** The color.tag pill a text sits on: a pill centered on the text (DESIGN.md Broadcast: every small word on the grass is on a tag). */
function tagUnder(t: Text, pills: readonly Pill[]): Pill | undefined {
  return pills.find((p) => p.style === COLOR.tag && Math.abs(p.x + p.w / 2 - t.x) < 1e-6 && Math.abs(p.y + p.h / 2 - t.y) < 1e-6);
}

/**
 * Each drawn text is centered on a color.tag pill wider than the text and `height` px tall, drawn
 * before it, and has no stroked outline (DESIGN.md Marks: white on a dark tag pill, superseding the stroke).
 */
function expectTagged(texts: readonly Text[], pills: readonly Pill[], strokes: readonly Stroked[], height: number, padX: number): void {
  for (const t of texts) {
    const p = tagUnder(t, pills);
    expect(p, `tag under ${t.text}`).toBeDefined();
    expect(p?.h).toBe(height);
    expect(p?.w).toBeCloseTo(t.text.length * 7 + 2 * padX, 9);
    expect(t.align).toBe("center");
    expect(t.baseline).toBe("middle");
    expect(strokes.some((k) => k.text === t.text && k.x === t.x && k.y === t.y), `no stroke under ${t.text}`).toBe(false);
  }
}

/** The color the last fillRect covering (x, y) painted. */
function paintedAt(fills: readonly Fill[], x: number, y: number): string | undefined {
  let out: string | undefined;
  for (const f of fills) {
    const [x0, x1] = [Math.min(f.x, f.x + f.w), Math.max(f.x, f.x + f.w)];
    const [y0, y1] = [Math.min(f.y, f.y + f.h), Math.max(f.y, f.y + f.h)];
    if (x >= x0 && x < x1 && y >= y0 && y < y1) out = f.style;
  }
  return out;
}

const L1280 = layoutFor(1280, 720, templates.field);
const scene = { los: 40, firstDown: null, bottomName: "Bears", topName: "Lions", endZoneYards: 10 };
const frameOpts = (over: Partial<FrameOpts> = {}): FrameOpts => ({ numbers: {}, ratings: {}, labelContent: "number", focused: null, markLabels: "all", routeAlpha: 1, textScale: 1, ...over });
const viewAt = (los: number) => viewOf(L1280, cameraAt(los, L1280.visibleYards, templates.field.losFromTop));

// ---------------------------------------------------------------- AC 1, 2: contrast

describe("AC 1: every contrast figure in the spec and DESIGN.md, recomputed from the hex values", () => {
  // [label, a, b, figure as printed]
  const FIGURES: readonly [string, string, string, number][] = [
    // DESIGN.md "Stadium grass" contrast checks (2026-11-15), recomputed here as its Still open asks.
    // Panel.
    ["chalk on panel", COLOR.chalk, COLOR.panel, 14.72],
    ["chalkSoft on panel", COLOR.chalkSoft, COLOR.panel, 7.72],
    ["chalk focus ring on panel", COLOR.chalk, COLOR.panel, 14.72],
    ["paper against panel", COLOR.paper, COLOR.panel, 14.72],
    ["gold fill (highlighted row) against panel", COLOR.gold, COLOR.panel, 10.89],
    ["chalkSoft bar fill on panelRaise track", COLOR.chalkSoft, COLOR.panelRaise, 5.88],
    ["panelRaise on panel", COLOR.panelRaise, COLOR.panel, 1.31],
    ["chalk on panelRaise", COLOR.chalk, COLOR.panelRaise, 11.21],
    ["signal on panel", COLOR.signal, COLOR.panel, 10.89],
    ["ink on gold (highlighted row)", COLOR.ink, COLOR.gold, 9.95],
    ["inkSoft on gold (notes on the highlighted row)", COLOR.inkSoft, COLOR.gold, 4.93],
    // Light surfaces (play cards, player card).
    ["ink on paper", COLOR.ink, COLOR.paper, 13.46],
    ["inkSoft on paper", COLOR.inkSoft, COLOR.paper, 6.66],
    ["inkSoft on paperShade (off card labels)", COLOR.inkSoft, COLOR.paperShade, 5.66],
    ["ink on paperShade (play-card zones and bands)", COLOR.ink, COLOR.paperShade, 11.43],
    ["ink against signal", COLOR.ink, COLOR.signal, 9.95],
    // Play cards (DESIGN.md Broadcast): ink for both sides on paper tiles, zone edges inkSoft on paperShade.
    ["play card diagram: ink on paper (both sides)", COLOR.ink, COLOR.paper, 13.46],
    ["play card zone edge: inkSoft on paperShade", COLOR.inkSoft, COLOR.paperShade, 5.66],
    // Field paint on the two turf stripes (light / dark). The light stripe moved to #327739 (Broadcast).
    ["line on turfStripe", COLOR.line, COLOR.turfStripe, 5.07],
    ["line on turf", COLOR.line, COLOR.turf, 5.43],
    ["hash on turfStripe", COLOR.hash, COLOR.turfStripe, 4.02],
    ["hash on turf", COLOR.hash, COLOR.turf, 4.3],
    ["outlineDark (line of scrimmage) on turfStripe", COLOR.outlineDark, COLOR.turfStripe, 3.56],
    ["outlineDark (line of scrimmage) on turf", COLOR.outlineDark, COLOR.turf, 3.33],
    ["signal (first-down line core) on turfStripe", COLOR.signal, COLOR.turfStripe, 3.61],
    ["signal (first-down line core) on turf", COLOR.signal, COLOR.turf, 3.87],
    ["turfStripe against turf (decorative)", COLOR.turfStripe, COLOR.turf, 1.07],
    ["sideline is turf's hex", COLOR.sideline, COLOR.turf, 1],
    // Marks, rings and the ball on grass.
    ["line against outlineDark (the two ring colors)", COLOR.line, COLOR.outlineDark, 18.1],
    ["ball against its line outline", COLOR.ball, COLOR.line, 6.89],
    // Team fills against their rings (DESIGN.md Team colors, "Fill vs outline").
    ["slot 0 orange #F29A2E against its outlineDark ring", "#F29A2E", COLOR.outlineDark, 8.78],
    ["slot 1 red #C62F2F against its line ring", "#C62F2F", COLOR.line, 5.06],
    ["slot 2 cobalt #3263D2 against its line ring", "#3263D2", COLOR.line, 5.06],
    ["slot 3 silver #C3CCD3 against its outlineDark ring", "#C3CCD3", COLOR.outlineDark, 11.99],
    ["slot 4 black iron #1D1E22 against its line ring", "#1D1E22", COLOR.line, 15.44],
    ["slot 5 purple #7A4EBA against its line ring", "#7A4EBA", COLOR.line, 5.37],
    ["slot 6 lilac #B99BE8 against its outlineDark ring", "#B99BE8", COLOR.outlineDark, 8.29],
    ["slot 7 azure #45A8E6 against its outlineDark ring", "#45A8E6", COLOR.outlineDark, 7.44],
    // U4: matchup pairs (DESIGN.md Colorblind simulation, "Lowest allowed matchup").
    ["silver against lilac (lowest allowed pair)", "#C3CCD3", "#B99BE8", 1.45],
    ["red against cobalt (fails the rule)", "#C62F2F", "#3263D2", 1.0],
  ];
  it.each(FIGURES)("%s is %d (+-0.05)", (_label, a, b, figure) => {
    expect(Math.abs(c(a, b) - figure)).toBeLessThanOrEqual(0.05);
  });

  // DESIGN.md Contrast checks (Broadcast): figures over translucent paint, blended in sRGB over the worst pixel.
  it("Broadcast: the lit light stripe, softened yard lines and tag pills keep their figures", () => {
    const lit = blend([255, 255, 255], rgbOf(COLOR.turfStripe), 0.05);
    const near = (got: number, want: number, what: string): void => expect(Math.abs(got - want), `${what}: ${got.toFixed(2)}`).toBeLessThanOrEqual(0.05);
    near(contrast(rgbOf(COLOR.line), lit), 4.58, "line at the lit light stripe");
    near(contrast(rgbOf(COLOR.hash), lit), 3.62, "hash at the lit light stripe");
    near(contrast(rgbOf(COLOR.signal), lit), 3.26, "first-down core at the lit light stripe");
    near(contrast(blend(rgbOf(COLOR.line), rgbOf(COLOR.turf), 0.8), rgbOf(COLOR.turf)), 4.12, "yard line at 0.8 on the dark stripe");
    near(contrast(blend(rgbOf(COLOR.line), lit, 0.8), lit), 3.55, "yard line at 0.8 at the lit light stripe");
    // color.tag is rgba(7, 12, 22, 0.78).
    expect(COLOR.tag).toBe("rgba(7, 12, 22, 0.78)");
    near(contrast(rgbOf(COLOR.line), blend([7, 12, 22], lit, 0.78)), 14.8, "line on a tag at the lit light stripe");
    for (const ez of TEAM_END_ZONE) expect(contrast(rgbOf(COLOR.line), blend([7, 12, 22], rgbOf(ez), 0.78)), ez).toBeGreaterThanOrEqual(13);
    // Both ring colors keep 3:1 against both stripes and the lit center.
    for (const under of [rgbOf(COLOR.turf), rgbOf(COLOR.turfStripe), lit]) {
      expect(contrast(rgbOf(COLOR.line), under)).toBeGreaterThanOrEqual(3);
      expect(contrast(rgbOf(COLOR.outlineDark), under)).toBeGreaterThanOrEqual(3);
    }
  });

  // DESIGN.md Team colors (Broadcast, 2026-11-15), typed in: the slot fills and "Swatch on panel".
  const SWATCH_TABLE: readonly [number, string, string, number][] = [
    [0, "#F29A2E", "orange", 7.41],
    [1, "#C62F2F", "red", 3.02],
    [2, "#3263D2", "blue", 3.02],
    [3, "#C3CCD3", "neutral", 10.13],
    [4, "#1D1E22", "neutral", 1.01],
    [5, "#7A4EBA", "purple", 2.85],
    [6, "#B99BE8", "purple", 7.0],
    [7, "#45A8E6", "blue", 6.28],
  ];
  it.each(SWATCH_TABLE)("swatch slot %d (%s, %s) is %d on panel (+-0.05)", (slot, hex, _family, figure) => {
    expect(SWATCHES[slot]?.toUpperCase()).toBe(hex);
    expect(Math.abs(c(hex, COLOR.panel) - figure)).toBeLessThanOrEqual(0.05);
  });

  it("the swatches on the navy panel span 1.01 to 10.13", () => {
    const r = SWATCHES.map((s) => c(s, COLOR.panel));
    expect(Math.abs(Math.min(...r) - 1.01)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(Math.max(...r) - 10.13)).toBeLessThanOrEqual(0.05);
  });

  it("each slot's ring and end zone are DESIGN.md's: dark tier takes color.line, light tier color.outlineDark", () => {
    expect([...TEAM_OUTLINE].map((x) => x.toUpperCase())).toEqual(["outlineDark", "line", "line", "outlineDark", "line", "line", "outlineDark", "outlineDark"].map((k) => COLOR[k as "line" | "outlineDark"].toUpperCase()));
    expect([...TEAM_END_ZONE].map((x) => x.toUpperCase())).toEqual(["#B85A1E", "#CC4A3C", "#3263D2", "#5E6B78", "#62666C", "#7A4EBA", "#7656B0", "#1F6FA8"]);
  });

  it("panelRaise is #1B3260 and the panel is navy #0F1E3D (DESIGN.md Stadium grass)", () => {
    expect(COLOR.panelRaise.toUpperCase()).toBe("#1B3260");
    expect(COLOR.panel.toUpperCase()).toBe("#0F1E3D");
  });
});

describe("AC 2: the panel is the opaque dark board (U1)", () => {
  const rgba = (s: string): number[] => (s.match(/[\d.]+/g) ?? []).map(Number);
  it("overlayBackground() is COLOR.panel at alpha 1", () => {
    const [r, g, b, a] = rgba(overlayBackground());
    expect([r, g, b]).toEqual([...rgbOf(COLOR.panel)]);
    expect(a ?? 1).toBe(1);
  });
  it("chalk and chalkSoft on overlayBackground() are at least 4.5:1", () => {
    const [r, g, b] = rgba(overlayBackground()) as [number, number, number];
    expect(contrast(rgbOf(COLOR.chalk), [r, g, b])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgbOf(COLOR.chalkSoft), [r, g, b])).toBeGreaterThanOrEqual(4.5);
  });
});

// ---------------------------------------------------------------- AC 3: swatches

describe("AC 3: matchupSwatches always gives two different swatches (U4)", () => {
  // DESIGN.md Team colors (Broadcast), typed in.
  const FAMILY: Readonly<Record<string, string>> = {
    "#F29A2E": "orange",
    "#C62F2F": "red",
    "#3263D2": "blue",
    "#C3CCD3": "neutral",
    "#1D1E22": "neutral",
    "#7A4EBA": "purple",
    "#B99BE8": "purple",
    "#45A8E6": "blue",
  };
  const ORDER = Object.keys(FAMILY);
  const fam = (hex: string): string => FAMILY[hex.toUpperCase()] ?? `unknown ${hex}`;
  const pairs = Array.from({ length: 64 }, (_, i) => [Math.floor(i / 8), i % 8] as const);

  it.each(pairs)("away %d, home %d: different families and a luminance ratio of at least 1.4", (a, h) => {
    const m = matchupSwatches(a, h);
    expect(fam(m.away)).not.toBe(fam(m.home));
    expect(c(m.away, m.home)).toBeGreaterThanOrEqual(1.4);
  });

  it("away is SWATCHES[away mod 8] and home is the first slot from home onward that passes the rule", () => {
    for (const [a, h] of pairs) {
      const away = ORDER[a] as string;
      let home: string | undefined;
      for (let k = 0; k < 8 && home === undefined; k++) {
        const cand = ORDER[(h + k) % 8] as string;
        if (FAMILY[cand] !== FAMILY[away] && c(cand, away) >= 1.4) home = cand;
      }
      const m = matchupSwatches(a, h);
      expect(m.away.toUpperCase(), `away ${a}`).toBe(away);
      expect(m.home.toUpperCase(), `away ${a} home ${h}`).toBe(home);
    }
  });

  it("indices past 8 wrap (mod 8), as league indices can be up to 31", () => {
    for (const [a, h] of [[9, 2], [17, 30], [31, 8]] as const) expect(matchupSwatches(a, h)).toEqual(matchupSwatches(a % 8, h % 8));
  });

  // DESIGN.md Broadcast: there is no green family (a green team would vanish on grass), so red
  // never meets green, the pair red-green color blindness confuses most.
  it("no slot is green, so a matchup never pairs red with green", () => {
    expect(new Set(Object.values(FAMILY)).has("green")).toBe(false);
    expect(SWATCH_FAMILY).not.toContain("green");
    for (const [a, h] of pairs) {
      const m = matchupSwatches(a, h);
      expect([fam(m.away), fam(m.home)], `away ${a} home ${h}`).not.toContain("green");
    }
  });

  // DESIGN.md Broadcast: black (1.01) and purple (2.85) fall under 3:1 on navy, so every chip and
  // swatch carries a 1 px inset ring of rgba(255, 255, 255, 0.35); the team name is always beside it.
  it("every swatch's edge, its fill or its inset ring, is at least 3.0:1 on COLOR.panel, and the CSS draws the ring", () => {
    expect(SWATCHES).toHaveLength(8);
    for (const s of SWATCHES) {
      const ring = blend([255, 255, 255], rgbOf(s), 0.35);
      expect(Math.max(c(s, COLOR.panel), contrast(ring, rgbOf(COLOR.panel))), s).toBeGreaterThanOrEqual(3.0);
    }
    const css = readFileSync(join(root, "packages/app/src/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // DESIGN.md Prime Time: the bug's team chip became the name plate (hud.teamSwatch in the bug), same ring.
    for (const sel of [".swatch", ".plate"]) {
      const body = new RegExp(`(?:^|\\n|\\})\\s*\\${sel}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
      expect(body.replace(/\s+/g, " "), sel).toContain("box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35)");
    }
  });

  it("app.ts no longer calls swatchFor directly", () => {
    const src = readFileSync(join(root, "packages/app/src/ui/app.ts"), "utf8");
    expect(src).not.toMatch(/\bswatchFor\s*\(/);
    expect(src).toMatch(/\bmatchupSwatches\s*\(/);
  });
});

// ---------------------------------------------------------------- AC 4, 5: menu headings

describe("AC 4, 5: menu headings and the So far line (U3)", () => {
  const catalog = read("data/calls/catalog.json") as Catalog;
  const data: MenuData = { catalog, labels: { ...catalogLabels(catalog), shotgun: "Shotgun" } };
  const at_ = (screens: string[], picks: string[] = []): MenuState => ({ request: { seq: 0, kind: "offenseCall", screens: [] } as unknown as DecisionRequest, screens, picks });

  const HEADINGS: Readonly<Record<string, string>> = {
    "offense.playType": "Play type",
    "offense.playType.try": "Two-point try: play type",
    "offense.formation": "Formation",
    "offense.playClass": "Run or pass",
    "offense.run": "Run plays",
    "offense.pass": "Pass plays",
    "offense.kick": "Kick",
    "offense.clock": "Clock and tempo",
    "offense.try": "After the touchdown",
    kickoff: "Kickoff",
    "defense.package": "Defensive package",
    "defense.base": "Base plays",
    "defense.nickel": "Nickel plays",
    "defense.dime": "Dime plays",
    "defense.specials": "Specials",
  };
  it.each(Object.entries(HEADINGS))("title() on %s is %s", (id, heading) => {
    expect(title(at_([id]))).toBe(heading);
  });

  const games = [playGame(21, "home"), playGame(22, "away")];
  const requests = games.flatMap((g) => g.requests);
  const allIds = [...new Set(requests.flatMap((r) => r.screens.map((s) => s.id)))];

  it("no heading on any screen of the engine's real requests contains 'Offense:' or 'Defense:'", () => {
    expect(allIds.length).toBeGreaterThan(10);
    for (const id of allIds) {
      expect(title(at_([id])), id).not.toMatch(/Offense:|Defense:/i);
      expect(title(at_([id])).length, id).toBeGreaterThan(0);
    }
  });

  // Walk a real request by option ids, as the player would.
  function walk(r: DecisionRequest, ids: readonly string[]): MenuState {
    let m = openMenu(r);
    for (const id of ids) {
      const scr = m.request.screens.find((s) => s.id === m.screens[m.screens.length - 1]);
      const i = scr?.options.findIndex((o) => o.id === id) ?? -1;
      if (i < 0) throw new Error(`no option ${id} on ${m.screens[m.screens.length - 1]}: ${scr?.options.map((o) => o.id).join(",")}`);
      m = press(m, String(i + 1) as MenuKey, data).menu;
    }
    return m;
  }
  const offenseReq = requests.find((r) => r.kind === "offenseCall" && r.screens[0]?.id === "offense.playType" && r.screens[0].options.some((o) => o.id === "formation" && o.legal));
  const tryReq = requests.find((r) => r.kind === "try" && r.screens[0]?.options.some((o) => o.id === "goForTwo" && o.legal));
  const defenseReq = requests.find((r) => r.kind === "defenseCall");

  it("playType > Formation > Shotgun > Run: heading 'Run plays', So far 'Shotgun'", () => {
    if (offenseReq === undefined) throw new Error("no offense request with a formation option");
    const m = walk(offenseReq, ["formation", "shotgun", "run"]);
    expect(m.screens[m.screens.length - 1]).toBe("offense.run");
    expect(title(m)).toBe("Run plays");
    expect(breadcrumb(m, data)).toBe("Shotgun");
  });

  it("the Formation screen reads 'Formation' with no So far line (no 'Formation: Formation')", () => {
    if (offenseReq === undefined) throw new Error("no offense request with a formation option");
    const m = walk(offenseReq, ["formation"]);
    expect(title(m)).toBe("Formation");
    expect(breadcrumb(m, data)).toBe("");
  });

  it("try > Go for two > playType > Formation > Shotgun > Pass gives 'Go for two, Shotgun'", () => {
    if (tryReq === undefined) throw new Error("no try request with go for two");
    // From the try screen: go for two, then the try's play type screen, formation, shotgun, pass.
    const m = walk(tryReq, ["goForTwo", "formation", "shotgun", "pass"]);
    expect(m.screens[m.screens.length - 1]).toBe("offense.pass");
    expect(title(m)).toBe("Pass plays");
    expect(breadcrumb(m, data)).toBe("Go for two, Shotgun");
  });

  it("the same paths built by hand give the same So far text (picks[i] is the pick on screens[i])", () => {
    expect(breadcrumb(at_(["offense.playType", "offense.formation", "offense.playClass", "offense.run"], ["formation", "shotgun", "run"]), data)).toBe("Shotgun");
    expect(breadcrumb(at_(["offense.try", "offense.playType.try", "offense.formation", "offense.playClass", "offense.pass"], ["goForTwo", "formation", "shotgun", "pass"]), data)).toBe("Go for two, Shotgun");
  });

  it("a defense path gives ''", () => {
    if (defenseReq === undefined) throw new Error("no defense request");
    const pkg = defenseReq.screens[0]?.options.find((o) => o.legal && o.opens !== undefined);
    if (pkg === undefined) throw new Error("no package option");
    const m = walk(defenseReq, [pkg.id]);
    expect(breadcrumb(m, data)).toBe("");
    expect(title(m)).not.toMatch(/Defense:/);
    expect(breadcrumb(at_(["defense.package", "defense.nickel"], ["nickel"]), data)).toBe("");
  });
});

// ---------------------------------------------------------------- AC 6: placement

describe("AC 6: placeOverlay in side mode fills the side column (U1)", () => {
  it("at 1280x720: left = side.left, top = field.top, width = side.width, maxHeight = field.height, fill", () => {
    expect(L1280.side).not.toBeNull();
    const side = L1280.side as { left: number; width: number };
    const guard: Guard = { los: 40, lineToGain: 50, side: "offense", depth: 8 };
    for (const g of [null, guard]) {
      const p = placeOverlay(L1280, 60, g, 1.4, 300);
      expect(p.left).toBe(side.left);
      expect(p.top).toBe(L1280.field.top);
      expect(p.width).toBe(side.width);
      expect(p.maxHeight).toBe(L1280.field.height);
      expect(p.fill).toBe(true);
    }
  });
  it("floating mode (no side column) doesn't fill", () => {
    const narrow = layoutFor(800, 520, templates.field);
    expect(narrow.side).toBeNull();
    expect(placeOverlay(narrow, 60, null, 1.4).fill).toBe(false);
  });
});

// ---------------------------------------------------------------- AC 7: huddle

describe("AC 7: the huddle is a horseshoe opening toward the ball (U6)", () => {
  it("motion.json moves the centers: offenseBehind 9, defensePast 10", () => {
    expect(motionJson.huddle.offenseBehind).toBe(9);
    expect(motionJson.huddle.defensePast).toBe(10);
    expect(motion.huddle.offenseBehind).toBe(9);
    expect(motion.huddle.defensePast).toBe(10);
  });

  const px = L1280.s;
  const markPx = L1280.markPx;
  const gap = motion.huddle.markGapPx;
  const chord = (markPx + gap) / px;
  const spots = (n: number, side: "O" | "X", los: number) => huddleSpots(n, side, los, px, markPx, motion.huddle.offenseBehind, motion.huddle.defensePast, gap, 10);

  for (const side of ["O", "X"] as const) {
    for (const n of [11, 10, 7]) {
      it(`${side}, ${n} players at 1280x720: n points on one ring, adjacent spacing at least the chord, opening on the line side`, () => {
        const los = 40;
        const pts = spots(n, side, los);
        expect(pts).toHaveLength(n);
        const cy = side === "O" ? los - motion.huddle.offenseBehind : los + motion.huddle.defensePast;
        const rs = pts.map((p) => Math.hypot(p.x - MID_X, p.y - cy));
        const r = rs[0] as number;
        for (const ri of rs) expect(ri).toBeCloseTo(r, 6);
        // The opening place points straight at the line of scrimmage.
        const open = { x: MID_X, y: side === "O" ? cy + r : cy - r };
        for (const p of pts) expect(Math.hypot(p.x - open.x, p.y - open.y)).toBeGreaterThanOrEqual(chord / 2 - 1e-6);
        // Adjacent around the ring (by angle from the opening), never across the opening.
        const ang = (p: { x: number; y: number }): number => {
          const a0 = Math.atan2(open.y - cy, open.x - MID_X);
          const a = Math.atan2(p.y - cy, p.x - MID_X) - a0;
          return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        };
        const sorted = [...pts].sort((p, q) => ang(p) - ang(q));
        for (let i = 1; i < sorted.length; i++) {
          const a = sorted[i - 1] as { x: number; y: number };
          const b = sorted[i] as { x: number; y: number };
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(chord - 1e-6);
        }
        // The empty place: the two ends of the horseshoe sit about two places apart.
        const ends = Math.hypot((sorted[0] as { x: number }).x - (sorted[n - 1] as { x: number }).x, (sorted[0] as { y: number }).y - (sorted[n - 1] as { y: number }).y);
        expect(ends).toBeGreaterThan(chord * 1.5);
      });
    }
  }

  it("for X at 1280x720 scale every point is at least 6 yards past the line, about 7 for the nearest", () => {
    const los = 40;
    const pts = spots(11, "X", los);
    const near = Math.min(...pts.map((p) => p.y - los));
    expect(near).toBeGreaterThanOrEqual(6);
    expect(near).toBeGreaterThan(6.4);
    expect(near).toBeLessThan(7.6);
  });

  it("at 1280x720 the 11-mark ring has about a 3.3-yard radius", () => {
    const los = 40;
    const pts = spots(11, "X", los);
    const r = Math.hypot((pts[0] as { x: number }).x - MID_X, (pts[0] as { y: number }).y - (los + 10));
    expect(Math.abs(r - 3.3)).toBeLessThanOrEqual(0.2);
  });

  it("the offense's huddle is behind the line, the opening facing it", () => {
    const pts = spots(11, "O", 40);
    for (const p of pts) expect(p.y).toBeLessThan(40);
  });

  it("the end-line clamp stays: a huddle deep in the end zone stays inside the end lines", () => {
    for (const p of spots(11, "X", 97)) expect(p.y).toBeLessThanOrEqual(110);
    for (const p of spots(11, "O", 2)) expect(p.y).toBeGreaterThanOrEqual(-10);
  });
});

describe("U6: the 'Huddle' label (field.huddleLabel)", () => {
  const calling = (textScale = 1) => {
    const frame = callingFrame({ side: "offense", los: 40, firstDown: 50, unit: "shotgun", call: null, lineups: undefined, counts: personnel.offense["shotgun"] as Record<string, number>, opponentCount: 11, templates, motion, pxPerYard: L1280.s, markPx: L1280.markPx, endZoneYards: 10 });
    const r = recorder();
    drawFrame(r.g, viewAt(40), frame, 0, frameOpts({ textScale }));
    return { frame, ...r };
  };

  /** The label's box in canvas px, from where and how it was drawn (the stub measures 7 px a character). */
  const boxOf = (t: Text, px: number): { x0: number; x1: number; y0: number; y1: number } => {
    const w = t.text.length * 7;
    const x0 = t.align === "center" ? t.x - w / 2 : t.align === "right" || t.align === "end" ? t.x - w : t.x;
    const y0 = t.baseline === "middle" ? t.y - px / 2 : t.baseline === "top" || t.baseline === "hanging" ? t.y : t.y - px;
    return { x0, x1: x0 + w, y0, y1: y0 + px };
  };
  const frameAt = (side: "offense" | "defense", los: number, firstDown: number | null) =>
    side === "offense"
      ? callingFrame({ side, los, firstDown, unit: "shotgun", call: null, lineups: undefined, counts: personnel.offense["shotgun"] as Record<string, number>, opponentCount: 11, templates, motion, pxPerYard: L1280.s, markPx: L1280.markPx, endZoneYards: 10 })
      : callingFrame({ side, los, firstDown, unit: "nickel", call: null, lineups: undefined, counts: (read("data/engine/personnel.json") as { packages: Record<string, Record<string, number>> }).packages["nickel"] as Record<string, number>, opponentCount: 11, templates, motion, pxPerYard: L1280.s, markPx: L1280.markPx, endZoneYards: 10 });
  const labelIn = (side: "offense" | "defense", los: number, firstDown: number | null) => {
    const frame = frameAt(side, los, firstDown);
    const v = viewAt(los);
    const r = recorder();
    drawFrame(r.g, v, frame, 0, frameOpts());
    return { frame, v, labels: r.texts.filter((t) => t.text === "Huddle"), strokes: r.strokedTexts, pills: r.pills };
  };
  /** The label's tag pill as a box (DESIGN.md Broadcast: the pill is the label's footprint, 18 px tall, 6 px padding). */
  const pillBox = (t: Text, pills: readonly Pill[]): { x0: number; x1: number; y0: number; y1: number } => {
    const p = tagUnder(t, pills);
    expect(p, `tag under ${t.text}`).toBeDefined();
    const q = p as Pill;
    return { x0: q.x, x1: q.x + q.w, y0: q.y, y1: q.y + q.h };
  };
  /** The label box overlaps a field line at yard y, or a mark (circle of markPx / 2). */
  const conflicts = (bx: ReturnType<typeof boxOf>, frame: ReturnType<typeof frameAt>, v: ReturnType<typeof viewAt>, firstDown: number | null): string[] => {
    const out: string[] = [];
    const Y = (y: number): number => (v.cameraY - y) * v.s;
    const lines: [string, number][] = [["line of scrimmage", frame.los], ["goal line 0", 0], ["goal line 100", 100]];
    if (firstDown !== null) lines.push(["line to gain", firstDown]);
    for (const [name, y] of lines) if (Y(y) > bx.y0 && Y(y) < bx.y1) out.push(name);
    const r = v.markPx / 2;
    for (const m of frame.marks) {
      const p = at(m.keys, 0);
      const cx = v.ox + (1 + p.x) * v.s;
      const cy = Y(p.y);
      const nx = Math.max(bx.x0, Math.min(cx, bx.x1));
      const ny = Math.max(bx.y0, Math.min(cy, bx.y1));
      if (Math.hypot(nx - cx, ny - cy) < r) out.push(`mark ${m.playerId}`);
    }
    return out;
  };

  // DESIGN.md Broadcast: on-field tags are a color.tag pill, Inter 600 14 px color.line, 18 px tall, 6 px padding.
  it("a still Calling frame draws 'Huddle' once, in line on an 18 px color.tag pill, UI font 600 14 px", () => {
    expect(HUDDLE_LABEL).toBe("Huddle");
    const { labels, strokes, pills } = labelIn("offense", 40, null);
    expect(labels).toHaveLength(1);
    const lab = labels[0] as Text;
    expect(lab.style.toUpperCase()).toBe(COLOR.line.toUpperCase());
    expectTagged(labels, pills, strokes, 18, 6);
    expect(lab.font).toContain("600 14px");
    expect(lab.font).toContain(FONT_UI);
  });

  it("with no conflict it sits at the first spot: 1 yard right of the horseshoe's right edge, centered on it", () => {
    // 2nd & 3 at the 40 (line to gain at 43): the defense huddle (centered 10 yards past) is clear of every line.
    for (const firstDown of [null, 43]) {
      const { frame, v, labels, pills } = labelIn("offense", 40, firstDown);
      expect(labels, `firstDown ${firstDown}`).toHaveLength(1);
      const bx = pillBox(labels[0] as Text, pills);
      const huddle = frame.marks.filter((m) => m.huddle).map((m) => at(m.keys, 0));
      const xs = huddle.map((p) => v.ox + (1 + p.x) * v.s);
      const ys = huddle.map((p) => (v.cameraY - p.y) * v.s);
      const edge = Math.max(...xs) + v.markPx / 2;
      expect(Math.abs(bx.x0 - (edge + v.s)), "left edge 1 yard right of the horseshoe").toBeLessThanOrEqual(1);
      expect(Math.abs((bx.y0 + bx.y1) / 2 - (Math.min(...ys) + Math.max(...ys)) / 2), "vertically centered").toBeLessThanOrEqual(1);
    }
  });

  it("1st & 10 (the huddle's center on the line to gain): drawn, and clear of the line to gain, the LOS, the goal lines and every mark", () => {
    const { frame, v, labels, pills } = labelIn("offense", 40, 50);
    // Precondition: the first spot is taken here (it sits on the line to gain), so the rule must move it.
    const huddle = frame.marks.filter((m) => m.huddle).map((m) => at(m.keys, 0));
    const edge = Math.max(...huddle.map((p) => v.ox + (1 + p.x) * v.s)) + v.markPx / 2;
    const ys = huddle.map((p) => (v.cameraY - p.y) * v.s);
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const first = { x0: edge + v.s, x1: edge + v.s + 42, y0: cy - 7, y1: cy + 7 };
    expect(conflicts(first, frame, v, 50)).toContain("line to gain");
    expect(labels).toHaveLength(1);
    expect(conflicts(boxOf(labels[0] as Text, 14), frame, v, 50)).toEqual([]);
    expect(conflicts(pillBox(labels[0] as Text, pills), frame, v, 50)).toEqual([]);
  });

  it("whenever it is drawn, it is clear of every line and mark (both sides, across the field)", () => {
    const cases: ["offense" | "defense", number, number | null][] = [
      ["offense", 40, 50],
      ["offense", 25, 35],
      ["offense", 75, 85],
      ["offense", 92, null],
      ["offense", 97, null],
      ["defense", 40, 50],
      ["defense", 30, 31],
      ["defense", 9, 19],
      ["defense", 3, 10],
    ];
    for (const [side, los, fd] of cases) {
      const { frame, v, labels, pills } = labelIn(side, los, fd);
      expect(labels.length, `${side} ${los}`).toBeLessThanOrEqual(1);
      if (labels.length === 1) expect(conflicts(boxOf(labels[0] as Text, 14), frame, v, fd), `${side} at ${los}, line to gain ${fd}`).toEqual([]);
      if (labels.length === 1) expect(conflicts(pillBox(labels[0] as Text, pills), frame, v, fd), `${side} at ${los}, line to gain ${fd} (the pill)`).toEqual([]);
    }
  });

  it("scales with text size", () => {
    const lab = calling(1.5).texts.find((t) => t.text === "Huddle");
    expect(lab?.font).toContain("600 21px");
  });

  it("is not drawn in a play timeline, even while that side is still in its huddle", () => {
    // A scrimmage play with the human on offense: their defense starts in its huddle.
    const tl = timeline({ event: COMPLETE, runoffSeconds: 0, human: "offense" }, templates, { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: L1280.s, markPx: L1280.markPx, motion });
    expect(tl.marks.some((m) => m.huddle)).toBe(true);
    const r = recorder();
    drawFrame(r.g, viewAt(40), tl, 0, frameOpts());
    expect(r.texts.some((t) => t.text === "Huddle")).toBe(false);
  });
});

// ---------------------------------------------------------------- AC 9: settings

describe("AC 9: the label setting (U7, amended by Joseph: one label per mark)", () => {
  // Joseph's change to U7: "both" is gone. Values: "rating" (the overall, default) and "number".
  // Migration: saved "both" -> "rating"; legacy ratingLabels true -> "rating", false -> "number";
  // missing -> "rating".
  const original = (globalThis as { localStorage?: unknown }).localStorage;
  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = original;
  });
  /** A localStorage that holds one raw settings value under any key. */
  const storeWith = (raw: string | null): void => {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => raw, setItem: () => undefined, removeItem: () => undefined };
  };
  const lc = (): string => (loadSettings() as { labelContent: string }).labelContent;

  it("an old stored ratingLabels: true becomes labelContent 'rating'", () => {
    storeWith(JSON.stringify({ textSize: 125, reducedMotion: "on", markLabels: "all", speed: "2x", ratingLabels: true }));
    const s = loadSettings();
    expect(lc()).toBe("rating");
    // The other settings survive the migration.
    expect(s).toMatchObject({ textSize: 125, reducedMotion: "on", markLabels: "all", speed: "2x" });
    expect(s).not.toHaveProperty("ratingLabels");
  });

  it("an old stored ratingLabels: false becomes labelContent 'number'", () => {
    storeWith(JSON.stringify({ textSize: 100, ratingLabels: false }));
    expect(lc()).toBe("number");
  });

  it("a saved labelContent 'both' (removed) becomes 'rating'", () => {
    storeWith(JSON.stringify({ textSize: 100, labelContent: "both" }));
    expect(lc()).toBe("rating");
    storeWith(JSON.stringify({ textSize: 100, labelContent: "both", ratingLabels: false }));
    expect(lc()).toBe("rating");
  });

  it("the default labelContent is 'rating': nothing stored, the key missing, or blocked storage", () => {
    storeWith(null);
    expect(lc()).toBe("rating");
    expect((DEFAULT_SETTINGS as { labelContent: string }).labelContent).toBe("rating");
    storeWith(JSON.stringify({ textSize: 100 }));
    expect(lc()).toBe("rating");
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(lc()).toBe("rating");
  });

  it("'rating' and 'number' round-trip; an unknown value falls back to 'rating'", () => {
    const mem = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v) };
    for (const v of ["number", "rating"] as const) {
      saveSettings({ ...DEFAULT_SETTINGS, labelContent: v });
      expect(lc()).toBe(v);
    }
    storeWith(JSON.stringify({ labelContent: "jersey" }));
    expect(lc()).toBe("rating");
  });

  // Amended by docs/specs/m2-main-menu.md (decision 6): Animation speed is row 5, so 6 rows; then by
  // docs/specs/m2-calling-screen-pass.md (Q1): Auto-advance is row 6, so 7. The rows changed, not the rule.
  it("settingsScreen has 7 rows; row 4 is 'Mark label shows', noting Jersey number or Overall rating", () => {
    for (const [v, note] of [["number", "Jersey number"], ["rating", "Overall rating"]] as const) {
      const s = settingsScreen({ textSize: 100, reducedMotion: "system", markLabels: "involved", labelContent: v });
      expect(s.rows).toHaveLength(7);
      const r4 = s.rows[3];
      expect(r4?.key).toBe("4");
      expect(r4?.label).toBe("Mark label shows");
      expect(r4?.note).toBe(note);
    }
    // With no labelContent passed, the note is the default's.
    expect(settingsScreen({ textSize: 100, reducedMotion: "system", markLabels: "involved" }).rows[3]?.note).toBe("Overall rating");
  });
});

// ---------------------------------------------------------------- AC 10: mark labels

describe("AC 10: one label per mark (U7, amended)", () => {
  const mark = (id: string, x: number, y: number, over: Partial<MarkPx> = {}): MarkPx => ({ id, side: "O", x, y, ringed: false, named: false, number: 36, show: true, ...over });

  it("placeNumbers gives one label per box: the text alone, width labelWidth(text, numberPx), no second part", () => {
    for (const numberPx of [12, 18, 24]) {
      const boxes = placeNumbers([mark("a", 100, 100), mark("b", 300, 100, { number: 7 })], 14, numberPx);
      expect(boxes).toHaveLength(2);
      for (const b of boxes) {
        expect((b as { rating?: unknown }).rating).toBeUndefined();
        expect(b.w).toBeCloseTo(labelWidth(b.number, numberPx), 9);
      }
      expect(boxes.map((b) => b.number).sort()).toEqual(["36", "7"]);
    }
  });

  // Drawing: a whistle frame of a real play with both teams' ids in the maps. Offense ratings are
  // 50s, defense 70s, jersey numbers 1 to 22, so every drawn label says which map and side it is.
  const tl = timeline({ event: COMPLETE, runoffSeconds: 0 }, templates, { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: L1280.s, markPx: L1280.markPx, motion });
  const oIds = tl.marks.filter((m) => m.side === "O").map((m) => m.playerId);
  const xIds = tl.marks.filter((m) => m.side === "X").map((m) => m.playerId);
  const numbers = Object.fromEntries([...oIds, ...xIds].map((id, i) => [id, 1 + i]));
  const ratings = Object.fromEntries([...oIds.map((id, i) => [id, 50 + i]), ...xIds.map((id, i) => [id, 70 + i])]);
  const draw = (labelContent: FrameOpts["labelContent"]) => {
    const r = recorder();
    drawFrame(r.g, viewAt(COMPLETE.before.spot), tl, tl.total, frameOpts({ numbers, ratings, labelContent, markLabels: "all" }));
    const t = r.texts.filter((x) => /^\d+$/.test(x.text));
    // DESIGN.md Broadcast mark.label: a color.tag pill 14 px tall with 2 px horizontal padding.
    expectTagged(t, r.pills, r.strokedTexts, 14, 2);
    return t;
  };
  const numSet = new Set(Object.values(numbers).map(String));
  const oRat = new Set(oIds.map((id) => String(ratings[id])));
  const xRat = new Set(xIds.map((id) => String(ratings[id])));

  it("'number': jersey numbers only, Inter 600 12 px in line on a tag pill", () => {
    const t = draw("number");
    expect(t.length).toBeGreaterThan(0);
    for (const x of t) {
      expect(numSet.has(x.text), x.text).toBe(true);
      expect(x.style.toUpperCase()).toBe(COLOR.line.toUpperCase());
      expect(x.font).toContain("600 12px");
      expect(x.font).toContain(FONT_UI);
    }
  });

  it("'rating': the overall only, at the jersey number's size and weight (Inter 600 12 px), in line on a tag pill", () => {
    const t = draw("rating");
    const o = t.filter((x) => oRat.has(x.text));
    const xs = t.filter((x) => xRat.has(x.text));
    expect(o.length).toBeGreaterThan(0);
    expect(xs.length).toBeGreaterThan(0);
    // One label per mark: nothing drawn that isn't a rating, and no mark labeled twice.
    expect(t.length).toBe(o.length + xs.length);
    expect(new Set(t.map((x) => x.text)).size).toBe(t.length);
    for (const x of t) expect(x.style.toUpperCase()).toBe(COLOR.line.toUpperCase());
    for (const x of t) {
      expect(x.font).toContain("600 12px");
      expect(x.font).toContain(FONT_UI);
    }
  });

  it("'rating' scales with text size like the number does", () => {
    const r = recorder();
    drawFrame(r.g, viewAt(COMPLETE.before.spot), tl, tl.total, frameOpts({ numbers, ratings, labelContent: "rating", markLabels: "all", textScale: 1.5 }));
    const t = r.texts.filter((x) => /^\d+$/.test(x.text));
    expect(t.length).toBeGreaterThan(0);
    for (const x of t) expect(x.font).toContain("600 18px");
  });
});

// ---------------------------------------------------------------- AC 11: kickoff frame

describe("AC 11: kickoffFrame lines up both kickoff units (U8)", () => {
  const px = L1280.s;
  const base = { los: 35, humanKicks: true, templates, pxPerYard: px };

  it("returns 22 marks, 11 O and 11 X, on the template slots", () => {
    const f = kickoffFrame(base);
    expect(f.marks).toHaveLength(22);
    const o = f.marks.filter((m) => m.side === "O");
    const x = f.marks.filter((m) => m.side === "X");
    expect(o).toHaveLength(11);
    expect(x).toHaveLength(11);
    expect(o.map((m) => m.slot).sort()).toEqual(Object.keys(templates.kick["kickoff"] ?? {}).sort());
    expect(x.map((m) => m.slot).sort()).toEqual(Object.keys(templates.returnUnits["kickoff"] ?? {}).sort());
  });

  it("puts each mark at its template depth: kickers attack up from the spot, the return unit past it", () => {
    const f = kickoffFrame(base);
    for (const m of f.marks) {
      const tmpl = (m.side === "O" ? templates.kick["kickoff"] : templates.returnUnits["kickoff"]) ?? {};
      const pair = tmpl[m.slot] as readonly [number, number];
      const p = at(m.keys, 0);
      expect(p.y, m.slot).toBeCloseTo(m.side === "O" ? 35 - pair[1] : 35 + pair[1], 6);
    }
  });

  it("matches the live kickoff timeline's marks at t = 0 at the same layout, so the cut moves no mark", () => {
    const f = kickoffFrame(base);
    const tl = timeline({ event: KICKOFF_RETURN, runoffSeconds: 0 }, templates, { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: px, markPx: L1280.markPx, motion });
    for (const m of f.marks) {
      const live = tl.marks.find((x) => x.side === m.side && x.slot === m.slot);
      expect(live, `${m.side} ${m.slot}`).toBeDefined();
      const a = at(m.keys, 0);
      const b = at(live?.keys ?? [], 0);
      expect(a.x, `${m.side} ${m.slot} x`).toBeCloseTo(b.x, 6);
      expect(a.y, `${m.side} ${m.slot} y`).toBeCloseTo(b.y, 6);
    }
  });

  it("no mark id resolves to a jersey number: generic own: and huddle: ids only, and none drawn", () => {
    for (const humanKicks of [true, false]) {
      const f = kickoffFrame({ ...base, humanKicks });
      const ids = f.marks.map((m) => m.playerId);
      expect(new Set(ids).size).toBe(22);
      for (const id of ids) expect(id).toMatch(/^(own|huddle):/);
      // Real players' numbers in the map: the frame still draws no number or rating.
      const r = recorder();
      drawFrame(r.g, viewAt(35), f, 0, frameOpts({ numbers: { "H-K1": 4, "A-S1": 22 }, ratings: { "H-K1": 70, "A-S1": 66 }, labelContent: "rating", markLabels: "all" }));
      expect(r.texts.filter((t) => /^\d+$/.test(t.text))).toEqual([]);
    }
  });

  it("reads no field of a PlayResult: only the spot, who kicks, the templates and the scale", () => {
    const read_ = new Set<string>();
    const opts = new Proxy({ ...base, humanKicks: false }, {
      get(t, k: string) {
        read_.add(k);
        return (t as Record<string, unknown>)[k];
      },
    });
    const f = kickoffFrame(opts);
    expect(f.marks).toHaveLength(22);
    for (const k of read_) expect(["los", "humanKicks", "templates", "pxPerYard"], k).toContain(k);
    // And the frame is a still: it never reaches the set, the snap or a result label.
    expect(f.setAt).toBe(Infinity);
    expect(f.labels).toEqual([]);
    expect(f.paths).toEqual([]);
  });
});

// ---------------------------------------------------------------- U1: canvas outside the column

// Amended by DESIGN.md Broadcast (2026-11-15): "Outside the column, the canvas is transparent
// (clearRect), and the stage gradient shows from CSS. The canvas never paints the stage."
describe("U1, as amended by Broadcast: the canvas outside the field column is transparent", () => {
  it("drawField clears the canvas, paints nothing outside the column, sideline in the margin and the 5-yard turf band inside it", () => {
    const v = viewAt(40);
    expect(v.width).toBeGreaterThan(v.columnWidth);
    const r = recorder();
    drawField(r.g, v, scene, 1);
    const y = v.height / 2;
    expect(r.clears).toContainEqual({ x: 0, y: 0, w: v.width, h: v.height });
    // Left of the column (if any) and right of it: no fill, so the stage shows through.
    if (v.ox > 2) expect(paintedAt(r.fills, v.ox / 2, y)).toBeUndefined();
    expect(paintedAt(r.fills, v.ox + v.columnWidth + 2, y)).toBeUndefined();
    expect(paintedAt(r.fills, v.width - 2, y)).toBeUndefined();
    // The margin outside the left sideline: flat sideline.
    expect(paintedAt(r.fills, v.ox + v.s / 2, y)).toBe(COLOR.sideline);
    // Inside the sidelines: the mowing band, turf at each goal line, alternating toward the 50.
    for (const yard of [2, 7, 12, 47, 52, 88, 97]) {
      const k = Math.floor((yard < 50 ? yard : 99 - yard) / 5);
      const cy = (v.cameraY - yard) * v.s;
      const want = k % 2 === 0 ? COLOR.turf : COLOR.turfStripe;
      expect(paintedAt(r.fills, v.ox + v.columnWidth / 2 + 3, cy), `yard ${yard}`).toBe(want);
    }
  });
});

// ---------------------------------------------------------------- U9: title screen and copy

describe("U9: new game with a save, and out-of-date copy", () => {
  it("with a save, row 1 reads Quick play with the note 'replaces your saved game'; no confirm step", () => {
    const s = titleScreen({ hasSave: true, storage: true });
    expect(s.rows[0]?.key).toBe("1");
    expect(s.rows[0]?.label).toBe("Quick play");
    expect(s.rows[0]?.note).toBe("replaces your saved game");
    expect(s.rows[0]?.action).toBe("newGame");
  });
  it("without a save, there is no note", () => {
    expect(titleScreen({ hasSave: false, storage: true }).rows[0]?.note).toBeUndefined();
  });
  it("app.ts drops 'Challenges aren't in the game yet.' and the engine-names copy", () => {
    const src = readFileSync(join(root, "packages/app/src/ui/app.ts"), "utf8");
    expect(src).not.toContain("Challenges aren't in the game yet");
    expect(src).not.toContain("the engine doesn't name the players in each play yet");
  });
});
