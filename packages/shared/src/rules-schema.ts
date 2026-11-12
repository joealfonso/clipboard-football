// zod schema for a rule set file. Validation happens here, at load; packages/sim receives an
// already-validated RuleSet and never imports this file.

import { z } from "zod";
import type { RuleSet } from "./rules";

const count = z.number().int().nonnegative();
const positive = z.number().int().positive();
/** A yard line in a team's own frame where the ball can be snapped. */
const fieldSpot = z.number().int().min(1).max(99);
const regulationPeriod = z.number().int().min(1);
const enforcementSpot = z.enum(["previousSpot", "spotOfFoul", "endOfRun", "succeedingSpot", "deadBallSpot"]);

const penaltySchema = z.strictObject({
  yards: count,
  timing: z.enum(["preSnap", "live", "afterPlay"]),
  enforcement: enforcementSpot,
  alternate: z.strictObject({ spot: enforcementSpot, yards: count }).nullable(),
  automaticFirstDown: z.boolean(),
  lossOfDown: z.boolean(),
  declinable: z.boolean(),
  halfDistance: z.boolean(),
  tenSecondRunoff: z.boolean(),
  committedBy: z.enum(["offense", "defense", "either"]),
  endZoneSpot: fieldSpot.nullable(),
});

const overtimeSchema = z.strictObject({
    periodSeconds: positive,
    maxPeriods: positive.nullable(),
    timeoutsPerHalf: count,
    periodsPerHalf: positive,
    periodsPerCoinToss: positive,
    timingAsPeriod: z.array(regulationPeriod).min(1),
    guaranteedPossession: z.boolean(),
    firstPossessionEndsOn: z.array(z.enum(["touchdown", "fieldGoal"])),
    kickingTeamSafetyEnds: z.boolean(),
    kickOpportunityCounts: z.boolean(),
    canEndTied: z.boolean(),
});

export const ruleSetSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9-]+$/),
    season: z.number().int(),
    edition: z.string().min(1),
    field: z.strictObject({ endZoneYards: positive }),
    game: z.strictObject({
      periodSeconds: positive,
      regulationPeriods: positive,
      periodsPerHalf: positive,
    }),
    downs: z.strictObject({ perSeries: positive, yardsForFirstDown: positive }),
    scoring: z.strictObject({
      touchdown: positive,
      fieldGoal: positive,
      safety: positive,
      tryKick: positive,
      tryTouchdown: positive,
      trySafety: positive,
    }),
    try: z.strictObject({
      kickSpot: fieldSpot,
      twoPointSpot: fieldSpot,
      skipWhenOutcomeDecided: z.boolean(),
      untimed: z.boolean(),
    }),
    kickoff: z.strictObject({
      spot: fieldSpot,
      safetyKickSpot: fieldSpot,
      landingZone: z
        .strictObject({ from: z.number().int().min(0).max(99), to: fieldSpot })
        .refine((lz) => lz.from <= lz.to, { message: "landing zone start is past its end" }),
      touchbackAfterLandingZone: fieldSpot,
      touchbackFromEndZone: fieldSpot,
      midfieldKickSpot: fieldSpot,
      touchbackFromMidfield: fieldSpot,
      shortOrOutOfBoundsYards: positive,
      safetyKickShortOrOutOfBoundsYards: positive,
      fairCatchAllowed: z.boolean(),
      onside: z.strictObject({
        allowedWhen: z.enum(["always", "trailing", "trailingInFinalPeriod"]),
        declarationRequired: z.boolean(),
      }),
    }),
    punt: z.strictObject({ touchbackSpot: fieldSpot, fairCatchAllowed: z.boolean() }),
    fieldGoal: z.strictObject({ missedMinimumSpot: fieldSpot }),
    touchback: z.strictObject({ scrimmageSpot: fieldSpot }),
    clock: z.strictObject({
      twoMinuteWarningSeconds: positive,
      twoMinuteWarningPeriods: z.array(regulationPeriod),
      startsOnSnapWithin: z.record(z.string().regex(/^[1-9][0-9]*$/), positive),
      offensePreSnapFoulStopsClockInPeriods: z.array(regulationPeriod),
      playClockAfterPlay: positive,
      playClockAfterStoppage: positive,
      playClockAfterRunoff: positive,
      runoffSeconds: positive,
      timeoutAvoidsRunoff: z.boolean(),
      untimedDownAfterDefensiveFoul: z.boolean(),
      untimedDownAfterDoubleFoul: z.boolean(),
    }),
    timeouts: z.strictObject({ perHalf: count, perTeamPerDeadBall: positive }),
    overtime: z.strictObject({ regularSeason: overtimeSchema, postseason: overtimeSchema }),
    penalties: z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/), penaltySchema),
  })
  .superRefine((r, ctx) => {
    const periods = r.game.regulationPeriods;
    const inRegulation = (p: number): boolean => p <= periods;
    for (const p of r.clock.twoMinuteWarningPeriods) {
      if (!inRegulation(p)) ctx.addIssue({ code: "custom", message: `two-minute warning period ${p} is not a regulation period` });
    }
    for (const key of Object.keys(r.clock.startsOnSnapWithin)) {
      if (!inRegulation(Number(key))) ctx.addIssue({ code: "custom", message: `startsOnSnapWithin period ${key} is not a regulation period` });
    }
    for (const [name, ot] of Object.entries(r.overtime)) {
      for (const p of ot.timingAsPeriod) {
        if (!inRegulation(p)) ctx.addIssue({ code: "custom", message: `${name} overtime times as period ${p}, not a regulation period` });
      }
    }
    if (periods % r.game.periodsPerHalf !== 0) {
      ctx.addIssue({ code: "custom", message: "regulation periods must split into whole halves" });
    }
    if (r.clock.twoMinuteWarningSeconds >= r.game.periodSeconds) {
      ctx.addIssue({ code: "custom", message: "two-minute warning must come before the period ends" });
    }
  });

export function parseRuleSet(json: unknown): RuleSet {
  return ruleSetSchema.parse(json) as RuleSet;
}
