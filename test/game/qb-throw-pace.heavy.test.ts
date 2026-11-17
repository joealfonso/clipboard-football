// "QB throws feel quick" (pass-play animation), A1 to A4 over a wide seed sweep, written by
// test-writer from the criteria. The fast suite (packages/app/test/qb-throw-pace.spec.test.ts) runs
// the same checks on six games; this one runs QB_THROW_GAMES (default 200) and checks A3 per class.
// How each quantity is measured: packages/app/test/qb-throw-pace.checks.ts.
//
//   ./node_modules/.bin/vitest run --config vitest.heavy.config.ts test/game/qb-throw-pace.heavy.test.ts

import { beforeAll, describe, expect, it } from "vitest";
import { C, dropBand, dropPeak, holdMovement, holdP90, keepSpeed, q, qbTop, sweepAll, type Row, type SackRow } from "../../packages/app/test/qb-throw-pace.checks";

const GAMES = Number(process.env["QB_THROW_GAMES"] ?? 200);
let rows: Row[] = [];
let sacks: SackRow[] = [];
beforeAll(() => {
  ({ rows, sacks } = sweepAll(Array.from({ length: GAMES }, (_, i) => i + 1)));
});

const CALLS = ["shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"];

describe(`QB throw pace over ${GAMES} games`, () => {
  it("prints the hold, drop peak and hold movement by class", () => {
    for (const call of CALLS) {
      const R = rows.filter((r) => r.call === call);
      const col = (k: "hold" | "dropPeak" | "holdMoveMs"): string => `${k} p10/50/90 ${[0.1, 0.5, 0.9].map((p) => q(R.map((r) => r[k]), p).toFixed(1)).join("/")}`;
      console.log(`[qb-throw] ${call} n ${R.length} | ${col("hold")} | ${col("dropPeak")} | ${col("holdMoveMs")}`);
    }
    expect(rows.length).toBeGreaterThan(20 * GAMES);
  });

  for (const call of ["shortPass", "screenPass", "playAction"]) {
    it(`A1 ${call}: hold p90 <= ${C.holdP90Ms} ms`, () => {
      expect(holdP90(rows, call).bad).toEqual([]);
    });
  }
  // R-C25 (spec revision 2026-11-16, deeper drops, shorter holds): their own bounds.
  for (const call of ["intermediatePass", "deepPass"]) {
    it(`A1 ${call}: hold p90 <= ${C.holdP90ClassMs[call]} ms (R-C25)`, () => {
      expect(holdP90(rows, call).bad).toEqual([]);
    });
  }

  for (const call of ["shortPass", "intermediatePass", "deepPass"]) {
    it(`A2 ${call}: drop peak >= ${C.dropPeakYps} yd/s, no hold movement over ${C.holdMoveMaxMs} ms`, () => {
      const n = rows.filter((r) => r.call === call).length;
      const slow = dropPeak(rows, call);
      const moving = holdMovement(rows, call);
      expect(slow.length, `${slow.length} of ${n} drops under ${C.dropPeakYps} yd/s: ${slow.slice(0, 10).join("; ")}`).toBe(0);
      expect(moving.length, `${moving.length} of ${n} holds with movement: ${moving.slice(0, 10).join("; ")}`).toBe(0);
    });
  }

  for (const call of ["shortPass", "intermediatePass", "deepPass", "playAction"]) {
    it(`A3 ${call}: at most ${100 * C.keepExceptShare}% of non-exempt completions under ${C.keepRatio} x into the catch`, () => {
      const k = keepSpeed(rows, [call]);
      console.log(`[qb-throw] A3 ${call}: ${k.under} of ${k.n}`);
      expect(k.n).toBeGreaterThan(0);
      expect(k.bad).toEqual([]);
    });
  }
  it.todo("A3 screenPass: keeps speed into the catch (pending a design decision on screens)");

  // R-C26 (spec revision 2026-11-16, deeper drops, shorter holds): the drop peak band, passes and sacks.
  for (const call of ["intermediatePass", "deepPass"]) {
    it(`R-C26 ${call}: drop peak at least ${C.dropPeakYps} yd/s and at most his own top on every pass and sack`, () => {
      const R = rows.filter((r) => r.call === call);
      const S = sacks.filter((r) => r.call === call);
      const all = [...R.map((r) => r.dropPeak / r.qbTop), ...S.map((r) => r.dropPeak / r.qbTop)];
      console.log(`[qb-throw] R-C26 ${call}: ${R.length} passes, ${S.length} sacks; drop peak / top p0/50/100 ${[0, 0.5, 1].map((p) => (p === 1 ? Math.max(...all) : q(all, p)).toFixed(3)).join("/")}; drop peak yd/s min ${Math.min(...R.map((r) => r.dropPeak), ...S.map((r) => r.dropPeak)).toFixed(2)}`);
      expect(R.length).toBeGreaterThan(0);
      expect(S.length).toBeGreaterThan(0);
      const bad = dropBand(rows, sacks, call);
      expect(bad.length, `${bad.length} of ${R.length + S.length}: ${bad.slice(0, 10).join("; ")}`).toBe(0);
    });
  }

  it("A4: no QB drawn over 1.05 x his top speed from the snap to the throw", () => {
    const bad = qbTop(rows);
    expect(bad.length, `${bad.length} of ${rows.length} passes: ${bad.slice(0, 10).join("; ")}`).toBe(0);
  });
});
