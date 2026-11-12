// What happens after a down: overtime endings, whether a try is needed, and the end of a
// period, half or game.

import type { RuleSet } from "../../../shared/src/types";
import { addPoints, noEvents, toKickoff, type Draft, type Events } from "./draft";
import { other } from "./frame";
import { endsHalf, isOvertime, overtimeFormat, overtimeIndex, periodSeconds, timeoutsPerHalf } from "./periods";
import type { EndReason, Team } from "./types";

export function leader(d: Draft): Team | null {
  if (d.score.home === d.score.away) return null;
  return d.score.home > d.score.away ? "home" : "away";
}

export function finish(d: Draft, reason: EndReason, winner: Team | null): void {
  d.phase = "final";
  d.result = { reason, winner };
  d.down = 0;
  d.distance = 0;
  d.goalToGo = false;
  d.trySpots = null;
  d.safetyKick = false;
  d.clockRunning = false;
  d.untimedDown = false;
}

/** The team that has, or is about to get, the ball. */
function holder(d: Draft): Team {
  return d.phase === "kickoff" ? other(d.possession) : d.possession;
}

/** Overtime (Rule 16): guaranteed possession, then sudden death. */
export function overtimeCheck(d: Draft, ev: Events, rules: RuleSet): void {
  const ot = d.overtime;
  if (ot === null || d.phase === "final" || d.phase === "overtimeToss") return;
  const fmt = overtimeFormat(d.gameType, rules);
  if (ot.suddenDeath) {
    if (ev.scores.length > 0) finish(d, "overtimeScore", leader(d));
    return;
  }
  if (!ot.secondTeamPossessed) {
    const kickerSafety = ev.scores.some((e) => e.team === ot.secondTeam && e.kind === "safety");
    const firstTeamEnds = ev.scores.some(
      (e) => e.team === ot.firstTeam && (e.kind === "touchdown" || e.kind === "fieldGoal") && fmt.firstPossessionEndsOn.includes(e.kind),
    );
    if ((kickerSafety && fmt.kickingTeamSafetyEnds) || firstTeamEnds) {
      finish(d, "overtimeScore", leader(d));
      return;
    }
  }
  const possessed =
    ot.secondTeamPossessed ||
    ev.possessors.includes(ot.secondTeam) ||
    (fmt.kickOpportunityCounts && ev.kickOpportunity === ot.secondTeam);
  if (!possessed) return;
  const ended = holder(d) !== ot.secondTeam;
  const tied = leader(d) === null;
  if (ended && !tied) {
    finish(d, "overtimeScore", leader(d));
    return;
  }
  // Level once the second team has had the ball: the next score wins (Rule 16-1-3-c).
  d.overtime = { ...ot, secondTeamPossessed: true, suddenDeath: tied };
}

function startPeriod(d: Draft, rules: RuleSet): void {
  d.period += 1;
  d.clock = periodSeconds(d.period, d.gameType, rules);
  d.clockRunning = false;
  d.playClock = rules.clock.playClockAfterStoppage;
  d.twoMinuteWarningDone = false;
  d.untimedDown = false;
}

/** Ends the period when its clock is out and no down is owed. */
export function periodEndCheck(d: Draft, rules: RuleSet): void {
  if (d.clock > 0 || d.untimedDown || (d.phase !== "scrimmage" && d.phase !== "kickoff")) return;
  const last = rules.game.regulationPeriods;
  if (!isOvertime(d.period, rules)) {
    if (d.period < last) {
      const half = endsHalf(d.period, d.gameType, rules);
      startPeriod(d, rules);
      if (half) {
        const t = rules.timeouts.perHalf;
        d.timeouts = { home: t, away: t };
        toKickoff(d, other(d.toss.secondHalfReceiver), false, rules);
      }
      return;
    }
    if (leader(d) !== null) {
      finish(d, "regulation", leader(d));
      return;
    }
    toOvertimeToss(d);
    return;
  }
  const fmt = overtimeFormat(d.gameType, rules);
  const k = overtimeIndex(d.period, rules);
  // A format that cannot end tied plays on past maxPeriods until someone leads.
  if (fmt.maxPeriods !== null && k >= fmt.maxPeriods && (fmt.canEndTied || leader(d) !== null)) {
    finish(d, "overtimeExpired", leader(d));
    return;
  }
  if (k % fmt.periodsPerCoinToss === 0) {
    toOvertimeToss(d);
    return;
  }
  const half = endsHalf(d.period, d.gameType, rules);
  startPeriod(d, rules);
  if (half && d.overtime !== null) {
    const t = timeoutsPerHalf(d.period, d.gameType, rules);
    d.timeouts = { home: t, away: t };
    toKickoff(d, other(d.overtime.toss.secondHalfReceiver), false, rules);
  }
}

function toOvertimeToss(d: Draft): void {
  d.phase = "overtimeToss";
  d.down = 0;
  d.distance = 0;
  d.goalToGo = false;
  d.trySpots = null;
  d.safetyKick = false;
  d.clockRunning = false;
}

/** The state after a try worth `points` to the scoring team, with endings applied. */
function afterTry(d: Draft, points: number, rules: RuleSet): Draft {
  const r = { d: { ...d }, ev: noEvents() };
  r.ev.possessors.push(d.possession);
  if (points > 0) addPoints(r, d.possession, points, "try");
  toKickoff(r.d, d.possession, false, rules);
  overtimeCheck(r.d, r.ev, rules);
  periodEndCheck(r.d, rules);
  return r.d;
}

/** Rule 4-8-2-c: no try when a successful one could not change the result. */
function tryIsMoot(d: Draft, rules: RuleSet): Draft | null {
  if (!rules.try.skipWhenOutcomeDecided) return null;
  const outcomes = [0, rules.scoring.tryKick, rules.scoring.tryTouchdown].map((p) => afterTry(d, p, rules));
  const first = outcomes[0] as Draft;
  if (first.result === null) return null;
  return outcomes.every((o) => o.result !== null && o.result.winner === first.result?.winner) ? first : null;
}

/** Applies every ending that can follow a down, in order. Returns the settled draft. */
export function settle(d: Draft, ev: Events, rules: RuleSet): Draft {
  overtimeCheck(d, ev, rules);
  if (d.phase === "try") {
    const moot = tryIsMoot(d, rules);
    if (moot !== null) return moot;
  }
  periodEndCheck(d, rules);
  return d;
}
