// A1 to A4: the catalog parses, screens are well formed, references resolve, and rules
// name only Situation fields.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalogSchema, parseCatalog } from "../src/schema";
import { SITUATION_FIELDS, type Situation } from "../src/situation";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const raw = JSON.parse(readFileSync(join(repoRoot, "data/calls/catalog.json"), "utf8")) as {
  screens: { id: string; choices: Record<string, unknown>[] }[];
  roots: string[];
};
const clone = (): typeof raw => JSON.parse(JSON.stringify(raw)) as typeof raw;
const issues = (json: unknown): string[] => {
  const r = catalogSchema.safeParse(json);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("catalog (A1)", () => {
  it("parses with the zod schema", () => {
    expect(() => parseCatalog(raw)).not.toThrow();
  });

  it("has the screens and choice counts the spec lists", () => {
    const cat = parseCatalog(raw);
    const counts = Object.fromEntries(cat.screens.map((s) => [s.title, s.choices.length]));
    expect(counts).toEqual({
      "Offense: Play type": 4,
      "Offense: Formation": 5,
      "Offense: Run": 3,
      "Offense: Pass": 5,
      "Offense: Kick": 2,
      "Offense: Clock": 2,
      "After a touchdown": 2,
      Kickoff: 2,
      "Defense: Package": 4,
      "Defense: Base": 3,
      "Defense: Nickel": 6,
      "Defense: Dime": 2,
      "Defense: Specials": 2,
    });
    const presets = cat.screens.filter((s) => s.side === "defense" && s.id !== "defense.package").flatMap((s) => s.choices);
    expect(presets).toHaveLength(13);
  });
});

describe("screen shape (A2)", () => {
  const first = (c: typeof raw) => c.screens[0] as (typeof raw.screens)[number];

  it("rejects a screen with 8 choices", () => {
    const c = clone();
    const s = first(c);
    s.choices = Array.from({ length: 8 }, (_, i) => ({ key: i + 1, id: `x${i}`, label: "X", description: "x" }));
    expect(issues(c).join()).toMatch(/at most 7|<=7|too big|Too big/i);
  });

  it("rejects a duplicate key", () => {
    const c = clone();
    (first(c).choices[1] as { key: number }).key = 1;
    expect(issues(c).join()).toMatch(/expected 2/);
  });

  it("rejects a gap in keys", () => {
    const c = clone();
    (first(c).choices[3] as { key: number }).key = 5;
    expect(issues(c).join()).toMatch(/key 5, expected 4/);
  });

  it("rejects a duplicate id anywhere in the catalog", () => {
    const c = clone();
    ((c.screens[5] as (typeof raw.screens)[number]).choices[0] as { id: string }).id = "run";
    expect(issues(c).join()).toMatch(/duplicate choice id run/);
  });

  it("rejects an empty screen", () => {
    const c = clone();
    first(c).choices = [];
    expect(issues(c).length).toBeGreaterThan(0);
  });
});

describe("references (A3)", () => {
  it("every leaf call is reachable from a root", () => {
    const cat = parseCatalog(raw);
    const byId = new Map(cat.screens.map((s) => [s.id, s]));
    const reached = new Set<string>();
    const stack = [...cat.roots];
    while (stack.length) {
      const id = stack.pop() as string;
      if (reached.has(id)) continue;
      reached.add(id);
      for (const ch of byId.get(id)?.choices ?? []) if (ch.opens) stack.push(ch.opens);
    }
    expect([...reached].sort()).toEqual(cat.screens.map((s) => s.id).sort());
  });

  it("rejects a choice that opens a missing screen", () => {
    const c = clone();
    (first(c).choices[0] as { opens: string }).opens = "offense.nowhere";
    expect(issues(c).join()).toMatch(/opens unknown screen offense.nowhere/);
  });

  it("rejects an orphan screen", () => {
    const c = clone();
    c.screens.push({ id: "orphan", title: "Orphan", side: "offense", when: "never", choices: [{ key: 1, id: "lonely", label: "L", description: "l" }] } as never);
    expect(issues(c).join()).toMatch(/orphan is not reachable/);
  });

  it("rejects an unknown root", () => {
    const c = clone();
    c.roots.push("nope");
    expect(issues(c).join()).toMatch(/unknown root screen nope/);
  });

  function first(c: typeof raw) {
    return c.screens[0] as (typeof raw.screens)[number];
  }
});

describe("availability rules (A4)", () => {
  it("SITUATION_FIELDS lists exactly the Situation keys", () => {
    const sample: Record<keyof Situation, true> = {
      phase: true,
      down: true,
      yardsToGo: true,
      yardLine100: true,
      scoreDiff: true,
      quarter: true,
      secondsLeftInHalf: true,
      secondsLeftInGame: true,
      offenseTimeouts: true,
      defenseTimeouts: true,
    };
    expect([...SITUATION_FIELDS].sort()).toEqual(Object.keys(sample).sort());
  });

  it("rejects a rule naming an unknown field, even nested", () => {
    const c = clone();
    (c.screens[0] as (typeof raw.screens)[number]).choices[0] = {
      ...(c.screens[0] as (typeof raw.screens)[number]).choices[0],
      availableWhen: { all: [{ field: "down", op: "eq", value: 4 }, { any: [{ field: "offenseFormation", op: "eq", value: 1 }] }] },
    };
    expect(issues(c).length).toBeGreaterThan(0);
  });

  it("rejects a phase rule with a number, and an unknown operator", () => {
    const c = clone();
    const s = c.screens[0] as (typeof raw.screens)[number];
    s.choices[0] = { ...s.choices[0], availableWhen: { field: "phase", op: "eq", value: 4 } };
    expect(issues(c).length).toBeGreaterThan(0);
    const d = clone();
    const t = d.screens[0] as (typeof raw.screens)[number];
    t.choices[0] = { ...t.choices[0], availableWhen: { field: "down", op: "between", value: 4 } };
    expect(issues(d).length).toBeGreaterThan(0);
  });
});
