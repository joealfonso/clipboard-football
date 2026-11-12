// E1-E5: every play has a trace and a one-line why built only from it.

import { describe, expect, it } from "vitest";
import { TRACE_FIELDS } from "../../../shared/src/engine";
import type { PlayResult } from "../../../shared/src/types";
import { EngineError } from "../../src/engine/errors";
import { generateTeam } from "../../src/engine/players";
import { createEngine } from "../../src/engine/resolve";
import { dominant, isFluke, render, slotsOf, type TraceEntry } from "../../src/engine/why";
import type { GameState } from "../../src/game/types";
import { Rng } from "../../src/rng";
import { loadCallerData } from "../caller/load-data";
import { callsFor } from "../support/engine-calls";
import { loadEngineData } from "../support/engine-data";
import { randomGame } from "../support/random-game";
import { loadRules } from "../support/rules";

const data = loadEngineData();
const { rules, hash } = loadRules();
const caller = loadCallerData();

interface Detail {
  why: string;
  whyTemplate: string;
  trace: TraceEntry[];
  fluke?: boolean;
}

describe("why sentences over 10,000 plays (E1, E2)", () => {
  const resolve = createEngine(data);
  const r = Rng.fromSeed(8);
  const players = { home: generateTeam(r, data, "H"), away: generateTeam(r, data, "A") };
  const plays: PlayResult[] = [];
  for (let g = 0; plays.length < 10_000; g++) {
    for (const s of randomGame(rules, { gameType: "regularSeason", seed: 50 + g, rulesHash: hash }, 80 + g).states) {
      if (s.phase !== "scrimmage" && s.phase !== "try" && s.phase !== "kickoff") continue;
      const c = callsFor(s as GameState, rules, caller, r, plays.length % 3 === 0);
      plays.push(resolve(s, c.offense, c.defense, players, r));
      if (plays.length === 10_000) break;
    }
  }

  it("every play has detail.trace and a one-line detail.why (E1)", () => {
    for (const p of plays) {
      const d = p.detail as unknown as Detail;
      expect(Array.isArray(d.trace) && d.trace.length > 0).toBe(true);
      expect(typeof d.why === "string" && d.why.length > 0 && !d.why.includes("\n")).toBe(true);
    }
  });

  it("every factor a sentence names is in that play's trace with the value shown (E2)", () => {
    for (const p of plays) {
      const d = p.detail as unknown as Detail;
      const t = data.why.templates.find((x) => x.id === d.whyTemplate);
      expect(t, d.whyTemplate).toBeDefined();
      if (t === undefined) continue;
      for (const f of t.factors) expect(d.trace.some((e) => e.factor === f), `${t.id} names ${f}`).toBe(true);
      for (const [factor, field] of slotsOf(t)) {
        const e = d.trace.find((x) => x.factor === factor && x[field] !== undefined);
        expect(e, `${t.id} {${factor}.${field}}`).toBeDefined();
        expect(d.why).toContain(String(e?.[field]));
      }
      expect(render(t, d.trace).text).toBe(d.why);
    }
  });

  it("a fluke sentence says so (E4)", () => {
    const flukes = plays.filter((p) => (p.detail as unknown as Detail).fluke === true);
    expect(flukes.length).toBeGreaterThan(0);
    for (const p of flukes) expect((p.detail as unknown as Detail).why).toMatch(/fluke/);
  });
});

describe("rendering (E3)", () => {
  it("a template with an unbound slot throws a typed error, never a fallback", () => {
    const t = { id: "x", when: "baseline", text: "{call.label} {matchup.multiplier}", factors: [] };
    const trace: TraceEntry[] = [{ factor: "call", label: "A run", leaf: "insideRun", kind: "insideRun" }];
    expect(() => render(t, trace)).toThrow(EngineError);
    try {
      render(t, trace);
    } catch (e) {
      expect((e as EngineError).code).toBe("unboundSlot");
    }
  });

  it("every template slot names a known trace field", () => {
    for (const t of data.why.templates) {
      for (const [f, field] of slotsOf(t)) expect((TRACE_FIELDS as Record<string, readonly string[]>)[f], `${t.id} ${f}`).toContain(field);
    }
  });
});

describe("fluke flag (E4)", () => {
  const below = data.config.fluke.classProbabilityBelow;
  it("is set exactly at the thresholds", () => {
    expect(isFluke(below - 1e-9, 5, 30, below)).toBe("classRare");
    expect(isFluke(below, 5, 30, below)).toBeNull();
    expect(isFluke(0.3, 31, 30, below)).toBe("yardsLong");
    expect(isFluke(0.3, 30, 30, below)).toBeNull();
    expect(isFluke(0.3, null, 30, below)).toBeNull();
  });
});

describe("dominant factor (E5)", () => {
  const order = ["matchup", "rating", "formation"];
  const m = (factor: "matchup" | "rating" | "formation", multiplier: number): TraceEntry => ({ factor, multiplier });
  it("picks the largest absolute log multiplier", () => {
    expect(dominant([m("matchup", 1.2), m("rating", 0.7)], order, 0.05)?.factor).toBe("rating");
    expect(dominant([m("matchup", 1.5), m("rating", 0.8)], order, 0.05)?.factor).toBe("matchup");
  });
  it("breaks ties by the fixed order", () => {
    expect(dominant([m("formation", 1.25), m("rating", 0.8)], order, 0.05)?.factor).toBe("rating");
    expect(dominant([m("formation", 2), m("matchup", 0.5)], order, 0.05)?.factor).toBe("matchup");
  });
  it("returns none below the minimum effect", () => {
    expect(dominant([m("matchup", 1.01)], order, 0.05)).toBeNull();
  });
});
