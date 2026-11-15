// M2 G code-review fixes (7c2339f..dc47526), by engineer:
// 1. A reversed play's alternative carries none of the ruled play's standout candidate or
//    ruled-only role entries, so a standout can only come from the play that finally stands.
// 2. A failed challenge's timeout is charged across a quarter change within the half (Q1 to Q2,
//    Q3 to Q4) and waived only at the end of a half or the game.
// 3. The underReview request carries the ruled play without its verdict, and the calls.
// 4. A rule set that lets a team challenge with no timeouts costs withoutTimeoutsPenaltyYards on a
//    failed challenge instead of throwing.
//
// The games run on "hot" data: every close-call kind's review rate at 25% of the plays ruled that
// way, and a coach that challenges every close call it may.

import { describe, expect, it } from "vitest";
import type { CloseCall, DecisionRequest, PlayResult, RuleSet } from "../../packages/shared/src/types";
import type { TraceEntry } from "../../packages/sim/src/engine/why";
import type { GameData } from "../../packages/shared/src/game";
import { decisionRequestSchema } from "../../packages/shared/src/m2-schema";
import { challengeCost } from "../../packages/sim/src/game/machine";
import type { CoachPolicies } from "../../packages/sim/src/loop/coach";
import { averageCoachFor, setupGame } from "../../packages/sim/src/loop/league";
import { playGame, prepareGame, sameHalf, type GameEvent, type GameRecord } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { scrimmage } from "../../packages/sim/test/game/helpers";
import { fixtureRules } from "../../packages/sim/test/support/rules";
import { data, LEAGUE_SEED, playSession, scriptedBot, teams } from "./support";

type PlayEv = Extract<GameEvent, { t: "play" }>;
type ReviewEv = Extract<GameEvent, { t: "review" }>;

const ROLES = ["passer", "target", "receiver", "ballCarrier", "tackler", "sacker", "interceptor", "fumbleForcer", "fumbleRecoverer", "kicker", "punter", "returner"];

function hotData(base: GameData, rules?: RuleSet): GameData {
  const kinds = Object.fromEntries(Object.entries(base.engine.closeCalls.kinds).map(([k, v]) => [k, { ...v, reviewPer1000000: 250_000 }]));
  return { ...base, engine: { ...base.engine, closeCalls: { ...base.engine.closeCalls, kinds }, ...(rules === undefined ? {} : { rules }) } };
}

const challenger = (d: GameData): CoachPolicies => ({ ...averageCoachFor(d), challenge: () => true });

function games(d: GameData, seeds: number | readonly number[], coach: CoachPolicies = averageCoachFor(d)): GameRecord[] {
  const kit = prepareGame(d, { closeCalls: true, standouts: true });
  const out: GameRecord[] = [];
  const list = typeof seeds === "number" ? Array.from({ length: seeds }, (_, i) => i + 1) : seeds;
  for (const seed of list) out.push(playGame(setupGame(teams, LEAGUE_SEED, seed, () => coach), kit, Rng.fromSeed(seed)));
  return out;
}

function reviewsOf(record: GameRecord): { review: ReviewEv; play: PlayEv }[] {
  const out: { review: ReviewEv; play: PlayEv }[] = [];
  record.events.forEach((e, i) => {
    const next = record.events[i + 1];
    if (e.t === "review" && next?.t === "play") out.push({ review: e, play: next });
  });
  return out;
}

const traceOf = (p: PlayResult): TraceEntry[] => ((p.detail ?? {}) as { trace?: TraceEntry[] }).trace ?? [];
const closeCallOf = (p: PlayResult): CloseCall => (p.detail as { closeCall: CloseCall }).closeCall;

describe("fix 1: a reversed play keeps none of the ruled play's standout or role entries", () => {
  const hot = hotData(data);
  const all = games(hot, 30, challenger(hot)).flatMap(reviewsOf);
  const reversed = all.filter((x) => x.review.verdict === "reversed");

  it("no alternative carries a standout candidate, and no reversed play has a standout", () => {
    expect(reversed.length).toBeGreaterThan(20);
    for (const { review, play } of reversed) {
      expect(traceOf(closeCallOf(review.ruled).alternative).some((e) => e.factor === "standoutCandidate"), review.kind).toBe(false);
      expect(play.standout, review.kind).toBeUndefined();
    }
  });

  it("some ruled play that was reversed did carry a candidate (the case is reached)", () => {
    expect(reversed.some(({ review }) => traceOf(review.ruled).some((e) => e.factor === "standoutCandidate"))).toBe(true);
  });

  it("the alternative's role entries are exactly its participants", () => {
    for (const { review } of all) {
      const alt = closeCallOf(review.ruled).alternative;
      const parts = (alt.detail as { participants: Record<string, unknown> }).participants;
      const entries = traceOf(alt).filter((e) => ROLES.includes(e.factor));
      const fromTrace = Object.fromEntries(entries.map((e) => [e.factor, e["id"]]));
      const fromParts = Object.fromEntries(Object.entries(parts).filter(([k]) => ROLES.includes(k)));
      expect(fromTrace, review.kind).toEqual(fromParts);
      expect(entries.length, `${review.kind} one entry per role`).toBe(Object.keys(fromTrace).length);
    }
  });
});

describe("fix 2: a failed challenge costs its timeout across a quarter, not across a half", () => {
  const rules = data.engine.rules;
  const hot = hotData(data);
  // Seeds 129, 253, 330 and 364 each have a failed challenge on the play that ends the first quarter
  // (found by search over seeds 1 to 400 on this data; a play ending Q1 or Q3 is rare).
  const failed = games(hot, [...Array.from({ length: 40 }, (_, i) => i + 1), 129, 253, 330, 364], challenger(hot))
    .flatMap(reviewsOf)
    .filter(({ review }) => review.by !== "booth" && review.verdict === "stands");

  it("sameHalf: Q1 and Q2, Q3 and Q4 share a half; Q2 and Q3, Q4 and overtime do not", () => {
    expect(sameHalf(1, 2, rules)).toBe(true);
    expect(sameHalf(3, 4, rules)).toBe(true);
    expect(sameHalf(2, 3, rules)).toBe(false);
    expect(sameHalf(4, 5, rules)).toBe(false);
    expect(sameHalf(5, 5, rules)).toBe(true);
  });

  it("a failed challenge on the last play of Q1 or Q3 is charged a timeout", () => {
    const crossing = failed.filter(({ review, play }) => play.after.period !== review.before.period && sameHalf(review.before.period, play.after.period, rules));
    expect(crossing.length).toBeGreaterThan(0);
    for (const { review, play } of crossing) {
      const t = review.by as "home" | "away";
      expect(review.timeoutCharged, `period ${review.before.period}`).toBe(review.before.timeouts[t] > 0);
      expect(play.after.timeouts[t]).toBe(review.before.timeouts[t] - (review.timeoutCharged ? 1 : 0));
    }
  });

  it("at the end of a half or the game the cost is waived and the event says so", () => {
    for (const { review, play } of failed) {
      if (play.after.phase === "final" || !sameHalf(review.before.period, play.after.period, rules)) expect(review.timeoutCharged).toBe(false);
    }
  });
});

describe("fix 3: the underReview request shows the ruled play without the verdict", () => {
  const hot = hotData(data);
  const kit = prepareGame(hot, { closeCalls: true });
  const asked: DecisionRequest[] = [];
  for (let seed = 1; seed <= 6; seed++) asked.push(...playSession(setupGame(teams, LEAGUE_SEED, seed, () => averageCoachFor(hot)), kit, "home", scriptedBot(seed)).asked.map((a) => a.request));
  const under = asked.filter((r): r is Extract<DecisionRequest, { kind: "continue" }> => r.kind === "continue" && r.about.what === "underReview");

  it("each carries the play, with a closeCall and no verdict, and both calls, and passes the schema", () => {
    expect(under.length).toBeGreaterThan(3);
    for (const r of under) {
      if (r.about.what !== "underReview") continue;
      const cc = (r.about.play.detail as { closeCall?: Record<string, unknown> }).closeCall;
      expect(cc).toBeDefined();
      expect("verdict" in (cc as object)).toBe(false);
      expect(r.about.offenseCall.call.length).toBeGreaterThan(0);
      expect(decisionRequestSchema.safeParse(r).success).toBe(true);
    }
  });

  it("the schema rejects an underReview play that shows the verdict", () => {
    const r = under[0] as Extract<DecisionRequest, { kind: "continue" }>;
    if (r.about.what !== "underReview") throw new Error("not underReview");
    const leak = { ...r, about: { ...r.about, play: { ...r.about.play, detail: { ...r.about.play.detail, closeCall: { kind: "fumbleToDown", verdict: "stands" } } } } };
    expect(decisionRequestSchema.safeParse(leak).success).toBe(false);
  });
});

describe("fix 4: a failed challenge with no timeout left costs the rule set's yards", () => {
  const rules = fixtureRules({ challenges: { needsTimeout: false, failedCostsTimeout: true, withoutTimeoutsPenaltyYards: 15 } }, "no-timeout-challenges");
  const none = { home: 0, away: 0 };

  it("the offense at 0 timeouts loses 15 yards, the down stays", () => {
    const s = scrimmage({ spot: 40, down: 2, distance: 7, timeouts: none }, rules);
    const n = challengeCost(s, rules, "home");
    expect([n.spot, n.down, n.distance, n.timeouts.home]).toEqual([25, 2, 22, 0]);
  });

  it("the defense at 0 timeouts gives 15 yards, a first down past the line to gain", () => {
    const s = scrimmage({ spot: 40, down: 3, distance: 7, timeouts: none }, rules);
    const n = challengeCost(s, rules, "away");
    expect([n.spot, n.down, n.distance]).toEqual([55, 1, 10]);
    const short = challengeCost(scrimmage({ spot: 40, down: 3, distance: 20, timeouts: none }, rules), rules, "away");
    expect([short.spot, short.down, short.distance]).toEqual([55, 3, 5]);
  });

  it("half the distance to the goal near it", () => {
    const back = challengeCost(scrimmage({ spot: 10, down: 1, distance: 10, timeouts: none }, rules), rules, "home");
    expect([back.spot, back.distance]).toEqual([5, 15]);
    const near = challengeCost(scrimmage({ spot: 90, down: 2, distance: 10, goalToGo: true, timeouts: none }, rules), rules, "away");
    expect([near.spot, near.down, near.distance, near.goalToGo]).toEqual([95, 2, 5, true]);
  });

  it("with a timeout left the timeout is the cost and the spot stays", () => {
    const s = scrimmage({ spot: 40, timeouts: { home: 2, away: 3 } }, rules);
    const n = challengeCost(s, rules, "home");
    expect([n.spot, n.timeouts.home]).toEqual([40, 1]);
  });

  it("games under that rule set run, and teams at 0 timeouts challenge and lose", () => {
    const hot = hotData(data, rules);
    let atZero = 0;
    for (const g of games(hot, 40, challenger(hot))) {
      for (const { review, play } of reviewsOf(g)) {
        if (review.by === "booth" || review.verdict !== "stands" || review.before.timeouts[review.by] > 0) continue;
        atZero++;
        expect(review.timeoutCharged).toBe(false);
        expect(play.after.timeouts[review.by]).toBe(0);
      }
    }
    expect(atZero).toBeGreaterThan(0);
  });
});
