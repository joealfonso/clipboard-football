// A roster's limits per position. The minimum is the engine's slot need (the most players of the
// position any formation, package, kick unit or return unit fields), read from the engine's data
// and never stored again; target and max are designed (data/franchise/roster.json).

import { POSITIONS } from "../../../shared/src/engine";
import type { Position } from "../../../shared/src/engine";
import type { FranchiseData, FranchiseLeagueConfig } from "../../../shared/src/franchise";
import { slotNeeds } from "../engine/players";

export function teamCount(league: FranchiseLeagueConfig): number {
  return league.conferences.length * league.divisions.length * league.teamsPerDivision;
}

export interface PositionLimit {
  readonly min: number;
  readonly target: number;
  readonly max: number;
}

export type RosterLimits = Readonly<Record<Position, PositionLimit>>;

const cache = new WeakMap<FranchiseData, RosterLimits>();

export function rosterLimits(data: FranchiseData): RosterLimits {
  let got = cache.get(data);
  if (got === undefined) {
    const engine = data.game.engine;
    const min = slotNeeds(engine.personnel, Object.values(engine.participants.returnUnits));
    got = Object.fromEntries(POSITIONS.map((p) => [p, { min: min[p], target: data.roster.positions[p].target, max: data.roster.positions[p].max }])) as Record<Position, PositionLimit>;
    cache.set(data, got);
  }
  return got;
}
