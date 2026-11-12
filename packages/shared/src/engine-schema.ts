// zod schemas for the play engine's data files and for players. Validation happens here, at
// load; packages/sim receives already-validated data and never imports this file.

import { z } from "zod";
import type { CallerData } from "./caller";
import { BASE_RATINGS, PLAYER_SCHEMA_VERSION, POSITION_SKILLS, POSITIONS, TRACE_FIELDS } from "./engine";
import type {
  BaselinePenalties,
  BaselineScrimmage,
  BaselineSpecial,
  Distributions,
  EngineConfig,
  EngineData,
  KickoffTable,
  MatchupCentered,
  Names,
  Personnel,
  Player,
  RatingsConfig,
  TeamPool,
  WhyTemplates,
} from "./engine";
import type { RuleSet } from "./rules";
import { dimensionSchema, levelSchema } from "./schema";

const rating = z.number().int().min(0).max(99);
const position = z.enum(POSITIONS);
const posInt = z.number().int().positive();
const nonNeg = z.number().int().nonnegative();

// ---------------------------------------------------------------- players (A2)

export const playerSchema = z
  .strictObject({
    schemaVersion: z.literal(PLAYER_SCHEMA_VERSION),
    id: z.string().min(1),
    name: z.string().min(1),
    position,
    ratings: z.strictObject(Object.fromEntries(BASE_RATINGS.map((r) => [r, rating])) as Record<(typeof BASE_RATINGS)[number], typeof rating>),
    skills: z.record(z.string(), rating),
  })
  .superRefine((p, ctx) => {
    const want = POSITION_SKILLS[p.position] as readonly string[];
    for (const s of Object.keys(p.skills)) {
      if (!want.includes(s)) ctx.addIssue({ code: "custom", message: `${s} is not a ${p.position} skill` });
    }
    for (const s of want) {
      if (!(s in p.skills)) ctx.addIssue({ code: "custom", message: `${p.position} is missing skill ${s}` });
    }
  });

export const teamPoolSchema = z.strictObject({
  schemaVersion: z.literal(PLAYER_SCHEMA_VERSION),
  name: z.string().min(1),
  players: z.array(playerSchema).min(1),
});

export function parsePlayer(json: unknown): Player {
  return playerSchema.parse(json) as Player;
}

export function parseTeamPool(json: unknown): TeamPool {
  return teamPoolSchema.parse(json) as TeamPool;
}

// ---------------------------------------------------------------- designed files

const slots = z.partialRecord(position, nonNeg);

export const personnelSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    designed: z.literal(true),
    note: z.string().optional(),
    positions: z.array(position),
    offense: z.record(z.string(), slots),
    kick: z.record(z.string(), slots),
    packages: z.record(z.string(), slots),
    presetPackage: z.record(z.string(), z.string()),
  })
  .superRefine((p, ctx) => {
    const count = (s: Record<string, number>): number => Object.values(s).reduce((a, b) => a + b, 0);
    for (const [k, s] of [...Object.entries(p.offense), ...Object.entries(p.kick)]) {
      if (count(s) !== 11) ctx.addIssue({ code: "custom", message: `${k} puts ${count(s)} on the field` });
    }
    for (const [k, s] of Object.entries(p.packages)) {
      if (count(s) !== 11) ctx.addIssue({ code: "custom", message: `package ${k} puts ${count(s)} on the field` });
    }
    for (const [preset, pkg] of Object.entries(p.presetPackage)) {
      if (!(pkg in p.packages)) ctx.addIssue({ code: "custom", message: `preset ${preset} has unknown package ${pkg}` });
    }
  });

const classTarget = z.strictObject({
  kind: z.literal("class"),
  families: z.array(z.string()).min(1),
  leaves: z.array(z.string()).optional(),
  classes: z.array(z.string()).min(1),
  maxYardsToGo: z.number().int().positive().optional(),
});
const effectTarget = z.discriminatedUnion("kind", [
  classTarget,
  z.strictObject({ kind: z.literal("penalty"), penalties: z.array(z.string()).min(1) }),
  z.strictObject({ kind: z.literal("punt"), classes: z.array(z.string()).min(1) }),
  z.strictObject({ kind: z.literal("fieldGoal"), classes: z.array(z.string()).min(1), minDistance: z.number().int().positive().optional() }),
  z.strictObject({ kind: z.literal("extraPoint"), classes: z.array(z.string()).min(1) }),
  z.strictObject({ kind: z.literal("kickoff"), classes: z.array(z.string()).min(1) }),
]);

export const ratingsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    designed: z.literal(true),
    note: z.string().optional(),
    curve: z.array(z.strictObject({ p: z.number().min(0).max(1), rating: z.number().min(0).max(99) })).min(2),
    measured: z.record(
      z.string(),
      z.strictObject({ drills: z.array(z.string()).min(1), lowerIsBetter: z.array(z.boolean()), drillWeights: z.array(z.number().positive()) }),
    ),
    minRelativeEffect: z.number().positive(),
    effects: z.array(
      z.strictObject({
        id: z.string().min(1),
        label: z.string().min(1),
        target: effectTarget,
        inputs: z.array(z.strictObject({ side: z.enum(["offense", "defense"]), position, rating: z.string(), coef: z.number() })).min(1),
        min: z.number().positive(),
        max: z.number().positive(),
      }),
    ),
  })
  .superRefine((r, ctx) => {
    for (let i = 1; i < r.curve.length; i++) {
      const a = r.curve[i - 1];
      const b = r.curve[i];
      if (a !== undefined && b !== undefined && (b.p <= a.p || b.rating < a.rating)) ctx.addIssue({ code: "custom", message: "curve must increase" });
    }
    for (const e of r.effects) {
      if (!(e.min <= 1 && 1 <= e.max)) ctx.addIssue({ code: "custom", message: `effect ${e.id}: bounds must contain 1` });
      for (const i of e.inputs) {
        const ok = (BASE_RATINGS as readonly string[]).includes(i.rating) || (POSITION_SKILLS[i.position] as readonly string[]).includes(i.rating);
        if (!ok) ctx.addIssue({ code: "custom", message: `effect ${e.id}: ${i.position} has no rating ${i.rating}` });
      }
    }
  });

export const namesSchema = z.strictObject({
  designed: z.literal(true),
  note: z.string().optional(),
  first: z.array(z.string().min(1)).min(10),
  last: z.array(z.string().min(1)).min(10),
});

const weighted = z.array(z.strictObject({ value: z.number().int(), w: z.number().positive() })).min(1);
const kickoffOutcomes = z.strictObject({
  note: z.string().optional(),
  classes: z.array(z.string()).length(8),
  weights: z.array(z.number().nonnegative()).length(8),
  returnEnd: weighted,
  fairCatchAt: weighted,
  kickersRecoverAt: weighted,
  returnSeconds: weighted,
});
export const kickoffSchema = z.strictObject({
  version: z.number().int(),
  designed: z.literal(true),
  tunedTo: z.number().int(),
  note: z.string().optional(),
  kickoff: kickoffOutcomes,
  safetyKick: kickoffOutcomes,
  onside: z.strictObject({
    note: z.string().optional(),
    recover: z.number().min(0).max(1),
    outOfBounds: z.number().min(0).max(1),
    kickersAt: weighted,
    receiversAt: weighted,
    seconds: weighted,
  }),
  fouls: z.record(z.string(), z.union([z.number().nonnegative(), z.string()])),
});

const knownSlots = new Set(Object.entries(TRACE_FIELDS).flatMap(([f, fields]) => (fields as readonly string[]).map((x) => `${f}.${x}`)));
const SLOT = /\{([a-zA-Z]+)\.([a-zA-Z]+)\}/g;

export const whySchema = z
  .strictObject({
    version: z.number().int(),
    designed: z.literal(true),
    note: z.string().optional(),
    minLogEffect: z.number().nonnegative(),
    order: z.array(z.string()),
    labels: z.record(z.string(), z.string()),
    templates: z.array(
      z.strictObject({
        id: z.string().min(1),
        when: z.string().min(1),
        kinds: z.array(z.string()).optional(),
        text: z.string().min(1),
        factors: z.array(z.string()),
      }),
    ),
  })
  .superRefine((w, ctx) => {
    for (const t of w.templates) {
      for (const m of t.text.matchAll(SLOT)) {
        if (!knownSlots.has(`${m[1]}.${m[2]}`)) ctx.addIssue({ code: "custom", message: `template ${t.id}: unknown trace field {${m[1]}.${m[2]}}` });
      }
      for (const f of t.factors) {
        if (!(f in TRACE_FIELDS)) ctx.addIssue({ code: "custom", message: `template ${t.id}: unknown factor ${f}` });
      }
    }
  });

const pairing = z.strictObject({
  pairs: z.enum(["noPlay", "sampled", "incompletePass"]),
  families: z.array(z.string()).min(1),
  spot: z.enum(["fitted", "passer"]).optional(),
  passerDepth: z.number().int().positive().optional(),
  onlyWhenBallDeadInField: z.boolean().optional(),
  note: z.string().optional(),
});

/** The parts of data/engine/config.json the engine reads. Other keys are the pipeline's. */
export const engineConfigSchema = z.looseObject({
  version: z.number().int(),
  designed: z.literal(true),
  dimensions: z.record(z.string(), dimensionSchema),
  families: z.record(z.string(), z.strictObject({ leaves: z.array(z.string()), classes: z.array(z.string()) })),
  punts: z.looseObject({ classes: z.array(z.string()), blockedEndBehindLine: z.number().int().nonnegative() }),
  fieldGoals: z.looseObject({ blockedEndBehindLine: z.number().int().nonnegative() }),
  durations: z.looseObject({ minSeconds: z.number().int().nonnegative(), maxSeconds: z.number().int().positive() }),
  fluke: z.strictObject({ classProbabilityBelow: z.number().min(0).max(1), yardsPercentile: z.number().min(0).max(1) }),
  penalties: z.looseObject({ pairing: z.record(z.string(), z.union([pairing, z.string()])) }),
});

// ---------------------------------------------------------------- generated files

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const cellMaps = z.array(z.record(z.string(), z.array(z.number().int())));
const hist = z.array(nonNeg);

export const baselineScrimmageSchema = z.looseObject({
  generated: z.literal(true),
  configHash: hash,
  seasons: z.array(z.number().int()),
  families: z.record(z.string(), z.strictObject({ leaves: z.array(z.string()), classes: z.array(z.string()) })),
  levels: z.array(levelSchema),
  cells: cellMaps,
  poolLevels: z.array(levelSchema),
  poolFields: z.array(z.string()),
  pools: cellMaps,
  durations: z.record(z.string(), z.record(z.string(), hist)),
  twoPoint: z.record(z.string(), z.looseObject({ source: z.string(), plays: z.number(), weights: z.array(nonNeg), pools: z.record(z.string(), z.array(z.number().int())) })),
  clock: z.record(z.string(), z.looseObject({ fields: z.array(z.string()), tuples: z.array(z.number().int()), plays: nonNeg })),
});

export const baselineSpecialSchema = z.looseObject({
  generated: z.literal(true),
  configHash: hash,
  punts: z.looseObject({
    classes: z.array(z.string()),
    levels: z.array(levelSchema),
    poolLevels: z.array(levelSchema),
    fields: z.array(z.string()),
    cells: cellMaps,
    pools: cellMaps,
    durations: z.record(z.string(), hist),
  }),
  fieldGoals: z.looseObject({
    minDistance: posInt,
    maxDistance: posInt,
    capAt: posInt,
    makePer10000: z.array(nonNeg),
    bands: z.array(z.strictObject({ label: z.string(), min: z.number().int(), max: z.number().int() })),
    blockPer10000: z.array(nonNeg),
    kickDepth: posInt,
    blockedPool: z.strictObject({ fields: z.array(z.string()), tuples: z.array(z.number().int()) }),
    durations: z.record(z.string(), hist),
  }),
  extraPoints: z.looseObject({ classes: z.array(z.string()), weights: z.array(nonNeg) }),
});

export const baselinePenaltiesSchema = z.looseObject({
  generated: z.literal(true),
  configHash: hash,
  ids: z.array(z.string()),
  levels: z.array(levelSchema),
  families: z.record(z.string(), cellMaps),
  doublePer1000000: nonNeg,
  offenseSharePer10000: z.record(z.string(), nonNeg),
  dpiYards: z.strictObject({ min: posInt, max: posInt, weights: z.array(nonNeg) }),
});

const perClass = z.array(z.number().positive());
export const matchupCenteredSchema = z.looseObject({
  generated: z.literal(true),
  matchupHash: hash,
  configHash: hash,
  matchup: z.record(z.string(), z.record(z.string(), perClass)),
  formation: z.record(z.string(), z.record(z.string(), z.record(z.string(), perClass))),
});

export const distributionsSchema = z.looseObject({
  generated: z.literal(true),
  schemaVersion: z.literal(1),
  ratingsHash: hash,
  draftClasses: z.strictObject({ from: z.number().int(), to: z.number().int() }),
  percentiles: z.array(z.number().gt(0).lt(1)).min(2),
  ratings: z.record(
    z.string(),
    z.record(z.string(), z.strictObject({ source: z.enum(["measured", "designed"]), mean: z.number(), p10: z.number(), p50: z.number(), p90: z.number() })),
  ),
  drills: z.record(z.string(), z.record(z.string(), z.strictObject({ cuts: z.array(z.number()).min(2), n: posInt }))),
});

export interface EngineFiles {
  readonly config: unknown;
  readonly scrimmage: unknown;
  readonly special: unknown;
  readonly penalties: unknown;
  readonly kickoff: unknown;
  readonly matchup: unknown;
  readonly personnel: unknown;
  readonly ratings: unknown;
  readonly distributions: unknown;
  readonly names: unknown;
  readonly why: unknown;
}

/** Validates every engine file. `rules` and `caller` come from their own parsers. */
export function parseEngineData(files: EngineFiles, rules: RuleSet, caller: CallerData): EngineData {
  return {
    rules,
    caller,
    config: engineConfigSchema.parse(files.config) as unknown as EngineConfig,
    scrimmage: baselineScrimmageSchema.parse(files.scrimmage) as unknown as BaselineScrimmage,
    special: baselineSpecialSchema.parse(files.special) as unknown as BaselineSpecial,
    penalties: baselinePenaltiesSchema.parse(files.penalties) as unknown as BaselinePenalties,
    kickoff: kickoffSchema.parse(files.kickoff) as unknown as KickoffTable,
    matchup: matchupCenteredSchema.parse(files.matchup) as unknown as MatchupCentered,
    personnel: personnelSchema.parse(files.personnel) as unknown as Personnel,
    ratings: ratingsSchema.parse(files.ratings) as unknown as RatingsConfig,
    distributions: distributionsSchema.parse(files.distributions) as unknown as Distributions,
    names: namesSchema.parse(files.names) as Names,
    why: whySchema.parse(files.why) as WhyTemplates,
  };
}
