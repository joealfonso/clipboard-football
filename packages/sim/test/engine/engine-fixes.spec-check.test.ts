// Spec checks for the code-review fixes on M1 step 4 (test-writer, second pass):
// - detail.sampledClass / sampledYards are a record of the pre-pairing draw only: they never
//   change the outcome, the class or yards the play reports, the trace or the why sentence.
// - Flags per snap: the engine emits fouls at the fitted per-snap category rates (one category
//   per snap: none, one team's foul, or both teams), and records those rates in detail.foulRates.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PlayResult } from "../../../shared/src/types";
import { binSituation, levelKey } from "../../src/caller/bins";
import { generateTeam } from "../../src/engine/players";
import { createEngine } from "../../src/engine/resolve";
import { toSituation } from "../../src/game/situation";
import type { GameState } from "../../src/game/types";
import { Rng } from "../../src/rng";
import { loadCallerData } from "../caller/load-data";
import { callsFor } from "../support/engine-calls";
import { loadEngineData } from "../support/engine-data";
import { flatTeam, scrimmageState } from "../support/engine-fixtures";
import { randomGame } from "../support/random-game";
import { loadRules } from "../support/rules";

const data = loadEngineData();
const { rules, hash } = loadRules();
const caller = loadCallerData();

interface Detail {
  class?: string;
  yards?: number;
  sampledClass?: string;
  sampledYards?: number;
  why: string;
  trace: { factor: string; name?: string; label?: string }[];
  foulRates?: Record<string, number>;
}

describe("sampledClass and sampledYards never change outcomes or the why text", () => {
  it("only the engine's detail writer mentions them in sim sources", () => {
    const src = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../src");
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith(".ts") ? [join(d, n)] : []));
    const uses: string[] = [];
    for (const f of walk(src)) {
      readFileSync(f, "utf8").split("\n").forEach((l, i) => {
        if (/sampled(Class|Yards)/.test(l) && !/^\s*(\/\/|\*)/.test(l)) uses.push(`${f.slice(src.length)}:${i + 1}: ${l.trim()}`);
      });
    }
    expect(uses.every((u) => /detail\["sampled(Class|Yards)"\] = /.test(u)), uses.join("\n")).toBe(true);
  });

  const resolve = createEngine(data);
  const r = Rng.fromSeed(21);
  const players = { home: generateTeam(r, data, "H"), away: generateTeam(r, data, "A") };
  const rows: { s: GameState; p: PlayResult; d: Detail }[] = [];
  for (let g = 0; rows.length < 40_000; g++) {
    for (const s of randomGame(rules, { gameType: "regularSeason", seed: 61_000 + g, rulesHash: hash }, 63_000 + g).states) {
      if (s.phase !== "scrimmage" && s.phase !== "try") continue;
      const c = callsFor(s, rules, caller, r, rows.length % 2 === 1);
      const p = resolve(s, c.offense, c.defense, players, r);
      const d = p.detail as unknown as Detail;
      if (d.sampledClass !== undefined) rows.push({ s, p, d });
      if (rows.length === 40_000) break;
    }
  }
  const pairing = data.config.penalties.pairing;
  const replaces = (p: PlayResult): boolean => (p.fouls ?? []).some((f) => {
    const x = pairing[f.penalty];
    return typeof x === "object" && x.pairs === "incompletePass";
  });

  it("without a replacing foul, the reported class and yards are the sampled ones", () => {
    const bad = rows.filter((x) => !replaces(x.p) && (x.d.class !== x.d.sampledClass || x.d.yards !== x.d.sampledYards));
    expect(bad.length).toBe(0);
  });

  it("after DPI, OPI or grounding the play is the incompletion: class inc, 0 yards, ball at the line, trace and why name inc, not the discarded draw", () => {
    const replaced = rows.filter((x) => replaces(x.p));
    expect(replaced.length).toBeGreaterThan(50);
    const differing = replaced.filter((x) => x.d.sampledClass !== "inc");
    expect(differing.length).toBeGreaterThan(20);
    for (const { s, p, d } of replaced) {
      expect(d.class).toBe("inc");
      expect(d.yards).toBe(0);
      expect((p as { incomplete?: boolean }).incomplete).toBe(true);
      expect((p as { end?: { spot: number; possession: string } }).end).toEqual({ spot: s.spot, possession: "offense" });
      const classes = d.trace.filter((e) => e.factor === "class");
      expect(classes.map((e) => e.name)).toEqual(["inc"]);
    }
    for (const { d } of differing) {
      const sampled = d.trace.find((e) => e.factor === "class" && e.name === d.sampledClass);
      expect(sampled).toBeUndefined();
      const lab = data.why.labels?.[d.sampledClass as string];
      if (typeof lab === "string" && lab.length > 3) expect(d.why).not.toContain(lab);
    }
  });
});

describe("flags per snap: emission matches the fitted per-snap categories", () => {
  const noEffects = { ...data, ratings: { ...data.ratings, effects: [] } };
  const resolve = createEngine(noEffects);
  const team = flatTeam(data, "F", 65);
  const N = 300_000;

  function storedCell(family: string, s: GameState): readonly number[] {
    const labels = binSituation(toSituation(s, rules), { ...data.caller.config.dimensions, ...data.config.dimensions });
    const levels = data.penalties.families[family] ?? [];
    for (let i = 0; i < data.penalties.levels.length; i++) {
      const key = levelKey(data.penalties.levels[i] as never, labels, { pfamily: family });
      const v = key === null ? undefined : levels[i]?.[key];
      if (v !== undefined) return v;
    }
    throw new Error(`no penalty cell for ${family}`);
  }

  it.each([
    ["run", "insideRun", "underCenter", scrimmageState(35, 1, 10)],
    ["pass", "shortPass", "shotgun", scrimmageState(35, 1, 10)],
    ["pass", "deepPass", "shotgun", scrimmageState(45, 3, 8)],
  ])("%s (%s): recorded rates equal the stored cell, and emitted shares match them", (family, leaf, formation, s) => {
    const cell = storedCell(family, s);
    const ids = data.penalties.ids;
    const rng = Rng.fromSeed(404);
    let rec: Record<string, number> | undefined;
    let anyFlag = 0;
    let both = 0;
    const per: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      const p = resolve(s, { call: leaf, formation }, "nickelCover3", { home: team, away: team }, rng);
      rec ??= (p.detail as unknown as Detail).foulRates;
      const fouls = p.fouls ?? [];
      if (fouls.length > 0) anyFlag++;
      if (new Set(fouls.map((f) => f.by)).size > 1) both++;
      for (const id of new Set(fouls.map((f) => f.penalty))) per[id] = (per[id] ?? 0) + 1;
    }
    if (rec === undefined) throw new Error("no foulRates");
    const pairing = data.config.penalties.pairing;
    const eligible = ids.filter((id) => {
      const x = pairing[id];
      return typeof x === "object" && x.families.includes(family);
    });
    const oneTeam = eligible.reduce((a, id) => a + (cell[ids.indexOf(id)] as number), 0) / 1_000_000;
    const dbl = data.penalties.doublePer1000000 / 1_000_000;
    expect(rec["anyFlag"]).toBeCloseTo(oneTeam + dbl, 9);
    expect(rec["twoFlags"]).toBeCloseTo(dbl, 9);
    const within = (got: number, want: number, label: string): void => {
      const se = Math.sqrt((want * (1 - want)) / N);
      expect(Math.abs(got / N - want), `${label}: got ${((got / N) * 100).toFixed(3)}%, want ${(want * 100).toFixed(3)}%`).toBeLessThanOrEqual(4 * se + 1e-5);
    };
    within(anyFlag, rec["anyFlag"] as number, "any flag");
    within(both, rec["twoFlags"] as number, "both teams");
    for (const id of eligible) within(per[id] ?? 0, rec[id] ?? 0, id);
  }, 120_000);
});
