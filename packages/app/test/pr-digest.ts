// PR-C1 ("Legacy, key for key", docs/specs/m2-player-reactions.md): a digest of a whole Timeline,
// one hash per play, so the test can compare the player-reactions build against the tree it
// started from, in the manner of kr8-digest.ts. The hash covers what PR-C1 lists: every mark's
// keys, the ball, the ball scale, the paths, liveEnd and total.
//
// pr-baseline.json was captured from this digest on 2026-11-23, before any player-reactions code
// or data existed (motion.json version 4, no ratings.scrimmage block). Its meta block records the
// git HEAD, that the tree was dirty, and the sha256 of the source files that draw a play. It is a
// fixed reference: it is recaptured only by a person who has checked that a change was intended,
// never to make PR-C1 pass. To recapture, write { meta, ...prDigest() } with the sections named as
// in the file (prDigest() takes about a minute); the test never writes it.
//
// Two sections, the same plays in each:
//   noRatings    every play drawn with no ctx.ratings. PR1: all of it stays equal.
//   withRatings  every play drawn with the ratings the app passes. PR2: the kick plays stay equal.
//                The scrimmage plays are meant to change; they are the record of the behavior
//                before the build, kept for before and after counts.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readDetail, type PlayEvent } from "../src/engine/types";
import { parseMotion, parseTemplates, type Motion } from "../src/ui/templates";
import { timeline, type Timeline, type TimelineCtx } from "../src/ui/timeline";
import { ALL_FIXTURES } from "./fixtures";
import { KO_FAIR, KO_OOB, KO_SHORT, KR_DEEP, KR_FOUL, KR_FUMBLE, KR_LONG, KR_TD, ONSIDE_KICKERS, ONSIDE_RECEIVERS } from "./kickoff-return.fixtures";
import { simGame } from "./sim-games";

const read = (p: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", p), "utf8"));
const h = (x: unknown): string => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);

/** The three ratings the app passes to the field motion today (app.ts motionRatings). */
export type PrRatings = Readonly<Record<string, { readonly speed: number; readonly agility: number; readonly awareness: number }>>;

/**
 * How the spec sorts a play (PR2, and the States row "Kneel, spike, no play, every kick"):
 *   kick       kickoffs, onside kicks, punts, field goals and extra points
 *   dead       kneel, spike and no play
 *   scrimmage  runs, passes, sacks, scrambles and tries from scrimmage: what the build changes with ratings
 */
export type PrClass = "scrimmage" | "kick" | "dead";

const KICK_KINDS: readonly string[] = ["kickoff", "onsideKick", "punt", "fieldGoal", "extraPoint"];
const DEAD_KINDS: readonly string[] = ["kneel", "spike", "noPlay"];

export function prClass(ev: PlayEvent): PrClass {
  const k = ev.play.kind;
  return KICK_KINDS.includes(k) ? "kick" : DEAD_KINDS.includes(k) ? "dead" : "scrimmage";
}

/** PR-C1's fixtures: COMPLETE, RUN, SACK and the rest of ALL_FIXTURES (the spec's "Fixtures"). */
export const PR_FIXTURES: Readonly<Record<string, PlayEvent>> = ALL_FIXTURES;
/**
 * Not named by the spec: the kickoff return pass's fixtures, added because PR2 covers every kick
 * play and these pin kick results a simulated game reaches only rarely (a return fumble, a return
 * touchdown, a foul on the return, a kickoff out of bounds or short, an onside kick either way).
 */
export const PR_KICK_FIXTURES: Readonly<Record<string, PlayEvent>> = { KR_LONG, KR_FUMBLE, KR_TD, KR_FOUL, KR_DEEP, KO_FAIR, KO_OOB, KO_SHORT, ONSIDE_KICKERS, ONSIDE_RECEIVERS };
export const PR_SEEDS: readonly number[] = [1, 2, 3, 4];

/**
 * The fixed rating table for the fixtures (their players are in no pool): each rating from a hash
 * of the player id, 40 to 90, so it never depends on the code under test.
 */
export function prFixtureRating(id: string, rating: "speed" | "agility" | "awareness"): number {
  return 40 + (createHash("sha256").update(`pr-c1|${id}|${rating}`).digest().readUInt32BE(0) % 51);
}

function idsOf(ev: PlayEvent): string[] {
  const d = readDetail(ev.play);
  return [...(d.onField?.offense ?? []).map((s) => s.id), ...(d.onField?.defense ?? []).map((s) => s.id), ...Object.values(d.participants ?? {}).filter((v): v is string => typeof v === "string")];
}

export function prFixtureRatings(): PrRatings {
  const out: Record<string, { speed: number; agility: number; awareness: number }> = {};
  for (const ev of [...Object.values(PR_FIXTURES), ...Object.values(PR_KICK_FIXTURES)])
    for (const id of idsOf(ev)) out[id] = { speed: prFixtureRating(id, "speed"), agility: prFixtureRating(id, "agility"), awareness: prFixtureRating(id, "awareness") };
  return out;
}

/** One play of the baseline: its name in pr-baseline.json, where it came from and the ratings the app would pass with it. */
export interface PrPlay {
  readonly name: string;
  readonly source: string;
  readonly cls: PrClass;
  readonly event: PlayEvent;
  readonly ratings: PrRatings;
}

let plays: readonly PrPlay[] | null = null;

/** Every fixture, then every play of sim games seeds 1 to 4, in order. The games are played once. */
export function prPlays(): readonly PrPlay[] {
  if (plays !== null) return plays;
  const out: PrPlay[] = [];
  const fixtureRatings = prFixtureRatings();
  for (const [name, event] of [...Object.entries(PR_FIXTURES), ...Object.entries(PR_KICK_FIXTURES)]) out.push({ name: `fixture ${name} ${event.play.kind}`, source: "fixtures", cls: prClass(event), event, ratings: fixtureRatings });
  for (const seed of PR_SEEDS) {
    const g = simGame(seed);
    // As app.ts motionRatings() builds them: card ratings from the pool, before the home-field shift.
    const ratings: PrRatings = Object.fromEntries([...g.matchup.home.pool.players, ...g.matchup.away.pool.players].map((p) => [p.id, { speed: p.ratings.speed, agility: p.ratings.agility, awareness: p.ratings.awareness }]));
    g.plays.forEach((event, i) => out.push({ name: `seed ${seed} play ${i + 1} ${event.play.kind}`, source: `seed ${seed}`, cls: prClass(event), event, ratings }));
  }
  if (new Set(out.map((p) => p.name)).size !== out.length) throw new Error("PR-C1: two plays share a name");
  plays = out;
  return out;
}

/** One hash for a whole Timeline: every mark's keys (by side and slot), the ball, ball scale, paths, liveEnd and total. */
export function prDigestOf(tl: Timeline): string {
  const marks = tl.marks.map((m) => [`${m.side}:${m.slot}`, m.keys] as const);
  if (new Set(marks.map(([name]) => name)).size !== marks.length) throw new Error("PR-C1: two marks share a side and slot");
  marks.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return h({ marks, ball: tl.ball, scale: tl.ballScale, paths: tl.paths, liveEnd: tl.liveEnd, total: tl.total });
}

let shipped: { readonly templates: ReturnType<typeof parseTemplates>; readonly motion: Motion; readonly presetPackage: Record<string, string> } | null = null;

function data(): NonNullable<typeof shipped> {
  // The motion file may have gained a ratings.scrimmage block since the capture: parse it as the app does.
  shipped ??= { templates: parseTemplates(read("data/ui/templates.json")), motion: parseMotion(read("data/ui/motion.json")), presetPackage: (read("data/engine/personnel.json") as { presetPackage: Record<string, string> }).presetPackage };
  return shipped;
}

/** The shipped motion data, for a test that needs a changed copy. */
export function prMotion(): Motion {
  return data().motion;
}

/** One play's Timeline, built as the spec's sample S is, with or without the play's ratings. */
export function prTimeline(play: PrPlay, withRatings: boolean, motion: Motion = data().motion): Timeline {
  const base: TimelineCtx = { presetPackage: data().presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion };
  return timeline({ event: play.event, runoffSeconds: 0, human: null, ownStart: "lined" }, data().templates, withRatings ? { ...base, ratings: play.ratings } : base);
}

export interface PrDigests {
  /** A hash of what was drawn from, per source (the fixtures, each sim game): the play events and the rating table. Not a drawing. */
  readonly inputs: Record<string, string>;
  readonly noRatings: Record<string, string>;
  readonly withRatings: Record<string, string>;
}

/** The digests of every play (or of those `only` keeps), drawn with the shipped motion data or with `motion`. */
export function prDigest(over: { readonly motion?: Motion; readonly only?: (p: PrPlay) => boolean } = {}): PrDigests {
  const all = prPlays();
  const inputs: Record<string, string> = {};
  for (const source of new Set(all.map((p) => p.source))) {
    const of = all.filter((p) => p.source === source);
    inputs[source] = h({ events: of.map((p) => [p.name, p.event]), ratings: of[0]?.ratings });
  }
  const noRatings: Record<string, string> = {};
  const withRatings: Record<string, string> = {};
  for (const p of all) {
    if (over.only !== undefined && !over.only(p)) continue;
    noRatings[p.name] = prDigestOf(prTimeline(p, false, over.motion));
    withRatings[p.name] = prDigestOf(prTimeline(p, true, over.motion));
  }
  return { inputs, noRatings, withRatings };
}
