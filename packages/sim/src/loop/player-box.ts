// M2 milestone C: the per-player box score, from a game record's event log only (like the step 5
// team box), and league-wide rating ranks. Decides nothing. Only plays that stand count (step 5
// playStands, kickStands); tries count only for kicking. Every definition is designed and
// matches the team box's counting (docs/MODEL.md, "Per-player box score"), so player lines sum
// to the team box.

import type { Participants, PlayResult, RuleSet, TeamPool } from "../../../shared/src/types";
import type { DefenseLine, KickingLine, PassingLine, PlayerBoxScore, PlayerLine, PuntingLine, RatingRanks, ReceivingLine, RushingLine } from "../../../shared/src/game";
import { POSITION_SKILLS, BASE_RATINGS } from "../../../shared/src/engine";
import { other } from "../game/frame";
import type { Team } from "../game/types";
import { kickStands, physicalYards, playStands } from "./box";
import type { GameRecord } from "./play";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface Lines {
  passing?: Mutable<PassingLine>;
  rushing?: Mutable<RushingLine>;
  receiving?: Mutable<ReceivingLine>;
  defense?: Mutable<DefenseLine>;
  kicking?: Mutable<KickingLine>;
  punting?: Mutable<PuntingLine>;
}

function detailOf(play: PlayResult): { participants?: Participants; onField?: { offense: Record<string, readonly string[]>; defense: Record<string, readonly string[]> }; distance?: number; gross?: number } {
  return (play.detail ?? {}) as ReturnType<typeof detailOf>;
}

/** The team of every player on the field for this play, from detail.onField. */
function teamsOf(play: PlayResult, offense: Team): Map<string, Team> {
  const m = new Map<string, Team>();
  const of = detailOf(play).onField;
  if (of === undefined) return m;
  for (const ids of Object.values(of.offense)) for (const id of ids) m.set(id, offense);
  for (const ids of Object.values(of.defense)) for (const id of ids) m.set(id, other(offense));
  return m;
}

export function playerBoxScore(record: GameRecord, rules: RuleSet): PlayerBoxScore {
  const lines = new Map<string, { team: Team; l: Lines }>();
  const line = (id: string, team: Team): Lines => {
    let x = lines.get(id);
    if (x === undefined) {
      x = { team, l: {} };
      lines.set(id, x);
    }
    return x.l;
  };
  const passing = (l: Lines): Mutable<PassingLine> => (l.passing ??= { completions: 0, attempts: 0, yards: 0, touchdowns: 0, interceptions: 0, sacked: 0, sackYards: 0 });
  const rushing = (l: Lines): Mutable<RushingLine> => (l.rushing ??= { attempts: 0, yards: 0, touchdowns: 0, long: Number.NEGATIVE_INFINITY });
  const receiving = (l: Lines): Mutable<ReceivingLine> => (l.receiving ??= { targets: 0, catches: 0, yards: 0, touchdowns: 0 });
  const defense = (l: Lines): Mutable<DefenseLine> => (l.defense ??= { tackles: 0, sacks: 0, interceptions: 0, forcedFumbles: 0, recoveries: 0 });
  const kicking = (l: Lines): Mutable<KickingLine> => (l.kicking ??= { fieldGoalsMade: 0, fieldGoalAttempts: 0, extraPointsMade: 0, extraPointAttempts: 0 });
  const punting = (l: Lines): Mutable<PuntingLine> => (l.punting ??= { punts: 0, yards: 0, average: 0 });

  for (const ev of record.events) {
    if (ev.t !== "play") continue;
    const { play, before } = ev;
    const parts = detailOf(play).participants;
    if (parts === undefined) continue;
    const off = before.possession;
    const teams = teamsOf(play, off);
    const at = (id: string | undefined): Lines | null => (id === undefined ? null : line(id, teams.get(id) ?? off));

    if (before.phase === "try") {
      if (play.kind === "extraPoint" && playStands(ev, rules)) {
        const k = at(parts.kicker);
        if (k !== null) {
          const x = kicking(k);
          x.extraPointAttempts++;
          if (play.good) x.extraPointsMade++;
        }
      }
      continue;
    }
    if (play.kind === "punt" || play.kind === "fieldGoal") {
      if (!kickStands(ev, rules)) continue;
      if (play.kind === "punt") {
        const p = at(parts.punter);
        if (p !== null) {
          const x = punting(p);
          x.punts++;
          x.yards += detailOf(play).gross ?? 0;
          x.average = x.yards / x.punts;
        }
      } else {
        const k = at(parts.kicker);
        if (k !== null) {
          const x = kicking(k);
          x.fieldGoalAttempts++;
          if (play.good) {
            x.fieldGoalsMade++;
            const d = detailOf(play).distance;
            if (d !== undefined) x.long = Math.max(x.long ?? d, d);
          }
        }
      }
      for (const id of [parts.fumbleRecoverer]) if (id !== undefined) defense(at(id) as Lines).recoveries++;
      if (parts.tackler !== undefined) defense(at(parts.tackler) as Lines).tackles++;
      continue;
    }
    if (play.kind === "kickoff" || play.kind === "onsideKick") {
      if (!playStands(ev, rules)) continue;
      if (parts.tackler !== undefined) defense(at(parts.tackler) as Lines).tackles++;
      if (parts.fumbleRecoverer !== undefined) defense(at(parts.fumbleRecoverer) as Lines).recoveries++;
      continue;
    }
    if (play.kind === "noPlay" || play.kind === "twoPoint" || play.kind === "extraPoint" || !playStands(ev, rules)) continue;

    // A scrimmage play that stands: the team box's counting (box.ts).
    const y = physicalYards(play, before.spot);
    const td = play.touchdown === true && play.end.possession === "offense";
    if (play.kind === "run" || play.kind === "scramble" || play.kind === "kneel") {
      const c = at(parts.ballCarrier);
      if (c !== null) {
        const x = rushing(c);
        x.attempts++;
        x.yards += y;
        x.long = Math.max(x.long, y);
        if (td) x.touchdowns++;
      }
    } else if (play.kind === "sack") {
      const q = at(parts.passer);
      if (q !== null) {
        const x = passing(q);
        x.sacked++;
        x.sackYards += -y;
      }
      if (parts.sacker !== undefined) defense(at(parts.sacker) as Lines).sacks++;
    } else {
      // pass or spike: a pass attempt, as in the team box.
      const q = at(parts.passer);
      // The team box's completion, when a receiver is credited. Not one: a pass the defense
      // intercepted and the offense got back, which the team box counts as a completion because it
      // reads only who held the ball at the end (docs/DECISIONS.md, M2 C).
      const complete = play.kind === "pass" && play.incomplete !== true && play.turnover !== "interception" && parts.receiver !== undefined;
      const intercepted = play.turnover === "interception" && play.end.possession === "defense";
      if (q !== null) {
        const x = passing(q);
        x.attempts++;
        if (complete) {
          x.completions++;
          x.yards += y;
          if (td) x.touchdowns++;
        }
        if (intercepted) x.interceptions++;
      }
      const t = at(parts.target);
      if (t !== null) receiving(t).targets++;
      if (complete) {
        const r = at(parts.receiver);
        if (r !== null) {
          const x = receiving(r);
          x.catches++;
          x.yards += y;
          x.long = Math.max(x.long ?? y, y);
          if (td) x.touchdowns++;
        }
      }
      if (intercepted && parts.interceptor !== undefined) defense(at(parts.interceptor) as Lines).interceptions++;
    }
    if (parts.tackler !== undefined) defense(at(parts.tackler) as Lines).tackles++;
    if (parts.fumbleForcer !== undefined) defense(at(parts.fumbleForcer) as Lines).forcedFumbles++;
    if (parts.fumbleRecoverer !== undefined) defense(at(parts.fumbleRecoverer) as Lines).recoveries++;
  }

  const players: Record<string, PlayerLine> = {};
  for (const [id, { team, l }] of lines) {
    const out: Mutable<PlayerLine> = { id, team };
    if (l.passing !== undefined) out.passing = l.passing;
    if (l.rushing !== undefined) out.rushing = l.rushing;
    if (l.receiving !== undefined) out.receiving = l.receiving;
    if (l.defense !== undefined) out.defense = l.defense;
    if (l.kicking !== undefined) out.kicking = l.kicking;
    if (l.punting !== undefined) out.punting = l.punting;
    players[id] = out;
  }
  return { players };
}

/**
 * C6: every player's rank within his position across the league, for each base rating and each
 * of his position's skills, from the pools given (the generated league's card ratings: after the
 * team-strength shift, before home field). 1 is the highest. Ties: the lower player id (string
 * order) ranks first, so ranks at a position are 1..n with no repeats. Pure; decides nothing.
 */
export function ratingRanks(pools: readonly TeamPool[]): RatingRanks {
  const byPos = new Map<string, { id: string; values: Readonly<Record<string, number>> }[]>();
  for (const pool of pools) {
    for (const p of pool.players) {
      const xs = byPos.get(p.position) ?? [];
      xs.push({ id: p.id, values: { ...(p.ratings as Readonly<Record<string, number>>), ...p.skills } });
      byPos.set(p.position, xs);
    }
  }
  const out: Record<string, Record<string, { value: number; rank: number; of: number }>> = {};
  for (const [pos, xs] of byPos) {
    const names = [...BASE_RATINGS, ...(POSITION_SKILLS[pos as keyof typeof POSITION_SKILLS] ?? [])];
    for (const name of names) {
      const sorted = [...xs].sort((a, b) => (b.values[name] ?? 0) - (a.values[name] ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      sorted.forEach((x, i) => {
        (out[x.id] ??= {})[name] = { value: x.values[name] ?? 0, rank: i + 1, of: xs.length };
      });
    }
  }
  return out;
}
