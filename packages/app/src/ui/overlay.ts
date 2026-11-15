// Overlays over the full-screen field (Joseph's amendment, docs/specs/m2-play-calling-and-motion.md,
// "Amended (Joseph, 2026-11-14): full-screen field, menus over it"). Pure, so the rules can be tested:
// - an overlay never covers the line of scrimmage, the line to gain or your lineup at the set;
// - no overlay shows during the live play;
// - paper backing opaque enough for 4.5:1 text over any field pixel;
// - focus goes back where it came from when an overlay closes.

import type { Layout } from "./layout";
import type { Templates } from "./templates";
import { COLOR } from "./tokens";

/** Gap between an overlay and the window edge or a protected line, px. */
export const OVERLAY_MARGIN = 8;
export const OVERLAY_MAX_WIDTH = 980;
/** Screens that aren't over a play (title, pregame, settings): a centered sheet this wide at most. */
export const SHEET_MAX_WIDTH = 720;
/** Under this height the calling overlay drops the card art for text rows (the compact fallback). */
export const CARD_MIN_HEIGHT = 300;
/** Paper backing opacity over the field. contrast.test checks text over the darkest field pixel. */
export const OVERLAY_ALPHA = 0.94;
/** Clear space kept around a protected line or lineup, in yards. */
export const GUARD_PAD_YARDS = 1;

// ---------------------------------------------------------------- contrast (WCAG 2)

type Rgb = readonly [number, number, number];

export function rgbOf(hex: string): Rgb {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `top` at `alpha` over `under`. */
export function blend(top: Rgb, under: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map((i) => top[i as 0] * alpha + under[i as 0] * (1 - alpha)) as unknown as Rgb;
}

function luminance(c: Rgb): number {
  const ch = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (ch[0] as number) + 0.7152 * (ch[1] as number) + 0.0722 * (ch[2] as number);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The overlay's CSS background: paper at OVERLAY_ALPHA. */
export function overlayBackground(): string {
  const [r, g, b] = rgbOf(COLOR.paper);
  return `rgba(${r}, ${g}, ${b}, ${OVERLAY_ALPHA})`;
}

// ---------------------------------------------------------------- what an overlay must not cover

export type Side = "offense" | "defense";

/** The deepest player of a unit at the set, in yards from the line (templates, before any clamp near a goal line). */
export function unitDepth(t: Templates, side: Side, unit: string, call: string | null): number {
  const align = side === "offense" ? (t.offense[unit] ?? t.kick[unit] ?? {}) : { ...(t.defense[unit] ?? {}), ...(call === null ? {} : (t.presetAlignment[call] ?? {})) };
  return Math.max(0, ...Object.values(align).map((p) => Math.abs(p[1])));
}

/** Every unit a side can line up in on a call screen (when the screen itself shows none yet). */
export function deepestUnit(t: Templates, side: Side): number {
  if (side === "offense") return Math.max(0, ...Object.keys(t.offense).map((u) => unitDepth(t, "offense", u, null)));
  return Math.max(0, ...Object.keys(t.defense).map((u) => unitDepth(t, "defense", u, null)), ...Object.keys(t.presetAlignment).map((p) => Math.max(0, ...Object.values(t.presetAlignment[p] ?? {}).map((q) => Math.abs(q[1])))));
}

export interface Guard {
  /** Field y of the line of scrimmage (yards from the offense's goal line). */
  readonly los: number;
  readonly lineToGain: number | null;
  /** Your side: the offense lines up below the line, the defense above it. */
  readonly side: Side;
  /** Your lineup's depth from the line, yards; 0 when no lineup is on the field. */
  readonly depth: number;
}

/** Field-y ranges (lo < hi) to keep visible: the line and your lineup as one, the line to gain on its own. */
export function guardRanges(g: Guard, markYards: number): { lo: number; hi: number }[] {
  const r = markYards / 2 + GUARD_PAD_YARDS;
  const lineup = g.side === "offense" ? { lo: g.los - g.depth - r, hi: g.los + r } : { lo: g.los - r, hi: g.los + g.depth + r };
  const out = [lineup];
  if (g.lineToGain !== null) out.push({ lo: g.lineToGain - r, hi: g.lineToGain + r });
  return out;
}

export interface Placement {
  readonly left: number;
  readonly width: number;
  /** The overlay may use [top, top + maxHeight] (window px); it sticks to `anchor` and grows only as tall as its content. */
  readonly top: number;
  readonly maxHeight: number;
  readonly anchor: "top" | "bottom";
  readonly where: "above" | "below" | "between" | "sheet";
  /** Too short for card art: text rows. */
  readonly compact: boolean;
}

/**
 * Where an overlay goes. Over a play (a guard): in the tallest stretch of the canvas the protected
 * ranges leave free, on the side away from the ball. Elsewhere: a centered sheet.
 */
export function placeOverlay(l: Layout, camera: number, guard: Guard | null, markYards: number, ballX: number | null = null): Placement {
  const m = OVERLAY_MARGIN;
  const top0 = l.field.top + m;
  const bottom0 = l.field.top + l.field.height - m;
  if (guard === null) {
    const width = Math.min(l.field.width - 2 * m, SHEET_MAX_WIDTH);
    return { left: Math.round((l.field.width - width) / 2), width, top: top0, maxHeight: bottom0 - top0, anchor: "top", where: "sheet", compact: bottom0 - top0 < CARD_MIN_HEIGHT };
  }
  const yPx = (y: number): number => l.field.top + (camera - y) * l.s;
  // Protected stretches in window px, top to bottom, merged.
  const blocked = guardRanges(guard, markYards)
    .map((r) => ({ a: yPx(r.hi) - m, b: yPx(r.lo) + m }))
    .sort((p, q) => p.a - q.a)
    .reduce<{ a: number; b: number }[]>((acc, p) => {
      const last = acc[acc.length - 1];
      if (last !== undefined && p.a <= last.b) acc[acc.length - 1] = { a: last.a, b: Math.max(last.b, p.b) };
      else acc.push(p);
      return acc;
    }, []);
  const gaps: { a: number; b: number; where: Placement["where"]; anchor: Placement["anchor"] }[] = [];
  let cursor = top0;
  blocked.forEach((p, i) => {
    gaps.push({ a: cursor, b: Math.min(p.a, bottom0), where: i === 0 ? "above" : "between", anchor: i === 0 ? "top" : "bottom" });
    cursor = Math.max(cursor, p.b);
  });
  gaps.push({ a: cursor, b: bottom0, where: "below", anchor: "bottom" });
  // Tallest gap; above wins a tie (the eye starts at the top).
  const best = gaps.reduce((x, y) => (y.b - y.a > x.b - x.a ? y : x));
  const width = Math.min(l.field.width - 2 * m, OVERLAY_MAX_WIDTH);
  const ballLeft = ballX !== null && ballX < l.field.width / 2;
  const left = ballLeft ? l.field.width - m - width : m;
  const maxHeight = Math.max(0, best.b - best.a);
  return { left: Math.round(left), width, top: best.a, maxHeight, anchor: best.anchor, where: best.where, compact: maxHeight < CARD_MIN_HEIGHT };
}

// ---------------------------------------------------------------- when overlays show

/**
 * No overlay during the live play. The player card is the one exception, and only because opening
 * it pauses the play (Joseph's ratings amendment: a card at every phase, the animation paused).
 */
export function overlaysShown(o: { readonly animating: boolean; readonly markCard: boolean }): { readonly panel: boolean; readonly markCard: boolean } {
  return { panel: !o.animating, markCard: o.markCard };
}

// ---------------------------------------------------------------- focus

/**
 * Where focus goes back to. Opening an overlay records what had focus; closing it returns that,
 * and closing one under the top also closes the ones over it (Esc closes the top one).
 */
export class FocusTrail<K, T> {
  private readonly trail: { key: K; back: T }[] = [];

  open(key: K, back: T): void {
    this.trail.push({ key, back });
  }

  close(key: K): T | undefined {
    const i = this.trail.map((e) => e.key).lastIndexOf(key);
    if (i < 0) return undefined;
    const back = (this.trail[i] as { back: T }).back;
    this.trail.length = i;
    return back;
  }

  top(): K | undefined {
    return this.trail[this.trail.length - 1]?.key;
  }

  clear(): void {
    this.trail.length = 0;
  }
}
