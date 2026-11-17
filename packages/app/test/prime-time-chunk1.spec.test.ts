// Spec tests for chunk 1 of the "Prime Time" revision in DESIGN.md (art-director, 2026-11-15),
// written by test-writer from DESIGN.md, not from the implementation. "Build order (Prime Time)"
// item 1 names: the fused score bug with team plates, score boxes and its motion (odometer, down
// swap, first-down flash, possession slide); the 64 px top bar and MIN_HEIGHT 536; display type for
// the bug, plate and screen titles; the situation plate with the drive tracker; the call card's
// breadcrumb header; the gold focus ring on rows. Every expected value is typed in from DESIGN.md
// (sections Tokens, Typography, Layout > Top bar and Calling screen Step A, HUD > Score bug and
// Rows, Motion (UI), Moments row "First down").
//
// There is no jsdom in the repo. The DOM criteria are checked three ways:
// - styles.css, read with a small brace-aware reader that keeps @media context;
// - the App's own render methods (renderTopBar, situationPlate, driveTracker) run on an App made
//   with Object.create(App.prototype), against a tiny fake DOM written here. Only the fields those
//   methods read are set; nothing in the App is stubbed except that the fake DOM has no layout
//   (every scrollWidth and clientWidth is 0, so no fit step applies);
// - the worker Session, playing seeded games with the shared scripted human.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { acceptedFoul, playStands } from "@clipboard-football/sim";
import { beforeAll, describe, expect, it } from "vitest";
import { isFromWorker } from "../src/engine/messages";
import type { FromWorker, OpenDrive } from "../src/engine/protocol";
import { Session } from "../src/engine/session";
import type { GameEvent, GameState, PlayEvent, Team } from "../src/engine/types";
import { App } from "../src/ui/app";
import { Flights } from "../src/ui/flights";
import { layoutFor, MIN_HEIGHT, MIN_WIDTH, TOP_BAR, VISIBLE_YARDS } from "../src/ui/layout";
import * as tokens from "../src/ui/tokens";
import { COLOR, DUR, matchupInk, RADIUS } from "../src/ui/tokens";
import { newFirstDown, type DownState } from "../src/ui/topbar";
import { prepared, scriptedAnswer } from "./support";

const appDir = join(import.meta.dirname, "..");
const css = readFileSync(join(appDir, "src/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// ---------------------------------------------------------------- a brace-aware CSS reader

interface Rule {
  readonly at: readonly string[];
  readonly selectors: readonly string[];
  readonly decls: Readonly<Record<string, string>>;
}
function parseCss(text: string): Rule[] {
  const out: Rule[] = [];
  const walk = (src: string, at: readonly string[]): void => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf("{", i);
      if (open < 0) return;
      const head = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      const body = src.slice(open + 1, j - 1);
      if (head.startsWith("@")) walk(body, [...at, head.replace(/\s+/g, " ")]);
      else {
        const decls: Record<string, string> = {};
        for (const d of body.split(";")) {
          const k = d.indexOf(":");
          if (k < 0) continue;
          decls[d.slice(0, k).trim()] = d.slice(k + 1).trim();
        }
        out.push({ at, selectors: head.split(",").map((s) => s.trim().replace(/\s+/g, " ")), decls });
      }
      i = j;
    }
  };
  walk(text, []);
  return out;
}
const rules = parseCss(css);
const topRules = rules.filter((r) => r.at.length === 0);
const rootVars: Record<string, string> = Object.fromEntries(topRules.filter((r) => r.selectors.includes(":root")).flatMap((r) => Object.entries(r.decls).filter(([k]) => k.startsWith("--"))));
function declsFor(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of topRules) if (r.selectors.includes(selector)) Object.assign(out, r.decls);
  return out;
}
const norm = (s: string | undefined): string =>
  (s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(^|[^#0-9a-z])(\d*\.\d+|\d+)(?=[^0-9a-z#]|px|ms|%|deg|em|$)/g, (_m, pre: string, n: string) => `${pre}${String(Number(n))}`)
    .trim();
const kebab = (k: string): string => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
/** "#RRGGBB" or "rgba(r, g, b, a)" as [r, g, b, a]. */
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
/** A CSS font size written for the text scale or the bar scale: "calc(Npx * var(--x-scale))" or "Npx". */
const sizeIs = (v: string | undefined, px: number, scale: "text" | "bar"): boolean => [`calc(${px}px * var(--${scale}-scale))`, `${px}px`].includes(norm(v));

// ---------------------------------------------------------------- a tiny fake DOM

class FakeText {
  constructor(readonly data: string) {}
  get textContent(): string {
    return this.data;
  }
}
type FakeNode = FakeEl | FakeText;
class FakeEl {
  readonly attrs = new Map<string, string>();
  children: FakeNode[] = [];
  hidden = false;
  scrollWidth = 0;
  clientWidth = 0;
  readonly styleProps = new Map<string, string>();
  readonly style: Record<string, unknown> & { setProperty(k: string, v: string): void; getPropertyValue(k: string): string };
  constructor(readonly tagName: string) {
    const props = this.styleProps;
    this.style = {
      setProperty: (k: string, v: string): void => void props.set(k, v),
      getPropertyValue: (k: string): string => props.get(k) ?? "",
    } as FakeEl["style"];
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  get classes(): string[] {
    return (this.attrs.get("class") ?? "").split(/\s+/).filter((c) => c !== "");
  }
  readonly classList = {
    add: (...cs: string[]): void => {
      this.attrs.set("class", [...new Set([...this.classes, ...cs])].join(" "));
    },
    remove: (...cs: string[]): void => {
      this.attrs.set("class", this.classes.filter((c) => !cs.includes(c)).join(" "));
    },
    contains: (c: string): boolean => this.classes.includes(c),
    toggle: (c: string, on?: boolean): boolean => {
      const want = on ?? !this.classes.includes(c);
      if (want) this.classList.add(c);
      else this.classList.remove(c);
      return want;
    },
  };
  append(...nodes: (FakeNode | string)[]): void {
    for (const n of nodes) this.children.push(typeof n === "string" ? new FakeText(n) : n);
  }
  replaceChildren(...nodes: FakeNode[]): void {
    this.children = [];
    this.append(...nodes);
  }
  get textContent(): string {
    return this.children.map((c) => c.textContent).join("");
  }
  get elements(): FakeEl[] {
    return this.children.filter((c): c is FakeEl => c instanceof FakeEl);
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  /** Every descendant, depth first. */
  all(): FakeEl[] {
    return this.elements.flatMap((e) => [e, ...e.all()]);
  }
  /** Descendant selectors of class compounds only: ".a .b.c". */
  querySelectorAll(sel: string): FakeEl[] {
    const parts = sel.trim().split(/\s+/).map((p) => p.split(".").filter((x) => x !== ""));
    const matches = (e: FakeEl, cls: string[]): boolean => cls.every((c) => e.classes.includes(c));
    let set: FakeEl[] = [this];
    for (const cls of parts) set = [...new Set(set.flatMap((e) => e.all().filter((d) => matches(d, cls))))];
    return set;
  }
  querySelector(sel: string): FakeEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  has(cls: string): boolean {
    return this.classes.includes(cls);
  }
}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g["document"] = { createElement: (t: string) => new FakeEl(t), createTextNode: (s: string) => new FakeText(s) };
  g["window"] = { setTimeout: () => 0, clearTimeout: () => undefined, innerWidth: 1440, innerHeight: 900 };
});

// ---------------------------------------------------------------- a game view for the App's render methods

const NICK = { home: "Outriders", away: "Cranes" } as const;
const SLOTS = { home: 0, away: 1 } as const;
const INKS = matchupInk(SLOTS.away, SLOTS.home);

function state(over: Partial<GameState> = {}): GameState {
  return {
    period: 1,
    clock: 893,
    clockRunning: false,
    playClock: 40,
    phase: "scrimmage",
    possession: "home",
    spot: 32,
    down: 1,
    distance: 10,
    goalToGo: false,
    trySpots: null,
    safetyKick: false,
    score: { home: 0, away: 0 },
    timeouts: { home: 3, away: 2 },
    ...over,
  } as unknown as GameState;
}

interface Harness {
  readonly app: Record<string, unknown>;
  readonly bar: FakeEl;
  /** Sets the committed state and rebuilds the top bar. */
  render(s: GameState): FakeEl;
  setDrive(d: OpenDrive | null): void;
}

function harness(opts: { reduced?: "on" | "off" | "system"; systemReduced?: boolean; human?: Team } = {}): Harness {
  const bar = new FakeEl("header");
  const team = (t: Team) => ({ index: SLOTS[t], name: `${t} ${NICK[t]}`, place: t, nickname: NICK[t], pool: {} });
  const game = {
    matchup: { leagueSeed: 2026, seed: 7, gameType: "regularSeason", home: team("home"), away: team("away") },
    human: opts.human ?? "home",
    state: null as GameState | null,
    request: null,
    menu: null,
    events: [],
    lastPlay: null,
    result: "",
    calls: "",
    eventLines: [],
    why: null,
    save: null,
    framePossession: null,
    shownPending: null,
    requestAt: 0,
    runoffShown: 0,
    lastSame: false,
    drive: null as OpenDrive | null,
  };
  const app = Object.create(App.prototype) as Record<string, unknown>;
  Object.assign(app, {
    root: { topBar: bar, panel: new FakeEl("div") },
    game,
    stack: [{ id: "game" }],
    settings: { textSize: 100, reducedMotion: opts.reduced ?? "off", speed: "1x" },
    reducedQuery: { matches: opts.systemReduced ?? false },
    layoutNow: layoutFor(1440, 900),
    animating: false,
    clockOverride: null,
    ui: { rules: { timeouts: { perHalf: 3 }, game: { regulationPeriods: 4, periodsPerHalf: 2 }, field: { endZoneYards: 10 } } },
    flights: new Flights(),
    bugShown: null,
    trackerShown: null,
    barTimer: undefined,
  });
  return {
    app,
    bar,
    render(s: GameState): FakeEl {
      game.state = s;
      (app["renderTopBar"] as () => void).call(app);
      return bar;
    },
    setDrive(d: OpenDrive | null): void {
      game.drive = d;
    },
  };
}
const bugOf = (bar: FakeEl): FakeEl => {
  const b = bar.querySelector(".bug");
  if (b === null) throw new Error("no .bug in the top bar");
  return b;
};
const plateFor = (h: Harness, s: GameState): FakeEl => (h.app["situationPlate"] as (g: unknown, s: GameState) => FakeEl).call(h.app, h.app["game"], s);
const trackerFor = (h: Harness, s: GameState, still = true): FakeEl => (h.app["driveTracker"] as (g: unknown, s: GameState, now: number, still: boolean) => FakeEl).call(h.app, h.app["game"], s, performance.now(), still);

// ================================================================ Layout: top bar 64, floor 800x536

describe("Layout, Top bar: 64 px, and the window floor 800x536 keeps 9.44 px per yard", () => {
  it("TOP_BAR is 64 and MIN_HEIGHT is 536 (MIN_WIDTH stays 800)", () => {
    expect(TOP_BAR).toBe(64);
    expect(MIN_HEIGHT).toBe(536);
    expect(MIN_WIDTH).toBe(800);
  });

  it("at 800x536 the field is not too small and its scale is the 9.44 px per yard floor; 1 px shorter is too small", () => {
    const l = layoutFor(800, 536);
    expect(l.tooSmall).toBe(false);
    expect(l.s).toBeCloseTo(9.44, 2);
    expect(l.field.top).toBe(64);
    expect(l.field.height).toBe(536 - 64);
    expect(layoutFor(800, 535).tooSmall).toBe(true);
    expect(layoutFor(799, 536).tooSmall).toBe(true);
    // The floor scale is what (536 - 64) / VISIBLE_YARDS gives: the bar's 8 px came out of the window floor, not the scale.
    expect((536 - 64) / VISIBLE_YARDS).toBeCloseTo(9.44, 2);
  });

  it("styles.css: the top bar is 64 px and the field layout starts under it", () => {
    expect(declsFor(".top-bar")["height"]).toBe("64px");
    expect(norm(declsFor(".layout")["inset"])).toMatch(/^64px\b/);
  });

  it("the bug is 48 px inside the 64 px bar, vertically centered (a 44 px score sits in it with room above and below)", () => {
    expect(declsFor(".bug")["height"]).toBe("48px");
    expect(declsFor(".top-bar")["align-items"]).toBe("center");
    expect(norm(declsFor(".top-bar")["padding"])).toMatch(/^0 16px/);
  });
});

// ================================================================ Tokens

describe("Tokens: the Prime Time additions chunk 1 draws with, mirrored between tokens.ts and styles.css :root", () => {
  it("color.scoreBox #07101F and color.los #3D8BFF in tokens.ts", () => {
    expect(rgba(COLOR.scoreBox)).toEqual(rgba("#07101F"));
    expect(rgba(COLOR.los)).toEqual(rgba("#3D8BFF"));
  });

  it("dur.tick is 360 ms, the other UI durations unchanged (120, 180, 260, 240)", () => {
    expect(DUR.tick).toBe(360);
    expect([DUR.fast, DUR.base, DUR.slow, DUR.screen]).toEqual([120, 180, 260, 240]);
  });

  it.each(Object.keys(COLOR))("color.%s has its kebab-case :root variable with the same value", (k) => {
    const v = rootVars[`--${kebab(k)}`];
    expect(v, `--${kebab(k)}`).toBeDefined();
    expect(rgba(v as string)).toEqual(rgba((COLOR as Record<string, string>)[k] as string));
  });

  it.each(Object.entries(DUR))("dur.%s (%i ms) is --dur-* in :root", (k, ms) => {
    expect(norm(rootVars[`--dur-${kebab(k)}`])).toBe(`${ms}ms`);
  });

  it("every --dur-* in :root is a dur token in tokens.ts (the mirror runs both ways)", () => {
    const cssDurs = Object.keys(rootVars).filter((k) => k.startsWith("--dur-")).map((k) => k.slice(6));
    expect(cssDurs.sort()).toEqual(Object.keys(DUR).map(kebab).sort());
  });

  it.each(Object.entries(RADIUS))("radius.%s (%i px) is --radius-* in :root", (k, px) => {
    expect(norm(rootVars[`--radius-${k}`])).toBe(`${px}px`);
  });

  it("the 900 ms first-down flash is the same in tokens.ts and styles.css", () => {
    expect(tokens.BUG_MOTION.firstDownFlash).toBe(900);
    expect(norm(rootVars["--first-down-flash"])).toBe("900ms");
  });

  it("--score-box and --los are in :root (the bug and the tracker read them)", () => {
    expect(norm(rootVars["--score-box"])).toBe("#07101f");
    expect(norm(rootVars["--los"])).toBe("#3d8bff");
  });
});

// ================================================================ Typography sizes

describe("Typography: display type for the bug, the plate and screen titles", () => {
  it("type.bugName: display 700 22 caps, letter-spacing 0.03em, on the bar scale", () => {
    const d = declsFor(".top-bar .name");
    expect([d["font-family"], d["font-weight"], d["text-transform"], d["letter-spacing"]]).toEqual(["var(--font-display)", "700", "uppercase", "0.03em"]);
    expect(sizeIs(d["font-size"], 22, "bar")).toBe(true);
  });

  it("type.bugScore: display 700 44 tabular, never above 44 px (it does not grow with text above 100%)", () => {
    const d = declsFor(".top-bar .score");
    expect([d["font-family"], d["font-weight"], d["font-variant-numeric"]]).toEqual(["var(--font-display)", "700", "tabular-nums"]);
    const fs = norm(d["font-size"]);
    // Either a flat 44 px or capped at 44.
    expect(fs === "44px" || /^min\(calc\(44px \* var\(--bar-scale\)\), 44px\)$/.test(fs), fs).toBe(true);
  });

  it("type.bugClock: Inter 700 24 tabular (the clock stays Inter), type.bugPeriod display 700 16 caps, type.bugDown display 700 26 caps", () => {
    const c = declsFor(".clock");
    expect(c["font-family"] ?? "var(--font-ui)").toBe("var(--font-ui)");
    expect([c["font-weight"], c["font-variant-numeric"]]).toEqual(["700", "tabular-nums"]);
    expect(sizeIs(c["font-size"], 24, "bar")).toBe(true);
    const p = declsFor(".period");
    expect([p["font-family"], p["font-weight"], p["text-transform"]]).toEqual(["var(--font-display)", "700", "uppercase"]);
    expect(sizeIs(p["font-size"], 16, "bar")).toBe(true);
    const dd = declsFor(".bar-dd");
    expect([dd["font-family"], dd["font-weight"], dd["text-transform"]]).toEqual(["var(--font-display)", "700", "uppercase"]);
    expect(sizeIs(dd["font-size"], 26, "bar")).toBe(true);
  });

  it("every bug size but the score uses --bar-scale, which is min(text scale, 1.25)", () => {
    expect(norm(rootVars["--bar-scale"] ?? declsFor(".top-bar")["--bar-scale"])).toBe("min(var(--text-scale), 1.25)");
    for (const sel of [".top-bar .name", ".clock", ".period", ".bar-dd", ".bar-spot", ".clock-state", ".top-bar .you"]) {
      expect(norm(declsFor(sel)["font-size"]), sel).toContain("var(--bar-scale)");
    }
  });

  it("type.plateDown: display 700 52 / 0.95 caps, tabular; type.plateSpot: display 600 28 / 1 caps; both on the full text scale", () => {
    const d = declsFor(".sit-dd");
    expect([d["font-family"], d["font-weight"], d["text-transform"]]).toEqual(["var(--font-display)", "700", "uppercase"]);
    expect(norm(d["line-height"])).toBe("0.95");
    expect(sizeIs(d["font-size"], 52, "text")).toBe(true);
    expect(d["font-variant-numeric"]).toBe("tabular-nums");
    const s = declsFor(".sit-yard");
    expect([s["font-family"], s["font-weight"], s["text-transform"]]).toEqual(["var(--font-display)", "600", "uppercase"]);
    expect(norm(s["line-height"])).toBe("1");
    expect(sizeIs(s["font-size"], 28, "text")).toBe(true);
    // "The situation plate follows the full text scale": never the capped bar scale.
    for (const sel of [".sit-dd", ".sit-yard", ".sit-side", ".drive-line"]) expect(norm(declsFor(sel)["font-size"]), sel).not.toContain("--bar-scale");
  });

  it("type.screenTitle: display 700 40 / 1.0 caps, letter-spacing 0.01em, then 16 px of space", () => {
    const d = declsFor(".panel h1");
    expect([d["font-family"], d["font-weight"], d["text-transform"], d["letter-spacing"]]).toEqual(["var(--font-display)", "700", "uppercase", "0.01em"]);
    expect(norm(d["line-height"])).toBe("1");
    expect(sizeIs(d["font-size"], 40, "text")).toBe(true);
    expect(norm(d["margin"])).toMatch(/^0 0 16px/);
  });

  it("no italic, oblique or skewed text anywhere in styles.css", () => {
    for (const r of rules) {
      expect(r.decls["font-style"] ?? "normal", r.selectors.join(", ")).not.toMatch(/italic|oblique/);
      expect(r.decls["transform"] ?? "", r.selectors.join(", ")).not.toMatch(/skew/i);
    }
  });
});

// ================================================================ HUD: the score bug

describe("HUD, score bug: CSS of the fused unit", () => {
  it("one unit: radius.md, overflow hidden, 1 px hairlineStrong ring, shadow.2, no gaps; segments split by 1 px hairline", () => {
    const d = declsFor(".bug");
    expect(d["border-radius"]).toBe("var(--radius-md)");
    expect(d["overflow"]).toBe("hidden");
    expect(norm(d["box-shadow"])).toContain("var(--hairline-strong)");
    expect(norm(d["box-shadow"])).toContain("var(--shadow-2)");
    expect(d["gap"] ?? "0").toBe("0");
    expect(norm(declsFor(".bug > .cell + .cell")["border-left"])).toBe("1px solid var(--hairline)");
  });

  it("name plate: padding 0 14, the light-tier inset ring 0.35 and the dark-tier ring 0.55", () => {
    expect(norm(declsFor(".cell")["padding"])).toBe("0 14px");
    expect(norm(declsFor(".plate")["box-shadow"])).toBe("inset 0 0 0 1px rgba(255, 255, 255, 0.35)");
    expect(norm(declsFor(".plate.dark")["box-shadow"])).toBe("inset 0 0 0 1px rgba(255, 255, 255, 0.55)");
  });

  it("timeouts: 14 by 4 bars, radius 2, gap 3, 4 px under the name, in the outline color; spent ones at 0.30", () => {
    const p = declsFor(".pip");
    expect([p["width"], p["height"], p["border-radius"]]).toEqual(["14px", "4px", "2px"]);
    expect(p["background"]).toBe("currentColor");
    expect(Number(p["opacity"])).toBeCloseTo(0.3, 5);
    expect(Number(declsFor(".pip.on")["opacity"] ?? "1")).toBe(1);
    expect(declsFor(".pips")["gap"]).toBe("3px");
    expect(declsFor(".plate")["gap"]).toBe("4px");
  });

  it("score box: color.scoreBox, min-width 64, padding 0 12; the score chalk in a 2ch right-aligned box", () => {
    const b = declsFor(".score-box");
    expect([b["background"], b["min-width"], norm(b["padding"])]).toEqual(["var(--score-box)", "64px", "0 12px"]);
    const s = declsFor(".top-bar .score");
    expect([s["min-width"], s["text-align"], s["color"]]).toEqual(["2ch", "right", "var(--chalk)"]);
  });

  it("possession: a 12 by 7 color.signal ellipse, 6 px left of the digits", () => {
    const d = declsFor(".poss .dot");
    expect([d["width"], d["height"], d["border-radius"], d["background"]]).toEqual(["12px", "7px", "50%", "var(--signal)"]);
    expect(declsFor(".score-box")["gap"]).toBe("6px");
  });

  it("game and down segments: color.surfaceRaised, padding 0 14", () => {
    expect(declsFor(".seg")["background"]).toBe("var(--surface-raised)");
  });
});

describe("HUD, score bug: what renderTopBar builds", () => {
  it("left to right: away plate, away score, home plate, home score, game segment, down segment", () => {
    const h = harness();
    const bug = bugOf(h.render(state()));
    const kids = bug.elements;
    expect(kids.length).toBe(6);
    expect(kids[0]?.has("plate") && kids[0].textContent.includes("Cranes")).toBe(true);
    expect(kids[1]?.has("score-box")).toBe(true);
    expect(kids[2]?.has("plate") && kids[2].textContent.includes("Outriders")).toBe(true);
    expect(kids[3]?.has("score-box")).toBe(true);
    expect(kids[4]?.has("game")).toBe(true);
    expect(kids[5]?.has("down")).toBe(true);
  });

  it("each name plate is a solid block in its team fill with text in the slot's outline color", () => {
    const bug = bugOf(harness().render(state()));
    const [away, , home] = bug.elements;
    expect(away?.style["background"]).toBe(INKS.away.fill);
    expect(away?.style["color"]).toBe(INKS.away.ring);
    expect(home?.style["background"]).toBe(INKS.home.fill);
    expect(home?.style["color"]).toBe(INKS.home.ring);
    // The dark-tier ring goes with dark-tier fills only.
    expect(away?.has("dark")).toBe(tokens.darkTier(INKS.away.fill));
    expect(home?.has("dark")).toBe(tokens.darkTier(INKS.home.fill));
  });

  it("timeout bars: one per timeout in the half, lit for those left (home 3, away 2), the count kept for screen readers", () => {
    const bug = bugOf(harness().render(state({ timeouts: { home: 3, away: 1 } } as Partial<GameState>)));
    const [away, , home] = bug.elements;
    const lit = (p: FakeEl | undefined): [number, number] => [p?.querySelectorAll(".pip").length ?? -1, p?.querySelectorAll(".pip.on").length ?? -1];
    expect(lit(away)).toEqual([3, 1]);
    expect(lit(home)).toEqual([3, 3]);
    expect(away?.querySelector(".pips")?.getAttribute("aria-label")).toMatch(/1 timeouts? left/);
  });

  it("the You tag sits on the human's plate only, after the timeout bars", () => {
    for (const human of ["home", "away"] as const) {
      const bug = bugOf(harness({ human }).render(state()));
      const [away, , home] = bug.elements;
      const mine = human === "home" ? home : away;
      const theirs = human === "home" ? away : home;
      expect(mine?.querySelectorAll(".you").length).toBe(1);
      expect(mine?.querySelector(".you")?.textContent).toBe("You");
      expect(theirs?.querySelectorAll(".you").length).toBe(0);
      const sub = mine?.querySelector(".plate-sub");
      const order = sub?.elements.map((e) => (e.has("pips") ? "pips" : e.has("you") ? "you" : "?"));
      expect(order).toEqual(["pips", "you"]);
    }
  });

  it("the score is in its own dark box per team, the possession glyph in the box of the team with the ball, before the digits", () => {
    for (const ball of ["home", "away"] as const) {
      const bug = bugOf(harness().render(state({ possession: ball, score: { home: 10, away: 7 } } as Partial<GameState>)));
      const [, awayBox, , homeBox] = bug.elements;
      expect(awayBox?.querySelector(".score")?.textContent).toBe("7");
      expect(homeBox?.querySelector(".score")?.textContent).toBe("10");
      const withBall = ball === "home" ? homeBox : awayBox;
      const without = ball === "home" ? awayBox : homeBox;
      expect(withBall?.querySelectorAll(".dot").length).toBe(1);
      expect(without?.querySelectorAll(".dot").length).toBe(0);
      // Left of the digits: the glyph's slot comes before the score in the box.
      const kids = withBall?.elements ?? [];
      const iDot = kids.findIndex((k) => k.querySelector(".dot") !== null || k.has("dot"));
      const iScore = kids.findIndex((k) => k.has("score"));
      expect(iDot).toBeGreaterThanOrEqual(0);
      expect(iDot).toBeLessThan(iScore);
      // The word "ball" stays for screen readers.
      expect(withBall?.querySelector(".visually-hidden")?.textContent).toBe("ball");
    }
  });

  it("game segment: period then clock on one line, the clock state under it", () => {
    const bug = bugOf(harness().render(state({ period: 2, clock: 893, clockRunning: false } as Partial<GameState>)));
    const game = bug.elements[4] as FakeEl;
    expect(game.querySelector(".period")?.textContent).toBe("2nd");
    expect(game.querySelector(".clock")?.textContent).toBe("14:53");
    expect(game.querySelector(".clock-state")?.textContent).toBe("Stopped");
  });

  it("down segment: the down and distance over the spot", () => {
    const bug = bugOf(harness().render(state({ down: 3, distance: 4, spot: 62 } as Partial<GameState>)));
    const down = bug.elements[5] as FakeEl;
    expect(down.querySelector(".bar-dd")?.textContent).toBe("3rd & 4");
    expect(down.querySelector(".bar-spot")?.textContent).toBe("OPP 38");
  });

  it("at Final the down segment is hidden: the bug ends at the game segment", () => {
    const bug = bugOf(harness().render(state({ phase: "final", period: 4, clock: 0, down: 0, distance: 0 } as Partial<GameState>)));
    const kids = bug.elements;
    expect(kids.length).toBe(5);
    expect(kids.at(-1)?.has("game")).toBe(true);
    expect(bug.querySelectorAll(".down").length).toBe(0);
    expect(bug.querySelectorAll(".bar-dd").length).toBe(0);
    expect(bug.querySelector(".period")?.textContent?.toUpperCase()).toBe("FINAL");
  });

  it("score, clock, down and distance and team names are never hidden by a fit step", () => {
    for (const r of topRules.filter((x) => x.selectors.some((s) => /^\.top-bar\.fit-\d+/.test(s)))) {
      if (r.decls["display"] !== "none") continue;
      for (const s of r.selectors) expect(s).not.toMatch(/\.(score|score-box|clock|bar-dd|name|plate|bug|down|game)(?![\w-])/);
    }
  });
});

// ================================================================ Motion: the bug under reduced motion

describe("How the bug moves: odometer, down swap, possession slide and first-down flash; reduced motion shows the new value at once", () => {
  const scored = (h: Harness): FakeEl => {
    h.render(state({ score: { home: 0, away: 0 } } as Partial<GameState>));
    return h.render(state({ score: { home: 7, away: 0 } } as Partial<GameState>));
  };

  it("with motion: a score change rolls the old number out and the new one in (odometer) and flashes the box", () => {
    const bar = scored(harness({ reduced: "off" }));
    const homeBox = bugOf(bar).elements[3] as FakeEl;
    const score = homeBox.querySelector(".score") as FakeEl;
    expect(score.has("odo")).toBe(true);
    expect(score.querySelector(".score-old")?.textContent).toBe("0");
    expect(score.querySelector(".score-now")?.textContent).toBe("7");
    expect(homeBox.has("flash")).toBe(true);
    // Only the scoring team's box moves.
    expect((bugOf(bar).elements[1] as FakeEl).querySelector(".score")?.has("odo")).toBe(false);
  });

  it.each([
    ["the in-game setting on", { reduced: "on" as const }],
    ["the system setting, followed", { reduced: "system" as const, systemReduced: true }],
  ])("reduced motion (%s): the new score appears at once, no odometer, no old number, no flash", (_name, o) => {
    const bar = scored(harness(o));
    const homeBox = bugOf(bar).elements[3] as FakeEl;
    const score = homeBox.querySelector(".score") as FakeEl;
    expect(score.has("odo")).toBe(false);
    expect(score.querySelectorAll(".score-old").length).toBe(0);
    expect(score.textContent).toBe("7");
    expect(homeBox.has("flash")).toBe(false);
  });

  it("with motion a down change swaps the text (old out, new in); with reduced motion it does not", () => {
    const go = (h: Harness): FakeEl => {
      h.render(state({ down: 1, distance: 10, spot: 32 } as Partial<GameState>));
      return bugOf(h.render(state({ down: 2, distance: 4, spot: 38 } as Partial<GameState>))).elements[5] as FakeEl;
    };
    const moving = go(harness({ reduced: "off" }));
    expect(moving.has("swap")).toBe(true);
    expect(moving.querySelector(".dd-old")?.textContent).toContain("1st & 10");
    const still = go(harness({ reduced: "on" }));
    expect(still.has("swap")).toBe(false);
    expect(still.querySelectorAll(".dd-old").length).toBe(0);
    expect(still.querySelector(".bar-dd")?.textContent).toBe("2nd & 4");
  });

  it("with reduced motion a change of possession moves the glyph at once (no slide)", () => {
    const h = harness({ reduced: "on" });
    h.render(state({ possession: "home" } as Partial<GameState>));
    const bug = bugOf(h.render(state({ possession: "away", spot: 25 } as Partial<GameState>)));
    const dot = (bug.elements[1] as FakeEl).querySelector(".dot");
    expect(dot).not.toBeNull();
    expect(dot?.has("slide")).toBe(false);
    expect((bug.elements[3] as FakeEl).querySelectorAll(".dot").length).toBe(0);
  });

  it("first-down flash: with motion the down segment animates; with reduced motion the signal fill shows as a state, without its fades", () => {
    // The App starts the flash from the committed play (newFirstDown, tested below); here it is
    // started the same way the App does, through its flights, to see what the bar builds.
    const flashFor = (h: Harness): FakeEl => {
      h.render(state());
      (h.app["flights"] as Flights<Record<string, string>>).start("firstDown", {}, performance.now());
      return bugOf(h.render(state())).elements[5] as FakeEl;
    };
    const moving = flashFor(harness({ reduced: "off" }));
    expect(moving.has("first-down")).toBe(true);
    expect(moving.has("first-down-still")).toBe(false);
    const still = flashFor(harness({ reduced: "on" }));
    expect(still.has("first-down")).toBe(false);
    expect(still.has("first-down-still")).toBe(true);
  });

  it("CSS: the still first-down state is color.signal with ink text and no animation of its own", () => {
    const d = declsFor(".down.first-down-still");
    expect(d["background"] ?? d["background-color"]).toBe("var(--signal)");
    expect(d["animation"]).toBeUndefined();
    expect(declsFor(".down.first-down-still .bar-dd")["color"]).toBe("var(--ink)");
  });

  it("CSS: odometer and possession slide over dur.tick ease.standard; the down swap out over dur.fast, in over dur.base ease.out", () => {
    expect(norm(declsFor(".odo .score-now")["animation"])).toMatch(/var\(--dur-tick\) var\(--ease-standard\)/);
    expect(norm(declsFor(".odo .score-old")["animation"])).toMatch(/var\(--dur-tick\) var\(--ease-standard\)/);
    expect(norm(declsFor(".poss .dot.slide")["animation"])).toMatch(/var\(--dur-tick\) var\(--ease-standard\)/);
    expect(norm(declsFor(".swap .dd-old")["animation"])).toMatch(/var\(--dur-fast\)/);
    expect(norm(declsFor(".swap .dd-now")["animation"])).toMatch(/var\(--dur-base\) var\(--ease-out\)/);
  });

  it("CSS: under both reduced-motion switches every animation and transition is none, so nothing in the bug or plate moves", () => {
    const kills = (r: Rule): boolean => /^none\b/.test(r.decls["animation"] ?? "") && /^none\b/.test(r.decls["transition"] ?? "");
    const media = rules.filter((r) => r.at.some((a) => /prefers-reduced-motion:\s*reduce/.test(a)) && kills(r)).flatMap((r) => r.selectors);
    expect(media).toContain("*");
    const inGame = topRules.filter(kills).flatMap((r) => r.selectors);
    expect(inGame).toContain(".reduce-motion *");
  });
});

// ================================================================ First down detection

describe("fx.firstDown: a new first down for the same team, not a score, not by penalty alone, not a change of possession", () => {
  const ds = (o: Partial<DownState>): DownState => ({ phase: "scrimmage", possession: "home", spot: 30, down: 1, distance: 10, goalToGo: false, ...o });

  it("a gain past the line to gain: 3rd & 3 at 60, then 1st & 10 at 65, same team", () => {
    expect(newFirstDown(ds({ down: 3, distance: 3, spot: 60 }), ds({ down: 1, distance: 10, spot: 65 }))).toBe(true);
  });

  it("a first down on 1st down (a 12-yard gain): the line to gain moved", () => {
    expect(newFirstDown(ds({ down: 1, distance: 10, spot: 30 }), ds({ down: 1, distance: 10, spot: 42 }))).toBe(true);
  });

  it("a first and goal reached by a gain counts", () => {
    expect(newFirstDown(ds({ down: 3, distance: 5, spot: 85 }), ds({ down: 1, distance: 6, spot: 94, goalToGo: true }))).toBe(true);
  });

  it("a gain short of the line is not a first down (2nd & 4 after 1st & 10)", () => {
    expect(newFirstDown(ds({ down: 1, distance: 10, spot: 30 }), ds({ down: 2, distance: 4, spot: 36 }))).toBe(false);
  });

  it("a touchdown is not a first down (the next state is the try)", () => {
    expect(newFirstDown(ds({ down: 2, distance: 8, spot: 80 }), ds({ phase: "try", down: 0, distance: 0, spot: 98 }))).toBe(false);
  });

  it("a field goal is not a first down (the next state is a kickoff)", () => {
    expect(newFirstDown(ds({ down: 4, distance: 6, spot: 70 }), ds({ phase: "kickoff", down: 0, distance: 0, spot: 35 }))).toBe(false);
  });

  it("a change of possession is not a first down for the team that lost the ball: interception, fumble, turnover on downs, punt", () => {
    // The other team's 1st & 10 after an interception.
    expect(newFirstDown(ds({ down: 2, distance: 7, spot: 45 }), ds({ possession: "away", down: 1, distance: 10, spot: 38 }))).toBe(false);
    // Turnover on downs.
    expect(newFirstDown(ds({ down: 4, distance: 2, spot: 55 }), ds({ possession: "away", down: 1, distance: 10, spot: 46 }))).toBe(false);
    // A punt returned to the 20.
    expect(newFirstDown(ds({ down: 4, distance: 9, spot: 25 }), ds({ possession: "away", down: 1, distance: 10, spot: 20 }))).toBe(false);
  });

  it("a 1st down moved back by a foul keeps its line, so it is not a new first down (1st & 10 at 30, false start, 1st & 15 at 25)", () => {
    expect(newFirstDown(ds({ down: 1, distance: 10, spot: 30 }), ds({ down: 1, distance: 15, spot: 25 }))).toBe(false);
  });

  // DESIGN.md Moments, First down: "Fires on: a new first down for the same team, not a score, not by
  // penalty alone"; the bug's down flash is that moment's second half ("Chip beside the ball as above,
  // and the bug's down flash (HUD)").
  it("by penalty alone is not a first down: 3rd & 8 at 30, defensive holding, 1st & 10 at 35 (the ball never reached the line at 38)", () => {
    expect(newFirstDown(ds({ down: 3, distance: 8, spot: 30 }), ds({ down: 1, distance: 10, spot: 35 }))).toBe(false);
    expect(newFirstDown(ds({ down: 3, distance: 8, spot: 30 }), ds({ down: 1, distance: 10, spot: 35 }), { kind: "pass", stood: false })).toBe(false);
  });

  // A penalty that carries the ball past the line (defensive pass interference at the spot of the
  // foul) leaves states that look exactly like a gain, so "not by penalty alone" needs the play:
  // the same before and after are a first down when the play stood and not when the foul replaced it.
  it("by penalty alone past the line: 3rd & 8 at 47 to 1st & 10 at 68 is a first down when the pass stood, not when DPI replaced the play", () => {
    const before = ds({ down: 3, distance: 8, spot: 47 });
    const after = ds({ down: 1, distance: 10, spot: 68 });
    expect(newFirstDown(before, after, { kind: "pass", stood: true })).toBe(true);
    expect(newFirstDown(before, after, { kind: "pass", stood: false })).toBe(false);
  });

  it("the kicking team recovers its own muffed punt: same team, 1st & 10, but no flash (a kick never earns a new first down)", () => {
    // 4th & 9 at 25, the punt is muffed by the receivers and the kicking team recovers at 60.
    expect(newFirstDown(ds({ down: 4, distance: 9, spot: 25 }), ds({ down: 1, distance: 10, spot: 60 }), { kind: "punt", stood: true })).toBe(false);
  });

  it("static: the app passes the committed play (its kind and whether it stood) to newFirstDown where it starts the flash", () => {
    const src = readFileSync(join(appDir, "src/ui/app.ts"), "utf8");
    const calls = [...src.matchAll(/newFirstDown\(([^\n]*)\)\)/g)].map((m) => m[1] as string);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c).toMatch(/^ev\.before, ev\.after, \{/);
      expect(c).toMatch(/kind: ev\.play\.kind/);
      expect(c).toMatch(/stood: /);
    }
    expect(src).toMatch(/if \(newFirstDown\([^\n]*\)\) this\.flights\.start\("firstDown"/);
  });
});

// ================================================================ Seeded games through the worker

interface StepSeen {
  readonly drive: OpenDrive | null | undefined;
  readonly state: GameState | null;
  /** The worker's box score's drives, asked for right after this step. */
  readonly boxDrives: readonly { team: Team; start: number; plays: number; period: number; result: string }[] | null;
  readonly log: readonly GameEvent[];
}

function playWithBox(seed: number, human: Team): { steps: StepSeen[]; events: GameEvent[]; finalDrives: StepSeen["boxDrives"] } {
  const sent: FromWorker[] = [];
  const session = new Session(prepared(), (m) => sent.push(structuredClone(m)));
  session.handle({ t: "newGame", leagueSeed: 2026, seed, human });
  const steps: StepSeen[] = [];
  const events: GameEvent[] = [];
  for (let guard = 0; guard < 5000; guard++) {
    const last = [...sent].reverse().find((m) => m.t === "step");
    if (last === undefined || last.t !== "step") throw new Error("no step");
    expect(isFromWorker(last), "every step passes the boundary check").toBe(true);
    events.push(...last.events);
    const before = sent.length;
    session.handle({ t: "box" });
    const box = sent.slice(before).find((m) => m.t === "box");
    steps.push({ drive: last.drive, state: last.state, boxDrives: box?.t === "box" ? (box.box.drives as StepSeen["boxDrives"]) : null, log: [...events] });
    if (last.request === null) break;
    const n = sent.length;
    session.handle({ t: "answer", answer: scriptedAnswer(last.request, seed) });
    if (sent.length === n) throw new Error("the session sent nothing back");
  }
  return { steps, events, finalDrives: steps.at(-1)?.boxDrives ?? null };
}

const SCRIMMAGE = new Set(["run", "pass", "sack", "scramble", "kneel", "spike"]);

describe("the worker's step message: drive matches the box score's drive (seeded games)", () => {
  const GAMES = [
    [41, "home"],
    [42, "away"],
    [43, "home"],
  ] as const;
  const played = GAMES.map(([seed, human]) => ({ seed, human, ...playWithBox(seed, human) }));

  it("each game ends and shows an open drive on many steps", () => {
    for (const g of played) {
      expect(g.steps.at(-1)?.state?.phase, `seed ${g.seed}`).toBe("final");
      expect(g.steps.filter((s) => s.drive != null).length, `seed ${g.seed}`).toBeGreaterThan(40);
    }
  });

  it("a drive is only sent in scrimmage, for the team with the ball, with a whole-number start and plays", () => {
    for (const g of played)
      for (const s of g.steps) {
        if (s.drive == null) continue;
        expect(s.state?.phase, `seed ${g.seed}`).toBe("scrimmage");
        expect(s.drive.team).toBe(s.state?.possession);
        expect(Number.isInteger(s.drive.start) && s.drive.start >= 0 && s.drive.start <= 100).toBe(true);
        expect(Number.isInteger(s.drive.plays) && s.drive.plays >= 0).toBe(true);
      }
  });

  it("the drive is the box score's (Drives tab) current drive at the same moment: same team, start and plays", () => {
    let compared = 0;
    for (const g of played)
      for (const s of g.steps) {
        if (s.drive == null) continue;
        const last = s.boxDrives?.at(-1);
        expect(last, `seed ${g.seed}`).toBeDefined();
        expect({ team: last?.team, start: last?.start, plays: last?.plays }, `seed ${g.seed}`).toEqual({ team: s.drive.team, start: s.drive.start, plays: s.drive.plays });
        compared++;
      }
    expect(compared).toBeGreaterThan(150);
  });

  it("every drive shown ends up in the final box score with that team and start, and at least as many plays", () => {
    for (const g of played) {
      const fin = g.finalDrives ?? [];
      for (const s of g.steps) {
        if (s.drive == null) continue;
        const d = s.drive;
        const match = fin.filter((x) => x.team === d.team && x.start === d.start && x.plays >= d.plays);
        expect(match.length, `seed ${g.seed}: ${JSON.stringify(d)}`).toBeGreaterThan(0);
      }
    }
  });

  it("within one drive the play count never goes down and grows by at most one per step", () => {
    for (const g of played) {
      let prev: OpenDrive | null = null;
      for (const s of g.steps) {
        const d = s.drive ?? null;
        if (prev !== null && d !== null && d.team === prev.team && d.start === prev.start) {
          expect(d.plays - prev.plays, `seed ${g.seed}`).toBeGreaterThanOrEqual(0);
          expect(d.plays - prev.plays, `seed ${g.seed}`).toBeLessThanOrEqual(1);
        }
        prev = d;
      }
    }
  });

  it("the log gives a drive whenever the last snap was a scrimmage play that stood, by the team still on offense in the same period: the drive is then sent", () => {
    const rules = prepared().data.engine.rules;
    let checked = 0;
    for (const g of played)
      for (const s of g.steps) {
        const st = s.state;
        if (st === null || st.phase !== "scrimmage") continue;
        const lastPlay = [...s.log].reverse().find((e): e is PlayEvent => e.t === "play");
        if (lastPlay === undefined) continue;
        const after = s.log.slice(s.log.indexOf(lastPlay) + 1);
        if (after.some((e) => e.t === "endPeriod")) continue;
        if (lastPlay.before.phase !== "scrimmage" || lastPlay.before.possession !== st.possession || lastPlay.before.period !== st.period) continue;
        if (!SCRIMMAGE.has(lastPlay.play.kind) || !playStands(lastPlay, rules)) continue;
        expect(s.drive, `seed ${g.seed}`).not.toBeNull();
        expect(s.drive).toBeDefined();
        expect(s.drive?.plays ?? 0, `seed ${g.seed}`).toBeGreaterThanOrEqual(1);
        checked++;
      }
    expect(checked).toBeGreaterThan(150);
  });

  it("no drive before the opening kickoff, on kickoffs and tries, or at Final", () => {
    for (const g of played)
      for (const s of g.steps) {
        if (s.state === null || s.state.phase !== "scrimmage") expect(s.drive ?? null, `seed ${g.seed} ${s.state?.phase ?? "toss"}`).toBeNull();
      }
  });

  // DESIGN.md Moments, First down: "not by penalty alone". Real plays from the same games: a first
  // down where the play itself did not stand and an accepted foul moved the chains.
  it("in seeded games, a first down given by an accepted foul alone (the play did not stand) never counts as a new first down", () => {
    const rules = prepared().data.engine.rules;
    const offenders: string[] = [];
    let penaltyFirsts = 0;
    for (const g of played)
      for (const e of g.events) {
        if (e.t !== "play") continue;
        if (acceptedFoul(e, rules) === null || playStands(e, rules)) continue;
        if (e.after.phase !== "scrimmage" || e.after.possession !== e.before.possession || e.after.down !== 1) continue;
        const line = e.before.goalToGo ? 100 : e.before.spot + e.before.distance;
        const lineAfter = e.after.goalToGo ? 100 : e.after.spot + e.after.distance;
        if (e.before.down === 1 && line === lineAfter) continue;
        penaltyFirsts++;
        // The play as the app passes it: its kind and whether it stood, here from the sim's own playStands.
        if (newFirstDown(e.before, e.after, { kind: e.play.kind, stood: playStands(e, rules) })) offenders.push(`seed ${g.seed}: ${e.before.down} & ${e.before.distance} at ${e.before.spot} -> 1st & ${e.after.distance} at ${e.after.spot} (${acceptedFoul(e, rules)?.foul.penalty})`);
      }
    // Precondition: the games have such plays, or this test proves nothing.
    expect(penaltyFirsts).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  // The flag on the other side: every play that stood and gained a first down by yardage, with no
  // accepted foul, still flashes (so the play argument does not switch the flash off for real gains).
  it("in seeded games, a first down gained by a play that stood with no accepted foul counts", () => {
    const rules = prepared().data.engine.rules;
    let gains = 0;
    const missed: string[] = [];
    for (const g of played)
      for (const e of g.events) {
        if (e.t !== "play" || acceptedFoul(e, rules) !== null || !playStands(e, rules)) continue;
        if (!SCRIMMAGE.has(e.play.kind)) continue;
        if (e.before.phase !== "scrimmage" || e.after.phase !== "scrimmage" || e.after.possession !== e.before.possession || e.after.down !== 1) continue;
        gains++;
        if (!newFirstDown(e.before, e.after, { kind: e.play.kind, stood: true })) missed.push(`seed ${g.seed}: ${e.before.down} & ${e.before.distance} at ${e.before.spot} -> ${e.after.spot}`);
      }
    expect(gains).toBeGreaterThan(30);
    expect(missed).toEqual([]);
  });

  // The app computes "stood" with its own helper (topbar playStood, no sim code on the UI thread);
  // it must agree with the sim's playStands on every real play, or the app's call differs from the
  // one tested above.
  it("in seeded games, the app's playStood agrees with the sim's playStands on every play", async () => {
    const { playStood } = await import("../src/ui/topbar");
    const rules = prepared().data.engine.rules;
    let n = 0;
    for (const g of played)
      for (const e of g.events) {
        if (e.t !== "play") continue;
        expect(playStood(e as unknown as Parameters<typeof playStood>[0], rules.penalties as unknown as Parameters<typeof playStood>[1]), `seed ${g.seed} ${e.play.kind}`).toBe(playStands(e, rules));
        n++;
      }
    expect(n).toBeGreaterThan(400);
  });
});

describe("protocol: the step message's drive field crosses the boundary check", () => {
  const step = (drive: unknown): Record<string, unknown> => ({ t: "step", matchup: {}, human: "home", events: [], request: null, state: null, save: {}, resumed: false, drive });
  it("accepts a drive, null, or no field", () => {
    expect(isFromWorker(step({ team: "home", start: 25, plays: 3 }))).toBe(true);
    expect(isFromWorker(step(null))).toBe(true);
    const none = step(undefined);
    delete none["drive"];
    expect(isFromWorker(none)).toBe(true);
  });
  it("rejects a malformed drive", () => {
    for (const d of [{ team: "both", start: 25, plays: 3 }, { team: "home", start: 2.5, plays: 3 }, { team: "home", start: 25 }, "drive", 7]) expect(isFromWorker(step(d)), JSON.stringify(d)).toBe(false);
  });
});

// ================================================================ Calling screen: the situation plate

describe("Calling screen, Step A: the situation plate (hud.situation)", () => {
  it("CSS: a glass card at least 96 px tall, padding 16 24, full content width over the cards", () => {
    expect(norm(declsFor(".situation-plate")["min-height"])).toMatch(/^(96px|calc\(96px \* var\(--text-scale\)\))$/);
    expect(norm(declsFor(".panel > .situation-plate")["padding"] ?? declsFor(".situation-plate")["padding"])).toBe("16px 24px");
    expect(norm(declsFor(".panel.wide > .situation-plate")["grid-column"])).toBe("1 / -1");
    // The glass card rules apply (the plate carries .glass).
    const glass = declsFor(".glass");
    expect([glass["border-radius"], glass["box-shadow"], norm(glass["border"])]).toEqual(["var(--radius-lg)", "var(--shadow-2)", "1px solid var(--hairline)"]);
  });

  it("CSS: the team edge is 6 px, full height, at the left edge, left corners rounded with the plate; the divider 1 px hairline, 48 px tall, 24 px each side", () => {
    const e = declsFor(".sit-edge");
    expect(e["width"]).toBe("6px");
    expect([e["left"], e["top"], e["bottom"]]).toEqual(["0", "0", "0"]);
    expect(norm(e["border-radius"])).toBe("var(--radius-lg) 0 0 var(--radius-lg)");
    expect(norm(e["box-shadow"])).toBe("inset 0 0 0 1px rgba(255, 255, 255, 0.35)");
    const d = declsFor(".sit-divider");
    expect([d["width"], d["height"], d["background"]]).toEqual(["1px", "48px", "var(--hairline)"]);
    expect(declsFor(".situation-plate")["column-gap"] ?? declsFor(".situation-plate")["gap"]).toBe("24px");
  });

  it("the plate reads left to right: team edge, down block, divider, spot block, drive tracker; read only (no buttons, no rows)", () => {
    const h = harness();
    const p = plateFor(h, state({ down: 1, distance: 10, spot: 32 } as Partial<GameState>));
    const order = p.elements.map((e) => e.classes.find((c) => /^(sit-edge|sit-down|sit-divider|sit-spot|tracker-wrap)$/.test(c)) ?? e.classes.join("."));
    expect(order).toEqual(["sit-edge", "sit-down", "sit-divider", "sit-spot", "tracker-wrap"]);
    expect(p.all().some((e) => e.tagName === "button" || e.has("row") || e.has("rows"))).toBe(false);
  });

  it("the team edge is the fill of the team with the ball; the down block carries that team's tint at 0.14", () => {
    for (const ball of ["home", "away"] as const) {
      const p = plateFor(harness(), state({ possession: ball } as Partial<GameState>));
      const edge = p.querySelector(".sit-edge") as FakeEl;
      expect(edge.style["background"]).toBe(INKS[ball].fill);
      expect(edge.has("dark")).toBe(tokens.darkTier(INKS[ball].fill));
      const [r, g, b] = rgba(INKS[ball].fill);
      expect(norm(String((p.querySelector(".sit-down") as FakeEl).style["background"]))).toBe(norm(`linear-gradient(90deg, rgba(${r}, ${g}, ${b}, 0.14) 0%, transparent 70%)`));
    }
  });

  it("the down block shows the same string as the bug's down segment", () => {
    for (const o of [
      { down: 1, distance: 10, spot: 32 },
      { down: 3, distance: 4, spot: 62 },
      { down: 2, distance: 0, spot: 93, goalToGo: true },
      { phase: "kickoff", down: 0, distance: 0, spot: 35 },
    ] as Partial<GameState>[]) {
      const h = harness();
      const s = state(o);
      const bugText = (bugOf(h.render(s)).querySelector(".bar-dd") as FakeEl).textContent;
      const plateText = (plateFor(h, s).querySelector(".sit-dd") as FakeEl).textContent;
      expect(plateText, JSON.stringify(o)).toBe(bugText);
    }
  });

  it("spot block: the spot from your side of the field, and under it which side you are on", () => {
    const cases: [Partial<GameState>, Team, string, string][] = [
      [{ possession: "home", spot: 32 }, "home", "OWN 32", "You're on offense"],
      [{ possession: "home", spot: 32 }, "away", "OPP 32", "You're on defense"],
      [{ possession: "home", spot: 96 }, "home", "OPP 4", "You're on offense"],
      [{ possession: "away", spot: 50 }, "home", "50", "You're on defense"],
      [{ phase: "kickoff", possession: "home", spot: 35, down: 0, distance: 0 }, "home", "OWN 35", "You're kicking off"],
      [{ phase: "kickoff", possession: "home", spot: 35, down: 0, distance: 0 }, "away", "OPP 35", "You're receiving"],
    ];
    for (const [o, human, yard, side] of cases) {
      const p = plateFor(harness({ human }), state(o));
      expect(p.querySelector(".sit-yard")?.textContent, JSON.stringify(o)).toBe(yard);
      expect(p.querySelector(".sit-side")?.textContent, JSON.stringify(o)).toBe(side);
    }
  });

  it("the call card no longer carries the down and distance or 'You're on...': they live in the plate (static read of gamePanel)", () => {
    const src = readFileSync(join(appDir, "src/ui/app.ts"), "utf8");
    const body = /private gamePanel\(\)[\s\S]*?\n {2}\}\n/.exec(src)?.[0] ?? "";
    expect(body).not.toBe("");
    // The card's own content (everything pushed to `out`) never calls the situation or side text.
    const from = body.indexOf("const out");
    const to = body.indexOf('class: "status"', from);
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const cardPart = body.slice(from, to);
    expect(cardPart).not.toMatch(/situationText|sideText|callHeader/);
    // The card opens with the breadcrumb in type.label.
    expect(cardPart).toMatch(/class: "section-label crumbs"/);
  });
});

describe("Calling screen, Step A: the drive tracker (hud.driveTracker)", () => {
  it("CSS: a mini field 44 px tall, radius.sm, 1 px hairlineStrong ring, flat turf; end zones 10/120 of the width each", () => {
    const t = declsFor(".tracker");
    expect([t["height"], t["border-radius"], t["background"]]).toEqual(["44px", "var(--radius-sm)", "var(--turf)"]);
    expect(norm(t["box-shadow"] ?? t["border"])).toMatch(/1px (solid )?var\(--hairline-strong\)/);
    expect(norm(declsFor(".tk-ez")["width"])).toMatch(/^(calc\(100% \/ 12\)|8\.333+%)$/);
  });

  it("CSS: yard lines 1 px color.line at 0.35, the 50 at 0.6; first-down line signal 3 px and LOS color.los 3 px, each cased 1 px outlineDark", () => {
    const yl = declsFor(".tk-yl");
    expect(yl["width"]).toBe("1px");
    expect(rgba(yl["background"] ?? "")).toEqual([245, 247, 242, 0.35]);
    expect(rgba(declsFor(".tk-yl.mid")["background"] ?? "")).toEqual([245, 247, 242, 0.6]);
    const fd = { ...declsFor(".tk-fd, .tk-los"), ...declsFor(".tk-fd") };
    const los = { ...declsFor(".tk-fd, .tk-los"), ...declsFor(".tk-los") };
    for (const [d, color] of [
      [fd, "var(--signal)"],
      [los, "var(--los)"],
    ] as const) {
      expect(d["background"]).toBe(color);
      expect(d["width"] ?? declsFor(".tk-fd")["width"] ?? declsFor(".tk-los")["width"]).toBe("3px");
    }
    // The casing: the shared rule (.tk-fd, .tk-los) has it.
    const shared = topRules.find((r) => r.selectors.includes(".tk-fd") && r.selectors.includes(".tk-los"))?.decls ?? {};
    expect(norm(shared["box-shadow"] ?? shared["border"] ?? shared["outline"])).toMatch(/1px (solid )?var\(--outline-dark\)/);
  });

  it("CSS: the ball is an 8 by 5 color.ball ellipse with a 1.5 px color.line outline", () => {
    const b = declsFor(".tracker > .tk-ball");
    expect([b["width"], b["height"], b["border-radius"], b["background"]]).toEqual(["8px", "5px", "50%", "var(--ball)"]);
    expect(norm(b["box-shadow"] ?? b["border"])).toContain("1.5px");
    expect(norm(b["box-shadow"] ?? b["border"])).toContain("var(--line)");
  });

  it("CSS: the drive line is type.small chalkSoft, 4 px under the tracker", () => {
    const d = declsFor(".drive-line");
    expect(norm(d["margin"] ?? d["margin-top"])).toMatch(/^4px\b/);
    expect(sizeIs(d["font-size"], 12, "text")).toBe(true);
    expect(d["font-weight"]).toBe("500");
    expect(d["color"]).toBe("var(--chalk-soft)");
  });

  it("the team with the ball attacks right: the left end zone is its own end zone color, the right one its opponent's", () => {
    for (const ball of ["home", "away"] as const) {
      const t = trackerFor(harness(), state({ possession: ball } as Partial<GameState>));
      const ez = t.querySelectorAll(".tk-ez");
      expect(ez.length).toBe(2);
      const left = ez.find((e) => e.has("left"));
      const right = ez.find((e) => e.has("right"));
      expect(left?.style["background"]).toBe(INKS[ball].endZone);
      expect(right?.style["background"]).toBe(INKS[ball === "home" ? "away" : "home"].endZone);
    }
  });

  it("the LOS and the ball at the spot, the first-down line at the line to gain, in a frame where 0 to 100 sits between the end zones", () => {
    const t = trackerFor(harness(), state({ spot: 32, distance: 10 } as Partial<GameState>));
    const left = (cls: string): string => String(t.querySelector(cls)?.style["left"] ?? "");
    const pct = (yards: number): number => ((10 + yards) / 120) * 100;
    expect(parseFloat(left(".tk-los"))).toBeCloseTo(pct(32), 3);
    expect(parseFloat(left(".tk-ball"))).toBeCloseTo(pct(32), 3);
    expect(parseFloat(left(".tk-fd"))).toBeCloseTo(pct(42), 3);
    // Yard lines every 10, 0 through 100, the 50 marked.
    expect(t.querySelectorAll(".tk-yl").length).toBe(11);
    expect(t.querySelectorAll(".tk-yl.mid").length).toBe(1);
  });

  it("no first-down line when goal to go", () => {
    const t = trackerFor(harness(), state({ spot: 94, distance: 6, goalToGo: true } as Partial<GameState>));
    expect(t.querySelectorAll(".tk-fd").length).toBe(0);
    expect(t.querySelectorAll(".tk-los").length).toBe(1);
  });

  it("no text inside the tracker itself", () => {
    const h = harness();
    h.setDrive({ team: "home", start: 10, plays: 3 });
    const wrap = trackerFor(h, state({ spot: 32 } as Partial<GameState>));
    const tk = wrap.querySelector(".tracker") as FakeEl;
    expect(tk.textContent).toBe("");
  });

  it("the drive band runs from where this drive started to the ball, in the fill of the team with the ball at 0.40", () => {
    const h = harness();
    h.setDrive({ team: "home", start: 10, plays: 3 });
    const t = trackerFor(h, state({ spot: 32 } as Partial<GameState>));
    const band = t.querySelector(".tk-band") as FakeEl;
    expect(band).not.toBeNull();
    expect(parseFloat(String(band.style["left"]))).toBeCloseTo(((10 + 10) / 120) * 100, 3);
    expect(parseFloat(String(band.style["width"]))).toBeCloseTo((22 / 120) * 100, 3);
    const [r, g, b] = rgba(INKS.home.fill);
    expect(rgba(String(band.style["background"]))).toEqual([r, g, b, 0.4]);
  });

  it("with drive data: 'Drive: 3 plays, 22 yds', from the drive's start to the ball", () => {
    const h = harness();
    h.setDrive({ team: "home", start: 10, plays: 3 });
    const line = trackerFor(h, state({ spot: 32 } as Partial<GameState>)).querySelector(".drive-line");
    expect(line?.textContent).toBe("Drive: 3 plays, 22 yds");
  });

  it("the drive line is hidden when there is no drive data", () => {
    const h = harness();
    h.setDrive(null);
    const wrap = trackerFor(h, state({ spot: 32 } as Partial<GameState>));
    expect(wrap.querySelectorAll(".drive-line").length).toBe(0);
    expect(wrap.querySelectorAll(".tk-band").length).toBe(0);
    expect(wrap.querySelectorAll(".tracker").length).toBe(1);
  });

  it("the drive line is hidden on the first play of a drive (no plays yet)", () => {
    const h = harness();
    h.setDrive({ team: "home", start: 32, plays: 0 });
    expect(trackerFor(h, state({ spot: 32 } as Partial<GameState>)).querySelectorAll(".drive-line").length).toBe(0);
  });

  it("the drive line is hidden when the drive belongs to the other team (the log does not give this team's)", () => {
    const h = harness();
    h.setDrive({ team: "away", start: 20, plays: 5 });
    expect(trackerFor(h, state({ possession: "home", spot: 32 } as Partial<GameState>)).querySelectorAll(".drive-line").length).toBe(0);
  });

  it("on a kickoff there is no drive line", () => {
    const h = harness();
    h.setDrive({ team: "home", start: 20, plays: 5 });
    expect(trackerFor(h, state({ phase: "kickoff", spot: 35, down: 0, distance: 0 } as Partial<GameState>)).querySelectorAll(".drive-line").length).toBe(0);
  });

  it("the tracker hides under 280 px (the plate keeps down and spot)", () => {
    const h = harness();
    const panel = (h.app["root"] as { panel: FakeEl }).panel;
    const wrap = new FakeEl("div");
    wrap.setAttribute("class", "tracker-wrap");
    wrap.clientWidth = 279;
    panel.append(wrap);
    (h.app["fitTracker"] as () => void).call(h.app);
    expect(wrap.hidden).toBe(true);
    const wide = new FakeEl("div");
    wide.setAttribute("class", "tracker-wrap");
    wide.clientWidth = 280;
    panel.replaceChildren(wide);
    (h.app["fitTracker"] as () => void).call(h.app);
    expect(wide.hidden).toBe(false);
    expect(declsFor(".tracker-wrap[hidden]")["display"]).toBe("none");
  });
});

// ================================================================ Rows: the gold focus ring

describe("Rows: keyboard focus on a row is 2 px color.gold, offset 2 px, only for :focus-visible", () => {
  it(".row:focus-visible: 2px solid var(--gold), offset 2px", () => {
    const d = declsFor(".row:focus-visible");
    expect(norm(d["outline"])).toBe("2px solid var(--gold)");
    expect(d["outline-offset"]).toBe("2px");
  });

  it("no rule draws a chalk ring on a row's focus (the hard cream border is gone), and no row uses :focus without -visible", () => {
    for (const r of topRules) {
      const rowFocus = r.selectors.filter((s) => /\.row\b[^ ]*:focus/.test(s));
      if (rowFocus.length === 0) continue;
      for (const s of rowFocus) expect(s, "focus ring only for :focus-visible").toMatch(/:focus-visible/);
      for (const k of ["outline", "outline-color", "box-shadow", "border", "border-color"]) expect(r.decls[k] ?? "", `${rowFocus.join(", ")} ${k}`).not.toMatch(/--chalk\b|245, 242, 232|#f5f2e8/i);
    }
  });

  it("the selected row is never ringed in chalk either (selected, hovered, the travelling highlight)", () => {
    for (const r of topRules.filter((x) => x.selectors.some((s) => /\.row(\.hl|:hover)|\.row-hl/.test(s)))) {
      for (const k of ["outline", "box-shadow", "border"]) expect(r.decls[k] ?? "", `${r.selectors.join(", ")} ${k}`).not.toMatch(/--chalk\b/);
    }
  });
});
