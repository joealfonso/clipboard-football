// Calling screen pass U2 (docs/specs/m2-calling-screen-pass.md): the Last play card's result line
// names players with jersey numbers from detail.participants only, in the role the sentence gives
// them (RL1), drops exactly the phrase of a role the engine didn't name (RL2), shows punt return
// yards only when the spots agree and never kickoff return yards (RL3), and the card carries the
// calls line and the why headline for every play (RL4).

import { beforeAll, describe, expect, it } from "vitest";
import { whyHeadline } from "../src/engine/headline";
import { readDetail, type ParticipantRole, type PlayEvent } from "../src/engine/types";
import { callsLine, playerRef, playResultText, resultHead, type TextCtx } from "../src/ui/text";
import { appHarness, appLabels, installFakeDom, type FakeEl } from "./fake-dom";
import { COMPLETE, FALSE_START, FAIR_CATCH, FIELD_GOAL_GOOD, FUMBLE_LOST, HOLDING_ON_RUN, INCOMPLETE, INTERCEPTION, KICKOFF_RETURN, KICKOFF_TOUCHBACK, KNEEL, PUNT_RETURNED, RUN, SACK, STANDOUT_RUN, snap } from "./fixtures";
import { ctxOf, simGames } from "./sim-games";

const GAMES = 200;
const labels = appLabels();

// ---------------------------------------------------------------- RL1: names map to participants, in role

/** The roles a name may hold, from the words around it in the sentence. */
function rolesAt(line: string, start: number, end: number): readonly (ParticipantRole | "foulers")[] | null {
  const before = line.slice(0, start);
  const after = line.slice(end);
  const pre = (s: string): boolean => before.endsWith(s);
  const post = (s: string): boolean => after.startsWith(s);
  if (pre("tackled by ")) return ["tackler"];
  if (pre("intercepted by ")) return ["interceptor"];
  if (pre("sacked by ")) return ["sacker"];
  if (pre("forced by ")) return ["fumbleForcer"];
  if (pre("recovered by ")) return ["fumbleRecoverer"];
  if (pre("intended for ")) return ["target"];
  if (pre("Punt by ")) return ["punter"];
  if (pre("Kickoff by ") || pre("Onside kick by ") || pre("field goal by ") || pre("Extra point by ")) return ["kicker"];
  if (pre("fair catch by ")) return ["returner"];
  if (pre(" on ") && post(" (")) return ["foulers"];
  if (pre(" to ") && post(" for ")) return ["receiver", "target"];
  if (post(" returns it")) return ["returner"];
  if (post(" runs ")) return ["ballCarrier"];
  if (post(" scrambles ") || post(" kneels")) return ["ballCarrier", "passer"];
  if (post(" sacked") || post(" incomplete") || post(" intercepted") || post(" to ") || post(" complete ") || post(" spikes")) return ["passer", "ballCarrier"];
  return null;
}

function refsIn(line: string, ctx: TextCtx): { ref: string; ids: string[]; start: number; end: number }[] {
  const byRef = new Map<string, string[]>();
  for (const id of ctx.players.keys()) {
    const r = playerRef(id, ctx) as string;
    byRef.set(r, [...(byRef.get(r) ?? []), id]);
  }
  const out: { ref: string; ids: string[]; start: number; end: number }[] = [];
  for (const m of line.matchAll(/#\d+ /g)) {
    // The longest ref that starts here and ends at a word boundary.
    const at = m.index;
    let best: { ref: string; ids: string[] } | null = null;
    for (const [ref, ids] of byRef) if (line.startsWith(ref, at) && /^($|[,.() ])/.test(line.slice(at + ref.length)) && (best === null || ref.length > best.ref.length)) best = { ref, ids };
    out.push(best === null ? { ref: line.slice(at, at + 12), ids: [], start: at, end: at } : { ...best, start: at, end: at + best.ref.length });
  }
  return out;
}

describe(`RL1: over every play of ${GAMES} simulated games, every "#nn Name" is a participant in the role the sentence gives`, () => {
  it("each name maps to an id the event credits in that role", { timeout: 600_000 }, () => {
    let named = 0;
    for (const g of simGames(GAMES)) {
      const ctx = ctxOf(g, labels);
      for (const ev of g.plays) {
        const line = playResultText(ev, ctx);
        const p = readDetail(ev.play).participants ?? {};
        for (const r of refsIn(line, ctx)) {
          expect(r.ids.length, `seed ${g.seed}: unknown name at "${line.slice(r.start)}"`).toBeGreaterThan(0);
          const roles = rolesAt(line, r.start, r.end);
          expect(roles, `seed ${g.seed}: no role for ${r.ref} in "${line}"`).not.toBeNull();
          const credited = (roles ?? []).flatMap((role) => (role === "foulers" ? [...(p.foulers ?? [])] : p[role] === undefined ? [] : [p[role] as string]));
          expect(
            r.ids.some((id) => credited.includes(id)),
            `seed ${g.seed}: ${r.ref} as ${(roles ?? []).join("/")} in "${line}"`,
          ).toBe(true);
          named++;
        }
      }
    }
    expect(named).toBeGreaterThan(GAMES * 100);
  });
});

// ---------------------------------------------------------------- RL2: the copy table, each role removed

const SPEC_PLAYERS: ReadonlyMap<string, { name: string; number: number }> = new Map([
  ["H-QB1", { name: "Jalen Pratt", number: 12 }],
  ["H-WR1", { name: "Dami Okafor", number: 81 }],
  ["H-WR2", { name: "Dami Okafor", number: 81 }],
  ["H-WR3", { name: "Tim Wells", number: 19 }],
  ["H-RB1", { name: "Ray Vance", number: 22 }],
  ["H-OL2", { name: "Bo Smith", number: 74 }],
  ["H-OL4", { name: "Bo Smith", number: 74 }],
  ["H-K1", { name: "Abe Kerr", number: 3 }],
  ["H-P1", { name: "Ben Holt", number: 8 }],
  ["H-LB1", { name: "Sam Park", number: 50 }],
  ["H-LB2", { name: "Finn Ng", number: 44 }],
  ["A-CB1", { name: "Max Cole", number: 90 }],
  ["A-CB2", { name: "Kei Moss", number: 24 }],
  ["A-LB1", { name: "Tomas Ruiz", number: 54 }],
  ["A-LB2", { name: "Ari Diaz", number: 55 }],
  ["A-DL2", { name: "Lio Ode", number: 91 }],
  ["A-S1", { name: "Cal Hale", number: 31 }],
  ["A-S2", { name: "Cal Hale", number: 31 }],
  ["A-WR1", { name: "Jo Day", number: 23 }],
]);
const ctx: TextCtx = {
  human: "home",
  teams: { home: { name: "Riverbend Pilots", nickname: "Pilots" }, away: { name: "Harborview Cranes", nickname: "Cranes" } },
  players: SPEC_PLAYERS,
  labels: { falseStart: "False start", offensiveHolding: "Holding" },
  regulationPeriods: 4,
  endZoneYards: 10,
};

const withParts = (ev: PlayEvent, parts: Record<string, unknown>, extra: Record<string, unknown> = {}): PlayEvent => ({ ...ev, play: { ...ev.play, detail: { ...(ev.play.detail ?? {}), participants: parts, ...extra } } as PlayEvent["play"] });
const partsOf = (ev: PlayEvent): Record<string, unknown> => ({ ...(readDetail(ev.play).participants ?? {}) });

const SCRAMBLE: PlayEvent = { ...RUN, play: { ...RUN.play, kind: "scramble", detail: { ...(RUN.play.detail ?? {}), participants: { ballCarrier: "H-QB1", tackler: "A-LB1" }, yards: 6 } } as PlayEvent["play"] };
const SPIKE: PlayEvent = { ...KNEEL, play: { ...KNEEL.play, kind: "spike", detail: { ...(KNEEL.play.detail ?? {}), participants: { passer: "H-QB1" } } } as PlayEvent["play"] };
const PUNT_DOWNED: PlayEvent = withParts({ ...FAIR_CATCH, play: { ...FAIR_CATCH.play, fairCatch: false } as PlayEvent["play"] }, { punter: "H-P1" }, { class: "downedLong", gross: 51 });
const PUNT_TOUCHBACK: PlayEvent = withParts({ ...FAIR_CATCH, play: { ...FAIR_CATCH.play, end: { spot: 110, possession: "defense" } } as PlayEvent["play"] }, { punter: "H-P1" }, { class: "touchback", gross: 52 });
const KICKOFF_FAIR: PlayEvent = withParts({ ...KICKOFF_RETURN, play: { ...KICKOFF_RETURN.play, outcome: "fairCatch", end: { spot: 78, possession: "defense" } } as PlayEvent["play"] }, { kicker: "H-K1", returner: "A-S1" }, { class: "fairCatch" });
const ONSIDE: PlayEvent = {
  ...withParts({ ...KICKOFF_RETURN, play: { kind: "onsideKick", seconds: 3, outcome: "inPlay", end: { spot: 46, possession: "offense" }, detail: KICKOFF_RETURN.play.detail } as PlayEvent["play"] }, { kicker: "H-K1" }, { class: "onsideRecovered" }),
  after: snap({ possession: "home", spot: 46, down: 1, distance: 10 }),
};
const EXTRA_POINT: PlayEvent = {
  ...withParts({ ...FIELD_GOAL_GOOD, play: { kind: "extraPoint", seconds: 0, good: false, detail: FIELD_GOAL_GOOD.play.detail } as PlayEvent["play"] }, { kicker: "H-K1" }),
  before: snap({ phase: "try", spot: 85 }),
  after: snap({ phase: "kickoff", spot: 35 }),
};
const TWO_POINT: PlayEvent = {
  ...withParts({ ...RUN, play: { kind: "twoPoint", seconds: 4, end: { spot: 100, possession: "offense" }, detail: RUN.play.detail } as PlayEvent["play"] }, { ballCarrier: "H-RB1", tackler: "A-LB1" }),
  before: snap({ phase: "try", spot: 98, score: { home: 13, away: 3 } }),
  after: snap({ phase: "kickoff", spot: 35, score: { home: 15, away: 3 } }),
};

/** [the copy table's row, the event, the sentence with every role present] (U2 Copy; names from SPEC_PLAYERS). */
const TABLE: readonly [string, PlayEvent, string][] = [
  ["Run", RUN, "#22 R. Vance runs for 4, tackled by #54 T. Ruiz."],
  ["Scramble", SCRAMBLE, "#12 J. Pratt scrambles for 6, tackled by #54 T. Ruiz."],
  ["Sack", SACK, "#12 J. Pratt sacked by #91 L. Ode for a loss of 7."],
  ["Pass complete", COMPLETE, "#12 J. Pratt to #81 D. Okafor for 7, tackled by #24 K. Moss."],
  ["Pass incomplete", INCOMPLETE, "#12 J. Pratt incomplete, intended for #81 D. Okafor."],
  ["Interception", INTERCEPTION, "#12 J. Pratt intercepted by #31 C. Hale, returned to OPP 48, tackled by #19 T. Wells."],
  ["Fumble", FUMBLE_LOST, "#22 R. Vance runs for 5, fumble forced by #55 A. Diaz, recovered by #90 M. Cole (Cranes)."],
  ["Kneel", KNEEL, "#12 J. Pratt kneels."],
  ["Spike", SPIKE, "#12 J. Pratt spikes it, clock stopped."],
  ["Kickoff, returned", KICKOFF_RETURN, "Kickoff by #3 A. Kerr. #31 C. Hale returns it to OPP 28, tackled by #44 F. Ng."],
  ["Kickoff, touchback", KICKOFF_TOUCHBACK, "Kickoff by #3 A. Kerr, touchback."],
  ["Kickoff, fair catch", KICKOFF_FAIR, "Kickoff by #3 A. Kerr, fair catch by #31 C. Hale at OPP 22."],
  ["Onside kick", ONSIDE, "Onside kick by #3 A. Kerr, recovered by the Pilots at OWN 46."],
  ["Punt, returned", PUNT_RETURNED, "Punt by #8 B. Holt, 45 yards. #23 J. Day returns it 5 yards to OPP 20, tackled by #50 S. Park."],
  ["Punt, fair catch", FAIR_CATCH, "Punt by #8 B. Holt, 48 yards, fair catch by #23 J. Day at OPP 12."],
  ["Punt, touchback", PUNT_TOUCHBACK, "Punt by #8 B. Holt, 52 yards, touchback."],
  ["Punt, downed", PUNT_DOWNED, "Punt by #8 B. Holt, 51 yards, downed at OPP 12."],
  ["Field goal", FIELD_GOAL_GOOD, "47-yard field goal by #3 A. Kerr is good."],
  ["Extra point", EXTRA_POINT, "Extra point by #3 A. Kerr is no good."],
  ["Two-point try", TWO_POINT, "#22 R. Vance runs for 2, tackled by #54 T. Ruiz. Two-point try is good."],
  ["No play", FALSE_START, "Flag before the snap: false start on #74 B. Smith (Pilots)."],
  ["Penalty sentence", HOLDING_ON_RUN, "#22 R. Vance runs for 10, tackled by #31 C. Hale. Flag: holding on #74 B. Smith (Pilots), accepted."],
  ["Standout", STANDOUT_RUN, "Standout: #22 R. Vance runs for 48, tackled by #31 C. Hale."],
];

describe("RL2: every row of the copy table, with every role present and with each role removed in turn", () => {
  it.each(TABLE.map(([row, ev, want]) => [row, ev, want] as const))("%s", (_row, ev, want) => {
    expect(playResultText(ev, ctx)).toBe(want);
    const parts = partsOf(ev);
    for (const role of Object.keys(parts)) {
      const removedIds = role === "foulers" ? (parts["foulers"] as string[]) : [parts[role] as string];
      const rest = { ...parts };
      delete rest[role];
      const line = playResultText(withParts(ev, rest), ctx);
      const removedRefs = removedIds.map((id) => playerRef(id, ctx) as string);
      const keptIds = Object.entries(rest).flatMap(([, v]) => (Array.isArray(v) ? (v as string[]) : [v as string]));
      // The removed role's name is gone, unless the same player still holds another role the sentence reads.
      for (const [i, ref] of removedRefs.entries()) if (!keptIds.includes(removedIds[i] as string)) expect(line, `${role} removed`).not.toContain(ref);
      // Every other name the full sentence had is still there, and nothing is filled in.
      for (const id of keptIds) {
        // A player who held the removed role too (the sacker is also the tackler) may drop out with it.
        if (removedIds.includes(id)) continue;
        const r = playerRef(id, ctx) as string;
        if (want.includes(r)) expect(line, `${role} removed, ${id} kept`).toContain(r);
      }
      expect(line, `${role} removed`).not.toMatch(/undefined| {2}|\s,|,\s*\.|by\s*\.|by\s*,/);
    }
  });

  it("a role whose player is in neither pool is left out", () => {
    expect(playResultText(withParts(RUN, { ballCarrier: "nobody-1", tackler: "A-LB1" }), ctx)).toBe("Run for 4, tackled by #54 T. Ruiz.");
  });
});

// ---------------------------------------------------------------- RL3: return yards

describe("RL3: punt return yards only when the spots agree; never kickoff return yards", () => {
  it("before.spot + gross - returnYards == end.spot shows the yards", () => {
    // PUNT_RETURNED: 40 + 45 - 5 = 80.
    expect(playResultText(PUNT_RETURNED, ctx)).toContain("returns it 5 yards to OPP 20");
  });

  it("a clamped spot shows the spot only", () => {
    const clamped = withParts(PUNT_RETURNED, partsOf(PUNT_RETURNED), { returnYards: 9 });
    const line = playResultText(clamped, ctx);
    expect(line).toContain("returns it to OPP 20");
    expect(line).not.toMatch(/returns it \d+ yards?/);
  });

  it(`over ${GAMES} simulated games no kickoff sentence has yards after "returns it", and every punt's yards agree with the spots`, { timeout: 600_000 }, () => {
    for (const g of simGames(GAMES)) {
      const c = ctxOf(g, labels);
      for (const ev of g.plays) {
        const line = playResultText(ev, c);
        if (ev.play.kind === "kickoff" || ev.play.kind === "onsideKick") expect(line, line).not.toMatch(/returns it[^.]*yard/);
        if (ev.play.kind === "punt") {
          const m = /returns it (\d+) yards?/.exec(line);
          if (m !== null && "end" in ev.play) {
            const d = readDetail(ev.play);
            expect(ev.before.spot + (d.gross ?? NaN) - Number(m[1])).toBe(ev.play.end.spot);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------- RL4: the card's calls and why lines

describe("RL4: the Last play card shows the calls line and the why headline for every play", () => {
  beforeAll(() => installFakeDom(1280, 720));

  it(`on every play of ${GAMES / 10} simulated games, the card's why equals whyHeadline and has no "x" + digit`, { timeout: 600_000 }, () => {
    for (const g of simGames(GAMES / 10)) {
      const h = appHarness({ matchup: g.matchup, human: g.human });
      const c = ctxOf(g, labels);
      for (const ev of g.plays) {
        h.call("setPlayText", h.game, ev);
        const card = h.call<FakeEl>("lastPlayCard", h.game, false);
        expect(card.querySelector(".result")?.textContent).toBe(playResultText(ev, c));
        expect(card.querySelector(".calls")?.textContent).toBe(callsLine(ev, c));
        const why = card.querySelector(".why-line")?.textContent ?? "";
        expect(why).toBe(whyHeadline(ev.play, ev.standout) ?? "No explanation for this play.");
        expect(why).not.toMatch(/x\d/);
        expect(card.textContent).toContain("Details");
        // The compact card: the label, the result's first sentence, the hint.
        const compact = h.call<FakeEl>("lastPlayCard", h.game, true);
        expect(compact.querySelector(".result")?.textContent).toBe(resultHead(ev, c));
        expect(compact.querySelector(".calls")).toBeNull();
      }
    }
  });

  it('no plays yet: "No plays yet."', () => {
    const g = simGames(1)[0] as (ReturnType<typeof simGames>)[number];
    const h = appHarness({ matchup: g.matchup, human: g.human });
    expect(h.call<FakeEl>("lastPlayCard", h.game, false).textContent).toContain("No plays yet.");
  });

  it("the card's result line drops the next-situation tail the plate already shows", () => {
    expect(playResultText(RUN, ctx)).not.toMatch(/ball, /);
  });
});
