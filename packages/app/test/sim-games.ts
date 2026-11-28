// Simulated games shared by the calling screen pass spec tests: each played once per test file
// through the worker Session with the scripted human, alternating which side he coaches.

import type { Matchup } from "../src/engine/protocol";
import type { PlayEvent, Team } from "../src/engine/types";
import type { TextCtx } from "../src/ui/text";
import { playGame, type Played } from "./support";

export interface SimGame extends Played {
  readonly seed: number;
  readonly human: Team;
  readonly matchup: Matchup;
  readonly plays: readonly PlayEvent[];
}

const cache = new Map<string, SimGame>();

export function simGame(seed: number, human: Team = seed % 2 === 0 ? "home" : "away"): SimGame {
  const key = `${seed}:${human}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const p = playGame(seed, human);
  const first = p.sent.find((m) => m.t === "step");
  if (first === undefined || first.t !== "step") throw new Error("no step");
  const g: SimGame = { ...p, seed, human, matchup: first.matchup, plays: p.events.filter((e): e is PlayEvent => e.t === "play") };
  cache.set(key, g);
  return g;
}

export function simGames(n: number, from = 1): SimGame[] {
  return Array.from({ length: n }, (_, i) => simGame(from + i));
}

/** The text context the App builds for a game (app.ts textCtx). */
export function ctxOf(g: { readonly matchup: Matchup; readonly human: Team }, labels: Readonly<Record<string, string>>): TextCtx {
  const players = new Map<string, { name: string; number: number }>();
  for (const t of [g.matchup.home, g.matchup.away]) for (const p of t.pool.players) players.set(p.id, { name: p.name, number: p.number });
  return { human: g.human, teams: { home: g.matchup.home, away: g.matchup.away }, players, labels, regulationPeriods: 4, endZoneYards: 10 };
}
