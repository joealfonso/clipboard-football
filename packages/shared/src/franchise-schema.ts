// zod schemas for the Franchise mode data files (data/franchise, and the overall weights in
// data/ui/templates.json). Validation happens here, at load; packages/sim receives
// already-validated data and never imports this file.

import { z } from "zod";
import { BASE_RATINGS, jerseyNumberAllowed, POSITION_SKILLS, POSITIONS } from "./engine";
import type { ParticipantsConfig, Personnel, Position, Slots, StandoutKindId } from "./engine";
import { poolCount, ROSTER_UNITS } from "./franchise";
import type { DraftAiConfig, FranchiseData, FranchiseLeagueConfig, OverallWeights, PoolConfig, RosterConfig } from "./franchise";
import type { GameData } from "./game";

const position = z.enum(POSITIONS);
const posInt = z.number().int().positive();
const byPosition = <T extends z.ZodType>(value: T) => z.strictObject(Object.fromEntries(POSITIONS.map((p) => [p, value])) as Record<Position, T>);

function unique(xs: readonly string[], what: string, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const x of xs) {
    const k = x.trim().toLowerCase();
    if (seen.has(k)) ctx.addIssue({ code: "custom", message: `${what} ${x} is listed twice` });
    seen.add(k);
  }
}

export const franchiseLeagueSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    designed: z.literal(true),
    note: z.string().optional(),
    conferences: z.array(z.strictObject({ id: z.string().min(1), name: z.string().min(1) })).min(1),
    divisions: z.array(z.string().min(1)).min(1),
    teamsPerDivision: posInt,
    titleGame: z.string().min(1),
    placement: z.literal("seededShuffle"),
  })
  .superRefine((l, ctx) => {
    unique(l.conferences.map((c) => c.id), "conference id", ctx);
    unique(l.conferences.map((c) => c.name), "conference", ctx);
    unique(l.divisions, "division", ctx);
    if (l.conferences.length * l.divisions.length * l.teamsPerDivision < 2) ctx.addIssue({ code: "custom", message: "a league needs at least two teams" });
  });

export const rosterSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    designed: z.literal(true),
    note: z.string().optional(),
    rosterSize: posInt,
    /** The citation for the roster size (docs/RULES.md). */
    rosterSizeSource: z.string().min(1),
    positions: byPosition(z.strictObject({ target: z.number().int().nonnegative(), max: z.number().int().nonnegative() })),
    units: z.strictObject(Object.fromEntries(ROSTER_UNITS.map((u) => [u, z.array(position).min(1)])) as Record<(typeof ROSTER_UNITS)[number], z.ZodArray<typeof position>>),
  })
  .superRefine((r, ctx) => {
    const sum = POSITIONS.reduce((s, p) => s + r.positions[p].target, 0);
    if (sum !== r.rosterSize) ctx.addIssue({ code: "custom", message: `position targets sum to ${sum}, rosterSize is ${r.rosterSize}` });
    for (const p of POSITIONS) {
      if (r.positions[p].target > r.positions[p].max) ctx.addIssue({ code: "custom", message: `${p}: target ${r.positions[p].target} is above max ${r.positions[p].max}` });
    }
    const inUnit = ROSTER_UNITS.flatMap((u) => r.units[u]);
    for (const p of POSITIONS) {
      const n = inUnit.filter((x) => x === p).length;
      if (n !== 1) ctx.addIssue({ code: "custom", message: `${p} must be in exactly one unit, it is in ${n}` });
    }
  });

const STANDOUT_KINDS: Readonly<Record<StandoutKindId, true>> = { breakawayRun: true, bigCatch: true, sack: true, pick: true, longKick: true };

export const poolSchema = z.strictObject({
  schemaVersion: z.literal(1),
  designed: z.literal(true),
  note: z.string().optional(),
  surplus: z.number().min(0).max(4),
  // parseFranchiseData holds the rating names to the position's overall weights.
  adjust: byPosition(z.record(z.string(), z.strictObject({ scale: z.number().positive(), offset: z.number().min(-99).max(99) }))),
  floor: z.number().int().min(0).max(99),
  standoutCentering: z.strictObject(Object.fromEntries(Object.keys(STANDOUT_KINDS).map((k) => [k, z.number().positive()])) as Record<StandoutKindId, z.ZodNumber>),
  names: z.strictObject({ unique: z.literal(true), maxRedraws: z.number().int().nonnegative() }),
  tuning: z.strictObject({
    date: z.string().min(1),
    command: z.string().min(1),
    firstSeed: posInt,
    leagues: posInt,
    passes: z.number().int().nonnegative(),
    worstMean: z.number().min(0),
    worstSd: z.number().min(0),
    draftAiSha256: z.string().min(1),
    rosterSha256: z.string().min(1),
    note: z.string().optional(),
  }),
});

/** The largest evaluation error SD a file may ask for, in points of overall (the spec's cap). */
export const EVALUATION_ERROR_CAP = 8;
const errorSd = z.number().min(0).max(EVALUATION_ERROR_CAP);

export const draftAiSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    designed: z.literal(true),
    note: z.string().optional(),
    positionValue: byPosition(z.number().positive()),
    // Points (overall, value), overall rising from 0 to 99 and value never falling; see DraftAiConfig.valueCurve.
    valueCurve: z.partialRecord(position, z.array(z.tuple([z.number().int().min(0).max(99), z.number().min(0)])).min(2)).optional(),
    // parseFranchiseData holds each list's length to the position's target.
    slotNeed: byPosition(z.array(z.number().min(0))),
    evaluation: z.strictObject({ errorSdMin: errorSd, errorSdMax: errorSd }),
    styles: z.record(z.string().min(1), z.strictObject({ weight: z.number().positive(), value: z.partialRecord(position, z.number().positive()).optional(), need: z.number().min(0).optional() })),
    autoPick: z.strictObject({ style: z.string(), errorSd }),
  })
  .superRefine((ai, ctx) => {
    for (const [p, points] of Object.entries(ai.valueCurve ?? {})) {
      const first = points[0] as readonly [number, number];
      const last = points[points.length - 1] as readonly [number, number];
      if (first[0] !== 0 || last[0] !== 99) ctx.addIssue({ code: "custom", message: `valueCurve.${p} must run from overall 0 to 99` });
      for (let i = 1; i < points.length; i++) {
        const [o, v] = points[i] as readonly [number, number];
        const [po, pv] = points[i - 1] as readonly [number, number];
        if (o <= po) ctx.addIssue({ code: "custom", message: `valueCurve.${p}: overall does not rise at point ${i + 1}` });
        if (v < pv) ctx.addIssue({ code: "custom", message: `valueCurve.${p}: value falls at point ${i + 1}` });
      }
    }
    for (const p of POSITIONS) {
      const list = ai.slotNeed[p];
      for (let i = 1; i < list.length; i++) {
        if ((list[i] as number) > (list[i - 1] as number)) ctx.addIssue({ code: "custom", message: `slotNeed.${p} rises at slot ${i + 1}` });
      }
    }
    if (ai.evaluation.errorSdMin > ai.evaluation.errorSdMax) ctx.addIssue({ code: "custom", message: "evaluation: errorSdMin is above errorSdMax" });
    if (!Object.hasOwn(ai.styles, ai.autoPick.style)) ctx.addIssue({ code: "custom", message: `autoPick.style ${ai.autoPick.style} is not a style` });
  });

/** data/ui/templates.json `overallWeights`: every position, that position's own ratings, positive weights. */
export const overallWeightsSchema = byPosition(z.record(z.string(), z.number().positive())).superRefine((w, ctx) => {
  for (const p of POSITIONS) {
    const known: readonly string[] = [...BASE_RATINGS, ...POSITION_SKILLS[p]];
    const rs = Object.keys(w[p]);
    if (rs.length === 0) ctx.addIssue({ code: "custom", message: `overallWeights.${p} is empty` });
    for (const r of rs) if (!known.includes(r)) ctx.addIssue({ code: "custom", message: `overallWeights.${p}: ${r} is not a ${p} rating` });
  }
});

/**
 * The most players of each position any unit puts on the field: the roster minimums. The same
 * rule as the sim's `slotNeeds` over personnel.json and the return units (a test holds the two
 * together), written here because shared cannot import the sim.
 */
export function positionMinimums(personnel: Pick<Personnel, "offense" | "kick" | "packages">, participants: Pick<ParticipantsConfig, "returnUnits">): Record<Position, number> {
  const need = Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>;
  const groups: Slots[] = [...Object.values(personnel.offense), ...Object.values(personnel.kick), ...Object.values(personnel.packages), ...Object.values(participants.returnUnits)];
  for (const g of groups) for (const p of POSITIONS) need[p] = Math.max(need[p], g[p] ?? 0);
  return need;
}

export interface FranchiseFiles {
  readonly league: unknown;
  readonly roster: unknown;
  readonly pool: unknown;
  readonly draftAi: unknown;
  /** The `overallWeights` block of data/ui/templates.json. */
  readonly overallWeights: unknown;
}

export class FranchiseDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FranchiseDataError";
  }
}

/**
 * Parses every franchise file and checks them against each other and against the game data. Data on
 * which no full draft exists is refused: every team at its targets is one, because the targets sum
 * to rosterSize, sit inside min and max, and the pool holds at least teams x target per position.
 */
export function parseFranchiseData(files: FranchiseFiles, game: GameData): FranchiseData {
  const league: FranchiseLeagueConfig = franchiseLeagueSchema.parse(files.league);
  const roster: RosterConfig = rosterSchema.parse(files.roster);
  const pool: PoolConfig = poolSchema.parse(files.pool);
  const draftAi: DraftAiConfig = draftAiSchema.parse(files.draftAi);
  const overallWeights: OverallWeights = overallWeightsSchema.parse(files.overallWeights);

  const teams = league.conferences.length * league.divisions.length * league.teamsPerDivision;
  if (game.teamNames.teams.length < teams) throw new FranchiseDataError(`the league has ${teams} teams, data/teams/names.json has ${game.teamNames.teams.length} names`);

  const min = positionMinimums(game.engine.personnel, game.engine.participants);
  let players = 0;
  for (const p of POSITIONS) {
    const { target, max } = roster.positions[p];
    if (min[p] > target) throw new FranchiseDataError(`${p}: target ${target} is below the ${min[p]} the engine puts on the field`);
    let numbers = 0;
    for (let n = 0; n <= 99; n++) if (jerseyNumberAllowed(game.engine.rules, p, n)) numbers++;
    if (numbers < max) throw new FranchiseDataError(`${p}: max ${max} is above the ${numbers} jersey numbers the position may wear`);
    players += poolCount(teams, target, min[p], pool.surplus);
  }
  for (const p of POSITIONS) {
    for (const r of Object.keys(pool.adjust[p])) if (!Object.hasOwn(overallWeights[p] ?? {}, r)) throw new FranchiseDataError(`pool adjust.${p}: ${r} is not a rating the ${p} overall weighs`);
    const { target } = roster.positions[p];
    if (draftAi.slotNeed[p].length !== target) throw new FranchiseDataError(`draft-ai slotNeed.${p} has ${draftAi.slotNeed[p].length} slots, the target is ${target}`);
  }
  const pairs = game.engine.names.first.length * game.engine.names.last.length;
  if (pairs < players) throw new FranchiseDataError(`the pool has ${players} players, the name lists give ${pairs} unique full names`);
  return { game, league, roster, pool, draftAi, overallWeights };
}
