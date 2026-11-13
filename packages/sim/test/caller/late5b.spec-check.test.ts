// Test-writer spec checks for M1 step 5b, caller side (docs/specs/m1-step5b-late-game-and-clock-control.md,
// milestone B and the Resolved section). Derived from the spec text, not from the implementation:
// - B2: can-kneel-out from the spec's formula (4 - d) x P + k - P x min(t, 4 - d) >= secondsLeft,
//   P from the rule set, over a full grid; window edges 300/301 and 120/121 in Q4 and OT.
// - B3: scoreLate5 is a union of score7 buckets as well as of the 5a late buckets and lies inside score3.
// - Late windows are G5, GF and overtime only; the first half's final 2:00 is not late (Resolved 3).
// - The spec's reachable edge cases.
// - Resolved 2: an overtime situation with no overtime cell (trailing after an opening touchdown)
//   backs off to the G5/GF cells, never to a score-free level.

import { describe, expect, it } from "vitest";
import type { FactorTable, Situation } from "../../../shared/src/types";
import { binSituation } from "../../src/caller/bins";
import { offenseShares } from "../../src/caller/offense";
import { loadCallerData, readJson } from "./load-data";

const data = loadCallerData();
const dims = data.config.dimensions;
const rules = readJson("data/rules/nfl-2026.json") as { clock: { playClockAfterPlay: number } };
const P = rules.clock.playClockAfterPlay;
const top = data.offense.factors["oTop"] as FactorTable;
const four = data.offense.factors["o4Top"] as FactorTable;

const sit = (o: Partial<Situation>): Situation => ({
  phase: "scrimmage", down: 1, yardsToGo: 10, yardLine100: 50, scoreDiff: 0, quarter: 4, secondsLeftInHalf: 100, secondsLeftInGame: 100, offenseTimeouts: 2, defenseTimeouts: 2, clockRunning: 0, otBothPossessed: 0, ...o,
});
const p = (s: Situation, call: string): number => offenseShares(s, data).leaves.filter((l) => l.call === call).reduce((a, l) => a + l.p, 0);
const KICKS = new Set(["punt", "fieldGoal"]);
const go = (s: Situation): number => offenseShares(s, data).leaves.filter((l) => !KICKS.has(l.call)).reduce((a, l) => a + l.p, 0);
const SCORE_DIMS = ["scoreLate5Only", "scoreLateOnly", "scoreLate", "score3", "score7", "kneelOut"];

describe("B2: can kneel out follows the spec's formula with P from the rule set", () => {
  it("the play clock used is the rule set's (40 s in the 2026 rules)", () => {
    expect(P).toBe(40);
  });

  it("leading, downs 1-3, GF and OT: K1 exactly when (4 - d) x P + k - P x min(t, 4 - d) >= seconds left", () => {
    const k = (dims["kneelOut"] as { kneelSeconds?: number }).kneelSeconds;
    expect(typeof k).toBe("number");
    const bad: string[] = [];
    let k1 = 0;
    let k0 = 0;
    for (const quarter of [4, 5]) {
      const maxSecs = quarter === 4 ? 120 : 600;
      for (let secs = 1; secs <= maxSecs; secs++) {
        for (const down of [1, 2, 3]) {
          for (let t = 0; t <= 3; t++) {
            for (const scoreDiff of [1, 4, 8, 9, 20]) {
              const want = (4 - down) * P + (k as number) - P * Math.min(t, 4 - down) >= secs ? "K1" : "K0";
              const got = binSituation(sit({ quarter, secondsLeftInGame: secs, secondsLeftInHalf: secs, down, defenseTimeouts: t, scoreDiff }), dims)["kneelOut"];
              if (got !== want) bad.push(`q${quarter} ${secs}s down ${down} TO ${t} +${scoreDiff}: ${got} want ${want}`);
              if (want === "K1") k1++;
              else k0++;
            }
          }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
    expect(k1).toBeGreaterThan(0);
    expect(k0).toBeGreaterThan(0);
  });

  it("not leading, 4th down, G5, H1F or any time before Q4's final 2:00: no kneel-out bin", () => {
    const none = [
      sit({ scoreDiff: 0, secondsLeftInGame: 10, secondsLeftInHalf: 10, defenseTimeouts: 0 }),
      sit({ scoreDiff: -3, secondsLeftInGame: 10, secondsLeftInHalf: 10, defenseTimeouts: 0 }),
      sit({ scoreDiff: 4, down: 4, secondsLeftInGame: 10, secondsLeftInHalf: 10, defenseTimeouts: 0 }),
      sit({ scoreDiff: 4, secondsLeftInGame: 121, secondsLeftInHalf: 121, defenseTimeouts: 0 }),
      sit({ scoreDiff: 4, quarter: 2, secondsLeftInGame: 1810, secondsLeftInHalf: 10, defenseTimeouts: 0 }),
      sit({ scoreDiff: 4, quarter: 3, secondsLeftInGame: 910, secondsLeftInHalf: 910, defenseTimeouts: 0 }),
    ];
    for (const s of none) expect(binSituation(s, dims)["kneelOut"], JSON.stringify(s)).toBeNull();
  });

  it("edge case: leading by 4, 1st and 10, 1:50 left: kneels out with 0 defense timeouts (122 >= 110), not with 1 (82 < 110)", () => {
    expect(binSituation(sit({ scoreDiff: 4, secondsLeftInGame: 110, secondsLeftInHalf: 110, defenseTimeouts: 0 }), dims)["kneelOut"]).toBe("K1");
    expect(binSituation(sit({ scoreDiff: 4, secondsLeftInGame: 110, secondsLeftInHalf: 110, defenseTimeouts: 1 }), dims)["kneelOut"]).toBe("K0");
  });

  it("the kneel-out bin is used: K1 kneels far more often than K0 in the same score and down", () => {
    const k1 = sit({ scoreDiff: 4, secondsLeftInGame: 110, secondsLeftInHalf: 110, defenseTimeouts: 0, yardLine100: 60 });
    const k0 = { ...k1, defenseTimeouts: 1 };
    expect(offenseShares(k1, data).trace["oTop"]?.key).toContain("K1");
    expect(p(k1, "kneel")).toBeGreaterThan(p(k0, "kneel") + 0.3);
  });
});

describe("B2: late window edges in Q4 and overtime", () => {
  it("Q4: 301 s is outside, 300 and 121 are G5, 120 is GF; overtime is OT at every one of those seconds", () => {
    const want: Record<number, string> = { 301: "-", 300: "G5", 121: "G5", 120: "GF" };
    for (const [secs, label] of Object.entries(want)) {
      const s = Number(secs);
      expect(binSituation(sit({ secondsLeftInGame: s, secondsLeftInHalf: s }), dims)["lateTime"], `q4 ${s}`).toBe(label);
      expect(binSituation(sit({ quarter: 5, secondsLeftInGame: s, secondsLeftInHalf: s }), dims)["lateTime"], `ot ${s}`).toBe("OT");
    }
  });

  it("scoreLate5 buckets at -9, -8, -1, 0, 1, 8, 9 inside the windows, and null outside them", () => {
    const want: Record<number, string> = { [-9]: "<=-9", [-8]: "-8..-1", [-1]: "-8..-1", 0: "0", 1: "1..8", 8: "1..8", 9: ">=9" };
    for (const [d, label] of Object.entries(want)) {
      for (const [quarter, secs] of [[4, 300], [4, 120], [5, 500]] as const) {
        expect(binSituation(sit({ quarter, scoreDiff: Number(d), secondsLeftInGame: secs, secondsLeftInHalf: secs }), dims)["scoreLate5Only"], `${d} q${quarter} ${secs}`).toBe(label);
      }
      expect(binSituation(sit({ scoreDiff: Number(d), secondsLeftInGame: 301, secondsLeftInHalf: 301 }), dims)["scoreLate5Only"]).toBeNull();
    }
  });

  it("Resolved 3: the first half's final 2:00 is not a late window", () => {
    const l = binSituation(sit({ quarter: 2, scoreDiff: 3, secondsLeftInGame: 1860, secondsLeftInHalf: 60 }), dims);
    expect(l["lateTime"]).toBe("-");
    expect(l["scoreLate5Only"]).toBeNull();
  });
});

describe("B3: scoreLate5 is a union of score7, of the 5a late buckets, and lies inside score3", () => {
  it("diffs sharing a score7 bucket share a scoreLate5 bucket inside the windows", () => {
    const of = (d: number) => binSituation(sit({ scoreDiff: d, secondsLeftInGame: 200, secondsLeftInHalf: 200 }), dims);
    for (let d = -40; d <= 40; d++) {
      for (let e = -40; e <= 40; e++) {
        const a = of(d);
        const b = of(e);
        if (a["score7"] === b["score7"]) expect(b["scoreLate5Only"], `score7 ${d} vs ${e}`).toBe(a["scoreLate5Only"]);
        if (a["scoreLateOnly"] === b["scoreLateOnly"]) expect(b["scoreLate5Only"], `5a ${d} vs ${e}`).toBe(a["scoreLate5Only"]);
        if (a["scoreLate5Only"] === b["scoreLate5Only"]) expect(b["score3"], `score3 ${d} vs ${e}`).toBe(a["score3"]);
      }
    }
  });
});

describe("Reachable edge cases from the spec", () => {
  it("tied, 3rd and 8 at the opponent's 30, 0:20 left, no timeouts: a field goal on 3rd down is a real choice", () => {
    const s = sit({ down: 3, yardsToGo: 8, yardLine100: 30, scoreDiff: 0, secondsLeftInGame: 20, secondsLeftInHalf: 20, offenseTimeouts: 0, defenseTimeouts: 0 });
    const t = offenseShares(s, data).trace["oTop"];
    expect(top.levels[t?.level ?? -1]?.dims, "a zone-aware late level").toEqual(expect.arrayContaining(["zoneK"]));
    expect(p(s, "fieldGoal")).toBeGreaterThan(0.05);
  });

  it("leading, 4th down, GF: can-kneel-out does not apply; o4Top decides", () => {
    const s = sit({ down: 4, yardsToGo: 5, yardLine100: 60, scoreDiff: 4, secondsLeftInGame: 30, secondsLeftInHalf: 30, defenseTimeouts: 0 });
    expect(binSituation(s, dims)["kneelOut"]).toBeNull();
    expect(offenseShares(s, data).trace["o4Top"]).toBeDefined();
  });

  it("trailing by 7, 4th and 12 at the own 20, 1:10 left: served by a late score-aware zone cell, and goes", () => {
    const s = sit({ down: 4, yardsToGo: 12, yardLine100: 80, scoreDiff: -7, secondsLeftInGame: 70, secondsLeftInHalf: 70, offenseTimeouts: 1, defenseTimeouts: 2 });
    const t = offenseShares(s, data).trace["o4Top"];
    const d = four.levels[t?.level ?? -1]?.dims ?? [];
    expect(d.some((x) => SCORE_DIMS.includes(x)), `o4Top level ${t?.level} [${d.join(",")}]`).toBe(true);
    expect(d.some((x) => x === "zoneK" || x === "fieldHalf" || x === "zone6"), `o4Top level ${t?.level} [${d.join(",")}]`).toBe(true);
    expect(go(s)).toBeGreaterThan(0.5);
  });
});

describe("Resolved 2: overtime without its own cell backs off to the G5/GF cells", () => {
  // "Trailing after an opening touchdown" (down 7 in overtime) has no 2016-2023 counterpart.
  const cases: Situation[] = [];
  for (const down of [1, 2, 3])
    for (const yardLine100 of [20, 45, 60, 80])
      for (const secs of [590, 300, 100, 30]) cases.push(sit({ quarter: 5, scoreDiff: -7, down, yardLine100, yardsToGo: 10, secondsLeftInGame: secs, secondsLeftInHalf: secs }));
  for (const yardLine100 of [20, 45, 60, 80])
    for (const secs of [590, 100]) cases.push(sit({ quarter: 5, scoreDiff: -7, down: 4, yardLine100, yardsToGo: 5, secondsLeftInGame: secs, secondsLeftInHalf: secs }));

  it("every oTop and o4Top lookup for a team trailing by 7 in overtime lands on a G5/GF late cell with the score (not an old-rule OT cell)", () => {
    const bad: string[] = [];
    for (const s of cases) {
      const tr = offenseShares(s, data).trace;
      for (const [name, t] of [["oTop", top], ["o4Top", four]] as const) {
        const hit = tr[name];
        if (hit === undefined) continue;
        const d = t.levels[hit.level]?.dims ?? [];
        const lateG = hit.key.split("|").some((x) => x === "G5" || x === "GF");
        if (!d.includes("scoreLate5Only") || !lateG) bad.push(`${name} ${JSON.stringify(s)} -> level ${hit.level} [${d.join(",")}] ${hit.key}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("OT time maps to GF at 2:00 or less and G5 above it on the G5/GF fallback", () => {
    const at = (secs: number) => offenseShares(sit({ quarter: 5, scoreDiff: -7, down: 1, yardLine100: 60, secondsLeftInGame: secs, secondsLeftInHalf: secs }), data).trace["oTop"]?.key ?? "";
    expect(at(500).endsWith("|G5")).toBe(true);
    expect(at(100).endsWith("|GF")).toBe(true);
  });
});
