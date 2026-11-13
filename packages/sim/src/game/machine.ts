// The game state machine. Each input takes a state and returns the next one, or throws a
// GameRuleError naming the reason. Inputs are never changed. The only randomness is the coin
// toss, drawn from the Rng passed to newGame and startOvertime.

import type { PlayResult, RuleSet } from "../../../shared/src/types";
import type { Rng } from "../rng";
import { draftOf, type Draft, type Events } from "./draft";
import { declineIsBetter, enforce, penaltyOptions, validateFouls, type Enforced, type PenaltyOption } from "./enforce";
import { reject, GameRuleError } from "./errors";
import { other } from "./frame";
import { transitionViolations } from "./invariants";
import { endsHalf, hasTwoMinuteWarning, inSnapStartWindow, overtimeFormat, timingPeriod } from "./periods";
import { periodEndCheck, settle } from "./progress";
import { phaseOfPlay, resolveRaw, sideTeam } from "./resolve";
import type { GameState, GameType, Team, Toss, TossChoice } from "./types";

export interface NewGameOptions {
  readonly gameType: GameType;
  readonly seed: number;
  /** sha256 of the rule set file's bytes, from the loader. */
  readonly rulesHash: string;
  /** The toss winner's choice. Designed default: defer. */
  readonly tossChoice?: TossChoice;
}

export interface PlayChoices {
  /** One of penaltyOptions(...). Absent: the designed default policy decides. */
  readonly penalty?: PenaltyOption;
  /** The offense uses a timeout instead of taking a ten-second run-off. Designed default: no. */
  readonly runoffTimeout?: boolean;
  /**
   * After a defensive foul that conserves time after the warning, the offense has the clock
   * start on the snap instead of the ready signal (Rule 4-7-1, Item 2). Designed default: no.
   */
  readonly clockOnSnap?: boolean;
}

/** One draw: the low bit of the next uint32 names the winner. */
function drawToss(rng: Rng): Team {
  return (rng.nextUint32() & 1) === 1 ? "home" : "away";
}

/** Rule 4-2-2: who receives now, and who receives the kickoff that opens the next half. */
function tossOutcome(winner: Team, choice: TossChoice): { receiver: Team; toss: Toss } {
  const loser = other(winner);
  // Designed default policy: whichever captain has the choice of kicking or receiving receives.
  if (choice === "receive") return { receiver: winner, toss: { winner, choice, secondHalfReceiver: loser } };
  if (choice === "kick") return { receiver: loser, toss: { winner, choice, secondHalfReceiver: loser } };
  return { receiver: loser, toss: { winner, choice, secondHalfReceiver: winner } };
}

function checked(prev: GameState, next: Draft, rules: RuleSet): GameState {
  const v = transitionViolations(prev, next, rules);
  if (v.length > 0) throw new GameRuleError("invariantViolation", v.join("; "));
  return next;
}

function live(s: GameState): void {
  if (s.phase === "final") reject("gameOver", "the game is over");
}

export function newGame(rules: RuleSet, options: NewGameOptions, rng: Rng): GameState {
  const { receiver, toss } = tossOutcome(drawToss(rng), options.tossChoice ?? "defer");
  const t = rules.timeouts.perHalf;
  return {
    rules: { id: rules.id, hash: options.rulesHash },
    seed: options.seed,
    gameType: options.gameType,
    period: 1,
    clock: rules.game.periodSeconds,
    clockRunning: false,
    playClock: rules.clock.playClockAfterStoppage,
    phase: "kickoff",
    possession: other(receiver),
    spot: rules.kickoff.spot,
    down: 0,
    distance: 0,
    goalToGo: false,
    trySpots: null,
    safetyKick: false,
    score: { home: 0, away: 0 },
    timeouts: { home: t, away: t },
    timeoutsThisDeadBall: { home: 0, away: 0 },
    twoMinuteWarningDone: false,
    untimedDown: false,
    toss,
    overtime: null,
    playCount: 0,
    result: null,
  };
}

/** The coin toss that opens overtime (or a new overtime cycle). Designed default: receive. */
export function startOvertime(s: GameState, rules: RuleSet, rng: Rng, choice?: TossChoice): GameState {
  live(s);
  if (s.phase !== "overtimeToss") reject("wrongPhase", `no overtime toss in phase ${s.phase}`);
  const { receiver, toss } = tossOutcome(drawToss(rng), choice ?? "receive");
  const d = draftOf(s);
  const fmt = overtimeFormat(s.gameType, rules);
  d.period = s.period + 1;
  d.clock = fmt.periodSeconds;
  d.clockRunning = false;
  d.playClock = rules.clock.playClockAfterStoppage;
  d.twoMinuteWarningDone = false;
  d.untimedDown = false;
  d.timeouts = { home: fmt.timeoutsPerHalf, away: fmt.timeoutsPerHalf };
  d.timeoutsThisDeadBall = { home: 0, away: 0 };
  d.phase = "kickoff";
  d.possession = other(receiver);
  d.spot = rules.kickoff.spot;
  d.safetyKick = false;
  d.overtime =
    s.overtime === null
      ? { firstTeam: receiver, secondTeam: other(receiver), secondTeamPossessed: false, suddenDeath: false, toss }
      : { ...s.overtime, toss };
  return checked(s, d, rules);
}

/** Two-minute warning reached while the clock runs from `from` down to `to`. */
function crossesWarning(s: GameState, from: number, to: number, rules: RuleSet): boolean {
  const w = rules.clock.twoMinuteWarningSeconds;
  return hasTwoMinuteWarning(s.period, s.gameType, rules) && !s.twoMinuteWarningDone && from > w && to <= w;
}

/** Seconds the offense lets run before the snap. */
export function runPreSnap(s: GameState, rules: RuleSet, seconds: number): GameState {
  live(s);
  if (s.phase !== "scrimmage") reject("wrongPhase", `no pre-snap run-off in phase ${s.phase}`);
  if (!Number.isInteger(seconds) || seconds < 0) reject("badPlay", `run-off must be a whole number >= 0, got ${seconds}`);
  if (seconds > s.playClock) reject("runoffTooLong", `${seconds} s is more than the ${s.playClock} s on the play clock`);
  const d = draftOf(s);
  d.playClock = s.playClock - seconds;
  if (s.clockRunning) {
    const to = Math.max(0, s.clock - seconds);
    if (crossesWarning(s, s.clock, to, rules)) {
      d.clock = rules.clock.twoMinuteWarningSeconds;
      d.clockRunning = false;
      d.twoMinuteWarningDone = true;
      d.playClock = rules.clock.playClockAfterStoppage;
    } else {
      d.clock = to;
      if (to === 0) {
        d.clockRunning = false;
        periodEndCheck(d, rules);
      }
    }
  }
  return checked(s, d, rules);
}

export function callTimeout(s: GameState, rules: RuleSet, team: Team): GameState {
  live(s);
  if (s.phase === "overtimeToss") reject("wrongPhase", "no timeouts before the overtime toss");
  if (s.timeouts[team] <= 0) reject("noTimeouts", `${team} has no timeouts left`);
  if (s.timeoutsThisDeadBall[team] >= rules.timeouts.perTeamPerDeadBall) {
    reject("timeoutNotAllowed", `${team} already took a timeout in this dead-ball period`);
  }
  const d = draftOf(s);
  d.timeouts = { ...s.timeouts, [team]: s.timeouts[team] - 1 };
  d.timeoutsThisDeadBall = { ...s.timeoutsThisDeadBall, [team]: s.timeoutsThisDeadBall[team] + 1 };
  d.clockRunning = false;
  d.playClock = rules.clock.playClockAfterStoppage;
  return checked(s, d, rules);
}

export { penaltyOptions };

function sameOption(a: PenaltyOption, b: PenaltyOption): boolean {
  return a.kind === b.kind && (a.kind !== "accept" || (b.kind === "accept" && a.foul === b.foul));
}

/** The designed default policy's pick among the legal options (null when the play has no foul). */
function defaultOption(s: GameState, rules: RuleSet, play: PlayResult, raw: ReturnType<typeof resolveRaw>, options: readonly PenaltyOption[]): { e: Enforced; option: PenaltyOption | null } {
  if (options.length === 0) return { e: enforce(s, rules, play, raw, { kind: "decline" }), option: null };
  const first = options[0] as PenaltyOption;
  if (first.kind === "offset") return { e: enforce(s, rules, play, raw, first), option: first };
  const fouler = (play.fouls ?? [])[0]?.by ?? "offense";
  const offended = other(sideTeam(fouler, s.possession));
  let best: { e: Enforced; option: PenaltyOption } | null = null;
  for (const o of options) {
    if (o.kind !== "accept") continue;
    const e = enforce(s, rules, play, raw, o);
    if (best === null || declineIsBetter(offended, e.r, best.e.r)) best = { e, option: o };
  }
  const decline: PenaltyOption = { kind: "decline" };
  const declined = options.some((o) => o.kind === "decline") ? enforce(s, rules, play, raw, decline) : null;
  if (best === null) return { e: declined as Enforced, option: decline };
  if (declined !== null && declineIsBetter(offended, declined.r, best.e.r)) return { e: declined, option: decline };
  return best;
}

function choose(s: GameState, rules: RuleSet, play: PlayResult, raw: ReturnType<typeof resolveRaw>, choices: PlayChoices): Enforced {
  const options = penaltyOptions(s, rules, play);
  if (choices.penalty !== undefined) {
    const picked = choices.penalty;
    if (!options.some((o) => sameOption(o, picked))) reject("badChoice", `"${picked.kind}" is not a legal penalty choice here`);
    return enforce(s, rules, play, raw, picked);
  }
  return defaultOption(s, rules, play, raw, options).e;
}

/**
 * The option the designed default penalty policy picks for this play in this state (null when
 * the play carries no foul). Passing it back as `choices.penalty` enforces exactly what the
 * default would; the step 5 loop does that so the event log can say "accepted" or "declined".
 */
export function defaultPenaltyChoice(s: GameState, rules: RuleSet, play: PlayResult): PenaltyOption | null {
  live(s);
  const options = penaltyOptions(s, rules, play);
  if (options.length === 0) return null;
  return defaultOption(s, rules, play, resolveRaw(s, rules, play), options).option;
}

function afterWarning(s: GameState, rules: RuleSet): boolean {
  return hasTwoMinuteWarning(s.period, s.gameType, rules) && (s.twoMinuteWarningDone || s.clock <= rules.clock.twoMinuteWarningSeconds);
}

/** Rule 4-7-1, Item 2: a defensive foul that stops a running clock between downs after the warning. */
function defenseConservesTime(s: GameState, play: PlayResult, e: Enforced, rules: RuleSet): boolean {
  return play.kind === "noPlay" && e.accepted?.foul.by === "defense" && s.clockRunning && afterWarning(s, rules);
}

/**
 * Whether the game clock restarts on the ready signal after this down (Rule 4-3, 4-4). After
 * a foul, accepted or declined, the clock starts as if the foul had not occurred, except in
 * the snap-start windows (Rule 4-3-2 (e)).
 */
function clockRuns(s: GameState, d: Draft, ev: Events, play: PlayResult, e: Enforced, rules: RuleSet): boolean {
  if (d.phase !== "scrimmage" || d.clock === 0) return false;
  const window = inSnapStartWindow(d.period, d.clock, d.gameType, rules);
  const fouls = play.fouls ?? [];
  if (fouls.length > 0) {
    if (window) return false;
    if (play.kind === "noPlay") {
      const offensive = fouls.some((f) => f.by === "offense");
      const stops = rules.clock.offensePreSnapFoulStopsClockInPeriods.includes(timingPeriod(d.period, d.gameType, rules));
      return s.clockRunning && !(offensive && stops);
    }
  }
  if (ev.stopsClock) return false;
  if (ev.fumbleOutOfBounds) return true;
  if (ev.outOfBounds) return !window;
  return true;
}

/** Rule 4-7-1: an offensive foul that stops the clock after the two-minute warning. */
function runoffApplies(s: GameState, d: Draft, e: Enforced, rules: RuleSet): boolean {
  if (e.accepted === null || !e.accepted.rule.tenSecondRunoff || e.accepted.foul.by !== "offense") return false;
  if (d.phase !== "scrimmage") return false;
  const timeIn = e.accepted.rule.timing === "preSnap" ? s.clockRunning : true;
  return afterWarning(s, rules) && timeIn;
}

export function applyPlay(s: GameState, rules: RuleSet, play: PlayResult, choices: PlayChoices = {}): GameState {
  live(s);
  if (s.phase === "overtimeToss") reject("wrongPhase", "the overtime coin toss comes first");
  const wants = phaseOfPlay(play);
  if (wants === "any" ? s.phase === "kickoff" : wants !== s.phase) reject("wrongPhase", `a ${play.kind} cannot be run in phase ${s.phase}`);
  validateFouls(s, rules, play);
  const raw = resolveRaw(s, rules, play);
  const e = choose(s, rules, play, raw, choices);
  const d = e.r.d;
  const ev = e.r.ev;

  const untimed = play.kind === "noPlay" || (s.phase === "try" && rules.try.untimed);
  d.clock = untimed ? s.clock : Math.max(0, s.clock - play.seconds);
  // A pre-snap foul is not a down, so an untimed down still owed stays owed (Rule 4-8-2).
  d.untimedDown = play.kind === "noPlay" ? s.untimedDown : false;
  // A pre-snap foul does not end the dead-ball period; a down does.
  d.timeoutsThisDeadBall = play.kind === "noPlay" ? s.timeoutsThisDeadBall : { home: 0, away: 0 };
  const timeExpired = (s.clock > 0 || s.untimedDown) && d.clock === 0 && play.kind !== "noPlay";
  let running = clockRuns(s, d, ev, play, e, rules);
  // 25 seconds only after the administrative stoppages of Rule 4-6-2; otherwise 40 (Rule 4-6-1).
  const administrative = e.accepted !== null || ev.changeOfPossession || d.phase === "kickoff";
  d.playClock = administrative ? rules.clock.playClockAfterStoppage : rules.clock.playClockAfterPlay;

  if (defenseConservesTime(s, play, e, rules)) {
    running = choices.clockOnSnap !== true;
    d.playClock = rules.clock.playClockAfterPlay;
  }

  if (runoffApplies(s, d, e, rules)) {
    const offense = s.possession;
    if (choices.runoffTimeout === true) {
      if (!rules.clock.timeoutAvoidsRunoff) reject("timeoutNotAllowed", "the rule set does not let a timeout replace the run-off");
      if (d.timeouts[offense] <= 0) reject("noTimeouts", `${offense} has no timeout to spend instead of the run-off`);
      if (d.timeoutsThisDeadBall[offense] >= rules.timeouts.perTeamPerDeadBall) {
        reject("timeoutNotAllowed", `${offense} already took a timeout in this dead-ball period`);
      }
      d.timeouts = { ...d.timeouts, [offense]: d.timeouts[offense] - 1 };
      // The timeout is charged in the dead-ball period that follows the foul (Rule 4-5-1, Item 3).
      d.timeoutsThisDeadBall = { ...d.timeoutsThisDeadBall, [offense]: d.timeoutsThisDeadBall[offense] + 1 };
      running = false;
      d.playClock = rules.clock.playClockAfterStoppage;
    } else {
      d.clock = Math.max(0, d.clock - rules.clock.runoffSeconds);
      running = d.clock > 0;
      d.playClock = rules.clock.playClockAfterRunoff;
    }
  } else if (crossesWarning(s, s.clock, d.clock, rules)) {
    d.twoMinuteWarningDone = true;
    running = false;
    d.playClock = rules.clock.playClockAfterStoppage;
  }
  if (timeExpired && d.phase === "scrimmage") {
    const defensiveFoul = e.accepted?.foul.by === "defense" && e.accepted.rule.timing === "live";
    // A double foul extends only a period that ends a half (Rule 4-8-2 (h)).
    const doubleFoul = e.offset && rules.clock.untimedDownAfterDoubleFoul && endsHalf(d.period, d.gameType, rules);
    d.untimedDown = (defensiveFoul && rules.clock.untimedDownAfterDefensiveFoul) || doubleFoul;
  }
  d.clockRunning = running && d.clock > 0;
  d.playCount = s.playCount + 1;
  return checked(s, settle(d, ev, rules), rules);
}

