// Rating effects (designed, data/players/ratings.json). Each effect multiplies a named class or
// penalty rate by 1 + edge, clamped to [min, max], where edge = sum over inputs of coef x (the
// on-field average - the league average). The league average is the position's mean rating in
// distributions.json, so a league-average unit gives exactly 1, and structural differences
// between packages live in the matchup table only. Linear rather than exp(edge) so that a
// spread of generated teams averages to 1 instead of drifting up (D5).

import type { Distributions, Player, RatingEffect } from "../../../shared/src/engine";
import { ratingOf } from "./players";

export type Field = Readonly<Record<string, readonly Player[]>>;

export interface AppliedEffect {
  readonly effect: RatingEffect;
  /** The multiplier minus 1, before clamping. */
  readonly edge: number;
  readonly multiplier: number;
}

export type Means = Readonly<Record<string, Readonly<Record<string, number>>>>;

export function leagueMeans(d: Distributions): Means {
  const out: Record<string, Record<string, number>> = {};
  for (const [pos, rs] of Object.entries(d.ratings)) {
    out[pos] = Object.fromEntries(Object.entries(rs).map(([r, v]) => [r, v.mean]));
  }
  return out;
}

/** Average distance of the on-field players at `position` from the league mean; 0 if none. */
export function deviation(field: Field, means: Means, position: string, rating: string): number {
  const ps = field[position];
  if (ps === undefined || ps.length === 0) return 0;
  const mu = means[position]?.[rating] ?? 0;
  let s = 0;
  for (const p of ps) s += ratingOf(p, rating) - mu;
  return s / ps.length;
}

export function applyEffect(effect: RatingEffect, offense: Field, defense: Field, means: Means): AppliedEffect {
  let edge = 0;
  for (const i of effect.inputs) {
    edge += i.coef * deviation(i.side === "offense" ? offense : defense, means, i.position, i.rating);
  }
  const m = edge === 0 ? 1 : Math.min(effect.max, Math.max(effect.min, 1 + edge));
  return { effect, edge, multiplier: m };
}
