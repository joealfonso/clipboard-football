// Messages between the UI thread and the sim worker. Everything is plain JSON (structured clone).
// The worker never sends the opponent's call before the snap: requests carry only the dead ball,
// the human's own options and history, and what lining up shows (spec F5, E6).

import type { Catalog, GameData, TeamPool } from "@clipboard-football/shared";
import type { BoxScore, GameType } from "@clipboard-football/sim";
import type { SaveData } from "./adapter";
import type { Answer, DecisionRequest, GameEvent, GameState, PlayerLine, RatingRank, Team } from "./types";

export interface TeamSummary {
  readonly index: number;
  readonly name: string;
  readonly place: string;
  readonly nickname: string;
  readonly pool: TeamPool;
  /** Jersey number by player id (milestone A, or the adapter's placeholder). */
  readonly numbers: Readonly<Record<string, number>>;
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
  readonly dataHash: string;
}

export interface Matchup {
  readonly leagueSeed: number;
  readonly seed: number;
  readonly gameType: GameType;
  readonly home: TeamSummary;
  readonly away: TeamSummary;
}

export type ToWorker =
  | { readonly t: "init" }
  | { readonly t: "matchup"; readonly leagueSeed: number; readonly seed: number }
  /** The next seed after `seed` that pairs the same home and away teams. */
  | { readonly t: "rematch"; readonly leagueSeed: number; readonly seed: number }
  | { readonly t: "newGame"; readonly leagueSeed: number; readonly seed: number; readonly human: Team }
  | { readonly t: "resume"; readonly save: unknown }
  | { readonly t: "answer"; readonly seq: number; readonly answer: Answer }
  | { readonly t: "box" }
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
      readonly state: GameState;
      readonly save: SaveData;
      /** True for a resumed game: `events` is the whole log so far. */
      readonly resumed: boolean;
    }
  | { readonly t: "answerError"; readonly code: string; readonly message: string }
  | { readonly t: "saveError"; readonly reason: "older" | "damaged" }
  | { readonly t: "box"; readonly box: BoxScore; readonly players: readonly PlayerLine[] }
  | { readonly t: "ranks"; readonly playerId: string; readonly ranks: readonly RatingRank[] }
  | { readonly t: "simError"; readonly error: SimErrorInfo };
