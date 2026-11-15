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
import { contrast, overlayBackground, placeOverlay, rgbOf, type Guard } from "../src/ui/overlay";
import { callingFrame, kickoffFrame } from "../src/ui/presnap";
import { settingsScreen, titleScreen } from "../src/ui/screens";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../src/ui/storage";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { catalogLabels } from "../src/ui/text";
import { at, timeline } from "../src/ui/timeline";
import { COLOR, FONT_MONO, FONT_UI, matchupSwatches, SWATCHES } from "../src/ui/tokens";
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

function recorder(): { g: CanvasRenderingContext2D; fills: Fill[]; texts: Text[] } {
  const fills: Fill[] = [];
  const texts: Text[] = [];
  const state: Record<string, unknown> = { fillStyle: "#000000", font: "10px sans-serif", globalAlpha: 1, textAlign: "start", textBaseline: "alphabetic" };
  const g = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === "measureText") return (s: string) => ({ width: s.length * 7 });
      if (prop === "fillRect") return (x: number, y: number, w: number, h: number) => fills.push({ x, y, w, h, style: String(target["fillStyle"]) });
      if (prop === "fillText") return (text: string, x: number, y: number) => texts.push({ text, x, y, style: String(target["fillStyle"]), font: String(target["font"]), align: String(target["textAlign"]), baseline: String(target["textBaseline"]) });
      if (prop === "getLineDash") return () => [];
      return () => undefined;
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { g, fills, texts };
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
    // Spec, Accessibility baseline, and DESIGN.md contrast checks.
    ["chalk on panel", COLOR.chalk, COLOR.panel, 13.1],
    ["chalkSoft on panel", COLOR.chalkSoft, COLOR.panel, 6.9],
    ["ink on paper", COLOR.ink, COLOR.paper, 13.5],
    ["inkSoft on paper", COLOR.inkSoft, COLOR.paper, 5.5],
    ["inkSoft on paperShade (off card labels)", COLOR.inkSoft, COLOR.paperShade, 4.6],
    ["chalk focus ring on panel", COLOR.chalk, COLOR.panel, 13.1],
    ["paper fill (highlighted row) against panel", COLOR.paper, COLOR.panel, 13.1],
    ["chalkSoft bar fill on panelRaise track", COLOR.chalkSoft, COLOR.panelRaise, 5.4],
    ["panelRaise on panel", COLOR.panelRaise, COLOR.panel, 1.28],
    ["chalk on panelRaise", COLOR.chalk, COLOR.panelRaise, 10.3],
    ["signal on panel", COLOR.signal, COLOR.panel, 7.9],
    ["ink on end zone", COLOR.ink, COLOR.paperShade, 11.4],
    ["inkSoft on end zone", COLOR.inkSoft, COLOR.paperShade, 4.6],
    ["offense on paper", COLOR.offense, COLOR.paper, 6.5],
    ["offense on end zone", COLOR.offense, COLOR.paperShade, 5.5],
    ["defense on paper", COLOR.defense, COLOR.paper, 5.4],
    ["defense on end zone", COLOR.defense, COLOR.paperShade, 4.6],
    ["ball on paper", COLOR.ball, COLOR.paper, 6.6],
    ["line on paper", COLOR.line, COLOR.paper, 3.5],
    ["signal on paper", COLOR.signal, COLOR.paper, 1.7],
    ["ink against signal", COLOR.ink, COLOR.signal, 8.1],
    ["offense against defense", COLOR.offense, COLOR.defense, 1.19],
    // U4: swatch pairs.
    ["sky against green (lowest passing pair)", "#6FA8E8", "#3A9A4A", 1.43],
    ["red against green (fails the rule)", "#D9443A", "#3A9A4A", 1.22],
  ];
  it.each(FIGURES)("%s is %d (+-0.05)", (_label, a, b, figure) => {
    expect(Math.abs(c(a, b) - figure)).toBeLessThanOrEqual(0.05);
  });

  // U4's table, typed in from the spec.
  const SWATCH_TABLE: readonly [number, string, string, number][] = [
    [0, "#D9443A", "red", 3.39],
    [1, "#6FA8E8", "blue", 5.92],
    [2, "#3A9A4A", "green", 4.14],
    [3, "#C9CED2", "neutral", 9.28],
    [4, "#9A5CC8", "purple", 3.32],
    [5, "#8CC85A", "green", 7.38],
    [6, "#279490", "blue", 4.01],
    [7, "#F59A8C", "red", 6.93],
  ];
  it.each(SWATCH_TABLE)("swatch slot %d (%s, %s) is %d on panel (+-0.05)", (slot, hex, _family, figure) => {
    expect(SWATCHES[slot]?.toUpperCase()).toBe(hex);
    expect(Math.abs(c(hex, COLOR.panel) - figure)).toBeLessThanOrEqual(0.05);
  });

  it("the swatches on panel span 3.31 to 9.25 (Accessibility baseline, amended)", () => {
    const r = SWATCHES.map((s) => c(s, COLOR.panel));
    expect(Math.abs(Math.min(...r) - 3.31)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(Math.max(...r) - 9.25)).toBeLessThanOrEqual(0.05);
  });

  it("panelRaise is the new token #2E3B42 and the panel is #1F2A30", () => {
    expect(COLOR.panelRaise.toUpperCase()).toBe("#2E3B42");
    expect(COLOR.panel.toUpperCase()).toBe("#1F2A30");
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
  const FAMILY: Readonly<Record<string, string>> = {
    "#D9443A": "red",
    "#6FA8E8": "blue",
    "#3A9A4A": "green",
    "#C9CED2": "neutral",
    "#9A5CC8": "purple",
    "#8CC85A": "green",
    "#279490": "blue",
    "#F59A8C": "red",
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

  it("never pairs red #D9443A with green #3A9A4A (the pair red-green color blindness confuses most)", () => {
    for (const [a, h] of pairs) {
      const m = matchupSwatches(a, h);
      expect([m.away.toUpperCase(), m.home.toUpperCase()].sort().join("+"), `away ${a} home ${h}`).not.toBe("#3A9A4A+#D9443A");
    }
  });

  it("every SWATCHES entry is at least 3.0:1 on COLOR.panel", () => {
    expect(SWATCHES).toHaveLength(8);
    for (const s of SWATCHES) expect(c(s, COLOR.panel), s).toBeGreaterThanOrEqual(3.0);
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
    return { frame, v, labels: r.texts.filter((t) => t.text === "Huddle") };
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

  it("a still Calling frame draws 'Huddle' once, in inkSoft, UI font 600 14 px", () => {
    expect(HUDDLE_LABEL).toBe("Huddle");
    const { labels } = labelIn("offense", 40, null);
    expect(labels).toHaveLength(1);
    const lab = labels[0] as Text;
    expect(lab.style.toUpperCase()).toBe(COLOR.inkSoft.toUpperCase());
    expect(lab.font).toContain("600 14px");
    expect(lab.font).toContain(FONT_UI);
  });

  it("with no conflict it sits at the first spot: 1 yard right of the horseshoe's right edge, centered on it", () => {
    // 2nd & 3 at the 40 (line to gain at 43): the defense huddle (centered 10 yards past) is clear of every line.
    for (const firstDown of [null, 43]) {
      const { frame, v, labels } = labelIn("offense", 40, firstDown);
      expect(labels, `firstDown ${firstDown}`).toHaveLength(1);
      const bx = boxOf(labels[0] as Text, 14);
      const huddle = frame.marks.filter((m) => m.huddle).map((m) => at(m.keys, 0));
      const xs = huddle.map((p) => v.ox + (1 + p.x) * v.s);
      const ys = huddle.map((p) => (v.cameraY - p.y) * v.s);
      const edge = Math.max(...xs) + v.markPx / 2;
      expect(Math.abs(bx.x0 - (edge + v.s)), "left edge 1 yard right of the horseshoe").toBeLessThanOrEqual(1);
      expect(Math.abs((bx.y0 + bx.y1) / 2 - (Math.min(...ys) + Math.max(...ys)) / 2), "vertically centered").toBeLessThanOrEqual(1);
    }
  });

  it("1st & 10 (the huddle's center on the line to gain): drawn, and clear of the line to gain, the LOS, the goal lines and every mark", () => {
    const { frame, v, labels } = labelIn("offense", 40, 50);
    // Precondition: the first spot is taken here (it sits on the line to gain), so the rule must move it.
    const huddle = frame.marks.filter((m) => m.huddle).map((m) => at(m.keys, 0));
    const edge = Math.max(...huddle.map((p) => v.ox + (1 + p.x) * v.s)) + v.markPx / 2;
    const ys = huddle.map((p) => (v.cameraY - p.y) * v.s);
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const first = { x0: edge + v.s, x1: edge + v.s + 42, y0: cy - 7, y1: cy + 7 };
    expect(conflicts(first, frame, v, 50)).toContain("line to gain");
    expect(labels).toHaveLength(1);
    expect(conflicts(boxOf(labels[0] as Text, 14), frame, v, 50)).toEqual([]);
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
      const { frame, v, labels } = labelIn(side, los, fd);
      expect(labels.length, `${side} ${los}`).toBeLessThanOrEqual(1);
      if (labels.length === 1) expect(conflicts(boxOf(labels[0] as Text, 14), frame, v, fd), `${side} at ${los}, line to gain ${fd}`).toEqual([]);
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

  it("settingsScreen still has 5 rows; row 4 is 'Mark label shows', noting Jersey number or Overall rating", () => {
    for (const [v, note] of [["number", "Jersey number"], ["rating", "Overall rating"]] as const) {
      const s = settingsScreen({ textSize: 100, reducedMotion: "system", markLabels: "involved", labelContent: v });
      expect(s.rows).toHaveLength(5);
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
    return r.texts.filter((t) => /^\d+$/.test(t.text));
  };
  const numSet = new Set(Object.values(numbers).map(String));
  const oRat = new Set(oIds.map((id) => String(ratings[id])));
  const xRat = new Set(xIds.map((id) => String(ratings[id])));

  it("'number': jersey numbers only, mono 600 12 px in the side color", () => {
    const t = draw("number");
    expect(t.length).toBeGreaterThan(0);
    for (const x of t) {
      expect(numSet.has(x.text), x.text).toBe(true);
      expect([COLOR.offense, COLOR.defense].map((c_) => c_.toUpperCase())).toContain(x.style.toUpperCase());
      expect(x.font).toContain("600 12px");
      expect(x.font).toContain(FONT_MONO);
    }
  });

  it("'rating': the overall only, at the jersey number's size and weight (mono 600 12 px), in the side color", () => {
    const t = draw("rating");
    const o = t.filter((x) => oRat.has(x.text));
    const xs = t.filter((x) => xRat.has(x.text));
    expect(o.length).toBeGreaterThan(0);
    expect(xs.length).toBeGreaterThan(0);
    // One label per mark: nothing drawn that isn't a rating, and no mark labeled twice.
    expect(t.length).toBe(o.length + xs.length);
    expect(new Set(t.map((x) => x.text)).size).toBe(t.length);
    for (const x of o) expect(x.style.toUpperCase()).toBe(COLOR.offense.toUpperCase());
    for (const x of xs) expect(x.style.toUpperCase()).toBe(COLOR.defense.toUpperCase());
    for (const x of t) {
      expect(x.font).toContain("600 12px");
      expect(x.font).toContain(FONT_MONO);
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

describe("U1: the canvas outside the field column is the dark board", () => {
  it("drawField paints panel outside the column and paper inside it", () => {
    const v = viewAt(40);
    expect(v.width).toBeGreaterThan(v.columnWidth);
    const r = recorder();
    drawField(r.g, v, scene, 1);
    const y = v.height / 2;
    // Left of the column (if any) and right of it, into the side column.
    if (v.ox > 2) expect(paintedAt(r.fills, v.ox / 2, y)).toBe(COLOR.panel);
    expect(paintedAt(r.fills, v.ox + v.columnWidth + 2, y)).toBe(COLOR.panel);
    expect(paintedAt(r.fills, v.width - 2, y)).toBe(COLOR.panel);
    // Inside the column, between the sidelines at midfield height: paper.
    expect(paintedAt(r.fills, v.ox + v.columnWidth / 2 + 3, y)).toBe(COLOR.paper);
  });
});

// ---------------------------------------------------------------- U9: title screen and copy

describe("U9: new game with a save, and out-of-date copy", () => {
  it("with a save, row 1 reads New game with the note 'replaces your saved game'; no confirm step", () => {
    const s = titleScreen({ hasSave: true, storage: true });
    expect(s.rows[0]?.key).toBe("1");
    expect(s.rows[0]?.label).toBe("New game");
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
