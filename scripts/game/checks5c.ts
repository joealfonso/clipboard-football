// M1 step 5c milestone 0.3: the sim side of the 17 pre-registered checks
// (data/game/step5c-checks.json), on the in-sample run's games (same run seed, leagues and games
// as GAME_REPORT.md section 1) plus the c.ot.complete postseason soak (league 4242, seeds
// 1-10,000). The measures mirror pipeline/game/checks5c.py exactly; see its docstring for the
// definitions. Changes no table, config or sim code.
//
//   node --import ./scripts/engine/register.mjs scripts/game/checks5c.ts [--label <name>] [--skip-ot]
//
// Writes data/game/checks5c.sim.json (one block per label, so a before and an after can sit
// side by side); scripts/game/report.ts renders it next to data/game/checks5c.real.json.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GameData } from "../../packages/shared/src/types";
import { leagueFromSeed, averageCoachFor, setupGame } from "../../packages/sim/src/loop/league";
import { playGame, prepareGame, type GameEvent, type GameKit, type GameRecord } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { REPO, loadGameData } from "./data";
import { runLeagues, MARGIN_BINS } from "./metrics";
import { evaluate, type CheckRow } from "./checks5c-rules";

export { evaluate, type CheckRow };

type PlayEvent = Extract<GameEvent, { t: "play" }>;
type Team = "home" | "away";
const otherTeam = (t: Team): Team => (t === "home" ? "away" : "home");

export const COUNT_KEYS = [
  "games",
  "trail.lastSnap",
  "trail.longGap.gaps",
  "trail.longGap.hits",
  "spike.stopped",
  "kneel.games",
  "kneel.ballBack",
  "kneel.shortGap0TO.gaps",
  "kneel.shortGap0TO.hits",
  "kneel.early",
  "fg.60",
  "fg.63",
  "fg.70",
  "fg.50to59",
  "try.down2GF.tries",
  "try.down2GF.two",
  "try.tiedG5.tries",
  "try.tiedG5.kick",
  "to.kickoffQ13",
  "to.tryQ13",
  "to.kickoffAll",
  "rough.scramble",
  "trail.endsOnRunoff",
] as const;

const isSnap = (e: GameEvent): e is PlayEvent => e.t === "play" && e.before.phase === "scrimmage" && e.play.kind !== "noPlay";
const lead = (e: PlayEvent, t: Team): number => e.before.score[t] - e.before.score[otherTeam(t)];

function fieldGoalDistance(e: PlayEvent, endZoneYards: number): number {
  const p = e.play as { kickSpot?: number };
  return 100 - (p.kickSpot ?? 0) + endZoneYards;
}

/** Adds one game's counts. Every key is a count; shares and per-game rates are formed at the end. */
export function measureChecks(record: GameRecord, data: GameData, c: Map<string, number>): void {
  const add = (k: string, v = 1): void => {
    c.set(k, (c.get(k) ?? 0) + v);
  };
  add("games");
  const ev = record.events;
  const ez = data.engine.rules.field.endZoneYards;
  let lastQ4: PlayEvent | null = null;
  let firstKneel: { i: number; team: Team } | null = null;
  let ballBack = false;
  // Gaps: consecutive scrimmage snaps of one drive with nothing but run-off between them.
  let prev: { e: PlayEvent; clean: boolean } | null = null;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i] as GameEvent;
    if (e.t === "timeout") {
      if (e.before.phase === "kickoff") {
        add("to.kickoffAll");
        if (e.before.period <= 3) add("to.kickoffQ13");
      }
      if (e.before.phase === "try" && e.before.period <= 3) add("to.tryQ13");
    }
    if (e.t === "play" && e.before.phase === "try" && (e.play.kind === "extraPoint" || e.play.kind === "twoPoint") && e.before.period === 4) {
      const d = lead(e, e.before.possession);
      if (d === -2 && e.before.clock <= 120) {
        add("try.down2GF.tries");
        if (e.play.kind === "twoPoint") add("try.down2GF.two");
      }
      if (d === 0 && e.before.clock <= 300) {
        add("try.tiedG5.tries");
        if (e.play.kind === "extraPoint") add("try.tiedG5.kick");
      }
      // C4 (reported, not gated): every late try by score after the touchdown.
      if (e.before.clock <= 300 && d >= -8 && d <= 8) {
        const cell = `try.cell.${e.before.clock <= 120 ? "GF" : "G5"}.${d}`;
        add(`${cell}.tries`);
        if (e.play.kind === "twoPoint") add(`${cell}.two`);
      }
    }
    if (!isSnap(e)) {
      if (e.t !== "runoff" && prev !== null) prev.clean = false;
      continue;
    }
    const b = e.before;
    const off = b.possession;
    const def = otherTeam(off);
    const kind = e.play.kind;
    if (prev !== null && prev.clean) {
      const a = prev.e;
      const sameDrive = a.before.possession === off && a.after.possession === off && a.after.phase === "scrimmage" && a.before.period === b.period;
      if (sameDrive && a.before.period === 4 && a.before.clock <= 120) {
        const gap = a.before.clock - b.clock;
        const ad = lead(a, off);
        if (ad >= -8 && ad <= -1 && a.before.timeouts[off] >= 1) {
          add("trail.longGap.gaps");
          if (gap >= 35) add("trail.longGap.hits");
        }
        if (ad >= 1 && a.before.timeouts[def] === 0) {
          add("kneel.shortGap0TO.gaps");
          if (gap <= 15) add("kneel.shortGap0TO.hits");
        }
      }
    }
    prev = { e, clean: true };
    if (b.period === 4) lastQ4 = e;
    if (kind === "spike" && !b.clockRunning) add("spike.stopped");
    if (kind === "kneel") {
      if (b.period === 1 || b.period === 3 || (b.period === 2 && b.clock > 60)) add("kneel.early");
      if (b.period === 4 && firstKneel === null && lead(e, off) >= 1) firstKneel = { i, team: off };
    }
    if (firstKneel !== null && i > firstKneel.i && b.period === 4 && off !== firstKneel.team) ballBack = true;
    if (kind === "fieldGoal") {
      const d = fieldGoalDistance(e, ez);
      if (d >= 60) add("fg.60");
      if (d >= 63) add("fg.63");
      if (d >= 70) add("fg.70");
      if (d >= 50 && d <= 59) add("fg.50to59");
    }
    if (kind === "scramble" && e.penalty !== null && e.penalty.kind === "accept") {
      const f = (e.play.fouls ?? [])[e.penalty.foul];
      if (f !== undefined && f.penalty === "roughingThePasser" && f.by === "defense") add("rough.scramble");
    }
  }
  if (lastQ4 !== null) {
    const off = lastQ4.before.possession;
    const d = lead(lastQ4, off);
    if (d >= -8 && d <= -1 && lastQ4.before.timeouts[off] >= 1 && lastQ4.before.clock >= 15) add("trail.lastSnap");
  }
  if (firstKneel !== null) {
    add("kneel.games");
    if (ballBack) add("kneel.ballBack");
  }
  // Reported, not gated: Q4 ends on a run-off by a 1-8 trailer that still holds timeouts.
  for (let i = ev.length - 1; i >= 0; i--) {
    const e = ev[i] as GameEvent;
    if (e.t === "endPeriod" && e.period === 4) {
      const r = ev[i - 1];
      if (r !== undefined && r.t === "runoff" && r.before.period === 4) {
        const off = r.before.possession;
        const d = r.before.score[off] - r.before.score[otherTeam(off)];
        if (d >= -8 && d <= -1 && r.before.timeouts[off] >= 1) add("trail.endsOnRunoff");
      }
      break;
    }
  }
}

/** Reported, not gated: margins and postseason periods. */
export function measureMargins(record: GameRecord, c: Map<string, number>): void {
  const add = (k: string, v = 1): void => {
    c.set(k, (c.get(k) ?? 0) + v);
  };
  const m = Math.abs(record.final.score.home - record.final.score.away);
  for (const [lab, lo, hi] of MARGIN_BINS) if (m >= lo && m <= hi) add(`margin.${lab}`);
  if (m === 3) add("margin.exact3");
  if (record.final.period > 4) {
    add("ot.games");
    if (m === 3) add("ot.endsOn3");
  }
}

export interface OtSoak {
  readonly games: number;
  readonly noRecord: number;
  readonly ties: number;
  readonly errors: readonly string[];
  readonly otGames: number;
  readonly otPeriods: number;
  readonly maxPeriod: number;
  readonly maxSnaps: number;
}

export function otSoak(data: GameData, kit: GameKit, leagueSeed = 4242, games = 10000): OtSoak {
  const { teams } = leagueFromSeed(data, leagueSeed);
  const coach = averageCoachFor(data);
  let noRecord = 0;
  let ties = 0;
  let otGames = 0;
  let otPeriods = 0;
  let maxPeriod = 0;
  let maxSnaps = 0;
  const errors: string[] = [];
  for (let seed = 1; seed <= games; seed++) {
    let rec: GameRecord;
    try {
      rec = playGame(setupGame(teams, leagueSeed, seed, () => coach, "postseason"), kit, Rng.fromSeed(seed));
    } catch (e) {
      noRecord++;
      if (errors.length < 10) errors.push(`seed ${seed}: ${(e as Error).message}`);
      continue;
    }
    if (rec.final.result === null || rec.final.result.winner === null) ties++;
    if (rec.final.period > 4) {
      otGames++;
      otPeriods += rec.final.period - 4;
    }
    maxPeriod = Math.max(maxPeriod, rec.final.period);
    maxSnaps = Math.max(maxSnaps, rec.events.filter(isSnap).length);
  }
  return { games, noRecord, ties, errors, otGames, otPeriods, maxPeriod, maxSnaps };
}

export interface SimChecks {
  readonly label: string;
  readonly games: number;
  readonly counts: Record<string, number>;
  readonly byLeague: Record<string, number>[];
  readonly ot: OtSoak | null;
}

export function simChecks(label: string, skipOt: boolean, size?: { leagues: number; games: number }): SimChecks {
  const data = loadGameData();
  const kit = prepareGame(data);
  const lg = { ...data.config.league, ...(size === undefined ? {} : { leagues: size.leagues, gamesPerLeague: size.games }) };
  const all = new Map<string, number>();
  const byLeague: Map<string, number>[] = [];
  const run = runLeagues(
    data,
    {
      runSeed: lg.calibrationSeed,
      leagues: lg.leagues,
      gamesPerLeague: lg.gamesPerLeague,
      onGame: (r, _box, g) => {
        measureChecks(r, data, all);
        measureMargins(r, all);
        while (byLeague.length <= g.league) byLeague.push(new Map());
        const mine = byLeague[g.league] as Map<string, number>;
        measureChecks(r, data, mine);
        measureMargins(r, mine);
      },
    },
    kit,
  );
  const sorted = (m: Map<string, number>): Record<string, number> => Object.fromEntries([...m.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  return { label, games: run.games, counts: sorted(all), byLeague: byLeague.map(sorted), ot: skipOt ? null : otSoak(data, kit) };
}

export const SIM_FILE = "data/game/checks5c.sim.json";

export const REAL_FILE = "data/game/checks5c.real.json";

export function showChecks(label: string): string {
  const sim = (JSON.parse(readFileSync(join(REPO, SIM_FILE), "utf8")) as { runs: Record<string, SimChecks> }).runs[label];
  if (sim === undefined) throw new Error(`no run ${label} in ${SIM_FILE}`);
  const real = (JSON.parse(readFileSync(join(REPO, REAL_FILE), "utf8")) as { counts: Record<string, number> }).counts;
  const fmt = (r: CheckRow, v: number | null): string => (v === null || Number.isNaN(v) ? "-" : r.unit === "pp" ? `${v.toFixed(2)}%` : r.unit === "count" ? String(v) : v.toFixed(4));
  return evaluate(sim, real).map((r) => `${r.id.padEnd(22)} sim ${fmt(r, r.sim).padStart(9)}  real ${fmt(r, r.real).padStart(9)}  ${r.pass ? "pass" : "FAIL"}  (${r.rule}; n ${r.n})`).join("\n") + "\n";
}

if (import.meta.main && process.argv.includes("--show")) {
  const args = process.argv.slice(2);
  process.stdout.write(showChecks(args[args.indexOf("--show") + 1] ?? "current"));
} else if (import.meta.main) {
  const args = process.argv.slice(2);
  const label = args.includes("--label") ? (args[args.indexOf("--label") + 1] as string) : "current";
  // --quick: 2 leagues x 500 games, for development only (never a reported run).
  const out = simChecks(label, args.includes("--skip-ot"), args.includes("--quick") ? { leagues: 2, games: 500 } : undefined);
  const path = join(REPO, SIM_FILE);
  const prev = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { runs: Record<string, SimChecks> }) : { runs: {} };
  const runs = { ...prev.runs, [label]: out };
  writeFileSync(path, JSON.stringify({ generated: true, runs }, null, 1) + "\n");
  process.stdout.write(`wrote ${SIM_FILE} (${label}: ${out.games} games${out.ot === null ? "" : `, OT soak ${out.ot.games} games, ${out.ot.noRecord} without a record, ${out.ot.ties} ties`})\n`);
}
