// M2 byte-identity proof (docs/specs/m2-engine-and-game-loop.md, A4, B2, B7, D5, E1): replays the
// step 5 in-sample run (10 leagues x 1,000 games) and digests every game's record with the fields
// M2 adds left out, the "outcome digest" of the spec. Data-file hashes the record carries for
// provenance (rules.hash, dataHashes, final.rules.hash) are set to the baseline's, because M2
// adds data (the jersey-number rules, the participants file, the headlines) by design; every
// other byte of the step 5 record must match.
//
//   node --import ./scripts/engine/register.mjs scripts/game/outcome-digests.ts [--write <file>] [--check <file>] [--standouts on]
//
// Standouts (milestone F) are off unless --standouts on: they change outcomes by design.
//
// --write records the digests (run on the pre-M2 tree to make the baseline); --check compares
// against a baseline file and exits 1 on any difference. The baseline's slice is the committed
// pre-M2 calibration summary's (data/game/calibration.insample.json at 04f0f5d).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { GameData, TeamPool } from "../../packages/shared/src/types";
import { averageCoachFor, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { playGame, prepareGame, type GameRecord } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { loadGameData } from "./data";
import { runSeeds } from "./metrics";

/** Detail keys M2 adds to a PlayResult. */
export const M2_DETAIL_KEYS: readonly string[] = ["participants", "onField", "headline"];
/** Trace factors M2 adds (the players named per role, and later standouts). */
export const M2_TRACE_FACTORS: readonly string[] = [
  "passer", "target", "receiver", "ballCarrier", "tackler", "sacker", "interceptor", "fumbleForcer", "fumbleRecoverer", "kicker", "punter", "returner", "fouler", "standout",
];

export interface Provenance {
  readonly rulesHash: string;
  readonly dataHashes: Readonly<Record<string, string>>;
}

function stripDetail(detail: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (M2_DETAIL_KEYS.includes(k)) continue;
    out[k] = k === "trace" && Array.isArray(v) ? v.filter((e: { factor?: string }) => !M2_TRACE_FACTORS.includes(e.factor ?? "")) : v;
  }
  return out;
}

/** Step 5's event: M2 detail out, and a toss without the `period` M2 added (record schema 2). */
function stepFiveEvent(e: GameRecord["events"][number]): unknown {
  if (e.t === "play" && e.play.detail !== undefined) return { ...e, play: { ...e.play, detail: stripDetail(e.play.detail) } };
  if (e.t === "toss") {
    const { period: _p, ...rest } = e;
    void _p;
    return rest;
  }
  return e;
}

/**
 * The record as step 5 wrote it: M2 fields out, provenance hashes set to the baseline's. Record
 * schema 2 (M2) logs the opening coin toss as events[0] and adds `period` to every toss; step 5
 * logged neither, so both come out here and the schema version reads as step 5's (1).
 */
export function outcomeRecord(record: GameRecord, base: Provenance): unknown {
  const opening = record.events[0]?.t === "toss" && record.events[0].period === 1 ? 1 : 0;
  return {
    ...record,
    schemaVersion: 1,
    rules: { ...record.rules, hash: base.rulesHash },
    dataHashes: base.dataHashes,
    events: record.events.slice(opening).map(stepFiveEvent),
    final: { ...record.final, rules: { ...record.final.rules, hash: base.rulesHash } },
  };
}

export function outcomeDigest(record: GameRecord, base: Provenance): string {
  return createHash("sha256").update(JSON.stringify(outcomeRecord(record, base))).digest("hex");
}

/** A league's players with `number` (and the schema version it bumps) left out (A4). */
export function playersDigest(pools: readonly TeamPool[]): string {
  const strip = pools.map((p) => ({ name: p.name, players: p.players.map((pl) => Object.fromEntries(Object.entries(pl).filter(([k]) => k !== "schemaVersion" && k !== "number"))) }));
  return createHash("sha256").update(JSON.stringify(strip)).digest("hex");
}

export interface DigestFile {
  readonly provenance: Provenance;
  readonly runSeed: number;
  readonly leagues: { readonly leagueSeed: number; readonly players: string; readonly games: number; readonly digests: string }[];
  readonly slice: readonly string[];
}

export function digestRun(data: GameData, base: Provenance, sliceGames: number, standouts = false): DigestFile {
  const lg = data.config.league;
  const seeds = runSeeds(lg.calibrationSeed, lg.leagues, lg.gamesPerLeague);
  // M2 F: the proof is with standouts off (they change outcomes by design, milestone F1).
  const kit = prepareGame(data, { standouts });
  const coach = averageCoachFor(data);
  const slice: string[] = [];
  const leagues = seeds.leagueSeeds.map((leagueSeed, l) => {
    const { teams } = leagueFromSeed(data, leagueSeed);
    const h = createHash("sha256");
    let games = 0;
    for (const seed of seeds.games(data, l)) {
      const d = outcomeDigest(playGame(setupGame(teams, leagueSeed, seed, () => coach), kit, Rng.fromSeed(seed)), base);
      if (slice.length < sliceGames) slice.push(d);
      h.update(d);
      games++;
    }
    return { leagueSeed, players: playersDigest(teams.map((t) => t.pool)), games, digests: h.digest("hex") };
  });
  return { provenance: base, runSeed: lg.calibrationSeed, leagues, slice };
}

function main(): number {
  const args = process.argv.slice(2);
  const at = (flag: string): string | undefined => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const data = loadGameData();
  const check = at("--check");
  const base: Provenance = check !== undefined ? (JSON.parse(readFileSync(check, "utf8")) as DigestFile).provenance : { rulesHash: data.rulesHash, dataHashes: data.dataHashes };
  const t0 = performance.now();
  const run = digestRun(data, base, data.config.league.ciSliceGames, at("--standouts") === "on");
  process.stderr.write(`[outcome-digests] ${run.leagues.reduce((a, l) => a + l.games, 0)} games in ${((performance.now() - t0) / 1000).toFixed(1)} s\n`);
  const write = at("--write");
  if (write !== undefined) writeFileSync(write, JSON.stringify(run, null, 1) + "\n");
  if (check === undefined) return 0;
  const want = JSON.parse(readFileSync(check, "utf8")) as DigestFile;
  let bad = 0;
  want.leagues.forEach((w, i) => {
    const got = run.leagues[i];
    for (const k of ["leagueSeed", "players", "games", "digests"] as const) {
      if (got?.[k] !== w[k]) {
        bad++;
        process.stderr.write(`league ${i} ${k}: want ${w[k]}, got ${got?.[k]}\n`);
      }
    }
  });
  want.slice.forEach((d, i) => {
    if (run.slice[i] !== d) {
      bad++;
      if (bad < 20) process.stderr.write(`slice game ${i}: want ${d}, got ${run.slice[i]}\n`);
    }
  });
  process.stderr.write(bad === 0 ? `[outcome-digests] identical: ${want.leagues.length} leagues (players and every game), ${want.slice.length} slice games\n` : `[outcome-digests] ${bad} differences\n`);
  return bad === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main();
