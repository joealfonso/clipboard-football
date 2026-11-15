// Spec gates for docs/specs/m2-play-calling-and-motion.md, revision 2026-11-14 (real routes and
// slower pace), written by test-writer from the spec. The sweeps are slow (1,000 games through the
// app's worker Session with the scripted human seat), so they live here, in `pnpm test:heavy`.
// - R-C7: over 1,000 simulated games the target's peak speed, from the snap to the catch, is at
//   most 1.15 x his top speed on at least 95% of completions.
// - R-C15 (M11): timeline() takes 20 ms or less per play, median and p95 over those games' plays.
//   A wall-clock reading: on a loaded machine it can fail for reasons outside the code.
//
//   ./node_modules/.bin/vitest run --config vitest.heavy.config.ts test/game/routes-pace.heavy.test.ts
//   (ROUTES_PACE_GAMES=50 for a quick look; the gate is the default 1,000.)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readDetail, type PlayEvent } from "../../packages/app/src/engine/types";
import { parseMotion, parseTemplates } from "../../packages/app/src/ui/templates";
import { at, timeline } from "../../packages/app/src/ui/timeline";
import { playGame } from "../../packages/app/test/support";

const root = join(import.meta.dirname, "../..");
const read = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));
const templates = parseTemplates(read("data/ui/templates.json"));
const motion = parseMotion(read("data/ui/motion.json"));
const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };
const ctx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion };
const GAMES = Number(process.env["ROUTES_PACE_GAMES"] ?? 1000);

const times: number[] = [];
let completions = 0;
let within = 0;
const byPos = new Map<string, { n: number; ok: number }>();
const worst: string[] = [];

beforeAll(() => {
  for (let seed = 1; seed <= GAMES; seed++) {
    for (const ev of playGame(seed, seed % 2 === 0 ? "home" : "away", seed).events) {
      if (ev.t !== "play") continue;
      const e = ev as PlayEvent;
      const a = performance.now();
      const tl = timeline({ event: e, runoffSeconds: 0 }, templates, ctx);
      times.push(performance.now() - a);
      if (e.play.kind !== "pass" || e.play.incomplete === true || e.play.turnover !== undefined) continue;
      const rcvId = readDetail(e.play).participants?.receiver;
      const rcv = tl.marks.find((m) => m.playerId === rcvId);
      const flight = tl.paths.find((p) => p.kind === "ball");
      if (rcv === undefined || flight === undefined) continue;
      completions++;
      let peak = 0;
      for (let t = tl.snapAt; t + motion.keyMs <= flight.end + 1e-9; t += motion.keyMs) {
        const p = at(rcv.keys, t);
        const q = at(rcv.keys, t + motion.keyMs);
        peak = Math.max(peak, (Math.hypot(q.x - p.x, q.y - p.y) / motion.keyMs) * 1000);
      }
      const top = motion.speed[rcv.position] ?? 10;
      const g = byPos.get(rcv.position) ?? { n: 0, ok: 0 };
      g.n++;
      if (peak <= 1.15 * top) g.ok++;
      byPos.set(rcv.position, g);
      if (peak <= 1.15 * top) within++;
      else if (worst.length < 10) worst.push(`seed ${seed} ${e.offense.formation ?? ""} ${e.offense.call} ${rcv.slot}: ${peak.toFixed(1)} yd/s (top ${top})`);
    }
  }
});

describe(`revision 2026-11-14 sweeps over ${GAMES} games`, () => {
  it("R-C7: the target's peak speed to the catch is at most 1.15 x top on at least 95% of completions", () => {
    const share = within / Math.max(1, completions);
    console.log(`[routes-pace] ${completions} completions, peak at most 1.15 x top on ${(100 * share).toFixed(1)}% (${[...byPos].map(([k, v]) => `${k} ${((100 * v.ok) / v.n).toFixed(1)}% of ${v.n}`).join(", ")}); first over: ${worst.join("; ")}`);
    expect(completions).toBeGreaterThan(20 * GAMES);
    expect(share).toBeGreaterThanOrEqual(0.95);
  });

  it("R-C15: timeline() median and p95 are 20 ms or less per play", () => {
    const s = [...times].sort((a, b) => a - b);
    const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
    console.log(`[routes-pace] ${s.length} plays: timeline() median ${q(0.5).toFixed(2)} ms, p95 ${q(0.95).toFixed(2)} ms, max ${(s[s.length - 1] ?? 0).toFixed(2)} ms`);
    expect(s.length).toBeGreaterThan(100 * GAMES);
    expect(q(0.5)).toBeLessThanOrEqual(20);
    expect(q(0.95)).toBeLessThanOrEqual(20);
  });
});
