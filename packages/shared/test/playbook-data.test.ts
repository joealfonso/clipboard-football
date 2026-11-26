// M3 milestone A (docs/specs/m3-playbook-and-custom-routes.md): the playbook data files parse,
// every design is legal and inside its engine call, the catalog matches the spec's tables, and
// docs/PLAYBOOK.md lists it. Tests are named by criterion, A1 to A10. A11 is a reviewer check.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEPTH_BUCKETS, PRESSURES, SITUATION_TAGS, TIMINGS, defenseAlignment, positionOf, resolveDefense, resolveOffense, slotsOf, tagApplies } from "../src/playbook";
import type { SituationTag } from "../src/playbook";
import { parsePlaybook } from "../src/playbook-schema";
import type { Situation } from "../src/situation";
import { callLabels, designLine, groupHeading, loadPlaybook, playbookRefs, rawPlaybook, readJson, repoRoot } from "./playbook-load";
import type { RawPlaybook } from "./playbook-load";

const refs = playbookRefs();
const pb = loadPlaybook();

/** Parses a copy of the real files after `change` broke something. */
function broken(change: (raw: RawPlaybook) => void): () => unknown {
  const raw = rawPlaybook();
  change(raw);
  return () => parsePlaybook(raw, refs);
}
const off = (raw: RawPlaybook, id: string) => raw.offense.designs.find((d) => d.id === id) as RawPlaybook["offense"]["designs"][number];
const def = (raw: RawPlaybook, id: string) => raw.defense.designs.find((d) => d.id === id) as RawPlaybook["defense"]["designs"][number];

describe("A1: the playbook files parse and bad files are rejected", () => {
  it("parses the real files", () => {
    expect(pb.offense.designs.length + pb.defense.designs.length).toBeGreaterThan(0);
  });

  const bad: [string, (raw: RawPlaybook) => void, RegExp][] = [
    ["an unknown slot", (r) => void (off(r, "shotgun.shortPass.mesh").assignments["WR9"] = "route.go"), /unknown slot WR9/],
    ["an unknown slot on defense", (r) => void (def(r, "baseCover3.sky").assignments["CB3"] = "man.R2"), /unknown slot CB3/],
    ["an unknown library id", (r) => void (off(r, "shotgun.shortPass.mesh").assignments["WR2"] = "route.zigzag"), /unknown library id route\.zigzag/],
    ["an unknown concept", (r) => void (off(r, "shotgun.shortPass.mesh")["concept"] = "trickPass"), /unknown concept trickPass/],
    ["an unknown formation", (r) => void (off(r, "shotgun.shortPass.mesh")["formation"] = "wishbone"), /unknown formation wishbone/],
    ["an unknown preset", (r) => void (def(r, "baseCover3.sky")["coverage"] = "baseCover9"), /unknown preset baseCover9/],
    ["a missing assignment", (r) => void delete off(r, "shotgun.shortPass.mesh").assignments["WR1"], /no assignment for WR1/],
    ["a missing assignment on defense", (r) => void delete def(r, "baseCover3.sky").assignments["S2"], /no assignment for S2/],
    ["a duplicate id", (r) => void (off(r, "shotgun.shortPass.mesh").id = "shotgun.shortPass.stick"), /duplicate design id shotgun\.shortPass\.stick/],
    ["a design id shared across the two files", (r) => void (def(r, "baseCover3.sky").id = "shotgun.shortPass.stick"), /duplicate design id/],
    ["an unknown key on a design", (r) => void (off(r, "shotgun.shortPass.mesh")["audible"] = true), /audible/],
    ["a tag outside the closed list", (r) => void ((off(r, "shotgun.shortPass.mesh")["tags"] as Record<string, unknown>)["timing"] = "glacial"), /timing/],
    ["a trait from the other side of the ball", (r) => void (off(r, "shotgun.shortPass.mesh")["traits"] = ["singleHigh"]), /trait singleHigh/],
    ["a side-axis entry with no side", (r) => void (off(r, "shotgun.shortPass.mesh").assignments["RB1"] = "back.swing"), /needs a side/],
    ["a zone with no landmark", (r) => void (def(r, "baseCover3.sky").assignments["S1"] = "zone.deep.middle"), /needs a landmark/],
    ["a library entry of an unknown kind", (r) => void (r.library.assignments["route.slant"] = { kind: "motion", label: "Jet" }), /kind/],
    ["a closed list missing a member", (r) => void (r.config["families"] = ["flat", "swing"]), /must list each/],
  ];
  it.each(bad)("rejects %s", (_name, change, message) => {
    expect(broken(change)).toThrow(message);
  });
});

describe("A2: every design maps to one engine call, and every engine call has one default", () => {
  const leaves = readJson<{ screens: { id: string; choices: { id: string }[] }[] }>("data/calls/catalog.json")
    .screens.filter((s) => s.id === "offense.run" || s.id === "offense.pass")
    .flatMap((s) => s.choices.map((c) => c.id));

  it("the concepts are the eight run and pass leaves of the call catalog", () => {
    expect(Object.keys(pb.config.concepts).sort()).toEqual([...leaves].sort());
  });

  it("each of the 40 offense pairs and 13 presets has a design and exactly one default", () => {
    const formations = Object.keys(refs.personnel.offense);
    const presets = Object.keys(refs.personnel.presetPackage);
    expect([formations.length * leaves.length, presets.length]).toEqual([40, 13]);
    for (const f of formations) {
      for (const c of leaves) {
        const group = pb.offense.designs.filter((d) => d.formation === f && d.concept === c);
        expect([`${f}.${c}`, group.length >= 1, group.filter((d) => d.default).length]).toEqual([`${f}.${c}`, true, 1]);
      }
    }
    for (const p of presets) {
      const group = pb.defense.designs.filter((d) => d.coverage === p);
      expect([p, group.length >= 1, group.filter((d) => d.default).length]).toEqual([p, true, 1]);
    }
  });

  it("no design sits outside personnel.json", () => {
    for (const d of pb.offense.designs) expect(refs.personnel.offense[d.formation], d.id).toBeDefined();
    for (const d of pb.defense.designs) expect(refs.personnel.presetPackage[d.coverage], d.id).toBe(d.package);
  });

  it.each([
    ["an engine call with no default", (r: RawPlaybook) => void (off(r, "shotgun.shortPass.slantFlat")["default"] = false), /shotgun\.shortPass has 0 default designs/],
    ["an engine call with two defaults", (r: RawPlaybook) => void (off(r, "shotgun.shortPass.mesh")["default"] = true), /shotgun\.shortPass has 2 default designs/],
    ["a preset with two defaults", (r: RawPlaybook) => void (def(r, "prevent.spy")["default"] = true), /prevent has 2 default designs/],
    ["an empty engine call", (r: RawPlaybook) => void (r.offense.designs = r.offense.designs.filter((d) => d["concept"] !== "qbSneak" || d["formation"] !== "empty")), /empty\.qbSneak has no design/],
    ["an empty preset", (r: RawPlaybook) => void (r.defense.designs = r.defense.designs.filter((d) => d["coverage"] !== "prevent")), /prevent has no design/],
    ["a preset in the wrong package", (r: RawPlaybook) => void (def(r, "nickel2Man.twoMan")["package"] = "dime"), /is in package nickel, not dime/],
  ])("rejects %s", (_name, change, message) => {
    expect(broken(change)).toThrow(message);
  });
});

describe("A3: after defaults every on-field slot has exactly one assignment and no other slot has one", () => {
  it("offense designs fill their formation's slots", () => {
    for (const d of pb.offense.designs) {
      const slots = slotsOf(refs.personnel.offense[d.formation] ?? {});
      const issues: string[] = [];
      expect(resolveOffense(d, pb, slots, issues).map((r) => r.slot), d.id).toEqual(slots);
      expect(issues, d.id).toEqual([]);
      expect(Object.keys(pb.alignments.offense[d.formation] ?? {}).sort(), d.id).toEqual([...slots].sort());
    }
  });

  it("defense designs fill their package's slots", () => {
    for (const d of pb.defense.designs) {
      const slots = slotsOf(refs.personnel.packages[d.package] ?? {});
      const issues: string[] = [];
      expect(resolveDefense(d, pb, slots, issues).map((r) => r.slot), d.id).toEqual(slots);
      expect(issues, d.id).toEqual([]);
      expect(Object.keys(defenseAlignment(d, pb.alignments)).sort(), d.id).toEqual([...slots].sort());
    }
  });

  it("a lineman the design does not list takes the default, and a listed one keeps his own", () => {
    const power = pb.offense.designs.find((d) => d.id === "shotgun.insideRun.power");
    const res = resolveOffense(power as NonNullable<typeof power>, pb, slotsOf(refs.personnel.offense["shotgun"] ?? {}));
    expect(res.filter((r) => r.position === "OL").map((r) => r.use)).toEqual(["block.base", "block.down", "block.down", "block.pull", "block.down"]);
    const slant = pb.offense.designs.find((d) => d.id === "shotgun.shortPass.slantFlat");
    const pass = resolveOffense(slant as NonNullable<typeof slant>, pb, slotsOf(refs.personnel.offense["shotgun"] ?? {}));
    expect(pass.filter((r) => r.position === "OL").map((r) => r.use)).toEqual(["block.passEdge", "block.pass", "block.pass", "block.pass", "block.passEdge"]);
  });
});

describe("A4: offense legality", () => {
  it.each([
    ["a lineman running a route", (r: RawPlaybook) => void (off(r, "shotgun.shortPass.slantFlat").assignments["OL3"] = "route.slant"), /lineman OL3 must block/],
    ["a run with two ball carriers", (r: RawPlaybook) => void (off(r, "shotgun.insideRun.insideZone").assignments["QB1"] = { use: "run.insideZone", to: "right" }), /exactly one ball carrier, found 2/],
    ["a run with no ball carrier", (r: RawPlaybook) => void (off(r, "shotgun.insideRun.insideZone").assignments["RB1"] = "block.push"), /exactly one ball carrier, found 0/],
    [
      "a wide receiver carrying the ball",
      (r: RawPlaybook) => {
        const d = off(r, "shotgun.insideRun.insideZone");
        d["carrier"] = "WR1";
        d.assignments["WR1"] = { use: "run.insideZone", to: "right" };
        d.assignments["RB1"] = "block.push";
      },
      /must be a running back or the quarterback/,
    ],
    ["an inside run through the edge gap", (r: RawPlaybook) => void (off(r, "shotgun.insideRun.insideZone").assignments["RB1"] = { use: "run.stretch", to: "right" }), /gap edge is outside the concept's gaps/],
    ["a run whose side disagrees with its ball carrier", (r: RawPlaybook) => void (off(r, "shotgun.insideRun.insideZone")["side"] = "strong"), /does not match the ball carrier's side/],
    ["a run with a route", (r: RawPlaybook) => void (off(r, "shotgun.insideRun.insideZone").assignments["WR1"] = "route.go"), /a run design has a route/],
    [
      "a pass with no route",
      (r: RawPlaybook) => {
        const d = off(r, "heavy.deepPass.post");
        d.assignments["TE1"] = "block.protectEdge";
        d.assignments["TE3"] = "block.protectEdge";
      },
      /a pass needs at least one route/,
    ],
    ["a pass with no quarterback action", (r: RawPlaybook) => void (off(r, "shotgun.shortPass.slantFlat").assignments["QB1"] = "qb.handoffDive"), /a pass needs a quarterback drop or rollout/],
    ["a pass with no primary route", (r: RawPlaybook) => void (off(r, "shotgun.shortPass.slantFlat").assignments["WR1"] = "route.slant"), /exactly one primary route, found 0/],
    ["a screen with no route behind the line", (r: RawPlaybook) => void (off(r, "shotgun.screenPass.backScreen").assignments["RB1"] = { use: "back.flat", to: "left", primary: true }), /a screen's primary route must be a screen behind the line/],
    ["play action with no fake", (r: RawPlaybook) => void (off(r, "shotgun.playAction.paPost").assignments["QB1"] = "qb.quick"), /play action needs a fake/],
    ["a run block on a pass", (r: RawPlaybook) => void (off(r, "shotgun.shortPass.slantFlat").assignments["TE1"] = "block.tePush"), /run block on a pass design/],
  ])("rejects %s", (_name, change, message) => {
    expect(broken(change)).toThrow(message);
  });

  it("every shipped screen has a primary route that the library declares behind the line, and every play action a fake", () => {
    for (const d of pb.offense.designs) {
      const res = resolveOffense(d, pb, slotsOf(refs.personnel.offense[d.formation] ?? {}));
      const qb = res.find((r) => r.position === "QB");
      if (d.concept === "screenPass") expect(res.find((r) => r.ref.primary === true)?.entry, d.id).toMatchObject({ kind: "route", family: "screen" });
      if (d.concept === "playAction") expect(qb?.entry, d.id).toMatchObject({ kind: "qb", fake: true });
      for (const r of res) if (r.position === "OL") expect(r.entry.kind, `${d.id} ${r.slot}`).toBe("block");
    }
  });
});

describe("A5: defense legality, inside the preset's definition", () => {
  it.each([
    ["a fifth rusher behind a four-rush preset", (r: RawPlaybook) => void (def(r, "baseCover3.sky").assignments["LB2"] = "blitz.inside"), /5 rushers is outside the preset's rush \(le4\)/],
    ["a blitz preset with four rushers", (r: RawPlaybook) => void (def(r, "nickelCover1Blitz.middleBlitz").assignments["LB2"] = "spy.qb"), /4 rushers is outside the preset's rush \(ge5\)/],
    ["two deep in a three-deep shell", (r: RawPlaybook) => void (def(r, "baseCover3.sky").assignments["CB1"] = { use: "zone.under.left", at: [-20, 4.5] }), /2 deep defenders is outside the preset's shell \(cover3\)/],
    ["a third deep defender in Cover 2", (r: RawPlaybook) => void (def(r, "baseCover2.middleDeep").assignments["LB2"] = { use: "zone.deep.middle", at: [0, 16] }), /3 deep defenders is outside the preset's shell \(cover2\)/],
    ["man coverage in a zone preset", (r: RawPlaybook) => void (def(r, "baseCover2.cover2").assignments["LB2"] = "man.B"), /man coverage in a zone preset/],
    ["a man design that leaves the back uncovered", (r: RawPlaybook) => void (def(r, "nickelCover1.robber").assignments["LB2"] = "spy.qb"), /nobody covers B against shotgun/],
    ["a light box behind a heavy-box preset", (r: RawPlaybook) => void (def(r, "runStuff.eightInTheBox")["alignment"] = { S2: [9, 12] }), /7 in the box, the preset needs 8/],
    ["a zone landmark in the wrong third", (r: RawPlaybook) => void (def(r, "baseCover3.sky").assignments["S2"] = { use: "zone.under.right", at: [0, 6] }), /landmark is not in the right third/],
    ["a zone landmark at the wrong level", (r: RawPlaybook) => void (def(r, "baseCover3.sky").assignments["S1"] = { use: "zone.deep.middle", at: [0, 8] }), /landmark depth does not match deep/],
    ["a stunt with no partner", (r: RawPlaybook) => void (def(r, "baseCover3.twist").assignments["DL3"] = "rush.inside"), /stunt at DL2 needs a lineman partner/],
  ])("rejects %s", (_name, change, message) => {
    expect(broken(change)).toThrow(message);
  });

  it("every man design covers every receiver spot of every formation", () => {
    const man = pb.defense.designs.filter((d) => d.traits.includes("man"));
    expect(man.length).toBeGreaterThan(10);
    // parsePlaybook already ran this check on the real files: an uncovered spot would have thrown.
    for (const d of man) expect(refs.presets[d.coverage]?.manZone, d.id).not.toBe("zone");
  });
});

describe("A6: no group has more than 6 designs", () => {
  const sizes = (key: (d: { formation?: string; concept?: string; coverage?: string }) => string, designs: readonly object[]) => {
    const m = new Map<string, number>();
    for (const d of designs) m.set(key(d), (m.get(key(d)) ?? 0) + 1);
    return [...m.values()];
  };
  it("holds for the shipped catalog", () => {
    expect(Math.max(...sizes((d) => `${d.formation}.${d.concept}`, pb.offense.designs))).toBeLessThanOrEqual(6);
    expect(Math.max(...sizes((d) => String(d.coverage), pb.defense.designs))).toBeLessThanOrEqual(6);
  });

  const grow = (extra: number) => (r: RawPlaybook) => {
    const base = off(r, "shotgun.shortPass.mesh");
    for (let i = 0; i < extra; i++) r.offense.designs.push({ ...base, id: `shotgun.shortPass.extra${i}`, label: `Extra ${i}` });
  };
  it("accepts a group of 6 and rejects a group of 7", () => {
    expect(broken(grow(1))).not.toThrow();
    expect(broken(grow(2))).toThrow(/shotgun\.shortPass has 7 designs, more than 6/);
  });

  it("rejects a 7-design preset group", () => {
    expect(
      broken((r) => {
        const base = def(r, "prevent.spy");
        for (let i = 0; i < 5; i++) r.defense.designs.push({ ...base, id: `prevent.extra${i}`, label: `Extra ${i}` });
      }),
    ).toThrow(/prevent has 7 designs, more than 6/);
  });
});

// The spec's catalog tables, copied by hand. A change to the list is a docs/DECISIONS.md entry.
const OFFENSE_CATALOG: Record<string, Record<string, string[]>> = {
  insideRun: { shotgun: ["Inside Zone", "Draw", "Power"], underCenter: ["Inside Zone", "Power", "Lead", "Trap"], pistol: ["Inside Zone", "Dive", "Power"], empty: ["QB Draw", "QB Power"], heavy: ["Dive", "Power", "Lead"] },
  outsideRun: { shotgun: ["Outside Zone", "Sweep", "Counter"], underCenter: ["Outside Zone", "Toss", "Counter"], pistol: ["Outside Zone", "Toss", "Sweep"], empty: ["QB Sweep"], heavy: ["Toss", "Off Tackle"] },
  qbSneak: { shotgun: ["Sneak"], underCenter: ["Sneak", "Wedge"], pistol: ["Sneak"], empty: ["Sneak"], heavy: ["Sneak", "Wedge"] },
  shortPass: { shotgun: ["Slant Flat", "Stick", "Curl Flat", "Mesh", "Quick Outs"], underCenter: ["Slant Flat", "Curl Flat", "Hitches"], pistol: ["Stick", "Slant Flat", "Quick Outs"], empty: ["Mesh", "Stick", "Spacing", "Hitches"], heavy: ["Stick", "Slant Flat"] },
  intermediatePass: { shotgun: ["Smash", "Flood", "Drive", "Levels", "Dagger"], underCenter: ["Flood", "Dig", "Curls"], pistol: ["Smash", "Drive", "Deep Cross"], empty: ["Levels", "Smash", "Dagger"], heavy: ["Corner Flat", "Deep Cross"] },
  deepPass: { shotgun: ["Four Verticals", "Post Wheel", "Post Dig", "Fades"], underCenter: ["Post Dig", "Post Corner", "Fades"], pistol: ["Four Verticals", "Post Wheel", "Double Post"], empty: ["Four Verticals", "Double Post", "Fades"], heavy: ["Seams", "Post"] },
  screenPass: { shotgun: ["Back Screen", "Bubble Screen", "Tunnel Screen"], underCenter: ["Back Screen", "Tight End Screen"], pistol: ["Back Screen", "Bubble Screen"], empty: ["Bubble Screen", "Tunnel Screen"], heavy: ["Back Screen", "Tight End Screen"] },
  playAction: { shotgun: ["PA Crossers", "PA Post", "PA Flood"], underCenter: ["Bootleg", "PA Post", "PA Crossers", "PA Flood"], pistol: ["Bootleg", "PA Post", "PA Dig"], empty: ["PA Seam"], heavy: ["Bootleg", "PA Seam", "PA Post"] },
};
const OFFENSE_TOTALS: Record<string, number> = { insideRun: 15, outsideRun: 12, qbSneak: 7, shortPass: 17, intermediatePass: 16, deepPass: 15, screenPass: 11, playAction: 14 };
const DEFENSE_CATALOG: Record<string, string[]> = {
  baseCover3: ["Cover 3 Sky", "Cover 3 Buzz", "Cover 3 Twist"],
  baseCover2: ["Cover 2", "Cover 2 Middle Deep", "Cover 2 Exchange"],
  runStuff: ["Eight in the Box", "Strong Run Blitz", "Pinch"],
  nickelCover3: ["Cover 3 Sky", "Cover 3 Buzz", "Cover 3 Twist", "Cover 3 Exchange"],
  nickelCover4: ["Quarters", "Quarter Quarter Half", "Quarters Twist"],
  nickelCover2: ["Cover 2", "Cover 2 Middle Deep", "Cover 2 Trap"],
  nickel2Man: ["2-Man", "2-Man Bracket", "2-Man Spy"],
  nickelCover1: ["Cover 1 Robber", "Cover 1 Spy", "Cover 1 Press", "Cover 1 Twist"],
  nickelCover1Blitz: ["Middle Blitz", "Slot Blitz", "Double A Gap", "Safety Blitz"],
  dimeCover4: ["Quarters", "Drop Eight", "Quarters Twist"],
  dimeCover0Blitz: ["All Out", "Corner Blitz", "Overload"],
  goalLine: ["Goal Line", "Goal Line Pinch"],
  prevent: ["Prevent", "Prevent Spy"],
};

describe("A7: the catalog matches the spec's tables", () => {
  it("has 107 offense and 40 defense designs", () => {
    expect([pb.offense.designs.length, pb.defense.designs.length]).toEqual([107, 40]);
  });

  it("has the same names per (formation, concept) group, in the spec's order, and the row totals", () => {
    for (const [concept, byFormation] of Object.entries(OFFENSE_CATALOG)) {
      for (const [formation, names] of Object.entries(byFormation)) {
        expect(pb.offense.designs.filter((d) => d.formation === formation && d.concept === concept).map((d) => d.label), `${formation}.${concept}`).toEqual(names);
      }
      expect(pb.offense.designs.filter((d) => d.concept === concept).length, concept).toBe(OFFENSE_TOTALS[concept]);
    }
  });

  it("has the same names per preset, in the spec's order", () => {
    expect(Object.keys(DEFENSE_CATALOG).sort()).toEqual(Object.keys(refs.personnel.presetPackage).sort());
    for (const [preset, names] of Object.entries(DEFENSE_CATALOG)) {
      expect(pb.defense.designs.filter((d) => d.coverage === preset).map((d) => d.label), preset).toEqual(names);
    }
  });

  it("rejects two designs with one label in a group", () => {
    expect(broken((r) => void (off(r, "shotgun.shortPass.mesh")["label"] = "Stick"))).toThrow(/shotgun\.shortPass has two designs with the same label/);
  });

  it("no two designs in a group have the same assignments (a design is more than its name)", () => {
    const seen = new Map<string, string>();
    const note = (group: string, id: string, signature: unknown) => {
      const key = `${group}|${JSON.stringify(signature)}`;
      expect(seen.get(key), `${id} repeats ${seen.get(key)}`).toBeUndefined();
      seen.set(key, id);
    };
    for (const d of pb.offense.designs) {
      const res = resolveOffense(d, pb, slotsOf(refs.personnel.offense[d.formation] ?? {}));
      note(`${d.formation}.${d.concept}`, d.id, res.map((r) => [r.slot, r.use, r.to, r.ref.depth]));
    }
    for (const d of pb.defense.designs) {
      const res = resolveDefense(d, pb, slotsOf(refs.personnel.packages[d.package] ?? {}));
      note(d.coverage, d.id, [res.map((r) => [r.slot, r.use, r.ref.at, r.ref.with]), d.alignment ?? null]);
    }
  });
});

const situation = (over: Partial<Situation>): Situation => ({ phase: "scrimmage", down: 1, yardsToGo: 10, yardLine100: 60, scoreDiff: 0, quarter: 2, secondsLeftInHalf: 900, secondsLeftInGame: 2700, offenseTimeouts: 3, defenseTimeouts: 3, clockRunning: 0, otBothPossessed: 0, ...over });

describe("A8: every design has every tag, and tagApplies holds on each bin edge", () => {
  it("every design carries each tag from the closed lists", () => {
    for (const d of pb.offense.designs) {
      const pass = pb.config.concepts[d.concept]?.family === "pass";
      expect(d.tags.depth === undefined ? !pass : pass && DEPTH_BUCKETS.includes(d.tags.depth), `${d.id} depth`).toBe(true);
      expect(TIMINGS.includes(d.tags.timing) && Array.isArray(d.tags.situations) && Array.isArray(d.traits), d.id).toBe(true);
      for (const s of d.tags.situations) expect(SITUATION_TAGS, d.id).toContain(s);
    }
    for (const d of pb.defense.designs) {
      expect(TIMINGS.includes(d.tags.timing) && PRESSURES.includes(d.tags.pressure) && Array.isArray(d.tags.situations) && Array.isArray(d.traits), d.id).toBe(true);
      for (const s of d.tags.situations) expect(SITUATION_TAGS, d.id).toContain(s);
    }
  });

  it("rejects a design with a missing tag", () => {
    expect(broken((r) => void delete (off(r, "shotgun.shortPass.mesh")["tags"] as Record<string, unknown>)["timing"])).toThrow(/timing/);
    expect(broken((r) => void delete (off(r, "shotgun.shortPass.mesh")["tags"] as Record<string, unknown>)["depth"])).toThrow(/a pass design needs a depth tag/);
    expect(broken((r) => void delete (def(r, "baseCover3.sky")["tags"] as Record<string, unknown>)["pressure"])).toThrow(/pressure/);
    expect(broken((r) => void delete off(r, "shotgun.shortPass.mesh")["traits"])).toThrow(/traits/);
  });

  // [tag, a situation on the edge where it applies, the nearest one where it does not]
  const edges: [SituationTag, Partial<Situation>, Partial<Situation>][] = [
    ["shortYardage", { yardsToGo: 3 }, { yardsToGo: 4 }],
    ["shortYardage", { yardsToGo: 1 }, { yardsToGo: 1, phase: "try" }],
    ["redZone", { yardLine100: 20 }, { yardLine100: 21 }],
    ["goalLine", { yardLine100: 5 }, { yardLine100: 6 }],
    ["goalLine", { yardLine100: 2, phase: "try" }, { yardLine100: 6, phase: "try" }],
    ["twoMinute", { secondsLeftInHalf: 120 }, { secondsLeftInHalf: 121 }],
    ["longYardage", { yardsToGo: 11 }, { yardsToGo: 10 }],
    ["backedUp", { yardLine100: 90 }, { yardLine100: 89 }],
    ["runClock", { quarter: 4, secondsLeftInGame: 300, scoreDiff: 1 }, { quarter: 4, secondsLeftInGame: 301, scoreDiff: 1 }],
    ["runClock", { quarter: 4, secondsLeftInGame: 300, scoreDiff: 1 }, { quarter: 4, secondsLeftInGame: 300, scoreDiff: 0 }],
    ["runClock", { quarter: 4, secondsLeftInGame: 300, scoreDiff: 1 }, { quarter: 3, secondsLeftInGame: 300, scoreDiff: 1 }],
  ];
  it.each(edges)("%s: %j applies, %j does not", (tag, yes, no) => {
    expect(tagApplies(tag, situation(yes), pb.config)).toBe(true);
    expect(tagApplies(tag, situation(no), pb.config)).toBe(false);
  });

  it("every situation tag has an edge fixture, and the edges are the caller's bin edges", () => {
    expect([...new Set(edges.map((e) => e[0]))].sort()).toEqual([...SITUATION_TAGS].sort());
    interface Bucket { label: string; min: number | null; max: number | null }
    const dims = readJson<{ dimensions: Record<string, { buckets: Bucket[] }> }>("data/caller/config.json").dimensions;
    const bucket = (dim: string, label: string) => dims[dim]?.buckets.find((b) => b.label === label);
    expect(bucket("dist3", "1-3")?.max).toBe(3);
    expect(bucket("zone3", "RZ")?.max).toBe(20);
    expect(bucket("zone6", "GL")?.max).toBe(5);
    expect(bucket("time5", "H1F")?.max).toBe(120);
    expect(bucket("dist5", "11+")?.min).toBe(11);
    expect(bucket("zone6", "BACK")?.min).toBe(90);
    expect(bucket("lateTime", "G5")?.max).toBe(300);
    expect(bucket("score3", "L")?.min).toBe(1);
  });
});

describe("A9: alignments.json deep-equals the alignment blocks of data/ui/templates.json", () => {
  it("offense, defense and presetAlignment are the same", () => {
    const templates = readJson<Record<string, unknown>>("data/ui/templates.json");
    expect(pb.alignments.offense).toEqual(templates["offense"]);
    expect(pb.alignments.defense).toEqual(templates["defense"]);
    expect(pb.alignments.presetAlignment).toEqual(templates["presetAlignment"]);
  });
});

describe("A10: docs/PLAYBOOK.md lists every design with its description and tags", () => {
  const doc = readFileSync(join(repoRoot, "docs/PLAYBOOK.md"), "utf8");
  const sections = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of doc.split("\n")) {
    const h = /^### (.+)$/.exec(line);
    if (h) sections.set(h[1] as string, (current = []));
    else if (line.startsWith("- **")) current?.push(line);
  }

  it("has one section per group with exactly that group's designs, in order", () => {
    const labels = callLabels();
    const want = new Map<string, string[]>();
    for (const d of [...pb.offense.designs, ...pb.defense.designs]) {
      const heading = groupHeading(d, labels);
      want.set(heading, [...(want.get(heading) ?? []), designLine(d)]);
    }
    expect(want.size).toBe(53);
    expect(Object.fromEntries(sections)).toEqual(Object.fromEntries(want));
  });

  it("a changed description would fail the comparison", () => {
    const d = pb.offense.designs[0] as (typeof pb.offense.designs)[number];
    expect(doc).toContain(designLine(d));
    expect(doc).not.toContain(designLine({ ...d, description: `${d.description} Really.` }));
    expect(doc).not.toContain(designLine({ ...d, traits: [...d.traits, "lead"] }));
  });

  it("never calls the catalog fitted or data-derived", () => {
    expect(doc).toMatch(/designed/);
    expect(doc).not.toMatch(/data-derived|\bfitted from\b/i);
  });
});

describe("the playbook's positions", () => {
  it("offense designs use only offense slots and defense designs only defense slots", () => {
    for (const d of pb.offense.designs) for (const s of Object.keys(d.assignments)) expect(["QB", "RB", "WR", "TE", "OL"], d.id).toContain(positionOf(s));
    for (const d of pb.defense.designs) for (const s of Object.keys(d.assignments)) expect(["DL", "LB", "CB", "S"], d.id).toContain(positionOf(s));
  });
});
