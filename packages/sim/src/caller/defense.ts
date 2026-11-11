// Baseline defense play caller. Takes only the situation, never the offense's call or
// formation. Preset share = sum over fronts of P(front | situation) * P(coverage | front,
// coarse situation), mapped through the designed preset table.

import type { CallerData, DefenseMapping, Situation } from "../../../shared/src/types";
import type { Rng } from "../rng";
import { binSituation } from "./bins";
import { requireLookup, type Lookup } from "./lookup";
import { sampleIndex } from "./sample";

export interface DefenseShares {
  /** Presets in catalog order (the dTry targets), with probabilities summing to 1. */
  readonly presets: readonly { readonly call: string; readonly p: number }[];
  readonly trace: Readonly<Record<string, Lookup>>;
}

const FRONT_GROUP: Readonly<Record<string, readonly [string, "light" | "heavy" | "any"]>> = {
  "front.goalLine": ["goalLine", "any"],
  "front.baseLight": ["base", "light"],
  "front.baseHeavy": ["base", "heavy"],
  "front.nickelLight": ["nickel", "light"],
  "front.nickelHeavy": ["nickel", "heavy"],
  "front.dimeLight": ["dime", "light"],
  "front.dimeHeavy": ["dime", "heavy"],
  "front.prevent": ["prevent", "any"],
};

/** Designed mapping from a front and a coverage target ("cover1.man.ge5") to a preset id. */
export function presetFor(front: string, coverage: string, mapping: DefenseMapping): string {
  const fg = FRONT_GROUP[front];
  if (fg === undefined) throw new RangeError(`unknown front ${front}`);
  const [group, box] = fg;
  const [shell, , rush] = coverage.split(".");
  if (group === "goalLine") return "goalLine";
  if (group === "prevent" || shell === "prevent") return "prevent";
  const cell = mapping.presetTable[group as "base" | "nickel" | "dime"][shell ?? ""];
  if (cell === undefined) throw new RangeError(`no preset for ${group} ${shell}`);
  if (typeof cell === "string") return cell;
  const yes = cell.if === "boxHeavy" ? box === "heavy" : rush === "ge5";
  return yes ? cell.then : cell.else;
}

export function defenseShares(situation: Situation, data: CallerData): DefenseShares {
  const labels = binSituation(situation, data.config.dimensions);
  const f = data.defense.factors;
  const presetIds = f.dTry?.targets ?? [];
  if (situation.phase === "try") {
    const t = requireLookup("dTry", f.dTry, labels);
    return { presets: presetIds.map((call, i) => ({ call, p: (t.weights[i] ?? 0) / t.total })), trace: { dTry: t } };
  }
  const front = requireLookup("dFront", f.dFront, labels);
  const covTable = f.dCoverage;
  const fronts = f.dFront?.targets ?? [];
  const p = presetIds.map(() => 0);
  const trace: Record<string, Lookup> = { dFront: front };
  for (let i = 0; i < fronts.length; i++) {
    const fw = front.weights[i] ?? 0;
    if (fw === 0) continue;
    const frontId = fronts[i] as string;
    const pf = fw / front.total;
    const cov = requireLookup("dCoverage", covTable, labels, { front: frontId });
    trace[`dCoverage:${frontId}`] = cov;
    const covTargets = covTable?.targets ?? [];
    for (let j = 0; j < covTargets.length; j++) {
      const cw = cov.weights[j] ?? 0;
      if (cw === 0) continue;
      const k = presetIds.indexOf(presetFor(frontId, covTargets[j] as string, data.config.defenseMapping));
      if (k < 0) throw new RangeError("preset not in dTry targets");
      p[k] = (p[k] ?? 0) + pf * (cw / cov.total);
    }
  }
  return { presets: presetIds.map((call, i) => ({ call, p: p[i] ?? 0 })), trace };
}

/** One draw from the preset distribution. */
export function chooseDefenseCall(situation: Situation, data: CallerData, rng: Rng): string {
  const shares = defenseShares(situation, data);
  const pick = shares.presets[sampleIndex(shares.presets.map((x) => x.p), rng)];
  if (pick === undefined) throw new RangeError("sampled preset out of range");
  return pick.call;
}
