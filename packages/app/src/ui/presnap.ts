// The field while you call (docs/specs/m2-play-calling-and-motion.md, Pre-snap state 2): your
// formation or package lined up on the ball with your real players (the request's lineups), the
// focused play's art faint on it, and their huddle. Built from your own call and the layout only,
// never from theirs (P1). Pure: it returns a Timeline the field draws at t = 0.

import type { Lineups, Position } from "@clipboard-football/shared";
import { defenseArt, huddleSpots, lineUp, offenseArt, slotsFromCounts, type Art, type SlotRef } from "./art";
import { MID_X, type Key, type Pt } from "./motion";
import type { Motion, Templates } from "./templates";
import type { Timeline, TLMark } from "./timeline";

export interface CallingOpts {
  readonly side: "offense" | "defense";
  readonly los: number;
  readonly firstDown: number | null;
  /** Formation (offense) or package (defense) to line up, and the focused play or preset (null: none). */
  readonly unit: string;
  readonly call: string | null;
  readonly lineups: Lineups | undefined;
  /** personnel.json slot counts, for the generic slots when the request has no lineup. */
  readonly counts: Readonly<Partial<Record<string, number>>>;
  /** How many players the opponent has on the field (11, from the rule of the game; their personnel is never read). */
  readonly opponentCount: number;
  readonly templates: Templates;
  readonly motion: Motion;
  readonly pxPerYard: number;
  readonly markPx: number;
  readonly endZoneYards: number;
}

/** Your slots for a unit: the engine's players when the request lists them, else generic slots (no numbers). */
export function ownSlots(lineups: Lineups | undefined, unit: string, counts: Readonly<Partial<Record<string, number>>>): (SlotRef & { id: string })[] {
  const side = lineups?.[unit];
  if (side !== undefined) {
    const order: Position[] = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"];
    return order.flatMap((pos) => (side[pos] ?? []).map((id, i) => ({ slot: `${pos}${i + 1}`, position: pos, id })));
  }
  return slotsFromCounts(counts).map((s) => ({ ...s, id: `own:${s.slot}` }));
}

/** A still frame's timeline around its marks: never reaches the set or the snap. */
function stillTimeline(los: number, firstDown: number | null, marks: TLMark[], preview: Art | null): Timeline {
  return {
    los,
    firstDown,
    lineUpMs: 0,
    runoffMs: 0,
    runoff: null,
    setAt: Infinity,
    snapAt: Infinity,
    liveEnd: Infinity,
    settleMs: 0,
    holdMs: 0,
    total: 0,
    marks,
    ball: [{ t: 0, x: MID_X, y: los }],
    ballScale: [{ t: 0, s: 1 }],
    paths: [],
    labels: [],
    flags: [],
    holder: null,
    tackler: null,
    involved: [],
    rings: [],
    snapWindowEnd: 0,
    read: 0,
    preview,
  };
}

export interface KickoffOpts {
  /** The kicking team's kickoff spot (yards from its own goal line): the frame's line. */
  readonly los: number;
  /** Whether the human's team kicks (its marks get `own:` ids) or receives. */
  readonly humanKicks: boolean;
  readonly templates: Templates;
  readonly pxPerYard: number;
}

/**
 * Both kickoff units lined up before the kick (usability pass U8): the kicking team (O's,
 * attacking up) on templates.kick.kickoff and the return unit (X's) on templates.returnUnits.kickoff,
 * with the same lineUp the live timeline uses, so the cut to the kick moves no mark. Display only:
 * slots come from the template keys with generic ids (`own:` for your unit, `huddle:` for theirs),
 * so no numbers show and hover skips them. Kickoff units are public before every kick; nothing
 * here reads a result.
 */
export function kickoffFrame(o: KickoffOpts): Timeline {
  return publicLineupFrame({ ...o, call: "kickoff" });
}

/** The calls whose lineups are public before the snap (U8; calling screen pass U1 What it draws). */
export type PublicCall = "kickoff" | "punt" | "fieldGoal" | "extraPoint" | "kneel" | "spike";

export interface PublicLineupOpts extends KickoffOpts {
  readonly call: PublicCall;
  /** personnel.json slot counts for the kneel and spike units (an offense formation and a defense package); kick units use their templates' slots. */
  readonly counts?: { readonly offense: Readonly<Partial<Record<string, number>>>; readonly defense: Readonly<Partial<Record<string, number>>> };
}

/**
 * Both units lined up for a call that is public before the snap: a kickoff, punt, field goal or
 * extra point, a kneel or a spike (their line-up, or your Kick rows on focus). The units are the
 * ones the play's timeline lines up (timeline.ts unitOf), with generic ids (`own:` for your side,
 * `huddle:` for theirs), so no numbers show and hover skips them. Nothing here reads a result.
 */
export function publicLineupFrame(o: PublicLineupOpts): Timeline {
  const T = o.templates;
  const units: Readonly<Record<PublicCall, readonly [Readonly<Record<string, unknown>> | undefined, Readonly<Record<string, unknown>> | undefined]>> = {
    kickoff: [T.kick["kickoff"], T.returnUnits["kickoff"]],
    punt: [T.kick["punt"], T.returnUnits["punt"]],
    fieldGoal: [T.kick["fieldGoal"], T.returnUnits["fieldGoal"]],
    extraPoint: [T.kick["extraPoint"], T.returnUnits["fieldGoal"]],
    kneel: [T.offense["underCenter"], T.defense["base"]],
    spike: [T.offense["underCenter"], T.defense["base"]],
  };
  const clock = o.call === "kneel" || o.call === "spike";
  const unit = (side: "O" | "X"): TLMark[] => {
    const tmpl = units[o.call][side === "O" ? 0 : 1] as Parameters<typeof lineUp>[1];
    const counts = o.counts === undefined ? undefined : side === "O" ? o.counts.offense : o.counts.defense;
    const slots: SlotRef[] = clock && counts !== undefined ? slotsFromCounts(counts) : Object.keys(tmpl ?? {}).map((slot) => ({ slot, position: slot.replace(/\d+$/, "") as Position }));
    const pts = lineUp(slots, tmpl, side, o.los, T, o.pxPerYard);
    const prefix = (side === "O") === o.humanKicks ? "own" : "huddle";
    return slots.map((sl, i) => ({ slot: sl.slot, side, position: sl.position, playerId: `${prefix}:${sl.slot}`, keys: [{ t: 0, ...(pts[i] as Pt) }], roles: [], fact: false, pathEnd: 0, pathStyle: "none", huddle: false }));
  };
  return stillTimeline(o.los, null, [...unit("O"), ...unit("X")], null);
}

export function callingFrame(o: CallingOpts): Timeline {
  const slots = ownSlots(o.lineups, o.unit, o.counts);
  const art: Art =
    o.side === "offense" ? offenseArt(o.unit, o.call, slots, o.templates, o.los, o.pxPerYard) : defenseArt(o.unit, o.call, slots, o.templates, o.los, o.pxPerYard);
  const ownSide = o.side === "offense" ? "O" : "X";
  const oppSide = o.side === "offense" ? "X" : "O";
  const still = (p: Pt): Key[] => [{ t: 0, x: p.x, y: p.y }];
  const marks: TLMark[] = art.marks.map((m, i) => ({
    slot: m.slot,
    side: ownSide,
    position: m.position,
    playerId: (slots[i] as { id: string }).id,
    keys: still(m),
    roles: [],
    fact: false,
    pathEnd: 0,
    pathStyle: "none",
    huddle: false,
  }));
  const spots = huddleSpots(o.opponentCount, oppSide, o.los, o.pxPerYard, o.markPx, o.motion.huddle.offenseBehind, o.motion.huddle.defensePast, o.motion.huddle.markGapPx, o.endZoneYards);
  spots.forEach((p, i) =>
    marks.push({ slot: `huddle${i + 1}`, side: oppSide, position: "WR", playerId: `huddle:${i}`, keys: still(p), roles: [], fact: false, pathEnd: 0, pathStyle: "none", huddle: true }),
  );
  return stillTimeline(o.los, o.firstDown, marks, o.call === null ? (o.side === "offense" ? null : art) : art);
}

/**
 * A 150 ms glide from one still frame to the next (focus moved to another card): each mark slides
 * from where it was to its new spot. Marks are matched by player id; new ones appear in place.
 */
export function glide(from: Timeline | null, to: Timeline, ms: number): Timeline {
  if (from === null || ms <= 0) return to;
  const prev = new Map(from.marks.map((m) => [m.playerId, m.keys[m.keys.length - 1] as Key]));
  const marks = to.marks.map((m) => {
    const end = m.keys[m.keys.length - 1] as Key;
    const p = prev.get(m.playerId);
    if (p === undefined) return m;
    const keys: Key[] = [];
    for (let t = 0; t <= ms; t += 25) {
      const f = t / ms;
      const e = f * f * (3 - 2 * f);
      keys.push({ t, x: p.x + (end.x - p.x) * e, y: p.y + (end.y - p.y) * e });
    }
    keys.push({ t: ms, x: end.x, y: end.y });
    return { ...m, keys };
  });
  return { ...to, marks };
}
