// The headless CLI (M1 step 5, milestone E): plays one full game between two generated teams with
// the average coach and prints it play by play with the engine's why line and a team box score.
//
//   pnpm sim:game -- --seed <n> [--league-seed <n>] [--game-type regular|postseason] [--format text|json]
//
// The seed, league seed and game type are on the first lines of the output; the same inputs give
// the same game, byte for byte. --format json writes the game record instead. --game-type
// postseason plays overtime periods until someone scores (step 5c, A5); the default is regular.

import { averageCoachFor, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { playGame, prepareGame } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { loadGameData } from "./data";
import { renderGame } from "./render";

export const DEFAULT_SEED = 1;
export const DEFAULT_LEAGUE_SEED = 2026;

function arg(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function seedArg(args: readonly string[], name: string, fallback: number): number {
  const v = arg(args, name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error(`${name} must be a whole number from 0 to 4294967295, got ${v}`);
  return n;
}

export function simGame(args: readonly string[]): string {
  const seed = seedArg(args, "--seed", DEFAULT_SEED);
  const leagueSeed = seedArg(args, "--league-seed", DEFAULT_LEAGUE_SEED);
  const format = arg(args, "--format") ?? "text";
  if (format !== "text" && format !== "json") throw new Error(`--format must be text or json, got ${format}`);
  const gameType = arg(args, "--game-type") ?? "regular";
  if (gameType !== "regular" && gameType !== "postseason") throw new Error(`--game-type must be regular or postseason, got ${gameType}`);
  const data = loadGameData();
  const kit = prepareGame(data);
  const { teams } = leagueFromSeed(data, leagueSeed);
  const coach = averageCoachFor(data);
  const setup = setupGame(teams, leagueSeed, seed, () => coach, gameType === "postseason" ? "postseason" : "regularSeason");
  const record = playGame(setup, kit, Rng.fromSeed(seed));
  return format === "json" ? JSON.stringify(record) + "\n" : renderGame(record, data);
}

if (import.meta.main) {
  try {
    process.stdout.write(simGame(process.argv.slice(2).filter((a) => a !== "--")));
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
}
