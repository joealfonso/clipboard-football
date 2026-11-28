// The draft additions of the 2026-11-24 revision (docs/specs/m4-franchise-core.md): `through`,
// `depthRank`, `user.targets` against `targetsAvailable`, back-to-back turns, picksForSlot, B6, B11.

import { describe, expect, it } from "vitest";
import type { DraftOpenView, FranchiseState, PoolPlayer } from "../../../shared/src/franchise";
import { autoPick, draftView, makePick, picksForSlot, runDraft, setAutoDraft, setTarget } from "../../src/franchise";
import { create, deepFreeze, errorCode, flatAi, forge, onClock, othersFill, pinnedData, playDraft, POSITIONS, prng, roundTrip, SCRIPTS, smallData, specLegalIds, specOverall, undrafted, value, withAi, withOveralls } from "./spec-support";
import type { Position } from "./spec-support";

const small = smallData();
const big = pinnedData();
const on = (s: FranchiseState): FranchiseState => value(setAutoDraft(s, true));
const userTurns = (s: FranchiseState): number[] => s.draft.slots.flatMap((t, i) => (t === s.settings.userTeam ? [i] : []));

describe("runDraft through, auto-draft on", () => {
  it("\"end\" is the default and runs out the draft", () => {
    const s = on(create(small, 3, 2));
    const r = value(runDraft(s, small, { through: "end" }));
    expect(r.state.phase).toBe("regularSeason");
    expect(r.picks).toHaveLength(148);
    expect(value(runDraft(s, small))).toStrictEqual(r);
  });
  it.each([1, 2, 3, 4])("\"nextUserPick\" stops on the user's clock each time, makes his pick only when he is on it, and ends with the same picks as \"end\" (slot %i)", (slot) => {
    const s0 = on(create(small, 5, slot));
    const turns = userTurns(s0);
    let s = s0;
    // Before the first turn: the AI picks up to it and nothing of the user's, unless he is already on the clock.
    const stops = turns[0] === 0 ? [...turns.slice(1), 148] : [...turns, 148];
    let made = 0;
    for (const stop of stops) {
      const r = value(runDraft(s, small, { through: "nextUserPick" }));
      expect(r.picks.map((p) => p.overallPick)).toEqual(Array.from({ length: stop - made }, (_, i) => made + i + 1));
      const mine = r.picks.filter((p) => p.teamId === "T00");
      expect(mine.map((p) => [p.overallPick, p.by])).toEqual(onClock(s) === "T00" ? [[made + 1, "auto"]] : []);
      expect(r.state.draft.picks).toHaveLength(stop);
      if (stop < 148) expect(onClock(r.state)).toBe("T00");
      expect(r.state.draft.autoDraft).toBe(s0.draft.autoDraft);
      s = r.state;
      made = stop;
    }
    expect(s).toStrictEqual(value(runDraft(s0, small)).state);
  });
  it("at a snake turn it makes one of the two picks and stops between them", () => {
    const s0 = on(create(small, 6, 4)); // picks 4 and 5
    const first = value(runDraft(s0, small, { through: "nextUserPick" })).state;
    expect(first.draft.picks).toHaveLength(3);
    const second = value(runDraft(first, small, { through: "nextUserPick" }));
    expect(second.picks.map((p) => p.overallPick)).toEqual([4]);
    expect(onClock(second.state)).toBe("T00");
    expect(value(runDraft(second.state, small, { through: "nextUserPick" })).picks.map((p) => p.overallPick)).toEqual([5, 6, 7, 8, 9, 10, 11]);
  });
  it("maxPicks stays, and whichever limit comes first holds", () => {
    const s = on(create(small, 7, 1)); // on the clock; the next turn is pick 8
    expect(value(runDraft(s, small, { through: "nextUserPick", maxPicks: 3 })).picks).toHaveLength(3);
    expect(value(runDraft(s, small, { through: "nextUserPick", maxPicks: 100 })).picks).toHaveLength(7);
    expect(value(runDraft(s, small, { through: "end", maxPicks: 20 })).picks).toHaveLength(20);
    expect(value(runDraft(s, small, { through: "nextUserPick", maxPicks: 0 })).picks).toEqual([]);
  });
  it("switching auto-draft off stops at the user's next turn", () => {
    const mid = value(runDraft(on(create(small, 8, 3)), small, { through: "nextUserPick" })).state;
    const off = value(setAutoDraft(value(runDraft(mid, small, { maxPicks: 1 })).state, false));
    const r = value(runDraft(off, small, { through: "end" }));
    expect(onClock(r.state)).toBe("T00");
    expect(r.picks.every((p) => p.by === "ai")).toBe(true);
  });
  it("an unknown value is a typed error with the state unchanged", () => {
    const s = deepFreeze(on(create(small, 8, 3)));
    for (const through of ["next", "", 3] as unknown as "end"[]) expect(errorCode(runDraft(s, small, { through }))).not.toBeNull();
  });
});

describe("runDraft through, auto-draft off: both values stop at the user's turn and pick nothing for him", () => {
  it.each(["end", "nextUserPick"] as const)("%s", (through) => {
    const s = create(small, 9, 3);
    const r = value(runDraft(s, small, { through }));
    expect(r.picks.map((p) => p.overallPick)).toEqual([1, 2]);
    expect(value(runDraft(r.state, small, { through })).picks).toEqual([]);
    expect(value(runDraft(r.state, small, { through })).state).toStrictEqual(r.state);
  });
});

describe("depthRank: his place in the user's team's depth order if drafted (overall descending, ties by id)", () => {
  it("by hand: the user holds receivers of 80, 70 and 70", () => {
    const s0 = forge(create(small, 3, 1), userTurns(create(small, 3, 1))[3] as number, othersFill(small, () => "WR"));
    const mine = (s0.rosters["T00"] as readonly string[]).slice().sort();
    const [a, b, c] = mine as [string, string, string];
    const free = undrafted(s0).filter((p) => p.position === "WR").map((p) => p.id).sort();
    const [w, x, y, z] = free as [string, string, string, string];
    const set: Record<string, number> = { [a]: 80, [b]: 70, [c]: 70, [w]: 90, [x]: 75, [y]: 70, [z]: 60 };
    const s = withOveralls(s0, (p) => set[p.id] ?? 50);
    const rank = new Map(draftView(s, small).available.map((p) => [p.id, p.depthRank]));
    expect([w, x, z].map((id) => rank.get(id))).toEqual([1, 2, 4]);
    // Level with b and c: ahead of the ones whose id is higher.
    expect(rank.get(y)).toBe(2 + [b, c].filter((id) => id < y).length);
    // Nobody at the position yet: first, whoever he is.
    expect(new Set(draftView(s, small).available.filter((p) => p.position === "QB").map((p) => p.depthRank))).toEqual(new Set([1]));
  });
  it("matches a count over the user's roster at every third pick of three drafts, on and off the clock, and ties split by id", () => {
    let off = 0;
    for (const [seed, flatten] of [[1, false], [2, false], [3, true]] as const) {
      let s = create(small, seed, 3);
      // Seed 3: overalls in steps of ten, so nearly everything ties.
      if (flatten) s = withOveralls(s, (p) => 40 + 10 * (Number(p.id.slice(1)) % 4));
      const ovr = new Map(s.players.map((p) => [p.id, specOverall(p, small.overallWeights)]));
      const pos = new Map(s.players.map((p) => [p.id, p.position]));
      const rand = prng(seed);
      while (s.phase === "draft") {
        if (s.draft.picks.length % 3 === 0) {
          if (onClock(s) !== "T00") off++;
          const mine = s.rosters["T00"] as readonly string[];
          for (const p of draftView(s, small).available) {
            const ahead = mine.filter((id) => pos.get(id) === p.position && ((ovr.get(id) as number) > p.overall || (ovr.get(id) === p.overall && id < p.id)));
            if (p.depthRank !== ahead.length + 1) expect.fail(`seed ${seed} pick ${s.draft.picks.length + 1} ${p.id}: depthRank ${p.depthRank}, by hand ${ahead.length + 1}`);
          }
        }
        if (onClock(s) === "T00") {
          const legal = specLegalIds(s, small, "T00");
          s = value(makePick(s, small, legal[Math.floor(rand() * legal.length)] as string));
        } else s = value(runDraft(s, small, { maxPicks: 1 })).state;
      }
    }
    expect(off).toBeGreaterThan(60);
  });
});

describe("B11 targets: the full list, the ones left, and nobody else reads them", () => {
  it("user.targets is every marked player in the order marked; targetsAvailable the undrafted ones in that order, at every pick and after the draft", () => {
    let s = create(small, 11, 2);
    const rand = prng(11);
    const marks: string[] = [];
    while (s.phase === "draft") {
      if (rand() < 0.5 && marks.length < 40) {
        const free = undrafted(s).filter((p) => !marks.includes(p.id));
        const id = (free[Math.floor(rand() * free.length)] as PoolPlayer).id;
        s = value(setTarget(s, id, true));
        marks.push(id);
      }
      s = onClock(s) === "T00" ? value(autoPick(s, small)).state : value(runDraft(s, small, { maxPicks: 1 })).state;
      const gone = new Set(s.draft.picks.map((p) => p.playerId));
      expect(s.draft.targets).toEqual(marks);
      expect(draftView(s, small).user).toMatchObject({ targets: marks, targetsAvailable: marks.filter((id) => !gone.has(id)) });
      s = roundTrip(s);
    }
    expect(s.draft.targets).toEqual(marks);
    expect(marks.length).toBe(40);
  });
  it("marking and unmarking a drafted target are both errors, and he stays listed", () => {
    const s0 = create(small, 12, 1);
    const id = undrafted(s0)[4]?.id as string;
    const s = deepFreeze(value(makePick(value(setTarget(s0, id, true)), small, id)));
    for (const flag of [true, false]) expect(setTarget(s, id, flag)).toEqual({ ok: false, error: { code: "alreadyDrafted", playerId: id } });
    expect(s.draft.targets).toEqual([id]);
  });
  it("with every target drafted, by the user and by others, auto-pick falls back to the policy", () => {
    const s0 = create(small, 13, 1);
    const doomed = value(runDraft(value(makePick(s0, small, undrafted(s0)[40]?.id as string)), small)).picks[0]?.playerId as string;
    const marked = [undrafted(s0)[40]?.id as string, doomed].reduce((s, id) => value(setTarget(s, id, true)), s0);
    const s = value(runDraft(value(makePick(marked, small, undrafted(s0)[40]?.id as string)), small)).state;
    expect(draftView(s, small).user).toMatchObject({ targets: marked.draft.targets, targetsAvailable: [] });
    const plain = { ...s, draft: { ...s.draft, targets: [] } };
    expect(value(autoPick(s, small)).pick).toEqual(value(autoPick(plain, small)).pick);
  });
  it("AI picks are the same with and without targets over 32 teams, under auto-pick by hand", () => {
    const plain = playDraft(big, 4, SCRIPTS.random);
    expect(plain.failure).toBeNull();
    let s = create(big, 4);
    for (const p of s.players.filter((_, i) => i % 7 === 0)) s = value(setTarget(s, p.id, true));
    for (const id of plain.userPicks) s = value(makePick(value(runDraft(s, big)).state, big, id));
    if (s.phase === "draft") s = value(runDraft(s, big)).state;
    expect(s.draft.picks).toEqual(plain.state.draft.picks);
  });
  it("B5: one different user pick still changes later AI picks", () => {
    const d = withAi(small, { ...flatAi(small), evaluation: { errorSdMin: 4, errorSdMax: 4 } });
    const s = create(d, 4, 1);
    const board = draftView(s, d).available;
    const after = (id: string): string[] => value(runDraft(value(makePick(s, d, id)), d)).picks.map((p) => p.playerId);
    expect(after(board[0]?.id as string)).not.toEqual(after(after(board[0]?.id as string)[0] as string));
  });
});

describe("the user's next pick at the snake, and picksForSlot", () => {
  const at = (slot: number, made: number): DraftOpenView => {
    const v = draftView(forge(create(big, 2, slot), made, othersFill(big, () => "WR")), big);
    if (v.done) throw new Error("expected an open draft");
    return v;
  };
  it("slot 32, pick 31 on the clock: 32 is next and not back to back yet, since the user is not on the clock", () => {
    expect(at(32, 30)).toMatchObject({ userOnClock: false, picksUntilUser: 1 });
    expect(at(32, 30).userNextPick).toEqual({ overallPick: 32, round: 1, pickInRound: 32, picksAway: 1, backToBack: false });
  });
  it("slot 1, pick 63 on the clock the same way, and on pick 1 the next is 64", () => {
    expect(at(1, 62).userNextPick).toEqual({ overallPick: 64, round: 2, pickInRound: 32, picksAway: 1, backToBack: false });
    expect(at(1, 0).userNextPick).toEqual({ overallPick: 64, round: 2, pickInRound: 32, picksAway: 63, backToBack: false });
  });
  it("the last snake turn: slot 32 of 32 on pick 1632 goes again at 1633, then 1696, then never", () => {
    // Round 51 ends at 1632, round 52 starts at 1633, round 53 ends at 1696.
    const order: Position[] = [...POSITIONS.flatMap((p) => Array.from({ length: big.roster.positions[p].target }, () => p))];
    const late = (made: number): DraftOpenView => draftView(forge(create(big, 2, 32), made, (c) => order[c.teamPickNo] as Position), big) as DraftOpenView;
    expect(late(1631).userNextPick).toEqual({ overallPick: 1633, round: 52, pickInRound: 1, picksAway: 1, backToBack: true });
    expect(late(1632).userNextPick).toEqual({ overallPick: 1696, round: 53, pickInRound: 32, picksAway: 63, backToBack: false });
    expect(late(1695).userNextPick).toBeNull();
  });
  it("picksForSlot needs no franchise and gives the picks the slot then owns", () => {
    for (const slot of [1, 7, 16, 32]) {
      const mine = create(big, 3, slot).draft.slots.flatMap((t, i) => (t === "T00" ? [i + 1] : []));
      expect(picksForSlot(slot, 32, 53)).toEqual(mine);
    }
    expect(picksForSlot(2, 4, 5)).toEqual([2, 7, 10, 15, 18]);
  });
});
