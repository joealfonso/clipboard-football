// The art-director review rules that can be checked without a screen (docs/ASSETS.md, Reviews,
// 2026-11-14), each with its DESIGN.md rule:
// - marks never overlap at the snap, for every unit, at 1024x600 (Spacing);
// - the line is at least 19 px center to center, spread out from the middle (Spacing);
// - linemen stop at contact, so no X ends behind the O he faced (Do not show what the engine didn't decide);
// - paths end at the mark's edge (Shapes);
// - numbers: all at the set and the whistle, named players while live, the collision rule, outside a ring (Spacing);
// - panel text from the engine: names on incompletions, no multiplier in the why line.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlayResult } from "@clipboard-football/shared";
import { whyHeadline } from "../src/engine/headline";
import type { PlayEvent } from "../src/engine/types";
import { layoutFor } from "../src/ui/layout";
import { numberShown, placeNumbers, RING_GAP, trimEnd, type MarkPx } from "../src/ui/marks";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { at, timeline, type Timeline } from "../src/ui/timeline";
import { COMPLETE, RUN, snap } from "./fixtures";
import { playGame } from "./support";

const read = (p: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", p), "utf8"));
const templates = parseTemplates(read("data/ui/templates.json"));
const personnel = read("data/engine/personnel.json") as { offense: Record<string, Record<string, number>>; kick: Record<string, Record<string, number>>; packages: Record<string, Record<string, number>>; presetPackage: Record<string, string> };
const participants = read("data/engine/participants.json") as { returnUnits: Record<string, Record<string, number>> };
const small = layoutFor(1024, 600, templates.field);
const motion = parseMotion(read("data/ui/motion.json"));
const ctx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: small.s, markPx: small.markPx, motion };

const ids = (prefix: string, slots: Record<string, number>): Record<string, string[]> => Object.fromEntries(Object.entries(slots).map(([pos, n]) => [pos, Array.from({ length: n }, (_, i) => `${prefix}${pos}${i + 1}`)]));
const presetOf = (pkg: string): string => Object.entries(personnel.presetPackage).find(([, p]) => p === pkg)?.[0] as string;

/** A pre-snap foul on this unit: no snap, so every mark stays where it set. */
function setOf(offense: PlayEvent["offense"], defense: string | null, off: Record<string, number>, def: Record<string, number>, phase: "scrimmage" | "kickoff" = "scrimmage"): Timeline {
  const play: PlayResult = { kind: "noPlay", seconds: 0, fouls: [{ penalty: "falseStart", by: "offense" }], detail: { participants: {}, onField: { offense: ids("o", off), defense: ids("d", def) }, headline: "h" } };
  const before = snap({ phase, spot: 40 });
  return timeline({ event: { t: "play", before, offense, defense, play, penalty: null, runoffTimeout: false, after: before }, runoffSeconds: 0 }, templates, ctx);
}

const units: [string, Timeline][] = [
  ...Object.entries(personnel.offense).flatMap(([f, off]) =>
    Object.entries(personnel.packages).map(([p, def]): [string, Timeline] => [`${f} vs ${p}`, setOf({ call: "shortPass", formation: f }, presetOf(p), off, def)]),
  ),
  ["punt", setOf({ call: "punt" }, null, personnel.kick["punt"] as Record<string, number>, participants.returnUnits["puntReturn"] as Record<string, number>)],
  ["field goal", setOf({ call: "fieldGoal" }, null, personnel.kick["fieldGoal"] as Record<string, number>, personnel.packages["base"] as Record<string, number>)],
  ["extra point", setOf({ call: "extraPoint" }, null, personnel.kick["extraPoint"] as Record<string, number>, personnel.packages["base"] as Record<string, number>)],
  ["kickoff", setOf({ call: "kickoff" }, null, personnel.kick["kickoff"] as Record<string, number>, participants.returnUnits["kickoffReturn"] as Record<string, number>, "kickoff")],
];

describe("marks at the snap, 1024x600", () => {
  it.each(units)("%s: no two marks overlap", (_name, tl) => {
    const pos = tl.marks.map((m) => ({ id: m.slot + m.side, ...at(m.keys, tl.snapAt) }));
    const clashes: string[] = [];
    for (let i = 0; i < pos.length; i++)
      for (let j = i + 1; j < pos.length; j++) {
        const a = pos[i] as (typeof pos)[number];
        const b = pos[j] as (typeof pos)[number];
        const px = Math.hypot(a.x - b.x, a.y - b.y) * small.s;
        if (px < small.markPx) clashes.push(`${a.id}/${b.id} ${px.toFixed(1)} px`);
      }
    expect(clashes).toEqual([]);
  });

  it.each(units.filter(([n]) => n !== "kickoff"))("%s: the line is at least 19 px center to center", (_name, tl) => {
    for (const side of ["O", "X"] as const) {
      const xs = tl.marks
        .filter((m) => m.side === side && Math.abs(at(m.keys, 0).y - tl.los) <= templates.lineSpacing.maxDepth + 1e-9 && Math.abs(at(m.keys, 0).x - 26.65) <= 10)
        .map((m) => at(m.keys, 0).x)
        .sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(((xs[i] as number) - (xs[i - 1] as number)) * small.s).toBeGreaterThanOrEqual(templates.lineSpacing.minPx - 1e-6);
    }
  });

  it("the QB under center and in Heavy is off the center, and the goal-line LBs clear the DL", () => {
    expect(templates.offense["underCenter"]?.["QB1"]?.[1]).toBeCloseTo(3.25);
    expect(templates.offense["heavy"]?.["QB1"]?.[1]).toBeCloseTo(3.25);
    const gl = templates.defense["goalLine"] ?? {};
    for (const lb of ["LB1", "LB2", "LB3"]) expect(gl[lb]?.[1]).toBe(4.5);
    expect(gl["S1"]?.[1]).toBe(8);
  });
});

describe("blocks: linemen stop at contact", () => {
  /** Pairs of an OL and a DL within a mark's width of each other across, where the X ended below the O. */
  function beaten(tl: Timeline): string[] {
    const end = (m: Timeline["marks"][number]) => at(m.keys, tl.liveEnd);
    const ol = tl.marks.filter((m) => m.position === "OL" && !m.fact);
    // Diagram linemen only: a sacker, or an OL tackling on a turnover return, went where the engine said.
    const dl = tl.marks.filter((m) => m.position === "DL" && !m.fact);
    const out: string[] = [];
    for (const o of ol) for (const d of dl) if (Math.abs(end(o).x - end(d).x) < 1.4 && end(d).y < end(o).y) out.push(`${d.slot} behind ${o.slot}`);
    return out;
  }

  it("on a run and a pass", () => {
    for (const ev of [RUN, COMPLETE]) expect(beaten(timeline({ event: ev, runoffSeconds: 0 }, templates, ctx))).toEqual([]);
  });

  it("on every run, pass and kick of two simulated games", () => {
    const bad: string[] = [];
    for (const seed of [61, 62]) {
      for (const ev of playGame(seed, seed % 2 === 0 ? "home" : "away").events) {
        if (ev.t !== "play" || ev.play.kind === "noPlay" || ev.play.kind === "kickoff" || ev.play.kind === "onsideKick") continue;
        const b = beaten(timeline({ event: ev, runoffSeconds: 0 }, templates, ctx));
        if (b.length > 0) bad.push(`${ev.play.kind} ${ev.offense.call}: ${b.join(", ")}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("offensive linemen use the block tick, not an arrowhead (field.ts draws OL ends as path.block)", () => {
    expect(readFileSync(join(import.meta.dirname, "../src/ui/field.ts"), "utf8")).toMatch(/m\.position === "OL"\) blockTick/);
  });
});

describe("paths end at the mark's edge", () => {
  it("trimEnd cuts the path back by exactly the mark's radius", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0, y: 4 },
      { x: 3, y: 4 },
    ];
    const t = trimEnd(pts, 1);
    expect(t?.[t.length - 1]).toEqual({ x: 2, y: 4 });
    // Across a corner.
    const u = trimEnd(pts, 4);
    expect(u?.[u.length - 1]?.y).toBeCloseTo(3);
    expect(trimEnd(pts, 100)).toBeNull();
  });

  it("every moving mark's drawn path stops one radius short of where the mark is", () => {
    const tl = timeline({ event: COMPLETE, runoffSeconds: 0 }, templates, ctx);
    const edge = (small.markPx / 2 + 1) / small.s;
    for (const m of tl.marks) {
      const keys = m.keys.filter((k) => k.t >= tl.snapAt);
      const trimmed = trimEnd(keys, edge);
      if (trimmed === null) continue;
      const endPt = keys[keys.length - 1] as { x: number; y: number };
      const tip = trimmed[trimmed.length - 1] as { x: number; y: number };
      expect(Math.hypot(tip.x - endPt.x, tip.y - endPt.y)).toBeLessThanOrEqual(edge + 1e-9);
      expect(Math.hypot(tip.x - endPt.x, tip.y - endPt.y)).toBeGreaterThan(0);
    }
  });
});

describe("jersey numbers", () => {
  it("default: all at the set and the whistle, only named players while live", () => {
    expect(numberShown("involved", "set", false)).toBe(true);
    expect(numberShown("involved", "live", false)).toBe(false);
    expect(numberShown("involved", "live", true)).toBe(true);
    expect(numberShown("involved", "whistle", false)).toBe(true);
    expect(numberShown("none", "whistle", true)).toBe(false);
    expect(numberShown("all", "live", false)).toBe(true);
  });

  const mk = (id: string, x: number, y: number, over: Partial<MarkPx> = {}): MarkPx => ({ id, side: "O", x, y, ringed: false, named: false, number: 22, show: true, ...over });
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;

  it("goes under an O and above an X, 2 px off the mark", () => {
    const [o, x] = placeNumbers([mk("o", 100, 100), mk("x", 300, 100, { side: "X" })], 14, 12);
    expect(o?.y).toBe(100 + 7 + 2 + 6);
    expect(x?.y).toBe(100 - 7 - 2 - 6);
  });

  it("a ringed mark's number sits outside the ring", () => {
    const [b] = placeNumbers([mk("c", 100, 100, { ringed: true, named: true })], 14, 12);
    expect((b?.y ?? 0) - (b?.h ?? 0) / 2).toBeGreaterThan(100 + 7 + RING_GAP + 1);
  });

  it("a number that would land on another mark moves to the side, and the named player wins a collision", () => {
    // A QB 2.25 yards behind the center at 1024x600: the center's number can't go under him.
    const center = mk("center", 100, 100);
    const qb = mk("qb", 100, 100 + 2.25 * small.s);
    const boxes = placeNumbers([center, qb], 14, 12);
    const c = boxes.find((b) => b.id === "center");
    expect(c?.x).toBeGreaterThan(100);
    // Two marks side by side whose numbers would collide: the named one draws, the other hides.
    const a = mk("a", 100, 100, { named: true });
    const b = mk("b", 112, 100);
    const both = placeNumbers([b, a], 10, 12);
    expect(both.map((x) => x.id)).toContain("a");
    for (let i = 0; i < both.length; i++) for (let j = i + 1; j < both.length; j++) expect(overlaps(both[i] as never, both[j] as never)).toBe(false);
  });

  it("no two drawn numbers overlap at the whistle of any simulated play", () => {
    const bad: string[] = [];
    for (const ev of playGame(63, "home").events) {
      if (ev.t !== "play") continue;
      const tl = timeline({ event: ev, runoffSeconds: 0 }, templates, ctx);
      const marks = tl.marks.map((m, i) => {
        const p = at(m.keys, tl.liveEnd);
        return mk(m.playerId, p.x * small.s, -p.y * small.s, { side: m.side, named: tl.involved.includes(m.playerId), ringed: tl.rings.includes(m.playerId), number: 10 + (i % 89) });
      });
      const boxes = placeNumbers(marks, small.markPx, 12);
      const named = new Set(marks.filter((m) => m.named).map((m) => m.id));
      for (const id of named) if (!boxes.some((b) => b.id === id)) bad.push(`named ${id} hidden`);
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const p = boxes[i] as (typeof boxes)[number];
          const q = boxes[j] as (typeof boxes)[number];
          if (overlaps(p, q) && !(named.has(p.id) && named.has(q.id))) bad.push(`${p.id}/${q.id}`);
        }
    }
    expect(bad).toEqual([]);
  });
});

describe("panel text the engine supplies", () => {
  const plays = [64, 65].flatMap((seed) => playGame(seed, seed % 2 === 0 ? "home" : "away").events.filter((e): e is PlayEvent => e.t === "play"));

  it("every incompletion names its passer (and nearly every one its target)", () => {
    const inc = plays.filter((p) => p.play.kind === "pass" && p.play.incomplete === true);
    expect(inc.length).toBeGreaterThan(10);
    const parts = inc.map((p) => ((p.play.detail ?? {}) as { participants?: Record<string, unknown> }).participants ?? {});
    for (const pa of parts) expect(pa["passer"]).toBeTypeOf("string");
    expect(parts.filter((pa) => typeof pa["target"] === "string").length / parts.length).toBeGreaterThan(0.9);
  });

  it("no why line carries a multiplier; those stay in the details view", () => {
    for (const p of plays) expect(whyHeadline(p.play) ?? "").not.toMatch(/\(?x\d+(\.\d+)?\)?/);
  });
});
