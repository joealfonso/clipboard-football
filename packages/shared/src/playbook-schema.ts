// zod schemas for the playbook data files (data/plays). Validation happens here, at load;
// packages/sim receives an already-validated Playbook and never imports this file. The shapes
// are checked by zod, the cross-file rules by checkPlaybook in playbook.ts and
// checkPlaybookRules in playbook-rules.ts.

import { z } from "zod";
import {
  ASSIGNMENT_KINDS,
  CALLS_NOT_DRAWN,
  checkPlaybook,
  DEFENSE_TRAITS,
  DEPTH_BUCKETS,
  HEADINGS,
  MAN_ROLES,
  PASS_TRAITS,
  PRESSURES,
  QB_DROPS,
  REASON_CODES,
  ROUTE_DIRECTIONS,
  ROUTE_FAMILIES,
  RUN_GAPS,
  RUN_TRAITS,
  SITUATION_TAGS,
  TIMINGS,
} from "./playbook";
import type { Playbook, PlaybookRefs } from "./playbook";
import { checkPlaybookRules } from "./playbook-rules";
import { ruleSchema } from "./schema";

const text = z.string().min(1);
const pair = z.tuple([z.number(), z.number()]);
const slot = z.string().regex(/^[A-Z]{1,2}[1-9]$/);
const slotAlignment = z.record(slot, pair);
const fieldSide = z.enum(["left", "right"]);
const third = z.enum(["left", "middle", "right"]);
const positive = z.number().positive();
const header = { version: z.literal(1), designed: z.literal(true), note: text };

/** A closed list in a data file must hold exactly the members the code knows, each once. */
function exactly<T extends string>(members: readonly T[]) {
  return z.array(z.enum(members as [T, ...T[]])).refine((a) => a.length === members.length && new Set(a).size === members.length, { message: `must list each of ${members.join(", ")} once` });
}

export const alignmentsSchema = z.strictObject({
  ...header,
  offense: z.record(text, slotAlignment),
  defense: z.record(text, slotAlignment),
  presetAlignment: z.record(text, slotAlignment),
});

const pts = z.array(pair).min(1);
const lane = z.enum(["inside", "edge"]);

const libraryId = z.string().regex(/^[a-z]+(\.[A-Za-z0-9]+)+$/);

const libraryEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("route"), label: text, family: z.enum(ROUTE_FAMILIES), direction: z.enum(ROUTE_DIRECTIONS), axis: z.enum(["in", "side"]), pts, breakAt: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal("block"), label: text, block: z.enum(["pass", "run"]), technique: text, axis: z.enum(["in", "side", "none", "hole"]), pts }),
  z.strictObject({ kind: z.literal("runPath"), label: text, gap: z.enum(RUN_GAPS), counter: z.boolean(), axis: z.enum(["side", "none"]), pts }),
  z.strictObject({ kind: z.literal("qb"), label: text, action: z.enum(["drop", "rollout", "handoff"]), drop: z.enum(QB_DROPS).optional(), fake: z.boolean(), axis: z.enum(["side", "none"]), pts }),
  z.strictObject({ kind: z.enum(["rush", "blitz", "stunt"]), label: text, lane, axis: z.enum(["in", "none"]), pts }),
  z.strictObject({ kind: z.literal("zone"), label: text, level: z.enum(["under", "deep"]), third }),
  z.strictObject({ kind: z.literal("man"), label: text, covers: z.array(z.enum(MAN_ROLES)).min(1), fallback: z.strictObject({ use: libraryId, at: pair.optional() }).optional() }),
  z.strictObject({ kind: z.literal("spy"), label: text }),
]);

export const librarySchema = z.strictObject({ ...header, assignments: z.record(libraryId, libraryEntrySchema) });

const assignmentValue = z.union([
  libraryId,
  z.strictObject({ use: libraryId, to: fieldSide.optional(), depth: z.number().optional(), primary: z.literal(true).optional(), at: pair.optional(), with: slot.optional() }),
]);
const assignments = z.record(slot, assignmentValue).refine((a) => Object.keys(a).length > 0, { message: "a design needs assignments" });
const designId = z.string().regex(/^[a-z][A-Za-z0-9]*(\.[a-z0-9][A-Za-z0-9]*)+$/);
const situations = z.array(z.enum(SITUATION_TAGS));
const traits = z.array(text);

const offenseDesignSchema = z.strictObject({
  id: designId,
  label: text,
  description: text,
  formation: text,
  concept: text,
  side: z.enum(["strong", "weak", "none"]),
  carrier: slot.optional(),
  line: assignmentValue.optional(),
  assignments,
  tags: z.strictObject({ depth: z.enum(DEPTH_BUCKETS).optional(), timing: z.enum(TIMINGS), situations }),
  traits,
  aiWeight: positive,
  default: z.boolean(),
});

const defenseDesignSchema = z.strictObject({
  id: designId,
  label: text,
  description: text,
  package: text,
  coverage: text,
  alignment: slotAlignment.optional(),
  assignments,
  tags: z.strictObject({ timing: z.enum(TIMINGS), pressure: z.enum(PRESSURES), situations }),
  traits,
  aiWeight: positive,
  default: z.boolean(),
});

export const offenseDesignsSchema = z.strictObject({ ...header, designs: z.array(offenseDesignSchema).min(1) });
export const defenseDesignsSchema = z.strictObject({ ...header, designs: z.array(defenseDesignSchema).min(1) });

const heading = z.array(z.enum(HEADINGS)).min(1);
const inOut = z.enum(["in", "out"]);
const familyRow = z.strictObject({
  family: z.enum(ROUTE_FAMILIES),
  heading: heading.optional(),
  lateral: inOut.optional(),
  minBreaks: z.number().int().nonnegative().optional(),
  maxBreaks: z.number().int().nonnegative().optional(),
  minDepth: z.number().optional(),
  maxDepth: z.number().optional(),
  maxEndDepth: z.number().optional(),
  endsShort: z.boolean().optional(),
  breaksShort: z.boolean().optional(),
  back: z.boolean().optional(),
  screen: z.boolean().optional(),
  stemHeading: heading.optional(),
  stemLateral: inOut.optional(),
});

const classifierSchema = z
  .strictObject({
    status: z.literal("designed"),
    note: text,
    quantumYards: positive,
    maxPoints: z.number().int().min(2),
    maxLengthYards: positive,
    minRouteYards: positive,
    breakDegrees: z.number().gt(0).lt(180),
    maxBreaks: z.number().int().nonnegative(),
    simplifyToleranceYards: positive,
    verticalFromDegrees: z.number().gt(0).lte(90),
    diagonalFromDegrees: z.number().gt(0).lt(90),
    backBelowDegrees: z.number().lt(0).gte(-90),
    coreHalfWidthYards: z.number().nonnegative(),
    gapEdgesYards: z.tuple([positive, positive, positive]),
    sideMiddleYards: z.number().nonnegative(),
    spyRadiusYards: positive,
    coreBox: z.strictObject({ halfWidthYards: positive, maxDepthYards: positive }),
    blitzEdgeFromYards: positive,
    catchAtEnd: z.array(z.enum(ROUTE_FAMILIES)).min(1),
    familyNote: text,
    families: z.array(familyRow).min(1),
  })
  .superRefine((c, ctx) => {
    const last = c.families[c.families.length - 1];
    if (last === undefined || Object.keys(last).length !== 1) ctx.addIssue({ code: "custom", message: "the last family row must catch everything" });
    if (c.diagonalFromDegrees >= c.verticalFromDegrees) ctx.addIssue({ code: "custom", message: "diagonal must start below vertical" });
    if (!(c.gapEdgesYards[0] < c.gapEdgesYards[1] && c.gapEdgesYards[1] < c.gapEdgesYards[2])) ctx.addIssue({ code: "custom", message: "gap edges must rise" });
  });

const countRange = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative().nullable()]);
const ranges = z.object({ note: text }).catchall(countRange);
/** A record with exactly the given keys, each a one-line definition. */
function definitions(keys: readonly string[]) {
  return z.strictObject(Object.fromEntries(keys.map((k) => [k, text])));
}
const FEET_PER_YARD = 3;

const tagFit = z.strictObject({
  family: z.enum(["run", "pass"]).optional(),
  concepts: z.array(text).min(1).optional(),
  gaps: z.array(z.enum(RUN_GAPS)).min(1).optional(),
  depth: z.array(z.enum(DEPTH_BUCKETS)).min(1).optional(),
  timing: z.array(z.enum(TIMINGS)).min(1).optional(),
  minProtectors: z.number().int().positive().optional(),
  primary: z.array(z.enum(ROUTE_FAMILIES)).min(1).optional(),
  drop: z.array(z.enum(QB_DROPS)).min(1).optional(),
  fake: z.boolean().optional(),
  primaryLateFrom: positive.optional(),
  coverage: z.array(text).min(1).optional(),
  pressure: z.array(z.enum(PRESSURES)).min(1).optional(),
  traits: z.array(text).min(1).optional(),
});
const situationConfig = z.strictObject({ definition: text, edges: text, rule: ruleSchema, designs: z.strictObject({ offense: z.array(tagFit), defense: z.array(tagFit) }) });

const timingRows = z
  .array(z.strictObject({ when: tagFit.omit({ concepts: true, timing: true }), allow: z.array(z.enum(TIMINGS)).min(1) }))
  .min(1)
  .refine((rows) => Object.keys(rows[rows.length - 1]?.when ?? { none: 1 }).length === 0, { message: "the last timing row must catch everything" });

const count = z.number().int().positive();
const positionList = z.array(text).min(1);
const thresholds = z.strictObject({
  crossersMin: count,
  highMinYards: z.number(),
  lowMaxYards: z.number(),
  highLowGapYards: positive,
  floodMin: count,
  floodGapYards: positive,
  verticalsMin: count,
  levelsGapYards: positive,
  screenBackPositions: positionList,
  lineMin: count,
  pressureMin: count,
  exchangeMax: count,
  overloadMin: count,
  fourDeepMin: count,
  pressMin: count,
  pinchMin: count,
  pinchMoveYards: positive,
});

export const playbookConfigSchema = z.strictObject({
  ...header,
  maxGroupSize: z.number().int().min(1).max(6),
  kinds: exactly(ASSIGNMENT_KINDS),
  families: exactly(ROUTE_FAMILIES),
  buckets: exactly(DEPTH_BUCKETS),
  directions: exactly(ROUTE_DIRECTIONS),
  gaps: exactly(RUN_GAPS),
  reasons: exactly(REASON_CODES),
  tags: z.strictObject({ depth: exactly(DEPTH_BUCKETS), timing: exactly(TIMINGS), pressure: exactly(PRESSURES), situations: exactly(SITUATION_TAGS) }),
  situations: z.strictObject(Object.fromEntries(SITUATION_TAGS.map((t) => [t, situationConfig]))),
  timing: z.strictObject({ note: text, offense: timingRows, defense: timingRows }),
  positions: z.strictObject({ note: text, receivers: positionList, strongTieBreak: positionList, backs: positionList, corners: positionList, safeties: positionList }),
  traits: z.strictObject({ note: text, thresholds, pass: definitions(PASS_TRAITS), run: definitions(RUN_TRAITS), defense: definitions(DEFENSE_TRAITS) }),
  concepts: z.record(text, z.strictObject({ family: z.enum(["run", "pass"]), gaps: z.array(z.enum(RUN_GAPS)).min(1).optional(), line: z.strictObject({ OL: libraryId, OLT: libraryId.optional() }) })),
  lineNote: text,
  defenseDefaults: z.strictObject({ DL: libraryId, DLE: libraryId }),
  defenseDefaultsNote: text,
  notOnThisCall: exactly(CALLS_NOT_DRAWN),
  shells: ranges,
  rush: ranges,
  box: z.strictObject({ note: text, halfWidthYards: positive, maxDepthYards: positive, lightBoxMax: z.number().int().nonnegative(), pressMaxDepthYards: positive, robberMinDepthYards: positive }),
  manRoles: z.strictObject({ note: text, roles: exactly(MAN_ROLES) }),
  eligibility: z.strictObject({ status: z.literal("confirmed"), note: text, routePositions: z.array(text).min(1), neverDrawn: z.array(text), blockWhenShort: z.array(text) }),
  field: z.strictObject({ status: z.literal("confirmed"), note: text, widthFeet: positive }).transform((f) => ({ ...f, widthYards: f.widthFeet / FEET_PER_YARD })),
  defaultDeviations: z.record(text, text),
  classifier: classifierSchema,
});

/** The five raw files of data/plays, as parsed JSON. */
export interface PlaybookFiles {
  readonly alignments: unknown;
  readonly library: unknown;
  readonly offense: unknown;
  readonly defense: unknown;
  readonly config: unknown;
}

/** Parses the five files and runs the cross-file checks. Throws with every problem listed. */
export function parsePlaybook(files: PlaybookFiles, refs: PlaybookRefs): Playbook {
  const pb = {
    alignments: alignmentsSchema.parse(files.alignments),
    library: librarySchema.parse(files.library),
    offense: offenseDesignsSchema.parse(files.offense),
    defense: defenseDesignsSchema.parse(files.defense),
    config: playbookConfigSchema.parse(files.config),
  } as unknown as Playbook;
  const issues = [...checkPlaybook(pb, refs), ...checkPlaybookRules(pb, refs)];
  if (issues.length > 0) throw new Error(`data/plays failed its check:\n${issues.join("\n")}`);
  return pb;
}
