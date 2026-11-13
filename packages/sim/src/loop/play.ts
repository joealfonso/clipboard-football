// The full-game loop (M1 step 5). Each dead ball it asks the teams' policies for their coach
// decisions, asks resolvePlay for what happened, and hands every input to the step 3 machine.
// It never decides an outcome. Pure: no DOM, no Node, one seeded Rng passed in. A run is plain
// JSON, so a game can be saved between dead balls with rng.getState() and resumed.
//
// Input order per dead ball (docs/DECISIONS.md, "Loop input order"):
//   overtimeToss: startOvertime with the designed toss default.
//   kickoff:      kicking team's onside policy, resolvePlay, penalty choice, applyPlay.
//   try:          offense caller (extra point or two), defense caller on a two-point try,
//                 resolvePlay, penalty choice, applyPlay.
//   scrimmage:    offense timeout policy, then defense; tempo run-off when the clock runs; then
//                 offense and defense calls, resolvePlay, penalty choice, applyPlay.

import type { GameData, PlayResult, RuleSet, TeamPool } from "../../../shared/src/types";
import { FORMATION_PLAYS, type OffenseCall } from "../caller/offense";
import { createEngine, type Players, type ResolvePlay } from "../engine/resolve";
import type { PenaltyOption } from "../game/enforce";
import { other } from "../game/frame";
import { applyPlay, callTimeout, newGame, penaltyOptions, runPreSnap, startOvertime } from "../game/machine";
import { toSituation } from "../game/situation";
import type { GameState, GameType, Team } from "../game/types";
import type { Rng } from "../rng";
import type { CoachPolicies, Side } from "./coach";
import { coachView, kickView, type LastSnap } from "./views";

export const RECORD_SCHEMA_VERSION = 1;

export type GameLoopErrorCode = "inputCap" | "snapCap";

export class GameLoopError extends Error {
  readonly code: GameLoopErrorCode;
  constructor(code: GameLoopErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "GameLoopError";
    this.code = code;
  }
}

export interface TeamSetup {
  readonly name: string;
  readonly pool: TeamPool;
  readonly coach: CoachPolicies;
}

export interface GameSetup {
  readonly gameType: GameType;
  readonly seed: number;
  /** The league the teams came from, for the log (null when not from a league). */
  readonly leagueSeed: number | null;
  readonly home: TeamSetup;
  readonly away: TeamSetup;
}

/** The game state as an event line needs it. */
export interface Snapshot {
  readonly period: number;
  readonly clock: number;
  readonly phase: GameState["phase"];
  readonly possession: Team;
  readonly spot: number;
  readonly down: number;
  readonly distance: number;
  readonly goalToGo: boolean;
  readonly score: { readonly home: number; readonly away: number };
  readonly timeouts: { readonly home: number; readonly away: number };
  readonly clockRunning: boolean;
  readonly safetyKick: boolean;
}

export type GameEvent =
  | { readonly t: "toss"; readonly before: Snapshot; readonly winner: Team; readonly choice: string; readonly receiver: Team }
  | { readonly t: "timeout"; readonly before: Snapshot; readonly team: Team; readonly side: Side; readonly left: number }
  | { readonly t: "runoff"; readonly before: Snapshot; readonly seconds: number; readonly drawn: number; readonly after: Snapshot }
  | {
      readonly t: "play";
      readonly before: Snapshot;
      readonly offense: OffenseCall;
      readonly defense: string | null;
      readonly play: PlayResult;
      /** The penalty option taken (the step 3 designed default), null when the play had no foul. */
      readonly penalty: PenaltyOption | null;
      /** The offense spent a timeout instead of a ten-second run-off. */
      readonly runoffTimeout: boolean;
      readonly after: Snapshot;
    }
  | { readonly t: "twoMinuteWarning"; readonly period: number }
  | { readonly t: "endPeriod"; readonly period: number; readonly score: { readonly home: number; readonly away: number } };

export interface GameRecord {
  readonly schemaVersion: number;
  readonly seed: number;
  readonly leagueSeed: number | null;
  readonly gameType: GameType;
  readonly rules: { readonly id: string; readonly hash: string };
  readonly dataHashes: Readonly<Record<string, string>>;
  readonly teams: { readonly home: string; readonly away: string };
  readonly events: readonly GameEvent[];
  readonly final: GameState;
  readonly inputs: number;
}

/**
 * A game in progress: plain JSON. Save it with the Rng's state to resume. `events` is appended
 * to in place by stepGame (a log only grows), so a game costs linear time.
 */
export interface GameRun {
  readonly state: GameState;
  readonly events: GameEvent[];
  readonly inputs: number;
  readonly snaps: number;
  /** The last scrimmage snap, for the tempo bin "previous snap was a kneel". */
  readonly lastSnap: LastSnap | null;
}

/** The engine and what the loop reads, prepared once per process. */
export interface GameKit {
  readonly data: GameData;
  readonly resolve: ResolvePlay;
}

export function prepareGame(data: GameData): GameKit {
  return { data, resolve: createEngine(data.engine) };
}

function snapshot(s: GameState): Snapshot {
  return {
    period: s.period,
    clock: s.clock,
    phase: s.phase,
    possession: s.possession,
    spot: s.spot,
    down: s.down,
    distance: s.distance,
    goalToGo: s.goalToGo,
    score: s.score,
    timeouts: s.timeouts,
    clockRunning: s.clockRunning,
    safetyKick: s.safetyKick,
  };
}

function shifted(pool: TeamPool, edge: number): TeamPool {
  if (edge === 0) return pool;
  return {
    ...pool,
    players: pool.players.map((p) => ({
      ...p,
      ratings: Object.fromEntries(Object.entries(p.ratings).map(([k, v]) => [k, v + edge])) as typeof p.ratings,
      skills: Object.fromEntries(Object.entries(p.skills).map(([k, v]) => [k, v + edge])),
    })),
  };
}

/**
 * Both teams as the engine sees them in this game: home field applied (designed, centered). This
 * is the one place the loop builds per-game player state; the engine reads every rating through
 * ratingOf (engine/players.ts), so a later per-game modifier (fatigue) can be applied here
 * without touching the engine.
 */
export function gamePlayers(setup: GameSetup, data: GameData): Players {
  const hf = data.league.homeField;
  const c = hf.crowdNoise;
  return {
    home: shifted(setup.home.pool, hf.ratingEdge),
    away: shifted(setup.away.pool, -hf.ratingEdge),
    ...(c === 0 ? {} : { offensePreSnapFoulScale: { home: 1 - c, away: 1 + c } }),
  };
}

export function startGame(setup: GameSetup, data: GameData, rng: Rng): GameRun {
  const state = newGame(data.engine.rules, { gameType: setup.gameType, seed: setup.seed, rulesHash: data.rulesHash }, rng);
  return { state, events: [], inputs: 1, snaps: 0, lastSnap: null };
}

function onsideAllowed(s: GameState, rules: RuleSet): boolean {
  const k = rules.kickoff.onside.allowedWhen;
  const trailing = s.score[s.possession] < s.score[other(s.possession)];
  return k === "always" || (k === "trailing" && trailing) || (k === "trailingInFinalPeriod" && trailing && s.period === rules.game.regulationPeriods);
}

/**
 * The offended team's accept-or-decline choice (post-validation revision 11): its coach sees the
 * state each legal option leaves and picks one. Offsetting fouls have one option. Null when the
 * play carries no foul.
 */
function penaltyChoice(s: GameState, rules: RuleSet, play: PlayResult, runoffTimeout: boolean, team: (t: Team) => TeamSetup): PenaltyOption | null {
  const options = penaltyOptions(s, rules, play);
  if (options.length === 0) return null;
  if (options.length === 1) return options[0] as PenaltyOption;
  const fouler = (play.fouls ?? [])[0]?.by ?? "offense";
  const offended = fouler === "offense" ? other(s.possession) : s.possession;
  const outcomes = options.map((option) => {
    const a = applyPlay(s, rules, play, { penalty: option, runoffTimeout });
    return { option, after: { phase: a.phase, possession: a.possession, spot: a.spot, down: a.down, distance: a.distance, score: a.score } };
  });
  return team(offended).coach.penalty(outcomes, offended);
}

/**
 * A loop cap in force during `period` (step 5c milestone A), for scrimmage snaps and for inputs:
 * the per-game value covers regulation, and each overtime period adds its share (cap /
 * regulation periods), so a legal postseason game that keeps playing periods never reaches it
 * while a loop that stops making progress inside a period still does.
 */
export function snapCapAt(period: number, perGame: number, regulationPeriods: number): number {
  return Math.ceil((perGame * Math.max(period, regulationPeriods)) / regulationPeriods);
}

/** Loop events the machine's state change implies: two-minute warning, end of a period. */
function stateEvents(prev: GameState, next: GameState, out: GameEvent[]): void {
  if (!prev.twoMinuteWarningDone && next.twoMinuteWarningDone && next.period === prev.period) out.push({ t: "twoMinuteWarning", period: prev.period });
  const ended = next.period !== prev.period || (prev.phase !== "overtimeToss" && next.phase === "overtimeToss") || (next.phase === "final" && prev.phase !== "final");
  if (ended) out.push({ t: "endPeriod", period: prev.period, score: next.score });
}

/**
 * One dead ball: every input up to and including the next play (or the toss, or a run-off that
 * ends the period). Returns the next run; the one passed in is not changed.
 */
export function stepGame(run: GameRun, setup: GameSetup, kit: GameKit, players: Players, rng: Rng): GameRun {
  const rules = kit.data.engine.rules;
  const cap = kit.data.config.loop;
  let s = run.state;
  let inputs = run.inputs;
  const events = run.events;
  const team = (t: Team): TeamSetup => (t === "home" ? setup.home : setup.away);
  const input = (): void => {
    inputs++;
    const inputCap = snapCapAt(s.period, cap.maxInputsPerGame, rules.game.regulationPeriods);
    if (inputs > inputCap) throw new GameLoopError("inputCap", `game ${setup.seed} passed ${inputCap} inputs by period ${s.period}`);
  };
  /** Records the input's own event first, then what the state change implies. */
  const advance = (next: GameState, ev: (after: GameState) => GameEvent): void => {
    events.push(ev(next));
    stateEvents(s, next, events);
    s = next;
  };

  if (s.phase === "overtimeToss") {
    input();
    const before = snapshot(s);
    advance(startOvertime(s, rules, rng), (next) => ({
      t: "toss",
      before,
      winner: next.overtime?.toss.winner ?? "home",
      choice: next.overtime?.toss.choice ?? "receive",
      receiver: next.overtime?.firstTeam ?? "home",
    }));
    return { ...run, state: s, events, inputs, lastSnap: null };
  }

  let snaps = run.snaps;
  let lastSnap = run.lastSnap;
  let offense: OffenseCall;
  let defense: string | null = null;
  let runoffTimeout = false;

  if (s.phase === "kickoff" || s.phase === "try") {
    // Timeouts in the dead ball before a kickoff or a try (revision 4): the team with the ball first.
    const roles = s.phase === "kickoff" ? (["kickKicker", "kickReceiver"] as const) : (["tryOffense", "tryDefense"] as const);
    for (const [i, role] of roles.entries()) {
      const t = i === 0 ? s.possession : other(s.possession);
      if (team(t).coach.specialTimeout(role, s.timeouts[t], s.timeoutsThisDeadBall[t], rng, kickView(s, rules))) {
        input();
        const before = snapshot(s);
        advance(callTimeout(s, rules, t), (next) => ({ t: "timeout", before, team: t, side: i === 0 ? "offense" : "defense", left: next.timeouts[t] }));
      }
    }
  }
  if (s.phase === "kickoff") {
    const kicker = team(s.possession);
    const onside = onsideAllowed(s, rules) && kicker.coach.onside(kickView(s, rules), rng);
    offense = { call: onside ? "onsideKick" : "kickoff" };
    lastSnap = null;
  } else if (s.phase === "try") {
    const sit = toSituation(s, rules);
    offense = team(s.possession).coach.offenseCall(sit, rng);
    defense = offense.call === "goForTwo" ? team(other(s.possession)).coach.defenseCall(sit, rng) : null;
    lastSnap = null;
  } else if (s.phase === "scrimmage") {
    /** The offense's run-off before the snap, or before a timeout when `beforeTimeout`. False when it ended the period. */
    const runoff = (beforeTimeout: boolean): boolean => {
      if (!s.clockRunning) return true;
      const drawn = team(s.possession).coach.tempo({ ...coachView(s, rules, lastSnap), beforeTimeout }, rng);
      const seconds = Math.min(drawn, s.playClock);
      if (seconds === 0) return true;
      input();
      const before = snapshot(s);
      advance(runPreSnap(s, rules, seconds), (next) => ({ t: "runoff", before, seconds, drawn, after: snapshot(next) }));
      return s.phase === "scrimmage";
    };
    let ranOff = false;
    for (const side of ["offense", "defense"] as const) {
      const t = side === "offense" ? s.possession : other(s.possession);
      if (team(t).coach.timeout(coachView(s, rules, lastSnap), side, rng)) {
        // The clock runs until the timeout is called (revision 2): the run-off comes first, from
        // the cells of dead balls with a timeout. A run-off that stops the clock makes the timeout moot.
        if (s.clockRunning && !ranOff) {
          ranOff = true;
          if (!runoff(true)) return { state: s, events, inputs, snaps, lastSnap: null };
          if (!s.clockRunning) continue;
        }
        input();
        const before = snapshot(s);
        advance(callTimeout(s, rules, t), (next) => ({ t: "timeout", before, team: t, side, left: next.timeouts[t] }));
      }
    }
    if (!ranOff && !runoff(false)) return { state: s, events, inputs, snaps, lastSnap: null };
    const sit = toSituation(s, rules);
    const off = team(s.possession);
    offense = off.coach.offenseCall(sit, rng);
    defense = FORMATION_PLAYS.includes(offense.call) ? team(other(s.possession)).coach.defenseCall(sit, rng) : null;
    runoffTimeout = off.coach.runoffTimeout(coachView(s, rules, lastSnap));
    snaps++;
    const snapCap = snapCapAt(s.period, cap.maxScrimmageSnapsPerGame, rules.game.regulationPeriods);
    if (snaps > snapCap) throw new GameLoopError("snapCap", `game ${setup.seed} passed ${snapCap} scrimmage snaps by period ${s.period}`);
  } else {
    return run;
  }

  const play = kit.resolve(s, offense, defense, players, rng);
  const penalty = penaltyChoice(s, rules, play, runoffTimeout, team);
  input();
  const before = snapshot(s);
  const offenseTeam = s.possession;
  const next = applyPlay(s, rules, play, { ...(penalty === null ? {} : { penalty }), runoffTimeout });
  const usedTimeout = runoffTimeout && next.timeouts[offenseTeam] < s.timeouts[offenseTeam] && play.kind !== "kickoff";
  const after = snapshot(next);
  const ev: GameEvent = { t: "play", before, offense, defense, play, penalty, runoffTimeout: usedTimeout, after };
  if (before.phase === "scrimmage") lastSnap = {
      kneel: play.kind === "kneel",
      restart: (play.fouls ?? []).length > 0 ? 2 : "outOfBounds" in play && play.outOfBounds === true ? 1 : 0,
      possession: offenseTeam,
      period: before.period,
    };
  events.push(ev);
  stateEvents(s, next, events);
  return { state: next, events, inputs, snaps, lastSnap };
}

export function recordOf(run: GameRun, setup: GameSetup, data: GameData): GameRecord {
  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    seed: setup.seed,
    leagueSeed: setup.leagueSeed,
    gameType: setup.gameType,
    rules: { id: data.engine.rules.id, hash: data.rulesHash },
    dataHashes: data.dataHashes,
    teams: { home: setup.home.name, away: setup.away.name },
    events: run.events,
    final: run.state,
    inputs: run.inputs,
  };
}

/** Plays one game from its setup. Same setup, data and seed give the same record. */
export function playGame(setup: GameSetup, kit: GameKit, rng: Rng): GameRecord {
  const players = gamePlayers(setup, kit.data);
  let run = startGame(setup, kit.data, rng);
  while (run.state.phase !== "final") run = stepGame(run, setup, kit, players, rng);
  return recordOf(run, setup, kit.data);
}
