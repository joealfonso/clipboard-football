// The game switches screens (Joseph, 2026-11-15; docs/specs/m2-screen-switch.md): while calling,
// the panel fills the window under the top bar and the field is not shown; during the play, the
// field alone; out of a game, placeOverlay as before.

import { describe, expect, it } from "vitest";
import { cameraAt, layoutFor, TOP_BAR } from "../src/ui/layout";
import { CARD_MIN_WINDOW_WIDTH, callingPlacement, gameScreen, overlaysShown, placeOverlay } from "../src/ui/overlay";

const windows: readonly (readonly [number, number])[] = [
  [800, 520],
  [800, 600],
  [1024, 768],
  [1280, 720],
  [1440, 900],
  [1920, 1080],
  [1920, 1600],
];

describe("which screen a game shows", () => {
  it("in a game: calling while it waits on you, the play while animating", () => {
    expect(gameScreen({ inGame: true, animating: false })).toBe("calling");
    expect(gameScreen({ inGame: true, animating: true })).toBe("play");
  });

  it("out of a game (title, pregame, settings): no game screen, so placeOverlay places the menu", () => {
    expect(gameScreen({ inGame: false, animating: false })).toBeNull();
    expect(gameScreen({ inGame: false, animating: true })).toBeNull();
  });

  it("the play screen shows no panel; the calling screen shows it (never both at once with the field)", () => {
    expect(overlaysShown({ animating: true, markCard: false }).panel).toBe(false);
    expect(overlaysShown({ animating: false, markCard: false }).panel).toBe(true);
  });
});

describe("the calling screen fills the window under the top bar", () => {
  it.each(windows)("%ix%i: full width, top bar to the window bottom, filled", (w, h) => {
    const p = callingPlacement(layoutFor(w, h));
    expect(p).toMatchObject({ left: 0, width: w, top: TOP_BAR, maxHeight: h - TOP_BAR, anchor: "top", where: "screen", fill: true });
  });

  it.each(windows)("%ix%i: card art from 1024 wide up, text rows below", (w, h) => {
    expect(callingPlacement(layoutFor(w, h)).compact).toBe(w < CARD_MIN_WINDOW_WIDTH);
  });

  it("menu-mode placement is unchanged: a side column or a centered sheet, never the calling screen", () => {
    for (const [w, h] of windows) {
      const l = layoutFor(w, h);
      const p = placeOverlay(l, cameraAt(40, l.visibleYards), null, 1.4);
      expect(p.where === "side" || p.where === "sheet", `${w}x${h}`).toBe(true);
    }
  });
});
