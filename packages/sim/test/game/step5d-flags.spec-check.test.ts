// Test-writer spec checks for M1 step 5d milestone A2 (docs/specs/m1-step5d-clock-fixes.md): the sim's
// clockRunning and otBothPossessed at the snap, through the machine and toSituation. The parity block
// runs the shared scenarios in test/fixtures/step5d-flag-parity.json, which
// pipeline/tests/test_step5d_spec.py runs through the pipeline's clock_flags: both sides must give the
// fixture's values, so the caller is fitted (pipeline) on the same flag the game serves (sim).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlayResult } from "../../../shared/src/types";
import { callTimeout } from "../../src/game/machine";
import { toSituation } from "../../src/game/situation";
import type { GameState, Team } from "../../src/game/types";
import { Rng } from "../../src/rng";
import { startOvertime } from "../../src/game/machine";
import { defenseEnd, incomplete, offenseEnd, overtimeKickoff, play, real, run, scrimmage, tryState } from "./helpers";

const R = real();
const REPO = join(import.meta.dirname, "../../../..");

const sit = (s: GameState) => toSituation(s, R);
const flags = (s: GameState) => {
  const x = sit(s);
  return { clockRunning: x.clockRunning, otBothPossessed: x.otBothPossessed };
};
const punt = (s: GameState): PlayResult => ({ kind: "punt", seconds: 6, crossedLine: true, touchedByReceivers: false, end: defenseEnd(Math.min(s.spot + 40, 90)) });
const touchback: PlayResult = { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" };
const fg = (s: GameState): PlayResult => ({ kind: "fieldGoal", seconds: 5, good: true, kickSpot: s.spot - 7 });

// ---------------------------------------------------------------- parity with the pipeline

interface Step {
  snap?: string;
  try?: string;
  kickoff?: string;
  timeout?: string;
  result?: string;
  qtr?: number;
  clock?: number;
  play?: string;
  expect?: { clockRunning: number; otBothPossessed: number };
  why?: string;
}
interface Scenario {
  id: string;
  start: "overtime" | { period: number; possession: Team; spot: number };
  steps: Step[];
}
const parity = JSON.parse(readFileSync(join(REPO, "test/fixtures/step5d-flag-parity.json"), "utf8")) as { scenarios: Scenario[] };

describe("A2 and train/serve parity: the sim gives the shared fixture's flags at every snap and try", () => {
  for (const sc of parity.scenarios) {
    it(sc.id, () => {
      let s: GameState;
      const names: Record<string, Team> = { home: "home", away: "away" };
      if (sc.start === "overtime") {
        s = overtimeKickoff("regularSeason");
        names["first"] = s.overtime?.firstTeam as Team;
        names["second"] = s.overtime?.secondTeam as Team;
      } else {
        s = scrimmage({ period: sc.start.period, clock: 900, possession: sc.start.possession, spot: sc.start.spot });
      }
      const team = (n: string): Team => {
        const t = names[n];
        if (t === undefined) throw new Error(`team ${n}`);
        return t;
      };
      let checked = 0;
      for (const st of sc.steps) {
        const tag = `${sc.id}: ${JSON.stringify(st)}`;
        if (st.timeout !== undefined) {
          s = callTimeout(s, R, team(st.timeout));
          continue;
        }
        if (st.kickoff !== undefined) {
          expect([s.phase, s.possession], tag).toEqual(["kickoff", team(st.kickoff)]);
          s = play(s, touchback);
          continue;
        }
        if (st.try !== undefined) {
          expect([s.phase, s.possession], tag).toEqual(["try", team(st.try)]);
          expect(flags(s), tag).toEqual(st.expect);
          checked++;
          s = play(s, { kind: "extraPoint", seconds: 0, good: true });
          continue;
        }
        const t = team(st.snap as string);
        expect([s.phase, s.possession, s.period], tag).toEqual(["scrimmage", t, st.qtr]);
        // The scenario's clock at the snap, 1st and 10 at the own 40 (no flag reads them); the clock state is the machine's.
        s = { ...s, clock: st.clock as number, spot: 40, down: 1, distance: 10, goalToGo: false };
        expect(flags(s), tag).toEqual(st.expect);
        checked++;
        const p: PlayResult =
          st.play === "run" ? run(Math.min(s.spot + 3, 95), 5)
          : st.play === "runOOB" ? run(Math.min(s.spot + 3, 95), 5, { outOfBounds: true })
          : st.play === "incomplete" ? incomplete(s)
          : st.play === "punt" ? punt(s)
          : st.play === "td" ? run(101, 6, { touchdown: true })
          : (() => { throw new Error(`play ${String(st.play)}`); })();
        s = play(s, p);
      }
      expect(checked).toBe(sc.steps.filter((x) => x.expect !== undefined).length);
    });
  }

  it("the fixture exercises both values of both flags", () => {
    const all = parity.scenarios.flatMap((x) => x.steps.flatMap((st) => (st.expect === undefined ? [] : [st.expect])));
    for (const k of ["clockRunning", "otBothPossessed"] as const) expect(new Set(all.map((e) => e[k]))).toEqual(new Set([0, 1]));
  });
});

// ---------------------------------------------------------------- A2 cases the pipeline cannot see

describe("A2: sim fixtures for clockRunning", () => {
  it("incompletion then snap 0; in-bounds run in Q3 1; after a timeout 0; a try 0", () => {
    const q3 = scrimmage({ period: 3, clock: 600 });
    expect(sit(play(q3, incomplete(q3))).clockRunning).toBe(0);
    const ran = play(q3, run(30, 5));
    expect(ran.clockRunning).toBe(true);
    expect(sit(ran).clockRunning).toBe(1);
    expect(sit(callTimeout(ran, R, "away")).clockRunning).toBe(0);
    // A try is 0 even if the state's clock flag were set (the clock never runs on a try).
    expect(sit(tryState()).clockRunning).toBe(0);
    expect(sit({ ...tryState(), clockRunning: true }).clockRunning).toBe(0);
  });
});

describe("A2: sim fixtures for otBothPossessed", () => {
  it("every regulation snap gives 0, even with an overtime-like state on the record", () => {
    for (let p = 1; p <= 4; p++) expect(sit(scrimmage({ period: p, clock: 30, clockRunning: true })).otBothPossessed).toBe(0);
  });

  it("an onside kick the first team recovers is the second team's opportunity: the first team's next snap gives 1", () => {
    // Postseason OT3 opens with a kickoff, as after halftime; here the first team kicks it, tied,
    // with the second team never having had the ball (the first possession ran through OT1 and OT2).
    const k = overtimeKickoff("postseason");
    const first = k.overtime?.firstTeam as Team;
    const kick: GameState = { ...k, period: k.period + 2, possession: first, overtime: { ...(k.overtime as NonNullable<GameState["overtime"]>), secondTeamPossessed: false } };
    const lost = play(kick, { kind: "onsideKick", seconds: 3, outcome: "inPlay", end: defenseEnd(48) });
    const after = play(kick, { kind: "onsideKick", seconds: 3, outcome: "inPlay", end: offenseEnd(47) });
    expect([after.phase, after.possession]).toEqual(["scrimmage", first]);
    expect(sit(after).otBothPossessed).toBe(1);
    // Recovered by the second team instead: it has the ball, so 1 as well; the negative case is a
    // first-team snap before any second-team opportunity.
    expect(sit(lost).otBothPossessed).toBe(1);
    const firstSnap = play(k, touchback);
    expect([firstSnap.possession, sit(firstSnap).otBothPossessed]).toEqual([first, 0]);
  });

  it("postseason OT3 and OT5 (after a new toss) give 1 once both teams have possessed", () => {
    const k = overtimeKickoff("postseason");
    // First team field goal, second team field goal: tied, both have possessed.
    let s = play(k, touchback);
    s = play({ ...s, spot: 75 }, fg({ ...s, spot: 75 }));
    s = play(s, touchback);
    expect(sit(s).otBothPossessed).toBe(1);
    s = play({ ...s, spot: 75 }, fg({ ...s, spot: 75 }));
    s = play(s, touchback);
    expect(sit(s).otBothPossessed).toBe(1);
    const seen = new Map<number, number>();
    let guard = 0;
    while (s.period <= k.period + 4 && guard++ < 200) {
      if (s.phase === "overtimeToss") {
        s = startOvertime(s, R, Rng.fromSeed(11));
        continue;
      }
      if (s.phase === "kickoff") {
        s = play(s, touchback);
        continue;
      }
      if (s.phase === "final") break;
      seen.set(s.period, sit(s).otBothPossessed);
      // A short in-bounds gain that runs out the period: nobody scores.
      s = play({ ...s, clock: 4, twoMinuteWarningDone: true, spot: Math.min(s.spot, 60) }, run(Math.min(s.spot, 60) + 1, 6));
    }
    expect(seen.get(k.period + 2), "OT3").toBe(1);
    expect(seen.get(k.period + 4), "OT5, after the second toss").toBe(1);
  });
});
