// Step 5b, B10: every late-window caller cell the sim reaches that still backs off past the last
// score-aware level, with its lookup count. Same run seed, leagues and games as the in-sample
// calibration run (data/game/config.json), so the counts are those of GAME_REPORT.md section 1.
//
//   node --import ./scripts/engine/register.mjs scripts/game/late-backoff.ts
//
// Writes data/game/late-backoff.json; scripts/game/report.ts renders it. Reads no 2024-2025 data.
// Decides nothing: it replays each snap's Situation through the caller's own lookup.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FactorTable, Situation } from "../../packages/shared/src/types";
import { binSituation } from "../../packages/sim/src/caller/bins";
import { offenseShares } from "../../packages/sim/src/caller/offense";
import { toSituation } from "../../packages/sim/src/game/situation";
import type { GameState } from "../../packages/sim/src/game/types";
import { prepareGame } from "../../packages/sim/src/loop/play";
import { REPO, loadGameData } from "./data";
import { runLeagues } from "./metrics";

const SCORE_DIMS = new Set(["score7", "score3", "diff", "scoreLate", "scoreLateOnly", "score3LateOnly", "scoreLate5Only", "scoreLateOnlyR", "kneelOut"]);

export interface LateBackoffRow {
  factor: string;
  level: number;
  dims: string[];
  key: string;
  lateTime: string;
  /** scoreLate5 bucket of the situations served (part of the row's identity). */
  score: string;
  lookups: number;
  /** Lookups from B9 cell (a): tied, final 2:00, inside the 37, 3rd down. */
  b9a: number;
  /** Lookups from B9 cell (b): trailing 1-8, final 2:00, own half (K75, K99), 4th down. */
  b9b: number;
}

export function lastScoreAware(t: FactorTable): number {
  let last = -1;
  t.levels.forEach((l, i) => {
    if (l.dims.some((d) => SCORE_DIMS.has(d))) last = i;
  });
  return last;
}

export function lateBackoff(): { games: number; lateLookups: number; rows: LateBackoffRow[] } {
  const data = loadGameData();
  const kit = prepareGame(data);
  const caller = data.engine.caller;
  const dims = caller.config.dimensions;
  const lg = data.config.league;
  const counts = new Map<string, LateBackoffRow>();
  let lateLookups = 0;
  const run = runLeagues(data, {
    runSeed: lg.calibrationSeed,
    leagues: lg.leagues,
    gamesPerLeague: lg.gamesPerLeague,
    onGame: (record) => {
      for (const ev of record.events) {
        if (ev.t !== "play" || ev.before.phase !== "scrimmage") continue;
        const sit: Situation = toSituation(ev.before as unknown as GameState, data.engine.rules);
        const labels = binSituation(sit, dims);
        const lateTime = labels["lateTime"];
        if (lateTime === "-" || lateTime === null || lateTime === undefined) continue;
        lateLookups++;
        const trace = offenseShares(sit, caller).trace;
        for (const name of ["oTop", "o4Top"] as const) {
          const t = trace[name];
          const table = caller.offense.factors[name] as FactorTable;
          if (t === undefined || t.level <= lastScoreAware(table)) continue;
          const score = labels["scoreLate5Only"] ?? "-";
          const id = `${name}|${t.level}|${t.key}|${lateTime}|${score}`;
          const row = counts.get(id) ?? { factor: name, level: t.level, dims: [...(table.levels[t.level]?.dims ?? [])], key: t.key, lateTime, score, lookups: 0, b9a: 0, b9b: 0 };
          row.lookups++;
          const gf = lateTime === "GF";
          if (gf && sit.scoreDiff === 0 && sit.yardLine100 <= 37 && sit.down === 3) row.b9a++;
          if (gf && sit.scoreDiff >= -8 && sit.scoreDiff <= -1 && sit.yardLine100 >= 51 && sit.down === 4) row.b9b++;
          counts.set(id, row);
        }
      }
    },
  }, kit);
  const rows = [...counts.values()].sort((a, b) => b.lookups - a.lookups || a.factor.localeCompare(b.factor) || a.key.localeCompare(b.key));
  return { games: run.games, lateLookups, rows };
}

if (import.meta.main) {
  const out = lateBackoff();
  writeFileSync(join(REPO, "data/game/late-backoff.json"), JSON.stringify({ generated: true, ...out }, null, 1) + "\n");
  const a = out.rows.reduce((n, r) => n + r.b9a, 0);
  const b = out.rows.reduce((n, r) => n + r.b9b, 0);
  process.stdout.write(`${out.games} games, ${out.lateLookups} late snaps, ${out.rows.length} cells past the last score-aware level; B9 (a) lookups ${a}, (b) ${b}\n`);
  for (const r of out.rows.slice(0, 25)) process.stdout.write(`${r.factor} L${r.level} [${r.dims.join(",")}] ${r.key} ${r.lateTime} ${r.score}: ${r.lookups} (a ${r.b9a}, b ${r.b9b})\n`);
}
