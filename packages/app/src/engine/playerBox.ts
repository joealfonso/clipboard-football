// ADAPTER for the per-player box score (engine milestone C), until it ships in packages/sim.
// Built from the event log only and the `participants` each play names; decides nothing. It
// counts the way the step 5 team box does (packages/sim loop/box.ts: playStands, kickStands,
// kneels as rushes), so player lines sum to the team box. A player with no stat in a category has
// no line there (shown as a dash), distinct from 0. With the M1 engine no play names anyone, so
// every player table is empty until milestone B.

import { playStands, kickStands, type GameEvent } from "@clipboard-football/sim";
import type { RuleSet } from "@clipboard-football/shared";
import { readDetail, type PlayerLine, type Team } from "./types";

const other = (t: Team): Team => (t === "home" ? "away" : "home");

export function playerBox(events: readonly GameEvent[], rules: RuleSet): Map<string, PlayerLine> {
  const lines = new Map<string, PlayerLine>();
  const line = (id: string, team: Team): PlayerLine => {
    let l = lines.get(id);
    if (l === undefined) {
      l = { id, team };
      lines.set(id, l);
    }
    return l;
  };
  for (const ev of events) {
    if (ev.t !== "play") continue;
    const { play, before } = ev;
    const parts = readDetail(play).participants;
    if (parts === undefined) continue;
    const off = before.possession;
    const def = other(off);
    const end = "end" in play && play.end !== undefined ? play.end : undefined;
    const yards = (): number => {
      const d = readDetail(play).yards;
      if (d !== undefined && end?.possession === "offense") return Math.min(d, 100 - before.spot);
      return end === undefined ? 0 : Math.max(0, Math.min(100, end.spot)) - before.spot;
    };
    const td = end !== undefined && end.possession === "offense" && end.spot >= 100;
    if (before.phase === "scrimmage" && playStands(ev, rules)) {
      if (play.kind === "run" || play.kind === "scramble" || play.kind === "kneel") {
        const id = parts.ballCarrier ?? (play.kind === "run" ? undefined : parts.passer);
        if (id !== undefined) {
          const r = (line(id, off).rushing ??= { attempts: 0, yards: 0, touchdowns: 0, long: 0 });
          const y = yards();
          r.attempts++;
          r.yards += y;
          if (td) r.touchdowns++;
          r.long = Math.max(r.long, y);
        }
      } else if (play.kind === "sack") {
        if (parts.passer !== undefined) (line(parts.passer, off).passing ??= blankPassing()).sacked++;
        if (parts.sacker !== undefined) (line(parts.sacker, def).defense ??= blankDefense()).sacks++;
      } else if (play.kind === "pass") {
        const complete = play.incomplete !== true && play.turnover !== "interception";
        const y = complete ? yards() : 0;
        if (parts.passer !== undefined) {
          const p = (line(parts.passer, off).passing ??= blankPassing());
          p.attempts++;
          if (complete) {
            p.completions++;
            p.yards += y;
            if (td) p.touchdowns++;
          }
          if (play.turnover === "interception") p.interceptions++;
        }
        const target = parts.receiver ?? parts.target;
        if (target !== undefined) {
          const r = (line(target, off).receiving ??= { targets: 0, catches: 0, yards: 0, touchdowns: 0, long: 0 });
          r.targets++;
          if (complete) {
            r.catches++;
            r.yards += y;
            if (td) r.touchdowns++;
            r.long = Math.max(r.long, y);
          }
        }
        if (play.turnover === "interception" && parts.interceptor !== undefined) (line(parts.interceptor, def).defense ??= blankDefense()).interceptions++;
      }
      if (parts.tackler !== undefined) (line(parts.tackler, def).defense ??= blankDefense()).tackles++;
      if (parts.fumbleForcer !== undefined) (line(parts.fumbleForcer, def).defense ??= blankDefense()).forcedFumbles++;
      if (parts.fumbleRecoverer !== undefined && end?.possession === "defense") (line(parts.fumbleRecoverer, def).defense ??= blankDefense()).recoveries++;
    }
    if ((play.kind === "punt" || play.kind === "fieldGoal") && kickStands(ev, rules)) {
      if (play.kind === "punt" && parts.punter !== undefined) {
        const k = (line(parts.punter, off).kicking ??= blankKicking());
        k.punts++;
        k.puntYards += readDetail(play).gross ?? 0;
      }
      if (play.kind === "fieldGoal" && parts.kicker !== undefined) {
        const k = (line(parts.kicker, off).kicking ??= blankKicking());
        const dist = 100 - play.kickSpot + rules.field.endZoneYards;
        k.fieldGoalAttempts++;
        if (play.good) {
          k.fieldGoalsMade++;
          k.long = Math.max(k.long, dist);
        }
      }
    }
    if (play.kind === "extraPoint" && parts.kicker !== undefined) {
      const k = (line(parts.kicker, off).kicking ??= blankKicking());
      k.extraPointAttempts++;
      if (ev.after.score[off] - before.score[off] === 1) k.extraPointsMade++;
    }
  }
  return lines;
}

function blankPassing() {
  return { completions: 0, attempts: 0, yards: 0, touchdowns: 0, interceptions: 0, sacked: 0 };
}
function blankDefense() {
  return { tackles: 0, sacks: 0, interceptions: 0, forcedFumbles: 0, recoveries: 0 };
}
function blankKicking() {
  return { fieldGoalsMade: 0, fieldGoalAttempts: 0, long: 0, extraPointsMade: 0, extraPointAttempts: 0, punts: 0, puntYards: 0 };
}
