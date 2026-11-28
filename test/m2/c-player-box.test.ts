// M2 milestone C, per-player stats and rating ranks (docs/specs/m2-engine-and-game-loop.md C1-C6,
// C1 as amended 2026-11-14). The team box is the step 5 box (boxScore); the player box must add
// up to it, except that completions, catches and their yards leave out intercepted passes the
// offense recovered (defensePossessedDuringPlay with no turnover), which the team box counts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { playerBoxScoreSchema, ratingRanksSchema } from "../../packages/shared/src/m2-schema";
import { BASE_RATINGS, POSITION_SKILLS } from "../../packages/shared/src/engine";
import type { PlayerBoxScore } from "../../packages/shared/src/game";
import type { Participants, TeamPool } from "../../packages/shared/src/types";
import { boxScore, playStands, kickStands } from "../../packages/sim/src/loop/box";
import { leagueFromSeed } from "../../packages/sim/src/loop/league";
import { playerBoxScore, ratingRanks } from "../../packages/sim/src/loop/player-box";
import { playGame, type GameEvent, type GameRecord } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { REPO } from "../../scripts/game/data";
import { data, kit, sliceGames } from "./support";
import { c1Sums } from "./c1";

// Whole games per test: the default 5 s is too short when the full suite runs in parallel.
vi.setConfig({ testTimeout: 120_000 });

const rules = data.engine.rules;
type PlayEv = Extract<GameEvent, { t: "play" }>;

const N = 150;
const games = sliceGames(N).map((g) => ({ ...g, record: playGame(g.setup, kit, Rng.fromSeed(g.seed)) }));

describe("C1: player lines sum to the team box (first 150 CI slice games; all 1,000 in the heavy run)", () => {
  it("every sum matches in every game", () => {
    const bad: string[] = [];
    for (const g of games) for (const [what, got, want] of c1Sums(g.record)) if (got !== want) bad.push(`game ${g.index} (seed ${g.seed}): ${what}: players ${got}, team ${want}`);
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it("the slice has the plays the sums exercise", () => {
    let fg = 0;
    let ints = 0;
    let sacks = 0;
    let punts = 0;
    for (const g of games) {
      const tb = boxScore(g.record, rules);
      for (const t of ["home", "away"] as const) {
        fg += tb[t].fieldGoalAttempts;
        ints += tb[t].interceptions;
        sacks += tb[t].sacks;
        punts += tb[t].punts;
      }
    }
    expect(Math.min(fg, ints, sacks, punts)).toBeGreaterThan(50);
  });
});

// ------------------------------------------------------------------ C2: scripted logs

/** A record holding only the given events (the box reads the event log alone, C3). */
const logOf = (base: GameRecord, events: readonly GameEvent[]): GameRecord => ({ ...base, events });
const allPlays = games.flatMap((g) => g.record.events.filter((e): e is PlayEv => e.t === "play").map((e) => ({ e, record: g.record })));
const find = (f: (e: PlayEv) => boolean): { e: PlayEv; record: GameRecord } => {
  const x = allPlays.find(({ e }) => f(e));
  if (x === undefined) throw new Error("no such play in the slice");
  return x;
};
const statCount = (b: PlayerBoxScore): number => Object.keys(b.players).length;
const parts = (e: PlayEv): Participants => (e.play.detail as { participants: Participants }).participants;

describe("C2: plays that don't stand add no player stat (scripted logs)", () => {
  const completion = find((e) => e.before.phase === "scrimmage" && e.penalty === null && e.play.kind === "pass" && e.play.incomplete !== true && e.play.turnover === undefined && parts(e).receiver !== undefined && parts(e).tackler !== undefined);
  const punt = find((e) => e.penalty === null && e.play.kind === "punt" && parts(e).tackler !== undefined);
  const fg = find((e) => e.penalty === null && e.play.kind === "fieldGoal" && e.play.good);
  const xp = find((e) => e.penalty === null && e.before.phase === "try" && e.play.kind === "extraPoint");
  const noPlay = find((e) => e.play.kind === "noPlay");

  const wiped = (e: PlayEv, penalty: string, by: "offense" | "defense", option: PlayEv["penalty"], after = e.after): PlayEv => ({ ...e, play: { ...e.play, fouls: [{ penalty, by }] }, penalty: option, after });

  it("control: the plays stand and count when no foul is accepted", () => {
    expect(playerBoxScore(logOf(completion.record, [completion.e]), rules).players[parts(completion.e).receiver as string]?.receiving?.catches).toBe(1);
    expect(playerBoxScore(logOf(punt.record, [punt.e]), rules).players[parts(punt.e).punter as string]?.punting?.punts).toBe(1);
    expect(playerBoxScore(logOf(fg.record, [fg.e]), rules).players[parts(fg.e).kicker as string]?.kicking?.fieldGoalAttempts).toBe(1);
    expect(playerBoxScore(logOf(xp.record, [xp.e]), rules).players[parts(xp.e).kicker as string]?.kicking?.extraPointAttempts).toBe(1);
  });

  it("a completion wiped by accepted holding adds nothing for anyone", () => {
    const e = wiped(completion.e, "offensiveHolding", "offense", { kind: "accept", foul: 0 });
    expect(playStands(e, rules)).toBe(false);
    expect(statCount(playerBoxScore(logOf(completion.record, [e]), rules))).toBe(0);
  });

  it("a completion with offsetting fouls (down replayed) adds nothing", () => {
    const e: PlayEv = { ...completion.e, play: { ...completion.e.play, fouls: [{ penalty: "offensiveHolding", by: "offense" }, { penalty: "defensiveHolding", by: "defense" }] }, penalty: { kind: "offset" } };
    expect(statCount(playerBoxScore(logOf(completion.record, [e]), rules))).toBe(0);
  });

  it("a completion with a declined foul, or a dead-ball foul enforced after the down, still counts", () => {
    const declined = wiped(completion.e, "defensiveHolding", "defense", { kind: "decline" });
    expect(playerBoxScore(logOf(completion.record, [declined]), rules).players[parts(completion.e).receiver as string]?.receiving?.catches).toBe(1);
    const after = wiped(completion.e, "unnecessaryRoughnessDeadBall", "defense", { kind: "accept", foul: 0 });
    expect(playerBoxScore(logOf(completion.record, [after]), rules).players[parts(completion.e).receiver as string]?.receiving?.catches).toBe(1);
  });

  it("a pre-snap foul (noPlay) adds nothing", () => {
    expect(statCount(playerBoxScore(logOf(noPlay.record, [noPlay.e]), rules))).toBe(0);
  });

  it("a punt and a field goal wiped by a foul that replays the down add nothing", () => {
    for (const k of [punt, fg]) {
      const replay = { ...k.e.before, down: k.e.before.down, possession: k.e.before.possession, phase: "scrimmage" as const };
      const e = wiped(k.e, "defensiveOffside", "defense", { kind: "accept", foul: 0 }, replay);
      expect(kickStands(e, rules)).toBe(false);
      expect(statCount(playerBoxScore(logOf(k.record, [e]), rules)), k.e.play.kind).toBe(0);
    }
  });

  it("an extra point wiped by an accepted foul adds nothing", () => {
    const e = wiped(xp.e, "offensiveHolding", "offense", { kind: "accept", foul: 0 });
    expect(statCount(playerBoxScore(logOf(xp.record, [e]), rules))).toBe(0);
  });
});

// ------------------------------------------------------------------ C3, C4

describe("C3: the box comes from the event log alone", () => {
  it("re-running it from a parsed JSON record, or from the events alone, gives the same box", () => {
    for (const g of games.slice(0, 40)) {
      const want = playerBoxScore(g.record, rules);
      expect(playerBoxScore(JSON.parse(JSON.stringify(g.record)) as GameRecord, rules)).toEqual(want);
      expect(playerBoxScore({ events: JSON.parse(JSON.stringify(g.record.events)) } as unknown as GameRecord, rules)).toEqual(want);
    }
  });
});

describe("C4: no stat is absent, never 0", () => {
  it("a category is present only with a stat in it; lines parse under the schema; only credited players have lines", () => {
    const bad: string[] = [];
    for (const g of games) {
      const b = playerBoxScore(g.record, rules);
      expect(() => playerBoxScoreSchema.parse(b)).not.toThrow();
      const credited = new Set<string>();
      for (const e of g.record.events) if (e.t === "play") for (const [k, v] of Object.entries(parts(e))) if (k !== "foulers") credited.add(v as string);
      for (const l of Object.values(b.players)) {
        if (!credited.has(l.id)) bad.push(`${l.id} has a line but was never credited`);
        if (l.passing !== undefined && l.passing.attempts + l.passing.sacked === 0) bad.push(`${l.id} passing with no attempt`);
        if (l.rushing !== undefined && l.rushing.attempts === 0) bad.push(`${l.id} rushing with no attempt`);
        if (l.receiving !== undefined && l.receiving.targets === 0 && l.receiving.catches === 0) bad.push(`${l.id} receiving with no target`);
        if (l.receiving !== undefined && (l.receiving.long === undefined) !== (l.receiving.catches === 0)) bad.push(`${l.id} receiving long vs catches`);
        if (l.defense !== undefined && Object.values(l.defense).every((x) => x === 0)) bad.push(`${l.id} defense all 0`);
        if (l.kicking !== undefined && l.kicking.fieldGoalAttempts + l.kicking.extraPointAttempts === 0) bad.push(`${l.id} kicking with no attempt`);
        if (l.kicking !== undefined && (l.kicking.long === undefined) !== (l.kicking.fieldGoalsMade === 0)) bad.push(`${l.id} kicking long vs made`);
        if (l.punting !== undefined && l.punting.punts === 0) bad.push(`${l.id} punting with no punt`);
        if (l.rushing !== undefined && !Number.isFinite(l.rushing.long)) bad.push(`${l.id} rushing long not a number`);
        if (Object.keys(l).filter((k) => k !== "id" && k !== "team").length === 0) bad.push(`${l.id} empty line`);
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it("a quarterback who never ran has no rushing line at all (a dash, not 0)", () => {
    let seen = 0;
    for (const g of games) {
      for (const l of Object.values(playerBoxScore(g.record, rules).players)) {
        if (l.passing === undefined || l.rushing !== undefined) continue;
        expect("rushing" in l).toBe(false);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe("C5: MODEL.md documents every stat definition and labels it", () => {
  const doc = readFileSync(join(REPO, "docs/MODEL.md"), "utf8");
  const start = doc.indexOf("## Per-player box score");
  const sec = doc.slice(start, doc.indexOf("\n## ", start + 3));
  it("has the section, labeled, with every category and the one-tackler rule as designed", () => {
    expect(start).toBeGreaterThan(-1);
    expect(sec).toMatch(/\*\*Designed\*\*|designed/);
    for (const w of ["Passing", "Rushing", "Receiving", "Defense", "Kicking", "Punting"]) expect(sec).toContain(w);
    expect(sec).toMatch(/one tackler per play \(designed/i);
  });
  it("claims no NFL convention without a RULES.md citation", () => {
    // A sentence that names an NFL convention either says none is claimed, or cites RULES.md.
    for (const sentence of sec.split(/(?<=\.)\s+/)) {
      if (!/NFL (statistics )?convention/i.test(sentence)) continue;
      if (/^No NFL|none is claimed/i.test(sentence)) continue;
      expect(sentence).toMatch(/RULES\.md|Rule \d/);
    }
  });
});

// ------------------------------------------------------------------ C6

describe("C6: league-wide rating ranks", () => {
  const pools: TeamPool[] = leagueFromSeed(data, 2026).teams.map((t) => t.pool);
  it("every player's rank in each rating matches an independent recount (ties to the lower id, MODEL.md)", () => {
    const ranks = ratingRanks(pools);
    expect(() => ratingRanksSchema.parse(ranks)).not.toThrow();
    const players = pools.flatMap((p) => p.players);
    let checked = 0;
    for (const p of players) {
      const names = [...BASE_RATINGS, ...POSITION_SKILLS[p.position]];
      expect(Object.keys(ranks[p.id] ?? {}).sort(), p.id).toEqual([...names].sort());
      const peers = players.filter((x) => x.position === p.position);
      for (const r of names) {
        const v = (x: typeof p): number => ((x.ratings as Record<string, number>)[r] ?? x.skills[r]) as number;
        const better = peers.filter((x) => v(x) > v(p) || (v(x) === v(p) && x.id < p.id)).length;
        expect(ranks[p.id]?.[r], `${p.id} ${r}`).toEqual({ value: v(p), rank: better + 1, of: peers.length });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
  it("ties exist in the league, so the tie rule is exercised", () => {
    const players = pools.flatMap((p) => p.players);
    const key = (x: (typeof players)[number]): string => `${x.position}:${x.ratings.speed}`;
    expect(new Set(players.map(key)).size).toBeLessThan(players.length);
  });
});
