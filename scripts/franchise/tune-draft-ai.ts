// What a data/franchise/draft-ai.json drafts (docs/specs/m4-franchise-core.md, B13, B14, B16, B17 and B18),
// for setting its numbers by hand. Simulated leagues only: the tuning seeds, which no check reads.
//
//   node --import ./scripts/engine/register.mjs scripts/franchise/tune-draft-ai.ts [--file draft-ai.json] [--leagues 800] [--jobs 3]
//
// Prints each reading beside its bound and writes nothing. --file tries another file's numbers (the
// shipped ones by default). After changing draft-ai.json, run tune-pool.ts.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { TUNING_FIRST_SEED, TUNING_LEAGUES } from "../../packages/sim/test/franchise/tolerances";
import { FRANCHISE_FILES, loadFranchise, readJson } from "./data";
import { addDrafted, addQuickPlay, deploymentWeights, draftedLeague, draftReadings, mergeTally, newTally } from "./measure";
import type { DeploymentWeights, Tally } from "./measure";

interface Job {
  readonly first: number;
  readonly count: number;
  readonly draftAi: unknown;
  readonly weights: DeploymentWeights;
}

function runJob(job: Job): { drafted: Tally; quick: Tally } {
  const data = loadFranchise({ draftAi: job.draftAi });
  const out = { drafted: newTally(), quick: newTally() };
  for (let seed = job.first; seed < job.first + job.count; seed++) {
    addDrafted(out.drafted, data, draftedLeague(data, seed), job.weights);
    addQuickPlay(out.quick, data, seed, job.weights);
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const jobs = Number(arg("--jobs") ?? 3);
  const leagues = Number(arg("--leagues") ?? TUNING_LEAGUES);
  const file = arg("--file");
  const draftAi: unknown = file === undefined ? readJson(FRANCHISE_FILES.draftAi) : JSON.parse(readFileSync(file, "utf8"));
  const base = loadFranchise({ draftAi });
  const weights = deploymentWeights(base.game);
  const per = Math.ceil(leagues / jobs);
  const parts = await Promise.all(
    Array.from({ length: Math.ceil(leagues / per) }, (_, i) => {
      const job: Job = { first: TUNING_FIRST_SEED + i * per, count: Math.min(per, leagues - i * per), draftAi, weights };
      return new Promise<ReturnType<typeof runJob>>((done, failed) => {
        const w = new Worker(fileURLToPath(import.meta.url), { workerData: job });
        w.once("message", done);
        w.once("error", failed);
      });
    }),
  );
  const drafted = newTally();
  const quick = newTally();
  for (const p of parts) {
    mergeTally(drafted, p.drafted);
    mergeTally(quick, p.quick);
  }
  console.log(`${leagues} leagues, franchise seeds ${TUNING_FIRST_SEED} to ${TUNING_FIRST_SEED + leagues - 1}`);
  for (const line of draftReadings(drafted, quick, base.game.config.league.teams, base.roster.rosterSize)) console.log(line);
}

if (isMainThread) await main();
else parentPort?.postMessage(runJob(workerData as Job));
