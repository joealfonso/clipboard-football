# M1 step 5b: late-game caller levels, timeouts and clock control (amendment)

Status: draft, 2026-11-12. Owner: Joseph. Amends docs/specs/m1-step5-full-game-and-calibration.md and docs/specs/m1-step5a-caller-late-game-bins.md. Where they conflict, this file wins for the factors named here.

## Goal

Make late games end the way NFL games do. Late in the game, leading teams should run the clock out and trailing or tied teams should kick or go for it as real coaches do. The aim is for the step 5 in-sample run to match 2016-2023 on close margins, drive count and overtime under the existing tolerances.

For: Joseph, who wants games decided by a field goal as often as real ones, and the engineer and test-writer closing M1 step 5.

In plain words: today the sim's leader stops the clock about three times as often as real leaders do, and a few late-game caller cells fall back to cells that ignore the score. Games therefore drift from 3-point margins to 8-14 point margins. This spec fixes the caller fallbacks, keeps the score in the timeout tables late in the game, and lets ball carriers stay in bounds or get out of bounds the way the score and clock tell them to.

## Why (debugger, step 5 in-sample run against 2016-2023)

Evidence: /tmp/claude-501/dbg5 (variants.ts, dump.ts, a1-a22.py). The pipeline recomputes every real number. No criterion below uses the debugger's numbers as targets.

| Gated metric (in-sample) | Sim | Real |
| --- | --- | --- |
| `absMargin.share.1-3` | 18.7% | 24.2% |
| `absMargin.share.8-14` | 27.0% | 22.7% |
| `drives.perTeamGame` | 11.44 | 11.01 |
| `overtime.rate` (passes, low) | 3.8% | 5.7% |

- The whole 1-3 gap is games decided by exactly 3 (8.4% vs 14.6%). Score states at 5:00 left match, so the late transitions are what is wrong.
- **Caller fallbacks (confirmed by counterfactual, about 35% of the 1-3 gap, overtime 3.8% to 4.85%):**
  - Tied, final 2:00, inside the opponent's 37, 3rd down: the cell backs off to a level without zone. The sim passes 84% (real 28%) and never kicks (real 21% field goals).
  - Trailing 1-8, final 2:00, own end, 4th down: the cell backs off to dist5|zone6 with no score. The sim punts 92% (real 2-3%).
  - Overtime bins as H2 (time5 `quarterMax` 5), so it is never its own state. Sim overtime games end on a 3-point margin 32% of the time (real 63%).
- **Leader clock control (likely 55-65% of the 1-3 gap and most of the 8-14 excess):**
  - 31% of a leader's snaps stop the clock (real 10.5%).
  - Leaders up 9 or more kick field goals between 5:00 and 2:00 on 17.5% of drives (real 7.7%).
  - Both teams get extra drives in the final 2:00.
  - Cause: the engine's out-of-bounds flag comes from the sampled real play, whatever the score and clock (packages/sim/src/engine/resolve.ts:343).
  - The timeout levels drop score3 at the third level (data/game/config.json:804). Trailing defenses call 0.69 timeouts a game between 5:00 and 2:00 (real 0.90) and 0.65 after 2:00 (real 0.43). Tied teams call about half the real number in the final 2:00.
- **Drives +0.43:** clock per snap explains about 55% and plays per drive about 45%. Behind both: more clock-stopping snaps (16.7% vs 13.0%), more dropbacks (54% vs about 50%), more punts and turnovers on downs. A tempo-window cause is ruled out. Safeties still run at 2x (0.117 vs 0.057 a game).

## Non-goals

- Defense caller, o4Kick and every other caller factor except oTop and o4Top: byte-identical.
- The first half's final 2:00 (H1F) in the caller and the timeout tables (open question 3).
- The tempo and onside tables, the matchup table, step 4 class and yard tables, and the step 3 rules.
- `driveStart.mean`: it comes from kickoffs tuned to 2025 and is out of scope here.
- Tolerances. data/caller/tolerances.json, data/engine/tolerances.json and data/game/tolerances.json stay byte-identical. The engineer adds no `known_deviations`.
- League settings (home edge, crowd noise, team strength SD) are not retuned.
- Designed overrides ("always kneel when you can"). Fitted shares only, with designed bins.
- Fixing safeties, dropback share or incompletion share. Milestone E only reports on them.

## Locked rules

1. Fitting uses 2016-2023 regular season only. No number in this spec is chosen by looking at 2024, 2025 or 2026. Kickoffs stay the one exception.
2. The sim stays pure: no DOM, no Node APIs, one seeded Rng passed in, and the same seed gives the same game. `resolvePlay` decides every outcome, so the out-of-bounds decision lives in the engine and never in the loop.
3. Every new number is in a data file. MODEL.md labels each part designed, fitted or mixed. Variance is not flattened.
4. Holdout runs come after the in-sample run, once per component, and are labelled post hoc.
5. Ask-first schema and config changes are approved by the lead under this spec: caller config version 3, game config changes (schemaVersion bump if dims or types change), and the new engine table and its zod schema (engine config version bump).

## Design

### Late windows (for this spec)

The late windows are G5 (game 5:00 to 2:01), GF (final 2:00) and all of overtime. Outside them, every share and rate stays exactly as it is now.

### 1. Late caller levels (oTop, o4Top; designed bins, fitted shares)

- **Overtime bucket (designed).** Overtime is its own late time state: `OT`, and `OTF` for the final 2:00 of the period if the counts support it. Other factors must not see the new state. They keep binning overtime as H2/G5/GF so their lookups stay byte-identical. How this is expressed (a window dimension like 5a's, or a new time dimension used only by the late levels) is the engineer's call. Overtime plays from 2016-2023 enter only overtime cells. This reverses step 2's "overtime excluded from fitting" for these cells only. RULES.md now holds the overtime rules, which was that decision's stated trigger.
- **Coarser late score (designed).** `scoreLate5` has five buckets: <=-9, -8..-1, 0, 1..8, >=9. It is a union of the 5a late buckets, keeps the sign, and is used only inside the late windows.
- **Coarser late zones (designed).** Late-only levels pair the late score bins with zoneK (K37, K50, K75, K99) before any level that drops either score or zone. If counts force it, a final late level uses opponent half vs own half. The exact level order is chosen from milestone B's counts (B1) and recorded in DECISIONS.md before the fit.
- **Can kneel out (designed, oTop only, leading, GF and OTF, downs 1-3).** The offense can kneel on each remaining snap before 4th down, and the clock reaches 0 before a 4th-down snap even if the defense spends every timeout it has. Starting rule, from the debugger's variant: with d the current down, t the defense's timeouts and P the rule set's play clock (40 s),
  `(4 - d) x P + k - P x min(t, 4 - d) >= secondsLeft`.
  k is a designed kneel-duration allowance in config (the variant used 2). P comes from the rule set, never a literal. On 4th down the existing o4Top clock targets apply.
- **Backoff.** Unchanged from 5a: N = 150, half-life 2 anchored at 2023, integer weights summing to 10,000, largest-remainder rounding. oTop is fitted on 2016-2023. o4Top's late levels may use 2016-2023 twins when 2021-2023 is under N (5a resolved question 1). Inside the late windows, the chain keeps the score sign at least until every late-only level has been tried.

### 2. Timeout levels (designed levels, fitted rates)

Inside the late windows, the timeout chain keeps score3 (from the calling team's view) at every level except the final side-only fallback. Outside the late windows, every rate is byte-identical. Fitted on 2016-2023 with N = 150, as now.

### 3. Situational out-of-bounds (engine; mixed: designed bins, fitted rates)

- **Scope.** Only ball carriers whose play ends in the field with the offense in possession: runs, scrambles and completions. Sacks, kneels, spikes, incompletions, touchdowns, safeties and turnovers keep today's behavior.
- **What it changes.** Only the `outOfBounds` flag of the PlayResult and the trace. Class, yards, seconds, spot, turnover, touchdown and fouls stay exactly what they would have been. The Rng sequence for everything else is unchanged (criterion D2).
- **Rate.** The probability of going out of bounds is fitted on 2016-2023 from nflverse `out_of_bounds`. Designed cells: family (run, scramble, completion), a class or yards group (engineer's choice, recorded), score bin from the offense's view (designed, at least trailing, tied and leading, split by one score late) and time bin (at least: outside the snap-start windows, H1F, G5, GF, OT). Backoff ends at today's unconditioned rate for that family and class, so a cell without data behaves as today. Minimum plays per cell is in config, proposed 300 as for step 4 cells.
- **Clock.** The step 3 machine already stops the clock on out of bounds only inside the windows the rules name. That is unchanged.
- **Why line.** The trace records the layer's cell, level and rate. The why sentence still binds only to trace fields.

### Order of work

A (out-of-bounds counterfactual) runs first. B and C (caller and timeout fits) follow, in parallel. D builds the out-of-bounds layer only after A's go decision. E (investigations) can run any time after A. F (recheck) needs B, C and D.

## Milestones

Each ships on its own branch and goes through code-reviewer and test-writer.

### A: out-of-bounds counterfactual (nothing shipped to the sim)

A throwaway variant replaces each in-field run, scramble and completion's out-of-bounds flag with a draw from real 2016-2023 rates by family x score bin x time bin. It changes nothing else, and its code lives in scripts or scratch, never in packages/sim.

| # | Criterion | How it fails |
| --- | --- | --- |
| A1 | 10,000 in-sample games, same league and run seeds as GAME_REPORT.md, baseline vs variant: `absMargin.share.*`, `drives.perTeamGame`, `overtime.rate`, `tie.rate`, `scrimmagePlays.perGame`, the leader's clock-stopping snap share in G5 and GF, leader field goal drives in G5 when up 9+, drives starting in the final 2:00 per game, and the spread across league seeds for each. | A metric missing, different seeds, or any 2024-2025 data read. |
| A2 | Go/no-go recorded in DECISIONS.md against the rule in open question 1, before any D code. | D starts without a recorded go. |

### B: late caller levels, config v3

| # | Criterion | How it fails |
| --- | --- | --- |
| B1 | CALLER_REPORT.md lists unweighted 2016-2023 (and 2021-2023 for o4Top) play counts for every candidate late cell (OT, scoreLate5, zoneK, can kneel out) before the fit. The chosen level order is recorded in DECISIONS.md. | Missing counts, or levels chosen after seeing fitted shares. |
| B2 | A shared binning fixture covers diffs -9, -8, -1, 0, 1, 8, 9; seconds 301, 300, 121, 120; quarter 4 vs 5 at the same seconds; and can-kneel-out boundaries for downs 1-3 with defense timeouts 0-3 at the threshold and 1 s past it. Python and TypeScript give the same keys. | Mismatch or boundary missing. |
| B3 | Coarse-is-union test: scoreLate5 against the 5a late buckets, score7 and score3. | A bucket straddles. |
| B4 | The current golden.json is frozen as a fixture. Every situation outside the late windows, and every situation of any factor other than oTop and o4Top (overtime included), returns identical weights. defense.table.json cells are byte-identical. | Any difference. |
| B5 | Config version 3. Loading v2 tables with the v3 config, and the reverse, fails with an error naming both versions or hashes. | Loads silently. |
| B6 | No 2024-2026 row reaches any cell. Dropping every overtime row from the input changes no non-overtime cell (pytest). | Holdout row used, or an overtime row leaks. |
| B7 | Backoff at N-1 and N on each new level lands on the specified parent (pytest and TypeScript). | Off by one or wrong parent. |
| B8 | Golden regenerated with at least 50 new-level situations covering OT, every scoreLate5 bucket and both can-kneel-out values. TypeScript matches. | Mismatch or bucket not covered. |
| B9 | CALLER_REPORT.md 8b, in-sample 2016-2023, latechecks.json thresholds (5 pp, n >= 100): (a) tied, GF, inside the 37, 3rd down: field goal and pass rate; (b) trailing 1-8, GF, K75 and K99, 4th down: punt and go rate; (c) leading, GF, downs 1-3, by can kneel out: kneel rate. Overtime rows shown, not gated. | A row with n >= 100 outside 5 pp, or missing. |
| B10 | The report lists every late-window cell the sim reaches that still backs off past the last score-aware level, with its sim lookup count. Cells (a) and (b) of B9 are not on that list. | List missing, or (a) or (b) on it. |
| B11 | Every 8b, 5a B5, B6 and B7 row that passed before still passes. Tables total at most 300 KB. Two builds are byte-identical. | Regression, over budget, or diff. |
| B12 | One caller holdout re-validation, labelled post-validation revision 3, post hoc. Touched metrics are marked "revised after holdout". | Not labelled, or run more than once. |

### C: timeout levels keep score3 late

| # | Criterion | How it fails |
| --- | --- | --- |
| C1 | Inside the late windows, every timeout lookup level except the side-only fallback carries score3 (config test). Outside them, rates for a frozen set of at least 200 dead-ball views are identical to before. | score3 dropped late, or an outside rate changes. |
| C2 | Rebuild byte-identical. No 2024-2026 row (pytest as step 5 C3). | Diff or holdout row. |
| C3 | COACH_REPORT.md, in-sample: timeouts per team-game by side x score3 x (G5, GF), sim loop vs real 2016-2023, with the existing C7 per-dead-ball 2 pp applied as an in-sample check where n >= 100. | Missing row or outside 2 pp. |
| C4 | C7 still passes in-sample. One C7 holdout rerun, post hoc and labelled. | C7 fails, or unlabelled. |

### D: situational out-of-bounds layer (needs A's go)

| # | Criterion | How it fails |
| --- | --- | --- |
| D1 | One pipeline command builds the rate table and its ENGINE_REPORT.md section, byte-identical on rerun. No 2024-2026 row. pytest on hand-made frames covers out-of-bounds attribution, cell keys and backoff at N-1 and N. | Diff, holdout row, or wrong value. |
| D2 | For a fixed set of at least 10,000 resolvePlay inputs and seeds, every PlayResult equals the pre-5b engine's except `outOfBounds` and the trace. Fixture recorded before the change. | Any other field differs. |
| D3 | The layer never sets out of bounds on a sack, kneel, spike, incompletion, touchdown, safety, turnover or a play ending out of the field. Where every cell backs off to the last level, the per-family rate equals today's within sampling error. | Flag on an excluded play, or a backoff rate shift. |
| D4 | Step 4 validation rerun in-sample: every gated metric equal to the previous run (exact, by D2). New in-sample rows: out-of-bounds rate by family x score bin x time bin, predicted vs actual, within the threshold in open question 1 where n >= 300. Step 4 holdout rerun once, post hoc, new rows not gated. | A gated metric moves, a row is missing or outside, or the holdout row is gated. |
| D5 | The why sentence binds only to trace fields. The trace names the layer's cell, level and rate when it applied. | Text from outside the trace. |
| D6 | Purity and import tests pass. Same seed gives the same game. Step 5 F3 digests are regenerated in the same change. F4 speed stays at most 25 ms a game. | Violation, stale digests, or over budget. |
| D7 | MODEL.md: "Out of bounds by situation", mixed (designed bins, fitted rates, 2016-2023). The engine config version is bumped. DECISIONS.md entry with the next revision number. | Mislabelled or missing. |

### E: investigations (report only)

| # | Criterion | How it fails |
| --- | --- | --- |
| E1 | GAME_REPORT.md diagnostics, sim vs real 2016-2023: safeties per game by cause (run, sack, other) and by snap spot (own 1-5, 6-10); snaps from the own 1-5 per game and their oTop shares. | Missing. |
| E2 | Dropback share and incompletion share by score3 x time5, sim game snaps vs real; clock-stopping snap share decomposed into incompletions, out of bounds, timeouts and other. | Missing. |
| E3 | E's diff changes no table, config or sim code. Any suspected cause is written as a hypothesis for a later spec. | A tuning change in E. |

### F: step 5 in-sample recheck

| # | Criterion | How it fails |
| --- | --- | --- |
| F1 | 10,000 in-sample games, same seeds. A before/after table for baseline, after B, after C and after D, covering every gated metric plus: exact-3 margin share, overtime ending on a 3-point margin, leader clock-stop share in G5 and GF, and drives starting in the final 2:00. | Missing stage or metric. |
| F2 | Target: `absMargin.share.1-3`, `absMargin.share.8-14` and `drives.perTeamGame` pass, `overtime.rate` still passes, and nothing that passed fails, all with tolerances byte-identical. A remaining miss goes to Joseph with numbers. No further change is made under this spec. | Tolerances edited, or a miss patched by tuning. |
| F3 | 5a D3 rows reported again. | Missing. |
| F4 | Any step 5 holdout run comes after F1, once, and is labelled post hoc in GAME_REPORT.md with this spec named. | Run first, or unlabelled. |
| F5 | playtester reads at least 3 CLI games with a close fourth quarter and reports any late-game call no coach would make. | Not run. |

## Edge cases that are reachable

- Tied, 3rd and 8 at the opponent's 30, 0:20 left, no timeouts: a field goal on 3rd down is a real choice.
- Leading by 4, 1st and 10, 1:50 left: the defense has 0 timeouts, so the leader can kneel out (122 >= 110). With 1 defense timeout it cannot (82 < 110).
- Leading, 4th down, GF: can kneel out does not apply. o4Top's clock targets decide.
- Trailing by 7, 4th and 12 at the own 20, 1:10 left: goes, from a late zoneK cell rather than a score-free one.
- Overtime: opening field goal, then the second team trails by 3 with 2 timeouts. After both teams have had the ball, a tied game is sudden death and a field goal wins. A team trailing by 7 after an opening touchdown has no 2016-2023 counterpart (open question 2).
- A completion with 0:03 left in the half on which the offense is trailing: the layer applies, and the step 3 machine stops the clock per the rules.
- The layer's out-of-bounds flag on a play outside the windows: the clock restarts per step 3, unchanged.
- A foul on a play the layer flags out of bounds: enforcement unchanged, flag kept.
- 300 vs 301 s and 120 vs 121 s, in quarter 4 and in overtime (B2).

## Dependencies and sequencing

- Step 5a committed. Other agents are editing the working tree now. Rebase on their result before B, C and D.
- A, then B and C in parallel, then D (only after A's go). E any time after A. F needs B, C and D.
- Real fits and the 10,000-game runs happen on Joseph's machine with the warm cache. CI runs fixtures, the slice digests and the summary checks.

## Locked vs likely to change

Locked: 2016-2023 only; tolerances and known deviations untouched; outside the late windows caller and timeout shares stay byte-identical; the out-of-bounds layer changes only the flag; holdout runs post hoc and labelled; misses go to Joseph, not to tuning.

Likely to change: the late level order after B1's counts; whether OT needs the OTF split; the out-of-bounds class grouping and score bins; o4Kick late cells if tied 4th-down field goals still miss (a separate spec); whether a yards effect of staying in bounds is needed later (this spec keeps yards untouched).

## Open questions

1. Open: thresholds, proposed and not derived. (a) A's go: the variant moves the leader's clock-stop share toward real, and moves `absMargin.share.1-3` up by more than the spread across league seeds. Otherwise, report to the lead before D. (b) D4's in-sample out-of-bounds rows: within 2 pp where n >= 300. The lead confirms both before A runs.
2. Open: overtime cells are fitted on 2016-2023 overtimes played under modified sudden death, while the 2026 rule set guarantees both possessions. Situations with no old-rule counterpart (trailing after an opening touchdown) back off to the G5/GF late cells. Accept this, or design those cells?
3. Open: H1F stays out of scope for the caller and timeout changes. Should the first half's final 2:00 also keep score3 in the timeout chain, in this spec or a later one?

## Resolved open questions (lead, 2026-11-12)

1. Thresholds accepted as proposed. A's go rule: the 1-3 share moves up by more than the spread across league seeds. D's out-of-bounds rows: within 2 pp where n >= 300.
2. Overtime fit accepted. The situation "trailing after an opening touchdown" has no real data under the 2026 guaranteed-possession rule, so it backs off to the G5/GF cells. The OT report shows that cell's kick and go rates, so a silly choice (a field goal that can't tie or take the lead) is visible.
3. The first-half final 2:00 stays out of scope. The debugger put it at +0.05 drives a game.
