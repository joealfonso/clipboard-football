// The field while you call (docs/specs/m2-play-calling-and-motion.md, Pre-snap state 2): your
// formation or package lined up on the ball with your real players (the request's lineups), the
// focused play's art faint on it, and their huddle. Built from your own call and the layout only,
// never from theirs (P1). Pure: it returns a Timeline the field draws at t = 0.

import type { Lineups, Position } from "@clipboard-football/shared";
import { defenseArt, huddleSpots, offenseArt, slotsFromCounts, type Art, type SlotRef } from "./art";
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
  return {
    los: o.los,
    firstDown: o.firstDown,
    lineUpMs: 0,
    runoffMs: 0,
    runoff: null,
    // Never reaches the set or the snap: a still frame of the Calling state.
    setAt: Infinity,
    snapAt: Infinity,
    liveEnd: Infinity,
    settleMs: 0,
    holdMs: 0,
    total: 0,
    marks,
    ball: [{ t: 0, x: MID_X, y: o.los }],
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
    preview: o.call === null ? (o.side === "offense" ? null : art) : art,
  };
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
