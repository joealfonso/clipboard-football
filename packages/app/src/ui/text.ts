// Every string the HUD and the panel show about the game: clock, down and distance, the result,
// calls and event lines, off-choice reasons. Pure functions of the engine's records; nothing here
// decides or invents a fact. A role the engine didn't name is left out of the text (spec H2).

import type { PlayResult } from "@clipboard-football/shared";
import type { Catalog } from "@clipboard-football/shared";
import { readDetail, type GameEvent, type LineUp, type OffenseCallAnswer, type PenaltyChoice, type PlayEvent, type ReasonCode, type Snapshot, type Team, type Tempo } from "../engine/types";

export interface TeamText {
  readonly name: string;
  readonly nickname: string;
}

export interface PlayerText {
  readonly name: string;
  readonly number: number;
}

/** What the text needs to name things. */
export interface TextCtx {
  readonly human: Team;
  readonly teams: Readonly<Record<Team, TeamText>>;
  readonly players: ReadonlyMap<string, PlayerText>;
  /** Catalog labels by choice id, plus why.json labels (formations, penalties, classes). */
  readonly labels: Readonly<Record<string, string>>;
  readonly regulationPeriods: number;
  readonly endZoneYards: number;
}

export const other = (t: Team): Team => (t === "home" ? "away" : "home");

export function clockText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ordinal(n: number): string {
  return ["", "1st", "2nd", "3rd", "4th"][n] ?? `${n}th`;
}

export function periodText(period: number, regulation: number): string {
  if (period <= regulation) return ordinal(period);
  const ot = period - regulation;
  return ot === 1 ? "OT" : `OT${ot}`;
}

/**
 * A yard line from the human's side of the field: "OWN 20", "OPP 38" or "50". `spot` is in the
 * frame of `possession` (yards from its own goal line). OPP always means the opponent's half.
 */
export function yardLineText(spot: number, possession: Team, human: Team): string {
  if (spot === 50) return "50";
  const inPossessorsHalf = spot < 50;
  const yards = inPossessorsHalf ? spot : 100 - spot;
  const humansHalf = inPossessorsHalf === (possession === human);
  return `${humansHalf ? "OWN" : "OPP"} ${yards}`;
}

/** The situation header: "3rd & 4 at OPP 38", "1st & goal at OPP 9", "Kickoff". */
export function situationText(s: Snapshot, human: Team): string {
  switch (s.phase) {
    case "kickoff":
      return s.safetyKick ? "Safety kick" : "Kickoff";
    case "try":
      return "Try";
    case "overtimeToss":
      return "Overtime coin toss";
    case "final":
      return "Final";
    case "scrimmage":
      return `${ordinal(s.down)} & ${s.goalToGo ? "goal" : s.distance} at ${yardLineText(s.spot, s.possession, human)}`;
  }
}

export function sideText(s: Snapshot, human: Team): string {
  if (s.phase === "kickoff") return s.possession === human ? "You're kicking off" : "You're receiving";
  if (s.phase === "final" || s.phase === "overtimeToss") return "";
  return s.possession === human ? "You're on offense" : "You're on defense";
}

/** "#81 D. Okafor", or undefined when the engine named nobody (never a made-up name). */
export function playerRef(id: string | undefined, ctx: TextCtx): string | undefined {
  if (id === undefined) return undefined;
  const p = ctx.players.get(id);
  if (p === undefined) return undefined;
  const parts = p.name.split(" ");
  const last = parts.slice(1).join(" ") || p.name;
  const first = parts.length > 1 ? `${(parts[0] ?? "").charAt(0)}. ` : "";
  return `#${p.number} ${first}${last}`;
}

function yardsPhrase(y: number): string {
  if (y === 0) return "no gain";
  if (y < 0) return `a loss of ${-y}`;
  return String(y);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function gainOf(ev: PlayEvent): number {
  const { play, before } = ev;
  const d = readDetail(play);
  if (!("end" in play) || play.end === undefined) return 0;
  if (d.yards !== undefined && play.end.possession === "offense") return Math.min(d.yards, 100 - before.spot);
  return Math.max(0, Math.min(100, play.end.spot)) - before.spot;
}

const KICK_CLASS_TEXT: Readonly<Record<string, string>> = {
  touchback: "touchback",
  touchbackEndZone: "touchback",
  touchbackLandingZone: "touchback",
  fairCatchShort: "fair catch",
  fairCatchLong: "fair catch",
  fairCatch: "fair catch",
  muffed: "muffed",
  downed: "downed",
  outOfBounds: "out of bounds",
  blocked: "blocked",
};

/** The part of the result line that says what physically happened. */
export function playText(ev: PlayEvent, ctx: TextCtx): string {
  const { play, before, after } = ev;
  const parts = readDetail(play).participants ?? {};
  const who = (id: string | undefined): string | undefined => playerRef(id, ctx);
  const off = before.possession;
  const def = other(off);
  const lost = "end" in play && play.end !== undefined && play.end.possession === "defense";
  const d = readDetail(play);
  const fumbled = d.class === "fumble" || d.class === "fumbleCatch" || ("turnover" in play && play.turnover === "fumble");
  const recovered = (): string => {
    const r = who(parts.fumbleRecoverer);
    if (r !== undefined) return `fumble, recovered by ${r}`;
    return lost ? `fumble, recovered by the ${ctx.teams[def].nickname}` : `fumble, recovered by the ${ctx.teams[off].nickname}`;
  };
  const y = (): string => yardsPhrase(gainOf(ev));
  switch (play.kind) {
    case "run": {
      const c = who(parts.ballCarrier);
      const base = c === undefined ? `Run for ${y()}` : `${c} for ${y()}`;
      return fumbled ? `${base}, ${recovered()}` : base;
    }
    case "scramble": {
      const c = who(parts.ballCarrier ?? parts.passer);
      const base = c === undefined ? `Scramble for ${y()}` : `${c} scrambles for ${y()}`;
      return fumbled ? `${base}, ${recovered()}` : base;
    }
    case "sack": {
      const q = who(parts.passer);
      const s = who(parts.sacker);
      const base = `${q ?? "Quarterback"} sacked${s === undefined ? "" : ` by ${s}`} for ${y()}`;
      return fumbled ? `${base}, ${recovered()}` : base;
    }
    case "pass": {
      const q = who(parts.passer);
      if (play.turnover === "interception") {
        const i = who(parts.interceptor);
        return q === undefined ? `Intercepted${i === undefined ? "" : ` by ${i}`}` : `${q} intercepted${i === undefined ? "" : ` by ${i}`}`;
      }
      if (play.incomplete === true) {
        const t = who(parts.target);
        return `${q === undefined ? "Pass" : q} incomplete${t === undefined ? "" : `, intended for ${t}`}`;
      }
      const r = who(parts.receiver);
      const base = q !== undefined && r !== undefined ? `${q} to ${r} for ${y()}` : r !== undefined ? `Pass to ${r} for ${y()}` : q !== undefined ? `${q} complete for ${y()}` : `Pass complete for ${y()}`;
      return fumbled ? `${base}, ${recovered()}` : base;
    }
    case "kneel":
      return `${who(parts.ballCarrier ?? parts.passer) ?? "Quarterback"} kneels`;
    case "spike":
      return `${who(parts.passer) ?? "Quarterback"} spikes it, clock stopped`;
    case "punt": {
      const k = who(parts.punter);
      const cls = d.class === undefined ? undefined : KICK_CLASS_TEXT[d.class];
      let t = `${k === undefined ? "Punt" : `${k} punts`}${d.gross === undefined ? "" : ` ${d.gross} yards`}`;
      if (cls !== undefined) t += `, ${cls}`;
      const r = who(parts.returner);
      if (r !== undefined && cls === undefined) t += `, returned by ${r}`;
      return t;
    }
    case "fieldGoal": {
      const k = who(parts.kicker);
      const dist = 100 - play.kickSpot + ctx.endZoneYards;
      const blocked = d.class === "blocked";
      return `${k === undefined ? "" : `${k}: `}${dist}-yard field goal ${blocked ? "blocked" : play.good ? "is good" : "is no good"}`;
    }
    case "extraPoint": {
      const k = who(parts.kicker);
      const good = after.score[off] - before.score[off] === 1;
      return `${k === undefined ? "" : `${k}: `}extra point ${good ? "is good" : "is no good"}`;
    }
    case "twoPoint": {
      const good = after.score[off] - before.score[off] === 2;
      return `Two-point try ${good ? "is good" : "fails"}`;
    }
    case "kickoff":
    case "onsideKick": {
      const k = who(parts.kicker);
      const lbl = d.class === undefined ? undefined : (ctx.labels[d.class] ?? KICK_CLASS_TEXT[d.class]);
      let t = play.kind === "onsideKick" ? "Onside kick" : "Kickoff";
      if (k !== undefined) t = `${k}: ${t.toLowerCase()}`;
      if (lbl !== undefined) t += `, ${lbl}`;
      const r = who(parts.returner);
      if (r !== undefined) t += `, returned by ${r}`;
      if (play.kind === "onsideKick" && after.phase === "scrimmage") t += after.possession === off ? `, recovered by the ${ctx.teams[off].nickname}` : `, recovered by the ${ctx.teams[def].nickname}`;
      return t;
    }
    case "noPlay":
      return "No play";
  }
}

function foulTeam(ev: PlayEvent, by: "offense" | "defense"): Team {
  return by === "offense" ? ev.before.possession : other(ev.before.possession);
}

/** "Flag: holding on the Lanterns (#72 B. Cole), accepted." Names the fouling player only when the engine did. */
export function penaltyText(ev: PlayEvent, ctx: TextCtx): string {
  const fouls = ev.play.fouls ?? [];
  if (fouls.length === 0) return "";
  const foulers = readDetail(ev.play).participants?.foulers ?? [];
  const names = fouls
    .map((f, i) => {
      const who = playerRef(foulers[i], ctx);
      return `${(ctx.labels[f.penalty] ?? f.penalty).toLowerCase()} on the ${ctx.teams[foulTeam(ev, f.by)].nickname}${who === undefined ? "" : ` (${who})`}`;
    })
    .join(" and ");
  if (ev.penalty === null || ev.penalty.kind === "offset") return fouls.length > 1 ? `Offsetting fouls: ${names}. Replay the down.` : `Flag: ${names}.`;
  return `Flag: ${names}, ${ev.penalty.kind === "decline" ? "declined" : "accepted"}.`;
}

/** What comes next, from the state after the play. */
export function nextText(after: Snapshot, ctx: TextCtx): string {
  switch (after.phase) {
    case "scrimmage": {
      const s = situationText(after, ctx.human);
      return after.possession === ctx.human ? `Your ball, ${s}.` : `${ctx.teams[after.possession].nickname} ball, ${s}.`;
    }
    case "try":
      return "Try next.";
    case "kickoff":
      return after.safetyKick ? "Safety kick next." : "Kickoff next.";
    case "overtimeToss":
      return "Overtime coin toss next.";
    case "final":
      return "Final.";
  }
}

/** The result line: what happened, the score it made, the flag, then where things stand. */
export function resultLine(ev: PlayEvent, ctx: TextCtx): string {
  const { before, after, play } = ev;
  const off = before.possession;
  const def = other(off);
  const out: string[] = [];
  const d = readDetail(play);
  const head = cap(playText(ev, ctx)) + ".";
  out.push(d.standout === undefined ? head : `Standout: ${head}`);
  const gOff = after.score[off] - before.score[off];
  const gDef = after.score[def] - before.score[def];
  if (play.kind !== "extraPoint" && play.kind !== "twoPoint" && play.kind !== "fieldGoal") {
    if (gOff >= 6) out.push("Touchdown.");
    if (gDef >= 6) out.push(`Touchdown, ${ctx.teams[def].nickname}.`);
    if (gDef === 2 && after.safetyKick) out.push("Safety.");
  }
  // A score the physical play reached that a penalty took away.
  const reached = "end" in play && play.end !== undefined && play.end.possession === "offense" && play.end.spot >= 100 && before.phase === "scrimmage";
  if (reached && gOff < 6) out.push("The touchdown doesn't count.");
  const p = penaltyText(ev, ctx);
  if (p !== "") out.push(p);
  out.push(nextText(after, ctx));
  return out.join(" ");
}

function callLabel(o: OffenseCallAnswer, ctx: TextCtx): string {
  const leaf = o.call === "goForTwo" ? o.twoPointPlay : o.call;
  const name = ctx.labels[leaf ?? ""] ?? leaf ?? o.call;
  const form = o.formation === undefined ? "" : `${ctx.labels[o.formation] ?? o.formation}, `;
  return o.call === "goForTwo" ? `Go for two, ${form}${name}` : `${form}${name}`;
}

/** "You: Shotgun, Short pass. They: Nickel Cover 1 Blitz." Shown only after the snap. */
export function callsLine(ev: PlayEvent, ctx: TextCtx): string {
  const offense = callLabel(ev.offense, ctx);
  const defense = ev.defense === null ? "no call" : (ctx.labels[ev.defense] ?? ev.defense);
  const humanOnOffense = ev.before.possession === ctx.human;
  return humanOnOffense ? `You: ${offense}. They: ${defense}.` : `You: ${defense}. They: ${offense}.`;
}

/** Lines for loop events that need no key; null for play events. */
export function eventLine(ev: GameEvent, ctx: TextCtx): string | null {
  switch (ev.t) {
    case "timeout":
      return `Timeout, ${ctx.teams[ev.team].nickname} (${ev.left} left).`;
    case "runoff":
      return `Clock ran ${ev.seconds} s before the snap.`;
    case "twoMinuteWarning":
      return "Two-minute warning.";
    case "endPeriod":
      return ev.period < ctx.regulationPeriods ? `End of the ${periodText(ev.period, ctx.regulationPeriods)} quarter.` : ev.period === ctx.regulationPeriods ? "End of regulation." : "End of overtime.";
    case "toss":
      return `Overtime coin toss: the ${ctx.teams[ev.winner].nickname} win and choose to ${ev.choice}. The ${ctx.teams[ev.receiver].nickname} receive.`;
    case "play":
      return null;
  }
}

/** Text for an off choice's reason. */
export function reasonText(code: ReasonCode | undefined): string {
  switch (code) {
    case "kickWindow":
      return "4th down or last 2:00 only";
    case "notOnTry":
      return "not on a try";
    case "onlyRunPassOnTry":
      return "only a run or pass on a two-point try";
    case "noTimeouts":
      return "No timeouts left";
    case "timeoutTaken":
      return "one timeout per dead ball";
    case "noEarlierCall":
      return "no earlier call";
    case "sameCallIllegal":
      return "last call not allowed now";
    case "onsideNotAllowed":
      return "not allowed now";
    case "notNow":
    case undefined:
      return "not now";
  }
}

export function lineUpText(l: LineUp, team: TeamText): string {
  switch (l) {
    case "kickoff":
      return `The ${team.nickname} kick off.`;
    case "onsideKick":
      return `The ${team.nickname} declare an onside kick.`;
    case "punt":
      return `The ${team.nickname} line up to punt.`;
    case "fieldGoal":
      return `The ${team.nickname} line up for a field goal.`;
    case "extraPoint":
      return `The ${team.nickname} line up for the extra point.`;
    case "kneel":
      return `The ${team.nickname} line up to kneel.`;
    case "spike":
      return `The ${team.nickname} line up to spike it.`;
    case "clock":
      return "The clock is running.";
  }
}

export function tempoText(t: Tempo): string {
  return t === "hurryUp" ? "Hurry-up" : t === "runClock" ? "Run the clock" : "Normal";
}

/** A penalty option row: "Accept: 1st & 10 at OPP 33". */
export function penaltyChoiceText(c: PenaltyChoice, ctx: TextCtx, fouls: PlayResult["fouls"]): string {
  const where =
    c.after.phase === "scrimmage"
      ? `${ordinal(c.after.down)} & ${c.after.distance} at ${yardLineText(c.after.spot, c.after.possession, ctx.human)}${c.after.possession === ctx.human ? "" : `, ${ctx.teams[c.after.possession].nickname} ball`}`
      : c.after.phase === "try"
        ? "try next"
        : c.after.phase === "kickoff"
          ? "kickoff next"
          : c.after.phase;
  if (c.option.kind === "decline") return `Decline: ${where}`;
  if (c.option.kind === "offset") return `Offset: ${where}`;
  const f = fouls?.[c.option.foul];
  const name = f === undefined ? "" : ` ${(ctx.labels[f.penalty] ?? f.penalty).toLowerCase()}`;
  return `Accept${name}: ${where}`;
}

/** Labels for every catalog choice id. */
export function catalogLabels(catalog: Catalog): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of catalog.screens) for (const c of s.choices) out[c.id] = c.label;
  return out;
}

/** The team's short name for the scoreboard. */
export function abbrev(t: TeamText): string {
  return t.nickname.toUpperCase();
}
