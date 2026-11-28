// A5, A10, A11 and B13 of docs/specs/m4-franchise-core.md on a few drafted leagues, with the spec's
// bounds. The gates over 200 and 800 leagues are in test/franchise/franchise.heavy.test.ts; this is a
// cheap, separate reading of the same sentences, with its own deployment weights. Seeds 70001 up: not
// tuning seeds (100001 to 100800) and not the heavy seeds (1 to 800).

import { describe, expect, it } from "vitest";
import type { FranchiseState, PoolPlayer } from "../../../shared/src/franchise";
import type { OnField } from "../../../shared/src/play";
import { runDraft, setAutoDraft } from "../../src/franchise";
import { averageCoachFor, generateLeague, setupGame } from "../../src/loop/league";
import { playGame, prepareGame } from "../../src/loop/play";
import { Rng } from "../../src/rng";
import { BASE_RATINGS, boardOrder, create, gameData, POSITIONS, POSITION_SKILLS, shippedData, specLimits, specOverall, value } from "./spec-support";
import type { Position } from "./spec-support";

const data = shippedData();
const limits = specLimits(data);
const LEAGUES = 14;
const states: FranchiseState[] = Array.from({ length: LEAGUES }, (_, i) => value(runDraft(value(setAutoDraft(create(data, 70001 + i), true)), data)).state);

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Every team's players at a position in depth order, by league. */
function depth(s: FranchiseState, p: Position): PoolPlayer[][] {
  const byId = new Map(s.players.map((x) => [x.id, x]));
  return s.teams.map((t) => boardOrder((s.rosters[t.id] as readonly string[]).map((id) => byId.get(id) as PoolPlayer).filter((x) => x.position === p), data.overallWeights));
}
const depths = new Map(POSITIONS.map((p) => [p, states.map((s) => depth(s, p))]));
const ovr = (p: PoolPlayer): number => specOverall(p, data.overallWeights);

describe("B13 no one-position rounds", () => {
  const rounds = data.roster.rosterSize;
  // share[league][round][position]
  const share = states.map((s) => {
    const pos = new Map(s.players.map((x) => [x.id, x.position]));
    const out = Array.from({ length: rounds }, () => Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>);
    s.draft.picks.forEach((k, i) => ((out[Math.floor(i / 32)] as Record<Position, number>)[pos.get(k.playerId) as Position] += 1 / 32));
    return out;
  });
  it("averaged by round no position is over 50% of a round's picks", () => {
    for (let r = 0; r < rounds; r++) for (const p of POSITIONS) expect(mean(share.map((l) => (l[r] as Record<Position, number>)[p])), `round ${r + 1} ${p}`).toBeLessThanOrEqual(0.5);
  });
  it("no single round of any draft is over 75% one position", () => {
    share.forEach((l, i) => l.forEach((x, r) => POSITIONS.forEach((p) => expect(x[p], `league ${i} round ${r + 1} ${p}`).toBeLessThanOrEqual(0.75))));
  });
  it("at least 10% of the picks in rounds 1 to 33 are depth or extra when made", () => {
    let n = 0;
    for (const s of states) {
      const pos = new Map(s.players.map((x) => [x.id, x.position]));
      const held = new Map<string, number>();
      s.draft.picks.slice(0, 33 * 32).forEach((k, i) => {
        const p = pos.get(k.playerId) as Position;
        const key = `${s.draft.slots[i] as string} ${p}`;
        const c = held.get(key) ?? 0;
        if (c >= limits[p].min) n++;
        held.set(key, c + 1);
      });
    }
    expect(n / (LEAGUES * 33 * 32)).toBeGreaterThanOrEqual(0.1);
  });
});

describe("A11 playable bench", () => {
  const withBench = POSITIONS.filter((p) => limits[p].target > limits[p].min);
  it("is every position but the kickers", () => expect(withBench).toEqual(POSITIONS.filter((p) => p !== "K" && p !== "P")));
  it.each(withBench)("%s: starters 2 to 15 above the first backup, 40 or more at the target slot, backups overlap starters", (p) => {
    const { min, target } = limits[p];
    const teams = (depths.get(p) as PoolPlayer[][][]).flat();
    const starters = teams.flatMap((t) => t.slice(0, min).map(ovr));
    // A team may hold fewer than min + 1; the first backup is then missing, not zero.
    const firstBackups = teams.flatMap((t) => (t[min] === undefined ? [] : [ovr(t[min] as PoolPlayer)]));
    const atTarget = teams.flatMap((t) => (t[target - 1] === undefined ? [] : [ovr(t[target - 1] as PoolPlayer)]));
    expect(firstBackups.length).toBeGreaterThan(0);
    const gap = mean(starters) - mean(firstBackups);
    expect(gap).toBeGreaterThanOrEqual(2);
    expect(gap).toBeLessThanOrEqual(15);
    expect(mean(atTarget)).toBeGreaterThanOrEqual(40);
    const p10 = [...starters].sort((a, b) => a - b)[Math.floor(0.1 * (starters.length - 1))] as number;
    expect(firstBackups.filter((x) => x >= p10).length / firstBackups.length).toBeGreaterThanOrEqual(0.05);
  });
});

describe("A5 and A10 the deployed mean and spread of every rating", () => {
  const game = gameData();
  /** The average, over run and pass snaps with the position on the field, of 1/n for each depth slot on it: 60 quick-play games. */
  function weights(): Record<Position, number[]> {
    const teams = generateLeague(Rng.fromSeed(70501), game, 32);
    const kit = prepareGame(game, { standouts: false, closeCalls: false });
    const coach = averageCoachFor(game);
    const sum = Object.fromEntries(POSITIONS.map((p) => [p, Array.from({ length: limits[p].min }, () => 0)])) as Record<Position, number[]>;
    const snaps = Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>;
    for (let g = 0; g < 60; g++) {
      const setup = setupGame(teams, 70501, 71000 + g, () => coach);
      const record = playGame(setup, kit, Rng.fromSeed(71000 + g));
      const slot = new Map([...setup.home.pool.players, ...setup.away.pool.players].map((x) => [x.id, Number((/(\d+)$/.exec(x.id) as RegExpExecArray)[1]) - 1]));
      for (const e of record.events) {
        if (e.t !== "play" || (e.play.kind !== "run" && e.play.kind !== "pass")) continue;
        const field = e.play.detail?.["onField"] as OnField;
        for (const side of [field.offense, field.defense]) {
          for (const p of POSITIONS) {
            const ids = side[p] ?? [];
            if (ids.length === 0) continue;
            snaps[p]++;
            for (const id of ids) (sum[p] as number[])[slot.get(id) as number] = ((sum[p] as number[])[slot.get(id) as number] as number) + 1 / ids.length;
          }
        }
      }
    }
    // Kicker and punter take no run or pass snap: slot 1.
    return Object.fromEntries(POSITIONS.map((p) => [p, p === "K" || p === "P" ? [1] : sum[p].map((x) => x / snaps[p])])) as Record<Position, number[]>;
  }
  const w = weights();

  interface Rated {
    readonly ratings: Readonly<Record<string, number>>;
    readonly skills: Readonly<Record<string, number>>;
  }
  const rating = (x: Rated, r: string): number => x.ratings[r] ?? (x.skills[r] as number);
  /** Deployed mean and SD of one rating over teams (each a depth list), and each league's mean. */
  function moments(leagues: readonly (readonly (readonly Rated[])[])[], p: Position, r: string): { mean: number; sd: number; se: number } {
    let a = 0;
    let b = 0;
    let n = 0;
    const perLeague: number[] = [];
    for (const teams of leagues) {
      let la = 0;
      for (const t of teams) {
        w[p].forEach((wk, k) => {
          const x = rating(t[k] as Rated, r);
          a += wk * x;
          b += wk * x * x;
          la += wk * x;
        });
        n++;
      }
      perLeague.push(la / teams.length);
    }
    const m = a / n;
    const lm = mean(perLeague);
    const v = perLeague.reduce((s, x) => s + (x - lm) ** 2, 0) / (perLeague.length - 1);
    return { mean: m, sd: Math.sqrt(b / n - m * m), se: Math.sqrt(v / perLeague.length) };
  }
  const quick = Array.from({ length: 40 }, (_, i) => generateLeague(Rng.fromSeed(72001 + i), game, 32));
  const quickAt = (p: Position): Rated[][][] => quick.map((l) => l.map((t) => t.pool.players.filter((x) => x.position === p)));

  it("the weights: each position's sum to 1 and never rise down the depth order; the best slots play more at WR, TE and CB", () => {
    for (const p of POSITIONS) {
      expect(w[p].reduce((x, y) => x + y, 0), p).toBeCloseTo(1, 9);
      w[p].forEach((x, i) => expect(i === 0 || x <= (w[p][i - 1] as number) + 1e-12, `${p} ${i}`).toBe(true));
    }
    for (const p of ["WR", "TE", "CB"] as const) expect(w[p][0] as number).toBeGreaterThan(w[p].at(-1) as number);
  });
  const rows = POSITIONS.flatMap((p) => [...BASE_RATINGS, ...POSITION_SKILLS[p]].map((r) => [p, r] as [Position, string]));
  it("there are 67 position ratings", () => expect(rows).toHaveLength(67));
  it("A5: no deployed mean is off the engine's league mean by more than 0.5 and four standard errors of this small sample", () => {
    const off: string[] = [];
    for (const [p, r] of rows) {
      const m = moments(depths.get(p) as PoolPlayer[][][], p, r);
      const league = (game.engine.distributions.ratings as Record<string, Record<string, { mean: number }>>)[p]?.[r]?.mean as number;
      if (Math.abs(m.mean - league) > 0.5 + 4 * m.se) off.push(`${p} ${r}: ${m.mean.toFixed(2)} against ${league}, se ${m.se.toFixed(2)}`);
    }
    expect(off).toEqual([]);
  });
  it("A10: every deployed SD is within 15% of quick play's, computed the same way", () => {
    const off: string[] = [];
    for (const [p, r] of rows) {
      const ratio = moments(depths.get(p) as PoolPlayer[][][], p, r).sd / moments(quickAt(p), p, r).sd;
      if (Math.abs(ratio - 1) > 0.15) off.push(`${p} ${r}: ${ratio.toFixed(3)}`);
    }
    expect(off).toEqual([]);
  });
});
