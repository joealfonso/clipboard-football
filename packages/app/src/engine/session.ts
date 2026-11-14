// The worker's side of the protocol, without the worker: it takes messages and sends replies
// through a callback, so tests can drive it in Node and read every message the UI would get.
// The game itself is the engine's step-wise loop (packages/sim loop/session.ts): startSession,
// answerSession, replaySession, sessionRecord. A save is the seed plus the engine's answer log.

import type { GameData, TeamPool } from "@clipboard-football/shared";
import {
  EngineError,
  GameLoopError,
  GameRuleError,
  answerSession,
  averageCoachFor,
  boxScore,
  leagueFromSeed,
  playerBoxScore,
  prepareGame,
  ratingRanks,
  replaySession,
  sessionRecord,
  setupGame,
  startSession,
  type GameKit,
  type GameSetup,
  type GameType,
  type LeagueTeam,
  type Session as EngineSession,
} from "@clipboard-football/sim";
import type { FromWorker, Matchup, TeamSummary, ToWorker, UiData } from "./protocol";
import type { DecisionAnswer, RatingRanks, Team } from "./types";

export const DEFAULT_LEAGUE_SEED = 2026;
/** Version 2: the log holds the engine's answers (option paths). Version 1 saves (the M1 adapter's answers) can't be resumed. */
export const SAVE_SCHEMA_VERSION = 2;

/** Everything that rebuilds a game: plain JSON for IndexedDB. Same shape as version 1. */
export interface SaveData {
  readonly schemaVersion: number;
  /** sha256 over every data file's hash; a save from other data can't be resumed. */
  readonly dataHash: string;
  readonly leagueSeed: number;
  readonly seed: number;
  readonly human: Team;
  readonly gameType: GameType;
  readonly log: readonly DecisionAnswer[];
}

/** The data, the engine and the generated leagues: built once per data load. */
export interface Prepared {
  readonly data: GameData;
  readonly kit: GameKit;
  readonly dataHash: string;
  league(leagueSeed: number): readonly LeagueTeam[];
  ranks(leagueSeed: number): RatingRanks;
}

export function prepare(data: GameData, dataHash: string): Prepared {
  const leagues = new Map<number, readonly LeagueTeam[]>();
  const ranks = new Map<number, RatingRanks>();
  const league = (seed: number): readonly LeagueTeam[] => {
    let l = leagues.get(seed);
    if (l === undefined) {
      l = leagueFromSeed(data, seed).teams;
      leagues.set(seed, l);
    }
    return l;
  };
  return {
    data,
    kit: prepareGame(data),
    dataHash,
    league,
    ranks(seed) {
      let r = ranks.get(seed);
      if (r === undefined) {
        r = ratingRanks(league(seed).map((t) => t.pool));
        ranks.set(seed, r);
      }
      return r;
    },
  };
}

/** The setup of one game: which league teams meet, from the seed (the M1 pairing rule). */
export function matchupOf(p: Prepared, leagueSeed: number, seed: number, gameType: GameType = "regularSeason"): GameSetup {
  const coach = averageCoachFor(p.data);
  return setupGame(p.league(leagueSeed), leagueSeed, seed, () => coach, gameType);
}

export function uiDataOf(p: Prepared, uiTemplates: unknown): UiData {
  const r = p.data.engine.rules;
  return {
    catalog: p.data.engine.caller.catalog,
    labels: p.data.engine.why.labels,
    rules: { game: r.game, timeouts: r.timeouts, field: r.field, scoring: r.scoring, penalties: r.penalties },
    presetPackage: p.data.engine.personnel.presetPackage,
    uiTemplates,
    dataHash: p.dataHash,
  };
}

function summary(teams: readonly LeagueTeam[], name: string, p: Prepared): TeamSummary {
  const index = teams.findIndex((t) => t.name === name);
  const t = teams[index] as LeagueTeam;
  const nm = p.data.teamNames.teams.find((n) => `${n.place} ${n.nickname}` === t.name);
  return { index, name: t.name, place: nm?.place ?? t.name, nickname: nm?.nickname ?? t.name, pool: t.pool };
}

function isSave(v: unknown): v is SaveData {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s["schemaVersion"] === "number" &&
    typeof s["dataHash"] === "string" &&
    Number.isSafeInteger(s["leagueSeed"]) &&
    Number.isSafeInteger(s["seed"]) &&
    (s["human"] === "home" || s["human"] === "away") &&
    (s["gameType"] === "regularSeason" || s["gameType"] === "postseason") &&
    Array.isArray(s["log"])
  );
}

const isAnswer = (a: unknown): a is DecisionAnswer =>
  typeof a === "object" && a !== null && Number.isSafeInteger((a as DecisionAnswer).seq) && Array.isArray((a as DecisionAnswer).path) && (a as DecisionAnswer).path.every((x) => typeof x === "string");

interface Game {
  readonly setup: GameSetup;
  readonly matchup: Matchup;
  readonly human: Team;
  session: EngineSession;
  /** Events already sent to the UI. */
  reported: number;
}

export class Session {
  private game: Game | null = null;

  constructor(
    private readonly p: Prepared,
    private readonly send: (m: FromWorker) => void,
  ) {}

  private matchupFor(leagueSeed: number, seed: number, gameType: GameType): Matchup {
    const setup = matchupOf(this.p, leagueSeed, seed, gameType);
    const teams = this.p.league(leagueSeed);
    return { leagueSeed, seed, gameType, home: summary(teams, setup.home.name, this.p), away: summary(teams, setup.away.name, this.p) };
  }

  private save(g: Game): SaveData {
    return { schemaVersion: SAVE_SCHEMA_VERSION, dataHash: this.p.dataHash, leagueSeed: g.matchup.leagueSeed, seed: g.matchup.seed, human: g.human, gameType: g.matchup.gameType, log: g.session.inputs };
  }

  private step(g: Game, resumed: boolean): void {
    const run = g.session.run;
    const events = run === null ? [] : resumed ? run.events : run.events.slice(g.reported);
    g.reported = run?.events.length ?? 0;
    this.send({ t: "step", matchup: g.matchup, human: g.human, events, request: g.session.request, state: run?.state ?? null, save: this.save(g), resumed });
  }

  private begin(leagueSeed: number, seed: number, human: Team, gameType: GameType, log: readonly DecisionAnswer[] | null): Game {
    const setup = matchupOf(this.p, leagueSeed, seed, gameType);
    const session = log === null ? startSession(setup, this.p.kit, human) : replaySession(setup, this.p.kit, human, log);
    return { setup, matchup: this.matchupFor(leagueSeed, seed, gameType), human, session, reported: 0 };
  }

  private simError(e: unknown): void {
    const known = e instanceof GameRuleError || e instanceof GameLoopError || e instanceof EngineError;
    const err = e as Error;
    this.send({
      t: "simError",
      error: { name: known ? err.name : "Error", message: err.message ?? String(e), seed: this.game?.matchup.seed ?? null, playCount: this.game?.session.run?.state.playCount ?? null },
    });
  }

  handle(m: ToWorker): void {
    try {
      switch (m.t) {
        case "init":
          return;
        case "matchup":
          this.send({ t: "matchup", matchup: this.matchupFor(m.leagueSeed, m.seed, "regularSeason") });
          return;
        case "rematch": {
          const was = this.matchupFor(m.leagueSeed, m.seed, "regularSeason");
          for (let seed = m.seed + 1; seed < m.seed + 1_000_000; seed++) {
            const next = matchupOf(this.p, m.leagueSeed, seed);
            if (next.home.name === was.home.name && next.away.name === was.away.name) {
              this.send({ t: "matchup", matchup: this.matchupFor(m.leagueSeed, seed, "regularSeason") });
              return;
            }
          }
          this.send({ t: "matchup", matchup: was });
          return;
        }
        case "newGame":
          this.game = this.begin(m.leagueSeed, m.seed, m.human, "regularSeason", null);
          this.step(this.game, false);
          return;
        case "resume": {
          const s = m.save;
          if (!isSave(s)) return this.send({ t: "saveError", reason: "damaged" });
          if (s.schemaVersion !== SAVE_SCHEMA_VERSION || s.dataHash !== this.p.dataHash) return this.send({ t: "saveError", reason: "older" });
          if (!s.log.every(isAnswer)) return this.send({ t: "saveError", reason: "damaged" });
          let g: Game;
          try {
            g = this.begin(s.leagueSeed, s.seed, s.human, s.gameType, s.log);
          } catch (e) {
            // replaySession throws a RangeError when the log doesn't fit the game.
            if (e instanceof RangeError) return this.send({ t: "saveError", reason: "damaged" });
            throw e;
          }
          this.game = g;
          this.step(g, true);
          return;
        }
        case "answer": {
          const g = this.game;
          if (g === null) return this.send({ t: "answerError", code: "noRequest", message: "no game" });
          const r = answerSession(g.session, g.setup, this.p.kit, m.answer);
          if (!r.ok) return this.send({ t: "answerError", code: r.error.code, message: r.error.message });
          g.session = r.session;
          this.step(g, false);
          return;
        }
        case "box": {
          const g = this.game;
          if (g === null || g.session.run === null) return;
          const record = sessionRecord(g.session, g.setup, this.p.kit);
          const rules = this.p.data.engine.rules;
          this.send({ t: "box", box: boxScore(record, rules), players: playerBoxScore(record, rules) });
          return;
        }
        case "ranks": {
          const ranks = this.p.ranks(m.leagueSeed)[m.playerId];
          if (ranks !== undefined) this.send({ t: "ranks", playerId: m.playerId, ranks });
          return;
        }
      }
    } catch (e) {
      this.simError(e);
    }
  }
}

export type { TeamPool };
