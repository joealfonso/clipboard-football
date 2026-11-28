// Spec tests for docs/specs/m2-main-menu.md (acceptance criteria MM1 to MM25 and "Tests to add or
// change") and the "Main menu" section of DESIGN.md (art-director, 2026-11-15), written by
// test-writer from the spec, not the implementation. Expected strings, sizes and thresholds are
// typed in from the two documents.
//
// Where DESIGN.md's art-director entry changes the spec, DESIGN.md wins (spec Open 3 hands those
// calls to art-director): the art hides when its column is under 360 px (not "frame under 880 px"),
// the gold rule sits under the main menu wordmark only, and the splash has no first-down line.
//
// There is no jsdom in the repo, so this file covers what runs in node: the pure functions in
// mode.ts, splash.ts, screens.ts and storage.ts, the splash drawing through a recording canvas
// context, and static checks of index.html and styles.css. The DOM-only criteria are listed in the
// test-writer report, not faked here.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { slotsFromCounts, offenseArt, defenseArt } from "../src/ui/art";
import { drawField, drawFrame } from "../src/ui/field";
import { COLUMN_YARDS } from "../src/ui/layout";
import { regionsHidden, uiMode } from "../src/ui/mode";
import {
  controlsScreen,
  endScreen,
  openingHighlight,
  pauseScreen,
  pickRow,
  pregameScreen,
  SETTINGS_DESCRIPTION,
  SETTINGS_NOT_STORED,
  settingsScreen,
  simErrorScreen,
  titleScreen,
  type ScreenModel,
} from "../src/ui/screens";
import { artShown, paintSplash, pointAlong, splashBounds, splashClock, SPLASH_LOOP, splashFrame, splashOpts, splashPlay, splashScene, splashView } from "../src/ui/splash";
import { DEFENSE_CALLS, DT, randomCall, rng, type SplashCall, type SplashScript } from "../src/ui/splashSim";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "../src/ui/storage";
import { parseTemplates } from "../src/ui/templates";
import { COLOR, FONT_DISPLAY } from "../src/ui/tokens";

const root = join(import.meta.dirname, "../../..");
const appDir = join(import.meta.dirname, "..");
const readText = (p: string): string => readFileSync(join(appDir, p), "utf8");
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));

const html = readText("index.html");
const css = readText("src/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
const appSource = readText("src/ui/app.ts");

// ---------------------------------------------------------------- tiny HTML and CSS readers

/** The opening tag of the element with this id, or undefined. */
function openTag(id: string): string | undefined {
  return new RegExp(`<[a-z0-9]+\\b[^>]*\\bid="${id}"[^>]*>`, "i").exec(html)?.[0];
}
const hasHiddenAttr = (tag: string): boolean => /\shidden(?=[\s>=/])/.test(tag);
const tagName = (tag: string): string => (/^<([a-z0-9]+)/i.exec(tag)?.[1] ?? "").toLowerCase();
const attr = (tag: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** The inner HTML of the element with this id (no same-tag nesting inside, which holds for #main-menu). */
function innerOf(id: string): string {
  const tag = openTag(id);
  if (tag === undefined) return "";
  const start = html.indexOf(tag) + tag.length;
  const end = html.indexOf(`</${tagName(tag)}>`, start);
  return html.slice(start, end);
}
const textOf = (fragment: string): string => fragment.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

interface Rule {
  readonly selectors: readonly string[];
  readonly decls: Readonly<Record<string, string>>;
}
const rules: readonly Rule[] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => {
  const decls: Record<string, string> = {};
  for (const d of (m[2] ?? "").split(";")) {
    const i = d.indexOf(":");
    if (i < 0) continue;
    decls[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  }
  return { selectors: (m[1] ?? "").split(",").map((s) => s.trim().replace(/\s+/g, " ")), decls };
});
const rootVars: Record<string, string> = Object.fromEntries(
  rules.filter((r) => r.selectors.includes(":root")).flatMap((r) => Object.entries(r.decls).filter(([k]) => k.startsWith("--"))),
);
/** A declaration value with :root custom properties substituted, except --text-scale (it is the scale). */
function resolve(value: string): string {
  let v = value;
  for (let i = 0; i < 10; i++) {
    const next = v.replace(/var\((--[a-z0-9-]+)\)/gi, (whole, name: string) => (name === "--text-scale" ? whole : (rootVars[name] ?? whole)));
    if (next === v) break;
    v = next;
  }
  return v;
}
/** Declarations of every rule whose selector list contains exactly `selector`, later rules winning. */
function declsFor(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rules) if (r.selectors.includes(selector)) Object.assign(out, r.decls);
  return out;
}
const norm = (s: string | undefined): string => (s ?? "").replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim().toLowerCase();

// ---------------------------------------------------------------- a recording canvas context

interface Op {
  readonly op: string;
  readonly strokeStyle: string;
  readonly fillStyle: string;
  readonly dash: readonly number[];
  readonly lineWidth: number;
  readonly text?: string;
}
function recorder(): { g: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = [];
  let dash: number[] = [];
  const state: Record<string, unknown> = { fillStyle: "#000000", strokeStyle: "#000000", font: "10px sans-serif", globalAlpha: 1, lineWidth: 1, textAlign: "start", textBaseline: "alphabetic" };
  const log = (op: string, text?: string): void => {
    ops.push({ op, strokeStyle: String(state["strokeStyle"]).toUpperCase(), fillStyle: String(state["fillStyle"]).toUpperCase(), dash: [...dash], lineWidth: Number(state["lineWidth"]), ...(text === undefined ? {} : { text }) });
  };
  const g = new Proxy(state, {
    get(target, prop: string) {
      if (prop === "measureText") return (s: string) => ({ width: s.length * 7 });
      if (prop === "setLineDash") return (d: number[]) => (dash = [...d]);
      if (prop === "getLineDash") return () => [...dash];
      if (prop === "fillText" || prop === "strokeText") return (s: string) => log(prop, String(s));
      if (prop === "stroke" || prop === "strokeRect" || prop === "fill" || prop === "fillRect") return () => log(prop);
      if (prop in target) return target[prop];
      return () => undefined;
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { g, ops };
}

// ---------------------------------------------------------------- data for the splash diagram

const templates = parseTemplates(readJson("data/ui/templates.json"));
/** gradient.stage, typed in from DESIGN.md Gradients. */
const STAGE = "radial-gradient(120% 90% at 50% 0%, #13264A 0%, #0A1428 55%, #070E1C 100%)";
const personnelJson = readJson("data/engine/personnel.json") as { offense: Record<string, Record<string, number>>; packages: Record<string, Record<string, number>> };
const splashPersonnel = { offense: personnelJson.offense["shotgun"] ?? {}, defense: personnelJson.packages["nickel"] ?? {} };

// ================================================================= index.html, the first paint

describe("MM1, decision 2: the first paint is already the splash (index.html as served)", () => {
  it("#top-bar and #layout ship with the hidden attribute", () => {
    const top = openTag("top-bar");
    const layout = openTag("layout");
    expect(top, "#top-bar missing from index.html").toBeDefined();
    expect(layout, "#layout missing from index.html").toBeDefined();
    expect(hasHiddenAttr(top ?? "")).toBe(true);
    expect(hasHiddenAttr(layout ?? "")).toBe(true);
  });

  it("#main-menu is a visible section labelled Main menu", () => {
    const menu = openTag("main-menu");
    expect(menu, "#main-menu missing from index.html").toBeDefined();
    expect(tagName(menu ?? "")).toBe("section");
    expect(attr(menu ?? "", "aria-label")).toBe("Main menu");
    expect(hasHiddenAttr(menu ?? "")).toBe(false);
  });

  it("#main-menu holds an h1 reading Clipboard Football in sentence case (caps are CSS only) and Loading...", () => {
    const inner = innerOf("main-menu");
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(inner);
    expect(h1, "no h1 inside #main-menu").not.toBeNull();
    expect(textOf(h1?.[1] ?? "")).toBe("Clipboard Football");
    expect(textOf(inner)).toContain("Loading...");
  });

  it("one h1 on the first paint (the wordmark)", () => {
    expect(html.match(/<h1\b/gi)?.length).toBe(1);
  });

  it("the game panel, field canvas and mark card stay inside the hidden #layout, the too-small notice exists", () => {
    const layout = innerOf("layout");
    for (const id of ["field", "panel", "mark-card"]) expect(layout, `#${id} not inside #layout`).toContain(`id="${id}"`);
    expect(openTag("too-small")).toBeDefined();
    expect(textOf(innerOf("too-small"))).toBe("Make the window larger to play.");
  });
});

// ================================================================= styles.css

describe("styles.css: the hidden attribute actually hides each region (MM1, MM2)", () => {
  // A class rule with `display: flex` beats the browser's `[hidden] { display: none }`, so a region
  // shipped or set hidden would still paint unless a [hidden] rule puts display: none back.
  for (const id of ["main-menu", "top-bar", "layout", "too-small"]) {
    it(`#${id}: no class or id rule overrides [hidden]`, () => {
      const tag = openTag(id) ?? "";
      const classes = (attr(tag, "class") ?? "").split(/\s+/).filter((c) => c !== "");
      const own = [`#${id}`, ...classes.map((c) => `.${c}`)];
      const displays = rules.filter((r) => r.selectors.some((s) => own.includes(s))).map((r) => r.decls["display"]).filter((d): d is string => d !== undefined && d !== "none");
      if (displays.length === 0) return;
      const hiddenSelectors = ["[hidden]", ...own.map((s) => `${s}[hidden]`)];
      const restores = rules.some((r) => r.selectors.some((s) => hiddenSelectors.includes(s)) && /^none\b/.test(r.decls["display"] ?? ""));
      expect(restores, `#${id} gets display: ${displays.join(", ")} from its class but no [hidden] rule sets display: none`).toBe(true);
    });
  }
});

describe("styles.css: font.display is one variable (DESIGN.md Typography, display fallback)", () => {
  // DESIGN.md Broadcast (2026-11-15): Inter replaces Atkinson Hyperlegible as the fallback after Barlow.
  it(':root defines --font-display: "Barlow Condensed", "Inter", system-ui, sans-serif', () => {
    expect(norm(rootVars["--font-display"])).toBe(norm('"Barlow Condensed", "Inter", system-ui, sans-serif'));
  });

  it("the canvas display face is the same stack, so the wordmark, scoreboard and yard numbers fall back together", () => {
    expect(norm(FONT_DISPLAY)).toBe(norm('"Barlow Condensed", "Inter", system-ui, sans-serif'));
  });

  // Font intake (2026-11-15): the face is also named by its own @font-face rules, which declare it,
  // not use it. Still no element names Barlow or carries its own fallback stack.
  it("Barlow Condensed is named only in the variable and its @font-face rules: every display use reads var(--font-display)", () => {
    const named = rules.flatMap((r) => Object.entries(r.decls).filter(([, v]) => /Barlow/i.test(v)).map(([k]) => `${r.selectors.join(",")} ${k}`));
    const inFace = (n: string): boolean => n === "@font-face font-family" || n === "@font-face src";
    expect(named.filter((n) => n === "@font-face font-family").length).toBeGreaterThan(0);
    expect(named.filter((n) => !inFace(n))).toEqual([":root --font-display"]);
    // Every @font-face that names Barlow declares exactly that family, nothing else in the stack.
    for (const r of rules.filter((x) => x.selectors.join(",") === "@font-face" && /Barlow/i.test(x.decls["font-family"] ?? ""))) expect(r.decls["font-family"]).toBe('"Barlow Condensed"');
  });

  it("no web font is fetched and no substitute condensed face is named", () => {
    expect(css).not.toMatch(/@import/i);
    expect(css).not.toMatch(/url\(\s*["']?https?:/i);
    expect(css).not.toMatch(/\b(Impact|Arial Narrow|Oswald)\b/i);
    expect(html).not.toMatch(/<link\b[^>]*fonts\.(googleapis|gstatic)/i);
  });
});

describe("styles.css: the main menu frame, wordmark, rule and titles (spec Splash composition, DESIGN.md Main menu)", () => {
  // DESIGN.md Broadcast: menu.frame is the full window on gradient.stage.
  it("menu.frame: .main-menu fills the window on gradient.stage with chalk text, scrolls vertically, never horizontally", () => {
    const d = declsFor(".main-menu");
    expect(norm(resolve(d["background"] ?? d["background-color"] ?? ""))).toBe(norm(STAGE));
    expect(norm(resolve(d["color"] ?? ""))).toBe(norm(rootVars["--chalk"]));
    expect(norm(rootVars["--chalk"])).toBe(COLOR.chalk.toLowerCase());
    expect(d["overflow-x"]).toBe("hidden");
    expect(["auto", "scroll"]).toContain(d["overflow-y"]);
  });

  it("content frame: width min(1040px, 100vw - 64px), padding 32 px", () => {
    const d = declsFor(".menu-frame");
    expect(norm(resolve(d["width"] ?? ""))).toBe(norm("min(1040px, 100vw - 64px)"));
    expect(norm(resolve(d["padding"] ?? ""))).toBe("32px");
  });

  // Amended by DESIGN.md Prime Time (menu.hero): type.hero 88 px / 0.92, 0.005em, on two lines; type.wordmark 56 px when small.
  it("menu.wordmark: font.display 700, 88 px times the text scale (56 px when small), block caps by CSS, color.chalk, wraps", () => {
    const d = declsFor(".wordmark");
    expect(norm(d["font-family"])).toBe("var(--font-display)");
    expect(d["font-weight"]).toBe("700");
    expect(norm(resolve(d["font-size"] ?? ""))).toBe(norm("calc(88px * var(--text-scale))"));
    expect(d["line-height"]).toBe("0.92");
    expect(d["letter-spacing"]).toBe("0.005em");
    expect(norm(resolve(declsFor(".wordmark.small")["font-size"] ?? ""))).toBe(norm("calc(56px * var(--text-scale))"));
    expect(d["text-transform"]).toBe("uppercase");
    expect(norm(resolve(d["color"] ?? ""))).toBe(norm(rootVars["--chalk"]));
    expect(d["white-space"]).not.toBe("nowrap");
    expect(d["overflow"] ?? "").not.toBe("hidden");
  });

  // Amended by DESIGN.md Prime Time: menu.rule is 64 px wide, 4 px tall, radius 2 px, 16 px under the wordmark.
  it("menu.rule: a 64 by 4 px color.gold accent bar, radius 2 px, 16 px under the wordmark", () => {
    const d = declsFor(".menu-rule");
    const thick = d["height"] ?? d["border-top-width"] ?? "";
    expect(thick).toBe("4px");
    expect(d["width"]).toBe("64px");
    expect(d["border-radius"]).toBe("2px");
    expect(d["margin-top"]).toBe("16px");
    expect(norm(resolve(d["background"] ?? d["background-color"] ?? d["border-top-color"] ?? ""))).toBe(COLOR.gold.toLowerCase());
  });

  // Amended by DESIGN.md Prime Time (type.screenTitle): display 700 40 px caps, letter-spacing 0.01em.
  it("other menu screens' titles: font.display 700, 40 px times the text scale, block caps, color.chalk, no gold rule", () => {
    const d = declsFor(".menu-title");
    expect(norm(d["font-family"])).toBe("var(--font-display)");
    expect(d["font-weight"]).toBe("700");
    expect(norm(resolve(d["font-size"] ?? ""))).toBe(norm("calc(40px * var(--text-scale))"));
    expect(d["text-transform"]).toBe("uppercase");
    expect(d["letter-spacing"]).toBe("0.01em");
    expect(norm(resolve(d["color"] ?? ""))).toBe(norm(rootVars["--chalk"]));
    for (const k of ["border", "border-bottom", "border-top", "box-shadow", "text-decoration"]) expect(norm(resolve(d[k] ?? "")), k).not.toContain(COLOR.gold.toLowerCase());
  });

  it("tagline: font.ui 18 px times the text scale in color.chalkSoft", () => {
    const d = declsFor(".tagline");
    expect(norm(resolve(d["font-size"] ?? ""))).toBe(norm("calc(18px * var(--text-scale))"));
    expect(norm(resolve(d["color"] ?? ""))).toBe(norm(rootVars["--chalk-soft"]));
  });

  it("every font size set in the menu frame scales with var(--text-scale) (Accessibility)", () => {
    // inherit and parent-relative units (em, %) scale with the parent, which scales; px and rem don't.
    const menuSelectors = /main-menu|wordmark|menu-|tagline/;
    const scales = (v: string): boolean => v.includes("--text-scale") || v === "inherit" || /^[\d.]+(em|%)$/.test(v);
    const fixed = rules.filter((r) => r.selectors.some((s) => menuSelectors.test(s)) && r.decls["font-size"] !== undefined && !scales(resolve(r.decls["font-size"])));
    expect(fixed.map((r) => `${r.selectors.join(", ")}: ${r.decls["font-size"]}`)).toEqual([]);
  });

  // DESIGN.md Broadcast: "Window too small: gradient.stage with chalk text, either mode."
  it("MM14 style: window too small on gradient.stage with color.chalk text (DESIGN.md, art-director 7)", () => {
    const d = declsFor(".too-small");
    expect(norm(resolve(d["background"] ?? d["background-color"] ?? ""))).toBe(norm(STAGE));
    expect(norm(resolve(d["color"] ?? ""))).toBe(norm(rootVars["--chalk"]));
  });
});

// ================================================================= mode.ts

describe("decision 1, MM2, MM3: one fact decides the mode", () => {
  it("no game is menu mode; a game is game mode", () => {
    expect(uiMode(null)).toBe("menu");
    expect(uiMode({ clock: 900 })).toBe("game");
  });

  it("menu mode: #main-menu shown, #top-bar and #layout hidden", () => {
    expect(regionsHidden("menu")).toEqual({ mainMenu: false, topBar: true, layout: true });
  });

  it("game mode: #main-menu hidden, #top-bar and #layout shown", () => {
    expect(regionsHidden("game")).toEqual({ mainMenu: true, topBar: false, layout: false });
  });

  it("the three are always set together: the HUD is exactly the opposite of the menu", () => {
    for (const mode of ["menu", "game"] as const) {
      const r = regionsHidden(mode);
      expect(r.topBar).toBe(r.layout);
      expect(r.mainMenu).toBe(!r.topBar);
    }
  });
});

// ================================================================= screens.ts, the main menu

const actionsActHandles = (m: ScreenModel): string[] => m.rows.map((r) => r.action).filter((a) => !new RegExp(`case\\s+"${a}"\\s*:`).test(appSource));

describe("MM5: the main menu's four rows", () => {
  const states = [
    { hasSave: false, storage: true, checking: true },
    { hasSave: false, storage: true, checking: false },
    { hasSave: true, storage: true, checking: false },
    { hasSave: false, storage: false, checking: false },
  ];

  it("exactly 1 Quick play, 2 Continue, 3 Settings, 4 Controls in every save state", () => {
    for (const s of states) {
      const m = titleScreen(s);
      expect(m.rows.map((r) => [r.key, r.label])).toEqual([
        ["1", "Quick play"],
        ["2", "Continue"],
        ["3", "Settings"],
        ["4", "Controls"],
      ]);
    }
  });

  it("keys are unique and every action is one the app's act handles", () => {
    for (const s of states) {
      const m = titleScreen(s);
      expect(new Set(m.rows.map((r) => r.key)).size).toBe(m.rows.length);
      expect(actionsActHandles(m)).toEqual([]);
    }
  });

  it("Quick play, Settings and Controls are always on", () => {
    for (const s of states) {
      const m = titleScreen(s);
      for (const label of ["Quick play", "Settings", "Controls"]) expect(m.rows.find((r) => r.label === label)?.on, label).toBe(true);
    }
  });

  it("no Quit, Season, Franchise, Online or Load slot row (decision 3)", () => {
    const labels = titleScreen({ hasSave: true, storage: true, checking: false }).rows.map((r) => r.label.toLowerCase());
    for (const banned of ["quit", "season", "franchise", "online", "load"]) expect(labels.some((l) => l.includes(banned)), banned).toBe(false);
  });
});

describe("MM6: Continue's reasons", () => {
  const cont = (o: Parameters<typeof titleScreen>[0]) => titleScreen(o).rows.find((r) => r.label === "Continue");

  it('storage blocked: off with "saves aren\'t available in this browser window"', () => {
    const r = cont({ hasSave: false, storage: false, checking: false });
    expect(r?.on).toBe(false);
    expect(r?.reason).toBe("saves aren't available in this browser window");
  });

  it('while the save check runs: off with "checking for a saved game" (decision 5), not "no saved game"', () => {
    const r = cont({ hasSave: false, storage: true, checking: true });
    expect(r?.on).toBe(false);
    expect(r?.reason).toBe("checking for a saved game");
  });

  it('no save: off with "no saved game"', () => {
    const r = cont({ hasSave: false, storage: true, checking: false });
    expect(r?.on).toBe(false);
    expect(r?.reason).toBe("no saved game");
  });

  it("a save and working storage: on, with no reason", () => {
    const r = cont({ hasSave: true, storage: true, checking: false });
    expect(r?.on).toBe(true);
    expect(r?.reason).toBeUndefined();
  });

  it("picking an off Continue gives its reason in words and does not act", () => {
    const m = titleScreen({ hasSave: false, storage: true, checking: true });
    const p = pickRow(m, "2");
    expect(p.t).toBe("reason");
    if (p.t === "reason") expect(p.text).toContain("checking for a saved game");
  });
});

describe("MM7: Quick play's note iff a save exists and storage works", () => {
  for (const hasSave of [false, true]) {
    for (const storage of [false, true]) {
      it(`hasSave ${String(hasSave)}, storage ${String(storage)}`, () => {
        const note = titleScreen({ hasSave, storage, checking: false }).rows.find((r) => r.label === "Quick play")?.note ?? "";
        if (hasSave && storage) expect(note).toContain("replaces your saved game");
        else expect(note).not.toContain("replaces your saved game");
      });
    }
  }
});

describe("MM8, decision 4: the opening highlight", () => {
  const labelAt = (o: Parameters<typeof titleScreen>[0]): string | undefined => {
    const m = titleScreen(o);
    return m.rows[openingHighlight(m)]?.label;
  };

  it("on Continue when a save exists, so Enter never replaces a save", () => {
    expect(labelAt({ hasSave: true, storage: true, checking: false })).toBe("Continue");
  });

  it("on Quick play while checking, with no save, and with storage blocked", () => {
    expect(labelAt({ hasSave: false, storage: true, checking: true })).toBe("Quick play");
    expect(labelAt({ hasSave: false, storage: true, checking: false })).toBe("Quick play");
    expect(labelAt({ hasSave: false, storage: false, checking: false })).toBe("Quick play");
  });

  it("the opening highlight is never on an off row", () => {
    for (const o of [
      { hasSave: false, storage: true, checking: true },
      { hasSave: false, storage: true, checking: false },
      { hasSave: true, storage: true, checking: false },
      { hasSave: false, storage: false, checking: false },
    ]) {
      const m = titleScreen(o);
      expect(m.rows[openingHighlight(m)]?.on).toBe(true);
    }
  });
});

describe("MM18 (pure part): Esc on the main menu does nothing; Esc on Pregame is Back", () => {
  it("the main menu has no Esc row, so Esc picks nothing", () => {
    for (const o of [
      { hasSave: true, storage: true, checking: false },
      { hasSave: false, storage: false, checking: false },
    ]) {
      expect(pickRow(titleScreen(o), "Esc")).toEqual({ t: "none" });
    }
  });

  it("Pregame's Esc is Back", () => {
    const p = pickRow(pregameScreen(), "Esc");
    expect(p.t).toBe("act");
    if (p.t === "act") expect(p.row.label).toBe("Back");
  });
});

// ================================================================= screens.ts, Settings

const settingsOf = (s: Partial<Settings> & { systemReduced?: boolean } = {}): ScreenModel =>
  settingsScreen({ textSize: s.textSize ?? 100, reducedMotion: s.reducedMotion ?? "system", markLabels: s.markLabels ?? "involved", labelContent: s.labelContent ?? "rating", speed: s.speed ?? "1x", autoAdvance: s.autoAdvance ?? "off", ...(s.systemReduced === undefined ? {} : { systemReduced: s.systemReduced }) });

describe("MM9, decision 6: Settings reaches every setting", () => {
  // Calling screen pass Q1 adds row 6, Auto-advance (the rule is unchanged: every setting has a row).
  it("rows are 1 Text size, 2 Reduced motion, 3 Mark labels, 4 Mark label shows, 5 Animation speed, 6 Auto-advance, Esc Back", () => {
    expect(settingsOf().rows.map((r) => [r.key, r.label])).toEqual([
      ["1", "Text size"],
      ["2", "Reduced motion"],
      ["3", "Mark labels"],
      ["4", "Mark label shows"],
      ["5", "Animation speed"],
      ["6", "Auto-advance"],
      ["Esc", "Back"],
    ]);
  });

  it("every Settings row is on, keys unique, and every action is one the app's act handles", () => {
    const m = settingsOf();
    expect(m.rows.every((r) => r.on)).toBe(true);
    expect(new Set(m.rows.map((r) => r.key)).size).toBe(m.rows.length);
    expect(actionsActHandles(m)).toEqual([]);
  });

  it("the speed row's note shows 1x, 2x or skip and matches the pause menu's speed row", () => {
    for (const speed of ["1x", "2x", "skip"] as const) {
      const settingsRow = settingsOf({ speed }).rows.find((r) => r.label === "Animation speed");
      const pauseRow = pauseScreen({ hasPlay: true, speed }).rows.find((r) => r.label === "Animation speed");
      expect(settingsRow?.note).toBe(speed);
      expect(pauseRow?.note).toBe(speed);
      expect(settingsRow?.action).toBe(pauseRow?.action);
    }
  });

  it("the pause menu keeps its own speed row", () => {
    expect(pauseScreen({ hasPlay: false, speed: "1x" }).rows.some((r) => r.label === "Animation speed")).toBe(true);
  });
});

describe("MM10: every DEFAULT_SETTINGS key has a Settings row that shows it", () => {
  // The values each setting takes, typed in from the Settings type. A new setting with no entry
  // here fails this test on purpose: give it a Settings row, then add its values here.
  const VALUES: Readonly<Record<string, readonly unknown[]>> = {
    textSize: [100, 125, 150, 200],
    reducedMotion: ["system", "on", "off"],
    markLabels: ["involved", "all", "none"],
    labelContent: ["rating", "number"],
    speed: ["1x", "2x", "skip"],
    // Calling screen pass Q1.
    autoAdvance: ["off", "noDecision", "all"],
  };

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    it(`${key}: changing it changes exactly one row's note, and that row's action is handled`, () => {
      const values = VALUES[key];
      expect(values, `no values listed for the new setting "${key}"`).toBeDefined();
      for (const v of values ?? []) {
        const base = settingsOf(DEFAULT_SETTINGS);
        const changed = settingsOf({ ...DEFAULT_SETTINGS, [key]: v });
        if (v === DEFAULT_SETTINGS[key as keyof Settings]) continue;
        const diff = base.rows.filter((r, i) => r.note !== changed.rows[i]?.note);
        expect(diff.map((r) => r.label), `${key} = ${String(v)}`).toHaveLength(1);
        expect(diff[0]?.key).not.toBe("Esc");
        expect(actionsActHandles({ id: "x", title: "x", rows: diff })).toEqual([]);
      }
    });
  }
});

describe("decision 7: Settings preview in words", () => {
  const SPEC_DESCRIPTION: Readonly<Record<string, string>> = {
    "Text size": "Changes every screen, including this one.",
    "Reduced motion": "On: plays jump to their last frame and the camera cuts instead of panning.",
    "Mark labels": "Which marks keep their label while a play runs. Every mark gets its label back at the whistle.",
    "Mark label shows": "What the number beside each mark is: the player's overall rating or his jersey number.",
    "Animation speed": "How fast plays run: 1x, 2x, or skip to the result. S changes it during a play.",
    // docs/specs/m2-calling-screen-pass.md, Q1 Copy.
    "Auto-advance": "Plays with nothing for you to choose (their kickoffs, punts, field goals, extra points, kneels and spikes) run without waiting for Space. Off by default. The middle setting still stops when you could call a timeout.",
  };

  it("each row's description line is the spec's", () => {
    for (const r of settingsOf().rows) {
      if (r.key === "Esc") continue;
      expect(SETTINGS_DESCRIPTION[r.action], r.label).toBe(SPEC_DESCRIPTION[r.label]);
    }
  });

  it('Reduced motion "system" says what it resolves to now', () => {
    const note = (systemReduced: boolean): string | undefined => settingsOf({ reducedMotion: "system", systemReduced }).rows.find((r) => r.label === "Reduced motion")?.note;
    expect(note(true)).toBe("Follow the system (now: on)");
    expect(note(false)).toBe("Follow the system (now: off)");
  });

  it('the body line "Mark labels: [value]." is gone (it repeated row 3)', () => {
    for (const markLabels of ["involved", "all", "none"] as const) {
      const lines = settingsOf({ markLabels }).lines ?? [];
      expect(lines.some((l) => l.startsWith("Mark labels:"))).toBe(false);
    }
  });

  it('decision 12: the not-stored line reads "Settings last until you close this page."', () => {
    expect(SETTINGS_NOT_STORED).toBe("Settings last until you close this page.");
  });
});

describe("MM19, decision 9: the way back says Main menu, never title", () => {
  it('pause row 7 is "Quit to main menu", note "save kept"', () => {
    const r = pauseScreen({ hasPlay: true, speed: "1x" }).rows.find((x) => x.key === "7");
    expect(r?.label).toBe("Quit to main menu");
    expect(r?.note).toBe("save kept");
  });

  it('end screen Esc is "Main menu"', () => {
    expect(endScreen().rows.find((r) => r.key === "Esc")?.label).toBe("Main menu");
  });

  it('sim error Esc is "Main menu"', () => {
    expect(simErrorScreen().rows.find((r) => r.key === "Esc")?.label).toBe("Main menu");
  });

  it('no row on pause, end or sim error says "title"', () => {
    for (const m of [pauseScreen({ hasPlay: true, speed: "1x" }), endScreen(), simErrorScreen()]) {
      for (const r of m.rows) expect(`${r.label} ${r.note ?? ""}`.toLowerCase(), `${m.id}: ${r.label}`).not.toContain("title");
    }
  });
});

// Calling screen pass Q1: Settings gains row 6, Auto-advance, so 7 with Back (still at the cap).
describe("MM23: the screen cap includes the main menu (4) and Settings (7)", () => {
  it("main menu 4, Settings 7, Controls 1, all at most 7", () => {
    expect(titleScreen({ hasSave: true, storage: true, checking: false }).rows).toHaveLength(4);
    expect(settingsOf().rows).toHaveLength(7);
    expect(controlsScreen().rows.map((r) => [r.key, r.label])).toEqual([["Esc", "Back"]]);
    for (const m of [titleScreen({ hasSave: false, storage: false, checking: true }), settingsOf(), controlsScreen()]) expect(m.rows.length).toBeLessThanOrEqual(7);
  });
});

// ================================================================= storage.ts

describe("decision 12: saveSettings says whether it stored", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when localStorage.setItem throws (blocked storage), without throwing", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      removeItem: () => undefined,
    });
    let out: boolean | undefined;
    expect(() => (out = saveSettings({ ...DEFAULT_SETTINGS, speed: "2x" }))).not.toThrow();
    expect(out).toBe(false);
  });

  it("returns false when localStorage itself is missing", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(saveSettings({ ...DEFAULT_SETTINGS })).toBe(false);
  });

  it("returns true when it stored, and the speed set from Settings loads back", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    expect(saveSettings({ ...DEFAULT_SETTINGS, speed: "skip", textSize: 150 })).toBe(true);
    expect(loadSettings()).toMatchObject({ speed: "skip", textSize: 150 });
  });
});

// ================================================================= splash.ts, when the art shows

describe("MM12 as amended by DESIGN.md: when the splash art shows", () => {
  // Typed in from the spec's layout: frame min(1040, W - 64), padding 32 each side, left column
  // 440 px times the text scale, 48 px gap; the art column is what's left. Hidden under 360 px.
  it("1280x720 at 100% and 125%: shown (DESIGN.md: 360 px keeps the 125% case shown)", () => {
    expect(artShown({ textSize: 100, windowWidth: 1280, canvas2d: true })).toBe(true);
    expect(artShown({ textSize: 125, windowWidth: 1280, canvas2d: true })).toBe(true);
  });

  it("text 150% and 200%: hidden at any width", () => {
    for (const w of [1280, 1920, 3840]) {
      expect(artShown({ textSize: 150, windowWidth: w, canvas2d: true })).toBe(false);
      expect(artShown({ textSize: 200, windowWidth: w, canvas2d: true })).toBe(false);
    }
  });

  it("no Canvas 2D: hidden", () => {
    expect(artShown({ textSize: 100, windowWidth: 1280, canvas2d: false })).toBe(false);
    expect(artShown({ textSize: 125, windowWidth: 1920, canvas2d: false })).toBe(false);
  });

  it("the art column under 360 px hides it: at 100% the edge is a 976 px window (976 - 64 - 64 - 440 - 48 = 360)", () => {
    expect(artShown({ textSize: 100, windowWidth: 976, canvas2d: true })).toBe(true);
    expect(artShown({ textSize: 100, windowWidth: 975, canvas2d: true })).toBe(false);
  });

  it("at 125% the edge is a 1086 px window (1086 - 128 - 550 - 48 = 360)", () => {
    expect(artShown({ textSize: 125, windowWidth: 1086, canvas2d: true })).toBe(true);
    expect(artShown({ textSize: 125, windowWidth: 1085, canvas2d: true })).toBe(false);
  });

  it("800x520 at 100%: hidden (a 184 px column)", () => {
    expect(artShown({ textSize: 100, windowWidth: 800, canvas2d: true })).toBe(false);
  });

  it("a very wide window doesn't widen the frame past 1040 px, so 125% stays shown and 150% hidden", () => {
    expect(artShown({ textSize: 125, windowWidth: 3840, canvas2d: true })).toBe(true);
  });
});

// ================================================================= splash.ts, what the art shows

describe("splash view: the box and the window of field it shows (Splash composition)", () => {
  for (const width of [360, 488, 700]) {
    it(`width ${width}: height 0.68 of the width, sideline to sideline plus margins, LOS 62% down`, () => {
      const v = splashView(width, () => 17);
      expect(v.height).toBe(Math.round(width * 0.68));
      expect(v.width).toBe(width);
      expect(v.s * COLUMN_YARDS).toBeCloseTo(width, 6);
      const losY = (v.cameraY - 35) * v.s;
      expect(losY / v.height).toBeCloseTo(0.62, 2);
      // About OWN 21 to OWN 59 in view: no end zone.
      const top = v.cameraY;
      const bottom = v.cameraY - v.height / v.s;
      expect(top).toBeGreaterThan(57);
      expect(top).toBeLessThan(61);
      expect(bottom).toBeGreaterThan(19);
      expect(bottom).toBeLessThan(23);
    });
  }

  it("the scene: ball at OWN 35, no first-down line (DESIGN.md, art-director 4), no team names", () => {
    const s = splashScene();
    expect(s.los).toBe(35);
    expect(s.firstDown).toBeNull();
    expect(s.topName).toBe("");
    expect(s.bottomName).toBe("");
  });
});

describe("MM16, decision 13: the diagram is a template drawing with no model output", () => {
  const tl = splashFrame(templates, splashPersonnel, 488 / COLUMN_YARDS);

  it("11 O's and 11 X's", () => {
    expect(tl.marks.filter((m) => m.side === "O")).toHaveLength(11);
    expect(tl.marks.filter((m) => m.side === "X")).toHaveLength(11);
    expect(tl.marks).toHaveLength(22);
  });

  it('marks stand where offenseArt("shotgun", "playAction") and defenseArt("nickel", "nickelCover3") put them', () => {
    const s = 488 / COLUMN_YARDS;
    const off = offenseArt("shotgun", "playAction", slotsFromCounts(splashPersonnel.offense), templates, 35, s);
    const def = defenseArt("nickel", "nickelCover3", slotsFromCounts(splashPersonnel.defense), templates, 35, s);
    const want = [...off.marks, ...def.marks].map((m) => `${m.side}:${m.x.toFixed(3)},${m.y.toFixed(3)}`).sort();
    const got = tl.marks.map((m) => `${m.side}:${(m.keys[0]?.x ?? NaN).toFixed(3)},${(m.keys[0]?.y ?? NaN).toFixed(3)}`).sort();
    expect(got).toEqual(want);
  });

  it("offense attacks up: O's at or behind the line, X's at or past it", () => {
    for (const m of tl.marks) {
      const y = m.keys[0]?.y ?? NaN;
      if (m.side === "O") expect(y).toBeLessThanOrEqual(35);
      else expect(y).toBeGreaterThanOrEqual(35);
    }
  });

  it("routes with arrowheads, blocks with ticks, defense drops: both sides have paths", () => {
    const paths = tl.preview?.paths ?? [];
    expect(paths.some((p) => p.side === "O" && p.end === "arrow")).toBe(true);
    expect(paths.some((p) => p.side === "O" && p.end === "block")).toBe(true);
    expect(paths.some((p) => p.side === "X")).toBe(true);
  });

  it("no ball path, no labels, no flags, no rings, no zones, depth bands or tethers, no first-down line", () => {
    expect(tl.paths.filter((p) => p.kind === "ball")).toEqual([]);
    expect(tl.labels).toEqual([]);
    expect(tl.flags).toEqual([]);
    expect(tl.rings).toEqual([]);
    expect(tl.involved).toEqual([]);
    expect(tl.holder).toBeNull();
    expect(tl.preview?.zones ?? []).toEqual([]);
    expect(tl.preview?.bands ?? []).toEqual([]);
    expect(tl.preview?.tethers ?? []).toEqual([]);
    expect(tl.firstDown).toBeNull();
  });

  it("static: the frame has no running time", () => {
    expect(tl.total).toBe(0);
  });
});

describe("MM16, DESIGN.md Main menu: what the splash actually paints", () => {
  const width = 488;
  const v = splashView(width, (s) => Math.max(14, 1.4 * s));

  function paint(textScale: number): Op[] {
    const { g, ops } = recorder();
    drawField(g, v, splashScene(), textScale);
    drawFrame(g, v, splashFrame(templates, splashPersonnel, v.s), 0, splashOpts(textScale));
    return ops;
  }

  it("no first-down line: nothing is stroked in color.signal", () => {
    for (const scale of [1, 1.25]) {
      const signal = paint(scale).filter((o) => (o.op === "stroke" || o.op === "strokeRect") && o.strokeStyle === COLOR.signal.toUpperCase());
      expect(signal).toHaveLength(0);
    }
  });

  it("no text but the yard numbers: no labels, no team names, no words", () => {
    const words = paint(1).filter((o) => o.text !== undefined && o.text.trim() !== "" && !/^\d{1,2}$/.test(o.text.trim()));
    expect(words.map((o) => o.text)).toEqual([]);
  });

  it("the diagram itself writes no text at all (no mark labels)", () => {
    const { g, ops } = recorder();
    drawFrame(g, v, splashFrame(templates, splashPersonnel, v.s), 0, splashOpts(1));
    expect(ops.filter((o) => o.text !== undefined && o.text !== "").map((o) => o.text)).toEqual([]);
  });

  it("marks and paths for both sides in color.line over color.outlineDark: no team color", () => {
    const { g, ops } = recorder();
    drawFrame(g, v, splashFrame(templates, splashPersonnel, v.s), 0, splashOpts(1));
    const strokes = ops.filter((o) => o.op === "stroke" || o.op === "strokeRect");
    expect(strokes.length).toBeGreaterThan(22);
    const colors = new Set(strokes.map((o) => o.strokeStyle));
    expect([...colors].sort()).toEqual([COLOR.line.toUpperCase(), COLOR.outlineDark.toUpperCase()].sort());
  });

  // Amended (DESIGN.md Prime Time, Paths): no dashed paths; side is told by weight and end cap.
  it("every path is solid; defense paths are thinner than offense routes", () => {
    const { g, ops } = recorder();
    drawFrame(g, v, splashFrame(templates, splashPersonnel, v.s), 0, splashOpts(1));
    const lineStrokes = ops.filter((o) => o.op === "stroke" && o.strokeStyle === COLOR.line.toUpperCase());
    expect(lineStrokes.length).toBeGreaterThan(0);
    expect(lineStrokes.every((o) => o.dash.length === 0)).toBe(true);
    const widths = new Set(lineStrokes.map((o) => o.lineWidth));
    expect(widths.has(3)).toBe(true);
    expect(widths.has(2)).toBe(true);
  });
});

describe("Live splash (Joseph, 2026-11-15): no field, procedurally generated plays played out live", () => {
  const v = splashView(488, (s) => Math.max(14, 1.4 * s));
  const art = (call: SplashCall, s: number) => splashFrame(templates, { offense: personnelJson.offense[call.formation] ?? {}, defense: personnelJson.packages[call.pkg] ?? {} }, s, call);
  const box = splashBounds(v);
  const plays = Array.from({ length: 120 }, (_, seed) => splashPlay(art, v, seed));
  const at = (sc: SplashScript, i: number, j: number) => ({ x: sc.pos[(i * sc.sides.length + j) * 2] ?? NaN, y: sc.pos[(i * sc.sides.length + j) * 2 + 1] ?? NaN });

  it("same seed, same play; the calls vary across seeds and every one is a real call", () => {
    const a = splashPlay(art, v, 7);
    const b = splashPlay(art, v, 7);
    expect(a.call).toEqual(b.call);
    expect(Array.from(a.pos)).toEqual(Array.from(b.pos));
    const calls = new Set(plays.map((p) => JSON.stringify(p.call)));
    expect(calls.size).toBeGreaterThan(25);
    for (const p of plays) {
      expect(templates.offense[p.call.formation]).toBeDefined();
      expect(DEFENSE_CALLS[p.call.pkg]).toContain(p.call.preset);
      if (p.call.formation === "empty") expect(["insideRun", "outsideRun", "screenPass"]).not.toContain(p.call.play);
    }
    const kinds = new Set(plays.map((p) => p.call.play));
    for (const k of ["insideRun", "outsideRun", "shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"]) expect(kinds).toContain(k);
  });

  it("randomCall never picks a run from empty or a goal-line or prevent package", () => {
    const r = rng(3);
    for (let i = 0; i < 500; i++) {
      const c = randomCall(r);
      expect(Object.keys(DEFENSE_CALLS)).toContain(c.pkg);
      if (c.formation === "empty") expect(c.play).not.toMatch(/Run|screen/);
    }
  });

  it("11 a side, all finite, nobody leaves the picture", () => {
    for (const p of plays) {
      expect(p.sides.filter((s) => s === "O")).toHaveLength(11);
      expect(p.sides.filter((s) => s === "X")).toHaveLength(11);
      for (let i = 0; i < p.steps; i++) {
        for (let j = 0; j < p.sides.length; j++) {
          const q = at(p, i, j);
          expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true);
          expect(q.y).toBeGreaterThanOrEqual(box.bottom);
          expect(q.y).toBeLessThanOrEqual(box.top);
          expect(q.x).toBeGreaterThanOrEqual(0);
          expect(q.x).toBeLessThanOrEqual(53.3);
        }
      }
    }
  });

  it("the outcomes vary: tackles, incompletions, sacks and breakaways all happen, tackles most", () => {
    const count = (o: string) => plays.filter((p) => p.outcome === o).length;
    expect(count("tackle")).toBeGreaterThan(plays.length / 2);
    expect(count("incomplete")).toBeGreaterThan(0);
    expect(count("sack")).toBeGreaterThan(0);
    expect(count("runaway")).toBeGreaterThan(0);
    // Runs never throw; an incompletion always has a throw and no carrier.
    for (const p of plays) {
      if (p.call.play.endsWith("Run")) expect(p.throwStep).toBe(-1);
      if (p.outcome === "incomplete") {
        expect(p.throwStep).toBeGreaterThan(0);
        expect(p.carrier).toBe(-1);
      }
    }
  });

  it("plays last different lengths (not one fixed animation), between about a second and the 7 s cap", () => {
    const lens = plays.map((p) => p.whistleStep * DT);
    expect(Math.min(...lens)).toBeGreaterThan(0.5);
    expect(Math.max(...lens)).toBeLessThanOrEqual(7);
    expect(new Set(lens.map((l) => Math.round(l * 10))).size).toBeGreaterThan(15);
  });

  it("players move at their own pace: a second into the play receivers have covered more ground than linemen, and no two marks match", () => {
    const one = Math.round(1 / DT);
    let checked = 0;
    for (const p of plays.filter((x) => x.whistleStep > one && !x.call.play.endsWith("Run"))) {
      const moved = p.positions.map((pos, j) => ({ pos, side: p.sides[j], d: Math.hypot(at(p, one, j).x - at(p, 0, j).x, at(p, one, j).y - at(p, 0, j).y) }));
      const wr = moved.filter((m) => m.side === "O" && m.pos === "WR").map((m) => m.d);
      const ol = moved.filter((m) => m.pos === "OL").map((m) => m.d);
      if (wr.length === 0) continue;
      expect(Math.max(...wr)).toBeGreaterThan(Math.max(...ol));
      expect(new Set(moved.map((m) => m.d.toFixed(2))).size).toBeGreaterThan(8);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("the loop: fade in, set, the live play at its own length, a hold, fade out, then done", () => {
    const p = plays[0] as SplashScript;
    const L = SPLASH_LOOP;
    const live = (p.steps - 1) * DT * 1000;
    expect(splashClock(0, p)).toEqual({ step: 0, alpha: 0, done: false });
    expect(splashClock(L.fadeIn + L.set / 2, p)).toEqual({ step: 0, alpha: 1, done: false });
    expect(splashClock(L.fadeIn + L.set + live / 2, p).step).toBeGreaterThan(0);
    expect(splashClock(L.fadeIn + L.set + live + L.hold / 2, p)).toEqual({ step: p.steps - 1, alpha: 1, done: false });
    expect(splashClock(L.fadeIn + L.set + live + L.hold + L.fadeOut + 1, p).done).toBe(true);
  });

  it("pointAlong: ends, a corner and the middle of a bent line, by length", () => {
    const pts = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }];
    expect(pointAlong(pts, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAlong(pts, 1)).toEqual({ x: 3, y: 4 });
    expect(pointAlong(pts, 3 / 7)).toEqual({ x: 3, y: 0 });
    expect(pointAlong(pts, 0.5).y).toBeCloseTo(0.5, 9);
  });

  function paint(p: SplashScript, step: number): Op[] {
    const { g, ops } = recorder();
    (g as unknown as Record<string, unknown>)["clearRect"] = () => undefined;
    paintSplash(g, v, p, step, 1);
    return ops;
  }

  it("no field: no turf fills and no text; at the snap no trails, later dotted trails in color.line", () => {
    const p = plays.find((x) => x.throwStep > 0 && x.landStep > 0) as SplashScript;
    for (const step of [0, p.landStep, p.steps - 1]) {
      const ops = paint(p, step);
      expect(ops.filter((o) => o.text !== undefined && o.text !== "")).toEqual([]);
      expect(ops.filter((o) => o.op === "fillRect")).toEqual([]);
    }
    const dotted = (ops: Op[]) => ops.filter((o) => o.op === "stroke" && o.dash.length > 0);
    expect(dotted(paint(p, 0))).toEqual([]);
    const late = dotted(paint(p, p.steps - 1));
    // One trail per mark plus the ball's flight.
    expect(late.length).toBe(23);
    expect(new Set(late.map((o) => o.strokeStyle))).toEqual(new Set([COLOR.line.toUpperCase()]));
  });
});
