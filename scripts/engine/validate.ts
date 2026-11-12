// Drives the TypeScript play engine for the pipeline's component validation
// (pipeline/engine/validate.py). Reads one JSON request per line, resolves each K times with
// generated league-average teams and a fixed seed, and writes one JSON result per line.
//
//   node --import ./scripts/engine/register.mjs scripts/engine/validate.ts <in.jsonl> <out.jsonl> <seed> <k> [teams]
//
// `teams` (optional, for sensitivity checks; the pre-registered validation omits it): a team
// seed, so the 32 generated teams are drawn from that seed while every other draw keeps <seed>,
// or "flat" for 32 league-average teams with every rating at the curve's center (65).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCallerConfig, parseCallerTables, parseCatalog } from "../../packages/shared/src/schema";
import { parseRuleSet } from "../../packages/shared/src/rules-schema";
import { parseEngineData } from "../../packages/shared/src/engine-schema";
import type { CallerData, EngineData, TeamPool } from "../../packages/shared/src/types";
import { chooseDefenseCall } from "../../packages/sim/src/caller/defense";
import { formationShares, type OffenseCall } from "../../packages/sim/src/caller/offense";
import { sampleIndex } from "../../packages/sim/src/caller/sample";
import { createEngine } from "../../packages/sim/src/engine/resolve";
import { generateTeam } from "../../packages/sim/src/engine/players";
import { toSituation } from "../../packages/sim/src/game/situation";
import type { GameState } from "../../packages/sim/src/game/types";
import { Rng } from "../../packages/sim/src/rng";

const TEAMS = 32;

interface Request {
  readonly i: number;
  readonly t: "scrim" | "fg" | "xp" | "tp" | "punt" | "ko" | "pen";
  readonly phase: "scrimmage" | "try" | "kickoff";
  readonly q: number;
  readonly clock: number;
  readonly spot: number;
  readonly down: number;
  readonly dist: number;
  readonly diff: number;
  readonly ot: number;
  readonly dt: number;
  readonly call: string;
  readonly formation: string | null;
  readonly two?: string;
}

function readJson(root: string, p: string): unknown {
  return JSON.parse(readFileSync(join(root, p), "utf8"));
}

function loadAll(root: string): { data: EngineData; caller: CallerData } {
  const caller: CallerData = {
    catalog: parseCatalog(readJson(root, "data/calls/catalog.json")),
    config: parseCallerConfig(readJson(root, "data/caller/config.json")),
    offense: parseCallerTables(readJson(root, "data/caller/offense.table.json")),
    defense: parseCallerTables(readJson(root, "data/caller/defense.table.json")),
  };
  const rules = parseRuleSet(readJson(root, "data/rules/nfl-2026.json"));
  const data = parseEngineData(
    {
      config: readJson(root, "data/engine/config.json"),
      scrimmage: readJson(root, "data/engine/baseline.scrimmage.json"),
      special: readJson(root, "data/engine/baseline.special.json"),
      penalties: readJson(root, "data/engine/baseline.penalties.json"),
      kickoff: readJson(root, "data/engine/kickoff.json"),
      matchup: readJson(root, "data/engine/matchup.centered.json"),
      personnel: readJson(root, "data/engine/personnel.json"),
      ratings: readJson(root, "data/players/ratings.json"),
      distributions: readJson(root, "data/players/distributions.json"),
      names: readJson(root, "data/players/names.json"),
      why: readJson(root, "data/engine/why.json"),
    },
    rules,
    caller,
  );
  return { data, caller };
}

/** A game state with the request's situation. The offense is home; scores keep the difference. */
function stateFor(r: Request, rules: EngineData["rules"]): GameState {
  const base = 50;
  const twoMinute = (r.q === 2 || r.q === 4) && r.clock <= rules.clock.twoMinuteWarningSeconds;
  return {
    rules: { id: rules.id, hash: "validation" },
    seed: 0,
    gameType: "regularSeason",
    period: r.q,
    clock: r.clock,
    clockRunning: false,
    playClock: rules.clock.playClockAfterPlay,
    phase: r.phase,
    possession: "home",
    spot: r.spot,
    down: r.phase === "scrimmage" ? r.down : 0,
    distance: r.phase === "scrimmage" ? r.dist : 0,
    goalToGo: r.phase === "scrimmage" && 100 - r.spot <= r.dist,
    trySpots: r.phase === "try" ? { kick: 100 - rules.try.kickSpot, twoPoint: 100 - rules.try.twoPointSpot } : null,
    safetyKick: false,
    score: { home: base + Math.max(0, r.diff), away: base + Math.max(0, -r.diff) },
    timeouts: { home: r.ot, away: r.dt },
    timeoutsThisDeadBall: { home: 0, away: 0 },
    twoMinuteWarningDone: twoMinute,
    untimedDown: false,
    toss: { winner: "home", choice: "defer", secondHalfReceiver: "home" },
    overtime: null,
    playCount: 0,
    result: null,
  };
}

function main(): void {
  const [input, output, seedArg, kArg, teamsArg] = process.argv.slice(2);
  if (input === undefined || output === undefined) throw new Error("usage: validate.ts <in.jsonl> <out.jsonl> <seed> <k> [teamSeed|flat]");
  const seed = Number(seedArg ?? 1);
  const k = Number(kArg ?? 4);
  const root = join(import.meta.dirname, "../..");
  const { data, caller } = loadAll(root);
  const resolve = createEngine(data);
  const teamRng = Rng.fromSeed(teamsArg === undefined || teamsArg === "flat" ? seed : Number(teamsArg));
  const FLAT = 65;
  const flatten = (t: TeamPool): TeamPool => ({
    ...t,
    players: t.players.map((p) => ({
      ...p,
      ratings: Object.fromEntries(Object.keys(p.ratings).map((r) => [r, FLAT])) as typeof p.ratings,
      skills: Object.fromEntries(Object.keys(p.skills).map((r) => [r, FLAT])),
    })),
  });
  const teams: TeamPool[] = Array.from({ length: TEAMS }, (_, i) => generateTeam(teamRng, data, `T${i}`)).map((t) => (teamsArg === "flat" ? flatten(t) : t));
  const lines = readFileSync(input, "utf8").split("\n").filter((l) => l.length > 0);
  const out: string[] = [];
  const formations = caller.offense.factors.oFormation?.targets ?? [];
  const puntClasses = data.special.punts.classes;
  const kickoffClasses = data.kickoff.kickoff.classes;
  for (const line of lines) {
    const r = JSON.parse(line) as Request;
    const s = stateFor(r, data.rules);
    const rng = Rng.fromSeed(seed + r.i);
    const res: unknown[] = [];
    const rates: Record<string, number> = {};
    // Exact class probabilities, averaged over the resolutions that drew a class (diagnostics).
    const probs: Record<string, number> = {};
    let nProbs = 0;
    for (let j = 0; j < k; j++) {
      const off = teams[(r.i * 7 + j) % TEAMS] as TeamPool;
      const def = teams[(r.i * 13 + j * 5 + 1) % TEAMS] as TeamPool;
      const players = { home: off, away: def === off ? (teams[(r.i + 1) % TEAMS] as TeamPool) : def };
      let call: OffenseCall = { call: r.call };
      let defense: string | null = null;
      if (r.t === "scrim" || r.t === "tp" || (r.t === "pen" && (r.call !== "punt" && r.call !== "fieldGoal" && r.call !== "extraPoint" && r.call !== "kneel" && r.call !== "spike"))) {
        const sit = toSituation(s, data.rules);
        const leaf = r.t === "tp" || r.call === "goForTwo" ? (r.two as string) : r.call;
        let formation = r.formation;
        if (formation === null) formation = formations[sampleIndex(formationShares(sit, leaf, caller).weights, rng)] as string;
        call = r.call === "goForTwo" ? { call: "goForTwo", twoPointPlay: leaf, formation } : { call: leaf, formation };
        defense = chooseDefenseCall(sit, caller, rng);
      }
      const p = resolve(s, call, defense, players, rng);
      const d = (p.detail ?? {}) as Record<string, unknown>;
      if (r.t === "pen") {
        for (const [id, v] of Object.entries(d["foulRates"] as Record<string, number>)) rates[id] = (rates[id] ?? 0) + v / k;
        continue;
      }
      const cls = d["class"] as string | undefined;
      const cp = d["classProbabilities"] as Record<string, number> | undefined;
      if (r.t === "scrim" && cp !== undefined) {
        nProbs++;
        for (const [c, v] of Object.entries(cp)) probs[c] = (probs[c] ?? 0) + v;
      }
      switch (r.t) {
        case "scrim":
          // The class and yards drawn before any foul pairing, compared with real plays without an
          // accepted foul (a foul paired with an incompletion replaces the play as enforced).
          res.push(p.kind === "noPlay" ? null : [d["sampledClass"], d["sampledYards"], d["class"] === d["sampledClass"] && "turnover" in p && p.turnover === "fumble" ? 1 : 0]);
          break;
        case "fg":
        case "xp":
          res.push(p.kind === "noPlay" ? null : cls);
          break;
        case "tp":
          res.push(p.kind === "noPlay" ? null : p.kind === "twoPoint" && p.incomplete !== true && p.end.possession === "offense" && p.end.spot >= 100 ? 1 : 0);
          break;
        case "punt":
          res.push(p.kind === "noPlay" ? null : [puntClasses.indexOf(cls ?? ""), d["gross"], d["returnYards"]]);
          break;
        case "ko": {
          let start: number | null = null;
          if (p.kind === "kickoff") {
            if (p.outcome === "touchbackEndZone") start = data.rules.kickoff.touchbackFromEndZone;
            else if (p.outcome === "touchbackLandingZone") start = data.rules.kickoff.touchbackAfterLandingZone;
            else if (p.outcome === "short" || p.outcome === "outOfBounds") start = 100 - (s.spot + data.rules.kickoff.shortOrOutOfBoundsYards);
            else if (p.end !== undefined && p.end.possession === "defense" && p.end.spot > 0) start = 100 - p.end.spot;
          }
          res.push([kickoffClasses.indexOf(cls ?? ""), start]);
          break;
        }
      }
    }
    if (nProbs > 0) for (const c of Object.keys(probs)) probs[c] = Math.round(((probs[c] as number) / nProbs) * 1e6) / 1e6;
    out.push(JSON.stringify(r.t === "pen" ? { i: r.i, rates } : r.t === "scrim" ? { i: r.i, r: res, p: probs } : { i: r.i, r: res }));
  }
  writeFileSync(output, out.join("\n") + "\n");
}

main();
