// Test-writer heavy spec checks for M1 step 5c (docs/specs/m1-step5c-playtest-fixes.md):
// - A2 / c.ot.complete: postseason games, league 4242, seeds 1-10,000: every game returns a record, none tied.
// - G1: "a check over 1,500 games that no line breaks these rules. It fails on any instance."

import { describe, expect, it } from "vitest";
import { boxScore } from "../../packages/sim/src/loop/box";
import { averageCoachFor, leagueFromSeed, setupGame } from "../../packages/sim/src/loop/league";
import { playGame, prepareGame, type GameRecord } from "../../packages/sim/src/loop/play";
import { Rng } from "../../packages/sim/src/rng";
import { loadGameData } from "../../scripts/game/data";
import { eventLine } from "../../scripts/game/render";

const data = loadGameData();
const kit = prepareGame(data);
const coach = averageCoachFor(data);

describe("A2: c.ot.complete, the 10,000-game postseason soak", () => {
  it("league 4242, seeds 1-10,000, postseason: every game has a record and a winner", () => {
    const teams = leagueFromSeed(data, 4242).teams;
    const bad: string[] = [];
    for (let seed = 1; seed <= 10_000; seed++) {
      try {
        const r = playGame(setupGame(teams, 4242, seed, () => coach, "postseason"), kit, Rng.fromSeed(seed));
        if (r.final.phase !== "final" || r.final.result === null || r.final.result.winner === null) bad.push(`seed ${seed}: no winner`);
      } catch (e) {
        bad.push(`seed ${seed}: ${(e as Error).message}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("G1: 1,500 games, no line breaks the text rules", () => {
  it("fumbles kept, matchup direction, fluke and common thresholds, net drive yards, one end-of-period line each", () => {
    const fluke = data.engine.config.fluke.classProbabilityBelow * 100;
    const common = data.engine.why.commonAtLeastPct;
    expect(typeof common).toBe("number");
    const teams = leagueFromSeed(data, 2026).teams;
    const bad: string[] = [];
    let kept = 0;
    let ot = 0;
    for (let seed = 1; seed <= 1500; seed++) {
      const r: GameRecord = playGame(setupGame(teams, 2026, seed, () => coach), kit, Rng.fromSeed(seed));
      const ends: string[] = [];
      if (r.final.period > 4) ot++;
      for (const e of r.events) {
        const line = eventLine(e, r, data);
        const tag = `seed ${seed}: ${line}`;
        if (e.t === "endPeriod") ends.push(line.split(":")[0] as string);
        if (e.t === "play") {
          const cls = (e.play.detail as Record<string, unknown> | undefined)?.["class"];
          const lost = "end" in e.play && e.play.end?.possession === "defense";
          if ((cls === "fumble" || cls === "fumbleCatch") && !lost) {
            kept++;
            if (!/FUMBLE, recovered by [A-Z]+/.test(line)) bad.push(`kept fumble without the fumble and recovery: ${tag}`);
          }
        }
        if (/more or less likely/.test(line)) bad.push(`undirected matchup: ${tag}`);
        const up = line.match(/made .* more likely \(x([\d.]+)\)/);
        if (up !== null && Number(up[1]) < 1) bad.push(`"more likely" below 1: ${tag}`);
        const down = line.match(/happened despite the matchup \(x([\d.]+)\)/);
        if (down !== null && Number(down[1]) > 1) bad.push(`"despite" above 1: ${tag}`);
        const f = line.match(/a fluke, only ([\d.]+)%/);
        // The engine flags a fluke when the class's base probability is below the threshold, and the line
        // prints that probability rounded to 0.1 (resolve.ts), so 4.95-4.99% prints as "5": a printed value
        // above the threshold is a breach; one equal to it is the rounding (reported to the lead, not gated).
        if (f !== null && Number(f[1]) > fluke) bad.push(`fluke above ${fluke}%: ${tag}`);
        const c = line.match(/a common result in this situation \(([\d.]+)%\)/);
        if (c !== null && Number(c[1]) < (common as number)) bad.push(`common below ${String(common)}%: ${tag}`);
      }
      if (new Set(ends).size !== ends.length) bad.push(`seed ${seed}: an end-of-period line twice: ${ends.join(", ")}`);
      for (const d of boxScore(r, data.engine.rules).drives) if (d.result === "touchdown" && d.yards !== 100 - d.start) bad.push(`seed ${seed}: touchdown drive from ${d.start} shows ${d.yards} yards`);
    }
    expect(bad.slice(0, 20)).toEqual([]);
    // Non-vacuous: the sample holds kept fumbles and overtime games.
    expect(kept).toBeGreaterThan(50);
    expect(ot).toBeGreaterThan(20);
  });
});
