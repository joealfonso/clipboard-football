// M1 step 5d milestone 0.3: the sim side of the pre-registered checks
// (data/game/step5d-checks.json), on the in-sample run's games (same run seed, leagues and games
// as GAME_REPORT.md section 1), plus the d.try.otDown2 overtime tries of the league 4242
// postseason soak (seeds 1-10,000). The measures mirror pipeline/game/checks5d.py exactly; see its
// docstring for the definitions. Changes no table, config or sim code.
//
//   node --import ./scripts/engine/register.mjs scripts/game/checks5d.ts [--label <name>] [--skip-ot]
//
// Writes data/game/checks5d.sim.json (one block per label, so the runs of every milestone sit side
// by side); scripts/game/report.ts renders it next to data/game/checks5d.real.json.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GameData } from "../../packages/shared/src/types";
import { averageCoachFor, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { playGame, prepareGame, type GameEvent, type GameKit, type GameRecord } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { measureMargins } from "./checks5c";
import { evaluate5d, type Check5dRow } from "./checks5d-rules";
import { REPO, loadGameData } from "./data";
import { runLeagues } from "./metrics";

export { evaluate5d, type Check5dRow };

type PlayEvent = Extract<GameEvent, { t: "play" }>;
type Team = "home" | "away";
const otherTeam = (t: Team): Team => (t === "home" ? "away" : "home");
const isSnap = (e: GameEvent): e is PlayEvent => e.t === "play" && e.before.phase === "scrimmage" && e.play.kind !== "noPlay";
const lead = (e: PlayEvent, t: Team): number => e.before.score[t] - e.before.score[otherTeam(t)];
const RUN_PASS = new Set(["run", "pass", "sack", "scramble"]);

/**
 * Step 5d milestone A's ot_both_possessed, read from the events the same way the pipeline reads
 * pbp rows (pipeline/caller/load.py ot_both_possessed): the first team receives OT's first
 * kickoff; on at the second team's first scrimmage or try play, or after a first-team kickoff or punt.
 */
export function otFlags(events: readonly GameEvent[], regulationPeriods = 4): number[] {
  let first: Team | null = null;
  let on = false;
  return events.map((e) => {
    if (e.t !== "play" || e.before.period <= regulationPeriods) return 0;
    const b = e.before;
    // Kickoff events carry the kicking team; pbp lists the receiving team as posteam.
    const pos = b.phase === "kickoff" ? otherTeam(b.possession) : b.possession;
    if (first === null) first = pos;
    if (!on && pos !== first && (b.phase === "scrimmage" || b.phase === "try")) on = true;
    const flag = on ? 1 : 0;
    if ((b.phase === "kickoff" && b.possession === first) || (b.phase === "scrimmage" && e.play.kind === "punt" && pos === first)) on = true;
    return flag;
  });
}

/** Adds one game's counts. Every key is a count; shares and per-game rates are formed at the end. */
export function measure5d(record: GameRecord, c: Map<string, number>): void {
  const add = (k: string, v = 1): void => {
    c.set(k, (c.get(k) ?? 0) + v);
  };
  add("games");
  const ev = record.events;
  const flags = otFlags(ev);
  let prev: { e: PlayEvent; clean: boolean } | null = null;
  let drive = 0;
  let lastOffense: Team | null = null;
  const kneels = new Map<number, string>();
  const replayed = new Set<number>();
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i] as GameEvent;
    if (e.t === "play" && e.before.phase === "try" && (e.play.kind === "extraPoint" || e.play.kind === "twoPoint")) {
      // E4 (reported): every overtime try by otBothPossessed and score after the touchdown.
      if (e.before.period >= 5) {
        const cell = `ottry.${flags[i] ?? 0}.${lead(e, e.before.possession)}`;
        add(`${cell}.tries`);
        if (e.play.kind === "twoPoint") add(`${cell}.two`);
      }
      if (e.before.period >= 5 && lead(e, e.before.possession) === -2 && flags[i] === 1) {
        add("try.otDown2.tries");
        if (e.play.kind === "twoPoint") add("try.otDown2.two");
      }
    }
    if (e.t === "play" && e.before.phase !== "scrimmage") {
      // A kickoff or a try ends the possession.
      drive++;
      lastOffense = null;
    }
    if (!isSnap(e)) {
      if (e.t !== "runoff" && prev !== null) prev.clean = false;
      continue;
    }
    const b = e.before;
    const off = b.possession;
    if (lastOffense !== off) {
      drive++;
      lastOffense = off;
    }
    const kind = e.play.kind;
    const d = lead(e, off);
    if (prev !== null && prev.clean) {
      const a = prev.e;
      const sameDrive = a.before.possession === off && a.after.possession === off && a.after.phase === "scrimmage" && a.before.period === b.period;
      const ad = lead(a, off);
      if (sameDrive && a.before.period === 4 && ad >= -8 && ad <= -1 && a.before.timeouts[off] === 0) {
        const gap = a.before.clock - b.clock;
        for (const [w, lim] of [["", 60], [".final2", 120]] as const) {
          if (a.before.clock <= lim) {
            add(`gap.trail0TO${w}.gaps`);
            if (gap >= 15) add(`gap.trail0TO${w}.hits`);
          }
        }
      }
    }
    prev = { e, clean: true };
    if (kind === "spike") add("spike.all");
    if (b.period < 4) continue;
    const own = b.timeouts[off];
    const trail18 = d >= -8 && d <= -1;
    if (kind === "spike" && trail18) add(own === 0 ? "spike.trail0TO" : "spike.trail1TO");
    if (trail18 && own === 0 && b.down <= 3 && (b.period >= 5 || b.clock <= 120)) {
      const k = b.clockRunning ? "spike.running0TO" : "spike.stopped0TO";
      add(`${k}.snaps`);
      if (kind === "spike") add(`${k}.spikes`);
    }
    if (kind === "kneel") {
      if (d <= 0 && b.clock > 47) {
        add("kneel.notLeading");
        add(d === 0 ? "kneel.notLeading.tied" : d >= -8 ? "kneel.notLeading.trail1to8" : "kneel.notLeading.trail9");
      }
      if (b.down === 4 && b.clock > 10) add("kneel.4thLate");
      if (!kneels.has(drive)) kneels.set(drive, d >= 1 && d <= 8 ? "lead1to8" : d >= 9 ? "lead9" : "notLeading");
    } else if (RUN_PASS.has(kind) && kneels.has(drive) && !replayed.has(drive)) {
      replayed.add(drive);
      add(`kneel.thenPlay.${kneels.get(drive) as string}`);
    }
  }
}

export interface OtTries {
  readonly games: number;
  readonly tries: number;
  readonly two: number;
  /** E4: every overtime try of the soak by flag and score ("ottry.<flag>.<score>.tries" / ".two"). */
  readonly cells?: Readonly<Record<string, number>>;
}

/** d.try.otDown2's postseason part: league 4242, seeds 1-10,000. */
export function otTrySoak(data: GameData, kit: GameKit, leagueSeed = 4242, games = 10000): OtTries {
  const { teams } = leagueFromSeed(data, leagueSeed);
  const coach = averageCoachFor(data);
  const c = new Map<string, number>();
  for (let seed = 1; seed <= games; seed++) {
    measure5d(playGame(setupGame(teams, leagueSeed, seed, () => coach, "postseason"), kit, Rng.fromSeed(seed)), c);
  }
  const cells = Object.fromEntries([...c.entries()].filter(([k]) => k.startsWith("ottry.")).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { games, tries: c.get("try.otDown2.tries") ?? 0, two: c.get("try.otDown2.two") ?? 0, cells };
}

export interface Sim5d {
  readonly label: string;
  readonly games: number;
  readonly counts: Record<string, number>;
  readonly byLeague: Record<string, number>[];
  readonly ot: OtTries | null;
}

export function sim5d(label: string, skipOt: boolean, size?: { leagues: number; games: number }): Sim5d {
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
        measure5d(r, all);
        measureMargins(r, all);
        while (byLeague.length <= g.league) byLeague.push(new Map());
        const mine = byLeague[g.league] as Map<string, number>;
        measure5d(r, mine);
        measureMargins(r, mine);
      },
    },
    kit,
  );
  const sorted = (m: Map<string, number>): Record<string, number> => Object.fromEntries([...m.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  return { label, games: run.games, counts: sorted(all), byLeague: byLeague.map(sorted), ot: skipOt ? null : otTrySoak(data, kit) };
}

export const SIM_FILE = "data/game/checks5d.sim.json";
export const REAL_FILE = "data/game/checks5d.real.json";

export function show5d(label: string): string {
  const sim = (JSON.parse(readFileSync(join(REPO, SIM_FILE), "utf8")) as { runs: Record<string, Sim5d> }).runs[label];
  if (sim === undefined) throw new Error(`no run ${label} in ${SIM_FILE}`);
  const real = (JSON.parse(readFileSync(join(REPO, REAL_FILE), "utf8")) as { counts: Record<string, number> }).counts;
  const fmt = (r: Check5dRow, v: number | null): string => (v === null || Number.isNaN(v) ? "-" : r.unit === "pp" ? `${v.toFixed(2)}%` : r.unit === "count" ? String(v) : v.toFixed(4));
  return evaluate5d(sim, real).map((r) => `${r.id.padEnd(28)} sim ${fmt(r, r.sim).padStart(9)}  real ${fmt(r, r.real).padStart(9)}  ${r.gated ? (r.pass ? "pass" : "FAIL") : "reported"}  (${r.rule}; n ${r.n})`).join("\n") + "\n";
}

if (import.meta.main && process.argv.includes("--show")) {
  const args = process.argv.slice(2);
  process.stdout.write(show5d(args[args.indexOf("--show") + 1] ?? "current"));
} else if (import.meta.main) {
  const args = process.argv.slice(2);
  const label = args.includes("--label") ? (args[args.indexOf("--label") + 1] as string) : "current";
  // --quick: 2 leagues x 500 games, for development only (never a reported run).
  const out = sim5d(label, args.includes("--skip-ot"), args.includes("--quick") ? { leagues: 2, games: 500 } : undefined);
  const path = join(REPO, SIM_FILE);
  const prev = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { runs: Record<string, Sim5d> }) : { runs: {} };
  writeFileSync(path, JSON.stringify({ generated: true, runs: { ...prev.runs, [label]: out } }, null, 1) + "\n");
  process.stdout.write(`wrote ${SIM_FILE} (${label}: ${out.games} games${out.ot === null ? "" : `, OT soak ${out.ot.games} games, ${out.ot.two}/${out.ot.tries} two-point tries down 2 with both possessed`})\n`);
}
