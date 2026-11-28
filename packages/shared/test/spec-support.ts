// Support for the independent spec tests of docs/specs/m3-playbook-and-custom-routes.md (A and B).
// Reads the raw files and re-derives what the spec says from them without the helpers under test.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssignmentRef, AssignmentValue, DefenseDesign, LibraryEntry, OffenseDesign, Pair, PlaybookConfig, PlaybookRefs, SlotAlignment } from "../src/playbook";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const json = <T = unknown>(path: string): T => JSON.parse(readFileSync(join(root, path), "utf8")) as T;
export const text = (path: string): string => readFileSync(join(root, path), "utf8");

export interface Files {
  alignments: { offense: Record<string, Record<string, Pair>>; defense: Record<string, Record<string, Pair>>; presetAlignment: Record<string, Record<string, Pair>> };
  library: { assignments: Record<string, LibraryEntry> };
  offense: { designs: OffenseDesign[] };
  defense: { designs: DefenseDesign[] };
  config: PlaybookConfig;
}

/** Fresh, mutable copies of the five files. */
export function files(): Files {
  return {
    alignments: json("data/plays/alignments.json"),
    library: json("data/plays/library.json"),
    offense: json("data/plays/offense.json"),
    defense: json("data/plays/defense.json"),
    config: json("data/plays/config.json"),
  };
}

export interface Caller {
  offenseMapping: { depth: { shortBelow: number; deepFrom: number } };
  defenseMapping: { boxHeavyMin: number; presets: Record<string, { group: string; box: string; shell: string; manZone: string; rush: string }> };
}
export const caller = json<Caller>("data/caller/config.json");
export const personnel = json<{ positions: string[]; offense: Record<string, Record<string, number>>; packages: Record<string, Record<string, number>>; presetPackage: Record<string, string> }>("data/engine/personnel.json");

export function refs(): PlaybookRefs {
  return { personnel, presets: caller.defenseMapping.presets, boxHeavyMin: caller.defenseMapping.boxHeavyMin, depthEdges: caller.offenseMapping.depth };
}

export const pos = (slot: string): string => slot.replace(/[0-9]+$/, "");
export const ref = (v: AssignmentValue): AssignmentRef => (typeof v === "string" ? { use: v } : v);

/** WR1, WR2, ... from personnel counts. */
export function onField(counts: Record<string, number>): string[] {
  const out: string[] = [];
  for (const [p, n] of Object.entries(counts)) for (let i = 1; i <= n; i++) out.push(`${p}${i}`);
  return out;
}

/** R8: the width is stored in feet (160) and yards are derived, worked out here from the raw file. */
export const widthYardsOf = (f: Files): number => (f.config.field as unknown as { widthFeet: number }).widthFeet / 3;

/** Where a run crosses the line: x, and which way is outside (the design's side). */
export interface HoleAt {
  x: number;
  out: 1 | -1;
}

/** R1: the families caught where they end. Typed from the ruling, not read from the config. */
export const CAUGHT_AT_END = ["go", "post", "corner", "wheel"];

/**
 * The runner's absolute path (x from the middle, y past the line) by the library note: a run path is
 * measured from the ball, [toward the play side, past the line].
 */
export function runnerTrack(f: Files, d: OffenseDesign): [number, number][] {
  const r = ref(d.assignments[d.carrier as string] as AssignmentValue);
  const e = f.library.assignments[r.use];
  if (e?.kind !== "runPath") throw new Error(`${d.id}: no run path`);
  const a = (f.alignments.offense[d.formation] as Record<string, Pair>)[d.carrier as string] as Pair;
  const dir = e.axis === "none" ? 0 : r.to === "left" ? -1 : 1;
  return [[a[0], -a[1]], ...e.pts.map((p): [number, number] => [dir * p[0], p[1]])];
}

/** Own geometry: where the runner's track first reaches the line, or null for a run with no side. */
export function holeBy(f: Files, d: OffenseDesign): HoleAt | null {
  if (d.carrier === undefined) return null;
  const to = ref(d.assignments[d.carrier] as AssignmentValue).to;
  if (to === undefined) return null;
  const track = runnerTrack(f, d);
  for (let i = 1; i < track.length; i++) {
    const [ax, ay] = track[i - 1] as [number, number];
    const [bx, by] = track[i] as [number, number];
    if (ay < 0 && by >= 0) return { x: ax + (bx - ax) * (-ay / (by - ay)), out: to === "left" ? -1 : 1 };
  }
  throw new Error(`${d.id}: the runner never reaches the line`);
}

/** The library note, read by hand: every kind but runPath and the hole axis is measured from the player. */
export function drawnFrom(entry: { axis: string; pts: readonly Pair[] }, align: Pair, r: AssignmentRef, breakAt?: number, hole?: HoleAt | null): [number, number][] {
  if (entry.axis === "hole") {
    if (hole === undefined || hole === null) throw new Error("a hole-axis block on a run with no side");
    // From the hole, [outside it, past the line], turned into yards from a player align[1] behind the line.
    return [[0, 0], ...entry.pts.map((p): [number, number] => [hole.x + hole.out * p[0] - align[0], p[1] + align[1]])];
  }
  let dir = 0;
  if (entry.axis === "in") dir = align[0] > 0 ? -1 : 1;
  if (entry.axis === "side") dir = r.to === "left" ? -1 : 1;
  let lift = 0;
  if (breakAt !== undefined && r.depth !== undefined) {
    // "a design's depth moves that waypoint and every later one so the break sits that many yards past the line"
    lift = r.depth - ((entry.pts[breakAt] as Pair)[1] - align[1]);
  }
  return [[0, 0], ...entry.pts.map((p, i): [number, number] => [dir * p[0], p[1] + (breakAt !== undefined && i >= breakAt ? lift : 0)])];
}

/** A defense design's alignment by the note in alignments.json: package, then preset, then the design. */
export function defAlign(f: Files, d: DefenseDesign): SlotAlignment {
  return { ...f.alignments.defense[d.package], ...f.alignments.presetAlignment[d.coverage], ...d.alignment };
}

/** Every entry of a defense design, unlisted linemen rushing (config defenseDefaults: DL rush). */
export function defEntries(f: Files, d: DefenseDesign): { slot: string; entry: LibraryEntry; listed: boolean }[] {
  return onField(personnel.packages[d.package] as Record<string, number>).map((slot) => {
    const v = d.assignments[slot];
    const entry = f.library.assignments[v === undefined ? "rush.inside" : ref(v).use];
    if (entry === undefined || (v === undefined && pos(slot) !== "DL")) throw new Error(`${d.id} ${slot}: no assignment`);
    return { slot, entry, listed: v !== undefined };
  });
}

/** Small seeded generator (mulberry32), separate from the sim's Rng. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
