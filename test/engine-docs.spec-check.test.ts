// Spec checks for M1 step 4 (docs/specs/m1-step4-play-engine.md) on docs, the report and the
// committed validation summary: A1, A7, A8, B6, B7, D8, F1, F2, F5, F6. Written by test-writer
// from the spec; none of these had a test before.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const text = (p: string): string => readFileSync(join(root, p), "utf8");
const json = <T>(p: string): T => JSON.parse(text(p)) as T;

/** The body of a `## heading` section, up to the next heading of the same level. */
function section(doc: string, heading: string): string {
  const lines = doc.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return "";
  const level = heading.split(" ")[0] as string;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+) /.exec(lines[i] as string);
    if (m !== null && (m[1] as string).length <= level.length) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

const MODEL = text("docs/MODEL.md");
const DECISIONS = text("docs/DECISIONS.md");
const REPORT = text("docs/ENGINE_REPORT.md");
const DATA = text("docs/DATA.md");

describe("A1: DATA.md surveys load_combine and records its license from a primary source", () => {
  it("has a combine survey with rows per season, columns and null rates per drill and position", () => {
    expect(DATA).toMatch(/load_combine\(\)/);
    const s = DATA.slice(DATA.indexOf("load_combine()"));
    expect(s).toMatch(/Rows per season/);
    expect(s).toMatch(/null %/i);
    expect(s).toMatch(/Null % per drill and position/);
  });

  it("has a license row for the combine naming a primary source (the nflverse repo)", () => {
    const row = DATA.split("\n").find((l) => l.startsWith("| Combine |"));
    expect(row).toBeDefined();
    expect(row).toMatch(/LICENSE/);
    expect(row).toMatch(/github\.com\/nflverse/);
  });
});

describe("A7: the name check ran against nflverse rosters with zero collisions", () => {
  it("the report states the count checked and zero matches", () => {
    expect(REPORT).toMatch(/Name check: [\d,]+ first-last combinations, 0 match a real player/);
  });
});

describe("A8 and F5: MODEL.md sections are filled and labeled", () => {
  it.each([
    ["## Play outcome models", /\*\*Fitted/],
    ["## Special teams", /fitted/i],
    ["## Penalties", /\*\*Fitted rates, designed pairing/],
    ["## Ratings", /\*\*Mixed/],
    ["## Matchup table", /\*\*Designed/],
  ])("%s carries its label", (h, label) => {
    const s = section(MODEL, h);
    expect(s.length, h).toBeGreaterThan(200);
    expect(s).toMatch(label);
  });

  it("Special teams marks kickoffs designed and carries the 2026 note", () => {
    const s = section(MODEL, "## Special teams");
    expect(s).toMatch(/[Kk]ickoffs?[^.]*designed/);
    expect(s).toMatch(/2026/);
  });

  it("Ratings records the rating list, the percentile curve, the unit weights and what is measured or designed", () => {
    const s = section(MODEL, "## Ratings");
    for (const r of ["Speed", "Strength", "Agility", "Awareness"]) expect(s).toContain(r);
    expect(s).toMatch(/curve/);
    expect(s).toMatch(/[Uu]nit/);
    expect(s).toMatch(/weight/);
    expect(s).toMatch(/Measured/);
    expect(s).toMatch(/Designed/);
  });

  it("DECISIONS.md has an entry for each of the lead's 14 resolved questions", () => {
    const step4 = section(DECISIONS, "## M1 step 4: play engine");
    for (let q = 1; q <= 14; q++) expect(step4, `question ${q}`).toMatch(new RegExp(`spec open question ${q}\\b`));
  });

  it("PERF.md records C9 with machine and command", () => {
    const perf = text("docs/PERF.md");
    const line = perf.split("\n").find((l) => l.includes("play engine speed (C9)"));
    expect(line).toBeDefined();
    expect(line).toMatch(/Command: `[^`]+`/);
    expect(line).toMatch(/Mac|Linux|Windows/);
    expect(line).toMatch(/per play/);
  });
});

describe("D8: the matchup table is documented as designed, never fitted or data-derived", () => {
  const s = section(MODEL, "## Matchup table");
  const raw = json<{ matchup: { label: string; reason: string }[]; formation: { label: string; reason: string }[] }>("data/engine/matchup.json");
  const mixed = [...raw.matchup, ...raw.formation].filter((c) => c.label === "mixed");

  it("never calls the table fitted or data-derived (other than 'never data-derived')", () => {
    const stripped = s.replace(/never data-derived/gi, "").replace(/not fitted/gi, "");
    expect(stripped).not.toMatch(/data-derived/i);
    expect(stripped).not.toMatch(/\bfitted (table|multipliers?|cells?)\b/i);
  });

  it("names the centering method", () => {
    expect(s).toMatch(/\*\*Centering\.\*\*/);
  });

  it("every mixed cell is documented with its data source and seasons, or the doc says none is mixed", () => {
    if (mixed.length === 0) expect(s).toMatch(/No cell is `mixed`/);
    for (const c of mixed) expect(s).toContain(c.reason);
  });
});

describe("B6 and B7: the report shows the duration subsample and the field goal drift", () => {
  it("B6: the measured duration subsample's size per family and its class mix against all plays", () => {
    const s = section(REPORT, "## 3. Play duration");
    for (const fam of ["run", "pass"]) expect(s).toMatch(new RegExp(`\\| ${fam} \\| [\\d,]+ of [\\d,]+ \\|`));
    expect(s).toMatch(/class mix, measured vs all/);
  });

  it("B7: field goal make rate per training season by band, actual against the curve", () => {
    const s = section(REPORT, "## 5. Field goals");
    for (let y = 2016; y <= 2023; y++) expect(s).toMatch(new RegExp(`^\\| ${y} \\|`, "m"));
    for (const band of ["<30", "30-39", "40-49", "50+"]) expect(s).toContain(`${band} actual / curve`);
  });
});

interface Row {
  id: string;
  n: number;
  predicted: number | null;
  actual: number | null;
  ci95: [number, number] | null;
  tolerance: number;
  status: string;
}

describe("F1: tolerances.json was pre-registered and its hash recorded before the run", () => {
  it("the hash DECISIONS.md recorded before the run is the committed tolerances.json's", () => {
    const entry = section(DECISIONS, "### Tolerances pre-registered before the first validation run (spec open question 14, F1)");
    const m = /sha256 `([0-9a-f]{64})`/.exec(entry);
    expect(m).not.toBeNull();
    // Joseph's known_deviations are the only part that may be added after the run, so the hash is
    // taken over the file with that array put back to its pre-registered empty form. Every other byte
    // (tolerances, minN, seed) must still match what was registered.
    const raw = readFileSync(join(root, "data/engine/tolerances.json"), "utf8");
    // Tightened (code review): the bytes before the first "known_deviations" key, with the
    // pre-registered empty array appended, must hash to the recorded value; the tail must be
    // exactly that one key holding one array (so nothing, such as a second "metrics", can hide
    // after it); and the parsed top-level keys must be the pre-registered set.
    const at = raw.indexOf('"known_deviations"');
    expect(at).toBeGreaterThan(0);
    const preRegistered = raw.slice(0, at) + '"known_deviations": []\n}\n';
    expect(createHash("sha256").update(preRegistered).digest("hex")).toBe(m?.[1]);
    const tail = JSON.parse(`{${raw.slice(at)}`) as Record<string, unknown>;
    expect(Object.keys(tail)).toEqual(["known_deviations"]);
    expect(Array.isArray(tail["known_deviations"])).toBe(true);
    expect(raw.slice(at)).toMatch(/^"known_deviations": \[[\s\S]*\]\n\}\n$/);
    expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual(Object.keys(JSON.parse(preRegistered) as object).sort());
  });

  it("known deviations added after the run carry every field and only Joseph approves them", () => {
    const tol = JSON.parse(readFileSync(join(root, "data/engine/tolerances.json"), "utf8")) as {
      known_deviations: Record<string, unknown>[];
    };
    for (const d of tol.known_deviations) {
      for (const k of ["metric", "observed", "target", "reason", "date", "approved_by"]) expect(d, k).toHaveProperty(k);
      expect(d["approved_by"]).toBe("Joseph");
    }
  });
});

describe("F2: the validation summary has every metric with predicted, actual, n, interval, tolerance and status", () => {
  const v = json<{ metrics: Row[]; inSample: { metrics: Row[] } }>("data/engine/validation.json");
  const ids = new Set(v.metrics.map((m) => m.id));
  const scrimmage = ["insideRun", "outsideRun", "qbSneak", "shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"];
  const passes = ["shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"];

  it("every spec metric is present", () => {
    const want = [
      ...scrimmage.map((l) => `meanYards.${l}`),
      "bigPlay.run", "bigPlay.pass", "completion.all", ...passes.map((l) => `completion.${l}`),
      "sackRate", "intRate", "fumble.run", "fumble.completion", "fumbleLost.run", "fumbleLost.completion",
      "fieldGoal.<30", "fieldGoal.30-39", "fieldGoal.40-49", "fieldGoal.50+", "extraPoint", "twoPoint",
      "puntGross", "puntNet", "punt.touchback", "punt.fairCatch", "punt.return", "kickoff.meanStart",
      ...Object.keys(json<{ penalties: Record<string, unknown> }>("data/rules/nfl-2026.json").penalties).map((p) => `penalty.${p}`),
    ];
    expect(want.filter((w) => !ids.has(w))).toEqual([]);
    for (const l of scrimmage) expect([...ids].some((i) => i.startsWith(`classShare.${l}.`)), l).toBe(true);
  });

  it("every row has predicted, actual, n, a 95% interval of the actual, a tolerance and a known status", () => {
    const bad: string[] = [];
    for (const m of v.metrics) {
      const ok =
        typeof m.n === "number" &&
        typeof m.predicted === "number" &&
        typeof m.actual === "number" &&
        Array.isArray(m.ci95) &&
        m.ci95.length === 2 &&
        (m.ci95[0] as number) <= (m.actual as number) + 1e-9 &&
        (m.actual as number) <= (m.ci95[1] as number) + 1e-9 &&
        typeof m.tolerance === "number" &&
        ["pass", "fail", "accepted", "not gated"].includes(m.status);
      if (!ok) bad.push(m.id);
    }
    expect(bad).toEqual([]);
  });

  it("has the in-sample run and the unsupported-penalty gap", () => {
    expect(v.inSample.metrics.length).toBeGreaterThan(50);
    expect(REPORT).toMatch(/## 2\. In-sample run/);
    expect(REPORT).toMatch(/Unsupported fouls, 2016-2023: [\d.]+ enforced yards per game not emitted/);
    expect(REPORT).toMatch(/Unsupported fouls, 2024-2025: [\d.]+ enforced yards per game not emitted/);
  });
});

describe("F6: CLAUDE.md's resolvePlay line matches the shipped signature", () => {
  it("names createEngine(data) returning resolvePlay(state, offenseCall, defenseCall, players, rng)", () => {
    expect(text("CLAUDE.md")).toContain("`createEngine(data)` returns `resolvePlay(state, offenseCall, defenseCall, players, rng)`");
    const src = text("packages/sim/src/engine/resolve.ts");
    const factory = /export function createEngine\((\w+)/.exec(src);
    expect(factory?.[1]).toBe("data");
    const inner = /function resolvePlay\(([^)]*)\)/.exec(src);
    const params = (inner?.[1] ?? "").split(",").map((p) => p.split(":")[0]?.trim());
    expect(params).toEqual(["state", "offenseCall", "defenseCall", "players", "rng"]);
  });
});
