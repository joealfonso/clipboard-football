// Shared test helpers: the real data and engine, a scripted human that answers the engine's
// requests by walking their screens, and a whole game played through the worker Session.

import { loadGameData } from "../../../scripts/game/data";
import type { FromWorker } from "../src/engine/protocol";
import { Session, prepare, type Prepared } from "../src/engine/session";
import type { DecisionAnswer, DecisionRequest, GameEvent, GameState, Team } from "../src/engine/types";

let cached: Prepared | null = null;

export function prepared(): Prepared {
  cached ??= prepare(loadGameData(), "test-data-hash", "test-code-hash");
  return cached;
}

/** A tiny deterministic hash so the scripted human varies its picks without an Rng. */
function mix(n: number): number {
  let x = (n + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * A scripted human: from the first screen, picks a legal option (rarely a timeout, never the
 * tempo forever) and follows `opens` to a final option. Varies with the request's seq and salt.
 */
export function scriptedAnswer(req: DecisionRequest, salt = 0): DecisionAnswer {
  const path: string[] = [];
  let screen = req.screens[0];
  let depth = 0;
  while (screen !== undefined) {
    const r = mix(req.seq * 31 + salt * 7 + depth);
    let legal = screen.options.filter((o) => o.legal);
    // Timeouts and tempo changes now and then, not every time.
    if (legal.length > 1 && r % 17 !== 0) legal = legal.filter((o) => o.id !== "timeout");
    if (legal.length > 1 && r % 13 !== 0) legal = legal.filter((o) => !["hurryUp", "normal", "runClock"].includes(o.id));
    const o = legal[r % legal.length];
    if (o === undefined) throw new Error(`no legal option on ${screen.id}`);
    path.push(o.id);
    if (o.opens === undefined) break;
    const next = o.opens;
    screen = req.screens.find((s) => s.id === next);
    depth++;
  }
  return { seq: req.seq, path };
}

export interface Played {
  readonly sent: FromWorker[];
  readonly requests: DecisionRequest[];
  readonly answers: DecisionAnswer[];
  readonly events: GameEvent[];
  readonly state: GameState | null;
  readonly session: Session;
}

/** A whole game through the worker Session, answering every request with the scripted human. */
export function playGame(seed: number, human: Team, salt = 0): Played {
  const sent: FromWorker[] = [];
  const session = new Session(prepared(), (m) => sent.push(structuredClone(m)));
  session.handle({ t: "newGame", leagueSeed: 2026, seed, human });
  const requests: DecisionRequest[] = [];
  const answers: DecisionAnswer[] = [];
  const events: GameEvent[] = [];
  let state: GameState | null = null;
  for (let guard = 0; guard < 5000; guard++) {
    const last = sent[sent.length - 1];
    if (last === undefined || last.t !== "step") throw new Error(`unexpected ${last?.t ?? "nothing"}: ${JSON.stringify(last).slice(0, 300)}`);
    events.push(...last.events);
    state = last.state;
    if (last.request === null) break;
    requests.push(last.request);
    const a = scriptedAnswer(last.request, salt);
    answers.push(a);
    session.handle({ t: "answer", answer: a });
  }
  return { sent, requests, answers, events, state, session };
}
