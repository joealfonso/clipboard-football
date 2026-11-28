// Font intake (2026-11-15, Joseph approved bundling): every @font-face loads a local file that is in
// the repo, with its family's license beside it and shipped in the build (public/fonts/); the faces are the ones DESIGN.md Typography names;
// docs/ASSETS.md records each file's size and sha256; and the canvas redraws once the faces load.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CANVAS_FACES, whenCanvasFontsReady } from "../src/ui/fonts";

const root = join(import.meta.dirname, "../../..");
const cssPath = join(root, "packages/app/src/styles.css");
const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
  const body = m[1] ?? "";
  const decl = (k: string): string => new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([^;]*)`).exec(body)?.[1]?.trim() ?? "";
  return { family: decl("font-family"), weight: decl("font-weight"), style: decl("font-style"), display: decl("font-display"), src: decl("src"), urls: [...decl("src").matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((u) => u[1] as string) };
});

describe("@font-face: local files only, each with its license beside it", () => {
  it("three faces: Inter variable 100 to 900, Barlow Condensed 600 and 700, all font-display: swap, normal style", () => {
    expect(faces.map((f) => `${f.family} ${f.weight}`)).toEqual(['"Inter" 100 900', '"Barlow Condensed" 600', '"Barlow Condensed" 700']);
    for (const f of faces) {
      expect(f.display, f.family).toBe("swap");
      expect(f.style, f.family).toBe("normal");
    }
  });

  it("every src is a relative local .woff2 that exists in the repo (no CDN, no absolute path, no data URL)", () => {
    const all = faces.flatMap((f) => f.urls);
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (const u of all) {
      expect(u, u).not.toMatch(/^(https?:|\/\/|data:|\/)/i);
      expect(isAbsolute(u)).toBe(false);
      expect(u.endsWith(".woff2"), u).toBe(true);
      const file = resolve(dirname(cssPath), u);
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size, file).toBeGreaterThan(1000);
      // woff2 magic number.
      expect(readFileSync(file).subarray(0, 4).toString("latin1"), file).toBe("wOF2");
    }
  });

  it("each font file has its family's SIL OFL 1.1 license file beside it", () => {
    for (const f of faces) {
      for (const u of f.urls) {
        const dir = dirname(resolve(dirname(cssPath), u));
        const prefix = f.family.includes("Inter") ? "Inter" : "BarlowCondensed";
        const lic = readdirSync(dir).find((n) => n.startsWith(`${prefix}-LICENSE`));
        expect(lic, `${f.family} license in ${dir}`).toBeDefined();
        const text = readFileSync(join(dir, lic as string), "utf8");
        expect(text).toMatch(/SIL Open Font License, Version 1\.1/);
        expect(text).toMatch(f.family.includes("Inter") ? /Inter Project Authors/ : /Barlow Project Authors/);
      }
    }
  });

  // OFL 1.1 condition 2: the license ships with the fonts. Vite copies public/ into the build as is,
  // and nothing references the copies beside the sources, so the build ships the public/fonts/ ones.
  it("each family's license also ships in the build: a byte-identical copy in packages/app/public/fonts/", () => {
    const src = join(root, "packages/app/src/assets/fonts");
    const pub = join(root, "packages/app/public/fonts");
    for (const n of ["Inter-LICENSE.txt", "BarlowCondensed-LICENSE.txt"]) {
      expect(existsSync(join(pub, n)), `public/fonts/${n}`).toBe(true);
      expect(readFileSync(join(pub, n)).equals(readFileSync(join(src, n))), `${n} matches the copy beside the fonts`).toBe(true);
    }
    // The app's Vite config keeps the default public directory (it doesn't set publicDir).
    expect(readFileSync(join(root, "packages/app/vite.config.ts"), "utf8")).not.toMatch(/publicDir/);
  });

  it("the --font-ui and --font-display stacks are unchanged and name the bundled families first", () => {
    const root_ = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(root_).toMatch(/--font-ui:\s*"Inter", system-ui, -apple-system, "Segoe UI", sans-serif;/);
    expect(root_).toMatch(/--font-display:\s*"Barlow Condensed", "Inter", system-ui, sans-serif;/);
  });

  it("no @import and no remote url() anywhere in the stylesheet", () => {
    expect(css).not.toMatch(/@import/i);
    expect(css).not.toMatch(/url\(\s*["']?(https?:)?\/\//i);
  });
});

describe("docs/ASSETS.md logs each bundled file with its real size and sha256", () => {
  const assets = readFileSync(join(root, "docs/ASSETS.md"), "utf8");
  const dir = join(root, "packages/app/src/assets/fonts");
  for (const n of readdirSync(dir).filter((x) => x.endsWith(".woff2"))) {
    it(n, () => {
      const bytes = readFileSync(join(dir, n));
      const sha = createHash("sha256").update(bytes).digest("hex");
      const row = assets.split("\n").find((l) => l.includes(n)) ?? "";
      expect(row, `a row for ${n}`).not.toBe("");
      expect(row).toContain(sha);
      expect(row.replace(/,/g, "")).toContain(String(bytes.length));
      expect(row).toMatch(/SIL OFL 1\.1/);
      expect(row).toMatch(/https:\/\/cdn\.jsdelivr\.net\/npm\/@fontsource(-variable)?\/(inter|barlow-condensed)@5\.3\.0\/files\//);
    });
  }
});

describe("the canvas redraws once its faces have loaded (DESIGN.md Typography)", () => {
  it("requests every canvas face, waits for document.fonts.ready, then redraws once", async () => {
    const loaded: string[] = [];
    let readyResolve: () => void = () => undefined;
    const ready = new Promise<void>((r) => (readyResolve = r));
    let redraws = 0;
    const p = whenCanvasFontsReady({ load: (f) => (loaded.push(f), Promise.resolve([])), ready }, () => redraws++);
    await Promise.resolve();
    expect(loaded).toEqual([...CANVAS_FACES]);
    expect(redraws).toBe(0);
    readyResolve();
    await p;
    expect(redraws).toBe(1);
  });

  it("the canvas faces cover the families and weights field.ts draws with", () => {
    const field = readFileSync(join(root, "packages/app/src/ui/field.ts"), "utf8");
    expect(field).toMatch(/`600 \$\{[^}]+\}px \$\{FONT_UI\}`/);
    expect(field).toMatch(/`700 \$\{[^}]+\}px \$\{FONT_DISPLAY\}`/);
    expect(CANVAS_FACES.some((f) => f.startsWith("600") && f.includes('"Inter"'))).toBe(true);
    expect(CANVAS_FACES.some((f) => f.startsWith("700") && f.includes('"Barlow Condensed"'))).toBe(true);
  });

  it("a face that fails to load still ends the wait with one redraw (the fallback stays)", async () => {
    let redraws = 0;
    await whenCanvasFontsReady({ load: () => Promise.reject(new Error("blocked")), ready: Promise.resolve() }, () => redraws++);
    expect(redraws).toBe(1);
  });

  it("no FontFaceSet: no redraw and no error", async () => {
    let redraws = 0;
    await whenCanvasFontsReady(undefined, () => redraws++);
    expect(redraws).toBe(0);
  });
});
