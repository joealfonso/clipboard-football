// Spec tests for the "Broadcast" visual revision in DESIGN.md (art-director, 2026-11-15), written
// by test-writer from DESIGN.md, not the implementation. Every expected value (token values,
// geometry examples, contrast figures, sizes) is typed in from DESIGN.md. Contrast is computed here
// with this file's own WCAG 2.x function, not the app's.
//
// There is no jsdom in the repo, so the DOM criteria are checked through what runs in node: the
// pure layout function, the recording canvas context, and static reads of index.html, styles.css
// (with a small brace-aware CSS reader that keeps @media context) and, for the score bug's cell
// order and the rail's show rule, app.ts source. Those static checks are marked where they appear.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { drawField, drawFrame, viewOf, type FrameOpts } from "../src/ui/field";
import { cameraAt, layoutFor, MIN_HEIGHT, MIN_WIDTH, playStage, TOP_BAR } from "../src/ui/layout";
import { OVERLAY_IDS, overlaysShown } from "../src/ui/overlay";
import { splashScene, splashView } from "../src/ui/splash";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { timeline } from "../src/ui/timeline";
import * as tokens from "../src/ui/tokens";
import { COLOR, DUR, FONT_DISPLAY, FONT_UI, RADIUS, SHADOW, SWATCHES } from "../src/ui/tokens";
import { COMPLETE } from "./fixtures";

const root = join(import.meta.dirname, "../../..");
const appDir = join(import.meta.dirname, "..");
const readText = (p: string): string => readFileSync(join(appDir, p), "utf8");
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));

const html = readText("index.html");
const css = readText("src/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
const appSource = readText("src/ui/app.ts");

// ---------------------------------------------------------------- a brace-aware CSS reader

interface Rule {
  /** The enclosing at-rules, outermost first, e.g. ["@media (prefers-reduced-motion: reduce)"]. */
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

/** A value with :root custom properties substituted (not --text-scale). */
function resolve(value: string | undefined): string {
  let v = value ?? "";
  for (let i = 0; i < 10; i++) {
    const next = v.replace(/var\((--[a-z0-9-]+)\)/gi, (whole, name: string) => (name === "--text-scale" ? whole : (rootVars[name] ?? whole)));
    if (next === v) break;
    v = next;
  }
  return v;
}
/** Declarations of every top-level rule (no at-rule) whose selector list contains `selector`, later winning. */
function declsFor(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of topRules) if (r.selectors.includes(selector)) Object.assign(out, r.decls);
  return out;
}
/** Lowercase, single spaces, every number written as its shortest form (0.40 is 0.4, 0.90 is 0.9). */
const norm = (s: string | undefined): string =>
  (s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(^|[^#0-9a-z])(\d*\.\d+|\d+)(?=[^0-9a-z#]|px|ms|%|deg|$)/g, (_m, pre: string, n: string) => `${pre}${String(Number(n))}`)
    .trim();
const kebab = (k: string): string => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// ---------------------------------------------------------------- WCAG 2.x, written for this file

type Rgb = readonly [number, number, number];
function parseColor(s: string): { rgb: Rgb; a: number } {
  const t = s.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(t);
  if (hex) {
    const n = hex[1] as string;
    return { rgb: [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as unknown as Rgb, a: 1 };
  }
  const m = /^rgba?\(([^)]*)\)$/i.exec(t);
  if (!m) throw new Error(`not a color: ${s}`);
  const p = (m[1] as string).split(",").map((x) => Number(x.trim()));
  return { rgb: [p[0], p[1], p[2]] as unknown as Rgb, a: p[3] ?? 1 };
}
const channel = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (c: Rgb): number => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
function ratio(a: Rgb, b: Rgb): number {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** A color (maybe translucent) composited in sRGB over an opaque one. */
function over(top: string | Rgb, under: Rgb, alpha?: number): Rgb {
  const t = typeof top === "string" ? parseColor(top) : { rgb: top, a: 1 };
  const a = alpha ?? t.a;
  return [0, 1, 2].map((i) => (t.rgb[i] as number) * a + (under[i] as number) * (1 - a)) as unknown as Rgb;
}
const rgb = (s: string): Rgb => parseColor(s).rgb;

// ================================================================ Layout: play screen geometry

describe("Layout: the top bar and the window floor", () => {
  it("TOP_BAR is 56 and the minimum window is 800x528, and the canvas starts under the bar", () => {
    expect(TOP_BAR).toBe(56);
    expect([MIN_WIDTH, MIN_HEIGHT]).toEqual([800, 528]);
    expect(layoutFor(1280, 720).field.top).toBe(56);
    expect(layoutFor(800, 528).tooSmall).toBe(false);
    expect(layoutFor(800, 527).tooSmall).toBe(true);
  });

  it("styles.css puts the top bar at 56 px and the field layout under it", () => {
    expect(declsFor(".top-bar")["height"]).toBe("56px");
    expect(norm(declsFor(".layout")["inset"])).toBe("56px 0 0 0");
  });
});

describe("Layout, Play screen: playStage centers the field column and the rail together (DESIGN.md examples)", () => {
  // [window w, h, text scale, column width, column left, rail left or null, rail width]
  const EXAMPLES: readonly [number, number, number, number, number, number | null, number][] = [
    // "At 1280x720 that is a 734 px column at x 91 and a 340 px rail".
    [1280, 720, 1, 734, 91, 91 + 734 + 24, 340],
    // "at 1024x600, 601 px and 340 px".
    [1024, 600, 1, 601, Math.floor((1024 - (601 + 24 + 340)) / 2), Math.floor((1024 - (601 + 24 + 340)) / 2) + 601 + 24, 340],
    // "at 1920x1080, 1132 px and 340 px".
    [1920, 1080, 1, 1132, Math.floor((1920 - (1132 + 24 + 340)) / 2), Math.floor((1920 - (1132 + 24 + 340)) / 2) + 1132 + 24, 340],
  ];
  it.each(EXAMPLES)("%ix%i at text scale %d: a %i px column at x %i, the rail at x %s, %i px wide", (w, h, ts, cw, cl, rl, rw) => {
    const l = layoutFor(w, h);
    const st = playStage(l, ts);
    expect(st.column.width).toBe(cw);
    expect(st.column.left).toBe(cl);
    expect(st.rail).not.toBeNull();
    expect(st.rail?.left).toBe(rl);
    expect(st.rail?.width).toBe(rw);
    // The gap between column and rail is 24 px.
    expect((st.rail?.left ?? 0) - (st.column.left + st.column.width)).toBe(24);
    // The group is centered: the space left of the column and right of the rail differ by at most 1 px.
    const rightSpace = w - ((st.rail?.left ?? 0) + (st.rail?.width ?? 0));
    expect(Math.abs(st.column.left - rightSpace)).toBeLessThanOrEqual(1);
  });

  it("the column runs the full height under the top bar; the rail is inset 16 px top and bottom", () => {
    for (const [w, h] of [[1280, 720], [1024, 600], [1920, 1080]] as const) {
      const l = layoutFor(w, h);
      const st = playStage(l, 1);
      expect(st.column.top).toBe(0);
      expect(st.column.height).toBe(h - TOP_BAR);
      expect(st.rail?.top).toBe(TOP_BAR + 16);
      expect((st.rail?.top ?? 0) + (st.rail?.height ?? 0)).toBe(h - 16);
    }
  });

  it("800x528: no rail, the column centered alone", () => {
    const l = layoutFor(800, 528);
    const st = playStage(l, 1);
    expect(st.rail).toBeNull();
    expect(Math.abs(st.column.left * 2 + st.column.width - 800)).toBeLessThanOrEqual(1);
    expect(st.column.height).toBe(528 - TOP_BAR);
  });

  it("1024x600 at 125% text: no rail (the rail would be 420 px and the group no longer fits), the column centered", () => {
    const l = layoutFor(1024, 600);
    const st = playStage(l, 1.25);
    expect(st.rail).toBeNull();
    expect(Math.abs(st.column.left * 2 + st.column.width - 1024)).toBeLessThanOrEqual(1);
  });

  it("rail width is clamp(300, 340 * text scale, 420)", () => {
    const l = layoutFor(2560, 1440);
    const widths = [0.5, 0.8, 1, 1.1, 1.25, 1.5, 2].map((ts) => playStage(l, ts).rail?.width);
    expect(widths).toEqual([300, 300, 340, 374, 420, 420, 420]);
  });

  it("the rail shows exactly when column + 24 + rail fits inside the window less 24 px stage padding each side", () => {
    for (let w = 800; w <= 1400; w += 7) {
      for (const h of [528, 600, 720]) {
        for (const ts of [1, 1.25, 1.5]) {
          const l = layoutFor(w, h);
          const railW = Math.min(420, Math.max(300, 340 * ts));
          const fits = l.column.width + 24 + railW <= w - 48;
          const st = playStage(l, ts);
          expect(st.rail !== null, `${w}x${h} at ${ts}`).toBe(fits);
          if (st.rail === null) expect(Math.abs(st.column.left * 2 + st.column.width - w), `${w}x${h} centered`).toBeLessThanOrEqual(1);
          else {
            // Never off the stage padding, never overlapping the column.
            expect(st.column.left).toBeGreaterThanOrEqual(24);
            expect(st.rail.left + st.rail.width).toBeLessThanOrEqual(w - 24);
          }
        }
      }
    }
  });
});

// ================================================================ Tokens

describe("Tokens: tokens.ts holds DESIGN.md's token table", () => {
  // DESIGN.md Color tables (stage and surfaces; text and accent; field), typed in.
  const COLORS: Readonly<Record<string, string>> = {
    bg: "#0A1428",
    bgTop: "#13264A",
    bgBottom: "#070E1C",
    panel: "#0F1E3D",
    panelRaise: "#1B3260",
    surface: "rgba(18, 34, 63, 0.72)",
    surfaceSolid: "#12223F",
    surfaceRaised: "rgba(255, 255, 255, 0.06)",
    rowRest: "rgba(255, 255, 255, 0.035)",
    hairline: "rgba(255, 255, 255, 0.08)",
    hairlineStrong: "rgba(255, 255, 255, 0.14)",
    selectRing: "rgba(255, 203, 61, 0.40)",
    track: "#1B3260",
    chalk: "#F5F2E8",
    chalkSoft: "#A9B3B8",
    gold: "#FFCB3D",
    signal: "#FFCB3D",
    paper: "#F5F2E8",
    paperShade: "#E6E0CF",
    ink: "#22272B",
    inkSoft: "#4F565B",
    turf: "#2F7237",
    turfStripe: "#327739",
    sideline: "#2F7237",
    line: "#F5F7F2",
    hash: "#D5E0D2",
    outlineDark: "#0A0D0B",
    ball: "#7A4A1E",
    tag: "rgba(7, 12, 22, 0.78)",
    turfLight: "rgba(255, 255, 255, 0.05)",
  };

  it.each(Object.entries(COLORS))("color.%s is %s", (k, want) => {
    const got = (COLOR as Record<string, string>)[k];
    expect(got, k).toBeDefined();
    expect(parseColor(got as string)).toEqual(parseColor(want));
  });

  it("COLOR holds no color DESIGN.md doesn't list (the retired offense and defense colors are gone)", () => {
    expect(Object.keys(COLOR).sort()).toEqual(Object.keys(COLORS).sort());
  });

  it("canvas shadows: shadow.mark, shadow.field, shadow.toast, glow.carrier", () => {
    const want = {
      mark: ["rgba(0, 0, 0, 0.28)", 4, 1],
      field: ["rgba(0, 0, 0, 0.50)", 40, 0],
      toast: ["rgba(0, 0, 0, 0.40)", 12, 4],
      carrier: ["rgba(245, 247, 242, 0.55)", 8, 0],
    } as const;
    for (const [k, [color, blur, offsetY]] of Object.entries(want)) {
      const s = (SHADOW as Record<string, { color: string; blur: number; offsetY: number }>)[k];
      expect(s, k).toBeDefined();
      expect(parseColor(s?.color ?? ""), k).toEqual(parseColor(color));
      expect([s?.blur, s?.offsetY], k).toEqual([blur, offsetY]);
    }
  });

  it("radii 6, 10, 14, 20, 999 and UI durations 120, 180, 260, 240 ms", () => {
    expect(RADIUS).toEqual({ sm: 6, md: 10, lg: 14, xl: 20, pill: 999 });
    expect(DUR).toEqual({ fast: 120, base: 180, slow: 260, screen: 240 });
  });

  it("two font families: FONT_UI and FONT_DISPLAY are the Typography variables; font.mono is retired (no FONT_MONO)", () => {
    expect(FONT_UI).toBe('"Inter", system-ui, -apple-system, "Segoe UI", sans-serif');
    expect(FONT_DISPLAY).toBe('"Barlow Condensed", "Inter", system-ui, sans-serif');
    expect(Object.keys(tokens)).not.toContain("FONT_MONO");
  });
});

describe("Tokens: styles.css :root mirrors them in kebab case", () => {
  it.each(Object.keys(COLOR))("color.%s has its kebab-case CSS variable", (k) => {
    const name = `--${kebab(k)}`;
    expect(rootVars[name], name).toBeDefined();
    expect(parseColor(rootVars[name] as string)).toEqual(parseColor((COLOR as Record<string, string>)[k] as string));
  });

  const CSS_TOKENS: Readonly<Record<string, string>> = {
    // Gradients.
    "--stage": "radial-gradient(120% 90% at 50% 0%, #13264A 0%, #0A1428 55%, #070E1C 100%)",
    "--top-bar": "linear-gradient(180deg, rgba(19, 38, 74, 0.90) 0%, rgba(10, 20, 40, 0.90) 100%)",
    "--sheen": "linear-gradient(180deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0) 40%)",
    "--select": "linear-gradient(90deg, rgba(255, 203, 61, 0.18) 0%, rgba(255, 203, 61, 0.06) 100%)",
    // Elevation.
    "--shadow-1": "0 1px 2px rgba(0, 0, 0, 0.24)",
    "--shadow-2": "0 4px 12px rgba(0, 0, 0, 0.28), 0 1px 3px rgba(0, 0, 0, 0.20)",
    "--shadow-3": "0 16px 40px rgba(0, 0, 0, 0.45), 0 4px 12px rgba(0, 0, 0, 0.25)",
    "--shadow-select": "inset 0 0 0 1px rgba(255, 203, 61, 0.40), 0 6px 20px rgba(0, 0, 0, 0.30), 0 0 24px rgba(255, 203, 61, 0.10)",
    // Radii.
    "--radius-sm": "6px",
    "--radius-md": "10px",
    "--radius-lg": "14px",
    "--radius-xl": "20px",
    "--radius-pill": "999px",
    // Motion.
    "--dur-fast": "120ms",
    "--dur-base": "180ms",
    "--dur-slow": "260ms",
    "--dur-screen": "240ms",
    "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
    "--ease-out": "cubic-bezier(0, 0, 0.2, 1)",
    // Typography.
    "--font-ui": '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
    "--font-display": '"Barlow Condensed", "Inter", system-ui, sans-serif',
  };
  it.each(Object.entries(CSS_TOKENS))("%s is %s", (name, want) => {
    expect(norm(rootVars[name])).toBe(norm(want));
  });

  it("the stage gradient is the body background on every screen", () => {
    expect(norm(resolve(declsFor("body")["background"]))).toBe(norm(CSS_TOKENS["--stage"]));
  });
});

// ================================================================ Typography: no mono

describe("Typography: font.mono is retired, two families only", () => {
  const srcFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? srcFiles(p) : /\.(ts|css|html)$/.test(f) ? [p] : [];
    });
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

  it("no monospace, IBM Plex Mono or Atkinson Hyperlegible anywhere in the app's code, CSS or HTML", () => {
    for (const f of [...srcFiles(join(appDir, "src")), join(appDir, "index.html")]) {
      const code = stripComments(readFileSync(f, "utf8"));
      expect(code, f).not.toMatch(/monospace|plex mono|ibm plex|atkinson|ui-monospace|courier|menlo|consolas/i);
    }
  });

  it("every font-family in styles.css reads --font-ui or --font-display", () => {
    const fams = rules.flatMap((r) => Object.entries(r.decls).filter(([k]) => k === "font-family").map(([, v]) => ({ sel: r.selectors.join(", "), v })));
    expect(fams.length).toBeGreaterThan(0);
    for (const { sel, v } of fams) expect(["var(--font-ui)", "var(--font-display)", "inherit"], sel).toContain(norm(v));
  });

  it("no @import, CDN or Google Fonts link for fonts", () => {
    expect(css).not.toMatch(/@import/);
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic|cdn/i);
  });
});

// ================================================================ Rows: rest, selected, off

describe("Rows (hud.playMenu): rest, key hint, selected, off", () => {
  it("rest: color.rowRest fill, radius.md, min height 48, padding 10 14, gap 12, 6 px between rows, weight 500, chalk", () => {
    const d = declsFor(".row");
    expect(d["background"]).toBe("var(--row-rest)");
    expect(d["border-radius"]).toBe("var(--radius-md)");
    expect(d["min-height"]).toBe("48px");
    expect(norm(d["padding"])).toBe("10px 14px");
    expect(d["gap"]).toBe("12px");
    expect(d["font-weight"]).toBe("500");
    expect(d["color"]).toBe("var(--chalk)");
    expect(declsFor(".rows")["gap"]).toBe("6px");
  });

  it("key hint: at least 24 by 24, radius.sm, surfaceRaised fill, no border, 600 13 px tabular chalkSoft", () => {
    const d = declsFor(".row .key");
    expect(norm(d["min-width"])).toMatch(/^(24px|calc\(24px \* var\(--(?:text|bar)-scale\)\))$/);
    expect(norm(d["height"] ?? d["min-height"])).toMatch(/^(24px|calc\(24px \* var\(--(?:text|bar)-scale\)\))$/);
    expect(d["border-radius"]).toBe("var(--radius-sm)");
    expect(d["background"]).toBe("var(--surface-raised)");
    expect(["0", "none"]).toContain(d["border"]);
    expect(d["font-weight"]).toBe("600");
    expect(norm(d["font-size"])).toMatch(/^(13px|calc\(13px \* var\(--(?:text|bar)-scale\)\))$/);
    expect(d["font-variant-numeric"]).toBe("tabular-nums");
    expect(d["color"]).toBe("var(--chalk-soft)");
  });

  const SELECT = "linear-gradient(90deg, rgba(255, 203, 61, 0.18) 0%, rgba(255, 203, 61, 0.06) 100%)";
  const SHADOW_SELECT = "inset 0 0 0 1px rgba(255, 203, 61, 0.40), 0 6px 20px rgba(0, 0, 0, 0.30), 0 0 24px rgba(255, 203, 61, 0.10)";

  it.each([".row.hl", ".row:hover"])("selected (%s): gradient.select fill and shadow.select (the gold ring and glow)", (sel) => {
    const d = declsFor(sel);
    expect(norm(resolve(d["background"] ?? d["background-image"]))).toBe(norm(SELECT));
    expect(norm(resolve(d["box-shadow"]))).toBe(norm(SHADOW_SELECT));
  });

  it("selected is not the paper slab: no paper or chalk fill, no hard border, no inverted text color", () => {
    const selRules = topRules.filter((r) => r.selectors.some((s) => /^\.row(\.hl|:hover)$/.test(s)));
    expect(selRules.length).toBeGreaterThan(0);
    for (const r of selRules) {
      for (const [k, v] of Object.entries(r.decls)) {
        if (/^background/.test(k)) {
          expect(v, `${r.selectors.join(", ")} ${k}`).not.toMatch(/--paper|--chalk|--ink/);
          expect(norm(resolve(v)), `${k}`).not.toContain(norm(COLOR.paper));
        }
        if (/^border/.test(k) && k !== "border-radius") expect(["0", "none"], `${k}: ${v}`).toContain(v);
        if (k === "color") expect(v).not.toBe("var(--ink)");
      }
    }
  });

  it("selected: a 3 px color.gold accent bar on the left, inset 8 px top and bottom, radius 2 px, growing scaleY 0 to 1 over dur.base ease.standard", () => {
    const bar = declsFor(".row::before");
    expect(bar["width"]).toBe("3px");
    expect(bar["left"]).toBe("0");
    expect(bar["top"]).toBe("8px");
    expect(bar["bottom"]).toBe("8px");
    expect(bar["border-radius"]).toBe("2px");
    expect(bar["background"]).toBe("var(--gold)");
    expect(norm(bar["transform"])).toBe("scaley(0)");
    expect(norm(bar["transition"])).toContain("transform var(--dur-base) var(--ease-standard)");
    expect(norm(declsFor(".row.hl::before")["transform"])).toBe("scaley(1)");
  });

  it("selected: label weight 600, key hint filled gold with ink text (selection is never color alone)", () => {
    expect(declsFor(".row.hl .label")["font-weight"]).toBe("600");
    const k = declsFor(".row.hl .key");
    expect(k["background"]).toBe("var(--gold)");
    expect(k["color"]).toBe("var(--ink)");
  });

  it("fill and shadow transition over dur.base ease.standard; pressed is scale(0.99) over dur.fast", () => {
    const t = norm(declsFor(".row")["transition"]);
    expect(t).toMatch(/background(-color|-image)? var\(--dur-base\) var\(--ease-standard\)/);
    expect(t).toContain("box-shadow var(--dur-base) var(--ease-standard)");
    expect(t).toContain("transform var(--dur-fast) var(--ease-standard)");
    expect(norm(declsFor(".row:active")["transform"])).toBe("scale(0.99)");
  });

  it("keyboard focus: 2 px color.chalk outline, offset 2 px", () => {
    const d = declsFor(".row:focus-visible");
    expect(norm(d["outline"])).toBe("2px solid var(--chalk)");
    expect(d["outline-offset"]).toBe("2px");
  });

  it("off: no fill, chalkSoft label and key with no fill; selected while off: 1 px dashed rgba(169, 179, 184, 0.6) inset 2 px, no gold anywhere", () => {
    const off = declsFor(".row.off");
    expect(["transparent", "none"]).toContain(off["background"]);
    expect(off["color"]).toBe("var(--chalk-soft)");
    expect(off["opacity"]).toBeUndefined();
    const key = declsFor(".row.off .key");
    expect(["transparent", "none"]).toContain(key["background"]);
    expect(key["color"]).toBe("var(--chalk-soft)");
    const sel = declsFor(".row.off.hl");
    expect(norm(sel["outline"])).toBe("1px dashed rgba(169, 179, 184, 0.6)");
    expect(sel["outline-offset"]).toBe("-2px");
    expect(["transparent", "none"]).toContain(sel["background"]);
    expect(sel["box-shadow"]).toBe("none");
    expect(norm(declsFor(".row.off.hl::before")["transform"])).toBe("scaley(0)");
    const selKey = declsFor(".row.off.hl .key");
    expect(["transparent", "none"]).toContain(selKey["background"]);
    expect(selKey["color"]).toBe("var(--chalk-soft)");
    // No rule for an off row uses gold.
    for (const r of topRules.filter((x) => x.selectors.some((s) => s.startsWith(".row.off")))) {
      for (const v of Object.values(r.decls)) expect(v, r.selectors.join(", ")).not.toMatch(/--gold|--select|--signal/);
    }
  });
});

// ================================================================ Motion: reduced motion and UI transitions

describe("Motion (UI): reduced motion makes every UI transition 0 ms", () => {
  const animated = topRules.filter((r) => Object.entries(r.decls).some(([k, v]) => (k === "transition" || k === "animation") && !/^none/.test(v)));
  /** Pseudo-elements that carry a transition or animation (e.g. the selected row's accent bar on ::before). */
  const pseudos = [...new Set(animated.flatMap((r) => r.selectors.flatMap((s) => [...s.matchAll(/::?(before|after)\b/g)].map((m) => m[1] as string))))];

  it("precondition: the stylesheet animates something, including a pseudo-element (the accent bar)", () => {
    expect(animated.length).toBeGreaterThan(0);
    expect(pseudos).toContain("before");
  });

  const kills = (r: Rule): boolean => /^none\b/.test(r.decls["transition"] ?? "") && /^none\b/.test(r.decls["animation"] ?? "");

  it("@media (prefers-reduced-motion: reduce) sets transition and animation to none on every element and on every animated pseudo-element", () => {
    const media = rules.filter((r) => r.at.some((a) => /prefers-reduced-motion:\s*reduce/.test(a)) && kills(r));
    const sels = media.flatMap((r) => r.selectors);
    expect(sels).toContain("*");
    for (const p of pseudos) expect(sels.some((s) => s === `*::${p}` || s === `::${p}` || s === `*:${p}`), `::${p} under the system setting`).toBe(true);
  });

  it("the in-game setting (.reduce-motion on the root) does the same", () => {
    const sels = topRules.filter(kills).flatMap((r) => r.selectors);
    expect(sels).toContain(".reduce-motion *");
    for (const p of pseudos) expect(sels, `::${p} under the in-game setting`).toContain(`.reduce-motion *::${p}`);
    // Set on the document root by the app.
    expect(appSource).toMatch(/document\.documentElement\.classList\.toggle\(\s*"reduce-motion"/);
  });

  it("every transition and animation uses the dur and ease tokens, never a literal duration or curve", () => {
    for (const r of animated) {
      for (const k of ["transition", "animation"]) {
        const v = r.decls[k];
        if (v === undefined || /^none/.test(v)) continue;
        const literals = v.replace(/var\(--[a-z0-9-]+\)/gi, "");
        expect(literals, `${r.selectors.join(", ")} ${k}`).not.toMatch(/\b\d+(\.\d+)?m?s\b|cubic-bezier|\bease(-in|-out|-in-out)?\b|\blinear\b|steps\(/);
        expect(v, `${r.selectors.join(", ")} ${k}`).toMatch(/var\(--dur-(fast|base|slow|screen)\)/);
        expect(v, `${r.selectors.join(", ")} ${k}`).toMatch(/var\(--ease-(standard|out)\)/);
      }
    }
  });

  it("no bounce or overshoot: every ease token's control points stay inside 0..1", () => {
    for (const name of ["--ease-standard", "--ease-out"]) {
      const m = /cubic-bezier\(([^)]*)\)/.exec(rootVars[name] ?? "");
      expect(m, name).not.toBeNull();
      for (const n of (m?.[1] ?? "").split(",").map(Number)) expect(n >= 0 && n <= 1, `${name} ${n}`).toBe(true);
    }
  });

  it("calling to play and play to calling: the incoming screen fades in over dur.screen with ease.out; the calling cards rise 8 px", () => {
    expect(norm(declsFor(".field.screen-in")["animation"])).toMatch(/var\(--dur-screen\) var\(--ease-out\)/);
    expect(norm(declsFor(".play-rail.screen-in")["animation"])).toMatch(/var\(--dur-screen\) var\(--ease-out\)/);
    const panel = norm(declsFor(".panel.screen-in")["animation"]);
    expect(panel).toMatch(/var\(--dur-screen\) var\(--ease-out\)/);
    const name = panel.split(" ")[0] as string;
    const from = rules.find((r) => r.at.some((a) => a === `@keyframes ${name}`) && r.selectors.includes("from"));
    expect(norm(from?.decls["transform"])).toBe("translatey(8px)");
    expect(from?.decls["opacity"]).toBe("0");
  });

  // Amended by DESIGN.md "Broadcast build review" 6: the outgoing screen hides in the same frame;
  // only the incoming screen fades in, and ease.in is removed from the tokens.
  it("no outgoing fade: ease.in is gone from the tokens and the CSS, and no keyframes fade anything out", () => {
    expect(rootVars["--ease-in"]).toBeUndefined();
    expect(css).not.toMatch(/--ease-in\b/);
    expect(Object.keys(tokens).some((k) => /ease/i.test(k))).toBe(false);
    const fadeOuts = rules.filter((r) => r.at.some((a) => a.startsWith("@keyframes")) && r.selectors.includes("to") && r.decls["opacity"] === "0");
    expect(fadeOuts.map((r) => r.at.join(" "))).toEqual([]);
    // The app restarts an entrance on the incoming screen only.
    const body = /private placeOverlays\(\)[\s\S]*?\n {2}\}\n/.exec(appSource)?.[0] ?? "";
    expect(body).toMatch(/restartAnimation\(/);
    expect(body).not.toMatch(/fade-?out|screen-out/i);
  });

  // Amended by DESIGN.md "Broadcast build review" 5: the rail's result card is dropped.
  it("the rail has no result card: no .rail-in entrance, and renderRail builds no result or why line", () => {
    expect(rules.some((r) => r.selectors.includes(".rail-in"))).toBe(false);
    const body = /private renderRail\(\)[\s\S]*?\n {2}\}\n/.exec(appSource)?.[0] ?? "";
    expect(body).not.toBe("");
    expect(body).not.toMatch(/rail-result|rail-why|resultLine|whyHeadline|\.why\b|\.result\b/);
    expect(body).toMatch(/"This play"/);
    expect(body).toMatch(/rail-keys/);
  });
});

// ================================================================ HUD: the score bug

describe("HUD, score bug (hud.scoreboard): a glass strip of grouped cells", () => {
  it("top bar: gradient.topBar, glass blur, 1 px hairline bottom border, shadow.2, 12 px in, no gold rule", () => {
    const d = declsFor(".top-bar");
    expect(norm(resolve(d["background"]))).toBe(norm("linear-gradient(180deg, rgba(19, 38, 74, 0.90) 0%, rgba(10, 20, 40, 0.90) 100%)"));
    expect(norm(d["backdrop-filter"])).toBe("blur(18px) saturate(140%)");
    expect(norm(d["-webkit-backdrop-filter"])).toBe("blur(18px) saturate(140%)");
    expect(norm(d["border-bottom"])).toBe("1px solid var(--hairline)");
    expect(d["box-shadow"]).toBe("var(--shadow-2)");
    expect(norm(d["padding"])).toMatch(/^0 12px/);
    // No gold rule: no top-bar rule paints a border, outline or background in gold.
    for (const r of topRules.filter((x) => x.selectors.some((s) => s.startsWith(".top-bar")))) {
      for (const [k, v] of Object.entries(r.decls)) if (/^(border|outline|background|box-shadow)/.test(k)) expect(v, `${r.selectors.join(", ")} ${k}`).not.toMatch(/--gold|--signal|255, 203, 61/);
    }
  });

  it("cells: 44 px tall, radius.md, color.surfaceRaised, padding 0 12 px, 6 px between cells", () => {
    const d = declsFor(".cell");
    expect(d["height"]).toBe("44px");
    expect(d["border-radius"]).toBe("var(--radius-md)");
    expect(d["background"]).toBe("var(--surface-raised)");
    expect(norm(d["padding"])).toBe("0 12px");
    expect(declsFor(".bug")["gap"]).toBe("6px");
  });

  // Amended by DESIGN.md "Broadcast build review" 3: the ring is 0.55 on dark-tier fills, 0.35 on light-tier.
  it("team chip: a 6 by 28 px bar, radius 3 px, 1 px inset ring rgba(255, 255, 255, 0.35); dark tier rgba(255, 255, 255, 0.55)", () => {
    const d = declsFor(".team-chip");
    expect([d["width"], d["height"], d["border-radius"]]).toEqual(["6px", "28px", "3px"]);
    expect(norm(d["box-shadow"])).toBe(norm("inset 0 0 0 1px rgba(255, 255, 255, 0.35)"));
    for (const sel of [".team-chip.dark", ".swatch.dark"]) expect(norm(declsFor(sel)["box-shadow"]), sel).toBe(norm("inset 0 0 0 1px rgba(255, 255, 255, 0.55)"));
    expect(norm(declsFor(".swatch")["box-shadow"])).toBe(norm("inset 0 0 0 1px rgba(255, 255, 255, 0.35)"));
    // Dark tier is exactly the four fills DESIGN.md rings in color.line: red, cobalt, black, purple.
    expect(SWATCHES.filter((f) => tokens.darkTier(f)).map((f) => f.toUpperCase())).toEqual(["#C62F2F", "#3263D2", "#1D1E22", "#7A4EBA"]);
    // Both the bug chip and every swatch take the class by tier.
    expect(appSource).toMatch(/darkTier\(ink\.fill\) \? "team-chip dark" : "team-chip"/);
    expect(readFileSync(join(appDir, "src/ui/dom.ts"), "utf8")).toMatch(/darkTier\(color\) \? "swatch dark" : "swatch"/);
  });

  it("name: display 600 20 px caps, 0.02em, chalk; the You tag a pill on rgba(255, 255, 255, 0.10), small chalkSoft, padding 1 6", () => {
    const n = declsFor(".top-bar .name");
    expect(n["font-family"]).toBe("var(--font-display)");
    expect(n["font-weight"]).toBe("600");
    expect(norm(n["font-size"])).toMatch(/^(20px|calc\(20px \* var\(--(?:text|bar)-scale\)\))$/);
    expect(n["text-transform"]).toBe("uppercase");
    expect(n["letter-spacing"]).toBe("0.02em");
    expect(n["color"]).toBe("var(--chalk)");
    const y = declsFor(".top-bar .you");
    expect(y["border-radius"]).toBe("var(--radius-pill)");
    expect(parseColor(y["background"] ?? "")).toEqual(parseColor("rgba(255, 255, 255, 0.10)"));
    expect(y["color"]).toBe("var(--chalk-soft)");
    expect(norm(y["padding"])).toBe("1px 6px");
  });

  it("timeouts: 14 by 4 px bars, radius 2 px, gap 3 px; left chalk, spent rgba(255, 255, 255, 0.18)", () => {
    const p = declsFor(".pip");
    expect([p["width"], p["height"], p["border-radius"]]).toEqual(["14px", "4px", "2px"]);
    expect(parseColor(p["background"] ?? "")).toEqual(parseColor("rgba(255, 255, 255, 0.18)"));
    expect(declsFor(".pip.on")["background"]).toBe("var(--chalk)");
    expect(declsFor(".pips")["gap"]).toBe("3px");
  });

  it("score: display 700 34 px tabular, min-width 2ch, right aligned, chalk, and the largest text in the bar", () => {
    const s = declsFor(".top-bar .score");
    expect(s["font-family"]).toBe("var(--font-display)");
    expect(s["font-weight"]).toBe("700");
    expect(norm(s["font-size"])).toMatch(/^(34px|calc\(34px \* var\(--(?:text|bar)-scale\)\))$/);
    expect(s["font-variant-numeric"]).toBe("tabular-nums");
    expect(s["min-width"]).toBe("2ch");
    expect(s["text-align"]).toBe("right");
    expect(s["color"]).toBe("var(--chalk)");
    const px = (v: string | undefined): number => Number(/(\d+(?:\.\d+)?)px/.exec(v ?? "")?.[1] ?? 0);
    for (const sel of [".top-bar .name", ".clock", ".bar-dd", ".bar-spot", ".period", ".clock-state", ".tag", ".top-bar"]) expect(px(declsFor(sel)["font-size"]), sel).toBeLessThan(34);
  });

  it("possession: a 10 by 6 px color.signal ellipse", () => {
    const d = declsFor(".poss .dot");
    expect([d["width"], d["height"], d["border-radius"], d["background"]]).toEqual(["10px", "6px", "50%", "var(--signal)"]);
  });

  it("game cell: period and clock state small chalkSoft, clock ui 700 22 px tabular chalk; under 2:00 the clock is signal and the tag is signal on gold at 0.16", () => {
    const c = declsFor(".clock");
    expect(c["font-weight"]).toBe("700");
    expect(norm(c["font-size"])).toMatch(/^(22px|calc\(22px \* var\(--(?:text|bar)-scale\)\))$/);
    expect(c["font-variant-numeric"]).toBe("tabular-nums");
    expect(c["color"]).toBe("var(--chalk)");
    expect(c["font-family"] ?? "var(--font-ui)").toBe("var(--font-ui)");
    expect(declsFor(".clock.late")["color"]).toBe("var(--signal)");
    for (const sel of [".period", ".clock-state"]) {
      const d = declsFor(sel);
      expect(d["color"], sel).toBe("var(--chalk-soft)");
      expect(norm(d["font-size"]), sel).toMatch(/^(12px|calc\(12px \* var\(--(?:text|bar)-scale\)\))$/);
    }
    const late = declsFor(".late-tag");
    expect(parseColor(late["background"] ?? "")).toEqual(parseColor("rgba(255, 203, 61, 0.16)"));
    expect(late["color"]).toBe("var(--signal)");
    expect(declsFor(".tag")["border-radius"]).toBe("var(--radius-pill)");
    expect(declsFor(".tag")["font-weight"]).toBe("600");
  });

  it("situation cell: down and distance in display 700 22 px caps chalk, the spot small chalkSoft; tempo chalkSoft on surfaceRaised", () => {
    const d = declsFor(".bar-dd");
    expect(d["font-family"]).toBe("var(--font-display)");
    expect(d["font-weight"]).toBe("700");
    expect(norm(d["font-size"])).toMatch(/^(22px|calc\(22px \* var\(--(?:text|bar)-scale\)\))$/);
    expect(d["text-transform"]).toBe("uppercase");
    expect(d["color"]).toBe("var(--chalk)");
    expect(declsFor(".bar-spot")["color"]).toBe("var(--chalk-soft)");
    const t = declsFor(".tempo");
    expect([t["background"], t["color"]]).toEqual(["var(--surface-raised)", "var(--chalk-soft)"]);
  });

  it("too narrow: drop key hint labels, then the clock state word, then the key hints; never the score, clock or down and distance", () => {
    const hidden = (cls: string): string[] => topRules.filter((r) => r.decls["display"] === "none").flatMap((r) => r.selectors).filter((s) => s.startsWith(`.top-bar.${cls} `)).map((s) => s.slice(`.top-bar.${cls} `.length));
    expect(hidden("fit-1")).toEqual([".chip-label"]);
    expect(hidden("fit-2")).toEqual([".clock-state"]);
    expect(hidden("fit-3")).toEqual([".bar-keys"]);
    // DESIGN.md "Broadcast build review" 4: then the tempo tag, the Under 2:00 tag, the You tag
    // (visually hidden), type at 100%, 85% with 8 px padding, and names at 16 px.
    expect(hidden("fit-4")).toEqual([".tempo"]);
    expect(hidden("fit-5")).toEqual([".late-tag"]);
    expect(declsFor(".top-bar.fit-6 .you")["clip-path"]).toBe("inset(50%)");
    expect(norm(declsFor(".top-bar.fit-7")["--bar-scale"])).toBe("min(var(--text-scale), 1)");
    expect(declsFor(".top-bar.fit-8")["--bar-scale"]).toBe("0.85");
    expect(norm(declsFor(".top-bar.fit-8 .cell")["padding"])).toBe("0 8px");
    expect(norm(declsFor(".top-bar.fit-9 .name")["font-size"])).toBe("calc(16px * var(--bar-scale))");
    expect(norm(rootVars["--bar-scale"] ?? declsFor(".top-bar")["--bar-scale"])).toBe("min(var(--text-scale), 1.25)");
    const steps = readFileSync(join(appDir, "src/ui/topbar.ts"), "utf8");
    expect([...steps.matchAll(/"(fit-\d+)"/g)].map((m) => m[1])).toEqual(["fit-1", "fit-2", "fit-3", "fit-4", "fit-5", "fit-6", "fit-7", "fit-8", "fit-9"]);
    // Names are never cut or hidden, at any step.
    for (const r of topRules.filter((x) => x.selectors.some((s) => /^\.top-bar\.fit-\d+/.test(s) && /\.(name|team-name|team-id)(?![\w-])/.test(s)))) {
      for (const k of ["display", "clip-path", "max-width", "text-overflow", "visibility"]) expect(r.decls[k], `${r.selectors.join(", ")} ${k}`).toBeUndefined();
    }
    const all = topRules.filter((r) => r.decls["display"] === "none").flatMap((r) => r.selectors).filter((s) => s.startsWith(".top-bar"));
    for (const s of all) expect(s).not.toMatch(/\.score|\.clock(?!-state)|\.bar-dd|\.cell\b|\.bug\b/);
  });

  // Static check of app.ts (no jsdom): the team cell's children in DESIGN.md's grid order, and the
  // bug's cells left to right: away, home, game, situation, tempo.
  it("static: the team cell is chip | name over timeouts | score | possession, and the bug is away, home, game, situation, tempo", () => {
    const body = /private renderTopBar\(\)[\s\S]*?\n {2}\}\n/.exec(appSource)?.[0] ?? "";
    expect(body).not.toBe("");
    const append = /cell\.append\(([\s\S]*?)\);/.exec(body)?.[1] ?? "";
    const order = ["chip", '"team-id"', '"score"', '"poss"'].map((k) => append.indexOf(k));
    expect(order.every((i) => i >= 0), append).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(/h\("span", \{ class: "team-id" \}, name, pips\)/.test(append)).toBe(true);
    expect(body).toMatch(/h\("div", \{ class: "bug" \}, team\("away"\), team\("home"\), game, situation, tempo\)/);
    // The word "ball" for screen readers, visually hidden.
    expect(body).toMatch(/class: "visually-hidden" \}, "ball"/);
  });
});

// ================================================================ The play rail

describe("Play screen: the play rail (hud.playRail) is read only, beside the field, never an overlay", () => {
  const tag = /<[a-z]+\b[^>]*\bid="play-rail"[^>]*>/i.exec(html)?.[0] ?? "";

  it("index.html: #play-rail exists, starts hidden, and is not class overlay", () => {
    expect(tag).not.toBe("");
    expect(/\shidden(?=[\s>=/])/.test(tag)).toBe(true);
    const classes = (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/);
    expect(classes).toContain("play-rail");
    expect(classes).not.toContain("overlay");
  });

  it("the rail is not one of the overlays the field-cover rule shows or hides", () => {
    expect(OVERLAY_IDS as readonly string[]).not.toContain("play-rail");
    expect(Object.keys(overlaysShown({ animating: true, markCard: false }))).not.toContain("play-rail");
  });

  it("holds no menu: the rail's markup has no rows or buttons", () => {
    const body = /private renderRail\(\)[\s\S]*?\n {2}\}\n/.exec(appSource)?.[0] ?? "";
    expect(body).not.toBe("");
    expect(body).not.toMatch(/rowButton|"button"|class: "rows?"/);
  });

  // Static check of app.ts: shown only while a play animates in game mode, and only where playStage gives a rail.
  it("static: shown only during the play, in game mode, when playStage has room for it", () => {
    const body = /private renderRail\(\)[\s\S]*?\n {2}\}\n/.exec(appSource)?.[0] ?? "";
    const show = /const show = ([^;]*);/.exec(body)?.[1] ?? "";
    expect(show).toContain("this.animating");
    expect(show).toMatch(/stage !== null/);
    expect(body).toMatch(/el\.hidden = !show/);
  });

  it("cards: color.surface with sheen, glass blur, 1 px hairline, radius.lg, shadow.2, padding 16 18, 12 px apart", () => {
    const g = declsFor(".rail-card");
    expect(norm(g["background"])).toBe("var(--sheen), var(--surface)");
    expect(norm(g["backdrop-filter"])).toBe("blur(18px) saturate(140%)");
    expect(norm(g["border"])).toBe("1px solid var(--hairline)");
    expect(g["border-radius"]).toBe("var(--radius-lg)");
    expect(g["box-shadow"]).toBe("var(--shadow-2)");
    expect(norm(g["padding"])).toBe("16px 18px");
    expect(declsFor(".play-rail")["gap"]).toBe("12px");
  });

  it("glass falls back to color.surfaceSolid where backdrop-filter is unsupported", () => {
    const fb = rules.filter((r) => r.at.some((a) => /@supports not/.test(a) && /backdrop-filter/.test(a)));
    const glass = fb.filter((r) => r.selectors.includes(".rail-card") || r.selectors.includes(".glass"));
    expect(glass.length).toBeGreaterThan(0);
    for (const r of glass) expect(r.decls["background"] ?? "").toContain("var(--surface-solid)");
  });
});

// ================================================================ Calling screen

describe("Calling screen: content width, two cards, glass cards, the legend", () => {
  it("content at most 1160 px, side padding max(24px, (100% - 1160px) / 2), 24 px top padding", () => {
    expect(norm(declsFor(".panel.screen")["padding"])).toBe(norm("24px max(24px, calc((100% - 1160px) / 2)) 0"));
  });

  it("two cards: minmax(260px, 5fr) 7fr, gap 24", () => {
    const d = declsFor(".panel.wide");
    expect(norm(d["grid-template-columns"])).toBe("minmax(260px, 5fr) 7fr");
    expect(d["column-gap"] ?? d["gap"]).toBe("24px");
  });

  it("cards: sheen over color.surface, glass, 1 px hairline, radius.lg, padding 20 24, shadow.2", () => {
    const g = declsFor(".glass");
    expect(norm(g["background"])).toBe("var(--sheen), var(--surface)");
    expect(norm(g["border"])).toBe("1px solid var(--hairline)");
    expect(g["border-radius"]).toBe("var(--radius-lg)");
    expect(g["box-shadow"]).toBe("var(--shadow-2)");
    expect(norm(declsFor(".panel > .glass")["padding"])).toBe("20px 24px");
  });

  it("legend: sticky at the bottom, color.bg at 0.85 with glass, 1 px hairline top border, padding 10 0", () => {
    const d = declsFor(".panel-foot");
    expect(d["position"]).toBe("sticky");
    expect(d["bottom"]).toBe("0");
    const bg = parseColor(d["background"] ?? "");
    expect(bg.rgb).toEqual(rgb(COLOR.bg));
    expect(bg.a).toBeCloseTo(0.85, 9);
    expect(norm(d["backdrop-filter"])).toBe("blur(18px) saturate(140%)");
    expect(norm(d["border-top"])).toBe("1px solid var(--hairline)");
    expect(norm(d["padding"])).toBe("10px 0");
  });
});

// ================================================================ Contrast checks (Broadcast, dark surfaces)

describe("Contrast checks: the Broadcast dark-surface figures, recomputed (DESIGN.md Still open)", () => {
  const W: Rgb = [255, 255, 255];
  const stageTop = rgb(COLOR.bgTop);
  const glass = over(COLOR.surface, stageTop);
  const row = over(COLOR.rowRest, glass);
  const selected = over(COLOR.gold, glass, 0.18);
  const tol = 0.05;
  const near = (got: number, want: number): void => expect(Math.abs(got - want), `${got.toFixed(3)} vs ${want}`).toBeLessThanOrEqual(tol);
  const atLeast = (got: number, want: number): void => expect(got, `${got.toFixed(3)} vs ${want} or better`).toBeGreaterThanOrEqual(want - tol);

  it("stage: chalk 13.36 and chalkSoft 7.00 at #13264A; 16.39 and 8.60 on #0A1428", () => {
    near(ratio(rgb(COLOR.chalk), stageTop), 13.36);
    near(ratio(rgb(COLOR.chalkSoft), stageTop), 7.0);
    near(ratio(rgb(COLOR.chalk), rgb(COLOR.bg)), 16.39);
    near(ratio(rgb(COLOR.chalkSoft), rgb(COLOR.bg)), 8.6);
  });

  it("glass card over #13264A: chalk 13.92, chalkSoft 7.30; opaque surfaceSolid 14.13 and 7.41", () => {
    near(ratio(rgb(COLOR.chalk), glass), 13.92);
    near(ratio(rgb(COLOR.chalkSoft), glass), 7.3);
    near(ratio(rgb(COLOR.chalk), rgb(COLOR.surfaceSolid)), 14.13);
    near(ratio(rgb(COLOR.chalkSoft), rgb(COLOR.surfaceSolid)), 7.41);
  });

  it("row at rest and anything on surfaceRaised: chalk 11.72 or better, chalkSoft 6.15 or better", () => {
    for (const under of [row, over(COLOR.surfaceRaised, glass)]) {
      atLeast(ratio(rgb(COLOR.chalk), under), 11.72);
      atLeast(ratio(rgb(COLOR.chalkSoft), under), 6.15);
    }
  });

  it("key hint raised over a row: chalkSoft number 5.50", () => {
    near(ratio(rgb(COLOR.chalkSoft), over(COLOR.surfaceRaised, row)), 5.5);
  });

  it("selected row at the gradient's gold end (0.18): chalk 9.20, chalkSoft notes 4.83 (passes 4.5), gold bar 6.8, ink on gold 9.95", () => {
    near(ratio(rgb(COLOR.chalk), selected), 9.2);
    near(ratio(rgb(COLOR.chalkSoft), selected), 4.83);
    expect(ratio(rgb(COLOR.chalkSoft), selected)).toBeGreaterThanOrEqual(4.5);
    near(ratio(rgb(COLOR.gold), selected), 6.8);
    near(ratio(rgb(COLOR.ink), rgb(COLOR.gold)), 9.95);
    // The gradient's gold end is its strongest stop: the other end (0.06) is darker, so chalk does better there.
    expect(ratio(rgb(COLOR.chalk), over(COLOR.gold, glass, 0.06))).toBeGreaterThan(ratio(rgb(COLOR.chalk), selected));
  });

  it("toast: chalk on surfaceSolid 14.13, 13 or better at 0.92 over the turf", () => {
    near(ratio(rgb(COLOR.chalk), rgb(COLOR.surfaceSolid)), 14.13);
    for (const t of [rgb(COLOR.turf), rgb(COLOR.turfStripe), over(COLOR.turfLight, rgb(COLOR.turfStripe))]) atLeast(ratio(rgb(COLOR.chalk), over(rgb(COLOR.surfaceSolid), t, 0.92)), 13);
  });

  // The score bug. The worst pixel under a cell is the top bar's top stop (rgba(19, 38, 74, 0.90))
  // over the lightest stage pixel (#13264A); every cell is color.surfaceRaised over that, and a team
  // cell adds gradient.teamTint (the team fill at 0.14) "over color.surfaceRaised" (DESIGN.md Gradients).
  const barTop = over("rgba(19, 38, 74, 0.90)", stageTop);
  const cell = over(COLOR.surfaceRaised, barTop);
  const teamCell = (fill: string): Rgb => over(fill, cell, 0.14);

  it("every score bug text keeps 4.5:1 at its worst pixel (team cells, the clock, the Under 2:00 tag)", () => {
    for (const f of SWATCHES) expect(ratio(rgb(COLOR.chalk), teamCell(f)), f).toBeGreaterThanOrEqual(4.5);
    expect(ratio(rgb(COLOR.signal), cell)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(rgb(COLOR.signal), over(COLOR.signal, cell, 0.16))).toBeGreaterThanOrEqual(4.5);
  });

  // DESIGN.md's corrected figures ("Broadcast build review" 1), at the worst pixel with the cell layer included.
  it.each([
    ["silver (lowest)", "#C3CCD3", 8.15],
    ["orange", "#F29A2E", 8.98],
    ["lilac", "#B99BE8", 8.78],
    ["azure", "#45A8E6", 8.93],
  ] as const)("scoreboard team cell, %s: chalk at the team tint's strongest pixel is DESIGN.md's figure", (_n, fill, figure) => {
    near(ratio(rgb(COLOR.chalk), teamCell(fill)), figure);
    atLeast(ratio(rgb(COLOR.chalk), teamCell(fill)), figure);
  });

  it("silver is the lowest team cell", () => {
    const lowest = Math.min(...SWATCHES.map((f) => ratio(rgb(COLOR.chalk), teamCell(f))));
    near(lowest, 8.15);
  });

  // "Broadcast build review" 2: signal clock 8.30, Under 2:00 tag 5.81.
  it("signal clock in the game cell: 8.30; the Under 2:00 tag (signal on gold at 0.16): 5.81", () => {
    near(ratio(rgb(COLOR.signal), cell), 8.3);
    near(ratio(rgb(COLOR.signal), over(COLOR.signal, cell, 0.16)), 5.81);
  });

  /** The chip and swatch inset ring by tier ("Broadcast build review" 3). */
  const ringFor = (f: string): Rgb => over(tokens.darkTier(f) ? "rgba(255, 255, 255, 0.55)" : "rgba(255, 255, 255, 0.35)", rgb(f));

  it("team chip: the inset ring by tier keeps 3:1 against its tinted team cell for all eight slots; black is 4.65", () => {
    for (const f of SWATCHES) expect(ratio(ringFor(f), teamCell(f)), f).toBeGreaterThanOrEqual(3);
    near(ratio(ringFor("#1D1E22"), teamCell("#1D1E22")), 4.65);
  });

  it("the swatch ring, the same tier ring on the 12 px swatch, keeps 3:1 against the panel and the glass card", () => {
    for (const f of SWATCHES) {
      const ring = ringFor(f);
      expect(Math.max(ratio(rgb(f), rgb(COLOR.panel)), ratio(ring, rgb(COLOR.panel))), `${f} on panel`).toBeGreaterThanOrEqual(3);
      expect(Math.max(ratio(rgb(f), glass), ratio(ring, glass)), `${f} on glass`).toBeGreaterThanOrEqual(3);
    }
    void W;
  });
});

// ================================================================ Field: turf light, field shadow, first-down line, mark shadows

interface Op {
  readonly op: string;
  readonly fillStyle: unknown;
  readonly strokeStyle: string;
  readonly lineWidth: number;
  readonly lineCap: string;
  readonly dash: readonly number[];
  readonly shadowBlur: number;
  readonly shadowColor: string;
  readonly args: readonly number[];
  readonly text?: string;
}
interface Grad {
  readonly kind: "radial";
  readonly args: readonly number[];
  readonly stops: [number, string][];
}
function recorder(): { g: CanvasRenderingContext2D; ops: Op[]; grads: Grad[] } {
  const ops: Op[] = [];
  const grads: Grad[] = [];
  let dash: number[] = [];
  const state: Record<string, unknown> = { fillStyle: "#000000", strokeStyle: "#000000", font: "10px sans-serif", globalAlpha: 1, lineWidth: 1, lineCap: "butt", shadowBlur: 0, shadowColor: "rgba(0, 0, 0, 0)", shadowOffsetY: 0, textAlign: "start", textBaseline: "alphabetic" };
  const log = (op: string, args: number[], text?: string): void => {
    ops.push({ op, fillStyle: state["fillStyle"], strokeStyle: String(state["strokeStyle"]).toUpperCase(), lineWidth: Number(state["lineWidth"]), lineCap: String(state["lineCap"]), dash: [...dash], shadowBlur: Number(state["shadowBlur"]), shadowColor: String(state["shadowColor"]), args, ...(text === undefined ? {} : { text }) });
  };
  const g = new Proxy(state, {
    get(target, prop: string) {
      if (prop === "measureText") return (s: string) => ({ width: s.length * 7 });
      if (prop === "setLineDash") return (d: number[]) => (dash = [...d]);
      if (prop === "getLineDash") return () => [...dash];
      if (prop === "createRadialGradient")
        return (...args: number[]) => {
          const gr: Grad & { addColorStop: (o: number, c: string) => void } = { kind: "radial", args, stops: [], addColorStop: (o, c) => gr.stops.push([o, c]) };
          grads.push(gr);
          return gr;
        };
      if (prop === "createLinearGradient") return () => ({ addColorStop: () => undefined });
      if (prop === "fillText" || prop === "strokeText") return (s: string, ...a: number[]) => log(prop, a, String(s));
      if (prop === "stroke" || prop === "strokeRect" || prop === "fill" || prop === "fillRect") return (...a: number[]) => log(prop, a);
      if (prop in target) return target[prop];
      return () => undefined;
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { g, ops, grads };
}

const templates = parseTemplates(readJson("data/ui/templates.json"));
const motion = parseMotion(readJson("data/ui/motion.json"));
const personnel = readJson("data/engine/personnel.json") as { presetPackage: Record<string, string> };

describe("Field (Broadcast): turf light, field shadow, the cased first-down line, mark shadows", () => {
  const l = layoutFor(1280, 720, templates.field);
  const stageCol = playStage(l, 1).column;
  const v = viewOf({ ...l, column: stageCol }, cameraAt(40, l.visibleYards, templates.field.losFromTop));
  const scene = { los: 40, firstDown: 50, bottomName: "Bears", topName: "Lions", endZoneYards: 10 };

  it("gradient.turfLight: radial at the column center and view middle, radius 0 to 0.6 * hypot(column, view), color.turfLight to transparent white", () => {
    const r = recorder();
    drawField(r.g, v, scene, 1);
    expect(r.grads).toHaveLength(1);
    const gr = r.grads[0] as Grad;
    const cx = v.ox + v.columnWidth / 2;
    const cy = v.height / 2;
    const [x0, y0, r0, x1, y1, r1] = gr.args;
    expect([x0, y0, r0, x1, y1]).toEqual([cx, cy, 0, cx, cy]);
    expect(r1).toBeCloseTo(0.6 * Math.hypot(v.columnWidth, v.height), 9);
    expect(gr.stops.map(([o]) => o)).toEqual([0, 1]);
    expect(parseColor(gr.stops[0]?.[1] ?? "")).toEqual(parseColor(COLOR.turfLight));
    expect(parseColor(gr.stops[1]?.[1] ?? "")).toEqual(parseColor("rgba(255, 255, 255, 0)"));
  });

  it("the turf light is painted over the turf and stripes and under all field paint", () => {
    const r = recorder();
    drawField(r.g, v, scene, 1);
    const lightAt = r.ops.findIndex((o) => typeof o.fillStyle === "object" && o.fillStyle !== null && (o.fillStyle as Grad).kind === "radial");
    expect(lightAt).toBeGreaterThanOrEqual(0);
    const turfFills = r.ops.map((o, i) => [o, i] as const).filter(([o]) => o.op === "fillRect" && [COLOR.turf, COLOR.turfStripe].includes(String(o.fillStyle).toUpperCase() as "#2F7237"));
    expect(turfFills.length).toBeGreaterThan(0);
    for (const [, i] of turfFills) expect(i).toBeLessThan(lightAt);
    const paint = r.ops.map((o, i) => [o, i] as const).filter(([o]) => o.op === "stroke" || o.op === "fillText");
    expect(paint.length).toBeGreaterThan(0);
    for (const [, i] of paint) expect(i).toBeGreaterThan(lightAt);
  });

  it("field.shadow: shadow.field (blur 40) is cast by the column when the view is wider than it, and reset before the next draw", () => {
    expect(v.width).toBeGreaterThan(v.columnWidth);
    const r = recorder();
    drawField(r.g, v, scene, 1);
    const shadowed = r.ops.filter((o) => o.shadowBlur === 40);
    expect(shadowed.length).toBeGreaterThan(0);
    for (const o of shadowed) expect(parseColor(o.shadowColor)).toEqual(parseColor("rgba(0, 0, 0, 0.50)"));
    // Only the column's own fill casts it: everything after it is drawn with no field shadow.
    const first = r.ops.findIndex((o) => o.shadowBlur === 40);
    expect(r.ops.slice(first + 1).every((o) => o.shadowBlur !== 40)).toBe(true);
  });

  it("no field shadow on the splash (its card has its own shadow)", () => {
    const sv = splashView(400, (s) => Math.max(14, 1.4 * s));
    const r = recorder();
    drawField(r.g, sv, splashScene(), 1);
    expect(r.ops.some((o) => o.shadowBlur === 40)).toBe(false);
  });

  it("first-down line: solid color.signal 3 px over a 5 px color.outlineDark casing, round caps, never dashed", () => {
    const r = recorder();
    drawField(r.g, v, scene, 1);
    const core = r.ops.filter((o) => o.op === "stroke" && o.strokeStyle === COLOR.signal.toUpperCase());
    expect(core.length).toBeGreaterThan(0);
    for (const o of core) {
      expect(o.lineWidth).toBe(3);
      expect(o.dash).toEqual([]);
      expect(o.lineCap).toBe("round");
    }
    const coreAt = r.ops.indexOf(core[0] as Op);
    const casing = r.ops.slice(0, coreAt).filter((o) => o.op === "stroke" && o.strokeStyle === COLOR.outlineDark.toUpperCase() && o.lineWidth === 5);
    expect(casing.length).toBeGreaterThan(0);
    for (const o of casing) {
      expect(o.dash).toEqual([]);
      expect(o.lineCap).toBe("round");
    }
  });

  it("line of scrimmage: solid color.outlineDark 3 px, round caps", () => {
    const r = recorder();
    drawField(r.g, v, { ...scene, firstDown: null }, 1);
    const los = r.ops.filter((o) => o.op === "stroke" && o.strokeStyle === COLOR.outlineDark.toUpperCase() && o.lineWidth === 3);
    expect(los.length).toBeGreaterThan(0);
    for (const o of los) {
      expect(o.dash).toEqual([]);
      expect(o.lineCap).toBe("round");
    }
  });

  it("canvas shadows never fall on labels or tags: every text is drawn with no shadow", () => {
    const tl = timeline({ event: COMPLETE, runoffSeconds: 0 }, templates, { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: l.s, markPx: l.markPx, motion });
    const ids = tl.marks.map((m) => m.playerId);
    const opts: FrameOpts = { numbers: Object.fromEntries(ids.map((id, i) => [id, i + 1])), ratings: Object.fromEntries(ids.map((id, i) => [id, 50 + i])), labelContent: "rating", focused: null, markLabels: "all", routeAlpha: 1, textScale: 1 };
    const fv = viewOf({ ...l, column: stageCol }, cameraAt(COMPLETE.before.spot, l.visibleYards, templates.field.losFromTop));
    for (const t of [0, tl.total]) {
      const r = recorder();
      drawFrame(r.g, fv, tl, t, opts);
      const texts = r.ops.filter((o) => o.op === "fillText" || o.op === "strokeText");
      expect(texts.length).toBeGreaterThan(0);
      for (const o of texts) expect(o.shadowBlur === 0 || parseColor(o.shadowColor).a === 0, `"${o.text}" at t ${t}`).toBe(true);
      // Mark shadows are shadow.mark (blur 4) or the carrier glow (blur 8); nothing wider on the grass.
      const blurs = new Set(r.ops.filter((o) => o.shadowBlur > 0 && parseColor(o.shadowColor).a > 0).map((o) => o.shadowBlur));
      for (const b of blurs) expect([4, 8, 12, 40], `blur ${b}`).toContain(b);
    }
  });
});
