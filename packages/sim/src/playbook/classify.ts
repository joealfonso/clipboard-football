// The assignment classifier (docs/specs/m3-playbook-and-custom-routes.md, milestone B): turns a
// drawn path in field yards into one assignment kind and a few features, or a reason from a closed
// list. Designed, pure and deterministic: no RNG, no clock, no DOM, the same result on the UI
// thread and in the engine. Every threshold comes in through the config (data/plays/config.json,
// the pass leaves' depth edges from data/caller/config.json, the end zone from the rule set).
// Not imported by the engine yet.
//
// Frame: a path is a list of [x, y] in yards from the player's alignment, x to the offense's
// right, y upfield for the offense. Defenders use the same frame, so a blitz has falling y. The
// ball is taken at the middle of the field, which is what the alignments assume.

import {
  absolutePath,
  breakPoints,
  declaredEnd,
  defenseAlignment,
  dropCollinear,
  gapAt,
  hasCanonicalShape,
  holeOf,
  laneAt,
  lineCrossing,
  own,
  pathLength,
  placePath,
  positionOf,
  quantize,
  readRoute,
  resolveDefense,
  resolveOffense,
  segs,
  thirdOf,
} from "../../../shared/src/playbook";
import type { AssignmentKind, ClassifierThresholds, ConceptConfig, DefenseDesign, DepthEdges, OffenseDesign, Pair, PathPoint, Playbook, PlaybookConfig, QuantizeResult, ReasonCode, RouteShape, RunGap, SlotAlignment, Third } from "../../../shared/src/playbook";

export type { QuantizeResult } from "../../../shared/src/playbook";

export interface ClassifyConfig {
  readonly thresholds: ClassifierThresholds;
  /** The pass leaves' depth edges, read from the caller config: the one place they live (B8). */
  readonly depthEdges: DepthEdges;
  readonly fieldWidthYards: number;
  readonly endZoneYards: number;
  /** Whose short path is a swing, and who takes the fake on play action. */
  readonly backs: readonly string[];
  readonly routePositions: readonly string[];
  readonly neverDrawn: readonly string[];
  readonly blockWhenShort: readonly string[];
  readonly notOnThisCall: readonly string[];
  readonly concepts: Readonly<Record<string, ConceptConfig>>;
}

/** The classifier's config from the playbook config, the caller's depth edges and the rule set's end zone depth. */
export function classifyConfig(config: PlaybookConfig, depthEdges: DepthEdges, endZoneYards: number): ClassifyConfig {
  return {
    thresholds: config.classifier,
    depthEdges,
    fieldWidthYards: config.field.widthYards,
    endZoneYards,
    backs: config.positions.backs,
    routePositions: config.eligibility.routePositions,
    neverDrawn: config.eligibility.neverDrawn,
    blockWhenShort: config.eligibility.blockWhenShort,
    notOnThisCall: config.notOnThisCall,
    concepts: config.concepts,
  };
}

/** What a slot does when nobody redraws it. */
export interface BaseAssignment {
  readonly kind: AssignmentKind;
  /**
   * Its path in canonical form, in the library's "in" frame: x toward the middle of the field (to
   * the offense's right for a player on the middle), so it reads the same on either side.
   */
  readonly path: readonly PathPoint[];
}

export interface ClassifyContext {
  readonly side: "offense" | "defense";
  readonly slot: string;
  /** Where every slot of this side lines up for this call, [x, depth off the ball]. */
  readonly alignment: SlotAlignment;
  /** Offense: the engine call's leaf (shortPass, punt, kneel...). Defense: the preset. */
  readonly call: string;
  /** Offense run designs: the design's ball carrier. */
  readonly carrier?: string;
  /** Offense: the slots whose base assignment is a route that ends at or behind the line. */
  readonly behindLine?: readonly string[];
  /** Offense: the design is a screen. Without a design, the call says. */
  readonly screen?: boolean;
  /** The slot's base assignment, when it has a path (a man defender has none). */
  readonly base?: BaseAssignment;
  /** The line of scrimmage, in yards from the offense's own goal line (the engine's state.spot). */
  readonly spot: number;
}

export type Features =
  | ({ readonly kind: "route" } & RouteShape)
  | { readonly kind: "block"; readonly block: "pass" }
  | { readonly kind: "runPath"; readonly gap: RunGap; readonly side: Third }
  | { readonly kind: "blitz"; readonly lane: "inside" | "edge"; readonly side: Third }
  | { readonly kind: "zone"; readonly level: "under" | "deep"; readonly third: Third }
  | { readonly kind: "spy" };

export type ClassifyResult = { readonly ok: true; readonly features: Features } | { readonly ok: false; readonly reason: ReasonCode };

/** Mirrors a path between the field's frame and the "in" frame: the player's side decides. */
function inFrame(path: readonly PathPoint[], alignX: number): PathPoint[] {
  return path.map((p): PathPoint => [(alignX > 0 ? -p[0] : p[0]) + 0, p[1]]);
}

/** The context for one slot of an offense design. */
export function offenseContext(design: OffenseDesign, playbook: Playbook, slot: string, spot: number): ClassifyContext {
  const alignment = own(playbook.alignments.offense, design.formation) ?? {};
  const resolved = resolveOffense(design, playbook, Object.keys(alignment));
  const behindLine = resolved.filter((r) => r.entry.kind === "route" && declaredEnd(r.entry, alignment[r.slot] as Pair, r.ref.depth) <= 0).map((r) => r.slot);
  const mine = resolved.find((r) => r.slot === slot);
  let base: BaseAssignment | undefined;
  if (mine !== undefined && "pts" in mine.entry) {
    const align = alignment[slot] as Pair;
    const path = quantize(placePath(mine.entry, align, mine.to, mine.ref.depth, holeOf(resolved, alignment) ?? undefined), playbook.config.classifier);
    if (path.ok) base = { kind: mine.entry.kind, path: inFrame(path.path, align[0]) };
  }
  return { side: "offense", slot, alignment, call: design.concept, ...(design.carrier === undefined ? {} : { carrier: design.carrier }), behindLine, screen: design.concept === "screenPass", ...(base === undefined ? {} : { base }), spot };
}

/** The context for one slot of a defense design. */
export function defenseContext(design: DefenseDesign, playbook: Playbook, slot: string, spot: number): ClassifyContext {
  const alignment = defenseAlignment(design, playbook.alignments);
  const mine = resolveDefense(design, playbook, Object.keys(alignment)).find((r) => r.slot === slot);
  let base: BaseAssignment | undefined;
  if (mine !== undefined) {
    const align = alignment[slot] as Pair;
    const at = mine.ref.at;
    const raw: PathPoint[] | null = "pts" in mine.entry ? placePath(mine.entry, align) : mine.entry.kind === "spy" ? [[0, 0]] : at !== undefined ? [[0, 0], [at[0] - align[0], at[1] - align[1]]] : null;
    const path = raw === null ? null : quantize(raw, playbook.config.classifier);
    if (path?.ok === true) base = { kind: mine.entry.kind, path: inFrame(path.path, align[0]) };
  }
  return { side: "defense", slot, alignment, call: design.coverage, ...(base === undefined ? {} : { base }), spot };
}

// ---------------------------------------------------------------- canonical form

/** Whether a path is in canonical form, the only form classifyPath accepts. */
export function isCanonical(path: readonly unknown[], config: ClassifyConfig): boolean {
  return hasCanonicalShape(path, config.thresholds) && pathLength(dropCollinear(path)) <= config.thresholds.maxLengthYards;
}

/** Any finite list of points to canonical form, or a reason (quantize in packages/shared/src/playbook.ts). */
export function quantizePath(raw: readonly (readonly number[])[], config: ClassifyConfig): QuantizeResult {
  return quantize(raw, config.thresholds);
}

function sideOf(x: number, half: number): Third {
  return x < -half ? "left" : x > half ? "right" : "middle";
}

// ---------------------------------------------------------------- classification

const fail = (reason: ReasonCode): ClassifyResult => ({ ok: false, reason });

function routeFeatures(path: readonly PathPoint[], align: Pair, context: ClassifyContext, config: ClassifyConfig): Features {
  const as = { back: config.backs.includes(positionOf(context.slot)), screen: context.screen ?? context.call === "screenPass" };
  return { kind: "route", ...readRoute(path, align, as, config.thresholds, config.depthEdges, config.fieldWidthYards) };
}

/** The base assignment's path in the field's frame, or null when it has none. */
function basePath(context: ClassifyContext, align: Pair): PathPoint[] | null {
  return context.base === undefined ? null : dropCollinear(inFrame(context.base.path, align[0]));
}

function sameFeatures(a: Features, b: Features): boolean {
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  return Object.keys(x).length === Object.keys(y).length && Object.keys(x).every((k) => x[k] === y[k]);
}

/** Where a drawn defender ends: a blitz on or behind the line (R13), a zone past it. */
function defenseFeatures(abs: readonly Pair[], config: ClassifyConfig): Features {
  const t = config.thresholds;
  const end = abs[abs.length - 1] as Pair;
  if (end[1] <= 0) {
    const x = lineCrossing(abs, -1) ?? end[0];
    return { kind: "blitz", lane: laneAt(x, t), side: sideOf(x, t.sideMiddleYards) };
  }
  return { kind: "zone", level: end[1] >= config.depthEdges.shortBelow ? "deep" : "under", third: thirdOf(end[0], config.fieldWidthYards) };
}

/**
 * A short move: a spy from inside the core box, unless it ends closer to where the base assignment
 * ends than to where he lines up, which is the base assignment drawn again (R3).
 */
function isSpy(abs: readonly Pair[], align: Pair, context: ClassifyContext, t: ClassifierThresholds): boolean {
  const first = abs[0] as Pair;
  const end = abs[abs.length - 1] as Pair;
  const net = Math.hypot(end[0] - first[0], end[1] - first[1]);
  if (net >= t.spyRadiusYards) return false;
  if (context.base?.kind === "spy") return true;
  const base = basePath(context, align);
  const to = base === null ? undefined : (absolutePath(base, align, false)[base.length - 1] as Pair);
  if (to !== undefined && Math.hypot(end[0] - to[0], end[1] - to[1]) < net) return false;
  return Math.abs(align[0]) <= t.coreBox.halfWidthYards && align[1] <= t.coreBox.maxDepthYards;
}

/** Too short to be a route: on offense, staying in. */
function staysIn(path: readonly PathPoint[], config: ClassifyConfig): boolean {
  return pathLength(path) < config.thresholds.minRouteYards;
}

/** What a path's shape reads as, before any rule about the spot, the concept or the position. Null: a run that never crosses the line. */
function shapeOf(pts: readonly PathPoint[], align: Pair, context: ClassifyContext, config: ClassifyConfig): Features | null {
  const t = config.thresholds;
  const offense = context.side === "offense";
  const abs = absolutePath(pts, align, offense);
  if (!offense) return isSpy(abs, align, context, t) ? { kind: "spy" } : defenseFeatures(abs, config);
  if (own(config.concepts, context.call)?.family === "run") {
    const x = lineCrossing(abs, 1);
    return x === undefined ? null : { kind: "runPath", gap: gapAt(x, t), side: sideOf(x, t.sideMiddleYards) };
  }
  return staysIn(pts, config) ? { kind: "block", block: "pass" } : routeFeatures(pts, align, context, config);
}

/** Whether a path has the base assignment's features (R3): then it is the base assignment, at any spot (R16). */
function isBaseAgain(pts: readonly PathPoint[], align: Pair, context: ClassifyContext, config: ClassifyConfig): boolean {
  const base = basePath(context, align);
  if (base === null) return false;
  const drawn = shapeOf(pts, align, context, config);
  const was = shapeOf(base, align, context, config);
  return drawn !== null && was !== null && sameFeatures(drawn, was);
}

/** Why a slot may not be drawn at all on this call, or null. These win over everything else (R14, R16). */
function notDrawable(context: ClassifyContext, config: ClassifyConfig): ReasonCode | null {
  const position = positionOf(context.slot);
  if (own(context.alignment, context.slot) === undefined) return "noSuchSlot";
  if (context.side === "defense") return null;
  const concept = own(config.concepts, context.call);
  if (config.notOnThisCall.includes(context.call) || concept === undefined) return "notOnThisCall";
  if (config.neverDrawn.includes(position) || !config.routePositions.includes(position)) return "ineligible";
  return concept.family === "run" && context.slot !== context.carrier ? "notOnThisCall" : null;
}

/**
 * One assignment kind and its features for a canonical path, or one reason. Total: never throws
 * on a list of points. The same path, context and config always give the same result.
 */
export function classifyPath(path: readonly PathPoint[], context: ClassifyContext, config: ClassifyConfig): ClassifyResult {
  const t = config.thresholds;
  const barred = notDrawable(context, config);
  if (barred !== null) return fail(barred);
  const align = own(context.alignment, context.slot) as Pair;
  const position = positionOf(context.slot);
  const offense = context.side === "offense";
  if (!Array.isArray(path) || !hasCanonicalShape(path, t)) return fail("notCanonical");
  // Points on a straight line between their neighbors carry nothing, so they are dropped first:
  // adding one can never change a length, a break or a feature (B5).
  const pts = dropCollinear(path);
  if (pathLength(pts) > t.maxLengthYards) return fail("tooLong");
  if (breakPoints(segs(pts), t.breakDegrees).length > t.maxBreaks) return fail("tooManyBreaks");

  const features = shapeOf(pts, align, context, config);
  const isBase = isBaseAgain(pts, align, context, config);
  // Absolute points: x from the middle of the field, y past the line of scrimmage.
  const abs = absolutePath(pts, align, offense);
  const halfWidth = config.fieldWidthYards / 2;
  if (abs.some((p) => Math.abs(p[0]) > halfWidth)) return fail("outOfBounds");
  // The end lines move with the spot, so the base assignment drawn again is legal past them (R14,
  // R16). Anything else must stay in bounds.
  const farEnd = 100 - context.spot + config.endZoneYards;
  const nearEnd = -(context.spot + config.endZoneYards);
  if (!isBase && abs.some((p) => p[1] > farEnd || p[1] < nearEnd)) return fail("outOfBounds");
  // Only a run path that never crosses the line has no features.
  if (features === null) return fail("wrongGap");

  if (!offense) return { ok: true, features };
  if (features.kind === "runPath") return isBase || (own(config.concepts, context.call)?.gaps ?? []).includes(features.gap) ? { ok: true, features } : fail("wrongGap");

  // A screen must keep one route at or behind the line.
  const lastBehind = !isBase && context.call === "screenPass" && (context.behindLine ?? []).every((s) => s === context.slot);
  if (features.kind === "block") {
    if (!isBase && !config.blockWhenShort.includes(position)) return fail("tooShort");
    return lastBehind ? fail("breaksConcept") : { ok: true, features };
  }
  if (lastBehind && (abs[abs.length - 1] as Pair)[1] > 0) return fail("breaksConcept");
  // For a blocker who may be drawn to block, his own path again is his block, however long it is (R3).
  if (isBase && context.base?.kind === "block" && config.blockWhenShort.includes(position)) return { ok: true, features: { kind: "block", block: "pass" } };
  // Play action keeps its faking back: in to block, or on the design's own route (R14).
  if (context.call === "playAction" && config.backs.includes(position) && !isBase) return fail("breaksConcept");
  return { ok: true, features };
}

/** A drawing read against the design: the base assignment itself, a change, or a reason. */
export type DrawingResult = { readonly ok: true; readonly base: true } | { readonly ok: true; readonly base: false; readonly features: Features } | { readonly ok: false; readonly reason: ReasonCode };

/**
 * A drawn path against the slot's base assignment: a path with the same features is the base
 * assignment, whatever its kind (R3) and wherever the ball is (R16), so drawing a rush, a stunt or
 * a block again changes nothing.
 */
export function resolveDrawing(path: readonly PathPoint[], context: ClassifyContext, config: ClassifyConfig): DrawingResult {
  const drawn = classifyPath(path, context, config);
  if (!drawn.ok) return drawn;
  if (isBaseAgain(dropCollinear(path), own(context.alignment, context.slot) as Pair, context, config)) return { ok: true, base: true };
  return { ok: true, base: false, features: drawn.features };
}
