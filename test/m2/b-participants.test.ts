// M2 milestone B, who made the play (docs/specs/m2-engine-and-game-loop.md B1, B3, B4, B5, B7 and
// the edge cases list). B2 (and B7's "B2 still holds") is the outcome-digest check in
// outcome-digests.test.ts. Expectations come from the spec; the designed shares, units and
// fouler table are read from data/engine/participants.json, which the spec names as their home.

import { describe, expect, it, vi } from "vitest";
import type { OnField, Participants, Player, PlayResult, Position, TeamPool } from "../../packages/shared/src/types";
import { PARTICIPANT_ROLES } from "../../packages/shared/src/play";
import { createEngine, type ResolvePlay } from "../../packages/sim/src/engine/resolve";
import { creditStream } from "../../packages/sim/src/engine/participants";
import type { GameState } from "../../packages/sim/src/game/types";
import { leagueFromSeed } from "../../packages/sim/src/loop/league";
import { playGame, type GameKit, type GameRecord } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { callsFor } from "../../packages/sim/test/support/engine-calls";
import { flatTeam, scrimmageState, withRating } from "../../packages/sim/test/support/engine-fixtures";
import { randomGame } from "../../packages/sim/test/support/random-game";
import { loadRules } from "../../packages/sim/test/support/rules";
import { runSeeds } from "../../scripts/game/metrics";
import { data, kit, sliceGames, teams } from "./support";
import { checkTiltGaps, tiltGaps } from "./tilts";

// Whole games per test: the default 5 s is too short when the full suite runs in parallel.
vi.setConfig({ testTimeout: 120_000 });

const cfg = data.engine.participants;
const { rules, hash } = loadRules();
const caller = data.engine.caller;

interface Detail {
  participants?: Participants;
  onField?: OnField;
  class?: string;
  trace: { factor: string; [k: string]: unknown }[];
}
const det = (p: PlayResult): Detail => p.detail as unknown as Detail;

/** The step 4 C1 contract states (random games all over the game), as the contract test builds them. */
function contractStates(n: number): GameState[] {
  const out: GameState[] = [];
  for (let g = 0; out.length < n; g++) {
    const game = randomGame(rules, { gameType: g % 2 === 0 ? "regularSeason" : "postseason", seed: 7000 + g, rulesHash: hash }, 9000 + g);
    for (const s of game.states) if (s.phase === "scrimmage" || s.phase === "try" || s.phase === "kickoff") out.push(s);
  }
  return out.slice(0, n);
}

const OFFENSE_ROLES = new Set(["passer", "target", "receiver", "ballCarrier", "kicker", "punter"]);
const DEFENSE_ROLES = new Set(["sacker", "interceptor", "returner"]);
const KICKS = new Set(["kickoff", "onsideKick", "punt", "fieldGoal", "extraPoint"]);

type Side = "offense" | "defense";
interface Case {
  readonly play: PlayResult;
  readonly offensePool: TeamPool;
  readonly defensePool: TeamPool;
}

/** Everything wrong with one play's participants and onField, by the spec's B1/B3/B4 rules and edge cases. */
function problems(c: Case): string[] {
  const { play } = c;
  const d = det(play);
  const bad: string[] = [];
  const tag = `${play.kind}/${d.class ?? "-"}`;
  const parts = d.participants;
  const of = d.onField;
  if (parts === undefined || of === undefined) return [`${tag}: no participants or onField`];
  const sideOf = new Map<string, Side>();
  const byId = new Map<string, Player>();
  for (const pool of [c.offensePool, c.defensePool]) for (const p of pool.players) byId.set(p.id, p);
  for (const side of ["offense", "defense"] as const) {
    const pool = side === "offense" ? c.offensePool : c.defensePool;
    let n = 0;
    for (const [pos, ids] of Object.entries(of[side])) {
      for (const id of ids ?? []) {
        n++;
        const p = pool.players.find((x) => x.id === id);
        if (p === undefined) bad.push(`${tag}: onField.${side} ${id} is not on that team`);
        else if (p.position !== pos) bad.push(`${tag}: onField.${side}.${pos} holds ${id}, a ${p.position}`);
        if (sideOf.has(id)) bad.push(`${tag}: ${id} on the field twice`);
        sideOf.set(id, side);
      }
    }
    if (n !== 11) bad.push(`${tag}: onField.${side} has ${n} players`);
  }
  const roles = Object.keys(parts).filter((k) => k !== "foulers");
  for (const k of Object.keys(parts)) if (k !== "foulers" && !(PARTICIPANT_ROLES as readonly string[]).includes(k)) bad.push(`${tag}: unknown role ${k}`);
  const has = (r: string): boolean => (parts as Record<string, unknown>)[r] !== undefined;
  const sideOfRole = (r: string): Side | undefined => sideOf.get((parts as Record<string, string>)[r] as string);
  for (const r of roles) {
    const id = (parts as Record<string, string>)[r] as string;
    if (!sideOf.has(id)) {
      bad.push(`${tag}: ${r} ${id} is not on the field`);
      continue;
    }
    if (OFFENSE_ROLES.has(r) && sideOf.get(id) !== "offense") bad.push(`${tag}: ${r} is not on the snapping or kicking side`);
    if (DEFENSE_ROLES.has(r) && sideOf.get(id) !== "defense") bad.push(`${tag}: ${r} is not on the other side`);
  }
  // Fouling players: one per foul, on the fouling side, at a position the designed table allows (B4).
  const fouls = play.fouls ?? [];
  const foulers = parts.foulers ?? [];
  if (foulers.length !== fouls.length) bad.push(`${tag}: ${foulers.length} foulers for ${fouls.length} fouls`);
  fouls.forEach((f, i) => {
    const id = foulers[i];
    if (id === undefined) return;
    if (sideOf.get(id) !== f.by) bad.push(`${tag}: fouler of ${f.penalty} is not on the ${f.by}`);
    const allowedPositions = cfg.foulers[f.penalty]?.[f.by];
    const pos = byId.get(id)?.position;
    if (allowedPositions === undefined) bad.push(`${tag}: no designed fouler positions for ${f.penalty} by ${f.by}`);
    else if (pos === undefined || !allowedPositions.includes(pos)) bad.push(`${tag}: ${f.penalty} by a ${pos}`);
  });
  // Roles against the result (B1 and the edge cases).
  const end = "end" in play ? play.end : undefined;
  if (has("tackler") && end !== undefined && sideOfRole("tackler") === end.possession) bad.push(`${tag}: the tackler is on the team holding the ball`);
  if (play.kind === "noPlay" && roles.length > 0) bad.push(`${tag}: a noPlay credits ${roles.join(",")}`);
  if (play.kind === "kneel") {
    for (const r of roles) if (byId.get((parts as Record<string, string>)[r] as string)?.position !== "QB" || sideOfRole(r) !== "offense") bad.push(`kneel: ${r} is not the offense QB`);
    if (roles.length !== 1) bad.push(`kneel: roles ${roles.join(",")}`);
  }
  if (play.kind === "sack" && (!has("sacker") || !has("passer"))) bad.push(`${tag}: sack without sacker and passer`);
  if (play.kind === "sack" && (has("target") || has("receiver"))) bad.push(`${tag}: sack with a target`);
  if (play.kind === "run" || play.kind === "scramble") if (!has("ballCarrier")) bad.push(`${tag}: no ball carrier`);
  if (play.kind === "scramble" && byId.get(parts.ballCarrier ?? "")?.position !== "QB") bad.push(`${tag}: scramble by a non-QB`);
  if (play.kind === "pass" || play.kind === "twoPoint") {
    const isPass = play.kind === "pass" || has("passer");
    if (isPass && !has("passer")) bad.push(`${tag}: no passer`);
    const intercepted = (play.kind === "pass" && play.turnover === "interception") || d.class === "int";
    const grounding = fouls.some((f) => cfg.noTarget.includes(f.penalty));
    if (intercepted) {
      if (!has("interceptor")) bad.push(`${tag}: interception without an interceptor`);
      if (has("receiver")) bad.push(`${tag}: interception with a receiver`);
    } else if ("incomplete" in play && play.incomplete === true) {
      if (!grounding && !has("target")) bad.push(`${tag}: incomplete pass without a target`);
      if (grounding && has("target")) bad.push(`${tag}: intentional grounding with a target`);
      if (has("receiver") || has("tackler")) bad.push(`${tag}: incomplete pass with a receiver or tackler`);
    } else if (isPass && d.class !== undefined && d.class.startsWith("c")) {
      if (!has("receiver") || parts.receiver !== parts.target) bad.push(`${tag}: completion without receiver = target`);
    }
  }
  const scrimmageTD = "touchdown" in play && play.touchdown === true;
  const returnTD = end !== undefined && end.possession === "defense" && end.spot <= 0;
  if ((scrimmageTD || returnTD) && has("tackler")) bad.push(`${tag}: touchdown with a tackler`);
  if (play.kind === "kickoff" || play.kind === "onsideKick") {
    if (!has("kicker")) bad.push(`${tag}: no kicker`);
    if (play.kind === "kickoff" && (play.outcome === "touchbackEndZone" || play.outcome === "touchbackLandingZone") && (has("returner") || has("tackler"))) bad.push(`${tag}: touchback with a returner or tackler`);
    if (play.kind === "kickoff" && play.outcome === "fairCatch" && (!has("returner") || has("tackler"))) bad.push(`${tag}: fair catch needs a returner and no tackler`);
    if (play.kind === "onsideKick" && play.outcome === "inPlay" && !has("fumbleRecoverer")) bad.push(`${tag}: onside kick in play with no recoverer`);
  }
  if (play.kind === "punt") {
    if (!has("punter")) bad.push(`${tag}: no punter`);
    if (play.fairCatch === true && (!has("returner") || has("tackler"))) bad.push(`${tag}: fair catch needs a returner and no tackler`);
    if (play.crossedLine && !play.touchedByReceivers && play.end.spot >= 100 && has("returner")) bad.push(`${tag}: punt touchback with a returner`);
  }
  if ((play.kind === "fieldGoal" || play.kind === "extraPoint") && !has("kicker")) bad.push(`${tag}: no kicker`);
  if (has("fumbleRecoverer") && end !== undefined && sideOfRole("fumbleRecoverer") !== end.possession && !has("interceptor")) bad.push(`${tag}: recoverer is not on the team that ends with the ball`);
  if (has("interceptor") && has("fumbleRecoverer") && end !== undefined && sideOfRole("fumbleRecoverer") !== end.possession) bad.push(`${tag}: interception fumbled back, recoverer on the wrong side`);
  // Return units on the field for kickoffs and punts (B3): the designed unit, filled.
  const unit = cfg.receivingUnit[play.kind];
  if (unit !== undefined && KICKS.has(play.kind)) {
    const want = cfg.returnUnits[unit] ?? {};
    for (const [pos, n] of Object.entries(want)) if ((of.defense[pos as Position]?.length ?? 0) !== n) bad.push(`${tag}: ${unit} has ${of.defense[pos as Position]?.length ?? 0} ${pos}, wants ${n}`);
  }
  // Designed fallbacks: a run from Empty credits the QB when no RB is on the field; a pass from Heavy targets a TE or RB.
  if ((play.kind === "run") && (of.offense.RB?.length ?? 0) === 0 && has("ballCarrier") && byId.get(parts.ballCarrier ?? "")?.position !== "QB") bad.push(`${tag}: run with no RB on the field not credited to the QB`);
  if (play.kind === "pass" && (of.offense.WR?.length ?? 0) === 0 && has("target") && !["TE", "RB"].includes(byId.get(parts.target ?? "")?.position ?? "")) bad.push(`${tag}: pass with no WR on the field targets a ${byId.get(parts.target ?? "")?.position}`);
  if (play.kind === "noPlay" || play.kind === "kneel" || play.kind === "spike") return bad;
  // Every role entry is also in the trace with the player's number and name (spec D: TRACE_FIELDS).
  for (const r of roles) {
    const id = (parts as Record<string, string>)[r] as string;
    const e = d.trace.find((x) => x.factor === r);
    const p = byId.get(id);
    if (e === undefined || e["id"] !== id || e["number"] !== p?.number || e["name"] !== p?.name) bad.push(`${tag}: ${r} not in the trace with id, number and name`);
  }
  return bad;
}

describe("B1, B3, B4 over the step 4 C1 contract states", () => {
  const states = contractStates(100_000);
  const league = leagueFromSeed(data, 99).teams;
  const players = { home: league[0]?.pool as TeamPool, away: league[1]?.pool as TeamPool };
  const resolve = createEngine(data.engine);
  const rng = Rng.fromSeed(4321);
  const cases: Case[] = [];
  for (let i = 0; i < states.length; i++) {
    const s = states[i] as GameState;
    const calls = callsFor(s, rules, caller, rng, i % 2 === 1);
    const play = resolve(s, calls.offense, calls.defense, players, rng);
    const offense = s.possession;
    cases.push({ play, offensePool: players[offense], defensePool: players[offense === "home" ? "away" : "home"] });
  }

  it("every PlayResult has participants and onField, every id on the field for its side, every role matching the result", () => {
    const bad = new Map<string, number>();
    for (const c of cases) for (const b of problems(c)) bad.set(b, (bad.get(b) ?? 0) + 1);
    expect([...bad].slice(0, 30)).toEqual([]);
  });

  it("the states reach every role and the edge cases the spec lists", () => {
    const seen = new Set<string>();
    for (const c of cases) {
      const p = c.play;
      const parts = det(p).participants ?? {};
      for (const k of Object.keys(parts)) seen.add(`role:${k}`);
      if (p.kind === "pass" && p.defensePossessedDuringPlay === true && p.turnover === undefined) seen.add("intFumbledBack");
      if (p.kind === "sack" && p.turnover === "fumble") seen.add("stripSack");
      if (p.kind === "punt" && p.fairCatch === true) seen.add("puntFairCatch");
      if (p.kind === "kickoff" && p.outcome === "touchbackEndZone") seen.add("kickoffTouchback");
      if (p.kind === "onsideKick" && p.outcome === "inPlay") seen.add(`onside:${p.end?.possession}`);
      if (p.kind === "noPlay") seen.add("noPlay");
      if ((p.fouls ?? []).length > 1) seen.add("twoFouls");
      if (p.kind === "run" && (det(p).onField?.offense.RB?.length ?? 0) === 0) seen.add("runNoRB");
      if (p.kind === "pass" && (det(p).onField?.offense.WR?.length ?? 0) === 0) seen.add("passNoWR");
      if ((p.fouls ?? []).some((f) => cfg.noTarget.includes(f.penalty))) seen.add("grounding");
    }
    for (const r of PARTICIPANT_ROLES) expect(seen, r).toContain(`role:${r}`);
    expect(seen).toContain("role:foulers");
    for (const k of ["intFumbledBack", "stripSack", "puntFairCatch", "kickoffTouchback", "onside:offense", "onside:defense", "noPlay", "twoFouls", "runNoRB", "passNoWR", "grounding"]) expect(seen, k).toContain(k);
  });
});

describe("B3: return units fill from the players the generator makes", () => {
  it("every team in the 10 calibration leagues has enough players at each position for each designed return unit", () => {
    const lg = data.config.league;
    const seeds = runSeeds(lg.calibrationSeed, lg.leagues, lg.gamesPerLeague).leagueSeeds;
    for (const s of seeds) {
      for (const t of leagueFromSeed(data, s).teams) {
        for (const [unit, slots] of Object.entries(cfg.returnUnits)) {
          let total = 0;
          for (const [pos, n] of Object.entries(slots)) {
            total += n as number;
            expect(t.pool.players.filter((p) => p.position === pos).length, `${t.name} ${unit} ${pos}`).toBeGreaterThanOrEqual(n as number);
          }
          expect(total, unit).toBe(11);
        }
      }
    }
  });
});

// ------------------------------------------------------------------ B5: tilts go the documented way

/** Share of `role` credits to the player `id` over plays of class `cls`, from a fixed state and call. */
function creditShare(resolve: ResolvePlay, home: TeamPool, away: TeamPool, call: { call: string; formation: string }, defense: string, role: string, classes: readonly string[], id: string, n: number): { share: number; of: number } {
  const rng = Rng.fromSeed(2468);
  let hits = 0;
  let of = 0;
  for (let i = 0; i < n; i++) {
    const p = resolve(scrimmageState(40, 1 + (i % 3), 10), call, defense, { home, away }, rng);
    const d = det(p);
    if (d.class === undefined || !classes.includes(d.class) || (p.fouls ?? []).length > 0) continue;
    const who = (d.participants as Record<string, string> | undefined)?.[role];
    if (who === undefined) continue;
    of++;
    if (who === id) hits++;
  }
  return { share: hits / Math.max(of, 1), of };
}

describe("B5: rating tilts (fixed teams, one player's rating moved, same seed)", () => {
  const resolve = createEngine(data.engine);
  const base = flatTeam(data.engine, "H", 65);
  const def = flatTeam(data.engine, "A", 65);
  const N = 20_000;
  const cases = [
    { what: "WR share of 20+ completions rises with Speed", side: "offense", position: "WR", rating: "speed", role: "target", classes: ["c20"], call: { call: "deepPass", formation: "shotgun" }, dir: 1 },
    { what: "WR share of incompletions falls with Hands", side: "offense", position: "WR", rating: "hands", role: "target", classes: ["inc"], call: { call: "intermediatePass", formation: "shotgun" }, dir: -1 },
    { what: "RB share of carries rises with Speed", side: "offense", position: "RB", rating: "speed", role: "ballCarrier", classes: ["loss", "r1_3", "r4_9", "r10_19", "r20"], call: { call: "outsideRun", formation: "shotgun" }, dir: 1 },
    { what: "DL share of sacks rises with Pass Rush", side: "defense", position: "DL", rating: "passRush", role: "sacker", classes: ["sack"], call: { call: "deepPass", formation: "shotgun" }, dir: 1 },
    { what: "CB share of interceptions rises with Ball Skills", side: "defense", position: "CB", rating: "ballSkills", role: "interceptor", classes: ["int"], call: { call: "deepPass", formation: "shotgun" }, dir: 1 },
  ] as const;
  it.each(cases)("$what", (c) => {
    const team = c.side === "offense" ? base : def;
    const id = team.players.find((p) => p.position === c.position)?.id as string;
    const at = (v: number): { share: number; of: number } => {
      const t = withRating(team, c.position, c.rating, v);
      return c.side === "offense" ? creditShare(resolve, t, def, c.call, "nickelCover3", c.role, c.classes, id, N) : creditShare(resolve, base, t, c.call, "nickelCover3", c.role, c.classes, id, N);
    };
    const lo = at(40);
    const hi = at(90);
    expect(lo.of).toBeGreaterThan(150);
    expect(hi.of).toBeGreaterThan(150);
    // Two-proportion z-score: the documented direction, clearly.
    const p = (lo.share * lo.of + hi.share * hi.of) / (lo.of + hi.of);
    const z = (hi.share - lo.share) / Math.sqrt(p * (1 - p) * (1 / lo.of + 1 / hi.of) || 1);
    expect(c.dir * z, `share at 40 ${lo.share.toFixed(3)} (${lo.of}), at 90 ${hi.share.toFixed(3)} (${hi.of})`).toBeGreaterThan(4);
  });
});

describe("B5: tilts over in-sample games (first 300 games of the CI slice)", () => {
  it("each documented relation goes the documented way", () => {
    const games = sliceGames(300).map(({ seed, setup }) => ({ record: playGame(setup, kit, Rng.fromSeed(seed)), pools: { home: setup.home.pool, away: setup.away.pool } }));
    checkTiltGaps(tiltGaps(games));
  });
});

// ------------------------------------------------------------------ B7: determinism, and the credit stream

const stripM2 = (p: PlayResult): unknown => {
  const d = { ...(p.detail as Record<string, unknown>) };
  delete d["participants"];
  delete d["onField"];
  delete d["headline"];
  d["trace"] = (d["trace"] as { factor: string }[]).filter((e) => ![...PARTICIPANT_ROLES, "fouler", "standout"].includes(e.factor));
  return { ...p, detail: d };
};

describe("B7: crediting never reads, advances or perturbs the outcome stream", () => {
  const states = contractStates(20_000);
  const league = leagueFromSeed(data, 99).teams;
  const players = { home: league[2]?.pool as TeamPool, away: league[3]?.pool as TeamPool };
  const normal = createEngine(data.engine);
  const swapped = createEngine(data.engine, { creditStream: () => Rng.fromSeed(97531) });

  it("per play: the same outcome and the same outcome-stream state after the play, with the credit stream swapped", () => {
    const rngA = Rng.fromSeed(11);
    const rngB = Rng.fromSeed(11);
    const callRng = Rng.fromSeed(12);
    let differentCredit = 0;
    for (let i = 0; i < states.length; i++) {
      const s = states[i] as GameState;
      const calls = callsFor(s, rules, caller, callRng, i % 2 === 1);
      const a = normal(s, calls.offense, calls.defense, players, rngA);
      const b = swapped(s, calls.offense, calls.defense, players, rngB);
      expect(rngB.getState()).toEqual(rngA.getState());
      expect(stripM2(b)).toEqual(stripM2(a));
      if (JSON.stringify(det(a).participants) !== JSON.stringify(det(b).participants)) differentCredit++;
    }
    // The swap really changed who was credited (else the check above proves nothing).
    expect(differentCredit).toBeGreaterThan(states.length / 10);
  });

  it("creditStream reads the outcome stream's state and never advances it", () => {
    const r = Rng.fromSeed(5);
    r.nextUint32();
    const before = r.getState();
    const c = creditStream(r);
    c.nextUint32();
    expect(r.getState()).toEqual(before);
  });

  it("control: a credit stream that draws from the outcome stream does change outcomes (the check can fail)", () => {
    const leaky = createEngine(data.engine, { creditStream: (rng) => rng });
    const rngA = Rng.fromSeed(11);
    const rngB = Rng.fromSeed(11);
    const callRng = Rng.fromSeed(12);
    let diff = 0;
    for (let i = 0; i < 2000; i++) {
      const s = states[i] as GameState;
      const calls = callsFor(s, rules, caller, callRng, i % 2 === 1);
      const a = normal(s, calls.offense, calls.defense, players, rngA);
      const b = leaky(s, calls.offense, calls.defense, players, rngB);
      if (JSON.stringify(stripM2(a)) !== JSON.stringify(stripM2(b))) diff++;
    }
    expect(diff).toBeGreaterThan(100);
  });

  it("same seed, same participants (first 50 CI slice games, played twice)", () => {
    for (const { seed, setup } of sliceGames(50)) {
      const a = playGame(setup, kit, Rng.fromSeed(seed));
      const b = playGame(setup, kit, Rng.fromSeed(seed));
      const parts = (r: GameRecord): unknown => r.events.flatMap((e) => (e.t === "play" ? [[det(e.play).participants, det(e.play).onField]] : []));
      expect(parts(b)).toEqual(parts(a));
    }
  });

  it("games with a swapped credit stream keep every outcome and change participants (first 50 CI slice games)", () => {
    const sw: GameKit = { data, resolve: swapped };
    let changed = 0;
    for (const { seed, setup } of sliceGames(50)) {
      const a = playGame(setup, kit, Rng.fromSeed(seed));
      const b = playGame(setup, sw, Rng.fromSeed(seed));
      const plays = (r: GameRecord): PlayResult[] => r.events.flatMap((e) => (e.t === "play" ? [e.play] : []));
      expect(plays(b).map(stripM2)).toEqual(plays(a).map(stripM2));
      expect(b.final).toEqual(a.final);
      if (JSON.stringify(plays(a).map((p) => det(p).participants)) !== JSON.stringify(plays(b).map((p) => det(p).participants))) changed++;
    }
    expect(changed).toBe(50);
  });
});

void teams;
