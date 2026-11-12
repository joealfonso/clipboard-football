// A test-side generator of legal inputs to the game state machine, driven by a seeded Rng.
// It stands in for step 4's play engine and step 5's callers: outcomes here are random and
// unbalanced on purpose, to reach odd states. Step 5's soak test reuses it.

import type { BallEnd, Foul, PlayResult, RuleSet } from "../../../shared/src/types";
import { Rng } from "../../src/rng";
import { applyPlay, callTimeout, newGame, penaltyOptions, runPreSnap, startOvertime, type PlayChoices } from "../../src/game/machine";
import type { GameState, GameType, Team } from "../../src/game/types";

export type GameInput =
  | { readonly t: "play"; readonly play: PlayResult; readonly choices?: PlayChoices }
  | { readonly t: "runoff"; readonly seconds: number }
  | { readonly t: "timeout"; readonly team: Team }
  | { readonly t: "overtime" };

export interface GameStart {
  readonly gameType: GameType;
  readonly seed: number;
  readonly rulesHash: string;
}

export interface RandomGame {
  readonly start: GameStart;
  readonly inputs: readonly GameInput[];
  /** states[0] is the new game; states[i + 1] follows inputs[i]. */
  readonly states: readonly GameState[];
}

const MAX_INPUTS = 20000;

/** Applies one input. `gameRng` is the machine's own Rng, used only by the coin tosses. */
export function applyInput(s: GameState, rules: RuleSet, input: GameInput, gameRng: Rng): GameState {
  switch (input.t) {
    case "play":
      return applyPlay(s, rules, input.play, input.choices);
    case "runoff":
      return runPreSnap(s, rules, input.seconds);
    case "timeout":
      return callTimeout(s, rules, input.team);
    case "overtime":
      return startOvertime(s, rules, gameRng);
  }
}

/** Replays recorded inputs from the start. Same start and inputs give deep-equal states. */
export function replay(rules: RuleSet, start: GameStart, inputs: readonly GameInput[], from?: { state: GameState; index: number; rngState: readonly [number, number, number, number] }): GameState[] {
  const gameRng = from === undefined ? Rng.fromSeed(start.seed) : Rng.fromState(from.rngState);
  let s = from?.state ?? newGame(rules, start, gameRng);
  const states = [s];
  for (const input of inputs.slice(from?.index ?? 0)) {
    s = applyInput(s, rules, input, gameRng);
    states.push(s);
  }
  return states;
}

class Gen {
  constructor(private readonly rng: Rng) {}
  f(): number {
    return this.rng.nextFloat();
  }
  chance(p: number): boolean {
    return this.f() < p;
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.f() * (hi - lo + 1));
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.f() * xs.length)] as T;
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function kickoffPlay(g: Gen, s: GameState): PlayResult {
  if (g.chance(0.04)) {
    if (g.chance(0.1)) return { kind: "onsideKick", seconds: 0, outcome: "outOfBounds" };
    const kickers = g.chance(0.2);
    const spot = clamp(s.spot + g.int(10, 16), 1, 99);
    return { kind: "onsideKick", seconds: g.int(2, 4), outcome: "inPlay", end: { spot, possession: kickers ? "offense" : "defense" } };
  }
  const r = g.f();
  if (r < 0.3) return { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" };
  if (r < 0.34) return { kind: "kickoff", seconds: 0, outcome: "touchbackLandingZone" };
  if (r < 0.36) return { kind: "kickoff", seconds: 0, outcome: g.pick(["short", "outOfBounds"] as const) };
  if (r < 0.38) return { kind: "kickoff", seconds: 0, outcome: "fairCatch", end: { spot: g.int(80, 99), possession: "defense" } };
  let end: BallEnd;
  const x = g.f();
  if (x < 0.02) end = { spot: -1, possession: "defense" };
  else if (x < 0.03) end = { spot: 101, possession: "defense", impetus: "defense" };
  else if (x < 0.045) end = { spot: g.int(80, 99), possession: "offense" };
  else end = { spot: clamp(100 - g.int(10, 50), 1, 99), possession: "defense" };
  const fouls: Foul[] = [];
  const foulDraw = g.f();
  if (foulDraw < 0.03) fouls.push({ penalty: "kickoffIllegalFormation", by: "offense" });
  else if (foulDraw < 0.06 && end.possession === "defense" && end.spot > 0 && end.spot < 100) {
    fouls.push({ penalty: "returnTeamIllegalBlock", by: "defense", spot: clamp(end.spot + g.int(1, 10), 1, 99) });
  }
  return { kind: "kickoff", seconds: g.int(4, 8), outcome: "inPlay", end, fouls };
}

function tryPlay(g: Gen, s: GameState): PlayResult {
  const tryFouls: readonly Foul[] = [
    { penalty: "defensiveOffside", by: "defense" },
    { penalty: "offensiveHolding", by: "offense" },
  ];
  const fouls: Foul[] = g.chance(0.04) ? [g.pick(tryFouls)] : [];
  if (g.chance(0.12)) {
    const x = g.f();
    if (x < 0.48) return { kind: "twoPoint", seconds: g.int(3, 6), end: { spot: 101, possession: "offense" }, fouls };
    if (x < 0.52) return { kind: "twoPoint", seconds: g.int(3, 6), end: { spot: -1, possession: "defense" }, fouls };
    return { kind: "twoPoint", seconds: g.int(3, 6), incomplete: true, end: { spot: s.spot, possession: "offense" }, fouls };
  }
  if (g.chance(0.94)) return { kind: "extraPoint", seconds: 0, good: true, fouls };
  return { kind: "extraPoint", seconds: 0, good: false, fouls };
}

function fourthDownKick(g: Gen, s: GameState): PlayResult | null {
  if (s.down < 4 || g.chance(0.12)) return null;
  const los = s.spot;
  if (los >= 60) {
    const kickSpot = Math.max(1, los - 7);
    const yards = 100 - kickSpot + 10;
    if (g.chance(0.02)) return { kind: "fieldGoal", seconds: g.int(2, 6), good: false, kickSpot, end: { spot: kickSpot - 3, possession: g.chance(0.5) ? "defense" : "offense" } };
    return { kind: "fieldGoal", seconds: g.int(2, 5), good: g.f() < clamp(1.4 - yards / 60, 0.2, 0.98), kickSpot };
  }
  const fouls: Foul[] = g.chance(0.03) ? [{ penalty: "offensiveHolding", by: "offense" }] : [];
  if (g.chance(0.015)) return { kind: "punt", seconds: g.int(2, 6), crossedLine: false, touchedByReceivers: false, end: { spot: Math.max(-2, los - 8), possession: g.pick(["offense", "defense"] as const) } };
  const land = los + g.int(30, 55);
  if (land >= 100) return { kind: "punt", seconds: g.int(4, 6), crossedLine: true, touchedByReceivers: false, end: { spot: 101, possession: "defense" }, fouls };
  if (g.chance(0.02)) return { kind: "punt", seconds: g.int(4, 6), crossedLine: true, touchedByReceivers: true, end: { spot: land, possession: "offense" } };
  if (g.chance(0.3)) return { kind: "punt", seconds: g.int(4, 6), crossedLine: true, touchedByReceivers: false, fairCatch: true, end: { spot: land, possession: "defense" }, fouls };
  const ret = clamp(land - g.int(0, 20), -1, 99);
  const returnFoul: Foul[] = fouls.length === 0 && ret > 0 && g.chance(0.04) ? [{ penalty: "returnTeamIllegalBlock", by: "defense", spot: clamp(ret + 3, 1, 99) }] : fouls;
  return { kind: "punt", seconds: g.int(5, 10), crossedLine: true, touchedByReceivers: false, end: { spot: ret, possession: "defense" }, fouls: ret <= 0 ? [] : returnFoul };
}

function scrimmagePlay(g: Gen, s: GameState): PlayResult {
  const kick = fourthDownKick(g, s);
  if (kick !== null) return kick;
  const los = s.spot;
  if (g.chance(0.04)) {
    const pre = g.pick([
      { penalty: "falseStart", by: "offense" },
      { penalty: "delayOfGame", by: "offense" },
      { penalty: "encroachment", by: "defense" },
    ] as const);
    return { kind: "noPlay", seconds: 0, fouls: [pre] };
  }
  if (s.clock < 40 && g.chance(0.05)) return { kind: "kneel", seconds: g.int(1, 3), end: { spot: Math.max(los - 1, 1), possession: "offense" } };
  if (s.clock < 60 && g.chance(0.05)) return { kind: "spike", seconds: 1, incomplete: true, end: { spot: los, possession: "offense" } };
  const pass = g.chance(0.55);
  const seconds = g.int(3, 8);
  const fouls: Foul[] = [];
  if (pass && g.chance(0.35)) {
    if (g.chance(0.05)) fouls.push({ penalty: "intentionalGrounding", by: "offense", spot: los - g.int(2, 12) });
    else if (g.chance(0.06)) fouls.push({ penalty: "defensivePassInterference", by: "defense", spot: Math.min(101, los + g.int(5, 40)) });
    else if (g.chance(0.03)) fouls.push({ penalty: "roughingThePasser", by: "defense" });
    return { kind: "pass", seconds, incomplete: true, end: { spot: los, possession: "offense" }, fouls };
  }
  if (pass && g.chance(0.04)) {
    const x = g.f();
    const spot = x < 0.1 ? -1 : x < 0.2 ? 101 : clamp(los + g.int(5, 40), 1, 99);
    return { kind: "pass", seconds, turnover: "interception", end: { spot, possession: "defense" } };
  }
  if (g.chance(0.015)) return { kind: "run", seconds, turnover: "fumble", end: { spot: clamp(los + g.int(-3, 8), -1, 99), possession: "defense" } };
  let gain = g.chance(0.05) ? g.int(15, 70) : g.int(-4, 12);
  if (!pass && g.chance(0.02)) gain = -los - g.int(0, 1);
  const end = Math.max(-1, Math.min(los + gain, 101));
  const spot = end >= 100 ? 101 : end <= 0 ? 0 : end;
  const inField = spot > 0 && spot < 100;
  const outOfBounds = inField && g.chance(0.18);
  const r = g.f();
  if (inField && r < 0.03) fouls.push({ penalty: "offensiveHolding", by: "offense" });
  else if (inField && r < 0.05) fouls.push({ penalty: "defensiveHolding", by: "defense" });
  else if (inField && r < 0.06) fouls.push({ penalty: "defensiveOffside", by: "defense" });
  else if (inField && r < 0.07) fouls.push({ penalty: "unnecessaryRoughnessDeadBall", by: g.pick(["offense", "defense"] as const) });
  else if (inField && r < 0.075) fouls.push({ penalty: "offensiveHolding", by: "offense" }, { penalty: "defensiveHolding", by: "defense" });
  const kind = pass ? (g.chance(0.1) ? "sack" : "pass") : g.chance(0.05) ? "scramble" : "run";
  return { kind, seconds, outOfBounds, end: { spot, possession: "offense" }, fouls };
}

function nextInput(g: Gen, s: GameState, rules: RuleSet, ranOff: boolean): GameInput {
  if (s.phase === "overtimeToss") return { t: "overtime" };
  if (s.phase === "scrimmage" && !ranOff && s.clockRunning && g.chance(0.6)) {
    return { t: "runoff", seconds: g.int(0, s.playClock) };
  }
  if (s.phase !== "final" && g.chance(0.03)) {
    const team = g.pick(["home", "away"] as const);
    if (s.timeouts[team] > 0 && s.timeoutsThisDeadBall[team] < rules.timeouts.perTeamPerDeadBall) return { t: "timeout", team };
  }
  const play = s.phase === "kickoff" ? kickoffPlay(g, s) : s.phase === "try" ? tryPlay(g, s) : scrimmagePlay(g, s);
  let choices: PlayChoices = {};
  if ((play.fouls ?? []).length > 0 && g.chance(0.3)) {
    const options = penaltyOptions(s, rules, play);
    if (options.length > 0) choices = { penalty: g.pick(options) };
  }
  // The machine rejects a run-off timeout the offense cannot take, so only ask for one it can.
  const offense = s.possession;
  const canSpend = s.timeouts[offense] > 0 && s.timeoutsThisDeadBall[offense] < rules.timeouts.perTeamPerDeadBall;
  if (canSpend && g.chance(0.3)) choices = { ...choices, runoffTimeout: true };
  if (g.chance(0.3)) choices = { ...choices, clockOnSnap: true };
  return { t: "play", play, choices };
}

/** Plays one complete game. Throws if it does not reach `final` within MAX_INPUTS inputs. */
export function randomGame(rules: RuleSet, start: GameStart, inputSeed: number): RandomGame {
  const g = new Gen(Rng.fromSeed(inputSeed));
  const gameRng = Rng.fromSeed(start.seed);
  let s = newGame(rules, start, gameRng);
  const states = [s];
  const inputs: GameInput[] = [];
  let ranOff = false;
  while (s.phase !== "final") {
    if (inputs.length >= MAX_INPUTS) throw new Error(`game ${start.seed} did not end in ${MAX_INPUTS} inputs`);
    const input = nextInput(g, s, rules, ranOff);
    ranOff = input.t === "runoff" ? true : input.t === "play" ? false : ranOff;
    s = applyInput(s, rules, input, gameRng);
    inputs.push(input);
    states.push(s);
  }
  return { start, inputs, states };
}
