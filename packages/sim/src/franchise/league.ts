// The franchise league (M4 milestone A): the fictional teams in their conferences and divisions,
// and a new franchise from a seed. Designed: names and shape come from data/franchise/league.json,
// team names from data/teams/names.json by a seeded shuffle. The designed team-strength shift in
// data/game/league.json is not applied here (Locked 5): the draft makes the differences.

import { FRANCHISE_SCHEMA_VERSION } from "../../../shared/src/franchise";
import type { CreateFranchiseOptions, FranchiseData, FranchiseResult, FranchiseState, FranchiseTeam, TeamId } from "../../../shared/src/franchise";
import { pickNames } from "../loop/league";
import { draftSlots } from "./draft-order";
import { err, ok } from "./errors";
import { teamCount } from "./limits";
import { generatePool } from "./pool";
import { STREAMS, stream, validSeed } from "./streams";

export function teamId(index: number, teams: number): TeamId {
  return `T${String(index).padStart(Math.max(2, String(teams - 1).length), "0")}`;
}

/**
 * The league's teams for a seed, before a franchise exists (the team select screen reads this).
 * Ids run in conference, division, place order, so T00 to T03 are the first division.
 */
export function leagueTeams(data: FranchiseData, seed: number): FranchiseResult<FranchiseTeam[]> {
  if (!validSeed(seed)) return err({ code: "badSeed", seed });
  const n = teamCount(data.league);
  const names = pickNames(data.game.teamNames.teams, n, stream(seed, STREAMS.league));
  const per = data.league.teamsPerDivision;
  const divs = data.league.divisions;
  const teams: FranchiseTeam[] = [];
  data.league.conferences.forEach((conf, c) => {
    divs.forEach((division, d) => {
      for (let k = 0; k < per; k++) {
        const i = (c * divs.length + d) * per + k;
        const name = names[i] as (typeof names)[number];
        teams.push({ id: teamId(i, n), place: name.place, nickname: name.nickname, conference: conf.id, division });
      }
    });
  });
  return ok(teams);
}

/**
 * A new franchise: the league, the whole player pool, empty rosters and the draft order. The same
 * seed, data and options give the same state, byte for byte.
 */
export function createFranchise(data: FranchiseData, options: CreateFranchiseOptions): FranchiseResult<FranchiseState> {
  const made = leagueTeams(data, options.seed);
  if (!made.ok) return made;
  const teams = made.value;
  const { seed, userTeam } = options;
  if (!teams.some((t) => t.id === userTeam)) return err({ code: "unknownTeam", teamId: String(userTeam) });
  const slot = options.draftSlot ?? "random";
  if (slot !== "random" && !(Number.isInteger(slot) && slot >= 1 && slot <= teams.length)) return err({ code: "badDraftSlot", slot, teams: teams.length });
  const draftSlot = slot === "random" ? null : slot;
  return ok({
    schemaVersion: FRANCHISE_SCHEMA_VERSION,
    seed,
    settings: { userTeam, draftSlot },
    phase: "draft",
    teams,
    players: generatePool(data, seed),
    rosters: Object.fromEntries(teams.map((t) => [t.id, []])),
    numbers: {},
    draft: { slots: draftSlots(teams.map((t) => t.id), userTeam, draftSlot, data.roster.rosterSize, seed), picks: [], autoDraft: false, targets: [] },
  });
}
