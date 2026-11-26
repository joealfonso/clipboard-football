// Shared by the player-reactions spec tests (docs/specs/m2-player-reactions.md, criteria PR-C2 to
// PR-C10 and PR-C15), written by test-writer from the spec, not the code: the samples the spec
// names, the per-mark test record of PR15 read by its exact field names, the A/B copies of the
// motion data, and the standing criteria of the motion spec restated so they can run with ratings.
//
// Every floor a criterion sets is a constant in the test files, never read from motion.json.
//
// The ports (N1, N3 to N6, A3's ring, R-C5's no-freeze, M5) follow natural-motion.spec.test.ts,
// timeline.test.ts, routes-pace.spec.test.ts and motion.test.ts as they stood before this build,
// with one change the spec asks for: a mark's own values (PR-C10, Superseded 6) in place of the
// position table.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { POSITION_SKILLS, type PlayResult } from "@clipboard-football/shared";
import { readDetail, type PlayEvent } from "../src/engine/types";
import { RAMP } from "../src/ui/motion";
import { parseMotion, parseTemplates, type Motion } from "../src/ui/templates";
import { at, FIELD_WIDTH, MID_X, timeline, type Key, type Pt, type Timeline, type TimelineCtx, type TLMark } from "../src/ui/timeline";
import { ALL_FIXTURES, snap } from "./fixtures";
import { prFixtureRating } from "./pr-digest";
import { simGame } from "./sim-games";

export const root = join(import.meta.dirname, "../../..");
export const read = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));
export const templatesRaw = read("data/ui/templates.json") as Record<string, unknown>;
export const templates = parseTemplates(templatesRaw);
export const motionRaw = read("data/ui/motion.json") as Record<string, unknown>;
export const motion = parseMotion(motionRaw);
export const personnel = read("data/engine/personnel.json") as {
  offense: Record<string, Record<string, number>>;
  packages: Record<string, Record<string, number>>;
  presetPackage: Record<string, string>;
};

/** The key grid the criteria are measured on (ms). */
export const KEY = 25;
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const median = (a: readonly number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s.length === 0 ? NaN : s.length % 2 === 1 ? (s[(s.length - 1) / 2] as number) : ((s[s.length / 2 - 1] as number) + (s[s.length / 2] as number)) / 2;
};

// ---------------------------------------------------------------- ratings and builds

/** Ratings by player id, as ctx.ratings takes them: base ratings, and from slice 2 the position skills. */
export type Ratings = Readonly<Record<string, Readonly<Record<string, number>>>>;

export function ctxOf(ratings?: Ratings, m: Motion = motion, extra: Partial<TimelineCtx> = {}): TimelineCtx {
  const base: TimelineCtx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion: m, ...extra };
  // The cast: until slice 2 widens it, ctx.ratings is typed for speed, agility and awareness only.
  return ratings === undefined ? base : { ...base, ratings: ratings as NonNullable<TimelineCtx["ratings"]> };
}

/** One Timeline at 1x, built as the spec's sample S is. */
export function build(ev: PlayEvent, ratings?: Ratings, m: Motion = motion, extra: Partial<TimelineCtx> = {}, human: "offense" | "defense" | null = null): Timeline {
  return timeline({ event: ev, runoffSeconds: 0, human, ownStart: "lined" }, templates, ctxOf(ratings, m, extra));
}

/** Every player id an event names: both on-field sets and the participants. */
export function idsOf(ev: PlayEvent): string[] {
  const d = readDetail(ev.play);
  return [...new Set([...(d.onField?.offense ?? []).map((s) => s.id), ...(d.onField?.defense ?? []).map((s) => s.id), ...Object.values(d.participants ?? {}).filter((v): v is string => typeof v === "string")])];
}

/** One rating or skill of one player of the fixed table, 40 to 90, from a hash of his id (the formula of prFixtureRating, for any name). */
export function tableRating(id: string, rating: string): number {
  return 40 + (createHash("sha256").update(`pr-c1|${id}|${rating}`).digest().readUInt32BE(0) % 51);
}
/** The position skills a player at `position` has (packages/shared POSITION_SKILLS). */
export const skillNames = (position: string): readonly string[] => (POSITION_SKILLS as Readonly<Record<string, readonly string[]>>)[position] ?? [];

/**
 * The fixed rating table the tests supply for events whose players are in no pool (the fixtures
 * and the built events): each rating from a hash of the player id, 40 to 90 (pr-digest.ts).
 * Widened 2026-11-24 for slice 2, as ctx.ratings is: strength and the skills of the position he
 * lines up at as well (a player who is not on the field has no position here, so the three base
 * ratings only). The three base ratings are the ones the table always held, so a build that does
 * not read the new names draws what it drew.
 */
export function tableRatings(ev: PlayEvent): Ratings {
  const d = readDetail(ev.play);
  const position = new Map([...(d.onField?.offense ?? []), ...(d.onField?.defense ?? [])].map((s) => [s.id, s.position as string] as const));
  return Object.fromEntries(
    idsOf(ev).map((id) => {
      const pos = position.get(id);
      const base = { speed: prFixtureRating(id, "speed"), agility: prFixtureRating(id, "agility"), awareness: prFixtureRating(id, "awareness") };
      if (pos === undefined) return [id, base];
      return [id, { ...base, ...Object.fromEntries(["strength", ...skillNames(pos)].map((r) => [r, tableRating(id, r)])) }];
    }),
  );
}

/** The same ratings with one rating of one player replaced. */
export function withRating(ratings: Ratings, id: string, rating: string, value: number): Ratings {
  return { ...ratings, [id]: { ...(ratings[id] ?? {}), [rating]: value } };
}

export interface Sample {
  readonly name: string;
  readonly ev: PlayEvent;
  readonly ratings: Ratings;
}

export const SCRIMMAGE_KINDS: readonly string[] = ["run", "pass", "sack", "scramble", "twoPoint"];

/** The spec's Fixtures: COMPLETE, RUN, SACK and the rest of ALL_FIXTURES, each with the fixed table. */
export const FIXTURES: readonly Sample[] = Object.entries(ALL_FIXTURES).map(([name, ev]) => ({ name, ev, ratings: tableRatings(ev) }));
/** The fixtures PR3 to PR6 apply to. */
export const SCRIMMAGE_FIXTURES: readonly Sample[] = FIXTURES.filter((f) => SCRIMMAGE_KINDS.includes(f.ev.play.kind));

let sampleS: readonly Sample[] | null = null;
/**
 * The spec's Sample S: simGame(seed) for seeds 1 to 6, every play whose kind is run or pass, with
 * every player's card ratings and skills (the pool's, before the home-field shift).
 */
export function S(): readonly Sample[] {
  if (sampleS !== null) return sampleS;
  const out: Sample[] = [];
  for (let seed = 1; seed <= 6; seed++) {
    const g = simGame(seed);
    const ratings: Ratings = Object.fromEntries([...g.matchup.home.pool.players, ...g.matchup.away.pool.players].map((p) => [p.id, { ...p.ratings, ...p.skills }]));
    g.plays.forEach((ev, i) => {
      if (ev.play.kind === "run" || ev.play.kind === "pass") out.push({ name: `seed ${seed} play ${i + 1} ${ev.play.kind} ${ev.offense.call}`, ev, ratings });
    });
  }
  sampleS = out;
  return out;
}

// ---------------------------------------------------------------- PR15: the per-mark record

/** MarkNat.react, by the exact names of PR15. The slice 2 to 4 fields are optional here. */
export interface React {
  readonly readMs: number;
  readonly delayMs: number;
  readonly pursueAt: number | null;
  readonly vary: number;
  readonly leadMs: number;
  readonly turnShare: number;
  readonly lateralAccel: number;
  readonly manLagMs?: number;
  readonly cushionYards?: number;
  readonly stalkLagMs?: number;
  /** Slice 2: the id of the defender a stalking receiver shadows, null otherwise. Undefined on a build without slice 2. */
  readonly stalkOf?: string | null;
  readonly biteShare?: number;
  readonly breakPaceShare?: number;
  readonly airMs?: number;
  readonly driveMs?: number;
}

export const natOf = (m: TLMark): NonNullable<TLMark["nat"]> => {
  if (m.nat === undefined) throw new Error(`${m.side}:${m.slot}: no natural-motion record`);
  return m.nat;
};
/** His record, or undefined when the build has none for him. */
export const reactIf = (m: TLMark): React | undefined => (m.nat as unknown as { react?: React } | undefined)?.react;
/** His record. A scrimmage play built without it fails here, by name. */
export function reactOf(m: TLMark): React {
  const r = reactIf(m);
  if (r === undefined) throw new Error(`${m.side}:${m.slot} (${m.playerId}): no nat.react (PR15)`);
  return r;
}
/** His own top speed on the screen clock (yd/s). */
export const topOf = (m: TLMark): number => natOf(m).top / natOf(m).k;

/** The spec's counted defenders: side X, not DL, not in tl.involved, not the tackler, pursueAt not null. */
export function counted(tl: Timeline): TLMark[] {
  return tl.marks.filter((m) => m.side === "X" && m.position !== "DL" && !tl.involved.includes(m.playerId) && m.playerId !== tl.tackler && reactOf(m).pursueAt !== null);
}

export const markOf = (tl: Timeline, id: string): TLMark => {
  const m = tl.marks.find((x) => x.playerId === id);
  if (m === undefined) throw new Error(`no mark ${id}`);
  return m;
};
export const flightOf = (tl: Timeline): Timeline["paths"][number] | undefined => tl.paths.find((p) => p.kind === "ball");
/** "The read" of the motion spec (amended 2026-11-15): the throw on a pass, else the timeline's read. */
export const specRead = (tl: Timeline): number => flightOf(tl)?.start ?? tl.read;
/** Live time strictly inside the 1.8 s floor and the 14 s cap, so the play is on the raw clock (k = 1). */
export const unclamped = (tl: Timeline): boolean => tl.liveEnd - tl.snapAt > 1800 + 1e-6 && tl.liveEnd - tl.snapAt < 14000 - 1e-6;

// ---------------------------------------------------------------- A/B copies of the motion data

type Tree = Record<string, unknown>;
function setPath(o: Tree, path: readonly string[], v: unknown): void {
  let cur = o;
  for (const k of path.slice(0, -1)) {
    const next = cur[k];
    if (typeof next !== "object" || next === null) throw new Error(`motion data has no ${path.join(".")} (PR-C15: every key of ratings.scrimmage)`);
    cur = next as Tree;
  }
  const last = path.at(-1) as string;
  if (cur[last] === undefined) throw new Error(`motion data has no ${path.join(".")} (PR-C15: every key of ratings.scrimmage)`);
  cur[last] = v;
}

/** Every band that reads awareness at the shipped `by` values, but pursuit.leadMs. */
const AWARENESS_BANDS: readonly (readonly string[])[] = [
  ["ratings", "default", "reactionMs"],
  ["ratings", "default", "startMs"],
  ["ratings", "scrimmage", "read", "defenseMs"],
  ["ratings", "scrimmage", "read", "offenseMs"],
  ["ratings", "scrimmage", "read", "releaseMs"],
  ["ratings", "scrimmage", "read", "varyMs"],
  ["ratings", "scrimmage", "pursuit", "leadVaryMs"],
  ["ratings", "scrimmage", "stalk", "lagMs"],
  ["ratings", "scrimmage", "biteShare"],
  ["ratings", "scrimmage", "getOff", "offenseMs"],
  ["ratings", "scrimmage", "getOff", "defenseMs"],
  ["ratings", "scrimmage", "getOff", "varyMs"],
];
/** Every band that reads agility at the shipped `by` values, but pursuit.turnShare. */
const AGILITY_BANDS: readonly (readonly string[])[] = [
  ["ratings", "default", "accelShare"],
  ["ratings", "scrimmage", "breakPaceShare"],
];

/**
 * The spec's A/B method: a test copy of the motion data that zeroes every other band reading the
 * rating under test, so the two builds differ by one band only. "lead" keeps pursuit.leadMs for
 * awareness (PR-C5), "turn" keeps pursuit.turnShare for agility (PR-C6).
 */
export function abMotion(keep: "lead" | "turn"): Motion {
  const copy = structuredClone(motion) as unknown as Tree;
  const byPosition = ((copy["ratings"] as Tree)["byPosition"] ?? {}) as Record<string, Tree>;
  const bands = keep === "lead" ? AWARENESS_BANDS : AGILITY_BANDS;
  for (const path of bands) {
    setPath(copy, path, [0, 0]);
    // A position's own band overrides the default: zero it there too.
    if (path[1] === "default") for (const band of Object.values(byPosition)) if (band[path[2] as string] !== undefined) band[path[2] as string] = [0, 0];
  }
  return copy as unknown as Motion;
}

// ---------------------------------------------------------------- events shaped like the engine's

const ids = (prefix: string, counts: Record<string, number>): Record<string, string[]> => Object.fromEntries(Object.entries(counts).map(([pos, n]) => [pos, Array.from({ length: n }, (_, i) => `${prefix}-${pos}${i + 1}`)]));
export interface EvSpec {
  readonly formation: string;
  readonly call: string;
  readonly preset: string;
  readonly result: "complete" | "incomplete" | "run" | "sack" | "interception";
  readonly gain?: number;
  readonly spot?: number;
  readonly parts?: Record<string, string>;
  readonly runLocation?: "left" | "middle" | "right";
  readonly airYards?: number;
}
/** A built event (as routes-pace.spec.test.ts builds them): offense ids O-<slot>, defense ids X-<slot>. */
export function mk(e: EvSpec): PlayEvent {
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
  return { t: "play", before: snap({ spot: los, down: 1, distance: 10 }), offense: { call: e.call, formation: e.formation } as PlayEvent["offense"], defense: e.preset, play, penalty: null, runoffTimeout: false, after: snap({ spot: los + gain, down: 1, distance: 10 }) };
}

/** The motion data with a 6 s flight and no live cap, so a reference play runs every template well past any throw (k = 1). */
export const longMotion = (m: Motion = motion): Motion => ({ ...m, flight: { ...m.flight, minMs: 6000, maxMs: 6000 }, live: { ...m.live, maxMs: 1e6 } });

// ---------------------------------------------------------------- measures (natural-motion.spec.test.ts)

export interface Built {
  readonly name: string;
  readonly ev: PlayEvent;
  readonly tl: Timeline;
}

interface Meas {
  readonly t: number[];
  readonly p: Pt[];
  /** Speed (yd/s) over the two neighbouring keys, NaN at the ends. */
  readonly v: number[];
}
const measured = new WeakMap<TLMark, Meas>();
/** p_i = at(keys, snapAt + 25 i) up to liveEnd + settleMs, v_i = |p_{i+1} - p_{i-1}| / 0.05 s. */
export function measure(tl: Timeline, m: TLMark): Meas {
  const hit = measured.get(m);
  if (hit !== undefined) return hit;
  const t: number[] = [];
  const p: Pt[] = [];
  for (let s = tl.snapAt; s <= tl.liveEnd + tl.settleMs + 1e-9; s += KEY) {
    t.push(s);
    p.push(at(m.keys, s));
  }
  const n = t.length;
  const v = t.map((_, i) => (i === 0 || i === n - 1 ? NaN : dist(p[i + 1] as Pt, p[i - 1] as Pt) / 0.05));
  const out = { t, p, v };
  measured.set(m, out);
  return out;
}
const tag = (b: Built, m: TLMark): string => `${b.name} ${m.side}${m.slot}`;
const clockPlay = (ev: PlayEvent): boolean => ev.play.kind === "noPlay" || ev.play.kind === "kneel" || ev.play.kind === "spike";
export const isLive = (b: Built): boolean => b.tl.liveEnd > b.tl.snapAt;

/** N1: v <= 1.15 x his own top; on an anchor-demanded leg 1.25 x the leg's required mean. */
export function n1(b: Built): string[] {
  const bad: string[] = [];
  for (const m of b.tl.marks) {
    const M = measure(b.tl, m);
    const nat = natOf(m);
    for (let i = 0; i < M.v.length; i++) {
      const v = M.v[i] as number;
      if (Number.isNaN(v)) continue;
      const t = M.t[i] as number;
      const dm = nat.demanded.find((d) => t >= d.t0 - 1e-9 && t <= d.t1 + 1e-9);
      const cap = dm !== undefined ? 1.25 * dm.mean : 1.15 * topOf(m);
      if (v > cap + 1e-9) {
        bad.push(`${tag(b, m)} ${v.toFixed(2)} yd/s > ${cap.toFixed(2)} at ${(t - b.tl.snapAt).toFixed(0)} ms`);
        break;
      }
    }
  }
  return bad;
}

/** N3: every pair on one side at one position, where both move (400 ms or more in common): RMS speed difference >= 0.2 yd/s. */
export function n3(b: Built): { pairs: number; bad: string[] } {
  const bad: string[] = [];
  let pairs = 0;
  for (const [i, a] of b.tl.marks.entries())
    for (const c of b.tl.marks.slice(i + 1)) {
      if (a.side !== c.side || a.position !== c.position) continue;
      const A = measure(b.tl, a);
      const C = measure(b.tl, c);
      let n = 0;
      let s = 0;
      A.v.forEach((v, j) => {
        const w = C.v[j] as number;
        if (Number.isNaN(v) || Number.isNaN(w) || v < 1 || w < 1) return;
        n++;
        s += (v - w) ** 2;
      });
      if (n * KEY < 400) continue;
      pairs++;
      const rms = Math.sqrt(s / n);
      if (rms < 0.2) bad.push(`${b.name} ${a.side}${a.slot} and ${c.slot}: RMS ${rms.toFixed(3)} yd/s over ${n} keys`);
    }
  return { pairs, bad };
}

/** N4: in every 500 ms window where v stays above 0.5 x top, max v - min v >= 0.02 x top. */
export function n4(b: Built): string[] {
  const bad: string[] = [];
  if (clockPlay(b.ev)) return bad;
  const W = 500 / KEY;
  for (const m of b.tl.marks) {
    const M = measure(b.tl, m);
    const top = topOf(m);
    for (let i = 0; i + W < M.v.length; i++) {
      const win = M.v.slice(i, i + W + 1);
      if (win.some((v) => Number.isNaN(v) || v <= 0.5 * top)) continue;
      const span = Math.max(...win) - Math.min(...win);
      if (span < 0.02 * top) {
        bad.push(`${tag(b, m)}: ${span.toFixed(3)} yd/s spread from ${((M.t[i] as number) - b.tl.snapAt).toFixed(0)} ms`);
        break;
      }
    }
  }
  return bad;
}

/** N5, first clause: every mark not exempt has v >= 0.3 yd/s on at least 95% of keys from his start to the whistle. */
export function n5Moving(b: Built): string[] {
  const bad: string[] = [];
  if (clockPlay(b.ev)) return bad;
  const { tl, ev } = b;
  for (const m of tl.marks) {
    // States: the sacked QB and his sacker after the sack, the holder and the tackler in the last convergeMs.
    let exempt = Infinity;
    if (ev.play.kind === "sack" && (m.roles.includes("sacker") || m.roles.includes("passer"))) exempt = Math.min(exempt, ...natOf(m).anchors.map((a) => a.t).filter((x) => x < tl.liveEnd - 1e-6), tl.liveEnd);
    if (m.playerId === tl.holder || m.playerId === tl.tackler) exempt = Math.min(exempt, tl.liveEnd - motion.convergeMs);
    const M = measure(tl, m);
    const set = at(m.keys, tl.snapAt);
    const i0 = M.p.findIndex((q) => dist(q, set) > 1e-6);
    if (i0 < 0) {
      bad.push(`${tag(b, m)}: never moves`);
      continue;
    }
    const t1 = Math.min(tl.liveEnd, exempt);
    let n = 0;
    let ok = 0;
    M.v.forEach((v, i) => {
      const t = M.t[i] as number;
      if (i < i0 || t > t1 || Number.isNaN(v)) return;
      n++;
      if (v >= 0.3) ok++;
    });
    if (n > 0 && ok / n < 0.95) bad.push(`${tag(b, m)}: moving on ${((100 * ok) / n).toFixed(0)}% of ${n} keys`);
  }
  return bad;
}

/**
 * N5's engaged linemen, from engage end to the release or the whistle: v >= 0.4 on 90% of keys,
 * mean v in [0.8, 3.0], M6's contact (the pair keeps the distance it engaged at within 0.3 yd, from
 * each pair's own engage end) and, when the raw build is given, nobody wins (PR11: the mean offset
 * along the pair's axis from the designed drift within 0.15 yd).
 */
export function n5Engaged(b: Built, raw: Timeline | null): { windows: number; bad: string[] } {
  const bad: string[] = [];
  let windows = 0;
  if (clockPlay(b.ev)) return { windows, bad };
  const { tl } = b;
  for (const m of tl.marks) {
    const e = natOf(m).engaged;
    if (e === undefined || e.to - e.from < 4 * KEY) continue;
    windows++;
    const M = measure(tl, m);
    const vs = M.v.filter((v, i) => !Number.isNaN(v) && (M.t[i] as number) >= e.from - 1e-9 && (M.t[i] as number) <= e.to + 1e-9);
    if (vs.length === 0) continue;
    const share = vs.filter((v) => v >= 0.4).length / vs.length;
    const mean = vs.reduce((s, v) => s + v, 0) / vs.length;
    if (share < 0.9) bad.push(`${tag(b, m)}: v >= 0.4 on ${(100 * share).toFixed(0)}% of the engaged window`);
    if (mean < 0.8 || mean > 3.0) bad.push(`${tag(b, m)}: engaged mean ${mean.toFixed(2)} yd/s`);
    const r = raw?.marks.find((x) => x.playerId === m.playerId);
    if (r !== undefined) {
      let off = 0;
      let cnt = 0;
      for (let t = Math.ceil(e.from / KEY) * KEY; t <= e.to; t += KEY) {
        const g = at(m.keys, t);
        const q = at(r.keys, t);
        off += (g.x - q.x) * e.axis.x + (g.y - q.y) * e.axis.y;
        cnt++;
      }
      if (cnt > 0 && Math.abs(off / cnt) > 0.15) bad.push(`${tag(b, m)}: mean offset ${(off / cnt).toFixed(3)} yd along the pair's axis (somebody is drawn winning)`);
    }
    const mate = e.partner === null ? undefined : tl.marks.find((x) => x.playerId === e.partner);
    const me = mate === undefined ? undefined : natOf(mate).engaged;
    if (mate !== undefined && me !== undefined) {
      const t0 = Math.max(e.from, me.from);
      const t1 = Math.min(e.to, me.to);
      const ref = dist(at(m.keys, t0), at(mate.keys, t0));
      for (let t = t0; t <= t1; t += KEY) {
        const d = dist(at(m.keys, t), at(mate.keys, t));
        if (Math.abs(d - ref) > 0.3) {
          bad.push(`${tag(b, m)} and ${mate.slot}: contact ${ref.toFixed(2)} to ${d.toFixed(2)} yd at ${(t - tl.snapAt).toFixed(0)} ms (M6)`);
          break;
        }
      }
    }
  }
  return { windows, bad };
}

/** N6: every fact anchor at its time and place within 1e-6 yd. */
export function n6Anchors(b: Built): { n: number; bad: string[] } {
  const bad: string[] = [];
  let n = 0;
  for (const m of b.tl.marks)
    for (const a of natOf(m).anchors) {
      n++;
      const d = dist(at(m.keys, a.t), a);
      if (d > 1e-6) bad.push(`${tag(b, m)} anchor at ${(a.t - b.tl.snapAt).toFixed(0)} ms off by ${d.toExponential(2)} yd`);
    }
  return { n, bad };
}

/** N6 and A2: the holder and the tackler are at the ball at the whistle. */
export function atTheBall(b: Built): string[] {
  const bad: string[] = [];
  const fin = at(b.tl.ball, b.tl.liveEnd);
  for (const id of [b.tl.holder, b.tl.tackler]) {
    const m = id === null ? undefined : b.tl.marks.find((x) => x.playerId === id);
    if (m !== undefined && dist(at(m.keys, b.tl.liveEnd), fin) > 1e-6) bad.push(`${tag(b, m)} not at the ball at the whistle`);
  }
  return bad;
}

/** N6: in the settle speed never rises by more than 0.05 yd/s a key and is 0.2 yd/s or less at its end. */
export function n6Settle(b: Built): string[] {
  const bad: string[] = [];
  const { tl } = b;
  for (const m of tl.marks) {
    const M = measure(tl, m);
    const ks = M.t.map((t, i) => ({ t, v: M.v[i] as number })).filter((q) => q.t > tl.liveEnd && !Number.isNaN(q.v));
    for (let i = 1; i < ks.length; i++)
      if ((ks[i] as { v: number }).v > (ks[i - 1] as { v: number }).v + 0.05) {
        bad.push(`${tag(b, m)}: speed rises in the settle at ${((ks[i] as { t: number }).t - tl.liveEnd).toFixed(0)} ms`);
        break;
      }
    const endV = dist(at(m.keys, tl.liveEnd + tl.settleMs), at(m.keys, tl.liveEnd + tl.settleMs - KEY)) / 0.025;
    if (endV > 0.2) bad.push(`${tag(b, m)}: ${endV.toFixed(2)} yd/s at the end of the settle`);
  }
  return bad;
}

/**
 * A3 and contract 3, as timeline.test.ts checks them: after the snap window no unnamed mark touches
 * the ball (1 yd, read every 12.5 ms), and on every 25 ms key no unnamed defender is inside the
 * 2.5 yd ring, or inside the flight ring while the ball is in the air.
 */
export function ring(b: Built): string[] {
  const { tl } = b;
  const bad: string[] = [];
  const R = templates.field.clearOfBallYards;
  const inAir = (t: number): boolean => tl.paths.some((f) => f.kind === "ball" && t >= f.start && t <= f.end);
  for (const m of tl.marks) {
    if (m.fact) continue;
    for (let t = tl.snapWindowEnd; t < tl.liveEnd - 1; t += 12.5) {
      const onKey = Math.abs(t / 25 - Math.round(t / 25)) < 1e-6;
      const r = dist(at(m.keys, t), at(tl.ball, Math.min(t, tl.liveEnd - 1)));
      if (r < 1) {
        bad.push(`${tag(b, m)} touches the ball at ${(t - tl.snapAt).toFixed(0)} ms`);
        break;
      }
      if (onKey && m.side === "X" && r < (inAir(t) ? Math.min(R, motion.natural.flightRingYards) : R) - 1e-6) {
        bad.push(`${tag(b, m)} inside the ring at ${(t - tl.snapAt).toFixed(0)} ms (${r.toFixed(2)} yd)`);
        break;
      }
    }
  }
  return bad;
}

/** R-C5, "nobody frozen": from each unnamed mark's start to the read (the throw or the handoff) he moves on every key. */
export function frozenBeforeRead(b: Built): { checked: boolean; bad: string[] } {
  const { tl } = b;
  const bad: string[] = [];
  const t0 = tl.snapAt + motion.maxStartMs + KEY;
  const t1 = Math.min(specRead(tl), tl.liveEnd);
  if (t1 - t0 < 2 * KEY) return { checked: false, bad };
  for (const m of tl.marks) {
    if (tl.involved.includes(m.playerId)) continue;
    for (let t = Math.ceil(t0 / KEY) * KEY; t + KEY <= t1; t += KEY)
      if (dist(at(m.keys, t), at(m.keys, t + KEY)) < 1e-6) {
        bad.push(`${tag(b, m)} still at ${(t - tl.snapAt).toFixed(0)} ms`);
        break;
      }
  }
  return { checked: true, bad };
}

/**
 * M5 (motion.test.ts, with its lead-approved skips): after the read at least half the unnamed
 * non-DL defenders end the play closer to the ball. PR-C10: the window a play must leave is read
 * from the marks' own readMs and accelMs. Null when the play is skipped.
 */
export function m5(b: Built): { closer: number; of: number } | null {
  const { ev, tl } = b;
  if (ev.play.kind !== "run" && ev.play.kind !== "pass") return null;
  if (ev.play.end.possession !== "offense") return null;
  if ("outOfBounds" in ev.play && ev.play.outOfBounds === true) return null;
  const ds = tl.marks.filter((m) => m.side === "X" && !m.fact && m.position !== "DL");
  if (ds.length === 0) return null;
  // His own readMs; nat.reactionMs holds the same number (PR15) and is there on a build with no record.
  const window = Math.max(...ds.map((m) => (reactIf(m)?.readMs ?? natOf(m).reactionMs) + natOf(m).accelMs));
  if (tl.read > tl.liveEnd - window) return null;
  const br = at(tl.ball, tl.read);
  const be = at(tl.ball, tl.liveEnd - 1);
  if (dist(be, br) > 15) return null;
  const closer = ds.filter((m) => dist(at(m.keys, tl.liveEnd), be) < dist(at(m.keys, tl.read), br)).length;
  return { closer, of: ds.length };
}

/**
 * M7 (motion.test.ts): in the settle the ball, the holder and the tackler don't move, and every
 * other mark moves at most settleMaxYards.
 */
export function m7(b: Built): string[] {
  const { tl } = b;
  const bad: string[] = [];
  const end = tl.liveEnd + tl.settleMs;
  if (dist(at(tl.ball, tl.liveEnd), at(tl.ball, end)) >= 1e-9) bad.push(`${b.name}: the ball moves in the settle`);
  for (const m of tl.marks) {
    const moved = dist(at(m.keys, tl.liveEnd), at(m.keys, end));
    if (m.playerId === tl.holder || m.playerId === tl.tackler) {
      if (moved >= 1e-9) bad.push(`${tag(b, m)}: at the ball, yet moves ${moved.toFixed(3)} yd in the settle`);
    } else if (moved > motion.settleMaxYards + 1e-9) bad.push(`${tag(b, m)}: moves ${moved.toFixed(3)} yd in the settle`);
  }
  return bad;
}

/**
 * The motion data with every band pair of ratings.scrimmage set to [0, 0] (PR-C9 (b)): the build
 * the shipped one is compared with, so the claim is about the new block alone.
 */
export function zeroedScrimmage(): Motion {
  const copy = structuredClone(motion) as unknown as Tree;
  const block = (copy["ratings"] as Tree)["scrimmage"];
  if (typeof block !== "object" || block === null) throw new Error("motion data has no ratings.scrimmage (PR-C15)");
  let pairs = 0;
  const walk = (o: Tree): void => {
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number")) {
        o[k] = [0, 0];
        pairs++;
      } else if (typeof v === "object" && v !== null && !Array.isArray(v)) walk(v as Tree);
    }
  };
  walk(block as Tree);
  // The spec's table lists 18 band pairs.
  if (pairs < 18) throw new Error(`ratings.scrimmage holds ${pairs} band pairs, the spec's table lists 18`);
  return copy as unknown as Motion;
}

/**
 * R-C19 with ratings (misses-deep.spec.test.ts, PR-C8): on a built incompletion the target stays
 * within 0.1 yd of his template track to the whistle, and within reachYards + 0.1 in the reach
 * window. His template track is the same event with him unnamed, thrown to a lineman 60 yd behind
 * the line on a 6 s flight with no live cap, so the reference holds the ball at least as long.
 * `full` runs every formation, pass class and target against all three presets; otherwise each
 * against one of the three in turn.
 */
export function rc19Rated(full: boolean): { n: number; bad: string[] } {
  const MISS = motion.miss;
  const presets = ["nickelCover3", "nickel2Man", "baseCover2"];
  const bad: string[] = [];
  let n = 0;
  let turn = 0;
  for (const f of ["shotgun", "underCenter", "pistol", "empty", "heavy"])
    for (const call of ["shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"])
      for (const target of ["O-WR1", "O-WR2", "O-TE1", "O-RB1"]) {
        if (((personnel.offense[f] as Record<string, number>)[target.slice(2).replace(/\d+$/, "")] ?? 0) === 0) continue;
        turn++;
        for (const preset of full ? presets : [presets[turn % presets.length] as string]) {
          const ev = mk({ formation: f, call, preset, result: "incomplete", parts: { passer: "O-QB1", target } });
          const ratings = tableRatings(ev);
          const tl = build(ev, ratings);
          const fl = flightOf(tl);
          if (fl === undefined || tl.miss === undefined || !unclamped(tl)) continue;
          const late = readDetail(ev.play).onField?.offense.find((x) => x.position === "OL")?.id;
          if (late === undefined) throw new Error("no lineman to receive the reference throw");
          const detail = { ...(ev.play.detail as Record<string, unknown>), participants: { passer: "O-QB1", receiver: late }, airYards: -60, yards: 5 };
          const ref = build({ ...ev, play: { kind: "pass", seconds: 6, end: { spot: ev.before.spot + 5, possession: "offense" }, detail } as PlayEvent["play"] }, ratings, longMotion());
          const label = `${f} ${call} vs ${preset} to ${target} (${tl.miss.kind ?? "no kind"})`;
          if (ref.snapAt !== tl.snapAt || (flightOf(ref)?.start ?? -Infinity) < fl.start - 1e-6) {
            bad.push(`${label}: the reference can't be compared (its snap or its throw is earlier)`);
            continue;
          }
          n++;
          const me = markOf(tl, target);
          const tpl = markOf(ref, target);
          for (let t = tl.snapAt; t <= tl.liveEnd; t += KEY) {
            const inReach = t >= fl.end - MISS.reachMs - 1e-9 && t <= fl.end + MISS.reachMs + 1e-9;
            const d = dist(at(me.keys, t), at(tpl.keys, t));
            if (d > (inReach ? MISS.reachYards + 0.1 : 0.1)) {
              bad.push(`${label}: ${d.toFixed(2)} yd off at ${(t - tl.snapAt).toFixed(0)} ms (throw ${(fl.start - tl.snapAt).toFixed(0)}, arrival ${(fl.end - tl.snapAt).toFixed(0)})`);
              break;
            }
          }
        }
      }
  return { n, bad };
}

/**
 * PR6, round 3 ("he is not thrown off the ball and then reversed into the tackle"): the tackler's
 * velocity toward the ball, read on each 25 ms step from 60 ms before the read to 600 ms after it
 * (to the whistle when that is sooner). It is his step's component along the bearing from him to
 * the ball at the start of the step, in yd/s; a step under 0.3 yd/s either way has no sign (N5's
 * reading of "moving").
 *
 * `reverses`: he goes toward the ball, then away from it, then toward it again. That is the
 * thrown-off tackler. One change from away to toward is not counted: it is a defender coming out
 * of his drop, which every tackler who waits for his read does. `turns` counts every change of
 * sign, for the report. `nearYards` is his distance from the ball at the read. Null when the play
 * has no tackler mark or the window is under two steps.
 */
export function tacklerReversal(tl: Timeline): { readonly reverses: boolean; readonly turns: number; readonly nearYards: number } | null {
  const m = tl.tackler === null ? undefined : tl.marks.find((x) => x.playerId === tl.tackler);
  if (m === undefined) return null;
  const t0 = tl.read - 60;
  const t1 = Math.min(tl.read + 600, tl.liveEnd);
  if (t1 - t0 < 2 * KEY) return null;
  const signs: number[] = [];
  for (let t = t0; t + KEY <= t1 + 1e-9; t += KEY) {
    const p = at(m.keys, t);
    const q = at(m.keys, t + KEY);
    const ball = at(tl.ball, t);
    const d = dist(ball, p);
    if (d < 1e-6) continue;
    const toward = (((q.x - p.x) * (ball.x - p.x) + (q.y - p.y) * (ball.y - p.y)) / d / KEY) * 1000;
    const sign = toward > 0.3 ? 1 : toward < -0.3 ? -1 : 0;
    if (sign !== 0 && signs.at(-1) !== sign) signs.push(sign);
  }
  return { reverses: signs.join(",").includes("1,-1,1"), turns: signs.length - 1, nearYards: dist(at(m.keys, tl.read), at(tl.ball, tl.read)) };
}

/**
 * PR6, round 3, the defect itself: the tackler thrown off the ball. His fastest movement away from
 * the ball from 60 ms before the read to 600 ms after it (to the whistle when that is sooner), read
 * between his drawn keys at their own times (the shove was 0.6 yd in 12.5 ms, which a 25 ms resample
 * halves), over his own top on the screen clock. Away is the part of his own step along the bearing
 * from the ball to him at its start, so a ball running off him does not count. Only steps that start
 * within `within` yd of the ball are read (the ring is 2.5 yd; a man backing off in coverage far from
 * the ball is not pushed off it); `yards` is how far away the fastest one starts. Null when the play
 * has no tackler mark; a share of 0 when no step moves him away.
 */
export function tacklerAway(tl: Timeline, within = Infinity): { readonly share: number; readonly yps: number; readonly top: number; readonly t: number; readonly yards: number } | null {
  const m = tl.tackler === null ? undefined : tl.marks.find((x) => x.playerId === tl.tackler);
  if (m === undefined) return null;
  const t0 = tl.read - 60;
  const t1 = Math.min(tl.read + 600, tl.liveEnd);
  const times = [...new Set([t0, ...m.keys.map((k) => k.t).filter((t) => t > t0 && t < t1), t1])].sort((a, b) => a - b);
  let yps = 0;
  let when = t0;
  let yards = NaN;
  for (let i = 1; i < times.length; i++) {
    const a = times[i - 1] as number;
    const b = times[i] as number;
    // Two keys at one time (floating point) have no speed.
    if (b - a < 1e-3) continue;
    const p = at(m.keys, a);
    const q = at(m.keys, b);
    const ball = at(tl.ball, a);
    const d = dist(p, ball);
    if (d < 1e-6 || d > within + 1e-9) continue;
    const away = (((q.x - p.x) * (p.x - ball.x) + (q.y - p.y) * (p.y - ball.y)) / d / (b - a)) * 1000;
    if (away > yps) {
      yps = away;
      when = a;
      yards = d;
    }
  }
  return { share: yps / topOf(m), yps, top: topOf(m), t: when - tl.read, yards };
}

/** The templates with no ring round the ball for the defense (contract 3), to see what the ring alone moves. */
const ringless = { ...templates, field: { ...templates.field, clearOfBallYards: 0 } };
/**
 * When the ring first pushes a defender, unnamed on this event: the first key at or after the read
 * (and before the whistle) at which he is off where the same event with no ring puts him. Both are
 * the raw builds (no natural motion), so the push is the ring's own and not smoothed. Read from the
 * last key before the read too: a defender the ring already holds there gives that key, before the
 * read. Null when it never pushes him or the two builds do not share a clock.
 */
export function firstRingPush(ev: PlayEvent, ratings: Ratings, id: string): number | null {
  const withRing = build(ev, ratings, motion, { natural: false });
  const without = timeline({ event: ev, runoffSeconds: 0, human: null, ownStart: "lined" }, ringless, ctxOf(ratings, motion, { natural: false }));
  if (withRing.snapAt !== without.snapAt || withRing.read !== without.read || withRing.liveEnd !== without.liveEnd) return null;
  const a = markOf(withRing, id).keys;
  const b = markOf(without, id).keys;
  for (const k of a) if (k.t > withRing.read - KEY && k.t < withRing.liveEnd - 1e-9 && dist(at(a, k.t), at(b, k.t)) > 1e-9) return k.t;
  return null;
}

/** Every awareness from 40 to 90 in steps of 2: five steps of 15 miss a band of a point or two. */
export const AWARENESS_SWEEP: readonly number[] = Array.from({ length: 26 }, (_, i) => 40 + 2 * i);
/**
 * PR3, round 3: "a DL's release never comes later as his awareness rises". Each unnamed DL of the
 * samples (not a tackling or otherwise named one) built at every awareness of `sweep`: one line for
 * each step at which his delayMs, or his pursueAt after the read, rises.
 */
export function dlReleaseRises(samples: readonly Sample[], sweep: readonly number[]): { linemen: number; later: string[] } {
  const later: string[] = [];
  let linemen = 0;
  for (const s of samples) {
    const base = build(s.ev, s.ratings);
    for (const D of base.marks) {
      if (D.side !== "X" || D.position !== "DL" || base.involved.includes(D.playerId) || D.playerId === base.tackler) continue;
      linemen++;
      let was: { delayMs: number; after: number | null } | null = null;
      for (const [i, a] of sweep.entries()) {
        const tl = build(s.ev, withRating(s.ratings, D.playerId, "awareness", a));
        const r = reactOf(markOf(tl, D.playerId));
        const now = { delayMs: r.delayMs, after: r.pursueAt === null ? null : r.pursueAt - tl.read };
        if (was !== null) {
          const who = `${s.name} ${D.slot}, awareness ${sweep[i - 1]} to ${a}`;
          if (now.delayMs > was.delayMs + 1e-9) later.push(`${who}: delayMs ${was.delayMs.toFixed(0)} to ${now.delayMs.toFixed(0)}`);
          if (now.after !== null && was.after !== null && now.after > was.after + 1e-9) later.push(`${who}: pursueAt ${was.after.toFixed(0)} to ${now.after.toFixed(0)} ms after the read`);
        }
        was = now;
      }
    }
  }
  return { linemen, later };
}

/** Positions of a mark in two builds from t0 to t1, every `step` ms: the first difference, or null. */
export function firstDiff(a: readonly Key[], b: readonly Key[], t0: number, t1: number, step = 5, tol = 1e-9): { t: number; d: number } | null {
  for (let t = t0; t <= t1 + 1e-9; t += step) {
    const d = dist(at(a, t), at(b, t));
    if (d > tol) return { t, d };
  }
  return null;
}

// ================================================================ slice 2 (PR7, PR8, PR-C11, PR-C12)

/**
 * The spec's A/B method for any rating: a test copy of the motion data in which every band that
 * reads `rating` at the shipped `by` values is [0, 0], except `keep`. abMotion() above is the slice
 * 1 version and is left as it was.
 */
export type AbRating = "awareness" | "agility" | "speed" | "coverage" | "routeRunning" | "runBlock";
const SCRIMMAGE = ["ratings", "scrimmage"] as const;
const BANDS_BY_RATING: Readonly<Record<AbRating, readonly (readonly string[])[]>> = {
  awareness: [...AWARENESS_BANDS, [...SCRIMMAGE, "pursuit", "leadMs"]],
  agility: [...AGILITY_BANDS, [...SCRIMMAGE, "pursuit", "turnShare"]],
  speed: [["ratings", "default", "topShare"], [...SCRIMMAGE, "man", "cushionYards"]],
  coverage: [[...SCRIMMAGE, "man", "lagMs"], [...SCRIMMAGE, "air", "ms"], [...SCRIMMAGE, "air", "varyMs"]],
  routeRunning: [[...SCRIMMAGE, "man", "receiverLagMs"], [...SCRIMMAGE, "breakPaceShare"]],
  runBlock: [[...SCRIMMAGE, "stalk", "lagMs"]],
};
export function abMotionFor(rating: AbRating, keep: string): Motion {
  const copy = structuredClone(motion) as unknown as Tree;
  const byPosition = ((copy["ratings"] as Tree)["byPosition"] ?? {}) as Record<string, Tree>;
  const bands = BANDS_BY_RATING[rating];
  const name = (path: readonly string[]): string => path.filter((k) => k !== "ratings" && k !== "scrimmage").join(".");
  if (!bands.some((path) => name(path) === keep)) throw new Error(`no band ${keep} reads ${rating}`);
  for (const path of bands) {
    if (name(path) === keep) continue;
    setPath(copy, path, [0, 0]);
    if (path[1] === "default") for (const band of Object.values(byPosition)) if (band[path[2] as string] !== undefined) band[path[2] as string] = [0, 0];
  }
  return copy as unknown as Motion;
}
/** A band pair of ratings.scrimmage at a rating: linear from `lo` to `hi`, clamped (States). */
export function bandAt(path: readonly string[], rating: number): number {
  let cur: unknown = (motion.ratings as unknown as Tree)["scrimmage"];
  for (const k of path) cur = (cur as Tree)[k];
  const [a, b] = cur as readonly [number, number];
  const u = Math.max(0, Math.min(1, (rating - motion.ratings.lo) / (motion.ratings.hi - motion.ratings.lo)));
  return a + (b - a) * u;
}

// ---------------------------------------------------------------- the templates, read the motion spec's way (routes-pace.spec.test.ts)

type RawPt = readonly [number, number];
export interface RawRoute {
  readonly pts: readonly { readonly p: RawPt; readonly pauseMs: number; readonly pace: number }[];
  readonly finish: string;
  readonly axis: string;
}
const posOf = (slot: string): string => slot.replace(/\d+$/, "");
const rawGroup = (k: string, name: string): Record<string, unknown> | undefined => (templatesRaw[k] as Record<string, Record<string, unknown>>)[name];
function normal(v: unknown): RawRoute | undefined {
  if (v === undefined) return undefined;
  const o = (Array.isArray(v) ? { pts: v } : v) as { pts: unknown[]; finish?: string; axis?: string };
  const pts = o.pts.map((w) => (Array.isArray(w) ? { p: w as unknown as RawPt, pauseMs: 0, pace: 1 } : { p: (w as { p: RawPt }).p, pauseMs: (w as { pauseMs?: number }).pauseMs ?? 0, pace: (w as { pace?: number }).pace ?? 1 }));
  return { pts, finish: o.finish ?? "sit", axis: o.axis ?? "in" };
}
/** The lookup chain: `role:position`, the role, the position. */
function chain(table: Record<string, unknown> | undefined, role: string | undefined, pos: string): RawRoute | undefined {
  for (const k of role === undefined ? [pos] : [`${role}:${pos}`, role, pos]) if (table?.[k] !== undefined) return normal(table[k]);
  return undefined;
}
/** R1's roles and strong side, from the alignment alone. */
export function rolesOf(formation: string): { roles: Map<string, string>; strong: 1 | -1 } {
  const recv = Object.entries(rawGroup("offense", formation) as Record<string, RawPt>).filter(([s]) => posOf(s) === "WR" || posOf(s) === "TE");
  const left = recv.filter(([, a]) => a[0] < 0);
  const right = recv.filter(([, a]) => a[0] > 0);
  const te = (l: typeof recv): number => l.filter(([s]) => posOf(s) === "TE").length;
  const strong: 1 | -1 = right.length !== left.length ? (right.length > left.length ? 1 : -1) : te(right) !== te(left) ? (te(right) > te(left) ? 1 : -1) : 1;
  const roles = new Map<string, string>();
  for (const [list, s] of [[left, -1], [right, 1]] as const) [...list].sort((a, b) => Math.abs(b[1][0]) - Math.abs(a[1][0])).forEach(([slot], i) => roles.set(slot, `${s === strong ? "s" : "w"}${i + 1}`));
  return { roles, strong };
}
/** A template placed from a field start (R3): its axis sign, the sideline margin, the end line less 1 yd. */
function place(start: Pt, r: RawRoute, strong: number): Pt[] {
  const sign = r.axis === "strong" || r.axis === "play" ? strong : start.x <= MID_X ? 1 : -1;
  const m = motion.sidelineMarginYards;
  return r.pts.map((w) => ({ x: Math.max(m, Math.min(FIELD_WIDTH - m, start.x + sign * w.p[0])), y: Math.min(100 + 10 - 1, start.y + w.p[1]) }));
}
/** The route a receiver runs on a pass leaf, by the lookup chain. */
export const routeOf = (formation: string, leaf: string, slot: string): RawRoute | undefined => chain(rawGroup("routes", leaf), rolesOf(formation).roles.get(slot), posOf(slot));
/** His placed route as a polyline from his set spot, and the indexes of his rests (his start and each pause). */
export function routeLine(tl: Timeline, m: TLMark, formation: string, route: RawRoute): { pts: Pt[]; rests: Set<number> } {
  const set = at(m.keys, tl.snapAt);
  const pts: Pt[] = [set];
  const rests = new Set<number>([0]);
  place(set, route, rolesOf(formation).strong).forEach((p, i) => {
    if (dist(p, pts.at(-1) as Pt) <= 1e-6) return;
    pts.push(p);
    if ((route.pts[i]?.pauseMs ?? 0) > 0) rests.add(pts.length - 1);
  });
  return { pts, rests };
}
const turnAt = (a: Pt, b: Pt, c: Pt): number => {
  const cos = ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (dist(a, b) * dist(b, c));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
};
const offLine = (p: Pt, a: Pt, b: Pt): number => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / dist(a, b);

interface Prof {
  readonly t: number;
  readonly p: Pt;
  readonly s: number;
  readonly v: number;
}
/** Speeds (yd/s) per key interval and the arc length at each key. */
function profile(keys: readonly Key[], t0: number, t1: number): Prof[] {
  const out: Prof[] = [];
  let s = 0;
  for (let t = t0; t + KEY <= t1; t += KEY) {
    const a = at(keys, t);
    const b = at(keys, t + KEY);
    out.push({ t, p: a, s, v: (dist(a, b) / KEY) * 1000 });
    s += dist(a, b);
  }
  return out;
}
const nearestTo = (prof: readonly Prof[], p: Pt): number => prof.reduce((bi, q, k) => (dist(q.p, p) < dist((prof[bi] as Prof).p, p) ? k : bi), 0);

/**
 * R-C6 (routes-pace.spec.test.ts plantCheck) with the mark's own values, as PR-C12 (c) and
 * Superseded 6 ask: his own top and accelMs, and the break pace x (1 + his breakPaceShare).
 */
export function rc6(label: string, m: TLMark, t0: number, t1: number, pts: readonly Pt[], rests: ReadonlySet<number>, finish: string, share = reactIf(m)?.breakPaceShare ?? 0): string[] {
  const bad: string[] = [];
  const prof = profile(m.keys, t0, t1);
  const F = motion.fillet;
  const top = natOf(m).top;
  const L = F.plantYards + (0.5 * motion.routePace * top * natOf(m).accelMs) / 1000;
  const tol = 0.02 * motion.routePace * top;
  const arcs: { sA: number; sB: number }[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1] as Pt;
    const b = pts[i] as Pt;
    const c = pts[i + 1] as Pt;
    const turn = turnAt(a, b, c);
    const near = prof.length < 3 ? -1 : nearestTo(prof, b);
    if (turn < 1 || near < 0 || rests.has(i) || near >= prof.length - 2 || dist((prof[near] as Prof).p, b) > 2.5) {
      arcs.push({ sA: NaN, sB: NaN });
      continue;
    }
    const pace = (turn > F.sharpDeg ? F.sharpPace : F.roundPace) * (1 + share);
    let k0 = near;
    while (k0 > 0 && offLine((prof[k0] as Prof).p, a, b) > 0.005) k0--;
    let k1 = near;
    while (k1 < prof.length - 1 && offLine((prof[k1] as Prof).p, b, c) > 0.005) k1++;
    const sA = (prof[k0] as Prof).s;
    arcs.push({ sA, sB: (prof[k1] as Prof).s });
    let rest = i - 1;
    while (rest > 0 && !rests.has(rest)) rest--;
    let stem = 0;
    for (let j = rest + 1; j <= i; j++) stem += dist(pts[j - 1] as Pt, pts[j] as Pt);
    const sRest = nearestTo(prof, pts[rest] as Pt);
    const apex = ((prof[near] as Prof).v + (prof[Math.max(0, near - 1)] as Prof).v) / 2;
    const name = `${label} break ${i} (${turn.toFixed(0)} deg, stem ${stem.toFixed(1)} yd)`;
    const cap = 1.1 * pace * motion.routePace * top;
    if (apex > cap + 1e-9) bad.push(`${name}: apex ${apex.toFixed(2)} yd/s > ${cap.toFixed(2)}`);
    if (stem >= L) {
      const fall = prof.filter((q) => q.s >= sA - F.plantYards && q.s <= sA);
      const up = fall.findIndex((q, j) => j > 0 && q.v > (fall[j - 1] as Prof).v + tol);
      if (up > 0) bad.push(`${name}: speed rises inside the plant (${(fall[up - 1] as Prof).v.toFixed(2)} to ${(fall[up] as Prof).v.toFixed(2)} yd/s)`);
    } else {
      const stemPeak = Math.max(...prof.slice(sRest, k0 + 1).map((q) => q.v));
      if (apex > stemPeak + tol) bad.push(`${name}: short stem, apex ${apex.toFixed(2)} above the stem's peak ${stemPeak.toFixed(2)} yd/s`);
    }
  }
  arcs.forEach((r, j) => {
    if (Number.isNaN(r.sB)) return;
    const next = arcs.slice(j + 1).find((x) => !Number.isNaN(x.sA));
    const stop = Math.min(r.sB + F.reaccelYards, next === undefined ? Infinity : next.sA - F.plantYards);
    const rise = prof.filter((q) => q.s >= r.sB && q.s <= stop);
    const down = rise.findIndex((q, k) => k > 0 && q.v < (rise[k - 1] as Prof).v - tol);
    // Exempt (lead, 2026-11-15): the last leg, when it ends in a sit or block finish.
    if (j + 2 === pts.length - 1 && (finish === "sit" || finish === "block")) return;
    if (down > 0) bad.push(`${label} break ${j + 1}: speed falls inside the re-acceleration (${(rise[down - 1] as Prof).v.toFixed(2)} to ${(rise[down] as Prof).v.toFixed(2)} yd/s)`);
  });
  return bad;
}

/**
 * PR-C12 (c): his first sharp break (a turn over fillet.sharpDeg that is not a pause): the speed at
 * the arc's apex, read as R-C6 reads it, over his own top on the screen clock. Null when his route
 * has none or he has not passed it by t1.
 */
export function firstSharpApex(tl: Timeline, m: TLMark, formation: string, route: RawRoute, t1: number): { share: number; turn: number } | null {
  const { pts, rests } = routeLine(tl, m, formation, route);
  for (let i = 1; i < pts.length - 1; i++) {
    const turn = turnAt(pts[i - 1] as Pt, pts[i] as Pt, pts[i + 1] as Pt);
    if (turn <= motion.fillet.sharpDeg || rests.has(i)) continue;
    const prof = profile(m.keys, tl.snapAt, t1);
    if (prof.length < 3) return null;
    const near = nearestTo(prof, pts[i] as Pt);
    if (near >= prof.length - 2 || dist((prof[near] as Prof).p, pts[i] as Pt) > 2.5) return null;
    return { share: ((prof[near] as Prof).v + (prof[Math.max(0, near - 1)] as Prof).v) / 2 / topOf(m), turn };
  }
  return null;
}

/** How far each of two drawn paths strays from the other's line, over the length both cover by their end times (yd). */
export function pathGap(a: readonly Key[], aEnd: number, b: readonly Key[], bEnd: number, t0: number): number {
  const line = (keys: readonly Key[], t1: number): { p: Pt; s: number }[] => {
    const out: { p: Pt; s: number }[] = [];
    let s = 0;
    for (let t = t0; t <= t1 + 1e-9; t += 5) {
      const p = at(keys, t);
      if (out.length > 0) s += dist((out.at(-1) as { p: Pt }).p, p);
      out.push({ p, s });
    }
    return out;
  };
  const A = line(a, aEnd);
  const B = line(b, bEnd);
  const len = Math.min(A.at(-1)?.s ?? 0, B.at(-1)?.s ?? 0);
  const toSeg = (p: Pt, u: Pt, v: Pt): number => {
    const L2 = (v.x - u.x) ** 2 + (v.y - u.y) ** 2;
    const w = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - u.x) * (v.x - u.x) + (p.y - u.y) * (v.y - u.y)) / L2));
    return Math.hypot(p.x - u.x - w * (v.x - u.x), p.y - u.y - w * (v.y - u.y));
  };
  let worst = 0;
  for (const [P, Q] of [[A, B], [B, A]] as const)
    for (const q of P) {
      if (q.s > len) break;
      let d = Infinity;
      for (let j = 1; j < Q.length; j++) d = Math.min(d, toSeg(q.p, (Q[j - 1] as { p: Pt }).p, (Q[j] as { p: Pt }).p));
      worst = Math.max(worst, d);
    }
  return worst;
}

// ---------------------------------------------------------------- the coverage, the bite and the stalk, from the calls

/** The pass leaf of a play (a two-point try holds it in twoPointPlay). */
export const leafOf = (ev: PlayEvent): string => (ev.offense.call === "goForTwo" ? (ev.offense as { twoPointPlay?: string }).twoPointPlay ?? "" : ev.offense.call);
const blitzDrops = (preset: string): boolean => (templates.presetDrops[preset] ?? "") === "blitz";

/**
 * R9's man defenders and their receivers, from the calls and the set alone: a non-DL slot with a
 * manTargets spot and no zone landmark in the preset, and not a linebacker of a blitz drop set (he
 * rushes). His receiver is the WR, TE or RB nearest his spot at the set.
 */
export function manPairs(tl: Timeline, ev: PlayEvent): { readonly D: TLMark; readonly R: TLMark }[] {
  const preset = ev.defense ?? "";
  const out: { D: TLMark; R: TLMark }[] = [];
  const receivers = tl.marks.filter((m) => m.side === "O" && ["WR", "TE", "RB"].includes(m.position));
  if (receivers.length === 0) return out;
  for (const D of tl.marks) {
    const spot = templates.manTargets[preset]?.[D.slot];
    if (D.side !== "X" || D.position === "DL" || spot === undefined || templates.zones[preset]?.[D.slot] !== undefined) continue;
    if (blitzDrops(preset) && D.position === "LB") continue;
    const want = { x: MID_X + spot[0], y: tl.los - spot[1] };
    out.push({ D, R: receivers.reduce((b, m) => (dist(at(m.keys, tl.snapAt), want) < dist(at(b.keys, tl.snapAt), want) ? m : b)) });
  }
  return out;
}
/** The cushion in use before ratings: press in a blitz preset, else the plain one (R9). */
export const cushionInUse = (preset: string): number => (blitzDrops(preset) ? motion.man.pressCushionYards : motion.man.cushionYards);

/**
 * PR-C11's measure on two builds of one play: each build's mean distance from the defender to his
 * receiver (who is on his template to the throw, R-C7) over one window, from the first key at which
 * the receiver has come within 2 yd of the defender's depth in both builds to the earlier throw.
 * `back` is the mean depth of the defender past his receiver. `behind` (the criterion's measure since
 * Joseph's "Measure corners" of 2026-11-24) is the mean signed distance he is behind the receiver along
 * the receiver's own path: the path the receiver has run less the point of that path nearest the
 * defender, negative when he is ahead. Past the receiver's last place the path runs straight on. Null when a build has no throw or the
 * window is under `minMs`.
 */
export function trailGap(a: Timeline, b: Timeline, dId: string, rId: string, depthYards: number, minMs: number): { a: number; b: number; backA: number; backB: number; behindA: number; behindB: number; ms: number } | null {
  const fa = flightOf(a);
  const fb = flightOf(b);
  if (fa === undefined || fb === undefined || a.snapAt !== b.snapAt) return null;
  const t1 = Math.min(fa.start, fb.start);
  const begun = (tl: Timeline): number => {
    for (let t = tl.snapAt; t <= t1; t += KEY) if (Math.abs(at(markOf(tl, rId).keys, t).y - at(markOf(tl, dId).keys, t).y) <= depthYards) return t;
    return Infinity;
  };
  const t0 = Math.max(begun(a), begun(b));
  if (!(t1 - t0 >= minMs)) return null;
  const behind = (tl: Timeline): number => {
    const R = markOf(tl, rId).keys;
    const line: { p: Pt; t: number; s: number }[] = [];
    for (let t = tl.snapAt; t < t1 + 12.5 - 1e-9; t += 12.5) {
      const u = Math.min(t, t1);
      const p = at(R, u);
      const last = line.at(-1);
      line.push({ p, t: u, s: last === undefined ? 0 : last.s + dist(last.p, p) });
    }
    const end = line.at(-1) as { p: Pt; t: number; s: number };
    const before = at(R, t1 - 50);
    const L = dist(before, end.p);
    const ahead = 15;
    if (L > 1e-6) line.push({ p: { x: end.p.x + ((end.p.x - before.x) / L) * ahead, y: end.p.y + ((end.p.y - before.y) / L) * ahead }, t: Infinity, s: end.s + ahead });
    let sum = 0;
    let n = 0;
    for (let t = t0; t <= t1 + 1e-9; t += KEY) {
      const p = at(markOf(tl, dId).keys, t);
      let best = Infinity;
      let sD = 0;
      let sR = 0;
      for (let j = 1; j < line.length; j++) {
        const u = line[j - 1] as (typeof line)[number];
        const v = line[j] as (typeof line)[number];
        const L2 = (v.p.x - u.p.x) ** 2 + (v.p.y - u.p.y) ** 2;
        const w = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - u.p.x) * (v.p.x - u.p.x) + (p.y - u.p.y) * (v.p.y - u.p.y)) / L2));
        const d = Math.hypot(p.x - u.p.x - w * (v.p.x - u.p.x), p.y - u.p.y - w * (v.p.y - u.p.y));
        if (d < best - 1e-9) {
          best = d;
          sD = u.s + w * (v.s - u.s);
        }
        if (Number.isFinite(v.t) && t >= u.t - 1e-9 && t <= v.t + 1e-9) sR = u.s + (v.t - u.t < 1e-9 ? 0 : Math.max(0, Math.min(1, (t - u.t) / (v.t - u.t)))) * (v.s - u.s);
      }
      sum += sR - sD;
      n++;
    }
    return sum / n;
  };
  const mean = (tl: Timeline): { d: number; back: number } => {
    let d = 0;
    let back = 0;
    let n = 0;
    for (let t = t0; t <= t1 + 1e-9; t += KEY) {
      const p = at(markOf(tl, dId).keys, t);
      const q = at(markOf(tl, rId).keys, t);
      d += dist(p, q);
      back += p.y - q.y;
      n++;
    }
    return { d: d / n, back: back / n };
  };
  const A = mean(a);
  const B = mean(b);
  return { a: A.d, b: B.d, backA: A.back, backB: B.back, behindA: behind(a), behindB: behind(b), ms: t1 - t0 };
}

/** A linebacker's bite on play action: his greatest displacement from his set spot along readStep.playAction's bite in the first `ms` after the snap (yd). */
export function biteYards(tl: Timeline, m: TLMark, formation: string, ms: number): number {
  const route = normal(rawGroup("readStep", "playAction")?.["LB"]) as RawRoute;
  const [bx, by] = (route.pts[0] as { p: RawPt }).p;
  const dx = bx * rolesOf(formation).strong;
  const L = Math.hypot(dx, by);
  const set = at(m.keys, tl.snapAt);
  let best = 0;
  for (let t = tl.snapAt; t <= tl.snapAt + ms + 1e-9; t += KEY) {
    const p = at(m.keys, t);
    best = Math.max(best, ((p.x - set.x) * dx + (p.y - set.y) * by) / L);
  }
  return best;
}
/**
 * The bite itself between two builds of one linebacker: the largest difference of his place in `a`
 * from his place in `b`, along his bite, in the first `ms` after the snap (yd). A drop that runs the
 * same way as the bite (a run front's) is in both builds, so it does not read as bite.
 */
export function biteGapYards(a: Timeline, b: Timeline, id: string, formation: string, ms: number): number {
  const route = normal(rawGroup("readStep", "playAction")?.["LB"]) as RawRoute;
  const [bx, by] = (route.pts[0] as { p: RawPt }).p;
  const dx = bx * rolesOf(formation).strong;
  const L = Math.hypot(dx, by);
  const A = markOf(a, id).keys;
  const B = markOf(b, id).keys;
  let best = 0;
  for (let t = 0; t <= ms + 1e-9; t += KEY) {
    const p = at(A, a.snapAt + t);
    const q = at(B, b.snapAt + t);
    best = Math.max(best, ((p.x - q.x) * dx + (p.y - q.y) * by) / L);
  }
  return best;
}
/** The linebackers who take the read step on a pass: not a blitz drop set's (they rush), unnamed. */
export const readingLbs = (tl: Timeline, ev: PlayEvent): TLMark[] => (blitzDrops(ev.defense ?? "") ? [] : tl.marks.filter((m) => m.side === "X" && m.position === "LB" && !tl.involved.includes(m.playerId) && m.playerId !== tl.tackler));

/**
 * PR-C12 (a)'s second half, at the throw: within 3 yd of his assignment point (his zone landmark, or
 * his receiver's trail point at his own lag and cushion, as R-C10 (b) defines it), or moving toward
 * it over the last 200 ms. Null when he recovers; else a line.
 */
export function notRecovering(tl: Timeline, ev: PlayEvent, m: TLMark, within: number, lastMs: number): string | null {
  const throwT = flightOf(tl)?.start;
  if (throwT === undefined) return null;
  const preset = ev.defense ?? "";
  const z = templates.zones[preset]?.[m.slot];
  let goal: Pt;
  if (z !== undefined) goal = { x: MID_X + (z[0] + z[2]) / 2, y: tl.los + (z[1] + z[3]) / 2 };
  else {
    const pair = manPairs(tl, ev).find((p) => p.D.playerId === m.playerId);
    if (pair === undefined) return null;
    const r = reactOf(m);
    const q = at(pair.R.keys, throwT - (r.manLagMs ?? motion.man.lagMs));
    goal = { x: q.x, y: q.y + (r.cushionYards ?? cushionInUse(preset)) };
  }
  const p = at(m.keys, throwT);
  const was = at(m.keys, throwT - lastMs);
  if (dist(p, goal) <= within) return null;
  // As R-C10 (b) reads a displacement: from where it starts, toward the assignment point.
  const toward = ((p.x - was.x) * (goal.x - was.x) + (p.y - was.y) * (goal.y - was.y)) / dist(goal, was);
  return toward > 0 ? null : `${dist(p, goal).toFixed(1)} yd from his assignment point at the throw (${(throwT - tl.snapAt).toFixed(0)} ms), moving ${toward.toFixed(2)} yd toward it over the last ${lastMs} ms`;
}

/**
 * PR-C9 exception (2): R8's window for the throw, with QD2's plant throw as R-C28 reads it
 * (routes-pace.spec.test.ts): from E (the drop end plus the hitch) to the drop end plus the class's
 * hold. On intermediatePass and deepPass only, when the point thrown to is nearer the line than the
 * target's drawn track at E (the same calls with nobody targeted), the window opens at P instead (E
 * less RAMP x decelMs). An incompletion's aim point is not on the Timeline, and R-C28 reads
 * completions and interceptions only, so there a throw before E on those two classes is held to P
 * alone. Times are raw clock ms after the snap (the screen's over k). Null when nothing is thrown.
 */
export function throwWindow(tl: Timeline, ev: PlayEvent, ratings: Ratings, m: Motion = motion): { readonly throwMs: number; readonly lo: number; readonly hi: number; readonly plant: boolean } | null {
  const fl = flightOf(tl);
  if (fl === undefined) return null;
  const leaf = leafOf(ev);
  const k = natOf(tl.marks[0] as TLMark).k;
  const drop = m.dropMs[leaf] as number;
  const E = drop + m.hitchMs;
  const hi = drop + (m.throwHold.leafMaxMs[leaf] ?? m.throwHold.maxMs);
  const throwMs = (fl.start - tl.snapAt) / k;
  if (throwMs >= E - 1e-6 || (leaf !== "intermediatePass" && leaf !== "deepPass")) return { throwMs, lo: E, hi, plant: false };
  const P = E - RAMP * m.decelMs;
  if (ev.play.kind === "pass" && ev.play.incomplete === true) return { throwMs, lo: P, hi, plant: true };
  const d = readDetail(ev.play);
  const target = ev.play.kind === "pass" && ev.play.turnover === "interception" ? d.participants?.target : (d.participants?.receiver ?? d.participants?.target);
  if (target === undefined) return { throwMs, lo: E, hi, plant: false };
  const passer = d.participants?.passer;
  const untargeted = { ...ev, play: { kind: "pass", seconds: 6, end: { spot: ev.before.spot + 5, possession: "offense" }, detail: { ...(ev.play.detail as Record<string, unknown>), participants: passer === undefined ? {} : { passer }, airYards: -30 } } as PlayEvent["play"] };
  const ref = build(untargeted, ratings, longMotion(m));
  const track = at(markOf(ref, target).keys, ref.snapAt + E).y - ref.los;
  const eligible = Math.abs((fl.points.at(-1) as Pt).y - tl.los) < Math.abs(track) - 1e-9;
  return { throwMs, lo: eligible ? P : E, hi, plant: eligible };
}

/** R9's stalk target, from the set alone: the nearest CB or S on the receiver's side of the field, else the nearest of all. */
export function nearestDb(tl: Timeline, w: TLMark): TLMark {
  const p0 = at(w.keys, tl.snapAt);
  const defs = tl.marks.filter((m) => m.side === "X" && (m.position === "CB" || m.position === "S"));
  const pool = defs.filter((d) => Math.sign(at(d.keys, tl.snapAt).x - MID_X) === Math.sign(p0.x - MID_X));
  return (pool.length > 0 ? pool : defs).reduce((b, d) => (dist(at(d.keys, tl.snapAt), p0) < dist(at(b.keys, tl.snapAt), p0) ? d : b));
}
/** The unnamed receivers who stalk on a play: every WR on a run (routes.<run leaf>.WR), and a WR or TE whose screen route's finish is stalk. */
export function stalkers(tl: Timeline, ev: PlayEvent): TLMark[] {
  const f = ev.offense.formation;
  if (f === undefined) return [];
  return tl.marks.filter((m) => m.side === "O" && (m.position === "WR" || m.position === "TE") && !tl.involved.includes(m.playerId) && routeOf(f, leafOf(ev), m.slot)?.finish === "stalk");
}

/**
 * R-C8's stalk checks (routes-pace.spec.test.ts, amended 2026-11-15) with the mark's own lag in B:
 * B = stalk.contactYards + his defender's own top x his own stalkLagMs + 0.5 yd. Every formation, run
 * and side, with `ratings` from the event.
 */
export function rc8Stalk(ratingsOf: (ev: PlayEvent) => Ratings, m: Motion = motion): { bad: string[]; windows: number; longPlays: number; closed: number } {
  const bad: string[] = [];
  let windows = 0;
  let longPlays = 0;
  let closed = 0;
  for (const f of ["shotgun", "underCenter", "pistol", "empty", "heavy"])
    for (const leaf of ["insideRun", "outsideRun", "qbSneak"])
      for (const loc of ["left", "right", undefined] as const) {
        const hasRb = ((personnel.offense[f] as Record<string, number>)["RB"] ?? 0) > 0;
        const carrier = leaf === "qbSneak" || !hasRb ? "O-QB1" : "O-RB1";
        const ev = mk({ formation: f, call: leaf, preset: "nickelCover3", result: "run", gain: leaf === "qbSneak" ? 1 : 4, parts: { ballCarrier: carrier, tackler: "X-LB1" }, ...(loc === undefined ? {} : { runLocation: loc }) });
        const tl = build(ev, ratingsOf(ev), m);
        for (const w of tl.marks.filter((m) => m.side === "O" && m.position === "WR")) {
          const mine = nearestDb(tl, w);
          if (tl.involved.includes(mine.playerId)) continue;
          const label = `${f} ${leaf} ${loc ?? "no runLocation"} ${w.slot}`;
          const lag = reactIf(w)?.stalkLagMs ?? m.stalk.lagMs;
          const B = motion.stalk.contactYards + (natOf(mine).top * lag) / 1000 + 0.5;
          const gap = (t: number): number => dist(at(w.keys, t), at(mine.keys, t));
          const p0 = at(w.keys, tl.snapAt);
          const rel = { x: p0.x, y: p0.y + 3 };
          let up = 0;
          let tRel = tl.snapAt;
          let t0 = NaN;
          for (let t = tl.snapAt; t <= tl.liveEnd; t += KEY) {
            up = Math.max(up, at(w.keys, t).y - p0.y);
            if (dist(at(w.keys, t), rel) < dist(at(w.keys, tRel), rel)) tRel = t;
            if (Number.isNaN(t0) && gap(t) <= B) t0 = t;
          }
          if (up < 2) bad.push(`${label}: released ${up.toFixed(2)} yd upfield`);
          if (!Number.isNaN(t0) && tl.liveEnd - t0 >= 300) {
            windows++;
            let n = 0;
            let inB = 0;
            for (let t = t0; t <= tl.liveEnd; t += KEY) {
              n++;
              if (gap(t) <= B) inB++;
            }
            if (inB / n < 0.6) bad.push(`${label} on ${mine.slot}: within ${B.toFixed(1)} yd (lag ${lag.toFixed(0)} ms) ${((100 * inB) / n).toFixed(0)}% of his ${(tl.liveEnd - t0).toFixed(0)} ms window`);
          }
          if (tl.liveEnd - tRel >= 1000) {
            longPlays++;
            if (!Number.isNaN(t0) || gap(tl.liveEnd) < gap(tRel)) closed++;
          }
        }
      }
  return { bad, windows, longPlays, closed };
}

// ---------------------------------------------------------------- slice 2 review (2026-11-24)

/** His offset from his man is constant to this (yd) once he has locked on, for at least this many keys. */
const LOCK = { yards: 0.01, minKeys: 4 };
/**
 * When a stalker locks on his man, from the keys alone: the first 25 ms key from which his offset
 * (his place less his man's) stays within 0.01 yd of its last value to the settle (the earlier of the
 * two marks' settleFrom, and the whistle). Null when that stretch is under 100 ms (4 keys). `gaps` is
 * the distance between them on every key to the settle, and `rel` the speed of one against the other
 * there (yd/s, over the two neighbouring keys).
 */
export function stalkLock(tl: Timeline, wId: string, dId: string): { readonly lock: number | null; readonly end: number; readonly gaps: readonly { readonly t: number; readonly d: number; readonly rel: number }[] } {
  const W = markOf(tl, wId);
  const D = markOf(tl, dId);
  const end = Math.min(tl.liveEnd, natOf(W).settleFrom, natOf(D).settleFrom);
  const off: { t: number; p: Pt }[] = [];
  for (let t = tl.snapAt; t <= end + 1e-9; t += KEY) {
    const p = at(W.keys, t);
    const q = at(D.keys, t);
    off.push({ t: t - tl.snapAt, p: { x: p.x - q.x, y: p.y - q.y } });
  }
  const last = off.at(-1);
  if (last === undefined) return { lock: null, end: 0, gaps: [] };
  let i = off.length - 1;
  while (i > 0 && dist((off[i - 1] as { p: Pt }).p, last.p) <= LOCK.yards) i--;
  return { lock: off.length - i >= LOCK.minKeys ? (off[i] as { t: number }).t : null, end: end - tl.snapAt, gaps: off.map((o) => {
      const t = tl.snapAt + o.t;
      const [w0, w1, d0, d1] = [at(W.keys, t - KEY), at(W.keys, t + KEY), at(D.keys, t - KEY), at(D.keys, t + KEY)];
      return { t: o.t, d: Math.hypot(o.p.x, o.p.y), rel: Math.hypot(w1.x - w0.x - d1.x + d0.x, w1.y - w0.y - d1.y + d0.y) / 0.05 };
    }) };
}
export interface LockTrio {
  readonly who: string;
  /** At awareness 40, 65 and 90, in that order. */
  readonly at: readonly ReturnType<typeof stalkLock>[];
}
export const LOCK_AWARENESS: readonly number[] = [40, 65, 90];
/** Every unnamed WR stalking an unnamed defender on the runs of S, at awareness 40, 65 and 90 with every other awareness band zeroed. `natural` false is the build before natural motion's wobble. */
export function stalkLocks(natural: boolean): LockTrio[] {
  const ab = abMotionFor("awareness", "stalk.lagMs");
  const out: LockTrio[] = [];
  for (const s of S()) {
    if (s.ev.play.kind !== "run") continue;
    const base = build(s.ev, s.ratings);
    for (const W of stalkers(base, s.ev)) {
      const D = nearestDb(base, W);
      if (W.position !== "WR" || base.involved.includes(D.playerId) || D.playerId === base.tackler) continue;
      out.push({ who: `${s.name} ${W.slot} on ${D.slot}`, at: LOCK_AWARENESS.map((a) => stalkLock(build(s.ev, withRating(s.ratings, W.playerId, "awareness", a), ab, { natural }), W.playerId, D.playerId)) });
    }
  }
  return out;
}

/** PR-C12 (a), monotonic: the plays of S the bite sweep reads (play action against a coverage drop set). */
export const biteSweepPlays = (): Sample[] => S().filter((s) => s.ev.play.kind === "pass" && leafOf(s.ev) === "playAction" && templates.presetDrops[s.ev.defense ?? ""] !== "run");
/** Each reading LB of those plays at awareness 40 to 90 by 2, every other awareness band zeroed: the largest rise of his bite from one step to the next (yd), where it is, and all of them. */
export function biteRises(plays: readonly Sample[], ms: number): { readonly who: string; readonly rise: number; readonly where: string }[] {
  const ab = abMotionFor("awareness", "biteShare");
  const out: { who: string; rise: number; where: string }[] = [];
  for (const s of plays) {
    const f = s.ev.offense.formation;
    if (f === undefined) continue;
    const base = build(s.ev, s.ratings);
    for (const m of readingLbs(base, s.ev)) {
      let was = Infinity;
      let rise = 0;
      let where = "";
      for (const [i, a] of AWARENESS_SWEEP.entries()) {
        const tl = build(s.ev, withRating(s.ratings, m.playerId, "awareness", a), ab);
        const b = biteYards(tl, markOf(tl, m.playerId), f, ms);
        if (b - was > rise) {
          rise = b - was;
          where = `${AWARENESS_SWEEP[i - 1] ?? ""} to ${a}: ${was.toFixed(2)} to ${b.toFixed(2)} yd`;
        }
        was = b;
      }
      out.push({ who: `${s.name} vs ${s.ev.defense ?? ""} ${m.slot}`, rise, where });
    }
  }
  return out;
}

// ---------------------------------------------------------------- per-mark peak speed (2026-11-24)

/**
 * A mark's peak speed between his drawn keys from the snap to the whistle, over his own top on the
 * screen clock: from each key to the first key at least 5 ms later, so two keys nearly on top of each
 * other (a fact key beside a grid key) are not read as a jump.
 */
export function peakShare(tl: Timeline, m: TLMark): { readonly share: number; readonly yps: number; readonly t: number } {
  const ks = m.keys.filter((k) => k.t >= tl.snapAt - 1e-9 && k.t <= tl.liveEnd + 1e-9);
  let yps = 0;
  let when = tl.snapAt;
  let j = 0;
  for (let i = 0; i < ks.length; i++) {
    const a = ks[i] as Key;
    j = Math.max(j, i);
    while (j < ks.length && (ks[j] as Key).t - a.t < 5 - 1e-9) j++;
    if (j >= ks.length) break;
    const b = ks[j] as Key;
    const v = (dist(a, b) / (b.t - a.t)) * 1000;
    if (v > yps) {
      yps = v;
      when = a.t;
    }
  }
  return { share: yps / topOf(m), yps, t: when - tl.snapAt };
}
export interface Peak {
  /** `${seed}:${0-based index into simGame(seed).plays}:${side}${slot}`, the key of pr-peaks.json. */
  readonly key: string;
  readonly group: "offense" | "defense" | "tackler";
  readonly position: string;
  readonly call: string;
  readonly kind: string;
  readonly share: number;
  readonly yps: number;
  readonly t: number;
}
/**
 * Every unnamed mark (not in tl.involved and not the tackler), and every tackler apart, of the run
 * and pass plays of simGame(seed), each play drawn once with the app's card ratings and skills.
 */
export function peaksOf(seed: number): Peak[] {
  const out: Peak[] = [];
  const g = simGame(seed);
  const ratings: Ratings = Object.fromEntries([...g.matchup.home.pool.players, ...g.matchup.away.pool.players].map((p) => [p.id, { ...p.ratings, ...p.skills }]));
  g.plays.forEach((ev, i) => {
    if (ev.play.kind !== "run" && ev.play.kind !== "pass") return;
    const tl = build(ev, ratings);
    if (tl.liveEnd <= tl.snapAt) return;
    for (const m of tl.marks) {
      const tackler = m.playerId === tl.tackler;
      if (!tackler && tl.involved.includes(m.playerId)) continue;
      out.push({ key: `${seed}:${i}:${m.side}${m.slot}`, group: tackler ? "tackler" : m.side === "O" ? "offense" : "defense", position: m.position, call: ev.offense.call, kind: ev.play.kind, ...peakShare(tl, m) });
    }
  });
  return out;
}
/** A hash of what peaksOf draws from: the game's play events and both pools' ratings and skills. */
export function peakInputs(seed: number): string {
  const g = simGame(seed);
  return createHash("sha256").update(JSON.stringify([g.plays, [...g.matchup.home.pool.players, ...g.matchup.away.pool.players].map((p) => [p.id, p.ratings, p.skills])])).digest("hex").slice(0, 16);
}

/** The bar: 1.5 x his own top, or 1.10 x the same mark's peak before the build, whichever is higher. Test constants. */
const PEAK = { share: 1.5, ofBefore: 1.1 };
const peaksBefore = JSON.parse(readFileSync(join(import.meta.dirname, "pr-peaks.json"), "utf8")) as { readonly inputs: Readonly<Record<string, string>>; readonly peaks: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, number>>>>>> };
/** The marks over the bar on `seeds`, worst first, by group, with the number of marks read, and the seeds whose games are not the ones captured. */
export function peakCheck(seeds: readonly number[]): { readonly read: number; readonly over: Readonly<Record<Peak["group"], string[]>>; readonly otherGames: string[] } {
  const over: Record<Peak["group"], { share: number; line: string }[]> = { offense: [], defense: [], tackler: [] };
  const otherGames: string[] = [];
  let read = 0;
  for (const seed of seeds) {
    if (peakInputs(seed) !== peaksBefore.inputs[String(seed)]) otherGames.push(`seed ${seed}: its plays or ratings are not the ones pr-peaks.json was captured from, so its bars say nothing`);
    for (const p of peaksOf(seed)) {
      read++;
      const [s, i, m] = p.key.split(":") as [string, string, string];
      const before = peaksBefore.peaks[s]?.[i]?.[m];
      if (p.share <= Math.max(PEAK.share, PEAK.ofBefore * (before ?? 0)) + 1e-9) continue;
      over[p.group].push({ share: p.share, line: `seed ${s} play ${Number(i) + 1} (index ${i}) ${p.kind} ${p.call} ${m}: ${p.share.toFixed(2)} x his top (${p.yps.toFixed(1)} yd/s) ${p.t.toFixed(0)} ms after the snap, before the build ${before === undefined ? "under 1.37" : before.toFixed(2)} x` });
    }
  }
  const sorted = (xs: { share: number; line: string }[]): string[] => xs.sort((a, b) => b.share - a.share).map((x) => x.line);
  return { read, over: { offense: sorted(over.offense), defense: sorted(over.defense), tackler: sorted(over.tackler) }, otherGames };
}
