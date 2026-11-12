// A foul paired with an incompletion (defensive or offensive pass interference, grounding)
// replaces the sampled play: the class, yards, trace, fluke check and why sentence describe the
// incompletion as enforced, never the discarded draw.

import { describe, expect, it } from "vitest";
import type { EngineData } from "../../../shared/src/engine";
import { createEngine } from "../../src/engine/resolve";
import { Rng } from "../../src/rng";
import { loadEngineData } from "../support/engine-data";
import { flatTeam, scrimmageState } from "../support/engine-fixtures";

/** Every shortPass pool holds one 45-yard completion that scored; every pass snap draws `id`. */
function forced(d: EngineData, id: string): EngineData {
  const pools = d.scrimmage.pools.map((level) => Object.fromEntries(Object.entries(level).map(([k, v]) => [k, k.startsWith("shortPass|") || k.startsWith("pass|") ? [45, 2, 0, 0, 1] : v])));
  const idx = d.penalties.ids.indexOf(id);
  const families = {
    ...d.penalties.families,
    pass: d.penalties.families["pass"]?.map((cells) => Object.fromEntries(Object.entries(cells).map(([k, xs]) => [k, xs.map((_x, i) => (i === idx ? 1_000_000 : 0))]))) ?? [],
  };
  return { ...d, scrimmage: { ...d.scrimmage, pools }, penalties: { ...d.penalties, families, doublePer1000000: 0 } };
}

describe("fouls paired with an incompletion", () => {
  const data = loadEngineData();
  const team = flatTeam(data, "F", 65);
  const s = scrimmageState(40, 1, 10);

  it.each(["defensivePassInterference", "offensivePassInterference", "intentionalGrounding"])("%s: the long completion is never the class, the yards, a fluke or a 20+ sentence", (id) => {
    const resolve = createEngine(forced(data, id));
    for (let seed = 1; seed <= 300; seed++) {
      const p = resolve(s, { call: "shortPass", formation: "shotgun" }, "nickelCover3", { home: team, away: team }, Rng.fromSeed(seed));
      const d = p.detail as { class: string; yards: number; fluke: boolean; why: string; trace: { factor: string; name?: string }[] };
      expect(p.kind === "pass" && p.incomplete === true && p.fouls?.[0]?.penalty === id).toBe(true);
      expect(d.class).toBe("inc");
      expect(d.yards).toBe(0);
      expect(d.fluke).toBe(false);
      expect(d.why).not.toMatch(/fluke|20-yard|10-yard/);
      expect(d.trace.filter((e) => e.factor === "class").map((e) => e.name)).toEqual(["inc"]);
    }
  });
});
