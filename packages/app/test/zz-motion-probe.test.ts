import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { at, timeline } from "../src/ui/timeline";
import { COMPLETE, RUN, SACK, fixturePlayers } from "./fixtures";
const root = join(import.meta.dirname, "../../..");
const read = (p: string): any => JSON.parse(readFileSync(join(root, p), "utf8"));
it("probe", () => {
  const templates = parseTemplates(read("data/ui/templates.json"));
  const motion = parseMotion(read("data/ui/motion.json"));
  const personnel = read("data/engine/personnel.json");
  const ctx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion };
  const out: string[] = [];
  for (const [name, ev] of Object.entries({ COMPLETE, RUN, SACK })) {
    const tl = timeline({ event: ev as any, runoffSeconds: 0 }, templates, ctx);
    out.push(`== ${name} snap ${tl.snapAt} liveEnd ${tl.liveEnd}`);
    for (const m of tl.marks) {
      const sp: number[] = []; const hd: number[] = [];
      for (let t = tl.snapAt; t < tl.liveEnd; t += 50) { const p = at(m.keys, t), q = at(m.keys, t + 50); sp.push(Math.hypot(q.x-p.x,q.y-p.y)*20); hd.push(Math.atan2(q.y-p.y,q.x-p.x)*180/Math.PI); }
      let jerks = 0, turns = 0, still = 0, flat = 0;
      for (let i = 1; i < sp.length; i++) {
        if (Math.abs(sp[i]-sp[i-1]) > 2) jerks++;
        if (sp[i] > 1 && sp[i-1] > 1) { let d = Math.abs(hd[i]-hd[i-1]); if (d>180) d=360-d; if (d>25) turns++; }
        if (sp[i] < 0.2) still++;
        if (sp[i] > 1 && Math.abs(sp[i]-sp[i-1]) < 0.01) flat++;
      }
      out.push(`${(m.side+m.slot).padEnd(6)} jerk${jerks} turn${turns} still${still}/${sp.length} flat${flat} sp ${sp.filter((_,i)=>i%4===0).map(v=>v.toFixed(1)).join(" ")}`);
    }
  }
  writeFileSync(process.env.PROBE_OUT!, out.join("\n"));
});
