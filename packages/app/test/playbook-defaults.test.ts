// R5, R18 and criterion F2 (docs/specs/m3-playbook-and-custom-routes.md): each engine call's default
// design draws the diagram today's call draws (the templates, through the app's own geometry),
// within 0.01 yd, except the calls data/plays/config.json lists in defaultDeviations, and those only
// on the slots listed here. A run's steps toward the play side go to the design's own side (F8). On
// defense, a drop's read steps are the animation's: the drop's end is what is compared, and a man
// defender's steps are all read steps, so his path may be any that does not rush.

import { describe, expect, it } from "vitest";
import { defenseAlignment, formationRoles, holeOf, manAgainst, placePath, playSide, resolveDefense, resolveOffense, slotsOf } from "../../shared/src/playbook";
import type { DefenseDesign, OffenseDesign, Pair, SlotAlignment } from "../../shared/src/playbook";
import { loadPlaybook, playbookRefs, readJson } from "../../shared/test/playbook-load";
import { alignment as lineUp, defenseArt, lineContactFor, lineKeys, lookup, offenseArt, placeRoute, receiverRoles, routeChain, RUN_LEAVES, slotsFromCounts, type Sides } from "../src/ui/art";
import { MID_X } from "../src/ui/motion";
import { parseTemplates } from "../src/ui/templates";

const pb = loadPlaybook();
const refs = playbookRefs();
const templates = parseTemplates(readJson("data/ui/templates.json"));
const TOL = 0.01;
type P = readonly [number, number];

/** The slots each listed deviation changes (R18): every other slot draws today's path. */
const CHANGED: Record<string, readonly string[]> = {
  "shotgun.outsideRun": ["RB1"],
  "underCenter.outsideRun": ["RB1"],
  "pistol.outsideRun": ["RB1"],
  "empty.outsideRun": ["QB1", "WR4", "OL2", "OL4"],
  "heavy.outsideRun": ["QB1", "RB1", "TE3"],
  "empty.insideRun": ["TE1", "OL1", "OL2", "OL3", "OL4", "OL5"],
  "shotgun.deepPass": ["RB1", "WR2", "WR3"],
  "underCenter.deepPass": ["WR1"],
  "empty.deepPass": ["WR2", "WR4"],
  "pistol.intermediatePass": ["TE1"],
  "heavy.intermediatePass": ["TE1"],
  "empty.playAction": ["WR3"],
  runStuff: ["S1"],
  nickel2Man: ["S2"],
  nickelCover1Blitz: ["DL1", "DL2", "DL3", "LB1", "LB2"],
  dimeCover0Blitz: ["LB1", "S1", "S2"],
  goalLine: [],
};
/**
 * Today's tethers no design can keep: they run to a spot no shotgun receiver stands in, or from a
 * defender whose own path is a rush or a zone.
 */
const LEGACY_TETHERS: Record<string, readonly string[]> = {
  runStuff: ["LB3", "S2"],
  nickel2Man: ["S2"],
  nickelCover1: ["S2"],
  nickelCover1Blitz: ["LB1", "LB2", "S2"],
  dimeCover0Blitz: ["LB1", "CB4", "S2"],
  goalLine: ["LB3"],
};

interface Diff {
  readonly slot: string;
  readonly what: "path" | "tether";
  readonly text: string;
}

const key = (d: OffenseDesign | DefenseDesign): string => ("formation" in d ? `${d.formation}.${d.concept}` : d.coverage);
const far = (a: readonly P[], b: readonly P[]): boolean => a.length !== b.length || a.some((p, i) => Math.hypot(p[0] - (b[i] as P)[0], p[1] - (b[i] as P)[1]) > TOL);

/** What differs between an offense design and today's diagram for its call. */
function offenseDiff(d: OffenseDesign): Diff[] {
  const slots = slotsFromCounts(refs.personnel.offense[d.formation] ?? {});
  const pts = lineUp(slots, templates.offense[d.formation], "O", 0);
  const { roles, strong } = receiverRoles(slots, pts);
  const a = pb.alignments.offense[d.formation] as SlotAlignment;
  const to = playSide(d, a, pb.config.positions);
  const sides: Sides = { strong, play: to === null ? 0 : to === "right" ? 1 : -1 };
  const isRun = RUN_LEAVES.has(d.concept);
  const art = offenseArt(d.formation, d.concept, slots, templates, 0);
  const res = resolveOffense(d, pb, slotsOf(refs.personnel.offense[d.formation] ?? {}));
  const hole = holeOf(res, a) ?? undefined;
  return res.flatMap((r) => {
    const i = slots.findIndex((s) => s.slot === r.slot);
    const m = pts[i] as { x: number; y: number };
    const carries = r.entry.kind === "runPath";
    const route = r.position === "OL" ? lineContactFor(templates, d.concept, isRun ? "run" : "pass", lineKeys(slots, pts, r.slot, "OL")) : lookup(templates.routes[d.concept], routeChain(roles.get(r.slot), r.position));
    // Two run paths, the fork of an outside run, match no single path.
    const runs = art.paths.filter((p) => p.slot === r.slot && p.kind === "run");
    const want = carries ? (runs.length === 1 ? (runs[0]?.points ?? []) : []) : [m, ...placeRoute(m, route, sides).map((w) => w.p)];
    const got = "pts" in r.entry ? placePath(r.entry, a[r.slot] as Pair, r.to, r.ref.depth, hole) : [];
    const rel = want.map((p): P => [p.x - m.x, p.y - m.y]);
    return far(got, rel) ? [{ slot: r.slot, what: "path", text: `${r.slot} ${r.use} ${JSON.stringify(got)} today ${JSON.stringify(rel.map((p) => p.map((v) => Math.round(v * 100) / 100)))}` }] : [];
  });
}

/** What differs between a defense design and today's diagram for its preset: places, path ends and tethers, whatever he plays. */
function defenseDiff(d: DefenseDesign): Diff[] {
  const slots = slotsFromCounts(refs.personnel.packages[d.package] ?? {});
  const art = defenseArt(d.package, d.coverage, slots, templates, 0);
  const a = defenseAlignment(d, pb.alignments);
  // Today's man spots are the shotgun's receiver spots.
  const shotgun = pb.alignments.offense["shotgun"] as SlotAlignment;
  const roles = formationRoles(shotgun, pb.config.positions);
  return resolveDefense(d, pb, slotsOf(refs.personnel.packages[d.package] ?? {})).flatMap((r) => {
    const mark = art.marks.find((m) => m.slot === r.slot) as { x: number; y: number };
    const here = a[r.slot] as Pair;
    const path = art.paths.find((p) => p.slot === r.slot);
    const last = path?.points[path.points.length - 1];
    const end: P | null = last === undefined ? null : [last.x - MID_X, last.y];
    const tether = art.tethers.find((t) => t.slot === r.slot);
    const spot: P | null = tether === undefined ? null : [tether.to.x - MID_X, -tether.to.y];
    const out: Diff[] = [];
    const note = (what: Diff["what"], got: unknown, today: unknown) => void out.push({ slot: r.slot, what, text: `${r.slot} ${r.use} ${what} ${JSON.stringify(got)} today ${JSON.stringify(today)}` });
    if (far([here], [[mark.x - MID_X, mark.y]])) note("path", here, [mark.x - MID_X, mark.y]);
    const move = "pts" in r.entry ? (placePath(r.entry, here).slice(-1)[0] as Pair) : null;
    const got: P | null = move !== null ? [here[0] + move[0], here[1] + move[1]] : (r.ref.at ?? null);
    if (r.entry.kind === "man") {
      if (end !== null && end[1] <= 0) note("path", "man", end);
    } else if (got === null || end === null || far([got], [end])) note("path", got, end);
    const now = r.entry.kind === "man" ? manAgainst(r.entry, roles) : null;
    const man: P | null = now !== null && "role" in now ? (shotgun[now.covers] as Pair) : null;
    if ((man === null) !== (spot === null) || (man !== null && spot !== null && far([man], [spot]))) note("tether", man, spot);
    return out;
  });
}

describe("R5, R18 / F2: default designs draw today's diagram", () => {
  const defaults = [...pb.offense.designs, ...pb.defense.designs].filter((d) => d.default);
  it("there are 53 of them", () => expect(defaults).toHaveLength(53));
  for (const d of defaults) {
    const diff = "formation" in d ? offenseDiff(d) : defenseDiff(d);
    const k = key(d);
    const reason = pb.config.defaultDeviations[k];
    const changed = CHANGED[k] ?? [];
    // A man who takes over another's assignment, or leaves it, changes his tether with it.
    const free = [...changed, ...(LEGACY_TETHERS[k] ?? [])];
    it(reason === undefined ? `${d.id} draws today's diagram` : `${d.id} differs only on the slots its reason forces`, () => {
      expect(diff.filter((x) => (x.what === "path" ? !changed.includes(x.slot) : !free.includes(x.slot))).map((x) => x.text)).toEqual([]);
    });
    if (reason !== undefined)
      it(`${d.id} is a listed deviation, with a one-line reason, and differs on each of its slots`, () => {
        expect(reason).not.toMatch(/\n/);
        expect(diff).not.toEqual([]);
        expect([...new Set(diff.filter((x) => x.what === "path").map((x) => x.slot))].sort()).toEqual([...changed].sort());
      });
  }
  it("only offense and defense calls that have a default are listed", () => {
    for (const k of Object.keys(pb.config.defaultDeviations)) expect(defaults.map(key)).toContain(k);
    expect(Object.keys(CHANGED).sort()).toEqual(Object.keys(pb.config.defaultDeviations).sort());
  });
  it("each legacy tether runs to no shotgun receiver, or from a defender whose path today is a rush or a zone", () => {
    const spots = Object.values(pb.alignments.offense["shotgun"] as SlotAlignment);
    for (const [preset, list] of Object.entries(LEGACY_TETHERS)) {
      const pkg = refs.personnel.presetPackage[preset] as string;
      const art = defenseArt(pkg, preset, slotsFromCounts(refs.personnel.packages[pkg] ?? {}), templates, 0);
      for (const slot of list) {
        const t = art.tethers.find((x) => x.slot === slot);
        if (t === undefined) throw new Error(`${preset} ${slot}`);
        const nobody = !spots.some((p) => Math.hypot(p[0] - (t.to.x - MID_X), p[1] + t.to.y) <= TOL);
        const end = art.paths.find((p) => p.slot === slot)?.points.slice(-1)[0];
        expect(nobody || (end !== undefined && end.y <= 0) || templates.zones[preset]?.[slot] !== undefined, `${preset} ${slot}`).toBe(true);
      }
    }
  });
});
