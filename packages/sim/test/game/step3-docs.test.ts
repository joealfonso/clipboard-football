// E4 (PERF.md entry), E6 (DECISIONS.md and MODEL.md) and E7 (CLAUDE.md) for M1 step 3.
// Written by test-writer from the spec's acceptance criteria.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../caller/load-data";

const read = (p: string): string => readFileSync(join(repoRoot, p), "utf8");

/** The body of a markdown section, from its heading to the next heading of the same or higher level. */
function section(doc: string, heading: string): string {
  const lines = doc.split("\n");
  const start = lines.findIndex((l) => /^#+ /.test(l) && l.replace(/^#+ /, "").trim() === heading);
  if (start < 0) return "";
  const level = (lines[start]!.match(/^#+/) as RegExpMatchArray)[0].length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => {
    const m = l.match(/^(#+) /);
    return m !== null && m[1]!.length <= level;
  });
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

describe("DECISIONS.md for step 3 (E6)", () => {
  const step3 = section(read("docs/DECISIONS.md"), "M1 step 3: rules and game state");

  it("has a step 3 section", () => {
    expect(step3.length).toBeGreaterThan(0);
  });

  it.each(["Coordinate frame", "Coin toss draw", "Designed simplifications"])("has an entry for %s", (h) => {
    expect(step3).toMatch(new RegExp(`^### ${h}`, "m"));
  });

  it("has an entry for the default policies", () => {
    expect(step3).toMatch(/^### .*default/im);
  });

  it.each([
    ["1. whole yards", /whole[- ]yard/i],
    ["2. no momentum exception", /momentum/i],
    ["3. offsetting fouls and rejected combinations", /both teams/i],
    ["4. accept or decline as an input", /accept or decline/i],
    ["5. receive or defer as an input", /receive or defer/i],
    ["6. no fair catch kick", /fair catch kick/i],
  ])("records designed simplification %s", (_n, re) => {
    expect(step3).toMatch(re);
  });

  it("records the resolved defaults: defer in regulation, receive in overtime", () => {
    expect(step3).toMatch(/defers in regulation and receives in overtime/i);
  });
});

describe("MODEL.md for step 3 (E6)", () => {
  const model = read("docs/MODEL.md");
  const clock = section(model, "Clock and tempo");

  it("Clock and tempo says the clock rules are cited rules, neither fitted nor designed", () => {
    expect(clock).toMatch(/cited/i);
    expect(clock).toMatch(/RULES\.md/);
    expect(clock).not.toMatch(/^\s*\*\*(fitted|designed|mixed)\*\*/im);
  });

  it("Clock and tempo says tempo and timeout decisions are not built yet", () => {
    expect(clock).toMatch(/not built yet/i);
    expect(clock).toMatch(/tempo/i);
    expect(clock).toMatch(/timeout/i);
  });

  it("documents the default policies as designed (resolved open question 3)", () => {
    const defaults = model
      .split("\n## ")
      .find((s) => /default/i.test(s.split("\n")[0] ?? ""));
    expect(defaults, "a MODEL.md section on the defaults").toBeDefined();
    expect(defaults).toMatch(/designed/i);
  });
});

describe("PERF.md soak record (E4)", () => {
  it("records the wall-clock time of the 1,000-game soak", () => {
    const perf = read("docs/PERF.md");
    const line = perf.split("\n").find((l) => /step 3/i.test(l) && /soak/i.test(l));
    expect(line, "a step 3 soak line in PERF.md").toBeDefined();
    expect(line).toMatch(/1,?000/);
    expect(line).toMatch(/\d[\d,]*\s*ms/);
  });
});

describe("CLAUDE.md (E7)", () => {
  const claude = read("CLAUDE.md");

  it("still lists challenges as an open issue", () => {
    const openLine = claude.split("\n").find((l) => /open issues/i.test(l));
    expect(openLine, "an open issues line").toBeDefined();
    expect(openLine).toMatch(/challenges/i);
  });

  it("has Run and Test lines that are filled in", () => {
    expect(claude).toMatch(/^- Run: (?!<fill)/m);
    expect(claude).toMatch(/^- Test: (?!<fill)/m);
  });
});
