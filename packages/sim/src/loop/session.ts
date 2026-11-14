// M2 milestone E: the step-wise loop. A session plays one game with one human seat (or none): it
// runs the step 5 loop (stepGame) until a decision the human makes, stops and returns the
// request; the caller answers; the loop goes on to the next request or the end.
//
// How it pauses: each dead ball is replayed from its start (the run and the Rng state at that
// point, the checkpoint) with the answers given so far in it; the human's seat throws a Pause at
// the first decision it has no answer for. Replaying a dead ball repeats the same draws in the
// same order, so the prefix is the same every time, and a session is only ever this checkpoint
// plus a short answer list: plain JSON, no functions or class instances, so it crosses a Web
// Worker boundary and saves to IndexedDB (E3). Seed plus input log replays the game (E2).
//
// Pure: no DOM, no Node API, one seeded Rng.

import type { DecisionAnswer, DecisionRequest, OffenseCallChoice, RequestScreen, SessionErrorCode, Tempo } from "../../../shared/src/types";
import type { Players } from "../engine/resolve";
import { peekToss } from "../game/machine";
import type { Team, TossChoice } from "../game/types";
import { Rng, type RngState } from "../rng";
import { gamePlayers, recordOf, startGame, stepGame, type GameKit, type GameRecord, type GameRun, type GameSetup, type Seat } from "./play";
import { continueRequest, tossRequest, type RequestBody, type RequestDraft } from "./requests";

export const SESSION_SCHEMA_VERSION = 1;

/** The human side's carry-over between dead balls. */
export interface SeatState {
  /** The drive's tempo; Normal again at each new drive. */
  readonly tempo: Tempo;
  /** This side's last calls in this game, for Same call. */
  readonly lastOffense: OffenseCallChoice | null;
  readonly lastDefense: string | null;
}

/** A game in progress with its pending request. Plain JSON. */
export interface Session {
  readonly schemaVersion: number;
  /** The human's team, or null for a game the AI plays on both sides. */
  readonly human: Team | null;
  /** null until the opening toss is settled. */
  readonly run: GameRun | null;
  /** The Rng at the start of the current dead ball (the checkpoint). */
  readonly rng: RngState;
  /** The seat at the checkpoint. */
  readonly seat: SeatState;
  /** Answers given since the checkpoint, in order (option paths). */
  readonly pending: readonly (readonly string[])[];
  /** The request waiting for an answer; null once the game is over. */
  readonly request: DecisionRequest | null;
  /** Every answer of the game, in order. */
  readonly inputs: readonly DecisionAnswer[];
  /** The last request's seq. */
  readonly seq: number;
}

export interface SessionError {
  readonly code: SessionErrorCode;
  readonly message: string;
}

/** answerSession never throws for a bad answer: it returns the error and the session is unchanged (E5). */
export type AnswerResult = { readonly ok: true; readonly session: Session } | { readonly ok: false; readonly error: SessionError };

class Pause {
  readonly request: RequestDraft;
  constructor(request: RequestDraft) {
    this.request = request;
  }
}

const NORMAL: SeatState = { tempo: "normal", lastOffense: null, lastDefense: null };

const playersCache = new WeakMap<GameSetup, Players>();
function playersOf(setup: GameSetup, kit: GameKit): Players {
  let p = playersCache.get(setup);
  if (p === undefined) {
    p = gamePlayers(setup, kit.data);
    playersCache.set(setup, p);
  }
  return p;
}

function makeSeat(team: Team, state: SeatState, answers: readonly (readonly string[])[]): Seat {
  let i = 0;
  return {
    team,
    tempo: state.tempo,
    lastOffense: state.lastOffense,
    lastDefense: state.lastDefense,
    ask(make) {
      const a = answers[i];
      if (a !== undefined) {
        i++;
        return a;
      }
      throw new Pause(make());
    },
  };
}

/** Runs dead balls from the checkpoint until a request or the end. */
function advance(session: Session, setup: GameSetup, kit: GameKit): Session {
  let cur = session;
  const human = cur.human;
  for (;;) {
    if (cur.run !== null && cur.run.state.phase === "final") return { ...cur, request: null };
    const rng = Rng.fromState(cur.rng);
    const seat = human === null ? null : makeSeat(human, cur.seat, cur.pending);
    try {
      let run: GameRun;
      if (cur.run === null) {
        // The opening toss: the human winner chooses; otherwise the designed default (defer) and a result screen.
        let choice: TossChoice | undefined;
        if (seat !== null) {
          const winner = peekToss(rng);
          // Before the game exists there is no state; the request says so (state null).
          const pre = (b: RequestBody): RequestDraft => ({ ...b, state: null, events: [] }) as RequestDraft;
          if (winner === seat.team) choice = seat.ask(() => pre(tossRequest(seat.team, false)))[0] as TossChoice;
          else seat.ask(() => pre(continueRequest(seat.team, { what: "tossResult", winner, choice: "defer" }, null)));
        }
        run = startGame(setup, kit.data, rng, choice);
      } else {
        // stepGame appends to the events array it is given, so give it a copy: the checkpoint stays as it was.
        run = stepGame({ ...cur.run, events: [...cur.run.events] }, setup, kit, playersOf(setup, kit), rng, seat);
      }
      const s = run.state;
      const drive = human !== null && s.phase === "scrimmage" && s.possession === human;
      const carry: SeatState = seat === null ? NORMAL : { tempo: drive ? seat.tempo : "normal", lastOffense: seat.lastOffense, lastDefense: seat.lastDefense };
      cur = { ...cur, run, rng: rng.getState(), seat: carry, pending: [] };
    } catch (e) {
      if (!(e instanceof Pause)) throw e;
      const seq = cur.seq + 1;
      return { ...cur, seq, request: { ...e.request, seq } as DecisionRequest };
    }
  }
}

/** A new game: runs to the first request (the toss, for a human seat) or to the end with none. */
export function startSession(setup: GameSetup, kit: GameKit, human: Team | null): Session {
  const s: Session = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    human,
    run: null,
    rng: Rng.fromSeed(setup.seed).getState(),
    seat: NORMAL,
    pending: [],
    request: null,
    inputs: [],
    seq: 0,
  };
  return advance(s, setup, kit);
}

/** Checks a path against the request's screens: every step an option there, legal, ending on a final option. */
export function checkPath(request: DecisionRequest, path: readonly string[]): SessionError | null {
  if (path.length === 0) return { code: "incompletePath", message: "the answer has no option" };
  let screen: RequestScreen | undefined = request.screens[0];
  for (const [i, id] of path.entries()) {
    if (screen === undefined) return { code: "unknownOption", message: `${path.slice(0, i).join(" > ")} opens no screen` };
    const o = screen.options.find((x) => x.id === id);
    if (o === undefined) return { code: "unknownOption", message: `no option ${id} on ${screen.id}` };
    if (!o.legal) return { code: "illegalOption", message: `${id} is off on ${screen.id} (${o.reason ?? "no reason"})` };
    if (o.opens === undefined) return i === path.length - 1 ? null : { code: "unknownOption", message: `${id} on ${screen.id} is final; the answer goes on` };
    const next = o.opens;
    screen = request.screens.find((x) => x.id === next);
  }
  return { code: "incompletePath", message: `${path.join(" > ")} stops before a final option` };
}

/** Answers the pending request. A bad answer returns an error and leaves the session as it was. */
export function answerSession(session: Session, setup: GameSetup, kit: GameKit, answer: DecisionAnswer): AnswerResult {
  const r = session.request;
  if (r === null) return { ok: false, error: { code: "noRequest", message: "the session is not waiting for an answer" } };
  if (answer.seq !== r.seq) return { ok: false, error: { code: "staleRequest", message: `answer to request ${answer.seq}, waiting on ${r.seq}` } };
  const bad = checkPath(r, answer.path);
  if (bad !== null) return { ok: false, error: bad };
  const path = [...answer.path];
  const next: Session = { ...session, request: null, pending: [...session.pending, path], inputs: [...session.inputs, { seq: answer.seq, path }] };
  return { ok: true, session: advance(next, setup, kit) };
}

/** The game record so far (the full record once the game is over). */
export function sessionRecord(session: Session, setup: GameSetup, kit: GameKit): GameRecord {
  if (session.run === null) throw new RangeError("the opening toss is not settled yet");
  return recordOf(session.run, setup, kit.data);
}

/** E2: a session from its setup and input log alone. Throws on an answer the replay rejects. */
export function replaySession(setup: GameSetup, kit: GameKit, human: Team | null, inputs: readonly DecisionAnswer[]): Session {
  let s = startSession(setup, kit, human);
  for (const a of inputs) {
    const r = answerSession(s, setup, kit, a);
    if (!r.ok) throw new RangeError(`input ${a.seq} rejected: ${r.error.code} ${r.error.message}`);
    s = r.session;
  }
  return s;
}
