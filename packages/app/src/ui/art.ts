// Play art: the one drawing of a call (docs/specs/m2-play-calling-and-motion.md, decisions 3 to
// 5 and 9). playArt returns primitives for a formation and play class, or a defense package or
// preset, from the designed templates and the calls only: never a ball, a ball path, a target, a
// hole or a result. The card draws it small, the field preview draws it faint on your lineup,
// and the live play runs it for every player the engine doesn't name. Pure.

import type { Position } from "@clipboard-football/shared";
import { clampX, FIELD_WIDTH, MID_X, type Pt } from "./motion";
import { routeOf, type Alignment, type Axis, type Pair, type Route, type Templates, type Waypoints } from "./templates";

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

/** A route waypoint placed on the field. */
export interface FieldWp {
  readonly p: Pt;
  readonly pauseMs: number;
  readonly pace: number;
}

/**
 * The mirror signs (R3): +1 or -1 for the strong side and the play side in field x. A play sign of
 * 0 drops the lateral part of `play`-axis templates (cards and the set preview, R4).
 */
export interface Sides {
  readonly strong: 1 | -1;
  readonly play: number;
}

/** Sideline and end-line clamps (States): x inside the margin, y at most maxY. */
export interface Bounds {
  readonly margin: number;
  readonly maxY: number;
}

const NO_BOUNDS: Bounds = { margin: 0, maxY: Infinity };

/** The sign that turns a template's lateral yards into field x for a mark starting at `start`. */
export function axisSign(axis: Axis, start: Pt, sides: Sides): number {
  if (axis === "strong") return sides.strong;
  if (axis === "play") return sides.play;
  return start.x <= MID_X ? 1 : -1;
}

/** A route placed from its start: mirrored along its axis, clamped to the bounds. */
export function placeRoute(start: Pt, route: Route | undefined, sides: Sides, bounds: Bounds = NO_BOUNDS): FieldWp[] {
  if (route === undefined) return [];
  const sign = axisSign(route.axis, start, sides);
  return route.pts.map((w) => ({ p: { x: Math.max(bounds.margin, Math.min(FIELD_WIDTH - bounds.margin, start.x + sign * w.p[0])), y: Math.min(bounds.maxY, start.y + w.p[1]) }, pauseMs: w.pauseMs, pace: w.pace }));
}

/** Template waypoints for a key (a position, or the first of a chain of keys), as points. */
export function waypoints(start: Pt, w: Waypoints | undefined, keys: string | readonly string[], sides: Sides = { strong: 1, play: 0 }, bounds?: Bounds): Pt[] {
  return placeRoute(start, lookup(w, typeof keys === "string" ? [keys] : keys), sides, bounds).map((x) => x.p);
}

/** The first key of the chain that the table has, as a route with its defaults. */
export function lookup(w: Waypoints | undefined, keys: readonly string[]): Route | undefined {
  for (const k of keys) {
    const v = w?.[k];
    if (v !== undefined) return routeOf(v);
  }
  return undefined;
}

export const ELIGIBLE: ReadonlySet<string> = new Set(["WR", "TE"]);

/**
 * Receiver roles (R1): on each side, WR and TE counted from the sideline in (#1 widest). The
 * strong side has more receivers; on a tie more TEs; on a second tie the offense's right.
 */
export function receiverRoles(slots: readonly SlotRef[], pts: readonly Pt[]): { readonly roles: ReadonlyMap<string, string>; readonly strong: 1 | -1 } {
  const side = (s: -1 | 1) => slots.map((x, i) => ({ ...x, p: pts[i] as Pt })).filter((x) => ELIGIBLE.has(x.position) && Math.sign(x.p.x - MID_X) === s);
  const left = side(-1);
  const right = side(1);
  const tes = (l: typeof left) => l.filter((x) => x.position === "TE").length;
  const strong: 1 | -1 = right.length !== left.length ? (right.length > left.length ? 1 : -1) : tes(right) !== tes(left) ? (tes(right) > tes(left) ? 1 : -1) : 1;
  const roles = new Map<string, string>();
  for (const [list, s] of [[left, -1], [right, 1]] as const) {
    const tag = s === strong ? "s" : "w";
    [...list].sort((a, b) => Math.abs(b.p.x - MID_X) - Math.abs(a.p.x - MID_X)).forEach((x, i) => roles.set(x.slot, `${tag}${i + 1}`));
  }
  return { roles, strong };
}

/** The route lookup chain (schema 3): `role:position`, the role, then the position. */
export function routeChain(role: string | undefined, position: string): string[] {
  return role === undefined ? [position] : [`${role}:${position}`, role, position];
}

/** Linemen keys: OLT and DLE are the outermost OL and DL on each side (then OL, DL). */
export function lineKeys(slots: readonly SlotRef[], pts: readonly Pt[], slot: string, position: string): string[] {
  if (position !== "OL" && position !== "DL") return [position];
  const xs = slots.map((s, i) => (s.position === position ? (pts[i] as Pt).x : NaN)).filter((x) => !Number.isNaN(x));
  const i = slots.findIndex((s) => s.slot === slot);
  const x = (pts[i] as Pt | undefined)?.x;
  const outer = x !== undefined && xs.length > 2 && (x === Math.min(...xs) || x === Math.max(...xs));
  return outer ? [position === "OL" ? "OLT" : "DLE", position] : [position];
}

/** A lineman's step: the leaf's table, then the family's, each with OLT/DLE before OL/DL. */
export function lineContactFor(templates: Templates, leaf: string, family: string, keys: readonly string[]): Route | undefined {
  return lookup(templates.lineContact[leaf], keys) ?? lookup(templates.lineContact[family], keys);
}

/** The offense family a defense's read step reads (R9). */
export function readFamily(leaf: string): "run" | "pass" | "playAction" {
  return RUN_LEAVES.has(leaf) ? "run" : leaf === "playAction" ? "playAction" : "pass";
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

/** The route table a leaf uses (version 2: every leaf has its own, the run leaves included). */
export function routeKey(leaf: string): string {
  return leaf;
}

/**
 * The art of an offense call: a formation alone (leaf null), or a formation and a play class.
 * Receivers run their role's route (R1); `play`-axis steps draw with their lateral part removed,
 * since the engine picks the side (R4).
 */
export function offenseArt(formation: string, leaf: string | null, slots: readonly SlotRef[], templates: Templates, los: number, pxPerYard?: number, bounds?: Bounds): Art {
  const pos = lineUp(slots, templates.offense[formation], "O", los, templates, pxPerYard);
  const marks: ArtMark[] = slots.map((s, i) => ({ ...s, side: "O", ...(pos[i] as Pt) }));
  if (leaf === null) return { marks, paths: [], bands: [], zones: [], tethers: [] };
  const isRun = RUN_LEAVES.has(leaf);
  const routes = templates.routes[routeKey(leaf)];
  const { roles, strong } = receiverRoles(slots, pos);
  const sides: Sides = { strong, play: 0 };
  const paths: ArtPath[] = [];
  const carrierSlot = leaf === "qbSneak" || !slots.some((s) => s.position === "RB") ? "QB1" : "RB1";
  for (const m of marks) {
    if (m.position === "OL") {
      const w = placeRoute(m, lineContactFor(templates, leaf, isRun ? "run" : "pass", lineKeys(slots, pos, m.slot, "OL")), sides, bounds).map((x) => x.p);
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
    const route = lookup(routes, routeChain(roles.get(m.slot), m.position));
    const w = placeRoute(m, route, sides, bounds).map((x) => x.p);
    if (w.length === 0) continue;
    if (route?.finish === "block") {
      // A blocking back or tight end ends in the block tick, like the line.
      paths.push({ slot: m.slot, side: "O", kind: "block", points: [m, ...w], end: "block" });
      continue;
    }
    if (m.position === "QB" && leaf === "playAction" && w.length > 1) {
      // The fake is the template's first step; the boot follows from it.
      paths.push({ slot: m.slot, side: "O", kind: "fake", points: [m, w[0] as Pt], end: "arrow" });
      paths.push({ slot: m.slot, side: "O", kind: "route", points: w, end: "arrow" });
      continue;
    }
    paths.push({ slot: m.slot, side: "O", kind: "route", points: [m, ...w], end: "arrow" });
  }
  const band = templates.depthBands[leaf];
  const bands = band === undefined ? [] : [{ y0: los + band[0], y1: los + band[1] }];
  return { marks, paths, bands, zones: [], tethers: [] };
}

/**
 * The centre of a preset's zone for a slot, on the field (the landmark), or undefined. The zone
 * clamps at `maxY` (States: goal to go, zones clamp at the end line minus 1 yd).
 */
export function landmark(templates: Templates, preset: string, slot: string, los: number, maxY = Infinity): { readonly zone: ArtZone; readonly at: Pt } | undefined {
  const z = templates.zones[preset]?.[slot];
  if (z === undefined) return undefined;
  const zone = { slot, x0: clampX(MID_X + z[0]), y0: Math.min(maxY, los + z[1]), x1: clampX(MID_X + z[2]), y1: Math.min(maxY, los + z[3]), deep: z[4] === "deep" };
  return { zone, at: { x: (zone.x0 + zone.x1) / 2, y: (zone.y0 + zone.y1) / 2 } };
}

/**
 * The art of a defense package (preset null: the package's base look) or a preset. Zone
 * defenders pedal (their drop set's steps) then go to the landmark; man defenders pedal and
 * tether to a generic receiver spot. No read step: it depends on the offense's call (R4).
 */
export function defenseArt(pkg: string, preset: string | null, slots: readonly SlotRef[], templates: Templates, los: number, pxPerYard?: number, bounds?: Bounds): Art {
  const pos = lineUp(slots, templates.defense[pkg], "X", los, templates, pxPerYard, preset === null ? undefined : templates.presetAlignment[preset]);
  const marks: ArtMark[] = slots.map((s, i) => ({ ...s, side: "X", ...(pos[i] as Pt) }));
  if (preset === null) return { marks, paths: [], bands: [], zones: [], tethers: [] };
  const zones: ArtZone[] = [];
  const tethers: { slot: string; from: Pt; to: Pt }[] = [];
  const paths: ArtPath[] = [];
  const manOf = templates.manTargets[preset] ?? {};
  const drops = templates.drops[templates.presetDrops[preset] ?? "zone"];
  const sides: Sides = { strong: 1, play: 0 };
  for (const m of marks) {
    const pre = m.position === "DL" ? [] : placeRoute(m, lookup(drops, [m.slot, m.position]), sides, bounds).map((x) => x.p);
    const lm = m.position === "DL" ? undefined : landmark(templates, preset, m.slot, los, bounds?.maxY);
    if (lm !== undefined) {
      zones.push(lm.zone);
      paths.push({ slot: m.slot, side: "X", kind: "drop", points: [m, ...pre, lm.at], end: "none" });
      continue;
    }
    const target = manOf[m.slot];
    if (target !== undefined && m.position !== "DL") {
      const from = pre[pre.length - 1] ?? m;
      if (pre.length > 0) paths.push({ slot: m.slot, side: "X", kind: "drop", points: [m, ...pre], end: "none" });
      tethers.push({ slot: m.slot, from, to: { x: clampX(MID_X + target[0]), y: los - target[1] } });
      continue;
    }
    const w = m.position === "DL" ? placeRoute(m, lookup(drops, [m.slot, m.position]), sides, bounds).map((x) => x.p) : pre;
    if (w.length > 0) paths.push({ slot: m.slot, side: "X", kind: (w[w.length - 1] as Pt).y < m.y ? "rush" : "drop", points: [m, ...w], end: "none" });
  }
  return { marks, paths, bands: [], zones, tethers };
}

/**
 * The huddle (`field.huddle`) for one side before its lineup: a horseshoe whose opening faces the
 * ball (usability pass U6). The ring has `count + 1` places at the smallest radius that keeps
 * marks `gap` px apart; the place pointing straight at the line of scrimmage stays empty. Centered
 * `behind` yards behind the line for the offense, `past` yards past it for the defense, inside the
 * end lines. From the layout and a fixed template only: never from anyone's call.
 */
export function huddleSpots(count: number, side: "O" | "X", los: number, pxPerYard: number, markPx: number, behind: number, past: number, gapPx: number, endZoneYards: number): Pt[] {
  const places = count + 1;
  const chord = (markPx + gapPx) / pxPerYard;
  const r = Math.max(1.5, chord / (2 * Math.sin(Math.PI / Math.max(2, places))));
  const lo = -endZoneYards + r + 1;
  const hi = 100 + endZoneYards - r - 1;
  const cy = Math.max(lo, Math.min(hi, side === "O" ? los - behind : los + past));
  // Place 0 points at the line: up the field (+y) for the offense, down it for the defense.
  const open = side === "O" ? Math.PI / 2 : -Math.PI / 2;
  return Array.from({ length: count }, (_, i) => {
    const a = open + (2 * Math.PI * (i + 1)) / places;
    return { x: MID_X + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}
