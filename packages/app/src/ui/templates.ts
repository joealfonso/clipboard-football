// data/ui/templates.json: the designed diagram (alignments, routes, drops) and the animation's
// timing. Checked by hand here (the app has no zod dependency); a bad file fails loading with
// the file named, as the data-failed-validation state says.

import type { BASE_RATINGS, POSITION_SKILLS } from "@clipboard-football/shared";

// The rating names, copied because the UI thread can't load a value from the shared root (it
// pulls in zod; bundle.test.ts). `satisfies` the shared types, so a drift fails typecheck.
const BASE = ["speed", "strength", "agility", "awareness"] as const satisfies typeof BASE_RATINGS;
const SKILLS = {
  QB: ["throwPower", "accuracy"],
  RB: ["ballSecurity", "elusiveness"],
  WR: ["hands", "routeRunning"],
  TE: ["hands", "routeRunning", "runBlock"],
  OL: ["passBlock", "runBlock"],
  DL: ["passRush", "runStop"],
  LB: ["tackling", "coverage"],
  CB: ["coverage", "ballSkills"],
  S: ["coverage", "ballSkills"],
  K: ["kickPower", "kickAccuracy"],
  P: ["kickPower", "kickAccuracy"],
} as const satisfies typeof POSITION_SKILLS;

export type Pair = readonly [number, number];
export type Alignment = Readonly<Record<string, Pair>>;

/** A waypoint (version 2): a pair, or a pair with a pause there (ms) and a pace for the leg into it. */
export interface WaypointObj {
  readonly p: Pair;
  readonly pauseMs?: number;
  readonly pace?: number;
}
export type WaypointValue = Pair | WaypointObj;
/** What a receiver does after his last waypoint until the read (spec revision 2026-11-14, R5). */
export type Finish = "sit" | "continue" | "block" | "stalk";
/** The mirror axis (R3): toward the middle, toward the strong side, or toward the run's play side. */
export type Axis = "in" | "strong" | "play";
export interface RouteObj {
  readonly pts: readonly WaypointValue[];
  readonly finish?: Finish;
  readonly axis?: Axis;
}
/** A bare array means { finish: "sit", axis: "in" }, as in version 1. */
export type RouteValue = readonly WaypointValue[] | RouteObj;
export type Waypoints = Readonly<Record<string, RouteValue>>;

/** A route value with its defaults filled in. */
export interface Route {
  readonly pts: readonly { readonly p: Pair; readonly pauseMs: number; readonly pace: number }[];
  readonly finish: Finish;
  readonly axis: Axis;
}

export function routeOf(v: RouteValue | undefined): Route | undefined {
  if (v === undefined) return undefined;
  const obj: RouteObj = Array.isArray(v) ? { pts: v as readonly WaypointValue[] } : (v as RouteObj);
  const pts = obj.pts.map((w) => (Array.isArray(w) ? { p: w as Pair, pauseMs: 0, pace: 1 } : { p: (w as WaypointObj).p, pauseMs: (w as WaypointObj).pauseMs ?? 0, pace: (w as WaypointObj).pace ?? 1 }));
  return { pts, finish: obj.finish ?? "sit", axis: obj.axis ?? "in" };
}

export interface Timing {
  readonly runoffMaxMs: number;
  readonly setMs: number;
  readonly holdMs: number;
  readonly scoreHoldMs: number;
  readonly crossfadeMs: number;
  readonly routeAlpha: number;
}

export interface Templates {
  readonly version: number;
  readonly timing: Timing;
  readonly field: { readonly markYards: number; readonly markMinPx: number; readonly losFromTop: number; readonly panEdgeYards: number; readonly clearOfBallYards: number; readonly linemanClearYards: number };
  readonly offense: Readonly<Record<string, Alignment>>;
  readonly kick: Readonly<Record<string, Alignment>>;
  readonly defense: Readonly<Record<string, Alignment>>;
  readonly returnUnits: Readonly<Record<string, Alignment>>;
  /**
   * Per play (the run leaves split): routes keyed `role:position`, then the receiver role (s1 to
   * w3, R1), then the position.
   */
  readonly routes: Readonly<Record<string, Waypoints>>;
  /**
   * Per drop set, keyed by slot then position: a zone or man defender's moves before his landmark
   * or his trail (the pedal); the whole drop for a defender with neither.
   */
  readonly drops: Readonly<Record<string, Waypoints>>;
  readonly presetDrops: Readonly<Record<string, string>>;
  readonly passDepth: Readonly<Record<string, number>>;
  /** A screen's catch may follow a route that sits behind the screen depth, no deeper than this past the line (negative: behind it). */
  readonly screenFloorYards: number;
  /**
   * OL and DL movement by play family (run, pass, kick) and by leaf (falling back to the family):
   * they stop at contact (path.block), whatever the call. `OLT` and `DLE`, the outermost each side,
   * fall back to `OL` and `DL`.
   */
  readonly lineContact: Readonly<Record<string, Waypoints>>;
  /** A non-rushing LB, S or CB's read step before his drop, by offense family (run, pass, playAction), then position. */
  readonly readStep: Readonly<Record<string, Waypoints>>;
  /** Per handoff run: where the QB and the back meet, [toward the play side, depth off the ball]. */
  readonly mesh: Readonly<Record<string, Pair>>;
  /** DESIGN.md Spacing: line marks at least minPx apart, spread out from the center; maxDepth picks the line. */
  readonly lineSpacing: { readonly minPx: number; readonly maxDepth: number };
  /** Per-preset overrides of the package alignment (two-high, single-high, no deep safety). */
  readonly presetAlignment: Readonly<Record<string, Alignment>>;
  /** Per preset and slot: the zone [x0, depth0, x1, depth1, "deep" | "under"] a zone defender drops to. */
  readonly zones: Readonly<Record<string, Readonly<Record<string, Zone>>>>;
  /** Per preset and slot: the generic receiver spot [x, depth] a man defender mirrors. */
  readonly manTargets: Readonly<Record<string, Alignment>>;
  /** Per pass play: the class's throw depth band [from, to] past the line (MENUS.md). */
  readonly depthBands: Readonly<Record<string, Pair>>;
  /** The rating each position is judged on, for the rating label beside a mark's number. */
  readonly keyRating: Readonly<Record<string, string>>;
  /**
   * Per position: the weight of each rating in the overall shown beside a mark's number and on
   * the card (designed). Ratings left out count zero; every position has at least one.
   */
  readonly overallWeights: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export type Zone = readonly [number, number, number, number, "deep" | "under"];

export class TemplateError extends Error {
  constructor(message: string) {
    super(`data/ui/templates.json: ${message}`);
    this.name = "TemplateError";
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPair = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(isNum);

function numbers(v: unknown, path: string, keys: readonly string[]): void {
  if (!isObj(v)) throw new TemplateError(`${path} must be an object`);
  for (const k of keys) if (!isNum(v[k])) throw new TemplateError(`${path}.${k} must be a number`);
}

function groupOf(v: unknown, path: string, leaf: (x: unknown) => boolean): void {
  if (!isObj(v)) throw new TemplateError(`${path} must be an object`);
  for (const [name, unit] of Object.entries(v)) {
    if (!isObj(unit)) throw new TemplateError(`${path}.${name} must be an object`);
    for (const [k, x] of Object.entries(unit)) if (!leaf(x)) throw new TemplateError(`${path}.${name}.${k} is malformed`);
  }
}

const onlyKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k));

/** A waypoint: a pair, or { p: pair, pauseMs?: ms >= 0, pace?: (0, 1] }. */
export function isWaypoint(x: unknown): boolean {
  if (isPair(x)) return true;
  if (!isObj(x) || !onlyKeys(x, ["p", "pauseMs", "pace"]) || !isPair(x["p"])) return false;
  if (x["pauseMs"] !== undefined && !(isNum(x["pauseMs"]) && x["pauseMs"] >= 0)) return false;
  return x["pace"] === undefined || (isNum(x["pace"]) && x["pace"] > 0 && x["pace"] <= 1);
}

/** A route value: a list of at least one waypoint, or { pts: [at least one], finish?, axis? }. */
export function isRouteValue(x: unknown): boolean {
  if (Array.isArray(x)) return x.length > 0 && x.every(isWaypoint);
  if (!isObj(x) || !onlyKeys(x, ["pts", "finish", "axis"])) return false;
  const pts = x["pts"];
  if (!Array.isArray(pts) || pts.length === 0 || !pts.every(isWaypoint)) return false;
  if (x["finish"] !== undefined && !["sit", "continue", "block", "stalk"].includes(x["finish"] as string)) return false;
  return x["axis"] === undefined || ["in", "strong", "play"].includes(x["axis"] as string);
}

export function parseTemplates(v: unknown): Templates {
  if (!isObj(v) || v["designed"] !== true || v["version"] !== 2) throw new TemplateError("needs version 2 and designed: true");
  numbers(v["timing"], "timing", ["runoffMaxMs", "setMs", "holdMs", "scoreHoldMs", "crossfadeMs", "routeAlpha"]);
  numbers(v["field"], "field", ["markYards", "markMinPx", "losFromTop", "panEdgeYards", "clearOfBallYards", "linemanClearYards"]);
  for (const k of ["offense", "kick", "defense", "returnUnits"]) groupOf(v[k], k, isPair);
  for (const k of ["routes", "drops", "readStep"]) groupOf(v[k], k, isRouteValue);
  if (!isObj(v["presetDrops"]) || !Object.values(v["presetDrops"]).every((x) => typeof x === "string")) throw new TemplateError("presetDrops must map presets to drop names");
  const lc = v["lineContact"];
  if (!isObj(lc)) throw new TemplateError("lineContact must be an object");
  for (const k of ["run", "pass", "kick"]) if (!isObj(lc[k])) throw new TemplateError(`lineContact.${k} is missing`);
  for (const [k, g] of Object.entries(lc)) {
    if (k === "note") continue;
    if (!isObj(g) || !Object.values(g).every(isRouteValue)) throw new TemplateError(`lineContact.${k} is malformed`);
  }
  if (!isObj(v["mesh"]) || !Object.values(v["mesh"]).every(isPair)) throw new TemplateError("mesh must map run plays to [play side, depth]");
  numbers(v["lineSpacing"], "lineSpacing", ["minPx", "maxDepth"]);
  groupOf(v["presetAlignment"], "presetAlignment", isPair);
  groupOf(v["manTargets"], "manTargets", isPair);
  groupOf(v["zones"], "zones", (x) => Array.isArray(x) && x.length === 5 && x.slice(0, 4).every(isNum) && (x[4] === "deep" || x[4] === "under"));
  if (!isObj(v["depthBands"]) || !Object.values(v["depthBands"]).every(isPair)) throw new TemplateError("depthBands must map pass plays to [from, to]");
  if (!isObj(v["keyRating"]) || !Object.values(v["keyRating"]).every((x) => typeof x === "string")) throw new TemplateError("keyRating must map positions to rating names");
  const ow = v["overallWeights"];
  if (!isObj(ow)) throw new TemplateError("overallWeights must map positions to rating weights");
  for (const pos of Object.keys(SKILLS) as (keyof typeof SKILLS)[]) {
    const wts = ow[pos];
    if (!isObj(wts) || Object.keys(wts).length === 0) throw new TemplateError(`overallWeights.${pos} is missing`);
    const known: readonly string[] = [...BASE, ...SKILLS[pos]];
    for (const [r, x] of Object.entries(wts)) {
      if (!known.includes(r)) throw new TemplateError(`overallWeights.${pos}: ${r} is not a ${pos} rating`);
      if (!isNum(x) || x <= 0) throw new TemplateError(`overallWeights.${pos}.${r} must be a positive number`);
    }
  }
  if (!isObj(v["passDepth"]) || !Object.values(v["passDepth"]).every(isNum)) throw new TemplateError("passDepth must map pass plays to yards");
  if (!isNum(v["screenFloorYards"]) || v["screenFloorYards"] > 0) throw new TemplateError("screenFloorYards must be a number of yards behind the line (0 or less)");
  return v as unknown as Templates;
}

// ---------------------------------------------------------------- data/ui/motion.json

export interface Motion {
  readonly keyMs: number;
  readonly speed: Readonly<Record<string, number>>;
  readonly accelMs: Readonly<Record<string, number>>;
  readonly decelMs: number;
  readonly startMs: Readonly<Record<string, number>>;
  readonly slotOffsetMs: number;
  readonly maxStartMs: number;
  readonly snapMs: Readonly<Record<string, number>>;
  readonly dropMs: Readonly<Record<string, number>>;
  readonly hitchMs: number;
  readonly handoffMs: number;
  readonly flight: { readonly baseMs: number; readonly perYardMs: number; readonly minMs: number; readonly maxMs: number; readonly apexPerYard: number; readonly apexMax: number };
  readonly punt: { readonly kickAfterSnapMs: number; readonly hangBaseMs: number; readonly hangPerYardMs: number; readonly hangMaxMs: number; readonly apex: number };
  readonly kickoff: { readonly approachMs: number; readonly hangBaseMs: number; readonly hangPerYardMs: number; readonly hangMaxMs: number; readonly apex: number; readonly onsideMs: number; readonly onsideApex: number };
  readonly fieldGoal: { readonly holdMs: number; readonly kickMs: number; readonly flightBaseMs: number; readonly flightPerYardMs: number; readonly flightMaxMs: number; readonly apex: number; readonly endScale: number };
  readonly reactionMs: Readonly<Record<string, number>>;
  readonly pursuit: { readonly leadMs: number; readonly turnDegPerS: number; readonly ringYards: number; readonly corridorHalfYards: number; readonly corridorMs: number; readonly brakeYards: number };
  readonly release: { readonly carrierPastLineYards: number; readonly afterThrowMs: number };
  readonly convergeMs: number;
  readonly settleMs: number;
  readonly settleMaxYards: number;
  readonly live: { readonly minMs: number; readonly maxMs: number; readonly kneelMs: number; readonly spikeMs: number };
  readonly preSnap: { readonly lineUpMs: number; readonly runoffMaxMs: number; readonly setMs: number; readonly glideMs: number };
  /** Breaks: radii, the turn that makes a break sharp, the speed at the arc, and the plant and re-acceleration ramps (yards). */
  readonly fillet: { readonly roundRadius: number; readonly sharpRadius: number; readonly sharpDeg: number; readonly roundPace: number; readonly sharpPace: number; readonly plantYards: number; readonly reaccelYards: number };
  readonly huddle: { readonly offenseBehind: number; readonly defensePast: number; readonly markGapPx: number };
  /** A route is run at routePace x top speed; a `continue` finish at continuePace x top. */
  readonly routePace: number;
  readonly continuePace: number;
  /** A `sit` finish (and a pause) drifts at most maxYards, from sit pace; a `block` finish at most blockMaxYards. */
  readonly sit: { readonly pace: number; readonly maxYards: number; readonly blockMaxYards: number; readonly pauseLegShare: number };
  /** The throw waits for the target's route at most this long after the drop ends (R8). */
  readonly throwHold: { readonly maxMs: number; readonly searchMs: number };
  readonly man: { readonly cushionYards: number; readonly pressCushionYards: number; readonly lagMs: number };
  readonly zoneDrift: { readonly maxYards: number; readonly pace: number };
  /** A stalk block: the shadow point's distance and lag behind his man; once that close to him he is engaged and moves with him. */
  readonly stalk: { readonly contactYards: number; readonly lagMs: number };
  /** How far engaged linemen drift toward the play side on each run. */
  readonly runDrift: Readonly<Record<string, number>>;
  /** The play-action fake: the QB reaches the fake point at this time after the snap. */
  readonly fakeMs: number;
  readonly sidelineMarginYards: number;
  /**
   * The pocket: each engaged OL-DL pair is pushed back together on a pass by at most `yards`, from
   * `pace` x lineman speed; on a run, after the handoff, toward where the run ended (no winner drawn).
   */
  readonly pocket: { readonly yards: number; readonly pace: number };
  /** The sacker's path around his blocker: outYards to the outside, the turn at depthShare of the way back, only when he is more than minYards from the QB. */
  readonly sackArc: { readonly outYards: number; readonly depthShare: number; readonly minYards: number };
  /** The target's bend to the catch: a lead-in along his heading of at most leadYards and leadShare of the distance left. */
  readonly bend: { readonly leadYards: number; readonly leadShare: number };
  /** The sack comes no sooner than minDelayMs after the drop end (then later if the sacker needs longer). */
  readonly sack: { readonly minDelayMs: number };
  /** A loose ball rolls this far while its recoverer gets to it. */
  readonly fumble: { readonly rollYards: number };
}

export class MotionError extends Error {
  constructor(message: string) {
    super(`data/ui/motion.json: ${message}`);
    this.name = "MotionError";
  }
}

const GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"];

export function parseMotion(v: unknown): Motion {
  const bad = (m: string): never => {
    throw new MotionError(m);
  };
  if (!isObj(v) || v["designed"] !== true || v["version"] !== 2) bad("needs version 2 and designed: true");
  const o = v as Record<string, unknown>;
  for (const k of ["keyMs", "decelMs", "slotOffsetMs", "maxStartMs", "hitchMs", "handoffMs", "convergeMs", "settleMs", "settleMaxYards", "fakeMs", "sidelineMarginYards"]) if (!isNum(o[k])) bad(`${k} must be a number`);
  for (const k of ["routePace", "continuePace"]) if (!isNum(o[k]) || (o[k] as number) <= 0 || (o[k] as number) > 1) bad(`${k} must be a pace in (0, 1]`);
  for (const k of ["speed", "accelMs", "startMs"]) {
    const g = o[k];
    if (!isObj(g)) bad(`${k} must be an object`);
    for (const pos of GROUPS) if (!isNum((g as Record<string, unknown>)[pos])) bad(`${k}.${pos} must be a number`);
  }
  for (const k of ["snapMs", "dropMs", "reactionMs"]) if (!isObj(o[k]) || !Object.values(o[k] as object).every(isNum)) bad(`${k} must map names to numbers`);
  const sub = (k: string, keys: readonly string[]): void => {
    if (!isObj(o[k])) bad(`${k} must be an object`);
    for (const x of keys) if (!isNum((o[k] as Record<string, unknown>)[x])) bad(`${k}.${x} must be a number`);
  };
  sub("flight", ["baseMs", "perYardMs", "minMs", "maxMs", "apexPerYard", "apexMax"]);
  sub("punt", ["kickAfterSnapMs", "hangBaseMs", "hangPerYardMs", "hangMaxMs", "apex"]);
  sub("kickoff", ["approachMs", "hangBaseMs", "hangPerYardMs", "hangMaxMs", "apex", "onsideMs", "onsideApex"]);
  sub("fieldGoal", ["holdMs", "kickMs", "flightBaseMs", "flightPerYardMs", "flightMaxMs", "apex", "endScale"]);
  sub("pursuit", ["leadMs", "turnDegPerS", "ringYards", "corridorHalfYards", "corridorMs", "brakeYards"]);
  sub("release", ["carrierPastLineYards", "afterThrowMs"]);
  sub("live", ["minMs", "maxMs", "kneelMs", "spikeMs"]);
  sub("preSnap", ["lineUpMs", "runoffMaxMs", "setMs", "glideMs"]);
  sub("fillet", ["roundRadius", "sharpRadius", "sharpDeg", "roundPace", "sharpPace", "plantYards", "reaccelYards"]);
  sub("huddle", ["offenseBehind", "defensePast", "markGapPx"]);
  sub("sit", ["pace", "maxYards", "blockMaxYards", "pauseLegShare"]);
  sub("throwHold", ["maxMs", "searchMs"]);
  sub("man", ["cushionYards", "pressCushionYards", "lagMs"]);
  sub("zoneDrift", ["maxYards", "pace"]);
  sub("stalk", ["contactYards", "lagMs"]);
  sub("runDrift", ["insideRun", "outsideRun", "qbSneak"]);
  sub("pocket", ["yards", "pace"]);
  sub("sackArc", ["outYards", "depthShare", "minYards"]);
  sub("bend", ["leadYards", "leadShare"]);
  sub("sack", ["minDelayMs"]);
  sub("fumble", ["rollYards"]);
  const pace = (k: string, x: string): void => {
    const n = (o[k] as Record<string, number>)[x] as number;
    if (n <= 0 || n > 1) bad(`${k}.${x} must be a pace in (0, 1]`);
  };
  pace("fillet", "roundPace");
  pace("fillet", "sharpPace");
  pace("sit", "pace");
  pace("zoneDrift", "pace");
  pace("pocket", "pace");
  pace("sit", "pauseLegShare");
  pace("sackArc", "depthShare");
  pace("bend", "leadShare");
  for (const [k, x] of [["fillet", "plantYards"], ["fillet", "reaccelYards"], ["sit", "maxYards"], ["sit", "blockMaxYards"], ["throwHold", "maxMs"], ["man", "cushionYards"], ["man", "pressCushionYards"], ["man", "lagMs"], ["zoneDrift", "maxYards"], ["stalk", "contactYards"], ["stalk", "lagMs"], ["pocket", "yards"], ["throwHold", "searchMs"], ["sackArc", "outYards"], ["sackArc", "minYards"], ["bend", "leadYards"], ["sack", "minDelayMs"], ["fumble", "rollYards"]] as const)
    if (((o[k] as Record<string, number>)[x] as number) < 0) bad(`${k}.${x} must not be negative`);
  const live = o["live"] as Record<string, number>;
  if ((live["minMs"] as number) > (live["maxMs"] as number)) bad("live.minMs is above live.maxMs");
  if ((o["maxStartMs"] as number) > 150) bad("maxStartMs is over 150 (Joseph: every player moves within 150 ms of the snap)");
  return v as unknown as Motion;
}
