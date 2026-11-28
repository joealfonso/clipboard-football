// The approved additions to B: targets, the user's auto-pick with targets, autoPickPreview.

import { describe, expect, it } from "vitest";
import type { FranchiseData, FranchiseState, PoolPlayer } from "../../../shared/src/franchise";
import { autoPick, autoPickPreview, draftView, legalPicks, makePick, runDraft, setAutoDraft, setTarget } from "../../src/franchise";
import { create, deepFreeze, errorCode, flatAi, forge, onClock, othersFill, playDraft, prng, SCRIPTS, smallData, specBlocked, specLimits, teamCounts, undrafted, value, withAi, withOveralls } from "./spec-support";
import type { Position } from "./spec-support";

const small = smallData();
const flat = withAi(small, flatAi(small)); // score is overall, no need bonus, no error

function mark(s: FranchiseState, ...ids: readonly string[]): FranchiseState {
  return ids.reduce((acc, id) => value(setTarget(acc, id, true)), s);
}

/** The n-th undrafted player at a position, in id order. */
function at(s: FranchiseState, position: Position, n = 0): string {
  return (undrafted(s).filter((p) => p.position === position).sort((a, b) => (a.id < b.id ? -1 : 1))[n] as PoolPlayer).id;
}

function ratings(s: FranchiseState, set: Readonly<Record<string, number>>, rest = 50): FranchiseState {
  return withOveralls(s, (p) => set[p.id] ?? rest);
}

describe("setTarget", () => {
  it("returns a new state with the player marked, and leaves the old one alone", () => {
    const s = deepFreeze(create(small, 1, 1));
    const id = at(s, "QB");
    const t = value(setTarget(s, id, true));
    expect(t.draft.targets).toEqual([id]);
    expect(s.draft.targets).toEqual([]);
    expect({ ...t, draft: { ...t.draft, targets: [] } }).toStrictEqual(s);
    expect(value(setTarget(t, id, false))).toStrictEqual(s);
  });
  it("marking twice keeps one; unmarking an unmarked player changes nothing", () => {
    const s = create(small, 1, 1);
    const id = at(s, "WR");
    expect(value(setTarget(mark(s, id), id, true)).draft.targets).toEqual([id]);
    expect(value(setTarget(s, id, false))).toStrictEqual(s);
  });
  it("unmarking one leaves the rest", () => {
    const s = create(small, 1, 1);
    const [a, b, c] = [at(s, "WR"), at(s, "QB"), at(s, "S")];
    expect([...value(setTarget(mark(s, a, b, c), b, false)).draft.targets].sort()).toEqual([a, c].sort());
  });
  it("unknown id and drafted player: typed errors", () => {
    const s = value(runDraft(create(small, 1, 2), small)).state;
    const taken = s.draft.picks[0]?.playerId as string;
    for (const on of [true, false]) expect(setTarget(s, "P9999", on)).toEqual({ ok: false, error: { code: "unknownPlayer", playerId: "P9999" } });
    expect(setTarget(s, taken, true)).toEqual({ ok: false, error: { code: "alreadyDrafted", playerId: taken } });
  });
  it("can be set while another team is on the clock", () => {
    const s = create(small, 1, 4);
    expect(onClock(s)).not.toBe("T00");
    expect(errorCode(setTarget(s, at(s, "K"), true))).toBeNull();
  });
  it("the view carries the saved targets", () => {
    const s = create(small, 1, 1);
    const ids = [at(s, "S"), at(s, "QB")];
    expect([...draftView(mark(s, ...ids), small).user.targets].sort()).toEqual([...ids].sort());
  });
});

// Revision 2026-11-24 (Targets): a drafted target used to leave the list, now he stays in it.
describe("a drafted target stays in the list and leaves targetsAvailable", () => {
  it("drafted by the user's hand pick, by auto-pick, by another team and by auto-draft", () => {
    const s = create(small, 2, 1);
    const [a, b] = [at(s, "QB"), at(s, "QB", 1)];
    const hand = value(makePick(mark(s, a, b), small, a));
    expect(hand.draft.targets).toEqual([a, b]);
    expect(draftView(hand, small).user).toMatchObject({ targets: [a, b], targetsAvailable: [b] });
    const auto = value(autoPick(mark(s, a), small));
    expect(auto.pick.playerId).toBe(a);
    expect(auto.state.draft.targets).toEqual([a]);
    expect(draftView(auto.state, small).user).toMatchObject({ targets: [a], targetsAvailable: [] });
    const s4 = create(small, 2, 4);
    const doomed = value(runDraft(s4, small)).picks.map((p) => p.playerId);
    const after = value(runDraft(mark(s4, ...doomed, a), small)).state;
    const listed = doomed.includes(a) ? doomed : [...doomed, a];
    expect(doomed).toHaveLength(3);
    expect(after.draft.targets).toEqual(listed);
    expect(draftView(after, small).user.targetsAvailable).toEqual(doomed.includes(a) ? [] : [a]);
    const end = value(runDraft(value(setAutoDraft(mark(s, ...s.players.slice(0, 120).map((p) => p.id)), true)), small)).state;
    const drafted = new Set(end.draft.picks.map((p) => p.playerId));
    const marked = s.players.slice(0, 120).map((p) => p.id);
    expect(marked.some((id) => drafted.has(id))).toBe(true);
    expect(end.draft.targets).toEqual(marked);
    expect(draftView(end, small).user.targetsAvailable).toEqual(marked.filter((id) => !drafted.has(id)));
  });
});

describe("the user's auto-pick with targets (hand-set overalls, score = overall)", () => {
  const base = create(flat, 3, 1);
  it("takes the highest-overall target over a better untargeted player, whatever order they were marked", () => {
    const [star, hi, lo] = [at(base, "QB"), at(base, "WR"), at(base, "TE")];
    const s = ratings(base, { [star]: 99, [hi]: 70, [lo]: 65 });
    for (const m of [mark(s, hi, lo), mark(s, lo, hi)]) {
      expect(autoPickPreview(m, flat)).toMatchObject({ playerId: hi, reason: "target" });
      const r = value(autoPick(m, flat));
      expect(r.pick).toMatchObject({ playerId: hi, by: "auto" });
    }
    expect(value(autoPick(s, flat)).pick.playerId).toBe(star);
  });
  // Revision 2026-11-24 (Targets): auto-pick took the highest score, now the highest overall, ties by id.
  it("highest overall, not best scoring: position value, need and style do not count", () => {
    const tilted = flatAi(small, { TE: 2 });
    const d = withAi(small, { ...tilted, slotNeed: { ...tilted.slotNeed, TE: [40, 40, 40] }, styles: { plain: { weight: 1, value: { TE: 1.5 }, need: 3 } } });
    const [wr, te] = [at(base, "WR"), at(base, "TE")];
    expect(value(autoPick(mark(ratings(base, { [wr]: 70, [te]: 45 }), te, wr), d)).pick.playerId).toBe(wr);
  });
  it("level targets: the lower id", () => {
    const [a, b] = [at(base, "CB"), at(base, "QB")].sort() as [string, string];
    const s = ratings(base, {});
    for (const m of [mark(s, a, b), mark(s, b, a)]) expect(value(autoPick(m, flat)).pick.playerId).toBe(a);
  });

  // The user holds 2 quarterbacks (min 1, target 2, max 3): another is extra. Slot 1 turns at index 0, 7, 8.
  const qbs = (n: number): FranchiseState => forge(create(flat, 3, 1), [0, 7, 8, 15][n] as number, othersFill(flat, () => "QB"));
  it("a depth target counts", () => {
    const s0 = qbs(1);
    const [q, star] = [at(s0, "QB"), at(s0, "WR")];
    const s = mark(ratings(s0, { [q]: 60, [star]: 99 }), q);
    expect(autoPickPreview(s, flat)).toMatchObject({ playerId: q, reason: "target", use: "depth" });
    expect(value(autoPick(s, flat)).pick.playerId).toBe(q);
  });
  it("an extra target is passed over for the plain policy", () => {
    const s0 = qbs(2);
    const [q, star] = [at(s0, "QB"), at(s0, "WR")];
    const s = mark(ratings(s0, { [q]: 90, [star]: 99 }), q);
    expect(autoPickPreview(s, flat)?.reason).not.toBe("target");
    expect(value(autoPick(s, flat)).pick.playerId).toBe(star);
  });
  it("an extra target with the higher overall loses to a depth or starter target", () => {
    const s0 = qbs(2);
    const [q, te, star] = [at(s0, "QB"), at(s0, "TE"), at(s0, "WR")];
    expect(value(autoPick(mark(ratings(s0, { [q]: 95, [te]: 40, [star]: 99 }), q, te), flat)).pick.playerId).toBe(te);
  });
  it("an extra target the plain policy would take anyway is not credited to the mark", () => {
    const s0 = qbs(2);
    const q = at(s0, "QB");
    const s = mark(ratings(s0, { [q]: 99 }), q);
    expect(value(autoPick(s, flat)).pick.playerId).toBe(q);
    expect(autoPickPreview(s, flat)?.reason).not.toBe("target");
  });
  it("an illegal target is passed over (quarterback at max 3)", () => {
    const s0 = qbs(3);
    const [q, star] = [at(s0, "QB"), at(s0, "WR")];
    const s = mark(ratings(s0, { [q]: 99, [star]: 98 }), q);
    expect(value(autoPick(s, flat)).pick.playerId).toBe(star);
  });
  it("auto-draft takes targets too", () => {
    const [star, hi, lo] = [at(base, "QB"), at(base, "WR"), at(base, "TE")];
    const s = value(setAutoDraft(mark(ratings(base, { [star]: 99, [hi]: 45, [lo]: 40 }), lo, hi), true));
    expect(value(runDraft(s, flat, { maxPicks: 1 })).picks[0]).toMatchObject({ playerId: hi, by: "auto" });
    const toNext = value(runDraft(s, flat, { maxPicks: 8 })); // picks 1 and 8 are the user's
    expect(toNext.picks[7]).toMatchObject({ teamId: "T00", playerId: lo, by: "auto" });
  });
});

/** Every seeded state the properties below run on: user turns of scripted drafts, with random marks. */
function turns(data: FranchiseData, seeds: number, visit: (marked: FranchiseState, plain: FranchiseState) => void): number {
  let n = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const rand = prng(seed);
    const script = [SCRIPTS.random, SCRIPTS.hoard, SCRIPTS.worst, SCRIPTS.kickers][seed % 4] as (typeof SCRIPTS)["random"];
    const r = playDraft(data, seed, script, {
      onUserTurn: (s) => {
        n++;
        const free = undrafted(s);
        const count = Math.floor(rand() * 6);
        visit(mark(s, ...Array.from({ length: count }, () => (free[Math.floor(rand() * free.length)] as PoolPlayer).id)), s);
      },
    });
    expect(r.failure).toBeNull();
  }
  return n;
}

describe("properties over seeded states, shipped AI numbers", () => {
  it("the preview is what auto-pick then drafts, and auto-draft agrees; it is never null on the clock", () => {
    let targeted = 0;
    const n = turns(small, 24, (s) => {
      const before = structuredClone(s);
      const preview = autoPickPreview(s, small);
      expect(preview).not.toBeNull();
      expect(s).toStrictEqual(before);
      const picked = value(autoPick(s, small));
      expect(picked.pick.playerId).toBe(preview?.playerId);
      expect(picked.pick).toMatchObject({ position: preview?.position, overall: preview?.overall, name: preview?.name, overallPick: preview?.overallPick });
      expect(preview?.userOnClock).toBe(true);
      expect(value(runDraft(value(setAutoDraft(s, true)), small, { maxPicks: 1 })).picks[0]?.playerId).toBe(preview?.playerId);
      if (preview?.reason === "target") targeted++;
    });
    expect(n).toBe(24 * 37);
    expect(targeted).toBeGreaterThan(100);
  });

  it("takes a usable target whenever there is one, else exactly the plain AI policy's pick; the reason matches", () => {
    const limits = specLimits(small);
    let fell = 0;
    turns(small, 24, (s, plain) => {
      const blocked = specBlocked(s, small, "T00");
      const counts = teamCounts(s, "T00");
      const pos = new Map(s.players.map((p) => [p.id, p.position]));
      const usable = s.draft.targets.filter((id) => blocked[pos.get(id) as Position].length === 0 && counts[pos.get(id) as Position] < limits[pos.get(id) as Position].target);
      const preview = autoPickPreview(s, small);
      const p = preview?.position as Position;
      expect(preview).toMatchObject({ count: counts[p], min: limits[p].min, target: limits[p].target, neededToStart: Math.max(0, limits[p].min - counts[p]), neededToTarget: Math.max(0, limits[p].target - counts[p]) });
      if (usable.length > 0) {
        expect(usable).toContain(preview?.playerId);
        expect(preview?.reason).toBe("target");
      } else {
        fell++;
        expect(preview?.playerId).toBe(autoPickPreview(plain, small)?.playerId);
        expect(preview?.reason).toBe(counts[p] < limits[p].min ? "needStarter" : counts[p] < limits[p].target ? "needDepth" : "bestAvailable");
      }
    });
    expect(fell).toBeGreaterThan(50);
  });

  it("off the clock the preview is still a legal pick for the user, and null only once no legal pick exists", () => {
    let s = create(small, 7, 2);
    while (s.phase === "draft") {
      const left = s.draft.slots.slice(s.draft.picks.length).includes("T00");
      const preview = autoPickPreview(s, small);
      if (left) {
        expect(preview, `pick ${s.draft.picks.length + 1}`).not.toBeNull();
        expect(preview?.userOnClock).toBe(onClock(s) === "T00");
        expect(specBlocked(s, small, "T00")[preview?.position as Position]).toEqual([]);
      } else expect(preview).toBeNull();
      s = onClock(s) === "T00" ? value(autoPick(s, small)).state : value(runDraft(s, small, { maxPicks: 1 })).state;
    }
    expect(autoPickPreview(s, small)).toBeNull();
  });

  it("AI teams' picks are identical with and without user targets", () => {
    for (let seed = 1; seed <= 8; seed++) {
      let plain = create(small, seed, (seed % 4) + 1);
      let marked = mark(plain, ...plain.players.filter((_, i) => i % 3 === 0).map((p) => p.id));
      while (plain.phase === "draft") {
        if (onClock(plain) === "T00") {
          const legal = value(legalPicks(plain, small)).legal;
          const id = legal[(seed * 5) % legal.length] as string;
          plain = value(makePick(plain, small, id));
          marked = value(makePick(marked, small, id));
        } else {
          const [a, b] = [value(runDraft(plain, small)), value(runDraft(marked, small))];
          expect(b.picks).toStrictEqual(a.picks);
          plain = a.state;
          marked = b.state;
        }
      }
      expect({ ...marked, draft: { ...marked.draft, targets: [] } }).toStrictEqual(plain);
    }
  });
});
