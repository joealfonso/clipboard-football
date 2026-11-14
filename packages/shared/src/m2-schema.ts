// zod schemas for what the M2 UI reads from the sim (docs/specs/m2-playable-game-design.md,
// "Needs from the engine"): who made each play and who was on the field (needs 2 and 4), the
// per-player box score and rating ranks (needs 8 and 11). The worker side can validate messages
// with these; packages/sim never imports this file. Types: play.ts, stats.ts.

import { z } from "zod";
import { POSITIONS } from "./engine";
import { PARTICIPANT_ROLES, type OnField, type Participants } from "./play";
import type { PlayerBoxScore, RatingRanks } from "./game";

const id = z.string().min(1);
const count = z.number().int().nonnegative();

// ---------------------------------------------------------------- needs 2 and 4

export const playParticipantsSchema = z.strictObject({
  ...(Object.fromEntries(PARTICIPANT_ROLES.map((r) => [r, id.optional()])) as Record<(typeof PARTICIPANT_ROLES)[number], z.ZodOptional<typeof id>>),
  foulers: z.array(id).min(1).optional(),
});

const onFieldSide = z.partialRecord(z.enum(POSITIONS), z.array(id).min(1));
export const onFieldSchema = z.strictObject({ offense: onFieldSide, defense: onFieldSide });

export function parseParticipants(json: unknown): Participants {
  return playParticipantsSchema.parse(json) as Participants;
}

export function parseOnField(json: unknown): OnField {
  return onFieldSchema.parse(json) as OnField;
}

// ---------------------------------------------------------------- needs 8 and 11

const passing = z.strictObject({ completions: count, attempts: count, yards: z.number().int(), touchdowns: count, interceptions: count, sacked: count, sackYards: z.number().int() });
const rushing = z.strictObject({ attempts: count, yards: z.number().int(), touchdowns: count, long: z.number().int() });
const receiving = z.strictObject({ targets: count, catches: count, yards: z.number().int(), touchdowns: count, long: z.number().int().optional() });
const defense = z.strictObject({ tackles: count, sacks: count, interceptions: count, forcedFumbles: count, recoveries: count });
const kicking = z.strictObject({ fieldGoalsMade: count, fieldGoalAttempts: count, long: z.number().int().optional(), extraPointsMade: count, extraPointAttempts: count });
const punting = z.strictObject({ punts: count, yards: z.number().int(), average: z.number() });

export const playerLineSchema = z.strictObject({
  id,
  team: z.enum(["home", "away"]),
  passing: passing.optional(),
  rushing: rushing.optional(),
  receiving: receiving.optional(),
  defense: defense.optional(),
  kicking: kicking.optional(),
  punting: punting.optional(),
});

export const playerBoxScoreSchema = z.strictObject({ players: z.record(id, playerLineSchema) });

export const ratingRanksSchema = z.record(id, z.record(z.string(), z.strictObject({ value: z.number().int(), rank: z.number().int().positive(), of: z.number().int().positive() })));

export function parsePlayerBoxScore(json: unknown): PlayerBoxScore {
  return playerBoxScoreSchema.parse(json) as PlayerBoxScore;
}

export function parseRatingRanks(json: unknown): RatingRanks {
  return ratingRanksSchema.parse(json) as RatingRanks;
}
