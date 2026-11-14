// Every string the HUD and the panel show about the game: clock, down and distance, the result,
// calls and event lines, off-choice reasons. Pure functions of the engine's records; nothing here
// decides or invents a fact. A role the engine didn't name is left out of the text (spec H2).

import type { PlayResult } from "@clipboard-football/shared";
import type { Catalog } from "@clipboard-football/shared";
import { readDetail, type ContinueAbout, type RequestEvent, type GameEvent, type OffenseCallChoice, type PenaltyPreview, type PlayEvent, type ReasonCode, type Snapshot, type Team, type Tempo } from "../engine/types";

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
      // Plain words for what happened to the kick, from the engine's class and the result.
      const k = who(parts.kicker);
      const r = who(parts.returner);
      const head = play.kind === "onsideKick" ? (k === undefined ? "Onside kick" : `${k} kicks onside`) : k === undefined ? "Kickoff" : `${k} kicks off`;
      const by = r === undefined ? "" : ` by ${r}`;
      const cls = d.class ?? ("outcome" in play ? play.outcome : "");
      if (play.kind === "onsideKick" || cls.startsWith("onside")) {
        if (cls === "onsideOutOfBounds" || ("outcome" in play && play.outcome === "outOfBounds")) return `${head}, out of bounds`;
        if (after.phase !== "scrimmage") return head;
        return after.possession === off ? `${head}, recovered by the ${ctx.teams[off].nickname}` : `${head}, recovered by the ${ctx.teams[def].nickname}`;
      }
      const KICKOFF: Readonly<Record<string, string>> = {
        touchbackEndZone: "touchback",
        touchbackLandingZone: "touchback",
        short: "short of the landing zone",
        outOfBounds: "out of bounds",
        fairCatch: `fair catch${by}`,
        returned: r === undefined ? "returned" : `returned${by}`,
        returnTD: `returned for a touchdown${by}`,
        kickersRecover: `recovered by the ${ctx.teams[off].nickname}`,
      };
      const what = KICKOFF[cls];
      return what === undefined ? head : `${head}, ${what}`;
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

function callLabel(o: OffenseCallChoice, ctx: TextCtx): string {
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


/** Lines for the events a request says happened before it in this dead ball. */
export function requestEventLine(ev: RequestEvent, ctx: TextCtx): string {
  switch (ev.t) {
    case "runoff":
      return `Clock ran ${ev.seconds} s before the snap.`;
    case "timeout":
      return `Timeout, ${ctx.teams[ev.team].nickname} (${ev.left} left).`;
    case "twoMinuteWarning":
      return "Two-minute warning.";
    case "endPeriod":
      return ev.period < ctx.regulationPeriods ? `End of the ${periodText(ev.period, ctx.regulationPeriods)} quarter.` : ev.period === ctx.regulationPeriods ? "End of regulation." : "End of overtime.";
  }
}

/** Text for an off choice's reason (the engine's ReasonCode). */
export function reasonText(code: ReasonCode | undefined): string {
  switch (code) {
    case "kickNotNow":
      return "4th down or last 2:00 only";
    case "notOnTry":
      return "not on a try";
    case "noTimeouts":
      return "No timeouts left";
    case "timeoutTaken":
      return "one timeout per dead ball";
    case "timeoutNotAllowed":
      return "the rules don't allow it here";
    case "noEarlierCall":
      return "no earlier call";
    case "lastCallNotLegal":
      return "last call not allowed now";
    case "onsideNotAllowed":
      return "not allowed now";
    case undefined:
      return "not now";
  }
}

/** What a "continue" dead ball says (design decision 17). */
export function continueText(about: ContinueAbout, ctx: TextCtx): string {
  switch (about.what) {
    case "tossResult": {
      const who = about.winner === ctx.human ? "You won the toss" : `The ${ctx.teams[about.winner].nickname} won the toss`;
      return `${who} and chose to ${about.choice}.`;
    }
    case "theyKickOff": {
      const them = ctx.teams[other(ctx.human)].nickname;
      if (about.onside) return `The ${them} declare an onside kick.`;
      return about.safetyKick ? `The ${them} free kick after the safety.` : `The ${them} kick off.`;
    }
    case "theyLineUp": {
      const them = ctx.teams[other(ctx.human)].nickname;
      const what: Readonly<Record<string, string>> = { punt: "to punt", fieldGoal: "for a field goal", extraPoint: "for the extra point", kneel: "to kneel", spike: "to spike it" };
      return `The ${them} line up ${what[about.call] ?? `for ${ctx.labels[about.call] ?? about.call}`}.`;
    }
  }
}

export function tempoText(t: Tempo): string {
  return t === "hurryUp" ? "Hurry-up" : t === "runClock" ? "Run the clock" : "Normal";
}

/** A penalty option row: "Accept holding: 1st & 10 at OPP 33". Option ids are the engine's ("accept:0", "decline", "offset"). */
export function penaltyChoiceText(option: string, after: PenaltyPreview, ctx: TextCtx, fouls: PlayResult["fouls"]): string {
  const where =
    after.phase === "scrimmage"
      ? `${ordinal(after.down)} & ${after.distance} at ${yardLineText(after.spot, after.possession, ctx.human)}${after.possession === ctx.human ? "" : `, ${ctx.teams[after.possession].nickname} ball`}`
      : after.phase === "try"
        ? "try next"
        : after.phase === "kickoff"
          ? "kickoff next"
          : after.phase;
  if (option === "decline") return `Decline: ${where}`;
  if (option === "offset") return `Offset: ${where}`;
  const m = /^accept:(\d+)$/.exec(option);
  const f = m === null ? undefined : fouls?.[Number(m[1])];
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
