// M4 milestones A and B, the long runs (docs/specs/m4-franchise-core.md): A5, A10, A11 and B18 over 800
// all-AI leagues, A6a over 4 x 5,440 games, B13, B14 and B16 over the first 200 of them, B17 over 800, B3 and B4 over 1,000
// seeds, and the B10 draft budget. A5 to B18 read the report range (tolerances.ts, 2026-11-25). Runs in the heavy project (`pnpm test:heavy`), one file at a time.
// Fixed slices of B3 and B4 run in the default suite (packages/sim/test/franchise/b-draft.test.ts).
//
// Tolerances, seeds and budgets are in packages/sim/test/franchise/tolerances.ts, committed before the
// first run. A failure here is fixed in data/franchise on the tuning seeds, never by moving a tolerance.

import { performance } from "node:perf_hooks";
import { beforeAll, describe, expect, it } from "vitest";
import { POSITIONS } from "../../packages/shared/src/engine";
import type { Position } from "../../packages/shared/src/engine";
import { leagueMeans } from "../../packages/sim/src/engine/effects";
import { franchiseKit, rosterLimits, runDraft, setAutoDraft } from "../../packages/sim/src/franchise/index";
import { leagueFromSeed } from "../../packages/sim/src/loop/league";
import { prepareGame } from "../../packages/sim/src/loop/play";
import { ADVERSARIES, allAiDraft, draftProblems, draftToggling, draftWithUser, loadFranchiseData, mostOfUser, must, newFranchise, noNeedPool, randomUser, surplusZero } from "../../packages/sim/test/franchise/support";
import * as tol from "../../packages/sim/test/franchise/tolerances";
import { addDrafted, addQuickPlay, b17, b18, deploymentWeights, draftedLeague, draftedTeams, draftReadings, gameMeans, mergeTally, moments, newGameSums, newTally, overallMoments, playLeague, ratingNames } from "../../scripts/franchise/measure";
import type { Tally } from "../../scripts/franchise/measure";

const data = loadFranchiseData();
const limits = rosterLimits(data);
const means = leagueMeans(data.game.engine.distributions);
const teamOf = (seed: number): string => `T${String(seed % 32).padStart(2, "0")}`;
const LONG = 3_600_000;
const avg = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const f = (x: number, digits = 2): string => x.toFixed(digits);

describe("A5, A10, A11, B13, B14, B16, B18: drafted leagues beside quick-play leagues", () => {
  /** The first 200 seeds, for B13, B14 and B16. */
  const drafted200 = newTally();
  const quick200 = newTally();
  const drafted = newTally();
  const quick = newTally();
  const get = (t: Tally, key: string): number => t.sums[key] ?? 0;

  beforeAll(() => {
    const weights = deploymentWeights(data.game);
    for (let seed = tol.A5_REPORT_FIRST_SEED; seed < tol.A5_REPORT_FIRST_SEED + tol.A5_LEAGUES; seed++) {
      const early = seed >= tol.B13_REPORT_FIRST_SEED && seed < tol.B13_REPORT_FIRST_SEED + tol.B13_LEAGUES;
      addDrafted(early ? drafted200 : drafted, data, draftedLeague(data, seed), weights);
      addQuickPlay(early ? quick200 : quick, data, seed, weights);
    }
    mergeTally(drafted, drafted200);
    mergeTally(quick, quick200);
  }, LONG);

  const each = (visit: (p: Position, r: string) => void): number => {
    let n = 0;
    for (const p of POSITIONS) {
      for (const r of ratingNames(p)) {
        visit(p, r);
        n++;
      }
    }
    return n;
  };

  it(`A5: over ${tol.A5_LEAGUES} leagues the deployed mean of each rating is within ${tol.A5_TOLERANCE} of leagueMeans`, () => {
    const off: string[] = [];
    const worst = { deployed: 0, at: "", uniform: 0, uniformAt: "" };
    const checked = each((p, r) => {
      const center = means[p]?.[r] as number;
      const m = moments(drafted, p, r);
      const diff = m.mean - center;
      if (Math.abs(diff) > worst.deployed) Object.assign(worst, { deployed: Math.abs(diff), at: `${p}.${r}` });
      if (Math.abs(m.uniform - center) > worst.uniform) Object.assign(worst, { uniform: Math.abs(m.uniform - center), uniformAt: `${p}.${r}` });
      if (!(Math.abs(diff) <= tol.A5_TOLERANCE)) off.push(`${p}.${r} ${f(diff)}`);
    });
    console.log(`A5: worst deployed gap ${f(worst.deployed, 3)} (${worst.at}); uniform over projected starters, not gated, worst ${f(worst.uniform, 3)} (${worst.uniformAt})`);
    expect(checked).toBe(67);
    expect(off).toEqual([]);
  });

  it(`A10: the deployed SD of each rating is within ${100 * tol.A10_SD_TOLERANCE}% of quick play's`, () => {
    const off: string[] = [];
    let worst = 0;
    let at = "";
    each((p, r) => {
      const ratio = moments(drafted, p, r).sd / moments(quick, p, r).sd;
      if (Math.abs(ratio - 1) > worst) {
        worst = Math.abs(ratio - 1);
        at = `${p}.${r}`;
      }
      if (!(Math.abs(ratio - 1) <= tol.A10_SD_TOLERANCE)) off.push(`${p}.${r} ${f(ratio)}`);
    });
    console.log(`A10: worst SD gap ${f(100 * worst)}% (${at})`);
    console.log(`A10: starters' overall SD, drafted/quick play: ${POSITIONS.map((p) => `${p} ${f(overallMoments(drafted, p).sd)}/${f(overallMoments(quick, p).sd)}`).join(", ")}`);
    const { kinds } = data.game.engine.standouts;
    const shares = kinds.flatMap((k) => k.positions.flatMap((p) => k.ratings.filter((r) => ratingNames(p).includes(r)).map((r) => `${k.id} ${p}.${r} ${f(100 * moments(drafted, p, r).hi, 1)}/${f(100 * moments(quick, p, r).hi, 1)}`)));
    console.log(`A10: % of deployed players at 90 and up, drafted/quick play: ${shares.join(", ")}`);
    expect(off).toEqual([]);
  });

  it("A11: a playable bench at every position with a target above its minimum", () => {
    const bad: string[] = [];
    const lines: string[] = [];
    const none: string[] = [];
    const flagged: string[] = [];
    for (const p of POSITIONS) {
      if (limits[p].target <= limits[p].min) continue;
      const without = get(drafted, `${p}.first.missing`) / get(drafted, `${p}.count.n`);
      none.push(`${p} ${f(100 * without, 1)}%`);
      if (without > tol.A11_NO_BACKUP_SHARE_FLAG) flagged.push(p);
      const gap = overallMoments(drafted, p).mean - get(drafted, `${p}.first.x`) / get(drafted, `${p}.first.n`);
      const last = get(drafted, `${p}.target.x`) / get(drafted, `${p}.target.n`);
      const over = get(drafted, `${p}.over.x`) / get(drafted, `${p}.over.n`);
      lines.push(`${p} gap ${f(gap)} target slot ${f(last, 1)} (${f((100 * get(drafted, `${p}.target.missing`)) / get(drafted, `${p}.count.n`), 1)}% of teams stop short of it) overlap ${f(100 * over, 1)}%`);
      if (!(gap >= tol.A11_GAP_MIN && gap <= tol.A11_GAP_MAX)) bad.push(`${p} gap ${f(gap)}`);
      if (!(last >= tol.A11_TARGET_SLOT_OVERALL_MIN)) bad.push(`${p} target slot ${f(last)}`);
      if (!(over >= tol.A11_OVERLAP_SHARE_MIN)) bad.push(`${p} overlap ${f(over, 3)}`);
    }
    console.log(`A11: ${lines.join("; ")}`);
    console.log(`A11 (reported, not gated): teams with no first backup, left out of the gap and the overlap: ${none.join(", ")}${flagged.length === 0 ? "" : `. FLAG, over ${100 * tol.A11_NO_BACKUP_SHARE_FLAG}%: ${flagged.join(", ")}`}`);
    expect(lines).toHaveLength(9);
    expect(bad).toEqual([]);
  });

  it("B13: no one-position rounds", () => {
    const n = tol.B13_LEAGUES;
    const bad: string[] = [];
    let top = 0;
    let at = "";
    for (let r = 1; r <= data.roster.rosterSize; r++) {
      for (const p of POSITIONS) {
        const share = get(drafted200, `round.${r}.${p}`) / (32 * n);
        if (share > top) {
          top = share;
          at = `round ${r} ${p}`;
        }
        if (share > tol.B13_ROUND_MEAN_SHARE_MAX) bad.push(`round ${r} ${p} ${f(share)}`);
      }
    }
    const single = [...drafted200.rows].sort((a, b) => b.worstRound - a.worstRound)[0] as Tally["rows"][number];
    const early = get(drafted200, "early.depth") / get(drafted200, "early.n");
    console.log(`B13: highest mean share ${f(top, 3)} (${at}); highest single round ${f(single.worstRound, 3)} (seed ${single.seed}, ${single.worstRoundAt}); depth or extra in rounds 1 to ${tol.B13_EARLY_ROUNDS} ${f(100 * early, 1)}%`);
    for (const r of [1, 2, 3, 34]) console.log(`B13: round ${r} mean picks ${POSITIONS.map((p) => `${p} ${f(get(drafted200, `round.${r}.${p}`) / n, 1)}`).join(", ")}`);
    expect(drafted200.rows).toHaveLength(n);
    expect(bad).toEqual([]);
    expect(single.worstRound).toBeLessThanOrEqual(tol.B13_SINGLE_ROUND_SHARE_MAX);
    expect(early).toBeGreaterThanOrEqual(tol.B13_EARLY_DEPTH_SHARE_MIN);
  });

  it("B14 (reported, not gated): the spread of teams, drafted and quick play, by the same ruler", () => {
    const d = avg(drafted200.rows.map((x) => x.sd));
    const q = avg(quick200.rows.map((x) => x.sd));
    const ends = (t: Tally): string => `best ${f(avg(t.rows.map((x) => x.best)), 1)}, worst ${f(avg(t.rows.map((x) => x.worst)), 1)}`;
    console.log(`B14: SD across teams of the projected starters' mean overall, drafted ${f(d, 3)} (${ends(drafted200)}), quick play ${f(q, 3)} (${ends(quick200)}), ratio ${f(d / q, 3)}, target ${tol.B14_RATIO_MIN} to ${tol.B14_RATIO_MAX}`);
    expect(drafted200.rows).toHaveLength(tol.B14_LEAGUES);
    expect(quick200.rows).toHaveLength(tol.B14_LEAGUES);
    for (const x of [...drafted200.rows, ...quick200.rows]) expect(x.sd).toBeGreaterThan(0);
  });

  it(`B18: over ${tol.A5_LEAGUES} leagues no team ends with fewer than ${tol.B18_QB_MIN} quarterbacks, and at most ${100 * tol.B18_AT_MAX_SHARE_MAX}% end at the max`, () => {
    const q = b18(drafted.rows, 32);
    console.log(`B18: teams by number of QBs ${q.histogram}; under ${tol.B18_QB_MIN} ${q.short}; at the max of ${q.max} ${f(100 * q.atMaxShare)}%`);
    expect(drafted.rows).toHaveLength(tol.A5_LEAGUES);
    expect(q.max).toBeLessThanOrEqual(limits.QB.max);
    expect(q.short).toBeLessThanOrEqual(tol.B18_SHORT_TEAMS_MAX);
    // The share at the position's max, whether or not any team reached it.
    const atMax = drafted.rows.reduce((a, x) => a + (x.qbTeams[limits.QB.max] ?? 0), 0) / (32 * drafted.rows.length);
    expect(atMax).toBeLessThanOrEqual(tol.B18_AT_MAX_SHARE_MAX);
  });

  it("B16 (reported, not gated): the auto-drafted user team beside the AI teams", () => {
    const rows = drafted200.rows;
    console.log(`B16: mean rank ${f(avg(rows.map((x) => x.userRank)))} of 32, mean team average ${f(avg(rows.map((x) => x.userMean)))} against the AI teams' ${f(avg(rows.map((x) => x.aiMean)))}`);
    expect(rows).toHaveLength(tol.B16_LEAGUES);
    for (const x of rows) expect(x.userRank).toBeGreaterThanOrEqual(1);
  });
});

describe("B17: kickers and punters", () => {
  it(`over ${tol.B17_LEAGUES} leagues: none in rounds 1 to ${tol.B17_NONE_THROUGH_ROUND}; none under ${tol.B17_STANDOUT_OVERALL} before round ${tol.B17_FIRST_ROUND_MIN} in ${100 * tol.B17_LEAGUE_SHARE_MIN}%, for the AI teams and the auto-pick alike; a second is rare; the best kicker at ${tol.B17_STANDOUT_OVERALL} or more goes by round ${tol.B17_BEST_KICKER_ROUND_MAX} in ${100 * tol.B17_BEST_KICKER_SHARE_MIN}%`, () => {
    const t = newTally();
    // The rounds read no rating, so deployment weights from a few games are enough.
    const weights = deploymentWeights(data.game, 5);
    for (let seed = tol.B17_FIRST_SEED; seed < tol.B17_FIRST_SEED + tol.B17_LEAGUES; seed++) addDrafted(t, data, draftedLeague(data, seed), weights);
    for (const line of draftReadings(t, null, 32, data.roster.rosterSize)) console.log(line);
    const b = b17(t.rows, 32);
    expect(t.rows).toHaveLength(tol.B17_LEAGUES);
    expect(b.earlyLeagues).toBe(0);
    expect(b.aiShare).toBeGreaterThanOrEqual(tol.B17_LEAGUE_SHARE_MIN);
    expect(b.userShare).toBeGreaterThanOrEqual(tol.B17_LEAGUE_SHARE_MIN);
    expect(b.secondTeamShare).toBeLessThanOrEqual(tol.B17_SECOND_TEAM_SHARE_MAX);
    expect(b.secondLeagueShare).toBeLessThanOrEqual(tol.B17_SECOND_LEAGUE_SHARE_MAX);
    expect(b.standoutLeagues).toBeGreaterThan(0);
    expect(b.bestShare).toBeGreaterThanOrEqual(tol.B17_BEST_KICKER_SHARE_MIN);
  }, LONG);
});

describe("A6a, A10: games", () => {
  it.each([false, true])(`standouts %s: ${tol.A6A_LEAGUES} drafted leagues of ${tol.A6A_GAMES_PER_LEAGUE} games score and turn the ball over as generated leagues do`, (standouts) => {
    const franchise = newGameSums();
    const quick = newGameSums();
    const kit = franchiseKit(data, { standouts });
    const quickKit = prepareGame(data.game, { standouts });
    for (let seed = tol.A6A_REPORT_FIRST_SEED; seed < tol.A6A_REPORT_FIRST_SEED + tol.A6A_LEAGUES; seed++) {
      playLeague(franchise, kit, draftedTeams(draftedLeague(data, seed), data), seed, tol.A6A_GAMES_PER_LEAGUE, standouts);
      playLeague(quick, quickKit, leagueFromSeed(data.game, seed).teams, seed, tol.A6A_GAMES_PER_LEAGUE, standouts);
    }
    const a = gameMeans(franchise);
    const b = gameMeans(quick);
    console.log(`A6a, standouts ${standouts}: points per team-game ${f(a.points)} and ${f(b.points)}, turnovers ${f(a.turnovers, 3)} and ${f(b.turnovers, 3)}, margin SD ${f(a.marginSd)} and ${f(b.marginSd)} (drafted, generated; ${franchise.games} and ${quick.games} games)`);
    expect([franchise.games, quick.games]).toEqual([tol.A6_BASELINE_GAMES, tol.A6_BASELINE_GAMES]);
    expect(Math.abs(a.points - b.points)).toBeLessThanOrEqual(tol.A6_POINTS_TOLERANCE);
    expect(Math.abs(a.turnovers - b.turnovers)).toBeLessThanOrEqual(tol.A6_TURNOVERS_TOLERANCE);
    if (standouts) {
      console.log(`A10: mean applied standout factors ${JSON.stringify(a.factors)} (generated leagues ${JSON.stringify(b.factors)})`);
      expect(Object.keys(a.factors).sort()).toEqual(data.game.engine.standouts.kinds.map((k) => k.id).sort());
      for (const [k, x] of Object.entries(a.factors)) expect(Math.abs(x - 1), k).toBeLessThanOrEqual(tol.A10_FACTOR_TOLERANCE);
    } else expect(a.factors).toEqual({});
  }, LONG);
});

describe("A6: league totals", () => {
  // Not built: A6 plays 20 all-AI franchise regular seasons against 5,440 generateLeague games, so
  // it needs the schedule (milestone C) and the season sim (milestone E). Its tolerances are
  // already committed (tolerances.ts) so they are fixed before the first run. Do not fake it here.
  it.todo(`${tol.A6_FRANCHISE_SEASONS} all-AI franchise seasons against ${tol.A6_BASELINE_GAMES} generated-league games: points per team-game within ${tol.A6_POINTS_TOLERANCE}, turnovers within ${tol.A6_TURNOVERS_TOLERANCE} (needs milestones C and E)`);
});

describe("B3: 1,000 all-AI drafts", () => {
  it("every seed ends with 32 rosters of 53 inside min and max, no player on two teams, no team without a legal pick", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      // allAiDraft throws on the typed noLegalPick error, naming the team and the pick.
      const problems = draftProblems(allAiDraft(data, seed), data);
      if (problems.length > 0) throw new Error(`seed ${seed}: ${problems.slice(0, 5).join("; ")}`);
    }
  }, LONG);
});

describe("B4: a scripted user never reaches a dead end", () => {
  it("1,000 drafts with a user picking uniformly at random among legal picks", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const state = draftWithUser(data, seed, randomUser(seed), teamOf(seed), 1 + ((seed * 7) % 32));
      const problems = draftProblems(state, data);
      if (problems.length > 0) throw new Error(`seed ${seed}: ${problems.slice(0, 5).join("; ")}`);
      if (state.draft.picks.filter((p) => p.by === "user").length !== data.roster.rosterSize) throw new Error(`seed ${seed}: the user did not make every pick`);
    }
  }, LONG);

  it("100 drafts with a user always taking the position it already has most of", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const problems = draftProblems(draftWithUser(data, seed, mostOfUser, teamOf(seed), 1 + ((seed * 7) % 32)), data);
      if (problems.length > 0) throw new Error(`seed ${seed}: ${problems.slice(0, 5).join("; ")}`);
    }
  }, LONG);

  it.each(Object.entries(ADVERSARIES))("40 drafts each from slots 1 and 32 with a user who takes: %s", (_name, make) => {
    for (let seed = 2001; seed <= 2040; seed++) {
      for (const slot of [1, 32]) {
        const problems = draftProblems(draftWithUser(data, seed, make(data, seed), teamOf(seed), slot), data);
        if (problems.length > 0) throw new Error(`seed ${seed} slot ${slot}: ${problems.slice(0, 5).join("; ")}`);
      }
    }
  }, LONG);

  it("40 drafts each from slots 1 and 32 with auto-draft toggled mid-round and a JSON round trip each time", () => {
    for (let seed = 2041; seed <= 2080; seed++) {
      for (const slot of [1, 32]) {
        const problems = draftProblems(draftToggling(data, seed, teamOf(seed), slot), data);
        if (problems.length > 0) throw new Error(`seed ${seed} slot ${slot}: ${problems.slice(0, 5).join("; ")}`);
      }
    }
  }, LONG);
});

describe("B3, B4 and rule 4: no dead end with no surplus", () => {
  const SEEDS = { from: 2101, to: 2140 };
  describe.each([["shipped need", surplusZero(data)], ["no need", noNeedPool(data)]] as const)("surplus 0, %s", (_set, d) => {
    const each40 = (draft: (seed: number, slot: number) => ReturnType<typeof allAiDraft>): void => {
      for (let seed = SEEDS.from; seed <= SEEDS.to; seed++) {
        for (const slot of [1, 32]) {
          const problems = draftProblems(draft(seed, slot), d);
          if (problems.length > 0) throw new Error(`seed ${seed} slot ${slot}: ${problems.slice(0, 5).join("; ")}`);
        }
      }
    };

    it("40 all-AI drafts", () => {
      for (let seed = SEEDS.from; seed <= SEEDS.to; seed++) expect(draftProblems(allAiDraft(d, seed), d)).toEqual([]);
    }, LONG);

    it.each([...Object.entries(ADVERSARIES), ["most of", () => mostOfUser], ["random", (_d: typeof data, seed: number) => randomUser(seed)]] as [string, (typeof ADVERSARIES)[string]][])("40 drafts each from slots 1 and 32: %s", (_name, make) => {
      each40((seed, slot) => draftWithUser(d, seed, make(d, seed), teamOf(seed), slot));
    }, LONG);

    it("40 drafts each from slots 1 and 32 with auto-draft toggled", () => {
      each40((seed, slot) => draftToggling(d, seed, teamOf(seed), slot));
    }, LONG);
  });
});

describe("B10: draft speed", () => {
  // The fastest of 20 runs, so another process on the machine can't fail it, and Joseph's machine only: CI's is not the one the budget is for.
  it.skipIf(process.env["CI"] !== undefined)(`a full all-AI draft takes at most ${tol.B10_BUDGET_MS} ms`, () => {
    const times: number[] = [];
    for (let seed = 1; seed <= 23; seed++) {
      const start = must(setAutoDraft(newFranchise(data, seed), true));
      const t0 = performance.now();
      const run = must(runDraft(start, data));
      const ms = performance.now() - t0;
      expect(run.picks).toHaveLength(data.roster.rosterSize * 32);
      // The first three runs warm the JIT and are not timed.
      if (seed > 3) times.push(ms);
    }
    const fastest = Math.min(...times);
    console.log(`B10: all-AI draft, fastest of ${times.length} runs after 3 warm-ups ${fastest.toFixed(1)} ms (budget ${tol.B10_BUDGET_MS} ms)`);
    expect(times).toHaveLength(20);
    expect(fastest).toBeLessThanOrEqual(tol.B10_BUDGET_MS);
  });
});
