// C8: the engine sits under the sim's purity rules; no caller module imports it; resolvePlay is
// the only exported function that takes both calls. C9: speed.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { generateTeam } from "../../src/engine/players";
import { createEngine } from "../../src/engine/resolve";
import type { GameState } from "../../src/game/types";
import { Rng } from "../../src/rng";
import { loadCallerData } from "../caller/load-data";
import { callsFor, type Calls } from "../support/engine-calls";
import { loadEngineData } from "../support/engine-data";
import { randomGame } from "../support/random-game";
import { loadRules } from "../support/rules";

const simSrc = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");

describe("engine purity (C8)", () => {
  it("no caller module imports the engine", () => {
    for (const f of readdirSync(join(simSrc, "caller"))) {
      const imports = ts.preProcessFile(readFileSync(join(simSrc, "caller", f), "utf8"), true, true).importedFiles.map((x) => x.fileName);
      expect(imports.filter((x) => x.includes("engine")), f).toEqual([]);
    }
  });

  it("resolvePlay is the only exported function that takes both calls", () => {
    const configPath = join(simSrc, "../tsconfig.json");
    const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, (p) => ts.sys.readFile(p)).config, ts.sys, join(simSrc, ".."));
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const checker = program.getTypeChecker();
    const index = program.getSourceFile(join(simSrc, "index.ts"));
    if (index === undefined) throw new Error("no index");
    const moduleSymbol = checker.getSymbolAtLocation(index);
    if (moduleSymbol === undefined) throw new Error("no module symbol");
    const takesBoth: string[] = [];
    const visit = (name: string, type: ts.Type, depth: number): void => {
      for (const sig of type.getCallSignatures()) {
        const params = sig.getParameters().map((p) => checker.typeToString(checker.getTypeOfSymbol(p)));
        if (params.some((t) => t.includes("OffenseCall")) && params.length >= 3) takesBoth.push(name);
        if (depth === 0) visit(`${name}()`, sig.getReturnType(), 1);
      }
    };
    for (const sym of checker.getExportsOfModule(moduleSymbol)) {
      const decl = sym.valueDeclaration ?? sym.declarations?.[0];
      if (decl === undefined) continue;
      visit(sym.getName(), checker.getTypeOfSymbolAtLocation(sym, decl), 0);
    }
    expect(takesBoth).toEqual(["createEngine()"]);
  });
});

describe("speed (C9)", () => {
  it("mean resolvePlay time over 160,000 plays is within budget (100 us per play, 3x allowance in CI)", () => {
    const data = loadEngineData();
    const { rules, hash } = loadRules();
    const caller = loadCallerData();
    const engine = createEngine(data);
    const r = Rng.fromSeed(1);
    const players = { home: generateTeam(r, data, "H"), away: generateTeam(r, data, "A") };
    const states: GameState[] = [];
    const calls: Calls[] = [];
    for (let g = 0; states.length < 160_000; g++) {
      for (const s of randomGame(rules, { gameType: "regularSeason", seed: 4000 + g, rulesHash: hash }, 5000 + g).states) {
        if (s.phase !== "scrimmage" && s.phase !== "try" && s.phase !== "kickoff") continue;
        states.push(s);
        calls.push(callsFor(s, rules, caller, r, false));
        if (states.length === 160_000) break;
      }
    }
    const rng = Rng.fromSeed(2);
    for (let i = 0; i < 5000; i++) engine(states[i] as GameState, (calls[i] as Calls).offense, (calls[i] as Calls).defense, players, rng);
    const t0 = performance.now();
    for (let i = 0; i < states.length; i++) engine(states[i] as GameState, (calls[i] as Calls).offense, (calls[i] as Calls).defense, players, rng);
    const us = ((performance.now() - t0) * 1000) / states.length;
    console.log(`resolvePlay: ${us.toFixed(1)} us per play over ${states.length} plays`);
    const budget = process.env["CI"] === undefined ? 100 : 300;
    expect(us).toBeLessThanOrEqual(budget);
  }, 300_000);
});
