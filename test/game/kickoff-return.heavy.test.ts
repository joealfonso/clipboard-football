// Kickoff return pass, KR1 to KR9 (docs/specs/m2-play-calling-and-motion.md, "Amended (Joseph,
// 2026-11-15): kickoff return pass"), written by test-writer from the spec: the heavy suite runs
// 1,000 simulated kickoff returns, and each KR criterion must pass on at least 95% of them (100% of
// fixtures is packages/app/test/kickoff-return.spec.test.ts). KR7 also needs each cut direction
// (left, right) on at least 30% of the returns that cut. The shares are printed for PERF.md.
//
//   ./node_modules/.bin/vitest run --config vitest.heavy.config.ts test/game/kickoff-return.heavy.test.ts
//   (KICKOFF_RETURNS=100 for a quick look; the gate is the default 1,000.)

import { beforeAll, describe, expect, it } from "vitest";
import type { PlayEvent } from "../../packages/app/src/engine/types";
import { firstCut, isReturn, kr1, kr2, kr3, kr4, kr5, kr6, kr7Direction, kr9, partsOf, returnUnitSameToCatch, T, tlOf, withReturnFouler, withReturnTeamRecovery } from "../../packages/app/test/kickoff-return.checks";
import { playGame } from "../../packages/app/test/support";

const RETURNS = Number(process.env["KICKOFF_RETURNS"] ?? 1000);
const MAX_GAMES = 5000;
const KR = ["KR1", "KR2", "KR3", "KR4", "KR5", "KR6", "KR7", "KR9"] as const;

const pass = new Map<string, number>(KR.map((k) => [k, 0]));
const applies = new Map<string, number>(KR.map((k) => [k, 0]));
const firstBad = new Map<string, string[]>(KR.map((k) => [k, []]));
let returns = 0;
let games = 0;
let cutting = 0;
let left = 0;
let right = 0;
let ties = 0;
let leakBad = 0;
const leakFirst: string[] = [];
const teamLeak = new Map<string, number>();
/** Return-team variants whose live time scale changed (uniform scaling, not a leak): skipped and counted. */
let scaled = 0;

const note = (k: string, bad: string[], where: string): void => {
  applies.set(k, (applies.get(k) ?? 0) + 1);
  if (bad.length === 0) pass.set(k, (pass.get(k) ?? 0) + 1);
  else if ((firstBad.get(k) ?? []).length < 5) firstBad.get(k)?.push(`${where}: ${bad[0] ?? ""}`);
};

beforeAll(() => {
  for (let seed = 1; seed <= MAX_GAMES && returns < RETURNS; seed++) {
    games++;
    for (const ev of playGame(seed, seed % 2 === 0 ? "home" : "away", seed).events) {
      if (ev.t !== "play" || returns >= RETURNS) continue;
      const e = ev as PlayEvent;
      if (!isReturn(e)) continue;
      const tl = tlOf(e);
      const r = partsOf(e, tl);
      if (!(r.returnYards > 0.5)) continue;
      returns++;
      const where = `seed ${seed} return of ${r.returnYards.toFixed(0)} yd`;
      // KR1, A1 and N7 included: a second build of the same event is identical.
      const again = tlOf(structuredClone(e));
      const same = JSON.stringify(again.marks.map((m) => m.keys)) === JSON.stringify(tl.marks.map((m) => m.keys));
      note("KR1", [...kr1(e, tl), ...(same ? [] : ["A1: two builds differ"])], where);
      note("KR2", kr2(r), where);
      note("KR3", kr3(r), where);
      note("KR4", kr4(r), where);
      note("KR9", kr9(r), where);
      const kr7: string[] = [];
      if (r.returnYards >= T.cutMinReturnYards) {
        note("KR5", kr5(r), where);
        note("KR6", kr6(r), where);
        const d = kr7Direction(r);
        if (d.dir !== null) {
          cutting++;
          if (d.dir < 0) left++;
          else if (d.dir > 0) right++;
          if (d.tie) ties++;
        }
        kr7.push(...d.bad, ...(firstCut(r) === null ? ["no cut to check"] : []));
      }
      // KR7, no leak: the same play with another dead spot gives identical returner and blocker positions to the catch.
      const p = e.play as Extract<PlayEvent["play"], { kind: "kickoff" }>;
      const end = p.end as NonNullable<typeof p.end>;
      const other = { ...e, play: { ...p, end: { ...end, spot: end.spot + (end.spot > 50 ? -3 : 3) } } } as PlayEvent;
      const r2 = partsOf(other);
      if (r2.returner.nat?.k === r.returner.nat?.k) {
        const ids = [r.returner.playerId, ...r.blockers.map((b) => b.playerId)];
        const differs = ids.some((id) => {
          const a = tl.marks.find((m) => m.playerId === id)?.keys ?? [];
          const b = r2.tl.marks.find((m) => m.playerId === id)?.keys ?? [];
          return a.filter((k) => k.t <= r.catchT).some((k, i) => {
            const q = b[i];
            return q === undefined || Math.abs(q.x - k.x) > 1e-9 || Math.abs(q.y - k.y) > 1e-9;
          });
        });
        if (differs) {
          leakBad++;
          if (leakFirst.length < 5) leakFirst.push(where);
          kr7.push("the pre-catch wall moves with the dead spot");
        }
      }
      // KR7, no leak on return-team results (coordinator, 2026-11-15): a return-team fouler, or a
      // return-team fumble recovery, leaves the whole return unit identical from t = 0 to the catch.
      const named = r.blockers.slice(0, 2).map((b) => b.playerId);
      if (named.length === 2) {
        const base = partsOf(e, tl);
        for (const [label, v] of [
          ["return-team fouler", withReturnFouler(e, named[0] as string)],
          ["return-team recovery", withReturnTeamRecovery(e, named[1] as string)],
        ] as const) {
          const vr = partsOf(v);
          if (vr.returner.nat?.k !== base.returner.nat?.k) {
            scaled++;
            continue;
          }
          const diff = returnUnitSameToCatch(base, vr, label);
          if (diff.length > 0) {
            teamLeak.set(label, (teamLeak.get(label) ?? 0) + 1);
            kr7.push(diff[0] as string);
          }
        }
      }
      note("KR7", kr7, where);
    }
  }
});

describe(`kickoff return pass over ${RETURNS} simulated returns`, () => {
  it("enough returns", () => {
    console.log(`[kickoff-return] ${returns} returns from ${games} games`);
    expect(returns).toBe(RETURNS);
  });

  it.each(KR.filter((k) => k !== "KR7"))("%s passes on at least 95% of the returns it applies to", (k) => {
    const n = applies.get(k) ?? 0;
    const ok = pass.get(k) ?? 0;
    console.log(`[kickoff-return] ${k}: ${ok} of ${n} (${((100 * ok) / Math.max(1, n)).toFixed(1)}%); first failures: ${(firstBad.get(k) ?? []).join("; ")}`);
    expect(n).toBeGreaterThan(0);
    expect(ok / n).toBeGreaterThanOrEqual(0.95);
  });

  it("KR7: toward the blocks and no leak on 95% of returns; each cut direction at least 30% of the cuts", () => {
    const n = applies.get("KR7") ?? 0;
    const ok = pass.get("KR7") ?? 0;
    console.log(
      `[kickoff-return] KR7: toward the blocks on ${ok} of ${n} (${((100 * ok) / Math.max(1, n)).toFixed(1)}%); cuts left ${left}, right ${right} of ${cutting} (${((100 * left) / Math.max(1, cutting)).toFixed(1)}% / ${((100 * right) / Math.max(1, cutting)).toFixed(1)}%), ${ties} ties; leaks ${leakBad} (${leakFirst.join("; ")}); return-team leaks ${[...teamLeak].map(([k, n]) => `${k} ${n}`).join(", ") || "none"} (${scaled} variants rescaled, skipped); first failures: ${(firstBad.get("KR7") ?? []).join("; ")}`,
    );
    expect(n).toBeGreaterThan(0);
    expect(ok / n).toBeGreaterThanOrEqual(0.95);
    expect(cutting).toBeGreaterThan(0);
    expect(left / cutting).toBeGreaterThanOrEqual(0.3);
    expect(right / cutting).toBeGreaterThanOrEqual(0.3);
  });
});
