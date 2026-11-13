// M1 step 5, D3 and D4: the home field and team strength were tuned on 2016-2023 only, and the
// docs label them designed.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "../../scripts/game/data";

const league = JSON.parse(readFileSync(join(REPO, "data/game/league.json"), "utf8")) as {
  designed: boolean;
  tuning: { status: string; seasons: number[]; homeFieldSeasons: number[] };
};

describe("home field tuning record (D3)", () => {
  it("is tuned, on training seasons only, with 2020 out of the home-field target", () => {
    expect(league.designed).toBe(true);
    expect(league.tuning.status).toBe("tuned");
    for (const s of [...league.tuning.seasons, ...league.tuning.homeFieldSeasons]) expect(s).toBeLessThan(2024);
    expect(league.tuning.homeFieldSeasons).not.toContain(2020);
  });

  it("the tuning script never opens the holdout block", () => {
    const src = readFileSync(join(REPO, "scripts/game/tune.ts"), "utf8");
    expect(src).not.toMatch(/\.holdout\b|\["holdout"\]/);
  });
});

describe("MODEL.md home field (D4)", () => {
  it("has a Home field section marked designed with its seasons", () => {
    const model = readFileSync(join(REPO, "docs/MODEL.md"), "utf8");
    const sec = model.split("\n## ").find((s) => s.startsWith("Home field"));
    expect(sec).toBeDefined();
    expect(sec).toMatch(/\*\*Designed/);
    expect(sec).toMatch(/2016-2023/);
  });
});

