// M2 milestone G, criteria G3 to G6 and G8 (docs/specs/m2-engine-and-game-loop.md, "Challenges and
// reviews" and the G table), written by test-writer from the spec:
// - G3: every close call's alternative is accepted by applyPlay, differs from the ruled result only
//   in the way its kind names, and uses no extra outcome draw (outcome stream identical on or off).
// - G4: a reversal leaves exactly the state applying the alternative to the pre-play state leaves;
//   "stands" leaves the ruled state. Cost and count are charged per the rule set.
// - G5: eligibility comes only from rule set data: a fixture rule set with different counts,
//   windows and costs changes when requests appear and what they cost.
// - G6: neither the AI policy nor any request sees the verdict before a review.
// - G8: a scripted game reaches a human challenge that stands and one reversed, an AI challenge both
//   ways, and a rule-required review.
//
// Most checks run on "hot" data: the shipped data with every close-call kind's review rate raised
// to 25% of the plays ruled that way, so reviews are common enough to check in a few games. Rates are
// data; the spec's rules (no outcome draw, state equality, rule-set eligibility, no verdict leak)
// must hold whatever the rates are. G8 runs on the shipped rates.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { CloseCall, CloseCallKind, DecisionAnswer, DecisionRequest, PlayResult } from "../../packages/shared/src/types";
import type { GameData } from "../../packages/shared/src/game";
import type { RuleSet } from "../../packages/shared/src/rules";
import { createEngine, type ResolvePlay } from "../../packages/sim/src/engine/resolve";
import { applyPlay } from "../../packages/sim/src/game/machine";
import type { GameState, Team } from "../../packages/sim/src/game/types";
import type { ChallengeView, CoachPolicies } from "../../packages/sim/src/loop/coach";
import { averageCoachFor, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { playGame, prepareGame, type GameEvent, type GameKit, type GameRecord, type GameSetup } from "../../packages/sim/src/loop/play";
import { answerSession, replaySession, sessionRecord, startSession } from "../../packages/sim/src/loop/session";
import { Rng } from "../../packages/sim/src/rng";
import { fixtureRules } from "../../packages/sim/test/support/rules";
import { randomPath } from "../../scripts/game/session-perf";
import { data, LEAGUE_SEED, playSession, scriptedBot, teams, type Asked } from "./support";

type PlayEv = Extract<GameEvent, { t: "play" }>;
type ReviewEv = Extract<GameEvent, { t: "review" }>;

const KINDS: readonly CloseCallKind[] = ["completionToIncomplete", "fumbleToDown", "interceptionToIncomplete", "touchdownToShort", "spotLineToGain"];

/** The shipped data with every kind's review rate at 25% (reversal rates as shipped). */
function hotData(base: GameData, rules?: RuleSet): GameData {
  const kinds = Object.fromEntries(Object.entries(base.engine.closeCalls.kinds).map(([k, v]) => [k, { ...v, reviewPer1000000: 250_000 }]));
  return { ...base, engine: { ...base.engine, closeCalls: { ...base.engine.closeCalls, kinds }, ...(rules === undefined ? {} : { rules }) } };
}

const closeCallOf = (p: PlayResult): CloseCall | undefined => ((p.detail ?? {}) as { closeCall?: CloseCall }).closeCall;
const withoutDetail = (p: PlayResult): Record<string, unknown> => {
  const { detail: _d, ...rest } = p as PlayResult & { detail?: unknown };
  void _d;
  return rest;
};

/** A kit whose resolve records the state each play was resolved from, keyed by the result object. */
function recordingKit(d: GameData, inner?: ResolvePlay): { kit: GameKit; pre: Map<PlayResult, GameState> } {
  const kit = prepareGame(d, { closeCalls: true });
  const pre = new Map<PlayResult, GameState>();
  const resolve = inner ?? kit.resolve;
  return {
    pre,
    kit: {
      ...kit,
      resolve: (s, o, dc, p, rng) => {
        const r = resolve(s, o, dc, p, rng);
        pre.set(r, s);
        return r;
      },
    },
  };
}

function setupIn(seed: number, d: GameData): GameSetup {
  const c = averageCoachFor(d);
  return setupGame(teams, LEAGUE_SEED, seed, () => c);
}

/** Each review with the play event that follows it. */
function reviewsOf(record: GameRecord): { review: ReviewEv; play: PlayEv }[] {
  const out: { review: ReviewEv; play: PlayEv }[] = [];
  record.events.forEach((e, i) => {
    if (e.t !== "review") return;
    const next = record.events[i + 1];
    if (next?.t !== "play") throw new Error(`review at event ${i} not followed by its play`);
    out.push({ review: e, play: next });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------- G3

describe("G3: the alternative is an edit of the ruled play, with no extra outcome draw", () => {
  const hot = hotData(data);
  const on = createEngine(hot.engine, { closeCalls: true });
  const off = createEngine(hot.engine, { closeCalls: false });
  const mismatches: string[] = [];
  const calls: { state: GameState; ruled: PlayResult; cc: CloseCall }[] = [];
  let resolved = 0;
  // Every engine call of the game is shadowed with close calls off, from a copy of the stream.
  const shadow: ResolvePlay = (s, o, dc, p, rng) => {
    const copy = Rng.fromState(rng.getState());
    const b = off(s, o, dc, p, copy);
    const a = on(s, o, dc, p, rng);
    resolved++;
    const cc = closeCallOf(a);
    const stripped = cc === undefined ? a : ({ ...a, detail: Object.fromEntries(Object.entries(a.detail ?? {}).filter(([k]) => k !== "closeCall")) } as PlayResult);
    if (JSON.stringify(stripped) !== JSON.stringify(b)) mismatches.push(`result differs at call ${resolved}`);
    if (JSON.stringify(rng.getState()) !== JSON.stringify(copy.getState())) mismatches.push(`outcome stream differs at call ${resolved}`);
    if (cc !== undefined) calls.push({ state: s, ruled: a, cc });
    return a;
  };
  const { kit } = recordingKit(hot, shadow);
  for (let seed = 1; seed <= 12; seed++) playGame(setupIn(seed, hot), kit, Rng.fromSeed(seed));

  it("with close calls on, every result and the outcome stream are as with them off", () => {
    expect(mismatches).toEqual([]);
    expect(resolved).toBeGreaterThan(1500);
  });

  it("every kind is reached", () => {
    expect(new Set(calls.map((c) => c.cc.kind))).toEqual(new Set(KINDS));
  });

  it("applyPlay accepts every alternative from the pre-play state", () => {
    for (const c of calls) expect(() => applyPlay(c.state, data.engine.rules, c.cc.alternative), c.cc.kind).not.toThrow();
  });

  it("each alternative differs from the ruled play only in the way its kind names", () => {
    const bad: string[] = [];
    for (const { state: s, ruled, cc } of calls) {
      const r = withoutDetail(ruled) as PlayResult & Record<string, unknown>;
      const a = withoutDetail(cc.alternative) as PlayResult & Record<string, unknown>;
      const end = (p: PlayResult): { spot: number; possession: string } => (p as { end: { spot: number; possession: string } }).end;
      const same = (keys: readonly string[]): boolean => {
        const pick = (x: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k]) => !keys.includes(k)).sort()));
        return pick(r) === pick(a);
      };
      const fail = (why: string): void => void bad.push(`${cc.kind}: ${why} (${JSON.stringify(r)} -> ${JSON.stringify(a)})`);
      switch (cc.kind) {
        case "completionToIncomplete":
        case "interceptionToIncomplete": {
          const ruledOk = cc.kind === "completionToIncomplete" ? r.kind === "pass" && r["incomplete"] !== true && r["turnover"] === undefined && end(ruled).possession === "offense" : r.kind === "pass" && r["turnover"] === "interception";
          if (!ruledOk) fail("ruled play is not of the kind");
          if (a.kind !== "pass" || a["incomplete"] !== true) fail("alternative is not an incomplete pass");
          if (end(cc.alternative).spot !== s.spot || end(cc.alternative).possession !== "offense") fail("incompletion not at the line of scrimmage");
          if (a["turnover"] !== undefined || a["defensePossessedDuringPlay"] !== undefined) fail("incompletion keeps a turnover");
          if (a.seconds !== r.seconds) fail("seconds changed");
          break;
        }
        case "fumbleToDown":
          if (r["turnover"] !== "fumble" || end(ruled).possession !== "defense") fail("ruled play is not a lost fumble");
          if (a.kind !== r.kind || a.seconds !== r.seconds) fail("kind or seconds changed");
          if (a["turnover"] !== undefined || end(cc.alternative).possession !== "offense") fail("alternative still a turnover");
          if (!same(["end", "turnover", "defensePossessedDuringPlay"])) fail("more than the fumble changed");
          break;
        case "touchdownToShort":
          if (end(ruled).spot < 100 || end(ruled).possession !== "offense") fail("ruled play is not a touchdown");
          if (end(cc.alternative).spot !== 99 || end(cc.alternative).possession !== "offense") fail("alternative is not down at the 1");
          if (a["touchdown"] === true) fail("alternative still a touchdown");
          // The spot and the touchdown flag the ruling carried; nothing else.
          if (!same(["end", "touchdown"])) fail("more than the spot changed");
          break;
        case "spotLineToGain": {
          const line = s.spot + s.distance;
          const rs = end(ruled).spot;
          const as = end(cc.alternative).spot;
          if (Math.abs(rs - line) > 1 || Math.abs(as - line) > 1) fail("a spot is more than a yard from the line to gain");
          if (rs >= line === as >= line) fail("the alternative does not cross the line to gain");
          if (end(cc.alternative).possession !== end(ruled).possession) fail("possession changed");
          if (!same(["end"])) fail("more than the spot changed");
          break;
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------- G4

describe("G4: a reversal is the alternative applied to the pre-play state; cost and count per the rule set", () => {
  const hot = hotData(data);
  const rules = hot.engine.rules;
  const { kit, pre } = recordingKit(hot);
  const games = Array.from({ length: 14 }, (_, i) => playGame(setupIn(100 + i, hot), kit, Rng.fromSeed(100 + i)));
  const all = games.flatMap((g) => reviewsOf(g).map((x) => ({ ...x, game: g })));

  it("the games reach booth and coach reviews, both verdicts", () => {
    const by = (b: "booth" | "coach", v: string) => all.filter((x) => (b === "booth" ? x.review.by === "booth" : x.review.by !== "booth") && x.review.verdict === v).length;
    expect(by("booth", "stands")).toBeGreaterThan(3);
    expect(by("booth", "reversed")).toBeGreaterThan(3);
    expect(by("coach", "stands")).toBeGreaterThan(3);
    expect(by("coach", "reversed")).toBeGreaterThan(3);
  });

  it("the play that stands is the alternative after a reversal and the ruled play otherwise", () => {
    for (const { review, play } of all) {
      const cc = closeCallOf(review.ruled);
      expect(cc, review.kind).toBeDefined();
      expect(play.play).toEqual(review.verdict === "reversed" ? cc?.alternative : review.ruled);
    }
  });

  it("the state after the play is applyPlay of that play on the pre-play state (timeouts and clock as charged below)", () => {
    for (const { review, play } of all) {
      const s = pre.get(review.ruled);
      expect(s, "pre-play state recorded").toBeDefined();
      const cc = closeCallOf(review.ruled) as CloseCall;
      const want = applyPlay(s as GameState, rules, review.verdict === "reversed" ? cc.alternative : review.ruled);
      const got = play.after;
      const fields = ["period", "phase", "possession", "spot", "down", "distance", "goalToGo", "score", "safetyKick"] as const;
      for (const f of fields) expect(got[f], `${review.kind} ${review.verdict} ${f}`).toEqual(want[f]);
      // Clock: unchanged, except the rule set's run-off after a reversal past the two-minute warning.
      const runoff = review.verdict === "reversed" && (s as GameState).twoMinuteWarningDone && rules.replay.reversalRunoffAfterTwoMinuteWarning && want.phase === "scrimmage" && want.clockRunning;
      expect(got.clock, `${review.kind} clock`).toBe(runoff ? Math.max(0, want.clock - rules.replay.reversalRunoffSeconds) : want.clock);
      // Timeouts: one fewer for the challenger exactly when the review charged one.
      for (const t of ["home", "away"] as const) expect(got.timeouts[t], `${review.kind} timeouts ${t}`).toBe(want.timeouts[t] - (review.timeoutCharged && review.by === t ? 1 : 0));
    }
  });

  it("a failed coach's challenge costs a timeout per the rule set; a won one and a booth review cost none", () => {
    expect(rules.challenges.failedCostsTimeout).toBe(true);
    let charged = 0;
    for (const { review, play } of all) {
      if (review.by === "booth" || review.verdict === "reversed") expect(review.timeoutCharged, `${review.by} ${review.verdict}`).toBe(false);
      else if (play.after.period === review.before.period && play.after.phase !== "final") {
        expect(review.timeoutCharged).toBe(true);
        charged++;
      }
    }
    expect(charged).toBeGreaterThan(3);
  });

  it("a team challenges only with a challenge left (perGame, plus the extra after a win, up to max) and a timeout", () => {
    const ch = rules.challenges;
    for (const g of games) {
      const used = { home: 0, away: 0 };
      const won = { home: 0, away: 0 };
      for (const { review } of reviewsOf(g)) {
        if (review.by === "booth") continue;
        const t = review.by;
        const allowed = Math.min(ch.max, ch.perGame + (won[t] > 0 ? ch.extraIfOneSucceeds : 0));
        expect(used[t], `${t} challenge ${used[t] + 1}`).toBeLessThan(allowed);
        if (ch.needsTimeout) expect(review.before.timeouts[t]).toBeGreaterThan(0);
        used[t]++;
        if (review.verdict === "reversed") won[t]++;
      }
    }
  });

  it("the Replay Official, not a coach, reviews every turnover kind and every review after the two-minute warning (rule set)", () => {
    expect(rules.replay.officialReviewsTurnovers && rules.replay.officialOnlyAfterTwoMinuteWarning).toBe(true);
    for (const { review } of all) {
      if (review.kind === "fumbleToDown" || review.kind === "interceptionToIncomplete") expect(review.by).toBe("booth");
      const lateHalf = (review.before.period === 2 || review.before.period === 4) && review.before.clock < 120;
      if (lateHalf || review.before.period > 4) expect(review.by, `${review.kind} Q${review.before.period} ${review.before.clock}`).toBe("booth");
    }
  });
});

// ---------------------------------------------------------------------------------------------- G5

describe("G5: eligibility and cost come from the rule set data (fixture rule sets)", () => {
  const prefer = (r: DecisionRequest): readonly string[] | null => (r.kind === "challenge" ? ["throwFlag"] : null);
  const SEEDS = Array.from({ length: 10 }, (_, i) => 200 + i);

  /** Plays the seeds with a human seat that always throws the flag, under `rules`. */
  function under(rules: RuleSet): { records: GameRecord[]; asked: Asked[]; humans: Team[] } {
    const d = hotData(data, rules);
    const { kit } = recordingKit(d);
    const records: GameRecord[] = [];
    const asked: Asked[] = [];
    const humans: Team[] = [];
    for (const seed of SEEDS) {
      const human: Team = seed % 2 === 0 ? "home" : "away";
      const setup = setupIn(seed, d);
      const p = playSession(setup, kit, human, scriptedBot(seed, { prefer }));
      records.push(sessionRecord(p.session, setup, kit));
      asked.push(...p.asked);
      humans.push(human);
    }
    return { records, asked, humans };
  }
  const coachReviews = (x: { records: GameRecord[] }): ReviewEv[] => x.records.flatMap((g) => reviewsOf(g).map((r) => r.review)).filter((r) => r.by !== "booth");
  const challengeRequests = (x: { asked: Asked[] }) => x.asked.map((a) => a.request).filter((r): r is Extract<DecisionRequest, { kind: "challenge" }> => r.kind === "challenge");

  const shipped = under(data.engine.rules);

  it("shipped rules: the human is asked, and coaches challenge", () => {
    expect(challengeRequests(shipped).length).toBeGreaterThan(5);
    expect(coachReviews(shipped).length).toBeGreaterThan(5);
  });

  it("no challenges in the rule set: no challenge request and no coach review, booth reviews go on", () => {
    const none = under(fixtureRules({ challenges: { perGame: 0, extraIfOneSucceeds: 0, max: 0 } }));
    expect(challengeRequests(none)).toEqual([]);
    expect(coachReviews(none)).toEqual([]);
    expect(none.records.flatMap((g) => reviewsOf(g)).length).toBeGreaterThan(0);
  });

  it("one challenge a game, no extra: each team challenges at most once a game; shipped rules allow more", () => {
    const most = (x: { records: GameRecord[] }): number =>
      Math.max(...x.records.flatMap((g) => (["home", "away"] as const).map((t) => reviewsOf(g).filter((r) => r.review.by === t).length)));
    const one = under(fixtureRules({ challenges: { perGame: 1, extraIfOneSucceeds: 0, max: 1 } }));
    expect(most(one)).toBe(1);
    expect(most(shipped)).toBeGreaterThan(1);
    // The request states the rule set's count.
    for (const r of challengeRequests(one)) expect(r.challengesLeft).toBe(1);
  });

  it("the request's count follows the rule set: perGame 4, no extra", () => {
    const four = under(fixtureRules({ challenges: { perGame: 4, extraIfOneSucceeds: 0, max: 4 } }));
    const left = challengeRequests(four).map((r) => r.challengesLeft);
    expect(left.length).toBeGreaterThan(0);
    expect(Math.max(...left)).toBe(4);
    for (const l of left) expect(l).toBeLessThanOrEqual(4);
  });

  it("a failed challenge costs nothing when the rule set says so", () => {
    const free = under(fixtureRules({ challenges: { failedCostsTimeout: false } }));
    const failed = coachReviews(free).filter((r) => r.verdict === "stands");
    expect(failed.length).toBeGreaterThan(0);
    for (const r of failed) expect(r.timeoutCharged).toBe(false);
    for (const r of challengeRequests(free)) expect(r.failedCostsTimeout).toBe(false);
    // Shipped: a failed challenge is charged.
    expect(coachReviews(shipped).some((r) => r.verdict === "stands" && r.timeoutCharged)).toBe(true);
  });

  it("with no booth-only window after the two-minute warning, coaches challenge there", () => {
    const late = (x: { records: GameRecord[] }): ReviewEv[] => coachReviews(x).filter((r) => (r.before.period === 2 || r.before.period === 4) && r.before.clock < 120);
    expect(late(shipped)).toEqual([]);
    const open = under(fixtureRules({ replay: { officialOnlyAfterTwoMinuteWarning: false } }));
    expect(late(open).length).toBeGreaterThan(0);
  });

  it("with turnovers not booth-reviewed, turnover close calls go to the coaches", () => {
    const turnover = (x: { records: GameRecord[] }): ReviewEv[] => coachReviews(x).filter((r) => r.kind === "fumbleToDown" || r.kind === "interceptionToIncomplete");
    expect(turnover(shipped)).toEqual([]);
    const coaches = under(fixtureRules({ replay: { officialReviewsTurnovers: false } }));
    expect(turnover(coaches).length).toBeGreaterThan(0);
  });

  it("with no timeout needed and a failed challenge charging one, a team with no timeouts left can still challenge (edge case: from data)", () => {
    // Spec edge case: "A challenge with no timeouts left (whatever the rules say, from data)".
    const r = fixtureRules({ challenges: { needsTimeout: false, perGame: 6, extraIfOneSucceeds: 0, max: 6 } });
    let played: ReturnType<typeof under> | null = null;
    expect(() => (played = under(r))).not.toThrow();
    const reviews = coachReviews(played as unknown as ReturnType<typeof under>);
    // It is reached: a coach review by a team with no timeouts left, and none charged a timeout it didn't have.
    expect(reviews.some((x) => x.before.timeouts[x.by as Team] === 0)).toBe(true);
    // Shipped: never without a timeout.
    for (const x of coachReviews(shipped)) expect(x.before.timeouts[x.by as Team]).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------- G6

describe("G6: the verdict is never reachable before a review", () => {
  it("type: neither the AI's view nor the challenge request's close call has a verdict", () => {
    expectTypeOf<"verdict" extends keyof ChallengeView ? true : false>().toEqualTypeOf<false>();
    type Req = Extract<DecisionRequest, { kind: "challenge" }>;
    expectTypeOf<"verdict" extends keyof Req ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<"verdict" extends keyof Req["closeCall"] ? true : false>().toEqualTypeOf<false>();
  });

  /** Every key path in a value that names a verdict. */
  const verdictPaths = (x: unknown, at = "$"): string[] => {
    if (x === null || typeof x !== "object") return [];
    return Object.entries(x).flatMap(([k, v]) => [...(k === "verdict" ? [`${at}.${k}`] : []), ...verdictPaths(v, `${at}.${k}`)]);
  };

  const prefer = (r: DecisionRequest): readonly string[] | null => (r.kind === "challenge" ? ["throwFlag"] : null);
  const hot = hotData(data);

  /** A kit whose engine flips every close call's verdict. */
  const flipped = (): GameKit => {
    const k = prepareGame(hot, { closeCalls: true });
    return {
      ...k,
      resolve: (s, o, dc, p, rng) => {
        const r = k.resolve(s, o, dc, p, rng);
        const cc = closeCallOf(r);
        if (cc === undefined) return r;
        return { ...r, detail: { ...r.detail, closeCall: { ...cc, verdict: cc.verdict === "reversed" ? "stands" : "reversed" } } } as PlayResult;
      },
    };
  };

  it("no request before a review result holds a verdict anywhere (walk of every request object)", () => {
    const kit = prepareGame(hot, { closeCalls: true });
    let challenges = 0;
    let underReview = 0;
    for (let seed = 300; seed < 308; seed++) {
      const human: Team = seed % 2 === 0 ? "home" : "away";
      const setup = setupIn(seed, hot);
      const { asked } = playSession(setup, kit, human, scriptedBot(seed, { prefer }));
      for (const { request: r } of asked) {
        const result = r.kind === "continue" && (r.about as { what: string }).what === "reviewResult";
        if (!result) expect(verdictPaths(r), `${r.kind} ${r.seq}`).toEqual([]);
        if (r.kind === "challenge") challenges++;
        if (r.kind === "continue" && (r.about as { what: string }).what === "underReview") underReview++;
      }
    }
    expect(challenges).toBeGreaterThan(3);
    expect(underReview).toBeGreaterThan(3);
  });

  it("flipping every verdict changes no request until the first review result", () => {
    const real = prepareGame(hot, { closeCalls: true });
    const flip = flipped();
    let compared = 0;
    for (let seed = 310; seed < 318; seed++) {
      const human: Team = seed % 2 === 0 ? "home" : "away";
      const setup = setupIn(seed, hot);
      const a = playSession(setup, real, human, scriptedBot(seed, { prefer })).asked.map((x) => x.request);
      const b = playSession(setup, flip, human, scriptedBot(seed, { prefer })).asked.map((x) => x.request);
      const firstResult = a.findIndex((r) => r.kind === "continue" && (r.about as { what: string }).what === "reviewResult");
      if (firstResult < 0) continue;
      // Everything up to it, including the challenge and "under review" requests, is identical.
      expect(b.slice(0, firstResult)).toEqual(a.slice(0, firstResult));
      expect(a.slice(0, firstResult).some((r) => r.kind === "challenge" || (r.kind === "continue" && (r.about as { what: string }).what === "underReview"))).toBe(true);
      compared++;
    }
    expect(compared).toBeGreaterThan(3);
  });

  it("the AI's challenge view and choice are the same whichever way the verdict goes", () => {
    // A log per run of close calls ("cc") and AI challenge decisions ("view"). The game's first close
    // call has no review before it, so when the AI decides on it the two runs are the same game up
    // to there, and the AI's view and choice must match.
    let compared = 0;
    let aiFirst = 0;
    for (let seed = 320; seed < 340; seed++) {
      const run = (flip: boolean): { first: { view: ChallengeView; choice: boolean } | null; events: readonly GameEvent[] } => {
        const log: ("cc" | { view: ChallengeView; choice: boolean })[] = [];
        const base = averageCoachFor(hot);
        const spy: CoachPolicies = {
          ...base,
          challenge: (v) => {
            const c = base.challenge?.(v) ?? false;
            log.push({ view: JSON.parse(JSON.stringify(v)) as ChallengeView, choice: c });
            return c;
          },
        };
        const k = flip ? flipped() : prepareGame(hot, { closeCalls: true });
        const kit: GameKit = {
          ...k,
          resolve: (s, o, dc, p, rng) => {
            const r = k.resolve(s, o, dc, p, rng);
            if (closeCallOf(r) !== undefined) log.push("cc");
            return r;
          },
        };
        const record = playGame(setupGame(teams, LEAGUE_SEED, seed, () => spy), kit, Rng.fromSeed(seed));
        const first = log[1];
        return { first: log[0] === "cc" && first !== undefined && first !== "cc" ? first : null, events: record.events };
      };
      const a = run(false);
      const b = run(true);
      // Until the first review the verdict has had no chance to act: the games are the same, and so
      // is who reviews it (an AI's challenge, or the booth).
      const i = a.events.findIndex((e) => e.t === "review");
      if (i >= 0) {
        // The flipped verdict itself sits on unreviewed plays' close calls; drop it from both.
        const noVerdict = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (k, v: unknown) => (k === "verdict" ? undefined : v)));
        expect(noVerdict(b.events.slice(0, i))).toEqual(noVerdict(a.events.slice(0, i)));
        const [ra, rb] = [a.events[i], b.events[i]] as ReviewEv[];
        expect(rb?.t).toBe("review");
        expect({ by: rb?.by, kind: rb?.kind }).toEqual({ by: ra?.by, kind: ra?.kind });
        if (ra?.by !== "booth") aiFirst++;
      }
      if (a.first === null) continue;
      expect(b.first).toEqual(a.first);
      expect(verdictPaths(a.first)).toEqual([]);
      compared++;
    }
    expect(compared).toBeGreaterThan(3);
    expect(aiFirst).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------------------------- G8

describe("G8: every review case is reachable in scripted games (shipped rates)", () => {
  const CASES = ["humanStands", "humanReversed", "aiStands", "aiReversed", "booth"] as const;
  const kit = prepareGame(data, { closeCalls: true });
  const coach = averageCoachFor(data);
  const casesOf = (events: readonly GameEvent[], human: Team): Set<string> => {
    const out = new Set<string>();
    for (const e of events) {
      if (e.t !== "review") continue;
      if (e.by === "booth") out.add("booth");
      else if (e.by === human) out.add(e.verdict === "reversed" ? "humanReversed" : "humanStands");
      else out.add(e.verdict === "reversed" ? "aiReversed" : "aiStands");
    }
    return out;
  };

  it("five scripted games (a seeded legal path, always throwing the flag) reach all five, and replay from their input logs", () => {
    const got = new Set<string>();
    for (const seed of [2, 4, 23, 49, 164]) {
      const human: Team = seed % 2 === 0 ? "home" : "away";
      const setup = setupGame(teams, LEAGUE_SEED, seed, () => coach);
      const bot = Rng.fromSeed(seed);
      let s = startSession(setup, kit, human);
      let flags = 0;
      while (s.request !== null) {
        if (s.request.kind === "challenge") {
          // Asked of the human's own team, about a ruling that went against it.
          expect(s.request.team).toBe(human);
          flags++;
        }
        const path = s.request.kind === "challenge" ? ["throwFlag"] : randomPath(s.request, bot);
        const r = answerSession(s, setup, kit, { seq: s.request.seq, path });
        if (!r.ok) throw new Error(r.error.message);
        s = r.session;
      }
      const events = sessionRecord(s, setup, kit).events;
      // Every human challenge is one the human made: as many as the flags he threw.
      expect(events.filter((e) => e.t === "review" && e.by === human).length, `seed ${seed}`).toBe(flags);
      const cases = casesOf(events, human);
      const again = casesOf(sessionRecord(replaySession(setup, kit, human, s.inputs), setup, kit).events, human);
      expect([...again].sort()).toEqual([...cases].sort());
      for (const c of cases) got.add(c);
    }
    expect([...got].sort()).toEqual([...CASES].sort());
  });

  it("the committed G8 games (test/fixtures/m2-g8-games.json) replay from seed and input log and reach all five", () => {
    const fx = JSON.parse(readFileSync(join(import.meta.dirname, "../fixtures/m2-g8-games.json"), "utf8")) as { leagueSeed: number; games: { seed: number; human: Team; inputs: DecisionAnswer[] }[] };
    const league = leagueFromSeed(data, fx.leagueSeed).teams;
    const got = new Set<string>();
    for (const g of fx.games) {
      const setup = setupGame(league, fx.leagueSeed, g.seed, () => coach);
      const s = replaySession(setup, kit, g.human, g.inputs);
      expect(s.request, `seed ${g.seed} ends`).toBeNull();
      for (const c of casesOf(sessionRecord(s, setup, kit).events, g.human)) got.add(c);
    }
    expect([...got].sort()).toEqual([...CASES].sort());
  });
});
