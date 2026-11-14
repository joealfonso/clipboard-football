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
  chalk: "#F5F2E8",
  chalkSoft: "#A9B3B8",
  signal: "#F2B33D",
} as const;

export const FONT_UI = '"Atkinson Hyperlegible", system-ui, sans-serif';
export const FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';

/**
 * PLACEHOLDER team swatch colors (DESIGN.md `team.<id>.color`): data/teams/names.json has no
 * colors yet, so each team gets one of these by its league index until art-director sets them.
 * Used only as the 10 px swatch beside a team name (spec H3), never on the field.
 */
export const SWATCHES = ["#7B2D26", "#1B4D3E", "#3D3B8E", "#B5651D", "#2F4858", "#8E3B46", "#4F6D2F", "#6B4E71"] as const;

export function swatchFor(index: number): string {
  return SWATCHES[((index % SWATCHES.length) + SWATCHES.length) % SWATCHES.length] as string;
}
