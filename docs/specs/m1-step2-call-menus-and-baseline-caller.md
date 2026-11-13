# M1 step 2: call menus and baseline play caller

Status: draft, 2026-11-11. Owner: Joseph.

## Goal

Define every play-call menu as validated data, and build a baseline "average NFL coach" for offense and defense, fitted from nflverse data, so the M1 calibration test has realistic play calling on both sides.

For: Joseph, who wants the caller to behave like a real NFL coach without having to check the statistics himself, and the agents building the rest of M1. M3 AI coaches will later tilt this baseline with personalities, so the caller must expose its shares before sampling.

In plain words: the game looks at the situation (down, distance, field position, score, clock), looks up how often real NFL teams made each call in that situation, and picks one at random with those odds. A report checks the odds against the 2024 and 2025 seasons, which the caller never saw.

## Non-goals (out of scope)

- Play outcomes, `resolvePlay`, PlayResult, the matchup table, game state transitions.
- Clock runoff, timeouts, tempo and no-huddle decisions. These change plays per game, so the later calibration step must account for them; this step only reads clock and timeouts as inputs.
- Kickoff and onside decisions. Kickoff and Onside kick exist in the catalog so the human menu is complete, but this step builds no caller for them. No onside rule, fitted or placeholder. The calibration step decides how kickoffs are called.
- Defensive special teams calls (punt return, field goal block). Not in the catalog.
- UI, screens, keyboard handling, layout. docs/MENUS.md lists screens and numbers for Joseph's review; how they look and behave is designer's work.
- AI personalities (M3). Only the hook they will use (shares exposed before sampling).
- Designed overrides of fitted shares ("never kneel when trailing" and similar). See open questions.
- Any change to DATA.md by hand. It is generated.

## Dependencies allowed

| Dependency | Where | Why |
| --- | --- | --- |
| zod (pinned exact) | packages/shared | Validate the catalog and caller tables. Approved by the lead for this step. |

Nothing else new. The pipeline uses polars and nflreadpy as in step 1. packages/sim keeps zero runtime dependencies: the sim receives already-validated tables (validation happens in shared or at load, engineer's call, but sim must not import zod).

## Locked decisions (from the lead)

These are fixed for this step. Where I think one is wrong I raised it under open questions instead of changing it.

1. Catalog is JSON data validated by a zod schema. Every screen has at most 7 choices, numbered from 1 in a fixed order.
2. Offense top level: 1 Run, 2 Pass, 3 Kick, 4 Clock. Run: Inside run, Outside run, QB sneak. Pass: Short, Intermediate, Deep, Screen, Play action. Kick: Punt, Field goal. Clock: Spike, Kneel. After a touchdown: Kick extra point, Go for two.
3. Formation list of at most 5 (Shotgun, Under center, Pistol, Empty, Heavy), mapped from participation `offense_formation`. The caller picks formation from a fitted distribution given the chosen play and a coarse situation. If formation ends up with no visible consequence in the engine, it gets cut (brief's fun rule).
4. Defense: 12 presets, each = personnel group + box + coverage + rush, on screens of at most 7. Real plays map to the nearest preset by designed rules.
5. Pass depth by `air_yards`: Short < 10, Intermediate 10 to 19, Deep >= 20. Screen and play action from FTN `is_screen_pass` and `is_play_action`. Inside vs outside run from `run_location` / `run_gap`. QB sneak inferred. Spike and kneel from `qb_spike`, `qb_kneel`. Punt, field goal, go from `play_type` on 4th down. Extra point vs two-point from pbp.
6. Hierarchical backoff to coarser bins when a bin has fewer than N plays, N in a data file.
7. Training: offense general calls 2016 to 2023 weighted toward recent seasons; 4th-down decisions 2021 to 2023 only; defense from participation 2018 to 2023. Never 2024 or 2025. (Also never 2026: it is in progress and later than the holdout.)
8. Output is baked JSON shipped with the game, rebuilt by the pipeline's one command, deterministic, well under 1 MB.
9. Runtime: pure functions in packages/sim, seeded RNG only, no DOM, never sees the other side's call. Situation type in packages/shared.
10. Validation against every real 2024 and 2025 situation, tolerances in a data file, report written by the pipeline, gate fails outside tolerance. No widening tolerances to pass.

## Design

### Files

Layout is the engineer's call except for these constraints: designed files are hand-edited and never written by the pipeline; generated files are only written by the pipeline and carry `"generated": true` plus the training seasons, weights and config hash they came from. Suggested:

| File | Kind | Contents |
| --- | --- | --- |
| `data/calls/catalog.json` | designed | Every screen, choice, number key, label, plain description, availability rule. |
| `data/caller/config.json` | designed | Bin edges, backoff chains, N per factor, season ranges, recency half-life, formation and coverage value mappings, defense preset mapping table. |
| `data/caller/tolerances.json` | designed | Validation metrics, tolerance per metric, minimum sample per metric. |
| `data/caller/*.table.json` | generated | Fitted factor tables (below). |
| `docs/CALLER_REPORT.md` | generated | Mapping checks, missingness checks, backoff stats, validation results. |

### Screens (the catalog, and what docs/MENUS.md lists)

| Screen | Choices | Shown when |
| --- | --- | --- |
| Offense: Play type | 1 Run, 2 Pass, 3 Kick, 4 Clock | Every scrimmage down. Kick only per the availability rule below. |
| Offense: Formation | 1 Shotgun, 2 Under center, 3 Pistol, 4 Empty, 5 Heavy | Before a Run or Pass play (order: open question 10). |
| Offense: Run | 1 Inside run, 2 Outside run, 3 QB sneak | After Run. |
| Offense: Pass | 1 Short, 2 Intermediate, 3 Deep, 4 Screen, 5 Play action | After Pass. |
| Offense: Kick | 1 Punt, 2 Field goal | After Kick. |
| Offense: Clock | 1 Spike, 2 Kneel | After Clock. |
| After a touchdown | 1 Kick extra point, 2 Go for two | Try after your touchdown. Go for two opens Play type with only Run and Pass. |
| Kickoff | 1 Kickoff, 2 Onside kick | Your kickoff. Human only in this step; no caller. |
| Defense: Package | 1 Base, 2 Nickel, 3 Dime, 4 Specials | Every scrimmage down and two-point try. |
| Defense: Base | 1 Base Cover 3, 2 Base Cover 2, 3 Base Cover 1, 4 Run Stuff | After Base. |
| Defense: Nickel | 1 Nickel Cover 3, 2 Nickel Cover 4, 3 Nickel 2-Man, 4 Nickel Cover 1 Blitz | After Nickel. |
| Defense: Dime | 1 Dime Cover 4, 2 Dime Cover 0 Blitz | After Dime. |
| Defense: Specials | 1 Goal Line, 2 Prevent | After Specials. |

MENUS.md gives each choice one plain-language line (for example "Nickel 2-Man: five defensive backs, two deep safeties split the field, everyone else plays man"). This step resolves the CLAUDE.md open issue about the 10-item offense menu: no screen has more than 5 choices.

### Situation (packages/shared)

Always from the perspective of the team with the ball. The defense caller receives the same object (both sides see the same scoreboard), so there is one sign convention.

Fields: `down` (1 to 4), `yardsToGo`, `yardLine100` (yards to the opponent's goal line, 1 to 99), `scoreDiff` (offense minus defense), `quarter` (1 to 4, 5 for overtime), `secondsLeftInHalf`, `secondsLeftInGame`, `offenseTimeouts`, `defenseTimeouts`, `phase` (`scrimmage` or `try`). Exact names are the engineer's call. Nothing about either side's call, personnel, formation or ratings.

### Situation bins (designed)

Bin edges live in config.json. Python (pipeline) and TypeScript (runtime) both bin from that file, and a shared fixture of situations with expected bin keys is checked in both test suites.

| Dimension | Buckets | Why |
| --- | --- | --- |
| Down | 1, 2, 3, 4 | |
| Distance (`ydstogo`) | 1; 2-3; 4-6; 7-10; 11+ | Short yardage, manageable, medium, standard, long. |
| Field zone (`yardline_100`) | Backed up 90-99; Own side 51-89; Midfield 36-50; Fringe 21-35; Red zone 6-20; Goal line 1-5 | Punt vs go vs field goal changes across these; goal line and red zone change play mix. |
| Score diff (offense view) | <= -17; -16 to -9; -8 to -1; 0; 1 to 8; 9 to 16; >= 17 | One score, two scores, three or more, each side. |
| Time | First half before 2:00 left; first half final 2:00; second half with more than 5:00 left in the game; game 5:00 to 2:01 left; game final 2:00 | End of half and end of game behave differently. |
| End-state detail (only in the two "final 2:00" time buckets) | Clock <= 40 s vs 41-120 s; offense timeouts 0 vs 1+; defense timeouts 0, 1, 2+ | Spikes depend on offense timeouts, kneels on defense timeouts and clock. |

Overtime: excluded from training and validation. At runtime an overtime situation is binned as the second half, using seconds left in the period as seconds left in the game. Marked as likely to change.

### Backoff (designed)

Each factor table stores cells only where the unweighted play count is at least N (per factor, in config.json; proposed starting value 150, Joseph confirms). Lookup walks the chain from the finest level until a stored cell is found. The last level is the factor's global distribution, which always exists.

Default chain for the top-level offense factor and the defense front factor:

| Level | Dimensions kept |
| --- | --- |
| L0 | down, distance, zone, score (7), time (5), end-state detail |
| L1 | drop end-state detail |
| L2 | zone 6 to 3 (own side 51-99, opponent side 21-50, red zone 1-20), distance 5 to 3 (1-2, 3-6, 7+) |
| L3 | score 7 to 3 (trailing, tied, leading) |
| L4 | time 5 to 2 (final 2:00 of either half, everything else) |
| L5 | down only |
| L6 | global |

Score sign and the end-of-half/game flag survive until L5, so a sparse trailing cell never borrows kneel share from a leading parent before the very coarse levels. Each other factor (below) lists its own coarser chain in config.json. Coarse buckets must be unions of fine buckets (no edge straddles), checked by a test.

Shares in a cell: `share(c) = sum(w_i * m_i(c)) / sum(w_i)`, where `w_i` is the play's season weight and `m_i(c)` is 1 if play i maps to call c. Stored as integers summing to exactly 10,000 per cell (largest-remainder rounding, ties broken by catalog order). Zero shares stay zero; no smoothing.

Season weight: `0.5 ^ ((2023 - season) / H)`, half-life H = 2 seasons proposed (config.json). Applied within each factor's season range.

### Offense model (mixed: fitted shares, designed mapping and bins)

Factored so each part can use the seasons the lead set.

| Factor | Predicts | Given | Seasons | Source |
| --- | --- | --- | --- | --- |
| O-top | Run, Pass, Punt, Field goal, Spike, Kneel | full situation | downs 1-3: 2016-2023; down 4: 2021-2023 | pbp |
| O-run | Inside, Outside, QB sneak, given Run | down, distance, zone | 2016-2023 | pbp |
| O-passtype | Screen, Play action, Plain dropback, given Pass | down, distance (3), zone (3), score (3), time (2) | 2022-2023 | pbp joined to FTN |
| O-depth | Short, Intermediate, Deep, given plain dropback | down, distance, zone, score (3), time (2) | 2016-2023, corrected (below) | pbp, FTN |
| O-formation | Shotgun, Under center, Pistol, Empty, Heavy | leaf play, down, distance (3), zone (Field 21+, Red zone 6-20, Goal line 1-5) | 2016-2023 | participation |
| O-try | Kick extra point, Go for two | exact score diff after the TD (clipped to -21..21), time (first three quarters, Q4 over 5:00, Q4 final 5:00) | 2016-2023 (PAT moved back in 2015) | pbp |
| O-twopoint | Leaf play on a two-point try | none (one cell) | 2016-2023 | pbp, FTN for the pass type |

Leaf probability for a pass call, for example Deep: `P(Pass) * P(Plain | Pass) * P(Deep | plain)`. Screen: `P(Pass) * P(Screen | Pass)`.

Depth correction: `O-depth` shares from 2016-2023 include screens and play action, because FTN flags do not exist before 2022. Before storing, multiply each depth share by `k(d, down) = P(d | down, plain) / P(d | down, all dropbacks)`, both measured on 2022-2023, then renormalize. The report prints k for each down. (Open question 3 asks whether to drop this and fit depth on 2022-2023 only.)

Formation is sampled after the play, from `O-formation` given the leaf play. Spike, kneel, punt, field goal and try kicks have no formation.

O-twopoint backs off to the goal-line zone cells of O-run and O-passtype / O-depth when the two-point cell has fewer than N plays.

### Mapping real plays to offensive calls (designed, documented in MODEL.md)

Scope: regular season, plays with a non-null `down` and `play_type` in run, pass, punt, field_goal, qb_kneel, qb_spike. Excluded and counted in the report: `no_play`, aborted plays, overtime, 2026, postseason.

| Call | Rule |
| --- | --- |
| Spike | `qb_spike == 1` |
| Kneel | `qb_kneel == 1` |
| Punt | `play_type == "punt"` |
| Field goal | `play_type == "field_goal"` |
| Pass | `qb_dropback == 1` and not a spike. Includes sacks and scrambles. |
| Run | `play_type == "run"`, not a kneel, not a scramble. Fake punts and fake field goals count as Run or Pass by `play_type`. |
| Screen | Pass with FTN `is_screen_pass` true. Takes priority over play action. |
| Play action | Pass with FTN `is_play_action` true and not a screen. |
| Short / Intermediate / Deep | Plain dropback with `air_yards` < 10 / 10 to 19 / >= 20. |
| Depth unknown | Plain dropback with null `air_yards` (sacks, scrambles, some others): counts as Pass in O-top, left out of O-depth. This is the same as attributing them by the cell's own depth mix. |
| QB sneak (inferred) | Run, `qb_scramble == 0`, `ydstogo <= 2`, `run_location == "middle"` or `run_gap == "guard"`, and the rusher is a player who threw a pass for the same team in the same game. Inferred, not charted, before 2022. |
| Inside run | Run, not a sneak, `run_location == "middle"` or `run_gap == "guard"`. |
| Outside run | Run, not a sneak, `run_gap` in tackle, end. |
| Run direction unknown | Run with neither rule matching (for example left/right with null gap, or both null): counts as Run in O-top, left out of O-run. |
| Extra point / Go for two | `extra_point_attempt == 1` / `two_point_attempt == 1`. |
| Formation | `offense_formation` mapped by a value table in config.json: SHOTGUN to Shotgun; PISTOL to Pistol; EMPTY to Empty; SINGLEBACK, I_FORM, UNDER_CENTER and similar to Under center; JUMBO to Heavy. Also Heavy whatever the alignment when `offense_personnel` has 6+ OL or 3+ TE. WILDCAT and any other value: listed explicitly in the table (the engineer proposes a target, Joseph confirms). |

Every distinct value of `offense_formation`, `defense_coverage_type`, `defense_man_zone_type` and `defense_personnel` pattern seen in training or validation seasons must be in a mapping table. An unmapped value fails the build with its name and count; it is never silently dropped or guessed.

Field semantics to verify, not assume: whether pbp `posteam_timeouts_remaining` and `defteam_timeouts_remaining` are before or after the play's own timeout, checked against a few known plays and recorded in DECISIONS.md.

### Defense model (mixed)

Presets (designed). Number keys are within each screen.

| Screen | # | Preset | Personnel (DBs) | Box | Shell | Man/zone | Rushers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Base | 1 | Base Cover 3 | 4 | 7 or fewer | Cover 3 | zone | 4 or fewer |
| Base | 2 | Base Cover 2 | 4 | 7 or fewer | Cover 2 | zone | 4 or fewer |
| Base | 3 | Base Cover 1 | 4 | 7 or fewer | Cover 1 | man | 4 or fewer |
| Base | 4 | Run Stuff | 4 | 8+ | Cover 1 | man | any |
| Nickel | 1 | Nickel Cover 3 | 5 | any | Cover 3 | zone | 4 or fewer |
| Nickel | 2 | Nickel Cover 4 | 5 | any | Cover 4 | zone | 4 or fewer |
| Nickel | 3 | Nickel 2-Man | 5 | any | 2-Man | man | 4 or fewer |
| Nickel | 4 | Nickel Cover 1 Blitz | 5 | any | Cover 1 | man | 5+ |
| Dime | 1 | Dime Cover 4 | 6 | any | Cover 4 | zone | 4 or fewer |
| Dime | 2 | Dime Cover 0 Blitz | 6 | any | Cover 0 | man | 6+ |
| Specials | 1 | Goal Line | 3 or fewer | any | any | any | any |
| Specials | 2 | Prevent | 6+ | any | Prevent | zone | 4 or fewer |

Mapping a real play (designed, applied in this order, first match wins):

1. DBs <= 3 (from `defense_personnel`): Goal Line.
2. Shell is Prevent, or DBs >= 7: Prevent.
3. Shell family from `defense_coverage_type` via a value table: Cover 0, Cover 1, Cover 2 (incl. Tampa 2), 2-Man, Cover 3, Cover 4 (incl. Cover 6 and other quarters variants), Prevent. Values that fit none are listed in the table with a chosen family, never guessed at run time.
4. Look up personnel group (4 DBs Base, 5 Nickel, 6 DBs Dime) and shell in this designed table:

| Shell | Base (4 DB) | Nickel (5 DB) | Dime (6 DB) |
| --- | --- | --- | --- |
| Cover 0 | Run Stuff | Dime Cover 0 Blitz | Dime Cover 0 Blitz |
| Cover 1 | Run Stuff if box >= 8, else Base Cover 1 | Nickel Cover 1 Blitz | Nickel Cover 1 Blitz |
| Cover 2 | Base Cover 2 | Nickel Cover 4 | Dime Cover 4 |
| 2-Man | Base Cover 2 | Nickel 2-Man | Nickel 2-Man |
| Cover 3 | Base Cover 3 (Run Stuff if box >= 8) | Nickel Cover 3 | Nickel Cover 3 |
| Cover 4 | Base Cover 2 | Nickel Cover 4 | Dime Cover 4 |

The rule is personnel group first, then shell, then blitz. Where a cell forces a mismatch (for example a Nickel Cover 1 with a 4-man rush becomes Nickel Cover 1 Blitz, so its rush count differs from the preset's), the report counts it. The report gives, for 2018-2023 and for 2024-2025, the share of mapped snaps whose real personnel group, shell, man/zone or rush differs from the preset's definition, per component. Open question 1 is about the biggest expected mismatch.

Missingness and how it is handled. DATA.md shows `defense_coverage_type` null on about 61% of rows in 2018-2022 and about 50% in 2023, while `defense_personnel` is null on about 24% (0% from 2023). Coverage is probably charted only on dropbacks; the build must confirm this. The report shows coverage-present rate by play type (dropback, run, other) and by down, distance, zone, score and time bucket, per season.

Because the defense picks its call before it knows run or pass, fitting coverage only from pass plays would bias it toward whatever defenses do when offenses choose to pass. Designed handling, applied whether or not the check shows bias by situation (it is expected by play type):

- D-front: personnel group plus box flag (8+ vs 7 or fewer) given the full situation, from all scrimmage plays with personnel present, 2018-2023, backoff chain as O-top.
- D-coverage: shell family, man/zone and rush bucket given front and coarse situation (down, distance 3, zone 3, score 3, time 2), from plays with coverage present, 2018-2023.
- Preset share = sum over fronts of `P(front | situation) * P(coverage | front, coarse situation)`, mapped through the table above.

The assumption: given the front and situation, coverage on run plays looks like coverage on pass plays. This data cannot test it directly. A partial check goes in the report: FTN `n_blitzers` is charted on all plays in 2022-2023, so the report compares blitz rate on runs vs dropbacks within the same coarse cells. It is a diagnostic, not a gate.

Second risk: the charting changed in 2023 (coverage null rate and `defenders_in_box` null rate both jump). Validation seasons are charted like 2023, training mostly like 2018-2022. The report prints the preset mix per season 2018-2023 so a jump at 2023 is visible.

Defense on a two-point try: one D-try cell fitted from two-point attempts with participation present, 2018-2023, backing off to goal-line zone cells. No defense call on punts, field goals, extra point kicks or kickoffs.

### Runtime (packages/sim)

Pure, no DOM, seeded RNG only. Signatures are the engineer's call; the behavior is fixed:

- Share functions take a situation and tables and return the full distribution over leaf calls (offense: leaf play plus formation joint, or leaf play and a separate formation step; defense: preset). No RNG. M3 personalities will tilt this distribution before sampling.
- Sampling functions take a distribution and the RNG and return one call. Integer weights are walked in catalog order with one draw per sampled step.
- `chooseOffenseCall(situation, tables, rng)` and `chooseDefenseCall(situation, tables, rng)` compose the two. A try situation returns Kick extra point or Go for two, and Go for two then samples a two-point play.
- Availability: calls the catalog marks unavailable in the situation get zero share and the rest is renormalized. If nothing is left, lookup moves to the next backoff level; if still nothing, the global distribution masked the same way. The catalog guarantees at least Run and Pass are always available, so this terminates.
- The pipeline's validation uses the same share logic in Python. A golden file of at least 200 situations with the pipeline's shares is generated and the TypeScript shares must match it exactly (integer weights) or within 1e-9 (combined floats).

Availability rules (designed, in the catalog): Kick is available on 4th down, and on any down in the final 2:00 of either half. Clock (Spike, Kneel) is always available. On a try, only the try screen and then Run or Pass. Number keys never renumber when an item is unavailable; whether it is hidden or greyed is designer's call.

### Validation (the caller's own calibration, no engine)

For every real 2024 and 2025 play in scope, compute the caller's predicted distribution for that play's situation. Predicted rate of a metric = mean of predicted probabilities over the plays in the metric's scope. Actual rate = share of those plays whose mapped call matches. Same mapping rules as training.

Metrics, with proposed tolerances in absolute percentage points (Joseph confirms before the first run; values live in tolerances.json):

| Metric | Scope | Tolerance | Min n |
| --- | --- | --- | --- |
| Pass rate overall | downs 1-4 scrimmage | 2.0 | |
| Pass rate by down | each down | 3.0 | 500 |
| 4th down go / punt / field goal | each field zone | 5.0 each | 200 |
| Go for two rate | all tries | 3.0 | |
| Kneel rate | each final-2:00 state (half, game) by score (3) | 5.0 | 100 |
| Spike rate | final 2:00 of each half | 3.0 | 100 |
| Depth mix (Short, Intermediate, Deep) | plain dropbacks with air yards | 3.0 each | |
| Screen share, play action share | dropbacks | 3.0 each | |
| Run type mix (Inside, Outside, Sneak) | runs with known direction | 4.0 each | |
| Formation mix | run and pass plays with formation | 4.0 each | |
| Blitz rate (5+ rushers) | dropbacks with rushers charted | 4.0 | |
| Man share | plays with man/zone charted | 4.0 | |
| Preset mix | mapped plays | 4.0 each | |

Metrics below their minimum n are reported and not gated. The report also gives the actual rate's 95% interval so Joseph can see when a miss is within noise.

Pre-registration: config.json (bins, N, half-life, mappings) and tolerances.json are committed before the first validation run. Any later change to either is a DECISIONS.md entry that names the validation result it follows, and the report prints the config hash. Changing tolerances, seasons or weights because a metric failed is not allowed without Joseph's explicit decision.

Fourth-down drift: teams have gone for it more often over recent seasons, and 4th-down shares are fitted on 2021-2023 only. If the drift continues, the caller under-predicts go rate in 2024-2025 and over-predicts punts. The report states the observed direction per zone. If the gate fails, the failure stands and is reported to Joseph with the numbers. Fixing it (for example a trend term, or accepting the miss) is his decision, not the engineer's.

The gate: the pipeline command writes everything, then exits non-zero if any gated metric fails. A machine-readable summary (for example `data/caller/validation.json`) is committed, and a CI test fails if it records a gated failure, so a failing caller cannot look green.

## Milestones

Each is shippable on its own branch and goes through code-reviewer and test-writer.

### A: catalog, schema, situation, bins, MENUS.md

Catalog JSON, zod schema, Situation type, binning in TypeScript from config.json, the shared binning fixture, docs/MENUS.md.

| # | Criterion | How it fails |
| --- | --- | --- |
| A1 | The catalog parses with the zod schema; a test loads it in CI. | Schema error. |
| A2 | Every screen has 1 to 7 choices, keys are exactly 1..n with no gaps or duplicates, ids are unique across the catalog. Tests include bad fixtures (8 choices, duplicate key, gap) that the schema rejects. | A bad fixture passes. |
| A3 | Every leaf call is reachable from a top screen, and every choice that opens a screen points to one that exists. | Orphan or dangling reference. |
| A4 | Every availability rule references only Situation fields; a rule naming an unknown field fails validation. | Unknown field accepted. |
| A5 | Availability: Kick available on 4th down and on downs 1-3 only within the final 2:00 of a half; Run and Pass available in every scrimmage and two-point situation. Tested on fixture situations at each boundary (120 s and 121 s). | Wrong availability at a boundary. |
| A6 | Binning: every fixture situation gets its expected bin key at every backoff level, including each edge value in the bin table (for example distance 1, 3, 4, 6, 7, 10, 11; yard line 5, 6, 20, 21, 35, 36, 50, 51, 89, 90). | Mismatch. |
| A7 | Coarse buckets are unions of fine buckets (test over the config). | A coarse edge falls inside a fine bucket. |
| A8 | docs/MENUS.md lists every screen in the catalog with its numbered choices and a one-line plain description, and a test checks the screen and choice names in MENUS.md match the catalog. | Drift between MENUS.md and catalog. |
| A9 | packages/sim does not import zod (lint or test), and still has no runtime dependencies. | Import found. |

### B: pipeline mapping and checks

Map real plays to calls, formations and presets. Write the mapping and missingness sections of CALLER_REPORT.md.

| # | Criterion | How it fails |
| --- | --- | --- |
| B1 | pytest on hand-made frames: each row of the offense mapping table maps as specified, including priority (screen over play action, spike over pass, kneel over run, fakes by play_type), and unknown-depth or unknown-direction rows are counted at the top level and left out of the sub-level. | Any wrong mapping. |
| B2 | pytest: the QB sneak rule fires only when all its conditions hold; one negative row per condition. | False positive or negative. |
| B3 | pytest: the defense mapping returns the specified preset for every cell of the mapping table plus the Goal Line and Prevent rules, and first match wins. | Wrong preset. |
| B4 | pytest: an unmapped formation, coverage or personnel value fails the build with the value and count. | Silent drop or guess. |
| B5 | The report lists every distinct `offense_formation`, `defense_coverage_type`, `defense_man_zone_type` value and personnel pattern with counts per season, and the mapping target of each. | Missing value. |
| B6 | The report shows coverage-present rate by play type and by each situation dimension, per season 2018-2025, and the FTN blitz-rate comparison runs vs dropbacks for 2022-2023. | Missing table. |
| B7 | The report shows the QB sneak rule's agreement with FTN `is_qb_sneak` on 2022-2023 (counts of both, both-true, each-only). | Missing. |
| B8 | The report shows counts excluded by reason (no_play, aborted, overtime, postseason, out of season range) and the mapping mismatch shares per defense component. | Missing. |
| B9 | No player names or IDs in any generated file. pytest on the renderer plus reviewer check. | Names or IDs present. |

### C: fitting and baked tables

| # | Criterion | How it fails |
| --- | --- | --- |
| C1 | One pipeline command rebuilds every generated caller file and the report from the cache. Running it twice gives byte-identical files (`git diff --exit-code`). | Any diff. |
| C2 | Each generated table records the seasons and weights used. A test fails if any training season is 2024 or later; a pytest feeds frames containing 2024, 2025 and 2026 rows and shows they never reach any fitted cell. | A holdout row influences a share. |
| C3 | 4th-down O-top cells use only 2021-2023; O-passtype only 2022-2023; defense only 2018-2023. Checked from table metadata and by pytest. | Wrong season range. |
| C4 | pytest: on a hand-made frame, a cell with fewer than N plays is absent and lookup lands on the parent; a cell with exactly N is stored. | Off-by-one or wrong parent. |
| C5 | pytest: weighted shares match hand-computed values for a two-season frame under the half-life formula. | Wrong weights. |
| C6 | Every stored cell's weights are non-negative integers summing to exactly 10,000; largest-remainder ties go by catalog order. | Sum not 10,000, or nondeterministic rounding. |
| C7 | The depth correction factors k are printed per down in the report, and a pytest checks them on a hand-made frame. | Missing or wrong. |
| C8 | All generated caller tables together are at most 300 KB as written. A test measures it. | Over budget. |
| C9 | Tables validate against their zod schema when loaded in TypeScript. | Schema error. |

### D: runtime caller

| # | Criterion | How it fails |
| --- | --- | --- |
| D1 | Same seed, same situations and tables give the same sequence of calls over 10,000 calls. | Any difference. |
| D2 | Share functions take no RNG and return distributions summing to 1 (within 1e-9) over available calls only. | Unavailable call with share, or bad sum. |
| D3 | Golden file: TypeScript shares equal the pipeline's for at least 200 situations covering every backoff level, try situations and masked situations. | Any mismatch. |
| D4 | Sampling matches the distribution: 100,000 draws from a fixed situation land within 0.5 percentage points of each share. | Outside. |
| D5 | Masking: a fixture where the finest cell's only nonzero call is unavailable falls through to the next level, and a situation where every level is masked to nothing except Run and Pass still returns a call. | Throw, loop or unavailable call. |
| D6 | The defense caller's inputs contain no offense call or formation (type-level: the function signature takes only Situation, tables, rng). | Offense call reachable. |
| D7 | Purity: existing purity test covers the new files (no DOM, no `Math.random`, no imports outside sim and shared). | Lint or typecheck passes with a violation. |

### E: validation, report, docs

| # | Criterion | How it fails |
| --- | --- | --- |
| E1 | The report has every metric in the table above with predicted, actual, n, 95% interval of actual, tolerance, and pass / fail / not gated. | Metric missing. |
| E2 | The command exits non-zero when any gated metric fails, after writing the report and summary. pytest with a fixture that fails one metric. | Exits 0, or report not written. |
| E3 | A CI test reads the committed validation summary and fails if it records a gated failure. | CI green with a failure recorded. |
| E4 | The report prints the config hash, and DECISIONS.md has an entry for each designed choice in this step (bins, N, half-life, mappings, tolerances, the defense missingness handling). | Missing. |
| E5 | MODEL.md "Baseline play caller" section is marked mixed and says which parts are fitted (shares) and which are designed (catalog, bins, backoff, mappings, defense factorization and its assumption). It never calls the defense mapping data-derived. | Mislabeled. |
| E6 | If any gated metric fails, the result goes to Joseph with the numbers before the step is called done; tolerances are unchanged in the diff. | Tolerances edited in the same change as a failing result. |
| E7 | CLAUDE.md open issues "fitted baseline play caller" and "10-item offense menu vs the seven-choice rule" are marked settled with a pointer to DECISIONS.md. | Still listed as open. |

## Edge cases and reachable states

- 4th and goal at the 1 with 0:03 left in the half, trailing by 3: Kick available, top-level cell may be sparse, backoff keeps "final 2:00" and "trailing".
- Fourth down field goal from beyond any real attempt (own 30): shares come from the Own side zone, where field goals are near zero. No range rule here; the engine decides makes and misses.
- 1st and 25 after penalties: distance 11+.
- Goal-to-go where distance equals yard line: binned normally.
- Kneel and spike in odd states (kneel while trailing late, spike on 4th): whatever the data shows. Reported per end-state cell, not overridden.
- A try after a touchdown with the score tied or the game decided: exact-diff O-try cell, clipped at plus or minus 21.
- A situation whose cell masks to nothing at every level except global: global masked, Run and Pass always remain.
- Overtime situation: binned as second half (see Situation bins).
- A two-point try: defense uses D-try; offense uses O-twopoint.
- A coverage or formation value appearing first in 2024 or 2025: fails the build like any unmapped value (validation uses the same tables).

## Dependencies and sequencing

- A first (catalog and bins are inputs to everything). B can start in parallel with A once config.json's bin and mapping sections exist.
- C needs B. D needs A and C's table format (can build against fixture tables before real ones exist). E needs C and D.
- The real build and validation run on Joseph's machine with the warm nflverse cache. CI runs only fixture-based tests plus the committed-summary check (E3).
- Joseph confirms N, half-life and tolerances before E's first real run.

## Locked vs likely to change

Locked for this step: the decisions listed at the top; Situation from the offense's perspective; integer weights per cell; designed files never written by the pipeline; training never touches 2024, 2025 or 2026.

Likely to change: bin edges and N after the first backoff report; formation list (cut if it has no visible consequence); preset names and the mapping table after the mismatch report; overtime handling; whether the defense sees offensive personnel (M2 or later); tolerances after Joseph's first review (before the first run only).

## Open questions

1. Open: Nickel Cover 1 with a normal 4-man rush is probably one of the most common real calls, and the locked set has no preset for it. Under the mapping it becomes Nickel Cover 1 Blitz, which inflates how often the caller "blitzes" in the engine's eyes even though the blitz-rate metric (from real rushers) stays honest. Option: rename preset Nickel #4 to "Nickel Cover 1" and move the blitz into a different slot (for example drop Base Cover 1, since base personnel is now a minority). Decide after B8's mismatch numbers.
2. Open: FTN has `is_qb_sneak`, charted on every play 2022 on. The lead locked "inferred". Should O-run use the FTN flag for 2022-2023 sneak shares instead of the inference rule, keeping the rule only for 2016-2021? Decide after B7's agreement numbers.
3. Open: the depth correction (k factors) adds a moving part. Simpler alternative: fit O-depth on 2022-2023 only, like O-passtype. Costs sample size, removes the correction. Engineer reports both in the report for one run; Joseph or the lead picks.
4. Open: the defense does not see the offense's personnel or formation. Real defenses substitute in response (nickel vs three receivers). Should the defense caller condition on offensive personnel when M2 adds it, and is that "the other side's call"?
5. Open: designed guard rails on fitted shares (never kneel when trailing late, never spike on 4th down). Not added here. Add only if the report or playtests show the fitted caller doing something no coach would do.
6. Open: regular season only, or include postseason? Default here: regular season, to match what the calibration test will likely compare against.
7. Open: overtime. Excluded from fitting; binned as second half at runtime. Revisit when overtime rules land in RULES.md.
8. Open: license. The baked tables are aggregates of nflverse, participation and FTN charting data. Step 1 open question 5 (license per table, FTN in particular) must be answered before these tables are committed to a repo that is or will be public. Until then, should generated tables be gitignored and built locally?
9. Open: what does Joseph's decision on a failed gated metric look like in the repo, so CI (E3) can go green without editing tolerances? For example a list of accepted misses in tolerances.json, each pointing to a DECISIONS.md entry he wrote.
10. Open: menu order. The brief says pick a formation, then a play. MENUS.md lists Formation before the play screens. The caller samples the play first, then formation given the play; the joint result is the same either way. Designer confirms the human order.
11. Open: N = 150, half-life = 2 seasons and the tolerances above are proposals, not derived. Joseph confirms or changes them before the first validation run.

## Resolved open questions (lead, 2026-11-11)

Amended by docs/specs/m1-step5a-caller-late-game-bins.md (late-game score bins for oTop, o4Top and o4Kick; post-validation revision 2).

These override anything above that conflicts. Record each in docs/DECISIONS.md.

1. Defense set: drop Base Cover 1, add Nickel Cover 1 (4-man rush). Keep Nickel Cover 1 Blitz. Final 12: Base Cover 3, Base Cover 2, Run Stuff, Nickel Cover 3, Nickel Cover 4, Nickel 2-Man, Nickel Cover 1, Nickel Cover 1 Blitz, Dime Cover 4, Dime Cover 0 Blitz, Goal Line, Prevent. Base screen has 3 choices, Nickel 5, Dime 2, Specials 2. If the mismatch report shows another common real call with no home, report it; don't add presets without asking.
2. QB sneak: use FTN `is_qb_sneak` for 2022-2023. Use the inferred rule only for 2016-2021, and report its agreement with the flag on 2022-2023.
3. Pass depth: fit depth on 2022-2023 only, among passes that are neither screen nor play action, with backoff. Drop the k-factor correction. Simpler wins; recent seasons dominate the weighting anyway.
4. The defense caller never sees offensive formation or personnel. Formation is part of the offensive call, and the AI never reads the player's call.
5. No guard rails on fitted shares in this step. The validation report and later soak tests catch nonsense. If a nonsense call (kneel while trailing late, spike on 4th) shows up in validation, report it.
6. Regular season only.
7. Overtime: as proposed. Excluded from fitting, binned as second half at runtime.
8. License: before baking, look up the license for nflverse play-by-play, participation and FTN data from nflverse's own documentation or repo (primary source, not a blog). Record source, license and attribution needs in docs/DATA.md. Generated tables stay committed; the repo is private. If FTN or participation terms forbid redistribution of derived aggregates, stop and report before committing those tables.
9. Accepted failures: the tolerance file has a `known_deviations` list. Each entry has metric, observed, target, reason, date and "approved_by". The gate test honors only entries with approved_by set by Joseph. The engineer never adds one; a failure is reported.
10. Order: as proposed. The caller samples the play first, then the formation given the play.
11. N = 150, half-life 2 seasons and the proposed tolerances are accepted. Commit them before the first validation run, and never change them after seeing results.

Amended in Post-validation revision 1 (lead, 2026-11-11), after the first 2024-2025 validation run:

- Locked decision 7, 4th-down seasons. The 4th-down decision is split. Go vs kick (o4Top) is fitted on 2021-2023 as locked. Punt vs field goal given a kick (o4Kick) is fitted on 2016-2023, which departs from "4th-down decisions 2021 to 2023 only". This causes the two midfield misses (field goal and punt), which Joseph approved as known deviations. See docs/DECISIONS.md, "Amendment to locked decision 7: o4Kick seasons".
- The rest of revision 1 is in docs/DECISIONS.md, "Post-validation revision 1": the 4th-down backoff keeps the fine field zone until last, the downs 1-3 chain keeps the clock state longer, and Nickel Cover 2 is a 13th preset.

