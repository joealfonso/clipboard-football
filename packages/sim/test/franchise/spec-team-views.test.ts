// A7 (the sim's half) and A8 from docs/specs/m4-franchise-core.md: overall and the team views on
// hand-made rosters. Every expected number is worked out by hand in a comment.

import { describe, expect, it } from "vitest";
import { POSITIONS } from "../../../shared/src/engine";
import type { FranchiseData, FranchiseState, PoolPlayer, TeamId, TeamSummary } from "../../../shared/src/franchise";
import { byOverallThenId, leagueSummaries, overall, teamSummary } from "../../src/franchise";
import { create, errorCode, flatPlayer, pinnedData, playDraft, SCRIPTS, shippedData, smallData, specOverall, SPEC_MAX, SPEC_MIN, SPEC_TARGET, value } from "./spec-support";
import type { Position } from "./spec-support";

type Hand = Partial<Record<Position, readonly number[]>>;

/** A draft-phase state whose rosters are exactly the given overalls, listed in the order given. */
function handMade(data: FranchiseData, hands: Readonly<Record<TeamId, Hand>>): FranchiseState {
  const base = create(data, 1);
  const players: PoolPlayer[] = [];
  const rosters: Record<TeamId, string[]> = Object.fromEntries(base.teams.map((t) => [t.id, []]));
  let n = 0;
  for (const [team, hand] of Object.entries(hands)) {
    for (const p of POSITIONS) {
      for (const v of hand[p] ?? []) {
        const id = `P${String(++n).padStart(4, "0")}`;
        players.push(flatPlayer(id, p, v));
        (rosters[team] as string[]).push(id);
      }
    }
  }
  return { ...base, players, rosters };
}

const big = pinnedData();
const HAND: Hand = { QB: [60, 80, 70], RB: [75, 85], WR: [50, 90, 62, 80, 70], TE: [66, 64], OL: [70, 70, 40, 70, 70, 70, 70], DL: [], LB: [72, 70, 72, 70], CB: [60], S: [10, 80, 81, 80], K: [55], P: [] };

describe("A8 teamSummary on a hand-made roster", () => {
  const state = handMade(big, { T03: HAND });
  const s = value(teamSummary(state, big, "T03"));

  it("counts, limits and both needed figures", () => {
    const counts: Record<Position, number> = { QB: 3, RB: 2, WR: 5, TE: 2, OL: 7, DL: 0, LB: 4, CB: 1, S: 4, K: 1, P: 0 };
    const toStart: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 1, OL: 0, DL: 5, LB: 0, CB: 3, S: 0, K: 0, P: 1 };
    const toTarget: Record<Position, number> = { QB: 0, RB: 2, WR: 1, TE: 2, OL: 2, DL: 8, LB: 3, CB: 5, S: 0, K: 0, P: 1 };
    for (const p of POSITIONS) {
      expect(s.positions[p], p).toMatchObject({ count: counts[p], min: SPEC_MIN[p], target: SPEC_TARGET[p], max: SPEC_MAX[p], neededToStart: toStart[p], neededToTarget: toTarget[p] });
      expect(s.positions[p].players).toHaveLength(counts[p]);
    }
    expect(s.playerCount).toBe(29);
  });

  it("starter average per position, null when empty", () => {
    const avg = Object.fromEntries(POSITIONS.map((p) => [p, s.positions[p].startersAverage]));
    // WR top 4 of 5: (90+80+70+62)/4 = 75.5. TE both of 2: 65. OL top 6: 70. S top 3: 241/3 = 80.33. LB 284/4 = 71.
    expect(avg).toEqual({ QB: 80, RB: 85, WR: 75.5, TE: 65, OL: 70, DL: null, LB: 71, CB: 60, S: 80.3, K: 55, P: null });
  });

  it("unit, team and roster averages: one decimal, over players and not over position averages", () => {
    // Offense: 80 + 85 + 302 + 130 + 420 = 1017 over 14 = 72.64. (A mean of position means would be 75.1.)
    // Defense: 284 + 60 + 241 = 585 over 8 = 73.125. Special teams: 55 over 1.
    // Team: 1017 + 585 + 55 = 1657 over 23 = 72.04.
    // Roster: 210 + 160 + 352 + 130 + 460 + 284 + 60 + 251 + 55 = 1962 over 29 = 67.66.
    expect(s.averages).toEqual({ offense: 72.6, defense: 73.1, specialTeams: 55, team: 72, roster: 67.7 });
  });

  it("players are in depth order, overall descending, whatever order they joined", () => {
    expect(s.positions.WR.players.map((p) => p.overall)).toEqual([90, 80, 70, 62, 50]);
    expect(s.positions.S.players.map((p) => p.overall)).toEqual([81, 80, 80, 10]);
    const tied = s.positions.S.players.slice(1, 3).map((p) => p.id);
    expect(tied).toEqual([...tied].sort());
  });

  it("each player carries id, name, number (null before the draft ends), overall, every rating and skill", () => {
    const qb = s.positions.QB.players[0];
    const source = state.players.find((p) => p.id === qb?.id) as PoolPlayer;
    expect(qb).toEqual({ id: source.id, name: source.name, position: "QB", number: null, overall: 80, ratings: source.ratings, skills: source.skills });
  });

  it("a starter tie at the cutoff goes to the lower id", () => {
    const data = smallData();
    const base = handMade(data, { T00: { QB: [80, 80] } });
    const ids = (base.rosters["T00"] as string[]).slice();
    const t = value(teamSummary({ ...base, rosters: { ...base.rosters, T00: [...ids].reverse() } }, data, "T00"));
    expect(t.positions.QB.players.map((p) => p.id)).toEqual(ids);
  });

  it("an unknown team is a typed error", () => {
    for (const id of ["T99", "", "__proto__", "constructor"]) expect(errorCode(teamSummary(state, big, id))).toBe("unknownTeam");
  });
});

describe("A8 ranks among all teams", () => {
  const ranksOf = (xs: readonly TeamSummary[], key: "offense" | "defense" | "specialTeams" | "team" | "roster"): Record<string, number | null> => Object.fromEntries(xs.map((x) => [x.teamId, x.ranks[key]]));

  it("ties share a rank and the next rank is skipped; a null average has no rank", () => {
    const data = smallData();
    const all = leagueSummaries(handMade(data, { T00: { QB: [80] }, T01: { QB: [90] }, T02: { QB: [70] }, T03: { QB: [80] } }), data);
    expect(all.map((x) => x.teamId)).toEqual(["T00", "T01", "T02", "T03"]);
    for (const k of ["offense", "team", "roster"] as const) expect(ranksOf(all, k)).toEqual({ T00: 2, T01: 1, T02: 4, T03: 2 });
    for (const k of ["defense", "specialTeams"] as const) expect(ranksOf(all, k)).toEqual({ T00: null, T01: null, T02: null, T03: null });
  });

  it("each average is ranked on its own, and teams with nothing do not push others down", () => {
    const data = smallData();
    const all = leagueSummaries(handMade(data, { T00: { QB: [60], S: [90] }, T01: {}, T02: { QB: [70], K: [50] }, T03: { S: [80], QB: [10, 60] } }), data);
    expect(ranksOf(all, "offense")).toEqual({ T00: 2, T01: null, T02: 1, T03: 2 });
    expect(ranksOf(all, "defense")).toEqual({ T00: 1, T01: null, T02: null, T03: 2 });
    expect(ranksOf(all, "specialTeams")).toEqual({ T00: null, T01: null, T02: 1, T03: null });
    // Team, starters only: T00 75, T02 60, T03 70 (the 10 quarterback sits). Roster: 75, 60, 50.
    expect(ranksOf(all, "team")).toEqual({ T00: 1, T01: null, T02: 3, T03: 2 });
    expect(all.map((x) => x.averages.team)).toEqual([75, null, 60, 70]);
    expect(all.map((x) => x.averages.roster)).toEqual([75, null, 60, 50]);
    expect(ranksOf(all, "roster")).toEqual({ T00: 1, T01: null, T02: 2, T03: 3 });
  });

  it("an empty league: every average and rank null, no NaN", () => {
    for (const t of leagueSummaries(create(big, 1), big)) {
      expect(Object.values(t.averages)).toEqual([null, null, null, null, null]);
      expect(Object.values(t.ranks)).toEqual([null, null, null, null, null]);
    }
  });

  it("leagueSummaries holds all 32 and each equals teamSummary", () => {
    const s = handMade(big, { T00: HAND, T31: { QB: [99] } });
    const all = leagueSummaries(s, big);
    expect(all).toHaveLength(32);
    for (const t of all) expect(value(teamSummary(s, big, t.teamId))).toEqual(t);
  });

  it("after a draft every player view has the jersey number in the state", () => {
    const data = smallData();
    const s = playDraft(data, 3, SCRIPTS.random).state;
    for (const t of leagueSummaries(s, data)) for (const p of POSITIONS) for (const v of t.positions[p].players) expect(v.number).toBe(s.numbers[v.id]);
  });
});

describe("A7 overall: rounded weighted mean of the weighted ratings", () => {
  it("matches a hand computation", () => {
    const weights = { QB: { accuracy: 3, throwPower: 2, awareness: 2, agility: 1 } };
    const p = { ...flatPlayer("P1", "QB", 10), ratings: { ...flatPlayer("P1", "QB", 10).ratings, awareness: 70, agility: 60 }, skills: { ...flatPlayer("P1", "QB", 10).skills, accuracy: 90, throwPower: 80 } };
    // (90x3 + 80x2 + 70x2 + 60) / 8 = 630 / 8 = 78.75
    expect(overall(p, weights)).toBe(79);
  });
  it("matches an independent formula for every player of a generated pool", () => {
    const data = shippedData();
    for (const p of create(data, 6).players) expect(overall(p, data.overallWeights), p.id).toBe(specOverall(p, data.overallWeights));
  });
  it("byOverallThenId is a total order: overall descending, then id ascending", () => {
    const xs = [{ id: "P3", overall: 50 }, { id: "P1", overall: 50 }, { id: "P2", overall: 60 }];
    expect([...xs].sort(byOverallThenId).map((x) => x.id)).toEqual(["P2", "P1", "P3"]);
    expect(byOverallThenId({ id: "P1", overall: 5 }, { id: "P1", overall: 5 })).toBe(0);
  });
});
