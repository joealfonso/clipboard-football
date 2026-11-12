// E3: replay and save/resume give identical games. E4: 1,000 complete games under the real
// rules with the invariant checker on after every transition.

import { describe, expect, it } from "vitest";
import { Rng } from "../../src/rng";
import { newGame } from "../../src/game/machine";
import { transitionViolations } from "../../src/game/invariants";
import type { GameState } from "../../src/game/types";
import type { GameInput } from "../support/random-game";
import { applyInput, randomGame, replay } from "../support/random-game";
import { loadRules } from "../support/rules";

const { rules, hash } = loadRules();

describe("determinism (E3)", () => {
  it("200 random games replay to deep-equal states at every step", () => {
    for (let seed = 0; seed < 200; seed++) {
      const g = randomGame(rules, { gameType: seed % 2 === 0 ? "regularSeason" : "postseason", seed, rulesHash: hash }, 7000 + seed);
      expect(replay(rules, g.start, g.inputs)).toEqual(g.states);
    }
  });

  it("a mid-game state survives JSON and continues to the same final state", () => {
    for (let seed = 0; seed < 50; seed++) {
      const g = randomGame(rules, { gameType: "postseason", seed, rulesHash: hash }, 9000 + seed);
      const mid = Math.floor(g.inputs.length / 2);
      // The machine's own Rng is saved with the state: the coin tosses are its only draws.
      const rng = Rng.fromSeed(seed);
      let s = newGame(rules, g.start, rng);
      for (let i = 0; i < mid; i++) s = applyInput(s, rules, g.inputs[i] as GameInput, rng);
      const saved = JSON.parse(JSON.stringify({ state: s, rng: rng.getState() })) as { state: GameState; rng: [number, number, number, number] };
      const resumed = replay(rules, g.start, g.inputs, { state: saved.state, index: mid, rngState: saved.rng });
      expect(resumed.at(-1)).toEqual(g.states.at(-1));
    }
  });

  it("logs the seed in every state", () => {
    const g = randomGame(rules, { gameType: "regularSeason", seed: 123, rulesHash: hash }, 1);
    expect(g.states.every((s) => s.seed === 123 && s.rules.hash === hash)).toBe(true);
  });
});

describe("soak (E4)", () => {
  it("1,000 complete games reach final with no invariant failure and no postseason tie", () => {
    const t0 = performance.now();
    let transitions = 0;
    let overtimeGames = 0;
    let ties = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const gameType = seed % 2 === 0 ? "regularSeason" : "postseason";
      const g = randomGame(rules, { gameType, seed, rulesHash: hash }, 1_000_000 + seed);
      const last = g.states.at(-1);
      expect(last?.phase).toBe("final");
      if (gameType === "postseason") expect(last?.result?.winner).not.toBeNull();
      if (last?.result?.winner === null) ties++;
      if ((last?.period ?? 0) > rules.game.regulationPeriods) overtimeGames++;
      // The machine already checks after every transition; check again from outside.
      for (let i = 1; i < g.states.length; i++) {
        expect(transitionViolations(g.states[i - 1] as GameState, g.states[i] as GameState, rules)).toEqual([]);
      }
      transitions += g.inputs.length;
    }
    const ms = performance.now() - t0;
    console.log(`soak: 1000 games, ${transitions} transitions, ${overtimeGames} overtime games, ${ties} ties, ${ms.toFixed(0)} ms`);
  });
});
