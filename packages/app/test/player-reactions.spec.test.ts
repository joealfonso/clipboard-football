// Player reactions, slice 1 (docs/specs/m2-player-reactions.md): PR15's per-mark record, PR16 and
// criteria PR-C2 to PR-C7, written by test-writer from the spec, not the code. Headless, on the
// Timeline from timeline() at 1x. PR-C1 is player-reactions-legacy.spec.test.ts; PR-C8 to PR-C10
// and PR-C15 are player-reactions-standing.spec.test.ts.
//
// Every floor below is the criterion's own number, held here as a constant: the data can't loosen
// its own test, and nobody edits a floor in a test (the spec, "Acceptance criteria").
//
// Readings of the spec, where it needed one (each is in the test-writer's report as an assumption):
// - PR-C3, the stalking receiver: narrowed 2026-11-24 for slice 2, as the criterion says. Only the
//   receiver whose nat.react.stalkOf is D may differ when D's awareness changes. Nobody else may.
// - PR-C5, "positive toward the ball's heading": theta is the signed angle from the bearing to the
//   ball to his heading, counted positive when it turns the way the ball's heading turns from that
//   bearing. A key where the ball runs straight along the bearing has no such side and is left out.
// - PR-C6: a heading needs movement (0.01 yd over the 50 ms it is read on); a pair that never comes
//   within 20 degrees is timed to the whistle.
// - PR-C7, "his leg to the tackle": from his departure (the read + delayMs, PR6) to the whistle.
//   Its mean speed is the drawn path length over that time, its peak the fastest 25 ms step.
//   Clause (d), "fact legs of his own before the tackle": he has another role beside tackler, or a
//   fact anchor beside the tackle. Such a tackler is never his unnamed self, so the comparison with
//   the build naming another tackler leaves him out. That build is compared only when it has the
//   same snap, read and live time (naming another tackler may move them).
//   Clause (e) (added 2026-11-24, the lead's ruling), "the ring rule bound his departure": in that
//   build the ring first pushes his unnamed self within one 25 ms key after he departs here. The push
//   is read on raw builds with and without the ring (firstRingPush in the checks file).
// - Every test asserts one clause, or collects every clause's failures before asserting, so no
//   clause can hide another (code review, 2026-11-24).

import { describe, expect, it } from "vitest";
import type { PlayEvent } from "../src/engine/types";
import { at, type Timeline, type TLMark } from "../src/ui/timeline";
import { COMPLETE, RUN } from "./fixtures";
import { abMotion, AWARENESS_SWEEP, build, counted, dist, dlReleaseRises, firstRingPush, FIXTURES, flightOf, KEY, markOf, median, motion, natOf, reactIf, reactOf, S, SCRIMMAGE_FIXTURES, tableRatings, tacklerAway, tacklerReversal, topOf, withRating, type Ratings, type Sample } from "./player-reactions.checks";

// ---------------------------------------------------------------- the criteria's floors (test constants)

const C2 = { minDefenders: 4, withinMs: 100, medianRangeMs: 250, medianShare: 0.75, allTogetherShare: 0.1 };
const C3 = { awareness: [40, 55, 70, 85, 90], fallFrom: 40, fallTo: 85, fallMs: 200, everyNth: 11 };
const C4 = { minSnaps: 15, varySpan: 0.8, sdRatio: 1.5 };
const C5 = { leadGapMs: 300, fromMs: 300, toMs: 400, ballYps: 3, awayYards: 6, minKeys: 8, medianDeg: 4, floorDeg: -1, floorShare: 0.85 };
const C6 = { offDeg: 60, withinDeg: 20, noLongerShare: 0.9, medianGainMs: 50, lateralLo: 0.7, lateralHi: 1.3 };
const C7 = { slackMs: 25, legShare: 0.7, peakShare: 1.0, beforeMs: 50 };
/**
 * PR6's unnamed self read between the 25 ms keys too (2026-11-24, after the round 3 review): every
 * 1 ms from 200 ms before the read to 50 ms before he departs (C7.beforeMs). Joseph, 2026-11-24, "No
 * visible shove", as the lead relayed it: a difference is allowed in those last 50 ms only, so he can
 * be eased out of the ring's push. It was one 25 ms key, with a gap of at most 0.146 yd inside it.
 */
const SELF = { fromMs: 200, stepMs: 1, yards: 1e-6 };
/** PR3 round 3's sweep: every 55th play of S (the heavy file has every 4th), and three plays a 15-point step missed on the slice 1 snapshot. */
const DL_SWEEP = { everyNth: 55, plays: ["seed 2 play 59 ", "seed 5 play 71 ", "seed 1 play 94 "] };
/**
 * PR6, round 3: tacklers of S who go toward the ball, away from it and toward it again between
 * 60 ms before the read and 600 ms after (tacklerReversal in the checks file). `before` is the count
 * on the tree this build started from, with the app's ratings: 23 of 392 tacklers (20 with no
 * ratings), captured 2026-11-24 from the pre-build copy (timeline.ts sha256 f8474557...). It is
 * printed, not held, since the ruling of 2026-11-24: AWAY is what is held. Of the 14 tacklers within
 * 4 yd of the ball at the read, two reversed there, on these plays (held).
 */
const REVERSAL = { before: 23, tacklers: 392, nearYards: 4, nearBefore: ["seed 4 play 46 run qbSneak", "seed 6 play 151 pass playAction"] };
/**
 * PR6, round 3, the defect itself: no tackler of S is pushed off the ball, drawn moving away from it
 * faster than his own top on a step that starts within 3.5 yd of it (the ring, 2.5, plus 1; the
 * ruling of 2026-11-24: a man backing off in coverage farther away is not the defect). The four plays
 * of round 2's shove (seed 3 play 5, seed 6 play 151, seed 5 play 7, seed 1 play 172) start at 1.9 to
 * 2.1 yd. `before` is what the pre-build copy (f8474557..., the app's ratings) already drew over top
 * inside that distance: each of those plays is held to its share there, rounded up to 3 decimals, not
 * excused. Nobody adds or raises one to make a build pass.
 */
const AWAY: { readonly maxShare: number; readonly withinYards: number; readonly before: Readonly<Record<string, number>> } = {
  maxShare: 1,
  withinYards: 3.5,
  before: {
    "seed 2 play 162 run outsideRun": 1.264,
    "seed 4 play 46 run qbSneak": 1.072,
    "seed 6 play 70 run outsideRun": 1.269,
  },
};
/** The A/B pairs: the fixtures and every 5th play of S. */
const AB_EVERY = 5;

const DEG = 180 / Math.PI;
const wrap = (a: number): number => {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
};
const sd = (a: readonly number[]): number => {
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length);
};
const abSamples = (): Sample[] => [...SCRIMMAGE_FIXTURES, ...S().filter((_, i) => i % AB_EVERY === 0)];
/** One assertion over several clauses: every clause's failures are shown together, so none hides another. */
const expectNone = (clauses: Readonly<Record<string, readonly string[]>>): void => {
  expect(Object.fromEntries(Object.entries(clauses).filter(([, lines]) => lines.length > 0).map(([name, lines]) => [name, lines.slice(0, 30)]))).toEqual({});
};

interface AbBase {
  readonly sample: Sample;
  /** The counted defenders, from one build with the play's own ratings and the shipped data. */
  readonly ids: readonly string[];
}
let abBase: { readonly pairs: readonly AbBase[]; readonly pathEnds: readonly string[]; readonly pathEndsChecked: number } | null = null;
/** The A/B pairs (the fixtures and every 5th play of S), built once and shared by PR16, PR-C5 and PR-C6. */
function abPairs(): NonNullable<typeof abBase> {
  if (abBase !== null) return abBase;
  const pairs: AbBase[] = [];
  const pathEnds: string[] = [];
  let pathEndsChecked = 0;
  for (const s of abSamples()) {
    const tl = build(s.ev, s.ratings);
    const ds = counted(tl);
    pairs.push({ sample: s, ids: ds.map((m) => m.playerId) });
    for (const m of ds) {
      const at0 = reactOf(m).pursueAt as number;
      // States: a pursueAt within 75 ms of the whistle or after it is never drawn, so it has no path end to compare.
      if (at0 > tl.liveEnd - 75) continue;
      pathEndsChecked++;
      if (Math.abs(m.pathEnd - at0) > 1e-6) pathEnds.push(`${s.name} ${m.slot}: pathEnd ${(m.pathEnd - tl.snapAt).toFixed(0)} ms, pursueAt ${(at0 - tl.snapAt).toFixed(0)} ms after the snap`);
    }
  }
  abBase = { pairs, pathEnds, pathEndsChecked };
  return abBase;
}

// ---------------------------------------------------------------- PR15, PR16

describe("PR15: a test record per mark, nat.react, on scrimmage plays", () => {
  it("every mark of every scrimmage fixture built with ratings has readMs, delayMs, pursueAt, vary, leadMs, turnShare and lateralAccel", () => {
    const bad: string[] = [];
    let marks = 0;
    for (const f of SCRIMMAGE_FIXTURES) {
      const tl = build(f.ev, f.ratings);
      for (const m of tl.marks) {
        marks++;
        const r = reactIf(m);
        if (r === undefined) {
          bad.push(`${f.name} ${m.side}${m.slot}: no nat.react`);
          continue;
        }
        for (const k of ["readMs", "delayMs", "vary", "leadMs", "turnShare", "lateralAccel"] as const) if (typeof r[k] !== "number" || !Number.isFinite(r[k])) bad.push(`${f.name} ${m.side}${m.slot}: react.${k} is ${String(r[k])}`);
        if (r.pursueAt !== null && (typeof r.pursueAt !== "number" || !Number.isFinite(r.pursueAt))) bad.push(`${f.name} ${m.side}${m.slot}: react.pursueAt is ${String(r.pursueAt)}`);
        // PR3: the reaction is not below 0. PR6: the delay applied is from 0 to his readMs.
        if (r.readMs < 0) bad.push(`${f.name} ${m.side}${m.slot}: readMs ${r.readMs}`);
        if (r.delayMs < 0 || r.delayMs > r.readMs + 1e-9) bad.push(`${f.name} ${m.side}${m.slot}: delayMs ${r.delayMs} outside 0 to readMs ${r.readMs}`);
        // PR4: v is in [-1, 1].
        if (r.vary < -1 || r.vary > 1) bad.push(`${f.name} ${m.side}${m.slot}: vary ${r.vary}`);
        // PR15: for a rated mark nat.reactionMs holds the same number (every mark here is rated: the table covers every id of the event).
        if (Math.abs(natOf(m).reactionMs - r.readMs) > 1e-9) bad.push(`${f.name} ${m.side}${m.slot}: nat.reactionMs ${natOf(m).reactionMs} is not readMs ${r.readMs}`);
      }
      // PR15: delayMs equals readMs for an unnamed mark (the counted defenders: unnamed, and they pursue).
      for (const m of counted(tl)) if (Math.abs(reactOf(m).delayMs - reactOf(m).readMs) > 1e-9) bad.push(`${f.name} ${m.side}${m.slot}: unnamed, delayMs ${reactOf(m).delayMs} is not readMs ${reactOf(m).readMs}`);
    }
    expect(marks).toBeGreaterThan(200);
    expect(bad).toEqual([]);
  });

  it("an OL never pursues: his pursueAt is null", () => {
    const tl = build(RUN, tableRatings(RUN));
    const ol = tl.marks.filter((m) => m.side === "O" && m.position === "OL" && !tl.involved.includes(m.playerId));
    expect(ol.length).toBeGreaterThan(0);
    for (const m of ol) expect(reactOf(m).pursueAt, m.slot).toBeNull();
  });

  // Through slice 4 the record is on scrimmage plays only (PR15); slice 5 fills it on kickoffs and punts.
  it("a play that is not a scrimmage play carries no nat.react (kicks, a kneel, a no play), through slice 4", () => {
    const others = FIXTURES.filter((f) => !SCRIMMAGE_FIXTURES.includes(f));
    expect(others.length).toBeGreaterThan(5);
    const bad: string[] = [];
    for (const f of others) for (const m of build(f.ev, f.ratings).marks) if (reactIf(m) !== undefined) bad.push(`${f.name} ${m.side}${m.slot}`);
    expect(bad).toEqual([]);
  });
});

describe("PR16: a defender's dashed path ends at his own departure", () => {
  it("with ratings, every counted defender's pathEnd is his pursueAt (fixtures and every 5th play of S)", { timeout: 300_000 }, () => {
    const base = abPairs();
    expect(base.pathEndsChecked).toBeGreaterThan(300);
    expect(base.pathEnds.slice(0, 30)).toEqual([]);
  });
});

// ---------------------------------------------------------------- PR-C2, PR-C4: one pass over S

interface Snap {
  readonly play: string;
  readonly id: string;
  readonly awareness: number;
  readonly readMs: number;
  readonly vary: number;
  readonly start: number;
}
let passOverS: { readonly plays: readonly (readonly Snap[])[] } | null = null;
/** Every play of S built once with its ratings: the counted defenders and what PR-C2 and PR-C4 read of them. */
function overS(): NonNullable<typeof passOverS> {
  if (passOverS !== null) return passOverS;
  const plays: Snap[][] = [];
  for (const s of S()) {
    const tl = build(s.ev, s.ratings);
    plays.push(
      counted(tl).map((m) => {
        const r = reactOf(m);
        return { play: s.name, id: m.playerId, awareness: (s.ratings[m.playerId] ?? {})["awareness"] ?? NaN, readMs: r.readMs, vary: r.vary, start: (r.pursueAt as number) - tl.snapAt };
      }),
    );
  }
  passOverS = { plays };
  return passOverS;
}

describe("PR-C2: perceptibility, measured as the probe does", () => {
  it("over S, plays with 4 or more counted defenders: median range of pursuit starts >= 250 ms, median share within 100 ms of the median <= 0.75, share 1.00 on at most 10% of plays", { timeout: 300_000 }, () => {
    const ranges: number[] = [];
    const shares: number[] = [];
    for (const snaps of overS().plays) {
      if (snaps.length < C2.minDefenders) continue;
      const starts = snaps.map((x) => x.start);
      const med = median(starts);
      ranges.push(Math.max(...starts) - Math.min(...starts));
      shares.push(starts.filter((x) => Math.abs(x - med) <= C2.withinMs).length / starts.length);
    }
    // The sample is S: 571 run and pass plays when the spec was written, nearly all with 4 or more.
    expect(S().length).toBeGreaterThan(400);
    expect(ranges.length).toBeGreaterThan(400);
    const together = shares.filter((x) => x === 1).length / shares.length;
    console.info(`PR-C2 over ${ranges.length} plays: median range ${median(ranges).toFixed(0)} ms, median share within 100 ms ${median(shares).toFixed(2)}, share 1.00 on ${(100 * together).toFixed(1)}% of plays`);
    expectNone({
      "median range of pursuit starts": median(ranges) >= C2.medianRangeMs ? [] : [`${median(ranges).toFixed(0)} ms, the floor is ${C2.medianRangeMs}`],
      "median share within 100 ms of the median": median(shares) <= C2.medianShare ? [] : [`${median(shares).toFixed(2)}, at most ${C2.medianShare}`],
      "share of plays on which everyone goes within 100 ms": together <= C2.allTogetherShare ? [] : [`${(100 * together).toFixed(1)}%, at most ${100 * C2.allTogetherShare}%`],
    });
  });
});

describe("PR-C4: play to play", () => {
  /** Each player's snaps as a counted defender, in game order. */
  const byPlayer = (): Map<string, Snap[]> => {
    const out = new Map<string, Snap[]>();
    for (const snaps of overS().plays) for (const x of snaps) out.set(x.id, [...(out.get(x.id) ?? []), x]);
    return out;
  };

  it("each player with 15 or more snaps as a counted defender: his vary values span at least 0.8 and no two consecutive snaps share one", { timeout: 300_000 }, () => {
    const bad: string[] = [];
    let players = 0;
    for (const [id, snaps] of byPlayer()) {
      if (snaps.length < C4.minSnaps) continue;
      players++;
      const v = snaps.map((x) => x.vary);
      const span = Math.max(...v) - Math.min(...v);
      if (span < C4.varySpan) bad.push(`${id}: vary spans ${span.toFixed(2)} over ${v.length} snaps`);
      for (let i = 1; i < v.length; i++)
        if (v[i] === v[i - 1]) {
          bad.push(`${id}: the same vary ${String(v[i])} on ${(snaps[i - 1] as Snap).play} and ${(snaps[i] as Snap).play}`);
          break;
        }
    }
    expect(players).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it("steady players are steadier: the median SD of readMs in the bottom third by awareness is at least 1.5 x that of the top third", { timeout: 300_000 }, () => {
    const players = [...byPlayer().values()].filter((snaps) => snaps.length >= C4.minSnaps).map((snaps) => ({ awareness: (snaps[0] as Snap).awareness, sd: sd(snaps.map((x) => x.readMs)) }));
    players.sort((a, b) => a.awareness - b.awareness);
    const third = Math.floor(players.length / 3);
    expect(third).toBeGreaterThanOrEqual(5);
    const bottom = median(players.slice(0, third).map((p) => p.sd));
    const top = median(players.slice(-third).map((p) => p.sd));
    console.info(`PR-C4: median SD of readMs, bottom third by awareness ${bottom.toFixed(1)} ms, top third ${top.toFixed(1)} ms (${third} players each)`);
    expect(bottom).toBeGreaterThanOrEqual(C4.sdRatio * top);
  });

  const varies = (ev: PlayEvent, ratings: Ratings): Map<string, number> => new Map(build(ev, ratings).marks.map((m) => [m.playerId, reactOf(m).vary]));
  it("vary is identical for two events that differ only in play or after (it can't know the result)", () => {
    const ratings = tableRatings(COMPLETE);
    const base = varies(COMPLETE, ratings);
    const d = COMPLETE.play.detail as { participants: Record<string, string> };
    const variants: Record<string, PlayEvent> = {
      "another target": { ...COMPLETE, play: { ...COMPLETE.play, detail: { ...d, participants: { ...d.participants, receiver: "H-WR1", target: "H-WR1" } } } as PlayEvent["play"] },
      "another end spot": { ...COMPLETE, play: { ...COMPLETE.play, end: { spot: 70, possession: "offense" } } as PlayEvent["play"] },
      "an incompletion": { ...COMPLETE, play: { kind: "pass", seconds: 5, incomplete: true, end: { spot: COMPLETE.before.spot, possession: "offense" }, detail: { ...d, participants: { passer: d.participants["passer"] as string, target: "H-TE1" } } } as PlayEvent["play"] },
      "another after": { ...COMPLETE, after: { ...COMPLETE.after, clock: COMPLETE.after.clock - 9, down: 1, distance: 10, score: { home: 14, away: 3 } } },
    };
    expect(base.size).toBe(22);
    for (const [name, ev] of Object.entries(variants)) expect([...varies(ev, ratings)], name).toEqual([...base]);
  });

  it("vary differs for at least half the marks when before.clock changes by 1 (and is the same when nothing does)", () => {
    for (const ev of [COMPLETE, RUN]) {
      const ratings = tableRatings(ev);
      const base = varies(ev, ratings);
      expect([...varies(structuredClone(ev), ratings)]).toEqual([...base]);
      const later = varies({ ...ev, before: { ...ev.before, clock: ev.before.clock - 1 } }, ratings);
      const differ = [...base].filter(([id, v]) => later.get(id) !== v).length;
      expect(differ, `${ev.play.kind}: marks whose vary changed`).toBeGreaterThanOrEqual(Math.ceil(base.size / 2));
    }
  });
});

// ---------------------------------------------------------------- PR-C3

describe("PR-C3: monotonic, and nobody else moves", () => {
  it("COMPLETE, RUN and every 11th play of S: each counted defender at awareness 40, 55, 70, 85 and 90 is never later as it rises and at least 200 ms sooner at 85 than at 40; every other mark's keys are identical", { timeout: 600_000 }, () => {
    const samples: Sample[] = [{ name: "COMPLETE", ev: COMPLETE, ratings: tableRatings(COMPLETE) }, { name: "RUN", ev: RUN, ratings: tableRatings(RUN) }, ...S().filter((_, i) => i % C3.everyNth === 0)];
    const later: string[] = [];
    const flat: string[] = [];
    const moved: string[] = [];
    let defenders = 0;
    for (const s of samples) {
      const base = build(s.ev, s.ratings);
      // On an incompletion every mark may differ from the throw on (A3 reads the drawn defenders).
      const incomplete = s.ev.play.kind === "pass" && s.ev.play.incomplete === true;
      for (const D of counted(base)) {
        defenders++;
        const tls = C3.awareness.map((a) => build(s.ev, withRating(s.ratings, D.playerId, "awareness", a)));
        const rs = tls.map((tl) => reactOf(markOf(tl, D.playerId)));
        const who = `${s.name} ${D.slot}`;
        for (let i = 1; i < rs.length; i++) {
          const a = rs[i - 1] as (typeof rs)[number];
          const b = rs[i] as (typeof rs)[number];
          if (b.readMs > a.readMs + 1e-9) later.push(`${who}: readMs ${a.readMs.toFixed(0)} at ${C3.awareness[i - 1]}, ${b.readMs.toFixed(0)} at ${C3.awareness[i]}`);
          if (a.pursueAt === null || b.pursueAt === null) later.push(`${who}: pursueAt is null at awareness ${C3.awareness[a.pursueAt === null ? i - 1 : i]}`);
          else if (b.pursueAt > a.pursueAt + 1e-9) later.push(`${who}: pursueAt ${a.pursueAt.toFixed(0)} at ${C3.awareness[i - 1]}, ${b.pursueAt.toFixed(0)} at ${C3.awareness[i]}`);
        }
        const lo = rs[C3.awareness.indexOf(C3.fallFrom)] as (typeof rs)[number];
        const hi = rs[C3.awareness.indexOf(C3.fallTo)] as (typeof rs)[number];
        if (lo.readMs - hi.readMs < C3.fallMs) flat.push(`${who}: readMs falls ${(lo.readMs - hi.readMs).toFixed(0)} ms from 40 to 85`);
        if (lo.pursueAt !== null && hi.pursueAt !== null && lo.pursueAt - hi.pursueAt < C3.fallMs) flat.push(`${who}: pursueAt falls ${(lo.pursueAt - hi.pursueAt).toFixed(0)} ms from 40 to 85`);
        const first = tls[0] as Timeline;
        const until = incomplete ? (flightOf(first)?.start ?? first.read) : Infinity;
        for (const tl of tls.slice(1))
          for (const m of first.marks) {
            if (m.playerId === D.playerId) continue;
            // The one exception: the receiver whose stalk target is D (slice 2, nat.react.stalkOf).
            if (reactOf(m).stalkOf === D.playerId) continue;
            const n = markOf(tl, m.playerId);
            const a = m.keys.filter((k) => k.t <= until);
            const b = n.keys.filter((k) => k.t <= until);
            const same = a.length === b.length && a.every((k, i) => k.t === (b[i] as typeof k).t && k.x === (b[i] as typeof k).x && k.y === (b[i] as typeof k).y);
            if (!same) {
              moved.push(`${who}: ${m.side}${m.slot} moves when only ${D.slot}'s awareness changes`);
              break;
            }
          }
      }
    }
    expect(defenders).toBeGreaterThan(200);
    expectNone({ "a sharper player is later": later, "less than 200 ms between awareness 40 and 85": flat, "one player's rating moves another": moved });
  });

  // Added 2026-11-24 (round 3): the DL's release reads awareness too (PR3, read.releaseMs), and a
  // rated DL may be released sooner by the ring. Neither may make a sharper DL later.
  it("every 11th play of S: an unnamed DL's release (delayMs, and pursueAt after the read) never rises as his awareness rises across 40, 55, 70, 85 and 90", { timeout: 600_000 }, () => {
    const later: string[] = [];
    let linemen = 0;
    for (const s of S().filter((_, i) => i % C3.everyNth === 0)) {
      const base = build(s.ev, s.ratings);
      for (const D of base.marks.filter((m) => m.side === "X" && m.position === "DL" && !base.involved.includes(m.playerId) && m.playerId !== base.tackler)) {
        linemen++;
        const built = C3.awareness.map((a) => {
          const tl = build(s.ev, withRating(s.ratings, D.playerId, "awareness", a));
          const r = reactOf(markOf(tl, D.playerId));
          return { delayMs: r.delayMs, after: r.pursueAt === null ? null : r.pursueAt - tl.read };
        });
        for (let i = 1; i < built.length; i++) {
          const a = built[i - 1] as (typeof built)[number];
          const b = built[i] as (typeof built)[number];
          const who = `${s.name} ${D.slot}, awareness ${C3.awareness[i - 1]} to ${C3.awareness[i]}`;
          if (b.delayMs > a.delayMs + 1e-9) later.push(`${who}: delayMs ${a.delayMs.toFixed(0)} to ${b.delayMs.toFixed(0)}`);
          if (a.after !== null && b.after !== null && b.after > a.after + 1e-9) later.push(`${who}: pursueAt ${a.after.toFixed(0)} to ${b.after.toFixed(0)} ms after the read`);
        }
      }
    }
    expectNone({ "a sharper DL releases later": later, "unnamed DL read": linemen > 100 ? [] : [`${linemen}, under 100`] });
  });

  // Added 2026-11-24 (after the round 3 review): the five steps above miss a band of a point or two.
  // A wider sample is in test/game/player-reactions.heavy.test.ts.
  it("a fixed sample of S (every 55th play, seed 2 play 59, seed 5 play 71, seed 1 play 94): an unnamed DL's release never rises as his awareness goes from 40 to 90 by 2", { timeout: 600_000 }, () => {
    const named = S().filter((s) => DL_SWEEP.plays.some((p) => s.name.startsWith(p)));
    const r = dlReleaseRises([...new Set([...named, ...S().filter((_, i) => i % DL_SWEEP.everyNth === 0)])], AWARENESS_SWEEP);
    expectNone({ "a sharper DL releases later": r.later, "the named plays": named.length === DL_SWEEP.plays.length ? [] : [`${named.length} of them in S`], "unnamed DL read": r.linemen > 30 ? [] : [`${r.linemen}, under 30`] });
  });
});

// ---------------------------------------------------------------- PR-C5

describe("PR-C5: angle by awareness (A/B on pursuit.leadMs)", () => {
  /** The lead angles (degrees) of one defender on the keys the criterion counts. */
  function leadAngles(tl: Timeline, m: TLMark): number[] {
    const r = reactOf(m);
    if (r.pursueAt === null) return [];
    const half = 0.5 * topOf(m);
    const out: number[] = [];
    for (let t = Math.ceil((r.pursueAt + C5.fromMs) / KEY) * KEY; t <= tl.liveEnd - C5.toMs + 1e-9; t += KEY) {
      const p = at(m.keys, t);
      const p0 = at(m.keys, t - KEY);
      const p1 = at(m.keys, t + KEY);
      const b = at(tl.ball, t);
      const b0 = at(tl.ball, t - KEY);
      const b1 = at(tl.ball, t + KEY);
      if (dist(p1, p0) / 0.05 < half || dist(b1, b0) / 0.05 < C5.ballYps || dist(p, b) < C5.awayYards) continue;
      const bearing = Math.atan2(b.y - p.y, b.x - p.x);
      const side = Math.sign(Math.sin(Math.atan2(b1.y - b0.y, b1.x - b0.x) - bearing));
      if (side === 0) continue;
      out.push(wrap(Math.atan2(p1.y - p0.y, p1.x - p0.x) - bearing) * side * DEG);
    }
    return out;
  }
  const mean = (a: readonly number[]): number => a.reduce((s, v) => s + v, 0) / a.length;

  it("leadMs at awareness 90 exceeds that at 40 by at least 300; the mean lead angle at 90 less that at 40 has a median of at least 4 degrees and is above -1 degree on at least 85% of pairs", { timeout: 600_000 }, () => {
    const ab = abMotion("lead");
    const gaps: string[] = [];
    const deltas: number[] = [];
    let pairs = 0;
    for (const { sample: s, ids } of abPairs().pairs) {
      for (const id of ids) {
        pairs++;
        const lo = build(s.ev, withRating(s.ratings, id, "awareness", 40), ab);
        const hi = build(s.ev, withRating(s.ratings, id, "awareness", 90), ab);
        const mLo = markOf(lo, id);
        const mHi = markOf(hi, id);
        const gap = reactOf(mHi).leadMs - reactOf(mLo).leadMs;
        if (gap < C5.leadGapMs) gaps.push(`${s.name} ${mLo.slot}: leadMs ${reactOf(mLo).leadMs.toFixed(0)} at 40, ${reactOf(mHi).leadMs.toFixed(0)} at 90`);
        const aLo = leadAngles(lo, mLo);
        const aHi = leadAngles(hi, mHi);
        if (aLo.length >= C5.minKeys && aHi.length >= C5.minKeys) deltas.push(mean(aHi) - mean(aLo));
      }
    }
    expect(pairs).toBeGreaterThan(300);
    const above = deltas.filter((d) => d > C5.floorDeg).length / deltas.length;
    console.info(`PR-C5: ${deltas.length} of ${pairs} pairs with 8 counted keys in both builds; median gain in lead angle ${median(deltas).toFixed(1)} degrees, above -1 degree on ${(100 * above).toFixed(0)}%`);
    expectNone({
      "leadMs at 90 less leadMs at 40, under 300": gaps,
      // Enough pairs for a median to mean something. If too few qualify, that comes back to the spec as a FLAG with this count.
      "pairs with 8 counted keys in both builds": deltas.length >= 30 ? [] : [`${deltas.length}, under 30`],
      "median over pairs of mean theta at 90 less mean theta at 40": median(deltas) >= C5.medianDeg ? [] : [`${median(deltas).toFixed(1)} degrees, the floor is ${C5.medianDeg}`],
      "share of pairs above -1 degree": above >= C5.floorShare ? [] : [`${(100 * above).toFixed(0)}%, the floor is ${100 * C5.floorShare}%`],
    });
  });
});

// ---------------------------------------------------------------- PR-C6

describe("PR-C6: turn by agility (A/B on pursuit.turnShare)", () => {
  /** Degrees between his heading and the bearing to the ball at t; null while he isn't moving. */
  function offAt(tl: Timeline, m: TLMark, t: number): number | null {
    const p0 = at(m.keys, t - KEY);
    const p1 = at(m.keys, t + KEY);
    if (dist(p0, p1) < 0.01) return null;
    const p = at(m.keys, t);
    const b = at(tl.ball, t);
    return Math.abs(wrap(Math.atan2(p1.y - p0.y, p1.x - p0.x) - Math.atan2(b.y - p.y, b.x - p.x))) * DEG;
  }
  /** His heading's angle off the ball at pursueAt, and the time until it is within 20 degrees (to the whistle when it never is). */
  function turn(tl: Timeline, m: TLMark): { off0: number; ms: number } | null {
    const at0 = reactOf(m).pursueAt;
    if (at0 === null || at0 >= tl.liveEnd) return null;
    const off0 = offAt(tl, m, at0);
    if (off0 === null) return null;
    for (let t = at0; t <= tl.liveEnd; t += 5) {
      const o = offAt(tl, m, t);
      if (o !== null && o <= C6.withinDeg) return { off0, ms: t - at0 };
    }
    return { off0, ms: tl.liveEnd - at0 };
  }

  it("pairs heading 60 degrees or more off the ball at pursueAt: the turn to within 20 degrees is no longer at agility 90 than at 40 on at least 90% of pairs, with a median gain of at least 50 ms", { timeout: 600_000 }, () => {
    const ab = abMotion("turn");
    const gains: number[] = [];
    let pairs = 0;
    for (const { sample: s, ids } of abPairs().pairs) {
      for (const id of ids) {
        pairs++;
        const lo = build(s.ev, withRating(s.ratings, id, "agility", 40), ab);
        const hi = build(s.ev, withRating(s.ratings, id, "agility", 90), ab);
        const tLo = turn(lo, markOf(lo, id));
        const tHi = turn(hi, markOf(hi, id));
        if (tLo === null || tHi === null || tLo.off0 < C6.offDeg) continue;
        gains.push(tLo.ms - tHi.ms);
      }
    }
    expect(pairs).toBeGreaterThan(300);
    const noLonger = gains.filter((g) => g >= -1e-9).length / gains.length;
    console.info(`PR-C6: ${gains.length} of ${pairs} pairs turn 60 degrees or more; no longer at 90 on ${(100 * noLonger).toFixed(0)}%, median gain ${median(gains).toFixed(0)} ms`);
    expectNone({
      "pairs heading 60 degrees or more off the ball at pursueAt": gains.length >= 30 ? [] : [`${gains.length}, under 30`],
      "share of pairs whose turn is no longer at agility 90": noLonger >= C6.noLongerShare ? [] : [`${(100 * noLonger).toFixed(0)}%, the floor is ${100 * C6.noLongerShare}%`],
      "median gain": median(gains) >= C6.medianGainMs ? [] : [`${median(gains).toFixed(0)} ms, the floor is ${C6.medianGainMs}`],
    });
  });

  it("nat.react.lateralAccel is within 0.7 to 1.3 x natural.lateralAccel, and turnShare within 0.3, for every mark at agility 40, 90 and his own", { timeout: 300_000 }, () => {
    const base = motion.natural.lateralAccel;
    const bad: string[] = [];
    let marks = 0;
    const check = (name: string, tl: Timeline): void => {
      for (const m of tl.marks) {
        marks++;
        const r = reactOf(m);
        if (r.lateralAccel < C6.lateralLo * base - 1e-9 || r.lateralAccel > C6.lateralHi * base + 1e-9) bad.push(`${name} ${m.side}${m.slot}: lateralAccel ${r.lateralAccel.toFixed(2)} against ${base}`);
        if (Math.abs(r.turnShare) > 0.3 + 1e-9) bad.push(`${name} ${m.side}${m.slot}: turnShare ${r.turnShare}`);
      }
    };
    for (const f of SCRIMMAGE_FIXTURES) {
      check(f.name, build(f.ev, f.ratings));
      for (const a of [40, 90]) check(`${f.name} at agility ${a}`, build(f.ev, Object.fromEntries(Object.entries(f.ratings).map(([id, r]) => [id, { ...r, agility: a }]))));
    }
    for (const s of S().filter((_, i) => i % AB_EVERY === 0)) check(s.name, build(s.ev, s.ratings));
    // An agile player's limit is the higher one, and it differs from an unagile one's.
    const at40 = reactOf(markOf(build(COMPLETE, withRating(tableRatings(COMPLETE), "A-LB1", "agility", 40)), "A-LB1"));
    const at90 = reactOf(markOf(build(COMPLETE, withRating(tableRatings(COMPLETE), "A-LB1", "agility", 90)), "A-LB1"));
    expectNone({
      "marks read": marks > 2000 ? [] : [`${marks}, under 2000`],
      "outside the band": bad,
      "lateralAccel at agility 90 is not above that at 40": at90.lateralAccel > at40.lateralAccel ? [] : [`${at90.lateralAccel} at 90, ${at40.lateralAccel} at 40`],
      "turnShare at agility 90 is not above that at 40": at90.turnShare > at40.turnShare ? [] : [`${at90.turnShare} at 90, ${at40.turnShare} at 40`],
    });
  });
});

// ---------------------------------------------------------------- PR-C7

describe("PR-C7: named players (the tackler is bounded by his anchor)", () => {
  /** The same event with another defender named as the tackler: the first unnamed mark on his side at LB, CB or S. */
  function retackled(ev: PlayEvent, tl: Timeline, tackler: TLMark): PlayEvent | null {
    const other = tl.marks.find((m) => m.side === tackler.side && m.playerId !== tackler.playerId && !tl.involved.includes(m.playerId) && ["LB", "CB", "S"].includes(m.position));
    if (other === undefined) return null;
    const d = ev.play.detail as { participants: Record<string, string> };
    return { ...ev, play: { ...ev.play, detail: { ...d, participants: { ...d.participants, tackler: other.playerId } } } as PlayEvent["play"] };
  }

  /**
   * Clause (e), the ring rule bound his departure (PR6, round 3): in the build naming another tackler,
   * on the same clock, the ring first pushes his unnamed self within one 25 ms key after he departs
   * here. A self the ring already pushes by his departure, or pushes later than that, is not (e).
   */
  function ringBound(s: Sample, tl: Timeline, m: TLMark, depart: number): boolean {
    const ev = retackled(s.ev, tl, m);
    if (ev === null) return false;
    const other = build(ev, s.ratings);
    if (other.snapAt !== tl.snapAt || other.read !== tl.read || other.liveEnd !== tl.liveEnd) return false;
    const push = firstRingPush(ev, s.ratings, m.playerId);
    return push !== null && push > depart + 1e-6 && push <= depart + KEY + 1e-6;
  }

  interface Pass {
    tacklers: number;
    delayed: number;
    early: number;
    /** How each early tackler met "he left as late as the anchor allowed": by clause (a), else (b), else (c), else (d), else (e). */
    readonly by: Record<"a" | "b" | "c" | "d" | "e", number>;
    /** Who meets (e) and none of (a) to (d). */
    readonly byRing: string[];
    compared: number;
    atRead: number;
    readonly order: string[];
    readonly demanded: string[];
    readonly early0: string[];
    readonly leak: string[];
    /** Between the keys: gaps from 200 ms before the read to 50 ms before he departs; and the worst gap inside those 50 ms (printed). */
    readonly between: string[];
    lastWorst: { s: number; fixtures: number };
    readonly missed: string[];
    /** Round 3, S only: tacklers measured for a reversal, those who reverse, and of the tacklers within 4 yd of the ball at the read. */
    measured: number;
    near: number;
    readonly reversed: string[];
    readonly nearReversed: string[];
    /** S only: tacklers drawn moving away from the ball faster than AWAY allows, within its distance, and the worst share there. */
    readonly thrown: string[];
    awayWorst: number;
    /** Information only: the same over top at any distance (a departure kink far from the ball stays visible). */
    readonly overAnywhere: string[];
  }
  let pass: Pass | null = null;
  /** Every tackler of S and the fixtures, built once with ratings; each clause's violations kept apart so none hides another. */
  function tacklers(): Pass {
    if (pass !== null) return pass;
    const out: Pass = { tacklers: 0, delayed: 0, early: 0, by: { a: 0, b: 0, c: 0, d: 0, e: 0 }, byRing: [], compared: 0, atRead: 0, order: [], demanded: [], early0: [], leak: [], between: [], lastWorst: { s: 0, fixtures: 0 }, missed: [], measured: 0, near: 0, reversed: [], nearReversed: [], thrown: [], awayWorst: 0, overAnywhere: [] };
    const inS = new Set(S().map((x) => x.name));
    for (const s of [...FIXTURES.filter((f) => ["run", "pass"].includes(f.ev.play.kind)), ...S()]) {
      const tl = build(s.ev, s.ratings);
      const m = tl.tackler === null ? undefined : tl.marks.find((x) => x.playerId === tl.tackler);
      if (m === undefined) continue;
      out.tacklers++;
      const turn = inS.has(s.name) ? tacklerReversal(tl) : null;
      if (turn !== null) {
        out.measured++;
        if (turn.reverses) out.reversed.push(s.name);
        if (turn.nearYards <= REVERSAL.nearYards) {
          out.near++;
          if (turn.reverses) out.nearReversed.push(s.name);
        }
      }
      const r = reactOf(m);
      const who = `${s.name} ${m.side}${m.slot}`;
      const away = inS.has(s.name) ? tacklerAway(tl, AWAY.withinYards) : null;
      if (away !== null) {
        const cap = AWAY.before[s.name] ?? AWAY.maxShare;
        out.awayWorst = Math.max(out.awayWorst, away.share);
        if (away.share > cap) out.thrown.push(`${who}: ${away.yps.toFixed(2)} yd/s away from the ball ${away.t.toFixed(1)} ms after the read, starting ${away.yards.toFixed(2)} yd from it, his top is ${away.top.toFixed(2)} (${away.share.toFixed(3)} x, the cap is ${cap})`);
        const any = tacklerAway(tl) as NonNullable<ReturnType<typeof tacklerAway>>;
        if (any.share > 1) out.overAnywhere.push(`${s.name} ${m.slot} ${any.share.toFixed(3)} x at ${any.yards.toFixed(1)} yd`);
      }
      if (r.delayMs > r.readMs + 1e-9) out.order.push(`${who}: delayMs ${r.delayMs.toFixed(0)} > readMs ${r.readMs.toFixed(0)}`);
      if (dist(at(m.keys, tl.liveEnd), at(tl.ball, tl.liveEnd)) > 1e-6) out.missed.push(`${who}: not at the ball at the whistle`);
      // (d): fact legs of his own before the tackle (another role, or a fact anchor besides the tackle), so he departs as today.
      const ownLegs = m.roles.some((role) => role !== "tackler") || natOf(m).anchors.length > 1;
      const depart = tl.read + r.delayMs;
      if (depart < tl.liveEnd) {
        if (r.delayMs > 0) {
          out.delayed++;
          const leg = natOf(m).demanded.find((d) => Math.min(d.t1, tl.liveEnd) - Math.max(d.t0, depart) > 1e-6);
          if (leg !== undefined) out.demanded.push(`${who}: delayed ${r.delayMs.toFixed(0)} ms, yet his leg to the tackle is anchor-demanded (${(leg.t0 - tl.snapAt).toFixed(0)} to ${(leg.t1 - tl.snapAt).toFixed(0)} ms, mean ${leg.mean.toFixed(1)} yd/s)`);
        }
        if (r.delayMs < r.readMs - C7.slackMs) {
          out.early++;
          let len = 0;
          let peak = 0;
          for (let t = depart; t < tl.liveEnd - 1e-9; t += KEY) {
            const t1 = Math.min(t + KEY, tl.liveEnd);
            const step = dist(at(m.keys, t), at(m.keys, t1));
            len += step;
            peak = Math.max(peak, (step / (t1 - t)) * 1000);
          }
          const meanV = (len / (tl.liveEnd - depart)) * 1000;
          const top = topOf(m);
          if (meanV >= C7.legShare * top) out.by.a++;
          else if (peak >= C7.peakShare * top) out.by.b++;
          else if (tl.liveEnd - tl.read < motion.convergeMs + C7.slackMs) out.by.c++;
          else if (ownLegs) out.by.d++;
          else if (ringBound(s, tl, m, depart)) {
            out.by.e++;
            out.byRing.push(who);
          } else out.early0.push(`${who}: left ${(r.readMs - r.delayMs).toFixed(0)} ms before his own read; his leg of ${(tl.liveEnd - depart).toFixed(0)} ms has mean ${meanV.toFixed(1)} and peak ${peak.toFixed(1)} yd/s against a top of ${top.toFixed(1)}; the read is ${(tl.liveEnd - tl.read).toFixed(0)} ms before the whistle; no fact legs of his own`);
        }
      }
      // Until he departs he is his unnamed self (PR6, NM2). A tackler with fact legs of his own is never unnamed.
      if (ownLegs) continue;
      const ev2 = retackled(s.ev, tl, m);
      if (ev2 === null) continue;
      const other = build(ev2, s.ratings);
      if (other.snapAt !== tl.snapAt || other.read !== tl.read || other.liveEnd !== tl.liveEnd) continue;
      out.compared++;
      if (r.delayMs === 0) out.atRead++;
      const mine = markOf(other, m.playerId);
      for (let t = 0; t <= depart - C7.beforeMs + 1e-9; t += KEY) {
        const d = dist(at(m.keys, t), at(mine.keys, t));
        if (d > 1e-9) {
          out.leak.push(`${who}: ${d.toFixed(3)} yd off his unnamed self ${(t - tl.snapAt).toFixed(0)} ms after the snap (the read is at ${(tl.read - tl.snapAt).toFixed(0)}, he leaves at ${(depart - tl.snapAt).toFixed(0)})`);
          break;
        }
      }
      const gapAt = (t: number): number => dist(at(m.keys, t), at(mine.keys, t));
      for (let t = tl.read - SELF.fromMs; t <= depart - C7.beforeMs + 1e-9; t += SELF.stepMs)
        if (gapAt(t) > SELF.yards) {
          out.between.push(`${who}: ${gapAt(t).toFixed(4)} yd off his unnamed self ${(t - tl.read).toFixed(0)} ms after the read (he leaves at ${r.delayMs.toFixed(0)})`);
          break;
        }
      let worst = 0;
      for (let t = depart - C7.beforeMs; t <= depart + 1e-9; t += SELF.stepMs) worst = Math.max(worst, gapAt(t));
      const part = inS.has(s.name) ? "s" : "fixtures";
      out.lastWorst[part] = Math.max(out.lastWorst[part], worst);
    }
    console.info(`PR-C7: ${out.tacklers} tacklers; ${out.delayed} with a delay; ${out.early} left before their own read (as late as allowed by (a) ${out.by.a}, (b) ${out.by.b}, (c) ${out.by.c}, (d) ${out.by.d}, (e) ${out.by.e}${out.byRing.length === 0 ? "" : `: ${out.byRing.join("; ")}`}; by none ${out.early0.length}); ${out.compared} compared with a build naming another tackler, ${out.atRead} of them leaving at the read, ${out.leak.length} differ on the 25 ms grid, ${out.between.length} between the keys, worst gap in the last ${C7.beforeMs} ms ${out.lastWorst.s.toFixed(4)} yd over S and ${out.lastWorst.fixtures.toFixed(4)} over the fixtures (information only)`);
    console.info(`PR6 round 3: ${out.reversed.length} of ${out.measured} tacklers of S go toward the ball, away and toward it again around the read (information only: ${REVERSAL.before} of ${REVERSAL.tacklers} before the build); within ${AWAY.withinYards} yd of it ${out.thrown.length} move away faster than allowed, the worst at ${out.awayWorst.toFixed(2)} x his top; over top at any distance (information only) ${out.overAnywhere.length}: ${out.overAnywhere.join("; ")}; reversals within ${REVERSAL.nearYards} yd of the ball at the read, ${out.nearReversed.length} of ${out.near}${out.nearReversed.length === 0 ? "" : `: ${out.nearReversed.join("; ")}`}`);
    pass = out;
    return out;
  }

  it("every tackler in S and the fixtures: delayMs <= readMs", { timeout: 600_000 }, () => {
    const p = tacklers();
    expectNone({ "delayMs above readMs": p.order, "tacklers read": p.tacklers > 300 ? [] : [`${p.tacklers}, under 300`] });
  });

  it("when delayMs > 0, his leg to the tackle is not anchor-demanded (no sprint caused by a rating)", { timeout: 600_000 }, () => {
    const p = tacklers();
    expectNone({ "a delayed leg that is anchor-demanded": p.demanded, "tacklers with a delay": p.delayed > 20 ? [] : [`${p.delayed}, under 20`] });
  });

  it("when delayMs < readMs - 25, he left as late as the anchor allowed: (a) the leg's mean is 0.7 x his top or more, or (b) its peak is 1.0 x his top or more, or (c) the read is under convergeMs + 25 ms before the whistle, or (d) he has fact legs of his own, or (e) the ring rule bound his departure", { timeout: 600_000 }, () => {
    const p = tacklers();
    expectNone({ "left earlier than the anchor asked, by none of (a) to (e)": p.early0, "tacklers who left before their own read": p.early > 20 ? [] : [`${p.early}, under 20`] });
  });

  it("his keys up to 50 ms before the read + delayMs equal those of a build in which another defender is named as the tackler", { timeout: 600_000 }, () => {
    const p = tacklers();
    expectNone({
      [`tacklers who show before they depart (${p.leak.length} of ${p.compared})`]: p.leak,
      [`tacklers who show between the keys, from 200 ms before the read (${p.between.length} of ${p.compared})`]: p.between,
      "tacklers compared with the build naming another": p.compared > 100 ? [] : [`${p.compared}, under 100`],
      // Both kinds are compared: the tackler who leaves at the read, and the one who waits.
      "of them, tacklers who leave at the read": p.atRead > 20 ? [] : [`${p.atRead}, under 20`],
      "of them, tacklers who wait": p.compared - p.atRead > 20 ? [] : [`${p.compared - p.atRead}, under 20`],
    });
  });

  it("tl.tackler ends at the ball at the whistle", { timeout: 600_000 }, () => {
    expect(tacklers().missed.slice(0, 30)).toEqual([]);
  });

  // PR6, round 3: a rated tackler departs no later than the key before the ring would first push his
  // unnamed self after the read, so he is not thrown off the ball and then reversed into the tackle.
  // The defect itself, in place of the count of reversals (the lead's ruling of 2026-11-24, which he
  // reports Joseph approved). The old count is still printed, as information.
  it("round 3, over S with the app's ratings: no tackler within 3.5 yd of the ball is drawn moving away from it faster than his own top speed (or, on three plays, than before the build), from 60 ms before the read to 600 ms after", { timeout: 600_000 }, () => {
    const p = tacklers();
    expectNone({
      "thrown off the ball": p.thrown,
      // The plays in AWAY.before were found over S's 392 tacklers: another count means another sample.
      "tacklers measured": p.measured === REVERSAL.tacklers ? [] : [`${p.measured}, the bar was counted over ${REVERSAL.tacklers}`],
    });
  });

  it("round 3, tacklers within 4 yd of the ball at the read: none reverses that did not before the build", { timeout: 600_000 }, () => {
    const p = tacklers();
    expectNone({
      "reverses now, did not before the build": p.nearReversed.filter((name) => !REVERSAL.nearBefore.includes(name)),
      "tacklers within 4 yd of the ball at the read": p.near >= 5 ? [] : [`${p.near}, under 5`],
    });
  });
});
