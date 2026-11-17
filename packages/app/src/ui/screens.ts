// The choices on every screen that isn't a call menu, as data (the call menus are menu.ts). The
// view draws the body; these rows are the screen's choices, so one test can count every screen
// against the seven-choice cap (spec F3). A scrollable table counts as one choice (lead).

import { DEFAULT_LABEL_CONTENT, DEFAULT_SETTINGS } from "./storage";

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
  /** Plain lines shown above the rows (not choices). */
  readonly lines?: readonly string[];
}

const row = (key: string, label: string, action: string, extra: Partial<ScreenRow> = {}): ScreenRow => ({ key, label, on: true, action, ...extra });

export type ScreenPick = { readonly t: "act"; readonly row: ScreenRow } | { readonly t: "reason"; readonly text: string } | { readonly t: "none" };

/** What a key, Enter or a click does on a screen: an off row gives only its reason, a key with no row does nothing. */
export function pickRow(model: ScreenModel | null | undefined, key: string): ScreenPick {
  const r = model?.rows.find((x) => x.key === key);
  if (r === undefined) return { t: "none" };
  if (!r.on) return { t: "reason", text: r.reason === undefined ? "Not available." : `${r.label}: ${r.reason}.` };
  return { t: "act", row: r };
}

/**
 * The main menu (docs/specs/m2-main-menu.md, decision 3): Quick play, Continue, Settings, Controls.
 * Quick play starts a random matchup at once; the pregame screen is out of the flow for now.
 * Continue is off while the save check runs ("checking"), with no save, or with storage blocked.
 */
export function titleScreen(o: { readonly hasSave: boolean; readonly storage: boolean; readonly checking?: boolean }): ScreenModel {
  const reason = !o.storage ? "saves aren't available in this browser window" : o.checking === true ? "checking for a saved game" : "no saved game";
  const can = o.hasSave && o.storage && o.checking !== true;
  return {
    id: "title",
    title: "Clipboard Football",
    // A new game replaces the autosave: say so once, as a note, not a confirm step (usability pass U9).
    rows: [
      row("1", "Quick play", "newGame", o.hasSave && o.storage ? { note: "replaces your saved game" } : {}),
      can ? row("2", "Continue", "continue") : row("2", "Continue", "continue", { on: false, reason }),
      row("3", "Settings", "settings"),
      row("4", "Controls", "controls"),
    ],
  };
}

/** Where the main menu's highlight opens: Continue when it is on, else Quick play (decision 4). */
export function openingHighlight(m: ScreenModel): number {
  const i = m.rows.findIndex((r) => r.action === "continue" && r.on);
  return i < 0 ? 0 : i;
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
  return { id: "end", title: "Final", rows: [row("1", "Box score", "box"), row("2", "Rematch", "rematch"), row("3", "New matchup", "newMatchup"), row("Esc", "Main menu", "title")] };
}

/** Tab 5 is the game log (calling screen pass Q2; it was "Drives"): drives and every play, newest first. */
export const BOX_TABS = ["Team", "Offense players", "Defense players", "Kicking", "Game log"] as const;
export type BoxTab = (typeof BOX_TABS)[number];

export function boxScreen(tab: BoxTab): ScreenModel {
  return {
    id: "box",
    title: "Box score",
    rows: [...BOX_TABS.map((t, i) => row(String(i + 1), t, `tab:${t}`, t === tab ? { note: "shown" } : {})), row("Esc", "Back", "back")],
  };
}

export type SpeedSetting = "1x" | "2x" | "skip";

/** The game's seeds, so any game can be replayed (shown in the Esc menu; Joseph moved them off Pregame). */
export function seedLine(seed: number, leagueSeed: number): string {
  return `Seed ${seed}, league seed ${leagueSeed}.`;
}

export function pauseScreen(o: { readonly hasPlay: boolean; readonly speed: SpeedSetting; readonly seed?: number; readonly leagueSeed?: number }): ScreenModel {
  return {
    id: "pause",
    title: "Paused",
    ...(o.seed === undefined || o.leagueSeed === undefined ? {} : { lines: [seedLine(o.seed, o.leagueSeed)] }),
    rows: [
      row("1", "Resume", "resume"),
      o.hasPlay ? row("2", "Last play details", "details", { note: "D" }) : row("2", "Last play details", "details", { on: false, reason: "no plays yet" }),
      row("3", "Box score", "box", { note: "L" }),
      row("4", "Animation speed", "speed", { note: o.speed }),
      row("5", "Settings", "settings"),
      row("6", "Controls", "controls"),
      row("7", "Quit to main menu", "quit", { note: "save kept" }),
    ],
  };
}

export type TextSize = 100 | 125 | 150 | 200;
export type MotionSetting = "system" | "on" | "off";
export type MarkLabelSetting = "involved" | "all" | "none";
/** Q1: Off; skip qualifying dead balls when you can't call a timeout there; skip them even when you could. */
export type AutoAdvance = "off" | "noDecision" | "all";
export const AUTO_ADVANCE_TEXT: Readonly<Record<AutoAdvance, string>> = { off: "Off", noDecision: "When there's nothing to decide", all: "Also skip my timeout chances" };

/** What a mark's one label shows (usability pass U7; Joseph, 2026-11-14: the overall by default). */
export type LabelContent = "rating" | "number";
export const LABEL_CONTENT_TEXT: Readonly<Record<LabelContent, string>> = { rating: "Overall rating", number: "Jersey number" };
/** The legend line in the panel footer: what the number beside each mark is. */
export const LABEL_LEGEND: Readonly<Record<LabelContent, string>> = {
  rating: "Mark labels: overall ratings",
  number: "Mark labels: jersey numbers",
};

export const MARK_LABEL_TEXT: Readonly<Record<MarkLabelSetting, string>> = { involved: "Named players during the play", all: "All", none: "None" };
export const MOTION_TEXT: Readonly<Record<MotionSetting, string>> = { system: "Follow the system", on: "On", off: "Off" };

/** What each Settings row changes, shown under the rows for the highlighted row (decision 7). */
export const SETTINGS_DESCRIPTION: Readonly<Record<string, string>> = {
  textSize: "Changes every screen, including this one.",
  reducedMotion: "On: plays jump to their last frame and the camera cuts instead of panning.",
  markLabels: "Which marks keep their label while a play runs. Every mark gets its label back at the whistle.",
  labelContent: "What the number beside each mark is: the player's overall rating or his jersey number.",
  speed: "How fast plays run: 1x, 2x, or skip to the result. S changes it during a play.",
  autoAdvance: "Plays with nothing for you to choose (their kickoffs, punts, field goals, extra points, kneels and spikes) run without waiting for Space. Off by default. The middle setting still stops when you could call a timeout.",
};

/** The line Settings shows when a change couldn't be stored (decision 12). */
export const SETTINGS_NOT_STORED = "Settings last until you close this page.";

export function settingsScreen(o: {
  readonly textSize: TextSize;
  readonly reducedMotion: MotionSetting;
  readonly markLabels: MarkLabelSetting;
  readonly labelContent?: LabelContent;
  readonly speed?: SpeedSetting;
  readonly autoAdvance?: AutoAdvance;
  /** What prefers-reduced-motion says now, for the "Follow the system" note. */
  readonly systemReduced?: boolean;
}): ScreenModel {
  const motion = o.reducedMotion === "system" && o.systemReduced !== undefined ? `${MOTION_TEXT.system} (now: ${o.systemReduced ? "on" : "off"})` : MOTION_TEXT[o.reducedMotion];
  return {
    id: "settings",
    title: "Settings",
    rows: [
      row("1", "Text size", "textSize", { note: `${o.textSize}%` }),
      row("2", "Reduced motion", "reducedMotion", { note: motion }),
      row("3", "Mark labels", "markLabels", { note: MARK_LABEL_TEXT[o.markLabels] }),
      row("4", "Mark label shows", "labelContent", { note: LABEL_CONTENT_TEXT[o.labelContent ?? DEFAULT_LABEL_CONTENT] }),
      // Every field of Settings has a row (decision 6); the pause menu keeps its own speed row too.
      row("5", "Animation speed", "speed", { note: o.speed ?? DEFAULT_SETTINGS.speed }),
      row("6", "Auto-advance", "autoAdvance", { note: AUTO_ADVANCE_TEXT[o.autoAdvance ?? DEFAULT_SETTINGS.autoAdvance] }),
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
  return { id: "simError", title: "Something went wrong in the game engine.", rows: [row("1", "Copy details", "copy"), row("2", "Restart from last save", "restart"), row("Esc", "Main menu", "title")] };
}
