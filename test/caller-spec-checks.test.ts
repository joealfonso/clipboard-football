// Checks written from docs/specs/m1-step2-call-menus-and-baseline-caller.md, its resolved
// open questions, and DECISIONS.md "Post-validation revision 1". They read the committed
// files directly, without the shared parsers, so a parser bug cannot hide a data bug.
//
// Covers: the seven-choice rule on the real catalog (A2, CLAUDE.md), every cell summing to
// 10,000 (C6), tolerances as pre-registered (E6, resolved questions 9 and 11), every metric in the
// summary (E1), the config hash in the report (E4), DECISIONS.md entries (E4), MODEL.md
// labels (E5) and the CLAUDE.md open issues (E7).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bytes = (p: string): Buffer => readFileSync(join(root, p));
const text = (p: string): string => bytes(p).toString("utf8");
const json = <T>(p: string): T => JSON.parse(text(p)) as T;

function sha(...parts: Buffer[]): string {
  const h = createHash("sha256");
  for (const p of parts) {
    h.update(p);
    h.update(Buffer.from([0]));
  }
  return h.digest("hex");
}

function section(doc: string, heading: string): string {
  const start = doc.indexOf(heading);
  if (start < 0) return "";
  const level = heading.match(/^#+/)?.[0] ?? "##";
  const rest = doc.slice(start + heading.length);
  const next = rest.search(new RegExp(`\\n${level} `));
  return next < 0 ? rest : rest.slice(0, next);
}

interface Catalog {
  screens: { id: string; title: string; side?: string; choices: { id: string; key: number }[] }[];
}

describe("menus on the real catalog", () => {
  const catalog = json<Catalog>("data/calls/catalog.json");

  it("no screen has more than 7 choices, and keys run 1..n", () => {
    for (const s of catalog.screens) {
      expect(s.choices.length, s.title).toBeGreaterThanOrEqual(1);
      expect(s.choices.length, s.title).toBeLessThanOrEqual(7);
      expect(s.choices.map((c) => c.key), s.title).toEqual(s.choices.map((_, i) => i + 1));
    }
  });

  it("no offense screen has more than 5 choices (the 10-item menu is split)", () => {
    for (const s of catalog.screens.filter((x) => x.id.startsWith("offense."))) {
      expect(s.choices.length, s.title).toBeLessThanOrEqual(5);
    }
  });

  it("has the 13 defensive presets after revision 1, with Nickel Cover 2 on the Nickel screen", () => {
    const byScreen = Object.fromEntries(catalog.screens.map((s) => [s.id, s.choices.map((c) => c.id)]));
    expect(byScreen["defense.base"]).toEqual(["baseCover3", "baseCover2", "runStuff"]);
    expect(byScreen["defense.nickel"]).toEqual(["nickelCover3", "nickelCover4", "nickelCover2", "nickel2Man", "nickelCover1", "nickelCover1Blitz"]);
    expect(byScreen["defense.dime"]).toEqual(["dimeCover4", "dimeCover0Blitz"]);
    expect(byScreen["defense.specials"]).toEqual(["goalLine", "prevent"]);
  });
});

interface Tables {
  factors: Record<string, { targets: string[]; cells: Record<string, number[]>[] }>;
}

describe("every stored cell (C6)", () => {
  it.each(["data/caller/offense.table.json", "data/caller/defense.table.json"])("%s: weights are non-negative integers summing to exactly 10,000", (path) => {
    const t = json<Tables>(path);
    let cells = 0;
    for (const [fid, f] of Object.entries(t.factors)) {
      for (const [level, map] of f.cells.entries()) {
        for (const [key, w] of Object.entries(map)) {
          cells += 1;
          const where = `${fid} L${level} ${key}`;
          expect(w, where).toHaveLength(f.targets.length);
          for (const x of w) expect(Number.isInteger(x) && x >= 0, where).toBe(true);
          expect(w.reduce((a, b) => a + b, 0), where).toBe(10000);
        }
      }
    }
    expect(cells).toBeGreaterThan(0);
  });

  it("golden traces carry only cells that sum to 10,000 before masking", () => {
    const golden = json<{ situations: { offense: { trace: Record<string, { level: number; key: string }> } }[] }>("data/caller/golden.json");
    const off = json<Tables>("data/caller/offense.table.json");
    for (const g of golden.situations) {
      for (const [fid, t] of Object.entries(g.offense.trace)) {
        // Amended 2026-11-12 (M1 step 5c milestone C): a late try decided by the designed chart is traced at
        // level -2 (key "chart|window|score"); it is not a fitted cell, so it has no table entry to sum.
        if (fid === "oTry" && t.level === -2) {
          expect(t.key).toMatch(/^chart\|/);
          continue;
        }
        const cell = off.factors[fid]?.cells[t.level]?.[t.key];
        expect(cell, `${fid} ${t.key}`).toBeDefined();
        expect(cell?.reduce((a, b) => a + b, 0)).toBe(10000);
      }
    }
  });
});

interface Tolerances {
  metrics: { id: string; tolerance: number; minN: number }[];
  known_deviations: Record<string, unknown>[];
}

describe("tolerances are the pre-registered ones (E6, resolved question 11)", () => {
  const tol = json<Tolerances>("data/caller/tolerances.json");

  it("match the spec's proposed tolerances and minimum samples", () => {
    const got = Object.fromEntries(tol.metrics.map((m) => [m.id, [m.tolerance, m.minN]]));
    expect(got).toEqual({
      passRate: [2.0, 0],
      passRateByDown: [3.0, 500],
      fourthDown: [5.0, 200],
      goForTwo: [3.0, 0],
      kneel: [5.0, 100],
      spike: [3.0, 100],
      depth: [3.0, 0],
      passType: [3.0, 0],
      runType: [4.0, 0],
      formation: [4.0, 0],
      blitz: [4.0, 0],
      man: [4.0, 0],
      preset: [4.0, 0],
    });
  });

  it("known deviations carry every field the spec names, and only Joseph approves them", () => {
    for (const d of tol.known_deviations) {
      for (const k of ["metric", "observed", "target", "reason", "date", "approved_by"]) expect(d, k).toHaveProperty(k);
      expect(d["approved_by"]).toBe("Joseph");
    }
  });
});

interface Summary {
  configHash: string;
  validationSeasons: number[];
  metrics: { id: string; label: string; n: number; predicted: number; actual: number; ci95: [number, number] | null; tolerance: number; status: string }[];
}

describe("validation summary and report (E1, E4)", () => {
  const summary = json<Summary>("data/caller/validation.json");
  const report = text("docs/CALLER_REPORT.md");
  const zones = ["BACK", "OWN", "MID", "FR", "RZ", "GL"];
  const expected = [
    "passRate",
    ...[1, 2, 3, 4].map((d) => `passRateByDown.${d}`),
    ...zones.flatMap((z) => ["go", "punt", "fieldGoal"].map((c) => `fourthDown.${z}.${c}`)),
    "goForTwo",
    ...["H1F", "GF"].flatMap((t) => ["T", "0", "L"].map((s) => `kneel.${t}.${s}`)),
    "spike.H1F",
    "spike.GF",
    "depth.shortPass",
    "depth.intermediatePass",
    "depth.deepPass",
    "passType.screenPass",
    "passType.playAction",
    "runType.insideRun",
    "runType.outsideRun",
    "runType.qbSneak",
    ...["shotgun", "underCenter", "pistol", "empty", "heavy"].map((f) => `formation.${f}`),
    "blitz",
    "man",
    ...["baseCover3", "baseCover2", "runStuff", "nickelCover3", "nickelCover4", "nickelCover2", "nickel2Man", "nickelCover1", "nickelCover1Blitz", "dimeCover4", "dimeCover0Blitz", "goalLine", "prevent"].map(
      (p) => `preset.${p}`,
    ),
  ];

  it("has every metric in the spec's table, one row each, validated on 2024 and 2025", () => {
    expect(summary.validationSeasons).toEqual([2024, 2025]);
    expect(summary.metrics.map((m) => m.id).sort()).toEqual([...expected].sort());
  });

  it("gives predicted, actual, n, a 95% interval around actual, tolerance and a status for each", () => {
    for (const m of summary.metrics) {
      expect(m.n, m.id).toBeGreaterThan(0);
      expect(m.predicted, m.id).toBeGreaterThanOrEqual(0);
      expect(m.predicted, m.id).toBeLessThanOrEqual(1);
      expect(m.ci95, m.id).not.toBeNull();
      const [lo, hi] = m.ci95 ?? [NaN, NaN];
      expect(lo <= m.actual + 1e-6 && m.actual <= hi + 1e-6, m.id).toBe(true);
      expect(["pass", "fail", "not gated", "accepted"]).toContain(m.status);
    }
  });

  it("lists each metric in the report's validation table with its result", () => {
    const table = section(report, "## 9. Validation");
    for (const m of summary.metrics) {
      const row = table.split("\n").find((l) => l.startsWith(`| ${m.label} |`));
      expect(row, m.label).toBeDefined();
      expect(row, m.label).toContain(`| ${m.status}`);
    }
  });

  it("prints the hash of the committed catalog and config", () => {
    const hash = sha(bytes("data/calls/catalog.json"), bytes("data/caller/config.json"));
    expect(report).toContain(`Config hash (catalog.json + config.json): \`${hash}\``);
  });
});

describe("docs (E4, E5, E7)", () => {
  it("DECISIONS.md has an entry for each designed choice the spec names", () => {
    const step = section(text("docs/DECISIONS.md"), "## M1 step 2");
    for (const h of [
      "### Situation bins",
      "### Backoff chains",
      "### N, half-life and tolerances",
      "### Offense mapping",
      "### Defense mapping",
      "### Defense missingness handling",
      "### Post-validation revision 1",
    ]) {
      expect(step, h).toContain(h);
    }
  });

  it("MODEL.md marks the baseline play caller mixed, splits fitted from designed, and never calls the defense mapping data-derived", () => {
    const s = section(text("docs/MODEL.md"), "## Baseline play caller");
    expect(s).toMatch(/\*\*Mixed\.\*\*/);
    expect(s).toMatch(/^Fitted\b/m);
    expect(s).toMatch(/^Designed\b/m);
    const designed = s.slice(s.search(/^Designed\b/m));
    for (const needle of ["catalog", "bins", "backoff", "mapping", "factorization", "assumption", "Nickel Cover 2"]) {
      expect(s.includes(needle) || designed.includes(needle), needle).toBe(true);
    }
    // Every mention of "data-derived" is a denial.
    for (const m of s.matchAll(/data-derived/g)) {
      const before = s.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
      expect(before, before).toMatch(/\b(not|never)\b/);
    }
  });

  it("CLAUDE.md marks the caller and 10-item menu issues settled, pointing to DECISIONS.md", () => {
    const claude = text("CLAUDE.md");
    const open = claude.split("\n").find((l) => l.startsWith("- Open issues")) ?? "";
    expect(open).not.toMatch(/baseline play caller/i);
    expect(open).not.toMatch(/10-item offense menu/i);
    const settled = claude.split("\n").filter((l) => l.startsWith("- Settled"));
    const caller = settled.find((l) => /baseline play caller/i.test(l));
    const menu = settled.find((l) => /offense menu/i.test(l));
    expect(caller).toBeDefined();
    expect(menu).toBeDefined();
    expect(caller).toContain("docs/DECISIONS.md");
    expect(menu).toContain("docs/DECISIONS.md");
  });
});
