// Play art: the one drawing of a call (docs/specs/m2-play-calling-and-motion.md, decisions 3 to
// 5 and 9). playArt returns primitives for a formation and play class, or a defense package or
// preset, from the designed templates and the calls only: never a ball, a ball path, a target, a
// hole or a result. The card draws it small, the field preview draws it faint on your lineup,
// and the live play runs it for every player the engine doesn't name. Pure.

import type { Position } from "@clipboard-football/shared";
import { clampX, FIELD_WIDTH, MID_X, type Pt } from "./motion";
import type { Alignment, Pair, Templates, Waypoints } from "./templates";

export interface SlotRef {
  readonly slot: string;
  readonly position: Position;
}

export interface ArtMark extends SlotRef {
  readonly side: "O" | "X";
  readonly x: number;
  readonly y: number;
}

export interface ArtPath {
  readonly slot: string;
  readonly side: "O" | "X";
  readonly kind: "route" | "block" | "run" | "rush" | "drop" | "fake";
  readonly points: readonly Pt[];
  readonly end: "arrow" | "block" | "none";
}

export interface ArtZone {
  readonly slot: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly deep: boolean;
}

export interface Art {
  readonly marks: readonly ArtMark[];
  readonly paths: readonly ArtPath[];
  /** Throw depth bands (pass cards): y from and to, field yards. */
  readonly bands: readonly { readonly y0: number; readonly y1: number }[];
  readonly zones: readonly ArtZone[];
  /** Man coverage: from the defender to a generic receiver spot (drawn as a small O). */
  readonly tethers: readonly { readonly slot: string; readonly from: Pt; readonly to: Pt }[];
}

export const RUN_LEAVES: ReadonlySet<string> = new Set(["insideRun", "outsideRun", "qbSneak"]);
export const PASS_LEAVES: ReadonlySet<string> = new Set(["shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"]);

/** Slots in the engine's order (position order, then index) from personnel counts. */
export function slotsFromCounts(counts: Readonly<Partial<Record<string, number>>>): SlotRef[] {
  const order: Position[] = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"];
  return order.flatMap((pos) => Array.from({ length: counts[pos] ?? 0 }, (_, i) => ({ slot: `${pos}${i + 1}`, position: pos })));
}

/** Where each slot lines up: the template, or rows by order when the template has none. */
export function alignment(slots: readonly SlotRef[], tmpl: Alignment | undefined, side: "O" | "X", los: number, override?: Alignment): Pt[] {
  const missing = slots.filter((s) => (override?.[s.slot] ?? tmpl?.[s.slot]) === undefined);
  return slots.map((s) => {
    const a: Pair | undefined = override?.[s.slot] ?? tmpl?.[s.slot];
    if (a !== undefined) return { x: clampX(MID_X + a[0]), y: side === "O" ? los - a[1] : los + a[1] };
    const i = missing.indexOf(s);
    const perRow = Math.max(1, Math.ceil(missing.length / 2));
    const x = (((i % perRow) + 1) / (perRow + 1)) * FIELD_WIDTH;
    const depth = 2 + Math.floor(i / perRow) * 4;
    return { x, y: side === "O" ? los - depth : los + depth };
  });
}

/** Template waypoints for a position group, mirrored so "in" points to the middle. */
export function waypoints(start: Pt, w: Waypoints | undefined, position: string): Pt[] {
  const pts = w?.[position];
  if (pts === undefined) return [];
  const inward = start.x <= MID_X ? 1 : -1;
  return pts.map(([i, u]) => ({ x: clampX(start.x + inward * i), y: start.y + u }));
}

/**
 * DESIGN.md Spacing: the line is a diagram, not to scale across. When the marks on the line come
 * out closer than `minGap` yards, spread them evenly out from the middle by one factor.
 */
export function spreadLine(points: readonly Pt[], onLine: readonly boolean[], minGap: number): Pt[] {
  const xs = points.filter((_, i) => onLine[i]).map((p) => p.x).sort((a, b) => a - b);
  let gap = Infinity;
  for (let i = 1; i < xs.length; i++) gap = Math.min(gap, (xs[i] as number) - (xs[i - 1] as number));
  if (!(gap < minGap) || gap <= 0) return [...points];
  const k = minGap / gap;
  return points.map((p, i) => (onLine[i] ? { x: clampX(MID_X + (p.x - MID_X) * k), y: p.y } : p));
}

/** The unit's alignment with the line spread to the minimum spacing (when pxPerYard is known). */
export function lineUp(slots: readonly SlotRef[], tmpl: Alignment | undefined, side: "O" | "X", los: number, templates: Templates, pxPerYard: number | undefined, override?: Alignment): Pt[] {
  const raw = alignment(slots, tmpl, side, los, override);
  if (pxPerYard === undefined) return raw;
  const onLine = raw.map((q) => Math.abs(q.y - los) <= templates.lineSpacing.maxDepth + 1e-9 && Math.abs(q.x - MID_X) <= 10);
  return spreadLine(raw, onLine, templates.lineSpacing.minPx / pxPerYard);
}

/** The route template a leaf uses ("run" for the run leaves). */
export function routeKey(leaf: string): string {
  return RUN_LEAVES.has(leaf) ? "run" : leaf;
}

/** The art of an offense call: a formation alone (leaf null), or a formation and a play class. */
export function offenseArt(formation: string, leaf: string | null, slots: readonly SlotRef[], templates: Templates, los: number, pxPerYard?: number): Art {
  const pos = lineUp(slots, templates.offense[formation], "O", los, templates, pxPerYard);
  const marks: ArtMark[] = slots.map((s, i) => ({ ...s, side: "O", ...(pos[i] as Pt) }));
  if (leaf === null) return { marks, paths: [], bands: [], zones: [], tethers: [] };
  const isRun = RUN_LEAVES.has(leaf);
  const routes = templates.routes[routeKey(leaf)];
  const contact = templates.lineContact[isRun ? "run" : "pass"];
  const paths: ArtPath[] = [];
  const carrierSlot = leaf === "qbSneak" || !slots.some((s) => s.position === "RB") ? "QB1" : "RB1";
  for (const m of marks) {
    if (m.position === "OL") {
      const w = waypoints(m, contact, "OL");
      if (w.length > 0) paths.push({ slot: m.slot, side: "O", kind: "block", points: [m, ...w], end: "block" });
      continue;
    }
    if (isRun && m.slot === carrierSlot) {
      // The run path through the class's gap zone; an outside run forks to both edges (the engine picks the side).
      if (leaf === "qbSneak") paths.push({ slot: m.slot, side: "O", kind: "run", points: [m, { x: MID_X, y: los + 2.5 }], end: "arrow" });
      else if (leaf === "insideRun") paths.push({ slot: m.slot, side: "O", kind: "run", points: [m, { x: MID_X, y: los - 0.5 }, { x: MID_X, y: los + 3 }], end: "arrow" });
      else
        for (const dir of [-1, 1])
          paths.push({ slot: m.slot, side: "O", kind: "run", points: [m, { x: MID_X + dir * 9, y: los - 1 }, { x: MID_X + dir * 12, y: los + 3 }], end: "arrow" });
      continue;
    }
    if (m.position === "QB" && leaf === "playAction") {
      const rb = marks.find((x) => x.position === "RB");
      if (rb !== undefined) paths.push({ slot: m.slot, side: "O", kind: "fake", points: [m, { x: (m.x + rb.x) / 2, y: (m.y + rb.y) / 2 }], end: "arrow" });
    }
    const w = waypoints(m, routes, m.position);
    if (w.length > 0) paths.push({ slot: m.slot, side: "O", kind: "route", points: [m, ...w], end: "arrow" });
  }
  const band = templates.depthBands[leaf];
  const bands = band === undefined ? [] : [{ y0: los + band[0], y1: los + band[1] }];
  return { marks, paths, bands, zones: [], tethers: [] };
}

/** The art of a defense package (preset null: the package's base look) or a preset. */
export function defenseArt(pkg: string, preset: string | null, slots: readonly SlotRef[], templates: Templates, los: number, pxPerYard?: number): Art {
  const pos = lineUp(slots, templates.defense[pkg], "X", los, templates, pxPerYard, preset === null ? undefined : templates.presetAlignment[preset]);
  const marks: ArtMark[] = slots.map((s, i) => ({ ...s, side: "X", ...(pos[i] as Pt) }));
  if (preset === null) return { marks, paths: [], bands: [], zones: [], tethers: [] };
  const zones: ArtZone[] = [];
  const tethers: { slot: string; from: Pt; to: Pt }[] = [];
  const paths: ArtPath[] = [];
  const zoneOf = templates.zones[preset] ?? {};
  const manOf = templates.manTargets[preset] ?? {};
  const drops = templates.drops[templates.presetDrops[preset] ?? "zone"];
  for (const m of marks) {
    const z = zoneOf[m.slot];
    if (z !== undefined && m.position !== "DL") {
      const zone = { slot: m.slot, x0: clampX(MID_X + z[0]), y0: los + z[1], x1: clampX(MID_X + z[2]), y1: los + z[3], deep: z[4] === "deep" };
      zones.push(zone);
      paths.push({ slot: m.slot, side: "X", kind: "drop", points: [m, { x: (zone.x0 + zone.x1) / 2, y: (zone.y0 + zone.y1) / 2 }], end: "none" });
      continue;
    }
    const target = manOf[m.slot];
    if (target !== undefined && m.position !== "DL") {
      tethers.push({ slot: m.slot, from: m, to: { x: clampX(MID_X + target[0]), y: los - target[1] } });
      continue;
    }
    const w = waypoints(m, drops, m.position);
    if (w.length > 0) paths.push({ slot: m.slot, side: "X", kind: (w[w.length - 1] as Pt).y < m.y ? "rush" : "drop", points: [m, ...w], end: "none" });
  }
  return { marks, paths, bands: [], zones, tethers };
}

/**
 * The huddle ring (`field.huddle`) for one side before its lineup: 7 yards behind the line for
 * the offense, 6 past it for the defense, the smallest radius that keeps marks `gap` px apart,
 * inside the end lines. From the layout and a fixed template only: never from anyone's call.
 */
export function huddleSpots(count: number, side: "O" | "X", los: number, pxPerYard: number, markPx: number, behind: number, past: number, gapPx: number, endZoneYards: number): Pt[] {
  const chord = (markPx + gapPx) / pxPerYard;
  const r = Math.max(1.5, chord / (2 * Math.sin(Math.PI / Math.max(2, count))));
  const lo = -endZoneYards + r + 1;
  const hi = 100 + endZoneYards - r - 1;
  const cy = Math.max(lo, Math.min(hi, side === "O" ? los - behind : los + past));
  return Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / count;
    return { x: MID_X + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}
