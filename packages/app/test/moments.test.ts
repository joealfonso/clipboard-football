// Engineer's tests for chunk 3 of the "Prime Time" revision (DESIGN.md Build order item 3): the
// moments. Which moment a committed play fires and its words, the hold rule, the banner's motion
// and place, the chips, the quarter-end line score, the data block in motion.json and the tokens.
// Values are typed in from DESIGN.md (Motion: Moments, banner anatomy; Tokens). test-writer's spec
// tests are separate.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { drawFrame, viewOf, type FrameOpts } from "../src/ui/field";
import { cameraAt, layoutFor, playStage } from "../src/ui/layout";
import { BANNER_STILL, bannerBox, bannerCovers, bannerPose, bigPlayCount, lineScore, momentEnd, playMoment, type MomentCtx, type Moments } from "../src/ui/moments";
import { MotionError, parseMotion, parseTemplates } from "../src/ui/templates";
import { timeline } from "../src/ui/timeline";
import { newFirstDown, playEnd, playStood } from "../src/ui/topbar";
import { BUG_MOTION, COLOR, DUR, EASE, ease } from "../src/ui/tokens";
import { uiDataOf } from "../src/engine/session";
import type { PlayEvent } from "../src/engine/types";
import { COMPLETE, FIELD_GOAL_GOOD, FIELD_GOAL_MISS, FUMBLE_LOST, INTERCEPTION, KICKOFF_RETURN, PUNT_RETURNED, RUN, TOUCHDOWN, snap } from "./fixtures";
import { playGame, prepared } from "./support";

const root = join(import.meta.dirname, "../../..");
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));
const rawMotion = readJson("data/ui/motion.json") as Record<string, unknown>;
const motion = parseMotion(rawMotion);
const templates = parseTemplates(readJson("data/ui/templates.json"));
const personnel = readJson("data/engine/personnel.json") as { presetPackage: Record<string, string> };
const rules = uiDataOf(prepared(), null, null).rules;
const css = readFileSync(join(import.meta.dirname, "../src/styles.css"), "utf8");

const teams = { home: { nickname: "Outriders" }, away: { nickname: "Cranes" } };
const ctx: MomentCtx = { teams, human: "home", endZoneYards: 10, penalties: rules.penalties, moments: motion.moments };

// ---------------------------------------------------------------- data and tokens

describe("motion.json moments and the chunk 3 tokens", () => {
  it("the designed defaults: holds 1800 / 1400 / 1400 / 1200 / 1400 / 900 ms, big play at 20 yards, a 900 ms first-down flash", () => {
    const m: Moments = motion.moments;
    expect([m.touchdown.minHoldMs, m.fieldGoal.minHoldMs, m.safety.minHoldMs, m.twoPoint.minHoldMs, m.turnover.minHoldMs, m.bigPlay.minHoldMs]).toEqual([1800, 1400, 1400, 1200, 1400, 900]);
    expect(m.bigPlay.minYards).toBe(20);
    expect(m.firstDown.flashMs).toBe(900);
    // The CSS and token mirrors of the flash stay equal to the data value.
    expect(BUG_MOTION.firstDownFlash).toBe(m.firstDown.flashMs);
    expect(css).toContain(`--first-down-flash: ${m.firstDown.flashMs}ms;`);
  });

  it("a missing or bad moments block fails loading with the file named", () => {
    const { moments: _drop, ...rest } = rawMotion;
    void _drop;
    expect(() => parseMotion(rest)).toThrow(MotionError);
    expect(() => parseMotion({ ...rawMotion, moments: { ...(rawMotion["moments"] as object), touchdown: { minHoldMs: -1 } } })).toThrow(/moments\.touchdown\.minHoldMs/);
    expect(() => parseMotion({ ...rawMotion, moments: { ...(rawMotion["moments"] as object), bigPlay: { minHoldMs: 900 } } })).toThrow(/moments\.bigPlay\.minYards/);
  });

  it("tokens: color.bannerStrip, dur.snap 320, dur.wipe 220, ease.slam and ease.exit, mirrored in :root", () => {
    expect(COLOR.bannerStrip).toBe("rgba(18, 34, 63, 0.96)");
    expect([DUR.snap, DUR.wipe]).toEqual([320, 220]);
    expect(EASE.slam).toEqual([0.05, 0.7, 0.1, 1]);
    expect(EASE.exit).toEqual([0.4, 0, 1, 1]);
    for (const line of ["--banner-strip: rgba(18, 34, 63, 0.96);", "--dur-snap: 320ms;", "--dur-wipe: 220ms;", "--ease-slam: cubic-bezier(0.05, 0.7, 0.1, 1);", "--ease-exit: cubic-bezier(0.4, 0, 1, 1);"]) expect(css).toContain(line);
  });

  it("ease() follows the curve: 0 and 1 at the ends, monotonic, never past 1 (no overshoot)", () => {
    for (const c of Object.values(EASE)) {
      expect(ease(c, 0)).toBe(0);
      expect(ease(c, 1)).toBe(1);
      let last = 0;
      for (let f = 0.05; f < 1; f += 0.05) {
        const y = ease(c, f);
        expect(y).toBeGreaterThanOrEqual(last - 1e-9);
        expect(y).toBeLessThanOrEqual(1);
        last = y;
      }
    }
    // ease.slam is fast in: well past half way at a quarter of the time.
    expect(ease(EASE.slam, 0.25)).toBeGreaterThan(0.6);
  });

  it("banner text contrast: the outline color on each team fill, under the sheen's brightest pixel, keeps 3:1 (large text)", async () => {
    const { SWATCHES, TEAM_OUTLINE } = await import("../src/ui/tokens");
    const { blend, contrast, rgbOf } = await import("../src/ui/overlay");
    SWATCHES.forEach((fill, i) => {
      const lit = blend(rgbOf("#FFFFFF"), rgbOf(fill), 0.05);
      expect(contrast(rgbOf(TEAM_OUTLINE[i] as string), lit), fill).toBeGreaterThanOrEqual(4.5);
    });
    // Sub line: chalk on color.bannerStrip over any turf.
    for (const turf of [COLOR.turf, COLOR.turfStripe]) expect(contrast(rgbOf(COLOR.chalk), blend(rgbOf(COLOR.surfaceSolid), rgbOf(turf), 0.96))).toBeGreaterThanOrEqual(14 - 0.5);
  });
});

// ---------------------------------------------------------------- which moment

const withAfter = (ev: PlayEvent, after: Partial<PlayEvent["after"]>, before: Partial<PlayEvent["before"]> = {}): PlayEvent => ({ ...ev, before: { ...ev.before, ...before }, after: { ...ev.after, ...after } });

describe("playMoment: each moment fires only from the committed result", () => {
  it("touchdown: the scoring team's banner, sub line with the scoring team first", () => {
    const m = playMoment(TOUCHDOWN, ctx);
    expect(m.banner).toEqual({ kind: "touchdown", team: "home", word: "TOUCHDOWN", sub: "Outriders 13, Cranes 3" });
    expect(m.firstDown).toBe(false);
    expect(m.bigPlay).toBeNull();
    expect(m.minHoldMs).toBe(1800);
  });

  it("a pick six shows the touchdown banner, for the defense", () => {
    const pick6 = withAfter(INTERCEPTION, { phase: "try", score: { home: 7, away: 9 } });
    const m = playMoment(pick6, ctx);
    expect(m.banner?.kind).toBe("touchdown");
    expect(m.banner?.team).toBe("away");
    expect(m.banner?.sub).toBe("Cranes 9, Outriders 7");
  });

  it("field goal: '47 yds.' from the kick spot, the kicking team first", () => {
    const m = playMoment(FIELD_GOAL_GOOD, ctx);
    expect(m.banner).toEqual({ kind: "fieldGoal", team: "home", word: "FIELD GOAL", sub: "47 yds. Outriders 10, Cranes 3" });
    expect(m.minHoldMs).toBe(1400);
    expect(playMoment(FIELD_GOAL_MISS, ctx).banner).toBeNull();
  });

  it("turnovers: the kind the result names, else TURNOVER; the team that gains the ball; where it is", () => {
    expect(playMoment(INTERCEPTION, ctx).banner).toEqual({ kind: "turnover", team: "away", word: "INTERCEPTION", sub: "Cranes ball at OPP 48" });
    expect(playMoment(FUMBLE_LOST, ctx).banner?.word).toBe("FUMBLE");
    const lost = FUMBLE_LOST.play;
    if (lost.kind !== "run") throw new Error("fixture");
    const plain: PlayEvent = { ...FUMBLE_LOST, play: { kind: lost.kind, seconds: lost.seconds, end: lost.end, ...(lost.detail === undefined ? {} : { detail: lost.detail }) } };
    expect(playMoment(plain, ctx).banner?.word).toBe("TURNOVER");
    expect(playMoment(INTERCEPTION, ctx).minHoldMs).toBe(1400);
  });

  it("turnover on downs: 4th down, the offense keeps the ball and the other team takes over", () => {
    const tod = withAfter(RUN, { possession: "away", spot: 56, down: 1, distance: 10 }, { down: 4, distance: 6 });
    expect(playMoment(tod, ctx).banner?.word).toBe("TURNOVER ON DOWNS");
  });

  it("normal punts and kickoffs are not turnovers; a plain completion has no banner", () => {
    expect(playMoment(PUNT_RETURNED, ctx).banner).toBeNull();
    expect(playMoment(KICKOFF_RETURN, ctx).banner).toBeNull();
    expect(playMoment(COMPLETE, ctx).banner).toBeNull();
  });

  it("a kick the receivers lose (end.possession: the kickers) is a TURNOVER for the kicking team, no kind named", () => {
    const muff: PlayEvent = { ...PUNT_RETURNED, play: { ...(PUNT_RETURNED.play as Extract<PlayEvent["play"], { kind: "punt" }>), end: { spot: 70, possession: "offense" } }, after: { ...PUNT_RETURNED.after, possession: "home", spot: 70, down: 1, distance: 10 } };
    expect(playMoment(muff, ctx).banner).toEqual({ kind: "turnover", team: "home", word: "TURNOVER", sub: "Outriders ball at OPP 30" });
    const lost: PlayEvent = { ...KICKOFF_RETURN, play: { ...(KICKOFF_RETURN.play as Extract<PlayEvent["play"], { kind: "kickoff" }>), end: { spot: 75, possession: "offense" } }, after: { ...KICKOFF_RETURN.after, phase: "scrimmage", possession: "home", spot: 75, down: 1, distance: 10 } };
    expect(playMoment(lost, ctx).banner?.word).toBe("TURNOVER");
    // A punt that never reached the receivers stays theirs to lose: no banner for a blocked kick the kickers fall on.
    const blocked: PlayEvent = { ...muff, play: { ...(muff.play as Extract<PlayEvent["play"], { kind: "punt" }>), crossedLine: false, touchedByReceivers: false } };
    expect(playMoment(blocked, ctx).banner).toBeNull();
    // The kickers fall on the muff, but an accepted foul gives the ball back to the receivers: not a turnover.
    const fouled: PlayEvent = { ...muff, after: { ...muff.after, possession: "away" } };
    expect(playMoment(fouled, ctx).banner).toBeNull();
  });

  it("safety and two-point try", () => {
    const sfty = withAfter(RUN, { phase: "kickoff", safetyKick: true, score: { home: 7, away: 5 } });
    expect(playMoment(sfty, ctx).banner).toMatchObject({ kind: "safety", team: "away", word: "SAFETY", sub: "Cranes 5, Outriders 7" });
    const two: PlayEvent = { ...TOUCHDOWN, play: { kind: "twoPoint", seconds: 0, end: { spot: 100, possession: "offense" } }, before: snap({ phase: "try", score: { home: 13, away: 3 } }), after: snap({ phase: "kickoff", score: { home: 15, away: 3 } }) };
    expect(playMoment(two, ctx).banner).toMatchObject({ kind: "twoPoint", word: "TWO-POINT GOOD", sub: "Outriders 15, Cranes 3" });
    expect(playMoment(two, ctx).minHoldMs).toBe(1200);
  });

  it("first down: the existing newFirstDown rule; big play: a gain from scrimmage of 20 or more that did not score", () => {
    expect(playMoment(COMPLETE, ctx)).toEqual({ banner: null, firstDown: true, bigPlay: null, minHoldMs: 0 });
    const big = { ...COMPLETE, play: { ...COMPLETE.play, end: { spot: 74, possession: "offense" }, detail: { ...(COMPLETE.play.detail ?? {}), yards: 34 } }, after: { ...COMPLETE.after, spot: 74 } } as PlayEvent;
    const m = playMoment(big, ctx);
    expect(m.bigPlay).toBe(34);
    expect(m.firstDown).toBe(true);
    expect(m.minHoldMs).toBe(900);
    const short = { ...big, play: { ...big.play, detail: { ...(big.play.detail ?? {}), yards: 19 } }, after: { ...big.after, spot: 59 } } as PlayEvent;
    expect(playMoment(short, ctx).bigPlay).toBeNull();
  });

  it("over three simulated games: at most one banner, a banner suppresses the chips, every moment matches the committed fields", () => {
    let banners = 0;
    let chips = 0;
    for (const seed of [3, 11, 29]) {
      const g = playGame(seed, "home");
      const first = g.sent[0];
      const matchup = first !== undefined && first.t === "step" ? first.matchup : null;
      const c: MomentCtx = { ...ctx, teams: matchup ?? teams };
      for (const e of g.events) {
        if (e.t !== "play") continue;
        const m = playMoment(e, c);
        const off = e.before.possession;
        const scoreUp = (t: "home" | "away") => e.after.score[t] - e.before.score[t];
        if (m.banner !== null) {
          banners++;
          expect(m.firstDown).toBe(false);
          expect(m.bigPlay).toBeNull();
          expect(m.minHoldMs).toBe(motion.moments[m.banner.kind].minHoldMs);
          if (m.banner.kind === "touchdown") expect(scoreUp(m.banner.team)).toBeGreaterThanOrEqual(6);
          // A turnover changes possession, or (a kick) the kickers hold the ball the receivers lost.
          if (m.banner.kind === "turnover") expect(e.after.possession !== off || (e.play.kind === "punt" || e.play.kind === "kickoff")).toBe(true);
          if (m.banner.kind === "fieldGoal") expect(e.play.kind).toBe("fieldGoal");
        } else {
          expect(m.firstDown).toBe(newFirstDown(e.before, e.after, { kind: e.play.kind, stood: playStood(e, rules.penalties), endSpot: playEnd(e.play) }));
          if (m.bigPlay !== null) {
            chips++;
            expect(m.bigPlay).toBeGreaterThanOrEqual(20);
            expect(scoreUp("home") + scoreUp("away")).toBe(0);
          }
          if (scoreUp(off) >= 6 && !["extraPoint", "twoPoint", "fieldGoal"].includes(e.play.kind)) throw new Error("a touchdown without its banner");
        }
      }
    }
    expect(banners).toBeGreaterThan(5);
    expect(chips).toBeGreaterThan(0);
  }, 60000);
});

// ---------------------------------------------------------------- hold, pose, place

describe("the hold, the banner's motion and its place", () => {
  it("the hold is the larger of the play's own and the moment's minimum from the whistle", () => {
    const tl = { liveEnd: 3000, total: 3800 };
    expect(momentEnd(tl, playMoment(TOUCHDOWN, ctx))).toBe(4800);
    expect(momentEnd({ liveEnd: 3000, total: 5500 }, playMoment(TOUCHDOWN, ctx))).toBe(5500);
    expect(momentEnd(tl, playMoment(RUN, ctx))).toBe(3800);
  });

  it("in: wipe from the left over dur.wipe, the word at 120 ms for 200 ms (scale 1.15 to 1), the sub at 320 ms; out: the hold's last dur.wipe", () => {
    const hold = 1800;
    expect(bannerPose(0, hold)).toMatchObject({ left: 0, right: 0, wordAlpha: 0 });
    expect(bannerPose(DUR.wipe, hold).right).toBe(1);
    expect(bannerPose(119, hold).wordAlpha).toBe(0);
    expect(bannerPose(120, hold).wordScale).toBeCloseTo(1.15, 6);
    expect(bannerPose(320, hold)).toMatchObject({ wordAlpha: 1, wordScale: 1, subAlpha: 0, subLift: 8 });
    expect(bannerPose(320 + DUR.base, hold)).toMatchObject({ subAlpha: 1, subLift: 0 });
    expect(bannerPose(hold - DUR.wipe, hold).left).toBe(0);
    expect(bannerPose(hold - DUR.wipe / 2, hold).left).toBeGreaterThan(0);
    expect(bannerPose(hold, hold).left).toBe(1);
    expect(BANNER_STILL).toEqual({ left: 0, right: 1, wordAlpha: 1, wordScale: 1, subAlpha: 1, subLift: 0 });
  });

  it("the banner is min(column - 48, 720) wide, 112 + 36 tall (88 under a 600 px column), on the half away from the ball", () => {
    const wide = bannerBox({ left: 100, width: 734 }, 656, 500);
    expect(wide.w).toBe(686);
    expect(wide.x).toBe(124);
    expect(wide.blockH + wide.stripH).toBe(148);
    expect(wide.y + 74).toBeCloseTo(0.3 * 656, 6);
    const top = bannerBox({ left: 0, width: 1132 }, 1000, 100);
    expect(top.w).toBe(720);
    expect(top.y + 74).toBeCloseTo(700, 6);
    expect(bannerBox({ left: 0, width: 560 }, 500, 400).blockH).toBe(88);
  });

  it("the carrier and the tackler are kept clear too; if no slot clears all three, the ball wins", () => {
    // Ball low (30% slot), tackler inside that slot: the banner moves to 70%, clear of both.
    const b = bannerBox({ left: 0, width: 734 }, 1000, 900, [300], 14);
    expect(b.y + 74).toBeCloseTo(700, 6);
    // Ball low, people in both slots: the ball's slot stays (it clears the ball).
    const c = bannerBox({ left: 0, width: 734 }, 1000, 900, [300, 700], 14);
    expect(c.y + 74).toBeCloseTo(300, 6);
  });

  it("the big-play chip counts from +0 to the gain over 500 ms", () => {
    expect(bigPlayCount(34, 0)).toBe(0);
    expect(bigPlayCount(34, 250)).toBeGreaterThan(17);
    expect(bigPlayCount(34, 500)).toBe(34);
    expect(bigPlayCount(34, Infinity)).toBe(34);
  });

  it("the score words a banner says are not drawn again as tags", () => {
    expect(bannerCovers("after.score", "Touchdown")).toBe(true);
    expect(bannerCovers("good", "Field goal good")).toBe(true);
    expect(bannerCovers("good", "No good")).toBe(false);
    expect(bannerCovers("turnover", "Interception")).toBe(false);
  });
});

// ---------------------------------------------------------------- what the field draws

interface Op {
  readonly op: string;
  readonly fill: unknown;
  readonly text?: string;
}
function recorder(): { g: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = [];
  const state: Record<string, unknown> = { fillStyle: "#000", strokeStyle: "#000", font: "10px sans-serif", globalAlpha: 1, lineWidth: 1 };
  const g = new Proxy(state, {
    get(t, k: string) {
      if (k === "measureText") return (s: string) => ({ width: s.length * 7 });
      if (k === "createLinearGradient" || k === "createRadialGradient") return () => ({ addColorStop: () => undefined });
      if (k === "fillText") return (s: string) => ops.push({ op: "fillText", fill: t["fillStyle"], text: String(s) });
      if (k === "fill" || k === "fillRect" || k === "stroke") return () => ops.push({ op: k, fill: t["fillStyle"] });
      if (k in t) return t[k];
      return () => undefined;
    },
    set(t, k: string, v: unknown) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { g, ops };
}

describe("fx.score / fx.turnover banners and fx.firstDown / fx.bigPlay chips on the field", () => {
  const l = layoutFor(1280, 720, templates.field);
  const view = (los: number) => viewOf({ ...l, column: playStage(l, 1).column }, cameraAt(los, l.visibleYards, templates.field.losFromTop));
  const tlOf = (ev: PlayEvent) => timeline({ event: ev, runoffSeconds: 0 }, templates, { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: l.s, markPx: l.markPx, motion });
  const opts: FrameOpts = { numbers: {}, ratings: {}, labelContent: "number", focused: null, markLabels: "none", routeAlpha: 0.4, textScale: 1 };

  it("a touchdown draws the banner (word in the outline color on the team fill, sub on bannerStrip) and no Touchdown tag", () => {
    const tl = tlOf(TOUCHDOWN);
    const v = view(TOUCHDOWN.before.spot);
    const m = playMoment(TOUCHDOWN, ctx);
    const r = recorder();
    drawFrame(r.g, v, tl, tl.total, { ...opts, moment: { moment: m, ink: { fill: "#C62F2F", ring: COLOR.line }, bt: 0, holdMs: m.minHoldMs, still: true } });
    const word = r.ops.find((o) => o.text === "TOUCHDOWN");
    expect(word?.fill).toBe(COLOR.line);
    expect(r.ops.some((o) => o.op === "fill" && o.fill === "#C62F2F")).toBe(true);
    expect(r.ops.some((o) => o.op === "fill" && o.fill === COLOR.bannerStrip)).toBe(true);
    expect(r.ops.find((o) => o.text === "Outriders 13, Cranes 3")?.fill).toBe(COLOR.chalk);
    expect(r.ops.some((o) => o.text === "Touchdown")).toBe(false);
  });

  it("without a moment the old score label is a tag, never a toast; nothing is drawn before the whistle", () => {
    const tl = tlOf(TOUCHDOWN);
    const v = view(TOUCHDOWN.before.spot);
    const r = recorder();
    drawFrame(r.g, v, tl, tl.total, opts);
    expect(r.ops.some((o) => o.text === "Touchdown")).toBe(true);
    expect(r.ops.some((o) => o.text === "TOUCHDOWN")).toBe(false);
    expect(r.ops.some((o) => o.fill === COLOR.surfaceSolid)).toBe(false);
    const m = playMoment(TOUCHDOWN, ctx);
    const early = recorder();
    drawFrame(early.g, v, tl, tl.liveEnd - 1, { ...opts, moment: { moment: m, ink: null, bt: 0, holdMs: m.minHoldMs, still: false } });
    expect(early.ops.some((o) => o.text === "TOUCHDOWN")).toBe(false);
  });

  it("chips: 'FIRST DOWN' in ink on a signal pill, '+34' in chalk on a tag pill, after the whistle", () => {
    const big = { ...COMPLETE, play: { ...COMPLETE.play, end: { spot: 74, possession: "offense" }, detail: { ...(COMPLETE.play.detail ?? {}), yards: 34 } }, after: { ...COMPLETE.after, spot: 74 } } as PlayEvent;
    const tl = tlOf(big);
    const v = view(big.before.spot);
    const m = playMoment(big, ctx);
    const r = recorder();
    drawFrame(r.g, v, tl, tl.total, { ...opts, moment: { moment: m, ink: null, bt: 0, holdMs: m.minHoldMs, still: true } });
    expect(r.ops.find((o) => o.text === "FIRST DOWN")?.fill).toBe(COLOR.ink);
    expect(r.ops.find((o) => o.text === "+34")?.fill).toBe(COLOR.chalk);
    expect(r.ops.some((o) => o.op === "fill" && o.fill === COLOR.signal)).toBe(true);
  });
});

// ---------------------------------------------------------------- the quarter-end line score

describe("hud.lineScore: points by quarter from the committed events", () => {
  it("over a simulated game the quarters add up to the final score", () => {
    const g = playGame(7, "home");
    const box = lineScore(g.events, 4);
    const finalScore = g.state?.score ?? { home: 0, away: 0 };
    const ot = g.events.some((e) => e.t === "play" && e.before.period > 4);
    if (!ot) for (const t of ["home", "away"] as const) expect(box[t].reduce((a, b) => a + b, 0)).toBe(finalScore[t]);
    expect(box.home).toHaveLength(4);
  }, 60000);
});
