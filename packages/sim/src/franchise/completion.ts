// Whether a draft can still end with every roster legal (legal-pick rule 4, M4 milestone B): every
// team fills the slots it still owns from the pool, with every position inside its min and max.
//
// Starting slots are set aside first: a team's open minimums come out of its slots and out of the
// pool, so what is left is a flow of extra players. Each team owes slots minus open minimums, may
// take up to max minus its count (or its minimum, if larger) at a position, and a position holds its
// pool minus the league's open minimums. A pick that fills a minimum changes none of those three
// numbers, so it never breaks a completion. A pick past the minimum is one unit of the flow, so it
// is legal exactly when some full flow uses that unit.
//
// One full flow is kept as picks land. If it uses the unit, or the position has a spare player to
// swap in, the pick is legal at once (the sound, cheap test). Only when neither holds, so the
// position is tight, is the residual graph searched, and that search is exact.

import { POSITIONS } from "../../../shared/src/engine";
import type { Position } from "../../../shared/src/engine";
import type { RosterLimits } from "./limits";

const P = POSITIONS.length;

/** One way to finish the draft, past the minimums. Positions are indexes into POSITIONS. */
export interface Completion {
  /** Per team and position, the extra players it takes. A team's total is the slots it owns past its open minimums. */
  readonly extra: readonly number[][];
  /** Per team and position, how many more it could take and stay inside its max. */
  readonly room: readonly number[][];
  /** Pool players left over by position, after every minimum and every extra. */
  readonly spare: number[];
}

/** A way to free one player: each step moves one of a team's extras from one position to the next. */
interface Chain {
  readonly start: number;
  readonly steps: readonly { readonly team: number; readonly from: number; readonly to: number }[];
  readonly end: number;
}

/**
 * The shortest chain from one of `starts` to a position with a spare player, or with `giver` set, to
 * one where that team has an extra it can give up. Null when there is none: the flow theorem's
 * residual search (teams on the way keep their totals), so null is proof.
 */
function freeChain(c: Completion, starts: readonly number[], giver: number | null): Chain | null {
  const from = new Array<number>(P).fill(-1);
  const via = new Array<number>(P).fill(-1);
  const seen = new Array<boolean>(P).fill(false);
  const queue = [...starts];
  for (const p of starts) seen[p] = true;
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head] as number;
    if ((c.spare[at] as number) > 0 || (giver !== null && ((c.extra[giver] as number[])[at] as number) > 0)) {
      const steps: Chain["steps"][number][] = [];
      let p = at;
      while ((from[p] as number) >= 0) {
        steps.push({ team: via[p] as number, from: from[p] as number, to: p });
        p = from[p] as number;
      }
      return { start: p, steps, end: at };
    }
    for (let team = 0; team < c.extra.length; team++) {
      if (((c.extra[team] as number[])[at] as number) <= 0) continue;
      const room = c.room[team] as number[];
      for (let to = 0; to < P; to++) {
        if (seen[to] === true || (room[to] as number) <= 0) continue;
        seen[to] = true;
        from[to] = at;
        via[to] = team;
        queue.push(to);
      }
    }
  }
  return null;
}

/** Moves `by` extras of one team at one position, out of its room and the position's spare players. */
function shift(c: Completion, team: number, p: number, by: number): void {
  (c.extra[team] as number[])[p] = ((c.extra[team] as number[])[p] as number) + by;
  (c.room[team] as number[])[p] = ((c.room[team] as number[])[p] as number) - by;
  c.spare[p] = (c.spare[p] as number) - by;
}

function follow(c: Completion, chain: Chain): void {
  for (const { team, from, to } of chain.steps) {
    shift(c, team, from, -1);
    shift(c, team, to, 1);
  }
}

/** The position with the most spare players among those `has` allows, the first on a tie, or -1. */
function mostSpare(c: Completion, has: readonly number[], sign: 1 | -1): number {
  let best = -1;
  for (let p = 0; p < P; p++) {
    if ((has[p] as number) <= 0) continue;
    if (best < 0 || sign * ((c.spare[p] as number) - (c.spare[best] as number)) > 0) best = p;
  }
  return best;
}

/** A completion of the draft from these counts, slots left and pool, or null when there is none. Exact. */
export function findCompletion(limits: RosterLimits, counts: readonly Readonly<Record<Position, number>>[], left: readonly number[], avail: Readonly<Record<Position, number>>): Completion | null {
  const spare = POSITIONS.map((p) => avail[p] - counts.reduce((s, c) => s + Math.max(0, limits[p].min - c[p]), 0));
  if (spare.some((n) => n < 0)) return null;
  const room = counts.map((c) => POSITIONS.map((p) => limits[p].max - Math.max(limits[p].min, c[p])));
  if (room.some((r) => r.some((n) => n < 0))) return null;
  const owed = counts.map((c, i) => POSITIONS.reduce((s, p) => s - Math.max(0, limits[p].min - c[p]), left[i] as number));
  if (owed.some((n) => n < 0)) return null;
  const made: Completion = { extra: counts.map(() => POSITIONS.map(() => 0)), room, spare };
  for (const [team, n] of owed.entries()) {
    for (let k = 0; k < n; k++) {
      const mine = room[team] as number[];
      // Taking where the most are spare keeps every position's leftovers, so the cheap test holds longest.
      let p = mostSpare(made, mine, 1);
      if (p < 0) return null;
      if ((spare[p] as number) <= 0) {
        const chain = freeChain(made, POSITIONS.map((_, i) => i).filter((i) => (mine[i] as number) > 0), null);
        if (chain === null) return null;
        follow(made, chain);
        p = chain.start;
      }
      shift(made, team, p, 1);
    }
  }
  return made;
}

/** Whether a completion exists in which `team`, whose extras are not all taken, takes one more `position` player past its minimum. Exact. */
export function canTakeExtra(c: Completion, team: number, position: number): boolean {
  if (((c.extra[team] as number[])[position] as number) > 0) return true;
  // A team that owes an extra can always trade one of its own for a spare player here.
  return (c.spare[position] as number) > 0 || freeChain(c, [position], team) !== null;
}

/** Lands an extra pick that `canTakeExtra` allowed: the kept completion is moved to one that uses it, then loses it. */
export function takeExtra(c: Completion, team: number, position: number): void {
  const mine = c.extra[team] as number[];
  if ((mine[position] as number) === 0) {
    const chain = freeChain(c, [position], team) as Chain;
    // What the team gives up for it: the chain's end, or where fewest are spare when the end had one to give.
    const given = (mine[chain.end] as number) > 0 ? chain.end : mostSpare(c, mine, -1);
    shift(c, team, given, -1);
    follow(c, chain);
    shift(c, team, position, 1);
  }
  mine[position] = (mine[position] as number) - 1;
}
