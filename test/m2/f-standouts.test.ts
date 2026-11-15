// M2 milestone F, criteria F4 and F5 (docs/specs/m2-engine-and-game-loop.md, "Standout plays" and
// the F table), written by test-writer from the spec:
// - F4: the rating value in a standout entry is the player's card rating (the league pool, before
//   the home-field shift), so "speed (94)" in the why line matches the player card. Edge case from
//   the spec: an elite home player whose card rating is 89 and whose home-field-shifted rating is 90
//   is not elite.
// - F5: below the threshold a player's multiplier is exactly 1 before centering.

import { describe, expect, it } from "vitest";
import type { Player, TeamPool } from "../../packages/shared/src/engine";
import { onField } from "../../packages/sim/src/engine/players";
import { createEngine, type Players } from "../../packages/sim/src/engine/resolve";
import { standoutsFor, type Applied } from "../../packages/sim/src/engine/standouts";
import { gamePlayers, playGame, prepareGame, type GameEvent } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { flatTeam, scrimmageState, withRating } from "../../packages/sim/test/support/engine-fixtures";
import { data, setupFor } from "./support";

const engine = data.engine;
const so = engine.standouts;
const THRESHOLD = so.threshold;

const rating = (p: Player, r: string): number | undefined => (p.ratings as Readonly<Record<string, number>>)[r] ?? p.skills[r];

/** Every rating of every player moved by `edge` (what home field does to a pool). */
function shiftedPool(pool: TeamPool, edge: number): TeamPool {
  return {
    ...pool,
    players: pool.players.map((p) => ({
      ...p,
      ratings: Object.fromEntries(Object.entries(p.ratings).map(([k, v]) => [k, v + edge])) as Player["ratings"],
      skills: Object.fromEntries(Object.entries(p.skills).map(([k, v]) => [k, v + edge])),
    })),
  };
}

describe("F4: the standout's rating is the card rating, before the home-field shift", () => {
  const kitOn = prepareGame(data, { standouts: true });
  const edge = data.league.homeField.ratingEdge;
  const games = Array.from({ length: 30 }, (_, i) => {
    const seed = 500 + i;
    const setup = setupFor(seed);
    return { setup, record: playGame(setup, kitOn, Rng.fromSeed(seed)) };
  });

  it("the shipped home field shifts ratings (so a card rating and a game rating can differ)", () => {
    expect(edge).not.toBe(0);
  });

  it("every final standout and every engine candidate shows the player's card rating and number", () => {
    let home = 0;
    let away = 0;
    let candidates = 0;
    for (const { setup, record } of games) {
      const cards = new Map([...setup.home.pool.players, ...setup.away.pool.players].map((p) => [p.id, p]));
      const homeIds = new Set(setup.home.pool.players.map((p) => p.id));
      const game = gamePlayers(setup, data);
      const shifted = new Map([...game.home.players, ...game.away.players].map((p) => [p.id, p]));
      for (const e of record.events) {
        if (e.t !== "play") continue;
        const trace = ((e.play.detail ?? {})["trace"] ?? []) as { factor: string; player?: string; rating?: string; value?: number; number?: number }[];
        const entries: { player: string; rating: string; value: number; number: number }[] = [];
        for (const t of trace) if (t.factor === "standoutCandidate") entries.push(t as { player: string; rating: string; value: number; number: number });
        candidates += entries.length;
        const star = (e as Extract<GameEvent, { t: "play" }>).standout;
        if (star !== undefined) entries.push(star);
        for (const s of entries) {
          const card = cards.get(s.player);
          expect(card, s.player).toBeDefined();
          expect(s.value, `${s.player} ${s.rating}`).toBe(rating(card as Player, s.rating));
          expect(s.number).toBe(card?.number);
          // The value the engine played with is a different number whenever the edge isn't 0.
          expect(s.value).not.toBe(rating(shifted.get(s.player) as Player, s.rating));
          expect(s.value).toBeGreaterThanOrEqual(THRESHOLD);
        }
        if (star !== undefined && homeIds.has(star.player)) home++;
        else if (star !== undefined) away++;
      }
    }
    // Both sides' standouts are checked: home (rating raised in play) and away (lowered).
    expect(home).toBeGreaterThan(5);
    expect(away).toBeGreaterThan(5);
    expect(candidates).toBeGreaterThan(10);
  });

  describe("edge case: a home player at 89 on his card and 90 after home field is not elite", () => {
    const flat = flatTeam(engine, "T", 60);
    // A one-point home edge, so the shift takes 89 to exactly 90.
    const run = (cardValue: number): Applied[] => {
      const card = withRating(withRating(flat, "RB", "speed", cardValue), "RB", "elusiveness", cardValue);
      const players: Players = { home: shiftedPool(card, 1), away: flat, cards: { home: card, away: flat } };
      const seen: Applied[] = [];
      const resolve = createEngine(engine, { standouts: true, observeStandouts: (a) => seen.push(...a) });
      for (let i = 0; i < 50; i++) resolve(scrimmageState(30, 1, 10), { call: "insideRun", formation: "underCenter" }, "baseCover3", players, Rng.fromSeed(i + 1));
      return seen.filter((a) => a.kind.id === "breakawayRun");
    };

    it("card 89, game 90: the breakaway kind applies with no elite", () => {
      const applied = run(THRESHOLD - 1);
      expect(applied.length).toBe(50);
      for (const a of applied) expect(a.elites).toEqual([]);
    });

    it("card 90, game 91: elite, and the value shown is 90", () => {
      const applied = run(THRESHOLD);
      expect(applied.length).toBe(50);
      for (const a of applied) {
        expect(a.elites.length).toBe(1);
        expect(a.elites[0]?.value).toBe(THRESHOLD);
      }
    });
  });
});

describe("F5: below the threshold the multiplier is exactly 1 before centering", () => {
  const P = engine.personnel;
  const parts = engine.participants;
  const noCentering = { ...so, centering: {} as typeof so.centering };
  const identity = (p: Player): Player => p;

  /** Units where every player has every rating at `value`. */
  const unitsAt = (value: number, family: string) => {
    const team = flatTeam(engine, "U", value);
    if (family === "fieldGoal") return { offense: onField(team, P.kick["fieldGoal"] as never, "fieldGoal"), defense: onField(team, P.packages["base"] as never, "base") };
    const formation = family === "run" ? "underCenter" : "shotgun";
    return { offense: onField(team, P.offense[formation] as never, formation), defense: onField(team, P.packages[family === "run" ? "base" : "nickel"] as never, family === "run" ? "base" : "nickel") };
  };
  const draws = [
    { family: "run", leaf: "insideRun", distance: null },
    { family: "pass", leaf: "deepPass", distance: null },
    { family: "pass", leaf: "shortPass", distance: null },
    { family: "fieldGoal", leaf: "fieldGoal", distance: 55 },
  ] as const;

  it("every kind: with everyone one point under the threshold, the factor before centering is exactly 1", () => {
    const kinds = new Set<string>();
    for (const d of draws) {
      const u = unitsAt(THRESHOLD - 1, d.family);
      for (const a of standoutsFor(noCentering, parts, d.family, d.leaf, d.distance, u.offense, u.defense, identity)) {
        expect(a.elites, a.kind.id).toEqual([]);
        expect(a.factor, a.kind.id).toBe(1);
        kinds.add(a.kind.id);
      }
    }
    // Every kind a 90-plus player could be elite for was checked (LBs have no Pass Rush; DL do).
    expect([...kinds].sort()).toEqual(so.kinds.map((k) => k.id).sort());
  });

  it("with the shipped centering, below the threshold the factor is the centering alone", () => {
    for (const d of draws) {
      const u = unitsAt(THRESHOLD - 1, d.family);
      for (const a of standoutsFor(so, parts, d.family, d.leaf, d.distance, u.offense, u.defense, identity)) expect(a.factor, a.kind.id).toBe(so.centering[a.kind.id]);
    }
  });

  it("at the threshold the factor rises above 1 (the boundary is 90, not 89 or 91)", () => {
    for (const d of draws) {
      const u = unitsAt(THRESHOLD, d.family);
      for (const a of standoutsFor(noCentering, parts, d.family, d.leaf, d.distance, u.offense, u.defense, identity)) {
        expect(a.elites.length, a.kind.id).toBeGreaterThan(0);
        expect(a.factor, a.kind.id).toBeGreaterThan(1);
      }
    }
  });

  it("one elite among sub-threshold players: only the elite adds to the factor", () => {
    const team = withRating(flatTeam(engine, "U", THRESHOLD - 1), "RB", "speed", 99);
    const off = onField(team, P.offense["underCenter"] as never, "underCenter");
    const def = onField(team, P.packages["base"] as never, "base");
    const [a] = standoutsFor(noCentering, parts, "run", "insideRun", null, off, def, identity);
    expect(a?.elites.map((e) => e.player.position)).toEqual(["RB"]);
    const kind = so.kinds.find((k) => k.id === "breakawayRun");
    expect(a?.factor).toBeCloseTo(1 + (a?.elites[0]?.share ?? 0) * ((kind?.multiplier ?? 1) - 1), 12);
  });
});
