// The lead's rulings of 2026-11-24 that are about the data (R5 to R10 and R15 at the top of
// docs/specs/m3-playbook-and-custom-routes.md), from the rulings' words, with geometry of this file's
// and spec-support.ts's own.

import { describe, expect, it } from "vitest";
import { formationRoles, holeOf, manAgainst, placePath, resolveOffense } from "../src/playbook";
import type { OffenseDesign, Pair, Playbook } from "../src/playbook";
import { parsePlaybook } from "../src/playbook-schema";
import { caller, defEntries, files, holeBy, json, onField, personnel, pos, ref, refs, runnerTrack, text, widthYardsOf } from "./spec-support";
import type { Files } from "./spec-support";

const F = files();
const parse = (f: unknown) => parsePlaybook(f as Parameters<typeof parsePlaybook>[0], refs());
const pb = parse(files());
const FORMATIONS = Object.keys(personnel.offense);
const RUNS = ["insideRun", "outsideRun", "qbSneak"];

describe("R6: lead and pulling blockers end at the hole or ahead of the runner, on his side", () => {
  // Linemen stand 2 yards apart, so within 2 yards of where the runner crosses the line is his hole.
  const NEAR = 2;
  const isMover = (use: string) => /^block\.(lead|pull|trap)/.test(use);
  /** Where each lead or pulling blocker ends, [x from the middle, past the line], as the app will draw him. */
  function movers(book: Playbook, d: OffenseDesign): { slot: string; use: string; end: Pair }[] {
    const design = book.offense.designs.find((x) => x.id === d.id) as OffenseDesign;
    const align = book.alignments.offense[d.formation] as Record<string, Pair>;
    const res = resolveOffense(design, book, onField(personnel.offense[d.formation] as Record<string, number>));
    const hole = holeOf(res, align) ?? undefined;
    return res.flatMap((r) => {
      if (r.entry.kind !== "block" || (!isMover(r.use) && !["lead", "pull"].includes(r.entry.technique))) return [];
      const a = align[r.slot] as Pair;
      const p = placePath(r.entry, a, r.to, r.ref.depth, hole).at(-1) as Pair;
      return [{ slot: r.slot, use: r.use, end: [a[0] + p[0], p[1] - a[1]] as Pair }];
    });
  }
  /** Distance from a point to the part of the runner's track past the line. */
  function offTrack(track: [number, number][], p: Pair): number {
    let best = Infinity;
    for (let i = 1; i < track.length; i++) {
      const [a, b] = [track[i - 1], track[i]] as [[number, number], [number, number]];
      for (let k = 0; k <= 100; k++) {
        const q = [a[0] + ((b[0] - a[0]) * k) / 100, a[1] + ((b[1] - a[1]) * k) / 100] as const;
        if (q[1] >= 0) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
      }
    }
    return best;
  }
  const runs = F.offense.designs.filter((d) => RUNS.includes(d.concept));
  it("the library's lead and pull entries are the ones this test looks at", () => {
    const uses = Object.entries(F.library.assignments).filter(([, e]) => e.kind === "block" && ["lead", "pull"].includes(e.technique)).map(([id]) => id);
    expect(uses.sort()).toEqual(Object.keys(F.library.assignments).filter(isMover).sort());
    expect(uses.length).toBeGreaterThanOrEqual(4);
  });
  let checked = 0;
  for (const d of runs) {
    const listed = [...Object.values(d.assignments), ...(d.line === undefined ? [] : [d.line])].filter((v) => isMover(ref(v).use));
    if (listed.length === 0) continue;
    it(d.id, () => {
      const hole = holeBy(F, d);
      if (hole === null) throw new Error("a lead or puller on a run with no side");
      const all = movers(pb, d);
      expect(all).toHaveLength(listed.length);
      for (const m of all) {
        const atHole = Math.abs(m.end[0] - hole.x) <= NEAR && m.end[1] >= 0 && m.end[1] <= 3;
        const ahead = m.end[1] > 0 && offTrack(runnerTrack(F, d), m.end) <= NEAR;
        expect(atHole || ahead, `${m.slot} ${m.use} ends at ${m.end}, the hole is at ${hole.x}`).toBe(true);
        expect(m.end[0] * hole.out, `${m.slot} ${m.use} is on the runner's side`).toBeGreaterThan(0);
        checked++;
      }
    });
  }
  it("the hole is where the runner's track crosses the line, on every run to a side", () => {
    for (const d of runs) {
      const want = holeBy(F, d);
      const design = pb.offense.designs.find((x) => x.id === d.id) as OffenseDesign;
      const got = holeOf(resolveOffense(design, pb, onField(personnel.offense[d.formation] as Record<string, number>)), pb.alignments.offense[d.formation] as Record<string, Pair>);
      if (want === null) expect(got, d.id).toBeNull();
      else {
        expect(got?.x, d.id).toBeCloseTo(want.x, 9);
        expect(got?.sign, d.id).toBe(want.out);
      }
    }
  });
  it("there were some in each: Power, Counter, Trap, Lead, Sweep and Toss everywhere, Off Tackle", () => {
    for (const label of ["Power", "QB Power", "Counter", "Trap", "Lead", "Sweep", "QB Sweep", "Toss", "Off Tackle"]) {
      const ds = runs.filter((d) => d.label === label);
      expect(ds.length, label).toBeGreaterThan(0);
      for (const d of ds) expect(movers(pb, d).length, d.id).toBeGreaterThan(0);
    }
    expect(checked).toBeGreaterThan(15);
  });
  it("from the alignment, not a fixed sideways distance: a blocker lined up elsewhere still ends at the hole", () => {
    for (const [id, slot] of [["shotgun.insideRun.power", "OL4"], ["underCenter.insideRun.lead", "TE2"], ["pistol.outsideRun.sweep", "OL2"], ["heavy.outsideRun.toss", "TE3"], ["underCenter.insideRun.trap", "OL4"]] as const) {
      const d = runs.find((x) => x.id === id) as OffenseDesign;
      const before = movers(pb, d).find((m) => m.slot === slot)?.end as Pair;
      const moved = structuredClone(pb);
      const a = moved.alignments.offense[d.formation] as Record<string, Pair>;
      a[slot] = [(a[slot] as Pair)[0] + (slot.startsWith("TE") ? 3 : 0.5), (a[slot] as Pair)[1] + 1];
      const after = movers(moved, d).find((m) => m.slot === slot)?.end as Pair;
      expect(after[0], id).toBeCloseTo(before[0], 6);
      expect(after[1], id).toBeCloseTo(before[1], 6);
    }
  });
  it("and the hole moves him: Power run 0.75 yards wider takes every pulling guard 0.75 wider", () => {
    const wide = structuredClone(pb);
    const e = wide.library.assignments["run.power"] as unknown as { pts: [number, number][] };
    e.pts = e.pts.map(([x, y]) => [x + 0.75, y]);
    for (const d of runs.filter((x) => ref(x.assignments[x.carrier as string] as string).use === "run.power")) {
      const out = holeBy(F, d)?.out as number;
      const before = movers(pb, d);
      expect(before.length, d.id).toBeGreaterThan(0);
      movers(wide, d).forEach((m, i) => expect(m.end[0] - ((before[i] as { end: Pair }).end[0] as number), d.id).toBeCloseTo(0.75 * out, 6));
    }
  });
});

/** Receiver spots by the manRoles note: receivers and tight ends from the sideline in, B the back. */
function spots(f: Files, formation: string): Record<string, string> {
  const a = f.alignments.offense[formation] as Record<string, Pair>;
  const out: Record<string, string> = {};
  for (const [tag, s] of [["L", -1], ["R", 1]] as const)
    Object.keys(a).filter((k) => ["WR", "TE"].includes(pos(k)) && (a[k] as Pair)[0] * s > 0).sort((x, y) => Math.abs((a[y] as Pair)[0]) - Math.abs((a[x] as Pair)[0])).forEach((k, i) => (out[`${tag}${i + 1}`] = k));
  if (a["RB1"] !== undefined) out["B"] = "RB1";
  return out;
}

describe("R7: every man defender has a real receiver in every formation, or a fallback", () => {
  it("in all 40 designs, and the code agrees who he covers", () => {
    let fallbacks = 0;
    for (const d of F.defense.designs)
      for (const { slot, entry } of defEntries(F, d)) {
        if (entry.kind !== "man") continue;
        for (const form of FORMATIONS) {
          const there = spots(F, form);
          const role = entry.covers.find((r) => there[r] !== undefined);
          const got = manAgainst(entry, formationRoles(pb.alignments.offense[form] as Record<string, Pair>, pb.config.positions));
          if (role !== undefined) expect(got, `${d.id} ${slot} ${form}`).toEqual({ role, covers: there[role] });
          else {
            const fb = entry.fallback;
            expect(fb, `${d.id} ${slot} against ${form}`).toBeDefined();
            expect(["rush", "spy", "zone"]).toContain(F.library.assignments[fb?.use as string]?.kind);
            expect(got).toEqual({ fallback: fb });
            fallbacks++;
          }
        }
      }
    // Heavy has one receiver on the left, so a man on the second one there always needs it.
    expect(fallbacks).toBeGreaterThan(0);
  });
  it("without its fallback the same man is refused", () => {
    const f = files();
    delete (f.library.assignments["man.L2"] as unknown as Record<string, unknown>)["fallback"];
    expect(() => parse(f)).toThrow(/L2/);
  });
  it("a fallback that is not a rush, a spy or a zone is refused", () => {
    const f = files();
    (f.library.assignments["man.L2"] as unknown as Record<string, unknown>)["fallback"] = { use: "man.L1" };
    expect(() => parse(f)).toThrow();
  });
});

describe("R8: the field and eligibility", () => {
  it("the width is stored as 160 feet, yards are derived, and both statuses are confirmed", () => {
    const raw = json<{ field: Record<string, unknown>; eligibility: Record<string, unknown> }>("data/plays/config.json");
    expect(raw.field["widthFeet"]).toBe(160);
    expect("widthYards" in raw.field).toBe(false);
    expect(raw.field["status"]).toBe("confirmed");
    expect(raw.eligibility["status"]).toBe("confirmed");
    expect(pb.config.field.widthYards).toBeCloseTo(160 / 3, 9);
    expect(widthYardsOf(F)).toBeCloseTo(53.3333333, 6);
  });
  it("yards follow the feet", () => {
    const f = files();
    (f.config.field as unknown as Record<string, unknown>)["widthFeet"] = 156;
    expect(parse(f).config.field.widthYards).toBeCloseTo(52, 9);
  });
  it("barring the quarterback is labeled a designed restriction, stricter than the rule", () => {
    const note = json<{ eligibility: { note: string; neverDrawn: string[] } }>("data/plays/config.json").eligibility;
    expect(note.neverDrawn).toContain("QB");
    expect(note.note).toMatch(/designed/i);
    expect(note.note).toMatch(/stricter than the rule/i);
  });
  // docs/RULES.md still gave the old 53.3 and "stays unconfirmed" earlier on 2026-11-24.
  it("docs/RULES.md says what the data says", () => {
    const doc = text("docs/RULES.md");
    for (const h of ["Field dimensions", "Eligible pass receivers"]) {
      const section = (doc.split(`## ${h}\n`)[1] as string).split("\n## ")[0] as string;
      expect(section, h).not.toMatch(/stays unconfirmed/);
      expect(section, h).not.toMatch(/field\.widthYards` is 53\.3/);
    }
  });
});

describe("R9: own keys only, in the files", () => {
  for (const k of ["constructor", "toString", "hasOwnProperty", "valueOf"]) {
    const bad: [string, (f: Files) => void][] = [
      ["a slot on offense", (f) => void ((f.offense.designs[0] as unknown as { assignments: Record<string, string> }).assignments[k] = "route.go")],
      ["a slot on defense", (f) => void ((f.defense.designs[0] as unknown as { assignments: Record<string, string> }).assignments[k] = "spy.qb")],
      ["a library id on defense", (f) => void ((f.defense.designs[0] as unknown as { assignments: Record<string, string> }).assignments["LB1"] = k)],
      ["a formation", (f) => void ((f.offense.designs[3] as unknown as Record<string, unknown>)["formation"] = k)],
      ["a package", (f) => void ((f.defense.designs[1] as unknown as Record<string, unknown>)["package"] = k)],
      ["a line block", (f) => void ((f.offense.designs[1] as unknown as Record<string, unknown>)["line"] = k)],
      ["a run carrier", (f) => void ((f.offense.designs[0] as unknown as Record<string, unknown>)["carrier"] = k)],
      ["a situation tag", (f) => void ((f.offense.designs[0] as unknown as { tags: Record<string, unknown> }).tags["situations"] = [k])],
      ["an alignment slot", (f) => void ((f.alignments.offense["shotgun"] as Record<string, Pair>)[k] = [0, 3])],
      ["an alignment formation", (f) => void (f.alignments.offense[k] = {})],
      ["a preset alignment", (f) => void (f.alignments.presetAlignment[k] = {})],
      ["a stunt partner", (f) => void ((f.defense.designs.find((d) => d.id === "baseCover3.twist") as unknown as { assignments: Record<string, unknown> }).assignments["DL2"] = { use: "stunt.crash", with: k })],
      ["a man fallback", (f) => void ((f.library.assignments["man.L2"] as unknown as Record<string, unknown>)["fallback"] = { use: k })],
    ];
    for (const [name, breakIt] of bad)
      it(`"${k}" as ${name} is refused`, () => {
        const f = files();
        breakIt(f);
        // Refused with a reason, not a crash on an inherited member.
        let error: unknown;
        try {
          parse(f);
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(TypeError);
      });
  }
});

describe("R5: the defaults that leave today's diagram are listed, each with a reason", () => {
  const listed = json<{ defaultDeviations: Record<string, string> }>("data/plays/config.json").defaultDeviations;
  it("each names a real engine call and gives one line", () => {
    for (const [call, why] of Object.entries(listed)) {
      const [form, concept] = call.split(".") as [string, string | undefined];
      if (concept === undefined) expect(Object.keys(caller.defenseMapping.presets), call).toContain(form);
      else expect(F.offense.designs.some((d) => d.formation === form && d.concept === concept), call).toBe(true);
      expect(why.trim().length, call).toBeGreaterThan(10);
      expect(why, call).not.toContain("\n");
    }
  });
  it("Back Screens, Empty Bubble and the inside runs of the four formations with a back are today's", () => {
    for (const form of ["shotgun", "underCenter", "pistol", "heavy"]) {
      expect(`${form}.screenPass` in listed, form).toBe(false);
      expect(`${form}.insideRun` in listed, form).toBe(false);
    }
    expect("empty.screenPass" in listed).toBe(false);
  });
});

describe("R15: the file check judges a screen by where its route ends", () => {
  const set = (f: Files, v: unknown) => void ((f.offense.designs.find((d) => d.id === "shotgun.screenPass.backScreen") as unknown as { assignments: Record<string, unknown> }).assignments["RB1"] = v);
  // RB1 is 5 deep. back.screen breaks at 0.5 and ends at -0.5, so a depth of 1 ends on the line.
  it("ending on the line is a screen, half a yard past it is not", () => {
    const on = files();
    set(on, { use: "back.screen", to: "left", depth: 1, primary: true });
    expect(() => parse(on)).not.toThrow(/screen's primary|behind the line/);
    const past = files();
    set(past, { use: "back.screen", to: "left", depth: 1.5, primary: true });
    expect(() => parse(past)).toThrow(/behind the line/);
  });
  it("a primary declared screen on a path that ends downfield is refused", () => {
    const f = files();
    (f.library.assignments["back.screen"] as unknown as { pts: unknown }).pts = [[1, 0.5], [5, 9]];
    expect(() => parse(f)).toThrow(/behind the line/);
  });
});

describe("R19: declared fields are checked against the paths, as listed issues", () => {
  const shown = (f: Files): string => {
    try {
      parse(f);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      return (e as Error).message;
    }
    return "accepted";
  };
  /** Every issue is a line under the check's heading, and one of them names the entry. */
  const listed = (f: Files, names: RegExp, what: string) => {
    const m = shown(f);
    expect(m, what).toMatch(/^data\/plays failed its check:\n/);
    expect(m, what).toMatch(names);
  };
  const lib = (f: Files, id: string) => f.library.assignments[id] as unknown as Record<string, unknown>;
  const esc = (id: string) => new RegExp(id.replace(/\./g, "\\."));
  const used = new Set([...F.offense.designs, ...F.defense.designs].flatMap((d) => Object.values(d.assignments).map((v) => ref(v).use)));
  for (const c of Object.values(F.config.concepts)) for (const id of Object.values(c.line)) used.add(id);
  for (const id of Object.values(F.config.defenseDefaults)) used.add(id);
  const flips: [string, string, unknown][] = [];
  for (const [id, e] of Object.entries(F.library.assignments)) {
    if (!used.has(id)) continue;
    if (e.kind === "runPath") {
      for (const g of ["A", "B", "C", "edge"]) if (g !== e.gap) flips.push([id, "gap", g]);
      flips.push([id, "counter", !e.counter]);
    }
    if (e.kind === "rush" || e.kind === "blitz" || e.kind === "stunt") flips.push([id, "lane", e.lane === "edge" ? "inside" : "edge"]);
    if (e.kind === "route") for (const fam of F.config.families) if (fam !== e.family) flips.push([id, "family", fam]);
  }
  it("every wrong gap, lane, family and counter flag, one at a time", () => {
    expect(flips.length).toBeGreaterThan(400);
    const accepted: string[] = [];
    for (const [id, key, value] of flips) {
      const f = files();
      lib(f, id)[key] = value;
      const m = shown(f);
      if (!m.startsWith("data/plays failed its check:") || !esc(id).test(m)) accepted.push(`${id} ${key} ${String(value)}: ${m.slice(0, 80)}`);
    }
    expect(accepted).toEqual([]);
  }, 60_000);
  it("the misdirection flag on a line that shows no pass set, and off one that does", () => {
    const on = files();
    lib(on, "block.base")["technique"] = "draw";
    listed(on, /block\.base/, "base block called a draw set");
    const none = files();
    lib(none, "block.drawSet")["pts"] = [[0, 0.5]];
    listed(none, /block\.drawSet/, "draw set with no set");
  });
  const O = (f: Files, id: string) => f.offense.designs.find((d) => d.id === id) as unknown as { assignments: Record<string, unknown> };
  const D = (f: Files, id: string) => f.defense.designs.find((d) => d.id === id) as unknown as { assignments: Record<string, unknown> };
  const cases: [string, RegExp, (f: Files) => void][] = [
    ["a landmark past the sideline", /S2/, (f) => void (D(f, "baseCover3.sky").assignments["S2"] = { use: "zone.under.right", at: [27, 6] })],
    ["a landmark on the offense's side of the line", /LB1/, (f) => void (D(f, "nickelCover2.cover2").assignments["LB1"] = { use: "zone.under.middle", at: [-7, -1] })],
    ["a landmark 120 yards deep", /S2/, (f) => void (D(f, "prevent.prevent").assignments["S2"] = { use: "zone.deep.middle", at: [0, 120] })],
    ["a route past the sideline", /WR2/, (f) => void (lib(f, "route.fade")["pts"] = [[-2, 3], [-6.5, 26]])],
    ["a route past 60 yards by its depth", /WR1/, (f) => void (O(f, "shotgun.deepPass.fourVerticals").assignments["WR1"] = { use: "route.go", depth: 61 })],
    ["a run path past the sideline", /run\.sweep/, (f) => void (lib(f, "run.sweep")["pts"] = [[8, -3], [13, -1], [28, 3]])],
    ["a block path past the sideline", /block\.stalk/, (f) => void Object.assign(lib(f, "block.stalk"), { axis: "in", pts: [[-8, 3]] })],
    ["a blitz path past the sideline", /blitz\.edge/, (f) => void (lib(f, "blitz.edge")["pts"] = [[-1.5, -2], [-30, -6.5]])],
    // A block has no family to disagree with, so only its length in points can be wrong: 12 and the start.
    ["a path of 13 points with the start", /block\.push\b/, (f) => void (lib(f, "block.push")["pts"] = Array.from({ length: 12 }, (_, k) => [0, (k + 1) / 8]))],
    ["a path of 61 yards inside the field", /route\.mesh/, (f) => void (lib(f, "route.mesh")["pts"] = [[20, 5], [0, 6], [20, 7]])],
    ["breakAt one past the last waypoint", /route\.out\b.*breakAt/, (f) => void (lib(f, "route.out")["breakAt"] = 2)],
    ["breakAt far past it", /back\.swing\b.*breakAt/, (f) => void (lib(f, "back.swing")["breakAt"] = 1000)],
  ];
  for (const [name, names, breakIt] of cases)
    it(name, () => {
      const f = files();
      breakIt(f);
      listed(f, names, name);
    });
  it("three faults at once are all three listed: the first does not stop the check", () => {
    const f = files();
    lib(f, "run.power")["gap"] = "A";
    lib(f, "route.out")["breakAt"] = 9;
    lib(f, "blitz.corner")["lane"] = "inside";
    D(f, "prevent.prevent").assignments["S2"] = { use: "zone.deep.middle", at: [0, 120] };
    const m = shown(f);
    for (const names of [/run\.power is declared gap A/, /route\.out/, /blitz\.corner is declared lane inside/, /S2/]) expect(m).toMatch(names);
    expect(m.split("\n").length).toBeGreaterThan(4);
  });
});

describe("R21: entries no design uses, and timing by the drop and the routes", () => {
  type Extra = Record<string, unknown>;
  const message = (f: Files): string => {
    try {
      parse(f);
    } catch (e) {
      return (e as Error).message;
    }
    return "accepted";
  };
  /** The files with one more library entry that nothing refers to. */
  const withExtra = (entry: Extra): string => {
    const f = files();
    (f.library.assignments as unknown as Record<string, Extra>)["extra.unused"] = { label: "Extra", ...entry };
    return message(f);
  };
  const refused = (entry: Extra) => expect(withExtra(entry)).toMatch(/^data\/plays failed its check:\n[\s\S]*extra\.unused/);
  const route = (family: string, direction: string, pts: Pair[]): Extra => ({ kind: "route", family, direction, axis: "in", pts, breakAt: 0 });
  const runPath = (gap: string, counter: boolean, pts: Pair[]): Extra => ({ kind: "runPath", gap, counter, axis: "side", pts });

  it("a sound route, run and counter that nothing uses are accepted, so the refusals below are for the fault", () => {
    expect(withExtra(route("post", "in", [[0, 12], [8, 24]]))).toBe("accepted");
    expect(withExtra(runPath("C", false, [[4.5, -1], [5.5, 3]]))).toBe("accepted");
    expect(withExtra(runPath("C", true, [[-1.5, -4], [5, -1], [5.5, 3]]))).toBe("accepted");
  });
  it("a 90-yard route, straight, broken or bent back and forth inside the field", () => {
    refused(route("go", "vertical", [[0, 90]]));
    refused(route("go", "vertical", [[-1, 2], [-1.5, 90]]));
    refused(route("post", "in", [[0, 12], [8, 90]]));
    refused(route("drag", "in", [[20, 5], [0, 6], [20, 7], [0, 8], [20, 9]]));
  });
  it("a route of the wrong family or direction, and a block that leaves the field", () => {
    refused(route("go", "vertical", [[0, 3], [5, 8]]));
    refused(route("corner", "in", [[0, 12], [8, 24]]));
    refused({ kind: "block", block: "run", technique: "stalk", axis: "none", pts: [[0, 58]] });
  });
  it("a run in the wrong gap, and a run that never reaches the line", () => {
    for (const gap of ["A", "B", "edge"]) refused(runPath(gap, false, [[4.5, -1], [5.5, 3]]));
    refused(runPath("C", false, [[4.5, -3], [5.5, -1]]));
  });
  // A run path is measured from the ball toward the play side. A run whose waypoints never go to the
  // other side of the ball is no counter, and one whose first waypoint does is.
  for (const [id, e] of Object.entries(F.library.assignments)) {
    if (e.kind !== "runPath" || e.axis !== "side") continue;
    it(`an unused copy of ${id} with the counter flag wrong`, () => {
      expect((e.pts[0] as Pair)[0] < 0).toBe(e.counter);
      expect(withExtra({ ...e, counter: !e.counter })).toMatch(/extra\.unused/);
    });
  }

  const levels = (change: (d: { assignments: Record<string, unknown>; tags: Record<string, unknown> }) => void): string => {
    const f = files();
    change(f.offense.designs.find((d) => d.id === "shotgun.intermediatePass.levels") as unknown as { assignments: Record<string, unknown>; tags: Record<string, unknown> });
    return message(f);
  };
  it("Shotgun Levels off a deep drop may not be tagged standard, though its concept is an intermediate pass", () => {
    expect(levels((d) => expect(d.tags["timing"]).toBe("standard"))).toBe("accepted");
    expect(levels((d) => void (d.assignments["QB1"] = { use: "qb.deep", to: "right" }))).toMatch(/shotgun\.intermediatePass\.levels: timing/);
    expect(levels((d) => void Object.assign(d, { assignments: { ...d.assignments, QB1: { use: "qb.deep", to: "right" } }, tags: { ...d.tags, timing: "slow" } }))).toBe("accepted");
  });
  it("Pistol and Heavy Deep Cross, the same drop and first read, have the same timing, and neither may leave it", () => {
    const ids = ["pistol.intermediatePass.deepCross", "heavy.intermediatePass.deepCross"];
    const both = ids.map((id) => F.offense.designs.find((d) => d.id === id) as OffenseDesign);
    for (const d of both) {
      expect(ref(d.assignments["QB1"] as never).use).toBe("qb.drop");
      expect(Object.values(d.assignments).map(ref).find((v) => v.primary === true)?.use).toBe("route.cross");
    }
    expect((both[0] as OffenseDesign).tags.timing).toBe((both[1] as OffenseDesign).tags.timing);
    for (const id of ids)
      for (const timing of ["quick", "slow"]) {
        const f = files();
        (f.offense.designs.find((d) => d.id === id) as unknown as { tags: Record<string, unknown> }).tags["timing"] = timing;
        expect(message(f), `${id} ${timing}`).toMatch(new RegExp(`${id.replace(/\./g, "\\.")}: timing`));
      }
  });
});
