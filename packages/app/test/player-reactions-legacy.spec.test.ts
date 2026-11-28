// PR-C1 ("Legacy, key for key", docs/specs/m2-player-reactions.md), written by test-writer from
// the spec before the build. Headless, on the Timeline from timeline() at 1x.
//
//   PR1  With no ctx.ratings the Timeline is the one drawn before the build, key for key: every
//        fixture and every play of sim games seeds 1 to 4 gives its baseline digest.
//   PR2  Every kick play is drawn exactly as before, with or without ratings: with the ratings
//        the app passes, every kick play gives its baseline digest too.
//
// Scrimmage plays drawn with ratings are meant to change, so nothing here holds them equal. Their
// digests are in pr-baseline.json only as the record of the behavior before the build.
//
// pr-baseline.json is a fixed reference (pr-digest.ts). It is recaptured only by a person who has
// checked that a change was intended, never to make this file pass.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readDetail } from "../src/engine/types";
import { ALL_FIXTURES, COMPLETE, PUNT_RETURNED, RUN, SACK } from "./fixtures";
import { tableRatings } from "./player-reactions.checks";
import { PR_FIXTURES, PR_KICK_FIXTURES, PR_SEEDS, prDigest, prDigestOf, prFixtureRatings, prMotion, prPlays, prTimeline, type PrClass, type PrDigests, type PrPlay } from "./pr-digest";
import { simGame } from "./sim-games";

interface Section {
  readonly about: string;
  readonly digests: Record<string, string>;
}
interface Baseline {
  readonly meta: { readonly gitHead: string; readonly treeDirty: boolean; readonly sha256: Record<string, string>; readonly counts: { readonly timelinesPerSection: number } };
  readonly inputs: { readonly about: string; readonly hashes: Record<string, string> };
  readonly noRatings: Section;
  readonly withRatings: Section;
}

const baseline = JSON.parse(readFileSync(join(import.meta.dirname, "pr-baseline.json"), "utf8")) as Baseline;

/** The source files whose state at capture the baseline records, so a later reader can tell what "before" was. */
const RECORDED = ["packages/app/src/ui/timeline.ts", "packages/app/src/ui/motion.ts", "packages/app/src/ui/natural.ts", "packages/app/src/ui/templates.ts", "data/ui/motion.json"];

const PLAYS = prPlays();
const classOf = new Map<string, PrClass>(PLAYS.map((p) => [p.name, p.cls]));
const namesOf = (cls: PrClass): string[] => PLAYS.filter((p) => p.cls === cls).map((p) => p.name);
const isFixture = (p: PrPlay): boolean => p.source === "fixtures";

/** The plays in `names` whose digest in `now` is not the baseline's (a play missing from either side counts). */
function changed(now: Record<string, string>, was: Record<string, string>, names: readonly string[]): string[] {
  return names.filter((n) => now[n] === undefined || was[n] === undefined || now[n] !== was[n]);
}

/**
 * A play's ratings as slice 2 passes them: the three the baseline was captured with, plus strength
 * and the skills of his position (the pool's for a sim play, the fixed table's for a fixture).
 */
function widened(p: PrPlay): PrPlay["ratings"] {
  if (isFixture(p)) return { ...p.ratings, ...tableRatings(p.event) } as PrPlay["ratings"];
  const g = simGame(Number(p.source.replace("seed ", "")));
  return Object.fromEntries([...g.matchup.home.pool.players, ...g.matchup.away.pool.players].map((x) => [x.id, { ...x.ratings, ...x.skills }]));
}

describe("PR-C1: legacy, key for key", () => {
  let now: PrDigests;
  beforeAll(() => {
    now = prDigest();
  }, 300_000);

  // ------------------------------------------------------------ the reference itself

  it("the baseline says what 'before' was: the git HEAD, that the tree was dirty, and the sha256 of the files that draw a play", () => {
    expect(baseline.meta.gitHead).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof baseline.meta.treeDirty).toBe("boolean");
    for (const f of RECORDED) expect(baseline.meta.sha256[f], f).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the baseline holds every fixture and every play of sim games seeds 1 to 4, in both sections", () => {
    const names = PLAYS.map((p) => p.name).sort();
    expect(Object.keys(baseline.noRatings.digests).sort()).toEqual(names);
    expect(Object.keys(baseline.withRatings.digests).sort()).toEqual(names);
    expect(names.length).toBe(baseline.meta.counts.timelinesPerSection);
    // Every fixture the spec names (COMPLETE, RUN, SACK and ALL_FIXTURES), under its own name.
    expect(PR_FIXTURES).toBe(ALL_FIXTURES);
    for (const ev of [COMPLETE, RUN, SACK]) expect(Object.values(ALL_FIXTURES)).toContain(ev);
    for (const [name, ev] of [...Object.entries(ALL_FIXTURES), ...Object.entries(PR_KICK_FIXTURES)]) expect(baseline.noRatings.digests, name).toHaveProperty([`fixture ${name} ${ev.play.kind}`]);
    // Seeds 1 to 4, each a whole game, and each class of play present so no half of the test is empty.
    expect(PR_SEEDS).toEqual([1, 2, 3, 4]);
    for (const seed of PR_SEEDS) expect(PLAYS.filter((p) => p.source === `seed ${seed}`).length, `seed ${seed}`).toBeGreaterThan(100);
    for (const cls of ["scrimmage", "kick", "dead"] as const) {
      expect(PLAYS.filter((p) => p.cls === cls && isFixture(p)).length, `${cls} fixtures`).toBeGreaterThan(0);
      expect(PLAYS.filter((p) => p.cls === cls && !isFixture(p)).length, `${cls} sim plays`).toBeGreaterThan(50);
    }
    for (const kind of ["kickoff", "onsideKick", "punt", "fieldGoal", "extraPoint"]) expect(PLAYS.some((p) => p.cls === "kick" && p.event.play.kind === kind), kind).toBe(true);
  });

  it("the fixtures' fixed rating table covers 40 to 90, and the sim plays carry the app's three ratings for every player on the field", () => {
    const table = Object.values(prFixtureRatings());
    for (const r of ["speed", "agility", "awareness"] as const) {
      const vals = table.map((x) => x[r]);
      expect(Math.min(...vals), r).toBeGreaterThanOrEqual(40);
      expect(Math.min(...vals), r).toBeLessThanOrEqual(43);
      expect(Math.max(...vals), r).toBeGreaterThanOrEqual(87);
      expect(Math.max(...vals), r).toBeLessThanOrEqual(90);
    }
    const unrated: string[] = [];
    for (const p of PLAYS) {
      if (isFixture(p)) continue;
      // Every player the event puts on the field (its onField slots are the marks drawn), without building the play again.
      const d = readDetail(p.event.play);
      for (const slot of [...(d.onField?.offense ?? []), ...(d.onField?.defense ?? [])]) {
        const r = p.ratings[slot.id];
        if (r === undefined || ![r.speed, r.agility, r.awareness].every(Number.isFinite)) unrated.push(`${p.name}: ${slot.position} ${slot.id}`);
      }
    }
    expect(unrated).toEqual([]);
  }, 120_000);

  it("the with-ratings half is not empty of meaning: in the baseline every kick play drawn with ratings differs from the same play drawn without", () => {
    const same = namesOf("kick").filter((n) => baseline.withRatings.digests[n] === baseline.noRatings.digests[n]);
    expect(same).toEqual([]);
  });

  // ------------------------------------------------------------ the digest can fail

  it("the digest sees a change to each part it covers (self-check)", () => {
    const play = PLAYS.find((p) => p.event === COMPLETE) as PrPlay;
    const tl = prTimeline(play, false);
    const d = prDigestOf(tl);
    expect(prDigestOf(prTimeline(play, false))).toBe(d);
    // The order of the marks is not a key: the same marks in another order give the same digest.
    expect(prDigestOf({ ...tl, marks: [...tl.marks].reverse() })).toBe(d);

    const last = tl.marks.length - 1;
    const nudge = <K extends { readonly x: number }>(keys: readonly K[]): K[] => keys.map((k, i) => (i === keys.length - 1 ? { ...k, x: k.x + 1e-9 } : k));
    const variants: Record<string, typeof tl> = {
      "one mark's last key, by a billionth of a yard": { ...tl, marks: tl.marks.map((m, i) => (i === last ? { ...m, keys: nudge(m.keys) } : m)) },
      "one mark's key dropped": { ...tl, marks: tl.marks.map((m, i) => (i === 0 ? { ...m, keys: m.keys.slice(1) } : m)) },
      "two marks' keys swapped": { ...tl, marks: tl.marks.map((m, i) => (i === 0 ? { ...m, keys: (tl.marks[1] as typeof m).keys } : i === 1 ? { ...m, keys: (tl.marks[0] as typeof m).keys } : m)) },
      "the ball": { ...tl, ball: nudge(tl.ball) },
      "the ball scale": { ...tl, ballScale: [...tl.ballScale, { t: tl.total, s: 1.5 }] },
      "the paths": { ...tl, paths: tl.paths.slice(1) },
      liveEnd: { ...tl, liveEnd: tl.liveEnd + 1 },
      total: { ...tl, total: tl.total + 1 },
    };
    expect(tl.marks.length).toBeGreaterThan(1);
    expect(tl.paths.length).toBeGreaterThan(0);
    for (const [what, v] of Object.entries(variants)) expect(prDigestOf(v), what).not.toBe(d);
  });

  it("the comparison catches a small change to unrated motion (self-check: every reaction 10 ms later moves COMPLETE, RUN and SACK off the baseline)", () => {
    const motion = prMotion();
    const later = { ...motion, reactionMs: Object.fromEntries(Object.entries(motion.reactionMs).map(([pos, ms]) => [pos, ms + 10])) };
    const got = prDigest({ motion: later, only: isFixture });
    const bad = changed(got.noRatings, baseline.noRatings.digests, Object.keys(got.noRatings));
    for (const name of ["fixture COMPLETE pass", "fixture RUN run", "fixture SACK sack"]) expect(bad, name).toContain(name);
  });

  it("the comparison catches a small change to rated motion on kicks, and only with ratings (self-check: a wider speed band)", () => {
    const motion = prMotion();
    const [lo, hi] = motion.ratings.default.topShare;
    const wider = { ...motion, ratings: { ...motion.ratings, default: { ...motion.ratings.default, topShare: [lo - 0.01, hi + 0.01] as const } } };
    const got = prDigest({ motion: wider, only: isFixture });
    const kicks = PLAYS.filter((p) => isFixture(p) && p.cls === "kick").map((p) => p.name);
    // Drawn with ratings, the kick fixtures move off the baseline (PUNT_RETURNED among them)...
    const bad = changed(got.withRatings, baseline.withRatings.digests, kicks);
    expect(bad).toContain(`fixture PUNT_RETURNED ${PUNT_RETURNED.play.kind}`);
    expect(bad.length).toBeGreaterThan(kicks.length / 2);
    // ...and with none, no fixture does: a rating band is an added term that is zero without the rating (PR1).
    expect(changed(got.noRatings, baseline.noRatings.digests, Object.keys(got.noRatings))).toEqual([]);
  });

  // ------------------------------------------------------------ PR-C1

  it("the plays are the ones the baseline was captured from: the fixtures, the four sim games and their rating tables are unchanged", () => {
    // If this fails, the sim or a fixture changed since the capture, and a failure below says
    // nothing about the drawing until a person has looked at why.
    expect(now.inputs).toEqual(baseline.inputs.hashes);
  });

  it("no ratings: every fixture and every play of sim games seeds 1 to 4 gives its baseline digest (PR1)", () => {
    const names = PLAYS.map((p) => p.name);
    expect(Object.keys(now.noRatings).sort()).toEqual([...names].sort());
    const bad = changed(now.noRatings, baseline.noRatings.digests, names);
    expect(bad, `${bad.length} of ${names.length} plays drawn with no ratings changed`).toEqual([]);
  });

  // To revise when kickoffs and punts move to their own slice: this holds every kick play (kickoff,
  // onside kick, punt, field goal, extra point), as PR2 stands today.
  it("with the app's ratings: every kick play gives its baseline digest (PR2, every kick kind for now)", { timeout: 120_000 }, () => {
    const names = namesOf("kick");
    // Added 2026-11-24 (slice 2 widens ctx.ratings to strength and the position skills): kicks drawn
    // with the widened map still give the baseline, which was captured with the three ratings.
    const wide = Object.fromEntries(PLAYS.filter((p) => p.cls === "kick").map((p) => [p.name, prDigestOf(prTimeline({ ...p, ratings: widened(p) }, true))]));
    const wideBad = changed(wide, baseline.withRatings.digests, names);
    expect.soft(wideBad, `${wideBad.length} of ${names.length} kick plays drawn with the widened ratings (strength and position skills) changed`).toEqual([]);
    const bad = changed(now.withRatings, baseline.withRatings.digests, names);
    expect(bad, `${bad.length} of ${names.length} kick plays drawn with ratings changed`).toEqual([]);
  });

  // Not in PR-C1's own words: the spec's States table has the row "Kneel, spike, no play, every
  // kick: Unchanged (PR2)". Kept apart from the kick plays so it can be judged on its own.
  it("with the app's ratings: every kneel, spike and no play gives its baseline digest (States: 'Kneel, spike, no play, every kick: unchanged')", () => {
    const names = namesOf("dead");
    const bad = changed(now.withRatings, baseline.withRatings.digests, names);
    expect(bad, `${bad.length} of ${names.length} kneels, spikes and no plays drawn with ratings changed`).toEqual([]);
  });

  it("with the app's ratings, scrimmage plays: reported, not held (they are meant to change)", () => {
    const names = namesOf("scrimmage");
    // Each has a record to count against; whether it still matches is not asserted.
    for (const n of names) expect(baseline.withRatings.digests[n], n).toMatch(/^[0-9a-f]{16}$/);
    expect(names.every((n) => classOf.get(n) === "scrimmage")).toBe(true);
    const moved = changed(now.withRatings, baseline.withRatings.digests, names);
    console.info(`PR-C1 record: ${moved.length} of ${names.length} scrimmage plays drawn with ratings differ from the capture of ${baseline.meta.gitHead.slice(0, 7)} (0 before the build).`);
  });
});
