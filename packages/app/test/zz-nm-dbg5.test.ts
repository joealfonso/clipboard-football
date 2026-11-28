import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import type { PlayResult } from "@clipboard-football/shared";
import type { PlayEvent } from "../src/engine/types";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { at, timeline } from "../src/ui/timeline";
import { snap } from "./fixtures";
const root = join(import.meta.dirname, "../../..");
const read = (p: string): any => JSON.parse(readFileSync(join(root, p), "utf8"));
const personnel = read("data/engine/personnel.json");
const ids = (prefix: string, counts: Record<string, number>): Record<string, string[]> => Object.fromEntries(Object.entries(counts).map(([pos, n]) => [pos, Array.from({ length: n }, (_, i) => `${prefix}-${pos}${i + 1}`)]));
interface EvSpec {
  readonly formation: string;
  readonly call: string;
  readonly preset: string;
  readonly result: "complete" | "incomplete" | "run" | "sack" | "interception";
  readonly gain?: number;
  readonly spot?: number;
  readonly parts?: Record<string, string>;
  readonly runLocation?: "left" | "middle" | "right";
  readonly airYards?: number;
  readonly twoPointPlay?: string;
}
function mk(e: EvSpec): PlayEvent {
  const los = e.spot ?? 35;
  const gain = e.gain ?? 0;
  const onField = { offense: ids("O", personnel.offense[e.formation] as Record<string, number>), defense: ids("X", personnel.packages[personnel.presetPackage[e.preset] as string] as Record<string, number>) };
  const detail: Record<string, unknown> = { participants: e.parts ?? {}, onField, headline: "h", yards: gain };
  if (e.runLocation !== undefined) detail["runLocation"] = e.runLocation;
  if (e.airYards !== undefined) detail["airYards"] = e.airYards;
  const end = { spot: los + gain, possession: "offense" as const };
  const play = (
    e.result === "complete"
      ? { kind: "pass", seconds: 6, end, detail }
      : e.result === "incomplete"
        ? { kind: "pass", seconds: 5, incomplete: true, end: { spot: los, possession: "offense" }, detail }
        : e.result === "run"
          ? { kind: "run", seconds: 5, end, detail }
          : e.result === "sack"
            ? { kind: "sack", seconds: 5, end, detail }
            : { kind: "pass", seconds: 6, turnover: "interception", end: { spot: los + gain, possession: "defense" }, detail }
  ) as PlayResult;
  const offense = (e.twoPointPlay !== undefined ? { call: e.call, formation: e.formation, twoPointPlay: e.twoPointPlay } : { call: e.call, formation: e.formation }) as PlayEvent["offense"];
  return { t: "play", before: snap({ spot: los, down: 1, distance: 10 }), offense, defense: e.preset, play, penalty: null, runoffTimeout: false, after: snap({ spot: los + gain, down: 1, distance: 10 }) };
}
it("dbg", () => {
  const templates = parseTemplates(read("data/ui/templates.json"));
  const motion = parseMotion(read("data/ui/motion.json"));
  const out: string[] = [];
  for (const natural of [true, false]) {
    const ctx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion, natural };
    const p = (result: any, gain: number, parts: any) => mk({ formation: process.env.F!, call: process.env.C!, preset: process.env.P!, result, gain, parts: { passer: "O-QB1", ...parts } });
    const a = timeline({ event: p("complete", 18, { target: "O-WR1", receiver: "O-WR1", tackler: "X-CB1" }), runoffSeconds: 0 }, templates, ctx);
    for (const ev of [p("incomplete", 0, { target: "O-TE1" }), p("complete", 9, { target: "O-WR2", receiver: "O-WR2", tackler: "X-LB1" }), p("complete", 26, { target: "O-TE1", receiver: "O-TE1", tackler: "X-S2" })]) {
      const b = timeline({ event: ev, runoffSeconds: 0 }, templates, ctx);
      const t1 = Math.min(a.paths[0]?.start ?? a.read, b.paths[0]?.start ?? b.read);
      for (const m of a.marks.filter((x) => x.side === "X")) {
        const n = b.marks.find((x) => x.playerId === m.playerId)!;
        for (let t = a.snapAt; t <= t1; t += 5) { const d = Math.hypot(at(m.keys, t).x - at(n.keys, t).x, at(m.keys, t).y - at(n.keys, t).y); if (d > 1e-9) { out.push(`A ${m.keys.filter((k) => k.t >= 1450 && k.t <= 1525).map((k) => k.t + ":" + k.x.toFixed(4) + "," + k.y.toFixed(4)).join(" ")}\nB ${n.keys.filter((k) => k.t >= 1450 && k.t <= 1525).map((k) => k.t + ":" + k.x.toFixed(4) + "," + k.y.toFixed(4)).join(" ")}`); out.push(`nat ${natural} ${m.slot} ${d.toFixed(4)} at ${t - a.snapAt} (t1 ${t1 - a.snapAt}) keysA ${m.keys.filter((k) => Math.abs(k.t - t) < 30).map((k) => k.t.toFixed(1)).join(",")} keysB ${n.keys.filter((k) => Math.abs(k.t - t) < 30).map((k) => k.t.toFixed(1)).join(",")}`); break; } }
      }
    }
  }
  console.log(out.join("\n"));
});
