// Formation-first play calling at the engine's request level (docs/specs/m2-play-calling-and-motion.md,
// Resolved 2, Joseph): "Offense picks a formation card, then a play card from that formation, with
// run and pass plays on one play screen or split by the 7-choice rule. Defense picks its front,
// then its play. ... Outcomes stay byte-identical: only the order the same final call is assembled
// in changes." Written by test-writer from the spec. Every call request of scripted games is walked.

import { describe, expect, it } from "vitest";
import type { DecisionRequest } from "../../packages/shared/src/types";
import { defenseAnswer, offenseAnswer } from "../../packages/sim/src/loop/requests";
import { finalPaths, kit, playSession, scriptedBot, setupFor } from "./support";

const P = kit.data.engine.personnel;
const FORMATIONS = Object.keys(P.offense).sort();
const catalog = kit.data.engine.caller.catalog;
const choicesOf = (id: string): string[] => catalog.screens.find((s) => s.id === id)?.choices.map((c) => c.id) ?? [];
const RUNS = new Set(choicesOf("offense.run"));
const PASSES = new Set(choicesOf("offense.pass"));
const PLAYS = new Set([...RUNS, ...PASSES]);

const requests: DecisionRequest[] = [5, 6, 7, 8].flatMap((seed) => playSession(setupFor(seed), kit, seed % 2 === 0 ? "home" : "away", scriptedBot(seed, { two: 0.3 })).asked.map((a) => a.request));
const ofKind = <K extends DecisionRequest["kind"]>(k: K) => requests.filter((r): r is Extract<DecisionRequest, { kind: K }> => r.kind === k);

describe("offense: formation, then the play", () => {
  it("the scripted games have offense calls and two-point tries to check", () => {
    expect(ofKind("offenseCall").length).toBeGreaterThan(100);
    expect(ofKind("try").some((r) => r.screens[0]?.options.some((o) => o.id === "goForTwo" && o.legal))).toBe(true);
  });

  it("no first screen offers a run or a pass before a formation", () => {
    for (const r of [...ofKind("offenseCall"), ...ofKind("try")]) {
      const first = (r.screens[0]?.options ?? []).map((o) => o.id);
      for (const id of ["run", "pass", ...PLAYS]) expect(first, `${r.kind} ${r.seq}`).not.toContain(id);
    }
  });

  it("every run or pass path is formation, then one of the five formations, then the play from it", () => {
    let n = 0;
    for (const r of [...ofKind("offenseCall"), ...ofKind("try")]) {
      for (const path of finalPaths(r, false)) {
        const leaf = path[path.length - 1] as string;
        if (!PLAYS.has(leaf)) continue;
        const i = path.indexOf("formation");
        expect(i, path.join(" > ")).toBeGreaterThanOrEqual(0);
        // Nothing but "goForTwo" before the formation step on a try.
        expect(path.slice(0, i).every((x) => x === "goForTwo"), path.join(" > ")).toBe(true);
        const f = path[i + 1] as string;
        expect(FORMATIONS).toContain(f);
        // The play comes after the formation; a run or pass step may split them (7-choice rule).
        const rest = path.slice(i + 2);
        expect(rest[rest.length - 1]).toBe(leaf);
        expect(rest.length).toBeLessThanOrEqual(2);
        if (rest.length === 2) expect(rest[0]).toBe(RUNS.has(leaf) ? "run" : "pass");
        n++;
      }
    }
    expect(n).toBeGreaterThan(1000);
  });

  it("the formation screen lists the five formations, and every formation reaches every run and pass", () => {
    for (const r of ofKind("offenseCall").slice(0, 30)) {
      const formationScreen = r.screens.find((s) => s.id === r.screens[0]?.options.find((o) => o.id === "formation")?.opens);
      expect(formationScreen?.options.map((o) => o.id).sort()).toEqual(FORMATIONS);
      const paths = finalPaths(r, false);
      for (const f of FORMATIONS) {
        const leaves = new Set(paths.filter((p) => p[0] === "formation" && p[1] === f).map((p) => p[p.length - 1]));
        expect([...leaves].sort(), f).toEqual([...PLAYS].sort());
      }
    }
  });

  it("each formation-first path builds the call it names", () => {
    for (const f of FORMATIONS) for (const leaf of PLAYS) {
      expect(offenseAnswer(["formation", f, RUNS.has(leaf) ? "run" : "pass", leaf], null)).toEqual({ call: { call: leaf, formation: f } });
    }
  });
});

describe("defense: the front, then the play", () => {
  it("the first screen offers fronts (packages), and each opens only that front's plays", () => {
    const packages = new Set(Object.keys(P.packages));
    let n = 0;
    for (const r of ofKind("defenseCall")) {
      for (const path of finalPaths(r, false)) {
        const preset = path[path.length - 1] as string;
        const pkg = P.presetPackage[preset];
        if (pkg === undefined) continue;
        // The front is picked before the play.
        expect(path.length, path.join(" > ")).toBeGreaterThanOrEqual(2);
        const front = path[path.length - 2] as string;
        // Specials groups goal line and prevent (docs/MENUS.md); any other front is the preset's package.
        if (front !== "specials") expect(front, path.join(" > ")).toBe(pkg);
        expect(packages.has(front) || front === "specials").toBe(true);
        expect(defenseAnswer(path, null)).toEqual({ preset });
        n++;
      }
    }
    expect(n).toBeGreaterThan(500);
  });
});
