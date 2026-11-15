// zod schemas for what the M2 UI reads from the sim (docs/specs/m2-playable-game-design.md,
// "Needs from the engine"): the step-wise loop's requests and answers (need 1), who made each
// play and who was on the field (needs 2 and 4), the per-player box score and rating ranks
// (needs 8 and 11). The worker side can validate messages
// with these; packages/sim never imports this file. Types: play.ts, stats.ts.

import { z } from "zod";
import { MAX_CHOICES_PER_SCREEN } from "./catalog";
import { POSITIONS } from "./engine";
import { REASON_CODES, TEMPOS, type DecisionAnswer, type DecisionRequest } from "./game";
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

const wonLost = z.strictObject({ won: count, lost: count });
export const playerBoxScoreSchema = z.strictObject({ players: z.record(id, playerLineSchema), challenges: z.strictObject({ home: wonLost, away: wonLost }).optional() });

export const ratingRanksSchema = z.record(id, z.record(z.string(), z.strictObject({ value: z.number().int(), rank: z.number().int().positive(), of: z.number().int().positive() })));

export function parsePlayerBoxScore(json: unknown): PlayerBoxScore {
  return playerBoxScoreSchema.parse(json) as PlayerBoxScore;
}

export function parseRatingRanks(json: unknown): RatingRanks {
  return ratingRanksSchema.parse(json) as RatingRanks;
}

// ---------------------------------------------------------------- need 1: the step-wise loop

const team = z.enum(["home", "away"]);
const option = z
  .strictObject({ id, legal: z.boolean(), reason: z.enum(REASON_CODES).optional(), opens: id.optional() })
  .refine((o) => (o.reason !== undefined) === !o.legal, { message: "an option has a reason exactly when it is off" });
const screen = z.strictObject({ id, options: z.array(option).min(1).max(MAX_CHOICES_PER_SCREEN - 1) });
const offenseCall = z.strictObject({ call: id, formation: id.optional(), twoPointPlay: id.optional() });
const preview = z.strictObject({
  phase: z.enum(["kickoff", "scrimmage", "try", "overtimeToss", "final"]),
  possession: team,
  spot: z.number().int(),
  down: z.number().int(),
  distance: z.number().int(),
  score: z.strictObject({ home: count, away: count }),
});
const requestState = z.strictObject({
  period: z.number().int().positive(),
  clock: count,
  clockRunning: z.boolean(),
  phase: z.enum(["kickoff", "scrimmage", "try", "overtimeToss", "final"]),
  possession: team,
  spot: z.number().int(),
  down: count,
  distance: count,
  goalToGo: z.boolean(),
  score: z.strictObject({ home: count, away: count }),
  timeouts: z.strictObject({ home: count, away: count }),
  safetyKick: z.boolean(),
});
const requestEvent = z.discriminatedUnion("t", [
  z.strictObject({ t: z.literal("runoff"), seconds: count }),
  z.strictObject({ t: z.literal("timeout"), team, side: z.enum(["offense", "defense"]), left: count }),
  z.strictObject({ t: z.literal("twoMinuteWarning"), period: z.number().int().positive() }),
  z.strictObject({ t: z.literal("endPeriod"), period: z.number().int().positive() }),
]);
const base = { seq: z.number().int().positive(), state: requestState.nullable(), events: z.array(requestEvent), team, screens: z.array(screen).min(1) };
const about = z.discriminatedUnion("what", [
  z.strictObject({ what: z.literal("tossResult"), winner: team, choice: z.enum(["receive", "kick", "defer"]) }),
  z.strictObject({ what: z.literal("theyKickOff"), onside: z.boolean(), safetyKick: z.boolean() }),
  z.strictObject({ what: z.literal("theyLineUp"), call: id }),
  z.strictObject({ what: z.literal("underReview"), kind: id, question: z.string().min(1), by: z.enum(["you", "them", "booth"]) }),
  z.strictObject({ what: z.literal("reviewResult"), kind: id, by: z.enum(["you", "them", "booth"]), verdict: z.enum(["stands", "reversed"]), play: z.looseObject({ kind: z.string() }), timeoutCharged: z.boolean() }),
]);
/** The PlayResult is checked as an object here; its own shape is the sim's contract (play.ts). */
const play = z.looseObject({ kind: z.string() });

export const decisionRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...base, kind: z.literal("toss") }),
  z.strictObject({ ...base, kind: z.literal("overtimeToss") }),
  z.strictObject({ ...base, kind: z.literal("kickoff"), safetyKick: z.boolean() }),
  z.strictObject({ ...base, kind: z.literal("try"), sameCall: offenseCall.nullable() }),
  z.strictObject({ ...base, kind: z.literal("offenseCall"), tempo: z.enum(TEMPOS), clockRunning: z.boolean(), sameCall: offenseCall.nullable(), fieldGoalYards: z.number().int() }),
  z.strictObject({ ...base, kind: z.literal("defenseCall"), onTry: z.boolean(), sameCall: id.nullable() }),
  z.strictObject({ ...base, kind: z.literal("penalty"), play, offenseCall, defenseCall: id.nullable(), outcomes: z.array(z.strictObject({ option: id, after: preview })).min(2) }),
  z.strictObject({ ...base, kind: z.literal("runoff"), play, offenseCall, defenseCall: id.nullable(), clock: count, clockAfter: count }),
  z.strictObject({ ...base, kind: z.literal("continue"), about }),
  z.strictObject({
    ...base,
    kind: z.literal("challenge"),
    closeCall: z.strictObject({ kind: id, question: z.string().min(1) }),
    // The ruling on the field: its closeCall must not carry the verdict (G6).
    play: z.looseObject({ kind: z.string(), detail: z.looseObject({ closeCall: z.looseObject({ kind: id }).refine((c) => !("verdict" in c), { message: "a challenge request shows the verdict" }) }) }),
    offenseCall,
    defenseCall: id.nullable(),
    challengesLeft: z.number().int().positive(),
    timeoutsLeft: count,
    failedCostsTimeout: z.boolean(),
  }),
]);

export const decisionAnswerSchema = z.strictObject({ seq: z.number().int().positive(), path: z.array(id).min(1) });

export function parseDecisionRequest(json: unknown): DecisionRequest {
  return decisionRequestSchema.parse(json) as DecisionRequest;
}

export function parseDecisionAnswer(json: unknown): DecisionAnswer {
  return decisionAnswerSchema.parse(json) as DecisionAnswer;
}
