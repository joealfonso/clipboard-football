// R18 of docs/specs/m3-playbook-and-custom-routes.md: a default that deviates from today's diagram
// does so only on the paths its reason forces. The slots below are read off each reason's words in
// data/plays/config.json by hand, with the lineups of data/plays/alignments.json. Offense paths are
// worked out here from the raw templates.json by its own note; the ball carrier's and the defense's
// come from the app's art.

import { describe, expect, it } from "vitest";
import type { AssignmentValue, DefenseDesign, OffenseDesign, Pair } from "../../shared/src/playbook";
import { defAlign, defEntries, drawnFrom, files, holeBy, json, onField, personnel, pos, ref, runnerTrack } from "../../shared/test/spec-support";
import { defenseArt, offenseArt, slotsFromCounts } from "../src/ui/art";
import { MID_X } from "../src/ui/motion";
import { parseTemplates } from "../src/ui/templates";

const F = files();
const raw = json<{ routes: Record<string, Record<string, unknown>>; lineContact: Record<string, Record<string, unknown>> }>("data/ui/templates.json");
const templates = parseTemplates(json("data/ui/templates.json"));
const reasons = json<{ defaultDeviations: Record<string, string> }>("data/plays/config.json").defaultDeviations;

const FORCED: Record<string, [words: RegExp, slots: string[]]> = {
  // "An outside run goes to one side": the runner.
  "shotgun.outsideRun": [/one side/, ["RB1"]],
  "underCenter.outsideRun": [/one side/, ["RB1"]],
  "pistol.outsideRun": [/one side/, ["RB1"]],
  // Both guards are OL2 and OL4, the slot on the run's side (right) is WR4.
  "empty.outsideRun": [/both guards pull.*slot cracks/, ["QB1", "OL2", "OL4", "WR4"]],
  // The wing tight end on the right is TE3.
  "heavy.outsideRun": [/quarterback pitches.*back takes it wide.*lead tight end/, ["QB1", "RB1", "TE3"]],
  "empty.insideRun": [/line and the tight end show pass first/, ["OL1", "OL2", "OL3", "OL4", "OL5", "TE1"]],
  // Shotgun's strong side is the left (a tie, with the tight end there), so today's two posts are the
  // two weak-side receivers on the right, WR2 and WR3.
  "shotgun.deepPass": [/two posts change and the back stays in/, ["WR2", "WR3", "RB1"]],
  "underCenter.deepPass": [/left receiver fades/, ["WR1"]],
  // Empty's strong side is the left (three receivers). Today WR1 and TE1 run vertical and WR3, WR2 and
  // WR4 run posts, so the name needs two more: the outside man and the slot on the right are WR2 and WR4.
  "empty.deepPass": [/outside receiver and the slot on the right run vertical.*left side is today's/, ["WR2", "WR4"]],
  "pistol.intermediatePass": [/tight end's curl becomes the shallow cross/, ["TE1"]],
  "heavy.intermediatePass": [/left tight end crosses/, ["TE1"]],
  "empty.playAction": [/the left slot receiver runs the seam/, ["WR3"]],
  runStuff: [/one safety deep/, ["S1"]],
  nickel2Man: [/two safeties deep/, ["S1", "S2"]],
  // The name puts both linebackers in the A gaps (the lead's ruling), so the tackles beside them may
  // slant out of the way. Today six rush, one is deep and four cover, so the left end takes the fifth.
  nickelCover1Blitz: [/linebackers cross.*tackles slant.*left end.*safety's path is today's/, ["LB1", "LB2", "DL1", "DL2", "DL3"]],
  dimeCover0Blitz: [/both safeties come and the linebacker and the slot corner/, ["S1", "S2", "LB1", "CB3", "CB4"]],
  goalLine: [/man on the second receiver on the right/, ["LB3"]],
};

type Way = [number, number];
interface RawRoute {
  pts: Way[];
  axis: "in" | "strong" | "play";
}
/** A raw route or line step: a list of waypoints, or { pts, axis }; a waypoint is a pair or { p }. */
function rawRoute(v: unknown): RawRoute {
  const o = (Array.isArray(v) ? { pts: v } : v) as { pts: (Way | { p: Way })[]; axis?: RawRoute["axis"] };
  return { pts: o.pts.map((w) => (Array.isArray(w) ? w : w.p)), axis: o.axis ?? "in" };
}

/** Today's path of one slot, from its own place, by the templates' note. */
function today(d: OffenseDesign, slot: string): Way[] {
  const a = F.alignments.offense[d.formation] as Record<string, Pair>;
  const [x] = a[slot] as Pair;
  const on = (s: number) => Object.keys(a).filter((k) => ["WR", "TE"].includes(pos(k)) && (a[k] as Pair)[0] * s > 0);
  const tes = (s: number) => on(s).filter((k) => pos(k) === "TE").length;
  const strong = on(1).length !== on(-1).length ? Math.sign(on(1).length - on(-1).length) : tes(-1) > tes(1) ? -1 : 1;
  const play = d.side === "none" ? 0 : d.side === "strong" ? strong : -strong;
  const keys: string[] = [];
  let table: Record<string, unknown>;
  if (pos(slot) === "OL") {
    const xs = Object.keys(a).filter((k) => pos(k) === "OL").map((k) => (a[k] as Pair)[0]);
    if (x === Math.min(...xs) || x === Math.max(...xs)) keys.push("OLT");
    keys.push("OL");
    const family = raw.lineContact[["insideRun", "outsideRun", "qbSneak"].includes(d.concept) ? "run" : "pass"] as Record<string, unknown>;
    table = { ...family, ...raw.lineContact[d.concept] };
    // The leaf's own OL entry comes before the family's OLT.
    if (raw.lineContact[d.concept] !== undefined && raw.lineContact[d.concept]?.["OLT"] === undefined) keys.shift();
    if (keys.length === 0) keys.push("OL");
  } else {
    if (["WR", "TE"].includes(pos(slot))) {
      const mine = on(Math.sign(x)).sort((p, q) => Math.abs((a[q] as Pair)[0]) - Math.abs((a[p] as Pair)[0]));
      const role = `${Math.sign(x) === strong ? "s" : "w"}${mine.indexOf(slot) + 1}`;
      keys.push(`${role}:${pos(slot)}`, role);
    }
    keys.push(pos(slot));
    table = raw.routes[d.concept] as Record<string, unknown>;
  }
  const key = keys.find((k) => table[k] !== undefined);
  if (key === undefined) return [[0, 0]];
  const r = rawRoute(table[key]);
  const sign = r.axis === "strong" ? strong : r.axis === "play" ? play : x > 0 ? -1 : 1;
  return [[0, 0], ...r.pts.map(([lx, up]): Way => [sign * lx, up])];
}

const same = (a: readonly Way[], b: readonly Way[]) => a.length === b.length && a.every((p, i) => Math.hypot(p[0] - (b[i] as Way)[0], p[1] - (b[i] as Way)[1]) <= 0.01);

function offenseChanges(d: OffenseDesign): string[] {
  const a = F.alignments.offense[d.formation] as Record<string, Pair>;
  const slots = onField(personnel.offense[d.formation] as Record<string, number>);
  const art = offenseArt(d.formation, d.concept, slotsFromCounts(personnel.offense[d.formation] as Record<string, number>), templates, 0);
  const line = F.config.concepts[d.concept]?.line as { OL: string; OLT?: string };
  const xs = slots.filter((s) => pos(s) === "OL").map((s) => (a[s] as Pair)[0]);
  return slots.filter((slot) => {
    const me = a[slot] as Pair;
    const listed = d.assignments[slot] ?? (pos(slot) === "OL" ? d.line : undefined);
    const outer = me[0] === Math.min(...xs) || me[0] === Math.max(...xs);
    const v = ref(listed ?? (((outer ? line.OLT : undefined) ?? line.OL) as AssignmentValue));
    const e = F.library.assignments[v.use];
    if (e === undefined || !("pts" in e)) throw new Error(`${d.id} ${slot}`);
    if (e.kind === "runPath") {
      const runs = art.paths.filter((p) => p.slot === slot && p.kind === "run");
      const was = runs[0]?.points.map((p): Way => [p.x - MID_X, p.y]);
      return runs.length !== 1 || was === undefined || !same(runnerTrack(F, d), was);
    }
    // A line default steps to the design's own side.
    const path = drawnFrom(e, me, { ...v, to: v.to ?? sideOf(d) }, e.kind === "route" ? e.breakAt : undefined, holeBy(F, d));
    return !same(path, today(d, slot));
  });
}
/** The design's own side in the field's terms: its `side` against the strong side. */
function sideOf(d: OffenseDesign): "left" | "right" {
  const a = F.alignments.offense[d.formation] as Record<string, Pair>;
  const n = (s: number, p: string[]) => Object.keys(a).filter((k) => p.includes(pos(k)) && (a[k] as Pair)[0] * s > 0).length;
  const right = n(1, ["WR", "TE"]) - n(-1, ["WR", "TE"]) || n(1, ["TE"]) - n(-1, ["TE"]) || 1;
  return right > 0 === (d.side !== "weak") ? "right" : "left";
}

function defenseChanges(d: DefenseDesign): string[] {
  const art = defenseArt(d.package, d.coverage, slotsFromCounts(personnel.packages[d.package] as Record<string, number>), templates, 0);
  const align = defAlign(F, d);
  // config.json: an unlisted lineman rushes, the outermost on each side at the edge. Both go straight.
  return defEntries(F, d).filter(({ slot, entry, listed }) => {
    const me = align[slot] as Pair;
    const mark = art.marks.find((m) => m.slot === slot) as { x: number; y: number };
    if (!same([[me[0], me[1]]], [[mark.x - MID_X, mark.y]])) return true;
    const last = art.paths.find((p) => p.slot === slot)?.points.at(-1);
    const was: Way | null = last === undefined ? null : [last.x - MID_X, last.y];
    // A man defender's steps are read steps, so only a path over the line is a change.
    if (entry.kind === "man") return was !== null && was[1] <= 0;
    const v = listed ? ref(d.assignments[slot] as AssignmentValue) : { use: "" };
    const end: Way | null = entry.kind === "zone" ? (ref(d.assignments[slot] as AssignmentValue).at as Way) : "pts" in entry ? (drawnFrom(entry, me, v).map(([x, y]): Way => [me[0] + x, me[1] + y]).at(-1) as Way) : null;
    return end === null || was === null || !same([end], [was]);
  }).map((x) => x.slot);
}

describe("R18: a deviating default changes only the paths its reason forces", () => {
  it("the list is the one this test reads, reason by reason", () => {
    expect(Object.keys(reasons).sort()).toEqual(Object.keys(FORCED).sort());
    for (const [call, [words]] of Object.entries(FORCED)) expect(reasons[call], call).toMatch(words);
  });
  // The same words, for the calls that are listed, so a call missing from the list cannot hide them.
  for (const [call, [words]] of Object.entries(FORCED).filter(([c]) => c in reasons)) it(`${call}: its reason's words`, () => expect(reasons[call]).toMatch(words));
  for (const d of F.offense.designs.filter((x) => x.default)) {
    const key = `${d.formation}.${d.concept}`;
    it(d.id, () => {
      const changed = offenseChanges(d);
      const allowed = FORCED[key]?.[1] ?? [];
      expect(changed.filter((s) => !allowed.includes(s)), "a path the reason does not force").toEqual([]);
      if (key in FORCED) expect(changed, "a listed call that changes nothing").not.toEqual([]);
    });
  }
  for (const d of F.defense.designs.filter((x) => x.default)) {
    it(d.id, () => expect(defenseChanges(d).filter((s) => !(FORCED[d.coverage]?.[1] ?? []).includes(s)), "a path the reason does not force").toEqual([]));
  }
  it("the check can see a change: one more redrawn slot in a listed call is caught", () => {
    const d = structuredClone(F.offense.designs.find((x) => x.id === "shotgun.playAction.paPost") as OffenseDesign) as unknown as { assignments: Record<string, unknown> };
    d.assignments["WR3"] = "route.hitch";
    expect(offenseChanges(d as unknown as OffenseDesign)).toContain("WR3");
    const n = structuredClone(F.defense.designs.find((x) => x.coverage === "nickelCover1Blitz" && x.default) as DefenseDesign) as unknown as { assignments: Record<string, unknown> };
    n.assignments["S1"] = { use: "zone.deep.middle", at: [4, 17] };
    expect(defenseChanges(n as unknown as DefenseDesign)).toContain("S1");
  });
});

// A play must still be what its name says. Geometry from the raw files and this file's own reading of
// the rulings: R11 (a break 0 to 9 yards past the line and an end of 10 or more on a deep diagonal is a
// post), R1 (a post and a go are caught where they end), R17 (whole yards) and the deep edge, 20.
describe("a default is what its name says", () => {
  const DEEP = 20;
  interface Run { slot: string; x: number; end: number; degrees: number; inside: boolean }
  /** Where each route ends past the line, and its last stroke's angle above sideways. */
  function routes(d: OffenseDesign): Run[] {
    const a = F.alignments.offense[d.formation] as Record<string, Pair>;
    return Object.entries(d.assignments).flatMap(([slot, v]) => {
      const e = F.library.assignments[ref(v).use];
      if (e?.kind !== "route") return [];
      const me = a[slot] as Pair;
      const path = drawnFrom(e, me, ref(v), e.breakAt);
      const [p, q] = [path.at(-2), path.at(-1)] as [Way, Way];
      const degrees = (Math.atan2(q[1] - p[1], Math.abs(q[0] - p[0])) * 180) / Math.PI;
      return [{ slot, x: me[0], end: Math.floor(q[1] - me[1] + 0.5), degrees, inside: (q[0] - p[0]) * me[0] < 0 }];
    });
  }
  const t = F.config.classifier;
  const vertical = (r: Run) => r.degrees >= t.verticalFromDegrees && r.end >= DEEP;
  const diagonalIn = (r: Run) => r.inside && r.degrees >= t.diagonalFromDegrees && r.degrees < t.verticalFromDegrees;
  const design = (id: string) => F.offense.designs.find((x) => x.id === id) as OffenseDesign;
  const paPosts = F.offense.designs.filter((x) => x.label === "PA Post");
  it("there is a PA Post in every formation with a back", () => expect(paPosts.map((d) => d.formation).sort()).toEqual(["heavy", "pistol", "shotgun", "underCenter"]));
  for (const d of paPosts)
    it(`${d.id}: its primary receiver runs a post, caught 10 yards or more past the line, and the tag says which bucket`, () => {
      const primary = Object.keys(d.assignments).filter((s) => ref(d.assignments[s] as AssignmentValue).primary === true);
      expect(primary).toHaveLength(1);
      const r = routes(d).find((x) => x.slot === primary[0]) as Run;
      expect(diagonalIn(r), JSON.stringify(r)).toBe(true);
      expect(r.end).toBeGreaterThanOrEqual(10);
      expect(d.tags.depth).toBe(r.end >= DEEP ? "deep" : "intermediate");
      expect(F.library.assignments[ref(d.assignments[r.slot] as AssignmentValue).use]).toMatchObject({ kind: "route", family: "post" });
    });
  it("Empty Four Verticals: exactly four run vertical and deep, two a side, and the left side is today's", () => {
    const d = design("empty.deepPass.fourVerticals");
    const up = routes(d).filter(vertical);
    expect(up.map((r) => r.slot).sort()).toEqual(["TE1", "WR1", "WR2", "WR4"]);
    expect(up.filter((r) => r.x < 0)).toHaveLength(2);
  });
  it("Empty PA Seam: the left slot runs straight up, deep, and he is the primary", () => {
    const d = design("empty.playAction.paSeam");
    const r = routes(d).find((x) => x.slot === "WR3") as Run;
    expect(vertical(r), JSON.stringify(r)).toBe(true);
    expect(ref(d.assignments["WR3"] as AssignmentValue).primary).toBe(true);
  });
  it("Double A Gap: both linebackers cross in the A gaps, one each side, five rush, five are covered by man and one is deep", () => {
    const d = F.defense.designs.find((x) => x.coverage === "nickelCover1Blitz" && x.default) as DefenseDesign;
    expect(d.label).toBe("Double A Gap");
    const align = defAlign(F, d);
    const crossings = ["LB1", "LB2"].map((slot) => {
      const me = align[slot] as Pair;
      const v = ref(d.assignments[slot] as AssignmentValue);
      const e = F.library.assignments[v.use];
      if (e === undefined || !("pts" in e)) throw new Error(slot);
      const path = drawnFrom(e, me, v).map(([x, y]): Way => [me[0] + x, me[1] + y]);
      const i = path.findIndex((p) => p[1] <= 0);
      const [p, q] = [path[i - 1], path[i]] as [Way, Way];
      return p[0] + ((q[0] - p[0]) * p[1]) / (p[1] - q[1]);
    });
    // The guards are 2 yards from the center, and inside them is under 1.5.
    for (const x of crossings) expect(Math.abs(x), `${x}`).toBeLessThan(1.5);
    expect(Math.sign(crossings[0] as number)).toBe(-Math.sign(crossings[1] as number));
    const kinds = defEntries(F, d).map(({ entry }) => entry.kind);
    const n = (k: string[]) => kinds.filter((x) => k.includes(x)).length;
    expect([n(["rush", "blitz", "stunt"]), n(["man"]), n(["zone"])]).toEqual([5, 5, 1]);
    // The end who drops is on the side of the receiver he takes.
    expect(d.assignments["DL1"]).toBe("man.L2");
    expect((align["DL1"] as Pair)[0]).toBeLessThan(0);
  });
});
