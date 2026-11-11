# MODEL.md

How the play engine decides outcomes. Every part is marked **fitted** (estimated from nflverse data), **designed** (set by hand for the game), or **mixed** (designed structure with fitted numbers). The offense vs defense matchup table is designed, never data-derived.

## Status labels

Each section below states fitted, designed or mixed, and what data or reasoning backs it.

## Matchup table

Designed. How each offensive call fares against each defensive call, and why.

## Play outcome models

Distributions for yards, completions, turnovers and big plays per play type, with their fit and holdout results.

## Special teams

Kickoffs, punts, field goals and extra points, including which seasons the kickoff model draws on.

Kickoffs: designed, tuned to the 2025 season. The format changed in 2023, 2024 and 2025 (see docs/DATA.md and docs/DECISIONS.md), so no training season matches current rules. Because 2025 is also a holdout season, the kickoff part of the calibration check confirms the tuning rather than testing a prediction. This is the one exception to the holdout rule.

## Penalties

Which penalties the sim produces, how often, and on which plays.

## Clock and tempo

Run-off per play, timeouts and two-minute behavior.

## Baseline play caller

**Mixed.** The shares are fitted from nflverse data. Everything that decides what gets fitted, and how a real play is read, is designed. Built in M1 step 2 (docs/specs/m1-step2-call-menus-and-baseline-caller.md); rebuilt by `uv run --project pipeline python -m pipeline.caller`; results in docs/CALLER_REPORT.md.

What it does: for a situation (down, distance, field position, score, clock, timeouts), it looks up how often real NFL teams made each call in that kind of situation and picks one at random with those odds, using the game's seeded RNG. The share functions (`offenseShares`, `defenseShares`, `formationShares` in packages/sim/src/caller) return the full distribution before any draw, so M3 personalities can tilt it. `chooseOffenseCall` and `chooseDefenseCall` then draw once for the call and, for a run or pass, once more for the formation. The defense caller takes only the situation; it never sees the offense's call, formation or personnel.

Fitted (from data):

- The integer weights in every cell of data/caller/offense.table.json and defense.table.json: shares of each call per situation cell, season-weighted, rounded to sum to 10,000.
- Seasons: offense 2016-2023, with the 4th-down go-or-kick decision 2021-2023 only (punt or field goal given a kick uses 2016-2023), pass type and pass depth 2022-2023 only; defense 2018-2023. Never 2024, 2025 or 2026.

Designed (by hand, never fitted, never data-derived):

- The catalog of calls and menus (data/calls/catalog.json) and its availability rules.
- The situation bins, the backoff chains, the minimum of 150 plays per stored cell and the 2-season half-life (data/caller/config.json).
- Every mapping from a real play to a call: the offense rules (pass, run, kick, clock, screen over play action, depth by air yards, inside or outside run, the QB sneak rule), the formation value table, the personnel token table, the coverage value table and the defense preset table.
- The 13 defensive presets and the rule that maps a real front and coverage onto them. This mapping is a design choice. It is not derived from data, and the mismatch numbers in CALLER_REPORT.md section 6 show where real calls do not fit it.
- The defense factorization: P(preset) = sum over fronts of P(front | situation) x P(coverage | front, coarse situation), mapped through the preset table. Its assumption: given the front and the situation, coverage on run plays looks like coverage on pass plays. Coverage is charted only on dropbacks (CALLER_REPORT.md section 3: about 89% of dropbacks 2018-2022, 99.6% from 2023, under 1% of runs), so the data cannot test this. The planned partial check, FTN blitz rate on runs vs dropbacks, turned out uninformative: FTN records zero blitzers on every run in 2022-2023.
- The two-point try model: one cell from two-point tries, backing off to goal-line plays when a cell has fewer than 150 tries.
- Tolerances for the caller's own validation (data/caller/tolerances.json).

Validation (2024 and 2025, never trained on): the latest result is in CALLER_REPORT.md section 9 and data/caller/validation.json. The first run failed 11 of 56 gated metrics, mostly 4th-down rates, because the backoff merged field goal range with punt range. Post-validation revision 1 (DECISIONS.md) made after seeing those results:

- split 4th down into go-or-kick (2021-2023, fine field zone dropped last) and punt-or-field-goal given a kick (2016-2023);
- kept the end-of-game clock state longer for downs 1-3;
- added Nickel Cover 2.

Tolerances were unchanged. The revised run fails 5 of 57 gated metrics: midfield 4th-down field goal and punt (field goal attempts from midfield have risen every season since 2019), man share, and the Nickel Cover 2 and Nickel Cover 4 shares. Joseph decides how to handle them. CALLER_REPORT.md section 8b also shows an in-sample check on the training seasons, run before the holdout.

Known data limits: offense formation coding changed in 2023 (no EMPTY, SINGLEBACK, I_FORM, JUMBO or WILDCAT from 2023 on, only SHOTGUN, UNDER CENTER and PISTOL), so the caller's Empty share comes only from 2016-2022 and has no 2024-2025 counterpart. Coverage values changed in 2023 too (COMBO, COVER_9 and BLOWN appear, PREVENT disappears).

## Calibration

The calibration test, its sample size, tolerances, and latest result.

## Holdout

Which seasons are held out for validation and the rule that they are never used for training.

Exception: kickoff rates are hand-tuned to 2025, a holdout season (see Special teams).
