// DESIGN.md's tokens ("Broadcast", 2026-11-15). Every color, shadow, radius and timing the canvas
// draws comes from here; styles.css mirrors them as custom properties in :root.

export const COLOR = {
  /** Stage base; the sticky legend backing at 0.85 alpha. */
  bg: "#0A1428",
  /** Stage gradient light center. */
  bgTop: "#13264A",
  /** Stage gradient far edge. */
  bgBottom: "#070E1C",
  /** Field surface, dark mowing stripe (the 5-yard bands starting at each goal line). */
  turf: "#2F7237",
  /** Field surface, light mowing stripe (the bands in between). 1.07:1 on turf: the bands whisper. */
  turfStripe: "#327739",
  /** The out-of-bounds margin outside each sideline, flat. Same hex as turf, its own token for skins. */
  sideline: "#2F7237",
  /** All white field paint, the ball outline, the white ring of dark-tier marks, text on tags. */
  line: "#F5F7F2",
  hash: "#D5E0D2",
  /** Line of scrimmage, the dark ring of light-tier marks, the first-down casing, the flag outline. */
  outlineDark: "#0A0D0B",
  ball: "#7A4A1E",
  /** Pill behind every piece of on-field text except yard numbers and end zone names. */
  tag: "rgba(7, 12, 22, 0.78)",
  /** Center stop of the turf light. */
  turfLight: "rgba(255, 255, 255, 0.05)",
  /** Opaque surface where glass can't be used (menu-mode sheets placed by placeOverlay). */
  panel: "#0F1E3D",
  /** Kept only as the bar track (`color.track`). */
  panelRaise: "#1B3260",
  /** Glass cards. */
  surface: "rgba(18, 34, 63, 0.72)",
  /** `surface` without backdrop-filter, and canvas toasts at 0.92. */
  surfaceSolid: "#12223F",
  surfaceRaised: "rgba(255, 255, 255, 0.06)",
  rowRest: "rgba(255, 255, 255, 0.035)",
  hairline: "rgba(255, 255, 255, 0.08)",
  hairlineStrong: "rgba(255, 255, 255, 0.14)",
  selectRing: "rgba(255, 203, 61, 0.40)",
  track: "#1B3260",
  gold: "#FFCB3D",
  chalk: "#F5F2E8",
  chalkSoft: "#A9B3B8",
  signal: "#FFCB3D",
  paper: "#F5F2E8",
  paperShade: "#E6E0CF",
  ink: "#22272B",
  inkSoft: "#4F565B",
} as const;

/** Canvas shadows (DESIGN.md Elevation): set, draw the outline pass, then reset with NO_SHADOW. */
export interface CanvasShadow {
  readonly color: string;
  readonly blur: number;
  readonly offsetY: number;
}
export const SHADOW = {
  mark: { color: "rgba(0, 0, 0, 0.28)", blur: 4, offsetY: 1 },
  field: { color: "rgba(0, 0, 0, 0.50)", blur: 40, offsetY: 0 },
  toast: { color: "rgba(0, 0, 0, 0.40)", blur: 12, offsetY: 4 },
  carrier: { color: "rgba(245, 247, 242, 0.55)", blur: 8, offsetY: 0 },
} as const satisfies Record<string, CanvasShadow>;
export const NO_SHADOW: CanvasShadow = { color: "rgba(0, 0, 0, 0)", blur: 0, offsetY: 0 };

export const RADIUS = { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 } as const;

/** UI motion, ms (DESIGN.md Motion (UI)). */
export const DUR = { fast: 120, base: 180, slow: 260, screen: 240 } as const;

/**
 * The main menu diagram's ink (docs/specs/m2-main-menu.md, Open 3): no game, so no team colors.
 * Both sides in color.line over a color.outlineDark ring; shape and line style carry the side.
 */
export const SPLASH_INK = { O: COLOR.line, X: COLOR.line, outline: COLOR.outlineDark } as const;

/** font.ui: Inter when installed (no @font-face yet, asset intake). Mirrors styles.css --font-ui. */
export const FONT_UI = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
/** font.display: mirrors styles.css --font-display (no @font-face yet, asset intake). */
export const FONT_DISPLAY = '"Barlow Condensed", "Inter", system-ui, sans-serif';

import { contrast, rgbOf } from "./overlay";

/**
 * Team color slots (DESIGN.md Team colors): each team takes slot `league index mod 8`. Fills,
 * parallel ring (outline) colors and end zone colors. Dark-tier fills take a color.line ring,
 * light-tier fills a color.outlineDark ring.
 */
export const SWATCHES = ["#F29A2E", "#C62F2F", "#3263D2", "#C3CCD3", "#1D1E22", "#7A4EBA", "#B99BE8", "#45A8E6"] as const;
export const TEAM_OUTLINE: readonly string[] = [COLOR.outlineDark, COLOR.line, COLOR.line, COLOR.outlineDark, COLOR.line, COLOR.line, COLOR.outlineDark, COLOR.outlineDark];
export const TEAM_END_ZONE: readonly string[] = ["#B85A1E", "#CC4A3C", "#3263D2", "#5E6B78", "#62666C", "#7A4EBA", "#7656B0", "#1F6FA8"];
export type SwatchFamily = "orange" | "red" | "blue" | "neutral" | "purple";
/** The hue family of each slot: a matchup never pairs two from one family. No green: it would vanish on grass. */
export const SWATCH_FAMILY: readonly SwatchFamily[] = ["orange", "red", "blue", "neutral", "neutral", "purple", "purple", "blue"];
/** The smallest luminance ratio between a matchup's two fills (designed: holds in grayscale). */
export const SWATCH_MIN_RATIO = 1.4;

const slot = (index: number): number => ((index % SWATCHES.length) + SWATCHES.length) % SWATCHES.length;

export function swatchFor(index: number): string {
  return SWATCHES[slot(index)] as string;
}

/** One team's colors on the field. */
export interface TeamInk {
  readonly fill: string;
  readonly ring: string;
  readonly endZone: string;
}

/**
 * The 1 px inset ring on a team chip or swatch (DESIGN.md Broadcast build review 3): stronger on
 * dark-tier fills, which sit under 3:1 on navy, so every chip keeps 3:1 against its cell.
 */
export const CHIP_RING = { dark: "rgba(255, 255, 255, 0.55)", light: "rgba(255, 255, 255, 0.35)" } as const;

/** Whether a fill is a dark-tier slot (takes the color.line ring); unknown fills count as light. */
export function darkTier(fill: string): boolean {
  const k = SWATCHES.findIndex((x) => x.toUpperCase() === fill.toUpperCase());
  return k >= 0 && TEAM_OUTLINE[k] === COLOR.line;
}

export function teamInk(slotIndex: number): TeamInk {
  const k = slot(slotIndex);
  return { fill: SWATCHES[k] as string, ring: TEAM_OUTLINE[k] as string, endZone: TEAM_END_ZONE[k] as string };
}

/**
 * The two slots of one matchup: away takes its own slot; home takes the first slot from its own
 * onward that is in a different family from away and at least SWATCH_MIN_RATIO from it.
 */
export function matchupSlots(awayIndex: number, homeIndex: number): { readonly away: number; readonly home: number } {
  const a = slot(awayIndex);
  const away = SWATCHES[a] as string;
  for (let k = 0; k < SWATCHES.length; k++) {
    const h = slot(homeIndex + k);
    const home = SWATCHES[h] as string;
    if (SWATCH_FAMILY[h] !== SWATCH_FAMILY[a] && contrast(rgbOf(home), rgbOf(away)) >= SWATCH_MIN_RATIO) return { away: a, home: h };
  }
  // Unreachable with the set above (layout.test checks all 64 pairs); keeps the home slot.
  return { away: a, home: slot(homeIndex) };
}

/** The two fills of one matchup (matchupSlots). */
export function matchupSwatches(awayIndex: number, homeIndex: number): { readonly away: string; readonly home: string } {
  const s = matchupSlots(awayIndex, homeIndex);
  return { away: SWATCHES[s.away] as string, home: SWATCHES[s.home] as string };
}

/** Every field color of one matchup: marks, paths and end zones use the two slots it resolves. */
export function matchupInk(awayIndex: number, homeIndex: number): { readonly away: TeamInk; readonly home: TeamInk } {
  const s = matchupSlots(awayIndex, homeIndex);
  return { away: teamInk(s.away), home: teamInk(s.home) };
}
