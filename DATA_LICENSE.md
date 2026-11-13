# Data license

The code in this repo is under the MIT license (LICENSE). Many files under `data/` are derived from [nflverse](https://github.com/nflverse) data and keep the license and credit of the nflverse table they come from. This file lists each one.

Every derived file holds aggregates only: shares, rates, percentile cut points, fitted parameters and validation summaries. None holds a play row, a player name or a player id. Real rosters and the hand-kept list of real NFL names (`pipeline/game/real_names.py`) are local only and are not in this repo.

The license findings were checked by hand on 11 November 2026 against nflverse's own repositories. They are recorded in `pipeline/licenses.py` and rendered in the Licenses section of `docs/DATA.md`, which cites the source for each one. This is not legal advice.

## Sources

| nflverse table | License | Credit |
| --- | --- | --- |
| Play-by-play | CC-BY 4.0 | nflverse |
| Participation | CC-BY-SA 4.0 | "NFL NextGenStats via nflverse" for 2022 and earlier; "FTN Data via nflverse" from 2023 |
| FTN charting | CC-BY-SA 4.0 | "FTN Data via nflverse" |
| Combine | CC-BY 4.0 (the nflverse-data release repo's license); upstream source Pro Football Reference | "Combine data courtesy of PFR via nflverse" |

CC-BY-SA 4.0 asks that adapted material be shared under the same license. I treat every file built from participation or FTN charting as adapted material, so those files are offered under CC-BY-SA 4.0.

Pro Football Reference's terms of use (sports-reference.com/termsofuse.html) add two limits to the combine data: no competing database (5.10) and no use to train, prompt or instruct AI (5.11). See docs/DECISIONS.md, "Public repo (Joseph, 2026-11-12)".

## Files

### Built from play-by-play, participation and FTN charting: CC-BY-SA 4.0

Credit: nflverse; "NFL NextGenStats via nflverse"; "FTN Data via nflverse".

| File | What it is |
| --- | --- |
| `data/caller/offense.table.json`, `data/caller/defense.table.json` | Fitted play-caller tables (`python -m pipeline.caller`) |
| `data/caller/golden.json`, `data/caller/validation.json` | Caller golden situations and 2024-2025 validation summary |
| `data/engine/baseline.scrimmage.json`, `data/engine/baseline.special.json`, `data/engine/baseline.penalties.json` | Fitted play engine tables (`python -m pipeline.engine`). The engine reads the caller's play frame, which joins participation and FTN charting to play-by-play |
| `data/engine/matchup.centered.json` | The designed matchup table centered on the fitted caller and engine tables |
| `data/engine/validation.json` | Engine validation summary |
| `data/caller/tolerances.json`, `data/engine/tolerances.json` | Designed thresholds; their `known_deviations` entries quote predicted and actual figures from the validation files above |
| `data/game/calibration.json`, `data/game/calibration.insample.json`, `data/game/calibration.insample.pre5a.json`, `data/game/calibration.insample.stages5b.json` | Sim calibration runs, which use the tables above and compare against `data/game/actuals.json` |
| `data/game/investigations.json`, `data/game/late-backoff.json` | Sim-side report files from the same runs |
| `data/game/tolerances.json` | Designed thresholds; its `known_deviations` entries quote sim and actual figures from the calibration runs |

### Built from play-by-play only: CC-BY 4.0

Credit: nflverse.

| File | What it is |
| --- | --- |
| `data/game/tempo.json`, `data/game/timeouts.json`, `data/game/onside.json` | Fitted coach decision tables (`python -m pipeline.game`) |
| `data/game/ep.json` | Expected points table, from play-by-play's `ep` column |
| `data/game/golden.json`, `data/game/actuals.json`, `data/game/coach.validation.json` | Coach golden situations, real game aggregates and coach validation summary |
| `data/game/c3.real.json`, `data/game/investigations.real.json` | Real-side report files (`python -m pipeline.game.c3`, `pipeline.game.investigate`) |
| `data/engine/kickoff.json` | Designed kickoff weights, tuned by hand until simulated kickoffs match 2025 play-by-play (docs/DECISIONS.md, "Kickoffs are designed, tuned to 2025") |

### Built from the combine: CC-BY 4.0, with Pro Football Reference's terms

Credit: "Combine data courtesy of PFR via nflverse".

| File | What it is |
| --- | --- |
| `data/players/distributions.json` | Per-position percentile cut points per drill, 5% to 95% only, each the mean of the five results nearest its rank, and only for positions with at least 20 players |

### Designed, no nflverse data: MIT, with the code

Hand-written settings, menus and rules. `data/players/names.json` and `data/teams/names.json` are fictional; the pipeline checks them against real names locally but holds none.

`data/calls/catalog.json`, `data/caller/config.json`, `data/caller/latechecks.json`, `data/engine/config.json`, `data/engine/matchup.json`, `data/engine/personnel.json`, `data/engine/why.json`, `data/game/config.json`, `data/game/league.json`, `data/game/step5c-checks.json` (pre-registered thresholds only), `data/players/ratings.json`, `data/players/names.json`, `data/teams/names.json`, `data/rules/nfl-2026.json`.

## Test fixtures

`test/fixtures/` holds frozen copies of earlier builds of the files above, for regression tests. Each keeps the license and credit of the file it is a copy of.

| File | Copy of | License | Credit |
| --- | --- | --- | --- |
| `test/fixtures/caller-golden-v1.json`, `test/fixtures/caller-golden-pre5b.json` | `data/caller/golden.json` | CC-BY-SA 4.0 | nflverse; "NFL NextGenStats via nflverse"; "FTN Data via nflverse" |
| `test/fixtures/caller-v1/offense.table.json`, `test/fixtures/caller-v2/offense.table.json` | `data/caller/offense.table.json` | CC-BY-SA 4.0 | nflverse; "NFL NextGenStats via nflverse"; "FTN Data via nflverse" |
| `test/fixtures/game-golden-pre5b.json` | `data/game/golden.json` | CC-BY 4.0 | nflverse |
| `test/fixtures/caller-v1/config.json`, `test/fixtures/caller-v2/config.json` | `data/caller/config.json` (designed) | MIT, with the code | |
| `test/fixtures/caller-bins.json`, `test/fixtures/caller-late-bins.json`, `test/fixtures/caller-5b-bins.json` | Hand-built binning cases, no nflverse data | MIT, with the code | |

## Reports

The reports in `docs/` (DATA.md, CALLER_REPORT.md, ENGINE_REPORT.md, COACH_REPORT.md, GAME_REPORT.md) quote figures from the files above. Those figures keep the license and credit of the file they come from.
