// M4 milestone B, legal-pick rule 4 (docs/specs/m4-franchise-core.md, ruling of 2026-11-24): after a
// pick every team can still fill its owned slots from the pool with every position inside its limits.
// Checked against two oracles written apart from completion.ts: brute force on three-team, three-position
// leagues, and Gale's supply and demand condition over every set of positions at full size.

import { describe, expect, it } from "vitest";
import { POSITIONS } from "../../../shared/src/engine";
import type { Position } from "../../../shared/src/engine";
import type { DraftRule, FranchiseData, FranchiseState, PoolPlayer } from "../../../shared/src/franchise";
import { parseFranchiseData } from "../../../shared/src/franchise-schema";
import { autoPick, autoPickPreview, checkDraft, createFranchise, draftView, legalPicks, makePick, playerIndex, rosterLimits, runDraft, setAutoDraft, setTarget } from "../../src/franchise/index";
import { Rng } from "../../src/rng";
import { ADVERSARIES, allAiDraft, draftProblems, draftToggling, draftWithUser, franchiseFiles, loadFranchiseData, mostOfUser, must, newFranchise, noNeedPool, surplusZero } from "./support";

const data = loadFranchiseData();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
type Counts = Record<Position, number>;
const each = (f: (p: Position) => number): Counts => Object.fromEntries(POSITIONS.map((p) => [p, f(p)])) as Counts;

// ---------------------------------------------------------------- the state, read again from scratch

interface Situation {
  readonly limits: ReturnType<typeof rosterLimits>;
  readonly counts: Counts[];
  readonly left: number[];
  readonly avail: Counts;
}

function situation(s: FranchiseState, d: FranchiseData): Situation {
  const index = playerIndex(s.players);
  const taken = new Set(s.draft.picks.map((p) => p.playerId));
  const at = (id: string): Position => (index.get(id) as PoolPlayer).position;
  return {
    limits: rosterLimits(d),
    counts: s.teams.map((t) => each((p) => (s.rosters[t.id] ?? []).filter((id) => at(id) === p).length)),
    left: s.teams.map((t) => s.draft.slots.slice(s.draft.picks.length).filter((x) => x === t.id).length),
    avail: each((p) => s.players.filter((x) => x.position === p && !taken.has(x.id)).length),
  };
}

function after(x: Situation, team: number, p: Position): Situation {
  return {
    limits: x.limits,
    counts: x.counts.map((c, i) => (i === team ? { ...c, [p]: c[p] + 1 } : c)),
    left: x.left.map((n, i) => (i === team ? n - 1 : n)),
    avail: { ...x.avail, [p]: x.avail[p] - 1 },
  };
}

/** Brute force: every way each team can fill its slots, team by team. */
function bruteForce(x: Situation, used: readonly Position[], team = 0, avail: Counts = x.avail): boolean {
  if (POSITIONS.some((p) => avail[p] < 0)) return false;
  if (team === x.counts.length) return true;
  const c = x.counts[team] as Counts;
  const fill = (k: number, owed: number, pool: Counts): boolean => {
    if (k === used.length) return owed === 0 && bruteForce(x, used, team + 1, pool);
    const p = used[k] as Position;
    for (let n = Math.max(0, x.limits[p].min - c[p]); n <= Math.min(owed, x.limits[p].max - c[p], pool[p]); n++) {
      if (fill(k + 1, owed - n, { ...pool, [p]: pool[p] - n })) return true;
    }
    return false;
  };
  return (x.left[team] as number) >= 0 && fill(0, x.left[team] as number, avail);
}

/** Gale's condition: for every set of positions, what the teams must take there at least fits in its pool. Minimums first, as lower bounds. */
function gale(x: Situation): boolean {
  const spare = POSITIONS.map((p) => x.avail[p] - x.counts.reduce((s, c) => s + Math.max(0, x.limits[p].min - c[p]), 0));
  const room = x.counts.map((c) => POSITIONS.map((p) => x.limits[p].max - Math.max(x.limits[p].min, c[p])));
  const owed = x.counts.map((c, i) => POSITIONS.reduce((s, p) => s - Math.max(0, x.limits[p].min - c[p]), x.left[i] as number));
  if ([...spare, ...owed, ...room.flat()].some((n) => n < 0)) return false;
  for (let set = 0; set < 1 << POSITIONS.length; set++) {
    let pool = 0;
    for (let p = 0; p < POSITIONS.length; p++) if ((set >> p) & 1) pool += spare[p] as number;
    let must = 0;
    for (let i = 0; i < owed.length; i++) {
      let elsewhere = 0;
      const r = room[i] as number[];
      for (let p = 0; p < POSITIONS.length; p++) if (!((set >> p) & 1)) elsewhere += r[p] as number;
      must += Math.max(0, (owed[i] as number) - elsewhere);
    }
    if (must > pool) return false;
  }
  return true;
}

/** The first rule that blocks the pick, by a plain reading of the spec and the oracle given. */
function firstBlock(x: Situation, team: number, p: Position, oracle: (x: Situation) => boolean): DraftRule | null {
  const y = after(x, team, p);
  const c = y.counts[team] as Counts;
  const open = (q: Position): number => y.counts.reduce((s, k) => s + Math.max(0, y.limits[q].min - k[q]), 0);
  if (c[p] > y.limits[p].max) return "positionMax";
  if ((y.left[team] as number) < POSITIONS.reduce((s, q) => s + Math.max(0, y.limits[q].min - c[q]), 0)) return "minimumsReachable";
  if (POSITIONS.some((q) => y.avail[q] < open(q))) return "poolCoversMinimums";
  return oracle(y) ? null : "completionExists";
}

// ---------------------------------------------------------------- tiny leagues

const TINY: readonly Position[] = ["QB", "RB", "WR"];

/** A three-team league with random limits at three positions, none elsewhere, and a pool near the size of its rosters. */
function tinyLeague(seed: number): { readonly d: FranchiseData; readonly start: FranchiseState } {
  const rng = Rng.fromSeed(seed);
  const int = (lo: number, hi: number): number => lo + Math.floor(rng.nextFloat() * (hi - lo + 1));
  const min = each((p) => (TINY.includes(p) ? int(0, 1) : 0));
  const target = each((p) => (TINY.includes(p) ? min[p] + int(0, 2) : 0));
  const max = each((p) => (TINY.includes(p) ? target[p] + int(0, 2) : 0));
  if (TINY.every((p) => target[p] === 0)) {
    target.QB = 1;
    max.QB = 1;
  }
  const engine = data.game.engine;
  const d: FranchiseData = {
    ...data,
    game: { ...data.game, engine: { ...engine, personnel: { ...engine.personnel, offense: { only: min } as never, kick: {} as never, packages: {} as never }, participants: { ...engine.participants, returnUnits: {} as never } } },
    league: { ...data.league, conferences: [{ id: "only", name: "Only" }], divisions: ["One"], teamsPerDivision: 3 },
    roster: { ...data.roster, rosterSize: TINY.reduce((s, p) => s + target[p], 0), positions: Object.fromEntries(POSITIONS.map((p) => [p, { target: target[p], max: max[p] }])) as FranchiseData["roster"]["positions"] },
    pool: { ...data.pool, surplus: 0 },
    draftAi: { ...data.draftAi, slotNeed: Object.fromEntries(POSITIONS.map((p) => [p, []])) as never, evaluation: { errorSdMin: 8, errorSdMax: 8 } },
  };
  const made = must(createFranchise(d, { seed, userTeam: "T00" }));
  // Some pools are cut, so the league may have no completion from the start, or only a few.
  const cut = int(0, 3) === 0 ? int(1, 2) : 0;
  const drop = new Set<string>();
  for (let i = 0; i < cut; i++) drop.add((made.players[int(0, made.players.length - 1)] as PoolPlayer).id);
  return { d, start: { ...made, players: made.players.filter((p) => !drop.has(p.id)) } };
}

describe("rule 4 against brute force on three teams and three positions", () => {
  it("400 leagues, every state of a draft: the legal set and the rule named match, every mustFill and use holds, and no draft gets stuck", () => {
    const seen = { states: 0, checks: 0, named: 0, stuckStart: 0, finished: 0, offClock: 0 };
    for (let seed = 1; seed <= 400; seed++) {
      const { d, start } = tinyLeague(seed);
      const oracle = (x: Situation): boolean => bruteForce(x, TINY);
      const rng = Rng.fromSeed(seed);
      let s = start;
      if (!oracle(situation(s, d))) {
        // No full draft from here: every pick action and the load check say so, and nothing is legal.
        seen.stuckStart++;
        const r = checkDraft(s, d);
        expect(r).toMatchObject({ ok: false, error: { code: "draftCannotFinish" } });
        expect(runDraft(s, d)).toEqual(r);
        expect(must(legalPicks(s, d)).legal, `seed ${seed}`).toEqual([]);
        continue;
      }
      while (s.phase === "draft") {
        seen.states++;
        expect(checkDraft(s, d)).toEqual({ ok: true, value: true });
        const x = situation(s, d);
        const onClock = s.draft.slots[s.draft.picks.length] as string;
        for (const [i, t] of s.teams.entries()) {
          if (t.id !== onClock) seen.offClock++;
          const lp = must(legalPicks(s, d, t.id));
          for (const p of TINY) {
            const want = firstBlock(x, i, p, oracle);
            expect(lp.positions[p].blockedBy, `seed ${seed} pick ${s.draft.picks.length + 1} ${t.id} ${p}`).toBe(want);
            expect(lp.positions[p].legal).toBe(want === null);
            seen.checks++;
            if (want === "completionExists") seen.named++;
            // Filling a minimum is always legal, so must-fill and `use` never contradict the legal set.
            if (lp.positions[p].use === "starter" && (x.left[i] as number) > 0) expect(want).toBe(null);
          }
        }
        const v = draftView(s, d);
        if (v.done) throw new Error("open");
        expect(v.legal.length).toBeGreaterThan(0);
        if (v.onClock.everyPickMustFill) expect(TINY.filter((p) => v.onClock.positions[p].legal)).toEqual(v.onClock.mustFill.map((m) => m.position));
        // The team on the clock takes any legal player: the user by hand, an AI team by a forged pick.
        const id = v.legal[Math.floor(rng.nextFloat() * v.legal.length)] as string;
        s = must(makePick({ ...s, settings: { ...s.settings, userTeam: onClock } }, d, id));
      }
      expect(draftProblems(s, d)).toEqual([]);
      seen.finished++;
    }
    console.log(`rule 4 oracle: ${JSON.stringify(seen)}`);
    expect(seen.named).toBeGreaterThan(200);
    expect(seen.stuckStart).toBeGreaterThan(20);
    expect(seen.finished).toBeGreaterThan(250);
  }, 120_000);

  it("AI picks, auto-pick and the preview never take a player rule 4 blocks, a marked target included", () => {
    let targets = 0;
    for (let seed = 1; seed <= 1500; seed++) {
      const { d, start } = tinyLeague(seed);
      if (!checkDraft(start, d).ok) continue;
      expect(draftProblems(must(runDraft(must(setAutoDraft(start, true)), d)).state, d)).toEqual([]);
      let s = must(runDraft(start, d)).state;
      while (s.phase === "draft") {
        const lp = must(legalPicks(s, d));
        const blocked = lp.blocked.filter((b) => b.rule === "completionExists" && lp.positions[b.position].use === "depth");
        for (const b of blocked) s = must(setTarget(s, b.playerId, true));
        const preview = autoPickPreview(s, d);
        const made = must(autoPick(s, d));
        expect(lp.legal).toContain(made.pick.playerId);
        expect(preview).toMatchObject({ playerId: made.pick.playerId });
        if (blocked.length > 0) {
          targets++;
          expect(blocked.map((b) => b.playerId)).not.toContain(made.pick.playerId);
          const id = (blocked[0] as { playerId: string }).playerId;
          const before = clone(s);
          expect(makePick(s, d, id)).toEqual({ ok: false, error: { code: "illegalPick", playerId: id, position: (blocked[0] as { position: Position }).position, rule: "completionExists" } });
          expect(s).toEqual(before);
          const shown = draftView(s, d).available.find((p) => p.id === id);
          expect(shown).toMatchObject({ legal: false, blockedBy: "completionExists", use: "depth" });
        }
        s = made.state.phase === "draft" ? must(runDraft(made.state, d)).state : made.state;
      }
      expect(draftProblems(s, d)).toEqual([]);
    }
    expect(targets).toBeGreaterThan(10);
  }, 120_000);
});

/** A finished draft as it stood after its first `at` picks. */
function rewound(full: FranchiseState, at: number): FranchiseState {
  const picks = full.draft.picks.slice(0, at);
  return { ...full, phase: "draft", numbers: {}, draft: { ...full.draft, picks }, rosters: Object.fromEntries(full.teams.map((t) => [t.id, picks.filter((p) => full.draft.slots[p.overallPick - 1] === t.id).map((p) => p.playerId)])) };
}

describe("rule 4 at full size: 32 teams and 11 positions", () => {
  it("with surplus 0 and no need, the legal set matches Gale's condition through the late rounds, for the team on the clock and others", () => {
    // Every position worth the same too (no value curve either): where kickers and punters are worth little no team takes one past its minimum, and rule 4 never decides.
    const even = noNeedPool(data);
    const d: FranchiseData = { ...even, draftAi: { ...even.draftAi, positionValue: each(() => 1), valueCurve: undefined } };
    let named = 0;
    let legal = 0;
    for (const [seed, slot] of [[1, 1], [1, 32]] as const) {
      const full = draftWithUser(d, seed, mostOfUser, "T00", slot);
      expect(draftProblems(full, d)).toEqual([]);
      for (const at of [1200, 1400, 1600, ...Array.from({ length: 36 }, (_, k) => 1660 + k)]) {
        const s = rewound(full, at);
        const x = situation(s, d);
        for (const i of [s.teams.findIndex((t) => t.id === s.draft.slots[at]), (at * 7) % 32]) {
          const lp = must(legalPicks(s, d, (s.teams[i] as { id: string }).id));
          for (const p of POSITIONS) {
            const want = firstBlock(x, i, p, gale);
            expect(lp.positions[p].blockedBy, `seed ${seed} pick ${at + 1} team ${i} ${p}`).toBe(want);
            if (want === "completionExists") named++;
            if (want === null) legal++;
          }
        }
      }
    }
    console.log(`rule 4 at full size: ${named} positions blocked by completionExists, ${legal} legal`);
    expect(named).toBeGreaterThan(0);
    expect(legal).toBeGreaterThan(0);
  }, 120_000);

  it("a saved draft with no completion left, though every minimum is covered and every team is inside its limits, is a typed error on load and on every action", () => {
    // The last players go: one short of the slots left, at a position every team has its minimum of.
    // The first seed from 21 whose all-AI draft leaves the last team on the clock with every minimum covered.
    const atLast = (seed: number): FranchiseState => {
      const s0 = must(runDraft(must(setAutoDraft(newFranchise(data, seed, "T00", 1), true)), data, { maxPicks: 1695 })).state;
      const last = s0.draft.slots[1695] as string;
      return { ...s0, settings: { ...s0.settings, userTeam: last }, draft: { ...s0.draft, autoDraft: false } };
    };
    const covered = (s: FranchiseState): boolean => {
      const positions = must(legalPicks(s, data)).positions;
      return POSITIONS.every((p) => positions[p].count >= positions[p].min);
    };
    let seed = 21;
    while (seed < 121 && !covered(atLast(seed))) seed++;
    const s1 = atLast(seed);
    expect(covered(s1), `no seed from 21 to 120 covers every minimum at the last pick`).toBe(true);
    const taken = new Set(s1.draft.picks.map((p) => p.playerId));
    const bare: FranchiseState = { ...s1, players: s1.players.filter((p) => taken.has(p.id)) };
    const before = clone(bare);
    const error = { ok: false, error: { code: "draftCannotFinish", rule: "completionExists", teamId: null, position: null } };
    expect(checkDraft(bare, data)).toEqual(error);
    expect(runDraft(bare, data)).toEqual(error);
    expect(autoPick(bare, data)).toEqual(error);
    expect(autoPickPreview(bare, data)).toBe(null);
    expect(must(legalPicks(bare, data)).legal).toEqual([]);
    expect(bare).toEqual(before);
  }, 60_000);
});

describe("B3 and B4 (slice): no dead ends with no surplus, where rule 4 decides", () => {
  const sets: readonly (readonly [string, FranchiseData])[] = [["surplus 0, shipped need", surplusZero(data)], ["surplus 0, no need", noNeedPool(data)]];
  it.each(sets)("%s: all-AI, and each adversary from slots 1 and 32", (_name, d) => {
    expect(draftProblems(allAiDraft(d, 1), d)).toEqual([]);
    for (const [i, make] of Object.values(ADVERSARIES).entries()) expect(draftProblems(draftWithUser(d, 1, make(d, 1), "T00", i % 2 === 0 ? 1 : 32), d)).toEqual([]);
    expect(draftProblems(draftToggling(d, 1, "T00", 32), d)).toEqual([]);
  }, 120_000);
});

describe("the loader refuses data with no full draft", () => {
  const files = franchiseFiles();
  const roster = files.roster as { rosterSize: number; positions: Record<Position, { target: number; max: number }> };
  const load = (r: Partial<typeof roster>, pool: object = {}): FranchiseData => parseFranchiseData({ ...files, roster: { ...roster, ...r }, pool: { ...(files.pool as object), ...pool } }, data.game);
  const qb = (target: number, max: number): typeof roster.positions => ({ ...roster.positions, QB: { target, max } });

  it("slots no position can hold, slots the minimums overrun, a maximum under the minimum, and a pool short of the rosters", () => {
    const most = POSITIONS.reduce((s, p) => s + roster.positions[p].max, 0);
    expect(() => load({ rosterSize: most + 1 })).toThrow(/targets sum/);
    expect(() => load({ rosterSize: 32 })).toThrow(/targets sum/);
    expect(() => load({ positions: qb(3, 0) })).toThrow(/above max/);
    expect(() => load({ rosterSize: 50, positions: qb(0, 0) })).toThrow(/below the 1 the engine/);
    expect(() => load({}, { surplus: -0.1 })).toThrow();
  });

  it("the tightest data it accepts has one: no surplus, with each maximum at its target or at the file's", () => {
    const fixed = Object.fromEntries(POSITIONS.map((p) => [p, { target: roster.positions[p].target, max: roster.positions[p].target }])) as typeof roster.positions;
    for (const d of [load({}, { surplus: 0 }), load({ positions: fixed }, { surplus: 0 })]) {
      const s = newFranchise(d, 3);
      expect(gale(situation(s, d))).toBe(true);
      expect(checkDraft(s, d)).toEqual({ ok: true, value: true });
    }
  });
});
