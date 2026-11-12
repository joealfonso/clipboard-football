// Invariant checker. Pure: returns violations, never throws. The machine runs it after every
// transition and throws a typed error if anything comes back.

import type { RuleSet } from "../../../shared/src/types";
import { FIELD_LENGTH, MAX_SNAP_SPOT, MIN_SNAP_SPOT } from "./frame";
import { halfIndex, maxTimeouts, periodSeconds } from "./periods";
import type { GameState, Team } from "./types";

const TEAMS: readonly Team[] = ["home", "away"];

function onField(spot: number): boolean {
  return Number.isInteger(spot) && spot >= MIN_SNAP_SPOT && spot <= MAX_SNAP_SPOT;
}

export function stateViolations(s: GameState, rules: RuleSet): string[] {
  const v: string[] = [];
  if (s.phase === "scrimmage") {
    if (!Number.isInteger(s.down) || s.down < 1 || s.down > rules.downs.perSeries) v.push(`down ${s.down} outside 1..${rules.downs.perSeries}`);
    const toGoal = FIELD_LENGTH - s.spot;
    if (!Number.isInteger(s.distance) || s.distance < 1) v.push(`distance ${s.distance} below 1`);
    if (s.distance > toGoal) v.push(`distance ${s.distance} more than the ${toGoal} yards to goal`);
    if (s.goalToGo && s.distance !== toGoal) v.push(`goal-to-go with distance ${s.distance} but ${toGoal} yards to goal`);
    if (!onField(s.spot)) v.push(`scrimmage spot ${s.spot} outside ${MIN_SNAP_SPOT}..${MAX_SNAP_SPOT}`);
    if (!s.goalToGo && s.distance === toGoal) v.push("line to gain is the goal line but goal-to-go is not set");
  } else if (s.down !== 0 || s.distance !== 0 || s.goalToGo) {
    v.push(`down and distance set in phase ${s.phase}`);
  }
  if ((s.phase === "kickoff" || s.phase === "try") && !onField(s.spot)) v.push(`${s.phase} spot ${s.spot} outside the field`);
  if (s.spot < 0 || s.spot > FIELD_LENGTH) v.push(`spot ${s.spot} outside 0..${FIELD_LENGTH}`);
  if (s.phase === "try" && s.trySpots === null) v.push("try without try spots");
  if (s.phase !== "try" && s.trySpots !== null) v.push(`try spots set in phase ${s.phase}`);
  const len = periodSeconds(s.period, s.gameType, rules);
  if (!Number.isInteger(s.clock) || s.clock < 0 || s.clock > len) v.push(`clock ${s.clock} outside 0..${len}`);
  if (s.clockRunning && s.clock === 0) v.push("clock running at 0:00");
  if (s.clockRunning && s.phase !== "scrimmage") v.push(`clock running in phase ${s.phase}`);
  if (s.untimedDown && s.clock > 0) v.push(`untimed down owed with ${s.clock} s left`);
  const max = maxTimeouts(s.gameType, rules);
  for (const t of TEAMS) {
    if (s.timeouts[t] < 0 || s.timeouts[t] > max) v.push(`${t} timeouts ${s.timeouts[t]} outside 0..${max}`);
    if (s.score[t] < 0) v.push(`${t} score negative`);
    const taken = s.timeoutsThisDeadBall[t];
    if (taken < 0 || taken > rules.timeouts.perTeamPerDeadBall) v.push(`${t} took ${taken} timeouts in one dead-ball period`);
  }
  if ((s.phase === "final") !== (s.result !== null)) v.push("phase final and result disagree");
  if (s.result !== null && s.result.winner === null && s.gameType === "postseason") v.push("postseason game ended tied");
  return v;
}

export function transitionViolations(prev: GameState, next: GameState, rules: RuleSet): string[] {
  const v = stateViolations(next, rules);
  if (prev.phase === "final") v.push("final state is absorbing");
  if (next.period === prev.period && next.clock > prev.clock) v.push(`clock rose from ${prev.clock} to ${next.clock} within period ${prev.period}`);
  if (next.period < prev.period) v.push("period went backwards");
  const legal = new Set([
    rules.scoring.touchdown,
    rules.scoring.fieldGoal,
    rules.scoring.safety,
    rules.scoring.tryKick,
    rules.scoring.tryTouchdown,
    rules.scoring.trySafety,
  ]);
  const changed = TEAMS.filter((t) => next.score[t] !== prev.score[t]);
  if (changed.length > 1) v.push("both scores changed in one transition");
  for (const t of changed) {
    const delta = next.score[t] - prev.score[t];
    if (delta < 0) v.push(`${t} score fell`);
    else if (!legal.has(delta)) v.push(`${t} score changed by ${delta}, not a legal amount`);
  }
  if (halfIndex(next.period, next.gameType, rules) === halfIndex(prev.period, prev.gameType, rules) && next.period >= prev.period) {
    for (const t of TEAMS) if (next.timeouts[t] > prev.timeouts[t]) v.push(`${t} timeouts rose within a half`);
  }
  if (next.playCount < prev.playCount) v.push("play count fell");
  return v;
}
