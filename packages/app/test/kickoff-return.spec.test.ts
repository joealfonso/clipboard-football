// Kickoff return pass, KR1 to KR9 (docs/specs/m2-play-calling-and-motion.md, "Amended (Joseph,
// 2026-11-15): kickoff return pass"), written by test-writer from the spec. Headless, on the
// Timeline from timeline() at 1x, over KICKOFF_RETURN and the new fixtures the spec asks for (a
// return of 40 yd or more, one shorter than kickReturn.cutMinReturnYards, a return fumble) plus the
// reachable States (a return touchdown, a foul on the return, the returner set deep). Every
// criterion must pass on 100% of fixtures. The thresholds come from motion.json's kickReturn
// block, held to the floors the spec fixes as test constants (kickoff-return.checks.ts), so the
// data can't loosen its own test. The 1,000-return sweep is test/game/kickoff-return.heavy.test.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDetail, type PlayEvent } from "../src/engine/types";
import { MotionError, parseMotion } from "../src/ui/templates";
import { at } from "../src/ui/timeline";
import { FAIR_CATCH, KICKOFF_RETURN, KICKOFF_TOUCHBACK, PUNT_RETURNED } from "./fixtures";
import { allChecks, ctx, firstCut, isReturn, KRD, kr1, kr2, kr3, kr4, kr5, kr6, kr7Direction, kr9, motion, motionRaw, partsOf, returnUnitSameToCatch, T, tlOf, withReturnFouler, withReturnTeamRecovery } from "./kickoff-return.checks";
import { KO_FAIR, KO_OOB, KO_SHORT, KR_DEEP, KR_FOUL, KR_FUMBLE, KR_LONG, KR_TD, krReturn, krShort, ONSIDE_KICKERS, ONSIDE_RECEIVERS } from "./kickoff-return.fixtures";
import { digestOf, kr8Digest } from "./kr8-digest";

const baseline = JSON.parse(readFileSync(join(import.meta.dirname, "kr8-baseline.json"), "utf8")) as unknown;
/** A return shorter than cutMinReturnYards: a whole yard under it (5 yd while the key is missing, so the file still loads). */
const SHORT_YARDS = Number.isFinite(T.cutMinReturnYards) ? Math.max(1, Math.ceil(T.cutMinReturnYards) - 1) : 5;
const KR_SHORT = krShort(SHORT_YARDS);

const RETURNS: Readonly<Record<string, PlayEvent>> = { KICKOFF_RETURN, KR_LONG, KR_SHORT, KR_FUMBLE, KR_TD, KR_FOUL, KR_DEEP };
const NO_RETURN_KICKOFFS: Readonly<Record<string, PlayEvent>> = { KICKOFF_TOUCHBACK, KO_FAIR, KO_OOB, KO_SHORT, ONSIDE_KICKERS, ONSIDE_RECEIVERS };
const ALL_KICKOFFS = { ...RETURNS, ...NO_RETURN_KICKOFFS };
const R = Object.entries(RETURNS).map(([name, ev]) => ({ name, ev, r: partsOf(ev) }));
/** Returns long enough to cut (KR5, KR6 and KR7's direction apply). */
const CUTTING = R.filter((x) => x.r.returnYards >= T.cutMinReturnYards);

// ---------------------------------------------------------------- data

describe("kickReturn data (KR-Open 1: a required kickReturn block; motion.json is version 6 since the player-reactions schema changes)", () => {
  const NAMED = ["wallDepthYards", "setupYards", "laneSpreadYards", "engageYards", "behindToleranceYards", "whistleWindowMs", "upfieldYards", "cutYards", "cutMinReturnYards"];

  // Version 4 became 5 with the approved ratings.scrimmage block (docs/specs/m2-player-reactions.md, "Existing tests"), and 6 with ratings.scrimmage.stalk.clearYards.
  it("motion.json is version 6 with a kickReturn block holding every value the spec names, and kickoff unchanged", () => {
    expect(motionRaw["version"]).toBe(6);
    expect(typeof motionRaw["kickReturn"]).toBe("object");
    for (const k of NAMED) expect(typeof KRD[k], `kickReturn.${k}`).toBe("number");
    // The new keys live in their own block, not inside kickoff (routes-pace 1519 deep-equals kickoff).
    expect(Object.keys(motion.kickoff).sort()).toEqual(["apex", "approachMs", "hangBaseMs", "hangMaxMs", "hangPerYardMs", "onsideApex", "onsideMs"]);
  });

  it("the data sits inside the spec's floors (a value past a floor still can't loosen a check, but it says the data is off)", () => {
    expect(KRD["setupYards"]).toBeGreaterThanOrEqual(3);
    expect(KRD["behindToleranceYards"]).toBeLessThanOrEqual(1.0);
    expect(KRD["laneSpreadYards"]).toBeGreaterThanOrEqual(20);
    expect(KRD["whistleWindowMs"]).toBeLessThanOrEqual(500);
    expect(KRD["engageYards"]).toBeLessThanOrEqual(2.0);
    expect(KRD["cutYards"]).toBeGreaterThanOrEqual(4);
  });

  const without = (k: string, v: unknown): unknown => {
    const o = structuredClone(motionRaw);
    const kr = o["kickReturn"] as Record<string, unknown>;
    if (v === undefined) delete kr[k];
    else kr[k] = v;
    return o;
  };
  it("States: parseMotion refuses a file with no kickReturn block, or at version 5", () => {
    const o = structuredClone(motionRaw);
    delete o["kickReturn"];
    expect(() => parseMotion(o)).toThrow(MotionError);
    expect(() => parseMotion({ ...structuredClone(motionRaw), version: 5 })).toThrow(MotionError);
  });
  it.each(NAMED)("States (R-C13 gains the new keys): parseMotion refuses kickReturn.%s missing or not a number", (k) => {
    expect(() => parseMotion(without(k, undefined))).toThrow(MotionError);
    expect(() => parseMotion(without(k, "wide"))).toThrow(MotionError);
  });
});

// ---------------------------------------------------------------- fixtures are what they say

describe("the fixtures are the cases the spec names", () => {
  it("a return of 40 yd or more, long enough to cut; one shorter than cutMinReturnYards; a return fumble", () => {
    expect(partsOf(KR_LONG).returnYards).toBeGreaterThanOrEqual(40);
    expect(partsOf(KR_LONG).returnYards, "the long return must be one KR5 and KR6 apply to").toBeGreaterThanOrEqual(T.cutMinReturnYards);
    expect(partsOf(KR_SHORT).returnYards).toBeLessThan(T.cutMinReturnYards);
    expect(partsOf(KR_SHORT).returnYards).toBeGreaterThan(0);
    expect(partsOf(KR_FUMBLE).fumbled).toBe(true);
    for (const ev of Object.values(RETURNS)) expect(isReturn(ev)).toBe(true);
    for (const ev of Object.values(NO_RETURN_KICKOFFS)) expect(isReturn(ev)).toBe(false);
  });

  it("every return has ten blockers and coverage without the kicker or the tackler", () => {
    for (const { name, r } of R) {
      expect(r.blockers.length, name).toBe(name === "KR_FOUL" ? 9 : 10);
      expect(r.coverage.map((m) => m.playerId), name).not.toContain("H-K1");
      if (r.tackler !== undefined) expect(r.coverage.map((m) => m.playerId), name).not.toContain(r.tackler.playerId);
    }
  });
});

// ---------------------------------------------------------------- KR1

describe("KR1: facts unchanged", () => {
  it.each(Object.entries(ALL_KICKOFFS))("%s: A2, A3 (the ring), the anchors (N6), kickoffFrame = t 0 (AC 11), N1, N3 to N6", (_name, ev) => {
    expect(kr1(ev)).toEqual([]);
  });

  it.each(Object.entries(ALL_KICKOFFS))("%s: A1 and N7, two builds of the same event are deep-equal", (_name, ev) => {
    expect(tlOf(structuredClone(ev))).toEqual(tlOf(ev));
  });

  it("the return fumble: the recoverer holds the ball at the dead spot at the whistle (R9)", () => {
    const tl = tlOf(KR_FUMBLE);
    expect(tl.holder).toBe("H-CB1");
    const fin = at(tl.ball, tl.liveEnd);
    expect(fin.y).toBeCloseTo(72, 6);
    const rec = tl.marks.find((m) => m.playerId === "H-CB1");
    expect(Math.hypot(at(rec?.keys ?? [], tl.liveEnd).x - fin.x, at(rec?.keys ?? [], tl.liveEnd).y - fin.y)).toBeLessThan(1e-6);
    expect(tl.labels.map((l) => l.text).some((t) => t.startsWith("Fumble"))).toBe(true);
  });

  it("States: a return touchdown runs on the uniformly scaled clock, inside the live cap", () => {
    const tl = tlOf(KR_TD);
    expect(tl.liveEnd - tl.snapAt).toBeLessThanOrEqual(motion.live.maxMs + 1e-6);
    expect(at(tl.ball, tl.liveEnd).y).toBeCloseTo(-1, 6);
  });
});

// ---------------------------------------------------------------- KR2 to KR4

describe("KR2: setup during the hang", () => {
  it.each(R.map((x) => [x.name, x] as const))("%s: blockers set short of wallDepthYards gain setupYards (>= 3) toward the landing; none still > 300 ms", (_n, x) => {
    expect(kr2(x.r)).toEqual([]);
  });

  it("at least one blocker on KICKOFF_RETURN is set more than wallDepthYards short, so the gain rule is exercised", () => {
    const r = partsOf(KICKOFF_RETURN);
    expect(r.blockers.filter((b) => r.land.y - at(b.keys, r.tl.snapAt).y > T.wallDepthYards).length).toBeGreaterThan(0);
  });
});

describe("KR3: the wall at the catch", () => {
  it.each(R.map((x) => [x.name, x] as const))("%s: no blocker behind the returner by more than behindToleranceYards (<= 1.0); x span >= laneSpreadYards (>= 20)", (_n, x) => {
    expect(kr3(x.r)).toEqual([]);
  });
});

describe("KR4: lead the return", () => {
  it.each(R.map((x) => [x.name, x] as const))("%s: catch to whistle - whistleWindowMs (to the fumble), every blocker leads or is engaged", (_n, x) => {
    expect(kr4(x.r)).toEqual([]);
  });
});

// ---------------------------------------------------------------- KR5, KR6

describe("KR5: blocks happen", () => {
  it("there are fixtures long enough for KR5 and KR6 to apply", () => {
    expect(CUTTING.map((x) => x.name)).toContain("KR_LONG");
  });
  it.each(R.map((x) => [x.name, x] as const))("%s: half the blockers engaged 300 ms+ with distinct coverage; never the tackler; nobody drawn winning", (_n, x) => {
    expect(kr5(x.r)).toEqual([]);
  });
});

describe("KR6: the returner cuts", () => {
  it.each(R.map((x) => [x.name, x] as const))("%s: upfield within 20 degrees for upfieldYards, then a 25 degree turn; x off the catch by cutYards (>= 4); arcs flagged; inside the sidelines", (_n, x) => {
    expect(kr6(x.r)).toEqual([]);
  });
});

// ---------------------------------------------------------------- KR7

describe("KR7: he cuts toward the blocks, deterministically, with no leak", () => {
  it("two builds of the same event give identical keys", () => {
    for (const ev of Object.values(RETURNS)) expect(tlOf(structuredClone(ev)).marks.map((m) => m.keys)).toEqual(tlOf(ev).marks.map((m) => m.keys));
  });

  it("events that differ only in the dead spot, the tackler or the result give identical returner and blocker positions from the kick to the catch", () => {
    const d = KICKOFF_RETURN.play.detail as { participants: Record<string, string> };
    const variants: [string, PlayEvent][] = [
      ["dead spot 65", krReturn(65)],
      ["dead spot 80", krReturn(80)],
      ["tackler H-CB1", { ...KICKOFF_RETURN, play: { ...KICKOFF_RETURN.play, detail: { ...d, participants: { ...d.participants, tackler: "H-CB1" } } } as PlayEvent["play"] }],
      // A fumble at 60: its live time stays under the cap, so the clock isn't rescaled (at 72 it reaches the cap).
      ["result: a return fumble", { ...KR_FUMBLE, play: { ...KR_FUMBLE.play, end: { spot: 60, possession: "offense" }, detail: { ...(KR_FUMBLE.play.detail as Record<string, unknown>), fumbleSpot: 60 } } as PlayEvent["play"] }],
      ["result: a return touchdown", { ...KR_TD, play: { ...KR_TD.play, end: { spot: 72, possession: "defense" } } as PlayEvent["play"] }],
    ];
    const base = partsOf(KICKOFF_RETURN);
    const ids = [base.returner.playerId, ...base.blockers.map((b) => b.playerId)];
    for (const [label, v] of variants) {
      const r = partsOf(v);
      // The live time scale must match, or the uniform scaling (not a leak) moves the hang.
      expect(r.returner.nat?.k, `${label}: same time scale`).toBe(base.returner.nat?.k);
      expect(r.kickT, label).toBe(base.kickT);
      expect(r.catchT, label).toBe(base.catchT);
      const bad: string[] = [];
      for (const id of ids) {
        const a = base.tl.marks.find((m) => m.playerId === id);
        const b = r.tl.marks.find((m) => m.playerId === id);
        for (let t = 0; t <= base.catchT + 1e-9; t += 25) {
          const p = at(a?.keys ?? [], t);
          const q = at(b?.keys ?? [], t);
          if (Math.hypot(p.x - q.x, p.y - q.y) > 1e-9) {
            bad.push(`${label}: ${a?.slot ?? id} differs by ${Math.hypot(p.x - q.x, p.y - q.y).toFixed(4)} yd at ${t} ms`);
            break;
          }
        }
      }
      expect(bad).toEqual([]);
    }
  });

  // Results that change only on the return team (coordinator, 2026-11-15): the return unit and the
  // returner must not know them before the catch either. The named man is a blocker in the base.
  it.each([
    ["a return-team fouler (holding on the return, foulers: [A-LB2])", (): PlayEvent => withReturnFouler(KICKOFF_RETURN, "A-LB2")],
    ["a return-team fumble recovery (A-S1 fumbles at 72, A-WR1 recovers)", (): PlayEvent => withReturnTeamRecovery(KICKOFF_RETURN, "A-WR1")],
  ] as const)("no leak, return-team result: %s gives the return unit's and the returner's keys from t = 0 to the catch identical to KICKOFF_RETURN", (label, make) => {
    const v = make();
    const parts = readDetail(v.play).participants ?? {};
    // The variant is what it says: the named man is a return-unit player who isn't the returner.
    const named = (parts.foulers ?? [])[0] ?? parts.fumbleRecoverer;
    expect(named).toMatch(/^A-/);
    expect(named).not.toBe(parts.returner);
    expect(returnUnitSameToCatch(partsOf(KICKOFF_RETURN), partsOf(v), label)).toEqual([]);
  });

  it.each(CUTTING.map((x) => [x.name, x] as const))("%s: the first cut points to the side with more engaged blockers", (_n, x) => {
    const res = kr7Direction(x.r);
    expect(firstCut(x.r), "a cut to check").not.toBeNull();
    expect(res.bad).toEqual([]);
  });
});

// ---------------------------------------------------------------- KR8

describe("KR8: unchanged where there is no return", () => {
  it("the digest sees a change (self-check: a different punt hang changes the punt's digest)", () => {
    const moved = { ...ctx, motion: { ...motion, punt: { ...motion.punt, hangBaseMs: motion.punt.hangBaseMs + 100 } } };
    expect(digestOf(tlOf(PUNT_RETURNED, moved))).not.toEqual(digestOf(tlOf(PUNT_RETURNED)));
    expect(digestOf(tlOf(FAIR_CATCH))).toEqual(digestOf(tlOf(FAIR_CATCH)));
  });

  it("touchbacks, fair catches, kicks out of bounds, onside kicks and every punt: keys identical to the build before this pass", { timeout: 120_000 }, () => {
    const now = kr8Digest();
    const was = baseline as Record<string, Record<string, string>>;
    expect(Object.keys(now).sort()).toEqual(Object.keys(was).sort());
    const bad: string[] = [];
    for (const [play, marks] of Object.entries(was))
      for (const [mark, h] of Object.entries(marks)) if (now[play]?.[mark] !== h) bad.push(`${play}: ${mark} changed`);
    expect(bad).toEqual([]);
  });

  it("a return shorter than cutMinReturnYards doesn't need to cut but keeps KR2 to KR4", () => {
    const r = partsOf(KR_SHORT);
    expect(kr6(r)).toEqual([]);
    expect(kr5(r)).toEqual([]);
    expect([...kr2(r), ...kr3(r), ...kr4(r)]).toEqual([]);
  });

  it("a return fumble: KR4, KR6 and KR9 run up to the fumble; after it the recoverer gets the ball (R9)", () => {
    const r = partsOf(KR_FUMBLE);
    expect(r.carryEnd).toBeLessThan(r.whistle);
    expect(r.carryEnd).toBeGreaterThan(r.catchT);
    expect([...kr4(r), ...kr6(r), ...kr9(r)]).toEqual([]);
    const parts = readDetail(KR_FUMBLE.play).participants ?? {};
    expect(r.tl.holder).toBe(parts.fumbleRecoverer);
  });
});

// ---------------------------------------------------------------- KR9

describe("KR9: coverage keeps out of the carrier's corridor", () => {
  it.each(R.map((x) => [x.name, x] as const))("%s: every coverage mark >= corridorHalfYards (>= 2.0) from the carrier's next corridorMs (>= 1,000) of path", (_n, x) => {
    expect(kr9(x.r)).toEqual([]);
  });

  it("only the engine's tackler comes to the ball", () => {
    for (const { name, r } of R) {
      if (r.tackler === undefined) continue;
      const fin = at(r.tl.ball, r.whistle);
      const pos = at(r.tackler.keys, r.whistle);
      expect(Math.hypot(pos.x - fin.x, pos.y - fin.y), name).toBeLessThan(1e-6);
    }
  });
});

// ---------------------------------------------------------------- all at once (for the report)

describe("summary", () => {
  it("every check on every return fixture (one list, for the report)", () => {
    const out: string[] = [];
    for (const { name, ev } of R) for (const [k, v] of Object.entries(allChecks(ev))) if (v.length > 0) out.push(`${name} ${k}: ${v.length} (${v[0] ?? ""})`);
    if (out.length > 0) console.log(`[kickoff-return] failures:\n${out.join("\n")}`);
    expect(out).toEqual([]);
  });
});

// ---------------------------------------------------------------- the checks can fail

describe("the KR checks catch what they are for (each on a timeline broken on purpose)", () => {
  type TL = ReturnType<typeof tlOf>;
  const moved = (tl: TL, ids: readonly string[], f: (k: { t: number; x: number; y: number }) => { x: number; y: number }): TL => ({
    ...tl,
    marks: tl.marks.map((m) => (ids.includes(m.playerId) ? { ...m, keys: m.keys.map((k) => ({ ...k, ...f(k) })) } : m)),
  });
  const base = partsOf(KR_LONG);

  it("KR2 and KR3: a blocker left standing at his set spot stays still through the hang and ends behind the wall", () => {
    const b = base.blockers.find((m) => base.land.y - at(m.keys, base.tl.snapAt).y > T.wallDepthYards) ?? base.blockers[0];
    const set = at(b?.keys ?? [], base.tl.snapAt);
    const r = partsOf(KR_LONG, moved(base.tl, [b?.playerId ?? ""], (k) => (k.t >= base.tl.snapAt ? set : k)));
    expect(kr2(r).length).toBeGreaterThan(0);
  });

  it("KR3: a blocker 5 yd behind the returner at the catch, and a wall bunched in the middle", () => {
    const b = base.blockers[0]?.playerId ?? "";
    expect(kr3(partsOf(KR_LONG, moved(base.tl, [b], (k) => ({ x: k.x, y: at(base.returner.keys, k.t).y + 5 }))))).not.toEqual([]);
    const all = base.blockers.map((m) => m.playerId);
    expect(kr3(partsOf(KR_LONG, moved(base.tl, all, (k) => ({ x: 26.65 + (k.x - 26.65) * 0.3, y: k.y }))))).not.toEqual([]);
  });

  it("KR4: a blocker who trails the returner by 3 yd after the catch", () => {
    const b = base.blockers[0]?.playerId ?? "";
    expect(kr4(partsOf(KR_LONG, moved(base.tl, [b], (k) => (k.t >= base.catchT ? { x: at(base.returner.keys, k.t).x + 6, y: at(base.returner.keys, k.t).y + 3 } : k))))).not.toEqual([]);
  });

  it("KR6: a returner who runs one straight line from the landing to the dead spot", () => {
    const end = at(base.returner.keys, base.whistle);
    const span = base.whistle - base.catchT;
    const straight = moved(base.tl, [base.returner.playerId], (k) => (k.t <= base.catchT ? k : { x: base.land.x + ((end.x - base.land.x) * Math.min(1, (k.t - base.catchT) / span)), y: base.land.y + (end.y - base.land.y) * Math.min(1, (k.t - base.catchT) / span) }));
    expect(kr6(partsOf(KR_LONG, straight))).not.toEqual([]);
  });

  it("KR7: the same return with the returner's cut mirrored goes away from the blocks", () => {
    // KICKOFF_RETURN: blockers are engaged on both sides at his first cut, unevenly, so the rule decides (no tie).
    const kr = partsOf(KICKOFF_RETURN);
    const res = kr7Direction(kr);
    expect(res.tie, "KICKOFF_RETURN's first cut is not a tie, so the rule is exercised").toBe(false);
    expect(res.bad).toEqual([]);
    const cx = kr.catchPt.x;
    const flip = (k: { t: number; x: number; y: number }): { x: number; y: number } => (k.t <= kr.catchT ? k : { x: 2 * cx - k.x, y: k.y });
    const m0 = moved(kr.tl, [kr.returner.playerId], flip);
    // The ball goes with him, so he still holds it.
    const mirrored = partsOf(KICKOFF_RETURN, { ...m0, ball: m0.ball.map((k) => ({ ...k, ...flip(k) })) });
    const m = kr7Direction(mirrored);
    expect(m.dir).toBe(-(res.dir ?? 0));
    if (!m.tie) expect(m.bad).not.toEqual([]);
  });

  it("KR9: a coverage man who runs to the carrier", () => {
    const c = base.coverage[0]?.playerId ?? "";
    expect(kr9(partsOf(KR_LONG, moved(base.tl, [c], (k) => (k.t >= base.catchT ? { x: at(base.returner.keys, k.t).x + 1, y: at(base.returner.keys, k.t).y - 0.5 } : k))))).not.toEqual([]);
  });

  it("KR5: blockers that never come near the coverage", () => {
    const all = base.blockers.map((m) => m.playerId);
    expect(kr5(partsOf(KR_LONG, moved(base.tl, all, (k) => (k.t >= base.catchT ? { x: k.x, y: at(base.returner.keys, k.t).y - 0.5 } : k))))).not.toEqual([]);
  });
});
