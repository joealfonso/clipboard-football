// M1 step 5, D1 and D2 (heavy: 2 x 10,000 games). Runs in its own vitest project
// (vitest.heavy.config.ts, `pnpm test:heavy`, its own CI job) without file parallelism.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { LeagueSettings } from "../../packages/shared/src/types";
import { GAME_FILES, REPO, loadGameData } from "../../scripts/game/data";
import { runLeagues } from "../../scripts/game/metrics";


interface Counts {
  classes: Map<string, number>;
  scrimmagePlays: number;
  flaggedSnaps: number;
  snaps: number;
  homeWins: number;
  games: number;
}

function run(homeField: LeagueSettings["homeField"]): Counts {
  const base = JSON.parse(readFileSync(join(REPO, GAME_FILES.league), "utf8")) as LeagueSettings;
  const data = loadGameData({ override: { [GAME_FILES.league]: { ...base, homeField } } });
  const c: Counts = { classes: new Map(), scrimmagePlays: 0, flaggedSnaps: 0, snaps: 0, homeWins: 0, games: 0 };
  runLeagues(data, {
    runSeed: data.config.league.calibrationSeed,
    leagues: data.config.league.leagues,
    gamesPerLeague: data.config.league.gamesPerLeague,
    onGame: (record, box) => {
      c.games++;
      const m = box.home.points - box.away.points;
      c.homeWins += m > 0 ? 1 : m === 0 ? 0.5 : 0;
      for (const e of record.events) {
        if (e.t !== "play" || e.before.phase !== "scrimmage") continue;
        c.snaps++;
        if ((e.play.fouls ?? []).length > 0) c.flaggedSnaps++;
        const cls = (e.play.detail ?? {})["class"];
        if (typeof cls === "string" && (e.play.kind === "run" || e.play.kind === "pass" || e.play.kind === "sack" || e.play.kind === "scramble")) {
          c.scrimmagePlays++;
          c.classes.set(cls, (c.classes.get(cls) ?? 0) + 1);
        }
      }
    },
  });
  return c;
}

const HOOK_TIMEOUT_MS = 900_000;

describe("home field off and on (D1, D2)", () => {
  const league = JSON.parse(readFileSync(join(REPO, GAME_FILES.league), "utf8")) as LeagueSettings;
  let off: Counts;
  let on: Counts;
  // Both 10,000-game runs happen in beforeAll, not at collection time (review fix).
  beforeAll(() => {
    off = run({ ratingEdge: 0, crowdNoise: 0 });
    on = run(league.homeField);
  }, HOOK_TIMEOUT_MS);

  it("D1: at size 0 the home win rate over 10,000 games is 50% within sampling error (ties half)", () => {
    expect(off.games).toBe(10_000);
    const se = Math.sqrt(0.25 / off.games);
    expect(Math.abs(off.homeWins / off.games - 0.5)).toBeLessThan(1.96 * se);
  });

  it("D2: with home field on, league-wide class and flag rates match the size-0 run within 0.2 pp", () => {
    expect(league.homeField.ratingEdge).toBeGreaterThan(0);
    for (const cls of new Set([...off.classes.keys(), ...on.classes.keys()])) {
      const a = (off.classes.get(cls) ?? 0) / off.scrimmagePlays;
      const b = (on.classes.get(cls) ?? 0) / on.scrimmagePlays;
      expect(Math.abs(a - b) * 100, cls).toBeLessThan(0.2);
    }
    expect(Math.abs(off.flaggedSnaps / off.snaps - on.flaggedSnaps / on.snaps) * 100).toBeLessThan(0.2);
  });
});
