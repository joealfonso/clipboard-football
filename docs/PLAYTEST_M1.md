# M1 step 5 playtest (gate G7 / F5)

Date: 2026-11-12. Playtester run, headless only. No source edited, no 10,000-game calibration run.

## What was run

- Commit: `d73620f` on `m1/full-game`. The brief named `5159b7e`; `d73620f` only adds docs/RULES.md and the M2 spec (`git diff --stat 5159b7e d73620f`), so the sim code and data are the same.
- CLI: `node --import ./scripts/engine/register.mjs scripts/game/sim-game.ts --seed <n> [--league-seed <n>] [--format json]`, with `npm_config_cache=$TMPDIR/npm`.
- I read 12 full games as text, with Q4 and OT read closely: seeds 1, 2, 3, 12, 14, 93 (league 2026); 11, 42 (league 7); 5, 17 (league 99); 8, 23 (league 31337); 100 (league 1). Same seed twice gave byte-identical output (seed 93, `cmp`).
- Soak: an in-process driver that calls `leagueFromSeed`, `setupGame`, `playGame` and `boxScore` the same way `sim-game.ts` does. Regular season: league seeds 2026, 7, 99 and 31337, game seeds 1-1000 each (4,000 games, 25.8 s wall clock). Postseason: league seed 4242, game seeds 1-1000.
- Real comparisons: nflverse play by play 2016-2023 regular season (2,095 games) from the local cache, read with `pipeline/.venv/bin/python` and polars. Training seasons only; I did not read 2024-2025.
- Event numbers below (`ev N`) are indexes into `events` in the `--format json` record. The clock time lets you find the same line in the text output.

## Clean checks (no violations in 4,000 regular-season games)

- Clock never runs backwards inside a period, and no run-off is outside 0-40 s.
- Downs stay in 1-4, distance is at least 1, goal-to-go distance equals the yards to the goal, spot stays in 1-99, timeouts stay in 0-3 and never go up inside a period.
- Every score change is 1, 2, 3 or 6. Score, spot and possession don't change between events.
- Box score points equal the final score, and the period scores add up. Time of possession adds to 60:00 in regulation games. Completions never exceed attempts, made field goals never exceed attempts.
- The right team kicks off after a score. The cases that looked wrong were all at halftime, which is correct.
- Every two-minute warning fires once in Q2 and once in Q4. Ties happen only after regular-season OT.
- Inputs per game: at most 343 against a cap of 2,500. Scrimmage snaps in the regular season: at most 185 against a cap of 260.
- Why lines: every `(xN)` multiplier in a why line matches a factor in that play's trace, and every "matchup" or "fluke" phrase has its factor. No why line names a factor the engine didn't use.

## Findings, ranked

### 1. A legal postseason game crashes on the snap cap (blocks play)

- Repro: league 4242, seed 599, `gameType` "postseason". Use `setupGame(teams, 4242, 599, () => coach, "postseason")` then `playGame`. The CLI has no game-type flag.
- Expected: play continues until someone scores. Postseason `maxPeriods` is null (docs/RULES.md).
- Actual: `GameLoopError snapCap: game 599 passed 260 scrimmage snaps` at OT4 11:18, 20-20. That's after three scoreless 15-minute OT periods: missed field goals at OT3 5:09 and 2:04, and a turnover on downs at the opp 4 in OT2. No record is produced.
- Evidence: 1 crash in 1,000 postseason games. F1's own 1,000-game postseason soak passed, but that was a different set of seeds. 5 of the 32 postseason OT games in my run went past OT1.

### 2. The trailing or tied team lets the clock run out while holding timeouts (breaks balance)

- Repro A: league 2026, seed 93, ev 256-261. PROSPECTORS trail 13-17 at the opp 18 with 3 timeouts. They let 40 s run at 0:53. At 0:08 they're at the opp 12 and let the clock expire.
- Repro B: seed 3, ev 279-281. FOXES trail by 3 at their own 44 with 2 timeouts. They let 31 s and then 40 s run, and the game ends at midfield.
- Repro C: seed 12, Q4 0:47 to 0:00. DROVERS are tied, with 2 or more timeouts. They let 33 s run, reach the opp 29 at 0:07 and don't try a field goal. They lose in OT.
- Expected: a one-score trailer late in the game uses its timeouts.
- Actual: in 192 of 4,000 games (4.8%), Q4 ends on a run-off by an offense that trails by 1-8 and still holds timeouts. A comparable real-data measure: the last Q4 snap is by a 1-8 point trailer with timeouts left and 15 s or more on the clock. That happens in 2.8% of sim games (113) against 1.2% of real games (25 of 2,095). In the final 2:00 with timeouts, 13.5% of the trailer's run-offs are 30 s or longer (n=1,407).
- Note: this may feed the accepted `absMargin.share.1-3` miss.

### 3. The leader kneels before it can run out the clock (breaks balance)

- Repro: league 7, seed 11, Q4 1:16. GRIZZLIES lead 26-21 and kneel on 1st and 10 at their own 21 while ANCHORS hold timeouts. They kneel three times, punt from their own 18 at 0:32, the punt is blocked, and ANCHORS score the winning TD.
- Expected: kneel only once the remaining kneels can end the game (step 5b spec, line 160).
- Actual: in games where the leader kneels in Q4, the opponent gets the ball back with time left in 36.8% of them (1,003 of 2,727). Real data: 1.9% (24 of 1,267). Separately, when the opponent has 0 timeouts in the final 2:00, the leader snaps with 15 s or less run off on 11.8% of snaps (n=2,364). Example: league 2026, seed 7, ev 248, a 2 s run-off at 1:54 while leading by 4.

### 4. Field goals tried from far beyond any real range (breaks balance)

- Repro: league 2026, seed 10, ev 139: an 80-yard try on 2nd and 10 at 0:04 of Q2. Seed 30, ev 11: a 68-yard try on 4th and 8 at midfield, Q1 12:27, 0-0.
- Actual vs real, per game: tries of 60+ yards 0.225 vs 0.029, 63+ yards 0.163 vs 0.0086, 70+ yards 0.060 vs 0.0005. The longest real try was 70 yards; the sim tries up to 83.

### 5. Try choice ignores the late score (breaks balance)

- Down 2 after a TD in the final 2:00: the sim kicks the extra point 20 times out of 34. Real teams kicked 0 out of 28.
- Tied after a TD in the final 5:00: the sim goes for two 19 times out of 92. Real teams did 0 out of 45.
- The real samples are small, but in both cases real teams made the same choice every time.
- Repro: league 2026, seed 543, ev 256-257. The two-point try fails, roughing is accepted, and the team then kicks at 0:00 to lose 22-21.

### 6. Timeouts before kickoffs and tries in Q1-Q3 (breaks balance, small)

- Repro: league 2026, seed 1, Q3 8:12: PILOTS defense timeout before a kickoff.
- Before kickoffs: sim 0.332 per game, real 0.050. In Q1-Q3 only: sim 0.257, real 0.0033.
- Before tries in Q1-Q3: sim 0.174, real 0.0105.
- The rate is fitted as one number per role, so it fires evenly across quarters. This wastes timeouts teams need late.

### 7. Kneel on 4th and goal early in the game (rough edge, no coach would)

- Repro: league 2026, seed 9, ev 55 (Q1 2:15, 4th and goal at the opp 7, 0-0). Seed 892, ev 50 (Q1, 4th and goal at the opp 2).
- 10 kneels in Q1 or Q3, all on 4th down, plus 18 in Q2 with more than 1:00 left. Real data has 0 of each.

### 8. Punting while trailing late in the opponent's half (rough edge)

- Repro: league 2026, seed 157, ev 271: down 8, 4th and 2 at the opp 46, 1:11 left, punts.
- Punts while trailing by 1-16 in the final 2:00: sim 0.022 per game, real 0.0029.

### 9. Spike with the clock already stopped (rough edge)

- Repro: league 2026, seed 12, ev 254: a spike on 1st down right after a kickoff, at 1:11 of a tied game.
- 525 in 4,000 games (0.13 per game). A spike with the clock stopped only throws away a down.

### 10. Text and why-line wording (rough edge)

- A fumble the offense recovers prints as plain "Complete for 25 yards" while the why line says "a catch and fumble". Repro: league 2026, seed 1, Q1 7:41. About 0.4 per game (603 in 1,500 games).
- "The matchup made X more or less likely (x0.89)": "more or less" reads as "roughly". 22% of these lines cite a multiplier below 1 as the reason the result happened. Repro: seed 1, Q1 4:39, the TD.
- "A fluke, only 28.3%" (seed 14, OT 5:42). 10.5% of fluke lines quote 10% or more. Going the other way, "a common result (5%)" appears on 1.8% of "common" lines.
- Drive yards count gross play yards without penalties. 53% of TD drives show a yardage that isn't the distance to the goal. Repro: seed 1, drive 2: from the own 14, 99 yards, TD.
- "End of Q4" prints twice around the OT coin toss line (seeds 12 and 14).
- Roughing the passer is called on QB scrambles: 30 in 1,500 games. Repro: seed 1, Q3 2:28.

### 11. Defense calls that look wrong on screen (rough edge)

- Goal Line is called with 5 or more yards to go outside the opp 30: 0.50 per game. Repro: seed 1, Q3 14:54, 1st and 10 at the own 22.
- Prevent is called outside the final 2:00 of a half: 0.63 per game. Repro: seed 2, ev 199, Q3, red zone.
- The preset mapping is designed (MODEL.md), so this is about the label shown to the player, not about the data.

## Accepted misses seen, not re-reported

- 4th-down goes (`fourthDownGo.perGame`). The slice of 4th and 4 or more from the own 40 or worse in Q1-Q3 goes 2.1% of the time (n=13,882) against 0.74% real (n=7,333). Repro: seed 1, Q3 11:18, 4th and 10 at the own 20, down 11.
- Drive counts and start, `absMargin.share` 1-3 and 8-14: as in GAME_REPORT.md. Findings 2 and 3 are likely contributors to the margin miss.
- Not accepted, but worth knowing: the safety drive share passes its 2 pp tolerance at 0.52% against 0.26% real, which is 2x.

## Needs a human session (feel, not checked here)

Have Joseph or a tester read 3 close CLI games, for example seeds 3, 11 (league 7) and 93, and log the following:

1. On which line do they first stop and reread or say "what?" Log the line and the clock.
2. When a why line names a factor, can they say in their own words what it did? Log any line they misread, especially "more or less likely".
3. In the final 2:00, which team decisions do they predict before reading the next line, and which ones surprise them? Log each surprise with the score, the clock and the timeouts left.
4. Does the drive table match what they remember from reading the plays? Log any drive they challenge.
5. Where do they stop reading the play by play and skip to the box score? Log the quarter and the clock.
