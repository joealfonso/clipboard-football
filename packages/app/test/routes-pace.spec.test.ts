// Spec tests for docs/specs/m2-play-calling-and-motion.md, "Revision 2026-11-14: real routes and
// slower pace" (criteria R-C1 to R-C15), and docs/DECISIONS.md "Neutral catch depth when the engine
// gives no air yards (lead, 2026-11-15)", written by test-writer from the spec, not the code.
//
// Where a check needs a reading of the spec, the comment says which. The 1,000-game sweeps (R-C7's
// peak-speed share, R-C15's timing budget) are in test/game/routes-pace.heavy.test.ts.
//
// Amended 2026-11-15: the designer restated R-C4 to R-C10 and the term "the read" (the throw on
// passes, the handoff on runs, never the catch; R-Open 7 closed), and DECISIONS.md amended the
// neutral catch depth and added the neutral catch x. R-C5's no-freeze rule now applies to unnamed
// marks from their start to the read only, which settles the earlier conflict with contract 3.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayResult } from "@clipboard-football/shared";
import { readDetail, type PlayEvent } from "../src/engine/types";
import { Animator } from "../src/ui/animator";
import { defenseArt, offenseArt, receiverRoles, slotsFromCounts, type Art } from "../src/ui/art";
import type { FieldScene, FrameOpts } from "../src/ui/field";
import { layoutFor } from "../src/ui/layout";
import { fillet, runRoute, type Pt } from "../src/ui/motion";
import { MotionError, parseMotion, parseTemplates, TemplateError, type Templates } from "../src/ui/templates";
import { at, FIELD_WIDTH, MID_X, timeline, type Key, type Timeline, type TimelineCtx } from "../src/ui/timeline";
import { snap } from "./fixtures";
import { playGame } from "./support";

const root = join(import.meta.dirname, "../../..");
const read = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));
const templatesRaw = read("data/ui/templates.json") as Record<string, unknown>;
const templates = parseTemplates(templatesRaw);
const motionRaw = read("data/ui/motion.json") as Record<string, unknown>;
const motion = parseMotion(motionRaw);
const personnel = read("data/engine/personnel.json") as {
  offense: Record<string, Record<string, number>>;
  packages: Record<string, Record<string, number>>;
  presetPackage: Record<string, string>;
};
const ctx: TimelineCtx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion };
const tlOf = (event: PlayEvent, c: TimelineCtx = ctx, t: Templates = templates): Timeline => timeline({ event, runoffSeconds: 0 }, t, c);

const FORMATIONS = ["shotgun", "underCenter", "pistol", "empty", "heavy"] as const;
const PASS = ["shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"] as const;
const RUNS = ["insideRun", "outsideRun", "qbSneak"] as const;
const LEAVES = [...PASS, ...RUNS];
const PRESETS = Object.keys(personnel.presetPackage);
const KEY = motion.keyMs;
const MAX_Y = 100 + ctx.endZoneYards - 1;

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const speedYdS = (keys: readonly Key[], t0: number, t1: number): number => (dist(at(keys, t0), at(keys, t1)) / (t1 - t0)) * 1000;
const posOf = (s: string): string => s.replace(/\d+$/, "");
const unclamped = (tl: Timeline): boolean => tl.liveEnd - tl.snapAt > motion.live.minMs + 1e-6 && tl.liveEnd - tl.snapAt < motion.live.maxMs - 1e-6;

// ---------------------------------------------------------------- the raw template data, read the spec's way

type RawPt = readonly [number, number];
interface RawRoute {
  readonly pts: readonly { p: RawPt; pauseMs: number; pace: number }[];
  readonly finish: string;
  readonly axis: string;
}
/** Schema change 1 and 2: a bare array is { finish: "sit", axis: "in" }; a waypoint is a pair or { p, pauseMs?, pace? }. */
function normal(v: unknown): RawRoute | undefined {
  if (v === undefined) return undefined;
  const o = (Array.isArray(v) ? { pts: v } : v) as { pts: unknown[]; finish?: string; axis?: string };
  const pts = o.pts.map((w) => (Array.isArray(w) ? { p: w as unknown as RawPt, pauseMs: 0, pace: 1 } : { p: (w as { p: RawPt }).p, pauseMs: (w as { pauseMs?: number }).pauseMs ?? 0, pace: (w as { pace?: number }).pace ?? 1 }));
  return { pts, finish: o.finish ?? "sit", axis: o.axis ?? "in" };
}
const rawGroup = (k: string, name: string): Record<string, unknown> | undefined => (templatesRaw[k] as Record<string, Record<string, unknown>>)[name];
/** Schema change 3: `role:position`, then the role, then the position. */
function chain(table: Record<string, unknown> | undefined, role: string | undefined, pos: string): RawRoute | undefined {
  for (const k of role === undefined ? [pos] : [`${role}:${pos}`, role, pos]) if (table?.[k] !== undefined) return normal(table[k]);
  return undefined;
}

/**
 * R1, derived here from the alignment alone: on each side WR and TE counted from the sideline in;
 * the strong side has more receivers, on a tie more TEs, on a second tie the offense's right.
 */
function rolesOf(align: Record<string, readonly [number, number]>): { roles: Map<string, string>; strong: 1 | -1 } {
  const recv = Object.entries(align).filter(([s]) => posOf(s) === "WR" || posOf(s) === "TE");
  const left = recv.filter(([, a]) => a[0] < 0);
  const right = recv.filter(([, a]) => a[0] > 0);
  const te = (l: typeof recv): number => l.filter(([s]) => posOf(s) === "TE").length;
  const strong: 1 | -1 = right.length !== left.length ? (right.length > left.length ? 1 : -1) : te(right) !== te(left) ? (te(right) > te(left) ? 1 : -1) : 1;
  const roles = new Map<string, string>();
  for (const [list, s] of [[left, -1], [right, 1]] as const) [...list].sort((a, b) => Math.abs(b[1][0]) - Math.abs(a[1][0])).forEach(([slot], i) => roles.set(slot, `${s === strong ? "s" : "w"}${i + 1}`));
  return { roles, strong };
}
const offAlign = (f: string): Record<string, readonly [number, number]> => rawGroup("offense", f) as Record<string, readonly [number, number]>;

/** The R1 table, as the spec prints it. */
const ROLE_TABLE: Record<string, { strong: 1 | -1; roles: Record<string, string> }> = {
  shotgun: { strong: -1, roles: { s1: "WR1", s2: "TE1", w1: "WR2", w2: "WR3" } },
  underCenter: { strong: 1, roles: { s1: "WR2", s2: "TE2", w1: "WR1", w2: "TE1" } },
  pistol: { strong: 1, roles: { s1: "WR2", s2: "TE1", w1: "WR1", w2: "WR3" } },
  empty: { strong: -1, roles: { s1: "WR1", s2: "WR3", s3: "TE1", w1: "WR2", w2: "WR4" } },
  heavy: { strong: 1, roles: { s1: "TE3", s2: "TE2", w1: "TE1" } },
};

/** R3 and States: a template placed from a field start (its axis sign, the sideline margin, the end line minus 1 yd). */
function placeMine(start: Pt, r: RawRoute, strong: number, play: number): Pt[] {
  const sign = r.axis === "strong" ? strong : r.axis === "play" ? play : start.x <= MID_X ? 1 : -1;
  const m = motion.sidelineMarginYards;
  return r.pts.map((w) => ({ x: Math.max(m, Math.min(FIELD_WIDTH - m, start.x + sign * w.p[0])), y: Math.min(MAX_Y, start.y + w.p[1]) }));
}

// ---------------------------------------------------------------- events shaped like the engine's

const ids = (prefix: string, counts: Record<string, number>): Record<string, string[]> => Object.fromEntries(Object.entries(counts).map(([pos, n]) => [pos, Array.from({ length: n }, (_, i) => `${prefix}-${pos}${i + 1}`)]));
interface EvSpec {
  readonly formation: string;
  readonly call: string;
  readonly preset: string;
  readonly result: "complete" | "incomplete" | "run" | "sack" | "interception";
  readonly gain?: number;
  readonly spot?: number;
  readonly parts?: Record<string, string>;
  readonly runLocation?: "left" | "middle" | "right";
  readonly airYards?: number;
  readonly twoPointPlay?: string;
}
function mk(e: EvSpec): PlayEvent {
  const los = e.spot ?? 35;
  const gain = e.gain ?? 0;
  const onField = { offense: ids("O", personnel.offense[e.formation] as Record<string, number>), defense: ids("X", personnel.packages[personnel.presetPackage[e.preset] as string] as Record<string, number>) };
  const detail: Record<string, unknown> = { participants: e.parts ?? {}, onField, headline: "h", yards: gain };
  if (e.runLocation !== undefined) detail["runLocation"] = e.runLocation;
  if (e.airYards !== undefined) detail["airYards"] = e.airYards;
  const end = { spot: los + gain, possession: "offense" as const };
  const play = (
    e.result === "complete"
      ? { kind: "pass", seconds: 6, end, detail }
      : e.result === "incomplete"
        ? { kind: "pass", seconds: 5, incomplete: true, end: { spot: los, possession: "offense" }, detail }
        : e.result === "run"
          ? { kind: "run", seconds: 5, end, detail }
          : e.result === "sack"
            ? { kind: "sack", seconds: 5, end, detail }
            : { kind: "pass", seconds: 6, turnover: "interception", end: { spot: los + gain, possession: "defense" }, detail }
  ) as PlayResult;
  const offense = (e.twoPointPlay !== undefined ? { call: e.call, formation: e.formation, twoPointPlay: e.twoPointPlay } : { call: e.call, formation: e.formation }) as PlayEvent["offense"];
  return { t: "play", before: snap({ spot: los, down: 1, distance: 10 }), offense, defense: e.preset, play, penalty: null, runoffTimeout: false, after: snap({ spot: los + gain, down: 1, distance: 10 }) };
}
const markOf = (tl: Timeline, id: string): Timeline["marks"][number] => {
  const m = tl.marks.find((x) => x.playerId === id);
  if (m === undefined) throw new Error(`no mark ${id}`);
  return m;
};
const setOf = (tl: Timeline, id: string): Pt => at(markOf(tl, id).keys, tl.snapAt);

/** The thrown ball's flight on the field (start: the throw, end: the catch or the incompletion), if any. */
const flightOf = (tl: Timeline): Timeline["paths"][number] | undefined => tl.paths.find((p) => p.kind === "ball");
/**
 * "Term: the read" (amended 2026-11-15): the throw on every pass play, the handoff on handoff runs,
 * the code's sneak read on a sneak. Never the catch. The timeline's `read` is the handoff and the
 * sneak read on runs, so only passes need the throw.
 */
const specRead = (tl: Timeline): number => flightOf(tl)?.start ?? tl.read;

/**
 * A play's template tracks, every receiver unnamed: the same calls, nobody targeted, a 6 s flight
 * thrown behind the QB (air yards -30, so no ring push from the ball in flight) and no live cap,
 * so every receiver runs his template to well past any throw window. On the raw clock (k = 1).
 */
const longCtx: TimelineCtx = { ...ctx, motion: { ...motion, flight: { ...motion.flight, minMs: 6000, maxMs: 6000 }, live: { ...motion.live, maxMs: 1e6 } } };
const templateTl = (e: Omit<EvSpec, "result" | "parts" | "airYards">): Timeline => tlOf(mk({ ...e, result: "complete", gain: e.gain ?? 5, airYards: -30, parts: { passer: "O-QB1" } }), longCtx);

/** DECISIONS.md, "Neutral catch depth", screens amendment: data/ui/templates.json screenFloorYards. */
const SCREEN_FLOOR = templatesRaw["screenFloorYards"] as number;

/** The track is read on the 25 ms key grid: one key of his travel at top speed, plus 0.05 yd. */
const keyTol = (pos: string): number => ((motion.speed[pos] ?? 10) * KEY) / 1000 + 0.05;

/**
 * The catch point by docs/DECISIONS.md, "Neutral catch depth" (with its 2026-11-15 amendment) and
 * "Neutral catch x on the target's route", for a completion with no passLocation. In field yards.
 */
function expectedCatch(e: EvSpec, target: string): Pt {
  const leaf = e.call;
  const los = e.spot ?? 35;
  const gain = e.gain ?? 0;
  const tpl = templateTl(e);
  const track = markOf(tpl, target).keys;
  const drop = tpl.snapAt + (motion.dropMs[leaf] as number);
  const w0 = drop + motion.hitchMs + motion.flight.minMs;
  const w1 = drop + motion.throwHold.maxMs + motion.flight.maxMs;
  // A point counts only if a throw can time it: his arrival there (his track time) minus that
  // throw's flight from the QB's drop point is within throwHold.maxMs of the drop end.
  const qb = chain(rawGroup("routes", leaf), undefined, "QB") as RawRoute;
  const dropPt = placeMine(setOf(tpl, "O-QB1"), qb, rolesOf(offAlign(e.formation)).strong, 0).at(-1) as Pt;
  const flight = (q: Pt): number => Math.max(motion.flight.minMs, Math.min(motion.flight.maxMs, motion.flight.baseMs + motion.flight.perYardMs * dist(dropPt, q)));
  const timeable = (q: Pt, t: number): boolean => t - flight(q) <= drop + motion.throwHold.maxMs;
  const dead = los + gain;
  const depth = templates.passDepth[leaf] as number;
  // The band between the line and the dead spot; a screen's depth behind the line stands.
  const lo = Math.min(los, dead, los + depth);
  const hi = Math.max(los, dead);
  const want = e.airYards !== undefined ? los + e.airYards : Math.max(lo, Math.min(hi, los + depth));
  const m = motion.sidelineMarginYards;
  const clampX = (x: number): number => Math.max(m, Math.min(FIELD_WIDTH - m, x));
  let near: Pt | null = null;
  for (let t = w0; t <= w1; t += KEY) {
    const q = at(track, t);
    if (!timeable(q, t)) continue;
    if (Math.abs(q.y - want) <= 0.5) return { x: clampX(q.x), y: want };
    if (near === null || Math.abs(q.y - want) < Math.abs(near.y - want)) near = q;
  }
  const n = near as Pt;
  // Amended 2026-11-15 (lead), screens: the floor may follow a route behind the screen depth, to
  // his route's own depth but no deeper than screenFloorYards; still between that floor and the dead spot.
  // Amended 2026-11-15 (lead), backfield routes: on any class, when that nearest point is behind the
  // line, the depth may follow his route behind the line, down to the same floor.
  const floor = leaf === "screenPass" || n.y < los ? Math.min(lo, Math.max(los + SCREEN_FLOOR, n.y)) : lo;
  return { x: clampX(n.x), y: e.airYards !== undefined ? want : Math.max(floor, Math.min(hi, n.y)) };
}

/** Three simulated games, for the checks that run over real calls. */
const sample: PlayEvent[] = [71, 72, 73].flatMap((seed) => playGame(seed, seed % 2 === 0 ? "home" : "away", seed).events.filter((e): e is PlayEvent => e.t === "play"));
const scrimmage = sample.filter((e) => e.play.kind === "run" || e.play.kind === "pass" || e.play.kind === "sack");

// ================================================================ R-C1

describe("R-C1: every mark resolves a template through the lookup chain", () => {
  it("every formation x offense class: each player but the run carrier has a route or a line step", () => {
    const missing: string[] = [];
    for (const f of FORMATIONS)
      for (const leaf of LEAVES) {
        const align = offAlign(f);
        const { roles } = rolesOf(align);
        const isRun = (RUNS as readonly string[]).includes(leaf);
        const hasRb = align["RB1"] !== undefined;
        const carrier = !isRun ? null : leaf === "qbSneak" || !hasRb ? "QB1" : "RB1";
        const olXs = Object.entries(align).filter(([s]) => posOf(s) === "OL").map(([, a]) => a[0]);
        for (const [slot, a] of Object.entries(align)) {
          const pos = posOf(slot);
          if (slot === carrier) continue;
          if (pos === "OL") {
            // Schema change 4: the leaf's table, then the family's; OLT (outermost each side) falls back to OL.
            const outer = a[0] === Math.min(...olXs) || a[0] === Math.max(...olXs);
            const keys = outer ? ["OLT", "OL"] : ["OL"];
            const lc = templatesRaw["lineContact"] as Record<string, Record<string, unknown>>;
            const found = keys.some((k) => lc[leaf]?.[k] !== undefined) || keys.some((k) => lc[isRun ? "run" : "pass"]?.[k] !== undefined);
            if (!found) missing.push(`${f} ${leaf} ${slot} (lineContact)`);
            continue;
          }
          if (chain(rawGroup("routes", leaf), roles.get(slot), pos) === undefined) missing.push(`${f} ${leaf} ${slot} (routes.${leaf}, role ${roles.get(slot) ?? "none"})`);
        }
      }
    expect(missing).toEqual([]);
  });

  it("every package x preset: each defender has a zone, a man target or a drop", () => {
    const missing: string[] = [];
    for (const preset of PRESETS) {
      const pkg = personnel.presetPackage[preset] as string;
      const dropSet = (templatesRaw["presetDrops"] as Record<string, string>)[preset];
      if (dropSet === undefined) {
        missing.push(`${preset}: no presetDrops entry`);
        continue;
      }
      const drops = rawGroup("drops", dropSet);
      for (const s of slotsFromCounts(personnel.packages[pkg] as Record<string, number>)) {
        const zone = (templates.zones[preset] ?? {})[s.slot];
        const man = (templates.manTargets[preset] ?? {})[s.slot];
        const drop = drops?.[s.slot] ?? drops?.[s.position];
        if (s.position === "DL" ? drop === undefined : zone === undefined && man === undefined && drop === undefined) missing.push(`${pkg} ${preset} ${s.slot}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("building every formation x class x preset raises no warning (no mark falls back to the default)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      for (const f of FORMATIONS)
        for (const leaf of LEAVES)
          for (const preset of PRESETS) {
            const isRun = (RUNS as readonly string[]).includes(leaf);
            const tl = tlOf(mk({ formation: f, call: leaf, preset, result: isRun ? "run" : "incomplete", gain: isRun ? 3 : 0 }));
            expect(tl.warnings ?? [], `${f} ${leaf} ${preset}`).toEqual([]);
          }
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("States: a mark with no template is reported, naming the file and the key, in tl.warnings; timeline() itself never logs", () => {
    // "At runtime: the existing check-down default, plus a console warning naming the file and key."
    // Coordinator, 2026-11-15: timeline() is side-effect free; it returns the warnings and app.ts logs them.
    const routes = { ...(templates.routes as Record<string, Record<string, unknown>>) };
    const short = { ...(routes["shortPass"] as Record<string, unknown>) };
    delete short["w1"];
    delete short["WR"];
    routes["shortPass"] = short;
    const t = { ...templates, routes } as unknown as Templates;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const tl = tlOf(mk({ formation: "shotgun", call: "shortPass", preset: "nickelCover3", result: "incomplete" }), ctx, t);
      const said = tl.warnings ?? [];
      expect(said.some((s) => s.includes("templates.json") && s.includes("shortPass") && s.includes("w1")), said.join(" | ")).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

// ================================================================ R-C2

describe("R-C2: roles and the mirror", () => {
  it.each(FORMATIONS)("%s: the roles derived by the R1 rule equal the spec's table", (f) => {
    const { roles, strong } = rolesOf(offAlign(f));
    const want = ROLE_TABLE[f] as (typeof ROLE_TABLE)[string];
    expect(strong).toBe(want.strong);
    expect(Object.fromEntries([...roles].map(([slot, role]) => [role, slot]))).toEqual(want.roles);
  });

  it.each(FORMATIONS)("%s: the field and the cards use those roles (receiverRoles on the lined-up marks)", (f) => {
    const slots = slotsFromCounts(personnel.offense[f] as Record<string, number>);
    const art = offenseArt(f, null, slots, templates, 35, ctx.pxPerYard);
    const r = receiverRoles(slots, art.marks);
    const want = ROLE_TABLE[f] as (typeof ROLE_TABLE)[string];
    expect(r.strong).toBe(want.strong);
    expect(Object.fromEntries([...r.roles].map(([slot, role]) => [role, slot]))).toEqual(want.roles);
  });

  // underCenter is left out of the mirror: its alignment is symmetric (WR1 and WR2 at -21 and 21,
  // TE1 and TE2 at -6 and 6), so mirroring it gives the same alignment, and R1's second tie-break
  // (the offense's right) keeps the strong side on the right. The strong side can't swap there.
  const ASYMMETRIC = FORMATIONS.filter((f) => f !== "underCenter");
  const mirrored = (f: string): Templates => {
    const off = { ...(templates.offense as Record<string, Record<string, readonly [number, number]>>) };
    off[f] = Object.fromEntries(Object.entries(off[f] as Record<string, readonly [number, number]>).map(([s, a]) => [s, [-a[0], a[1]] as const]));
    return { ...templates, offense: off } as unknown as Templates;
  };
  const mx = (p: Pt): Pt => ({ x: 2 * MID_X - p.x, y: p.y });

  it.each(ASYMMETRIC)("%s: mirroring the alignment swaps the strong side (R1 rule and receiverRoles)", (f) => {
    const a = rolesOf(offAlign(f));
    const b = rolesOf(mirrored(f).offense[f] as Record<string, readonly [number, number]>);
    expect(b.strong).toBe(-a.strong);
    expect([...b.roles].sort()).toEqual([...a.roles].sort());
    const slots = slotsFromCounts(personnel.offense[f] as Record<string, number>);
    const art = offenseArt(f, null, slots, mirrored(f), 35, ctx.pxPerYard);
    expect(receiverRoles(slots, art.marks).strong).toBe(-a.strong);
  });

  it.each(ASYMMETRIC)("%s: every card path of every class mirrors to within 1e-6 yd", (f) => {
    const slots = slotsFromCounts(personnel.offense[f] as Record<string, number>);
    const bad: string[] = [];
    for (const leaf of LEAVES) {
      const a = offenseArt(f, leaf, slots, templates, 35, ctx.pxPerYard, { margin: motion.sidelineMarginYards, maxY: MAX_Y });
      const b = offenseArt(f, leaf, slots, mirrored(f), 35, ctx.pxPerYard, { margin: motion.sidelineMarginYards, maxY: MAX_Y });
      if (a.paths.length !== b.paths.length) bad.push(`${leaf}: ${a.paths.length} paths vs ${b.paths.length}`);
      for (const p of a.paths) {
        // Same slot and kind, every point mirrored (an outside run's fork may come in either order).
        const match = b.paths.some((q) => q.slot === p.slot && q.kind === p.kind && q.points.length === p.points.length && q.points.every((pt, i) => dist(pt, mx(p.points[i] as Pt)) < 1e-6));
        if (!match) bad.push(`${leaf} ${p.slot} ${p.kind}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it.each(ASYMMETRIC)("%s: on the field, every offensive path mirrors from the snap to the read (passes but the screen, runs without the stalking WRs)", (f) => {
    // The defense is not mirrored, so only paths that depend on the offense alone before the read
    // are compared: stalking receivers shadow a defender (runs, screens) and are left out.
    const bad: string[] = [];
    for (const leaf of LEAVES.filter((l) => l !== "screenPass")) {
      const isRun = (RUNS as readonly string[]).includes(leaf);
      // No run side: the play side is the strong side, so it mirrors too. The engine always names
      // a run's carrier; a pass here names nobody, so every receiver runs his template.
      const carrier = leaf === "qbSneak" || f === "empty" ? "O-QB1" : "O-RB1";
      const ev = mk({ formation: f, call: leaf, preset: "baseCover3", result: isRun ? "run" : "complete", gain: 6, parts: isRun ? { ballCarrier: carrier } : {} });
      const A = tlOf(ev);
      const B = tlOf(ev, ctx, mirrored(f));
      const t1 = Math.min(A.read, B.read);
      for (const m of A.marks.filter((x) => x.side === "O")) {
        if (isRun && m.position === "WR") continue;
        // A mark set on the axis (the center, a back or QB at x = 0) is his own mirror image; which
        // side he gives way to is a tie-break, not a template, so he is left out.
        if (Math.abs(at(m.keys, A.snapAt).x - MID_X) < 1e-9) continue;
        const n = markOf(B, m.playerId);
        for (let t = A.snapAt; t <= t1; t += KEY) {
          const d = dist(mx(at(m.keys, t)), at(n.keys, t));
          if (d > 1e-6) {
            bad.push(`${leaf} ${m.slot} at ${(t - A.snapAt).toFixed(0)} ms: ${d.toFixed(4)} yd`);
            break;
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

// ================================================================ R-C3, R-C4

/** Each receiver (WR, TE) of a formation with its role and resolved route, lateral yards "in"-positive. */
function receiverRoutes(f: string, leaf: string): { slot: string; role: string; route: RawRoute; rel: RawPt[]; align: readonly [number, number] }[] {
  const align = offAlign(f);
  const { roles, strong } = rolesOf(align);
  return [...roles].map(([slot, role]) => {
    const a = align[slot] as readonly [number, number];
    const route = chain(rawGroup("routes", leaf), role, posOf(slot)) as RawRoute;
    // A common side: lateral as "toward the middle" for this player.
    const inSign = a[0] <= 0 ? 1 : -1;
    const sign = route.axis === "strong" ? strong : route.axis === "play" ? strong : inSign;
    const rel = route.pts.map((w) => [sign * w.p[0] * inSign, w.p[1]] as const);
    return { slot, role, route, rel, align: a };
  });
}

describe("R-C3: no two receivers on a play run the same route", () => {
  for (const f of FORMATIONS)
    for (const leaf of PASS)
      it(`${f} ${leaf}`, () => {
        const rs = receiverRoutes(f, leaf);
        expect(rs.length).toBeGreaterThanOrEqual(2);
        const same: string[] = [];
        for (let i = 0; i < rs.length; i++)
          for (let j = i + 1; j < rs.length; j++) {
            const a = rs[i] as (typeof rs)[number];
            const b = rs[j] as (typeof rs)[number];
            if (a.rel.length !== b.rel.length) continue;
            const apart = a.rel.some((p, k) => Math.hypot(p[0] - (b.rel[k] as RawPt)[0], p[1] - (b.rel[k] as RawPt)[1]) > 2);
            if (!apart) same.push(`${a.role} (${a.slot}) and ${b.role} (${b.slot})`);
          }
        expect(same).toEqual([]);
      });
});

const turnsDeg = (pts: readonly RawPt[]): number[] => {
  const all: RawPt[] = [[0, 0], ...pts];
  const out: number[] = [];
  for (let i = 1; i < all.length - 1; i++) {
    const a = all[i - 1] as RawPt;
    const b = all[i] as RawPt;
    const c = all[i + 1] as RawPt;
    const u = [b[0] - a[0], b[1] - a[1]];
    const v = [c[0] - b[0], c[1] - b[1]];
    const cos = ((u[0] as number) * (v[0] as number) + (u[1] as number) * (v[1] as number)) / (Math.hypot(u[0] as number, u[1] as number) * Math.hypot(v[0] as number, v[1] as number));
    out.push((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
  }
  return out;
};

describe("R-C4: routes have breaks, and every concept reaches its depth band", () => {
  for (const f of FORMATIONS)
    for (const leaf of ["shortPass", "intermediatePass", "deepPass", "playAction"])
      it(`${f} ${leaf}`, () => {
        const bad: string[] = [];
        const rs = receiverRoutes(f, leaf);
        for (const r of rs) {
          if (r.route.finish === "stalk" || r.route.finish === "block") continue;
          if (r.route.pts.length < 2) bad.push(`${r.role} (${r.slot}): ${r.route.pts.length} waypoint`);
          else if (!turnsDeg(r.rel).some((d) => d >= 20)) bad.push(`${r.role} (${r.slot}): no turn of 20 degrees (${turnsDeg(r.rel).map((d) => d.toFixed(1)).join(", ")})`);
        }
        // Depth band (decision 4), yards past the line: a route reaches it when its path (from the
        // alignment depth) passes through a point inside it.
        const band = templates.depthBands[leaf] as readonly [number, number];
        const reaching = rs.filter((r) => {
          const ys = [-r.align[1], ...r.route.pts.map((w) => w.p[1] - r.align[1])];
          for (let i = 1; i < ys.length; i++) {
            const lo = Math.min(ys[i - 1] as number, ys[i] as number);
            const hi = Math.max(ys[i - 1] as number, ys[i] as number);
            if (hi >= band[0] && lo <= band[1]) return true;
          }
          return false;
        });
        if (reaching.length < 2) bad.push(`only ${reaching.length} route(s) reach the band [${band[0]}, ${band[1]}]`);
        expect(bad).toEqual([]);
      });
});

// ================================================================ R-C5

describe("R-C5 (amended 2026-11-15): routes at their own pace, then the finish, and no unnamed mark frozen before the read", () => {
  // Synthetic plays: every formation and pass class, the ball to the back (so every WR and TE is
  // unnamed), against a zone preset; plus the passes of three simulated games.
  const synthetic = FORMATIONS.flatMap((f) =>
    PASS.map((leaf) => mk({ formation: f, call: leaf, preset: "nickelCover3", result: "complete", gain: 9, parts: f === "empty" ? { passer: "O-QB1" } : { passer: "O-QB1", target: "O-RB1", receiver: "O-RB1", tackler: "X-LB1" } })),
  );
  const passes = [...synthetic, ...sample.filter((e) => e.play.kind === "pass" && e.offense.formation !== undefined)];

  interface Stretch {
    readonly from: Pt;
    readonly pts: readonly Pt[];
    readonly len: number;
  }
  interface Run {
    ev: PlayEvent;
    tl: Timeline;
    m: Timeline["marks"][number];
    route: RawRoute;
    stretches: Stretch[];
    last: Pt;
  }
  /** Unnamed WRs and TEs on unclamped pass plays, their routes split at the rests (his start and each pause). */
  function runs(): Run[] {
    const got: Run[] = [];
    for (const ev of passes) {
      const tl = tlOf(ev);
      // Unclamped plays only: on a clamped play decision 11's uniform scaling changes every speed.
      if (!unclamped(tl)) continue;
      const f = ev.offense.formation as string;
      const leaf = ev.offense.call === "goForTwo" ? (ev.offense.twoPointPlay as string) : ev.offense.call;
      const { roles, strong } = rolesOf(offAlign(f));
      for (const m of tl.marks) {
        if (m.side !== "O" || (m.position !== "WR" && m.position !== "TE") || m.fact || tl.involved.includes(m.playerId)) continue;
        const route = chain(rawGroup("routes", leaf), roles.get(m.slot), m.position);
        if (route === undefined || route.finish === "stalk" || route.finish === "block") continue;
        const set = at(m.keys, tl.snapAt);
        const placed = placeMine(set, route, strong, strong);
        const stretches: Stretch[] = [];
        let from = set;
        let cur: Pt[] = [];
        placed.forEach((p, i) => {
          cur.push(p);
          if (route.pts[i]?.pauseMs !== 0 || i === placed.length - 1) {
            let len = 0;
            [from, ...cur].forEach((q, j, all) => (len += j === 0 ? 0 : dist(all[j - 1] as Pt, q)));
            stretches.push({ from, pts: cur, len });
            from = p;
            cur = [];
          }
        });
        got.push({ ev, tl, m, route, stretches, last: placed.at(-1) as Pt });
      }
    }
    return got;
  }
  const R = runs();
  /** The first key time at or after t0 where he is within 0.15 yd of p, before t1; NaN if none. */
  const arrive = (keys: readonly Key[], p: Pt, t0: number, t1: number): number => {
    for (let t = Math.ceil(t0 / KEY) * KEY; t <= t1; t += KEY) if (dist(at(keys, t), p) <= 0.15) return t;
    return NaN;
  };

  it("the sample has routes to check", () => {
    expect(R.length).toBeGreaterThan(100);
  });

  it("per stretch between rests, peak speed is at least 0.85 x routePace x top (6 yd or longer) or 0.6 x (2 to 6 yd)", () => {
    // Stretches he finishes while still on his route (before pursuit starts) are checked.
    const slow: string[] = [];
    let checked = 0;
    for (const r of R) {
      const top = motion.speed[r.m.position] as number;
      let t0 = r.tl.snapAt;
      for (const [i, st] of r.stretches.entries()) {
        const end = st.pts.at(-1) as Pt;
        const t1 = arrive(r.m.keys, end, t0, r.tl.read);
        if (Number.isNaN(t1)) break;
        const share = st.len >= 6 ? 0.85 : st.len >= 2 ? 0.6 : 0;
        let peak = 0;
        for (let t = t0; t + KEY <= t1; t += KEY) peak = Math.max(peak, speedYdS(r.m.keys, t, t + KEY));
        checked++;
        if (peak < share * motion.routePace * top - 1e-9) slow.push(`${r.ev.offense.formation} ${r.ev.offense.call} ${r.m.slot} stretch ${i + 1} (${st.len.toFixed(1)} yd): peak ${peak.toFixed(2)} < ${(share * motion.routePace * top).toFixed(2)} yd/s`);
        t0 = t1;
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect([...new Set(slow)]).toEqual([]);
  });

  it("after his last waypoint he follows his finish until the read (the throw): a sit drifts at most sit.maxYards, a continue keeps on at continuePace", () => {
    // Unnamed motion "still obeys the 2.5-yard ring" (Motion), so from the first time the ball comes
    // within that ring of him a push is allowed and his finish is no longer checked.
    const ring = motion.pursuit.ringYards;
    const bad: string[] = [];
    for (const r of R) {
      const read = specRead(r.tl);
      const tArrive = arrive(r.m.keys, r.last, r.tl.snapAt, read);
      if (Number.isNaN(tArrive)) continue;
      let t1 = read;
      for (let t = tArrive; t <= read; t += KEY)
        if (dist(at(r.m.keys, t), at(r.tl.ball, t)) <= ring + 0.25) {
          t1 = t;
          break;
        }
      if (t1 - tArrive < 4 * KEY) continue;
      const label = `${r.ev.offense.formation} ${r.ev.offense.call} ${r.m.slot} (${r.route.finish})`;
      if (r.route.finish === "sit") {
        let far = 0;
        for (let t = tArrive; t <= t1; t += KEY) far = Math.max(far, dist(at(r.m.keys, t), r.last));
        // 0.15 yd: the arrival tolerance.
        if (far > motion.sit.maxYards + 0.15 + 1e-9) bad.push(`${label}: drifted ${far.toFixed(2)} yd`);
      } else if (r.route.finish === "continue") {
        const top = motion.speed[r.m.position] as number;
        const t2 = Math.min(t1, tArrive + 600);
        const v = speedYdS(r.m.keys, tArrive, t2);
        // He keeps his last direction (a straight line, so the chord speed is his speed), unless the
        // sideline turns him or the end line stops him (States).
        const q = at(r.m.keys, t2);
        const nearEdge = Math.min(q.x, FIELD_WIDTH - q.x) < motion.sidelineMarginYards + 3 || MAX_Y - q.y < 3;
        if (!nearEdge && Math.abs(v - motion.continuePace * top) > 0.1 * motion.continuePace * top) bad.push(`${label}: ${v.toFixed(2)} yd/s over ${(t2 - tArrive).toFixed(0)} ms, want ${(motion.continuePace * top).toFixed(2)} (spot ${r.ev.before.spot})`);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it("no unnamed mark is frozen from his start to the read (the throw or the handoff), every run, pass and sack of three games", () => {
    // Only that window: after the read pursuers may brake at the ring (contract 3), named players
    // stop at their anchors, and the settle applies (M7).
    const frozen: string[] = [];
    let plays = 0;
    for (const ev of scrimmage) {
      const tl = tlOf(ev);
      const t0 = tl.snapAt + motion.maxStartMs + KEY;
      const t1 = Math.min(specRead(tl), tl.liveEnd);
      if (t1 - t0 < 2 * KEY) continue;
      plays++;
      for (const m of tl.marks) {
        if (tl.involved.includes(m.playerId)) continue;
        for (let t = Math.ceil(t0 / KEY) * KEY; t + KEY <= t1; t += KEY) {
          if (dist(at(m.keys, t), at(m.keys, t + KEY)) < 1e-6) {
            frozen.push(`${ev.play.kind} ${ev.offense.formation ?? ""} ${ev.offense.call} vs ${ev.defense ?? ""} (spot ${ev.before.spot}): ${m.side}${m.slot} still at ${(t - tl.snapAt).toFixed(0)} ms`);
            break;
          }
        }
      }
    }
    expect(plays).toBeGreaterThan(200);
    expect(frozen.slice(0, 40)).toEqual([]);
  });
});

// ================================================================ R-C6

/** Speeds (yd/s) per key interval and the arc length at each key. */
function profile(keys: readonly Key[], t0: number, t1: number): { t: number; p: Pt; s: number; v: number }[] {
  const out: { t: number; p: Pt; s: number; v: number }[] = [];
  let s = 0;
  for (let t = t0; t + KEY <= t1; t += KEY) {
    const a = at(keys, t);
    const b = at(keys, t + KEY);
    out.push({ t, p: a, s, v: (dist(a, b) / KEY) * 1000 });
    s += dist(a, b);
  }
  return out;
}
const offLine = (p: Pt, a: Pt, b: Pt): number => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / dist(a, b);
const turnAt = (a: Pt, b: Pt, c: Pt): number => {
  const cos = ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (dist(a, b) * dist(b, c));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
};

/**
 * R-C6 (amended 2026-11-15) on one route run, for each break he reaches before t1:
 * - apex: at most 1.1 x pace x routePace x top (sharpPace over sharpDeg, else roundPace);
 * - plant: on a stem of at least L = plantYards + 0.5 x routePace x top x accelMs / 1000 from the
 *   previous rest, speed falls monotonically over the plantYards before the arc; on a shorter stem,
 *   the apex is no higher than that stem's own peak;
 * - re-accel: in every case speed rises over the reaccelYards after the arc (up to the next
 *   break's plant, which is that break's business).
 * `rests` are the indexes in `pts` of his start and his pause waypoints. One line per break and failure.
 */
function plantCheck(label: string, keys: readonly Key[], t0: number, t1: number, pts: readonly Pt[], rests: ReadonlySet<number>, pos: string, finish: string): string[] {
  const bad: string[] = [];
  const prof = profile(keys, t0, t1);
  const F = motion.fillet;
  const top = motion.speed[pos] as number;
  const L = F.plantYards + (0.5 * motion.routePace * top * (motion.accelMs[pos] as number)) / 1000;
  const arcs: { sA: number; sB: number }[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1] as Pt;
    const b = pts[i] as Pt;
    const c = pts[i + 1] as Pt;
    const turn = turnAt(a, b, c);
    // A pause waypoint is a rest that splits the route (R-C5), not a filleted break.
    if (turn < 1 || prof.length < 3 || rests.has(i)) {
      arcs.push({ sA: NaN, sB: NaN });
      continue;
    }
    const pace = turn > F.sharpDeg ? F.sharpPace : F.roundPace;
    const near = prof.reduce((bi, q, k) => (dist(q.p, b) < dist((prof[bi] as (typeof prof)[number]).p, b) ? k : bi), 0);
    if (near >= prof.length - 2 || dist((prof[near] as (typeof prof)[number]).p, b) > 2.5) {
      arcs.push({ sA: NaN, sB: NaN });
      continue;
    }
    let k0 = near;
    while (k0 > 0 && offLine((prof[k0] as (typeof prof)[number]).p, a, b) > 0.005) k0--;
    let k1 = near;
    while (k1 < prof.length - 1 && offLine((prof[k1] as (typeof prof)[number]).p, b, c) > 0.005) k1++;
    const sA = (prof[k0] as (typeof prof)[number]).s;
    const sB = (prof[k1] as (typeof prof)[number]).s;
    arcs.push({ sA, sB });
    // The stem: path length from the previous rest to this break.
    let rest = i - 1;
    while (rest > 0 && !rests.has(rest)) rest--;
    let stem = 0;
    for (let j = rest + 1; j <= i; j++) stem += dist(pts[j - 1] as Pt, pts[j] as Pt);
    const sRest = prof.reduce((bi, q, k) => (dist(q.p, pts[rest] as Pt) < dist((prof[bi] as (typeof prof)[number]).p, pts[rest] as Pt) ? k : bi), 0);
    const apex = ((prof[near] as (typeof prof)[number]).v + (prof[Math.max(0, near - 1)] as (typeof prof)[number]).v) / 2;
    const name = `${label} break ${i} (${turn.toFixed(0)} deg, stem ${stem.toFixed(1)} yd)`;
    const cap = 1.1 * pace * motion.routePace * top;
    if (apex > cap + 1e-9) bad.push(`${name}: apex ${apex.toFixed(2)} yd/s > ${cap.toFixed(2)}`);
    const tol = 0.02 * motion.routePace * top;
    if (stem >= L) {
      const fall = prof.filter((q) => q.s >= sA - F.plantYards && q.s <= sA);
      const up = fall.findIndex((q, j) => j > 0 && q.v > (fall[j - 1] as (typeof fall)[number]).v + tol);
      if (up > 0) bad.push(`${name}: speed rises inside the plant (${(fall[up - 1] as (typeof fall)[number]).v.toFixed(2)} to ${(fall[up] as (typeof fall)[number]).v.toFixed(2)} yd/s)`);
    } else {
      const stemPeak = Math.max(...prof.slice(sRest, k0 + 1).map((q) => q.v));
      if (apex > stemPeak + tol) bad.push(`${name}: short stem, apex ${apex.toFixed(2)} above the stem's peak ${stemPeak.toFixed(2)} yd/s`);
    }
  }
  // Re-accel after each arc, up to the next break's plant or the route's end.
  arcs.forEach((r, j) => {
    if (Number.isNaN(r.sB)) return;
    const next = arcs.slice(j + 1).find((x) => !Number.isNaN(x.sA));
    const stop = Math.min(r.sB + F.reaccelYards, next === undefined ? Infinity : next.sA - F.plantYards);
    const rise = prof.filter((q) => q.s >= r.sB && q.s <= stop);
    const down = rise.findIndex((q, k) => k > 0 && q.v < (rise[k - 1] as (typeof rise)[number]).v - 0.02 * motion.routePace * top);
    const legOut = dist(pts[j + 1] as Pt, pts[j + 2] as Pt);
    // Exempt (lead, 2026-11-15): the leg after the break is his last and ends in a sit or block finish.
    if (j + 2 === pts.length - 1 && (finish === "sit" || finish === "block")) return;
    if (down > 0) bad.push(`${label} break ${j + 1} (${j + 2 === pts.length - 1 ? "last" : "inner"} leg ${legOut.toFixed(1)} yd): speed falls inside the re-acceleration (${(rise[down - 1] as (typeof rise)[number]).v.toFixed(2)} to ${(rise[down] as (typeof rise)[number]).v.toFixed(2)} yd/s, ${((rise[down] as (typeof rise)[number]).s - r.sB).toFixed(2)} yd after the arc)`);
  });
  return bad;
}
describe("R-C6 (amended 2026-11-15): a visible plant at every break, its paces from motion.json", () => {
  const opts = (pos: string, endPace: number) => ({ top: motion.speed[pos] as number, pace: motion.routePace, endPace, accelMs: motion.accelMs[pos] as number, decelMs: motion.decelMs, keyMs: KEY, fillet: motion.fillet, pause: motion.sit });
  const run = (raw: readonly RawPt[], endPace: number, m = motion) => {
    const start = { x: 10, y: 30 };
    const pts = raw.map((p) => ({ x: start.x + p[0], y: start.y + p[1] }));
    const r = runRoute(start, pts.map((p) => ({ p, pauseMs: 0, pace: 1 })), 0, { ...opts("WR", endPace), fillet: m.fillet });
    return { keys: r.keys, end: r.end, pts: [start, ...pts] };
  };
  const WR = motion.speed["WR"] as number;

  it("L is 4.3 yd for a WR at current values, as the spec says", () => {
    expect(motion.fillet.plantYards + (0.5 * motion.routePace * WR * (motion.accelMs["WR"] as number)) / 1000).toBeCloseTo(4.3, 1);
  });

  it("long stems (post, square-in, comeback) and short stems (slant, flat, speed out), on runRoute", () => {
    const cases: [string, RawPt[], string][] = [
      ["post", [[0, 12], [6, 24]], "continue"],
      ["square-in", [[0, 10], [6, 10.5]], "continue"],
      ["comeback", [[0, 13], [-3, 11.5]], "sit"],
      ["slant", [[0, 3], [5, 8]], "continue"],
      ["flat", [[-1, 2], [-7, 4]], "continue"],
      ["speed out", [[0, 2.5], [-4, 3]], "continue"],
    ];
    const bad = cases.flatMap(([name, raw, finish]) => {
      const r = run(raw, finish === "sit" ? motion.sit.pace : motion.continuePace);
      return plantCheck(name, r.keys, 0, r.end, r.pts, new Set([0]), "WR", finish);
    });
    expect(bad).toEqual([]);
  });

  it("every receiver break on the field, every formation and pass class", () => {
    const bad: string[] = [];
    for (const f of FORMATIONS)
      for (const leaf of PASS) {
        const tl = templateTl({ formation: f, call: leaf, preset: "nickelCover3" });
        const { roles, strong } = rolesOf(offAlign(f));
        for (const m of tl.marks.filter((x) => x.side === "O" && (x.position === "WR" || x.position === "TE"))) {
          const route = chain(rawGroup("routes", leaf), roles.get(m.slot), m.position);
          if (route === undefined) continue;
          const set = at(m.keys, tl.snapAt);
          const placed = placeMine(set, route, strong, strong);
          const pts: Pt[] = [set];
          const rests = new Set<number>([0]);
          placed.forEach((p, i) => {
            if (dist(p, pts.at(-1) as Pt) <= 1e-6) return;
            pts.push(p);
            if ((route.pts[i]?.pauseMs ?? 0) > 0) rests.add(pts.length - 1);
          });
          bad.push(...plantCheck(`${f} ${leaf} ${m.slot}`, m.keys, tl.snapAt, tl.read, pts, rests, m.position, route.finish));
        }
      }
    expect(bad).toEqual([]);
  });

  it("the break paces are load-bearing data: halving sharpPace halves the apex speed", () => {
    const half = { ...motion, fillet: { ...motion.fillet, sharpPace: motion.fillet.sharpPace / 2 } };
    const apexOf = (m: typeof motion): number => {
      const r = run([[0, 10], [8, 10]], motion.continuePace, m);
      const prof = profile(r.keys, 0, r.end);
      const corner = r.pts[1] as Pt;
      const k = prof.reduce((bi, q, j) => (dist(q.p, corner) < dist((prof[bi] as (typeof prof)[number]).p, corner) ? j : bi), 0);
      return (prof[k] as (typeof prof)[number]).v;
    };
    expect(apexOf(half) / apexOf(motion)).toBeGreaterThan(0.4);
    expect(apexOf(half) / apexOf(motion)).toBeLessThan(0.6);
  });

  it("no pace constant remains in motion.ts (the old 0.55 and 0.85 break slowdowns)", () => {
    const src = readFileSync(join(import.meta.dirname, "../src/ui/motion.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/(?<![\d.])0?\.(55|85)(?!\d)/);
  });
});

// ================================================================ R-C7 (the sweep is in the heavy file), R8

describe("R-C7 (amended 2026-11-15) and R8: the target's path, the catch point and the throw time", () => {
  const cases: { f: string; leaf: string; target: string; gain: number }[] = [
    { f: "shotgun", leaf: "shortPass", target: "O-WR1", gain: 7 },
    { f: "shotgun", leaf: "intermediatePass", target: "O-WR2", gain: 14 },
    { f: "shotgun", leaf: "deepPass", target: "O-WR1", gain: 31 },
    { f: "pistol", leaf: "deepPass", target: "O-WR1", gain: 25 },
    { f: "empty", leaf: "intermediatePass", target: "O-WR3", gain: 12 },
    { f: "underCenter", leaf: "playAction", target: "O-TE2", gain: 16 },
    { f: "heavy", leaf: "shortPass", target: "O-TE3", gain: 6 },
    { f: "shotgun", leaf: "screenPass", target: "O-RB1", gain: 5 },
  ];

  for (const c of cases)
    it(`${c.f} ${c.leaf} to ${c.target}: his template to the throw, the DECISIONS catch point at catch time, the throw by R8`, () => {
      const spec: EvSpec = { formation: c.f, call: c.leaf, preset: "nickelCover3", result: "complete", gain: c.gain, parts: { passer: "O-QB1", target: c.target, receiver: c.target, tackler: "X-CB1" } };
      const tl = tlOf(mk(spec));
      expect(unclamped(tl), "an unclamped play").toBe(true);
      const tplTl = templateTl({ formation: c.f, call: c.leaf, preset: "nickelCover3", gain: c.gain });
      const tpl = markOf(tplTl, c.target);
      // Both clocks start at the same snap time (no huddle in either).
      expect(tplTl.snapAt).toBe(tl.snapAt);
      const me = markOf(tl, c.target);
      const top = motion.speed[me.position] as number;
      const flight = flightOf(tl);
      expect(flight).toBeDefined();
      const throwT = (flight as { start: number }).start;
      const catchT = (flight as { end: number }).end;
      const cPt = (flight as { points: readonly Pt[] }).points.at(-1) as Pt;
      // From his start to the throw he is on his template track (within 0.1 yd): never an earlier bend.
      let off: string | null = null;
      for (let t = tl.snapAt; t <= throwT && off === null; t += KEY) {
        const d = dist(at(me.keys, t), at(tpl.keys, t));
        if (d > 0.1) off = `${d.toFixed(2)} yd off his template ${(t - tl.snapAt).toFixed(0)} ms after the snap (throw at ${(throwT - tl.snapAt).toFixed(0)})`;
      }
      expect(off).toBeNull();
      // The catch point by the two DECISIONS.md entries, and he is there at catch time.
      const want = expectedCatch(spec, c.target);
      expect(dist(cPt, want), `catch at (${(cPt.x - MID_X).toFixed(2)}, ${(cPt.y - 35).toFixed(2)}), DECISIONS say (${(want.x - MID_X).toFixed(2)}, ${(want.y - 35).toFixed(2)})`).toBeLessThan(keyTol(me.position));
      expect(dist(at(me.keys, catchT), cPt), "at the catch point at catch time").toBeLessThan(0.1);
      // R8: max(drop end + hitch, arrival at natural pace - flight), the wait capped at throwHold.maxMs after the drop.
      const qbRoute = chain(rawGroup("routes", c.leaf), undefined, "QB") as RawRoute;
      const dropPt = placeMine(setOf(tl, "O-QB1"), qbRoute, rolesOf(offAlign(c.f)).strong, 0).at(-1) as Pt;
      const drop = tl.snapAt + (motion.dropMs[c.leaf] as number);
      const fl = Math.max(motion.flight.minMs, Math.min(motion.flight.maxMs, motion.flight.baseMs + motion.flight.perYardMs * dist(dropPt, cPt)));
      expect(Math.abs(catchT - throwT - fl), "flight time from motion.json").toBeLessThanOrEqual(1);
      // His arrival at the catch point at natural pace: when his template comes nearest it, plus the rest at top speed.
      let tNear = tl.snapAt;
      let dNear = Infinity;
      for (let t = tl.snapAt; t <= tl.snapAt + 6000; t += KEY) {
        const d = dist(at(tpl.keys, t), cPt);
        if (d < dNear - 1e-9) {
          dNear = d;
          tNear = t;
        }
      }
      const arrival = tNear + (dNear / top) * 1000;
      const r8 = Math.max(drop + motion.hitchMs, Math.min(arrival - fl, drop + motion.throwHold.maxMs));
      expect(Math.abs(throwT - r8), `throw at ${(throwT - tl.snapAt).toFixed(0)} ms, R8 says ${(r8 - tl.snapAt).toFixed(0)} ms`).toBeLessThanOrEqual(2 * KEY);
    });
});

// ================================================================ R-C8

describe("R-C8: the run game", () => {
  const runs: { ev: PlayEvent; f: string; leaf: string; loc: "left" | "right" | undefined }[] = [];
  for (const f of FORMATIONS)
    for (const leaf of RUNS)
      for (const loc of ["left", "right", undefined] as const) {
        const hasRb = personnel.offense[f]?.["RB"] !== undefined && (personnel.offense[f]?.["RB"] as number) > 0;
        const carrier = leaf === "qbSneak" || !hasRb ? "O-QB1" : "O-RB1";
        runs.push({ f, leaf, loc, ev: mk({ formation: f, call: leaf, preset: "nickelCover3", result: "run", gain: leaf === "qbSneak" ? 1 : 4, parts: { ballCarrier: carrier, tackler: "X-LB1" }, ...(loc === undefined ? {} : { runLocation: loc }) }) });
      }
  const playSign = (r: (typeof runs)[number]): number => (r.loc === "left" ? -1 : r.loc === "right" ? 1 : rolesOf(offAlign(r.f)).strong);
  const label = (r: (typeof runs)[number]): string => `${r.f} ${r.leaf} ${r.loc ?? "no runLocation"}`;

  /** When a lineman (or inline TE) reaches his contact point: his step from data, placed toward the play side. */
  function engageEnd(tl: Timeline, m: Timeline["marks"][number], leaf: string, sign: number): number {
    const set = at(m.keys, tl.snapAt);
    const lc = templatesRaw["lineContact"] as Record<string, Record<string, unknown>>;
    const route = m.position === "TE" ? chain(rawGroup("routes", leaf), undefined, "TE") : normal(lc[leaf]?.["OL"] ?? lc["run"]?.["OL"]);
    const contact = placeMine(set, route as RawRoute, sign, sign).at(-1) as Pt;
    let bestT = tl.snapAt;
    for (let t = tl.snapAt; t <= tl.liveEnd; t += KEY) {
      if (dist(at(m.keys, t), contact) < dist(at(m.keys, bestT), contact)) bestT = t;
      if (dist(at(m.keys, t), contact) < 0.05) return t;
    }
    return bestT;
  }
  const inline = (tl: Timeline, m: Timeline["marks"][number]): boolean => {
    const p = at(m.keys, tl.snapAt);
    return m.position === "TE" && Math.abs(p.x - MID_X) <= 8 && tl.los - p.y <= 1.5;
  };

  it("at engage end every OL and inline TE has stepped toward the play side: 0.7 yd inside, 1.4 yd outside, at most 0.5 on a sneak", () => {
    const bad: string[] = [];
    for (const r of runs) {
      const tl = tlOf(r.ev);
      const s = playSign(r);
      for (const m of tl.marks.filter((x) => x.side === "O" && (x.position === "OL" || inline(tl, x)))) {
        const t = engageEnd(tl, m, r.leaf, s);
        const moved = (at(m.keys, t).x - at(m.keys, tl.snapAt).x) * s;
        if (r.leaf === "insideRun" && moved < 0.7) bad.push(`${label(r)} ${m.slot}: ${moved.toFixed(2)}`);
        if (r.leaf === "outsideRun" && moved < 1.4) bad.push(`${label(r)} ${m.slot}: ${moved.toFixed(2)}`);
        if (r.leaf === "qbSneak" && Math.abs(moved) > 0.5) bad.push(`${label(r)} ${m.slot}: ${moved.toFixed(2)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("engaged pairs stay in contact (M6): from engage to the read the pair's distance changes by at most 0.3 yd", () => {
    // Reading of M6 here: the pair keeps the distance it engaged at (they drift together).
    const bad: string[] = [];
    for (const r of runs.filter((x) => x.leaf !== "qbSneak")) {
      const tl = tlOf(r.ev);
      const s = playSign(r);
      const ol = tl.marks.filter((m) => m.side === "O" && m.position === "OL");
      for (const d of tl.marks.filter((m) => m.side === "X" && m.position === "DL" && !m.fact)) {
        const d0 = at(d.keys, tl.snapAt);
        const o = ol.reduce((b, m) => (dist(at(m.keys, tl.snapAt), d0) < dist(at(b.keys, tl.snapAt), d0) ? m : b));
        const tE = Math.max(engageEnd(tl, o, r.leaf, s), tl.snapAt + 200);
        const ref = dist(at(o.keys, tE), at(d.keys, tE));
        for (let t = tE; t <= tl.read; t += KEY) {
          const now = dist(at(o.keys, t), at(d.keys, t));
          if (Math.abs(now - ref) > 0.3) {
            bad.push(`${label(r)} ${o.slot}-${d.slot}: ${ref.toFixed(2)} to ${now.toFixed(2)} yd at ${(t - tl.snapAt).toFixed(0)} ms`);
            break;
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("after the handoff the QB moves at least 2.5 yd away from the play side", () => {
    const bad: string[] = [];
    for (const r of runs.filter((x) => x.leaf !== "qbSneak" && x.f !== "empty")) {
      const tl = tlOf(r.ev);
      const s = playSign(r);
      const qb = markOf(tl, "O-QB1");
      const x0 = at(qb.keys, tl.read).x;
      let away = 0;
      for (let t = tl.read; t <= tl.liveEnd; t += KEY) away = Math.max(away, (x0 - at(qb.keys, t).x) * s);
      if (away < 2.5) bad.push(`${label(r)}: ${away.toFixed(2)} yd`);
    }
    expect(bad).toEqual([]);
  });

  it("on an outside run the carrier's x motion from the mesh to the line has the play side's sign (the Problem 4 bug)", () => {
    const bad: string[] = [];
    for (const r of runs.filter((x) => x.leaf === "outsideRun" && x.f !== "empty")) {
      const tl = tlOf(r.ev);
      const s = playSign(r);
      const rb = markOf(tl, "O-RB1");
      let net = 0;
      for (let t = tl.read; t + KEY <= tl.liveEnd && at(rb.keys, t).y < tl.los; t += KEY) {
        const dx = (at(rb.keys, t + KEY).x - at(rb.keys, t).x) * s;
        if (dx < -0.02) {
          bad.push(`${label(r)}: wrong way ${(-dx).toFixed(3)} yd at ${(t - tl.snapAt).toFixed(0)} ms`);
          break;
        }
        net += dx;
      }
      if (net <= 0) bad.push(`${label(r)}: net ${net.toFixed(2)} yd`);
    }
    expect(bad).toEqual([]);
  });

  it("stalk (amended 2026-11-15): each WR releases 2 yd upfield, then holds within B once he has closed, and closes on 80% of longer plays", () => {
    const bad: string[] = [];
    let windows = 0;
    let longPlays = 0;
    let closed = 0;
    for (const r of runs) {
      const tl = tlOf(r.ev);
      const defs = tl.marks.filter((m) => m.side === "X" && (m.position === "CB" || m.position === "S"));
      for (const w of tl.marks.filter((m) => m.side === "O" && m.position === "WR")) {
        const p0 = at(w.keys, tl.snapAt);
        // R9: his defender is the nearest CB or S at the set on his side.
        const side = Math.sign(p0.x - MID_X);
        const pool = defs.filter((d) => Math.sign(at(d.keys, tl.snapAt).x - MID_X) === side);
        const mine = (pool.length > 0 ? pool : defs).reduce((b, d) => (dist(at(d.keys, tl.snapAt), p0) < dist(at(b.keys, tl.snapAt), p0) ? d : b));
        if (tl.involved.includes(mine.playerId)) continue;
        const B = motion.stalk.contactYards + ((motion.speed[mine.position] as number) * motion.stalk.lagMs) / 1000 + 0.5;
        const gap = (t: number): number => dist(at(w.keys, t), at(mine.keys, t));
        // Release: at least 2 yd upfield; it ends where his 3 yd release step ends (nearest approach to it).
        const rel = { x: p0.x, y: p0.y + 3 };
        let up = 0;
        let tRel = tl.snapAt;
        for (let t = tl.snapAt; t <= tl.liveEnd; t += KEY) {
          up = Math.max(up, at(w.keys, t).y - p0.y);
          if (dist(at(w.keys, t), rel) < dist(at(w.keys, tRel), rel)) tRel = t;
        }
        if (up < 2) bad.push(`${label(r)} ${w.slot}: released ${up.toFixed(2)} yd upfield`);
        // Hold: from the first time within B to the whistle, at least 60% within B when the window is 300 ms or more.
        let t0 = NaN;
        for (let t = tl.snapAt; t <= tl.liveEnd; t += KEY)
          if (gap(t) <= B) {
            t0 = t;
            break;
          }
        if (!Number.isNaN(t0) && tl.liveEnd - t0 >= 300) {
          windows++;
          let n = 0;
          let inB = 0;
          for (let t = t0; t <= tl.liveEnd; t += KEY) {
            n++;
            if (gap(t) <= B) inB++;
          }
          if (inB / n < 0.6) bad.push(`${label(r)} ${w.slot} on ${mine.slot}: within ${B.toFixed(1)} yd ${((100 * inB) / n).toFixed(0)}% of his ${(tl.liveEnd - t0).toFixed(0)} ms window`);
        }
        // Approach, over plays with 1,000 ms or more from his release end to the whistle.
        if (tl.liveEnd - tRel >= 1000) {
          longPlays++;
          if (!Number.isNaN(t0) || gap(tl.liveEnd) < gap(tRel)) closed++;
        }
      }
    }
    expect(windows).toBeGreaterThan(10);
    expect(longPlays).toBeGreaterThan(10);
    expect(bad).toEqual([]);
    expect(closed / longPlays, `closed on ${closed} of ${longPlays} longer plays`).toBeGreaterThanOrEqual(0.8);
  });
});

// ================================================================ R-C9

describe("R-C9: no pre-read leak", () => {
  /** The read as the spec defines it (decision 13): the handoff, or on a pass the throw. */
  const readOf = (tl: Timeline): number => tl.paths.find((p) => p.kind === "ball")?.start ?? tl.read;
  /** Defender positions from the snap to the earlier read, every 5 ms; returns the first difference. */
  function leak(a: Timeline, b: Timeline): string | null {
    expect(unclamped(a) && unclamped(b), "both unclamped").toBe(true);
    const t1 = Math.min(readOf(a), readOf(b));
    for (const m of a.marks.filter((x) => x.side === "X")) {
      const n = markOf(b, m.playerId);
      for (let t = a.snapAt; t <= t1; t += 5) {
        const d = dist(at(m.keys, t), at(n.keys, t));
        if (d > 1e-9) return `${m.slot} differs by ${d.toFixed(4)} yd at ${(t - a.snapAt).toFixed(0)} ms`;
      }
    }
    return null;
  }
  const pass = (result: EvSpec["result"], gain: number, parts: Record<string, string>, f = "shotgun", call = "shortPass", preset = "nickelCover3"): PlayEvent => mk({ formation: f, call, preset, result, gain, parts: { passer: "O-QB1", ...parts } });

  for (const [f, call, preset] of [
    ["shotgun", "shortPass", "nickelCover3"],
    ["shotgun", "deepPass", "nickel2Man"],
    ["pistol", "intermediatePass", "nickelCover1"],
    ["empty", "playAction", "dimeCover4"],
    ["underCenter", "screenPass", "baseCover2"],
  ] as const)
    it(`${f} ${call} vs ${preset}: different targets, catch points and results draw the same defense to the read`, () => {
      // Three results with three targets and catch points; those that come out clamped (a quick
      // incompletion under the 1.8 s floor) are left out, as R-C9 says, but two must remain.
      const tls = [
        tlOf(pass("complete", 18, { target: "O-WR1", receiver: "O-WR1", tackler: "X-CB1" }, f, call, preset)),
        tlOf(pass("incomplete", 0, { target: "O-TE1" }, f, call, preset)),
        tlOf(pass("complete", 9, { target: "O-WR2", receiver: "O-WR2", tackler: "X-LB1" }, f, call, preset)),
        tlOf(pass("complete", 26, { target: "O-TE1", receiver: "O-TE1", tackler: "X-S2" }, f, call, preset)),
      ].filter(unclamped);
      expect(tls.length).toBeGreaterThanOrEqual(2);
      for (const t of tls.slice(1)) expect(leak(tls[0] as Timeline, t)).toBeNull();
    });

  it("runs with the same side: different carriers' results and tacklers draw the same defense to the read", () => {
    for (const f of ["shotgun", "pistol", "heavy"])
      for (const call of ["insideRun", "outsideRun"]) {
        const a = tlOf(mk({ formation: f, call, preset: "baseCover3", result: "run", gain: 3, runLocation: "left", parts: { ballCarrier: "O-RB1", tackler: "X-LB2" } }));
        const b = tlOf(mk({ formation: f, call, preset: "baseCover3", result: "run", gain: 14, runLocation: "left", parts: { ballCarrier: "O-RB1", tackler: "X-S1" } }));
        expect(leak(a, b), `${f} ${call}`).toBeNull();
      }
  });

  // The spec says "different ... results"; an interceptor and a sacker are facts, so these are
  // where a fact could show before the read. Up to the earlier read of the two.
  const base = (): Timeline => tlOf(pass("complete", 12, { target: "O-WR1", receiver: "O-WR1", tackler: "X-CB1" }, "shotgun", "intermediatePass"));
  it("an interception against a completion: the defense is the same up to the throw", () => {
    expect(leak(base(), tlOf(pass("interception", 14, { target: "O-WR2", interceptor: "X-S1", tackler: "O-WR2" }, "shotgun", "intermediatePass")))).toBeNull();
  });
  it("a sack against a completion: the defense is the same up to the read (the drop)", () => {
    expect(leak(base(), tlOf(pass("sack", -7, { sacker: "X-DL2", tackler: "X-DL2" }, "shotgun", "intermediatePass")))).toBeNull();
  });
});

// ================================================================ R-C10

describe("R-C10 (amended 2026-11-15): the defense", () => {
  const pedalPresets = PRESETS.filter((p) => !["blitz", "run"].includes(templates.presetDrops[p] ?? ""));

  /**
   * Exempt from the 30-degree turn (lead, 2026-11-15): a man defender trailing a vertical route, one
   * whose leg after its break stays within 15 degrees of straight upfield. His receiver is the one
   * nearest his manTargets spot at the set (R9).
   */
  function trailsVertical(tl: Timeline, call: string, preset: string, slot: string): boolean {
    const spot = templates.manTargets[preset]?.[slot];
    if (spot === undefined) return false;
    const want = { x: MID_X + spot[0], y: tl.los - spot[1] };
    const rcv = tl.marks.filter((m) => m.side === "O" && ["WR", "TE", "RB"].includes(m.position)).reduce((b, m) => (dist(at(m.keys, tl.snapAt), want) < dist(at(b.keys, tl.snapAt), want) ? m : b));
    const { roles } = rolesOf(offAlign("shotgun"));
    const route = chain(rawGroup("routes", call), roles.get(rcv.slot), rcv.position);
    if (route === undefined || route.pts.length < 2) return false;
    const a = (route.pts.at(-2) as { p: RawPt }).p;
    const b = (route.pts.at(-1) as { p: RawPt }).p;
    const deg = (Math.abs(Math.atan2(b[0] - a[0], b[1] - a[1])) * 180) / Math.PI;
    return deg <= 15;
  }

  it("(a) zone and man CBs pedal at most 0.65 x top; when the pedal ends before the read, the next segment turns 30 degrees or more", () => {
    // Blitz and run drop sets keep their CB steps "as today" (spec table), so they have no pedal.
    const bad: string[] = [];
    let checked = 0;
    let turned = 0;
    for (const preset of pedalPresets)
      for (const [call, parts] of [
        ["shortPass", { passer: "O-QB1" }],
        ["deepPass", { passer: "O-QB1", target: "O-WR1", receiver: "O-WR1", tackler: "X-S1" }],
      ] as const) {
        const tl = tlOf(mk({ formation: "shotgun", call, preset, result: call === "shortPass" ? "incomplete" : "complete", gain: call === "shortPass" ? 0 : 30, parts }));
        const read = specRead(tl);
        const drops = rawGroup("drops", templates.presetDrops[preset] as string);
        for (const m of tl.marks.filter((x) => x.side === "X" && x.position === "CB" && !tl.involved.includes(x.playerId))) {
          const zoned = templates.zones[preset]?.[m.slot] !== undefined;
          const manned = templates.manTargets[preset]?.[m.slot] !== undefined;
          if (!zoned && !manned) continue;
          const step = normal(drops?.[m.slot] ?? drops?.["CB"]);
          if (step === undefined) {
            bad.push(`${preset} ${m.slot}: no pedal in the drop set`);
            continue;
          }
          checked++;
          const set = at(m.keys, tl.snapAt);
          const pedalEnd = placeMine(set, step, 1, 1).at(-1) as Pt;
          let tEnd = tl.snapAt;
          for (let t = tl.snapAt; t <= tl.liveEnd; t += KEY) if (dist(at(m.keys, t), pedalEnd) < dist(at(m.keys, tEnd), pedalEnd)) tEnd = t;
          const top = motion.speed["CB"] as number;
          let vmax = 0;
          for (let t = tl.snapAt; t + KEY <= Math.min(tEnd, read); t += KEY) vmax = Math.max(vmax, speedYdS(m.keys, t, t + KEY));
          if (vmax > 0.65 * top + 1e-9) bad.push(`${preset} ${call} ${m.slot}: pedal at ${vmax.toFixed(2)} yd/s`);
          if (tEnd + 2 * KEY > read || dist(at(m.keys, tEnd), pedalEnd) > 1) continue;
          // The next segment: his heading over the next 1.5 yd, up to the read.
          let tOut = tEnd;
          while (tOut < read && dist(at(m.keys, tOut), at(m.keys, tEnd)) < 1.5) tOut += KEY;
          const q0 = at(m.keys, tEnd);
          const q1 = at(m.keys, Math.min(tOut, read));
          if (dist(q0, q1) < 0.3) continue;
          if (manned && trailsVertical(tl, call, preset, m.slot)) continue;
          turned++;
          const pIn = { x: pedalEnd.x - set.x, y: pedalEnd.y - set.y };
          const cos = (pIn.x * (q1.x - q0.x) + pIn.y * (q1.y - q0.y)) / (Math.hypot(pIn.x, pIn.y) * dist(q0, q1));
          const turn = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
          if (turn < 30) bad.push(`${preset} ${call} ${m.slot}: turns ${turn.toFixed(0)} degrees after the pedal`);
        }
      }
    expect(checked).toBeGreaterThan(20);
    expect(turned).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  });

  describe("(b) rotation on pass plays in baseCover3, nickelCover3 and nickelCover1", () => {
    const plays: { call: string; result: EvSpec["result"]; gain: number; parts: Record<string, string> }[] = [
      { call: "shortPass", result: "incomplete", gain: 0, parts: { passer: "O-QB1" } },
      { call: "intermediatePass", result: "complete", gain: 14, parts: { passer: "O-QB1", target: "O-WR2", receiver: "O-WR2" } },
      { call: "deepPass", result: "complete", gain: 30, parts: { passer: "O-QB1", target: "O-WR1", receiver: "O-WR1" } },
      { call: "playAction", result: "complete", gain: 16, parts: { passer: "O-QB1", target: "O-TE1", receiver: "O-TE1" } },
      { call: "screenPass", result: "complete", gain: 5, parts: { passer: "O-QB1", target: "O-RB1", receiver: "O-RB1" } },
    ];
    const LOS = 35;
    for (const preset of ["baseCover3", "nickelCover3", "nickelCover1"]) {
      const zonePreset = preset !== "nickelCover1";
      it(`${preset}: two-high at the set, moving toward the assignment at the throw, rotated at snap + 2,000 ms`, () => {
        const bad: string[] = [];
        let late = 0;
        for (const pl of plays) {
          const spec: EvSpec = { formation: "shotgun", call: pl.call, preset, result: pl.result, gain: pl.gain, spot: LOS, parts: pl.parts };
          const tl = tlOf(mk(spec));
          const tpl = templateTl({ formation: "shotgun", call: pl.call, preset, spot: LOS });
          const ss = tl.marks.filter((m) => m.side === "X" && m.position === "S");
          expect(ss).toHaveLength(2);
          const depth = (p: Pt): number => p.y - LOS;
          const throwT = specRead(tl);
          for (const s of ss) {
            const p = at(s.keys, tl.snapAt);
            if (depth(p) < 10 || Math.abs(p.x - MID_X) < 7) bad.push(`${pl.call} ${s.slot} at the set: depth ${depth(p).toFixed(1)}, x ${(p.x - MID_X).toFixed(1)}`);
            // His assignment point at the throw: his zone landmark, or his receiver's template trail point.
            const z = templates.zones[preset]?.[s.slot];
            let goal: Pt | undefined;
            if (z !== undefined) goal = { x: MID_X + (z[0] + z[2]) / 2, y: LOS + (z[1] + z[3]) / 2 };
            else {
              const spot = templates.manTargets[preset]?.[s.slot];
              if (spot !== undefined) {
                const want = { x: MID_X + spot[0], y: LOS - spot[1] };
                const rcv = tpl.marks.filter((m) => m.side === "O" && ["WR", "TE", "RB"].includes(m.position)).reduce((b, m) => (dist(at(m.keys, tpl.snapAt), want) < dist(at(b.keys, tpl.snapAt), want) ? m : b));
                const q = at(rcv.keys, throwT - motion.man.lagMs);
                goal = { x: q.x, y: q.y + motion.man.cushionYards };
              }
            }
            const q = at(s.keys, throwT);
            if (dist(p, q) < 1) bad.push(`${pl.call} ${s.slot}: moved ${dist(p, q).toFixed(2)} yd by the throw (${(throwT - tl.snapAt).toFixed(0)} ms)`);
            if (goal === undefined) bad.push(`${pl.call} ${s.slot}: no zone or man assignment`);
            else if ((q.x - p.x) * (goal.x - p.x) + (q.y - p.y) * (goal.y - p.y) <= 0) bad.push(`${pl.call} ${s.slot}: moving away from his assignment at the throw`);
          }
          // At snap + 2,000 ms; on play action at snap + 2,300 ms, and only when the throw is that late (lead, 2026-11-15).
          const at2 = pl.call === "playAction" ? 2300 : 2000;
          if (throwT - tl.snapAt >= at2) {
            late++;
            const t2 = tl.snapAt + at2;
            const s1 = at((ss.find((m) => m.slot === "S1") as (typeof ss)[number]).keys, t2);
            const s2 = at((ss.find((m) => m.slot === "S2") as (typeof ss)[number]).keys, t2);
            if (depth(s1) < 14 || Math.abs(s1.x - MID_X) > 3) bad.push(`${pl.call} S1 at snap + ${at2} ms: depth ${depth(s1).toFixed(1)}, x ${(s1.x - MID_X).toFixed(1)}`);
            if (zonePreset && depth(s2) > 9) bad.push(`${pl.call} S2 at snap + ${at2} ms: depth ${depth(s2).toFixed(1)}`);
          }
        }
        expect(late, "plays with a throw 2,000 ms or more after the snap").toBeGreaterThan(0);
        expect(bad).toEqual([]);
      });
    }
  });

  it("(c) each non-rushing LB moves at most 1.5 yd in the 300 ms after his start, and on runs never away from the line in that window", () => {
    const bad: string[] = [];
    for (const preset of PRESETS.filter((p) => templates.presetDrops[p] !== "blitz"))
      for (const call of ["shortPass", "deepPass", "playAction", "insideRun", "outsideRun"]) {
        const isRun = call.endsWith("Run");
        const tl = tlOf(mk({ formation: "shotgun", call, preset, result: isRun ? "run" : "incomplete", gain: isRun ? 3 : 0, ...(isRun ? { runLocation: "right" as const } : {}), parts: isRun ? { ballCarrier: "O-RB1" } : { passer: "O-QB1" } }));
        for (const m of tl.marks.filter((x) => x.side === "X" && x.position === "LB" && !tl.involved.includes(x.playerId))) {
          const p0 = at(m.keys, tl.snapAt);
          let t0 = tl.snapAt;
          while (t0 < tl.liveEnd && dist(at(m.keys, t0 + KEY), p0) < 1e-6) t0 += KEY;
          const moved = dist(at(m.keys, t0 + 300), p0);
          if (moved > 1.5 + 1e-9) bad.push(`${preset} ${call} ${m.slot}: ${moved.toFixed(2)} yd in 300 ms`);
          if (isRun)
            for (let t = t0; t + KEY <= t0 + 300; t += KEY)
              if (at(m.keys, t + KEY).y > at(m.keys, t).y + 1e-6) {
                bad.push(`${preset} ${call} ${m.slot}: away from the line at ${(t - tl.snapAt).toFixed(0)} ms`);
                break;
              }
        }
      }
    expect(bad).toEqual([]);
  });

  it("(d) on pass plays the outermost DL each side moves at least 1 yd outward before contact", () => {
    // Screens are left out: the spec's pass-line table gives screenPass.DL a straight rush to the
    // ring around the QB, which (d) would contradict.
    const bad: string[] = [];
    for (const f of FORMATIONS)
      for (const call of ["shortPass", "intermediatePass", "deepPass", "playAction"]) {
        const tl = tlOf(mk({ formation: f, call, preset: "baseCover3", result: "incomplete", parts: { passer: "O-QB1" } }));
        const dl = tl.marks.filter((m) => m.side === "X" && m.position === "DL" && !tl.involved.includes(m.playerId));
        const xs = dl.map((m) => at(m.keys, tl.snapAt).x);
        for (const m of dl) {
          const x0 = at(m.keys, tl.snapAt).x;
          if (x0 !== Math.min(...xs) && x0 !== Math.max(...xs)) continue;
          let out = 0;
          for (let t = tl.snapAt; t <= specRead(tl); t += KEY) out = Math.max(out, Math.abs(at(m.keys, t).x - MID_X) - Math.abs(x0 - MID_X));
          if (out < 1) bad.push(`${f} ${call} ${m.slot}: ${out.toFixed(2)} yd outward`);
        }
      }
    expect(bad).toEqual([]);
  });
});

// ================================================================ R-C11

describe("R-C11: cards and the set preview", () => {
  const LOS = 35;
  const bounds = { margin: motion.sidelineMarginYards, maxY: MAX_Y };

  it("run cards draw play-axis templates with lateral 0 (no side), every formation", () => {
    const bad: string[] = [];
    for (const f of FORMATIONS)
      for (const leaf of RUNS) {
        const slots = slotsFromCounts(personnel.offense[f] as Record<string, number>);
        const art = offenseArt(f, leaf, slots, templates, LOS, ctx.pxPerYard, bounds);
        for (const p of art.paths) {
          if (p.kind === "run") continue;
          const pos = posOf(p.slot);
          const lc = templatesRaw["lineContact"] as Record<string, Record<string, unknown>>;
          const r = pos === "OL" ? normal(lc[leaf]?.["OL"]) : chain(rawGroup("routes", leaf), undefined, pos);
          if (r?.axis !== "play") continue;
          const x0 = (p.points[0] as Pt).x;
          if (p.points.some((q) => Math.abs(q.x - x0) > 1e-9)) bad.push(`${f} ${leaf} ${p.slot}: lateral ${p.points.map((q) => (q.x - x0).toFixed(2)).join(" ")}`);
        }
        // And the TE, OL and QB steps are on the card at all.
        if (!art.paths.some((p) => p.slot.startsWith("OL"))) bad.push(`${f} ${leaf}: no line steps`);
      }
    expect(bad).toEqual([]);
  });

  it("the set preview of a run is the card (lateral 0), whatever side the engine picked", () => {
    const evs = (["left", "right"] as const).map((loc) => mk({ formation: "shotgun", call: "outsideRun", preset: "baseCover3", result: "run", gain: 5, runLocation: loc, parts: { ballCarrier: "O-RB1" } }));
    const [a, b] = evs.map((e) => timeline({ event: e, runoffSeconds: 0, human: "offense", ownStart: "lined" }, templates, ctx));
    expect(a?.preview).not.toBeNull();
    expect(b?.preview).toEqual(a?.preview);
    // The card for the same call (slots without player ids: compare what is drawn).
    const slots = slotsFromCounts(personnel.offense["shotgun"] as Record<string, number>);
    const drawn = (x: Art | null | undefined): unknown => JSON.parse(JSON.stringify(x, (k, v: unknown) => (k === "id" ? undefined : v)));
    expect(drawn(a?.preview)).toEqual(drawn(offenseArt("shotgun", "outsideRun", slots, templates, LOS, ctx.pxPerYard, bounds)));
  });

  it("coverage cards show no read step: each defender's card path is his drop set's steps then his landmark (or his tether)", () => {
    const bad: string[] = [];
    for (const preset of PRESETS) {
      const pkg = personnel.presetPackage[preset] as string;
      const slots = slotsFromCounts(personnel.packages[pkg] as Record<string, number>);
      const art = defenseArt(pkg, preset, slots, templates, LOS, ctx.pxPerYard, bounds);
      const drops = rawGroup("drops", templates.presetDrops[preset] as string);
      for (const m of art.marks) {
        const step = normal(drops?.[m.slot] ?? drops?.[m.position]);
        const steps = step === undefined ? [] : placeMine(m, step, 1, 0);
        const zone = templates.zones[preset]?.[m.slot];
        const path = art.paths.find((p) => p.slot === m.slot);
        let want: Pt[] | null;
        if (m.position !== "DL" && zone !== undefined) want = [m, ...steps, { x: MID_X + (zone[0] + zone[2]) / 2, y: LOS + (zone[1] + zone[3]) / 2 }];
        else want = steps.length > 0 ? [m, ...steps] : null;
        const got = path === undefined ? null : [...path.points];
        const same = want === null ? got === null : got !== null && got.length === want.length && got.every((q, i) => dist(q, want[i] as Pt) < 1e-6);
        if (!same) bad.push(`${preset} ${m.slot}: card ${JSON.stringify(got?.map((q) => [+q.x.toFixed(2), +q.y.toFixed(2)]))}, want ${JSON.stringify(want?.map((q) => [+q.x.toFixed(2), +q.y.toFixed(2)]))}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("P3 still holds: the preview is the same whatever the result", () => {
    const calls = { formation: "pistol", call: "deepPass", preset: "nickel2Man" };
    const a = timeline({ event: mk({ ...calls, result: "complete", gain: 30, parts: { passer: "O-QB1", target: "O-WR1", receiver: "O-WR1" } }), runoffSeconds: 0, human: "offense", ownStart: "lined" }, templates, ctx);
    const b = timeline({ event: mk({ ...calls, result: "sack", gain: -6, parts: { passer: "O-QB1", sacker: "X-DL1", tackler: "X-DL1" } }), runoffSeconds: 0, human: "offense", ownStart: "lined" }, templates, ctx);
    expect(a.preview).not.toBeNull();
    expect(b.preview).toEqual(a.preview);
    const da = timeline({ event: mk({ ...calls, result: "complete", gain: 30, parts: { passer: "O-QB1", target: "O-WR1", receiver: "O-WR1" } }), runoffSeconds: 0, human: "defense", ownStart: "lined" }, templates, ctx);
    const db = timeline({ event: mk({ ...calls, result: "incomplete", parts: { passer: "O-QB1", target: "O-TE1" } }), runoffSeconds: 0, human: "defense", ownStart: "lined" }, templates, ctx);
    expect(db.preview).toEqual(da.preview);
  });

  it("every other card path equals the field path: unnamed receivers run their card route (the card's breaks filleted as the field rounds them)", () => {
    // The card draws straight legs; the field rounds each break (R6), so the field path is compared
    // with the card's points joined by the same fillets, within 0.3 yd, up to his last card point.
    const bad: string[] = [];
    for (const f of FORMATIONS)
      for (const leaf of PASS) {
        const slots = slotsFromCounts(personnel.offense[f] as Record<string, number>);
        const art: Art = offenseArt(f, leaf, slots, templates, LOS, ctx.pxPerYard, bounds);
        const tl = tlOf(mk({ formation: f, call: leaf, preset: "nickelCover3", result: "incomplete", spot: LOS, parts: { passer: "O-QB1" } }));
        for (const p of art.paths.filter((x) => x.kind === "route" && (posOf(x.slot) === "WR" || posOf(x.slot) === "TE"))) {
          const m = markOf(tl, `O-${p.slot}`);
          const card = p.points.filter((q, i) => i === 0 || dist(q, p.points[i - 1] as Pt) > 1e-6);
          const curve = fillet(card, motion.fillet).pts;
          const lastPt = card.at(-1) as Pt;
          const nearSeg = (q: Pt): number => {
            let best = Infinity;
            for (let i = 1; i < curve.length; i++) {
              const a = curve[i - 1] as Pt;
              const b = curve[i] as Pt;
              const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
              const u = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / L2));
              best = Math.min(best, dist(q, { x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y) }));
            }
            return best;
          };
          let reached = false;
          for (let t = tl.snapAt; t <= tl.read; t += KEY) {
            const q = at(m.keys, t);
            const off = nearSeg(q);
            if (off > 0.3) {
              bad.push(`${f} ${leaf} ${p.slot}: ${off.toFixed(2)} yd off the card at ${(t - tl.snapAt).toFixed(0)} ms`);
              break;
            }
            if (dist(q, lastPt) <= 0.3) {
              reached = true;
              break;
            }
          }
          if (!reached && !bad.some((s) => s.startsWith(`${f} ${leaf} ${p.slot}`)) && tl.read - tl.snapAt > 3000) bad.push(`${f} ${leaf} ${p.slot}: never reached his last card point by the read`);
        }
      }
    expect(bad).toEqual([]);
  });
});

// ================================================================ R-C12

describe("R-C12: live time 1.8 to 7.0 s at 1x; 2x halves it; skip and reduced motion jump to the end", () => {
  it("motion.json's live bounds are the spec's, and every play of three games sits inside them (kneel and spike fixed)", () => {
    expect(motion.live).toMatchObject({ minMs: 1800, maxMs: 7000, kneelMs: 900, spikeMs: 700 });
    for (const ev of sample) {
      const tl = tlOf(ev);
      const live = tl.liveEnd - tl.snapAt;
      if (ev.play.kind === "noPlay") expect(live).toBe(0);
      else if (ev.play.kind === "kneel") expect(live).toBe(900);
      else if (ev.play.kind === "spike") expect(live).toBe(700);
      else {
        expect(live).toBeGreaterThanOrEqual(1800 - 1e-6);
        expect(live).toBeLessThanOrEqual(7000 + 1e-6);
      }
    }
  });

  it("a long touchdown run is no longer compressed to 4 s: it runs past 4 s, up to the 7 s cap", () => {
    const tl = tlOf(mk({ formation: "shotgun", call: "outsideRun", preset: "baseCover3", result: "run", gain: 60, spot: 40, parts: { ballCarrier: "O-RB1" } }));
    expect(tl.liveEnd - tl.snapAt).toBeGreaterThan(4000);
    expect(tl.liveEnd - tl.snapAt).toBeLessThanOrEqual(7000);
  });

  describe("on the animator", () => {
    const layout = layoutFor(1280, 720, templates.field);
    const opts: FrameOpts = { numbers: {}, ratings: {}, labelContent: "number", focused: null, markLabels: "involved", routeAlpha: 1, textScale: 1 };
    const scene: FieldScene = { los: 35, firstDown: null, bottomName: "Home", topName: "Away", endZoneYards: 10 };
    let animator: Animator;
    beforeEach(() => {
      const g = globalThis as Record<string, unknown>;
      g["window"] = { devicePixelRatio: 1 };
      g["requestAnimationFrame"] = (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16);
      g["cancelAnimationFrame"] = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
      const state: Record<string, unknown> = {};
      const g2 = new Proxy(state, {
        get: (t, k: string) => (k in t ? t[k] : k === "measureText" ? (s: string) => ({ width: s.length * 7 }) : k === "getLineDash" ? () => [] : () => undefined),
        set: (t, k: string, v: unknown) => {
          t[k] = v;
          return true;
        },
      }) as unknown as CanvasRenderingContext2D;
      const canvas = { width: 0, height: 0, style: {}, getContext: () => g2 } as unknown as HTMLCanvasElement;
      animator = new Animator(canvas, () => layout, () => templates, () => opts);
    });
    afterEach(() => {
      vi.useRealTimers();
      const g = globalThis as Record<string, unknown>;
      delete g["window"];
      delete g["requestAnimationFrame"];
      delete g["cancelAnimationFrame"];
    });
    const wall = async (tl: Timeline, speed: "1x" | "2x" | "skip", reducedMotion = false): Promise<number> => {
      const t0 = performance.now();
      let end = -1;
      void animator.play(tl, scene, { speed, reducedMotion, onClock: () => undefined }).then(() => {
        end = performance.now();
      });
      for (let i = 0; i < 2000 && end < 0; i++) await vi.advanceTimersByTimeAsync(16);
      return end - t0;
    };

    it("2x plays the same timeline in half the time", async () => {
      const tl = tlOf(mk({ formation: "shotgun", call: "deepPass", preset: "nickelCover3", result: "complete", gain: 30, parts: { passer: "O-QB1", target: "O-WR1", receiver: "O-WR1", tackler: "X-S1" } }));
      const one = await wall(tl, "1x");
      const two = await wall(tl, "2x");
      expect(Math.abs(one - tl.total)).toBeLessThanOrEqual(40);
      expect(Math.abs(two - tl.total / 2)).toBeLessThanOrEqual(40);
    });

    it("skip and reduced motion resolve after the hold alone, not the live play", async () => {
      const tl = tlOf(mk({ formation: "shotgun", call: "deepPass", preset: "nickelCover3", result: "complete", gain: 30, parts: { passer: "O-QB1", target: "O-WR1", receiver: "O-WR1", tackler: "X-S1" } }));
      const hold = Math.max(tl.holdMs, tl.settleMs, templates.timing.holdMs);
      for (const [speed, rm] of [["skip", false], ["1x", true]] as const) expect(await wall(tl, speed, rm)).toBeLessThanOrEqual(hold + 40);
    });
  });
});

// ================================================================ R-C13

describe("R-C13: motion.json holds the Pace table; the parsers refuse malformed new data", () => {
  it("the Pace table's new values", () => {
    expect(motion.speed).toEqual({ WR: 10.5, CB: 10.5, RB: 10, S: 10, TE: 9.5, LB: 9.5, QB: 8.5, OL: 5, DL: 5, K: 8, P: 8 });
    expect(motion.accelMs).toEqual({ WR: 650, RB: 650, CB: 650, S: 650, TE: 600, LB: 600, QB: 450, K: 450, P: 450, OL: 300, DL: 300 });
    expect(motion.decelMs).toBe(350);
    expect(motion.dropMs).toEqual({ shortPass: 600, intermediatePass: 950, deepPass: 1250, screenPass: 1100, playAction: 1400 });
    expect(motion.handoffMs).toBe(550);
    expect(motion.flight).toMatchObject({ baseMs: 250, perYardMs: 22, minMs: 350, maxMs: 1500 });
    expect(motion.live).toMatchObject({ minMs: 1800, maxMs: 7000 });
  });

  it("the Pace table's new keys", () => {
    expect(motion.routePace).toBe(0.9);
    expect(motion.continuePace).toBe(0.75);
    expect(motion.fillet).toMatchObject({ roundPace: 0.8, sharpPace: 0.45, plantYards: 1.2, reaccelYards: 2.0 });
    expect(motion.sit).toMatchObject({ pace: 0.25, maxYards: 1.0 });
    expect(motion.throwHold.maxMs).toBe(1200);
    expect(motion.man).toEqual({ cushionYards: 1.5, pressCushionYards: 1.0, lagMs: 150 });
    expect(motion.zoneDrift).toEqual({ maxYards: 2.5, pace: 0.5 });
    expect(motion.stalk).toEqual({ contactYards: 1.4, lagMs: 150 });
    expect(motion.runDrift).toEqual({ insideRun: 1.0, outsideRun: 1.5, qbSneak: 0 });
    expect(motion.fakeMs).toBe(450);
    expect(motion.sidelineMarginYards).toBe(1.5);
  });

  it("the values the table keeps unchanged are as they were before the revision", () => {
    // From data/ui/motion.json version 1 (the commit before this revision).
    expect(motion.startMs).toEqual({ OL: 0, QB: 0, TE: 20, WR: 30, RB: 60, DL: 60, CB: 120, LB: 140, S: 150, K: 0, P: 0 });
    expect(motion.maxStartMs).toBe(150);
    expect(motion.snapMs).toEqual({ underCenter: 80, pistol: 140, shotgun: 160, empty: 160, heavy: 80, fieldGoal: 200, extraPoint: 200, punt: 300, kneel: 80, spike: 80 });
    expect(motion.punt).toEqual({ kickAfterSnapMs: 450, hangBaseMs: 900, hangPerYardMs: 8, hangMaxMs: 1500, apex: 1.8 });
    expect(motion.kickoff).toEqual({ approachMs: 400, hangBaseMs: 1000, hangPerYardMs: 6, hangMaxMs: 1500, apex: 2.0, onsideMs: 600, onsideApex: 1.15 });
    expect(motion.fieldGoal).toEqual({ holdMs: 200, kickMs: 450, flightBaseMs: 600, flightPerYardMs: 6, flightMaxMs: 1100, apex: 1.5, endScale: 1.25 });
    expect(motion.preSnap).toEqual({ lineUpMs: 450, runoffMaxMs: 600, setMs: 300, glideMs: 150 });
    expect(motion.settleMs).toBe(300);
    expect(motion.live).toMatchObject({ kneelMs: 900, spikeMs: 700 });
  });

  const withMotion = (path: string[], v: unknown): unknown => {
    const o = structuredClone(motionRaw) as Record<string, unknown>;
    let cur = o;
    for (const k of path.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
    if (v === undefined) delete cur[path.at(-1) as string];
    else cur[path.at(-1) as string] = v;
    return o;
  };
  it.each([
    ["routePace"],
    ["continuePace"],
    ["fillet", "roundPace"],
    ["fillet", "sharpPace"],
    ["fillet", "plantYards"],
    ["fillet", "reaccelYards"],
    ["sit", "pace"],
    ["sit", "maxYards"],
    ["throwHold", "maxMs"],
    ["man", "cushionYards"],
    ["man", "pressCushionYards"],
    ["man", "lagMs"],
    ["zoneDrift", "maxYards"],
    ["zoneDrift", "pace"],
    ["stalk", "contactYards"],
    ["stalk", "lagMs"],
    ["runDrift", "insideRun"],
    ["runDrift", "outsideRun"],
    ["runDrift", "qbSneak"],
    ["fakeMs"],
    ["sidelineMarginYards"],
  ])("parseMotion refuses %s missing or not a number", (...path: string[]) => {
    expect(() => parseMotion(withMotion(path, undefined))).toThrow(MotionError);
    expect(() => parseMotion(withMotion(path, "fast"))).toThrow(MotionError);
  });

  it("parseMotion refuses a pace above 1 or at 0, and version 1", () => {
    expect(() => parseMotion(withMotion(["routePace"], 1.5))).toThrow(MotionError);
    expect(() => parseMotion(withMotion(["fillet", "sharpPace"], 0))).toThrow(MotionError);
    expect(() => parseMotion(withMotion(["version"], 1))).toThrow(MotionError);
  });

  const withRoute = (cls: string, key: string, v: unknown, group = "routes"): unknown => {
    const o = structuredClone(templatesRaw) as Record<string, Record<string, Record<string, unknown>>>;
    (o[group] as Record<string, Record<string, unknown>>)[cls] = { ...(o[group]?.[cls] ?? {}), [key]: v };
    return o;
  };
  it.each([
    ["an empty pts", { pts: [] }],
    ["an unknown finish", { pts: [[0, 5]], finish: "run" }],
    ["an unknown axis", { pts: [[0, 5]], axis: "out" }],
    ["an unknown key", { pts: [[0, 5]], speed: 2 }],
    ["no pts", { finish: "sit" }],
    ["a waypoint with one number", { pts: [{ p: [1] }] }],
    ["a waypoint with a negative pause", { pts: [{ p: [0, 5], pauseMs: -10 }] }],
    ["a waypoint pace above 1", { pts: [{ p: [0, 5], pace: 1.5 }] }],
    ["a waypoint with an unknown key", { pts: [{ p: [0, 5], wait: 3 }] }],
    ["a waypoint that is a string", ["0,5"]],
  ])("parseTemplates refuses a route with %s", (_name, v) => {
    expect(() => parseTemplates(withRoute("shortPass", "s1", v))).toThrow(TemplateError);
  });

  it("parseTemplates refuses a malformed readStep, mesh or lineContact leaf", () => {
    expect(() => parseTemplates(withRoute("pass", "LB", { pts: [{ p: [0, -0.5], pace: 2 }] }, "readStep"))).toThrow(TemplateError);
    expect(() => parseTemplates({ ...templatesRaw, readStep: "x" })).toThrow(TemplateError);
    expect(() => parseTemplates({ ...templatesRaw, mesh: { insideRun: [1] } })).toThrow(TemplateError);
    expect(() => parseTemplates({ ...templatesRaw, mesh: "x" })).toThrow(TemplateError);
    expect(() => parseTemplates(withRoute("screenPass", "OL", { pts: [[0, 1]], axis: "sideways" }, "lineContact"))).toThrow(TemplateError);
    expect(() => parseTemplates({ ...templatesRaw, version: 1 })).toThrow(TemplateError);
    // And the shipped file passes.
    expect(() => parseTemplates(templatesRaw)).not.toThrow();
  });
});

// ================================================================ R-C14

describe("R-C14: no engine change", () => {
  it("no diff and no new file under packages/sim or data/engine against the last commit", () => {
    const out = execSync("git status --porcelain -- packages/sim data/engine", { cwd: root, encoding: "utf8" });
    expect(out.trim()).toBe("");
  });
});

// ================================================================ Neutral catch depth and x (DECISIONS.md, lead, 2026-11-15)

describe("Neutral catch depth (amended) and neutral catch x on the target's route", () => {
  const LOS = 35;
  const catchOf = (tl: Timeline): { at: Pt; t: number } => {
    const p = flightOf(tl);
    if (p === undefined) throw new Error("no throw");
    return { at: p.points.at(-1) as Pt, t: p.end };
  };
  const spec = (call: string, gain: number, target = "O-WR1", airYards?: number): EvSpec => ({ formation: "shotgun", call, preset: "nickelCover3", result: "complete", gain, spot: LOS, ...(airYards === undefined ? {} : { airYards }), parts: { passer: "O-QB1", target, receiver: target, tackler: "X-CB1" } });
  const say = (p: Pt): string => `(${(p.x - MID_X).toFixed(2)}, ${(p.y - LOS).toFixed(2)})`;

  it.each([
    ["shortPass", 15, "O-WR1"],
    ["shortPass", 9, "O-WR2"],
    ["intermediatePass", 25, "O-WR1"],
    ["intermediatePass", 18, "O-TE1"],
    ["deepPass", 40, "O-WR1"],
    ["deepPass", 30, "O-WR3"],
    ["playAction", 20, "O-WR2"],
    ["screenPass", 6, "O-RB1"],
  ])("%s gaining %i to %s: the catch is at the DECISIONS point, he is there at catch time, the facts stay anchored", (call, gain, target) => {
    const e = spec(call, gain, target);
    const tl = tlOf(mk(e));
    const c = catchOf(tl);
    const want = expectedCatch(e, target);
    expect(dist(c.at, want), `catch ${say(c.at)}, want ${say(want)}`).toBeLessThan(keyTol(posOf(target.slice(2))));
    // Inside the field: the sideline margin.
    expect(c.at.x).toBeGreaterThanOrEqual(motion.sidelineMarginYards - 1e-9);
    expect(c.at.x).toBeLessThanOrEqual(FIELD_WIDTH - motion.sidelineMarginYards + 1e-9);
    const rcv = markOf(tl, target);
    expect(dist(at(rcv.keys, c.t), c.at)).toBeLessThan(0.1);
    expect(at(tl.ball, tl.liveEnd).y).toBeCloseTo(LOS + gain, 6);
    expect(tl.holder).toBe(target);
    expect(dist(at(rcv.keys, tl.liveEnd), at(tl.ball, tl.liveEnd))).toBeLessThan(1e-6);
    expect(dist(at(markOf(tl, "X-CB1").keys, tl.liveEnd), at(tl.ball, tl.liveEnd))).toBeLessThan(1e-6);
  });

  it("a route that reaches passDepth is caught at passDepth: the shotgun slant at 6 yd", () => {
    expect(templates.passDepth["shortPass"]).toBe(6);
    expect(catchOf(tlOf(mk(spec("shortPass", 15)))).at.y - LOS).toBeCloseTo(6, 6);
  });

  it("capped at the gain: a 3-yard short pass is caught at the dead spot, not 6 yd out", () => {
    expect(catchOf(tlOf(mk(spec("shortPass", 3)))).at.y - LOS).toBeCloseTo(3, 6);
  });

  it("kept between the line and the dead spot: a short pass for a loss is caught inside that band", () => {
    const c = catchOf(tlOf(mk(spec("shortPass", -2))));
    expect(c.at.y).toBeGreaterThanOrEqual(LOS - 2 - 1e-6);
    expect(c.at.y).toBeLessThanOrEqual(LOS + 1e-6);
  });

  it("amended (screens): a screen back whose route sits behind -2 is caught at his route's depth, no deeper than screenFloorYards, between that floor and the dead spot", () => {
    expect(SCREEN_FLOOR).toBe(-8);
    // The RB's screen route sits about 5 yd behind the line, never within 0.5 yd of -2.
    for (const gain of [6, -5]) {
      const e = spec("screenPass", gain, "O-RB1");
      const c = catchOf(tlOf(mk(e))).at;
      const want = expectedCatch(e, "O-RB1");
      expect(dist(c, want), `gain ${gain}: catch ${say(c)}, want ${say(want)}`).toBeLessThan(keyTol("RB"));
      expect(c.y - LOS).toBeGreaterThanOrEqual(SCREEN_FLOOR - 1e-6);
      expect(c.y - LOS).toBeLessThan(-2);
      expect(c.y).toBeLessThanOrEqual(Math.max(LOS, LOS + gain) + 1e-6);
    }
  });

  it("amended (backfield routes): a back in pass pro, whose route never reaches 28 yd, is caught behind the line on his route, no deeper than screenFloorYards", () => {
    const e = spec("deepPass", 12, "O-RB1");
    const c = catchOf(tlOf(mk(e))).at;
    const want = expectedCatch(e, "O-RB1");
    expect(dist(c, want), `catch ${say(c)}, want ${say(want)}`).toBeLessThan(keyTol("RB"));
    // His block sits behind the line: the catch follows it there, between the floor and the dead spot.
    expect(c.y - LOS).toBeLessThan(0);
    expect(c.y - LOS).toBeGreaterThanOrEqual(SCREEN_FLOOR - 1e-6);
  });

  it("with airYards present the catch depth stays at the air yards (the x still from his route)", () => {
    for (const [call, gain, air] of [["deepPass", 40, 22], ["shortPass", 15, 2]] as const) {
      const e = spec(call, gain, "O-WR1", air);
      const c = catchOf(tlOf(mk(e))).at;
      expect(c.y - LOS).toBeCloseTo(air, 6);
      expect(Math.abs(c.x - expectedCatch(e, "O-WR1").x)).toBeLessThan(keyTol("WR"));
    }
  });

  it("an incompletion uses the class's neutral depth", () => {
    const tl = tlOf(mk({ formation: "shotgun", call: "intermediatePass", preset: "nickelCover3", result: "incomplete", spot: LOS, parts: { passer: "O-QB1", target: "O-WR1" } }));
    expect(catchOf(tl).at.y - LOS).toBeCloseTo(templates.passDepth["intermediatePass"] as number, 6);
  });
});

// ================================================================ Joseph's playtest checks (2026-11-15)

describe("Joseph's playtest checks, over six simulated games", () => {
  const plays = [81, 82, 83, 84, 85, 86].flatMap((seed) => playGame(seed, seed % 2 === 0 ? "home" : "away", seed).events.filter((e): e is PlayEvent => e.t === "play"));
  const leafOf = (e: PlayEvent): string => (e.offense.call === "goForTwo" ? (e.offense.twoPointPlay ?? "") : e.offense.call);

  it("on every completion the drawn target is within 1 yd of the ball at catch time", () => {
    const bad: string[] = [];
    let n = 0;
    for (const e of plays) {
      if (e.play.kind !== "pass" || e.play.incomplete === true || e.play.turnover !== undefined) continue;
      const id = readDetail(e.play).participants?.receiver;
      if (id === undefined) continue;
      const tl = tlOf(e);
      const fl = flightOf(tl);
      if (fl === undefined) continue;
      n++;
      const d = dist(at(markOf(tl, id).keys, fl.end), at(tl.ball, fl.end));
      if (d > 1) bad.push(`${e.offense.formation ?? ""} ${leafOf(e)} spot ${e.before.spot}: target ${d.toFixed(2)} yd from the ball at the catch`);
    }
    expect(n).toBeGreaterThan(100);
    expect(bad).toEqual([]);
  });

  /**
   * docs/DECISIONS.md, "Sack time from the sacker's arrival" (lead, 2026-11-15): the sack is at
   * max(drop end + 600 ms, his arrival). Arrival: from where his unnamed track is at the drop end (a
   * lineman at the end of his line step, anyone else at his set spot) to the sack spot plus
   * 2 x sackArc.outYards, at his top speed, plus half his accelMs and half the decelMs. The whistle
   * still follows 300 ms later (Motion, Sacks), and a clamped play scales every time by one factor
   * (decision 11). Returns the screen time of the sack.
   */
  function sackTime(e: PlayEvent, tl: Timeline, sacker: string): number {
    const leaf = leafOf(e);
    const drop = motion.dropMs[leaf] ?? 700;
    const m = markOf(tl, sacker);
    const set = at(m.keys, tl.snapAt);
    let from = set;
    if (m.position === "DL" || m.position === "OL") {
      const mates = tl.marks.filter((x) => x.side === m.side && x.position === m.position).map((x) => at(x.keys, tl.snapAt).x);
      const outer = mates.length > 2 && (set.x === Math.min(...mates) || set.x === Math.max(...mates));
      const keys = outer ? [m.position === "DL" ? "DLE" : "OLT", m.position] : [m.position];
      const lc = templatesRaw["lineContact"] as Record<string, Record<string, unknown>>;
      const pick = (table: Record<string, unknown> | undefined): unknown => keys.map((k) => table?.[k]).find((v) => v !== undefined);
      const step = normal(pick(lc[leaf]) ?? pick(lc["pass"]));
      if (step !== undefined) {
        const strong = e.offense.formation === undefined ? 1 : rolesOf(offAlign(e.offense.formation)).strong;
        from = placeMine(set, step, strong, strong).at(-1) as Pt;
      }
    }
    // The sack spot: where the QB holds the ball at the whistle.
    const spot = at(tl.ball, tl.liveEnd);
    const pos = m.position;
    const arrival = drop + ((dist(from, spot) + 2 * motion.sackArc.outYards) / (motion.speed[pos] as number)) * 1000 + (motion.accelMs[pos] as number) / 2 + motion.decelMs / 2;
    const sackRaw = Math.max(drop + 600, arrival);
    const k = (tl.liveEnd - tl.snapAt) / (sackRaw + 300);
    return tl.snapAt + sackRaw * k;
  }

  it("on every sack the sacker is on the QB at the sack time (DECISIONS: max(drop end + 600 ms, his arrival))", () => {
    const bad: string[] = [];
    let n = 0;
    for (const e of plays) {
      if (e.play.kind !== "sack") continue;
      const parts = readDetail(e.play).participants ?? {};
      if (parts.sacker === undefined || parts.passer === undefined) continue;
      const tl = tlOf(e);
      const tSack = sackTime(e, tl, parts.sacker);
      n++;
      const d = dist(at(markOf(tl, parts.sacker).keys, tSack), at(markOf(tl, parts.passer).keys, tSack));
      if (d > 1) bad.push(`${e.offense.formation ?? ""} ${leafOf(e)} ${markOf(tl, parts.sacker).slot}: sacker ${d.toFixed(2)} yd from the QB at ${(tSack - tl.snapAt).toFixed(0)} ms`);
    }
    expect(n).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  });

  it("over twenty games, at least 95% of sackers peak at no more than 1.15 x top on the way to the sack", () => {
    const sacks = Array.from({ length: 20 }, (_, i) => 101 + i).flatMap((seed) => playGame(seed, seed % 2 === 0 ? "home" : "away", seed).events.filter((e): e is PlayEvent => e.t === "play" && e.play.kind === "sack"));
    let n = 0;
    let ok = 0;
    const over: string[] = [];
    for (const e of sacks) {
      const parts = readDetail(e.play).participants ?? {};
      if (parts.sacker === undefined) continue;
      const tl = tlOf(e);
      const m = markOf(tl, parts.sacker);
      const t1 = sackTime(e, tl, parts.sacker);
      let peak = 0;
      for (let t = tl.snapAt; t + KEY <= t1 + 1e-9; t += KEY) peak = Math.max(peak, speedYdS(m.keys, t, t + KEY));
      const top = motion.speed[m.position] as number;
      n++;
      if (peak <= 1.15 * top + 1e-9) ok++;
      else if (over.length < 8) over.push(`${e.offense.formation ?? ""} ${leafOf(e)} ${m.slot}: ${peak.toFixed(1)} yd/s (top ${top})`);
    }
    expect(n).toBeGreaterThan(30);
    expect(ok / n, `${ok} of ${n} within; over: ${over.join("; ")}`).toBeGreaterThanOrEqual(0.95);
  });
});
