// The play a decision request shows before it asks (after the snap, before the play event), and
// the key that says the play event that follows is that same play, so it isn't animated twice.

import type { OffenseCallChoice, PlayResult } from "@clipboard-football/shared";
import type { DecisionRequest } from "../engine/types";

export interface PendingPlay {
  readonly play: PlayResult;
  readonly offenseCall: OffenseCallChoice;
  readonly defenseCall: string | null;
}

/**
 * The play as the human saw it: a close call's verdict is stripped, because the requests show the
 * ruling without it while the committed play event (a ruling that stood) carries it (code review).
 */
export function pendingKey(play: PlayResult): string {
  const detail = play.detail as Readonly<Record<string, unknown>> | undefined;
  const cc = detail?.["closeCall"];
  if (detail === undefined || cc === null || typeof cc !== "object" || !("verdict" in cc)) return JSON.stringify(play);
  const { verdict: _v, ...shown } = cc as Readonly<Record<string, unknown>>;
  void _v;
  return JSON.stringify({ ...play, detail: { ...detail, closeCall: shown } });
}

/**
 * The ruled play a request shows first: a penalty choice, a ten-second run-off, a challenge, or a
 * review starting (the booth's or the other coach's, which the human did not get to see first).
 */
export function pendingPlay(req: DecisionRequest | null): PendingPlay | null {
  if (req === null) return null;
  if (req.kind === "penalty" || req.kind === "runoff" || req.kind === "challenge") return { play: req.play, offenseCall: req.offenseCall, defenseCall: req.defenseCall };
  if (req.kind === "continue" && req.about.what === "underReview") return { play: req.about.play, offenseCall: req.about.offenseCall, defenseCall: req.about.defenseCall };
  return null;
}
