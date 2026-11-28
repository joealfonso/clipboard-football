// M2 milestones A to E, heavy (vitest.heavy.config.ts, `pnpm test:heavy`): the full in-sample run
// (10 leagues x 1,000 games) against the pre-M2 outcome digests (A4, B2, D5), participants
// determinism over the same 10,000 games and the credit-stream swap (B7), and the CI slice's 1,000
// games for C1, E1 and B5. The fast versions are outcome-digests.test.ts and the milestone files.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEngine } from "../../packages/sim/src/engine/resolve";
import { leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { playGame, type GameKit, type GameRecord } from "../../packages/sim/src/loop/play";
import { sessionRecord, startSession } from "../../packages/sim/src/loop/session";
import { Rng } from "../../packages/sim/src/rng";
import { REPO } from "../../scripts/game/data";
import { runSeeds } from "../../scripts/game/metrics";
import { outcomeDigest, playersDigest, type DigestFile } from "../../scripts/game/outcome-digests";
import { c1Sums } from "./c1";
import { coach, data, kit, sliceGames } from "./support";
import { checkTiltGaps, tiltGaps } from "./tilts";

const baseline = JSON.parse(readFileSync(join(REPO, "test/fixtures/m2-baseline-digests.json"), "utf8")) as DigestFile;
const lg = data.config.league;
const seeds = runSeeds(lg.calibrationSeed, lg.leagues, lg.gamesPerLeague);

const participantsDigest = (r: GameRecord): string =>
  createHash("sha256").update(JSON.stringify(r.events.flatMap((e) => (e.t === "play" ? [[(e.play.detail as Record<string, unknown>)["participants"], (e.play.detail as Record<string, unknown>)["onField"]]] : [])))).digest("hex");

interface Pass {
  readonly leagues: { leagueSeed: number; players: string; games: number; digests: string }[];
  readonly slice: string[];
  readonly participants: string[];
}

function run(k: GameKit): Pass {
  const slice: string[] = [];
  const participants: string[] = [];
  const leagues = seeds.leagueSeeds.map((leagueSeed, l) => {
    const { teams } = leagueFromSeed(data, leagueSeed);
    const h = createHash("sha256");
    let games = 0;
    for (const seed of seeds.games(data, l)) {
      const rec = playGame(setupGame(teams, leagueSeed, seed, () => coach), k, Rng.fromSeed(seed));
      const d = outcomeDigest(rec, baseline.provenance);
      if (slice.length < baseline.slice.length) slice.push(d);
      participants.push(participantsDigest(rec));
      h.update(d);
      games++;
    }
    return { leagueSeed, players: playersDigest(teams.map((t) => t.pool)), games, digests: h.digest("hex") };
  });
  return { leagues, slice, participants };
}

let first: Pass | null = null;

describe("M2 A-E, the full in-sample run against the pre-M2 baseline", () => {
  it("A4, B2, D5: every league's players and all 10,000 outcome digests are the baseline's", () => {
    first = run(kit);
    expect(first.leagues).toEqual(baseline.leagues);
    expect(first.slice).toEqual(baseline.slice);
  });

  it("B7: the same 10,000 games played again credit the same participants", () => {
    expect(first).not.toBeNull();
    const again = run(kit);
    expect(again.participants).toEqual(first?.participants);
  });

  it("B7: with the credit stream swapped, all 10,000 outcome digests are still the baseline's", () => {
    const swapped = run({ data, resolve: createEngine(data.engine, { creditStream: () => Rng.fromSeed(8675309) }) });
    expect(swapped.leagues).toEqual(baseline.leagues);
    expect(swapped.slice).toEqual(baseline.slice);
    const changed = swapped.participants.filter((p, i) => p !== first?.participants[i]).length;
    expect(changed).toBeGreaterThan(9_900);
  });
});

describe("M2 A-E over the 1,000-game CI slice", () => {
  const games = sliceGames(lg.ciSliceGames);

  it("C1: player lines sum to the team box in every game", () => {
    const bad: string[] = [];
    for (const g of games) for (const [what, got, want] of c1Sums(playGame(g.setup, kit, Rng.fromSeed(g.seed)))) if (got !== want) bad.push(`game ${g.index}: ${what}: players ${got}, team ${want}`);
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it("E1: with no human seat, every session record is deep-equal to playGame", () => {
    for (const g of games) expect(sessionRecord(startSession(g.setup, kit, null), g.setup, kit)).toStrictEqual(playGame(g.setup, kit, Rng.fromSeed(g.seed)));
  });

  it("B5: the documented tilts hold over the slice", () => {
    checkTiltGaps(tiltGaps(games.map(({ seed, setup }) => ({ record: playGame(setup, kit, Rng.fromSeed(seed)), pools: { home: setup.home.pool, away: setup.away.pool } }))));
  });
});
