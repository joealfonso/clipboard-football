// Engineer's checks for the re-review flag on fx.firstDown: with the play, "the ball itself reached
// the line" is read from the play result's own end spot, before any foul enforced after the down.

import { describe, expect, it } from "vitest";
import { newFirstDown, playEnd, type DownState } from "../src/ui/topbar";

const ds = (o: Partial<DownState>): DownState => ({ phase: "scrimmage", possession: "home", spot: 30, down: 1, distance: 10, goalToGo: false, ...o });

describe("newFirstDown with the play: the play's own end spot decides the reach", () => {
  it("a short gain carried over the line by a foul enforced after the down is not a first down (penalty alone)", () => {
    // 3rd & 8 at 30, a 4-yard gain to 34, then 15 yards from the end of the run: 1st & 10 at 49.
    expect(newFirstDown(ds({ down: 3, distance: 8 }), ds({ spot: 49 }), { kind: "run", stood: true, endSpot: 34 })).toBe(false);
  });

  it("a gain that reached the line still flashes when a foul after the down moves the ball back", () => {
    // 3rd & 8 at 30, a 12-yard gain to 42, then 10 yards back from there: 1st & 10 at 32.
    expect(newFirstDown(ds({ down: 3, distance: 8 }), ds({ spot: 32 }), { kind: "pass", stood: true, endSpot: 42 })).toBe(true);
  });

  it("no end spot (the offense lost the ball, or no end) is never a first down", () => {
    expect(newFirstDown(ds({ down: 3, distance: 8 }), ds({ spot: 40 }), { kind: "pass", stood: true, endSpot: null })).toBe(false);
  });

  it("playEnd: the play result's end spot only when the offense kept the ball", () => {
    expect(playEnd({ end: { spot: 42, possession: "offense" } })).toBe(42);
    expect(playEnd({ end: { spot: 42, possession: "defense" } })).toBeNull();
    expect(playEnd({})).toBeNull();
  });
});
