// The value curve and the kicker, punter and quarterback rules of docs/specs/m4-franchise-core.md
// ("Kickers and punters, 2026-11-25", B17) and data/franchise/draft-ai.json's note: at a position
// with a curve, the style's value x the curve at his overall replaces v x overall, straight lines
// between the points, and positionValue there only scales the misreading. B18 is the quarterback
// floor the lead set beside it (tolerances.ts): no team ends with fewer than two. Every expected
// number below is worked out by hand from those sentences and the shipped data, not from the code.

import { describe, expect, it } from "vitest";
import type { DraftAiConfig, DraftOpenView, FranchiseState } from "../../../shared/src/franchise";
import { chooseAiPick, draftView, evaluationError, runDraft, setAutoDraft } from "../../src/franchise";
import { curveValue } from "../../src/franchise/draft-ai";
import { create, flatAi, onClock, shippedData, smallData, specCurve, specOverall, value, withAi, withOveralls } from "./spec-support";
import type { Position } from "./spec-support";

// A curve with a flat start, a steep middle and a near-flat top, so a wrong segment shows up.
const BENT = [[0, 0], [40, 8], [60, 48], [99, 50]] as const;
// The shipped K and P curve, copied from data/franchise/draft-ai.json and checked against it below.
const SHIPPED = [[0, 0], [70, 26], [89, 38], [90, 46], [99, 49]] as const;

describe("the curve is straight lines between its points", () => {
  // Hand values. BENT: 20 is halfway along 0..40 (0 to 8), 50 halfway along 40..60 (8 to 48), 55 three
  // quarters, 80 is 20/39 of the way along 60..99 (48 to 50). SHIPPED: 35 is half of 0..70 (13),
  // 80 is 10/19 along 70..89 (26 + 12 x 10/19), 93 is a third along 90..99 (46 + 1).
  const cases: [readonly (readonly [number, number])[], number, number][] = [
    [BENT, 0, 0],
    [BENT, 20, 4],
    [BENT, 40, 8],
    [BENT, 50, 28],
    [BENT, 55, 38],
    [BENT, 60, 48],
    [BENT, 80, 48 + 40 / 39],
    [BENT, 99, 50],
    [SHIPPED, 35, 13],
    [SHIPPED, 70, 26],
    [SHIPPED, 80, 26 + 120 / 19],
    [SHIPPED, 89, 38],
    [SHIPPED, 90, 46],
    [SHIPPED, 93, 47],
    [SHIPPED, 99, 49],
  ];
  it.each(cases)("curve %j at %i is %d", (points, overall, want) => {
    expect(specCurve(points, overall)).toBeCloseTo(want, 10);
    expect(curveValue(points, overall)).toBeCloseTo(want, 10);
  });

  it("the shipped K and P curves are the ones above", () => {
    const d = shippedData();
    expect(d.draftAi.valueCurve?.K).toEqual(SHIPPED);
    expect(d.draftAi.valueCurve?.P).toEqual(SHIPPED);
  });

  it("each step of one overall adds the slope of its segment, never a jump inside one", () => {
    for (let o = 0; o < 99; o++) {
      const seg = BENT.findIndex(([x], i) => i > 0 && o < x);
      const [x0, y0] = BENT[seg - 1] as readonly [number, number];
      const [x1, y1] = BENT[seg] as readonly [number, number];
      expect(curveValue(BENT, o + 1) - curveValue(BENT, o), `overall ${o}`).toBeCloseTo((y1 - y0) / (x1 - x0), 10);
    }
  });
});

describe("the AI scores a curved position by the style's value x the curve, and positionValue scales only the misreading", () => {
  const small = smallData();
  // Only the one kicker is worth anything: every other position is worth 0 and every overall is 0
  // except his, the punter has no curve, and there is no need bonus.
  function setup(kickerPv: number, kickerOverall: number): { state: FranchiseState; config: DraftAiConfig; kicker: string } {
    const flat = flatAi(small);
    const config: DraftAiConfig = {
      ...flat,
      positionValue: Object.fromEntries(Object.keys(flat.positionValue).map((p) => [p, p === "K" ? kickerPv : 0])) as Record<Position, number>,
      valueCurve: { K: BENT },
      styles: { kickHeavy: { weight: 1, value: { K: 1.5 } } },
      autoPick: { style: "kickHeavy", errorSd: 0 },
    };
    const base = create(withAi(small, config), 7, 4);
    const kicker = base.players.find((p) => p.position === "K")?.id as string;
    const state = withOveralls(base, (p) => (p.id === kicker ? kickerOverall : 0));
    return { state, config, kicker };
  }
  it.each([
    [20, 1.5 * 4],
    [50, 1.5 * 28],
    [55, 1.5 * 38],
    [80, 1.5 * (48 + 40 / 39)],
  ])("a kicker of %i is worth %d, whatever his positionValue", (overall, want) => {
    for (const pv of [0.3, 1, 3]) {
      const { state, config, kicker } = setup(pv, overall);
      expect(specOverall(state.players.find((p) => p.id === kicker) as FranchiseState["players"][number], small.overallWeights)).toBe(overall);
      const team = Number((onClock(state) as string).slice(1));
      const got = chooseAiPick(draftView(state, withAi(small, config)) as DraftOpenView, config, { seed: 7, team, style: "kickHeavy", errorSd: 0 });
      expect(got).toMatchObject({ playerId: kicker, need: 0, noise: 0 });
      expect(got?.value).toBeCloseTo(want, 9);
      expect(got?.score).toBeCloseTo(want, 9);
    }
  });
  it("with an error the noise is positionValue x the style's value x the misreading", () => {
    for (const pv of [0.3, 2]) {
      const { state, config, kicker } = setup(pv, 99);
      const team = Number((onClock(state) as string).slice(1));
      const profile = { seed: 7, team, style: "kickHeavy", errorSd: 4 };
      const got = chooseAiPick(draftView(state, withAi(small, config)) as DraftOpenView, config, profile);
      const noise = pv * 1.5 * evaluationError(profile, kicker);
      expect(got?.playerId).toBe(kicker);
      expect(got?.value).toBeCloseTo(1.5 * 50, 9);
      expect(got?.noise).toBeCloseTo(noise, 9);
      expect(got?.score).toBeCloseTo(75 + noise, 9);
    }
  });
});

describe("shipped leagues: B17 at the spec's bounds and the quarterback floor", () => {
  const big = shippedData();
  const ROUND = 32;
  interface League {
    readonly seed: number;
    readonly picks: { readonly round: number; readonly team: string; readonly position: Position; readonly overall: number; readonly id: string }[];
    readonly held: Map<string, number>;
    readonly bestKicker: { readonly id: string; readonly overall: number };
  }
  function league(seed: number): League {
    const start = value(setAutoDraft(create(big, seed), true));
    const ovr = new Map(start.players.map((p) => [p.id, specOverall(p, big.overallWeights)]));
    const pos = new Map(start.players.map((p) => [p.id, p.position]));
    const end = value(runDraft(start, big)).state;
    expect(end.draft.picks).toHaveLength(32 * big.roster.rosterSize);
    const picks = end.draft.picks.map((p) => ({ round: Math.ceil(p.overallPick / ROUND), team: end.draft.slots[p.overallPick - 1] as string, position: pos.get(p.playerId) as Position, overall: ovr.get(p.playerId) as number, id: p.playerId }));
    const held = new Map<string, number>();
    for (const p of picks) held.set(`${p.team}.${p.position}`, (held.get(`${p.team}.${p.position}`) ?? 0) + 1);
    const kickers = start.players.filter((p) => p.position === "K").sort((a, b) => (ovr.get(b.id) as number) - (ovr.get(a.id) as number) || (a.id < b.id ? -1 : 1));
    const k = kickers[0] as (typeof kickers)[number];
    return { seed, picks, held, bestKicker: { id: k.id, overall: ovr.get(k.id) as number } };
  }
  // The first 100 leagues of the report range (tolerances.ts REPORT_FIRST_SEED), auto-draft on, so the
  // user's picks follow the autoPick profile. The spec's shares (at most 1% of leagues, at least half)
  // are read on these 100 as counts: at most 1 league, and at least half of the leagues that qualify.
  const leagues = Array.from({ length: 100 }, (_, i) => league(500001 + i));
  const kp = (l: League): League["picks"] => l.picks.filter((x) => x.position === "K" || x.position === "P");

  it("no kicker or punter in rounds 1 and 2, in any league", () => {
    for (const l of leagues) for (const p of kp(l)) expect(p.round, `seed ${l.seed} ${p.id} ${p.position} ${p.overall}`).toBeGreaterThan(2);
  });

  it("one under 90 goes before round 12 in at most 1% of leagues", () => {
    const early = leagues.filter((l) => kp(l).some((p) => p.overall < 90 && p.round < 12));
    expect(early.map((l) => l.seed).length).toBeLessThanOrEqual(1);
  });

  it("a team ends with a second kicker or punter in at most 1% of leagues", () => {
    const second = leagues.filter((l) => [...l.held].some(([k, n]) => (k.endsWith(".K") || k.endsWith(".P")) && n > 1));
    expect(second.map((l) => l.seed).length).toBeLessThanOrEqual(1);
  });

  it("the pool's best kicker, at 90 or more, is drafted by round 8 in at least half of those leagues", () => {
    const read = leagues.filter((l) => l.bestKicker.overall >= 90);
    expect(read.length).toBeGreaterThanOrEqual(10);
    const early = read.filter((l) => (l.picks.find((p) => p.id === l.bestKicker.id)?.round ?? Infinity) <= 8);
    expect(early.length * 2).toBeGreaterThanOrEqual(read.length);
  });

  it("every team ends with at least two quarterbacks, never one", () => {
    for (const l of leagues) {
      for (let t = 0; t < 32; t++) {
        const n = l.held.get(`T${String(t).padStart(2, "0")}.QB`) ?? 0;
        expect(n, `seed ${l.seed} T${t}`).toBeGreaterThanOrEqual(2);
        expect(n).toBeLessThanOrEqual(big.roster.positions.QB.max);
      }
    }
  });
});
