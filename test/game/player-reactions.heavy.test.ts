// PR-C10's heavy run (docs/specs/m2-player-reactions.md): "The heavy suite runs N1 to N5 and A3
// over 1,000 simulated plays with ratings and reports to PERF.md." Written by test-writer from the
// spec. It lives in `pnpm test:heavy` with the other sweeps.
//
// The criterion sets no bar for this run, and N1, N3, N4 and N5 were already failing on the
// fixtures with no ratings on the tree this build started from (natural-motion.spec.test.ts), so
// this file measures and prints, with ratings and with none, and holds only that the run happened.
// The lines it prints are the ones for docs/PERF.md. A bar, once the spec gives one, goes here as
// a constant.
//
// The plays: every run, pass and sack of simGame(seed) from seed 101 on, until 1,000 are drawn,
// each with the ratings the app passes (card ratings and skills, before the home-field shift).
//
//   ./node_modules/.bin/vitest run --config vitest.heavy.config.ts test/game/player-reactions.heavy.test.ts
//   (PLAYER_REACTIONS_PLAYS=200 for a quick look; the run the spec names is the default 1,000.)

import { describe, expect, it } from "vitest";
import { AWARENESS_SWEEP, biteRises, biteSweepPlays, build, dlReleaseRises, isLive, motion, n1, n3, n4, n5Engaged, n5Moving, peakCheck, rc19Rated, ring, S, type Built, type Ratings } from "../../packages/app/test/player-reactions.checks";
import { simGame } from "../../packages/app/test/sim-games";

const PLAYS = Number(process.env["PLAYER_REACTIONS_PLAYS"] ?? 1000);
const CHECKS = ["N1", "N3", "N4", "N5 moving", "N5 engaged, M6, nobody wins", "A3 ring"] as const;

describe("PR-C10, heavy: N1 to N5 and A3 over 1,000 simulated plays, with ratings and with none", () => {
  it(`${PLAYS} run, pass and sack plays: the share of plays with no mark breaking each check, printed for PERF.md`, { timeout: 900_000 }, () => {
    const broken: Record<string, { rated: number; unrated: number; first: string }> = Object.fromEntries(CHECKS.map((c) => [c, { rated: 0, unrated: 0, first: "" }]));
    let plays = 0;
    let games = 0;
    for (let seed = 101; plays < PLAYS && seed < 101 + 60; seed++) {
      const g = simGame(seed);
      games++;
      const ratings: Ratings = Object.fromEntries([...g.matchup.home.pool.players, ...g.matchup.away.pool.players].map((p) => [p.id, { ...p.ratings, ...p.skills }]));
      for (const [i, ev] of g.plays.entries()) {
        if (plays >= PLAYS) break;
        if (ev.play.kind !== "run" && ev.play.kind !== "pass" && ev.play.kind !== "sack") continue;
        const name = `seed ${seed} play ${i + 1} ${ev.play.kind} ${ev.offense.call}`;
        let live = true;
        for (const withRatings of [true, false]) {
          const r = withRatings ? ratings : undefined;
          const b: Built = { name, ev, tl: build(ev, r) };
          if (!isLive(b)) {
            live = false;
            break;
          }
          // The line's "nobody wins" clause needs the raw build: every 5th play.
          const raw = plays % 5 === 0 ? build(ev, r, motion, { natural: false }) : null;
          const results: Record<(typeof CHECKS)[number], string[]> = { N1: n1(b), N3: n3(b).bad, N4: n4(b), "N5 moving": n5Moving(b), "N5 engaged, M6, nobody wins": n5Engaged(b, raw).bad, "A3 ring": ring(b) };
          for (const c of CHECKS) {
            if (results[c].length === 0) continue;
            const t = broken[c] as { rated: number; unrated: number; first: string };
            if (withRatings) {
              t.rated++;
              if (t.first === "") t.first = results[c][0] as string;
            } else t.unrated++;
          }
        }
        if (live) plays++;
      }
    }
    const pct = (n: number): string => `${((100 * (plays - n)) / plays).toFixed(1)}%`;
    console.log(
      [
        `PR-C10 heavy run, ${plays} run, pass and sack plays of ${games} simulated games (seeds 101 on), 1x. Share of plays on which no mark breaks the check:`,
        ...CHECKS.map((c) => {
          const t = broken[c] as { rated: number; unrated: number; first: string };
          return `  ${c}: ${pct(t.rated)} with ratings, ${pct(t.unrated)} with none${t.first === "" ? "" : ` (first with ratings: ${t.first})`}`;
        }),
      ].join("\n"),
    );
    expect(plays).toBe(PLAYS);
  });
});

// Moved here from the default run on 2026-11-24 to cut its time: PR-C8's R-C19 with ratings over
// the whole product (every formation, pass class and target against all three presets). The
// default run keeps every formation, class and target, each against one preset in turn. This one
// is held, not only reported: R-C19 passed on the tree the build started from.
describe("PR-C8, heavy: R-C19 with ratings over every formation x pass class x target x preset", () => {
  it("on every built incompletion the target stays within 0.1 yd of his template track to the whistle (reachYards + 0.1 in the reach window)", { timeout: 900_000 }, () => {
    const r = rc19Rated(true);
    console.log(`PR-C8 heavy, R-C19 with ratings: ${r.n} incompletions compared, ${r.bad.length} off the template track`);
    expect(r.bad).toEqual([]);
    expect(r.n).toBeGreaterThan(50);
  });
});

// Added 2026-11-24 (after the round 3 review): the wider sample of the DL release sweep. The default
// run takes every 55th play of S and three plays a 15-point step missed. This one is held.
describe("PR3 round 3, heavy: a DL's release never comes later as his awareness rises", () => {
  it("every 4th play of S: each unnamed DL at awareness 40 to 90 by 2", { timeout: 900_000 }, () => {
    const r = dlReleaseRises(S().filter((_, i) => i % 4 === 0), AWARENESS_SWEEP);
    console.log(`PR3 heavy, DL release sweep: ${r.linemen} unnamed DL, ${r.later.length} rises`);
    expect(r.later.slice(0, 30)).toEqual([]);
    expect(r.linemen).toBeGreaterThan(300);
  });
});

// Added 2026-11-24 (the slice 2 review): the bite sweep over every play-action play of S against a
// coverage drop set. The default run takes every 6th and seed 5 play 45. This one is held.
describe("PR-C12 (a), heavy: a sharper linebacker never bites deeper", () => {
  it("every reading LB of S in a coverage drop set, awareness 40 to 90 by 2: his bite never rises by more than 0.02 yd from one step to the next", { timeout: 900_000 }, () => {
    const r = biteRises(biteSweepPlays(), 900);
    const bad = r.filter((x) => x.rise > 0.02).sort((a, b) => b.rise - a.rise);
    console.log(`PR-C12 (a) heavy, bite sweep: ${r.length} linebackers, ${bad.length} rise by more than 0.02 yd, ${r.filter((x) => x.rise > 0.05).length} by more than 0.05; the worst ${bad[0]?.who ?? ""} ${(bad[0]?.rise ?? 0).toFixed(3)}`);
    expect(bad.map((x) => `${x.who}, awareness ${x.where}`)).toEqual([]);
    expect(r.length).toBeGreaterThan(70);
  });
});

// Added 2026-11-24 (the slice 2 review): per-mark peak speed over seeds 1 to 12 (the default run has 1 to 3).
describe("PR-C10, heavy, per mark: nobody is drawn far faster than before the build", () => {
  it("every unnamed mark and every tackler, seeds 1 to 12: at most 1.5 x his top, or 1.10 x the same mark's peak before the build", { timeout: 900_000 }, () => {
    const r = peakCheck([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    console.log([`PR-C10 heavy, per mark: ${r.read} marks read; over the bar ${r.over.offense.length} offense, ${r.over.defense.length} defense, ${r.over.tackler.length} tackler. The worst of each:`, ...(["offense", "defense", "tackler"] as const).flatMap((g) => r.over[g].slice(0, 10).map((l) => `  ${g}: ${l}`))].join("\n"));
    expect({ offense: r.over.offense.length, defense: r.over.defense.length, tackler: r.over.tackler.length, otherGames: r.otherGames }).toEqual({ offense: 0, defense: 0, tackler: 0, otherGames: [] });
    expect(r.read).toBeGreaterThan(20000);
  });
});
