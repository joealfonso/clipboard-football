// Box score and drives, computed from a game record's event log only (M1 step 5). Decides
// nothing. The counting rules are designed and listed in docs/MODEL.md (Calibration, full games);
// the pipeline counts real games the same way (pipeline/game/actuals.py).

import type { Foul, PlayResult, RuleSet } from "../../../shared/src/types";
import { FIELD_LENGTH, halfDistance, other } from "../game/frame";
import type { Team } from "../game/types";
import type { GameEvent, GameRecord, Snapshot } from "./play";

export type DriveResult = "touchdown" | "fieldGoal" | "missedFieldGoal" | "punt" | "turnover" | "downs" | "endOfHalf" | "safety";

export interface Drive {
  readonly team: Team;
  readonly period: number;
  /** Yards from the team's own goal line at its first snap. */
  readonly start: number;
  readonly plays: number;
  readonly yards: number;
  readonly seconds: number;
  readonly result: DriveResult;
}

export interface TeamBox {
  points: number;
  byPeriod: number[];
  firstDowns: number;
  rushAttempts: number;
  rushYards: number;
  passAttempts: number;
  completions: number;
  passYards: number;
  sacks: number;
  sackYards: number;
  interceptions: number;
  fumblesLost: number;
  penalties: number;
  penaltyYards: number;
  thirdDownAttempts: number;
  thirdDownConversions: number;
  fourthDownAttempts: number;
  fourthDownConversions: number;
  fourthDownGo: number;
  possessionSeconds: number;
  punts: number;
  fieldGoalAttempts: number;
  fieldGoalsMade: number;
  timeouts: number;
  twoPointTries: number;
  onsideKicks: number;
  scrimmagePlays: number;
}

export interface BoxScore {
  readonly home: TeamBox;
  readonly away: TeamBox;
  readonly drives: readonly Drive[];
  readonly periods: number;
  readonly overtime: boolean;
}

const SCRIMMAGE_KINDS = new Set(["run", "pass", "sack", "scramble", "kneel", "spike"]);

function emptyBox(periods: number): TeamBox {
  return {
    points: 0, byPeriod: Array.from({ length: periods }, () => 0), firstDowns: 0, rushAttempts: 0, rushYards: 0, passAttempts: 0, completions: 0,
    passYards: 0, sacks: 0, sackYards: 0, interceptions: 0, fumblesLost: 0, penalties: 0, penaltyYards: 0, thirdDownAttempts: 0,
    thirdDownConversions: 0, fourthDownAttempts: 0, fourthDownConversions: 0, fourthDownGo: 0, possessionSeconds: 0, punts: 0,
    fieldGoalAttempts: 0, fieldGoalsMade: 0, timeouts: 0, twoPointTries: 0, onsideKicks: 0, scrimmagePlays: 0,
  };
}

/** Accepted foul of a play event, if any: the foul, the team that committed it and its rule. */
export function acceptedFoul(ev: Extract<GameEvent, { t: "play" }>, rules: RuleSet): { foul: Foul; team: Team; yards: number } | null {
  if (ev.penalty === null || ev.penalty.kind !== "accept") return null;
  const foul = (ev.play.fouls ?? [])[ev.penalty.foul];
  if (foul === undefined) return null;
  const team = foul.by === "offense" ? ev.before.possession : other(ev.before.possession);
  return { foul, team, yards: penaltyYards(foul, ev.before, rules) };
}

/**
 * Enforced yards of an accepted foul, designed approximation: the rule's yards, cut to half the
 * distance from the line of scrimmage to the fouler's goal where the rule halves; a spot foul
 * (pass interference) counts the yards from the line to the spot.
 */
export function penaltyYards(foul: Foul, before: Snapshot, rules: RuleSet): number {
  const p = rules.penalties[foul.penalty];
  if (p === undefined) return 0;
  const los = before.spot;
  if (p.enforcement === "spotOfFoul" && foul.penalty !== "returnTeamIllegalBlock" && foul.spot !== undefined) {
    return Math.max(1, Math.min(foul.spot, FIELD_LENGTH - 1) - los);
  }
  const toGoal = foul.by === "offense" ? los : FIELD_LENGTH - los;
  return p.halfDistance ? Math.min(p.yards, Math.max(halfDistance(toGoal), 1)) : p.yards;
}

/** The play counts in the stats: no accepted foul, or one enforced after the down (the play stands). */
export function playStands(ev: Extract<GameEvent, { t: "play" }>, rules: RuleSet): boolean {
  if (ev.play.kind === "noPlay") return false;
  const a = acceptedFoul(ev, rules);
  if (a === null) return ev.penalty === null || ev.penalty.kind !== "offset";
  const p = rules.penalties[a.foul.penalty];
  return p !== undefined && p.enforcement === "succeedingSpot";
}

/**
 * A punt or field goal try counts unless a foul wiped it out: the kicking team still has the
 * ball afterwards and either the down is replayed or an accepted foul was enforced from before
 * the kick (for example a defensive foul with a first down). A foul enforced from the previous
 * spot against the receivers still leaves a punt (revision 10), and a muffed punt the kickers
 * recover is still a punt. Code review fix: before, a kick wiped out by a defensive foul that
 * gave a first down still counted.
 */
export function kickStands(ev: Extract<GameEvent, { t: "play" }>, rules: RuleSet): boolean {
  if (ev.play.kind !== "punt" && ev.play.kind !== "fieldGoal") return false;
  const { before, after } = ev;
  if (after.phase !== "scrimmage" || after.possession !== before.possession) return true;
  if (after.down === before.down && after.down !== 1) return false;
  return acceptedFoul(ev, rules) === null;
}

function physicalYards(play: PlayResult, los: number): number {
  if (!("end" in play) || play.end === undefined) return 0;
  const detail = (play.detail ?? {}) as Record<string, unknown>;
  const y = detail["yards"];
  if (typeof y === "number" && play.end.possession === "offense") return Math.min(y, FIELD_LENGTH - los);
  const end = Math.max(0, Math.min(FIELD_LENGTH, play.end.spot));
  return end - los;
}

function seconds(before: Snapshot, after: Snapshot): number {
  return after.period === before.period ? Math.max(0, before.clock - after.clock) : before.clock;
}

export function boxScore(record: GameRecord, rules: RuleSet): BoxScore {
  const periods = record.final.period;
  const box = { home: emptyBox(periods), away: emptyBox(periods) };
  const drives: Drive[] = [];
  let cur: { team: Team; period: number; start: number; plays: number; seconds: number; half: number; last: number } | null = null;
  const halfOf = (period: number): number => (period <= rules.game.regulationPeriods ? Math.ceil(period / rules.game.periodsPerHalf) : period);
  const close = (result: DriveResult): void => {
    // Step 5c G1: drive yards are net, start spot to end spot, penalties included: the goal line
    // for a touchdown, else the line of scrimmage of the drive's last snap.
    if (cur !== null) drives.push({ team: cur.team, period: cur.period, start: cur.start, plays: cur.plays, yards: (result === "touchdown" ? 100 : cur.last) - cur.start, seconds: cur.seconds, result });
    cur = null;
  };
  let lastScore = { home: 0, away: 0 };
  for (const ev of record.events) {
    if (ev.t === "timeout") {
      box[ev.team].timeouts++;
      continue;
    }
    if (ev.t === "runoff") {
      const s = seconds(ev.before, ev.after);
      box[ev.before.possession].possessionSeconds += s;
      if (cur !== null) cur.seconds += s;
      continue;
    }
    if (ev.t === "endPeriod") {
      const next = ev.period + 1;
      if (cur !== null && halfOf(next) !== halfOf(ev.period)) close("endOfHalf");
      continue;
    }
    if (ev.t !== "play") continue;
    const { before, after, play } = ev;
    const off = before.possession;
    const def = other(off);
    for (const t of ["home", "away"] as const) {
      const gained = after.score[t] - lastScore[t];
      if (gained !== 0) box[t].byPeriod[before.period - 1] = (box[t].byPeriod[before.period - 1] ?? 0) + gained;
    }
    lastScore = after.score;
    const acc = acceptedFoul(ev, rules);
    if (acc !== null) {
      box[acc.team].penalties++;
      box[acc.team].penaltyYards += acc.yards;
    }
    if (ev.runoffTimeout) box[off].timeouts++;
    const secs = seconds(before, after);
    if (play.kind === "kickoff" || play.kind === "onsideKick") {
      box[def].possessionSeconds += secs;
      if (play.kind === "onsideKick") box[off].onsideKicks++;
      continue;
    }
    if (before.phase === "try") {
      if (play.kind === "twoPoint" || (play.kind === "noPlay" && ev.offense.call === "goForTwo")) {
        if (play.kind === "twoPoint") box[off].twoPointTries++;
      }
      continue;
    }
    // A scrimmage dead ball.
    box[off].possessionSeconds += secs;
    if (cur === null || cur.team !== off) {
      if (cur !== null) close("turnover");
      cur = { team: off, period: before.period, start: before.spot, plays: 0, seconds: 0, half: halfOf(before.period), last: before.spot };
    }
    const d = cur;
    d.last = before.spot;
    d.seconds += secs;
    const stands = playStands(ev, rules);
    if (SCRIMMAGE_KINDS.has(play.kind) && stands) {
      const b = box[off];
      b.scrimmagePlays++;
      d.plays++;
      const y = physicalYards(play, before.spot);
      if (play.kind === "run" || play.kind === "scramble" || play.kind === "kneel") {
        b.rushAttempts++;
        b.rushYards += y;
      } else if (play.kind === "sack") {
        b.sacks++;
        b.sackYards += -y;
      } else {
        b.passAttempts++;
        const complete = play.kind === "pass" && play.incomplete !== true && play.turnover !== "interception";
        if (complete) {
          b.completions++;
          b.passYards += y;
        }
      }
      if ("turnover" in play && play.turnover !== undefined && play.end.possession === "defense") {
        if (play.turnover === "interception") b.interceptions++;
        else b.fumblesLost++;
      }
      if (before.down === 4 && (play.kind === "run" || play.kind === "pass" || play.kind === "sack" || play.kind === "scramble")) b.fourthDownGo++;
    }
    const kicked = kickStands(ev, rules);
    if (play.kind === "punt" && kicked) box[off].punts++;
    if (play.kind === "fieldGoal" && kicked) {
      box[off].fieldGoalAttempts++;
      if (play.good) box[off].fieldGoalsMade++;
    }
    // Series results. Scores are read from the score change, not the next phase: a touchdown
    // that ends the game skips the try (Rule 4-8-2-c), and an overtime walk-off, a defensive
    // touchdown or a safety can be the last play (code review fix).
    const sc = rules.scoring;
    const gainedOff = after.score[off] - before.score[off];
    const gainedDef = after.score[def] - before.score[def];
    const kept = after.phase === "scrimmage" && after.possession === off;
    const touchdown = play.kind !== "fieldGoal" && gainedOff >= sc.touchdown;
    // A first down counts only when a new set of downs is earned (code review fix): the ball
    // reaches the line to gain, or an accepted defensive foul carries an automatic first down.
    // A 1st down replayed or moved by a foul is not one, and neither is a kick the kickers keep
    // without a foul (a muffed punt they recover): nflverse flags first_down on none of the 798
    // such punts, 1999-2026. A defensive foul on a kick that gives a new series is a penalty first down.
    const kick = play.kind === "punt" || play.kind === "fieldGoal";
    const defFoul = acc !== null && acc.team === def;
    const autoFirst = defFoul && rules.penalties[acc.foul.penalty]?.automaticFirstDown === true;
    const reached = after.spot >= before.spot + before.distance;
    const firstDown = touchdown || (kept && after.down === 1 && (autoFirst || (reached && (!kick || defFoul))));
    // A pre-snap defensive foul that reaches the line to gain is a penalty first down too.
    if (firstDown) box[off].firstDowns++;
    if (play.kind !== "noPlay" && stands && (before.down === 3 || before.down === 4) && play.kind !== "punt" && play.kind !== "fieldGoal" && play.kind !== "kneel" && play.kind !== "spike") {
      const b = box[off];
      if (before.down === 3) {
        b.thirdDownAttempts++;
        if (firstDown) b.thirdDownConversions++;
      } else {
        b.fourthDownAttempts++;
        if (firstDown) b.fourthDownConversions++;
      }
    }
    // Drive end.
    if (touchdown) close("touchdown");
    else if (gainedDef >= sc.touchdown) close("turnover");
    else if (gainedDef === sc.safety) close("safety");
    else if (play.kind === "fieldGoal" && kicked) close(play.good && gainedOff === sc.fieldGoal ? "fieldGoal" : "missedFieldGoal");
    else if (play.kind === "punt" && kicked) close("punt");
    else if (after.phase === "scrimmage" && after.possession !== off) {
      const lost = "turnover" in play && play.turnover !== undefined;
      close(before.down === 4 && !lost ? "downs" : "turnover");
    }
  }
  if (cur !== null) close("endOfHalf");
  box.home.points = record.final.score.home;
  box.away.points = record.final.score.away;
  return { home: box.home, away: box.away, drives, periods, overtime: periods > rules.game.regulationPeriods };
}
