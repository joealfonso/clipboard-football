// "QB throws feel quick" (pass-play animation), acceptance criteria A1 to A5 and the drive() helper,
// written by test-writer from the criteria, not the code. Measured on a few headless games (natural
// motion on, drawn keys every 25 ms); the wide seed sweep is test/game/qb-throw-pace.heavy.test.ts.
// How each quantity is measured: qb-throw-pace.checks.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { drive, type Key, type Pt } from "../src/ui/motion";
import { C, dropBand, dropPeak, holdMovement, holdP90, keepSpeed, qbTop, sackTop, sweepAll, type Row, type SackRow } from "./qb-throw-pace.checks";

const SEEDS = [1, 2, 3, 4, 5, 6];
let rows: Row[] = [];
let sacks: SackRow[] = [];
beforeAll(() => {
  ({ rows, sacks } = sweepAll(SEEDS));
}, 120_000);

const count = (call: string): number => rows.filter((r) => r.call === call).length;

describe("A1: hold from the drop end to the throw", () => {
  for (const call of ["shortPass", "screenPass", "playAction"]) {
    it(`${call}: p90 <= ${C.holdP90Ms} ms`, () => {
      const h = holdP90(rows, call);
      console.log(`[qb-throw] A1 ${call} n ${h.n} hold p50 ${h.p50} ms, p90 ${h.p90} ms`);
      expect(h.n, `${call} passes in seeds ${SEEDS.join(",")}`).toBeGreaterThan(0);
      expect(h.bad).toEqual([]);
    });
  }
  // R-C25 (spec revision 2026-11-16, deeper drops, shorter holds): their own bounds.
  for (const call of ["intermediatePass", "deepPass"]) {
    it(`${call}: p90 <= ${C.holdP90ClassMs[call]} ms (R-C25)`, () => {
      const h = holdP90(rows, call);
      console.log(`[qb-throw] A1 ${call} n ${h.n} hold p50 ${h.p50} ms, p90 ${h.p90} ms`);
      expect(h.n, `${call} passes in seeds ${SEEDS.join(",")}`).toBeGreaterThan(0);
      expect(h.bad).toEqual([]);
    });
  }
});

describe("A2: a real drop, then a still hold", () => {
  for (const call of ["shortPass", "intermediatePass", "deepPass"]) {
    it(`${call}: drop peak >= ${C.dropPeakYps} yd/s on every pass`, () => {
      expect(count(call)).toBeGreaterThan(0);
      expect(dropPeak(rows, call)).toEqual([]);
    });
    it(`${call}: no QB movement over ${C.moveYps} yd/s longer than ${C.holdMoveMaxMs} ms between the drop end and the throw`, () => {
      expect(count(call)).toBeGreaterThan(0);
      expect(holdMovement(rows, call)).toEqual([]);
    });
  }
});

describe("A3: the receiver keeps his speed into the catch", () => {
  it(`short, intermediate, deep and play-action completions: at most ${100 * C.keepExceptShare}% under ${C.keepRatio} x (sit finishes and catch-spot ends exempt)`, () => {
    const k = keepSpeed(rows, ["shortPass", "intermediatePass", "deepPass", "playAction"]);
    console.log(`[qb-throw] A3 ${k.under} of ${k.n} non-exempt completions under ${C.keepRatio}`);
    expect(k.n).toBeGreaterThan(20);
    expect(k.bad).toEqual([]);
  });
  it.todo("screenPass completions keep their speed into the catch (pending a design decision on screens)");
});

describe("A4: the QB is never drawn faster than 1.05 x his own top speed, snap to throw", () => {
  it("every pass play", () => {
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.every((r) => Number.isFinite(r.qbTop)), "every QB mark carries nat.top").toBe(true);
    expect(qbTop(rows)).toEqual([]);
  });
});

// A5 (animation never changes the engine result) is already gated, so no test is added here:
// timeline.test.ts checkPlay puts the ball at the whistle on play.end.spot (and the holder and tackler
// on it) for every fixture and for every play of its playGame seeds; misses-deep.spec.test.ts keeps a
// catch at the engine's airYards when the event carries them. Simulated games carry no airYards, so
// there the catch spot is drawn, not an engine result.

describe("drive(): a leg too short for the mover's deceleration", () => {
  const dt = 25;
  const sample = (keys: readonly Key[], t: number): Pt => {
    // Linear between keys, held at the ends (the drawn position).
    if (t <= (keys[0] as Key).t) return keys[0] as Key;
    for (let i = 1; i < keys.length; i++) {
      const b = keys[i] as Key;
      if (t <= b.t) {
        const a = keys[i - 1] as Key;
        const s = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
        return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
      }
    }
    return keys[keys.length - 1] as Key;
  };
  /** Distance along the polyline of the point nearest p. */
  const along = (pts: readonly Pt[], p: Pt): number => {
    let best = Infinity;
    let at = 0;
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as Pt;
      const b = pts[i] as Pt;
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const s = L === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (L * L)));
      const d = Math.hypot(a.x + (b.x - a.x) * s - p.x, a.y + (b.y - a.y) * s - p.y);
      if (d < best) {
        best = d;
        at = acc + s * L;
      }
      acc += L;
    }
    return at;
  };
  const cases: { name: string; pts: Pt[]; t1: number; v0Yps: number; decelMs: number }[] = [
    { name: "2 yd in 400 ms from 12 yd/s, 600 ms decel", pts: [{ x: 10, y: 0 }, { x: 10, y: 2 }], t1: 400, v0Yps: 12, decelMs: 600 },
    { name: "1 yd in 250 ms from 9 yd/s, 500 ms decel", pts: [{ x: 10, y: 0 }, { x: 10, y: 1 }], t1: 250, v0Yps: 9, decelMs: 500 },
    { name: "3 yd in 300 ms from 10 yd/s, 800 ms decel", pts: [{ x: 10, y: 0 }, { x: 13, y: 0 }], t1: 300, v0Yps: 10, decelMs: 800 },
    { name: "an L of 2.5 yd in 500 ms from 11 yd/s, 700 ms decel", pts: [{ x: 10, y: 0 }, { x: 10, y: 1.5 }, { x: 11, y: 1.5 }], t1: 500, v0Yps: 11, decelMs: 700 },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const keys = drive(c.pts, 0, c.t1, { accelMs: 300, decelMs: c.decelMs, restStart: false, restEnd: true, keyMs: dt, v0: c.v0Yps / 1000 });
      const last = c.pts[c.pts.length - 1] as Pt;
      const end = keys[keys.length - 1] as Key;
      expect(end.t).toBe(c.t1);
      expect(Math.hypot(end.x - last.x, end.y - last.y), "ends on the last point").toBeLessThan(1e-6);
      const speeds: number[] = [];
      const prog: number[] = [];
      for (let t = 0; t <= c.t1 + 1e-9; t += dt) prog.push(along(c.pts, sample(keys, t)));
      for (let t = 0; t + dt <= c.t1 + 1e-9; t += dt) {
        const a = sample(keys, t);
        const b = sample(keys, t + dt);
        speeds.push((Math.hypot(b.x - a.x, b.y - a.y) / dt) * 1000);
      }
      const bad: string[] = [];
      for (let i = 1; i < prog.length; i++) if ((prog[i] as number) < (prog[i - 1] as number) - 1e-9) bad.push(`goes back at ${i * dt} ms: ${(prog[i - 1] as number).toFixed(3)} -> ${(prog[i] as number).toFixed(3)}`);
      for (let i = 1; i < speeds.length; i++) if ((speeds[i - 1] as number) - (speeds[i] as number) > 2 + 1e-9) bad.push(`drops ${((speeds[i - 1] as number) - (speeds[i] as number)).toFixed(2)} yd/s at ${i * dt} ms`);
      // Eases to a stop: the last sample is slow (with the 2 yd/s per-sample cap above, a smooth stop).
      const tail = speeds[speeds.length - 1] as number;
      if (tail > 2) bad.push(`still at ${tail.toFixed(2)} yd/s in the last 25 ms`);
      expect(bad, `speeds ${speeds.map((v) => v.toFixed(1)).join(" ")}`).toEqual([]);
    });
  }
});

// ================================================================ spec revision 2026-11-16, "deeper drops, shorter holds"
// R-C26, R-C27, R-C30 and R-C31, written by test-writer from the rows. R-C25 is the A1 rows above;
// R-C28 is in routes-pace.spec.test.ts; the 1,000-game sweeps (R-C29, R-C30) are in
// test/game/routes-pace.heavy.test.ts; R-C32 is routes-pace.spec.test.ts R-C14.

const raw = (p: string): Record<string, unknown> => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", p), "utf8")) as Record<string, unknown>;
const motionRaw = raw("data/ui/motion.json") as { dropMs: Record<string, number>; throwHold: { maxMs: number; leafMaxMs: Record<string, number> } };
const routesRaw = raw("data/ui/templates.json")["routes"] as Record<string, Record<string, unknown>>;

describe("R-C26: drop speed band on intermediatePass and deepPass, passes and sacks", () => {
  for (const call of ["intermediatePass", "deepPass"]) {
    it(`${call}: drop peak from the snap to the drop end is at least ${C.dropPeakYps} yd/s and at most his own top`, () => {
      const n = rows.filter((r) => r.call === call).length;
      const ns = sacks.filter((r) => r.call === call).length;
      console.log(`[qb-throw] R-C26 ${call}: ${n} passes, ${ns} sacks`);
      expect(n, `${call} passes in seeds ${SEEDS.join(",")}`).toBeGreaterThan(0);
      expect(dropBand(rows, sacks, call)).toEqual([]);
    });
  }
  it("the sample has intermediatePass or deepPass sacks to check", () => {
    expect(sacks.filter((r) => r.call === "intermediatePass" || r.call === "deepPass").length).toBeGreaterThan(0);
  });
  // "A4 (at most 1.05 x top from the snap to the throw) still passes": the A4 describe above.
});

describe("R-C27: the throw window end is preserved in data", () => {
  it("dropMs + throwHold.leafMaxMs is at least 2150 ms for intermediatePass and 2950 ms for deepPass", () => {
    const end = (call: string): number => (motionRaw.dropMs[call] as number) + (motionRaw.throwHold.leafMaxMs[call] ?? motionRaw.throwHold.maxMs);
    expect(end("intermediatePass")).toBeGreaterThanOrEqual(2150);
    expect(end("deepPass")).toBeGreaterThanOrEqual(2950);
  });
  // "routes-pace 'an incompletion is aimed at the class's neutral point' and R-C23 pass with no change
  // to the tests": those are routes-pace.spec.test.ts ("Neutral catch depth ...", that it) and
  // misses-deep.spec.test.ts ("R-C23: every deepPass route can get 20 yd deep in a throw window").
});

describe("R-C31: play action, short and screen are unchanged", () => {
  // The values before this revision: DECISIONS.md "QB throw pace" (2026-11-15) and the spec's Pace table.
  it("their dropMs equal the values before the revision", () => {
    expect(motionRaw.dropMs["shortPass"]).toBe(600);
    expect(motionRaw.dropMs["screenPass"]).toBe(1100);
    expect(motionRaw.dropMs["playAction"]).toBe(1400);
  });
  it("their throwHold.leafMaxMs equal the values before the revision", () => {
    expect(motionRaw.throwHold.leafMaxMs["shortPass"]).toBe(600);
    expect(motionRaw.throwHold.leafMaxMs["screenPass"]).toBe(600);
    expect(motionRaw.throwHold.leafMaxMs["playAction"]).toBe(600);
  });
  it("their QB templates equal the values before the revision", () => {
    expect(routesRaw["shortPass"]?.["QB"]).toEqual({ pts: [[0, -2.25]], finish: "sit", axis: "strong" });
    expect(routesRaw["screenPass"]?.["QB"]).toEqual({ pts: [[0, -3]], finish: "sit", axis: "strong" });
    expect(routesRaw["playAction"]?.["QB"]).toEqual({ pts: [{ p: [1, -0.5], pauseMs: 150 }, [-2, -3]], finish: "sit", axis: "strong" });
  });
  // "Their qb-throw-pace A1 and A2 rows pass unchanged": the A1 shortPass, screenPass and playAction
  // rows and the A2 shortPass rows above, not edited by this revision.
});

describe("R-C30 (fast look; the 1,000-game gate is in routes-pace.heavy.test.ts): the QB on a sack", () => {
  it("intermediatePass and deepPass sacks: peak from the snap to the sack time at most his own top", () => {
    for (const r of sacks.filter((x) => x.call === "intermediatePass" || x.call === "deepPass"))
      console.log(`[qb-throw] R-C30 ${r.where}: drop end ${r.dropEnd} ms, drop peak ${r.dropPeak.toFixed(2)}, sack at ${r.sackAt} ms, peak ${r.peakToSack.toFixed(2)} at ${r.peakAt} ms, top ${r.qbTop.toFixed(2)}`);
    expect(sackTop(sacks, ["intermediatePass", "deepPass"])).toEqual([]);
  });
});
