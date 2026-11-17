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

/** Ids playerRef couldn't find, each warned about once (U2 States: role left out, one console warning per id). */
const unknownIds = new Set<string>();

/** "#81 D. Okafor", or undefined when the engine named nobody (never a made-up name). */
export function playerRef(id: string | undefined, ctx: TextCtx): string | undefined {
  if (id === undefined) return undefined;
  const p = ctx.players.get(id);
  if (p === undefined) {
    if (!unknownIds.has(id)) {
      unknownIds.add(id);
      console.warn(`Player ${id} is in no team's pool: left out of the text.`);
    }
    return undefined;
  }
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

export function gainOf(ev: PlayEvent): number {
  const { play, before } = ev;
  const d = readDetail(play);
  if (!("end" in play) || play.end === undefined) return 0;
  if (d.yards !== undefined && play.end.possession === "offense") return Math.min(d.yards, 100 - before.spot);
  return Math.max(0, Math.min(100, play.end.spot)) - before.spot;
}

const PUNT_CLASS_TEXT: Readonly<Record<string, string>> = {
  touchback: "touchback",
  touchbackEndZone: "touchback",
  touchbackLandingZone: "touchback",
  muffed: "muffed",
  blocked: "blocked",
};

/** The play's dead spot in the field (offense frame), or null when the ball died in an end zone or the play has none. */
function fieldSpot(play: PlayEvent["play"]): number | null {
  if (!("end" in play) || play.end === undefined) return null;
  const s = play.end.spot;
  return s > 0 && s < 100 ? s : null;
}

/**
 * The part of the result line that says what physically happened, naming the players the engine
 * credited (U2, approved by Joseph 2026-11-15, reversing the 2026-11-14 "names don't matter" note).
 * Every name comes from detail.participants; a role the engine didn't name is left out of the
 * sentence, never guessed (M2 design H2).
 */
export function playText(ev: PlayEvent, ctx: TextCtx): string {
  const { play, before, after } = ev;
  const off = before.possession;
  const def = other(off);
  const lost = "end" in play && play.end !== undefined && play.end.possession === "defense";
  const d = readDetail(play);
  const parts = d.participants ?? {};
  const P = (role: keyof typeof parts): string | undefined => (role === "foulers" ? undefined : playerRef(parts[role] as string | undefined, ctx));
  const at = (spot: number): string => yardLineText(spot, off, ctx.human);
  const tackled = (): string => {
    const t = P("tackler");
    return t === undefined ? "" : `, tackled by ${t}`;
  };
  const fumbled = d.class === "fumble" || d.class === "fumbleCatch" || ("turnover" in play && play.turnover === "fumble");
  const withFumble = (base: string): string => {
    if (!fumbled) return base;
    const forcer = P("fumbleForcer");
    const rec = P("fumbleRecoverer");
    const team = ctx.teams[lost ? def : off].nickname;
    return `${base}, fumble${forcer === undefined ? "" : ` forced by ${forcer}`}, recovered by ${rec === undefined ? `the ${team}` : `${rec} (${team})`}`;
  };
  const y = (): string => yardsPhrase(gainOf(ev));
  const runSentence = (verb: "runs" | "scrambles", carrier: string | undefined, fallback: string): string => (carrier === undefined ? `${fallback} for ${y()}` : `${carrier} ${verb} for ${y()}`);
  const passSentence = (): string => {
    const passer = P("passer");
    if (play.kind === "pass" && play.turnover === "interception") {
      const by = P("interceptor");
      const spot = fieldSpot(play);
      return `${passer ?? "Pass"} intercepted${by === undefined ? "" : ` by ${by}`}${spot === null ? "" : `, returned to ${at(spot)}`}${tackled()}`;
    }
    if ("incomplete" in play && play.incomplete === true) {
      const target = P("target");
      return `${passer === undefined ? "Pass" : passer} incomplete${target === undefined ? "" : `, intended for ${target}`}`;
    }
    const catcher = P("receiver") ?? P("target");
    const head = passer === undefined ? (catcher === undefined ? "Pass complete" : `Pass to ${catcher}`) : catcher === undefined ? `${passer} complete` : `${passer} to ${catcher}`;
    return withFumble(`${head} for ${y()}${tackled()}`);
  };
  switch (play.kind) {
    case "run":
      return withFumble(`${runSentence("runs", P("ballCarrier"), "Run")}${tackled()}`);
    case "scramble":
      return withFumble(`${runSentence("scrambles", P("ballCarrier") ?? P("passer"), "Quarterback scrambles")}${tackled()}`);
    case "sack": {
      const by = P("sacker");
      return withFumble(`${P("passer") ?? "Quarterback"} sacked${by === undefined ? "" : ` by ${by}`} for ${y()}`);
    }
    case "pass":
      return passSentence();
    case "kneel": {
      const who = P("ballCarrier") ?? P("passer");
      return who === undefined ? "Quarterback kneels" : `${who} kneels`;
    }
    case "spike": {
      const who = P("passer") ?? P("ballCarrier");
      return `${who ?? "Quarterback"} spikes it, clock stopped`;
    }
    case "punt": {
      const punter = P("punter");
      const returner = P("returner");
      const gross = d.gross === undefined ? "" : `, ${d.gross} yards`;
      const head = `Punt${punter === undefined ? "" : ` by ${punter}`}${gross}`;
      const cls = d.class ?? "";
      const spot = fieldSpot(play);
      const fixed = PUNT_CLASS_TEXT[cls];
      if (fixed !== undefined) return `${head}, ${fixed}`;
      if (cls.startsWith("fairCatch")) return `${head}, fair catch${returner === undefined ? "" : ` by ${returner}`}${spot === null ? "" : ` at ${at(spot)}`}`;
      if (cls.startsWith("downed")) return `${head}, downed${spot === null ? "" : ` at ${at(spot)}`}`;
      if (cls.startsWith("outOfBounds")) return `${head}, out of bounds${spot === null ? "" : ` at ${at(spot)}`}`;
      if (returner !== undefined || cls.startsWith("returned")) {
        // Return yards only when the spots agree (a field clamp can move the end spot after the draw).
        const end = "end" in play && play.end !== undefined ? play.end.spot : null;
        const agree = d.gross !== undefined && d.returnYards !== undefined && end !== null && before.spot + d.gross - d.returnYards === end;
        const yards = agree ? ` ${d.returnYards} yard${d.returnYards === 1 ? "" : "s"}` : "";
        const to = spot === null ? "" : ` to ${at(spot)}`;
        return returner === undefined ? `${head}, returned${yards}${to}${tackled()}` : `${head}. ${returner} returns it${yards}${to}${tackled()}`;
      }
      return head;
    }
    case "fieldGoal": {
      const dist = 100 - play.kickSpot + ctx.endZoneYards;
      const k = P("kicker");
      const blocked = d.class === "blocked";
      return `${dist}-yard field goal${k === undefined ? "" : ` by ${k}`} ${blocked ? "blocked" : play.good ? "is good" : "is no good"}`;
    }
    case "extraPoint": {
      const good = after.score[off] - before.score[off] === 1;
      const k = P("kicker");
      return `Extra point${k === undefined ? "" : ` by ${k}`} ${good ? "is good" : "is no good"}`;
    }
    case "twoPoint": {
      const good = after.score[off] - before.score[off] === 2;
      const tail = `Two-point try ${good ? "is good" : "fails"}`;
      const sentence = parts.passer !== undefined ? passSentence() : parts.ballCarrier !== undefined || parts.tackler !== undefined ? withFumble(`${runSentence("runs", P("ballCarrier"), "Run")}${tackled()}`) : null;
      return sentence === null ? tail : `${sentence}. ${tail}`;
    }
    case "kickoff":
    case "onsideKick": {
      // Plain words for what happened to the kick, from the engine's class and the result.
      const k = P("kicker");
      const head = `${play.kind === "onsideKick" ? "Onside kick" : "Kickoff"}${k === undefined ? "" : ` by ${k}`}`;
      const cls = d.class ?? ("outcome" in play ? play.outcome : "");
      const spot = fieldSpot(play);
      const recoveredBy = (team: Team): string => `recovered by the ${ctx.teams[team].nickname}`;
      if (play.kind === "onsideKick" || cls.startsWith("onside")) {
        if (cls === "onsideOutOfBounds" || ("outcome" in play && play.outcome === "outOfBounds")) return `${head}, out of bounds`;
        if (after.phase !== "scrimmage") return head;
        return `${head}, ${recoveredBy(after.possession === off ? off : def)}${spot === null ? "" : ` at ${at(spot)}`}`;
      }
      const returner = P("returner");
      switch (cls) {
        case "touchbackEndZone":
        case "touchbackLandingZone":
          return `${head}, touchback`;
        case "short":
          return `${head}, short of the landing zone`;
        case "outOfBounds":
          return `${head}, out of bounds`;
        case "fairCatch":
          return `${head}, fair catch${returner === undefined ? "" : ` by ${returner}`}${spot === null ? "" : ` at ${at(spot)}`}`;
        case "kickersRecover":
          return `${head}, ${recoveredBy(off)}`;
        case "returnTD":
          return returner === undefined ? `${head}, returned for a touchdown` : `${head}. ${returner} returns it for a touchdown`;
        case "returned": {
          // No return yards: the kickoff result has only where the ball died (spec U2, Open O1).
          const to = spot === null ? "" : ` to ${at(spot)}`;
          return returner === undefined ? `${head}, returned${to}${tackled()}` : `${head}. ${returner} returns it${to}${tackled()}`;
        }
        default:
          return head;
      }
    }
    case "noPlay": {
      const fouls = play.fouls ?? [];
      return fouls.length === 0 ? "No play" : `Flag before the snap: ${foulsPhrase(ev, ctx)}`;
    }
  }
}

function foulTeam(ev: PlayEvent, by: "offense" | "defense"): Team {
  return by === "offense" ? ev.before.possession : other(ev.before.possession);
}

/** "holding on #74 B. Smith (Cranes) and ...": each foul, its fouler named when the engine named him, else the team. */
function foulsPhrase(ev: PlayEvent, ctx: TextCtx): string {
  const foulers = readDetail(ev.play).participants?.foulers ?? [];
  return (ev.play.fouls ?? [])
    .map((f, i) => {
      const team = ctx.teams[foulTeam(ev, f.by)].nickname;
      const who = playerRef(foulers[i], ctx);
      return `${(ctx.labels[f.penalty] ?? f.penalty).toLowerCase()} on ${who === undefined ? `the ${team}` : `${who} (${team})`}`;
    })
    .join(" and ");
}

/** "Flag: holding on #74 B. Smith (Lanterns), accepted." The fouler when the engine named him, else the team. */
export function penaltyText(ev: PlayEvent, ctx: TextCtx): string {
  const fouls = ev.play.fouls ?? [];
  if (fouls.length === 0) return "";
  const names = foulsPhrase(ev, ctx);
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

/** The result's first sentence: what physically happened, "Standout: " first on a standout (the compact Last play card, U1). */
export function resultHead(ev: PlayEvent, ctx: TextCtx): string {
  const head = cap(playText(ev, ctx)) + ".";
  // M2 F (code review): the loop's final standout, never a candidate a flag took away.
  return (ev.standout ?? readDetail(ev.play).standout) === undefined ? head : `Standout: ${head}`;
}

/**
 * The result line without where things stand (U2): what happened, the score it made, the flag.
 * The Last play card and the game log show this; the plate already says the next situation.
 */
export function playResultText(ev: PlayEvent, ctx: TextCtx): string {
  const { before, after, play } = ev;
  const off = before.possession;
  const def = other(off);
  const out: string[] = [resultHead(ev, ctx)];
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
  // A no-play's sentence is already its flag.
  const p = play.kind === "noPlay" ? "" : penaltyText(ev, ctx);
  if (p !== "") out.push(p);
  return out.join(" ");
}

/** The result line: what happened, the score it made, the flag, then where things stand (the live region). */
export function resultLine(ev: PlayEvent, ctx: TextCtx): string {
  return `${playResultText(ev, ctx)} ${nextText(ev.after, ctx)}`;
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
  const humanOnOffense = ev.before.possession === ctx.human;
  // No defense call (kicks, kneels, spikes, tries): only the kicking side's call (U2).
  if (ev.defense === null) return humanOnOffense ? `You: ${offense}.` : `They: ${offense}.`;
  const defense = ctx.labels[ev.defense] ?? ev.defense;
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
      return `${ev.period > ctx.regulationPeriods ? "Overtime coin toss" : "Coin toss"}: the ${ctx.teams[ev.winner].nickname} win and choose to ${ev.choice}. The ${ctx.teams[ev.receiver].nickname} receive.`;
    case "review": {
      // M2 G: "They throw the challenge flag" (design: an event line with no key), then the verdict.
      const who = ev.by === "booth" ? "Under review by the replay official" : ev.by === ctx.human ? "You throw the challenge flag" : `The ${ctx.teams[ev.by].nickname} throw the challenge flag`;
      return `${who}. Ruling ${ev.verdict === "reversed" ? "reversed" : "stands"}.${ev.timeoutCharged ? " The challenge cost a timeout." : ""}`;
    }
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
    // M2 G: the review screens (design "Under review", "Review result").
    case "underReview": {
      const who = about.by === "you" ? "your challenge" : about.by === "them" ? `the ${ctx.teams[other(ctx.human)].nickname}' challenge` : "the replay official";
      return `Under review (${who}): ${about.question}`;
    }
    case "reviewResult":
      return `Ruling ${about.verdict === "stands" ? "stands" : "reversed"}.${about.timeoutCharged ? " The challenge cost a timeout." : ""}`;
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
