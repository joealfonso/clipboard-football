// M2 M11 and revision 2026-11-14 R-C15, R-C7 (docs/specs/m2-play-calling-and-motion.md): a
// measurement, not a gate. Plays games through the app's worker Session with the scripted human
// seat and prints timeline() time per play (median, p95, max) and the share of completions whose
// target's peak speed is at most 1.15 x his top speed. docs/PERF.md records runs.
//
//   TIMELINE_PERF_GAMES=1000 ./node_modules/.bin/vitest run --config vitest.heavy.config.ts test/game/timeline-perf.heavy.test.ts --silent=false

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { readDetail, type PlayEvent } from "../../packages/app/src/engine/types";
import { parseMotion, parseTemplates } from "../../packages/app/src/ui/templates";
import { timeline } from "../../packages/app/src/ui/timeline";
import { playGame } from "../../packages/app/test/support";

const root = join(import.meta.dirname, "../..");
const read = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));

it("timeline() speed and target peak speed (printed for docs/PERF.md)", { timeout: 3_600_000 }, () => {
  const games = Number(process.env["TIMELINE_PERF_GAMES"] ?? 20);
  const templates = parseTemplates(read("data/ui/templates.json"));
  const motion = parseMotion(read("data/ui/motion.json"));
  const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };
  const ctx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion };
  const times: number[] = [];
  let completions = 0;
  let within = 0;
  // By position group: [completions, within].
  const byGroup: Record<string, [number, number]> = {};
  const t0 = performance.now();
  for (let seed = 1; seed <= games; seed++) {
    for (const ev of playGame(seed, seed % 2 === 0 ? "home" : "away", seed).events) {
      if (ev.t !== "play") continue;
      const e = ev as PlayEvent;
      const a = performance.now();
      const tl = timeline({ event: e, runoffSeconds: 0 }, templates, ctx);
      times.push(performance.now() - a);
      if (e.play.kind !== "pass" || e.play.incomplete === true || e.play.turnover !== undefined) continue;
      const rcv = tl.marks.find((m) => m.playerId === readDetail(e.play).participants?.receiver);
      if (rcv === undefined) continue;
      completions++;
      let peak = 0;
      for (let i = 1; i < rcv.keys.length; i++) {
        const p = rcv.keys[i - 1] as { t: number; x: number; y: number };
        const q = rcv.keys[i] as { t: number; x: number; y: number };
        if (q.t <= tl.snapAt || p.t >= tl.liveEnd || q.t - p.t < 1) continue;
        peak = Math.max(peak, (Math.hypot(q.x - p.x, q.y - p.y) / (q.t - p.t)) * 1000);
      }
      const g = (byGroup[rcv.position] ??= [0, 0]);
      const cg = (byGroup[`${e.offense.call === "goForTwo" ? (e.offense.twoPointPlay ?? "") : e.offense.call} ${rcv.position}`] ??= [0, 0]);
      cg[0]++;
      g[0]++;
      if (peak <= 1.15 * (motion.speed[rcv.position] ?? 10)) {
        within++;
        g[1]++;
        cg[1]++;
      }
    }
  }
  times.sort((a, b) => a - b);
  const q = (p: number): string => (times[Math.min(times.length - 1, Math.floor(times.length * p))] ?? 0).toFixed(2);
  console.log(
    `[timeline-perf] ${games} games, ${times.length} plays, ${((performance.now() - t0) / 1000).toFixed(1)} s: timeline() median ${q(0.5)} ms, p95 ${q(0.95)} ms, max ${(times[times.length - 1] ?? 0).toFixed(2)} ms; completions ${completions}, target peak at most 1.15 x top on ${((100 * within) / Math.max(1, completions)).toFixed(1)}%; by group: ${Object.entries(byGroup)
      .map(([pos, [n, w]]) => `${pos} ${((100 * w) / Math.max(1, n)).toFixed(1)}% of ${n}`)
      .join(", ")}`,
  );
});
