// The engine interface the app codes against, as docs/specs/m2-engine-and-game-loop.md (milestones
// A to G) and docs/specs/m2-playable-game-design.md ("Needs from the engine") name it. Every
// shape here that the specs leave open is an assumption, marked ASSUMED, so the real engine can
// replace adapter.ts and the shapes can be checked in one place. Plain types only: the UI thread
// and the worker both import this file, and nothing here pulls in the sim.

import type { PlayResult, Player, Position, TeamPool } from "@clipboard-football/shared";
import type { GameEvent, GameState, PenaltyOption, Snapshot, Team } from "@clipboard-football/sim";

export type { GameEvent, GameState, PenaltyOption, Snapshot, Team };
export type PlayEvent = Extract<GameEvent, { t: "play" }>;

// ---------------------------------------------------------------- players (milestone A)

/** Player schema version 2 adds `number` (milestone A). Version 1 players have none. */
export type NumberedPlayer = Player & { readonly number?: number };

// ---------------------------------------------------------------- who made the play (milestone B)

/** Roles in `detail.participants`, in the order the spec lists them. A role that didn't happen is absent. */
export const PARTICIPANT_ROLES = [
  "passer",
  "target",
  "receiver",
  "ballCarrier",
  "tackler",
  "sacker",
  "interceptor",
  "fumbleForcer",
  "fumbleRecoverer",
  "kicker",
  "punter",
  "returner",
] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

/** `detail.participants`: player ids by role, plus one fouling player per foul (`foulers[i]` for `fouls[i]`, ASSUMED). */
export type Participants = Readonly<Partial<Record<ParticipantRole, string>>> & { readonly foulers?: readonly string[] };

/** One player on the field for a play. ASSUMED shape: the spec says "both sides' players by slot". */
export interface OnFieldSlot {
  /** Slot label, for example "WR2"; position plus its index in pool order. */
  readonly slot: string;
  readonly position: Position;
  readonly id: string;
}

/** `detail.onField`, sides relative to the play (the offense snapped or kicked). */
export interface OnField {
  readonly offense: readonly OnFieldSlot[];
  readonly defense: readonly OnFieldSlot[];
}

// ---------------------------------------------------------------- standout plays (milestone F, hook)

/** The trace's `standout` entry. Field names as the spec lists them; the key names are ASSUMED. */
export interface Standout {
  readonly player: string;
  readonly number: number;
  readonly rating: string;
  readonly value: number;
  readonly kind: string;
  readonly multiplier: number;
}

// ---------------------------------------------------------------- challenges (milestone G, hook)

/** `detail.closeCall` as the UI may see it: never the verdict (spec G6). ASSUMED key names. */
export interface CloseCall {
  readonly kind: string;
  /** Key of the prompt's question ("downBeforeFumble"); the text lives in UI copy. */
  readonly question: string;
}

/** One trace entry; the factor names and fields are TRACE_FIELDS in packages/shared. */
export type TraceEntry = { readonly factor: string } & Readonly<Record<string, string | number | boolean>>;

/** What the UI reads from a PlayResult's `detail`, each field checked and dropped when malformed. */
export interface PlayDetail {
  /** The step 4 sentence, with multipliers: the details view's detail line. */
  readonly why?: string;
  /** Milestone D: the plain-words headline, the why line on screen. ASSUMED key `headline`. */
  readonly headline?: string;
  readonly trace?: readonly TraceEntry[];
  readonly participants?: Participants;
  readonly onField?: OnField;
  readonly standout?: Standout;
  readonly closeCall?: CloseCall;
  readonly classProbabilities?: readonly number[];
  readonly class?: string;
  readonly yards?: number;
  readonly gross?: number;
  readonly returnYards?: number;
  readonly distance?: number;
  readonly fluke?: boolean;
  /** Future pipeline milestone (spec need 3, out of scope for M2): absent today, drawn neutral. */
  readonly passLocation?: "left" | "middle" | "right";
  readonly airYards?: number;
  readonly runLocation?: "left" | "middle" | "right";
  readonly fumbleSpot?: number;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const side = (v: unknown): "left" | "middle" | "right" | undefined => (v === "left" || v === "middle" || v === "right" ? v : undefined);

function participantsOf(v: unknown): Participants | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const r of PARTICIPANT_ROLES) if (typeof o[r] === "string") out[r] = o[r];
  if (Array.isArray(o["foulers"]) && o["foulers"].every((x) => typeof x === "string")) out["foulers"] = o["foulers"];
  return out as Participants;
}

function slotsOf(v: unknown): OnFieldSlot[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const ok = v.every((x) => typeof x === "object" && x !== null && typeof (x as OnFieldSlot).id === "string" && typeof (x as OnFieldSlot).position === "string" && typeof (x as OnFieldSlot).slot === "string");
  return ok ? (v as OnFieldSlot[]) : undefined;
}

function onFieldOf(v: unknown): OnField | undefined {
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
  put("onField", onFieldOf(d["onField"]));
  put("standout", standoutOf(trace, d["standout"]));
  const cc = d["closeCall"] as Record<string, unknown> | undefined;
  if (cc !== undefined && typeof cc === "object" && cc !== null && typeof cc["kind"] === "string" && typeof cc["question"] === "string") put("closeCall", { kind: cc["kind"], question: cc["question"] });
  if (Array.isArray(d["classProbabilities"])) put("classProbabilities", d["classProbabilities"]);
  put("class", str(d["class"]));
  put("yards", num(d["yards"]));
  put("gross", num(d["gross"]));
  put("returnYards", num(d["returnYards"]));
  put("distance", num(d["distance"]));
  if (typeof d["fluke"] === "boolean") put("fluke", d["fluke"]);
  put("passLocation", side(d["passLocation"]));
  put("airYards", num(d["airYards"]));
  put("runLocation", side(d["runLocation"]));
  put("fumbleSpot", num(d["fumbleSpot"]));
  return out as PlayDetail;
}

// ---------------------------------------------------------------- the step-wise loop (milestone E)

export type Tempo = "hurryUp" | "normal" | "runClock";

/**
 * Why an option is off. ASSUMED codes: the spec says "a reason code for each option that is
 * off" without naming them. The UI's text for each is in ui/text.ts.
 */
export type ReasonCode =
  | "kickWindow"
  | "notOnTry"
  | "onlyRunPassOnTry"
  | "noTimeouts"
  | "timeoutTaken"
  | "noEarlierCall"
  | "sameCallIllegal"
  | "onsideNotAllowed"
  | "notNow";

export interface Option {
  readonly id: string;
  readonly on: boolean;
  readonly reason?: ReasonCode;
}

/** A call as the loop takes it: the step 2 OffenseCall, or a defense preset id. */
export interface OffenseCallAnswer {
  readonly call: string;
  readonly formation?: string;
  readonly twoPointPlay?: string;
}

export interface SameCall {
  readonly on: boolean;
  readonly reason?: ReasonCode;
  /** The exact call Same call submits (decision 10, F6). */
  readonly offense?: OffenseCallAnswer;
  readonly defense?: string;
}

export interface TimeoutOption {
  readonly on: boolean;
  /** Timeouts the human's team has left. */
  readonly left: number;
  readonly reason?: ReasonCode;
}

/** A penalty option with the state it leaves (step 5 revision 11 previews). */
export interface PenaltyChoice {
  readonly option: PenaltyOption;
  readonly after: Pick<GameState, "phase" | "possession" | "spot" | "down" | "distance" | "score">;
}

/** The snap that already happened, sent with a request that comes after it (penalty, challenge). */
export interface PendingPlay {
  readonly before: Snapshot;
  readonly offense: OffenseCallAnswer;
  readonly defense: string | null;
  readonly play: PlayResult;
}

/**
 * What a "continue" dead ball shows: the opponent lines up to kick, kneel or spike (the only part
 * of its call you can see before the snap, design decision 17), or "clock": nothing to call and
 * the clock runs, but you could still stop it with a timeout.
 */
export type LineUp = "kickoff" | "onsideKick" | "punt" | "fieldGoal" | "extraPoint" | "kneel" | "spike" | "clock";

interface RequestBase {
  /** Increments with each request; an answer names the request it answers. */
  readonly seq: number;
  /** The human's team. */
  readonly team: Team;
  /** The game as the human sees it at this dead ball (before any run-off). */
  readonly view: Snapshot;
  /** T on the first screen of this request. */
  readonly timeout: TimeoutOption;
}

export type DecisionRequest =
  | (RequestBase & {
      readonly kind: "offenseCall";
      /** Every leaf call in catalog order with availability: plays, kicks, clock plays. */
      readonly calls: readonly Option[];
      readonly sameCall: SameCall;
      readonly tempo: Tempo;
      /** Field goal distance from this spot, in yards, for the Kick menu ("Field goal (47 yd)"). */
      readonly fieldGoalDistance: number;
    })
  | (RequestBase & {
      readonly kind: "try";
      /** extraPoint and goForTwo. */
      readonly options: readonly Option[];
      /** The two-point plays (run and pass leaves) and Same call for the two-point Play type screen. */
      readonly calls: readonly Option[];
      readonly sameCall: SameCall;
    })
  | (RequestBase & { readonly kind: "defenseCall"; readonly calls: readonly Option[]; readonly sameCall: SameCall; readonly twoPoint: boolean })
  | (RequestBase & { readonly kind: "kickoffType"; readonly options: readonly Option[]; readonly safetyKick: boolean })
  | (RequestBase & { readonly kind: "continue"; readonly lineUp: LineUp })
  | (RequestBase & { readonly kind: "penaltyChoice"; readonly choices: readonly PenaltyChoice[]; readonly pending: PendingPlay })
  // Hooks for kinds the adapter never sends yet (coin toss choice, overtime choice, ten-second
  // run-off, challenge). The screens exist; the M2 loop (milestones E and G) will send them.
  | (RequestBase & { readonly kind: "coinToss"; readonly options: readonly Option[] })
  | (RequestBase & { readonly kind: "overtimeChoice"; readonly options: readonly Option[] })
  | (RequestBase & { readonly kind: "runoff"; readonly seconds: number; readonly clockAfter: number })
  | (RequestBase & { readonly kind: "challenge"; readonly closeCall: CloseCall; readonly pending: PendingPlay });

export type RequestKind = DecisionRequest["kind"];

export type Answer =
  | { readonly kind: "offense"; readonly call: OffenseCallAnswer }
  | { readonly kind: "defense"; readonly call: string }
  | { readonly kind: "timeout" }
  | { readonly kind: "continue" }
  | { readonly kind: "penalty"; readonly index: number }
  | { readonly kind: "tempo"; readonly tempo: Tempo }
  // Hooks (never accepted by the adapter yet).
  | { readonly kind: "toss"; readonly choice: string }
  | { readonly kind: "runoff"; readonly useTimeout: boolean }
  | { readonly kind: "challenge"; readonly throwFlag: boolean };

// ---------------------------------------------------------------- per-player box score (milestone C)

/** A stat line value: absent means "no stat" (shown as a dash), distinct from 0 (spec C4). */
export interface PassingLine {
  completions: number;
  attempts: number;
  yards: number;
  touchdowns: number;
  interceptions: number;
  sacked: number;
}
export interface RushingLine {
  attempts: number;
  yards: number;
  touchdowns: number;
  long: number;
}
export interface ReceivingLine {
  targets: number;
  catches: number;
  yards: number;
  touchdowns: number;
  long: number;
}
export interface DefenseLine {
  tackles: number;
  sacks: number;
  interceptions: number;
  forcedFumbles: number;
  recoveries: number;
}
export interface KickingLine {
  fieldGoalsMade: number;
  fieldGoalAttempts: number;
  long: number;
  extraPointsMade: number;
  extraPointAttempts: number;
  punts: number;
  puntYards: number;
}

export interface PlayerLine {
  readonly id: string;
  readonly team: Team;
  passing?: PassingLine;
  rushing?: RushingLine;
  receiving?: ReceivingLine;
  defense?: DefenseLine;
  kicking?: KickingLine;
}

/** League-wide rank of one rating at the player's position (spec need 11, milestone C6). */
export interface RatingRank {
  readonly rating: string;
  readonly value: number;
  /** 1 is best. Ties share the best rank (ASSUMED tie rule until C6 documents one). */
  readonly rank: number;
  readonly of: number;
}

export interface TeamInfo {
  readonly name: string;
  readonly place: string;
  readonly nickname: string;
  readonly pool: TeamPool;
}
