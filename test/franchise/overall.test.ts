// M4 milestone A, criterion A7 (docs/specs/m4-franchise-core.md): the sim's `overall` equals the
// app's `overallRating` for every player of a generated pool, from one weights file. It lives at
// the root because it reads both packages.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { overallRating } from "../../packages/app/src/ui/ratings";
import { PLAYER_SCHEMA_VERSION } from "../../packages/shared/src/engine";
import { generatePool, overall, overalls } from "../../packages/sim/src/franchise/index";
import { loadFranchiseData, OVERALL_WEIGHTS_FILE, readJson } from "../../packages/sim/test/franchise/support";
import { REPO } from "../../scripts/game/data";

const data = loadFranchiseData();
const appWeights = (readJson("data/ui/templates.json") as { overallWeights: Record<string, Record<string, number>> }).overallWeights;

describe("A7: one overall", () => {
  it("the sim and the app agree on every player of generated pools", () => {
    let checked = 0;
    for (const seed of [1, 2, 3, 2026, 99991]) {
      const pool = generatePool(data, seed);
      const cached = overalls(pool, data.overallWeights);
      for (const p of pool) {
        const app = overallRating({ ...p, schemaVersion: PLAYER_SCHEMA_VERSION, number: 0 }, appWeights);
        expect(overall(p, data.overallWeights), `${seed} ${p.id}`).toBe(app);
        expect(cached.get(p.id)).toBe(app);
        checked++;
      }
    }
    expect(checked).toBe(5 * 1871);
  });

  it("the weights have one home: the sim's are the app's file, and data/franchise holds none", () => {
    expect(OVERALL_WEIGHTS_FILE).toBe("data/ui/templates.json");
    expect(data.overallWeights).toEqual(appWeights);
    for (const f of readdirSync(join(REPO, "data/franchise"))) expect(readFileSync(join(REPO, "data/franchise", f), "utf8"), f).not.toMatch(/"overallWeights"/);
  });

  it("a rating the weights do not name does not move the overall, one they name does", () => {
    const [qb] = generatePool(data, 1);
    if (qb === undefined) throw new Error("empty pool");
    expect(qb.position).toBe("QB");
    expect(overall({ ...qb, ratings: { ...qb.ratings, speed: qb.ratings.speed === 0 ? 99 : 0 } }, data.overallWeights)).toBe(overall(qb, data.overallWeights));
    expect(overall({ ...qb, skills: { ...qb.skills, accuracy: 99 } }, data.overallWeights)).toBeGreaterThanOrEqual(overall({ ...qb, skills: { ...qb.skills, accuracy: 0 } }, data.overallWeights) + 30);
  });
});
