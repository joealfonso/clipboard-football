// M1 step 5: the full-game loop, coach decisions, league and determinism (A, B, C5, C6, F2).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { teamNamesSchema } from "../../packages/shared/src/game-schema";
import type { CoachView, PlayResult } from "../../packages/shared/src/types";
import { onsideShare, tempoShares, timeoutShare, averageCoach, type CoachPolicies } from "../../packages/sim/src/loop/coach";
import { averageCoachFor, generateLeague, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { GameLoopError, gamePlayers, playGame, prepareGame, recordOf, startGame, stepGame, type GameKit, type GameRun } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { REPO, loadGameData } from "../../scripts/game/data";

const data = loadGameData();
const kit = prepareGame(data);
const coach = averageCoachFor(data);
const { teams } = leagueFromSeed(data, 2026);
const setup = (seed: number, c: CoachPolicies = coach) => setupGame(teams, 2026, seed, () => c);

describe("game loop (A)", () => {
  it("A1: games from many seeds reach final with a result and a complete record", () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const r = playGame(setup(seed), kit, Rng.fromSeed(seed));
      expect(r.final.phase).toBe("final");
      expect(r.final.result).not.toBeNull();
      expect(r.seed).toBe(seed);
      expect(r.rules.id).toBe("nfl-2026");
      expect(r.rules.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.keys(r.dataHashes).length).toBeGreaterThan(10);
      expect(r.teams.home).not.toBe(r.teams.away);
    }
  });

  it("A2: every PlayResult comes from resolvePlay (spy engine)", () => {
    const made = new Set<PlayResult>();
    const spy: GameKit = { data, resolve: (...a) => { const p = kit.resolve(...a); made.add(p); return p; } };
    const r = playGame(setup(7), spy, Rng.fromSeed(7));
    const plays = r.events.flatMap((e) => (e.t === "play" ? [e.play] : []));
    expect(plays.length).toBeGreaterThan(100);
    for (const p of plays) expect(made.has(p)).toBe(true);
  });

  it("A3: each phase asks the right policy", () => {
    const calls: string[] = [];
    const wrap: CoachPolicies = {
      offenseCall: (v, rng) => (calls.push(`offense:${v.phase}`), coach.offenseCall(v, rng)),
      defenseCall: (v, rng) => (calls.push(`defense:${v.phase}`), coach.defenseCall(v, rng)),
      timeout: (v, s, rng) => (calls.push(`timeout:${s}`), coach.timeout(v, s, rng)),
      tempo: (v, rng) => (calls.push(`tempo:${v.clockRunning}`), coach.tempo(v, rng)),
      onside: (v, rng) => (calls.push("onside"), coach.onside(v, rng)),
      specialTimeout: (role, own, taken, rng) => coach.specialTimeout(role, own, taken, rng),
      penalty: (o, t) => coach.penalty(o, t),
      runoffTimeout: (v) => coach.runoffTimeout(v),
    };
    const r = playGame(setup(11, wrap), kit, Rng.fromSeed(11));
    const kickoffs = r.events.filter((e) => e.t === "play" && e.before.phase === "kickoff").length;
    expect(calls.filter((c) => c === "onside").length).toBe(kickoffs);
    expect(calls).not.toContain("tempo:false");
    expect(calls).toContain("offense:try");
    const snaps = r.events.filter((e) => e.t === "play" && e.before.phase === "scrimmage").length;
    expect(calls.filter((c) => c === "offense:scrimmage").length).toBe(snaps);
    // Asked once per scrimmage dead ball: each snap, plus each dead ball a run-off ended the period in.
    const endedByRunoff = r.events.filter((e) => e.t === "runoff" && e.after.phase !== "scrimmage").length + r.events.filter((e) => e.t === "runoff" && e.after.period !== e.before.period).length;
    expect(calls.filter((c) => c === "timeout:offense").length).toBeGreaterThanOrEqual(snaps);
    expect(calls.filter((c) => c === "timeout:offense").length).toBeLessThanOrEqual(snaps + Math.max(endedByRunoff, r.final.period));
  });

  it("A6: the input cap throws a typed error", () => {
    const tiny = prepareGame({ ...data, config: { ...data.config, loop: { maxInputsPerGame: 50, maxScrimmageSnapsPerGame: 260 } } });
    expect(() => playGame(setup(1), tiny, Rng.fromSeed(1))).toThrow(GameLoopError);
  });
});

describe("coach decisions (C5, C6)", () => {
  const golden = JSON.parse(readFileSync(join(REPO, "data/game/golden.json"), "utf8")) as {
    tempo: { view: Record<string, number>; level: number; key: string; weights: number[] }[];
    timeouts: { view: Record<string, number>; side: "offense" | "defense"; level: number; key: string; p: number }[];
    onside: { view: Record<string, number>; level: number; key: string; p: number }[];
  };
  const cv = (v: Record<string, number>): CoachView => ({
    phase: "scrimmage", down: v["down"] ?? 1, yardsToGo: 10, yardLine100: 50, scoreDiff: v["scoreDiff"] ?? 0, quarter: v["quarter"] ?? 1,
    secondsLeftInHalf: v["secondsLeftInHalf"] ?? 900, secondsLeftInGame: v["secondsLeftInGame"] ?? 900, offenseTimeouts: v["ownTimeouts"] ?? 3, defenseTimeouts: v["ownTimeouts"] ?? 3,
    clockRunning: v["clockRunning"] === 1, playClock: 40, previousSnapKneel: v["previousSnapKneel"] === 1, previousSnapRestart: (v["clockRestarted"] ?? 0) as 0 | 1 | 2, beforeTimeout: v["timeoutCalled"] === 1,
    offenseTimeoutsThisDeadBall: 0, defenseTimeoutsThisDeadBall: 0, otBothPossessed: 0,
  });

  it("C5: TypeScript shares equal the pipeline's for every golden view (at least 100 per table)", () => {
    expect(golden.tempo.length).toBeGreaterThanOrEqual(100);
    expect(golden.timeouts.length).toBeGreaterThanOrEqual(100);
    expect(golden.onside.length).toBeGreaterThanOrEqual(100);
    for (const g of golden.tempo) {
      const f = tempoShares(cv(g.view), data.tables, data.config.dimensions);
      expect([f.level, f.key, f.value]).toEqual([g.level, g.key, g.weights]);
    }
    for (const g of golden.timeouts) {
      const v = cv(g.view);
      const f = timeoutShare(g.side === "offense" ? v : { ...v, scoreDiff: -v.scoreDiff }, g.side, data.tables, data.config.dimensions, 1);
      expect([f.level, f.key]).toEqual([g.level, g.key]);
      expect(f.value).toBeCloseTo(g.p, 12);
    }
    for (const g of golden.onside) {
      const f = onsideShare({ quarter: g.view["quarter"] ?? 1, secondsLeftInHalf: g.view["secondsLeftInHalf"] ?? 0, secondsLeftInGame: g.view["secondsLeftInGame"] ?? 0, scoreDiff: g.view["scoreDiff"] ?? 0, safetyKick: false }, data.tables, data.config.dimensions);
      expect(f.value).toBeCloseTo(g.p, 12);
    }
  });

  it("C5: same seed gives the same decisions over 10,000 calls; one draw each", () => {
    const v = cv({ quarter: 4, secondsLeftInHalf: 100, secondsLeftInGame: 100, scoreDiff: -3, ownTimeouts: 2, clockRunning: 1, down: 2 });
    const run = (seed: number) => {
      const rng = Rng.fromSeed(seed);
      return Array.from({ length: 10000 }, () => [coach.tempo(v, rng), coach.timeout(v, "defense", rng)]);
    };
    expect(run(5)).toEqual(run(5));
    const rng = Rng.fromSeed(1);
    const before = rng.getState();
    coach.tempo(v, rng);
    const one = Rng.fromState(before);
    one.nextFloat();
    expect(rng.getState()).toEqual(one.getState());
  });

  it("C6: no timeout for a team with none or one already taken; never a run-off past the play clock", () => {
    const v = cv({ quarter: 4, secondsLeftInHalf: 30, secondsLeftInGame: 30, scoreDiff: -3, ownTimeouts: 0, clockRunning: 1 });
    expect(timeoutShare(v, "offense", data.tables, data.config.dimensions, 1).value).toBe(0);
    const taken = { ...cv({ quarter: 4, secondsLeftInHalf: 30, secondsLeftInGame: 30, scoreDiff: -3, ownTimeouts: 2, clockRunning: 1 }), offenseTimeoutsThisDeadBall: 1 };
    expect(timeoutShare(taken, "offense", data.tables, data.config.dimensions, 1).value).toBe(0);
    for (const seed of [21, 22, 23]) {
      const r = playGame(setup(seed), kit, Rng.fromSeed(seed));
      for (const e of r.events) if (e.t === "runoff") expect(e.seconds).toBeLessThanOrEqual(40);
    }
  });

  it("the average coach is built per call, with no shared state between teams", () => {
    const a = averageCoach({ caller: data.engine.caller, config: data.config, tables: data.tables, perDeadBall: 1 });
    const b = averageCoach({ caller: data.engine.caller, config: data.config, tables: data.tables, perDeadBall: 1 });
    expect(a).not.toBe(b);
  });
});

describe("league (B)", () => {
  it("B1: deterministic by seed, different seeds differ, every slot filled", () => {
    const a = generateLeague(Rng.fromSeed(5), data, 32);
    const b = generateLeague(Rng.fromSeed(5), data, 32);
    const c = generateLeague(Rng.fromSeed(6), data, 32);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    for (const t of a) gamePlayers({ gameType: "regularSeason", seed: 1, leagueSeed: 5, home: { name: t.name, pool: t.pool, coach }, away: { name: t.name, pool: t.pool, coach } }, data);
    expect(new Set(a.map((t) => t.name)).size).toBe(32);
  });

  it("B2: team names parse; duplicates fail", () => {
    const names = JSON.parse(readFileSync(join(REPO, "data/teams/names.json"), "utf8"));
    expect(() => teamNamesSchema.parse(names)).not.toThrow();
    const dup = { ...names, teams: [...names.teams, names.teams[0]] };
    expect(() => teamNamesSchema.parse(dup)).toThrow();
  });
});

describe("determinism (F2)", () => {
  it("same seed gives a deep-equal record, a different seed changes it", () => {
    expect(playGame(setup(42), kit, Rng.fromSeed(42))).toEqual(playGame(setup(42), kit, Rng.fromSeed(42)));
    expect(playGame(setup(43), kit, Rng.fromSeed(43))).not.toEqual(playGame(setup(42), kit, Rng.fromSeed(42)));
  });

  it("a mid-game run plus the Rng state, through JSON, resumes to the same record", () => {
    const s = setup(77);
    const players = gamePlayers(s, data);
    const rng = Rng.fromSeed(77);
    let run: GameRun = startGame(s, data, rng);
    for (let i = 0; i < 120; i++) run = stepGame(run, s, kit, players, rng);
    const saved = JSON.stringify({ run, rng: rng.getState() });
    while (run.state.phase !== "final") run = stepGame(run, s, kit, players, rng);
    const straight = recordOf(run, s, data);
    const back = JSON.parse(saved) as { run: GameRun; rng: [number, number, number, number] };
    const rng2 = Rng.fromState(back.rng);
    let r2 = back.run;
    while (r2.state.phase !== "final") r2 = stepGame(r2, s, kit, players, rng2);
    expect(JSON.parse(JSON.stringify(recordOf(r2, s, data)))).toEqual(JSON.parse(JSON.stringify(straight)));
  });
});
