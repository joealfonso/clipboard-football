// The choices on every screen that isn't a call menu, as data (the call menus are menu.ts). The
// view draws the body; these rows are the screen's choices, so one test can count every screen
// against the seven-choice cap (spec F3). A scrollable table counts as one choice (lead).

export interface ScreenRow {
  /** The key that picks it: "1".."7", "T", "Esc", "Space", "Enter", "Left", "Right". */
  readonly key: string;
  readonly label: string;
  readonly on: boolean;
  readonly reason?: string;
  readonly note?: string;
  readonly action: string;
}

export interface ScreenModel {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly ScreenRow[];
}

const row = (key: string, label: string, action: string, extra: Partial<ScreenRow> = {}): ScreenRow => ({ key, label, on: true, action, ...extra });

export function titleScreen(o: { readonly hasSave: boolean; readonly storage: boolean }): ScreenModel {
  const reason = !o.storage ? "saves aren't available in this browser window" : "no saved game";
  return {
    id: "title",
    title: "Clipboard Football",
    rows: [row("1", "New game", "newGame"), o.hasSave && o.storage ? row("2", "Continue", "continue") : row("2", "Continue", "continue", { on: false, reason }), row("3", "Settings", "settings")],
  };
}

export function pregameScreen(): ScreenModel {
  return {
    id: "pregame",
    title: "Pregame",
    rows: [row("1", "Start", "start"), row("2", "Coach the other team", "swap"), row("3", "New matchup", "newMatchup"), row("4", "Your roster", "yourRoster"), row("5", "Their roster", "theirRoster"), row("Esc", "Back", "back")],
  };
}

export const UNITS = ["Offense", "Defense", "Special teams"] as const;
export type Unit = (typeof UNITS)[number];

export function rosterScreen(o: { readonly team: string; readonly unit: Unit; readonly empty: boolean }): ScreenModel {
  return {
    id: "roster",
    title: `${o.team}: roster`,
    rows: [
      row("1", "Unit", "unit", { note: o.unit }),
      o.empty ? row("Enter", "Open the selected player", "open", { on: false, reason: "no players" }) : row("Enter", "Open the selected player", "open"),
      row("Esc", "Back", "back"),
    ],
  };
}

export function cardScreen(o: { readonly hasPrev: boolean; readonly hasNext: boolean }): ScreenModel {
  return {
    id: "card",
    title: "Player card",
    rows: [
      row("Left", "Previous player", "prev", o.hasPrev ? {} : { on: false, reason: "first player" }),
      row("Right", "Next player", "next", o.hasNext ? {} : { on: false, reason: "last player" }),
      row("1", "Rating detail", "ratingDetail"),
      row("Esc", "Back", "back"),
    ],
  };
}

export function ratingDetailScreen(): ScreenModel {
  return { id: "ratingDetail", title: "Rating detail", rows: [row("Esc", "Back", "back")] };
}

export function noticeScreen(id: string, title: string): ScreenModel {
  return { id, title, rows: [row("Space", "Continue", "continue")] };
}

export function halftimeScreen(): ScreenModel {
  return { id: "halftime", title: "Halftime", rows: [row("1", "Continue", "continue"), row("2", "Box score", "box"), row("Esc", "Menu", "pause")] };
}

export function endScreen(): ScreenModel {
  return { id: "end", title: "Final", rows: [row("1", "Box score", "box"), row("2", "Rematch", "rematch"), row("3", "New matchup", "newMatchup"), row("Esc", "Title", "title")] };
}

export const BOX_TABS = ["Team", "Offense players", "Defense players", "Kicking", "Drives"] as const;
export type BoxTab = (typeof BOX_TABS)[number];

export function boxScreen(tab: BoxTab): ScreenModel {
  return {
    id: "box",
    title: "Box score",
    rows: [...BOX_TABS.map((t, i) => row(String(i + 1), t, `tab:${t}`, t === tab ? { note: "shown" } : {})), row("Esc", "Back", "back")],
  };
}

export type SpeedSetting = "1x" | "2x" | "skip";

export function pauseScreen(o: { readonly hasPlay: boolean; readonly speed: SpeedSetting }): ScreenModel {
  return {
    id: "pause",
    title: "Paused",
    rows: [
      row("1", "Resume", "resume"),
      o.hasPlay ? row("2", "Last play details", "details", { note: "D" }) : row("2", "Last play details", "details", { on: false, reason: "no plays yet" }),
      row("3", "Box score", "box"),
      row("4", "Animation speed", "speed", { note: o.speed }),
      row("5", "Settings", "settings"),
      row("6", "Controls", "controls"),
      row("7", "Quit to title", "quit", { note: "save kept" }),
    ],
  };
}

export type TextSize = 100 | 125 | 150 | 200;
export type MotionSetting = "system" | "on" | "off";
export type MarkLabelSetting = "involved" | "all" | "none";

export const MARK_LABEL_TEXT: Readonly<Record<MarkLabelSetting, string>> = { involved: "Players in the play", all: "All", none: "None" };
export const MOTION_TEXT: Readonly<Record<MotionSetting, string>> = { system: "Follow the system", on: "On", off: "Off" };

export function settingsScreen(o: { readonly textSize: TextSize; readonly reducedMotion: MotionSetting; readonly markLabels: MarkLabelSetting }): ScreenModel {
  return {
    id: "settings",
    title: "Settings",
    rows: [
      row("1", "Text size", "textSize", { note: `${o.textSize}%` }),
      row("2", "Reduced motion", "reducedMotion", { note: MOTION_TEXT[o.reducedMotion] }),
      row("3", "Mark labels", "markLabels", { note: MARK_LABEL_TEXT[o.markLabels] }),
      row("Esc", "Back", "back"),
    ],
  };
}

export function controlsScreen(): ScreenModel {
  return { id: "controls", title: "Controls", rows: [row("Esc", "Back", "back")] };
}

export function detailsScreen(): ScreenModel {
  return { id: "details", title: "Last play details", rows: [row("1", "Copy details", "copy"), row("Esc", "Back", "back")] };
}

export function saveErrorScreen(reason: "older" | "damaged"): ScreenModel {
  // Starting new keeps the bad save aside (storage.setSaveAside); Delete removes it for good.
  return { id: `save-${reason}`, title: "Saved game", rows: [row("1", "Start a new game", "newGameAside", { note: "the old save is kept aside" }), row("2", "Delete save", "deleteSave"), row("Esc", "Back", "back")] };
}

export function simErrorScreen(): ScreenModel {
  return { id: "simError", title: "Something went wrong in the game engine.", rows: [row("1", "Copy details", "copy"), row("2", "Restart from last save", "restart"), row("Esc", "Title", "title")] };
}
