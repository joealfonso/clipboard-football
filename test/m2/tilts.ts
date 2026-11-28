// M2 B5 over real games (shared by the fast and heavy tests): the credited player's rating
// against his teammates on the field at his position, by class.

import { expect } from "vitest";
import type { OnField, Participants, Player, PlayResult, Position, TeamPool } from "../../packages/shared/src/types";
import type { GameRecord } from "../../packages/sim/src/loop/play";

type Side = "offense" | "defense";
interface Detail {
  participants?: Participants;
  onField?: OnField;
  class?: string;
  trace: { factor: string; [k: string]: unknown }[];
}
const det = (p: PlayResult): Detail => p.detail as unknown as Detail;

/** Over real games: the credited player's rating minus the on-field mean at his position, by class. */
export function tiltGaps(records: readonly { record: GameRecord; pools: Readonly<Record<string, TeamPool>> }[]): Record<string, { sum: number; n: number }> {
  const out: Record<string, { sum: number; n: number }> = {};
  const add = (k: string, x: number): void => {
    const o = (out[k] ??= { sum: 0, n: 0 });
    o.sum += x;
    o.n++;
  };
  for (const { record, pools } of records) {
    const byId = new Map<string, Player>();
    for (const pool of Object.values(pools)) for (const p of pool.players) byId.set(p.id, p);
    const rating = (p: Player, r: string): number => ((p.ratings as Record<string, number>)[r] ?? p.skills[r]) as number;
    for (const e of record.events) {
      if (e.t !== "play" || e.penalty !== null || e.before.phase !== "scrimmage") continue;
      const d = det(e.play);
      const parts = d.participants as Record<string, string> | undefined;
      if (parts === undefined || d.onField === undefined || d.class === undefined) continue;
      const gap = (role: string, side: Side, pos: Position, r: string, key: string): void => {
        const who = byId.get(parts[role] ?? "");
        const ids = d.onField?.[side][pos] ?? [];
        if (who === undefined || who.position !== pos || ids.length < 2) return;
        // WRs: compare the same slot's rating across classes, so slot weights cancel.
        const mean = ids.reduce((a, id) => a + rating(byId.get(id) as Player, r), 0) / ids.length;
        add(key, rating(who, r) - mean);
      };
      const cls = d.class;
      if (cls === "c20") gap("target", "offense", "WR", "speed", "wrSpeed:c20");
      if (cls === "c1_9" || cls === "c0") gap("target", "offense", "WR", "speed", "wrSpeed:short");
      if (cls === "inc") gap("target", "offense", "WR", "hands", "wrHands:inc");
      if (cls === "c1_9" || cls === "c0" || cls === "c10_19") gap("target", "offense", "WR", "hands", "wrHands:catch");
      if (cls === "sack") gap("sacker", "defense", "DL", "passRush", "dlPassRush:sack");
      if (cls === "int") {
        gap("interceptor", "defense", "CB", "ballSkills", "cbBallSkills:int");
        gap("interceptor", "defense", "S", "ballSkills", "sBallSkills:int");
      }
      if (e.play.kind === "run" && parts["ballCarrier"] !== undefined && (d.onField.offense.RB?.length ?? 0) === 1) {
        const rb = byId.get(d.onField.offense.RB?.[0] ?? "") as Player;
        const qb = byId.get(d.onField.offense.QB?.[0] ?? "") as Player;
        const leaf = String(d.trace.find((x) => x.factor === "call")?.["leaf"] ?? "");
        if (leaf === "insideRun" || leaf === "outsideRun") add(`rbCarry:${rating(rb, "speed") - rating(qb, "speed") >= 10 ? "fast" : rating(rb, "speed") - rating(qb, "speed") <= -5 ? "slow" : "mid"}`, parts["ballCarrier"] === rb.id ? 1 : 0);
      }
    }
  }
  return out;
}

const mean = (o: { sum: number; n: number } | undefined): number => (o === undefined || o.n === 0 ? Number.NaN : o.sum / o.n);

export function checkTiltGaps(g: Record<string, { sum: number; n: number }>): void {
  // 20+ completions lean to Speed more than short completions do.
  expect(mean(g["wrSpeed:c20"]) - mean(g["wrSpeed:short"])).toBeGreaterThan(1.5);
  // Incompletions lean away from Hands, compared with catches.
  expect(mean(g["wrHands:inc"]) - mean(g["wrHands:catch"])).toBeLessThan(-1.5);
  // Sacks lean to Pass Rush, interceptions to Ball Skills (no slot weights: equal base within the position).
  expect(mean(g["dlPassRush:sack"])).toBeGreaterThan(1.5);
  expect(mean(g["cbBallSkills:int"])).toBeGreaterThan(1.5);
  // RB carries rise with the RB's speed over the QB's.
  expect(mean(g["rbCarry:fast"]) - mean(g["rbCarry:slow"])).toBeGreaterThan(0.02);
}

