// What a design's words must mean (docs/specs/m3-playbook-and-custom-routes.md, R7, R10, A8): the
// traits, the pressure tag, the depth tag and the situation tags, derived from a design's
// assignments by the rules in data/plays/config.json, and the features the engine will read, so
// two designs in a group can be told apart. Also what a library entry declares against what its
// placed path is (R19), and the bounds checks on alignments and paths. Designed, pure. Load-time checks only: packages/sim does not import this file.

import { POSITIONS } from "./engine";
import {
  absolutePath,
  breakPoints,
  declaredCatchDepth,
  declaredDepth,
  defenseAlignment,
  depthBucket,
  formationRoles,
  gapAt,
  holeOf,
  laneAt,
  lineCrossing,
  manAgainst,
  own,
  placePath,
  positionOf,
  quantize,
  readRoute,
  resolveDefense,
  resolveOffense,
  segs,
  slotsOf,
  SITUATION_TAGS,
  thirdOf,
  wholeYards,
  MIDFIELD_YARDS,
} from "./playbook";
import type { DefenseDesign, DepthBucket, Hole, LibraryEntry, ManRole, OffenseDesign, Pair, PathPoint, Playbook, PlaybookRefs, Pressure, ResolvedAssignment, RouteDirection, RouteFamily, SlotAlignment, TagFit, Third, Timing } from "./playbook";

/** A route as the engine reads it, from the library's declared family and the placed waypoints. */
export interface RouteRead {
  readonly slot: string;
  readonly position: string;
  readonly family: RouteFamily;
  readonly direction: RouteDirection;
  readonly breakDepth: number;
  readonly catchDepth: number;
  readonly bucket: DepthBucket;
  readonly endSide: Third;
  readonly crossesMiddle: boolean;
  readonly primary: boolean;
}

const offenseSlots = (d: OffenseDesign, refs: PlaybookRefs) => slotsOf(own(refs.personnel.offense, d.formation) ?? {});
const defenseSlots = (d: DefenseDesign, refs: PlaybookRefs) => slotsOf(own(refs.personnel.packages, d.package) ?? {});
const offenseAlign = (d: OffenseDesign, pb: Playbook): SlotAlignment => own(pb.alignments.offense, d.formation) ?? {};

export function routesOf(d: OffenseDesign, pb: Playbook, refs: PlaybookRefs): RouteRead[] {
  const alignment = offenseAlign(d, pb);
  return resolveOffense(d, pb, offenseSlots(d, refs)).flatMap((r) => {
    const align = own(alignment, r.slot);
    if (r.entry.kind !== "route" || align === undefined) return [];
    const xs = placePath(r.entry, align, r.to, r.ref.depth).map((p) => align[0] + p[0]);
    const catchDepth = declaredCatchDepth(r.entry, align, r.ref.depth, pb.config.classifier.catchAtEnd);
    return [
      {
        slot: r.slot,
        position: r.position,
        family: r.entry.family,
        direction: r.entry.direction,
        breakDepth: wholeYards(declaredDepth(r.entry, align, r.ref.depth)),
        catchDepth,
        bucket: depthBucket(catchDepth, refs.depthEdges),
        endSide: thirdOf(xs[xs.length - 1] as number, pb.config.field.widthYards),
        crossesMiddle: align[0] === 0 ? xs.some((x) => x < 0) && xs.some((x) => x > 0) : xs.some((x) => x * align[0] <= 0),
        primary: r.ref.primary === true,
      },
    ];
  });
}

/** Linemen and any other player kept in: a block that is not downfield. */
function protectorsOf(res: readonly ResolvedAssignment[]): number {
  return res.filter((r) => r.entry.kind === "block" && r.entry.technique !== "stalk").length;
}

// ---------------------------------------------------------------- traits

export function offenseTraits(d: OffenseDesign, pb: Playbook, refs: PlaybookRefs): string[] {
  const t = pb.config.traits.thresholds;
  const res = resolveOffense(d, pb, offenseSlots(d, refs));
  const out: string[] = [];
  const add = (name: string, when: boolean) => void (when && out.push(name));
  if (own(pb.config.concepts, d.concept)?.family === "run") {
    const line = res.flatMap((r) => (r.position === "OL" && r.entry.kind === "block" ? [r.entry.technique] : []));
    const lineHas = (...techniques: string[]) => line.filter((x) => techniques.includes(x)).length >= t.lineMin;
    const run = res.find((r) => r.entry.kind === "runPath")?.entry;
    add("zone", lineHas("zone"));
    add("gap", lineHas("down", "base"));
    add("misdirection", (run?.kind === "runPath" && run.counter) || lineHas("draw"));
    add("perimeter", run?.kind === "runPath" && run.gap === "edge");
    add("lead", res.some((r) => r.position !== "OL" && r.entry.kind === "block" && r.entry.technique === "lead"));
    add("wedge", lineHas("wedge"));
    return out;
  }
  const routes = routesOf(d, pb, refs);
  const qb = res.find((r) => r.entry.kind === "qb")?.entry;
  const primary = routes.find((r) => r.primary);
  const alignment = offenseAlign(d, pb);
  const receivers = routes.filter((r) => pb.config.positions.receivers.includes(r.position));
  const outside = (["left", "right"] as const).map((side) => routes.filter((r) => r.endSide === side).map((r) => r.catchDepth).sort((a, b) => a - b));
  const inBreaking = routes.filter((r) => r.family === "drag" || r.family === "in").map((r) => r.catchDepth);
  const onHisSide = primary === undefined ? [] : receivers.filter((r) => Math.sign((alignment[r.slot] as Pair)[0]) === Math.sign((alignment[primary.slot] as Pair)[0]));
  const screen = d.concept === "screenPass" && primary !== undefined;
  add("quick", qb?.kind === "qb" && qb.drop === "quick");
  add("crossers", receivers.filter((r) => r.crossesMiddle).length >= t.crossersMin);
  add("highLow", outside.some((ds) => ds.some((hi) => hi >= t.highMinYards && ds.some((lo) => lo <= t.lowMaxYards && hi - lo >= t.highLowGapYards))));
  add("flood", outside.some((ds) => ds.reduce((n, x) => (n.last === undefined || x - n.last >= t.floodGapYards ? { count: n.count + 1, last: x } : n), { count: 0, last: undefined as number | undefined }).count >= t.floodMin));
  add("verticals", routes.filter((r) => r.direction === "vertical" && r.bucket === "deep").length >= t.verticalsMin);
  add("levels", inBreaking.length > 1 && Math.max(...inBreaking) - Math.min(...inBreaking) >= t.levelsGapYards);
  add("isolation", !screen && primary !== undefined && receivers.includes(primary) && onHisSide.length === 1);
  add("screenBack", screen && t.screenBackPositions.includes(primary.position));
  add("screenWide", screen && !t.screenBackPositions.includes(primary.position));
  add("boot", qb?.kind === "qb" && qb.fake && qb.action === "rollout");
  return out;
}

/** A defense design's assignments as counts and places. */
export interface DefenseRead {
  readonly rushers: readonly { readonly slot: string; readonly kind: string; readonly lane: "inside" | "edge"; readonly x: number }[];
  readonly deep: readonly { readonly slot: string; readonly third: Third }[];
  readonly under: readonly { readonly slot: string; readonly third: Third }[];
  readonly man: readonly { readonly slot: string; readonly covers: readonly ManRole[] }[];
  readonly spies: readonly string[];
  readonly box: number;
}

export function readDefense(d: DefenseDesign, pb: Playbook, refs: PlaybookRefs): DefenseRead {
  const slots = defenseSlots(d, refs);
  const alignment = defenseAlignment(d, pb.alignments);
  const res = resolveDefense(d, pb, slots).filter((r) => own(alignment, r.slot) !== undefined);
  const at = (slot: string) => alignment[slot] as Pair;
  return {
    rushers: res.flatMap((r) => {
      if (r.entry.kind !== "rush" && r.entry.kind !== "blitz" && r.entry.kind !== "stunt") return [];
      const abs = placePath(r.entry, at(r.slot)).map((p): Pair => [at(r.slot)[0] + p[0], at(r.slot)[1] + p[1]]);
      return [{ slot: r.slot, kind: r.entry.kind, lane: r.entry.lane, x: lineCrossing(abs, -1) ?? (abs[abs.length - 1] as Pair)[0] }];
    }),
    deep: res.flatMap((r) => (r.entry.kind === "zone" && r.entry.level === "deep" ? [{ slot: r.slot, third: r.entry.third }] : [])),
    under: res.flatMap((r) => (r.entry.kind === "zone" && r.entry.level === "under" ? [{ slot: r.slot, third: r.entry.third }] : [])),
    man: res.flatMap((r) => (r.entry.kind === "man" ? [{ slot: r.slot, covers: r.entry.covers }] : [])),
    spies: res.filter((r) => r.entry.kind === "spy").map((r) => r.slot),
    box: slots.filter((s) => own(alignment, s) !== undefined && Math.abs(at(s)[0]) <= pb.config.box.halfWidthYards && at(s)[1] <= pb.config.box.maxDepthYards).length,
  };
}

export function defenseTraits(d: DefenseDesign, pb: Playbook, refs: PlaybookRefs): string[] {
  const t = pb.config.traits.thresholds;
  const p = pb.config.positions;
  const alignment = defenseAlignment(d, pb.alignments);
  const slots = defenseSlots(d, refs);
  const read = readDefense(d, pb, refs);
  const res = resolveDefense(d, pb, slots);
  const isAt = (slot: string, positions: readonly string[]) => positions.includes(positionOf(slot));
  const depth = (slot: string) => (own(alignment, slot) ?? [0, 0])[1];
  const deepSafeties = read.deep.filter((x) => isAt(x.slot, p.safeties)).length;
  const side = (s: 1 | -1) => read.rushers.filter((r) => Math.sign(r.x) === s).length;
  const droppedLineman = res.some((r) => r.position === "DL" && !["rush", "blitz", "stunt"].includes(r.entry.kind));
  const offLine = read.rushers.some((r) => !isAt(r.slot, ["DL"]));
  const dl = slots.filter((s) => isAt(s, ["DL"])).map((s) => (own(alignment, s) ?? [0, 0])[0]);
  const pinching = res.filter((r) => {
    if (r.position !== "DL" || r.entry.kind !== "rush") return false;
    const x = (own(alignment, r.slot) ?? [0, 0])[0];
    if (x !== Math.min(...dl) && x !== Math.max(...dl)) return false;
    const end = placePath(r.entry, own(alignment, r.slot) ?? [0, 0]).slice(-1)[0] as Pair;
    return Math.abs(x) - Math.abs(x + end[0]) >= t.pinchMoveYards;
  });
  const bracket = read.man.length > 0 && Object.values(pb.alignments.offense).every((a) => {
    const roles = formationRoles(a, p);
    const covered = res.flatMap((r) => {
      const now = r.entry.kind === "man" ? manAgainst(r.entry, roles) : null;
      return now !== null && "role" in now ? [now.role] : [];
    });
    return new Set(covered).size < covered.length;
  });
  const out: string[] = [];
  const add = (name: string, when: boolean) => void (when && out.push(name));
  add("singleHigh", deepSafeties === 1);
  add("twoHigh", deepSafeties === 2);
  add("fourDeep", read.deep.length >= t.fourDeepMin);
  add("noDeep", read.deep.length === 0);
  add("man", read.man.length > 0);
  add("zone", read.man.length === 0 && read.deep.length + read.under.length > 0);
  add("pressure", read.rushers.length >= t.pressureMin);
  add("overload", Math.abs(side(1) - side(-1)) >= t.overloadMin);
  add("exchange", droppedLineman && offLine && read.rushers.length <= t.exchangeMax);
  add("stunt", read.rushers.some((r) => r.kind === "stunt"));
  add("spy", read.spies.length > 0);
  add("press", slots.filter((s) => isAt(s, p.corners) && depth(s) <= pb.config.box.pressMaxDepthYards).length >= t.pressMin);
  add("robber", read.man.length > 0 && read.under.some((x) => isAt(x.slot, p.safeties) && depth(x.slot) >= pb.config.box.robberMinDepthYards));
  add("bracket", bracket);
  add("loadedBox", read.box >= refs.boxHeavyMin);
  add("lightBox", read.box <= pb.config.box.lightBoxMax);
  add("pinch", pinching.length >= t.pinchMin);
  return out;
}

/** The pressure tag: exchange is the trait, blitz is five or more rushers with one from off the line. */
export function pressureOf(d: DefenseDesign, pb: Playbook, refs: PlaybookRefs): Pressure {
  const read = readDefense(d, pb, refs);
  if (read.rushers.length >= pb.config.traits.thresholds.pressureMin && read.rushers.some((r) => positionOf(r.slot) !== "DL")) return "blitz";
  return defenseTraits(d, pb, refs).includes("exchange") ? "exchange" : "none";
}

// ---------------------------------------------------------------- situation and timing tags

/** The timing tags a design may carry: the first row of config.timing for its side that it meets. */
export function timingsOf(d: OffenseDesign | DefenseDesign, pb: Playbook, refs: PlaybookRefs): readonly Timing[] {
  return pb.config.timing["formation" in d ? "offense" : "defense"].find((row) => situationFits([row.when], d, pb, refs))?.allow ?? [];
}

/** Whether a design meets one row of a tag's design rules (config.situations[tag].designs, config.timing). */
export function situationFits(fits: readonly TagFit[], d: OffenseDesign | DefenseDesign, pb: Playbook, refs: PlaybookRefs): boolean {
  const onOffense = "formation" in d;
  const res = onOffense ? resolveOffense(d, pb, offenseSlots(d, refs)) : [];
  const run = res.find((r) => r.entry.kind === "runPath")?.entry;
  const primary = res.find((r) => r.ref.primary === true)?.entry;
  const qb = res.find((r) => r.entry.kind === "qb")?.entry;
  const late = (from: number) => onOffense && routesOf(d, pb, refs).some((r) => r.primary && (r.breakDepth >= from || r.bucket === "deep"));
  return fits.some(
    (f) =>
      (f.family === undefined || (onOffense && own(pb.config.concepts, d.concept)?.family === f.family)) &&
      (f.concepts === undefined || (onOffense && f.concepts.includes(d.concept))) &&
      (f.gaps === undefined || (run?.kind === "runPath" && f.gaps.includes(run.gap))) &&
      (f.depth === undefined || (onOffense && d.tags.depth !== undefined && f.depth.includes(d.tags.depth))) &&
      (f.timing === undefined || f.timing.includes(d.tags.timing)) &&
      (f.minProtectors === undefined || protectorsOf(res) >= f.minProtectors) &&
      (f.primary === undefined || (primary?.kind === "route" && f.primary.includes(primary.family))) &&
      (f.drop === undefined || (qb?.kind === "qb" && qb.drop !== undefined && f.drop.includes(qb.drop))) &&
      (f.fake === undefined || (qb?.kind === "qb" && qb.fake === f.fake)) &&
      (f.primaryLateFrom === undefined || late(f.primaryLateFrom)) &&
      (f.coverage === undefined || (!onOffense && f.coverage.includes(d.coverage))) &&
      (f.pressure === undefined || (!onOffense && f.pressure.includes(d.tags.pressure))) &&
      (f.traits === undefined || f.traits.some((t) => d.traits.includes(t))),
  );
}

// ---------------------------------------------------------------- what tells two designs apart (R10)

/** What the engine will read of an offense design: no ids, no paths, no drop. */
export function offenseSignature(d: OffenseDesign, pb: Playbook, refs: PlaybookRefs): string {
  const res = resolveOffense(d, pb, offenseSlots(d, refs));
  const traits = [...d.traits].sort();
  const run = res.find((r) => r.entry.kind === "runPath");
  if (run !== undefined && run.entry.kind === "runPath") {
    const hole = holeOf(res, offenseAlign(d, pb));
    const side = hole === null || Math.abs(hole.x) <= pb.config.classifier.sideMiddleYards ? "middle" : hole.sign > 0 ? "right" : "left";
    const leads = res.filter((r) => r.entry.kind === "block" && (r.entry.technique === "lead" || r.entry.technique === "pull")).length;
    return JSON.stringify({ traits, gap: run.entry.gap, side, leads });
  }
  const routes = routesOf(d, pb, refs).map((r) => JSON.stringify([r.family, r.direction, r.catchDepth, r.endSide, r.crossesMiddle, r.primary]));
  return JSON.stringify({ traits, protectors: protectorsOf(res), routes: routes.sort() });
}

export function defenseSignature(d: DefenseDesign, pb: Playbook, refs: PlaybookRefs): string {
  const read = readDefense(d, pb, refs);
  const m = pb.config.classifier.sideMiddleYards;
  return JSON.stringify({
    traits: [...d.traits].sort(),
    rush: read.rushers.map((r) => `${r.lane} ${Math.abs(r.x) <= m ? "middle" : r.x > 0 ? "right" : "left"}`).sort(),
    deep: read.deep.map((x) => x.third).sort(),
    under: read.under.map((x) => x.third).sort(),
    man: read.man.map((x) => x.covers.join()).sort(),
    spies: read.spies.length,
    box: read.box,
  });
}

// ---------------------------------------------------------------- checks

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

function checkSlots(where: string, alignment: SlotAlignment, slots: readonly string[], whole: boolean, pb: Playbook, issues: string[]): void {
  const half = pb.config.field.widthYards / 2;
  if (whole) for (const s of slots) if (own(alignment, s) === undefined) issues.push(`alignments ${where}: no place for ${s}`);
  for (const [s, a] of Object.entries(alignment)) {
    if (!slots.includes(s)) issues.push(`alignments ${where}: unknown slot ${s}`);
    if (Math.abs(a[0]) > half || a[1] < 0 || a[1] > MIDFIELD_YARDS) issues.push(`alignments ${where}: ${s} is off the field or past the line`);
  }
}

function checkAlignments(pb: Playbook, refs: PlaybookRefs, issues: string[]): void {
  for (const [side, counts] of [["offense", refs.personnel.offense], ["defense", refs.personnel.packages]] as const) {
    for (const [name, c] of Object.entries(counts)) {
      const a = own(pb.alignments[side], name);
      if (a === undefined) issues.push(`alignments ${side}: no ${name}`);
      else checkSlots(`${side}.${name}`, a, slotsOf(c), true, pb, issues);
    }
    for (const name of Object.keys(pb.alignments[side])) if (own(counts, name) === undefined) issues.push(`alignments ${side}: unknown ${name}`);
  }
  for (const [preset, a] of Object.entries(pb.alignments.presetAlignment)) {
    const pkg = own(refs.personnel.presetPackage, preset);
    if (pkg === undefined) issues.push(`alignments presetAlignment: unknown preset ${preset}`);
    else checkSlots(`presetAlignment.${preset}`, a, slotsOf(own(refs.personnel.packages, pkg) ?? {}), false, pb, issues);
  }
  for (const d of pb.defense.designs) if (d.alignment !== undefined) checkSlots(d.id, d.alignment, defenseSlots(d, refs), false, pb, issues);
}

/** An assignment's path from where the player lines up, or null when it has none (a man, a spy). */
function assignedPath(entry: LibraryEntry, align: Pair, at: Pair | undefined, r: ResolvedAssignment, hole: Hole | undefined): PathPoint[] | null {
  if ("pts" in entry) return placePath(entry, align, r.to, r.ref.depth, hole);
  return entry.kind === "zone" && at !== undefined ? [[0, 0], [at[0] - align[0], at[1] - align[1]]] : null;
}

/** What an entry declares, against the canonical path it is placed on (R19). */
function checkDeclared(where: string, use: string, entry: LibraryEntry, path: readonly PathPoint[], align: Pair, r: ResolvedAssignment, screen: boolean, pb: Playbook, refs: PlaybookRefs, issues: string[]): void {
  const t = pb.config.classifier;
  if (entry.kind === "route") {
    if (path.length < 2) return void issues.push(`${where}: ${use} goes nowhere`);
    const is = readRoute(path, align, { back: pb.config.positions.backs.includes(r.position), screen }, t, refs.depthEdges, pb.config.field.widthYards);
    if (is.family !== entry.family) issues.push(`${where}: ${use} is declared ${entry.family}, its path is ${is.family}`);
    if (is.direction !== entry.direction) issues.push(`${where}: ${use} is declared to go ${entry.direction}, its path goes ${is.direction}`);
    const depth = declaredCatchDepth(entry, align, r.ref.depth, t.catchAtEnd);
    if (is.catchDepth !== depth) issues.push(`${where}: ${use} is declared caught at ${depth}, its path says ${is.catchDepth}`);
    // A vertical route's waypoint is its end, not a break.
    else if (entry.direction !== "vertical" && is.breakDepth !== wholeYards(declaredDepth(entry, align, r.ref.depth))) issues.push(`${where}: ${use}'s breakAt is not where its path breaks`);
  } else if (entry.kind === "runPath") {
    const x = lineCrossing(absolutePath(path, align, true), 1);
    if (x === undefined) issues.push(`${where}: ${use} never crosses the line`);
    else if (gapAt(x, t) !== entry.gap) issues.push(`${where}: ${use} is declared gap ${entry.gap}, its path crosses in gap ${gapAt(x, t)}`);
    const away = r.to !== undefined && path.length > 1 && (path[1] as PathPoint)[0] * (r.to === "left" ? -1 : 1) < 0;
    if (away !== entry.counter) issues.push(`${where}: ${use} is declared counter ${entry.counter}, its first step goes ${away ? "away from" : "to"} the play side`);
  } else if (entry.kind === "rush" || entry.kind === "blitz" || entry.kind === "stunt") {
    const abs = absolutePath(path, align, false);
    const x = lineCrossing(abs, -1);
    if (x === undefined || (abs[abs.length - 1] as Pair)[1] > 0) issues.push(`${where}: ${use} never crosses the line`);
    else if (laneAt(x, t) !== entry.lane) issues.push(`${where}: ${use} is declared lane ${entry.lane}, its path crosses in lane ${laneAt(x, t)}`);
  } else if (entry.kind === "block" && entry.technique === "draw") {
    // What the misdirection trait counts: a pass set first, then the block.
    const first = path[1];
    if (first === undefined || first[1] >= 0 || (path[path.length - 1] as PathPoint)[1] <= first[1]) issues.push(`${where}: ${use} is declared a draw block, its path shows no pass set first`);
  }
}

/** One placed path: inside the field and the point and length limits, and what its entry declares (R19). */
function checkPath(where: string, use: string, entry: LibraryEntry, raw: readonly PathPoint[], align: Pair, r: ResolvedAssignment, offense: boolean, screen: boolean, pb: Playbook, refs: PlaybookRefs, issues: string[]): void {
  const half = pb.config.field.widthYards / 2;
  const t = pb.config.classifier;
  const abs = absolutePath(raw, align, offense);
  if (abs.some((p) => Math.abs(p[0]) > half || Math.abs(p[1]) > MIDFIELD_YARDS)) issues.push(`${where} leaves the field on ${use}`);
  const path = quantize(raw, t);
  if (raw.length > t.maxPoints || !path.ok) issues.push(`${where}'s path on ${use} is over the limits: ${t.maxPoints} points and ${t.maxLengthYards} yards`);
  if (!path.ok) return;
  if (breakPoints(segs(path.path), t.breakDegrees).length > t.maxBreaks) issues.push(`${where}'s path on ${use} has more than ${t.maxBreaks} breaks`);
  checkDeclared(where, use, entry, path.path, align, r, screen, pb, refs, issues);
}

/** Every assignment of a design with a path. `checked` collects the library ids it placed. */
function checkPaths(id: string, res: readonly ResolvedAssignment[], alignment: SlotAlignment, offense: boolean, screen: boolean, pb: Playbook, refs: PlaybookRefs, checked: Set<string>, issues: string[]): void {
  const hole = holeOf(res, alignment) ?? undefined;
  for (const r of res) {
    const align = own(alignment, r.slot);
    if (align === undefined) continue;
    const fallback = r.entry.kind === "man" ? r.entry.fallback : undefined;
    const use = fallback?.use ?? r.use;
    const entry = fallback === undefined ? r.entry : own(pb.library.assignments, fallback.use);
    const raw = entry === undefined ? null : assignedPath(entry, align, fallback === undefined ? r.ref.at : fallback.at, r, hole);
    if (entry === undefined || raw === null) continue;
    checked.add(use);
    checkPath(`${id}: ${r.slot}`, use, entry, raw, align, r, offense, screen, pb, refs, issues);
  }
}

/** Whether a position could be given an entry: who routes are for, who carries, who rushes from where. A back lines up in the core, with no inside for an in-axis route. */
function mayUse(position: string, entry: LibraryEntry, pb: Playbook): boolean {
  switch (entry.kind) {
    case "route":
      return pb.config.eligibility.routePositions.includes(position) && !(entry.axis === "in" && pb.config.positions.backs.includes(position));
    case "runPath":
      // Not the quarterback: so near the line, a step away can fall within the simplify tolerance and vanish.
      return pb.config.positions.backs.includes(position);
    case "qb":
      return position === "QB";
    case "block":
      return position !== "QB";
    case "rush":
    case "stunt":
      return position === "DL";
    case "blitz":
      return position !== "DL";
    default:
      return false;
  }
}

/** An entry no design uses (R21): it must pass the path checks from somewhere it could be used. When it passes nowhere, the spot with the fewest problems is listed. */
function checkUnused(id: string, entry: LibraryEntry, pb: Playbook, refs: PlaybookRefs, issues: string[]): void {
  if (!("pts" in entry)) return;
  const offense = ["route", "block", "runPath", "qb"].includes(entry.kind);
  let fewest: string[] | undefined;
  for (const d of offense ? pb.offense.designs : pb.defense.designs) {
    const onOffense = "formation" in d;
    const alignment = onOffense ? offenseAlign(d, pb) : defenseAlignment(d, pb.alignments);
    const hole = onOffense ? (holeOf(resolveOffense(d, pb, offenseSlots(d, refs)), alignment) ?? undefined) : undefined;
    for (const [slot, at] of Object.entries(alignment)) {
      const position = positionOf(slot);
      // A run is judged from behind the ball: from an offset back, the first step changes direction with the side.
      const align: Pair = entry.kind === "runPath" ? [0, at[1]] : at;
      if (!mayUse(position, entry, pb)) continue;
      for (const to of entry.axis === "side" ? (["left", "right"] as const) : [undefined]) {
        const r: ResolvedAssignment = { slot, position, use: id, entry, ref: { use: id }, ...(to === undefined ? {} : { to }) };
        const found: string[] = [];
        checkPath(`library ${id}, which no design uses, from ${slot} in ${d.id}`, id, entry, placePath(entry, align, to, undefined, hole), align, r, offense, onOffense && d.concept === "screenPass", pb, refs, found);
        if (found.length === 0) return;
        if (fewest === undefined || found.length < fewest.length) fewest = found;
      }
    }
  }
  issues.push(...(fewest ?? [`library ${id}: no design uses it and no player could`]));
}

/** Every rule of this file on a playbook whose shapes are right: one line per problem. */
export function checkPlaybookRules(pb: Playbook, refs: PlaybookRefs): string[] {
  const issues: string[] = [];
  checkAlignments(pb, refs, issues);
  const positions: readonly string[] = POSITIONS;
  const listed = { ...pb.config.positions, routePositions: pb.config.eligibility.routePositions, neverDrawn: pb.config.eligibility.neverDrawn, blockWhenShort: pb.config.eligibility.blockWhenShort, screenBackPositions: pb.config.traits.thresholds.screenBackPositions };
  for (const [name, list] of Object.entries(listed)) if (Array.isArray(list)) for (const x of list as readonly string[]) if (!positions.includes(x)) issues.push(`config ${name}: ${x} is not a position`);
  const calls = [...Object.keys(refs.personnel.offense).flatMap((f) => Object.keys(pb.config.concepts).map((c) => `${f}.${c}`)), ...Object.keys(refs.personnel.presetPackage)];
  for (const k of Object.keys(pb.config.defaultDeviations)) if (!calls.includes(k)) issues.push(`config defaultDeviations: ${k} is not an engine call`);
  const checked = new Set<string>();
  for (const d of [...pb.offense.designs, ...pb.defense.designs]) {
    const onOffense = "formation" in d;
    if (onOffense ? own(refs.personnel.offense, d.formation) === undefined || own(pb.config.concepts, d.concept) === undefined : own(refs.personnel.presetPackage, d.coverage) !== d.package) continue;
    const derived = onOffense ? offenseTraits(d, pb, refs) : defenseTraits(d, pb, refs);
    if (!same(d.traits, derived)) issues.push(`${d.id}: traits are ${d.traits.join(", ") || "none"}, its assignments give ${derived.join(", ") || "none"}`);
    if (onOffense) {
      checkPaths(d.id, resolveOffense(d, pb, offenseSlots(d, refs)), offenseAlign(d, pb), true, d.concept === "screenPass", pb, refs, checked, issues);
      const primary = routesOf(d, pb, refs).find((r) => r.primary);
      if (primary !== undefined && d.tags.depth !== undefined && d.tags.depth !== primary.bucket) issues.push(`${d.id}: depth tag is ${d.tags.depth}, its primary route is ${primary.bucket}`);
    } else {
      checkPaths(d.id, resolveDefense(d, pb, defenseSlots(d, refs)), defenseAlignment(d, pb.alignments), false, false, pb, refs, checked, issues);
      const pressure = pressureOf(d, pb, refs);
      if (d.tags.pressure !== pressure) issues.push(`${d.id}: pressure tag is ${d.tags.pressure}, its rush is ${pressure}`);
    }
    const timings = timingsOf(d, pb, refs);
    if (!timings.includes(d.tags.timing)) issues.push(`${d.id}: timing tag is ${d.tags.timing}, its assignments allow ${timings.join(", ") || "none"}`);
    for (const tag of d.tags.situations) {
      const fits = own(pb.config.situations, tag)?.designs[onOffense ? "offense" : "defense"];
      if (fits === undefined || !SITUATION_TAGS.includes(tag) || !situationFits(fits, d, pb, refs)) issues.push(`${d.id}: situation tag ${tag} does not fit the design`);
    }
  }
  for (const [id, entry] of Object.entries(pb.library.assignments)) if (!checked.has(id)) checkUnused(id, entry, pb, refs, issues);
  return issues;
}
