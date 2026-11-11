// A8: docs/MENUS.md lists every catalog screen with its numbered choices, and nothing else.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCatalog } from "../src/schema";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const catalog = parseCatalog(JSON.parse(readFileSync(join(repoRoot, "data/calls/catalog.json"), "utf8")));
const doc = readFileSync(join(repoRoot, "docs/MENUS.md"), "utf8");

// "## Title" sections; within each, "N. Label: description" lines.
function sections(text: string): Map<string, { key: number; label: string; description: string }[]> {
  const out = new Map<string, { key: number; label: string; description: string }[]>();
  let current: string | null = null;
  for (const line of text.split("\n")) {
    const h = /^## (.+)$/.exec(line);
    if (h) {
      current = h[1] as string;
      out.set(current, []);
      continue;
    }
    const item = /^(\d+)\. ([^:]+): (.+)$/.exec(line);
    if (item && current !== null) {
      out.get(current)?.push({ key: Number(item[1]), label: item[2] as string, description: item[3] as string });
    }
  }
  return out;
}

describe("docs/MENUS.md", () => {
  const found = sections(doc);
  const screens = new Map([...found].filter(([, items]) => items.length > 0));

  it("has exactly the catalog's screens, in order", () => {
    expect([...screens.keys()]).toEqual(catalog.screens.map((s) => s.title));
  });

  it.each(catalog.screens.map((s) => [s.title, s] as const))("%s lists the catalog's choices", (title, s) => {
    expect(screens.get(title)?.map((c) => [c.key, c.label])).toEqual(s.choices.map((c) => [c.key, c.label]));
    for (const c of screens.get(title) ?? []) expect(c.description.length).toBeGreaterThan(0);
  });
});
