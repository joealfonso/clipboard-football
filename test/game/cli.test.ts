// M1 step 5, milestone E: the headless CLI.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boxScore } from "../../packages/sim/src/loop/box";
import type { GameRecord } from "../../packages/sim/src/loop/play";
import { REPO, loadGameData } from "../../scripts/game/data";
import { eventLine } from "../../scripts/game/render";
import { simGame } from "../../scripts/game/sim-game";

const data = loadGameData();
const text = simGame(["--seed", "3", "--league-seed", "2026"]);
const record = JSON.parse(simGame(["--seed", "3", "--league-seed", "2026", "--format", "json"])) as GameRecord;

describe("CLI (E)", () => {
  it("E1: header, one line per event and a box score; snapshot on a fixed seed", () => {
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/headless game/);
    expect(lines.join("\n")).toMatch(/BOX SCORE/);
    expect(lines.join("\n")).toMatch(/DRIVES/);
    for (const ev of record.events) expect(text).toContain(eventLine(ev, record, data));
    expect(text).toMatchSnapshot();
  });

  it("E2: same seed twice is byte-identical; seed and league seed are on the first lines", () => {
    expect(simGame(["--seed", "3", "--league-seed", "2026"])).toBe(text);
    expect(text.split("\n")[1]).toBe("seed 3  league seed 2026  regularSeason");
    expect(simGame(["--seed", "4", "--league-seed", "2026"])).not.toBe(text);
  });

  it("E3: a play line's why text is that play's detail.why; loop lines have none", () => {
    for (const ev of record.events) {
      const line = eventLine(ev, record, data);
      if (ev.t === "play") {
        const why = (ev.play.detail ?? {})["why"];
        expect(typeof why).toBe("string");
        expect(line.endsWith(`Why: ${why as string}`)).toBe(true);
      } else expect(line).not.toMatch(/Why:/);
    }
  });

  it("E4: box score totals match the event log", () => {
    const box = boxScore(record, data.engine.rules);
    expect(box.home.points).toBe(record.final.score.home);
    expect(box.away.points).toBe(record.final.score.away);
    for (const t of ["home", "away"] as const) expect(box[t].byPeriod.reduce((a, b) => a + b, 0)).toBe(record.final.score[t]);
    const plays = record.events.flatMap((e) => (e.t === "play" ? [e] : []));
    const accepted = plays.filter((e) => e.penalty?.kind === "accept").length;
    expect(box.home.penalties + box.away.penalties).toBe(accepted);
    const ints = plays.filter((e) => e.play.kind === "pass" && e.play.turnover === "interception" && e.play.end.possession === "defense" && e.penalty?.kind !== "accept").length;
    expect(box.home.interceptions + box.away.interceptions).toBe(ints);
    expect(box.home.timeouts + box.away.timeouts).toBe(record.events.filter((e) => e.t === "timeout").length + plays.filter((e) => e.runoffTimeout).length);
  });

  it("E5: --format json is the record; re-running the box score from it gives the same box score", () => {
    const again = JSON.parse(JSON.stringify(record)) as GameRecord;
    expect(boxScore(again, data.engine.rules)).toEqual(boxScore(record, data.engine.rules));
    expect(record.seed).toBe(3);
    expect(record.leagueSeed).toBe(2026);
  });

  it("E6: CLAUDE.md Run line has the command and package.json defines it", () => {
    expect(readFileSync(join(REPO, "CLAUDE.md"), "utf8")).toMatch(/pnpm sim:game -- --seed/);
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["sim:game"]).toMatch(/scripts\/game\/sim-game\.ts/);
  });
});
