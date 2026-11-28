// The real franchise data for tests, the value of a result, and the scripted drafters the draft
// tests share. The loader is the scripts' (scripts/franchise/data.ts).

import { jerseyNumberAllowed, POSITIONS } from "../../../shared/src/engine";
import type { Position } from "../../../shared/src/engine";
import type { FranchiseData, FranchiseResult, FranchiseState } from "../../../shared/src/franchise";
import { createFranchise, legalPicks, makePick, playerIndex, rosterLimits, runDraft, setAutoDraft } from "../../src/franchise/index";
import { Rng } from "../../src/rng";
import { loadFranchise } from "../../../../scripts/franchise/data";

export { FRANCHISE_FILES, franchiseFiles, OVERALL_WEIGHTS_FILE, readJson } from "../../../../scripts/franchise/data";

let cached: FranchiseData | undefined;

export function loadFranchiseData(): FranchiseData {
  cached ??= loadFranchise();
  return cached;
}

/** The value of a result that must be ok. */
export function must<T>(r: FranchiseResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

export function newFranchise(data: FranchiseData, seed: number, userTeam = "T00", draftSlot: number | "random" = "random"): FranchiseState {
  return must(createFranchise(data, { seed, userTeam, draftSlot }));
}

/** A franchise drafted start to finish by the AI policy, the user's picks included (auto-draft on). */
export function allAiDraft(data: FranchiseData, seed: number): FranchiseState {
  const start = newFranchise(data, seed);
  return must(runDraft({ ...start, draft: { ...start.draft, autoDraft: true } }, data)).state;
}

// ---------------------------------------------------------------- shared checks and scripted users

/** Every way a finished draft can be wrong (B3, B9). Empty when it is right. */
export function draftProblems(state: FranchiseState, data: FranchiseData): string[] {
  const out: string[] = [];
  const limits = rosterLimits(data);
  const index = playerIndex(state.players);
  const size = data.roster.rosterSize;
  if (state.phase !== "regularSeason") out.push(`phase is ${state.phase}`);
  if (state.draft.picks.length !== size * state.teams.length) out.push(`${state.draft.picks.length} picks`);
  const owner = new Map<string, string>();
  for (const team of state.teams) {
    const ids = state.rosters[team.id] ?? [];
    if (ids.length !== size) out.push(`${team.id} has ${ids.length} players`);
    const counts = Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>;
    const worn = new Set<number>();
    for (const id of ids) {
      const p = index.get(id);
      if (p === undefined) {
        out.push(`${team.id} holds unknown ${id}`);
        continue;
      }
      if (owner.has(id)) out.push(`${id} is on ${owner.get(id)} and ${team.id}`);
      owner.set(id, team.id);
      counts[p.position]++;
      const n = state.numbers[id];
      if (n === undefined) out.push(`${id} has no number`);
      else {
        if (worn.has(n)) out.push(`${team.id} has two players wearing ${n}`);
        worn.add(n);
        if (!jerseyNumberAllowed(data.game.engine.rules, p.position, n)) out.push(`${id} (${p.position}) wears ${n}`);
      }
    }
    for (const p of POSITIONS) if (counts[p] < limits[p].min || counts[p] > limits[p].max) out.push(`${team.id} has ${counts[p]} ${p}`);
  }
  if (Object.keys(state.numbers).length !== owner.size) out.push("a player without a team has a number");
  return out;
}

/** The same data with a pool of exactly the rosters' targets, where rule 4 decides late picks. */
export const surplusZero = (data: FranchiseData): FranchiseData => ({ ...data, pool: { ...data.pool, surplus: 0 } });

/** No surplus and no need bonus either: nothing but legality shapes the rosters. */
export const noNeedPool = (data: FranchiseData): FranchiseData => ({
  ...surplusZero(data),
  draftAi: { ...data.draftAi, slotNeed: Object.fromEntries(POSITIONS.map((p): [Position, readonly number[]] => [p, data.draftAi.slotNeed[p].map(() => 0)])) as Record<Position, readonly number[]> },
});

/** Picks for the user from the legal set: the ids in board order, their positions, and the user's counts. */
export type UserScript = (legal: readonly string[], positionOf: (id: string) => Position, counts: Readonly<Record<Position, number>>) => string;

/** A whole draft with a scripted user. Throws if any team, the user included, is ever left without a legal pick. */
export function draftWithUser(data: FranchiseData, seed: number, script: UserScript, userTeam = "T00", draftSlot: number | "random" = "random"): FranchiseState {
  let state = newFranchise(data, seed, userTeam, draftSlot);
  const index = playerIndex(state.players);
  const positionOf = (id: string): Position => (index.get(id) as { position: Position }).position;
  while (state.phase === "draft") {
    state = must(runDraft(state, data)).state;
    if (state.phase !== "draft") break;
    const legal = must(legalPicks(state, data));
    if (legal.legal.length === 0) throw new Error(`seed ${seed}: the user has no legal pick at pick ${state.draft.picks.length + 1}`);
    const counts = Object.fromEntries(POSITIONS.map((p) => [p, legal.positions[p].count])) as Record<Position, number>;
    state = must(makePick(state, data, script(legal.legal, positionOf, counts)));
  }
  return state;
}

/** B4: uniformly at random among the legal picks, from its own seeded generator. */
export function randomUser(seed: number): UserScript {
  const rng = Rng.fromSeed(seed);
  return (legal) => legal[Math.floor(rng.nextFloat() * legal.length)] as string;
}

/** B4: always the position the user already has most of (ties by position order), its best legal player. */
export const mostOfUser: UserScript = (legal, positionOf, counts) => {
  const open = new Set(legal.map(positionOf));
  const position = [...POSITIONS].filter((p) => open.has(p)).sort((a, b) => counts[b] - counts[a])[0] as Position;
  return legal.find((id) => positionOf(id) === position) as string;
};

const positionsOf = (legal: readonly string[], positionOf: (id: string) => Position): Position[] => [...new Set(legal.map(positionOf))];
const bestAt = (legal: readonly string[], positionOf: (id: string) => Position, position: Position): string => legal.find((id) => positionOf(id) === position) as string;

/** B4's adversaries: users who draft against the pool, the limits or sense. Each makes a fresh script, as some keep a generator. */
export const ADVERSARIES: Readonly<Record<string, (data: FranchiseData, seed: number) => UserScript>> = {
  /** The legal position with the fewest players left. */
  "scarcest position": () => (legal, positionOf) => {
    const left = Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>;
    for (const id of legal) left[positionOf(id)]++;
    const position = positionsOf(legal, positionOf).sort((a, b) => left[a] - left[b] || POSITIONS.indexOf(a) - POSITIONS.indexOf(b))[0] as Position;
    return bestAt(legal, positionOf, position);
  },
  /** The position furthest over its target. */
  "over-stacking": (data) => (legal, positionOf, counts) => {
    const limits = rosterLimits(data);
    const position = positionsOf(legal, positionOf).sort((a, b) => counts[b] - limits[b].target - (counts[a] - limits[a].target) || POSITIONS.indexOf(a) - POSITIONS.indexOf(b))[0] as Position;
    return bestAt(legal, positionOf, position);
  },
  /** Every offensive position to its maximum before any defender. */
  "offense first": (data) => (legal, positionOf) => {
    const order = [...data.roster.units.offense, ...data.roster.units.defense, ...data.roster.units.specialTeams];
    const open = new Set(legal.map(positionOf));
    return bestAt(legal, positionOf, order.find((p) => open.has(p)) as Position);
  },
  "worst player": () => (legal) => legal[legal.length - 1] as string,
  "kickers and punters": () => (legal, positionOf) => legal.find((id) => positionOf(id) === "K" || positionOf(id) === "P") ?? (legal[0] as string),
  "random position": (_data, seed) => {
    const rng = Rng.fromSeed(seed);
    return (legal, positionOf) => {
      const open = positionsOf(legal, positionOf);
      return bestAt(legal, positionOf, open[Math.floor(rng.nextFloat() * open.length)] as Position);
    };
  },
};

/** B4: auto-draft switched on and off at random points, on the clock and off it, with a JSON round trip each time. Picks at random when on the clock with it off. */
export function draftToggling(data: FranchiseData, seed: number, userTeam = "T00", draftSlot: number | "random" = "random"): FranchiseState {
  const rng = Rng.fromSeed(seed);
  const pick = randomUser(seed + 1);
  let state = newFranchise(data, seed, userTeam, draftSlot);
  const index = playerIndex(state.players);
  while (state.phase === "draft") {
    state = JSON.parse(JSON.stringify(must(setAutoDraft(state, rng.nextFloat() < 0.5)))) as FranchiseState;
    const run = must(runDraft(state, data, { maxPicks: 1 + Math.floor(rng.nextFloat() * 40), through: rng.nextFloat() < 0.5 ? "end" : "nextUserPick" }));
    state = run.state;
    if (state.phase !== "draft" || state.draft.autoDraft || state.draft.slots[state.draft.picks.length] !== userTeam) continue;
    const legal = must(legalPicks(state, data));
    const counts = Object.fromEntries(POSITIONS.map((p) => [p, legal.positions[p].count])) as Record<Position, number>;
    state = must(makePick(state, data, pick(legal.legal, (id) => (index.get(id) as { position: Position }).position, counts)));
  }
  return state;
}
