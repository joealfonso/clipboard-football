// The step 2 Situation for the play callers. Callers never see GameState.

import type { RuleSet, Situation } from "../../../shared/src/types";
import { reject } from "./errors";
import { flip, other } from "./frame";
import { isOvertime } from "./periods";
import type { GameState } from "./types";

/**
 * Only a snap has a Situation: phase "scrimmage" or "try". Any other phase (kickoff,
 * overtimeToss, final) has none, and this throws a GameRuleError with code "wrongPhase".
 */
export function toSituation(s: GameState, rules: RuleSet): Situation {
  if (s.phase !== "scrimmage" && s.phase !== "try") return reject("wrongPhase", `no Situation exists in phase ${s.phase}`);
  const offense = s.possession;
  const defense = other(offense);
  const g = rules.game;
  let quarter: number;
  let secondsLeftInHalf: number;
  let secondsLeftInGame: number;
  if (isOvertime(s.period, rules)) {
    quarter = g.regulationPeriods + 1;
    secondsLeftInHalf = s.clock;
    secondsLeftInGame = s.clock;
  } else {
    quarter = s.period;
    const periodsAfterInHalf = g.periodsPerHalf - (((s.period - 1) % g.periodsPerHalf) + 1);
    secondsLeftInHalf = s.clock + periodsAfterInHalf * g.periodSeconds;
    secondsLeftInGame = s.clock + (g.regulationPeriods - s.period) * g.periodSeconds;
  }
  const yardLine100 = flip(s.spot);
  const onTry = s.phase === "try";
  return {
    phase: s.phase,
    down: onTry ? 1 : s.down,
    yardsToGo: onTry ? yardLine100 : s.distance,
    yardLine100,
    scoreDiff: s.score[offense] - s.score[defense],
    quarter,
    secondsLeftInHalf,
    secondsLeftInGame,
    offenseTimeouts: s.timeouts[offense],
    defenseTimeouts: s.timeouts[defense],
  };
}
