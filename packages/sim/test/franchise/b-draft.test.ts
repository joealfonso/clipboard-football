// M4 milestone B (docs/specs/m4-franchise-core.md), criteria B1 to B9, on the real data. The
// 1,000-seed runs of B3 and B4, A5 and the B10 timing are in test/franchise/franchise.heavy.test.ts
// (`pnpm test:heavy`); fixed slices of B3 and B4 run here.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POSITIONS } from "../../../shared/src/engine";
import type { Position } from "../../../shared/src/engine";
import type { DraftAiConfig, DraftAiInput, DraftOpenView, DraftView, FranchiseData, FranchiseState } from "../../../shared/src/franchise";
import {
  assignRosterNumbers,
  autoPick,
  autoPickPreview,
  autoPickProfile,
  checkDraft,
  chooseAiPick,
  draftLog,
  draftProfile,
  draftProfiles,
  draftSlots,
  draftView,
  evaluationError,
  leagueSummaries,
  legalNumbers,
  legalPicks,
  makePick,
  needBonus,
  overall,
  picksForSlot,
  playerIndex,
  rosterLimits,
  roundOneOrder,
  runDraft,
  setAutoDraft,
  setTarget,
  sortAvailable,
  streamSeed,
} from "../../src/franchise/index";
import { draftAiSchema, parseFranchiseData } from "../../../shared/src/franchise-schema";
import { curveValue } from "../../src/franchise/draft-ai";
import { Rng } from "../../src/rng";
import { ADVERSARIES, allAiDraft, draftProblems, draftToggling, draftWithUser, franchiseFiles, loadFranchiseData, mostOfUser, must, newFranchise, randomUser } from "./support";
import * as tol from "./tolerances";

const data = loadFranchiseData();
const TEAMS = 32;
const ROUNDS = data.roster.rosterSize;
/** No need bonus at any slot. */
const NO_NEED = Object.fromEntries(POSITIONS.map((p): [Position, readonly number[]] => [p, data.draftAi.slotNeed[p].map(() => 0)])) as Record<Position, readonly number[]>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function openView(state: FranchiseState, d: FranchiseData = data): DraftOpenView {
  const v = draftView(state, d);
  if (v.done) throw new Error("the draft is over");
  return v;
}

/** The AI profile of the team on the clock. */
function onClockProfile(state: FranchiseState, d: FranchiseData = data): ReturnType<typeof draftProfile> {
  const team = state.teams.findIndex((t) => t.id === state.draft.slots[state.draft.picks.length]);
  return draftProfile(d.draftAi, state.seed, team);
}

/** Runs the AI up to the user's turn. */
function toUser(state: FranchiseState, d: FranchiseData = data): FranchiseState {
  return must(runDraft(state, d)).state;
}

describe("B1: the order", () => {
  it("round 1 is a seeded shuffle: the same for a seed, different across seeds, every team once", () => {
    const ids = newFranchise(data, 1).teams.map((t) => t.id);
    expect(roundOneOrder(ids, "T00", null, 5)).toEqual(roundOneOrder(ids, "T00", null, 5));
    expect(roundOneOrder(ids, "T00", null, 5)).not.toEqual(roundOneOrder(ids, "T00", null, 6));
    expect(roundOneOrder(ids, "T00", null, 5)).not.toEqual(ids);
    expect([...roundOneOrder(ids, "T00", null, 5)].sort()).toEqual(ids);
    // The seeded slot does not depend on which team is the user's.
    expect(roundOneOrder(ids, "T09", null, 5)).toEqual(roundOneOrder(ids, "T00", null, 5));
    // Over many seeds the user lands in every slot.
    const seen = new Set<number>();
    for (let seed = 0; seed < 400; seed++) seen.add(roundOneOrder(ids, "T00", null, seed).indexOf("T00"));
    expect(seen.size).toBe(TEAMS);
  });

  it("with a chosen slot the user is at that slot, and the other 31 keep their seeded order", () => {
    for (const seed of [1, 2, 3]) {
      const random = newFranchise(data, seed, "T07").draft.slots.slice(0, TEAMS);
      for (let slot = 1; slot <= TEAMS; slot++) {
        const s = newFranchise(data, seed, "T07", slot);
        const round1 = s.draft.slots.slice(0, TEAMS);
        expect(round1[slot - 1]).toBe("T07");
        expect(round1.filter((t) => t !== "T07")).toEqual(random.filter((t) => t !== "T07"));
        expect(s.settings.draftSlot).toBe(slot);
      }
    }
  });

  it("odd rounds ascend and even rounds descend; 1,696 slots, each team owns 53", () => {
    for (const [seed, slot] of [[1, "random"], [2, 1], [3, 32], [4, 17]] as const) {
      const { slots } = newFranchise(data, seed, "T00", slot).draft;
      expect(slots).toHaveLength(1696);
      expect(slots).toHaveLength(ROUNDS * TEAMS);
      const round1 = slots.slice(0, TEAMS);
      for (let r = 0; r < ROUNDS; r++) {
        const round = slots.slice(r * TEAMS, (r + 1) * TEAMS);
        expect(round, `round ${r + 1}`).toEqual(r % 2 === 0 ? round1 : [...round1].reverse());
      }
      for (const t of round1) expect(slots.filter((x) => x === t)).toHaveLength(53);
    }
  });

  it("picksForSlot gives the picks a slot holds, from the same snake rule", () => {
    expect(picksForSlot(7, TEAMS, ROUNDS).slice(0, 3)).toEqual([7, 58, 71]);
    expect(picksForSlot(32, TEAMS, ROUNDS).slice(0, 4)).toEqual([32, 33, 96, 97]);
    expect(picksForSlot(1, TEAMS, ROUNDS).slice(0, 4)).toEqual([1, 64, 65, 128]);
    const ids = newFranchise(data, 1).teams.map((t) => t.id);
    for (const slot of [1, 7, 16, 32]) {
      const slots = draftSlots(ids, "T03", slot, ROUNDS, 9);
      const mine = slots.flatMap((t, i) => (t === "T03" ? [i + 1] : []));
      expect(picksForSlot(slot, TEAMS, ROUNDS)).toEqual(mine);
    }
  });
});

describe("B2: legal picks", () => {
  it("rule 1, position max: a fifth quarterback is blocked, the rule is named, the state is unchanged", () => {
    let s = toUser(newFranchise(data, 11, "T00", 1));
    for (let i = 0; i < 4; i++) {
      const qb = openView(s).available.find((p) => p.position === "QB" && p.legal);
      s = toUser(must(makePick(s, data, (qb as { id: string }).id)));
    }
    const v = openView(s);
    expect(v.userOnClock).toBe(true);
    expect(v.onClock.positions.QB).toMatchObject({ count: 4, max: 4, legal: false, blockedBy: "positionMax" });
    const qb = v.available.find((p) => p.position === "QB") as DraftView["available"][number];
    expect(qb).toMatchObject({ legal: false, blockedBy: "positionMax" });
    const before = clone(s);
    expect(makePick(s, data, qb.id)).toEqual({ ok: false, error: { code: "illegalPick", playerId: qb.id, position: "QB", rule: "positionMax" } });
    expect(s).toEqual(before);
    const legal = must(legalPicks(s, data));
    expect(legal.legal).not.toContain(qb.id);
    expect(legal.blocked).toContainEqual({ playerId: qb.id, position: "QB", rule: "positionMax" });
    expect(v.legal).toEqual(legal.legal);
  });

  it("rule 2, minimums reachable: once picks left equal open starting slots, a pick that fills none is blocked", () => {
    // The user stacks the position it has most of until every pick left must fill a starting slot.
    let s = toUser(newFranchise(data, 12, "T00", 5));
    const index = playerIndex(s.players);
    for (;;) {
      const v = openView(s);
      if (v.user.everyPickMustFill) break;
      const legal = must(legalPicks(s, data));
      const counts = Object.fromEntries(POSITIONS.map((p) => [p, legal.positions[p].count])) as Record<Position, number>;
      s = toUser(must(makePick(s, data, mostOfUser(legal.legal, (id) => (index.get(id) as { position: Position }).position, counts))));
    }
    const v = openView(s);
    expect(v.userOnClock).toBe(true);
    expect(v.user.picksLeft).toBe(v.user.requiredLeft);
    expect(v.user.requiredLeft).toBe(v.user.mustFill.reduce((n, m) => n + m.count, 0));
    expect(v.user.mustFill.length).toBeGreaterThan(0);
    for (const m of v.user.mustFill) expect(m.count).toBe(v.user.positions[m.position].min - v.user.positions[m.position].count);
    // A position at or over its minimum and under its max: only rule 2 stands in the way.
    const filled = POSITIONS.find((p) => v.onClock.positions[p].count >= v.onClock.positions[p].min && v.onClock.positions[p].count < v.onClock.positions[p].max) as Position;
    expect(v.onClock.positions[filled]).toMatchObject({ legal: false, blockedBy: "minimumsReachable" });
    const blocked = v.available.find((p) => p.position === filled) as DraftView["available"][number];
    const before = clone(s);
    expect(makePick(s, data, blocked.id)).toEqual({ ok: false, error: { code: "illegalPick", playerId: blocked.id, position: filled, rule: "minimumsReachable" } });
    expect(s).toEqual(before);
    // Every legal pick fills a starting slot, and taking one keeps the draft alive to the end.
    for (const id of v.legal) expect(v.user.mustFill.map((m) => m.position)).toContain((index.get(id) as { position: Position }).position);
    expect(must(legalPicks(s, data)).blocked).toContainEqual({ playerId: blocked.id, position: filled, rule: "minimumsReachable" });
  });

  it("rule 3, pool covers minimums: with no surplus, a second kicker would leave another team without one", () => {
    const tight: FranchiseData = { ...data, pool: { ...data.pool, surplus: 0 } };
    let s = toUser(newFranchise(tight, 13, "T00", 1), tight);
    const k1 = openView(s, tight).available.find((p) => p.position === "K") as DraftView["available"][number];
    expect(k1.legal).toBe(true);
    s = toUser(must(makePick(s, tight, k1.id)), tight);
    const v = openView(s, tight);
    const rule = v.onClock.positions.K;
    // The user holds one kicker of a max of two and has picks to spare, so rules 1 and 2 pass.
    expect(rule).toMatchObject({ count: 1, max: 2, legal: false, blockedBy: "poolCoversMinimums" });
    const openKickerSlots = leagueSummaries(s, tight).reduce((n, t) => n + t.positions.K.neededToStart, 0);
    expect(rule.available).toBe(openKickerSlots);
    const k2 = v.available.find((p) => p.position === "K") as DraftView["available"][number];
    const before = clone(s);
    expect(makePick(s, tight, k2.id)).toEqual({ ok: false, error: { code: "illegalPick", playerId: k2.id, position: "K", rule: "poolCoversMinimums" } });
    expect(s).toEqual(before);
    expect(must(legalPicks(s, tight)).blocked).toContainEqual({ playerId: k2.id, position: "K", rule: "poolCoversMinimums" });
    // The same draft still finishes with every roster legal.
    expect(draftProblems(allAiDraft(tight, 13), tight)).toEqual([]);
  });

  it("a pick out of turn, a drafted player and an unknown id are typed errors and change nothing", () => {
    const start = newFranchise(data, 14, "T00", 2);
    const before = clone(start);
    const top = openView(start).available[0] as DraftView["available"][number];
    expect(makePick(start, data, top.id)).toEqual({ ok: false, error: { code: "notOnClock", onClock: start.draft.slots[0], userTeam: "T00" } });
    expect(autoPick(start, data)).toEqual({ ok: false, error: { code: "notOnClock", onClock: start.draft.slots[0], userTeam: "T00" } });
    expect(start).toEqual(before);

    const s = toUser(start);
    const taken = (s.draft.picks[0] as { playerId: string }).playerId;
    const mid = clone(s);
    expect(makePick(s, data, taken)).toEqual({ ok: false, error: { code: "alreadyDrafted", playerId: taken } });
    expect(makePick(s, data, "P9999")).toEqual({ ok: false, error: { code: "unknownPlayer", playerId: "P9999" } });
    expect(makePick(s, data, "")).toEqual({ ok: false, error: { code: "unknownPlayer", playerId: "" } });
    expect(s).toEqual(mid);
  });

  it("picks left are the slots the team still owns: a draft saved at pick 1,200 loads and finishes under a changed roster.json", () => {
    const start = must(setAutoDraft(newFranchise(data, 16, "T00", 7), true));
    const saved = clone(must(runDraft(start, data, { maxPicks: 1200 })).state);
    // 52 and 60 man rosters in the new file; the saved draft keeps its 53 rounds.
    const files = franchiseFiles();
    const roster = files.roster as { positions: Record<string, { target: number; max: number }> };
    const ai = files.draftAi as DraftAiConfig;
    const under = (rosterSize: number, rb: number): FranchiseData =>
      parseFranchiseData({ ...files, roster: { ...roster, rosterSize, positions: { ...roster.positions, RB: { target: rb, max: 12 } } }, draftAi: { ...ai, slotNeed: { ...ai.slotNeed, RB: Array.from({ length: rb }, () => 1) } } }, data.game);
    for (const changed of [under(52, 3), under(60, 11)]) {
      expect(must(checkDraft(saved, changed))).toBe(true);
      const v = openView(saved, changed);
      expect(v.user.picksMade + v.user.picksLeft).toBe(53);
      const done = must(runDraft(clone(saved), changed)).state;
      expect(done.phase).toBe("regularSeason");
      expect(draftProblems(done, { ...changed, roster: { ...changed.roster, rosterSize: 53 } })).toEqual([]);
      // By hand too: the user can pick to the end.
      let s = must(setAutoDraft(clone(saved), false));
      while (s.phase === "draft") {
        s = must(runDraft(s, changed)).state;
        if (s.phase === "draft") s = must(makePick(s, changed, must(legalPicks(s, changed)).legal.at(-1) as string));
      }
      expect(draftProblems(s, { ...changed, roster: { ...changed.roster, rosterSize: 53 } })).toEqual([]);
    }
  }, 60_000);

  it("a saved draft that can't end legally under the new limits is a typed error on load and on every pick action, with the state unchanged", () => {
    const saved = must(runDraft(must(setAutoDraft(newFranchise(data, 17, "T00", 1), true)), data, { maxPicks: 1216 })).state;
    const counts = leagueSummaries(saved, data).map((t) => t.positions.OL.count);
    const over = Math.max(...counts);
    const tight = { ...data, roster: { ...data.roster, positions: { ...data.roster.positions, OL: { target: over - 1, max: over - 1 } } } };
    const before = clone(saved);
    const error = { code: "draftCannotFinish", rule: "positionMax", teamId: saved.teams[counts.findIndex((n) => n > over - 1)]?.id, position: "OL" };
    expect(checkDraft(saved, tight)).toEqual({ ok: false, error });
    expect(runDraft(saved, tight)).toEqual({ ok: false, error });
    const user = { ...saved, draft: { ...saved.draft, autoDraft: false, slots: saved.draft.slots.map((t, i) => (i === saved.draft.picks.length ? "T00" : t)) } };
    expect(autoPick(user, tight).ok).toBe(false);
    expect(makePick(user, tight, openView(user).legal[0] as string).ok).toBe(false);
    expect(saved).toEqual(before);
    expect(checkDraft(allAiDraft(data, 17), tight)).toEqual({ ok: true, value: true });
  }, 60_000);

  it("after the draft every draft action is a typed error", () => {
    const done = allAiDraft(data, 15);
    expect(done.phase).toBe("regularSeason");
    const err = { ok: false, error: { code: "notDraftPhase", phase: "regularSeason" } };
    expect(makePick(done, data, "P0001")).toEqual(err);
    expect(autoPick(done, data)).toEqual(err);
    expect(runDraft(done, data)).toEqual(err);
    expect(setAutoDraft(done, true)).toEqual(err);
    expect(legalPicks(done, data)).toEqual(err);
    expect(runDraft(newFranchise(data, 15), data, { maxPicks: -1 })).toEqual({ ok: false, error: { code: "badLimit", maxPicks: -1 } });
    expect(runDraft(newFranchise(data, 15), data, { through: "later" as "end" })).toEqual({ ok: false, error: { code: "badThrough", through: "later" } });
    expect(legalPicks(newFranchise(data, 15), data, "T99")).toEqual({ ok: false, error: { code: "unknownTeam", teamId: "T99" } });
  });
});

describe("B3 (slice): an all-AI draft", () => {
  it.each([1, 2, 3])("seed %d ends with 32 rosters of 53 inside min and max, no player on two teams", (seed) => {
    const s = allAiDraft(data, seed);
    expect(draftProblems(s, data)).toEqual([]);
    expect(s.draft.picks.every((p) => p.by === "ai" || p.by === "auto")).toBe(true);
    expect(s.players).toHaveLength(1871);
    expect(new Set(Object.values(s.rosters).flat()).size).toBe(1696);
  }, 30_000);

  it("no AI pick builds a draft view: the policy's input is the board and one team's counts", () => {
    // The view of a fresh draft is about half a megabyte; the run touches it nowhere.
    const source = readFileSync(join(import.meta.dirname, "../../src/franchise/draft.ts"), "utf8");
    expect(source.match(/draftView\(/g)).toHaveLength(1);
    expect(source.match(/leagueSummaries\(/g)).toHaveLength(1);
  });

  it("roster size is data: a 33-man roster (starters only) drafts 33 rounds with no code change", () => {
    const limits = rosterLimits(data);
    const positions = Object.fromEntries(POSITIONS.map((p) => [p, { target: limits[p].min, max: limits[p].max }])) as FranchiseData["roster"]["positions"];
    const small: FranchiseData = { ...data, roster: { ...data.roster, rosterSize: 33, positions } };
    const s = allAiDraft(small, 4);
    expect(s.draft.slots).toHaveLength(33 * TEAMS);
    expect(draftProblems(s, small)).toEqual([]);
    for (const t of leagueSummaries(s, small)) for (const p of POSITIONS) expect(t.positions[p].count).toBe(limits[p].min);
  }, 30_000);
});

describe("B4 (slice): a scripted user never reaches a dead end", () => {
  it.each([1, 2])("seed %d: uniformly random legal picks", (seed) => {
    expect(draftProblems(draftWithUser(data, seed, randomUser(seed)), data)).toEqual([]);
  }, 30_000);

  it("always the position it already has most of", () => {
    const s = draftWithUser(data, 3, mostOfUser);
    expect(draftProblems(s, data)).toEqual([]);
    expect(s.draft.picks.filter((p) => p.by === "user")).toHaveLength(53);
  }, 30_000);
});

describe("B4 (slice): adversaries, slots 1 and 32", () => {
  it.each(Object.entries(ADVERSARIES))("%s", (_name, make) => {
    for (const [seed, slot] of [[101, 1], [102, 32]] as const) expect(draftProblems(draftWithUser(data, seed, make(data, seed), "T00", slot), data)).toEqual([]);
  }, 60_000);

  it("auto-draft toggled mid-round, with a JSON round trip each time", () => {
    for (const [seed, slot] of [[103, 1], [104, 32], [105, 17]] as const) expect(draftProblems(draftToggling(data, seed, "T00", slot), data)).toEqual([]);
  }, 60_000);
});

describe("B5: determinism", () => {
  it("same seed and same user picks give deep-equal states", () => {
    const a = draftWithUser(data, 21, randomUser(5), "T04", 9);
    const b = draftWithUser(data, 21, randomUser(5), "T04", 9);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  }, 30_000);

  it("a different user pick changes later picks", () => {
    const start = toUser(newFranchise(data, 22, "T00", 3));
    const [first, second] = openView(start).legal as [string, string];
    const a = toUser(must(makePick(start, data, first)));
    const b = toUser(must(makePick(start, data, second)));
    const later = (s: FranchiseState): string[] => s.draft.picks.slice(3).map((p) => p.playerId);
    expect(later(a).length).toBeGreaterThan(10);
    expect(later(a)).not.toEqual(later(b));
  });

  it("a state saved to JSON mid-draft and resumed ends identically, with a user and all-AI", () => {
    const whole = allAiDraft(data, 23);
    const start = newFranchise(data, 23);
    let s: FranchiseState = { ...start, draft: { ...start.draft, autoDraft: true } };
    for (const chunk of [1, 31, 500, 700]) s = clone(must(runDraft(s, data, { maxPicks: chunk })).state);
    expect(s.draft.picks).toHaveLength(1232);
    expect(must(runDraft(s, data)).state).toEqual(whole);

    const script = (): ReturnType<typeof randomUser> => randomUser(77);
    const straight = draftWithUser(data, 24, script(), "T10", 20);
    // The same draft, saved and reloaded before every user pick.
    const pick = script();
    let r = newFranchise(data, 24, "T10", 20);
    const index = playerIndex(r.players);
    for (;;) {
      r = clone(must(runDraft(clone(r), data)).state);
      if (r.phase !== "draft") break;
      const legal = must(legalPicks(r, data));
      const counts = Object.fromEntries(POSITIONS.map((p) => [p, legal.positions[p].count])) as Record<Position, number>;
      r = must(makePick(r, data, pick(legal.legal, (id) => (index.get(id) as { position: Position }).position, counts)));
    }
    expect(r).toEqual(straight);
  }, 60_000);

  it("the franchise seed is in the state and drives every stream", () => {
    expect(allAiDraft(data, 25).seed).toBe(25);
    expect(streamSeed(25, 4, 7)).toBe(streamSeed(25, 4, 7));
    const seen = new Set<number>();
    for (let seed = 0; seed < 50; seed++) for (let stream = 1; stream <= 7; stream++) for (let a = 0; a < 40; a++) seen.add(streamSeed(seed, stream, a));
    expect(seen.size).toBe(50 * 7 * 40);
    for (const x of seen) expect(Number.isSafeInteger(x) && x >= 0).toBe(true);
  });
});

describe("B6: auto-pick and auto-draft", () => {
  it("auto-pick equals what the AI policy would pick for that team, at every user turn of a draft", () => {
    let s = toUser(newFranchise(data, 31, "T00", 12));
    let turns = 0;
    while (s.phase === "draft") {
      const v = openView(s);
      expect(v.userOnClock).toBe(true);
      const policy = chooseAiPick(v, data.draftAi, autoPickProfile(data.draftAi, s.seed, 0));
      const made = must(autoPick(s, data));
      expect(made.pick.playerId).toBe(policy?.playerId);
      expect(made.pick).toMatchObject({ overallPick: v.overallPick, round: v.round, teamId: "T00", by: "auto" });
      // The same pick the run makes with auto-draft on.
      const run = must(runDraft(must(setAutoDraft(s, true)), data, { maxPicks: 1 }));
      expect(run.picks[0]).toEqual(made.pick);
      s = toUser(made.state);
      turns++;
    }
    expect(turns).toBe(53);
    expect(draftProblems(s, data)).toEqual([]);
  }, 60_000);

  it("auto-draft on makes runDraft run to the end with no user turn", () => {
    const on = must(setAutoDraft(newFranchise(data, 32, "T00", 1), true));
    const run = must(runDraft(on, data));
    expect(run.picks).toHaveLength(1696);
    expect(run.picks.map((p) => p.overallPick)).toEqual(Array.from({ length: 1696 }, (_, i) => i + 1));
    expect(run.state.phase).toBe("regularSeason");
    expect(run.picks.filter((p) => p.teamId === "T00").every((p) => p.by === "auto")).toBe(true);
    expect(run.picks.filter((p) => p.teamId !== "T00").every((p) => p.by === "ai")).toBe(true);
  }, 30_000);

  it("through: nextUserPick makes his pick if he is on the clock and stops at his next turn; end runs out; both draft the same players", () => {
    const start = must(setAutoDraft(newFranchise(data, 34, "T00", 32), true));
    const whole = must(runDraft(start, data, { through: "end" }));
    let s = start;
    const picks: unknown[] = [];
    const runs: number[] = [];
    while (s.phase === "draft") {
      const was = openView(s).userOnClock;
      const r = must(runDraft(clone(s), data, { through: "nextUserPick" }));
      expect(r.picks.length).toBeGreaterThan(0);
      expect(r.picks.filter((p) => p.teamId === "T00").length).toBe(was ? 1 : 0);
      if (r.state.phase === "draft") expect(openView(r.state).userOnClock).toBe(true);
      picks.push(...r.picks);
      runs.push(r.picks.length);
      s = r.state;
    }
    // Slot 32: 31 AI picks, then his pick at 32 alone (he is on the clock again at 33), then 33 and 62 AI picks.
    expect(runs.slice(0, 4)).toEqual([31, 1, 63, 1]);
    expect(picks).toEqual(whole.picks);
    expect(s).toEqual(whole.state);
    // With auto-draft off the user's turn always stops the run, whatever `through` says.
    const off = must(runDraft(newFranchise(data, 34, "T00", 1), data, { through: "nextUserPick" }));
    expect(off.picks).toEqual([]);
    expect(must(runDraft(newFranchise(data, 34, "T00", 3), data, { through: "end" })).picks).toHaveLength(2);
    // maxPicks still bounds a run.
    expect(must(runDraft(start, data, { through: "nextUserPick", maxPicks: 5 })).picks).toHaveLength(5);
  }, 60_000);

  it("switching it off stops at the user's next turn; it can be switched while other teams pick", () => {
    const start = newFranchise(data, 33, "T00", 20);
    // Off: the run stops with the user on the clock.
    const first = must(runDraft(start, data));
    expect(first.picks).toHaveLength(19);
    expect(openView(first.state).userOnClock).toBe(true);
    expect(must(runDraft(first.state, data)).picks).toEqual([]);
    // On mid-round, while another team is on the clock: the user's turn is taken for him.
    const mid = must(runDraft(start, data, { maxPicks: 5 })).state;
    expect(openView(mid).userOnClock).toBe(false);
    const slice = must(runDraft(must(setAutoDraft(mid, true)), data, { maxPicks: 100 }));
    expect(slice.picks).toHaveLength(100);
    expect(slice.picks.filter((p) => p.teamId === "T00").length).toBeGreaterThan(0);
    // Off again: the run stops at the user's next turn, with the draft still open.
    const stopped = must(runDraft(must(setAutoDraft(slice.state, false)), data));
    const v = openView(stopped.state);
    expect(v.userOnClock).toBe(true);
    expect(v.autoDraft).toBe(false);
    expect(stopped.picks.every((p) => p.teamId !== "T00")).toBe(true);
  });
});

describe("B7: the AI reads only what the board shows, and its own profile", () => {
  it("type level: the open draft view is the policy's input", () => {
    const start = newFranchise(data, 41);
    const input: DraftAiInput = openView(start);
    expect(chooseAiPick(input, data.draftAi, onClockProfile(start))).not.toBeNull();
    expect(chooseAiPick.length).toBe(3);
  });

  it("a view cut down to the declared fields gives the pick the run makes, for the first 96 picks", () => {
    let s = newFranchise(data, 42, "T00", 32);
    for (let i = 0; i < 96; i++) {
      const v = openView(s);
      if (v.userOnClock) {
        s = must(makePick(s, data, v.legal[0] as string));
        continue;
      }
      const positions = {} as Record<Position, DraftAiInput["onClock"]["positions"][Position]>;
      for (const p of POSITIONS) {
        const { count, use, legal } = v.onClock.positions[p];
        positions[p] = { count, use, legal };
      }
      const cut: DraftAiInput = { available: v.available.map(({ id, position, overall: o }) => ({ id, position, overall: o })), onClock: { positions } };
      const run = must(runDraft(s, data, { maxPicks: 1 }));
      expect(chooseAiPick(cut, data.draftAi, onClockProfile(s))?.playerId, `pick ${i + 1}`).toBe((run.picks[0] as { playerId: string }).playerId);
      s = run.state;
    }
  }, 30_000);

  it("changing any player's ratings or skills while his overall is unchanged leaves every AI pick unchanged", () => {
    const start = must(setAutoDraft(newFranchise(data, 43, "T00", 20), true));
    // Every rating flat at his overall: the same overall, nothing else the same.
    const flat: FranchiseState = {
      ...start,
      players: start.players.map((p) => {
        const o = overall(p, data.overallWeights);
        const same = <T extends object>(x: T): T => Object.fromEntries(Object.keys(x).map((k) => [k, o])) as T;
        return { ...p, ratings: same(p.ratings), skills: same(p.skills) };
      }),
    };
    expect(flat.players.map((p) => overall(p, data.overallWeights))).toEqual(start.players.map((p) => overall(p, data.overallWeights)));
    expect(must(runDraft(flat, data)).state.draft.picks).toEqual(must(runDraft(start, data)).state.draft.picks);
  }, 30_000);

  it("the choice follows the score: style value x position value x overall (or style value x the value curve), style need x slot need, and the misreading, ties by id", () => {
    const s = must(runDraft(newFranchise(data, 44, "T00", 32), data, { maxPicks: 9 })).state;
    const v = openView(s);
    const ai = data.draftAi;
    for (const style of Object.keys(ai.styles)) {
      const profile = { ...onClockProfile(s), style, errorSd: 3 };
      const c = chooseAiPick(v, ai, profile);
      if (c === null) throw new Error("no pick");
      const st = ai.styles[style];
      const valueOf = (p: { position: Position; overall: number }): number => {
        const curve = ai.valueCurve?.[p.position];
        return curve === undefined ? ai.positionValue[p.position] * (st?.value?.[p.position] ?? 1) * p.overall : (st?.value?.[p.position] ?? 1) * curveValue(curve, p.overall);
      };
      const scoreOf = (p: { id: string; position: Position; overall: number }): number => {
        const worth = ai.positionValue[p.position] * (st?.value?.[p.position] ?? 1);
        return valueOf(p) + (st?.need ?? 1) * (ai.slotNeed[p.position][v.onClock.positions[p.position].count] ?? 0) + worth * evaluationError(profile, p.id);
      };
      const best = v.available.filter((p) => p.legal).sort((a, b) => scoreOf(b) - scoreOf(a) || (a.id < b.id ? -1 : 1))[0];
      expect(c.playerId, style).toBe(best?.id);
      const worth = ai.positionValue[c.position] * (st?.value?.[c.position] ?? 1);
      expect(c.value).toBeCloseTo(valueOf(c), 10);
      expect(c.noise).toBeCloseTo(worth * evaluationError(profile, c.playerId), 10);
      expect(c.score).toBeCloseTo(c.value + c.need + c.noise, 10);
    }
    // Level scores: the lower id.
    const flat: DraftAiConfig = { ...ai, positionValue: Object.fromEntries(POSITIONS.map((p) => [p, 1])) as DraftAiConfig["positionValue"], slotNeed: NO_NEED };
    const level = { ...v, available: v.available.map((p) => ({ ...p, overall: 60 })) };
    expect(chooseAiPick(level, flat, { ...onClockProfile(s), style: "balanced", errorSd: 0 })?.playerId).toBe(v.available.map((p) => p.id).sort()[0]);
  });
});

describe("B11: targets never reach an AI team", () => {
  it("every AI pick of a whole draft is the same with and without user targets when the user's own picks are the same", () => {
    let plain = newFranchise(data, 45, "T00", 12);
    let marked = plain;
    for (const p of openView(plain).available.filter((_, i) => i % 4 === 0)) marked = must(setTarget(marked, p.id, true));
    const pick = randomUser(45);
    const index = playerIndex(plain.players);
    while (plain.phase === "draft") {
      const a = must(runDraft(plain, data));
      const b = must(runDraft(clone(marked), data));
      expect(b.picks).toEqual(a.picks);
      plain = a.state;
      marked = b.state;
      if (plain.phase !== "draft") break;
      const id = pick(must(legalPicks(plain, data)).legal, (x) => (index.get(x) as { position: Position }).position, {} as Record<Position, number>);
      plain = must(makePick(plain, data, id));
      marked = must(makePick(marked, data, id));
    }
    expect({ ...marked, draft: { ...marked.draft, targets: [] } }).toEqual(plain);
  }, 60_000);
});

describe("B15: profiles", () => {
  it("the same seed gives the same style and errorSd per team, inside the range, and every style is drawn", () => {
    const seen = new Map<string, number>();
    for (let seed = 1; seed <= 100; seed++) {
      const profiles = draftProfiles(data.draftAi, seed, TEAMS);
      expect(profiles).toEqual(Array.from({ length: TEAMS }, (_, t) => draftProfile(data.draftAi, seed, t)));
      for (const p of profiles) {
        expect(p.errorSd).toBeGreaterThanOrEqual(data.draftAi.evaluation.errorSdMin);
        expect(p.errorSd).toBeLessThanOrEqual(data.draftAi.evaluation.errorSdMax);
        seen.set(p.style, (seen.get(p.style) ?? 0) + 1);
      }
    }
    const weights = Object.values(data.draftAi.styles).reduce((s, x) => s + x.weight, 0);
    // 3,200 draws: each style's share is within 3 points of its weight's (about 4 standard errors).
    for (const [name, x] of Object.entries(data.draftAi.styles)) expect(Math.abs((seen.get(name) ?? 0) / 3200 - x.weight / weights), name).toBeLessThan(0.03);
    expect(draftProfiles(data.draftAi, 1, TEAMS)).not.toEqual(draftProfiles(data.draftAi, 2, TEAMS));
  });

  it("a team's error for a player is the same before and after other picks, after a JSON round trip, and whichever team the user controls", () => {
    const a = newFranchise(data, 46, "T00");
    const b = newFranchise(data, 46, "T09");
    const errors = (s: FranchiseState): number[] => s.teams.flatMap((_, t) => s.players.slice(0, 40).map((p) => evaluationError(draftProfile(data.draftAi, s.seed, t), p.id)));
    const before = errors(a);
    expect(errors(must(runDraft(must(setAutoDraft(a, true)), data, { maxPicks: 600 })).state)).toEqual(before);
    expect(errors(clone(a))).toEqual(before);
    expect(errors(b)).toEqual(before);
    expect(new Set(before).size).toBe(before.length);
    // The order the errors are asked for in does not matter.
    const profile = { ...draftProfile(data.draftAi, 46, 3), errorSd: 5 };
    const ids = a.players.map((p) => p.id);
    const forward = ids.map((id) => evaluationError({ ...profile }, id));
    const other = { ...profile };
    expect([...ids].reverse().map((id) => evaluationError(other, id)).reverse()).toEqual(forward);
    // A normal draw times errorSd: mean near 0, SD near 5 over 1,871 players (3 standard errors).
    const m = forward.reduce((x, y) => x + y, 0) / forward.length;
    const sd = Math.sqrt(forward.reduce((x, y) => x + (y - m) ** 2, 0) / forward.length);
    expect(Math.abs(m)).toBeLessThan((3 * 5) / Math.sqrt(forward.length));
    expect(Math.abs(sd - 5)).toBeLessThan((3 * 5) / Math.sqrt(2 * forward.length));
  }, 30_000);

  it("with errorSd 0 and one style, all AI teams score a board alike", () => {
    const alike: DraftAiConfig = { ...data.draftAi, evaluation: { errorSdMin: 0, errorSdMax: 0 }, styles: { balanced: { weight: 1 } } };
    const s = newFranchise(data, 47);
    const v = openView(s);
    const choices = draftProfiles(alike, s.seed, TEAMS).map((p) => chooseAiPick(v, alike, p));
    for (const c of choices) expect(c).toEqual(choices[0]);
    expect(choices[0]?.noise).toBe(0);
    // With the shipped profiles they differ.
    expect(new Set(draftProfiles(data.draftAi, s.seed, TEAMS).map((p) => chooseAiPick(v, data.draftAi, p)?.score)).size).toBeGreaterThan(10);
  });

  it("profiles are not in the state, and the need bonus is the slot's", () => {
    expect(JSON.stringify(allAiDraft(data, 48))).not.toMatch(/errorSd|style|profile/);
    for (const p of POSITIONS) {
      const list = data.draftAi.slotNeed[p];
      for (let count = 0; count < list.length + 3; count++) expect(needBonus({ position: p, count }, data.draftAi.slotNeed)).toBe(count < list.length ? list[count] : 0);
    }
  }, 30_000);

  it("a named autoPick error would apply to the user's auto-pick only", () => {
    const erring: FranchiseData = { ...data, draftAi: { ...data.draftAi, autoPick: { style: "balanced", errorSd: 8 } } };
    const s = toUser(newFranchise(data, 49, "T00", 8));
    expect(toUser(newFranchise(erring, 49, "T00", 8), erring)).toEqual(s);
    expect(autoPickPreview(s, erring)?.noise).not.toBe(0);
    expect(autoPickPreview(s, data)?.noise).toBe(0);
  });
});

describe("B8: the draft view", () => {
  const KEYS = ["seed", "rounds", "totalPicks", "userTeam", "picksUntilUser", "userNextPick", "userPicksMade", "userPicksTotal", "autoDraft", "slots", "picks", "available", "availableCount", "legal", "user", "summaries", "done", "overallPick", "round", "pickInRound", "onClockTeam", "userOnClock", "onClock"];

  it("has every field listed under Draft, and its summaries equal leagueSummaries after each pick of a whole draft", () => {
    let s = must(setAutoDraft(newFranchise(data, 51, "T00", 4), true));
    for (let pick = 1; pick <= 1696; pick++) {
      {
        const v = openView(s);
        expect(Object.keys(v).sort()).toEqual([...KEYS].sort());
        expect(v.summaries).toEqual(leagueSummaries(s, data));
        expect(v).toMatchObject({ overallPick: pick, round: Math.ceil(pick / TEAMS), pickInRound: ((pick - 1) % TEAMS) + 1, onClockTeam: s.draft.slots[pick - 1], totalPicks: 1696, rounds: 53, seed: 51, userTeam: "T00" });
        expect(v.userOnClock).toBe(s.draft.slots[pick - 1] === "T00");
        expect(v.slots).toEqual(s.draft.slots);
        expect(v.picks).toHaveLength(pick - 1);
        expect(v.availableCount).toBe(1871 - (pick - 1));
        expect(v.available).toHaveLength(v.availableCount);
        expect(v.onClock.teamId).toBe(v.onClockTeam);
        expect(v.legal).toEqual(must(legalPicks(s, data)).legal);
        expect(v.legal).toEqual(v.available.filter((p) => p.legal).map((p) => p.id));
        expect(v.user.teamId).toBe("T00");
        expect(v.userPicksMade).toBe((s.rosters["T00"] as string[]).length);
        expect(v.user.picksMade + v.user.picksLeft).toBe(53);
      }
      s = must(runDraft(s, data, { maxPicks: 1 })).state;
    }
    const done = draftView(s, data);
    expect(Object.keys(done).sort()).toEqual([...KEYS].sort());
    expect(done).toMatchObject({ done: true, overallPick: null, round: null, pickInRound: null, onClockTeam: null, userOnClock: false, onClock: null, picksUntilUser: null, userNextPick: null, userPicksMade: 53, userPicksTotal: 53, availableCount: 175, legal: [] });
    expect(done.summaries).toEqual(leagueSummaries(s, data));
    expect(done.picks).toHaveLength(1696);
    expect(done.available.every((p) => !p.legal)).toBe(true);
  }, 120_000);

  it("picks so far: slot, team, player, who picked, position and overall; easy to slice since pick n", () => {
    let s = toUser(newFranchise(data, 52, "T00", 3));
    s = must(makePick(s, data, openView(s).legal[0] as string));
    s = toUser(s);
    s = must(autoPick(s, data)).state;
    const v = openView(s);
    const index = playerIndex(s.players);
    expect(v.picks.map((p) => p.overallPick)).toEqual(v.picks.map((_, i) => i + 1));
    for (const p of v.picks) {
      expect(p.teamId).toBe(s.draft.slots[p.overallPick - 1]);
      expect(p.round).toBe(Math.ceil(p.overallPick / TEAMS));
      expect(p.pickInRound).toBe(((p.overallPick - 1) % TEAMS) + 1);
      expect(index.get(p.playerId)).toMatchObject({ name: p.name, position: p.position });
      expect(p.by).toBe(p.teamId === "T00" ? (p.overallPick === 3 ? "user" : "auto") : "ai");
    }
    expect(v.picks.filter((p) => p.teamId === "T00").map((p) => p.overallPick)).toEqual([3, 62]);
    expect(draftLog(s, data)).toEqual(v.picks);
    expect(draftLog(s, data, 3)).toEqual(v.picks.slice(3));
    expect(draftLog(s, data, 3)[0]?.overallPick).toBe(4);
    expect(draftLog(s, data, v.picks.length)).toEqual([]);
  });

  it("available players carry overall, ratings and rank at position, in a total order that does not flicker", () => {
    const s = toUser(newFranchise(data, 53, "T00", 16));
    const v = openView(s);
    for (let i = 1; i < v.available.length; i++) {
      const a = v.available[i - 1] as DraftView["available"][number];
      const b = v.available[i] as DraftView["available"][number];
      expect(a.overall > b.overall || (a.overall === b.overall && a.id < b.id)).toBe(true);
    }
    for (const p of POSITIONS) {
      const at = v.available.filter((x) => x.position === p);
      expect(at.map((x) => x.positionRank)).toEqual(at.map((_, i) => i + 1));
      expect(v.onClock.positions[p].available).toBe(at.length);
    }
    const index = playerIndex(s.players);
    for (const p of v.available.slice(0, 50)) expect(index.get(p.id)).toMatchObject({ ratings: p.ratings, skills: p.skills, name: p.name });
    // The same board whatever order the pool is stored in.
    const reversed: FranchiseState = { ...s, players: [...s.players].reverse() };
    expect(draftView(reversed, data).available).toEqual(v.available);
    expect(draftView(clone(s), data)).toEqual(v);
  });

  it("every sort the core offers is a total order: by overall or any rating, ties by overall then id", () => {
    const v = openView(toUser(newFranchise(data, 57, "T00", 8)));
    expect(sortAvailable(v.available)).toEqual(v.available);
    expect(sortAvailable(v.available, "overall")).toEqual(v.available);
    for (const by of ["speed", "strength", "agility", "awareness", "accuracy", "coverage", "kickPower"]) {
      const sorted = sortAvailable(v.available, by);
      const value = (p: (typeof sorted)[number]): number => (p.ratings as Readonly<Record<string, number>>)[by] ?? p.skills[by] ?? -1;
      expect(sorted).toHaveLength(v.available.length);
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1] as (typeof sorted)[number];
        const b = sorted[i] as (typeof sorted)[number];
        const ordered = value(a) > value(b) || (value(a) === value(b) && (a.overall > b.overall || (a.overall === b.overall && a.id < b.id)));
        if (!ordered) throw new Error(`${by}: ${a.id} before ${b.id}`);
      }
      // The same order from any input order, and the input is not changed.
      expect(sortAvailable([...v.available].reverse(), by)).toEqual(sorted);
    }
    expect(sortAvailable(v.available, "accuracy")[0]?.position).toBe("QB");
  });

  it("status: picks until the user's turn, the next pick after this one, and two picks in a row at a snake turn", () => {
    const last = newFranchise(data, 54, "T00", 32);
    const v0 = openView(last);
    expect(v0).toMatchObject({ userOnClock: false, picksUntilUser: 31, userPicksMade: 0, userPicksTotal: 53, done: false });
    expect(v0.userNextPick).toEqual({ overallPick: 32, round: 1, pickInRound: 32, picksAway: 31, backToBack: false });
    const at32 = toUser(last);
    const v32 = openView(at32);
    expect(v32).toMatchObject({ userOnClock: true, picksUntilUser: 0, overallPick: 32 });
    expect(v32.userNextPick).toEqual({ overallPick: 33, round: 2, pickInRound: 1, picksAway: 1, backToBack: true });
    const at33 = must(makePick(at32, data, v32.legal[0] as string));
    const v33 = openView(at33);
    expect(v33).toMatchObject({ userOnClock: true, picksUntilUser: 0, overallPick: 33, userPicksMade: 1 });
    expect(v33.userNextPick).toEqual({ overallPick: 96, round: 3, pickInRound: 32, picksAway: 63, backToBack: false });
    // The run does not move while the user is on the clock twice in a row.
    expect(must(runDraft(at33, data)).picks).toEqual([]);
    // The user's last pick (slot 32 closes the odd final round) has no next one.
    const nearEnd = must(runDraft(must(setAutoDraft(last, true)), data, { maxPicks: 1695 })).state;
    expect(openView(nearEnd)).toMatchObject({ overallPick: 1696, userOnClock: true, userNextPick: null, picksUntilUser: 0, userPicksMade: 52 });
  });

  it("use: starter below the minimum, depth up to the target, extra beyond, for the team on the clock and for the user", () => {
    let s = toUser(newFranchise(data, 55, "T00", 2));
    const limits = rosterLimits(data);
    for (let turn = 0; turn < 12; turn++) {
      const v = openView(s);
      for (const p of POSITIONS) {
        const r = v.onClock.positions[p];
        expect(r).toMatchObject(limits[p]);
        expect(r.use).toBe(r.count < r.min ? "starter" : r.count < r.target ? "depth" : "extra");
        expect(v.user.positions[p]).toEqual(r);
      }
      for (const a of v.available) expect(a).toMatchObject({ use: v.onClock.positions[a.position].use, legal: v.onClock.positions[a.position].legal, blockedBy: v.onClock.positions[a.position].blockedBy });
      // Stack kickers and quarterbacks so all three uses show up.
      const want = v.available.find((a) => a.legal && (a.position === "K" || a.position === "QB")) ?? (v.available.find((a) => a.legal) as DraftView["available"][number]);
      s = toUser(must(makePick(s, data, want.id)));
    }
    const v = openView(s);
    expect(v.onClock.positions.K).toMatchObject({ count: 2, use: "extra", legal: false, blockedBy: "positionMax" });
    expect(v.onClock.positions.QB).toMatchObject({ count: 4, use: "extra", blockedBy: "positionMax" });
    expect(v.onClock.positions.RB.use).toBe("starter");
    // Off the clock the user's board is still the user's, not the team on the clock's.
    const off = openView(must(makePick(s, data, v.legal[0] as string)));
    expect(off.userOnClock).toBe(false);
    expect(off.user.teamId).toBe("T00");
    expect(off.onClock.teamId).not.toBe("T00");
    expect(off.user.positions.K.count).toBe(2);
    // And so is every available player's use, while legal and blockedBy are the team's on the clock.
    for (const a of off.available) expect(a).toMatchObject({ use: off.user.positions[a.position].use, legal: off.onClock.positions[a.position].legal, blockedBy: off.onClock.positions[a.position].blockedBy });
    const differs = POSITIONS.filter((p) => off.user.positions[p].use !== off.onClock.positions[p].use && off.available.some((a) => a.position === p));
    expect(differs.length).toBeGreaterThan(0);
    // Every AI turn to the user's next one, and the last board of the draft.
    let walk = must(makePick(s, data, v.legal[0] as string));
    let aiTurns = 0;
    for (;;) {
      const w = openView(walk);
      if (w.userOnClock) break;
      aiTurns++;
      for (const a of w.available) if (a.use !== w.user.positions[a.position].use) throw new Error(`pick ${w.overallPick} ${a.id}: ${a.use}`);
      walk = must(runDraft(walk, data, { maxPicks: 1 })).state;
    }
    expect(aiTurns).toBeGreaterThan(1);
    const done = draftView(must(runDraft(must(setAutoDraft(walk, true)), data)).state, data);
    expect(done.done).toBe(true);
    for (const a of done.available) expect(a).toMatchObject({ use: done.user.positions[a.position].use, legal: false, blockedBy: null });
  }, 30_000);

  it("depthRank: the place he would take in the user's depth order if drafted, whoever is on the clock", () => {
    let s = toUser(newFranchise(data, 58, "T00", 3));
    for (let turn = 0; turn < 14; turn++) s = toUser(must(makePick(s, data, must(legalPicks(s, data)).legal[turn % 5 === 0 ? 0 : 30 * turn] as string)));
    const check = (state: FranchiseState): void => {
      const v = openView(state);
      const mine = v.summaries.find((t) => t.teamId === "T00") as (typeof v.summaries)[number];
      for (const a of v.available) {
        const ahead = mine.positions[a.position].players.filter((p) => p.overall > a.overall || (p.overall === a.overall && p.id < a.id)).length;
        if (a.depthRank !== ahead + 1) throw new Error(`${a.id}: ${a.depthRank}, expected ${ahead + 1}`);
      }
      expect(new Set(v.available.map((a) => a.depthRank)).size).toBeGreaterThan(1);
    };
    check(s);
    const off = must(makePick(s, data, openView(s).legal[0] as string));
    expect(openView(off).userOnClock).toBe(false);
    check(off);
    // Where he would sit is where he then sits.
    const pick = openView(s).available.find((a) => a.legal && a.depthRank > 1) as DraftView["available"][number];
    const after = must(makePick(s, data, pick.id));
    const chart = leagueSummaries(after, data)[0]?.positions[pick.position].players.map((p) => p.id) ?? [];
    expect(chart.indexOf(pick.id)).toBe(pick.depthRank - 1);
  });

  it("must-fill: the open starting slots by position, and the flag when every pick left has to fill one", () => {
    const start = newFranchise(data, 56, "T00", 1);
    const v = openView(start);
    const limits = rosterLimits(data);
    expect(v.user.mustFill).toEqual(POSITIONS.map((p) => ({ position: p, count: limits[p].min })));
    expect(v.user).toMatchObject({ requiredLeft: 33, picksLeft: 53, picksMade: 0, everyPickMustFill: false });
    // A full roster has nothing left to fill and the flag is off.
    const done = draftView(allAiDraft(data, 56), data);
    expect(done.user).toMatchObject({ mustFill: [], requiredLeft: 0, picksLeft: 0, picksMade: 53, everyPickMustFill: false });
  }, 30_000);
});

describe("B9: jersey numbers", () => {
  it("after the draft every roster has unique numbers legal for each position, the same for a seed", () => {
    const s = allAiDraft(data, 61);
    expect(draftProblems(s, data)).toEqual([]);
    expect(Object.keys(s.numbers)).toHaveLength(1696);
    expect(allAiDraft(data, 61).numbers).toEqual(s.numbers);
    expect(allAiDraft(data, 62).numbers).not.toEqual(s.numbers);
    // No numbers before the last pick.
    const start = newFranchise(data, 61);
    const almost = must(runDraft({ ...start, draft: { ...start.draft, autoDraft: true } }, data, { maxPicks: 1695 })).state;
    expect(almost.numbers).toEqual({});
    expect(almost.phase).toBe("draft");
  }, 30_000);

  it("10,000 seeded rosters inside min and max never fail, and every number is unique and legal", () => {
    const limits = rosterLimits(data);
    const rules = data.game.engine.rules;
    const legal = Object.fromEntries(POSITIONS.map((p) => [p, new Set(legalNumbers(rules, p))])) as Record<Position, Set<number>>;
    for (let seed = 0; seed < 10_000; seed++) {
      const rng = Rng.fromSeed(seed);
      // A random roster: the minimums, then random positions below their max, to the roster size.
      const counts = Object.fromEntries(POSITIONS.map((p) => [p, limits[p].min])) as Record<Position, number>;
      let n = POSITIONS.reduce((sum, p) => sum + counts[p], 0);
      while (n < data.roster.rosterSize) {
        const p = POSITIONS[Math.floor(rng.nextFloat() * POSITIONS.length)] as Position;
        if (counts[p] >= limits[p].max) continue;
        counts[p]++;
        n++;
      }
      const roster = POSITIONS.flatMap((p) => Array.from({ length: counts[p] }, (_, i) => ({ id: `${p}${i}`, position: p })));
      const made = assignRosterNumbers(roster, rules, rng);
      if (!made.ok) throw new Error(`seed ${seed}: no number for ${made.playerId}`);
      const worn = Object.values(made.numbers);
      if (worn.length !== roster.length || new Set(worn).size !== worn.length) throw new Error(`seed ${seed}: a number is worn twice`);
      for (const p of roster) if (!legal[p.position].has(made.numbers[p.id] as number)) throw new Error(`seed ${seed}: ${p.id} wears ${made.numbers[p.id]}`);
    }
  }, 60_000);

  it("a position with no number left is a typed failure, not a throw, and numbers already worn are kept clear", () => {
    const rules = data.game.engine.rules;
    const qbs = Array.from({ length: 21 }, (_, i) => ({ id: `Q${i}`, position: "QB" as const }));
    expect(assignRosterNumbers(qbs, rules, Rng.fromSeed(1))).toMatchObject({ ok: false, position: "QB" });
    const taken = new Set(legalNumbers(rules, "QB").slice(1));
    expect(assignRosterNumbers([{ id: "Q", position: "QB" }], rules, Rng.fromSeed(1), taken)).toEqual({ ok: true, numbers: { Q: legalNumbers(rules, "QB")[0] } });
  });
});

describe("the value curve (Kickers and punters, 2026-11-25)", () => {
  const curve = [[0, 0], [70, 26], [89, 38], [90, 46], [99, 49]] as const;

  it("is straight lines between its points, flat outside 0 to 99", () => {
    expect(curveValue(curve, 0)).toBe(0);
    expect(curveValue(curve, 35)).toBeCloseTo(13, 10);
    expect(curveValue(curve, 70)).toBe(26);
    expect(curveValue(curve, 89)).toBe(38);
    expect(curveValue(curve, 90)).toBe(46);
    expect(curveValue(curve, 96)).toBeCloseTo(48, 10);
    expect(curveValue(curve, 99)).toBe(49);
    expect(curveValue(curve, 120)).toBe(49);
    expect(curveValue(curve, -5)).toBe(0);
  });

  it("the schema takes a curve from 0 to 99 that never falls, and nothing else", () => {
    const good = franchiseFiles().draftAi as Record<string, unknown>;
    const ok = (valueCurve: unknown): boolean => draftAiSchema.safeParse({ ...good, valueCurve }).success;
    expect(ok({ K: curve })).toBe(true);
    expect(ok(undefined)).toBe(true);
    expect(ok({ K: [[0, 0]] })).toBe(false);
    expect(ok({ K: [[1, 0], [99, 9]] })).toBe(false);
    expect(ok({ K: [[0, 0], [90, 9]] })).toBe(false);
    expect(ok({ K: [[0, 0], [50, 9], [50, 10], [99, 11]] })).toBe(false);
    expect(ok({ K: [[0, 5], [50, 4], [99, 11]] })).toBe(false);
    expect(ok({ K: [[0, 0], [99.5, 4]] })).toBe(false);
    expect(ok({ XX: curve })).toBe(false);
  });

  it("the shipped K and P curves rise steeply at the standout line and are flat to it", () => {
    for (const p of ["K", "P"] as const) {
      const c = data.draftAi.valueCurve?.[p];
      if (c === undefined) throw new Error(`no ${p} curve`);
      const below = curveValue(c, tol.B17_STANDOUT_OVERALL - 1) - curveValue(c, tol.B17_STANDOUT_OVERALL - 10);
      const jump = curveValue(c, tol.B17_STANDOUT_OVERALL) - curveValue(c, tol.B17_STANDOUT_OVERALL - 1);
      expect(jump, p).toBeGreaterThan(below);
    }
  });
});

describe("B17 and B18: kickers, punters and quarterbacks (a fixed slice; all 800 leagues are in franchise.heavy.test.ts)", () => {
  it(`over 12 leagues none goes in rounds 1 to ${tol.B17_NONE_THROUGH_ROUND}, none under ${tol.B17_STANDOUT_OVERALL} before round ${tol.B17_FIRST_ROUND_MIN} for the AI teams and the auto-pick alike, a second is rare, and every team has ${tol.B18_QB_MIN} quarterbacks`, () => {
    let any = Number.POSITIVE_INFINITY;
    let first = { ai: Number.POSITIVE_INFINITY, auto: Number.POSITIVE_INFINITY };
    let second = 0;
    let shortQb = 0;
    for (let seed = tol.B17_FIRST_SEED; seed < tol.B17_FIRST_SEED + 12; seed++) {
      const held = new Map<string, number>();
      for (const e of draftLog(allAiDraft(data, seed), data)) {
        held.set(`${e.teamId}.${e.position}`, (held.get(`${e.teamId}.${e.position}`) ?? 0) + 1);
        if (e.position !== "K" && e.position !== "P") continue;
        any = Math.min(any, e.round);
        const by = e.by === "ai" ? "ai" : "auto";
        if (e.overall < tol.B17_STANDOUT_OVERALL) first = { ...first, [by]: Math.min(first[by], e.round) };
      }
      second += [...held.entries()].filter(([k, n]) => (k.endsWith(".K") || k.endsWith(".P")) && n > 1).length;
      for (let t = 0; t < 32; t++) if ((held.get(`T${String(t).padStart(2, "0")}.QB`) ?? 0) < tol.B18_QB_MIN) shortQb++;
    }
    expect(any).toBeGreaterThan(tol.B17_NONE_THROUGH_ROUND);
    expect(first.ai).toBeGreaterThanOrEqual(tol.B17_FIRST_ROUND_MIN);
    expect(first.auto).toBeGreaterThanOrEqual(tol.B17_FIRST_ROUND_MIN);
    // Every team drafts one, so both are real rounds.
    expect(Math.max(first.ai, first.auto)).toBeLessThanOrEqual(data.roster.rosterSize);
    expect(second / (12 * 32)).toBeLessThanOrEqual(tol.B17_SECOND_TEAM_SHARE_MAX);
    expect(shortQb).toBeLessThanOrEqual(tol.B18_SHORT_TEAMS_MAX);
  }, 60_000);
});
