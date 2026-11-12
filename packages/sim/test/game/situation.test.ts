// E1, E2: the Situation adapter, and the step 2 callers running on machine-made states.

import { describe, expect, expectTypeOf, it } from "vitest";
import type { Situation } from "../../../shared/src/types";
import { SITUATION_FIELDS } from "../../../shared/src/types";
import { Rng } from "../../src/rng";
import { chooseDefenseCall, chooseOffenseCall, indexCatalog } from "../../src/caller/index";
import { toSituation } from "../../src/game/situation";
import type { GameState } from "../../src/game/types";
import { loadCallerData, readJson } from "../caller/load-data";
import { loadRules } from "../support/rules";
import { randomGame } from "../support/random-game";
import { expectRule, kickoffState, real, scrimmage, tryState } from "./helpers";

const R = real();
const PS = R.game.periodSeconds;

describe("Situation adapter (E1)", () => {
  it.each([
    ["first second of Q1", 1, PS, PS * 2, PS * 4],
    ["first second of Q2", 2, PS, PS, PS * 3],
    ["first second of Q3", 3, PS, PS * 2, PS * 2],
    ["first second of Q4", 4, PS, PS, PS],
    ["2:00 exactly in Q2", 2, 120, 120, PS * 2 + 120],
    ["2:00 exactly in Q4", 4, 120, 120, 120],
  ])("%s", (_n, period, clock, half, game) => {
    const s = toSituation(scrimmage({ period, clock }), R);
    expect([s.quarter, s.secondsLeftInHalf, s.secondsLeftInGame]).toEqual([period, half, game]);
  });

  it("scrimmage fields from the offense's view", () => {
    const s = toSituation(scrimmage({ possession: "away", spot: 70, down: 3, distance: 4, score: { home: 10, away: 3 }, timeouts: { home: 1, away: 2 } }), R);
    expect(s).toEqual({
      phase: "scrimmage",
      down: 3,
      yardsToGo: 4,
      yardLine100: 30,
      scoreDiff: -7,
      quarter: 1,
      secondsLeftInHalf: PS * 2,
      secondsLeftInGame: PS * 4,
      offenseTimeouts: 2,
      defenseTimeouts: 1,
    });
  });

  it("overtime is quarter 5 with the period's seconds as both clocks", () => {
    const s = toSituation(scrimmage({ period: R.game.regulationPeriods + 1, clock: 400 }), R);
    expect([s.quarter, s.secondsLeftInHalf, s.secondsLeftInGame]).toEqual([5, 400, 400]);
  });

  it("a try: down 1, yards to go and yard line both the two-point spot, score after the touchdown", () => {
    const s = toSituation(tryState({ period: 4, clock: 100, score: { home: 6, away: 27 }, timeouts: { home: 2, away: 2 } }), R);
    expect(s).toEqual({
      phase: "try",
      down: 1,
      yardsToGo: R.try.twoPointSpot,
      yardLine100: R.try.twoPointSpot,
      scoreDiff: -21,
      quarter: 4,
      secondsLeftInHalf: 100,
      secondsLeftInGame: 100,
      offenseTimeouts: 2,
      defenseTimeouts: 2,
    });
    const golden = readJson("data/caller/golden.json") as { situations: { situation: Situation }[] };
    expect(golden.situations.map((g) => g.situation)).toContainEqual(s);
  });

  it("says plainly that no Situation exists in other phases", () => {
    expectRule(() => toSituation(kickoffState(), R), "wrongPhase");
    const f: GameState = { ...scrimmage(), phase: "final", down: 0, distance: 0, result: { reason: "regulation", winner: "home" } };
    expectRule(() => toSituation(f, R), "wrongPhase");
  });
});

describe("no adapter drift (E2)", () => {
  it("returns exactly the Situation type and keys", () => {
    expectTypeOf(toSituation).returns.toEqualTypeOf<Situation>();
    expect(Object.keys(toSituation(scrimmage(), R)).sort()).toEqual([...SITUATION_FIELDS].sort());
    expect(Object.keys(toSituation(tryState(), R)).sort()).toEqual([...SITUATION_FIELDS].sort());
  });

  it("the callers run on 1,000+ machine states, covering every down, tries, both final 2:00s and overtime", () => {
    const { rules, hash } = loadRules();
    const data = loadCallerData();
    const idx = indexCatalog(data.catalog);
    const states: GameState[] = [];
    const seen = new Set<string>();
    const need = ["down1", "down2", "down3", "down4", "try", "q2late", "q4late", "ot"];
    for (let seed = 0; seed < 2000 && (states.length < 1000 || !need.every((n) => seen.has(n))); seed++) {
      const g = randomGame(rules, { gameType: seed % 2 === 0 ? "regularSeason" : "postseason", seed, rulesHash: hash }, 50000 + seed);
      for (const s of g.states) {
        if (s.phase !== "scrimmage" && s.phase !== "try") continue;
        const tags = [s.phase === "try" ? "try" : `down${s.down}`];
        if (s.period === 2 && s.clock <= 120) tags.push("q2late");
        if (s.period === 4 && s.clock <= 120) tags.push("q4late");
        if (s.period > R.game.regulationPeriods) tags.push("ot");
        if (states.length < 1000 || tags.some((t) => !seen.has(t))) {
          states.push(s);
          tags.forEach((t) => seen.add(t));
        }
      }
    }
    expect(states.length).toBeGreaterThanOrEqual(1000);
    expect([...seen].sort()).toEqual([...need].sort());
    const rng = Rng.fromSeed(99);
    for (const s of states) {
      const sit = toSituation(s, rules);
      const o = chooseOffenseCall(sit, data, rng);
      expect(idx.isAvailable(o.call, sit), `${o.call} in ${JSON.stringify(sit)}`).toBe(true);
      if (o.formation !== undefined) expect(idx.isAvailable(o.formation, sit)).toBe(true);
      const d = chooseDefenseCall(sit, data, rng);
      expect(idx.isAvailable(d, sit), `${d} in ${JSON.stringify(sit)}`).toBe(true);
    }
  });
});
