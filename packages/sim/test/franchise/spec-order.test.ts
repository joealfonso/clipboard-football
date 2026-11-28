// B1 from docs/specs/m4-franchise-core.md: snake order, with owners worked out by hand.

import { describe, expect, it } from "vitest";
import { createFranchise } from "../../src/franchise";
import { create, errorCode, pinnedData, rawFiles, gameData, rosterFiles, smallData, SPEC_MIN, SMALL_MAX, value } from "./spec-support";
import { parseFranchiseData } from "../../../shared/src/franchise-schema";

const big = pinnedData();
const small = smallData();

/** Overall pick numbers (1-based) a team owns in a slot list. */
function owned(slots: readonly string[], team: string): number[] {
  return slots.flatMap((t, i) => (t === team ? [i + 1] : []));
}

describe("B1 snake order, 32 teams and 53 rounds", () => {
  // By hand: odd round r starts at (r-1)*32, so slot s picks at (r-1)*32 + s; even rounds run
  // backwards, so slot s picks at r*32 - s + 1.
  it.each([
    [1, [1, 64, 65, 128, 129, 192, 193], [1600, 1601, 1664, 1665]],
    [16, [16, 49, 80, 113, 144, 177, 208], [1585, 1616, 1649, 1680]],
    [32, [32, 33, 96, 97, 160, 161, 224], [1569, 1632, 1633, 1696]],
  ])("a user who chooses slot %i owns exactly the hand-computed picks", (slot, first, last) => {
    const s = create(big, 11, slot, "T09");
    const mine = owned(s.draft.slots, "T09");
    expect(mine).toHaveLength(53);
    expect(mine.slice(0, 7)).toEqual(first);
    expect(mine.slice(-4)).toEqual(last);
    expect(s.settings.draftSlot).toBe(slot);
  });

  it("has 1,696 slots; every team owns 53, one per round; even rounds are odd rounds reversed", () => {
    const { slots } = create(big, 5).draft;
    expect(slots).toHaveLength(1696);
    const round1 = slots.slice(0, 32);
    expect(new Set(round1).size).toBe(32);
    for (let r = 0; r < 53; r++) expect(slots.slice(r * 32, r * 32 + 32), `round ${r + 1}`).toEqual(r % 2 === 0 ? round1 : [...round1].reverse());
    for (const t of round1) expect(owned(slots, t)).toHaveLength(53);
  });

  it("is a seeded shuffle: same seed same order, other seeds other orders, not the id order", () => {
    const orders = Array.from({ length: 20 }, (_, i) => create(big, i + 1).draft.slots.slice(0, 32).join());
    expect(new Set(orders).size).toBe(20);
    expect(create(big, 7).draft.slots).toEqual(create(big, 7).draft.slots);
    const ids = create(big, 1).teams.map((t) => t.id);
    expect(orders).not.toContain(ids.join());
  });

  it("with a chosen slot the other 31 are still shuffled by seed and still all there", () => {
    const orders = [1, 2, 3, 4, 5].map((seed) => create(big, seed, 16).draft.slots.slice(0, 32));
    for (const o of orders) {
      expect(o[15]).toBe("T00");
      expect(new Set(o).size).toBe(32);
    }
    expect(new Set(orders.map((o) => o.join())).size).toBe(5);
  });

  it("a random slot is stored as null and reaches every part of the order over seeds", () => {
    const at = Array.from({ length: 120 }, (_, i) => create(small, i + 1).draft.slots.slice(0, 4).indexOf("T00"));
    expect(new Set(at)).toEqual(new Set([0, 1, 2, 3]));
    expect(create(small, 1).settings.draftSlot).toBeNull();
  });
});

describe("B1 nothing is hard-coded to 32 teams or 53 rounds", () => {
  it.each([
    [1, [1, 8, 9, 16, 17], 145],
    [2, [2, 7, 10, 15, 18], 146],
    [4, [4, 5, 12, 13, 20], 148],
  ])("4 teams, 37 rounds: slot %i", (slot, first, lastPick) => {
    const s = create(small, 3, slot);
    expect(s.draft.slots).toHaveLength(148);
    const mine = owned(s.draft.slots, "T00");
    expect(mine.slice(0, 5)).toEqual(first);
    expect(mine.at(-1)).toBe(lastPick);
    expect(mine).toHaveLength(37);
  });

  it("6 teams in 2 conferences of 3 divisions, 34 rounds", () => {
    const raw = rawFiles();
    const data = parseFranchiseData(
      {
        ...raw,
        league: { ...raw.league, conferences: [{ id: "a", name: "Alpha Test Conference" }, { id: "b", name: "Beta Test Conference" }], divisions: ["One", "Two", "Three"], teamsPerDivision: 1 },
        ...rosterFiles(34, { ...SPEC_MIN, QB: 2 }, SMALL_MAX),
      },
      gameData(),
    );
    const s = create(data, 2, 6, "T05");
    expect(s.teams).toHaveLength(6);
    expect(s.draft.slots).toHaveLength(204);
    expect(owned(s.draft.slots, "T05").slice(0, 4)).toEqual([6, 7, 18, 19]);
    expect(owned(s.draft.slots, "T05").at(-1)).toBe(199); // round 34 is even: 33*6 + 1
  });
});

describe("createFranchise refuses bad options with a typed error (Locked 8)", () => {
  it.each([0, -1, 33, 1.5, Number.NaN])("draft slot %s", (draftSlot) => {
    expect(errorCode(createFranchise(big, { seed: 1, userTeam: "T00", draftSlot }))).toBe("badDraftSlot");
  });
  it("slot 5 does not exist in a 4-team league, slot 4 does", () => {
    expect(errorCode(createFranchise(small, { seed: 1, userTeam: "T00", draftSlot: 5 }))).toBe("badDraftSlot");
    expect(value(createFranchise(small, { seed: 1, userTeam: "T00", draftSlot: 4 })).draft.slots[3]).toBe("T00");
  });
  it.each(["T32", "t00", "", "__proto__"])("user team %j", (userTeam) => {
    expect(errorCode(createFranchise(big, { seed: 1, userTeam }))).toBe("unknownTeam");
  });
  it.each([Number.NaN, 1.5, Number.POSITIVE_INFINITY])("seed %s", (seed) => {
    expect(errorCode(createFranchise(big, { seed, userTeam: "T00" }))).toBe("badSeed");
  });
});
