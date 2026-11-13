// Generated leagues for the full-game loop and the calibration (M1 step 5, milestone B). Teams
// are the step 4 generator's league-average teams with designed fictional names, plus a designed
// per-team strength shift (data/game/league.json teamStrength.sd, tuned on 2016-2023 margins
// only). With sd 0 every team is league-average.

import type { GameData, TeamName, TeamPool } from "../../../shared/src/types";
import { generateTeam } from "../engine/players";
import type { GameType } from "../game/types";
import { Rng } from "../rng";
import { averageCoach, type CoachPolicies } from "./coach";
import type { GameSetup } from "./play";

const MIN_RATING = 0;
const MAX_RATING = 99;

export interface LeagueTeam {
  readonly name: string;
  /** The designed strength shift in rating points (whole points) given to every player. */
  readonly strength: number;
  readonly pool: TeamPool;
}

/** A standard normal draw (Box-Muller, two uniforms). */
export function normal(rng: Rng): number {
  const u = 1 - rng.nextFloat();
  const v = rng.nextFloat();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clampRating(x: number): number {
  return Math.min(MAX_RATING, Math.max(MIN_RATING, x));
}

export function shiftPool(pool: TeamPool, points: number): TeamPool {
  if (points === 0) return pool;
  return {
    ...pool,
    players: pool.players.map((p) => ({
      ...p,
      ratings: Object.fromEntries(Object.entries(p.ratings).map(([k, v]) => [k, clampRating(v + points)])) as typeof p.ratings,
      skills: Object.fromEntries(Object.entries(p.skills).map(([k, v]) => [k, clampRating(v + points)])),
    })),
  };
}

export function teamLabel(n: TeamName): string {
  return `${n.place} ${n.nickname}`;
}

/** n distinct names in a seeded order (a partial Fisher-Yates shuffle). */
export function pickNames(names: readonly TeamName[], n: number, rng: Rng): TeamName[] {
  if (n > names.length) throw new RangeError(`a league of ${n} needs ${n} team names, the file has ${names.length}`);
  const xs = [...names];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng.nextFloat() * (xs.length - i));
    [xs[i], xs[j]] = [xs[j] as TeamName, xs[i] as TeamName];
  }
  return xs.slice(0, n);
}

export function generateLeague(rng: Rng, data: GameData, n: number): LeagueTeam[] {
  const names = pickNames(data.teamNames.teams, n, rng);
  const sd = data.league.teamStrength.sd;
  return names.map((nm) => {
    const name = teamLabel(nm);
    const base = generateTeam(rng, data.engine, name);
    const strength = sd === 0 ? 0 : Math.round(sd * normal(rng));
    return { name, strength, pool: shiftPool(base, strength) };
  });
}

/** One game's pairing: two distinct teams, the first at home. */
export function drawPairing(rng: Rng, n: number): { home: number; away: number } {
  const home = Math.floor(rng.nextFloat() * n);
  let away = Math.floor(rng.nextFloat() * (n - 1));
  if (away >= home) away++;
  return { home, away };
}

/** The average coach for every team (M1). Policies are per team, so a later coach layer can replace one. */
export function averageCoachFor(data: GameData): CoachPolicies {
  const fg = data.engine.special.fieldGoals;
  return averageCoach({
    caller: data.engine.caller, config: data.config, tables: data.tables, perDeadBall: data.engine.rules.timeouts.perTeamPerDeadBall,
    fieldGoals: { minDistance: fg.minDistance, maxDistance: fg.maxDistance, makePer10000: fg.makePer10000, kickDepth: fg.kickDepth, endZoneYards: data.engine.rules.field.endZoneYards },
  });
}

/**
 * The setup of game `seed` in a league: the pairing comes from a fork of a generator seeded with
 * `seed` (so the game's own generator, Rng.fromSeed(seed), is untouched by it), and each team
 * gets its own policies from `coachFor`.
 */
export function setupGame(league: readonly LeagueTeam[], leagueSeed: number, seed: number, coachFor: (t: LeagueTeam) => CoachPolicies, gameType: GameType = "regularSeason"): GameSetup {
  const { home, away } = drawPairing(Rng.fromSeed(seed).fork(), league.length);
  const h = league[home] as LeagueTeam;
  const a = league[away] as LeagueTeam;
  return {
    gameType,
    seed,
    leagueSeed,
    home: { name: h.name, pool: h.pool, coach: coachFor(h) },
    away: { name: a.name, pool: a.pool, coach: coachFor(a) },
  };
}

/** A league from its seed: the teams, and the generator that then gives the game seeds. */
export function leagueFromSeed(data: GameData, leagueSeed: number): { teams: LeagueTeam[]; seeds: Rng } {
  const rng = Rng.fromSeed(leagueSeed);
  const teams = generateLeague(rng, data, data.config.league.teams);
  return { teams, seeds: rng.fork() };
}
