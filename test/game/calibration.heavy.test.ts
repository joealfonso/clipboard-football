// M1 step 5, F3, F4 and G4 (heavy: re-simulates the 1,000-game slice; runs in vitest.heavy.config.ts): the committed calibration summary is current and its statuses follow
// from its numbers; a re-simulated slice of games matches the logged digests; speed within 3x.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { averageCoachFor, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { playGame, prepareGame } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { approvedFor, codeHash, pinnedFiles, statusOf, SUMMARY, type Row, type Tolerances } from "../../scripts/game/calibrate";
import { REPO, loadGameData, sha256 } from "../../scripts/game/data";
import { digest } from "../../scripts/game/metrics";

const BUDGET_MS = 25;
const CI_ALLOWANCE = 3;
const data = loadGameData();

for (const target of ["insample", "holdout"] as const) {
  const path = join(REPO, SUMMARY[target]);
  describe.skipIf(!existsSync(path))(`calibration summary, ${target}`, () => {
    const s = JSON.parse(readFileSync(path, "utf8")) as {
      tolerancesSha256: string; codeHash: string; fileHashes: Record<string, string>; metrics: (Row & { gated?: boolean })[];
      slice: { league: number; seed: number; digest: string }[]; leagueSeeds: number[]; perf: { msPerGame: number };
    };
    const tol = JSON.parse(readFileSync(join(REPO, "data/game/tolerances.json"), "utf8")) as Tolerances;

    it("G4: tolerances, data and code are the ones the summary was made with", () => {
      expect(s.tolerancesSha256).toBe(sha256(readFileSync(join(REPO, "data/game/tolerances.json"))));
      expect(s.fileHashes).toEqual(pinnedFiles(data.dataHashes));
      expect(s.codeHash).toBe(codeHash());
    });

    it("G4: every status follows from the summary's numbers and the tolerances", () => {
      // Scoped (code review, 2026-11-12): an accepted miss applies only to its own sample.
      const approved = approvedFor(tol, target);
      const gameMetrics = tol.metrics.filter((m) => !m.id.startsWith("coach."));
      expect(s.metrics.map((r) => r.id)).toEqual(gameMetrics.map((m) => m.id));
      for (const r of s.metrics) {
        const t = gameMetrics.find((m) => m.id === r.id);
        expect(t).toBeDefined();
        expect(r.status).toBe(statusOf({ ...r, gated: t?.gated ?? true, tolerance: t?.gated === false ? null : (t?.tolerance ?? null), minN: t?.minN ?? 0 }, approved));
      }
    });

    it("F3: re-simulating the logged slice gives the same digests", () => {
      expect(s.slice.length).toBe(data.config.league.ciSliceGames);
      const kit = prepareGame(data);
      const coach = averageCoachFor(data);
      const leagues = new Map<number, ReturnType<typeof leagueFromSeed>["teams"]>();
      const t0 = performance.now();
      for (const g of s.slice) {
        const ls = s.leagueSeeds[g.league] as number;
        let teams = leagues.get(ls);
        if (teams === undefined) {
          teams = leagueFromSeed(data, ls).teams;
          leagues.set(ls, teams);
        }
        expect(digest(playGame(setupGame(teams, ls, g.seed, () => coach), kit, Rng.fromSeed(g.seed)))).toBe(g.digest);
      }
      // F4: mean full-game time within 3x of the 25 ms budget on CI.
      expect((performance.now() - t0) / s.slice.length).toBeLessThan(BUDGET_MS * CI_ALLOWANCE);
      expect(s.perf.msPerGame).toBeLessThanOrEqual(BUDGET_MS);
    }, 120_000);
  });
}
