// Natural motion (docs/specs/m2-play-calling-and-motion.md, "Revision 2026-11-15: natural motion",
// as built: N2 was dropped with the governor), criteria N1 and N3 to N8 over every event in
// ALL_FIXTURES at 1x, measured the spec's way:
// p_i = at(keys, snapAt + 25 i) up to liveEnd + settleMs, v_i = |p_{i+1} - p_{i-1}| / 0.05 s,
// a_i = (v_{i+1} - v_{i-1}) / 0.05 s, lateral = v_i x the heading change of (p_{i+1} - p_{i-1}) per
// 0.05 s where v_i >= 1 yd/s. top, accelMs and reactionMs are the mark's own, top divided by k.
// The multipliers (1.15, 1.25, 0.02, 0.3) are the spec's test constants, never data.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlayEvent } from "../src/engine/types";
import { fnv1a, hashUnit, stratify } from "../src/ui/natural";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { at, timeline, type Key, type Pt, type Timeline, type TimelineCtx, type TLMark } from "../src/ui/timeline";
import { ALL_FIXTURES, COMPLETE, RUN, SACK } from "./fixtures";

const read = (p: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", p), "utf8"));
const templates = parseTemplates(read("data/ui/templates.json"));
const motion = parseMotion(read("data/ui/motion.json"));
const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };
const ctx: TimelineCtx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion };
const tlOf = (ev: PlayEvent, c: TimelineCtx = ctx): Timeline => timeline({ event: ev, runoffSeconds: 0 }, templates, c);
const NAT = motion.natural;
const KEY = 25;
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

const FIX = Object.entries(ALL_FIXTURES).map(([name, ev]) => ({ name, ev, tl: tlOf(ev), raw: tlOf(ev, { ...ctx, natural: false }) }));
const live = FIX.filter((f) => f.tl.liveEnd > f.tl.snapAt);
/** States: no play, kneel and spike are exempt from N4 and N5 (nobody sways). */
const clockPlay = (ev: PlayEvent): boolean => ev.play.kind === "noPlay" || ev.play.kind === "kneel" || ev.play.kind === "spike";

interface Meas {
  readonly t: number[];
  readonly p: Pt[];
  /** Speed (yd/s), tangential acceleration and lateral acceleration (yd/s^2), NaN where undefined. */
  readonly v: number[];
  readonly a: number[];
  readonly lat: number[];
}
function measure(tl: Timeline, m: TLMark): Meas {
  const t: number[] = [];
  const p: Pt[] = [];
  for (let s = tl.snapAt; s <= tl.liveEnd + tl.settleMs + 1e-9; s += KEY) {
    t.push(s);
    p.push(at(m.keys, s));
  }
  const n = t.length;
  const v = t.map((_, i) => (i === 0 || i === n - 1 ? NaN : dist(p[i + 1] as Pt, p[i - 1] as Pt) / 0.05));
  const a = t.map((_, i) => (i < 2 || i > n - 3 ? NaN : ((v[i + 1] as number) - (v[i - 1] as number)) / 0.05));
  const head = t.map((_, i) => (i === 0 || i === n - 1 ? NaN : Math.atan2((p[i + 1] as Pt).y - (p[i - 1] as Pt).y, (p[i + 1] as Pt).x - (p[i - 1] as Pt).x)));
  const lat = t.map((_, i) => {
    if (i < 2 || i > n - 3) return NaN;
    // The heading is defined only while he moves: v >= 1 yd/s here and at both neighbours.
    if ((v[i] as number) < 1 || (v[i - 1] as number) < 1 || (v[i + 1] as number) < 1) return NaN;
    let d = (head[i + 1] as number) - (head[i - 1] as number);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return ((v[i] as number) * Math.abs(d)) / 0.05;
  });
  return { t, p, v, a, lat };
}
const natOf = (m: TLMark): NonNullable<TLMark["nat"]> => {
  if (m.nat === undefined) throw new Error(`${m.side}${m.slot}: no natural-motion record`);
  return m.nat;
};
const topOf = (m: TLMark): number => natOf(m).top / natOf(m).k;
const inIv = (t: number, iv: readonly (readonly [number, number])[]): boolean => iv.some(([a, b]) => t >= a - 1e-9 && t <= b + 1e-9);
const demandedAt = (m: TLMark, t: number): { mean: number } | undefined => natOf(m).demanded.find((d) => t >= d.t0 - 1e-9 && t <= d.t1 + 1e-9);
const label = (name: string, m: TLMark): string => `${name} ${m.side}${m.slot}`;

describe("N1: no teleports", () => {
  it("every mark at every key outside anchor-demanded legs: v <= 1.15 x top (on those legs 1.25 x its required mean)", () => {
    const bad: string[] = [];
    const legs: string[] = [];
    for (const { name, tl } of live)
      for (const m of tl.marks) {
        const M = measure(tl, m);
        for (const d of natOf(m).demanded) legs.push(`${label(name, m)} ${(d.t0 - tl.snapAt).toFixed(0)} to ${(d.t1 - tl.snapAt).toFixed(0)} ms, mean ${d.mean.toFixed(2)} yd/s`);
        M.v.forEach((v, i) => {
          if (Number.isNaN(v)) return;
          const dm = demandedAt(m, M.t[i] as number);
          const cap = dm !== undefined ? 1.25 * dm.mean : 1.15 * topOf(m);
          if (v > cap + 1e-9) bad.push(`${label(name, m)} ${v.toFixed(2)} yd/s > ${cap.toFixed(2)} at ${((M.t[i] as number) - tl.snapAt).toFixed(0)} ms`);
        });
      }
    // States: the anchor-demanded legs are listed in the test output.
    if (legs.length > 0) console.log(`N1 anchor-demanded legs:\n${legs.join("\n")}`);
    expect(bad.slice(0, 30)).toEqual([]);
  });
});

describe("N3: no clones", () => {
  it("every pair on one side at one position: RMS speed difference >= 0.2 yd/s where both move (>= 400 ms in common)", () => {
    const bad: string[] = [];
    let pairs = 0;
    for (const { name, tl } of live)
      for (const [i, a] of tl.marks.entries())
        for (const b of tl.marks.slice(i + 1)) {
          if (a.side !== b.side || a.position !== b.position) continue;
          const A = measure(tl, a);
          const B = measure(tl, b);
          let n = 0;
          let s = 0;
          A.v.forEach((v, j) => {
            const w = B.v[j] as number;
            if (Number.isNaN(v) || Number.isNaN(w) || v < 1 || w < 1) return;
            n++;
            s += (v - w) ** 2;
          });
          if (n * KEY < 400) continue;
          pairs++;
          const rms = Math.sqrt(s / n);
          if (rms < 0.2) bad.push(`${name} ${a.side}${a.slot} and ${b.slot}: RMS ${rms.toFixed(3)} yd/s over ${n} keys`);
        }
    expect(pairs).toBeGreaterThan(50);
    expect(bad).toEqual([]);
  });
});

describe("N4: no cruise plateau", () => {
  it("in every 500 ms window where v stays above 0.5 x top, max v - min v >= 0.02 x top", () => {
    const bad: string[] = [];
    const W = 500 / KEY;
    for (const { name, ev, tl } of live) {
      if (clockPlay(ev)) continue;
      for (const m of tl.marks) {
        const M = measure(tl, m);
        const top = topOf(m);
        for (let i = 0; i + W < M.v.length; i++) {
          const win = M.v.slice(i, i + W + 1);
          if (win.some((v) => Number.isNaN(v) || v <= 0.5 * top)) continue;
          const span = Math.max(...win) - Math.min(...win);
          if (span < 0.02 * top) {
            bad.push(`${label(name, m)}: ${span.toFixed(3)} yd/s spread from ${((M.t[i] as number) - tl.snapAt).toFixed(0)} ms (v about ${(win[0] as number).toFixed(2)})`);
            break;
          }
        }
      }
    }
    expect(bad.slice(0, 30)).toEqual([]);
  });
});

describe("N5: never frozen", () => {
  /** States: the sacked QB and his sacker after the sack, the holder and the tackler in the last convergeMs. */
  function exemptFrom(tl: Timeline, ev: PlayEvent, m: TLMark): number {
    let t = Infinity;
    if (ev.play.kind === "sack" && (m.roles.includes("sacker") || m.roles.includes("passer"))) t = Math.min(t, ...natOf(m).anchors.map((a) => a.t).filter((x) => x < tl.liveEnd - 1e-6), tl.liveEnd);
    if (m.playerId === tl.holder || m.playerId === tl.tackler) t = Math.min(t, tl.liveEnd - motion.convergeMs);
    return t;
  }
  it("every mark not exempt has v >= 0.3 yd/s on at least 95% of keys from his start to the whistle", () => {
    const bad: string[] = [];
    for (const { name, ev, tl } of live) {
      if (clockPlay(ev)) continue;
      for (const m of tl.marks) {
        const M = measure(tl, m);
        const set = at(m.keys, tl.snapAt);
        const i0 = M.p.findIndex((q) => dist(q, set) > 1e-6);
        if (i0 < 0) {
          bad.push(`${label(name, m)}: never moves`);
          continue;
        }
        const t1 = Math.min(tl.liveEnd, exemptFrom(tl, ev, m));
        let n = 0;
        let ok = 0;
        M.v.forEach((v, i) => {
          const t = M.t[i] as number;
          if (i < i0 || t > t1 || Number.isNaN(v)) return;
          n++;
          if (v >= 0.3) ok++;
        });
        if (n > 0 && ok / n < 0.95) bad.push(`${label(name, m)}: moving on ${((100 * ok) / n).toFixed(0)}% of ${n} keys`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("engaged linemen, engage end to release or whistle: v >= 0.4 on 90% of keys, mean v in [0.8, 3.0]; contact holds; nobody wins", () => {
    const bad: string[] = [];
    let windows = 0;
    for (const { name, ev, tl, raw } of live) {
      if (clockPlay(ev)) continue;
      for (const m of tl.marks) {
        const e = natOf(m).engaged;
        if (e === undefined || e.to - e.from < 4 * KEY) continue;
        windows++;
        const M = measure(tl, m);
        const vs = M.v.filter((v, i) => !Number.isNaN(v) && (M.t[i] as number) >= e.from - 1e-9 && (M.t[i] as number) <= e.to + 1e-9);
        if (vs.length === 0) continue;
        const share = vs.filter((v) => v >= 0.4).length / vs.length;
        const mean = vs.reduce((s, v) => s + v, 0) / vs.length;
        if (share < 0.9) bad.push(`${label(name, m)}: v >= 0.4 on ${(100 * share).toFixed(0)}% of the engaged window`);
        if (mean < 0.8 || mean > 3.0) bad.push(`${label(name, m)}: engaged mean ${mean.toFixed(2)} yd/s`);
        // Nobody wins: his mean offset along the pair's axis from the designed drift (the raw keys) within 0.15 yd.
        const r = raw.marks.find((x) => x.playerId === m.playerId) as TLMark;
        let off = 0;
        let cnt = 0;
        for (let t = Math.ceil(e.from / KEY) * KEY; t <= e.to; t += KEY) {
          const g = at(m.keys, t);
          const q = at(r.keys, t);
          off += (g.x - q.x) * e.axis.x + (g.y - q.y) * e.axis.y;
          cnt++;
        }
        if (cnt > 0 && Math.abs(off / cnt) > 0.15) bad.push(`${label(name, m)}: mean offset ${(off / cnt).toFixed(3)} yd along the pair's axis`);
        // M6: the pair keeps the distance it engaged at (within 0.3 yd, the R-C8 reading of M6).
        const mate = e.partner === null ? undefined : tl.marks.find((x) => x.playerId === e.partner);
        const me = mate === undefined ? undefined : natOf(mate).engaged;
        if (mate !== undefined && me !== undefined) {
          const t0 = Math.max(e.from, me.from);
          const t1 = Math.min(e.to, me.to);
          const ref = dist(at(m.keys, t0), at(mate.keys, t0));
          for (let t = t0; t <= t1; t += KEY) {
            const d = dist(at(m.keys, t), at(mate.keys, t));
            if (Math.abs(d - ref) > 0.3) {
              bad.push(`${label(name, m)} and ${mate.slot}: contact ${ref.toFixed(2)} to ${d.toFixed(2)} yd at ${(t - tl.snapAt).toFixed(0)} ms`);
              break;
            }
          }
        }
      }
    }
    expect(windows).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });
});

describe("N6: anchors exact, settle eased, contract 3", () => {
  it("every fact anchor is at its time and place within 1e-6 yd", () => {
    const bad: string[] = [];
    let n = 0;
    for (const { name, tl } of live)
      for (const m of tl.marks)
        for (const a of natOf(m).anchors) {
          n++;
          const d = dist(at(m.keys, a.t), a);
          if (d > 1e-6) bad.push(`${label(name, m)} anchor at ${(a.t - tl.snapAt).toFixed(0)} ms off by ${d.toExponential(2)} yd`);
        }
    expect(n).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it("the anchors are the facts: the holder and tackler at the ball at the whistle, the ball with its holder", () => {
    const bad: string[] = [];
    for (const { name, tl } of live) {
      const fin = at(tl.ball, tl.liveEnd);
      for (const id of [tl.holder, tl.tackler]) {
        const m = id === null ? undefined : tl.marks.find((x) => x.playerId === id);
        if (m !== undefined && dist(at(m.keys, tl.liveEnd), fin) > 1e-6) bad.push(`${label(name, m)} not at the ball at the whistle`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("in the settle speed never rises by more than 0.05 yd/s a key and is 0.2 yd/s or less at its end", () => {
    const bad: string[] = [];
    for (const { name, tl } of live)
      for (const m of tl.marks) {
        const M = measure(tl, m);
        const ks = M.t.map((t, i) => ({ t, v: M.v[i] as number })).filter((q) => q.t > tl.liveEnd && !Number.isNaN(q.v));
        for (let i = 1; i < ks.length; i++)
          if ((ks[i] as { v: number }).v > (ks[i - 1] as { v: number }).v + 0.05) {
            bad.push(`${label(name, m)}: speed rises in the settle at ${((ks[i] as { t: number }).t - tl.liveEnd).toFixed(0)} ms`);
            break;
          }
        const endV = dist(at(m.keys, tl.liveEnd + tl.settleMs), at(m.keys, tl.liveEnd + tl.settleMs - KEY)) / 0.025;
        if (endV > 0.2) bad.push(`${label(name, m)}: ${endV.toFixed(2)} yd/s at the end of the settle`);
      }
    expect(bad.slice(0, 30)).toEqual([]);
  });

  it("contract 3 (amended for the ball in the air): no unnamed defender inside the ring on any key after the snap window", () => {
    const bad: string[] = [];
    const ring = templates.field.clearOfBallYards;
    for (const { name, tl } of live) {
      const flights = tl.paths.filter((p) => p.kind === "ball");
      // Kicks fly too: a ball whose drawn size is above 1 is in the air.
      const inAir = (t: number): boolean => flights.some((f) => t >= f.start && t <= f.end);
      for (const m of tl.marks) {
        if (m.side !== "X" || m.fact) continue;
        for (let t = Math.ceil(tl.snapWindowEnd / KEY) * KEY; t < tl.liveEnd - 1; t += KEY) {
          const r = dist(at(m.keys, t), at(tl.ball, Math.min(t, tl.liveEnd - 1)));
          const R = inAir(t) ? Math.min(ring, NAT.flightRingYards) : ring;
          if (r < R - 1e-6) {
            bad.push(`${label(name, m)} ${r.toFixed(2)} yd from the ball at ${(t - tl.snapAt).toFixed(0)} ms`);
            break;
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

});

describe("N7: deterministic, no leak, in budget", () => {
  it("two runs of the same input give identical keys", () => {
    for (const { ev, tl } of FIX) expect(tlOf(structuredClone(ev)).marks.map((m) => m.keys)).toEqual(tl.marks.map((m) => m.keys));
  });

  it("NM4's values come from the id and the on-field set only: unchanged when only target, result or end spot change", () => {
    const vals = (tl: Timeline): Record<string, unknown> => Object.fromEntries(tl.marks.map((m) => [m.playerId, { top: natOf(m).top, accelMs: natOf(m).accelMs, reactionMs: natOf(m).reactionMs, start: natOf(m).startSpreadMs }]));
    const base = vals(tlOf(COMPLETE));
    const d = COMPLETE.play.detail as { participants: Record<string, string> };
    const variants: PlayEvent[] = [
      { ...COMPLETE, play: { ...COMPLETE.play, detail: { ...d, participants: { ...d.participants, receiver: "H-WR1", target: "H-WR1" } } } as PlayEvent["play"] },
      { ...COMPLETE, play: { ...COMPLETE.play, end: { spot: 70, possession: "offense" } } as PlayEvent["play"] },
      { ...COMPLETE, play: { kind: "pass", seconds: 5, incomplete: true, end: { spot: COMPLETE.before.spot, possession: "offense" }, detail: { ...d, participants: { passer: d.participants["passer"] as string, target: "H-TE1" } } } as PlayEvent["play"] },
    ];
    for (const v of variants) expect(vals(tlOf(v))).toEqual(base);
  });

  it("the spread is FNV-1a of the id and stratified: no two marks in a group share a value", () => {
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("a")).toBe(0xe40c292c);
    expect(hashUnit("H-WR1", "top")).toBe(fnv1a("H-WR1|top") / 2 ** 32);
    const s = stratify(["A-CB1", "A-CB2", "A-CB3"], "top");
    expect([...s.values()].sort()).toEqual([-1, 0, 1]);
    for (const { tl } of [FIX[0] as (typeof FIX)[number]]) {
      const groups = new Map<string, number[]>();
      for (const m of tl.marks) groups.set(`${m.side}${m.position}`, [...(groups.get(`${m.side}${m.position}`) ?? []), natOf(m).top]);
      for (const g of groups.values()) expect(new Set(g).size).toBe(g.length);
    }
  });

  it("R-C15: timeline() at 20 ms or less per play, median over every fixture (the 1,000-play run is in PERF.md)", () => {
    const ms: number[] = [];
    for (let r = 0; r < 5; r++)
      for (const ev of [COMPLETE, RUN, SACK, ...Object.values(ALL_FIXTURES)]) {
        const t0 = performance.now();
        tlOf(ev);
        ms.push(performance.now() - t0);
      }
    ms.sort((a, b) => a - b);
    expect(ms[Math.floor(ms.length / 2)] as number).toBeLessThanOrEqual(20);
  });
});

describe("N8: ratings drive motion (decision 12 reversed)", () => {
  const atRating = (r: number): TimelineCtx => {
    const ids = Object.values(COMPLETE.play.kind === "pass" ? (COMPLETE.play.detail as { onField: { offense: Record<string, string[]>; defense: Record<string, string[]> } }).onField : { offense: {}, defense: {} }).flatMap((side) => Object.values(side).flat());
    return { ...ctx, ratings: Object.fromEntries(ids.map((id) => [id, { speed: r, agility: r, awareness: r }])) };
  };
  it("at the same position a higher speed rating gives a higher top and a higher drawn top speed before the read", () => {
    const slow = tlOf(COMPLETE, atRating(40));
    const fast = tlOf(COMPLETE, atRating(90));
    const read = fast.paths.find((p) => p.kind === "ball")?.start ?? fast.read;
    const peak = (tl: Timeline, m: TLMark): number => {
      let v = 0;
      for (let t = tl.snapAt; t + KEY <= Math.min(read, tl.liveEnd); t += KEY) v = Math.max(v, (dist(at(m.keys, t), at(m.keys, t + KEY)) / KEY) * 1000);
      return v;
    };
    const bad: string[] = [];
    let checked = 0;
    for (const f of fast.marks) {
      const s = slow.marks.find((x) => x.playerId === f.playerId) as TLMark;
      if (natOf(f).top <= natOf(s).top) bad.push(`${f.side}${f.slot}: top ${natOf(f).top} not above ${natOf(s).top}`);
      if (fast.involved.includes(f.playerId) || peak(slow, s) < 1) continue;
      checked++;
      if (peak(fast, f) <= peak(slow, s)) bad.push(`${f.side}${f.slot}: drawn peak ${peak(fast, f).toFixed(2)} not above ${peak(slow, s).toFixed(2)} yd/s`);
    }
    expect(checked).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });

  it("the band reads by eye: worst to best at a position is at least 20% of top speed; missing ratings keep the position's values", () => {
    const slow = tlOf(COMPLETE, atRating(motion.ratings.lo));
    const fast = tlOf(COMPLETE, atRating(motion.ratings.hi));
    const none = tlOf(COMPLETE);
    for (const f of fast.marks) {
      const s = slow.marks.find((x) => x.playerId === f.playerId) as TLMark;
      const n = none.marks.find((x) => x.playerId === f.playerId) as TLMark;
      const base = (motion.speed[f.position] as number);
      expect((natOf(f).top - natOf(s).top) / base).toBeGreaterThanOrEqual(0.2);
      // No ratings: the table speed, within the hash tie-breaker.
      expect(Math.abs(natOf(n).top / base - 1)).toBeLessThanOrEqual(NAT.spread.topShare + 1e-9);
      expect(natOf(f).accelMs).toBeLessThan(natOf(s).accelMs);
      expect(natOf(f).reactionMs).toBeLessThan(natOf(s).reactionMs);
    }
  });

  it("fact anchors stay exact with any ratings", () => {
    for (const r of [motion.ratings.lo, motion.ratings.hi])
      for (const ev of [COMPLETE, RUN, SACK]) {
        const tl = tlOf(ev, atRating(r));
        for (const m of tl.marks) for (const a of natOf(m).anchors) expect(dist(at(m.keys, a.t), a)).toBeLessThan(1e-6);
      }
  });
});
