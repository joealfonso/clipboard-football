# M1 step 5a: late-game score bins for the step 2 caller (amendment)

Status: draft, 2026-11-11. Owner: Joseph. Amends docs/specs/m1-step2-call-menus-and-baseline-caller.md. Where the two conflict, this file wins for the factors named here.

## Goal

Make the fitted step 2 offense caller tell "trailing by a field goal" from "trailing by a touchdown" (and the same when leading) in the last 5:00 of the game, so late 4th-down kicks, punts and play calls look like real coaches' and the step 5 calibration gets realistic close games and overtime.

For: Joseph, who wants late games to end like NFL games, and the engineer and test-writer closing M1 step 5.

In plain words: today the caller treats "down 2" and "down 7" as the same score late in the game, so it kicks field goals that do not help when trailing by a touchdown, and kicks too few when a field goal ties or wins. This splits those score groups in the last 5:00, refits on 2016-2023 only, and checks the result.

## Why (found by the debugger in the step 5 in-sample run, 2016-2023)

`score7` merges -8..-1 and 1..8 (data/caller/config.json `dimensions.score7`). `o4Kick` picks punt vs field goal by zone and time2 only, with no score. Figures below are the debugger's, from 10,000 simulated games against 2016-2023. The pipeline recomputes the real columns; the criteria never use these numbers as targets.

4th down, last 5:00 of the game, ball at the opponent's 37 or closer, field goal rate:

| Score (offense) | Sim | Real |
| --- | --- | --- |
| Trailing 4-8 | 74% | 7% |
| Trailing 1-3 | 67% | 94% |
| Tied | 72% | 89% |

Field goal attempts in the last 2:00 per game: tied 0.014 sim vs 0.063 real, trailing 1-3 0.023 vs 0.094, trailing 4-8 0.065 vs about 0.

Results: margins of 1-3 points 19.4% vs 24.2%, overtime 3.2% vs 5.7%, too many onside kicks (GAME_REPORT.md).

## Non-goals

- Defense caller (dFront, dCoverage, dTry). Unchanged, byte for byte.
- oTry, tpTop, tpRun, tpPassType, tpDepth, oRun, oPassType, oDepth, oFormation. Unchanged. (oTry already has the exact score diff.)
- The first half's final 2:00 (time5 `H1F`) and every situation outside the last 5:00 of the game. Shares there stay as they are.
- Step 5 tempo, timeout and onside tables (data/game). They use their own `score3`, not `score7`, so this amendment does not touch them. If close games still miss afterwards, they are the next suspect, in a separate spec.
- Menus and the catalog. No screen changes; every screen keeps at most 7 choices.
- Tolerances. data/caller/tolerances.json, data/engine/tolerances.json and data/game/tolerances.json stay byte-identical. No new `known_deviations` from the engineer.
- League settings (home edge, crowd noise, team strength SD). Not retuned here.
- Designed overrides ("always kick when a field goal ties late"). Fitted shares only.

## Design

### Late windows

Late window = time5 `G5` (game 5:00 to 2:01 left) and `GF` (final 2:00). Overtime is binned as the second half, as in step 2, so overtime situations with 5:00 or less in the period also use late cells. Overtime stays out of fitting.

### Late score bins (designed)

Inside the late windows the score dimension has nine buckets instead of seven:

| Bucket | Diff (offense minus defense) |
| --- | --- |
| <=-17 | as score7 |
| -16..-9 | as score7 |
| -8..-4 | needs a touchdown |
| -3..-1 | a field goal ties or wins |
| 0 | tied |
| 1..3 | leading by a field goal or less |
| 4..8 | leading by one score, more than a field goal |
| 9..16 | as score7 |
| >=17 | as score7 |

The leading split mirrors the trailing one. Sparse leading cells fall back through the existing backoff; no bucket is merged by hand. The new buckets are a refinement of score7 (every score7 bucket is a union of late buckets), so criterion A7 of step 2 still holds. How this is expressed in config (a new dimension, a time-dependent dimension, extra levels) is the engineer's call, within the constraints below.

### Factors that change

| Factor | Change |
| --- | --- |
| oTop (downs 1-3: run, pass, punt, field goal, spike, kneel) | Late-window cells use the late score bins wherever the chain now uses score7. |
| o4Top (4th down: go, kick, clock) | Same. |
| o4Kick (punt or field goal given a kick) | Gains score in the late windows: late score bins at its finest level, then score3, then its current chain. Outside the late windows its chain and cells are unchanged. |

Kept from step 2: hierarchical backoff, N = 150 per stored cell, half-life 2 seasons anchored at 2023, integer weights summing to 10,000, largest-remainder rounding. Seasons: oTop and o4Kick 2016-2023, o4Top 2021-2023 (open question 1). Never 2024, 2025 or 2026.

### Constraints the engineer must keep

1. Outside the late windows every factor returns exactly the same integer weights as the current tables. Within them, only oTop, o4Top and o4Kick change.
2. The backoff chain keeps the sign of the score (trailing, tied, leading) at least as long as it does today.
3. Balance stays in data: bins and levels in data/caller/config.json; nothing about score is hardcoded in packages/sim or pipeline/caller.

### Schema and versioning

- data/caller/config.json `version` goes from 1 to 2. Every generated caller file records the config version and hash it was built from.
- If the Dimension union in packages/shared/src/caller.ts or its zod schema gains a type or field, that is a schema change: ask Joseph first (CLAUDE.md). Bump whatever version the shared schema carries.
- Runtime refuses tables built from a different config version or hash than the config it is given, with an error naming both.
- Regenerated: offense.table.json, golden.json, validation.json, CALLER_REPORT.md. defense.table.json may change only in its metadata (config hash), never in a cell.

### Labels (MODEL.md)

The late bins are designed. The shares in late cells are fitted. MODEL.md "Baseline play caller" says both, and states that the bins were added after the step 5 in-sample run.

## Milestones

Each ships on its own branch and goes through code-reviewer and test-writer.

### A: bins, config v2, schema, counts (no share changes)

Add the late score bins and config version 2, with the chains not yet using them. Print the counts needed to answer open question 1.

| # | Criterion | How it fails |
| --- | --- | --- |
| A1 | The shared binning fixture covers diffs -17, -16, -9, -8, -4, -3, -1, 0, 1, 3, 4, 8, 9, 16, 17 at seconds left in the game 301, 300, 121, 120, and an overtime situation, and Python and TypeScript give the expected keys for each. | Mismatch, or a boundary missing. |
| A2 | The coarse-is-union test covers the late buckets against score7 and score3. | A late edge straddles a score7 bucket. |
| A3 | With A merged, offense.table.json and defense.table.json cells are byte-identical to before; only metadata (config version, hash) differs. | Any cell differs. |
| A4 | Loading version-1 tables with the version-2 config (and the reverse) fails with an error naming both versions or hashes. Test with fixtures. | Loads silently. |
| A5 | CALLER_REPORT.md lists, for every late-window cell that would be added to oTop, o4Top and o4Kick, its unweighted play count in 2016-2023 and 2021-2023. | Missing table. |

### B: refit and in-sample check

Turn the late bins on in oTop, o4Top and o4Kick and refit. Needs open questions 1 and 2 answered.

| # | Criterion | How it fails |
| --- | --- | --- |
| B1 | For every situation in the current golden.json outside the late windows, and every late-window situation for any factor other than oTop, o4Top and o4Kick, the new shares equal the current ones exactly. The current golden file is kept as a frozen test fixture. | Any difference. |
| B2 | No 2024, 2025 or 2026 row reaches a cell (table metadata, plus the step 2 C2 pytest extended to the new cells). | A holdout row used. |
| B3 | Backoff at N - 1 and N for a late cell, and lookup lands on the specified parent (pytest and TypeScript). | Off by one or wrong parent. |
| B4 | Golden file regenerated with at least 50 late-window situations covering every late bucket and every backoff level they reach; TypeScript matches as step 2 D3. | Mismatch, or bucket not covered. |
| B5 | In-sample caller check, in CALLER_REPORT.md section 8b. Scope: 4th downs in Q4 with 5:00 or less left, yard line 37 or closer, by score (trailing 4-8, trailing 1-3, tied, leading 1-3, leading 4-8). Predicted field goal rate (mean predicted probability) within 5 pp of actual on 2021-2023 for each row with n >= 100; 2016-2023 shown alongside. Go and punt rates shown, not gated. | A row outside 5 pp, or missing. |
| B6 | Same check for downs 1-3 in the late windows: pass rate and kneel rate by late score bucket, within 5 pp in-sample (2016-2023) where n >= 100. | Outside, or missing. |
| B7 | Step 2 8b rows that passed before still pass in-sample: pass rate by down, every 4th-down zone, kneel by final-2:00 state. | A previously matching row moves out of 5 pp. |
| B8 | Tables total at most 300 KB (step 2 C8). Two runs give byte-identical files. | Over budget, or a diff. |

The in-sample thresholds in B5 and B6 live in a designed data file other than tolerances.json, committed before B's first fit. Proposed values; Joseph confirms (open question 2).

### C: caller re-validation against 2024-2025 (post hoc)

| # | Criterion | How it fails |
| --- | --- | --- |
| C1 | One run of the step 2 validation on 2024-2025 with tolerances.json byte-identical. One run only; if it fails, it is reported, not iterated. | Tolerances edited, or more than one run without Joseph's say. |
| C2 | CALLER_REPORT.md section 9 states plainly that this is post-validation revision 2, made after both the caller holdout and the step 5 game-level holdout were seen, and that it was driven by in-sample findings. Every metric touching oTop, o4Top or o4Kick is marked "revised after holdout". | Not stated, or a touched metric marked "no". |
| C3 | Late-window rows (B5, B6 scopes) are shown for 2024-2025 as not gated. | Missing, or gated. |
| C4 | Known deviations: the report marks each of the five as still failing or now passing. Coverage ones (man, Nickel Cover 2, Nickel Cover 4) are untouched by this change and stay. The midfield 4th-down pair stay only if they still fail for the reason recorded. The engineer does not add, edit or remove entries; Joseph does. | Engineer edits `known_deviations`. |
| C5 | Any new gated failure goes to Joseph with numbers before C is called done. | Reported as done with a new failure. |
| C6 | DECISIONS.md entry "Post-validation revision 2 (caller late-game bins)": what changed, why, in-sample before and after, config hash before and after. MODEL.md updated as in Labels. A one-line pointer to this file is added under step 2's Resolved section. | Missing. |

### D: step 5 recheck

| # | Criterion | How it fails |
| --- | --- | --- |
| D1 | Step 4 engine validation re-run so its summary hashes match the new caller files. Every step 4 metric equal to the previous run within 0.1 pp (oDepth is unchanged, so outcomes should not move). | Stale summary, or a step 4 metric moves. |
| D2 | Step 5 in-sample run (10,000 games, same league seeds) before any holdout run. GAME_REPORT.md adds both tables from "Why" as diagnostics, sim against 2016-2023, plus leading 1-3 and leading 4-8 rows. | Missing, or holdout run first. |
| D3 | In-sample, the sim's 4th-down field goal rate in each "Why" table row is within 10 pp of real, and field goal attempts in the last 2:00 per game within 0.02 of real in each row. Proposed; Joseph confirms (open question 2). | Outside. |
| D4 | GAME_REPORT.md compares in-sample before and after for: `absMargin.share.*`, `overtime.rate`, `tie.rate`, `onside.perGame`, `fieldGoalAttempts.perGame`, `fourthDownGo.perGame`, `punts.perGame`, `driveResult.share.*`, `points.mean`, `total.mean`, `margin.sd`, `homeMargin.mean`, home win rate. | A metric missing. |
| D5 | If `margin.sd` or `homeMargin.mean` now fails in-sample, it goes to Joseph; the league settings are not retuned in this amendment. | Settings changed. |
| D6 | The step 5 holdout run, if Joseph calls for it, is labelled post hoc in GAME_REPORT.md, with data/game/tolerances.json byte-identical. | Not labelled, or tolerances edited. |

## Edge cases that are reachable

- 4th and goal at the 2, trailing by 3, 0:05 left: field goal to tie. Late bucket -3..-1, GF.
- 4th and 3 at the 30, trailing by 5, 3:00 left: real coaches go. Bucket -8..-4, G5.
- Trailing by exactly 4 or 8: -8..-4 (a field goal does not tie). Trailing by exactly 3: -3..-1.
- Leading by 1-3 at the 25 with 1:30 left: field goal to make it a two-score-ish lead, or a kneel sequence if the defense is out of timeouts. Both from data.
- Exactly 300 s and 301 s left, 120 s and 121 s: boundaries tested in A1.
- Overtime, trailing by 3 after the opponent's opening field goal: late bins (binned as second half). Trailing by 7 after a touchdown: -8..-4, so the caller goes for it on 4th down.
- A late cell under N: backs off, keeping the score sign (constraint 2).
- First half final 2:00 trailing by 3: unchanged score7 behavior (non-goal).

## Dependencies and sequencing

- A first. Joseph answers open questions 1 and 2 from A5's counts before B. C needs B. D needs C.
- Another agent is editing step 5 code in the working tree now. Rebase onto its result before A; D runs on the step 5 code as committed.
- The real fit and runs happen on Joseph's machine with the warm cache; CI runs fixtures and the summary checks.

## Locked vs likely to change

Locked: fitted on 2016-2023 only (o4Top 2021-2023 unless open question 1 changes it); N 150; half-life 2; tolerances files unchanged; outside the late windows nothing moves; defense unchanged; menus unchanged; the holdout re-validation is post hoc and says so.

Likely to change: the leading split (1..3, 4..8) after A5's counts; o4Kick's late chain; whether H1F later gets the same bins.

## Open questions

1. Open: o4Top is fitted on 2021-2023. If A5 shows the late 4th-down cells inside the 37 under N = 150 there, may o4Top's late-window levels use 2016-2023 (a second amendment to step 2 locked decision 7), or do they back off as they fall?
2. Open: the thresholds in B5, B6 (5 pp, n >= 100) and D3 (10 pp; 0.02 kicks per game) are proposals, not derived. Joseph confirms or changes them before B's first fit.
3. Open: should the late-window rows (B5, B6) become gated holdout metrics in tolerances.json? That edits a pre-registered file after results were seen, so the default here is no: reported, not gated.

## Resolved open questions (lead, 2026-11-11)

Joseph delegated technical calls to the lead.

1. Yes. If a late-window o4Top cell falls under N on 2021-2023, it may back off to the same cell fitted on 2016-2023 before the coarser backoff levels. Report which cells used it.
2. The in-sample thresholds are accepted as proposed: 5 pp with n >= 100 for the caller, and 10 pp or 0.02 kicks per game at game level.
3. The late rows stay reported, not gated, on the holdout.
4. The versioned config (version 2) and the new Dimension type are approved under this spec as the ask-first schema change, consistent with how steps 2 to 4 handled new schemas.
