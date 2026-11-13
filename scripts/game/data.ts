// Loads and validates every file the full-game loop reads, through the shared zod schemas, for
// the CLI, the calibration and the tests. Records each file's sha256 for the game log.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEngineData } from "../../packages/shared/src/engine-schema";
import { parseGameData } from "../../packages/shared/src/game-schema";
import { parseRuleSet } from "../../packages/shared/src/rules-schema";
import { checkCallerTables, withRulePlayClock, parseCallerConfig, parseCallerTables, parseCatalog } from "../../packages/shared/src/schema";
import type { CallerData, GameData } from "../../packages/shared/src/types";

export const REPO = join(import.meta.dirname, "../..");

export const RULES_FILE = "data/rules/nfl-2026.json";
export const CALLER_FILES = {
  catalog: "data/calls/catalog.json",
  config: "data/caller/config.json",
  offense: "data/caller/offense.table.json",
  defense: "data/caller/defense.table.json",
} as const;
export const ENGINE_FILES = {
  config: "data/engine/config.json",
  scrimmage: "data/engine/baseline.scrimmage.json",
  special: "data/engine/baseline.special.json",
  penalties: "data/engine/baseline.penalties.json",
  kickoff: "data/engine/kickoff.json",
  matchup: "data/engine/matchup.centered.json",
  personnel: "data/engine/personnel.json",
  ratings: "data/players/ratings.json",
  distributions: "data/players/distributions.json",
  names: "data/players/names.json",
  why: "data/engine/why.json",
} as const;
export const GAME_FILES = {
  config: "data/game/config.json",
  tempo: "data/game/tempo.json",
  timeouts: "data/game/timeouts.json",
  onside: "data/game/onside.json",
  ep: "data/game/ep.json",
  league: "data/game/league.json",
  teamNames: "data/teams/names.json",
} as const;

/** Every data file the game reads, by repo path. */
export const ALL_FILES: readonly string[] = [RULES_FILE, ...Object.values(CALLER_FILES), ...Object.values(ENGINE_FILES), ...Object.values(GAME_FILES)];

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface LoadOptions {
  readonly root?: string;
  /** Replace a file's parsed JSON (tests and tuning use this for designed parameters). */
  readonly override?: Readonly<Record<string, unknown>>;
}

export function loadGameData(opts: LoadOptions = {}): GameData {
  const root = opts.root ?? REPO;
  const bytes: Record<string, Buffer> = {};
  for (const f of ALL_FILES) bytes[f] = readFileSync(join(root, f));
  const json = (f: string): unknown => (opts.override !== undefined && f in opts.override ? opts.override[f] : JSON.parse((bytes[f] as Buffer).toString("utf8")));
  const hashes: Record<string, string> = {};
  for (const f of ALL_FILES) hashes[f] = opts.override !== undefined && f in opts.override ? sha256(JSON.stringify(opts.override[f])) : sha256(bytes[f] as Buffer);
  const rules = parseRuleSet(json(RULES_FILE));
  const caller: CallerData = {
    catalog: parseCatalog(json(CALLER_FILES.catalog)),
    config: withRulePlayClock(parseCallerConfig(json(CALLER_FILES.config)), json(RULES_FILE)),
    offense: parseCallerTables(json(CALLER_FILES.offense)),
    defense: parseCallerTables(json(CALLER_FILES.defense)),
  };
  if (opts.override === undefined || !(CALLER_FILES.config in opts.override)) {
    const h = createHash("sha256");
    for (const f of [CALLER_FILES.catalog, CALLER_FILES.config]) h.update(bytes[f] as Buffer).update(Buffer.from([0]));
    checkCallerTables(caller.config, h.digest("hex"), [caller.offense, caller.defense]);
  }
  const engineFiles = Object.fromEntries(Object.entries(ENGINE_FILES).map(([k, f]) => [k, json(f)])) as unknown as Parameters<typeof parseEngineData>[0];
  const engine = parseEngineData(engineFiles, rules, caller);
  const gameFiles = Object.fromEntries(Object.entries(GAME_FILES).map(([k, f]) => [k, json(f)])) as unknown as Parameters<typeof parseGameData>[0];
  return parseGameData(gameFiles, engine, hashes[RULES_FILE] as string, hashes);
}
