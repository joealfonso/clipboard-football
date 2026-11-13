# M1 step 5d: clock fixes after the 5c playtest

Status: draft, 2026-11-13. Owner: Joseph. Amends the step 5b and 5c specs for the factors named here. Sources: docs/PLAYTEST_M1_5C.md (run at `d94384c`), the debugger's diagnosis at `4f25b28` (to be copied into DECISIONS.md, see milestone 0).

## Goal

Make late-game clock use look like what NFL teams do: a trailer with no timeouts hurries or spikes, a team that can't kneel out the clock doesn't kneel, and an overtime try that decides the game reads the score.

For: Joseph, who owns the M1 gate, and the engineer, debugger and test-writer closing M1 step 5.

## Non-goals

- PLAYTEST_M1_5C findings 4, 5 and 6 (touchdown yards on the play line, run-off longer than the clock, "End of half" on the last drive, missed extra point wording, "no good (75% chance)", QB sneak at 5+ to go). Deferred to M2, which rewrites the text.
- Earlier deferred findings: punting while trailing late in the opponent's half (PLAYTEST_M1 finding 8) and defense presets on screen (finding 11).
- The accepted `c.fg.63` and `c.fg.50to59` misses, and spikes outside the final 2:00 of Q4 and OT (Q2 end-of-half spikes included).
- Tolerances. data/game/tolerances.json, data/caller/tolerances.json and data/engine/tolerances.json stay byte-identical. The engineer adds no `known_deviations`. Only Joseph does.
- Retuning one metric to make up for another.

## Locked rules

1. Fitting uses 2016-2023 regular season only. No number here is chosen by looking at 2024-2026. The playtester's and debugger's numbers are references, never targets.
2. The sim stays pure: one seeded Rng, same seed gives the same game. `resolvePlay` decides every outcome. Coach policies decide only choices.
3. Every new number lives in a data file. MODEL.md labels each new part fitted, designed or mixed.
4. Fitted wherever there is data: a cell needs N = 150 or more, and states below that are pooled (the diagnosis's pooling, for example downs 2-3 together) or back off to the next level. Designed rules only where 2016-2023 has zero or near-zero cases, each one counted in the report and cited. A mask removes only choices with a real count of exactly 0.
5. Variance is not flattened. The why line comes only from trace factors.
6. Rule facts come from docs/RULES.md (2026 rulebook). Any new rule fact, including the overtime rules in force in each season 2016-2023, is looked up and cited there, not written from memory.
7. The schema change below is approved by Joseph (2026-11-13) for exactly the two fields named. Any other Situation, config schema or version change is ask-first.

## Scope

| # | Finding (PLAYTEST_M1_5C) | Milestone |
| --- | --- | --- |
| 1a | Too few spikes by a trailer with 0 timeouts | A, C |
| 1b | Final-minute gaps of 15 s or more for a 1-8 trailer with 0 timeouts (36.2% vs 23.1%) | B |
| 2 | Kneels by leaders who can't kneel out, and by trailing or tied teams | D |
| 3 | Overtime try more than 5:00 from the end ignores the score | A, E |
| 4-6 | Text and sneak | deferred to M2 |

## Calibration rules for this step

- The in-sample run is 10,000 games, run seed 20261112, the same 10 league seeds as GAME_REPORT.md, against 2016-2023. It runs after each milestone that changes sim behavior (B, C, D, E) and once at the end (H).
- A gated metric that passed must still pass. This includes caller rows with an accepted entry that now pass (`lateDowns.>=17.kneel`, 25.3% at run H).
- An accepted miss stays accepted only at or better than its accepted value, |observed - target| no larger than the value in DECISIONS.md ("Step 5 misses accepted", "5c holdout and C3 misses accepted", "5c checks accepted", and `b9.c.kneel.K0` at 23.7% vs 25.1%). Strict, no noise allowance. Anything worse, or any new gated miss, goes to Joseph with numbers and the league-seed spread before any holdout run. No further change is made for it under this spec.
- Holdouts: after H1 and Joseph's decisions, once per changed pipeline, labelled "post hoc, step 5d" and counted (milestone H).

## Pre-registered checks

The engineer writes the table below verbatim into data/game/step5d-checks.json (milestone 0). The file is never edited after its hash is recorded.

Note on order: unlike 5c, the playtest and the diagnosis measured some real values before these thresholds were written (23.1%, 69.5%, 0.075). Each tolerance below is set from the sampling noise of the real count and the sim's 10,000 games, not from where the sim is expected to land.

Definitions, same on both sides (a pipeline module for real 2016-2023 regular season, 2,095 games, and a script for the sim's in-sample run): "per game" is per game, not per team-game. "Gap" is as in `c.trail.longGap`: game seconds between two consecutive scrimmage snaps of one drive with no timeout, two-minute warning or period end between them. "Clock running" at a snap is the `clockRunning` field of milestone A. Leading, trailing and tied are the offense's score at the snap. In overtime, "left" means left in the period.

| Id | Measure | Pass rule | Why this tolerance | Reference (sim vs real) |
| --- | --- | --- | --- | --- |
| `d.spike.trail0TO` | Q4 and OT spikes by an offense trailing by 1-8 with 0 timeouts, per game | abs(sim - real) <= 0.015 | About 2 combined standard errors (real about 157 spikes, SE 0.006; sim SE 0.003); 20% of real | 0.0063 vs 0.075 |
| `d.spike.running0TO` | Q4 final 2:00 and OT, offense trailing by 1-8 with 0 timeouts, downs 1-3, clock running: spike share of snaps | abs(sim - real) <= 6 pp | About 2.5 SE at the expected real n of 400-600 snaps | real 69.5% (114/164) on 1st down in the final 0:40 |
| `d.spike.stopped0TO` | Same states, clock stopped: spike share of snaps | sim <= real + 1 pp | Real is near 0; one-sided guard that the new level doesn't reopen stopped-clock spikes | real 1 in 242 on 1st down in the final 0:40 |
| `d.gap.trail0TO` | Q4 final 1:00, offense trailing by 1-8 with 0 timeouts: share of gaps of 15 s or more | abs(sim - real) <= 4 pp | About 2 combined SE (real n 844, SE 1.45 pp; sim SE about 0.9 pp) | 36.2% vs 23.1% |
| `d.kneel.notLeading` | Q4 and OT kneels by an offense trailing or tied with more than 0:47 left, per game | abs(sim - real) <= 0.005 | About 2.5 SE of a real count near 20; two-sided, because some real trailer kneels (down 1-2 in the red zone) are real choices | trailers with 60 s+: 0.025 vs 0.0033 |
| `d.kneel.thenPlay.lead1to8` | Q4 and OT possessions where an offense leading by 1-8 kneels and later on the same possession snaps a run or pass, per game | abs(sim - real) <= 0.004 | About 2.5 SE of a real count of 8 | 0.025 vs 0.0038 |
| `d.kneel.thenPlay.lead9` | Same, leading by 9 or more | abs(sim - real) <= 0.004 | Same basis, real count 4 | 0.078 vs 0.0019 |
| `d.kneel.thenPlay.notLeading` | Same, trailing or tied | sim <= real + 0.002 | Real count 0; allows about 20 cases in 10,000 games | 0.046 vs 0 |
| `d.kneel.4thLate` | Q4 and OT kneels on 4th down with more than 10 s left, per game | abs(sim - real) <= 0.004 | About 2 SE of a real count of 16 | 0.013 vs 0.0076 |
| `d.try.otDown2` | Overtime tries with the score -2 after the touchdown and `otBothPossessed` 1: two-point share. Sim side: the in-sample run's OT games plus league 4242 postseason seeds 1-10,000 | every such sim try is a two-point try; n reported on both sides | Designed rule (milestone E), real count expected near 0; the rule is binary, so no tolerance | sim 0 of 1 (kick, seed 6537) |

No regression of the 5c checks (data/game/step5c-checks.json, sha256 `2c9f4591…`): the 14 checks that pass at run H still pass; `c.kneel.ballBack` (8.97%), `c.fg.63` (0.0254) and `c.fg.50to59` (0.764) stay at or better than their run H values. The file lists these by id with the 5c hash.

Reported, not gated: spikes per game, all periods (real 0.262); spikes by 1-8 trailers holding 1+ timeouts; `d.gap.trail0TO` over the final 2:00; `d.kneel.notLeading` split into trailing 1-8, trailing 9+ and tied; real and sim n for every cell a new level fits; every `absMargin.share.*` bucket and the exact-3 share.

## Milestones

Each ships on its own branch and goes through code-reviewer and test-writer. Every milestone that changes sim behavior regenerates the step 5 slice digests in the same change, keeps purity and import tests passing, and stays at or under 25 ms a game.

### 0: checks, diagnosis on record, measures (no sim change)

Order, strict:
1. The engineer creates data/game/step5d-checks.json from the table above, commits it alone, and stops.
2. The lead records its sha256 in DECISIONS.md with a timestamp, and copies the debugger's 5d diagnosis there (locked rule 7 of 5c: the diagnosis is on record before a fix lands).
3. Only then does measure code or any sim run begin.

| # | Criterion | How it fails |
| --- | --- | --- |
| 0.1 | The checks file matches the table. Its commit contains nothing else. Its hash is in DECISIONS.md with a timestamp earlier than any measure commit or sim run. | Hash missing, other changes in the commit, or recorded after a run. |
| 0.2 | One pipeline command computes the real side of every 5d check, byte-identical on rerun. pytest shows no 2024-2026 row and checks each measure on a hand-made frame (one positive and one negative case each). | Diff, holdout row, wrong count. |
| 0.3 | The sim side runs on `4f25b28` and reproduces the playtest's direction on every check it measured. The baseline table goes in GAME_REPORT.md. | A measure missing, or a direction that disagrees without a written reason. |

0.2 and 0.3 need `clockRunning` and `otBothPossessed` for some measures. Those parts of 0.2 and 0.3 land with A; the rest can land first.

### A: two Situation fields (schema change, no behavior change)

Fields, added to `Situation` and `SITUATION_FIELDS` in packages/shared/src/situation.ts. The zod caller config schema (packages/shared/src/schema.ts) builds its numeric field enum from `SITUATION_FIELDS`, so dimensions and availability rules may then name them. Both are 0 or 1, so existing bin types read them.

- `clockRunning`: 1 when the game clock is running at the snap, else 0. Always 0 on a try. In the sim it is the game state's `clockRunning` at the snap (packages/sim/src/game/types.ts), so it is 0 after a timeout, the two-minute warning, a period start or any clock-stopping play.
- `otBothPossessed`: 1 in overtime once the second team has had its opportunity to possess (Rule 16-1-3 (a)-(c) and 16-1-4 (a)-(c), RULES.md Overtime; a kickoff to it counts, Rule 16-1-5 (c), `overtime.*.kickOpportunityCounts`), else 0. Always 0 in regulation. Once 1 it stays 1 for the rest of the game, through later postseason periods and a new toss. In the sim it is `overtime.secondTeamPossessed`, which turns on with the second team's first snap or kick opportunity, so it is already 1 during the second team's first possession and at its try.

Pipeline columns, mapped in pipeline/caller/frames.py `SITUATION_COLUMNS`:

- `clock_running` -> `clockRunning`. nflverse has no clock-state field, so this is designed and labelled so in MODEL.md. It is the reading the game pipeline already uses for tempo and for `c.spike.stopped`: `decisions.clock_running` (pipeline/game/decisions.py), and 0 when a timeout was called in the dead ball before the snap, with timeout rows placed by revision 1's clock order (`decisions.clock_order`). Inputs: `qtr`, `half_seconds_remaining`, `game_seconds_remaining`, `play_type`, `posteam`, `is_try` (the pipeline's own), `incomplete_pass`, `qb_spike`, `interception`, `fumble_lost`, `penalty`, `out_of_bounds`, `timeout`, `timeout_team`, and revision 1's `quarter_seconds_remaining` and time of day.
- `ot_both_possessed` -> `otBothPossessed`. A fact about who had the ball, derived the same way in every season: 0 on every regulation row; in an OT game, the first team is the team that receives OT's first possession; the flag turns on at the first OT row where the other team has the ball on a scrimmage play or receives a kick from the first team, and stays on. Inputs: `qtr`, `posteam`, `defteam`, `play_type`, `game_id`, row order.
- DATA.md cites the nflverse play-by-play field definitions (nflreadpy's pbp data dictionary) for every input above, quoting each definition. Which team `posteam` names on a kickoff row is checked against that dictionary and a known game, and stated there.
- Before any OT row is used, RULES.md cites the overtime possession rules in force in each season 2016-2023 (they differ from the 2026 rules the sim plays). The flag is still derived as a fact, not from those rules.

| # | Criterion | How it fails |
| --- | --- | --- |
| A1 | A caller config with a dimension on `clockRunning` or `otBothPossessed` parses; a misspelled field is rejected; the Situation/`SITUATION_FIELDS` sync test passes. | Parse error, or an unknown field accepted. |
| A2 | Sim fixtures: incompletion then snap gives `clockRunning` 0; in-bounds run in Q3 gives 1; snap after a timeout gives 0; a try gives 0. OT: the first team's snaps give `otBothPossessed` 0; the second team's first snap gives 1; its try after a touchdown gives 1; after an onside kick the first team recovers, the first team's next snap gives 1; postseason OT3 and OT5 give 1; any regulation snap gives 0. | Any value differs. |
| A3 | pytest on hand-made frames, one positive and one negative per rule above for each column. On 2016-2023, the caller's `clock_running` equals the game pipeline's reading on every shared snap (count reported). No 2024-2026 row. Rebuild byte-identical. | Mismatch, holdout row, or diff. |
| A4 | No behavior change: every caller table, the golden file, every game table and every slice digest is byte-identical, since no level reads the new fields yet. | Any difference. |
| A5 | The report gives, on 2016-2023: snaps in Q4 final 2:00 by 1-8 trailers with 0 timeouts by `clock_running` and down; OT tries by `ot_both_possessed` and score after the touchdown; and the count of snaps where the caller's timeouts at the snap disagree with the game pipeline's (open question 3). | Missing. |

### B: tempo keeps the offense's own timeouts (finding 1b)

- Fix (data and refit only): a fitted tempo level between L0 and L1 keyed on (time5, score3, ownTO, prevKneel, restart, toCalled), the diagnosis's level, in data/game/config.json and the refit tempo table. Same seasons as the existing tempo fit. Cells under N = 150 back off as now.
- The diagnosis's untested leftovers (in-bounds play-ending mix, missing post-spike gaps) are reported, not fixed.

| # | Criterion | How it fails |
| --- | --- | --- |
| B1 | `d.gap.trail0TO` passes in-sample. `c.trail.lastSnap`, `c.trail.longGap` and `c.kneel.shortGap0TO` still pass. | Any fails. |
| B2 | Repro fixtures, states captured from the `--format json` record at `4f25b28`: league 7 seed 11 after ev 268, league 2026 seed 3 after ev 264, seed 26 after ev 273. Each run-off comes from a cell of the new level with ownTO 0 (trace level and key), not L1 `GF|c40|T|0|0|0`. Amended (lead, 2026-11-13): seed 26 after ev 273 (0:55) is served by the first level, which already keys ownTO (`GF|c120|T|0|0|0|0`), as it was at `4f25b28`; for it the criterion is an ownTO 0 cell of that level, not the new one. | Old cell, or no trace. |
| B3 | A frozen set of at least 200 tempo views that reach L0 or that the new level doesn't cover gives byte-identical run-off weights. | Any change. |
| B4 | C7 in-sample passes, with accepted rows at or better. `timeouts.perTeamGame` still passes. | Regression. |

### C: clock-aware spike level (finding 1a)

- Fix: a fitted oTop level ahead of L6 for the late windows (Q4 final 2:00, and OT as the 5b correction maps it), keyed on down, `clockRunning`, own timeouts (0 / 1+) and the late score. Downs are pooled where a cell would fall under N = 150 (the diagnosis: downs 2-3 have about 100-130 snaps each). The 5c stopped-clock mask (`clockRules.callerMasks.spikeNeedsRunningClock`) stays in force.

| # | Criterion | How it fails |
| --- | --- | --- |
| C1 | `d.spike.trail0TO`, `d.spike.running0TO`, `d.spike.stopped0TO` pass in-sample. `c.spike.stopped` still passes. | Any fails. |
| C2 | Repro fixtures (same three states as B2, at their next snap with the clock running): the offense call comes from the new level, cell `clockRunning` 1 and ownTO 0, and the spike share equals that fitted cell. | Other level or share. |
| C3 | Caller weights outside the new level's states are byte-identical (frozen golden fixture). | Any difference. |
| C4 | The report gives N and real vs fitted spike share for every new cell. CALLER_REPORT in-sample rows at or better. | Missing, or a row worse. |

### D: late kneels only by teams that can kneel out (finding 2)

- Fix, fitted with designed bins:
  1. Late oTop levels ahead of L6-L8 for an offense not leading, with the score split -3..-1 / -8..-4 (tied and down 9+ as their own buckets) and a c40/c120 clock split.
  2. K0x split by defense timeouts (0 / 1+).
  3. The K0c split (defense holding 0-1 vs 2-3 timeouts, hard-coded in packages/sim/src/caller/bins.ts and pipeline/caller/bins.py) moved into data/caller/config.json, same value.
  4. A c40 band on the late o4Top levels.
  5. Designed kneel masks only for late states where 2016-2023 has exactly 0 kneels, counted per state first and listed in MODEL.md with the count. The diagnosis's candidates (trailers down 9+ before 0:47, trailers down 3-8 in the red zone) are masked only if the count is 0.
- Unchanged: the 5b kneel-out test, every K1 cell, `callerMasks.earlyKneel`, `kneelOutDrain`.

| # | Criterion | How it fails |
| --- | --- | --- |
| D1 | `d.kneel.notLeading`, `d.kneel.thenPlay.*` and `d.kneel.4thLate` pass in-sample. `c.kneel.ballBack` at or better than 8.97%; `c.kneel.early` and `c.kneel.shortGap0TO` pass. | Any fails or is worse. |
| D2 | Repro fixtures from `4f25b28` records. League 2026 seed 26 ev 263 (up 2, Q4 1:20, defense 3 timeouts, 1st down): the call comes from the K0x cell for defense 1+ timeouts. Seed 229 ev 270 (up 2, Q4 1:17, 4th and 13 at the own 40): the call comes from a c40-banded late o4Top cell. Seed 107 ev 264 (down 4, 1st and goal at the opp 3, Q4 1:16) and seed 4 ev 250 (down 12, Q4 1:59, 1st and 10): the call comes from a not-leading late level. In each, the kneel share equals the cell's fitted share, and is 0 where the cell's real 2016-2023 kneel count is 0 (n printed). Amended (lead, 2026-11-13), for what the bins and data give: seed 26 ev 263 is K0c.d23, not K0x (three kneels from 1:20 run the clock out if the defense uses no timeout, 3 x 40 + 2 >= 80), and its kneel share is that cell's; seed 229 ev 270's c40-banded cell has under 150 real snaps, so the call comes from the unbanded late o4Top level `[fieldHalf, scoreLate5Only, lateTime]` it backs off to; seeds 107 and 4 are served by C's spike level `[down, clockRun, ownTO2, scoreTrail, timeGF, fgRange]`, which comes ahead of the not-leading levels (the lead keeps that order), and their kneel share is 0 through the designed late-kneel mask (trailing 3-8; trailing 9+ with more than 0:47 left). | Old level, or a kneel share where the real count is 0. |
| D3 | A fixture that changes the K0c threshold in data moves the bin; neither bins file holds the literal; with the shipped value, caller weights and the golden file are byte-identical. | Literal remains, or any change. |
| D4 | Caller in-sample: `b9.c.kneel.K0` at or better than 23.7% vs 25.1%; `lateDowns.>=17.kneel` still passes; K1 rows unchanged; the 5b kneel-out test passes unedited. | Any regression. |
| D5 | Each designed mask has its real count (0) and source in MODEL.md, and a test that the state is masked and a neighbouring state with a nonzero count is not. | Mask on a state with real kneels, or no count. |

### E: overtime try reads the score (finding 3)

- Rule (designed): an overtime try with `otBothPossessed` 1 reads the GF cell of `tryLate` whatever the clock: charted where `tryChart` charts it (down 2: two-point; tied: kick), fitted GF backoff otherwise (down 1). Basis: once both teams have possessed, the try can end the game (RULES.md Overtime, Rule 16-1-3, 16-1-4, 16-1-5). MODEL.md labels it designed and gives the real 2016-2023 OT try counts by flag and score (A5).
- It is designed only for score cells with fewer than 10 real OT tries (the 5c chart's 10-try floor). A cell at or above that goes back to the lead before any build.
- With `otBothPossessed` 0 (the first team's first-possession touchdown, up 6) the try choice is unchanged.

| # | Criterion | How it fails |
| --- | --- | --- |
| E1 | `d.try.otDown2` passes. | A kick. |
| E2 | Repro: postseason league 4242 seed 6537, state at ev 296 (down 2 after the touchdown, OT 6:21): the try is two-point on each of 1,000 draws. | Any kick. |
| E3 | Fixtures with flag 1: tied after the TD kicks; down 1 gives the GF fitted shares. With flag 0, up 6: shares byte-identical to `4f25b28`. Every regulation try: byte-identical. A try replayed after a foul gets the same rule. | Any differs. |
| E4 | The report gives OT try counts by flag and score, sim (in-sample OT plus league 4242 postseason seeds 1-10,000) next to real. | Missing. |

### H: recheck, stop rule, holdout, playtest

| # | Criterion | How it fails |
| --- | --- | --- |
| H1 | Final in-sample 10k: every 5d check passes; no 5c check regresses; every gated metric that passed still passes; every accepted in-sample miss (game, caller, C3, C7) is at or better. `c.ot.complete` passes on league 4242 seeds 1-10,000. 0 invariant violations, at or under 25 ms a game. A before/after table by milestone (baseline, B, C, D, E, H) with the close-margin rows. | Any fails, or is worse and not sent to Joseph. |
| H1b | Stop rule: anything worse or new in H1 goes to Joseph with numbers and the league-seed spread. No holdout runs until he decides. | A holdout run first. |
| H2 | One post hoc holdout per changed pipeline, after H1b clears: caller (run 7), game step 5 calibration (run 11) and C7 (run 7), each pinning the new tables. The engine (run 8) only if its validation summary pins the caller tables, as it did in 5c run 6; DECISIONS.md says which. Each labelled "post hoc, step 5d" in its report and added to the run-count table in DECISIONS.md, so the step 5b B12 check counts it. Accepted holdout misses are compared at or better against their current values (game run 10, C7 `defense.c40` 8.34 vs 10.35, caller holdout rows). Worse or new: to Joseph, nothing recorded. Any rerun is "pins only, metrics must match run N" and counted. | Run before H1b, unlabelled, uncounted, or a second run that changes metrics. |
| H3 | playtester reruns the seven repro seeds on the CLI (league 7 seed 11; league 2026 seeds 3, 26, 229, 107, 4; postseason league 4242 seed 6537) and reports what each does now, since data changes make seeds play different games; plus the 4,000-game soak, the 1,000-game postseason soak, the PLAYTEST_M1_5C probe tables, and any new late-game call no coach would make. | Not run. |

## Edge cases that are reachable

- 0 timeouts, down 3, 1st down at Q4 0:30 after an incompletion: clock stopped, no spike (mask), tempo from the new level.
- 0 timeouts, clock running, OT final 2:00 of a regular-season period: the spike level applies.
- Down 1, 4th and 2 at the opp 8, Q4 0:40, defense 0 timeouts: a kneel to set up a winning field goal is real (36 such red-zone kneels, all down 1-2) and is not masked.
- Tied at the own 20, Q4 0:20: a kneel to overtime is inside 0:47 and not counted by `d.kneel.notLeading`.
- Up 2, 1st and 10 at 1:20, defense 3 timeouts: K0x with defense 1+.
- Up 4, 1st and 10 at 1:50, defense 0 timeouts: K1, kneel unchanged (122 >= 110).
- Second team's first OT possession, touchdown leaves it down 1: GF fitted shares. Down 2: two-point. Tied: kick. Ahead or down 3+: the try is moot and skipped (`try.skipWhenOutcomeDecided`), as now.
- First team's OT touchdown, up 6: flag 0, unchanged shares.
- Onside kick in OT recovered by the first team: flag turns on (kick opportunity).
- Postseason OT5 after a new toss: flag stays 1.
- A try replayed after a defensive foul in OT: same rule, new spot.

## Dependencies and sequencing

- 0 first (A's measure parts with A). A before C and E, which read the new fields. B before C, because the spike count also depends on how many running-clock snaps the tempo leaves (diagnosis: 0.048 a game from the spike level alone). D after C, since both add oTop levels ahead of L6 and the report must show each one's effect. E any time after A. H last.
- Real fits and 10,000-game runs on Joseph's machine with the warm cache. CI runs fixtures, slice digests and the summary checks.
- Caller and game config changes needed by these milestones (new dimensions, levels, the K0c threshold, the OT try rule) are approved by the lead under this spec, as in 5b and 5c. The two Situation fields are Joseph's approval.

## Locked vs likely to change

Locked: the two field names and meanings; 2016-2023 only; N = 150 with pooling; masks only at a real count of 0; tolerances and known deviations untouched; the checks file hashed before any run and never edited; strict at-or-better; one counted post hoc holdout per changed pipeline; findings 4-6 in M2.

Likely to change: exact bins and pooling after the fits; which states get masks; whether `d.spike.trail0TO` can pass with B and C together; whether the engine counts as a changed pipeline.

## Open questions

1. `d.kneel.thenPlay.lead9` targets the same leaders behind the accepted `c.kneel.ballBack` miss (K0c.d23 at 80%), which D doesn't directly change. As written it is gated, so if it fails it goes to Joseph. Does the lead want it gated, or reported only? Decide before milestone 0 step 1.
2. The diagnosis projects about 0.048 spikes a game from the spike level alone against 0.075 real, outside the 0.015 tolerance unless B adds running-clock snaps. Does the lead accept the tolerance as written, knowing it may fail?
3. The caller's timeouts at the snap (pipeline/caller/load.py) come from the play row, not revision 1's clock order. In 2022-2023 that may mislabel a team that just used its last timeout as holding one, which feeds the new ownTO 0 cells. A5 counts the disagreement. Does a mismatch get fixed in 5d (a caller refit beyond the named levels) or reported only?

## Resolved (lead, 2026-11-13, before milestone 0)

1. `d.kneel.thenPlay.lead9` is reported only, not gated. It measures the leaders behind the accepted `c.kneel.ballBack` miss, which 5d does not target, so it stays covered by that acceptance: `c.kneel.ballBack` must stay at or better than 8.97%.
2. The spike tolerance stands as written. It isn't loosened to fit the projection. If `d.spike.perGame` fails at H, it goes to Joseph with the evidence.
3. Fix it in 5d. If A5 finds that the caller's timeouts at the snap disagree with revision 1's clock order, the caller reads timeouts in clock order, the same fix as revision 1. Log the disagreement count and the refit in DECISIONS.
