// Text rendering of one game record for the headless CLI (M1 step 5, milestone E): a header, one
// line per event, and the team box score. Reads the record only; the why text on a play line is
// that play's detail.why, and loop event lines carry no why text.

import type { GameData, PlayResult } from "../../packages/shared/src/types";
import { acceptedFoul, boxScore, type BoxScore, type TeamBox } from "../../packages/sim/src/loop/box";
import type { GameEvent, GameRecord, Snapshot } from "../../packages/sim/src/loop/play";
import type { Team } from "../../packages/sim/src/game/types";

type PlayEvent = Extract<GameEvent, { t: "play" }>;

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function periodLabel(p: number, regulation: number): string {
  return p <= regulation ? `Q${p}` : p === regulation + 1 ? "OT" : `OT${p - regulation}`;
}

function ordinal(n: number): string {
  return ["", "1st", "2nd", "3rd", "4th"][n] ?? `${n}th`;
}

/** "own 25", "midfield" or "opp 40", from the team in possession. */
export function ballOn(spot: number): string {
  if (spot === 50) return "midfield";
  return spot < 50 ? `own ${spot}` : `opp ${100 - spot}`;
}

function teamCodes(record: GameRecord): Record<Team, string> {
  const nick = (n: string): string => n.split(" ").slice(-1)[0] ?? n;
  return { home: nick(record.teams.home).toUpperCase(), away: nick(record.teams.away).toUpperCase() };
}

function score(s: Snapshot["score"], codes: Record<Team, string>): string {
  return `${codes.away} ${s.away} - ${codes.home} ${s.home}`;
}

function labels(data: GameData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sc of data.engine.caller.catalog.screens) for (const c of sc.choices) out[c.id] = c.label;
  return out;
}

function why(play: PlayResult): string {
  const w = (play.detail ?? {})["why"];
  return typeof w === "string" ? w : "";
}

function yardsText(n: number): string {
  return `${n} yard${Math.abs(n) === 1 ? "" : "s"}`;
}

/** The result of a play in plain words, from the PlayResult and the state after it. */
export function resultText(ev: PlayEvent, codes: Record<Team, string>, whyLabels: Readonly<Record<string, string>> = {}): string {
  const { play, before, after } = ev;
  const off = before.possession;
  const def: Team = off === "home" ? "away" : "home";
  const detail = (play.detail ?? {}) as Record<string, unknown>;
  const scoredBy = (t: Team): number => after.score[t] - before.score[t];
  const td = before.phase === "scrimmage" && after.phase === "try" && scoredBy(off) >= 6 ? ", TOUCHDOWN" : "";
  const defTd = after.phase === "try" && scoredBy(def) >= 6 ? `, returned for a ${codes[def]} TOUCHDOWN` : "";
  const safety = after.phase === "kickoff" && after.safetyKick && scoredBy(def) === 2 ? `, SAFETY (${codes[def]} +2)` : "";
  const gain = (): number => {
    const y = detail["yards"];
    if (typeof y === "number") return y;
    return "end" in play && play.end !== undefined ? play.end.spot - before.spot : 0;
  };
  const lost = "turnover" in play && play.turnover !== undefined && "end" in play && play.end?.possession === "defense";
  let text: string;
  switch (play.kind) {
    case "run":
      text = lost ? `Run, FUMBLE lost to ${codes[def]}` : `Run for ${yardsText(gain())}`;
      break;
    case "scramble":
      text = lost ? `Scramble, FUMBLE lost to ${codes[def]}` : `Scramble for ${yardsText(gain())}`;
      break;
    case "kneel":
      text = `Kneel, ${yardsText(gain())}`;
      break;
    case "spike":
      text = "Spike, clock stopped";
      break;
    case "sack":
      text = lost ? `Sacked, FUMBLE lost to ${codes[def]}` : `Sacked for ${yardsText(gain())}`;
      break;
    case "pass":
      if (play.turnover === "interception") text = `INTERCEPTED by ${codes[def]}`;
      else if (play.incomplete === true) text = "Incomplete";
      else text = lost ? `Complete, FUMBLE lost to ${codes[def]}` : `Complete for ${yardsText(gain())}`;
      break;
    case "punt": {
      const g = detail["gross"];
      text = `Punt${typeof g === "number" ? ` ${g} yards` : ""}`;
      if (after.phase === "scrimmage") text += after.possession === off ? `, ${codes[off]} keeps it at ${ballOn(after.spot)}` : `, ${codes[after.possession]} ball at ${ballOn(after.spot)}`;
      break;
    }
    case "fieldGoal":
      text = `${100 - play.kickSpot + 10}-yard field goal ${play.good ? "is GOOD" : "is no good"}`;
      break;
    case "extraPoint":
      text = `Extra point ${scoredBy(off) === 1 ? "is good" : "is no good"}`;
      break;
    case "twoPoint":
      text = `Two-point try ${scoredBy(off) === 2 ? "succeeds" : "fails"}`;
      break;
    case "kickoff":
    case "onsideKick": {
      const cls = String(detail["class"] ?? play.outcome);
      const said = whyLabels[cls] ?? cls;
      text = said.charAt(0).toUpperCase() + said.slice(1);
      if (after.phase === "scrimmage") text += after.possession === off ? `, ${codes[off]} RECOVERS at ${ballOn(after.spot)}` : `, ${codes[after.possession]} ball at ${ballOn(after.spot)}`;
      break;
    }
    case "noPlay":
      text = "No play";
      break;
  }
  return text + td + defTd + safety;
}

function penaltyText(ev: PlayEvent, data: GameData, codes: Record<Team, string>): string {
  const fouls = ev.play.fouls ?? [];
  if (fouls.length === 0) return "";
  const lab = (id: string): string => data.engine.why.labels[id] ?? id;
  const teamOf = (by: "offense" | "defense"): Team => (by === "offense" ? ev.before.possession : ev.before.possession === "home" ? "away" : "home");
  const names = fouls.map((f) => `${lab(f.penalty)} on ${codes[teamOf(f.by)]}`).join(" and ");
  if (ev.penalty === null || ev.penalty.kind === "offset") return ` PENALTY: ${names}, offsetting.`;
  if (ev.penalty.kind === "decline") return ` PENALTY: ${names}, declined.`;
  const a = acceptedFoul(ev, data.engine.rules);
  return ` PENALTY: ${names}, accepted${a === null ? "" : ` (${yardsText(a.yards)})`}.`;
}

function situation(b: Snapshot): string {
  if (b.phase === "kickoff") return b.safetyKick ? "safety kick" : "kickoff";
  if (b.phase === "try") return "try";
  return `${ordinal(b.down)} & ${b.goalToGo ? "goal" : b.distance} at ${ballOn(b.spot)}`;
}

function callText(ev: PlayEvent, names: Record<string, string>, data: GameData): string {
  const o = ev.offense;
  const call = o.call === "goForTwo" ? `Go for two: ${names[o.twoPointPlay ?? ""] ?? o.twoPointPlay}` : (names[o.call] ?? o.call);
  const form = o.formation === undefined ? "" : ` (${data.engine.why.labels[o.formation] ?? o.formation})`;
  const d = ev.defense === null ? "" : ` vs ${names[ev.defense] ?? ev.defense}`;
  return `${call}${form}${d}`;
}

export function eventLine(ev: GameEvent, record: GameRecord, data: GameData): string {
  const reg = data.engine.rules.game.regulationPeriods;
  const codes = teamCodes(record);
  const names = labels(data);
  switch (ev.t) {
    case "toss":
      return `${periodLabel(ev.before.period + 1, reg)} coin toss: ${codes[ev.winner]} wins and chooses to ${ev.choice}; ${codes[ev.receiver]} receives.`;
    case "timeout":
      return `${periodLabel(ev.before.period, reg)} ${clock(ev.before.clock)}  Timeout ${codes[ev.team]} (${ev.side}), ${ev.left} left.`;
    case "runoff":
      return `${periodLabel(ev.before.period, reg)} ${clock(ev.before.clock)}  ${codes[ev.before.possession]} lets ${ev.seconds} s run before the snap${ev.drawn > ev.seconds ? " (play clock)" : ""}.`;
    case "twoMinuteWarning":
      return `${periodLabel(ev.period, reg)} 2:00  Two-minute warning.`;
    case "endPeriod":
      return `End of ${periodLabel(ev.period, reg)}: ${score(ev.score, codes)}.`;
    case "play": {
      const b = ev.before;
      const head = `${periodLabel(b.period, reg)} ${clock(b.clock)}  ${codes[b.possession]} ${situation(b)}  ${callText(ev, names, data)}: `;
      const rt = ev.runoffTimeout ? ` ${codes[b.possession]} uses a timeout to avoid the ten-second run-off.` : "";
      const w = why(ev.play);
      return `${head}${resultText(ev, codes, data.engine.why.labels)}.${penaltyText(ev, data, codes)}${rt}  [${score(ev.after.score, codes)}]${w === "" ? "" : `  Why: ${w}`}`;
    }
  }
}

function pct(a: number, b: number): string {
  return `${a}-${b}`;
}

function boxLines(box: BoxScore, record: GameRecord, data: GameData): string[] {
  const codes = teamCodes(record);
  const reg = data.engine.rules.game.regulationPeriods;
  const cols = Array.from({ length: box.periods }, (_, i) => periodLabel(i + 1, reg));
  const pad = (s: string, n: number): string => s.padEnd(n);
  const lines = ["", "BOX SCORE", "", `${pad("", 10)}${cols.map((c) => c.padStart(5)).join("")}  Final`];
  for (const t of ["away", "home"] as const) lines.push(`${pad(codes[t], 10)}${box[t].byPeriod.map((x) => String(x).padStart(5)).join("")}  ${String(box[t].points).padStart(5)}`);
  const top = (b: TeamBox): string => `${Math.floor(b.possessionSeconds / 60)}:${String(b.possessionSeconds % 60).padStart(2, "0")}`;
  const rows: [string, (b: TeamBox) => string][] = [
    ["First downs", (b) => String(b.firstDowns)],
    ["Total yards", (b) => String(b.rushYards + b.passYards - b.sackYards)],
    ["Rushing (att-yds)", (b) => `${b.rushAttempts}-${b.rushYards}`],
    ["Passing (comp-att, yds)", (b) => `${b.completions}-${b.passAttempts}, ${b.passYards}`],
    ["Sacks-yards lost", (b) => `${b.sacks}-${b.sackYards}`],
    ["Turnovers (int, fum)", (b) => `${b.interceptions + b.fumblesLost} (${b.interceptions}, ${b.fumblesLost})`],
    ["Penalties-yards", (b) => `${b.penalties}-${b.penaltyYards}`],
    ["3rd down", (b) => pct(b.thirdDownConversions, b.thirdDownAttempts)],
    ["4th down", (b) => pct(b.fourthDownConversions, b.fourthDownAttempts)],
    ["Time of possession", top],
    ["Punts", (b) => String(b.punts)],
    ["Field goals (made-att)", (b) => pct(b.fieldGoalsMade, b.fieldGoalAttempts)],
    ["Timeouts used", (b) => String(b.timeouts)],
  ];
  lines.push("", `${pad("", 26)}${codes.away.padStart(14)}${codes.home.padStart(14)}`);
  for (const [name, f] of rows) lines.push(`${pad(name, 26)}${f(box.away).padStart(14)}${f(box.home).padStart(14)}`);
  lines.push("", "DRIVES", "");
  const res: Record<string, string> = {
    touchdown: "Touchdown", fieldGoal: "Field goal", missedFieldGoal: "Missed FG", punt: "Punt", turnover: "Turnover", downs: "Downs", endOfHalf: "End of half", safety: "Safety",
  };
  box.drives.forEach((d, i) => {
    lines.push(`${String(i + 1).padStart(3)}. ${pad(codes[d.team], 10)} ${pad(periodLabel(d.period, reg), 4)} start ${pad(ballOn(d.start), 9)} ${String(d.plays).padStart(2)} plays ${String(d.yards).padStart(4)} yds ${clock(d.seconds).padStart(5)}  ${res[d.result]}`);
  });
  return lines;
}

export function renderGame(record: GameRecord, data: GameData): string {
  const codes = teamCodes(record);
  const r = record.final.result;
  const lines = [
    `Clipboard Football headless game (M1)`,
    `seed ${record.seed}  league seed ${record.leagueSeed ?? "none"}  ${record.gameType}`,
    `rule set ${record.rules.id} sha256 ${record.rules.hash}`,
    `data ${Object.entries(record.dataHashes).map(([f, h]) => `${f.replace(/^data\//, "")}:${h.slice(0, 12)}`).join(" ")}`,
    `away ${record.teams.away} (${codes.away})  at  home ${record.teams.home} (${codes.home})`,
    "",
  ];
  for (const ev of record.events) lines.push(eventLine(ev, record, data));
  const fin = record.final.score;
  lines.push("", `FINAL: ${score(fin, codes)}${r === null ? "" : r.winner === null ? " (tie)" : ` (${codes[r.winner]} wins, ${r.reason})`}`);
  lines.push(...boxLines(boxScore(record, data.engine.rules), record, data));
  return lines.join("\n") + "\n";
}
