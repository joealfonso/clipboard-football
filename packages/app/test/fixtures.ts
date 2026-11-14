// PlayResult fixtures shaped exactly like docs/specs/m2-engine-and-game-loop.md: `detail` carries
// `participants` (player ids by role, absent roles left out), `onField` (both sides by slot), the
// step 4 `why` and `trace`, and a `headline` (milestone D). Used where the M1 engine doesn't yet
// name players.

import type { PlayResult } from "@clipboard-football/shared";
import type { OnField, OnFieldSlot, Participants, PlayEvent, Snapshot } from "../src/engine/types";

const slots = (prefix: string, spec: readonly [string, number][]): OnFieldSlot[] =>
  spec.flatMap(([pos, n]) => Array.from({ length: n }, (_, i) => ({ slot: `${pos}${i + 1}`, position: pos as OnFieldSlot["position"], id: `${prefix}-${pos}${i + 1}` })));

/** Shotgun against Nickel: home has the ball. */
export const SHOTGUN_VS_NICKEL: OnField = {
  offense: slots("H", [["QB", 1], ["RB", 1], ["WR", 3], ["TE", 1], ["OL", 5]]),
  defense: slots("A", [["DL", 4], ["LB", 2], ["CB", 3], ["S", 2]]),
};

export const PUNT_UNIT: OnField = {
  offense: slots("H", [["P", 1], ["OL", 5], ["TE", 2], ["LB", 2], ["S", 1]]),
  defense: slots("A", [["DL", 4], ["LB", 3], ["CB", 2], ["S", 2]]),
};

export const KICKOFF_UNIT: OnField = {
  offense: slots("H", [["K", 1], ["LB", 4], ["S", 3], ["CB", 3]]),
  defense: slots("A", [["DL", 4], ["LB", 3], ["CB", 2], ["S", 2]]),
};

export const FG_UNIT: OnField = {
  offense: slots("H", [["K", 1], ["P", 1], ["OL", 6], ["TE", 3]]),
  defense: slots("A", [["DL", 4], ["LB", 3], ["CB", 2], ["S", 2]]),
};

export function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    period: 1,
    clock: 600,
    phase: "scrimmage",
    possession: "home",
    spot: 40,
    down: 2,
    distance: 7,
    goalToGo: false,
    score: { home: 7, away: 3 },
    timeouts: { home: 3, away: 3 },
    clockRunning: true,
    safetyKick: false,
    ...over,
  };
}

const why = { why: "A short pass for a short completion, a common result in this situation (55%).", headline: "A short completion, a common result here.", trace: [{ factor: "class", name: "c1_9", label: "a short completion", basePct: 52, pct: 55 }] };

function ev(play: PlayResult, over: { before?: Partial<Snapshot>; after?: Partial<Snapshot>; offense?: PlayEvent["offense"]; defense?: string | null } = {}): PlayEvent {
  const before = snap(over.before);
  return {
    t: "play",
    before,
    offense: over.offense ?? { call: "shortPass", formation: "shotgun" },
    defense: over.defense === undefined ? "nickelCover3" : over.defense,
    play,
    penalty: null,
    runoffTimeout: false,
    after: snap({ ...over.before, ...over.after }),
  };
}

const detail = (participants: Participants, onField: OnField, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ ...why, participants, onField, ...extra });

export const COMPLETE: PlayEvent = ev(
  { kind: "pass", seconds: 6, end: { spot: 47, possession: "offense" }, detail: detail({ passer: "H-QB1", target: "H-WR2", receiver: "H-WR2", tackler: "A-CB2" }, SHOTGUN_VS_NICKEL, { yards: 7, class: "c1_9" }) },
  { after: { spot: 47, down: 1, distance: 10 } },
);

export const INCOMPLETE: PlayEvent = ev({ kind: "pass", seconds: 5, incomplete: true, end: { spot: 40, possession: "offense" }, detail: detail({ passer: "H-QB1", target: "H-WR1" }, SHOTGUN_VS_NICKEL, { class: "inc" }) }, { offense: { call: "deepPass", formation: "shotgun" }, after: { down: 3 } });

export const INTERCEPTION: PlayEvent = ev(
  { kind: "pass", seconds: 8, turnover: "interception", end: { spot: 52, possession: "defense" }, detail: detail({ passer: "H-QB1", target: "H-WR3", interceptor: "A-S1", tackler: "H-WR3" }, SHOTGUN_VS_NICKEL, { class: "int" }) },
  { offense: { call: "intermediatePass", formation: "shotgun" }, after: { possession: "away", spot: 48, down: 1, distance: 10 } },
);

export const RUN: PlayEvent = ev(
  { kind: "run", seconds: 5, end: { spot: 44, possession: "offense" }, detail: detail({ ballCarrier: "H-RB1", tackler: "A-LB1" }, SHOTGUN_VS_NICKEL, { yards: 4, class: "r4_9" }) },
  { offense: { call: "insideRun", formation: "shotgun" }, after: { spot: 44, down: 3, distance: 3 } },
);

export const RUN_OUT_OF_BOUNDS: PlayEvent = ev(
  { kind: "run", seconds: 6, outOfBounds: true, end: { spot: 52, possession: "offense" }, detail: detail({ ballCarrier: "H-RB1" }, SHOTGUN_VS_NICKEL, { yards: 12 }) },
  { offense: { call: "outsideRun", formation: "shotgun" }, after: { spot: 52, down: 1, distance: 10 } },
);

export const TOUCHDOWN: PlayEvent = ev(
  { kind: "run", seconds: 9, touchdown: true, end: { spot: 100, possession: "offense" }, detail: detail({ ballCarrier: "H-RB1" }, SHOTGUN_VS_NICKEL, { yards: 60 }) },
  { offense: { call: "outsideRun", formation: "shotgun" }, after: { phase: "try", spot: 98, down: 0, distance: 0, score: { home: 13, away: 3 }, clockRunning: false } },
);

export const SACK: PlayEvent = ev(
  { kind: "sack", seconds: 5, end: { spot: 33, possession: "offense" }, detail: detail({ passer: "H-QB1", sacker: "A-DL2", tackler: "A-DL2" }, SHOTGUN_VS_NICKEL, { yards: -7, class: "sack" }) },
  { after: { spot: 33, down: 3, distance: 14 } },
);

export const FUMBLE_LOST: PlayEvent = ev(
  { kind: "run", seconds: 6, turnover: "fumble", end: { spot: 45, possession: "defense" }, detail: detail({ ballCarrier: "H-RB1", fumbleForcer: "A-LB2", fumbleRecoverer: "A-CB1" }, SHOTGUN_VS_NICKEL, { class: "fumble" }) },
  { offense: { call: "insideRun", formation: "shotgun" }, after: { possession: "away", spot: 55, down: 1, distance: 10 } },
);

export const PUNT_RETURNED: PlayEvent = ev(
  { kind: "punt", seconds: 10, crossedLine: true, touchedByReceivers: true, end: { spot: 80, possession: "defense" }, detail: detail({ punter: "H-P1", returner: "A-S2", tackler: "H-LB1" }, PUNT_UNIT, { gross: 45, returnYards: 5, class: "returnedShort" }) },
  { offense: { call: "punt" }, defense: null, before: { down: 4 }, after: { possession: "away", spot: 20, down: 1, distance: 10 } },
);

export const FAIR_CATCH: PlayEvent = ev(
  { kind: "punt", seconds: 7, crossedLine: true, touchedByReceivers: false, fairCatch: true, end: { spot: 88, possession: "defense" }, detail: detail({ punter: "H-P1", returner: "A-S2" }, PUNT_UNIT, { gross: 48, class: "fairCatchShort" }) },
  { offense: { call: "punt" }, defense: null, before: { down: 4 }, after: { possession: "away", spot: 12, down: 1, distance: 10 } },
);

export const FIELD_GOAL_GOOD: PlayEvent = ev(
  { kind: "fieldGoal", seconds: 4, good: true, kickSpot: 63, detail: detail({ kicker: "H-K1" }, FG_UNIT, { distance: 47, class: "good" }) },
  { offense: { call: "fieldGoal" }, defense: null, before: { spot: 70, down: 4 }, after: { phase: "kickoff", spot: 35, down: 0, distance: 0, score: { home: 10, away: 3 } } },
);

export const FIELD_GOAL_MISS: PlayEvent = ev(
  { kind: "fieldGoal", seconds: 4, good: false, kickSpot: 55, detail: detail({ kicker: "H-K1" }, FG_UNIT, { distance: 55, class: "miss" }) },
  { offense: { call: "fieldGoal" }, defense: null, before: { spot: 62, down: 4 }, after: { possession: "away", spot: 45, down: 1, distance: 10 } },
);

export const KICKOFF_TOUCHBACK: PlayEvent = ev(
  { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone", detail: detail({ kicker: "H-K1" }, KICKOFF_UNIT, { class: "touchbackEndZone" }) },
  { offense: { call: "kickoff" }, defense: null, before: { phase: "kickoff", spot: 35, down: 0, distance: 0 }, after: { possession: "away", spot: 35, down: 1, distance: 10 } },
);

export const KICKOFF_RETURN: PlayEvent = ev(
  { kind: "kickoff", seconds: 6, outcome: "inPlay", end: { spot: 72, possession: "defense" }, detail: detail({ kicker: "H-K1", returner: "A-S1", tackler: "H-LB2" }, KICKOFF_UNIT, { class: "returned" }) },
  { offense: { call: "kickoff" }, defense: null, before: { phase: "kickoff", spot: 35, down: 0, distance: 0 }, after: { possession: "away", spot: 28, down: 1, distance: 10 } },
);

export const FALSE_START: PlayEvent = {
  ...ev({ kind: "noPlay", seconds: 0, fouls: [{ penalty: "falseStart", by: "offense" }], detail: detail({ foulers: ["H-OL2"] }, SHOTGUN_VS_NICKEL) }, { after: { spot: 35, distance: 12 } }),
  penalty: { kind: "accept", foul: 0 },
};

export const HOLDING_ON_RUN: PlayEvent = {
  ...ev(
    { kind: "run", seconds: 5, fouls: [{ penalty: "offensiveHolding", by: "offense", spot: 42 }], end: { spot: 50, possession: "offense" }, detail: detail({ ballCarrier: "H-RB1", tackler: "A-S1", foulers: ["H-OL4"] }, SHOTGUN_VS_NICKEL, { yards: 10 }) },
    { offense: { call: "insideRun", formation: "shotgun" }, after: { spot: 30, distance: 17 } },
  ),
  penalty: { kind: "accept", foul: 0 },
};

export const KNEEL: PlayEvent = ev(
  { kind: "kneel", seconds: 40, end: { spot: 39, possession: "offense" }, detail: detail({ ballCarrier: "H-QB1" }, SHOTGUN_VS_NICKEL) },
  { offense: { call: "kneel" }, defense: null, after: { spot: 39, down: 3, distance: 8 } },
);

/** A pass with no participants at all: what the M1 engine produces today. */
export const UNNAMED_COMPLETE: PlayEvent = ev({ kind: "pass", seconds: 6, end: { spot: 52, possession: "offense" }, detail: { ...why, onField: SHOTGUN_VS_NICKEL, yards: 12 } }, { after: { spot: 52, down: 1, distance: 10 } });

/** A standout entry (milestone F hook) on a breakaway run. */
export const STANDOUT_RUN: PlayEvent = ev(
  {
    kind: "run",
    seconds: 9,
    end: { spot: 88, possession: "offense" },
    detail: detail({ ballCarrier: "H-RB1", tackler: "A-S2" }, SHOTGUN_VS_NICKEL, { yards: 48, standout: { player: "H-RB1", number: 22, rating: "speed", value: 94, kind: "breakawayRun", multiplier: 1.4 } }),
  },
  { offense: { call: "outsideRun", formation: "shotgun" }, after: { spot: 88, down: 1, distance: 10 } },
);

export const ALL_FIXTURES: Readonly<Record<string, PlayEvent>> = {
  COMPLETE,
  INCOMPLETE,
  INTERCEPTION,
  RUN,
  RUN_OUT_OF_BOUNDS,
  TOUCHDOWN,
  SACK,
  FUMBLE_LOST,
  PUNT_RETURNED,
  FAIR_CATCH,
  FIELD_GOAL_GOOD,
  FIELD_GOAL_MISS,
  KICKOFF_TOUCHBACK,
  KICKOFF_RETURN,
  FALSE_START,
  HOLDING_ON_RUN,
  KNEEL,
  UNNAMED_COMPLETE,
  STANDOUT_RUN,
};

/** Names and numbers for every fixture player. */
export function fixturePlayers(): Map<string, { name: string; number: number }> {
  const m = new Map<string, { name: string; number: number }>();
  let n = 1;
  for (const f of [SHOTGUN_VS_NICKEL, PUNT_UNIT, KICKOFF_UNIT, FG_UNIT]) for (const s of [...f.offense, ...f.defense]) if (!m.has(s.id)) m.set(s.id, { name: `Pat ${s.slot}`, number: n++ % 100 });
  return m;
}
