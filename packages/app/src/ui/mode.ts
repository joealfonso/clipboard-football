// Menu mode or game mode (docs/specs/m2-main-menu.md, decision 1), decided by one fact: whether a
// game exists. Menu mode shows only #main-menu; game mode only the top bar and the field layout.

export type UiMode = "menu" | "game";

export function uiMode(game: unknown): UiMode {
  return game === null || game === undefined ? "menu" : "game";
}

/** The `hidden` value of each region in a mode: always set together. */
export function regionsHidden(mode: UiMode): { readonly mainMenu: boolean; readonly topBar: boolean; readonly layout: boolean } {
  const menu = mode === "menu";
  return { mainMenu: !menu, topBar: menu, layout: menu };
}
