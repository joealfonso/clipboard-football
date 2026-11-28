// The draft pool (M4 milestone A, designed): every player in the league, with no team and no
// number. Larger than the rosters need, so the last rounds still have choices. One distribution
// per position: a rating is drawn from the engine's curve exactly as generateTeam draws it, then
// scaled and moved about the engine's league mean by data/franchise/pool.json `adjust`, the same for
// every player at the position. Only ratings the overall weights name are adjusted: choosing starters
// by overall does not select on the others. The engine measures rating effects from the league mean,
// so adjust centers the players a drafted league puts on the field on that mean.

import { BASE_RATINGS, POSITION_SKILLS, POSITIONS } from "../../../shared/src/engine";
import type { BaseRating, CurvePoint, Position } from "../../../shared/src/engine";
import { poolCount } from "../../../shared/src/franchise";
import type { FranchiseData, PoolAdjust, PoolPlayer } from "../../../shared/src/franchise";
import { leagueMeans } from "../engine/effects";
import { curveAt } from "../engine/players";
import type { Rng } from "../rng";
import { rosterLimits, teamCount } from "./limits";
import { STREAMS, below, stream } from "./streams";

/** Players per position in the pool. */
export function poolCounts(data: FranchiseData): Readonly<Record<Position, number>> {
  const teams = teamCount(data.league);
  const limits = rosterLimits(data);
  return Object.fromEntries(POSITIONS.map((p) => [p, poolCount(teams, limits[p].target, limits[p].min, data.pool.surplus)])) as Record<Position, number>;
}

function draw(curve: readonly CurvePoint[], rng: Rng): number {
  return Math.max(0, Math.min(99, Math.round(curveAt(curve, rng.nextFloat()))));
}

/** The draw moved about the league mean, clamped to floor and 99. A rating with no entry is the draw itself. */
function adjusted(x: number, mean: number, adjust: PoolAdjust | undefined, floor: number): number {
  if (adjust === undefined) return x;
  return Math.max(floor, Math.min(99, Math.round(mean + adjust.scale * (x - mean) + adjust.offset)));
}

/** A full name no one in `taken` has: a seeded draw, redrawn on a repeat, then the next free pair in list order. */
function uniqueName(first: readonly string[], last: readonly string[], taken: Set<string>, maxRedraws: number, rng: Rng): string {
  let f = 0;
  let l = 0;
  for (let tries = 0; tries <= maxRedraws; tries++) {
    f = below(rng, first.length);
    l = below(rng, last.length);
    const name = `${first[f] as string} ${last[l] as string}`;
    if (!taken.has(name)) return name;
  }
  const pairs = first.length * last.length;
  const start = f * last.length + l;
  for (let k = 1; k < pairs; k++) {
    const at = (start + k) % pairs;
    const name = `${first[Math.floor(at / last.length)] as string} ${last[at % last.length] as string}`;
    if (!taken.has(name)) return name;
  }
  // Unreachable with validated data (parseFranchiseData checks the lists cover the pool): a repeat is kept over a throw.
  return `${first[f] as string} ${last[l] as string}`;
}

/** The whole pool for a seed, in id order: by position. Same seed, same pool. */
export function generatePool(data: FranchiseData, seed: number): PoolPlayer[] {
  const rng = stream(seed, STREAMS.pool);
  const counts = poolCounts(data);
  const engine = data.game.engine;
  const means = leagueMeans(engine.distributions);
  const total = POSITIONS.reduce((s, p) => s + counts[p], 0);
  const width = Math.max(4, String(total).length);
  const taken = new Set<string>();
  const players: PoolPlayer[] = [];
  for (const position of POSITIONS) {
    const adjust = data.pool.adjust[position];
    const rate = (r: string): number => adjusted(draw(engine.ratings.curve, rng), means[position]?.[r] ?? 0, adjust[r], data.pool.floor);
    for (let i = 0; i < counts[position]; i++) {
      const ratings = Object.fromEntries(BASE_RATINGS.map((r) => [r, rate(r)])) as Record<BaseRating, number>;
      const skills = Object.fromEntries(POSITION_SKILLS[position].map((s) => [s, rate(s)]));
      const name = uniqueName(engine.names.first, engine.names.last, taken, data.pool.names.maxRedraws, rng);
      taken.add(name);
      players.push({ id: `P${String(players.length + 1).padStart(width, "0")}`, name, position, ratings, skills });
    }
  }
  return players;
}

/** A pool's players by id. Cached per players array, which never changes once made. */
const indexCache = new WeakMap<readonly PoolPlayer[], ReadonlyMap<string, PoolPlayer>>();
export function playerIndex(players: readonly PoolPlayer[]): ReadonlyMap<string, PoolPlayer> {
  let got = indexCache.get(players);
  if (got === undefined) {
    got = new Map(players.map((p) => [p.id, p]));
    indexCache.set(players, got);
  }
  return got;
}
