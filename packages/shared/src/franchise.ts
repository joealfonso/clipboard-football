// Types for Franchise mode (M4): the data files under data/franchise, the franchise state and the
// views the screens read. Plain types and one pure helper, no zod, so packages/sim can import them. The zod
// schemas that produce the data types live in franchise-schema.ts. Everything here is designed
// unless a data file cites a source (docs/specs/m4-franchise-core.md).

import type { BaseRating, Position, StandoutKindId } from "./engine";
import type { GameData } from "./game";

export const FRANCHISE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------- data files (data/franchise)

export interface FranchiseConference {
  readonly id: string;
  readonly name: string;
}

/** data/franchise/league.json (designed): the fictional league's shape and names. */
export interface FranchiseLeagueConfig {
  readonly schemaVersion: number;
  readonly designed: true;
  readonly conferences: readonly FranchiseConference[];
  /** Division names, the same set in every conference. */
  readonly divisions: readonly string[];
  readonly teamsPerDivision: number;
  readonly titleGame: string;
  /** How the teams are named and placed: a seeded shuffle of data/teams/names.json. */
  readonly placement: "seededShuffle";
}

export interface RosterPositionConfig {
  readonly target: number;
  readonly max: number;
}

export const ROSTER_UNITS = ["offense", "defense", "specialTeams"] as const;
export type RosterUnit = (typeof ROSTER_UNITS)[number];

/**
 * data/franchise/roster.json (size cited, rest designed). Position minimums are not stored: they
 * are the engine's slot needs (sim: slotNeeds), so the two cannot drift.
 */
export interface RosterConfig {
  readonly schemaVersion: number;
  readonly designed: true;
  readonly rosterSize: number;
  readonly positions: Readonly<Record<Position, RosterPositionConfig>>;
  /** The positions each unit average is taken over. */
  readonly units: Readonly<Record<RosterUnit, readonly Position[]>>;
}

/** How one rating at one position moves off the engine's curve: round(m + scale x (x - m) + offset), with m the engine's league mean. */
export interface PoolAdjust {
  readonly scale: number;
  readonly offset: number;
}

/** data/franchise/pool.json (designed, tuned on simulated leagues). */
export interface PoolConfig {
  readonly schemaVersion: number;
  readonly designed: true;
  /** Pool size per position is ceil(teams x target x (1 + surplus)). */
  readonly surplus: number;
  /** Only ratings the position's overall weights name. Any other rating is the plain curve draw. */
  readonly adjust: Readonly<Record<Position, Readonly<Record<string, PoolAdjust>>>>;
  /** The lowest adjusted rating. */
  readonly floor: number;
  /** The franchise's own standout centering, used by franchiseKit in place of data/engine/standouts.json's. */
  readonly standoutCentering: Readonly<Record<StandoutKindId, number>>;
  /** Full names are unique within a pool: a repeat is redrawn up to `maxRedraws` times, then the next free pair is taken. */
  readonly names: { readonly unique: true; readonly maxRedraws: number };
  /** Where adjust and standoutCentering came from (scripts/franchise/tune-pool.ts). Nothing reads it. */
  readonly tuning: {
    readonly date: string;
    readonly command: string;
    readonly firstSeed: number;
    readonly leagues: number;
    readonly passes: number;
    /** The largest gap left over the weighted ratings, in points and as a share of quick play's SD. */
    readonly worstMean: number;
    readonly worstSd: number;
    /** The draft-ai.json and roster.json the drafts ran with: a change to either needs a re-tune. */
    readonly draftAiSha256: string;
    readonly rosterSha256: string;
    readonly note?: string | undefined;
  };
}

/**
 * Pool size at a position: ceil(teams x target x (1 + surplus)), never under teams x minimum.
 * The small epsilon keeps a product that is a whole number in exact arithmetic from rounding up.
 */
export function poolCount(teams: number, target: number, min: number, surplus: number): number {
  return Math.max(teams * min, Math.ceil(teams * target * (1 + surplus) - 1e-9));
}

/** A named way an AI team drafts. */
export interface DraftStyle {
  /** How often a team draws it, against the other styles' weights. */
  readonly weight: number;
  /** Multiplies positionValue, 1 for a position not listed. */
  readonly value?: Readonly<Partial<Record<Position, number>>> | undefined;
  /** Multiplies the need bonus, 1 when absent. */
  readonly need?: number | undefined;
}

/** data/franchise/draft-ai.json (designed). */
export interface DraftAiConfig {
  readonly schemaVersion: number;
  readonly designed: true;
  /** Score per point of overall, by position. */
  readonly positionValue: Readonly<Record<Position, number>>;
  /**
   * Optional, by position: what a player's overall is worth, as points (overall, value) from 0 to 99
   * joined by straight lines. A listed position's value is the curve at his overall in place of
   * positionValue x overall; positionValue still scales the misreading.
   */
  readonly valueCurve?: Readonly<Partial<Record<Position, readonly (readonly [number, number])[]>>> | undefined;
  /** The need bonus, in score points, for a pick at a position holding 0, 1, 2 ... players: one per slot up to the target, never rising. 0 from the target on. */
  readonly slotNeed: Readonly<Record<Position, readonly number[]>>;
  /** Each AI team's evaluation error SD, in points of overall, is drawn uniformly from this range. */
  readonly evaluation: { readonly errorSdMin: number; readonly errorSdMax: number };
  readonly styles: Readonly<Record<string, DraftStyle>>;
  /** The profile the user's auto-pick and auto-draft use. */
  readonly autoPick: { readonly style: string; readonly errorSd: number };
}

/**
 * How one team drafts, the same for the whole draft. A pure function of the franchise seed and the
 * team, never stored in the state.
 */
export interface DraftProfile {
  /** The franchise seed and the team's place in league order: what its misreadings are drawn from. */
  readonly seed: number;
  readonly team: number;
  /** A style name from draft-ai.json. */
  readonly style: string;
  /** Its misreading of a player's overall is this times a normal draw, fixed per player. */
  readonly errorSd: number;
}

/** Position -> rating -> weight. One home: data/ui/templates.json `overallWeights`, read by the app and the sim. */
export type OverallWeights = Readonly<Record<string, Readonly<Record<string, number>>>>;

/** Everything the franchise layer reads. Its own bundle: GameData gains no field. */
export interface FranchiseData {
  readonly game: GameData;
  readonly league: FranchiseLeagueConfig;
  readonly roster: RosterConfig;
  readonly pool: PoolConfig;
  readonly draftAi: DraftAiConfig;
  readonly overallWeights: OverallWeights;
}

// ---------------------------------------------------------------- state (plain JSON)

/** "T00", "T01", ... in league order: conference, then division, then place in the division. */
export type TeamId = string;

export interface FranchiseTeam {
  readonly id: TeamId;
  readonly place: string;
  readonly nickname: string;
  /** A conference id from league.json. */
  readonly conference: string;
  /** A division name from league.json. */
  readonly division: string;
}

/** A pool player: no team and no number. Ids ("P0001", ...) never change when he moves. */
export interface PoolPlayer {
  readonly id: string;
  readonly name: string;
  readonly position: Position;
  /** Integers 0 to 99. */
  readonly ratings: Readonly<Record<BaseRating, number>>;
  /** The position's skills (POSITION_SKILLS), integers 0 to 99. */
  readonly skills: Readonly<Record<string, number>>;
}

export type PickedBy = "user" | "auto" | "ai";

export interface DraftPick {
  /** 1-based. The slot it used is `slots[overallPick - 1]`. */
  readonly overallPick: number;
  readonly playerId: string;
  readonly by: PickedBy;
}

export interface DraftState {
  /** The owner of every pick, in order, built from the snake rule. */
  readonly slots: readonly TeamId[];
  readonly picks: readonly DraftPick[];
  /** While on, every user pick is made by the auto-pick policy. */
  readonly autoDraft: boolean;
  /** Pool players the user has marked, in the order marked. A drafted one stays in the list. */
  readonly targets: readonly string[];
}

export const FRANCHISE_PHASES = ["draft", "regularSeason", "playoffs", "complete"] as const;
export type FranchisePhase = (typeof FRANCHISE_PHASES)[number];

export interface FranchiseSettings {
  readonly userTeam: TeamId;
  /** The round 1 slot the user chose (1-based), or null for a seeded slot. */
  readonly draftSlot: number | null;
}

/** The whole franchise. Plain JSON; it will become the save (milestone H, not built yet). */
export interface FranchiseState {
  readonly schemaVersion: number;
  readonly seed: number;
  readonly settings: FranchiseSettings;
  readonly phase: FranchisePhase;
  readonly teams: readonly FranchiseTeam[];
  /** Every pool player, drafted or not. */
  readonly players: readonly PoolPlayer[];
  /** Team -> player ids, in the order they joined. */
  readonly rosters: Readonly<Record<TeamId, readonly string[]>>;
  /** Player id -> jersey number, assigned when the draft ends. */
  readonly numbers: Readonly<Record<string, number>>;
  readonly draft: DraftState;
}

export interface CreateFranchiseOptions {
  readonly seed: number;
  readonly userTeam: TeamId;
  /** 1-based round 1 slot, or "random" (the default) for a seeded one. */
  readonly draftSlot?: number | "random";
}

// ---------------------------------------------------------------- typed errors (Locked 8)

/** The legal-pick rules, in the order they are named. completionExists: after the pick every team can still fill its owned slots from the pool inside its limits. */
export type DraftRule = "positionMax" | "minimumsReachable" | "poolCoversMinimums" | "completionExists";

export type FranchiseError =
  | { readonly code: "badSeed"; readonly seed: unknown }
  | { readonly code: "unknownTeam"; readonly teamId: string }
  | { readonly code: "badDraftSlot"; readonly slot: unknown; readonly teams: number }
  | { readonly code: "notDraftPhase"; readonly phase: FranchisePhase }
  | { readonly code: "draftComplete" }
  | { readonly code: "notOnClock"; readonly onClock: TeamId; readonly userTeam: TeamId }
  | { readonly code: "unknownPlayer"; readonly playerId: string }
  | { readonly code: "alreadyDrafted"; readonly playerId: string }
  | { readonly code: "illegalPick"; readonly playerId: string; readonly position: Position; readonly rule: DraftRule }
  | { readonly code: "noLegalPick"; readonly teamId: TeamId; readonly overallPick: number }
  | { readonly code: "noJerseyNumber"; readonly teamId: TeamId; readonly playerId: string; readonly position: Position }
  | { readonly code: "badLimit"; readonly maxPicks: unknown }
  | { readonly code: "badThrough"; readonly through: unknown }
  /** The draft as saved cannot end with every roster legal under this data (a changed roster.json): the rule that can't be met, by whom and where. */
  | { readonly code: "draftCannotFinish"; readonly rule: DraftRule; readonly teamId: TeamId | null; readonly position: Position | null };

export type FranchiseErrorCode = FranchiseError["code"];

export type FranchiseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: FranchiseError };

// ---------------------------------------------------------------- team views

export interface PlayerView {
  readonly id: string;
  readonly name: string;
  readonly position: Position;
  /** Null until numbers are assigned at the end of the draft. */
  readonly number: number | null;
  readonly overall: number;
  readonly ratings: Readonly<Record<BaseRating, number>>;
  readonly skills: Readonly<Record<string, number>>;
}

export interface PositionSummary {
  readonly position: Position;
  /** Depth order: overall descending, ties by id. The first `min` are the projected starters. */
  readonly players: readonly PlayerView[];
  readonly count: number;
  readonly min: number;
  readonly target: number;
  readonly max: number;
  readonly neededToStart: number;
  readonly neededToTarget: number;
  /** Mean overall of the projected starters, one decimal. Null when the position is empty. */
  readonly startersAverage: number | null;
}

export const TEAM_AVERAGES = ["offense", "defense", "specialTeams", "team", "roster"] as const;
/** The three units and `team` are over projected starters; `roster` is over every rostered player. */
export type TeamAverage = (typeof TEAM_AVERAGES)[number];

export interface TeamSummary {
  readonly teamId: TeamId;
  readonly playerCount: number;
  readonly positions: Readonly<Record<Position, PositionSummary>>;
  /** One decimal each, null when no player counts toward it. */
  readonly averages: Readonly<Record<TeamAverage, number | null>>;
  /**
   * Rank among all teams on each average, 1 is best. Teams level on the one-decimal average share
   * a rank and the next rank is skipped (1, 2, 2, 4). Null when the average is null.
   */
  readonly ranks: Readonly<Record<TeamAverage, number | null>>;
}

// ---------------------------------------------------------------- draft views

export type DraftUse = "starter" | "depth" | "extra";

/** What a pick at one position would mean for one team right now. Every player at the position shares it. */
export interface DraftPositionRule {
  readonly position: Position;
  readonly count: number;
  readonly min: number;
  readonly target: number;
  readonly max: number;
  /** starter: he takes an open starting slot (count < min). depth: min <= count < target. extra: count >= target. */
  readonly use: DraftUse;
  readonly legal: boolean;
  /** The first rule that blocks the pick, or null when legal. */
  readonly blockedBy: DraftRule | null;
  /** Pool players left at the position. */
  readonly available: number;
}

export interface DraftTeamBoard {
  readonly teamId: TeamId;
  readonly picksMade: number;
  readonly picksLeft: number;
  readonly positions: Readonly<Record<Position, DraftPositionRule>>;
  /** Positions still short of their minimum, with how many each, in position order. */
  readonly mustFill: readonly { readonly position: Position; readonly count: number }[];
  /** Starting slots still open, over all positions. */
  readonly requiredLeft: number;
  /** True when every pick left has to fill a starting slot (picks left equal required slots left, above zero). */
  readonly everyPickMustFill: boolean;
}

export interface AvailablePlayer extends PoolPlayer {
  readonly overall: number;
  /** 1-based rank among available players at his position, by overall then id. */
  readonly positionRank: number;
  /** For the team on the clock (false and null once the draft is over). */
  readonly legal: boolean;
  readonly blockedBy: DraftRule | null;
  /** For the user's team, whoever is on the clock. */
  readonly use: DraftUse;
  /** The place he would take in the user's team's depth order at his position (overall descending, ties by id), 1 for first. */
  readonly depthRank: number;
}

export interface DraftPickEntry {
  readonly overallPick: number;
  readonly round: number;
  readonly pickInRound: number;
  readonly teamId: TeamId;
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly overall: number;
  readonly by: PickedBy;
}

export interface DraftNextPick {
  readonly overallPick: number;
  readonly round: number;
  readonly pickInRound: number;
  /** Picks from the current one: 1 means the user picks again straight after (a snake turn). */
  readonly picksAway: number;
  /** The user is on the clock now and also owns the very next pick. */
  readonly backToBack: boolean;
}

interface DraftViewCommon {
  readonly seed: number;
  readonly rounds: number;
  readonly totalPicks: number;
  readonly userTeam: TeamId;
  /** Picks until the user's next turn: 0 on the clock, null when the user has no pick left. */
  readonly picksUntilUser: number | null;
  /** The user's next pick after the current one, or null when there is none. */
  readonly userNextPick: DraftNextPick | null;
  readonly userPicksMade: number;
  readonly userPicksTotal: number;
  readonly autoDraft: boolean;
  readonly slots: readonly TeamId[];
  /** Every pick so far, in order: entry i is overall pick i + 1, so "since pick n" is `picks.slice(n)`. */
  readonly picks: readonly DraftPickEntry[];
  /** Board order: overall descending, ties by id. A total order, so ranks never flicker. */
  readonly available: readonly AvailablePlayer[];
  readonly availableCount: number;
  /** Ids of the players the team on the clock may take, in board order. */
  readonly legal: readonly string[];
  /** The user's team: what each position would mean for it now, what it must still fill, and its targets. */
  readonly user: DraftTeamBoard & {
    /** Every player the user has marked, in the order marked, drafted ones included. */
    readonly targets: readonly string[];
    /** The ones no team has drafted. */
    readonly targetsAvailable: readonly string[];
  };
  readonly summaries: readonly TeamSummary[];
}

export interface DraftOpenView extends DraftViewCommon {
  readonly done: false;
  readonly overallPick: number;
  readonly round: number;
  readonly pickInRound: number;
  readonly onClockTeam: TeamId;
  readonly userOnClock: boolean;
  readonly onClock: DraftTeamBoard;
}

export interface DraftDoneView extends DraftViewCommon {
  readonly done: true;
  readonly overallPick: null;
  readonly round: null;
  readonly pickInRound: null;
  readonly onClockTeam: null;
  readonly userOnClock: false;
  readonly onClock: null;
}

export type DraftView = DraftOpenView | DraftDoneView;

/**
 * B7: what the AI policy reads besides its own profile, a narrowing of the open draft view
 * (DraftOpenView is assignable to it). `available` must be in board order.
 */
export interface DraftAiInput {
  readonly available: readonly Pick<AvailablePlayer, "id" | "position" | "overall">[];
  readonly onClock: { readonly positions: Readonly<Record<Position, Pick<DraftPositionRule, "count" | "use" | "legal">>> };
}

/** The parts of the AI score for the player chosen. */
export interface DraftChoice {
  readonly playerId: string;
  readonly position: Position;
  readonly overall: number;
  /** Position value x the style's value x overall. */
  readonly value: number;
  /** The need bonus that applied, the style's need x slotNeed (0 at or past the target). */
  readonly need: number;
  /** Position value x the style's value x the team's misreading of him. */
  readonly noise: number;
  readonly score: number;
  readonly use: DraftUse;
  /** Whether he is the highest overall among the legal players at his position (ties by id). */
  readonly bestAtPosition: boolean;
}

export type AutoPickReason = "target" | "needStarter" | "needDepth" | "bestAvailable";

/** What the user's auto-pick would take, and why, from the factors the pick used only. */
export interface AutoPickPreview extends DraftChoice {
  readonly name: string;
  /** Whether the user is on the clock now. When not, this is the pick as the board stands, at the user's next pick number. */
  readonly userOnClock: boolean;
  readonly overallPick: number;
  /** target: a marked player the roster can use. needStarter, needDepth: the need bonus applied. bestAvailable: it did not. */
  readonly reason: AutoPickReason;
  readonly count: number;
  readonly min: number;
  readonly target: number;
  readonly neededToStart: number;
  readonly neededToTarget: number;
}

export interface LegalPicks {
  readonly teamId: TeamId;
  readonly positions: Readonly<Record<Position, DraftPositionRule>>;
  /** Board order. */
  readonly legal: readonly string[];
  readonly blocked: readonly { readonly playerId: string; readonly position: Position; readonly rule: DraftRule }[];
}
