// The call menus: a pure state machine over the screens the engine's DecisionRequest carries
// (packages/shared game.ts). The engine decides which options exist and which are legal, with a
// reason code for each one that isn't; this module only numbers the rows, walks the screens and
// builds the answer path. Off options keep their number and only repeat their reason (design
// decision 9); the last key snaps (decision 7); Esc goes back, or opens the pause menu on a first
// screen. Every engine screen has at most six options, so with Esc no screen passes seven rows.

import type { Catalog } from "@clipboard-football/shared";
import type { DecisionAnswer, DecisionRequest, OffenseCallChoice, ReasonCode, RequestOption, RequestScreen } from "../engine/types";

export const MAX_ROWS = 7;

export type MenuKey = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "T" | "Esc" | "Space";

export interface Row {
  readonly key: MenuKey;
  readonly label: string;
  readonly on: boolean;
  readonly reason?: ReasonCode;
  readonly note?: string;
  /** The option id, absent for Esc. */
  readonly option?: string;
}

export interface MenuState {
  readonly request: DecisionRequest;
  /** Screen ids from the first screen down; the last is shown. */
  readonly screens: readonly string[];
  /** Option ids picked on the way down (the answer path so far). */
  readonly picks: readonly string[];
}

export type Effect =
  | { readonly t: "submit"; readonly answer: DecisionAnswer }
  | { readonly t: "reason"; readonly reason: ReasonCode }
  | { readonly t: "pause" }
  | { readonly t: "none" };

export interface MenuData {
  readonly catalog: Catalog;
  /** Display labels by id (catalog labels, "Short pass", formation names). */
  readonly labels: Readonly<Record<string, string>>;
}

export interface MenuExtra {
  /** Timeouts the human's team has left, for the T row's note. */
  readonly timeoutsLeft?: number;
  /** Penalty option text by option id ("Accept holding: 1st & 10 at OPP 33"). */
  readonly penaltyLabels?: Readonly<Record<string, string>>;
}

export function openMenu(request: DecisionRequest): MenuState {
  return { request, screens: [request.screens[0]?.id ?? ""], picks: [] };
}

export function current(m: MenuState): string {
  return m.screens[m.screens.length - 1] as string;
}

export function isFirstScreen(m: MenuState): boolean {
  return m.screens.length === 1;
}

function screenOf(m: MenuState): RequestScreen | undefined {
  return m.request.screens.find((s) => s.id === current(m));
}

const FIXED: Readonly<Record<string, string>> = {
  formation: "Formation",
  run: "Run",
  pass: "Pass",
  timeout: "Timeout",
  continue: "Continue",
  hurryUp: "Hurry-up",
  normal: "Normal",
  runClock: "Run the clock",
  receive: "Receive",
  defer: "Defer",
  kick: "Kick",
  runoff: "Take the run-off",
  decline: "Decline",
  offset: "Offsetting fouls: replay the down",
  specials: "Specials",
  // M2 G: the challenge prompt.
  throwFlag: "Throw the flag",
  letStand: "Let it stand",
};

function callText(c: OffenseCallChoice, labels: Readonly<Record<string, string>>): string {
  const leaf = c.call === "goForTwo" ? (c.twoPointPlay ?? "") : c.call;
  const play = labels[leaf] ?? leaf;
  return c.formation === undefined ? play : `${labels[c.formation] ?? c.formation}, ${play}`;
}

function sameCallLabel(req: DecisionRequest, data: MenuData): string {
  if (req.kind === "defenseCall") return req.sameCall === null ? "Same call" : `Same call: ${data.labels[req.sameCall] ?? req.sameCall}`;
  if ((req.kind === "offenseCall" || req.kind === "try") && req.sameCall !== null) return `Same call: ${callText(req.sameCall, data.labels)}`;
  return "Same call";
}

function label(o: RequestOption, screen: string, req: DecisionRequest, data: MenuData, extra: MenuExtra): string {
  if (o.id === "sameCall") return sameCallLabel(req, data);
  if (screen === "penalty") return extra.penaltyLabels?.[o.id] ?? FIXED[o.id] ?? o.id;
  if (o.id === "timeout" && req.kind === "runoff") return "Use a timeout";
  if (o.id === "fieldGoal" && req.kind === "offenseCall") return `${data.labels["fieldGoal"] ?? "Field goal"} (${req.fieldGoalYards} yd)`;
  if (o.id === "kick" && screen === "overtimeToss") return "Kick";
  return data.labels[o.id] ?? FIXED[o.id] ?? o.id;
}

/** Timeout is T and Continue is Space on a call's screens (on the run-off screen Timeout is numbered); null for a numbered option. */
function letterKey(o: RequestOption, req: DecisionRequest): MenuKey | null {
  if (o.id === "continue") return "Space";
  if (o.id === "timeout" && req.kind !== "runoff") return "T";
  return null;
}

/** Every row of the current screen, in order: the engine's options, then Esc. */
export function rows(m: MenuState, data: MenuData, extra: MenuExtra = {}): Row[] {
  const req = m.request;
  const sc = screenOf(m);
  const out: Row[] = [];
  let n = 0;
  for (const o of sc?.options ?? []) {
    const key = letterKey(o, req) ?? (String(++n) as MenuKey);
    const base = { key, label: label(o, current(m), req, data, extra), on: o.legal, option: o.id };
    let note: string | undefined;
    if (o.id === "timeout" && o.legal && extra.timeoutsLeft !== undefined) note = `${extra.timeoutsLeft} left`;
    if (req.kind === "offenseCall" && o.id === req.tempo) note = "now";
    out.push({ ...base, ...(o.reason === undefined ? {} : { reason: o.reason }), ...(note === undefined ? {} : { note }) });
  }
  out.push({ key: "Esc", label: isFirstScreen(m) ? "Menu" : "Back", on: true });
  return out;
}

/** One key press. Unknown keys and keys with no row do nothing. */
export function press(m: MenuState, key: MenuKey, data: MenuData): { menu: MenuState; effect: Effect } {
  const row = rows(m, data).find((r) => r.key === key);
  const stay = (effect: Effect = { t: "none" }): { menu: MenuState; effect: Effect } => ({ menu: m, effect });
  if (row === undefined) return stay();
  if (!row.on) return stay(row.reason === undefined ? { t: "none" } : { t: "reason", reason: row.reason });
  if (row.key === "Esc") {
    if (isFirstScreen(m)) return stay({ t: "pause" });
    return { menu: { request: m.request, screens: m.screens.slice(0, -1), picks: m.picks.slice(0, -1) }, effect: { t: "none" } };
  }
  const o = screenOf(m)?.options.find((x) => x.id === row.option);
  if (o === undefined) return stay();
  if (o.opens !== undefined) return { menu: { request: m.request, screens: [...m.screens, o.opens], picks: [...m.picks, o.id] }, effect: { t: "none" } };
  return stay({ t: "submit", answer: { seq: m.request.seq, path: [...m.picks, o.id] } });
}

/** The screens whose pick changes what the later rows mean: only these show under "So far". */
export const SO_FAR_SCREENS: ReadonlySet<string> = new Set(["offense.formation", "offense.try"]);

/**
 * "Go for two, Shotgun": the picks so far that the heading doesn't already name (usability pass
 * U3). picks[i] is the pick made on screens[i]; only the formation and the try pick are kept, so
 * navigation picks ("Formation", "Run") never repeat the heading. "" when there are none.
 */
export function breadcrumb(m: MenuState, data: MenuData): string {
  return m.picks
    .filter((_, i) => SO_FAR_SCREENS.has(m.screens[i] ?? ""))
    .map((p) => data.labels[p] ?? FIXED[p] ?? (p === "goForTwo" ? "Go for two" : p))
    .join(", ");
}

/** The step name only: "You're on offense" sits right above it, so no "Offense:" prefix. */
const TITLES: Readonly<Record<string, string>> = {
  "offense.playType": "Play type",
  "offense.playType.try": "Two-point try: play type",
  "offense.formation": "Formation",
  "offense.playClass": "Run or pass",
  "offense.run": "Run plays",
  "offense.pass": "Pass plays",
  "offense.kick": "Kick",
  "offense.clock": "Clock and tempo",
  "offense.try": "After the touchdown",
  kickoff: "Kickoff",
  "defense.package": "Defensive package",
  "defense.base": "Base plays",
  "defense.nickel": "Nickel plays",
  "defense.dime": "Dime plays",
  "defense.specials": "Specials",
  continue: "Dead ball",
  penalty: "Penalty: your choice",
  runoff: "Ten-second run-off",
  challenge: "Challenge?",
  toss: "Coin toss: you won",
  overtimeToss: "Overtime coin toss: you won",
};

export function title(m: MenuState): string {
  return TITLES[current(m)] ?? current(m);
}
