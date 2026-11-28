// Moments (DESIGN.md Motion, Moments, Prime Time): short motion graphics that mark a change the
// engine made. Pure: which moment a committed play event fires, its words, how long it holds the
// whistle frame, where its banner sits and how far along each part of it is at a time. Nothing
// here decides anything about the play: every field read is the PlayEvent the loop committed.

import type { PlayEvent, Team } from "../engine/types";
import { gainOf, other, yardLineText } from "./text";
import { newFirstDown, playEnd, playStood } from "./topbar";
import type { Moments } from "./templates";
import { DUR, EASE, ease } from "./tokens";

// ---------------------------------------------------------------- data (data/ui/motion.json moments)

export type BannerKind = "touchdown" | "safety" | "turnover" | "fieldGoal" | "twoPoint";

/** data/ui/motion.json `moments` (typed and checked with the rest of motion.json in templates.ts). */
export type { Moments };

// ---------------------------------------------------------------- which moment a play fires

export interface Banner {
  readonly kind: BannerKind;
  /** The team whose fill the banner takes: the scorer, or the team that gains the ball. */
  readonly team: Team;
  /** The banner word, caps ("TOUCHDOWN", "INTERCEPTION"). */
  readonly word: string;
  /** The sub line ("Outriders 13, Cranes 7", "Cranes ball at OPP 41"). */
  readonly sub: string;
}

export interface Moment {
  /** At most one per play (priority: touchdown, safety, turnover, field goal, two-point try). */
  readonly banner: Banner | null;
  /** fx.firstDown: a new first down for the same team (topbar.newFirstDown); never with a banner. */
  readonly firstDown: boolean;
  /** fx.bigPlay: the gain from scrimmage, when at or over bigPlay.minYards and no score; never with a banner. */
  readonly bigPlay: number | null;
  /** The moment's minimum whistle hold at 1x (0 for none); the hold is the larger of this and the play's own. */
  readonly minHoldMs: number;
}

export const NO_MOMENT: Moment = { banner: null, firstDown: false, bigPlay: null, minHoldMs: 0 };

export interface MomentCtx {
  readonly teams: Readonly<Record<Team, { readonly nickname: string }>>;
  readonly human: Team;
  readonly endZoneYards: number;
  readonly penalties: Readonly<Record<string, { readonly enforcement: string }>>;
  readonly moments: Moments;
}

const SCRIMMAGE = new Set(["run", "pass", "sack", "scramble", "kneel", "spike"]);

/** "Outriders 13, Cranes 7": the scoring team first, from the score after the play. */
function scoreLine(ev: PlayEvent, first: Team, ctx: MomentCtx): string {
  const second = other(first);
  return `${ctx.teams[first].nickname} ${ev.after.score[first]}, ${ctx.teams[second].nickname} ${ev.after.score[second]}`;
}

function bannerOf(ev: PlayEvent, ctx: MomentCtx): Banner | null {
  const { play, before, after } = ev;
  const off = before.possession;
  const def = other(off);
  const gOff = after.score[off] - before.score[off];
  const gDef = after.score[def] - before.score[def];
  const kick = play.kind === "extraPoint" || play.kind === "twoPoint" || play.kind === "fieldGoal";
  // The same reading of the score as the result line (text.resultLine), so the two never disagree.
  if (!kick && (gOff >= 6 || gDef >= 6)) {
    const team = gOff >= 6 ? off : def;
    return { kind: "touchdown", team, word: "TOUCHDOWN", sub: scoreLine(ev, team, ctx) };
  }
  if (!kick && gDef === 2 && after.safetyKick) return { kind: "safety", team: def, word: "SAFETY", sub: scoreLine(ev, def, ctx) };
  const end = "end" in play ? play.end : undefined;
  const changed = after.possession !== off && (after.phase === "scrimmage" || after.phase === "try");
  if (SCRIMMAGE.has(play.kind) && changed) {
    const lost = end !== undefined && end.possession === "defense";
    const possessed = "defensePossessedDuringPlay" in play && play.defensePossessedDuringPlay === true;
    const where = after.phase === "scrimmage" ? `${ctx.teams[after.possession].nickname} ball at ${yardLineText(after.spot, after.possession, ctx.human)}` : `${ctx.teams[after.possession].nickname} ball`;
    if (lost || possessed) {
      const kind = "turnover" in play ? play.turnover : undefined;
      const word = kind === "interception" ? "INTERCEPTION" : kind === "fumble" ? "FUMBLE" : "TURNOVER";
      return { kind: "turnover", team: after.possession, word, sub: where };
    }
    // The offense kept the ball on 4th down and the other team takes over: a turnover on downs.
    if (before.phase === "scrimmage" && before.down === 4 && after.phase === "scrimmage") return { kind: "turnover", team: after.possession, word: "TURNOVER ON DOWNS", sub: where };
  }
  // A kick the receivers lost (end.possession says the kickers hold it): a muffed punt or a fumbled
  // return the kickers recover, or a lost kickoff return. The result names no kind: "TURNOVER".
  // Normal punts and kickoffs (the receivers keep the ball) and onside kicks are not turnovers.
  const kickLost =
    (play.kind === "punt" && play.crossedLine && play.touchedByReceivers && end !== undefined && end.possession === "offense") ||
    (play.kind === "kickoff" && play.outcome === "inPlay" && end !== undefined && end.possession === "offense");
  // The committed after-state must agree: an accepted foul can hand the ball back to the receivers.
  if (kickLost && after.phase === "scrimmage" && after.possession === off) return { kind: "turnover", team: after.possession, word: "TURNOVER", sub: `${ctx.teams[after.possession].nickname} ball at ${yardLineText(after.spot, after.possession, ctx.human)}` };
  if (play.kind === "fieldGoal" && play.good && gOff === 3) {
    const dist = 100 - play.kickSpot + ctx.endZoneYards;
    return { kind: "fieldGoal", team: off, word: "FIELD GOAL", sub: `${dist} yds. ${scoreLine(ev, off, ctx)}` };
  }
  if (play.kind === "twoPoint" && gOff === 2) return { kind: "twoPoint", team: off, word: "TWO-POINT GOOD", sub: scoreLine(ev, off, ctx) };
  return null;
}

/** The moment a committed play event fires (DESIGN.md Moments table). */
export function playMoment(ev: PlayEvent, ctx: MomentCtx): Moment {
  const banner = bannerOf(ev, ctx);
  if (banner !== null) return { banner, firstDown: false, bigPlay: null, minHoldMs: ctx.moments[banner.kind].minHoldMs };
  const stood = playStood(ev, ctx.penalties);
  const firstDown = newFirstDown(ev.before, ev.after, { kind: ev.play.kind, stood, endSpot: playEnd(ev.play) });
  const { play, before, after } = ev;
  const scored = after.score.home !== before.score.home || after.score.away !== before.score.away;
  const kept = "end" in play && play.end !== undefined && play.end.possession === "offense";
  const gain = before.phase === "scrimmage" && SCRIMMAGE.has(play.kind) && stood && kept && !scored ? gainOf(ev) : 0;
  const bigPlay = gain >= ctx.moments.bigPlay.minYards ? gain : null;
  return { banner: null, firstDown, bigPlay, minHoldMs: bigPlay === null ? 0 : ctx.moments.bigPlay.minHoldMs };
}

/**
 * The labels a banner says already (timeline labels at the whistle: the score words), so the field
 * draws them once, in the banner. Every other label stays a tag ("No good", "Good", "Fumble").
 */
export function bannerCovers(source: string, text: string): boolean {
  return source === "after.score" || (source === "good" && text === "Field goal good");
}

// ---------------------------------------------------------------- the hold

/**
 * When the whistle hold ends, in timeline ms: the larger of the play's own hold (its `total`) and
 * the moment's minimum from the whistle. Timeline ms run at the speed setting, so 2x halves it.
 */
export function momentEnd(tl: { readonly liveEnd: number; readonly total: number }, m: Moment): number {
  return Math.max(tl.total, tl.liveEnd + m.minHoldMs);
}

// ---------------------------------------------------------------- the banner's motion and place

/** DESIGN.md banner anatomy: the word slams in at 120 ms for 200 ms; the sub strip drops at 320 ms. */
export const BANNER_T = { wordAt: 120, wordMs: 200, subAt: 320, subRisePx: 8, wordScale: 1.15 } as const;

export interface BannerPose {
  /** Clip of the team block and strip: visible from `left` to `right`, shares of the width. */
  readonly left: number;
  readonly right: number;
  readonly wordAlpha: number;
  readonly wordScale: number;
  readonly subAlpha: number;
  /** px the sub strip still sits above its place. */
  readonly subLift: number;
}

/** The end state (reduced motion, skip, a redraw after the hold): everything in place. */
export const BANNER_STILL: BannerPose = { left: 0, right: 1, wordAlpha: 1, wordScale: 1, subAlpha: 1, subLift: 0 };

/**
 * The banner at `bt` ms after the whistle, with the hold ending `holdMs` after the whistle:
 * in over dur.wipe (ease.out) from the left, the word at 120 ms (ease.slam), the sub strip at
 * 320 ms (dur.base, ease.out), out to the right over the hold's last dur.wipe (ease.exit).
 */
export function bannerPose(bt: number, holdMs: number): BannerPose {
  if (bt < 0) return { left: 0, right: 0, wordAlpha: 0, wordScale: BANNER_T.wordScale, subAlpha: 0, subLift: BANNER_T.subRisePx };
  const right = ease(EASE.out, bt / DUR.wipe);
  const w = ease(EASE.slam, (bt - BANNER_T.wordAt) / BANNER_T.wordMs);
  const s = ease(EASE.out, (bt - BANNER_T.subAt) / DUR.base);
  const outFrom = holdMs - DUR.wipe;
  const left = holdMs > DUR.wipe && bt > outFrom ? ease(EASE.exit, (bt - outFrom) / DUR.wipe) : 0;
  return { left, right, wordAlpha: w, wordScale: BANNER_T.wordScale - (BANNER_T.wordScale - 1) * w, subAlpha: s, subLift: BANNER_T.subRisePx * (1 - s) };
}

/** Banner geometry (DESIGN.md banner anatomy), px. */
export const BANNER = { maxW: 720, sideGap: 48, h: 112, hNarrow: 88, narrowBelow: 600, stripH: 36, wordPx: 72, wordPxNarrow: 56, subPx: 18 } as const;

/**
 * The banner's box in canvas px: `min(columnWidth - 48, 720)` wide, centered on the column; its
 * center (block and strip together) at 30% of the view height when the ball's final spot is in the
 * lower half, at 70% otherwise. `others` (the carrier's and the tackler's final canvas y) and `pad`
 * (a mark's reach, px) keep it off them too: the ball's slot when it clears all three, else the
 * other slot when that does, else whichever slot clears the ball.
 */
export function bannerBox(col: { readonly left: number; readonly width: number }, viewH: number, ballY: number, others: readonly number[] = [], pad = 0): { x: number; y: number; w: number; blockH: number; stripH: number } {
  const w = Math.min(col.width - BANNER.sideGap, BANNER.maxW);
  const narrow = col.width < BANNER.narrowBelow;
  const blockH = narrow ? BANNER.hNarrow : BANNER.h;
  const total = blockH + BANNER.stripH;
  // The strip drops from 8 px above its place, so the slot reaches 8 px higher.
  const clears = (share: number, ys: readonly number[]): boolean => {
    const top = share * viewH - total / 2 - BANNER_T.subRisePx;
    const bottom = share * viewH + total / 2;
    return ys.every((y) => y < top - pad || y > bottom + pad);
  };
  const first = ballY >= viewH / 2 ? 0.3 : 0.7;
  const second = first === 0.3 ? 0.7 : 0.3;
  const all = [ballY, ...others];
  const share = clears(first, all) ? first : clears(second, all) ? second : clears(first, [ballY]) ? first : clears(second, [ballY]) ? second : first;
  return { x: col.left + (col.width - w) / 2, y: share * viewH - total / 2, w, blockH, stripH: BANNER.stripH };
}

/** The big-play chip counts from +0 to the gain over 500 ms, ease.out. */
export const COUNT_MS = 500;
export function bigPlayCount(gain: number, bt: number): number {
  return Math.round(gain * ease(EASE.out, bt / COUNT_MS));
}

// ---------------------------------------------------------------- the quarter-end line score

/**
 * hud.lineScore: points by period for each team, from the committed play events (each scoring
 * play's points go to the period it was snapped in). `periods` is how many columns to show.
 */
export function lineScore(events: readonly { readonly t: string }[], periods: number): Record<Team, number[]> {
  const out: Record<Team, number[]> = { home: Array.from({ length: periods }, () => 0), away: Array.from({ length: periods }, () => 0) };
  for (const e of events) {
    if (e.t !== "play") continue;
    const ev = e as PlayEvent;
    const p = ev.before.period - 1;
    if (p < 0 || p >= periods) continue;
    for (const t of ["home", "away"] as const) (out[t][p] as number) += ev.after.score[t] - ev.before.score[t];
  }
  return out;
}
