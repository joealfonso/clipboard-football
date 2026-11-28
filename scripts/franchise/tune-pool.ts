// Tunes data/franchise/pool.json `adjust` and `standoutCentering` (docs/specs/m4-franchise-core.md,
// Tuning). Simulated leagues only: the tuning seeds, which no check reads.
//
//   node --import ./scripts/engine/register.mjs scripts/franchise/tune-pool.ts [--jobs 4] [--write]
//
// From scale 1 and offset 0, each pass drafts every tuning league (all AI), then for each rating the
// overall weights name adds league mean - deployed mean to its offset and multiplies its scale by quick play's
// deployed SD over the franchise's. Ratings are whole numbers, so near scale 1 a small move can jump
// the mean, and moving all of them every pass may never settle: after FULL_PASSES a rating already inside
// half its tolerance stays where it is and an offset moves by half its gap. It stops when every one is inside half its A5 and A10 tolerance, then sets each standout kind's centering to the inverse of its mean raw factor over
// franchise games, and prints the file's values (--write writes them, with the record).

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { POSITIONS } from "../../packages/shared/src/engine";
import type { Position, StandoutKindId } from "../../packages/shared/src/engine";
import type { FranchiseData, PoolAdjust, PoolConfig } from "../../packages/shared/src/franchise";
import { leagueMeans } from "../../packages/sim/src/engine/effects";
import { franchiseKit } from "../../packages/sim/src/franchise/index";
import { A10_SD_TOLERANCE, A5_TOLERANCE, A6A_GAMES_PER_LEAGUE, TUNING_FIRST_SEED, TUNING_LEAGUES } from "../../packages/sim/test/franchise/tolerances";
import { REPO, sha256 } from "../game/data";
import { FRANCHISE_FILES, loadFranchise, readJson } from "./data";
import { addDrafted, addQuickPlay, deploymentWeights, draftedLeague, draftedTeams, gameMeans, mergeGames, mergeTally, moments, newGameSums, newTally, playLeague } from "./measure";
import type { DeploymentWeights, GameSums, Tally } from "./measure";

const MAX_PASSES = 20;
/** Passes that move every rating all the way. */
const FULL_PASSES = 3;
/** Leagues of the tuning range the standout centering is measured on. */
const CENTERING_LEAGUES = 100;

type Adjust = Record<Position, Record<string, PoolAdjust>>;
type Job =
  | { readonly kind: "drafted" | "quickPlay"; readonly first: number; readonly count: number; readonly pool: unknown; readonly weights: DeploymentWeights }
  | { readonly kind: "games"; readonly first: number; readonly count: number; readonly pool: unknown; readonly weights: DeploymentWeights };

function runJob(job: Job): Tally | GameSums {
  const data = loadFranchise({ pool: job.pool });
  if (job.kind === "games") {
    const sums = newGameSums();
    const kit = franchiseKit(data, { standouts: true });
    for (let seed = job.first; seed < job.first + job.count; seed++) playLeague(sums, kit, draftedTeams(draftedLeague(data, seed), data), seed, A6A_GAMES_PER_LEAGUE, true);
    return sums;
  }
  const t = newTally();
  for (let seed = job.first; seed < job.first + job.count; seed++) {
    if (job.kind === "drafted") addDrafted(t, data, draftedLeague(data, seed), job.weights);
    else addQuickPlay(t, data, seed, job.weights);
  }
  return t;
}

function runAll(kind: Job["kind"], leagues: number, pool: unknown, weights: DeploymentWeights, jobs: number): Promise<(Tally | GameSums)[]> {
  const per = Math.ceil(leagues / jobs);
  return Promise.all(
    Array.from({ length: Math.ceil(leagues / per) }, (_, i) => {
      const job: Job = { kind, first: TUNING_FIRST_SEED + i * per, count: Math.min(per, leagues - i * per), pool, weights };
      return new Promise<Tally | GameSums>((done, failed) => {
        const w = new Worker(fileURLToPath(import.meta.url), { workerData: job });
        w.once("message", done);
        w.once("error", failed);
      });
    }),
  );
}

async function tally(kind: "drafted" | "quickPlay", pool: unknown, weights: DeploymentWeights, jobs: number): Promise<Tally> {
  const t = newTally();
  for (const part of await runAll(kind, TUNING_LEAGUES, pool, weights, jobs)) mergeTally(t, part as Tally);
  return t;
}

function gaps(data: FranchiseData, t: Tally, quick: Tally, over: (p: Position, r: string) => boolean): { mean: number; sd: number; meanAt: string; sdAt: string } {
  const centers = leagueMeans(data.game.engine.distributions);
  const out = { mean: 0, sd: 0, meanAt: "", sdAt: "" };
  for (const p of POSITIONS) {
    for (const r of Object.keys(centers[p] ?? {})) {
      if (!over(p, r)) continue;
      const m = moments(t, p, r);
      const mean = Math.abs(m.mean - (centers[p]?.[r] as number));
      const sd = Math.abs(m.sd / moments(quick, p, r).sd - 1);
      if (mean > out.mean) Object.assign(out, { mean, meanAt: `${p}.${r}` });
      if (sd > out.sd) Object.assign(out, { sd, sdAt: `${p}.${r}` });
    }
  }
  return out;
}

const round = (x: number, places: number): number => Math.round(x * 10 ** places) / 10 ** places;

/** Two-space JSON with short objects and lists kept on one line, as the hand-written data files are. */
export function pretty(x: unknown, indent = ""): string {
  const flat = JSON.stringify(x);
  if (x === null || typeof x !== "object") return flat;
  const spaced = flat.replace(/([:,])/g, "$1 ").replace(/^\{/, "{ ").replace(/\}$/, " }");
  if (Array.isArray(x)) return spaced;
  if (indent !== "" && spaced.length <= 80 && !Object.values(x).some((v) => v !== null && typeof v === "object")) return spaced;
  return `{\n${Object.entries(x).map(([k, v]) => `${indent}  ${JSON.stringify(k)}: ${pretty(v, `${indent}  `)}`).join(",\n")}\n${indent}}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jobs = args.includes("--jobs") ? Number(args[args.indexOf("--jobs") + 1]) : 4;
  const file = readJson(FRANCHISE_FILES.pool) as PoolConfig;
  const base = loadFranchise();
  const weights = deploymentWeights(base.game);
  const weighs = (p: Position, r: string): boolean => Object.hasOwn(base.overallWeights[p] ?? {}, r);
  const centers = leagueMeans(base.game.engine.distributions);
  const adjust = Object.fromEntries(POSITIONS.map((p) => [p, Object.fromEntries(Object.keys(base.overallWeights[p] ?? {}).map((r) => [r, { scale: 1, offset: 0 }]))])) as Adjust;
  const quick = await tally("quickPlay", file, weights, jobs);
  let passes = 0;
  let gap = { mean: Infinity, sd: Infinity, meanAt: "", sdAt: "" };
  for (; passes < MAX_PASSES; passes++) {
    const t = await tally("drafted", { ...file, adjust }, weights, jobs);
    gap = gaps(base, t, quick, weighs);
    const plain = gaps(base, t, quick, (p, r) => !weighs(p, r));
    console.error(`[tune-pool] pass ${passes}: weighted mean ${gap.mean.toFixed(3)} (${gap.meanAt}), SD ${gap.sd.toFixed(3)} (${gap.sdAt}); not weighted mean ${plain.mean.toFixed(3)} (${plain.meanAt}), SD ${plain.sd.toFixed(3)} (${plain.sdAt})`);
    if (gap.mean <= A5_TOLERANCE / 2 && gap.sd <= A10_SD_TOLERANCE / 2) break;
    const settling = passes >= FULL_PASSES;
    for (const p of POSITIONS) {
      for (const [r, a] of Object.entries(adjust[p])) {
        const m = moments(t, p, r);
        const off = (centers[p]?.[r] as number) - m.mean;
        const ratio = moments(quick, p, r).sd / m.sd;
        adjust[p][r] = {
          scale: settling && Math.abs(1 / ratio - 1) <= A10_SD_TOLERANCE / 2 ? a.scale : round(a.scale * ratio, 4),
          offset: settling && Math.abs(off) <= A5_TOLERANCE / 2 ? a.offset : round(a.offset + (settling ? 0.5 : 1) * off, 3),
        };
      }
    }
  }
  if (gap.mean > A5_TOLERANCE / 2 || gap.sd > A10_SD_TOLERANCE / 2) throw new Error(`did not settle in ${MAX_PASSES} passes`);
  const ones = Object.fromEntries(Object.keys(file.standoutCentering).map((k) => [k, 1]));
  const games = newGameSums();
  for (const part of await runAll("games", CENTERING_LEAGUES, { ...file, adjust, standoutCentering: ones }, weights, jobs)) mergeGames(games, part as GameSums);
  const { factors } = gameMeans(games);
  const standoutCentering = Object.fromEntries(Object.keys(ones).map((k) => [k, round(1 / (factors[k as StandoutKindId] as number), 6)]));
  console.error(`[tune-pool] centering over ${games.games} games: ${JSON.stringify(standoutCentering)}`);
  const out = {
    ...file,
    adjust,
    standoutCentering,
    tuning: {
      date: new Date().toISOString().slice(0, 10),
      command: "node --import ./scripts/engine/register.mjs scripts/franchise/tune-pool.ts --write",
      firstSeed: TUNING_FIRST_SEED,
      leagues: TUNING_LEAGUES,
      passes,
      worstMean: round(gap.mean, 3),
      worstSd: round(gap.sd, 3),
      draftAiSha256: sha256(JSON.stringify(readJson(FRANCHISE_FILES.draftAi))),
      rosterSha256: sha256(JSON.stringify(readJson(FRANCHISE_FILES.roster))),
      note: `Over the ratings the overall weights name. Standout centering over the first ${CENTERING_LEAGUES} tuning leagues, ${A6A_GAMES_PER_LEAGUE} games each.`,
    },
  };
  const text = `${pretty(out)}\n`;
  if (args.includes("--write")) writeFileSync(join(REPO, FRANCHISE_FILES.pool), text);
  else console.log(text);
}

if (isMainThread) await main();
else parentPort?.postMessage(runJob(workerData as Job));
