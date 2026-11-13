# M1 step 5c: playtest fixes

Status: draft, 2026-11-12. Owner: Joseph. Amends the step 5, 5a and 5b specs for the factors named here. Source: docs/PLAYTEST_M1.md (commit `d73620f`).

## Goal

Fix the problems the M1 playtest found, so that every legal game finishes and late-game choices look like what NFL coaches do. Nothing beyond those findings is in scope.

For: Joseph, who reads CLI games and owns the M1 gate, and the engineer, debugger and test-writer closing M1 step 5.

## Non-goals

- Any finding not listed in "Scope" below. That includes the accepted misses the playtest saw again (4th-down goes, drive count and start, the safety excess).
- Tolerances. data/game/tolerances.json, data/caller/tolerances.json and data/engine/tolerances.json stay byte-identical. The engineer adds no `known_deviations`. Only Joseph does.
- League settings (home edge, team SD), the matchup table, kickoffs, onside, and the step 3 rules except where RULES.md shows the sim is wrong.
- Retuning one metric to make up for another. If a fix moves a gated metric the wrong way, it goes to Joseph.

## Locked rules (CLAUDE.md and earlier steps)

1. Fitting uses 2016-2023 regular season only. No number here is chosen by looking at 2024-2026. The real side of every check is recomputed by the pipeline. The playtester's numbers are references, never targets.
2. The sim stays pure. One seeded Rng, same seed gives the same game. `resolvePlay` decides every outcome. Coach policies decide only choices.
3. Every new number lives in a data file. MODEL.md labels each new part fitted, designed or mixed. A designed rule says so, names the evidence it rests on, and covers only the states that evidence names.
4. Variance is not flattened. No fix narrows margins or points on purpose. A cap or mask may remove only choices that real teams never make, as shown by 2016-2023 data.
5. The why line comes only from trace factors. Text changes reword, they never add a reason the engine didn't use.
6. Real rules come from docs/RULES.md (2026 rulebook). Any new rule fact is looked up, cited there, and not written from memory.
7. Each finding starts with a diagnosis. Where the cause isn't obvious, the debugger finds it before the engineer writes a fix. The diagnosis is written into DECISIONS.md before the fix lands.

## Scope

| # | Finding (PLAYTEST_M1.md) | In scope | Milestone |
| --- | --- | --- | --- |
| 1 | Postseason OT crashes on the snap cap | yes | A |
| 2 | Trailing or tied team lets Q4 run out holding timeouts | yes | E |
| 3 | Leader kneels before kneeling can end the game | yes | F |
| 4 | Field goal tries far beyond real range | yes | B |
| 5 | Try choice ignores the late score | yes | C |
| 6 | Timeouts before kickoffs and tries in Q1-Q3 | yes | D |
| 7 | Kneel on 4th and goal early in the game | yes, with F (same kneel cells; real 0 vs sim 28 in 4,000 games) | F |
| 8 | Punting while trailing late in the opponent's half | deferred, future work (Resolved 5) | - |
| 9 | Spike with the clock already stopped | yes, with E (late clock use; real rate measured first) | E |
| 10a | Offense-recovered fumble prints as "Complete" | yes | G |
| 10b | "more or less likely" wording; a multiplier below 1 given as the reason | yes | G |
| 10c | "fluke" quoting 28.3%, "common" quoting 5% | yes | G |
| 10d | Drive yards ignore penalties | yes | G |
| 10e | "End of Q4" printed twice around the OT toss | yes | G |
| 10f | Roughing the passer on QB scrambles | yes, decided by evidence (G2) | G |
| 11 | Defense presets that look wrong on screen (Goal Line at the own 22, Prevent in Q3) | deferred to the M2 designer (Resolved 6) | - |

## Calibration rules for this step

- The in-sample run is 10,000 games, run seed 20261112, the same 10 league seeds as GAME_REPORT.md, against 2016-2023. It runs after each milestone that changes sim behavior (B-F) and once at the end (H).
- A gated metric that passed must still pass.
- An accepted miss stays accepted only if it is at or better than its accepted value: |observed - target| no larger than in DECISIONS.md "Step 5 misses accepted". This applies to every in-sample entry (game and caller) and, at the end, to every holdout entry. A metric that gets worse, or a new miss, goes to Joseph with numbers. No further change is made for it under this spec.
- The holdout (2024-2025) runs once, after H1, for each pipeline whose inputs changed (game, plus caller, engine and C7 if their tables changed). Each is labelled "post hoc, step 5c" with its run count in the report and in DECISIONS.md.

## Pre-registered checks

The engineer writes the table below verbatim into data/game/step5c-checks.json (milestone 0). The thresholds were accepted by the lead as written (Resolved 1). The file is never edited after its hash is recorded.

Each measure is designed and computed the same way on both sides: a pipeline module for real 2016-2023 regular season and a script for the sim's in-sample run. "Per game" is per game, not per team-game. "Gap" means the game-clock seconds between two consecutive scrimmage snaps of one drive with no timeout, period end or two-minute warning between them.

| Id | Measure | Pass rule | Playtest reference (sim vs real) |
| --- | --- | --- | --- |
| `c.ot.complete` | Postseason games, league 4242, seeds 1-10,000: games without a record, and tied games | both 0 | 1 crash in 1,000 |
| `c.trail.lastSnap` | Share of games whose last Q4 scrimmage snap is by an offense trailing by 1-8 with 1 or more timeouts and 15 s or more on the clock at the snap | abs(sim - real) <= 0.6 pp | 2.8% vs 1.2% |
| `c.trail.longGap` | Q4 final 2:00, offense trailing 1-8 with 1 or more timeouts: share of gaps of 35 s or more | abs(sim - real) <= 3 pp | not measured this way |
| `c.spike.stopped` | Spikes snapped with the clock stopped, per game | abs(sim - real) <= 0.02 | 0.13 vs not measured |
| `c.kneel.ballBack` | Of games where the leader kneels in Q4, the share where the opponent then snaps in regulation | abs(sim - real) <= 2 pp | 36.8% vs 1.9% |
| `c.kneel.shortGap0TO` | Q4 final 2:00, leading offense, defense with 0 timeouts: share of gaps of 15 s or less | abs(sim - real) <= 3 pp | 11.8% vs not measured |
| `c.kneel.early` | Kneels in Q1, Q3, or Q2 with more than 1:00 left, per game | sim <= real + 0.001 | 0.007 vs 0 |
| `c.fg.60` | Field goal tries of 60+ yards, per game | abs(sim - real) <= 0.015 | 0.225 vs 0.029 |
| `c.fg.63` | Tries of 63+ yards, per game | abs(sim - real) <= 0.008 | 0.163 vs 0.0086 |
| `c.fg.70` | Tries of 70+ yards, per game | sim <= 0.002 | 0.060 vs 0.0005 |
| `c.fg.50to59` | Tries of 50-59 yards, per game (guards against over-correction) | abs(sim - real) <= 0.05 | - |
| `c.try.down2GF` | Q4 final 2:00, trailing by 2 after the touchdown: two-point share of tries | sim >= real - 15 pp | 14/34 vs 28/28 |
| `c.try.tiedG5` | Q4 final 5:00, tied after the touchdown: extra-point share of tries | sim >= real - 10 pp | 73/92 vs 45/45 |
| `c.to.kickoffQ13` | Timeouts before kickoffs in Q1-Q3, per game | abs(sim - real) <= 0.02 | 0.257 vs 0.0033 |
| `c.to.tryQ13` | Timeouts before tries in Q1-Q3, per game | abs(sim - real) <= 0.02 | 0.174 vs 0.0105 |
| `c.to.kickoffAll` | Timeouts before kickoffs, all periods, per game | abs(sim - real) <= 0.03 | 0.332 vs 0.050 |
| `c.rough.scramble` | Accepted roughing the passer on QB scrambles, per game | abs(sim - real) <= 0.005 | 0.02 vs not measured |

Reported, not gated: the playtester's "Q4 ends on a run-off by a 1-8 trailer holding timeouts" share; every `absMargin.share.*` bucket, the exact-3 margin share and the overtime-ending-on-3 share; postseason periods played per OT game.

## Milestones

Each ships on its own branch and goes through code-reviewer and test-writer. Every milestone that changes sim behavior regenerates the step 5 slice digests in the same change, keeps purity and import tests passing, and stays at or under 25 ms a game.

### 0: checks and measures (no sim change)

Order, strict:
1. The engineer creates data/game/step5c-checks.json from the table above, commits it alone, and stops.
2. The lead records its sha256 in DECISIONS.md with a timestamp.
3. Only then does any diagnosis, measure code or sim run begin.

| # | Criterion | How it fails |
| --- | --- | --- |
| 0.1 | The checks file matches the table above. Its commit contains nothing else. Its sha256 is in DECISIONS.md with a timestamp earlier than any diagnosis run, measure commit or sim run. | Hash missing, other changes in the commit, or the hash recorded after a run. |
| 0.2 | One pipeline command computes the real side of every check, byte-identical on rerun. pytest shows no 2024-2026 row and checks each measure on a hand-made frame (one positive and one negative case per measure). | Diff, holdout row, or wrong count. |
| 0.3 | The sim side runs on the current commit and reproduces the playtest's direction on every check (each fails or sits on the playtest side of real). The baseline table goes in GAME_REPORT.md. | A measure missing, or a definition that disagrees with the playtest's direction without a written reason. |

### A: postseason overtime finishes (finding 1)

- Diagnosis: why the 260-snap cap is reachable. The cap was sized for regulation plus one OT, and postseason has no period limit (RULES.md, `overtime.postseason.maxPeriods` null, Rule 16-1-4). The debugger also checks whether three scoreless 15-minute periods are a symptom of finding 4 (the missed tries at OT3 5:09 and 2:04 in seed 599) and reports it, without fixing it here.
- Fix: the cap still catches a stuck loop, but it can't fire on a legal game that is still making progress. How it scales (per period, per possession) is the engineer's call. Any value goes in data/game/config.json.

| # | Criterion | How it fails |
| --- | --- | --- |
| A1 | Regression: league 4242, seed 599, postseason returns a record with a winner, and two runs give the same digest. | Throws, ties, or digests differ. |
| A2 | `c.ot.complete` passes. | A crash or a tie. |
| A3 | A game forced to go past OT4 (fixture) gets a new coin toss after the 4th OT period, three timeouts per half of two periods, and the timing in `overtime.postseason.timingAsPeriod`. | Any rule differs from RULES.md. |
| A5 | The CLI takes `--game-type regular|postseason` (Resolved 4), default regular. `--game-type postseason --league-seed 4242 --seed 599` prints the full game, and the game type is on the header lines. Default output is byte-identical to before. | Flag missing, game type not shown, or default output changes. |
| A4 | The existing tiny-cap test still throws `inputCap`, and a fixture that loops without progress still throws `snapCap`. Regular-season games are unchanged (same digests). | No throw, or a regular-season digest changes. |

### B: field goal range (finding 4)

- Diagnosis: for every 60+ try in the in-sample run, which factor (o4Kick, oTop) and which level chose it, and whether a zone bin pools kicks of very different length (for example zoneK K50 spans the opp 38-50, which is 55-67 yard tries). The debugger reports the split.
- Fix constraints: shares stay fitted, with finer designed bins near the edge of range. On top of that (Resolved 3), a try is masked wherever the engine's make chance is 0. Where that zero comes from: it is a designed rule, not the fitted curve's support. The step 4 decision (DECISIONS.md, step 4, field goals beyond the training range) caps the fitted curve at the longest distance with at least 20 attempts (59 yards now, `capAt`) and then falls linearly to 0 at the designed `maxDistance` of 70 (data/engine/baseline.special.json `fieldGoals`). The mask reads those data values and has no limit of its own. MODEL.md labels it designed and names that source. When a try is masked, the remaining options keep their relative fitted weights.

| # | Criterion | How it fails |
| --- | --- | --- |
| B1 | `c.fg.60`, `c.fg.63`, `c.fg.70` and `c.fg.50to59` pass in-sample. | Any outside its rule. |
| B1b | No try is attempted at a distance where the engine's make chance is 0. A test changes `maxDistance` in a fixture and the mask follows it. | A try at make chance 0, or a mask that ignores the data value. |
| B2 | Regression: league 2026 seed 10 (ev 139, 80-yard try on 2nd and 10 at Q2 0:04) and seed 30 (ev 11, 68-yard try at midfield) no longer try those kicks. | Either still tries. |
| B3 | Situations outside the changed cells give byte-identical caller weights (frozen golden fixture). | Any difference. |
| B4 | `fieldGoalAttempts.perGame`, `driveResult.share.fieldGoal` and `driveResult.share.missedFieldGoal` still pass in-sample. | A regression. |

### C: try choice reads the late score (finding 5)

- Diagnosis: which O-try bins and levels the two cells reach (score after the touchdown, time), and how many 2016-2023 tries each candidate late cell holds.
- Fix (Resolved 2): the try choice sees the score after the touchdown and the late window. Late cells with at least 150 real tries are fitted. Only cells under N = 150 use a narrow designed chart, kept in data and labelled designed in MODEL.md. The report shows the real 2016-2023 try counts and shares next to each chart cell. Outside the final 5:00 of Q4 and OT, the shares are byte-identical. A try replayed after a foul uses the same choice rule for its new spot.

| # | Criterion | How it fails |
| --- | --- | --- |
| C1 | `c.try.down2GF` and `c.try.tiedG5` pass in-sample. | Either fails. |
| C2 | Regression: league 2026 seed 543, ev 256-257, the replayed try after roughing is a two-point try. | It kicks. |
| C3 | `twoPointTries.perGame` still passes in-sample. Try shares outside the late windows are unchanged (fixture). | A regression or a change. |
| C4 | The report shows sim vs real try shares for every post-touchdown score from -8 to +8 in G5 and GF, with n. Not gated. | Missing. |

### D: kickoff and try timeouts by period (finding 6)

- Diagnosis first (not obvious): the fitted per-role rates (1.58-2.43% per event, revision 4) imply about 0.33 kickoff timeouts a game, while the playtest counts 0.050 real. The debugger reconciles the two definitions on 2016-2023 (which pbp rows the fit counted as "before a kickoff or try") before any fix.
- Fix: fitted rates with designed time bins (at least Q1-Q3 vs the late windows), and the attribution corrected if the diagnosis shows it was wrong. No other timeout rate changes.

| # | Criterion | How it fails |
| --- | --- | --- |
| D1 | `c.to.kickoffQ13`, `c.to.tryQ13` and `c.to.kickoffAll` pass in-sample. | Any fails. |
| D2 | Regression: league 2026 seed 1, Q3 8:12, no defense timeout before the kickoff. | Timeout called. |
| D3 | C7 passes in-sample. `timeouts.perTeamGame` still passes. If it fails, it goes to Joseph and no other timeout rate is raised to cover it. | Regression covered by tuning. |
| D4 | Scrimmage timeout rates for a frozen set of at least 200 dead-ball views are identical. | Any changes. |

### E: the trailing team uses its clock (findings 2 and 9)

- Diagnosis (debugger): for the games counted by `c.trail.lastSnap` and the repros (seed 93 ev 256-261, seed 3 ev 279-281, seed 12 Q4 0:47), split the cause between the timeout policy (asked and declined: which cell, which level), the order of the ask and the run-off, and the tempo draw. Do the same for spikes with the clock stopped (seed 12 ev 254).
- Fix constraints: fitted rates with finer designed late bins are the default. A designed rule (like the existing ten-second rule) is allowed if the diagnosis shows the data can't support a cell, labelled designed, parameters in data. A tied team isn't forced to stop the clock: real tied teams in their own end let it run to overtime, so any rule for tied teams depends on field position. The tied repro C's missing early-down field goal is the accepted miss `diag.final2FieldGoalAttempts.tied`, which is reported here, not fixed.

| # | Criterion | How it fails |
| --- | --- | --- |
| E1 | `c.trail.lastSnap`, `c.trail.longGap` and `c.spike.stopped` pass in-sample. | Any fails. |
| E2 | Regressions: seed 93, the trailer calls a timeout before 0:08, and seed 3 the trailer calls one before the 40 s run-off. Seed 12 ev 254 has no spike. | Any repro unchanged. |
| E3 | The in-sample report gives `absMargin.share.1-3`, `absMargin.share.8-14` and the exact-3 share before and after E, with the league-seed spread. | Missing. |

### F: the leader kneels only when it can (findings 3 and 7)

- Diagnosis (debugger): the K0 kneel share already matches per snap (25.0% vs 25.1%, CALLER_REPORT 8d), yet the ball comes back far too often. Find where inside K0 the sim and real teams kneel (seconds short of kneeling out, defense timeouts), whether the trailing defense uses its timeouts after the kneels, and whether the tempo bins miss the defense's timeouts (the 11.8% short-gap rate). For finding 7, name the factor and level that returns a kneel on 4th and goal in Q1 (seed 9 ev 55, seed 892 ev 50).
- Fix constraints: the 5b kneel-out test stays as it is unless the diagnosis shows it is wrong. Shares stay fitted with designed bins. Any mask on early kneels is designed and covers only the states 2016-2023 never shows.

| # | Criterion | How it fails |
| --- | --- | --- |
| F1 | `c.kneel.ballBack`, `c.kneel.shortGap0TO` and `c.kneel.early` pass in-sample. | Any fails. |
| F2 | Regressions: league 7 seed 11, the leader does not kneel at Q4 1:16 while the defense can stop the clock. League 2026 seed 9 ev 55 and seed 892 ev 50 do not kneel. | Any repro unchanged. |
| F3 | CALLER_REPORT 8d kneel rows (K1, K0) and `lateDowns.>=17.kneel` are at or better than before. | Worse. |
| F4 | As E3, after F. | Missing. |

### G: text, display and roughing on scrambles (finding 10)

- G1, text only (no sim change, digests unchanged except text output):
  - An offense-recovered fumble prints the catch or run, the fumble and the recovery, from PlayResult fields (league 2026 seed 1, Q1 7:41).
  - Matchup lines state the direction: a multiplier above 1 "made it more likely", below 1 "the result happened despite" it (seed 1, Q1 4:39). The factor and number are unchanged.
  - "fluke" and "common" are used only on the sides of designed probability thresholds kept in data. A 28.3% result is never a fluke, and a 5% result is never common (seed 14, OT 5:42).
  - Drive yards are net, from the start spot to the end spot, penalties included. A touchdown drive from the own 14 shows 86 (seed 1, drive 2).
  - "End of Q4" prints once around the overtime toss (seeds 12 and 14).
  - Criterion: a golden-text test on each repro, and a check over 1,500 games that no line breaks these rules. It fails on any instance.
- G2, roughing on scrambles (engine): the pipeline counts real 2016-2023 roughing the passer on `qb_scramble` plays, and the rule on when a passer's protection ends is looked up and cited in RULES.md. If `c.rough.scramble` fails, the engine stops drawing it on scrambles and the step 4 in-sample validation is rerun (penalty rates unchanged except this foul). If it passes, nothing changes, and DECISIONS.md records why.

### H: recheck, holdout and playtest gate

| # | Criterion | How it fails |
| --- | --- | --- |
| H1 | Final in-sample 10k: every pre-registered check passes. Every gated metric that passed still passes. Every accepted in-sample miss is at or better than its accepted value. A before/after table by milestone, with the close-margin rows and the note on what E and F did to the 1-3 miss. | A check fails, a regression, or a worse accepted miss not sent to Joseph. |
| H2 | Holdout once per changed pipeline, after H1, labelled post hoc with its run count. Accepted holdout misses compared under the same rule. | Run before H1, unlabelled, or run again without a count. |
| H3 | playtester reruns every repro seed above, plus the 4,000-game soak and the 1,000-game postseason soak, and reports any new late-game call no coach would make. | Not run. |

## Edge cases that are reachable

- Postseason OT5: a new toss after OT4, timeouts reset each two-period half, OT6 ends with first-half timing.
- Trailing by 2 after a touchdown with 0:00 on the clock: the try is played (`try.skipWhenOutcomeDecided` doesn't skip it), and the two-point rule applies.
- In overtime, the second team scores a touchdown to tie with both possessions done: no 2016-2023 counterpart. It backs off to the late regulation cell, and the report shows the share.
- A try replayed after a defensive foul: new spot, same choice rule.
- 0:04 left in Q2 at the own 30, 2nd down: with no field goal available, the fitted remaining options decide (for example a long pass).
- 4th and 8 at the opp 45 in Q1: a 62-yard try is still possible if 2016-2023 shows it there. The fix doesn't remove every long try.
- Tied, own 20, 0:30, 2 timeouts: letting it run is a real choice and doesn't count against `c.trail.*`.
- Leading by 4, 1st and 10, 1:50 left, defense with 0 timeouts: kneel out (122 >= 110). With 1 timeout: not (82 < 110).
- A free kick after a safety: it uses the same kickoff-timeout bins.
- An untimed down after a defensive foul at Q4 0:00, with the trailer holding timeouts: not a run-off, so it isn't counted as one.

## Dependencies and sequencing

- 0 first. A and G1 can go any time after 0, since they don't interact. B, C and D next, in any order. E and F after D, because D changes how many timeouts each team has left late. F after E, because both move the close-margin share and the report needs to show each one's effect. G2 any time after 0. H last.
- Real fits and the 10,000-game runs happen on Joseph's machine with the warm cache. CI runs fixtures, slice digests and the summary checks.
- Ask-first changes (config schema or version bumps for the caller, game or engine tables) are approved by the lead under this spec, as in 5b.

## Locked vs likely to change

Locked: 2016-2023 only; tolerances and known deviations untouched; the checks file is hashed before any run and never edited; one holdout per changed pipeline, post hoc, counted; regressions go to Joseph, not to tuning; text changes only reword trace factors.

Likely to change: the exact bins after each diagnosis; which late try cells fall under N = 150 and so use the chart; whether G2 changes the engine; whether D drops `timeouts.perTeamGame` below its gate.

## Open questions

None open. All seven were resolved by the lead (below).

## Resolved (lead, 2026-11-12)

1. Thresholds: accepted as written in "Pre-registered checks".
2. Try cells with too few real tries: a narrow designed chart, labelled designed in MODEL.md, applied only to cells under N = 150. The real counts are reported next to it. Cells at N or above stay fitted (milestone C).
3. Field goal tries are masked where the engine's make chance is 0. That zero is the step 4 designed rule (linear from `capAt` to 0 at `maxDistance` 70, in data), not the fitted curve's support. The spec states this so the mask isn't a hidden cap (milestone B, B1b).
4. A `--game-type` CLI flag is added (A5).
5. Finding 8 is deferred and listed as future work for a later o4Top spec.
6. Finding 11 is deferred to the M2 designer.
7. "At or better" stays strict, with no noise allowance. Anything worse goes to Joseph, and the report shows the league-seed spread next to it so he can judge noise.
