// Which rules apply in a given period: regulation or overtime, its length, its timing
// rules, and which half (for timeouts) it belongs to.

import type { OvertimeFormat, RuleSet } from "../../../shared/src/types";
import type { GameType } from "./types";

export function isOvertime(period: number, rules: RuleSet): boolean {
  return period > rules.game.regulationPeriods;
}

export function overtimeFormat(gameType: GameType, rules: RuleSet): OvertimeFormat {
  return rules.overtime[gameType];
}

/** 1 for the first overtime period. */
export function overtimeIndex(period: number, rules: RuleSet): number {
  return period - rules.game.regulationPeriods;
}

export function periodSeconds(period: number, gameType: GameType, rules: RuleSet): number {
  return isOvertime(period, rules) ? overtimeFormat(gameType, rules).periodSeconds : rules.game.periodSeconds;
}

/** The regulation period whose timing rules (two-minute warning, clock windows) apply. */
export function timingPeriod(period: number, gameType: GameType, rules: RuleSet): number {
  if (!isOvertime(period, rules)) return period;
  const cycle = overtimeFormat(gameType, rules).timingAsPeriod;
  return cycle[(overtimeIndex(period, rules) - 1) % cycle.length] as number;
}

/** Halves share one set of timeouts. Overtime halves are numbered after regulation's. */
export function halfIndex(period: number, gameType: GameType, rules: RuleSet): number {
  const per = rules.game.periodsPerHalf;
  if (!isOvertime(period, rules)) return Math.ceil(period / per);
  const fmt = overtimeFormat(gameType, rules);
  return rules.game.regulationPeriods / per + Math.ceil(overtimeIndex(period, rules) / fmt.periodsPerHalf);
}

export function timeoutsPerHalf(period: number, gameType: GameType, rules: RuleSet): number {
  return isOvertime(period, rules) ? overtimeFormat(gameType, rules).timeoutsPerHalf : rules.timeouts.perHalf;
}

/** Most timeouts a team can hold at any point in a game under these rules. */
export function maxTimeouts(gameType: GameType, rules: RuleSet): number {
  return Math.max(rules.timeouts.perHalf, overtimeFormat(gameType, rules).timeoutsPerHalf);
}

export function hasTwoMinuteWarning(period: number, gameType: GameType, rules: RuleSet): boolean {
  return rules.clock.twoMinuteWarningPeriods.includes(timingPeriod(period, gameType, rules));
}

/** Inside the window where a stop for out of bounds or a penalty holds the clock until the snap. */
export function inSnapStartWindow(period: number, clock: number, gameType: GameType, rules: RuleSet): boolean {
  const within = rules.clock.startsOnSnapWithin[String(timingPeriod(period, gameType, rules))];
  return within !== undefined && clock <= within;
}

/** The last regulation period of a half, and the matching overtime periods. */
export function endsHalf(period: number, gameType: GameType, rules: RuleSet): boolean {
  if (!isOvertime(period, rules)) return period % rules.game.periodsPerHalf === 0;
  return overtimeIndex(period, rules) % overtimeFormat(gameType, rules).periodsPerHalf === 0;
}
