// zod schemas for the M1 step 5 game files (data/game, data/teams). Validation happens here, at
// load; packages/sim receives already-validated data and never imports this file.

import { z } from "zod";
import type { EngineData } from "./engine";
import type { CoachTables, ExpectedPointsTable, GameConfig, GameData, LeagueSettings, OnsideTable, TeamNames, TempoTable, TimeoutTable } from "./game";

const condition = z.strictObject({ field: z.string().min(1), min: z.number().optional(), max: z.number().optional() });
const dim = z.union([
  z.strictObject({ exact: z.string().min(1) }),
  z.strictObject({ buckets: z.array(z.strictObject({ label: z.string().min(1).nullable(), if: z.array(condition) })).min(1) }),
]);
const level = z.strictObject({ dims: z.array(z.string().min(1)) });
const posInt = z.number().int().positive();
const nonNeg = z.number().int().nonnegative();
const rule = z.looseObject({ trailingBy: posInt, secondsLeftInGame: posInt, quarterMin: posInt });

export const gameConfigSchema = z
  .looseObject({
    schemaVersion: z.literal(2),
    designed: z.literal(true),
    seasons: z.looseObject({
      from: posInt,
      to: posInt,
      tempoFrom: posInt,
      neverTrainFrom: posInt,
      holdout: z.array(posInt).min(1),
      weightAnchor: posInt,
      halfLifeSeasons: z.number().positive(),
      homeFieldExclude: z.array(posInt),
    }),
    dimensions: z.record(z.string(), dim),
    tempo: z.looseObject({ levels: z.array(level).min(1), minN: posInt, maxSeconds: posInt, cellTotal: posInt }),
    timeouts: z.looseObject({ levels: z.array(level).min(1), minN: posInt }),
    specialTimeouts: z.looseObject({ levels: z.array(level).min(1), minN: posInt }).optional(),
    onside: z.looseObject({ levels: z.array(level).min(1), minN: posInt, designedRule: rule }),
    expectedPoints: z.looseObject({ levels: z.array(level).min(1), minN: posInt }),
    runoffTimeout: z.looseObject({ finalSeconds: posInt }),
    clockRules: z
      .looseObject({
        clockOut: z.strictObject({ trailingMin: posInt, trailingMax: posInt }).optional(),
        kneelOutDrain: z.boolean().optional(),
        kneelOutDrainWindow: z.strictObject({ quarterMin: posInt, secondsLeftInGame: posInt }).optional(),
        timeoutBeforeExpiry: z.boolean().optional(),
        callerMasks: z
          .looseObject({
            spikeNeedsRunningClock: z.boolean().optional(),
            earlyKneel: z.strictObject({ quarters: z.array(posInt), halfEndQuarter: posInt, secondsAbove: nonNeg }).optional(),
            lateKneel: z
              .strictObject({
                quarterMin: posInt,
                states: z
                  .array(
                    z.strictObject({
                      scoreMin: z.number().int().optional(),
                      scoreMax: z.number().int().optional(),
                      secondsAbove: nonNeg.optional(),
                      yardLine100Above: nonNeg.optional(),
                      // A designed mask needs a real count of exactly 0 (spec locked rule 4).
                      realKneels: z.literal(0),
                      realSnaps: posInt,
                    }),
                  )
                  .min(1),
              })
              .optional(),
          })
          .optional(),
      })
      .optional(),
    loop: z.looseObject({ maxInputsPerGame: posInt, maxScrimmageSnapsPerGame: posInt }),
    league: z.looseObject({ teams: posInt, leagues: posInt, gamesPerLeague: posInt, calibrationSeed: nonNeg, ciSliceGames: posInt }),
    driveResults: z.record(z.string(), z.union([z.array(z.string()), z.string()])),
  })
  .superRefine((c, ctx) => {
    for (const [name, t] of [["tempo", c.tempo], ["timeouts", c.timeouts], ["onside", c.onside], ["expectedPoints", c.expectedPoints]] as const) {
      for (const lv of t.levels) {
        for (const d of lv.dims) {
          if (d !== "side" && !(d in c.dimensions)) ctx.addIssue({ code: "custom", message: `${name} level uses unknown dimension ${d}` });
        }
      }
    }
    for (const lv of c.specialTimeouts?.levels ?? []) {
      for (const d of lv.dims) if (d !== "role" && !(d in c.dimensions)) ctx.addIssue({ code: "custom", message: `specialTimeouts level uses unknown dimension ${d}` });
    }
    if (c.seasons.to >= c.seasons.neverTrainFrom) ctx.addIssue({ code: "custom", message: "fitted seasons reach the holdout" });
  });

function cells(width: number | null) {
  return z.array(z.record(z.string(), z.array(nonNeg).refine((v) => width === null || v.length === width, `cells need ${width} values`)));
}

export const tempoTableSchema = z
  .looseObject({ generated: z.literal(true), levels: z.array(level).min(1), minN: posInt, maxSeconds: posInt, cellTotal: posInt, cells: cells(null) })
  .superRefine((t, ctx) => {
    if (t.cells.length !== t.levels.length) ctx.addIssue({ code: "custom", message: "one cell map per level" });
    for (const m of t.cells) {
      for (const [k, v] of Object.entries(m)) {
        if (v.length !== t.maxSeconds + 1) ctx.addIssue({ code: "custom", message: `tempo cell ${k} needs ${t.maxSeconds + 1} weights` });
        if (v.reduce((a, b) => a + b, 0) !== t.cellTotal) ctx.addIssue({ code: "custom", message: `tempo cell ${k} does not sum to ${t.cellTotal}` });
      }
    }
  });

export const rateTableSchema = z
  .looseObject({ generated: z.literal(true), levels: z.array(level).min(1), minN: posInt, cells: cells(2) })
  .superRefine((t, ctx) => {
    if (t.cells.length !== t.levels.length) ctx.addIssue({ code: "custom", message: "one cell map per level" });
    for (const m of t.cells) for (const [k, v] of Object.entries(m)) if ((v[0] ?? 0) > 1_000_000) ctx.addIssue({ code: "custom", message: `rate ${k} above 1` });
  });

export const epTableSchema = z
  .looseObject({ generated: z.literal(true), scale: posInt, levels: z.array(level).min(1), minN: posInt, cells: z.array(z.record(z.string(), z.array(z.number().int()).length(2))) })
  .superRefine((t, ctx) => {
    if (t.cells.length !== t.levels.length) ctx.addIssue({ code: "custom", message: "one cell map per level" });
  });

export const timeoutTableSchema = rateTableSchema.and(
  z.looseObject({
    beforeKickoffOrTry: z.strictObject(
      Object.fromEntries(["kickKicker", "kickReceiver", "tryOffense", "tryDefense"].map((k) => [k, z.array(nonNeg).length(2)])) as Record<string, z.ZodArray<z.ZodNumber>>,
    ),
    special: z
      .looseObject({ levels: z.array(level).min(1), minN: posInt, cells: cells(2) })
      .refine((t) => t.cells.length === t.levels.length, "one cell map per level")
      .optional(),
  }),
);

export const onsideTableSchema = rateTableSchema.and(z.looseObject({ designedRule: rule }));

export const leagueSettingsSchema = z.looseObject({
  schemaVersion: z.literal(1),
  designed: z.literal(true),
  homeField: z.strictObject({ ratingEdge: z.number().min(0).max(20), crowdNoise: z.number().min(0).lt(1) }),
  teamStrength: z.strictObject({ sd: z.number().min(0).max(20) }),
  tuning: z.record(z.string(), z.unknown()),
});

export const teamNamesSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    designed: z.literal(true),
    note: z.string().optional(),
    teams: z.array(z.strictObject({ place: z.string().min(1), nickname: z.string().min(1) })).min(2),
  })
  .superRefine((t, ctx) => {
    const seen = new Set<string>();
    for (const n of t.teams) {
      const full = `${n.place} ${n.nickname}`.toLowerCase();
      if (seen.has(full)) ctx.addIssue({ code: "custom", message: `duplicate team name ${full}` });
      seen.add(full);
    }
    const nick = new Set(t.teams.map((n) => n.nickname.toLowerCase()));
    if (nick.size !== t.teams.length) ctx.addIssue({ code: "custom", message: "nicknames must be unique" });
  });

export interface GameFiles {
  readonly config: unknown;
  readonly tempo: unknown;
  readonly timeouts: unknown;
  readonly onside: unknown;
  readonly ep: unknown;
  readonly league: unknown;
  readonly teamNames: unknown;
}

export function parseGameData(files: GameFiles, engine: EngineData, rulesHash: string, dataHashes: Readonly<Record<string, string>>): GameData {
  const tables: CoachTables = {
    ep: epTableSchema.parse(files.ep) as unknown as ExpectedPointsTable,
    tempo: tempoTableSchema.parse(files.tempo) as unknown as TempoTable,
    timeouts: timeoutTableSchema.parse(files.timeouts) as unknown as TimeoutTable,
    onside: onsideTableSchema.parse(files.onside) as unknown as OnsideTable,
  };
  return {
    engine,
    config: gameConfigSchema.parse(files.config) as unknown as GameConfig,
    tables,
    league: leagueSettingsSchema.parse(files.league) as unknown as LeagueSettings,
    teamNames: teamNamesSchema.parse(files.teamNames) as unknown as TeamNames,
    rulesHash,
    dataHashes,
  };
}
