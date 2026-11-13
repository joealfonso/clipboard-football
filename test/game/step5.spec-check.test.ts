// Test-writer spec checks for M1 step 5 (docs/specs/m1-step5-full-game-and-calibration.md),
// written from the acceptance criteria for the ones the existing tests cover weakly or not at all.
// Fast: at most about 700 simulated games in total.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { CoachView, KickView, Situation } from "../../packages/shared/src/types";
import { boxScore } from "../../packages/sim/src/loop/box";
import type { CoachPolicies } from "../../packages/sim/src/loop/coach";
import { averageCoachFor, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { playGame, prepareGame, type GameRecord } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { statusOf, SUMMARY, type Tolerances } from "../../scripts/game/calibrate";
import { REPO, RULES_FILE, loadGameData, sha256 } from "../../scripts/game/data";
import { simGame } from "../../scripts/game/sim-game";

const data = loadGameData();
const kit = prepareGame(data);
const coach = averageCoachFor(data);
const { teams } = leagueFromSeed(data, 2026);
const read = (f: string): string => readFileSync(join(REPO, f), "utf8");
const json = <T>(f: string): T => JSON.parse(read(f)) as T;
const section = (doc: string, heading: string): string => {
  const parts = doc.split(/\n(?=#{2,3} )/);
  const s = parts.find((p) => p.replace(/^#+ /, "").startsWith(heading));
  if (s === undefined) throw new Error(`no section ${heading}`);
  return s;
};

/** A coach that logs every policy call, then defers to `base` unless an override is given. */
function logged(calls: string[], over: Partial<CoachPolicies> = {}, base: CoachPolicies = coach): CoachPolicies {
  return {
    offenseCall: (v, r) => (calls.push(`offense:${v.phase}`), (over.offenseCall ?? base.offenseCall)(v, r)),
    defenseCall: (v, r) => (calls.push(`defense:${v.phase}`), (over.defenseCall ?? base.defenseCall)(v, r)),
    timeout: (v, s, r) => (calls.push(`timeout:${s}`), (over.timeout ?? base.timeout)(v, s, r)),
    specialTimeout: (role, own, taken, r) => (over.specialTimeout ?? base.specialTimeout)(role, own, taken, r),
    tempo: (v, r) => (calls.push("tempo"), (over.tempo ?? base.tempo)(v, r)),
    onside: (v, r) => (calls.push("onside"), (over.onside ?? base.onside)(v, r)),
    penalty: (o, t) => (over.penalty ?? base.penalty)(o, t),
    runoffTimeout: (v) => (over.runoffTimeout ?? base.runoffTimeout)(v),
  };
}

const plays = (r: GameRecord) => r.events.flatMap((e) => (e.t === "play" ? [e] : []));

describe("A3: input order per phase", () => {
  it("try: the defense caller is asked only on a two-point try", () => {
    let tries = 0;
    for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
      const calls: string[] = [];
      const c = logged(calls);
      const r = playGame(setupGame(teams, 2026, seed, () => c), kit, Rng.fromSeed(seed));
      const tryPlays = plays(r).filter((e) => e.before.phase === "try");
      tries += tryPlays.length;
      const twos = tryPlays.filter((e) => e.offense.call === "goForTwo");
      expect(calls.filter((x) => x === "offense:try").length).toBe(tryPlays.length);
      expect(calls.filter((x) => x === "defense:try").length).toBe(twos.length);
      for (const e of tryPlays) expect(e.defense === null).toBe(e.offense.call !== "goForTwo");
    }
    expect(tries).toBeGreaterThan(20);
  });

  it("scrimmage: offense timeout, then defense timeout, before the offense call; the defense calls last", () => {
    const calls: string[] = [];
    const c = logged(calls);
    playGame(setupGame(teams, 2026, 21, () => c), kit, Rng.fromSeed(21));
    let seg: string[] = [];
    let checked = 0;
    for (const x of calls) {
      if (x === "offense:scrimmage") {
        const o = seg.indexOf("timeout:offense");
        const d = seg.indexOf("timeout:defense");
        if (o >= 0 && d >= 0) {
          expect(o).toBeLessThan(d);
          checked++;
        }
        seg = [];
        continue;
      }
      // Nothing but the defense call may follow the offense call before the next dead ball's timeouts.
      if (seg.length === 0 && x.startsWith("defense:")) continue;
      seg.push(x);
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("overtimeToss: the designed toss is logged after regulation and the overtime opens with a kickoff", () => {
    let found: GameRecord | null = null;
    for (let seed = 1; seed < 400 && found === null; seed++) {
      const r = playGame(setupGame(teams, 2026, seed, () => coach), kit, Rng.fromSeed(seed));
      if (r.events.some((e) => e.t === "toss")) found = r;
    }
    expect(found, "an overtime game within 400 seeds").not.toBeNull();
    const ev = (found as GameRecord).events;
    const tossAt = ev.findIndex((e) => e.t === "toss");
    const toss = ev[tossAt] as Extract<GameRecord["events"][number], { t: "toss" }>;
    expect(ev.slice(0, tossAt).some((e) => e.t === "endPeriod" && e.period === data.engine.rules.game.regulationPeriods)).toBe(true);
    const next = ev.slice(tossAt + 1).find((e) => e.t === "play");
    expect(next?.t === "play" && next.before.phase).toBe("kickoff");
    // The kicking team is the one that does not receive.
    expect(next?.t === "play" && next.before.possession).not.toBe(toss.receiver);
  });
});

describe("A4: decision policies see only the views (type level)", () => {
  it("each pre-snap policy takes exactly the shared views", () => {
    expectTypeOf<Parameters<CoachPolicies["offenseCall"]>[0]>().toEqualTypeOf<Situation>();
    expectTypeOf<Parameters<CoachPolicies["defenseCall"]>[0]>().toEqualTypeOf<Situation>();
    expectTypeOf<Parameters<CoachPolicies["timeout"]>[0]>().toEqualTypeOf<CoachView>();
    expectTypeOf<Parameters<CoachPolicies["tempo"]>[0]>().toEqualTypeOf<CoachView>();
    expectTypeOf<Parameters<CoachPolicies["runoffTimeout"]>[0]>().toEqualTypeOf<CoachView>();
    expectTypeOf<Parameters<CoachPolicies["onside"]>[0]>().toEqualTypeOf<KickView>();
    // Amended 2026-11-12 (M1 step 5c milestone D): the policy also sees the kick view (clock and
    // score, a shared view), optional, for the time-binned rates before kickoffs and tries.
    expectTypeOf<Parameters<CoachPolicies["specialTimeout"]>>().toEqualTypeOf<[CoachSpecialRole, number, number, Rng, (KickView | undefined)?]>();
  });

  it("CoachView is Situation plus clock and dead-ball fields only: no call, formation, players or GameState", () => {
    type Extra = Exclude<keyof CoachView, keyof Situation>;
    expectTypeOf<Extra>().toEqualTypeOf<
      "clockRunning" | "playClock" | "previousSnapKneel" | "previousSnapRestart" | "beforeTimeout" | "offenseTimeoutsThisDeadBall" | "defenseTimeoutsThisDeadBall"
    >();
    expectTypeOf<keyof KickView>().toEqualTypeOf<"quarter" | "secondsLeftInHalf" | "secondsLeftInGame" | "scoreDiff" | "safetyKick">();
    // Every field is a plain number, boolean or the shared phase string.
    expectTypeOf<CoachView[keyof CoachView]>().toEqualTypeOf<number | boolean | Situation["phase"]>();
  });
});
type CoachSpecialRole = Parameters<CoachPolicies["specialTimeout"]>[0];

describe("C6: masking and clipping", () => {
  it("the average coach never calls a timeout with none left or with its per-dead-ball timeout taken", () => {
    const rng = Rng.fromSeed(606);
    const per = data.engine.rules.timeouts.perTeamPerDeadBall;
    for (let i = 0; i < 2000; i++) {
      const q = 1 + Math.floor(rng.nextFloat() * 4);
      const half = 1 + Math.floor(rng.nextFloat() * 1800);
      const v: CoachView = {
        phase: "scrimmage", down: 1 + Math.floor(rng.nextFloat() * 4), yardsToGo: 10, yardLine100: 1 + Math.floor(rng.nextFloat() * 99),
        scoreDiff: Math.floor(rng.nextFloat() * 41) - 20, quarter: q, secondsLeftInHalf: half, secondsLeftInGame: q <= 2 ? half + 1800 : half,
        offenseTimeouts: Math.floor(rng.nextFloat() * 4), defenseTimeouts: Math.floor(rng.nextFloat() * 4), clockRunning: rng.nextFloat() < 0.5,
        playClock: 40, previousSnapKneel: false, previousSnapRestart: 0, beforeTimeout: false, offenseTimeoutsThisDeadBall: 0, defenseTimeoutsThisDeadBall: 0,
      };
      const r = Rng.fromSeed(i);
      expect(coach.timeout({ ...v, offenseTimeouts: 0 }, "offense", r)).toBe(false);
      expect(coach.timeout({ ...v, defenseTimeouts: 0 }, "defense", r)).toBe(false);
      expect(coach.timeout({ ...v, offenseTimeoutsThisDeadBall: per }, "offense", r)).toBe(false);
      expect(coach.timeout({ ...v, defenseTimeoutsThisDeadBall: per }, "defense", r)).toBe(false);
    }
    for (const role of ["kickKicker", "kickReceiver", "tryOffense", "tryDefense"] as const) {
      for (let i = 0; i < 200; i++) {
        expect(coach.specialTimeout(role, 0, 0, Rng.fromSeed(i))).toBe(false);
        expect(coach.specialTimeout(role, 3, per, Rng.fromSeed(i))).toBe(false);
      }
    }
  });

  it("a run-off drawn above the play clock is clipped to the play clock the coach saw", () => {
    const seen: number[] = [];
    const greedy = logged([], { tempo: (v) => (seen.push(v.playClock), 99) });
    const r = playGame(setupGame(teams, 2026, 31, () => greedy), kit, Rng.fromSeed(31));
    const runoffs = r.events.flatMap((e) => (e.t === "runoff" ? [e] : []));
    const expected = seen.filter((p) => p > 0);
    expect(runoffs.length).toBe(expected.length);
    runoffs.forEach((e, i) => {
      expect(e.drawn).toBe(99);
      expect(e.seconds).toBe(expected[i]);
      expect(e.seconds).toBeLessThanOrEqual(40);
    });
    expect(r.final.phase).toBe("final");
  });

  it("onside only when the rule set allows it (rule set override: trailing only)", () => {
    const base = json<Record<string, unknown> & { kickoff: { onside: Record<string, unknown> } & Record<string, unknown> }>(RULES_FILE);
    const strict = loadGameData({ override: { [RULES_FILE]: { ...base, kickoff: { ...base.kickoff, onside: { ...base.kickoff.onside, allowedWhen: "trailing" } } } } });
    const strictKit = prepareGame(strict);
    const always = logged([], { onside: () => true }, averageCoachFor(strict));
    let onside = 0;
    let regular = 0;
    for (const seed of [41, 42, 43, 44]) {
      const r = playGame(setupGame(teams, 2026, seed, () => always), strictKit, Rng.fromSeed(seed));
      for (const e of plays(r).filter((p) => p.before.phase === "kickoff")) {
        const k = e.before.possession;
        const trailing = e.before.score[k] < e.before.score[k === "home" ? "away" : "home"];
        expect(e.offense.call, `kickoff at ${JSON.stringify(e.before.score)}`).toBe(trailing ? "onsideKick" : "kickoff");
        if (trailing) onside++;
        else regular++;
      }
    }
    expect(onside).toBeGreaterThan(0);
    expect(regular).toBeGreaterThan(0);
  });
});

describe("F1: loop invariants on a fast soak (the full 10,000 run is recorded in the summaries)", () => {
  it("300 regular-season and 200 postseason games end, no postseason tie, timeouts never below 0, snaps under the bound", () => {
    const leagues = [leagueFromSeed(data, 1).teams, leagueFromSeed(data, 2).teams, leagueFromSeed(data, 3).teams];
    const loop = data.config.loop;
    let ot = 0;
    for (let g = 0; g < 500; g++) {
      const post = g >= 300;
      const lg = leagues[g % 3] as typeof teams;
      const seed = 900_000 + g;
      const r = playGame(setupGame(lg, g % 3, seed, () => coach, post ? "postseason" : "regularSeason"), kit, Rng.fromSeed(seed));
      expect(r.final.phase).toBe("final");
      expect(r.final.result).not.toBeNull();
      if (post) expect(r.final.result?.winner, `postseason game ${seed}`).not.toBeNull();
      expect(r.inputs).toBeLessThanOrEqual(loop.maxInputsPerGame);
      for (const e of r.events) {
        if (e.t === "timeout") expect(e.left).toBeGreaterThanOrEqual(0);
        if ("before" in e) for (const t of ["home", "away"] as const) expect(e.before.timeouts[t]).toBeGreaterThanOrEqual(0);
      }
      const box = boxScore(r, data.engine.rules);
      expect(box.home.scrimmagePlays + box.away.scrimmagePlays).toBeLessThanOrEqual(loop.maxScrimmageSnapsPerGame);
      if (box.overtime) ot++;
    }
    expect(ot).toBeGreaterThan(0);
  }, 60_000);

  it("both committed summaries record 10,000 games, zero violations and a 1,000-game postseason soak with no tie", () => {
    for (const f of Object.values(SUMMARY)) {
      const s = json<{ games: number; invariants: { violations: number; postseasonGames: number; postseasonTies: number } }>(f);
      expect(s.games, f).toBe(10_000);
      expect(s.invariants, f).toMatchObject({ violations: 0, postseasonGames: 1000, postseasonTies: 0 });
    }
  });
});

describe("C1, C3, C7, C8: coach decision tables", () => {
  it("C1: DECISIONS.md records what play_clock holds, from the data dictionary and a hand check, and the method chosen", () => {
    const s = section(read("docs/DECISIONS.md"), "What nflverse `play_clock` holds");
    expect(s).toMatch(/data dictionary/i);
    expect(s).toMatch(/hand check/i);
    expect(s).toMatch(/fallback|duration/i);
    expect(s).toMatch(/2022-2023/);
  });

  it("C3: no table records a 2024, 2025 or 2026 season", () => {
    for (const f of ["data/game/tempo.json", "data/game/timeouts.json", "data/game/onside.json", "data/game/ep.json"]) {
      const t = json<{ seasons: number[] }>(f);
      expect(t.seasons.length, f).toBeGreaterThan(0);
      for (const s of t.seasons) expect(s, f).toBeLessThan(2024);
    }
    expect(json<{ seasons: number[] }>("data/game/tempo.json").seasons).toEqual([2022, 2023]);
  });

  it("C7: the component validation has every coach metric in both blocks, statuses follow from the numbers, tolerances hash matches", () => {
    const tolBytes = readFileSync(join(REPO, "data/game/tolerances.json"));
    const tol = JSON.parse(tolBytes.toString("utf8")) as Tolerances;
    const v = json<{ tolerancesSha256: string; inSample: { metrics: { id: string; predicted: number; actual: number; n: number; status: string }[] }; holdout: { metrics: { id: string; predicted: number; actual: number; n: number; status: string }[] } }>("data/game/coach.validation.json");
    expect(v.tolerancesSha256).toBe(sha256(tolBytes));
    const ids = tol.metrics.filter((m) => m.id.startsWith("coach.")).map((m) => m.id).sort();
    for (const id of ["coach.tempo.meanRunoff.H1", "coach.timeouts.perTeamGame", "coach.timeouts.rate.defense.c40", "coach.onside.rate.trailingQ4"]) expect(ids).toContain(id);
    for (const block of [v.inSample, v.holdout]) {
      expect(block.metrics.map((m) => m.id).sort()).toEqual(ids);
      for (const m of block.metrics) {
        const t = tol.metrics.find((x) => x.id === m.id);
        expect(m.status, m.id).toBe(statusOf({ id: m.id, predicted: m.predicted, actual: m.actual, tolerance: t?.tolerance ?? null, gateN: m.n, minN: t?.minN ?? 0, gated: t?.gated ?? true }, new Set()));
      }
    }
  });

  it("C8: MODEL.md Clock and tempo labels the models mixed and states the designed ten-second run-off rule", () => {
    const s = section(read("docs/MODEL.md"), "Clock and tempo");
    expect(s).toMatch(/Ten-second run-off \(designed\)/);
    expect(s).toMatch(/Onside/);
  });
});

describe("B4: league size, pairing and team design recorded", () => {
  it("DECISIONS.md has league size, pairing rule and designed teams", () => {
    const s = section(read("docs/DECISIONS.md"), "League, team strength and home field");
    expect(s).toMatch(/32 teams per league/);
    expect(s).toMatch(/Pairings?:/);
    expect(s).toMatch(/designed/i);
  });

  it("MODEL.md has the league size and pairing rule", () => {
    const model = read("docs/MODEL.md");
    const s = section(model, "Full-game loop and calibration") + section(model, "Home field");
    expect(s).toMatch(/32 teams/);
    expect(s).toMatch(/pair/i);
  });
});

describe("E1, E4: CLI header, event lines and box score", () => {
  const text = simGame(["--seed", "3", "--league-seed", "2026"]);
  const record = JSON.parse(simGame(["--seed", "3", "--league-seed", "2026", "--format", "json"])) as GameRecord;

  it("header has the rule set id and hash, every data hash, both team names with home and away", () => {
    const head = text.split("\n").slice(0, 6).join("\n");
    expect(head).toContain(`nfl-2026 sha256 ${data.rulesHash}`);
    for (const [f, h] of Object.entries(record.dataHashes)) expect(head, f).toContain(`${f.replace(/^data\//, "")}:${h.slice(0, 12)}`);
    expect(head).toMatch(new RegExp(`away ${record.teams.away}.*home ${record.teams.home}`));
  });

  it("separate lines for timeouts, run-off, two-minute warning, penalties with accept or decline, end of quarter", () => {
    expect(text).toMatch(/Timeout \S+ \((offense|defense)\), \d left\./);
    expect(text).toMatch(/lets \d+ s run before the snap/);
    expect(text).toMatch(/Two-minute warning\./);
    expect(text).toMatch(/PENALTY: .*accepted/);
    // Amended 2026-11-12 (M1 step 5c): seed 3's game no longer has a declined foul after the step 5c
    // table changes, so the declined clause is checked on the first of seeds 3-6 that has one.
    const declined = [3, 4, 5, 6].map((sd) => simGame(["--seed", String(sd), "--league-seed", "2026"])).find((t) => /PENALTY: .*declined/.test(t));
    expect(declined).toMatch(/PENALTY: .*declined/);
    expect(text).toMatch(/End of Q1:/);
  });

  it("box score lists every line the spec names", () => {
    const box = text.slice(text.indexOf("BOX SCORE"));
    for (const label of ["Q1", "Final", "First downs", "Total yards", "Rushing", "Passing (comp-att", "Sacks", "Turnovers", "Penalties-yards", "3rd down", "4th down", "Time of possession", "Punts", "Field goals (made-att)", "DRIVES"]) {
      expect(box, label).toContain(label);
    }
  });

  it("E4: total yards = rushing + passing - sack yards, turnovers = interceptions + fumbles lost, penalty yards sum, TOP covers the game", () => {
    const box = boxScore(record, data.engine.rules);
    const shorts = /away .*\((\S+)\)\s+at\s+home .*\((\S+)\)/.exec(text)?.slice(1) ?? [];
    const lines = text.split("\n");
    const colHead = lines.find((l, i) => i > lines.indexOf("BOX SCORE") && l.trim().split(/\s+/).length === 2 && shorts.every((s) => l.includes(s))) ?? "";
    const awayFirst = colHead.indexOf(shorts[0] ?? "?") < colHead.indexOf(shorts[1] ?? "?");
    for (const t of ["home", "away"] as const) {
      const b = box[t];
      const line = (label: string) => lines.find((l) => l.startsWith(label)) ?? "";
      const cols = (label: string) => line(label).slice(label.length).trim().split(/\s{2,}/);
      const col = (t === "away") === awayFirst ? 0 : 1;
      // DECISIONS.md, Box score and drives: sacks are subtracted from passing in the total.
      expect(Number(cols("Total yards")[col])).toBe(b.rushYards + b.passYards - b.sackYards);
      expect(cols("Turnovers (int, fum)")[col]).toBe(`${b.interceptions + b.fumblesLost} (${b.interceptions}, ${b.fumblesLost})`);
      expect(cols("Penalties-yards")[col]).toBe(`${b.penalties}-${b.penaltyYards}`);
    }
    const regulation = data.engine.rules.game.regulationPeriods * data.engine.rules.game.periodSeconds;
    const top = box.home.possessionSeconds + box.away.possessionSeconds;
    expect(box.overtime).toBe(false);
    expect(Math.abs(top - regulation)).toBeLessThanOrEqual(5);
  });
});

describe("F4: PERF.md records the step 5 run", () => {
  it("has the command, machine, ms per game and wall clock of the committed run", () => {
    const perf = read("docs/PERF.md");
    const s = json<{ perf: { msPerGame: number; machine: string } }>(SUMMARY.holdout);
    expect(perf).toMatch(/M1 step 5/);
    expect(perf).toContain("scripts/game/calibrate.ts");
    expect(perf).toMatch(/wall clock/);
    expect(perf).toContain(`${s.perf.msPerGame.toFixed(1)} ms per game`);
    expect(perf).toMatch(/Apple M4/);
  });
});

describe("G1, G3, G5: tolerances and the report", () => {
  const tolSha = sha256(readFileSync(join(REPO, "data/game/tolerances.json")));
  const report = read("docs/GAME_REPORT.md");

  it("G1: the tolerances sha256 is in DECISIONS.md, the report and both summaries", () => {
    expect(read("docs/DECISIONS.md")).toContain(tolSha);
    expect(report).toContain(tolSha);
    for (const f of Object.values(SUMMARY)) expect(json<{ tolerancesSha256: string }>(f).tolerancesSha256).toBe(tolSha);
  });

  it("G5: the pre-registered hash in DECISIONS.md is the current file; known deviations only from Joseph", () => {
    const s = section(read("docs/DECISIONS.md"), "Game-level and component tolerances pre-registered");
    expect(s).toContain(tolSha);
    const tol = json<Tolerances>("data/game/tolerances.json");
    for (const d of tol.known_deviations) expect(d.approved_by).toBe("Joseph");
  });

  for (const [target, heading] of [["insample", "1. In-sample check"], ["holdout", "2. Validation"]] as const) {
    it(`G3: ${target} section has every metric with predicted, actual, n, interval, tolerance, spread and status, matching the summary`, () => {
      const s = json<{ metrics: { id: string; status: string }[] }>(SUMMARY[target]);
      const sec = section(report, heading);
      expect(sec).toMatch(/\| Metric \| Predicted \| Actual \| n \| 95% interval of actual \| Tolerance \| Spread across leagues \| Status \|/);
      for (const m of s.metrics) {
        const row = sec.split("\n").find((l) => l.startsWith(`| \`${m.id}\` |`));
        expect(row, m.id).toBeDefined();
        expect(row?.split("|").length, m.id).toBe(10);
        expect(row?.trim().endsWith(`| ${m.status} |`), m.id).toBe(true);
      }
      const fails = s.metrics.filter((m) => m.status === "fail").map((m) => `\`${m.id}\``);
      const line = sec.split("\n").find((l) => l.startsWith("Gated failures:"));
      expect(line).toBe(`Gated failures: ${fails.join(", ")}.`);
      // The three expected misses stated before the run, each with its outcome.
      const misses = sec.slice(sec.indexOf("Expected misses"));
      expect(misses.match(/Outcome:/g)?.length).toBe(3);
    });
  }

  it("G3/G5: MODEL.md states the current gated failure counts and directions of the committed runs", () => {
    const fails = (t: keyof typeof SUMMARY) => json<{ metrics: { status: string }[] }>(SUMMARY[t]).metrics.filter((m) => m.status === "fail").length;
    const s = section(read("docs/MODEL.md"), "Full-game loop and calibration");
    expect(s).toContain(`in-sample ${fails("insample")} gated failures`);
    expect(s).toContain(`holdout ${fails("holdout")}`);
  });
});

describe("G6: CLAUDE.md and DECISIONS.md", () => {
  const claude = read("CLAUDE.md");

  it("the three open issues are settled with a pointer to DECISIONS.md", () => {
    const line = claude.split("\n").find((l) => /settled/i.test(l) && /challenges/i.test(l));
    expect(line).toBeDefined();
    expect(line).toMatch(/CI|slice/);
    expect(line).toMatch(/home field/i);
    expect(line).toContain("DECISIONS.md");
  });

  it("DECISIONS.md settles the challenges issue (deferred to M2) and the CI sample size", () => {
    const d = read("docs/DECISIONS.md");
    expect(d).toMatch(/challenges[^\n]*deferred to M2|deferred to M2[^\n]*challenges/i);
    expect(d).toMatch(/1,000-game slice|slice of 1,000/i);
  });

  it("the M1 status line is updated past step 1", () => {
    const status = section(claude, "Stack and commands").split("\n").find((l) => /^M1 /.test(l)) ?? "";
    expect(status).toMatch(/step 5|full game|full-game/i);
  });
});
