// Spec gates for docs/specs/m2-play-calling-and-motion.md, revision 2026-11-14 (real routes and
// slower pace), written by test-writer from the spec. The sweeps are slow (1,000 games through the
// app's worker Session with the scripted human seat), so they live here, in `pnpm test:heavy`.
// - R-C7: over 1,000 simulated games the target's peak speed, from the snap to the catch, is at
//   most 1.15 x his top speed on at least 95% of completions.
// - R-C15 (M11): timeline() takes 20 ms or less per play, median and p95 over those games' plays.
//   A wall-clock reading: on a loaded machine it can fail for reasons outside the code.
// Amended 2026-11-15 ("misses that read as misses, deep catches that read deep", R-C16 to R-C24):
// - R-C16: on 100% of incompletions with a known target the ball at the arrival is 2.5 yd or more
//   from him on a miss, 1.0 yd or more on a break-up (p10, p50, p90 printed for PERF.md).
// - R-C17: every breaker is a non-rushing CB, S or LB within handYards + 0.2 of the ball, nearer
//   it than the target, peaking at no more than 1.15 x top; on other misses nobody within clearYards of P.
// - R-C21: every deepPass completion with no airYards is caught at least min(20, gain) past the
//   line and no further than the dead spot (100%, share by receiver position printed).
// - R-C22: R-C7's bound (95% at most 1.15 x top) on all completions and, separately, on deepPass
//   completions to RBs and to TEs.
// - R-C24: the shares of break-up, overthrow, behind and short by class, printed for PERF.md.
//
//   ./node_modules/.bin/vitest run --config vitest.heavy.config.ts test/game/routes-pace.heavy.test.ts
//   (ROUTES_PACE_GAMES=50 for a quick look; the gate is the default 1,000.)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readDetail, type PlayEvent } from "../../packages/app/src/engine/types";
import { parseMotion, parseTemplates } from "../../packages/app/src/ui/templates";
import { at, timeline, type MissKind } from "../../packages/app/src/ui/timeline";
import { sackTimeOf } from "../../packages/app/test/qb-throw-pace.checks";
import { playGame } from "../../packages/app/test/support";

const root = join(import.meta.dirname, "../..");
const read = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));
const templatesRaw = read("data/ui/templates.json") as Record<string, unknown>;
const templates = parseTemplates(templatesRaw);
const motion = parseMotion(read("data/ui/motion.json"));
const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };
const ctx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion };
const GAMES = Number(process.env["ROUTES_PACE_GAMES"] ?? 1000);
// Diagnostic only (ROUTES_PACE_NATURAL=off): draw with the natural-motion governor off (the
// ctx.natural test hook). The gate is the default, natural motion on, as the app draws.
if (process.env["ROUTES_PACE_NATURAL"] === "off") Object.assign(ctx, { natural: false });

const times: number[] = [];
let completions = 0;
let within = 0;
const byPos = new Map<string, { n: number; ok: number }>();
const worst: string[] = [];

// The amendment's sweeps (R-C16, R-C17, R-C21, R-C22, R-C24).
const MISS = motion.miss;
const FLOOR = (templatesRaw["catchFloorYards"] as Record<string, number>)["deepPass"] as number;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
const posOf = (s: string): string => s.replace(/\d+$/, "");
/** A3, "not blitzing in his preset": a zone or a man target, or drop steps that end deeper than his set spot. */
function inCoverage(preset: string, slot: string): boolean {
  if (templates.zones[preset]?.[slot] !== undefined || templates.manTargets[preset]?.[slot] !== undefined) return true;
  const drops = (templatesRaw["drops"] as Record<string, Record<string, unknown>>)[templates.presetDrops[preset] ?? ""];
  const last = ((drops?.[slot] ?? drops?.[posOf(slot)]) as unknown[] | undefined)?.at(-1);
  if (last === undefined) return false;
  const p = (Array.isArray(last) ? last : (last as { p: number[] }).p) as number[];
  return (p[1] ?? 0) > 0;
}
const gaps: { kind: MissKind; gap: number }[] = [];
const missBad: string[] = [];
const breakBad: string[] = [];
const clearBad: string[] = [];
let breakups = 0;
let unknownTarget = 0;
const kindsByClass = new Map<string, Map<MissKind, number>>();
const floorByPos = new Map<string, { n: number; ok: number }>();
const floorBad: string[] = [];
const deepByPos = new Map<string, { n: number; ok: number }>();
const deepWorst: string[] = [];
// Spec revision 2026-11-16, "deeper drops, shorter holds" (R-C29, R-C30), written by test-writer from the rows.
// R-C29: R-C7's bound (95% at most 1.15 x top) by class and receiver position, gated on
// intermediatePass completions to RBs (and R-C22's deepPass TEs and RBs, the test above).
const byClassPos = new Map<string, { n: number; ok: number }>();
// R-C30: on intermediatePass and deepPass sacks, the QB's peak from the snap to the sack time against
// his own top (sack time: the whistle less 300 ms, or when the ball leaves him on a strip-sack, so
// the fumble legs are excluded; qb-throw-pace.checks.ts sackTimeOf), and every sacker's peak on the
// way to the sack against 1.15 x top (the routes-pace "Joseph's playtest" sacker check, here over
// every sack of the sweep).
let sacksQb = 0;
const sackQbBad: string[] = [];
let sackers = 0;
let sackersOk = 0;
let sackersOwnOk = 0;
const sackerOver: string[] = [];
const peakOf = (keys: readonly { t: number; x: number; y: number }[], t0: number, t1: number): number => {
  let peak = 0;
  for (let t = t0; t + motion.keyMs <= t1 + 1e-9; t += motion.keyMs) peak = Math.max(peak, (dist(at(keys, t), at(keys, t + motion.keyMs)) / motion.keyMs) * 1000);
  return peak;
};

beforeAll(() => {
  for (let seed = 1; seed <= GAMES; seed++) {
    for (const ev of playGame(seed, seed % 2 === 0 ? "home" : "away", seed).events) {
      if (ev.t !== "play") continue;
      const e = ev as PlayEvent;
      const a = performance.now();
      const tl = timeline({ event: e, runoffSeconds: 0 }, templates, ctx);
      times.push(performance.now() - a);
      if (e.play.kind === "sack") {
        const parts = readDetail(e.play).participants ?? {};
        const qb = tl.marks.find((m) => m.playerId === parts.passer) ?? tl.marks.find((m) => m.side === "O" && m.position === "QB");
        if (qb !== undefined) {
          const tS = sackTimeOf(tl, qb.keys);
          const where = `seed ${seed} ${e.offense.formation ?? ""} ${e.offense.call} vs ${e.defense ?? ""}`;
          if (e.offense.call === "intermediatePass" || e.offense.call === "deepPass") {
            sacksQb++;
            const pk = peakOf(qb.keys, tl.snapAt, tS);
            const top = qb.nat?.top ?? (motion.speed["QB"] as number);
            if (!(pk <= top + 1e-9) && sackQbBad.length < 1000) sackQbBad.push(`${where}: QB ${pk.toFixed(2)} yd/s, top ${top.toFixed(2)} (${(pk / top).toFixed(3)} x), sack at ${(tS - tl.snapAt).toFixed(0)} ms`);
          }
          const sk = tl.marks.find((m) => m.playerId === parts.sacker);
          if (sk !== undefined) {
            sackers++;
            const pk = peakOf(sk.keys, tl.snapAt, tS);
            const group = motion.speed[sk.position] as number;
            if (pk <= 1.15 * group + 1e-9) sackersOk++;
            else if (sackerOver.length < 10) sackerOver.push(`${where} ${sk.slot}: ${pk.toFixed(1)} yd/s (top ${group})`);
            if (pk <= 1.15 * (sk.nat?.top ?? group) + 1e-9) sackersOwnOk++;
          }
        }
      }
      if (e.play.kind === "pass" && e.play.incomplete === true) {
        const tid = readDetail(e.play).participants?.target;
        const tgt = tl.marks.find((m) => m.playerId === tid && m.side === "O");
        const fl = tl.paths.find((p) => p.kind === "ball");
        if (tgt === undefined || fl === undefined) {
          unknownTarget++;
          continue;
        }
        const where = `seed ${seed} ${e.offense.formation ?? ""} ${e.offense.call} vs ${e.defense ?? ""} to ${tgt.slot}`;
        const ms = tl.miss;
        if (ms === undefined || ms.kind === null) {
          missBad.push(`${where}: no miss kind`);
          continue;
        }
        const tc = fl.end;
        const ball = at(tl.ball, tc);
        const gap = dist(ball, at(tgt.keys, tc));
        gaps.push({ kind: ms.kind, gap });
        const need = ms.kind === "breakup" ? MISS.breakup.gapYards - MISS.reachYards : Math.min(MISS.overYards, MISS.behindYards, MISS.shortYards) - MISS.reachYards;
        if (gap < need - 1e-6 && missBad.length < 20) missBad.push(`${where} (${ms.kind}): ${gap.toFixed(2)} yd`);
        const byK = kindsByClass.get(e.offense.call) ?? new Map<MissKind, number>();
        byK.set(ms.kind, (byK.get(ms.kind) ?? 0) + 1);
        kindsByClass.set(e.offense.call, byK);
        if (ms.kind === "breakup") {
          breakups++;
          const b = tl.marks.find((m) => m.playerId === ms.breaker);
          if (b === undefined) {
            breakBad.push(`${where}: no breaker`);
            continue;
          }
          const dB = dist(at(b.keys, tc), ball);
          const why: string[] = [];
          if (b.side !== "X" || !["CB", "S", "LB"].includes(b.position)) why.push(`${b.slot} not a CB, S or LB`);
          if (!inCoverage(e.defense ?? "", b.slot)) why.push(`${b.slot} rushes`);
          if (dB > MISS.breakup.handYards + 0.2 + 1e-9) why.push(`${dB.toFixed(2)} yd from the ball`);
          if (!(dB < gap)) why.push(`not nearer than the target (${dB.toFixed(2)} vs ${gap.toFixed(2)})`);
          const pk = peakOf(b.keys, tl.snapAt, tc);
          if (pk > 1.15 * (b.nat?.top ?? motion.speed[b.position] ?? 10) + 1e-9) why.push(`peaks at ${pk.toFixed(2)} yd/s`);
          if (why.length > 0 && breakBad.length < 20) breakBad.push(`${where}: ${why.join(", ")}`);
        } else {
          for (const d of tl.marks.filter((m) => m.side === "X")) {
            const g = dist(at(d.keys, tc), ms.at);
            if (g < MISS.clearYards && clearBad.length < 20) clearBad.push(`${where} (${ms.kind}): ${d.slot} ${g.toFixed(2)} yd from P`);
          }
        }
        continue;
      }
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
      // "top" is the mark's own top (natural-motion revision, "Every top in ... R-C7 ... becomes the
      // mark's own top"), his group speed when he has no natural-motion record.
      const top = rcv.nat?.top ?? motion.speed[rcv.position] ?? 10;
      const g = byPos.get(rcv.position) ?? { n: 0, ok: 0 };
      g.n++;
      if (peak <= 1.15 * top) g.ok++;
      byPos.set(rcv.position, g);
      if (e.offense.call === "deepPass") {
        // R-C22, separately by receiver position on deepPass.
        const dg = deepByPos.get(rcv.position) ?? { n: 0, ok: 0 };
        dg.n++;
        if (peak <= 1.15 * top) dg.ok++;
        else if (deepWorst.length < 10) deepWorst.push(`seed ${seed} ${e.offense.formation ?? ""} ${rcv.slot}: ${peak.toFixed(1)} yd/s`);
        deepByPos.set(rcv.position, dg);
        // R-C21: with no air yards, caught at least min(floor, gain) past the line, no further than the dead spot.
        if (readDetail(e.play).airYards === undefined) {
          const gain = e.play.end.spot - e.before.spot;
          const y = (flight.points.at(-1) as { y: number }).y - tl.los;
          const fg = floorByPos.get(rcv.position) ?? { n: 0, ok: 0 };
          fg.n++;
          // "No further than the dead spot": on a loss the catch is in the band between the line
          // and the dead spot (DECISIONS, "Neutral catch depth"), so the top is the line.
          if (y >= Math.min(FLOOR, gain) - 1e-6 && y <= Math.max(0, gain) + 1e-6) fg.ok++;
          else if (floorBad.length < 20) floorBad.push(`seed ${seed} ${e.offense.formation ?? ""} ${rcv.slot}: caught ${y.toFixed(2)} yd past the line, gain ${gain}`);
          floorByPos.set(rcv.position, fg);
        }
      }
      const cp = byClassPos.get(`${e.offense.call} ${rcv.position}`) ?? { n: 0, ok: 0 };
      cp.n++;
      if (peak <= 1.15 * top) cp.ok++;
      byClassPos.set(`${e.offense.call} ${rcv.position}`, cp);
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

  it("R-C16: on every incompletion with a known target the ball lands off him (2.5 yd on a miss, 1.0 yd on a break-up)", () => {
    const q = (xs: number[], p: number): number => {
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? NaN;
    };
    const line = (xs: number[]): string => `p10 ${q(xs, 0.1).toFixed(2)}, p50 ${q(xs, 0.5).toFixed(2)}, p90 ${q(xs, 0.9).toFixed(2)}, min ${Math.min(...xs).toFixed(2)} (${xs.length})`;
    const kinds: MissKind[] = ["breakup", "overthrow", "behind", "short"];
    console.log(`[misses] R-C16 gap at the arrival: all ${line(gaps.map((g) => g.gap))}; ${kinds.map((k) => `${k} ${line(gaps.filter((g) => g.kind === k).map((g) => g.gap))}`).join("; ")}; ${unknownTarget} with no known target`);
    expect(gaps.length).toBeGreaterThan(5 * GAMES);
    expect(missBad).toEqual([]);
  });

  it("R-C17: every break-up's breaker is at the ball, eligible and not sprinting; no defender near P on any other miss", () => {
    console.log(`[misses] R-C17: ${breakups} break-ups, ${breakBad.length} bad; ${gaps.length - breakups} other misses, ${clearBad.length} with a defender within clearYards`);
    expect(breakups).toBeGreaterThan(0);
    expect(breakBad).toEqual([]);
    expect(clearBad).toEqual([]);
  });

  it("R-C21: every deepPass completion with no airYards is caught between min(20, gain) and the dead spot", () => {
    console.log(`[misses] R-C21 by receiver: ${[...floorByPos].map(([k, v]) => `${k} ${v.ok} of ${v.n}`).join(", ")}`);
    expect([...floorByPos.values()].reduce((a, v) => a + v.n, 0)).toBeGreaterThan(GAMES / 2);
    expect(floorBad).toEqual([]);
  });

  it("R-C22: the R-C7 bound holds on all completions and separately on deepPass completions to RBs and to TEs", () => {
    const share = (g: { n: number; ok: number } | undefined): number => (g === undefined || g.n === 0 ? NaN : g.ok / g.n);
    console.log(`[misses] R-C22: all ${(100 * (within / Math.max(1, completions))).toFixed(1)}% of ${completions}; deepPass ${[...deepByPos].map(([k, v]) => `${k} ${(100 * share(v)).toFixed(1)}% of ${v.n}`).join(", ")}; first over: ${deepWorst.join("; ")}`);
    expect(within / Math.max(1, completions)).toBeGreaterThanOrEqual(0.95);
    for (const pos of ["RB", "TE"]) {
      const g = deepByPos.get(pos);
      expect(g?.n ?? 0, `deepPass completions to ${pos}`).toBeGreaterThan(0);
      expect(share(g), `deepPass to ${pos}: ${g?.ok ?? 0} of ${g?.n ?? 0}`).toBeGreaterThanOrEqual(0.95);
    }
  });

  it("R-C24: the shares of break-up, overthrow, behind and short by class (a report, no target share)", () => {
    const kinds: MissKind[] = ["breakup", "overthrow", "behind", "short"];
    const rows = [...kindsByClass].map(([cls, m]) => {
      const n = [...m.values()].reduce((a, b) => a + b, 0);
      return `${cls} (${n}) ${kinds.map((k) => ((100 * (m.get(k) ?? 0)) / n).toFixed(1)).join(" / ")}%`;
    });
    console.log(`[misses] R-C24 break-up / overthrow / behind / short: ${rows.join("; ")}`);
    // Every incompletion with a known target got a kind, so the report covers them all.
    expect([...kindsByClass.values()].reduce((a, m) => a + [...m.values()].reduce((x, y) => x + y, 0), 0)).toBe(gaps.length);
  });

  it("R-C29: R-C7 and R-C22 at their bounds (tests above); intermediatePass completions to RBs at 95% or more within 1.15 x top", () => {
    const rows = [...byClassPos].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${((100 * v.ok) / v.n).toFixed(1)}% of ${v.n}`);
    console.log(`[routes-pace] R-C29 within 1.15 x top by class and position (for PERF.md): ${rows.join("; ")}`);
    const g = byClassPos.get("intermediatePass RB");
    expect(g?.n ?? 0, "intermediatePass completions to RBs").toBeGreaterThan(0);
    expect((g?.ok ?? 0) / (g?.n ?? 1), `intermediatePass to RB: ${g?.ok ?? 0} of ${g?.n ?? 0}`).toBeGreaterThanOrEqual(0.95);
  });

  it("R-C30: on 100% of intermediatePass and deepPass sacks the QB peaks at no more than his own top from the snap to the sack", () => {
    console.log(`[routes-pace] R-C30 QB on sacks: ${sacksQb - sackQbBad.length} of ${sacksQb} at or under his top; first over: ${sackQbBad.slice(0, 10).join("; ")}`);
    expect(sacksQb).toBeGreaterThan(GAMES / 2);
    expect(sackQbBad.length, `${sackQbBad.length} of ${sacksQb} over: ${sackQbBad.slice(0, 10).join("; ")}`).toBe(0);
  });

  it("R-C30 (amended 2026-11-16 after build): at least 84.4% of sackers peak at no more than 1.15 x group top on the way to the sack, over every sack", () => {
    // "No worse than it is today": the amended row's baseline, 84.4% within 1.15 x group top over
    // every sack in 1,000 games. top = his group speed, as the routes-pace check reads it; his own
    // top printed too.
    console.log(`[routes-pace] R-C30 sackers: ${sackersOk} of ${sackers} (${((100 * sackersOk) / Math.max(1, sackers)).toFixed(1)}%) within 1.15 x group top; ${((100 * sackersOwnOk) / Math.max(1, sackers)).toFixed(1)}% within 1.15 x own top; over: ${sackerOver.join("; ")}`);
    expect(sackers).toBeGreaterThan(GAMES);
    expect(sackersOk / sackers).toBeGreaterThanOrEqual(0.844);
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
