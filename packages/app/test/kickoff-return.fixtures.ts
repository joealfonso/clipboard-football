// Fixtures for the kickoff return pass (docs/specs/m2-play-calling-and-motion.md, "Amended (Joseph,
// 2026-11-15): kickoff return pass (KR1 to KR9)"). Shaped like KICKOFF_RETURN in fixtures.ts: the
// kicking team (home) kicks from its 35 up the screen, the landing spot is 97 when the engine gives
// none, and the return comes back down. Return length = landing y - dead spot y.
//
// KR_LONG: a return of 40 yd or more (97 -> 52, 45 yd).
// krShort(yards): a return of `yards`, built by the test below cutMinReturnYards.
// KR_FUMBLE: the returner fumbles at 72 and the kicking team recovers (R9 recovery rules after it).
// KR_TD: a return touchdown (the engine's IN_OWN_END_ZONE, -1), live time may exceed the cap.
// KR_FOUL: a return with a named fouler on the return unit (States: exempt from KR2 to KR5).
// KR_DEEP: the returner set deep (A-RB1) rather than short (A-S1), States row 3.
// Non-return kicks for KR8: a kickoff fair catch, a kickoff out of bounds, a short kickoff, two onside kicks.

import type { PlayResult } from "@clipboard-football/shared";
import type { PlayEvent, Snapshot } from "../src/engine/types";
import { KICKOFF_RETURN, KICKOFF_UNIT } from "./fixtures";

type Kick = Extract<PlayResult, { kind: "kickoff" }>;
const base = KICKOFF_RETURN.play as Kick;
const baseDetail = base.detail as Record<string, unknown>;

/** Fields a kickoff fixture may set; turnover and touchdown are the informational PlayBase flags the timeline reads. */
type KickFields = Partial<Omit<Kick, "detail">> & { readonly turnover?: "fumble"; readonly touchdown?: boolean; readonly detail?: Record<string, unknown> };

function kick(play: KickFields, after: Partial<Snapshot> = {}): PlayEvent {
  return {
    ...KICKOFF_RETURN,
    play: { ...base, ...play, detail: { ...baseDetail, onField: KICKOFF_UNIT, ...(play.detail ?? {}) } } as PlayResult,
    after: { ...KICKOFF_RETURN.after, ...after },
  };
}

/** A returned kickoff ending at `spot` (kicking team's frame), landing at 97. */
export function krReturn(spot: number, extra: Record<string, unknown> = {}, seconds = 6): PlayEvent {
  return kick({ seconds, outcome: "inPlay", end: { spot, possession: "defense" }, detail: { participants: { kicker: "H-K1", returner: "A-S1", tackler: "H-LB2" }, class: "returned", ...extra } }, { spot: 100 - spot });
}

export const KR_LONG: PlayEvent = krReturn(52, {}, 8);

/** A return of `yards` from the 97 landing. */
export const krShort = (yards: number): PlayEvent => krReturn(97 - yards, {}, 4);

export const KR_FUMBLE: PlayEvent = {
  ...kick(
    {
      seconds: 7,
      outcome: "inPlay",
      turnover: "fumble",
      end: { spot: 72, possession: "offense" },
      detail: { participants: { kicker: "H-K1", returner: "A-S1", fumbleForcer: "H-LB2", fumbleRecoverer: "H-CB1" }, class: "fumble", fumbleSpot: 72 },
    },
    { possession: "home", spot: 72 },
  ),
};

export const KR_TD: PlayEvent = kick(
  { seconds: 12, outcome: "inPlay", touchdown: true, end: { spot: -1, possession: "defense" }, detail: { participants: { kicker: "H-K1", returner: "A-S1" }, class: "returnTD" } },
  { phase: "try", spot: 98, down: 0, distance: 0, score: { home: 7, away: 9 } },
);

export const KR_FOUL: PlayEvent = {
  ...kick(
    { seconds: 6, outcome: "inPlay", fouls: [{ penalty: "offensiveHolding", by: "defense", spot: 77 }], end: { spot: 72, possession: "defense" }, detail: { participants: { kicker: "H-K1", returner: "A-S1", tackler: "H-LB2", foulers: ["A-LB2"] }, class: "returned" } },
    { spot: 18 },
  ),
  penalty: { kind: "accept", foul: 0 },
};

export const KR_DEEP: PlayEvent = kick({ seconds: 6, outcome: "inPlay", end: { spot: 70, possession: "defense" }, detail: { participants: { kicker: "H-K1", returner: "A-RB1", tackler: "H-S2" }, class: "returned" } }, { spot: 30 });

// ---------------------------------------------------------------- no return (KR8)

export const KO_FAIR: PlayEvent = kick({ seconds: 0, outcome: "fairCatch", end: { spot: 75, possession: "defense" }, detail: { participants: { kicker: "H-K1", returner: "A-S1" }, class: "fairCatch" } }, { spot: 25 });

export const KO_OOB: PlayEvent = kick({ seconds: 0, outcome: "outOfBounds", landingSpot: 88, detail: { participants: { kicker: "H-K1" }, class: "outOfBounds" } }, { spot: 40 });

export const KO_SHORT: PlayEvent = kick({ seconds: 0, outcome: "short", landingSpot: 85, detail: { participants: { kicker: "H-K1" }, class: "short" } }, { spot: 20 });

export const ONSIDE_KICKERS: PlayEvent = {
  ...KICKOFF_RETURN,
  play: { kind: "onsideKick", seconds: 3, outcome: "inPlay", end: { spot: 46, possession: "offense" }, detail: { ...baseDetail, onField: KICKOFF_UNIT, participants: { kicker: "H-K1", fumbleRecoverer: "H-LB1" }, class: "onsideRecovered" } } as PlayResult,
  after: { ...KICKOFF_RETURN.after, possession: "home", spot: 46 },
};

export const ONSIDE_RECEIVERS: PlayEvent = {
  ...KICKOFF_RETURN,
  play: { kind: "onsideKick", seconds: 3, outcome: "inPlay", end: { spot: 47, possession: "defense" }, detail: { ...baseDetail, onField: KICKOFF_UNIT, participants: { kicker: "H-K1", fumbleRecoverer: "A-WR1" }, class: "onsideFailed" } } as PlayResult,
  after: { ...KICKOFF_RETURN.after, spot: 53 },
};
