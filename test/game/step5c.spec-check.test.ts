// Test-writer spec checks for M1 step 5c (docs/specs/m1-step5c-playtest-fixes.md), from the spec, its
// Resolved section, the lead's revision 1 and Joseph's acceptances (docs/DECISIONS.md, M1 step 5c). The
// engineer's repro seeds are in step5c.repro.test.ts; the 10,000-game c.ot.complete soak and the
// 1,500-game G1 text check are in step5c.heavy.test.ts.
//
// Pass rules are evaluated here from the frozen checks file's own text (data/game/step5c-checks.json),
// on the committed counts (data/game/checks5c.real.json, data/game/checks5c.sim.json), not through
// scripts/game/checks5c-rules.ts.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlayResult, Situation } from "../../packages/shared/src/types";
import { offenseShares } from "../../packages/sim/src/caller/offense";
import { averageCoachFor, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { playGame, prepareGame, type GameEvent, type GameKit, type GameRecord } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { REPO, loadGameData } from "../../scripts/game/data";

const read = (f: string): string => readFileSync(join(REPO, f), "utf8");
const json = <T>(f: string): T => JSON.parse(read(f)) as T;
const sha = (f: string): string => createHash("sha256").update(readFileSync(join(REPO, f))).digest("hex");
const between = (doc: string, start: string, end: string | null): string => {
  const a = doc.indexOf(start);
  if (a < 0) throw new Error(`missing section: ${start}`);
  const b = end === null ? -1 : doc.indexOf(end, a + start.length);
  return doc.slice(a, b < 0 ? undefined : b);
};
const tableRows = (sec: string): string[][] =>
  sec.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));

const spec = read("docs/specs/m1-step5c-playtest-fixes.md");
const decisions = read("docs/DECISIONS.md");
const d5c = between(decisions, "## M1 step 5c", "\n## Publishing");
const gameReport = read("docs/GAME_REPORT.md");
const callerReport = read("docs/CALLER_REPORT.md");

const CHECKS_SHA = "2c9f459154298ac65a0ab4c52bf5a39bd27515a934ee4aaeb040b739c55115de";

interface Check { id: string; measure: string; passRule: string; playtestReference: string }
interface Run { label: string; games: number; counts: Record<string, number>; byLeague: Record<string, number>[]; ot: { games: number; noRecord: number; ties: number; errors: string[] } }
interface Accepted { check: string; observed: number; real: number; unit: string; scope: string; date: string; approved_by: string }
interface Metric { id: string; predicted: number; actual: number; status: string; tolerance?: number; spread?: number[] }
interface Deviation { metric: string; observed: number; target: number; reason: string; scope?: string; date: string; approved_by: string }

const checksFile = json<{ checks: Check[] }>("data/game/step5c-checks.json");
const sim = json<{ runs: Record<string, Run> }>("data/game/checks5c.sim.json").runs;
const real = json<{ counts: Record<string, number>; seasons: number[] }>("data/game/checks5c.real.json");
const accepted = json<{ accepted: Accepted[] }>("data/game/step5c-accepted.json").accepted;
const insample = json<{ metrics: Metric[]; runSeed: number; games: number; leagueSeeds: number[] }>("data/game/calibration.insample.json");
const stages5b = json<{ runs: Record<string, { metrics: Metric[]; extras: Record<string, number> }> }>("data/game/calibration.insample.stages5b.json");
const tol = json<{ metrics: { id: string; gated: boolean }[]; known_deviations: Deviation[] }>("data/game/tolerances.json");

// ---------------------------------------------------------------- measures and pass rules (spec table)

const n = (c: Record<string, number>, k: string): number => c[k] ?? 0;
const pct = (c: Record<string, number>, hit: string, of: string): number => (100 * n(c, hit)) / n(c, of);
const perGame = (c: Record<string, number>, k: string): number => n(c, k) / n(c, "games");

/** The value of a check's measure on one side's counts, in the unit its pass rule uses. */
const value = (id: string, c: Record<string, number>): number => {
  switch (id) {
    case "c.trail.lastSnap": return pct(c, "trail.lastSnap", "games");
    case "c.trail.longGap": return pct(c, "trail.longGap.hits", "trail.longGap.gaps");
    case "c.spike.stopped": return perGame(c, "spike.stopped");
    case "c.kneel.ballBack": return pct(c, "kneel.ballBack", "kneel.games");
    case "c.kneel.shortGap0TO": return pct(c, "kneel.shortGap0TO.hits", "kneel.shortGap0TO.gaps");
    case "c.kneel.early": return perGame(c, "kneel.early");
    case "c.fg.60": return perGame(c, "fg.60");
    case "c.fg.63": return perGame(c, "fg.63");
    case "c.fg.70": return perGame(c, "fg.70");
    case "c.fg.50to59": return perGame(c, "fg.50to59");
    case "c.try.down2GF": return pct(c, "try.down2GF.two", "try.down2GF.tries");
    case "c.try.tiedG5": return pct(c, "try.tiedG5.kick", "try.tiedG5.tries");
    case "c.to.kickoffQ13": return perGame(c, "to.kickoffQ13");
    case "c.to.tryQ13": return perGame(c, "to.tryQ13");
    case "c.to.kickoffAll": return perGame(c, "to.kickoffAll");
    case "c.rough.scramble": return perGame(c, "rough.scramble");
    default: throw new Error(`no measure for ${id}`);
  }
};

/** Evaluates a pass rule as written in the frozen checks file. */
const passes = (check: Check, run: Run): boolean => {
  const r = check.passRule;
  if (check.id === "c.ot.complete") {
    expect(r).toBe("both 0");
    return run.ot.games === 10_000 && run.ot.noRecord === 0 && run.ot.ties === 0;
  }
  const s = value(check.id, run.counts);
  const q = value(check.id, real.counts);
  let m: RegExpMatchArray | null;
  if ((m = r.match(/^abs\(sim - real\) <= ([\d.]+)( pp)?$/)) !== null) return Math.abs(s - q) <= Number(m[1]);
  if ((m = r.match(/^sim <= real \+ ([\d.]+)$/)) !== null) return s <= q + Number(m[1]);
  if ((m = r.match(/^sim <= ([\d.]+)$/)) !== null) return s <= Number(m[1]);
  if ((m = r.match(/^sim >= real - ([\d.]+) pp$/)) !== null) return s >= q - Number(m[1]);
  throw new Error(`unparsed pass rule for ${check.id}: ${r}`);
};
const byId = new Map(checksFile.checks.map((c) => [c.id, c]));
const check = (id: string): Check => {
  const c = byId.get(id);
  if (c === undefined) throw new Error(`no check ${id}`);
  return c;
};
const acceptedFor = (id: string): Accepted | undefined => accepted.find((a) => a.check === id);
/** A check passes at run H, or it fails and Joseph accepted it at its run H value. */
const passOrAcceptedAtH = (id: string): string | null => {
  const H = sim["H"] as Run;
  if (passes(check(id), H)) return null;
  const a = acceptedFor(id);
  if (a === undefined) return `${id}: fails at run H (${value(id, H.counts).toFixed(4)} vs ${value(id, real.counts).toFixed(4)}) and is not accepted`;
  return null;
};

// ---------------------------------------------------------------- 0: checks and measures

describe("0.1: the checks file is the spec table, frozen and hashed first", () => {
  it("sha256 is the pre-registered value, and DECISIONS.md records it", () => {
    expect(sha("data/game/step5c-checks.json")).toBe(CHECKS_SHA);
    expect(between(d5c, "### Checks pre-registered", "\n### ")).toContain(CHECKS_SHA);
  });

  it("every row of the spec's table is in the file verbatim, and nothing else", () => {
    const sec = between(spec, "## Pre-registered checks", "\nReported, not gated");
    const rows = tableRows(sec).filter((r) => r[0]?.startsWith("`"));
    expect(rows).toHaveLength(17);
    const want = rows.map(([id, measure, rule, ref]) => ({ id: (id ?? "").replace(/`/g, ""), measure, passRule: rule, playtestReference: ref }));
    expect(checksFile.checks.map((c) => ({ id: c.id, measure: c.measure, passRule: c.passRule, playtestReference: c.playtestReference }))).toEqual(want);
  });

  // Needs the git history (a full clone; CI's test job uses a shallow checkout, so it runs locally).
  const history = ((): boolean => {
    try {
      execFileSync("git", ["cat-file", "-e", "4f286a6^{commit}"], { cwd: REPO, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  const git = (...a: string[]): string => execFileSync("git", a, { cwd: REPO, encoding: "utf8" }).trim();

  it.runIf(history)("its commit holds that file alone, and the hash was recorded before any measure, fix or run commit", () => {
    const added = git("log", "--diff-filter=A", "--format=%H", "--", "data/game/step5c-checks.json").split("\n");
    expect(added).toHaveLength(1);
    expect(git("show", "--name-only", "--format=", added[0] as string).split("\n")).toEqual(["data/game/step5c-checks.json"]);
    // Never edited after.
    expect(git("log", "--format=%H", "--", "data/game/step5c-checks.json").split("\n")).toEqual(added);
    const recorded = git("log", "--reverse", "--format=%H", `-S${CHECKS_SHA}`, "--", "docs/DECISIONS.md").split("\n")[0] as string;
    expect(recorded).not.toBe("");
    // Every commit that touches the measure code, the sim, the fitted tables or a run output comes after it.
    const later = ["pipeline/game/checks5c.py", "scripts/game/checks5c.ts", "data/game/checks5c.sim.json", "data/game/checks5c.real.json", "packages/sim/src", "pipeline/game/decisions.py"];
    const firsts = later.flatMap((p) => git("log", "--reverse", "--format=%H", `${added[0] as string}..HEAD`, "--", p).split("\n").slice(0, 1)).filter((h) => h !== "");
    expect(firsts.length).toBeGreaterThan(0);
    for (const h of firsts) {
      expect(h).not.toBe(recorded);
      expect(() => execFileSync("git", ["merge-base", "--is-ancestor", recorded, h], { cwd: REPO }), h).not.toThrow();
    }
  });

  it("DECISIONS.md records the hash with a timestamp (spec 0.1 asks for a timestamp, not only a date)", () => {
    const sec = between(d5c, "### Checks pre-registered", "\n### ");
    expect(sec).toMatch(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/);
  });
});

describe("0.2, 0.3: real side and the baseline", () => {
  it("0.2: the real side is 2016-2023 only and carries every measure's counts", () => {
    expect(real.seasons).toEqual([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023]);
    expect(real.counts["games"]).toBeGreaterThan(2000);
    for (const c of checksFile.checks) if (c.id !== "c.ot.complete") expect(Number.isFinite(value(c.id, real.counts)), c.id).toBe(true);
  });

  it("0.3: at the baseline every check fails or sits on the playtest's side of real; any exception has a written reason", () => {
    const base = sim["baseline"] as Run;
    const out: string[] = [];
    const num = (s: string): number | null => {
      const f = s.match(/^(\d+)\/(\d+)$/);
      if (f !== null) return (100 * Number(f[1])) / Number(f[2]);
      const p = s.match(/^([\d.]+)%?$/);
      return p === null ? null : Number(p[1]);
    };
    for (const c of checksFile.checks) {
      if (c.id === "c.ot.complete") {
        if (passes(c, base)) out.push(`${c.id}: no crash at the baseline`);
        continue;
      }
      const ref = c.playtestReference.split(" vs ").map((x) => num(x.trim()));
      const fails = !passes(c, base);
      if (ref.length !== 2 || ref[0] === null || ref[1] === null) {
        // No playtest direction: a pass at the baseline needs a written reason in DECISIONS.md.
        if (!fails && !between(d5c, "### Measures", "\n### ").includes(`\`${c.id}\` passes at baseline`)) out.push(`${c.id}: passes at baseline with no written reason`);
        continue;
      }
      const side = Math.sign((ref[0] as number) - (ref[1] as number));
      const now = Math.sign(value(c.id, base.counts) - value(c.id, real.counts));
      if (!fails && now !== side) out.push(`${c.id}: passes and is not on the playtest side`);
    }
    expect(out).toEqual([]);
    const sec = between(gameReport, "### Step 5c pre-registered checks", "\n## ");
    for (const c of checksFile.checks) expect(sec, c.id).toMatch(new RegExp(`\\| \`${c.id.replace(/\./g, "\\.")}\` \\| `));
    expect(sec).toMatch(/baseline = before step 5c/);
  });
});

// ---------------------------------------------------------------- the committed runs

describe("the committed in-sample run is run H, and the baseline block is the step 5b run 5c started from", () => {
  const shares = ["0", "1-3", "4-7", "8-14", "15-21", "22+"];
  it("absMargin shares in calibration.insample.json equal run H's margin counts; the 5b after-C stage equals the baseline's", () => {
    const H = sim["H"] as Run;
    const base = sim["baseline"] as Run;
    const now = new Map(insample.metrics.map((m) => [m.id, m.predicted]));
    const afterC = new Map(stages5b.runs["afterC"]?.metrics.map((m) => [m.id, m.predicted]));
    for (const s of shares) {
      expect(now.get(`absMargin.share.${s}`), `H ${s}`).toBeCloseTo((100 * n(H.counts, `margin.${s}`)) / H.games, 9);
      expect(afterC.get(`absMargin.share.${s}`), `baseline ${s}`).toBeCloseTo((100 * n(base.counts, `margin.${s}`)) / base.games, 9);
    }
    expect(insample.games).toBe(H.games);
    expect(insample.runSeed).toBe(20261112);
  });
});

// ---------------------------------------------------------------- milestone criteria at the final run (H1)

describe("pre-registered checks at run H, by milestone", () => {
  const group = (name: string, ids: string[]): void => {
    it(`${name}: ${ids.join(", ")} pass in-sample (or Joseph accepted the miss)`, () => {
      expect(ids.map(passOrAcceptedAtH).filter((x) => x !== null)).toEqual([]);
    });
  };
  group("A2", ["c.ot.complete"]);
  group("B1", ["c.fg.60", "c.fg.63", "c.fg.70", "c.fg.50to59"]);
  group("C1", ["c.try.down2GF", "c.try.tiedG5"]);
  group("D1", ["c.to.kickoffQ13", "c.to.tryQ13", "c.to.kickoffAll"]);
  group("E1", ["c.trail.lastSnap", "c.trail.longGap", "c.spike.stopped"]);
  group("F1", ["c.kneel.ballBack", "c.kneel.shortGap0TO", "c.kneel.early"]);
  group("G2", ["c.rough.scramble"]);

  it("H1: every one of the 17 checks is covered by a group above", () => {
    expect(checksFile.checks.map((c) => c.id).sort()).toEqual([
      "c.fg.50to59", "c.fg.60", "c.fg.63", "c.fg.70", "c.kneel.ballBack", "c.kneel.early", "c.kneel.shortGap0TO", "c.ot.complete", "c.rough.scramble",
      "c.spike.stopped", "c.to.kickoffAll", "c.to.kickoffQ13", "c.to.tryQ13", "c.trail.lastSnap", "c.trail.longGap", "c.try.down2GF", "c.try.tiedG5",
    ]);
  });

  it("every acceptance is Joseph's, in-sample, dated, for a check that really fails at H, at its run H value, and recorded in DECISIONS.md", () => {
    const H = sim["H"] as Run;
    const sec = between(d5c, "### 5c checks accepted (Joseph, 2026-11-12)", "\n### ");
    expect(accepted.length).toBeGreaterThan(0);
    for (const a of accepted) {
      const c = check(a.check);
      expect([a.approved_by, a.scope, a.date], a.check).toEqual(["Joseph", "insample", "2026-11-12"]);
      expect(passes(c, H), `${a.check} passes, so it needs no acceptance`).toBe(false);
      // observed and real are the run H values, rounded as written.
      const digits = (x: number): number => (String(x).split(".")[1] ?? "").length;
      expect(a.observed, a.check).toBeCloseTo(value(a.check, H.counts), digits(a.observed));
      expect(a.real, a.check).toBeCloseTo(value(a.check, real.counts), digits(a.real));
      expect(sec, a.check).toContain(`\`${a.check}\``);
    }
  });
});

describe("B4, C3, D3: gated in-sample metrics the milestones name still pass", () => {
  const status = new Map(insample.metrics.map((m) => [m.id, m.status]));
  for (const [crit, ids] of [
    ["B4", ["fieldGoalAttempts.perGame", "driveResult.share.fieldGoal", "driveResult.share.missedFieldGoal"]],
    ["C3", ["twoPointTries.perGame"]],
    ["D3", ["timeouts.perTeamGame"]],
  ] as const) {
    it(`${crit}: ${ids.join(", ")}`, () => {
      for (const id of ids) expect(status.get(id), id).toBe("pass");
    });
  }
});

describe("H1: the final in-sample run against the run 5c started from", () => {
  const covered = (id: string): boolean => tol.known_deviations.some((d) => d.metric === id && d.scope === "insample" && d.approved_by === "Joseph" && d.date === "2026-11-12");
  const gated = new Set(tol.metrics.filter((m) => m.gated).map((m) => m.id));

  it("every gated metric that passed before step 5c still passes (a new miss only with Joseph's in-sample entry)", () => {
    const before = new Map(stages5b.runs["afterC"]?.metrics.map((m) => [m.id, m.status]));
    const out = insample.metrics.filter((m) => gated.has(m.id) && before.get(m.id) === "pass" && m.status !== "pass" && !(m.status === "accepted" && covered(m.id)))
      .map((m) => `${m.id}: ${m.predicted} vs ${m.actual} (${m.status})`);
    expect(out).toEqual([]);
  });

  it("every accepted in-sample game miss is at or better than its accepted value (strict; entries are rounded to 4 places)", () => {
    const ins = json<{ metrics: Metric[]; diagnostics: Record<string, { predicted: number; actual: number }> }>("data/game/calibration.insample.json");
    const now = new Map<string, { predicted: number; actual: number }>([...ins.metrics.map((m) => [m.id, m] as const), ...Object.entries(ins.diagnostics)]);
    const out: string[] = [];
    for (const d of tol.known_deviations.filter((x) => x.scope === "insample")) {
      const m = now.get(d.metric);
      if (m === undefined) {
        out.push(`${d.metric}: not in the run`);
        continue;
      }
      const was = Math.abs(d.observed - d.target);
      const is = Math.abs(m.predicted - m.actual);
      if (is > was + 1e-4) out.push(`${d.metric}: |diff| ${is.toFixed(4)} > accepted ${was.toFixed(4)}`);
    }
    expect(out).toEqual([]);
  });

  it("every accepted in-sample caller miss is at or better than its accepted value (CALLER_REPORT 8b and 8d, one decimal)", () => {
    const callerDevs = json<{ known_deviations: Deviation[] }>("data/caller/tolerances.json").known_deviations.filter((d) => d.scope === "insample");
    expect(callerDevs.length).toBeGreaterThan(0);
    const label = (id: string): RegExp => {
      const m = id.match(/^fourthDown\.(\w+)\.(fieldGoal|go|punt)$/);
      if (m !== null) return new RegExp(`^\\| 4th down ${{ fieldGoal: "field goal", go: "go", punt: "punt" }[m[2] as "go"]}, zone ${m[1]} \\| \\d+ \\| ([\\d.]+) \\| ([\\d.]+) \\|`, "m");
      return new RegExp(`^\\| \`${id.replace(/[.>=]/g, (c) => `\\${c}`)}\` \\| \\d+ \\| ([\\d.]+) \\| ([\\d.]+) \\|`, "m");
    };
    const out: string[] = [];
    for (const d of callerDevs) {
      const sec = d.metric.startsWith("fourthDown") ? between(callerReport, "## 8b.", "\n## 8c") : between(callerReport, "## 8d.", "\n## ");
      const m = sec.match(label(d.metric));
      if (m === null) {
        out.push(`${d.metric}: row not found`);
        continue;
      }
      const is = Math.round(Math.abs(Number(m[1]) - Number(m[2])) * 10) / 10;
      const was = Math.round(Math.abs(d.observed - d.target) * 1000) / 10;
      if (is > was + 1e-9) out.push(`${d.metric}: |diff| ${is} pp > accepted ${was} pp`);
    }
    expect(out).toEqual([]);
  });
});

describe("F3: CALLER_REPORT kneel rows at or better than before step 5c", () => {
  // Before step 5c: docs/CALLER_REPORT.md at commit 3de880d (predicted %, actual %).
  const BEFORE: Record<string, [number, number]> = { "b9.c.kneel.K0": [25.0, 25.1], "b9.c.kneel.K1": [98.2, 98.4], "lateDowns.>=17.kneel": [23.3, 28.6] };
  for (const [id, [p0, a0]] of Object.entries(BEFORE)) {
    it(`${id}`, () => {
      const re = new RegExp(`^\\| \`${id.replace(/[.>=]/g, (c) => `\\${c}`)}\` \\| \\d+ \\| ([\\d.]+) \\| ([\\d.]+) \\|`, "m");
      const m = callerReport.match(re);
      expect(m, id).not.toBeNull();
      const now = Math.round(Math.abs(Number(m?.[1]) - Number(m?.[2])) * 10) / 10;
      const before = Math.round(Math.abs(p0 - a0) * 10) / 10;
      expect(now, `${id}: |diff| now ${now} pp, before ${before} pp`).toBeLessThanOrEqual(before);
    });
  }
});

describe("C4, E3, F4: the report rows the spec asks for", () => {
  const sec = between(gameReport, "### Step 5c pre-registered checks", "\n## ");

  it("C4: sim vs real try shares for every score -8 to +8 in G5 and GF, with n", () => {
    for (const w of ["G5", "GF"]) {
      for (let s = -8; s <= 8; s++) {
        const lab = s > 0 ? `+${s}` : String(s);
        expect(sec, `${w} ${lab}`).toMatch(new RegExp(`\\| ${w} \\| ${lab.replace("+", "\\+")} \\| \\d+/\\d+ \\| \\d+/\\d+ \\|`));
      }
    }
  });

  it("E3, F4: absMargin 1-3, 8-14 and exact 3 before and after E and F, with the league-seed spread", () => {
    const header = tableRows(sec).find((r) => r[0] === "Measure");
    expect(header).toBeDefined();
    const at = (col: string): number => (header as string[]).indexOf(col);
    for (const col of ["CD", "E", "F"]) expect(at(col), col).toBeGreaterThan(0);
    for (const row of ["absMargin 1-3", "absMargin 8-14", "exact 3"]) {
      const r = tableRows(sec).find((x) => x[0] === row);
      expect(r, row).toBeDefined();
      for (const col of ["CD", "E", "F"]) expect((r as string[])[at(col)], `${row} ${col}`).toMatch(/^[\d.]+% \([\d.]+ to [\d.]+\)$/);
    }
  });
});

// ---------------------------------------------------------------- tolerances and approvals (locked rules)

describe("locked: tolerances untouched; only Joseph adds known deviations", () => {
  // Content hashes (sha256 of JSON.stringify(file without known_deviations)), computed by the
  // test-writer on 2026-11-12 from: data/engine/tolerances.json at ef3229e, whose bytes hash to the
  // pre-registered 9fc4993f... (DECISIONS.md, step 4); data/caller/tolerances.json at 338efe7, its first
  // commit (the pre-registered 404552d0... bytes were never committed). The game file is pinned the
  // same way in step5b.spec-check.test.ts (F2).
  const CONTENT: Record<string, string> = {
    "data/caller/tolerances.json": "b27b5ff7e22cba897d24e0081861477aaf7160fe36f20d3af85cf2a9170d9942",
    "data/engine/tolerances.json": "25c80a1ce504ce1dd47898afbec5460a248a73ae87c48b4bedc87d07396691e7",
    "data/game/tolerances.json": "957f93baee86ef016b388c4fa7aaeff6822e3d6ec620ee0de79eb020ade070ea",
  };
  it("every tolerance field is the pre-registered one; the late-check thresholds keep their recorded hash", () => {
    for (const [f, h] of Object.entries(CONTENT)) {
      const rest = json<Record<string, unknown>>(f);
      delete rest["known_deviations"];
      expect(createHash("sha256").update(JSON.stringify(rest)).digest("hex"), f).toBe(h);
    }
    expect(sha("data/caller/latechecks.json")).toBe("06b6244077894771c7f4ee4f4b6b0ade0abc0e619376489d8025b8d0aa74b8f8");
  });

  it("every known deviation in the game, caller and engine files is approved by Joseph, dated, with a reason; game and caller entries carry a scope", () => {
    const out: string[] = [];
    for (const f of ["data/game/tolerances.json", "data/caller/tolerances.json", "data/engine/tolerances.json"]) {
      for (const d of json<{ known_deviations: Deviation[] }>(f).known_deviations) {
        const tag = `${f} ${d.metric} ${d.scope ?? ""}`;
        if (d.approved_by !== "Joseph") out.push(`${tag}: approved_by ${d.approved_by}`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date ?? "")) out.push(`${tag}: date`);
        if (typeof d.reason !== "string" || d.reason.trim() === "") out.push(`${tag}: reason`);
        if (f !== "data/engine/tolerances.json" && d.scope !== "insample" && d.scope !== "holdout") out.push(`${tag}: scope`);
      }
    }
    expect(out).toEqual([]);
  });

  it("each step 5c game deviation matches Joseph's recorded decision (metric, scope, observed, target, date)", () => {
    // From DECISIONS.md: "5c holdout and C3 misses accepted", "5c checks accepted", "5c game holdout misses accepted".
    const want: [string, string, number, number][] = [
      ["coach.timeouts.rate.defense.c40", "holdout", 8.3444, 10.3528],
      ["diag.timeoutRate.offense.L.GF", "insample", 0.0391, 0.0722],
      ["diag.timeoutRate.defense.T.GF", "insample", 0.2007, 0.1741],
      ["absMargin.share.8-14", "insample", 27.92, 22.7053],
      ["homeWin.rate", "holdout", 57.155, 53.1015],
      ["fieldGoalAttempts.perGame", "holdout", 3.7386, 4.0496],
      ["total.mean", "holdout", 44.2341, 45.9246],
      ["absMargin.share.8-14", "holdout", 27.92, 18.0147],
      ["absMargin.share.22+", "holdout", 10.81, 15.9926],
    ];
    for (const [metric, scope, observed, target] of want) {
      const d = tol.known_deviations.filter((x) => x.metric === metric && x.scope === scope);
      expect(d, `${metric} ${scope}`).toHaveLength(1);
      expect([d[0]?.observed, d[0]?.target, d[0]?.date, d[0]?.approved_by], `${metric} ${scope}`).toEqual([observed, target, "2026-11-12", "Joseph"]);
      expect(d5c, `${metric} in DECISIONS 5c`).toContain(metric);
    }
  });
});

// ---------------------------------------------------------------- A3: a game forced past OT4

describe("A3: a postseason game forced past the fourth overtime period", () => {
  const data = loadGameData();
  const kit = prepareGame(data);
  const coach = averageCoachFor(data);
  const rules = data.engine.rules;
  const fmt = rules.overtime.postseason;
  const reg = rules.game.regulationPeriods;
  const forcedThrough = reg + 2 * fmt.periodsPerCoinToss - 2; // OT6: the second period after the second toss
  // Every scrimmage snap through OT6 is a 15-second incompletion and every kickoff a touchback: nobody
  // scores, the clock stops after each snap, 60 snaps a period. That is past the old flat 260-snap cap
  // by OT1, and under the per-period cap. Real plays from OT7 on.
  const forced: GameKit = {
    data,
    resolve: (s, o, d, p, rng) => {
      const r = kit.resolve(s, o, d, p, rng);
      if (s.period > forcedThrough) return r;
      if (s.phase === "scrimmage") return { kind: "pass", seconds: 15, incomplete: true, end: { spot: s.spot, possession: "offense" } } as PlayResult;
      if (s.phase === "kickoff") return { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" } as PlayResult;
      return r;
    },
  };
  // In overtime the defense calls a timeout at every scrimmage dead ball while it has one, so each
  // half's timeouts are spent and a reset (or a carry-over) is visible.
  const spender: typeof coach = { ...coach, timeout: (v, side, rng) => (v.quarter > reg && side === "defense" ? v.defenseTimeouts > 0 : coach.timeout(v, side, rng)) };
  let record: GameRecord | undefined;
  const game = (): GameRecord => {
    record ??= playGame(setupGame(leagueFromSeed(data, 4242).teams, 4242, 599, () => spender, "postseason"), forced, Rng.fromSeed(599));
    return record;
  };
  const before = (e: GameEvent) => ("before" in e ? e.before : null);

  it("finishes with a winner after OT6", () => {
    const r = game();
    expect(r.final.phase).toBe("final");
    expect(r.final.result?.winner).not.toBeNull();
    expect(r.final.period).toBeGreaterThan(forcedThrough);
  }, 60_000);

  it("a coin toss before OT1 and again after the 4th overtime period, and no other", () => {
    const tosses = game().events.flatMap((e) => (e.t === "toss" ? [e.before.period] : []));
    const expected = [reg, reg + fmt.periodsPerCoinToss].concat(game().final.period > reg + 2 * fmt.periodsPerCoinToss ? [reg + 2 * fmt.periodsPerCoinToss] : []);
    expect(tosses).toEqual(expected);
  }, 60_000);

  it("three timeouts at the start of each two-period overtime half; carried over inside a half", () => {
    const evs = game().events;
    const first = new Map<number, { home: number; away: number }>();
    const last = new Map<number, { home: number; away: number }>();
    for (const e of evs) {
      const b = before(e);
      if (b === null) continue;
      if (!first.has(b.period)) first.set(b.period, b.timeouts);
      // A timeout event's own result is `left`; a play's `after` may already be the next period, so use `before`.
      last.set(b.period, e.t === "timeout" ? { ...b.timeouts, [e.team]: e.left } : b.timeouts);
    }
    // Non-vacuous: both teams end every forced overtime half with timeouts spent.
    for (let p = reg + fmt.periodsPerHalf; p <= forcedThrough; p += fmt.periodsPerHalf) {
      const t = last.get(p);
      expect(t !== undefined && t.home < fmt.timeoutsPerHalf && t.away < fmt.timeoutsPerHalf, `timeouts spent by the end of period ${p}`).toBe(true);
    }
    for (let p = reg + 1; p <= forcedThrough + 1; p++) {
      const t = first.get(p);
      expect(t, `period ${p}`).toBeDefined();
      if ((p - reg - 1) % fmt.periodsPerHalf === 0) expect(t, `period ${p} opens a half`).toEqual({ home: fmt.timeoutsPerHalf, away: fmt.timeoutsPerHalf });
      else expect(t, `period ${p} carries period ${p - 1}`).toEqual(last.get(p - 1));
    }
  }, 60_000);

  it("timing as the period in timingAsPeriod: a two-minute warning only in periods timed as Q2 or Q4; a kickoff opens each half", () => {
    const evs = game().events;
    const warned = new Set(evs.flatMap((e) => (e.t === "twoMinuteWarning" ? [e.period] : [])));
    for (let p = reg + 1; p <= forcedThrough; p++) {
      const as = fmt.timingAsPeriod[(p - reg - 1) % fmt.timingAsPeriod.length] as number;
      expect(warned.has(p), `OT${p - reg} timed as Q${as}`).toBe(rules.clock.twoMinuteWarningPeriods.includes(as));
    }
    // OT6 ends with first-half timing: the next period opens with a kickoff, as after halftime.
    const open = evs.find((e) => before(e)?.period === forcedThrough + 1);
    expect(before(open as GameEvent)?.phase).toBe("kickoff");
  }, 60_000);
});

// ---------------------------------------------------------------- C3: try shares outside the late windows

describe("C3: the designed try chart reaches only the final 5:00 of Q4 and overtime", () => {
  const caller = loadGameData().engine.caller;
  const { tryChart: _chart, ...configNoChart } = caller.config;
  void _chart;
  const noChart: typeof caller = { ...caller, config: configNoChart };
  const trySit = (scoreDiff: number, quarter: number, secs: number, yl: number): Situation => ({
    phase: "try", down: 1, yardsToGo: yl, yardLine100: yl, scoreDiff, quarter, secondsLeftInHalf: quarter === 2 || quarter === 4 ? secs : secs + 900,
    secondsLeftInGame: quarter <= 2 ? secs + (quarter === 1 ? 2700 : 1800) : quarter === 3 ? secs + 900 : secs, offenseTimeouts: 2, defenseTimeouts: 2,
  });
  const leaves = (s: Situation, d: typeof caller): string => JSON.stringify(offenseShares(s, d).leaves.map((l) => [l.call, l.twoPointPlay ?? null, l.p]));

  it("outside the window the shares are byte-identical with and without the chart", () => {
    let n = 0;
    for (let q = 1; q <= 4; q++)
      for (const secs of q === 4 ? [900, 600, 301] : [900, 450, 120, 30, 1])
        for (let d = -20; d <= 20; d++)
          for (const yl of [2, 1, 15]) {
            const s = trySit(d, q, secs, yl);
            expect(leaves(s, caller), JSON.stringify(s)).toBe(leaves(s, noChart));
            n++;
          }
    expect(n).toBeGreaterThan(1000);
  });

  it("inside the window the chart does decide some cells (so the comparison above can see it)", () => {
    let differ = 0;
    for (let d = -8; d <= 8; d++) for (const secs of [250, 60]) if (leaves(trySit(d, 4, secs, 2), caller) !== leaves(trySit(d, 4, secs, 2), noChart)) differ++;
    expect(differ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- B1b, E: the masks reach the game's coach

describe("B1b, E: the game's average coach applies the make-chance and stopped-clock masks", () => {
  const data = loadGameData();
  const coach = averageCoachFor(data);
  const sit = (o: Partial<Situation>): Situation => ({
    phase: "scrimmage", down: 4, yardsToGo: 10, yardLine100: 50, scoreDiff: -2, quarter: 2, secondsLeftInHalf: 4, secondsLeftInGame: 1804, offenseTimeouts: 1, defenseTimeouts: 1, ...o,
  });
  const fitted = (s: Situation, call: string): number => offenseShares(s, data.engine.caller).leaves.find((l) => l.call === call)?.p ?? 0;
  const draws = (s: Situation, clockRunning: boolean, call: string): number => {
    const rng = Rng.fromSeed(5);
    let k = 0;
    for (let i = 0; i < 1500; i++) if (coach.offenseCall(s, rng, { clockRunning }).call === call) k++;
    return k;
  };

  it("B1b: no field goal try where the engine's make chance is 0, though the fitted tables alone would kick", () => {
    // 1st and 10 at the own 40 with 0:02 left in Q2: a 77-yard try, past the designed maxDistance.
    const s = sit({ down: 1, yardLine100: 60, secondsLeftInHalf: 2, secondsLeftInGame: 1802, offenseTimeouts: 0 });
    expect(fitted(s, "fieldGoal"), "the fitted share alone kicks here").toBeGreaterThan(0.01);
    expect(draws(s, false, "fieldGoal")).toBe(0);
  });

  it("E: no spike with the clock stopped, though the fitted tables alone would spike (and the coach does with it running)", () => {
    const s = sit({ down: 1, yardLine100: 60, quarter: 4, secondsLeftInHalf: 71, secondsLeftInGame: 71, scoreDiff: -4, offenseTimeouts: 0 });
    expect(fitted(s, "spike"), "the fitted share alone spikes here").toBeGreaterThan(0.01);
    expect(draws(s, false, "spike")).toBe(0);
    expect(draws(s, true, "spike")).toBeGreaterThan(0);
  });
});
