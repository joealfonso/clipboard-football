// Messages between the UI thread and the sim worker. Everything is plain JSON (structured clone).
// Requests are the engine's DecisionRequest; the engine guarantees none carries the opponent's
// call for the coming snap, except a kick, kneel or spike it visibly lines up for (spec F5, E6).

import type { Catalog, GameData, TeamPool } from "@clipboard-football/shared";
import type { BoxScore, GameType } from "@clipboard-football/sim";
import type { SaveData } from "./session";
import type { DecisionAnswer, DecisionRequest, GameEvent, GameState, PlayerBoxScore, RatingRank, Team } from "./types";

export interface TeamSummary {
  readonly index: number;
  readonly name: string;
  readonly place: string;
  readonly nickname: string;
  /** Players carry their jersey `number` (player schema version 2). */
  readonly pool: TeamPool;
}

/** What the UI needs from the data files: labels and rule values for text, and the UI templates. */
export interface UiData {
  readonly catalog: Catalog;
  /** why.json labels: formations, packages, penalties, classes. */
  readonly labels: Readonly<Record<string, string>>;
  readonly rules: Pick<GameData["engine"]["rules"], "game" | "timeouts" | "field" | "scoring" | "penalties">;
  /** personnel.json: the defense package each preset lines up in, for the field diagram. */
  readonly presetPackage: Readonly<Record<string, string>>;
  readonly uiTemplates: unknown;
  readonly uiMotion: unknown;
  /** personnel.json slot counts, for the card personnel lines and the card art. */
  readonly personnel: { readonly offense: Readonly<Record<string, Readonly<Partial<Record<string, number>>>>>; readonly packages: Readonly<Record<string, Readonly<Partial<Record<string, number>>>>> };
  readonly dataHash: string;
}

export interface Matchup {
  readonly leagueSeed: number;
  readonly seed: number;
  readonly gameType: GameType;
  readonly home: TeamSummary;
  readonly away: TeamSummary;
}

/** A drive in progress: its first snap's spot (yards from the team's own goal line) and its plays so far. */
/** Which game, and how many of its events the UI had, when it asked for a box score. */
export interface BoxTag {
  readonly seed: number;
  readonly events: number;
}

export interface OpenDrive {
  readonly team: Team;
  readonly start: number;
  readonly plays: number;
}

export type ToWorker =
  | { readonly t: "init" }
  | { readonly t: "matchup"; readonly leagueSeed: number; readonly seed: number }
  /** The next seed after `seed` that pairs the same home and away teams. */
  | { readonly t: "rematch"; readonly leagueSeed: number; readonly seed: number }
  | { readonly t: "newGame"; readonly leagueSeed: number; readonly seed: number; readonly human: Team }
  | { readonly t: "resume"; readonly save: unknown }
  | { readonly t: "answer"; readonly answer: DecisionAnswer }
  /** `tag`: the game and event count the UI asks at; the reply echoes it (code review R1), so a request the worker can't answer yet strands nothing. */
  | { readonly t: "box"; readonly tag?: BoxTag }
  | { readonly t: "ranks"; readonly playerId: string; readonly leagueSeed: number };

export type SimErrorInfo = { readonly message: string; readonly seed: number | null; readonly playCount: number | null; readonly name: string };

export type FromWorker =
  | { readonly t: "progress"; readonly file: string; readonly done: number; readonly total: number }
  | { readonly t: "ready"; readonly ui: UiData; readonly leagueSeed: number }
  | { readonly t: "dataError"; readonly file: string; readonly message: string }
  | { readonly t: "matchup"; readonly matchup: Matchup }
  | {
      readonly t: "step";
      readonly matchup: Matchup;
      readonly human: Team;
      readonly events: readonly GameEvent[];
      readonly request: DecisionRequest | null;
      /** The committed game state (the start of the current dead ball); null before the opening toss is settled. */
      readonly state: GameState | null;
      readonly save: SaveData;
      /** True for a resumed game: `events` is the whole log so far. */
      readonly resumed: boolean;
      /**
       * The drive in progress, from the box score's own drive count over the event log (DESIGN.md
       * hud.driveTracker): where it started, in the frame of the team with the ball, and its plays.
       * null when no drive is open (before a drive's first snap, kicks, tries, the end of a half).
       */
      readonly drive?: OpenDrive | null;
    }
  | { readonly t: "answerError"; readonly code: string; readonly message: string }
  | { readonly t: "saveError"; readonly reason: "older" | "damaged" }
  | { readonly t: "box"; readonly box: BoxScore; readonly players: PlayerBoxScore; readonly tag?: BoxTag }
  | { readonly t: "ranks"; readonly playerId: string; readonly ranks: Readonly<Record<string, RatingRank>> }
  | { readonly t: "simError"; readonly error: SimErrorInfo };
