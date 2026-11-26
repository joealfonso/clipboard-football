// B3 and B4 from docs/specs/m4-franchise-core.md at 32 teams (moved from spec-no-dead-ends.test.ts).

import { describe, expect, it } from "vitest";
import type { FranchiseData } from "../../../shared/src/franchise";
import { runDraft, setAutoDraft } from "../../src/franchise";
import { create, draftProblems, endProblems, pinnedData, SCRIPTS, shippedData, value } from "./spec-support";

const shipped = shippedData();

describe("B3 all-AI drafts", () => {
  // The heavy project runs 1,000 seeds (test/franchise/franchise.heavy.test.ts); this is a fixed slice.
  it.each<[string, FranchiseData, number]>([
    ["32 teams, shipped data", shipped, 5],
    ["32 teams, spec numbers", pinnedData(), 3],
  ])("%s", (_n, data, seeds) => {
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
  it("32 teams, shipped data, slots 1, 16, 32 and random", () => {
    const bad: string[] = [];
    ([1, 16, 32, "random", "random", "random"] as const).forEach((slot, i) => bad.push(...draftProblems(shipped, 100 + i, script, slot)));
    expect(bad).toEqual([]);
  });
});
