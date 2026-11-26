// Helpers for the spec-derived franchise tests (docs/specs/m4-franchise-core.md, milestones A and B).
// Everything here is written from the spec, not from packages/sim/src/franchise: the data loader,
// an independent overall, an independent legality oracle, a state forger that writes picks
// straight into a state (so fixtures do not depend on the draft code), and scripted users.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { loadGameData, REPO } from "../../../../scripts/game/data";
import { BASE_RATINGS, POSITION_SKILLS, POSITIONS } from "../../../shared/src/engine";
import type { BaseRating, Position } from "../../../shared/src/engine";
import { parseFranchiseData } from "../../../shared/src/franchise-schema";
import type { DraftAiConfig, DraftRule, FranchiseData, FranchiseErrorCode, FranchiseResult, FranchiseState, PoolPlayer, TeamId } from "../../../shared/src/franchise";
import type { GameData } from "../../../shared/src/types";
import { createFranchise, legalPicks, makePick, runDraft } from "../../src/franchise";

// Whole drafts are played in many of these tests; leave room for a slow CI machine.
vi.setConfig({ testTimeout: 180_000 });

export { POSITIONS, BASE_RATINGS, POSITION_SKILLS };
export type { Position };

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(REPO, path), "utf8")) as unknown;
}

export interface RawFiles {
  league: Record<string, unknown>;
  roster: Record<string, unknown>;
  pool: Record<string, unknown>;
  draftAi: Record<string, unknown>;
  overallWeights: unknown;
}

export function rawFiles(): RawFiles {
  return {
    league: readJson("data/franchise/league.json") as Record<string, unknown>,
    roster: readJson("data/franchise/roster.json") as Record<string, unknown>,
    pool: readJson("data/franchise/pool.json") as Record<string, unknown>,
    draftAi: readJson("data/franchise/draft-ai.json") as Record<string, unknown>,
    overallWeights: (readJson("data/ui/templates.json") as { overallWeights: unknown }).overallWeights,
  };
}

let gameCache: GameData | undefined;
export function gameData(): GameData {
  gameCache ??= loadGameData();
  return gameCache;
}

/** The data as shipped. */
export function shippedData(): FranchiseData {
  return parseFranchiseData(rawFiles(), gameData());
}

/** The spec's numbers (Player pool section): minimums are today's 33 slot needs, targets and maxes as proposed. */
export const SPEC_MIN: Readonly<Record<Position, number>> = { QB: 1, RB: 1, WR: 4, TE: 3, OL: 6, DL: 5, LB: 4, CB: 4, S: 3, K: 1, P: 1 };
export const SPEC_TARGET: Readonly<Record<Position, number>> = { QB: 3, RB: 4, WR: 6, TE: 4, OL: 9, DL: 8, LB: 7, CB: 6, S: 4, K: 1, P: 1 };
export const SPEC_MAX: Readonly<Record<Position, number>> = { QB: 4, RB: 6, WR: 8, TE: 5, OL: 11, DL: 10, LB: 9, CB: 8, S: 6, K: 2, P: 2 };

function rosterFile(rosterSize: number, target: Readonly<Record<Position, number>>, max: Readonly<Record<Position, number>>): Record<string, unknown> {
  return {
    ...rawFiles().roster,
    rosterSize,
    positions: Object.fromEntries(POSITIONS.map((p) => [p, { target: target[p], max: max[p] }])),
  };
}

/** The shipped need list cut or padded with zeros to the fixture's targets (Revision 2026-11-24: slotNeed has one bonus per slot up to the target). */
export function fitSlotNeed(target: Readonly<Record<Position, number>>): Record<Position, number[]> {
  const shipped = rawFiles().draftAi["slotNeed"] as Record<Position, number[]>;
  return Object.fromEntries(POSITIONS.map((p) => [p, Array.from({ length: target[p] }, (_, i) => shipped[p][i] ?? 0)])) as Record<Position, number[]>;
}

/** The roster and draft-ai files for a set of targets and maximums. */
export function rosterFiles(rosterSize: number, target: Readonly<Record<Position, number>>, max: Readonly<Record<Position, number>>): { roster: Record<string, unknown>; draftAi: Record<string, unknown> } {
  return { roster: rosterFile(rosterSize, target, max), draftAi: { ...rawFiles().draftAi, slotNeed: fitSlotNeed(target) } };
}

/**
 * 32 teams, 53 players, with the roster numbers pinned to the spec's proposed values and surplus
 * 0.10, so hand-made fixtures keep their meaning if data/franchise/roster.json is retuned.
 */
export function pinnedData(): FranchiseData {
  const raw = rawFiles();
  return parseFranchiseData({ ...raw, ...rosterFiles(53, SPEC_TARGET, SPEC_MAX), pool: { ...raw.pool, surplus: 0.1 } }, gameData());
}

/** Targets of the 4-team, 37-player fixture: the minimums plus one each at QB, RB, WR and OL. */
export const SMALL_TARGET: Readonly<Record<Position, number>> = { QB: 2, RB: 2, WR: 5, TE: 3, OL: 7, DL: 5, LB: 4, CB: 4, S: 3, K: 1, P: 1 };
export const SMALL_MAX: Readonly<Record<Position, number>> = { QB: 3, RB: 3, WR: 6, TE: 4, OL: 8, DL: 6, LB: 5, CB: 5, S: 4, K: 2, P: 2 };

export function smallLeague(): Record<string, unknown> {
  return { ...rawFiles().league, conferences: [{ id: "east", name: "East Test Conference" }, { id: "west", name: "West Test Conference" }], divisions: ["Only"], teamsPerDivision: 2 };
}

/** 4 teams (2 conferences, 1 division, 2 teams each), 37 players a roster. Nothing in it is 32 or 53. */
export function smallData(): FranchiseData {
  const raw = rawFiles();
  return parseFranchiseData({ ...raw, league: smallLeague(), ...rosterFiles(37, SMALL_TARGET, SMALL_MAX), pool: { ...raw.pool, surplus: 0.1 } }, gameData());
}

/** 4 teams, 33 players: starters only (the spec's open question 2), so every pick fills a starting slot. */
export function startersOnlyData(): FranchiseData {
  const raw = rawFiles();
  return parseFranchiseData({ ...raw, league: smallLeague(), ...rosterFiles(33, SPEC_MIN, SMALL_MAX), pool: { ...raw.pool, surplus: 0.1 } }, gameData());
}

/** The same data with a hand-set AI config. */
export function withAi(data: FranchiseData, draftAi: DraftAiConfig): FranchiseData {
  return { ...data, draftAi };
}

/** No need bonus, no evaluation error, one style that changes nothing, every position worth 1 and no value curve: the spec's score is then just overall. */
export function flatAi(data: FranchiseData, positionValue?: Partial<Record<Position, number>>): DraftAiConfig {
  return {
    ...data.draftAi,
    valueCurve: undefined,
    positionValue: Object.fromEntries(POSITIONS.map((p) => [p, positionValue?.[p] ?? 1])) as Record<Position, number>,
    slotNeed: Object.fromEntries(POSITIONS.map((p) => [p, data.draftAi.slotNeed[p].map(() => 0)])) as unknown as DraftAiConfig["slotNeed"],
    evaluation: { errorSdMin: 0, errorSdMax: 0 },
    styles: { plain: { weight: 1 } },
    autoPick: { style: "plain", errorSd: 0 },
  };
}

/**
 * A value curve read the way draft-ai.json's note puts it (Kickers and punters, 2026-11-25): points
 * (overall, value) joined by straight lines. Written here from the note, not from the code: find the
 * last point at or below the overall and walk the line to the next one.
 */
export function specCurve(points: readonly (readonly [number, number])[], overall: number): number {
  let i = 0;
  while (i + 1 < points.length && (points[i + 1] as readonly [number, number])[0] <= overall) i++;
  const [o0, v0] = points[i] as readonly [number, number];
  const next = points[i + 1];
  if (next === undefined || overall <= o0) return v0;
  return v0 + ((next[1] - v0) / (next[0] - o0)) * (overall - o0);
}

// ---------------------------------------------------------------- independent limits and overall

export interface Limit {
  readonly min: number;
  readonly target: number;
  readonly max: number;
}

/**
 * Minimums worked out here from the engine's personnel data (the most players of a position any
 * formation, package, kick unit or return unit fields), targets and maxes from the roster data.
 */
export function specLimits(data: FranchiseData): Record<Position, Limit> {
  const e = data.game.engine;
  const groups = [...Object.values(e.personnel.offense), ...Object.values(e.personnel.kick), ...Object.values(e.personnel.packages), ...Object.values(e.participants.returnUnits)];
  const out = {} as Record<Position, Limit>;
  for (const p of POSITIONS) {
    let min = 0;
    for (const g of groups) min = Math.max(min, g[p] ?? 0);
    out[p] = { min, target: data.roster.positions[p].target, max: data.roster.positions[p].max };
  }
  return out;
}

/** The spec's overall: the rounded weighted mean of the ratings the position's weights name. */
export function specOverall(player: Pick<PoolPlayer, "position" | "ratings" | "skills">, weights: FranchiseData["overallWeights"]): number {
  let sum = 0;
  let total = 0;
  for (const [name, w] of Object.entries(weights[player.position] ?? {})) {
    const v = (player.ratings as Record<string, number>)[name] ?? player.skills[name];
    if (v === undefined) continue;
    sum += v * w;
    total += w;
  }
  return total === 0 ? 0 : Math.round(sum / total);
}

/** A hand-made player whose every rating is `value`, so his overall is `value` under any weights. */
export function flatPlayer(id: string, position: Position, value: number, name = `Test ${id}`): PoolPlayer {
  return {
    id,
    name,
    position,
    ratings: Object.fromEntries(BASE_RATINGS.map((r) => [r, value])) as Record<BaseRating, number>,
    skills: Object.fromEntries(POSITION_SKILLS[position].map((s) => [s, value])),
  };
}

// ---------------------------------------------------------------- reading a state by hand

export function zeros(): Record<Position, number> {
  return Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>;
}

export function positionOf(state: FranchiseState): Map<string, Position> {
  return new Map(state.players.map((p) => [p.id, p.position]));
}

/** Players a team holds, by position, counted from the roster lists. */
export function teamCounts(state: FranchiseState, teamId: TeamId): Record<Position, number> {
  const pos = positionOf(state);
  const out = zeros();
  for (const id of state.rosters[teamId] ?? []) out[pos.get(id) as Position]++;
  return out;
}

export function draftedIds(state: FranchiseState): Set<string> {
  const out = new Set<string>();
  for (const t of state.teams) for (const id of state.rosters[t.id] ?? []) out.add(id);
  return out;
}

export function undrafted(state: FranchiseState): PoolPlayer[] {
  const taken = draftedIds(state);
  return state.players.filter((p) => !taken.has(p.id));
}

/** Board order by the spec: overall descending, ties by id. */
export function boardOrder(players: readonly PoolPlayer[], weights: FranchiseData["overallWeights"]): PoolPlayer[] {
  const ovr = new Map(players.map((p) => [p.id, specOverall(p, weights)]));
  return [...players].sort((a, b) => (ovr.get(b.id) as number) - (ovr.get(a.id) as number) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Picks a team still owns in the slot list. */
export function slotsLeft(state: FranchiseState, teamId: TeamId): number {
  let n = 0;
  for (let i = state.draft.picks.length; i < state.draft.slots.length; i++) if (state.draft.slots[i] === teamId) n++;
  return n;
}

/**
 * Whether a full draft still exists, by the cut condition (Gale 1957) and not by building one. Each
 * team must end with exactly `left` more players and every position inside its limits; the pool
 * holds `avail`. With every unfilled minimum set aside, a completion exists exactly when, for every
 * set S of positions, the picks the teams can't place outside S fit in what the pool has left in S.
 */
export function completionExists(limits: readonly { readonly min: number; readonly max: number }[], counts: readonly (readonly number[])[], left: readonly number[], avail: readonly number[]): boolean {
  const n = limits.length;
  const spare = [...avail];
  const teams: { free: number; room: number[] }[] = [];
  for (let t = 0; t < counts.length; t++) {
    const c = counts[t] as readonly number[];
    let free = left[t] as number;
    const room: number[] = [];
    for (let p = 0; p < n; p++) {
      const { min, max } = limits[p] as { min: number; max: number };
      const need = Math.max(0, min - (c[p] as number));
      const r = max - (c[p] as number) - need;
      if (r < 0) return false;
      free -= need;
      spare[p] = (spare[p] as number) - need;
      room.push(r);
    }
    if (free < 0) return false;
    teams.push({ free, room });
  }
  if (spare.some((x) => x < 0)) return false;
  // Over every set S of positions, built one position at a time: sums over S without its lowest member.
  const size = 1 << n;
  const supply = new Int32Array(size);
  const demand = new Int32Array(size);
  for (let set = 1; set < size; set++) {
    const p = 31 - Math.clz32(set & -set);
    supply[set] = (supply[set & (set - 1)] as number) + (spare[p] as number);
  }
  const inside = new Int32Array(size);
  for (const t of teams) {
    const all = t.room.reduce((x, y) => x + y, 0);
    for (let set = 0; set < size; set++) {
      if (set > 0) inside[set] = (inside[set & (set - 1)] as number) + (t.room[31 - Math.clz32(set & -set)] as number);
      const outside = all - (inside[set] as number);
      if (t.free > outside) demand[set] = (demand[set] as number) + t.free - outside;
    }
  }
  for (let set = 0; set < size; set++) if ((demand[set] as number) > (supply[set] as number)) return false;
  return true;
}

interface Board {
  /** In the order of state.teams. */
  readonly counts: ReadonlyMap<TeamId, Record<Position, number>>;
  readonly left: ReadonlyMap<TeamId, number>;
  readonly pool: Record<Position, number>;
}

function boardOf(state: FranchiseState): Board {
  const pos = positionOf(state);
  const pool = zeros();
  for (const p of state.players) pool[p.position]++;
  const counts = new Map(
    state.teams.map((t) => {
      const c = zeros();
      for (const id of state.rosters[t.id] ?? []) c[pos.get(id) as Position]++;
      for (const p of POSITIONS) pool[p] -= c[p];
      return [t.id, c];
    }),
  );
  return { counts, left: new Map(state.teams.map((t) => [t.id, slotsLeft(state, t.id)])), pool };
}

function boardCompletes(board: Board, limits: Readonly<Record<Position, Limit>>, teamId: TeamId | null, position: Position | null): boolean {
  const counts = [...board.counts].map(([id, c]) => POSITIONS.map((p) => c[p] + (id === teamId && p === position ? 1 : 0)));
  const left = [...board.left].map(([id, n]) => n - (id === teamId && position !== null ? 1 : 0));
  return completionExists(POSITIONS.map((p) => limits[p]), counts, left, POSITIONS.map((p) => board.pool[p] - (p === position ? 1 : 0)));
}

/** completionExists for a state, with one more player at `position` for `teamId` (null: the state as it stands). */
export function specCompletion(state: FranchiseState, data: FranchiseData, teamId: TeamId | null, position: Position | null): boolean {
  return boardCompletes(boardOf(state), specLimits(data), teamId, position);
}

/**
 * The legality oracle, straight from the spec's rules 1 to 3 and the 2026-11-24 ruling. For each
 * position, every rule of 1 to 3 that would be broken after the team took one more player there;
 * rule 4 is listed only when none of those is, since they are named first (empty array: legal).
 */
export function specBlocked(state: FranchiseState, data: FranchiseData, teamId: TeamId): Record<Position, DraftRule[]> {
  const limits = specLimits(data);
  const board = boardOf(state);
  const { counts, pool } = board;
  const mine = counts.get(teamId) as Record<Position, number>;
  const out = {} as Record<Position, DraftRule[]>;
  for (const p of POSITIONS) {
    const rules: DraftRule[] = [];
    // (1) its count at that position is at most max
    if (mine[p] + 1 > limits[p].max) rules.push("positionMax");
    // (2) it still has enough picks left to reach every position minimum
    const picksLeftAfter = (board.left.get(teamId) as number) - 1;
    let requiredAfter = 0;
    for (const q of POSITIONS) requiredAfter += Math.max(0, limits[q].min - (mine[q] + (q === p ? 1 : 0)));
    if (picksLeftAfter < requiredAfter) rules.push("minimumsReachable");
    // (3) the pool still holds enough players at every position to cover every team's unfilled minimums
    let covered = true;
    for (const q of POSITIONS) {
      let unfilled = 0;
      for (const t of state.teams) {
        const c = (counts.get(t.id) as Record<Position, number>)[q] + (t.id === teamId && q === p ? 1 : 0);
        unfilled += Math.max(0, limits[q].min - c);
      }
      if (pool[q] - (q === p ? 1 : 0) < unfilled) covered = false;
    }
    if (!covered) rules.push("poolCoversMinimums");
    // (4) after the pick every team can still fill its owned slots inside every limit
    if (rules.length === 0 && pool[p] > 0 && !boardCompletes(board, limits, teamId, p)) rules.push("completionExists");
    out[p] = rules;
  }
  return out;
}

/** The legal player ids by the oracle, in board order. */
export function specLegalIds(state: FranchiseState, data: FranchiseData, teamId: TeamId): string[] {
  const blocked = specBlocked(state, data, teamId);
  return boardOrder(undrafted(state), data.overallWeights)
    .filter((p) => blocked[p.position].length === 0)
    .map((p) => p.id);
}

export function onClock(state: FranchiseState): TeamId | null {
  return state.draft.slots[state.draft.picks.length] ?? null;
}

// ---------------------------------------------------------------- forging states

export interface ForgeContext {
  /** 0-based index of the pick being written. */
  readonly pickIndex: number;
  readonly team: TeamId;
  /** How many picks this team has already made. */
  readonly teamPickNo: number;
  readonly isUser: boolean;
  readonly counts: Readonly<Record<Position, number>>;
}

/**
 * Writes `count` picks straight into the state, in slot order, without the draft code: each takes
 * the lowest-id undrafted player at the position `choose` names. The result has the shape the
 * spec stores (rosters in the order players joined, one pick record per slot used).
 */
export function forge(state: FranchiseState, count: number, choose: (ctx: ForgeContext) => Position): FranchiseState {
  const taken = draftedIds(state);
  const byPosition = new Map<Position, PoolPlayer[]>(POSITIONS.map((p) => [p, []]));
  for (const p of state.players) if (!taken.has(p.id)) (byPosition.get(p.position) as PoolPlayer[]).push(p);
  for (const list of byPosition.values()) list.sort((a, b) => (a.id < b.id ? -1 : 1));
  const rosters: Record<TeamId, string[]> = Object.fromEntries(state.teams.map((t) => [t.id, [...(state.rosters[t.id] ?? [])]]));
  const counts = new Map(state.teams.map((t) => [t.id, teamCounts(state, t.id)]));
  const picks = [...state.draft.picks];
  for (let k = 0; k < count; k++) {
    const pickIndex = picks.length;
    const team = state.draft.slots[pickIndex] as TeamId;
    const isUser = team === state.settings.userTeam;
    const c = counts.get(team) as Record<Position, number>;
    const position = choose({ pickIndex, team, teamPickNo: (rosters[team] as string[]).length, isUser, counts: c });
    const player = (byPosition.get(position) as PoolPlayer[]).shift();
    if (player === undefined) throw new Error(`forge: no ${position} left at pick ${pickIndex + 1}`);
    (rosters[team] as string[]).push(player.id);
    c[position]++;
    picks.push({ overallPick: pickIndex + 1, playerId: player.id, by: isUser ? "user" : "ai" });
  }
  return { ...state, rosters, draft: { ...state.draft, picks } };
}

/** A sensible filler for forged teams: every minimum in position order, then one more per position in turn up to the target. */
export function fillOrder(limits: Readonly<Record<Position, Limit>>): Position[] {
  const out: Position[] = [];
  for (const p of POSITIONS) for (let i = 0; i < limits[p].min; i++) out.push(p);
  const have = Object.fromEntries(POSITIONS.map((p) => [p, limits[p].min])) as Record<Position, number>;
  for (let added = true; added; ) {
    added = false;
    for (const p of POSITIONS) {
      if (have[p] < limits[p].target) {
        out.push(p);
        have[p]++;
        added = true;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- seeded scripted users

/** mulberry32: a small seeded generator for the scripted users, apart from the franchise streams. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface UserTurn {
  readonly state: FranchiseState;
  readonly data: FranchiseData;
  /** Legal player ids for the user, in board order (from legalPicks). */
  readonly legal: readonly string[];
  readonly counts: Readonly<Record<Position, number>>;
  readonly position: ReadonlyMap<string, Position>;
  readonly rand: () => number;
}

export type UserScript = (turn: UserTurn) => string;

export const SCRIPTS = {
  /** Uniformly random among the legal picks. */
  random: (t: UserTurn): string => t.legal[Math.floor(t.rand() * t.legal.length)] as string,
  /** Always the position it already has most of (ties to the earlier position), best player there; falls to the next position when none is legal. */
  hoard: (t: UserTurn): string => {
    const order = [...POSITIONS].sort((a, b) => t.counts[b] - t.counts[a] || POSITIONS.indexOf(a) - POSITIONS.indexOf(b));
    for (const p of order) {
      const id = t.legal.find((x) => t.position.get(x) === p);
      if (id !== undefined) return id;
    }
    return t.legal[0] as string;
  },
  /** Always the lowest overall legal player (the end of board order). */
  worst: (t: UserTurn): string => t.legal[t.legal.length - 1] as string,
  /** Kickers and punters while one is legal, then the top of the board. */
  kickers: (t: UserTurn): string => t.legal.find((x) => t.position.get(x) === "K" || t.position.get(x) === "P") ?? (t.legal[0] as string),
} satisfies Record<string, UserScript>;

export interface ScriptedDraft {
  readonly state: FranchiseState;
  /** What went wrong, or null. Kept as a value so a property test can report the seed. */
  readonly failure: string | null;
  readonly userPicks: readonly string[];
}

/**
 * Plays a whole draft: runDraft for the other teams, the script for every user turn. Stops at the
 * first typed error or empty legal set and says which.
 */
export function playDraft(data: FranchiseData, seed: number, script: UserScript, options: { userTeam?: TeamId; draftSlot?: number | "random"; onUserTurn?: (state: FranchiseState) => void } = {}): ScriptedDraft {
  const made = createFranchise(data, { seed, userTeam: options.userTeam ?? "T00", draftSlot: options.draftSlot ?? "random" });
  if (!made.ok) return { state: undefined as unknown as FranchiseState, failure: `createFranchise: ${made.error.code}`, userPicks: [] };
  let state = made.value;
  const rand = prng(seed * 7919 + 13);
  const position = positionOf(state);
  const userPicks: string[] = [];
  const total = state.draft.slots.length;
  for (let guard = 0; guard <= total + 2; guard++) {
    // The user's own pick can be the last of the draft (the last slot of an odd final round).
    if (state.draft.picks.length >= total) return { state, failure: null, userPicks };
    const run = runDraft(state, data);
    if (!run.ok) return { state, failure: `runDraft at pick ${state.draft.picks.length + 1}: ${JSON.stringify(run.error)}`, userPicks };
    state = run.value.state;
    if (state.phase !== "draft" || state.draft.picks.length >= total) return { state, failure: null, userPicks };
    if (onClock(state) !== state.settings.userTeam) return { state, failure: `runDraft stopped at pick ${state.draft.picks.length + 1} with ${String(onClock(state))} on the clock`, userPicks };
    options.onUserTurn?.(state);
    const legal = legalPicks(state, data);
    if (!legal.ok) return { state, failure: `legalPicks: ${JSON.stringify(legal.error)}`, userPicks };
    if (legal.value.legal.length === 0) return { state, failure: `user has no legal pick at pick ${state.draft.picks.length + 1}`, userPicks };
    const id = script({ state, data, legal: legal.value.legal, counts: teamCounts(state, state.settings.userTeam), position, rand });
    const picked = makePick(state, data, id);
    if (!picked.ok) return { state, failure: `makePick ${id} at pick ${state.draft.picks.length + 1}: ${JSON.stringify(picked.error)}`, userPicks };
    userPicks.push(id);
    state = picked.value;
  }
  return { state, failure: "the draft did not end", userPicks };
}

/** Every way a finished draft can break the spec's End rule, as text (empty: fine). */
export function endProblems(state: FranchiseState, data: FranchiseData): string[] {
  const limits = specLimits(data);
  const out: string[] = [];
  const seen = new Set<string>();
  const known = new Set(state.players.map((p) => p.id));
  if (state.draft.picks.length !== state.draft.slots.length) out.push(`picks ${state.draft.picks.length} of ${state.draft.slots.length}`);
  if (state.phase === "draft") out.push("phase is still draft");
  for (const t of state.teams) {
    const ids = state.rosters[t.id] ?? [];
    if (ids.length !== data.roster.rosterSize) out.push(`${t.id} has ${ids.length} players`);
    for (const id of ids) {
      if (!known.has(id)) out.push(`${t.id} holds unknown ${id}`);
      if (seen.has(id)) out.push(`${id} is on two rosters`);
      seen.add(id);
    }
    const c = teamCounts(state, t.id);
    for (const p of POSITIONS) if (c[p] < limits[p].min || c[p] > limits[p].max) out.push(`${t.id} ${p} ${c[p]} outside ${limits[p].min}..${limits[p].max}`);
  }
  return out;
}

/** Plays a scripted draft and lists what went wrong, with the seed. */
export function draftProblems(data: FranchiseData, seed: number, script: UserScript, draftSlot: number | "random"): string[] {
  const r = playDraft(data, seed, script, { draftSlot });
  if (r.failure !== null) return [`seed ${seed}: ${r.failure}`];
  return endProblems(r.state, data).map((x) => `seed ${seed}: ${x}`);
}

/** Freezes a JSON value all the way down, so any write to it throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

// ---------------------------------------------------------------- results and shortcuts

/** The value of a result, or a thrown error naming the code (a test failure, not a code path under test). */
export function value<T>(result: FranchiseResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

/** The error code of a result, or null when it succeeded. */
export function errorCode(result: FranchiseResult<unknown>): FranchiseErrorCode | null {
  return result.ok ? null : result.error.code;
}

export function create(data: FranchiseData, seed: number, draftSlot: number | "random" = "random", userTeam: TeamId = "T00"): FranchiseState {
  return value(createFranchise(data, { seed, userTeam, draftSlot }));
}

/** What a JSON save and load gives back. */
export function roundTrip<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** The same state with every player's ratings replaced by one flat value, so overalls are hand-set. */
export function withOveralls(state: FranchiseState, overallOf: (p: PoolPlayer) => number): FranchiseState {
  return { ...state, players: state.players.map((p) => flatPlayer(p.id, p.position, overallOf(p), p.name)) };
}

/** Fills every team that is not the user's by fillOrder, so forged fixtures only script the user. */
export function othersFill(data: FranchiseData, user: (ctx: ForgeContext) => Position): (ctx: ForgeContext) => Position {
  const order = fillOrder(specLimits(data));
  return (ctx) => (ctx.isUser ? user(ctx) : (order[ctx.teamPickNo] as Position));
}
