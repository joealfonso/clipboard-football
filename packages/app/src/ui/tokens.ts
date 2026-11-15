// DESIGN.md's palette tokens. Every color the app draws comes from here (the CSS mirrors them).

export const COLOR = {
  paper: "#F5F2E8",
  paperShade: "#E6E0CF",
  ink: "#22272B",
  inkSoft: "#5C6368",
  line: "#7E837A",
  hash: "#B9B5A8",
  offense: "#005A96",
  defense: "#A84300",
  ball: "#7A4A1E",
  panel: "#1F2A30",
  /** Dividers and bar tracks on panel (1.28:1 on panel: decorative, never the only cue). */
  panelRaise: "#2E3B42",
  chalk: "#F5F2E8",
  chalkSoft: "#A9B3B8",
  signal: "#F2B33D",
} as const;

export const FONT_UI = '"Atkinson Hyperlegible", system-ui, sans-serif';
export const FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';

import { contrast, rgbOf } from "./overlay";

/**
 * PLACEHOLDER team swatch colors (DESIGN.md `team.<id>.color`): data/teams/names.json has no
 * colors yet, so each team gets one of these by its league index until art-director sets them.
 * Eight slots in two lightness tiers and five hue families (docs/specs/m2-usability-pass.md U4).
 * Used only as the swatch beside a team name (spec H3), never on the field.
 */
export const SWATCHES = ["#D9443A", "#6FA8E8", "#3A9A4A", "#C9CED2", "#9A5CC8", "#8CC85A", "#279490", "#F59A8C"] as const;
export type SwatchFamily = "red" | "blue" | "green" | "neutral" | "purple";
/** The hue family of each SWATCHES slot: a matchup never pairs two from one family. */
export const SWATCH_FAMILY: readonly SwatchFamily[] = ["red", "blue", "green", "neutral", "purple", "green", "blue", "red"];
/** The smallest luminance ratio between a matchup's two swatches (designed: holds in grayscale). */
export const SWATCH_MIN_RATIO = 1.4;

const slot = (index: number): number => ((index % SWATCHES.length) + SWATCHES.length) % SWATCHES.length;

export function swatchFor(index: number): string {
  return SWATCHES[slot(index)] as string;
}

/**
 * The two swatches of one matchup: away takes its own slot; home takes the first slot from its
 * own onward that is in a different family from away and at least SWATCH_MIN_RATIO from it.
 */
export function matchupSwatches(awayIndex: number, homeIndex: number): { readonly away: string; readonly home: string } {
  const a = slot(awayIndex);
  const away = SWATCHES[a] as string;
  for (let k = 0; k < SWATCHES.length; k++) {
    const h = slot(homeIndex + k);
    const home = SWATCHES[h] as string;
    if (SWATCH_FAMILY[h] !== SWATCH_FAMILY[a] && contrast(rgbOf(home), rgbOf(away)) >= SWATCH_MIN_RATIO) return { away, home };
  }
  // Unreachable with the set above (layout.test checks all 64 pairs); keeps the home slot.
  return { away, home: swatchFor(homeIndex) };
}
