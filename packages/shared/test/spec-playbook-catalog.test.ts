// Independent tests of milestone A (docs/specs/m3-playbook-and-custom-routes.md), from the spec's
// words and tables. The catalog below is typed from the spec, not read from the data.

import { describe, expect, it, vi } from "vitest";
import { parsePlaybook } from "../src/playbook-schema";
import { PASS_TRAITS, RUN_TRAITS, DEFENSE_TRAITS, resolveDefense, resolveOffense, tagApplies } from "../src/playbook";
import type { DefenseDesign, LibraryEntry, OffenseDesign, Pair, SituationTag } from "../src/playbook";
import type { Situation } from "../src/situation";
import { caller, defAlign, defEntries, drawnFrom, files, json, onField, personnel, pos, ref, refs, text, widthYardsOf } from "./spec-support";
import type { Files } from "./spec-support";

vi.setConfig({ testTimeout: 30_000 });

const F = files();
const off = F.offense.designs;
const def = F.defense.designs;
const names = (s: string) => s.split(", ");

const FORMATIONS = ["shotgun", "underCenter", "pistol", "empty", "heavy"];
const OFFENSE: Record<string, string[]> = {
  insideRun: ["Inside Zone, Draw, Power", "Inside Zone, Power, Lead, Trap", "Inside Zone, Dive, Power", "QB Draw, QB Power", "Dive, Power, Lead"],
  outsideRun: ["Outside Zone, Sweep, Counter", "Outside Zone, Toss, Counter", "Outside Zone, Toss, Sweep", "QB Sweep", "Toss, Off Tackle"],
  qbSneak: ["Sneak", "Sneak, Wedge", "Sneak", "Sneak", "Sneak, Wedge"],
  shortPass: ["Slant Flat, Stick, Curl Flat, Mesh, Quick Outs", "Slant Flat, Curl Flat, Hitches", "Stick, Slant Flat, Quick Outs", "Mesh, Stick, Spacing, Hitches", "Stick, Slant Flat"],
  intermediatePass: ["Smash, Flood, Drive, Levels, Dagger", "Flood, Dig, Curls", "Smash, Drive, Deep Cross", "Levels, Smash, Dagger", "Corner Flat, Deep Cross"],
  deepPass: ["Four Verticals, Post Wheel, Post Dig, Fades", "Post Dig, Post Corner, Fades", "Four Verticals, Post Wheel, Double Post", "Four Verticals, Double Post, Fades", "Seams, Post"],
  screenPass: ["Back Screen, Bubble Screen, Tunnel Screen", "Back Screen, Tight End Screen", "Back Screen, Bubble Screen", "Bubble Screen, Tunnel Screen", "Back Screen, Tight End Screen"],
  playAction: ["PA Crossers, PA Post, PA Flood", "Bootleg, PA Post, PA Crossers, PA Flood", "Bootleg, PA Post, PA Dig", "PA Seam", "Bootleg, PA Seam, PA Post"],
};
const OFFENSE_TOTALS: Record<string, number> = { insideRun: 15, outsideRun: 12, qbSneak: 7, shortPass: 17, intermediatePass: 16, deepPass: 15, screenPass: 11, playAction: 14 };
const DEFENSE: Record<string, string> = {
  baseCover3: "Cover 3 Sky, Cover 3 Buzz, Cover 3 Twist",
  baseCover2: "Cover 2, Cover 2 Middle Deep, Cover 2 Exchange",
  runStuff: "Eight in the Box, Strong Run Blitz, Pinch",
  nickelCover3: "Cover 3 Sky, Cover 3 Buzz, Cover 3 Twist, Cover 3 Exchange",
  nickelCover4: "Quarters, Quarter Quarter Half, Quarters Twist",
  nickelCover2: "Cover 2, Cover 2 Middle Deep, Cover 2 Trap",
  nickel2Man: "2-Man, 2-Man Bracket, 2-Man Spy",
  nickelCover1: "Cover 1 Robber, Cover 1 Spy, Cover 1 Press, Cover 1 Twist",
  nickelCover1Blitz: "Middle Blitz, Slot Blitz, Double A Gap, Safety Blitz",
  dimeCover4: "Quarters, Drop Eight, Quarters Twist",
  dimeCover0Blitz: "All Out, Corner Blitz, Overload",
  goalLine: "Goal Line, Goal Line Pinch",
  prevent: "Prevent, Prevent Spy",
};

const entryOf = (f: Files, v: Parameters<typeof ref>[0]): LibraryEntry => {
  const e = f.library.assignments[ref(v).use];
  if (e === undefined) throw new Error(`unknown id ${ref(v).use}`);
  return e;
};
const parse = (f: unknown) => parsePlaybook(f as Parameters<typeof parsePlaybook>[0], refs());
const isRun = (d: OffenseDesign) => ["insideRun", "outsideRun", "qbSneak"].includes(d.concept);

describe("A7: the catalog is the spec's table", () => {
  it("has 107 offense and 40 defense designs", () => {
    expect(off).toHaveLength(107);
    expect(def).toHaveLength(40);
  });
  for (const [concept, row] of Object.entries(OFFENSE)) {
    it(`${concept}: the names per formation and the total`, () => {
      row.forEach((cell, i) => {
        const got = off.filter((d) => d.concept === concept && d.formation === FORMATIONS[i]).map((d) => d.label);
        expect([...got].sort(), `${FORMATIONS[i]} ${concept}`).toEqual(names(cell).sort());
      });
      expect(off.filter((d) => d.concept === concept)).toHaveLength(OFFENSE_TOTALS[concept] as number);
    });
  }
  it("each preset's names", () => {
    for (const [preset, cell] of Object.entries(DEFENSE)) expect(def.filter((d) => d.coverage === preset).map((d) => d.label).sort(), preset).toEqual(names(cell).sort());
  });
  it("ids are unique across both files", () => {
    const ids = [...off, ...def].map((d) => d.id);
    expect(new Set(ids).size).toBe(147);
  });
  it("labels are unique within a group", () => {
    const keys = [...off.map((d) => `${d.formation}/${d.concept}/${d.label}`), ...def.map((d) => `${d.coverage}/${d.label}`)];
    expect(new Set(keys).size).toBe(147);
  });
});

describe("A2: one engine call per design, one default per engine call", () => {
  it("every offense design names a formation of personnel.json and one of the eight leaves", () => {
    for (const d of off) {
      expect(Object.keys(personnel.offense), d.id).toContain(d.formation);
      expect(Object.keys(OFFENSE), d.id).toContain(d.concept);
    }
  });
  it("every defense design names a preset and that preset's package", () => {
    for (const d of def) expect(d.package, d.id).toBe(personnel.presetPackage[d.coverage]);
  });
  it("40 offense pairs and 13 presets, each with exactly one default", () => {
    const pairs = FORMATIONS.flatMap((f) => Object.keys(OFFENSE).map((c) => off.filter((d) => d.formation === f && d.concept === c)));
    expect(pairs).toHaveLength(40);
    for (const g of pairs) expect(g.filter((d) => d.default), g[0]?.id ?? "empty pair").toHaveLength(1);
    const presets = Object.keys(personnel.presetPackage);
    expect(presets).toHaveLength(13);
    for (const p of presets) expect(def.filter((d) => d.coverage === p && d.default), p).toHaveLength(1);
  });
});

describe("A3: exactly one assignment per on-field slot", () => {
  it("offense: listed slots are on the field, and only linemen are left to the line default", () => {
    for (const d of off) {
      const slots = onField(personnel.offense[d.formation] as Record<string, number>);
      expect(slots, d.id).toHaveLength(11);
      for (const s of Object.keys(d.assignments)) expect(slots, `${d.id} ${s}`).toContain(s);
      for (const s of slots) if (d.assignments[s] === undefined) expect(pos(s), `${d.id} ${s}`).toBe("OL");
    }
  });
  it("defense: listed slots are on the field, and only linemen are left to rush", () => {
    for (const d of def) {
      const slots = onField(personnel.packages[d.package] as Record<string, number>);
      expect(slots, d.id).toHaveLength(11);
      for (const s of Object.keys(d.assignments)) expect(slots, `${d.id} ${s}`).toContain(s);
      for (const s of slots) if (d.assignments[s] === undefined) expect(pos(s), `${d.id} ${s}`).toBe("DL");
    }
  });
  it("the resolver gives each on-field slot once, with the listed library id", () => {
    const pb = parse(files());
    const check = (d: OffenseDesign | DefenseDesign, slots: string[], got: { slot: string; use: string }[]) => {
      expect(got.map((g) => g.slot).sort(), d.id).toEqual([...slots].sort());
      for (const g of got) {
        const v = d.assignments[g.slot];
        if (v !== undefined) expect(g.use, `${d.id} ${g.slot}`).toBe(ref(v).use);
      }
    };
    for (const d of pb.offense.designs) {
      const slots = onField(personnel.offense[d.formation] as Record<string, number>);
      check(d, slots, resolveOffense(d, pb, slots));
    }
    for (const d of pb.defense.designs) {
      const slots = onField(personnel.packages[d.package] as Record<string, number>);
      check(d, slots, resolveDefense(d, pb, slots));
    }
  });
  it("every slot of every formation and package has an alignment inside the field (R8: 160 feet, in yards)", () => {
    for (const [group, sides] of [[personnel.offense, F.alignments.offense], [personnel.packages, F.alignments.defense]] as const)
      for (const [name, counts] of Object.entries(group)) {
        const a = sides[name] as Record<string, Pair>;
        expect(Object.keys(a).sort(), name).toEqual(onField(counts).sort());
        for (const [s, p] of Object.entries(a)) expect(Math.abs(p[0]) < widthYardsOf(F) / 2 && p[1] >= 0, `${name} ${s}`).toBe(true);
      }
  });
});

describe("A4: offense legality", () => {
  it("linemen only block", () => {
    for (const d of off) {
      if (d.line !== undefined) expect(entryOf(F, d.line).kind, d.id).toBe("block");
      for (const [s, v] of Object.entries(d.assignments)) if (pos(s) === "OL") expect(entryOf(F, v).kind, `${d.id} ${s}`).toBe("block");
    }
    for (const [c, k] of Object.entries(F.config.concepts)) for (const id of Object.values(k.line)) expect(F.library.assignments[id]?.kind, c).toBe("block");
  });
  it("kinds match positions: routes for WR, TE, RB; blocks for OL, RB, TE, WR; qb for QB", () => {
    for (const d of off)
      for (const [s, v] of Object.entries(d.assignments)) {
        const k = entryOf(F, v).kind;
        if (k === "route") expect(["WR", "TE", "RB"], `${d.id} ${s}`).toContain(pos(s));
        if (k === "qb") expect(pos(s), `${d.id} ${s}`).toBe("QB");
        expect(["route", "block", "runPath", "qb"], `${d.id} ${s}`).toContain(k);
      }
  });
  it("a run has exactly one carrier, an RB or the QB, who has the only run path, inside the concept's gaps", () => {
    for (const d of off.filter(isRun)) {
      const runners = Object.entries(d.assignments).filter(([, v]) => entryOf(F, v).kind === "runPath");
      expect(runners.map(([s]) => s), d.id).toEqual([d.carrier]);
      expect(["RB", "QB"], d.id).toContain(pos(d.carrier as string));
      const e = entryOf(F, (runners[0] as [string, string])[1]);
      const gaps = d.concept === "insideRun" ? ["A", "B"] : d.concept === "outsideRun" ? ["C", "edge"] : ["A"];
      if (e.kind === "runPath") expect(gaps, d.id).toContain(e.gap);
    }
  });
  it("a QB sneak, and every run from Empty, is carried by the quarterback", () => {
    for (const d of off.filter(isRun)) if (d.concept === "qbSneak" || d.formation === "empty") expect(d.carrier, d.id).toBe("QB1");
  });
  it("a pass has a QB action, at least one route, no carrier and no run path, and one first read that runs a route", () => {
    for (const d of off.filter((x) => !isRun(x))) {
      const es = Object.entries(d.assignments).map(([s, v]) => ({ s, e: entryOf(F, v), r: ref(v) }));
      expect(es.filter((x) => x.e.kind === "qb").map((x) => x.s), d.id).toEqual(["QB1"]);
      expect(es.some((x) => x.e.kind === "route"), d.id).toBe(true);
      expect(d.carrier, d.id).toBeUndefined();
      expect(es.some((x) => x.e.kind === "runPath"), d.id).toBe(false);
      const primary = es.filter((x) => x.r.primary === true);
      expect(primary.length, d.id).toBe(1);
      expect(primary[0]?.e.kind, d.id).toBe("route");
    }
  });
  it("a screen has a route that ends at or behind the line", () => {
    for (const d of off.filter((x) => x.concept === "screenPass")) {
      const ends = Object.entries(d.assignments).flatMap(([s, v]) => {
        const e = entryOf(F, v);
        if (e.kind !== "route") return [];
        const align = (F.alignments.offense[d.formation] as Record<string, Pair>)[s] as Pair;
        return [(drawnFrom(e, align, ref(v), e.breakAt).at(-1) as [number, number])[1] - align[1]];
      });
      expect(ends.some((y) => y <= 0), d.id).toBe(true);
    }
  });
  it("play action has a fake, and nothing else does", () => {
    for (const d of off) {
      const qb = entryOf(F, d.assignments["QB1"] as string);
      const fakes = qb.kind === "qb" && qb.fake;
      expect(fakes, d.id).toBe(d.concept === "playAction");
    }
  });
  it("Empty has no back and Heavy no wide receiver in any assignment", () => {
    for (const d of off) {
      if (d.formation === "empty") expect(Object.keys(d.assignments).some((s) => pos(s) === "RB"), d.id).toBe(false);
      if (d.formation === "heavy") expect(Object.keys(d.assignments).some((s) => pos(s) === "WR"), d.id).toBe(false);
    }
  });
});

/** Receiver spots by the manRoles note: receivers and tight ends from the sideline in, B the back. */
function spotsOf(formation: string): string[] {
  const a = F.alignments.offense[formation] as Record<string, Pair>;
  const out: string[] = [];
  for (const [tag, s] of [["L", -1], ["R", 1]] as const) {
    const n = Object.entries(a).filter(([k, p]) => ["WR", "TE"].includes(pos(k)) && p[0] * s > 0).length;
    for (let i = 1; i <= n; i++) out.push(`${tag}${i}`);
  }
  if (a["RB1"] !== undefined) out.push("B");
  return out;
}

describe("A5: defense designs stay inside their preset", () => {
  for (const d of def) {
    it(d.id, () => {
      const preset = caller.defenseMapping.presets[d.coverage] as { box: string; shell: string; manZone: string; rush: string };
      const es = defEntries(F, d);
      const rushers = es.filter((x) => ["rush", "blitz", "stunt"].includes(x.entry.kind)).length;
      if (preset.rush === "le4") expect(rushers).toBeLessThanOrEqual(4);
      if (preset.rush === "ge5") expect(rushers).toBeGreaterThanOrEqual(5);
      if (preset.rush === "ge6") expect(rushers).toBeGreaterThanOrEqual(6);
      const deep = es.filter((x) => x.entry.kind === "zone" && x.entry.level === "deep").length;
      const exact: Record<string, number> = { cover0: 0, cover1: 1, cover2: 2, twoMan: 2, cover3: 3 };
      if (preset.shell in exact) expect(deep).toBe(exact[preset.shell]);
      // Cover 4 is four deep, but the caller maps quarter-quarter-half (Cover 6) to cover4: two quarters and a half.
      if (preset.shell === "cover4") expect(deep).toBe(d.label === "Quarter Quarter Half" ? 3 : 4);
      const men = es.filter((x) => x.entry.kind === "man");
      if (preset.manZone === "zone") expect(men).toHaveLength(0);
      if (preset.manZone === "man") expect(men.length).toBeGreaterThan(0);
      if (men.length > 0) {
        for (const f of FORMATIONS) {
          const spots = spotsOf(f);
          const covered = new Set(men.map((m) => (m.entry.kind === "man" ? m.entry.covers.find((r) => spots.includes(r)) : undefined)));
          for (const s of spots) expect([...covered], `${f} ${s}`).toContain(s);
        }
      }
      if (preset.box !== "any") {
        const a = defAlign(F, d);
        const box = Object.values(a).filter((p) => Math.abs(p[0]) <= F.config.box.halfWidthYards && p[1] <= F.config.box.maxDepthYards).length;
        if (preset.box === "heavy") expect(box).toBeGreaterThanOrEqual(8);
        if (preset.box === "light") expect(box).toBeLessThan(8);
      }
    });
  }
  it("an exchange is a lineman dropping while someone else rushes, still four rushers", () => {
    const ex = def.filter((d) => d.label.includes("Exchange"));
    expect(ex).toHaveLength(2);
    for (const d of ex) {
      const es = defEntries(F, d);
      const rush = (k: string) => ["rush", "blitz", "stunt"].includes(k);
      expect(es.filter((x) => rush(x.entry.kind)), d.id).toHaveLength(4);
      expect(es.some((x) => pos(x.slot) === "DL" && !rush(x.entry.kind)), d.id).toBe(true);
      expect(es.some((x) => pos(x.slot) === "LB" && x.entry.kind === "blitz"), d.id).toBe(true);
      expect(d.tags.pressure, d.id).toBe("exchange");
    }
  });
  it("labels mean what they say: spies spy, twists stunt in pairs, Drop Eight rushes three", () => {
    for (const d of def) {
      const es = defEntries(F, d);
      if (d.label.endsWith("Spy")) expect(es.some((x) => x.entry.kind === "spy"), d.id).toBe(true);
      if (d.label.endsWith("Twist")) expect(es.filter((x) => x.entry.kind === "stunt").length, d.id).toBeGreaterThanOrEqual(2);
      if (d.label.endsWith("Pinch")) expect(Object.values(d.assignments).filter((v) => ref(v).use === "rush.pinch").length, d.id).toBeGreaterThanOrEqual(2);
      if (d.label === "Drop Eight") expect(es.filter((x) => x.entry.kind === "rush"), d.id).toHaveLength(3);
      for (const x of es) if (x.entry.kind === "stunt") expect(pos(x.slot), `${d.id} ${x.slot}`).toBe("DL");
    }
  });
  it("designs with five or more rushers are tagged blitz behind a four-man front, four or fewer never are", () => {
    for (const d of def) {
      const es = defEntries(F, d);
      const rushers = es.filter((x) => ["rush", "blitz", "stunt"].includes(x.entry.kind)).length;
      if (rushers < 5) expect(d.tags.pressure, d.id).not.toBe("blitz");
      if (rushers >= 5 && es.some((x) => x.entry.kind === "blitz")) expect(d.tags.pressure, d.id).toBe("blitz");
    }
  });
});

describe("A6: groups hold at most 6", () => {
  it("no offense or preset group is larger than 5 in the catalog as listed", () => {
    for (const f of FORMATIONS) for (const c of Object.keys(OFFENSE)) expect(off.filter((d) => d.formation === f && d.concept === c).length).toBeLessThanOrEqual(5);
    for (const p of Object.keys(DEFENSE)) expect(def.filter((d) => d.coverage === p).length).toBeLessThanOrEqual(5);
  });
  const grow = (f: Files, side: "offense" | "defense", to: number): Files => {
    const list = f[side].designs as (OffenseDesign | DefenseDesign)[];
    const inGroup = (d: OffenseDesign | DefenseDesign) => ("formation" in d ? d.formation === "shotgun" && d.concept === "shortPass" : d.coverage === "nickelCover3");
    const base = list.find((d) => inGroup(d) && !d.default) as OffenseDesign | DefenseDesign;
    for (let n = list.filter(inGroup).length; n < to; n++) list.push({ ...structuredClone(base), id: `${base.id}X${n}`, label: `${base.label} X${n}` } as OffenseDesign & DefenseDesign);
    return f;
  };
  for (const side of ["offense", "defense"] as const) {
    it(`${side}: a 6-design group passes and a 7-design group is rejected`, () => {
      expect(() => parse(grow(files(), side, 6))).not.toThrow();
      expect(() => parse(grow(files(), side, 7))).toThrow();
    });
  }
});

describe("A1 to A5: bad fixtures are rejected", () => {
  it("the shipped files pass, so each rejection below is caused by its one change", () => {
    expect(() => parse(files())).not.toThrow();
  });
  type M = Record<string, unknown>;
  const O = (f: Files, id: string) => f.offense.designs.find((d) => d.id === id) as unknown as M & { assignments: M; tags: M };
  const D = (f: Files, label: string, cov: string) => f.defense.designs.find((d) => d.label === label && d.coverage === cov) as unknown as M & { assignments: M; tags: M };
  const slant = "shotgun.shortPass.slantFlat";
  const cases: [string, (f: Files) => void][] = [
    ["A1 unknown offense slot", (f) => { O(f, slant).assignments["WR4"] = "route.go"; }],
    ["A1 unknown defense slot", (f) => { D(f, "Cover 3 Sky", "baseCover3").assignments["LB4"] = "spy.qb"; }],
    ["A1 unknown library id", (f) => { O(f, slant).assignments["WR1"] = "route.nope"; }],
    ["A1 a library id that is an Object.prototype name", (f) => { O(f, slant).assignments["WR1"] = "constructor"; }],
    ["A1 unknown concept", (f) => { O(f, "shotgun.shortPass.mesh")["concept"] = "hailMary"; }],
    ["A1 unknown formation", (f) => { O(f, "shotgun.shortPass.mesh")["formation"] = "wishbone"; }],
    ["A1 unknown preset", (f) => { D(f, "Cover 3 Buzz", "baseCover3")["coverage"] = "cover9"; }],
    ["A1 a concept that is an Object.prototype name", (f) => { O(f, "shotgun.shortPass.mesh")["concept"] = "constructor"; }],
    ["A1 a preset that is an Object.prototype name", (f) => { D(f, "Cover 3 Buzz", "baseCover3")["coverage"] = "constructor"; }],
    ["A1 missing offense assignment", (f) => { delete O(f, slant).assignments["WR2"]; }],
    ["A1 missing defense assignment", (f) => { delete D(f, "Cover 3 Sky", "baseCover3").assignments["S1"]; }],
    ["A1 duplicate offense id", (f) => { O(f, "shotgun.shortPass.mesh")["id"] = slant; }],
    ["A1 duplicate id across the two files", (f) => { D(f, "Cover 3 Buzz", "baseCover3")["id"] = slant; }],
    ["A1 unknown route family", (f) => { (f.library.assignments["route.go"] as unknown as M)["family"] = "streak"; }],
    ["A2 wrong package for the preset", (f) => { D(f, "Cover 3 Buzz", "baseCover3")["package"] = "nickel"; }],
    ["A2 two defaults", (f) => { O(f, "shotgun.shortPass.mesh")["default"] = true; }],
    ["A2 no default", (f) => { f.offense.designs.forEach((d) => { if (d.formation === "shotgun" && d.concept === "deepPass") (d as unknown as M)["default"] = false; }); }],
    ["A2 no defense default", (f) => { f.defense.designs.forEach((d) => { if (d.coverage === "prevent") (d as unknown as M)["default"] = false; }); }],
    ["A2 an engine call with no design", (f) => { f.offense.designs = f.offense.designs.filter((d) => !(d.formation === "empty" && d.concept === "playAction")); }],
    ["A2 a preset with no design", (f) => { f.defense.designs = f.defense.designs.filter((d) => d.coverage !== "goalLine"); }],
    ["A4 a lineman on a route", (f) => { O(f, slant).assignments["OL5"] = "route.go"; }],
    ["A4 a run whose carrier has no run path", (f) => { O(f, "shotgun.insideRun.insideZone").assignments["RB1"] = "block.protectEdge"; }],
    ["A4 a run carried by a receiver", (f) => { const d = O(f, "shotgun.insideRun.insideZone"); d["carrier"] = "WR1"; d.assignments["WR1"] = d.assignments["RB1"]; d.assignments["RB1"] = "block.protectEdge"; }],
    ["A4 a run with two run paths", (f) => { O(f, "shotgun.insideRun.insideZone").assignments["QB1"] = "run.dive"; }],
    ["A4 a run with no carrier", (f) => { delete O(f, "shotgun.insideRun.insideZone")["carrier"]; }],
    ["A4 an inside run through the edge", (f) => { O(f, "shotgun.insideRun.insideZone").assignments["RB1"] = { use: "run.stretch", to: "right" }; }],
    ["A4 a pass with no QB action", (f) => { O(f, slant).assignments["QB1"] = "block.pass"; }],
    ["A4 a pass whose QB hands off", (f) => { O(f, slant).assignments["QB1"] = { use: "qb.handoff", to: "left" }; }],
    ["A4 a pass with no routes", (f) => { const d = O(f, slant); for (const s of Object.keys(d.assignments)) if (s !== "QB1") d.assignments[s] = "block.protectEdge"; }],
    ["A4 a screen with nothing behind the line", (f) => { O(f, "shotgun.screenPass.backScreen").assignments["RB1"] = { use: "back.seam", to: "left", primary: true }; }],
    // R15: judged by where the route ends, never by its declared family.
    ["A4 a screen whose only behind-line route is moved downfield by depth", (f) => { O(f, "shotgun.screenPass.backScreen").assignments["RB1"] = { use: "back.screen", to: "left", depth: 12, primary: true }; }],
    ["A4 play action without a fake", (f) => { O(f, "shotgun.playAction.paPost").assignments["QB1"] = { use: "qb.drop", to: "left" }; }],
    ["A5 a fifth rusher behind a four-rush preset", (f) => { D(f, "Cover 3 Sky", "baseCover3").assignments["LB2"] = "blitz.inside"; }],
    ["A5 four rushers behind a five-rush preset", (f) => { const d = D(f, "Middle Blitz", "nickelCover1Blitz"); for (const [s, v] of Object.entries(d.assignments)) if (ref(v as string).use.startsWith("blitz.")) d.assignments[s] = "spy.qb"; }],
    ["A5 a second deep safety in Cover 1", (f) => { const d = D(f, "Cover 1 Spy", "nickelCover1"); d.assignments["LB1"] = { use: "zone.deep.left", at: [-12, 16] }; }],
    ["A5 man coverage in a zone preset", (f) => { D(f, "Cover 3 Sky", "baseCover3").assignments["LB1"] = "man.L2"; }],
    ["A5 a man design that leaves a receiver open", (f) => { const d = D(f, "2-Man", "nickel2Man"); for (const [s, v] of Object.entries(d.assignments)) if (ref(v as string).use === "man.L1") d.assignments[s] = "man.R1"; }],
    ["A5 a run-stuff design without eight in the box", (f) => { const d = D(f, "Eight in the Box", "runStuff"); d["alignment"] = { LB1: [-15, 9], LB2: [0, 9], LB3: [15, 9] }; }],
    ["A8 an unknown situation tag", (f) => { O(f, slant).tags["situations"] = ["hurryUp"]; }],
    ["A8 a pass without a depth tag", (f) => { delete O(f, slant).tags["depth"]; }],
    ["A8 a run with a depth tag", (f) => { O(f, "shotgun.insideRun.insideZone").tags["depth"] = "short"; }],
    ["A8 a missing timing tag", (f) => { delete O(f, slant).tags["timing"]; }],
    ["A8 a defense design without pressure", (f) => { delete D(f, "Cover 3 Sky", "baseCover3").tags["pressure"]; }],
    ["A8 a run trait on a pass", (f) => { O(f, slant)["traits"] = ["wedge"]; }],
  ];
  for (const [name, breakIt] of cases) {
    it(name, () => {
      const f = files();
      breakIt(f);
      expect(() => parse(f)).toThrow();
    });
  }
});

describe("A8: tags", () => {
  const SITUATIONS = ["shortYardage", "redZone", "goalLine", "twoMinute", "longYardage", "backedUp", "runClock"];
  it("every design has every tag from the closed lists, depth on passes only, pressure on defense only", () => {
    for (const d of [...off, ...def]) {
      expect(["quick", "standard", "slow"], d.id).toContain(d.tags.timing);
      for (const s of d.tags.situations) expect(SITUATIONS, d.id).toContain(s);
      expect(new Set(d.tags.situations).size, d.id).toBe(d.tags.situations.length);
      expect(d.description.trim().length, d.id).toBeGreaterThan(0);
      expect(d.description, d.id).not.toContain("\n");
    }
    for (const d of off) {
      if (isRun(d)) expect("depth" in d.tags, d.id).toBe(false);
      else expect(["behind", "short", "intermediate", "deep"], d.id).toContain(d.tags.depth);
      expect("pressure" in d.tags, d.id).toBe(false);
    }
    for (const d of def) expect(["none", "exchange", "blitz"], d.id).toContain(d.tags.pressure);
  });
  it("the trait lists are the spec's and authored traits stay in their list", () => {
    expect([...PASS_TRAITS].sort()).toEqual(names("quick, crossers, highLow, flood, verticals, levels, isolation, screenBack, screenWide, boot").sort());
    expect([...RUN_TRAITS].sort()).toEqual(names("zone, gap, misdirection, perimeter, lead, wedge").sort());
    expect([...DEFENSE_TRAITS].sort()).toEqual(names("singleHigh, twoHigh, fourDeep, noDeep, man, zone, pressure, overload, exchange, stunt, spy, press, robber, bracket, loadedBox, lightBox, pinch").sort());
    for (const d of off) for (const t of d.traits) expect(isRun(d) ? RUN_TRAITS : PASS_TRAITS, d.id).toContain(t);
    for (const d of def) for (const t of d.traits) expect(DEFENSE_TRAITS, d.id).toContain(t);
  });
  // Edges by hand from data/caller/config.json: dist3 1-3, zone3 RZ 1-20, zone6 GL 1-5 and BACK
  // 90-99, dist5 11+, time5 H1F/GF 120, lateTime G5 300, score3 L from +1.
  const base: Situation = { phase: "scrimmage", down: 1, yardsToGo: 7, yardLine100: 60, scoreDiff: 0, quarter: 2, secondsLeftInHalf: 600, secondsLeftInGame: 2400, offenseTimeouts: 3, defenseTimeouts: 3, clockRunning: 1, otBothPossessed: 0 };
  const rows: [SituationTag, Partial<Situation>, boolean][] = [
    ["shortYardage", { yardsToGo: 1 }, true],
    ["shortYardage", { yardsToGo: 3 }, true],
    ["shortYardage", { yardsToGo: 4 }, false],
    ["longYardage", { yardsToGo: 11 }, true],
    ["longYardage", { yardsToGo: 10 }, false],
    ["redZone", { yardLine100: 20 }, true],
    ["redZone", { yardLine100: 21 }, false],
    ["redZone", { yardLine100: 1 }, true],
    ["goalLine", { yardLine100: 5 }, true],
    ["goalLine", { yardLine100: 6 }, false],
    ["goalLine", { yardLine100: 2, phase: "try" }, true],
    ["backedUp", { yardLine100: 90 }, true],
    ["backedUp", { yardLine100: 89 }, false],
    ["backedUp", { yardLine100: 99 }, true],
    ["twoMinute", { secondsLeftInHalf: 120, secondsLeftInGame: 1920 }, true],
    ["twoMinute", { secondsLeftInHalf: 121, secondsLeftInGame: 1921 }, false],
    ["twoMinute", { quarter: 4, secondsLeftInHalf: 120, secondsLeftInGame: 120 }, true],
    ["twoMinute", { quarter: 4, secondsLeftInHalf: 121, secondsLeftInGame: 121 }, false],
    ["twoMinute", { phase: "try", secondsLeftInHalf: 30 }, false],
    ["runClock", { quarter: 4, secondsLeftInHalf: 300, secondsLeftInGame: 300, scoreDiff: 1 }, true],
    ["runClock", { quarter: 4, secondsLeftInHalf: 301, secondsLeftInGame: 301, scoreDiff: 1 }, false],
    ["runClock", { quarter: 4, secondsLeftInHalf: 300, secondsLeftInGame: 300, scoreDiff: 0 }, false],
    ["runClock", { quarter: 4, secondsLeftInHalf: 10, secondsLeftInGame: 10, scoreDiff: 21 }, true],
    ["runClock", { quarter: 2, secondsLeftInHalf: 200, secondsLeftInGame: 2000, scoreDiff: 7 }, false],
  ];
  for (const [tag, change, want] of rows) it(`tagApplies ${tag} ${JSON.stringify(change)} is ${want}`, () => expect(tagApplies(tag, { ...base, ...change }, F.config)).toBe(want));
  it("the edges are the caller's bins", () => {
    const dims = json<{ dimensions: Record<string, { buckets: { label: string; min: number | null; max: number | null }[] }> }>("data/caller/config.json").dimensions;
    const b = (d: string, l: string) => dims[d]?.buckets.find((x) => x.label === l);
    expect([b("dist3", "1-3")?.max, b("dist5", "11+")?.min, b("zone3", "RZ")?.max, b("zone6", "GL")?.max, b("zone6", "BACK")?.min, b("time5", "H1F")?.max, b("lateTime", "G5")?.max, b("score3", "L")?.min]).toEqual([3, 11, 20, 5, 90, 120, 300, 1]);
  });
});

describe("A9 and A10: alignments and the doc", () => {
  it("alignments.json deep-equals the three template blocks", () => {
    const t = json<Record<string, unknown>>("data/ui/templates.json");
    expect(F.alignments.offense).toEqual(t["offense"]);
    expect(F.alignments.defense).toEqual(t["defense"]);
    expect(F.alignments.presetAlignment).toEqual(t["presetAlignment"]);
  });
  it("docs/PLAYBOOK.md lists every design once, with its description and tags", () => {
    const lines = text("docs/PLAYBOOK.md").split("\n");
    for (const d of [...off, ...def]) {
      const mine = lines.filter((l) => l.includes(`\`${d.id}\``));
      expect(mine, d.id).toHaveLength(1);
      const l = mine[0] as string;
      for (const part of [d.label, d.description, d.tags.timing, ...d.tags.situations, ...d.traits]) expect(l, d.id).toContain(part);
      if ("depth" in d.tags && d.tags.depth !== undefined) expect(l, d.id).toContain(d.tags.depth);
      if ("pressure" in d.tags) expect(l, d.id).toContain(`pressure ${d.tags.pressure}`);
    }
  });
  it("docs/PLAYBOOK.md lists no design that does not exist", () => {
    const ids = new Set([...off, ...def].map((d) => d.id));
    for (const m of text("docs/PLAYBOOK.md").matchAll(/^- \*\*.*?\*\* \(`([^`]+)`\)/gm)) expect(ids.has(m[1] as string), m[1]).toBe(true);
  });
});
