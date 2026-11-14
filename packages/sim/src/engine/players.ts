// Players: the M1 generator of league-average fictional teams, on-field selection, and the
// designed mapping from a combine measurement to a 0-99 rating.

import { BASE_RATINGS, jerseyNumberAllowed, PLAYER_SCHEMA_VERSION, POSITION_SKILLS, POSITIONS } from "../../../shared/src/engine";
import type { CurvePoint, Distributions, DrillTable, Names, Personnel, Player, Position, RatingsConfig, Slots, TeamPool } from "../../../shared/src/engine";
import type { RuleSet } from "../../../shared/src/rules";
import { Rng } from "../rng";
import { fail } from "./errors";

/** Piecewise-linear curve from a percentile within position (0 to 1) to a rating. */
export function curveAt(curve: readonly CurvePoint[], p: number): number {
  const first = curve[0];
  if (first === undefined) return 0;
  if (p <= first.p) return first.rating;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1] as CurvePoint;
    const b = curve[i] as CurvePoint;
    if (p <= b.p) {
      const t = b.p === a.p ? 0 : (p - a.p) / (b.p - a.p);
      return a.rating + t * (b.rating - a.rating);
    }
  }
  return (curve[curve.length - 1] as CurvePoint).rating;
}

/**
 * Percentile (0 to 1) of a measurement within its position from the drill's cut points at
 * `percentiles`. Between cuts it interpolates; beyond the outer cuts it extends the outer
 * percentiles linearly to 0 and 1 over one more cut spacing, clamped. Never decreasing in the
 * measurement (increasing when lower is better is reversed).
 */
export function percentileOf(table: DrillTable, value: number, lowerIsBetter: boolean, percentiles: readonly number[]): number {
  const cuts = table.cuts;
  const n = cuts.length;
  if (n === 0 || percentiles.length !== n) return 0.5;
  const first = cuts[0] as number;
  const last = cuts[n - 1] as number;
  const p0 = percentiles[0] as number;
  const p1 = percentiles[n - 1] as number;
  let below: number;
  if (value <= first) {
    const span = n > 1 ? (cuts[1] as number) - first : 0;
    below = span > 0 ? Math.max(0, p0 - (p0 * (first - value)) / span) : p0;
  } else if (value >= last) {
    const span = n > 1 ? last - (cuts[n - 2] as number) : 0;
    below = span > 0 ? Math.min(1, p1 + ((1 - p1) * (value - last)) / span) : p1;
  } else {
    below = p1;
    for (let i = 1; i < n; i++) {
      const hi = cuts[i] as number;
      if (value <= hi) {
        const lo = cuts[i - 1] as number;
        const t = hi === lo ? 0 : (value - lo) / (hi - lo);
        const a = percentiles[i - 1] as number;
        below = a + t * ((percentiles[i] as number) - a);
        break;
      }
    }
  }
  return lowerIsBetter ? 1 - below : below;
}

/**
 * A4: the rating a measured player gets. Each available drill's within-position percentile,
 * weighted by the designed drill weights, through the designed curve. Drills the position has
 * no table for, or the player did not run, are left out. Returns null when none remains.
 */
export function ratingFromMeasurements(
  ratings: RatingsConfig,
  distributions: Distributions,
  position: Position,
  rating: string,
  values: Readonly<Record<string, number | null>>,
): number | null {
  const m = ratings.measured[rating];
  if (m === undefined) return null;
  const tables = distributions.drills[position] ?? {};
  let acc = 0;
  let wsum = 0;
  m.drills.forEach((drill, i) => {
    const t = tables[drill];
    const v = values[drill];
    if (t === undefined || v === undefined || v === null) return;
    const w = m.drillWeights[i] ?? 0;
    acc += w * percentileOf(t, v, m.lowerIsBetter[i] === true, distributions.percentiles);
    wsum += w;
  });
  if (wsum === 0) return null;
  return Math.round(curveAt(ratings.curve, acc / wsum));
}

/** The most players of each position any formation, package or kick unit puts on the field. */
export function slotNeeds(personnel: Personnel): Readonly<Record<Position, number>> {
  const need = Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>;
  const groups: Slots[] = [...Object.values(personnel.offense), ...Object.values(personnel.kick), ...Object.values(personnel.packages)];
  for (const g of groups) {
    for (const p of POSITIONS) need[p] = Math.max(need[p], g[p] ?? 0);
  }
  return need;
}

export interface GeneratorData {
  readonly personnel: Personnel;
  readonly ratings: RatingsConfig;
  readonly distributions: Distributions;
  readonly names: Names;
  /** M2 milestone A: the numbers each position may wear. */
  readonly rules: Pick<RuleSet, "jerseyNumbers">;
}

/** A player before M2 (schema version 1): everything but the number. */
export type UnnumberedPlayer = Omit<Player, "number" | "schemaVersion">;

/**
 * M2 milestone A (designed): jersey numbers in pool order, each drawn uniformly from the numbers
 * the rule set allows for the position (Rule 5-1-2) that no teammate has yet. Throws
 * EngineError("badPlayers") when a position has none left.
 */
export function assignNumbers(players: readonly UnnumberedPlayer[], rules: Pick<RuleSet, "jerseyNumbers">, rng: Rng): Player[] {
  const taken = new Set<number>();
  return players.map((p) => {
    const free: number[] = [];
    for (let n = 0; n <= 99; n++) if (!taken.has(n) && jerseyNumberAllowed(rules, p.position, n)) free.push(n);
    const n = free[Math.floor(rng.nextFloat() * free.length)];
    if (n === undefined) fail("badPlayers", `no jersey number left for ${p.id} (${p.position})`);
    taken.add(n);
    const { id, name, position, ratings, skills } = p;
    return { schemaVersion: PLAYER_SCHEMA_VERSION, id, name, position, number: n, ratings, skills };
  });
}

/**
 * The stream jersey numbers are drawn from: a copy of `rng` jumped 2^64 draws ahead. Reads the
 * generator's state and never advances it, so every other field the generator draws for a seed
 * is unchanged by numbering (A4).
 */
export function numberStream(rng: Rng): Rng {
  const s = Rng.fromState(rng.getState());
  s.jump();
  return s;
}

/** A4 (A3): a version 1 pool to version 2, numbers by `seed`. Same pool and seed, same numbers. */
export function migrateTeamPool(pool: { readonly name: string; readonly players: readonly UnnumberedPlayer[] }, rules: Pick<RuleSet, "jerseyNumbers">, seed: number): TeamPool {
  return { schemaVersion: PLAYER_SCHEMA_VERSION, name: pool.name, players: assignNumbers(pool.players, rules, Rng.fromSeed(seed)) };
}

function pick<T>(xs: readonly T[], rng: Rng): T {
  const x = xs[Math.floor(rng.nextFloat() * xs.length)];
  if (x === undefined) fail("badPlayers", "empty name list");
  return x;
}

function draw(curve: readonly CurvePoint[], rng: Rng): number {
  return Math.max(0, Math.min(99, Math.round(curveAt(curve, rng.nextFloat()))));
}

/**
 * M1's generator of league-average fictional teams: exactly enough players of each position to
 * fill every grouping in personnel.json, every rating drawn from the designed curve (the
 * per-position distribution in distributions.json), names from names.json, jersey numbers from a
 * side stream (numberStream; M2 milestone A). Same seed, same team.
 */
export function generateTeam(rng: Rng, data: GeneratorData, teamName = "Team"): TeamPool {
  const need = slotNeeds(data.personnel);
  const players: UnnumberedPlayer[] = [];
  for (const position of POSITIONS) {
    for (let i = 0; i < need[position]; i++) {
      const ratings = Object.fromEntries(BASE_RATINGS.map((r) => [r, draw(data.ratings.curve, rng)])) as Record<(typeof BASE_RATINGS)[number], number>;
      const skills = Object.fromEntries(POSITION_SKILLS[position].map((s) => [s, draw(data.ratings.curve, rng)]));
      const name = `${pick(data.names.first, rng)} ${pick(data.names.last, rng)}`;
      players.push({ id: `${teamName}-${position}${i + 1}`, name, position, ratings, skills });
    }
  }
  return { schemaVersion: PLAYER_SCHEMA_VERSION, name: teamName, players: assignNumbers(players, data.rules, numberStream(rng)) };
}

/** A pool's players by position, in pool order. Cached per pool object. */
const byPositionCache = new WeakMap<TeamPool, Readonly<Record<string, readonly Player[]>>>();
export function byPosition(pool: TeamPool): Readonly<Record<string, readonly Player[]>> {
  let got = byPositionCache.get(pool);
  if (got === undefined) {
    const m: Record<string, Player[]> = {};
    for (const p of pool.players) (m[p.position] ??= []).push(p);
    got = m;
    byPositionCache.set(pool, got);
  }
  return got;
}

/** The players a unit puts on the field: the first n of each position. */
export function onField(pool: TeamPool, slots: Slots, what: string): Readonly<Record<string, readonly Player[]>> {
  const pos = byPosition(pool);
  const out: Record<string, readonly Player[]> = {};
  for (const p of POSITIONS) {
    const n = slots[p] ?? 0;
    if (n === 0) continue;
    const have = pos[p] ?? [];
    if (have.length < n) fail("badPlayers", `${pool.name} has ${have.length} ${p} for ${what}, which needs ${n}`);
    out[p] = have.length === n ? have : have.slice(0, n);
  }
  return out;
}

export function ratingOf(player: Player, rating: string): number {
  const base = (player.ratings as Readonly<Record<string, number>>)[rating];
  if (base !== undefined) return base;
  const skill = player.skills[rating];
  if (skill === undefined) fail("badPlayers", `${player.id} (${player.position}) has no rating ${rating}`);
  return skill;
}
