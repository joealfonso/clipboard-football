// The score bug's fit rule (usability pass U5, DESIGN.md HUD "When the bar is too narrow"). Pure,
// so the order can be tested; app.ts applies it with the bar's real width.

/**
 * Classes added one at a time, cumulatively, while the bar is wider than the window (styles.css
 * says what each hides). DESIGN.md gives the first three; the rest keep score, clock and down and
 * distance to the very last; names, score, clock and down and distance are never cut or hidden.
 */
export const TOP_BAR_FIT_STEPS = [
  "fit-1", // key hint labels
  "fit-2", // the clock state word
  "fit-3", // the key hints
  "fit-4", // the tempo tag
  "fit-5", // the Under 2:00 tag (the clock itself stays signal)
  "fit-6", // the You tag (visually hidden, still read)
  "fit-7", // the bug's type no larger than 100% text
  "fit-8", // the bug's type at 85%, cell padding 8 px
  "fit-9", // team names at 16 px times the bar scale (never cut or hidden)
] as const;

/** Adds steps in order until `overflows()` is false or the steps run out; returns the steps applied. */
export function fitBar(overflows: () => boolean, add: (step: string) => void): string[] {
  const applied: string[] = [];
  for (const step of TOP_BAR_FIT_STEPS) {
    if (!overflows()) break;
    add(step);
    applied.push(step);
  }
  return applied;
}
