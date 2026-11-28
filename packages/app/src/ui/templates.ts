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
   * Per pass play (deepPass 20, designed): on a completion with no air yards the catch is at least
   * this far past the line, or at the dead spot on a shorter gain (spec amendment 2026-11-15, B1).
   */
  readonly catchFloorYards: Readonly<Record<string, number>>;
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
  if (!isObj(v["catchFloorYards"]) || !Object.values(v["catchFloorYards"]).every((x) => isNum(x) && x >= 0)) throw new TemplateError("catchFloorYards must map pass plays to yards past the line (0 or more)");
  for (const leaf of Object.keys(v["catchFloorYards"])) if ((v["passDepth"] as Record<string, unknown>)[leaf] === undefined) throw new TemplateError(`catchFloorYards.${leaf} is not a pass play in passDepth`);
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
  /** leafMaxMs: a longer hold for one pass play (deepPass, Joseph 2026-11-15, Open item 2), else maxMs. */
  readonly throwHold: { readonly maxMs: number; readonly searchMs: number; readonly leafMaxMs: Readonly<Record<string, number>> };
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
  /**
   * How an incompletion is drawn (spec amendment 2026-11-15, A1 to A4): the target's reach toward
   * the ball, the speed that counts as moving, where the ball lands for each kind of miss, how near
   * a defender may stand to a loose ball, how far out of bounds it may land, its roll, and the
   * break-up (the gap to the target, the breaker's hand, the pace he may need, the deflection).
   */
  readonly miss: {
    readonly reachMs: number;
    readonly reachYards: number;
    readonly movingYps: number;
    readonly overYards: number;
    readonly behindYards: number;
    readonly shortYards: number;
    readonly clearYards: number;
    readonly outYards: number;
    readonly rollYards: number;
    /** The roll or deflection after the landing takes rollMs (the label then shows); the ball rests restMs more before the whistle and the respot. */
    readonly rollMs: number;
    readonly restMs: number;
    /** The clear check's allowance for where a defender is drawn at the arrival against where it predicts him. */
    readonly clearMarginYards: number;
    readonly breakup: { readonly gapYards: number; readonly handYards: number; readonly maxPace: number; readonly deflectYards: number };
  };
  /**
   * Natural motion (spec revision 2026-11-15, as built; version 3), designed: the hash tie-breaker
   * spread (NM4), the cruise wobble (NM5), the profile smoothing (ms, also the stalk lock blend),
   * the lateral acceleration that limits pursuit turns (yd/s^2), the anchor blend, the line's hand
   * fight and the idle sway (NM7), and the ring while the ball is in the air (NM-Open 1, approved).
   */
  readonly natural: {
    readonly spread: { readonly topShare: number; readonly accelShare: number; readonly reactionMs: number; readonly startMs: number };
    readonly wobble: { readonly share: number; readonly periodMinMs: number; readonly periodMaxMs: number };
    readonly smoothMs: number;
    readonly lateralAccel: number;
    readonly anchorBlendMs: number;
    readonly line: { readonly pushYards: number; readonly shuffleYards: number; readonly periodMinMs: number; readonly periodMaxMs: number; readonly rampMs: number };
    readonly idle: { readonly swayYards: number; readonly minYps: number; readonly periodMinMs: number; readonly periodMaxMs: number; readonly rampMs: number };
    readonly flightRingYards: number;
  };
  /**
   * Ratings drive motion (Joseph, 2026-11-15, decision 12 reversed), designed: a rating from lo to
   * hi maps linearly onto each band [at lo, at hi]: a share of top speed (speed), a share of accelMs
   * (agility), ms added to the reaction and to the start (awareness). byPosition overrides default.
   */
  readonly ratings: {
    readonly lo: number;
    readonly hi: number;
    readonly default: RatingBand;
    readonly byPosition: Readonly<Record<string, RatingBand>>;
    /** Player reactions on scrimmage plays (version 6, docs/specs/m2-player-reactions.md), designed. */
    readonly scrimmage: ScrimmageRatings;
  };
  /** Moments (DESIGN.md Prime Time, Motion, Moments), designed: each moment's minimum whistle hold at 1x, the big-play yards, the bug's first-down flash. */
  readonly moments: Moments;
  /**
   * Kick plays (calling screen pass Q4, approved by Joseph 2026-11-15), designed: every unnamed
   * player's path is a trail whose points fade out over fadeMs (timeline ms) after he passes them.
   */
  readonly kickTrail: { readonly fadeMs: number };
  /** Kickoff returns (version 4, spec KR1 to KR9), designed: the wall, the blocks and the returner's cut. */
  readonly kickReturn: KickReturn;
}

/** motion.json `kickReturn` (version 4): yards in the kicking team's frame, paces as shares of top speed, times in ms. */
export interface KickReturn {
  readonly wallDepthYards: number;
  readonly wallRowYards: number;
  readonly laneSpreadYards: number;
  readonly wallWidthYards: number;
  readonly setupPace: number;
  readonly setupYards: number;
  readonly blockPace: number;
  readonly contactYards: number;
  readonly engageYards: number;
  readonly blockDriftYps: number;
  readonly blockEaseMs: number;
  readonly minBlockMs: number;
  readonly leadYards: number;
  readonly leadPace: number;
  readonly corridorMarginYards: number;
  readonly containYards: number;
  readonly behindToleranceYards: number;
  readonly whistleWindowMs: number;
  readonly upfieldYards: number;
  readonly cutYards: number;
  readonly cutDepthYards: number;
  readonly cutRadiusYards: number;
  readonly cutPace: number;
  readonly cutLateralAccel: number;
  readonly cutMinReturnYards: number;
  readonly cutLagsMs: readonly number[];
  readonly lateCutMs: number;
  readonly readLeadMs: number;
  readonly stableMs: number;
  readonly deadbandYards: number;
  readonly cutDeg: number;
  readonly headingMs: number;
}

const KICK_RETURN_KEYS = ["wallDepthYards", "wallRowYards", "laneSpreadYards", "wallWidthYards", "setupPace", "setupYards", "blockPace", "contactYards", "engageYards", "blockDriftYps", "blockEaseMs", "minBlockMs", "leadYards", "leadPace", "corridorMarginYards", "containYards", "behindToleranceYards", "whistleWindowMs", "upfieldYards", "cutYards", "cutDepthYards", "cutRadiusYards", "cutPace", "cutLateralAccel", "cutMinReturnYards", "lateCutMs", "readLeadMs", "stableMs", "deadbandYards", "cutDeg", "headingMs"] as const;

function parseKickReturn(v: unknown, bad: (m: string) => never): void {
  if (!isObj(v)) bad("kickReturn must be an object");
  const o = v as Record<string, unknown>;
  for (const k of KICK_RETURN_KEYS) if (!isNum(o[k]) || (o[k] as number) < 0) bad(`kickReturn.${k} must be a number, not negative`);
  const lags = o["cutLagsMs"];
  if (!Array.isArray(lags) || lags.length === 0 || !lags.every((x) => isNum(x) && x >= 0)) bad("kickReturn.cutLagsMs must be a list of ms, not empty, none negative");
  const n = o as Record<string, number>;
  if ((n["cutDeg"] as number) <= 0 || (n["cutDeg"] as number) >= 90) bad("kickReturn.cutDeg must be in (0, 90)");
  if ((n["headingMs"] as number) <= 0) bad("kickReturn.headingMs must be above 0");
  for (const k of ["setupPace", "blockPace", "leadPace", "cutPace"] as const) if ((n[k] as number) <= 0 || (n[k] as number) > 1) bad(`kickReturn.${k} must be a pace in (0, 1]`);
  if ((n["wallWidthYards"] as number) < (n["laneSpreadYards"] as number)) bad("kickReturn.wallWidthYards must not be below laneSpreadYards");
  if ((n["contactYards"] as number) >= (n["engageYards"] as number)) bad("kickReturn.contactYards must be below engageYards");
  if ((n["cutRadiusYards"] as number) <= 0) bad("kickReturn.cutRadiusYards must be above 0");
  if ((n["cutLateralAccel"] as number) <= 0) bad("kickReturn.cutLateralAccel must be above 0");
  // The cut and both its rounded corners must fit in the shortest return that cuts.
  const tan = (n["cutRadiusYards"] as number) * Math.tan(Math.atan2(n["cutYards"] as number, n["cutDepthYards"] as number) / 2);
  if ((n["upfieldYards"] as number) + (n["cutDepthYards"] as number) + 2 * tan >= (n["cutMinReturnYards"] as number)) bad("kickReturn.upfieldYards + cutDepthYards and the cut's two rounded corners must fit inside cutMinReturnYards");
}

/** One position's rating bands, each [value at lo, value at hi]. */
export interface RatingBand {
  readonly topShare: readonly [number, number];
  readonly accelShare: readonly [number, number];
  readonly reactionMs: readonly [number, number];
  readonly startMs: readonly [number, number];
}

/** Which rating drives an effect: `default`, or the entry for the player's position. */
export type RatingBy = Readonly<Record<string, string>> & { readonly default: string };

/**
 * motion.json `ratings.scrimmage` (version 6, docs/specs/m2-player-reactions.md), designed, display
 * only: how a player's own ratings set his reaction to the read and its play-to-play variation
 * (PR3, PR4), his pursuit (PR5), his coverage, blocks and bite (PR7), his break pace (PR8), his
 * break on a ball in the air (PR9) and his get-off (PR10), on scrimmage plays. Each pair is
 * [value at ratings.lo, value at ratings.hi], linear between, and adds nothing for a player without
 * the rating `by` names. Times are screen ms and do not scale with the live time (PR13).
 */
export interface ScrimmageRatings {
  readonly by: Readonly<Record<(typeof SCRIMMAGE_BY)[number], RatingBy>>;
  /** The floor before variation, and the bands added to reactionMs[position], to the offense's 0 and to the DL release; varyMs x v on top. */
  readonly read: { readonly minMs: number; readonly defenseMs: Pair; readonly offenseMs: Pair; readonly releaseMs: Pair; readonly varyMs: Pair };
  /** Added to pursuit.leadMs (with leadVaryMs x v, kept in leadMinMs to leadMaxMs); turnShare scales the lateral limit and turnDegPerS. */
  readonly pursuit: { readonly leadMs: Pair; readonly leadVaryMs: Pair; readonly leadMinMs: number; readonly leadMaxMs: number; readonly turnShare: Pair };
  readonly man: { readonly lagMs: Pair; readonly receiverLagMs: Pair; readonly minLagMs: number; readonly cushionYards: Pair };
  /** A rated stalk block: the lag band, and how near a man running at him is let come before he is backed off (yd, at most stalk.contactYards). */
  readonly stalk: { readonly lagMs: Pair; readonly clearYards: number };
  readonly biteShare: Pair;
  readonly breakPaceShare: Pair;
  readonly air: { readonly baseMs: number; readonly minMs: number; readonly manExtraMs: number; readonly ms: Pair; readonly varyMs: Pair };
  readonly getOff: { readonly stepPace: number; readonly offenseMs: Pair; readonly defenseMs: Pair; readonly varyMs: Pair };
}

const SCRIMMAGE_BY = ["read", "lead", "bite", "getOff", "turn", "manLag", "receiverLag", "cushion", "stalkLag", "breakPace", "air"] as const;

/**
 * `ratings.scrimmage`: every key present and of its kind, and the limits that protect acceptance
 * tests (not balance): a `by` rating is a base rating or a skill of that position; a varyMs pair
 * spans less than each band it varies, so a higher rating is never later (PR-C3); turnShare and
 * breakPaceShare within 0.3, biteShare within 0.8, stepPace in (0, 1], no getOff value above 400,
 * leadMinMs not above leadMaxMs, read.minMs not negative, stalk.clearYards above 0 and not above
 * stalk.contactYards (passed in).
 */
function parseScrimmage(v: unknown, contactYards: number, bad: (m: string) => never): void {
  const at = "ratings.scrimmage";
  if (!isObj(v)) bad(`${at} must be an object`);
  const o = v as Record<string, unknown>;
  const obj = (k: string): Record<string, unknown> => {
    if (!isObj(o[k])) bad(`${at}.${k} must be an object`);
    return o[k] as Record<string, unknown>;
  };
  const num = (path: string, x: unknown): number => {
    if (!isNum(x)) bad(`${at}.${path} must be a number`);
    return x as number;
  };
  const pair = (path: string, x: unknown): Pair => {
    if (!isPair(x)) bad(`${at}.${path} must be a pair of numbers`);
    return x as Pair;
  };
  const span = (p: Pair): number => Math.abs(p[1] - p[0]);
  const within = (path: string, p: Pair, lim: number): void => {
    if (p.some((n) => Math.abs(n) > lim)) bad(`${at}.${path} must stay within ${lim}`);
  };
  const by = obj("by");
  const anySkill: readonly string[] = Object.values(SKILLS).flat();
  for (const k of SCRIMMAGE_BY) {
    const b = by[k];
    if (!isObj(b) || typeof b["default"] !== "string") bad(`${at}.by.${k} must name a default rating`);
    for (const [pos, r] of Object.entries(b as Record<string, unknown>)) {
      if (pos !== "default" && !GROUPS.includes(pos)) bad(`${at}.by.${k}.${pos} is not a position`);
      const known: readonly string[] = pos === "default" ? [...BASE, ...anySkill] : [...BASE, ...SKILLS[pos as keyof typeof SKILLS]];
      if (typeof r !== "string" || !known.includes(r)) bad(`${at}.by.${k}.${pos}: ${String(r)} is neither a base rating nor a ${pos === "default" ? "position" : pos} skill`);
    }
  }
  const rd = obj("read");
  if (num("read.minMs", rd["minMs"]) < 0) bad(`${at}.read.minMs must not be negative`);
  const readVary = pair("read.varyMs", rd["varyMs"]);
  for (const k of ["defenseMs", "offenseMs", "releaseMs"]) if (span(readVary) >= span(pair(`read.${k}`, rd[k]))) bad(`${at}.read.varyMs must span less than read.${k}, so a higher rating is never later`);
  const pu = obj("pursuit");
  if (num("pursuit.leadMinMs", pu["leadMinMs"]) > num("pursuit.leadMaxMs", pu["leadMaxMs"])) bad(`${at}.pursuit.leadMinMs is above pursuit.leadMaxMs`);
  if (span(pair("pursuit.leadVaryMs", pu["leadVaryMs"])) >= span(pair("pursuit.leadMs", pu["leadMs"]))) bad(`${at}.pursuit.leadVaryMs must span less than pursuit.leadMs`);
  within("pursuit.turnShare", pair("pursuit.turnShare", pu["turnShare"]), 0.3);
  const man = obj("man");
  for (const k of ["lagMs", "receiverLagMs", "cushionYards"]) pair(`man.${k}`, man[k]);
  num("man.minLagMs", man["minLagMs"]);
  pair("stalk.lagMs", obj("stalk")["lagMs"]);
  const clear = num("stalk.clearYards", obj("stalk")["clearYards"]);
  if (clear <= 0 || clear > contactYards) bad(`${at}.stalk.clearYards must be above 0 and not above stalk.contactYards`);
  within("biteShare", pair("biteShare", o["biteShare"]), 0.8);
  within("breakPaceShare", pair("breakPaceShare", o["breakPaceShare"]), 0.3);
  const air = obj("air");
  for (const k of ["baseMs", "minMs", "manExtraMs"]) num(`air.${k}`, air[k]);
  if (span(pair("air.varyMs", air["varyMs"])) >= span(pair("air.ms", air["ms"]))) bad(`${at}.air.varyMs must span less than air.ms, so a higher rating is never later`);
  const go = obj("getOff");
  const stepPace = num("getOff.stepPace", go["stepPace"]);
  if (stepPace <= 0 || stepPace > 1) bad(`${at}.getOff.stepPace must be a pace in (0, 1]`);
  const goVary = pair("getOff.varyMs", go["varyMs"]);
  for (const k of ["offenseMs", "defenseMs"]) if (span(goVary) >= span(pair(`getOff.${k}`, go[k]))) bad(`${at}.getOff.varyMs must span less than getOff.${k}, so a higher rating is never later`);
  for (const k of ["offenseMs", "defenseMs", "varyMs"]) if ((go[k] as Pair).some((n) => n > 400)) bad(`${at}.getOff.${k} must not be above 400`);
}

/** motion.json `moments` (DESIGN.md Prime Time, Moments): each moment's minimum whistle hold at 1x (ms), the big-play yards, the bug's first-down flash (ms, mirrored in styles.css --first-down-flash). */
export interface Moments {
  readonly touchdown: { readonly minHoldMs: number };
  readonly fieldGoal: { readonly minHoldMs: number };
  readonly safety: { readonly minHoldMs: number };
  readonly twoPoint: { readonly minHoldMs: number };
  readonly turnover: { readonly minHoldMs: number };
  readonly bigPlay: { readonly minHoldMs: number; readonly minYards: number };
  readonly firstDown: { readonly flashMs: number };
}

function parseMoments(v: unknown, bad: (m: string) => never): void {
  if (!isObj(v)) bad("moments must be an object");
  const m = v as Record<string, unknown>;
  const num = (k: string, f: string): void => {
    const b = m[k];
    if (!isObj(b)) bad(`moments.${k} must be an object`);
    const n = (b as Record<string, unknown>)[f];
    if (!isNum(n) || (n as number) < 0) bad(`moments.${k}.${f} must be a number, not negative`);
  };
  for (const k of ["touchdown", "fieldGoal", "safety", "twoPoint", "turnover", "bigPlay"]) num(k, "minHoldMs");
  num("bigPlay", "minYards");
  num("firstDown", "flashMs");
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
  if (!isObj(v) || v["designed"] !== true || v["version"] !== 6) bad("needs version 6 and designed: true");
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
  sub("miss", ["reachMs", "reachYards", "movingYps", "overYards", "behindYards", "shortYards", "clearYards", "outYards", "rollYards", "rollMs", "restMs", "clearMarginYards"]);
  if (!isObj((o["miss"] as Record<string, unknown>)["breakup"])) bad("miss.breakup must be an object");
  const bu = (o["miss"] as Record<string, unknown>)["breakup"] as Record<string, unknown>;
  for (const x of ["gapYards", "handYards", "maxPace", "deflectYards"]) if (!isNum(bu[x]) || (bu[x] as number) < 0) bad(`miss.breakup.${x} must be a number, not negative`);
  if ((bu["maxPace"] as number) <= 0) bad("miss.breakup.maxPace must be above 0");
  const ms = o["miss"] as Record<string, number>;
  // The reach must leave a gap on every kind of miss (R-C16), and a loose ball's clearance can't be
  // more than the ring that keeps unnamed defenders off it (contract 3).
  if ((ms["reachYards"] as number) >= Math.min(ms["overYards"] as number, ms["behindYards"] as number, ms["shortYards"] as number, bu["gapYards"] as number)) bad("miss.reachYards must be below overYards, behindYards, shortYards and breakup.gapYards");
  if ((ms["clearYards"] as number) > ((o["pursuit"] as Record<string, number>)["ringYards"] as number)) bad("miss.clearYards must not be above pursuit.ringYards");
  const lh = (o["throwHold"] as Record<string, unknown>)["leafMaxMs"];
  if (!isObj(lh)) bad("throwHold.leafMaxMs must map pass plays to ms");
  for (const [leaf, x] of Object.entries(lh as Record<string, unknown>)) {
    if ((o["dropMs"] as Record<string, unknown>)[leaf] === undefined) bad(`throwHold.leafMaxMs.${leaf} is not a pass play in dropMs`);
    if (!isNum(x) || x < 0) bad(`throwHold.leafMaxMs.${leaf} must be a number of ms, not negative`);
  }
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
  for (const [k, x] of [["fillet", "plantYards"], ["fillet", "reaccelYards"], ["sit", "maxYards"], ["sit", "blockMaxYards"], ["throwHold", "maxMs"], ["man", "cushionYards"], ["man", "pressCushionYards"], ["man", "lagMs"], ["zoneDrift", "maxYards"], ["stalk", "contactYards"], ["stalk", "lagMs"], ["pocket", "yards"], ["throwHold", "searchMs"], ["sackArc", "outYards"], ["sackArc", "minYards"], ["bend", "leadYards"], ["sack", "minDelayMs"], ["fumble", "rollYards"], ["miss", "reachMs"], ["miss", "reachYards"], ["miss", "movingYps"], ["miss", "overYards"], ["miss", "behindYards"], ["miss", "shortYards"], ["miss", "clearYards"], ["miss", "outYards"], ["miss", "rollYards"], ["miss", "rollMs"], ["miss", "restMs"], ["miss", "clearMarginYards"]] as const)
    if (((o[k] as Record<string, number>)[x] as number) < 0) bad(`${k}.${x} must not be negative`);
  const live = o["live"] as Record<string, number>;
  if ((live["minMs"] as number) > (live["maxMs"] as number)) bad("live.minMs is above live.maxMs");
  if ((o["maxStartMs"] as number) > 150) bad("maxStartMs is over 150 (Joseph: every player moves within 150 ms of the snap)");
  // Natural motion (version 3): every key a number, none negative, min never above max, shares in [0, 0.2].
  const nat = o["natural"];
  if (!isObj(nat)) bad("natural must be an object");
  const N = nat as Record<string, unknown>;
  const block = (k: string, keys: readonly string[]): Record<string, number> => {
    const b = N[k];
    if (!isObj(b)) bad(`natural.${k} must be an object`);
    for (const x of keys) {
      const n = (b as Record<string, unknown>)[x];
      if (!isNum(n) || n < 0) bad(`natural.${k}.${x} must be a number, not negative`);
    }
    return b as Record<string, number>;
  };
  const spread = block("spread", ["topShare", "accelShare", "reactionMs", "startMs"]);
  const wobble = block("wobble", ["share", "periodMinMs", "periodMaxMs"]);
  for (const x of ["smoothMs", "lateralAccel", "anchorBlendMs"]) if (!isNum(N[x]) || (N[x] as number) < 0) bad(`natural.${x} must be a number, not negative`);
  if ((N["lateralAccel"] as number) <= 0) bad("natural.lateralAccel must be above 0");
  const line = block("line", ["pushYards", "shuffleYards", "periodMinMs", "periodMaxMs", "rampMs"]);
  const idle = block("idle", ["swayYards", "minYps", "periodMinMs", "periodMaxMs", "rampMs"]);
  if (!isNum(N["flightRingYards"]) || (N["flightRingYards"] as number) < 0) bad("natural.flightRingYards must be a number, not negative");
  for (const [k, b] of [["spread.topShare", spread["topShare"]], ["spread.accelShare", spread["accelShare"]], ["wobble.share", wobble["share"]]] as const) if ((b as number) > 0.2) bad(`natural.${k} must be a share in [0, 0.2]`);
  for (const [k, b] of [["wobble", wobble], ["line", line], ["idle", idle]] as const) if ((b["periodMinMs"] as number) > (b["periodMaxMs"] as number)) bad(`natural.${k}.periodMinMs is above periodMaxMs`);
  for (const [k, x] of [["wobble", "periodMinMs"], ["line", "periodMinMs"], ["idle", "periodMinMs"], ["line", "rampMs"], ["idle", "rampMs"]] as const) if ((({ wobble, line, idle })[k][x] as number) <= 0) bad(`natural.${k}.${x} must be above 0`);
  // Ratings (version 3): lo below hi; every band a pair of numbers, top and accel shares within 0.5.
  const rt = o["ratings"];
  if (!isObj(rt)) bad("ratings must be an object");
  const RT = rt as Record<string, unknown>;
  if (!isNum(RT["lo"]) || !isNum(RT["hi"]) || (RT["lo"] as number) >= (RT["hi"] as number)) bad("ratings.lo and ratings.hi must be numbers, lo below hi");
  const band = (name: string, b: unknown): void => {
    if (!isObj(b)) bad(`ratings.${name} must be an object`);
    for (const x of ["topShare", "accelShare", "reactionMs", "startMs"]) {
      const pr = (b as Record<string, unknown>)[x];
      if (!Array.isArray(pr) || pr.length !== 2 || !pr.every(isNum)) bad(`ratings.${name}.${x} must be a pair of numbers`);
      if ((x === "topShare" || x === "accelShare") && (pr as number[]).some((n) => Math.abs(n) > 0.5)) bad(`ratings.${name}.${x} must stay within 0.5`);
    }
  };
  band("default", RT["default"]);
  if (!isObj(RT["byPosition"])) bad("ratings.byPosition must be an object");
  for (const [pos, b] of Object.entries(RT["byPosition"] as Record<string, unknown>)) band(`byPosition.${pos}`, b);
  parseScrimmage(RT["scrimmage"], (o["stalk"] as Record<string, number>)["contactYards"] as number, bad);
  parseMoments(o["moments"], bad);
  const kt = o["kickTrail"];
  if (!isObj(kt) || !isNum((kt as Record<string, unknown>)["fadeMs"]) || ((kt as Record<string, number>)["fadeMs"] as number) <= 0) bad("kickTrail.fadeMs must be a number of ms above 0");
  parseKickReturn(o["kickReturn"], bad);
  return v as unknown as Motion;
}
