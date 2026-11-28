// Spec tests for chunk 4 of the "Prime Time" revision in DESIGN.md (art-director, 2026-11-15), written
// by test-writer from DESIGN.md, not the implementation. "Build order (Prime Time)" item 4, the front
// door: the main menu hero wordmark and its entrance; the screen push and the sheet rise; the pregame
// face-off and tale of the tape; the matchup intro into the bug; the halftime and final score hero
// with the line score; the pregame status copy in words. Every expected value is typed in from
// DESIGN.md (Main menu, Pregame: the face-off, Halftime and end of game, Moments: Matchup intro,
// Motion: Screen transitions, Typography).
//
// No jsdom: styles.css is read with a brace-aware reader that keeps @media context; the DOM
// builders (faceoff.ts, intro.ts) and the App's own methods (Object.create(App.prototype), only the
// fields each method reads set) run against a small fake DOM written here.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { App } from "../src/ui/app";
import { COUNT_UP_MS, faceoffBand, lineScoreTable, taleOfTape, type FaceoffTeam } from "../src/ui/faceoff";
import { INTRO, matchupIntro } from "../src/ui/intro";
import { COLOR, darkTier, DUR, matchupInk } from "../src/ui/tokens";
import type { GameEvent } from "../src/engine/types";

const appDir = join(import.meta.dirname, "..");
const css = readFileSync(join(appDir, "src/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const appSource = readFileSync(join(appDir, "src/ui/app.ts"), "utf8");

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
function declsFor(selector: string, at?: RegExp): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rules) if (r.selectors.includes(selector) && (at === undefined ? r.at.length === 0 : r.at.some((a) => at.test(a)))) Object.assign(out, r.decls);
  return out;
}
const kf = (name: string, sel: string): Record<string, string> => rules.find((r) => r.at.includes(`@keyframes ${name}`) && r.selectors.includes(sel))?.decls ?? {};
const norm = (s: string | undefined): string =>
  (s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(^|[^#0-9a-z])(\d*\.\d+|\d+)(?=[^0-9a-z#]|px|ms|%|deg|em|$)/g, (_m, pre: string, n: string) => `${pre}${String(Number(n))}`)
    .trim();
/** A value with :root custom properties substituted (not --text-scale or the flight's --since). */
function resolve(v: string | undefined): string {
  let s = v ?? "";
  for (let i = 0; i < 10; i++) {
    const next = s.replace(/var\((--[a-z0-9-]+)\)/gi, (whole, name: string) => (name === "--text-scale" || name === "--since" ? whole : (rootVars[name] ?? whole)));
    if (next === s) break;
    s = next;
  }
  return s;
}
/** "anim-name 400ms ease delay": [name, duration ms, easing, delay text] of an animation shorthand, vars resolved. */
function anim(v: string | undefined): { name: string; ms: number; ease: string; rest: string } {
  const r = norm(resolve(v));
  const name = r.split(" ")[0] ?? "";
  const ms = Number(/(\d+(?:\.\d+)?)ms/.exec(r)?.[1] ?? NaN);
  const ease = /cubic-bezier\([^)]*\)/.exec(r)?.[0] ?? "";
  return { name, ms, ease, rest: r };
}
const OUT = "cubic-bezier(0, 0, 0.2, 1)";
const STANDARD = "cubic-bezier(0.2, 0, 0, 1)";
const SLAM = "cubic-bezier(0.05, 0.7, 0.1, 1)";

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
  parent: FakeEl | null = null;
  hidden = false;
  removed = false;
  readonly listeners: Record<string, ((e: unknown) => void)[]> = {};
  readonly props = new Map<string, string>();
  readonly style: Record<string, unknown> & { setProperty(k: string, v: string): void; getPropertyValue(k: string): string };
  constructor(readonly tagName: string) {
    const p = this.props;
    this.style = { setProperty: (k: string, v: string): void => void p.set(k, v), getPropertyValue: (k: string): string => p.get(k) ?? "" } as FakeEl["style"];
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  get dataset(): Record<string, string> {
    return Object.fromEntries([...this.attrs].filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()), v]));
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
  remove(): void {
    this.removed = true;
    if (this.parent !== null) this.parent.children = this.parent.children.filter((c) => c !== this);
  }
  addEventListener(t: string, f: (e: unknown) => void): void {
    (this.listeners[t] ??= []).push(f);
  }
  get textContent(): string {
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(s: string) {
    this.children = [new FakeText(s)];
  }
  get elements(): FakeEl[] {
    return this.children.filter((c): c is FakeEl => c instanceof FakeEl);
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  all(): FakeEl[] {
    return this.elements.flatMap((e) => [e, ...e.all()]);
  }
  querySelectorAll(sel: string): FakeEl[] {
    const parts = sel.trim().split(/\s+/).map((p) => p.split(".").filter((x) => x !== ""));
    let set: FakeEl[] = [this];
    for (const cls of parts) set = [...new Set(set.flatMap((e) => e.all().filter((d) => cls.every((c) => c === d.tagName || d.classes.includes(c)))))];
    return set;
  }
  querySelector(sel: string): FakeEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  has(c: string): boolean {
    return this.classes.includes(c);
  }
}

const G = globalThis as unknown as Record<string, unknown>;
const saved = { document: G["document"], window: G["window"], raf: G["requestAnimationFrame"] };
const timers: { f: () => void; ms: number; id: number; cleared: boolean }[] = [];
// Set at import: some describe blocks build their DOM while collecting.
{
  G["document"] = { createElement: (t: string) => new FakeEl(t), createTextNode: (s: string) => new FakeText(s), body: new FakeEl("body") };
  G["window"] = {
    setTimeout: (f: () => void, ms: number): number => {
      const id = timers.length + 1;
      timers.push({ f, ms, id, cleared: false });
      return id;
    },
    clearTimeout: (id: number): void => {
      const t = timers.find((x) => x.id === id);
      if (t !== undefined) t.cleared = true;
    },
    innerWidth: 1440,
    innerHeight: 900,
  };
  G["requestAnimationFrame"] = (): number => 0;
}
afterAll(() => {
  G["document"] = saved.document;
  G["window"] = saved.window;
  G["requestAnimationFrame"] = saved.raf;
});

const INKS = matchupInk(1, 0);
const TEAMS: Record<"away" | "home", FaceoffTeam> = {
  away: { fill: INKS.away.fill, ring: INKS.away.ring, place: "Glass Lake", nickname: "Cranes" },
  home: { fill: INKS.home.fill, ring: INKS.home.ring, place: "Sundown Gulch", nickname: "Outriders" },
};
const asEl = (x: unknown): FakeEl => x as FakeEl;

// ================================================================ Main menu: the hero wordmark

describe("Main menu, menu.wordmark (menu.hero): type.hero 88 / 0.92 caps on two lines; type.wordmark 56 / 1.0 when small", () => {
  it("type.hero: display 700, 88 px times the text scale, line height 0.92, letter-spacing 0.005em, caps, chalk", () => {
    const d = declsFor(".wordmark");
    expect([d["font-family"], d["font-weight"], d["text-transform"], d["color"]]).toEqual(["var(--font-display)", "700", "uppercase", "var(--chalk)"]);
    expect(norm(resolve(d["font-size"]))).toBe("calc(88px * var(--text-scale))");
    expect(norm(d["line-height"])).toBe("0.92");
    expect(d["letter-spacing"]).toBe("0.005em");
  });

  it("set on two lines, CLIPBOARD over FOOTBALL, left aligned (each line a block); live text in the app", () => {
    expect(declsFor(".wordmark .wm-line")["display"]).toBe("block");
    expect(declsFor(".wordmark")["text-align"] ?? "left").toMatch(/^(left|start)$/);
    expect(appSource).toMatch(/h\("span", \{ class: "wm-line" \}, "Clipboard"\), " ", h\("span", \{ class: "wm-line" \}, "Football"\)/);
  });

  it("type.wordmark when small: 56 px, line height 1.0, letter-spacing 0.01em, and it may wrap (inline lines)", () => {
    const d = declsFor(".wordmark.small");
    expect(norm(resolve(d["font-size"]))).toBe("calc(56px * var(--text-scale))");
    expect(norm(d["line-height"])).toBe("1");
    expect(d["letter-spacing"]).toBe("0.01em");
    expect(declsFor(".wordmark.small .wm-line")["display"]).toBe("inline");
  });

  it("small exactly when the frame (min(1040, 100vw - 64)) is under 720 px wide or the text scale is 150% or more (static read of menuFrame)", () => {
    const m = /class: ([^?]*) \? "wordmark small" : "wordmark"/.exec(appSource)?.[1] ?? "";
    expect(m).not.toBe("");
    // Evaluated for the cases the rule names.
    const small = (w: number, ts: number): boolean => w - 64 < 720 || ts >= 150;
    expect(m.replace(/\s+/g, " ")).toBe("window.innerWidth - 64 < 720 || this.settings.textSize >= 150");
    expect([small(783, 100), small(784, 100), small(1440, 150), small(1440, 125)]).toEqual([true, false, true, false]);
  });

  it("menu.rule: the accent bar, 64 by 4 px, radius 2, color.gold, 16 px under the wordmark", () => {
    const d = declsFor(".menu-rule");
    expect([d["width"], d["height"], d["border-radius"], d["margin-top"]]).toEqual(["64px", "4px", "2px", "16px"]);
    expect(norm(resolve(d["background"]))).toBe(norm(resolve("var(--gold)")));
  });
});

describe("Main menu, menu.enter: the wordmark fades in and rises 12 px over 400 ms ease.out; the bar grows 0 to 64 over dur.base from 200 ms; rows from 240 ms; first show only", () => {
  it("CSS: the wordmark's entrance", () => {
    const a = anim(declsFor(".menu-frame.enter .wordmark")["animation"]);
    expect([a.ms, a.ease]).toEqual([400, OUT]);
    const from = kf(a.name, "from");
    expect(from["opacity"]).toBe("0");
    expect(norm(from["transform"])).toBe("translatey(12px)");
  });

  it("CSS: the bar grows from 0 to its 64 px from the left, over dur.base, starting at 200 ms", () => {
    const d = declsFor(".menu-frame.enter .menu-rule");
    const a = anim(d["animation"]);
    expect([a.ms, a.ease]).toEqual([180, OUT]);
    expect(a.rest).toMatch(/calc\(200ms - var\(--since\)\)/);
    const from = kf(a.name, "from");
    expect(norm(from["transform"] ?? from["width"])).toMatch(/^(scalex\(0\)|0(px)?)$/);
    if (from["transform"] !== undefined) expect(declsFor(".menu-rule")["transform-origin"]).toMatch(/^left/);
  });

  /** The App with only what menuMotion reads. */
  function menuApp(reduced: boolean): Record<string, unknown> {
    const app = Object.create(App.prototype) as Record<string, unknown>;
    Object.assign(app, { stack: [{ id: "title" }], loading: null, fatal: null, menuShown: null, heroEnter: undefined, settings: { reducedMotion: reduced ? "on" : "off", textSize: 100 }, reducedQuery: { matches: false } });
    return app;
  }
  const motion = (app: Record<string, unknown>, top: unknown): FakeEl => {
    const frame = new FakeEl("div");
    const rows = new FakeEl("div");
    rows.setAttribute("class", "rows");
    frame.append(rows);
    (app["menuMotion"] as (f: unknown, t: unknown) => void).call(app, frame, top);
    return frame;
  };

  it("on the first show after load the frame takes the entrance and the rows enter 240 ms later", () => {
    const app = menuApp(false);
    const top = (app["stack"] as unknown[])[0];
    const f = motion(app, top);
    expect(f.has("enter")).toBe(true);
    const rows = f.querySelector(".rows") as FakeEl;
    expect(rows.has("enter")).toBe(true);
    // The rows' animation is resumed 240 ms behind the frame's.
    const since = (el: FakeEl): number => Number(/(-?\d+)ms/.exec(el.props.get("--since") ?? "")?.[1] ?? NaN);
    expect(since(f) - since(rows)).toBeCloseTo(240, -1);
  });

  it("never again once it has run (a later return to the main menu uses the screen push)", () => {
    const app = menuApp(false);
    const title = (app["stack"] as unknown[])[0];
    motion(app, title);
    // The entrance is over (the app forgets its start once it has played).
    app["heroEnter"] = null;
    app["stack"] = [title, { id: "settings" }];
    const s = motion(app, (app["stack"] as unknown[])[1]);
    expect(s.has("push-in")).toBe(true);
    app["stack"] = [title];
    const back = motion(app, title);
    expect(back.has("enter")).toBe(false);
    expect(back.has("push-back")).toBe(true);
  });

  it("reduced motion: all of it shows at once (no entrance, no push)", () => {
    const app = menuApp(true);
    const title = (app["stack"] as unknown[])[0];
    expect(motion(app, title).has("enter")).toBe(false);
    app["heroEnter"] = null;
    app["stack"] = [title, { id: "settings" }];
    const s = motion(app, (app["stack"] as unknown[])[1]);
    expect(s.classes.filter((c) => /push|enter/.test(c))).toEqual([]);
  });

  it("a rebuild of the same screen starts nothing", () => {
    const app = menuApp(false);
    const title = (app["stack"] as unknown[])[0];
    motion(app, title);
    app["heroEnter"] = null;
    app["stack"] = [title, { id: "controls" }];
    const top = (app["stack"] as unknown[])[1];
    motion(app, top);
    expect(motion(app, top).classes.filter((c) => /push|enter/.test(c))).toEqual([]);
  });
});

// ================================================================ Screen transitions

describe("Screen transitions: menu screens enter from 24 px right with a fade over dur.screen ease.out, Back from 24 px left; sheets rise 12 px over dur.slow", () => {
  it.each([
    [".menu-frame.push-in", "translatex(24px)"],
    [".menu-frame.push-back", "translatex(-24px)"],
  ])("%s", (sel, tr) => {
    const a = anim(declsFor(sel)["animation"]);
    expect([a.ms, a.ease]).toEqual([240, OUT]);
    const from = kf(a.name, "from");
    expect([from["opacity"], norm(from["transform"])]).toEqual(["0", tr]);
  });

  it("sheets (pause, details, box score): rise 12 px and fade in over dur.slow ease.out", () => {
    const a = anim(declsFor(".panel.sheet-in")["animation"]);
    expect([a.ms, a.ease]).toEqual([260, OUT]);
    const from = kf(a.name, "from");
    expect([from["opacity"], norm(from["transform"])]).toEqual(["0", "translatey(12px)"]);
    expect(appSource).toMatch(/top\?\.id === "pause" \|\| top\?\.id === "details" \|\| top\?\.id === "box"\) restartAnimation\(p, "sheet-in"\)/);
  });

  it("nothing fades out: no keyframes for these move to opacity 0", () => {
    for (const n of ["push-in", "push-back", "sheet-in", "hero-in", "fo-from-left", "fo-from-right"]) expect(kf(n, "to")["opacity"], n).not.toBe("0");
  });

  it("reduced motion: every animation and transition is none under the system and the in-game switch", () => {
    const kills = (r: Rule): boolean => /^none\b/.test(r.decls["animation"] ?? "") && /^none\b/.test(r.decls["transition"] ?? "");
    expect(rules.filter((r) => r.at.some((a) => /prefers-reduced-motion:\s*reduce/.test(a)) && kills(r)).flatMap((r) => r.selectors)).toContain("*");
    expect(topRules.filter(kills).flatMap((r) => r.selectors)).toContain(".reduce-motion *");
  });
});

// ================================================================ Pregame: the face-off

describe("Pregame, the face-off band: away left, home right, team fills with the tier's ring, words in the outline color", () => {
  const band = asEl(faceoffBand(TEAMS, { you: "home" }));
  const halves = band.elements.filter((e) => e.has("fo-half"));

  it("the away half first, then the home half, then the VS disc", () => {
    expect(halves.map((e) => (e.has("away") ? "away" : e.has("home") ? "home" : "?"))).toEqual(["away", "home"]);
    expect(band.elements.at(-1)?.has("fo-vs")).toBe(true);
    expect(band.elements.at(-1)?.textContent).toBe("VS");
  });

  it("each half takes its team fill, every word in the slot's outline color, the dark ring only on dark-tier fills", () => {
    for (const [i, side] of [[0, "away"], [1, "home"]] as const) {
      const h = halves[i] as FakeEl;
      expect(h.props.get("--team-fill") ?? h.style["background"]).toBe(TEAMS[side].fill);
      expect(h.style["color"]).toBe(TEAMS[side].ring);
      expect(h.has("dark")).toBe(darkTier(TEAMS[side].fill));
      // No word inside sets its own color (all inherit the outline color), except the You pill (chalk on scoreBox).
      for (const w of h.all()) if (!w.has("you")) expect(w.style["color"], w.classes.join(".")).toBeUndefined();
    }
  });

  it("'Away' or 'Home', then the city, then the nickname; the You tag on the human's half only", () => {
    const words = (h: FakeEl): string[] => [h.querySelector(".fo-side")?.textContent ?? "", h.querySelector(".fo-city")?.textContent ?? "", h.querySelector(".fo-name")?.textContent ?? ""];
    expect(words(halves[0] as FakeEl)).toEqual(["Away", "Glass Lake", "Cranes"]);
    expect(words(halves[1] as FakeEl)).toEqual(["HomeYou", "Sundown Gulch", "Outriders"]);
    expect((halves[0] as FakeEl).querySelectorAll(".you").length).toBe(0);
    expect((halves[1] as FakeEl).querySelector(".you")?.textContent).toBe("You");
    const away = asEl(faceoffBand(TEAMS, { you: "away" }));
    expect(away.elements[0]?.querySelectorAll(".you").length).toBe(1);
    expect(away.elements[1]?.querySelectorAll(".you").length).toBe(0);
  });

  it("CSS: 200 px tall, radius.lg, overflow hidden, shadow.3", () => {
    const d = declsFor(".faceoff");
    expect(d["height"]).toBe("var(--fo-h)");
    expect(norm(d["--fo-h"])).toBe("200px");
    expect([d["border-radius"], d["overflow"], d["box-shadow"]]).toEqual(["var(--radius-lg)", "hidden", "var(--shadow-3)"]);
  });

  it("CSS: each half is gradient.teamBlock (the sheen over its fill), 32 px padding, the tier's inset ring (0.35 light, 0.55 dark)", () => {
    const d = declsFor(".fo-half");
    expect(norm(d["background"])).toBe("var(--sheen), var(--team-fill)");
    expect(d["padding"]).toBe("32px");
    expect(norm(d["box-shadow"])).toBe("inset 0 0 0 1px rgba(255, 255, 255, 0.35)");
    expect(norm(declsFor(".fo-half.dark")["box-shadow"])).toBe("inset 0 0 0 1px rgba(255, 255, 255, 0.55)");
    // Aligned to its outer edge: the home half's words run right to left.
    expect(declsFor(".fo-half.home")["text-align"]).toBe("right");
  });

  /** The seam's x at the top and bottom edge of the band, in px from the band's center, at a height. */
  function seam(h: number, bandW: number): { top: number; bottom: number } {
    const seamPx = 0.105 * h;
    // The away half is 50% + seam wide; its clip polygon in its own box.
    const poly = norm(declsFor(".fo-half.away")["clip-path"]);
    const width = bandW / 2 + seamPx;
    const xOf = (term: string): number => {
      const t = term.trim();
      if (t === "0") return 0;
      if (t === "100%") return width;
      const m = /^calc\(100% - 2 \* var\(--seam\)\)$/.exec(t);
      if (m) return width - 2 * seamPx;
      throw new Error(`unread term ${t} in ${poly}`);
    };
    // Each point is "<x> <y>", where x may be a calc(...) with spaces: y is the last word.
    const pts = (/^polygon\((.*)\)$/.exec(poly)?.[1]?.split(/, (?![^(]*\))/) ?? []).map((p) => {
      const k = p.lastIndexOf(" ");
      return [p.slice(0, k), p.slice(k + 1)];
    });
    const topRight = pts.find((p) => p[1] === "0" && p[0] !== "0") as string[];
    const bottomRight = pts.find((p) => p[1] === "100%" && p[0] !== "0") as string[];
    return { top: xOf(topRight[0] as string) - bandW / 2, bottom: xOf(bottomRight[0] as string) - bandW / 2 };
  }

  it("the seam: a straight 12-degree slant through the center, 21 px each way at 200 px (DESIGN's clip-path), scaled with the height", () => {
    // The away half's top edge ends 21 px right of center and its bottom edge 21 px left of it.
    const at200 = seam(200, 1000);
    expect(at200.top).toBeCloseTo(21, 0);
    expect(at200.bottom).toBeCloseTo(-21, 0);
    expect((Math.atan((at200.top - at200.bottom) / 200) * 180) / Math.PI).toBeCloseTo(12, 0);
    const at160 = seam(160, 1000);
    expect(at160.top).toBeCloseTo(21 * (160 / 200), 0);
    // The home half mirrors it (its clip starts at 2 * seam from its left edge, which sits at 50% - seam).
    expect(norm(declsFor(".fo-half.home")["clip-path"])).toBe("polygon(calc(2 * var(--seam)) 0, 100% 0, 100% 100%, 0 100%)");
  });

  it("CSS: the VS disc, 64 px, color.scoreBox, 1 px hairlineStrong, shadow.3, 'VS' display 700 28 px chalk, centered on the seam", () => {
    const d = declsFor(".fo-vs");
    expect([d["width"], d["height"], d["border-radius"], d["background"], norm(d["border"]), d["box-shadow"]]).toEqual(["64px", "64px", "50%", "var(--score-box)", "1px solid var(--hairline-strong)", "var(--shadow-3)"]);
    expect([d["font-family"], d["font-weight"], d["color"]]).toEqual(["var(--font-display)", "700", "var(--chalk)"]);
    expect(norm(d["font-size"])).toMatch(/^(28px|calc\(28px \* var\(--text-scale\)\))$/);
    expect([d["left"], d["top"]]).toEqual(["50%", "50%"]);
  });

  it("CSS: 'Away'/'Home' in type.label (600 13 px), the You tag a scoreBox pill in chalk, the city Inter 600 18 px, the nickname type.faceoffName (display 700 64 / 0.95 caps)", () => {
    const s = declsFor(".fo-side");
    expect([s["font-weight"], norm(s["font-size"])]).toEqual(["600", "calc(13px * var(--text-scale))"]);
    const y = declsFor(".fo-side .you");
    expect([y["background"], y["color"], y["border-radius"]]).toEqual(["var(--score-box)", "var(--chalk)", "var(--radius-pill)"]);
    const c = declsFor(".fo-city");
    expect([c["font-weight"], norm(c["font-size"])]).toEqual(["600", "calc(18px * var(--text-scale))"]);
    expect(c["font-family"] ?? "var(--font-ui)").toBe("var(--font-ui)");
    const n = declsFor(".fo-name");
    expect([n["font-family"], n["font-weight"], n["text-transform"], norm(n["line-height"]), norm(n["font-size"])]).toEqual(["var(--font-display)", "700", "uppercase", "0.95", "calc(64px * var(--text-scale))"]);
  });

  it("CSS: under 900 px of content the band is 160 px and the nickname 48 px (in some narrower media rule)", () => {
    const narrowBand = rules.find((r) => r.selectors.includes(".faceoff") && r.at.some((a) => /max-width/.test(a)));
    expect(narrowBand).toBeDefined();
    expect(norm(narrowBand?.decls["--fo-h"] ?? narrowBand?.decls["height"])).toBe("160px");
    const narrowName = rules.find((r) => r.selectors.includes(".fo-name") && r.at.some((a) => /max-width/.test(a)));
    expect(norm(narrowName?.decls["font-size"])).toBe("calc(48px * var(--text-scale))");
  });

  it("the screen title shrinks to a type.label 'Pregame' line (the face-off is the title)", () => {
    const d = declsFor(".pregame-label");
    expect([d["font-weight"], norm(d["font-size"]), d["color"]]).toEqual(["600", "calc(13px * var(--text-scale))", "var(--chalk-soft)"]);
    expect(appSource).toMatch(/top\.id === "pregame" \? h\("h1", \{ class: "pregame-label" \}, model\.title\)/);
  });
});

describe("Pregame, the tale of the tape: one row per unit, away value far left, home value far right, higher in chalk, bars outward from the center", () => {
  const rows = [
    { label: "Offense", away: 67, home: 66 },
    { label: "Defense", away: 69, home: 72 },
    { label: "Special teams", away: 70, home: 70 },
  ];
  const tape = asEl(taleOfTape(rows, { away: TEAMS.away.fill, home: TEAMS.home.fill }));
  const tr = tape.querySelectorAll(".tape-row");

  it("one row per unit in order, read left to right: away value, away bar, unit name, home bar, home value", () => {
    expect(tr.length).toBe(3);
    for (const [i, r] of rows.entries()) {
      const kids = (tr[i] as FakeEl).elements;
      expect(kids.map((k) => (k.has("tape-val") ? "val" : k.has("tape-bar") ? "bar" : k.has("tape-label") ? "label" : "?"))).toEqual(["val", "bar", "label", "bar", "val"]);
      expect([kids[0]?.textContent, kids[2]?.textContent, kids[4]?.textContent]).toEqual([String(r.away), r.label, String(r.home)]);
      expect(kids[1]?.has("away")).toBe(true);
      expect(kids[3]?.has("home")).toBe(true);
    }
  });

  it("the higher value is chalk and the lower chalkSoft; a tie is chalk on both sides", () => {
    const lead = (i: number): [boolean, boolean] => {
      const k = (tr[i] as FakeEl).elements;
      return [k[0]?.has("lead") ?? false, k[4]?.has("lead") ?? false];
    };
    expect(lead(0)).toEqual([true, false]);
    expect(lead(1)).toEqual([false, true]);
    expect(lead(2)).toEqual([true, true]);
    expect(declsFor(".tape-val")["color"]).toBe("var(--chalk-soft)");
    expect(declsFor(".tape-val.lead")["color"]).toBe("var(--chalk)");
  });

  it("each bar fills value / 100 of its space, in its team's fill, with the tier's ring", () => {
    for (const [i, r] of rows.entries()) {
      const k = (tr[i] as FakeEl).elements;
      for (const [bar, side, v] of [[k[1], "away", r.away], [k[3], "home", r.home]] as const) {
        const fill = (bar as FakeEl).querySelector(".tape-fill") as FakeEl;
        expect(fill.style["width"]).toBe(`${v}%`);
        expect(fill.style["background"]).toBe(TEAMS[side].fill);
        expect(fill.has("dark")).toBe(darkTier(TEAMS[side].fill));
      }
    }
  });

  it("CSS: values display 700 28 px tabular; the unit name type.label chalkSoft, centered; bars 8 px, radius 4, color.track, the away bar growing leftward from the center", () => {
    const v = declsFor(".tape-val");
    expect([v["font-family"], v["font-weight"], norm(v["font-size"]), v["font-variant-numeric"]]).toEqual(["var(--font-display)", "700", "calc(28px * var(--text-scale))", "tabular-nums"]);
    const l = declsFor(".tape-label");
    expect([l["font-weight"], norm(l["font-size"]), l["color"], l["text-align"]]).toEqual(["600", "calc(13px * var(--text-scale))", "var(--chalk-soft)", "center"]);
    const b = declsFor(".tape-bar");
    expect([b["height"], b["border-radius"], b["background"]]).toEqual(["8px", "4px", "var(--track)"]);
    expect(declsFor(".tape-bar.away")["justify-content"]).toBe("flex-end");
    expect(norm(declsFor(".tape-fill")["box-shadow"])).toBe("inset 0 0 0 1px rgba(255, 255, 255, 0.35)");
    expect(norm(declsFor(".tape-fill.dark")["box-shadow"])).toBe("inset 0 0 0 1px rgba(255, 255, 255, 0.55)");
  });

  it("rows are 40 px apart: the row's height plus the gap between rows is 40 px", () => {
    const gap = Number(/(\d+)px/.exec(declsFor(".tape")["gap"] ?? declsFor(".tape")["row-gap"] ?? "0")?.[1] ?? 0);
    const v = declsFor(".tape-val");
    // A row is at least as tall as its tallest line: the 28 px value at line height 1, or the row's min-height.
    const valueLine = 28 * Number(v["line-height"] ?? 1.2);
    const minH = Number(/(\d+)px/.exec(declsFor(".tape-row")["min-height"] ?? declsFor(".tape-row")["height"] ?? "0")?.[1] ?? 0);
    const rowH = Math.max(valueLine, minH);
    expect(rowH + gap, `row ${rowH} px + gap ${gap} px`).toBe(40);
  });

  it("under the band, 24 px down", () => {
    expect(norm(declsFor(".faceoff")["margin"])).toBe("0 0 24px");
  });
});

// ================================================================ Matchup intro

describe("Moments, matchup intro: timings at 1x, any key or click skips, once per new game, never on a resume or under reduced motion, it lands in the bug", () => {
  it("INTRO: wipe 0 to 300, names 200 to 420, VS at 500, hold to 1900, shrink 1900 to 2300, rows from 2300; 2400 ms minimum hold", () => {
    expect(INTRO.wipeMs).toBe(300);
    expect([INTRO.slamAt, INTRO.slamAt + INTRO.slamMs]).toEqual([200, 420]);
    expect(INTRO.vsAt).toBe(500);
    expect([INTRO.shrinkAt, INTRO.shrinkAt + INTRO.shrinkMs]).toEqual([1900, 2300]);
    expect(INTRO.totalMs).toBe(2300);
    expect(INTRO.holdMs).toBe(2400);
  });

  it("styles.css mirrors the timings in :root (--intro-*)", () => {
    expect([rootVars["--intro-wipe"], rootVars["--intro-slam-at"], rootVars["--intro-slam"], rootVars["--intro-vs-at"], rootVars["--intro-shrink-at"], rootVars["--intro-shrink"]].map(norm)).toEqual(["300ms", "200ms", "220ms", "500ms", "1900ms", "400ms"]);
  });

  it("CSS: a band 240 px tall across the full window width, vertically centered; the halves wipe in from their own edges over 300 ms ease.out", () => {
    expect(norm(declsFor(".intro-band")["--fo-h"])).toBe("240px");
    const i = declsFor(".intro");
    expect([i["position"], i["left"], i["right"]]).toEqual(["fixed", "0", "0"]);
    expect(i["align-items"]).toBe("center");
    const l = anim(declsFor(".intro-slot.away > .fo-half")["animation"]);
    const r = anim(declsFor(".intro-slot.home > .fo-half")["animation"]);
    expect([l.ms, l.ease, r.ms, r.ease]).toEqual([300, OUT, 300, OUT]);
    expect(norm(kf(l.name, "from")["transform"])).toBe("translatex(-100%)");
    expect(norm(kf(r.name, "from")["transform"])).toBe("translatex(100%)");
  });

  it("CSS: the nicknames slam in from 200 ms (opacity and scale 1.12 to 1.0, ease.slam, 220 ms); VS fades in at 500 ms scaling 0.8 to 1 over dur.base ease.out", () => {
    const s = anim(declsFor(".intro-slot .fo-words")["animation"]);
    expect([s.ms, s.ease]).toEqual([220, SLAM]);
    expect(s.rest).toMatch(/ 200ms /);
    expect([kf(s.name, "from")["opacity"], norm(kf(s.name, "from")["transform"])]).toEqual(["0", "scale(1.12)"]);
    const v = anim(declsFor(".intro-band > .fo-vs")["animation"]);
    expect([v.ms, v.ease]).toEqual([180, OUT]);
    expect(v.rest).toMatch(/ 500ms /);
    expect([kf(v.name, "from")["opacity"], norm(kf(v.name, "from")["transform"])]).toEqual(["0", "scale(0.8)"]);
  });

  it("CSS: from 1900 ms each half shrinks into its name plate (ease.standard, 400 ms) while the rest of the bug fades in", () => {
    const s = anim(declsFor(".intro-slot")["animation"]);
    expect([s.ms, s.ease]).toEqual([400, STANDARD]);
    expect(s.rest).toMatch(/ 1900ms /);
    expect(norm(kf(s.name, "to")["transform"])).toMatch(/translate\(var\(--to-x.*scale\(var\(--to-sx/);
    const b = anim(declsFor(".top-bar.intro-wait")["animation"]);
    expect([b.ms, b.ease]).toEqual([400, STANDARD]);
    expect(b.rest).toMatch(/ 1900ms /);
    expect(kf(b.name, "from")["opacity"]).toBe("0");
  });

  it("matchupIntro: the band shows both halves in their teams; done runs once at 2300 ms; land() aims each half at its plate", () => {
    timers.length = 0;
    let done = 0;
    const plateRect = { left: 16, top: 8, width: 120, height: 48 } as DOMRect;
    const intro = matchupIntro(TEAMS, "home", () => ({ away: plateRect, home: plateRect }), () => done++);
    const el = asEl(intro.el);
    expect(el.querySelectorAll(".fo-half").map((h) => h.has("away") ? "away" : "home")).toEqual(["away", "home"]);
    expect(el.querySelector(".fo-vs")?.textContent).toBe("VS");
    const t = timers.find((x) => !x.cleared);
    expect(t?.ms).toBe(2300);
    t?.f();
    expect(done).toBe(1);
    expect(el.removed).toBe(true);
    intro.skip();
    expect(done).toBe(1);
  });

  it("a skip ends it at once (done runs once, the overlay is gone, the timer cleared)", () => {
    timers.length = 0;
    let done = 0;
    const intro = matchupIntro(TEAMS, "away", () => ({ away: null, home: null }), () => done++);
    intro.skip();
    expect(done).toBe(1);
    expect(asEl(intro.el).removed).toBe(true);
    expect(timers.every((x) => x.cleared)).toBe(true);
    intro.skip();
    expect(done).toBe(1);
  });

  it("any key skips it, and the key does nothing else (App.onKey)", () => {
    const app = Object.create(App.prototype) as Record<string, unknown>;
    let skipped = 0;
    let prevented = 0;
    Object.assign(app, { intro: { skip: () => skipped++ }, layoutNow: { tooSmall: false }, fatal: null, loading: null });
    for (const key of ["a", "Enter", " ", "Escape", "1"]) (app["onKey"] as (e: unknown) => void).call(app, { key, repeat: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault: () => prevented++ });
    expect(skipped).toBe(5);
    expect(prevented).toBe(5);
  });

  it("any click skips it (static read: the intro's pointerdown skips)", () => {
    expect(appSource).toMatch(/intro\.el\.addEventListener\("pointerdown", \(e\) => \{\s*e\.preventDefault\(\);\s*intro\.skip\(\);/);
  });

  it("once per new game, never on a resume or under reduced motion (static read of the step handler)", () => {
    expect(appSource).toMatch(/if \(fresh && !m\.resumed && !this\.reducedMotion\(\)\) this\.startIntro\(g\);/);
    expect(appSource).toMatch(/const fresh = this\.game === null \|\| m\.resumed \|\| this\.game\.matchup\.seed !== m\.matchup\.seed;/);
  });

  it("after it the coin toss rows enter as in Rows, Menu change (unless reduced motion)", () => {
    const body = /private startIntro\(g: GameView\)[\s\S]*?\n {2}\}\n/.exec(appSource)?.[0] ?? "";
    expect(body).toMatch(/if \(g\.menu !== null && !this\.reducedMotion\(\)\) this\.menuEnter = \{ menu: g\.menu, back: false/);
  });
});

// ================================================================ Halftime and end of game

describe("Halftime and end of game (menu.scoreHero): the band with each score in type.faceoffScore, the line score with an OT column when played", () => {
  it("the band carries each score beside its nickname, in the half's outline color", () => {
    const band = asEl(faceoffBand(TEAMS, { you: "home", scores: { away: 17, home: 24 } }));
    const [away, home] = band.elements.filter((e) => e.has("fo-half"));
    expect(away?.querySelector(".fo-score")?.textContent).toBe("17");
    expect(home?.querySelector(".fo-score")?.textContent).toBe("24");
    expect(away?.querySelector(".fo-score")?.style["color"]).toBeUndefined();
    const d = declsFor(".fo-score");
    expect([d["font-family"], d["font-weight"], norm(d["line-height"]), d["font-variant-numeric"], norm(d["font-size"])]).toEqual(["var(--font-display)", "700", "0.9", "tabular-nums", "calc(96px * var(--text-scale))"]);
  });

  it("the halves slide in 40 px from their outer edges with a fade over dur.screen ease.out", () => {
    for (const [sel, tr] of [[".faceoff.hero-in .fo-half.away", "translatex(-40px)"], [".faceoff.hero-in .fo-half.home", "translatex(40px)"]] as const) {
      const a = anim(declsFor(sel)["animation"]);
      expect([a.ms, a.ease], sel).toEqual([240, OUT]);
      expect([kf(a.name, "from")["opacity"], norm(kf(a.name, "from")["transform"])], sel).toEqual(["0", tr]);
    }
    expect(COUNT_UP_MS).toBe(600);
    expect(norm(rootVars["--score-count"])).toBe("600ms");
  });

  it("the title: HALFTIME, FINAL, or FINAL, OT when overtime was played, in type.screenTitle (display 700 40 caps)", () => {
    expect(appSource).toMatch(/h\("h1", \{\}, ot \? `\$\{model\.title\}, OT` : model\.title\)/);
    const d = declsFor(".panel h1");
    expect([d["font-family"], d["font-weight"], d["text-transform"]]).toEqual(["var(--font-display)", "700", "uppercase"]);
  });

  it("line score table: a row per team (swatch and nickname), one column per period, then the total; quarters chalkSoft, totals chalk, display 700 22 px tabular", () => {
    const t = asEl(lineScoreTable({ heads: ["1st", "2nd", "3rd", "4th", "OT"], rows: { away: { fill: TEAMS.away.fill, nickname: "Cranes", byPeriod: [7, 3, 0, 7, 3], total: 20 }, home: { fill: TEAMS.home.fill, nickname: "Outriders", byPeriod: [0, 10, 7, 0, 0], total: 17 } } }));
    const trs = t.elements;
    expect(trs.length).toBe(3);
    expect(trs[0]?.elements.map((c) => c.textContent)).toEqual(["", "1st", "2nd", "3rd", "4th", "OT", "T"]);
    const cells = (r: FakeEl | undefined): string[] => (r?.elements ?? []).slice(1).map((c) => c.textContent);
    expect(cells(trs[1])).toEqual(["7", "3", "0", "7", "3", "20"]);
    expect(cells(trs[2])).toEqual(["0", "10", "7", "0", "0", "17"]);
    expect(trs[1]?.elements[0]?.textContent).toContain("Cranes");
    expect(trs[1]?.elements[0]?.querySelectorAll(".swatch").length).toBe(1);
    const d = declsFor(".line-score");
    expect([d["font-family"], d["font-weight"], d["font-variant-numeric"], norm(d["font-size"])]).toEqual(["var(--font-display)", "700", "tabular-nums", "calc(22px * var(--text-scale))"]);
    expect(declsFor(".line-score .ls-q")["color"]).toBe("var(--chalk-soft)");
    expect(declsFor(".line-score .ls-total")["color"]).toBe("var(--chalk)");
  });

  /** The App with only what scoreHero reads, for a game that ended in overtime. */
  function heroApp(reduced: boolean): Record<string, unknown> {
    const team = (t: "home" | "away") => ({ index: t === "home" ? 0 : 1, name: "", place: TEAMS[t].place, nickname: TEAMS[t].nickname, pool: {} });
    const snap = (period: number, home: number, away: number) => ({ period, clock: 600, phase: "scrimmage", possession: "home", spot: 30, down: 1, distance: 10, goalToGo: false, score: { home, away }, timeouts: { home: 3, away: 3 }, clockRunning: false, safetyKick: false });
    const play = (period: number, b: [number, number], a: [number, number]): GameEvent => ({ t: "play", before: snap(period, ...b), after: snap(period, ...a) }) as unknown as GameEvent;
    const events = [play(1, [0, 0], [7, 0]), play(2, [7, 0], [7, 3]), play(3, [7, 3], [7, 10]), play(4, [7, 10], [17, 10]), play(5, [17, 10], [17, 16])];
    const app = Object.create(App.prototype) as Record<string, unknown>;
    Object.assign(app, {
      ui: { rules: { game: { regulationPeriods: 4, periodsPerHalf: 2 } } },
      game: { matchup: { home: team("home"), away: team("away") }, human: "home", state: { ...snap(5, 17, 16), phase: "final" }, events },
      heroAt: null,
      settings: { reducedMotion: reduced ? "on" : "off" },
      reducedQuery: { matches: false },
      stack: [{ id: "end" }],
    });
    return app;
  }
  const hero = (app: Record<string, unknown>): FakeEl[] => ((app["scoreHero"] as (g: unknown, id: string) => unknown[]).call(app, app["game"], "end") as FakeEl[]);

  it("App.scoreHero: the band, then a line score with 1st to 4th and OT, each team's points by period and its total", () => {
    const [band, table] = hero(heroApp(true));
    expect(band?.has("faceoff")).toBe(true);
    expect(table?.elements[0]?.elements.map((c) => c.textContent)).toEqual(["", "1st", "2nd", "3rd", "4th", "OT", "T"]);
    const cells = (r: FakeEl | undefined): string[] => (r?.elements ?? []).slice(1).map((c) => c.textContent);
    expect(cells(table?.elements[1])).toEqual(["0", "3", "7", "0", "6", "16"]);
    expect(cells(table?.elements[2])).toEqual(["7", "0", "0", "10", "0", "17"]);
  });

  it("App.scoreHero, reduced motion: static (no slide-in, the final scores at once)", () => {
    const [band] = hero(heroApp(true));
    expect(band?.has("hero-in")).toBe(false);
    expect(band?.querySelectorAll(".fo-score").map((e) => e.textContent)).toEqual(["16", "17"]);
  });

  it("App.scoreHero, with motion: the halves slide in and the scores start counting up from 0", () => {
    const [band] = hero(heroApp(false));
    expect(band?.has("hero-in")).toBe(true);
    expect(band?.querySelectorAll(".fo-score").map((e) => e.textContent)).toEqual(["0", "0"]);
  });
});

// ================================================================ Pregame status copy

describe("Pregame status: in words only, 'Your old save is kept.'; the storage key goes to the log, never the screen", () => {
  it("the set-aside status reads 'Your old save is kept.'", () => {
    expect(appSource).toMatch(/this\.status = key === null \? "" : "Your old save is kept\.";/);
  });

  it("no status line the app sets interpolates a key, timestamp or 'set-aside' text", () => {
    for (const m of appSource.matchAll(/this\.status = ([^;]*);/g)) {
      const v = m[1] as string;
      expect(v, v).not.toMatch(/\$\{key\}|set-aside|toISOString|\bkey\b(?! === null)/);
    }
  });
});

// ================================================================ Tokens

describe("Tokens: every color and duration in tokens.ts is mirrored in :root; the front door's timings are in :root", () => {
  const kebab = (k: string): string => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  it("COLOR and DUR mirrored", () => {
    for (const [k, v] of Object.entries(COLOR as Record<string, string>)) expect(norm(rootVars[`--${kebab(k)}`]), k).toBe(norm(v));
    for (const [k, v] of Object.entries(DUR as Record<string, number>)) expect(norm(rootVars[`--dur-${kebab(k)}`]), k).toBe(`${v}ms`);
  });

  it("type.hero 88 and type.wordmark 56 in :root; the menu entrance 400 / 200 / 240 ms", () => {
    expect(norm(rootVars["--menu-hero-size"])).toBe("88px");
    expect(norm(rootVars["--menu-wordmark-size"])).toBe("56px");
    expect([rootVars["--menu-enter"], rootVars["--menu-enter-rule-at"], rootVars["--menu-enter-rows-at"]].map(norm)).toEqual(["400ms", "200ms", "240ms"]);
  });
});
