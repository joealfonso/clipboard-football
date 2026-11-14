// What the app reads from the engine. The M2 engine (milestones A to E) now defines the requests,
// answers, participants, onField, headline, jersey numbers and the per-player box; they are
// re-exported from packages/shared and packages/sim here. What stays local:
// - readDetail, which reads a PlayResult's `detail` defensively and turns `onField` (position ->
//   ids) into the slot list the field timeline draws from;
// - the hooks for milestones not built yet (standout plays, F; close calls, G), marked ASSUMED.
// Plain types plus one pure reader; the UI thread and the worker both import this file.

import type { OnField as EngineOnField, Participants, PlayResult, Position } from "@clipboard-football/shared";
// From the zod-free module directly: the package root also exports the zod schemas, which would
// pull zod into the UI thread's bundle.
import { PARTICIPANT_ROLES } from "../../../shared/src/play";
import type { GameEvent, GameState, Snapshot, Team } from "@clipboard-football/sim";

export type {
  ContinueAbout,
  DecisionAnswer,
  DecisionRequest,
  OffenseCallChoice,
  ParticipantRole,
  Participants,
  PassingLine,
  PenaltyPreview,
  PlayerBoxScore,
  PlayerLine,
  RatingRank,
  RatingRanks,
  ReasonCode,
  RequestKind,
  RequestOption,
  RequestScreen,
  Tempo,
} from "@clipboard-football/shared";
export { PARTICIPANT_ROLES };
export type { GameEvent, GameState, Snapshot, Team };
export type PlayEvent = Extract<GameEvent, { t: "play" }>;

/** One player on the field for a play, in the order the timeline draws: position plus slot index. */
export interface OnFieldSlot {
  /** "WR2": the position and its 1-based index in the engine's slot order. */
  readonly slot: string;
  readonly position: Position;
  readonly id: string;
}

/** `detail.onField` as slot lists (offense is the team that snapped or kicked). */
export interface OnFieldSlots {
  readonly offense: readonly OnFieldSlot[];
  readonly defense: readonly OnFieldSlot[];
}

// ---------------------------------------------------------------- request snapshot (coming in the engine)

/**
 * ASSUMED until the engine ships it: the state a DecisionRequest is asked in, so the HUD can show
 * the clock a human defense sees after the run-off. Field names are the app's guess from the
 * coordinator's description (clock, running, quarter, timeouts, down, distance, spot, the run-off
 * just applied, whether a two-minute warning or an AI timeout happened). Read with readSnapshot,
 * which drops it when any field is missing or malformed, so the HUD falls back to the committed state.
 */
export interface RequestSnapshot {
  readonly clock: number;
  readonly clockRunning: boolean;
  readonly period: number;
  readonly timeouts: { readonly home: number; readonly away: number };
  readonly down: number;
  readonly distance: number;
  readonly spot: number;
  /** Seconds of run-off applied before this request (0 for none). */
  readonly runoffSeconds: number;
  readonly twoMinuteWarning: boolean;
  /** The AI's team called a timeout in this dead ball before the request. */
  readonly aiTimeout: boolean;
}

export function readSnapshot(req: unknown): RequestSnapshot | null {
  if (typeof req !== "object" || req === null) return null;
  const s = (req as Record<string, unknown>)["snapshot"];
  if (typeof s !== "object" || s === null) return null;
  const o = s as Record<string, unknown>;
  const n = (k: string): number | undefined => num(o[k]);
  const b = (k: string): boolean | undefined => (typeof o[k] === "boolean" ? (o[k] as boolean) : undefined);
  const t = o["timeouts"] as Record<string, unknown> | undefined;
  const clock = n("clock") ?? n("clockSeconds");
  const period = n("period") ?? n("quarter");
  const running = b("clockRunning") ?? b("running");
  const runoff = n("runoffSeconds") ?? n("runoff") ?? 0;
  const home = num(t?.["home"]);
  const away = num(t?.["away"]);
  const down = n("down");
  const distance = n("distance");
  const spot = n("spot");
  if (clock === undefined || period === undefined || running === undefined || home === undefined || away === undefined || down === undefined || distance === undefined || spot === undefined) return null;
  return { clock, clockRunning: running, period, timeouts: { home, away }, down, distance, spot, runoffSeconds: runoff, twoMinuteWarning: b("twoMinuteWarning") ?? false, aiTimeout: b("aiTimeout") ?? false };
}

// ---------------------------------------------------------------- hooks for milestones F and G

/** ASSUMED until milestone F: the trace's `standout` entry (field names from the spec). */
export interface Standout {
  readonly player: string;
  readonly number: number;
  readonly rating: string;
  readonly value: number;
  readonly kind: string;
  readonly multiplier: number;
}

/** ASSUMED until milestone G: `detail.closeCall` as the UI may see it, never the verdict. */
export interface CloseCall {
  readonly kind: string;
  readonly question: string;
}

export type TraceEntry = { readonly factor: string } & Readonly<Record<string, string | number | boolean>>;

/** What the UI reads from a PlayResult's `detail`, each field checked and dropped when malformed. */
export interface PlayDetail {
  readonly why?: string;
  readonly headline?: string;
  readonly trace?: readonly TraceEntry[];
  readonly participants?: Participants;
  readonly onField?: OnFieldSlots;
  readonly standout?: Standout;
  readonly closeCall?: CloseCall;
  readonly class?: string;
  readonly yards?: number;
  readonly gross?: number;
  readonly distance?: number;
  readonly fluke?: boolean;
  /** Future pipeline milestone (spec need 3): absent today, drawn neutral. */
  readonly passLocation?: "left" | "middle" | "right";
  readonly airYards?: number;
  readonly runLocation?: "left" | "middle" | "right";
  readonly fumbleSpot?: number;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const side = (v: unknown): "left" | "middle" | "right" | undefined => (v === "left" || v === "middle" || v === "right" ? v : undefined);

const POSITION_ORDER: readonly Position[] = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"];

function participantsOf(v: unknown): Participants | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const r of PARTICIPANT_ROLES) if (typeof o[r] === "string") out[r] = o[r];
  if (Array.isArray(o["foulers"]) && o["foulers"].every((x) => typeof x === "string")) out["foulers"] = o["foulers"];
  return out as Participants;
}

function slotsOf(v: unknown): OnFieldSlot[] | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const out: OnFieldSlot[] = [];
  for (const pos of POSITION_ORDER) {
    const ids = o[pos];
    if (ids === undefined) continue;
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) return undefined;
    ids.forEach((id: string, i) => out.push({ slot: `${pos}${i + 1}`, position: pos, id }));
  }
  return out;
}

/** The engine's onField (position -> ids in slot order) as slot lists. */
export function onFieldSlots(v: EngineOnField | unknown): OnFieldSlots | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const offense = slotsOf(o["offense"]);
  const defense = slotsOf(o["defense"]);
  return offense === undefined || defense === undefined ? undefined : { offense, defense };
}

function standoutOf(trace: readonly TraceEntry[] | undefined, v: unknown): Standout | undefined {
  const e = (typeof v === "object" && v !== null ? v : trace?.find((t) => t.factor === "standout")) as Record<string, unknown> | undefined;
  if (e === undefined) return undefined;
  const player = str(e["player"]);
  const number = num(e["number"]);
  const rating = str(e["rating"]);
  const value = num(e["value"]);
  if (player === undefined || number === undefined || rating === undefined || value === undefined) return undefined;
  return { player, number, rating, value, kind: str(e["kind"]) ?? "", multiplier: num(e["multiplier"]) ?? 1 };
}

/** Reads a PlayResult's detail. Unknown or malformed fields are left out, never guessed. */
export function readDetail(play: PlayResult): PlayDetail {
  const d = (play.detail ?? {}) as Record<string, unknown>;
  const trace = Array.isArray(d["trace"]) ? (d["trace"] as TraceEntry[]) : undefined;
  const out: Record<string, unknown> = {};
  const put = (k: string, v: unknown): void => {
    if (v !== undefined) out[k] = v;
  };
  put("why", str(d["why"]));
  put("headline", str(d["headline"]));
  put("trace", trace);
  put("participants", participantsOf(d["participants"]));
  put("onField", onFieldSlots(d["onField"]));
  put("standout", standoutOf(trace, d["standout"]));
  const cc = d["closeCall"] as Record<string, unknown> | undefined;
  if (typeof cc === "object" && cc !== null && typeof cc["kind"] === "string" && typeof cc["question"] === "string") put("closeCall", { kind: cc["kind"], question: cc["question"] });
  put("class", str(d["class"]));
  put("yards", num(d["yards"]));
  put("gross", num(d["gross"]));
  put("distance", num(d["distance"]));
  if (typeof d["fluke"] === "boolean") put("fluke", d["fluke"]);
  put("passLocation", side(d["passLocation"]));
  put("airYards", num(d["airYards"]));
  put("runLocation", side(d["runLocation"]));
  put("fumbleSpot", num(d["fumbleSpot"]));
  return out as PlayDetail;
}
