// Test-writer spec check (A4): the app's event line for a coin toss. The opening toss (period 1)
// reads "Coin toss: ...", an overtime toss "Overtime coin toss: ...".

import { describe, expect, it } from "vitest";
import { eventLine, type TextCtx } from "../src/ui/text";
import type { GameEvent } from "../src/engine/types";
import { fixturePlayers, snap } from "./fixtures";

const ctx: TextCtx = {
  human: "home",
  teams: { home: { name: "Riverbend Pilots", nickname: "Pilots" }, away: { name: "Harborview Lanterns", nickname: "Lanterns" } },
  players: fixturePlayers(),
  labels: {},
  regulationPeriods: 4,
  endZoneYards: 10,
};

const toss = (period: number, winner: "home" | "away", choice: string, receiver: "home" | "away"): GameEvent => ({
  t: "toss",
  before: snap({ period: period === 1 ? 1 : period - 1, phase: period === 1 ? "kickoff" : "overtimeToss" }),
  period,
  winner,
  choice,
  receiver,
});

describe("A4: app coin toss lines", () => {
  it("the opening toss says Coin toss, names the winner, the choice and the receiver", () => {
    const line = eventLine(toss(1, "away", "defer", "home"), ctx);
    expect(line).not.toBeNull();
    expect(line?.startsWith("Coin toss: ")).toBe(true);
    expect(line).not.toMatch(/Overtime/);
    expect(line).toMatch(/Lanterns win/);
    expect(line).toMatch(/defer/);
    expect(line).toMatch(/Pilots receive/);
  });

  it("an overtime toss says Overtime coin toss, for the first and a later overtime period", () => {
    for (const period of [5, 9]) {
      const line = eventLine(toss(period, "home", "receive", "home"), ctx);
      expect(line?.startsWith("Overtime coin toss: "), `period ${period}`).toBe(true);
      expect(line).toMatch(/Pilots win/);
      expect(line).toMatch(/receive/);
    }
  });

  it("uses the event's period, not before.period (opening toss before is period 1, OT toss before is regulation)", () => {
    // A period-1 toss whose snapshot says period 4 is still the opening toss, and vice versa.
    const opening = { ...(toss(1, "home", "receive", "home") as Extract<GameEvent, { t: "toss" }>), before: snap({ period: 4 }) };
    expect(eventLine(opening, ctx)?.startsWith("Coin toss: ")).toBe(true);
    const ot = { ...(toss(5, "home", "receive", "home") as Extract<GameEvent, { t: "toss" }>), before: snap({ period: 1 }) };
    expect(eventLine(ot, ctx)?.startsWith("Overtime coin toss: ")).toBe(true);
  });
});
