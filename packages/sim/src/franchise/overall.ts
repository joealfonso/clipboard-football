// A player's overall (designed, display and AI only: the engine never reads it). The same formula
// as the app's overallRating, from the same weights (data/ui/templates.json overallWeights, passed
// in through FranchiseData). The draft board ranks by it, the AI drafts by it.

import type { OverallWeights, PoolPlayer } from "../../../shared/src/franchise";

type Rated = Pick<PoolPlayer, "position" | "ratings" | "skills">;

/** The rounded weighted mean of the ratings the position's weights name. 0 when it names none he has. */
export function overall(player: Rated, weights: OverallWeights): number {
  let sum = 0;
  let total = 0;
  for (const [r, w] of Object.entries(weights[player.position] ?? {})) {
    const v = (player.ratings as Readonly<Record<string, number>>)[r] ?? player.skills[r];
    if (v === undefined) continue;
    sum += v * w;
    total += w;
  }
  return total === 0 ? 0 : Math.round(sum / total);
}

/** Pool players never change, so a pool's overalls are worked out once per players array and weights. */
const cache = new WeakMap<readonly PoolPlayer[], { readonly weights: OverallWeights; readonly byId: ReadonlyMap<string, number> }>();

export function overalls(players: readonly PoolPlayer[], weights: OverallWeights): ReadonlyMap<string, number> {
  const hit = cache.get(players);
  if (hit !== undefined && hit.weights === weights) return hit.byId;
  const byId = new Map<string, number>();
  for (const p of players) byId.set(p.id, overall(p, weights));
  cache.set(players, { weights, byId });
  return byId;
}

/** Board and depth order: overall descending, ties by id. A total order. */
export function byOverallThenId(a: { readonly id: string; readonly overall: number }, b: { readonly id: string; readonly overall: number }): number {
  return b.overall - a.overall || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
