// A Draft is a shallow, writable copy of a GameState that one transition builds up. Nested
// objects are always replaced, never written into, so the input state is never changed.

import type { RuleSet } from "../../../shared/src/types";
import { FIELD_LENGTH, flip, newSeries } from "./frame";
import type { GameState, Score, Team } from "./types";

export type Draft = { -readonly [K in keyof GameState]: GameState[K] };

export type ScoreKind = "touchdown" | "fieldGoal" | "safety" | "try";

export interface ScoreEvent {
  readonly team: Team;
  readonly points: number;
  readonly kind: ScoreKind;
}

/** What happened on the down, as the clock and overtime rules need it. */
export interface Events {
  scores: ScoreEvent[];
  /** Teams that held the ball when the down ended (before any score moved play on). */
  possessors: Team[];
  /** Team that had an overtime opportunity to possess through a kick it did not keep. */
  kickOpportunity: Team | null;
  /** The play itself stops the clock: incomplete pass, kick, score, change of possession, end zone. */
  stopsClock: boolean;
  outOfBounds: boolean;
  fumbleOutOfBounds: boolean;
  changeOfPossession: boolean;
}

export interface Resolved {
  d: Draft;
  ev: Events;
}

export function draftOf(state: GameState): Draft {
  return { ...state };
}

export function noEvents(): Events {
  return {
    scores: [],
    possessors: [],
    kickOpportunity: null,
    stopsClock: false,
    outOfBounds: false,
    fumbleOutOfBounds: false,
    changeOfPossession: false,
  };
}

export function withTeam(score: Score, team: Team, value: number): Score {
  return team === "home" ? { home: value, away: score.away } : { home: score.home, away: value };
}

export function addPoints(r: Resolved, team: Team, points: number, kind: ScoreKind): void {
  r.d.score = withTeam(r.d.score, team, r.d.score[team] + points);
  r.ev.scores.push({ team, points, kind });
  r.ev.stopsClock = true;
}

export function toScrimmage(d: Draft, team: Team, spot: number, rules: RuleSet): void {
  d.phase = "scrimmage";
  d.possession = team;
  d.spot = spot;
  Object.assign(d, newSeries(spot, rules));
  d.trySpots = null;
  d.safetyKick = false;
}

/** Same series, explicit down and line to gain. The caller has checked the down is legal. */
export function continueSeries(d: Draft, spot: number, down: number, lineToGain: number): void {
  d.spot = spot;
  d.down = down;
  d.distance = lineToGain - spot;
  d.goalToGo = lineToGain >= FIELD_LENGTH;
}

export function toTry(d: Draft, team: Team, rules: RuleSet): void {
  d.phase = "try";
  d.possession = team;
  d.trySpots = { kick: flip(rules.try.kickSpot), twoPoint: flip(rules.try.twoPointSpot) };
  d.spot = d.trySpots.twoPoint;
  d.down = 0;
  d.distance = 0;
  d.goalToGo = false;
  d.safetyKick = false;
}

export function toKickoff(d: Draft, kicker: Team, safetyKick: boolean, rules: RuleSet, spot?: number): void {
  d.phase = "kickoff";
  d.possession = kicker;
  d.safetyKick = safetyKick;
  d.spot = spot ?? (safetyKick ? rules.kickoff.safetyKickSpot : rules.kickoff.spot);
  d.down = 0;
  d.distance = 0;
  d.goalToGo = false;
  d.trySpots = null;
}
