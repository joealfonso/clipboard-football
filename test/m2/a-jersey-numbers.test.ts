// M2 milestone A, jersey numbers (docs/specs/m2-engine-and-game-loop.md A1-A4). Written from the
// spec and docs/RULES.md (Rule 5-1-2): the allowed ranges here are read from the RULES.md prose,
// not from the rule set file, so a wrong value in the data fails twice (here and in the
// RULES.md row test).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseTeamPool, parseTeamPoolV1 } from "../../packages/shared/src/engine-schema";
import { POSITIONS, type Player, type TeamPool } from "../../packages/shared/src/engine";
import { migrateTeamPool } from "../../packages/sim/src/engine/players";
import { leagueFromSeed } from "../../packages/sim/src/loop/league";
import { REPO } from "../../scripts/game/data";
import { runSeeds } from "../../scripts/game/metrics";
import { playersDigest, type DigestFile } from "../../scripts/game/outcome-digests";
import { data } from "./support";

// Whole games per test: the default 5 s is too short when the full suite runs in parallel.
vi.setConfig({ testTimeout: 120_000 });

const rules = data.engine.rules;
const baseline = JSON.parse(readFileSync(join(REPO, "test/fixtures/m2-baseline-digests.json"), "utf8")) as DigestFile;

/** RULES.md "Jersey numbers" bullets -> position -> inclusive ranges. */
function rulesMdRanges(): Record<string, [number, number][]> {
  const doc = readFileSync(join(REPO, "docs/RULES.md"), "utf8");
  const start = doc.indexOf("## Jersey numbers");
  const section = doc.slice(start, doc.indexOf("\n## ", start + 3));
  const groups: [RegExp, string[]][] = [
    [/^Quarterbacks$/, ["QB"]],
    [/^Punters and placekickers$/, ["P", "K"]],
    [/^Defensive backs$/, ["CB", "S"]],
    [/^Running backs.*tight ends.*wide receivers$/, ["RB", "TE", "WR"]],
    [/^Offensive linemen$/, ["OL"]],
    [/^Defensive linemen$/, ["DL"]],
    [/^Linebackers$/, ["LB"]],
  ];
  const out: Record<string, [number, number][]> = {};
  for (const line of section.split("\n").filter((l) => l.startsWith("- "))) {
    const m = /^- (.+?): (.+)\.$/.exec(line);
    if (m === null) continue;
    const ranges = [...(m[2] as string).matchAll(/(\d+)-(\d+)/g)].map((x) => [Number(x[1]), Number(x[2])] as [number, number]);
    const g = groups.find(([re]) => re.test(m[1] as string));
    if (g === undefined) throw new Error(`RULES.md bullet with no position mapping: ${line}`);
    for (const p of g[1]) out[p] = ranges;
  }
  return out;
}

const allowed = rulesMdRanges();
const okFor = (position: string, n: number): boolean => Number.isInteger(n) && (allowed[position] ?? []).some(([a, b]) => n >= a && n <= b);

function checkNumbers(pool: TeamPool): string[] {
  const bad: string[] = [];
  const seen = new Map<number, string>();
  for (const p of pool.players) {
    if (!okFor(p.position, p.number)) bad.push(`${pool.name} ${p.id} ${p.position} #${p.number}`);
    const had = seen.get(p.number);
    if (had !== undefined) bad.push(`${pool.name}: ${had} and ${p.id} both #${p.number}`);
    seen.set(p.number, p.id);
  }
  return bad;
}

const lg = data.config.league;
const leagueSeeds = runSeeds(lg.calibrationSeed, lg.leagues, lg.gamesPerLeague).leagueSeeds;
const leagues = leagueSeeds.map((s) => leagueFromSeed(data, s).teams);

describe("A1: the numbering rule is in the rule set data, as RULES.md cites it", () => {
  it("RULES.md lists a range for every position the game uses", () => {
    for (const p of POSITIONS) expect(allowed[p], p).toBeDefined();
  });

  it("every position's rule set leaf equals the RULES.md ranges, and no extra leaf", () => {
    expect(Object.keys(rules.jerseyNumbers).sort()).toEqual([...POSITIONS].sort());
    for (const p of POSITIONS) expect(rules.jerseyNumbers[p], p).toEqual(allowed[p]);
  });
});

describe("A2: player schema version 2", () => {
  const good = leagues[0]?.[0]?.pool as TeamPool;
  const edit = (i: number, change: Partial<Player>): unknown => ({ ...good, players: good.players.map((p, j) => (j === i ? { ...p, ...change } : p)) });
  const qb = good.players.findIndex((p) => p.position === "QB");
  const ol = good.players.findIndex((p) => p.position === "OL");

  it("a generated pool parses with the rule set", () => {
    expect(() => parseTeamPool(good, rules)).not.toThrow();
    expect(good.schemaVersion).toBe(2);
    for (const p of good.players) expect(p.schemaVersion).toBe(2);
  });

  it("rejects a duplicate number within a team", () => {
    // Two wide receivers: the copied number is allowed for the position, only the duplicate is wrong.
    const [wr1, wr2] = good.players.flatMap((p, j) => (p.position === "WR" ? [j] : [])) as [number, number];
    const dupe = edit(wr2, { number: good.players[wr1]?.number as number });
    expect(() => parseTeamPool(dupe)).toThrow();
    expect(() => parseTeamPool(dupe, rules)).toThrow();
  });

  it.each([100, -1, 7.5])("rejects number %s", (n) => {
    expect(() => parseTeamPool(edit(qb, { number: n }))).toThrow();
    expect(() => parseTeamPool(edit(qb, { number: n }), rules)).toThrow();
  });

  it("rejects a number the rule set forbids for the position", () => {
    const free = (n: number): boolean => !good.players.some((p) => p.number === n);
    const qbBad = [20, 50, 60, 85, 95].find(free) as number;
    expect(okFor("QB", qbBad)).toBe(false);
    expect(() => parseTeamPool(edit(qb, { number: qbBad }), rules)).toThrow();
    const olBad = [0, 10, 30, 85, 95].find(free) as number;
    expect(() => parseTeamPool(edit(ol, { number: olBad }), rules)).toThrow();
  });

  it("rejects a version 2 player with no number, and a non-integer string", () => {
    const { number: _drop, ...rest } = good.players[qb] as Player;
    void _drop;
    expect(() => parseTeamPool({ ...good, players: good.players.map((p, j) => (j === qb ? rest : p)) })).toThrow();
    expect(() => parseTeamPool(edit(qb, { number: "7" as unknown as number }))).toThrow();
  });
});

describe("A3: version 1 pools migrate by seed", () => {
  const v2 = leagues[1]?.[3]?.pool as TeamPool;
  const omit = <T extends object>(o: T, ...keys: string[]): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
  const v1 = { schemaVersion: 1, name: v2.name, players: v2.players.map((p) => ({ ...omit(p, "number"), schemaVersion: 1 })) };

  it("the version 1 pool still parses as version 1, and not as version 2", () => {
    expect(() => parseTeamPoolV1(v1)).not.toThrow();
    expect(() => parseTeamPool(v1)).toThrow();
  });

  it("same pool and seed give the same numbers; the result passes A2 and keeps every other field", () => {
    const parsed = parseTeamPoolV1(v1);
    const a = migrateTeamPool(parsed, rules, 77);
    const b = migrateTeamPool(parseTeamPoolV1(JSON.parse(JSON.stringify(v1))), rules, 77);
    expect(a).toEqual(b);
    expect(() => parseTeamPool(a, rules)).not.toThrow();
    expect(checkNumbers(a)).toEqual([]);
    expect(a.schemaVersion).toBe(2);
    expect(a.players.map((p) => omit(p, "number", "schemaVersion"))).toEqual(v1.players.map((p) => omit(p, "schemaVersion")));
  });

  it("numbers depend on the seed", () => {
    const parsed = parseTeamPoolV1(v1);
    const seeds = [1, 2, 3, 4, 5].map((s) => JSON.stringify(migrateTeamPool(parsed, rules, s).players.map((p) => p.number)));
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });
});

describe("A4: numbering changes nothing else the generator makes", () => {
  it("every generated team in the 10 calibration leagues has unique numbers allowed by RULES.md", () => {
    const bad = leagues.flatMap((teams) => teams.flatMap((t) => checkNumbers(t.pool)));
    expect(bad).toEqual([]);
  });

  it("each league's players, number and schema version left out, are the pre-M2 players", () => {
    expect(leagueSeeds).toEqual(baseline.leagues.map((l) => l.leagueSeed));
    leagues.forEach((teams, i) => expect(playersDigest(teams.map((t) => t.pool)), `league ${i}`).toBe(baseline.leagues[i]?.players));
  });
});
