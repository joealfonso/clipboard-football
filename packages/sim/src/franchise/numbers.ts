// Jersey numbers for a franchise roster (M4 milestone B, designed). Each player gets a seeded
// uniform draw from the numbers the rule set allows his position (Rule 5-1-2, rules.jerseyNumbers)
// that no teammate has. The positions with the fewest allowed numbers draw first, so a narrow
// range is never used up by a position that had other choices. Never throws: a player with no
// number left comes back as a typed failure.

import { jerseyNumberAllowed } from "../../../shared/src/engine";
import type { Position } from "../../../shared/src/engine";
import type { RuleSet } from "../../../shared/src/rules";
import type { Rng } from "../rng";
import { below } from "./streams";

export interface Numbered {
  readonly id: string;
  readonly position: Position;
}

export type NumbersResult = { readonly ok: true; readonly numbers: Record<string, number> } | { readonly ok: false; readonly playerId: string; readonly position: Position };

/** The numbers a position may wear, ascending. */
export function legalNumbers(rules: Pick<RuleSet, "jerseyNumbers">, position: Position): number[] {
  const out: number[] = [];
  for (let n = 0; n <= 99; n++) if (jerseyNumberAllowed(rules, position, n)) out.push(n);
  return out;
}

/**
 * Numbers for `players` (a roster in depth order). `taken` holds numbers already worn on the
 * team. Same players, rules and generator state give the same numbers.
 */
export function assignRosterNumbers(players: readonly Numbered[], rules: Pick<RuleSet, "jerseyNumbers">, rng: Rng, taken: ReadonlySet<number> = new Set()): NumbersResult {
  const legal = new Map<Position, number[]>();
  for (const p of players) if (!legal.has(p.position)) legal.set(p.position, legalNumbers(rules, p.position));
  const order = players.map((p, i) => ({ p, i })).sort((a, b) => (legal.get(a.p.position) as number[]).length - (legal.get(b.p.position) as number[]).length || a.i - b.i);
  const used = new Set(taken);
  const numbers: Record<string, number> = {};
  for (const { p } of order) {
    const free = (legal.get(p.position) as number[]).filter((n) => !used.has(n));
    const n = free[below(rng, free.length)];
    if (n === undefined) return { ok: false, playerId: p.id, position: p.position };
    used.add(n);
    numbers[p.id] = n;
  }
  return { ok: true, numbers };
}
