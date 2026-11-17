// Recent calls (docs/specs/m2-calling-screen-pass.md, U5): the offense's "5 Earlier call" row.
// Built from your own committed play events only (never the opponent's calls, F5): the most recent
// scrimmage call you made on offense this game that differs from the request's Same call and whose
// whole answer path is legal in this request. It submits the same path the menus would build, so
// the engine sees nothing new. Pure.

import type { DecisionRequest, GameEvent, OffenseCallChoice, PlayEvent, Team } from "../engine/types";

/** What the Earlier call row shows: the call and its answer path, or why it is off (UI words, not engine reason codes). */
export type EarlierCall = { readonly on: true; readonly call: OffenseCallChoice; readonly path: readonly string[] } | { readonly on: false; readonly reason: string };

export const NO_EARLIER = "no earlier call";
export const NO_OTHER = "no other recent call";

const SCRIMMAGE_OTHER: ReadonlySet<string> = new Set(["punt", "fieldGoal", "kneel", "spike"]);

/** The answer path a call takes through this request's screens, or null when the screens don't offer it. */
export function pathOf(call: OffenseCallChoice, req: DecisionRequest): string[] | null {
  const has = (screen: string, id: string): boolean => req.screens.some((s) => s.id === screen && s.options.some((o) => o.id === id));
  if (call.formation !== undefined) {
    const cls = has("offense.run", call.call) ? "run" : has("offense.pass", call.call) ? "pass" : null;
    return cls === null ? null : ["formation", call.formation, cls, call.call];
  }
  if (call.call === "punt" || call.call === "fieldGoal") return ["kick", call.call];
  if (call.call === "kneel" || call.call === "spike") return ["clock", call.call];
  return null;
}

/** Every option on the path is on, screen by screen from the first. */
export function pathLegal(path: readonly string[], req: DecisionRequest): boolean {
  let screen = req.screens[0];
  for (const id of path) {
    const o = screen?.options.find((x) => x.id === id);
    if (o === undefined || !o.legal) return false;
    if (o.opens === undefined) return id === path[path.length - 1];
    const next = o.opens;
    screen = req.screens.find((s) => s.id === next);
  }
  return false;
}

const same = (a: OffenseCallChoice, b: OffenseCallChoice | null): boolean => b !== null && a.call === b.call && a.formation === b.formation;

/** Rule 1: a scrimmage call (a formation play, punt, field goal, kneel or spike) you made on offense. */
function ownScrimmageCall(e: GameEvent, human: Team): e is PlayEvent {
  if (e.t !== "play" || e.before.possession !== human || e.before.phase !== "scrimmage") return false;
  const c = e.offense;
  return c.formation !== undefined ? c.call !== "goForTwo" : SCRIMMAGE_OTHER.has(c.call);
}

/** The Earlier call row for an offense call request (U5 rules 1 to 3). */
export function earlierCall(events: readonly GameEvent[], human: Team, req: DecisionRequest): EarlierCall {
  if (req.kind !== "offenseCall") return { on: false, reason: NO_EARLIER };
  const mine = events.filter((e): e is PlayEvent => ownScrimmageCall(e, human));
  if (mine.length === 0) return { on: false, reason: NO_EARLIER };
  for (let i = mine.length - 1; i >= 0; i--) {
    const call = (mine[i] as PlayEvent).offense;
    if (same(call, req.sameCall)) continue;
    const path = pathOf(call, req);
    if (path !== null && pathLegal(path, req)) return { on: true, call: { call: call.call, ...(call.formation === undefined ? {} : { formation: call.formation }) }, path };
  }
  return { on: false, reason: NO_OTHER };
}
