// Team views (M4 milestone A, designed definitions), read by every franchise screen. Projected
// starters at a position are its top `min` players by overall, ties by id. Averages are
// unweighted means of overall, one decimal, null when empty. The same order (overall descending,
// ties by id) is the depth order handed to the engine, so the projected starters are the players
// who play.

import { POSITIONS } from "../../../shared/src/engine";
import type { Position } from "../../../shared/src/engine";
import { ROSTER_UNITS, TEAM_AVERAGES } from "../../../shared/src/franchise";
import type { FranchiseData, FranchiseResult, FranchiseState, PlayerView, PositionSummary, TeamAverage, TeamId, TeamSummary } from "../../../shared/src/franchise";
import { err, ok } from "./errors";
import { rosterLimits } from "./limits";
import { byOverallThenId, overalls } from "./overall";
import { playerIndex } from "./pool";

/** One decimal. */
export function oneDecimal(x: number): number {
  return Math.round(x * 10) / 10;
}

function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  let s = 0;
  for (const x of xs) s += x;
  return oneDecimal(s / xs.length);
}

/** A team's players in depth order: position order as in POSITIONS, then overall descending, ties by id. */
export function depthChart(state: FranchiseState, data: FranchiseData, teamId: TeamId): Record<Position, PlayerView[]> {
  const index = playerIndex(state.players);
  const ovr = overalls(state.players, data.overallWeights);
  const chart = Object.fromEntries(POSITIONS.map((p) => [p, [] as PlayerView[]])) as Record<Position, PlayerView[]>;
  for (const id of state.rosters[teamId] ?? []) {
    const p = index.get(id);
    if (p === undefined) continue;
    chart[p.position].push({ id, name: p.name, position: p.position, number: state.numbers[id] ?? null, overall: ovr.get(id) ?? 0, ratings: p.ratings, skills: p.skills });
  }
  for (const p of POSITIONS) chart[p].sort(byOverallThenId);
  return chart;
}

function unranked(state: FranchiseState, data: FranchiseData, teamId: TeamId): Omit<TeamSummary, "ranks"> {
  const limits = rosterLimits(data);
  const chart = depthChart(state, data, teamId);
  const starters = {} as Record<Position, number[]>;
  const positions = {} as Record<Position, PositionSummary>;
  const everyone: number[] = [];
  for (const position of POSITIONS) {
    const players = chart[position];
    const { min, target, max } = limits[position];
    starters[position] = players.slice(0, min).map((p) => p.overall);
    for (const p of players) everyone.push(p.overall);
    positions[position] = {
      position,
      players,
      count: players.length,
      min,
      target,
      max,
      neededToStart: Math.max(0, min - players.length),
      neededToTarget: Math.max(0, target - players.length),
      startersAverage: mean(starters[position]),
    };
  }
  const averages = { team: mean(POSITIONS.flatMap((p) => starters[p])), roster: mean(everyone) } as Record<TeamAverage, number | null>;
  for (const unit of ROSTER_UNITS) averages[unit] = mean(data.roster.units[unit].flatMap((p) => starters[p]));
  return { teamId, playerCount: everyone.length, positions, averages };
}

/** All teams, in league order, each with its rank on every average. */
export function leagueSummaries(state: FranchiseState, data: FranchiseData): TeamSummary[] {
  const rows = state.teams.map((t) => unranked(state, data, t.id));
  return rows.map((row) => {
    const ranks = {} as Record<TeamAverage, number | null>;
    for (const key of TEAM_AVERAGES) {
      const mine = row.averages[key];
      ranks[key] = mine === null ? null : 1 + rows.filter((o) => (o.averages[key] ?? Number.NEGATIVE_INFINITY) > mine).length;
    }
    return { ...row, ranks };
  });
}

export function teamSummary(state: FranchiseState, data: FranchiseData, teamId: TeamId): FranchiseResult<TeamSummary> {
  const found = leagueSummaries(state, data).find((s) => s.teamId === teamId);
  return found === undefined ? err({ code: "unknownTeam", teamId: String(teamId) }) : ok(found);
}
