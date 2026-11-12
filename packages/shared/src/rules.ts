// Types for a rule set file (data/rules/*.json). Plain types only, no zod, so packages/sim can
// import them. Every rule number the game state machine uses lives in one of these files;
// docs/RULES.md cites each leaf.

export type EnforcementSpot = "previousSpot" | "spotOfFoul" | "endOfRun" | "succeedingSpot" | "deadBallSpot";

/** When a foul happens relative to the down. */
export type FoulTiming = "preSnap" | "live" | "afterPlay";

/**
 * "offense" is the team that snapped or kicked; "defense" is the other team. On a kick the
 * receiving team is the defense, including during its return.
 */
export type FoulSide = "offense" | "defense" | "either";

export interface PenaltyRule {
  readonly yards: number;
  readonly timing: FoulTiming;
  readonly enforcement: EnforcementSpot;
  /** A second enforcement the offended team gets instead when it is better for them. */
  readonly alternate: { readonly spot: EnforcementSpot; readonly yards: number } | null;
  readonly automaticFirstDown: boolean;
  readonly lossOfDown: boolean;
  readonly declinable: boolean;
  readonly halfDistance: boolean;
  /** Triggers the ten-second run-off when the offense commits it while time is in after the two-minute warning. */
  readonly tenSecondRunoff: boolean;
  readonly committedBy: FoulSide;
  /** Spot (yards from the offended goal line) when the foul is in the end zone, or null. */
  readonly endZoneSpot: number | null;
}

/** "always", or "trailing" (kicking team behind), or "trailingInFinalPeriod". */
export type OnsideAllowedWhen = "always" | "trailing" | "trailingInFinalPeriod";

export type OvertimeScore = "touchdown" | "fieldGoal";

export interface OvertimeFormat {
  readonly periodSeconds: number;
  /** Periods after which the game ends even if tied (when canEndTied). null means unlimited. */
  readonly maxPeriods: number | null;
  readonly timeoutsPerHalf: number;
  /** Overtime periods that share one set of timeouts, as a half does. */
  readonly periodsPerHalf: number;
  /** A new coin toss starts each cycle of this many periods. */
  readonly periodsPerCoinToss: number;
  /** Regulation period whose timing rules each overtime period follows, cycling. */
  readonly timingAsPeriod: readonly number[];
  /** Both teams get an opportunity to possess before the game can end on a score. */
  readonly guaranteedPossession: boolean;
  /** Scores by the first team that end the game during its initial possession (old formats). */
  readonly firstPossessionEndsOn: readonly OvertimeScore[];
  /** A safety by the kicking team on the receiving team's initial possession ends the game. */
  readonly kickingTeamSafetyEnds: boolean;
  /** A kick that crosses the line and is muffed, or a kickoff the kickers recover, counts as the receiving team's opportunity. */
  readonly kickOpportunityCounts: boolean;
  readonly canEndTied: boolean;
}

export interface RuleSet {
  readonly id: string;
  readonly season: number;
  /** The rulebook edition the values were checked against. */
  readonly edition: string;
  readonly field: {
    /** Depth of each end zone. Bounds where a dead ball can be reported. */
    readonly endZoneYards: number;
  };
  readonly game: {
    readonly periodSeconds: number;
    readonly regulationPeriods: number;
    readonly periodsPerHalf: number;
  };
  readonly downs: {
    readonly perSeries: number;
    readonly yardsForFirstDown: number;
  };
  readonly scoring: {
    readonly touchdown: number;
    readonly fieldGoal: number;
    readonly safety: number;
    readonly tryKick: number;
    readonly tryTouchdown: number;
    /** Either team, for what would ordinarily be a safety on a try. */
    readonly trySafety: number;
  };
  readonly try: {
    /** Yards from the defense's goal line. */
    readonly kickSpot: number;
    readonly twoPointSpot: number;
    /** Skip the try when a successful try could not change the result of the game. */
    readonly skipWhenOutcomeDecided: boolean;
    readonly untimed: boolean;
  };
  readonly kickoff: {
    /** Kicking team's own yard line. */
    readonly spot: number;
    readonly safetyKickSpot: number;
    /** Receiving team's yard lines, from its goal line (0) out. */
    readonly landingZone: { readonly from: number; readonly to: number };
    /** Kick touched the landing zone first, then dead in or out of the end zone. Receiving team's yard line. */
    readonly touchbackAfterLandingZone: number;
    /** Kick reached the end zone without touching the landing zone. */
    readonly touchbackFromEndZone: number;
    /** Kick spot (kicking team's yard line) at which every touchback goes to touchbackFromMidfield instead. */
    readonly midfieldKickSpot: number;
    readonly touchbackFromMidfield: number;
    /** Kick short of the landing zone or out of bounds: yards from the spot of the kick. */
    readonly shortOrOutOfBoundsYards: number;
    readonly safetyKickShortOrOutOfBoundsYards: number;
    readonly fairCatchAllowed: boolean;
    readonly onside: {
      readonly allowedWhen: OnsideAllowedWhen;
      readonly declarationRequired: boolean;
    };
  };
  readonly punt: {
    /** Receiving team's yard line after a touchback. */
    readonly touchbackSpot: number;
    readonly fairCatchAllowed: boolean;
  };
  readonly fieldGoal: {
    /** A miss from inside this receiving-team yard line gives the receivers the ball here; otherwise at the spot of the kick. */
    readonly missedMinimumSpot: number;
  };
  readonly touchback: {
    /** Own yard line after a touchback on a turnover or a scrimmage play. */
    readonly scrimmageSpot: number;
  };
  readonly clock: {
    readonly twoMinuteWarningSeconds: number;
    /** Regulation periods with a two-minute warning. */
    readonly twoMinuteWarningPeriods: readonly number[];
    /**
     * Per regulation period: in the final this many seconds, a stop for out of bounds or a
     * penalty keeps the clock stopped until the snap.
     */
    readonly startsOnSnapWithin: Readonly<Record<string, number>>;
    /** Regulation periods in which an offensive pre-snap foul keeps the clock stopped until the snap. */
    readonly offensePreSnapFoulStopsClockInPeriods: readonly number[];
    readonly playClockAfterPlay: number;
    readonly playClockAfterStoppage: number;
    readonly playClockAfterRunoff: number;
    readonly runoffSeconds: number;
    readonly timeoutAvoidsRunoff: boolean;
    /** An accepted live-ball foul by the defense on a play that ends the period allows one untimed down. */
    readonly untimedDownAfterDefensiveFoul: boolean;
    /** Offsetting fouls on a play that ends the period allow one untimed down. */
    readonly untimedDownAfterDoubleFoul: boolean;
  };
  readonly timeouts: {
    readonly perHalf: number;
    /** Charged timeouts one team may take in one dead-ball period. */
    readonly perTeamPerDeadBall: number;
  };
  readonly overtime: {
    readonly regularSeason: OvertimeFormat;
    readonly postseason: OvertimeFormat;
  };
  readonly penalties: Readonly<Record<string, PenaltyRule>>;
}
