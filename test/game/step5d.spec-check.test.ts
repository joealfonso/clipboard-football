// Test-writer spec checks for M1 step 5d (docs/specs/m1-step5d-clock-fixes.md), from the spec, its
// Resolved section and the M1 step 5d section of docs/DECISIONS.md. Companion files:
// packages/sim/test/game/step5d-flags.spec-check.test.ts (A2 and the train/serve parity scenarios) and
// pipeline/tests/test_step5d_spec.py (0.2, A3, the parity scenarios through the pipeline, D3 and D5 on
// the Python side).
//
// Pass rules are evaluated here from the frozen checks file's own text (data/game/step5d-checks.json) on
// the committed counts (data/game/checks5d.real.json, data/game/checks5d.sim.json), not through
// scripts/game/checks5d-rules.ts. Repro states come from test/fixtures/step5d-repro-states.json,
// captured from the 4f25b28 game loop at the events the spec names.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCallerConfig } from "../../packages/shared/src/schema";
import type { CallerData, CoachView, FactorTable, LateKneelMask, Situation } from "../../packages/shared/src/types";
import { binSituation } from "../../packages/sim/src/caller/bins";
import { inLateKneelMask, offenseShares } from "../../packages/sim/src/caller/offense";
import { toSituation } from "../../packages/sim/src/game/situation";
import type { GameState } from "../../packages/sim/src/game/types";
import { tempoShares } from "../../packages/sim/src/loop/coach";
import { averageCoachFor } from "../../packages/sim/src/loop/league";
import { coachView, type LastSnap } from "../../packages/sim/src/loop/views";
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

const spec = read("docs/specs/m1-step5d-clock-fixes.md");
const decisions = read("docs/DECISIONS.md");
const d5d = between(decisions, "## M1 step 5d", "\n## Publishing");
const sec5d = (title: string): string => between(d5d, title, "\n### ");
const gameReport = read("docs/GAME_REPORT.md");
const callerReport = read("docs/CALLER_REPORT.md");
const model = read("docs/MODEL.md");

const CHECKS_SHA = "3f79f1a626eb27817fd6e0912b7dfde0adf2a44b24009b28f86e1469d7af15a5";
const CHECKS_5C_SHA = "2c9f459154298ac65a0ab4c52bf5a39bd27515a934ee4aaeb040b739c55115de";

interface Check { id: string; gated: boolean; measure: string; passRule: string; whyTolerance: string; reference: string }
interface ChecksFile {
  checks: Check[];
  noRegression5c: { file: string; sha256: string; mustStillPass: string[]; atOrBetterThanRunH: { id: string; runH: string }[] };
}
interface Run { label: string; games: number; counts: Record<string, number>; byLeague: Record<string, number>[]; ot: Record<string, unknown> }
interface Accepted { check: string; observed: number; real: number; unit: string; scope: string; date: string; approved_by: string; reason?: string }
interface Metric { id: string; predicted: number; actual: number; status: string; tolerance?: number }
interface Deviation { metric: string; observed: number; target: number; reason: string; scope?: string; date: string; approved_by: string }

const checksFile = json<ChecksFile>("data/game/step5d-checks.json");
const sim = json<{ runs: Record<string, Run> }>("data/game/checks5d.sim.json").runs;
const real = json<{ counts: Record<string, number>; seasons: number[] }>("data/game/checks5d.real.json");
const accepted = json<{ accepted: Accepted[] }>("data/game/step5d-accepted.json").accepted;
const H = sim["H"] as Run;

// ---------------------------------------------------------------- measures and pass rules (spec table)

const n = (c: Record<string, number>, k: string): number => c[k] ?? 0;
const pct = (c: Record<string, number>, hit: string, of: string): number => (100 * n(c, hit)) / n(c, of);
const perGame = (c: Record<string, number>, k: string): number => n(c, k) / n(c, "games");

/** A check's value on one side's counts, in the unit its pass rule uses (pp for shares). */
const value = (id: string, c: Record<string, number>): number => {
  switch (id) {
    case "d.spike.trail0TO": return perGame(c, "spike.trail0TO");
    case "d.spike.running0TO": return pct(c, "spike.running0TO.spikes", "spike.running0TO.snaps");
    case "d.spike.stopped0TO": return pct(c, "spike.stopped0TO.spikes", "spike.stopped0TO.snaps");
    case "d.gap.trail0TO": return pct(c, "gap.trail0TO.hits", "gap.trail0TO.gaps");
    case "d.kneel.notLeading": return perGame(c, "kneel.notLeading");
    case "d.kneel.thenPlay.lead1to8": return perGame(c, "kneel.thenPlay.lead1to8");
    case "d.kneel.thenPlay.lead9": return perGame(c, "kneel.thenPlay.lead9");
    case "d.kneel.thenPlay.notLeading": return perGame(c, "kneel.thenPlay.notLeading");
    case "d.kneel.4thLate": return perGame(c, "kneel.4thLate");
    default: throw new Error(`no measure for ${id}`);
  }
};
/** d.try.otDown2's sim side: the in-sample run's OT tries plus the league 4242 postseason soak. */
const otDown2 = (run: Run): { tries: number; two: number } => {
  const ot = run.ot as { tries?: number; two?: number };
  return { tries: n(run.counts, "try.otDown2.tries") + (ot.tries ?? 0), two: n(run.counts, "try.otDown2.two") + (ot.two ?? 0) };
};

const byId = new Map(checksFile.checks.map((c) => [c.id, c]));
const check = (id: string): Check => {
  const c = byId.get(id);
  if (c === undefined) throw new Error(`no check ${id}`);
  return c;
};
/** Evaluates a gated pass rule as written in the frozen checks file. */
const passes = (id: string, run: Run): boolean => {
  const c = check(id);
  expect(c.gated, `${id} is gated`).toBe(true);
  const r = c.passRule;
  if (id === "d.try.otDown2") {
    expect(r).toBe("every such sim try is a two-point try; n reported on both sides");
    const t = otDown2(run);
    return t.two === t.tries;
  }
  const s = value(id, run.counts);
  const q = value(id, real.counts);
  let m: RegExpMatchArray | null;
  if ((m = r.match(/^abs\(sim - real\) <= ([\d.]+)( pp)?$/)) !== null) return Math.abs(s - q) <= Number(m[1]);
  if ((m = r.match(/^sim <= real \+ ([\d.]+)( pp)?$/)) !== null) return s <= q + Number(m[1]);
  throw new Error(`unparsed pass rule for ${id}: ${r}`);
};
const GATED = checksFile.checks.filter((c) => c.gated).map((c) => c.id);
const digits = (x: number): number => (String(x).split(".")[1] ?? "").length;
/** Null if the check passes at run H, or fails and Joseph accepted it at exactly its run H value. */
const passOrAcceptedAtH = (id: string): string | null => {
  if (passes(id, H)) return null;
  const a = accepted.filter((x) => x.check === id);
  if (a.length !== 1) return `${id}: fails at run H (${value(id, H.counts).toFixed(4)} vs ${value(id, real.counts).toFixed(4)}) with ${a.length} acceptance records`;
  const x = a[0] as Accepted;
  if (x.approved_by !== "Joseph" || x.scope !== "insample" || x.date !== "2026-11-13") return `${id}: acceptance ${x.approved_by} ${x.scope} ${x.date}`;
  if (Math.abs(x.observed - value(id, H.counts)) >= 0.5 * 10 ** -digits(x.observed)) return `${id}: accepted at ${x.observed}, run H ${value(id, H.counts)}`;
  return null;
};

// ---------------------------------------------------------------- 5c measures (for the no-regression rule)

interface Check5c { id: string; passRule: string }
const checks5c = json<{ checks: Check5c[] }>("data/game/step5c-checks.json").checks;
const sim5c = json<{ runs: Record<string, Run> }>("data/game/checks5c.sim.json").runs;
const real5c = json<{ counts: Record<string, number> }>("data/game/checks5c.real.json");
const value5c = (id: string, c: Record<string, number>): number => {
  const k = id.slice(2);
  switch (id) {
    case "c.trail.lastSnap": return pct(c, "trail.lastSnap", "games");
    case "c.trail.longGap": return pct(c, "trail.longGap.hits", "trail.longGap.gaps");
    case "c.kneel.ballBack": return pct(c, "kneel.ballBack", "kneel.games");
    case "c.kneel.shortGap0TO": return pct(c, "kneel.shortGap0TO.hits", "kneel.shortGap0TO.gaps");
    case "c.try.down2GF": return pct(c, "try.down2GF.two", "try.down2GF.tries");
    case "c.try.tiedG5": return pct(c, "try.tiedG5.kick", "try.tiedG5.tries");
    default: return perGame(c, k);
  }
};
const passes5c = (id: string, run: Run): boolean => {
  const c = checks5c.find((x) => x.id === id);
  if (c === undefined) throw new Error(`no 5c check ${id}`);
  if (id === "c.ot.complete") {
    const ot = run.ot as { games: number; noRecord: number; ties: number; errors: unknown[] };
    return ot.games === 10_000 && ot.noRecord === 0 && ot.ties === 0 && ot.errors.length === 0;
  }
  const s = value5c(id, run.counts);
  const q = value5c(id, real5c.counts);
  const r = c.passRule;
  let m: RegExpMatchArray | null;
  if ((m = r.match(/^abs\(sim - real\) <= ([\d.]+)( pp)?$/)) !== null) return Math.abs(s - q) <= Number(m[1]);
  if ((m = r.match(/^sim <= real \+ ([\d.]+)$/)) !== null) return s <= q + Number(m[1]);
  if ((m = r.match(/^sim <= ([\d.]+)$/)) !== null) return s <= Number(m[1]);
  if ((m = r.match(/^sim >= real - ([\d.]+) pp$/)) !== null) return s >= q - Number(m[1]);
  throw new Error(`unparsed 5c pass rule for ${id}: ${r}`);
};

// ---------------------------------------------------------------- git history (full clone only)

const history = ((): boolean => {
  try {
    execFileSync("git", ["cat-file", "-e", "46268e6^{commit}"], { cwd: REPO, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const git = (...a: string[]): string => execFileSync("git", a, { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 }).trim();

// ---------------------------------------------------------------- 0: checks, diagnosis, measures

describe("0.1: the checks file is the spec table, frozen and hashed before any run", () => {
  it("sha256 is the pre-registered value, and DECISIONS.md records it with a timestamp", () => {
    expect(sha("data/game/step5d-checks.json")).toBe(CHECKS_SHA);
    const sec = sec5d("### Checks pre-registered");
    expect(sec).toContain(CHECKS_SHA);
    expect(sec).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?/);
  });

  it("every row of the spec table is in the file verbatim; lead9 is reported only (Resolved 1), the rest gated", () => {
    const rows = tableRows(between(spec, "## Pre-registered checks", "\nNo regression of the 5c checks")).filter((r) => r[0]?.startsWith("`"));
    expect(rows).toHaveLength(10);
    expect(checksFile.checks.map((c) => c.id)).toEqual(rows.map((r) => (r[0] ?? "").replace(/`/g, "")));
    for (const [id, measure, rule, why, ref] of rows) {
      const c = check((id ?? "").replace(/`/g, ""));
      expect([c.measure, c.whyTolerance, c.reference], c.id).toEqual([measure?.replace(/`otBothPossessed`/, "`otBothPossessed`"), why, ref]);
      if (c.id === "d.kneel.thenPlay.lead9") {
        expect(c.gated).toBe(false);
        expect(c.passRule).toMatch(/^reported only, not gated \(lead, Resolved 1, 2026-11-13\)/);
        expect(c.passRule).toContain(rule as string);
        expect(c.passRule).toContain("is not applied");
      } else {
        expect([c.gated, c.passRule], c.id).toEqual([true, rule]);
      }
    }
  });

  it("the no-regression list names the 5c file by its hash, the 14 passing checks and the three at-or-better values", () => {
    const nr = checksFile.noRegression5c;
    expect([nr.file, nr.sha256]).toEqual(["data/game/step5c-checks.json", CHECKS_5C_SHA]);
    expect(sha("data/game/step5c-checks.json")).toBe(CHECKS_5C_SHA);
    expect(nr.atOrBetterThanRunH).toEqual([
      { id: "c.kneel.ballBack", runH: "8.97%" },
      { id: "c.fg.63", runH: "0.0254 per game" },
      { id: "c.fg.50to59", runH: "0.764 per game" },
    ]);
    const all = checks5c.map((c) => c.id).sort();
    expect([...nr.mustStillPass, ...nr.atOrBetterThanRunH.map((x) => x.id)].sort()).toEqual(all);
    expect(nr.mustStillPass).toHaveLength(14);
  });

  it.runIf(history)("its commit holds that file alone, it was never edited, and its hash was recorded before any measure, fit or run commit", () => {
    const added = git("log", "--diff-filter=A", "--format=%H", "--", "data/game/step5d-checks.json").split("\n");
    expect(added).toHaveLength(1);
    const a = added[0] as string;
    expect(git("show", "--name-only", "--format=", a).split("\n")).toEqual(["data/game/step5d-checks.json"]);
    expect(git("log", "--format=%H", "--", "data/game/step5d-checks.json").split("\n")).toEqual(added);
    const recorded = git("log", "--reverse", "--format=%H", `-S${CHECKS_SHA}`, "--", "docs/DECISIONS.md").split("\n")[0] as string;
    expect(recorded).not.toBe("");
    expect(() => execFileSync("git", ["merge-base", "--is-ancestor", a, recorded], { cwd: REPO })).not.toThrow();
    const later = ["pipeline/game/checks5d.py", "scripts/game/checks5d.ts", "data/game/checks5d.sim.json", "data/game/checks5d.real.json",
      "packages/sim/src", "pipeline/game/decisions.py", "data/caller/offense.table.json", "data/game/tempo.json", "data/game/calibration.insample.json"];
    const firsts = later.flatMap((p) => git("log", "--reverse", "--format=%H", `${a}..HEAD`, "--", p).split("\n").slice(0, 1)).filter((h) => h !== "");
    expect(firsts.length).toBeGreaterThan(3);
    for (const h of firsts) {
      expect(h, `${h} is the recording commit`).not.toBe(recorded);
      expect(() => execFileSync("git", ["merge-base", "--is-ancestor", recorded, h], { cwd: REPO }), h).not.toThrow();
    }
  });

  it("the diagnosis is on record in DECISIONS.md before any fix (5c locked rule 7)", () => {
    const diag = sec5d("### Diagnosis (debugger, 2026-11-13, at `4f25b28`, before any fix");
    for (const f of ["Finding 1a", "Finding 1b", "Finding 2", "Finding 3"]) expect(diag, f).toContain(f);
  });
});

describe("0.2, 0.3: the real side and the baseline", () => {
  it("0.2: the real side is 2016-2023 regular season (2,095 games) and gives every gated measure a finite value", () => {
    expect(real.seasons).toEqual([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023]);
    expect(real.counts["games"]).toBe(2095);
    for (const c of checksFile.checks) if (c.id !== "d.try.otDown2") expect(Number.isFinite(value(c.id, real.counts)), c.id).toBe(true);
  });

  it("0.3: at the baseline every check the playtest measured fails in the playtest's direction", () => {
    const base = sim["baseline"] as Run;
    const out: string[] = [];
    for (const c of checksFile.checks) {
      const m = c.reference.match(/^([\d.]+) vs ([\d.]+)$/);
      if (c.id === "d.try.otDown2") {
        // The playtest: one such try, a kick.
        const t = otDown2(base);
        if (t.tries < 1 || t.two === t.tries) out.push(`${c.id}: no kick at the baseline (${t.two} of ${t.tries})`);
        continue;
      }
      if (m === null) continue; // a real-only reference: the playtest gave no sim direction
      const side = Math.sign(Number(m[1]) - Number(m[2]));
      const now = Math.sign(value(c.id, base.counts) - value(c.id, real.counts));
      if (now !== side) out.push(`${c.id}: baseline on the other side of real`);
      if (c.gated && passes(c.id, base)) out.push(`${c.id}: passes at the baseline`);
    }
    expect(out).toEqual([]);
  });

  it("0.3: the baseline is the sim behavior of 4f25b28: its margins and 5c checks equal step 5c run H", () => {
    const b5c = sim5c["5d.baseline"] as Run;
    const h5c = sim5c["H"] as Run;
    for (const k of Object.keys(h5c.counts)) expect(b5c.counts[k], k).toBe(h5c.counts[k]);
    for (const k of Object.keys(h5c.counts).filter((x) => x.startsWith("margin."))) expect((sim["baseline"] as Run).counts[k], k).toBe(h5c.counts[k]);
  });

  it("0.3: GAME_REPORT has the baseline table with every check", () => {
    const sec = between(gameReport, "### Step 5d pre-registered checks", "\n## ");
    const header = tableRows(sec).find((r) => r[0] === "Check");
    expect(header?.slice(1, 8)).toEqual(["baseline", "res3", "B", "C", "D", "E", "H"]);
    for (const c of checksFile.checks) expect(sec, c.id).toMatch(new RegExp(`\\| \`${c.id.replace(/\./g, "\\.")}\` \\| `));
    expect(sec).toMatch(/baseline = before step 5d \(the behavior of 4f25b28/);
  });
});

// ---------------------------------------------------------------- A: two Situation fields

describe("A1: the caller config schema reads the two fields", () => {
  const cfg = json<Record<string, unknown> & { dimensions: Record<string, unknown> }>("data/caller/config.json");
  const withDim = (field: string) => ({ ...cfg, dimensions: { ...cfg.dimensions, zzProbe: { type: "exact", field, phases: ["scrimmage"] } } });

  it("a dimension on clockRunning or otBothPossessed parses; a misspelled field is rejected", () => {
    expect(() => parseCallerConfig(cfg)).not.toThrow();
    for (const f of ["clockRunning", "otBothPossessed"]) expect(() => parseCallerConfig(withDim(f)), f).not.toThrow();
    for (const f of ["clockRuning", "otBothPosessed", "clock_running"]) expect(() => parseCallerConfig(withDim(f)), f).toThrow();
  });

  it("the shipped config has dimensions on both fields (clockRun; tryLate and time3 read otBothPossessed)", () => {
    const dims = cfg.dimensions as Record<string, { field?: string; buckets?: { field?: string }[] }>;
    expect(dims["clockRun"]?.field).toBe("clockRunning");
    for (const d of ["tryLate", "time3"]) expect(dims[d]?.buckets?.some((b) => b.field === "otBothPossessed"), d).toBe(true);
  });
});

describe("A4: milestone A changed no behavior", () => {
  it.runIf(history)("every caller table, both golden files, every game table and the step 5 summaries are byte-identical across the milestone A commit", () => {
    const a = git("log", "--format=%H", "--grep=^M1 step 5d milestone A: clockRunning", "-1");
    expect(a).not.toBe("");
    const files = ["data/caller/offense.table.json", "data/caller/defense.table.json", "data/caller/golden.json", "data/game/tempo.json", "data/game/timeouts.json",
      "data/game/onside.json", "data/game/golden.json", "data/game/ep.json", "data/game/calibration.insample.json", "data/game/calibration.json"];
    expect(git("diff", "--name-only", `${a}^`, a, "--", ...files)).toBe("");
  });
});

describe("A5: the report gives the 2016-2023 counts", () => {
  it("snaps by down and clock state for 0-timeout 1-8 trailers, OT tries by flag, and the timeout disagreement count", () => {
    const a = sec5d("### Milestone A: two Situation fields");
    for (const d of [1, 2, 3, 4]) expect(a, `down ${d}`).toMatch(new RegExp(`down ${d} [\\d,]+ / [\\d,]+`));
    expect(a).toMatch(/Overtime tries: 0/);
    expect(a).toMatch(/disagree with the game pipeline's clock-order reading[^.]*on 23 shared snaps/);
  });
});

// ---------------------------------------------------------------- repro states (4f25b28)

interface Repro {
  leagueSeed: number; seed: number; gameType: string; ev: number; lastSnap: LastSnap | null; state: GameState; snapState: GameState;
  event: { t: string; before: Partial<GameState>; after?: Partial<GameState>; seconds?: number; offense?: { call: string } };
}
const repro = json<{ commit: string; states: Repro[] }>("test/fixtures/step5d-repro-states.json");
const at = (league: number, seed: number, ev: number): Repro => {
  const r = repro.states.find((x) => x.leagueSeed === league && x.seed === seed && x.ev === ev);
  if (r === undefined) throw new Error(`no repro state ${league}/${seed}/${ev}`);
  return r;
};
const data = loadGameData();
const rules = data.engine.rules;
const caller = data.engine.caller;
const dims = data.config.dimensions;
const coach = averageCoachFor(data);
const lateKneel: LateKneelMask = ((): LateKneelMask => {
  const m = data.config.clockRules?.callerMasks?.lateKneel;
  if (m === undefined) throw new Error("data/game/config.json has no clockRules.callerMasks.lateKneel");
  return m;
})();
const oTop = caller.offense.factors["oTop"] as FactorTable;
const o4Top = caller.offense.factors["o4Top"] as FactorTable;
const levelIndex = (t: FactorTable, want: string[], seasons?: unknown): number[] =>
  t.levels.flatMap((l, i) => (JSON.stringify(l.dims) === JSON.stringify(want) && (seasons === undefined || JSON.stringify(l.seasons) === JSON.stringify(seasons)) ? [i] : []));
const share = (s: Situation, call: string, d: CallerData = caller, masks = {}): number => offenseShares(s, d, masks).leaves.filter((l) => l.call === call).reduce((a, l) => a + l.p, 0);
const cellShare = (t: FactorTable, level: number, key: string, target: string): number => {
  const w = t.cells[level]?.[key];
  if (w === undefined) throw new Error(`no cell ${level} ${key}`);
  return (w[t.targets.indexOf(target)] ?? 0) / w.reduce((a, x) => a + x, 0);
};

describe("repro fixtures: the captured states are the 4f25b28 records' states", () => {
  it("each state's snapshot equals its record event's `before`, and the seven repro seeds are all there", () => {
    expect(repro.commit).toBe("4f25b28");
    const seeds = new Set(repro.states.map((r) => `${r.leagueSeed}/${r.seed}`));
    expect([...seeds].sort()).toEqual(["2026/107", "2026/229", "2026/26", "2026/3", "2026/4", "4242/6537", "7/11"]);
    for (const r of repro.states) {
      for (const [k, v] of Object.entries(r.event.before)) expect((r.snapState as unknown as Record<string, unknown>)[k], `${r.seed} ${r.ev} ${k}`).toEqual(v);
    }
  });
});

// ---------------------------------------------------------------- B: tempo keeps the offense's own timeouts

const NEW_TEMPO_DIMS = ["time5", "score3", "ownTO", "prevKneel", "restart", "toCalled"];
const newTempoLevel = data.tables.tempo.levels.findIndex((l) => JSON.stringify(l.dims) === JSON.stringify(NEW_TEMPO_DIMS));
const viewOf = (r: Repro, state: GameState = r.snapState): CoachView => ({ ...coachView(state, rules, r.lastSnap), beforeTimeout: false });

describe("B: tempo", () => {
  it("B config: the diagnosis's level is in data/game/config.json and the tempo table, second, keyed as the spec says", () => {
    expect(newTempoLevel).toBe(1);
    expect(data.config.tempo.levels[1]?.dims).toEqual(NEW_TEMPO_DIMS);
    expect(Object.keys(data.tables.tempo.cells[1] ?? {}).length).toBeGreaterThan(0);
  });

  it("B1: d.gap.trail0TO passes or is accepted; c.trail.lastSnap, c.trail.longGap, c.kneel.shortGap0TO still pass", () => {
    expect(passOrAcceptedAtH("d.gap.trail0TO")).toBeNull();
    for (const id of ["c.trail.lastSnap", "c.trail.longGap", "c.kneel.shortGap0TO"]) expect(passes5c(id, sim5c["5d.H"] as Run), id).toBe(true);
  });

  const b2State = (league: number, seed: number, ev: number): Repro => {
    const r = at(league, seed, ev);
    expect(r.event.t).toBe("runoff");
    const s = r.snapState;
    const off = s.possession;
    const def = off === "home" ? "away" : "home";
    // The playtest's state: Q4 final minute, trailing by 1-8, no timeouts, clock running.
    expect([s.period, s.clockRunning, s.timeouts[off]]).toEqual([4, true, 0]);
    expect(s.score[def] - s.score[off]).toBeGreaterThanOrEqual(1);
    expect(s.score[def] - s.score[off]).toBeLessThanOrEqual(8);
    return r;
  };
  for (const [league, seed, ev] of [[7, 11, 268], [2026, 3, 264]] as const) {
    it(`B2: league ${league} seed ${seed} ev ${ev}: the run-off comes from a new-level cell with ownTO 0, not L1 GF|c40|T|0|0|0`, () => {
      const f = tempoShares(viewOf(b2State(league, seed, ev)), data.tables, dims);
      expect(f.level, f.key).toBe(newTempoLevel);
      expect(f.key.split("|")[NEW_TEMPO_DIMS.indexOf("ownTO")]).toBe("0");
      expect(f.key).not.toBe("GF|c40|T|0|0|0");
      expect(f.value).toEqual(data.tables.tempo.cells[newTempoLevel]?.[f.key]);
    });
  }

  it("B2: league 2026 seed 26 ev 273 (0:55): the run-off comes from an ownTO 0 cell, not the pooled GF|c40|T|0|0|0", () => {
    // FLAG (spec): the spec puts this state in the new level. At 0:55 the first level, which already
    // keys ownTO, has a cell (GF|c120|T|0|0|0|0), and that cell served this run-off at 4f25b28 too
    // (test-writer, 2026-11-13, pre-B tempo table): the pooled L1 cell never applied here, so no level
    // after the first can be reached. Checked: an ownTO 0 cell of the first level, not the pooled cell.
    const f = tempoShares(viewOf(b2State(2026, 26, 273)), data.tables, dims);
    expect(data.tables.tempo.levels[f.level]?.dims).toContain("ownTO");
    expect(f.key.split("|")[(data.tables.tempo.levels[f.level]?.dims ?? []).indexOf("ownTO")]).toBe("0");
    expect(f.key).not.toBe("GF|c40|T|0|0|0");
    expect([f.level, f.key]).toEqual([0, "GF|c120|T|0|0|0|0"]);
  });

  it("B3: at least 200 frozen views that reach L0 or that the new level does not cover keep their pre-B run-off weights byte for byte", () => {
    // Amended 2026-11-13 (engineer, code review fix 1): the lost-challenge reading moved the fitted tempo
    // cells, so the pre-B weights were re-frozen from tables rebuilt with the eb45a43^ config and the
    // corrected reading (test/fixtures/step5d-tempo-preB-review.json, same views).
    const fx = json<{ commit: string; views: { view: Record<string, unknown>; levelBefore: number; weights: number[] }[] }>("test/fixtures/step5d-tempo-preB-review.json");
    expect(fx.views.length).toBeGreaterThanOrEqual(200);
    expect(fx.views.filter((v) => v.levelBefore === 0).length).toBeGreaterThan(50);
    const out: string[] = [];
    for (const v of fx.views) {
      const f = tempoShares(v.view as unknown as CoachView, data.tables, dims);
      if (f.level === newTempoLevel) out.push(`${JSON.stringify(v.view)} now reads the new level`);
      else if (JSON.stringify(f.value) !== JSON.stringify(v.weights)) out.push(`${JSON.stringify(v.view)}: ${f.level} ${f.key}`);
    }
    expect(out).toEqual([]);
  });

  it("B4: C7 in-sample passes and timeouts.perTeamGame passes", () => {
    const c7 = json<{ inSample: { metrics: Metric[] } }>("data/game/coach.validation.json").inSample.metrics;
    expect(c7.length).toBeGreaterThan(5);
    expect(c7.filter((m) => m.status !== "pass").map((m) => `${m.id} ${m.status}`)).toEqual([]);
    const ins = json<{ metrics: Metric[] }>("data/game/calibration.insample.json").metrics;
    expect(ins.find((m) => m.id === "timeouts.perTeamGame")?.status).toBe("pass");
  });
});

// ---------------------------------------------------------------- C: clock-aware spike level

const SPIKE_LEVELS = oTop.levels.flatMap((l, i) => (l.dims.includes("clockRun") ? [i] : []));

describe("C: clock-aware spike level", () => {
  it("C config: four oTop levels on down (then downs 2-3), clockRun, ownTO2, the trailing late score and GF, ahead of [down, zoneK, scoreLate5Only, lateTime]", () => {
    expect(SPIKE_LEVELS).toHaveLength(4);
    const l6 = levelIndex(oTop, ["down", "zoneK", "scoreLate5Only", "lateTime"])[0] as number;
    for (const i of SPIKE_LEVELS) {
      expect(i).toBeLessThan(l6);
      for (const d of ["clockRun", "ownTO2", "scoreTrail", "timeGF"]) expect(oTop.levels[i]?.dims, `${i} ${d}`).toContain(d);
    }
  });

  it("C1: the three spike checks pass or are accepted; c.spike.stopped still passes", () => {
    expect(["d.spike.trail0TO", "d.spike.running0TO", "d.spike.stopped0TO"].map(passOrAcceptedAtH).filter((x) => x !== null)).toEqual([]);
    expect(passes5c("c.spike.stopped", sim5c["5d.H"] as Run)).toBe(true);
  });

  for (const [league, seed, ev] of [[7, 11, 268], [2026, 3, 264], [2026, 26, 273]] as const) {
    it(`C2: league ${league} seed ${seed} ev ${ev}, next snap with the clock running: the call is from a spike cell with clockRunning 1 and ownTO 0, at its fitted share`, () => {
      const r = at(league, seed, ev);
      const after = r.event.after as GameState;
      // The snap after the run-off; where the run-off ended the game, the same state at its own snap.
      const snap: GameState = after.phase === "scrimmage" ? { ...r.snapState, ...after } : r.snapState;
      expect(snap.clockRunning).toBe(true);
      const s = toSituation(snap, rules);
      expect([s.clockRunning, s.offenseTimeouts]).toEqual([1, 0]);
      const sh = offenseShares(s, caller);
      const t = sh.trace["oTop"];
      expect(t, "oTop trace").toBeDefined();
      expect(SPIKE_LEVELS, `${t?.level} ${t?.key}`).toContain(t?.level);
      const lv = oTop.levels[t?.level as number]?.dims ?? [];
      const parts = (t?.key ?? "").split("|");
      expect(parts[lv.indexOf("clockRun")]).toBe("1");
      expect(parts[lv.indexOf("ownTO2")]).toBe("o0");
      const fitted = cellShare(oTop, t?.level as number, t?.key as string, "spike");
      expect(fitted).toBeGreaterThan(0);
      expect(share(s, "spike")).toBeCloseTo(fitted, 12);
      // The coach's masks keep it: the clock is running.
      const rng = Rng.fromSeed(seed);
      let k = 0;
      for (let i = 0; i < 400; i++) if (coach.offenseCall(s, rng, { clockRunning: true }).call === "spike") k++;
      expect(k).toBeGreaterThan(0);
    });
  }

  it("C3 (and D, E outside their states): caller shares outside the late states are byte-identical to before step 5d's levels", () => {
    const fx = json<{ tries: { commit: string; groups: Record<string, { n: number; sha256: string }> }; scrimmage: { commit: string; groups: Record<string, { n: number; sha256: string }> } }>("test/fixtures/step5d-caller-frozen.json");
    const got = scrimmageGroups();
    expect(Object.keys(got).sort()).toEqual(Object.keys(fx.scrimmage.groups).sort());
    const bad = Object.entries(fx.scrimmage.groups).filter(([k, v]) => got[k]?.n !== v.n || got[k]?.sha256 !== v.sha256).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it.runIf(history)("C3: across the milestone C commit every caller table cell is byte-identical except the four new oTop levels", () => {
    const c = git("log", "--format=%H", "--grep=^M1 step 5d milestone C:", "-1");
    const before = JSON.parse(git("show", `${c}^:data/caller/offense.table.json`)) as { factors: Record<string, FactorTable> };
    const after = JSON.parse(git("show", `${c}:data/caller/offense.table.json`)) as { factors: Record<string, FactorTable> };
    expect(Object.keys(after.factors).sort()).toEqual(Object.keys(before.factors).sort());
    for (const [k, f] of Object.entries(after.factors)) {
      if (k === "oTop") continue;
      expect(JSON.stringify(f.cells), k).toBe(JSON.stringify(before.factors[k]?.cells));
    }
    const b = before.factors["oTop"] as FactorTable;
    const a = after.factors["oTop"] as FactorTable;
    const fresh = a.levels.flatMap((l, i) => (l.dims.includes("clockRun") ? [i] : []));
    expect(fresh).toHaveLength(4);
    const kept = a.cells.filter((_, i) => !fresh.includes(i));
    expect(JSON.stringify(kept)).toBe(JSON.stringify(b.cells));
    expect(JSON.parse(git("show", `${c}:data/caller/defense.table.json`)).factors).toEqual(JSON.parse(git("show", `${c}^:data/caller/defense.table.json`)).factors);
  });

  it("C4: every stored spike-level cell with a fitted spike share is reported with its n and real vs fitted share; the fitted share matches the table", () => {
    const sec = sec5d("### Milestone C: clock-aware spike level");
    const out: string[] = [];
    let listed = 0;
    for (const i of SPIKE_LEVELS) {
      for (const key of Object.keys(oTop.cells[i] ?? {})) {
        const fitted = 100 * cellShare(oTop, i, key, "spike");
        if (fitted === 0) continue;
        const m = sec.match(new RegExp(`\`${key.replace(/[.|+]/g, (x) => `\\${x}`)}\` (\\d+), ([\\d.]+)% vs ([\\d.]+)%`));
        if (m === null) {
          out.push(`${i} ${key}: not reported`);
          continue;
        }
        listed++;
        if (Number(m[1]) < 150) out.push(`${key}: n ${m[1]} under 150`);
        if (Math.abs(Number(m[3]) - fitted) > 0.005 + 1e-9) out.push(`${key}: reported fitted ${m[3]}%, table ${fitted.toFixed(4)}%`);
      }
    }
    expect(out).toEqual([]);
    expect(listed).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------- frozen grids (C3, D, E3)

const trySecs: Record<number, number[]> = { 1: [900, 400, 30], 2: [900, 300, 120, 30, 1], 3: [900, 300, 30], 4: [900, 600, 301, 300, 200, 121, 120, 60, 1], 5: [600, 400, 301, 250, 60, 1] };
const clocksAt = (q: number, secs: number) =>
  q === 5 ? { quarter: 5, secondsLeftInHalf: secs, secondsLeftInGame: secs } : { quarter: q, secondsLeftInHalf: q === 1 || q === 3 ? secs + 900 : secs, secondsLeftInGame: secs + (4 - q) * 900 };
function tryGrid(): Situation[] {
  const out: Situation[] = [];
  for (const q of [1, 2, 3, 4, 5]) for (const secs of trySecs[q] as number[]) for (let d = -16; d <= 16; d++) for (const yl of [2, 1, 15]) {
    if (q === 5 && Math.abs(d) > 8) continue;
    out.push({ phase: "try", down: 1, yardsToGo: yl, yardLine100: yl, scoreDiff: d, ...clocksAt(q, secs), offenseTimeouts: 2, defenseTimeouts: 1, clockRunning: 0, otBothPossessed: 0 });
  }
  return out;
}
function scrimmageGrid(): Situation[] {
  const out: Situation[] = [];
  const scr: Record<number, number[]> = { 1: [900, 300, 20], 2: [700, 119, 40, 5], 3: [600, 30], 4: [890, 400, 301] };
  const push = (q: number, secs: number, down: number, ytg: number, yl: number, d: number, o: number, x: number, cr: number): void => {
    out.push({ phase: "scrimmage", down, yardsToGo: Math.min(ytg, yl), yardLine100: yl, scoreDiff: d, ...clocksAt(q, secs), offenseTimeouts: o, defenseTimeouts: x, clockRunning: cr, otBothPossessed: 0 });
  };
  for (const q of [1, 2, 3, 4]) for (const secs of scr[q] as number[]) for (const down of [1, 2, 3, 4]) for (const ytg of [1, 6, 12]) for (const yl of [3, 18, 35, 55, 80]) for (const d of [-17, -6, -2, 0, 3, 9]) for (const [o, x] of [[3, 3], [0, 1]] as const) for (const cr of [0, 1]) push(q, secs, down, ytg, yl, d, o, x, cr);
  // Leaders in the Q4 final 5:00 before the final 2:00.
  for (const secs of [290, 200, 125]) for (const down of [1, 2, 3, 4]) for (const ytg of [1, 6, 12]) for (const yl of [3, 18, 35, 55, 80]) for (const d of [1, 3, 8, 9, 17]) for (const [o, x] of [[3, 3], [0, 1], [1, 0]] as const) for (const cr of [0, 1]) push(4, secs, down, ytg, yl, d, o, x, cr);
  return out;
}
const leavesOf = (s: Situation) => offenseShares(s, caller).leaves.map((l) => [l.call, l.twoPointPlay ?? null, l.p]);
const groupDigests = (sits: Situation[], key: (s: Situation) => string): Record<string, { n: number; sha256: string }> => {
  const m = new Map<string, unknown[]>();
  for (const s of sits) {
    const k = key(s);
    if (!m.has(k)) m.set(k, []);
    m.get(k)?.push(leavesOf(s));
  }
  return Object.fromEntries([...m].map(([k, v]) => [k, { n: v.length, sha256: createHash("sha256").update(JSON.stringify(v)).digest("hex") }]));
};
const scrimmageGroups = () => groupDigests(scrimmageGrid(), (s) => `q${s.quarter}|g${s.secondsLeftInGame}|d${s.down}`);
const tryGroups = () => groupDigests(tryGrid(), (s) => `q${s.quarter}|g${s.secondsLeftInGame}`);

// ---------------------------------------------------------------- D: late kneels

const NL_LEVELS = oTop.levels.flatMap((l, i) => (l.dims.includes("scoreNL") ? [i] : []));

describe("D: late kneels only by teams that can kneel out", () => {
  it("D1: d.kneel.notLeading, d.kneel.thenPlay.lead1to8 and .notLeading, d.kneel.4thLate pass or are accepted; c.kneel.ballBack at or better than 8.97%; c.kneel.early and c.kneel.shortGap0TO pass", () => {
    expect(["d.kneel.notLeading", "d.kneel.thenPlay.lead1to8", "d.kneel.thenPlay.notLeading", "d.kneel.4thLate"].map(passOrAcceptedAtH).filter((x) => x !== null)).toEqual([]);
    const h = sim5c["5d.H"] as Run;
    const was = Math.abs(value5c("c.kneel.ballBack", (sim5c["H"] as Run).counts) - value5c("c.kneel.ballBack", real5c.counts));
    expect(Math.abs(value5c("c.kneel.ballBack", h.counts) - value5c("c.kneel.ballBack", real5c.counts))).toBeLessThanOrEqual(was);
    for (const id of ["c.kneel.early", "c.kneel.shortGap0TO"]) expect(passes5c(id, h), id).toBe(true);
  });

  it("D config: three not-leading late oTop levels ahead of the old L6-L8, with scoreNL and the c40/c120 clock", () => {
    expect(NL_LEVELS).toHaveLength(3);
    const l6 = levelIndex(oTop, ["down", "zoneK", "scoreLate5Only", "lateTime"])[0] as number;
    for (const i of NL_LEVELS) {
      expect(i).toBeLessThan(l6);
      expect(oTop.levels[i]?.dims).toContain("clock");
    }
    const nl = caller.config.dimensions["scoreLateNL5"] as unknown as { buckets: { label: string; min: number | null; max: number | null }[] };
    expect(nl.buckets.map((b) => [b.label, b.min, b.max])).toEqual([["<=-9", null, -9], ["-8..-4", -8, -4], ["-3..-1", -3, -1], ["0", 0, 0], ["L", 1, null]]);
  });

  it("D2: league 2026 seed 26 ev 263 (up 2, 1st down, Q4 1:20, defense 3 timeouts): kneel at its fitted cell's share", () => {
    // The spec says the K0x cell for defense 1+ timeouts. Under the kneelGap definition the spec leaves
    // unchanged, three kneels from 1:20 run the clock out if the defense uses no timeout (3 x 40 + 2 >= 80),
    // which is K0c, not K0x; the lead noted this (DECISIONS.md, "Lead's calls on the step 5d engineer's
    // choices"). Checked here: the arithmetic, the K0c.d23 bin, and the share equals that cell's.
    const r = at(2026, 26, 263);
    const s = toSituation(r.snapState, rules);
    expect([s.scoreDiff, s.down, s.secondsLeftInGame, s.defenseTimeouts]).toEqual([2, 1, 80, 3]);
    const kg = caller.config.dimensions["kneelGap"] as unknown as { kneelSeconds: number; playClock: number };
    expect(3 * kg.playClock + kg.kneelSeconds).toBeGreaterThanOrEqual(80);
    expect(binSituation(s, caller.config.dimensions)["kneelGap"]).toBe("K0c.d23");
    const t = offenseShares(s, caller).trace["oTop"];
    expect(t?.key.split("|")[0]).toBe("K0c.d23");
    expect(share(s, "kneel")).toBeCloseTo(cellShare(oTop, t?.level as number, t?.key as string, "kneel"), 12);
    expect(d5d).toMatch(/seed 26 ev 263[^.]*K0c\.d23, not K0x/);
  });

  it("D2: league 2026 seed 229 ev 270 (up 2, 4th and 13 at the own 40, Q4 1:17): the c40-banded late o4Top cell is under N and backs off to its unbanded twin", () => {
    // The spec says the call comes from a c40-banded cell. Its banded cell was not stored (under 150
    // real snaps), so the lookup backs off (lead noted, DECISIONS.md). Checked: no banded cell exists for
    // this state, the call comes from the unbanded late level, and the kneel share is that cell's.
    const r = at(2026, 229, 270);
    const s = toSituation(r.snapState, rules);
    expect([s.scoreDiff, s.down, s.yardsToGo, s.yardLine100, s.secondsLeftInGame]).toEqual([2, 4, 13, 60, 77]);
    const labels = binSituation(s, caller.config.dimensions);
    const banded = o4Top.levels.flatMap((l, i) => (l.dims.includes("clock") && l.dims.includes("lateTime") ? [i] : []));
    expect(banded.length).toBeGreaterThanOrEqual(4);
    for (const i of banded) {
      const key = (o4Top.levels[i]?.dims ?? []).map((d) => labels[d]).join("|");
      expect(o4Top.cells[i]?.[key], `banded level ${i} ${key}`).toBeUndefined();
    }
    const t = offenseShares(s, caller).trace["o4Top"];
    expect(o4Top.levels[t?.level as number]?.dims).toEqual(["fieldHalf", "scoreLate5Only", "lateTime"]);
    expect(share(s, "kneel")).toBeCloseTo(cellShare(o4Top, t?.level as number, t?.key as string, "kneel"), 12);
  });

  for (const [seed, ev, diff] of [[107, 264, -4], [4, 250, -12]] as const) {
    const sitOf = (): Situation => {
      const s = toSituation(at(2026, seed, ev).snapState, rules);
      expect(s.scoreDiff).toBe(diff);
      return s;
    };
    it(`D2: league 2026 seed ${seed} ev ${ev} (down ${-diff}): the call comes from C's spike level, ahead of the not-leading levels`, () => {
      // Spec D2 as amended by the lead (2026-11-13): these trailers in the final 2:00 are served by the spike
      // level [down, clockRun, ownTO2, scoreTrail, timeGF, fgRange], which the lead keeps ahead of the
      // not-leading levels; the mask makes their kneel share 0 (next test).
      const t = offenseShares(sitOf(), caller).trace["oTop"];
      const spike = levelIndex(oTop, ["down", "clockRun", "ownTO2", "scoreTrail", "timeGF", "fgRange"]);
      expect(spike, `served by level ${t?.level} [${oTop.levels[t?.level as number]?.dims.join(", ")}] ${t?.key}`).toContain(t?.level);
      for (const i of NL_LEVELS) expect(i).toBeGreaterThan(t?.level as number);
    });

    it(`D2: league 2026 seed ${seed} ev ${ev}: the fitted kneel share is its cell's, and the coach never kneels in a state with 0 real kneels`, () => {
      const s = sitOf();
      const r = at(2026, seed, ev);
      const t = offenseShares(s, caller).trace["oTop"];
      expect(share(s, "kneel")).toBeCloseTo(cellShare(oTop, t?.level as number, t?.key as string, "kneel"), 12);
      expect(inLateKneelMask(s, lateKneel)).toBe(true);
      expect(share(s, "kneel", caller, { lateKneel })).toBe(0);
      const rng = Rng.fromSeed(seed);
      for (let i = 0; i < 1000; i++) expect(coach.offenseCall(s, rng, { clockRunning: r.snapState.clockRunning }).call).not.toBe("kneel");
    });
  }

  it("D3: the K0c and K0x splits live in the caller config; changing them in data moves the bin; no bins file holds the old literal", () => {
    const kg = caller.config.dimensions["kneelGap"] as unknown as { concedeSplit: number; k0xSplit: number };
    expect([kg.concedeSplit, kg.k0xSplit]).toEqual([2, 1]);
    const base: Situation = { phase: "scrimmage", down: 1, yardsToGo: 10, yardLine100: 50, scoreDiff: 2, quarter: 4, secondsLeftInHalf: 80, secondsLeftInGame: 80, offenseTimeouts: 1, defenseTimeouts: 2, clockRunning: 0, otBothPossessed: 0 };
    const label = (s: Situation, patch: Record<string, number>) => binSituation(s, { ...caller.config.dimensions, kneelGap: { ...caller.config.dimensions["kneelGap"], ...patch } as never })["kneelGap"];
    expect(label(base, {})).toBe("K0c.d23");
    expect(label(base, { concedeSplit: 3 })).toBe("K0c.d012");
    expect(label(base, { concedeSplit: 1 })).toBe("K0c.d123");
    // 2nd down at 1:50: two kneels (2 x 40 + 2 = 82 s) cannot run it out even if the defense concedes: K0x.
    const x: Situation = { ...base, down: 2, secondsLeftInGame: 110, secondsLeftInHalf: 110, defenseTimeouts: 1 };
    expect(label(x, {})).toBe("K0x.d123");
    expect(label(x, { k0xSplit: 2 })).toBe("K0x.d01");
    expect(label({ ...x, defenseTimeouts: 0 }, {})).toBe("K0x.d0");
    for (const f of ["packages/sim/src/caller/bins.ts", "pipeline/caller/bins.py"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/K0c\.d23|K0c\.d01|defenseTimeouts\W*\]?\s*>=\s*2/);
    }
  });

  it.runIf(history)("D3: with the shipped value the caller tables and golden file are byte-identical across the D3 commit (apart from the config hash they record)", () => {
    const c = git("log", "--format=%H", "--grep=^M1 step 5d milestone D3:", "-1");
    for (const f of ["data/caller/offense.table.json", "data/caller/defense.table.json", "data/caller/golden.json"]) {
      const strip = (s: string): unknown => {
        const o = JSON.parse(s) as Record<string, unknown>;
        delete o["configHash"];
        return o;
      };
      expect(strip(git("show", `${c}:${f}`)), f).toEqual(strip(git("show", `${c}^:${f}`)));
    }
  });

  it("D4: b9.c.kneel.K0 at or better than 23.7% vs 25.1%; K1 unchanged at 98.2% vs 98.4%; lateDowns.>=17.kneel within its tolerance", () => {
    const row = (id: string): [number, number] => {
      const m = callerReport.match(new RegExp(`^\\| \`${id.replace(/[.>=]/g, (x) => `\\${x}`)}\` \\| \\d+ \\| ([\\d.]+) \\| ([\\d.]+) \\| ([^|]+) \\|`, "m"));
      expect(m, id).not.toBeNull();
      return [Number(m?.[1]), Number(m?.[2])];
    };
    const [k0p, k0a] = row("b9.c.kneel.K0");
    expect(Math.round(Math.abs(k0p - k0a) * 10) / 10).toBeLessThanOrEqual(1.4);
    expect(row("b9.c.kneel.K1")).toEqual([98.2, 98.4]);
    const [lp, la] = row("lateDowns.>=17.kneel");
    const tolerance = json<{ checks?: { id: string; tolerance?: number }[] }>("data/caller/latechecks.json");
    const t = JSON.stringify(tolerance).match(/"lateDowns[^"]*kneel[^}]*"tolerance(?:Pp)?":\s*([\d.]+)/);
    const tol = t === null ? 5 : Number(t[1]);
    expect(Math.abs(lp - la)).toBeLessThanOrEqual(tol);
  });

  it.runIf(history)("D4: the step 5b kneel-out tests are unedited since before step 5d", () => {
    expect(git("diff", "4f25b28", "HEAD", "--", "pipeline/tests/test_caller_5b_spec_check.py")).toBe("");
    const block = (s: string): string => between(s, 'describe("B2: can kneel out follows', "\n});\n");
    expect(block(read("packages/sim/test/caller/late5b.spec-check.test.ts"))).toBe(block(git("show", "4f25b28:packages/sim/test/caller/late5b.spec-check.test.ts")));
  });

  describe("D5: designed late-kneel masks", () => {
    const st = lateKneel.states;
    const sit = (o: Partial<Situation>): Situation => ({ phase: "scrimmage", down: 1, yardsToGo: 10, yardLine100: 60, scoreDiff: -10, quarter: 4, secondsLeftInHalf: 100, secondsLeftInGame: 100, offenseTimeouts: 1, defenseTimeouts: 1, clockRunning: 1, otBothPossessed: 0, ...o });

    it("every masked state has realKneels 0, its snap count, and is listed with its count in MODEL.md", () => {
      expect(lateKneel.quarterMin).toBe(4);
      expect(st).toHaveLength(3);
      for (const s of st) {
        expect(s.realKneels).toBe(0);
        expect(s.realSnaps).toBeGreaterThan(1000);
        expect(model, JSON.stringify(s)).toContain(`0 of ${s.realSnaps.toLocaleString("en-US")}`);
      }
    });

    it("trailing 9+ with more than 0:47 is masked; at 0:47 or less (33 real kneels) is not", () => {
      expect(inLateKneelMask(sit({ scoreDiff: -9, secondsLeftInGame: 48 }), lateKneel)).toBe(true);
      expect(inLateKneelMask(sit({ scoreDiff: -9, secondsLeftInGame: 47 }), lateKneel)).toBe(false);
      expect(inLateKneelMask(sit({ scoreDiff: -20, secondsLeftInGame: 30 }), lateKneel)).toBe(false);
    });

    it("trailing 3-8 is masked anywhere; trailing 1-2 is masked only outside the opp 20 with more than 0:47 (inside: 34 real kneels)", () => {
      for (const d of [-3, -8]) expect(inLateKneelMask(sit({ scoreDiff: d, secondsLeftInGame: 10, yardLine100: 5 }), lateKneel), String(d)).toBe(true);
      expect(inLateKneelMask(sit({ scoreDiff: -2, secondsLeftInGame: 100, yardLine100: 21 }), lateKneel)).toBe(true);
      expect(inLateKneelMask(sit({ scoreDiff: -2, secondsLeftInGame: 100, yardLine100: 20 }), lateKneel)).toBe(false);
      expect(inLateKneelMask(sit({ scoreDiff: -1, secondsLeftInGame: 47, yardLine100: 60 }), lateKneel)).toBe(false);
    });

    it("tied (17 real kneels with more than 0:47), leading, and Q1-Q3 are never masked; overtime is", () => {
      expect(inLateKneelMask(sit({ scoreDiff: 0, secondsLeftInGame: 200 }), lateKneel)).toBe(false);
      expect(inLateKneelMask(sit({ scoreDiff: 5 }), lateKneel)).toBe(false);
      expect(inLateKneelMask(sit({ quarter: 3, scoreDiff: -10, secondsLeftInGame: 1000 }), lateKneel)).toBe(false);
      expect(inLateKneelMask(sit({ quarter: 5, scoreDiff: -6, secondsLeftInGame: 200 }), lateKneel)).toBe(true);
    });

    it("the edge cases the spec names: down 1, 4th and 2 at the opp 8, Q4 0:40 is not masked; the coach can kneel there if the cell does", () => {
      const s = sit({ scoreDiff: -1, down: 4, yardsToGo: 2, yardLine100: 8, secondsLeftInGame: 40, secondsLeftInHalf: 40, defenseTimeouts: 0 });
      expect(inLateKneelMask(s, lateKneel)).toBe(false);
      expect(share(s, "kneel", caller, { lateKneel })).toBe(share(s, "kneel"));
    });

    it("a masked state's kneel share goes to the other calls in proportion", () => {
      const s = sit({ scoreDiff: -12, secondsLeftInGame: 119, secondsLeftInHalf: 119, yardLine100: 65, clockRunning: 0 });
      const open = offenseShares(s, caller).leaves;
      const masked = offenseShares(s, caller, { lateKneel }).leaves;
      const k = open.find((l) => l.call === "kneel")?.p ?? 0;
      expect(k).toBeGreaterThan(0);
      for (const l of open.filter((x) => x.call !== "kneel")) expect(masked.find((m) => m.call === l.call)?.p ?? 0).toBeCloseTo(l.p / (1 - k), 12);
    });
  });
});

// ---------------------------------------------------------------- E: overtime try

describe("E: the overtime try reads the score once both teams have possessed", () => {
  const otTry = (scoreDiff: number, secs: number, flag: number, yl = 2): Situation => ({
    phase: "try", down: 1, yardsToGo: yl, yardLine100: yl, scoreDiff, quarter: 5, secondsLeftInHalf: secs, secondsLeftInGame: secs, offenseTimeouts: 2, defenseTimeouts: 2, clockRunning: 0, otBothPossessed: flag,
  });

  it("E1: d.try.otDown2 passes with at least one such try (n reported), and real has none", () => {
    const t = otDown2(H);
    expect(t.tries).toBeGreaterThanOrEqual(1);
    expect(t.two).toBe(t.tries);
    expect(passOrAcceptedAtH("d.try.otDown2")).toBeNull();
    expect(n(real.counts, "try.otDown2.tries")).toBe(0);
  });

  it("E2: postseason league 4242 seed 6537 ev 296 (down 2 after the touchdown, OT 6:21): two-point on each of 1,000 draws", () => {
    const r = at(4242, 6537, 296);
    expect(r.event.offense?.call).toBe("extraPoint"); // what 4f25b28 did
    const s = toSituation(r.snapState, rules);
    expect([s.phase, s.quarter, s.secondsLeftInGame, s.scoreDiff, s.otBothPossessed]).toEqual(["try", 5, 381, -2, 1]);
    const rng = Rng.fromSeed(6537);
    for (let i = 0; i < 1000; i++) expect(coach.offenseCall(s, rng).call).toBe("goForTwo");
  });

  it("E3: flag 1: down 2 goes for two and tied kicks, at any overtime clock and after a foul moves the spot", () => {
    for (const secs of [600, 381, 301, 200, 30]) {
      for (const yl of [2, 1]) expect(share(otTry(-2, secs, 1, yl), "goForTwo"), `down 2 ${secs} ${yl}`).toBe(1);
      expect(share(otTry(0, secs, 1), "extraPoint"), `tied ${secs}`).toBe(1);
    }
  });

  it("E3: flag 1, down 1: the GF fitted backoff shares, the same as a regulation try down 1 in the final 2:00", () => {
    const reg: Situation = { ...otTry(-1, 60, 0), quarter: 4 };
    const want = offenseShares(reg, caller);
    expect(want.trace["oTry"]?.level).not.toBe(-2); // fitted, not charted
    for (const secs of [600, 381, 60]) {
      const got = offenseShares(otTry(-1, secs, 1), caller);
      expect(got.trace["oTry"]?.key, String(secs)).toBe(want.trace["oTry"]?.key);
      expect(got.leaves.find((l) => l.call === "extraPoint")?.p, String(secs)).toBe(want.leaves.find((l) => l.call === "extraPoint")?.p);
    }
  });

  it("E3: flag 0 (up 6, the first team's touchdown) and every regulation try give shares byte-identical to 4f25b28", () => {
    const fx = json<{ tries: { commit: string; groups: Record<string, { n: number; sha256: string }> } }>("test/fixtures/step5d-caller-frozen.json").tries;
    expect(fx.commit).toBe("4f25b28");
    const got = tryGroups();
    expect(Object.keys(got).sort()).toEqual(Object.keys(fx.groups).sort());
    expect(Object.entries(fx.groups).filter(([k, v]) => got[k]?.n !== v.n || got[k]?.sha256 !== v.sha256).map(([k]) => k)).toEqual([]);
    // The flag matters: with flag 1 the overtime groups differ from the frozen flag-0 shares.
    const flagOn = groupDigests(tryGrid().filter((s) => s.quarter === 5).map((s) => ({ ...s, otBothPossessed: 1 })), (s) => `q${s.quarter}|g${s.secondsLeftInGame}`);
    expect(Object.entries(flagOn).filter(([k, v]) => fx.groups[k]?.sha256 !== v.sha256).length).toBeGreaterThan(0);
  });

  it("E4: the report gives OT try counts by flag and score, sim (in-sample OT plus the postseason soak) next to real", () => {
    // Spec E4. GAME_REPORT gives d.try.otDown2 (score -2, flag 1) only; this looks for the full table:
    // tries by otBothPossessed (0 and 1) and by score after the touchdown, sim beside real.
    const sec = between(gameReport, "### Step 5d pre-registered checks", "\n## ");
    const rows = tableRows(sec).filter((r) => r.some((c) => /otBothPossessed|both possessed|flag/i.test(c)));
    const flags = new Set(rows.flatMap((r) => r.filter((c) => c === "0" || c === "1")));
    expect(rows.length, "a table of OT tries by flag and score").toBeGreaterThanOrEqual(2);
    expect(flags).toEqual(new Set(["0", "1"]));
  });
});

// ---------------------------------------------------------------- H: final run, acceptances, locked rules

describe("H1: the final in-sample run", () => {
  it("every gated 5d check passes at run H or carries Joseph's acceptance at exactly its run H value", () => {
    expect(GATED).toHaveLength(9);
    expect(GATED.map(passOrAcceptedAtH).filter((x) => x !== null)).toEqual([]);
  });

  it("the 14 5c checks that passed at 5c run H still pass at 5d run H", () => {
    const h = sim5c["5d.H"] as Run;
    expect(h.games).toBe(10_000);
    const out = checksFile.noRegression5c.mustStillPass.filter((id) => !passes5c(id, sim5c["H"] as Run) || !passes5c(id, h));
    expect(out).toEqual([]);
  });

  it("c.kneel.ballBack and c.fg.63 are at or better than 5c run H; c.fg.50to59 is worse and carries Joseph's 2026-11-13 acceptance at its 5d run H value", () => {
    const h5c = sim5c["H"] as Run;
    const h = sim5c["5d.H"] as Run;
    const gap = (id: string, run: Run): number => Math.abs(value5c(id, run.counts) - value5c(id, real5c.counts));
    for (const id of ["c.kneel.ballBack", "c.fg.63"]) expect(gap(id, h), id).toBeLessThanOrEqual(gap(id, h5c));
    expect(gap("c.fg.50to59", h)).toBeGreaterThan(gap("c.fg.50to59", h5c));
    const a = json<{ accepted: Accepted[] }>("data/game/step5c-accepted.json").accepted.filter((x) => x.check === "c.fg.50to59");
    expect(a).toHaveLength(1);
    expect([a[0]?.approved_by, a[0]?.scope, a[0]?.date]).toEqual(["Joseph", "insample", "2026-11-13"]);
    expect(a[0]?.observed).toBeCloseTo(value5c("c.fg.50to59", h.counts), digits(a[0]?.observed as number));
    expect(sec5d("### 5d misses accepted (Joseph, 2026-11-13)")).toMatch(/`c\.fg\.50to59` at 0\.7650 vs 0\.6415/);
  });

  it("c.ot.complete passes on league 4242 seeds 1-10,000; 0 invariant violations and 0 postseason ties in the committed run", () => {
    expect(passes5c("c.ot.complete", sim5c["5d.H"] as Run)).toBe(true);
    const ins = json<{ invariants: { violations: number; postseasonTies: number }; runSeed: number; games: number }>("data/game/calibration.insample.json");
    expect([ins.invariants.violations, ins.invariants.postseasonTies, ins.runSeed, ins.games]).toEqual([0, 0, 20261112, 10_000]);
  });

  it("the committed in-sample run is run H: its margin shares equal run H's margin counts", () => {
    const ins = json<{ metrics: Metric[] }>("data/game/calibration.insample.json");
    const now = new Map(ins.metrics.map((m) => [m.id, m.predicted]));
    for (const s of ["0", "1-3", "4-7", "8-14", "15-21", "22+"]) expect(now.get(`absMargin.share.${s}`), s).toBeCloseTo((100 * n(H.counts, `margin.${s}`)) / H.games, 9);
    for (const k of Object.keys(H.counts).filter((x) => x.startsWith("margin."))) expect((sim5c["5d.H"] as Run).counts[k], k).toBe(H.counts[k]);
  });

  it("every gated game metric that passed at the 5d baseline still passes at run H (a new miss only with Joseph's in-sample entry)", () => {
    const st = json<{ stages: Record<string, { metrics: Metric[] }> }>("data/game/calibration.insample.stages5d.json").stages;
    const tol = json<{ metrics: { id: string; gated: boolean }[]; known_deviations: Deviation[] }>("data/game/tolerances.json");
    const gated = new Set(tol.metrics.filter((m) => m.gated).map((m) => m.id));
    const before = new Map(st["baseline"]?.metrics.map((m) => [m.id, m.status]));
    const atH = st["H"]?.metrics ?? [];
    expect(atH.length).toBeGreaterThan(40);
    const covered = (id: string): boolean => tol.known_deviations.some((d) => d.metric === id && d.scope === "insample" && d.approved_by === "Joseph");
    const out = atH.filter((m) => gated.has(m.id) && before.get(m.id) === "pass" && m.status !== "pass" && !(m.status === "accepted" && covered(m.id))).map((m) => m.id);
    expect(out).toEqual([]);
  });

  it("GAME_REPORT has the before/after table by milestone with the close-margin rows", () => {
    const sec = between(gameReport, "### Step 5d pre-registered checks", "\n## ");
    const tables = sec.split("\n\n").filter((b) => b.includes("| Metric |") || b.includes("| Measure |"));
    expect(tables.length).toBeGreaterThanOrEqual(2);
    for (const row of ["absMargin 1-3", "absMargin 8-14", "exact 3"]) {
      const r = tableRows(sec).find((x) => x[0] === row);
      expect(r, row).toBeDefined();
      expect((r as string[]).slice(1, 8).every((c) => /^[\d.]+% \([\d.]+ to [\d.]+\)$/.test(c)), row).toBe(true);
    }
  });
});

describe("H1b, H2: the stop rule and the post hoc holdouts", () => {
  it("the holdout runs came after Joseph's in-sample acceptances in DECISIONS.md, one per changed pipeline, labelled step 5d", () => {
    const acc = d5d.indexOf("### 5d misses accepted (Joseph, 2026-11-13)");
    const runs = d5d.indexOf("### Holdout runs for step 5d");
    expect(acc).toBeGreaterThan(0);
    expect(runs).toBeGreaterThan(acc);
    const table = between(decisions, "### Holdout runs for step 5b", "\n### ");
    for (const [p, r] of [["Caller", 7], ["Engine", 8], ["C7", 7], ["Step 5 game", 11]] as const) {
      const row = tableRows(table).find((x) => x[0] === p && x[1] === String(r));
      expect(row, `${p} run ${r}`).toBeDefined();
      expect(row?.[2], `${p} run ${r}`).toMatch(/2026-11-13, step 5d/);
    }
    expect(sec5d("### Holdout runs for step 5d")).toMatch(/engine run 8[^.]*\(its summary pins the caller tables\)|engine \(its summary pins the caller tables\)/i);
  });
});

describe("task 3: approvals, dates and thresholds", () => {
  it("every 5d acceptance is Joseph's, in-sample, dated 2026-11-13, with a reason, for a gated check that fails at run H, at its run H values, and named in DECISIONS.md", () => {
    const sec = sec5d("### 5d misses accepted (Joseph, 2026-11-13)");
    expect(accepted.map((a) => a.check).sort()).toEqual(GATED.filter((id) => !passes(id, H)).sort());
    for (const a of accepted) {
      expect([a.approved_by, a.scope, a.date], a.check).toEqual(["Joseph", "insample", "2026-11-13"]);
      expect(typeof a.reason === "string" && a.reason.trim() !== "", a.check).toBe(true);
      expect(a.observed, a.check).toBeCloseTo(value(a.check, H.counts), digits(a.observed));
      expect(a.real, a.check).toBeCloseTo(value(a.check, real.counts), Math.max(digits(a.real), 2));
      expect(sec, a.check).toContain(`\`${a.check}\` ${a.observed.toFixed(digits(a.observed))}`);
    }
  });

  it("every known deviation dated 2026-11-13 is one Joseph's step 5d decisions name, at its run value, and nothing else was dated then", () => {
    const tol = json<{ known_deviations: Deviation[] }>("data/game/tolerances.json").known_deviations;
    const want: [string, string, number, number][] = [
      ["absMargin.share.8-14", "insample", 28.12, 22.7053],
      ["total.mean", "holdout", 44.1685, 45.9246],
      ["absMargin.share.8-14", "holdout", 28.12, 18.0147],
      ["fieldGoalAttempts.perGame", "holdout", 3.7309, 4.0496],
    ];
    const dated = tol.filter((d) => d.date === "2026-11-13").map((d) => [d.metric, d.scope, d.observed, d.target]);
    expect(dated.sort()).toEqual([...want].sort());
    for (const d of tol.filter((x) => x.date === "2026-11-13")) {
      expect(d.approved_by, d.metric).toBe("Joseph");
      expect(d.reason.trim(), d.metric).not.toBe("");
    }
    const ins = new Map(json<{ metrics: Metric[] }>("data/game/calibration.insample.json").metrics.map((m) => [m.id, m.predicted]));
    const hold = new Map(json<{ metrics: Metric[] }>("data/game/calibration.json").metrics.map((m) => [m.id, m.predicted]));
    for (const [m, scope, obs] of want) expect((scope === "insample" ? ins : hold).get(m), `${m} ${scope}`).toBeCloseTo(obs, 4);
    for (const [m] of want) expect(between(d5d, "### 5d misses accepted", "\n## ") + "", m).toContain(`\`${m}\``);
  });

  it.runIf(history)("step 5d changed no other known deviation: every entry not dated 2026-11-13 is as it was at 4f25b28", () => {
    const now = json<{ known_deviations: Deviation[] }>("data/game/tolerances.json").known_deviations.filter((d) => d.date !== "2026-11-13");
    const was = (JSON.parse(git("show", "4f25b28:data/game/tolerances.json")) as { known_deviations: Deviation[] }).known_deviations;
    const key = (d: Deviation): string => `${d.metric}|${d.scope ?? ""}`;
    const wasBy = new Map(was.map((d) => [key(d), d]));
    for (const d of now) expect(d, key(d)).toEqual(wasBy.get(key(d)));
    expect(new Set([...now.map(key), ...json<{ known_deviations: Deviation[] }>("data/game/tolerances.json").known_deviations.filter((d) => d.date === "2026-11-13").map(key)])).toEqual(new Set(was.map(key)));
    for (const f of ["data/caller/tolerances.json", "data/engine/tolerances.json"]) expect(git("diff", "4f25b28", "HEAD", "--", f), f).toBe("");
  });

  it("no tolerance threshold moved: the three tolerance files hash to their pre-registered content, and the checks files to their recorded sha256", () => {
    // Content hashes as in step5c.spec-check.test.ts (sha256 of JSON.stringify(file without known_deviations)).
    const CONTENT: Record<string, string> = {
      "data/caller/tolerances.json": "b27b5ff7e22cba897d24e0081861477aaf7160fe36f20d3af85cf2a9170d9942",
      "data/engine/tolerances.json": "25c80a1ce504ce1dd47898afbec5460a248a73ae87c48b4bedc87d07396691e7",
      "data/game/tolerances.json": "957f93baee86ef016b388c4fa7aaeff6822e3d6ec620ee0de79eb020ade070ea",
    };
    for (const [f, h] of Object.entries(CONTENT)) {
      const rest = json<Record<string, unknown>>(f);
      delete rest["known_deviations"];
      expect(createHash("sha256").update(JSON.stringify(rest)).digest("hex"), f).toBe(h);
    }
    expect(sha("data/game/step5d-checks.json")).toBe(CHECKS_SHA);
    expect(sha("data/game/step5c-checks.json")).toBe(CHECKS_5C_SHA);
    expect(sha("data/caller/latechecks.json")).toBe("06b6244077894771c7f4ee4f4b6b0ade0abc0e619376489d8025b8d0aa74b8f8");
    // DECISIONS records the game tolerances file's new bytes after Joseph's step 5d holdout acceptances.
    const h = sha("data/game/tolerances.json");
    expect(h).toBe("4b53dccd61a36efe2c77ecd3ca28b16d1f2bcff7b3e1bad9c04c3787dfe0f61b");
    expect(sec5d("### 5d holdout misses accepted (Joseph, 2026-11-13)")).toContain(h);
  });
});
