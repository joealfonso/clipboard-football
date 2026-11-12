// Penalty enforcement (Rule 14 and the kick-specific rules in Rules 6, 9 and 11). The play
// engine reports fouls; this file lists the offended team's legal choices and applies one.
// Designed simplifications (docs/DECISIONS.md): whole yards, at most one foul enforced, fouls
// by both teams replay the down, and two-team fouls with a change of possession or on a kick
// are rejected.

import type { EnforcementSpot, Foul, PenaltyRule, PlayResult, RuleSet } from "../../../shared/src/types";
import { addPoints, continueSeries, draftOf, noEvents, toKickoff, toScrimmage, toTry, type Events, type Resolved } from "./draft";
import { reject } from "./errors";
import { FIELD_LENGTH, MAX_SNAP_SPOT, MIN_SNAP_SPOT, flip, halfDistance, other } from "./frame";
import { sideTeam } from "./resolve";
import type { GameState, Team } from "./types";

export type PenaltyOption = { readonly kind: "decline" } | { readonly kind: "accept"; readonly foul: number } | { readonly kind: "offset" };

export interface Enforced {
  readonly r: Resolved;
  /** The foul that was enforced, if one was. */
  readonly accepted: { readonly foul: Foul; readonly rule: PenaltyRule } | null;
  readonly offset: boolean;
}

const KICK_KINDS = new Set(["punt", "fieldGoal", "kickoff", "onsideKick", "extraPoint"]);

function ruleOf(rules: RuleSet, foul: Foul): PenaltyRule {
  const p = rules.penalties[foul.penalty];
  if (p === undefined) return reject("unknownPenalty", `no penalty "${foul.penalty}" in rule set ${rules.id}`);
  return p;
}

function needsFoulSpot(p: PenaltyRule): boolean {
  return p.enforcement === "spotOfFoul" || p.alternate?.spot === "spotOfFoul";
}

export function validateFouls(s: GameState, rules: RuleSet, play: PlayResult): readonly Foul[] {
  const fouls = play.fouls ?? [];
  for (const f of fouls) {
    const p = ruleOf(rules, f);
    if (p.committedBy !== "either" && p.committedBy !== f.by) {
      reject("badPlay", `${f.penalty} is committed by the ${p.committedBy}, not the ${f.by}`);
    }
    if ((p.timing === "preSnap") !== (play.kind === "noPlay")) {
      reject("badPlay", `${f.penalty} is a ${p.timing} foul; pre-snap fouls go on a noPlay and only there`);
    }
    if (needsFoulSpot(p) && (f.spot === undefined || !Number.isInteger(f.spot))) {
      reject("badPlay", `${f.penalty} needs a whole-yard spot of the foul`);
    }
  }
  if (play.kind === "noPlay") {
    if (fouls.length === 0) reject("badPlay", "a noPlay needs a pre-snap foul");
    if (play.seconds !== 0) reject("contradictoryPlay", "a pre-snap foul uses no game clock");
    if (s.phase === "kickoff") reject("unsupportedFouls", "pre-snap fouls on a free kick are not supported");
  }
  return fouls;
}

export function penaltyOptions(s: GameState, rules: RuleSet, play: PlayResult): PenaltyOption[] {
  const fouls = validateFouls(s, rules, play);
  if (fouls.length === 0) return [];
  if (new Set(fouls.map((f) => f.by)).size > 1) return [{ kind: "offset" }];
  const options: PenaltyOption[] = fouls.map((_, i) => ({ kind: "accept", foul: i }));
  if (fouls.every((f) => ruleOf(rules, f).declinable)) options.unshift({ kind: "decline" });
  return options;
}

/** Gain for the offended team toward the offender's goal (at FIELD_LENGTH in this frame). */
function gain(base: number, yards: number, half: boolean): number {
  const move = half ? Math.min(yards, halfDistance(FIELD_LENGTH - base)) : yards;
  return Math.min(MAX_SNAP_SPOT, base + move);
}

/** Loss for the offending team toward its own goal (at 0 in this frame). */
function lose(base: number, yards: number, half: boolean): number {
  const move = half ? Math.min(yards, halfDistance(base)) : yards;
  return Math.max(MIN_SNAP_SPOT, base - move);
}

function copyClockFlags(from: Events): Events {
  const ev = noEvents();
  ev.stopsClock = from.stopsClock;
  ev.outOfBounds = from.outOfBounds;
  ev.fumbleOutOfBounds = from.fumbleOutOfBounds;
  return ev;
}

/** A fresh result from the pre-play state that keeps the play's clock flags. */
function fresh(s: GameState, raw: Resolved): Resolved {
  return { d: draftOf(s), ev: copyClockFlags(raw.ev) };
}

function safetyAgainst(r: Resolved, scoredOn: Team, rules: RuleSet): void {
  addPoints(r, other(scoredOn), rules.scoring.safety, "safety");
  toKickoff(r.d, scoredOn, true, rules);
}

/** The offense still holds the ball in the field of play after the play, with no score. */
function offenseKeptBall(s: GameState, raw: Resolved): boolean {
  return raw.ev.scores.length === 0 && raw.d.phase === "scrimmage" && raw.d.possession === s.possession;
}

/** The receiving team held the ball throughout and the play ended in the field with no score. */
function receiversKeptBall(s: GameState, raw: Resolved): boolean {
  const receivers = other(s.possession);
  return (
    raw.ev.scores.length === 0 &&
    raw.d.phase === "scrimmage" &&
    raw.d.possession === receivers &&
    raw.ev.possessors.every((t) => t === receivers)
  );
}

function baseSpot(spot: EnforcementSpot, s: GameState, raw: Resolved, foul: Foul): number {
  switch (spot) {
    case "previousSpot":
      return s.spot;
    case "spotOfFoul":
      return foul.spot as number;
    case "endOfRun":
    case "deadBallSpot":
    case "succeedingSpot":
      return offenseKeptBall(s, raw) ? raw.d.spot : s.spot;
  }
}

/** A live-ball foul on a scrimmage down (or a defensive foul on a scrimmage kick before it ends). */
function enforceScrimmageLive(s: GameState, rules: RuleSet, raw: Resolved, foul: Foul, p: PenaltyRule): Resolved {
  const r = fresh(s, raw);
  const offense = s.possession;
  const lineToGain = s.spot + s.distance;
  r.ev.possessors.push(offense);
  if (foul.by === "defense") {
    let spot: number;
    const base = baseSpot(p.enforcement, s, raw, foul);
    if (p.endZoneSpot !== null && base >= FIELD_LENGTH) {
      spot = s.spot >= flip(p.endZoneSpot) ? gain(s.spot, FIELD_LENGTH, true) : flip(p.endZoneSpot);
    } else {
      spot = gain(Math.min(base, MAX_SNAP_SPOT), p.yards, p.halfDistance);
    }
    if (p.alternate !== null) {
      spot = Math.max(spot, gain(baseSpot(p.alternate.spot, s, raw, foul), p.alternate.yards, p.halfDistance));
    }
    if (p.automaticFirstDown || spot >= lineToGain) {
      toScrimmage(r.d, offense, spot, rules);
      return r;
    }
    const chargedDown = p.enforcement === "endOfRun" || p.enforcement === "deadBallSpot";
    finishSeries(r, s, rules, spot, chargedDown ? s.down + 1 : s.down, lineToGain);
    return r;
  }
  let base = baseSpot(p.enforcement, s, raw, foul);
  // Offensive fouls behind the line are enforced from the previous spot (Rule 14-3-6 Exc. 1).
  if (p.enforcement === "spotOfFoul" && base < s.spot) base = s.spot;
  if (base <= 0) {
    safetyAgainst(r, offense, rules);
    return r;
  }
  let spot = lose(base, p.yards, p.halfDistance);
  if (p.alternate !== null) {
    const altBase = baseSpot(p.alternate.spot, s, raw, foul);
    if (altBase <= 0) {
      safetyAgainst(r, offense, rules);
      return r;
    }
    spot = Math.min(spot, lose(altBase, p.alternate.yards, p.halfDistance));
  }
  if (spot >= lineToGain) {
    toScrimmage(r.d, offense, spot, rules);
    return r;
  }
  finishSeries(r, s, rules, spot, p.lossOfDown ? s.down + 1 : s.down, lineToGain);
  return r;
}

function finishSeries(r: Resolved, s: GameState, rules: RuleSet, spot: number, down: number, lineToGain: number): void {
  if (down > rules.downs.perSeries) {
    const defense = other(s.possession);
    r.ev.changeOfPossession = true;
    r.ev.stopsClock = true;
    r.ev.possessors.push(defense);
    toScrimmage(r.d, defense, flip(spot), rules);
    return;
  }
  r.d.phase = "scrimmage";
  r.d.possession = s.possession;
  continueSeries(r.d, spot, down, lineToGain);
}

/** A dead-ball foul after the down: the play counts and the penalty is enforced from the succeeding spot. */
function enforceAfterPlay(s: GameState, rules: RuleSet, raw: Resolved, foul: Foul, p: PenaltyRule): Resolved {
  if (raw.d.phase !== "scrimmage") {
    reject("unsupportedFouls", "a dead-ball foul after a score or before a kick carries over to the next down; not supported");
  }
  const r: Resolved = { d: { ...raw.d }, ev: { ...raw.ev, scores: [], possessors: [...raw.ev.possessors] } };
  const holder = raw.d.possession;
  const fouler = sideTeam(foul.by, s.possession);
  const lineToGain = raw.d.spot + raw.d.distance;
  if (fouler === holder) {
    const spot = lose(raw.d.spot, p.yards, p.halfDistance);
    if (raw.d.down === 1) toScrimmage(r.d, holder, spot, rules);
    else continueSeries(r.d, spot, raw.d.down, lineToGain);
    return r;
  }
  const spot = gain(raw.d.spot, p.yards, p.halfDistance);
  if (p.automaticFirstDown || spot >= lineToGain) toScrimmage(r.d, holder, spot, rules);
  else continueSeries(r.d, spot, raw.d.down, lineToGain);
  return r;
}

function enforcePreSnap(s: GameState, rules: RuleSet, raw: Resolved, foul: Foul, p: PenaltyRule): Resolved {
  if (s.phase === "try") return enforceTry(s, rules, raw, foul, p);
  const r = fresh(s, raw);
  r.ev.possessors.push(s.possession);
  const lineToGain = s.spot + s.distance;
  const spot = foul.by === "offense" ? lose(s.spot, p.yards, p.halfDistance) : gain(s.spot, p.yards, p.halfDistance);
  if (spot >= lineToGain) toScrimmage(r.d, s.possession, spot, rules);
  else continueSeries(r.d, spot, s.down, lineToGain);
  return r;
}

/** Fouls on a try replay the try from moved spots, or fail it on a loss of down. */
function enforceTry(s: GameState, rules: RuleSet, raw: Resolved, foul: Foul, p: PenaltyRule): Resolved {
  const r = fresh(s, raw);
  r.ev.possessors.push(s.possession);
  const spots = s.trySpots ?? { kick: flip(rules.try.kickSpot), twoPoint: flip(rules.try.twoPointSpot) };
  if (foul.by === "offense" && p.lossOfDown) {
    toKickoff(r.d, s.possession, false, rules);
    return r;
  }
  const move = (spot: number): number => {
    if (foul.by === "offense") return lose(spot, p.yards, p.halfDistance);
    if (p.endZoneSpot !== null && (foul.spot ?? 0) >= FIELD_LENGTH) {
      return spot >= flip(p.endZoneSpot) ? gain(spot, FIELD_LENGTH, true) : flip(p.endZoneSpot);
    }
    return gain(spot, p.yards, p.halfDistance);
  };
  toTry(r.d, s.possession, rules);
  r.d.trySpots = { kick: move(spots.kick), twoPoint: move(spots.twoPoint) };
  r.d.spot = r.d.trySpots.twoPoint;
  return r;
}

/** Punts and field goals: Rule 9-5 and 14-4-8. */
function enforceScrimmageKick(s: GameState, rules: RuleSet, raw: Resolved, foul: Foul, p: PenaltyRule): Resolved {
  const receivers = other(s.possession);
  if (foul.by === "offense") {
    if (receiversKeptBall(s, raw)) {
      const r: Resolved = { d: { ...raw.d }, ev: { ...raw.ev, scores: [], possessors: [...raw.ev.possessors] } };
      toScrimmage(r.d, receivers, gain(raw.d.spot, p.yards, p.halfDistance), rules);
      return r;
    }
    return enforceScrimmageLive(s, rules, raw, foul, p);
  }
  if (p.enforcement === "spotOfFoul") {
    const spot = foul.spot as number;
    if (!receiversKeptBall(s, raw) || spot <= 0 || spot >= FIELD_LENGTH) {
      reject("unsupportedFouls", "a return-team foul needs the receivers to keep the ball and a spot in the field");
    }
    const r: Resolved = { d: { ...raw.d }, ev: { ...raw.ev, scores: [], possessors: [...raw.ev.possessors] } };
    toScrimmage(r.d, receivers, lose(flip(spot), p.yards, p.halfDistance), rules);
    return r;
  }
  return enforceScrimmageLive(s, rules, raw, foul, p);
}

/** Free kicks: Rule 6-3 and 14-4-7. */
function enforceFreeKick(s: GameState, rules: RuleSet, raw: Resolved, foul: Foul, p: PenaltyRule): Resolved {
  const kicker = s.possession;
  const receivers = other(kicker);
  const kept = receiversKeptBall(s, raw);
  if (foul.by === "offense") {
    if (kept && p.alternate !== null) {
      const r: Resolved = { d: { ...raw.d }, ev: { ...raw.ev, scores: [], possessors: [...raw.ev.possessors] } };
      toScrimmage(r.d, receivers, gain(raw.d.spot, p.alternate.yards, p.halfDistance), rules);
      return r;
    }
    const r = fresh(s, raw);
    r.ev.stopsClock = true;
    toKickoff(r.d, kicker, s.safetyKick, rules, lose(s.spot, p.yards, p.halfDistance));
    return r;
  }
  if (p.enforcement === "spotOfFoul") {
    const spot = foul.spot as number;
    if (!kept || spot <= 0 || spot >= FIELD_LENGTH) {
      reject("unsupportedFouls", "a return-team foul needs the receivers to keep the ball and a spot in the field");
    }
    const r: Resolved = { d: { ...raw.d }, ev: { ...raw.ev, scores: [], possessors: [...raw.ev.possessors] } };
    toScrimmage(r.d, receivers, lose(flip(spot), p.yards, p.halfDistance), rules);
    return r;
  }
  const r = fresh(s, raw);
  r.ev.stopsClock = true;
  toKickoff(r.d, kicker, s.safetyKick, rules, gain(s.spot, p.yards, p.halfDistance));
  return r;
}

function offsetting(s: GameState, play: PlayResult, raw: Resolved): Resolved {
  // A turnover on downs is not a change of possession during the down; the down is replayed.
  const turnover = ("end" in play && play.end?.possession === "defense") || ("defensePossessedDuringPlay" in play && play.defensePossessedDuringPlay === true);
  if (KICK_KINDS.has(play.kind) || turnover) {
    reject("unsupportedFouls", "fouls by both teams on a kick or with a change of possession are not supported");
  }
  const r = fresh(s, raw);
  r.ev.possessors.push(s.possession);
  return r;
}

export function enforce(s: GameState, rules: RuleSet, play: PlayResult, raw: Resolved, option: PenaltyOption): Enforced {
  const fouls = play.fouls ?? [];
  if (option.kind === "offset") return { r: offsetting(s, play, raw), accepted: null, offset: true };
  if (option.kind === "decline") {
    if (play.kind === "noPlay") {
      const r = fresh(s, raw);
      r.ev.possessors.push(s.possession);
      return { r, accepted: null, offset: false };
    }
    return { r: raw, accepted: null, offset: false };
  }
  const foul = fouls[option.foul];
  if (foul === undefined) return reject("badChoice", `no foul at index ${option.foul}`);
  const p = ruleOf(rules, foul);
  let r: Resolved;
  if (p.timing === "preSnap") r = enforcePreSnap(s, rules, raw, foul, p);
  else if (p.timing === "afterPlay") {
    if (s.phase !== "scrimmage" || KICK_KINDS.has(play.kind)) {
      reject("unsupportedFouls", "dead-ball fouls after a kick or a try carry over to the next down; not supported");
    }
    r = enforceAfterPlay(s, rules, raw, foul, p);
  } else if (s.phase === "try") r = enforceTry(s, rules, raw, foul, p);
  else if (play.kind === "kickoff" || play.kind === "onsideKick") r = enforceFreeKick(s, rules, raw, foul, p);
  else if (play.kind === "punt" || play.kind === "fieldGoal") r = enforceScrimmageKick(s, rules, raw, foul, p);
  else r = enforceScrimmageLive(s, rules, raw, foul, p);
  return { r, accepted: { foul, rule: p }, offset: false };
}

/** The team that will have the ball next after a result, if any. */
function holderAfter(r: Resolved): Team | null {
  switch (r.d.phase) {
    case "scrimmage":
    case "try":
      return r.d.possession;
    case "kickoff":
      return other(r.d.possession);
    default:
      return null;
  }
}

function net(r: Resolved, team: Team): number {
  return r.ev.scores.reduce((sum, e) => sum + (e.team === team ? e.points : -e.points), 0);
}

/** a is a better series than b for the team holding both: lower down, then shorter distance, then further upfield. */
function betterSeries(a: Resolved, b: Resolved): boolean {
  if (a.d.down !== b.d.down) return a.d.down < b.d.down;
  if (a.d.distance !== b.d.distance) return a.d.distance < b.d.distance;
  return a.d.spot > b.d.spot;
}

/**
 * Designed default policy (docs/MODEL.md): the offended team accepts unless declining leaves
 * it with a score, possession, or a better down and distance (down, then distance, then spot).
 */
export function declineIsBetter(offended: Team, declined: Resolved, accepted: Resolved): boolean {
  const netDecline = net(declined, offended);
  const netAccept = net(accepted, offended);
  if (netDecline !== netAccept) return netDecline > netAccept;
  const holdsDecline = holderAfter(declined) === offended;
  const holdsAccept = holderAfter(accepted) === offended;
  if (holdsDecline !== holdsAccept) return holdsDecline;
  if (declined.d.phase === "scrimmage" && accepted.d.phase === "scrimmage" && declined.d.possession === accepted.d.possession) {
    return declined.d.possession === offended ? betterSeries(declined, accepted) : betterSeries(accepted, declined);
  }
  return false;
}
