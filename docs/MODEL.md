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

The non-player play caller used for calibration, and how it was built.

## Calibration

The calibration test, its sample size, tolerances, and latest result.

## Holdout

Which seasons are held out for validation and the rule that they are never used for training.

Exception: kickoff rates are hand-tuned to 2025, a holdout season (see Special teams).
