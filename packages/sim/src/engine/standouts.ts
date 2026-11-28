// M2 milestone F: standout plays (designed, centered; data/engine/standouts.json). An elite
// player on the field multiplies the chance of his kind's class, weighted by his share of the
// role; the layer is centered so league class rates stay where they were. Multipliers act on
// class probabilities only (locked 3): a standout never edits the real play drawn in the class.
// Draws nothing: the factor is a pure function of who is on the field.

import type { Player, StandoutKind, StandoutsConfig, TeamPool } from "../../../shared/src/engine";
import type { ParticipantsConfig } from "../../../shared/src/engine";
import { baseShares, type Unit } from "./participants";

export interface Elite {
  /** The on-field player (the engine's copy, home field applied). */
  readonly player: Player;
  /** The rating shown: the kind's highest card rating for him, and its value. */
  readonly rating: string;
  readonly value: number;
  /** His base share of the role on this play. */
  readonly share: number;
}

/** One kind applied to one class draw. */
export interface Applied {
  readonly kind: StandoutKind;
  readonly elites: readonly Elite[];
  /** The factor on the class: centering x (1 + sum of share x (multiplier - 1)). */
  readonly factor: number;
}

/** Card ratings by player id: the pools before home field (Players.cards). */
export type CardLookup = (p: Player) => Player;

const cardCache = new WeakMap<TeamPool, Map<string, Player>>();
export function cardsOf(pool: TeamPool): Map<string, Player> {
  let m = cardCache.get(pool);
  if (m === undefined) {
    m = new Map(pool.players.map((p) => [p.id, p]));
    cardCache.set(pool, m);
  }
  return m;
}

function ratingOf(p: Player, r: string): number | undefined {
  return (p.ratings as Readonly<Record<string, number>>)[r] ?? p.skills[r];
}

/** The kind's best card rating for a player at one of its positions, when it reaches the threshold. */
export function eliteRating(kind: StandoutKind, card: Player, threshold: number): { rating: string; value: number } | null {
  if (!kind.positions.includes(card.position)) return null;
  let best: { rating: string; value: number } | null = null;
  for (const r of kind.ratings) {
    const v = ratingOf(card, r);
    if (v !== undefined && v >= threshold && (best === null || v > best.value)) best = { rating: r, value: v };
  }
  return best;
}

/**
 * The kinds that apply to a class draw in `family` (run, pass, fieldGoal) for this leaf and
 * distance, each with its elites and factor. A kind applies when its role has a share on the
 * play; with no elite on the field its factor is the centering alone.
 */
export function standoutsFor(
  cfg: StandoutsConfig,
  parts: ParticipantsConfig,
  family: string,
  leaf: string,
  distance: number | null,
  offense: Unit,
  defense: Unit,
  card: CardLookup,
): Applied[] {
  const out: Applied[] = [];
  for (const kind of cfg.kinds) {
    if (kind.family !== family) continue;
    if (kind.minDistance !== undefined && (distance === null || distance < kind.minDistance)) continue;
    const role = kind.role === "kicker" ? null : parts.roles[kind.role];
    let shares: ReadonlyMap<Player, number>;
    if (role === null) {
      const k = offense["K"]?.[0];
      shares = new Map(k === undefined ? [] : [[k, 1]]);
    } else if (role !== undefined) shares = baseShares(parts, kind.role, role, role.side === "offense" ? offense : defense, { cls: null, leaf, unit: null });
    else continue;
    if (shares.size === 0) continue;
    const elites: Elite[] = [];
    let raw = 1;
    for (const [p, share] of shares) {
      const e = eliteRating(kind, card(p), cfg.threshold);
      if (e === null) continue;
      elites.push({ player: p, rating: e.rating, value: e.value, share });
      raw += share * (kind.multiplier - 1);
    }
    out.push({ kind, elites, factor: (cfg.centering[kind.id] ?? 1) * raw });
  }
  return out;
}
