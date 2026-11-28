// M2 milestone G: close calls. After the outcome is drawn, resolvePlay may mark the ruled play as a
// close call of one of the five kinds (spec resolved 4), at the fitted rate for plays ruled that
// way (data/game/challenges.json), and draws what a review would find. Both draws come from a
// per-play review stream, never the outcome stream, so the outcome stream is identical with close
// calls on or off (G3). The alternative is a deterministic edit of the ruled play: no new outcome.

import type { CloseCall, CloseCallKind, CloseCallRates, Participants, PlayResult } from "../../../shared/src/types";
import { CLOSE_CALL_KINDS } from "../../../shared/src/play";
import { FIELD_LENGTH } from "../game/frame";
import { Rng } from "../rng";

/** The review stream for one play: seeded from the outcome stream's state before the play (read only). */
export function reviewStream(rng: Rng): Rng {
  const [a, b, c, d] = rng.getState();
  const hi = (c ^ Math.imul(a, 0x27d4eb2f)) >>> 0;
  const lo = (d ^ Math.imul(b, 0x165667b1)) >>> 0;
  return Rng.fromSeed((hi & 0x1fffff) * 4294967296 + lo);
}

export interface CloseCallInput {
  readonly play: PlayResult;
  /** The run or pass family the class came from. */
  readonly family: "run" | "pass";
  readonly los: number;
  /** Yards to the line to gain before the snap. */
  readonly distance: number;
  /** Where the ruled fumble came loose, in the offense's frame (null with no fumble). */
  readonly fumbleSpot: number | null;
}

/** The class a play of `yards` falls in (the pipeline's bins, designed reading for an edited play). */
export function classForYards(family: "run" | "pass", yards: number): string {
  if (family === "run") return yards <= 0 ? "loss" : yards <= 3 ? "r1_3" : yards <= 9 ? "r4_9" : yards <= 19 ? "r10_19" : "r20";
  return yards <= 0 ? "c0" : yards <= 9 ? "c1_9" : yards <= 19 ? "c10_19" : "c20";
}

interface Edit {
  readonly alt: PlayResult;
  /** The alternative's class and yards (detail.class, detail.yards). */
  readonly cls: string;
  readonly yards: number;
}

/** The alternative for one kind, or null when the ruled play is not of that kind. */
export function editFor(kind: CloseCallKind, x: CloseCallInput): Edit | null {
  const p = x.play;
  if (p.kind !== "run" && p.kind !== "pass" && p.kind !== "sack" && p.kind !== "scramble") return null;
  if ((p.fouls ?? []).length > 0) return null;
  const end = p.end;
  const incomplete: PlayResult = { kind: "pass", seconds: p.seconds, incomplete: true, end: { spot: x.los, possession: "offense" } };
  const offenseKeeps = end.possession === "offense" && p.turnover === undefined && p.defensePossessedDuringPlay !== true;
  switch (kind) {
    case "completionToIncomplete":
      return p.kind === "pass" && p.incomplete !== true && offenseKeeps ? { alt: incomplete, cls: "inc", yards: 0 } : null;
    case "interceptionToIncomplete":
      return p.kind === "pass" && p.turnover === "interception" ? { alt: incomplete, cls: "inc", yards: 0 } : null;
    case "fumbleToDown": {
      const f = x.fumbleSpot;
      if (p.turnover !== "fumble" || end.possession !== "defense" || f === null || f < 1 || f >= FIELD_LENGTH) return null;
      const yards = f - x.los;
      const cls = p.kind === "sack" ? "sack" : classForYards(p.kind === "pass" ? "pass" : "run", yards);
      return { alt: { kind: p.kind, seconds: p.seconds, end: { spot: f, possession: "offense" } }, cls, yards };
    }
    case "touchdownToShort": {
      if (p.kind === "sack" || !offenseKeeps || end.spot < FIELD_LENGTH) return null;
      const spot = FIELD_LENGTH - 1;
      return { alt: { kind: p.kind, seconds: p.seconds, end: { spot, possession: "offense" } }, cls: classForYards(x.family, spot - x.los), yards: spot - x.los };
    }
    case "spotLineToGain": {
      // As the fit counts them (|yards - to go| <= 1 on run and pass plays): out of bounds included.
      if (p.kind === "sack" || p.incomplete === true || !offenseKeeps || end.spot < 1 || end.spot >= FIELD_LENGTH) return null;
      const line = x.los + x.distance;
      if (line >= FIELD_LENGTH) return null;
      const d = end.spot - line;
      if (d < -1 || d > 1) return null;
      const spot = d >= 0 ? line - 1 : line;
      if (spot === end.spot || spot < 1) return null;
      return { alt: { ...p, end: { ...end, spot } }, cls: classForYards(x.family, spot - x.los), yards: spot - x.los };
    }
  }
}

/** Participants of the alternative: the roles its result no longer has are dropped, never guessed. */
export function altParticipants(kind: CloseCallKind, parts: Participants): Participants {
  const out: Record<string, unknown> = { ...parts };
  const drop = (...rs: string[]): void => rs.forEach((r) => delete out[r]);
  if (kind === "completionToIncomplete") drop("receiver", "tackler", "fumbleForcer", "fumbleRecoverer");
  if (kind === "interceptionToIncomplete") drop("interceptor", "tackler", "fumbleRecoverer", "fumbleForcer");
  if (kind === "fumbleToDown") {
    if (parts.fumbleForcer !== undefined && parts.sacker === undefined) out["tackler"] = parts.fumbleForcer;
    else delete out["tackler"];
    drop("fumbleForcer", "fumbleRecoverer");
  }
  if (kind === "touchdownToShort") drop("tackler");
  return out as Participants;
}

/**
 * Whether the ruled play is a close call, which kind, and the verdict: two draws from the review
 * stream (always two, so the stream's use does not depend on the result). A play that is several
 * kinds at once (a touchdown catch) is at most one close call, by one uniform over the kinds' rates.
 */
export function markCloseCall(rates: CloseCallRates, x: CloseCallInput, rng: Rng): { kind: CloseCallKind; edit: Edit; verdict: CloseCall["verdict"] } | null {
  const u = rng.nextFloat();
  const v = rng.nextFloat();
  let acc = 0;
  for (const kind of CLOSE_CALL_KINDS) {
    const e = editFor(kind, x);
    if (e === null) continue;
    const r = rates.kinds[kind];
    if (r === undefined) continue;
    acc += r.reviewPer1000000 / 1_000_000;
    if (u < acc) return { kind, edit: e, verdict: v < r.reversalPer10000 / 10_000 ? "reversed" : "stands" };
  }
  return null;
}
