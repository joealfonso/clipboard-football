// Roster helpers the M2 engine will provide, kept thin so they can be deleted when it lands:
// jersey numbers (milestone A), league-wide rating ranks (milestone C6) and who was on the field
// for a play (milestone B's `onField`). Pure: no DOM, no Rng.

import { POSITIONS, type Personnel, type Player, type Position, type TeamPool } from "@clipboard-football/shared";
import type { NumberedPlayer, OnField, OnFieldSlot, RatingRank } from "./types";

// ---------------------------------------------------------------- jersey numbers (MOCK until milestone A)

/**
 * MOCK. Placeholder numbers by position so marks, cards and the result line have something to
 * show before milestone A ships numbers in the player schema. Not checked against the 2026
 * numbering rule (it isn't in RULES.md yet). A player that already has `number` keeps it.
 */
const MOCK_RANGES: Readonly<Record<Position, readonly [number, number][]>> = {
  QB: [[1, 19]],
  RB: [[20, 49]],
  WR: [[80, 89], [10, 19]],
  TE: [[80, 89], [40, 49]],
  OL: [[60, 79]],
  DL: [[90, 99], [50, 59]],
  LB: [[50, 59], [40, 49]],
  CB: [[20, 39]],
  S: [[20, 49]],
  K: [[1, 19]],
  P: [[1, 19]],
};

/** Every player's number: the schema's when present, else a deterministic placeholder by pool order. */
export function numbersFor(pool: TeamPool): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  const used = new Set<number>();
  for (const p of pool.players as readonly NumberedPlayer[]) {
    if (typeof p.number === "number") {
      out.set(p.id, p.number);
      used.add(p.number);
    }
  }
  // Odd-then-even within each range spreads numbers out, so a roster doesn't read 60, 61, 62.
  for (const p of pool.players as readonly NumberedPlayer[]) {
    if (out.has(p.id)) continue;
    let got: number | undefined;
    for (const [lo, hi] of MOCK_RANGES[p.position]) {
      for (const parity of [1, 0]) {
        for (let n = lo; n <= hi && got === undefined; n++) if (n % 2 === parity && !used.has(n)) got = n;
      }
      if (got !== undefined) break;
    }
    for (let n = 0; got === undefined && n <= 99; n++) if (!used.has(n)) got = n;
    if (got === undefined) throw new RangeError(`${pool.name} has more than 100 players`);
    used.add(got);
    out.set(p.id, got);
  }
  return out;
}

// ---------------------------------------------------------------- rating ranks (adapter until milestone C6)

export function ratingValue(p: Player, rating: string): number | undefined {
  return (p.ratings as Readonly<Record<string, number>>)[rating] ?? p.skills[rating];
}

/**
 * Each rating's rank at the player's position across every player in the league (the generated
 * league's pools, card ratings). Higher is better; ties share the best rank (ASSUMED tie rule).
 */
export function ratingRanks(league: readonly TeamPool[], player: Player): RatingRank[] {
  const peers = league.flatMap((t) => t.players.filter((p) => p.position === player.position));
  const names = [...Object.keys(player.ratings), ...Object.keys(player.skills)];
  return names.map((rating) => {
    const value = ratingValue(player, rating) as number;
    const better = peers.filter((p) => (ratingValue(p, rating) ?? -Infinity) > value).length;
    return { rating, value, rank: better + 1, of: peers.length };
  });
}

// ---------------------------------------------------------------- on the field (adapter until milestone B)

/**
 * Who the M1 engine puts on the field: the first n of each position in pool order, by the
 * personnel unit it uses (packages/sim engine/resolve.ts ctxFor). Kicks, kneels and spikes use
 * the base package on defense there, so this does too.
 */
export function onFieldFor(personnel: Personnel, offense: TeamPool, defense: TeamPool, offenseUnit: { group: "offense" | "kick"; name: string }, defensePackage: string): OnField | undefined {
  const os = offenseUnit.group === "offense" ? personnel.offense[offenseUnit.name] : personnel.kick[offenseUnit.name];
  const ds = personnel.packages[defensePackage];
  if (os === undefined || ds === undefined) return undefined;
  const fill = (pool: TeamPool, slots: Readonly<Partial<Record<Position, number>>>): OnFieldSlot[] | undefined => {
    const out: OnFieldSlot[] = [];
    for (const pos of POSITIONS) {
      const n = slots[pos] ?? 0;
      const have = pool.players.filter((p) => p.position === pos);
      if (have.length < n) return undefined;
      for (let i = 0; i < n; i++) out.push({ slot: `${pos}${i + 1}`, position: pos, id: (have[i] as Player).id });
    }
    return out;
  };
  const o = fill(offense, os);
  const d = fill(defense, ds);
  return o === undefined || d === undefined ? undefined : { offense: o, defense: d };
}
