import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { at, timeline } from "../src/ui/timeline";
import { COMPLETE, RUN } from "./fixtures";
const read = (p: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", p), "utf8"));
it("dbg", () => {
  const templates = parseTemplates(read("data/ui/templates.json"));
  const motion = parseMotion(read("data/ui/motion.json"));
  const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };
  for (const natural of [true, false]) {
    const ctx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion, natural };
    for (const [n, ev] of [["RUN", RUN], ["COMPLETE", COMPLETE]] as const) {
      const tl = timeline({ event: ev, runoffSeconds: 0 }, templates, ctx);
      const o = tl.marks.find((m) => m.slot === "OL4")!, d = tl.marks.find((m) => m.slot === "DL3")!;
      const row: string[] = [];
      for (const t of [tl.liveEnd - 600, tl.liveEnd - 300, tl.liveEnd]) { const a = at(o.keys, t), b = at(d.keys, t); row.push(`${(t - tl.liveEnd).toFixed(0)}: OL4(${a.x.toFixed(2)},${a.y.toFixed(2)}) DL3(${b.x.toFixed(2)},${b.y.toFixed(2)})`); }
      console.log(natural, n, JSON.stringify(d.nat?.engaged), row.join(" | "));
    }
  }
});
