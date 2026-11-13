// Step 5b milestone E (report only): the sim side of the late-game investigations, on the
// in-sample run's games (same run seed, leagues and games as GAME_REPORT.md section 1). The
// measures mirror pipeline/game/investigate.py exactly; see its docstring for the definitions.
// Changes no table, config or sim code (E3).
//
//   node --import ./scripts/engine/register.mjs scripts/game/investigate.ts
//
// Writes data/game/investigations.json; scripts/game/report.ts renders it next to the real side.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { prepareGame, type GameRecord } from "../../packages/sim/src/loop/play";
import { REPO, loadGameData } from "./data";
import { runLeagues } from "./metrics";

const RUN = new Set(["insideRun", "outsideRun", "qbSneak"]);
const PASS = new Set(["shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"]);

function callOf(call: string): string | null {
  if (RUN.has(call)) return "run";
  if (PASS.has(call)) return "pass";
  if (call === "punt" || call === "fieldGoal" || call === "spike" || call === "kneel") return call;
  return null;
}

const score3 = (d: number): string => (d < 0 ? "T" : d === 0 ? "0" : "L");

function time5(period: number, clock: number): string {
  if (period <= 2) return period === 2 && clock <= 120 ? "H1F" : "H1";
  if (period === 3) return "H2";
  return clock <= 120 ? "GF" : clock <= 300 ? "G5" : "H2";
}

const spotGroup = (ownSpot: number): string => (ownSpot <= 5 ? "own1-5" : ownSpot <= 10 ? "own6-10" : "other");

export function measure(record: GameRecord, count: Map<string, number>): void {
  const add = (k: string): void => {
    count.set(k, (count.get(k) ?? 0) + 1);
  };
  const ev = record.events;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (e === undefined || e.t !== "play" || e.before.phase !== "scrimmage" || e.before.period > 4) continue;
    const call = callOf(e.offense.call);
    if (call === null) continue;
    const b = e.before;
    const a = e.after;
    const off = b.possession;
    const def = off === "home" ? "away" : "home";
    const kind = e.play.kind;
    const safety = a.score[def] - b.score[def] === 2;
    if (safety) {
      add(`safety.cause.${kind === "sack" ? "sack" : kind === "run" || kind === "scramble" || kind === "kneel" ? "run" : "other"}`);
      add(`safety.spot.${spotGroup(b.spot)}`);
    }
    if (b.spot <= 5) {
      add("own1-5.snaps");
      if (b.down <= 3) {
        add("own1-5.calls");
        add(`own1-5.call.${call}`);
      }
    }
    if (call !== "run" && call !== "pass" && call !== "spike") continue;
    const s3 = score3(b.score[off] - b.score[def]);
    const t5 = time5(b.period, b.clock);
    const cell = `${s3}.${t5}`;
    add(`snaps.${cell}`);
    if (call === "pass") add(`dropback.${cell}`);
    const incomplete = call === "spike" || (kind === "pass" && e.play.incomplete === true);
    if (incomplete) add(`incompletion.${cell}`);
    if (t5 !== "G5" && t5 !== "GF") continue;
    let timeoutAfter = false;
    for (let j = i + 1; j < ev.length; j++) {
      const n = ev[j];
      if (n === undefined) break;
      if (n.t === "timeout") {
        timeoutAfter = true;
        break;
      }
      if (n.t === "play") break;
    }
    const scored = a.score.home !== b.score.home || a.score.away !== b.score.away;
    const other = scored || a.possession !== off || a.phase !== "scrimmage" || (e.penalty !== null && e.penalty.kind === "accept");
    const oob = "outOfBounds" in e.play && (e.play as { outOfBounds?: boolean }).outOfBounds === true;
    const why = incomplete ? "incompletion" : oob ? "outOfBounds" : timeoutAfter ? "timeout" : other ? "other" : "none";
    add(`stop.${s3}.${t5}.${why}`);
    add(`stop.${s3}.${t5}.snaps`);
    // The sim knows the clock: the share of these snaps after which it was actually stopped.
    if (!a.clockRunning || timeoutAfter) add(`stop.${s3}.${t5}.clockStopped`);
  }
}

export function investigate(): { games: number; counts: Record<string, number> } {
  const data = loadGameData();
  const lg = data.config.league;
  const count = new Map<string, number>();
  const run = runLeagues(data, { runSeed: lg.calibrationSeed, leagues: lg.leagues, gamesPerLeague: lg.gamesPerLeague, onGame: (r) => measure(r, count) }, prepareGame(data));
  return { games: run.games, counts: Object.fromEntries([...count.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) };
}

if (import.meta.main) {
  const out = investigate();
  writeFileSync(join(REPO, "data/game/investigations.json"), JSON.stringify({ generated: true, ...out }, null, 1) + "\n");
  process.stdout.write(`wrote data/game/investigations.json (${out.games} games)\n`);
}
