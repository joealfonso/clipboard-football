// The worker's side of the protocol, without the worker: it takes messages and sends replies
// through a callback, so tests can drive it in Node and read every message the UI would get.

import { boxScore, GameLoopError, GameRuleError, EngineError, type GameType, type LeagueTeam } from "@clipboard-football/sim";
import type { TeamPool } from "@clipboard-football/shared";
import { AdapterError, SAVE_SCHEMA_VERSION, StepLoop, matchupOf, type Prepared, type SaveData, type StepResult } from "./adapter";
import { playerBox } from "./playerBox";
import type { FromWorker, Matchup, TeamSummary, ToWorker, UiData } from "./protocol";
import { numbersFor, ratingRanks } from "./roster";
import type { Team } from "./types";

export const DEFAULT_LEAGUE_SEED = 2026;

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
  return { index, name: t.name, place: nm?.place ?? t.name, nickname: nm?.nickname ?? t.name, pool: t.pool, numbers: Object.fromEntries(numbersFor(t.pool)) };
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
    Array.isArray(s["log"]) &&
    s["log"].every((a) => typeof a === "object" && a !== null && typeof (a as { kind?: unknown }).kind === "string")
  );
}

export class Session {
  private loop: StepLoop | null = null;
  private matchup: Matchup | null = null;

  constructor(
    private readonly p: Prepared,
    private readonly send: (m: FromWorker) => void,
  ) {}

  private matchupFor(leagueSeed: number, seed: number, gameType: GameType): Matchup {
    const setup = matchupOf(this.p, leagueSeed, seed, gameType);
    const teams = this.p.league(leagueSeed);
    return { leagueSeed, seed, gameType, home: summary(teams, setup.home.name, this.p), away: summary(teams, setup.away.name, this.p) };
  }

  private step(r: StepResult, resumed: boolean): void {
    const loop = this.loop as StepLoop;
    this.send({ t: "step", matchup: this.matchup as Matchup, human: loop.seat.human, events: r.events, request: r.request, state: r.state, save: loop.save(), resumed });
  }

  private simError(e: unknown): void {
    const known = e instanceof GameRuleError || e instanceof GameLoopError || e instanceof EngineError;
    const err = e as Error;
    this.send({
      t: "simError",
      error: { name: known ? err.name : "Error", message: err.message ?? String(e), seed: this.loop?.seat.seed ?? null, playCount: this.loop?.state.playCount ?? null },
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
        case "newGame": {
          this.matchup = this.matchupFor(m.leagueSeed, m.seed, "regularSeason");
          const { loop, first } = StepLoop.begin(this.p, { leagueSeed: m.leagueSeed, seed: m.seed, human: m.human, gameType: "regularSeason" });
          this.loop = loop;
          this.step(first, false);
          return;
        }
        case "resume": {
          const s = m.save;
          if (!isSave(s)) return this.send({ t: "saveError", reason: "damaged" });
          if (s.schemaVersion !== SAVE_SCHEMA_VERSION || s.dataHash !== this.p.dataHash) return this.send({ t: "saveError", reason: "older" });
          try {
            const { loop, first } = StepLoop.begin(this.p, { leagueSeed: s.leagueSeed, seed: s.seed, human: s.human, gameType: s.gameType }, s.log);
            this.loop = loop;
            this.matchup = this.matchupFor(s.leagueSeed, s.seed, s.gameType);
            this.step(first, true);
          } catch (e) {
            if (e instanceof AdapterError) return this.send({ t: "saveError", reason: "damaged" });
            throw e;
          }
          return;
        }
        case "answer": {
          const loop = this.loop;
          if (loop === null || loop.pending === null || loop.pending.seq !== m.seq) {
            this.send({ t: "answerError", code: "staleRequest", message: "that request is no longer pending" });
            return;
          }
          try {
            this.step(loop.answer(m.answer), false);
          } catch (e) {
            if (e instanceof AdapterError) return this.send({ t: "answerError", code: e.code, message: e.message });
            throw e;
          }
          return;
        }
        case "box": {
          const loop = this.loop;
          if (loop === null) return;
          const rules = this.p.data.engine.rules;
          this.send({ t: "box", box: boxScore(loop.record(), rules), players: [...playerBox(loop.events, rules).values()] });
          return;
        }
        case "ranks": {
          const teams = this.p.league(m.leagueSeed);
          const pools: TeamPool[] = teams.map((t) => t.pool);
          const player = pools.flatMap((t) => t.players).find((pl) => pl.id === m.playerId);
          if (player !== undefined) this.send({ t: "ranks", playerId: m.playerId, ranks: ratingRanks(pools, player) });
          return;
        }
      }
    } catch (e) {
      this.simError(e);
    }
  }
}

export type { Team };
