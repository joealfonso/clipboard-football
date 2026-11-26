// B5, B6, B7, B9 (determinism part) and Locked 1, plus the state rules under "State, save and
// worker API": plain JSON, nothing derived.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DraftAiInput, DraftOpenView, FranchiseState } from "../../../shared/src/franchise";
import { autoPick, chooseAiPick, createFranchise, draftProfile, draftView, legalPicks, makePick, needBonus, runDraft, setAutoDraft, setTarget } from "../../src/franchise";
import { create, deepFreeze, flatAi, onClock, pinnedData, playDraft, POSITIONS, roundTrip, SCRIPTS, shippedData, smallData, specBlocked, undrafted, value, withAi, withOveralls } from "./spec-support";

const small = smallData();
const big = shippedData();

/** Runs AI picks to the user's next turn. */
const run = (s: FranchiseState): FranchiseState => value(runDraft(s, small)).state;

describe("B5 determinism", () => {
  it("same seed and same user picks: deep-equal states", () => {
    for (const script of Object.values(SCRIPTS)) expect(playDraft(small, 9, script).state).toStrictEqual(playDraft(small, 9, script).state);
    expect(playDraft(big, 9, SCRIPTS.random).state).toStrictEqual(playDraft(big, 9, SCRIPTS.random).state);
  });

  it("different seeds draft differently", () => {
    const a = playDraft(small, 1, SCRIPTS.random).state.draft.picks.map((p) => p.playerId);
    const b = playDraft(small, 2, SCRIPTS.random).state.draft.picks.map((p) => p.playerId);
    expect(a).not.toEqual(b);
  });

  it("a different user pick changes later AI picks", () => {
    const s = create(small, 4, 1);
    const legal = value(legalPicks(s, small)).legal;
    const later = (id: string): string[] => run(value(makePick(s, small, id))).draft.picks.slice(1).map((p) => p.playerId);
    const tookBest = later(value(autoPick(s, small)).pick.playerId);
    const tookWorst = later(legal.at(-1) as string);
    expect(tookBest).toHaveLength(6);
    expect(tookWorst).toHaveLength(6);
    expect(tookWorst).not.toEqual(tookBest);
  });

  it("a state saved to JSON before every user turn and resumed ends identically", () => {
    const straight = playDraft(small, 12, SCRIPTS.random);
    let s = create(small, 12);
    for (const id of straight.userPicks) {
      s = roundTrip(run(s));
      s = roundTrip(value(makePick(s, small, id)));
    }
    if (s.phase === "draft") s = run(s);
    expect(s).toStrictEqual(straight.state);
  });

  it("a mid-draft save keeps auto-draft and targets, and continues the same", () => {
    let s = run(create(small, 13, 2));
    s = value(makePick(s, small, value(legalPicks(s, small)).legal[3] as string));
    const free = undrafted(s);
    s = value(setTarget(s, (free[10] as { id: string }).id, true));
    s = value(setTarget(s, (free[60] as { id: string }).id, true));
    s = value(setAutoDraft(value(runDraft(s, small, { maxPicks: 1 })).state, true));
    const back = roundTrip(s);
    expect(back).toStrictEqual(s);
    expect(back.draft.autoDraft).toBe(true);
    expect(back.draft.targets).toHaveLength(2);
    expect(value(runDraft(back, small))).toStrictEqual(value(runDraft(s, small)));
  });

  it("AI picks one at a time equal AI picks in one run, with the picks returned in order", () => {
    const s = value(setAutoDraft(create(small, 14), true));
    const whole = value(runDraft(s, small));
    let step = s;
    const picks: unknown[] = [];
    for (let i = 0; i < 148; i++) {
      const r = value(runDraft(step, small, { maxPicks: 1 }));
      expect(r.picks).toHaveLength(1);
      picks.push(...r.picks);
      step = r.state;
    }
    expect(step).toStrictEqual(whole.state);
    expect(picks).toStrictEqual(whole.picks);
    expect(whole.picks.map((p) => p.overallPick)).toEqual(Array.from({ length: 148 }, (_, i) => i + 1));
    expect(whole.picks.map((p) => p.playerId)).toEqual(whole.state.draft.picks.map((p) => p.playerId));
  });

  it("no call writes to the state or data it is given", () => {
    const data = deepFreeze(roundTrip({ league: small.league, roster: small.roster, pool: small.pool, draftAi: small.draftAi, overallWeights: small.overallWeights }));
    const d = { ...data, game: small.game };
    let s = deepFreeze(create(d, 15, 2));
    s = deepFreeze(value(runDraft(s, d)).state);
    s = deepFreeze(value(setTarget(s, undrafted(s)[5]?.id as string, true)));
    draftView(s, d);
    s = deepFreeze(value(autoPick(s, d)).state);
    s = deepFreeze(value(setAutoDraft(s, true)));
    expect(value(runDraft(s, d)).state.phase).toBe("regularSeason");
  });
});

describe("B6 auto-pick and auto-draft", () => {
  // Revision 2026-11-24 (B6 reworded): the policy now takes a profile, the autoPick one for the user.
  it("auto-pick equals the pick of the AI policy with the autoPick profile for that team, marked auto (no targets)", () => {
    for (let seed = 1; seed <= 6; seed++) {
      playDraft(small, seed, SCRIPTS.random, {
        onUserTurn: (s) => {
          const choice = chooseAiPick(draftView(s, small) as DraftOpenView, small.draftAi, { seed, team: 0, style: small.draftAi.autoPick.style, errorSd: small.draftAi.autoPick.errorSd });
          const r = value(autoPick(s, small));
          expect(r.pick.playerId).toBe(choice?.playerId);
          expect(r.state.draft.picks.at(-1)).toStrictEqual({ overallPick: s.draft.picks.length + 1, playerId: r.pick.playerId, by: "auto" });
        },
      });
    }
  });

  // Revision 2026-11-24 (B7 reworded): the view plus the team's own profile.
  it("B7: each AI pick runDraft makes is the policy's answer to the draft view and that team's profile alone", () => {
    let s = run(create(small, 31, 4));
    for (let i = 0; i < 120 && s.phase === "draft"; i++) {
      if (onClock(s) === "T00") s = value(makePick(s, small, value(legalPicks(s, small)).legal[0] as string));
      if (s.phase !== "draft") break;
      const view = draftView(s, small);
      if (view.done || view.userOnClock) continue;
      const input: DraftAiInput = view; // type-level: the view is enough
      const r = value(runDraft(s, small, { maxPicks: 1 }));
      expect(r.picks[0]?.playerId).toBe(chooseAiPick(input, small.draftAi, draftProfile(small.draftAi, 31, Number((onClock(s) as string).slice(1))))?.playerId);
      s = r.state;
    }
  });

  it("who picked: user by hand, auto by auto-pick or auto-draft, ai for the other teams", () => {
    let s = run(create(small, 16, 2));
    s = run(value(makePick(s, small, value(legalPicks(s, small)).legal[0] as string)));
    s = run(value(autoPick(s, small)).state);
    s = value(runDraft(value(setAutoDraft(s, true)), small)).state;
    const mine = s.draft.picks.filter((_, i) => s.draft.slots[i] === "T00").map((p) => p.by);
    expect(mine).toEqual(["user", "auto", ...Array.from({ length: 35 }, () => "auto")]);
    expect(new Set(s.draft.picks.filter((_, i) => s.draft.slots[i] !== "T00").map((p) => p.by))).toEqual(new Set(["ai"]));
  });

  it("runDraft stops exactly at the user's turn, and does nothing when the user is already on the clock", () => {
    const s = value(runDraft(create(small, 17, 3), small));
    expect(s.picks).toHaveLength(2);
    expect(onClock(s.state)).toBe("T00");
    const again = value(runDraft(s.state, small));
    expect(again.picks).toEqual([]);
    expect(again.state).toStrictEqual(s.state);
  });

  it("at a snake turn the user picks twice with no AI pick between (slot 4 of 4: picks 4 and 5)", () => {
    let s = run(create(small, 18, 4));
    expect(s.draft.picks).toHaveLength(3);
    s = value(makePick(s, small, value(legalPicks(s, small)).legal[0] as string));
    const r = value(runDraft(s, small));
    expect(r.picks).toEqual([]);
    s = value(makePick(r.state, small, value(legalPicks(r.state, small)).legal[0] as string));
    expect(value(runDraft(s, small)).picks).toHaveLength(6);
  });

  it("auto-draft on before pick 1 runs to the end with no user turn", () => {
    const r = value(runDraft(value(setAutoDraft(create(small, 19, 1), true)), small));
    expect(r.picks).toHaveLength(148);
    expect(r.state.phase).toBe("regularSeason");
  });

  it("auto-draft switched on mid-round on another team's turn, then off, stops at the user's next turn", () => {
    let s = value(runDraft(create(small, 20, 3), small, { maxPicks: 1 })).state;
    expect(onClock(s)).not.toBe("T00");
    s = value(setAutoDraft(s, true));
    s = value(runDraft(s, small, { maxPicks: 2 })).state; // picks 2 and 3, the user's auto pick
    expect(s.draft.picks[2]?.by).toBe("auto");
    s = value(setAutoDraft(s, false));
    const r = value(runDraft(s, small)); // slot 3 next picks 6th
    expect(r.state.draft.picks).toHaveLength(5);
    expect(onClock(r.state)).toBe("T00");
    expect(r.state.draft.autoDraft).toBe(false);
  });
});

describe("AI policy: score = v x overall + style need x slot need + v x error, ties by id", () => {
  it("with equal scores the lowest player id wins, whatever the position", () => {
    const data = withAi(small, flatAi(small));
    for (let seed = 1; seed <= 5; seed++) {
      const s = withOveralls(create(data, seed, 4), () => 50);
      const lowest = s.players.map((p) => p.id).sort()[0];
      expect(value(runDraft(s, data, { maxPicks: 1 })).picks[0]?.playerId).toBe(lowest);
      const last = s.players.map((p) => p.id).sort().at(-1);
      const s2 = withOveralls(s, (p) => (p.id === last ? 51 : 50));
      expect(value(runDraft(s2, data, { maxPicks: 1 })).picks[0]?.playerId).toBe(last);
    }
  });

  it("position value scales overall: 60 x 2 beats 99 x 1, 49 x 2 loses to 99 x 1", () => {
    const data = withAi(small, flatAi(small, { QB: 2 }));
    const base = create(data, 3, 4);
    const pick = (qb: number): string => value(runDraft(withOveralls(base, (p) => (p.position === "QB" ? qb : 99)), data, { maxPicks: 1 })).picks[0]?.position as string;
    expect(pick(60)).toBe("QB");
    expect(pick(49)).not.toBe("QB");
  });

  it("only ever takes a legal player", () => {
    const data = withAi(small, flatAi(small, { K: 5 }));
    let s = create(data, 3, 4);
    while (s.phase === "draft") {
      if (onClock(s) === "T00") s = value(makePick(s, data, value(legalPicks(s, data)).legal[0] as string));
      if (s.phase !== "draft") break;
      if (onClock(s) === "T00") continue;
      const blocked = specBlocked(s, data, onClock(s) as string);
      const r = value(runDraft(s, data, { maxPicks: 1 }));
      expect(blocked[r.picks[0]?.position as (typeof POSITIONS)[number]]).toEqual([]);
      s = r.state;
    }
  });

  // Revision 2026-11-24: needBonus is slotNeed[position][count], in place of min, target and weights.
  it("the need bonus is the listed slot's, zero from the target on", () => {
    const slotNeed = { ...big.draftAi.slotNeed, QB: [14, 4, 1], K: [6], S: [9, 9, 7, 2] };
    const bonus = (position: "QB" | "K" | "S"): number[] => [0, 1, 2, 3, 4, 5].map((count) => needBonus({ position, count }, slotNeed));
    expect(bonus("QB")).toEqual([14, 4, 1, 0, 0, 0]);
    expect(bonus("K")).toEqual([6, 0, 0, 0, 0, 0]);
    expect(bonus("S")).toEqual([9, 9, 7, 2, 0, 0]);
  });
  it("the shipped lists have one bonus per slot up to the target and never rise", () => {
    for (const p of POSITIONS) {
      const list = big.draftAi.slotNeed[p];
      expect(list, p).toHaveLength(big.roster.positions[p].target);
      list.forEach((x, i) => expect(i === 0 || x <= (list[i - 1] as number), `${p} slot ${i + 1}`).toBe(true));
    }
  });

  // Revision 2026-11-24: the per-pick noise is gone; a team's fixed evaluation error takes its place.
  it("evaluation error: over seeds the same board gives more than one answer, the same seed only one", () => {
    const misread = withAi(small, { ...flatAi(small), evaluation: { errorSdMin: 8, errorSdMax: 8 } });
    const board = create(misread, 1, 4).players;
    const first = (seed: number): string => value(runDraft({ ...create(misread, seed, 4), players: board }, misread, { maxPicks: 1 })).picks[0]?.playerId as string;
    const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(new Set(seeds.map(first)).size).toBeGreaterThan(1);
    expect(seeds.map(first)).toEqual(seeds.map(first));
  });
});

describe("state is plain JSON with no derived data", () => {
  const mid = playMid();
  const states: readonly [string, FranchiseState][] = [
    ["new", create(big, 1)],
    ["mid-draft with targets", mid],
    ["after the draft", playDraft(small, 2, SCRIPTS.random).state],
  ];
  function playMid(): FranchiseState {
    let s = run(create(small, 30, 2));
    s = value(setTarget(s, undrafted(s)[8]?.id as string, true));
    return run(value(makePick(s, small, value(legalPicks(s, small)).legal[0] as string)));
  }

  it.each(states)("%s: round-trips strictly and holds only plain objects and arrays", (_n, s) => {
    expect(roundTrip(s)).toStrictEqual(s);
    const walk = (x: unknown): void => {
      if (x === null || typeof x !== "object") {
        expect(["string", "number", "boolean"].includes(typeof x) || x === null).toBe(true);
        return;
      }
      expect([Object.prototype, Array.prototype]).toContain(Object.getPrototypeOf(x));
      Object.values(x).forEach(walk);
    };
    walk({ ...s, players: s.players.slice(0, 5) });
  });

  it.each(states)("%s: the keys are the spec's stored list and nothing else", (_n, s) => {
    expect(Object.keys(s).sort()).toEqual(["draft", "numbers", "phase", "players", "rosters", "schemaVersion", "seed", "settings", "teams"]);
    expect(Object.keys(s.draft).sort()).toEqual(["autoDraft", "picks", "slots", "targets"]);
    for (const p of s.players) expect(Object.keys(p).sort()).toEqual(["id", "name", "position", "ratings", "skills"]);
    for (const p of s.draft.picks) expect(Object.keys(p).sort()).toEqual(["by", "overallPick", "playerId"]);
    for (const t of s.teams) expect(Object.keys(t).sort()).toEqual(["conference", "division", "id", "nickname", "place"]);
    for (const t of s.teams) for (const id of s.rosters[t.id] ?? []) expect(typeof id).toBe("string");
    expect(s.schemaVersion).toBe(1);
    expect(JSON.stringify(s)).not.toMatch(/"(overall|average|averages|rank|ranks|summar\w*|legal|available|standings|rng\w*|generator|neededTo\w*|noise|score|styles?|profiles?|errorSd|errors?)"/);
  });

  it("numbers are empty until the draft ends", () => {
    expect(create(small, 1).numbers).toEqual({});
    expect(mid.numbers).toEqual({});
  });

  it("the franchise sources use no clock, DOM, Node API, zod or unseeded random (Locked 1)", () => {
    const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/franchise");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const code = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, f).not.toMatch(/Math\s*(\.|\[\s*["'])random|\bDate\b|performance\b|\bzod\b|\bdocument\b|\bwindow\b|\bnode:|\bprocess\b|\bcrypto\b|localeCompare|\bIntl\b/);
      // 32, 53 and 1,696 are data, not code.
      expect(code.replace(/0x[0-9a-f]+/gi, ""), f).not.toMatch(/\b(32|53|1696)\b/);
    }
  });

  it("works on a pool far from the shipped one: data is injected, not read", () => {
    expect(value(createFranchise(small, { seed: 1, userTeam: "T03" })).teams).toHaveLength(4);
    expect(create(pinnedData(), 1).teams).toHaveLength(32);
  });
});
