// M2 C1 (amended 2026-11-14): every sum the spec names, player box against the step 5 team box,
// for one game. Shared by c-player-box.test.ts and the heavy run.

import type { PlayerLine } from "../../packages/shared/src/game";
import { boxScore, physicalYards, playStands } from "../../packages/sim/src/loop/box";
import { playerBoxScore } from "../../packages/sim/src/loop/player-box";
import type { GameRecord } from "../../packages/sim/src/loop/play";
import { data } from "./support";

const rules = data.engine.rules;
type Team = "home" | "away";
const other = (t: Team): Team => (t === "home" ? "away" : "home");

/** Every C1 sum for one game: [label, player-box sum, team-box value]. */
export function c1Sums(record: GameRecord): [string, number, number][] {
  const tb = boxScore(record, rules);
  const pb = playerBoxScore(record, rules);
  const lines = Object.values(pb.players);
  const sum = (team: Team, f: (l: PlayerLine) => number | undefined): number => lines.filter((l) => l.team === team).reduce((a, l) => a + (f(l) ?? 0), 0);
  // The amendment: intercepted passes the offense got back, which the team box counts as completions.
  const regained = { home: { n: 0, yards: 0 }, away: { n: 0, yards: 0 } };
  const scrimmageTDs = { home: 0, away: 0 };
  const xp = { home: { made: 0, att: 0 }, away: { made: 0, att: 0 } };
  for (const e of record.events) {
    if (e.t !== "play") continue;
    const off = e.before.possession;
    const p = e.play;
    if (e.before.phase === "try") {
      if (p.kind === "extraPoint" && playStands(e, rules)) {
        xp[off].att++;
        if (e.after.score[off] - e.before.score[off] === rules.scoring.tryKick) xp[off].made++;
      }
      continue;
    }
    if (e.before.phase !== "scrimmage" || !playStands(e, rules)) continue;
    if (p.kind === "pass" && p.defensePossessedDuringPlay === true && p.turnover === undefined && p.incomplete !== true) {
      regained[off].n++;
      regained[off].yards += physicalYards(p, e.before.spot);
    }
    if ((p.kind === "run" || p.kind === "pass" || p.kind === "scramble") && p.end.possession === "offense" && e.after.score[off] - e.before.score[off] >= rules.scoring.touchdown) scrimmageTDs[off]++;
  }
  const out: [string, number, number][] = [];
  for (const t of ["home", "away"] as const) {
    const b = tb[t];
    out.push(
      [`${t} pass attempts`, sum(t, (l) => l.passing?.attempts), b.passAttempts],
      [`${t} completions`, sum(t, (l) => l.passing?.completions), b.completions - regained[t].n],
      [`${t} passing yards`, sum(t, (l) => l.passing?.yards), b.passYards - regained[t].yards],
      [`${t} catches`, sum(t, (l) => l.receiving?.catches), b.completions - regained[t].n],
      [`${t} receiving yards`, sum(t, (l) => l.receiving?.yards), b.passYards - regained[t].yards],
      [`${t} rushing attempts`, sum(t, (l) => l.rushing?.attempts), b.rushAttempts],
      [`${t} rushing yards`, sum(t, (l) => l.rushing?.yards), b.rushYards],
      [`${t} passing TDs = receiving TDs`, sum(t, (l) => l.passing?.touchdowns), sum(t, (l) => l.receiving?.touchdowns)],
      [`${t} rushing + receiving TDs`, sum(t, (l) => l.rushing?.touchdowns) + sum(t, (l) => l.receiving?.touchdowns), scrimmageTDs[t]],
      [`${t} INTs thrown`, sum(t, (l) => l.passing?.interceptions), b.interceptions],
      [`${t} INTs thrown = INTs made by the other team`, sum(t, (l) => l.passing?.interceptions), sum(other(t), (l) => l.defense?.interceptions)],
      [`${t} sacks taken`, sum(t, (l) => l.passing?.sacked), b.sacks],
      [`${t} sacks taken = sacks made by the other team`, sum(t, (l) => l.passing?.sacked), sum(other(t), (l) => l.defense?.sacks)],
      [`${t} sack yards`, sum(t, (l) => l.passing?.sackYards), b.sackYards],
      [`${t} FG made`, sum(t, (l) => l.kicking?.fieldGoalsMade), b.fieldGoalsMade],
      [`${t} FG attempts`, sum(t, (l) => l.kicking?.fieldGoalAttempts), b.fieldGoalAttempts],
      [`${t} XP made`, sum(t, (l) => l.kicking?.extraPointsMade), xp[t].made],
      [`${t} XP attempts`, sum(t, (l) => l.kicking?.extraPointAttempts), xp[t].att],
      [`${t} punts`, sum(t, (l) => l.punting?.punts), b.punts],
    );
  }
  return out;
}

