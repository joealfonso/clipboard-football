// B4 (TypeScript side): a cell under the minimum is absent from the fitted tables, so the
// lookup lands on its parent; a stored cell is used. Plus the defense call on kicks is ignored
// and recorded as ignored.

import { describe, expect, it } from "vitest";
import type { Level } from "../../../shared/src/types";
import { EngineError } from "../../src/engine/errors";
import { createEngine } from "../../src/engine/resolve";
import { backoff } from "../../src/engine/tables";
import { Rng } from "../../src/rng";
import { loadEngineData } from "../support/engine-data";
import { flatTeam, scrimmageState } from "../support/engine-fixtures";

const levels: Level[] = [{ dims: ["leaf", "down"] }, { dims: ["leaf"] }, { dims: [] }];
const cells = [{ "insideRun|1": [1] }, { insideRun: [2], deepPass: [3] }, { "": [4] }];

describe("backoff lookup (B4)", () => {
  it("uses the finest stored cell and falls back to the parent when a cell is absent", () => {
    expect(backoff(levels, cells, { down: "1" }, { leaf: "insideRun" }, "t")).toEqual({ level: 0, key: "insideRun|1", value: [1] });
    expect(backoff(levels, cells, { down: "2" }, { leaf: "insideRun" }, "t")).toEqual({ level: 1, key: "insideRun", value: [2] });
    expect(backoff(levels, cells, { down: "2" }, { leaf: "screenPass" }, "t")).toEqual({ level: 2, key: "", value: [4] });
  });

  it("throws a typed error when no level has a cell", () => {
    expect(() => backoff(levels.slice(0, 2), cells.slice(0, 2), { down: "2" }, { leaf: "qbSneak" }, "t")).toThrow(EngineError);
  });
});

describe("defense call on kicks", () => {
  it("is ignored and recorded as ignored", () => {
    const data = loadEngineData();
    const resolve = createEngine(data);
    const team = flatTeam(data, "F", 65);
    const s = scrimmageState(30, 4, 10);
    const a = resolve(s, { call: "punt" }, "goalLine", { home: team, away: team }, Rng.fromSeed(4));
    const b = resolve(s, { call: "punt" }, null, { home: team, away: team }, Rng.fromSeed(4));
    expect((a.detail as { defenseCallIgnored?: string }).defenseCallIgnored).toBe("goalLine");
    expect({ ...a, detail: undefined }).toEqual({ ...b, detail: undefined });
  });
});
