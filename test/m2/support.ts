// Shared helpers for the M2 spec tests (docs/specs/m2-engine-and-game-loop.md, milestones A to E):
// the real game data, a league, and a scripted human seat that answers requests by a fixed rule
// of the request alone (so a resumed run answers exactly as the uninterrupted one).

import type { DecisionAnswer, DecisionRequest, RequestOption, RequestScreen } from "../../packages/shared/src/types";
import type { CoachPolicies } from "../../packages/sim/src/loop/coach";
import { averageCoachFor, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { prepareGame, type GameKit, type GameSetup } from "../../packages/sim/src/loop/play";
import { answerSession, startSession, type Session } from "../../packages/sim/src/loop/session";
import { loadGameData } from "../../scripts/game/data";
import { runSeeds as seedsOf } from "../../scripts/game/metrics";

export const data = loadGameData();
export const kit = prepareGame(data);
export const coach = averageCoachFor(data);
export const LEAGUE_SEED = 2026;
export const { teams } = leagueFromSeed(data, LEAGUE_SEED);
export const setupFor = (seed: number, c: CoachPolicies = coach): GameSetup => setupGame(teams, LEAGUE_SEED, seed, () => c);

/** Every path from screens[0] to a final option, legal options only or every option. */
export function finalPaths(r: DecisionRequest, legalOnly: boolean): string[][] {
  const out: string[][] = [];
  const walk = (screen: RequestScreen | undefined, prefix: string[], depth: number): void => {
    if (screen === undefined || depth > 8) return;
    for (const o of screen.options) {
      if (legalOnly && !o.legal) continue;
      const path = [...prefix, o.id];
      if (o.opens === undefined) out.push(path);
      else walk(r.screens.find((s) => s.id === o.opens), path, depth + 1);
    }
  };
  walk(r.screens[0], [], 0);
  return out;
}

/** Every off option with the path that reaches it (the path's last id is the off option). */
export function offPaths(r: DecisionRequest): { path: string[]; option: RequestOption }[] {
  const out: { path: string[]; option: RequestOption }[] = [];
  const walk = (screen: RequestScreen | undefined, prefix: string[], depth: number): void => {
    if (screen === undefined || depth > 8) return;
    for (const o of screen.options) {
      const path = [...prefix, o.id];
      if (!o.legal) out.push({ path, option: o });
      else if (o.opens !== undefined) walk(r.screens.find((s) => s.id === o.opens), path, depth + 1);
    }
  };
  walk(r.screens[0], [], 0);
  return out;
}

/** A 32-bit hash of the inputs, for answers that are a pure function of the request. */
export function mix(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h = Math.imul(h ^ (x >>> 0), 0x01000193) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d) >>> 0;
    h ^= h >>> 12;
  }
  return h >>> 0;
}

export type Bot = (r: DecisionRequest) => readonly string[];

/**
 * The bot's path order, kept as it was before the screens went formation first (play-calling
 * spec, Resolved 2): the formation paths, ["formation", f, "run"|"pass", play] (also after
 * "goForTwo"), sorted run before pass, then by formation, then play, which is the order the old
 * ["run"|"pass", f, play] paths came in. Same order, same weights, so the scripted games make the
 * same calls as before and their records are unchanged.
 */
function classFirstOrder(paths: readonly string[][]): string[][] {
  const at = (p: readonly string[]): number => p.indexOf("formation");
  const out = [...paths];
  const idx = out.map((p, i) => (at(p) >= 0 ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return out;
  const block = idx.map((i) => out[i] as string[]);
  const pos = new Map(block.map((p, i) => [p, i]));
  // Run before pass; within a class the DFS order already runs formation, then play.
  const cls = (p: readonly string[]): number => (p[at(p) + 2] === "run" ? 0 : 1);
  const sorted = [...block].sort((a, b) => cls(a) - cls(b) || (pos.get(a) as number) - (pos.get(b) as number));
  idx.forEach((i, j) => (out[i] = sorted[j] as string[]));
  return out;
}

export interface BotStyle {
  /** Weight of the timeout option when legal (others weigh 1). */
  readonly timeout?: number;
  /** Weight of the Clock option when legal. */
  readonly clock?: number;
  /** Weight of Kick on 4th down. */
  readonly kick4?: number;
  /** Weight of onside on a kickoff. */
  readonly onside?: number;
  /** Weight of going for two on a try. */
  readonly two?: number;
  /** A path that overrides the bot when it is legal for this request (or null). */
  readonly prefer?: (r: DecisionRequest) => readonly string[] | null;
}

/** A scripted human: a fixed weighted rule of (seed, request seq, request), never of hidden state. */
export function scriptedBot(seed: number, style: BotStyle = {}): Bot {
  return (r) => {
    const pref = style.prefer?.(r) ?? null;
    if (pref !== null) return pref;
    const paths = classFirstOrder(finalPaths(r, true));
    const weight = (p: readonly string[]): number => {
      const first = p[0] ?? "";
      if (first === "timeout") return style.timeout ?? 0.02;
      if (first === "clock") return p[1] === "hurryUp" || p[1] === "runClock" ? (style.clock ?? 0.05) : 0.01;
      if (first === "kick") return r.state?.down === 4 ? (style.kick4 ?? 6) : 0.05;
      if (first === "onsideKick") return style.onside ?? 0.05;
      if (first === "goForTwo") return style.two ?? 0.02;
      if (first === "sameCall") return 0.5;
      // Formation first: a run or pass starts with "formation".
      if (r.kind === "offenseCall" && r.state?.down === 4 && first === "formation") return 0.02;
      return 1;
    };
    const ws = paths.map(weight);
    const total = ws.reduce((a, b) => a + b, 0);
    let u = (mix(seed, r.seq, r.kind.length) / 2 ** 32) * total;
    for (let i = 0; i < paths.length; i++) {
      u -= ws[i] as number;
      if (u < 0) return paths[i] as string[];
    }
    return paths[paths.length - 1] as string[];
  };
}

export interface Asked {
  /** The session holding the request, before it is answered. */
  readonly before: Session;
  readonly request: DecisionRequest;
  readonly answer: DecisionAnswer;
}

/** Plays a session to the end with the bot. Returns the final session and every request asked. */
export function playSession(setup: GameSetup, k: GameKit, human: "home" | "away" | null, bot: Bot, from?: Session): { session: Session; asked: Asked[] } {
  let s = from ?? startSession(setup, k, human);
  const asked: Asked[] = [];
  for (let guard = 0; s.request !== null; guard++) {
    if (guard > 20_000) throw new Error("session did not end");
    const request = s.request;
    const answer = { seq: request.seq, path: bot(request) };
    const r = answerSession(s, setup, k, answer);
    if (!r.ok) throw new Error(`bot answer rejected: ${r.error.code} ${r.error.message} (${answer.path.join(" > ")})`);
    asked.push({ before: s, request, answer });
    s = r.session;
  }
  return { session: s, asked };
}

/** Deep-freezes a value in place (for "never mutates" checks: a write throws in strict mode). */
export function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as object)) deepFreeze(v);
  }
  return x;
}

/** The first `n` games of the CI slice (league 0 of the in-sample run), with their setups. */
export function sliceGames(n: number): { seed: number; setup: GameSetup; index: number }[] {
  const lg = data.config.league;
  const seeds = seedsOf(lg.calibrationSeed, lg.leagues, lg.gamesPerLeague);
  const leagueSeed = seeds.leagueSeeds[0] as number;
  const league = leagueFromSeed(data, leagueSeed).teams;
  return seeds.games(data, 0).slice(0, n).map((seed, index) => ({ seed, index, setup: setupGame(league, leagueSeed, seed, () => coach) }));
}
