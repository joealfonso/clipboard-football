// B3 and B4 from docs/specs/m4-franchise-core.md: no draft ever reaches a dead end, whoever picks.
// Seeded properties: the failing seeds are listed when one breaks. The 32-team runs of the same
// properties are in spec-no-dead-ends-32.test.ts, so the two run side by side.

import { describe, expect, it } from "vitest";
import type { FranchiseData } from "../../../shared/src/franchise";
import { makePick, runDraft, setAutoDraft } from "../../src/franchise";
import { create, draftProblems, endProblems, errorCode, gameData, playDraft, SCRIPTS, smallData, specLimits, startersOnlyData, POSITIONS, teamCounts, undrafted, value } from "./spec-support";

const SMALL: readonly [string, FranchiseData][] = [
  ["4 teams, 37 players", smallData()],
  ["4 teams, starters only", startersOnlyData()],
];

describe("B3 all-AI drafts", () => {
  it.each(SMALL)("%s", (_n, data) => {
    const seeds = 150;
    const bad: string[] = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const run = runDraft(value(setAutoDraft(create(data, seed), true)), data);
      if (!run.ok) bad.push(`seed ${seed}: ${JSON.stringify(run.error)}`);
      else bad.push(...endProblems(run.value.state, data).map((x) => `seed ${seed}: ${x}`));
    }
    expect(bad).toEqual([]);
  });
});

describe.each(Object.entries(SCRIPTS))("B4 a user who picks: %s", (_name, script) => {
  it.each(SMALL)("%s, 100 seeds", (_n, data) => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 100; seed++) bad.push(...draftProblems(data, seed, script, (["random", 1, 2, 3, 4] as const)[seed % 5] as number | "random"));
    expect(bad).toEqual([]);
  });
});

describe("B4 with a pool that is as tight as the spec allows", () => {
  // No surplus: the pool holds exactly 4 x 37 players, so the last team takes the last player.
  it.each(Object.entries(SCRIPTS))("surplus 0, user picks: %s", (_name, script) => {
    const base = smallData();
    const data: FranchiseData = { ...base, game: gameData(), pool: { ...base.pool, surplus: 0 } };
    expect(create(data, 1).players).toHaveLength(148);
    const bad: string[] = [];
    for (let seed = 1; seed <= 60; seed++) bad.push(...draftProblems(data, seed, script, "random"));
    expect(bad).toEqual([]);
  });
});

describe("the scripted users really do what they say (guards the properties above)", () => {
  const data = smallData();
  it("the hoarder reaches a maximum somewhere, the kicker script holds extra kickers or punters", () => {
    const limits = specLimits(data);
    const hoard = teamCounts(playDraft(data, 5, SCRIPTS.hoard).state, "T00");
    expect(POSITIONS.some((p) => hoard[p] === limits[p].max)).toBe(true);
    const kicks = Array.from({ length: 20 }, (_, i) => teamCounts(playDraft(data, i + 1, SCRIPTS.kickers).state, "T00"));
    expect(kicks.some((c) => c.K + c.P > limits.K.min + limits.P.min)).toBe(true);
  });
});

describe("End: the draft closes when the last pick is made", () => {
  it("by the user's own pick, when the user owns the last slot (slot 4, round 37 is odd)", () => {
    const data = smallData();
    const r = playDraft(data, 21, SCRIPTS.random, { draftSlot: 4 });
    expect(r.failure).toBeNull();
    expect(r.state.draft.slots.at(-1)).toBe("T00");
    expect(r.state.draft.picks.at(-1)?.by).toBe("user");
    expect(r.state.phase).toBe("regularSeason");
    expect(Object.keys(r.state.numbers)).toHaveLength(148);
    expect(errorCode(makePick(r.state, data, undrafted(r.state)[0]?.id as string))).not.toBeNull();
  });
  it("by an AI pick, and undrafted players stay in the state as free agents", () => {
    const data = smallData();
    const r = playDraft(data, 22, SCRIPTS.random, { draftSlot: 1 });
    expect(r.state.phase).toBe("regularSeason");
    expect(r.state.draft.picks.at(-1)?.by).toBe("ai");
    expect(r.state.players).toHaveLength(create(data, 22).players.length);
    expect(undrafted(r.state)).toHaveLength(r.state.players.length - 148);
  });
});
