// Calling screen pass Q4 (docs/specs/m2-calling-screen-pass.md): on kickoffs, onside kicks and punts
// every player the result doesn't name draws a trail that fades over kickTrail.fadeMs and nothing at
// the whistle (KT1); named players' and the ball's paths are today's (KT2); scrimmage plays are
// unchanged (KT3); the fade time lives in motion.json only (KT4).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlayEvent } from "../src/engine/types";
import { pathPrimitives } from "../src/ui/marks";
import { parseMotion } from "../src/ui/templates";
import { at, timeline, type Timeline, type TimelineCtx } from "../src/ui/timeline";
import { MOTION, TEMPLATES } from "./fake-dom";
import { ALL_FIXTURES } from "./fixtures";

const root = join(import.meta.dirname, "../../..");
const personnel = JSON.parse(readFileSync(join(root, "data/engine/personnel.json"), "utf8")) as { presetPackage: Record<string, string> };
const ctxWith = (fadeMs: number): TimelineCtx => ({ presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, motion: { ...MOTION, kickTrail: { fadeMs } } });
const build = (ev: PlayEvent, fadeMs = MOTION.kickTrail.fadeMs): Timeline => timeline({ event: ev, runoffSeconds: 0 }, TEMPLATES, ctxWith(fadeMs));
const KICKS = Object.entries(ALL_FIXTURES).filter(([, e]) => e.play.kind === "punt" || e.play.kind === "kickoff" || e.play.kind === "onsideKick");
const SCRIMMAGE = Object.entries(ALL_FIXTURES).filter(([, e]) => !KICKS.some(([, k]) => k === e));
const EDGE = 0.6;
const without = (tl: Timeline): Timeline => {
  const { kickTrail: _k, ...rest } = tl;
  void _k;
  return rest as Timeline;
};
const times = (tl: Timeline): number[] => {
  const out: number[] = [];
  for (let t = tl.snapAt; t <= tl.total; t += 50) out.push(t);
  return [...out, tl.liveEnd - 1, tl.liveEnd, tl.total];
};
const keyOf = (m: { side: string; slot: string }): string => `${m.side}:${m.slot}`;

describe("motion.json kickTrail (designed, approved by Joseph 2026-11-15)", () => {
  it("is 1000 ms and the schema checks it", () => {
    expect(MOTION.kickTrail.fadeMs).toBe(1000);
    const raw = JSON.parse(readFileSync(join(root, "data/ui/motion.json"), "utf8")) as Record<string, unknown>;
    const { kickTrail: _drop, ...noKey } = raw;
    void _drop;
    expect(() => parseMotion(noKey)).toThrow(/kickTrail/);
    expect(() => parseMotion({ ...raw, kickTrail: { fadeMs: 0 } })).toThrow(/kickTrail/);
  });
});

describe("KT1: on every kick fixture an unnamed path is a fading trail of at most fadeMs, none at the whistle", () => {
  it.each(KICKS)("%s", (_name, ev) => {
    expect(KICKS.length).toBeGreaterThanOrEqual(3);
    const tl = build(ev);
    expect(tl.kickTrail).toEqual({ fadeMs: 1000 });
    const unnamed = new Map(tl.marks.filter((m) => !tl.involved.includes(m.playerId)).map((m) => [keyOf(m), m]));
    expect(unnamed.size).toBeGreaterThan(10);
    let checked = 0;
    let running = 0;
    for (const t of times(tl)) {
      const prims = pathPrimitives(tl, t, EDGE).filter((p) => !p.faint && unnamed.has(keyOf(p)));
      if (t >= tl.liveEnd) {
        expect(prims, `t=${t}`).toEqual([]);
        continue;
      }
      for (const [k, m] of unnamed) {
        const mine = prims.filter((p) => keyOf(p) === k);
        // Every point lies on his track within the last fadeMs.
        const track: { x: number; y: number }[] = [];
        for (let s = Math.max(tl.snapAt, t - 1000); s <= t; s += 5) track.push(at(m.keys, s));
        // A mark that got clear of his own edge in the last fadeMs draws a trail; only one that stayed
        // under his mark draws nothing (test-writer: no skipping past an empty trail).
        const here = at(m.keys, t);
        const reach = Math.max(...track.map((r) => Math.hypot(r.x - here.x, r.y - here.y)));
        if (t > tl.snapAt && reach > EDGE + 0.5) {
          expect(mine.length, `${k} t=${t}: moved ${reach.toFixed(1)} yd, no trail`).toBeGreaterThan(0);
          checked++;
        }
        if (mine.length === 0) continue;
        for (const p of mine) {
          expect(p.trail).toBe(true);
          expect(p.end).toBe("none");
          for (const q of p.points) expect(Math.min(...track.map((r) => Math.hypot(r.x - q.x, r.y - q.y))), `${k} t=${t}`).toBeLessThan(0.3);
        }
        // Alpha falls from 1 at the mark toward 0 at the tail.
        const fades = mine.map((p) => p.fade);
        for (let i = 1; i < fades.length; i++) expect(fades[i] as number).toBeGreaterThanOrEqual((fades[i - 1] as number) - 1e-9);
        for (const f of fades) {
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThanOrEqual(1);
        }
        if (t - tl.snapAt > 1000) expect(fades[0] as number).toBeLessThan(0.2);
        // The piece at the mark's edge is near full alpha for a running mark (code review S3: pieces are
        // cut at a fixed step, not only at keys). A slow mark's newest pieces lie under the mark and are trimmed.
        const a = at(m.keys, t - 100);
        const b = at(m.keys, t);
        if (t - tl.snapAt > 200 && Math.hypot(a.x - b.x, a.y - b.y) > 0.8) {
          expect(Math.max(...fades), `${k} t=${t} newest piece`).toBeGreaterThan(0.85);
          running++;
        }
      }
    }
    // The checks above ran on real trails, not on an empty field.
    expect(checked, "marks that moved and drew a trail").toBeGreaterThan(50);
    expect(running, "running marks whose alpha at the mark was checked").toBeGreaterThan(10);
  });
});

describe("KT2: named players' and the ball's paths are today's", () => {
  it.each(KICKS)("%s", (_name, ev) => {
    const tl = build(ev);
    const named = new Set(tl.marks.filter((m) => tl.involved.includes(m.playerId)).map(keyOf));
    for (const t of [tl.liveEnd, tl.total, (tl.snapAt + tl.liveEnd) / 2]) {
      const now = pathPrimitives(tl, t, EDGE).filter((p) => p.faint || named.has(keyOf(p)));
      const before = pathPrimitives(without(tl), t, EDGE).filter((p) => p.faint || named.has(keyOf(p)));
      expect(now).toEqual(before);
    }
    // The ball's dotted path is the timeline's own, untouched by the trail.
    expect(tl.paths).toEqual(build(ev, 300).paths);
  });
});

describe("KT3: scrimmage fixtures draw exactly as before", () => {
  it.each(SCRIMMAGE)("%s", (_name, ev) => {
    const tl = build(ev);
    expect(tl.kickTrail).toBeUndefined();
    // Test-writer: comparing tl with without(tl) can't fail when kickTrail is undefined. Instead: no
    // piece is a trail, every path is drawn whole (no fade, a real end cap at the whistle), and the
    // kick fade time changes nothing on a scrimmage play.
    const other = build(ev, 300);
    let drawn = 0;
    for (const t of times(tl)) {
      const prims = pathPrimitives(tl, t, EDGE);
      expect(prims.filter((p) => p.trail === true), `t=${t}`).toEqual([]);
      for (const p of prims) if (!p.faint) expect(p.fade, `t=${t} ${p.side}:${p.slot}`).toBe(1);
      expect(prims, `t=${t}`).toEqual(pathPrimitives(other, t, EDGE));
      drawn += prims.filter((p) => !p.faint).length;
    }
    const atWhistle = pathPrimitives(tl, tl.total, EDGE).filter((p) => !p.faint);
    expect(atWhistle.every((p) => p.end !== "none"), "every path has its end cap at the whistle").toBe(true);
    // A flag before the snap has no live play to draw.
    if (ev.play.kind !== "noPlay") {
      expect(atWhistle.length, "the after-whistle diagram is drawn").toBeGreaterThan(0);
      expect(drawn).toBeGreaterThan(0);
    }
  });
});

describe("KT4: the fade time is data", () => {
  it("a shorter fadeMs gives shorter trails", () => {
    const [, ev] = KICKS.find(([n]) => n === "KICKOFF_RETURN") ?? (KICKS[0] as [string, PlayEvent]);
    const long = build(ev, 1000);
    const short = build(ev, 300);
    const t = long.snapAt + 1500;
    const length = (tl: Timeline): number =>
      pathPrimitives(tl, t, EDGE)
        .filter((p) => p.trail === true)
        .reduce((a, p) => a + Math.hypot((p.points[1]?.x ?? 0) - (p.points[0]?.x ?? 0), (p.points[1]?.y ?? 0) - (p.points[0]?.y ?? 0)), 0);
    expect(length(short)).toBeLessThan(length(long) * 0.6);
    expect(length(short)).toBeGreaterThan(0);
  });

  it("no literal fade time in marks.ts or field.ts", () => {
    for (const f of ["marks.ts", "field.ts"]) {
      const src = readFileSync(join(import.meta.dirname, "../src/ui", f), "utf8");
      expect(src, f).not.toMatch(/\b1000\b/);
      expect(src, f).not.toMatch(/kickTrail[^\n]*\b\d{3,}\b/);
    }
    // The trail reads the timeline's kickTrail, which timeline() copies from motion.json.
    expect(readFileSync(join(import.meta.dirname, "../src/ui/marks.ts"), "utf8")).toMatch(/tl\.kickTrail/);
  });
});
