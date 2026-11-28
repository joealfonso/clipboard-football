// M2 E9: time from an answer to the next request, over the in-sample CI slice played with a
// scripted human seat (home in even games, away in odd). The script answers each request with a
// seeded random legal path. Prints p50, p99 and max in milliseconds; docs/PERF.md records runs.
//
//   node --import ./scripts/engine/register.mjs scripts/game/session-perf.ts [games]

import type { DecisionRequest } from "../../packages/shared/src/types";
import { averageCoachFor, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { prepareGame } from "../../packages/sim/src/loop/play";
import { answerSession, startSession } from "../../packages/sim/src/loop/session";
import { Rng } from "../../packages/sim/src/rng";
import { loadGameData } from "./data";
import { runSeeds } from "./metrics";

/** A seeded random legal path through a request's screens. */
export function randomPath(r: DecisionRequest, rng: Rng): string[] {
  const path: string[] = [];
  let screen = r.screens[0];
  while (screen !== undefined) {
    const legal = screen.options.filter((o) => o.legal);
    const o = legal[Math.floor(rng.nextFloat() * legal.length)];
    if (o === undefined) throw new RangeError(`no legal option on ${screen.id}`);
    path.push(o.id);
    if (o.opens === undefined) return path;
    const next = o.opens;
    screen = r.screens.find((x) => x.id === next);
  }
  throw new RangeError(`${path.join(" > ")} opens no screen`);
}

function main(): number {
  const data = loadGameData();
  const kit = prepareGame(data);
  const coach = averageCoachFor(data);
  const lg = data.config.league;
  const games = Number(process.argv[2] ?? lg.ciSliceGames);
  const seeds = runSeeds(lg.calibrationSeed, lg.leagues, lg.gamesPerLeague);
  const leagueSeed = seeds.leagueSeeds[0] as number;
  const { teams } = leagueFromSeed(data, leagueSeed);
  const times: number[] = [];
  const t0 = performance.now();
  seeds.games(data, 0).slice(0, games).forEach((seed, i) => {
    const setup = setupGame(teams, leagueSeed, seed, () => coach);
    const bot = Rng.fromSeed(seed);
    let s = startSession(setup, kit, i % 2 === 0 ? "home" : "away");
    while (s.request !== null) {
      const path = randomPath(s.request, bot);
      const a = performance.now();
      const r = answerSession(s, setup, kit, { seq: s.request.seq, path });
      times.push(performance.now() - a);
      if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
      s = r.session;
    }
  });
  times.sort((a, b) => a - b);
  const q = (p: number): string => (times[Math.min(times.length - 1, Math.floor(times.length * p))] ?? 0).toFixed(3);
  process.stdout.write(`[session-perf] ${games} games, ${times.length} answers, ${((performance.now() - t0) / 1000).toFixed(1)} s: p50 ${q(0.5)} ms, p99 ${q(0.99)} ms, max ${(times[times.length - 1] ?? 0).toFixed(2)} ms\n`);
  return 0;
}

if (import.meta.main) process.exitCode = main();
