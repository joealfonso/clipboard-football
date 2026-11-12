// What a play means before any foul is enforced: possession, spot, down, score and what
// comes next. Every spot in a PlayResult is in the offense's frame (the team that snapped or
// kicked). The machine applies rules only; it never decides what happened.

import type {
  BallEnd,
  ExtraPointPlay,
  FieldGoalPlay,
  KickoffPlay,
  OnsideKickPlay,
  PlayResult,
  PlaySide,
  PuntPlay,
  RuleSet,
  ScrimmagePlay,
  TwoPointPlay,
} from "../../../shared/src/types";
import { addPoints, continueSeries, draftOf, noEvents, toKickoff, toScrimmage, toTry, type Resolved } from "./draft";
import { reject } from "./errors";
import { FIELD_LENGTH, clampToField, flip } from "./frame";
import type { GameState, Team } from "./types";

function team(side: PlaySide, offense: Team): Team {
  return side === "offense" ? offense : offense === "home" ? "away" : "home";
}

function inEndZoneOfOffense(spot: number): boolean {
  return spot <= 0;
}

function inEndZoneOfDefense(spot: number): boolean {
  return spot >= FIELD_LENGTH;
}

function touchdown(r: Resolved, scorer: Team, rules: RuleSet): void {
  addPoints(r, scorer, rules.scoring.touchdown, "touchdown");
  toTry(r.d, scorer, rules);
}

/** `scoredOn` was tackled in (or put the ball through) its own end zone. */
function safety(r: Resolved, scoredOn: Team, rules: RuleSet): void {
  addPoints(r, scoredOn === "home" ? "away" : "home", rules.scoring.safety, "safety");
  toKickoff(r.d, scoredOn, true, rules);
}

/** How a ball the offense still holds in the field of play is spotted. */
type OffenseHolds = "series" | "newSeries" | "givesUpBall";

/**
 * Applies a dead ball for any play whose spots are in the offense's frame. `holds` says
 * what an offense-held ball in the field of play means: the series continues, a new series
 * (legal kick recovery), or the receivers get it (illegal kick recovery).
 */
export function ballDead(
  r: Resolved,
  s: GameState,
  rules: RuleSet,
  offense: Team,
  end: BallEnd,
  holds: OffenseHolds,
  touchbackSpot: number,
): void {
  const defense = team("defense", offense);
  const impetus = end.impetus ?? "offense";
  const holder = team(end.possession, offense);
  r.ev.possessors.push(holder);
  if (holder !== offense) r.ev.changeOfPossession = true;

  if (holder === offense) {
    if (inEndZoneOfDefense(end.spot)) {
      if (holds === "givesUpBall") {
        r.ev.changeOfPossession = true;
        r.ev.stopsClock = true;
        toScrimmage(r.d, defense, touchbackSpot, rules);
        return;
      }
      touchdown(r, offense, rules);
      return;
    }
    if (inEndZoneOfOffense(end.spot)) {
      r.ev.stopsClock = true;
      if (impetus === "offense") safety(r, offense, rules);
      else toScrimmage(r.d, offense, rules.touchback.scrimmageSpot, rules);
      return;
    }
    if (holds === "newSeries") {
      r.ev.stopsClock = true;
      toScrimmage(r.d, offense, end.spot, rules);
      return;
    }
    if (holds === "givesUpBall") {
      r.ev.changeOfPossession = true;
      r.ev.stopsClock = true;
      toScrimmage(r.d, defense, flip(end.spot), rules);
      return;
    }
    advanceSeries(r, s, rules, offense, end.spot);
    return;
  }

  r.ev.stopsClock = true;
  if (inEndZoneOfOffense(end.spot)) {
    touchdown(r, defense, rules);
    return;
  }
  if (inEndZoneOfDefense(end.spot)) {
    if (impetus === "offense") toScrimmage(r.d, defense, touchbackSpot, rules);
    else safety(r, defense, rules);
    return;
  }
  toScrimmage(r.d, defense, flip(end.spot), rules);
}

/** The offense keeps the ball in the field of play during a series. */
export function advanceSeries(r: Resolved, s: GameState, rules: RuleSet, offense: Team, spot: number): void {
  const lineToGain = s.spot + s.distance;
  if (spot >= lineToGain) {
    toScrimmage(r.d, offense, spot, rules);
    return;
  }
  if (s.down >= rules.downs.perSeries) {
    r.ev.changeOfPossession = true;
    r.ev.stopsClock = true;
    r.ev.possessors.push(team("defense", offense));
    toScrimmage(r.d, team("defense", offense), flip(spot), rules);
    return;
  }
  r.d.phase = "scrimmage";
  continueSeries(r.d, spot, s.down + 1, lineToGain);
}

function checkSpot(spot: number, what: string): void {
  if (!Number.isInteger(spot)) reject("badPlay", `${what} must be a whole yard, got ${spot}`);
}

function checkFieldSpot(spot: number, what: string): void {
  checkSpot(spot, what);
  if (spot <= 0 || spot >= FIELD_LENGTH) reject("badPlay", `${what} must be in the field of play, got ${spot}`);
}

/** Furthest a dead ball can be: the back of either end zone. */
function checkEnd(end: BallEnd | undefined, what: string, rules: RuleSet): BallEnd {
  if (end === undefined) return reject("badPlay", `${what} needs an end`);
  checkSpot(end.spot, `${what} end spot`);
  const depth = rules.field.endZoneYards;
  if (end.spot < -depth || end.spot > FIELD_LENGTH + depth) {
    reject("badPlay", `${what} end spot ${end.spot} is outside the field and both end zones`);
  }
  return end;
}

function resolveScrimmage(s: GameState, rules: RuleSet, play: ScrimmagePlay): Resolved {
  const r: Resolved = { d: draftOf(s), ev: noEvents() };
  const end = checkEnd(play.end, play.kind, rules);
  if (play.incomplete === true) {
    if (end.spot !== s.spot || end.possession !== "offense") {
      reject("contradictoryPlay", "an incomplete pass must end at the previous spot with the offense");
    }
    if (play.outOfBounds === true) reject("contradictoryPlay", "a play cannot be both incomplete and out of bounds");
  }
  if (play.touchdown === true) {
    const scored = end.possession === "offense" ? inEndZoneOfDefense(end.spot) : inEndZoneOfOffense(end.spot);
    if (!scored) reject("contradictoryPlay", "a touchdown needs a dead-ball spot in the end zone");
  }
  if (play.turnover !== undefined && end.possession !== "defense") {
    reject("contradictoryPlay", "a turnover must end with the defense holding the ball");
  }
  const regained = play.defensePossessedDuringPlay === true && end.possession === "offense";
  if (play.defensePossessedDuringPlay === true && play.incomplete === true) {
    reject("contradictoryPlay", "the defense cannot possess the ball on an incomplete pass");
  }
  r.ev.outOfBounds = play.outOfBounds === true;
  r.ev.fumbleOutOfBounds = play.fumbleOutOfBounds === true;
  if (play.incomplete === true) {
    r.ev.stopsClock = true;
    r.ev.possessors.push(s.possession);
    advanceSeries(r, s, rules, s.possession, s.spot);
    return r;
  }
  if (play.defensePossessedDuringPlay === true) {
    // Possession changed during the down (Rule 4-4 (i)); counts for overtime (Rule 16-1-5 (b)).
    r.ev.possessors.push(team("defense", s.possession));
    r.ev.changeOfPossession = true;
    r.ev.stopsClock = true;
  }
  // The offense getting the ball back after a change of possession is a new series (Rule 7-3-1 (c)).
  ballDead(r, s, rules, s.possession, end, regained ? "newSeries" : "series", rules.touchback.scrimmageSpot);
  return r;
}

/** Punts and kicks from scrimmage that were blocked, touched or returned. */
function resolveScrimmageKick(
  s: GameState,
  rules: RuleSet,
  end: BallEnd,
  crossedLine: boolean,
  touchedByReceivers: boolean,
): Resolved {
  const r: Resolved = { d: draftOf(s), ev: noEvents() };
  r.ev.stopsClock = true;
  const offense = s.possession;
  if (crossedLine && touchedByReceivers) r.ev.kickOpportunity = team("defense", offense);
  let holds: OffenseHolds = "series";
  if (crossedLine) holds = touchedByReceivers ? "newSeries" : "givesUpBall";
  if (holds === "newSeries" && end.possession === "offense") r.ev.changeOfPossession = true;
  ballDead(r, s, rules, offense, end, holds, rules.punt.touchbackSpot);
  return r;
}

function resolvePunt(s: GameState, rules: RuleSet, play: PuntPlay): Resolved {
  const end = checkEnd(play.end, "punt", rules);
  if (play.fairCatch === true) {
    if (!rules.punt.fairCatchAllowed) reject("fairCatchNotAllowed", "the rule set has no fair catch on a punt");
    if (end.possession !== "defense" || !play.crossedLine) {
      reject("contradictoryPlay", "a fair catch is made by the receivers beyond the line");
    }
    checkFieldSpot(end.spot, "fair catch spot");
  }
  if (!play.crossedLine && play.touchedByReceivers) {
    reject("contradictoryPlay", "receivers cannot touch a punt beyond the line if it never crossed it");
  }
  return resolveScrimmageKick(s, rules, end, play.crossedLine, play.touchedByReceivers);
}

function resolveFieldGoal(s: GameState, rules: RuleSet, play: FieldGoalPlay): Resolved {
  checkFieldSpot(play.kickSpot, "kick spot");
  if (play.kickSpot > s.spot) reject("contradictoryPlay", "a field goal is kicked from behind the line");
  const offense = s.possession;
  if (play.good) {
    if (play.end !== undefined) reject("contradictoryPlay", "a good field goal has no end spot");
    const r: Resolved = { d: draftOf(s), ev: noEvents() };
    r.ev.possessors.push(offense);
    addPoints(r, offense, rules.scoring.fieldGoal, "fieldGoal");
    toKickoff(r.d, offense, false, rules);
    return r;
  }
  if (play.end === undefined) {
    const r: Resolved = { d: draftOf(s), ev: noEvents() };
    const defense = team("defense", offense);
    r.ev.stopsClock = true;
    r.ev.changeOfPossession = true;
    r.ev.possessors.push(defense);
    toScrimmage(r.d, defense, Math.max(flip(play.kickSpot), rules.fieldGoal.missedMinimumSpot), rules);
    return r;
  }
  const end = checkEnd(play.end, "field goal", rules);
  const crossed = play.crossedLine ?? false;
  const touched = play.touchedByReceivers ?? false;
  if (!crossed && touched) reject("contradictoryPlay", "receivers cannot touch a kick beyond the line if it never crossed it");
  return resolveScrimmageKick(s, rules, end, crossed, touched);
}

/** What a try's dead ball scores, then the scoring team kicks off. */
function finishTry(r: Resolved, s: GameState, rules: RuleSet, end: BallEnd | undefined, good: boolean, goodPoints: number): void {
  const offense = s.possession;
  const defense = team("defense", offense);
  r.ev.stopsClock = true;
  if (good) {
    r.ev.possessors.push(offense);
    addPoints(r, offense, goodPoints, "try");
  } else if (end !== undefined) {
    const holder = team(end.possession, offense);
    const impetus = end.impetus ?? "offense";
    r.ev.possessors.push(holder);
    if (holder === offense && inEndZoneOfOffense(end.spot) && impetus === "offense") {
      addPoints(r, defense, rules.scoring.trySafety, "try");
    } else if (holder === defense && inEndZoneOfOffense(end.spot)) {
      addPoints(r, defense, rules.scoring.tryTouchdown, "try");
    } else if (holder === defense && inEndZoneOfDefense(end.spot) && impetus === "defense") {
      addPoints(r, offense, rules.scoring.trySafety, "try");
    }
  }
  toKickoff(r.d, offense, false, rules);
}

function resolveExtraPoint(s: GameState, rules: RuleSet, play: ExtraPointPlay): Resolved {
  const r: Resolved = { d: draftOf(s), ev: noEvents() };
  if (play.good && play.end !== undefined) reject("contradictoryPlay", "a good kick has no end spot");
  const end = play.end === undefined ? undefined : checkEnd(play.end, "extra point", rules);
  finishTry(r, s, rules, end, play.good, rules.scoring.tryKick);
  return r;
}

function resolveTwoPoint(s: GameState, rules: RuleSet, play: TwoPointPlay): Resolved {
  const r: Resolved = { d: draftOf(s), ev: noEvents() };
  const end = checkEnd(play.end, "two-point try", rules);
  if (play.incomplete === true && (end.possession !== "offense" || end.spot !== s.spot)) {
    reject("contradictoryPlay", "an incomplete pass must end at the previous spot with the offense");
  }
  const good = play.incomplete !== true && end.possession === "offense" && inEndZoneOfDefense(end.spot);
  finishTry(r, s, rules, good ? undefined : end, good, rules.scoring.tryTouchdown);
  return r;
}

function onsideAllowed(s: GameState, rules: RuleSet): boolean {
  const kicker = s.possession;
  const receiver = team("defense", kicker);
  const trailing = s.score[kicker] < s.score[receiver];
  switch (rules.kickoff.onside.allowedWhen) {
    case "always":
      return true;
    case "trailing":
      return trailing;
    case "trailingInFinalPeriod":
      return trailing && s.period === rules.game.regulationPeriods;
  }
}

/** Receiving team's spot for a free kick short of the landing zone or out of bounds. */
function shortKickSpot(s: GameState, rules: RuleSet, landingSpot: number | undefined, short: boolean): number {
  if (short && landingSpot !== undefined && landingSpot >= flip(rules.kickoff.landingZone.to)) {
    reject("contradictoryPlay", `a kick short of the landing zone cannot land at ${landingSpot}, inside it`);
  }
  const yards = s.safetyKick ? rules.kickoff.safetyKickShortOrOutOfBoundsYards : rules.kickoff.shortOrOutOfBoundsYards;
  let kickerFrame = s.spot + yards;
  if (landingSpot !== undefined) {
    checkFieldSpot(landingSpot, "landing spot");
    kickerFrame = Math.min(kickerFrame, landingSpot);
  }
  return clampToField(flip(kickerFrame));
}

function freeKickInPlay(s: GameState, rules: RuleSet, end: BallEnd, r: Resolved): void {
  const kicker = s.possession;
  const receiver = team("defense", kicker);
  r.ev.stopsClock = true;
  r.ev.kickOpportunity = receiver;
  if (end.possession === "defense" && inEndZoneOfDefense(end.spot) && (end.impetus ?? "offense") === "offense") {
    reject("badPlay", "a free kick dead in the receivers' end zone from the kick is a touchback outcome, not inPlay");
  }
  // A free kick recovered by either team starts a new series (Rule 7-3-1-e, 7-3-2-c).
  ballDead(r, s, rules, kicker, end, "newSeries", rules.touchback.scrimmageSpot);
}

function resolveKickoff(s: GameState, rules: RuleSet, play: KickoffPlay): Resolved {
  const r: Resolved = { d: draftOf(s), ev: noEvents() };
  const receiver = team("defense", s.possession);
  const k = rules.kickoff;
  const fromMidfield = s.spot === k.midfieldKickSpot;
  const clockStarts = play.outcome === "inPlay";
  if (!clockStarts && play.seconds !== 0) {
    reject("contradictoryPlay", `the clock does not start on a kickoff that ends "${play.outcome}"`);
  }
  r.ev.stopsClock = true;
  switch (play.outcome) {
    case "touchbackEndZone":
    case "touchbackLandingZone": {
      const spot = fromMidfield
        ? k.touchbackFromMidfield
        : play.outcome === "touchbackEndZone"
          ? k.touchbackFromEndZone
          : k.touchbackAfterLandingZone;
      r.ev.possessors.push(receiver);
      r.ev.kickOpportunity = receiver;
      r.ev.changeOfPossession = true;
      toScrimmage(r.d, receiver, spot, rules);
      return r;
    }
    case "short":
    case "outOfBounds":
      r.ev.possessors.push(receiver);
      r.ev.kickOpportunity = receiver;
      r.ev.changeOfPossession = true;
      toScrimmage(r.d, receiver, shortKickSpot(s, rules, play.landingSpot, play.outcome === "short"), rules);
      return r;
    case "fairCatch": {
      if (!k.fairCatchAllowed) reject("fairCatchNotAllowed", "the rule set has no fair catch on a free kick");
      const end = checkEnd(play.end, "fair catch", rules);
      if (end.possession !== "defense") reject("contradictoryPlay", "a fair catch is made by the receivers");
      checkFieldSpot(end.spot, "fair catch spot");
      r.ev.possessors.push(receiver);
      r.ev.kickOpportunity = receiver;
      r.ev.changeOfPossession = true;
      toScrimmage(r.d, receiver, flip(end.spot), rules);
      return r;
    }
    case "inPlay": {
      const end = checkEnd(play.end, "kickoff", rules);
      // Without a declared onside kick the kickers may only recover in the landing zone or end zone.
      if (end.possession === "offense" && k.onside.declarationRequired && end.spot < flip(k.landingZone.to)) {
        reject("contradictoryPlay", "kickers recovered an undeclared kick short of the landing zone");
      }
      freeKickInPlay(s, rules, end, r);
      return r;
    }
  }
}

function resolveOnside(s: GameState, rules: RuleSet, play: OnsideKickPlay): Resolved {
  if (!onsideAllowed(s, rules)) reject("onsideNotAllowed", `onside kicks are allowed only when "${rules.kickoff.onside.allowedWhen}"`);
  const r: Resolved = { d: draftOf(s), ev: noEvents() };
  const receiver = team("defense", s.possession);
  r.ev.stopsClock = true;
  if (play.outcome === "outOfBounds") {
    if (play.seconds !== 0) reject("contradictoryPlay", "the clock does not start on a kick out of bounds");
    r.ev.possessors.push(receiver);
    r.ev.kickOpportunity = receiver;
    r.ev.changeOfPossession = true;
    toScrimmage(r.d, receiver, shortKickSpot(s, rules, play.landingSpot, false), rules);
    return r;
  }
  freeKickInPlay(s, rules, checkEnd(play.end, "onside kick", rules), r);
  return r;
}

const SCRIMMAGE_KINDS = new Set(["run", "pass", "sack", "scramble", "kneel", "spike"]);

/** Which phase each kind of play belongs to. */
export function phaseOfPlay(play: PlayResult): "scrimmage" | "try" | "kickoff" | "any" {
  if (play.kind === "noPlay") return "any";
  if (play.kind === "extraPoint" || play.kind === "twoPoint") return "try";
  if (play.kind === "kickoff" || play.kind === "onsideKick") return "kickoff";
  return "scrimmage";
}

export function resolveRaw(s: GameState, rules: RuleSet, play: PlayResult): Resolved {
  if (!Number.isInteger(play.seconds) || play.seconds < 0) reject("badPlay", `seconds must be a whole number >= 0, got ${play.seconds}`);
  if (SCRIMMAGE_KINDS.has(play.kind)) return resolveScrimmage(s, rules, play as ScrimmagePlay);
  switch (play.kind) {
    case "punt":
      return resolvePunt(s, rules, play);
    case "fieldGoal":
      return resolveFieldGoal(s, rules, play);
    case "extraPoint":
      return resolveExtraPoint(s, rules, play);
    case "twoPoint":
      return resolveTwoPoint(s, rules, play);
    case "kickoff":
      return resolveKickoff(s, rules, play);
    case "onsideKick":
      return resolveOnside(s, rules, play);
    default:
      return { d: draftOf(s), ev: noEvents() };
  }
}

export { team as sideTeam };
