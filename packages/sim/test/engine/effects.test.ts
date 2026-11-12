// D4-D7: matchups and ratings have visible effects, ratings are centered, and personnel
// differences between packages come from the matchup table only.

import { describe, expect, it } from "vitest";
import { BASE_RATINGS, POSITION_SKILLS, POSITIONS, type Position, type RatingEffect, type TeamPool } from "../../../shared/src/engine";
import type { PlayResult } from "../../../shared/src/types";
import { defenseShares } from "../../src/caller/defense";
import { applyEffect, leagueMeans } from "../../src/engine/effects";
import { generateTeam, onField } from "../../src/engine/players";
import { createEngine } from "../../src/engine/resolve";
import { toSituation } from "../../src/game/situation";
import type { GameState } from "../../src/game/types";
import { Rng } from "../../src/rng";
import { loadCallerData, readJson } from "../caller/load-data";
import { loadEngineData } from "../support/engine-data";
import { flatTeam, meansAt, scrimmageState, withRating } from "../support/engine-fixtures";
import { loadRules } from "../support/rules";

const data = loadEngineData();
const { rules } = loadRules();
const caller = loadCallerData();
const LEVEL = 65;
const flat = meansAt(data, LEVEL);

type Detail = { classProbabilities?: Record<string, number>; foulRates?: Record<string, number> };

/** Resolves until the play is not a pre-snap foul, so the class probabilities are recorded. */
function probe(resolve: ReturnType<typeof createEngine>, s: GameState, call: Parameters<ReturnType<typeof createEngine>>[1], def: string | null, home: TeamPool, away: TeamPool): Detail {
  for (let seed = 1; seed < 500; seed++) {
    const p: PlayResult = resolve(s, call, def, { home, away }, Rng.fromSeed(seed));
    const d = p.detail as Detail;
    if (d.classProbabilities !== undefined || call.call === "kneel") return d;
  }
  throw new Error("only pre-snap fouls");
}

describe("rating centering (D5)", () => {
  it("at edge 0 every effect is exactly 1", () => {
    const team = flatTeam(data, "F", LEVEL);
    const means = leagueMeans(flat.distributions);
    for (const e of data.ratings.effects) {
      const off = onField(team, data.personnel.offense["shotgun"] ?? {}, "shotgun");
      const def = onField(team, data.personnel.packages["nickel"] ?? {}, "nickel");
      const kick = onField(team, data.personnel.kick["kickoff"] ?? {}, "kickoff");
      expect(applyEffect(e, off, def, means).multiplier, e.id).toBe(1);
      expect(applyEffect(e, { ...kick, ...off }, def, means).multiplier, e.id).toBe(1);
    }
  });

  it("across 1,000 pairs of generated teams, league class rates match the baseline within 0.2 pp", () => {
    const withEffects = createEngine(data);
    const without = createEngine({ ...data, ratings: { ...data.ratings, effects: [] } });
    const team = flatTeam(data, "F", LEVEL);
    const leaves = ["insideRun", "outsideRun", "qbSneak", "shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"];
    const situations = [scrimmageState(25, 1, 10), scrimmageState(50, 3, 2), scrimmageState(70, 2, 7), scrimmageState(85, 1, 10), scrimmageState(40, 3, 9)];
    const presets = ["nickelCover3", "baseCover3", "dimeCover4", "nickelCover1Blitz"];
    const acc: Record<string, number> = {};
    const base: Record<string, number> = {};
    const rng = Rng.fromSeed(5);
    let n = 0;
    // Antithetic pairs: pairs 500-999 mirror pairs 0-499 around the curve's center (65), itself
    // a draw from the same symmetric curve. The first-order team-to-team noise cancels, so the
    // test sees the effects' bias, not which 1,000 teams were drawn.
    const mirror = (t: TeamPool): TeamPool => ({
      ...t,
      players: t.players.map((p) => ({
        ...p,
        ratings: Object.fromEntries(Object.entries(p.ratings).map(([k, v]) => [k, Math.min(99, 2 * LEVEL - v)])) as typeof p.ratings,
        skills: Object.fromEntries(Object.entries(p.skills).map(([k, v]) => [k, Math.min(99, 2 * LEVEL - v)])),
      })),
    });
    const drawn: [TeamPool, TeamPool][] = [];
    for (let pair = 0; pair < 1000; pair++) {
      if (pair < 500) drawn.push([generateTeam(rng, data, "H"), generateTeam(rng, data, "A")]);
      const [h, a] = drawn[pair % 500] as [TeamPool, TeamPool];
      const home = pair < 500 ? h : mirror(h);
      const away = pair < 500 ? a : mirror(a);
      const s = situations[(pair % 500) % situations.length] as GameState;
      const pre = presets[(pair % 500) % presets.length] as string;
      for (const leaf of leaves) {
        const a = probe(withEffects, s, { call: leaf, formation: "shotgun" }, pre, home, away).classProbabilities ?? {};
        const b = probe(without, s, { call: leaf, formation: "shotgun" }, pre, team, team).classProbabilities ?? {};
        for (const [c, v] of Object.entries(a)) {
          acc[`${leaf}.${c}`] = (acc[`${leaf}.${c}`] ?? 0) + v;
          base[`${leaf}.${c}`] = (base[`${leaf}.${c}`] ?? 0) + (b[c] ?? 0);
        }
      }
      n++;
    }
    const per = n;
    for (const k of Object.keys(acc)) expect(Math.abs((acc[k] as number) - (base[k] as number)) / per * 100, k).toBeLessThanOrEqual(0.2);
  }, 120_000);
});

/** A probe for an effect: the state, call, defense and the value the effect moves. */
function probeFor(e: RatingEffect): { s: GameState; call: { call: string; formation?: string }; def: string | null; read: (d: Detail) => number } {
  const t = e.target;
  const sum = (m: Record<string, number> | undefined, ks: readonly string[]): number => ks.reduce((a, k) => a + (m?.[k] ?? 0), 0);
  switch (t.kind) {
    case "class": {
      const fam = data.scrimmage.families[t.families[0] as string];
      const leaf = t.leaves?.[0] ?? (fam?.leaves[0] as string);
      const s = t.maxYardsToGo !== undefined ? scrimmageState(50, 3, 1) : scrimmageState(35, 1, 10);
      return { s, call: { call: leaf, formation: "shotgun" }, def: "nickelCover3", read: (d) => sum(d.classProbabilities, t.classes) };
    }
    case "penalty":
      return { s: scrimmageState(35, 1, 10), call: { call: "shortPass", formation: "shotgun" }, def: "nickelCover3", read: (d) => sum(d.foulRates, t.penalties) };
    case "punt":
      return { s: scrimmageState(30, 4, 10), call: { call: "punt" }, def: null, read: (d) => sum(d.classProbabilities, t.classes) };
    case "fieldGoal":
      return { s: scrimmageState(t.minDistance !== undefined ? 60 : 75, 4, 10), call: { call: "fieldGoal" }, def: null, read: (d) => sum(d.classProbabilities, t.classes) };
    case "extraPoint":
      return {
        s: { ...scrimmageState(98, 0, 0), phase: "try", down: 0, distance: 0, trySpots: { kick: 85, twoPoint: 98 } },
        call: { call: "extraPoint" },
        def: null,
        read: (d) => sum(d.classProbabilities, t.classes),
      };
    case "kickoff":
      return { s: { ...scrimmageState(35, 0, 0), phase: "kickoff", down: 0, distance: 0 }, call: { call: "kickoff" }, def: null, read: (d) => sum(d.classProbabilities, t.classes) };
  }
}

interface D6Row {
  readonly position: Position;
  readonly rating: string;
  readonly effect: string;
  readonly at10: number;
  readonly at90: number;
  readonly relative: number;
}

/** D6: for each rating, the effect with the largest relative change, p10 to p90 on one player. */
function d6Rows(): D6Row[] {
  const resolve = createEngine(flat);
  const team = flatTeam(data, "F", LEVEL);
  const rows: D6Row[] = [];
  for (const pos of POSITIONS) {
    for (const r of [...BASE_RATINGS, ...POSITION_SKILLS[pos]]) {
      const dist = data.distributions.ratings[pos]?.[r];
      let best: D6Row | null = null;
      for (const e of data.ratings.effects) {
        const inp = e.inputs.find((i) => i.position === pos && i.rating === r);
        if (inp === undefined || dist === undefined) continue;
        const pr = probeFor(e);
        const mk = (v: number): TeamPool => withRating(team, pos, r, v);
        const lo = inp.side === "offense" ? probe(resolve, pr.s, pr.call, pr.def, mk(dist.p10), team) : probe(resolve, pr.s, pr.call, pr.def, team, mk(dist.p10));
        const hi = inp.side === "offense" ? probe(resolve, pr.s, pr.call, pr.def, mk(dist.p90), team) : probe(resolve, pr.s, pr.call, pr.def, team, mk(dist.p90));
        const a = pr.read(lo);
        const b = pr.read(hi);
        const rel = a + b > 0 ? Math.abs(b - a) / ((a + b) / 2) : 0;
        if (best === null || rel > best.relative) best = { position: pos, rating: r, effect: e.id, at10: a, at90: b, relative: rel };
      }
      rows.push(best ?? { position: pos, rating: r, effect: "(none)", at10: 0, at90: 0, relative: 0 });
    }
  }
  return rows;
}

describe("every rating has a visible effect (D6)", () => {
  it("raising one player from the position's 10th to 90th percentile moves a named class or penalty rate by at least the minimum", () => {
    const rows = d6Rows();
    if (process.env["ENGINE_D6_REPORT"] === "1") console.log(JSON.stringify(rows));
    const weak = rows.filter((x) => x.relative < data.ratings.minRelativeEffect).map((x) => `${x.position}.${x.rating} (${x.effect}: ${x.relative.toFixed(3)})`);
    expect(weak).toEqual([]);
  }, 120_000);
});

describe("no double counting (D7)", () => {
  it("Base and Dime with league-average players have no rating edge; the difference is the matchup table's", () => {
    const team = flatTeam(data, "F", LEVEL);
    const real = createEngine(flat);
    const noEffects = createEngine({ ...flat, ratings: { ...flat.ratings, effects: [] } });
    const s = scrimmageState(40, 1, 10);
    for (const pre of ["baseCover3", "dimeCover4"]) {
      const p = real(s, { call: "insideRun", formation: "underCenter" }, pre, { home: team, away: team }, Rng.fromSeed(3));
      const trace = (p.detail as { trace: { factor: string }[] }).trace;
      expect(trace.some((e) => e.factor === "rating")).toBe(false);
      const a = probe(real, s, { call: "insideRun", formation: "underCenter" }, pre, team, team).classProbabilities;
      const b = probe(noEffects, s, { call: "insideRun", formation: "underCenter" }, pre, team, team).classProbabilities;
      expect(a).toEqual(b);
    }
  });
});

describe("a matchup has a visible effect (D4)", () => {
  type Cell = { leaves: string[]; presets: string[]; class: string; m: number; check?: { minRelativeChange: number } };
  const cells: Cell[] = (readJson("data/engine/matchup.json") as { matchup: Cell[] }).matchup.filter((c) => c.check !== undefined);
  const resolve = createEngine(flat);
  const team = flatTeam(data, "F", LEVEL);
  const goal = scrimmageState(97, 1, 3);
  const open = scrimmageState(35, 1, 10);

  it("every leaf has a documented cell that moves its class the documented way against the leaf's average", () => {
    const passed = new Set<string>();
    const report: string[] = [];
    for (const c of cells) {
      for (const leaf of c.leaves) {
        for (const pre of c.presets) {
          const s = pre === "goalLine" ? goal : open;
          const sit = toSituation(s, rules);
          const shares = defenseShares(sit, caller).presets;
          const call = { call: leaf, formation: "shotgun" };
          let avg = 0;
          for (const sp of shares) {
            if (sp.p === 0) continue;
            avg += sp.p * (probe(resolve, s, call, sp.call, team, team).classProbabilities?.[c.class] ?? 0);
          }
          const at = probe(resolve, s, call, pre, team, team).classProbabilities?.[c.class] ?? 0;
          const rel = (at - avg) / avg;
          const ok = c.m > 1 ? rel >= (c.check?.minRelativeChange ?? 0) : -rel >= (c.check?.minRelativeChange ?? 0);
          report.push(`${leaf} vs ${pre} ${c.class}: ${(rel * 100).toFixed(1)}%`);
          if (ok) passed.add(leaf);
        }
      }
    }
    const leaves = Object.values(data.scrimmage.families).flatMap((f) => f.leaves);
    expect(leaves.filter((l) => !passed.has(l)), report.join("\n")).toEqual([]);
  }, 120_000);
});
