# M1 step 5c playtest (gate H3)

Date: 2026-11-13. Playtester run, headless only. No source, data or test edited. No 10,000-game calibration and no holdout run (`--target holdout` was not touched).

## What was run

- Commit: `d94384c` on `m1/full-game`, clean tree.
- CLI: `pnpm sim:game -- --seed <n> [--league-seed <n>] [--game-type postseason] [--format json]`, run as `node --import ./scripts/engine/register.mjs scripts/game/sim-game.ts ...` with `npm_config_cache=$TMPDIR/npm`. In "ev N" below, N is an index into `events` in the `--format json` record. In the text output, event N is on line N + 7.
- Read as text, Q4 and OT closely: every repro seed in PLAYTEST_M1.md (league 2026 seeds 1, 2, 3, 7, 9, 10, 12, 14, 30, 93, 157, 543, 892; league 7 seed 11; league 4242 seed 599 postseason), and the seeds the soak flagged (2026: 4, 18, 26, 29, 54, 97, 107, 156, 175, 194, 229, 664; 4242 postseason: 876, 4116, 6537). Same seed twice is byte-identical (seed 93, `cmp`). The default output equals `--game-type regular`. `--game-type foo` exits 1 with a clear message. The header shows the game type.
- Soak: an in-process driver (scratchpad, outside the repo) that calls `leagueFromSeed`, `setupGame`, `playGame`, `boxScore` and `renderGame` the same way `sim-game.ts` does, and counts the pre-registered checks with `measureChecks` from scripts/game/checks5c.ts.
  - Regular season: leagues 2026, 7, 99 and 31337, seeds 1-1,000 each (4,000 games). That's the same set as the first playtest.
  - Postseason: league 4242, seeds 1-1,000, then seeds 1-10,000.
- Before and after: the same driver run on the first playtest's build (`git archive d73620f` unpacked in the scratchpad), with the same 4,000 regular-season and 1,000 postseason games. In the tables, "old" means that build.
- Real comparisons: nflverse play by play, 2016-2023 regular season (2,095 games), from the local cache, read with `pipeline/.venv/bin/python` and polars. To find the 2016-2023 files I listed the season column of each cached file. I read no play data from 2024-2025.
- Speed: 4,000 games with rendering and all probes took 33 s (8 ms a game). 10,000 postseason games took 131 s.

Note: data changed between `d73620f` and `d94384c`, so most of the original repro seeds now play out as different games. In the status table below, "repro" says what the seed does now. The verdict rests on the soak rates.

## Status of the original findings

| # | Finding | Status | Evidence (4,000 games unless noted; old = d73620f, same games) |
| --- | --- | --- | --- |
| 1 | Postseason crashes on the snap cap | Fixed | 10,000 postseason games (league 4242, seeds 1-10,000): 0 without a record, 0 ties. The 1,000-game soak: 0 and 0 (old: 1 crash, seed 599). Seed 599 now ends 26-21 in regulation, so it no longer reaches OT. The longest game went to OT3 (seed 4116). No game reached OT5, so the new toss after OT4 is covered only by the A3 fixture. |
| 2 | Trailer lets Q4 run out holding timeouts | Fixed | Q4 ends on a run-off by a 1-8 trailer holding timeouts: 0 games (playtest: 192). `c.trail.lastSnap` 0.05% vs 0.05% real. `c.trail.longGap` 5.9% vs 7.4% real (n 3,517). Run-offs of 30 s or more by a trailer with timeouts in the final 2:00: 240 (old 355). Repros diverged. Seed 12 still has a mild case: EMBERS, down 8 with 2 timeouts, let 18 s run at Q4 1:02. |
| 3 | Leader kneels before it can run out the clock | Better, still present (accepted miss) | `c.kneel.ballBack` 8.4% (n 2,657) vs 2.9% real (playtest 36.8%), the same as run H's accepted 8.97%. See new finding 2 for what it looks like on screen. |
| 4 | Field goals far beyond range | Mostly fixed, the accepted miss remains | Tries of 60+ yards: 0.032 a game vs 0.029 real. 63+: 0.023 vs 0.0086 (accepted miss). 70+: 0 (longest 69; old soak longest 109). 50-59: 0.765 vs 0.642 (accepted). Seeds 10 and 30 no longer try those kicks. The remaining long tries mostly aren't end-of-half heaves: 63+ with more than 30 s left in the half, 43 (0.0108 a game) vs 1 real (0.0005). Examples: seed 156 ev 249, a 68-yard try on 2nd and 10 at Q4 2:00 while down 6. Seed 54 ev 256, a 66-yard try on 2nd and 5 at Q4 2:00 while down 18. Seed 194 ev 54, a 68-yard try on 4th and 8 at Q1 2:17. |
| 5 | Try choice ignores the late score | Fixed in regulation | Down 2 after a TD in the final 2:00: two-point 35/35 (real 28/28). Tied after a TD in the final 5:00: kick 82/82 (real 45/45). All 34 cells from -8 to +8 in G5 and GF are within noise except G5 -1, where the sim goes for two on 17 of 47 against 4 of 34 real (small samples). Overtime is a gap, see new finding 3. |
| 6 | Timeouts before kickoffs and tries in Q1-Q3 | Fixed | Kickoffs Q1-Q3: 0.0085 a game vs 0.0076. Tries Q1-Q3: 0.013 vs 0.013. Kickoffs, all periods: 0.065 vs 0.057 (old: 1,027 kickoff timeouts in Q1-Q3, now 34). |
| 7 | Kneel on 4th and goal early | Fixed | Kneels in Q1, Q3, or Q2 before 1:00: 0 (old: 26). Seeds 9 (ev 55, an incompletion on 3rd and goal) and 892 (ev 50, a 20-yard field goal) don't kneel. |
| 8 | Punting while trailing late in the opp half | Still present (deferred, as expected) | Punts while trailing by 1-16 in the final 2:00: 80, or 0.020 a game (old 0.022; playtest real 0.0029). 58 of them from the opponent's half. |
| 9 | Spike with the clock stopped | Fixed, but it exposed a spike shortage | `c.spike.stopped` 0 (old 515). See new finding 1. |
| 10a | Kept fumble prints as "Complete" | Fixed | Lines whose why says fumble but whose text doesn't: 0 (old 1,609). Seed 1 Q1 7:41 reads "Complete for 25 yards, FUMBLE, recovered by LANTERNS". Two-point fumbles print too ("Two-point try, FUMBLE, recovered by HERONS, fails", league 7 seed 96 Q4 3:00). |
| 10b | "more or less likely" | Fixed | 0 in 1,000 games of league 2026 (old 2.7 a game). Seed 1 Q1 4:39: "a 10-yard-plus completion happened despite the matchup (x0.89)". |
| 10c | Fluke at 28.3%, common at 5% | Fixed | Fluke lines quoting 10% or more: 0 (old 4,227). "Common" lines under 20%: 0 (old 27,312). |
| 10d | Drive yards ignore penalties | Fixed | Touchdown drives whose yards aren't the distance to the goal: 0 (old 10,143). Seed 1 drive 2 shows 86. The per-play touchdown yards still disagree with the distance, see new finding 4. |
| 10e | "End of Q4" printed twice | Fixed | Exactly one "End of Q4" in all 4,000 games, including the 165 OT games. |
| 10f | Roughing on scrambles | Fixed | 0 (old 78). |
| 11 | Defense presets that look wrong | Still present (deferred, as expected) | Goal Line with 5 or more to go outside the opp 30: 0.48 a game (old 0.50). Prevent outside the final 2:00 of a half: 0.63 a game (old 0.63). |

Pre-registered checks on this soak (not the in-sample run): 14 of 17 pass. The three that fail are the three Joseph accepted, at the same values as run H: `c.kneel.ballBack` 8.43% vs 2.92%, `c.fg.63` 0.0230 vs 0.0086, `c.fg.50to59` 0.765 vs 0.642. `c.ot.complete` passes on 10,000 postseason games.

## New findings, ranked

### 1. A trailing team with no timeouts barely spikes and lets the clock run in the final minute (breaks balance; got worse in 5c)

- Repro A: league 7, seed 11, ev 268. ANCHORS trail 30-36 at their own 19 with 0 timeouts. After a catch at Q4 0:35 they "let 39 s run before the snap", and the game ends.
- Repro B: league 2026, seed 3, Q4 0:35 (ev 264). EMBERS, down 3 with 0 timeouts, let 19 s run after a 0-yard catch.
- Repro C: league 2026, seed 26, Q4 0:55 (ev 273). QUARRYMEN, down 2 with 0 timeouts at their own 8, let 14 s run.
- Expected: a 1-8 trailer with no timeouts hurries up or spikes.
- Actual:

  | Measure | Sim (new) | Old build | Real 2016-2023 |
  | --- | --- | --- | --- |
  | Spikes per game, all | 0.053 | 0.198 (0.129 of them with the clock stopped) | 0.262 |
  | Q4 spikes by a 1-8 trailer with 0 timeouts, per game | 0.0063 | 0.021 | 0.075 |
  | Q4 final 1:00, 1-8 trailer with 0 timeouts: share of gaps between snaps of 15 s or more | 36.2% (325/897) | 24.2% (242/1,000) | 23.1% (195/844) |

- Gap is measured the way `c.trail.longGap` is: game seconds between consecutive snaps of one drive, with no timeout, two-minute warning or period end between them.
- The old build matched real on the 0-timeout gap share. After 5c it is 13 pp above real, about 8 standard errors. None of the 17 checks covers a trailer with 0 timeouts. The spike fix removed the stopped-clock spikes, and the running-clock spikes by trailers fell from 0.021 to 0.0063 a game at the same time.

### 2. Kneels by teams that can't kneel out the clock: leaders with a one-score lead, and trailing teams (breaks balance, small)

- Repro A, leader: league 2026, seed 26, ev 263. OSPREYS lead 14-12 and recover an onside kick at the opp 47 at Q4 1:20. QUARRYMEN hold 3 timeouts. OSPREYS kneel on 1st down, then run twice and punt at 1:07.
- Repro B, leader: league 2026, seed 229, ev 270. PELICANS lead 23-21 at Q4 1:17 with 4th and 13 at their own 40. They call a timeout and then kneel on 4th down, which gives SENTINELS the ball at the PELICANS 37.
- Repro C, trailer: league 2026, seed 107, ev 264. LUMBERJACKS trail 18-22, 1st and goal at the opp 3, Q4 1:16. They call their last timeout and then kneel.
- Repro D, trailer: league 2026, seed 4, ev 250. RATTLERS trail by 12 at Q4 1:59. They kneel on 1st and 10, then pass on the next three downs.
- Numbers. "Kneel, then a run or pass" means a Q4 kneel followed by a run or pass on the same possession.

  | Measure | Sim (new) | Old build | Real 2016-2023 |
  | --- | --- | --- | --- |
  | Kneel, then a run or pass, leader up 1-8 | 99 (0.025 a game) | 255 | 8 (0.0038) |
  | Kneel, then a run or pass, leader up 9+ | 310 (0.078) | 779 | 4 (0.0019) |
  | Kneel, then a run or pass, trailer or tied | 184 (0.046) | 164 | 0 |
  | Q4 kneels by a trailing offense with 60 s or more left | 99 (0.025) | 102 | 7 (0.0033) |
  | Q4 or OT kneels on 4th down with more than 10 s left | 53 (0.013) | 68 | 16 (0.0076) |

- The leader part is the accepted `c.kneel.ballBack` miss. DECISIONS.md traces what is left of it to leads of 9 or more. But a quarter of these sim cases are one-score leads (repros A and B). The trailer part predates 5c and no check covers it. The real counts are small (7, 8, 16), so the ratios are rough. The direction is not in doubt.

### 3. In overtime, a try more than 5:00 from the end ignores the score (rough edge, decides the game)

- Repro: `--game-type postseason --league-seed 4242 --seed 6537`, ev 296, OT 6:21. SENTINELS score a TD on 4th and goal to trail 23-25 and kick the extra point. They lose 24-25.
- Expected: when the try decides the game, a team down 2 goes for two at any clock.
- Actual: this was the only try in the situation across 10,000 postseason games, and it was a kick. MODEL.md says overtime reads the Q4 chart cell "with the same clock", so above 5:00 of a 15-minute postseason OT period (or a 10-minute regular OT) the chart doesn't apply and the fitted early-game share decides. Other OT tries looked fine: down 1 after the TD, 12 kicks and 7 twos; up 6, 63 kicks and 18 twos.
- It is rare, about 1 in 10,000 postseason games, but the result is a loss no coach would choose.

### 4. Touchdown lines print the drawn yards, not the distance to the goal (rough edge, text)

- Repro: league 2026, seed 1, ev 39: "3rd & goal at opp 14 ... Complete for 12 yards, TOUCHDOWN". Ev 178: "3rd & 2 at opp 22 ... Run for 46 yards, TOUCHDOWN". Postseason league 4242, seed 6537, ev 285: "2nd & 11 at opp 13 ... Run for 49 yards, TOUCHDOWN".
- Actual: 13,708 of 18,739 touchdown run, catch and scramble lines (73%, 3.4 a game) show yards that aren't the distance. 8,448 are longer and 5,260 shorter (accepted fouls excluded). The old build was the same (13,878). The text uses the engine's `detail.yards`. Plays scored from the same band can stop up to 4 yards short, and long draws aren't cut at the goal line. The why line uses the same draw ("a 20-yard-plus run" from the opp 13).
- Why it matters now: 10d made drive yards net, so a reader who adds up the play lines no longer gets the drive table's number. The box score cuts the long ones at the goal line but counts the short ones as drawn.

### 5. Other text rough edges (predate 5c)

- A run-off longer than the clock that is left: "PROSPECTORS lets 37 s run before the snap" at Q4 0:30 (league 2026, seed 93, ev 262). 10,822 in 4,000 games (2.7 a game; old 11,049).
- The last drive of a game is labelled "End of half" in the drive table (seed 1, drive 19, Q4; seed 93, drive 22).
- The fluke template on a missed extra point reads "An extra point for no good: a fluke, only 4.9% ..." (seed 543, Q4 10:59).
- "Field goal ... is no good (75% chance)" quotes the chance of the result, not the make chance (seed 54, ev 256). It is correct, but easy to read the wrong way.

### 6. QB sneak with long yardage (observation, no real measure)

- Repro: league 2026, seed 93, Q4 2:27: a QB sneak on 4th and 11 while trailing by 9.
- 187 QB sneaks with 5 or more to go in 4,000 games (0.047 a game; old 0.051). I didn't measure the real rate: nflverse has no sneak flag, so this needs a definition first. Not a 5c regression.

## Checked and clean (new probes for 5c)

- Leaders calling timeouts in the final 5:00 of Q4 (both sides together): up 1-8, 0.35 a game vs 0.50 real. Up 9 or more, 0.22 vs 0.25. (Real timeout rows carry no `posteam`, so I used the cumulative score and `timeout_team`.)
- An offense timeout right before its own kneel in Q4 or OT: 0.037 a game vs 0.037 real.
- A 1-8 trailer on defense, holding timeouts, letting the leader take 30 s or more between snaps in the final 2:00: 25.8% vs 35.6% real (n 341 vs 205), so the sim's trailing defense is if anything quicker to stop the clock.
- OT kneels with more than 1:00 left: 0.005 a game vs 0.0048 real. Regular-season OT starts with 2 timeouts each. Regular-season ties: 0.6% vs 0.43% real.
- Late two-point and extra-point choices in regulation (finding 5 row). No try at 0:00 by a team already ahead. Field goals in the final 2:00 while trailing by 4-8: 0.013 a game (the gated `diag.final2FieldGoalAttempts.trailing4-8` passes).
- Invariants over 4,000 regular-season games: the clock never runs backwards in a period, timeouts stay in 0-3, run-offs stay in 0-40 s, every score change is 1, 2, 3 or 6, the down and goal-to-go state is consistent, and the box score equals the final score.

## Needs a human session (feel, not checked here)

Have Joseph or a tester read four close CLI games: league 2026 seeds 26, 107 and 229, and postseason league 4242 seed 6537. Log the following:

1. In the final 2:00, which decision makes them stop and reread? Log the line, the clock, the score and both teams' timeouts. Expect the kneels in finding 2.
2. When a team with no timeouts trails late, do they expect a spike or a hurry-up before reading the next line? Log each run-off line they question.
3. Do they add up the yards on the play lines of a scoring drive and compare them with the drive table? Log any drive they challenge (finding 4).
4. When a why line quotes a percentage on a kick ("no good (75% chance)"), ask them what the 75% is. Log their answer.
5. Where in Q4 or OT do they stop reading the play by play and skip to the final score? Log the period and the clock.

## Result

FINDINGS: 1 (breaks balance, worse after 5c), 2 (breaks balance, small; the leader half is the accepted miss), 3 (rough edge that decides games), 4 to 6 (rough edges, all predate 5c). Of the original findings, 1, 2, 5, 6, 7, 9 and 10a-f are fixed. 3 and 4 are better, with their accepted misses showing at the accepted values. 8 and 11 remain, as expected.
