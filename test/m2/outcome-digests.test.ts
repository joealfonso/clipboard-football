// M2 A4, B2, B7, D5 and E1, fast check: milestones A to E change no outcome. The first games of
// the CI slice, played now, have the outcome digests the pre-M2 tree (04f0f5d) recorded in
// test/fixtures/m2-baseline-digests.json: the step 5 record with the fields M2 adds left out
// (docs/DECISIONS.md, M2, "How byte-identical is proved"). The full 10,000 games run in
// outcome-digests.heavy.test.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createEngine } from "../../packages/sim/src/engine/resolve";
import { playGame, type GameKit } from "../../packages/sim/src/loop/play";
import { sessionRecord, startSession } from "../../packages/sim/src/loop/session";
import { Rng } from "../../packages/sim/src/rng";
import { REPO } from "../../scripts/game/data";
import { outcomeDigest, type DigestFile } from "../../scripts/game/outcome-digests";
import { data, kit, sliceGames } from "./support";

// Whole games per test: the default 5 s is too short when the full suite runs in parallel.
vi.setConfig({ testTimeout: 120_000 });

const baseline = JSON.parse(readFileSync(join(REPO, "test/fixtures/m2-baseline-digests.json"), "utf8")) as DigestFile;
const N = 200;
const games = sliceGames(N);

describe("outcome digests against the pre-M2 baseline (fast slice)", () => {
  it("the baseline holds the CI slice", () => {
    expect(baseline.slice.length).toBe(data.config.league.ciSliceGames);
    expect(baseline.runSeed).toBe(data.config.league.calibrationSeed);
  });

  it(`B2, D5: the first ${N} slice games played with participants and headlines on are the baseline's`, () => {
    const bad: number[] = [];
    for (const g of games) if (outcomeDigest(playGame(g.setup, kit, Rng.fromSeed(g.seed)), baseline.provenance) !== baseline.slice[g.index]) bad.push(g.index);
    expect(bad).toEqual([]);
  }, 60_000);

  it(`B7: with the credit stream swapped, the first ${N} slice games are still the baseline's`, () => {
    const swapped: GameKit = { data, resolve: createEngine(data.engine, { creditStream: () => Rng.fromSeed(424242) }) };
    const bad: number[] = [];
    for (const g of games) if (outcomeDigest(playGame(g.setup, swapped, Rng.fromSeed(g.seed)), baseline.provenance) !== baseline.slice[g.index]) bad.push(g.index);
    expect(bad).toEqual([]);
  }, 60_000);

  it(`E1: a session with no human seat gives the baseline's game, for the first ${N} slice games`, () => {
    const bad: number[] = [];
    for (const g of games) {
      const s = startSession(g.setup, kit, null);
      expect(s.request).toBeNull();
      if (outcomeDigest(sessionRecord(s, g.setup, kit), baseline.provenance) !== baseline.slice[g.index]) bad.push(g.index);
    }
    expect(bad).toEqual([]);
  }, 60_000);
});
