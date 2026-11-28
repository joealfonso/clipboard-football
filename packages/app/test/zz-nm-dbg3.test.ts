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
  let n = Number(process.env.N);
  let ev: PlayEvent | undefined;
  for (let seed = 1; seed <= 12 && ev === undefined; seed++) {
    const evs = playGame(seed, seed % 2 === 0 ? "home" : "away", seed).events.filter((e): e is PlayEvent => e.t === "play");
    if (n < evs.length) ev = evs[n];
    else n -= evs.length;
  }
  if (ev === undefined) throw new Error("no play");
  const tl = timeline({ event: ev, runoffSeconds: 12 }, templates, process.env.RAW ? { ...ctx, natural: false } : ctx);
  const m = tl.marks.find((x) => x.side + x.slot === process.env.SLOT)!;
  const t0 = Number(process.env.T);
  const out: string[] = [ev.play.kind + " " + ev.offense.call + " live " + tl.liveEnd + " " + JSON.stringify(tl.paths.map((p) => [p.start, p.end]))];
  for (let t = t0 - 60; t <= t0 + 60; t += 12.5) { const p = at(m.keys, t), b = at(tl.ball, t); out.push(`${t}: d ${Math.hypot(p.x - b.x, p.y - b.y).toFixed(2)} p(${p.x.toFixed(2)},${p.y.toFixed(2)}) b(${b.x.toFixed(1)},${b.y.toFixed(1)})`); }
  console.log(out.join("\n"), "\nKEYS", m.keys.filter((k) => Math.abs(k.t - t0) < 60).map((k) => k.t.toFixed(1) + ":" + k.x.toFixed(2) + "," + k.y.toFixed(2)).join(" "));
});
