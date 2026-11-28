// M4 milestone B, the lead's additions of 2026-11-23 for the draft room (docs/specs/
// m4-franchise-screens.md, F5 "Needs from the sim"): targets, auto-pick reading targets, the
// auto-pick preview with its reason, and the designer's criterion FR7 (the preview names the
// player auto-pick then drafts, over 200 seeded states).

import { describe, expect, it } from "vitest";
import { POSITIONS } from "../../../shared/src/engine";
import type { Position } from "../../../shared/src/engine";
import type { AutoPickPreview, DraftOpenView, FranchiseState } from "../../../shared/src/franchise";
import { autoPick, autoPickPreview, autoPickProfile, chooseAiPick, draftView, makePick, needBonus, runDraft, setAutoDraft, setTarget } from "../../src/franchise/index";
import { curveValue } from "../../src/franchise/draft-ai";
import { Rng } from "../../src/rng";
import { allAiDraft, loadFranchiseData, must, newFranchise } from "./support";

const data = loadFranchiseData();
/** No need bonus at any slot. */
const NO_NEED = Object.fromEntries(POSITIONS.map((p): [Position, readonly number[]] => [p, data.draftAi.slotNeed[p].map(() => 0)])) as Record<Position, readonly number[]>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function openView(state: FranchiseState): DraftOpenView {
  const v = draftView(state, data);
  if (v.done) throw new Error("the draft is over");
  return v;
}

const toUser = (state: FranchiseState): FranchiseState => must(runDraft(state, data)).state;

describe("targets", () => {
  it("setTarget marks and unmarks, keeps the order marked, and is plain JSON in the state", () => {
    const s0 = newFranchise(data, 71, "T00", 10);
    const [a, b, c] = openView(s0).available.slice(40, 43).map((p) => p.id) as [string, string, string];
    let s = must(setTarget(s0, a, true));
    s = must(setTarget(s, b, true));
    s = must(setTarget(s, c, true));
    expect(s.draft.targets).toEqual([a, b, c]);
    expect(must(setTarget(s, b, true)).draft.targets).toEqual([a, c, b]);
    s = must(setTarget(s, a, false));
    expect(s.draft.targets).toEqual([b, c]);
    expect(must(setTarget(s, a, false)).draft.targets).toEqual([b, c]);
    expect(clone(s)).toEqual(s);
    expect(openView(s).user.targets).toEqual([b, c]);
    expect(s0.draft.targets).toEqual([]);
  });

  it("an unknown id and a drafted player are typed errors and change nothing", () => {
    const s = toUser(newFranchise(data, 72, "T00", 10));
    const before = clone(s);
    const taken = (s.draft.picks[0] as { playerId: string }).playerId;
    expect(setTarget(s, "P9999", true)).toEqual({ ok: false, error: { code: "unknownPlayer", playerId: "P9999" } });
    expect(setTarget(s, taken, true)).toEqual({ ok: false, error: { code: "alreadyDrafted", playerId: taken } });
    expect(setTarget(s, taken, false)).toEqual({ ok: false, error: { code: "alreadyDrafted", playerId: taken } });
    expect(s).toEqual(before);
    expect(setTarget(allAiDraft(data, 72), "P0001", true)).toEqual({ ok: false, error: { code: "notDraftPhase", phase: "regularSeason" } });
  }, 30_000);

  it("B11: a drafted target stays in the list and leaves targetsAvailable, whoever drafted him, and the list round-trips through JSON", () => {
    const s0 = newFranchise(data, 73, "T00", 10);
    const board = openView(s0).available;
    const top = (board[0] as { id: string }).id;
    const deep = (board[900] as { id: string }).id;
    let s = must(setTarget(must(setTarget(s0, top, true)), deep, true));
    expect(openView(s).user).toMatchObject({ targets: [top, deep], targetsAvailable: [top, deep] });
    s = clone(must(runDraft(clone(s), data)).state);
    // Another team took the first target, whoever the AI teams rated first: run it to a state where one did.
    const firstTaken = s.draft.picks[0] as { playerId: string };
    const withTaken = must(runDraft(must(setTarget(s0, firstTaken.playerId, true)), data)).state;
    expect(withTaken.draft.targets).toEqual([firstTaken.playerId]);
    expect(openView(withTaken).user).toMatchObject({ targets: [firstTaken.playerId], targetsAvailable: [] });
    expect(s.draft.targets).toEqual([top, deep]);
    // The user drafts his own target by hand, or auto-pick does: it stays in the list.
    const mine = must(makePick(s, data, deep));
    expect(mine.draft.targets).toEqual([top, deep]);
    expect(openView(mine).user.targetsAvailable).not.toContain(deep);
    const auto = must(autoPick(must(setTarget(withTaken, deep, true)), data));
    expect(auto.pick.playerId).toBe(deep);
    expect(auto.state.draft.targets).toEqual([firstTaken.playerId, deep]);
    expect(openView(auto.state).user.targetsAvailable).toEqual([]);
    expect(clone(auto.state)).toEqual(auto.state);
    // And it is there after the draft.
    const end = must(runDraft(must(setAutoDraft(auto.state, true)), data)).state;
    expect(end.draft.targets).toEqual([firstTaken.playerId, deep]);
    expect(draftView(end, data).user.targetsAvailable).toEqual([]);
  }, 30_000);
});

describe("auto-pick reads the user's targets", () => {
  const s0 = toUser(newFranchise(data, 74, "T00", 6));
  const board = openView(s0).available;
  const plain = must(autoPick(s0, data)).pick.playerId;

  it("takes a legal target the roster can use, though the AI policy would pick someone else", () => {
    const target = board.find((p) => p.legal && p.use !== "extra" && p.id !== plain && p.overall < 60) as (typeof board)[number];
    const s = must(setTarget(s0, target.id, true));
    const preview = autoPickPreview(s, data) as AutoPickPreview;
    expect(preview).toMatchObject({ playerId: target.id, reason: "target", name: target.name, position: target.position, overall: target.overall, userOnClock: true });
    const made = must(autoPick(s, data));
    expect(made.pick).toMatchObject({ playerId: target.id, by: "auto", teamId: "T00" });
    // Auto-draft makes the same pick.
    const run = must(runDraft(must(setAutoDraft(s, true)), data, { maxPicks: 1 }));
    expect(run.picks[0]).toEqual(made.pick);
  });

  it("among several usable targets takes the highest overall, ties by id, whatever order they were marked and whatever the AI score says", () => {
    const usable = board.filter((p) => p.legal && p.use !== "extra" && p.id !== plain).slice(100, 140);
    const best = [...usable].sort((a, b) => b.overall - a.overall || (a.id < b.id ? -1 : 1))[0] as (typeof board)[number];
    for (const order of [usable, [...usable].reverse()]) {
      let s = s0;
      for (const p of order) s = must(setTarget(s, p.id, true));
      expect(autoPickPreview(s, data)).toMatchObject({ playerId: best.id, reason: "target" });
      expect(must(autoPick(s, data)).pick.playerId).toBe(best.id);
    }
    // A kicker rated over a needed lineman: the score would take the lineman, the target rule the kicker.
    const k = board.find((p) => p.position === "K" && p.legal && p.overall <= 70) as (typeof board)[number];
    const lower = board.find((p) => p.position === "OL" && p.overall < k.overall && p.overall > k.overall - 5) as (typeof board)[number];
    const s = must(setTarget(must(setTarget(s0, lower.id, true)), k.id, true));
    expect(must(autoPick(s, data)).pick.playerId).toBe(k.id);
  });

  it("falls back to the plain AI policy when the only targets are extra or not legal", () => {
    // Fill kicker to its max, then target a kicker (not legal) and a quarterback past the target (extra).
    let s = s0;
    for (;;) {
      const v = openView(s);
      const want = v.available.find((p) => p.legal && ((p.position === "K" && v.onClock.positions.K.count < 2) || (p.position === "QB" && v.onClock.positions.QB.count < 3)));
      if (want === undefined) break;
      s = toUser(must(makePick(s, data, want.id)));
    }
    const v = openView(s);
    const kicker = v.available.find((p) => p.position === "K") as (typeof board)[number];
    const qb = v.available.find((p) => p.position === "QB") as (typeof board)[number];
    expect(kicker).toMatchObject({ legal: false, blockedBy: "positionMax" });
    expect(qb).toMatchObject({ legal: true, use: "extra" });
    const withTargets = must(setTarget(must(setTarget(s, kicker.id, true)), qb.id, true));
    const plainPick = chooseAiPick(v, data.draftAi, autoPickProfile(data.draftAi, s.seed, 0));
    const preview = autoPickPreview(withTargets, data) as AutoPickPreview;
    expect(preview.playerId).toBe(plainPick?.playerId);
    expect(preview.reason).not.toBe("target");
    expect(must(autoPick(withTargets, data)).pick.playerId).toBe(plainPick?.playerId);
  });

  it("AI teams never read the user's targets: their picks are the same with and without them", () => {
    const start = newFranchise(data, 75, "T00", 30);
    let marked = start;
    for (const p of openView(start).available.slice(0, 60)) marked = must(setTarget(marked, p.id, true));
    const a = must(runDraft(start, data));
    const b = must(runDraft(marked, data));
    expect(a.picks).toHaveLength(29);
    expect(b.picks).toEqual(a.picks);
  });
});

describe("the auto-pick preview", () => {
  it("B12 and FR7: over 200 seeded states the preview is the player auto-pick then drafts, with a reason from the factors used", () => {
    const reasons = new Set<string>();
    let states = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rng = Rng.fromSeed(1000 + seed);
      const roll = (n: number): number => Math.floor(rng.nextFloat() * n);
      let s = toUser(newFranchise(data, seed, "T00", 1 + roll(32)));
      for (let k = 0; k < 5; k++) {
        // Skip ahead a seeded number of user turns, by hand or by auto-pick, then mark some targets.
        for (let skip = roll(11); skip > 0 && s.phase === "draft"; skip--) {
          const v = openView(s);
          s = toUser(roll(2) === 0 ? must(autoPick(s, data)).state : must(makePick(s, data, v.legal[roll(Math.min(v.legal.length, 200))] as string)));
        }
        if (s.phase !== "draft") break;
        const v = openView(s);
        for (let t = roll(4); t > 0; t--) s = must(setTarget(s, (v.available[roll(Math.min(v.available.length, 400))] as { id: string }).id, true));
        const preview = autoPickPreview(s, data);
        const made = must(autoPick(s, data));
        if (preview === null) throw new Error(`seed ${seed}: no preview with the user on the clock`);
        expect(preview.playerId, `seed ${seed} state ${k}`).toBe(made.pick.playerId);
        expect(preview).toMatchObject({ name: made.pick.name, position: made.pick.position, overall: made.pick.overall, overallPick: made.pick.overallPick, userOnClock: true });
        // The reason and its numbers are the model's own.
        const rule = v.onClock.positions[preview.position];
        expect(preview).toMatchObject({ count: rule.count, min: rule.min, target: rule.target, use: rule.use, neededToStart: Math.max(0, rule.min - rule.count), neededToTarget: Math.max(0, rule.target - rule.count) });
        expect(preview.need).toBe(needBonus(rule, data.draftAi.slotNeed));
        // The value is the auto-pick style's tilt x positionValue x overall, or the tilt x the value curve where one is set.
        const tilt = data.draftAi.styles[data.draftAi.autoPick.style]?.value?.[preview.position] ?? 1;
        const curve = data.draftAi.valueCurve?.[preview.position];
        expect(preview.value).toBeCloseTo(curve === undefined ? tilt * data.draftAi.positionValue[preview.position] * preview.overall : tilt * curveValue(curve, preview.overall), 10);
        expect(preview.score).toBeCloseTo(preview.value + preview.need + preview.noise, 10);
        expect(preview.noise).toBe(0); // autoPick reads the board as shown
        if (preview.reason === "target") {
          expect(s.draft.targets).toContain(preview.playerId);
          expect(preview.use).not.toBe("extra");
        } else {
          expect(preview.reason).toBe(preview.need > 0 ? (preview.use === "starter" ? "needStarter" : "needDepth") : "bestAvailable");
          // No usable legal target was passed over.
          for (const id of s.draft.targets) {
            const p = v.available.find((a) => a.id === id);
            expect(p === undefined || !p.legal || p.use === "extra", `seed ${seed}: target ${id} was usable`).toBe(true);
          }
        }
        const best = v.available.find((a) => a.legal && a.position === preview.position);
        expect(preview.bestAtPosition).toBe(best?.id === preview.playerId);
        reasons.add(preview.reason);
        states++;
        s = toUser(made.state);
      }
    }
    expect(states).toBe(200);
    expect([...reasons].sort()).toEqual(["needDepth", "needStarter", "target"]);
  }, 120_000);

  it("bestAvailable: when no need bonus applied, the reason does not claim one", () => {
    // With the shipped weights an open slot always carries a bonus, so the plain case needs a team at its targets or no need weights.
    const flat = { ...data, draftAi: { ...data.draftAi, slotNeed: NO_NEED } };
    const s = must(runDraft(newFranchise(flat, 78, "T00", 1), flat)).state;
    const preview = autoPickPreview(s, flat) as AutoPickPreview;
    expect(preview).toMatchObject({ reason: "bestAvailable", need: 0, use: "starter", userOnClock: true });
    expect(must(autoPick(s, flat)).pick.playerId).toBe(preview.playerId);
    // The same state with the shipped weights names the need that applied.
    expect((autoPickPreview(s, data) as AutoPickPreview).reason).toBe("needStarter");
  });

  it("off the clock it is the pick as the board stands, with the user's next pick number; null once the user has no pick left", () => {
    const start = newFranchise(data, 76, "T00", 9);
    const off = autoPickPreview(start, data) as AutoPickPreview;
    expect(off).toMatchObject({ userOnClock: false, overallPick: 9 });
    expect(openView(start).available.find((p) => p.id === off.playerId)).toBeDefined();
    const done = allAiDraft(data, 76);
    expect(autoPickPreview(done, data)).toBeNull();
    // The user's last pick is made; the draft is still open for the teams behind him.
    const firstSlot = must(setAutoDraft(newFranchise(data, 76, "T00", 1), true));
    const after = must(runDraft(firstSlot, data, { maxPicks: 1665 })).state;
    expect(after.phase).toBe("draft");
    expect((after.rosters["T00"] as string[]).length).toBe(53);
    expect(autoPickPreview(after, data)).toBeNull();
    expect(draftView(after, data)).toMatchObject({ picksUntilUser: null, userNextPick: null, userPicksMade: 53 });
  }, 30_000);

  it("does not change the state", () => {
    const s = toUser(newFranchise(data, 77, "T00", 2));
    const before = clone(s);
    autoPickPreview(s, data);
    draftView(s, data);
    expect(s).toEqual(before);
  });
});
