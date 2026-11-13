// Test-writer spec checks for M1 step 5a (docs/specs/m1-step5a-caller-late-game-bins.md), for the
// criteria the existing tests cover weakly or not at all: B1 (other factors in late windows), B3
// (TypeScript parent), B4 (golden coverage), B5-B7 (in-sample checks), C2-C4 and C6 (report and
// docs), D2-D4 and D6 (step 5 recheck), and the spec's reachable edge cases.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FactorTable, Situation } from "../../../shared/src/types";
import { binSituation } from "../../src/caller/bins";
import { lookup } from "../../src/caller/lookup";
import { formationShares, offenseShares } from "../../src/caller/offense";
import { loadCallerData, readFixture, readJson, repoRoot } from "./load-data";

const data = loadCallerData();
const dims = data.config.dimensions;
const read = (f: string): string => readFileSync(join(repoRoot, f), "utf8");
const callerReport = read("docs/CALLER_REPORT.md");
const gameReport = read("docs/GAME_REPORT.md");
const checks = readJson("data/caller/latechecks.json") as { fourthDownFieldGoalPp: number; lateDownsPp: number; minN: number; gameFieldGoalRatePp: number; gameFinalFieldGoalsPerGame: number };
const LATE_FACTORS = new Set(["oTop", "o4Top", "o4Kick"]);
const RUNS = ["insideRun", "outsideRun", "qbSneak"];
const PASSES = ["shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"];

// Amended 2026-11-12 (coordinator: Joseph accepted the step 5 misses). A miss passes only when a
// known_deviations entry with approved_by "Joseph" matches its metric and scope and is listed with that
// scope in DECISIONS.md "Step 5 misses accepted (Joseph, 2026-11-12)". Any other miss still fails.
const acceptedSection = (): string => {
  const d = read("docs/DECISIONS.md");
  const start = d.search(/^#+ Step 5 misses accepted \(Joseph, 2026-11-12\)/m);
  if (start < 0) return "";
  const level = (/^#+/.exec(d.slice(start)) ?? ["#"])[0].length;
  const bodyStart = d.indexOf("\n", start) + 1;
  const next = d.slice(bodyStart).search(new RegExp(`^#{1,${level}} `, "m"));
  return next < 0 ? d.slice(start) : d.slice(start, bodyStart + next);
};
type Deviation = { metric?: unknown; observed?: unknown; target?: unknown; reason?: unknown; scope?: unknown; date?: unknown; approved_by?: unknown };
const accepted = (file: string, metric: string, scope: "insample" | "holdout"): boolean => {
  const devs = (JSON.parse(read(file)) as { known_deviations: Deviation[] }).known_deviations;
  const words = scope === "insample" ? /insample|in-sample/i : /holdout/i;
  const listedHere = acceptedSection().split("\n").some((l) => l.includes(metric) && words.test(l));
  return listedHere && devs.some((d) => d.metric === metric && d.scope === scope && d.approved_by === "Joseph" &&
    typeof d.observed === "number" && typeof d.target === "number" && typeof d.reason === "string" && d.reason.trim() !== "" &&
    typeof d.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.date));
};
const callerAccepted = (metric: string): boolean => accepted("data/caller/tolerances.json", metric, "insample");
const gameAccepted = (metric: string): boolean => accepted("data/game/tolerances.json", metric, "insample");
// 8b row label -> caller metric id, for the 4th-down rows (others have no id and so cannot be accepted).
const metricOf8b = (label: string): string | null => {
  const m = /^4th down (field goal|go|punt), zone (\w+)$/.exec(label);
  return m === null ? null : `fourthDown.${m[2]}.${m[1] === "field goal" ? "fieldGoal" : m[1]}`;
};

const isLate = (s: Situation): boolean => s.phase === "scrimmage" && binSituation(s, dims)["scoreLateOnly"] !== null;
const sit = (o: Partial<Situation>): Situation => ({
  phase: "scrimmage", down: 4, yardsToGo: 3, yardLine100: 30, scoreDiff: 0, quarter: 4, secondsLeftInHalf: 180, secondsLeftInGame: 180, offenseTimeouts: 2, defenseTimeouts: 2, clockRunning: 0, otBothPossessed: 0, ...o,
});
const p = (s: Situation, call: string): number => offenseShares(s, data).leaves.filter((l) => l.call === call).reduce((a, l) => a + l.p, 0);
const go = (s: Situation): number => [...RUNS, ...PASSES].reduce((a, c) => a + p(s, c), 0);
const tableRows = (sec: string): string[][] => sec.split("\n").filter((l) => l.startsWith("| `")).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
const sectionOf = (doc: string, start: string, end: string): string => {
  const a = doc.indexOf(start);
  expect(a, start).toBeGreaterThanOrEqual(0);
  const b = doc.indexOf(end, a + start.length);
  return doc.slice(a, b < 0 ? undefined : b);
};

describe("B1: late windows, factors other than oTop, o4Top and o4Kick unchanged", () => {
  const frozen = readFixture("test/fixtures/caller-golden-v1.json") as {
    situations: { situation: Situation; offense: { leaves: { call: string; p: number }[]; trace: Record<string, { level: number; key: string; weights?: number[] }>; formations: Record<string, { level: number; key: string }> } }[];
  };
  const late = frozen.situations.filter((g) => isLate(g.situation));

  it("every pre-5a late situation keeps its other factor cells, formations and within-run and within-pass shares", () => {
    expect(late.length).toBeGreaterThan(20);
    for (const g of late) {
      const now = offenseShares(g.situation, data);
      const label = JSON.stringify(g.situation);
      for (const [name, t] of Object.entries(g.offense.trace)) {
        if (LATE_FACTORS.has(name)) continue;
        expect([now.trace[name]?.level, now.trace[name]?.key], `${name} ${label}`).toEqual([t.level, t.key]);
        if (t.weights !== undefined) expect(now.trace[name]?.weights, `${name} ${label}`).toEqual(t.weights);
      }
      for (const [play, t] of Object.entries(g.offense.formations)) {
        const f = formationShares(g.situation, play, data);
        expect([f.level, f.key], `${play} ${label}`).toEqual([t.level, t.key]);
      }
      for (const family of [RUNS, PASSES]) {
        const share = (ls: readonly { call: string; p: number }[]) => {
          const tot = ls.filter((l) => family.includes(l.call)).reduce((a, l) => a + l.p, 0);
          return family.map((c) => (tot > 0 ? (ls.find((l) => l.call === c)?.p ?? 0) / tot : 0));
        };
        const before = share(g.offense.leaves);
        const after = share(now.leaves);
        if (before.every((x) => x === 0) || after.every((x) => x === 0)) continue;
        after.forEach((x, i) => expect(x, `${family[i]} ${label}`).toBeCloseTo(before[i] ?? NaN, 9));
      }
    }
  });
});

describe("B3 (TypeScript) and the spec's reachable edge cases", () => {
  const o4Top = data.offense.factors["o4Top"] as FactorTable;
  const twin = (lvl: number) => (o4Top.levels[lvl] as { seasons?: { from: number } }).seasons?.from === 2016;

  it("4th and 3 at the 30, trailing by 5, 3:00 left: bucket -8..-4 in G5, a 2016-2023 twin cell, and the caller goes", () => {
    const s = sit({ scoreDiff: -5, secondsLeftInGame: 180, secondsLeftInHalf: 180 });
    expect(binSituation(s, dims)["scoreLateOnly"]).toBe("-8..-4");
    const t = offenseShares(s, data).trace["o4Top"];
    expect(t?.key).toContain("-8..-4");
    expect(twin(t?.level ?? -1)).toBe(true);
    expect(go(s)).toBeGreaterThan(p(s, "fieldGoal") + p(s, "punt"));
  });

  it("trailing by exactly 4 and 8 is -8..-4; by exactly 3 is -3..-1", () => {
    for (const d of [-4, -8]) expect(binSituation(sit({ scoreDiff: d }), dims)["scoreLateOnly"]).toBe("-8..-4");
    expect(binSituation(sit({ scoreDiff: -3 }), dims)["scoreLateOnly"]).toBe("-3..-1");
  });

  it("4th and goal at the 2, trailing by 3, 0:05 left: GF, -3..-1, and a field goal to tie", () => {
    const s = sit({ yardsToGo: 2, yardLine100: 2, scoreDiff: -3, secondsLeftInGame: 5, secondsLeftInHalf: 5 });
    const l = binSituation(s, dims);
    expect([l["time5"], l["scoreLateOnly"]]).toEqual(["GF", "-3..-1"]);
    expect(offenseShares(s, data).trace["o4Kick"]?.key).toContain("-3..-1");
    expect(p(s, "fieldGoal")).toBeGreaterThan(0.5);
  });

  it("a late o4Top cell missing lands on its parent: GF trailing 4-8 at K37 falls from the timed twin to the untimed twin", () => {
    const s = sit({ scoreDiff: -5, secondsLeftInGame: 90, secondsLeftInHalf: 90 });
    const labels = binSituation(s, dims);
    const full = lookup(o4Top, labels);
    expect(full?.key).toBe("K37|-8..-4|GF");
    expect(twin(full?.level ?? -1)).toBe(true);
    const cells = o4Top.cells.map((c, i) => (i === full?.level ? {} : c));
    const parent = lookup({ ...o4Top, cells }, labels);
    expect(parent?.key).toBe("K37|-8..-4");
    expect(twin(parent?.level ?? -1)).toBe(true);
    expect(parent?.level ?? 0).toBeGreaterThan(full?.level ?? 0);
  });

  it("overtime, trailing by 7 with 4:10 left: late bins, -8..-4, and the caller goes for it", () => {
    const s = sit({ quarter: 5, scoreDiff: -7, secondsLeftInGame: 250, secondsLeftInHalf: 250 });
    expect(binSituation(s, dims)["scoreLateOnly"]).toBe("-8..-4");
    expect(go(s)).toBeGreaterThan(p(s, "fieldGoal") + p(s, "punt"));
  });

  it("first half final 2:00, trailing by 3: not a late cell", () => {
    const s = sit({ quarter: 2, scoreDiff: -3, secondsLeftInHalf: 90, secondsLeftInGame: 1890 });
    expect(binSituation(s, dims)["scoreLateOnly"]).toBeNull();
    const t = offenseShares(s, data).trace["o4Top"];
    const lvl = o4Top.levels[t?.level ?? 0];
    expect(lvl?.dims.some((d) => d === "scoreLateOnly" || d === "zoneK")).toBe(false);
  });
});

describe("B4: golden file covers every late bucket and every level late situations reach", () => {
  const golden = readJson("data/caller/golden.json") as { situations: { situation: Situation; offense: { trace: Record<string, { level: number }> } }[] };
  const late = golden.situations.filter((g) => isLate(g.situation));

  it("at least 50 late situations in all nine late buckets", () => {
    expect(late.length).toBeGreaterThanOrEqual(50);
    const buckets = new Set(late.map((g) => binSituation(g.situation, dims)["scoreLateOnly"]));
    expect(buckets.size).toBe(9);
  });

  it("every (factor, level) a grid of late situations reaches appears in a late golden trace", () => {
    const covered = new Set(late.flatMap((g) => Object.entries(g.offense.trace).filter(([f]) => LATE_FACTORS.has(f)).map(([f, t]) => `${f}@${t.level}`)));
    const reached = new Set<string>();
    for (const down of [1, 2, 3, 4])
      for (const yardsToGo of [1, 3, 7, 10, 15])
        for (const yardLine100 of [2, 8, 20, 30, 37, 45, 60, 80, 95])
          for (const scoreDiff of [-20, -12, -6, -2, 0, 2, 6, 12, 20])
            for (const secs of [290, 150, 100, 30])
              for (const [ot, dt] of [[0, 0], [3, 3], [1, 0]] as const) {
                const s = sit({ down, yardsToGo: Math.min(yardsToGo, yardLine100), yardLine100, scoreDiff, secondsLeftInGame: secs, secondsLeftInHalf: secs, offenseTimeouts: ot, defenseTimeouts: dt });
                for (const [f, t] of Object.entries(offenseShares(s, data).trace)) if (LATE_FACTORS.has(f)) reached.add(`${f}@${t.level}`);
              }
    expect([...reached].filter((k) => !covered.has(k)).sort()).toEqual([]);
  }, 30_000);
});

describe("B5, B6: late in-sample checks (CALLER_REPORT.md 8d)", () => {
  const sec = sectionOf(callerReport, "## 8d.", "## 9.");
  const rows = tableRows(sec).map(([id, n, pred, act, status]) => ({ id: (id ?? "").replaceAll("`", ""), n: Number(n), pred: Number(pred), act: Number(act), status: status ?? "" }));

  it("has all five 4th-down score rows (both windows) and pass and kneel for all nine late buckets", () => {
    for (const s of ["trailing 4-8", "trailing 1-3", "tied", "leading 1-3", "leading 4-8"])
      for (const w of ["all", "recent"]) expect(rows.some((r) => r.id === `late4th.${s}.fieldGoal.${w}`), `${s} ${w}`).toBe(true);
    for (const b of ["<=-17", "-16..-9", "-8..-4", "-3..-1", "0", "1..3", "4..8", "9..16", ">=17"])
      for (const k of ["pass", "kneel"]) expect(rows.some((r) => r.id === `lateDowns.${b}.${k}`), `${b} ${k}`).toBe(true);
  });

  it("statuses follow from the thresholds: B5 gates 2021-2023 field goal rows with n >= minN; B6 gates downs 1-3 rows with n >= minN", () => {
    for (const r of rows) {
      let want: string;
      if (r.id.startsWith("late4th.") && r.id.endsWith(".fieldGoal.recent")) want = r.n < checks.minN ? "not gated (n below minN)" : Math.abs(r.pred - r.act) <= checks.fourthDownFieldGoalPp ? "pass" : "fail";
      else if (r.id.startsWith("late4th.")) want = "not gated";
      else want = r.n < checks.minN ? "not gated (n below minN)" : Math.abs(r.pred - r.act) <= checks.lateDownsPp + 0.05 ? "pass" : "fail";
      if (want !== "fail" && r.status === "fail" && Math.abs(Math.abs(r.pred - r.act) - checks.lateDownsPp) < 0.06) continue; // rounding at the edge
      // A threshold miss may read "accepted" only with a Joseph-approved insample caller entry.
      if (want === "fail" && r.status === "accepted" && callerAccepted(r.id)) continue;
      expect(r.status, r.id).toBe(want);
    }
  });

  it("B6: every gated downs 1-3 late row is within the threshold", () => {
    const failing = rows.filter((r) => r.id.startsWith("lateDowns.") && (r.status === "fail" || (r.status === "accepted" && !callerAccepted(r.id)))).map((r) => `${r.id}: ${r.pred} vs ${r.act}`);
    expect(failing).toEqual([]);
  });
});

describe("B7: step 2 8b rows that passed before still pass (5 pp)", () => {
  // Frozen from docs/CALLER_REPORT.md section 8b at commit b9d4730 (before step 5a):
  // [label, predicted 2016-2023, actual 2016-2023, predicted 2021-2023, actual 2021-2023].
  const before: [string, number, number, number, number][] = [
    ["Pass rate, down 1", 49.9, 50.2, 49.8, 49.9], ["Pass rate, down 2", 61.2, 60.9, 61.0, 60.8], ["Pass rate, down 3", 81.9, 81.2, 81.5, 79.6], ["Pass rate, down 4", 12.0, 11.1, 12.2, 13.1],
    ["4th down field goal, zone BACK", 0, 0, 0, 0], ["4th down go, zone BACK", 3.1, 2.8, 3.1, 3.8], ["4th down punt, zone BACK", 96.9, 97.2, 96.9, 96.2],
    ["4th down field goal, zone FR", 72.9, 75.4, 72.2, 73.0], ["4th down go, zone FR", 26.3, 23.5, 27.0, 26.4], ["4th down punt, zone FR", 0.6, 0.9, 0.6, 0.5],
    ["4th down field goal, zone GL", 39.2, 54.3, 39.5, 49.9], ["4th down go, zone GL", 60.4, 45.5, 60.2, 49.7], ["4th down punt, zone GL", 0, 0, 0, 0],
    ["4th down field goal, zone MID", 10.3, 9.0, 10.2, 10.9], ["4th down go, zone MID", 35.8, 30.4, 36.2, 34.6], ["4th down punt, zone MID", 53.9, 60.6, 53.5, 54.5],
    ["4th down field goal, zone OWN", 0, 0, 0, 0], ["4th down go, zone OWN", 7.3, 8.6, 7.6, 10.8], ["4th down punt, zone OWN", 92.7, 91.3, 92.4, 89.2],
    ["4th down field goal, zone RZ", 77.9, 81.4, 77.1, 78.5], ["4th down go, zone RZ", 22.0, 18.5, 22.8, 21.5], ["4th down punt, zone RZ", 0, 0, 0, 0],
    ["Kneel, final 2:00 of the game, tied", 4.9, 5.3, 4.9, 6.1], ["Kneel, final 2:00 of the game, leading", 48.9, 49.0, 48.7, 48.8], ["Kneel, final 2:00 of the game, trailing", 0.7, 0.8, 0.7, 1.1],
    ["Kneel, final 2:00 of the half, tied", 2.7, 3.0, 2.9, 3.0], ["Kneel, final 2:00 of the half, leading", 3.5, 3.3, 3.4, 2.7], ["Kneel, final 2:00 of the half, trailing", 3.7, 2.9, 3.6, 3.4],
  ];
  const sec = sectionOf(callerReport, "## 8b.", "## 8c.");
  const now = new Map(sec.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| metric")).map((l) => {
    const c = l.split("|").slice(1, -1).map((x) => x.trim());
    return [c[0] as string, [Number(c[2]), Number(c[3]), Number(c[5]), Number(c[6])]] as const;
  }));
  const within = (a: number, b: number) => Math.abs(a - b) <= 5 + 1e-9;

  for (const [window, i] of [["2021-2023", 2], ["2016-2023", 0]] as const) {
    it(`every row that passed on ${window} still passes`, () => {
      const moved: string[] = [];
      for (const [label, ...v] of before) {
        const n = now.get(label);
        expect(n, label).toBeDefined();
        if (!within(v[i] as number, v[i + 1] as number)) continue;
        const id = metricOf8b(label);
        if (!within(n?.[i] ?? NaN, n?.[i + 1] ?? NaN) && !(id !== null && callerAccepted(id))) moved.push(`${label}: ${n?.[i]} vs ${n?.[i + 1]} (was ${v[i]})`);
      }
      expect(moved).toEqual([]);
    });
  }
});

describe("C2, C3, C4: holdout re-validation is labelled post hoc (CALLER_REPORT.md 9)", () => {
  const sec = callerReport.slice(callerReport.indexOf("## 9. Validation"));
  const validation = readJson("data/caller/validation.json") as { metrics: { id: string; group: string; label: string; status: string }[] };
  const tol = readJson("data/caller/tolerances.json") as { known_deviations: { metric: string }[] };

  it("C2: says post-validation revision 2, after both holdouts, driven by in-sample findings", () => {
    expect(sec).toMatch(/Post-validation revision 2/);
    expect(sec).toMatch(/after both the caller's 2024-2025 holdout and the step 5 game-level holdout/);
    expect(sec).toMatch(/in-sample findings/);
  });

  it("C2: every metric touching oTop, o4Top or o4Kick is marked revised after holdout", () => {
    const touched = validation.metrics.filter((m) => /^(passRate|fourthDown|kneel|spike)/.test(m.id));
    expect(touched.length).toBeGreaterThan(20);
    for (const m of touched) {
      const row = sec.split("\n").find((l) => l.startsWith(`| ${m.label} |`));
      expect(row, m.id).toBeDefined();
      expect(row?.split("|").map((c) => c.trim()).at(-3), m.id).toBe("yes");
    }
  });

  it("C3: late-window rows are shown for 2024-2025 and not gated", () => {
    const late = sec.slice(sec.indexOf("Late-game rows on 2024-2025"));
    expect(late).toMatch(/not gated/);
    const rows = tableRows(late);
    expect(rows.some((r) => r[0]?.includes("late4th.tied.fieldGoal"))).toBe(true);
    expect(rows.some((r) => r[0]?.includes("lateDowns."))).toBe(true);
    for (const r of rows) expect(r.length, r[0]).toBe(4);
    expect(validation.metrics.some((m) => /^late/.test(m.id))).toBe(false);
  });

  // Amended 2026-11-12 (coordinator: Joseph accepted the step 5 misses). Was "exactly 5 entries". Now each
  // entry carries metric, observed, target, reason, scope ("insample" or "holdout"), date and
  // approved_by "Joseph"; is listed by metric and scope in DECISIONS.md "Step 5 misses accepted (Joseph,
  // 2026-11-12)"; applies only to its scope (validation.json is the 2024-2025 holdout); and a holdout miss
  // with no matching entry still fails.
  const decisions = read("docs/DECISIONS.md");
  const entry = (() => {
    const start = decisions.search(/^#+ Step 5 misses accepted \(Joseph, 2026-11-12\)/m);
    if (start < 0) return "";
    const level = (/^#+/.exec(decisions.slice(start)) ?? ["#"])[0].length;
    const bodyStart = decisions.indexOf("\n", start) + 1;
    const next = decisions.slice(bodyStart).search(new RegExp(`^#{1,${level}} `, "m"));
    return next < 0 ? decisions.slice(start) : decisions.slice(start, bodyStart + next);
  })();
  const listed = (metric: string, scope: string): boolean =>
    entry.split("\n").some((l) => l.includes(metric) && (scope === "insample" ? /insample|in-sample/i : /holdout/i).test(l));
  type Dev = { metric?: unknown; observed?: unknown; target?: unknown; reason?: unknown; scope?: unknown; date?: unknown; approved_by?: unknown };
  const devs = tol.known_deviations as Dev[];

  it("C4: every known deviation is complete, approved by Joseph, scoped, and listed by metric and scope in the DECISIONS entry", () => {
    const bad: string[] = [];
    for (const d of devs) {
      const tag = String(d.metric);
      if (typeof d.metric !== "string" || d.metric === "") bad.push(`${tag}: metric`);
      if (typeof d.observed !== "number") bad.push(`${tag}: observed`);
      if (typeof d.target !== "number") bad.push(`${tag}: target`);
      if (typeof d.reason !== "string" || d.reason.trim() === "") bad.push(`${tag}: reason`);
      if (typeof d.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) bad.push(`${tag}: date`);
      if (d.approved_by !== "Joseph") bad.push(`${tag}: approved_by ${String(d.approved_by)}`);
      if (d.scope !== "insample" && d.scope !== "holdout") bad.push(`${tag}: scope ${String(d.scope)}`);
      else if (typeof d.metric === "string" && !listed(d.metric, d.scope)) bad.push(`${tag}: not listed with scope ${d.scope} in the DECISIONS entry`);
    }
    expect(bad).toEqual([]);
  });

  it("C4: holdout misses: every fail or accepted metric has a holdout-scoped entry, and accepted appears only where one does", () => {
    const bad: string[] = [];
    for (const m of validation.metrics) {
      if (m.status === "pass" || m.status === "not gated") continue;
      const has = devs.some((d) => d.metric === m.id && d.scope === "holdout" && d.approved_by === "Joseph" && listed(m.id, "holdout"));
      if (!has) bad.push(`${m.id}: ${m.status} with no holdout entry`);
      else if (m.status !== "accepted") bad.push(`${m.id}: has a holdout entry but status ${m.status}`);
    }
    expect(bad).toEqual([]);
  });

  it("C4: each holdout-scoped known deviation is marked still failing (accepted) or now passing", () => {
    for (const d of tol.known_deviations.filter((x) => (x as Dev).scope === "holdout")) {
      const m = validation.metrics.find((x) => x.id === d.metric);
      expect(m, d.metric).toBeDefined();
      expect(["accepted", "pass"], d.metric).toContain(m?.status);
      const row = sec.split("\n").find((l) => l.startsWith(`| ${m?.label} |`));
      expect(row, d.metric).toMatch(m?.status === "pass" ? /\| pass \|$/ : /accepted \(known deviation approved by Joseph\) \|$/);
    }
  });

  it("C6: step 2 spec points here from its Resolved section; DECISIONS has the revision 2 entry with both config hashes", () => {
    const step2 = read("docs/specs/m1-step2-call-menus-and-baseline-caller.md");
    const resolved = step2.slice(step2.search(/^## Resolved/m));
    expect(resolved).toContain("docs/specs/m1-step5a-caller-late-game-bins.md");
    const d = read("docs/DECISIONS.md");
    const entry = d.slice(d.indexOf("### Post-validation revision 2 (caller late-game bins)"));
    expect(entry).toMatch(/from `[0-9a-f]{64}` to `[0-9a-f]{64}`/);
    const now = createHash("sha256");
    for (const f of ["data/calls/catalog.json", "data/caller/config.json"]) now.update(readFileSync(join(repoRoot, f))).update(Buffer.from([0]));
    expect(entry).toContain(now.digest("hex"));
  });
});

describe("D2, D3, D4, D6: step 5 recheck (GAME_REPORT.md and calibration.insample.json)", () => {
  const ins = readJson("data/game/calibration.insample.json") as { diagnostics: Record<string, { predicted: number; actual: number }> };
  const ROWS = ["trailing4-8", "trailing1-3", "tied", "leading1-3", "leading4-8"];

  it("D2: both late diagnostics tables with all five score rows are in the in-sample section", () => {
    const sec = sectionOf(gameReport, "### Step 5a late-game diagnostics", "### Step 5a before and after");
    for (const r of ROWS) for (const k of ["late4thFieldGoal", "final2FieldGoalAttempts"]) expect(sec).toContain(`diag.${k}.${r}`);
  });

  it("D3: the sim's late 4th-down field goal rate within 10 pp of real, and final-2:00 field goal tries within 0.02 per game, in every row", () => {
    const out: string[] = [];
    for (const r of ROWS) {
      const rate = ins.diagnostics[`diag.late4thFieldGoal.${r}`];
      const tries = ins.diagnostics[`diag.final2FieldGoalAttempts.${r}`];
      expect(rate && tries, r).toBeTruthy();
      if (Math.abs((rate?.predicted ?? 0) - (rate?.actual ?? 0)) * 100 > checks.gameFieldGoalRatePp && !gameAccepted(`diag.late4thFieldGoal.${r}`)) out.push(`late4thFieldGoal.${r}`);
      if (Math.abs((tries?.predicted ?? 0) - (tries?.actual ?? 0)) > checks.gameFinalFieldGoalsPerGame + 1e-9 && !gameAccepted(`diag.final2FieldGoalAttempts.${r}`)) out.push(`final2FieldGoalAttempts.${r}`);
    }
    expect(out).toEqual([]);
  });

  it("D4: the before and after table has every metric the spec lists", () => {
    const sec = sectionOf(gameReport, "### Step 5a before and after", "## 2.");
    const ids = ["overtime.rate", "tie.rate", "onside.perGame", "fieldGoalAttempts.perGame", "fourthDownGo.perGame", "punts.perGame", "points.mean", "total.mean", "margin.sd", "homeMargin.mean", "homeWin.rate",
      ...["0", "1-3", "4-7", "8-14", "15-21", "22+"].map((b) => `absMargin.share.${b}`),
      ...["touchdown", "fieldGoal", "missedFieldGoal", "punt", "turnover", "downs", "endOfHalf", "safety"].map((k) => `driveResult.share.${k}`)];
    for (const id of ids) expect(sec, id).toContain(`| \`${id}\` |`);
  });

  it("D6: the holdout run is labelled post hoc and tolerances are the pre-registered file", () => {
    expect(gameReport.slice(0, gameReport.indexOf("## 1."))).toMatch(/post hoc/);
    // Amended 2026-11-12: known_deviations may now hold Joseph-approved entries (checked in
    // test/game/step5b.spec-check.test.ts). Every other field must be the pre-registered file's: the
    // content hash below was taken from the file while its bytes hashed to b4fe3046...; with no
    // deviations the bytes themselves must still match.
    const raw = readFileSync(join(repoRoot, "data/game/tolerances.json"));
    const { known_deviations: kd, ...rest } = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    expect(createHash("sha256").update(JSON.stringify(rest)).digest("hex")).toBe("957f93baee86ef016b388c4fa7aaeff6822e3d6ec620ee0de79eb020ade070ea");
    if (Array.isArray(kd) && kd.length === 0) expect(createHash("sha256").update(raw).digest("hex")).toBe("b4fe3046cbaa699d93f80b2cb63e6b0fca87acbe5d424daee0acace27ef020b5");
  });
});
