// What the coaches see: the CoachView before a snap and the KickView before a kickoff, built from
// the game state like toSituation. Only what both sidelines can see goes in.

import type { CoachView, KickView, RuleSet } from "../../../shared/src/types";
import { other } from "../game/frame";
import { isOvertime } from "../game/periods";
import { toSituation } from "../game/situation";
import type { GameState } from "../game/types";

export interface LastSnap {
  readonly kneel: boolean;
  /** 1 out of bounds, 2 a flag (the clock restarts on the ready signal), else 0. */
  readonly restart: 0 | 1 | 2;
  readonly possession: GameState["possession"];
  readonly period: number;
}

/** `last` is the previous scrimmage snap; it counts only for the same offense in the same period. */
export function coachView(s: GameState, rules: RuleSet, last: LastSnap | null): CoachView {
  const same = last !== null && last.possession === s.possession && last.period === s.period;
  const sit = toSituation(s, rules);
  const defense = other(s.possession);
  return {
    ...sit,
    clockRunning: s.clockRunning,
    playClock: s.playClock,
    previousSnapKneel: same && last.kneel,
    previousSnapRestart: same ? last.restart : 0,
    beforeTimeout: false,
    offenseTimeoutsThisDeadBall: s.timeoutsThisDeadBall[s.possession],
    defenseTimeoutsThisDeadBall: s.timeoutsThisDeadBall[defense],
  };
}

/** Before a kickoff: the kicking team (s.possession) is "us". */
export function kickView(s: GameState, rules: RuleSet): KickView {
  const g = rules.game;
  const kicker = s.possession;
  if (isOvertime(s.period, rules)) {
    return { quarter: g.regulationPeriods + 1, secondsLeftInHalf: s.clock, secondsLeftInGame: s.clock, scoreDiff: s.score[kicker] - s.score[other(kicker)], safetyKick: s.safetyKick };
  }
  const periodsAfterInHalf = g.periodsPerHalf - (((s.period - 1) % g.periodsPerHalf) + 1);
  return {
    quarter: s.period,
    secondsLeftInHalf: s.clock + periodsAfterInHalf * g.periodSeconds,
    secondsLeftInGame: s.clock + (g.regulationPeriods - s.period) * g.periodSeconds,
    scoreDiff: s.score[kicker] - s.score[other(kicker)],
    safetyKick: s.safetyKick,
  };
}
