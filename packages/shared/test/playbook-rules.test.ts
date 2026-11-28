// The lead's rulings of 2026-11-24 on the playbook data (docs/specs/m3-playbook-and-custom-routes.md,
// "Revision 2026-11-24"): blockers (R6), man coverage (R7), the field (R8), own keys (R9), distinct
// designs and derived tags (R10), screens (R15), declared fields (R19) and what parsePlaybook must
// refuse. Default diagrams (R5) are checked in packages/app/test/playbook-defaults.test.ts.

import { describe, expect, it } from "vitest";
import { absolutePath, CALLS_NOT_DRAWN, formationRoles, holeOf, manAgainst, own, placePath, resolveDefense, resolveOffense, slotsOf, strongSign, tagApplies } from "../src/playbook";
import type { DefenseDesign, OffenseDesign, Pair, SituationTag, SlotAlignment } from "../src/playbook";
import { defenseSignature, defenseTraits, offenseSignature, offenseTraits, pressureOf, routesOf, situationFits, timingsOf } from "../src/playbook-rules";
import { parsePlaybook } from "../src/playbook-schema";
import type { Situation } from "../src/situation";
import { loadPlaybook, playbookRefs, rawPlaybook, readJson } from "./playbook-load";
import type { RawPlaybook } from "./playbook-load";

const pb = loadPlaybook();
const refs = playbookRefs();
const off = (raw: RawPlaybook, id: string) => raw.offense.designs.find((d) => d.id === id) as RawPlaybook["offense"]["designs"][number];
const def = (raw: RawPlaybook, id: string) => raw.defense.designs.find((d) => d.id === id) as RawPlaybook["defense"]["designs"][number];
const broken = (change: (raw: RawPlaybook) => void) => () => {
  const raw = rawPlaybook();
  change(raw);
  return parsePlaybook(raw, refs);
};
const offense = (id: string) => pb.offense.designs.find((d) => d.id === id) as OffenseDesign;
const defense = (id: string) => pb.defense.designs.find((d) => d.id === id) as DefenseDesign;
const resolved = (d: OffenseDesign) => resolveOffense(d, pb, slotsOf(refs.personnel.offense[d.formation] ?? {}));

describe("R6: lead and pulling blockers end at the hole, on the runner's side", () => {
  const runs = pb.offense.designs.filter((d) => pb.config.concepts[d.concept]?.family === "run");
  const blockers = runs.flatMap((d) => resolved(d).filter((r) => r.entry.kind === "block" && (r.entry.technique === "lead" || r.entry.technique === "pull")).map((r) => ({ d, r })));
  it("there are some, in every shape that has one", () => {
    expect(blockers.length).toBeGreaterThanOrEqual(20);
    expect(new Set(blockers.map((b) => b.d.label))).toEqual(new Set(["Power", "Sweep", "Counter", "Lead", "Trap", "Toss", "QB Power", "QB Sweep", "Off Tackle"]));
  });
  for (const { d, r } of blockers) {
    it(`${d.id} ${r.slot}`, () => {
      const a = pb.alignments.offense[d.formation] as SlotAlignment;
      const hole = holeOf(resolved(d), a);
      if (hole === null || !("pts" in r.entry)) throw new Error("no hole");
      const here = a[r.slot] as Pair;
      const end = placePath(r.entry, here, r.to, undefined, hole).slice(-1)[0] as Pair;
      // Within a yard of where the runner crosses, on his side of the ball, at the line or past it.
      expect(Math.abs(here[0] + end[0] - hole.x)).toBeLessThanOrEqual(1);
      expect(Math.sign(here[0] + end[0])).toBe(hole.sign);
      expect(end[1] - here[1]).toBeGreaterThanOrEqual(0);
    });
  }
  it("moving the hole moves the blocker: a Power run one gap wider takes the guard with it", () => {
    const d = { ...offense("shotgun.insideRun.power"), assignments: { ...offense("shotgun.insideRun.power").assignments, RB1: { use: "run.offTackle", to: "left" as const } } };
    const a = pb.alignments.offense["shotgun"] as SlotAlignment;
    const hole = holeOf(resolved(d), a);
    expect(hole?.x).toBeLessThan(-4);
    const guard = resolved(d).find((r) => r.slot === "OL4");
    if (hole === null || guard?.entry.kind !== "block") throw new Error("no guard");
    expect(2 + (placePath(guard.entry, a["OL4"] as Pair, undefined, undefined, hole).slice(-1)[0] as Pair)[0]).toBeCloseTo(hole.x);
  });
  /** Distance from a point to the runner's whole path. */
  const offPath = (p: Pair, track: readonly Pair[]) =>
    Math.min(
      ...track.slice(1).map((b, i) => {
        const a = track[i] as Pair;
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        const f = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(p[0] - a[0] - f * dx, p[1] - a[1] - f * dy);
      }),
    );
  // Lead and pulling blockers run ahead of him (above). Straight up the middle he follows the
  // lineman he starts behind (Sneak, Dive, Draw), who is not in his way.
  let checked = 0;
  for (const d of runs)
    it(`${d.id}: no other blocker ends on the runner's path`, () => {
      const a = pb.alignments.offense[d.formation] as SlotAlignment;
      const res = resolved(d);
      const hole = holeOf(res, a);
      const c = res.find((r) => r.entry.kind === "runPath");
      if (c?.entry.kind !== "runPath") throw new Error("no carrier");
      const track = absolutePath(placePath(c.entry, a[c.slot] as Pair, c.to), a[c.slot] as Pair, true);
      for (const r of res) {
        if (r.entry.kind !== "block" || r.entry.technique === "lead" || r.entry.technique === "pull") continue;
        if (hole === null && (a[r.slot] as Pair)[0] === 0 && r.position === "OL") continue;
        const end = absolutePath(placePath(r.entry, a[r.slot] as Pair, r.to, undefined, hole ?? undefined), a[r.slot] as Pair, true).slice(-1)[0] as Pair;
        expect(offPath(end, track), `${r.slot} ${r.use} ends at ${end.join(", ")}`).toBeGreaterThanOrEqual(0.5);
        checked++;
      }
    });
  it("checked every blocker of every run", () => expect(checked).toBeGreaterThan(280));
  it("a hole block on a run with no side is refused", () => {
    expect(broken((r) => void (off(r, "pistol.insideRun.dive").assignments["TE1"] = "block.lead"))).toThrow(/needs a run to a side/);
  });
});

describe("R7: every man defender has a receiver or a fallback in every formation", () => {
  const men = pb.defense.designs.flatMap((d) => resolveDefense(d, pb, slotsOf(refs.personnel.packages[d.package] ?? {})).flatMap((r) => (r.entry.kind === "man" ? [{ d, r, entry: r.entry }] : [])));
  it("holds for the shipped designs", () => {
    expect(men.length).toBeGreaterThan(80);
    for (const { d, r, entry } of men) for (const [f, a] of Object.entries(pb.alignments.offense)) expect(manAgainst(entry, formationRoles(a, pb.config.positions)), `${d.id} ${r.slot} against ${f}`).not.toBeNull();
  });
  it("the second receiver on the left is the spot Heavy lacks, and his man drops to a zone there", () => {
    const l2 = pb.library.assignments["man.L2"];
    if (l2?.kind !== "man") throw new Error("man.L2");
    expect(manAgainst(l2, formationRoles(pb.alignments.offense["heavy"] as SlotAlignment, pb.config.positions))).toEqual({ fallback: { use: "zone.under.left", at: [-10, 6] } });
    expect(manAgainst(l2, formationRoles(pb.alignments.offense["shotgun"] as SlotAlignment, pb.config.positions))).toEqual({ role: "L2", covers: "TE1" });
  });
  it.each([
    ["no fallback", (r: RawPlaybook) => void delete r.library.assignments["man.L2"]?.["fallback"], /man\.L2\) has nobody to cover against heavy/],
    ["a fallback that is a block", (r: RawPlaybook) => void ((r.library.assignments["man.L2"] as Record<string, unknown>)["fallback"] = { use: "block.pass" }), /is not a rush, spy or zone/],
    ["a zone fallback with no landmark", (r: RawPlaybook) => void ((r.library.assignments["man.L2"] as Record<string, unknown>)["fallback"] = { use: "zone.under.left" }), /the fallback needs a landmark|zone at the fallback needs a landmark/],
    ["a fallback that makes a fifth rusher", (r: RawPlaybook) => void ((r.library.assignments["man.L2"] as Record<string, unknown>)["fallback"] = { use: "rush.inside" }), /5 rushers against heavy is outside the preset's rush/],
    ["a fallback that adds a deep defender", (r: RawPlaybook) => void ((r.library.assignments["man.L2"] as Record<string, unknown>)["fallback"] = { use: "zone.deep.left", at: [-12, 15] }), /2 deep defenders against heavy is outside the preset's shell/],
  ])("rejects %s", (_name, change, message) => expect(broken(change)).toThrow(message));
});

describe("R8: the field is stored in feet", () => {
  it("160 feet, and yards are derived at parse", () => {
    const raw = rawPlaybook().config["field"] as Record<string, unknown>;
    expect(raw["widthFeet"]).toBe(160);
    expect(raw["widthYards"]).toBeUndefined();
    expect(pb.config.field.widthYards).toBe(160 / 3);
  });
  it("the quarterback's bar is labeled a designed restriction", () => expect(pb.config.eligibility.note).toMatch(/designed restriction, stricter than the rule/));
});

describe("R9: untrusted keys are own keys", () => {
  const names = ["constructor", "toString", "hasOwnProperty", "__proto__"];
  it.each(names)("%s is never found on a record", (k) => {
    expect(own({ a: 1 }, k)).toBeUndefined();
    expect(tagApplies(k as SituationTag, {} as Situation, pb.config)).toBe(false);
  });
  it.each(names.slice(0, 3))("a design with %s as formation, concept, slot, preset or package is refused", (k) => {
    for (const field of ["formation", "concept"]) expect(broken((r) => void (off(r, "shotgun.shortPass.mesh")[field] = k))).toThrow(/unknown/);
    for (const field of ["coverage", "package"]) expect(broken((r) => void (def(r, "baseCover3.buzz")[field] = k))).toThrow(/unknown preset|not/);
    expect(broken((r) => void (off(r, "shotgun.shortPass.mesh").assignments[k] = "route.go"))).toThrow();
  });
});

describe("R10: designs differ in what the engine reads, and their tags follow from their assignments", () => {
  it("no two designs of a group have the same features", () => {
    const seen = new Map<string, string>();
    const note = (key: string, id: string) => {
      expect(seen.get(key), `${id} reads the same as ${seen.get(key)}`).toBeUndefined();
      seen.set(key, id);
    };
    for (const d of pb.offense.designs) note(`${d.formation}.${d.concept} ${offenseSignature(d, pb, refs)}`, d.id);
    for (const d of pb.defense.designs) note(`${d.coverage} ${defenseSignature(d, pb, refs)}`, d.id);
  });
  it("a landmark moved inside its zone, or a corner's path moved, is the same play to the engine", () => {
    const sky = defense("baseCover3.sky");
    expect(defenseSignature({ ...sky, assignments: { ...sky.assignments, LB2: { use: "zone.under.middle", at: [-2, 8] } } }, pb, refs)).toBe(defenseSignature(sky, pb, refs));
  });
  it("traits, pressure and depth are the derived ones for all 147", () => {
    for (const d of pb.offense.designs) {
      expect([...d.traits].sort(), d.id).toEqual(offenseTraits(d, pb, refs).sort());
      if (d.tags.depth !== undefined) expect(d.tags.depth, d.id).toBe(routesOf(d, pb, refs).find((r) => r.primary)?.bucket);
    }
    for (const d of pb.defense.designs) expect([[...d.traits].sort(), d.tags.pressure], d.id).toEqual([defenseTraits(d, pb, refs).sort(), pressureOf(d, pb, refs)]);
  });
  it("every situation tag fits its design by the rules in config.json, and every tag is used on both sides", () => {
    for (const d of pb.offense.designs) for (const t of d.tags.situations) expect(situationFits(pb.config.situations[t].designs.offense, d, pb, refs), `${d.id} ${t}`).toBe(true);
    for (const d of pb.defense.designs) for (const t of d.tags.situations) expect(situationFits(pb.config.situations[t].designs.defense, d, pb, refs), `${d.id} ${t}`).toBe(true);
    for (const t of Object.keys(pb.config.situations) as SituationTag[]) for (const list of [pb.offense.designs, pb.defense.designs]) expect(list.some((d) => d.tags.situations.includes(t)), t).toBe(true);
  });
  it("the rules say no to something: each tag has a design on each side it does not fit", () => {
    for (const t of Object.keys(pb.config.situations) as SituationTag[]) {
      expect(pb.offense.designs.some((d) => !situationFits(pb.config.situations[t].designs.offense, d, pb, refs)), t).toBe(true);
      expect(pb.defense.designs.some((d) => !situationFits(pb.config.situations[t].designs.defense, d, pb, refs)), t).toBe(true);
    }
  });
});

describe("R19: declared fields are checked against the paths", () => {
  type Change = (r: RawPlaybook) => void;
  const lib = (r: RawPlaybook, id: string) => r.library.assignments[id] as Record<string, unknown>;
  const set = (id: string, key: string, value: unknown): Change => (r) => void (lib(r, id)[key] = value);
  const use = (id: string, slot: string, value: unknown): Change => (r) => void ((r.offense.designs.find((d) => d.id === id) ?? def(r, id)).assignments[slot] = value);
  const cases: [string, Change, RegExp][] = [
    ["run.power declared gap A", set("run.power", "gap", "A"), /shotgun\.insideRun\.power: RB1: run\.power is declared gap A, its path crosses in gap B/],
    ["a quarterback's run declared gap B", set("run.sneak", "gap", "B"), /run\.sneak is declared gap B, its path crosses in gap A/],
    ["a run that never crosses the line", set("run.dive", "pts", [[0, -2], [0, -0.5]]), /RB1: run\.dive never crosses the line/],
    [
      "counter and the misdirection trait on every Power",
      (r) => {
        lib(r, "run.power")["counter"] = true;
        for (const d of r.offense.designs) if (Object.values(d.assignments).some((v) => (v as { use?: string }).use === "run.power")) d["traits"] = ["gap", "misdirection"];
      },
      /shotgun\.insideRun\.power: RB1: run\.power is declared counter true, its first step goes to the play side/,
    ],
    ["a counter not declared one", set("run.counter", "counter", false), /run\.counter is declared counter false, its first step goes away from the play side/],
    ["a draw block with no pass set", set("block.drawSet", "pts", [[0, 0.5]]), /block\.drawSet is declared a draw block, its path shows no pass set first/],
    ["a zone step called a draw block, for the trait", set("block.zone", "technique", "draw"), /block\.zone is declared a draw block/],
    ["a slant declared corner", set("route.slant", "family", "corner"), /WR1: route\.slant is declared corner, its path is slant/],
    ["a slant declared out", set("route.slant", "direction", "out"), /route\.slant is declared to go out, its path goes in/],
    ["a dig with breakAt on its stem", set("route.dig", "breakAt", 0), /route\.dig is declared caught at 3, its path says 13/],
    ["blitz.edge declared inside", set("blitz.edge", "lane", "inside"), /S2: blitz\.edge is declared lane inside, its path crosses in lane edge/],
    ["a stunt that stays on its side of the line", set("stunt.crash", "pts", [[2, -0.5]]), /stunt\.crash never crosses the line/],
    ["a post at 80", use("shotgun.deepPass.postDig", "WR2", { use: "route.post", depth: 80, primary: true }), /WR2 leaves the field on route\.post[\s\S]*WR2's path on route\.post is over the limits/],
    ["a go at -30", use("shotgun.deepPass.postDig", "WR1", { use: "route.go", depth: -30 }), /WR1: route\.go is declared go, its path is/],
    ["a path over the length limit inside the field", set("route.shallow", "pts", [[0, 2], [40, 2], [10, 5]]), /is over the limits: 12 points and 60 yards/],
    ["a path over the point limit", set("block.pass", "pts", Array.from({ length: 12 }, (_, i) => [0, -0.1 * (i + 1)])), /path on block\.pass is over the limits/],
    ["a 90-yard landmark", use("baseCover3.sky", "S1", { use: "zone.deep.middle", at: [0, 90] }), /S1's landmark is off the field[\s\S]*S1 leaves the field on zone\.deep\.middle/],
    ["a landmark behind the line", use("baseCover3.sky", "LB2", { use: "zone.under.middle", at: [0, -4] }), /LB2's landmark is off the field or not past the line/],
    ["a 90-yard fallback landmark", set("man.L2", "fallback", { use: "zone.deep.left", at: [-12, 90] }), /library man\.L2: the fallback's landmark is off the field/],
    ["a back lined up 80 yards deep", (r) => void ((r.alignments.offense["shotgun"] as Record<string, unknown>)["RB1"] = [-2, 80]), /offense\.shotgun: RB1 is off the field/],
    ["breakAt past the end", set("route.slant", "breakAt", 2), /library route\.slant: breakAt is past the last waypoint/],
    ["breakAt past the end, with a depth", set("route.corner", "breakAt", 9), /library route\.corner: breakAt is past the last waypoint/],
  ];
  it.each(cases)("%s", (_name, change, message) => {
    let error: unknown;
    try {
      broken(change)();
    } catch (e) {
      error = e;
    }
    // A listed issue, never a crash on the way.
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^data\/plays failed its check:/);
    expect((error as Error).message).toMatch(message);
  });
});

describe("timing tags follow from the assignments where the rules decide (config.timing)", () => {
  it("every design's tag is one its row allows, and each row decides something", () => {
    for (const d of [...pb.offense.designs, ...pb.defense.designs]) expect(timingsOf(d, pb, refs), d.id).toContain(d.tags.timing);
    for (const side of ["offense", "defense"] as const)
      for (const row of pb.config.timing[side]) expect(pb[side].designs.some((d) => timingsOf(d, pb, refs) === row.allow), JSON.stringify(row)).toBe(true);
  });
  const tag = (d: { [k: string]: unknown }, timing: string) => void ((d["tags"] as Record<string, unknown>)["timing"] = timing);
  it.each([
    ["a quick drop tagged slow", (r: RawPlaybook) => tag(off(r, "shotgun.shortPass.slantFlat"), "slow"), /slantFlat: timing tag is slow, its assignments allow quick/],
    ["a deep drop tagged quick", (r: RawPlaybook) => tag(off(r, "shotgun.deepPass.fourVerticals"), "quick"), /fourVerticals: timing tag is quick, its assignments allow slow/],
    ["a standard drop tagged quick", (r: RawPlaybook) => tag(off(r, "shotgun.intermediatePass.levels"), "quick"), /levels: timing tag is quick, its assignments allow standard/],
    ["a deep drop tagged standard, whatever its concept (R21)", (r: RawPlaybook) => void (off(r, "shotgun.intermediatePass.levels").assignments["QB1"] = { use: "qb.deep", to: "right" }), /levels: timing tag is standard, its assignments allow slow/],
    ["a deep pass off a standard drop, its first read deep, tagged standard", (r: RawPlaybook) => (tag(off(r, "shotgun.deepPass.postDig"), "standard"), void (off(r, "shotgun.deepPass.postDig").assignments["QB1"] = { use: "qb.drop", to: "right" })), /postDig: timing tag is standard, its assignments allow slow/],
    ["a dig moved to 15 yards tagged standard", (r: RawPlaybook) => void (off(r, "shotgun.intermediatePass.levels").assignments["WR1"] = { use: "route.dig", depth: 15, primary: true }), /levels: timing tag is standard, its assignments allow slow/],
    ["a screen to the back tagged standard", (r: RawPlaybook) => tag(off(r, "shotgun.screenPass.backScreen"), "standard"), /backScreen: timing tag is standard, its assignments allow slow/],
    ["a Deep Cross tagged slow", (r: RawPlaybook) => tag(off(r, "pistol.intermediatePass.deepCross"), "slow"), /deepCross: timing tag is slow, its assignments allow standard/],
    ["a draw tagged quick", (r: RawPlaybook) => tag(off(r, "shotgun.insideRun.draw"), "quick"), /draw: timing tag is quick, its assignments allow slow/],
    ["an edge run tagged quick", (r: RawPlaybook) => tag(off(r, "heavy.outsideRun.toss"), "quick"), /toss: timing tag is quick, its assignments allow standard, slow/],
    ["a blitz tagged standard", (r: RawPlaybook) => tag(def(r, "runStuff.strongRunBlitz"), "standard"), /strongRunBlitz: timing tag is standard, its assignments allow quick/],
    ["a stunt tagged standard", (r: RawPlaybook) => tag(def(r, "baseCover3.twist"), "standard"), /twist: timing tag is standard, its assignments allow slow/],
  ])("%s", (_n, change, message) => expect(broken(change)).toThrow(message));
});

it("R21: a timing row cannot name a concept", () => {
  const rows = (r: RawPlaybook) => (r.config["timing"] as { offense: Record<string, unknown>[] }).offense;
  expect(broken((r) => void rows(r).unshift({ when: { concepts: ["deepPass"] }, allow: ["slow"] }))).toThrow(/concepts/);
});

describe("R21: entries no design uses are checked too", () => {
  const add = (entry: Record<string, unknown>) => broken((r) => void (r.library.assignments["extra.one"] = { label: "Extra", ...entry }));
  const route = { kind: "route", family: "slant", direction: "in", axis: "in", pts: [[0, 3], [5, 8]], breakAt: 0 };
  const run = { kind: "runPath", gap: "B", counter: false, axis: "side", pts: [[3, -1], [3, 3]] };
  const blitz = { kind: "blitz", lane: "edge", axis: "in", pts: [[4, -4], [9, -7.5]] };
  const draw = { kind: "block", block: "run", technique: "draw", axis: "none", pts: [[0, -1], [0, 0.5]] };
  it.each([
    ["a route", route],
    ["a back's swing", { kind: "route", family: "swing", direction: "out", axis: "side", pts: [[-1, 0.5], [4, 2]], breakAt: 0 }],
    ["a screen", { kind: "route", family: "screen", direction: "out", axis: "side", pts: [[1, 0.5], [5, -0.5]], breakAt: 0 }],
    ["a run", run],
    ["a blitz only a corner can run", blitz],
    ["a stunt", { kind: "stunt", lane: "edge", axis: "in", pts: [[-3, -0.5], [-4.5, -2.5]] }],
    ["an edge rush", { kind: "rush", lane: "edge", axis: "none", pts: [[0, -3]] }],
    ["a draw block", draw],
    ["a hole block", { kind: "block", block: "run", technique: "lead", axis: "hole", pts: [[-0.5, -2], [0, 2]] }],
    ["a rollout", { kind: "qb", action: "rollout", fake: true, axis: "side", pts: [[-1, -0.5], [9, -3]] }],
    ["a zone", { kind: "zone", level: "deep", third: "left" }],
  ])("%s that is what it says parses", (_n, entry) => expect(add(entry)).not.toThrow());
  it.each<[string, Record<string, unknown>, RegExp]>([
    ["a slant declared go", { ...route, family: "go" }, /library extra\.one, which no design uses, from \w+ in [\w.]+: extra\.one is declared go, its path is slant/],
    ["a slant declared out", { ...route, direction: "out" }, /extra\.one is declared to go out/],
    ["a dig with breakAt on its stem", { ...route, family: "in", pts: [[-0.5, 4], [0, 14], [7, 14.5]] }, /extra\.one is declared caught at/],
    ["a run in the wrong gap", { ...run, gap: "C" }, /extra\.one is declared gap C, its path crosses in gap B/],
    ["a counter that is not one", { ...run, counter: true }, /extra\.one is declared counter true/],
    ["a stunt in the wrong lane", { kind: "stunt", lane: "edge", axis: "in", pts: [[4, -0.5], [4.5, -2.5]] }, /extra\.one is declared lane edge, its path crosses in lane inside/],
    ["a rush that never crosses", { kind: "rush", lane: "inside", axis: "none", pts: [[0, -0.5]] }, /extra\.one never crosses the line/],
    ["a draw block with no pass set", { ...draw, pts: [[0, 0.5]] }, /extra\.one is declared a draw block/],
    ["a block off the field", { ...draw, technique: "stalk", pts: [[0, 60]] }, /leaves the field on extra\.one/],
    ["a drop over the point limit", { kind: "qb", action: "drop", drop: "deep", fake: false, axis: "none", pts: Array.from({ length: 12 }, (_, i) => [0, -0.1 * (i + 1)]) }, /path on extra\.one is over the limits/],
    ["breakAt past the end", { ...route, breakAt: 5 }, /library extra\.one: breakAt is past the last waypoint/],
  ])("%s is refused", (_n, entry, message) => {
    expect(add(entry)).toThrow(/^data\/plays failed its check:/);
    expect(add(entry)).toThrow(message);
  });
});

describe("the positions the helpers use are read from data", () => {
  it("moving a position out of the receivers changes the strong side and the spots", () => {
    const a = pb.alignments.offense["underCenter"] as SlotAlignment;
    const heavyLeft = { ...a, TE2: [-8, 1] as Pair };
    expect([strongSign(heavyLeft, pb.config.positions), strongSign(heavyLeft, { ...pb.config.positions, receivers: ["WR"], strongTieBreak: [] })]).toEqual([-1, 1]);
    expect(Object.keys(formationRoles(a, { ...pb.config.positions, receivers: ["WR"], backs: [] })).sort()).toEqual(["L1", "R1"]);
  });
  it("the calls with no drawing are calls of the catalog", () => {
    const ids = readJson<{ screens: { choices: { id: string }[] }[] }>("data/calls/catalog.json").screens.flatMap((s) => s.choices.map((c) => c.id));
    for (const c of CALLS_NOT_DRAWN) expect(ids).toContain(c);
  });
});

describe("parsePlaybook refuses what the review got past it", () => {
  type Change = (r: RawPlaybook) => void;
  const cfg = (r: RawPlaybook, k: string) => r.config[k] as Record<string, unknown>;
  const cases: [string, Change, RegExp][] = [
    ["a position that does not exist", (r) => void (cfg(r, "eligibility")["routePositions"] = ["WT"]), /WT is not a position/],
    ["a typo in notOnThisCall", (r) => void (r.config["notOnThisCall"] = ["punts", "fieldGoal", "extraPoint", "kickoff", "onsideKick", "spike", "kneel", "qbSneak"]), /punt/],
    ["a call missing from notOnThisCall", (r) => void (r.config["notOnThisCall"] as string[]).pop(), /must list each/],
    ["an off-field fade", (r) => void ((r.library.assignments["route.fade"] as Record<string, unknown>)["pts"] = [[-2, 3], [-8, 26]]), /WR1 leaves the field on route\.fade/],
    ["a deleted offense alignment slot", (r) => void delete r.alignments.offense["shotgun"]?.["WR3"], /offense\.shotgun: no place for WR3/],
    ["a deleted defense alignment slot", (r) => void delete r.alignments.defense["nickel"]?.["CB3"], /defense\.nickel: no place for CB3/],
    ["a slot the package does not have", (r) => void ((r.alignments.presetAlignment["baseCover2"] as Record<string, unknown>)["CB3"] = [0, 5]), /presetAlignment\.baseCover2: unknown slot CB3/],
    ["an alignment off the field", (r) => void ((r.alignments.offense["shotgun"] as Record<string, unknown>)["WR1"] = [-27, 1]), /WR1 is off the field/],
    ["a false trait", (r) => void (off(r, "shotgun.shortPass.slantFlat")["traits"] = ["quick", "flood"]), /slantFlat: traits are quick, flood/],
    ["a missing trait", (r) => void (def(r, "baseCover3.sky")["traits"] = ["zone"]), /baseCover3\.sky: traits are zone/],
    ["a false pressure tag", (r) => void ((def(r, "baseCover3.sky")["tags"] as Record<string, unknown>)["pressure"] = "blitz"), /pressure tag is blitz, its rush is none/],
    ["a false depth tag", (r) => void ((off(r, "shotgun.deepPass.postDig")["tags"] as Record<string, unknown>)["depth"] = "intermediate"), /depth tag is intermediate, its primary route is deep/],
    ["a situation tag that does not fit", (r) => void ((off(r, "shotgun.deepPass.fourVerticals")["tags"] as Record<string, unknown>)["situations"] = ["shortYardage"]), /situation tag shortYardage does not fit/],
    ["a screen moved downfield by depth (R15)", (r) => void (off(r, "shotgun.screenPass.backScreen").assignments["RB1"] = { use: "back.screen", to: "left", depth: 12, primary: true }), /must be a screen behind the line/],
    ["a fake away from the back", (r) => void (off(r, "shotgun.playAction.paFlood").assignments["QB1"] = { use: "qb.playAction", to: "left" }), /the fake goes left but RB1 goes right/],
    ["a deviation for a call that does not exist", (r) => void (cfg(r, "defaultDeviations")["shotgun.hailMary"] = "because"), /shotgun\.hailMary is not an engine call/],
  ];
  it.each(cases)("%s", (_name, change, message) => expect(broken(change)).toThrow(message));
  it("a screen declared as another family but ending behind the line is a screen (R15)", () => {
    // back.swing ends a yard behind the line from shotgun. Its family is swing, not screen.
    expect(broken((r) => void (off(r, "shotgun.screenPass.backScreen").assignments["RB1"] = { use: "back.swing", to: "left", primary: true }))).not.toThrow();
  });
});
