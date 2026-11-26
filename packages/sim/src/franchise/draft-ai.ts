// The draft AI (M4 milestone B, designed, data/franchise/draft-ai.json). Among the legal players
// it takes the highest score, ties by player id. With v = position value x the style's value:
// v x overall (or, at a position with a value curve, the style's value x the curve at his overall), plus the style's need x the slot's need bonus, plus v x the team's misreading of the
// player. Each AI team has a profile (a style and an evaluation error) fixed for the draft, derived
// from the franchise seed and never stored. Its input is DraftAiInput, a narrowing of the draft view,
// and its own profile, so it reads nothing a human cannot see on the board (B7). A misreading is of
// the public overall, never a look at a rating behind it.

import type { Position } from "../../../shared/src/engine";
import type { AutoPickReason, DraftAiConfig, DraftAiInput, DraftChoice, DraftProfile } from "../../../shared/src/franchise";
import { normal } from "../loop/league";
import { idKey, shortStream, STREAMS, stream } from "./streams";

/** The need bonus for one more player at a position that holds `count`. */
export function needBonus(rule: { readonly position: Position; readonly count: number }, slotNeed: DraftAiConfig["slotNeed"]): number {
  return slotNeed[rule.position][rule.count] ?? 0;
}

/** The curve at `overall`: straight lines between its points, which run from 0 to 99. */
export function curveValue(points: readonly (readonly [number, number])[], overall: number): number {
  for (let i = 1; i < points.length; i++) {
    const [o, v] = points[i] as readonly [number, number];
    if (overall > o && i < points.length - 1) continue;
    const [po, pv] = points[i - 1] as readonly [number, number];
    return pv + ((v - pv) * (Math.min(Math.max(overall, po), o) - po)) / (o - po);
  }
  return (points[0] as readonly [number, number])[1];
}

/** An AI team's profile: a style drawn by weight and an evaluation error SD. Depends only on the franchise seed and the team's place in league order. */
export function draftProfile(config: DraftAiConfig, seed: number, team: number): DraftProfile {
  const rng = stream(seed, STREAMS.draftProfile, team);
  const styles = Object.entries(config.styles);
  let at = rng.nextFloat() * styles.reduce((s, [, x]) => s + x.weight, 0);
  let style = config.autoPick.style;
  for (const [name, x] of styles) {
    style = name;
    at -= x.weight;
    if (at < 0) break;
  }
  const { errorSdMin, errorSdMax } = config.evaluation;
  return { seed, team, style, errorSd: errorSdMin + (errorSdMax - errorSdMin) * rng.nextFloat() };
}

/** The profile the user's auto-pick and auto-draft use. */
export function autoPickProfile(config: DraftAiConfig, seed: number, team: number): DraftProfile {
  return { seed, team, ...config.autoPick };
}

const profileCache = new WeakMap<DraftAiConfig, { readonly seed: number; readonly profiles: readonly DraftProfile[] }>();

/** Every team's AI profile, in league order. The last seed's are kept, with the misreadings drawn so far. */
export function draftProfiles(config: DraftAiConfig, seed: number, teams: number): readonly DraftProfile[] {
  const hit = profileCache.get(config);
  if (hit !== undefined && hit.seed === seed && hit.profiles.length === teams) return hit.profiles;
  const profiles = Array.from({ length: teams }, (_, team) => draftProfile(config, seed, team));
  profileCache.set(config, { seed, profiles });
  return profiles;
}

const errorCache = new WeakMap<DraftProfile, Map<string, number>>();

/** The misreadings a profile has drawn so far, by player id. */
function drawnErrors(profile: DraftProfile): Map<string, number> {
  let drawn = errorCache.get(profile);
  if (drawn === undefined) errorCache.set(profile, (drawn = new Map()));
  return drawn;
}

/**
 * How many points of overall a team misreads a player by: its errorSd times a normal draw that
 * depends only on the franchise seed, the team and the player, so it is the same at every pick.
 */
export function evaluationError(profile: DraftProfile, playerId: string, drawn: Map<string, number> = drawnErrors(profile)): number {
  if (profile.errorSd === 0) return 0;
  let error = drawn.get(playerId);
  if (error === undefined) {
    error = profile.errorSd * normal(shortStream(profile.seed, STREAMS.draftEvaluation, profile.team, idKey(playerId)));
    drawn.set(playerId, error);
  }
  return error;
}

interface Scored {
  readonly best: DraftChoice | null;
  /** The highest-overall legal marked player the roster can use (starter or depth), when `targets` is given. */
  readonly bestTarget: DraftChoice | null;
}

/** One pass over the board, which is in board order: overall descending, ties by id. */
function scoreBoard(input: DraftAiInput, config: DraftAiConfig, profile: DraftProfile, targets: ReadonlySet<string> | null): Scored {
  const style = config.styles[profile.style];
  const rules = input.onClock.positions;
  const bonus = {} as Record<Position, number>;
  const worth = {} as Record<Position, number>;
  const tilt = {} as Record<Position, number>;
  for (const p of Object.keys(rules) as Position[]) {
    bonus[p] = (style?.need ?? 1) * needBonus({ position: p, count: rules[p].count }, config.slotNeed);
    tilt[p] = style?.value?.[p] ?? 1;
    worth[p] = config.positionValue[p] * tilt[p];
  }
  const curves = config.valueCurve ?? {};
  const drawn = drawnErrors(profile);
  const firstAt: Partial<Record<Position, string>> = {};
  let best: DraftChoice | null = null;
  let bestTarget: DraftChoice | null = null;
  for (const c of input.available) {
    const rule = rules[c.position];
    if (!rule.legal) continue;
    firstAt[c.position] ??= c.id;
    const curve = curves[c.position];
    const value = curve === undefined ? worth[c.position] * c.overall : tilt[c.position] * curveValue(curve, c.overall);
    const noise = worth[c.position] * evaluationError(profile, c.id, drawn);
    const score = value + bonus[c.position] + noise;
    const top = best === null || score > best.score || (score === best.score && c.id < best.playerId);
    const topTarget = targets !== null && bestTarget === null && rule.use !== "extra" && targets.has(c.id);
    if (!top && !topTarget) continue;
    const choice: DraftChoice = { playerId: c.id, position: c.position, overall: c.overall, value, need: bonus[c.position], noise, score, use: rule.use, bestAtPosition: firstAt[c.position] === c.id };
    if (top) best = choice;
    if (topTarget) bestTarget = choice;
  }
  return { best, bestTarget };
}

/** The AI's pick for the team on the clock, or null when it has no legal pick. */
export function chooseAiPick(input: DraftAiInput, config: DraftAiConfig, profile: DraftProfile): DraftChoice | null {
  return scoreBoard(input, config, profile, null).best;
}

export interface AutoChoice extends DraftChoice {
  readonly reason: AutoPickReason;
}

/**
 * The user's auto-pick (and auto-draft): the highest-overall marked target (ties by id) that is legal
 * and that the roster can use as a starter or as depth; with none, the AI policy's pick under the
 * autoPick profile. The reason names only what decided: `target`, a need bonus that applied, or neither.
 */
export function chooseUserAutoPick(input: DraftAiInput, targets: readonly string[], config: DraftAiConfig, profile: DraftProfile): AutoChoice | null {
  const { best, bestTarget } = scoreBoard(input, config, profile, targets.length === 0 ? null : new Set(targets));
  if (bestTarget !== null) return { ...bestTarget, reason: "target" };
  if (best === null) return null;
  return { ...best, reason: best.need > 0 ? (best.use === "starter" ? "needStarter" : "needDepth") : "bestAvailable" };
}
