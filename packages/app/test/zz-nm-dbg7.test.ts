import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { at, timeline } from "../src/ui/timeline";
import { playGame } from "./support";
import type { PlayEvent } from "../src/engine/types";
const read = (p: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", p), "utf8"));
it("dbg", () => {
  const templates = parseTemplates(read("data/ui/templates.json"));
  const motion = parseMotion(read("data/ui/motion.json"));
  const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };
  for (const natural of [true, false]) {
  const ctx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion: { ...motion, maxStartMs: 40 }, natural };
  const ev = playGame(71, "away", 71).events.filter((e): e is PlayEvent => e.t === "play" && e.play.kind === "kickoff")[0]!;
  const tl = timeline({ event: ev, runoffSeconds: 0, human: null, ownStart: "lined" }, templates, ctx);
  for (const s of ["XWR1", "XRB1"]) { const m = tl.marks.find((x) => x.side + x.slot === s)!; console.log(natural, s, m.keys.filter((k) => k.t <= tl.snapAt + 120).map((k) => `${k.t - tl.snapAt}:${k.x.toFixed(5)},${k.y.toFixed(5)}`).join(" ")); }
  }
});
