// zod schemas for the catalog, the caller config and the generated caller tables.
// Validation happens here, at load. packages/sim receives already-validated data and never
// imports this file (a test enforces that).

import { z } from "zod";
import type { CallerConfig, CallerTables } from "./caller";
import { CELL_TOTAL, CONTEXT_DIMENSIONS, FACTOR_IDS } from "./caller";
import type { Catalog, Rule } from "./catalog";
import { MAX_CHOICES_PER_SCREEN } from "./catalog";
import { SITUATION_FIELDS } from "./situation";

const numericFields = SITUATION_FIELDS.filter((f) => f !== "phase") as [
  Exclude<(typeof SITUATION_FIELDS)[number], "phase">,
  ...Exclude<(typeof SITUATION_FIELDS)[number], "phase">[],
];

const compareRuleSchema = z.union([
  z.strictObject({
    field: z.literal("phase"),
    op: z.enum(["eq", "ne"]),
    value: z.enum(["scrimmage", "try"]),
  }),
  z.strictObject({
    field: z.enum(numericFields),
    op: z.enum(["eq", "ne", "lt", "lte", "gt", "gte"]),
    value: z.number(),
  }),
]);

export const ruleSchema: z.ZodType<Rule> = z.lazy(() =>
  z.union([
    compareRuleSchema,
    z.strictObject({ all: z.array(ruleSchema).min(1) }),
    z.strictObject({ any: z.array(ruleSchema).min(1) }),
    z.strictObject({ not: ruleSchema }),
  ]),
);

const choiceSchema = z.strictObject({
  key: z.number().int(),
  id: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  label: z.string().min(1),
  description: z.string().min(1),
  opens: z.string().optional(),
  availableWhen: ruleSchema.optional(),
});

const screenSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  side: z.enum(["offense", "defense"]),
  when: z.string().min(1),
  choices: z.array(choiceSchema).min(1).max(MAX_CHOICES_PER_SCREEN),
});

export const catalogSchema = z
  .strictObject({
    version: z.number().int(),
    designed: z.literal(true),
    roots: z.array(z.string()).min(1),
    screens: z.array(screenSchema).min(1),
  })
  .superRefine((cat, ctx) => {
    const screenIds = new Set<string>();
    for (const s of cat.screens) {
      if (screenIds.has(s.id)) ctx.addIssue({ code: "custom", message: `duplicate screen id ${s.id}` });
      screenIds.add(s.id);
    }
    const choiceIds = new Set<string>();
    for (const s of cat.screens) {
      s.choices.forEach((c, i) => {
        if (c.key !== i + 1) {
          ctx.addIssue({
            code: "custom",
            message: `screen ${s.id}: choice ${c.id} has key ${c.key}, expected ${i + 1} (keys must be 1..n with no gaps or duplicates)`,
          });
        }
        if (choiceIds.has(c.id)) ctx.addIssue({ code: "custom", message: `duplicate choice id ${c.id}` });
        choiceIds.add(c.id);
        if (c.opens !== undefined && !screenIds.has(c.opens)) {
          ctx.addIssue({ code: "custom", message: `choice ${c.id} opens unknown screen ${c.opens}` });
        }
      });
    }
    for (const r of cat.roots) {
      if (!screenIds.has(r)) ctx.addIssue({ code: "custom", message: `unknown root screen ${r}` });
    }
    // Every screen must be reachable from a root.
    const byId = new Map(cat.screens.map((s) => [s.id, s]));
    const seen = new Set<string>();
    const stack = cat.roots.filter((r) => byId.has(r));
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const c of byId.get(id)?.choices ?? []) if (c.opens !== undefined) stack.push(c.opens);
    }
    for (const s of cat.screens) {
      if (!seen.has(s.id)) ctx.addIssue({ code: "custom", message: `screen ${s.id} is not reachable from a root` });
    }
  });

const rangeBucket = z.strictObject({
  label: z.string().min(1),
  min: z.number().int().nullable(),
  max: z.number().int().nullable(),
});
const phases = z.array(z.enum(["scrimmage", "try"])).min(1);

export const dimensionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("exact"), field: z.enum(numericFields), phases }),
  z.strictObject({
    type: z.literal("range"),
    field: z.enum(numericFields),
    phases,
    buckets: z.array(rangeBucket).min(1),
    coarseOf: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal("clip"),
    field: z.enum(numericFields),
    phases,
    min: z.number().int(),
    max: z.number().int(),
    coarse: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal("rules"),
    phases,
    buckets: z
      .array(
        rangeBucket.extend({
          quarterMin: z.number().int(),
          quarterMax: z.number().int(),
          field: z.enum(numericFields),
        }),
      )
      .min(1),
  }),
  z.strictObject({
    type: z.literal("group"),
    of: z.string(),
    phases,
    groups: z.array(z.strictObject({ label: z.string(), members: z.array(z.string()).min(1) })).min(1),
  }),
  z.strictObject({
    type: z.literal("endState"),
    of: z.string(),
    phases,
    appliesTo: z.array(z.string()).min(1),
    otherwise: z.string(),
    parts: z.array(z.strictObject({ field: z.enum(numericFields), buckets: z.array(rangeBucket).min(1) })).min(1),
  }),
]);

export const levelSchema = z.strictObject({ tag: z.string().optional(), dims: z.array(z.string()) });
const seasonRange = z.strictObject({ from: z.number().int(), to: z.number().int() });

const factorSchema = z.strictObject({
  side: z.enum(["offense", "defense"]),
  predicts: z.string(),
  downs: z.array(z.number().int().min(1).max(4)).min(1).optional(),
  seasons: seasonRange.extend({ byDown: z.record(z.string(), seasonRange).optional() }),
  minPlays: z.number().int().positive(),
  targets: z.array(z.string()).min(2),
  levels: z.array(levelSchema).min(1),
});

const presetCell = z.union([
  z.string(),
  z.strictObject({ if: z.enum(["boxHeavy", "blitz"]), then: z.string(), else: z.string() }),
]);

const factorsShape = Object.fromEntries(FACTOR_IDS.map((id) => [id, factorSchema])) as Record<
  (typeof FACTOR_IDS)[number],
  typeof factorSchema
>;

export const callerConfigSchema = z
  .strictObject({
    version: z.number().int(),
    designed: z.literal(true),
    seasons: z.strictObject({
      weightAnchor: z.number().int(),
      halfLifeSeasons: z.number().positive(),
      holdout: z.array(z.number().int()),
      neverTrainFrom: z.number().int(),
      seasonType: z.string(),
    }),
    dimensions: z.record(z.string(), dimensionSchema),
    tags: z.record(z.string(), z.unknown()),
    factors: z.strictObject(factorsShape),
    offenseMapping: z.record(z.string(), z.unknown()),
    defenseMapping: z.strictObject({
      coverage: z.record(z.string(), z.string().nullable()),
      manZone: z.record(z.string(), z.string().nullable()),
      groups: z.strictObject({
        goalLineMaxDB: z.number().int(),
        base: z.number().int(),
        nickel: z.number().int(),
        dime: z.number().int(),
        preventMinDB: z.number().int(),
      }),
      boxHeavyMin: z.number().int(),
      blitzMinRushers: z.number().int(),
      presetTable: z.strictObject({
        base: z.record(z.string(), presetCell),
        nickel: z.record(z.string(), presetCell),
        dime: z.record(z.string(), presetCell),
      }),
      presets: z.record(
        z.string(),
        z.strictObject({
          group: z.string(),
          box: z.string(),
          shell: z.string(),
          manZone: z.string(),
          rush: z.string(),
        }),
      ),
    }),
  })
  .superRefine((cfg, ctx) => {
    const known = new Set<string>([...Object.keys(cfg.dimensions), ...CONTEXT_DIMENSIONS]);
    for (const [id, f] of Object.entries(cfg.factors)) {
      for (const level of f.levels) {
        for (const d of level.dims) {
          if (!known.has(d)) ctx.addIssue({ code: "custom", message: `factor ${id} uses unknown dimension ${d}` });
        }
      }
      if (f.levels.at(-1)?.dims.length !== 0 || f.levels.at(-1)?.tag !== undefined) {
        ctx.addIssue({ code: "custom", message: `factor ${id}: last level must be the global level` });
      }
      if (f.seasons.to >= cfg.seasons.neverTrainFrom) {
        ctx.addIssue({ code: "custom", message: `factor ${id} trains on ${f.seasons.to}` });
      }
    }
  });

const factorTableSchema = z
  .strictObject({
    targets: z.array(z.string()).min(2),
    levels: z.array(levelSchema).min(1),
    minPlays: z.number().int().positive(),
    seasons: z.array(z.number().int()),
    seasonWeights: z.record(z.string(), z.number().positive()),
    byDown: z.record(z.string(), seasonRange).optional(),
    downs: z.array(z.number().int()).optional(),
    plays: z.number().int().nonnegative(),
    cells: z.array(z.record(z.string(), z.array(z.number().int().nonnegative()))),
  })
  .superRefine((t, ctx) => {
    if (t.cells.length !== t.levels.length) {
      ctx.addIssue({ code: "custom", message: "one cell map per level" });
    }
    t.cells.forEach((level, i) => {
      for (const [key, w] of Object.entries(level)) {
        const sum = w.reduce((a, b) => a + b, 0);
        if (w.length !== t.targets.length || sum !== CELL_TOTAL) {
          ctx.addIssue({ code: "custom", message: `level ${i} cell "${key}": ${w.length} weights summing to ${sum}` });
        }
      }
    });
    if (!("" in (t.cells.at(-1) ?? {}))) {
      ctx.addIssue({ code: "custom", message: "the global cell must exist" });
    }
  });

const factorTablesShape = Object.fromEntries(FACTOR_IDS.map((id) => [id, factorTableSchema.optional()])) as Record<
  (typeof FACTOR_IDS)[number],
  z.ZodOptional<typeof factorTableSchema>
>;

export const callerTablesSchema = z.strictObject({
  generated: z.literal(true),
  side: z.enum(["offense", "defense"]),
  configHash: z.string().regex(/^[0-9a-f]{64}$/),
  halfLifeSeasons: z.number().positive(),
  weightAnchor: z.number().int(),
  factors: z.strictObject(factorTablesShape),
});

export function parseCatalog(json: unknown): Catalog {
  return catalogSchema.parse(json) as Catalog;
}

export function parseCallerConfig(json: unknown): CallerConfig {
  return callerConfigSchema.parse(json) as CallerConfig;
}

export function parseCallerTables(json: unknown): CallerTables {
  return callerTablesSchema.parse(json) as CallerTables;
}
