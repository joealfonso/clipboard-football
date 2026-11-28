// M2 F: the per-game cost of standout plays. Plays the first in-sample league's 1,000 games with
// standouts off and on, alternating blocks of 100 so drift hits both, after a warm-up.
//
//   node --import ./scripts/engine/register.mjs scripts/game/standout-perf.ts

import { averageCoachFor, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { playGame, prepareGame } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { loadGameData } from "./data";
import { runSeeds } from "./metrics";

const data = loadGameData();
const lg = data.config.league;
const seeds = runSeeds(lg.calibrationSeed, lg.leagues, lg.gamesPerLeague);
const leagueSeed = seeds.leagueSeeds[0] as number;
const { teams } = leagueFromSeed(data, leagueSeed);
const games = seeds.games(data, 0);
const coach = averageCoachFor(data);
const kits = { off: prepareGame(data, { standouts: false }), on: prepareGame(data, { standouts: true }) };
const play = (k: keyof typeof kits, seed: number): void => void playGame(setupGame(teams, leagueSeed, seed, () => coach), kits[k], Rng.fromSeed(seed));
for (const seed of games.slice(0, 100)) {
  play("off", seed);
  play("on", seed);
}
const ms = { off: 0, on: 0 };
for (let b = 0; b < games.length; b += 100) {
  for (const k of (b / 100) % 2 === 0 ? (["off", "on"] as const) : (["on", "off"] as const)) {
    const t0 = performance.now();
    for (const seed of games.slice(b, b + 100)) play(k, seed);
    ms[k] += performance.now() - t0;
  }
}
const off = ms.off / games.length;
const on = ms.on / games.length;
process.stdout.write(`[standout-perf] ${games.length} games each: off ${off.toFixed(3)} ms per game, on ${on.toFixed(3)} ms (+${(on - off).toFixed(3)} ms, +${((on / off - 1) * 100).toFixed(1)}%)\n`);
