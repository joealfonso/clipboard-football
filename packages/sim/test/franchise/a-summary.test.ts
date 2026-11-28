// M4 milestone A, criterion A8: teamSummary and leagueSummaries on hand-made rosters, every figure
// worked out by hand in the comments.

import { describe, expect, it } from "vitest";
import { BASE_RATINGS, POSITION_SKILLS, POSITIONS } from "../../../shared/src/engine";
import type { Position } from "../../../shared/src/engine";
import type { FranchiseState, PoolPlayer } from "../../../shared/src/franchise";
import { depthChart, leagueSummaries, teamSummary } from "../../src/franchise/index";
import { loadFranchiseData, must, newFranchise } from "./support";

const data = loadFranchiseData();

/** A player whose every rating is `v`, so his overall is `v` whatever the weights. */
function mk(id: string, position: Position, v: number): PoolPlayer {
  return { id, name: `Player ${id}`, position, ratings: Object.fromEntries(BASE_RATINGS.map((r) => [r, v])) as PoolPlayer["ratings"], skills: Object.fromEntries(POSITION_SKILLS[position].map((s) => [s, v])) };
}

// T00: QB 80, 70. WR 75 (W1), 90, 85, 80, 75 (W5). K 50. No one else (RB is an empty position).
// T01: QB 80.   T02: QB 85, K 60.   T04: QB 80.   T05: QB 70.   Every other team: empty.
const players = [mk("Q1", "QB", 80), mk("Q2", "QB", 70), mk("W1", "WR", 75), mk("W2", "WR", 90), mk("W3", "WR", 85), mk("W4", "WR", 80), mk("W5", "WR", 75), mk("K1", "K", 50), mk("Q3", "QB", 80), mk("Q4", "QB", 85), mk("K2", "K", 60), mk("Q5", "QB", 80), mk("Q6", "QB", 70), mk("X1", "S", 99)];
const base = newFranchise(data, 1);
const state: FranchiseState = {
  ...base,
  players,
  rosters: { ...base.rosters, T00: ["Q2", "W5", "W1", "W2", "K1", "W4", "Q1", "W3"], T01: ["Q3"], T02: ["Q4", "K2"], T04: ["Q5"], T05: ["Q6"] },
  numbers: { Q1: 12 },
};

describe("A8: teamSummary on hand-made rosters", () => {
  const all = leagueSummaries(state, data);
  const of = (id: string) => must(teamSummary(state, data, id));

  it("returns all 32 teams in league order, and teamSummary is the same row", () => {
    expect(all.map((s) => s.teamId)).toEqual(state.teams.map((t) => t.id));
    for (const s of all) expect(of(s.teamId)).toEqual(s);
  });

  it("counts, both needed figures and the limits, per position", () => {
    const t = of("T00");
    expect(t.playerCount).toBe(8);
    // QB: min 1, target 3, max 4, holds 2.
    expect(t.positions.QB).toMatchObject({ count: 2, min: 1, target: 3, max: 4, neededToStart: 0, neededToTarget: 1 });
    // WR: min 4, target 6, max 8, holds 5.
    expect(t.positions.WR).toMatchObject({ count: 5, min: 4, target: 6, max: 8, neededToStart: 0, neededToTarget: 1 });
    // RB: min 1, target 4, holds none.
    expect(t.positions.RB).toMatchObject({ count: 0, min: 1, target: 4, max: 6, neededToStart: 1, neededToTarget: 4, startersAverage: null, players: [] });
    // OL: min 6, target 9, holds none.
    expect(t.positions.OL).toMatchObject({ count: 0, neededToStart: 6, neededToTarget: 9, startersAverage: null });
    expect(t.positions.K).toMatchObject({ count: 1, min: 1, target: 1, max: 2, neededToStart: 0, neededToTarget: 0 });
    expect(Object.keys(t.positions)).toEqual([...POSITIONS]);
  });

  it("projected starters are the top `min` by overall, ties by id, and the list is in depth order", () => {
    const t = of("T00");
    expect(t.positions.QB.players.map((p) => p.id)).toEqual(["Q1", "Q2"]);
    // W1 and W5 are both 75: W1 comes first, so W1 starts and W5 is the fifth.
    expect(t.positions.WR.players.map((p) => p.id)).toEqual(["W2", "W3", "W4", "W1", "W5"]);
    expect(t.positions.WR.players.map((p) => p.overall)).toEqual([90, 85, 80, 75, 75]);
    expect(depthChart(state, data, "T00").WR.map((p) => p.id)).toEqual(["W2", "W3", "W4", "W1", "W5"]);
  });

  it("a player view carries id, name, number once assigned, overall, every rating and skill", () => {
    const [q1, q2] = of("T00").positions.QB.players;
    expect(q1).toEqual({ id: "Q1", name: "Player Q1", position: "QB", number: 12, overall: 80, ratings: { speed: 80, strength: 80, agility: 80, awareness: 80 }, skills: { throwPower: 80, accuracy: 80 } });
    expect(q2?.number).toBeNull();
  });

  it("each average, one decimal, null when empty", () => {
    const t = of("T00");
    expect(t.positions.QB.startersAverage).toBe(80); // one starter: 80
    expect(t.positions.WR.startersAverage).toBe(82.5); // (90 + 85 + 80 + 75) / 4
    expect(t.positions.K.startersAverage).toBe(50);
    expect(t.averages).toEqual({
      offense: 82, // (80 + 90 + 85 + 80 + 75) / 5 = 410 / 5
      defense: null, // no DL, LB, CB or S
      specialTeams: 50, // K 50, no P
      team: 76.7, // (410 + 50) / 6 = 76.67
      roster: 75.6, // (80 + 70 + 75 + 90 + 85 + 80 + 75 + 50) / 8 = 605 / 8 = 75.625
    });
    expect(of("T02").averages).toEqual({ offense: 85, defense: null, specialTeams: 60, team: 72.5, roster: 72.5 });
    expect(of("T03").averages).toEqual({ offense: null, defense: null, specialTeams: null, team: null, roster: null });
    expect(of("T03").playerCount).toBe(0);
  });

  it("each rank among the 32: level teams share a rank, the next rank is skipped, null for a null average", () => {
    // offense: T02 85, T00 82, T01 80, T04 80, T05 70.
    // specialTeams: T02 60, T00 50.
    // team: T01 80, T04 80, T00 76.7, T02 72.5, T05 70.
    // roster: T01 80, T04 80, T00 75.6, T02 72.5, T05 70.
    expect(of("T00").ranks).toEqual({ offense: 2, defense: null, specialTeams: 2, team: 3, roster: 3 });
    expect(of("T01").ranks).toEqual({ offense: 3, defense: null, specialTeams: null, team: 1, roster: 1 });
    expect(of("T02").ranks).toEqual({ offense: 1, defense: null, specialTeams: 1, team: 4, roster: 4 });
    expect(of("T04").ranks).toEqual({ offense: 3, defense: null, specialTeams: null, team: 1, roster: 1 });
    expect(of("T05").ranks).toEqual({ offense: 5, defense: null, specialTeams: null, team: 5, roster: 5 });
    expect(of("T03").ranks).toEqual({ offense: null, defense: null, specialTeams: null, team: null, roster: null });
  });

  it("an unknown team is a typed error", () => {
    expect(teamSummary(state, data, "T99")).toEqual({ ok: false, error: { code: "unknownTeam", teamId: "T99" } });
  });

  it("does not change the state", () => {
    const before = JSON.stringify(state);
    leagueSummaries(state, data);
    expect(JSON.stringify(state)).toBe(before);
  });
});
