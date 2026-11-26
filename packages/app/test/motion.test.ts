// Live motion (docs/specs/m2-play-calling-and-motion.md, Motion and Pre-snap, and Joseph's
// amendment "all 22 players move as in a real play"), checked on the keys the field draws.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlayEvent } from "../src/engine/types";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { at, scaleAt, timeline, type Timeline, type TimelineCtx } from "../src/ui/timeline";
import { COMPLETE, INCOMPLETE, RUN, snap } from "./fixtures";
import { playGame } from "./support";

const read = (p: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", p), "utf8"));
const templates = parseTemplates(read("data/ui/templates.json"));
const motion = parseMotion(read("data/ui/motion.json"));
const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };
const ctx: TimelineCtx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion };
const build = (event: PlayEvent, human: "offense" | "defense" | null = null): Timeline => timeline({ event, runoffSeconds: 0, human, ownStart: "lined" }, templates, ctx);

const sample: PlayEvent[] = [71, 72, 73].flatMap((seed) => playGame(seed, seed % 2 === 0 ? "home" : "away", seed).events.filter((e): e is PlayEvent => e.t === "play"));
const live = sample.filter((e) => e.play.kind !== "noPlay");

describe("all 22 move from the snap (Joseph's amendment)", () => {
  it("on every play of three simulated games, every mark's position changes between the snap and the whistle", { timeout: 30_000 }, () => {
    const still: string[] = [];
    for (const ev of live) {
      const tl = build(ev);
      for (const m of tl.marks) {
        const a = at(m.keys, tl.snapAt);
        const b = at(m.keys, tl.liveEnd);
        let moved = Math.hypot(a.x - b.x, a.y - b.y) > 0.05;
        // A mark that comes back near his spot still moved: check the path in between too.
        for (let t = tl.snapAt; !moved && t <= tl.liveEnd; t += 25) {
          const p = at(m.keys, t);
          moved = Math.hypot(p.x - a.x, p.y - a.y) > 0.05;
        }
        if (!moved) still.push(`${ev.play.kind} ${ev.offense.call}: ${m.side}${m.slot}`);
      }
    }
    expect(still).toEqual([]);
    expect(live.length).toBeGreaterThan(300);
  });

  it("every mark starts moving within 150 ms of the snap", { timeout: 30_000 }, () => {
    const late: string[] = [];
    for (const ev of live) {
      const tl = build(ev);
      for (const m of tl.marks) {
        const a = at(m.keys, tl.snapAt);
        // The first drawn key after his start must already be off the set spot.
        const t = tl.snapAt + motion.maxStartMs + motion.keyMs;
        const p = at(m.keys, Math.min(t, tl.liveEnd));
        if (Math.hypot(p.x - a.x, p.y - a.y) < 1e-4) late.push(`${ev.play.kind} ${ev.offense.call}: ${m.side}${m.slot}`);
      }
    }
    expect(late).toEqual([]);
  });

  it("with a tighter start cap in the motion data, every mark still starts within it (each cap is load-bearing)", { timeout: 30_000 }, () => {
    // The shipped starts mostly sit under the shipped 150 ms cap, so removing one of the caps in
    // timeline.ts would go unseen there. At 40 ms most positions' starts need the cap.
    const cap = 40;
    const tight: TimelineCtx = { ...ctx, motion: { ...motion, maxStartMs: cap } };
    const late: string[] = [];
    // A kneel's QB goes down once the ball reaches him (snapMs after the snap, by design), not on a start time.
    for (const ev of live.filter((e) => e.play.kind !== "kneel")) {
      const tl = timeline({ event: ev, runoffSeconds: 0, human: null, ownStart: "lined" }, templates, tight);
      for (const m of tl.marks) {
        const a = at(m.keys, tl.snapAt);
        const p = at(m.keys, Math.min(tl.snapAt + cap + motion.keyMs, tl.liveEnd));
        if (Math.hypot(p.x - a.x, p.y - a.y) < 1e-4) late.push(`${ev.play.kind} ${ev.offense.call}: ${m.side}${m.slot}`);
      }
    }
    expect(late).toEqual([]);
  });

  it("starts are staggered by reaction time: at least 4 distinct start times on a scrimmage play (M3)", () => {
    const tl = build(RUN);
    const starts = new Set(
      tl.marks.map((m) => {
        const a = at(m.keys, tl.snapAt);
        for (let t = tl.snapAt; t <= tl.snapAt + 200; t += 5) {
          const p = at(m.keys, t);
          if (Math.hypot(p.x - a.x, p.y - a.y) > 1e-6) return Math.round((t - tl.snapAt) / 5) * 5;
        }
        return -1;
      }),
    );
    expect(starts.size).toBeGreaterThanOrEqual(4);
    expect([...starts].every((s) => s >= 0 && s <= motion.maxStartMs + 25)).toBe(true);
  });
});

describe("easing, settle, ball and paths", () => {
  it("every mark is at rest at the snap and at rest at the end of the settle (M2)", () => {
    for (const ev of live.slice(0, 120)) {
      const tl = build(ev);
      for (const m of tl.marks) {
        const v0 = Math.hypot(at(m.keys, tl.snapAt).x - at(m.keys, tl.snapAt - 25).x, at(m.keys, tl.snapAt).y - at(m.keys, tl.snapAt - 25).y);
        const end = tl.liveEnd + tl.settleMs;
        const v1 = Math.hypot(at(m.keys, end).x - at(m.keys, end - 25).x, at(m.keys, end).y - at(m.keys, end - 25).y);
        expect(v0, `${m.slot} at the snap`).toBeLessThan(1e-9);
        expect(v1, `${m.slot} at the end`).toBeLessThan(0.05);
      }
    }
  });

  it("in the settle the ball, holder and tackler don't move; every other mark moves at most 1.5 yards (M7)", () => {
    for (const ev of live.slice(0, 200)) {
      const tl = build(ev);
      const b0 = at(tl.ball, tl.liveEnd);
      const b1 = at(tl.ball, tl.liveEnd + tl.settleMs);
      expect(Math.hypot(b0.x - b1.x, b0.y - b1.y)).toBeLessThan(1e-9);
      for (const m of tl.marks) {
        const p0 = at(m.keys, tl.liveEnd);
        const p1 = at(m.keys, tl.liveEnd + tl.settleMs);
        const moved = Math.hypot(p0.x - p1.x, p0.y - p1.y);
        if (m.playerId === tl.holder || m.playerId === tl.tackler) expect(moved).toBeLessThan(1e-9);
        else expect(moved).toBeLessThanOrEqual(motion.settleMaxYards + 1e-9);
      }
    }
  });

  it("the ball is size 1 at rest and grows only in flight, at most to the table's apex (M8)", { timeout: 30_000 }, () => {
    const maxApex = Math.max(motion.flight.apexMax, motion.punt.apex, motion.kickoff.apex, motion.fieldGoal.apex);
    for (const ev of live) {
      const tl = build(ev);
      expect(scaleAt(tl.ballScale, tl.snapAt)).toBe(1);
      expect(scaleAt(tl.ballScale, tl.total + 100)).toBe(1);
      for (const k of tl.ballScale) expect(k.s).toBeLessThanOrEqual(maxApex + 1e-9);
    }
    const pass = build(COMPLETE);
    expect(Math.max(...pass.ballScale.map((k) => k.s))).toBeGreaterThan(1);
  });

  it("unnamed defenders' paths stop at the read; named players' paths run to the whistle (M10)", () => {
    for (const ev of live.slice(0, 150)) {
      const tl = build(ev);
      for (const m of tl.marks) {
        if (tl.involved.includes(m.playerId)) expect(m.pathEnd, `${m.slot} named`).toBe(tl.liveEnd);
        else if (m.side === "X") expect(m.pathEnd).toBeLessThanOrEqual(Math.max(tl.read + 300, tl.snapAt + 600) + 1e-6);
      }
    }
  });

  it("after the read, at least half the unnamed defenders end the play closer to the ball (M5)", () => {
    let plays = 0;
    for (const ev of live) {
      if (ev.play.kind !== "run" && ev.play.kind !== "pass") continue;
      // Not on a change of possession: on a long interception or fumble return the defenders are
      // the escort and the pursuers chase at equal top speed, so (as in real football) they need
      // not end closer. Named in the report as a limit of M5 as written.
      if (ev.play.end.possession !== "offense") continue;
      // Lead decision (2026-11-15, spec "Note on M5"): plays that end out of bounds are skipped; the
      // carrier runs to the sideline away from the defenders after the read.
      if ("outOfBounds" in ev.play && ev.play.outOfBounds === true) continue;
      const tl = build(ev);
      // Lead-approved (2026-11-15, revision 2026-11-14 slower pace): the play must leave a defender
      // time to react and reach speed after the read, from motion.json (reactionMs + accelMs, the
      // slowest of the defenders counted below), in place of the flat 400 ms.
      const counted = tl.marks.filter((m) => m.side === "X" && !m.fact && m.position !== "DL");
      const window = Math.max(...counted.map((m) => (motion.reactionMs[m.position] ?? motion.reactionMs["other"] ?? 0) + (motion.accelMs[m.position] ?? 0)));
      if (tl.read > tl.liveEnd - window) continue;
      // Contained plays: the ball moves at most 15 yards after the read. On a breakaway the runner
      // outruns pursuers at equal speed, so they need not end closer (named in the report).
      const br0 = at(tl.ball, tl.read);
      const be0 = at(tl.ball, tl.liveEnd - 1);
      if (Math.hypot(be0.x - br0.x, be0.y - br0.y) > 15) continue;
      const ds = tl.marks.filter((m) => m.side === "X" && !m.fact && m.position !== "DL");
      const closer = ds.filter((m) => {
        const r = at(m.keys, tl.read);
        const e = at(m.keys, tl.liveEnd);
        const br = at(tl.ball, tl.read);
        // Where the ball was at the whistle (an incompletion's respot to the line comes after it).
        const be = at(tl.ball, tl.liveEnd - 1);
        return Math.hypot(e.x - be.x, e.y - be.y) < Math.hypot(r.x - br.x, r.y - br.y);
      }).length;
      expect(closer, `${ev.play.kind} ${ev.offense.call}`).toBeGreaterThanOrEqual(Math.ceil(ds.length / 2));
      plays++;
    }
    expect(plays).toBeGreaterThan(50);
  });
});

describe("before the snap", () => {
  it("their huddle doesn't depend on their call (P1)", () => {
    const presets = ["baseCover3", "nickelCover1Blitz", "dimeCover4", "goalLine", "prevent"];
    const looks = presets.map((preset) => {
      const tl = build({ ...COMPLETE, defense: preset }, "offense");
      return JSON.stringify(
        tl.marks
          .filter((m) => m.side === "X")
          .map((m) => at(m.keys, 0))
          .map((p) => [Math.round(p.x * 1000), Math.round(p.y * 1000)])
          .sort(),
      );
    });
    expect(new Set(looks).size).toBe(1);
    // And they are in the huddle, not lined up: no defender sits on the line at t = 0.
    const tl = build(COMPLETE, "offense");
    for (const m of tl.marks.filter((x) => x.side === "X")) expect(m.huddle).toBe(true);
  });

  it("the same calls with different results draw the same frames before the snap (P3)", () => {
    const a = build(COMPLETE, "offense");
    const b = build({ ...INCOMPLETE, offense: COMPLETE.offense, defense: COMPLETE.defense }, "offense");
    for (const t of [0, 100, a.setAt, a.snapAt - 1]) {
      const fa = a.marks.map((m) => [m.playerId, at(m.keys, t)]);
      const fb = b.marks.map((m) => [m.playerId, at(m.keys, t)]);
      expect(fb).toEqual(fa);
      expect(at(b.ball, t)).toEqual(at(a.ball, t));
    }
    expect(b.preview).toEqual(a.preview);
    expect(a.preview).not.toBeNull();
  });

  it("a public line-up (a punt) has no huddle and no line-up phase", () => {
    const punt = sample.find((e) => e.play.kind === "punt");
    if (punt === undefined) throw new Error("no punt in the sample");
    const tl = build(punt, "defense");
    expect(tl.marks.every((m) => !m.huddle)).toBe(true);
    expect(tl.lineUpMs).toBe(0);
  });

  it("the line-up runs with the run-off and the set is 300 ms", () => {
    const tl = timeline({ event: { ...RUN, before: snap({ clock: 500 }) }, runoffSeconds: 20, human: "offense" }, templates, ctx);
    expect(tl.lineUpMs).toBe(Math.max(motion.preSnap.lineUpMs, motion.preSnap.runoffMaxMs));
    expect(tl.snapAt - tl.setAt).toBe(motion.preSnap.setMs);
  });
});
