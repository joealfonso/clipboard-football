// Fixture variants of the real engine data and players for the engine tests.

import type { EngineData, Player, Position, TeamPool } from "../../../shared/src/engine";
import { BASE_RATINGS, POSITION_SKILLS, POSITIONS } from "../../../shared/src/engine";
import { slotNeeds } from "../../src/engine/players";
import type { GameState } from "../../src/game/types";

/** C: matchup and formation multipliers 1, no rating effects, no fouls. */
export function neutralData(data: EngineData): EngineData {
  const ones = (xs: readonly number[]): number[] => xs.map(() => 1);
  const matchup = Object.fromEntries(Object.entries(data.matchup.matchup).map(([leaf, ps]) => [leaf, Object.fromEntries(Object.entries(ps).map(([p, xs]) => [p, ones(xs)]))]));
  const formation = Object.fromEntries(
    Object.entries(data.matchup.formation).map(([leaf, fs]) => [
      leaf,
      Object.fromEntries(Object.entries(fs).map(([f, ks]) => [f, Object.fromEntries(Object.entries(ks).map(([k, xs]) => [k, ones(xs)]))])),
    ]),
  );
  const families = Object.fromEntries(
    Object.entries(data.penalties.families).map(([fam, levels]) => [fam, levels.map((cells) => Object.fromEntries(Object.entries(cells).map(([k, xs]) => [k, xs.map(() => 0)])))]),
  );
  return {
    ...data,
    matchup: { ...data.matchup, matchup, formation },
    ratings: { ...data.ratings, effects: [] },
    penalties: { ...data.penalties, families, doublePer1000000: 0 },
    kickoff: { ...data.kickoff, fouls: {} },
  };
}

/** Every rating at `value`, one player per slot any unit needs. */
export function flatTeam(data: EngineData, name: string, value: number): TeamPool {
  const need = slotNeeds(data.personnel);
  const players: Player[] = [];
  for (const position of POSITIONS) {
    for (let i = 0; i < need[position]; i++) {
      players.push({
        schemaVersion: 1,
        id: `${name}-${position}${i + 1}`,
        name: `${name} ${position}${i + 1}`,
        position,
        ratings: Object.fromEntries(BASE_RATINGS.map((r) => [r, value])) as Player["ratings"],
        skills: Object.fromEntries(POSITION_SKILLS[position].map((s) => [s, value])),
      });
    }
  }
  return { schemaVersion: 1, name, players };
}

/** The same team with the first player at `position` given `rating` = value. */
export function withRating(team: TeamPool, position: Position, rating: string, value: number): TeamPool {
  let done = false;
  const players = team.players.map((p) => {
    if (done || p.position !== position) return p;
    done = true;
    if (rating in p.ratings) return { ...p, ratings: { ...p.ratings, [rating]: value } };
    return { ...p, skills: { ...p.skills, [rating]: value } };
  });
  return { ...team, players };
}

/** Data whose league means equal `value` for every rating, so a flat team at `value` has edge 0. */
export function meansAt(data: EngineData, value: number): EngineData {
  const ratings = Object.fromEntries(
    Object.entries(data.distributions.ratings).map(([pos, rs]) => [pos, Object.fromEntries(Object.entries(rs).map(([r, d]) => [r, { ...d, mean: value }]))]),
  );
  return { ...data, distributions: { ...data.distributions, ratings } };
}

/** A scrimmage state: offense home at `spot`, the given down and distance, first quarter. */
export function scrimmageState(spot: number, down: number, distance: number, over: Partial<GameState> = {}): GameState {
  return {
    rules: { id: "nfl-2026", hash: "test" },
    seed: 1,
    gameType: "regularSeason",
    period: 1,
    clock: 600,
    clockRunning: false,
    playClock: 40,
    phase: "scrimmage",
    possession: "home",
    spot,
    down,
    distance,
    goalToGo: 100 - spot <= distance,
    trySpots: null,
    safetyKick: false,
    score: { home: 0, away: 0 },
    timeouts: { home: 3, away: 3 },
    timeoutsThisDeadBall: { home: 0, away: 0 },
    twoMinuteWarningDone: false,
    untimedDown: false,
    toss: { winner: "home", choice: "defer", secondHalfReceiver: "home" },
    overtime: null,
    playCount: 0,
    result: null,
    ...over,
  };
}
