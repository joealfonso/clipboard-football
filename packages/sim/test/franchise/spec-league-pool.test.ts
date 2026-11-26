// A1, A2, A4 and B9 from docs/specs/m4-franchise-core.md: data files, league structure, the pool
// and jersey numbers. No rating value is pinned: pool.json is expected to change.

import { describe, expect, it } from "vitest";
import { parseFranchiseData } from "../../../shared/src/franchise-schema";
import type { FranchiseData } from "../../../shared/src/franchise";
import { assignRosterNumbers, createFranchise, runDraft, setAutoDraft } from "../../src/franchise";
import { stream } from "../../src/franchise/streams";
import { BASE_RATINGS, create, gameData, pinnedData, POSITIONS, POSITION_SKILLS, prng, rawFiles, shippedData, smallData, SPEC_MIN, specLimits, value } from "./spec-support";
import type { Position, RawFiles } from "./spec-support";

const data = shippedData();
const small = smallData();

function parse(edit: (raw: RawFiles) => void): FranchiseData {
  const raw = structuredClone(rawFiles());
  edit(raw);
  return parseFranchiseData(raw, gameData());
}
type Positions = Record<Position, Record<string, unknown>>;
const pos = (raw: RawFiles): Positions => raw.roster["positions"] as Positions;

describe("A1 data files", () => {
  it("the shipped files parse; targets sum to rosterSize; min <= target <= max against slotNeeds", () => {
    const l = specLimits(data);
    expect(POSITIONS.reduce((s, p) => s + l[p].target, 0)).toBe(data.roster.rosterSize);
    for (const p of POSITIONS) {
      expect(l[p].min, p).toBe(SPEC_MIN[p]);
      expect(l[p].min).toBeLessThanOrEqual(l[p].target);
      expect(l[p].target).toBeLessThanOrEqual(l[p].max);
    }
  });
  it.each<[string, (raw: RawFiles) => void]>([
    ["targets that do not sum to rosterSize", (r) => void (pos(r).QB["target"] = 2)],
    ["rosterSize without matching targets", (r) => void (r.roster["rosterSize"] = 52)],
    ["a target above max", (r) => void ((pos(r).QB["target"] = 5), (pos(r).RB["target"] = 2))],
    ["a target below the engine minimum", (r) => void ((pos(r).DL["target"] = 4), (pos(r).OL["target"] = 11), (pos(r).LB["target"] = 9))],
    ["a missing position", (r) => void delete (pos(r) as Partial<Positions>).P],
    ["an extra key in roster.json", (r) => void (r.roster["extra"] = 1)],
    ["a stored minimum", (r) => void (pos(r).QB["min"] = 1)],
    ["a string for a number", (r) => void (pos(r).QB["max"] = "4")],
    ["a missing title game", (r) => void delete r.league["titleGame"]],
    ["a wrong schema version", (r) => void (r.pool["schemaVersion"] = 99)],
    ["a negative surplus", (r) => void (r.pool["surplus"] = -0.1)],
    // Revision 2026-11-24: depthCurve, need and noise are deleted, so a file that still has one is refused.
    ["a leftover depth curve", (r) => void (r.pool["depthCurve"] = [{ p: 0, rating: 1 }, { p: 1, rating: 1 }])],
    ["a leftover noise block", (r) => void (r.draftAi["noise"] = { spread: 1 })],
    ["a leftover need block", (r) => void (r.draftAi["need"] = { starter: 1, starterShare: 1, depth: 1 })],
    ["a missing position value", (r) => void delete (r.draftAi["positionValue"] as Record<string, unknown>)["QB"]],
    ["null", (r) => void (r.pool = null as never)],
  ])("rejects %s", (_n, edit) => {
    expect(() => parse(edit)).toThrow();
  });
  it("the edits above are what is rejected: an untouched copy parses", () => expect(() => parse(() => undefined)).not.toThrow());
});

describe("A2 createFranchise", () => {
  it("32 teams T00 to T31, two conferences of four divisions of four, unique names from the 36", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = create(data, seed);
      expect(s.teams.map((t) => t.id).sort()).toEqual(Array.from({ length: 32 }, (_, i) => `T${String(i).padStart(2, "0")}`));
      const groups = new Map<string, number>();
      for (const t of s.teams) groups.set(`${t.conference}/${t.division}`, (groups.get(`${t.conference}/${t.division}`) ?? 0) + 1);
      expect([...groups.values()]).toEqual(Array.from({ length: 8 }, () => 4));
      expect(new Set(s.teams.map((t) => t.conference)).size).toBe(2);
      expect(new Set(s.teams.map((t) => t.division)).size).toBe(4);
      expect(new Set(s.teams.map((t) => `${t.place} ${t.nickname}`)).size).toBe(32);
      expect(s.phase).toBe("draft");
      expect(s.seed).toBe(seed);
    }
  });
  it("is deterministic by seed; placement and pool differ across seeds", () => {
    expect(create(data, 5)).toStrictEqual(create(data, 5));
    const names = (seed: number): string => create(small, seed).teams.map((t) => t.nickname).join();
    expect(new Set(Array.from({ length: 10 }, (_, i) => names(i + 1))).size).toBeGreaterThan(8);
    expect(create(data, 5).players).not.toEqual(create(data, 6).players);
  });
  it("the user's team and slot do not change the league or the pool", () => {
    const a = create(small, 5, "random", "T00");
    const b = create(small, 5, 3, "T02");
    expect(b.teams).toStrictEqual(a.teams);
    expect(b.players).toStrictEqual(a.players);
    expect(value(createFranchise(small, { seed: 5, userTeam: "T00" }))).toStrictEqual(a);
  });
});

describe("A4 the pool", () => {
  // ceil(32 x target x 1.1), by hand: QB 105.6, RB 140.8, WR 211.2, TE 140.8, OL 316.8, DL 281.6,
  // LB 246.4, CB 211.2, S 140.8, K 35.2, P 35.2.
  const BY_HAND: Record<Position, number> = { QB: 106, RB: 141, WR: 212, TE: 141, OL: 317, DL: 282, LB: 247, CB: 212, S: 141, K: 36, P: 36 };
  const count = (players: readonly { position: Position }[], p: Position): number => players.filter((x) => x.position === p).length;

  it("has the hand-computed count per position at surplus 0.10", () => {
    const players = create(pinnedData(), 1).players;
    for (const p of POSITIONS) expect(count(players, p), p).toBe(BY_HAND[p]);
    expect(players).toHaveLength(1871);
  });
  it("follows the data: 4 teams, other surpluses, with no rounding slip on whole products", () => {
    expect(count(create(small, 1).players, "OL")).toBe(31); // 4 x 7 x 1.1 = 30.8
    const at = (surplus: number): FranchiseData => ({ ...small, pool: { ...small.pool, surplus } });
    expect(count(create(at(0.25), 1).players, "OL")).toBe(35); // 4 x 7 x 1.25 = 35 exactly
    expect(count(create(at(0.1), 1).players, "WR")).toBe(22); // 4 x 5 x 1.1 = 22 exactly, 22.000000000000004 in floats
    expect(create(at(0), 1).players).toHaveLength(148);
  });
  it.each([1, 2, 3, 4, 5])("seed %i: unique ids and full names, integer ratings 0 to 99, the position's skills and no other", (seed) => {
    const { players } = create(data, seed);
    expect(new Set(players.map((p) => p.id)).size).toBe(players.length);
    expect(new Set(players.map((p) => p.name)).size).toBe(players.length);
    for (const p of players) {
      expect(p.id).toMatch(/^P\d{4,}$/);
      expect(Object.keys(p.ratings).sort()).toEqual([...BASE_RATINGS].sort());
      expect(Object.keys(p.skills).sort()).toEqual([...POSITION_SKILLS[p.position]].sort());
      for (const v of [...Object.values(p.ratings), ...Object.values(p.skills)]) if (!(Number.isInteger(v) && v >= 0 && v <= 99)) expect.fail(`${p.id} has rating ${v}`);
    }
  });
  // Revision 2026-11-24 (A4): one distribution per position, no tiers (it asked for two tiers before).
  // The distribution itself is in spec-pool-adjust.test.ts.
  it("no player is in a tier: where the curve is flat, every player at a position has the same ratings", () => {
    const base = pinnedData();
    const flatCurve = { ...base.game.engine, ratings: { ...base.game.engine.ratings, curve: [{ p: 0, rating: 70 }, { p: 1, rating: 70 }] } };
    const { players } = create({ ...base, game: { ...base.game, engine: flatCurve } }, 3);
    for (const p of POSITIONS) expect(new Set(players.filter((x) => x.position === p).map((x) => JSON.stringify([x.ratings, x.skills]))).size, p).toBe(1);
  });
});

describe("B9 jersey numbers", () => {
  const ranges = gameData().engine.rules.jerseyNumbers;
  const legal = (p: Position, n: number): boolean => Number.isInteger(n) && (ranges[p] ?? []).some(([a, b]) => n >= a && n <= b);

  it("after a draft every rostered player, and nobody else, has a legal number unique on his team", () => {
    for (const [d, seeds] of [[data, 3], [small, 30]] as const) {
      for (let seed = 1; seed <= seeds; seed++) {
        const s = value(runDraft(value(setAutoDraft(create(d, seed), true)), d)).state;
        const byId = new Map(s.players.map((p) => [p.id, p.position]));
        expect(Object.keys(s.numbers).sort()).toEqual(Object.values(s.rosters).flat().sort());
        for (const t of s.teams) {
          const ids = s.rosters[t.id] as readonly string[];
          expect(new Set(ids.map((id) => s.numbers[id])).size, `${t.id} seed ${seed}`).toBe(ids.length);
          for (const id of ids) expect(legal(byId.get(id) as Position, s.numbers[id] as number), id).toBe(true);
        }
      }
    }
  });

  it("10,000 random 53-player rosters inside min and max: never a throw, a failure or a clash", () => {
    const l = specLimits(pinnedData());
    const rand = prng(99);
    const bad: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      const counts = Object.fromEntries(POSITIONS.map((p) => [p, l[p].min])) as Record<Position, number>;
      for (let left = 20; left > 0; ) {
        const p = POSITIONS[Math.floor(rand() * POSITIONS.length)] as Position;
        if (counts[p] < l[p].max) {
          counts[p]++;
          left--;
        }
      }
      const roster = POSITIONS.flatMap((p) => Array.from({ length: counts[p] }, (_, k) => ({ id: `${p}${k}`, position: p })));
      const r = assignRosterNumbers(roster, gameData().engine.rules, stream(i + 1, 1));
      if (!r.ok) bad.push(`roster ${i}: no number for ${r.playerId}`);
      else if (new Set(Object.values(r.numbers)).size !== 53 || roster.some((x) => !legal(x.position, r.numbers[x.id] as number))) bad.push(`roster ${i}: clash or illegal`);
    }
    expect(bad).toEqual([]);
  });

  it("the tightest rosters the maximums allow still get numbers: blockers and rushers at max, receivers and backs at max", () => {
    const l = specLimits(pinnedData());
    const tight: readonly (readonly Position[])[] = [["OL", "DL", "LB"], ["CB", "S", "RB", "WR", "TE"], ["DL", "LB", "K", "P"], ["QB", "WR", "CB", "S"]];
    tight.forEach((full, i) => {
      const roster = POSITIONS.flatMap((p) => Array.from({ length: full.includes(p) ? l[p].max : l[p].min }, (_, k) => ({ id: `${p}${k}`, position: p })));
      for (let seed = 1; seed <= 200; seed++) expect(assignRosterNumbers(roster, gameData().engine.rules, stream(seed, i)).ok).toBe(true);
    });
  });

  it("same seed, same numbers", () => {
    const run = (seed: number): Readonly<Record<string, number>> => value(runDraft(value(setAutoDraft(create(small, seed), true)), small)).state.numbers;
    expect(run(4)).toEqual(run(4));
  });
});
