// Types and pure helpers for the playbook data files (data/plays): alignments, the assignment
// library, the offense and defense designs and the config (docs/specs/m3-playbook-and-custom-routes.md,
// milestones A and B). Plain types only, no zod, so packages/sim can import them. The zod schemas
// live in playbook-schema.ts. Everything in data/plays is designed, not fitted. Not re-exported
// through types.ts: that file is in the calibration import graph.

import type { Rule } from "./catalog";
import { POSITIONS } from "./engine";
import type { Situation } from "./situation";

// ---------------------------------------------------------------- closed lists

export const ASSIGNMENT_KINDS = ["route", "block", "runPath", "qb", "rush", "blitz", "zone", "man", "spy", "stunt"] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

export const ROUTE_FAMILIES = ["flat", "swing", "screen", "drag", "slant", "hitch", "out", "in", "corner", "post", "go", "wheel"] as const;
export type RouteFamily = (typeof ROUTE_FAMILIES)[number];

export const DEPTH_BUCKETS = ["behind", "short", "intermediate", "deep"] as const;
export type DepthBucket = (typeof DEPTH_BUCKETS)[number];

export const ROUTE_DIRECTIONS = ["in", "out", "vertical", "back"] as const;
export type RouteDirection = (typeof ROUTE_DIRECTIONS)[number];

export const RUN_GAPS = ["A", "B", "C", "edge"] as const;
export type RunGap = (typeof RUN_GAPS)[number];

export const HEADINGS = ["vertical", "diagonal", "sideways", "back"] as const;
export type Heading = (typeof HEADINGS)[number];

export const REASON_CODES = ["noSuchSlot", "ineligible", "notOnThisCall", "notCanonical", "tooShort", "tooLong", "tooManyBreaks", "outOfBounds", "wrongGap", "breaksConcept"] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const SITUATION_TAGS = ["shortYardage", "redZone", "goalLine", "twoMinute", "longYardage", "backedUp", "runClock"] as const;
export type SituationTag = (typeof SITUATION_TAGS)[number];

export const TIMINGS = ["quick", "standard", "slow"] as const;
export type Timing = (typeof TIMINGS)[number];

export const QB_DROPS = ["quick", "standard", "deep"] as const;
export type QbDrop = (typeof QB_DROPS)[number];

export const PRESSURES = ["none", "exchange", "blitz"] as const;
export type Pressure = (typeof PRESSURES)[number];

export const PASS_TRAITS = ["quick", "crossers", "highLow", "flood", "verticals", "levels", "isolation", "screenBack", "screenWide", "boot"] as const;
export const RUN_TRAITS = ["zone", "gap", "misdirection", "perimeter", "lead", "wedge"] as const;
export const DEFENSE_TRAITS = ["singleHigh", "twoHigh", "fourDeep", "noDeep", "man", "zone", "pressure", "overload", "exchange", "stunt", "spy", "press", "robber", "bracket", "loadedBox", "lightBox", "pinch"] as const;

/** The calls with no drawn assignment at all (data/calls/catalog.json ids). */
export const CALLS_NOT_DRAWN = ["punt", "fieldGoal", "extraPoint", "kickoff", "onsideKick", "spike", "kneel", "qbSneak"] as const;

export const MAN_ROLES = ["L1", "L2", "L3", "R1", "R2", "R3", "B"] as const;
export type ManRole = (typeof MAN_ROLES)[number];

export type FieldSide = "left" | "right";
export type Third = "left" | "middle" | "right";
/** [x, depth] for an alignment or a landmark, [lateral, up] for a waypoint. Yards. */
export type Pair = readonly [number, number];
/** A path point [x, y] in yards from the player's alignment: x to the offense's right, y upfield for the offense. */
export type PathPoint = readonly [number, number];
/** One drawn assignment: a slot and its path (spec, "Calls, requests, records"). Not on any call type yet. */
export interface CustomAssignment {
  readonly slot: string;
  readonly path: readonly PathPoint[];
}

// ---------------------------------------------------------------- data files

export type SlotAlignment = Readonly<Record<string, Pair>>;

export interface Alignments {
  readonly version: number;
  readonly designed: true;
  readonly note: string;
  readonly offense: Readonly<Record<string, SlotAlignment>>;
  readonly defense: Readonly<Record<string, SlotAlignment>>;
  readonly presetAlignment: Readonly<Record<string, SlotAlignment>>;
}

/** Lateral axis of a library entry's waypoints (see the note in data/plays/library.json). */
export type Axis = "in" | "side" | "none" | "hole";

export interface RouteEntry {
  readonly kind: "route";
  readonly label: string;
  readonly family: RouteFamily;
  readonly direction: RouteDirection;
  readonly axis: "in" | "side";
  readonly pts: readonly Pair[];
  /** Index of the waypoint a design's `depth` places: the break, or the end of a route that runs vertical. */
  readonly breakAt: number;
}
export interface BlockEntry {
  readonly kind: "block";
  readonly label: string;
  readonly block: "pass" | "run";
  readonly technique: string;
  readonly axis: Axis;
  readonly pts: readonly Pair[];
}
export interface RunPathEntry {
  readonly kind: "runPath";
  readonly label: string;
  readonly gap: RunGap;
  /** The first step goes away from the play side. */
  readonly counter: boolean;
  readonly axis: "side" | "none";
  /** Measured from the ball: [toward the play side, past the line]. */
  readonly pts: readonly Pair[];
}
export interface QbEntry {
  readonly kind: "qb";
  readonly label: string;
  readonly action: "drop" | "rollout" | "handoff";
  readonly drop?: QbDrop;
  readonly fake: boolean;
  readonly axis: "side" | "none";
  readonly pts: readonly Pair[];
}
export interface RushEntry {
  readonly kind: "rush" | "blitz" | "stunt";
  readonly label: string;
  readonly lane: "inside" | "edge";
  readonly axis: "in" | "none";
  readonly pts: readonly Pair[];
}
export interface ZoneEntry {
  readonly kind: "zone";
  readonly label: string;
  readonly level: "under" | "deep";
  readonly third: Third;
}
export interface ManEntry {
  readonly kind: "man";
  readonly label: string;
  /** Receiver spots in order: he covers the first one the formation has. */
  readonly covers: readonly ManRole[];
  /** What he does against a formation with none of them (R7). */
  readonly fallback?: ManFallback;
}
export interface ManFallback {
  /** A rush, spy or zone entry. */
  readonly use: string;
  /** A zone's landmark. */
  readonly at?: Pair;
}
export interface SpyEntry {
  readonly kind: "spy";
  readonly label: string;
}
export type LibraryEntry = RouteEntry | BlockEntry | RunPathEntry | QbEntry | RushEntry | ZoneEntry | ManEntry | SpyEntry;

export interface Library {
  readonly version: number;
  readonly designed: true;
  readonly note: string;
  readonly assignments: Readonly<Record<string, LibraryEntry>>;
}

export interface AssignmentRef {
  readonly use: string;
  /** The side a side-axis entry goes to. */
  readonly to?: FieldSide;
  /** A route's break depth in yards past the line, replacing the library's. */
  readonly depth?: number;
  /** The first read of a pass design. */
  readonly primary?: boolean;
  /** A zone's landmark, [x, depth] in the alignment frame. */
  readonly at?: Pair;
  /** A stunt's partner slot. */
  readonly with?: string;
}
/** A bare id means { use: id }. */
export type AssignmentValue = string | AssignmentRef;

export interface OffenseDesign {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly formation: string;
  /** The offense leaf: with the formation, the design's engine call. */
  readonly concept: string;
  /** The play side against the formation's strong side. */
  readonly side: "strong" | "weak" | "none";
  /** Run designs: the ball carrier's slot. */
  readonly carrier?: string;
  /** Replaces the concept's line block for linemen the design does not list. */
  readonly line?: AssignmentValue;
  readonly assignments: Readonly<Record<string, AssignmentValue>>;
  readonly tags: { readonly depth?: DepthBucket; readonly timing: Timing; readonly situations: readonly SituationTag[] };
  readonly traits: readonly string[];
  readonly aiWeight: number;
  readonly default: boolean;
}

export interface DefenseDesign {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly package: string;
  /** The preset: the design's engine call. */
  readonly coverage: string;
  readonly alignment?: SlotAlignment;
  readonly assignments: Readonly<Record<string, AssignmentValue>>;
  readonly tags: { readonly timing: Timing; readonly pressure: Pressure; readonly situations: readonly SituationTag[] };
  readonly traits: readonly string[];
  readonly aiWeight: number;
  readonly default: boolean;
}

export interface DesignFile<D> {
  readonly version: number;
  readonly designed: true;
  readonly note: string;
  readonly designs: readonly D[];
}

/** One row of the route family decision table. Every key given must hold. First match wins. */
export interface FamilyRow {
  readonly family: RouteFamily;
  readonly heading?: readonly Heading[];
  readonly lateral?: "in" | "out";
  readonly minBreaks?: number;
  readonly maxBreaks?: number;
  readonly minDepth?: number;
  readonly maxDepth?: number;
  readonly maxEndDepth?: number;
  /** The path ends under the caller's short edge (true) or at or past it (false). */
  readonly endsShort?: boolean;
  /** The break depth is in the short bucket, or not. */
  readonly breaksShort?: boolean;
  /** A back's path (positions.backs), or not. */
  readonly back?: boolean;
  /** The design is a screen, or not. */
  readonly screen?: boolean;
  readonly stemHeading?: readonly Heading[];
  readonly stemLateral?: "in" | "out";
}

export interface ClassifierThresholds {
  readonly status: string;
  readonly note: string;
  readonly quantumYards: number;
  readonly maxPoints: number;
  readonly maxLengthYards: number;
  readonly minRouteYards: number;
  readonly breakDegrees: number;
  readonly maxBreaks: number;
  readonly simplifyToleranceYards: number;
  readonly verticalFromDegrees: number;
  readonly diagonalFromDegrees: number;
  readonly backBelowDegrees: number;
  readonly coreHalfWidthYards: number;
  readonly gapEdgesYards: readonly [number, number, number];
  readonly sideMiddleYards: number;
  readonly spyRadiusYards: number;
  /** A short move is a spy only for a defender lined up in here (R3). */
  readonly coreBox: { readonly halfWidthYards: number; readonly maxDepthYards: number };
  readonly blitzEdgeFromYards: number;
  /** Families whose catch depth is the end point's y. The others' is the break depth (R1). */
  readonly catchAtEnd: readonly RouteFamily[];
  readonly familyNote: string;
  readonly families: readonly FamilyRow[];
}

/** [fewest, most]; null means no limit. */
export type CountRange = readonly [number, number | null];

export interface ConceptConfig {
  readonly family: "run" | "pass";
  /** Run concepts: the gaps a run path may cross the line in. */
  readonly gaps?: readonly RunGap[];
  /** Line blocks for linemen a design does not list: OL for all, OLT for the outermost each side. */
  readonly line: { readonly OL: string; readonly OLT?: string };
}

/** Which positions play which part, so no helper names a position itself. */
export interface PositionConfig {
  readonly note: string;
  /** Counted from the sideline in for the receiver spots and the strong side. */
  readonly receivers: readonly string[];
  /** Breaks a tie for the strong side. */
  readonly strongTieBreak: readonly string[];
  /** The fake's partner on play action, the spot B, and whose short path is a swing. */
  readonly backs: readonly string[];
  readonly corners: readonly string[];
  readonly safeties: readonly string[];
}

export interface TraitThresholds {
  readonly crossersMin: number;
  readonly highMinYards: number;
  readonly lowMaxYards: number;
  readonly highLowGapYards: number;
  readonly floodMin: number;
  readonly floodGapYards: number;
  readonly verticalsMin: number;
  readonly levelsGapYards: number;
  readonly screenBackPositions: readonly string[];
  readonly lineMin: number;
  readonly pressureMin: number;
  readonly exchangeMax: number;
  readonly overloadMin: number;
  readonly fourDeepMin: number;
  readonly pressMin: number;
  readonly pinchMin: number;
  readonly pinchMoveYards: number;
}

/** One way a design can earn a situation tag: every key given must hold. */
export interface TagFit {
  readonly family?: "run" | "pass";
  readonly concepts?: readonly string[];
  readonly gaps?: readonly RunGap[];
  readonly depth?: readonly DepthBucket[];
  readonly timing?: readonly Timing[];
  readonly minProtectors?: number;
  readonly primary?: readonly RouteFamily[];
  /** The quarterback's drop. */
  readonly drop?: readonly QbDrop[];
  /** Whether he fakes a handoff. */
  readonly fake?: boolean;
  /** The primary route breaks this many yards past the line or deeper, or is caught in the deep bucket. */
  readonly primaryLateFrom?: number;
  readonly coverage?: readonly string[];
  readonly pressure?: readonly Pressure[];
  /** At least one of these. */
  readonly traits?: readonly string[];
}

/** The timing tags a design may carry when it meets `when`, which never names a concept (R21). First match wins; the last row catches everything. */
export interface TimingRow {
  readonly when: Omit<TagFit, "concepts" | "timing">;
  readonly allow: readonly Timing[];
}

export interface SituationConfig {
  readonly definition: string;
  readonly edges: string;
  readonly rule: Rule;
  /** A design may carry the tag when it meets one row for its side of the ball. */
  readonly designs: { readonly offense: readonly TagFit[]; readonly defense: readonly TagFit[] };
}

export interface PlaybookConfig {
  readonly version: number;
  readonly designed: true;
  readonly note: string;
  readonly maxGroupSize: number;
  readonly kinds: readonly AssignmentKind[];
  readonly families: readonly RouteFamily[];
  readonly buckets: readonly DepthBucket[];
  readonly directions: readonly RouteDirection[];
  readonly gaps: readonly RunGap[];
  readonly reasons: readonly ReasonCode[];
  readonly tags: { readonly depth: readonly DepthBucket[]; readonly timing: readonly Timing[]; readonly pressure: readonly Pressure[]; readonly situations: readonly SituationTag[] };
  readonly situations: Readonly<Record<SituationTag, SituationConfig>>;
  readonly timing: { readonly note: string; readonly offense: readonly TimingRow[]; readonly defense: readonly TimingRow[] };
  readonly positions: PositionConfig;
  readonly traits: { readonly note: string; readonly thresholds: TraitThresholds; readonly pass: Readonly<Record<string, string>>; readonly run: Readonly<Record<string, string>>; readonly defense: Readonly<Record<string, string>> };
  readonly concepts: Readonly<Record<string, ConceptConfig>>;
  readonly lineNote: string;
  readonly defenseDefaults: { readonly DL: string; readonly DLE: string };
  readonly defenseDefaultsNote: string;
  /** Calls with no drawn assignment at all. */
  readonly notOnThisCall: readonly string[];
  readonly shells: { readonly note: string } & Readonly<Record<string, CountRange | string>>;
  readonly rush: { readonly note: string } & Readonly<Record<string, CountRange | string>>;
  readonly box: { readonly note: string; readonly halfWidthYards: number; readonly maxDepthYards: number; readonly lightBoxMax: number; readonly pressMaxDepthYards: number; readonly robberMinDepthYards: number };
  readonly manRoles: { readonly note: string; readonly roles: readonly ManRole[] };
  readonly eligibility: { readonly status: string; readonly note: string; readonly routePositions: readonly string[]; readonly neverDrawn: readonly string[]; readonly blockWhenShort: readonly string[] };
  /** widthYards is derived from widthFeet when the file is parsed (R8). */
  readonly field: { readonly status: string; readonly note: string; readonly widthFeet: number; readonly widthYards: number };
  /** Engine calls whose default design does not draw today's diagram, each with the reason (R5). */
  readonly defaultDeviations: Readonly<Record<string, string>>;
  readonly classifier: ClassifierThresholds;
}

export interface Playbook {
  readonly alignments: Alignments;
  readonly library: Library;
  readonly offense: DesignFile<OffenseDesign>;
  readonly defense: DesignFile<DefenseDesign>;
  readonly config: PlaybookConfig;
}

/** The pass leaves' depth edges (data/caller/config.json offenseMapping.depth): the one place they live. */
export interface DepthEdges {
  readonly shortBelow: number;
  readonly deepFrom: number;
}

/** What the playbook is checked against: personnel, the presets' definitions and the depth edges. */
export interface PlaybookRefs {
  readonly personnel: {
    readonly offense: Readonly<Record<string, Readonly<Partial<Record<string, number>>>>>;
    readonly packages: Readonly<Record<string, Readonly<Partial<Record<string, number>>>>>;
    readonly presetPackage: Readonly<Record<string, string>>;
  };
  /** data/caller/config.json defenseMapping.presets. */
  readonly presets: Readonly<Record<string, { readonly box: string; readonly shell: string; readonly manZone: string; readonly rush: string }>>;
  /** data/caller/config.json defenseMapping.boxHeavyMin. */
  readonly boxHeavyMin: number;
  readonly depthEdges: DepthEdges;
}

// ---------------------------------------------------------------- small helpers

/** A record's own value: a key like "constructor" is never found on the prototype (R9). */
export function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

/** Slots in the engine's order (position order, then index) from personnel counts. */
export function slotsOf(counts: Readonly<Partial<Record<string, number>>>): string[] {
  return POSITIONS.flatMap((pos) => Array.from({ length: counts[pos] ?? 0 }, (_, i) => `${pos}${i + 1}`));
}

export function positionOf(slot: string): string {
  return slot.replace(/\d+$/, "");
}

export function refOf(v: AssignmentValue): AssignmentRef {
  return typeof v === "string" ? { use: v } : v;
}

/** The bucket of a depth in yards past the line, on the pass leaves' edges. Below the line is behind. */
export function depthBucket(depthYards: number, edges: DepthEdges): DepthBucket {
  if (depthYards < 0) return "behind";
  if (depthYards < edges.shortBelow) return "short";
  return depthYards < edges.deepFrom ? "intermediate" : "deep";
}

/** Half up to a whole yard, so -0.5 is 0 and 8.5 is 9. */
export function wholeYards(v: number): number {
  return Math.floor(v + 0.5) + 0;
}

/** From midfield to either goal line. A design must fit there: nothing it places is farther from the line than this. */
export const MIDFIELD_YARDS = 50;

/** Which third of the field x (yards from the middle) is in. */
export function thirdOf(x: number, fieldWidthYards: number): Third {
  const edge = fieldWidthYards / 6;
  return x < -edge ? "left" : x > edge ? "right" : "middle";
}

/**
 * The formation's strong side, +1 right or -1 left: the side with more receivers, then more of the
 * tie-break positions, then the offense's right (the rule the app's diagrams use).
 */
export function strongSign(alignment: SlotAlignment, positions: PositionConfig): 1 | -1 {
  const on = (s: 1 | -1) => Object.keys(alignment).filter((k) => positions.receivers.includes(positionOf(k)) && Math.sign((alignment[k] as Pair)[0]) === s);
  const left = on(-1);
  const right = on(1);
  const ties = (l: string[]) => l.filter((k) => positions.strongTieBreak.includes(positionOf(k))).length;
  if (right.length !== left.length) return right.length > left.length ? 1 : -1;
  return ties(left) > ties(right) ? -1 : 1;
}

/** The side an offense design goes to, or null when it has none. */
export function playSide(design: Pick<OffenseDesign, "side">, alignment: SlotAlignment, positions: PositionConfig): FieldSide | null {
  if (design.side === "none") return null;
  const s = strongSign(alignment, positions) * (design.side === "strong" ? 1 : -1);
  return s > 0 ? "right" : "left";
}

/** The receiver spots a formation has: L1.. and R1.. from the sideline in, B for the back. */
export function formationRoles(alignment: SlotAlignment, positions: PositionConfig): Partial<Record<ManRole, string>> {
  const out: Partial<Record<ManRole, string>> = {};
  for (const [tag, s] of [["L", -1], ["R", 1]] as const) {
    Object.keys(alignment)
      .filter((k) => positions.receivers.includes(positionOf(k)) && Math.sign((alignment[k] as Pair)[0]) === s)
      .sort((a, b) => Math.abs((alignment[b] as Pair)[0]) - Math.abs((alignment[a] as Pair)[0]))
      .forEach((k, i) => {
        out[`${tag}${i + 1}` as ManRole] = k;
      });
  }
  const back = Object.keys(alignment).filter((k) => positions.backs.includes(positionOf(k))).sort()[0];
  if (back !== undefined) out.B = back;
  return out;
}

/** What a man assignment is against a formation: the slot he covers, or his fallback. */
export function manAgainst(entry: ManEntry, roles: Partial<Record<ManRole, string>>): { readonly role: ManRole; readonly covers: string } | { readonly fallback: ManFallback } | null {
  const role = entry.covers.find((c) => roles[c] !== undefined);
  if (role !== undefined) return { role, covers: roles[role] as string };
  return entry.fallback === undefined ? null : { fallback: entry.fallback };
}

/** A defense design's alignment: the package, then the preset's overrides, then the design's. */
export function defenseAlignment(design: Pick<DefenseDesign, "package" | "coverage" | "alignment">, alignments: Alignments): SlotAlignment {
  return { ...own(alignments.defense, design.package), ...own(alignments.presetAlignment, design.coverage), ...design.alignment };
}

/** The waypoint a design's `depth` places. An index past the end is a listed issue (checkPlaybook), so it reads as the last. */
function breakWaypoint(entry: RouteEntry): Pair {
  return entry.pts[Math.min(entry.breakAt, entry.pts.length - 1)] as Pair;
}

/**
 * A library entry's waypoints as a path from the player's alignment, in the classifier's frame
 * ([x to the offense's right, y upfield], starting at [0, 0]). `to` picks the side of a side-axis
 * entry, `depth` moves a route's break to that many yards past the line. Offense entries only
 * need the alignment's depth to be yards behind the line; a runPath is placed from the ball and a
 * hole-axis block from the design's hole.
 */
export function placePath(entry: Exclude<LibraryEntry, ZoneEntry | ManEntry | SpyEntry>, align: Pair, to?: FieldSide, depth?: number, hole?: Hole): PathPoint[] {
  if (entry.axis === "hole") {
    const h = hole ?? { x: 0, sign: 1 };
    return [[0, 0], ...entry.pts.map((p): PathPoint => [h.x + h.sign * p[0] - align[0] + 0, p[1] + align[1]])];
  }
  const sign = entry.axis === "none" ? 0 : entry.axis === "side" ? (to === "left" ? -1 : 1) : align[0] <= 0 ? 1 : -1;
  if (entry.kind === "runPath") return [[0, 0], ...entry.pts.map((p): PathPoint => [sign * p[0] - align[0] + 0, p[1] + align[1]])];
  const breakAt = entry.kind === "route" ? entry.breakAt : 0;
  const shift = entry.kind === "route" && depth !== undefined ? depth + align[1] - breakWaypoint(entry)[1] : 0;
  return [[0, 0], ...entry.pts.map((p, i): PathPoint => [sign * p[0] + 0, p[1] + (i >= breakAt ? shift : 0)])];
}

/** Where a run crosses the line, and its side: what lead and pulling blockers aim at (R6). */
export interface Hole {
  readonly x: number;
  readonly sign: 1 | -1;
}

/** x where a path of absolute points first crosses the line of scrimmage going upfield (1) or toward the offense (-1). */
export function lineCrossing(abs: readonly Pair[], dir: 1 | -1): number | undefined {
  for (let i = 1; i < abs.length; i++) {
    const a = abs[i - 1] as Pair;
    const b = abs[i] as Pair;
    const crosses = dir === 1 ? a[1] < 0 && b[1] >= 0 : a[1] > 0 && b[1] <= 0;
    if (crosses) return a[0] + ((b[0] - a[0]) * (0 - a[1])) / (b[1] - a[1]);
  }
  return undefined;
}

/** A design's hole: where its run path crosses the line, or null when it has no side. */
export function holeOf(resolved: readonly ResolvedAssignment[], alignment: SlotAlignment): Hole | null {
  const c = resolved.find((r) => r.entry.kind === "runPath");
  const align = c === undefined ? undefined : own(alignment, c.slot);
  if (c === undefined || c.entry.kind !== "runPath" || align === undefined || c.to === undefined) return null;
  const x = lineCrossing(placePath(c.entry, align, c.to).map((p): Pair => [align[0] + p[0], p[1] - align[1]]), 1);
  return x === undefined ? null : { x, sign: c.to === "left" ? -1 : 1 };
}

/** The depth of the waypoint a design's `depth` places, in yards past the line. */
export function declaredDepth(entry: RouteEntry, align: Pair, depth?: number): number {
  return depth ?? breakWaypoint(entry)[1] - align[1];
}

/** Where a route ends, in yards past the line. */
export function declaredEnd(entry: RouteEntry, align: Pair, depth?: number): number {
  return (entry.pts[entry.pts.length - 1] as Pair)[1] - breakWaypoint(entry)[1] + declaredDepth(entry, align, depth);
}

/** A route's declared catch depth at a slot (R1): its end for the families that catch there, its break for the others. */
export function declaredCatchDepth(entry: RouteEntry, align: Pair, depth: number | undefined, catchAtEnd: readonly RouteFamily[]): number {
  return wholeYards(catchAtEnd.includes(entry.family) ? declaredEnd(entry, align, depth) : declaredDepth(entry, align, depth));
}

// ---------------------------------------------------------------- reading a path
// Shared by the classifier (packages/sim/src/playbook/classify.ts) and the load-time checks
// (playbook-rules.ts), so a library entry is held to the same reading a drawing gets.

const DEG = 180 / Math.PI;

export type QuantizeResult = { readonly ok: true; readonly path: PathPoint[] } | { readonly ok: false; readonly reason: ReasonCode };

function onGrid(v: number, q: number): boolean {
  return Number.isInteger(v / q);
}

function isPoint(p: unknown): p is PathPoint {
  return Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

export function pathLength(path: readonly PathPoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot((path[i] as PathPoint)[0] - (path[i - 1] as PathPoint)[0], (path[i] as PathPoint)[1] - (path[i - 1] as PathPoint)[1]);
  return total;
}

/** First point [0, 0], every coordinate on the quantum, consecutive points distinct, at most maxPoints. */
export function hasCanonicalShape(path: readonly unknown[], t: ClassifierThresholds): path is readonly PathPoint[] {
  if (path.length === 0 || path.length > t.maxPoints) return false;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (!isPoint(p) || !onGrid(p[0], t.quantumYards) || !onGrid(p[1], t.quantumYards)) return false;
    if (i === 0 ? p[0] !== 0 || p[1] !== 0 : p[0] === (path[i - 1] as PathPoint)[0] && p[1] === (path[i - 1] as PathPoint)[1]) return false;
  }
  return true;
}

/** Drops interior points that lie exactly on the straight line between their neighbors, going the same way. */
export function dropCollinear(path: readonly PathPoint[]): PathPoint[] {
  const out: PathPoint[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i] as PathPoint;
    const a = out[out.length - 1];
    const b = path[i + 1];
    if (a !== undefined && b !== undefined) {
      const ux = p[0] - a[0];
      const uy = p[1] - a[1];
      const vx = b[0] - p[0];
      const vy = b[1] - p[1];
      if (ux * vy - uy * vx === 0 && ux * vx + uy * vy > 0) continue;
    }
    out.push([p[0] + 0, p[1] + 0]);
  }
  return out;
}

/** Ramer-Douglas-Peucker with an explicit stack: keeps the points farther than `tol` from the chord. */
function simplify(path: readonly PathPoint[], tol: number): PathPoint[] {
  const keep = new Array<boolean>(path.length).fill(false);
  keep[0] = true;
  keep[path.length - 1] = true;
  const stack: [number, number][] = [[0, path.length - 1]];
  while (stack.length > 0) {
    const [i0, i1] = stack.pop() as [number, number];
    const a = path[i0] as PathPoint;
    const b = path[i1] as PathPoint;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let at = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const p = path[i] as PathPoint;
      const d = len === 0 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at >= 0 && worst > tol) {
      keep[at] = true;
      stack.push([i0, at], [at, i1]);
    }
  }
  return path.filter((_, i) => keep[i]);
}

/** To the nearest quantum, ties away from zero, so a mirrored path snaps to its mirror. */
function snapX(v: number, q: number): number {
  return Math.sign(v) * Math.round(Math.abs(v) / q) * q + 0;
}

function snapAndClean(path: readonly PathPoint[], q: number): PathPoint[] {
  const out: PathPoint[] = [];
  for (const p of path) {
    const s: PathPoint = [snapX(p[0], q), Math.round(p[1] / q) * q + 0];
    const last = out[out.length - 1];
    if (last === undefined || last[0] !== s[0] || last[1] !== s[1]) out.push(s);
  }
  return dropCollinear(out);
}

/**
 * Any finite list of points to canonical form, or a reason. The first point becomes [0, 0] (the
 * player's alignment). A path already on the grid only loses points that lie exactly on a
 * straight line, so quantizing a canonical path changes no feature (B5), and the result is a
 * fixed point (B9). Anything else is simplified first, with a tolerance that doubles until the
 * point limit holds, then snapped to the quantum. A result that is not finite is refused (R9).
 */
export function quantize(raw: readonly (readonly number[])[], t: ClassifierThresholds): QuantizeResult {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isPoint)) return { ok: false, reason: "notCanonical" };
  let path: PathPoint[];
  if (hasCanonicalShape(raw, t)) path = dropCollinear(raw);
  else {
    const from: PathPoint[] = [[0, 0], ...(raw as readonly PathPoint[]).slice(1)];
    let tol = t.simplifyToleranceYards;
    path = snapAndClean(simplify(from, tol), t.quantumYards);
    while (path.length > t.maxPoints) {
      tol *= 2;
      path = snapAndClean(simplify(from, tol), t.quantumYards);
    }
  }
  if (!path.every(isPoint) || Number.isNaN(pathLength(path))) return { ok: false, reason: "notCanonical" };
  if (pathLength(path) > t.maxLengthYards) return { ok: false, reason: "tooLong" };
  return { ok: true, path };
}

interface Seg {
  readonly dx: number;
  readonly dy: number;
}

export function segs(path: readonly PathPoint[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 1; i < path.length; i++) out.push({ dx: (path[i] as PathPoint)[0] - (path[i - 1] as PathPoint)[0], dy: (path[i] as PathPoint)[1] - (path[i - 1] as PathPoint)[1] });
  return out;
}

/** Indexes of the path points where the path turns by breakDegrees or more. */
export function breakPoints(s: readonly Seg[], breakDegrees: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1] as Seg;
    const b = s[i] as Seg;
    const turn = Math.atan2(Math.abs(a.dx * b.dy - a.dy * b.dx), a.dx * b.dx + a.dy * b.dy) * DEG;
    if (turn >= breakDegrees) out.push(i);
  }
  return out;
}

function headingOf(s: Seg, t: ClassifierThresholds): Heading {
  const a = Math.atan2(s.dy, Math.abs(s.dx)) * DEG;
  if (a >= t.verticalFromDegrees) return "vertical";
  if (a >= t.diagonalFromDegrees) return "diagonal";
  return a > t.backBelowDegrees ? "sideways" : "back";
}

/** In is toward the middle from the player's side. A player lined up in the core has no inside. */
function lateralOf(s: Seg, alignX: number, t: ClassifierThresholds): "in" | "out" | "none" {
  if (s.dx === 0) return "none";
  if (Math.abs(alignX) < t.coreHalfWidthYards) return "out";
  return Math.sign(s.dx) === -Math.sign(alignX) ? "in" : "out";
}

/** What a route path reads as, from its shape alone. */
export interface RouteShape {
  readonly family: RouteFamily;
  readonly breakDepth: number;
  readonly catchDepth: number;
  readonly bucket: DepthBucket;
  readonly direction: RouteDirection;
  readonly endSide: Third;
  readonly crossesMiddle: boolean;
}

/** A path from the player's alignment as points from the middle of the field, y past the line of scrimmage. */
export function absolutePath(path: readonly PathPoint[], align: Pair, offense: boolean): Pair[] {
  return path.map((p): Pair => [align[0] + p[0], (offense ? -align[1] : align[1]) + p[1]]);
}

/** The family, depths and direction of a canonical path of two points or more. */
export function readRoute(path: readonly PathPoint[], align: Pair, as: { readonly back: boolean; readonly screen: boolean }, t: ClassifierThresholds, edges: DepthEdges, fieldWidthYards: number): RouteShape {
  const alignX = align[0];
  const abs = absolutePath(path, align, true);
  const s = segs(path);
  const breaks = breakPoints(s, t.breakDegrees);
  const last = s[s.length - 1] as Seg;
  const stem = s[0] as Seg;
  const heading = headingOf(last, t);
  const lateral = lateralOf(last, alignX, t);
  const end = abs[abs.length - 1] as Pair;
  const lastBreak = breaks[breaks.length - 1];
  // Whole yards once, so the family table and the bucket cannot disagree at an edge (R17).
  const endDepth = wholeYards(end[1]);
  const breakDepth = lastBreak === undefined ? endDepth : wholeYards((abs[lastBreak] as Pair)[1]);
  const stemHeading = headingOf(stem, t);
  const stemLateral = lateralOf(stem, alignX, t);
  const row =
    t.families.find(
      (r) =>
        (r.heading === undefined || r.heading.includes(heading)) &&
        (r.lateral === undefined || r.lateral === lateral) &&
        (r.minBreaks === undefined || breaks.length >= r.minBreaks) &&
        (r.minDepth === undefined || breakDepth >= r.minDepth) &&
        (r.maxDepth === undefined || breakDepth <= r.maxDepth) &&
        (r.maxBreaks === undefined || breaks.length <= r.maxBreaks) &&
        (r.maxEndDepth === undefined || endDepth <= r.maxEndDepth) &&
        (r.endsShort === undefined || r.endsShort === endDepth < edges.shortBelow) &&
        (r.breaksShort === undefined || r.breaksShort === (depthBucket(breakDepth, edges) === "short")) &&
        (r.back === undefined || r.back === as.back) &&
        (r.screen === undefined || r.screen === as.screen) &&
        (r.stemHeading === undefined || r.stemHeading.includes(stemHeading)) &&
        (r.stemLateral === undefined || r.stemLateral === stemLateral),
    ) ?? (t.families[t.families.length - 1] as { family: RouteFamily });
  const direction: RouteDirection = heading === "vertical" ? "vertical" : heading === "back" || lateral === "none" ? "back" : lateral;
  const crossesMiddle = alignX === 0 ? abs.some((p) => p[0] < 0) && abs.some((p) => p[0] > 0) : abs.some((p) => p[0] * alignX <= 0);
  // Where the ball is caught: the end of a route that runs on deep, the last break of any other (R1).
  const catchDepth = t.catchAtEnd.includes(row.family) ? endDepth : breakDepth;
  return { family: row.family, breakDepth, catchDepth, bucket: depthBucket(catchDepth, edges), direction, endSide: thirdOf(end[0], fieldWidthYards), crossesMiddle };
}

/** The gap a run hits when it crosses the line x yards from the ball. */
export function gapAt(x: number, t: ClassifierThresholds): RunGap {
  const [a, b, c] = t.gapEdgesYards;
  return Math.abs(x) < a ? "A" : Math.abs(x) < b ? "B" : Math.abs(x) < c ? "C" : "edge";
}

/** The lane of a rusher who reaches the line x yards from the ball. */
export function laneAt(x: number, t: ClassifierThresholds): "inside" | "edge" {
  return Math.abs(x) >= t.blitzEdgeFromYards ? "edge" : "inside";
}

function evalRule(rule: Rule, situation: Situation): boolean {
  if ("all" in rule) return rule.all.every((r) => evalRule(r, situation));
  if ("any" in rule) return rule.any.some((r) => evalRule(r, situation));
  if ("not" in rule) return !evalRule(rule.not, situation);
  const actual = situation[rule.field];
  switch (rule.op) {
    case "eq":
      return actual === rule.value;
    case "ne":
      return actual !== rule.value;
    case "lt":
      return actual < rule.value;
    case "lte":
      return actual <= rule.value;
    case "gt":
      return actual > rule.value;
    case "gte":
      return actual >= rule.value;
  }
}

/** Whether a situation tag's designed definition (config.situations) holds for a situation. Pure. */
export function tagApplies(tag: SituationTag, situation: Situation, config: Pick<PlaybookConfig, "situations">): boolean {
  const t = own(config.situations, tag);
  return t !== undefined && evalRule(t.rule, situation);
}

// ---------------------------------------------------------------- resolving designs

export interface ResolvedAssignment {
  readonly slot: string;
  readonly position: string;
  readonly use: string;
  readonly entry: LibraryEntry;
  readonly ref: AssignmentRef;
  /** The side a side-axis entry goes to, from the ref or (line defaults) the play side. */
  readonly to?: FieldSide;
}

function outermost(slots: readonly string[], alignment: SlotAlignment, position: string): Set<string> {
  const line = slots.filter((s) => positionOf(s) === position && own(alignment, s) !== undefined);
  const xs = line.map((s) => (alignment[s] as Pair)[0]);
  return new Set(line.length > 2 ? line.filter((s) => (alignment[s] as Pair)[0] === Math.min(...xs) || (alignment[s] as Pair)[0] === Math.max(...xs)) : []);
}

/**
 * Every on-field slot of an offense design with its library entry, after line defaults. Problems
 * (an unknown slot or id, a missing assignment or side) are pushed to `issues` and the slot is skipped.
 */
export function resolveOffense(design: OffenseDesign, playbook: Playbook, slots: readonly string[], issues: string[] = []): ResolvedAssignment[] {
  const lib = playbook.library.assignments;
  const alignment = own(playbook.alignments.offense, design.formation) ?? {};
  const side = playSide(design, alignment, playbook.config.positions);
  const concept = own(playbook.config.concepts, design.concept);
  const tackles = outermost(slots, alignment, "OL");
  const out: ResolvedAssignment[] = [];
  for (const k of Object.keys(design.assignments)) if (!slots.includes(k)) issues.push(`${design.id}: unknown slot ${k}`);
  for (const slot of slots) {
    const position = positionOf(slot);
    const listed = own(design.assignments, slot);
    let ref: AssignmentRef | undefined = listed === undefined ? undefined : refOf(listed);
    let lineDefault = false;
    if (ref === undefined && position === "OL") {
      lineDefault = true;
      if (design.line !== undefined) ref = refOf(design.line);
      else if (concept !== undefined) ref = { use: (tackles.has(slot) ? concept.line.OLT : undefined) ?? concept.line.OL };
    }
    if (ref === undefined) {
      issues.push(`${design.id}: no assignment for ${slot}`);
      continue;
    }
    const entry = own(lib, ref.use);
    if (entry === undefined) {
      issues.push(`${design.id}: unknown library id ${ref.use} at ${slot}`);
      continue;
    }
    const to = ref.to ?? (lineDefault ? (side ?? undefined) : undefined);
    const axis = "axis" in entry ? entry.axis : "none";
    if (axis === "side" && to === undefined) issues.push(`${design.id}: ${slot} uses ${ref.use}, which needs a side`);
    if (axis === "hole" && (side === null || concept?.family !== "run")) issues.push(`${design.id}: ${slot} uses ${ref.use}, which needs a run to a side`);
    if (axis !== "side" && ref.to !== undefined) issues.push(`${design.id}: ${slot} gives a side to ${ref.use}, which takes none`);
    out.push({ slot, position, use: ref.use, entry, ref, ...(to === undefined ? {} : { to }) });
  }
  return out;
}

/** Every on-field slot of a defense design with its library entry, after the linemen's default rush. */
export function resolveDefense(design: DefenseDesign, playbook: Playbook, slots: readonly string[], issues: string[] = []): ResolvedAssignment[] {
  const lib = playbook.library.assignments;
  const alignment = defenseAlignment(design, playbook.alignments);
  const ends = outermost(slots, alignment, "DL");
  const out: ResolvedAssignment[] = [];
  for (const k of Object.keys(design.assignments)) if (!slots.includes(k)) issues.push(`${design.id}: unknown slot ${k}`);
  for (const k of Object.keys(design.alignment ?? {})) if (!slots.includes(k)) issues.push(`${design.id}: alignment for unknown slot ${k}`);
  for (const slot of slots) {
    const position = positionOf(slot);
    const listed = own(design.assignments, slot);
    const ref: AssignmentRef | undefined = listed !== undefined ? refOf(listed) : position === "DL" ? { use: ends.has(slot) ? playbook.config.defenseDefaults.DLE : playbook.config.defenseDefaults.DL } : undefined;
    if (ref === undefined) {
      issues.push(`${design.id}: no assignment for ${slot}`);
      continue;
    }
    const entry = own(lib, ref.use);
    if (entry === undefined) {
      issues.push(`${design.id}: unknown library id ${ref.use} at ${slot}`);
      continue;
    }
    out.push({ slot, position, use: ref.use, entry, ref });
  }
  return out;
}

// ---------------------------------------------------------------- checks (A2 to A8)

const OFFENSE_KINDS: ReadonlySet<string> = new Set(["route", "block", "runPath", "qb"]);
const DEFENSE_KINDS: ReadonlySet<string> = new Set(["rush", "blitz", "zone", "man", "spy", "stunt"]);
const RUSH_KINDS: ReadonlySet<string> = new Set(["rush", "blitz", "stunt"]);

function inRange(n: number, r: CountRange | string | undefined): boolean {
  return Array.isArray(r) && n >= (r[0] as number) && (r[1] === null || n <= (r[1] as number));
}

function checkTags(id: string, situations: readonly string[], traits: readonly string[], allowed: readonly string[], issues: string[]): void {
  if (new Set(situations).size !== situations.length) issues.push(`${id}: a situation tag is listed twice`);
  if (new Set(traits).size !== traits.length) issues.push(`${id}: a trait is listed twice`);
  for (const t of traits) if (!allowed.includes(t)) issues.push(`${id}: trait ${t} is not in the closed list for this kind of design`);
}

function checkGroups<D extends { id: string; label: string; default: boolean }>(designs: readonly D[], keyOf: (d: D) => string, wanted: readonly string[], max: number, issues: string[]): void {
  const groups = new Map<string, D[]>(wanted.map((k) => [k, []]));
  for (const d of designs) groups.get(keyOf(d))?.push(d);
  for (const [key, list] of groups) {
    if (list.length === 0) issues.push(`engine call ${key} has no design`);
    if (list.length > max) issues.push(`engine call ${key} has ${list.length} designs, more than ${max}`);
    const defaults = list.filter((d) => d.default).length;
    if (list.length > 0 && defaults !== 1) issues.push(`engine call ${key} has ${defaults} default designs, not 1`);
    if (new Set(list.map((d) => d.label)).size !== list.length) issues.push(`engine call ${key} has two designs with the same label`);
  }
}

function checkOffenseDesign(d: OffenseDesign, pb: Playbook, refs: PlaybookRefs, issues: string[]): void {
  const counts = own(refs.personnel.offense, d.formation);
  const concept = own(pb.config.concepts, d.concept);
  if (counts === undefined) return void issues.push(`${d.id}: unknown formation ${d.formation}`);
  if (concept === undefined) return void issues.push(`${d.id}: unknown concept ${d.concept}`);
  const alignment = own(pb.alignments.offense, d.formation) ?? {};
  const slots = slotsOf(counts);
  const res = resolveOffense(d, pb, slots, issues);
  const side = playSide(d, alignment, pb.config.positions);
  const isRun = concept.family === "run";
  for (const r of res) {
    if (!OFFENSE_KINDS.has(r.entry.kind)) issues.push(`${d.id}: ${r.slot} has a defense assignment (${r.use})`);
    if (r.position === "OL" && r.entry.kind !== "block") issues.push(`${d.id}: lineman ${r.slot} must block`);
    if (r.position === "QB" && r.entry.kind !== "qb" && r.entry.kind !== "runPath") issues.push(`${d.id}: the quarterback needs a quarterback action or the run path`);
    if (r.position !== "QB" && r.entry.kind === "qb") issues.push(`${d.id}: ${r.slot} has a quarterback action`);
    if (r.ref.depth !== undefined && r.entry.kind !== "route") issues.push(`${d.id}: ${r.slot} gives a depth to ${r.use}, which is not a route`);
    if (r.ref.primary === true && r.entry.kind !== "route") issues.push(`${d.id}: ${r.slot} is primary but runs no route`);
    if (r.ref.at !== undefined || r.ref.with !== undefined) issues.push(`${d.id}: ${r.slot} has a defense-only field`);
    if (r.entry.kind === "block" && r.entry.block !== (isRun ? "run" : "pass")) issues.push(`${d.id}: ${r.slot} has a ${r.entry.block} block on a ${concept.family} design`);
  }
  const carriers = res.filter((r) => r.entry.kind === "runPath");
  const routes = res.filter((r) => r.entry.kind === "route");
  const qb = res.find((r) => r.position === "QB");
  if (isRun) {
    if (carriers.length !== 1) issues.push(`${d.id}: a run needs exactly one ball carrier, found ${carriers.length}`);
    const c = carriers[0];
    if (c !== undefined) {
      if (c.slot !== d.carrier) issues.push(`${d.id}: carrier is ${String(d.carrier)} but ${c.slot} has the run path`);
      if (c.position !== "RB" && c.position !== "QB") issues.push(`${d.id}: the ball carrier must be a running back or the quarterback`);
      if (c.entry.kind === "runPath" && !(concept.gaps ?? []).includes(c.entry.gap)) issues.push(`${d.id}: gap ${c.entry.gap} is outside the concept's gaps`);
      if ((c.to ?? null) !== side) issues.push(`${d.id}: side ${d.side} does not match the ball carrier's side`);
    }
    if (routes.length > 0) issues.push(`${d.id}: a run design has a route`);
    if (qb !== undefined && qb.entry.kind === "qb" && qb.entry.action !== "handoff") issues.push(`${d.id}: the quarterback must hand off or carry on a run`);
    if (d.tags.depth !== undefined) issues.push(`${d.id}: a run design has a depth tag`);
  } else {
    if (carriers.length > 0 || d.carrier !== undefined) issues.push(`${d.id}: a pass design has a ball carrier`);
    if (qb === undefined || qb.entry.kind !== "qb" || qb.entry.action === "handoff") issues.push(`${d.id}: a pass needs a quarterback drop or rollout`);
    else {
      if (d.concept === "playAction" && !qb.entry.fake) issues.push(`${d.id}: play action needs a fake`);
      if (d.concept !== "playAction" && qb.entry.fake) issues.push(`${d.id}: a fake on a design that is not play action`);
      if (qb.entry.action === "rollout" && (qb.to ?? null) !== side) issues.push(`${d.id}: side ${d.side} does not match the rollout`);
      // The back goes where the fake went, and away from a rollout.
      if (qb.entry.fake && qb.to !== undefined) {
        const fakeTo: FieldSide = (qb.entry.action === "rollout") === (qb.to === "right") ? "left" : "right";
        for (const r of res) if (pb.config.positions.backs.includes(r.position) && r.to !== undefined && r.to !== fakeTo) issues.push(`${d.id}: the fake goes ${fakeTo} but ${r.slot} goes ${r.to}`);
      }
    }
    if (routes.length === 0) issues.push(`${d.id}: a pass needs at least one route`);
    const primary = res.filter((r) => r.ref.primary === true);
    if (primary.length !== 1) issues.push(`${d.id}: a pass needs exactly one primary route, found ${primary.length}`);
    const p = primary[0];
    // By where the route ends, never by its declared family (R15).
    if (d.concept === "screenPass" && !(p !== undefined && p.entry.kind === "route" && declaredEnd(p.entry, own(alignment, p.slot) ?? [0, 0], p.ref.depth) <= 0)) issues.push(`${d.id}: a screen's primary route must be a screen behind the line`);
    if (d.tags.depth === undefined) issues.push(`${d.id}: a pass design needs a depth tag`);
  }
  checkTags(d.id, d.tags.situations, d.traits, isRun ? RUN_TRAITS : PASS_TRAITS, issues);
}

function checkLandmark(id: string, who: string, zone: ZoneEntry, at: Pair | undefined, pb: Playbook, refs: PlaybookRefs, issues: string[]): void {
  if (at === undefined) return void issues.push(`${id}: zone at ${who} needs a landmark`);
  if (thirdOf(at[0], pb.config.field.widthYards) !== zone.third) issues.push(`${id}: ${who}'s landmark is not in the ${zone.third} third`);
  if ((at[1] >= refs.depthEdges.shortBelow ? "deep" : "under") !== zone.level) issues.push(`${id}: ${who}'s landmark depth does not match ${zone.level}`);
  if (Math.abs(at[0]) > pb.config.field.widthYards / 2 || at[1] <= 0 || at[1] > MIDFIELD_YARDS) issues.push(`${id}: ${who}'s landmark is off the field or not past the line`);
}

function checkDefenseDesign(d: DefenseDesign, pb: Playbook, refs: PlaybookRefs, issues: string[]): void {
  const pkg = own(refs.personnel.presetPackage, d.coverage);
  const preset = own(refs.presets, d.coverage);
  if (pkg === undefined || preset === undefined) return void issues.push(`${d.id}: unknown preset ${d.coverage}`);
  if (pkg !== d.package) return void issues.push(`${d.id}: preset ${d.coverage} is in package ${pkg}, not ${d.package}`);
  const slots = slotsOf(own(refs.personnel.packages, pkg) ?? {});
  const alignment = defenseAlignment(d, pb.alignments);
  const res = resolveDefense(d, pb, slots, issues);
  const bySlot = new Map(res.map((r) => [r.slot, r]));
  for (const r of res) {
    if (!DEFENSE_KINDS.has(r.entry.kind)) issues.push(`${d.id}: ${r.slot} has an offense assignment (${r.use})`);
    if (r.ref.to !== undefined || r.ref.depth !== undefined || r.ref.primary !== undefined) issues.push(`${d.id}: ${r.slot} has an offense-only field`);
    if (r.entry.kind === "zone") checkLandmark(d.id, r.slot, r.entry, r.ref.at, pb, refs, issues);
    else if (r.ref.at !== undefined) issues.push(`${d.id}: ${r.slot} gives a landmark to ${r.use}, which is not a zone`);
    if (r.entry.kind === "stunt") {
      const partner = r.ref.with === undefined ? undefined : bySlot.get(r.ref.with);
      if (r.position !== "DL" || partner === undefined || partner.position !== "DL" || partner.entry.kind !== "stunt" || partner.ref.with !== r.slot) issues.push(`${d.id}: stunt at ${r.slot} needs a lineman partner who stunts with him`);
    } else if (r.ref.with !== undefined) issues.push(`${d.id}: ${r.slot} gives a partner to ${r.use}, which is not a stunt`);
  }
  const rushers = res.filter((r) => RUSH_KINDS.has(r.entry.kind)).length;
  const deep = res.filter((r) => r.entry.kind === "zone" && r.entry.level === "deep").length;
  const man = res.filter((r) => r.entry.kind === "man");
  if (!inRange(rushers, pb.config.rush[preset.rush])) issues.push(`${d.id}: ${rushers} rushers is outside the preset's rush (${preset.rush})`);
  if (!inRange(deep, pb.config.shells[preset.shell])) issues.push(`${d.id}: ${deep} deep defenders is outside the preset's shell (${preset.shell})`);
  if (preset.manZone === "zone" && man.length > 0) issues.push(`${d.id}: man coverage in a zone preset`);
  if (preset.manZone === "man" && man.length === 0) issues.push(`${d.id}: no man coverage in a man preset`);
  if (man.length > 0) {
    for (const [formation, a] of Object.entries(pb.alignments.offense)) {
      const roles = formationRoles(a, pb.config.positions);
      const covered = new Set<ManRole>();
      let rush = rushers;
      let deepNow = deep;
      for (const r of man) {
        if (r.entry.kind !== "man") continue;
        const now = manAgainst(r.entry, roles);
        if (now === null) issues.push(`${d.id}: ${r.slot} (${r.use}) has nobody to cover against ${formation} and no fallback`);
        else if ("role" in now) covered.add(now.role);
        else {
          const f = own(pb.library.assignments, now.fallback.use);
          if (f !== undefined && RUSH_KINDS.has(f.kind)) rush++;
          if (f?.kind === "zone" && f.level === "deep") deepNow++;
        }
      }
      for (const role of Object.keys(roles)) if (!covered.has(role as ManRole)) issues.push(`${d.id}: nobody covers ${role} against ${formation}`);
      if (!inRange(rush, pb.config.rush[preset.rush])) issues.push(`${d.id}: ${rush} rushers against ${formation} is outside the preset's rush (${preset.rush})`);
      if (!inRange(deepNow, pb.config.shells[preset.shell])) issues.push(`${d.id}: ${deepNow} deep defenders against ${formation} is outside the preset's shell (${preset.shell})`);
    }
  }
  const box = slots.filter((s) => own(alignment, s) !== undefined && Math.abs((alignment[s] as Pair)[0]) <= pb.config.box.halfWidthYards && (alignment[s] as Pair)[1] <= pb.config.box.maxDepthYards).length;
  if (preset.box === "heavy" && box < refs.boxHeavyMin) issues.push(`${d.id}: ${box} in the box, the preset needs ${refs.boxHeavyMin}`);
  if (preset.box === "light" && box >= refs.boxHeavyMin) issues.push(`${d.id}: ${box} in the box, the preset needs fewer than ${refs.boxHeavyMin}`);
  checkTags(d.id, d.tags.situations, d.traits, DEFENSE_TRAITS, issues);
}

/**
 * Cross-file checks on a playbook whose files already have the right shape (criteria A2 to A6 and
 * A8): every problem as one line, empty when the playbook is sound.
 */
export function checkPlaybook(pb: Playbook, refs: PlaybookRefs): string[] {
  const issues: string[] = [];
  for (const [id, e] of Object.entries(pb.library.assignments)) {
    if (!("pts" in e)) continue;
    if (e.axis === "none" && e.pts.some((p) => p[0] !== 0)) issues.push(`library ${id}: a lateral move on an entry with no axis`);
    if (e.kind === "route" && e.breakAt >= e.pts.length) issues.push(`library ${id}: breakAt is past the last waypoint`);
  }
  for (const [id, e] of Object.entries(pb.library.assignments)) {
    if (e.kind !== "man" || e.fallback === undefined) continue;
    const f = own(pb.library.assignments, e.fallback.use);
    if (f === undefined || !["rush", "spy", "zone"].includes(f.kind)) issues.push(`library ${id}: fallback ${e.fallback.use} is not a rush, spy or zone in the library`);
    else if (f.kind === "zone") checkLandmark(`library ${id}`, "the fallback", f, e.fallback.at, pb, refs, issues);
    else if (e.fallback.at !== undefined) issues.push(`library ${id}: the fallback gives a landmark to ${e.fallback.use}, which is not a zone`);
  }
  for (const [name, c] of Object.entries(pb.config.concepts)) {
    for (const use of [c.line.OL, c.line.OLT]) if (use !== undefined && own(pb.library.assignments, use)?.kind !== "block") issues.push(`concept ${name}: line block ${use} is not a block in the library`);
  }
  for (const use of [pb.config.defenseDefaults.DL, pb.config.defenseDefaults.DLE]) if (own(pb.library.assignments, use)?.kind !== "rush") issues.push(`defenseDefaults: ${use} is not a rush in the library`);
  const ids = new Set<string>();
  for (const d of [...pb.offense.designs, ...pb.defense.designs]) {
    if (ids.has(d.id)) issues.push(`duplicate design id ${d.id}`);
    ids.add(d.id);
  }
  for (const d of pb.offense.designs) checkOffenseDesign(d, pb, refs, issues);
  for (const d of pb.defense.designs) checkDefenseDesign(d, pb, refs, issues);
  const pairs = Object.keys(refs.personnel.offense).flatMap((f) => Object.keys(pb.config.concepts).map((c) => `${f}.${c}`));
  checkGroups(pb.offense.designs, (d) => `${d.formation}.${d.concept}`, pairs, pb.config.maxGroupSize, issues);
  checkGroups(pb.defense.designs, (d) => d.coverage, Object.keys(refs.personnel.presetPackage), pb.config.maxGroupSize, issues);
  return issues;
}
