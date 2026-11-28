// B8 and the approved additions to draftView: use, must-fill, next pick, counts, the pick log and
// total-order sorts. Expected values come from the rosters, slots and picks in the state.

import { describe, expect, it } from "vitest";
import type { DraftOpenView, DraftUse, DraftView, FranchiseData, FranchiseState } from "../../../shared/src/franchise";
import { draftLog, draftView, leagueSummaries, makePick, runDraft, sortAvailable } from "../../src/franchise";
import { boardOrder, create, forge, onClock, othersFill, pinnedData, playDraft, POSITIONS, prng, SCRIPTS, smallData, specLegalIds, specLimits, specOverall, startersOnlyData, teamCounts, undrafted, value, withOveralls } from "./spec-support";
import type { Position } from "./spec-support";

const small = smallData();

function open(v: DraftView): DraftOpenView {
  if (v.done) throw new Error("expected an open draft");
  return v;
}

function useOf(count: number, min: number, target: number): DraftUse {
  return count < min ? "starter" : count < target ? "depth" : "extra";
}

/** Checks every draftView field against the state, by hand. */
function checkView(state: FranchiseState, data: FranchiseData): void {
  const v = open(draftView(state, data));
  const teams = state.teams.length;
  const made = state.draft.picks.length;
  const limits = specLimits(data);
  const user = state.settings.userTeam;
  const clock = onClock(state) as string;
  expect(v).toMatchObject({
    seed: state.seed,
    overallPick: made + 1,
    round: Math.floor(made / teams) + 1,
    pickInRound: (made % teams) + 1,
    rounds: data.roster.rosterSize,
    totalPicks: teams * data.roster.rosterSize,
    onClockTeam: clock,
    userOnClock: clock === user,
    userTeam: user,
    autoDraft: state.draft.autoDraft,
    availableCount: state.players.length - made,
    userPicksMade: state.rosters[user]?.length,
    userPicksTotal: data.roster.rosterSize,
  });
  expect(v.slots).toEqual(state.draft.slots);
  // picks until the user's turn (0 on the clock), then the next one after the current pick
  const upcoming = state.draft.slots.flatMap((t, i) => (t === user && i >= made ? [i] : []));
  expect(v.picksUntilUser).toBe(upcoming.length ? (upcoming[0] as number) - made : null);
  const after = upcoming.find((i) => i > made);
  if (after === undefined) expect(v.userNextPick).toBeNull();
  else {
    expect(v.userNextPick).toMatchObject({ overallPick: after + 1, round: Math.floor(after / teams) + 1, pickInRound: (after % teams) + 1, picksAway: after - made });
    // Off the clock, backToBack has its own test below, so one cause gives one failure.
    if (clock === user) expect(v.userNextPick?.backToBack).toBe(after === made + 1);
  }
  // the log
  const byId = new Map(state.players.map((p) => [p.id, p]));
  expect(v.picks).toEqual(
    state.draft.picks.map((p, i) => {
      const pl = byId.get(p.playerId) as FranchiseState["players"][number];
      return { overallPick: i + 1, round: Math.floor(i / teams) + 1, pickInRound: (i % teams) + 1, teamId: state.draft.slots[i], playerId: pl.id, name: pl.name, position: pl.position, overall: specOverall(pl, data.overallWeights), by: p.by };
    }),
  );
  // the board: undrafted only, in order, ranked at position
  const board = boardOrder(undrafted(state), data.overallWeights);
  expect(v.available.map((p) => p.id)).toEqual(board.map((p) => p.id));
  const legal = specLegalIds(state, data, clock);
  expect(v.legal).toEqual(legal);
  const legalSet = new Set(legal);
  // Use and depthRank are always the user's team's (spec "Use", ruling of 2026-11-24), also while another team picks.
  const counts = teamCounts(state, user);
  const rank = Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>;
  for (const a of v.available) {
    const l = limits[a.position];
    const got = { overall: a.overall, rank: a.positionRank, legal: a.legal, blocked: a.blockedBy !== null, use: a.use };
    expect(got, a.id).toEqual({ overall: specOverall(a, data.overallWeights), rank: ++rank[a.position], legal: legalSet.has(a.id), blocked: !legalSet.has(a.id), use: useOf(counts[a.position], l.min, l.target) });
  }
  // both boards: limits, use and must-fill
  for (const [board2, team] of [[v.user, user], [v.onClock, clock]] as const) {
    const c = teamCounts(state, team);
    const must = POSITIONS.flatMap((p) => (c[p] < limits[p].min ? [{ position: p, count: limits[p].min - c[p] }] : []));
    const required = must.reduce((s, m) => s + m.count, 0);
    const held = (state.rosters[team] as readonly string[]).length;
    expect(board2.teamId).toBe(team);
    expect(board2.mustFill).toEqual(must);
    expect(board2).toMatchObject({ picksMade: held, picksLeft: data.roster.rosterSize - held, requiredLeft: required, everyPickMustFill: required > 0 && required === data.roster.rosterSize - held });
    for (const p of POSITIONS) expect(board2.positions[p]).toMatchObject({ count: c[p], ...limits[p], use: useOf(c[p], limits[p].min, limits[p].target) });
  }
  expect(v.summaries).toEqual(leagueSummaries(state, data));
}

describe("B8 every field of draftView, after each pick", () => {
  it.each([1, 2, 3, 4])("4 teams, slot %i: before every pick of the draft", (slot) => {
    let s = create(small, 40 + slot, slot);
    const rand = prng(slot);
    let n = 0;
    while (s.phase === "draft" && n < 148) {
      if (n % 3 === 0 || n > 130) checkView(s, small);
      n++;
      if (onClock(s) === "T00") {
        const legal = specLegalIds(s, small, "T00");
        s = value(makePick(s, small, legal[Math.floor(rand() * legal.length)] as string));
      } else s = value(runDraft(s, small, { maxPicks: 1 })).state;
    }
    expect(n).toBe(148);
  });
  it("32 teams, at a few user turns", () => {
    const big = pinnedData();
    let n = 0;
    const r = playDraft(big, 8, SCRIPTS.random, { onUserTurn: (s) => void (n++ % 13 === 0 && checkView(s, big)) });
    expect(r.failure).toBeNull();
  });
});

describe("the user's next pick", () => {
  const big = pinnedData();
  const at = (slot: number, made: number): FranchiseState => forge(create(big, 2, slot), made, othersFill(big, () => "WR"));

  it("slot 32 on the clock at 32 picks again at 33, back to back", () => {
    const v = open(draftView(at(32, 31), big));
    expect(v).toMatchObject({ overallPick: 32, round: 1, pickInRound: 32, userOnClock: true, picksUntilUser: 0 });
    expect(v.userNextPick).toEqual({ overallPick: 33, round: 2, pickInRound: 1, picksAway: 1, backToBack: true });
  });
  it("slot 32 on the clock at 33 next picks at 96", () => {
    expect(open(draftView(at(32, 32), big)).userNextPick).toEqual({ overallPick: 96, round: 3, pickInRound: 32, picksAway: 63, backToBack: false });
  });
  it("slot 1 on the clock at 64 picks again at 65", () => {
    const v = open(draftView(at(1, 63), big));
    expect(v).toMatchObject({ round: 2, pickInRound: 32, userOnClock: true });
    expect(v.userNextPick).toEqual({ overallPick: 65, round: 3, pickInRound: 1, picksAway: 1, backToBack: true });
  });
  it("slot 16 off the clock at pick 17: 32 to go, next is 49", () => {
    const v = open(draftView(at(16, 16), big));
    expect(v).toMatchObject({ userOnClock: false, picksUntilUser: 32 });
    expect(v.userNextPick).toMatchObject({ overallPick: 49, round: 2, pickInRound: 17, picksAway: 32, backToBack: false });
  });
  it("another team on the clock right before the user's only pick of the turn", () => {
    const v = open(draftView(at(16, 14), big));
    expect(v.userNextPick).toMatchObject({ overallPick: 16, picksAway: 1 });
    expect(v.picksUntilUser).toBe(1);
  });
  it("is not back to back then: the user does not hold the pick before it (slot 16, pick 15 on the clock)", () => {
    const v = open(draftView(at(16, 14), big));
    expect(v.userOnClock).toBe(false);
    expect(v.userNextPick?.backToBack).toBe(false);
  });
  it("null on the user's last pick, and after it picksUntilUser is null too", () => {
    const script = othersFill(small, (c) => (["QB", "QB", ...POSITIONS.flatMap((p) => Array.from({ length: specLimits(small)[p].min }, () => p))] as Position[])[c.teamPickNo] ?? "DL");
    // Slot 1 of 4, round 37: pick 145 is the user's last, 3 AI picks follow.
    const last = forge(create(small, 3, 1), 144, script);
    expect(open(draftView(last, small))).toMatchObject({ userOnClock: true, userNextPick: null, picksUntilUser: 0, userPicksMade: 36 });
    const past = forge(last, 1, script);
    expect(open(draftView(past, small))).toMatchObject({ userOnClock: false, userNextPick: null, picksUntilUser: null, userPicksMade: 37 });
  });
});

describe("use: starter below min, depth from min up to target, extra at or past target", () => {
  // Wide receiver in the spec's numbers: min 4, target 6, max 8.
  const big = pinnedData();
  it.each([
    [0, "starter"],
    [3, "starter"],
    [4, "depth"],
    [5, "depth"],
    [6, "extra"],
    [7, "extra"],
    [8, "extra"],
  ])("with %i receivers a receiver is %s", (n, use) => {
    // Slot 32: turns at picks 32, 33, 96, 97, so after n user picks the next turn is fixed by the snake.
    const s0 = create(big, 2, 32);
    const turns = s0.draft.slots.flatMap((t, i) => (t === "T00" ? [i] : []));
    const s = forge(s0, turns[n] as number, othersFill(big, () => "WR"));
    const v = open(draftView(s, big));
    const wrs = v.available.filter((p) => p.position === "WR");
    expect(new Set(wrs.map((p) => p.use))).toEqual(new Set([use]));
    expect(new Set(v.available.filter((p) => p.position === "QB").map((p) => p.use))).toEqual(new Set(["starter"]));
    expect(wrs.every((p) => p.blockedBy === (n === 8 ? "positionMax" : null))).toBe(true);
  });
  it("where min equals target (kicker) there is no depth: starter, then extra", () => {
    const s0 = create(big, 2, 32);
    const use = (s: FranchiseState): string => draftView(s, big).available.find((p) => p.position === "K")?.use as string;
    const script = othersFill(big, () => "K");
    expect(use(forge(s0, 31, script))).toBe("starter");
    expect(use(forge(s0, 32, script))).toBe("extra");
  });
  it("a player's use is the user's while an AI team is on the clock, in both directions", () => {
    // Slot 32 of 32, pick 34 on the clock: the user holds 2 quarterbacks (min 1, target 3), so depth.
    const s = forge(create(big, 2, 32), 33, (c) => (c.isUser ? "QB" : "K"));
    const v = open(draftView(s, big));
    expect(v.userOnClock).toBe(false);
    const use = (p: Position): Set<string> => new Set(v.available.filter((x) => x.position === p).map((x) => x.use));
    // The AI team holds a kicker (extra for it) and no quarterback (starter for it).
    expect(v.onClock.positions).toMatchObject({ K: { count: 1, use: "extra" }, QB: { count: 0, use: "starter" } });
    expect(use("QB")).toEqual(new Set(["depth"]));
    expect(use("K")).toEqual(new Set(["starter"]));
  });
  it("the user's board keeps the user's use while another team is on the clock", () => {
    const s = forge(create(big, 2, 32), 33, othersFill(big, () => "QB"));
    const v = open(draftView(s, big));
    expect(v.userOnClock).toBe(false);
    expect(v.user.positions.QB).toMatchObject({ count: 2, use: "depth" });
  });
});

describe("must-fill", () => {
  it("starters-only rosters: the flag is on from the first pick to the last and every legal pick is a starter", () => {
    const data = startersOnlyData();
    let n = 0;
    const r = playDraft(data, 5, SCRIPTS.random, {
      onUserTurn: (s) => {
        const v = open(draftView(s, data));
        expect(v.user.everyPickMustFill).toBe(true);
        expect(v.user.requiredLeft).toBe(33 - n++);
        for (const p of v.available) if (p.legal) expect(p.use).toBe("starter");
      },
    });
    expect(r.failure).toBeNull();
    expect(n).toBe(33);
  });
  it("37-player rosters: off with 4 spare picks, on once the 4 spares are spent on extras", () => {
    // Required at the start: 33 of 37. Each extra (a 2nd quarterback, say) spends one spare.
    const spend: Position[] = ["QB", "QB", "RB", "RB", "K", "S"];
    const flag = (n: number): boolean => {
      const s0 = create(small, 3, 1);
      const turns = s0.draft.slots.flatMap((t, i) => (t === "T00" ? [i] : []));
      return open(draftView(forge(s0, turns[n] as number, othersFill(small, (c) => [...spend, "QB", "RB"][c.teamPickNo] as Position)), small)).user.everyPickMustFill;
    };
    // After 8 picks: QB 3 (2 extra), RB 3 (2 extra), K 1, S 1: 29 left, 29 required.
    expect([0, 2, 4, 6, 7].map(flag)).toEqual([false, false, false, false, false]);
    expect(flag(8)).toBe(true);
  });
});

describe("the finished draft view", () => {
  const s = playDraft(small, 6, SCRIPTS.random).state;
  const v = draftView(s, small);
  it("done, with nothing on the clock and the counts complete", () => {
    expect(v).toMatchObject({ done: true, overallPick: null, round: null, pickInRound: null, onClockTeam: null, userOnClock: false, onClock: null, picksUntilUser: null, userNextPick: null, userPicksMade: 37, userPicksTotal: 37, totalPicks: 148 });
    expect(v.legal).toEqual([]);
    expect(v.picks).toHaveLength(148);
    expect(v.user.mustFill).toEqual([]);
    expect(v.user.everyPickMustFill).toBe(false);
    expect(v.summaries).toEqual(leagueSummaries(s, small));
  });
  it("an open view is not done", () => expect(draftView(create(small, 1), small).done).toBe(false));
  it("draftLog since pick n is the tail of the log", () => {
    expect(draftLog(s, small)).toEqual(v.picks);
    expect(draftLog(s, small, 140)).toEqual(v.picks.slice(140));
    expect(draftLog(s, small, 148)).toEqual([]);
  });
});

describe("every sort has a total order, ties by player id", () => {
  const shuffle = <T,>(xs: readonly T[], seed: number): T[] => {
    const rand = prng(seed);
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  };
  it("the board with every player level is in id order, whatever the order in the state", () => {
    const s = withOveralls(create(small, 3), () => 50);
    const ids = s.players.map((p) => p.id).sort();
    for (let k = 1; k <= 5; k++) {
      const v = draftView({ ...s, players: shuffle(s.players, k) }, small);
      expect(v.available.map((p) => p.id)).toEqual(ids);
    }
  });
  it("sortAvailable by overall, each base rating and each skill: same answer for any input order, ties by id, input untouched", () => {
    const rows = draftView(create(small, 3), small).available;
    const keys = ["overall", ...Object.keys(rows[0]?.ratings ?? {}), ...new Set(rows.flatMap((r) => Object.keys(r.skills)))];
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) {
      const val = (r: (typeof rows)[number]): number | undefined => (key === "overall" ? r.overall : ((r.ratings as Record<string, number>)[key] ?? r.skills[key]));
      const a = sortAvailable(rows, key);
      const mixed = shuffle(rows, key.length);
      const copy = [...mixed];
      expect(sortAvailable(mixed, key), key).toEqual(a);
      expect(mixed).toEqual(copy);
      expect(a).toHaveLength(rows.length);
      for (let i = 1; i < a.length; i++) {
        const [p, q] = [a[i - 1] as (typeof rows)[number], a[i] as (typeof rows)[number]];
        const [x, y] = [val(p), val(q)];
        if (x === undefined) expect(y).toBeUndefined();
        else if (y !== undefined) {
          expect(x).toBeGreaterThanOrEqual(y);
          if (x === y && p.overall === q.overall) expect(p.id < q.id).toBe(true);
        }
      }
    }
  });
  it("positions ranks run 1, 2, 3 with no repeats even when every overall is level", () => {
    const v = draftView(withOveralls(create(small, 3), () => 60), small);
    const qbs = v.available.filter((p) => p.position === "QB");
    expect(qbs.map((p) => p.positionRank)).toEqual(qbs.map((_, i) => i + 1));
  });
});
