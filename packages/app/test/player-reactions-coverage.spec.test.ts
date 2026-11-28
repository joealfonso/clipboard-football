// Player reactions, slice 2 (docs/specs/m2-player-reactions.md): PR7 (coverage, blocks and the bite
// before the read), PR8 (break pace), PR15's slice 2 fields and criteria PR-C11 and PR-C12, written
// by test-writer from the spec, not the code, while the slice was being built. Headless, on the
// Timeline from timeline() at 1x. PR-C3's slice 2 narrowing is in player-reactions.spec.test.ts.
//
// Every floor below is the criterion's own number, held here as a constant: the data can't loosen
// its own test, and nobody edits a floor in a test. Bands are read from motion.json only where the
// spec gives a formula (PR7's sums); where a criterion gives a number, the number is here.
//
// Readings of the spec, where it needed one (each is in the test-writer's report as an assumption):
// - "Man presets": the presets with man targets (layout.test.ts, "zones or man targets, one or the
//   other"): nickel2Man, nickelCover1, the two blitz presets, runStuff and goalLine. A man defender is
//   a non-DL slot with a man target and no landmark, and not a linebacker of a blitz drop set.
// - PR-C11 reads corners of coverage presets (not runStuff or goalLine) over all of S, by how far
//   behind the receiver he is along the receiver's own path, signed (Joseph, 2026-11-24, "Measure
//   corners", as the lead relayed it). The old reading is printed as information.
// - PR-C11's window: from the first key at which the receiver has come within 2 yd of the defender's
//   depth in both builds, to the earlier throw, so both builds are read over the same keys.
// - "His receiver's template position" is the receiver's drawn place before the throw: until then
//   every receiver, the target included, is on his template (R-C7), and no rating of the pair's moves it.
// - A/B pairs are the spec's: the fixtures and every 5th play of S. "Unnamed": not in tl.involved and
//   not the tackler. The player whose rating moves is the unnamed one.
// - PR-C12 (a): "along his bite" is along readStep.playAction's LB waypoint, toward the strong side.
//   A linebacker of a run drop set (runStuff, goalLine) is non-rushing too (R-C10 (c) reads him so), but
//   his drop is itself downhill; his pairs have a test of their own, which reads the bite as the
//   largest difference between the two builds along it (the lead's ruling, 2026-11-24). "Moving toward it" is read as R-C10 (b) reads a displacement: from where he was.
// - PR-C12 (b): B uses the defender's own top (the motion spec, "every top in R-C8 becomes the mark's
//   own"). The standing-checks rule applies: the stalks that already missed the hold on the tree
//   before the build, at the same ratings, may miss it.
// - PR-C12 (c): every pair, "reached" as R-C6 reads a break.
// - biteShare and breakPaceShare hold the band's value, as slice 1's turnShare does (PR21 writes
//   "1 + his breakPaceShare").
// - Not in a criterion but in PR7 and PR8, and marked so below: the cushion, that the stalk lag and a
//   defender's break pace reach the drawing, and the States rows.
// - Every test collects each clause's failures before asserting, so none hides another.

import { describe, expect, it } from "vitest";
import type { PlayEvent } from "../src/engine/types";
import { App } from "../src/ui/app";
import type { Timeline, TLMark } from "../src/ui/timeline";
import { abMotionFor, bandAt, biteGapYards, biteRises, biteSweepPlays, biteYards, build, cushionInUse, firstDiff, firstSharpApex, FIXTURES, flightOf, KEY, leafOf, LOCK_AWARENESS, longMotion, manPairs, markOf, median, mk, motion, nearestDb, notRecovering, pathGap, personnel, rc6, rc8Stalk, reactIf, reactOf, readingLbs, routeLine, routeOf, S, SCRIMMAGE_FIXTURES, skillNames, specRead, stalkers, stalkLocks, tableRatings, templates, trailGap, withRating, type Ratings, type React, type Sample } from "./player-reactions.checks";
import { prDigestOf } from "./pr-digest";
import { simGame } from "./sim-games";

// ---------------------------------------------------------------- the criteria's floors (test constants)

const C11 = { depthYards: 2, minMs: 300, coverageYards: 0.6, routeRunningYards: 0.3 };
/** PR-C11's pairs over S: it must not pass on a handful (the engineer measured 42 and 27). */
const C11_PAIRS = { coverage: 30, routeRunning: 20 };
const C12A = { firstMs: 900, biteYards: 0.8, withinYards: 3, lastMs: 200, riseYards: 0.02 };
const C12B = { lagGapMs: 150 };
/** The lock test's threshold (yd/s). A test choice (the lead's ruling of 2026-11-24), not from the spec, which has no number; 1.0 to 2.0 read alike on the builds it was tried on. */
const LOCK_OFF_YPS = 1.0;
const C12C = { apexShare: 0.08, pathYards: 0.1 };
/** R-C8's approach share (routes-pace.spec.test.ts). */
const RC8_CLOSED = 0.8;
const AB_EVERY = 5;
const LO = 40;
const HI = 90;

const FORMATIONS = ["shotgun", "underCenter", "pistol", "empty", "heavy"] as const;
const PASS = ["shortPass", "intermediatePass", "deepPass", "screenPass", "playAction"] as const;
const PRESETS = Object.keys(personnel.presetPackage);
const MAN_PRESETS = PRESETS.filter((p) => Object.keys(templates.manTargets[p] ?? {}).length > 0);
const runFront = (preset: string): boolean => templates.presetDrops[preset] === "run";

/** One assertion over several clauses: every clause's failures are shown together, so none hides another. */
const expectNone = (clauses: Readonly<Record<string, readonly string[]>>): void => {
  expect(Object.fromEntries(Object.entries(clauses).filter(([, lines]) => lines.length > 0).map(([name, lines]) => [name, lines.slice(0, 30)]))).toEqual({});
};
const unnamed = (tl: Timeline, m: TLMark): boolean => !tl.involved.includes(m.playerId) && m.playerId !== tl.tackler;
const near = (a: number | undefined, b: number): boolean => a !== undefined && Math.abs(a - b) < 1e-6;
const show = (v: unknown): string => (typeof v === "number" ? v.toFixed(3) : String(v));

/** The A/B samples (the fixtures and every 5th play of S), each with its build at its own ratings, built once. */
let abBase: readonly { readonly s: Sample; readonly tl: Timeline }[] | null = null;
const abSamples = (): NonNullable<typeof abBase> => (abBase ??= [...SCRIMMAGE_FIXTURES, ...S().filter((_, i) => i % AB_EVERY === 0)].map((s) => ({ s, tl: build(s.ev, s.ratings) })));

/** A built pass with one named target; his defenders and everyone else are unnamed. */
const passEv = (formation: string, call: string, preset: string, extra: Partial<Parameters<typeof mk>[0]> = {}): PlayEvent => {
  const target = ((personnel.offense[formation] as Record<string, number>)["WR"] ?? 0) > 0 ? "O-WR1" : "O-TE1";
  return mk({ formation, call, preset, result: "complete", gain: 9, parts: { passer: "O-QB1", target, receiver: target }, ...extra });
};
const runEv = (formation: string, call: string, preset: string): PlayEvent => {
  const carrier = call === "qbSneak" || ((personnel.offense[formation] as Record<string, number>)["RB"] ?? 0) === 0 ? "O-QB1" : "O-RB1";
  return mk({ formation, call, preset, result: "run", gain: call === "qbSneak" ? 1 : 4, parts: { ballCarrier: carrier, tackler: "X-LB1" }, runLocation: "right" });
};
/** Every mark's record on one play, built with ratings; a mark with none is listed by name. */
const records = (tl: Timeline, where: string, missing: string[]): Map<string, React> => {
  const out = new Map<string, React>();
  for (const m of tl.marks) {
    const r = reactIf(m);
    if (r === undefined) missing.push(`${where} ${m.side}${m.slot}: no nat.react`);
    else out.set(m.playerId, r);
  }
  return out;
};
const ratingOf = (ratings: Ratings, id: string, name: string): number | undefined => (ratings[id] ?? {})[name];
/** A band at a player's rating, 0 when he lacks it (PR1). */
const band = (path: readonly string[], ratings: Ratings, id: string, name: string): number => {
  const v = ratingOf(ratings, id, name);
  return v === undefined ? 0 : bandAt(path, v);
};

// ================================================================ the wider ratings

describe("Schema, the one interface change: ctx.ratings takes strength and the position skills, and the app passes them", () => {
  it("motionRatings() gives every player of both teams his card speed, strength, agility, awareness and the skills of his position", () => {
    const { matchup } = simGame(1);
    const app = Object.create(App.prototype) as Record<string, unknown>;
    Object.assign(app, { game: { matchup }, matchup });
    const got = (app["motionRatings"] as () => Record<string, Record<string, number>>).call(app);
    const bad: string[] = [];
    const players = [...matchup.home.pool.players, ...matchup.away.pool.players];
    for (const p of players) {
      for (const name of ["speed", "strength", "agility", "awareness"] as const) if (got[p.id]?.[name] !== p.ratings[name]) bad.push(`${p.position} ${p.id} ${name}: ${show(got[p.id]?.[name])}, his card says ${p.ratings[name]}`);
      for (const name of skillNames(p.position)) if (got[p.id]?.[name] !== p.skills[name]) bad.push(`${p.position} ${p.id} ${name}: ${show(got[p.id]?.[name])}, his card says ${show(p.skills[name])}`);
    }
    expectNone({ "a rating not passed, or not his card's": bad, "players read": players.length >= 44 ? [] : [`${players.length}, under 44`] });
  });
});

// ================================================================ PR15: the slice 2 fields

describe("PR15, slice 2: the record's fields, present when they apply", () => {
  it("man defenders (every formation and man preset, and the A/B plays in one): manLagMs is man.lagMs + his coverage band + his receiver's routeRunning band, at least man.minLagMs; cushionYards is the cushion in use + his speed band", { timeout: 300_000 }, () => {
    const missing: string[] = [];
    const lag: string[] = [];
    const cushion: string[] = [];
    const spread = new Set<number>();
    let pairs = 0;
    const floor = (motion.ratings as unknown as { scrimmage: { man: { minLagMs: number } } }).scrimmage.man.minLagMs;
    const samples: { name: string; ev: PlayEvent; ratings: Ratings }[] = [];
    for (const f of FORMATIONS) for (const preset of MAN_PRESETS) samples.push({ name: `${f} intermediatePass vs ${preset}`, ev: passEv(f, "intermediatePass", preset), ratings: tableRatings(passEv(f, "intermediatePass", preset)) });
    for (const { s } of abSamples()) if (s.ev.play.kind === "pass" && MAN_PRESETS.includes(s.ev.defense ?? "")) samples.push(s);
    for (const s of samples) {
      const tl = build(s.ev, s.ratings);
      const recs = records(tl, s.name, missing);
      for (const { D, R } of manPairs(tl, s.ev)) {
        if (!unnamed(tl, D)) continue;
        pairs++;
        const r = recs.get(D.playerId);
        const want = Math.max(floor, motion.man.lagMs + band(["man", "lagMs"], s.ratings, D.playerId, "coverage") + band(["man", "receiverLagMs"], s.ratings, R.playerId, "routeRunning"));
        if (!near(r?.manLagMs, want)) lag.push(`${s.name} ${D.slot} on ${R.slot}: manLagMs ${show(r?.manLagMs)}, PR7 says ${want.toFixed(3)}`);
        else spread.add(Math.round(want));
        const cush = cushionInUse(s.ev.defense ?? "") + band(["man", "cushionYards"], s.ratings, D.playerId, "speed");
        if (!near(r?.cushionYards, cush)) cushion.push(`${s.name} ${D.slot} on ${R.slot}: cushionYards ${show(r?.cushionYards)}, PR7 says ${cush.toFixed(3)}`);
      }
    }
    expectNone({ "no record": missing, manLagMs: lag, cushionYards: cushion, "man pairs read": pairs > 60 ? [] : [`${pairs}, under 60`], "one lag for everybody": spread.size > 20 ? [] : [`${spread.size} different lags, under 20`] });
  });

  it("a defender with no man assignment, a DL and every offensive mark carry no manLagMs and no cushionYards", () => {
    const bad: string[] = [];
    for (const preset of ["nickelCover3", "baseCover2", "nickelCover1"]) {
      const ev = passEv("shotgun", "intermediatePass", preset);
      const tl = build(ev, tableRatings(ev));
      const man = new Set(manPairs(tl, ev).map((p) => p.D.playerId));
      for (const m of tl.marks) if (!man.has(m.playerId) && ((reactOf(m).manLagMs ?? null) !== null || (reactOf(m).cushionYards ?? null) !== null)) bad.push(`${preset} ${m.side}${m.slot}: manLagMs ${show(reactOf(m).manLagMs)}, cushionYards ${show(reactOf(m).cushionYards)}`);
    }
    expect(bad).toEqual([]);
  });

  it("stalkOf: every unnamed stalking receiver's is the nearest CB or S at the set on his side (R9), every other mark's is null; stalkLagMs is stalk.lagMs + the blocker's band (awareness for a WR, runBlock for a TE)", { timeout: 300_000 }, () => {
    const missing: string[] = [];
    const of: string[] = [];
    const lag: string[] = [];
    const others: string[] = [];
    const seen = { WR: 0, TE: 0 };
    const samples: { name: string; ev: PlayEvent; ratings: Ratings }[] = [];
    for (const f of FORMATIONS)
      for (const preset of ["nickelCover3", "nickel2Man", "baseCover2"]) {
        for (const call of ["insideRun", "outsideRun", "qbSneak"]) samples.push({ name: `${f} ${call} vs ${preset}`, ev: runEv(f, call, preset), ratings: tableRatings(runEv(f, call, preset)) });
        for (const call of ["screenPass", "shortPass"]) {
          const ev = passEv(f, call, preset, { parts: { passer: "O-QB1", target: "O-RB1", receiver: "O-RB1" } });
          if (f !== "empty") samples.push({ name: `${f} ${call} vs ${preset}`, ev, ratings: tableRatings(ev) });
        }
      }
    for (const { s } of abSamples()) samples.push(s);
    for (const s of samples) {
      const tl = build(s.ev, s.ratings);
      const recs = records(tl, s.name, missing);
      const st = new Map(stalkers(tl, s.ev).map((m) => [m.playerId, m] as const));
      for (const m of tl.marks) {
        const r = recs.get(m.playerId);
        if (r === undefined) continue;
        const who = `${s.name} ${m.side}${m.slot}`;
        const W = st.get(m.playerId);
        if (W === undefined) {
          // A named receiver with a stalk route may shadow or not (R9, R7): nothing is asserted of him.
          if (m.side === "O" && tl.involved.includes(m.playerId) && s.ev.offense.formation !== undefined && routeOf(s.ev.offense.formation, leafOf(s.ev), m.slot)?.finish === "stalk") continue;
          if (r.stalkOf !== null) others.push(`${who}: does not stalk, stalkOf is ${show(r.stalkOf)}`);
          if ((r.stalkLagMs ?? null) !== null) others.push(`${who}: does not stalk, stalkLagMs is ${show(r.stalkLagMs)}`);
          continue;
        }
        const D = nearestDb(tl, W);
        // R9: a named defender is released, so the pairing is asserted on unnamed ones.
        if (!unnamed(tl, D)) continue;
        seen[W.position as "WR" | "TE"]++;
        if (r.stalkOf !== D.playerId) of.push(`${who}: stalkOf ${show(r.stalkOf)}, the nearest is ${D.slot} (${D.playerId})`);
        const want = motion.stalk.lagMs + band(["stalk", "lagMs"], s.ratings, m.playerId, W.position === "TE" ? "runBlock" : "awareness");
        if (!near(r.stalkLagMs, want)) lag.push(`${who}: stalkLagMs ${show(r.stalkLagMs)}, PR7 says ${want.toFixed(3)}`);
      }
    }
    expectNone({ "no record": missing, stalkOf: of, stalkLagMs: lag, "marks that stalk nobody": others, "stalking WR read": seen.WR > 100 ? [] : [`${seen.WR}, under 100`], "stalking TE read": seen.TE > 5 ? [] : [`${seen.TE}, under 5`] });
  });

  it("biteShare: on play action every linebacker and safety who takes the read step has his awareness band; on another pass nobody has one", { timeout: 120_000 }, () => {
    const missing: string[] = [];
    const bite: string[] = [];
    const others: string[] = [];
    let n = 0;
    for (const f of FORMATIONS)
      for (const preset of PRESETS.filter((p) => templates.presetDrops[p] !== "blitz" && !runFront(p))) {
        const ev = passEv(f, "playAction", preset);
        const ratings = tableRatings(ev);
        const tl = build(ev, ratings);
        const recs = records(tl, `${f} ${preset}`, missing);
        for (const m of tl.marks) {
          const r = recs.get(m.playerId);
          if (r === undefined || !unnamed(tl, m)) continue;
          if (m.side === "X" && (m.position === "LB" || m.position === "S")) {
            n++;
            const want = band(["biteShare"], ratings, m.playerId, "awareness");
            if (!near(r.biteShare, want)) bite.push(`${f} ${preset} ${m.slot}: biteShare ${show(r.biteShare)}, his band is ${want.toFixed(3)}`);
          } else if ((r.biteShare ?? null) !== null) others.push(`${f} ${preset} ${m.side}${m.slot}: biteShare ${show(r.biteShare)}`);
        }
      }
    const plain = passEv("shotgun", "shortPass", "nickelCover3");
    for (const m of build(plain, tableRatings(plain)).marks) if ((reactOf(m).biteShare ?? null) !== null) others.push(`shortPass ${m.side}${m.slot}: biteShare ${show(reactOf(m).biteShare)}`);
    expectNone({ "no record": missing, biteShare: bite, "marks with no bite": others, "biting defenders read": n > 60 ? [] : [`${n}, under 60`] });
  });

  it("breakPaceShare: routeRunning's band for a WR or TE on a route, agility's for an RB on a route and for a CB who pedals", { timeout: 120_000 }, () => {
    const missing: string[] = [];
    const share: string[] = [];
    const seen = { WR: 0, TE: 0, RB: 0, CB: 0 };
    for (const f of FORMATIONS)
      for (const call of ["shortPass", "intermediatePass", "deepPass"]) {
        const ev = passEv(f, call, "nickelCover3");
        const ratings = tableRatings(ev);
        const tl = build(ev, ratings);
        const recs = records(tl, `${f} ${call}`, missing);
        for (const m of tl.marks) {
          const r = recs.get(m.playerId);
          if (r === undefined || !unnamed(tl, m) || !["WR", "TE", "RB", "CB"].includes(m.position) || (m.side === "X") !== (m.position === "CB")) continue;
          seen[m.position as keyof typeof seen]++;
          const want = band(["breakPaceShare"], ratings, m.playerId, m.position === "WR" || m.position === "TE" ? "routeRunning" : "agility");
          if (!near(r.breakPaceShare, want)) share.push(`${f} ${call} ${m.side}${m.slot}: breakPaceShare ${show(r.breakPaceShare)}, his band is ${want.toFixed(3)}`);
          if (Math.abs(r.breakPaceShare ?? 0) > 0.3 + 1e-9) share.push(`${f} ${call} ${m.side}${m.slot}: breakPaceShare ${show(r.breakPaceShare)} outside 0.3`);
        }
      }
    expectNone({ "no record": missing, breakPaceShare: share, "marks read": Object.entries(seen).filter(([, n]) => n < 5).map(([pos, n]) => `${pos}: ${n}, under 5`) });
  });

  it("States: a rating outside 40 to 90 is the band's end; a rating an effect lacks adds 0 to that effect; the lag's floor holds; a TE's stalk reads runBlock and not awareness, a WR's break pace routeRunning and not agility", () => {
    const bad: string[] = [];
    const ev = passEv("shotgun", "intermediatePass", "nickel2Man");
    const base = tableRatings(ev);
    const tl0 = build(ev, base);
    const pair = manPairs(tl0, ev).find((p) => unnamed(tl0, p.D) && unnamed(tl0, p.R) && p.D.position === "CB" && p.R.position === "WR");
    if (pair === undefined) throw new Error("no unnamed corner on an unnamed receiver");
    const D = pair.D.playerId;
    const R = pair.R.playerId;
    const get = (ratings: Ratings, id: string): React => reactOf(markOf(build(ev, ratings), id));
    const same = (what: string, a: number | undefined, b: number | undefined): void => {
      if (a === undefined || b === undefined || Math.abs(a - b) > 1e-6) bad.push(`${what}: ${show(a)} against ${show(b)}`);
    };
    for (const [out, end] of [[20, 40], [99, 90]] as const) {
      same(`manLagMs at coverage ${out} and ${end}`, get(withRating(base, D, "coverage", out), D).manLagMs, get(withRating(base, D, "coverage", end), D).manLagMs);
      same(`cushionYards at speed ${out} and ${end}`, get(withRating(base, D, "speed", out), D).cushionYards, get(withRating(base, D, "speed", end), D).cushionYards);
      same(`breakPaceShare at routeRunning ${out} and ${end}`, get(withRating(base, R, "routeRunning", out), R).breakPaceShare, get(withRating(base, R, "routeRunning", end), R).breakPaceShare);
    }
    const without = (id: string, name: string): Ratings => ({ ...base, [id]: Object.fromEntries(Object.entries(base[id] ?? {}).filter(([k]) => k !== name)) });
    same("manLagMs with no coverage", get(without(D, "coverage"), D).manLagMs, Math.max(40, 150 + band(["man", "receiverLagMs"], base, R, "routeRunning")));
    same("manLagMs with no routeRunning on his receiver", get(without(R, "routeRunning"), D).manLagMs, Math.max(40, 150 + band(["man", "lagMs"], base, D, "coverage")));
    same("cushionYards with no speed", get(without(D, "speed"), D).cushionYards, 1.5);
    // 150 - 110 - 80 = -40 is under man.minLagMs (the bands Joseph approved on 2026-11-24).
    same("manLagMs at coverage 90 against routeRunning 40 (the floor)", get(withRating(withRating(base, D, "coverage", 90), R, "routeRunning", 40), D).manLagMs, 40);
    same("manLagMs at coverage 40 against routeRunning 90", get(withRating(withRating(base, D, "coverage", 40), R, "routeRunning", 90), D).manLagMs, 630);
    same("a WR's breakPaceShare at agility 40 and 90", get(withRating(base, R, "agility", 40), R).breakPaceShare, get(withRating(base, R, "agility", 90), R).breakPaceShare);
    same("a CB's breakPaceShare at coverage 40 and 90", get(withRating(base, D, "coverage", 40), D).breakPaceShare, get(withRating(base, D, "coverage", 90), D).breakPaceShare);
    // A stalking TE: the first screen formation that has one.
    let te: string | null = null;
    for (const f of FORMATIONS) {
      if (te !== null || f === "empty") continue;
      const sc = passEv(f, "screenPass", "nickelCover3", { parts: { passer: "O-QB1", target: "O-RB1", receiver: "O-RB1" } });
      const sr = tableRatings(sc);
      const m = stalkers(build(sc, sr), sc).find((x) => x.position === "TE");
      if (m === undefined) continue;
      te = m.playerId;
      const lagAt = (name: string, v: number): number | undefined => reactOf(markOf(build(sc, withRating(sr, m.playerId, name, v)), m.playerId)).stalkLagMs;
      same("a TE's stalkLagMs at awareness 40 and 90", lagAt("awareness", 40), lagAt("awareness", 90));
      same("a TE's stalkLagMs at runBlock 40", lagAt("runBlock", 40), 300);
      same("a TE's stalkLagMs at runBlock 90", lagAt("runBlock", 90), 110);
    }
    if (te === null) bad.push("no formation's screen has a stalking TE");
    expect(bad).toEqual([]);
  });
});

// ================================================================ PR1, the gate (the review of 2026-11-24)

describe("PR1: an entry with no rating an effect reads is drawn as no entry", () => {
  for (const [name, entry] of [["{}", {}], ["{ strength: 70 }, which drives nothing (PR11)", { strength: 70 }]] as const)
    it(`the fixtures and every play of S: every player given ${name} draws the no-ratings Timeline, key for key`, { timeout: 300_000 }, () => {
      const bad: string[] = [];
      let n = 0;
      for (const s of [...FIXTURES, ...S()]) {
        n++;
        const ratings: Ratings = Object.fromEntries(Object.keys(s.ratings).map((id) => [id, entry]));
        if (prDigestOf(build(s.ev, ratings)) !== prDigestOf(build(s.ev))) bad.push(s.name);
      }
      expectNone({ [`plays that differ from no ratings (${bad.length})`]: bad, "plays read": n > 500 ? [] : [`${n}, under 500`] });
    });
});

// ================================================================ PR-C8, the slice 2 fields

describe("PR-C8, slice 2: the new fields know the calls, the ids and the ratings only", () => {
  const FIELDS = ["manLagMs", "cushionYards", "stalkLagMs", "stalkOf", "biteShare", "breakPaceShare"] as const;
  it("events that differ only in target, result or end spot carry identical fields, every mark", { timeout: 120_000 }, () => {
    const bad: string[] = [];
    let compared = 0;
    const present = new Set<string>();
    for (const [f, call, preset] of [
      ["shotgun", "intermediatePass", "nickel2Man"],
      ["pistol", "playAction", "nickelCover1"],
      ["underCenter", "playAction", "baseCover3"],
      ["shotgun", "screenPass", "dimeCover0Blitz"],
      ["empty", "shortPass", "nickelCover1Blitz"],
    ] as const) {
      const variant = (result: "complete" | "incomplete", gain: number, target: string): PlayEvent => mk({ formation: f, call, preset, result, gain, parts: result === "complete" ? { passer: "O-QB1", target, receiver: target } : { passer: "O-QB1", target } });
      const ratings = tableRatings(variant("complete", 12, "O-WR1"));
      const base = build(variant("complete", 12, "O-WR1"), ratings);
      for (const [name, ev] of [["another target", variant("complete", 12, "O-TE1")], ["another end spot", variant("complete", 31, "O-WR1")], ["an incompletion", variant("incomplete", 0, "O-WR1")]] as const) {
        const tl = build(ev, ratings);
        for (const m of base.marks) {
          const a = reactOf(m);
          const b = reactOf(markOf(tl, m.playerId));
          // A named receiver on a stalk route is released for the ball (R7, R9), so his stalk is his own.
          const named = base.involved.includes(m.playerId) || tl.involved.includes(m.playerId);
          for (const k of FIELDS) {
            if (named && (k === "stalkOf" || k === "stalkLagMs")) continue;
            compared++;
            if (a[k] !== undefined && a[k] !== null) present.add(k);
            if (a[k] !== b[k]) bad.push(`${f} ${call} vs ${preset}, ${name}: ${m.side}${m.slot} ${k} ${show(a[k])} against ${show(b[k])}`);
          }
        }
      }
    }
    // Runs: another gain and another tackler, the same play side.
    for (const f of ["shotgun", "pistol"]) {
      const run = (gain: number, tackler: string): PlayEvent => mk({ formation: f, call: "outsideRun", preset: "baseCover3", result: "run", gain, runLocation: "left", parts: { ballCarrier: "O-RB1", tackler } });
      const ratings = tableRatings(run(3, "X-LB2"));
      const a = build(run(3, "X-LB2"), ratings);
      const b = build(run(14, "X-LB3"), ratings);
      for (const m of a.marks)
        for (const k of FIELDS) {
          compared++;
          if (reactOf(m)[k] !== undefined && reactOf(m)[k] !== null) present.add(k);
          if (reactOf(m)[k] !== reactOf(markOf(b, m.playerId))[k]) bad.push(`${f} outsideRun: ${m.side}${m.slot} ${k} ${show(reactOf(m)[k])} against ${show(reactOf(markOf(b, m.playerId))[k])}`);
        }
    }
    expectNone({ "a field differs": bad, "fields never present": FIELDS.filter((k) => !present.has(k)), "values compared": compared > 1000 ? [] : [`${compared}, under 1000`] });
  });
});

// ================================================================ PR-C11

describe("PR-C11: man coverage (A/B on man.lagMs, man presets)", () => {
  interface Gap {
    readonly who: string;
    readonly preset: string;
    readonly position: string;
    readonly d: number;
    readonly back: number;
    readonly behind: number;
  }
  const oldSample = (): { readonly s: Sample; readonly tl: Timeline }[] => abSamples().filter(({ s }) => s.ev.play.kind === "pass");
  /** Every pass of S against a coverage preset with man targets (no run front), each built once at its own ratings. */
  let coverageS: { readonly s: Sample; readonly tl: Timeline }[] | null = null;
  const coverageSample = (): { readonly s: Sample; readonly tl: Timeline }[] => (coverageS ??= S().filter((s) => s.ev.play.kind === "pass" && MAN_PRESETS.includes(s.ev.defense ?? "") && !runFront(s.ev.defense ?? "")).map((s) => ({ s, tl: build(s.ev, s.ratings) })));
  /** The A/B over every man pair whose moved player is unnamed: that player's rating at 40 and at 90. */
  function gaps(samples: readonly { readonly s: Sample; readonly tl: Timeline }[], rating: "coverage" | "routeRunning" | "speed", keep: string, who: "D" | "R", only?: string): { gaps: Gap[]; pairs: number } {
    const ab = abMotionFor(rating, keep);
    const out: Gap[] = [];
    let pairs = 0;
    for (const { s, tl } of samples) {
      for (const { D, R } of manPairs(tl, s.ev)) {
        // The defender is measured on his own assignment, so he is unnamed in every A/B.
        if (!unnamed(tl, D) || (only !== undefined && D.position !== only)) continue;
        const moved = who === "D" ? D : R;
        if (!unnamed(tl, moved) || ratingOf(s.ratings, moved.playerId, rating) === undefined) continue;
        pairs++;
        const lo = build(s.ev, withRating(s.ratings, moved.playerId, rating, LO), ab);
        const hi = build(s.ev, withRating(s.ratings, moved.playerId, rating, HI), ab);
        const g = trailGap(lo, hi, D.playerId, R.playerId, C11.depthYards, C11.minMs);
        if (g !== null) out.push({ who: `${s.name} ${D.slot} on ${R.slot}`, preset: s.ev.defense ?? "", position: D.position, d: g.a - g.b, back: g.backA - g.backB, behind: g.behindA - g.behindB });
      }
    }
    return { gaps: out, pairs };
  }
  /** The reading before 2026-11-24, as information: the plain distance, over the fixtures and every 5th play of S. */
  const reportOld = (label: string, rating: "coverage" | "routeRunning", keep: string, who: "D" | "R", sign: 1 | -1): void => {
    const all = gaps(oldSample(), rating, keep, who).gaps;
    const med = (xs: readonly Gap[]): string => `${xs.length === 0 ? "none" : (sign * median(xs.map((x) => x.d))).toFixed(2)} (${xs.length})`;
    const coverage = all.filter((x) => !runFront(x.preset));
    console.info(`PR-C11 ${label}, the old reading (information only: plain distance, fixtures and every 5th play of S): every man preset ${med(all)} yd; coverage presets only ${med(coverage)}; corners of coverage presets only ${med(coverage.filter((x) => x.position === "CB"))}; runStuff and goalLine ${med(all.filter((x) => runFront(x.preset)))}`);
  };
  const reading = (label: string, g: { gaps: Gap[]; pairs: number }, sign: 1 | -1): number => {
    const m = sign * median(g.gaps.map((x) => x.behind));
    console.info(`PR-C11 ${label}: corners of coverage presets over S, how far behind the receiver along his path, 40 against 90: median ${m.toFixed(2)} yd over ${g.gaps.length} of ${g.pairs} pairs (plain distance ${(sign * median(g.gaps.map((x) => x.d))).toFixed(2)})`);
    return m;
  };

  it("corners in coverage presets, over S: a corner at coverage 40 is further behind his receiver along the receiver's path than at 90, median over pairs at least 0.6 yd", { timeout: 600_000 }, () => {
    const g = gaps(coverageSample(), "coverage", "man.lagMs", "D", "CB");
    const m = reading("coverage", g, 1);
    reportOld("coverage", "coverage", "man.lagMs", "D", 1);
    expectNone({ "pairs with a window of 300 ms or more": g.gaps.length >= C11_PAIRS.coverage ? [] : [`${g.gaps.length} of ${g.pairs}, under ${C11_PAIRS.coverage}`], "median behind at coverage 40 less at 90": m >= C11.coverageYards ? [] : [`${m.toFixed(2)} yd over ${g.gaps.length} pairs, the floor is ${C11.coverageYards}`] });
  });

  it("raising the receiver's routeRunning from 40 to 90 raises it too: median at least 0.3 yd", { timeout: 600_000 }, () => {
    const g = gaps(coverageSample(), "routeRunning", "man.receiverLagMs", "R", "CB");
    const m = reading("routeRunning", g, -1);
    reportOld("routeRunning", "routeRunning", "man.receiverLagMs", "R", -1);
    expectNone({ "pairs with a window of 300 ms or more": g.gaps.length >= C11_PAIRS.routeRunning ? [] : [`${g.gaps.length} of ${g.pairs}, under ${C11_PAIRS.routeRunning}`], "median behind at routeRunning 90 less at 40": m >= C11.routeRunningYards ? [] : [`${m.toFixed(2)} yd over ${g.gaps.length} pairs, the floor is ${C11.routeRunningYards}`] });
  });

  // PR7, not a criterion of its own: "Man cushion = today's + the defender's speed band. A slow
  // defender gives ground." No floor is given, so the direction is what is held.
  it("PR7, the cushion (A/B on man.cushionYards): a defender at speed 40 is deeper past his receiver than at 90 on the median pair", { timeout: 600_000 }, () => {
    const g = gaps(oldSample(), "speed", "man.cushionYards", "D");
    const m = median(g.gaps.map((x) => x.back));
    console.info(`PR7 cushion: median depth given at speed 40 against 90, ${m.toFixed(2)} yd over ${g.gaps.length} of ${g.pairs} pairs`);
    expectNone({ "pairs with a window of 300 ms or more": g.gaps.length >= 8 ? [] : [`${g.gaps.length} of ${g.pairs}, under 8`], "median depth past his receiver at speed 40 less at 90": m > 0 ? [] : [`${m.toFixed(3)} yd`] });
  });
});

// ================================================================ PR-C12 (a)

describe("PR-C12 (a): the bite on play action (A/B on biteShare)", () => {
  interface Bite {
    readonly who: string;
    readonly preset: string;
    readonly lo: number;
    readonly hi: number;
    /** The largest difference between the two builds along his bite (the run drop sets' measure). */
    readonly gap: number;
  }
  let pass: { bites: Bite[]; stuck: string[] } | null = null;
  function bites(): NonNullable<typeof pass> {
    if (pass !== null) return pass;
    const ab = abMotionFor("awareness", "biteShare");
    const out = { bites: [] as Bite[], stuck: [] as string[] };
    for (const { s, tl } of abSamples()) {
      const f = s.ev.offense.formation;
      if (s.ev.play.kind !== "pass" || leafOf(s.ev) !== "playAction" || f === undefined) continue;
      for (const m of readingLbs(tl, s.ev)) {
        const lo = build(s.ev, withRating(s.ratings, m.playerId, "awareness", LO), ab);
        const hi = build(s.ev, withRating(s.ratings, m.playerId, "awareness", HI), ab);
        const who = `${s.name} vs ${s.ev.defense ?? ""} ${m.slot}`;
        out.bites.push({ who, preset: s.ev.defense ?? "", lo: biteYards(lo, markOf(lo, m.playerId), f, C12A.firstMs), hi: biteYards(hi, markOf(hi, m.playerId), f, C12A.firstMs), gap: biteGapYards(lo, hi, m.playerId, f, C12A.firstMs) });
        for (const [a, b] of [[LO, lo], [HI, hi]] as const) {
          const bad = notRecovering(b, s.ev, markOf(b, m.playerId), C12A.withinYards, C12A.lastMs);
          if (bad !== null) out.stuck.push(`${who} at awareness ${a}: ${bad}`);
        }
      }
    }
    const diffs = out.bites.map((x) => x.lo - x.hi);
    console.info(`PR-C12 (a): ${out.bites.length} linebackers; bite at 40 less at 90, min ${Math.min(...diffs).toFixed(2)}, median ${median(diffs).toFixed(2)} yd; ${out.stuck.length} of ${2 * out.bites.length} builds not recovering`);
    pass = out;
    return out;
  }
  const short = (xs: readonly Bite[]): string[] => xs.filter((x) => x.lo - x.hi < C12A.biteYards).map((x) => `${x.who}: ${x.lo.toFixed(2)} yd at 40, ${x.hi.toFixed(2)} at 90`);

  it("every non-rushing LB of a coverage drop set: his greatest displacement along his bite in the first 900 ms is larger at awareness 40 than at 90 by at least 0.8 yd", { timeout: 600_000 }, () => {
    const xs = bites().bites.filter((x) => !runFront(x.preset));
    expectNone({ "under 0.8 yd": short(xs), "linebackers read": xs.length >= 10 ? [] : [`${xs.length}, under 10`] });
  });

  // The ruling of 2026-11-24: on a run front his drop is downhill too, so his displacement reads the drop
  // as well as the bite. The bite itself is measured, and the floor is the criterion's.
  it("every LB of a run drop set (runStuff, goalLine), whose drop is downhill too: the two builds differ by at least 0.8 yd along his bite at some key of the first 900 ms", { timeout: 600_000 }, () => {
    const xs = bites().bites.filter((x) => runFront(x.preset));
    console.info(`PR-C12 (a), run drop sets, bite at 40 less at 90 along the bite: ${xs.map((x) => `${x.who} ${x.gap.toFixed(2)}`).join("; ")}`);
    expectNone({ "under 0.8 yd": xs.filter((x) => x.gap < C12A.biteYards).map((x) => `${x.who}: ${x.gap.toFixed(2)} yd`), "linebackers read": xs.length >= 5 ? [] : [`${xs.length}, under 5`] });
  });

  it("at the throw he is within 3 yd of his assignment point, or moving toward it over the last 200 ms (both builds)", { timeout: 600_000 }, () => {
    const p = bites();
    expectNone({ "neither recovered nor recovering": p.stuck, "linebackers read": p.bites.length >= 15 ? [] : [`${p.bites.length}, under 15`] });
  });
});

describe("PR-C12 (a), monotonic (the review of 2026-11-24): a sharper linebacker never bites deeper", () => {
  // The whole of S (57 plays, 89 linebackers) is in test/game/player-reactions.heavy.test.ts.
  it("a fixed sample (every 6th play-action play of S against a coverage drop set, and seed 5 play 45): from awareness 40 to 90 by 2 his bite never rises by more than 0.02 yd from one step to the next", { timeout: 300_000 }, () => {
    const all = biteSweepPlays();
    const named = all.filter((s) => s.name.startsWith("seed 5 play 45 "));
    const r = biteRises([...new Set([...named, ...all.filter((_, i) => i % 6 === 0)])], C12A.firstMs);
    expectNone({ "a sharper linebacker bites deeper": r.filter((x) => x.rise > C12A.riseYards).map((x) => `${x.who}, awareness ${x.where}`), "seed 5 play 45": named.length === 1 ? [] : ["not in the sample"], "linebackers read": r.length >= 12 ? [] : [`${r.length}, under 12`] });
  });
});

// ================================================================ PR-C12 (b)

describe("PR-C12 (b): the stalk (A/B on stalk.lagMs)", () => {
  it("stalkLagMs at 40 exceeds that at 90 by at least 150 (awareness for a WR, runBlock for a TE), and the lag reaches the drawing on most pairs", { timeout: 600_000 }, () => {
    const ab = { WR: ["awareness", abMotionFor("awareness", "stalk.lagMs")], TE: ["runBlock", abMotionFor("runBlock", "stalk.lagMs")] } as const;
    const flat: string[] = [];
    const moved: string[] = [];
    const n = { WR: 0, TE: 0 };
    let drawn = 0;
    const samples = abSamples().map(({ s, tl }) => ({ name: s.name, ev: s.ev, ratings: s.ratings, tl }));
    // S has few stalking TEs (a screen's s2): the built screens give some.
    for (const f of FORMATIONS.filter((x) => x !== "empty")) {
      const ev = passEv(f, "screenPass", "nickelCover3", { parts: { passer: "O-QB1", target: "O-RB1", receiver: "O-RB1" } });
      const ratings = tableRatings(ev);
      samples.push({ name: `${f} screenPass`, ev, ratings, tl: build(ev, ratings) });
    }
    for (const s of samples)
      for (const W of stalkers(s.tl, s.ev)) {
        if (!unnamed(s.tl, nearestDb(s.tl, W))) continue;
        const pos = W.position as "WR" | "TE";
        n[pos]++;
        const [rating, m] = ab[pos];
        const lo = build(s.ev, withRating(s.ratings, W.playerId, rating, LO), m);
        const hi = build(s.ev, withRating(s.ratings, W.playerId, rating, HI), m);
        const a = reactOf(markOf(lo, W.playerId)).stalkLagMs;
        const b = reactOf(markOf(hi, W.playerId)).stalkLagMs;
        if (a === undefined || b === undefined || !(a - b >= C12B.lagGapMs)) flat.push(`${s.name} ${W.slot}: stalkLagMs ${show(a)} at 40, ${show(b)} at 90`);
        if (firstDiff(markOf(lo, W.playerId).keys, markOf(hi, W.playerId).keys, lo.snapAt, lo.liveEnd, KEY, 0.1) !== null) drawn++;
        // One receiver's block moves nobody else (PR-C3's rule, for this rating), on a run.
        if (s.ev.play.kind === "run") for (const x of lo.marks) if (x.playerId !== W.playerId && firstDiff(x.keys, markOf(hi, x.playerId).keys, 0, lo.total, KEY) !== null) moved.push(`${s.name}: ${x.side}${x.slot} moves when only ${W.slot}'s ${rating} changes`);
      }
    const all = n.WR + n.TE;
    expectNone({
      "stalkLagMs at 40 less at 90, under 150": flat,
      // PR7, not a criterion's number: the lag is drawn. On most pairs some key differs by more than 0.1 yd.
      "pairs drawn differently at 40 and 90": drawn * 2 > all ? [] : [`${drawn} of ${all}`],
      "one receiver's rating moves another mark": moved,
      "stalking WR read": n.WR > 50 ? [] : [`${n.WR}, under 50`],
      "stalking TE read": n.TE >= 1 ? [] : ["none"],
    });
  });

  // PR7: the lock on his man (the review and the ruling of 2026-11-24). The defect is a worse blocker
  // who moves exactly with his man while the better one does not. The lock is the first key from which
  // his offset from his man stays within 0.01 yd to the settle (stalkLock in the checks file), found on
  // the keys of the build before natural motion, where a lock is exact: the wobble drawn on top of two
  // men moves their offset by more than that. Whether the better blocker is with his man at that key is
  // read on the drawn keys. One fails when the worse blocker locks first (or the better never does) and
  // the better one is then off his man's velocity by more than 1.0 yd/s. Two men both running with
  // their man, one easing in, is not the defect. The counts of the first version of this test ("first",
  // "alone", "steadier") are printed. Known and left red: seed 1 play 155 WR3.
  it("unnamed WR stalkers on the runs of S, at awareness 40, 65 and 90 (other awareness bands zeroed): the worse blocker never locks on his man while the better one is off his man's velocity by more than 1.0 yd/s", { timeout: 600_000 }, () => {
    const raw = stalkLocks(false);
    const drawn = stalkLocks(true);
    const bad: string[] = [];
    const old = { first: 0, alone: 0, steadier: 0 };
    const far = { all: 0, allOf: 0, outside: 0, outsideOf: 0 };
    raw.forEach((x, n) => {
      const y = drawn[n] as (typeof drawn)[number];
      for (const [i, j] of [[0, 1], [1, 2], [0, 2]] as const) {
        const lo = x.at[i] as (typeof x.at)[number];
        const hi = x.at[j] as (typeof x.at)[number];
        const first = lo.lock !== null && hi.lock !== null && lo.lock < hi.lock - 1e-6;
        const alone = lo.lock !== null && hi.lock === null;
        if (first) old.first++;
        if (alone) old.alone++;
        if (first || alone) {
          const at0 = lo.lock as number;
          const key = (y.at[j] as (typeof y.at)[number]).gaps.find((g) => Math.abs(g.t - at0) < 1e-6);
          if (key !== undefined && key.rel > LOCK_OFF_YPS) bad.push(`${x.who}, ${LOCK_AWARENESS[i] ?? ""} against ${LOCK_AWARENESS[j] ?? ""}: locks at ${at0.toFixed(0)} against ${hi.lock === null ? "never" : hi.lock.toFixed(0)} ms (the settle is at ${lo.end.toFixed(0)}); the better is then ${key.rel.toFixed(2)} yd/s off his man, ${key.d.toFixed(2)} yd away`);
        }
        const from = Math.min(lo.lock ?? Infinity, hi.lock ?? Infinity);
        const spread = (l: typeof lo): number => {
          const ds = l.gaps.filter((g) => g.t >= from - 1e-9 && g.t <= Math.min(lo.end, hi.end) + 1e-9).map((g) => g.d);
          return ds.length === 0 ? 0 : Math.max(...ds) - Math.min(...ds);
        };
        if (from < Infinity && spread(lo) < spread(hi) - 0.02) old.steadier++;
        // Information only, no bar: at 1,500 ms, is the better blocker over 0.1 yd farther from his man?
        const a = lo.gaps.find((g) => Math.abs(g.t - 1500) < 1e-6);
        const b = hi.gaps.find((g) => Math.abs(g.t - 1500) < 1e-6);
        if (a !== undefined && b !== undefined) {
          const worse = b.d > a.d + 0.1 ? 1 : 0;
          far.allOf++;
          far.all += worse;
          if (x.who.includes(" outsideRun ")) {
            far.outsideOf++;
            far.outside += worse;
          }
        }
      }
    });
    const count = (xs: typeof raw): string => {
      const three = xs.filter((x) => x.at.every((l) => l.lock !== null));
      const early = three.filter((x) => (x.at[0]?.lock as number) < (x.at[2]?.lock as number) - 1e-6);
      return `${[0, 1, 2].map((i) => xs.filter((x) => x.at[i]?.lock !== null).length).join(" / ")} of ${xs.length} lock at 40 / 65 / 90; ${three.length} at all three, the 40 before the 90 in ${early.length}`;
    };
    console.info(`PR-C12 (b), the lock: ${bad.length} of ${3 * raw.length} comparisons fail. Information only: ${count(raw)}; worse blocker first ${old.first}, alone ${old.alone}, steadier ${old.steadier}; found on the drawn keys, ${count(drawn)}`);
    console.info(`PR-C12 (b), the gap at 1,500 ms (information only, no bar): the better blocker is over 0.1 yd farther from his man on ${far.outside} of ${far.outsideOf} comparisons on outside runs, ${far.all} of ${far.allOf} on all runs (slice2b, before the closing lock: 46 of 657 and 62 of 880)`);
    expectNone({ [`the worse blocker locks while the better is off his man (${bad.length})`]: bad, "stalking pairs read": raw.length > 400 ? [] : [`${raw.length}, under 400`] });
  });

  /**
   * The (formation, run, side, receiver) stalks that already missed R-C8's hold on the tree before the
   * build, at stalk.lagMs 150 and the same ratings (captured 2026-11-24, timeline.ts sha256 f8474557...).
   * The standing-checks rule: these may miss it, every other stalk must hold. Nobody adds one to make a build pass.
   */
  const RC8_RED_BEFORE: Readonly<Record<string, readonly string[]>> = {
    "the table": [],
    "every WR at awareness 40": [],
    "every WR at awareness 90": ["shotgun insideRun right WR1 ", "pistol insideRun right WR1 "],
  };
  const at40or90 = (a: number) => (ev: PlayEvent): Ratings => Object.fromEntries(Object.entries(tableRatings(ev)).map(([id, r]) => [id, id.startsWith("O-WR") ? { ...r, awareness: a } : r]));
  for (const [name, ratingsOf] of [["the table", tableRatings], ["every WR at awareness 40", at40or90(LO)], ["every WR at awareness 90", at40or90(HI)]] as const)
    it(`R-C8's hold and approach with his own lag in B, ${name}: every stalk that held before the build holds, and he closes on 80% of the longer plays`, { timeout: 300_000 }, () => {
      const r = rc8Stalk(ratingsOf);
      console.info(`PR-C12 (b), R-C8, ${name}: ${r.bad.length} of ${r.windows} windows miss the hold or the release, closed on ${r.closed} of ${r.longPlays} longer plays`);
      const known = RC8_RED_BEFORE[name] as readonly string[];
      expectNone({
        "misses the hold or the release": r.bad.filter((line) => !known.some((k) => line.startsWith(k))),
        "share of longer plays closed on": r.closed / r.longPlays >= RC8_CLOSED ? [] : [`${r.closed} of ${r.longPlays}`],
        "windows and longer plays": r.windows > 10 && r.longPlays > 10 ? [] : [`${r.windows}, ${r.longPlays}`],
      });
    });
});

// ================================================================ PR-C12 (c), PR8

describe("PR-C12 (c) and PR8: the break (A/B on breakPaceShare)", () => {
  it("first sharp break of an unnamed WR: the apex speed over his own top is at least 0.08 higher at routeRunning 90 than at 40, on the same polyline within 0.1 yd", { timeout: 600_000 }, () => {
    const ab = abMotionFor("routeRunning", "breakPaceShare");
    const slow: string[] = [];
    const bent: string[] = [];
    const gains: number[] = [];
    for (const { s, tl } of abSamples()) {
      const f = s.ev.offense.formation;
      if (s.ev.play.kind !== "pass" || f === undefined) continue;
      for (const m of tl.marks) {
        if (m.side !== "O" || m.position !== "WR" || !unnamed(tl, m)) continue;
        const route = routeOf(f, leafOf(s.ev), m.slot);
        // Only a break he passes before the throw: skip the A/B when he has none at his own ratings.
        if (route === undefined || route.finish === "stalk" || firstSharpApex(tl, m, f, route, specRead(tl)) === null) continue;
        const lo = build(s.ev, withRating(s.ratings, m.playerId, "routeRunning", LO), ab);
        const hi = build(s.ev, withRating(s.ratings, m.playerId, "routeRunning", HI), ab);
        const a = firstSharpApex(lo, markOf(lo, m.playerId), f, route, specRead(lo));
        const b = firstSharpApex(hi, markOf(hi, m.playerId), f, route, specRead(hi));
        if (a === null || b === null) continue;
        const who = `${s.name} ${f} ${m.slot} (${a.turn.toFixed(0)} deg)`;
        gains.push(b.share - a.share);
        if (b.share - a.share < C12C.apexShare) slow.push(`${who}: apex ${a.share.toFixed(3)} of his top at 40, ${b.share.toFixed(3)} at 90`);
        const gap = pathGap(markOf(lo, m.playerId).keys, specRead(lo), markOf(hi, m.playerId).keys, specRead(hi), lo.snapAt);
        if (gap > C12C.pathYards) bent.push(`${who}: the two paths are ${gap.toFixed(2)} yd apart`);
      }
    }
    console.info(`PR-C12 (c): ${gains.length} first sharp breaks; apex share gained from 40 to 90, min ${Math.min(...gains).toFixed(3)}, median ${median(gains).toFixed(3)}`);
    expectNone({ "apex share gained, under 0.08": slow, "a changed route shape": bent, "first sharp breaks read": gains.length >= 10 ? [] : [`${gains.length}, under 10`] });
  });

  const all = (v: number | null) => (ev: PlayEvent): Ratings => (v === null ? tableRatings(ev) : Object.fromEntries(Object.entries(tableRatings(ev)).map(([id, r]) => [id, r["routeRunning"] === undefined ? r : { ...r, routeRunning: v }])));
  for (const [name, ratingsOf] of [["the table", all(null)], ["every receiver at routeRunning 40", all(LO)], ["every receiver at routeRunning 90", all(HI)]] as const)
    it(`R-C6 passes with his own pace, ${name}: every receiver break of every formation and pass class`, { timeout: 300_000 }, () => {
      const bad: string[] = [];
      const shares = new Set<string>();
      let n = 0;
      for (const f of FORMATIONS)
        for (const leaf of PASS) {
          const ev = mk({ formation: f, call: leaf, preset: "nickelCover3", result: "complete", gain: 5, airYards: -30, parts: { passer: "O-QB1" } });
          const tl = build(ev, ratingsOf(ev), longMotion());
          for (const m of tl.marks.filter((x) => x.side === "O" && (x.position === "WR" || x.position === "TE"))) {
            const route = routeOf(f, leaf, m.slot);
            if (route === undefined) continue;
            n++;
            // A stalk is one straight release: no break, so no share need be recorded.
            if (route.finish !== "stalk") shares.add((reactOf(m).breakPaceShare ?? NaN).toFixed(3));
            const { pts, rests } = routeLine(tl, m, f, route);
            bad.push(...rc6(`${f} ${leaf} ${m.slot}`, m, tl.snapAt, tl.read, pts, rests, route.finish));
          }
        }
      expectNone({ "R-C6 with his own pace": bad, "routes read": n > 80 ? [] : [`${n}, under 80`], "no breakPaceShare": shares.has("NaN") ? ["a receiver on a route has none"] : [] });
    });

  // PR8, not a criterion: "agility for everyone else, defenders coming out of a pedal included". With
  // every other band agility reads at 0, any difference before the throw is his break pace.
  it("PR8: an unnamed corner with a zone landmark comes out of his pedal differently at agility 90 than at 40 (A/B on breakPaceShare), on most pairs, and nobody else moves before the throw", { timeout: 600_000 }, () => {
    const ab = abMotionFor("agility", "breakPaceShare");
    const moved: string[] = [];
    let pairs = 0;
    let differ = 0;
    for (const { s, tl } of abSamples()) {
      if (s.ev.play.kind !== "pass" || pairs >= 40) continue;
      for (const m of tl.marks) {
        if (m.side !== "X" || m.position !== "CB" || !unnamed(tl, m) || templates.zones[s.ev.defense ?? ""]?.[m.slot] === undefined) continue;
        pairs++;
        const lo = build(s.ev, withRating(s.ratings, m.playerId, "agility", LO), ab);
        const hi = build(s.ev, withRating(s.ratings, m.playerId, "agility", HI), ab);
        const throwT = Math.min(flightOf(lo)?.start ?? lo.read, flightOf(hi)?.start ?? hi.read);
        if (firstDiff(markOf(lo, m.playerId).keys, markOf(hi, m.playerId).keys, lo.snapAt, throwT, KEY, 0.1) !== null) differ++;
        for (const x of lo.marks) if (x.playerId !== m.playerId && firstDiff(x.keys, markOf(hi, x.playerId).keys, lo.snapAt, throwT, KEY) !== null) moved.push(`${s.name}: ${x.side}${x.slot} moves before the throw when only ${m.slot}'s agility changes`);
      }
    }
    expectNone({ "pairs whose corner differs by 0.1 yd or more before the throw": differ * 2 > pairs ? [] : [`${differ} of ${pairs}`], "one corner's rating moves another mark": moved, "pairs read": pairs >= 20 ? [] : [`${pairs}, under 20`] });
  });
});
