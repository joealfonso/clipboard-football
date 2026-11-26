// M4 milestone A, criterion A9 (docs/specs/m4-franchise-core.md, Locked 1 and 2): the franchise
// layer is outside the calibration import graph and inside the sim's purity rules. The import and
// purity tests (../imports.test.ts, ../purity.test.ts) walk every file under src, franchise/
// included; this file checks the parts that are about franchise/ itself.
//
// Not checked here: "git diff shows no change to any file in it". Other sessions hold uncommitted
// edits to pinned files in this checkout, so a diff against HEAD cannot tell whose change it is.
// The engineer compared each pinned file's hash before and after the franchise work instead.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { codeFiles } from "../../../../scripts/game/calibrate";
import { REPO } from "../../../../scripts/game/data";

/** codeFiles() as it was before any franchise file existed (2026-11-23, 53 files). */
const CALIBRATION_GRAPH = [
  "packages/shared/src/caller.ts",
  "packages/shared/src/catalog.ts",
  "packages/shared/src/engine-schema.ts",
  "packages/shared/src/engine.ts",
  "packages/shared/src/game-schema.ts",
  "packages/shared/src/game.ts",
  "packages/shared/src/play.ts",
  "packages/shared/src/rules-schema.ts",
  "packages/shared/src/rules.ts",
  "packages/shared/src/schema.ts",
  "packages/shared/src/situation.ts",
  "packages/shared/src/types.ts",
  "packages/sim/src/caller/availability.ts",
  "packages/sim/src/caller/bins.ts",
  "packages/sim/src/caller/defense.ts",
  "packages/sim/src/caller/lookup.ts",
  "packages/sim/src/caller/offense.ts",
  "packages/sim/src/caller/range.ts",
  "packages/sim/src/caller/sample.ts",
  "packages/sim/src/engine/closecalls.ts",
  "packages/sim/src/engine/effects.ts",
  "packages/sim/src/engine/errors.ts",
  "packages/sim/src/engine/participants.ts",
  "packages/sim/src/engine/players.ts",
  "packages/sim/src/engine/resolve.ts",
  "packages/sim/src/engine/standouts.ts",
  "packages/sim/src/engine/tables.ts",
  "packages/sim/src/engine/why.ts",
  "packages/sim/src/game/draft.ts",
  "packages/sim/src/game/enforce.ts",
  "packages/sim/src/game/errors.ts",
  "packages/sim/src/game/frame.ts",
  "packages/sim/src/game/invariants.ts",
  "packages/sim/src/game/machine.ts",
  "packages/sim/src/game/periods.ts",
  "packages/sim/src/game/progress.ts",
  "packages/sim/src/game/resolve.ts",
  "packages/sim/src/game/situation.ts",
  "packages/sim/src/game/types.ts",
  "packages/sim/src/loop/box.ts",
  "packages/sim/src/loop/coach.ts",
  "packages/sim/src/loop/league.ts",
  "packages/sim/src/loop/play.ts",
  "packages/sim/src/loop/requests.ts",
  "packages/sim/src/loop/views.ts",
  "packages/sim/src/rng.ts",
  "packages/sim/src/splitmix64.ts",
  "scripts/game/calibrate.ts",
  "scripts/game/checks5c-rules.ts",
  "scripts/game/checks5d-rules.ts",
  "scripts/game/data.ts",
  "scripts/game/metrics.ts",
  "scripts/game/report.ts",
];

const franchiseDir = join(REPO, "packages/sim/src/franchise");
const franchiseFiles = readdirSync(franchiseDir).filter((f) => f.endsWith(".ts"));

describe("A9: the calibration import graph and the sim's purity", () => {
  it("codeFiles() returns the same list as before the franchise layer", () => {
    expect(codeFiles()).toEqual(CALIBRATION_GRAPH);
  });

  it("no franchise file, and neither package index, is in the calibration graph", () => {
    const graph = codeFiles();
    expect(graph.filter((f) => /franchise/.test(f))).toEqual([]);
    expect(graph).not.toContain("packages/sim/src/index.ts");
    expect(graph).not.toContain("packages/shared/src/index.ts");
  });

  it("franchise types are not re-exported through shared types.ts, and GameData has no franchise field", () => {
    expect(readFileSync(join(REPO, "packages/shared/src/types.ts"), "utf8")).not.toMatch(/franchise/i);
    expect(readFileSync(join(REPO, "packages/shared/src/game.ts"), "utf8")).not.toMatch(/franchise/i);
  });

  it("the franchise layer has the files milestones A and B name", () => {
    expect(franchiseFiles).toEqual(expect.arrayContaining(["league.ts", "pool.ts", "overall.ts", "summary.ts", "errors.ts", "index.ts", "draft.ts", "draft-ai.ts", "numbers.ts"]));
  });

  it("no franchise source mentions zod, a Node API, the DOM, a clock or Math.random, and none throws", () => {
    for (const f of franchiseFiles) {
      const text = readFileSync(join(franchiseDir, f), "utf8");
      expect(text, f).not.toMatch(/\bzod\b/);
      expect(text, f).not.toMatch(/from "node:|\brequire\(|\bprocess\.|\bwindow\b|\bdocument\b|\bDate\b|\bperformance\b|Math\s*\.\s*random|Math\[/);
      expect(text, f).not.toMatch(/\bthrow\s+(new\b|[a-zA-Z_(])/);
    }
  });

  it("every franchise import is relative and reaches shared only through its type-only files", () => {
    for (const f of franchiseFiles) {
      const specs = [...readFileSync(join(franchiseDir, f), "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1] as string);
      for (const spec of specs) {
        expect(spec.startsWith("."), `${f} imports ${spec}`).toBe(true);
        if (spec.includes("shared/src/")) expect(spec, f).toMatch(/shared\/src\/(engine|franchise|rules)$/);
      }
    }
  });

  it("lint passes on every franchise source (the Math.random ban covers packages/sim)", async () => {
    const eslint = new ESLint({ cwd: REPO });
    const results = await eslint.lintFiles(["packages/sim/src/franchise"]);
    expect(results.length).toBe(franchiseFiles.length);
    expect(results.flatMap((r) => r.messages.map((m) => `${r.filePath}: ${m.message}`))).toEqual([]);
  }, 30_000);
});
