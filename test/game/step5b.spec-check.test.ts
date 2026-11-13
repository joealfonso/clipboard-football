// Test-writer spec checks for M1 step 5b (docs/specs/m1-step5b-late-game-and-clock-control.md), on the
// committed reports and data files the spec names: A2 (no-go recorded, no D code), B1, B9-B12, C3, C4,
// E1-E2, F1-F4 and the locked rule that tolerances stay byte-identical. Calibration outcomes are read,
// never recomputed here (no simulation).

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "../..");
const read = (f: string): string => readFileSync(join(REPO, f), "utf8");
const json = <T>(f: string): T => JSON.parse(read(f)) as T;
const sha = (f: string): string => createHash("sha256").update(readFileSync(join(REPO, f))).digest("hex");
const between = (doc: string, start: string, end: string | null): string => {
  const a = doc.indexOf(start);
  if (a < 0) throw new Error(`missing section: ${start}`);
  const b = end === null ? -1 : doc.indexOf(end, a + start.length);
  return doc.slice(a, b < 0 ? undefined : b);
};
const rows = (sec: string): string[][] => sec.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("| ") && !/^\|\s*-/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));

const decisions = read("docs/DECISIONS.md");
const d5b = between(decisions, "## M1 step 5b", null);
const callerReport = read("docs/CALLER_REPORT.md");
const gameReport = read("docs/GAME_REPORT.md");
const coachReport = read("docs/COACH_REPORT.md");
const checks = json<{ minN: number; lateDownsPp: number }>("data/caller/latechecks.json");

interface Metric { id: string; predicted: number; actual: number; status: string; n?: number }

// Known deviations accepted by Joseph (coordinator, 2026-11-12): each entry carries metric, observed,
// target, reason, scope ("insample" or "holdout"), date and approved_by "Joseph", applies only to its
// scope, and is listed by metric and scope in the DECISIONS.md entry "Step 5 misses accepted (Joseph, 2026-11-12)".
interface Deviation { metric?: unknown; observed?: unknown; target?: unknown; reason?: unknown; scope?: unknown; date?: unknown; approved_by?: unknown }
const SCOPES = new Set(["insample", "holdout"]);
const acceptedEntry = (): string => {
  const start = decisions.search(/^#+ Step 5 misses accepted \(Joseph, 2026-11-12\)/m);
  if (start < 0) return "";
  const level = (/^#+/.exec(decisions.slice(start)) ?? ["#"])[0].length;
  const bodyStart = decisions.indexOf("\n", start) + 1;
  const next = decisions.slice(bodyStart).search(new RegExp(`^#{1,${level}} `, "m"));
  return next < 0 ? decisions.slice(start) : decisions.slice(start, bodyStart + next);
};
const listedInDecisions = (metric: string, scope: string): boolean => {
  const words = scope === "insample" ? /insample|in-sample/i : /holdout/i;
  return acceptedEntry().split("\n").some((l) => l.includes(metric) && words.test(l));
};
const deviationProblems = (list: Deviation[]): string[] => {
  const out: string[] = [];
  for (const d of list) {
    const tag = String(d.metric);
    if (typeof d.metric !== "string" || d.metric === "") out.push(`${tag}: metric`);
    if (typeof d.observed !== "number") out.push(`${tag}: observed`);
    if (typeof d.target !== "number") out.push(`${tag}: target`);
    if (typeof d.reason !== "string" || d.reason.trim() === "") out.push(`${tag}: reason`);
    if (typeof d.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) out.push(`${tag}: date`);
    if (d.approved_by !== "Joseph") out.push(`${tag}: approved_by ${String(d.approved_by)}`);
    if (typeof d.scope !== "string" || !SCOPES.has(d.scope)) out.push(`${tag}: scope ${String(d.scope)}`);
    else if (typeof d.metric === "string" && !listedInDecisions(d.metric, d.scope)) out.push(`${tag}: not listed with scope ${d.scope} in the DECISIONS entry`);
  }
  return out;
};
const gameDevs = (): Deviation[] => json<{ known_deviations: Deviation[] }>("data/game/tolerances.json").known_deviations;
const callerDevs = (): Deviation[] => json<{ known_deviations: Deviation[] }>("data/caller/tolerances.json").known_deviations;
const covered = (list: Deviation[], metric: string, scope: string): boolean =>
  list.some((d) => d.metric === metric && d.scope === scope && d.approved_by === "Joseph" && listedInDecisions(metric, scope) && deviationProblems([d]).length === 0);

describe("A2: go/no-go recorded before any D code; D not built on a no-go", () => {
  it("DECISIONS.md records milestone A's decision against resolved question 1 before any milestone D entry", () => {
    const a = d5b.indexOf("### Milestone A");
    expect(a).toBeGreaterThanOrEqual(0);
    const aSec = between(d5b, "### Milestone A", "\n### ");
    expect(aSec).toMatch(/\*\*no-go\*\*|\bgo\b/);
    expect(aSec).toMatch(/spread across league seeds/);
    const dEntry = d5b.search(/### Milestone D\b/);
    if (dEntry >= 0) expect(dEntry).toBeGreaterThan(a);
  });

  it("on a no-go there is no out-of-bounds layer: no engine table, no MODEL.md part, engine config version unchanged", () => {
    const aSec = between(d5b, "### Milestone A", "\n### ");
    if (!/\*\*no-go\*\*/.test(aSec)) return;
    const engineFiles = readdirSync(join(REPO, "data/engine"));
    expect(engineFiles.filter((f) => /bounds|oob/i.test(f))).toEqual([]);
    expect(read("docs/MODEL.md")).not.toMatch(/Out of bounds by situation/);
    const head = JSON.parse(execFileSync("git", ["show", "HEAD:data/engine/config.json"], { cwd: REPO, encoding: "utf8" })) as { version: number };
    expect(json<{ version: number }>("data/engine/config.json").version).toBe(head.version);
    const sim = execFileSync("git", ["ls-files", "--others", "--cached", "--exclude-standard", "packages/sim/src"], { cwd: REPO, encoding: "utf8" });
    expect(sim.split("\n").filter((f) => /bounds|oob/i.test(f))).toEqual([]);
  });

  it("A1: every listed metric is reported baseline vs variant with the spread across league seeds for each", () => {
    const aSec = between(d5b, "### Milestone A", "\n### ");
    for (const m of [/absMargin/, /[Dd]rives per team-game/, /Overtime/, /Tie/, /Scrimmage plays/, /clock-stopping snap share, G5/, /clock-stopping snap share, GF/, /field goals in G5 when up 9\+/, /Drives starting in the final 2:00/])
      expect(aSec, String(m)).toMatch(m);
    // "and the spread across league seeds for each": every metric row carries a [min, max] spread.
    const metricRows = rows(aSec).filter((r) => r[0] !== "Metric" && r.length === 3);
    expect(metricRows.length).toBeGreaterThanOrEqual(10);
    const missing = metricRows.filter((r) => !/\[.*\]/.test(r[1] ?? "") || !/\[.*\]/.test(r[2] ?? "")).map((r) => r[0]);
    expect(missing, "rows without a league-seed spread").toEqual([]);
  });
});

describe("B1: candidate late-cell counts before the fit, and the level order in DECISIONS.md", () => {
  const sec = between(callerReport, "## 8e.", "## 8f.");
  const cfg = json<{ factors: Record<string, { levels: { dims: string[] }[] }> }>("data/caller/config.json");

  it("8e lists 2016-2023 and 2021-2023 counts and covers OT, every scoreLate5 bucket, zoneK and both kneel-out values", () => {
    expect(sec).toMatch(/\| cell \| plays 2016-2023 \| plays 2021-2023 \|/);
    const cells = [...sec.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1] ?? "");
    const parts = new Set(cells.flatMap((c) => c.split("|")));
    for (const p of ["OT", "G5", "GF", "<=-9", "-8..-1", "0", "1..8", ">=9", "K37", "K50", "K75", "K99", "K0", "K1"]) expect(parts.has(p), p).toBe(true);
  });

  // Amended 2026-11-12 (M1 step 5c milestone F): oTop's kneelGap level was added by step 5c, not 5b; it has
  // no 5b candidate count table and is recorded, with its real counts, in DECISIONS.md (M1 step 5c, Milestone F).
  // Amended 2026-11-13 (M1 step 5d milestone D): the not-leading late levels and the c40-banded o4Top late
  // levels were added by step 5d; their cells are recorded in DECISIONS.md (M1 step 5d, Milestones C and D).
  const STEP5C_LEVELS = new Set([
    "kneelGap, scoreLate5Only, lateTime",
    "down, zoneK, scoreNL, clock, lateTime",
    "zoneK, scoreNL, clock, lateTime",
    "fieldHalf, scoreNL, clock, lateTime",
    "zoneK, scoreLate5Only, lateTime, clock",
    "fieldHalf, scoreLate5Only, lateTime, clock",
  ]);

  it("every late-only level in the v3 config has an 8e count table", () => {
    for (const f of ["oTop", "o4Top"]) {
      for (const l of cfg.factors[f]?.levels ?? []) {
        if (!l.dims.includes("lateTime") || STEP5C_LEVELS.has(l.dims.join(", "))) continue;
        expect(sec, `${f}: ${l.dims.join(", ")}`).toContain(`### ${f}: ${l.dims.join(", ")}`);
      }
    }
  });

  it("DECISIONS.md records the chosen level order, which matches the config's late-only levels", () => {
    const b = between(d5b, "### Milestone B:", "\n### ");
    expect(b).toMatch(/before any 5b share was fitted|before the fit/);
    for (const f of ["oTop", "o4Top"]) {
      for (const l of cfg.factors[f]?.levels ?? []) {
        if (!l.dims.includes("lateTime") || STEP5C_LEVELS.has(l.dims.join(", "))) continue;
        expect(b, `${f} [${l.dims.join(", ")}]`).toContain(`[${l.dims.join(", ")}]`);
      }
    }
  });
});

describe("B9: CALLER_REPORT 8f late checks (5 pp where n >= 100)", () => {
  const sec = between(callerReport, "## 8f.", "\n## ");
  const r = rows(sec).filter((x) => x[0]?.startsWith("`")).map(([id, n, pred, act, status]) => ({ id: (id ?? "").replaceAll("`", ""), n: Number(n), pred: Number(pred), act: Number(act), status: status ?? "" }));

  it("has every row: (a) field goal and pass, (b) punt and go, (c) kneel by can-kneel-out, and the overtime rows", () => {
    for (const id of ["b9.a.fieldGoal", "b9.a.pass", "b9.b.punt", "b9.b.go", "b9.c.kneel.K0", "b9.c.kneel.K1"]) {
      expect(r.some((x) => x.id === id), id).toBe(true);
    }
    expect(r.filter((x) => x.id.endsWith(".OT")).length).toBeGreaterThanOrEqual(4);
    for (const x of r.filter((y) => y.id.endsWith(".OT"))) expect(x.status, x.id).toMatch(/^not gated/);
  });

  it("every regulation row with n >= 100 is within 5 pp, and every row under 100 is marked not gated", () => {
    const out: string[] = [];
    for (const x of r.filter((y) => !y.id.endsWith(".OT"))) {
      if (x.n < checks.minN) {
        expect(x.status, x.id).toMatch(/not gated/);
        continue;
      }
      if (Math.abs(x.pred - x.act) > checks.lateDownsPp + 0.05) out.push(`${x.id}: ${x.pred} vs ${x.act} (n ${x.n})`);
      expect(x.status, x.id).toBe(Math.abs(x.pred - x.act) > checks.lateDownsPp + 0.05 ? "fail" : "pass");
    }
    expect(out).toEqual([]);
  });

  it("Resolved 2: the overtime rows show kick and go rates for trailing teams, so a silly kick is visible", () => {
    const ot = r.filter((x) => x.id.startsWith("b9.b.") && x.id.endsWith(".OT"));
    expect(ot.map((x) => x.id).sort()).toEqual(["b9.b.go.OT", "b9.b.punt.OT"]);
  });
});

describe("B10: late cells past the last score-aware level", () => {
  const lb = json<{ lateLookups: number; rows: { factor: string; level: number; dims: string[]; key: string; lateTime: string; score: string; lookups: number; b9a: number; b9b: number }[] }>("data/game/late-backoff.json");
  const cfg = json<{ factors: Record<string, { levels: { dims: string[] }[] }> }>("data/caller/config.json");
  const SCORE = new Set(["scoreLate5Only", "scoreLateOnly", "scoreLateOnlyR", "scoreLate", "score3", "score7", "kneelOut"]);

  it("the report lists every row with its sim lookup count", () => {
    const sec = between(gameReport, "### Step 5b late cells past the last score-aware level (B10)", "\n### ");
    const listed = rows(sec).filter((x) => x[0] === "oTop" || x[0] === "o4Top");
    expect(listed.length).toBe(lb.rows.length);
    for (const x of lb.rows) expect(sec, x.key).toContain(`| ${x.factor} | ${x.level} | ${x.dims.join(", ")} | \`${x.key}\` | ${x.lateTime} | ${x.score} | ${x.lookups.toLocaleString("en-US")} |`);
  });

  it("every listed level really is past the factor's last score-aware level", () => {
    for (const x of lb.rows) {
      const levels = cfg.factors[x.factor]?.levels ?? [];
      const last = levels.map((l, i) => (l.dims.some((d) => SCORE.has(d)) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
      expect(x.level, `${x.factor} ${x.key}`).toBeGreaterThan(last);
    }
  });

  it("cells (a) and (b) of B9 are not on the list", () => {
    // (a) tied, GF, inside the 37, 3rd down is an oTop cell; (b) trailing 1-8, GF, own half, 4th down is o4Top.
    const a = lb.rows.filter((x) => x.factor === "oTop" && x.lateTime === "GF" && x.score === "0");
    const b = lb.rows.filter((x) => x.factor === "o4Top" && x.lateTime === "GF" && x.score === "-8..-1" && /OWN|BACK/.test(x.key));
    expect([...a, ...b].map((x) => x.key)).toEqual([]);
    expect(lb.rows.reduce((s, x) => s + x.b9a + x.b9b, 0)).toBe(0);
  });
});

describe("B11: no regression, size budget", () => {
  it("tables total at most 300 KB", () => {
    const total = ["data/caller/offense.table.json", "data/caller/defense.table.json"].reduce((s, f) => s + statSync(join(REPO, f)).size, 0);
    expect(total).toBeLessThanOrEqual(300 * 1024);
  });

  it("every 5a B5 and B6 row (CALLER_REPORT 8d) that passed before 5b still passes", () => {
    // Frozen before 5b from the 5a review: every gated lateDowns row passed except `lateDowns.>=17.kneel`
    // (docs/DECISIONS.md, step 5a section). So every gated row other than that one must pass now.
    const sec = between(callerReport, "## 8d.", "## 9.");
    // Amended 2026-11-12: a miss now reads "accepted" and passes only with a Joseph-approved insample
    // caller entry listed in DECISIONS ("Step 5 misses accepted"); `lateDowns.>=17.kneel` failed before 5b.
    const bad = rows(sec).filter((x) => x[4] === "fail" || x[4] === "accepted")
      .filter((x) => !(x[4] === "accepted" && covered(callerDevs(), (x[0] ?? "").replaceAll("`", ""), "insample")))
      .map((x) => `${x[0]}: ${x[2]} vs ${x[3]} (${x[4]})`);
    expect(bad.filter((x) => !x.startsWith("`lateDowns.>=17.kneel`"))).toEqual([]);
  });

  it("8b: every 4th-down and kneel row that passed (5 pp) after step 5a still passes", () => {
    // Frozen from the step 5a state as recorded in docs/DECISIONS.md step 5b, milestone B and C results:
    // "4th down field goal, zone FR" was -4.9 pp on 2016-2023 before 5b. Re-read here from 8b.
    const sec = between(callerReport, "## 8b.", "## 8c.");
    const row = rows(sec).find((x) => x[0] === "4th down field goal, zone FR");
    expect(row).toBeDefined();
    const diff = Number(row?.[2]) - Number(row?.[3]);
    // Amended 2026-11-12: a miss passes only with a Joseph-approved insample caller entry in DECISIONS.
    if (Math.abs(diff) > 5) expect(covered(callerDevs(), "fourthDown.FR.fieldGoal", "insample"), `zone FR field goal 2016-2023: ${row?.[2]} vs ${row?.[3]}, no accepted insample entry`).toBe(true);
  });
});

describe("B12/F4/C4: every holdout run is disclosed post hoc, and the run counts match DECISIONS.md", () => {
  // Amended 2026-11-12 (coordinator): the spec's intent is disclosure. Every holdout run is labelled post
  // hoc in its report, and DECISIONS.md "Holdout runs for step 5b" counts them: caller 5, game 7, engine 4, C7 2.
  // Amended 2026-11-12 (M1 step 5c): the step 5c holdout runs are counted in the same table (caller run 6,
  // engine runs 6 and 7, C7 runs 3 to 6, step 5 game runs 8 to 10).
  // Amended 2026-11-13 (M1 step 5d H2): the step 5d holdout runs are counted in the same table (caller run 7,
  // engine run 8, C7 run 7, step 5 game run 11).
  // Amended again 2026-11-13: C7 run 8 and step 5 game run 12, pins only after Joseph's step 5d holdout approvals.
  const EXPECTED: Record<string, number> = { Caller: 7, "Step 5 game": 12, Engine: 8, C7: 8 };
  const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  const maxRun = (label: string): number => {
    const ns = [...label.matchAll(/\brun (\d+)\b/gi)].map((m) => Number(m[1]));
    for (const m of label.matchAll(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine) (?:runs|times)\b/gi)) ns.push(WORDS[(m[1] ?? "").toLowerCase()] ?? Number(m[1]));
    return Math.max(0, ...ns);
  };
  const labels: Record<string, string> = {
    Caller: between(callerReport, "## 9. Validation", null).split("\n").find((l) => l.includes("Post-validation revision 3")) ?? "",
    "Step 5 game": gameReport.split("\n").filter((l) => /step 5b run \d/.test(l)).join("\n"),
    Engine: between(read("docs/ENGINE_REPORT.md"), "## 1. Validation", "\n## ").split("\n").find((l) => l.includes("Step 5b")) ?? "",
    C7: between(coachReport, "### validation 2024-2025", null).split("\n").find((l) => /^Post hoc/i.test(l)) ?? "",
  };

  it("DECISIONS.md has the run-count table with the expected runs per pipeline, numbered 1..n", () => {
    const sec = between(d5b, "### Holdout runs for step 5b", "\n### ");
    expect(sec).toMatch(/post hoc/i);
    const counts: Record<string, number[]> = {};
    let current = "";
    for (const r of rows(sec)) {
      if (r[0] === "Pipeline") continue;
      const name = Object.keys(EXPECTED).find((k) => (r[0] ?? "").startsWith(k));
      if (name !== undefined) current = name;
      (counts[current] ??= []).push(Number(r[1]));
    }
    for (const [k, n] of Object.entries(EXPECTED)) expect(counts[k], k).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(Object.keys(counts).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("each report labels its step 5b holdout runs post hoc, and the count its label gives matches the table", () => {
    for (const [k, n] of Object.entries(EXPECTED)) {
      const l = labels[k] ?? "";
      expect(l, k).toMatch(/post hoc/i);
      expect(maxRun(l), `${k} run count in the report label`).toBe(n);
    }
    expect(labels["Caller"]).toContain("docs/specs/m1-step5b-late-game-and-clock-control.md");
    for (const line of labels["Step 5 game"]?.split("\n") ?? []) expect(line, line.slice(0, 40)).toMatch(/post hoc/i);
  });
});

describe("C3: timeouts by side x score3 x (G5, GF), sim vs real, 2 pp where n >= 100", () => {
  const ins = json<{ diagnostics: Record<string, { predicted: number; actual: number; n: number }> }>("data/game/calibration.insample.json");
  const ids: string[] = [];
  for (const side of ["offense", "defense"]) for (const s of ["T", "0", "L"]) for (const w of ["G5", "GF"]) ids.push(`diag.timeoutRate.${side}.${s}.${w}`);

  it("the rows are in COACH_REPORT.md as the spec names", () => {
    const missing = ids.filter((id) => !coachReport.includes(id));
    expect(missing).toEqual([]);
  });

  it("all twelve rows exist in the in-sample run and every row with n >= 100 is within 2 pp", () => {
    const out: string[] = [];
    for (const id of ids) {
      const m = ins.diagnostics[id];
      expect(m, id).toBeDefined();
      if ((m?.n ?? 0) < 100) continue;
      const pp = Math.abs((m?.predicted ?? 0) - (m?.actual ?? 0)) * 100;
      if (pp > 2 && !covered(gameDevs(), id, "insample")) out.push(`${id}: sim ${((m?.predicted ?? 0) * 100).toFixed(2)}% vs real ${((m?.actual ?? 0) * 100).toFixed(2)}% (n ${m?.n})`);
    }
    expect(out).toEqual([]);
  });
});

describe("C4: C7 still passes in-sample; one holdout rerun, post hoc and labelled", () => {
  const cv = json<{ inSample: { metrics: Metric[] }; holdout: { metrics: Metric[] } }>("data/game/coach.validation.json");

  it("every in-sample C7 metric passes", () => {
    expect(cv.inSample.metrics.length).toBeGreaterThanOrEqual(11);
    expect(cv.inSample.metrics.filter((m) => m.status !== "pass").map((m) => m.id)).toEqual([]);
  });

  it("the 2024-2025 section of COACH_REPORT.md is labelled post hoc and names step 5b", () => {
    const sec = between(coachReport, "### validation 2024-2025", null);
    expect(sec).toMatch(/Post hoc/i);
    expect(sec).toContain("docs/specs/m1-step5b-late-game-and-clock-control.md");
  });
});

describe("E1, E2: investigations reported (report only)", () => {
  const sec = between(gameReport, "### Step 5b investigations (E, report only)", "\n## ");

  it("E1: safeties by cause and by spot, own 1-5 snaps and their oTop shares, sim vs real", () => {
    for (const s of ["safety.cause.sack", "safety.cause.run", "safety.cause.other", "safety.spot.own1-5", "safety.spot.own6-10", "own1-5.snaps"]) expect(sec, s).toContain(`| ${s}`);
    for (const c of ["run", "pass", "kneel", "punt", "fieldGoal"]) expect(sec, c).toContain(`Own 1-5, downs 1-3: ${c} share`);
  });

  it("E2: dropback and incompletion by score3 x time5 and the clock-stop decomposition", () => {
    for (const s of ["T", "0", "L"]) for (const t of ["H1", "H1F", "H2", "G5", "GF"]) expect(sec).toMatch(new RegExp(`\\| ${s} \\| ${t} \\| [0-9,]+ \\| [0-9,]+ \\|`));
    expect(sec).toMatch(/\| Score \| Time \| Incompletion \| Out of bounds \| Timeout \| Other \|/);
  });
});

describe("F1-F4: step 5 in-sample recheck", () => {
  const st = json<{ order: string[]; runs: Record<string, { metrics: Metric[]; extras: Record<string, number> }> }>("data/game/calibration.insample.stages5b.json");
  const ins = json<{ metrics: Metric[] }>("data/game/calibration.insample.json");
  const tol = json<{ metrics: { id: string; gated: boolean }[]; known_deviations: unknown[] }>("data/game/tolerances.json");
  const gated = new Set(tol.metrics.filter((m) => m.gated).map((m) => m.id));

  it("F1: baseline, after B and after C stages (D equals C, not built), every gated game metric and the five extras", () => {
    expect(st.order).toEqual(["baseline", "afterB", "afterC"]);
    const ids = ins.metrics.filter((m) => m.status !== "not gated").map((m) => m.id);
    expect(ids.length).toBeGreaterThan(40);
    for (const s of st.order) {
      const have = new Set(st.runs[s]?.metrics.map((m) => m.id));
      expect(ids.filter((id) => !have.has(id)), s).toEqual([]);
      for (const k of ["exact3", "otEndingOn3", "leaderStopG5", "leaderStopGF", "drivesStartingFinal2PerGame"]) expect(typeof st.runs[s]?.extras[k], `${s} ${k}`).toBe("number");
    }
    expect(gameReport).toMatch(/"after D" equals "after C"/);
  });

  // Amended 2026-11-12 (test-writer, M1 step 5c): step 5b ended with the after-C stage as the committed
  // in-sample run. Step 5c then re-ran the in-sample check after each milestone and once at the end
  // (docs/specs/m1-step5c-playtest-fixes.md, "Calibration rules for this step"); the committed run is now
  // 5c's run H (DECISIONS.md, "Milestone H" and "5c checks accepted": run H reproduced after the revert).
  // The pin is kept as two numeric links rather than dropped: the after-C stage is the run step 5c started
  // from (its baseline block, commit 3de880d), and the committed run is run H. Every margin share and the
  // two margin extras are compared exactly, so a stage file or run file from another run fails.
  it("F1: the after-C stage is the in-sample run step 5c started from (then the committed run)", () => {
    const sim5c = json<{ runs: Record<string, { games: number; counts: Record<string, number> }> }>("data/game/checks5c.sim.json").runs;
    const base = sim5c["baseline"];
    expect(base?.games).toBe(10000);
    const c = base?.counts ?? {};
    const after = new Map(st.runs["afterC"]?.metrics.map((m) => [m.id, m.predicted]));
    for (const s of ["0", "1-3", "4-7", "8-14", "15-21", "22+"]) expect(after.get(`absMargin.share.${s}`), s).toBeCloseTo((100 * (c[`margin.${s}`] ?? NaN)) / 10000, 9);
    expect(st.runs["afterC"]?.extras["exact3"]).toBeCloseTo((c["margin.exact3"] ?? NaN) / 10000, 9);
    expect(st.runs["afterC"]?.extras["otEndingOn3"]).toBeCloseTo((c["ot.endsOn3"] ?? NaN) / (c["ot.games"] ?? NaN), 9);
  });

  it("F1: the committed in-sample run is step 5c's final run H", () => {
    const H = json<{ runs: Record<string, { games: number; counts: Record<string, number> }> }>("data/game/checks5c.sim.json").runs["H"];
    expect(H?.games).toBe(10000);
    const c = H?.counts ?? {};
    const now = new Map(ins.metrics.map((m) => [m.id, m.predicted]));
    for (const s of ["0", "1-3", "4-7", "8-14", "15-21", "22+"]) expect(now.get(`absMargin.share.${s}`), s).toBeCloseTo((100 * (c[`margin.${s}`] ?? NaN)) / 10000, 9);
    expect(gameReport).toMatch(/H = after G, the final in-sample run/);
  });

  it("F2: tolerances unchanged: game file is the pre-registered one apart from known_deviations; caller and engine as committed apart from known_deviations", () => {
    // Pre-registered: sha256 b4fe3046... (DECISIONS.md, step 5). PRE_CONTENT is the sha256 of
    // JSON.stringify(file without known_deviations), computed by the test-writer on 2026-11-12 from the
    // file while its bytes still hashed to b4fe3046..., so it pins every pre-registered field.
    const PRE_BYTES = "b4fe3046cbaa699d93f80b2cb63e6b0fca87acbe5d424daee0acace27ef020b5";
    const PRE_CONTENT = "957f93baee86ef016b388c4fa7aaeff6822e3d6ec620ee0de79eb020ade070ea";
    const raw = json<Record<string, unknown>>("data/game/tolerances.json");
    const { known_deviations: kd, ...rest } = raw;
    expect(createHash("sha256").update(JSON.stringify(rest)).digest("hex"), "pre-registered game tolerance fields").toBe(PRE_CONTENT);
    if (Array.isArray(kd) && kd.length === 0) expect(sha("data/game/tolerances.json")).toBe(PRE_BYTES);
    for (const f of ["data/caller/tolerances.json", "data/engine/tolerances.json"]) {
      const head = JSON.parse(execFileSync("git", ["show", `HEAD:${f}`], { cwd: REPO, encoding: "utf8" })) as Record<string, unknown>;
      const now = json<Record<string, unknown>>(f);
      delete head["known_deviations"];
      delete now["known_deviations"];
      expect(now, f).toEqual(head);
    }
    const engine = json<{ known_deviations: { approved_by?: string }[] }>("data/engine/tolerances.json");
    for (const d of engine.known_deviations) expect(d.approved_by).toBe("Joseph");
  });

  it("F2: every game known deviation is complete, approved by Joseph, scoped, and listed by metric and scope in the DECISIONS entry", () => {
    expect(deviationProblems(tol.known_deviations as Deviation[])).toEqual([]);
  });

  for (const [scope, file] of [["insample", "data/game/calibration.insample.json"], ["holdout", "data/game/calibration.json"]] as const) {
    it(`F2: ${scope}: every miss has a ${scope}-scoped entry, and "accepted" appears only where one does`, () => {
      const run = json<{ metrics: Metric[] }>(file);
      const bad: string[] = [];
      for (const m of run.metrics) {
        if (m.status === "pass" || m.status === "not gated") continue;
        const has = covered(tol.known_deviations as Deviation[], m.id, scope);
        if (!has) bad.push(`${m.id}: ${m.status} with no ${scope} entry (${m.predicted.toFixed(2)} vs ${m.actual.toFixed(2)})`);
        else if (m.status !== "accepted") bad.push(`${m.id}: has a ${scope} entry but status ${m.status}`);
      }
      expect(bad).toEqual([]);
    });
  }

  it("F2: absMargin 1-3, absMargin 8-14 and drives per team-game pass, overtime rate still passes", () => {
    const status = new Map(ins.metrics.map((m) => [m.id, m]));
    const out: string[] = [];
    for (const id of ["absMargin.share.1-3", "absMargin.share.8-14", "drives.perTeamGame", "overtime.rate"]) {
      const m = status.get(id);
      expect(m, id).toBeDefined();
      // Amended 2026-11-12: a miss passes only as "accepted" with a Joseph-approved insample entry in DECISIONS.
      const ok = m?.status === "pass" || (m?.status === "accepted" && covered(gameDevs(), id, "insample"));
      if (!ok) out.push(`${id}: ${m?.predicted.toFixed(2)} vs ${m?.actual.toFixed(2)} (${m?.status})`);
    }
    expect(out).toEqual([]);
  });

  it("F2: nothing that passed at baseline fails after 5b", () => {
    const base = new Map(st.runs["baseline"]?.metrics.map((m) => [m.id, m.status]));
    const regress = ins.metrics.filter((m) => gated.has(m.id) && base.get(m.id) === "pass" && m.status !== "pass" && !(m.status === "accepted" && covered(gameDevs(), m.id, "insample"))).map((m) => `${m.id}: ${m.predicted.toFixed(2)} vs ${m.actual.toFixed(2)}`);
    expect(regress).toEqual([]);
  });

  it("F3: the 5a D3 rows are reported again for the after-5b run", () => {
    const ins2 = json<{ diagnostics: Record<string, unknown> }>("data/game/calibration.insample.json");
    for (const r of ["trailing4-8", "trailing1-3", "tied", "leading1-3", "leading4-8"])
      for (const k of ["late4thFieldGoal", "final2FieldGoalAttempts"]) {
        expect(ins2.diagnostics[`diag.${k}.${r}`], `${k}.${r}`).toBeDefined();
        expect(gameReport, `${k}.${r}`).toContain(`diag.${k}.${r}`);
      }
  });

  it("F4: the holdout run after 5b is labelled post hoc in GAME_REPORT.md and names this spec", () => {
    const line = gameReport.split("\n").find((l) => l.includes("after the step 5b amendment"));
    expect(line).toBeDefined();
    expect(line).toContain("docs/specs/m1-step5b-late-game-and-clock-control.md");
    expect(line).toMatch(/post hoc/);
    const holdout = json<{ target: string }>("data/game/calibration.json");
    expect(holdout.target).toBe("holdout");
    expect(existsSync(join(REPO, "data/game/calibration.insample.json"))).toBe(true);
  });
});
