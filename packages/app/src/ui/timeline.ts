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
import { at, clampX, cruise, drive, FIELD_WIDTH, follow, grid, join, MID_X, pursue, ringFix, runRoute, settle, sitDrift, velocity, type Key, type Pt } from "./motion";
import type { Motion, Route, Templates } from "./templates";

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
   * Data problems met while building (States: a mark that resolves no template), each naming the
   * file and key. timeline() stays pure; the caller logs them. Absent on frames built elsewhere.
   */
  readonly warnings?: readonly string[];
}

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
  readonly drift?: { readonly v0: number; readonly L: number };
}

type BallSeg =
  | { readonly kind: "hold"; readonly id: string; readonly t0: number; readonly t1: number }
  | { readonly kind: "move"; readonly pts: readonly Pt[]; readonly t0: number; readonly t1: number; readonly apex: number; readonly endScale: number }
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
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

export function timeline(input: TimelineInput, templates: Templates, ctx: TimelineCtx): Timeline {
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
    const x = ob ? (side === "left" ? 0 : side === "right" ? FIELD_WIDTH : fromX < MID_X ? 0 : FIELD_WIDTH) : spotX(side);
    return { x, y };
  };
  const speedOf = (id: string | undefined): number => M.speed[slotOf.get(id ?? "")?.position ?? "WR"] ?? 13;
  const travel = (a: Pt, b: Pt, id: string | undefined): number => (dist(a, b) / speedOf(id)) * 1000 + M.decelMs / 2;
  const startMs = (id: string): number => {
    const s = slotOf.get(id);
    const base = M.startMs[s?.position ?? "WR"] ?? 0;
    // Uncapped here: every use is a fixedStart leg, which the leg builder caps at maxStartMs (one cap per path).
    return base + ((s?.index ?? 0) % 3) * M.slotOffsetMs;
  };
  const recoveredText = (id: string | undefined): string => {
    const n = id === undefined ? undefined : ctx.numbers[id];
    return n === undefined ? "Fumble" : `Fumble, recovered by #${n}`;
  };
  const fumbled = d.class === "fumble" || d.class === "fumbleCatch" || ("turnover" in play && play.turnover === "fumble");
  const plan: Plan = { whistle: 0, fixed: null, read: 0, legs: new Map(), ball: [], holder: null, labels: [], releaseAt: 0, target: null, sitAfter: new Set(), converge: new Map() };
  /**
   * A fumble recoverer (R9): his unnamed track until the R-C9 `read` (the handoff or catch, the drop's
   * end on a sack), then on to the ball. He gets there no sooner than `loose` (when the ball is
   * free) and no faster than his top speed: returns when he recovers it. Until then the ball stays
   * loose near the fumble spot. A player with a path already (the sacker) goes on from its end.
   */
  const recover = (id: string, read: number, loose: number, to: Pt): number => {
    const pos = slotOf.get(id)?.position ?? "LB";
    const time = (from: Pt): number => (dist(from, to) / speedOf(id)) * 1000 + (M.accelMs[pos] ?? 300) / 2 + M.decelMs / 2;
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
  const carry = (carrier: string | undefined, pts: Pt[], t0: number, ballT0: number = t0, read: number = t0): void => {
    const last = pts[pts.length - 1] as Pt;
    const e = endPt(last.x);
    const route = [...pts, ...obPath(last, e)];
    const t1 = t0 + (pathLen(route) / speedOf(carrier ?? qb)) * 1000 + M.convergeMs;
    if (fumbled) {
      const loose = d.fumbleSpot === undefined ? e : { x: e.x, y: d.fumbleSpot };
      const toLoose = [...pts, ...obPath(last, loose)];
      const tl = t1 - 350;
      const rec = parts.fumbleRecoverer;
      leg(carrier, { pts: toLoose, t0, t1: tl, restStart: t0 === 0, restEnd: true });
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
    leg(carrier, { pts: route, t0, t1, restStart: t0 === 0, restEnd: true });
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
    const top = (M.speed[pos] ?? 10) / kk;
    const t0 = origin + Math.min(M.maxStartMs, (M.startMs[pos] ?? 0) + (s.index % 3) * M.slotOffsetMs);
    let route = routeFor(s);
    if (route === undefined) {
      // States (unreachable in shipped data): the old check-down to the flat, and a warning naming
      // the file and key, which the caller logs.
      if (!quiet) warnings.add(`data/ui/templates.json: routes.${unit.routes} has no template for ${s.slot} (${routeChain(roles.get(s.slot), pos).join(", ")}); drawn as a check-down`);
      route = { pts: [{ p: [-3, 2], pauseMs: 0, pace: 1 }], finish: "sit", axis: "in" };
    }
    const wps = place(set, route);
    const endPace = route.finish === "continue" ? M.continuePace : M.sit.pace;
    const r = runRoute(set, wps, t0, { top, pace: M.routePace, endPace, accelMs: M.accelMs[pos] ?? 300, decelMs: M.decelMs, keyMs: M.keyMs, fillet: M.fillet, pause: M.sit });
    const head: Key[] = join([{ t: origin, ...set }, { t: t0, ...set }], r.keys);
    if (horizon <= r.end) return { keys: underBackLine(head, set), finish: route.finish, releaseEnd: r.end };
    let tail: Key[];
    const stalkKeys = route.finish === "stalk" ? stalkOf?.(id) : undefined;
    // A continue finish keeps on at continuePace x top, reaching it at his own acceleration if he arrived slower.
    if (route.finish === "continue") tail = cruise(r.at, r.dir, r.speed, r.end, horizon, { margin: M.sidelineMarginYards, maxY: bounds.maxY, turnDegPerS: M.pursuit.turnDegPerS, sitYards: M.sit.maxYards, keyMs: M.keyMs, vTarget: (M.continuePace * top) / 1000, accel: top / 1000 / Math.max(1, M.accelMs[pos] ?? 300) });
    else if (stalkKeys !== undefined && stalkKeys.length > 0) {
      // Shadow the defender at contact distance, on the side he released to, a reaction lag behind.
      const D0 = at(stalkKeys, r.end);
      const off = Math.hypot(r.at.x - D0.x, r.at.y - D0.y) < 1e-6 ? { x: 0, y: -1 } : { x: (r.at.x - D0.x) / Math.hypot(r.at.x - D0.x, r.at.y - D0.y), y: (r.at.y - D0.y) / Math.hypot(r.at.x - D0.x, r.at.y - D0.y) };
      const lag = M.stalk.lagMs;
      tail = follow({ start: r.at, vel: { x: r.dir.x * r.speed, y: r.dir.y * r.speed }, t0: r.end, t1: horizon, target: (t) => { const q = at(stalkKeys, t - lag); return { x: q.x + off.x * M.stalk.contactYards, y: q.y + off.y * M.stalk.contactYards }; }, top, accelMs: M.accelMs[pos] ?? 300, brakeYards: M.pursuit.brakeYards, keyMs: M.keyMs, lock: { to: (t) => at(stalkKeys, t), within: M.stalk.contactYards + ((M.speed[slotOf.get(stalkTarget(id)?.id ?? "")?.position ?? "CB"] ?? 10) * M.stalk.lagMs) / 1000 } });
    } else {
      const sd = settleDir(r.at, r.dir, r.speed, set, top);
      tail = sitDrift(r.at, sd.dir, sd.v0, route.finish === "block" ? M.sit.blockMaxYards : M.sit.maxYards, r.end, horizon, M.keyMs);
    }
    return { keys: underBackLine(join(head, tail), set), finish: route.finish, releaseEnd: r.end };
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
  const settleLeg = (id: string | undefined, from: Pt, toward: Pt, t0: number, t1: number, maxYards: number): Pt => {
    if (!known(id) || t1 <= t0 + 1e-6) return from;
    const v0 = (M.sit.pace * speedOf(id)) / 1000;
    const D = dist(from, toward);
    if (D < 1e-9 || maxYards <= 0) return from;
    const tau = t1 - t0;
    const sAt = (maxYards * v0 * tau) / (maxYards + v0 * tau);
    leg(id, { pts: [from, toward], t0, t1, restStart: false, restEnd: false, drift: { v0, L: maxYards } });
    return { x: from.x + ((toward.x - from.x) / D) * sAt, y: from.y + ((toward.y - from.y) / D) * sAt };
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
        const fake = unit.leaf === "playAction" && qWps.length > 1 ? (qWps[0] as FieldWp) : undefined;
        if (fake !== undefined) {
          // The fake, the hold of the ball out (its pause), then the boot.
          const leave = Math.min(drop - 2 * M.keyMs, M.fakeMs + fake.pauseMs);
          const boot = qWps.slice(1).map((w) => w.p);
          leg(qb, { pts: [q0, fake.p], t0: 0, t1: M.fakeMs, restStart: true, restEnd: true, fixedStart: true });
          const held = settleLeg(qb, fake.p, boot[0] as Pt, M.fakeMs, leave, Math.min(M.sit.maxYards, M.sit.pauseLegShare * dist(fake.p, boot[0] as Pt)));
          leg(qb, { pts: [held, ...boot], t0: leave, t1: drop, restStart: true, restEnd: true });
        } else leg(qb, { pts: [q0, ...qWps.map((w) => w.p)], t0: 0, t1: drop, restStart: true, restEnd: true, fixedStart: true });
        plan.ball.push({ kind: "hold", id: qb, t0: snapMs, t1: drop });
      }
      const px0 = spotX(d.passLocation);
      const flight = (to: Pt): number => Math.max(M.flight.minMs, Math.min(M.flight.maxMs, M.flight.baseMs + M.flight.perYardMs * dist(dropPt, to)));
      /**
       * R8: the throw waits for the target's route (his arrival at the point of his template nearest
       * the catch, at natural pace, minus the flight), at most throwHold after the drop ends.
       */
      // The ball before the throw on the raw clock, from the calls only: the snap to the QB, then the
      // QB on his planned drop legs (he holds his drop point after them).
      const qbRawKeys: Key[] = join(
        ...((qb !== undefined ? plan.legs.get(qb) : undefined) ?? []).map((l) => {
          const t0 = l.fixedStart === true ? Math.min(l.t0, M.maxStartMs) : l.t0;
          return drive(l.pts, t0, Math.max(t0 + M.keyMs, l.t1), { accelMs: M.accelMs["QB"] ?? 250, decelMs: M.decelMs, restStart: l.restStart, restEnd: l.restEnd, keyMs: M.keyMs, fillet: M.fillet });
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
      const throwFor = (id: string | undefined, c: Pt): number => {
        const early = drop + M.hitchMs;
        if (!known(id) || slotOf.get(id)?.side !== "O") return early;
        // His whole template track (as R8 reads it), well past any throw.
        const latest = Math.max(drop + M.throwHold.maxMs + M.flight.maxMs, M.throwHold.searchMs);
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
        return Math.max(early, Math.min(best - flight(c), drop + M.throwHold.maxMs));
      };
      const apex = (to: Pt): number => Math.min(M.flight.apexMax, 1 + dist(dropPt, to) * M.flight.apexPerYard);
      /** The throw: the read, and the QB settles in the pocket from the drop until it (stepping up). */
      const thrown = (throwT: number): Pt => {
        plan.read = throwT;
        plan.releaseAt = throwT + M.release.afterThrowMs;
        return settleLeg(qb, dropPt, { x: dropPt.x, y: dropPt.y + 1 }, drop, throwT, M.sit.maxYards);
      };
      if ("incomplete" in play && play.incomplete === true) {
        const depth = d.airYards ?? templates.passDepth[unit.leaf] ?? 8;
        const tp: Pt = { x: px0, y: los + depth };
        const throwT = throwFor(parts.target, tp);
        const from = thrown(throwT);
        const catchT = throwT + flight(tp);
        if (qb !== undefined) leg(qb, { pts: [from, { x: from.x, y: from.y + 0.5 }], t0: throwT, t1: catchT + 300, restStart: true, restEnd: true });
        plan.ball.push({ kind: "hold", id: qb ?? "", t0: drop, t1: throwT });
        plan.ball.push({ kind: "move", pts: [from, tp], t0: throwT, t1: catchT, apex: apex(tp), endScale: 1 });
        plan.ball.push({ kind: "move", pts: [tp, { x: tp.x, y: tp.y + 1.5 }], t0: catchT, t1: catchT + 300, apex: 0.8, endScale: 0.8 });
        const target = parts.target;
        if (known(target) && slotOf.get(target)?.side === "O") plan.target = { id: target, throwT, catchT, at: tp };
        plan.labels.push({ text: "Incomplete", at: tp, t: catchT + 300, source: "incomplete" });
        plan.whistle = catchT + 300;
        plan.ball.push({ kind: "jump", to: { x: MID_X, y: end?.spot ?? los }, t: plan.whistle });
        break;
      }
      if ("turnover" in play && play.turnover === "interception") {
        const e = endPt(px0);
        const depth = d.airYards ?? templates.passDepth[unit.leaf] ?? 10;
        const c: Pt = { x: px0, y: Math.max(los + depth, e.y) };
        const throwT = throwFor(parts.target, c);
        const from = thrown(throwT);
        const catchT = throwT + flight(c);
        if (qb !== undefined) leg(qb, { pts: [from, { x: from.x, y: from.y + 2 }], t0: throwT, t1: catchT + 500, restStart: true, restEnd: true });
        plan.ball.push({ kind: "hold", id: qb ?? "", t0: drop, t1: throwT });
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
      let throwT = throwFor(rcv, c0);
      // Neutral catch x (DECISIONS.md, "Neutral catch x", designed, display only): the point of his
      // template track that comes nearest the catch depth, at a time a throw can reach (R8 window),
      // its x kept inside the engine's passLocation third when there is one, else inside the field.
      // From the calls only, so nothing before the throw changes; R8 then throws for that point.
      const third = d.passLocation === "left" ? 0 : d.passLocation === "middle" ? 1 : d.passLocation === "right" ? 2 : -1;
      let c = c0;
      if (known(rcv) && slotOf.get(rcv)?.side === "O") {
        const w = FIELD_WIDTH / 3;
        const [lo, hi] = third >= 0 ? [third * w, (third + 1) * w] : [M.sidelineMarginYards, FIELD_WIDTH - M.sidelineMarginYards];
        const first = drop + M.hitchMs + M.flight.minMs;
        const last = drop + M.throwHold.maxMs + M.flight.maxMs;
        // The allowed depths (DECISIONS.md, "Neutral catch depth"): between the line and the dead spot,
        // a screen's depth behind the line included.
        const depth = d.airYards ?? templates.passDepth[unit.leaf] ?? 0;
        // A screen (a depth behind the line) may follow a route that sits deeper, to screenFloorYards.
        const yLo = d.airYards === undefined && depth < 0 ? los + templates.screenFloorYards : Math.min(los, e.y, los + depth);
        const yHi = Math.max(los, e.y);
        // Only points a throw can time: his arrival there minus that throw's flight inside the hold (R8).
        const win = drawnTrack(rcv, last).filter((q) => q.t >= first && q.t - flight(q) <= drop + M.throwHold.maxMs);
        // The first time his route reaches the catch depth. When it never does (a swing that stays
        // shallow, a screen back sitting deep, a stalker), his reachable track point nearest that
        // depth, and with no air yards the catch depth follows it (DECISIONS.md, "Neutral catch
        // depth", amended 2026-11-15), kept inside the band: a screen's depth behind the line stands.
        const reached = win.find((q) => Math.abs(q.y - c0.y) <= 0.5);
        let best: Key | undefined = reached;
        if (best === undefined) for (const q of win) if (best === undefined || Math.abs(q.y - c0.y) < Math.abs(best.y - c0.y) - 1e-9) best = q;
        if (best !== undefined) {
          // Backfield routes (amended 2026-11-15): a route that stays behind the line may be caught
          // there, down to screenFloorYards; still between that floor and the dead spot.
          const floor = best.y < los ? Math.min(yLo, los + templates.screenFloorYards) : yLo;
          const y = reached === undefined && d.airYards === undefined ? Math.max(Math.max(floor, los + templates.screenFloorYards), Math.min(yHi, best.y)) : c0.y;
          c = { x: Math.max(lo, Math.min(hi, best.x)), y };
        }
        throwT = throwFor(rcv, c);
      }
      const from = thrown(throwT);
      const catchT = throwT + flight(c);
      if (qb !== undefined) leg(qb, { pts: [from, { x: from.x, y: from.y + 1 }], t0: throwT, t1: catchT + 300, restStart: true, restEnd: true });
      plan.ball.push({ kind: "hold", id: qb ?? "", t0: drop, t1: throwT });
      plan.ball.push({ kind: "move", pts: [from, c], t0: throwT, t1: catchT, apex: apex(c), endScale: 1 });
      if (known(rcv) && slotOf.get(rcv)?.side === "O") plan.target = { id: rcv, throwT, catchT, at: c };
      plan.read = catchT;
      if (dist(c, e) < 0.5 && !fumbled) {
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
      const e = end !== undefined ? endPt(land.x) : land;
      const ret = parts.returner ?? (isOnside ? parts.fumbleRecoverer : undefined);
      if (known(ret)) leg(ret, { pts: [startOf.get(ret) as Pt, land], t0: startMs(ret), t1: landT, restStart: true, restEnd: end === undefined || dist(land, e) < 0.5, fixedStart: true });
      if (outcome === "touchbackEndZone" || outcome === "touchbackLandingZone") plan.labels.push({ text: "Touchback", at: land, t: landT, source: "outcome" });
      else if (outcome === "outOfBounds") plan.labels.push({ text: "Out of bounds", at: land, t: landT, source: "outcome" });
      else if (outcome === "fairCatch") plan.labels.push({ text: "Fair catch", at: land, t: landT, source: "outcome" });
      if (known(ret) && end !== undefined && dist(land, e) >= 0.5) carry(ret, [land], landT);
      else {
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
      const pos = ss.position;
      arrive = drop + ((dist(atDrop, sp) + 2 * M.sackArc.outYards) / speedOf(sacker0)) * 1000 + (M.accelMs[pos] ?? 300) / 2 + M.decelMs / 2;
    }
    const sackT = Math.max(drop + M.sack.minDelayMs, arrive);
    const passer = parts.passer ?? qb;
    if (known(passer)) {
      plan.legs.set(passer, [
        { pts: [q0, dropPt], t0: 0, t1: drop, restStart: true, restEnd: true, fixedStart: true },
        { pts: [dropPt, sp], t0: drop, t1: sackT, restStart: true, restEnd: true },
      ]);
      plan.ball = [{ kind: "move", pts: [ball0, q0], t0: 0, t1: snapMs, apex: 1, endScale: 1 }, { kind: "hold", id: passer, t0: snapMs, t1: sackT }];
    }
    const sacker = parts.sacker;
    if (known(sacker)) {
      plan.legs.delete(sacker);
      plan.converge.set(sacker, { read: drop, t: sackT, at: sp, around: true });
    }
    plan.read = drop;
    plan.releaseAt = drop;
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
  for (const [id, legs] of plan.legs) {
    const runs = legs.map((l) => {
      const pos = slotOf.get(id)?.position ?? "WR";
      const t0 = l.fixedStart === true ? snapAt + Math.min(l.t0, M.maxStartMs) : T(l.t0);
      const t1 = Math.max(t0 + step, T(l.t1));
      if (l.drift !== undefined) {
        const a = l.pts[0] as Pt;
        const b = l.pts[1] ?? a;
        const L = dist(a, b);
        return sitDrift(a, L < 1e-9 ? { x: 0, y: 1 } : { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, l.drift.v0 / k, l.drift.L, t0, t1, step);
      }
      return drive(l.pts, t0, t1, { accelMs: M.accelMs[pos] ?? 250, decelMs: M.decelMs, restStart: l.restStart, restEnd: l.restEnd, keyMs: step, fillet: M.fillet });
    });
    factKeys.set(id, join(...runs));
  }

  // The ball: held, flying (with its height as size) or jumping to a respot.
  const ballKeys: Key[] = [{ t: 0, ...ball0 }, { t: snapAt, ...ball0 }];
  const scale: ScaleKey[] = [{ t: 0, s: 1 }];
  for (const seg of plan.ball) {
    if (seg.kind === "jump") {
      const t = T(seg.t);
      ballKeys.push({ t, ...seg.to });
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
      if (seg.apex !== 1 || seg.endScale !== 1) {
        // A parabola through 1 at release, the apex at mid-flight and the end scale at the end.
        const s = (1 - f) * (1 - 2 * f) * 1 + 4 * f * (1 - f) * seg.apex + f * (2 * f - 1) * seg.endScale;
        scale.push({ t, s });
      }
    }
    if (seg.apex !== 1 || seg.endScale !== 1) scale.push({ t: t1 + 0.5, s: seg.endScale === 0.8 ? 1 : 1 });
  }
  ballKeys.sort((a, b) => a.t - b.t);
  const ball = dedupe(ballKeys);
  if (live > 0) ball.push({ t: liveEnd + M.settleMs, ...at(ball, liveEnd) });
  const ballAt = (t: number): Pt => at(ball, Math.min(t, liveEnd - 1));
  const finalBall = at(ball, liveEnd);

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

  // Defense marks by player id, built first so a stalking receiver can shadow his man.
  const defKeysById = new Map<string, readonly Key[]>();
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
  // He shadows his defender until the read whoever the engine names (anything else would show who
  // makes the tackle); after it, a named defender's blocker releases and pursues.
  const stalkOf = (id: string): readonly Key[] | undefined => {
    const st = stalkTarget(id);
    return st === undefined ? undefined : defKeysById.get(st.id);
  };

  const build = (slots: readonly OnFieldSlot[], side: "O" | "X", setPts: readonly Pt[], huddlePts: readonly Pt[], into: TLMark[]): void => {
    slots.forEach((s, i) => {
      const set = setPts[i] as Pt;
      const huddle = huddled(side);
      const pre: Key[] = huddle && lineUpMs > 0 ? drive([huddlePts[i] as Pt, set], 0, Math.max(step, lineUpMs - 1), { accelMs: 150, decelMs: 150, restStart: true, restEnd: true, keyMs: step }) : [{ t: 0, ...set }];
      const at0: Key[] = join(pre, [{ t: snapAt, ...set }]);
      const pos = s.position;
      const accel = M.accelMs[pos] ?? 250;
      // Everyone moves at the same compressed or stretched pace as the anchored players (decision 11: uniform scaling).
      const top = (M.speed[pos] ?? 13) / k;
      const start = snapAt + Math.min(M.maxStartMs, (M.startMs[pos] ?? 0) + (i % 3) * M.slotOffsetMs);
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
      let keys: Key[];
      let pathEnd = liveEnd;
      let isFact = false;
      const conv = plan.converge.get(s.id);
      if (conv !== undefined) {
        // R9: exactly what he would do unnamed until the read, then on to his fact (the catch, the sack).
        isFact = true;
        const lineman = (pos === "OL" || pos === "DL") && contactFamily !== null;
        let raw = lineman ? join(at0, linemanSteps(s, side, setPts, set, start, top, accel, contactFamily as string).engaged) : join(at0, side === "O" ? trackOf(s.id, snapAt, k, liveEnd, stalkOf).keys : defenseTrack(s, set, start, liveEnd));
        // His read may come after an unnamed man's pursuit has begun (a recoverer): pursue the same way until it.
        const pFrom = lineman ? (pos === "DL" ? releaseT : Infinity) : side === "X" ? Math.max(start + 4 * step, read + (M.reactionMs[pos] ?? M.reactionMs["other"] ?? 150)) : Infinity;
        if (pFrom < Math.min(T(conv.read), liveEnd - 3 * step)) {
          const p0 = at(raw, pFrom);
          raw = join(
            raw.filter((q) => q.t <= pFrom),
            pursue({ start: p0, vel: velocity(raw, pFrom, step), t0: pFrom, t1: liveEnd, ball: ballAt, topSpeed: top, accelMs: accel, leadMs: M.pursuit.leadMs, turnDegPerS: M.pursuit.turnDegPerS, ring, brakeYards: M.pursuit.brakeYards, ...(lineman ? {} : { corridor: { half: M.pursuit.corridorHalfYards, ms: M.pursuit.corridorMs } }), keyMs: step }),
          );
        }
        const fixed = ringFix(raw, ballAt, side === "X" ? ring : 1.5, snapWindowEnd, liveEnd, lineman ? "sideways" : "radial", side === "O" ? -1 : 1);
        const tr = Math.min(Math.max(T(conv.read), start + step), T(conv.t) - step);
        const pre = join(fixed.filter((q) => q.t < tr), [{ t: tr, ...at(fixed, tr) }]);
        const p = at(pre, tr);
        // A sacker comes around his blocker's outside shoulder, never through him.
        const out = p.x <= MID_X ? -1 : 1;
        const pts = conv.around === true && dist(p, conv.at) > M.sackArc.minYards ? [p, { x: clampX(p.x + out * M.sackArc.outYards), y: Math.min(p.y, conv.at.y + (p.y - conv.at.y) * M.sackArc.depthShare) }, conv.at] : [p, conv.at];
        const run = drive(pts, tr, Math.max(tr + step, T(conv.t)), { accelMs: accel, decelMs: M.decelMs, restStart: false, restEnd: conv.around === true, keyMs: step, fillet: M.fillet });
        keys = join(pre, run, (fact ?? []).filter((q) => q.t > T(conv.t) + 1e-6));
        const last = keys[keys.length - 1] as Key;
        if (s.id === sacker) keys = join(keys.filter((q) => q.t <= liveEnd), [{ t: liveEnd, ...at(keys, Math.min(last.t, liveEnd)) }]);
        else if (s.id === tackler) {
          const cut = Math.min(last.t, liveEnd - M.convergeMs);
          keys = join(keys.filter((q) => q.t < cut), [{ t: cut, ...at(keys, cut) }]);
          keys = join(keys, tacklerRun(keys[keys.length - 1] as Key, liveEnd));
        } else if (last.t < liveEnd - step) keys = join(keys, idleUntil(last, liveEnd, s.id, side, pos));
        else if (last.t > liveEnd) keys = join(keys.filter((q) => q.t < liveEnd), [{ t: liveEnd, ...at(keys, liveEnd) }]);
      } else if (target !== null) {
        // R7: his template exactly to the leave point, then a curve to the catch at catch time.
        isFact = true;
        keys = join(at0, toCatch(s.id, T(target.throwT), T(target.catchT), target.at), fact ?? []);
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
          keys = join(keys, tacklerRun(last, liveEnd));
        } else if (s.id === sacker || (sacker !== null && s.id === parts.passer)) {
          // The sacker stays on the QB he brought down (Joseph's playtest: he used to bounce off to the
          // ring), and the sacked QB stays down where he was hit, even when someone else recovers his fumble.
          keys = join(keys.filter((q) => q.t <= liveEnd), [{ t: liveEnd, ...at(keys, Math.min(last.t, liveEnd)) }]);
        } else if (last.t < liveEnd - step) keys = join(keys, plan.sitAfter.has(s.id) ? sitAfter(keys, last, liveEnd, pos) : idleUntil(last, liveEnd, s.id, side, pos));
        else if (last.t > liveEnd) keys = join(keys.filter((q) => q.t < liveEnd), [{ t: liveEnd, ...at(keys, liveEnd) }]);
      } else if (s.id === tackler) {
        isFact = true;
        // Until the read he does what he would unnamed: a lineman his line steps, others their template.
        const lineman = (pos === "OL" || pos === "DL") && contactFamily !== null;
        const dk = lineman ? linemanSteps(s, side, setPts, set, start, top, accel, contactFamily as string).engaged : side === "O" ? trackOf(s.id, snapAt, k, liveEnd).keys : defenseTrack(s, set, start, liveEnd);
        const cut = Math.min(Math.max(read, start + step), liveEnd - step);
        const drop = join(dk.filter((q) => q.t < cut), [{ t: cut, ...at(dk, cut) }]);
        keys = join(at0, drop, tacklerRun(drop[drop.length - 1] as Key, liveEnd));
      } else {
        const lineman = (pos === "OL" || pos === "DL") && contactFamily !== null;
        if (lineman) {
          const { engaged, engageEnd } = linemanSteps(s, side, setPts, set, start, top, accel, contactFamily);
          let ks = join(at0, engaged);
          if (pos === "DL" && releaseT < liveEnd - 3 * step) {
            const p = at(ks, releaseT);
            ks = join(
              ks.filter((q) => q.t <= releaseT),
              pursue({ start: p, vel: velocity(ks, releaseT, step), t0: releaseT, t1: liveEnd, ball: ballAt, topSpeed: top, accelMs: accel, leadMs: M.pursuit.leadMs, turnDegPerS: M.pursuit.turnDegPerS, ring, brakeYards: M.pursuit.brakeYards, keyMs: step }),
            );
          }
          keys = ringFix(ks, ballAt, side === "X" ? ring : 1.5, snapWindowEnd, liveEnd, "sideways", side === "O" ? -1 : 1);
          const namedLineman = named.has(s.id) || (parts.foulers ?? []).includes(s.id);
          pathEnd = namedLineman ? liveEnd : Math.min(releaseT, engageEnd);
          push({ ...base, keys: settleOf(keys, side, s.id), fact: false, pathEnd, pathStyle: side === "O" ? "block" : "none" });
          return;
        }
        // Routes and drops to the read, then everyone flows to the ball; a stalk block holds to the whistle.
        let readFor = Math.max(start + 4 * step, read + (side === "X" ? (M.reactionMs[pos] ?? M.reactionMs["other"] ?? 150) : 0));
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
        let ks: Key[];
        if (!pursueFrom || readFor >= liveEnd - 3 * step) ks = join(at0, dk.filter((q) => q.t <= liveEnd), [{ t: liveEnd, ...at(dk, liveEnd) }]);
        else {
          const cut = join(at0, dk.filter((q) => q.t < readFor), [{ t: readFor, ...at(dk, readFor) }]);
          const p = at(cut, readFor);
          ks = join(
            cut,
            pursue({
              start: p,
              vel: velocity(cut, readFor, step),
              t0: readFor,
              t1: liveEnd,
              ball: ballAt,
              topSpeed: top,
              accelMs: accel,
              leadMs: M.pursuit.leadMs,
              turnDegPerS: M.pursuit.turnDegPerS,
              ring: side === "X" ? ring : 2,
              brakeYards: M.pursuit.brakeYards,
              ...(side === "X" ? { corridor: { half: M.pursuit.corridorHalfYards, ms: M.pursuit.corridorMs } } : {}),
              keyMs: step,
            }),
          );
        }
        keys = ringFix(ks, ballAt, side === "X" ? ring : 1.5, snapWindowEnd, liveEnd, "radial", side === "O" ? -1 : 1);
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
  function linemanSteps(s: OnFieldSlot, side: "O" | "X", setPts: readonly Pt[], set: Pt, start: number, top: number, accel: number, family: string): { engaged: Key[]; contact: Pt; engageEnd: number } {
    const pos = s.position;
    const lkeys = lineKeys(side === "O" ? offRefs : defRefs, setPts, s.slot, pos);
    const w = place(set, lineContactFor(templates, unit.leaf, family, lkeys));
    const steps = runRoute(set, w, start, { top, pace: 1, endPace: 0, accelMs: accel, decelMs: M.decelMs, keyMs: step, fillet: M.fillet, pause: M.sit });
    const contact = steps.at;
    const engageEnd = Math.max(steps.end, start + step);
    // The pocket: on passes each engaged pair is pushed back together (motion.json pocket).
    const hold: Pt = { x: clampX(contact.x + runDrift), y: contact.y - (family === "pass" ? M.pocket.yards : 0) };
    // With no drift (a sneak, a kick) the pair still shuffles together upfield, at most the block shuffle (R5).
    const L0 = dist(contact, hold);
    const L = L0 < 1e-9 ? M.sit.blockMaxYards : L0;
    const dir = L0 < 1e-9 ? { x: 0, y: 1 } : { x: (hold.x - contact.x) / L0, y: (hold.y - contact.y) / L0 };
    const holdEnd = Math.max(engageEnd + 2 * step, pos === "DL" ? Math.min(releaseT, liveEnd) : liveEnd);
    const v0 = ((family === "pass" ? M.pocket.pace : M.sit.pace) * top) / 1000;
    let engaged = join(w.length > 0 ? steps.keys : [{ t: start, ...set }], sitDrift(contact, dir, v0, L, engageEnd, holdEnd, step));
    if (family === "run" && end !== undefined) {
      // After the handoff (never before: R9), the pair is pushed together with the run: back on a
      // loss, on on a gain, at most pocket.yards. Nobody is drawn winning.
      const gain = end.spot - los;
      const D = Math.sign(gain) * Math.min(Math.abs(gain), M.pocket.yards);
      const r0 = read;
      const pv = (M.pocket.pace * top) / 1000;
      if (Math.abs(D) > 1e-6) engaged = engaged.map((q) => (q.t <= r0 ? q : { ...q, y: q.y + (D * pv * (q.t - r0)) / (Math.abs(D) + pv * (q.t - r0)) }));
    }
    return { engaged, contact, engageEnd };
  }

  /**
   * A defender's diagram motion from his start (R9), from the calls (and on runs the play side)
   * only: a read step (non-rushers on scrimmage plays), his drop set's steps (the pedal), then his
   * zone landmark and the sink toward the nearest receiver's template, or the man trail of his
   * receiver's template, or a settle at the end of a plain drop.
   */
  function defenseTrack(s: OnFieldSlot, set: Pt, t0: number, horizon: number): Key[] {
    const pos = s.position;
    const top = (M.speed[pos] ?? 10) / k;
    const accel = M.accelMs[pos] ?? 300;
    const lm = preset === null || pos === "DL" ? undefined : landmark(templates, preset, s.slot, los, bounds.maxY);
    const manSpot = preset === null || pos === "DL" || lm !== undefined ? undefined : templates.manTargets[preset]?.[s.slot];
    const dropsName = unit.drops !== "" ? unit.drops : (templates.presetDrops[event.defense ?? ""] ?? "zone");
    const steps = place(set, lookup(templates.drops[dropsName], [s.slot, pos]));
    const rusher = lm === undefined && manSpot === undefined && steps.length > 0 && (steps[steps.length - 1] as FieldWp).p.y < set.y;
    const readStep = scrimmage && !rusher && pos !== "DL" ? place(set, lookup(templates.readStep[family], [pos])) : [];
    const wps: FieldWp[] = [...readStep, ...steps];
    if (lm !== undefined) wps.push({ p: lm.at, pauseMs: 0, pace: 1 });
    // Defensive backs always backpedal at least a little; nobody stands still.
    if (wps.length === 0) wps.push({ p: { x: set.x, y: Math.min(bounds.maxY, set.y + 2) }, pauseMs: 0, pace: 1 });
    const endPace = lm !== undefined ? M.zoneDrift.pace : M.sit.pace;
    const r = runRoute(set, wps, t0, { top, pace: 1, endPace, accelMs: accel, decelMs: M.decelMs, keyMs: step, fillet: M.fillet, pause: M.sit });
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
    return underBackLine(join(head, sitDrift(r.at, sd.dir, sd.v0, M.sit.maxYards, r.end, horizon, step)), set);
  }

  /**
   * The target (R7): his template track exactly up to the point nearest the catch that he can
   * reach by catch time at his top speed, then a curve (tangent to his motion there) to the catch
   * point, arriving at catch time.
   */
  function toCatch(id: string, tThrow: number, tc: number, c: Pt): Key[] {
    // Until the throw he is kept off the ball exactly as an unnamed receiver is (ringFix), so his path can't show he's the target.
    const tr = ringFix(trackOf(id, snapAt, k, tc, stalkOf).keys, ballAt, 1.5, snapWindowEnd, tThrow, "radial", -1);
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
    for (let i = li0; i < tr.length; i++) {
      const q = tr[i] as Key;
      if (q.t > tc - step && i > li0) break;
      const dd = dist(q, c);
      const need = bendLen(i) / Math.max(1e-6, tc - q.t);
      if (need <= top && dd < bestD - 1e-9) {
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
        if (dist(q, c) <= bestD + 0.5 && bendLen(i) / Math.max(1e-6, tc - q.t) <= top) li = i;
      }
    }
    const p0 = tr[li] as Key;
    const prev = tr[Math.max(0, li - 1)] as Key;
    const hd = dist(prev, p0);
    const dd = dist(p0, c);
    // The bend: on along his heading a little, then a rounded turn to the catch point, at one speed.
    const lead = leadOf(prev, p0, dd);
    const bendPts = hd > 1e-6 && dd > 0.5 && lead > 1e-3 ? [p0, { x: p0.x + ((p0.x - prev.x) / hd) * lead, y: p0.y + ((p0.y - prev.y) / hd) * lead }, c] : [p0, c];
    const curve = drive(bendPts, p0.t, Math.max(p0.t + step, tc), { accelMs: M.accelMs[slotOf.get(id)?.position ?? "WR"] ?? 300, decelMs: M.decelMs, restStart: false, restEnd: false, keyMs: step, fillet: M.fillet });
    return join(tr.slice(0, li + 1), curve);
  }

  /** After his last leg a fact mark that settles (the QB after his run fake): a sit drift. */
  function sitAfter(keys: readonly Key[], last: Key, t1: number, pos: string): Key[] {
    const prev = at(keys, last.t - step);
    const L = dist(prev, last);
    const dir = L < 1e-9 ? { x: 0, y: -1 } : { x: (last.x - prev.x) / L, y: (last.y - prev.y) / L };
    return sitDrift(last, dir, (M.sit.pace * (M.speed[pos] ?? 8)) / k / 1000, M.sit.maxYards, last.t, t1, step).slice(1);
  }

  /** The engine's tackler: from where he is to the ball at the whistle, arriving at rest. */
  function tacklerRun(from: Key, t1: number): Key[] {
    if (from.t >= t1 - step) return [{ t: t1, ...finalBall }];
    const mid: Pt = { x: (from.x + finalBall.x) / 2 + (from.x <= finalBall.x ? -1 : 1), y: (from.y + finalBall.y) / 2 };
    return drive([from, mid, finalBall], from.t, t1, { accelMs: 300, decelMs: M.convergeMs, restStart: false, restEnd: true, keyMs: step, fillet: M.fillet });
  }

  /** After a fact mark's last leg: he keeps moving gently toward the ball (nobody idle), clear of it. */
  function idleUntil(from: Key, t1: number, id: string, side: "O" | "X", pos: string): Key[] {
    if (id === plan.holder) return [{ t: t1, x: from.x, y: from.y }];
    return pursue({ start: from, vel: { x: 0, y: 0 }, t0: from.t, t1, ball: ballAt, topSpeed: ((M.speed[pos] ?? 10) * 0.6) / k, accelMs: 400, leadMs: M.pursuit.leadMs, turnDegPerS: M.pursuit.turnDegPerS, ring: side === "X" ? ring : 2, brakeYards: M.pursuit.brakeYards, keyMs: step }).slice(1);
  }

  /** The ball, holder and tackler don't move in the settle. */
  function hold(keys: Key[]): Key[] {
    const p = at(keys, liveEnd);
    return join(keys.filter((q) => q.t <= liveEnd), [{ t: liveEnd, ...p }, { t: liveEnd + M.settleMs, ...p }]);
  }

  function settleOf(keys: Key[], side: "O" | "X", id: string): Key[] {
    return settle(keys, liveEnd, M.settleMs, M.settleMaxYards, step, finalBall, side === "X" && !named.has(id) ? ring : null);
  }

  build(defSlots, "X", defStart, defHuddle, defMarks);
  build(offSlots, "O", offStart, offHuddle, offMarks);
  const marks: TLMark[] = [...offMarks, ...defMarks];

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
  const paths: TLPath[] = plan.ball
    .filter((s): s is Extract<BallSeg, { kind: "move" }> => s.kind === "move" && s.apex > 1)
    .map((s) => ({ kind: "ball", points: s.pts, start: T(s.t0), end: T(s.t1) }));
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
    ball,
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
    warnings: [...warnings],
  };
}

/**
 * Keys in time order with no two at one time, except a jump (a respot), kept as a pair: the key
 * before it moves back 1 microsecond, so at the jump's own time the ball is already on its new spot.
 */
function dedupe(keys: readonly Key[]): Key[] {
  const out: Key[] = [];
  for (const k of keys) {
    const last = out[out.length - 1];
    if (last !== undefined && Math.abs(k.t - last.t) < 1e-9) {
      if (Math.hypot(k.x - last.x, k.y - last.y) > 0.5) {
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
