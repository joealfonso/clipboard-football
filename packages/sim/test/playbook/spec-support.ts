// Support for the independent classifier tests (milestone B of
// docs/specs/m3-playbook-and-custom-routes.md). Alignments are typed here by hand so the
// expected values can be worked out from this file alone.

import type { DefenseDesign, OffenseDesign, Pair, PathPoint, Playbook } from "../../../shared/src/playbook";
import { parsePlaybook } from "../../../shared/src/playbook-schema";
import { caller, files, json, refs } from "../../../shared/test/spec-support";
import { classifyConfig, classifyPath } from "../../src/playbook/classify";
import type { ClassifyConfig, ClassifyContext, ClassifyResult, Features } from "../../src/playbook/classify";

export const playbook: Playbook = parsePlaybook(files(), refs());
const rules = json<{ field: { endZoneYards: number } }>("data/rules/nfl-2026.json");
export const config: ClassifyConfig = classifyConfig(playbook.config, caller.offenseMapping.depth, rules.field.endZoneYards);

/** A copy of the config with some data thresholds changed, as an edit to data/plays/config.json would. */
export function configWith(classifier: Partial<Playbook["config"]["classifier"]>, rest: Partial<Pick<Playbook["config"], "field" | "eligibility" | "notOnThisCall">> = {}): ClassifyConfig {
  const c = { ...playbook.config, ...rest, classifier: { ...playbook.config.classifier, ...classifier } };
  return classifyConfig(c, caller.offenseMapping.depth, rules.field.endZoneYards);
}

export type P = [number, number];
export type Right = "offense" | "defense";

/** A symmetric fixture formation: x to the offense's right, depth behind the line. */
export const OFF: Record<string, Pair> = {
  QB1: [0, 5], RB1: [0, 7], RB2: [-4, 6],
  WR1: [-20, 1], WR2: [20, 1], WR3: [-13, 1], WR4: [13, 1], TE1: [-6, 1], TE2: [6, 1],
  OL1: [-4, 1], OL2: [-2, 1], OL3: [0, 1], OL4: [2, 1], OL5: [4, 1],
};
export const DEF: Record<string, Pair> = {
  DL1: [-5, 1], DL2: [-2, 1], DL3: [2, 1], DL4: [5, 1],
  LB1: [-4, 5], LB2: [0, 5], LB3: [4, 5], CB1: [-20, 6], CB2: [20, 6], S1: [-8, 12], S2: [8, 12],
};

export const offCtx = (slot: string, more: Partial<ClassifyContext> = {}): ClassifyContext => ({ side: "offense", slot, alignment: OFF, call: "shortPass", spot: 40, ...more });
export const defCtx = (slot: string, more: Partial<ClassifyContext> = {}): ClassifyContext => ({ side: "defense", slot, alignment: DEF, call: "baseCover3", spot: 40, ...more });

export function run(path: readonly PathPoint[], ctx: ClassifyContext, cfg: ClassifyConfig = config): ClassifyResult {
  return classifyPath(path, ctx, cfg);
}
/** The features, or a thrown reason. */
export function feat(path: readonly PathPoint[], ctx: ClassifyContext, cfg: ClassifyConfig = config): Features {
  const r = run(path, ctx, cfg);
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r.features;
}
export function reason(path: readonly PathPoint[], ctx: ClassifyContext, cfg: ClassifyConfig = config): string {
  const r = run(path, ctx, cfg);
  return r.ok ? `ok ${JSON.stringify(r.features)}` : r.reason;
}
/**
 * The depth of the last turn of 30 degrees or more, or of the end point when there is none, in yards
 * past the line for a player `back` yards behind it (the spec's break depth, R12's frame). Own math.
 */
export function ownBreak(path: readonly PathPoint[], back: number): { y: number; breaks: number } {
  let y = (path.at(-1) as PathPoint)[1] - back;
  let breaks = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const [a, b, c] = [path[i - 1], path[i], path[i + 1]] as [PathPoint, PathPoint, PathPoint];
    const one = [b[0] - a[0], b[1] - a[1]] as const;
    const two = [c[0] - b[0], c[1] - b[1]] as const;
    const cos = (one[0] * two[0] + one[1] * two[1]) / (Math.hypot(...one) * Math.hypot(...two));
    if (cos <= Math.cos(Math.PI / 6)) {
      y = b[1] - back;
      breaks++;
    }
  }
  return { y, breaks };
}
/** The last stroke's heading, by the angles in data/plays/config.json, and which way it goes. */
export function ownHeading(path: readonly PathPoint[], alignX: number): { heading: "vertical" | "diagonal" | "sideways" | "back"; way: "in" | "out" | "none" } {
  const t = playbook.config.classifier;
  const [a, b] = [path.at(-2), path.at(-1)] as [PathPoint, PathPoint];
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const up = (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI;
  const heading = up >= t.verticalFromDegrees ? "vertical" : up >= t.diagonalFromDegrees ? "diagonal" : up > t.backBelowDegrees ? "sideways" : "back";
  return { heading, way: dx === 0 ? "none" : Math.abs(alignX) < t.coreHalfWidthYards || Math.sign(dx) === Math.sign(alignX) ? "out" : "in" };
}

export const flipX = (path: readonly PathPoint[]): P[] => path.map(([x, y]) => [0 - x, y]);
export function offense(id: string): OffenseDesign {
  return playbook.offense.designs.find((d) => d.id === id) as OffenseDesign;
}
export function defense(id: string): DefenseDesign {
  return playbook.defense.designs.find((d) => d.id === id) as DefenseDesign;
}
