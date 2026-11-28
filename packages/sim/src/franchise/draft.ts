// The league-wide snake draft (M4 milestone B). Every function takes the franchise state and
// returns a new one, or a typed error with the state untouched (Locked 8). Nothing here keeps
// generator state: the AI's profiles and the jersey numbers come from streams derived from the
// franchise seed and ids already in the state, so a draft saved to JSON at any pick and
// resumed ends exactly as an uninterrupted one.
//
// A pick is legal when, afterwards, (1) the team's count at the position is at most its max,
// (2) the team still has enough picks left to reach every position minimum, (3) the pool
// still holds enough players at every position to cover every team's open minimums, and (4) a
// completion exists: every team can still fill the slots it owns from the pool with every position
// inside its limits (completion.ts, exact). The first rule that blocks is the one named. All four
// depend only on the player's position, so the rules are worked out per position.

import { POSITIONS } from "../../../shared/src/engine";
import type { Position } from "../../../shared/src/engine";
import type {
  AutoPickPreview,
  AvailablePlayer,
  DraftAiInput,
  DraftNextPick,
  DraftPick,
  DraftPickEntry,
  DraftPositionRule,
  DraftProfile,
  DraftRule,
  DraftTeamBoard,
  DraftView,
  FranchiseData,
  FranchiseResult,
  FranchiseState,
  LegalPicks,
  PickedBy,
  PoolPlayer,
  TeamId,
} from "../../../shared/src/franchise";
import { canTakeExtra, findCompletion, takeExtra } from "./completion";
import type { Completion } from "./completion";
import { autoPickProfile, chooseAiPick, chooseUserAutoPick, draftProfiles } from "./draft-ai";
import type { AutoChoice } from "./draft-ai";
import { roundOf } from "./draft-order";
import { err, ok } from "./errors";
import { rosterLimits } from "./limits";
import type { RosterLimits } from "./limits";
import { assignRosterNumbers } from "./numbers";
import { byOverallThenId, overalls } from "./overall";
import { playerIndex } from "./pool";
import { STREAMS, stream } from "./streams";
import { depthChart, leagueSummaries } from "./summary";

interface Candidate {
  readonly id: string;
  readonly position: Position;
  readonly overall: number;
  readonly player: PoolPlayer;
}

/** The whole pool in board order (overall descending, ties by id). Cached per players array and weights. */
const boardCache = new WeakMap<readonly PoolPlayer[], { readonly weights: FranchiseData["overallWeights"]; readonly board: readonly Candidate[] }>();
function fullBoard(state: FranchiseState, data: FranchiseData): readonly Candidate[] {
  const hit = boardCache.get(state.players);
  if (hit !== undefined && hit.weights === data.overallWeights) return hit.board;
  const ovr = overalls(state.players, data.overallWeights);
  const board = state.players.map((player) => ({ id: player.id, position: player.position, overall: ovr.get(player.id) ?? 0, player })).sort(byOverallThenId);
  boardCache.set(state.players, { weights: data.overallWeights, board });
  return board;
}

/** A working copy of the draft: counts kept as picks land, so a run of picks never rescans the state. */
interface Work {
  readonly state: FranchiseState;
  readonly data: FranchiseData;
  readonly limits: RosterLimits;
  /** Per team, the picks it still owns in the stored slot list (not the roster size, which the data may have changed since). */
  readonly left: number[];
  readonly teamIndex: ReadonlyMap<TeamId, number>;
  /** Per team (league order), players held by position. */
  readonly counts: Record<Position, number>[];
  /** Pool players left by position. */
  readonly avail: Record<Position, number>;
  /** Open starting slots across the league, by position. */
  readonly open: Record<Position, number>;
  /** One way the draft can still end, kept as picks land, or null when there is none. */
  readonly completion: Completion | null;
  /** Available players in board order. */
  readonly board: Candidate[];
  readonly picks: DraftPick[];
  readonly rosters: Record<TeamId, string[]>;
}

function zeros(): Record<Position, number> {
  return Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>;
}

function openWork(state: FranchiseState, data: FranchiseData): Work {
  const limits = rosterLimits(data);
  const index = playerIndex(state.players);
  const drafted = new Set<string>();
  const counts = state.teams.map(() => zeros());
  const rosters: Record<TeamId, string[]> = {};
  state.teams.forEach((t, i) => {
    const ids = [...(state.rosters[t.id] ?? [])];
    rosters[t.id] = ids;
    for (const id of ids) {
      drafted.add(id);
      const p = index.get(id);
      if (p !== undefined) (counts[i] as Record<Position, number>)[p.position]++;
    }
  });
  const board = fullBoard(state, data).filter((c) => !drafted.has(c.id));
  const avail = zeros();
  for (const c of board) avail[c.position]++;
  const open = zeros();
  for (const c of counts) for (const p of POSITIONS) open[p] += Math.max(0, limits[p].min - c[p]);
  const teamIndex = new Map(state.teams.map((t, i) => [t.id, i]));
  const left = state.teams.map(() => 0);
  for (let i = state.draft.picks.length; i < state.draft.slots.length; i++) {
    const t = teamIndex.get(state.draft.slots[i] as TeamId);
    if (t !== undefined) left[t] = (left[t] as number) + 1;
  }
  return {
    state,
    data,
    limits,
    left,
    teamIndex,
    counts,
    avail,
    open,
    completion: findCompletion(limits, counts, left, avail),
    board,
    picks: [...state.draft.picks],
    rosters,
  };
}

function totalPicks(state: FranchiseState): number {
  return state.draft.slots.length;
}

/** What a pick at each position would mean for one team as the draft stands. */
function positionRules(w: Work, team: number): Record<Position, DraftPositionRule> {
  const counts = w.counts[team] as Record<Position, number>;
  let required = 0;
  for (const p of POSITIONS) required += Math.max(0, w.limits[p].min - counts[p]);
  const picksLeft = w.left[team] as number;
  const out = {} as Record<Position, DraftPositionRule>;
  for (const [p, position] of POSITIONS.entries()) {
    const { min, target, max } = w.limits[position];
    const count = counts[position];
    const fills = count < min ? 1 : 0;
    let blockedBy: DraftRule | null = null;
    if (count + 1 > max) blockedBy = "positionMax";
    else if (picksLeft - 1 < required - fills) blockedBy = "minimumsReachable";
    else if (w.avail[position] - 1 < w.open[position] - fills) blockedBy = "poolCoversMinimums";
    // A pick that fills a minimum keeps every completion (completion.ts), so only extras are checked.
    else if (w.completion === null || (fills === 0 && !canTakeExtra(w.completion, team, p))) blockedBy = "completionExists";
    out[position] = { position, count, min, target, max, use: count < min ? "starter" : count < target ? "depth" : "extra", legal: blockedBy === null && picksLeft > 0, blockedBy, available: w.avail[position] };
  }
  return out;
}

function teamBoard(w: Work, team: number): DraftTeamBoard {
  const positions = positionRules(w, team);
  const mustFill = POSITIONS.filter((p) => positions[p].count < positions[p].min).map((p) => ({ position: p, count: positions[p].min - positions[p].count }));
  const picksMade = POSITIONS.reduce((s, p) => s + positions[p].count, 0);
  const requiredLeft = mustFill.reduce((s, m) => s + m.count, 0);
  const picksLeft = w.left[team] as number;
  return { teamId: (w.state.teams[team] as FranchiseState["teams"][number]).id, picksMade, picksLeft, positions, mustFill, requiredLeft, everyPickMustFill: requiredLeft > 0 && picksLeft === requiredLeft };
}

/**
 * Why no set of picks can end this draft with every roster inside its limits, or null when one can.
 * Legal picks keep a completion, so only a save made under another roster.json can have none.
 */
function cannotFinish(w: Work): FranchiseResult<never> | null {
  for (const [i, t] of w.state.teams.entries()) {
    const counts = w.counts[i] as Record<Position, number>;
    let required = 0;
    let spare = 0;
    for (const p of POSITIONS) {
      const { min, max } = w.limits[p];
      if (counts[p] > max) return err({ code: "draftCannotFinish", rule: "positionMax", teamId: t.id, position: p });
      required += Math.max(0, min - counts[p]);
      spare += max - Math.max(min, counts[p]);
    }
    const left = w.left[i] as number;
    if (left < required) return err({ code: "draftCannotFinish", rule: "minimumsReachable", teamId: t.id, position: null });
    if (left - required > spare) return err({ code: "draftCannotFinish", rule: "positionMax", teamId: t.id, position: null });
  }
  for (const p of POSITIONS) if (w.avail[p] < w.open[p]) return err({ code: "draftCannotFinish", rule: "poolCoversMinimums", teamId: null, position: p });
  if (w.completion === null) return err({ code: "draftCannotFinish", rule: "completionExists", teamId: null, position: null });
  return null;
}

/** Whether a saved draft can still end with every roster legal under this data (a load checks it; every pick action does too). */
export function checkDraft(state: FranchiseState, data: FranchiseData): FranchiseResult<true> {
  if (state.phase !== "draft") return ok(true);
  return cannotFinish(openWork(state, data)) ?? ok(true);
}

/** Where a candidate sits on the board (binary search on board order), or -1. */
function boardIndex(board: readonly Candidate[], c: { readonly id: string; readonly overall: number }): number {
  let lo = 0;
  let hi = board.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cmp = byOverallThenId(board[mid] as Candidate, c);
    if (cmp === 0) return mid;
    if (cmp < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

function entryOf(state: FranchiseState, teams: number, pick: DraftPick, player: Pick<Candidate, "position" | "overall"> & { readonly name: string }): DraftPickEntry {
  return { overallPick: pick.overallPick, ...roundOf(pick.overallPick, teams), teamId: state.draft.slots[pick.overallPick - 1] as TeamId, playerId: pick.playerId, name: player.name, position: player.position, overall: player.overall, by: pick.by };
}

/** Lands one pick in the working copy. The caller has checked it is legal. */
function applyPick(w: Work, team: number, at: number, by: PickedBy): DraftPickEntry {
  const c = w.board[at] as Candidate;
  w.board.splice(at, 1);
  const counts = w.counts[team] as Record<Position, number>;
  if (counts[c.position] < w.limits[c.position].min) w.open[c.position]--;
  else takeExtra(w.completion as Completion, team, POSITIONS.indexOf(c.position));
  counts[c.position]++;
  w.avail[c.position]--;
  w.left[team] = (w.left[team] as number) - 1;
  const teamId = (w.state.teams[team] as FranchiseState["teams"][number]).id;
  (w.rosters[teamId] as string[]).push(c.id);
  const pick: DraftPick = { overallPick: w.picks.length + 1, playerId: c.id, by };
  w.picks.push(pick);
  return entryOf(w.state, w.state.teams.length, pick, { name: c.player.name, position: c.position, overall: c.overall });
}

/** The state after the working copy's picks. After the last pick: numbers per team, and the phase moves on. */
function closeWork(w: Work): FranchiseResult<FranchiseState> {
  const { state } = w;
  const draft = { ...state.draft, picks: w.picks };
  const next: FranchiseState = { ...state, rosters: w.rosters, draft };
  if (w.picks.length < totalPicks(state)) return ok(next);
  let numbers: Record<string, number> = {};
  for (let i = 0; i < state.teams.length; i++) {
    const teamId = (state.teams[i] as FranchiseState["teams"][number]).id;
    const chart = depthChart(next, w.data, teamId);
    const made = assignRosterNumbers(POSITIONS.flatMap((p) => chart[p]), w.data.game.engine.rules, stream(state.seed, STREAMS.numbers, i));
    if (!made.ok) return err({ code: "noJerseyNumber", teamId, playerId: made.playerId, position: made.position });
    numbers = { ...numbers, ...made.numbers };
  }
  // Milestone C generates the schedule here, before the phase moves.
  return ok({ ...next, numbers, phase: "regularSeason" });
}

function aiInput(w: Work, team: number): DraftAiInput {
  return { available: w.board, onClock: { positions: positionRules(w, team) } };
}

function teamAt(w: Work, pickIndex: number): number {
  return w.teamIndex.get(w.state.draft.slots[pickIndex] as TeamId) as number;
}

/** The state is in the draft with a pick still to make, or the typed reason it is not. */
function draftOpen(state: FranchiseState): FranchiseResult<true> {
  if (state.phase !== "draft") return err({ code: "notDraftPhase", phase: state.phase });
  if (state.draft.picks.length >= totalPicks(state)) return err({ code: "draftComplete" });
  return ok(true);
}

function userOnClock(state: FranchiseState): FranchiseResult<true> {
  const open = draftOpen(state);
  if (!open.ok) return open;
  const onClock = state.draft.slots[state.draft.picks.length] as TeamId;
  if (onClock !== state.settings.userTeam) return err({ code: "notOnClock", onClock, userTeam: state.settings.userTeam });
  return ok(true);
}

/**
 * The legal set for a team as the draft stands (the team on the clock by default): the rule per
 * position, the legal player ids in board order, and for each other player the rule that blocks him.
 */
export function legalPicks(state: FranchiseState, data: FranchiseData, teamId?: TeamId): FranchiseResult<LegalPicks> {
  const open = draftOpen(state);
  if (!open.ok) return open;
  const w = openWork(state, data);
  const id = teamId ?? (state.draft.slots[w.picks.length] as TeamId);
  const team = w.teamIndex.get(id);
  if (team === undefined) return err({ code: "unknownTeam", teamId: String(id) });
  const positions = positionRules(w, team);
  const legal: string[] = [];
  const blocked: { playerId: string; position: Position; rule: DraftRule }[] = [];
  for (const c of w.board) {
    const rule = positions[c.position].blockedBy;
    if (rule === null) legal.push(c.id);
    else blocked.push({ playerId: c.id, position: c.position, rule });
  }
  return ok({ teamId: id, positions, legal, blocked });
}

/** The user drafts `playerId`. Out of turn, an unknown or drafted player, or a blocked pick is a typed error. */
export function makePick(state: FranchiseState, data: FranchiseData, playerId: string): FranchiseResult<FranchiseState> {
  const turn = userOnClock(state);
  if (!turn.ok) return turn;
  const player = playerIndex(state.players).get(playerId);
  if (player === undefined) return err({ code: "unknownPlayer", playerId: String(playerId) });
  const w = openWork(state, data);
  const stuck = cannotFinish(w);
  if (stuck !== null) return stuck;
  const at = boardIndex(w.board, { id: playerId, overall: overalls(state.players, data.overallWeights).get(playerId) ?? 0 });
  if (at < 0) return err({ code: "alreadyDrafted", playerId });
  const team = teamAt(w, w.picks.length);
  const rule = positionRules(w, team)[player.position].blockedBy;
  if (rule !== null) return err({ code: "illegalPick", playerId, position: player.position, rule });
  applyPick(w, team, at, "user");
  return closeWork(w);
}

function autoChoice(w: Work, team: number): AutoChoice | null {
  const { draftAi } = w.data;
  return chooseUserAutoPick(aiInput(w, team), w.state.draft.targets, draftAi, autoPickProfile(draftAi, w.state.seed, team));
}

/** The user's pick is made for him: a usable target first, else the AI policy's pick for his team. */
export function autoPick(state: FranchiseState, data: FranchiseData): FranchiseResult<{ readonly state: FranchiseState; readonly pick: DraftPickEntry }> {
  const turn = userOnClock(state);
  if (!turn.ok) return turn;
  const w = openWork(state, data);
  const stuck = cannotFinish(w);
  if (stuck !== null) return stuck;
  const team = teamAt(w, w.picks.length);
  const choice = autoChoice(w, team);
  if (choice === null) return err({ code: "noLegalPick", teamId: state.settings.userTeam, overallPick: w.picks.length + 1 });
  const pick = applyPick(w, team, boardIndex(w.board, { id: choice.playerId, overall: choice.overall }), "auto");
  const closed = closeWork(w);
  return closed.ok ? ok({ state: closed.value, pick }) : closed;
}

/** The first pick the user owns at or after 0-based `from`, as a 0-based index, or -1. */
function userPickFrom(state: FranchiseState, from: number): number {
  const { slots } = state.draft;
  for (let i = from; i < slots.length; i++) if (slots[i] === state.settings.userTeam) return i;
  return -1;
}

/**
 * The player the user's auto-pick would take as the board stands, and why, from the factors the
 * pick used only. On the clock it is exactly what `autoPick` then drafts. Off the clock it is the
 * pick as the board stands. Null when the user has no pick left or no legal pick.
 */
export function autoPickPreview(state: FranchiseState, data: FranchiseData): AutoPickPreview | null {
  if (!draftOpen(state).ok) return null;
  const at = userPickFrom(state, state.draft.picks.length);
  if (at < 0) return null;
  const w = openWork(state, data);
  const team = w.teamIndex.get(state.settings.userTeam) as number;
  const choice = autoChoice(w, team);
  if (choice === null) return null;
  const { count, min, target } = positionRules(w, team)[choice.position];
  const name = (playerIndex(state.players).get(choice.playerId) as PoolPlayer).name;
  return { ...choice, name, userOnClock: at === w.picks.length, overallPick: at + 1, count, min, target, neededToStart: Math.max(0, min - count), neededToTarget: Math.max(0, target - count) };
}

/** Auto-draft on or off. It can be switched at any point of the draft, on the clock or not. */
export function setAutoDraft(state: FranchiseState, on: boolean): FranchiseResult<FranchiseState> {
  if (state.phase !== "draft") return err({ code: "notDraftPhase", phase: state.phase });
  return ok({ ...state, draft: { ...state.draft, autoDraft: on === true } });
}

/** Marks or unmarks an undrafted pool player as a target of the user's. A target drafted later stays in the list. */
export function setTarget(state: FranchiseState, playerId: string, on: boolean): FranchiseResult<FranchiseState> {
  if (state.phase !== "draft") return err({ code: "notDraftPhase", phase: state.phase });
  if (!playerIndex(state.players).has(playerId)) return err({ code: "unknownPlayer", playerId: String(playerId) });
  if (state.draft.picks.some((p) => p.playerId === playerId)) return err({ code: "alreadyDrafted", playerId });
  const without = state.draft.targets.filter((id) => id !== playerId);
  return ok({ ...state, draft: { ...state.draft, targets: on === true ? [...without, playerId] : without } });
}

export interface RunDraftOptions {
  /** Stop after this many picks (the worker runs a long stretch in slices, so it can be stopped between them). */
  readonly maxPicks?: number;
  /**
   * With auto-draft on: "end" (the default) runs out the draft; "nextUserPick" makes the user's pick
   * if he is on the clock, then AI picks, and stops when he is on the clock again. With it off the
   * run always stops at the user's turn.
   */
  readonly through?: (typeof RUN_THROUGH)[number];
}

const RUN_THROUGH = ["end", "nextUserPick"] as const;

/**
 * Makes picks until the user is on the clock, or to the end with auto-draft on, and returns them
 * in order. AI teams use the AI policy; with auto-draft on the user's picks use the auto-pick
 * policy. A team with no legal pick is a typed error and no pick of the run is kept.
 */
export function runDraft(state: FranchiseState, data: FranchiseData, options: RunDraftOptions = {}): FranchiseResult<{ readonly state: FranchiseState; readonly picks: readonly DraftPickEntry[] }> {
  if (state.phase !== "draft") return err({ code: "notDraftPhase", phase: state.phase });
  const limit = options.maxPicks ?? Number.POSITIVE_INFINITY;
  if (!(limit === Number.POSITIVE_INFINITY || (Number.isInteger(limit) && limit >= 0))) return err({ code: "badLimit", maxPicks: options.maxPicks });
  const through = options.through ?? "end";
  if (!RUN_THROUGH.includes(through)) return err({ code: "badThrough", through });
  const total = totalPicks(state);
  const w = openWork(state, data);
  const stuck = cannotFinish(w);
  if (stuck !== null) return stuck;
  const profiles = draftProfiles(data.draftAi, state.seed, state.teams.length);
  const user = w.teamIndex.get(state.settings.userTeam);
  const made: DraftPickEntry[] = [];
  while (w.picks.length < total && made.length < limit) {
    const team = teamAt(w, w.picks.length);
    const isUser = team === user;
    if (isUser && (!state.draft.autoDraft || (through === "nextUserPick" && made.length > 0))) break;
    const choice = isUser ? autoChoice(w, team) : chooseAiPick(aiInput(w, team), data.draftAi, profiles[team] as DraftProfile);
    if (choice === null) return err({ code: "noLegalPick", teamId: state.draft.slots[w.picks.length] as TeamId, overallPick: w.picks.length + 1 });
    made.push(applyPick(w, team, boardIndex(w.board, { id: choice.playerId, overall: choice.overall }), isUser ? "auto" : "ai"));
  }
  if (made.length === 0) return ok({ state, picks: made });
  const closed = closeWork(w);
  return closed.ok ? ok({ state: closed.value, picks: made }) : closed;
}

/** Every pick after overall pick `sincePick` (0 for all), in order. */
export function draftLog(state: FranchiseState, data: FranchiseData, sincePick = 0): DraftPickEntry[] {
  const index = playerIndex(state.players);
  const ovr = overalls(state.players, data.overallWeights);
  return state.draft.picks.slice(Math.max(0, sincePick)).map((pick) => {
    const p = index.get(pick.playerId) as PoolPlayer;
    return entryOf(state, state.teams.length, pick, { name: p.name, position: p.position, overall: ovr.get(p.id) ?? 0 });
  });
}

/**
 * The board sorted by overall or by one rating, highest first. Always a total order: ties go to
 * the higher overall, then the lower id, so a rank number never flickers. A player without the
 * rating (another position's skill) sorts last. Returns a new array.
 */
export function sortAvailable<T extends Pick<AvailablePlayer, "id" | "overall" | "ratings" | "skills">>(players: readonly T[], by: string = "overall"): T[] {
  const value = (p: T): number => (by === "overall" ? p.overall : ((p.ratings as Readonly<Record<string, number>>)[by] ?? p.skills[by] ?? -1));
  return [...players].sort((a, b) => value(b) - value(a) || byOverallThenId(a, b));
}

/** Everything the draft room shows. Built from the state alone, so it is never stale. */
export function draftView(state: FranchiseState, data: FranchiseData): DraftView {
  const w = openWork(state, data);
  const teams = state.teams.length;
  const total = totalPicks(state);
  const now = w.picks.length;
  const done = state.phase !== "draft" || now >= total;
  const userTeam = state.settings.userTeam;
  const user = w.teamIndex.get(userTeam) as number;
  const onClock = done ? null : teamBoard(w, teamAt(w, now));
  const userBoard = teamBoard(w, user);
  const rank = zeros();
  // The user's players by position: a candidate's depth rank is one more than how many are ahead of him.
  const mine = Object.fromEntries(POSITIONS.map((p) => [p, [] as Candidate[]])) as Record<Position, Candidate[]>;
  const held = new Set(w.rosters[userTeam]);
  for (const c of fullBoard(state, data)) if (held.has(c.id)) mine[c.position].push(c);
  const available: AvailablePlayer[] = w.board.map((c) => {
    const rule = onClock?.positions[c.position];
    return { ...c.player, overall: c.overall, positionRank: ++rank[c.position], legal: rule?.legal ?? false, blockedBy: rule?.blockedBy ?? null, use: userBoard.positions[c.position].use, depthRank: 1 + mine[c.position].filter((m) => byOverallThenId(m, c) < 0).length };
  });
  const onBoard = new Set(w.board.map((c) => c.id));
  const nextTurn = done ? -1 : userPickFrom(state, now);
  const after = done ? -1 : userPickFrom(state, now + 1);
  const userNextPick: DraftNextPick | null = after < 0 ? null : { overallPick: after + 1, ...roundOf(after + 1, teams), picksAway: after - now, backToBack: nextTurn === now && after === now + 1 };
  const common = {
    seed: state.seed,
    rounds: total / teams,
    totalPicks: total,
    userTeam,
    picksUntilUser: nextTurn < 0 ? null : nextTurn - now,
    userNextPick,
    userPicksMade: (w.rosters[userTeam] as string[]).length,
    userPicksTotal: state.draft.slots.filter((t) => t === userTeam).length,
    autoDraft: state.draft.autoDraft,
    slots: state.draft.slots,
    picks: draftLog(state, data),
    available,
    availableCount: available.length,
    legal: available.filter((p) => p.legal).map((p) => p.id),
    user: { ...userBoard, targets: state.draft.targets, targetsAvailable: state.draft.targets.filter((id) => onBoard.has(id)) },
    summaries: leagueSummaries(state, data),
  };
  if (onClock === null) return { ...common, done: true, overallPick: null, round: null, pickInRound: null, onClockTeam: null, userOnClock: false, onClock: null };
  return { ...common, done: false, overallPick: now + 1, ...roundOf(now + 1, teams), onClockTeam: onClock.teamId, userOnClock: onClock.teamId === userTeam, onClock };
}
