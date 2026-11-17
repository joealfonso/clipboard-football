// Q1 (docs/specs/m2-calling-screen-pass.md): which dead balls the app continues itself. Only a
// `continue` request about their kickoff or their kick, kneel or spike line-up qualifies, and never
// one with a timeout you could call (unless the setting says so), a two-minute warning or an end
// of period in its events, the kickoff that follows a coin toss, or the first request after a
// resume. The toss result and reviews always wait (Joseph, 2026-11-15, O10). The setting changes
// only who presses Continue; the answer is the same path the Space key sends. Pure.

import type { DecisionAnswer, DecisionRequest, GameEvent } from "../engine/types";
import type { AutoAdvance } from "./screens";

const LINE_UP_CALLS: ReadonlySet<string> = new Set(["punt", "fieldGoal", "extraPoint", "kneel", "spike"]);

export interface AutoContext {
  /** The game's committed events so far (the last one tells a post-toss kickoff). */
  readonly events: readonly GameEvent[];
  /** This request is the first one after resuming a save. */
  readonly firstAfterResume: boolean;
  /**
   * The events the step delivered with this request (the play and what its advance implied: the
   * sim logs a two-minute warning or an end of period there, not in request.events).
   */
  readonly stepEvents?: readonly GameEvent[];
}

/** The continue answer when the setting skips this request, else null (it shows and waits). */
export function autoAnswer(req: DecisionRequest | null, setting: AutoAdvance, o: AutoContext): DecisionAnswer | null {
  if (setting === "off" || req === null || req.kind !== "continue" || o.firstAfterResume) return null;
  const about = req.about;
  const qualifies = about.what === "theyKickOff" || (about.what === "theyLineUp" && LINE_UP_CALLS.has(about.call));
  if (!qualifies) return null;
  // A timeout you can call is a decision, unless the setting skips those too.
  const timeout = req.screens[0]?.options.find((x) => x.id === "timeout");
  if (setting === "noDecision" && timeout !== undefined && timeout.legal) return null;
  // The two-minute warning and the end of a period change the clock the player plans around. Both
  // lists: the play's own advance logs them in the step's events, a run-off in the request's.
  const clockEvent = (e: { readonly t: string }): boolean => e.t === "twoMinuteWarning" || e.t === "endPeriod";
  if (req.events.some(clockEvent) || (o.stepEvents ?? []).some(clockEvent)) return null;
  // The opening and overtime kickoffs belong to the coin toss ceremony (beat E8 waits).
  if (about.what === "theyKickOff" && o.events.at(-1)?.t === "toss") return null;
  const cont = req.screens[0]?.options.find((x) => x.id === "continue");
  if (cont === undefined || !cont.legal) return null;
  return { seq: req.seq, path: ["continue"] };
}
