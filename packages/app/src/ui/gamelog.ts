// The game log (docs/specs/m2-calling-screen-pass.md, Q2): every committed event of the game, newest
// first, under a header where each of the box score's drives starts. driveStarts reads the event
// log the way packages/sim loop/box.ts boxScore counts drives (pinned by game-log.spec GL2), from
// the events' own fields, so the UI thread loads no sim code. Pure.

import type { GameEvent, PlayEvent, Team } from "../engine/types";

export interface DriveRules {
  readonly scoring: { readonly touchdown: number; readonly safety: number };
  readonly regulationPeriods: number;
  readonly periodsPerHalf: number;
}

const other = (t: Team): Team => (t === "home" ? "away" : "home");

/** An accepted foul's index on the play, or null (box.ts acceptedFoul without the yards). */
function accepted(ev: PlayEvent): boolean {
  return ev.penalty !== null && ev.penalty.kind === "accept" && (ev.play.fouls ?? [])[ev.penalty.foul] !== undefined;
}

/** box.ts kickStands: a punt or field goal try counts unless a foul wiped it out. */
function kickStands(ev: PlayEvent): boolean {
  if (ev.play.kind !== "punt" && ev.play.kind !== "fieldGoal") return false;
  const { before, after } = ev;
  if (after.phase !== "scrimmage" || after.possession !== before.possession) return true;
  if (after.down === before.down && after.down !== 1) return false;
  return !accepted(ev);
}

/** One drive of the box score as it sits in the event log: its first and last scrimmage plays; `open` while no score, kick, turnover or half has ended it. */
export interface DriveSpan {
  readonly start: number;
  readonly end: number;
  readonly team: Team;
  readonly open: boolean;
}

/**
 * The box score's drives in the event log, in order. A drive starts at a scrimmage play when no
 * drive is open or the open one is the other team's; it ends on a score, a kick that stands, a
 * change of possession or the end of the half.
 */
export function driveSpans(events: readonly GameEvent[], rules: DriveRules): DriveSpan[] {
  const halfOf = (p: number): number => (p <= rules.regulationPeriods ? Math.ceil(p / rules.periodsPerHalf) : p);
  const out: { start: number; end: number; team: Team; open: boolean }[] = [];
  let cur: { start: number; end: number; team: Team; open: boolean } | null = null;
  const close = (): void => {
    if (cur !== null) cur.open = false;
    cur = null;
  };
  events.forEach((ev, i) => {
    if (ev.t === "endPeriod") {
      if (cur !== null && halfOf(ev.period + 1) !== halfOf(ev.period)) close();
      return;
    }
    if (ev.t !== "play") return;
    const { before, after, play } = ev;
    if (play.kind === "kickoff" || play.kind === "onsideKick" || before.phase === "try") return;
    const off = before.possession;
    const def = other(off);
    if (cur === null || cur.team !== off) {
      close();
      cur = { start: i, end: i, team: off, open: true };
      out.push(cur);
    }
    cur.end = i;
    const gainedOff = after.score[off] - before.score[off];
    const gainedDef = after.score[def] - before.score[def];
    const touchdown = play.kind !== "fieldGoal" && gainedOff >= rules.scoring.touchdown;
    if (touchdown || gainedDef >= rules.scoring.touchdown || gainedDef === rules.scoring.safety) close();
    else if ((play.kind === "fieldGoal" || play.kind === "punt") && kickStands(ev)) close();
    else if (after.phase === "scrimmage" && after.possession !== off) close();
  });
  return out;
}

/** Where each drive begins: the index in `events` of its first scrimmage play, one per drive of boxScore. */
export function driveStarts(events: readonly GameEvent[], rules: DriveRules): number[] {
  return driveSpans(events, rules).map((d) => d.start);
}

/**
 * Whether event i belongs to a drive's group: from its first to its last scrimmage play, and for the
 * drive still in progress, every loop event after its last play too (a timeout, the two-minute
 * warning), since nothing has ended it yet.
 */
export function inSpan(s: DriveSpan, i: number): boolean {
  return s.start <= i && (i <= s.end || s.open);
}

export type LogRow =
  | { readonly t: "drive"; readonly drive: number }
  | { readonly t: "play"; readonly index: number }
  | { readonly t: "event"; readonly index: number };

/**
 * The log's rows, newest first: a play row per play event and an event row per loop event that has
 * a line (`hasLine`). With `spans`, each drive's rows (its first to its last scrimmage play) sit
 * under one header; kickoffs, tries and what falls between drives sit outside any drive.
 */
export function logRows(events: readonly GameEvent[], spans: readonly DriveSpan[] | null, hasLine: (e: GameEvent) => boolean): LogRow[] {
  const driveOf = (i: number): number | null => {
    if (spans === null) return null;
    const d = spans.findIndex((s) => inSpan(s, i));
    return d < 0 ? null : d;
  };
  // Oldest first, in segments of one drive (or none).
  const segments: { drive: number | null; rows: LogRow[] }[] = [];
  events.forEach((e, i) => {
    const row: LogRow | null = e.t === "play" ? { t: "play", index: i } : hasLine(e) ? { t: "event", index: i } : null;
    if (row === null) return;
    const d = driveOf(i);
    const last = segments[segments.length - 1];
    if (last !== undefined && last.drive === d) last.rows.push(row);
    else segments.push({ drive: d, rows: [row] });
  });
  const out: LogRow[] = [];
  for (let k = segments.length - 1; k >= 0; k--) {
    const seg = segments[k] as { drive: number | null; rows: LogRow[] };
    if (seg.drive !== null) out.push({ t: "drive", drive: seg.drive });
    out.push(...[...seg.rows].reverse());
  }
  return out;
}
