// M1 step 5c: the playtest repro seeds as regression tests, one block per milestone
// (docs/specs/m1-step5c-playtest-fixes.md). The test-writer's spec checks are separate.

import { describe, expect, it } from "vitest";
import type { PlayResult } from "../../packages/shared/src/types";
import { averageCoachFor, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { GameLoopError, playGame, prepareGame, snapCapAt, type GameKit } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { loadGameData } from "../../scripts/game/data";
import { digest } from "../../scripts/game/metrics";
import { simGame } from "../../scripts/game/sim-game";

const data = loadGameData();
const kit = prepareGame(data);
const coach = averageCoachFor(data);
const league = (seed: number) => leagueFromSeed(data, seed).teams;

describe("A: postseason overtime finishes", () => {
  it("A1: league 4242 seed 599, postseason, returns a record with a winner, the same twice", () => {
    const teams = league(4242);
    const play = () => playGame(setupGame(teams, 4242, 599, () => coach, "postseason"), kit, Rng.fromSeed(599));
    const a = play();
    expect(a.final.phase).toBe("final");
    expect(a.final.result?.winner).not.toBeNull();
    expect(a.final.period).toBeGreaterThan(4);
    expect(digest(play())).toBe(digest(a));
  });

  it("A4: the cap grows by a regulation period's share per overtime period only", () => {
    expect(snapCapAt(1, 260, 4)).toBe(260);
    expect(snapCapAt(4, 260, 4)).toBe(260);
    expect(snapCapAt(5, 260, 4)).toBe(325);
    expect(snapCapAt(8, 260, 4)).toBe(520);
  });

  it("A4: a loop that makes no progress still throws snapCap", () => {
    // Every scrimmage snap is a 0-second incompletion: downs turn over, the clock never moves.
    const stuck: GameKit = {
      data,
      resolve: (s, o, d, p, rng) => {
        const r = kit.resolve(s, o, d, p, rng);
        if (s.phase !== "scrimmage") return r;
        return { kind: "pass", seconds: 0, incomplete: true, end: { spot: s.spot, possession: "offense" } } as PlayResult;
      },
    };
    let err: unknown;
    try {
      playGame(setupGame(league(2026), 2026, 1, () => coach), stuck, Rng.fromSeed(1));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(GameLoopError);
    expect((err as GameLoopError).code).toBe("snapCap");
  });

  it("A5: --game-type postseason prints the game type on the header; the default is regular", () => {
    const post = simGame(["--game-type", "postseason", "--league-seed", "4242", "--seed", "599"]);
    expect(post.split("\n")[1]).toContain("postseason");
    expect(post).toContain("FINAL:");
    expect(simGame(["--seed", "3"])).toBe(simGame(["--seed", "3", "--game-type", "regular"]));
    expect(simGame(["--seed", "3"]).split("\n")[1]).toContain("regularSeason");
    expect(() => simGame(["--game-type", "playoff"])).toThrow(/--game-type/);
  });
});
