// Engineer's tests for chunk 4 of the "Prime Time" revision (DESIGN.md Build order item 4): the
// front door. The face-off band, the tale of the tape and the line score (pregame.faceoff,
// menu.scoreHero, hud.lineScore), the matchup intro, the main menu hero and its entrance, the
// screen push and sheet motion, the pregame status copy, and their tokens and contrast. The DOM is
// a tiny fake (the same as prime-time-chunk1.spec.test.ts); the CSS is read statically.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/ui/app";
import { faceoffBand, lineScoreTable, taleOfTape, COUNT_UP_MS, type FaceoffTeam } from "../src/ui/faceoff";
import { INTRO, matchupIntro } from "../src/ui/intro";
import { blend, contrast, rgbOf } from "../src/ui/overlay";
import { CHIP_RING, COLOR, darkTier, matchupInk, MENU_ENTER, SWATCHES, TEAM_OUTLINE } from "../src/ui/tokens";

const appDir = join(import.meta.dirname, "..");
const css = readFileSync(join(appDir, "src/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const appSource = readFileSync(join(appDir, "src/ui/app.ts"), "utf8");
const norm = (v: string | undefined): string => (v ?? "").replace(/\s+/g, " ").trim();
/** The declarations of the first top-level rule with exactly this selector. */
function declsFor(sel: string): Record<string, string> {
  const re = new RegExp(`(^|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m");
  const m = re.exec(css);
  if (m === null) throw new Error(`no rule ${sel}`);
  const out: Record<string, string> = {};
  for (const d of (m[2] as string).split(";")) {
    const k = d.indexOf(":");
    if (k > 0) out[d.slice(0, k).trim()] = d.slice(k + 1).trim();
  }
  return out;
}
const rootVar = (name: string): string => norm(new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]);

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
    for (const n of nodes) {
      const c = typeof n === "string" ? new FakeText(n) : n;
      if (c instanceof FakeEl) c.parent = this;
      this.children.push(c);
    }
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
  parent: FakeEl | null = null;
  remove(): void {
    if (this.parent !== null) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(): void {}
  get dataset(): Record<string, string> {
    return Object.fromEntries([...this.attrs].filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5), v]));
  }
  has(cls: string): boolean {
    return this.classes.includes(cls);
  }
}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g["document"] = { createElement: (t: string) => new FakeEl(t), createTextNode: (s: string) => new FakeText(s) };
});

const inks = matchupInk(1, 0);
const TEAMS: Record<"away" | "home", FaceoffTeam> = {
  away: { fill: inks.away.fill, ring: inks.away.ring, place: "Glass Lake", nickname: "Cranes" },
  home: { fill: inks.home.fill, ring: inks.home.ring, place: "Sundown Gulch", nickname: "Outriders" },
};

// ---------------------------------------------------------------- the face-off band

describe("pregame.faceoff and menu.scoreHero: the face-off band", () => {
  it("away half left, home half right, in their fills with the outline color for every word; the VS disc", () => {
    const band = faceoffBand(TEAMS, { you: "home" }) as unknown as FakeEl;
    const [away, home, vs] = band.elements;
    expect(away?.has("away") && away.has("fo-half")).toBe(true);
    expect(home?.has("home")).toBe(true);
    expect(away?.styleProps.get("--team-fill")).toBe(TEAMS.away.fill);
    expect(away?.style["color"]).toBe(TEAMS.away.ring);
    expect(home?.styleProps.get("--team-fill")).toBe(TEAMS.home.fill);
    expect(home?.style["color"]).toBe(TEAMS.home.ring);
    expect(away?.has("dark")).toBe(darkTier(TEAMS.away.fill));
    expect(away?.textContent).toBe("AwayGlass LakeCranes");
    expect(home?.querySelector(".you")?.textContent).toBe("You");
    expect(away?.querySelector(".you")).toBeNull();
    expect(vs?.has("fo-vs") && vs.textContent === "VS").toBe(true);
    expect(band.getAttribute("aria-label")).toBe("Glass Lake Cranes at Sundown Gulch Outriders");
  });

  it("the score hero puts each score beside its nickname (the count-up's target in data-to)", () => {
    const band = faceoffBand(TEAMS, { you: "away", scores: { away: 17, home: 24 } }) as unknown as FakeEl;
    const scores = band.querySelectorAll(".fo-score");
    expect(scores.map((s) => s.textContent)).toEqual(["17", "24"]);
    expect(scores.map((s) => s.getAttribute("data-to"))).toEqual(["17", "24"]);
    expect(band.getAttribute("aria-label")).toBe("Cranes 17, Outriders 24");
    expect(COUNT_UP_MS).toBe(600);
  });

  it("CSS: 200 px tall, radius.lg, shadow.3, a 12-degree seam (21 px at 200 px), halves with gradient.teamBlock and the tier's inset ring", () => {
    const d = declsFor(".faceoff");
    expect(d["--fo-h"]).toBe("200px");
    expect(norm(d["--seam"])).toBe("calc(var(--fo-h) * 0.105)");
    expect(200 * 0.105).toBeCloseTo(21, 6);
    // tan(12 degrees) * 200 / 2 is about 21: the seam's slant.
    expect(Math.tan((12 * Math.PI) / 180) * 100).toBeCloseTo(21.3, 1);
    expect(d["border-radius"]).toBe("var(--radius-lg)");
    expect(d["box-shadow"]).toBe("var(--shadow-3)");
    expect(d["overflow"]).toBe("hidden");
    const half = declsFor(".fo-half");
    expect(norm(half["background"])).toBe("var(--sheen), var(--team-fill)");
    expect(norm(half["box-shadow"])).toBe(`inset 0 0 0 1px ${CHIP_RING.light}`);
    expect(norm(declsFor(".fo-half.dark")["box-shadow"])).toBe(`inset 0 0 0 1px ${CHIP_RING.dark}`);
    expect(half["padding"]).toBe("32px");
    expect(css).toMatch(/@media \(max-width: 963px\)\s*\{\s*\.faceoff\s*\{\s*--fo-h: 160px;/);
  });

  it("type: faceoffName display 700 64 px caps, faceoffScore display 700 96 px tabular, the VS disc 64 px scoreBox with display 700 28 px", () => {
    const n = declsFor(".fo-name");
    expect([n["font-family"], n["font-weight"], norm(n["font-size"]), n["line-height"], n["text-transform"]]).toEqual(["var(--font-display)", "700", "calc(64px * var(--text-scale))", "0.95", "uppercase"]);
    const s = declsFor(".fo-score");
    expect([s["font-weight"], norm(s["font-size"]), s["line-height"], s["font-variant-numeric"]]).toEqual(["700", "calc(96px * var(--text-scale))", "0.9", "tabular-nums"]);
    const v = declsFor(".fo-vs");
    expect([v["width"], v["height"], v["background"], v["border"], v["box-shadow"], v["font-size"], v["color"]]).toEqual(["64px", "64px", "var(--score-box)", "1px solid var(--hairline-strong)", "var(--shadow-3)", "28px", "var(--chalk)"]);
  });

  it("contrast: the outline color on every team fill under the sheen's brightest pixel (large text, 3:1 needed) and VS chalk on scoreBox 17.0", () => {
    SWATCHES.forEach((fill, i) => expect(contrast(rgbOf(TEAM_OUTLINE[i] as string), blend(rgbOf("#FFFFFF"), rgbOf(fill), 0.05)), fill).toBeGreaterThanOrEqual(4.5));
    expect(contrast(rgbOf(COLOR.chalk), rgbOf(COLOR.scoreBox))).toBeCloseTo(17.0, 0);
  });
});

// ---------------------------------------------------------------- the tale of the tape and the line score

describe("the tale of the tape and the line score", () => {
  it("per unit: the higher value in chalk (both on a tie), bars outward in each team's fill, value/100 of the space, the values printed", () => {
    const tape = taleOfTape([{ label: "Offense", away: 67, home: 66 }, { label: "Defense", away: 68, home: 68 }], { away: TEAMS.away.fill, home: TEAMS.home.fill }) as unknown as FakeEl;
    const [off, def] = tape.elements;
    const vals = (r: FakeEl | undefined) => r?.querySelectorAll(".tape-val").map((v) => [v.textContent, v.has("lead")]);
    expect(vals(off)).toEqual([["67", true], ["66", false]]);
    expect(vals(def)).toEqual([["68", true], ["68", true]]);
    const fills = off?.querySelectorAll(".tape-fill") ?? [];
    expect(fills.map((f) => [f.style["background"], f.style["width"]])).toEqual([[TEAMS.away.fill, "67%"], [TEAMS.home.fill, "66%"]]);
    expect(off?.querySelector(".tape-label")?.textContent).toBe("Offense");
    expect(off?.getAttribute("aria-label")).toBe("Offense: away 67, home 66");
    const bar = declsFor(".tape-bar");
    expect([bar["height"], bar["border-radius"], bar["background"]]).toEqual(["8px", "4px", "var(--track)"]);
    expect(declsFor(".tape-val")["font-variant-numeric"]).toBe("tabular-nums");
    expect(norm(declsFor(".tape-val")["font-size"])).toBe("calc(28px * var(--text-scale))");
  });

  it("the line score: swatch and nickname, one column per period, then the total", () => {
    const t = lineScoreTable({ heads: ["1st", "2nd", "3rd", "4th", "OT"], rows: { away: { fill: TEAMS.away.fill, nickname: "Cranes", byPeriod: [7, 0, 3, 7, 0], total: 17 }, home: { fill: TEAMS.home.fill, nickname: "Outriders", byPeriod: [0, 10, 7, 0, 3], total: 20 } } }) as unknown as FakeEl;
    const rows = t.elements;
    expect(rows[0]?.textContent).toBe("1st2nd3rd4thOTT");
    expect(rows[1]?.textContent).toBe(" Cranes7037017");
    expect(rows[2]?.querySelector(".ls-total")?.textContent).toBe("20");
    expect(rows[1]?.querySelector(".swatch")).not.toBeNull();
  });
});

// ---------------------------------------------------------------- the matchup intro

describe("moment.matchupIntro", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as unknown as Record<string, unknown>)["window"] = { setTimeout, clearTimeout };
  });
  afterEach(() => vi.useRealTimers());

  it("DESIGN's timings: halves in 0 to 300 ms, names at 200 to 420, VS at 500, shrink 1900 to 2300; mirrored in styles.css", () => {
    expect(INTRO).toMatchObject({ wipeMs: 300, slamAt: 200, slamMs: 220, vsAt: 500, shrinkAt: 1900, shrinkMs: 400, totalMs: 2300 });
    expect(INTRO.slamAt + INTRO.slamMs).toBe(420);
    expect(INTRO.shrinkAt + INTRO.shrinkMs).toBe(INTRO.totalMs);
    for (const [v, ms] of [["--intro-wipe", 300], ["--intro-slam-at", 200], ["--intro-slam", 220], ["--intro-vs-at", 500], ["--intro-shrink-at", 1900], ["--intro-shrink", 400]] as const) expect(rootVar(v), v).toBe(`${ms}ms`);
    expect(norm(declsFor(".intro-slot .fo-words")["animation"])).toContain("var(--ease-slam)");
  });

  it("ends by itself at 2300 ms; a skip ends it at once, once; either way the overlay is gone", () => {
    const parent = new FakeEl("body");
    const done = vi.fn();
    const it1 = matchupIntro(TEAMS, "home", () => ({ away: null, home: null }), done);
    parent.append(it1.el as unknown as FakeEl);
    vi.advanceTimersByTime(INTRO.totalMs - 1);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(0);
    const done2 = vi.fn();
    const it2 = matchupIntro(TEAMS, "home", () => ({ away: null, home: null }), done2);
    parent.append(it2.el as unknown as FakeEl);
    it2.skip();
    it2.skip();
    vi.advanceTimersByTime(5000);
    expect(done2).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(0);
  });

  it("each half lands on its name plate: translate and scale from the half's rect to the plate's", () => {
    const it1 = matchupIntro(TEAMS, "away", () => ({ away: { left: 16, top: 8, width: 120, height: 48 } as DOMRect, home: null }), () => undefined);
    const slot = (it1.el as unknown as FakeEl).querySelector(".intro-slot.away") as FakeEl;
    slot.getBoundingClientRect = () => ({ left: 0, top: 300, width: 640, height: 240 });
    it1.land();
    expect([slot.styleProps.get("--to-x"), slot.styleProps.get("--to-y"), slot.styleProps.get("--to-sx"), slot.styleProps.get("--to-sy")]).toEqual(["16px", "-292px", String(120 / 640), String(48 / 240)]);
    it1.skip();
  });

  it("the app starts it on a fresh game only (never on a resume, never with reduced motion) and any key skips it", () => {
    expect(appSource).toMatch(/if \(fresh && !m\.resumed && !this\.reducedMotion\(\)\) this\.startIntro\(g\);/);
    const onKey = appSource.slice(appSource.indexOf("private onKey("), appSource.indexOf("private onKey(") + 700);
    expect(onKey).toMatch(/if \(this\.intro != null\) \{[\s\S]*this\.intro\.skip\(\);[\s\S]*return;/);
  });
});

describe("matchup intro review fixes", () => {
  function keyApp() {
    const skip = vi.fn();
    const app = Object.create(App.prototype) as Record<string, unknown>;
    Object.assign(app, { intro: { skip } });
    const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) => {
      const e = { key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault: vi.fn(), ...mods };
      (app["onKey"] as (e: unknown) => void).call(app, e);
      return e;
    };
    return { skip, key };
  }

  it("any key skips the intro; a plain key is consumed, but modifier shortcuts and Tab keep their browser meaning", () => {
    for (const [k, mods, cancelled] of [[" ", {}, true], ["Enter", {}, true], ["r", { metaKey: true }, false], ["w", { ctrlKey: true }, false], ["Tab", {}, false], ["ArrowLeft", { altKey: true }, false]] as const) {
      const a = keyApp();
      const e = a.key(k, mods);
      expect(a.skip, k).toHaveBeenCalledTimes(1);
      expect(e.preventDefault.mock.calls.length > 0, `${k} cancelled`).toBe(cancelled);
    }
  });

  it("the VS disc leaves with the halves: it scales away over the same 400 ms from 1900 ms (no fade-out)", () => {
    const anim = norm(declsFor(".intro-band > .fo-vs")["animation"]);
    expect(anim).toContain("intro-vs-out var(--intro-shrink) var(--ease-standard) var(--intro-shrink-at) forwards");
    expect(css).toMatch(/@keyframes intro-vs-out\s*\{\s*to\s*\{\s*transform: scale\(0\);\s*\}/);
  });

  it("a fresh or resumed game resets the score hero's clock, so its end screen slides and counts up again", () => {
    const fresh = appSource.slice(appSource.indexOf("if (fresh) {"), appSource.indexOf("if (fresh) {") + 900);
    expect(fresh).toMatch(/this\.heroAt = null;/);
  });
});

// ---------------------------------------------------------------- main menu hero, entrance, pushes, sheets

describe("menu.hero, menu.enter, screen push and sheets", () => {
  it("menu.enter's timings (400 ms rise of 12 px, the bar from 200 ms over dur.base, the rows from 240 ms) are mirrored in :root", () => {
    expect(MENU_ENTER).toEqual({ wordmarkMs: 400, ruleAt: 200, rowsAt: 240, risePx: 12 });
    expect([rootVar("--menu-enter"), rootVar("--menu-enter-rule-at"), rootVar("--menu-enter-rows-at"), rootVar("--menu-hero-size")]).toEqual(["400ms", "200ms", "240ms", "88px"]);
    expect(css).toMatch(/@keyframes hero-in\s*\{\s*from\s*\{\s*opacity: 0;\s*transform: translateY\(12px\);/);
    expect(norm(declsFor(".menu-frame.enter .menu-rule")["animation"])).toContain("var(--dur-base)");
  });

  it("screen push: in from 24 px right, Back from 24 px left, a fade over dur.screen ease.out; sheets rise 12 px over dur.slow", () => {
    expect(norm(declsFor(".menu-frame.push-in")["animation"])).toBe("push-in var(--dur-screen) var(--ease-out) both");
    expect(norm(declsFor(".menu-frame.push-back")["animation"])).toBe("push-back var(--dur-screen) var(--ease-out) both");
    expect(css).toMatch(/@keyframes push-in\s*\{\s*from\s*\{\s*opacity: 0;\s*transform: translateX\(24px\);/);
    expect(css).toMatch(/@keyframes push-back\s*\{\s*from\s*\{\s*opacity: 0;\s*transform: translateX\(-24px\);/);
    expect(norm(declsFor(".panel.sheet-in")["animation"])).toBe("sheet-in var(--dur-slow) var(--ease-out) both");
  });

  function menuApp(reduced = false) {
    const app = Object.create(App.prototype) as Record<string, unknown>;
    Object.assign(app, { fatal: null, loading: null, stack: [{ id: "title" }], settings: { reducedMotion: reduced ? "on" : "off" }, reducedQuery: { matches: false }, heroEnter: undefined, menuShown: null });
    const show = (top: unknown): FakeEl => {
      const frame = new FakeEl("div");
      frame.append(new FakeEl("div"));
      frame.elements[0]?.setAttribute("class", "rows");
      (app["menuMotion"] as (f: unknown, t: unknown) => void).call(app, frame, top);
      return frame;
    };
    return { app, show };
  }

  it("the main menu's entrance runs on its first show only; a deeper screen pushes in, Back pushes back; a rebuild starts nothing", () => {
    const { app, show } = menuApp();
    const title = (app["stack"] as unknown[])[0];
    const first = show(title);
    expect(first.has("enter")).toBe(true);
    expect(first.querySelector(".rows")?.has("enter")).toBe(true);
    expect(Number.parseFloat(first.querySelector(".rows")?.styleProps.get("--since") ?? "")).toBeLessThanOrEqual(-MENU_ENTER.rowsAt + 50);
    // Past the entrance: Settings opens (one deeper), then Back.
    app["heroEnter"] = null;
    const settings = { id: "settings" };
    app["stack"] = [title, settings];
    expect(show(settings).has("push-in")).toBe(true);
    expect(show(settings).classes).not.toContain("push-in");
    app["stack"] = [title];
    const back = show(title);
    expect(back.has("push-back")).toBe(true);
    expect(back.has("enter")).toBe(false);
  });

  it("reduced motion: no entrance and no push", () => {
    const { app, show } = menuApp(true);
    const title = (app["stack"] as unknown[])[0];
    expect(show(title).classes).toEqual([]);
    app["stack"] = [title, { id: "settings" }];
    expect(show((app["stack"] as unknown[])[1]).classes).toEqual([]);
  });

  it("the hero wordmark is two lines, CLIPBOARD over FOOTBALL, 56 px under a 720 px frame or at 150% text", () => {
    expect(appSource).toMatch(/h\("span", \{ class: "wm-line" \}, "Clipboard"\), " ", h\("span", \{ class: "wm-line" \}, "Football"\)/);
    expect(appSource).toMatch(/window\.innerWidth - 64 < 720 \|\| this\.settings\.textSize >= 150 \? "wordmark small" : "wordmark"/);
    expect(declsFor(".wordmark .wm-line")["display"]).toBe("block");
  });
});

describe("the score hero on the halftime and end screens", () => {
  it("the band with the scores, then the line score with an OT column when overtime was played (reduced motion: final numbers)", () => {
    const app = Object.create(App.prototype) as Record<string, unknown>;
    const team = (t: "home" | "away", index: number) => ({ index, name: t, place: t === "home" ? "Sundown Gulch" : "Glass Lake", nickname: t === "home" ? "Outriders" : "Cranes", pool: { players: [] } });
    const play = (period: number, before: Record<"home" | "away", number>, after: Record<"home" | "away", number>) => ({ t: "play", before: { period, score: before }, after: { period, score: after } });
    const game = {
      matchup: { home: team("home", 0), away: team("away", 1) },
      human: "home",
      state: { period: 5, score: { home: 23, away: 20 } },
      events: [play(1, { home: 0, away: 0 }, { home: 7, away: 0 }), play(3, { home: 7, away: 0 }, { home: 7, away: 20 }), play(4, { home: 7, away: 20 }, { home: 20, away: 20 }), play(5, { home: 20, away: 20 }, { home: 23, away: 20 })],
    };
    Object.assign(app, { ui: { rules: { game: { regulationPeriods: 4 } } }, heroAt: null, settings: { reducedMotion: "on" }, reducedQuery: { matches: false } });
    const [band, table] = (app["scoreHero"] as (g: unknown, id: string) => FakeEl[]).call(app, game, "end");
    expect(band?.querySelectorAll(".fo-score").map((e) => e.textContent)).toEqual(["20", "23"]);
    expect(band?.has("hero-in")).toBe(false);
    const rows = table?.elements ?? [];
    expect(rows[0]?.textContent).toBe("1st2nd3rd4thOTT");
    expect(rows[1]?.querySelectorAll(".ls-q").map((e) => e.textContent)).toEqual(["0", "0", "20", "0", "0"]);
    expect(rows[2]?.querySelectorAll(".ls-q").map((e) => e.textContent)).toEqual(["7", "0", "0", "13", "3"]);
    expect(rows[2]?.querySelector(".ls-total")?.textContent).toBe("23");
  });
});

// ---------------------------------------------------------------- pregame status copy

describe("pregame status copy is words only", () => {
  it("the old save's storage key goes to the log; the screen says 'Your old save is kept.'", () => {
    expect(appSource).toContain('"Your old save is kept."');
    expect(appSource).not.toMatch(/kept aside as \$\{key\}\.`;/);
  });
});
