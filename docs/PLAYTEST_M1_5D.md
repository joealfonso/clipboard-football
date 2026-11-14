# M1 step 5d playtest (gate H3)

Date: 2026-11-14. Playtester run, headless only. No source, data or test edited. No calibration run and no holdout run (`--target holdout` was not touched).

## What was run

- Commit: `01d55d1` on `m1/full-game`, clean tree.
- CLI: `pnpm sim:game -- --seed <n> --league-seed <n> --game-type regular|postseason [--format json]`, run as `node --import ./scripts/engine/register.mjs scripts/game/sim-game.ts ...` (the body of the `sim:game` script) with `npm_config_cache=$TMPDIR/npm`. `npx -y pnpm@10.34.9` needs the npm registry, which the sandbox blocks, so I called node directly. In "ev N" below, N is an index into `events` in the `--format json` record. In the text output, event N is on line N + 7.
- Same seed twice is byte-identical (league 2026 seed 93, `cmp`).
- Seeds read as text, Q4 and OT closely: the seven H3 repros (league 7 seed 11; league 2026 seeds 3, 26, 229, 107, 4; postseason league 4242 seed 6537), plus seeds the soak flagged (league 2026 seeds 13, 14, 50, 257, 445, 743; league 99 seed 543; postseason league 4242 seed 727).
- Soak: an in-process driver in the session scratchpad (`soak3.ts`, built from last time's `soak2.ts`) that calls `leagueFromSeed`, `setupGame`, `playGame`, `boxScore` and `renderGame` the way `sim-game.ts` does. It counts the 5c checks with `measureChecks` from scripts/game/checks5c.ts, the 5d checks with `measure5d` from scripts/game/checks5d.ts, last time's probes, and new probes for end-of-half play, two-minute drills, late field goals and overtime.
  - Regular season: leagues 2026, 7, 99 and 31337, seeds 1-1,000 each (4,000 games). Also run one league at a time for the league-seed spread.
  - Postseason: league 4242, seeds 1-10,000.
- Before and after: the same driver on the 5c build (`git archive 4f25b28` unpacked in the scratchpad, workspace `node_modules` linked), same 4,000 regular-season and 10,000 postseason games. In the tables, "5c" means that build. `measure5d` reads only events, so it runs on both builds.
- Real comparisons: nflverse play by play, 2016-2023 regular season (2,095 games), from the scratchpad extract `rows1623.parquet` (seasons checked: 2016-2023 only), read with `pipeline/.venv/bin/python` and polars. Real 5d check counts are from data/game/checks5d.real.json and data/game/checks5c.real.json. I read no 2024-2025 rows.
- Speed: 4,000 regular-season games with rendering and all probes took 36 s with four soaks running at once (about 9 ms a game). 10,000 postseason games took 85-110 s.

Note: data changed between `4f25b28` and `01d55d1`, so some repro seeds now play different games. The status rests on the soak rates.

## Status of the PLAYTEST_M1_5C findings

| # | Finding | Status | Evidence (4,000 regular-season games unless noted; 5c = `4f25b28`, same games; real = 2016-2023) |
| --- | --- | --- | --- |
| 1 | Trailer with no timeouts barely spikes and lets the clock run in the final minute | Better, still present (accepted miss) | `d.spike.trail0TO` 0.0475 a game (5c 0.0063, real 0.0749). `d.spike.running0TO` 29.4% (190/647; 5c 3.5%, real 33.5%). `d.spike.stopped0TO` 0 of 2,001. `d.gap.trail0TO` 30.1% (317/1,052; 5c 35.7%, real 22.5%); over the final 2:00, 34.8% (5c 39.9%, real 32.2%). Spikes per game, all periods: 0.099 (5c 0.053, real 0.262); Q2 spikes are a 5d non-goal (0.014 a game vs 0.119 real). Repros: league 7 seed 11, ANCHORS down 6 with 0 timeouts at Q4 0:38 after a -3-yard catch now let 30 s run (was 39 s). League 2026 seed 3, EMBERS down 3 with 0 timeouts let 17 s run at Q4 0:32 (was 19 s). Seed 26, QUARRYMEN down 2 with 0 timeouts let 14 s run at Q4 0:55 (unchanged). |
| 2 | Kneels by teams that can't kneel out | Much better for trailers; leader part and tied teams still present | `d.kneel.notLeading` 0.0103 (5c 0.0448, real 0.0153); trailers 1-8 now 3 kneels, trailers 9+ 0 (5c 42 and 75). Q4 kneels by trailers with 60 s or more: 3 (5c 99). `d.kneel.thenPlay.notLeading` 0.0168 (5c 0.0488, real 0); all of the cases I sampled are tied teams. `d.kneel.thenPlay.lead1to8` 0.0205 (5c 0.0248, real 0.0029). `d.kneel.thenPlay.lead9` 0.0727 (5c 0.0762, real 0.0019; reported only). `d.kneel.4thLate` 0.0045 (5c 0.0132, real 0.0076). Repros: seed 26 ev 263 unchanged (OSPREYS up 2 kneel on 1st down at Q4 1:20 with QUARRYMEN holding 3 timeouts, then run twice and punt; the spec amendment says this is the K0c.d23 cell). Seed 229 ev 270 unchanged (PELICANS up 2 call a timeout, then kneel on 4th and 13 at their own 40 at Q4 1:17). Seed 107 diverged and no longer reaches the 1st-and-goal state. Seed 4: RATTLERS, down 12 at Q4 1:59, now throw on 1st and 10 instead of kneeling (fixed at this seed). OT kneels by tied teams: see new finding 4. |
| 3 | OT try more than 5:00 from the end ignores the score | Fixed | `d.try.otDown2`: 3 of 3 two-point tries in 10,000 postseason games (5c: 0 of 1); none in the regular-season soak. Flag 1, tied: 7 of 7 kicks (postseason), 2 of 2 (regular). Flag 1, down 1: 9 of 21 go for two. Seed 6537 now diverges: LYNX kick a 57-yard field goal in OT and SENTINELS answer with a 63-yard touchdown run; the try is skipped, which is correct. |
| 4 | Touchdown lines print drawn yards, not the distance | Still present (deferred to M2) | 58 of 70 touchdown lines in the 11 games I read show yards that aren't the distance. |
| 5 | Text rough edges | Still present (deferred to M2) | Run-offs longer than the clock left: 10,887 (5c 10,822). Last drive labelled "End of half" (league 2026 seed 93, drive 23, Q4). Missed-extra-point fluke wording (league 2026 seed 743, Q4 12:29). "no good (69% chance)" (league 99 seed 543, OT 0:55). |
| 6 | QB sneak with long yardage | Still present (deferred to M2) | League 2026 seed 93, Q4 2:27: still a QB sneak on 4th and 11. Not measured. |

## Accepted values on this soak

Joseph accepted these on the 10,000-game in-sample run. My soak is a different sample, so "holds" here means at or better than the accepted value on these games. n is the event count. The spread is across the four leagues (1,000 games each).

| Check | Accepted (in-sample) | 4,000 regular season | League spread | 10,000 postseason | Real | Reading |
| --- | --- | --- | --- | --- | --- | --- |
| `d.spike.trail0TO` | 0.0506 | 0.0475 (n 190) | 0.041 to 0.056 | 0.0468 (n 468) | 0.0749 | 0.003 further from real than accepted. That is under 1 standard error (about 0.0034 at n 190), so the soak can't tell it apart from the accepted value. It does not hold strictly. |
| `d.gap.trail0TO` | 31.40% | 30.13% (317/1,052) | 27.4 to 32.3 | 30.57% (779/2,548) | 22.53% | Holds |
| `d.kneel.thenPlay.lead1to8` | 0.0165 | 0.0205 (n 82) | 0.014 to 0.026 | 0.0166 (n 166) | 0.0029 | Regular season is 0.004 worse, about 1.7 standard errors. Postseason is at the accepted value. Not clearly a regression. |
| `d.kneel.thenPlay.notLeading` | 0.0195 | 0.0168 (n 67) | 0.013 to 0.020 | 0.0193 (n 193) | 0 | Holds |
| `c.kneel.ballBack` | 7.94% or better | 7.28% (193/2,652) | 5.7 to 8.7 | 8.05% (528/6,562) | 2.92% | Holds in the regular season. Postseason is 0.11 pp above, about one third of a standard error, and isn't the gated sample. |

The other 5d and 5c checks on this soak: `d.spike.running0TO` and `d.spike.stopped0TO` pass. `d.kneel.4thLate` passes. `d.kneel.notLeading` is 0.0050 below real, right at its 0.005 tolerance (in-sample passes at 0.0149; postseason 0.0130). `c.trail.lastSnap` is 3 games (0.075% vs 0.048%), `c.trail.longGap` is 5.7% vs 7.4%, and `c.kneel.shortGap0TO` is 5.76% vs 5.69%; all pass. `c.fg.63` is 0.0227 (accepted 0.0254) and `c.fg.50to59` is 0.755 (accepted 0.7651), both at or better.

## New findings, ranked

### 1. In a close game, the team with the ball runs out the clock in field-goal range without kicking (breaks balance; decides about 2% of games; predates 5d)

- Repro A: league 2026, seed 229, Q4 0:17 (ev 283). SENTINELS trail 21-23 with 0 timeouts. After a 5-yard catch to the opp 19, they "let 14 s run" with 0:13 left. The game ends with no field goal try.
- Repro B: league 2026, seed 14, Q4 0:09 (ev 259). RATTLERS trail 16-17 at the opp 26. They call their last timeout, then run outside for -2, and the clock runs out.
- Repro C, overtime: league 2026, seed 743, OT 0:28 (ev 317). LYNX, tied 28-28, use their last timeout, run to the opp 19 and let 35 s run with 0:24 left. The game ends in a tie.
- Repro D, overtime: league 99, seed 543, OT 0:39 (ev 316). PELICANS, tied, run to the opp 33 and let 37 s run with 0:36 left. Tie.
- Repro E, final snap: postseason league 4242, seed 33, Q4 0:03 (ev 276). Down 3 at the opp 28 holding a timeout, the offense passes instead of kicking the tying field goal.
- Expected: a team tied or down 1-3 with the ball in range kicks, or spikes and then kicks, before time runs out.
- Actual:

  | Measure | Sim (`01d55d1`) | 5c (`4f25b28`) | Real 2016-2023 |
  | --- | --- | --- | --- |
  | Regulation ends with an offense tied or down 1-3 whose last snap (not a kneel) was at the opp 35 or closer, and no kick, per 4,000 games | 79 (0.020 a game) | 68 | 1 in 2,095 (0.0005 a game), a spike at 0:01 |
  | The same with 5 s or more left after the last snap (postseason soak, 10,000 games) | 55 | 77 | 0 |
  | Regular-season OT ties where the tied offense was in range at the end | 10 of 28 ties | not measured | 0 of 5 OT drives that ended with the clock |
  | Two-minute drills (drive starts in the final 2:00 of Q4, offense down 1-3): field goal tried | 10.1% (47/464) | 12.7% (63/495) | 34.6% (90/260) |
  | Same drives: the clock runs out with the offense holding the ball | 51% (238/464) | 49% | 19% (50/260) |
  | Spikes by a tied team in Q4 or OT, per 4,000 games | 13 | 19 | about 82 (43 in 2,095) |

- Two things happen in the repros. The pre-snap run-off after an in-bounds play is longer than the clock left (A, C, D), so the 5c text finding "run-off longer than the clock" also ends games, not just text. And with seconds left the caller picks a run or pass over the field goal (B, E).
- 5d did not cause this. The tied cases improved (9 to 1 in the regular season, 38 to 24 in the postseason), but trailing 1-3 is the same or worse. Regular-season ties are 0.70% of games (5c 0.60%, real 0.43%); 10 of the 28 are this case.

### 2. The first half ends with the offense in field-goal range far more often than in real games (breaks balance; predates 5d; outside 5d's scope)

- Repro A: league 2026, seed 13, Q2 0:10 (ev 127). CRANES, at the opp 8 with 1 timeout, complete a 2-yard pass and "let 29 s run" with 0:03 left. The half ends with no kick.
- Repro B: league 2026, seed 50, Q2 0:31 (ev 120). MARINERS lead 6-3 at the opp 15 with 3 timeouts, kneel, and let the half run out.
- Expected: a team in range late in Q2 uses its timeouts or spikes, then kicks.
- Actual:

  | Measure | Sim | 5c | Real 2016-2023 |
  | --- | --- | --- | --- |
  | Q2 ends with the offense's last snap (not a kneel) at the opp 35 or closer, no score, per game | 0.085 (339) | 0.080 (321) | 0.013 (27) |
  | Same, offense still holding a timeout | 203 | 192 | 1 |
  | Q2 ends on a kneel at the opp 35 or closer | 89 (0.022 a game) | 95 | 0 |
  | Q2 field goal tries in the final 0:30, per game | 0.130 | 0.131 | 0.433 |
  | Q2 field goal tries in the final 2:00, per game | 0.369 | 0.376 | 0.630 |

- Field goal tries per game overall still match (3.73 vs 3.86), so the sim kicks its field goals earlier in drives and in the game, not at the end of the half. The 5d spec lists Q2 spikes as a non-goal, so this is new to this report, not a 5d regression. It changes halftime scores in about 1 game in 10.

### 3. Tied teams try long field goals on early downs with time and timeouts left (breaks balance, small; the distance shift is new in 5d)

- Repro A: league 2026, seed 257, Q4 0:28 (ev 269). ANCHORS, tied 24-24 at midfield on 2nd and 4, use their last timeout and then try a 68-yard field goal (12% make). It misses. HERONS then try a 60-yard field goal on 2nd and 10 at 0:20 (ev 271).
- Repro B: league 2026, seed 445, Q4 1:11 to 0:31 (field goal at ev 250). RATTLERS, tied 20-20, hold 3 timeouts, let 40 s run after a 13-yard catch, then try a 58-yard field goal on 1st and 10 at 0:31 (28% make).
- Expected: with time and timeouts, run more plays to get closer. Real teams never kicked on 1st or 2nd down with more than 0:20 left in these states.
- Actual:

  | Measure, Q4 final 2:00 unless noted | Sim | 5c | Real 2016-2023 |
  | --- | --- | --- | --- |
  | Field goal tries on downs 1-2 with more than 0:20 left, offense tied or down 1-3, per 4,000 games | 36 (21 of them 50+ yards) | 63 | 0 in 2,095 |
  | Tied offense: share of field goal tries from 50+ yards | 51% (62/121) | 37% (44/118) | 27% (37/136) |
  | Tied offense: mean field goal distance | 46.7 yd | 42.4 yd | 41.2 yd |
  | Tied or down 1-3, Q4 and OT: tries from 60+ yards | 32 | 15 | about 34 per 4,000 games, but from roughly twice as many tries |

- The early-down count improved after 5d (63 to 36). The distance shift is new: the tied 50+ share moved 14 pp from 5c, about 2.2 standard errors at these counts. That fits the field-goal-range split 5d added to the spike level, but I didn't trace it. The samples are small (about 120 tries a side).

### 4. Tied teams kneel in overtime far from the goal line, then keep playing (rough edge; predates 5d; better)

- Repro: postseason league 4242, seed 727, OT 13:27 (ev 286). STAGS, tied 20-20 at the opp 29 on 1st and 10, kneel after EMBERS call a timeout, then pass on 2nd and 11.
- Real: all 12 OT kneels in 2016-2023 (115 OT games) were tied, inside the opp 22, and were followed by a field goal, another kneel or a no-play. None was followed by a run or pass.
- Sim: an OT kneel followed by a run or pass happens 44 times in 454 postseason OT games (5c 66 in 472) and 11 times in 149 regular-season OT games (5c 15 in 165). 23 postseason OT kneels were outside the opp 25 (5c 35).
- These are the tied cases behind `d.kneel.thenPlay.notLeading` and the tied part of `d.kneel.notLeading`.

### 5. Overtime spikes went from wrong to almost none (rough edge; caused by 5d)

- 5c spiked in OT at clocks no coach would (postseason league 4242, seed 2017, OT 13:42). 5d removed those: OT spikes are 1 in 149 regular-season OT games (5c 8) and 1 in 454 postseason OT games (5c 35).
- Real: 11 OT spikes in 115 OT games, all by tied teams in the final 0:37, mostly at the opp 37 or closer with 0 timeouts. That is the state where the sim lets the clock run out (finding 1, repros C and D).
- The one sim OT spike (league 2026, seed 743, OT 1:21) is by a tied team holding a timeout at midfield.

## Checked and clean

- 10,000 postseason games: 0 crashes, 0 ties, longest game OT2 (5c reached OT3). The regular-season soak had 0 crashes.
- Invariants over 4,000 regular-season and 10,000 postseason games: the clock never runs backwards within a period, timeouts stay in 0-3, run-offs stay in 0-40 s, every score change is 1, 2, 3 or 6, the down and goal-to-go state is consistent, the box score equals the final score, there is exactly one "End of Q4", and no line prints `undefined`, `NaN` or `null`.
- Spikes: none with the clock stopped, none by a leader, none on 4th down, none in Q1 or Q3. Late 3rd-down spikes are 31 per 4,000 games (5c 14; real about 44).
- Leaders: offense timeouts in the final 5:00 of Q4 with a lead, 986 (5c 1,042). A trailing defense holding timeouts lets a 1-8 leader take 30 s or more between snaps in 20.9% of gaps (73/349; 5c 25.8%; real 35.6% from the 5c report).
- Trailers holding timeouts: run-offs of 30 s or more in the final 2:00, 234 (5c 240). A regulation-ending run-off by a 1-8 trailer holding timeouts, 3 games (`c.trail.lastSnap` passes).
- Early-down field goals by a tied or 1-3 trailing team between 2:00 and 0:40: 6 (5c 78; real 0).
- Late two-point and extra-point choices in regulation: down 2 after a touchdown in the final 2:00, 43 of 43 go for two. Tied in the final 5:00, 93 of 93 kick.

## Needs a human session (feel, not checked here)

Have Joseph or a tester read five CLI games: league 2026 seeds 229, 14, 13 and 257, and league 99 seed 543. Hide the final score. Log the following:

1. At each team's last possession of a half, at what clock do they first expect a field goal? Log the clock, the field position and the timeouts left at that line, and the line where they notice no kick is coming.
2. When a line reads "lets N s run" and N is more than the clock left, do they read it as the game ending, or look for the next play? Log their first reaction to each one.
3. On a 50+ yard field goal try on 1st or 2nd down in the final minute (seed 257, 445), do they reread the preceding lines? Log which earlier line they go back to.
4. Where in Q4 or OT do they stop reading the play by play and skip to the final score? Log the period and the clock.
5. After a tied overtime ends in a tie (seeds 743, 543), ask them what they think the offense should have done on the last snap. Log the answer verbatim.

## Result

FINDINGS:
1. Close-game clock-outs in field-goal range at the end of Q4 and OT. Breaks balance, about 2% of games. It predates 5d; the tied cases improved.
2. End-of-first-half clock-outs in range and too few end-of-half field goals. Breaks balance. It predates 5d and is outside 5d's scope.
3. Tied teams try long field goals on early downs. Breaks balance, small. The shift toward longer tries is new in 5d.
4. Tied teams kneel in OT far from the goal line, then keep playing. Rough edge. It predates 5d and is better now.
5. OT spikes are almost gone. Rough edge, caused by 5d.

Of the 5c findings, 3 is fixed. 1 and 2 are better and still present, at about their accepted values. On this soak, `d.gap.trail0TO`, `d.kneel.thenPlay.notLeading` and `c.kneel.ballBack` hold their accepted values. `d.spike.trail0TO` (by 0.003) and `d.kneel.thenPlay.lead1to8` (by 0.004, regular season only) read slightly worse, within about 1-2 standard errors. 4 to 6 are still present and deferred to M2.
