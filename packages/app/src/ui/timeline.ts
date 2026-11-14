// The field animation as data: timeline(input, templates, ctx) returns keyframes for every mark,
// the ball, the paths and the labels. Pure, with no Rng and no outcome logic (spec A1): the same
// event always gives the same timeline.
//
// Facts come only from the PlayResult (kind, end spot, possession, incomplete, turnover, fouls,
// kick fields, `participants`, `onField`) and the after snapshot (the score). The diagram
// (alignments, routes, drops) comes from data/ui/templates.json keyed by the calls only. Diagram
// marks never carry the ball and are kept clear of it; only the engine's tackler arrives at the
// tackle. A fact the engine leaves out is drawn neutral (the middle of the field, the posts for a
// miss) and never named in a label (spec A3).
//
// Frame: the play's frame. y is yards from the offense's goal line (0) to the other goal line
// (100), the end lines at -10 and 110 (from the rule set); x is 0 to 53.3 from the offense's left.

import type { PlayResult } from "@clipboard-football/shared";
import { PARTICIPANT_ROLES, readDetail, type OnFieldSlot, type ParticipantRole, type PlayEvent } from "../engine/types";
import type { Alignment, Pair, Templates, Waypoints } from "./templates";

export const FIELD_WIDTH = 53.3;
export const MID_X = FIELD_WIDTH / 2;

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export interface Key extends Pt {
  /** ms from the start of the timeline at 1x. */
  readonly t: number;
}

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

export interface Timeline {
  readonly los: number;
  readonly firstDown: number | null;
  readonly runoffMs: number;
  readonly runoff: { readonly from: number; readonly to: number } | null;
  readonly snapAt: number;
  readonly liveEnd: number;
  readonly holdMs: number;
  readonly total: number;
  readonly marks: readonly TLMark[];
  readonly ball: readonly Key[];
  readonly paths: readonly TLPath[];
  readonly labels: readonly TLLabel[];
  readonly flags: readonly TLLabel[];
  /** The player holding the ball at the whistle, from the engine; null when nobody does or the engine didn't say. */
  readonly holder: string | null;
  /** The engine's tackler, whose mark ends at the ball. */
  readonly tackler: string | null;
  /** Players named in the play: their numbers show at the whistle by default. */
  readonly involved: readonly string[];
  /** Marks with the ring: the holder at the whistle, a pre-snap fouler, a standout. */
  readonly rings: readonly string[];
  /** The snap window at the start of the live phase, in which the center and the QB handle the ball. */
  readonly snapWindowEnd: number;
}

export interface TimelineInput {
  readonly event: PlayEvent;
  /** Seconds the clock ran before this snap (the run-off event), 0 for none. */
  readonly runoffSeconds: number;
  /** The try's kick spot in the offense's frame (GameState.trySpots.kick), for an extra point. */
  readonly tryKickSpot?: number;
}

export interface TimelineCtx {
  /** personnel.json presetPackage: the defense alignment for a preset. */
  readonly presetPackage: Readonly<Record<string, string>>;
  readonly endZoneYards: number;
  /** Jersey numbers by player id, for labels that name a player ("Fumble, recovered by #55"). */
  readonly numbers: Readonly<Record<string, number>>;
}

// ---------------------------------------------------------------- sampling

/** Position on piecewise-linear keys at time t (held before the first and after the last). */
export function at(keys: readonly Key[], t: number): Pt {
  const first = keys[0];
  if (first === undefined) return { x: MID_X, y: 0 };
  if (t <= first.t) return { x: first.x, y: first.y };
  // At or after the last key: the last key (two keys at one time are a jump, as a respot is).
  const final = keys[keys.length - 1] as Key;
  if (t >= final.t) return { x: final.x, y: final.y };
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i] as Key;
    if (t <= b.t) {
      const a = keys[i - 1] as Key;
      const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  const last = keys[keys.length - 1] as Key;
  return { x: last.x, y: last.y };
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const clampX = (x: number): number => Math.max(0, Math.min(FIELD_WIDTH, x));

// ---------------------------------------------------------------- the build

const RUN_LEAVES = new Set(["insideRun", "outsideRun", "qbSneak"]);
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

function unitOf(event: PlayEvent): { offense: { group: "offense" | "kick"; name: string }; defense: { group: "defense" | "returnUnits"; name: string }; drops: string; routes: string } {
  const { play, offense, defense } = event;
  const k = play.kind;
  const leaf = offense.call === "goForTwo" ? (offense.twoPointPlay ?? "") : offense.call;
  if (k === "kickoff" || k === "onsideKick" || (k === "noPlay" && event.before.phase === "kickoff")) return { offense: { group: "kick", name: "kickoff" }, defense: { group: "returnUnits", name: "kickoff" }, drops: "return", routes: "cover" };
  if (k === "punt" || leaf === "punt") return { offense: { group: "kick", name: "punt" }, defense: { group: "returnUnits", name: "punt" }, drops: "return", routes: "cover" };
  if (k === "fieldGoal" || k === "extraPoint" || leaf === "fieldGoal" || leaf === "extraPoint") return { offense: { group: "kick", name: leaf === "extraPoint" || k === "extraPoint" ? "extraPoint" : "fieldGoal" }, defense: { group: "returnUnits", name: "fieldGoal" }, drops: "kick", routes: "kick" };
  if (k === "kneel" || k === "spike" || leaf === "kneel" || leaf === "spike") return { offense: { group: "offense", name: "underCenter" }, defense: { group: "defense", name: "base" }, drops: "kick", routes: "kick" };
  return {
    offense: { group: "offense", name: offense.formation ?? "shotgun" },
    defense: { group: "defense", name: defense ?? "" },
    drops: "",
    routes: RUN_LEAVES.has(leaf) ? "run" : leaf,
  };
}

/** Where a slot lines up at the set: the template, or rows by order when the template has none. */
function alignmentOf(slots: readonly OnFieldSlot[], tmpl: Alignment | undefined, side: "O" | "X", los: number): Pt[] {
  const missing = slots.filter((s) => tmpl?.[s.slot] === undefined);
  return slots.map((s) => {
    const a: Pair | undefined = tmpl?.[s.slot];
    if (a !== undefined) return { x: clampX(MID_X + a[0]), y: side === "O" ? los - a[1] : los + a[1] };
    // Fallback: spread the unplaced players across the field, two rows.
    const i = missing.indexOf(s);
    const perRow = Math.max(1, Math.ceil(missing.length / 2));
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const x = ((col + 1) / (perRow + 1)) * FIELD_WIDTH;
    const depth = 2 + row * 4;
    return { x, y: side === "O" ? los - depth : los + depth };
  });
}

/** Diagram waypoints for a slot's position group, mirrored so "in" points to the middle. */
function diagramPath(start: Pt, w: Waypoints | undefined, position: string, side: "O" | "X"): Pt[] {
  const pts = w?.[position];
  if (pts === undefined) return [];
  const inward = start.x <= MID_X ? 1 : -1;
  // "up" is up the screen; for the defense the template's up means toward its own goal (also up).
  return pts.map(([i, u]) => ({ x: clampX(start.x + inward * i), y: start.y + (side === "O" ? u : u) }));
}

interface Build {
  ball: Key[];
  facts: Map<string, Key[]>;
  labels: TLLabel[];
  holder: string | null;
  ballFlight: Pt[];
  flightStart: number;
  flightEnd: number;
}

export function timeline(input: TimelineInput, templates: Templates, ctx: TimelineCtx): Timeline {
  const { event } = input;
  const { play, before, after } = event;
  const tm = templates.timing;
  const d = readDetail(play);
  const parts = d.participants ?? {};
  const unit = unitOf(event);
  const isKickTry = play.kind === "extraPoint" || (play.kind === "noPlay" && event.offense.call === "extraPoint");
  const los = isKickTry && input.tryKickSpot !== undefined ? input.tryKickSpot : before.spot;
  const endLine = 100 + ctx.endZoneYards;

  // Times at 1x.
  const runoffMs = input.runoffSeconds > 0 ? tm.runoffMaxMs : 0;
  const snapAt = runoffMs + tm.setMs;
  const span = Math.max(1e-9, tm.liveSecondsMax - tm.liveSecondsMin);
  const f0 = Math.max(0, Math.min(1, (play.seconds - tm.liveSecondsMin) / span));
  const live = tm.liveMinMs + f0 * (tm.liveMaxMs - tm.liveMinMs);
  const liveEnd = snapAt + live;
  const T = (f: number): number => snapAt + f * live;
  const snapWindowEnd = T(0.12);

  // Marks at the set, from the engine's onField and the template for the unit.
  const onField = d.onField;
  const offSlots = onField?.offense ?? [];
  const pkg = unit.defense.group === "defense" ? (ctx.presetPackage[unit.defense.name] ?? unit.defense.name) : unit.defense.name;
  const offTmpl = unit.offense.group === "offense" ? templates.offense[unit.offense.name] : templates.kick[unit.offense.name];
  const defTmpl = unit.defense.group === "defense" ? templates.defense[pkg] : templates.returnUnits[unit.defense.name];
  const defSlots = onField?.defense ?? [];
  const offStart = alignmentOf(offSlots, offTmpl, "O", los);
  const defStart = alignmentOf(defSlots, defTmpl, "X", los);
  const startOf = new Map<string, Pt>();
  offSlots.forEach((s, i) => startOf.set(s.id, offStart[i] as Pt));
  defSlots.forEach((s, i) => startOf.set(s.id, defStart[i] as Pt));
  const slotOf = new Map<string, OnFieldSlot>();
  for (const s of [...offSlots, ...defSlots]) slotOf.set(s.id, s);
  const firstAt = (position: string, slots: readonly OnFieldSlot[]): string | undefined => slots.find((s) => s.position === position)?.id;

  const spotX = (loc: string | undefined): number => (loc === undefined ? MID_X : (LOCATION_X[loc] ?? MID_X));
  const end = "end" in play && play.end !== undefined ? play.end : undefined;
  const ballStart: Pt = { x: MID_X, y: los };
  const b: Build = { ball: [{ t: 0, ...ballStart }, { t: snapAt, ...ballStart }], facts: new Map(), labels: [], holder: null, ballFlight: [], flightStart: 0, flightEnd: 0 };
  const known = (id: string | undefined): id is string => id !== undefined && startOf.has(id);
  const move = (id: string, keys: Key[]): void => {
    b.facts.set(id, [{ t: 0, ...(startOf.get(id) as Pt) }, { t: snapAt, ...(startOf.get(id) as Pt) }, ...keys]);
  };
  const label = (text: string, p: Pt, t: number, source: string): void => {
    b.labels.push({ text, at: p, t, source });
  };
  const leaf = event.offense.call === "goForTwo" ? (event.offense.twoPointPlay ?? "") : event.offense.call;
  // The ball's dead spot. Sideline for out of bounds: the side if the engine gave one, else the near sideline of the diagram.
  const endPt = (fromX: number): Pt => {
    const y = end?.spot ?? los;
    const ob = "outOfBounds" in play && play.outOfBounds === true;
    const side = d.runLocation ?? d.passLocation;
    const x = ob ? (side === "left" ? 0 : side === "right" ? FIELD_WIDTH : fromX < MID_X ? 0 : FIELD_WIDTH) : spotX(side);
    return { x, y };
  };
  const fumbled = d.class === "fumble" || d.class === "fumbleCatch" || ("turnover" in play && play.turnover === "fumble");
  const recoveredText = (id: string | undefined): string => {
    const n = id === undefined ? undefined : ctx.numbers[id];
    return n === undefined ? "Fumble" : `Fumble, recovered by #${n}`;
  };

  const qb = firstAt("QB", offSlots);
  const kind = play.kind === "twoPoint" ? (RUN_LEAVES.has(leaf) ? "run" : play.incomplete === true ? "incomplete" : "pass") : play.kind;

  /** A carrier with the ball from `from` (at fStart) to the dead spot, with a fumble when the engine says so. */
  const carryToEnd = (carrier: string | undefined, path: Key[]): void => {
    const e = endPt(path[path.length - 1]?.x ?? MID_X);
    if (fumbled) {
      const loose = d.fumbleSpot === undefined ? e : { x: e.x, y: d.fumbleSpot };
      const rec = parts.fumbleRecoverer;
      if (known(carrier)) move(carrier, [...path, { t: T(0.8), ...loose }]);
      b.ball.push({ t: T(0.8), ...loose }, { t: T(0.88), x: loose.x + 1, y: loose.y }, { t: T(1), ...e });
      if (known(rec)) move(rec, [{ t: T(0.88), x: loose.x + 1, y: loose.y }, { t: T(1), ...e }]);
      b.holder = known(rec) ? rec : null;
      label(known(rec) ? recoveredText(rec) : "Fumble", loose, liveEnd, "participants.fumbleRecoverer");
      return;
    }
    if (known(carrier)) move(carrier, [...path, { t: T(1), ...e }]);
    b.ball.push({ t: T(1), ...e });
    b.holder = known(carrier) ? carrier : null;
  };

  switch (kind) {
    case "run":
    case "scramble":
    case "kneel": {
      const carrier = parts.ballCarrier ?? (kind === "run" ? undefined : parts.passer);
      const q = qb !== undefined ? (startOf.get(qb) as Pt) : { x: MID_X, y: los - 3 };
      const gap: Pt = { x: spotX(d.runLocation), y: los };
      b.ball.push({ t: T(0.08), ...q });
      const carrierIsQb = carrier !== undefined && slotOf.get(carrier)?.position === "QB";
      if (kind === "kneel") {
        if (known(carrier)) move(carrier, [{ t: T(0.08), ...q }]);
        else if (qb !== undefined) move(qb, [{ t: T(0.08), ...q }]);
        carryToEnd(carrier ?? qb, [{ t: T(0.08), ...q }]);
        if (carrier === undefined) b.holder = null;
        label("Kneel", endPt(q.x), liveEnd, "kind");
        break;
      }
      if (carrierIsQb || (carrier === undefined && leaf === "qbSneak") || kind === "scramble") {
        // The QB takes the snap by the call. With no carrier named the ball goes on alone.
        b.ball.push({ t: T(0.35), ...gap });
        if (qb !== undefined && qb !== carrier) move(qb, [{ t: T(0.08), ...q }]);
        carryToEnd(carrier, [{ t: T(0.08), ...q }, { t: T(0.35), ...gap }]);
        break;
      }
      if (qb !== undefined) move(qb, [{ t: T(0.08), ...q }, { t: T(0.4), x: q.x + (q.x <= MID_X ? -2 : 2), y: q.y - 1 }]);
      if (known(carrier)) {
        const c0 = startOf.get(carrier) as Pt;
        const hand: Pt = { x: (c0.x + q.x) / 2, y: Math.min(c0.y, q.y) + 0.5 };
        b.ball.push({ t: T(0.2), ...hand }, { t: T(0.4), ...gap });
        carryToEnd(carrier, [{ t: T(0.2), ...hand }, { t: T(0.4), ...gap }]);
      } else {
        b.ball.push({ t: T(0.2), x: q.x, y: q.y + 0.5 }, { t: T(0.4), ...gap });
        carryToEnd(undefined, [{ t: T(0.4), ...gap }]);
      }
      break;
    }
    case "pass":
    case "incomplete": {
      const q = qb !== undefined ? (startOf.get(qb) as Pt) : { x: MID_X, y: los - 5 };
      const drop: Pt = { x: q.x, y: q.y - (leaf === "screenPass" ? 2 : leaf === "deepPass" ? 3 : 1.5) };
      b.ball.push({ t: T(0.08), ...q }, { t: T(0.3), ...drop });
      if (qb !== undefined) move(qb, [{ t: T(0.08), ...q }, { t: T(0.3), ...drop }]);
      const px = spotX(d.passLocation);
      const isInt = "turnover" in play && play.turnover === "interception";
      if (kind === "incomplete" || ("incomplete" in play && play.incomplete === true)) {
        const depth = d.airYards ?? templates.passDepth[leaf] ?? 8;
        const tp: Pt = { x: px, y: los + depth };
        b.ballFlight = [drop, tp];
        b.flightStart = T(0.35);
        b.flightEnd = T(0.7);
        // The ball falls past the target; at the whistle it is respotted at the previous spot (a jump, not a flight).
        b.ball.push({ t: T(0.35), ...drop }, { t: T(0.7), ...tp }, { t: T(0.8), x: tp.x, y: tp.y + 1.5 }, { t: T(1), x: tp.x, y: tp.y + 1.5 }, { t: T(1), x: MID_X, y: end?.spot ?? los });
        const target = parts.target;
        if (known(target)) move(target, [{ t: T(0.7), x: tp.x + 1, y: tp.y - 0.5 }]);
        label("Incomplete", tp, liveEnd, "incomplete");
        b.holder = null;
        break;
      }
      if (isInt) {
        const e = endPt(px);
        const depth = d.airYards ?? templates.passDepth[leaf] ?? 10;
        const c: Pt = { x: px, y: Math.max(los + depth, e.y) };
        b.ballFlight = [drop, c];
        b.flightStart = T(0.35);
        b.flightEnd = T(0.6);
        b.ball.push({ t: T(0.35), ...drop }, { t: T(0.6), ...c });
        const icp = parts.interceptor;
        label("Interception", c, T(0.6), "turnover");
        const regained = end?.possession === "offense";
        if (regained) {
          const rec = parts.fumbleRecoverer;
          if (known(icp)) move(icp, [{ t: T(0.6), ...c }, { t: T(0.85), ...e }]);
          b.ball.push({ t: T(0.85), ...e }, { t: T(1), ...e });
          if (known(rec)) move(rec, [{ t: T(1), ...e }]);
          b.holder = known(rec) ? rec : null;
          label(known(rec) ? recoveredText(rec) : "Fumble", e, liveEnd, "defensePossessedDuringPlay");
        } else {
          if (known(icp)) move(icp, [{ t: T(0.6), ...c }, { t: T(1), ...e }]);
          b.ball.push({ t: T(1), ...e });
          b.holder = known(icp) ? icp : null;
        }
        break;
      }
      // Complete. The catch point is the air yards when the engine gives them, else the dead spot (neutral).
      const e = endPt(px);
      const c: Pt = d.airYards !== undefined ? { x: px, y: los + d.airYards } : e;
      const tc = d.airYards !== undefined ? 0.65 : 0.8;
      b.ballFlight = [drop, c];
      b.flightStart = T(0.35);
      b.flightEnd = T(tc);
      b.ball.push({ t: T(0.35), ...drop }, { t: T(tc), ...c });
      const rcv = parts.receiver;
      carryToEnd(rcv, [{ t: T(tc), ...c }]);
      break;
    }
    case "sack": {
      const q = qb !== undefined ? (startOf.get(qb) as Pt) : { x: MID_X, y: los - 5 };
      const e = endPt(q.x);
      const sp: Pt = { x: q.x, y: e.y };
      b.ball.push({ t: T(0.08), ...q });
      const passer = parts.passer ?? qb;
      if (passer !== undefined && known(passer)) move(passer, [{ t: T(0.08), ...q }, { t: T(0.8), ...sp }]);
      if (known(parts.sacker)) move(parts.sacker, [{ t: T(0.8), ...sp }]);
      if (fumbled) {
        b.ball.push({ t: T(0.75), ...sp });
        carryToEnd(undefined, [{ t: T(0.75), ...sp }]);
      } else {
        b.ball.push({ t: T(0.8), ...sp }, { t: T(1), ...sp });
        b.holder = parts.passer !== undefined && known(parts.passer) ? parts.passer : null;
      }
      break;
    }
    case "spike": {
      const q = qb !== undefined ? (startOf.get(qb) as Pt) : { x: MID_X, y: los - 1.5 };
      if (qb !== undefined) move(qb, [{ t: T(0.08), ...q }]);
      b.ball.push({ t: T(0.08), ...q }, { t: T(0.2), x: q.x, y: q.y + 0.6 }, { t: T(1), x: q.x, y: q.y + 0.6 }, { t: T(1), x: MID_X, y: end?.spot ?? los });
      label("Spike", q, liveEnd, "kind");
      break;
    }
    case "punt": {
      const punter = firstAt("P", offSlots);
      const p0 = punter !== undefined ? (startOf.get(punter) as Pt) : { x: MID_X, y: los - 14 };
      if (punter !== undefined) move(punter, [{ t: T(0.12), ...p0 }]);
      b.ball.push({ t: T(0.12), ...p0 });
      const cls = d.class;
      if (cls === "blocked") {
        const e = endPt(MID_X);
        b.ball.push({ t: T(0.4), ...e }, { t: T(1), ...e });
        label("Blocked", e, T(0.4), "detail.class");
        break;
      }
      const e = endPt(MID_X);
      const landY = d.gross !== undefined ? Math.min(los + d.gross, endLine) : e.y;
      const land: Pt = { x: cls?.startsWith("outOfBounds") === true ? FIELD_WIDTH : MID_X, y: landY };
      b.ballFlight = [p0, land];
      b.flightStart = T(0.2);
      b.flightEnd = T(0.6);
      b.ball.push({ t: T(0.2), ...p0 }, { t: T(0.6), ...land });
      const ret = parts.returner;
      if (known(ret)) {
        move(ret, [{ t: T(0.6), ...land }, { t: T(1), ...e }]);
        b.ball.push({ t: T(1), ...e });
        b.holder = ret;
      } else {
        b.ball.push({ t: T(1), ...e });
      }
      const lbl = cls === undefined ? undefined : PUNT_LABELS[cls];
      if (lbl !== undefined) label(lbl, land, T(0.6), "detail.class");
      break;
    }
    case "fieldGoal":
    case "extraPoint": {
      const holder = firstAt("P", offSlots);
      const kicker = firstAt("K", offSlots);
      const kickY = play.kind === "fieldGoal" ? play.kickSpot : los - 7;
      const hp: Pt = { x: MID_X, y: kickY };
      if (holder !== undefined) move(holder, [{ t: T(0.1), ...hp }]);
      if (kicker !== undefined) move(kicker, [{ t: T(0.2), x: MID_X - 1, y: kickY - 1 }]);
      b.ball.push({ t: T(0.12), ...hp }, { t: T(0.25), ...hp });
      if (d.class === "blocked") {
        const e = end !== undefined ? endPt(MID_X) : { x: MID_X, y: los - 1 };
        b.ball.push({ t: T(0.4), ...e }, { t: T(1), ...e });
        label("Blocked", e, T(0.4), "detail.class");
        break;
      }
      const posts: Pt = { x: MID_X, y: endLine };
      b.ballFlight = [hp, posts];
      b.flightStart = T(0.25);
      b.flightEnd = T(0.75);
      b.ball.push({ t: T(0.75), ...posts });
      if (end !== undefined) b.ball.push({ t: T(1), ...endPt(MID_X) });
      const good = "good" in play && play.good;
      label(good ? (play.kind === "fieldGoal" ? "Field goal good" : "Good") : "No good", posts, T(0.75), "good");
      break;
    }
    case "kickoff":
    case "onsideKick": {
      const kicker = firstAt("K", offSlots);
      if (kicker !== undefined) move(kicker, [{ t: T(0.12), ...ballStart }]);
      const isOnside = play.kind === "onsideKick";
      const outcome = "outcome" in play ? play.outcome : "inPlay";
      const landingSpot = "landingSpot" in play ? play.landingSpot : undefined;
      let land: Pt;
      if (outcome === "touchbackEndZone" || outcome === "touchbackLandingZone") land = { x: MID_X, y: 100 + ctx.endZoneYards / 2 };
      else if (outcome === "outOfBounds") land = { x: FIELD_WIDTH, y: landingSpot ?? los + 40 };
      else if (landingSpot !== undefined) land = { x: MID_X, y: landingSpot };
      else if (isOnside) land = { x: MID_X, y: end?.spot ?? los + 10 };
      else land = { x: MID_X, y: Math.max(end?.spot ?? 97, 97) };
      b.ballFlight = [ballStart, land];
      b.flightStart = T(0.15);
      b.flightEnd = T(0.55);
      b.ball.push({ t: T(0.15), ...ballStart }, { t: T(0.55), ...land });
      const e = end !== undefined ? endPt(land.x) : land;
      const ret = parts.returner ?? (isOnside ? parts.fumbleRecoverer : undefined);
      if (known(ret) && end !== undefined) {
        move(ret, [{ t: T(0.55), ...land }, { t: T(1), ...e }]);
        b.holder = ret;
      }
      b.ball.push({ t: T(1), ...e });
      if (outcome === "touchbackEndZone" || outcome === "touchbackLandingZone") label("Touchback", land, T(0.55), "outcome");
      else if (outcome === "outOfBounds") label("Out of bounds", land, T(0.55), "outcome");
      else if (outcome === "fairCatch") label("Fair catch", land, T(0.55), "outcome");
      if (isOnside && end !== undefined) label(end.possession === "offense" ? "Recovered by the kicking team" : "Recovered by the receivers", e, liveEnd, "end.possession");
      break;
    }
    case "noPlay":
      // No snap: everyone stays set, the flag goes down at the line.
      b.ball.push({ t: liveEnd, ...ballStart });
      break;
    default:
      b.ball.push({ t: liveEnd, ...ballStart });
  }

  // The tackler meets the ball at the whistle; none on a touchdown, an incompletion or a kick out of play.
  b.ball.sort((x, y) => x.t - y.t);
  const finalBall = at(b.ball, liveEnd);
  const tackler = parts.tackler !== undefined && known(parts.tackler) ? parts.tackler : null;
  if (tackler !== null) {
    const keys = b.facts.get(tackler);
    if (keys === undefined) move(tackler, [{ t: T(0.75), x: finalBall.x + (finalBall.x <= MID_X ? 2 : -2), y: finalBall.y + 1.5 }, { t: liveEnd, ...finalBall }]);
    else keys.push({ t: liveEnd, ...finalBall });
  }

  // Scores, from the after snapshot.
  const off = before.possession;
  const def = off === "home" ? "away" : "home";
  const gOff = after.score[off] - before.score[off];
  const gDef = after.score[def] - before.score[def];
  if (play.kind !== "fieldGoal" && play.kind !== "extraPoint") {
    if (play.kind === "twoPoint") label(gOff === 2 ? "Two-point try good" : "No good", finalBall, liveEnd, "after.score");
    else if (gOff >= 6 || gDef >= 6) label("Touchdown", finalBall, liveEnd, "after.score");
    else if (gDef === 2 && after.safetyKick) label("Safety", finalBall, liveEnd, "after.score");
  }
  if (d.standout !== undefined) label("Standout", startOf.get(d.standout.player) ?? finalBall, liveEnd, "standout");

  // Flags at the foul spot, or the line when there is none, shown at the whistle.
  const flags: TLLabel[] = (play.fouls ?? []).map((f) => ({ text: "Flag", at: { x: MID_X + 4, y: f.spot ?? los }, t: play.kind === "noPlay" ? snapAt : liveEnd, source: "fouls" }));

  // Every mark: fact keys, or diagram keys kept clear of the ball.
  const roleOf = (id: string): ParticipantRole[] => PARTICIPANT_ROLES.filter((r) => parts[r] === id);
  const clear = templates.field.clearOfBallYards;
  const routes = templates.routes[unit.routes];
  const dropName = unit.drops !== "" ? unit.drops : (templates.presetDrops[event.defense ?? ""] ?? "zone");
  const drops = templates.drops[dropName];
  const diagramEnd = snapAt + 0.8 * live;
  const marks: TLMark[] = [];
  const build = (slots: readonly OnFieldSlot[], side: "O" | "X"): void => {
    for (const s of slots) {
      const start = startOf.get(s.id) as Pt;
      const factKeys = b.facts.get(s.id);
      if (factKeys !== undefined) {
        marks.push({ slot: s.slot, side, position: s.position, playerId: s.id, keys: factKeys, roles: roleOf(s.id), fact: true });
        continue;
      }
      if (play.kind === "noPlay") {
        marks.push({ slot: s.slot, side, position: s.position, playerId: s.id, keys: [{ t: 0, ...start }], roles: roleOf(s.id), fact: false });
        continue;
      }
      const way = diagramPath(start, side === "O" ? routes : drops, s.position, side);
      const keys: Key[] = [{ t: 0, ...start }, { t: snapAt, ...start }];
      way.forEach((p, i) => keys.push({ t: snapAt + ((i + 1) / way.length) * (diagramEnd - snapAt), ...p }));
      keys.push({ ...(keys[keys.length - 1] as Key), t: liveEnd });
      marks.push({ slot: s.slot, side, position: s.position, playerId: s.id, keys: keepClear(keys, b.ball, clear, snapWindowEnd, liveEnd), roles: roleOf(s.id), fact: false });
    }
  };
  build(offSlots, "O");
  build(defSlots, "X");

  const paths: TLPath[] = marks
    .filter((m) => (m.keys[m.keys.length - 1] as Key).t > snapAt && dist(m.keys[1] ?? m.keys[0] as Key, m.keys[m.keys.length - 1] as Key) > 0.25)
    .map((m) => ({ kind: m.side === "O" ? "offense" : "defense", points: m.keys.filter((k) => k.t >= snapAt), start: snapAt, end: (m.keys[m.keys.length - 1] as Key).t }));
  if (b.ballFlight.length > 0) paths.push({ kind: "ball", points: b.ballFlight, start: b.flightStart, end: b.flightEnd });

  const scored = b.labels.some((l) => l.source === "after.score" || l.source === "standout") || (play.kind === "fieldGoal" && play.good);
  const caught = b.labels.some((l) => l.source === "turnover" || l.source === "participants.fumbleRecoverer") || tackler !== null || kind === "pass";
  const holdMs = scored ? tm.scoreHoldMs : caught ? tm.holdMs : 0;
  const involved = [...new Set([...PARTICIPANT_ROLES.map((r) => parts[r]).filter((x): x is string => x !== undefined), ...(parts.foulers ?? [])])].filter((id) => startOf.has(id));
  const rings = [b.holder, play.kind === "noPlay" ? (parts.foulers?.[0] ?? null) : null, d.standout?.player ?? null].filter((x): x is string => x !== null && startOf.has(x));

  return {
    los,
    firstDown: before.phase === "scrimmage" && !before.goalToGo ? Math.min(100, before.spot + before.distance) : null,
    runoffMs,
    runoff: input.runoffSeconds > 0 ? { from: before.clock + input.runoffSeconds, to: before.clock } : null,
    snapAt,
    liveEnd,
    holdMs,
    total: liveEnd + holdMs,
    marks,
    ball: b.ball.slice().sort((x, y) => x.t - y.t),
    paths,
    labels: b.labels,
    flags,
    holder: b.holder,
    tackler,
    involved,
    rings,
    snapWindowEnd,
  };
}

/**
 * Resamples a diagram mark every 25 ms of the live play after the snap window and keeps it at
 * least `clear` yards from the ball (spec A3: diagram marks never touch the ball). A mark that
 * would come closer is held on a circle around the ball, and the circle's angle turns at most
 * 45 degrees a sample toward the mark's own path, so it never jumps across the ball; it rejoins
 * its path once the path is clear on the same side.
 */
const MAX_TURN = Math.PI / 4;
function keepClear(keys: readonly Key[], ball: readonly Key[], clear: number, from: number, to: number): Key[] {
  const out: Key[] = keys.filter((k) => k.t < from);
  const times: number[] = [];
  for (let t = from; t < to; t += 25) times.push(t);
  times.push(to);
  let dir: number | null = null;
  for (const t of times) {
    const m = at(keys, t);
    const bp = at(ball, t);
    const d = dist(m, bp);
    const own: number = d < 1e-9 ? (dir ?? (m.x <= MID_X ? Math.PI : 0)) : Math.atan2(m.y - bp.y, m.x - bp.x);
    let angle: number;
    if (dir === null) {
      if (d >= clear) {
        out.push({ t, ...m });
        continue;
      }
      angle = own;
    } else {
      const diff: number = ((own - dir + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      angle = Math.abs(diff) <= MAX_TURN ? own : dir + Math.sign(diff) * MAX_TURN;
      if (angle === own && d >= clear) {
        dir = null;
        out.push({ t, ...m });
        continue;
      }
    }
    dir = angle;
    const r = Math.max(clear, d);
    out.push({ t, x: bp.x + r * Math.cos(angle), y: bp.y + r * Math.sin(angle) });
  }
  return out;
}

/** The PlayResult kinds the timeline draws, for tests. */
export type DrawnKind = PlayResult["kind"];
