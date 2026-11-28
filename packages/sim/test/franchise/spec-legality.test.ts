// B2 from docs/specs/m4-franchise-core.md: one fixture per legality rule, each with the legal case
// one step away, plus the typed errors. Every refused action leaves the state deep-equal.
// Fixtures use the 4-team, 37-player data (see smallData) and forged picks.

import { describe, expect, it } from "vitest";
import type { FranchiseResult, FranchiseState } from "../../../shared/src/franchise";
import { autoPick, legalPicks, makePick, runDraft, setAutoDraft, setTarget } from "../../src/franchise";
import { create, deepFreeze, draftedIds, errorCode, forge, onClock, othersFill, playDraft, pinnedData, POSITIONS, SCRIPTS, smallData, specBlocked, specLegalIds, undrafted, value } from "./spec-support";
import type { Position } from "./spec-support";

const data = smallData();

function anyAt(s: FranchiseState, position: Position): string {
  return (undrafted(s).find((p) => p.position === position) as { id: string }).id;
}

/** Runs an action on a frozen state and checks that nothing in it changed. */
function unchanged<T>(s: FranchiseState, act: (frozen: FranchiseState) => T): T {
  const before = structuredClone(s);
  const out = act(deepFreeze(s));
  expect(s).toStrictEqual(before);
  return out;
}

function expectBlocked(s: FranchiseState, position: Position, rule: string): void {
  expect(onClock(s)).toBe(s.settings.userTeam);
  // The fixture breaks only this rule, by the independent reading of the spec.
  expect(specBlocked(s, data, "T00")[position]).toEqual([rule]);
  const id = anyAt(s, position);
  const r = unchanged(s, (f) => makePick(f, data, id));
  expect(r).toEqual({ ok: false, error: { code: "illegalPick", playerId: id, position, rule } });
  const lp = value(legalPicks(s, data));
  expect(lp.legal).not.toContain(id);
  expect(lp.blocked.find((b) => b.playerId === id)).toEqual({ playerId: id, position, rule });
  expect(lp.positions[position]).toMatchObject({ legal: false, blockedBy: rule });
}

function expectAllowed(s: FranchiseState, position: Position): void {
  const id = anyAt(s, position);
  expect(value(legalPicks(s, data)).legal).toContain(id);
  const next = value(makePick(s, data, id));
  expect(next.rosters["T00"]).toContain(id);
  expect(next.draft.picks.at(-1)).toMatchObject({ overallPick: s.draft.picks.length + 1, playerId: id, by: "user" });
}

// User in slot 1 of 4: turns at picks 1, 8, 9, 16, 17, so index 0, 7, 8, 15, 16.
const TURN = [0, 7, 8, 15, 16];

describe("rule 1, positionMax: the count afterwards is at most max (quarterback max 3)", () => {
  const script = othersFill(data, () => "QB");
  it("blocks a 4th quarterback", () => expectBlocked(forge(create(data, 1, 1), TURN[3] as number, script), "QB", "positionMax"));
  it("allows the 3rd", () => expectAllowed(forge(create(data, 1, 1), TURN[2] as number, script), "QB"));
});

describe("rule 2, minimumsReachable: enough picks left afterwards to reach every minimum", () => {
  // The user takes every minimum but the kicker and punter (31 picks), then extras at QB, RB, WR.
  const base: Position[] = POSITIONS.filter((p) => p !== "K" && p !== "P").flatMap((p) => Array.from({ length: { QB: 1, RB: 1, WR: 4, TE: 3, OL: 6, DL: 5, LB: 4, CB: 4, S: 3, K: 0, P: 0 }[p] }, () => p));
  const user = [...base, "QB", "RB", "WR", "OL"] as Position[];
  const script = othersFill(data, (c) => user[c.teamPickNo] as Position);
  // Slot 1 with 35 made: next is round 36 (even), the last pick of it, index 35*4 + 3 = 143.
  const twoLeft = (): FranchiseState => forge(create(data, 2, 1), 143, script);
  // Slot 1 with 34 made: round 35 (odd), first pick, index 136.
  const threeLeft = (): FranchiseState => forge(create(data, 2, 1), 136, script);

  it("with two picks left and K and P missing, everything else is blocked and named", () => {
    const s = twoLeft();
    expect(s.rosters["T00"]).toHaveLength(35);
    for (const p of POSITIONS) if (p !== "K" && p !== "P") expectBlocked(s, p, "minimumsReachable");
  });
  it("K and P are the only legal positions there", () => {
    const s = twoLeft();
    const lp = value(legalPicks(s, data));
    expect(POSITIONS.filter((p) => lp.positions[p].legal)).toEqual(["K", "P"]);
    expectAllowed(s, "K");
    expectAllowed(s, "P");
  });
  it("with three picks left one more extra is allowed", () => {
    const s = threeLeft();
    expect(s.rosters["T00"]).toHaveLength(34);
    expectAllowed(s, "DL");
    expectAllowed(s, "QB");
  });
});

describe("rule 3, poolCoversMinimums: the pool must still cover every team's unfilled minimums", () => {
  // The pool has ceil(4 x 1 x 1.1) = 5 kickers, minimum 1, max 2. Round 1: the user and one other
  // team take a kicker. With a second kicker for that team in round 2: 2 left, two teams short.
  const s0 = create(data, 4, 1);
  const rival = s0.draft.slots[1] as string;
  const order = ["DL", "LB", "CB", "S"] as Position[];
  function kickers(rivalTakes: number): FranchiseState {
    return forge(create(data, 4, 1), TURN[1] as number, (c) => (c.isUser ? "K" : c.team === rival && c.teamPickNo < rivalTakes ? "K" : (order[c.teamPickNo % 4] as Position)));
  }
  it("starts from a pool of 5 kickers", () => expect(s0.players.filter((p) => p.position === "K")).toHaveLength(5));
  it("blocks the user's 2nd kicker when the last 2 are needed by 2 other teams", () => {
    const s = kickers(2);
    expect(undrafted(s).filter((p) => p.position === "K")).toHaveLength(2);
    expectBlocked(s, "K", "poolCoversMinimums");
  });
  it("allows it when 3 are left for those 2 teams", () => {
    const s = kickers(1);
    expect(undrafted(s).filter((p) => p.position === "K")).toHaveLength(3);
    expectAllowed(s, "K");
  });
  it("a team that still needs its own kicker may take one of the last, though the pool is tight", () => {
    // The rival has 2 and a third team 1, so 2 are left for the 2 teams without one, the user being one of them.
    const s = forge(create(data, 4, 1), TURN[1] as number, (c) => (c.isUser ? "S" : c.team === rival ? (c.teamPickNo < 2 ? "K" : "DL") : c.team === s0.draft.slots[2] && c.teamPickNo === 0 ? "K" : "LB"));
    expect(undrafted(s).filter((p) => p.position === "K")).toHaveLength(2);
    expectAllowed(s, "K");
  });
});

describe("typed errors, never a throw, state unchanged", () => {
  it("out of turn: makePick and autoPick name the team on the clock", () => {
    const s = create(data, 6, 3);
    const id = anyAt(s, "QB");
    const error = { code: "notOnClock", onClock: s.draft.slots[0], userTeam: "T00" };
    expect(unchanged(s, (f) => makePick(f, data, id))).toEqual({ ok: false, error });
    expect(unchanged(s, (f) => autoPick(f, data))).toEqual({ ok: false, error });
  });
  it("a drafted player", () => {
    const s = value(runDraft(create(data, 6, 3), data)).state;
    const taken = s.draft.picks[0]?.playerId as string;
    expect(unchanged(s, (f) => makePick(f, data, taken))).toEqual({ ok: false, error: { code: "alreadyDrafted", playerId: taken } });
  });
  it.each(["", "P9999", "p0001", "__proto__", "constructor", "toString", "hasOwnProperty"])("an unknown id: %j", (id) => {
    const s = create(data, 6, 1);
    expect(unchanged(s, (f) => makePick(f, data, id))).toEqual({ ok: false, error: { code: "unknownPlayer", playerId: id } });
    expect(unchanged(s, (f) => setTarget(f, id, true))).toEqual({ ok: false, error: { code: "unknownPlayer", playerId: id } });
  });
  it("a finished draft refuses every draft action", () => {
    const done = playDraft(data, 8, SCRIPTS.random);
    expect(done.failure).toBeNull();
    const s = done.state;
    const free = undrafted(s)[0]?.id as string;
    const acts: readonly ((f: FranchiseState) => FranchiseResult<unknown>)[] = [
      (f: FranchiseState) => makePick(f, data, free),
      (f: FranchiseState) => makePick(f, data, "nobody"),
      (f: FranchiseState) => autoPick(f, data),
      (f: FranchiseState) => runDraft(f, data),
      (f: FranchiseState) => legalPicks(f, data),
      (f: FranchiseState) => setTarget(f, free, true),
      (f: FranchiseState) => setAutoDraft(f, true),
    ];
    for (const act of acts) {
      const r = unchanged(s, act);
      expect(r.ok, String(act)).toBe(false);
      expect(["notDraftPhase", "draftComplete"]).toContain(errorCode(r));
    }
  });
  it("a bad maxPicks", () => {
    const s = create(data, 6, 3);
    for (const maxPicks of [-1, 1.5, Number.NaN]) expect(errorCode(unchanged(s, (f) => runDraft(f, data, { maxPicks })))).toBe("badLimit");
  });
  it("an unknown team id for legalPicks", () => expect(errorCode(legalPicks(create(data, 1), data, "T99"))).toBe("unknownTeam"));
});

describe("legalPicks against an independent reading of the three rules", () => {
  function check(d: ReturnType<typeof smallData>, s: FranchiseState): void {
    const team = onClock(s) as string;
    const oracle = specBlocked(s, d, team);
    const lp = value(legalPicks(s, d));
    expect(lp.teamId).toBe(team);
    expect(lp.legal).toEqual(specLegalIds(s, d, team));
    for (const p of POSITIONS) if (oracle[p].length > 0) expect(oracle[p]).toContain(lp.positions[p].blockedBy);
    const taken = draftedIds(s);
    expect([...lp.legal, ...lp.blocked.map((b) => b.playerId)].sort()).toEqual(s.players.filter((p) => !taken.has(p.id)).map((p) => p.id).sort());
    for (const b of lp.blocked) expect(oracle[b.position]).toContain(b.rule);
  }
  it.each(Object.entries(SCRIPTS))("agrees at every user turn of 4-team drafts by a user who picks: %s", (_name, script) => {
    for (let seed = 1; seed <= 8; seed++) {
      let hit = 0;
      const r = playDraft(data, seed, script, {
        onUserTurn: (s) => {
          hit++;
          check(data, s);
        },
      });
      expect(r.failure).toBeNull();
      expect(hit).toBe(37);
    }
  });
  it("agrees at every user turn of a 32-team draft", () => {
    const d = pinnedData();
    expect(playDraft(d, 3, SCRIPTS.hoard, { onUserTurn: (s) => check(d, s) }).failure).toBeNull();
  });
});
