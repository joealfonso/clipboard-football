// Tunes the designed league parameters on the 2016-2023 training games only (M1 step 5, D and
// resolved question 6), and writes them with the full tuning record to data/game/league.json.
//
//   node --import ./scripts/engine/register.mjs scripts/game/tune.ts
//
// crowdNoise: the measured home-vs-away gap in offensive pre-snap foul rates (actuals.json
// "training", non-neutral games, 2020 excluded). teamStrength.sd: grid over whole-point SDs with
// home field off, linear interpolation to the training margin SD. homeField.ratingEdge: grid with
// that SD, linear interpolation to the training home margin (2020 and neutral sites excluded).
// Never reads a 2024 or 2025 number: actuals.json's "holdout" block is not opened.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LeagueSettings } from "../../packages/shared/src/types";
import { GAME_FILES, REPO, loadGameData } from "./data";
import { runLeagues } from "./metrics";

const TUNING_SEED = 77_2026;
const LEAGUES = 4;
const GAMES = 1000;
const SD_GRID = [0, 2, 4, 6];
const EDGE_GRID = [0, 0.5, 1, 1.5];
/** The edge grid runs twice the games: the home margin moves about 3 points per rating point. */
const EDGE_LEAGUES = 8;

interface Training {
  readonly inSample: { readonly seasons: number[]; readonly metrics: Record<string, { value: number; n: number }> };
  readonly training: { readonly seasons: number[]; readonly crowdNoise: number; readonly homeOffensePreSnapRate: number; readonly awayOffensePreSnapRate: number };
}

function interpolate(xs: readonly number[], ys: readonly number[], target: number): number {
  for (let i = 1; i < xs.length; i++) {
    const [x0, x1, y0, y1] = [xs[i - 1] as number, xs[i] as number, ys[i - 1] as number, ys[i] as number];
    if ((target - y0) * (target - y1) <= 0 && y1 !== y0) return x0 + ((target - y0) * (x1 - x0)) / (y1 - y0);
  }
  // Outside the grid: the nearest end.
  return Math.abs(target - (ys[0] as number)) < Math.abs(target - (ys[ys.length - 1] as number)) ? (xs[0] as number) : (xs[xs.length - 1] as number);
}

function main(): void {
  const actual = JSON.parse(readFileSync(join(REPO, "data/game/actuals.json"), "utf8")) as Training;
  const base = JSON.parse(readFileSync(join(REPO, GAME_FILES.league), "utf8")) as LeagueSettings & { note?: string };
  const targets = {
    marginSd: actual.inSample.metrics["margin.sd"]?.value ?? NaN,
    homeMargin: actual.inSample.metrics["homeMargin.mean"]?.value ?? NaN,
    homeWin: actual.inSample.metrics["homeWin.rate"]?.value ?? NaN,
  };
  const crowd = Math.round(actual.training.crowdNoise * 1000) / 1000;
  const run = (sd: number, edge: number, c: number, leagues = LEAGUES): { marginSd: number; homeMargin: number; homeWin: number } => {
    const league: LeagueSettings = { ...base, homeField: { ratingEdge: edge, crowdNoise: c }, teamStrength: { sd } };
    const data = loadGameData({ override: { [GAME_FILES.league]: league } });
    const r = runLeagues(data, { runSeed: TUNING_SEED, leagues, gamesPerLeague: GAMES });
    const v = (id: string): number => r.all.get(id)?.value() ?? NaN;
    const out = { marginSd: v("margin.sd"), homeMargin: v("homeMargin.mean"), homeWin: v("homeWin.rate") };
    process.stderr.write(`[tune] sd ${sd} edge ${edge} crowd ${c}: ${JSON.stringify(out)}\n`);
    return out;
  };
  const sdRuns = SD_GRID.map((sd) => ({ sd, ...run(sd, 0, 0) }));
  const sd = Math.round(interpolate(SD_GRID, sdRuns.map((r) => r.marginSd), targets.marginSd) * 10) / 10;
  const edgeRuns = EDGE_GRID.map((e) => ({ edge: e, ...run(sd, e, crowd, EDGE_LEAGUES) }));
  const edge = Math.round(interpolate(EDGE_GRID, edgeRuns.map((r) => r.homeMargin), targets.homeMargin) * 100) / 100;
  const check = run(sd, edge, crowd, EDGE_LEAGUES);
  const out = {
    ...base,
    homeField: { ratingEdge: edge, crowdNoise: crowd },
    teamStrength: { sd },
    tuning: {
      status: "tuned",
      date: "2026-11-11",
      command: "node --import ./scripts/engine/register.mjs scripts/game/tune.ts",
      seasons: actual.inSample.seasons,
      homeFieldSeasons: actual.training.seasons,
      note: "Training targets only (2016-2023; home field without 2020 and neutral sites). No 2024 or 2025 number was read.",
      targets,
      crowdNoiseFrom: { homeOffensePreSnapRate: actual.training.homeOffensePreSnapRate, awayOffensePreSnapRate: actual.training.awayOffensePreSnapRate },
      seed: TUNING_SEED,
      gamesPerPoint: { sdGrid: LEAGUES * GAMES, edgeGrid: EDGE_LEAGUES * GAMES },
      sdGrid: sdRuns,
      edgeGrid: edgeRuns,
      check: { sd, edge, crowd, ...check },
    },
  };
  writeFileSync(join(REPO, GAME_FILES.league), JSON.stringify(out, null, 2) + "\n");
  process.stderr.write(`[tune] wrote ${GAME_FILES.league}: sd ${sd}, edge ${edge}, crowd ${crowd}\n`);
}

main();
