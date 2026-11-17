import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import type { PlayEvent } from "../src/engine/types";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { at, timeline } from "../src/ui/timeline";
import { playGame } from "./support";
const root = join(import.meta.dirname, "../../..");
const read = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));
it("dbg", () => {
  const templates = parseTemplates(read("data/ui/templates.json"));
  const motion = parseMotion(read("data/ui/motion.json"));
  const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };
  const ctx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion };
  const ev = playGame(1, "away", 1).events.filter((e): e is PlayEvent => e.t === "play")[Number(process.env.N)]!;
  const a = timeline({ event: ev, runoffSeconds: 12 }, templates, ctx);
  const b = timeline({ event: ev, runoffSeconds: 12 }, templates, { ...ctx, natural: false });
  const out: string[] = [JSON.stringify(ev.play.detail && (ev.play.detail as { participants?: unknown }).participants), `holder ${a.holder} live ${a.liveEnd} ${b.liveEnd} paths ${JSON.stringify(a.paths.map((p) => [p.start, p.end]))} ${JSON.stringify(b.paths.map((p) => [p.start, p.end]))}`];
  for (let t = 2000; t <= 3600; t += 200) { const p = at(a.ball, t), q = at(b.ball, t); out.push(`${t} nat(${p.x.toFixed(2)},${p.y.toFixed(2)}) raw(${q.x.toFixed(2)},${q.y.toFixed(2)})`); }
  console.log(out.join("\n"));
});
