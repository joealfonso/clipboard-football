// Calling spec K5 (no call screen scrolls), as the final review measured it: at 1280x720 the
// Formation screen's two rows of cards ran past the legend, "Esc Back" under it. callCardFit shrinks
// the card art, or falls back to the text rows when even CARD_ART_MIN doesn't fit. The heights are
// the real ones, measured by the engineer in the dev build (Chromium, 100% text, 2026-11-15;
// docs/PERF.md): the call column 576 px wide holds 3 cards of 170 px.

import { describe, expect, it } from "vitest";
import { CARD_ART_MIN, callCardFit } from "../src/ui/layout";

const M = {
  cardsRow1280: 430,
  cardsRow1024: 310,
  /** Full art at 170 px wide (max 120). */
  art: 119,
  /** A formation card around its art: label, personnel line, padding (124 px with 57 px art). */
  formationCardRest: 124 - 57,
  /** A run play card around its art (163 px with 119 px art, no personnel line). */
  playCardRest: 163 - 119,
  /** Between two rows of cards: 175 - 44 - 124. */
  cardRowGap: 7,
  row: 48,
  /** The call card around its cards and the Back row: heading, padding, margins, status (405 - 2 x 124 - 7 - 48). */
  cardsChrome: 405 - 2 * 124 - 7 - 48,
  tightRow: 42,
  tightRowGap: 4,
  rowGap: 6,
  /** Around a text-row list: 435 - 6 rows of 48 and 5 gaps of 6. */
  rowsChrome: 435 - (6 * 48 + 5 * 6),
  /** The same, tight, empty status: 334 - 6 rows of 42 and 5 gaps of 4. */
  tightChrome: 334 - (6 * 42 + 5 * 4),
};
const cardsHeight = (cardRows: number, rest: number, art: number): number => M.cardsChrome + cardRows * (rest + art) + (cardRows - 1) * M.cardRowGap + M.row;
const rowsHeight = (n: number, tight: boolean): number => (tight ? M.tightChrome + n * M.tightRow + (n - 1) * M.tightRowGap : M.rowsChrome + n * M.row + (n - 1) * M.rowGap);

describe("K5 at 1280x720 with the measured card and row heights", () => {
  it("one row of cards (3 run plays) fits with full art", () => {
    expect(callCardFit(cardsHeight(1, M.playCardRest, M.art) - M.cardsRow1280, 1, M.art)).toBeNull();
  });

  it("two rows of formation cards run past at full art; the art shrinks, not below CARD_ART_MIN, and then they fit", () => {
    const over = cardsHeight(2, M.formationCardRest, M.art) - M.cardsRow1280;
    expect(over, "the review's case: Back under the legend").toBeGreaterThan(0);
    const fit = callCardFit(over, 2, M.art);
    expect(typeof fit).toBe("number");
    expect(fit as number).toBeGreaterThanOrEqual(CARD_ART_MIN);
    expect(cardsHeight(2, M.formationCardRest, fit as number)).toBeLessThanOrEqual(M.cardsRow1280);
  });

  it("when even the smallest art can't fit, text rows", () => {
    expect(callCardFit(200, 2, M.art)).toBe("rows");
    expect(callCardFit(10, 0, M.art)).toBe("rows");
  });

  it("text rows: 6 run 5 px past at full spacing, so the tight spacing applies; 7 fit tight", () => {
    expect(rowsHeight(6, false)).toBeGreaterThan(M.cardsRow1280);
    expect(rowsHeight(6, true)).toBeLessThanOrEqual(M.cardsRow1280);
    expect(rowsHeight(7, true)).toBeLessThanOrEqual(M.cardsRow1280);
  });
});

describe("1024x600: not met (a design call, reported)", () => {
  it("7 and 6 text rows stay taller than the 310 px cards row even with the tight spacing; 4 fit", () => {
    // Recorded so a later change to row heights or the legend shows here.
    expect(rowsHeight(7, true)).toBeGreaterThan(M.cardsRow1024);
    expect(rowsHeight(6, true)).toBeGreaterThan(M.cardsRow1024);
    expect(rowsHeight(4, true)).toBeLessThanOrEqual(M.cardsRow1024);
  });
});
