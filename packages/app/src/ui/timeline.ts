// The field animation as data: timeline(input, templates, ctx) returns dense keys (every 25 ms)
// for every mark, the ball and its height, the paths and the labels. Pure, with no Rng and no
// outcome logic (spec A1): the same event always gives the same timeline.
//
// docs/specs/m2-play-calling-and-motion.md:
// - Pre-snap: t = 0 starts the line-up. A side still in its huddle breaks it to its alignment
//   (450 ms, with the run-off clock running at the same time), then everyone is set (300 ms), then
//   the snap. Huddle spots come from the layout only, never from anyone's call (P1).
// - Facts are anchors, fixed in time and place: the snap, handoff, throw, catch, interception,
//   fumble, sack, kick, landing, the dead spot at the whistle, the tackler at the ball (decision 10).
//   Only the engine's named players touch the ball.
// - Everyone else moves from the snap (Joseph: all 22 move as in a real play), starting within
//   150 ms: the line blocks and rushes and stops at contact, receivers run routes, backs run, block
//   or check down, linebackers read then flow or drop, defensive backs backpedal and cover, and
//   once the ball is caught or handed off everyone pursues. Unnamed defenders keep 2.5 yards from
//   the ball and out of the carrier's lane (contract 3), so nothing implies a different result.
// - Screen time comes from geometry (distances and speeds), clamped to motion.json's live range
//   (1.8 to 7.0 s since revision 2026-11-14, decision 11).
// - Revision 2026-11-14 (real routes and slower pace): receivers run their role's route at their
//   own pace with a plant at each break, then their finish (sit, continue, block, stalk) until the
//   read; the target leaves his route where it comes nearest the catch; the throw waits for him up
//   to throwHold; defenders read-step, pedal, sink in zones, trail in man and rotate, all from the
//   calls (and on runs the play side, from runLocation) only, never the target or the result.
// - The set preview is drawn from the calls (playArt), never from the result (P3).
//
// Frame: the play's frame. y is yards from the offense's goal line (0) to the other goal line
// (100), the end lines at -10 and 110 (from the rule set); x is 0 to 53.3 from the offense's left.

import type { PlayResult } from "@clipboard-football/shared";
import { PARTICIPANT_ROLES, readDetail, type OnFieldSlot, type ParticipantRole, type PlayEvent } from "../engine/types";
import { defenseArt, ELIGIBLE, huddleSpots, landmark, lineContactFor, lineKeys, lineUp, lookup, offenseArt, PASS_LEAVES, placeRoute, readFamily, receiverRoles, routeChain, routeKey, RUN_LEAVES, type Art, type Bounds, type FieldWp, type Sides } from "./art";
import { at, clampX, creep, creepAlong, cruise, drive, FIELD_WIDTH, follow, grid, join, MID_X, pursue, RAMP, ringFix, runRoute, settleWarp, sitDrift, velocity, type Key, type Pt } from "./motion";
import { decorate, hashUnit, periodOf, stratify } from "./natural";
import type { Motion, Pair, Route, Templates } from "./templates";

export { at, FIELD_WIDTH, MID_X, type Key, type Pt };

export interface TLMark {
  readonly slot: string;
  readonly side: "O" | "X";
  readonly position: string;
  readonly playerId: string;
  readonly keys: readonly Key[];
  /** Roles the engine credited this player with on this play. */
  readonly roles: readonly ParticipantRole[];
  /** Moved by facts (or the unit that handles the ball by the call), not by the diagram. */
  readonly fact: boolean;
  /** The path is drawn up to this time: the read for unnamed players (decision 13), the whistle for named ones. */
  readonly pathEnd: number;
  /** How the drawn path ends: a block tick for engaged offensive linemen, an arrowhead for other offense, nothing for defense. */
  readonly pathStyle: "block" | "arrow" | "none";
  /** Starts the play in a huddle (no number until the set). */
  readonly huddle: boolean;
  /** Natural motion (spec revision 2026-11-15): his own values and what the governor used, for tests. */
  readonly nat?: MarkNat;
}

/**
 * One mark's natural-motion record (NM1 to NM8), for tests and playtest only: his own top speed,
 * acceleration, reaction and start offset (NM4, from his id), the time scale, his departure, the
 * fact anchors he meets exactly, the designed arcs, the anchor-demanded legs and, for an engaged
 * lineman, the hand fight's window and axis. Never shown.
 */
export interface MarkNat {
  /** Own top speed, yd/s at 1x on the raw clock (divide by k for the screen clock). */
  readonly top: number;
  readonly accelMs: number;
  readonly reactionMs: number;
  /** His start offset from the spread (ms, added to the table start). */
  readonly startSpreadMs: number;
  /** The live time scale (decision 11). */
  readonly k: number;
  readonly dep: number;
  readonly anchors: readonly Key[];
  readonly arcs: readonly (readonly [number, number])[];
  readonly demanded: readonly { readonly t0: number; readonly t1: number; readonly mean: number }[];
  /** The settle's slow-down starts here (Infinity for the holder, tackler and sacker). */
  readonly settleFrom: number;
  readonly engaged?: { readonly from: number; readonly to: number; readonly axis: Pt; readonly partner: string | null };
}

export interface TLPath {
  readonly kind: "offense" | "defense" | "ball";
  readonly points: readonly Pt[];
  readonly start: number;
  readonly end: number;
}

export interface TLLabel {
  readonly text: string;
  readonly at: Pt;
  readonly t: number;
  /** The PlayResult (or after-snapshot) field the label states, so a test can check it. */
  readonly source: string;
}

export interface ScaleKey {
  readonly t: number;
  readonly s: number;
}

export interface Timeline {
  readonly los: number;
  readonly firstDown: number | null;
  /** The line-up phase: huddles break and the run-off clock counts down (0 when neither happens). */
  readonly lineUpMs: number;
  readonly runoffMs: number;
  readonly runoff: { readonly from: number; readonly to: number } | null;
  /** The set starts here; the snap at snapAt. */
  readonly setAt: number;
  readonly snapAt: number;
  readonly liveEnd: number;
  /** The settle runs from liveEnd for settleMs, inside the hold. */
  readonly settleMs: number;
  readonly holdMs: number;
  readonly total: number;
  readonly marks: readonly TLMark[];
  readonly ball: readonly Key[];
  /** The ball's drawn size (1 at rest; larger with height in flight). */
  readonly ballScale: readonly ScaleKey[];
  readonly paths: readonly TLPath[];
  readonly labels: readonly TLLabel[];
  readonly flags: readonly TLLabel[];
  /** The player holding the ball at the whistle, from the engine; null when nobody does or the engine didn't say. */
  readonly holder: string | null;
  /** The engine's tackler, whose mark ends at the ball. */
  readonly tackler: string | null;
  /** Players named in the play: their numbers show during the live play. */
  readonly involved: readonly string[];
  /** Marks with the ring: the holder at the whistle, a pre-snap fouler, a standout. */
  readonly rings: readonly string[];
  /** After the snap window the center and QB no longer handle the ball. */
  readonly snapWindowEnd: number;
  /** The read: the handoff, the throw, a QB crossing the line, or a kick landing. Pursuit starts here. */
  readonly read: number;
  /** The human's own call drawn faint from the set to the snap (decision 9): from the calls only. */
  readonly preview: Art | null;
  /**
   * Kickoffs, onside kicks and punts (calling screen pass Q4): every player the result doesn't name
   * draws a trail fading out over fadeMs (timeline ms) behind him, and no path at the whistle.
   * Absent on every other play (scrimmage paths draw as before).
   */
  readonly kickTrail?: { readonly fadeMs: number };
  /**
   * Data problems met while building (States: a mark that resolves no template), each naming the
   * file and key. timeline() stays pure; the caller logs them. Absent on frames built elsewhere.
   */
  readonly warnings?: readonly string[];
  /**
   * How an incompletion was drawn (spec amendment 2026-11-15, A3), for tests and the PERF report
   * only: a display guess, never shown as text and never a fact. Absent on every other play.
   */
  readonly miss?: { readonly kind: MissKind | null; readonly breaker: string | null; readonly at: Pt; readonly catchT: number; readonly throwT: number };
  /**
   * A kickoff return (spec amendment 2026-11-15, KR1 to KR9), for tests and playtest only: the
   * returner, the blockers and the coverage as KR defines them, the planned blocks (blocker,
   * coverage man, contact time), the side he cut to (null on a return too short to cut) and whether
   * that side was the id hash's (a tie at the cut). Absent on every other play.
   */
  readonly kickReturn?: { readonly returner: string; readonly blockers: readonly string[]; readonly coverage: readonly string[]; readonly blocks: readonly { readonly blocker: string; readonly coverage: string; readonly from: number }[]; readonly cutSide: -1 | 1 | null; readonly hashSide: -1 | 1 };
}

/** How timeline() builds a kickoff return (KR7): the cut's side and how far upfield he runs before it. */
interface KrOpt {
  readonly side?: -1 | 1;
  readonly up?: number;
  /** Stop after planning the blocks and return the cut choices (timeline()'s plan-only pass). */
  readonly planOnly?: boolean;
  /** The plan-only pass's blocks, used again by the build (they don't depend on the cut). */
  readonly blocks?: KrBlocks;
}

/** The planned blocks of a kickoff return and what the leaders are built from, for one time scale. */
interface KrBlocks {
  readonly k: number;
  readonly liveEnd: number;
  readonly keys: ReadonlyMap<string, { ks: Key[]; readFor: number }>;
  readonly pairs: readonly KrPair[];
  readonly blockers: readonly string[];
  readonly sorted: readonly string[];
  readonly usedB: ReadonlySet<string>;
  readonly setup: ReadonlyMap<string, { B1: Pt; t1: number; upfield: boolean; keys: Key[] }>;
  readonly tacklerAts: readonly ((t: number) => Pt)[];
  readonly offTackler: number;
}

/** A cut the planned blocks support: his side, how far upfield (yd) before the corner, and whether blocks decide it (else a tie). */
interface KrChoice extends KrOpt {
  readonly side: -1 | 1;
  readonly up: number;
  readonly decided: boolean;
}

/** A planned kickoff return block: the blocker meets the coverage man at `from`; `axis` points from the blocker to him. */
interface KrPair {
  readonly blocker: string;
  readonly coverage: string;
  readonly from: number;
  readonly axis: Pt;
}

interface KrPlan {
  readonly keys: Map<string, { ks: Key[]; readFor: number }>;
  readonly pairs: readonly KrPair[];
  readonly blockers: readonly string[];
  readonly coverage: readonly string[];
  /** Every return-unit mark's hang setup, from the set to his reaction after the catch (a recoverer's track until his read). */
  readonly setup: ReadonlyMap<string, readonly Key[]>;
}

/** The kinds of drawn miss (A3). */
export type MissKind = "breakup" | "overthrow" | "behind" | "short";

export interface TimelineInput {
  readonly event: PlayEvent;
  /** Seconds the clock ran before this snap (the run-off event), 0 for none. */
  readonly runoffSeconds: number;
  /** The try's kick spot in the offense's frame (GameState.trySpots.kick), for an extra point. */
  readonly tryKickSpot?: number;
  /** The side the human coaches on this play; null or absent for none (no huddle, no preview). */
  readonly human?: "offense" | "defense" | null;
  /** The human's side starts lined up (after the Calling state) or in its huddle (Same call). */
  readonly ownStart?: "lined" | "huddle";
}

export interface TimelineCtx {
  /** personnel.json presetPackage: the defense alignment for a preset. */
  readonly presetPackage: Readonly<Record<string, string>>;
  readonly endZoneYards: number;
  /** Jersey numbers by player id, for labels that name a player ("Fumble, recovered by #55"). */
  readonly numbers: Readonly<Record<string, number>>;
  /** Pixels per yard of the current layout, for the line's spacing and the huddle; absent means none. */
  readonly pxPerYard?: number;
  readonly markPx?: number;
  readonly motion: Motion;
  /** Test hook (R-C20): draw every incompletion with this kind of miss, whatever the geometry says. */
  readonly forceMiss?: MissKind;
  /** Test hook (natural motion, States): false draws the raw keys, with no governor (N6 and playtest A/B only). */
  readonly natural?: boolean;
  /**
   * Base ratings by player id (speed, agility, awareness, 0 to 99), passed like `numbers`: they set
   * how fast each player runs, accelerates and reacts (Joseph, 2026-11-15, decision 12 reversed;
   * motion.json ratings). A player with none moves at his position's values.
   */
  readonly ratings?: Readonly<Record<string, Readonly<Partial<Record<"speed" | "agility" | "awareness", number>>>>>;
}

// ---------------------------------------------------------------- units

const LOCATION_X: Readonly<Record<string, number>> = { left: 10, middle: MID_X, right: FIELD_WIDTH - 10 };
const PUNT_LABELS: Readonly<Record<string, string>> = {
  touchback: "Touchback",
  fairCatchShort: "Fair catch",
  fairCatchLong: "Fair catch",
  downedShort: "Downed",
  downedLong: "Downed",
  outOfBoundsShort: "Out of bounds",
  outOfBoundsLong: "Out of bounds",
  muffed: "Muffed",
  blocked: "Blocked",
};

/** An incompletion (spec amendment 2026-11-15, A4, final): the ball's size when it lands (on the ground, at most 0.6). */
const MISS_GROUND = 0.6;
/**
 * R-C18's reading of "a mark holds the ball": the ball within HOLD_YARDS of him for HOLD_MS or more.
 * A miss is placed so the ball never does that with the target (test-writer's reading, 0.5 yd for
 * 150 ms, with a margin: these are checks, not tuning).
 */
const HOLD_YARDS = 0.7;
const HOLD_MS = 100;

type Family = "run" | "pass" | "kick" | "kickoff" | "clock" | "none";

interface Unit {
  readonly offense: { readonly group: "offense" | "kick"; readonly name: string };
  readonly defense: { readonly group: "defense" | "returnUnits"; readonly name: string };
  readonly family: Family;
  readonly leaf: string;
  /** Unnamed offense routes and unnamed defense drops (template keys). */
  readonly routes: string;
  readonly drops: string;
  /** Snap time key in motion.snapMs. */
  readonly snapKey: string;
}

function unitOf(event: PlayEvent): Unit {
  const { play, offense, defense } = event;
  const k = play.kind;
  const leaf = offense.call === "goForTwo" ? (offense.twoPointPlay ?? "") : offense.call;
  if (k === "kickoff" || k === "onsideKick" || (k === "noPlay" && event.before.phase === "kickoff"))
    return { offense: { group: "kick", name: "kickoff" }, defense: { group: "returnUnits", name: "kickoff" }, family: "kickoff", leaf, routes: "cover", drops: "return", snapKey: "kickoff" };
  if (k === "punt" || leaf === "punt") return { offense: { group: "kick", name: "punt" }, defense: { group: "returnUnits", name: "punt" }, family: "kick", leaf: "punt", routes: "cover", drops: "return", snapKey: "punt" };
  if (k === "fieldGoal" || k === "extraPoint" || leaf === "fieldGoal" || leaf === "extraPoint") {
    const name = leaf === "extraPoint" || k === "extraPoint" ? "extraPoint" : "fieldGoal";
    return { offense: { group: "kick", name }, defense: { group: "returnUnits", name: "fieldGoal" }, family: "kick", leaf: name, routes: "kick", drops: "kick", snapKey: name };
  }
  if (k === "kneel" || k === "spike" || leaf === "kneel" || leaf === "spike")
    return { offense: { group: "offense", name: "underCenter" }, defense: { group: "defense", name: "base" }, family: "clock", leaf: k === "spike" || leaf === "spike" ? "spike" : "kneel", routes: "kick", drops: "kick", snapKey: "kneel" };
  const formation = offense.formation ?? "shotgun";
  return { offense: { group: "offense", name: formation }, defense: { group: "defense", name: defense ?? "" }, family: RUN_LEAVES.has(leaf) ? "run" : PASS_LEAVES.has(leaf) ? "pass" : "none", leaf, routes: routeKey(leaf), drops: "", snapKey: formation };
}

// ---------------------------------------------------------------- the plan (raw ms from the snap)

/** A fact mark's movement between two anchors. */
interface Leg {
  readonly pts: readonly Pt[];
  readonly t0: number;
  readonly t1: number;
  readonly restStart: boolean;
  readonly restEnd: boolean;
  /** t0 is a start time in screen ms after the snap (not scaled), as for a mark's first move. */
  readonly fixedStart?: boolean;
  /** A settle (sit drift) from pts[0] toward pts[1]: from speed v0 (yards per raw ms), at most L yards. */
  readonly drift?: { readonly v0: number; readonly L: number; readonly rampMs?: number };
  /** Its own break rounding (a kick returner's cut, KR6); motion.json fillet when absent. */
  readonly fillet?: Motion["fillet"];
  /** Carries on from the leg before at no more than his top speed (a kick returner after a hurried run to the catch). */
  readonly capV0?: boolean;
}

type BallSeg =
  | { readonly kind: "hold"; readonly id: string; readonly t0: number; readonly t1: number }
  | {
      readonly kind: "move";
      readonly pts: readonly Pt[];
      readonly t0: number;
      readonly t1: number;
      readonly apex: number;
      readonly endScale: number;
      /** The size it starts at (1 when absent); a ball already on the ground starts low. */
      readonly startScale?: number;
      /** The next segment carries on from this one's size, so it doesn't spring back to 1 at the end. */
      readonly keepScale?: boolean;
      /** The same flight as the segment before it (one path, one flight for the ring). */
      readonly joinPrev?: boolean;
    }
  | { readonly kind: "jump"; readonly to: Pt; readonly t: number };

interface Plan {
  /** The whistle, raw ms from the snap. */
  whistle: number;
  /** Fixed live length (kneel 900, spike 700), else null for the clamp. */
  fixed: number | null;
  read: number;
  legs: Map<string, Leg[]>;
  ball: BallSeg[];
  holder: string | null;
  labels: { text: string; at: Pt; t: number; source: string }[];
  /** The carrier's handoff or catch time (for the release of the line). */
  releaseAt: number;
  /** The engine's target: he runs his template to the R7 leave point, then to the catch point at catchT. */
  target: { readonly id: string; readonly throwT: number; readonly catchT: number; readonly at: Pt } | null;
  /** Fact marks that settle (a sit drift) after their last leg instead of drifting to the ball. */
  sitAfter: Set<string>;
  /**
   * Named defenders who run their template until the read, then converge on their fact (R9): the
   * interceptor (read: the throw) and the sacker (read: the drop's end).
   */
  converge: Map<string, { readonly read: number; readonly t: number; readonly at: Pt; readonly around?: boolean }>;
  /**
   * An incompletion (spec amendment 2026-11-15, A1 to A5): the throw and the arrival at the aim
   * point, from the calls and the target only. Where the ball lands is resolved on the screen
   * clock, once it is known, so nothing before the throw depends on the kind of miss.
   */
  miss: { readonly id: string | null; readonly throwT: number; readonly catchT: number; readonly from: Pt; readonly aim: Pt; readonly apex: number } | null;
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const smoothstepT = (x: number): number => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

/** A miss point the drawing showed a defender near, and who (the clear check on the drawn marks). */
interface MissSeen {
  readonly P: Pt;
  readonly id: string;
  readonly d: number;
  /** Where he was drawn at the arrival. */
  readonly at: Pt;
}
/** How many times an incompletion is redrawn when a defender is drawn within clearYards of P. */
const MISS_REDRAWS = 4;

/**
 * The clear check (A3) on where defenders are actually drawn: a miss that is not a break-up is
 * drawn again, with P and the nearest defender recorded, when a defender's drawn mark is within
 * miss.clearYards of P at the arrival. The redraw applies A3 with what was seen: that defender
 * becomes the breaker when he is eligible and within the break-up's pace, else P goes where it
 * reads as a miss. The first drawing's estimate (predictAt) is usually right, so this is rare. Only
 * what happens after the throw changes: frames up to it never depend on P (R-C20).
 */
export function timeline(input: TimelineInput, templates: Templates, ctx: TimelineCtx): Timeline {
  // A kickoff return: the blocks are planned once (a plan-only pass) and the cut is chosen from them.
  if (input.event.play.kind === "kickoff") {
    const choices = drawCore(input, templates, ctx, [], { planOnly: true });
    if (Array.isArray(choices) && choices.length > 0) return drawReturn(input, templates, ctx, choices);
  }
  const seen: MissSeen[] = [];
  for (let i = 0; ; i++) {
    const tl = drawTimeline(input, templates, ctx, seen);
    const m = tl.miss;
    if (m === undefined || m.kind === null || m.kind === "breakup" || ctx.forceMiss !== undefined) return tl;
    let near: { id: string; d: number; at: Pt } | null = null;
    for (const x of tl.marks) {
      if (x.side !== "X") continue;
      const q = at(x.keys, m.catchT);
      const dd = dist(q, m.at);
      if (dd < ctx.motion.miss.clearYards && (near === null || dd < near.d)) near = { id: x.playerId, d: dd, at: { x: q.x, y: q.y } };
    }
    if (near === null) return tl;
    if (i >= MISS_REDRAWS) return { ...tl, warnings: [...(tl.warnings ?? []), `miss: ${near.id} is drawn ${near.d.toFixed(2)} yd from the loose ball after ${MISS_REDRAWS} redraws`] };
    seen.push({ P: m.at, ...near });
  }
}

/**
 * KR7: at his first cut the returner turns to the side with more blockers engaged at that key (as
 * KR4 defines engaged, on the drawn marks), the id hash's side on a tie. The plan-only pass plans
 * the blocks against a band that holds whichever way he cuts, so they are the same for every cut,
 * and lists the cuts their geometry supports (krChoices): the play is then built once with the
 * first. The drawing is checked, and only when it reads otherwise is the next choice built, at most
 * KR_DRAWS in all. The choice is checked on the natural drawing also when the caller asks for raw
 * keys (natural: false, a test hook), so both drawings cut at the same place.
 */
function drawReturn(input: TimelineInput, templates: Templates, ctx: TimelineCtx, choices: readonly KrChoice[]): Timeline {
  const natCtx: TimelineCtx = ctx.natural === false ? { ...ctx, natural: true } : ctx;
  let first: Timeline | null = null;
  for (const c of choices.slice(0, KR_DRAWS)) {
    const x = drawTimeline(input, templates, natCtx, [], c);
    first ??= x;
    if (cutReads(x, ctx.motion)) return ctx.natural === false ? drawTimeline(input, templates, ctx, [], c) : x;
  }
  const f = ctx.natural === false ? drawTimeline(input, templates, ctx, [], choices[0] as KrChoice) : (first as Timeline);
  return { ...f, warnings: [...(f.warnings ?? []), "kickReturn: no cut tried reads toward the drawn blocks"] };
}

/** At most this many builds of one kickoff return (a compute cap, not tuning): the first choice, then fallbacks. */
const KR_DRAWS = 3;

/** His first cut points to the side with more engaged blockers, or on a tie to the id hash's side. */
function cutReads(tl: Timeline, M: Motion): boolean {
  const kr = tl.kickReturn;
  if (kr === undefined || kr.cutSide === null) return true;
  const r = cutCount(tl, M);
  return r !== null && r.got === (r.more === 0 ? kr.hashSide : r.more);
}

/**
 * The returner's first heading change of kickReturn.cutDeg or more after the catch (headings over
 * kickReturn.headingMs before and after, from headingMs after the catch), and at that key the side with more blockers
 * engaged (KR4: within engageYards of a coverage mark, in a contact that began where he wasn't
 * behind the carrier by more than behindToleranceYards): +1 right, -1 left, 0 a tie. `got` is the
 * side his new heading points to. Null when he never turns that much.
 */
export function cutCount(tl: Timeline, M: Motion): { t: number; more: -1 | 0 | 1; got: -1 | 1 } | null {
  const kr = tl.kickReturn;
  if (kr === undefined) return null;
  const keysOf = new Map(tl.marks.map((m) => [m.playerId, m.keys]));
  const car = keysOf.get(kr.returner);
  if (car === undefined) return null;
  const K = M.kickReturn;
  const W = K.headingMs;
  const p = (t: number): Pt => at(car, t);
  const grid0 = (t: number): number => Math.ceil(t / M.keyMs - 1e-9) * M.keyMs;
  // From the first key he is upfieldYards past the catch (KR6's upfield phase), at least 300 ms after it.
  const catchPt = p(tl.read);
  let tU = Infinity;
  for (let t = grid0(tl.read); t <= tl.liveEnd + 1e-6; t += M.keyMs)
    if (catchPt.y - p(t).y >= K.upfieldYards - 1e-9) {
      tU = t;
      break;
    }
  if (tU === Infinity) return null;
  let tc: number | null = null;
  for (let t = grid0(Math.max(tU, tl.read + W)); t <= tl.liveEnd - W + 1e-6; t += M.keyMs) {
    const a = p(t - W);
    const b = p(t);
    const c = p(t + W);
    const h0 = Math.atan2(b.y - a.y, b.x - a.x);
    const h1 = Math.atan2(c.y - b.y, c.x - b.x);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.3 || Math.hypot(c.x - b.x, c.y - b.y) < 0.3) continue;
    const d = Math.abs(((h1 - h0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    if (d >= (K.cutDeg * Math.PI) / 180) {
      tc = t;
      break;
    }
  }
  if (tc === null) return null;
  const here = p(tc);
  let left = 0;
  let right = 0;
  for (const b of kr.blockers) {
    const bk = keysOf.get(b);
    if (bk === undefined) continue;
    const q = at(bk, tc);
    const engaged = kr.coverage.some((c) => {
      const ck = keysOf.get(c);
      if (ck === undefined || dist(q, at(ck, tc)) > K.engageYards) return false;
      let t0 = tc;
      while (t0 - M.keyMs >= tl.snapAt && dist(at(bk, t0 - M.keyMs), at(ck, t0 - M.keyMs)) <= K.engageYards) t0 -= M.keyMs;
      return at(bk, t0).y - p(t0).y <= K.behindToleranceYards;
    });
    if (!engaged) continue;
    if (q.x < here.x) left++;
    else if (q.x > here.x) right++;
  }
  const after = p(tc + W);
  return { t: tc, more: right > left ? 1 : left > right ? -1 : 0, got: after.x >= here.x ? 1 : -1 };
}

function drawTimeline(input: TimelineInput, templates: Templates, ctx: TimelineCtx, missSeen: readonly MissSeen[], krOpt?: KrOpt): Timeline {
  return drawCore(input, templates, ctx, missSeen, krOpt) as Timeline;
}

/** The whole drawing, or with krOpt.planOnly the kickoff return's cut choices only (no marks are built). */
function drawCore(input: TimelineInput, templates: Templates, ctx: TimelineCtx, missSeen: readonly MissSeen[], krOpt?: KrOpt): Timeline | KrChoice[] {
  const M = ctx.motion;
  const { event } = input;
  const { play, before, after } = event;
  const d = readDetail(play);
  // M2 F (code review): the loop's final standout (a candidate whose play stood), the detail hook as a fallback.
  const star = event.standout ?? d.standout;
  const parts = d.participants ?? {};
  const unit = unitOf(event);
  const isKickTry = play.kind === "extraPoint" || (play.kind === "noPlay" && event.offense.call === "extraPoint");
  const los = isKickTry && input.tryKickSpot !== undefined ? input.tryKickSpot : before.spot;
  const endLine = 100 + ctx.endZoneYards;
  const tm = templates.timing;

  // ------------------------------------------------------------ marks at the set
  const onField = d.onField;
  const offSlots = onField?.offense ?? [];
  const defSlots = onField?.defense ?? [];
  const pkg = unit.defense.group === "defense" ? (ctx.presetPackage[unit.defense.name] ?? unit.defense.name) : unit.defense.name;
  const offTmpl = unit.offense.group === "offense" ? templates.offense[unit.offense.name] : templates.kick[unit.offense.name];
  const defTmpl = unit.defense.group === "defense" ? templates.defense[pkg] : templates.returnUnits[unit.defense.name];
  const preset = unit.defense.group === "defense" ? unit.defense.name : null;
  const offStart = lineUp(offSlots, offTmpl, "O", los, templates, ctx.pxPerYard);
  const defStart = lineUp(defSlots, defTmpl, "X", los, templates, ctx.pxPerYard, preset === null ? undefined : templates.presetAlignment[preset]);
  // Receiver roles and the strong side (R1), the play side (R3: runLocation, else strong), the clamps.
  const offRefs = offSlots.map((s) => ({ slot: s.slot, position: s.position }));
  const { roles, strong } = receiverRoles(offRefs, offStart);
  const playSign = d.runLocation === "left" ? -1 : d.runLocation === "right" ? 1 : strong;
  const sides: Sides = { strong, play: playSign };
  const bounds: Bounds = { margin: M.sidelineMarginYards, maxY: endLine - 1 };
  const startOf = new Map<string, Pt>();
  offSlots.forEach((s, i) => startOf.set(s.id, offStart[i] as Pt));
  defSlots.forEach((s, i) => startOf.set(s.id, defStart[i] as Pt));
  const slotOf = new Map<string, OnFieldSlot & { side: "O" | "X"; index: number }>();
  offSlots.forEach((s, i) => slotOf.set(s.id, { ...s, side: "O", index: i }));
  defSlots.forEach((s, i) => slotOf.set(s.id, { ...s, side: "X", index: i }));
  const known = (id: string | undefined): id is string => id !== undefined && startOf.has(id);
  const firstAt = (position: string, slots: readonly OnFieldSlot[]): string | undefined => slots.find((s) => s.position === position)?.id;

  // ------------------------------------------------------------ NM4: each player's own values
  // A stratified spread within each side and position group, from the hash of the player id: never
  // from the calls, the target or the result, and never changing a route, a choice or a card.
  const NAT = M.natural;
  const natural = ctx.natural !== false;
  const spreadOf = (salt: string): Map<string, number> => {
    const out = new Map<string, number>();
    const groups = new Map<string, string[]>();
    for (const [id, sl] of slotOf) groups.set(`${sl.side}|${sl.position}`, [...(groups.get(`${sl.side}|${sl.position}`) ?? []), id]);
    for (const ids of groups.values()) for (const [id, v] of stratify(ids, salt)) out.set(id, v);
    return out;
  };
  const sTop = spreadOf("top");
  const sAcc = spreadOf("accel");
  const sReact = spreadOf("reaction");
  const sStart = spreadOf("start");
  // The snap is an anchor: the QB and the snapper (the lineman over the ball) start on the table.
  const snapper = offSlots.filter((x) => x.position === "OL").reduce<{ id: string; d: number } | null>((b, x) => {
    const q = startOf.get(x.id) as Pt;
    const d = Math.abs(q.x - MID_X) + Math.abs(q.y - los);
    return b === null || d < b.d ? { id: x.id, d } : b;
  }, null)?.id;
  /** His own top speed (yd/s at 1x, raw clock), acceleration time, reaction and start offset. */
  // Ratings drive motion (decision 12 reversed): speed scales his top speed, agility his accelMs,
  // awareness his reaction and his start; the hash spread above only breaks ties.
  const RT = M.ratings;
  const rated = (id: string | undefined, r: "speed" | "agility" | "awareness", pick: (b: (typeof RT)["default"]) => readonly [number, number]): number => {
    const v = ctx.ratings?.[id ?? ""]?.[r];
    if (v === undefined) return 0;
    const band = pick(RT.byPosition[slotOf.get(id ?? "")?.position ?? ""] ?? RT.default);
    const f = Math.max(0, Math.min(1, (v - RT.lo) / (RT.hi - RT.lo)));
    return band[0] + (band[1] - band[0]) * f;
  };
  const topOf = (id: string | undefined): number => {
    const pos = slotOf.get(id ?? "")?.position ?? "WR";
    return (M.speed[pos] ?? 13) * (1 + rated(id, "speed", (b) => b.topShare) + NAT.spread.topShare * (sTop.get(id ?? "") ?? 0));
  };
  const accOf = (id: string | undefined): number => {
    const pos = slotOf.get(id ?? "")?.position ?? "WR";
    return (M.accelMs[pos] ?? 300) * (1 + rated(id, "agility", (b) => b.accelShare) + NAT.spread.accelShare * (sAcc.get(id ?? "") ?? 0));
  };
  const reactOf = (id: string | undefined): number => {
    const pos = slotOf.get(id ?? "")?.position ?? "WR";
    return Math.max(0, (M.reactionMs[pos] ?? M.reactionMs["other"] ?? 150) + rated(id, "awareness", (b) => b.reactionMs) + NAT.spread.reactionMs * (sReact.get(id ?? "") ?? 0));
  };
  const startSpread = (id: string): number => (slotOf.get(id)?.position === "QB" || id === snapper ? 0 : rated(id, "awareness", (b) => b.startMs) + NAT.spread.startMs * (sStart.get(id) ?? 0));
  /** His start after the snap (ms): the table, the slot offset and his spread, at least 0, at most maxStartMs. */
  const startAfter = (id: string): number => {
    const sl = slotOf.get(id);
    const pos = sl?.position ?? "WR";
    return Math.min(M.maxStartMs, Math.max(0, (M.startMs[pos] ?? 0) + ((sl?.index ?? 0) % 3) * M.slotOffsetMs + startSpread(id)));
  };

  // ------------------------------------------------------------ pre-snap phases
  const publicLineup = unit.family === "kick" || unit.family === "kickoff" || unit.family === "clock";
  const human = input.human ?? null;
  const huddled = (side: "O" | "X"): boolean => {
    if (human === null || publicLineup) return false;
    const own = (human === "offense" ? "O" : "X") === side;
    return own ? input.ownStart === "huddle" : true;
  };
  const anyHuddle = offSlots.length > 0 && (huddled("O") || huddled("X"));
  const runoffMs = input.runoffSeconds > 0 ? M.preSnap.runoffMaxMs : 0;
  const lineUpMs = Math.max(anyHuddle ? M.preSnap.lineUpMs : 0, runoffMs);
  const setAt = lineUpMs;
  const snapAt = lineUpMs + M.preSnap.setMs;
  const px = ctx.pxPerYard ?? 11.5;
  const markPx = ctx.markPx ?? Math.max(templates.field.markMinPx, templates.field.markYards * px);
  const huddleOf = (side: "O" | "X", n: number): Pt[] => huddleSpots(n, side, los, px, markPx, M.huddle.offenseBehind, M.huddle.defensePast, M.huddle.markGapPx, ctx.endZoneYards);
  const offHuddle = huddleOf("O", offSlots.length);
  const defHuddle = huddleOf("X", defSlots.length);

  // ------------------------------------------------------------ the plan
  const spotX = (loc: string | undefined): number => (loc === undefined ? MID_X : (LOCATION_X[loc] ?? MID_X));
  const end = "end" in play && play.end !== undefined ? play.end : undefined;
  const ob = "outOfBounds" in play && play.outOfBounds === true;
  const endPt = (fromX: number): Pt => {
    const y = end?.spot ?? los;
    const side = d.runLocation ?? d.passLocation;
    // DECISIONS.md, "Dead spot x follows the carrier" (designed, display only): the engine gives only
    // the dead spot's y. With no run or pass location the carrier finishes straight upfield from where
    // he turned up or caught it, inside the sideline margin, never back to the middle of the field.
    const inField = Math.max(M.sidelineMarginYards, Math.min(FIELD_WIDTH - M.sidelineMarginYards, fromX));
    const x = ob ? (side === "left" ? 0 : side === "right" ? FIELD_WIDTH : fromX < MID_X ? 0 : FIELD_WIDTH) : side !== undefined ? spotX(side) : inField;
    return { x, y };
  };
  const speedOf = (id: string | undefined): number => topOf(id);
  const travel = (a: Pt, b: Pt, id: string | undefined): number => (dist(a, b) / speedOf(id)) * 1000 + M.decelMs / 2;
  // Every use is a fixedStart leg, which the leg builder caps at maxStartMs too.
  const startMs = (id: string): number => startAfter(id);
  const recoveredText = (id: string | undefined): string => {
    const n = id === undefined ? undefined : ctx.numbers[id];
    return n === undefined ? "Fumble" : `Fumble, recovered by #${n}`;
  };
  const fumbled = d.class === "fumble" || d.class === "fumbleCatch" || ("turnover" in play && play.turnover === "fumble");
  const plan: Plan = { whistle: 0, fixed: null, read: 0, legs: new Map(), ball: [], holder: null, labels: [], releaseAt: 0, target: null, sitAfter: new Set(), converge: new Map(), miss: null };
  // Kickoff return pass (KR1 to KR9): the returner on a return, his cut (raw clock), and the tie-break side.
  const KR = M.kickReturn;
  let krReturner: string | null = null;
  // The cut (raw clock), with how far upfield its corner may be (minUp to maxUp yd past the catch).
  let krCut: { readonly side: -1 | 1; readonly up: Pt; readonly minUp: number; readonly maxUp: number } | null = null;
  let krLand: Pt | null = null;
  const krHashSide = (ret: string): -1 | 1 => (hashUnit(`${ret}|${parts.kicker ?? ""}`, "krCut") < 0.5 ? -1 : 1);
  /**
   * A fumble recoverer (R9): his unnamed track until the R-C9 `read` (the handoff or catch, the drop's
   * end on a sack), then on to the ball. He gets there no sooner than `loose` (when the ball is
   * free) and no faster than his top speed: returns when he recovers it. Until then the ball stays
   * loose near the fumble spot. A player with a path already (the sacker) goes on from its end.
   */
  const recover = (id: string, read: number, loose: number, to: Pt): number => {
    const time = (from: Pt): number => (dist(from, to) / speedOf(id)) * 1000 + accOf(id) / 2 + M.decelMs / 2;
    const conv = plan.converge.get(id);
    const legs = plan.legs.get(id);
    const lastLeg = legs?.[legs.length - 1];
    if (conv !== undefined || lastLeg !== undefined) {
      const from = conv !== undefined ? conv.at : (lastLeg?.pts[lastLeg.pts.length - 1] as Pt);
      const t0 = conv !== undefined ? conv.t : (lastLeg?.t1 as number);
      const tRec = Math.max(loose, t0 + time(from));
      leg(id, { pts: [from, to], t0, t1: tRec, restStart: true, restEnd: false });
      return tRec;
    }
    const tRec = Math.max(loose, read + time(startOf.get(id) as Pt));
    plan.converge.set(id, { read, t: tRec, at: to });
    return tRec;
  };
  const leg = (id: string | undefined, l: Leg): void => {
    if (!known(id)) return;
    plan.legs.set(id, [...(plan.legs.get(id) ?? []), l]);
  };
  const qb = firstAt("QB", offSlots);
  const q0 = qb !== undefined ? (startOf.get(qb) as Pt) : { x: MID_X, y: los - 4 };
  const ball0: Pt = { x: MID_X, y: los };
  const snapMs = M.snapMs[unit.snapKey] ?? 120;
  const kind = play.kind === "twoPoint" ? (RUN_LEAVES.has(unit.leaf) ? "run" : "pass") : play.kind;

  /**
   * The points after `a` on a carrier's way to `b` (DECISIONS.md, "Out-of-bounds carry runs upfield
   * first", designed, display only): on a play the engine ends out of bounds he runs straight
   * upfield (toward b's y) at his x until the depth left equals the lateral distance left, then cuts
   * at 45 degrees to b. With less depth than lateral left it is the straight line. Both ends are facts.
   */
  const obPath = (a: Pt, b: Pt): Pt[] => {
    const lat = Math.abs(b.x - a.x);
    const dep = Math.abs(b.y - a.y);
    if (!ob || lat < 1e-6 || dep <= lat + 1e-6) return [b];
    return [{ x: a.x, y: b.y - Math.sign(b.y - a.y) * lat }, b];
  };
  const pathLen = (r: readonly Pt[]): number => {
    let len = 0;
    for (let i = 1; i < r.length; i++) len += dist(r[i - 1] as Pt, r[i] as Pt);
    return len;
  };
  /** The carrier from `from` (holding the ball from t0) to the dead spot, with a fumble when the engine says so. */
  /** `read` is the play's R-C9 read (a fumble recoverer follows his unnamed track until it); t0 by default. */
  const carry = (carrier: string | undefined, pts: Pt[], t0: number, ballT0: number = t0, read: number = t0, fil?: Motion["fillet"]): void => {
    const withFil = fil === undefined ? {} : { fillet: fil, capV0: true };
    const last = pts[pts.length - 1] as Pt;
    const e = endPt(last.x);
    const route = [...pts, ...obPath(last, e)];
    // Natural motion (NM6): room for his smooth speed-up and stop, so the carry is run at about his
    // top speed (a carry from rest needs his whole ramp; one already moving about half of it).
    const slack = Math.max(M.convergeMs, (RAMP / 2) * M.decelMs + (RAMP / 2) * accOf(carrier ?? qb) * (t0 === 0 ? 1 : 0.5));
    const t1 = t0 + (pathLen(route) / speedOf(carrier ?? qb)) * 1000 + slack;
    if (fumbled) {
      const loose = d.fumbleSpot === undefined ? e : { x: e.x, y: d.fumbleSpot };
      const toLoose = [...pts, ...obPath(last, loose)];
      const tl = t1 - 350;
      const rec = parts.fumbleRecoverer;
      leg(carrier, { pts: toLoose, t0, t1: tl, restStart: t0 === 0, restEnd: true, ...withFil });
      if (known(carrier)) plan.ball.push({ kind: "hold", id: carrier, t0: ballT0, t1: tl });
      else plan.ball.push({ kind: "move", pts: toLoose, t0, t1: tl, apex: 1, endScale: 1 });
      const pop = { x: loose.x + 1.5, y: loose.y };
      plan.ball.push({ kind: "move", pts: [loose, pop], t0: tl, t1: tl + 200, apex: 0.8, endScale: 0.8 });
      if (known(rec)) {
        // R9: his unnamed track until the read, then to the ball; it rolls a little until he gets there.
        const roll = { x: pop.x + M.fumble.rollYards, y: pop.y };
        const tRec = recover(rec, read, tl + 200, roll);
        plan.ball.push({ kind: "move", pts: [pop, roll], t0: tl + 200, t1: tRec, apex: 1, endScale: 1 });
        // His return from the ball to the dead spot, at his own speed (it used to be squeezed into a fixed 150 ms).
        const back = [roll, ...obPath(roll, e)];
        const t2 = tRec + Math.max(t1 - (tl + 200), (pathLen(back) / speedOf(rec)) * 1000 + M.decelMs / 2);
        leg(rec, { pts: back, t0: tRec, t1: t2, restStart: false, restEnd: true });
        plan.ball.push({ kind: "hold", id: rec, t0: tRec, t1: t2 });
        plan.holder = rec;
        plan.labels.push({ text: recoveredText(rec), at: loose, t: t2, source: "participants.fumbleRecoverer" });
        plan.whistle = t2;
        return;
      }
      plan.ball.push({ kind: "move", pts: [pop, e], t0: tl + 200, t1, apex: 1, endScale: 1 });
      plan.labels.push({ text: "Fumble", at: loose, t: t1, source: "participants.fumbleRecoverer" });
      plan.whistle = t1;
      return;
    }
    leg(carrier, { pts: route, t0, t1, restStart: t0 === 0, restEnd: true, ...withFil });
    if (known(carrier)) {
      plan.ball.push({ kind: "hold", id: carrier, t0: ballT0, t1 });
      plan.holder = carrier;
    } else plan.ball.push({ kind: "move", pts: route, t0, t1, apex: 1, endScale: 1 });
    plan.whistle = t1;
  };

  const warnings = new Set<string>();
  /** A template's waypoints placed from a start, on this play's sides and clamps. */
  const place = (start: Pt, route: Route | undefined): FieldWp[] => placeRoute(start, route, sides, bounds);
  /** The route a diagram offense player runs on this play (the R1 lookup chain). */
  const routeFor = (s: OnFieldSlot): Route | undefined => lookup(templates.routes[unit.routes], routeChain(roles.get(s.slot), s.position));

  /**
   * A player's template track (R5): his route at routePace x top from his start, then his finish to
   * `horizon`, on a clock whose origin is the snap and whose speeds are top / kk. From the calls and
   * the play side only. A stalk finish follows `stalkOf`'s defender when given, else he sits.
   */
  function trackOf(id: string, origin: number, kk: number, horizon: number, stalkOf?: (id: string) => readonly Key[] | undefined, quiet = false): { keys: Key[]; finish: string; releaseEnd: number } {
    const s = slotOf.get(id) as OnFieldSlot & { index: number };
    const set = startOf.get(id) as Pt;
    const pos = s.position;
    const top = topOf(id) / kk;
    const t0 = origin + startAfter(id);
    let route = routeFor(s);
    if (route === undefined) {
      // States (unreachable in shipped data): the old check-down to the flat, and a warning naming
      // the file and key, which the caller logs.
      if (!quiet) warnings.add(`data/ui/templates.json: routes.${unit.routes} has no template for ${s.slot} (${routeChain(roles.get(s.slot), pos).join(", ")}); drawn as a check-down`);
      route = { pts: [{ p: [-3, 2], pauseMs: 0, pace: 1 }], finish: "sit", axis: "in" };
    }
    const wps = place(set, route);
    const endPace = route.finish === "continue" ? M.continuePace : M.sit.pace;
    const r = runRoute(set, wps, t0, { top, pace: M.routePace, endPace, accelMs: accOf(id), decelMs: M.decelMs, keyMs: M.keyMs, fillet: M.fillet, pause: M.sit, smoothMs: NAT.smoothMs });
    const head: Key[] = join([{ t: origin, ...set }, { t: t0, ...set }], r.keys);
    if (horizon <= r.end) return { keys: underBackLine(head, set), finish: route.finish, releaseEnd: r.end };
    let tail: Key[];
    const stalkKeys = route.finish === "stalk" ? stalkOf?.(id) : undefined;
    // A continue finish keeps on at continuePace x top, reaching it at his own acceleration if he arrived slower.
    if (route.finish === "continue") tail = cruise(r.at, r.dir, r.speed, r.end, horizon, { margin: M.sidelineMarginYards, maxY: bounds.maxY, turnDegPerS: M.pursuit.turnDegPerS, sitYards: sitYards(M.sit.maxYards), keyMs: M.keyMs, vTarget: (M.continuePace * top) / 1000, accel: top / 1000 / Math.max(1, accOf(id)), lateral: NAT.lateralAccel / 1e6 / kk });
    else if (stalkKeys !== undefined && stalkKeys.length > 0) {
      // Shadow the defender at contact distance, on the side he released to, a reaction lag behind.
      const D0 = at(stalkKeys, r.end);
      const off = Math.hypot(r.at.x - D0.x, r.at.y - D0.y) < 1e-6 ? { x: 0, y: -1 } : { x: (r.at.x - D0.x) / Math.hypot(r.at.x - D0.x, r.at.y - D0.y), y: (r.at.y - D0.y) / Math.hypot(r.at.x - D0.x, r.at.y - D0.y) };
      const lag = M.stalk.lagMs;
      tail = follow({ start: r.at, vel: { x: r.dir.x * r.speed, y: r.dir.y * r.speed }, t0: r.end, t1: horizon, target: (t) => { const q = at(stalkKeys, t - lag); return { x: q.x + off.x * M.stalk.contactYards, y: q.y + off.y * M.stalk.contactYards }; }, top, accelMs: accOf(id), brakeYards: M.pursuit.brakeYards, keyMs: M.keyMs, lock: { to: (t) => at(stalkKeys, t), within: M.stalk.contactYards + (topOf(stalkTarget(id)?.id) * M.stalk.lagMs) / 1000 }, lockBlendMs: NAT.smoothMs });
    } else {
      const sd = settleDir(r.at, r.dir, r.speed, set, top);
      tail = sitDrift(r.at, sd.dir, sd.v0, sitYards(route.finish === "block" ? M.sit.blockMaxYards : M.sit.maxYards), r.end, horizon, M.keyMs);
    }
    return { keys: underBackLine(join(head, tail), set), finish: route.finish, releaseEnd: r.end };
  }

  /** A sit or block finish's eased stop leaves room for the idle sway inside its distance (NM7). */
  function sitYards(L: number): number {
    return Math.max(0, L - NAT.idle.swayYards / 2);
  }

  /**
   * A settle's direction and start speed: on along his heading, or sideways (toward the middle) when
   * the end line stops him, so a red-zone drop clamped there still creeps instead of standing dead (R5).
   */
  function settleDir(p: Pt, dir: Pt, v0: number, set: Pt, top: number): { dir: Pt; v0: number } {
    const cap = Math.max(bounds.maxY, set.y);
    if (p.y < cap - 0.05 || dir.y <= 0) return { dir, v0 };
    return { dir: { x: p.x <= MID_X ? 1 : -1, y: 0 }, v0: Math.max(v0, (M.sit.pace * top) / 1000) };
  }

  /** States: nobody's template track goes past the end line minus 1 yd (unless he lines up past it). */
  function underBackLine(keys: Key[], set: Pt): Key[] {
    const cap = Math.max(bounds.maxY, set.y);
    return keys.some((q) => q.y > cap) ? keys.map((q) => (q.y > cap ? { ...q, y: cap } : q)) : keys;
  }

  /**
   * A fact mark that holds between two anchors (the QB in the pocket, a play-action fake's pause)
   * settles instead of freezing (R5): a sit drift toward `toward`, at most `maxYards`. Returns where
   * he ends; the drift's end is the same at any time scale (its speed scales with the clock).
   */
  const settleLeg = (id: string | undefined, from: Pt, toward: Pt, t0: number, t1: number, maxYards: number, speed?: number): Pt => {
    if (!known(id) || t1 <= t0 + 1e-6) return from;
    // Natural motion: a creep from rest that takes the whole throw hold to cover maxYards, so he is
    // never still in the pocket and his position never depends on when the throw comes. With
    // `speed` (yards per raw ms) it is a quicker step at that pace instead (the QB's hitch up in
    // the pocket, DECISIONS.md "The QB sets and steps up", 2026-11-15): still from the calls only.
    const v0 = speed ?? maxYards / Math.max(1, M.throwHold.maxMs);
    const D = dist(from, toward);
    if (D < 1e-9 || maxYards <= 0) return from;
    const tau = t1 - t0;
    // The step's ease in and out is short enough that it reaches `speed` (the creep's own ramp caps
    // it at maxYards / rampMs, about 4 yd/s), so the data sets the step's pace.
    const rampMs = speed === undefined ? NAT.idle.rampMs : Math.min(NAT.idle.rampMs, maxYards / Math.max(1e-9, speed));
    const sAt = creepAlong(v0, maxYards, rampMs, tau);
    leg(id, { pts: [from, toward], t0, t1, restStart: false, restEnd: false, drift: { v0, L: maxYards, ...(speed === undefined ? {} : { rampMs }) } });
    return { x: from.x + ((toward.x - from.x) / D) * sAt, y: from.y + ((toward.y - from.y) / D) * sAt };
  };

  /**
   * The QB's drop on a pass play, from the calls only: his template to his drop point, at rest by the
   * drop end plus the hitch (a play-action fake, its pause and the boot first). A sack draws the
   * same legs (QD4, spec revision 2026-11-16), so nothing differs before a sack's read.
   */
  /** A plant throw (QD2): its raw time, the planned release point and the drop end plus the hitch. */
  let plant: { throwT: number; from: Pt; gapEnd: number } | null = null;
  const dropLegs = (who: string, drop: number, qWps: readonly FieldWp[]): void => {
        const fake = unit.leaf === "playAction" && qWps.length > 1 ? (qWps[0] as FieldWp) : undefined;
        if (fake !== undefined) {
          // The fake, the hold of the ball out (its pause), then the boot. The boot gets the time it
          // takes at routePace x his own top speed from rest to rest (its length over his top, plus half his
          // speed-up and his stop), so it is never drawn faster than he runs: the pause gives way
          // first, never past the fake's end (DECISIONS.md, "Play-action boot at his own speed").
          const boot = qWps.slice(1).map((w) => w.p);
          const bootMs = (pathLen([fake.p, ...boot]) / (M.routePace * speedOf(who))) * 1000 + (RAMP * (accOf(who) + M.decelMs)) / 2;
          const leave = Math.max(M.fakeMs, Math.min(drop - 2 * M.keyMs, M.fakeMs + fake.pauseMs, drop + M.hitchMs - bootMs));
          leg(who, { pts: [q0, fake.p], t0: 0, t1: M.fakeMs, restStart: true, restEnd: true, fixedStart: true });
          const held = settleLeg(who, fake.p, boot[0] as Pt, M.fakeMs, leave, Math.min(M.sit.maxYards, M.sit.pauseLegShare * dist(fake.p, boot[0] as Pt)));
          leg(who, { pts: [held, ...boot], t0: leave, t1: drop + M.hitchMs, restStart: true, restEnd: true });
          // Natural motion (NM6): he reaches his drop point at rest by the earliest throw (the drop end
          // plus the hitch), so a short drop stays inside his own acceleration and jerk. Calls only.
        } else leg(who, { pts: [q0, ...qWps.map((w) => w.p)], t0: 0, t1: drop + M.hitchMs, restStart: true, restEnd: true, fixedStart: true });
  };

  switch (kind) {
    case "run":
    case "scramble":
    case "kneel": {
      const carrier = parts.ballCarrier ?? (kind === "run" ? undefined : parts.passer);
      plan.ball.push({ kind: "move", pts: [ball0, q0], t0: 0, t1: snapMs, apex: 1, endScale: 1 });
      if (kind === "kneel") {
        const who = known(carrier) ? carrier : qb;
        const e = endPt(q0.x);
        if (who !== undefined) {
          leg(who, { pts: [q0, e], t0: snapMs, t1: 500, restStart: true, restEnd: true });
          plan.ball.push({ kind: "hold", id: who, t0: snapMs, t1: 900 });
        }
        plan.holder = known(carrier) ? carrier : null;
        plan.labels.push({ text: "Kneel", at: e, t: 900, source: "kind" });
        plan.whistle = 900;
        plan.fixed = M.live.kneelMs;
        plan.read = 300;
        break;
      }
      const gap: Pt = { x: spotX(d.runLocation), y: los };
      const qbCarries = (carrier !== undefined && slotOf.get(carrier)?.position === "QB") || (carrier === undefined && unit.leaf === "qbSneak") || kind === "scramble";
      if (qbCarries) {
        const who = carrier ?? qb;
        if (qb !== undefined && qb !== who) leg(qb, { pts: [q0, { x: q0.x - 1, y: q0.y - 1 }], t0: 0, t1: 500, restStart: true, restEnd: true, fixedStart: true });
        if (kind === "scramble") {
          const back = { x: q0.x, y: q0.y - 2 };
          const t0 = snapMs + 500;
          if (known(who)) leg(who, { pts: [q0, back], t0: 0, t1: t0, restStart: true, restEnd: false, fixedStart: true });
          plan.ball.push({ kind: known(who) ? "hold" : "move", ...(known(who) ? { id: who } : { pts: [q0, back], apex: 1, endScale: 1 }), t0: snapMs, t1: t0 } as BallSeg);
          const readT = t0 + travel(back, gap, who) * 0.6;
          carry(known(who) ? who : undefined, [back, gap], t0, t0, readT);
          plan.read = readT;
        } else {
          // A sneak: he moves at the snap and the ball meets him on his way to the line.
          const readT = travel(q0, gap, who) * 0.6;
          carry(known(who) ? who : undefined, [q0, gap], 0, snapMs, readT);
          plan.read = readT;
        }
        plan.releaseAt = plan.read;
        break;
      }
      // A handoff: the QB meets the back at the mesh point, then carries out his fake.
      const rbId = known(carrier) ? carrier : firstAt("RB", offSlots);
      const rb0 = rbId !== undefined ? (startOf.get(rbId) as Pt) : { x: q0.x, y: q0.y - 2 };
      // R10: the mesh from data, toward the play side; the QB carries out his fake away from it.
      const m = templates.mesh[unit.leaf];
      const mesh: Pt = m !== undefined ? { x: clampX(MID_X + playSign * m[0]), y: los - m[1] } : { x: (q0.x + rb0.x) / 2 + (rb0.x <= q0.x ? 0.5 : -0.5), y: Math.max(q0.y, rb0.y) + 0.6 };
      const H = M.handoffMs;
      if (qb !== undefined) {
        leg(qb, { pts: [q0, mesh], t0: 0, t1: H, restStart: true, restEnd: false, fixedStart: true });
        const co = place(mesh, lookup(templates.routes[unit.routes], ["QB"])).map((w) => w.p);
        const out = co.length > 0 ? co : [{ x: mesh.x - playSign * 3, y: mesh.y - 1.5 }];
        let L = 0;
        for (let i = 0; i < out.length; i++) L += dist(i === 0 ? mesh : (out[i - 1] as Pt), out[i] as Pt);
        leg(qb, { pts: [mesh, ...out], t0: H, t1: H + (L / speedOf(qb)) * 1000 + M.decelMs, restStart: false, restEnd: true });
        plan.sitAfter.add(qb);
        plan.ball.push({ kind: "hold", id: qb, t0: snapMs, t1: H });
      }
      // The outside run stretches toward the play side (never the back's own side), then turns up.
      const stretch: Pt[] = unit.leaf === "outsideRun" ? [{ x: clampX(MID_X + playSign * 9), y: los - 1 }] : [];
      const toGap: Pt = unit.leaf === "outsideRun" ? { x: (stretch[0] as Pt).x, y: los + 1 } : gap;
      if (known(carrier)) leg(carrier, { pts: [rb0, mesh], t0: startMs(carrier), t1: H, restStart: true, restEnd: false, fixedStart: true });
      carry(known(carrier) ? carrier : undefined, [mesh, ...stretch, toGap], H);
      plan.read = H;
      plan.releaseAt = H + travel(mesh, toGap, carrier) + (3 / speedOf(carrier)) * 1000;
      break;
    }
    case "pass": {
      const drop = M.dropMs[unit.leaf] ?? 700;
      // The QB's drop is his template (a play-action fake reaches its point at fakeMs and pauses).
      const qWps = place(q0, lookup(templates.routes[unit.routes], ["QB"]));
      const dropPt: Pt = qWps.length > 0 ? (qWps[qWps.length - 1] as FieldWp).p : { x: q0.x, y: q0.y - 1.5 };
      plan.ball.push({ kind: "move", pts: [ball0, q0], t0: 0, t1: snapMs, apex: 1, endScale: 1 });
      if (qb !== undefined) {
        dropLegs(qb, drop, qWps);
        plan.ball.push({ kind: "hold", id: qb, t0: snapMs, t1: drop });
      }
      const px0 = spotX(d.passLocation);
      const flight = (to: Pt): number => Math.max(M.flight.minMs, Math.min(M.flight.maxMs, M.flight.baseMs + M.flight.perYardMs * dist(dropPt, to)));
      // R8's hold by class (throwHold.leafMaxMs, designed): longer on a deep shot so deep routes
      // (backs 7 yd deep included) can develop (Joseph, 2026-11-15, Open item 2), shorter on short,
      // screen and play-action throws so the QB doesn't hold the ball (DECISIONS.md, "QB throw pace").
      const holdMs = M.throwHold.leafMaxMs[unit.leaf] ?? M.throwHold.maxMs;
      /**
       * R8: the throw waits for the target's route (his arrival at the point of his template nearest
       * the catch, at natural pace, minus the flight), at most throwHold after the drop ends.
       */
      // The ball before the throw on the raw clock, from the calls only: the snap to the QB, then the
      // QB on his planned drop legs (he holds his drop point after them).
      const qbRawKeys: Key[] = join(
        ...((qb !== undefined ? plan.legs.get(qb) : undefined) ?? []).map((l) => {
          const t0 = l.fixedStart === true ? Math.min(l.t0, M.maxStartMs) : l.t0;
          return drive(l.pts, t0, Math.max(t0 + M.keyMs, l.t1), { accelMs: accOf(qb), decelMs: M.decelMs, restStart: l.restStart, restEnd: l.restEnd, keyMs: M.keyMs, fillet: M.fillet });
        }),
      );
      const ballRaw = (t: number): Pt => {
        if (t < snapMs) {
          const f = Math.max(0, t) / Math.max(1, snapMs);
          return { x: ball0.x + (q0.x - ball0.x) * f, y: ball0.y + (q0.y - ball0.y) * f };
        }
        return qbRawKeys.length > 0 ? at(qbRawKeys, t) : q0;
      };
      /**
       * The track he is actually drawn on (R8's "his route", the lead 2026-11-15): his template, kept
       * off the ball by the offense's 1.5 yd clearance exactly as the field does before the throw.
       */
      const drawnTrack = (id: string, horizon: number): Key[] => ringFix(trackOf(id, 0, 1, horizon).keys, ballRaw, 1.5, Math.max(120, snapMs), horizon, "radial", -1);
      /** A flight's time from where the ball leaves (QD2: on the drop leg when thrown on the plant). */
      const flightFrom = (p: Pt, to: Pt): number => Math.max(M.flight.minMs, Math.min(M.flight.maxMs, M.flight.baseMs + M.flight.perYardMs * dist(p, to)));
      const throwFor = (id: string | undefined, c: Pt): number => {
        const early = drop + M.hitchMs;
        if (!known(id) || slotOf.get(id)?.side !== "O") return early;
        // His whole template track (as R8 reads it), well past any throw.
        const latest = Math.max(drop + holdMs + M.flight.maxMs, M.throwHold.searchMs);
        const tr = drawnTrack(id, latest);
        let best = Infinity;
        let bestD = Infinity;
        for (const q of tr) {
          const dd = dist(q, c);
          if (dd < bestD - 1e-9) {
            bestD = dd;
            best = q.t + (dd / speedOf(id)) * 1000;
          }
        }
        // QD2, the plant throw (spec revision 2026-11-16, designed): when the ball goes nearer the
        // line than his track at the earliest throw, the QB may throw from the start of his plant,
        // RAMP x decelMs before it. intermediatePass and deepPass only, the classes whose drop the
        // revision lengthened (R-C31 keeps the others unchanged). From the calls and the catch point only.
        const plant = (unit.leaf === "intermediatePass" || unit.leaf === "deepPass") && at(tr, early).y > c.y ? early - RAMP * M.decelMs : early;
        const t1 = Math.max(plant, Math.min(best - flight(c), drop + holdMs));
        // A plant throw leaves from his place on the drop leg, so it is timed with the flight from there.
        if (t1 >= early - 1e-6 || qbRawKeys.length === 0) return t1;
        return Math.max(plant, Math.min(best - flightFrom(at(qbRawKeys, t1), c), early));
      };
      const apex = (to: Pt): number => Math.min(M.flight.apexMax, 1 + dist(dropPt, to) * M.flight.apexPerYard);
      /** The throw: the read, and the QB settles in the pocket from the drop until it (stepping up). */
      const thrown = (throwT: number): Pt => {
        plan.read = throwT;
        plan.releaseAt = throwT + M.release.afterThrowMs;
        // He sets at his drop point and steps up a hitch (sit.maxYards at pocket.pace x his top), then
        // stands tall: no slow slide across the whole hold (DECISIONS.md, "The QB sets and steps up").
        return settleLeg(qb, dropPt, { x: dropPt.x, y: dropPt.y + 1 }, drop + M.hitchMs, throwT, M.sit.maxYards, (M.pocket.pace * speedOf(qb)) / 1000);
      };
      /**
       * The release (QD2): before the drop end plus the hitch he is still on his drop leg, so the ball
       * leaves from where he is on it, he finishes his stop at his drop point and follows through from
       * there. Otherwise the ball leaves from his step up and he follows through at once. The ball is
       * in his hands until the throw either way.
       */
      const release = (throwT: number): { from: Pt; qbFrom: Pt; t0: number; fly: (to: Pt) => number } => {
        const E = drop + M.hitchMs;
        const settled = thrown(throwT);
        if (throwT >= E - 1e-6) return { from: settled, qbFrom: settled, t0: throwT, fly: flight };
        plan.ball = plan.ball.map((sg) => (sg.kind === "hold" && sg.id === qb && sg.t1 > throwT ? { ...sg, t1: throwT } : sg));
        const from = qbRawKeys.length > 0 ? at(qbRawKeys, throwT) : dropPt;
        plant = { throwT, from, gapEnd: E };
        return { from, qbFrom: dropPt, t0: E, fly: (to) => flightFrom(from, to) };
      };
      /**
       * His follow-through after the throw: `base` yards upfield, or more when he throws mid step so
       * he eases out of the step's speed inside his own stop (RAMP x decelMs) rather than braking on
       * a too-short leg (code review, 2026-11-16). From the step's own shape, so from the calls only.
       */
      const through = (from: Pt, throwT: number, base: number): Pt => {
        const v = (M.pocket.pace * speedOf(qb)) / 1000;
        const L = M.sit.maxYards;
        const ramp = Math.min(NAT.idle.rampMs, L / Math.max(1e-9, v));
        const tau = throwT - (drop + M.hitchMs);
        const vNow = tau <= 1 ? 0 : creepAlong(v, L, ramp, tau) - creepAlong(v, L, ramp, tau - 1);
        return { x: from.x, y: from.y + Math.max(base, vNow * RAMP * M.decelMs) };
      };
      // The neutral catch point on a receiver's route (DECISIONS.md, "Neutral catch x", designed,
      // display only): the point of his template track that comes nearest the catch depth c0.y, at
      // a time a throw can reach (R8 window), its x kept inside the engine's passLocation third when
      // there is one, else inside the field; the depth kept in [yLo, yHi]. From the calls only, so
      // nothing before the throw changes; R8 then throws for that point.
      const third = d.passLocation === "left" ? 0 : d.passLocation === "middle" ? 1 : d.passLocation === "right" ? 2 : -1;
      const onRoute = (id: string, c0: Pt, yLo: number, yHi: number): Pt => {
        const w = FIELD_WIDTH / 3;
        const [lo, hi] = third >= 0 ? [third * w, (third + 1) * w] : [M.sidelineMarginYards, FIELD_WIDTH - M.sidelineMarginYards];
        const first = drop + M.hitchMs + M.flight.minMs;
        const last = drop + holdMs + M.flight.maxMs;
        // Only points a throw can time: his arrival there minus that throw's flight inside the hold (R8).
        const win = drawnTrack(id, last).filter((q) => q.t >= first && q.t - flight(q) <= drop + holdMs);
        // The first time his route reaches the catch depth. When it never does (a swing that stays
        // shallow, a screen back sitting deep, a stalker), his reachable track point nearest that
        // depth, and with no air yards the catch depth follows it (DECISIONS.md, "Neutral catch
        // depth", amended 2026-11-15), kept inside the band: a screen's depth behind the line stands.
        const reached = win.find((q) => Math.abs(q.y - c0.y) <= 0.5);
        let best: Key | undefined = reached;
        if (best === undefined) for (const q of win) if (best === undefined || Math.abs(q.y - c0.y) < Math.abs(best.y - c0.y) - 1e-9) best = q;
        if (best === undefined) return c0;
        // Backfield routes (amended 2026-11-15): a route that stays behind the line may be caught
        // there, down to screenFloorYards; still between that floor and the dead spot.
        const floor = best.y < los ? Math.min(yLo, los + templates.screenFloorYards) : yLo;
        const y = reached === undefined && d.airYards === undefined ? Math.max(Math.max(floor, los + templates.screenFloorYards), Math.min(yHi, best.y)) : c0.y;
        return { x: Math.max(lo, Math.min(hi, best.x)), y };
      };
      // The deep catch floor (DECISIONS.md, "Deep completions are caught deep", designed, display
      // only): with no air yards, at least this far past the line.
      const catchFloor = d.airYards === undefined ? templates.catchFloorYards[unit.leaf] : undefined;
      if ("incomplete" in play && play.incomplete === true) {
        // DECISIONS.md, "Incompletions drawn as misses" (A2): the ball is aimed where a completion
        // to him would be caught, on his template with no gain cap (no dead spot), the band's top
        // at the class depth (clamped at the end line minus 1 yd), the deep floor included. With no
        // known offensive target it is the class depth at the engine's pass third.
        const depth = d.airYards ?? templates.passDepth[unit.leaf] ?? 8;
        const target = parts.target;
        const aimed = known(target) && slotOf.get(target)?.side === "O";
        const top = Math.min(los + depth, bounds.maxY);
        let aim: Pt = { x: px0, y: top };
        if (aimed) {
          const yLo = d.airYards === undefined && depth < 0 ? los + templates.screenFloorYards : Math.min(los, top);
          aim = onRoute(target, aim, yLo, top);
          if (catchFloor !== undefined) aim = { x: aim.x, y: Math.max(aim.y, Math.min(los + catchFloor, bounds.maxY)) };
        }
        const throwT = throwFor(target, aim);
        const rel = release(throwT);
        const from = rel.from;
        const catchT = throwT + rel.fly(aim);
        // A4: the roll or deflection (miss.rollMs, when the label shows), then the ball rests where it
        // stopped (miss.restMs) until the whistle and the respot. One value each, from motion.json.
        const whistle = catchT + M.miss.rollMs + M.miss.restMs;
        if (qb !== undefined) leg(qb, { pts: [rel.qbFrom, through(rel.qbFrom, throwT, 1)], t0: rel.t0, t1: whistle, restStart: false, restEnd: true });
        if (throwT > drop) plan.ball.push({ kind: "hold", id: qb ?? "", t0: drop, t1: throwT });
        // Where it lands, its roll or deflection, the label and the breaker: resolveMiss(), below.
        plan.miss = { id: aimed ? target : null, throwT, catchT, from, aim, apex: apex(aim) };
        plan.whistle = whistle;
        break;
      }
      if ("turnover" in play && play.turnover === "interception") {
        const e = endPt(px0);
        const depth = d.airYards ?? templates.passDepth[unit.leaf] ?? 10;
        const c: Pt = { x: px0, y: Math.max(los + depth, e.y) };
        const throwT = throwFor(parts.target, c);
        const rel = release(throwT);
        const from = rel.from;
        const catchT = throwT + rel.fly(c);
        if (qb !== undefined) leg(qb, { pts: [rel.qbFrom, through(rel.qbFrom, throwT, 2)], t0: rel.t0, t1: catchT + 500, restStart: false, restEnd: true });
        if (throwT > drop) plan.ball.push({ kind: "hold", id: qb ?? "", t0: drop, t1: throwT });
        plan.ball.push({ kind: "move", pts: [from, c], t0: throwT, t1: catchT, apex: apex(c), endScale: 1 });
        const icp = parts.interceptor;
        if (known(icp)) plan.converge.set(icp, { read: throwT, t: catchT, at: c });
        plan.labels.push({ text: "Interception", at: c, t: catchT, source: "turnover" });
        plan.read = catchT;
        const regained = end?.possession === "offense";
        const back = catchT + travel(c, e, icp);
        if (regained) {
          const rec = parts.fumbleRecoverer;
          leg(icp, { pts: [c, e], t0: catchT, t1: back, restStart: false, restEnd: true });
          plan.ball.push({ kind: known(icp) ? "hold" : "move", ...(known(icp) ? { id: icp } : { pts: [c, e], apex: 1, endScale: 1 }), t0: catchT, t1: back } as BallSeg);
          const tRec = known(rec) ? recover(rec, catchT, back + 300, e) : back + 300;
          plan.holder = known(rec) ? rec : null;
          plan.labels.push({ text: known(rec) ? recoveredText(rec) : "Fumble", at: e, t: tRec, source: "defensePossessedDuringPlay" });
          plan.whistle = tRec;
        } else {
          leg(icp, { pts: [c, e], t0: catchT, t1: back, restStart: false, restEnd: true });
          if (known(icp)) {
            plan.ball.push({ kind: "hold", id: icp, t0: catchT, t1: back });
            plan.holder = icp;
          } else plan.ball.push({ kind: "move", pts: [c, e], t0: catchT, t1: back, apex: 1, endScale: 1 });
          plan.whistle = back;
        }
        break;
      }
      // Complete: the catch point is the air yards when the engine gives them. Without them it is a
      // neutral depth (DECISIONS.md, "Neutral catch depth", designed, display only): the class's
      // passDepth past the line, as an incompletion uses, capped at the gain and kept between the
      // line and the dead spot (a screen's depth behind the line stands); he runs on to the dead spot.
      const e = endPt(px0);
      const neutral = (): Pt => {
        const depth = templates.passDepth[unit.leaf];
        if (depth === undefined) return e;
        const lo = Math.min(los, e.y, los + depth);
        const hi = Math.max(los, e.y);
        return { x: px0, y: Math.max(lo, Math.min(hi, los + depth)) };
      };
      const c0: Pt = d.airYards !== undefined ? { x: px0, y: los + d.airYards } : neutral();
      const rcv = parts.receiver;
      let c = c0;
      if (known(rcv) && slotOf.get(rcv)?.side === "O") {
        // The allowed depths (DECISIONS.md, "Neutral catch depth"): between the line and the dead spot,
        // a screen's depth behind the line included.
        const depth = d.airYards ?? templates.passDepth[unit.leaf] ?? 0;
        // A screen (a depth behind the line) may follow a route that sits deeper, to screenFloorYards.
        const yLo = d.airYards === undefined && depth < 0 ? los + templates.screenFloorYards : Math.min(los, e.y, los + depth);
        c = onRoute(rcv, c0, yLo, Math.max(los, e.y));
      }
      // B1: a deep completion is caught at least catchFloorYards past the line, or at the dead spot
      // on a shorter gain; the x is unchanged and R7 bends his path after the throw.
      if (catchFloor !== undefined) c = { x: c.x, y: Math.max(c.y, los + Math.min(catchFloor, e.y - los)) };
      const throwT = throwFor(rcv, c);
      const rel = release(throwT);
      const from = rel.from;
      const catchT = throwT + rel.fly(c);
      if (qb !== undefined) leg(qb, { pts: [rel.qbFrom, through(rel.qbFrom, throwT, 1)], t0: rel.t0, t1: catchT + 300, restStart: false, restEnd: true });
      if (throwT > drop) plan.ball.push({ kind: "hold", id: qb ?? "", t0: drop, t1: throwT });
      plan.ball.push({ kind: "move", pts: [from, c], t0: throwT, t1: catchT, apex: apex(c), endScale: 1 });
      if (known(rcv) && slotOf.get(rcv)?.side === "O") plan.target = { id: rcv, throwT, catchT, at: c };
      plan.read = catchT;
      // Only an exact catch at the dead spot settles; a catch just short of it still carries onto it,
      // so the ball always ends on the engine's spot.
      if (dist(c, endPt(c.x)) < 1e-6 && !fumbled) {
        // Caught at the dead spot: he settles there.
        if (known(rcv)) leg(rcv, { pts: [c, c], t0: catchT, t1: catchT + M.convergeMs, restStart: false, restEnd: true });
        if (known(rcv)) {
          plan.ball.push({ kind: "hold", id: rcv, t0: catchT, t1: catchT + M.convergeMs });
          plan.holder = rcv;
        }
        plan.whistle = catchT + M.convergeMs;
      } else carry(known(rcv) ? rcv : undefined, [c], catchT);
      break;
    }
    case "spike": {
      const g: Pt = { x: q0.x, y: q0.y + 0.6 };
      plan.ball.push({ kind: "move", pts: [ball0, q0], t0: 0, t1: snapMs, apex: 1, endScale: 1 });
      plan.ball.push({ kind: "move", pts: [q0, g], t0: snapMs, t1: 250, apex: 1, endScale: 1 });
      if (qb !== undefined) leg(qb, { pts: [q0, { x: q0.x, y: q0.y + 0.4 }], t0: 0, t1: 400, restStart: true, restEnd: true, fixedStart: true });
      plan.labels.push({ text: "Spike", at: q0, t: 700, source: "kind" });
      plan.whistle = 700;
      plan.fixed = M.live.spikeMs;
      plan.read = 250;
      plan.ball.push({ kind: "jump", to: { x: MID_X, y: end?.spot ?? los }, t: 700 });
      break;
    }
    case "punt": {
      const punter = firstAt("P", offSlots);
      const p0 = punter !== undefined ? (startOf.get(punter) as Pt) : { x: MID_X, y: los - 14 };
      const kickT = snapMs + M.punt.kickAfterSnapMs;
      plan.ball.push({ kind: "move", pts: [ball0, p0], t0: 0, t1: snapMs, apex: 1, endScale: 1 });
      if (punter !== undefined) {
        leg(punter, { pts: [p0, { x: p0.x, y: p0.y + 1 }], t0: 0, t1: kickT, restStart: true, restEnd: false, fixedStart: true });
        leg(punter, { pts: [{ x: p0.x, y: p0.y + 1 }, { x: p0.x, y: p0.y + 4 }], t0: kickT, t1: kickT + 700, restStart: false, restEnd: true });
        plan.ball.push({ kind: "hold", id: punter, t0: snapMs, t1: kickT });
      }
      const kp: Pt = { x: p0.x, y: p0.y + 1 };
      const e = endPt(MID_X);
      if (d.class === "blocked") {
        plan.ball.push({ kind: "move", pts: [kp, e], t0: kickT, t1: kickT + 300, apex: 0.9, endScale: 1 });
        plan.labels.push({ text: "Blocked", at: e, t: kickT + 300, source: "detail.class" });
        plan.whistle = kickT + 600;
        plan.read = kickT;
        break;
      }
      const landY = d.gross !== undefined ? Math.min(los + d.gross, endLine) : e.y;
      const land: Pt = { x: d.class?.startsWith("outOfBounds") === true ? FIELD_WIDTH : MID_X, y: landY };
      const hang = Math.min(M.punt.hangMaxMs, M.punt.hangBaseMs + M.punt.hangPerYardMs * (d.gross ?? dist(kp, land)));
      const landT = kickT + hang;
      plan.ball.push({ kind: "move", pts: [kp, land], t0: kickT, t1: landT, apex: M.punt.apex, endScale: 1 });
      plan.read = landT;
      const ret = parts.returner;
      if (known(ret)) leg(ret, { pts: [startOf.get(ret) as Pt, land], t0: startMs(ret), t1: landT, restStart: true, restEnd: dist(land, e) < 0.5, fixedStart: true });
      const lbl = d.class === undefined ? undefined : PUNT_LABELS[d.class];
      if (lbl !== undefined) plan.labels.push({ text: lbl, at: land, t: landT, source: "detail.class" });
      if (known(ret) && dist(land, e) >= 0.5) carry(ret, [land], landT);
      else {
        if (known(ret)) {
          plan.ball.push({ kind: "hold", id: ret, t0: landT, t1: landT + 300 });
          plan.holder = ret;
        } else if (dist(land, e) >= 0.5) plan.ball.push({ kind: "move", pts: [land, e], t0: landT, t1: landT + 300, apex: 1, endScale: 1 });
        plan.whistle = landT + 300;
      }
      break;
    }
    case "fieldGoal":
    case "extraPoint": {
      const holder = firstAt("P", offSlots);
      const kicker = firstAt("K", offSlots);
      const kickY = play.kind === "fieldGoal" ? play.kickSpot : los - 7;
      const hp: Pt = { x: MID_X, y: kickY };
      const holdT = M.fieldGoal.holdMs;
      const kickT = M.fieldGoal.kickMs;
      plan.ball.push({ kind: "move", pts: [ball0, hp], t0: 0, t1: holdT, apex: 1, endScale: 1 });
      if (holder !== undefined) leg(holder, { pts: [startOf.get(holder) as Pt, { x: MID_X + 0.5, y: kickY }], t0: 0, t1: holdT, restStart: true, restEnd: true, fixedStart: true });
      if (kicker !== undefined) {
        const k0 = startOf.get(kicker) as Pt;
        leg(kicker, { pts: [k0, { x: MID_X - 0.6, y: kickY - 0.6 }], t0: 0, t1: kickT, restStart: true, restEnd: false, fixedStart: true });
        leg(kicker, { pts: [{ x: MID_X - 0.6, y: kickY - 0.6 }, { x: MID_X - 0.2, y: kickY + 1.5 }], t0: kickT, t1: kickT + 500, restStart: false, restEnd: true });
      }
      if (d.class === "blocked") {
        const e = end !== undefined ? endPt(MID_X) : { x: MID_X, y: los - 1 };
        plan.ball.push({ kind: "move", pts: [hp, e], t0: kickT, t1: kickT + 300, apex: 0.9, endScale: 1 });
        plan.labels.push({ text: "Blocked", at: e, t: kickT + 300, source: "detail.class" });
        plan.whistle = kickT + 600;
        plan.read = kickT;
        break;
      }
      const posts: Pt = { x: MID_X, y: endLine };
      const fl = Math.min(M.fieldGoal.flightMaxMs, M.fieldGoal.flightBaseMs + M.fieldGoal.flightPerYardMs * dist(hp, posts));
      plan.ball.push({ kind: "move", pts: [hp, posts], t0: kickT, t1: kickT + fl, apex: M.fieldGoal.apex, endScale: M.fieldGoal.endScale });
      if (end !== undefined) plan.ball.push({ kind: "jump", to: endPt(MID_X), t: kickT + fl + 200 });
      const good = "good" in play && play.good;
      plan.labels.push({ text: good ? (play.kind === "fieldGoal" ? "Field goal good" : "Good") : "No good", at: posts, t: kickT + fl, source: "good" });
      plan.whistle = kickT + fl + 200;
      plan.read = kickT;
      break;
    }
    case "kickoff":
    case "onsideKick": {
      const kicker = firstAt("K", offSlots);
      const isOnside = play.kind === "onsideKick";
      const outcome = "outcome" in play ? play.outcome : "inPlay";
      const landingSpot = "landingSpot" in play ? play.landingSpot : undefined;
      const approach = M.kickoff.approachMs;
      if (kicker !== undefined) {
        leg(kicker, { pts: [startOf.get(kicker) as Pt, ball0], t0: 0, t1: approach, restStart: true, restEnd: false, fixedStart: true });
        leg(kicker, { pts: [ball0, { x: MID_X, y: los + 15 }], t0: approach, t1: approach + 1500, restStart: false, restEnd: true });
      }
      let land: Pt;
      if (outcome === "touchbackEndZone" || outcome === "touchbackLandingZone") land = { x: MID_X, y: 100 + ctx.endZoneYards / 2 };
      else if (outcome === "outOfBounds") land = { x: FIELD_WIDTH, y: landingSpot ?? los + 40 };
      else if (landingSpot !== undefined) land = { x: MID_X, y: landingSpot };
      else if (isOnside) land = { x: MID_X, y: end?.spot ?? los + 10 };
      else land = { x: MID_X, y: Math.max(end?.spot ?? 97, 97) };
      const hang = isOnside ? M.kickoff.onsideMs : Math.min(M.kickoff.hangMaxMs, M.kickoff.hangBaseMs + M.kickoff.hangPerYardMs * dist(ball0, land));
      const landT = approach + hang;
      plan.ball.push({ kind: "move", pts: [ball0, land], t0: approach, t1: landT, apex: isOnside ? M.kickoff.onsideApex : M.kickoff.apex, endScale: 1 });
      plan.read = landT;
      // A kick out of bounds is respotted in the middle (no carrier, so "Dead spot x follows the
      // carrier" doesn't apply); a return's carry picks its own x from the landing.
      const e = end !== undefined ? endPt(outcome === "outOfBounds" ? MID_X : land.x) : land;
      const ret = parts.returner ?? (isOnside ? parts.fumbleRecoverer : undefined);
      if (known(ret)) leg(ret, { pts: [startOf.get(ret) as Pt, land], t0: startMs(ret), t1: landT, restStart: true, restEnd: end === undefined || dist(land, e) < 0.5, fixedStart: true });
      if (outcome === "touchbackEndZone" || outcome === "touchbackLandingZone") plan.labels.push({ text: "Touchback", at: land, t: landT, source: "outcome" });
      else if (outcome === "outOfBounds") plan.labels.push({ text: "Out of bounds", at: land, t: landT, source: "outcome" });
      else if (outcome === "fairCatch") plan.labels.push({ text: "Fair catch", at: land, t: landT, source: "outcome" });
      if (known(ret) && end !== undefined && dist(land, e) >= 0.5) {
        // Kickoff return pass (KR6): on a return of cutMinReturnYards or more he runs upfieldYards
        // straight (or on, to the place timeline() chose from the blocks), then cuts cutYards to one
        // side over cutDepthYards and runs on to the dead spot, whose x follows him (endPt). The side
        // is timeline()'s choice, else (the plan-only pass) the id hash's. The path's length, so the
        // whistle and the time scale, is the same wherever and whichever way he cuts.
        // Display only: the dead spot's y is the engine's.
        const stopY = fumbled && d.fumbleSpot !== undefined ? d.fumbleSpot : e.y;
        if (!isOnside && outcome === "inPlay" && land.y - stopY >= KR.cutMinReturnYards) {
          const sideX = krOpt?.side ?? krHashSide(ret);
          // Straight for upfieldYards, or longer when timeline() puts the cut just after a block.
          // The cut is rounded at cutRadiusYards (its own fillet: the play's 2 yd one is too tight at
          // a returner's speed for breakLateralAccel), which starts a tangent length before each
          // corner, so the first corner is that far past upfieldYards and the last leaves room for it.
          // The radius follows his speed on the screen clock: v^2 / cutLateralAccel, so a quick man
          // turns wide and a slow one sharp (each still reads as a cut), at most cutRadiusYards. The
          // time scale isn't known until the whistle is: estimated here from the carry's length.
          const estLen = KR.cutMinReturnYards + (land.y - stopY);
          const estWhistle = landT + (estLen / speedOf(ret)) * 1000;
          const kEst = estWhistle > M.live.maxMs ? M.live.maxMs / estWhistle : 1;
          // A fumble's carry is run 350 ms short of its length's time (carry()), so that much faster.
          const estMs = (estLen / speedOf(ret)) * 1000;
          const vS = ((KR.cutPace * speedOf(ret)) / kEst) * (fumbled ? estMs / Math.max(1, estMs - 350) : 1);
          const rCut = Math.max(M.fillet.roundRadius, Math.min(KR.cutRadiusYards, (vS * vS) / KR.cutLateralAccel));
          const fil = { ...M.fillet, roundRadius: rCut, roundPace: KR.cutPace, sharpDeg: Math.max(M.fillet.sharpDeg, 89) };
          const tan = rCut * Math.tan(Math.atan2(KR.cutYards, KR.cutDepthYards) / 2);
          const minUp = KR.upfieldYards + tan;
          const maxUp = Math.max(minUp, land.y - stopY - KR.cutDepthYards - tan - 0.5);
          const upY = Math.max(minUp, Math.min(krOpt?.up ?? minUp, maxUp));
          const up: Pt = { x: land.x, y: land.y - upY };
          const cx = Math.max(M.sidelineMarginYards, Math.min(FIELD_WIDTH - M.sidelineMarginYards, land.x + sideX * KR.cutYards));
          krCut = { side: sideX, up, minUp, maxUp };
          carry(ret, [land, up, { x: cx, y: up.y - KR.cutDepthYards }], landT, landT, landT, fil);
        } else carry(ret, [land], landT);
        // Only a return (KR8): a fair catch, a touchback or a kick out of bounds keeps its drawing.
        if (!isOnside && outcome === "inPlay") {
          krReturner = ret;
          krLand = land;
        }
      } else {
        if (known(ret) && end !== undefined) {
          plan.ball.push({ kind: "hold", id: ret, t0: landT, t1: landT + 300 });
          plan.holder = ret;
        } else if (dist(land, e) >= 0.5) plan.ball.push({ kind: "move", pts: [land, e], t0: landT, t1: landT + 300, apex: 1, endScale: 1 });
        plan.whistle = landT + 300;
      }
      if (isOnside && end !== undefined) plan.labels.push({ text: end.possession === "offense" ? "Recovered by the kicking team" : "Recovered by the receivers", at: e, t: plan.whistle, source: "end.possession" });
      break;
    }
    default:
      // No snap: everyone stays set, the flag goes down at the line.
      plan.whistle = 0;
  }
  if (kind === "sack") {
    // The sacker reaches the QB at the sack time below; the QB settles in the pocket until then.
    const drop = M.dropMs[unit.leaf] ?? 700;
    const qWps = place(q0, lookup(templates.routes[unit.routes], ["QB"]));
    const dropPt: Pt = qWps.length > 0 ? (qWps[qWps.length - 1] as FieldWp).p : { x: q0.x, y: q0.y - 1.5 };
    const e = endPt(q0.x);
    // Where the QB goes down: the dead spot, or on a strip-sack the fumble spot (never where the return ended).
    const sp: Pt = { x: q0.x, y: fumbled ? (d.fumbleSpot ?? dropPt.y) : e.y };
    // The sack time (DECISIONS.md, "Sack time from the sacker's arrival", designed): the drop end +
    // sack.minDelayMs, or later when the sacker can't get there that soon from where his unnamed track is at
    // the drop end (a DL at the end of his line step, others at their set), at his top speed with
    // accel and decel, around his blocker's outside shoulder. The QB settles in the pocket until then.
    const sacker0 = parts.sacker;
    let arrive = 0;
    if (known(sacker0)) {
      const ss = slotOf.get(sacker0) as OnFieldSlot & { side: "O" | "X"; index: number };
      const set = startOf.get(sacker0) as Pt;
      const fam = unit.family === "pass" ? "pass" : "run";
      const step0 = ss.position === "DL" || ss.position === "OL" ? place(set, lineContactFor(templates, unit.leaf, fam, lineKeys(defSlots.map((x) => ({ slot: x.slot, position: x.position })), defStart, ss.slot, ss.position))) : [];
      const atDrop = step0.length > 0 ? (step0[step0.length - 1] as FieldWp).p : set;
      arrive = drop + ((dist(atDrop, sp) + 2 * M.sackArc.outYards) / speedOf(sacker0)) * 1000 + accOf(sacker0) / 2 + M.decelMs / 2;
    }
    const passer = parts.passer ?? qb;
    // QD3 (spec revision 2026-11-16, designed): nor before the QB can walk from his drop point to the
    // sack spot at his own top speed, from rest to rest (his drop ends at rest at drop + hitch).
    const walk = known(passer) ? (dist(dropPt, sp) / speedOf(passer)) * 1000 + (RAMP * (accOf(passer) + M.decelMs)) / 2 : 0;
    const sackT = Math.max(drop + M.sack.minDelayMs, arrive, drop + M.hitchMs + walk);
    if (known(passer)) {
      // QD4: the same drop legs as the pass (to drop + hitch), so nothing differs before the read.
      plan.legs.delete(passer);
      dropLegs(passer, drop, qWps);
      leg(passer, { pts: [dropPt, sp], t0: drop + M.hitchMs, t1: sackT, restStart: true, restEnd: true });
      plan.ball = [{ kind: "move", pts: [ball0, q0], t0: 0, t1: snapMs, apex: 1, endScale: 1 }, { kind: "hold", id: passer, t0: snapMs, t1: sackT }];
    }
    const sacker = parts.sacker;
    if (known(sacker)) {
      plan.legs.delete(sacker);
      plan.converge.set(sacker, { read: drop, t: sackT, at: sp, around: true });
    }
    plan.read = drop;
    plan.releaseAt = drop + M.release.afterThrowMs;
    if (fumbled) {
      plan.ball.push({ kind: "move", pts: [sp, e], t0: sackT, t1: sackT + 300, apex: 0.8, endScale: 0.8 });
      const rec = parts.fumbleRecoverer;
      const tRec = known(rec) ? recover(rec, drop, sackT + 300, e) : sackT + 300;
      plan.holder = known(rec) ? rec : null;
      plan.labels.push({ text: known(rec) ? recoveredText(rec) : "Fumble", at: e, t: tRec, source: "participants.fumbleRecoverer" });
      plan.whistle = tRec;
    } else {
      plan.holder = known(parts.passer) ? (parts.passer as string) : null;
      plan.whistle = sackT + 300;
    }
  }

  // ------------------------------------------------------------ scale into screen time
  const live = plan.whistle <= 0 ? 0 : plan.fixed ?? Math.max(M.live.minMs, Math.min(M.live.maxMs, plan.whistle));
  const k = plan.whistle <= 0 ? 1 : live / plan.whistle;
  const T = (raw: number): number => snapAt + raw * k;
  const liveEnd = snapAt + live;
  const read = T(plan.read);
  const step = M.keyMs;

  // Fact marks: their legs on the scaled clock.
  const factKeys = new Map<string, Key[]>();
  /**
   * A fact mark's legs on the scaled clock. NM6: a leg that doesn't start from rest starts at the
   * speed his previous leg ended with, or for his first leg at `v0First` (the speed he caught the
   * ball at, say) when given.
   */
  const factRuns = (id: string, legs: readonly Leg[], v0First?: number): Key[] => {
    let prev: Key[] | null = null;
    const runs = legs.map((l, li) => {
      const t0 = l.fixedStart === true ? snapAt + Math.min(l.t0, M.maxStartMs) : T(l.t0);
      const t1 = Math.max(t0 + step, T(l.t1));
      let r: Key[];
      if (l.drift !== undefined) {
        const a = l.pts[0] as Pt;
        const b = l.pts[1] ?? a;
        const L = dist(a, b);
        // The creep's speed and ramp follow the clock, so where he is at a raw time doesn't change with k.
        r = creep(a, L < 1e-9 ? { x: 0, y: 1 } : { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, l.drift.v0 / k, l.drift.L, (l.drift.rampMs ?? NAT.idle.rampMs) * k, t0, t1, step);
      } else {
        const p0: Key[] | null = prev;
        const v00 = l.restStart ? undefined : p0 !== null && p0.length > 1 ? Math.hypot(velocity(p0, (p0[p0.length - 1] as Key).t, step).x, velocity(p0, (p0[p0.length - 1] as Key).t, step).y) : li === 0 ? v0First : undefined;
        const v0 = v00 !== undefined && l.capV0 === true ? Math.min(v00, topOf(id) / k / 1000) : v00;
        r = drive(l.pts, t0, t1, { accelMs: accOf(id), decelMs: M.decelMs, restStart: l.restStart, restEnd: l.restEnd, keyMs: step, fillet: l.fillet ?? M.fillet, ...(v0 === undefined ? {} : { v0 }) });
      }
      prev = r;
      return r;
    });
    return join(...runs);
  };
  for (const [id, legs] of plan.legs) factKeys.set(id, factRuns(id, legs));
  // A plant throw leaves from where the QB is drawn at the throw (his keys on the screen clock), not
  // from his raw-clock plan, so the ball never jumps at the release (QD2, code review 2026-11-16).
  const pl = plant as { throwT: number; from: Pt; gapEnd: number } | null;
  const plantKeys = pl !== null && qb !== undefined ? factKeys.get(qb) : undefined;
  if (pl !== null && plantKeys !== undefined) {
    const was = pl.from;
    const now = at(plantKeys, T(pl.throwT));
    plan.ball = plan.ball.map((sg) => (sg.kind === "move" && sg.pts[0] === was ? { ...sg, pts: [now, ...sg.pts.slice(1)] } : sg));
    if (plan.miss !== null && plan.miss.from === was) plan.miss = { ...plan.miss, from: now };
  }

  // The tackler meets the ball at the whistle; none on a touchdown, an incompletion or a kick out of play.
  const tackler = parts.tackler !== undefined && known(parts.tackler) ? parts.tackler : null;
  const sacker = kind === "sack" && known(parts.sacker) ? parts.sacker : null;

  // ------------------------------------------------------------ every mark
  const ring = templates.field.clearOfBallYards;
  const offMarks: TLMark[] = [];
  const defMarks: TLMark[] = [];
  const roleOf = (id: string): ParticipantRole[] => PARTICIPANT_ROLES.filter((r) => parts[r] === id);
  const named = new Set<string>([...PARTICIPANT_ROLES.map((r) => parts[r]).filter((x): x is string => x !== undefined)]);
  // Engaged pairs drift toward the play side on runs (R10), never toward the end spot.
  const runDrift = unit.family === "run" ? playSign * (M.runDrift[unit.leaf] ?? 0) : 0;
  const contactFamily = unit.family === "run" ? "run" : unit.family === "pass" ? "pass" : unit.family === "kick" || unit.family === "clock" ? "kick" : null;
  const releaseT = T(plan.releaseAt > 0 ? plan.releaseAt : plan.read);
  const snapWindowEnd = Math.min(liveEnd, snapAt + Math.max(120, snapMs * k));
  const scrimmage = unit.family === "run" || unit.family === "pass";
  const family = readFamily(unit.leaf);
  const defRefs = defSlots.map((s) => ({ slot: s.slot, position: s.position }));

  // The offense's template tracks on the screen clock, for the man trail and the zone sink: from the
  // calls only (a stalk finish sits here), never from the target or the result (R9).
  const tplCache = new Map<string, Key[]>();
  const tpl = (id: string): Key[] => {
    let ks = tplCache.get(id);
    if (ks === undefined) {
      // Quiet: a run's carrier has no template and needs none (his path is the engine's).
      ks = live > 0 ? trackOf(id, snapAt, k, liveEnd, undefined, true).keys : [{ t: 0, ...(startOf.get(id) as Pt) }];
      tplCache.set(id, ks);
    }
    return ks;
  };
  const receivers = offSlots.filter((s) => ELIGIBLE.has(s.position) || s.position === "RB").map((s) => s.id);
  const nearestReceiver = (p: Pt): string | undefined => {
    let best: string | undefined;
    let bd = Infinity;
    for (const id of receivers) {
      const q = startOf.get(id) as Pt;
      const dd = dist(p, q);
      if (dd < bd - 1e-9) {
        bd = dd;
        best = id;
      }
    }
    return best;
  };

  /** Stalk targets (R9): the nearest CB or S at the set on his side; none when that defender is named. */
  const stalkTarget = (id: string): { id: string; named: boolean } | undefined => {
    const me = startOf.get(id) as Pt;
    const side = Math.sign(me.x - MID_X);
    const cands = defSlots.filter((s) => s.position === "CB" || s.position === "S");
    const pool = cands.filter((s) => Math.sign((startOf.get(s.id) as Pt).x - MID_X) === side);
    let best: string | undefined;
    let bd = Infinity;
    for (const s of pool.length > 0 ? pool : cands) {
      const dd = dist(me, startOf.get(s.id) as Pt);
      if (dd < bd - 1e-9) {
        bd = dd;
        best = s.id;
      }
    }
    return best === undefined ? undefined : { id: best, named: named.has(best) || best === tackler };
  };
  // Natural motion records, filled while building: each named mark's departure (NM2), the ring the
  // governor keeps him off (contract 3, NM6), each lineman's contact, and when the settle starts.
  const depOf = new Map<string, number>();
  const ringOf = new Map<string, { readonly R: number; readonly to: number; readonly sideways: boolean }>();
  const lineInfo = new Map<string, { readonly contact: Pt; readonly engageEnd: number }>();
  const settleFromOf = new Map<string, number>();
  const lineStepCache = new Map<string, { steps: ReturnType<typeof runRoute>; w: FieldWp[]; start: number }>();
  // M6's pairs, from the set alone: each DL with the nearest free OL (NM7 pairs them the same way).
  const pairPre = new Map<string, string>();
  if (contactFamily !== null) {
    const dls = defSlots.filter((x) => x.position === "DL").map((x) => x.id);
    const ols = offSlots.filter((x) => x.position === "OL").map((x) => x.id);
    const cands: { d: string; o: string; dd: number }[] = [];
    for (const d0 of dls) for (const o0 of ols) cands.push({ d: d0, o: o0, dd: dist(startOf.get(d0) as Pt, startOf.get(o0) as Pt) });
    cands.sort((a, b) => a.dd - b.dd || (a.d < b.d ? -1 : a.d > b.d ? 1 : a.o < b.o ? -1 : 1));
    for (const c of cands)
      if (!pairPre.has(c.d) && !pairPre.has(c.o)) {
        pairPre.set(c.d, c.o);
        pairPre.set(c.o, c.d);
      }
  }
  const speedAt = (keys: readonly Key[], t: number): number => Math.hypot(velocity(keys, t, step).x, velocity(keys, t, step).y);
  // An incompletion: where the ball lands, its roll or deflection, the breaker (A2 to A5).
  const missOut = plan.miss === null ? null : resolveMiss(plan.miss);

  // The ball: held, flying (with its height as size) or jumping to a respot.
  const ballKeys: Key[] = [{ t: 0, ...ball0 }, { t: snapAt, ...ball0 }];
  const scale: ScaleKey[] = [{ t: 0, s: 1 }];
  const jumps = new Set<number>();
  for (const seg of plan.ball) {
    if (seg.kind === "jump") {
      const t = T(seg.t);
      ballKeys.push({ t, ...seg.to });
      jumps.add(t);
      continue;
    }
    const t0 = T(seg.t0);
    const t1 = Math.max(t0 + 1, T(seg.t1));
    if (seg.kind === "hold") {
      const keys = factKeys.get(seg.id);
      if (keys === undefined) continue;
      for (const t of grid(t0, t1, step)) ballKeys.push({ t, ...at(keys, t) });
      continue;
    }
    const path = seg.pts;
    const s0 = seg.startScale ?? 1;
    const shaped = s0 !== 1 || seg.apex !== 1 || seg.endScale !== 1;
    let L = 0;
    for (let i = 1; i < path.length; i++) L += dist(path[i - 1] as Pt, path[i] as Pt);
    for (const t of grid(t0, t1, step)) {
      const f = (t - t0) / (t1 - t0);
      let left = f * L;
      let p = path[0] as Pt;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1] as Pt;
        const b = path[i] as Pt;
        const len = dist(a, b);
        if (left <= len || i === path.length - 1) {
          const s = len === 0 ? 1 : Math.min(1, left / len);
          p = { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
          break;
        }
        left -= len;
      }
      ballKeys.push({ t, ...p });
      if (shaped) {
        // A parabola through the start size at release (1 unless it starts on the ground), the apex at mid-flight and the end scale at the end.
        const s = (1 - f) * (1 - 2 * f) * s0 + 4 * f * (1 - f) * seg.apex + f * (2 * f - 1) * seg.endScale;
        scale.push({ t, s });
      }
    }
    if (shaped && seg.keepScale !== true) scale.push({ t: t1 + 0.5, s: 1 });
  }
  ballKeys.sort((a, b) => a.t - b.t);
  const ball = dedupe(ballKeys, jumps);
  if (live > 0) ball.push({ t: liveEnd + M.settleMs, ...at(ball, liveEnd) });
  const ballAt = (t: number): Pt => at(ball, Math.min(t, liveEnd - 1));
  // Kickoff return (KR7, KR9): the carry as it would be run straight, the same wherever and
  // whichever way he cuts. The kicking team's coverage and the blocks are planned against it, kept
  // out of a band that widens by cutYards past upfieldYards (where his cut can take him), so the
  // blocks are the same for every cut and the cut can be chosen from them. Without a cut it is the ball.
  const krEnv = ((): { at: (t: number) => Pt; extra: (p: Pt) => number } => {
    const plain = { at: ballAt, extra: () => 0 };
    const land0 = krLand as Pt | null;
    if (krReturner === null || krCut === null || land0 === null || live <= 0) return plain;
    const carryLeg = (plan.legs.get(krReturner) ?? []).find((l) => Math.abs(l.t0 - plan.read) < 1e-6);
    const fk = factKeys.get(krReturner);
    if (carryLeg === undefined || fk === undefined) return plain;
    const endY = (carryLeg.pts[carryLeg.pts.length - 1] as Pt).y;
    const t0 = T(carryLeg.t0);
    const v0 = Math.min(speedAt(fk, t0 - step), topOf(krReturner) / k / 1000);
    const ks = drive([land0, { x: land0.x, y: endY }], t0, Math.max(t0 + step, T(carryLeg.t1)), { accelMs: accOf(krReturner), decelMs: M.decelMs, restStart: false, restEnd: true, keyMs: step, v0 });
    const upLine = land0.y - KR.upfieldYards;
    return { at: (t) => (t <= read ? ballAt(t) : at(ks, t)), extra: (p) => (p.y <= upLine + 1e-6 ? KR.cutYards : 0) };
  })();
  // On an incompletion every mark kept off the ball gets a key at the throw itself, so every frame up
  // to the throw is the same whatever the kind of miss (R-C20): marks are keyed every keyMs, and
  // the first key after the throw, kept off a ball already flying to its landing spot, would
  // otherwise pull the frames before it.
  const missThrowT = missOut?.target?.throwT ?? null;
  const atThrow = (keys: Key[]): Key[] => {
    if (missThrowT === null || keys.some((q) => Math.abs(q.t - missThrowT) < 1e-9)) return keys;
    const i = keys.findIndex((q) => q.t > missThrowT);
    if (i <= 0) return keys;
    return [...keys.slice(0, i), { t: missThrowT, ...at(keys, missThrowT) }, ...keys.slice(i)];
  };
  const finalBall = at(ball, liveEnd);
  /** The ball for the raw ring push; while it is in the air the ring is flightRingYards (NM-Open 1), done by passing the ball as farther away. */
  const ringBallRaw = ballAt;

  // The fact anchors (decision 10): every change of who has the ball, the converge points, the tackle.
  const anchorsOf = new Map<string, number[]>();
  const addAnchor = (id: string, t: number): void => {
    if (live <= 0 || t < snapAt - 1e-9 || t > liveEnd + 1e-9) return;
    const l = anchorsOf.get(id) ?? [];
    if (!l.some((x) => Math.abs(x - t) < 1e-6)) l.push(t);
    anchorsOf.set(id, l);
  };
  // Holds of one player back to back (the QB's drop, then his pocket) are one hold: the ball
  // changes hands, and so is anchored, only at its ends.
  const holdsOf = new Map<string, [number, number][]>();
  for (const seg of plan.ball)
    if (seg.kind === "hold" && known(seg.id)) {
      const a = T(seg.t0);
      const b = Math.min(liveEnd, Math.max(a + 1, T(seg.t1)));
      const l = holdsOf.get(seg.id) ?? [];
      const last = l[l.length - 1];
      if (last !== undefined && Math.abs(last[1] - a) < 1e-6) last[1] = b;
      else l.push([a, b]);
      holdsOf.set(seg.id, l);
    }
  for (const [id, l] of holdsOf)
    for (const [a, b] of l) {
      addAnchor(id, a);
      addAnchor(id, b);
    }
  /** Where a fact mark's own legs change (a tackler's run to the ball, a target's bend): for the anchor-demanded check. */
  const legStops = new Map<string, number[]>();
  for (const [id, c] of plan.converge) addAnchor(id, T(c.t));
  if (tackler !== null) addAnchor(tackler, liveEnd);
  // Flights (a pass or a kick in the air): the ring is flightRingYards then (NM-Open 1, approved).
  const flights: (readonly [number, number])[] = [];
  for (const x of plan.ball)
    if (x.kind === "move" && (x.apex > 1 || x.joinPrev === true)) {
      const prev = flights[flights.length - 1];
      // A flight in two pieces (an incompletion's) is one flight.
      if (x.joinPrev === true && prev !== undefined) flights[flights.length - 1] = [prev[0], Math.max(prev[0] + 1, T(x.t1))];
      else flights.push([T(x.t0), Math.max(T(x.t0) + 1, T(x.t1))]);
    }
  // An unnamed mark's departure: the throw on a pass (or a kick), else the read.
  const playDep = Math.min(read, ...flights.map((f) => f[0]));
  const inFlight = (t: number): boolean => flights.some(([a, b]) => t >= a && t <= b);
  // While the ball is in the air the ring is flightRingYards (NM-Open 1); with natural motion on,
  // the raw keys aren't pushed then at all: decorate steers clear of the ball's path from the throw,
  // so nobody is shoved aside at the ball's speed.
  const flightR = (R: number): ((t: number) => number) => (t) => (inFlight(t) ? (natural ? 0 : Math.min(R, NAT.flightRingYards)) : R);

  // NM6: the target's run after the catch starts at the speed he caught it with. It is re-driven
  // here, before anyone is built against the ball, and the ball's hold follows it. (A target whose
  // finish is a stalk shadows a defender not built yet: his carry keeps its plain start.)
  const curveOf = new Map<string, Key[]>();
  if (live > 0 && plan.target !== null && plan.legs.has(plan.target.id)) {
    const tg = plan.target;
    const sl = slotOf.get(tg.id);
    if (sl !== undefined && routeFor(sl)?.finish !== "stalk") {
      const curve = toCatch(tg.id, T(tg.throwT), T(tg.catchT), tg.at, () => undefined);
      curveOf.set(tg.id, curve);
      const after = factRuns(tg.id, plan.legs.get(tg.id) ?? [], speedAt(curve, T(tg.catchT)));
      factKeys.set(tg.id, after);
      const holds = holdsOf.get(tg.id) ?? [];
      for (let i = 0; i < ball.length; i++) {
        const q = ball[i] as Key;
        if (holds.some(([a, b]) => q.t >= a - 1e-9 && q.t <= b + 1e-9)) ball[i] = { t: q.t, ...at(after, q.t) };
      }
    }
  }

  // Defense marks by player id, built first so a stalking receiver can shadow his man.
  const defKeysById = new Map<string, readonly Key[]>();
  // He shadows his defender until the read whoever the engine names (anything else would show who
  // makes the tackle); after it, a named defender's blocker releases and pursues.
  const stalkOf = (id: string): readonly Key[] | undefined => {
    const st = stalkTarget(id);
    return st === undefined ? undefined : defKeysById.get(st.id);
  };

  // Kickoff return pass: the kicking team's unnamed coverage (not the kicker or the engine's tackler).
  const krCover = new Set<string>(krReturner === null || live <= 0 ? [] : offSlots.filter((x) => x.id !== parts.kicker && x.id !== tackler && !named.has(x.id) && !(parts.foulers ?? []).includes(x.id)).map((x) => x.id));
  /**
   * An unnamed mark's diagram track and pursuit (not a lineman): his route or drop to the read, then
   * he flows to the ball; a stalk block holds to the whistle. Side X, and on a kickoff return the
   * kicking team's unnamed coverage (KR9), keep out of the carrier's corridor (contract 3).
   */
  function unnamedTrack(s: OnFieldSlot, side: "O" | "X", set: Pt, at0: readonly Key[], start: number, top: number, accel: number): { ks: Key[]; readFor: number } {
    let readFor = Math.max(start + 4 * step, read + (side === "X" ? reactOf(s.id) : 0));
    let dk: Key[];
    let pursueFrom = true;
    if (side === "O") {
      const tr = trackOf(s.id, snapAt, k, liveEnd, stalkOf);
      dk = tr.keys;
      if (tr.finish === "stalk") {
        const st = stalkTarget(s.id);
        // A named defender: he shadows him until the read like any stalker (never released
        // earlier: that would show who makes the tackle), then releases and pursues.
        if (st !== undefined && !st.named && stalkOf(s.id) !== undefined) pursueFrom = false;
        else readFor = Math.max(readFor, read);
      }
    } else dk = defenseTrack(s, set, start, liveEnd);
    if (!pursueFrom || readFor >= liveEnd - 3 * step) return { ks: join(at0, dk.filter((q) => q.t <= liveEnd), [{ t: liveEnd, ...at(dk, liveEnd) }]), readFor };
    const cut = join(at0, dk.filter((q) => q.t < readFor), [{ t: readFor, ...at(dk, readFor) }]);
    const p = at(cut, readFor);
    const lane = side === "X" ? M.pursuit.corridorHalfYards : krCover.has(s.id) ? M.pursuit.corridorHalfYards + KR.corridorMarginYards : null;
    // Kickoff coverage reads the straight carry and keeps out of the band around it (krEnv).
    const cover = side === "O" && lane !== null;
    const ks = join(
      cut,
      pursue({
        start: p,
        vel: velocity(cut, readFor, step),
        t0: readFor,
        t1: liveEnd,
        ball: cover ? krEnv.at : ballAt,
        topSpeed: top,
        accelMs: accel,
        leadMs: M.pursuit.leadMs,
        turnDegPerS: M.pursuit.turnDegPerS,
        ring: side === "X" ? ring : 2,
        ringAt: flightR(side === "X" ? ring : 2),
        brakeYards: M.pursuit.brakeYards,
        ...(lane !== null ? { corridor: { half: lane, ms: M.pursuit.corridorMs } } : {}),
        ...(cover ? { aim: containAim(s.id, p, krEnv.at(readFor), lane), corridorExtra: krEnv.extra } : {}),
        keyMs: step,
        lateral: latOf(),
      }),
    );
    return { ks, readFor };
  }

  /**
   * Kickoff coverage contains (KR9): it steers for a point beside the carrier on its own side,
   * containYards outside his corridor, and when the carrier's path over twice the corridor's look
   * ahead comes within that of him, steers away from it too. Steering, never a push, so he turns
   * off the lane in time instead of being shoved out of it.
   */
  function containAim(id: string, p: Pt, carrier: Pt, lane: number): (t: number, at: Pt) => Pt {
    const sgn = Math.abs(p.x - carrier.x) > 1e-6 ? Math.sign(p.x - carrier.x) : hashUnit(id, "contain") < 0.5 ? -1 : 1;
    const want = lane + KR.containYards;
    return (t, q) => {
      // The nearest point of the carry's band (krEnv: the straight carry, widened past upfieldYards).
      let best: Pt | null = null;
      let bd = Infinity;
      let bx = 0;
      for (let u = t; u <= Math.min(liveEnd, t + 2 * M.pursuit.corridorMs) + 1e-6; u += 4 * step) {
        const b = krEnv.at(u);
        const ex = krEnv.extra(b);
        const dd = dist(q, b) - ex;
        if (dd < bd) {
          bd = dd;
          best = b;
          bx = ex;
        }
      }
      const off = { x: sgn * (want + bx), y: 0 };
      if (best === null || bd >= want) return off;
      // Away from the nearest point of his path, harder the nearer it is (an aim, so the turn rate limits it).
      const dc = bd + bx;
      const away = dc < 1e-6 ? { x: sgn, y: 0 } : { x: (q.x - best.x) / dc, y: (q.y - best.y) / dc };
      const push = 3 * (want - bd);
      return { x: off.x + away.x * push, y: off.y + away.y * push };
    };
  }

  /** A kicking-team mark's ring: the corridor's half-width for kickoff coverage (KR9), else the offense's 1.5 yd. */
  function krCoverR(id: string): number {
    return krCover.has(id) ? Math.max(1.5, M.pursuit.corridorHalfYards) : 1.5;
  }

  /**
   * The kickoff return pass (KR2 to KR5, KR9), designed, display only. During the hang each blocker
   * sets up toward his lane in the wall (from the set and the landing spot only, so nothing before
   * the catch knows the result, KR7). From the catch he meets a coverage man where that man stays out
   * of the carrier's corridor, the pair holds contact and drifts together (nobody drawn winning); a
   * blocker with nobody to block leads the carrier. Pairs are picked greedily, earliest contact first;
   * the engine's tackler is never blocked. Built on the screen clock, before build() draws anyone.
   */
  function planKickReturn(): KrPlan | null {
    if (krReturner === null || live <= 0) return null;
    // The blocks don't depend on the cut (krEnv): the plan-only pass's are used again when the
    // time scale is the same (a fumble's recovery can change it, and then they are planned again).
    const cached = krOpt?.blocks;
    if (cached !== undefined && cached.k === k && Math.abs(cached.liveEnd - liveEnd) < 1e-6) return leadersOn(cached);
    // Uniform scaling (decision 11): speeds are top / k, so ramps run k times as long, and a long
    // return drawn faster keeps the shape it has at 1x.
    const accK = (id: string): number => accOf(id) * k;
    const decK = M.decelMs * k;
    const tCatch = read;
    const land = at(ball, tCatch);
    const at0Of = (id: string): Key[] => join([{ t: 0, ...(startOf.get(id) as Pt) }], [{ t: snapAt, ...(startOf.get(id) as Pt) }]);
    // The whole return unit but the returner sets up from the lineup alone (KR7: a fouler or a
    // recoverer named by the result can't move anyone's lane, or stand still, before the catch).
    const crew = defSlots.filter((x) => x.id !== krReturner).map((x) => x.id);
    const sorted = [...crew].sort((a, b) => (startOf.get(a) as Pt).x - (startOf.get(b) as Pt).x || (a < b ? -1 : 1));
    const n = sorted.length;
    // After the catch only the unnamed, unflagged ones block (KR2 to KR5's blockers).
    const blockers = sorted.filter((id) => !named.has(id) && !(parts.foulers ?? []).includes(id));
    const lo = M.sidelineMarginYards;
    const hi = FIELD_WIDTH - M.sidelineMarginYards;
    const keys = new Map<string, { ks: Key[]; readFor: number }>();
    // The straight carry's path, sampled, for the corridor check (KR9), against its band (krEnv).
    const lanePts = (t: number): Pt[] => {
      const out: Pt[] = [];
      const t1 = Math.min(liveEnd, t + M.pursuit.corridorMs);
      for (let u = t; u < t1 + 1e-6; u += 4 * step) out.push(krEnv.at(Math.min(u, t1)));
      out.push(krEnv.at(t1));
      return out;
    };
    const toPath = (p: Pt, pts: readonly Pt[]): number => {
      let best = Infinity;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1] as Pt;
        const b = pts[i] as Pt;
        const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        const f = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / L2));
        best = Math.min(best, Math.hypot(p.x - (a.x + (b.x - a.x) * f), p.y - (a.y + (b.y - a.y) * f)) - Math.max(krEnv.extra(a), krEnv.extra(b)));
      }
      return pts.length === 1 ? dist(p, pts[0] as Pt) - krEnv.extra(pts[0] as Pt) : best;
    };
    const laneCache = new Map<number, Pt[]>();
    const laneAt = (t: number): Pt[] => {
      const key = Math.round(t / (2 * step));
      let v = laneCache.get(key);
      if (v === undefined) {
        v = lanePts(key * 2 * step);
        laneCache.set(key, v);
      }
      return v;
    };
    // Each blocker's setup: toward his lane in a staggered wall in front of the landing spot.
    const setup = new Map<string, { B1: Pt; t1: number; upfield: boolean; keys: Key[] }>();
    sorted.forEach((id, i) => {
      const set = startOf.get(id) as Pt;
      const start = snapAt + startAfter(id);
      const top = topOf(id) / k;
      const acc = accK(id);
      const t1 = Math.max(start + 4 * step, tCatch + reactOf(id));
      const laneX = n <= 1 ? land.x : Math.max(lo, Math.min(hi, land.x - KR.wallWidthYards / 2 + (KR.wallWidthYards * i) / (n - 1)));
      const deepest = land.y - ring - 1;
      // Men set deeper than the wall (the returner's partner) come up to it.
      let W: Pt = { x: laneX, y: Math.min(deepest, land.y - KR.wallDepthYards - (i % 2) * KR.wallRowYards) };
      // Everyone moves in the hang, at least setupYards.
      if (dist(set, W) < KR.setupYards) W = { x: W.x, y: Math.min(deepest, set.y + KR.setupYards) };
      // A man set more than wallDepthYards short of the landing spot drops at least setupYards toward it (KR2).
      const gain = land.y - set.y > KR.wallDepthYards ? Math.min(deepest - set.y, KR.setupYards + 0.5) : 0;
      if (gain > 0 && W.y < set.y + gain) W = { x: W.x, y: set.y + gain };
      const L = dist(set, W);
      const Lmax = ((KR.setupPace * top) / 1000) * Math.max(0, t1 - start - 0.5 * (acc + decK));
      let B1: Pt = W;
      if (L > Lmax) {
        // Out of reach in the hang: the depth he must gain first, then as far toward his lane as he gets.
        const fy = W.y - set.y;
        const dy = Math.sign(fy) * Math.min(Lmax, Math.max(Math.min(Math.abs(fy), gain), (Math.abs(fy) * Lmax) / L));
        const dx = Math.sqrt(Math.max(0, Lmax * Lmax - dy * dy));
        B1 = { x: set.x + Math.sign(W.x - set.x) * Math.min(Math.abs(W.x - set.x), dx), y: set.y + dy };
      }
      // A man coming up to the wall is still moving upfield at the catch; one dropping back to it stops there.
      const upfield = B1.y < set.y - 1e-6;
      setup.set(id, { B1, t1, upfield, keys: join(at0Of(id), drive([set, B1], start, t1, { accelMs: acc, decelMs: decK, restStart: true, restEnd: !upfield, keyMs: step })) });
    });
    const velAt = (id: string): Pt => {
      const su = setup.get(id) as { t1: number; upfield: boolean; keys: Key[] };
      return su.upfield ? velocity(su.keys, su.t1, step) : { x: 0, y: 0 };
    };
    // Coverage as it would be drawn unblocked.
    const free = new Map<string, Key[]>();
    for (const id of krCover) {
      const sl = slotOf.get(id) as OnFieldSlot & { index: number };
      free.set(id, unnamedTrack(sl, "O", startOf.get(id) as Pt, at0Of(id), snapAt + startAfter(id), topOf(id) / k, accOf(id)).ks);
    }
    // The engine's tackler as build() draws him (his template to the read, then to the ball): never
    // blocked, nobody engaged with him (KR5). The ball's last spot follows the cut, so he is traced
    // to the dead spot either way he cuts, and blocks keep off both.
    const finals: Pt[] = krCut === null ? [finalBall] : ([-1, 1] as const).map((sd) => ({ x: Math.max(M.sidelineMarginYards, Math.min(FIELD_WIDTH - M.sidelineMarginYards, land.x + sd * KR.cutYards)), y: finalBall.y }));
    const tacklerAts = ((): ((t: number) => Pt)[] => {
      if (tackler === null) return [];
      const fk = factKeys.get(tackler);
      return finals.map((fin) => {
        if (fk !== undefined && fk.length > 0) {
          // As build() draws a tackler with legs of his own (the kicker): his legs, then on to the ball.
          const last = fk[fk.length - 1] as Key;
          const cut = Math.min(last.t, liveEnd - M.convergeMs);
          const head = join(fk.filter((q) => q.t < cut), [{ t: cut, ...at(fk, cut) }]);
          const tk = join(head, tacklerRun(head[head.length - 1] as Key, liveEnd, speedAt(fk, cut), fin));
          return (t: number) => at(tk, t);
        }
        const sl = slotOf.get(tackler) as OnFieldSlot & { side: "O" | "X" };
        const st = snapAt + startAfter(tackler);
        const dk = sl.side === "O" ? trackOf(tackler, snapAt, k, liveEnd).keys : defenseTrack(sl, startOf.get(tackler) as Pt, st, liveEnd);
        const cut = Math.min(Math.max(read, st + step), liveEnd - step);
        const drop = join(dk.filter((q) => q.t < cut), [{ t: cut, ...at(dk, cut) }]);
        const tk = join(drop, tacklerRun(drop[drop.length - 1] as Key, liveEnd, speedAt(dk, cut), fin));
        return (t: number) => at(tk, t);
      });
    })();
    const offTackler = KR.engageYards + 0.8;
    // Candidate blocks: for each blocker and coverage man, the earliest contact that works.
    const tol = KR.behindToleranceYards;
    const cands: { b: string; c: string; tk: number; tb: number; p0: Pt; v: number; S: Pt; u: Pt }[] = [];
    // The pair drifts together at blockDriftYps, eased in over blockEaseMs, away from the blocker's
    // side (he drives his man back), to the whistle: always moving, nobody drawn winning (KR5, N5).
    const drift = (S: Pt, u: Pt, tk: number) => {
      const v = KR.blockDriftYps / 1000 / k;
      const E = Math.max(1, KR.blockEaseMs);
      return (t: number): Pt => {
        const tau = Math.max(0, t - tk);
        const f = tau < E ? (v * tau * tau) / (2 * E) : v * (tau - E / 2);
        return { x: clampX(S.x - u.x * f), y: S.y - u.y * f };
      };
    };
    // Each coverage man's stop, for a contact at each key (the same whoever blocks him).
    const stops = new Map<string, Map<number, { p0: Pt; vel: Pt; S: Pt }>>();
    const stopAt = (c: string, tk: number): { p0: Pt; vel: Pt; S: Pt } => {
      let m = stops.get(c);
      if (m === undefined) stops.set(c, (m = new Map()));
      const key = Math.round(tk * 8);
      let v = m.get(key);
      if (v === undefined) {
        const C = free.get(c) as Key[];
        const tb = tk - decK;
        const p0 = at(C, tb);
        const vel = velocity(C, tb, step);
        v = { p0, vel, S: { x: clampX(p0.x + (vel.x * decK) / 2), y: p0.y + (vel.y * decK) / 2 } };
        m.set(key, v);
      }
      return v;
    };
    for (const b of blockers) {
      const { B1, t1 } = setup.get(b) as { B1: Pt; t1: number };
      const vb = (KR.blockPace * topOf(b)) / k / 1000;
      const ab = accK(b);
      for (const c of krCover) {
        for (let tk = t1 + 4 * step; tk <= liveEnd - KR.minBlockMs + 1e-6; tk += step) {
          const tb = tk - decK;
          if (tb < tCatch) continue;
          const { p0, vel, S } = stopAt(c, tk);
          const dd = dist(B1, S);
          const u = dd < 1e-9 ? { x: 0, y: -1 } : { x: (B1.x - S.x) / dd, y: (B1.y - S.y) / dd };
          const P = { x: S.x + u.x * KR.contactYards, y: S.y + u.y * KR.contactYards };
          if (dist(B1, P) > vb * Math.max(0, tk - t1 - 0.5 * (ab + decK))) continue;
          const eb = krEnv.at(tk);
          if (dist(P, eb) - krEnv.extra(eb) < ring + 0.3) continue;
          // Never behind the carrier on his way to the block (KR4).
          let ahead = true;
          for (let t = t1; t <= tk + 1e-6 && ahead; t += 4 * step) {
            const f = (t - t1) / Math.max(1e-6, tk - t1);
            if (B1.y + (P.y - B1.y) * f - krEnv.at(t).y > tol - 0.25) ahead = false;
          }
          if (!ahead) continue;
          // Never near the tackler, on the way or in the block.
          if (tacklerAts.length > 0) {
            const H0 = drift(S, u, tk);
            let near = false;
            for (let t = t1; t <= liveEnd + 1e-6 && !near; t += 2 * step) {
              const f = Math.min(1, (t - t1) / Math.max(1e-6, tk - t1));
              const h = H0(t);
              const q = t < tk ? { x: B1.x + (P.x - B1.x) * f, y: B1.y + (P.y - B1.y) * f } : { x: h.x + u.x * KR.contactYards, y: h.y + u.y * KR.contactYards };
              if (tacklerAts.some((ta) => dist(q, ta(t)) < offTackler)) near = true;
            }
            if (near) continue;
          }
          // The coverage man stays outside the carrier's corridor from his stop to the whistle (KR9).
          const H = drift(S, u, tk);
          const need = M.pursuit.corridorHalfYards + KR.corridorMarginYards;
          let clear = true;
          for (let t = tb; t <= liveEnd + 1e-6 && clear; t += 2 * step) {
            const f = Math.min(1, Math.max(0, (t - tb) / decK));
            const q = t < tk ? { x: p0.x + (S.x - p0.x) * f, y: p0.y + (S.y - p0.y) * f } : H(t);
            if (toPath(q, laneAt(t)) < need) clear = false;
          }
          if (!clear) continue;
          cands.push({ b, c, tk, tb, p0, v: Math.hypot(vel.x, vel.y), S, u });
          break;
        }
      }
    }
    // Earliest contact first.
    cands.sort((x, y) => x.tk - y.tk || (x.b < y.b ? -1 : x.b > y.b ? 1 : x.c < y.c ? -1 : 1));
    const usedB = new Set<string>();
    const usedC = new Set<string>();
    const pairs: KrPair[] = [];
    for (const cd of cands) {
      if (usedB.has(cd.b) || usedC.has(cd.c)) continue;
      usedB.add(cd.b);
      usedC.add(cd.c);
      const { B1, t1, keys: pre } = setup.get(cd.b) as { B1: Pt; t1: number; keys: Key[] };
      const H = drift(cd.S, cd.u, cd.tk);
      const hold = grid(cd.tk, liveEnd, step).map((t) => ({ t, ...H(t) }));
      const C = free.get(cd.c) as Key[];
      const brake = drive([cd.p0, cd.S], cd.tb, cd.tk, { accelMs: accK(cd.c), decelMs: decK, restStart: false, restEnd: true, keyMs: step, v0: cd.v });
      keys.set(cd.c, { ks: join(C.filter((q) => q.t < cd.tb - 1e-9), [{ t: cd.tb, ...cd.p0 }], brake, hold), readFor: read });
      const P = { x: cd.S.x + cd.u.x * KR.contactYards, y: cd.S.y + cd.u.y * KR.contactYards };
      const v1 = velAt(cd.b);
      const sp = Math.hypot(v1.x, v1.y);
      const run = drive([B1, P], t1, cd.tk, { accelMs: accK(cd.b), decelMs: decK, restStart: sp < 1e-6, restEnd: true, keyMs: step, ...(sp < 1e-6 ? {} : { v0: sp }) });
      const with_ = hold.map((q) => ({ t: q.t, x: clampX(q.x + cd.u.x * KR.contactYards), y: q.y + cd.u.y * KR.contactYards }));
      keys.set(cd.b, { ks: join(pre, run, with_), readFor: t1 });
      pairs.push({ blocker: cd.b, coverage: cd.c, from: cd.tk, axis: { x: -cd.u.x, y: -cd.u.y } });
    }
    // Unblocked coverage is drawn from the same free track (build() would make it again).
    for (const c of krCover) if (!keys.has(c)) keys.set(c, { ks: free.get(c) as Key[], readFor: Math.max(snapAt + startAfter(c) + 4 * step, read) });
    const blocks: KrBlocks = { k, liveEnd, keys, pairs, blockers, sorted, usedB, setup, tacklerAts, offTackler };
    krBlocksOut = blocks;
    return leadersOn(blocks);
  }

  /**
   * The leaders on top of the planned blocks: every return-unit mark not blocking, not the returner
   * and not a recoverer. They run with the carrier as he is drawn (his cut included), so they are
   * the only part of the plan built again for each cut.
   */
  function leadersOn(B: KrBlocks): KrPlan {
    const { pairs, blockers, sorted, usedB, setup, tacklerAts, offTackler } = B;
    const keys = new Map(B.keys);
    const accK = (id: string): number => accOf(id) * k;
    const velAt = (id: string): Pt => {
      const su = setup.get(id) as { t1: number; upfield: boolean; keys: Key[] };
      return su.upfield ? velocity(su.keys, su.t1, step) : { x: 0, y: 0 };
    };
    // A blocker with nobody to block leads the carrier: leadYards in front of him, keeping toward his
    // lane, and wide of the tackler and of every coverage man (a contact would read as a block, KR5).
    // So does a named man or a fouler of the return unit; a recoverer goes for the ball (converge).
    const others: { readonly at: (t: number) => Pt; readonly R: number }[] = [];
    // The tackler gets more room than the coverage: the run that chases the moved path lags it a little.
    for (const ta of tacklerAts) others.push({ at: ta, R: offTackler + 1.2 });
    for (const c of krCover) {
      const ck = (keys.get(c) as { ks: Key[] }).ks;
      others.push({ at: (t) => at(ck, t), R: KR.engageYards + 0.6 });
    }
    for (const b of sorted) {
      if (usedB.has(b) || plan.converge.has(b) || plan.legs.has(b)) continue;
      const { B1, t1, keys: pre } = setup.get(b) as { B1: Pt; t1: number; keys: Key[] };
      // He keeps the gap he had at the catch, from leadYards to twice it (a man far upfield waits for
      // the carrier rather than running into the coverage), so he runs with the carrier.
      const gap = Math.min(2 * KR.leadYards, Math.max(KR.leadYards, ballAt(t1).y - B1.y));
      const target = (t: number): Pt => {
        const q = ballAt(t);
        return { x: B1.x + (q.x - B1.x) * 0.5, y: Math.min(B1.y, q.y - gap) };
      };
      // He runs for his point at leadPace and goes wide of the tackler and the coverage, inside his
      // own top speed (N1): a first run at leadPace finds where he would come near them, a smooth
      // offset (roomOffset) moves that path off them, and a second run chases the moved path at no
      // more than his top speed. His speed comes only from follow, never from moving keys.
      // Up to three times: the offset from the run as drawn, then a run that chases the moved path.
      let lead = follow({ start: B1, vel: velAt(b), t0: t1, t1: liveEnd, target, top: (KR.leadPace * topOf(b)) / k, accelMs: accK(b), brakeYards: M.pursuit.brakeYards, keyMs: step });
      for (let it = 0; it < 3; it++) {
        const off = roomOffset(lead, others, 600 * k);
        if (off === null) break;
        const path = lead;
        const moved = (t: number): Pt => {
          const p = at(path, t);
          const o = off(t);
          return { x: clampX(p.x + o.x), y: p.y + o.y };
        };
        lead = follow({ start: B1, vel: velAt(b), t0: t1, t1: liveEnd, target: moved, top: topOf(b) / k, accelMs: accK(b), brakeYards: M.pursuit.brakeYards, keyMs: step });
      }
      keys.set(b, { ks: join(pre, lead), readFor: t1 });
    }
    return { keys, pairs, blockers, coverage: [...krCover], setup: new Map([...setup].map(([id, v]) => [id, v.keys])) };
  }
  /**
   * Where a leader's run would come within a mark's R, the offset that moves him off it: a moving
   * average (a triangle over W ms either side) of the push, a few times over so it covers the
   * closest pass. Continuous, so the point he runs for drifts off the tackler and the coverage
   * smoothly. Null when he never comes near anyone.
   */
  function roomOffset(ks: readonly Key[], avoid: readonly { readonly at: (t: number) => Pt; readonly R: number }[], W: number): ((t: number) => Pt) | null {
    if (avoid.length === 0 || ks.length === 0) return null;
    const n = ks.length;
    const ox = new Array<number>(n).fill(0);
    const oy = new Array<number>(n).fill(0);
    const half = Math.max(1, Math.round(W / step));
    let touched = false;
    for (let it = 0; it < 8; it++) {
      const nx = new Array<number>(n).fill(0);
      const ny = new Array<number>(n).fill(0);
      let any = false;
      for (let i = 0; i < n; i++) {
        const q = ks[i] as Key;
        const p = { x: q.x + (ox[i] as number), y: q.y + (oy[i] as number) };
        for (const o of avoid) {
          const tp = o.at(q.t);
          const dd = dist(p, tp);
          if (dd >= o.R) continue;
          any = true;
          const u = dd < 1e-9 ? { x: p.x <= tp.x ? -1 : 1, y: 0 } : { x: (p.x - tp.x) / dd, y: (p.y - tp.y) / dd };
          nx[i] = (nx[i] as number) + u.x * (o.R - dd) * 1.5;
          ny[i] = (ny[i] as number) + u.y * (o.R - dd) * 1.5;
        }
      }
      if (!any) break;
      touched = true;
      for (let i = 0; i < n; i++) {
        let sx = 0;
        let sy = 0;
        let sw = 0;
        for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
          const w = 1 - Math.abs(j - i) / (half + 1);
          sx += (nx[j] as number) * w;
          sy += (ny[j] as number) * w;
          sw += w;
        }
        ox[i] = (ox[i] as number) + (sx / sw) * 2;
        oy[i] = (oy[i] as number) + (sy / sw) * 2;
      }
    }
    if (!touched) return null;
    const offKeys: Key[] = ks.map((q, i) => ({ t: q.t, x: ox[i] as number, y: oy[i] as number }));
    return (t) => at(offKeys, t);
  }

  let krBlocksOut: KrBlocks | null = null;
  const krPlan = planKickReturn();
  if (krOpt?.planOnly === true) return krChoices(krPlan).map((c) => (krBlocksOut === null ? c : { ...c, blocks: krBlocksOut }));

  /**
   * KR7: where and which way he cuts, from the planned blocks alone (they are the same for every
   * cut, krEnv), counted as KR4 reads them on the plan's keys (net, below). His corner comes one of cutLagsMs after a block, at the first
   * such time where one side has more blocks all through stableMs either side of readLeadMs before
   * the corner (where KR6's heading change reads), and inside the upfield room the return allows.
   * Last, the late cut: lateCutMs after the first block, toward the side the planned count reads
   * there, the id hash's on a tie. At most KR_DRAWS in all.
   */
  function krChoices(p: KrPlan | null): KrChoice[] {
    const cut = krCut as { readonly minUp: number; readonly maxUp: number } | null;
    const land = krLand as Pt | null;
    if (p === null || cut === null || land === null || krReturner === null) return [];
    const pairs = [...p.pairs].sort((a, b) => a.from - b.from || (a.blocker < b.blocker ? -1 : 1));
    // The count as KR4 reads it, on the plan's own keys: a blocker within engageYards of a coverage
    // man, in a contact that began where he wasn't behind the (straight) carrier; on his side of the
    // catch x, or unreadable within deadbandYards of it. Memoized by key.
    const keysOf = (id: string): Key[] => p.keys.get(id)?.ks ?? [];
    const memo = new Map<number, number | null>();
    const net = (t0: number): number | null => {
      const t = Math.round(t0 / step) * step;
      const hit = memo.get(t);
      if (hit !== undefined) return hit;
      let n: number | null = 0;
      for (const b of p.blockers) {
        const bk = keysOf(b);
        const q = at(bk, t);
        const on = p.coverage.some((c) => {
          const ck = keysOf(c);
          if (dist(q, at(ck, t)) > KR.engageYards) return false;
          let s0 = t;
          while (s0 - step >= read && dist(at(bk, s0 - step), at(ck, s0 - step)) <= KR.engageYards) s0 -= step;
          return at(bk, s0).y - krEnv.at(s0).y <= KR.behindToleranceYards;
        });
        if (!on) continue;
        const dx = q.x - land.x;
        if (Math.abs(dx) < KR.deadbandYards) {
          n = null;
          break;
        }
        n += Math.sign(dx);
      }
      memo.set(t, n);
      return n;
    };
    const upAt = (t: number): number => land.y - krEnv.at(t).y;
    const cands: { tc: number; side: -1 | 1; up: number }[] = [];
    for (const lag of KR.cutLagsMs)
      for (const q of pairs) {
        const tc = q.from + lag;
        const tr = tc - KR.readLeadMs;
        let sign = 0;
        let ok = true;
        for (let t = tr - KR.stableMs; t <= tr + KR.stableMs + 1e-6 && ok; t += step) {
          const v = net(t);
          if (v === null || v === 0 || (sign !== 0 && Math.sign(v) !== sign)) ok = false;
          else sign = Math.sign(v);
        }
        const up = upAt(tc);
        if (ok && up >= cut.minUp - 1e-6 && up <= cut.maxUp + 1e-6) cands.push({ tc, side: sign as -1 | 1, up });
      }
    cands.sort((a, b) => a.tc - b.tc || a.side - b.side);
    const out: KrChoice[] = [];
    const seen = new Set<string>();
    for (const c of cands) {
      const key = `${c.side}|${c.up.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ side: c.side, up: c.up, decided: true });
      if (out.length >= KR_DRAWS - 1) break;
    }
    // The late cut: toward the side with more planned blocks where it reads, the id hash's on a tie.
    const first = pairs[0];
    const upTie = first === undefined ? cut.minUp : Math.max(cut.minUp, Math.min(cut.maxUp, upAt(first.from + KR.lateCutMs)));
    let tTie = read;
    while (tTie < liveEnd && upAt(tTie) < upTie - 1e-6) tTie += step;
    const vTie = net(tTie - KR.readLeadMs);
    out.push({ side: vTie !== null && vTie !== 0 ? (Math.sign(vTie) as -1 | 1) : krHashSide(krReturner), up: upTie, decided: vTie !== null && vTie !== 0 });
    return out;
  }

  const build = (slots: readonly OnFieldSlot[], side: "O" | "X", setPts: readonly Pt[], huddlePts: readonly Pt[], into: TLMark[]): void => {
    slots.forEach((s, i) => {
      const set = setPts[i] as Pt;
      const huddle = huddled(side);
      const pre: Key[] = huddle && lineUpMs > 0 ? drive([huddlePts[i] as Pt, set], 0, Math.max(step, lineUpMs - 1), { accelMs: 150, decelMs: 150, restStart: true, restEnd: true, keyMs: step }) : [{ t: 0, ...set }];
      const at0: Key[] = join(pre, [{ t: snapAt, ...set }]);
      const pos = s.position;
      const accel = accOf(s.id);
      // Everyone moves at the same compressed or stretched pace as the anchored players (decision 11: uniform scaling).
      const top = topOf(s.id) / k;
      const start = snapAt + startAfter(s.id);
      const base = { slot: s.slot, side, position: pos, playerId: s.id, roles: roleOf(s.id), huddle };
      const push = (m: TLMark): void => {
        into.push(m);
        if (side === "X") defKeysById.set(s.id, m.keys);
      };
      if (live <= 0) {
        // No snap: nobody moves (a huddle side still lines up first).
        push({ ...base, keys: huddle && lineUpMs > 0 ? at0 : [{ t: 0, ...set }], fact: false, pathEnd: snapAt, pathStyle: "none" });
        return;
      }
      const fact = factKeys.get(s.id);
      const target = plan.target !== null && plan.target.id === s.id ? plan.target : null;
      const missTarget = missOut?.target ?? null;
      let keys: Key[];
      let pathEnd = liveEnd;
      let isFact = false;
      const conv = plan.converge.get(s.id);
      if (conv !== undefined) {
        // R9: exactly what he would do unnamed until the read, then on to his fact (the catch, the sack).
        isFact = true;
        const lineman = (pos === "OL" || pos === "DL") && contactFamily !== null;
        // A kick returner's teammate (a return-team recoverer) runs the hang setup every return-unit mark runs (KR7).
        const krSet = side === "X" ? krPlan?.setup.get(s.id) : undefined;
        let raw = krSet !== undefined ? [...krSet] : lineman ? join(at0, linemanSteps(s, side, setPts, set, start, top, accel, contactFamily as string).engaged) : join(at0, side === "O" ? trackOf(s.id, snapAt, k, liveEnd, stalkOf).keys : defenseTrack(s, set, start, liveEnd));
        // His read may come after an unnamed man's pursuit has begun (a recoverer): pursue the same way until it.
        const pFrom = lineman ? (pos === "DL" ? releaseT : Infinity) : side === "X" ? Math.max(start + 4 * step, read + reactOf(s.id)) : Infinity;
        if (pFrom < Math.min(T(conv.read), liveEnd - 3 * step)) {
          const p0 = at(raw, pFrom);
          raw = join(
            raw.filter((q) => q.t <= pFrom),
            pursue({ start: p0, vel: velocity(raw, pFrom, step), t0: pFrom, t1: liveEnd, ball: ballAt, topSpeed: top, accelMs: accel, leadMs: M.pursuit.leadMs, turnDegPerS: M.pursuit.turnDegPerS, ring, brakeYards: M.pursuit.brakeYards, ...(lineman ? {} : { corridor: { half: M.pursuit.corridorHalfYards, ms: M.pursuit.corridorMs } }), keyMs: step, lateral: latOf(), ringAt: flightR(ring) }),
          );
        }
        // Natural motion: the raw keys keep the ring push; the governor smooths it and slides along the ring (NM6).
        const fixed = ringFix(atThrow(raw), ringBallRaw, side === "X" ? ring : 1.5, snapWindowEnd, liveEnd, lineman ? "sideways" : "radial", side === "O" ? -1 : 1, flightR(side === "X" ? ring : 1.5));
        const tr = Math.min(Math.max(T(conv.read), start + step), T(conv.t) - step);
        const pre = join(fixed.filter((q) => q.t < tr), [{ t: tr, ...at(fixed, tr) }]);
        const p = at(pre, tr);
        depOf.set(s.id, tr);
        ringOf.set(s.id, { R: side === "X" ? ring : 1.5, to: tr, sideways: lineman });
        // A sacker comes around his blocker's outside shoulder, never through him.
        const out = p.x <= MID_X ? -1 : 1;
        const pts = conv.around === true && dist(p, conv.at) > M.sackArc.minYards ? [p, { x: clampX(p.x + out * M.sackArc.outYards), y: Math.min(p.y, conv.at.y + (p.y - conv.at.y) * M.sackArc.depthShare) }, conv.at] : [p, conv.at];
        const run = drive(pts, tr, Math.max(tr + step, T(conv.t)), { accelMs: accel, decelMs: M.decelMs, restStart: false, restEnd: conv.around === true, keyMs: step, fillet: M.fillet, v0: speedAt(fixed, tr) });
        // His run after the fact (an interception return) keeps the leg's own start: the ball was built from it.
        const after = fact ?? [];
        keys = join(pre, run, after.filter((q) => q.t > T(conv.t) + 1e-6));
        const last = keys[keys.length - 1] as Key;
        if (s.id === sacker) keys = join(keys.filter((q) => q.t <= liveEnd), [{ t: liveEnd, ...at(keys, Math.min(last.t, liveEnd)) }]);
        else if (s.id === tackler) {
          const cut = Math.min(last.t, liveEnd - M.convergeMs);
          keys = join(keys.filter((q) => q.t < cut), [{ t: cut, ...at(keys, cut) }]);
          keys = join(keys, tacklerRun(keys[keys.length - 1] as Key, liveEnd, speedAt(keys, cut)));
          legStops.set(s.id, [cut]);
        } else if (last.t < liveEnd - step) keys = join(keys, idleUntil(last, liveEnd, s.id, side, pos));
        else if (last.t > liveEnd) keys = join(keys.filter((q) => q.t < liveEnd), [{ t: liveEnd, ...at(keys, liveEnd) }]);
      } else if (missTarget !== null && missTarget.id === s.id) {
        // A1: on an incompletion the target runs his template and finish to the whistle (kept off
        // the ball until the throw like everyone), reaching toward the ball around the arrival.
        isFact = true;
        // A stalker shadows his man's coverage track (the same before the throw; after it, the man's pursuit is ignored).
        // His template track kept off the ball until the throw (resolveMiss built it); the reach is
        // added after natural motion (naturalPass), so it can't be smoothed away.
        const tr = missTarget.track;
        depOf.set(s.id, missTarget.throwT);
        ringOf.set(s.id, { R: 1.5, to: missTarget.throwT, sideways: false });
        keys = join(at0, tr);
      } else if (target !== null) {
        // R7: his template exactly to the leave point, then a curve to the catch at catch time.
        isFact = true;
        // NM6: his run after the catch starts at the speed he caught it with (re-driven above).
        const curve = curveOf.get(s.id) ?? toCatch(s.id, T(target.throwT), T(target.catchT), target.at);
        const after = factKeys.get(s.id) ?? fact ?? [];
        keys = join(at0, curve, after);
        depOf.set(s.id, T(target.throwT));
        ringOf.set(s.id, { R: 1.5, to: T(target.throwT), sideways: false });
        const last = keys[keys.length - 1] as Key;
        if (last.t < liveEnd - step) keys = join(keys, idleUntil(last, liveEnd, s.id, side, pos));
        else if (last.t > liveEnd) keys = join(keys.filter((q) => q.t < liveEnd), [{ t: liveEnd, ...at(keys, liveEnd) }]);
      } else if (fact !== undefined) {
        isFact = true;
        const first = fact[0] as Key;
        keys = join(at0, first.t > snapAt ? [{ t: first.t, ...set }] : [], fact);
        let last = keys[keys.length - 1] as Key;
        if (s.id === tackler) {
          // His own legs (a passer after the throw, say) stop where his run to the tackle starts.
          const cut = Math.min(last.t, liveEnd - M.convergeMs);
          const here = at(keys, cut);
          keys = join(keys.filter((q) => q.t < cut), [{ t: cut, ...here }]);
          last = keys[keys.length - 1] as Key;
          keys = join(keys, tacklerRun(last, liveEnd, speedAt(keys, cut)));
          legStops.set(s.id, [cut]);
        } else if (s.id === sacker || (sacker !== null && s.id === parts.passer)) {
          // The sacker stays on the QB he brought down (Joseph's playtest: he used to bounce off to the
          // ring), and the sacked QB stays down where he was hit, even when someone else recovers his fumble.
          keys = join(keys.filter((q) => q.t <= liveEnd), [{ t: liveEnd, ...at(keys, Math.min(last.t, liveEnd)) }]);
        } else if (last.t < liveEnd - step) keys = join(keys, plan.sitAfter.has(s.id) ? sitAfter(keys, last, liveEnd, s.id) : idleUntil(last, liveEnd, s.id, side, pos));
        else if (last.t > liveEnd) keys = join(keys.filter((q) => q.t < liveEnd), [{ t: liveEnd, ...at(keys, liveEnd) }]);
      } else if (s.id === tackler) {
        isFact = true;
        // Until the read he does what he would unnamed: a lineman his line steps, others their template.
        const lineman = (pos === "OL" || pos === "DL") && contactFamily !== null;
        const dk = lineman ? linemanSteps(s, side, setPts, set, start, top, accel, contactFamily as string).engaged : side === "O" ? trackOf(s.id, snapAt, k, liveEnd).keys : defenseTrack(s, set, start, liveEnd);
        const cut = Math.min(Math.max(read, start + step), liveEnd - step);
        const drop = join(dk.filter((q) => q.t < cut), [{ t: cut, ...at(dk, cut) }]);
        keys = join(at0, drop, tacklerRun(drop[drop.length - 1] as Key, liveEnd, speedAt(dk, cut)));
        depOf.set(s.id, cut);
        legStops.set(s.id, [cut]);
      } else {
        const lineman = (pos === "OL" || pos === "DL") && contactFamily !== null;
        if (lineman) {
          const { engaged, engageEnd } = linemanSteps(s, side, setPts, set, start, top, accel, contactFamily);
          let ks = join(at0, engaged);
          if (pos === "DL" && releaseT < liveEnd - 3 * step) {
            const p = at(ks, releaseT);
            ks = join(
              ks.filter((q) => q.t <= releaseT),
              pursue({ start: p, vel: velocity(ks, releaseT, step), t0: releaseT, t1: liveEnd, ball: ballAt, topSpeed: top, accelMs: accel, leadMs: M.pursuit.leadMs, turnDegPerS: M.pursuit.turnDegPerS, ring, brakeYards: M.pursuit.brakeYards, keyMs: step, lateral: latOf(), ringAt: flightR(ring) }),
            );
          }
          keys = ringFix(atThrow(ks), ringBallRaw, side === "X" ? ring : 1.5, snapWindowEnd, liveEnd, "sideways", side === "O" ? -1 : 1, flightR(side === "X" ? ring : 1.5));
          ringOf.set(s.id, { R: side === "X" ? ring : 1.5, to: side === "X" ? liveEnd + M.settleMs : liveEnd, sideways: true });
          const namedLineman = named.has(s.id) || (parts.foulers ?? []).includes(s.id);
          pathEnd = namedLineman ? liveEnd : Math.min(releaseT, engageEnd);
          push({ ...base, keys: settleOf(keys, side, s.id), fact: false, pathEnd, pathStyle: side === "O" ? "block" : "none" });
          return;
        }
        // Routes and drops to the read, then everyone flows to the ball; a stalk block holds to the
        // whistle. On a kickoff return the return unit sets its wall and blocks, and blocked coverage
        // holds its block (krPlan).
        const { ks, readFor } = krPlan?.keys.get(s.id) ?? unnamedTrack(s, side, set, at0, start, top, accel);
        const R0 = side === "X" ? ring : krCoverR(s.id);
        keys = ringFix(atThrow(ks), ringBallRaw, R0, snapWindowEnd, liveEnd, "radial", side === "O" ? -1 : 1, flightR(R0));
        ringOf.set(s.id, { R: R0, to: side === "X" ? liveEnd + M.settleMs : liveEnd, sideways: false });
        pathEnd = Math.min(readFor, liveEnd);
      }
      // Named players keep their whole path: the roles the engine credited and the fouling players.
      const named0 = named.has(s.id) || s.id === tackler || (parts.foulers ?? []).includes(s.id);
      push({
        ...base,
        keys: s.id === plan.holder || s.id === tackler || s.id === sacker || (sacker !== null && s.id === parts.passer) ? hold(keys) : settleOf(keys, side, s.id),
        fact: isFact,
        pathEnd: named0 ? liveEnd : pathEnd,
        pathStyle: side === "O" ? "arrow" : "none",
      });
    });
  };

  /**
   * A lineman's diagram steps to contact and his engaged drift (shared by the unnamed lineman and
   * a named one before his read, so they are the same drawing): his step from data, then the pair
   * drifts together (toward the play side on runs, set back on passes); nobody is drawn winning.
   */
  /** A lineman's step to contact (his own values), shared by linemanSteps and his pair mate's schedule. */
  function lineStep(id: string, family: string): { steps: ReturnType<typeof runRoute>; w: FieldWp[]; start: number } {
    const hit = lineStepCache.get(id);
    if (hit !== undefined) return hit;
    const sl = slotOf.get(id) as OnFieldSlot & { side: "O" | "X"; index: number };
    const setPts = sl.side === "O" ? offStart : defStart;
    const set = startOf.get(id) as Pt;
    const start = snapAt + startAfter(id);
    const lkeys = lineKeys(sl.side === "O" ? offRefs : defRefs, setPts, sl.slot, sl.position);
    const w = place(set, lineContactFor(templates, unit.leaf, family, lkeys));
    const steps = runRoute(set, w, start, { top: topOf(id) / k, pace: 1, endPace: 0, accelMs: accOf(id), decelMs: M.decelMs, keyMs: step, fillet: M.fillet, pause: M.sit, smoothMs: NAT.smoothMs });
    const r = { steps, w, start };
    lineStepCache.set(id, r);
    return r;
  }

  function linemanSteps(s: OnFieldSlot, side: "O" | "X", setPts: readonly Pt[], set: Pt, start: number, top: number, accel: number, family: string): { engaged: Key[]; contact: Pt; engageEnd: number } {
    const pos = s.position;
    void setPts;
    void accel;
    const { steps, w } = lineStep(s.id, family);
    const contact = steps.at;
    const engageEnd = Math.max(steps.end, start + step);
    lineInfo.set(s.id, { contact, engageEnd });
    // NM7: a pair sets or drifts together: from when both have made contact, at their mean pace, so
    // contact holds (M6) and nobody is drawn winning.
    const mate = pairPre.get(s.id);
    const mateEnd = mate === undefined ? engageEnd : Math.max(lineStep(mate, family).steps.end, lineStep(mate, family).start + step);
    const driftStart = Math.max(engageEnd, mateEnd);
    const topPair = mate === undefined ? top : (top + topOf(mate) / k) / 2;
    // The pocket: on passes each engaged pair is pushed back together (motion.json pocket).
    const hold: Pt = { x: clampX(contact.x + runDrift), y: contact.y - (family === "pass" ? M.pocket.yards : 0) };
    // With no drift (a sneak, a kick) the pair still shuffles together upfield, at most the block shuffle (R5).
    const L0 = dist(contact, hold);
    const L = L0 < 1e-9 ? M.sit.blockMaxYards : L0;
    const dir = L0 < 1e-9 ? { x: 0, y: 1 } : { x: (hold.x - contact.x) / L0, y: (hold.y - contact.y) / L0 };
    const holdEnd = Math.max(engageEnd + 2 * step, pos === "DL" ? Math.min(releaseT, liveEnd) : liveEnd);
    const v0 = ((family === "pass" ? M.pocket.pace : M.sit.pace) * topPair) / 1000;
    // NM7: the set or drift is eased (smoothstep over the time it takes at that pace, its peak speed
    // the pace), not hyperbolic; the hand fight goes on top of it in the governor.
    const D0 = (1.5 * L) / Math.max(1e-9, v0);
    const eased = grid(engageEnd, holdEnd, step).map((t) => {
      const f = smoothstepT((t - driftStart) / D0) * L;
      return { t, x: contact.x + dir.x * f, y: contact.y + dir.y * f };
    });
    let engaged = join(w.length > 0 ? steps.keys : [{ t: start, ...set }], eased);
    if (family === "run" && end !== undefined) {
      // After the handoff (never before: R9), the pair is pushed together with the run: back on a
      // loss, on on a gain, at most pocket.yards. Nobody is drawn winning.
      const gain = end.spot - los;
      const D = Math.sign(gain) * Math.min(Math.abs(gain), M.pocket.yards);
      const r0 = read;
      const pv = (M.pocket.pace * topPair) / 1000;
      const DD = (1.5 * Math.abs(D)) / Math.max(1e-9, pv);
      if (Math.abs(D) > 1e-6) engaged = engaged.map((q) => (q.t <= r0 ? q : { ...q, y: q.y + D * smoothstepT((q.t - r0) / DD) }));
    }
    return { engaged, contact, engageEnd };
  }

  /**
   * A defender's diagram motion from his start (R9), from the calls (and on runs the play side)
   * only: a read step (non-rushers on scrimmage plays), his drop set's steps (the pedal), then his
   * zone landmark and the sink toward the nearest receiver's template, or the man trail of his
   * receiver's template, or a settle at the end of a plain drop.
   */
  /** A defender's assignment from the calls (R9): his zone landmark, his man spot, his drop steps, and whether he rushes. */
  function coverPlan(s: OnFieldSlot, set: Pt): { lm: ReturnType<typeof landmark>; manSpot: Pair | undefined; dropsName: string; steps: FieldWp[]; rusher: boolean } {
    const pos = s.position;
    const lm = preset === null || pos === "DL" ? undefined : landmark(templates, preset, s.slot, los, bounds.maxY);
    const manSpot = preset === null || pos === "DL" || lm !== undefined ? undefined : templates.manTargets[preset]?.[s.slot];
    const dropsName = unit.drops !== "" ? unit.drops : (templates.presetDrops[event.defense ?? ""] ?? "zone");
    const steps = place(set, lookup(templates.drops[dropsName], [s.slot, pos]));
    const rusher = lm === undefined && manSpot === undefined && steps.length > 0 && (steps[steps.length - 1] as FieldWp).p.y < set.y;
    return { lm, manSpot, dropsName, steps, rusher };
  }

  function defenseTrack(s: OnFieldSlot, set: Pt, t0: number, horizon: number): Key[] {
    const pos = s.position;
    const top = topOf(s.id) / k;
    const accel = accOf(s.id);
    const { lm, manSpot, dropsName, steps, rusher } = coverPlan(s, set);
    const readStep = scrimmage && !rusher && pos !== "DL" ? place(set, lookup(templates.readStep[family], [pos])) : [];
    const wps: FieldWp[] = [...readStep, ...steps];
    if (lm !== undefined) wps.push({ p: lm.at, pauseMs: 0, pace: 1 });
    // Defensive backs always backpedal at least a little; nobody stands still.
    if (wps.length === 0) wps.push({ p: { x: set.x, y: Math.min(bounds.maxY, set.y + 2) }, pauseMs: 0, pace: 1 });
    const endPace = lm !== undefined ? M.zoneDrift.pace : M.sit.pace;
    const r = runRoute(set, wps, t0, { top, pace: 1, endPace, accelMs: accel, decelMs: M.decelMs, keyMs: step, fillet: M.fillet, pause: M.sit, smoothMs: NAT.smoothMs });
    const head = join([{ t: snapAt, ...set }, { t: t0, ...set }], r.keys);
    if (horizon <= r.end) return underBackLine(head, set);
    const vel = { x: r.dir.x * r.speed, y: r.dir.y * r.speed };
    if (lm !== undefined) {
      // Zone sink: toward the nearest receiver's template position, inside his zone, near his landmark.
      const z = lm.zone;
      const [x0, x1] = [Math.min(z.x0, z.x1), Math.max(z.x0, z.x1)];
      const [y0, y1] = [Math.min(z.y0, z.y1), Math.max(z.y0, z.y1)];
      const sink = (t: number): Pt => {
        let best: Pt | undefined;
        let bd = Infinity;
        for (const id of receivers) {
          const q = at(tpl(id), t);
          const dd = dist(q, lm.at);
          if (dd < bd) {
            bd = dd;
            best = q;
          }
        }
        if (best === undefined) return lm.at;
        const f = bd > M.zoneDrift.maxYards ? M.zoneDrift.maxYards / bd : 1;
        return { x: Math.max(x0, Math.min(x1, lm.at.x + (best.x - lm.at.x) * f)), y: Math.max(y0, Math.min(y1, lm.at.y + (best.y - lm.at.y) * f)) };
      };
      return underBackLine(join(head, follow({ start: r.at, vel, t0: r.end, t1: horizon, target: sink, top: top * M.zoneDrift.pace, accelMs: accel, brakeYards: M.pursuit.brakeYards, keyMs: step })), set);
    }
    if (manSpot !== undefined) {
      // Man trail: his receiver's template, a reaction lag behind, with cushion over the top, holding his depth until the receiver gets to it.
      const rcv = nearestReceiver({ x: MID_X + manSpot[0], y: los - manSpot[1] });
      if (rcv !== undefined) {
        const cushion = dropsName === "blitz" ? M.man.pressCushionYards : M.man.cushionYards;
        const holdY = r.at.y;
        const trail = (t: number): Pt => {
          const q = at(tpl(rcv), t - M.man.lagMs);
          return { x: Math.max(bounds.margin, Math.min(FIELD_WIDTH - bounds.margin, q.x)), y: Math.min(bounds.maxY, Math.max(q.y + cushion, holdY)) };
        };
        return underBackLine(join(head, follow({ start: r.at, vel, t0: r.end, t1: horizon, target: trail, top, accelMs: accel, brakeYards: M.pursuit.brakeYards, keyMs: step })), set);
      }
    }
    const sd = settleDir(r.at, r.dir, r.speed, set, top);
    return underBackLine(join(head, sitDrift(r.at, sd.dir, sd.v0, sitYards(M.sit.maxYards), r.end, horizon, step)), set);
  }

  /**
   * The target (R7): his template track exactly up to the point nearest the catch that he can
   * reach by catch time at his top speed, then a curve (tangent to his motion there) to the catch
   * point, arriving at catch time.
   */
  function toCatch(id: string, tThrow: number, tc: number, c: Pt, stalk: (id: string) => readonly Key[] | undefined = stalkOf): Key[] {
    // Until the throw he is kept off the ball exactly as an unnamed receiver is (ringFix), so his path can't show he's the target.
    const tk = trackOf(id, snapAt, k, tc, stalk).keys;
    const tr = ringFix(tk, ringBallRaw, 1.5, snapWindowEnd, tThrow, "radial", -1, flightR(1.5));
    // Never before the throw (decision 9, P3): until the ball is out he runs his template like
    // everyone else. When no leave point at or after the throw is reachable at top speed, he speeds
    // up after the throw (R8).
    const top = (speedOf(id) / k) / 1000;
    let bestD = Infinity;
    let bestNeed = Infinity;
    /** The bend's lead-in along his heading: up to 1.5 yd when the catch is ahead of him, none when it is beside or behind. */
    const leadOf = (pq: Pt, q: Pt, dd: number): number => {
      const h = dist(pq, q);
      if (h < 1e-6 || dd < 1e-6) return 0;
      const cos = ((q.x - pq.x) * (c.x - q.x) + (q.y - pq.y) * (c.y - q.y)) / (h * dd);
      return Math.min(M.bend.leadYards, dd * M.bend.leadShare) * Math.max(0, cos);
    };
    /** The bend's length from key i: on along his heading a little, then to the catch point. */
    const bendLen = (i: number): number => {
      const q = tr[i] as Key;
      const pq = tr[Math.max(0, i - 1)] as Key;
      const h = dist(pq, q);
      const dd = dist(q, c);
      if (h < 1e-6 || dd <= 0.5) return dd;
      const lead = leadOf(pq, q, dd);
      return lead + dist({ x: q.x + ((q.x - pq.x) / h) * lead, y: q.y + ((q.y - pq.y) / h) * lead }, c);
    };
    let li0 = tr.findIndex((q) => q.t >= tThrow - 1e-6);
    if (li0 < 0) li0 = tr.length - 1;
    let li = li0;
    let needI = li0;
    // Natural motion (NM6): a leave point counts only if the bend can be run from the speed he has
    // there within his acceleration (no burst from a standstill to the catch).
    const acc = top / Math.max(1, accOf(id));
    const feasible = (i: number): boolean => {
      const q = tr[i] as Key;
      const tau = Math.max(1e-6, tc - q.t);
      const v = dist(q, tr[Math.max(0, i - 1)] as Key) / step;
      const ramp = Math.min(tau, Math.max(0, top - v) / acc);
      return bendLen(i) <= v * ramp + 0.5 * acc * ramp * ramp + Math.min(top, v + acc * ramp) * (tau - ramp) + 1e-9;
    };
    for (let i = li0; i < tr.length; i++) {
      const q = tr[i] as Key;
      if (q.t > tc - step && i > li0) break;
      const dd = dist(q, c);
      const need = bendLen(i) / Math.max(1e-6, tc - q.t);
      if (need <= top && feasible(i) && dd < bestD - 1e-9) {
        bestD = dd;
        li = i;
      }
      if (need < bestNeed) {
        bestNeed = need;
        needI = i;
      }
    }
    if (bestD === Infinity) li = needI;
    else {
      // He keeps running his template as long as he stays this close to the best leave point (within
      // 0.5 yd more), so a receiver who gets there early sits in his route rather than standing on the spot.
      for (let i = li + 1; i < tr.length; i++) {
        const q = tr[i] as Key;
        if (q.t > tc - step) break;
        if (dist(q, c) <= bestD + 0.5 && bendLen(i) / Math.max(1e-6, tc - q.t) <= top && feasible(i)) li = i;
      }
    }
    // He keeps his speed into the catch (DECISIONS.md, "Receivers keep their speed into the catch",
    // 2026-11-15, designed, display only): when the bend from there would have him brake below
    // continuePace x the speed he has, he stays on his template a little longer and eases into the
    // ball. Never a reversal: a later leave point counts only while the catch is still ahead of him
    // (his turn to it at most fillet.sharpDeg, so the rounded fillet applies), the bend's pace is at
    // most routePace x his top, within his acceleration (he arrives at catch time, with the ball) and
    // within natural.lateralAccel through the turn as drawn (measured on the built keys). The lead
    // point stays on the field: the lead along his heading is shortened, never bent. The catch point
    // and the throw stay as they are.
    const vOf = (i: number): number => dist(tr[i] as Key, tr[Math.max(0, i - 1)] as Key) / step;
    const leadPts = (i: number, lead0: number): Pt[] => {
      const q = tr[i] as Key;
      const pq = tr[Math.max(0, i - 1)] as Key;
      const h = dist(pq, q);
      if (h < 1e-6 || dist(q, c) <= 0.5) return [q, c];
      const ux = (q.x - pq.x) / h;
      const uy = (q.y - pq.y) / h;
      // The longest lead along his heading that stays inside the sideline margins and the end line.
      let lead = lead0;
      const lo = M.sidelineMarginYards;
      const hi = FIELD_WIDTH - M.sidelineMarginYards;
      if (ux > 1e-9) lead = Math.min(lead, Math.max(0, (hi - q.x) / ux));
      if (ux < -1e-9) lead = Math.min(lead, Math.max(0, (lo - q.x) / ux));
      if (uy > 1e-9) lead = Math.min(lead, Math.max(0, (bounds.maxY - q.y) / uy));
      if (lead <= 1e-3) return [q, c];
      return [q, { x: q.x + ux * lead, y: q.y + uy * lead }, c];
    };
    /** The most lateral acceleration (yd/s^2, screen clock) along built keys, from his heading's turn between keys. */
    const lateralOf = (ks: readonly Key[]): number => {
      let mx = 0;
      for (let j = 2; j < ks.length; j++) {
        const a0 = ks[j - 2] as Key;
        const a1 = ks[j - 1] as Key;
        const a2 = ks[j] as Key;
        const v1x = (a1.x - a0.x) / step;
        const v1y = (a1.y - a0.y) / step;
        const v2x = (a2.x - a1.x) / step;
        const v2y = (a2.y - a1.y) / step;
        const sp1 = Math.hypot(v1x, v1y);
        if (sp1 < 1e-9) continue;
        mx = Math.max(mx, (Math.abs(v1x * v2y - v1y * v2x) / sp1 / step) * 1e6);
      }
      return mx;
    };
    /** His turn at the lead point toward the catch, in degrees (0 when straight on). */
    const turnOf = (pts: readonly Pt[], i: number): number => {
      const q = tr[i] as Key;
      const pq = tr[Math.max(0, i - 1)] as Key;
      const a = pts.length > 2 ? (pts[1] as Pt) : q;
      const hx = q.x - pq.x;
      const hy = q.y - pq.y;
      const cx = c.x - a.x;
      const cy = c.y - a.y;
      const n = Math.hypot(hx, hy) * Math.hypot(cx, cy);
      return n < 1e-9 ? 0 : (Math.acos(Math.max(-1, Math.min(1, (hx * cx + hy * cy) / n))) * 180) / Math.PI;
    };
    const lenOf = (pts: readonly Pt[]): number => pts.reduce((s2, q, j) => (j === 0 ? 0 : s2 + dist(pts[j - 1] as Pt, q)), 0);
    let eased: Key[] | null = null;
    if (bestD !== Infinity && bendLen(li) / Math.max(1e-6, tc - (tr[li] as Key).t) < M.continuePace * vOf(li)) {
      for (let i = li + 1; i < tr.length; i++) {
        const q = tr[i] as Key;
        const tau = tc - q.t;
        if (q.t > tc - step) break;
        const pts = leadPts(i, leadOf(tr[Math.max(0, i - 1)] as Key, q, dist(q, c)));
        const turn = turnOf(pts, i);
        if (turn > M.fillet.sharpDeg) break;
        const need = lenOf(pts) / Math.max(1e-6, tau);
        if (need > M.routePace * top) break;
        const v = vOf(i);
        if (need < M.continuePace * v || Math.abs(need - v) / Math.max(1e-9, acc) > tau / 2) continue;
        const built = drive(pts, q.t, Math.max(q.t + step, tc), { accelMs: accOf(id), decelMs: M.decelMs, restStart: false, restEnd: false, keyMs: step, fillet: M.fillet, v0: speedAt(tr, q.t) });
        if (lateralOf(join([tr[Math.max(0, i - 1)] as Key], built)) / 1e6 <= latOf()) {
          li = i;
          eased = built;
          break;
        }
      }
    }
    const p0 = tr[li] as Key;
    const prev = tr[Math.max(0, li - 1)] as Key;
    const hd = dist(prev, p0);
    const dd = dist(p0, c);
    // The bend: on along his heading a little, then a rounded turn to the catch point, at one speed.
    const lead = leadOf(prev, p0, dd);
    const bendPts = hd > 1e-6 && dd > 0.5 && lead > 1e-3 ? [p0, { x: p0.x + ((p0.x - prev.x) / hd) * lead, y: p0.y + ((p0.y - prev.y) / hd) * lead }, c] : [p0, c];
    legStops.set(id, [p0.t]);
    const curve = eased ?? drive(bendPts, p0.t, Math.max(p0.t + step, tc), { accelMs: accOf(id), decelMs: M.decelMs, restStart: false, restEnd: false, keyMs: step, fillet: M.fillet, v0: speedAt(tr, p0.t) });
    return join(tr.slice(0, li + 1), curve);
  }

  /**
   * An incompletion on the screen clock (DECISIONS.md, "Incompletions drawn as misses", designed,
   * display only; spec amendment 2026-11-15, A2 to A5). The throw and the arrival are already
   * fixed by the aim point; here geometry picks where the ball lands at the arrival, never chance:
   * a break-up by the coverage defender who can get a hand there at his top speed or slower, else
   * an overthrow (he runs upfield), a throw behind him (he crosses) or a short throw (he sits or
   * comes back). Pushes the ball's flight, its roll or deflection, the jump to the spot, the label
   * and the breaker's converge. Nothing here changes a frame before the throw.
   */
  function resolveMiss(m: NonNullable<Plan["miss"]>): { kind: MissKind | null; at: Pt; breaker: { id: string; hand: Pt } | null; target: { id: string; throwT: number; catchT: number; reach: Pt; track: Key[]; drawn: Key[] } | null } {
    const MS = M.miss;
    const tThrow = T(m.throwT);
    const tCatch = T(m.catchT);
    const unitOf2 = (a: Pt, b: Pt): Pt | null => {
      const L = dist(a, b);
      return L < 1e-9 ? null : { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    };
    const plus = (a: Pt, u: Pt, n: number): Pt => ({ x: a.x + u.x * n, y: a.y + u.y * n });
    // Off the field: up to outYards past a sideline or an end line, clamped there.
    const out = (q: Pt): Pt => ({ x: Math.max(-MS.outYards, Math.min(FIELD_WIDTH + MS.outYards, q.x)), y: Math.max(-ctx.endZoneYards - MS.outYards, Math.min(endLine + MS.outYards, q.y)) });
    // The drawn miss, set by the rules below (a closure sets the break-up, so it is one object).
    const sel: { kind: MissKind | null; P: Pt; breaker: string | null; hand: Pt | null } = { kind: null, P: out(m.aim), breaker: null, hand: null };
    let reach: Pt = { x: 0, y: 0 };
    let track: Key[] = [];
    let drawnTarget: Key[] = [];
    let deflectFor: ((P: Pt, hand: Pt) => Pt) | null = null;
    if (m.id !== null) {
      const id = m.id;
      const coverOf = new Map<string, Key[]>();
      const cover = (x: OnFieldSlot & { index: number }): Key[] => {
        let ks = coverOf.get(x.id);
        if (ks === undefined) {
          const start = snapAt + startAfter(x.id);
          ks = defenseTrack(x, startOf.get(x.id) as Pt, start, liveEnd);
          coverOf.set(x.id, ks);
        }
        return ks;
      };
      // The ball until the throw, as it is drawn (the snap, then in the QB's hands), for the ring
      // that keeps marks off it: a breaker's spot at the throw is his drawn spot.
      const qk = qb !== undefined ? factKeys.get(qb) : undefined;
      const snapEnd = T(snapMs);
      const ballPre = (t: number): Pt => {
        if (t < snapEnd) {
          const f = Math.max(0, t - snapAt) / Math.max(1e-9, snapEnd - snapAt);
          return { x: ball0.x + (q0.x - ball0.x) * f, y: ball0.y + (q0.y - ball0.y) * f };
        }
        return qk !== undefined ? at(qk, t) : q0;
      };
      const stalkCover = (rid: string): readonly Key[] | undefined => {
        const st = stalkTarget(rid);
        const x = st === undefined ? undefined : slotOf.get(st.id);
        return x === undefined ? undefined : cover(x);
      };
      // His template track, the raw keys he is drawn from (a stalker shadows his man's coverage track).
      const md = missTargetDrawn(id, trackOf(id, snapAt, k, liveEnd, stalkCover).keys, tThrow, tCatch, ballPre);
      track = md.raw;
      drawnTarget = md.drawn;
      // Where he is drawn at the arrival (natural motion on: through the governor), so the gap at
      // the arrival is the drawn gap.
      const drawn = md.drawn;
      const T0 = at(drawn, tCatch);
      // How the ball would ride with him: the longest stretch (ms) it stays within holdYards of his
      // drawn track, reach included, from just after the throw to the whistle, flight, roll and rest.
      const tWhistle = T(plan.whistle);
      const tRolled = T(m.catchT + MS.rollMs);
      const Rr = Math.min(MS.reachMs, tCatch - tThrow);
      const holdRisk = (P: Pt, F: Pt): number => {
        const u = unitOf2(at(drawn, tCatch), P);
        const rch = u === null ? { x: 0, y: 0 } : plus({ x: 0, y: 0 }, u, Math.min(MS.reachYards, dist(at(drawn, tCatch), P)));
        let run = 0;
        let worst = 0;
        for (let t = tThrow + 100; t <= tWhistle - step + 1e-9; t += step) {
          const b = t <= tCatch ? { x: m.from.x + ((P.x - m.from.x) * (t - tThrow)) / (tCatch - tThrow), y: m.from.y + ((P.y - m.from.y) * (t - tThrow)) / (tCatch - tThrow) } : t <= tRolled ? { x: P.x + ((F.x - P.x) * (t - tCatch)) / Math.max(1e-6, tRolled - tCatch), y: P.y + ((F.y - P.y) * (t - tCatch)) / Math.max(1e-6, tRolled - tCatch) } : F;
          const f = Rr <= 0 ? 0 : Math.max(0, Math.min(1, t <= tCatch ? (t - (tCatch - Rr)) / Rr : (tCatch + Rr - t) / Rr));
          const wv = f * f * (3 - 2 * f);
          const q = at(drawn, t);
          const d0 = Math.hypot(q.x + rch.x * wv - b.x, q.y + rch.y * wv - b.y);
          run = d0 < HOLD_YARDS ? run + step : 0;
          worst = Math.max(worst, run);
        }
        return worst;
      };
      const rollTo = (P: Pt): Pt => out(plus(P, unitOf2(m.from, P) ?? { x: 0, y: 1 }, MS.rollYards));
      deflectFor = (P: Pt, hand: Pt): Pt => {
        // Across the line between the target and the breaker (P lies on it, so "away from their
        // midpoint" along it would fly into one of them): the side where the ball rides with nobody,
        // else the side the ball was flying.
        const reachedT = at(drawn, tCatch);
        const line = unitOf2(reachedT, hand);
        const fly = unitOf2(m.from, P) ?? { x: 0, y: 1 };
        if (line === null) return out(plus(P, fly, MS.breakup.deflectYards));
        const n = { x: -line.y, y: line.x };
        const side = n.x * fly.x + n.y * fly.y >= 0 ? 1 : -1;
        const A = out(plus(P, { x: n.x * side, y: n.y * side }, MS.breakup.deflectYards));
        const B = out(plus(P, { x: -n.x * side, y: -n.y * side }, MS.breakup.deflectYards));
        return holdRisk(P, A) < HOLD_MS || holdRisk(P, B) >= holdRisk(P, A) ? A : B;
      };
      const v = velocity(drawn, tCatch, step);
      const vRaw = Math.hypot(v.x, v.y) * 1000 * k;
      const heading: Pt = vRaw > 1e-9 ? { x: v.x / Math.hypot(v.x, v.y), y: v.y / Math.hypot(v.x, v.y) } : { x: 0, y: 1 };
      // The breakers: non-rushing CBs, safeties and linebackers the event doesn't name (A3): no
      // participant, fouler or standout, so nobody whose number or ring shows is drawn breaking it up.
      const shown = new Set<string>([...named, ...(parts.foulers ?? []), ...(tackler !== null ? [tackler] : []), ...(star !== undefined ? [star.player] : [])]);
      const cands = defSlots
        .map((x) => slotOf.get(x.id) as OnFieldSlot & { index: number })
        .filter((x) => (x.position === "CB" || x.position === "S" || x.position === "LB") && !shown.has(x.id) && !coverPlan(x, startOf.get(x.id) as Pt).rusher);
      const dt = Math.max(1, tCatch - tThrow);
      const breakupWith = (x: OnFieldSlot & { index: number }): { P: Pt; hand: Pt; pace: number } => {
        const S = at(ringFix(cover(x), ballPre, ring, snapWindowEnd, tThrow, "radial", 1), tThrow);
        const u = unitOf2(T0, S) ?? { x: 0, y: 1 };
        const p = out(plus(T0, u, MS.breakup.gapYards));
        // His hand at handYards from the ball on his side of it, never on top of it.
        const h = plus(p, unitOf2(p, S) ?? u, MS.breakup.handYards);
        const D = dist(S, h);
        const top = (topOf(x.id) / k) / 1000;
        const pace = D / (Math.max(1, dt - accOf(x.id) / 2) * top);
        return { P: p, hand: h, pace };
      };
      let best: { x: OnFieldSlot & { index: number }; P: Pt; hand: Pt; pace: number } | null = null;
      for (const x of cands) {
        const b = breakupWith(x);
        if (best === null || b.pace < best.pace - 1e-9) best = { x, ...b };
      }
      const force = ctx.forceMiss;
      const useBreakup = (b: NonNullable<typeof best>): void => {
        sel.kind = "breakup";
        sel.P = b.P;
        sel.hand = b.hand;
        sel.breaker = b.x.id;
      };
      if (best !== null && (force === "breakup" || (force === undefined && best.pace <= MS.breakup.maxPace))) useBreakup(best);
      else {
        const up = heading.y;
        const moving = vRaw >= MS.movingYps;
        const geo: MissKind = moving && up >= Math.SQRT1_2 ? "overthrow" : moving && up > -Math.SQRT1_2 ? "behind" : "short";
        const pOf = (kind: MissKind, extra = 0): Pt =>
          kind === "overthrow" ? out(plus(T0, heading, MS.overYards + extra)) : kind === "behind" ? out(plus(T0, heading, -(MS.behindYards + extra))) : out(plus(T0, unitOf2(T0, m.from) ?? { x: 0, y: -1 }, MS.shortYards + extra));
        if (force !== undefined && force !== "breakup") {
          sel.kind = force;
          sel.P = pOf(force);
        } else {
          // The clear check (A3): a defender this near a loose ball would read as a dropped
          // interception. Every defender counts, where he will be drawn at the arrival.
          const near = (P: Pt): { x: OnFieldSlot & { index: number }; d: number } | null => {
            let n: { x: OnFieldSlot & { index: number }; d: number } | null = null;
            // A point an earlier drawing of this play showed a defender near (timeline's redraw):
            // where he was actually drawn, not the estimate.
            const was = missSeen.find((w) => dist(w.P, P) < 1e-6 && slotOf.has(w.id));
            if (was !== undefined) return { x: slotOf.get(was.id) as OnFieldSlot & { index: number }, d: was.d };
            // A defender an earlier drawing showed near the ball counts where he was drawn, too: a
            // pursuer at the arrival is about there wherever nearby the ball lands.
            for (const w of missSeen) {
              const dd = dist(w.at, P);
              if (slotOf.has(w.id) && dd < MS.clearYards + MS.clearMarginYards && (n === null || dd < n.d)) n = { x: slotOf.get(w.id) as OnFieldSlot & { index: number }, d: dd };
            }
            for (const s0 of defSlots) {
              const x = slotOf.get(s0.id) as OnFieldSlot & { index: number };
              const dd = dist(predictAt(x, P, tThrow, tCatch, m.from, ballPre, cover), P);
              if (dd < MS.clearYards + MS.clearMarginYards && (n === null || dd < n.d)) n = { x, d: dd };
            }
            return n;
          };
          // A miss is drawn only where it reads as one: nobody within clearYards of P at the
          // arrival, and the ball never rides along with the target (R-C18) on its flight, roll or rest.
          // And the ball lands at least the smallest miss distance off where he is drawn (R-C16), which
          // a point clamped at an end line or sideline (outYards) may not be.
          const missMin = Math.min(MS.overYards, MS.behindYards, MS.shortYards);
          const farEnough = (P: Pt): boolean => dist(T0, P) >= missMin - 1e-9;
          const ok = (P: Pt): boolean => near(P) === null && farEnough(P) && holdRisk(P, rollTo(P)) < HOLD_MS;
          sel.kind = geo;
          sel.P = pOf(geo);
          const n0 = near(sel.P);
          // That defender breaks it up when he can: an eligible one, inside the break-up's pace limit.
          const redrawn = n0 !== null && cands.some((c) => c.id === n0.x.id) ? { x: n0.x, ...breakupWith(n0.x) } : null;
          if (redrawn !== null && redrawn.pace <= MS.breakup.maxPace) useBreakup(redrawn);
          else if (!ok(sel.P)) {
            // One who can't (a lineman, a rusher, or too far to get a hand there), or a ball that
            // would ride with him: the ball goes where it reads as a miss. The other kinds of miss
            // in order, then his kind's distance in other directions around him, nearest to his
            // kind's first, then farther off; else wherever it is clearest (engineer, 2026-11-15,
            // display only; an open reading in the spec amendment).
            const tries: { kind: MissKind; P: Pt }[] = [];
            for (const kk of [geo, ...(["overthrow", "behind", "short"] as const).filter((x) => x !== geo)]) tries.push({ kind: kk, P: pOf(kk) });
            const g0 = pOf(geo);
            const r0 = Math.max(1e-6, dist(T0, g0));
            const a0 = Math.atan2(g0.y - T0.y, g0.x - T0.x);
            for (const extra of [0, 1, 2])
              for (const deg of [30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180]) {
                const ang = a0 + (deg * Math.PI) / 180;
                tries.push({ kind: geo, P: out({ x: T0.x + Math.cos(ang) * (r0 + extra), y: T0.y + Math.sin(ang) * (r0 + extra) }) });
              }
            let pick: { kind: MissKind; P: Pt; score: number } | null = null;
            for (const t of tries) {
              const nn = near(t.P);
              const held = holdRisk(t.P, rollTo(t.P)) >= HOLD_MS || !farEnough(t.P);
              const score = (nn === null ? 100 : nn.d) - (held ? 1000 : 0);
              if (pick === null || score > pick.score + 1e-9) pick = { ...t, score };
              if (nn === null && !held) break;
            }
            if (pick !== null) {
              sel.kind = pick.kind;
              sel.P = pick.P;
            }
          }
        }
      }
      // A1: in the last reachMs he may reach toward the ball, at most reachYards off his track.
      const toBall = unitOf2(T0, sel.P);
      reach = toBall === null ? { x: 0, y: 0 } : plus({ x: 0, y: 0 }, toBall, Math.min(MS.reachYards, dist(T0, sel.P)));
    }
    const { kind, P, breaker, hand } = sel;
    // A4: the flight ends at P on the ground at the arrival, then a deflection (a break-up) or a roll.
    // For its first two keys it flies as if to the aim point A, whatever the kind of miss: every
    // mark's first key after the throw is then the same for each kind, so no frame up to the throw
    // can depend on it (R-C20). Two keys, not one: that first key (at most one key after the throw)
    // reads the ball half a key past itself for the ball's line of flight (natural motion's ring,
    // decorate), and a frame just before the throw is drawn between the key before it and that one.
    // The same parabola of size over the whole flight, in two pieces.
    const flightRaw = Math.max(1e-6, m.catchT - m.throwT);
    const d1 = Math.min(flightRaw / 2, (2 * step) / k);
    const f1 = d1 / flightRaw;
    const size = (f: number): number => (1 - f) * (1 - 2 * f) + 4 * f * (1 - f) * m.apex + f * (2 * f - 1) * MISS_GROUND;
    const E: Pt = { x: m.from.x + (m.aim.x - m.from.x) * f1, y: m.from.y + (m.aim.y - m.from.y) * f1 };
    plan.ball.push({ kind: "move", pts: [m.from, E], t0: m.throwT, t1: m.throwT + d1, apex: size(f1 / 2), endScale: size(f1), keepScale: true });
    plan.ball.push({ kind: "move", pts: [E, P], t0: m.throwT + d1, t1: m.catchT, startScale: size(f1), apex: size((1 + f1) / 2), endScale: MISS_GROUND, keepScale: true, joinPrev: true });
    const F: Pt = kind === "breakup" && hand !== null && deflectFor !== null ? (deflectFor as (P: Pt, hand: Pt) => Pt)(P, hand) : out(plus(P, unitOf2(m.from, P) ?? { x: 0, y: 1 }, MS.rollYards));
    const rolled = m.catchT + MS.rollMs;
    plan.ball.push({ kind: "move", pts: [P, F], t0: m.catchT, t1: rolled, apex: MISS_GROUND, endScale: MISS_GROUND, startScale: MISS_GROUND, keepScale: true });
    plan.labels.push({ text: "Incomplete", at: F, t: rolled, source: "incomplete" });
    // It rests there, on the ground beside its label, until the whistle; then it jumps to the spot.
    plan.ball.push({ kind: "move", pts: [F, F], t0: rolled, t1: plan.whistle, apex: MISS_GROUND, endScale: MISS_GROUND, startScale: MISS_GROUND });
    plan.ball.push({ kind: "jump", to: { x: MID_X, y: end?.spot ?? los }, t: plan.whistle });
    // A5: the breaker is exactly his unnamed self until the throw (he is built and governed as
    // one), then gets a hand to the ball and idles (naturalPass redraws him from the throw on).
    return { kind, at: P, breaker: breaker !== null && hand !== null ? { id: breaker, hand } : null, target: m.id === null ? null : { id: m.id, throwT: tThrow, catchT: tCatch, reach, track, drawn: drawnTarget } };
  }

  /**
   * The clear check's view of a defender at the arrival (A3), with the ball flying from `from` at
   * the throw to P at the arrival: his coverage track (a lineman his engaged step), then his pursuit
   * from his read, as build() draws him. An estimate: the governor may still move him a little,
   * which miss.clearMarginYards allows for.
   */
  function predictAt(x: OnFieldSlot & { index: number }, P: Pt, tThrow: number, tCatch: number, from: Pt, ballPre: (t: number) => Pt, cover: (x: OnFieldSlot & { index: number }) => Key[]): Pt {
    const set = startOf.get(x.id) as Pt;
    const start = snapAt + startAfter(x.id);
    const top = topOf(x.id) / k;
    const accel = accOf(x.id);
    const lineman = x.position === "DL" && contactFamily !== null;
    const keys = lineman ? linemanSteps(x, "X", defStart, set, start, top, accel, contactFamily as string).engaged : cover(x);
    const t0 = lineman ? releaseT : Math.max(start + 4 * step, read + reactOf(x.id));
    if (t0 >= tCatch - 1e-9) return at(keys, tCatch);
    // The ball as it will be drawn: the flight to P, then its roll on along the flight.
    const L = dist(from, P);
    const F = L < 1e-9 ? P : { x: P.x + ((P.x - from.x) / L) * M.miss.rollYards, y: P.y + ((P.y - from.y) / L) * M.miss.rollYards };
    const tRoll = tCatch + M.miss.rollMs * k;
    const fly = (t: number): Pt => (t <= tThrow ? ballPre(t) : t <= tCatch ? { x: from.x + ((P.x - from.x) * (t - tThrow)) / (tCatch - tThrow), y: from.y + ((P.y - from.y) * (t - tThrow)) / (tCatch - tThrow) } : t <= tRoll ? { x: P.x + ((F.x - P.x) * (t - tCatch)) / (tRoll - tCatch), y: P.y + ((F.y - P.y) * (t - tCatch)) / (tRoll - tCatch) } : F);
    const chase = pursue({ start: at(keys, t0), vel: velocity(keys, t0, step), t0, t1: tCatch, ball: fly, topSpeed: top, accelMs: accel, leadMs: M.pursuit.leadMs, turnDegPerS: M.pursuit.turnDegPerS, ring, brakeYards: M.pursuit.brakeYards, ...(lineman ? {} : { corridor: { half: M.pursuit.corridorHalfYards, ms: M.pursuit.corridorMs } }), keyMs: step, lateral: latOf() });
    // Nearer of the two: chasing as drawn, or still in his coverage or block (the drawn chase eases
    // in, and the ring in flight is smaller than the one pursuit keeps).
    const c = at(chase, tCatch);
    const still = at(keys, tCatch);
    return dist(c, P) <= dist(still, P) ? c : still;
  }

  /**
   * A1: the miss target's raw keys (his template track, kept off the ball until the throw) and how
   * he is drawn: natural motion's decorate with the options naturalPass gives a mark like him (no
   * anchors, no hand fight, his ring to the throw, the settle from the whistle), the ball before the
   * throw as it is drawn. naturalPass draws him from these keys, so P is placed off where he is.
   */
  function missTargetDrawn(id: string, track: readonly Key[], tThrow: number, tCatch: number, ballPre: (t: number) => Pt): { raw: Key[]; drawn: Key[] } {
    const set = startOf.get(id) as Pt;
    const R0 = 1.5;
    const inAir = (t: number): boolean => t >= tThrow - 1e-9 && t <= tCatch + 1e-9;
    const radius = (t: number): number => (inAir(t) ? Math.min(R0, NAT.flightRingYards) : R0);
    const raw = ringFix([...track], ballPre, R0, snapWindowEnd, tThrow, "radial", -1, radius);
    const keys = join([{ t: 0, ...set }, { t: snapAt, ...set }], raw).filter((q) => q.t <= liveEnd + 1e-9);
    if (!natural || live <= 0) return { raw, drawn: keys };
    const topS = topOf(id) / k;
    const accMs = accOf(id);
    const drawn = decorate(keys, {
      keyMs: step,
      from: snapAt,
      live: liveEnd,
      dep: tThrow,
      top: topS / 1000,
      anchors: [],
      blendMs: NAT.anchorBlendMs,
      arcs: [],
      wobble: { share: NAT.wobble.share, ...periodOf(id, "wobble", NAT.wobble.periodMinMs, NAT.wobble.periodMaxMs) },
      offset: null,
      idle: { yards: NAT.idle.swayYards, ...periodOf(id, "idle", NAT.idle.periodMinMs, NAT.idle.periodMaxMs), minYps: NAT.idle.minYps, rampMs: NAT.idle.rampMs, from: snapAt + startAfter(id) + accMs / 2, holds: [] },
      ring: { ball: ballPre, radius: Math.min(R0, NAT.flightRingYards), heldRadius: R0, from: snapWindowEnd, to: tThrow, sideways: false, flights: [[tThrow, Math.max(tThrow + 1, tCatch)]] },
      settleFrom: liveEnd,
      demanded: [],
    });
    return { raw, drawn };
  }

  /**
   * A1: the target's reach toward the ball, an offset of `r` blended in over the last reachMs
   * before the arrival and back out over the same time (never before the throw).
   */
  function withReach(tr: Key[], tThrow: number, tc: number, r: Pt): Key[] {
    const R = Math.min(M.miss.reachMs, tc - tThrow);
    if (Math.hypot(r.x, r.y) < 1e-9 || R <= 0) return tr;
    const a = tc - R;
    const b = Math.min(tc + R, liveEnd);
    const w = (t: number): number => {
      const f = Math.max(0, Math.min(1, t <= tc ? (t - a) / R : (tc + R - t) / R));
      return f * f * (3 - 2 * f);
    };
    const mid = [...grid(a, tc, step), ...grid(tc, b, step).slice(1)].map((t) => {
      const p = at(tr, t);
      const ww = w(t);
      return { t, x: p.x + r.x * ww, y: p.y + r.y * ww };
    });
    return join(tr.filter((q) => q.t < a - 1e-9), mid, tr.filter((q) => q.t > b + 1e-9));
  }

  /**
   * A5: the breaker from the throw on: from where he is drawn at the throw to his hand point at the
   * arrival (resolveMiss checked the pace), then a settle. Before the throw his keys are untouched.
   */
  function breakerRun(ks: readonly Key[], id: string, tThrow: number, tc: number, hand: Pt): Key[] {
    const p = at(ks, tThrow);
    const head = join(ks.filter((q) => q.t < tThrow - 1e-9), [{ t: tThrow, ...p }]);
    const run = drive([p, hand], tThrow, Math.max(tThrow + step, tc), { accelMs: accOf(id), decelMs: M.decelMs, restStart: false, restEnd: false, keyMs: step, v0: speedAt(ks, tThrow) });
    const keys = join(head, run);
    const last = keys[keys.length - 1] as Key;
    return last.t < liveEnd - step ? join(keys, sitAfter(keys, last, liveEnd, id)) : keys;
  }

  /** After his last leg a fact mark that settles (the QB after his run fake): a sit drift. */
  function sitAfter(keys: readonly Key[], last: Key, t1: number, id: string): Key[] {
    const prev = at(keys, last.t - step);
    const L = dist(prev, last);
    const dir = L < 1e-9 ? { x: 0, y: -1 } : { x: (last.x - prev.x) / L, y: (last.y - prev.y) / L };
    return sitDrift(last, dir, (M.sit.pace * topOf(id)) / k / 1000, sitYards(M.sit.maxYards), last.t, t1, step).slice(1);
  }

  /** The engine's tackler: from where he is to the ball at the whistle, arriving at rest. */
  function tacklerRun(from: Key, t1: number, v0?: number, to: Pt = finalBall): Key[] {
    if (from.t >= t1 - step) return [{ t: t1, ...to }];
    const mid: Pt = { x: (from.x + to.x) / 2 + (from.x <= to.x ? -1 : 1), y: (from.y + to.y) / 2 };
    return drive([from, mid, to], from.t, t1, { accelMs: 300, decelMs: M.convergeMs, restStart: false, restEnd: true, keyMs: step, fillet: M.fillet, ...(v0 === undefined ? {} : { v0 }) });
  }

  /** After a fact mark's last leg: he keeps moving gently toward the ball (nobody idle), clear of it. */
  function idleUntil(from: Key, t1: number, id: string, side: "O" | "X", pos: string): Key[] {
    if (id === plan.holder) return [{ t: t1, x: from.x, y: from.y }];
    void pos;
    return pursue({ start: from, vel: { x: 0, y: 0 }, t0: from.t, t1, ball: ballAt, topSpeed: (topOf(id) * 0.6) / k, accelMs: 400, leadMs: M.pursuit.leadMs, turnDegPerS: M.pursuit.turnDegPerS, ring: side === "X" ? ring : 2, brakeYards: M.pursuit.brakeYards, keyMs: step, lateral: latOf(), ringAt: flightR(side === "X" ? ring : 2) }).slice(1);
  }

  /** The ball, holder and tackler don't move in the settle. */
  function hold(keys: Key[]): Key[] {
    const p = at(keys, liveEnd);
    return join(keys.filter((q) => q.t <= liveEnd), [{ t: liveEnd, ...p }, { t: liveEnd + M.settleMs, ...p }]);
  }

  /**
   * NM8: the settle eases from his speed to rest at the end of the settle, on settleClock, within his
   * limits: a fast mark starts slowing before the whistle (never before his departure or his last
   * anchor), a slow one only after it. The ring is the governor's (natural off: the keys as they are).
   */
  function settleOf(keys: Key[], side: "O" | "X", id: string): Key[] {
    void side;
    const end = liveEnd + M.settleMs;
    const live0 = join(keys.filter((q) => q.t < liveEnd - 1e-9), [{ t: liveEnd, ...at(keys, liveEnd) }]);
    const topS = topOf(id) / k / 1000;
    const r = Math.min(1.5, speedAt(live0, liveEnd) / Math.max(1e-9, topS));
    // At least twice the settle, so the slow-down is under way at the whistle and a lineman's hand
    // fight can't speed him up after it; longer for a fast mark, so he stops within his limits.
    // A lineman still fighting at the whistle starts easing before it, so the fight can't speed him up
    // in the settle; anyone fast too, so he stops within a decelMs-like slow-down.
    // A kickoff return's block pair fights to the whistle too (KR5).
    const fighting = (contactFamily !== null && (slotOf.get(id)?.position === "OL" || slotOf.get(id)?.position === "DL")) || (krPlan?.pairs.some((p) => p.blocker === id || p.coverage === id) ?? false);
    const W = Math.max(fighting ? 2 * M.settleMs : M.settleMs, 1.1 * Math.max(1.5 * r * M.decelMs, Math.sqrt(6 * r * accOf(id) * NAT.smoothMs)));
    let S0 = Math.min(liveEnd, Math.max(end - W, depOf.get(id) ?? playDep, ...(anchorsOf.get(id) ?? []), snapAt));
    // A1: the miss target runs his template to the whistle; A5: the breaker gets his hand to the ball first.
    if (missOut?.target !== null && missOut?.target?.id === id) S0 = liveEnd;
    if (missOut?.breaker?.id === id && missOut.target !== null) S0 = Math.max(S0, Math.min(liveEnd, missOut.target.catchT + step));
    settleFromOf.set(id, S0);
    // The governor runs to the whistle; the settle's clock is applied to what it draws (naturalPass).
    return live0;
  }

  /** Turns limited to the lateral acceleration (NM6), on the screen clock. */
  function latOf(): number {
    return NAT.lateralAccel / 1e6 / k;
  }

  /**
   * NM7: the line's hand fight. Each DL is paired with the nearest free OL at the set (as M6 pairs
   * them); both get the same push and give along the pair's axis and the same shuffle across it, a
   * sum of two sines each from the OL's hash, ramped in from contact, so contact holds and the fight
   * averages to nothing: nobody wins. A DL leaves at his release with the offset he had. An unpaired
   * lineman fights on his own hash.
   */
  function handFight(): { offset: Map<string, (t: number) => Pt>; engaged: Map<string, { from: number; to: number; axis: Pt; partner: string | null }> } {
    const offset = new Map<string, (t: number) => Pt>();
    const engaged = new Map<string, { from: number; to: number; axis: Pt; partner: string | null }>();
    if (live <= 0) return { offset, engaged };
    const L = NAT.line;
    const dls = defSlots.filter((x) => x.position === "DL" && lineInfo.has(x.id)).map((x) => x.id);
    const ols = offSlots.filter((x) => x.position === "OL" && lineInfo.has(x.id)).map((x) => x.id);
    const pairOf = new Map([...pairPre].filter(([a, b]) => lineInfo.has(a) && lineInfo.has(b)));
    const releaseOf = (id: string): number => {
      if (slotOf.get(id)?.position !== "DL") return Infinity;
      const dep = depOf.get(id);
      if (dep !== undefined) return dep;
      return releaseT < liveEnd - 3 * step ? releaseT : Infinity;
    };
    const fight = (hashId: string, from: number, axis: Pt, pushYards: number = L.pushYards): ((t: number) => Pt) => {
      const w = [1, 2, 3, 4].map((n) => periodOf(hashId, `line${n}`, L.periodMinMs, L.periodMaxMs));
      const nrm = { x: -axis.y, y: axis.x };
      const sine = (n: number, t: number): number => Math.sin((2 * Math.PI * t) / (w[n] as { period: number }).period + (w[n] as { phase: number }).phase);
      return (t) => {
        if (t <= from) return { x: 0, y: 0 };
        const r = smoothstepT((t - from) / L.rampMs);
        const push = pushYards * (0.6 * sine(0, t) + 0.4 * sine(1, t)) * r;
        const shuffle = L.shuffleYards * (0.6 * sine(2, t) + 0.4 * sine(3, t)) * r;
        return { x: axis.x * push + nrm.x * shuffle, y: axis.y * push + nrm.y * shuffle };
      };
    };
    // Kickoff return blocks (KR5): the pair gets the linemen's hand fight from contact to the
    // whistle, the same offset for both, so contact holds and nobody is drawn winning.
    for (const p of krPlan?.pairs ?? []) {
      // From just before contact, as both slow into it, so neither stands still at the hit.
      // The shuffle across the pair only: a push along it doesn't average out over a short block (KR5).
      const f0 = fight(p.blocker, p.from - KR.blockEaseMs, p.axis, 0);
      // Held where it is two keys before the whistle: the settle then eases the pair's drift alone,
      // with no swing of the shuffle carried past the whistle (N6).
      const tf = liveEnd - 2 * step;
      const f = (t: number): Pt => f0(Math.min(t, tf));
      for (const m of [p.blocker, p.coverage]) {
        offset.set(m, f);
        engaged.set(m, { from: p.from, to: liveEnd, axis: p.axis, partner: m === p.blocker ? p.coverage : p.blocker });
      }
    }
    const done = new Set<string>();
    for (const id of [...ols, ...dls]) {
      if (done.has(id)) continue;
      const mate = pairOf.get(id);
      const ol = slotOf.get(id)?.position === "OL" ? id : mate;
      const dl = slotOf.get(id)?.position === "DL" ? id : mate;
      const a = lineInfo.get(id) as { contact: Pt; engageEnd: number };
      const b = mate === undefined ? undefined : lineInfo.get(mate);
      // From the first contact in the pair: both get the same offset, so their distance is unchanged.
      const from = Math.min(a.engageEnd, b?.engageEnd ?? Infinity);
      let axis: Pt = { x: 0, y: slotOf.get(id)?.side === "O" ? 1 : -1 };
      if (ol !== undefined && dl !== undefined) {
        const co = (lineInfo.get(ol) as { contact: Pt }).contact;
        const cd = (lineInfo.get(dl) as { contact: Pt }).contact;
        const dd = dist(co, cd);
        if (dd > 1e-6) axis = { x: (cd.x - co.x) / dd, y: (cd.y - co.y) / dd };
      }
      const f = fight(ol ?? id, from, axis);
      for (const m of [id, ...(mate === undefined ? [] : [mate])]) {
        const rel = releaseOf(m);
        // At the DL's release the fight stops for both: it fades out over rampMs from where it was.
        const r0 = Math.min(rel, mate === undefined ? Infinity : releaseOf(m === id ? mate : id));
        offset.set(m, Number.isFinite(r0) ? (t) => { const q = f(Math.min(t, r0)); const w = t <= r0 ? 1 : 1 - smoothstepT((t - r0) / NAT.line.rampMs); return { x: q.x * w, y: q.y * w }; } : f);
        // Engaged: from when both are in contact (the fight itself starts at the first contact).
        engaged.set(m, { from: Math.max(a.engageEnd, b?.engageEnd ?? -Infinity), to: Math.min(liveEnd, r0), axis, partner: m === id ? (mate ?? null) : id });
        done.add(m);
      }
    }
    return { offset, engaged };
  }

  /**
   * Natural motion on every mark's built keys (decorate: the wobble, hand fight, sway and steering
   * clear of a ball in the air, blended out before each anchor), then the settle. The ball's
   * holders go first so the ball rides their final keys (NM3) and everyone else keeps clear of the
   * ball as drawn. With ctx.natural false the keys are the built ones (States), same records.
   */
  function naturalPass(raw: readonly TLMark[]): { marks: TLMark[]; ball: Key[] } {
    let ballG: Key[] = [...ball];
    if (live <= 0) return { marks: [...raw], ball: ballG };
    const end = liveEnd + M.settleMs;
    const { offset, engaged } = handFight();
    const inHold = (id: string, t: number): boolean => (holdsOf.get(id) ?? []).some(([a, b]) => t >= a - 1e-9 && t <= b + 1e-9);
    const holdMark = (id: string): boolean => id === plan.holder || id === tackler || id === sacker || (sacker !== null && id === parts.passer);
    const ringBall = (t: number): Pt => (t < liveEnd ? at(ballG, Math.min(t, liveEnd - 1)) : at(ballG, liveEnd));
    const firstHold = (id: string): number => Math.min(...(holdsOf.get(id) ?? []).map((h) => h[0]));
    const order = raw.map((m, i) => ({ m, i, h: holdsOf.has(m.playerId) ? firstHold(m.playerId) : Infinity })).sort((a, b) => a.h - b.h || a.i - b.i);
    const out: TLMark[] = new Array<TLMark>(raw.length);
    for (const { m, i } of order) {
      const id = m.playerId;
      const topS = topOf(id) / k;
      const accMs = accOf(id);
      const factMark = depOf.has(id) ? false : m.fact;
      // A fact mark is factual from the snap, the QB until he gives the ball up; a named one leaves
      // his unnamed track at his departure; an unnamed one "leaves" at the play's read.
      const qbHold = slotOf.get(id)?.position === "QB" && holdsOf.has(id) ? Math.min(...(holdsOf.get(id) ?? []).map((h) => h[1])) : undefined;
      const dep = depOf.get(id) ?? (qbHold !== undefined ? qbHold : factMark ? snapAt : playDep);
      const anchorTs = [...(anchorsOf.get(id) ?? [])].sort((a, b) => a - b);
      // Designed arcs, from the raw keys' flags, a measuring window wide either side.
      const arcs: [number, number][] = [];
      for (const q of m.keys)
        if (q.arc === true) {
          const last = arcs[arcs.length - 1];
          if (last !== undefined && q.t - 2 * step <= last[1]) last[1] = q.t + 2 * step;
          else arcs.push([q.t - 2 * step, q.t + 2 * step]);
        }
      // Anchor-demanded legs (NM3): from one anchor (or the departure) to the next, a mean speed over 1.15 x top.
      const demanded: { t0: number; t1: number; mean: number }[] = [];
      const stops = [...new Set([...(dep > snapAt && dep < liveEnd ? [dep] : []), ...anchorTs, ...(legStops.get(id) ?? [])])].sort((a, b) => a - b);
      for (let j = 1; j < stops.length; j++) {
        const a = stops[j - 1] as number;
        const b = stops[j] as number;
        if (b - a < step) continue;
        let L = 0;
        let prev = at(m.keys, a);
        for (let t = a + step; t < b + step - 1e-9; t += step) {
          const q = at(m.keys, Math.min(t, b));
          L += dist(prev, q);
          prev = q;
        }
        const mean = (L / (b - a)) * 1000;
        if (mean > 1.15 * topS) demanded.push({ t0: a, t1: b, mean });
      }
      const hm = holdMark(id);
      const S0 = hm ? Infinity : (settleFromOf.get(id) ?? Infinity);
      // No sway on a kneel or spike; the tackler, the sacker and the sacked QB stop swaying from their
      // departure (before it each is his unnamed self, sway included: R-C9).
      const exemptIdle = plan.fixed !== null;
      const eng = engaged.get(id);
      const noSway: [number, number][] = [...(holdsOf.get(id) ?? [])];
      // Engaged, the hand fight moves him; once the fight has faded out the idle sway may.
      if (eng !== undefined) noSway.push([eng.from - 4 * step, eng.to + NAT.line.rampMs]);
      if (id === tackler || id === sacker || (sacker !== null && id === parts.passer)) noSway.push([dep, end]);
      // QD2 and R-C28 (code review 2026-11-16): after a plant throw he finishes his stop at his drop
      // point with no sway through his follow-through, and on a pass or a sack the QB never wobbles while
      // he holds the ball, so the frames before a throw don't depend on when it comes and his walk to a
      // sack stays within his top (R-C30).
      const qbHolds = (kind === "pass" || kind === "sack") && (id === qb || id === parts.passer) ? (holdsOf.get(id) ?? []) : [];
      // The gap runs to the end of his follow-through (his last leg), so no sway steps him back toward
      // his drop point on the way (R-C28 d).
      const ftEnd = pl !== null && id === qb ? Math.max(pl.gapEnd, ...(plan.legs.get(id) ?? []).map((l) => l.t1)) : 0;
      const gap: [number, number][] = pl !== null && id === qb ? [[T(pl.throwT), T(ftEnd)]] : [];
      noSway.push(...gap);
      const rg = ringOf.get(id);
      const nat: MarkNat = {
        top: topOf(id),
        accelMs: accMs,
        reactionMs: reactOf(id),
        startSpreadMs: startSpread(id),
        k,
        dep,
        anchors: anchorTs.map((t) => ({ t, ...at(m.keys, t) })),
        arcs,
        demanded,
        settleFrom: S0,
        ...(eng === undefined ? {} : { engaged: eng }),
      };
      // NM8: the settle on the drawn keys: the holder, tackler and sacker stand still; everyone else
      // runs on settleClock from S0, so he eases to rest and never speeds up.
      const settled = (ks: readonly Key[]): Key[] => {
        if (hm || !Number.isFinite(S0)) return hold([...ks]);
        const w = settleWarp(ks.filter((q) => q.t <= liveEnd + 1e-9), S0, end, step, liveEnd, M.settleMaxYards);
        if (rg === undefined) return w;
        // Contract 3 holds while he slows before the whistle, the ball still moving: off the ring if need be.
        return w.map((q) => {
          if (q.t < S0 || q.t >= liveEnd) return q;
          const b = ringBall(q.t);
          const R = inFlight(q.t) ? Math.min(rg.R, NAT.flightRingYards) : rg.R;
          const d = dist(q, b);
          if (d >= R) return q;
          if (rg.sideways) {
            const dy = q.y - b.y;
            if (Math.abs(dy) >= R) return q;
            const side = q.x === b.x ? (q.x <= MID_X ? -1 : 1) : Math.sign(q.x - b.x);
            return { ...q, x: clampX(b.x + side * Math.sqrt(R * R - dy * dy)) };
          }
          const u = d < 1e-9 ? { x: q.x <= b.x ? -1 : 1, y: 0 } : { x: (q.x - b.x) / d, y: (q.y - b.y) / d };
          return { ...q, x: clampX(b.x + u.x * R), y: b.y + u.y * R };
        });
      };
      // An incompletion (A1, A5): the target is drawn from his decorated template track (resolveMiss
      // placed the ball off it) with his reach added on top; the breaker is his decorated unnamed self
      // up to the throw, then runs to his hand point and idles.
      const mt = missOut?.target ?? null;
      if (mt !== null && mt.id === id) {
        out[i] = { ...m, keys: settled(withReach(mt.drawn, mt.throwT, mt.catchT, mt.reach)), nat };
        continue;
      }
      const brk = missOut?.breaker ?? null;
      const breakerHere = brk !== null && mt !== null && brk.id === id;
      const asBreaker = (ks: readonly Key[]): TLMark => ({ ...m, fact: true, keys: settleWarp(breakerRun(ks, id, (mt as { throwT: number }).throwT, (mt as { catchT: number }).catchT, (brk as { hand: Pt }).hand).filter((q) => q.t <= liveEnd + 1e-9), S0, end, step), nat });
      if (!natural) {
        out[i] = breakerHere ? asBreaker(m.keys) : { ...m, keys: settled(m.keys), nat };
        continue;
      }
      const g = decorate(m.keys.filter((q) => q.t <= liveEnd + 1e-9), {
        keyMs: step,
        from: snapAt,
        live: liveEnd,
        dep,
        top: topS / 1000,
        anchors: anchorTs,
        blendMs: NAT.anchorBlendMs,
        arcs: [...arcs, ...qbHolds, ...gap],
        wobble: { share: NAT.wobble.share, ...periodOf(id, "wobble", NAT.wobble.periodMinMs, NAT.wobble.periodMaxMs) },
        offset: offset.get(id) ?? null,
        idle: exemptIdle ? null : { yards: NAT.idle.swayYards, ...periodOf(id, "idle", NAT.idle.periodMinMs, NAT.idle.periodMaxMs), minYps: NAT.idle.minYps, rampMs: NAT.idle.rampMs, from: snapAt + startAfter(id) + accMs / 2, holds: noSway },
        ring: rg === undefined ? null : { ball: ringBall, radius: Math.min(rg.R, NAT.flightRingYards), heldRadius: rg.R, from: snapWindowEnd, to: rg.to, sideways: rg.sideways, flights },
        settleFrom: S0,
        demanded: demanded.map((d) => [d.t0, d.t1] as const),
      });
      // KR6: the kick returner's drawn keys keep his cut arcs' flags (only his: every other mark is drawn as before).
      const arcT = id === krReturner ? new Set(m.keys.filter((q) => q.arc === true).map((q) => Math.round(q.t * 1000))) : null;
      const gk = arcT === null || arcT.size === 0 ? g : g.map((q) => (arcT.has(Math.round(q.t * 1000)) ? { ...q, arc: true as const } : q));
      out[i] = breakerHere ? asBreaker(gk) : { ...m, keys: settled(gk), nat };
      // The ball rides its holder's final keys.
      if (holdsOf.has(id)) ballG = ballG.map((q) => (inHold(id, q.t) ? { t: q.t, ...at(g, q.t) } : q));
    }
    return { marks: out, ball: ballG };
  }

  build(defSlots, "X", defStart, defHuddle, defMarks);
  build(offSlots, "O", offStart, offHuddle, offMarks);
  const { marks, ball: ballOut } = naturalPass([...offMarks, ...defMarks]);

  // ------------------------------------------------------------ labels, flags, preview
  const labels: TLLabel[] = plan.labels.map((l) => ({ ...l, t: T(l.t) }));
  const off = before.possession;
  const def = off === "home" ? "away" : "home";
  const gOff = after.score[off] - before.score[off];
  const gDef = after.score[def] - before.score[def];
  if (play.kind !== "fieldGoal" && play.kind !== "extraPoint") {
    if (play.kind === "twoPoint") labels.push({ text: gOff === 2 ? "Two-point try good" : "No good", at: finalBall, t: liveEnd, source: "after.score" });
    else if (gOff >= 6 || gDef >= 6) labels.push({ text: "Touchdown", at: finalBall, t: liveEnd, source: "after.score" });
    else if (gDef === 2 && after.safetyKick) labels.push({ text: "Safety", at: finalBall, t: liveEnd, source: "after.score" });
  }
  if (star !== undefined) labels.push({ text: "Standout", at: startOf.get(star.player) ?? finalBall, t: liveEnd, source: "standout" });
  const flags: TLLabel[] = (play.fouls ?? []).map((f) => ({ text: "Flag", at: { x: MID_X + 4, y: f.spot ?? los }, t: play.kind === "noPlay" ? snapAt : liveEnd, source: "fouls" }));

  let preview: Art | null = null;
  if (human === "offense" && unit.offense.group === "offense" && unit.family !== "clock") preview = offenseArt(unit.offense.name, unit.leaf, offSlots, templates, los, ctx.pxPerYard, bounds);
  else if (human === "defense" && preset !== null) preview = defenseArt(pkg, preset, defSlots, templates, los, ctx.pxPerYard, bounds);

  const scored = labels.some((l) => l.source === "after.score" || l.source === "standout") || (play.kind === "fieldGoal" && play.good);
  const caught = labels.some((l) => l.source === "turnover" || l.source === "participants.fumbleRecoverer") || tackler !== null || kind === "pass";
  const holdMs = scored ? tm.scoreHoldMs : caught ? tm.holdMs : 0;
  const settleMs = live > 0 ? M.settleMs : 0;
  const involved = [...new Set([...named, ...(parts.foulers ?? [])])].filter((id) => startOf.has(id));
  const rings = [plan.holder, play.kind === "noPlay" ? (parts.foulers?.[0] ?? null) : null, star?.player ?? null].filter((x): x is string => x !== null && startOf.has(x));
  const paths: TLPath[] = [];
  for (const sg of plan.ball) {
    if (sg.kind !== "move" || !(sg.apex > 1 || sg.joinPrev === true)) continue;
    const prev = paths[paths.length - 1];
    // A flight in two pieces (an incompletion's) is one path.
    if (sg.joinPrev === true && prev !== undefined) paths[paths.length - 1] = { ...prev, points: [...prev.points, ...sg.pts.slice(1)], end: T(sg.t1) };
    else paths.push({ kind: "ball", points: sg.pts, start: T(sg.t0), end: T(sg.t1) });
  }
  scale.sort((a, b) => a.t - b.t);

  return {
    los,
    firstDown: before.phase === "scrimmage" && !before.goalToGo ? Math.min(100, before.spot + before.distance) : null,
    lineUpMs,
    runoffMs: runoffMs === 0 ? 0 : lineUpMs,
    runoff: input.runoffSeconds > 0 ? { from: before.clock + input.runoffSeconds, to: before.clock } : null,
    setAt,
    snapAt,
    liveEnd,
    settleMs,
    holdMs,
    total: liveEnd + Math.max(holdMs, settleMs),
    marks,
    ball: ballOut,
    ballScale: scale,
    paths,
    labels,
    flags,
    holder: plan.holder,
    tackler,
    involved,
    rings,
    snapWindowEnd,
    read,
    preview,
    ...(play.kind === "punt" || play.kind === "kickoff" || play.kind === "onsideKick" ? { kickTrail: { fadeMs: M.kickTrail.fadeMs } } : {}),
    warnings: [...warnings],
    ...(krReturner === null || krPlan === null ? {} : { kickReturn: { returner: krReturner, blockers: krPlan.blockers, coverage: krPlan.coverage, blocks: krPlan.pairs.map((p) => ({ blocker: p.blocker, coverage: p.coverage, from: p.from })), cutSide: (krCut as { readonly side: -1 | 1 } | null)?.side ?? null, hashSide: krHashSide(krReturner) } }),
    ...(missOut === null ? {} : { miss: { kind: missOut.kind, breaker: missOut.breaker?.id ?? null, at: missOut.at, catchT: missOut.target?.catchT ?? T((plan.miss as NonNullable<Plan["miss"]>).catchT), throwT: missOut.target?.throwT ?? T((plan.miss as NonNullable<Plan["miss"]>).throwT) } }),
  };
}

/**
 * Keys in time order with no two at one time, except a jump (a respot), kept as a pair: the key
 * before it moves back 1 microsecond, so at the jump's own time the ball is already on its new spot.
 */
function dedupe(keys: readonly Key[], jumps: ReadonlySet<number> = new Set()): Key[] {
  const out: Key[] = [];
  for (const k of keys) {
    const last = out[out.length - 1];
    if (last !== undefined && Math.abs(k.t - last.t) < 1e-9) {
      // A respot is kept as a pair however short, so the ball ends its last move where that move ends.
      if (Math.hypot(k.x - last.x, k.y - last.y) > (jumps.has(k.t) ? 1e-6 : 0.5)) {
        out[out.length - 1] = { ...last, t: last.t - 1e-3 };
        out.push(k);
      } else out[out.length - 1] = k;
      continue;
    }
    out.push(k);
  }
  return out;
}

/** Ball size at t (1 at rest). */
export function scaleAt(s: readonly ScaleKey[], t: number): number {
  let last = 1;
  for (let i = 0; i < s.length; i++) {
    const k = s[i] as ScaleKey;
    if (k.t > t) {
      const p = s[i - 1];
      if (p === undefined) return 1;
      const f = (t - p.t) / (k.t - p.t);
      return p.s + (k.s - p.s) * f;
    }
    last = k.s;
  }
  return last;
}

/** The PlayResult kinds the timeline draws, for tests. */
export type DrawnKind = PlayResult["kind"];
