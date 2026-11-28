// B7 and B15 and the AI policy of the 2026-11-24 revision (docs/specs/m4-franchise-core.md, Draft):
// per-team profiles fixed for the whole draft, score = v x overall + style need x slotNeed + v x error.
// At a position with a value curve (draft-ai.json, Kickers and punters 2026-11-25) the style's value x
// the curve at his overall replaces v x overall, and v still scales the error.
// The scores here are worked out from those sentences, not taken from the code.

import { describe, expect, it } from "vitest";
import type { DraftAiConfig, DraftOpenView, FranchiseData, FranchiseState, PoolPlayer } from "../../../shared/src/franchise";
import { autoPickPreview, chooseAiPick, draftProfile, draftProfiles, draftView, evaluationError, makePick, runDraft, setAutoDraft, setTarget } from "../../src/franchise";
import { BASE_RATINGS, boardOrder, create, flatAi, forge, onClock, othersFill, playDraft, POSITIONS, POSITION_SKILLS, prng, roundTrip, SCRIPTS, shippedData, smallData, specBlocked, specCurve, specLegalIds, specOverall, teamCounts, undrafted, value, withAi, withOveralls } from "./spec-support";
import type { Position, UserScript } from "./spec-support";

const small = smallData();
const index = (team: string): number => Number(team.slice(1));

/** Loud styles, so a style or need that is dropped or crossed shows up in picks. */
const LOUD: DraftAiConfig = {
  ...small.draftAi,
  evaluation: { errorSdMin: 2, errorSdMax: 6 },
  styles: {
    plain: { weight: 1 },
    line: { weight: 1, value: { OL: 1.2, DL: 1.15 } },
    air: { weight: 1, value: { QB: 1.2, WR: 1.2 }, need: 2 },
    board: { weight: 1, need: 0 },
  },
  autoPick: { style: "line", errorSd: 3 },
};
const loud = withAi(small, LOUD);

interface Scored {
  readonly id: string;
  readonly position: Position;
  readonly overall: number;
  readonly value: number;
  readonly need: number;
  readonly noise: number;
  readonly score: number;
}

/** Every legal player's score for a team, by the spec's formula. */
function scores(s: FranchiseState, d: FranchiseData, team: string, profile: { style: string; errorOf: (id: string) => number }): Scored[] {
  const blocked = specBlocked(s, d, team);
  const counts = teamCounts(s, team);
  const style = d.draftAi.styles[profile.style] as DraftAiConfig["styles"][string];
  return undrafted(s)
    .filter((p) => blocked[p.position].length === 0)
    .map((p) => {
      const tilt = style.value?.[p.position] ?? 1;
      const v = d.draftAi.positionValue[p.position] * tilt;
      const overall = specOverall(p, d.overallWeights);
      const curve = d.draftAi.valueCurve?.[p.position];
      const worth = curve === undefined ? v * overall : tilt * specCurve(curve, overall);
      const need = (style.need ?? 1) * (d.draftAi.slotNeed[p.position][counts[p.position]] ?? 0);
      const noise = v * profile.errorOf(p.id);
      return { id: p.id, position: p.position, overall, value: worth, need, noise, score: worth + need + noise };
    });
}

function best(xs: readonly Scored[]): Scored {
  return [...xs].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))[0] as Scored;
}

describe("the AI score, worked out from the spec", () => {
  it("every AI pick of four drafts is the best score under that team's own style and error", () => {
    const styles = new Set<string>();
    let teamMatters = 0;
    for (let seed = 1; seed <= 4; seed++) {
      let s = create(loud, seed);
      const rand = prng(seed);
      while (s.phase === "draft") {
        const team = onClock(s) as string;
        if (team === "T00") {
          const legal = specLegalIds(s, loud, team);
          s = value(makePick(s, loud, legal[Math.floor(rand() * legal.length)] as string));
          continue;
        }
        const profile = draftProfile(LOUD, seed, index(team));
        styles.add(profile.style);
        const want = best(scores(s, loud, team, { style: profile.style, errorOf: (id) => evaluationError(profile, id) }));
        const other = draftProfile(LOUD, seed, (index(team) % 3) + 1);
        if (best(scores(s, loud, team, { style: other.style, errorOf: (id) => evaluationError(other, id) })).id !== want.id) teamMatters++;
        const run = value(runDraft(s, loud, { maxPicks: 1 }));
        expect(run.picks[0]?.playerId, `seed ${seed} pick ${s.draft.picks.length + 1} ${team} ${profile.style}`).toBe(want.id);
        s = run.state;
      }
    }
    expect([...styles].sort()).toEqual(["air", "board", "line", "plain"]);
    expect(teamMatters).toBeGreaterThan(50);
  });

  it("DraftChoice splits the score into value, need and noise", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = create(loud, seed, 4);
      const team = onClock(s) as string;
      const profile = draftProfile(LOUD, seed, index(team));
      const want = best(scores(s, loud, team, { style: profile.style, errorOf: (id) => evaluationError(profile, id) }));
      const got = chooseAiPick(draftView(s, loud) as DraftOpenView, LOUD, profile);
      expect(got?.playerId).toBe(want.id);
      for (const k of ["value", "need", "noise", "score"] as const) expect(got?.[k]).toBeCloseTo(want[k], 9);
      expect((got?.value ?? 0) + (got?.need ?? 0) + (got?.noise ?? 0)).toBeCloseTo(got?.score as number, 9);
    }
  });
});

describe("B12 the preview: what auto-pick drafts, the branch taken, and the parts of its score", () => {
  it.each<[string, DraftAiConfig, number, string[]]>([
    ["shipped numbers, 222 states", small.draftAi, 6, ["target"]],
    ["need at quarterback and back only, depth as much as starters", { ...small.draftAi, slotNeed: { ...flatAi(small).slotNeed, QB: [60, 60], RB: [60, 60] } }, 2, ["bestAvailable", "target"]],
    ["loud styles, an autoPick profile with an error", LOUD, 2, ["target"]],
    ["no need bonus anywhere", { ...small.draftAi, slotNeed: flatAi(small).slotNeed }, 2, ["bestAvailable", "target"]],
  ])("%s", (_n, config, drafts, reasons) => {
    const d = withAi(small, config);
    const { style, errorSd } = config.autoPick;
    const seen: Record<string, number> = {};
    let states = 0;
    for (let seed = 1; seed <= drafts; seed++) {
      const rand = prng(seed + 50);
      playDraft(d, seed, [SCRIPTS.random, SCRIPTS.hoard][seed % 2] as UserScript, {
        onUserTurn: (plain) => {
          states++;
          const free = undrafted(plain);
          let s = plain;
          for (let i = Math.floor(rand() * 4); i > 0; i--) s = value(setTarget(s, (free[Math.floor(rand() * free.length)] as PoolPlayer).id, true));
          const blocked = specBlocked(s, d, "T00");
          const counts = teamCounts(s, "T00");
          const usable = boardOrder(undrafted(s), d.overallWeights).filter((p) => s.draft.targets.includes(p.id) && blocked[p.position].length === 0 && counts[p.position] < d.roster.positions[p.position].target);
          const all = scores(s, d, "T00", { style, errorOf: (id) => evaluationError({ seed, team: 0, style, errorSd }, id) });
          const want = usable[0] === undefined ? best(all) : (all.find((x) => x.id === usable[0]?.id) as Scored);
          const min = draftView(s, d).user.positions[want.position].min;
          const reason = usable.length > 0 ? "target" : want.need === 0 ? "bestAvailable" : counts[want.position] < min ? "needStarter" : "needDepth";
          const got = autoPickPreview(s, d);
          expect({ id: got?.playerId, reason: got?.reason }, `seed ${seed} pick ${s.draft.picks.length + 1}`).toEqual({ id: want.id, reason });
          for (const k of ["value", "need", "noise", "score"] as const) expect(got?.[k]).toBeCloseTo(want[k], 9);
          const auto = value(runDraft(value(setAutoDraft(s, true)), d, { maxPicks: 1 }));
          expect(auto.picks[0]).toMatchObject({ playerId: want.id, by: "auto" });
          seen[reason] = (seen[reason] ?? 0) + 1;
        },
      });
    }
    expect(states).toBe(drafts * 37);
    expect(Object.keys(seen)).toEqual(expect.arrayContaining(reasons));
  });
});

describe("B12 each reason by hand: every overall is 50, only quarterbacks carry a need bonus", () => {
  // The fixture's quarterback has minimum 1 and target 2; the user (slot 1) is on the clock at picks 1, 8, 9.
  const d = withAi(small, { ...flatAi(small), slotNeed: { ...flatAi(small).slotNeed, QB: [30, 20] } });
  const holding = (qbs: number): FranchiseState => withOveralls(forge(create(d, 3, 1), [0, 7, 8][qbs] as number, othersFill(d, () => "QB")), () => 50);
  it.each([
    [0, "needStarter", "QB", 30],
    [1, "needDepth", "QB", 20],
  ] as const)("with %i quarterbacks: %s", (n, reason, position, need) => {
    expect(autoPickPreview(holding(n), d)).toMatchObject({ reason, position, need, value: 50, noise: 0, score: 50 + need, count: n });
  });
  it("with 2, the bonus is spent: bestAvailable, the lowest id, though he would fill an open starting slot", () => {
    const s = holding(2);
    const lowest = specLegalIds(s, d, "T00")[0] as string;
    expect(autoPickPreview(s, d)).toMatchObject({ reason: "bestAvailable", playerId: lowest, need: 0, score: 50 });
    const back = undrafted(s).find((p) => p.position === "RB") as PoolPlayer;
    const t = withOveralls(s, (p) => (p.id === back.id ? 60 : 50));
    expect(autoPickPreview(t, d)).toMatchObject({ reason: "bestAvailable", playerId: back.id, use: "starter", need: 0 });
  });
});

describe("B15 profiles", () => {
  const big = shippedData();
  it("same seed, same profiles; other seeds and other teams differ", () => {
    const all = (seed: number): unknown => Array.from({ length: 32 }, (_, t) => draftProfile(big.draftAi, seed, t));
    expect(all(5)).toEqual(all(5));
    expect(all(5)).not.toEqual(all(6));
    expect(draftProfiles(big.draftAi, 5, 32)).toEqual(all(5));
    expect(draftProfiles(big.draftAi, 6, 32)).toEqual(all(6));
    expect(draftProfiles(big.draftAi, 5, 32)).toEqual(all(5)); // back again: no stale cache
    expect(new Set((all(5) as { errorSd: number }[]).map((p) => p.errorSd)).size).toBe(32);
  });

  it("errorSd is uniform over the range and styles come up by weight (3,200 teams, 4 standard errors)", () => {
    const { errorSdMin: lo, errorSdMax: hi } = { errorSdMin: 1, errorSdMax: 7 };
    const config: DraftAiConfig = { ...big.draftAi, evaluation: { errorSdMin: lo, errorSdMax: hi } };
    const n = 3200;
    const ps = Array.from({ length: n }, (_, i) => draftProfile(config, 1 + Math.floor(i / 32), i % 32));
    for (const p of ps) expect(p.errorSd >= lo && p.errorSd <= hi).toBe(true);
    for (const q of [0.25, 0.5, 0.75]) {
      const share = ps.filter((p) => p.errorSd <= lo + q * (hi - lo)).length / n;
      expect(Math.abs(share - q), `quantile ${q}`).toBeLessThan(4 * Math.sqrt((q * (1 - q)) / n));
    }
    const total = Object.values(config.styles).reduce((s, x) => s + x.weight, 0);
    for (const [name, x] of Object.entries(config.styles)) {
      const q = x.weight / total;
      expect(Math.abs(ps.filter((p) => p.style === name).length / n - q), name).toBeLessThan(4 * Math.sqrt((q * (1 - q)) / n));
    }
    // Style and error are two draws: a style does not come with its own share of the range.
    for (const name of Object.keys(config.styles)) {
      const mine = ps.filter((p) => p.style === name);
      expect(Math.abs(mine.reduce((s, p) => s + p.errorSd, 0) / mine.length - 4), name).toBeLessThan((4 * 6) / Math.sqrt(12 * mine.length));
    }
  });

  it("a team's errors are normal with its errorSd, and apart from another team's, another seed's and another player's", () => {
    const ids = create(big, 4).players.map((p) => p.id);
    const errors = (seed: number, team: number, errorSd: number): number[] => ids.map((id) => evaluationError({ seed, team, style: "balanced", errorSd }, id));
    const n = ids.length;
    const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const a = errors(4, 3, 5);
    const sd = Math.sqrt(mean(a.map((x) => x * x)) - mean(a) ** 2);
    expect(Math.abs(mean(a))).toBeLessThan((4 * 5) / Math.sqrt(n));
    expect(Math.abs(sd - 5)).toBeLessThan((4 * 5) / Math.sqrt(2 * n));
    expect(Math.abs(a.filter((x) => Math.abs(x) < 5).length / n - 0.6827)).toBeLessThan(0.044);
    const corr = (x: readonly number[], y: readonly number[]): number => {
      const [mx, my] = [mean(x), mean(y)];
      return mean(x.map((v, i) => (v - mx) * ((y[i] as number) - my))) / Math.sqrt(mean(x.map((v) => (v - mx) ** 2)) * mean(y.map((v) => (v - my) ** 2)));
    };
    expect(Math.abs(corr(a, errors(4, 4, 5)))).toBeLessThan(4 / Math.sqrt(n));
    expect(Math.abs(corr(a, errors(5, 3, 5)))).toBeLessThan(4 / Math.sqrt(n));
    expect(Math.abs(corr(a.slice(1), a.slice(0, -1)))).toBeLessThan(4 / Math.sqrt(n));
    expect(errors(4, 3, 10).every((x, i) => Math.abs(x - 2 * (a[i] as number)) < 1e-9)).toBe(true);
    expect(errors(4, 3, 0).every((x) => x === 0)).toBe(true);
  });

  it("the same player's error is the same whatever was asked before it, for equal profiles in other objects, and after a JSON round trip", () => {
    const profile = draftProfile(big.draftAi, 9, 7);
    const ids = create(big, 9).players.slice(0, 60).map((p) => p.id);
    const forward = ids.map((id) => evaluationError(profile, id));
    const copy = roundTrip(profile);
    expect([...ids].reverse().map((id) => evaluationError(copy, id)).reverse()).toEqual(forward);
    expect(ids.map((id) => evaluationError(profile, id))).toEqual(forward);
  });

  it("with the error range 0 and one style every AI team scores a board alike, as the plain formula does", () => {
    const config: DraftAiConfig = { ...small.draftAi, evaluation: { errorSdMin: 0, errorSdMax: 0 }, styles: { only: { weight: 5, value: { CB: 1.1 }, need: 0.7 } }, autoPick: { style: "only", errorSd: 0 } };
    const d = withAi(small, config);
    const s = value(runDraft(create(d, 3, 4), d, { maxPicks: 2 })).state;
    const view = draftView(s, d) as DraftOpenView;
    const picks = [0, 1, 2, 3].map((t) => chooseAiPick(view, config, draftProfile(config, 3, t)));
    for (const p of picks) expect(p).toEqual(picks[0]);
    expect(picks[0]?.playerId).toBe(best(scores(s, d, onClock(s) as string, { style: "only", errorOf: () => 0 })).id);
    expect(picks[0]?.noise).toBe(0);
  });
});

describe("profiles hold through a draft, seen from the picks alone", () => {
  // Every overall is 50, every position worth 1 and no need bonus: a team's only reason to prefer a
  // player is its error, so if it once takes A with B on offer it must never take B with A on offer.
  const blind = withAi(small, { ...flatAi(small), evaluation: { errorSdMin: 8, errorSdMax: 8 } });
  interface Choice {
    readonly team: string;
    readonly took: string;
    readonly legal: ReadonlySet<string>;
  }
  function choices(seed: number, script: UserScript, userTeam: string, marks: boolean, reload: boolean): Choice[] {
    let s = withOveralls(create(blind, seed, "random", userTeam), () => 50);
    if (marks) for (const p of s.players.filter((_, i) => i % 4 === 0)) s = value(setTarget(s, p.id, true));
    const rand = prng(seed);
    const position = new Map(s.players.map((p) => [p.id, p.position]));
    const out: Choice[] = [];
    while (s.phase === "draft") {
      if (reload) s = roundTrip(s);
      const team = onClock(s) as string;
      const legal = specLegalIds(s, blind, team);
      if (team === userTeam) {
        s = value(makePick(s, blind, script({ state: s, data: blind, legal, counts: teamCounts(s, team), position, rand })));
        continue;
      }
      const r = value(runDraft(s, blind, { maxPicks: 1 }));
      out.push({ team, took: r.picks[0]?.playerId as string, legal: new Set(legal) });
      s = r.state;
    }
    return out;
  }
  /** [pairs compared, pairs that contradict each other]. */
  function clash(a: readonly Choice[], b: readonly Choice[]): [number, number] {
    let n = 0;
    let bad = 0;
    for (const x of a) {
      for (const y of b) {
        if (x.team !== y.team || x.took === y.took) continue;
        if (!x.legal.has(y.took)) continue;
        n++;
        if (y.legal.has(x.took)) bad++;
      }
    }
    return [n, bad];
  }
  const runs = [1, 2].map((seed) => ({
    base: choices(seed, SCRIPTS.random, "T00", false, false),
    others: [choices(seed, SCRIPTS.hoard, "T00", false, false), choices(seed, SCRIPTS.worst, "T00", true, false), choices(seed, SCRIPTS.random, "T03", false, false), choices(seed, SCRIPTS.kickers, "T02", true, true)],
  }));

  it("no contradiction within a draft, after other user picks, with targets, after a reload, or with another user team", () => {
    for (const { base, others } of runs) {
      for (const o of [base, ...others]) {
        const [n, bad] = clash(base, o);
        expect(n).toBeGreaterThan(50);
        expect(bad).toBe(0);
      }
    }
  });
  it("another seed's errors do contradict it (so the check can fail)", () => {
    expect(clash(runs[0]?.base as Choice[], runs[1]?.base as Choice[])[1]).toBeGreaterThan(0);
  });
});

describe("B7 the AI sees the board's overall and nothing under it", () => {
  it("new ratings and skills behind the same overalls leave every AI pick unchanged", () => {
    const data = withAi(small, LOUD);
    for (const seed of [1, 2, 3]) {
      const s = value(setAutoDraft(create(data, seed), true));
      const rand = prng(seed);
      let changed = 0;
      const players = s.players.map((p) => {
        for (let k = 0; k < 200; k++) {
          const jig = (v: number): number => Math.max(0, Math.min(99, v + Math.round((rand() - 0.5) * 12)));
          const q: PoolPlayer = {
            ...p,
            ratings: Object.fromEntries(BASE_RATINGS.map((r) => [r, jig(p.ratings[r])])) as PoolPlayer["ratings"],
            skills: Object.fromEntries(POSITION_SKILLS[p.position].map((r) => [r, jig(p.skills[r] as number)])),
          };
          if (specOverall(q, data.overallWeights) === specOverall(p, data.overallWeights)) {
            changed++;
            return q;
          }
        }
        return p;
      });
      expect(changed).toBeGreaterThan(s.players.length * 0.9);
      const picks = (x: FranchiseState): string[] => value(runDraft(x, data)).state.draft.picks.map((p) => p.playerId);
      expect(picks({ ...s, players })).toEqual(picks(s));
    }
  });
  it("the positions in the fixture are the engine's (guards the loops above)", () => expect(POSITIONS).toHaveLength(11));
});
