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
//   scrimmage:    offense timeout policy, then defense; tempo run-off when the clock runs (if it
//                 would end the period, the offense's clock-out policy may call a timeout
//                 instead, step 5c E); then offense and defense calls, resolvePlay, penalty
//                 choice, applyPlay.

import type { DecisionRequest, GameData, OffenseCallChoice, PlayResult, RuleSet, TeamPool, Tempo } from "../../../shared/src/types";
import { FORMATION_PLAYS, type OffenseCall } from "../caller/offense";
import { createEngine, type Players, type ResolvePlay } from "../engine/resolve";
import type { PenaltyOption } from "../game/enforce";
import { other } from "../game/frame";
import { applyPlay, callTimeout, newGame, peekToss, penaltyOptions, runPreSnap, startOvertime } from "../game/machine";
import { GameRuleError } from "../game/errors";
import { toSituation } from "../game/situation";
import type { GameState, GameType, Team, TossChoice } from "../game/types";
import type { Rng } from "../rng";
import { modeTempo, type CoachPolicies, type Side } from "./coach";
import { continueRequest, defenseAnswer, defenseRequest, kickoffRequest, offenseAnswer, offenseRequest, penaltyOptionId, timeoutOption, tossRequest, tryRequest, type RequestDraft } from "./requests";
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

export function startGame(setup: GameSetup, data: GameData, rng: Rng, tossChoice?: TossChoice): GameRun {
  const state = newGame(data.engine.rules, { gameType: setup.gameType, seed: setup.seed, rulesHash: data.rulesHash, ...(tossChoice === undefined ? {} : { tossChoice }) }, rng);
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
function penaltyChoice(s: GameState, rules: RuleSet, play: PlayResult, runoffTimeout: boolean, team: (t: Team) => TeamSetup, seat: Seat | null = null, calls: Calls | null = null): PenaltyOption | null {
  const options = penaltyOptions(s, rules, play);
  if (options.length === 0) return null;
  if (options.length === 1) return options[0] as PenaltyOption;
  const fouler = (play.fouls ?? [])[0]?.by ?? "offense";
  const offended = fouler === "offense" ? other(s.possession) : s.possession;
  const outcomes = options.map((option) => {
    const a = applyPlay(s, rules, play, { penalty: option, runoffTimeout });
    return { option, after: { phase: a.phase, possession: a.possession, spot: a.spot, down: a.down, distance: a.distance, score: a.score } };
  });
  if (seat !== null && seat.team === offended && calls !== null) {
    // M2 E: the offended human picks, seeing the play and what each option leaves.
    const [id] = seat.ask(() => ({
      kind: "penalty",
      team: offended,
      screens: [{ id: "penalty", options: outcomes.map((o) => ({ id: penaltyOptionId(o.option), legal: true })) }],
      play,
      offenseCall: calls.offense,
      defenseCall: calls.defense,
      outcomes: outcomes.map((o) => ({ option: penaltyOptionId(o.option), after: o.after })),
    }));
    const hit = outcomes.find((o) => penaltyOptionId(o.option) === id);
    if (hit === undefined) throw new RangeError(`no penalty option ${String(id)}`);
    return hit.option;
  }
  return team(offended).coach.penalty(outcomes, offended);
}

interface Calls {
  readonly offense: OffenseCallChoice;
  readonly defense: string | null;
}

/**
 * M2 milestone E: the human's seat in one dead ball. `ask` returns the human's next answer (the
 * option path) or, when there is none yet, throws to pause the loop with the request `make`
 * builds (loop/session.ts). The loop asks where the AI policy would decide (spec E); the seat
 * holds the drive's tempo and this side's last calls (Same call).
 */
export interface Seat {
  readonly team: Team;
  tempo: Tempo;
  lastOffense: OffenseCallChoice | null;
  lastDefense: string | null;
  ask(make: () => RequestDraft): readonly string[];
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
  // Step 5c G1: the toss that starts overtime moves to the next period but ends none (the end of
  // the last period was already logged when the game reached the toss).
  const ended = (next.period !== prev.period && prev.phase !== "overtimeToss") || (prev.phase !== "overtimeToss" && next.phase === "overtimeToss") || (next.phase === "final" && prev.phase !== "final");
  if (ended) out.push({ t: "endPeriod", period: prev.period, score: next.score });
}

/**
 * One dead ball: every input up to and including the next play (or the toss, or a run-off that
 * ends the period). Returns the next run; the one passed in is not changed.
 */
export function stepGame(run: GameRun, setup: GameSetup, kit: GameKit, players: Players, rng: Rng, seat: Seat | null = null): GameRun {
  const rules = kit.data.engine.rules;
  const catalog = kit.data.engine.caller.catalog;
  const human = (t: Team): boolean => seat !== null && seat.team === t;
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

  // ---------------------------------------------------------------- M2 E: the human's decisions
  let first: OffenseCallChoice | "timeout" | null = null;
  /** The human kicker's or try offense's first answer: its call, or a timeout (asked once). */
  const humanFirst = (): OffenseCallChoice | "timeout" => {
    if (first !== null || seat === null) return first ?? "timeout";
    const t = seat.team;
    if (s.phase === "kickoff") {
      const p = seat.ask(() => kickoffRequest(s, rules, t, onsideAllowed(s, rules)));
      first = p[0] === "timeout" ? "timeout" : { call: p[0] as string };
    } else {
      first = humanTryAnswer();
    }
    return first;
  };
  /** The try request's answer; after a timeout the request shows it off (timeoutTaken). */
  const humanTryAnswer = (): OffenseCallChoice | "timeout" => {
    if (seat === null) throw new RangeError("no seat");
    const a = offenseAnswer(seat.ask(() => tryRequest(s, rules, catalog, seat.team, seat.lastOffense)), seat.lastOffense);
    if ("timeout" in a) return "timeout";
    if ("tempo" in a) throw new RangeError("no tempo on a try");
    return a.call;
  };
  /** After a timeout on the call request, the call itself (timeout now off). */
  const humanKickCall = (): string => {
    const f = humanFirst();
    if (f !== "timeout" || seat === null) return (f as OffenseCallChoice).call;
    const t = seat.team;
    const p = seat.ask(() => kickoffRequest(s, rules, t, onsideAllowed(s, rules)));
    return p[0] as string;
  };
  const humanTryCall = (): OffenseCallChoice => {
    const f = humanFirst();
    if (f !== "timeout") return f;
    const again = humanTryAnswer();
    if (again === "timeout") throw new RangeError("a second timeout in one dead ball");
    return again;
  };
  /** The human offense's scrimmage call request; tempo answers set the tempo and ask again. */
  const humanOffense = (): OffenseCallChoice | "timeout" => {
    if (seat === null) throw new RangeError("no seat");
    for (;;) {
      const a = offenseAnswer(
        seat.ask(() => offenseRequest(s, rules, catalog, toSituation(s, rules), seat.team, seat.tempo, seat.lastOffense, kit.data.engine.special.fieldGoals.kickDepth)),
        seat.lastOffense,
      );
      if ("tempo" in a) {
        seat.tempo = a.tempo;
        continue;
      }
      return "timeout" in a ? "timeout" : a.call;
    }
  };
  /** A timeout the human (defense, receiver) may call once the other side has lined up; no run-off before it (the clock already ran). */
  const takeTimeout = (t: Team): void => {
    input();
    const before = snapshot(s);
    advance(callTimeout(s, rules, t), (next) => ({ t: "timeout", before, team: t, side: t === s.possession ? "offense" : "defense", left: next.timeouts[t] }));
  };
  const lateTimeout = (t: Team, about: () => Extract<DecisionRequest, { kind: "continue" }>["about"]): void => {
    if (seat === null) return;
    const p = seat.ask(() => continueRequest(t, about(), timeoutOption(s, rules, t)));
    if (p[0] !== "timeout") return;
    takeTimeout(t);
    seat.ask(() => continueRequest(t, about(), timeoutOption(s, rules, t)));
  };
  const humanDefenseCall = (t: Team, allowTimeout: boolean): string => {
    if (seat === null) throw new RangeError("no seat");
    const make = (): RequestDraft => defenseRequest(s, rules, catalog, t, seat.lastDefense, allowTimeout);
    let a = defenseAnswer(seat.ask(make), seat.lastDefense);
    if ("timeout" in a) {
      takeTimeout(t);
      a = defenseAnswer(seat.ask(make), seat.lastDefense);
      if ("timeout" in a) throw new RangeError("a second timeout in one dead ball");
    }
    return a.preset;
  };
  /** M2 E: the ten-second run-off, when it applies to this play: take it, or spend a timeout. */
  const humanRunoff = (play: PlayResult, penalty: PenaltyOption | null, calls: Calls): boolean => {
    if (seat === null) return false;
    const choices = penalty === null ? {} : { penalty };
    const without = applyPlay(s, rules, play, { ...choices, runoffTimeout: false });
    let withTimeout: GameState | null = null;
    let blocked: "noTimeouts" | "timeoutTaken" | "timeoutNotAllowed" | null = null;
    try {
      withTimeout = applyPlay(s, rules, play, { ...choices, runoffTimeout: true });
    } catch (e) {
      if (!(e instanceof GameRuleError)) throw e;
      blocked = e.code === "noTimeouts" ? "noTimeouts" : !rules.clock.timeoutAvoidsRunoff ? "timeoutNotAllowed" : "timeoutTaken";
    }
    const off = s.possession;
    const applies = blocked !== null || (withTimeout !== null && withTimeout.timeouts[off] < without.timeouts[off]);
    if (!applies) return false;
    const clock = withTimeout?.clock ?? Math.min(s.clock, without.clock + rules.clock.runoffSeconds);
    const [id] = seat.ask(() => ({
      kind: "runoff",
      team: off,
      screens: [{ id: "runoff", options: [{ id: "runoff", legal: true }, blocked === null ? { id: "timeout", legal: true } : { id: "timeout", legal: false, reason: blocked }] }],
      play,
      offenseCall: calls.offense,
      defenseCall: calls.defense,
      clock,
      clockAfter: without.clock,
    }));
    return id === "timeout";
  };

  if (s.phase === "overtimeToss") {
    // M2 E: a human toss winner chooses (receive or kick); otherwise the designed default stands
    // and a human sees the result. The winner is read from a copy of the stream (no draw).
    let choice: TossChoice | undefined;
    if (seat !== null) {
      const winner = peekToss(rng);
      if (winner === seat.team) {
        const [c] = seat.ask(() => tossRequest(seat.team, true));
        choice = c as TossChoice;
      } else seat.ask(() => continueRequest(seat.team, { what: "tossResult", winner, choice: "receive" }, null));
    }
    input();
    const before = snapshot(s);
    advance(startOvertime(s, rules, rng, choice), (next) => ({
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
      let wants: boolean;
      if (human(t)) {
        // M2 E: the human kicker's or try offense's timeout is on its call request (asked below);
        // the human receiver's or try defense's comes once the kicking side has lined up.
        wants = i === 0 && humanFirst() === "timeout";
      } else wants = team(t).coach.specialTimeout(role, s.timeouts[t], s.timeoutsThisDeadBall[t], rng, kickView(s, rules));
      if (wants) {
        input();
        const before = snapshot(s);
        advance(callTimeout(s, rules, t), (next) => ({ t: "timeout", before, team: t, side: i === 0 ? "offense" : "defense", left: next.timeouts[t] }));
      }
    }
  }
  if (s.phase === "kickoff") {
    const kicker = team(s.possession);
    if (human(s.possession)) offense = { call: humanKickCall() };
    else {
      const onside = onsideAllowed(s, rules) && kicker.coach.onside(kickView(s, rules), rng);
      offense = { call: onside ? "onsideKick" : "kickoff" };
      if (human(other(s.possession))) lateTimeout(other(s.possession), () => ({ what: "theyKickOff", onside, safetyKick: s.safetyKick }));
    }
    lastSnap = null;
  } else if (s.phase === "try") {
    const sit = toSituation(s, rules);
    offense = human(s.possession) ? humanTryCall() : team(s.possession).coach.offenseCall(sit, rng);
    const d = other(s.possession);
    if (offense.call === "goForTwo") defense = human(d) ? humanDefenseCall(d, !human(s.possession)) : team(d).coach.defenseCall(sit, rng);
    else {
      defense = null;
      if (human(d)) lateTimeout(d, () => ({ what: "theyLineUp", call: offense.call }));
    }
    lastSnap = null;
  } else if (s.phase === "scrimmage") {
    /** The offense's run-off before the snap, or before a timeout when `beforeTimeout`. False when it ended the period. */
    const runoff = (beforeTimeout: boolean): boolean => {
      if (!s.clockRunning) return true;
      const off = team(s.possession).coach;
      const view = { ...coachView(s, rules, lastSnap), beforeTimeout };
      const humanOffense = human(s.possession) && seat !== null;
      // M2 E: the human offense's tempo mode; Normal is the average coach's draw.
      const tempoOf = (v: typeof view): number => (humanOffense && seat.tempo !== "normal" ? modeTempo(v, seat.tempo, kit.data.tables, kit.data.config, rng) : off.tempo(v, rng));
      const drawn = tempoOf(view);
      const seconds = Math.min(drawn, s.playClock);
      if (!beforeTimeout && seconds >= s.clock && !humanOffense && off.clockOut?.(view) === true) {
        // Step 5c milestone E (designed): rather than let this run-off end the period, the offense
        // calls a timeout. The clock runs until it is called, from the cells of dead balls with a
        // timeout, as on the timeout path above; if that too reaches 0:00 the period ends.
        const pre = Math.min(tempoOf({ ...view, beforeTimeout: true }), s.playClock);
        if (pre > 0) {
          input();
          const b0 = snapshot(s);
          advance(runPreSnap(s, rules, pre), (next) => ({ t: "runoff", before: b0, seconds: pre, drawn: pre, after: snapshot(next) }));
          if (s.phase !== "scrimmage") return false;
          if (!s.clockRunning) return true;
        }
        const t = s.possession;
        input();
        const b1 = snapshot(s);
        advance(callTimeout(s, rules, t), (next) => ({ t: "timeout", before: b1, team: t, side: "offense", left: next.timeouts[t] }));
        return true;
      }
      if (seconds === 0) return true;
      input();
      const before = snapshot(s);
      advance(runPreSnap(s, rules, seconds), (next) => ({ t: "runoff", before, seconds, drawn, after: snapshot(next) }));
      return s.phase === "scrimmage";
    };
    let ranOff = false;
    let humanCall: OffenseCallChoice | null = null;
    for (const side of ["offense", "defense"] as const) {
      const t = side === "offense" ? s.possession : other(s.possession);
      let wants: boolean;
      if (human(t)) {
        // M2 E: the human offense's timeout is on its call request; a human defense's comes once
        // the offense has lined up (after its call), as in kickoffs and tries.
        if (side === "offense") {
          const a = humanOffense();
          wants = a === "timeout";
          if (a !== "timeout") humanCall = a;
        } else wants = false;
      } else wants = team(t).coach.timeout(coachView(s, rules, lastSnap), side, rng);
      if (wants) {
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
    const d = other(s.possession);
    if (human(s.possession)) {
      if (humanCall === null) {
        const a = humanOffense();
        if (a === "timeout") throw new RangeError("a second timeout in one dead ball");
        humanCall = a;
      }
      offense = humanCall;
    } else offense = off.coach.offenseCall(sit, rng, { clockRunning: s.clockRunning });
    if (FORMATION_PLAYS.includes(offense.call)) defense = human(d) ? humanDefenseCall(d, true) : team(d).coach.defenseCall(sit, rng);
    else {
      defense = null;
      const called = offense.call;
      if (human(d)) lateTimeout(d, () => ({ what: "theyLineUp", call: called }));
    }
    // The human offense answers the ten-second run-off after the play, when it applies.
    runoffTimeout = human(s.possession) ? false : off.coach.runoffTimeout(coachView(s, rules, lastSnap));
    snaps++;
    const snapCap = snapCapAt(s.period, cap.maxScrimmageSnapsPerGame, rules.game.regulationPeriods);
    if (snaps > snapCap) throw new GameLoopError("snapCap", `game ${setup.seed} passed ${snapCap} scrimmage snaps by period ${s.period}`);
  } else {
    return run;
  }

  const play = kit.resolve(s, offense, defense, players, rng);
  const calls: Calls = { offense, defense };
  const penalty = penaltyChoice(s, rules, play, runoffTimeout, team, seat, calls);
  if (seat !== null && human(s.possession) && s.phase === "scrimmage") runoffTimeout = humanRunoff(play, penalty, calls);
  // Same call repeats this side's last scrimmage or two-point call (a try's two-point play counts as its run or pass).
  if (seat !== null && human(s.possession) && s.phase === "scrimmage") seat.lastOffense = offense;
  if (seat !== null && human(s.possession) && offense.call === "goForTwo" && offense.twoPointPlay !== undefined && offense.formation !== undefined) seat.lastOffense = { call: offense.twoPointPlay, formation: offense.formation };
  if (seat !== null && human(other(s.possession)) && defense !== null) seat.lastDefense = defense;
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
