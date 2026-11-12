// Calls for a game state, for the engine's contract tests: the step 2 callers, or a random legal
// call. Shared by the C1/C2 contract tests, the determinism test and the speed check.

import type { CallerData } from "../../../shared/src/types";
import { indexCatalog } from "../../src/caller/availability";
import { chooseDefenseCall } from "../../src/caller/defense";
import { chooseOffenseCall, FORMATION_PLAYS, type OffenseCall } from "../../src/caller/offense";
import { toSituation } from "../../src/game/situation";
import type { GameState } from "../../src/game/types";
import { Rng } from "../../src/rng";
import type { RuleSet } from "../../../shared/src/types";

const FORMATIONS = ["shotgun", "underCenter", "pistol", "empty", "heavy"];

export interface Calls {
  readonly offense: OffenseCall;
  readonly defense: string | null;
}

function pick<T>(xs: readonly T[], rng: Rng): T {
  return xs[Math.floor(rng.nextFloat() * xs.length)] as T;
}

/** The step 2 callers' calls, or (when `random`) a random call legal for the phase. */
export function callsFor(s: GameState, rules: RuleSet, caller: CallerData, rng: Rng, random: boolean): Calls {
  const presets = caller.defense.factors.dTry?.targets ?? [];
  if (s.phase === "kickoff") return { offense: { call: rng.nextFloat() < 0.15 ? "onsideKick" : "kickoff" }, defense: null };
  const sit = toSituation(s, rules);
  if (!random) {
    const offense = chooseOffenseCall(sit, caller, rng);
    const needsDefense = s.phase === "try" ? offense.call === "goForTwo" : FORMATION_PLAYS.includes(offense.call);
    return { offense, defense: needsDefense ? chooseDefenseCall(sit, caller, rng) : null };
  }
  if (s.phase === "try") {
    if (rng.nextFloat() < 0.5) return { offense: { call: "extraPoint" }, defense: null };
    return { offense: { call: "goForTwo", twoPointPlay: pick(FORMATION_PLAYS, rng), formation: pick(FORMATIONS, rng) }, defense: pick(presets, rng) };
  }
  const avail = indexCatalog(caller.catalog);
  const options = [...FORMATION_PLAYS, "punt", "fieldGoal", "kneel", "spike"].filter((c) => avail.isAvailable(c, sit) || FORMATION_PLAYS.includes(c));
  const call = pick(options, rng);
  if (FORMATION_PLAYS.includes(call)) return { offense: { call, formation: pick(FORMATIONS, rng) }, defense: pick(presets, rng) };
  return { offense: { call }, defense: rng.nextFloat() < 0.5 ? null : pick(presets, rng) };
}
