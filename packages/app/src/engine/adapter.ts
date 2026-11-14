// ADAPTER for the M2 step-wise loop (engine milestone E), until it ships in packages/sim. It gives
// the UI the loop the spec describes (a request at every human decision, legal options with
// reason codes, answers, at most seven options, the AI's call never in a request) on top of the
// M1 loop as it is: `stepGame` with one CoachPolicies per team.
//
// How: the human's team gets policies that read answers from a list. A dead ball is played from
// its saved start (the committed run and the Rng state) with the answers given so far in it; when
// a policy needs an answer it doesn't have, it throws NeedInput, the attempt is thrown away and
// the request goes to the UI. The next answer replays the dead ball from its start. Same seed and
// same answers give the same game, so a save is the seed plus the answer log.
//
// What it does NOT do, because the M1 loop can't (each is a hook for milestone E or G): the coin
// toss and overtime choices (the rules' designed defaults are used), the ten-second run-off
// prompt (the average coach's rule answers for the human), challenges. Tempo modes are an
// approximation of resolved question 13 (see humanTempo).
//
// Pure: no DOM, the one seeded Rng. Runs in the worker and in Node tests.

import type { Catalog, GameData, PlayResult, Situation } from "@clipboard-football/shared";
import {
  FORMATION_PLAYS,
  Rng,
  averageCoachFor,
  gamePlayers,
  indexCatalog,
  leagueFromSeed,
  prepareGame,
  recordOf,
  setupGame,
  startGame,
  stepGame,
  toSituation,
  type AvailabilityIndex,
  type CoachPolicies,
  type GameKit,
  type GameRecord,
  type GameRun,
  type GameSetup,
  type GameType,
  type LeagueTeam,
  type OffenseCall,
  type PenaltyOutcome,
  type Players,
  type RngState,
} from "@clipboard-football/sim";
import { onFieldFor } from "./roster";
import type { Answer, DecisionRequest, GameState, LineUp, OffenseCallAnswer, Option, PenaltyChoice, PendingPlay, ReasonCode, SameCall, Snapshot, Team, Tempo, TimeoutOption } from "./types";

export const SAVE_SCHEMA_VERSION = 1;

export type AdapterErrorCode = "illegalAnswer" | "noRequest" | "answerNotUsed";

/** A typed refusal: the run is left as it was. */
export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  constructor(code: AdapterErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "AdapterError";
    this.code = code;
  }
}

/** Everything that rebuilds a game: plain JSON for IndexedDB. */
export interface SaveData {
  readonly schemaVersion: number;
  /** sha256 over every data file's hash; a save from other data can't be resumed. */
  readonly dataHash: string;
  readonly leagueSeed: number;
  readonly seed: number;
  readonly human: Team;
  readonly gameType: GameType;
  readonly log: readonly Answer[];
}

export interface Seat {
  readonly leagueSeed: number;
  readonly seed: number;
  readonly human: Team;
  readonly gameType: GameType;
}

type Need =
  | { readonly kind: "offenseCall" }
  | { readonly kind: "try" }
  | { readonly kind: "defenseCall"; readonly twoPoint: boolean }
  | { readonly kind: "kickoffType"; readonly onsideAllowed: boolean }
  | { readonly kind: "continue"; readonly lineUp: LineUp }
  | { readonly kind: "penaltyChoice"; readonly choices: readonly PenaltyChoice[]; readonly pending: PendingPlay };

class NeedInput {
  constructor(readonly need: Need) {}
}

const RUN_PASS = new Set(FORMATION_PLAYS);
const other = (t: Team): Team => (t === "home" ? "away" : "home");

export function snapshotOf(s: GameState): Snapshot {
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

/** The catalog's ids by screen, and its availability rules. */
export interface CatalogIndex {
  readonly availability: AvailabilityIndex;
  readonly screenOf: ReadonlyMap<string, string>;
  readonly formations: readonly string[];
  /** Scrimmage leaves: every final call on the offense screens, catalog order. */
  readonly offenseLeaves: readonly string[];
  readonly defenseLeaves: readonly string[];
}

export function indexOf(catalog: Catalog): CatalogIndex {
  const screenOf = new Map<string, string>();
  for (const s of catalog.screens) for (const c of s.choices) screenOf.set(c.id, s.id);
  const leaves = (prefix: string, skip: readonly string[]): string[] =>
    catalog.screens.filter((s) => s.id.startsWith(prefix) && !skip.includes(s.id)).flatMap((s) => s.choices.filter((c) => c.opens === undefined).map((c) => c.id));
  return {
    availability: indexCatalog(catalog),
    screenOf,
    formations: catalog.screens.find((s) => s.id === "offense.formation")?.choices.map((c) => c.id) ?? [],
    offenseLeaves: leaves("offense.", ["offense.formation", "offense.try"]),
    defenseLeaves: leaves("defense.", []),
  };
}

function offReason(id: string, ix: CatalogIndex, sit: Situation): ReasonCode {
  const screen = ix.screenOf.get(id);
  if (sit.phase === "try") return screen === "offense.kick" || screen === "offense.clock" ? "notOnTry" : "notNow";
  if (screen === "offense.kick") return "kickWindow";
  return "notNow";
}

/** Availability of every offense leaf in this situation, with a reason for each off one. */
export function offenseOptions(ix: CatalogIndex, sit: Situation): Option[] {
  return ix.offenseLeaves.map((id) => {
    const on = sit.phase === "try" ? RUN_PASS.has(id) : ix.availability.isAvailable(id, sit);
    return on ? { id, on } : { id, on, reason: offReason(id, ix, sit) };
  });
}

/** The prepared game: the data, the engine, the league. Built once per data load. */
export interface Prepared {
  readonly data: GameData;
  readonly kit: GameKit;
  readonly index: CatalogIndex;
  readonly dataHash: string;
  league(leagueSeed: number): readonly LeagueTeam[];
}

export function prepare(data: GameData, dataHash: string): Prepared {
  const leagues = new Map<number, readonly LeagueTeam[]>();
  return {
    data,
    kit: prepareGame(data),
    index: indexOf(data.engine.caller.catalog),
    dataHash,
    league(leagueSeed) {
      let l = leagues.get(leagueSeed);
      if (l === undefined) {
        l = leagueFromSeed(data, leagueSeed).teams;
        leagues.set(leagueSeed, l);
      }
      return l;
    },
  };
}

/** The setup of one game: which league teams meet, from the seed (the M1 pairing rule). */
export function matchupOf(p: Prepared, leagueSeed: number, seed: number, gameType: GameType = "regularSeason"): GameSetup {
  const coach = averageCoachFor(p.data);
  return setupGame(p.league(leagueSeed), leagueSeed, seed, () => coach, gameType);
}

/** Per-attempt answer reading. */
interface Cursor {
  i: number;
  timeoutAsked: boolean;
  kickoffAnswered: boolean;
  resolved: PendingPlay | null;
}

export interface StepResult {
  /** Events committed since the last answer, in order. */
  readonly events: GameRecord["events"];
  readonly request: DecisionRequest | null;
  readonly state: GameState;
}

export class StepLoop {
  readonly seat: Seat;
  readonly setup: GameSetup;
  private readonly p: Prepared;
  private readonly players: Players;
  private readonly ai: CoachPolicies;
  private run: GameRun;
  private rngState: RngState;
  private stepAnswers: Answer[] = [];
  private readonly log: Answer[] = [];
  private request: DecisionRequest | null = null;
  private seq = 0;
  private tempo: Tempo = "normal";
  private lastOffense: OffenseCallAnswer | null = null;
  private lastDefense: string | null = null;
  private reported = 0;

  constructor(p: Prepared, seat: Seat) {
    this.p = p;
    this.seat = seat;
    this.setup = matchupOf(p, seat.leagueSeed, seat.seed, seat.gameType);
    this.players = gamePlayers(this.setup, p.data);
    this.ai = this.setup.home.coach;
    const rng = Rng.fromSeed(seat.seed);
    this.run = startGame(this.setup, p.data, rng);
    this.rngState = rng.getState();
  }

  /** Starts or resumes a game: replays the log (every answer goes through the same checks). */
  static begin(p: Prepared, seat: Seat, log: readonly Answer[] = []): { loop: StepLoop; first: StepResult } {
    const loop = new StepLoop(p, seat);
    let first = loop.advance();
    for (const a of log) first = loop.answer(a);
    if (log.length > 0) first = { ...first, events: loop.run.events };
    return { loop, first };
  }

  get state(): GameState {
    return this.run.state;
  }

  get pending(): DecisionRequest | null {
    return this.request;
  }

  get events(): GameRecord["events"] {
    return this.run.events;
  }

  record(): GameRecord {
    return recordOf(this.run, this.setup, this.p.data);
  }

  save(): SaveData {
    return { schemaVersion: SAVE_SCHEMA_VERSION, dataHash: this.p.dataHash, ...this.seat, log: [...this.log] };
  }

  /** Answers the pending request. An illegal answer throws AdapterError and changes nothing. */
  answer(a: Answer): StepResult {
    const req = this.request;
    if (req === null) throw new AdapterError("noRequest", "the game is over");
    this.check(req, a);
    if (a.kind === "tempo") {
      this.tempo = a.tempo;
      this.log.push(a);
      this.request = this.build(req.kind === "offenseCall" ? { kind: "offenseCall" } : { kind: "try" });
      return { events: [], request: this.request, state: this.run.state };
    }
    this.stepAnswers.push(a);
    try {
      const r = this.advance();
      this.log.push(a);
      return r;
    } catch (e) {
      this.stepAnswers.pop();
      throw e;
    }
  }

  // ------------------------------------------------------------ the loop

  private advance(): StepResult {
    for (;;) {
      if (this.run.state.phase === "final") {
        this.request = null;
        return this.flush(null);
      }
      const r = this.attempt();
      if ("need" in r) {
        this.request = this.build(r.need);
        return this.flush(this.request);
      }
      this.commit(r.run, r.rng);
    }
  }

  private flush(request: DecisionRequest | null): StepResult {
    const events = this.run.events.slice(this.reported);
    this.reported = this.run.events.length;
    return { events, request, state: this.run.state };
  }

  private commit(run: GameRun, rng: RngState): void {
    const human = this.seat.human;
    for (const ev of run.events.slice(this.run.events.length)) {
      if (ev.t !== "play") continue;
      if (ev.before.possession === human && ev.before.phase === "scrimmage") this.lastOffense = { call: ev.offense.call, ...(ev.offense.formation === undefined ? {} : { formation: ev.offense.formation }) };
      if (ev.before.possession === human && ev.before.phase === "try" && ev.offense.twoPointPlay !== undefined)
        this.lastOffense = { call: ev.offense.twoPointPlay, ...(ev.offense.formation === undefined ? {} : { formation: ev.offense.formation }) };
      if (ev.before.possession !== human && ev.defense !== null) this.lastDefense = ev.defense;
    }
    const prevPossession = this.run.state.possession;
    this.run = run;
    this.rngState = rng;
    this.stepAnswers = [];
    // Tempo resets to Normal at each new drive (design decision 3).
    if (run.state.phase !== "scrimmage" || run.state.possession !== human || prevPossession !== run.state.possession) this.tempo = "normal";
  }

  private attempt(): { need: Need } | { run: GameRun; rng: RngState } {
    const rng = Rng.fromState(this.rngState);
    const cur: Cursor = { i: 0, timeoutAsked: false, kickoffAnswered: false, resolved: null };
    const human = this.seat.human;
    const coach = this.humanPolicies(cur);
    const setup: GameSetup = human === "home" ? { ...this.setup, home: { ...this.setup.home, coach } } : { ...this.setup, away: { ...this.setup.away, coach } };
    const kit: GameKit = { data: this.p.data, resolve: (s, o, d, pl, r) => this.resolveHook(cur, s, o, d, pl, r) };
    try {
      const next = stepGame({ ...this.run, events: [...this.run.events] }, setup, kit, this.players, rng);
      const left = this.stepAnswers.slice(cur.i);
      if (left.length === 1 && cur.i === 0 && left[0]?.kind === "continue" && cur.timeoutAsked) return { run: next, rng: rng.getState() };
      if (left.length > 0) throw new AdapterError("answerNotUsed", `answer ${JSON.stringify(left[0])} had no question in this dead ball`);
      // The dead ball ended with nothing asked of the human (a run-off ran out the period). If a
      // timeout could have stopped the clock, wait for Space first (design decision 17).
      if (this.stepAnswers.length === 0 && cur.timeoutAsked && this.timeoutOption().on) return { need: { kind: "continue", lineUp: "clock" } };
      return { run: next, rng: rng.getState() };
    } catch (e) {
      if (e instanceof NeedInput) return { need: e.need };
      throw e;
    }
  }

  private take<K extends Answer["kind"]>(cur: Cursor, kind: K, need: () => Need): Extract<Answer, { kind: K }> {
    const a = this.stepAnswers[cur.i];
    if (a === undefined) throw new NeedInput(need());
    if (a.kind !== kind) throw new AdapterError("illegalAnswer", `expected a ${kind} answer here, got ${a.kind}`);
    cur.i++;
    return a as Extract<Answer, { kind: K }>;
  }

  private humanPolicies(cur: Cursor): CoachPolicies {
    const ai = this.ai;
    const peekTimeout = (): boolean => {
      cur.timeoutAsked = true;
      if (this.stepAnswers[cur.i]?.kind !== "timeout") return false;
      cur.i++;
      return true;
    };
    return {
      offenseCall: (view) => {
        const a = this.take(cur, "offense", () => (view.phase === "try" ? { kind: "try" } : { kind: "offenseCall" }));
        return a.call as OffenseCall;
      },
      defenseCall: (view) => this.take(cur, "defense", () => ({ kind: "defenseCall", twoPoint: view.phase === "try" })).call,
      timeout: () => peekTimeout(),
      specialTimeout: () => peekTimeout(),
      tempo: (view, rng) => this.humanTempo(view, rng),
      onside: () => {
        const a = this.take(cur, "offense", () => ({ kind: "kickoffType", onsideAllowed: true }));
        cur.kickoffAnswered = true;
        return a.call.call === "onsideKick";
      },
      penalty: (outcomes: readonly PenaltyOutcome[]) => {
        const pending = cur.resolved;
        if (pending === null) throw new AdapterError("illegalAnswer", "a penalty choice with no play");
        const a = this.take(cur, "penalty", () => ({ kind: "penaltyChoice", choices: outcomes.map((o) => ({ option: o.option, after: o.after })), pending }));
        const o = outcomes[a.index];
        if (o === undefined) throw new AdapterError("illegalAnswer", `no penalty option ${a.index}`);
        return o.option;
      },
      // STAND-IN: the ten-second run-off prompt needs the loop to ask after the play (milestone E).
      // Until then the human's team answers it with the average coach's designed rule.
      runoffTimeout: (view) => ai.runoffTimeout(view),
    };
  }

  /**
   * APPROXIMATION of resolved question 13 until milestone E: Normal is the average coach's draw;
   * Hurry-up draws as a team trailing in the final 2:00; Run the clock as a team leading in the
   * final 5:00. Except under Run the clock, the human's own run-off stops a second short of the
   * end of the half, so a called play is always snapped (the M1 loop draws the run-off after the
   * call, so the human can't react to it).
   */
  private humanTempo(view: Parameters<CoachPolicies["tempo"]>[0], rng: Rng): number {
    if (view.beforeTimeout) return this.ai.tempo(view, rng);
    const mode = this.tempo;
    const v = mode === "hurryUp" ? { ...view, quarter: 4, secondsLeftInHalf: 110, secondsLeftInGame: 110, scoreDiff: -7 } : mode === "runClock" ? { ...view, quarter: 4, secondsLeftInHalf: 280, secondsLeftInGame: 280, scoreDiff: 7 } : view;
    const drawn = this.ai.tempo(v, rng);
    return mode === "runClock" ? drawn : Math.min(drawn, Math.max(0, view.secondsLeftInHalf - 1));
  }

  /** Wraps the engine: asks the human to watch an opponent's kick or kneel, and adds onField. */
  private resolveHook(cur: Cursor, s: GameState, o: OffenseCall, d: string | null, players: Players, rng: Rng): PlayResult {
    const human = this.seat.human;
    if (s.possession !== human && d === null) {
      const lineUp: LineUp = s.phase === "kickoff" ? (o.call === "onsideKick" ? "onsideKick" : "kickoff") : s.phase === "try" ? "extraPoint" : (o.call as LineUp);
      this.take(cur, "continue", () => ({ kind: "continue", lineUp }));
    }
    if (s.possession === human && s.phase === "kickoff" && !cur.kickoffAnswered) {
      const a = this.take(cur, "offense", () => ({ kind: "kickoffType", onsideAllowed: false }));
      if (a.call.call !== o.call) throw new AdapterError("illegalAnswer", `${a.call.call} is not allowed on this kickoff`);
    }
    const play = this.p.kit.resolve(s, o, d, players, rng);
    const decorated = this.withOnField(play, s, o, d);
    cur.resolved = { before: snapshotOf(s), offense: o, defense: d, play: decorated };
    return decorated;
  }

  /** ADAPTER for milestone B's `onField`: the players the M1 engine used, when the engine doesn't say. */
  private withOnField(play: PlayResult, s: GameState, o: OffenseCall, d: string | null): PlayResult {
    if (play.detail !== undefined && "onField" in play.detail) return play;
    const P = this.p.data.engine.personnel;
    const off = this.setup[s.possession].pool;
    const def = this.setup[other(s.possession)].pool;
    let unit: { group: "offense" | "kick"; name: string };
    let pkg = "base";
    if (s.phase === "kickoff") unit = { group: "kick", name: "kickoff" };
    else if (o.call === "extraPoint") unit = { group: "kick", name: "extraPoint" };
    else if (o.call === "punt" || o.call === "fieldGoal") unit = { group: "kick", name: o.call };
    else if (o.call === "kneel" || o.call === "spike") unit = { group: "offense", name: "underCenter" };
    else {
      unit = { group: "offense", name: o.formation ?? "" };
      pkg = d === null ? "base" : (P.presetPackage[d] ?? "base");
    }
    const onField = onFieldFor(P, off, def, unit, pkg);
    return onField === undefined ? play : ({ ...play, detail: { ...play.detail, onField } } as PlayResult);
  }

  // ------------------------------------------------------------ requests

  private timeoutOption(): TimeoutOption {
    const s = this.run.state;
    const human = this.seat.human;
    const used = this.stepAnswers.filter((a) => a.kind === "timeout").length;
    const left = s.timeouts[human] - used;
    if (left <= 0) return { on: false, left: Math.max(0, left), reason: "noTimeouts" };
    if (s.timeoutsThisDeadBall[human] + used >= this.p.data.engine.rules.timeouts.perTeamPerDeadBall) return { on: false, left, reason: "timeoutTaken" };
    return { on: true, left };
  }

  private situation(): Situation | null {
    const s = this.run.state;
    return s.phase === "scrimmage" || s.phase === "try" ? toSituation(s, this.p.data.engine.rules) : null;
  }

  private sameOffense(sit: Situation, calls: readonly Option[]): SameCall {
    const last = this.lastOffense;
    if (last === null) return { on: false, reason: "noEarlierCall" };
    if (sit.phase === "try") {
      if (!RUN_PASS.has(last.call)) return { on: false, reason: "onlyRunPassOnTry", offense: last };
      return { on: true, offense: { call: "goForTwo", twoPointPlay: last.call, ...(last.formation === undefined ? {} : { formation: last.formation }) } };
    }
    const on = calls.find((c) => c.id === last.call)?.on === true;
    return on ? { on, offense: last } : { on, reason: "sameCallIllegal", offense: last };
  }

  private build(need: Need): DecisionRequest {
    const s = this.run.state;
    const base = { seq: ++this.seq, team: this.seat.human, view: snapshotOf(s), timeout: this.timeoutOption() };
    const noTimeout: TimeoutOption = { on: false, left: base.timeout.left, reason: "notNow" };
    const sit = this.situation();
    switch (need.kind) {
      case "offenseCall": {
        if (sit === null) throw new AdapterError("illegalAnswer", "an offense call outside a snap");
        const calls = offenseOptions(this.p.index, sit);
        const fg = this.p.data.engine.special.fieldGoals.kickDepth + this.p.data.engine.rules.field.endZoneYards + (100 - s.spot);
        return { ...base, kind: "offenseCall", calls, sameCall: this.sameOffense(sit, calls), tempo: this.tempo, fieldGoalDistance: fg };
      }
      case "try": {
        if (sit === null) throw new AdapterError("illegalAnswer", "a try outside a try");
        const calls = offenseOptions(this.p.index, sit);
        const options: Option[] = [
          { id: "extraPoint", on: true },
          { id: "goForTwo", on: true },
        ];
        return { ...base, kind: "try", options, calls, sameCall: this.sameOffense(sit, calls) };
      }
      case "defenseCall": {
        const calls = this.p.index.defenseLeaves.map((id) => ({ id, on: true }));
        const sameCall: SameCall = this.lastDefense === null ? { on: false, reason: "noEarlierCall" } : { on: true, defense: this.lastDefense };
        return { ...base, kind: "defenseCall", calls, sameCall, twoPoint: need.twoPoint };
      }
      case "kickoffType":
        return {
          ...base,
          kind: "kickoffType",
          options: [{ id: "kickoff", on: true }, need.onsideAllowed ? { id: "onsideKick", on: true } : { id: "onsideKick", on: false, reason: "onsideNotAllowed" }],
          safetyKick: s.safetyKick,
        };
      case "continue":
        return { ...base, kind: "continue", lineUp: need.lineUp };
      case "penaltyChoice":
        return { ...base, timeout: noTimeout, kind: "penaltyChoice", choices: need.choices, pending: need.pending };
    }
  }

  /** Rejects an answer the pending request doesn't offer (spec E5). */
  private check(req: DecisionRequest, a: Answer): void {
    const bad = (why: string): never => {
      throw new AdapterError("illegalAnswer", why);
    };
    const onIn = (opts: readonly Option[], id: string | undefined): boolean => opts.some((o) => o.id === id && o.on);
    const formationOk = (f: string | undefined): boolean => f !== undefined && this.p.index.formations.includes(f);
    switch (a.kind) {
      case "timeout":
        if (!req.timeout.on) bad(`no timeout here (${req.timeout.reason ?? "off"})`);
        return;
      case "continue":
        if (req.kind !== "continue") bad(`a ${req.kind} request needs a choice`);
        return;
      case "penalty":
        if (req.kind !== "penaltyChoice" || !Number.isInteger(a.index) || req.choices[a.index] === undefined) bad("no such penalty option");
        return;
      case "tempo":
        if (req.kind !== "offenseCall") bad("tempo is set only from the offense's Clock menu");
        if (!["hurryUp", "normal", "runClock"].includes(a.tempo)) bad(`unknown tempo ${String(a.tempo)}`);
        return;
      case "defense":
        if (req.kind !== "defenseCall" || !onIn(req.calls, a.call)) bad(`${a.call} is not a defense call here`);
        return;
      case "offense": {
        const c = a.call;
        if (req.kind === "kickoffType") {
          if (!onIn(req.options, c.call) || c.formation !== undefined) bad(`${c.call} is not a kickoff choice here`);
          return;
        }
        if (req.kind === "try") {
          if (c.call === "extraPoint" && c.formation === undefined && c.twoPointPlay === undefined) return;
          if (c.call === "goForTwo" && onIn(req.calls, c.twoPointPlay) && formationOk(c.formation)) return;
          return bad(`${JSON.stringify(c)} is not a try call here`);
        }
        if (req.kind !== "offenseCall") return bad(`a ${req.kind} request takes no offense call`);
        if (!onIn(req.calls, c.call) || c.twoPointPlay !== undefined) return bad(`${c.call} is off here`);
        if (RUN_PASS.has(c.call) !== formationOk(c.formation)) bad(`${c.call} ${RUN_PASS.has(c.call) ? "needs" : "takes no"} formation`);
        return;
      }
      default:
        bad(`${a.kind} answers are not supported yet`);
    }
  }
}
