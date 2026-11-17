// Last play details in plain words (docs/specs/m2-calling-screen-pass.md, U3): the why headline
// once, then the engine's trace in four groups (Situation, Matchup, Players, Outcome). Every
// multiplier the trace has is shown as a percent "toward" its class; none is merged or dropped.
// The raw form (cell key, multipliers, detail.why) stays in Copy details. Pure.

import { whyHeadline } from "../engine/headline";
import { PARTICIPANT_ROLES, readDetail, type ParticipantRole, type PlayEvent, type TraceEntry } from "../engine/types";
import { callsLine, playerRef, type TextCtx } from "./text";

export interface DetailGroup {
  readonly title: "Situation" | "Matchup" | "Players" | "Outcome";
  readonly lines: readonly string[];
}

export interface DetailSheet {
  readonly headline: string;
  readonly groups: readonly DetailGroup[];
}

export const NO_EXPLANATION = "No explanation for this play.";
export const NO_FACTORS = "The engine recorded no factors for this play.";
export const EDGES_NOTE = "Edges scale how likely each result was before the engine rebalances; Result shows the final odds.";

/** A multiplier as the sheet writes it: 1.14 is "+14%", 0.94 is "-6%". */
export function percentOf(m: number): string {
  return m >= 1 ? `+${Math.round((m - 1) * 100)}%` : `-${Math.round((1 - m) * 100)}%`;
}

const ROLE_WORD: Readonly<Record<ParticipantRole, string>> = {
  passer: "Passer",
  target: "Target",
  receiver: "Receiver",
  ballCarrier: "Ball carrier",
  tackler: "Tackler",
  sacker: "Sacker",
  interceptor: "Interceptor",
  fumbleForcer: "Fumble forced by",
  fumbleRecoverer: "Fumble recovered by",
  kicker: "Kicker",
  punter: "Punter",
  returner: "Returner",
};

/** What a reversal changed, by close-call kind. */
const REVIEW_TEXT: Readonly<Record<string, string>> = {
  completionToIncomplete: "the catch was ruled incomplete",
  interceptionToIncomplete: "the interception was ruled incomplete",
  fumbleToDown: "he was down before the ball came out",
  touchdownToShort: "he was short of the goal line",
  spotLineToGain: "the ball's spot at the line to gain was changed",
};

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** Builds the sheet for one play event, from its trace and participants only. */
export function detailSheet(ev: PlayEvent, ctx: TextCtx): DetailSheet {
  const d = readDetail(ev.play);
  const trace = d.trace ?? [];
  const L = (id: string): string | undefined => ctx.labels[id];
  const cls = (e: TraceEntry): string => L(String(e["class"])) ?? String(e["class"]);
  const v = (e: TraceEntry, k: string): string => String(e[k] ?? "");
  const humanOff = ev.before.possession === ctx.human;
  /** "#22 R. Vance", or the entry's own number and name, or undefined: a role nobody can be named for is left out (N2). */
  const ref = (id: unknown, number?: unknown, name?: unknown): string | undefined => {
    const r = typeof id === "string" ? playerRef(id, ctx) : undefined;
    if (r !== undefined) return r;
    return typeof number === "number" && typeof name === "string" ? `#${number} ${name}` : undefined;
  };
  const ids = new Set<string>(ctx.players.keys());
  const other = (e: TraceEntry): string =>
    `Other: ${e.factor}: ${Object.entries(e)
      .filter(([k]) => k !== "factor")
      // A player id is written as his name alone, without its key (N2: not "id #22 R. Vance").
      .map(([k, x]) => (typeof x === "string" && ids.has(x) ? (ref(x) ?? `${k} ${x}`) : `${k} ${String(x)}`))
      .join(", ")}`;
  const standoutLine = (s: { player: unknown; number: unknown; name: unknown; ratingLabel: unknown; rating: unknown; value: unknown; applied: unknown }): string => {
    const label = typeof s.ratingLabel === "string" ? s.ratingLabel : (L(String(s.rating)) ?? String(s.rating));
    const a = Number(s.applied);
    const how = Number.isFinite(a) && a < 1 ? `${Math.round((1 - a) * 100)}% less likely` : `${Math.round(((Number.isFinite(a) ? a : 1) - 1) * 100)}% more likely`;
    const who = ref(s.player, s.number, s.name);
    return `Standout: ${who === undefined ? "a" : `${who}'s`} ${lowerFirst(label)} (${String(s.value)}) made this result ${how}.`;
  };

  const situation: string[] = [];
  const matchup: string[] = [];
  const players: string[] = [];
  const outcome: string[] = [];
  const callLines: string[] = [];
  const cellLines: string[] = [];
  const kickLines: string[] = [];
  const roleLines: string[] = [];

  for (const e of trace) {
    switch (e.factor) {
      case "call":
        callLines.push(`${humanOff ? "Your" : "Their"} call: ${v(e, "label")}.`);
        break;
      case "cell": {
        const fam = v(e, "family");
        cellLines.push(`Situation table: ${lowerFirst(L(fam) ?? fam)}, level ${v(e, "level")} (0 is the most specific).`);
        break;
      }
      case "fieldGoal":
        kickLines.push(`Kick distance: ${v(e, "distance")} yards. Make chance: ${v(e, "pct")}%.`);
        break;
      case "special": {
        const ev2 = v(e, "event");
        kickLines.push(`Kick: ${lowerFirst(L(ev2) ?? ev2)}${e["gross"] === undefined ? "" : `, ${v(e, "gross")} yards gross`}.`);
        break;
      }
      case "matchup":
        matchup.push(`${humanOff ? "Their" : "Your"} call, ${v(e, "presetLabel")}: ${percentOf(Number(e["multiplier"]))} toward ${cls(e)}.`);
        break;
      case "formation":
        matchup.push(`${v(e, "formationLabel")} against ${v(e, "packageLabel")}: ${percentOf(Number(e["multiplier"]))} toward ${cls(e)}.`);
        break;
      case "rating":
        players.push(`${v(e, "label")}: ${percentOf(Number(e["multiplier"]))} toward ${cls(e)}.`);
        break;
      case "standout":
        players.push(standoutLine(e as unknown as Parameters<typeof standoutLine>[0]));
        break;
      case "standoutCandidate":
        // The loop's final standout is the same player and factor; a candidate alone didn't count.
        if (ev.standout === undefined) players.push(`${standoutLine(e as unknown as Parameters<typeof standoutLine>[0])} It didn't count: the play didn't stand.`);
        break;
      case "fouler":
        {
          const who = ref(e["id"], e["number"], e["name"]);
          const what = lowerFirst(L(v(e, "penalty")) ?? v(e, "penalty"));
          players.push(who === undefined ? `Flag: ${what}.` : `Flag on ${who}: ${what}.`);
        }
        break;
      case "class":
        outcome.push(`Result: ${v(e, "label")}. ${v(e, "basePct")}% before the edges, ${v(e, "pct")}% after.`);
        break;
      case "fluke": {
        // Code review S5: the why.json labels ("a gain that long", "a result that rare") read as the
        // tail of a why sentence, so the sheet words each reason itself from the entry's own figures.
        const reason = v(e, "reason");
        const fixed = reason === "yardsLong" && e["pctile"] !== undefined ? `Fluke: a long gain, past the ${v(e, "pctile")}th percentile of gains in this situation.` : reason === "classRare" ? "Fluke: a rare result for this call in this situation." : null;
        const what = typeof e["what"] === "string" && e["what"] !== reason ? e["what"] : undefined;
        outcome.push(fixed ?? (what !== undefined ? `Fluke: ${lowerFirst(what)}.` : other(e)));
        break;
      }
      case "penalty":
        outcome.push(`Flag: ${lowerFirst(v(e, "label"))} on the ${lowerFirst(v(e, "side"))}.`);
        break;
      case "review": {
        // The review entry is on the play as a review reversed it (close-call kinds, packages/sim engine/closecalls.ts).
        const words = REVIEW_TEXT[v(e, "kind")];
        outcome.push(words !== undefined ? `Reviewed and reversed: ${words}.` : other(e));
        break;
      }
      default: {
        // A role entry (the engine traces who held each role): the participants line names him.
        const role = PARTICIPANT_ROLES.find((r) => r === e.factor);
        if (role === undefined) outcome.push(other(e));
        else if (d.participants?.[role] !== e["id"]) {
          const who = ref(e["id"], e["number"], e["name"]);
          if (who !== undefined) roleLines.push(`${ROLE_WORD[role]} ${who}.`);
        }
      }
    }
  }
  if (ev.standout !== undefined) players.unshift(standoutLine(ev.standout));
  const parts = d.participants;
  const named = PARTICIPANT_ROLES.flatMap((r) => {
    const who = parts?.[r] === undefined ? undefined : playerRef(parts[r], ctx);
    return who === undefined ? [] : [`${ROLE_WORD[r]} ${who}.`];
  });
  if (named.length > 0 || roleLines.length > 0) players.unshift([...named, ...roleLines].join(" "));
  if (callLines.length > 0 || trace.length > 0) situation.push(...callLines, `Calls: ${callsLine(ev, ctx)}`, ...cellLines, ...kickLines);
  const groups: DetailGroup[] = [
    { title: "Situation", lines: situation },
    { title: "Matchup", lines: matchup },
    { title: "Players", lines: players },
    { title: "Outcome", lines: outcome },
  ];
  return { headline: whyHeadline(ev.play, ev.standout) ?? NO_EXPLANATION, groups: groups.filter((g) => g.lines.length > 0) };
}
