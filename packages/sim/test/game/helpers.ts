// Builders for hand-written states and plays. States are plain data, so a test starts from a
// real new game and overrides the fields it cares about.

import type { BallEnd, Foul, PlayResult, RuleSet, ScrimmagePlay } from "../../../shared/src/types";
import { Rng } from "../../src/rng";
import { applyPlay, newGame, startOvertime, type PlayChoices } from "../../src/game/machine";
import type { GameState, GameType } from "../../src/game/types";
import { GameRuleError, type GameErrorCode } from "../../src/game/errors";
import { loadRules } from "../support/rules";

export const real = (): RuleSet => loadRules().rules;

export function start(rules: RuleSet = real(), gameType: GameType = "regularSeason", seed = 1): GameState {
  return newGame(rules, { gameType, seed, rulesHash: "test" }, Rng.fromSeed(seed));
}

/** Home has the ball, 1st and 10 at its own 25, first quarter, 15:00, clock stopped. */
export function scrimmage(over: Partial<GameState> = {}, rules: RuleSet = real(), gameType: GameType = "regularSeason"): GameState {
  return {
    ...start(rules, gameType),
    phase: "scrimmage",
    possession: "home",
    spot: 25,
    down: 1,
    distance: 10,
    goalToGo: false,
    ...over,
  };
}

export function tryState(over: Partial<GameState> = {}, rules: RuleSet = real()): GameState {
  return {
    ...scrimmage({}, rules),
    phase: "try",
    spot: 100 - rules.try.twoPointSpot,
    down: 0,
    distance: 0,
    trySpots: { kick: 100 - rules.try.kickSpot, twoPoint: 100 - rules.try.twoPointSpot },
    score: { home: 6, away: 0 },
    ...over,
  };
}

export function kickoffState(over: Partial<GameState> = {}, rules: RuleSet = real()): GameState {
  return { ...start(rules), phase: "kickoff", possession: "home", spot: rules.kickoff.spot, ...over };
}

export function offenseEnd(spot: number, impetus?: BallEnd["impetus"]): BallEnd {
  return impetus === undefined ? { spot, possession: "offense" } : { spot, possession: "offense", impetus };
}

export function defenseEnd(spot: number, impetus?: BallEnd["impetus"]): BallEnd {
  return impetus === undefined ? { spot, possession: "defense" } : { spot, possession: "defense", impetus };
}

export function run(spot: number, seconds = 5, extra: Partial<Omit<ScrimmagePlay, "kind">> = {}): PlayResult {
  return { kind: "run", seconds, end: offenseEnd(spot), ...extra };
}

export function incomplete(s: GameState, seconds = 5, fouls: Foul[] = []): PlayResult {
  return { kind: "pass", seconds, incomplete: true, end: offenseEnd(s.spot), fouls };
}

export function play(s: GameState, p: PlayResult, choices?: PlayChoices, rules: RuleSet = real()): GameState {
  return applyPlay(s, rules, p, choices);
}

export function expectRule(fn: () => unknown, code: GameErrorCode): void {
  try {
    fn();
  } catch (e) {
    if (e instanceof GameRuleError && e.code === code) return;
    throw new Error(`expected GameRuleError ${code}, got ${String(e)}`, { cause: e });
  }
  throw new Error(`expected GameRuleError ${code}, nothing was thrown`);
}

/** Regulation ends tied, the toss is made: the overtime kickoff state. */
export function overtimeKickoff(gameType: GameType, rules: RuleSet = real(), seed = 7): GameState {
  const end = applyPlay(scrimmage({ period: 4, clock: 3, score: { home: 10, away: 10 }, twoMinuteWarningDone: true }, rules, gameType), rules, run(30, 5));
  if (end.phase !== "overtimeToss") throw new Error(`expected the overtime toss, got ${end.phase}`);
  return startOvertime(end, rules, Rng.fromSeed(seed));
}
