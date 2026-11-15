// M2 milestone G8: scripted games that reach every review case: a human challenge that stands and
// one that is reversed, an AI challenge both ways, and a review the rules call for (the Replay
// Official). The human answers every request with a seeded random legal path, except that he
// throws the flag on every challenge he is offered. Searches game seeds in one generated league
// for the fewest games covering all five, then replays each game from its seed and input log
// alone to check it reaches the same reviews.
//
//   node --import ./scripts/engine/register.mjs scripts/game/g8-reach.ts [--write]
//
// --write records the games in test/fixtures/m2-g8-games.json (seed, human seat, input log).

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DecisionAnswer, DecisionRequest } from "../../packages/shared/src/types";
import { averageCoachFor, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { prepareGame, type GameEvent } from "../../packages/sim/src/loop/play";
import { answerSession, replaySession, sessionRecord, startSession } from "../../packages/sim/src/loop/session";
import { Rng } from "../../packages/sim/src/rng";
import { REPO, loadGameData } from "./data";
import { randomPath } from "./session-perf";

const LEAGUE_SEED = 2026;
const CASES = ["humanStands", "humanReversed", "aiStands", "aiReversed", "booth"] as const;
type Case = (typeof CASES)[number];

function pathFor(r: DecisionRequest, bot: Rng): string[] {
  if (r.kind === "challenge") return ["throwFlag"];
  return randomPath(r, bot);
}

function casesOf(events: readonly GameEvent[], human: "home" | "away"): Set<Case> {
  const out = new Set<Case>();
  for (const e of events) {
    if (e.t !== "review") continue;
    if (e.by === "booth") out.add("booth");
    else if (e.by === human) out.add(e.verdict === "reversed" ? "humanReversed" : "humanStands");
    else out.add(e.verdict === "reversed" ? "aiReversed" : "aiStands");
  }
  return out;
}

function main(): number {
  const data = loadGameData();
  const kit = prepareGame(data, { closeCalls: true });
  const coach = averageCoachFor(data);
  const { teams } = leagueFromSeed(data, LEAGUE_SEED);
  const found = new Map<Case, { seed: number; human: "home" | "away"; inputs: DecisionAnswer[] }>();
  const games: { seed: number; human: "home" | "away"; inputs: DecisionAnswer[]; cases: Case[] }[] = [];
  for (let seed = 1; seed <= 2000 && found.size < CASES.length; seed++) {
    const human: "home" | "away" = seed % 2 === 0 ? "home" : "away";
    const setup = setupGame(teams, LEAGUE_SEED, seed, () => coach);
    const bot = Rng.fromSeed(seed);
    let s = startSession(setup, kit, human);
    while (s.request !== null) {
      const r = answerSession(s, setup, kit, { seq: s.request.seq, path: pathFor(s.request, bot) });
      if (!r.ok) throw new Error(`seed ${seed}: ${r.error.code} ${r.error.message}`);
      s = r.session;
    }
    const got = casesOf(sessionRecord(s, setup, kit).events, human);
    const fresh = [...got].filter((c) => !found.has(c));
    if (fresh.length === 0) continue;
    const g = { seed, human, inputs: [...s.inputs], cases: [...got] };
    games.push(g);
    for (const c of fresh) found.set(c, g);
  }
  const missing = CASES.filter((c) => !found.has(c));
  // Replay each kept game from its seed and input log alone (E2): the same reviews.
  for (const g of games) {
    const setup = setupGame(teams, LEAGUE_SEED, g.seed, () => coach);
    const again = casesOf(sessionRecord(replaySession(setup, kit, g.human, g.inputs), setup, kit).events, g.human);
    if (JSON.stringify([...again].sort()) !== JSON.stringify([...g.cases].sort())) throw new Error(`seed ${g.seed}: replay reached ${[...again]} not ${g.cases}`);
  }
  process.stdout.write(`[g8] ${games.length} games cover ${CASES.length - missing.length} of ${CASES.length} cases${missing.length > 0 ? ` (missing ${missing.join(", ")})` : ""}: ${games.map((g) => `seed ${g.seed} (${g.human}): ${g.cases.join(", ")}`).join("; ")}\n`);
  if (process.argv.includes("--write")) {
    writeFileSync(join(REPO, "test/fixtures/m2-g8-games.json"), JSON.stringify({ leagueSeed: LEAGUE_SEED, closeCalls: true, policy: "a seeded random legal path per request (Rng.fromSeed(game seed)), always throwFlag on a challenge request", games }, null, 1) + "\n");
  }
  return missing.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main();
