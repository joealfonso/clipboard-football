// C1 and C2: every PlayResult the engine returns is accepted by step 3's applyPlay, from
// states all over the game (step 3's random-game generator), with calls from the step 2
// callers and random legal calls. Every result kind and every kickoff and punt end state
// shows up, and no foul combination the machine forbids is ever produced.

import { describe, expect, it } from "vitest";
import type { PlayResult } from "../../../shared/src/types";
import { createEngine } from "../../src/engine/resolve";
import { generateTeam } from "../../src/engine/players";
import { applyPlay } from "../../src/game/machine";
import type { GameState } from "../../src/game/types";
import { Rng } from "../../src/rng";
import { loadCallerData } from "../caller/load-data";
import { callsFor } from "../support/engine-calls";
import { loadEngineData } from "../support/engine-data";
import { randomGame } from "../support/random-game";
import { loadRules } from "../support/rules";

const STATES = 100_000;

function sampleStates(n: number): GameState[] {
  const { rules, hash } = loadRules();
  const out: GameState[] = [];
  for (let g = 0; out.length < n; g++) {
    const game = randomGame(rules, { gameType: g % 2 === 0 ? "regularSeason" : "postseason", seed: 7000 + g, rulesHash: hash }, 9000 + g);
    for (const s of game.states) if (s.phase === "scrimmage" || s.phase === "try" || s.phase === "kickoff") out.push(s);
  }
  return out.slice(0, n);
}

function endState(p: PlayResult): string {
  if (p.kind === "kickoff") return `kickoff:${p.outcome}${p.outcome === "inPlay" ? `:${p.end?.possession}:${(p.end?.spot ?? 0) <= 0 ? "td" : "field"}` : ""}`;
  if (p.kind === "onsideKick") return `onside:${p.outcome}:${p.end?.possession ?? ""}`;
  if (p.kind === "punt") {
    if (!p.crossedLine) return "punt:blocked";
    if (p.fairCatch === true) return "punt:fairCatch";
    if (p.touchedByReceivers) return `punt:muff:${p.end.possession}`;
    if (p.end.spot >= 100) return "punt:touchback";
    if (p.end.spot <= 0) return "punt:returnTD";
    return "punt:inField";
  }
  return p.kind;
}

describe("engine contract (C1, C2)", () => {
  const data = loadEngineData();
  const { rules } = loadRules();
  const caller = loadCallerData();
  const resolve = createEngine(data);
  const teamRng = Rng.fromSeed(42);
  const players = { home: generateTeam(teamRng, data, "Home"), away: generateTeam(teamRng, data, "Away") };

  it(`every result from ${STATES.toLocaleString()} states is accepted by applyPlay`, () => {
    const states = sampleStates(STATES);
    const rng = Rng.fromSeed(1234);
    const kinds = new Map<string, number>();
    const failures: string[] = [];
    for (let i = 0; i < states.length; i++) {
      const s = states[i] as GameState;
      const calls = callsFor(s, rules, caller, rng, i % 2 === 1);
      let play: PlayResult | undefined;
      try {
        play = resolve(s, calls.offense, calls.defense, players, rng);
        applyPlay(s, rules, play);
      } catch (e) {
        if (failures.length < 10) failures.push(`${(e as Error).message} :: ${JSON.stringify({ phase: s.phase, spot: s.spot, down: s.down, calls, play: play === undefined ? null : { ...play, detail: undefined } })}`);
        continue;
      }
      const k = endState(play);
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
      for (const f of play.fouls ?? []) kinds.set(`foul:${f.penalty}`, (kinds.get(`foul:${f.penalty}`) ?? 0) + 1);
      if ((play.fouls ?? []).length > 1) kinds.set("foul:double", (kinds.get("foul:double") ?? 0) + 1);
    }
    expect(failures).toEqual([]);
    const need = [
      "run", "pass", "sack", "scramble", "kneel", "spike", "fieldGoal", "extraPoint", "twoPoint", "noPlay",
      "kickoff:touchbackEndZone", "kickoff:touchbackLandingZone", "kickoff:short", "kickoff:outOfBounds", "kickoff:fairCatch",
      "kickoff:inPlay:defense:field", "kickoff:inPlay:defense:td", "kickoff:inPlay:offense:field",
      "onside:outOfBounds:", "onside:inPlay:offense", "onside:inPlay:defense",
      "punt:blocked", "punt:fairCatch", "punt:muff:offense", "punt:muff:defense", "punt:touchback", "punt:returnTD", "punt:inField",
      "foul:double",
      ...data.penalties.ids.map((id) => `foul:${id}`),
    ];
    const missing = need.filter((k) => !kinds.has(k));
    expect(missing).toEqual([]);
  }, 600_000);
});
