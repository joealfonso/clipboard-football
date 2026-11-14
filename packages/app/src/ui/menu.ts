// The call menus as a pure state machine over a decision request and the catalog
// (data/calls/catalog.json, docs/MENUS.md). A key press returns the next menu state and at most one
// effect: submit an answer, show an off choice's reason, or open the pause menu. Off choices keep
// their number and do nothing but repeat their reason (design decision 9). No screen has more than
// seven rows (decision "What counts as a choice"). Formation comes before the play (decision 6),
// the last key snaps (decision 7), Same call is one key (decision 10), Timeout only on a first
// screen (decision 11).

import type { Catalog, Screen } from "@clipboard-football/shared";
import type { Answer, DecisionRequest, OffenseCallAnswer, Option, ReasonCode, Tempo } from "../engine/types";

export const MAX_ROWS = 7;

export type MenuKey = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "T" | "Esc" | "Space";

export interface Row {
  readonly key: MenuKey;
  readonly label: string;
  readonly on: boolean;
  readonly reason?: ReasonCode;
  /** Shown after the label, for example the current tempo. */
  readonly note?: string;
  /** The Same call row. */
  readonly same?: true;
}

export interface MenuState {
  readonly request: DecisionRequest;
  /** Screen ids from the first screen down; the last is shown. */
  readonly path: readonly string[];
  /** Formation picked on the way down, for the breadcrumb and the call. */
  readonly formation?: string;
  /** "run" or "pass", picked on the Play type screen. */
  readonly playType?: string;
}

export type Effect =
  | { readonly t: "submit"; readonly answer: Answer }
  | { readonly t: "reason"; readonly reason: ReasonCode }
  | { readonly t: "pause" }
  | { readonly t: "none" };

export interface MenuData {
  readonly catalog: Catalog;
  /** Display labels by id (catalog labels; formation names). */
  readonly labels: Readonly<Record<string, string>>;
}

/** The two-point Play type screen: the catalog's Play type, reached from Go for two. */
const TRY_PLAY_TYPE = "try.playType";
const TEMPO_ROWS: readonly { key: MenuKey; tempo: Tempo; label: string }[] = [
  { key: "3", tempo: "hurryUp", label: "Hurry-up" },
  { key: "4", tempo: "normal", label: "Normal" },
  { key: "5", tempo: "runClock", label: "Run the clock" },
];

function screen(data: MenuData, id: string): Screen {
  const s = data.catalog.screens.find((x) => x.id === (id === TRY_PLAY_TYPE ? "offense.playType" : id));
  if (s === undefined) throw new RangeError(`no catalog screen ${id}`);
  return s;
}

function rootOf(req: DecisionRequest): string {
  switch (req.kind) {
    case "offenseCall":
      return "offense.playType";
    case "try":
      return "offense.try";
    case "defenseCall":
      return "defense.package";
    case "kickoffType":
      return "kickoff";
    default:
      return req.kind;
  }
}

export function openMenu(request: DecisionRequest): MenuState {
  return { request, path: [rootOf(request)] };
}

export function current(m: MenuState): string {
  return m.path[m.path.length - 1] as string;
}

export function isFirstScreen(m: MenuState): boolean {
  return m.path.length === 1;
}

/** The leaf options of the request this screen draws from. */
function leafOptions(req: DecisionRequest): readonly Option[] {
  switch (req.kind) {
    case "offenseCall":
    case "try":
    case "defenseCall":
      return req.calls;
    case "kickoffType":
    case "coinToss":
    case "overtimeChoice":
      return req.options;
    default:
      return [];
  }
}

/** A choice is on when it is a leaf that's on, or opens a screen with a leaf that's on. */
function availability(data: MenuData, m: MenuState, id: string, opens: string | undefined): { on: boolean; reason?: ReasonCode } {
  const req = m.request;
  if (req.kind === "try" && current(m) === "offense.try") {
    const o = req.options.find((x) => x.id === id);
    return o === undefined ? { on: false, reason: "notNow" } : o.reason === undefined ? { on: o.on } : { on: o.on, reason: o.reason };
  }
  const leaves = leafOptions(req);
  if (opens === undefined) {
    const o = leaves.find((x) => x.id === id);
    if (o === undefined) return { on: true };
    return o.reason === undefined ? { on: o.on } : { on: o.on, reason: o.reason };
  }
  const below = screen(data, opens).choices.map((c) => leaves.find((x) => x.id === c.id)).filter((x): x is Option => x !== undefined);
  if (below.length === 0) return { on: true };
  const on = below.some((x) => x.on);
  const reason = below.find((x) => x.reason !== undefined)?.reason;
  return on || reason === undefined ? { on } : { on, reason };
}

function sameCallLabel(req: DecisionRequest, data: MenuData): string {
  if (req.kind === "defenseCall") return req.sameCall.defense === undefined ? "Same call" : `Same call: ${data.labels[req.sameCall.defense] ?? req.sameCall.defense}`;
  if (req.kind !== "offenseCall" && req.kind !== "try") return "Same call";
  const o: OffenseCallAnswer | undefined = req.sameCall.offense;
  if (o === undefined) return "Same call";
  const leaf = o.call === "goForTwo" ? o.twoPointPlay : o.call;
  const play = data.labels[leaf ?? ""] ?? leaf ?? "";
  return o.formation === undefined ? `Same call: ${play}` : `Same call: ${data.labels[o.formation] ?? o.formation}, ${play}`;
}

function timeoutRow(req: DecisionRequest): Row {
  const t = req.timeout;
  return t.on ? { key: "T", label: "Timeout", on: true, note: `${t.left} left` } : { key: "T", label: "Timeout", on: false, ...(t.reason === undefined ? {} : { reason: t.reason }) };
}

/** Every row of the current screen, in order. */
export function rows(m: MenuState, data: MenuData, extra: { readonly fieldGoalLabel?: (yards: number) => string; readonly penaltyLabels?: readonly string[] } = {}): Row[] {
  const req = m.request;
  const id = current(m);
  const first = isFirstScreen(m);
  const esc: Row = { key: "Esc", label: first ? "Menu" : "Back", on: true };
  switch (req.kind) {
    case "continue":
      return [{ key: "Space", label: "Continue", on: true }, timeoutRow(req), esc];
    case "penaltyChoice":
      return [...req.choices.map((_, i) => ({ key: String(i + 1) as MenuKey, label: extra.penaltyLabels?.[i] ?? `Option ${i + 1}`, on: true })), esc];
    case "runoff":
      return [
        { key: "1", label: "Take the run-off", on: true },
        req.timeout.on ? { key: "2", label: "Use a timeout", on: true, note: `${req.timeout.left} left` } : { key: "2", label: "Use a timeout", on: false, reason: req.timeout.reason ?? "noTimeouts" },
        esc,
      ];
    case "challenge":
      return [{ key: "1", label: "Throw the flag", on: true }, { key: "2", label: "Let it stand", on: true }, esc];
    case "coinToss":
    case "overtimeChoice":
      return [...req.options.map((o, i) => ({ key: String(i + 1) as MenuKey, label: data.labels[o.id] ?? o.id, on: o.on, ...(o.reason === undefined ? {} : { reason: o.reason }) })), esc];
    default:
      break;
  }
  const sc = screen(data, id);
  const out: Row[] = sc.choices.map((c) => {
    const a = id === TRY_PLAY_TYPE ? tryPlayType(req, c.id) : availability(data, m, c.id, c.opens);
    let label = c.label;
    if (c.id === "fieldGoal" && req.kind === "offenseCall") label = extra.fieldGoalLabel?.(req.fieldGoalDistance) ?? `${c.label} (${req.fieldGoalDistance} yd)`;
    return { key: String(c.key) as MenuKey, label, on: a.on, ...(a.reason === undefined ? {} : { reason: a.reason }) };
  });
  if (id === "offense.clock" && req.kind === "offenseCall") {
    for (const t of TEMPO_ROWS) out.push({ key: t.key, label: t.label, on: true, ...(req.tempo === t.tempo ? { note: "now" } : {}) });
  }
  const offersSame = (first && (req.kind === "offenseCall" || req.kind === "defenseCall")) || id === TRY_PLAY_TYPE;
  if (offersSame && (req.kind === "offenseCall" || req.kind === "defenseCall" || req.kind === "try")) {
    const s = req.sameCall;
    out.push({ key: String(out.length + 1) as MenuKey, label: sameCallLabel(req, data), on: s.on, same: true, ...(s.reason === undefined ? {} : { reason: s.reason }) });
  }
  if (first) out.push(timeoutRow(req));
  out.push(esc);
  return out;
}

/** On the two-point Play type screen only Run and Pass are on (MENUS.md, "After a touchdown"). */
function tryPlayType(req: DecisionRequest, id: string): { on: boolean; reason?: ReasonCode } {
  if (req.kind !== "try") return { on: false, reason: "notNow" };
  return id === "run" || id === "pass" ? { on: true } : { on: false, reason: "notOnTry" };
}

function submitCall(m: MenuState, leaf: string): Effect {
  const req = m.request;
  const formation = m.formation;
  if (req.kind === "try") return { t: "submit", answer: { kind: "offense", call: { call: "goForTwo", twoPointPlay: leaf, ...(formation === undefined ? {} : { formation }) } } };
  if (req.kind === "defenseCall") return { t: "submit", answer: { kind: "defense", call: leaf } };
  return { t: "submit", answer: { kind: "offense", call: formation === undefined ? { call: leaf } : { call: leaf, formation } } };
}

function sameCallEffect(req: DecisionRequest): Effect {
  if (req.kind === "defenseCall" && req.sameCall.defense !== undefined) return { t: "submit", answer: { kind: "defense", call: req.sameCall.defense } };
  if ((req.kind === "offenseCall" || req.kind === "try") && req.sameCall.offense !== undefined) return { t: "submit", answer: { kind: "offense", call: req.sameCall.offense } };
  return { t: "none" };
}

/** One key press. Unknown keys and keys with no row do nothing. */
export function press(m: MenuState, key: MenuKey, data: MenuData): { menu: MenuState; effect: Effect } {
  const req = m.request;
  const list = rows(m, data);
  const row = list.find((r) => r.key === key);
  const stay = (effect: Effect = { t: "none" }): { menu: MenuState; effect: Effect } => ({ menu: m, effect });
  if (row === undefined) return stay();
  if (!row.on) return stay({ t: "reason", reason: row.reason ?? "notNow" });
  if (key === "Esc") {
    if (isFirstScreen(m)) return stay({ t: "pause" });
    const path = m.path.slice(0, -1);
    const top = path[path.length - 1];
    // Going back above the formation screen forgets the formation and the play type.
    const back: MenuState = { request: req, path };
    if (top === "offense.formation") return { menu: { ...back, ...(m.playType === undefined ? {} : { playType: m.playType }) }, effect: { t: "none" } };
    return { menu: back, effect: { t: "none" } };
  }
  if (key === "T") return stay({ t: "submit", answer: { kind: "timeout" } });
  if (key === "Space") return stay({ t: "submit", answer: { kind: "continue" } });
  if (row.same === true) return stay(sameCallEffect(req));
  switch (req.kind) {
    case "penaltyChoice":
      return stay({ t: "submit", answer: { kind: "penalty", index: Number(key) - 1 } });
    case "runoff":
      return stay({ t: "submit", answer: { kind: "runoff", useTimeout: key === "2" } });
    case "challenge":
      return stay({ t: "submit", answer: { kind: "challenge", throwFlag: key === "1" } });
    case "coinToss":
    case "overtimeChoice": {
      const o = req.options[Number(key) - 1];
      return stay(o === undefined ? { t: "none" } : { t: "submit", answer: { kind: "toss", choice: o.id } });
    }
    default:
      break;
  }
  const id = current(m);
  if (id === "offense.clock" && req.kind === "offenseCall") {
    const t = TEMPO_ROWS.find((x) => x.key === key);
    if (t !== undefined) return { menu: openMenu(req), effect: { t: "submit", answer: { kind: "tempo", tempo: t.tempo } } };
  }
  const choice = screen(data, id).choices.find((c) => String(c.key) === key);
  if (choice === undefined) return stay();
  if (req.kind === "kickoffType") return stay({ t: "submit", answer: { kind: "offense", call: { call: choice.id } } });
  if (req.kind === "try" && id === "offense.try") {
    if (choice.id === "extraPoint") return stay({ t: "submit", answer: { kind: "offense", call: { call: "extraPoint" } } });
    return { menu: { request: req, path: [...m.path, TRY_PLAY_TYPE] }, effect: { t: "none" } };
  }
  if (choice.opens !== undefined) {
    // Run and Pass go through the formation screen first (MENUS.md: "Before any run or pass you also pick a formation").
    if (choice.opens === "offense.run" || choice.opens === "offense.pass") return { menu: { request: req, path: [...m.path, "offense.formation"], playType: choice.id }, effect: { t: "none" } };
    return { menu: { ...m, path: [...m.path, choice.opens] }, effect: { t: "none" } };
  }
  if (id === "offense.formation") {
    const next = m.playType === "run" ? "offense.run" : "offense.pass";
    return { menu: { ...m, path: [...m.path, next], formation: choice.id }, effect: { t: "none" } };
  }
  return stay(submitCall(m, choice.id));
}

/** "Pass, Shotgun": the picks so far. */
export function breadcrumb(m: MenuState, data: MenuData): string {
  const parts: string[] = [];
  if (m.request.kind === "try" && m.path.includes(TRY_PLAY_TYPE)) parts.push("Go for two");
  if (m.playType !== undefined && m.path.includes("offense.formation")) parts.push(data.labels[m.playType] ?? m.playType);
  if (m.formation !== undefined) parts.push(data.labels[m.formation] ?? m.formation);
  const id = current(m);
  if (id === "offense.kick") parts.push("Kick");
  if (id === "offense.clock") parts.push("Clock");
  if (id.startsWith("defense.") && id !== "defense.package") parts.push(screen(data, id).title.replace(/^Defense: /, ""));
  return parts.join(", ");
}

/** The screen's title for the panel. */
export function title(m: MenuState, data: MenuData): string {
  const id = current(m);
  switch (m.request.kind) {
    case "continue":
      return "Dead ball";
    case "penaltyChoice":
      return "Penalty: your choice";
    case "runoff":
      return "Ten-second run-off";
    case "challenge":
      return "Close call";
    case "coinToss":
      return "Coin toss";
    case "overtimeChoice":
      return "Overtime coin toss";
    default:
      return id === TRY_PLAY_TYPE ? "Two-point try: Play type" : screen(data, id).title;
  }
}
