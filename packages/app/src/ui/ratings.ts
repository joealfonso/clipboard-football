// Ratings on the field and the hover card (Joseph's amendment: "each player should have a rating
// on them that i can hover over to see more stats about that play"). Pure: card ratings from the
// pool (before the home-field shift), and the play section only from the roles the engine credited.

import type { Player, PlayResult } from "@clipboard-football/shared";
import { PARTICIPANT_ROLES, readDetail, type ParticipantRole, type PlayEvent } from "../engine/types";

/** A base rating or one of the position's skills. */
export function ratingValue(p: Player, rating: string): number | undefined {
  return (p.ratings as Readonly<Record<string, number>>)[rating] ?? p.skills[rating];
}

/**
 * A player's overall: the weighted mean of his card ratings (before home field), with the
 * position's weights from templates overallWeights. Display only; the engine never reads it.
 */
export function overallRating(p: Player, weights: Readonly<Record<string, Readonly<Record<string, number>>>>): number {
  let sum = 0;
  let total = 0;
  for (const [r, w] of Object.entries(weights[p.position] ?? {})) {
    const v = ratingValue(p, r);
    if (v === undefined) continue;
    sum += v * w;
    total += w;
  }
  return total === 0 ? 0 : Math.round(sum / total);
}

const ROLE_TEXT: Readonly<Record<ParticipantRole, string>> = {
  passer: "Passer",
  target: "Target",
  receiver: "Receiver",
  ballCarrier: "Ball carrier",
  tackler: "Tackler",
  sacker: "Sacker",
  interceptor: "Interceptor",
  fumbleForcer: "Forced the fumble",
  fumbleRecoverer: "Recovered the fumble",
  kicker: "Kicker",
  punter: "Punter",
  returner: "Returner",
};

/** Yards the result gives for a role, when it gives any (never invented). */
function yardsFor(role: ParticipantRole, ev: PlayEvent): number | undefined {
  const p: PlayResult = ev.play;
  const d = readDetail(p);
  const end = "end" in p ? p.end : undefined;
  const gain = d.yards ?? (end === undefined ? undefined : Math.max(0, Math.min(100, end.spot)) - ev.before.spot);
  if (role === "ballCarrier" || role === "receiver" || role === "sacker") return end?.possession === "offense" ? gain : undefined;
  if (role === "passer" && p.kind === "pass" && p.incomplete !== true && p.turnover === undefined) return gain;
  if (role === "punter") return d.gross;
  if (role === "kicker" && p.kind === "fieldGoal") return d.distance;
  return undefined;
}

/**
 * What a player did on this play: only the roles in `detail.participants` (and a foul), each with
 * the yards from the result where it has them. Empty for a player the engine didn't credit.
 */
export function playLines(id: string, ev: PlayEvent | null): string[] {
  if (ev === null) return [];
  const parts = readDetail(ev.play).participants ?? {};
  const out: string[] = [];
  for (const r of PARTICIPANT_ROLES) {
    if (parts[r] !== id) continue;
    const y = yardsFor(r, ev);
    out.push(y === undefined ? ROLE_TEXT[r] : `${ROLE_TEXT[r]}, ${y} yards`);
  }
  (parts.foulers ?? []).forEach((f, i) => {
    if (f === id) out.push(`Flag: ${ev.play.fouls?.[i]?.penalty ?? "foul"}`);
  });
  return out;
}

export const NO_PLAY_STAT = "No recorded stat on this play";
