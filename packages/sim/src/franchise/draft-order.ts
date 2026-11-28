// The snake order (M4 milestone B, designed). Round 1 is a seeded shuffle of the teams; a user who
// chose a slot sits there and the others keep their seeded order around him. Odd rounds run first
// to last, even rounds last to first. The state stores the owner of every slot as an explicit
// list built here, so trading slots later needs no new rule.

import type { TeamId } from "../../../shared/src/franchise";
import { STREAMS, shuffled, stream } from "./streams";

/** Round 1, first pick to last. `userSlot` is 1-based, or null for wherever the shuffle put the user. */
export function roundOneOrder(teamIds: readonly TeamId[], userTeam: TeamId, userSlot: number | null, seed: number): TeamId[] {
  const order = shuffled(teamIds, stream(seed, STREAMS.draftOrder));
  if (userSlot === null) return order;
  const others = order.filter((t) => t !== userTeam);
  others.splice(userSlot - 1, 0, userTeam);
  return others;
}

/** The 0-based round 1 position that owns overall pick `overallPick` (1-based) in a snake of `teams`. */
export function snakeIndex(overallPick: number, teams: number): number {
  const round = Math.floor((overallPick - 1) / teams);
  const i = (overallPick - 1) % teams;
  return round % 2 === 0 ? i : teams - 1 - i;
}

/** The owner of every pick, in order: `rounds` x teams entries. */
export function draftSlots(teamIds: readonly TeamId[], userTeam: TeamId, userSlot: number | null, rounds: number, seed: number): TeamId[] {
  const order = roundOneOrder(teamIds, userTeam, userSlot, seed);
  const n = order.length;
  const slots: TeamId[] = [];
  for (let pick = 1; pick <= rounds * n; pick++) slots.push(order[snakeIndex(pick, n)] as TeamId);
  return slots;
}

/** The overall pick numbers (1-based) a round 1 slot (1-based) holds, one per round. */
export function picksForSlot(slot: number, teams: number, rounds: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < rounds; r++) out.push(r * teams + (r % 2 === 0 ? slot : teams + 1 - slot));
  return out;
}

export function roundOf(overallPick: number, teams: number): { round: number; pickInRound: number } {
  return { round: Math.floor((overallPick - 1) / teams) + 1, pickInRound: ((overallPick - 1) % teams) + 1 };
}
