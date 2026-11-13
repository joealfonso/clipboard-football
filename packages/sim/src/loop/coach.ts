// The average coach's game-management decisions (M1 step 5): pre-snap run-off (tempo), timeouts
// and onside kicks, from the fitted tables in data/game (pipeline/game/decisions.py computes the
// same shares with the same arithmetic; data/game/golden.json pins the two together). Share
// functions take no Rng; each decision then uses one draw. Play calls stay the step 2 callers'.

import type { CallerData, CoachTables, CoachView, DecisionDim, DecisionLevel, GameConfig, KickView, Situation, SpecialTimeoutRole } from "../../../shared/src/types";
import { chooseDefenseCall } from "../caller/defense";
import { binSituation } from "../caller/bins";
import { chooseOffenseCall, type CallerMasks, type OffenseCall } from "../caller/offense";
import type { FieldGoalRange } from "../caller/range";
import { sampleIndex } from "../caller/sample";
import type { PenaltyOption } from "../game/enforce";
import { flip, other } from "../game/frame";
import type { GameState, Team } from "../game/types";
import type { Rng } from "../rng";

const PER_MILLION = 1_000_000;

export type Side = "offense" | "defense";

/** A view as plain numbers, the fields the designed bins read. */
export type DecisionFields = Readonly<Record<string, number>>;

function inCond(view: DecisionFields, c: { field: string; min?: number; max?: number }, name: string): boolean {
  const v = view[c.field];
  if (v === undefined) throw new RangeError(`${name}: the view has no field ${c.field}`);
  return (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max);
}

/** A bucket labelled null means the dimension does not apply here (step 5b): the level is skipped. */
export function labelOf(view: DecisionFields, dim: DecisionDim, name: string): string | null {
  if ("exact" in dim) {
    const v = view[dim.exact];
    if (v === undefined) throw new RangeError(`${name}: the view has no field ${dim.exact}`);
    return String(Math.trunc(v));
  }
  for (const b of dim.buckets) if (b.if.every((c) => inCond(view, c, name))) return b.label;
  throw new RangeError(`${name}: no bucket for this view`);
}

/** The cell key of one level; context dimensions (side) come from `context`. */
export function decisionKey(level: DecisionLevel, view: DecisionFields, dims: GameConfig["dimensions"], context: Readonly<Record<string, string>> = {}): string | null {
  const parts: string[] = [];
  for (const d of level.dims) {
    const c = context[d];
    if (c !== undefined) {
      parts.push(c);
      continue;
    }
    const dim = dims[d];
    if (dim === undefined) throw new RangeError(`unknown decision dimension ${d}`);
    const label = labelOf(view, dim, d);
    if (label === null) return null;
    parts.push(label);
  }
  return parts.join("|");
}

export interface Found<T> {
  readonly level: number;
  readonly key: string;
  readonly value: T;
}

function backoff<T>(levels: readonly DecisionLevel[], cells: readonly Readonly<Record<string, T>>[], view: DecisionFields, dims: GameConfig["dimensions"], context?: Readonly<Record<string, string>>): Found<T> | null {
  for (let i = 0; i < levels.length; i++) {
    const key = decisionKey(levels[i] as DecisionLevel, view, dims, context);
    if (key === null) continue;
    const v = cells[i]?.[key];
    if (v !== undefined) return { level: i, key, value: v };
  }
  return null;
}

// ---------------------------------------------------------------- views as bin fields

export function tempoFields(v: CoachView): DecisionFields {
  return {
    quarter: v.quarter,
    secondsLeftInHalf: v.secondsLeftInHalf,
    secondsLeftInGame: v.secondsLeftInGame,
    down: v.down,
    clockRunning: v.clockRunning ? 1 : 0,
    scoreDiff: v.scoreDiff,
    ownTimeouts: v.offenseTimeouts,
    previousSnapKneel: v.previousSnapKneel ? 1 : 0,
    clockRestarted: v.previousSnapRestart,
    timeoutCalled: v.beforeTimeout ? 1 : 0,
  };
}

/** The view from one side: score and timeouts are that side's own. */
export function sideFields(v: CoachView, side: Side): DecisionFields {
  return {
    ...tempoFields(v),
    scoreDiff: side === "offense" ? v.scoreDiff : -v.scoreDiff,
    ownTimeouts: side === "offense" ? v.offenseTimeouts : v.defenseTimeouts,
  };
}

export function kickFields(v: KickView): DecisionFields {
  return { quarter: v.quarter, secondsLeftInHalf: v.secondsLeftInHalf, secondsLeftInGame: v.secondsLeftInGame, scoreDiff: v.scoreDiff };
}

// ---------------------------------------------------------------- share functions (no Rng)

/** Run-off weights for 0..maxSeconds seconds. */
export function tempoShares(view: CoachView, tables: CoachTables, dims: GameConfig["dimensions"]): Found<readonly number[]> {
  const t = tables.tempo;
  const f = backoff(t.levels, t.cells, tempoFields(view), dims);
  if (f === null) throw new RangeError("no tempo cell");
  return f;
}

/** Probability that `side` calls a timeout in this dead ball: 0 when it has none or already took one. */
export function timeoutShare(view: CoachView, side: Side, tables: CoachTables, dims: GameConfig["dimensions"], perDeadBall: number): Found<number> {
  const fields = sideFields(view, side);
  const taken = side === "offense" ? view.offenseTimeoutsThisDeadBall : view.defenseTimeoutsThisDeadBall;
  if ((fields["ownTimeouts"] ?? 0) <= 0 || taken >= perDeadBall) return { level: -1, key: "", value: 0 };
  const t = tables.timeouts;
  const f = backoff(t.levels, t.cells, fields, dims, { side });
  if (f === null) throw new RangeError("no timeout cell");
  return { level: f.level, key: f.key, value: (f.value[0] ?? 0) / PER_MILLION };
}

/**
 * Probability of a timeout before a kickoff or a try; 0 with none left or one taken. Step 5c
 * milestone D: fitted per role in designed time bins read from the kick view, backing off to the
 * role's pooled rate (also used when no view is given).
 */
export function specialTimeoutShare(role: SpecialTimeoutRole, ownTimeouts: number, taken: number, tables: CoachTables, perDeadBall: number, view?: KickView, dims?: GameConfig["dimensions"]): number {
  if (ownTimeouts <= 0 || taken >= perDeadBall) return 0;
  const sp = tables.timeouts.special;
  if (sp !== undefined && view !== undefined && dims !== undefined) {
    const f = backoff(sp.levels, sp.cells, kickFields(view), dims, { role });
    if (f !== null) return (f.value[0] ?? 0) / PER_MILLION;
  }
  return (tables.timeouts.beforeKickoffOrTry[role][0] ?? 0) / PER_MILLION;
}

/** Probability of an onside attempt: the fitted cell when it has enough kickoffs, else the designed rule. */
export function onsideShare(view: KickView, tables: CoachTables, dims: GameConfig["dimensions"]): Found<number> {
  const t = tables.onside;
  const f = backoff(t.levels, t.cells, kickFields(view), dims);
  if (f !== null) return { level: f.level, key: f.key, value: (f.value[0] ?? 0) / PER_MILLION };
  const r = t.designedRule;
  const hit = view.quarter >= r.quarterMin && view.secondsLeftInGame <= r.secondsLeftInGame && view.scoreDiff <= -r.trailingBy;
  return { level: -1, key: "designed", value: hit ? 1 : 0 };
}

// ---------------------------------------------------------------- penalty accept or decline

/** Fitted expected points for the team with the ball (data/game/ep.json). No Rng. */
export function expectedPoints(down: number, distance: number, yardLine100: number, tables: CoachTables, dims: GameConfig["dimensions"]): number {
  const t = tables.ep;
  const f = backoff(t.levels, t.cells, { down, distance, yardLine100 }, dims);
  if (f === null) throw new RangeError("no expected-points cell");
  return (f.value[0] ?? 0) / t.scale;
}

/**
 * What one penalty option leaves, as both sidelines see it: no seed, no Rng state, no clock
 * internals (code review fix: before, the policy got the whole GameState).
 */
export type PenaltyView = Readonly<Pick<GameState, "phase" | "possession" | "spot" | "down" | "distance" | "score">>;

export interface PenaltyOutcome {
  readonly option: PenaltyOption;
  readonly after: PenaltyView;
}

/**
 * The offended team's value of a state: its lead plus the expected points of the next snap,
 * positive when it has the ball. A try or a kick is valued by the score alone (both options of
 * one foul almost always share that phase).
 */
export function stateValue(after: PenaltyView, team: Team, tables: CoachTables, dims: GameConfig["dimensions"]): number {
  const lead = after.score[team] - after.score[other(team)];
  if (after.phase !== "scrimmage" || after.down < 1) return lead;
  const ep = expectedPoints(after.down, after.distance, flip(after.spot), tables, dims);
  return lead + (after.possession === team ? ep : -ep);
}

/** Highest value for the offended team; ties go to accepting (the first accept option). */
export function choosePenalty(outcomes: readonly PenaltyOutcome[], offended: Team, tables: CoachTables, dims: GameConfig["dimensions"]): PenaltyOption {
  let best: PenaltyOutcome | null = null;
  let bestV = -Infinity;
  const ordered = [...outcomes.filter((o) => o.option.kind === "accept"), ...outcomes.filter((o) => o.option.kind !== "accept")];
  for (const o of ordered) {
    const v = stateValue(o.after, offended, tables, dims);
    if (v > bestV + 1e-9) {
      best = o;
      bestV = v;
    }
  }
  if (best === null) throw new RangeError("no penalty options");
  return best.option;
}

// ---------------------------------------------------------------- the coach

/**
 * One team's decision policies. The loop takes one per team (spec resolved question 14), so a
 * later coach layer can wrap the average coach without changing the loop. Every policy sees only
 * the views; none can reach the other side's call, formation, players or the game state.
 */
/** What the offense's caller may know about the clock before a scrimmage snap (step 5c E). */
export interface OffenseClock {
  readonly clockRunning: boolean;
}

export interface CoachPolicies {
  /** `clock` is given before a scrimmage snap (step 5c E), not before a try. */
  offenseCall(view: Situation, rng: Rng, clock?: OffenseClock): OffenseCall;
  defenseCall(view: Situation, rng: Rng): string;
  /** Whether this team calls a timeout now, as the offense or the defense of the next snap. */
  timeout(view: CoachView, side: Side, rng: Rng): boolean;
  /** Whether this team calls a timeout in the dead ball before a kickoff or a try; `view` is the clock and score as before a kickoff (step 5c D). */
  specialTimeout(role: SpecialTimeoutRole, ownTimeouts: number, takenThisDeadBall: number, rng: Rng, view?: KickView): boolean;
  /** Seconds to let run before the snap; only asked when the clock is running. The loop clips a draw above the play clock to it. */
  tempo(view: CoachView, rng: Rng): number;
  onside(view: KickView, rng: Rng): boolean;
  /** Accept or decline: one of the legal options, given what each leaves (offended team only). */
  penalty(outcomes: readonly PenaltyOutcome[], offended: Team): PenaltyOption;
  /** Spend a timeout instead of a ten-second run-off, if one applies to the next play. */
  runoffTimeout(view: CoachView): boolean;
  /** Call a timeout rather than let a drawn run-off end the period (step 5c E); asked only then. */
  clockOut?(view: CoachView): boolean;
}

export interface CoachData {
  readonly caller: CallerData;
  readonly config: GameConfig;
  readonly tables: CoachTables;
  readonly perDeadBall: number;
  /** The engine's field-goal data; when present, tries are masked where it makes them 0 (step 5c B). */
  readonly fieldGoals?: FieldGoalRange;
}

/** The average coach: step 2 calls, fitted tempo, timeouts and onside, designed run-off rule. */
/** Where the kneel-out drain applies (data/game/config.json clockRules.kneelOutDrainWindow, designed). */
export interface DrainWindow {
  readonly quarterMin: number;
  readonly secondsLeftInGame: number;
}

/**
 * Step 5c milestone F (designed): a leading offense that is running the clock out lets the whole
 * play clock run, the assumption the kneel-out test makes: when it kneeled on the previous snap,
 * or when it can kneel out from the snap this run-off leads to (the caller's kneelOut dimension,
 * K1, read with the play clock already run).
 */
export function drainsClock(view: CoachView, caller: CallerData, window: DrainWindow): boolean {
  if (view.quarter < window.quarterMin || view.secondsLeftInGame > window.secondsLeftInGame) return false;
  if (view.scoreDiff <= 0 || view.down < 1 || !view.clockRunning || view.beforeTimeout) return false;
  if (view.previousSnapKneel) return true;
  if (view.down > 3 || caller.config.dimensions["kneelOut"] === undefined) return false;
  const run = Math.min(view.playClock, view.secondsLeftInGame);
  const atSnap = { ...view, clockRunning: 1, secondsLeftInGame: view.secondsLeftInGame - run, secondsLeftInHalf: view.secondsLeftInHalf - run };
  return binSituation(atSnap, caller.config.dimensions)["kneelOut"] === "K1";
}

export function averageCoach(d: CoachData): CoachPolicies {
  const dims = d.config.dimensions;
  const final = d.config.runoffTimeout.finalSeconds;
  const rules = d.config.clockRules;
  const cm = rules?.callerMasks;
  const masks = (clock: OffenseClock | undefined): CallerMasks => ({
    ...(d.fieldGoals === undefined ? {} : { fieldGoals: d.fieldGoals }),
    ...(cm?.spikeNeedsRunningClock === true && clock !== undefined && !clock.clockRunning ? { clockStopped: true } : {}),
    ...(cm?.earlyKneel === undefined ? {} : { earlyKneel: cm.earlyKneel }),
    ...(cm?.lateKneel === undefined ? {} : { lateKneel: cm.lateKneel }),
  });
  return {
    offenseCall: (view, rng, clock) => chooseOffenseCall(view, d.caller, rng, masks(clock)),
    defenseCall: (view, rng) => chooseDefenseCall(view, d.caller, rng),
    timeout(view, side, rng) {
      const p = timeoutShare(view, side, d.tables, dims, d.perDeadBall).value;
      return p > 0 && rng.nextFloat() < p;
    },
    specialTimeout(role, own, taken, rng, view) {
      const p = specialTimeoutShare(role, own, taken, d.tables, d.perDeadBall, view, dims);
      return p > 0 && rng.nextFloat() < p;
    },
    tempo(view, rng) {
      const dw = rules?.kneelOutDrainWindow;
      if (rules?.kneelOutDrain === true && dw !== undefined && drainsClock(view, d.caller, dw)) return view.playClock;
      const drawn = sampleIndex(tempoShares(view, d.tables, dims).value, rng);
      // Step 5c milestone E (designed, clockRules.timeoutBeforeExpiry): a team that calls a timeout
      // calls it before 0:00, so the clock it lets run first stops a second short of the end of the
      // half or the game (before, a long draw ran the period out and made the timeout moot).
      if (view.beforeTimeout && rules?.timeoutBeforeExpiry === true) {
        const left = view.quarter === 2 ? view.secondsLeftInHalf : view.quarter >= 4 ? view.secondsLeftInGame : Number.POSITIVE_INFINITY;
        return Math.min(drawn, Math.max(0, left - 1));
      }
      return drawn;
    },
    onside(view, rng) {
      const p = onsideShare(view, d.tables, dims).value;
      return p > 0 && rng.nextFloat() < p;
    },
    penalty: (outcomes, offended) => choosePenalty(outcomes, offended, d.tables, dims),
    runoffTimeout(view) {
      const inFinal = view.quarter <= 2 ? view.secondsLeftInHalf <= final : view.secondsLeftInGame <= final;
      return inFinal && view.scoreDiff <= 0 && view.offenseTimeouts > 0 && view.offenseTimeoutsThisDeadBall < d.perDeadBall;
    },
    clockOut(view) {
      const r = rules?.clockOut;
      if (r === undefined || view.quarter < 4) return false;
      return view.scoreDiff <= -r.trailingMin && view.scoreDiff >= -r.trailingMax && view.offenseTimeouts > 0 && view.offenseTimeoutsThisDeadBall < d.perDeadBall;
    },
  };
}
