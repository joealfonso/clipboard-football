// M4 milestone A, criterion A1 (docs/specs/m4-franchise-core.md): each franchise data file parses
// with its zod schema, a wrong shape fails, and roster.json is consistent with the engine's slot
// needs. Validation runs here in the test, never inside packages/sim/src.

import { describe, expect, it } from "vitest";
import { POSITIONS } from "../../../shared/src/engine";
import { draftAiSchema, EVALUATION_ERROR_CAP, franchiseLeagueSchema, overallWeightsSchema, parseFranchiseData, poolSchema, positionMinimums, rosterSchema } from "../../../shared/src/franchise-schema";
import { slotNeeds } from "../../src/engine/players";
import { poolCounts, rosterLimits, teamCount } from "../../src/franchise/index";
import { loadGameData } from "../../../../scripts/game/data";
import { franchiseFiles, loadFranchiseData } from "./support";

type Json = Record<string, unknown>;
const omit = <T extends object>(o: T, key: string): Partial<T> => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key)) as Partial<T>;
const files = franchiseFiles();
const game = loadGameData();
const data = loadFranchiseData();

describe("A1: the franchise data files", () => {
  const cases = [
    ["league.json", franchiseLeagueSchema, files.league],
    ["roster.json", rosterSchema, files.roster],
    ["pool.json", poolSchema, files.pool],
    ["draft-ai.json", draftAiSchema, files.draftAi],
    ["overallWeights (data/ui/templates.json)", overallWeightsSchema, files.overallWeights],
  ] as const;

  it.each(cases)("%s parses with its schema", (_name, schema, file) => {
    expect(schema.safeParse(file).success).toBe(true);
  });

  it.each(cases.slice(0, 4))("%s: an unknown key, a missing key and a wrong type each fail", (_name, schema, file) => {
    const good = file as Json;
    expect(schema.safeParse({ ...good, extra: 1 }).success).toBe(false);
    expect(schema.safeParse({ ...good, designed: false }).success).toBe(false);
    expect(schema.safeParse(omit(good, "schemaVersion")).success).toBe(false);
    expect(schema.safeParse("x").success).toBe(false);
  });

  it("every file says it is designed", () => {
    for (const f of [files.league, files.roster, files.pool, files.draftAi]) expect((f as Json)["designed"]).toBe(true);
  });

  it("league.json: wrong shapes fail", () => {
    const good = files.league as Json;
    expect(franchiseLeagueSchema.safeParse({ ...good, conferences: [] }).success).toBe(false);
    expect(franchiseLeagueSchema.safeParse({ ...good, divisions: ["North", "north"] }).success).toBe(false);
    expect(franchiseLeagueSchema.safeParse({ ...good, teamsPerDivision: 0 }).success).toBe(false);
    expect(franchiseLeagueSchema.safeParse({ ...good, titleGame: "" }).success).toBe(false);
    expect(franchiseLeagueSchema.safeParse({ ...good, placement: "byHand" }).success).toBe(false);
  });

  it("roster.json: targets sum to rosterSize, and min <= target <= max for every position against slotNeeds", () => {
    const min = slotNeeds(game.engine.personnel, Object.values(game.engine.participants.returnUnits));
    let sum = 0;
    for (const p of POSITIONS) {
      const { target, max } = data.roster.positions[p];
      expect(min[p], p).toBeLessThanOrEqual(target);
      expect(target, p).toBeLessThanOrEqual(max);
      sum += target;
    }
    expect(sum).toBe(data.roster.rosterSize);
    expect(rosterLimits(data)).toEqual(Object.fromEntries(POSITIONS.map((p) => [p, { min: min[p], ...data.roster.positions[p] }])));
  });

  it("roster.json: targets that cannot fill a roster, a target over its max, and a position in no unit fail", () => {
    const good = files.roster as { rosterSize: number; positions: Record<string, { target: number; max: number }>; units: Record<string, string[]> };
    expect(rosterSchema.safeParse({ ...good, rosterSize: good.rosterSize + 1 }).success).toBe(false);
    expect(rosterSchema.safeParse({ ...good, positions: { ...good.positions, QB: { target: 5, max: 4 }, RB: { target: 2, max: 6 } } }).success).toBe(false);
    expect(rosterSchema.safeParse({ ...good, positions: omit(good.positions, "K") }).success).toBe(false);
    expect(rosterSchema.safeParse({ ...good, units: { ...good.units, specialTeams: ["K"] } }).success).toBe(false);
    expect(rosterSchema.safeParse({ ...good, units: { ...good.units, defense: [...(good.units["defense"] as string[]), "K"] } }).success).toBe(false);
  });

  it("a target below the engine's slot need fails the cross-check, as does a league larger than the name list", () => {
    const good = files.roster as { positions: Record<string, { target: number; max: number }> };
    // OL fields 6; move two of its target to WR so the sum still matches.
    const short = { ...good, positions: { ...good.positions, OL: { target: 5, max: 11 }, WR: { target: 10, max: 10 } } };
    expect(() => parseFranchiseData({ ...files, roster: short }, game)).toThrow(/OL: target 5 is below the 6/);
    expect(() => parseFranchiseData({ ...files, league: { ...(files.league as Json), teamsPerDivision: 5 } }, game)).toThrow(/names/);
    expect(() => parseFranchiseData({ ...files, roster: { ...good, positions: { ...good.positions, QB: { target: 3, max: 21 } } } }, game)).toThrow(/jersey numbers/);
  });

  it("the schema's minimums are the sim's slotNeeds", () => {
    expect(positionMinimums(game.engine.personnel, game.engine.participants)).toEqual(slotNeeds(game.engine.personnel, Object.values(game.engine.participants.returnUnits)));
  });

  it("pool.json: wrong shapes, and the two-tier shape it replaced, fail", () => {
    const good = files.pool as { adjust: Record<string, Json>; standoutCentering: Json; tuning: Json } & Json;
    expect(poolSchema.safeParse({ ...good, depthCurve: [{ p: 0, rating: 26 }, { p: 1, rating: 38 }] }).success).toBe(false);
    expect(poolSchema.safeParse({ ...good, adjust: omit(good.adjust, "QB") }).success).toBe(false);
    expect(poolSchema.safeParse({ ...good, adjust: { ...good.adjust, QB: { accuracy: { scale: 0, offset: 0 } } } }).success).toBe(false);
    expect(poolSchema.safeParse({ ...good, adjust: { ...good.adjust, QB: { accuracy: { scale: 1 } } } }).success).toBe(false);
    expect(poolSchema.safeParse({ ...good, floor: 100 }).success).toBe(false);
    expect(poolSchema.safeParse({ ...good, standoutCentering: omit(good.standoutCentering, "sack") }).success).toBe(false);
    expect(poolSchema.safeParse({ ...good, standoutCentering: { ...good.standoutCentering, sack: 0 } }).success).toBe(false);
    expect(poolSchema.safeParse({ ...good, tuning: omit(good.tuning, "date") }).success).toBe(false);
    expect(poolSchema.safeParse({ ...good, surplus: -0.1 }).success).toBe(false);
    expect(poolSchema.safeParse({ ...good, names: { unique: false, maxRedraws: 5 } }).success).toBe(false);
  });

  it("pool.json: adjust may be empty for a position, and names only ratings the position's overall weighs", () => {
    const good = files.pool as { adjust: Record<string, Json> } & Json;
    const one = { scale: 1.1, offset: -3 };
    expect(() => parseFranchiseData({ ...files, pool: { ...good, adjust: { ...good.adjust, QB: {} } } }, game)).not.toThrow();
    // speed is a quarterback's rating, but his overall does not weigh it; passRush is not his at all.
    expect(() => parseFranchiseData({ ...files, pool: { ...good, adjust: { ...good.adjust, QB: { speed: one } } } }, game)).toThrow(/adjust\.QB: speed/);
    expect(() => parseFranchiseData({ ...files, pool: { ...good, adjust: { ...good.adjust, QB: { passRush: one } } } }, game)).toThrow(/adjust\.QB: passRush/);
    for (const p of POSITIONS) for (const r of Object.keys(data.pool.adjust[p])) expect(Object.keys(data.overallWeights[p] ?? {}), `${p}.${r}`).toContain(r);
  });

  it("draft-ai.json (B15): a missing position, a zero value, a rising or wrong-length slotNeed, an error over the cap and bad styles fail", () => {
    const good = files.draftAi as { positionValue: Json; slotNeed: Record<string, number[]>; evaluation: Json; styles: Record<string, Json>; autoPick: Json } & Json;
    const ok = (x: Json): boolean => draftAiSchema.safeParse({ ...good, ...x }).success;
    expect(ok({})).toBe(true);
    expect(ok({ positionValue: omit(good.positionValue, "P") })).toBe(false);
    expect(ok({ positionValue: { ...good.positionValue, QB: 0 } })).toBe(false);
    expect(ok({ slotNeed: omit(good.slotNeed, "K") })).toBe(false);
    expect(ok({ slotNeed: { ...good.slotNeed, QB: [4, 5, 1] } })).toBe(false);
    expect(ok({ slotNeed: { ...good.slotNeed, QB: [4, 3, -1] } })).toBe(false);
    expect(() => parseFranchiseData({ ...files, draftAi: { ...good, slotNeed: { ...good.slotNeed, QB: [14, 4] } } }, game)).toThrow(/slotNeed\.QB has 2 slots, the target is 3/);
    expect(() => parseFranchiseData({ ...files, draftAi: { ...good, slotNeed: { ...good.slotNeed, QB: [14, 4, 1, 1] } } }, game)).toThrow(/slotNeed\.QB has 4/);
    expect(ok({ evaluation: { errorSdMin: 1, errorSdMax: EVALUATION_ERROR_CAP } })).toBe(true);
    expect(ok({ evaluation: { errorSdMin: 1, errorSdMax: 8.1 } })).toBe(false);
    expect(ok({ evaluation: { errorSdMin: 5, errorSdMax: 4 } })).toBe(false);
    expect(ok({ evaluation: { errorSdMin: -1, errorSdMax: 4 } })).toBe(false);
    expect(EVALUATION_ERROR_CAP).toBe(8);
    expect(ok({ styles: { ...good.styles, odd: { weight: 1, value: { FB: 1.1 } } } })).toBe(false);
    expect(ok({ styles: { ...good.styles, odd: { weight: 1, value: { RB: 0 } } } })).toBe(false);
    expect(ok({ styles: { ...good.styles, odd: { weight: 0 } } })).toBe(false);
    expect(ok({ styles: { ...good.styles, odd: { weight: 1, need: -1 } } })).toBe(false);
    expect(ok({ styles: {} })).toBe(false);
    expect(ok({ autoPick: { style: "nobody", errorSd: 0 } })).toBe(false);
    expect(ok({ autoPick: { style: "constructor", errorSd: 0 } })).toBe(false);
    expect(ok({ autoPick: { style: "balanced", errorSd: 9 } })).toBe(false);
    expect(ok({ noise: { spread: 2 } })).toBe(false);
    expect(ok({ need: { starter: 20, starterShare: 5, depth: 8 } })).toBe(false);
  });

  it("overallWeights: a missing position, another position's rating and a zero weight fail", () => {
    const good = files.overallWeights as Record<string, Record<string, number>>;
    expect(overallWeightsSchema.safeParse(omit(good, "QB")).success).toBe(false);
    expect(overallWeightsSchema.safeParse({ ...good, QB: {} }).success).toBe(false);
    expect(overallWeightsSchema.safeParse({ ...good, QB: { passRush: 1 } }).success).toBe(false);
    expect(overallWeightsSchema.safeParse({ ...good, QB: { accuracy: 0 } }).success).toBe(false);
  });

  it("the shipped numbers: 32 teams, a 53-man roster, a pool of 1,871", () => {
    expect(teamCount(data.league)).toBe(32);
    expect(data.roster.rosterSize).toBe(53);
    const counts = poolCounts(data);
    expect(POSITIONS.map((p) => counts[p])).toEqual([106, 141, 212, 141, 317, 282, 247, 212, 141, 36, 36]);
    expect(POSITIONS.reduce((s, p) => s + counts[p], 0)).toBe(1871);
  });
});
