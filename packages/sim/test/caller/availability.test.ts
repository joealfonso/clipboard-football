// A5: availability at each boundary.

import { describe, expect, it } from "vitest";
import type { Situation } from "../../../shared/src/types";
import { indexCatalog } from "../../src/caller/availability";
import { loadCallerData } from "./load-data";

const { catalog } = loadCallerData();
const idx = indexCatalog(catalog);

function sit(over: Partial<Situation>): Situation {
  return {
    phase: "scrimmage",
    down: 1,
    yardsToGo: 10,
    yardLine100: 60,
    scoreDiff: 0,
    quarter: 2,
    secondsLeftInHalf: 600,
    secondsLeftInGame: 2400,
    offenseTimeouts: 3,
    defenseTimeouts: 3,
    clockRunning: 0,
    otBothPossessed: 0,
    ...over,
  };
}

describe("availability", () => {
  it.each([1, 2, 3])("kick is unavailable on down %i with 121 s left in the half", (down) => {
    expect(idx.isAvailable("kick", sit({ down, secondsLeftInHalf: 121 }))).toBe(false);
    expect(idx.isAvailable("punt", sit({ down, secondsLeftInHalf: 121 }))).toBe(false);
    expect(idx.isAvailable("fieldGoal", sit({ down, secondsLeftInHalf: 121 }))).toBe(false);
  });

  it.each([1, 2, 3])("kick is available on down %i with 120 s left in either half", (down) => {
    expect(idx.isAvailable("fieldGoal", sit({ down, secondsLeftInHalf: 120 }))).toBe(true);
    expect(idx.isAvailable("punt", sit({ down, quarter: 4, secondsLeftInHalf: 120, secondsLeftInGame: 120 }))).toBe(true);
  });

  it("kick is available on every 4th down", () => {
    for (const s of [1800, 121, 120, 1]) expect(idx.isAvailable("punt", sit({ down: 4, secondsLeftInHalf: s }))).toBe(true);
  });

  it("run and pass are available in every scrimmage and two-point situation", () => {
    const sits = [
      sit({}),
      sit({ down: 4, secondsLeftInHalf: 5 }),
      sit({ phase: "try", yardLine100: 2 }),
      sit({ phase: "try", quarter: 4, secondsLeftInHalf: 3, secondsLeftInGame: 3 }),
    ];
    for (const s of sits) {
      for (const id of ["run", "pass", "insideRun", "outsideRun", "qbSneak", "shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"]) {
        expect(idx.isAvailable(id, s), `${id} ${s.phase}`).toBe(true);
      }
    }
  });

  it("clock calls are available on every scrimmage down and never on a try", () => {
    expect(idx.isAvailable("spike", sit({ down: 4 }))).toBe(true);
    expect(idx.isAvailable("kneel", sit({ secondsLeftInHalf: 1700 }))).toBe(true);
    expect(idx.isAvailable("spike", sit({ phase: "try" }))).toBe(false);
  });

  it("on a try only the try screen, then Run or Pass", () => {
    const t = sit({ phase: "try", down: 4, secondsLeftInHalf: 30 });
    expect(idx.isAvailable("extraPoint", t)).toBe(true);
    expect(idx.isAvailable("goForTwo", t)).toBe(true);
    expect(idx.isAvailable("kick", t)).toBe(false);
    expect(idx.isAvailable("punt", t)).toBe(false);
    expect(idx.isAvailable("clock", t)).toBe(false);
    expect(idx.isAvailable("extraPoint", sit({}))).toBe(false);
  });

  it("lists choice ids in catalog order", () => {
    expect(idx.order.slice(0, 4)).toEqual(["run", "pass", "kick", "clock"]);
  });
});
