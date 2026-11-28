// M4 milestone A, criteria A2 (createFranchise) and A4 (the pool).

import { describe, expect, it } from "vitest";
import { BASE_RATINGS, POSITION_SKILLS, POSITIONS } from "../../../shared/src/engine";
import type { FranchiseData, FranchiseState } from "../../../shared/src/franchise";
import { leagueMeans } from "../../src/engine/effects";
import { createEngine } from "../../src/engine/resolve";
import { createFranchise, franchiseKit, generatePool, leagueTeams, overalls, poolCounts } from "../../src/franchise/index";
import { averageCoachFor, leagueFromSeed, setupGame } from "../../src/loop/league";
import { playGame, prepareGame } from "../../src/loop/play";
import type { GameKit } from "../../src/loop/play";
import { Rng } from "../../src/rng";
import { loadFranchiseData, must, newFranchise } from "./support";

const data = loadFranchiseData();
const SEEDS = [0, 1, 2, 3, 2026, 4294967296, Number.MAX_SAFE_INTEGER];

describe("A2: createFranchise", () => {
  it("is deterministic by seed, byte for byte", () => {
    for (const seed of SEEDS) expect(JSON.stringify(newFranchise(data, seed))).toBe(JSON.stringify(newFranchise(data, seed)));
  });

  it("differs across seeds: teams, pool and draft order", () => {
    const a = newFranchise(data, 1);
    const b = newFranchise(data, 2);
    expect(a.teams).not.toEqual(b.teams);
    expect(a.players).not.toEqual(b.players);
    expect(a.draft.slots).not.toEqual(b.draft.slots);
  });

  it.each(SEEDS)("seed %d: 32 teams, two conferences, four divisions of four each, unique names and ids", (seed) => {
    const s = newFranchise(data, seed);
    expect(s.seed).toBe(seed);
    expect(s.teams).toHaveLength(32);
    expect(s.teams.map((t) => t.id)).toEqual(Array.from({ length: 32 }, (_, i) => `T${String(i).padStart(2, "0")}`));
    expect(new Set(s.teams.map((t) => `${t.place} ${t.nickname}`)).size).toBe(32);
    expect(new Set(s.teams.map((t) => t.nickname)).size).toBe(32);
    const conferences = [...new Set(s.teams.map((t) => t.conference))];
    expect(conferences).toEqual(data.league.conferences.map((c) => c.id));
    expect(conferences).toHaveLength(2);
    for (const c of conferences) {
      const divisions = [...new Set(s.teams.filter((t) => t.conference === c).map((t) => t.division))];
      expect(divisions).toEqual(["North", "South", "East", "West"]);
      for (const d of divisions) expect(s.teams.filter((t) => t.conference === c && t.division === d)).toHaveLength(4);
    }
    const known = new Set(data.game.teamNames.teams.map((t) => `${t.place} ${t.nickname}`));
    for (const t of s.teams) expect(known.has(`${t.place} ${t.nickname}`)).toBe(true);
  });

  it("starts in the draft with empty rosters, no numbers and plain JSON", () => {
    const s = newFranchise(data, 7, "T05");
    expect(s.phase).toBe("draft");
    expect(s.settings).toEqual({ userTeam: "T05", draftSlot: null });
    expect(Object.keys(s.rosters)).toEqual(s.teams.map((t) => t.id));
    expect(Object.values(s.rosters).every((r) => r.length === 0)).toBe(true);
    expect(s.numbers).toEqual({});
    expect(s.draft.picks).toEqual([]);
    expect(JSON.parse(JSON.stringify(s)) as FranchiseState).toEqual(s);
  });

  it("the team list for a seed is the franchise's, before a franchise exists", () => {
    expect(must(leagueTeams(data, 11))).toEqual(newFranchise(data, 11).teams);
  });

  it("a bad seed, an unknown team and a bad draft slot are typed errors, never throws", () => {
    for (const seed of [-1, 1.5, Number.NaN, 2 ** 53, "7" as unknown as number]) {
      expect(createFranchise(data, { seed, userTeam: "T00" })).toEqual({ ok: false, error: { code: "badSeed", seed } });
      expect(leagueTeams(data, seed).ok).toBe(false);
    }
    expect(createFranchise(data, { seed: 1, userTeam: "T32" })).toEqual({ ok: false, error: { code: "unknownTeam", teamId: "T32" } });
    for (const slot of [0, 33, 1.5, -1]) expect(createFranchise(data, { seed: 1, userTeam: "T00", draftSlot: slot })).toEqual({ ok: false, error: { code: "badDraftSlot", slot, teams: 32 } });
  });

  it("the designed team-strength shift is not applied: the pool is the same whoever the user is", () => {
    expect(newFranchise(data, 5, "T00").players).toEqual(newFranchise(data, 5, "T31").players);
  });
});

describe("A4: the pool", () => {
  const counts = poolCounts(data);

  it.each(SEEDS)("seed %d: the configured count per position, unique ids and names, integer ratings, the position's skills", (seed) => {
    const pool = generatePool(data, seed);
    for (const p of POSITIONS) expect(pool.filter((x) => x.position === p), p).toHaveLength(counts[p]);
    expect(pool).toHaveLength(1871);
    expect(new Set(pool.map((p) => p.id)).size).toBe(pool.length);
    expect(pool.map((p) => p.id)).toEqual(pool.map((_, i) => `P${String(i + 1).padStart(4, "0")}`));
    expect(new Set(pool.map((p) => p.name)).size).toBe(pool.length);
    const first = new Set(data.game.engine.names.first);
    for (const p of pool) {
      expect(Object.keys(p).sort()).toEqual(["id", "name", "position", "ratings", "skills"]);
      expect(Object.keys(p.ratings)).toEqual([...BASE_RATINGS]);
      expect(Object.keys(p.skills)).toEqual([...POSITION_SKILLS[p.position]]);
      for (const v of [...Object.values(p.ratings), ...Object.values(p.skills)]) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(99);
      }
      expect(first.has(p.name.split(" ")[0] as string)).toBe(true);
    }
  });

  it("is deterministic by seed and differs across seeds", () => {
    expect(generatePool(data, 3)).toEqual(generatePool(data, 3));
    expect(generatePool(data, 3)).not.toEqual(generatePool(data, 4));
  });

  it("one distribution per position: an adjusted rating is the plain curve draw scaled and moved about the league mean, any other is the draw itself", () => {
    const plain = generatePool({ ...data, pool: { ...data.pool, adjust: Object.fromEntries(POSITIONS.map((p) => [p, {}])) as typeof data.pool.adjust } }, 2026);
    const means = leagueMeans(data.game.engine.distributions);
    const curve = data.game.engine.ratings.curve;
    // A spread of scales and offsets, so the clamps are reached, whatever the shipped file holds.
    const wide = Object.fromEntries(POSITIONS.map((p) => [p, Object.fromEntries(Object.keys(data.overallWeights[p] ?? {}).map((r, i) => [r, { scale: 0.8 + 0.3 * i, offset: 9 - 12 * i }]))])) as typeof data.pool.adjust;
    for (const adjust of [data.pool.adjust, wide]) {
      const pool = generatePool({ ...data, pool: { ...data.pool, adjust } }, 2026);
      let moved = 0;
      pool.forEach((p, i) => {
        const was = plain[i] as (typeof plain)[number];
        expect([p.id, p.name, p.position]).toEqual([was.id, was.name, was.position]);
        for (const [r, v] of Object.entries({ ...p.ratings, ...p.skills })) {
          const x = { ...was.ratings, ...was.skills }[r] as number;
          expect(x).toBeGreaterThanOrEqual((curve[0] as (typeof curve)[number]).rating);
          const a = adjust[p.position][r];
          const m = means[p.position]?.[r] as number;
          const want = a === undefined ? x : Math.min(99, Math.max(data.pool.floor, Math.round(m + a.scale * (x - m) + a.offset)));
          if (v !== want) throw new Error(`${p.id} ${r}: ${v}, expected ${want}`);
          if (v !== x) moved++;
        }
      });
      expect(moved).toBeGreaterThan(1000);
    }
  });

  it("no player is in a tier: at each position the first and the last by id draw from the same distribution", () => {
    const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const first: Record<string, number[]> = {};
    const last: Record<string, number[]> = {};
    for (let seed = 1; seed <= 12; seed++) {
      const pool = generatePool(data, seed);
      const ovr = overalls(pool, data.overallWeights);
      for (const p of POSITIONS) {
        const at = pool.filter((x) => x.position === p).map((x) => ovr.get(x.id) as number);
        const half = Math.floor(at.length / 2);
        (first[p] ??= []).push(...at.slice(0, half));
        (last[p] ??= []).push(...at.slice(half));
      }
    }
    // Two tiers put 20 and more points between the halves; sampling alone stays under 3 here.
    for (const p of POSITIONS) expect(Math.abs(mean(first[p] as number[]) - mean(last[p] as number[])), p).toBeLessThan(3);
  });

  it("names stay unique when the lists barely cover the pool (the redraw and the scan both run)", () => {
    const names = { designed: true as const, first: data.game.engine.names.first.slice(0, 20), last: data.game.engine.names.last.slice(0, 94) };
    const tight = { ...data, game: { ...data.game, engine: { ...data.game.engine, names } }, pool: { ...data.pool, names: { unique: true as const, maxRedraws: 0 } } };
    const pool = generatePool(tight, 9);
    expect(20 * 94).toBeGreaterThanOrEqual(pool.length);
    expect(new Set(pool.map((p) => p.name)).size).toBe(pool.length);
  });
});

describe("franchiseKit", () => {
  it("carries the franchise's own standout centering in a copy of the data, and nothing else differs", () => {
    const before = JSON.stringify(data.game.engine.standouts);
    const kit = franchiseKit(data, { standouts: true });
    expect(kit.data.engine.standouts.centering).toEqual(data.pool.standoutCentering);
    expect({ ...kit.data.engine.standouts, centering: null }).toEqual({ ...data.game.engine.standouts, centering: null });
    for (const k of Object.keys(data.game) as (keyof typeof data.game)[]) if (k !== "engine") expect(kit.data[k], k).toBe(data.game[k]);
    for (const k of Object.keys(data.game.engine) as (keyof typeof data.game.engine)[]) if (k !== "standouts") expect(kit.data.engine[k], k).toBe(data.game.engine[k]);
    expect(JSON.stringify(data.game.engine.standouts)).toBe(before);
    expect(franchiseKit(data, { closeCalls: true }).closeCalls).toBe(true);
    expect(franchiseKit(data, { closeCalls: false }).closeCalls).toBeUndefined();
  });

  describe("its resolve plays with that centering", () => {
    const { teams } = leagueFromSeed(data.game, 2026);
    const coach = averageCoachFor(data.game);
    const engine = data.game.engine;
    /** Games 1 to 12 of league 2026 as the kit's own resolve decides them. */
    const games = (kit: GameKit): string => JSON.stringify(Array.from({ length: 12 }, (_, i) => playGame(setupGame(teams, 2026, i + 1, () => coach), kit, Rng.fromSeed(i + 1)).events));
    const reference = (centering: typeof engine.standouts.centering, standouts = true): GameKit => ({ ...prepareGame(data.game, { standouts, closeCalls: false }), resolve: createEngine({ ...engine, standouts: { ...engine.standouts, centering } }, { standouts, closeCalls: false }) });
    const kitOf = (d: FranchiseData, standouts = true): GameKit => franchiseKit(d, { standouts, closeCalls: false });

    it("the shipped centering, not quick play's", () => {
      const played = games(kitOf(data));
      expect(played).toBe(games(reference(data.pool.standoutCentering)));
      expect(played).not.toBe(games(reference(engine.standouts.centering)));
    }, 60_000);

    it("whatever the pool's centering is", () => {
      const centering = { ...data.pool.standoutCentering, bigCatch: 0.1, sack: 3 };
      const played = games(kitOf({ ...data, pool: { ...data.pool, standoutCentering: centering } }));
      expect(played).toBe(games(reference(centering)));
      expect(played).not.toBe(games(kitOf(data)));
    }, 60_000);

    it("and with standouts off, without it", () => {
      expect(games(kitOf(data, false))).toBe(games(reference(data.pool.standoutCentering, false)));
      expect(games(kitOf(data, false))).not.toBe(games(kitOf(data)));
    }, 60_000);
  });
});
