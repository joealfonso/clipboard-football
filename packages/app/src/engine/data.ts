// Loads and validates every data file the game reads, in the browser, the same way
// scripts/game/data.ts does in Node: the shared zod schemas, the caller tables' config hash, and
// a sha256 per file for the game log and the save check. Fetches file by file so the loading
// screen can show progress.

import { checkCallerTables, parseCallerConfig, parseCallerTables, parseCatalog, parseEngineData, parseGameData, parseRuleSet, withRulePlayClock } from "@clipboard-football/shared";
import type { CallerData, GameData } from "@clipboard-football/shared";
import catalogUrl from "../../../../data/calls/catalog.json?url";
import callerConfigUrl from "../../../../data/caller/config.json?url";
import offenseTableUrl from "../../../../data/caller/offense.table.json?url";
import defenseTableUrl from "../../../../data/caller/defense.table.json?url";
import rulesUrl from "../../../../data/rules/nfl-2026.json?url";
import engineConfigUrl from "../../../../data/engine/config.json?url";
import scrimmageUrl from "../../../../data/engine/baseline.scrimmage.json?url";
import specialUrl from "../../../../data/engine/baseline.special.json?url";
import penaltiesUrl from "../../../../data/engine/baseline.penalties.json?url";
import kickoffUrl from "../../../../data/engine/kickoff.json?url";
import matchupUrl from "../../../../data/engine/matchup.centered.json?url";
import personnelUrl from "../../../../data/engine/personnel.json?url";
import ratingsUrl from "../../../../data/players/ratings.json?url";
import distributionsUrl from "../../../../data/players/distributions.json?url";
import namesUrl from "../../../../data/players/names.json?url";
import whyUrl from "../../../../data/engine/why.json?url";
import gameConfigUrl from "../../../../data/game/config.json?url";
import tempoUrl from "../../../../data/game/tempo.json?url";
import timeoutsUrl from "../../../../data/game/timeouts.json?url";
import onsideUrl from "../../../../data/game/onside.json?url";
import epUrl from "../../../../data/game/ep.json?url";
import leagueUrl from "../../../../data/game/league.json?url";
import tempoModesUrl from "../../../../data/game/tempo-modes.json?url";
import participantsUrl from "../../../../data/engine/participants.json?url";
import teamNamesUrl from "../../../../data/teams/names.json?url";
import uiTemplatesUrl from "../../../../data/ui/templates.json?url";

/** Repo path -> served URL, in the order scripts/game/data.ts reads them, plus the UI's own data. */
export const FILES: readonly (readonly [string, string])[] = [
  ["data/rules/nfl-2026.json", rulesUrl],
  ["data/calls/catalog.json", catalogUrl],
  ["data/caller/config.json", callerConfigUrl],
  ["data/caller/offense.table.json", offenseTableUrl],
  ["data/caller/defense.table.json", defenseTableUrl],
  ["data/engine/config.json", engineConfigUrl],
  ["data/engine/baseline.scrimmage.json", scrimmageUrl],
  ["data/engine/baseline.special.json", specialUrl],
  ["data/engine/baseline.penalties.json", penaltiesUrl],
  ["data/engine/kickoff.json", kickoffUrl],
  ["data/engine/matchup.centered.json", matchupUrl],
  ["data/engine/personnel.json", personnelUrl],
  ["data/engine/participants.json", participantsUrl],
  ["data/players/ratings.json", ratingsUrl],
  ["data/players/distributions.json", distributionsUrl],
  ["data/players/names.json", namesUrl],
  ["data/engine/why.json", whyUrl],
  ["data/game/config.json", gameConfigUrl],
  ["data/game/tempo.json", tempoUrl],
  ["data/game/timeouts.json", timeoutsUrl],
  ["data/game/onside.json", onsideUrl],
  ["data/game/ep.json", epUrl],
  ["data/game/league.json", leagueUrl],
  ["data/teams/names.json", teamNamesUrl],
  ["data/game/tempo-modes.json", tempoModesUrl],
  ["data/ui/templates.json", uiTemplatesUrl],
];

/** A file that failed to load or failed its check: the loading screen names it. */
export class DataError extends Error {
  readonly file: string;
  constructor(file: string, message: string) {
    super(message);
    this.name = "DataError";
    this.file = file;
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Loaded {
  readonly data: GameData;
  /** sha256 over every file's hash: two builds with the same data share it. */
  readonly dataHash: string;
  /** data/ui/templates.json, parsed but checked by the UI (ui/templates.ts). */
  readonly uiTemplates: unknown;
}

export async function loadData(progress: (file: string, done: number, total: number) => void): Promise<Loaded> {
  const bytes: Record<string, Uint8Array> = {};
  const hashes: Record<string, string> = {};
  let done = 0;
  for (const [file, url] of FILES) {
    progress(file, done, FILES.length);
    let res: Response;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new DataError(file, `could not be fetched (${(e as Error).message})`);
    }
    if (!res.ok) throw new DataError(file, `could not be fetched (HTTP ${res.status})`);
    const b = new Uint8Array(await res.arrayBuffer());
    bytes[file] = b;
    hashes[file] = await sha256(b);
    done++;
  }
  progress("", done, FILES.length);
  const text = new TextDecoder();
  const json = (f: string): unknown => {
    try {
      return JSON.parse(text.decode(bytes[f]));
    } catch (e) {
      throw new DataError(f, `is not valid JSON (${(e as Error).message})`);
    }
  };
  // Every check names the file it was checking, so the failure screen can name it too.
  const check = <T>(file: string, f: () => T): T => {
    try {
      return f();
    } catch (e) {
      if (e instanceof DataError) throw e;
      throw new DataError(file, (e as Error).message);
    }
  };
  const rulesFile = "data/rules/nfl-2026.json";
  const rules = check(rulesFile, () => parseRuleSet(json(rulesFile)));
  const caller: CallerData = check("data/caller/config.json", () => ({
    catalog: parseCatalog(json("data/calls/catalog.json")),
    config: withRulePlayClock(parseCallerConfig(json("data/caller/config.json")), json(rulesFile)),
    offense: parseCallerTables(json("data/caller/offense.table.json")),
    defense: parseCallerTables(json("data/caller/defense.table.json")),
  }));
  const catalogBytes = bytes["data/calls/catalog.json"] as Uint8Array;
  const configBytes = bytes["data/caller/config.json"] as Uint8Array;
  const joined = new Uint8Array(catalogBytes.length + configBytes.length + 2);
  joined.set(catalogBytes, 0);
  joined.set(configBytes, catalogBytes.length + 1);
  const callerHash = await sha256(joined);
  check("data/caller/offense.table.json", () => checkCallerTables(caller.config, callerHash, [caller.offense, caller.defense]));
  const engineFiles = {
    config: json("data/engine/config.json"),
    scrimmage: json("data/engine/baseline.scrimmage.json"),
    special: json("data/engine/baseline.special.json"),
    penalties: json("data/engine/baseline.penalties.json"),
    kickoff: json("data/engine/kickoff.json"),
    matchup: json("data/engine/matchup.centered.json"),
    personnel: json("data/engine/personnel.json"),
    participants: json("data/engine/participants.json"),
    ratings: json("data/players/ratings.json"),
    distributions: json("data/players/distributions.json"),
    names: json("data/players/names.json"),
    why: json("data/engine/why.json"),
  } as unknown as Parameters<typeof parseEngineData>[0];
  const engine = check("data/engine", () => parseEngineData(engineFiles, rules, caller));
  const gameFiles = {
    config: json("data/game/config.json"),
    tempo: json("data/game/tempo.json"),
    timeouts: json("data/game/timeouts.json"),
    onside: json("data/game/onside.json"),
    ep: json("data/game/ep.json"),
    league: json("data/game/league.json"),
    teamNames: json("data/teams/names.json"),
    tempoModes: json("data/game/tempo-modes.json"),
  } as unknown as Parameters<typeof parseGameData>[0];
  const simHashes = Object.fromEntries(Object.entries(hashes).filter(([f]) => !f.startsWith("data/ui/")));
  const data = check("data/game", () => parseGameData(gameFiles, engine, hashes[rulesFile] as string, simHashes));
  const all = Object.entries(hashes)
    .map(([f, h]) => `${f}:${h}\n`)
    .join("");
  return { data, dataHash: await sha256(new TextEncoder().encode(all)), uiTemplates: json("data/ui/templates.json") };
}
