// The score bug's fit rule (usability pass U5, DESIGN.md HUD "When the bar is too narrow") and its
// first-down rule (fx.firstDown). Pure, so both can be tested; app.ts applies them.

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

/** The part of a game snapshot the first-down rule reads. */
export interface DownState {
  readonly phase: string;
  readonly possession: string;
  readonly spot: number;
  readonly down: number;
  readonly distance: number;
  readonly goalToGo: boolean;
}

/** What the first-down rule reads of the play itself: its kind, whether it stood (playStood) and where it ended. */
export interface FirstDownPlay {
  readonly kind: string;
  readonly stood: boolean;
  /**
   * The play result's own dead-ball spot in the offense's frame, before any penalty enforcement
   * (playEnd); null when the play has no end or the offense did not keep the ball. Left out, the
   * after state's spot stands in for it (the app always passes it).
   */
  readonly endSpot?: number | null;
}

/** The play result's dead-ball spot when the offense kept the ball (PlayResult end, offense frame), else null. */
export function playEnd(play: object): number | null {
  const end = "end" in play ? (play.end as { readonly spot: number; readonly possession: string } | undefined) : undefined;
  return end !== undefined && end.possession === "offense" ? end.spot : null;
}

/**
 * fx.firstDown in the bug (DESIGN.md Moments, First down: "a new first down for the same team, not
 * a score, not by penalty alone"). The box score's first-down rule (packages/sim loop/box.ts) less
 * its penalty first downs: still in scrimmage with the same team, 1st down after, and the ball
 * itself reached the line to gain. With the play: it must have stood (no accepted foul wiped it out
 * or moved the chains), the reach is read from the play's own end spot, before enforcement (a foul
 * enforced after the down can neither carry a short gain over the line nor pull back a gain that
 * reached it), and a kick never counts (kickers recovering a muffed punt keep the ball
 * without earning a new set of downs). A score is not one either: the next state is the try.
 */
export function newFirstDown(before: DownState, after: DownState, play?: FirstDownPlay): boolean {
  if (before.phase !== "scrimmage" || after.phase !== "scrimmage" || before.possession !== after.possession || after.down !== 1) return false;
  const line = before.spot + before.distance;
  if (play === undefined) return after.spot >= line;
  if (!play.stood || play.kind === "punt" || play.kind === "fieldGoal" || play.endSpot === null) return false;
  return (play.endSpot ?? after.spot) >= line;
}

/** The parts of a play event and the rule set playStood reads (the same fields as the sim's playStands). */
export interface StoodEvent {
  readonly play: { readonly kind: string; readonly fouls?: readonly unknown[] };
  readonly penalty: { readonly kind: string; readonly foul?: number } | null;
}

/**
 * Whether the play counts as run (packages/sim loop/box.ts playStands, from the event's own fields
 * so the UI thread loads no sim code): not a no-play, not offsetting fouls, and any accepted foul is
 * enforced after the down (succeeding spot).
 */
export function playStood(ev: StoodEvent, penalties: Readonly<Record<string, { readonly enforcement: string }>>): boolean {
  if (ev.play.kind === "noPlay") return false;
  const p = ev.penalty;
  if (p === null) return true;
  if (p.kind === "offset") return false;
  if (p.kind !== "accept") return true;
  const foul = (ev.play.fouls ?? [])[p.foul ?? -1] as { readonly penalty?: string } | undefined;
  if (foul === undefined) return true;
  return penalties[foul.penalty ?? ""]?.enforcement === "succeedingSpot";
}
