// Review order and replay (code review of 7c2339f..dc47526), by engineer: the ruled play shows
// before "Under review" for every review (the booth's, the other coach's, the human's), and a play
// the human already saw (a challenge that stood, or one he declined) is not animated twice. The
// worker's step messages from real games are walked with the app's rule (app.ts): a request's
// pending play is shown unless its key was shown; a play event animates unless its key was shown.

import { describe, expect, it } from "vitest";
import type { PlayResult } from "@clipboard-football/shared";
import type { GameEvent } from "../src/engine/types";
import { pendingKey, pendingPlay } from "../src/ui/pending";
import { playGame } from "./support";

type Shown = { readonly key: string; readonly via: "request" | "event"; readonly what: string };

/** What the app animates, in order, for one game's step messages. */
interface PlayShow {
  readonly ev: Extract<GameEvent, { t: "play" }>;
  /** A request in this dead ball showed a play first. */
  readonly hadPending: boolean;
  /** The kind of the request that showed it (or null). */
  readonly pendingFrom: string | null;
  /** The play event was animated too. */
  readonly animated: boolean;
  /** The review just before it reversed the ruling. */
  readonly reversed: boolean;
}

function walk(seed: number): { shown: Shown[]; plays: PlayShow[]; events: GameEvent[]; underReview: number; reviewsSeen: number } {
  const { sent } = playGame(seed, "home", seed);
  const shown: Shown[] = [];
  let pending: string | null = null;
  let pendingFrom: string | null = null;
  let underReview = 0;
  let reviewsSeen = 0;
  const events: GameEvent[] = [];
  const plays: PlayShow[] = [];
  let reversed = false;
  for (const m of sent) {
    if (m.t !== "step") continue;
    for (const ev of m.events) {
      events.push(ev);
      if (ev.t === "review") {
        reviewsSeen++;
        reversed = ev.verdict === "reversed";
      }
      if (ev.t !== "play") continue;
      const key = pendingKey(ev.play);
      if (pending !== key) shown.push({ key, via: "event", what: ev.play.kind });
      plays.push({ ev, hadPending: pending !== null, pendingFrom, animated: pending !== key, reversed });
      pending = null;
      pendingFrom = null;
      reversed = false;
    }
    const p = pendingPlay(m.request);
    if (m.request?.kind === "continue" && m.request.about.what === "underReview") {
      underReview++;
      // The ruled play is shown before "Under review": it is either shown now or was just shown.
      expect(p, "underReview carries the ruled play").not.toBeNull();
    }
    if (p !== null) {
      const key = pendingKey(p.play);
      if (pending !== key) {
        shown.push({ key, via: "request", what: m.request?.kind ?? "" });
        pendingFrom = m.request?.kind ?? null;
      }
      pending = key;
    }
  }
  return { shown, plays, events, underReview, reviewsSeen };
}

const ruledOf = (ev: Extract<GameEvent, { t: "review" }>): PlayResult => ev.ruled;
const altOf = (ev: Extract<GameEvent, { t: "review" }>): PlayResult => (ev.ruled.detail as { closeCall: { alternative: PlayResult } }).closeCall.alternative;

describe("pendingKey", () => {
  it("is the same for a play with and without its close call's verdict, and differs from the alternative", () => {
    const alt = { kind: "pass", seconds: 5, incomplete: true } as unknown as PlayResult;
    const ruled = { kind: "pass", seconds: 5, detail: { trace: [], closeCall: { kind: "completionToIncomplete", question: "q", alternative: alt, verdict: "stands" } } } as unknown as PlayResult;
    const { verdict: _v, ...shown } = (ruled.detail as { closeCall: Record<string, unknown> }).closeCall;
    void _v;
    const stripped = { ...ruled, detail: { ...ruled.detail, closeCall: shown } } as PlayResult;
    expect(pendingKey(ruled)).toBe(pendingKey(stripped));
    expect(pendingKey(ruled)).not.toBe(pendingKey(alt));
    expect(pendingKey(alt)).toBe(JSON.stringify(alt));
  });
});

describe("review order and replay in real games (close calls on, human home)", () => {
  const games = Array.from({ length: 24 }, (_, i) => walk(i + 1));
  const reviews = games.flatMap((g) => g.events.filter((e): e is Extract<GameEvent, { t: "review" }> => e.t === "review"));

  it("every review is announced with an underReview request that carries the ruled play", () => {
    expect(reviews.length).toBeGreaterThan(5);
    expect(games.reduce((a, g) => a + g.underReview, 0)).toBe(games.reduce((a, g) => a + g.reviewsSeen, 0));
  });

  it("a reviewed play's ruling is shown once, before the review; a reversal then shows the alternative once", () => {
    let stood = 0;
    let reversed = 0;
    for (const g of games) {
      for (const ev of g.events) {
        if (ev.t !== "review") continue;
        const ruled = g.shown.filter((s) => s.key === pendingKey(ruledOf(ev)));
        expect(ruled.length, `${ev.kind} ${ev.by} ${ev.verdict}: ruled play shown once`).toBe(1);
        expect(ruled[0]?.via, "shown from the request, before the review").toBe("request");
        if (ev.verdict === "reversed") {
          reversed++;
          expect(g.shown.filter((s) => s.key === pendingKey(altOf(ev))).length, `${ev.kind} alternative shown once`).toBe(1);
        } else stood++;
      }
    }
    expect(stood).toBeGreaterThan(0);
    expect(reversed).toBeGreaterThan(0);
  });

  it("a play a request already showed is not animated again, unless a review reversed it", () => {
    let fromChallenge = 0;
    let declined = 0;
    for (const g of games) {
      for (const p of g.plays) {
        if (!p.hadPending) continue;
        expect(p.animated, `${p.ev.play.kind} reversed=${p.reversed}`).toBe(p.reversed);
        if ((p.ev.play.detail as { closeCall?: unknown } | undefined)?.closeCall !== undefined) fromChallenge++;
      }
      for (const p of g.plays) {
        const prev = g.events[g.events.indexOf(p.ev) - 1];
        if (p.pendingFrom === "challenge" && prev?.t !== "review") declined++;
      }
    }
    expect(fromChallenge, "a ruled close call that stood is reached").toBeGreaterThan(0);
    expect(declined, "a declined challenge is reached").toBeGreaterThan(0);
  });
});
