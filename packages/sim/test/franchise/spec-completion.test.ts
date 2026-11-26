// The ruling of 2026-11-24 in docs/specs/m4-franchise-core.md: legal picks rule 4, after the pick a
// completion must exist for every team. The oracle (spec-support: completionExists) is the cut
// condition; it is itself held to a brute-force search here. Tiny leagues, no surplus, tight maximums.

import { describe, expect, it } from "vitest";
import { parseFranchiseData } from "../../../shared/src/franchise-schema";
import type { FranchiseData, FranchiseState } from "../../../shared/src/franchise";
import { autoPick, legalPicks, makePick, runDraft, setAutoDraft } from "../../src/franchise";
import { boardOrder, completionExists, create, deepFreeze, draftedIds, endProblems, errorCode, flatAi, forge, gameData, onClock, pinnedData, playDraft, POSITIONS, prng, rawFiles, rosterFiles, SCRIPTS, smallData, smallLeague, SPEC_MIN, specBlocked, specCompletion, specLegalIds, undrafted, value, withAi } from "./spec-support";
import type { Position } from "./spec-support";

/** A league of 2, 3 or 4 teams whose rosters are the minimums plus `extra`, with `room` above the target, no surplus. */
function tiny(teams: number, extra: Partial<Record<Position, number>>, room: Partial<Record<Position, number>>, surplus = 0): FranchiseData {
  const target = Object.fromEntries(POSITIONS.map((p) => [p, SPEC_MIN[p] + (extra[p] ?? 0)])) as Record<Position, number>;
  const max = Object.fromEntries(POSITIONS.map((p) => [p, target[p] + (room[p] ?? 0)])) as Record<Position, number>;
  const raw = rawFiles();
  const conferences = Array.from({ length: teams === 4 ? 2 : 1 }, (_, i) => ({ id: `c${i}`, name: `Test Conference ${i}` }));
  const league = { ...smallLeague(), conferences, divisions: ["Only"], teamsPerDivision: teams / conferences.length };
  const size = POSITIONS.reduce((s, p) => s + target[p], 0);
  return parseFranchiseData({ ...raw, league, ...rosterFiles(size, target, max), pool: { ...raw.pool, surplus } }, gameData());
}

function anyAt(s: FranchiseState, position: Position): string {
  return (undrafted(s).find((p) => p.position === position) as { id: string }).id;
}

describe("the oracle itself", () => {
  /** Tries every way to fill every team, one pick at a time. */
  function search(limits: readonly { min: number; max: number }[], counts: number[][], left: number[], avail: number[]): boolean {
    const t = left.findIndex((x) => x > 0);
    if (t < 0) return counts.every((c) => c.every((x, p) => x >= (limits[p] as { min: number }).min && x <= (limits[p] as { max: number }).max));
    for (let p = 0; p < limits.length; p++) {
      const c = counts[t] as number[];
      if ((avail[p] as number) === 0 || (c[p] as number) >= (limits[p] as { max: number }).max) continue;
      c[p] = (c[p] as number) + 1;
      avail[p] = (avail[p] as number) - 1;
      left[t] = (left[t] as number) - 1;
      const found = search(limits, counts, left, avail);
      c[p] = (c[p] as number) - 1;
      avail[p] = (avail[p] as number) + 1;
      left[t] = (left[t] as number) + 1;
      if (found) return true;
    }
    return false;
  }
  it("agrees with brute force on 1,500 random small boards, both answers common", () => {
    const rand = prng(41);
    const int = (n: number): number => Math.floor(rand() * n);
    let yes = 0;
    for (let k = 0; k < 1500; k++) {
      const limits = Array.from({ length: 3 }, () => {
        const min = int(2);
        return { min, max: min + int(3) };
      });
      const counts = Array.from({ length: 3 }, () => limits.map((l) => int(l.max + 1)));
      const left = counts.map(() => int(3));
      const avail = limits.map(() => int(6));
      const got = completionExists(limits, counts, left, avail);
      expect(got, JSON.stringify({ limits, counts, left, avail })).toBe(search(limits, structuredClone(counts), [...left], [...avail]));
      if (got) yes++;
    }
    expect(yes).toBeGreaterThan(200);
    expect(yes).toBeLessThan(1300);
  });
});

describe("rule 4 by hand: two teams, two spare picks each, the pool holds 4 quarterbacks and 4 backs", () => {
  // Minimum 1 each. If the user takes 3 quarterbacks, the other team keeps its 1 and has to spend
  // both spares on backs: it can with a maximum of 3 backs, and cannot with 2.
  const tight = tiny(2, { QB: 1, RB: 1 }, { QB: 1 });
  const loose = tiny(2, { QB: 1, RB: 1 }, { QB: 1, RB: 1 });
  /** The user (slot 1, turns at indexes 0, 3, 4) holds 2 quarterbacks and is on the clock. */
  const twoQbs = (d: FranchiseData): FranchiseState => forge(create(d, 5, 1), 4, (c) => (c.isUser ? "QB" : c.teamPickNo === 0 ? "K" : "P"));

  it("the fixture: 35-player rosters, 4 of each in the pool, rules 1 to 3 all allow the third quarterback", () => {
    const s = create(tight, 5, 1);
    expect(tight.roster.rosterSize).toBe(35);
    for (const p of ["QB", "RB"] as const) expect(s.players.filter((x) => x.position === p)).toHaveLength(4);
    expect(specBlocked(twoQbs(tight), tight, "T00").QB).toEqual(["completionExists"]);
    expect(specBlocked(twoQbs(loose), loose, "T00").QB).toEqual([]);
  });
  it("blocks it for the other team's sake, names completionExists, and leaves the state unchanged", () => {
    const s = deepFreeze(twoQbs(tight));
    const before = structuredClone(s);
    const id = anyAt(s, "QB");
    expect(makePick(s, tight, id)).toEqual({ ok: false, error: { code: "illegalPick", playerId: id, position: "QB", rule: "completionExists" } });
    expect(s).toStrictEqual(before);
    const lp = value(legalPicks(s, tight));
    expect(lp.positions.QB).toMatchObject({ legal: false, blockedBy: "completionExists" });
    expect(lp.legal).not.toContain(id);
    expect(lp.blocked).toContainEqual({ playerId: id, position: "QB", rule: "completionExists" });
    expect(lp.legal).toEqual(specLegalIds(s, tight, "T00"));
  });
  it("allows it when the other team may hold three backs", () => {
    const s = twoQbs(loose);
    expect(errorCode(makePick(s, loose, anyAt(s, "QB")))).toBeNull();
  });
  it("binds AI teams and auto-pick too: both would take the quarterback", () => {
    const d = withAi(tight, flatAi(tight, { QB: 5 }));
    const s = twoQbs(d);
    expect(value(autoPick(s, d)).pick.position).not.toBe("QB");
    // The same seat played by the AI: the user sits in slot 2 and holds K and P, the rival 2 quarterbacks.
    const ai = forge(create(d, 5, 2), 4, (c) => (c.isUser ? (c.teamPickNo === 0 ? "K" : "P") : "QB"));
    expect(onClock(ai)).not.toBe("T00");
    expect(value(runDraft(ai, d, { maxPicks: 1 })).picks[0]?.position).not.toBe("QB");
  });
  it("a state already past saving (the third quarterback forged): every pick action is a typed error, nothing throws or moves", () => {
    const s = deepFreeze(forge(twoQbs(tight), 1, () => "QB"));
    const mine = { ...s, draft: { ...s.draft, autoDraft: true } };
    expect(specCompletion(s, tight, null, null)).toBe(false);
    expect(value(legalPicks(s, tight)).legal).toEqual([]);
    for (const act of [() => runDraft(s, tight), () => runDraft(mine, tight)]) expect(act().ok).toBe(false);
    // Two slots later it is the user's turn (he owns picks 5, 8, 9): forge the rival's two as well.
    const turn = deepFreeze(forge(s, 2, () => "S"));
    expect(onClock(turn)).toBe("T00");
    expect(makePick(turn, tight, anyAt(turn, "K")).ok).toBe(false);
    expect(autoPick(turn, tight).ok).toBe(false);
  });
  it("a rule 1 block keeps its name where rule 4 blocks as well", () => {
    // Both teams hold 2 backs, the maximum, so a third is out by rule 1 and no completion has one either.
    const s = forge(create(tight, 5, 1), 4, (c) => (c.isUser ? "RB" : c.teamPickNo === 0 ? "K" : "P"));
    expect(specCompletion(s, tight, "T00", "RB")).toBe(false);
    expect(value(legalPicks(s, tight)).positions.RB.blockedBy).toBe("positionMax");
  });
});

describe("legal picks against the four-rule oracle, random tiny leagues with no surplus", () => {
  /** Two to five spare slots over random positions, random room above some targets. */
  function randomLeague(k: number): FranchiseData {
    const rand = prng(900 + k);
    const some = (n: number, most: number): Partial<Record<Position, number>> => {
      const out: Partial<Record<Position, number>> = {};
      for (let i = 0; i < n; i++) {
        const p = POSITIONS[Math.floor(rand() * POSITIONS.length)] as Position;
        out[p] = Math.min(most, (out[p] ?? 0) + 1);
      }
      return out;
    };
    const d = tiny(2 + (k % 3), some(2 + Math.floor(rand() * 4), 3), some(2 + Math.floor(rand() * 3), 2));
    // AI teams that want the same few positions first, so the spare picks collide.
    const want = Object.fromEntries(POSITIONS.map((p) => [p, rand() < 0.4 ? 4 : 1]));
    return withAi(d, flatAi(d, want));
  }

  it("the same set and, when rule 4 alone blocks, the same name, for the team on the clock and some others, at every pick of 16 drafts", () => {
    let alone = 0;
    let checked = 0;
    for (let k = 0; k < 16; k++) {
      const d = randomLeague(k);
      const rand = prng(k);
      let s = create(d, k + 1);
      while (s.phase === "draft") {
        for (const t of s.teams) {
          if (t.id !== onClock(s) && rand() < 0.85) continue;
          const oracle = specBlocked(s, d, t.id);
          const lp = value(legalPicks(s, d, t.id));
          for (const p of POSITIONS) {
            const left = undrafted(s).some((x) => x.position === p);
            const got = lp.positions[p].blockedBy;
            if (left) {
              expect(got === null, `league ${k} pick ${s.draft.picks.length + 1} ${t.id} ${p}: ${String(got)} against ${oracle[p].join()}`).toBe(oracle[p].length === 0);
              if (got !== null) expect(oracle[p]).toContain(got);
              if (oracle[p][0] === "completionExists") alone++;
              checked++;
            }
          }
          if (t.id === onClock(s)) expect(lp.legal).toEqual(boardOrder(undrafted(s), d.overallWeights).filter((x) => oracle[x.position].length === 0).map((x) => x.id));
        }
        if (onClock(s) === "T00") {
          const { legal } = value(legalPicks(s, d));
          expect(legal.length, `league ${k} pick ${s.draft.picks.length + 1}: the user has a legal pick`).toBeGreaterThan(0);
          s = value(makePick(s, d, legal[Math.floor(rand() * legal.length)] as string));
        } else s = value(runDraft(s, d, { maxPicks: 1 })).state;
        if (s.phase === "draft") expect(specCompletion(s, d, null, null), `league ${k}: a completion exists after pick ${s.draft.picks.length}`).toBe(true);
      }
      expect(endProblems(s, d)).toEqual([]);
    }
    expect(checked).toBeGreaterThan(20_000);
    expect(alone).toBeGreaterThan(100);
  });
});

describe("B3 and B4 at surplus 0 with need weights 0 (the ruling): no dead end", () => {
  const noNeed = (d: FranchiseData): FranchiseData => ({ ...d, pool: { ...d.pool, surplus: 0 }, draftAi: { ...d.draftAi, slotNeed: flatAi(d).slotNeed } });
  const small = noNeed(smallData());
  const big = noNeed(pinnedData());
  it("the pool is exactly the rosters, and the need lists are zero", () => {
    expect(create(big, 1).players).toHaveLength(1696);
    expect(POSITIONS.every((p) => big.draftAi.slotNeed[p].every((x) => x === 0))).toBe(true);
  });
  it.each([["4 teams", small, 40], ["32 teams", big, 1]] as const)("%s, all AI: everyone is drafted, every roster legal", (_n, d, seeds) => {
    for (let seed = 1; seed <= seeds; seed++) {
      const { state } = value(runDraft(value(setAutoDraft(create(d, seed), true)), d));
      expect(endProblems(state, d), `seed ${seed}`).toEqual([]);
      expect(draftedIds(state).size).toBe(state.players.length);
    }
  });
  it.each(Object.entries(SCRIPTS))("a user who picks: %s", (_n, script) => {
    for (const [d, seeds] of [[small, 20], [big, script === SCRIPTS.hoard ? 1 : 0]] as const) {
      for (let seed = 1; seed <= seeds; seed++) {
        const r = playDraft(d, seed, script);
        expect(r.failure, `seed ${seed}`).toBeNull();
        expect(endProblems(r.state, d), `seed ${seed}`).toEqual([]);
      }
    }
  });
});

describe("a save whose roster.json changed (Hash rule: it still loads)", () => {
  const old = smallData(); // 37 slots a team
  const raw = rawFiles();
  const reroster = (size: number, target: Record<Position, number>, max: Record<Position, number>): FranchiseData => parseFranchiseData({ ...raw, league: smallLeague(), ...rosterFiles(size, target, max), pool: { ...raw.pool, surplus: 0.1 } }, gameData());
  const target = Object.fromEntries(POSITIONS.map((p) => [p, old.roster.positions[p].target])) as Record<Position, number>;
  const max = Object.fromEntries(POSITIONS.map((p) => [p, old.roster.positions[p].max])) as Record<Position, number>;
  const saved = playTo(60);
  function playTo(picks: number): FranchiseState {
    return value(runDraft(value(setAutoDraft(create(old, 9, 2), true)), old, { maxPicks: picks })).state;
  }

  it.each([["two more roster spots", reroster(39, { ...target, DL: 6, LB: 5 }, max)], ["two fewer", reroster(35, { ...target, WR: 4, OL: 6 }, max)]] as const)("%s: picks are counted from the slots the team owns, the legal set matches the oracle, and the draft ends", (_n, d) => {
    expect(POSITIONS.reduce((n, p) => n + d.roster.positions[p].target, 0)).not.toBe(37);
    let s: FranchiseState = { ...saved, draft: { ...saved.draft, autoDraft: false } };
    let n = 0;
    while (s.phase === "draft" && n++ < 148) {
      const team = onClock(s) as string;
      expect(value(legalPicks(s, d)).legal, `pick ${s.draft.picks.length + 1}`).toEqual(specLegalIds(s, d, team));
      s = team === "T00" ? value(autoPick(s, d)).state : value(runDraft(s, d, { maxPicks: 1 })).state;
    }
    expect(s.draft.picks).toHaveLength(148);
    for (const t of s.teams) expect(s.rosters[t.id]).toHaveLength(37);
    expect(endProblems(s, d).filter((x) => !x.includes("players"))).toEqual([]);
  });

  it("a maximum a roster is already over: typed errors, no throw, nothing half-applied", () => {
    const over = forge(create(old, 9, 1), 9, (c) => (c.isUser ? "QB" : POSITIONS[(c.teamPickNo % 9) + 1] as Position));
    const s = deepFreeze({ ...over, draft: { ...over.draft } });
    expect(s.rosters["T00"]).toHaveLength(3); // three quarterbacks, the old maximum
    const d = reroster(37, { ...target, QB: 1, RB: 3 }, { ...max, QB: 2 });
    expect(specCompletion(s, d, null, null)).toBe(false);
    const before = structuredClone(s);
    for (const act of [() => runDraft(s, d), () => makePick(s, d, anyAt(s, "WR")), () => autoPick(s, d), () => runDraft(value(setAutoDraft(s, true)), d)]) expect(act().ok).toBe(false);
    expect(s).toStrictEqual(before);
  });
});
