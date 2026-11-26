// Revision 2026-11-24 of docs/specs/m4-franchise-core.md: the pool is one distribution per position
// with the `adjust` transform, and franchiseKit carries the franchise's own standout centering. Also
// the schema fixtures of A1, A4 and B15. Expected ratings are worked out by hand from the formula
// clamp(round(m + scale x (x - m) + offset), floor, 99).

import { describe, expect, it } from "vitest";
import { parseFranchiseData } from "../../../shared/src/franchise-schema";
import type { FranchiseData, PoolConfig, PoolPlayer } from "../../../shared/src/franchise";
import { franchiseKit, leagueTeams, STREAMS } from "../../src/franchise";
import { prepareGame } from "../../src/loop/play";
import { create, gameData, pinnedData, POSITIONS, rawFiles, shippedData, smallData, value } from "./spec-support";
import type { Position, RawFiles } from "./spec-support";

type Adjust = Partial<Record<Position, Record<string, { scale: number; offset: number }>>>;

/** smallData with this adjust and nothing else adjusted. */
function adjusted(adjust: Adjust, pool: Partial<PoolConfig> = {}, base = smallData()): FranchiseData {
  const all = Object.fromEntries(POSITIONS.map((p) => [p, adjust[p] ?? {}])) as PoolConfig["adjust"];
  return { ...base, pool: { ...base.pool, ...pool, adjust: all } };
}

/** The same data with every curve draw equal to `x`, and the league means given. */
function flatCurve(data: FranchiseData, x: number, means: Partial<Record<Position, Record<string, number>>> = {}): FranchiseData {
  const engine = structuredClone(data.game.engine) as { ratings: { curve: unknown }; distributions: { ratings: Record<string, Record<string, { mean: number }>> } };
  engine.ratings.curve = [{ p: 0, rating: x }, { p: 1, rating: x }];
  for (const [p, rs] of Object.entries(means)) for (const [r, m] of Object.entries(rs)) ((engine.distributions.ratings[p] as Record<string, { mean: number }>)[r] as { mean: number }).mean = m;
  return { ...data, game: { ...data.game, engine: engine as unknown as FranchiseData["game"]["engine"] } };
}

const everything = (p: PoolPlayer): Record<string, number> => ({ ...p.ratings, ...p.skills });

describe("A4 the adjust transform, by hand: every draw is 70", () => {
  const QB = { accuracy: { scale: 1.5, offset: -7 }, throwPower: { scale: 1.1, offset: 0 }, awareness: { scale: 1, offset: -60 }, agility: { scale: 10, offset: 0 } };
  const data = flatCurve(adjusted({ QB, K: { kickPower: { scale: 0.5, offset: 0 } } }, { floor: 20 }), 70, { QB: { accuracy: 60, throwPower: 65, awareness: 65, agility: 65, speed: 10 }, K: { kickPower: 61 } });
  const all = create(data, 3).players;
  it("scale stretches about the league mean, offset then moves, round, clamp to floor and 99", () => {
    const qbs = all.filter((p) => p.position === "QB");
    expect(qbs).toHaveLength(9); // ceil(4 x 2 x 1.1)
    for (const q of qbs) {
      // 60 + 1.5 x 10 - 7 = 68; 65 + 1.1 x 5 = 70.5, rounds to 71; 70 - 60 = 10, under the floor; 65 + 50 = 115, over 99.
      expect(everything(q)).toMatchObject({ accuracy: 68, throwPower: 71, awareness: 20, agility: 99, speed: 70, strength: 70 });
    }
  });
  it("a scale under 1 pulls toward the mean", () => {
    // 61 + 0.5 x 9 = 65.5, rounds to 66.
    for (const k of all.filter((p) => p.position === "K")) expect(everything(k)).toMatchObject({ kickPower: 66, kickAccuracy: 70 });
  });
  it("positions with no entry are the plain draw, speed's league mean of 10 included", () => {
    for (const p of all.filter((x) => x.position !== "QB" && x.position !== "K")) expect(new Set(Object.values(everything(p)))).toEqual(new Set([70]));
  });
  it("the floor is the floor of an adjusted rating: a plain draw under it stays", () => {
    const low = flatCurve(adjusted({ QB: { accuracy: { scale: 1, offset: -10 } } }, { floor: 45 }), 40);
    for (const q of create(low, 3).players) expect(Object.entries(everything(q)).every(([r, v]) => v === (q.position === "QB" && r === "accuracy" ? 45 : 40))).toBe(true);
  });
});

describe("A4 the adjust transform, on real draws", () => {
  const plain = create(adjusted({}), 8).players;
  const A = { hands: { scale: 1.4, offset: -6.3 }, speed: { scale: 0.8, offset: 2.2 } };
  const moved = create(adjusted({ WR: A }, { floor: 20 }), 8).players;
  it("every adjusted rating is the formula of the plain draw for the same player; every other rating, name, id and position is the same", () => {
    const means = gameData().engine.distributions.ratings as Record<string, Record<string, { mean: number }>>;
    expect(moved).toHaveLength(plain.length);
    moved.forEach((p, i) => {
      const was = plain[i] as PoolPlayer;
      const expected = Object.fromEntries(
        Object.entries(everything(was)).map(([r, x]) => {
          const a = was.position === "WR" ? (A as Record<string, { scale: number; offset: number }>)[r] : undefined;
          const m = means["WR"]?.[r]?.mean as number;
          return [r, a === undefined ? x : Math.min(99, Math.max(20, Math.round(m + a.scale * (x - m) + a.offset)))];
        }),
      );
      expect({ id: p.id, name: p.name, position: p.position, all: everything(p) }).toEqual({ id: was.id, name: was.name, position: was.position, all: expected });
    });
  });
  it("the plain draws are the engine's curve: 30 to 99, a tenth at or under 48, half at or under 65, nine tenths at or under 82", () => {
    const xs = create(adjusted({}, {}, pinnedData()), 2).players.flatMap((p) => Object.values(everything(p)));
    const share = (at: number): number => xs.filter((x) => x <= at).length / xs.length;
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(30);
    // 1,871 players x 6 or more ratings: a share's standard error is at most 0.005. Rounding adds a point's worth, under 0.015.
    for (const [at, p] of [[48, 0.1], [65, 0.5], [82, 0.9]] as const) expect(Math.abs(share(at) - p)).toBeLessThan(0.02);
  });
  it("the file does nothing to a position's early or late players apart: ids first and last third agree on mean overall skill", () => {
    const players = [1, 2, 3, 4, 5, 6].flatMap((seed) => create(shippedData(), seed).players.filter((p) => p.position === "OL"));
    const mean = (xs: readonly PoolPlayer[]): number => xs.reduce((s, p) => s + (p.skills["passBlock"] as number), 0) / xs.length;
    const sorted = [1, 2, 3, 4, 5, 6].flatMap((seed) => create(shippedData(), seed).players.filter((p) => p.position === "OL").map((p, i, l) => [p, i / l.length] as const));
    expect(sorted).toHaveLength(players.length);
    const first = mean(sorted.filter(([, at]) => at < 1 / 3).map(([p]) => p));
    const last = mean(sorted.filter(([, at]) => at >= 2 / 3).map(([p]) => p));
    // About 630 players a side with SD about 16: 4 standard errors of the difference is about 3.6.
    expect(Math.abs(first - last)).toBeLessThan(3.6);
  });
});

describe("franchiseKit: the same data with the franchise's own standout centering", () => {
  const base = smallData();
  const centering = { breakawayRun: 0.91, bigCatch: 0.92, sack: 0.93, pick: 0.94, longKick: 0.95 };
  const data: FranchiseData = { ...base, pool: { ...base.pool, standoutCentering: centering } };
  it("replaces the centering and nothing else", () => {
    const { data: got } = franchiseKit(data);
    expect(got.engine.standouts.centering).toEqual(centering);
    expect({ ...got, engine: { ...got.engine, standouts: { ...got.engine.standouts, centering: null } } }).toEqual({ ...data.game, engine: { ...data.game.engine, standouts: { ...data.game.engine.standouts, centering: null } } });
  });
  it("leaves quick play alone", () => {
    const before = structuredClone(data.game.engine.standouts);
    franchiseKit(data, { standouts: true });
    expect(data.game.engine.standouts).toEqual(before);
    expect(prepareGame(data.game).data.engine.standouts.centering).toEqual(before.centering);
  });
  it("the shipped file has its own value for every kind", () => {
    expect(Object.keys(shippedData().pool.standoutCentering).sort()).toEqual(Object.keys(gameData().engine.standouts.centering).sort());
  });
});

describe("A1, A4 and B15 schema fixtures of the revision", () => {
  const parse = (edit: (raw: RawFiles) => void): FranchiseData => {
    const raw = structuredClone(rawFiles());
    edit(raw);
    return parseFranchiseData(raw, gameData());
  };
  type Any = Record<string, Record<string, Record<string, unknown>>>;
  const ai = (r: RawFiles): Any => r.draftAi as Any;
  const adj = (r: RawFiles): Any => r.pool["adjust"] as Any;
  it("an untouched copy parses, and so does errorSdMax at the cap of 8", () => {
    expect(() => parse(() => undefined)).not.toThrow();
    expect(() => parse((r) => void ((r.draftAi as Any)["evaluation"] = { errorSdMin: 1, errorSdMax: 8 } as never))).not.toThrow();
  });
  it.each<[string, (r: RawFiles) => void]>([
    ["an errorSdMax over 8", (r) => void (r.draftAi["evaluation"] = { errorSdMin: 1, errorSdMax: 8.01 })],
    ["a negative errorSdMin", (r) => void (r.draftAi["evaluation"] = { errorSdMin: -1, errorSdMax: 5 })],
    ["an errorSdMin above the maximum", (r) => void (r.draftAi["evaluation"] = { errorSdMin: 6, errorSdMax: 5 })],
    ["a slotNeed list that rises", (r) => void ((ai(r)["slotNeed"] as Record<string, unknown>)["QB"] = [5, 6, 1])],
    ["a slotNeed list one short of the target", (r) => void ((ai(r)["slotNeed"] as Record<string, unknown>)["QB"] = [5, 4])],
    ["a slotNeed list one past the target", (r) => void ((ai(r)["slotNeed"] as Record<string, unknown>)["QB"] = [5, 4, 3, 0])],
    ["a slotNeed list missing", (r) => void delete (ai(r)["slotNeed"] as Record<string, unknown>)["QB"]],
    ["a style that names no known position", (r) => void ((ai(r)["styles"] as Record<string, unknown>)["odd"] = { weight: 1, value: { XX: 1.1 } })],
    ["a style without a weight", (r) => void ((ai(r)["styles"] as Record<string, unknown>)["odd"] = { value: { QB: 1.1 } })],
    ["an autoPick style that does not exist", (r) => void (r.draftAi["autoPick"] = { style: "nobody", errorSd: 0 })],
    ["no styles at all", (r) => void (r.draftAi["styles"] = {})],
    ["an adjust entry outside the position's overall weights", (r) => void ((adj(r)["QB"] as Record<string, unknown>)["speed"] = { scale: 1, offset: 0 })],
    ["an adjust entry for a rating the position does not have", (r) => void ((adj(r)["QB"] as Record<string, unknown>)["hands"] = { scale: 1, offset: 0 })],
    ["an adjust entry without a scale", (r) => void ((adj(r)["QB"] as Record<string, unknown>)["accuracy"] = { offset: 0 })],
    ["no floor", (r) => void delete r.pool["floor"]],
    ["no standout centering", (r) => void delete r.pool["standoutCentering"]],
    ["a standout kind missing", (r) => void delete (r.pool["standoutCentering"] as Record<string, unknown>)["sack"]],
    ["no tuning record", (r) => void delete r.pool["tuning"]],
  ])("refuses %s", (_n, edit) => {
    expect(() => parse(edit)).toThrow();
  });
  it("the shipped adjust names only weighted ratings", () => {
    const d = shippedData();
    for (const p of POSITIONS) for (const r of Object.keys(d.pool.adjust[p])) expect(Object.keys(d.overallWeights[p] ?? {}), `${p} ${r}`).toContain(r);
  });
  it("stream 4 is retired, 6 and 7 are new, no other id changed", () => {
    expect(STREAMS).toEqual({ league: 1, pool: 2, draftOrder: 3, numbers: 5, draftProfile: 6, draftEvaluation: 7 });
  });
  it("leagueTeams gives the identities createFranchise then uses", () => {
    expect(value(leagueTeams(shippedData(), 77))).toEqual(create(shippedData(), 77).teams);
    expect(value(leagueTeams(shippedData(), 78))).not.toEqual(create(shippedData(), 77).teams);
  });
});
