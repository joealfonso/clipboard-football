// A2 to A6: docs/RULES.md cites every leaf of the rule set file, and only real leaves.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const doc = readFileSync(join(repoRoot, "docs/RULES.md"), "utf8");
const rules = JSON.parse(readFileSync(join(repoRoot, "data/rules/nfl-2026.json"), "utf8")) as unknown;

function leafPaths(x: unknown, prefix = ""): string[] {
  if (x !== null && typeof x === "object" && !Array.isArray(x)) {
    return Object.entries(x).flatMap(([k, v]) => leafPaths(v, prefix === "" ? k : `${prefix}.${k}`));
  }
  return [prefix];
}

interface Row {
  key: string;
  value: string;
  words: string;
  reference: string;
  source: string;
  season: string;
  checked: string;
  status: string;
}

function rows(): Row[] {
  const table = doc.slice(doc.indexOf("## Rule set values"));
  return table
    .split("\n")
    .filter((l) => l.startsWith("| `"))
    .map((l) => {
      const cells = l.split(" | ").map((c) => c.replace(/^\| /, "").replace(/ \|$/, "").trim());
      const [key, value, words, reference, source, season, checked, status] = cells.map((c) => c.replace(/^`|`$/g, ""));
      return { key, value, words, reference, source, season, checked, status } as Row;
    });
}

function section(title: string): string {
  const start = doc.indexOf(`## ${title}`);
  const next = doc.indexOf("\n## ", start + 3);
  return doc.slice(start, next === -1 ? undefined : next);
}

const NFL_HOST = /^https:\/\/(operations\.nfl\.com|www\.nfl\.com|nfl\.com|static\.www\.nfl\.com)\//;

describe("RULES.md and the rule set (A2)", () => {
  const leaves = leafPaths(rules);
  const r = rows();

  it("every leaf has exactly one row", () => {
    for (const leaf of leaves) expect(r.filter((x) => x.key === leaf).length, leaf).toBe(1);
  });

  it("every row names a leaf that exists", () => {
    for (const x of r) expect(leaves, x.key).toContain(x.key);
  });

  it("every row's value matches the file", () => {
    const get = (path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], rules);
    for (const x of r) expect(x.value, x.key).toBe(JSON.stringify(get(x.key)));
  });
});

describe("row statuses and citations (A3)", () => {
  it("every row has a known status; confirmed rows cite a rule, season, date and an nfl.com host", () => {
    for (const x of rows()) {
      expect(["confirmed", "unconfirmed", "designed"], x.key).toContain(x.status);
      if (x.status !== "confirmed") continue;
      expect(x.reference, x.key).toMatch(/Rule \d+|Preface/);
      expect(x.season, x.key).toMatch(/^\d{4}$/);
      expect(x.checked, x.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(x.source, x.key).toMatch(NFL_HOST);
    }
  });

  it("the check fails a confirmed row on another host", () => {
    expect("https://en.wikipedia.org/wiki/NFL").not.toMatch(NFL_HOST);
    expect("https://operations.nfl.com.evil.example/x").not.toMatch(NFL_HOST);
  });
});

describe("edition and unconfirmed list (A4)", () => {
  it("states the edition at the top", () => {
    const top = doc.slice(0, doc.indexOf("## Unconfirmed values"));
    expect(top).toMatch(/## Edition used/);
    expect(top).toMatch(/2026 Official Playing Rules/);
  });

  it("lists every unconfirmed value in one place", () => {
    const list = section("Unconfirmed values");
    const unconfirmed = rows().filter((x) => x.status === "unconfirmed");
    if (unconfirmed.length === 0) expect(list).toMatch(/None\./);
    for (const x of unconfirmed) expect(list, x.key).toContain(x.key);
  });

  it("lists every designed value in one place", () => {
    const list = section("Designed values");
    for (const x of rows().filter((y) => y.status === "designed")) expect(list, x.key).toContain(x.key);
  });
});

describe("kickoff section (A5)", () => {
  const k = section("Kickoffs");
  it("covers 2024, 2025 and 2026, and says whether 2026 changed the mechanics", () => {
    for (const s of ["2024", "2025", "2026"]) expect(k).toContain(s);
    expect(k).toMatch(/2026 changed kickoff mechanics from 2025/);
  });

  it.each([
    "kickoff.spot",
    "kickoff.landingZone.from",
    "kickoff.landingZone.to",
    "kickoff.touchbackAfterLandingZone",
    "kickoff.touchbackFromEndZone",
    "kickoff.touchbackFromMidfield",
    "kickoff.shortOrOutOfBoundsYards",
    "kickoff.fairCatchAllowed",
    "kickoff.onside.allowedWhen",
    "kickoff.onside.declarationRequired",
  ])("%s is cited or flagged", (key) => {
    const row = rows().find((x) => x.key === key);
    expect(row?.status === "confirmed" || row?.status === "unconfirmed").toBe(true);
  });
});

describe("overtime (A6)", () => {
  it("has regular-season and postseason entries for every overtime field", () => {
    const o = section("Overtime");
    expect(o).toMatch(/### Regular season/);
    expect(o).toMatch(/### Postseason/);
    const fields = Object.keys((rules as { overtime: { regularSeason: object } }).overtime.regularSeason);
    for (const fmt of ["regularSeason", "postseason"]) {
      for (const f of fields) expect(rows().some((x) => x.key === `overtime.${fmt}.${f}`), `${fmt}.${f}`).toBe(true);
    }
  });
});
