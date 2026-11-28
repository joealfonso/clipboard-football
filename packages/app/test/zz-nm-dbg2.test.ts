import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { at, timeline } from "../src/ui/timeline";
import * as F from "./fixtures";
const root = join(import.meta.dirname, "../../..");
const read = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));
it("dbg", () => {
  const templates = parseTemplates(read("data/ui/templates.json"));
  const motion = parseMotion(read("data/ui/motion.json"));
  const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };
  const ctx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion };
  const tl = timeline({ event: (F as Record<string, unknown>)[process.env.FX as string] as never, runoffSeconds: 12 }, templates, ctx);
  const m = tl.marks.find((x) => x.side + x.slot === process.env.SLOT)!;
  const t0 = Number(process.env.T);
  const ks = m.keys.filter((k) => k.t > t0 - 80 && k.t < t0 + 80).map((k) => `${k.t.toFixed(1)}:${k.x.toFixed(2)},${k.y.toFixed(2)}`);
  const bs: string[] = [];
  for (let t = t0 - 50; t <= t0 + 50; t += 12.5) { const p = at(m.keys, t), b = at(tl.ball, t); bs.push(`${t}: d ${Math.hypot(p.x - b.x, p.y - b.y).toFixed(2)} b(${b.x.toFixed(1)},${b.y.toFixed(1)})`); }
  console.log(m.side, m.fact, JSON.stringify(tl.paths.map((p) => [p.start, p.end])), "\n", ks.join(" "), "\n", bs.join("\n"));
});
