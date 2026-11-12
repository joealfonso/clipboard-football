# M1 step 4: play engine

Status: draft, 2026-11-11. Owner: Joseph.

## Goal

Build `resolvePlay` in packages/sim: a pure, seeded function that takes the game state, both teams' calls and the players on the field, and returns a step 3 PlayResult plus a one-line "why" built only from the factors it used.

For: Joseph, who wants a sim that is realistic and fun (calls matter, players matter, big plays still happen), and the agents building M1. Step 5 loops this function with the step 2 callers and the step 3 machine for full games and the 10,000-game calibration, so any step 5 miss should trace to one component here, each already checked on its own.

In plain words: the engine looks up what real NFL plays of the same kind looked like in the same kind of situation, picks one at random, and tilts the odds first by how the two calls match up and by how good the players are. A league-average team calling plays like an average coach gets exactly the real NFL numbers.

## Non-goals (out of scope)

- The full-game loop, tempo (pre-snap run-off), timeout and accept-or-decline decisions, onside and kickoff calling. Step 5 or M3.
- Calibration of game aggregates: points, plays and drives per game, time of possession, home field. Step 5.
- UI and animation (M2). The PlayResult and its `detail` carry what animation needs later; animation never decides anything.
- Rosters beyond the M1 generator, depth charts, injuries, fatigue, progression (M5). Personalities (M3).
- Weather, surface, home field, player-specific tendencies.
- Any change to the step 2 Situation, the catalog, the caller tables, or the step 3 machine's behavior.

## Dependencies allowed

Nothing new. Pipeline: polars and nflreadpy as before (nflreadpy 0.1.5 has `load_combine`). TypeScript: zod in packages/shared only; packages/sim stays dependency-free and receives already-validated data.

## Locked decisions (from the lead)

These are fixed. Where I think one has a problem it is raised under open questions, not changed.

1. **Baseline outcomes are fitted.** Conditional empirical distributions, sampled by bootstrap from real plays, by play type (the step 2 call leaves) and situation bins, with backoff as in step 2. Source: pbp regular season 2016-2023, weighted toward recent seasons. Never 2024, 2025 or 2026. Covers yards, completion, sack, scramble, interception, fumble and recovery, touchdowns, out of bounds, clock used, punt distance and return, field goal make probability by distance, extra point and two-point success. Whole real plays are sampled where possible, so yards, clock and out of bounds stay jointly coherent. Field goal accuracy has drifted up; it is weighted harder toward recent training seasons and the drift is noted.
2. **Kickoffs are designed**, tuned to 2025 (DECISIONS.md), emitted under the 2026 mechanics.
3. **The matchup table is designed, never data-derived.** Multipliers on the baseline for each offense leaf against each of the 13 presets, in a data file, documented in MODEL.md with a one-line football reason for each notable cell. Centered so that, under the baseline callers' real call mix, league aggregates are unchanged. A cell informed by participation data is labeled "mixed", never "designed" or "fitted".
4. **Player ratings.** Speed, Strength, Agility, Awareness on 0-99, plus position skills. Speed and Strength grounded in combine measurements by position through a designed percentile mapping. Unit ratings aggregated from the players on the field (designed). Rating effects are designed multipliers, centered so a league-average team reproduces the baseline. Every rating has a visible consequence or is cut. M1 ships a generator of league-average fictional teams.
5. **Penalties.** Fitted frequencies by play type and situation for the penalties the step 3 rule set supports. Only combinations step 3 accepts.
6. **The "why" sentence** comes from a structured trace of the factors used, through templates in a data file. A test asserts every sentence references only factors present in the trace.
7. **Variance is not flattened.** Big plays and fluke turnovers keep real tail frequencies.
8. **Component validation against 2024-2025**, tolerances pre-registered in a data file, `known_deviations` (Joseph-approved only) as in step 2.
9. **Performance:** fast enough that a full game simulates in under 25 ms. Recorded in PERF.md.
10. **Purity:** no DOM, no `Math.random`, one seeded Rng passed in. Only `resolvePlay` sees both calls.

## Design

### Signature and inputs

```
resolvePlay(state, offenseCall, defenseCall, players, rng, data) -> PlayResult
```

- `state`: the step 3 GameState in phase `scrimmage`, `try` or `kickoff`. Any other phase throws a typed error. The engine reads the situation through step 3's `toSituation` where one exists.
- `offenseCall`: the step 2 `OffenseCall` (leaf, formation, two-point play). On a kickoff, the catalog's `kickoff` or `onsideKick`.
- `defenseCall`: a preset id, or `null`. Required on run, pass and two-point plays. Ignored, and recorded as ignored, on punts, field goals, extra points, kickoffs, spikes and kneels.
- `players`: both teams' player pools (schema below). The engine picks the 11 on the field for each side from the designed personnel table.
- `data`: the validated engine tables, matchup table, rating config, templates and rule set. The sim never reads files.

The sixth argument departs from CLAUDE.md's four-argument signature and the brief's five (open question 1).

The result is a PlayResult that step 3's `applyPlay` accepts for that state. `detail.why` holds the sentence and `detail.trace` the structured factors. No other PlayResult field is added.

### Data files

Designed files are hand-edited and never written by the pipeline. Generated files are written only by the pipeline and record `generated: true`, seasons, weights and config hash, as in step 2. Suggested layout:

| File | Kind | Contents |
| --- | --- | --- |
| `data/engine/config.json` | designed | Outcome classes, bins, backoff chains, N per cell, half-lives, fluke thresholds, the penalty pairing table. |
| `data/engine/baseline.*.json` | generated | Fitted outcome pools per call family and cell, special teams tables, penalty rates, play-duration tables. |
| `data/engine/kickoff.json` | designed | Kickoff and onside outcome rates and spot distributions, tuned to 2025. |
| `data/engine/matchup.json` | designed (some cells mixed) | Raw multipliers, offense leaf x preset x outcome class, each notable cell with a reason and a label. |
| `data/engine/matchup.centered.json` | generated | The centered multipliers the engine reads. |
| `data/engine/personnel.json` | designed | Which position slots are on the field for each formation and each preset. |
| `data/players/ratings.json` | designed | Rating list per position, unit aggregation weights, effect curves. |
| `data/players/distributions.json` | generated | Per-position rating distributions from combine percentiles plus designed parts. |
| `data/players/names.json` | designed | Fictional first and last name lists. |
| `data/engine/why.json` | designed | Sentence templates. |
| `data/engine/tolerances.json` | designed | Validation metrics, tolerances, minimum n, `known_deviations`. |
| `data/engine/validation.json` | generated | Validation summary with file and code hashes, as step 2. |

Total generated engine and player tables: proposed budget 2 MB as written (open question 7).

### Baseline outcome model (fitted, with designed classes and bins)

**Play families and pools.** Each real 2016-2023 regular-season play is mapped to a step 2 leaf with step 2's mapping code, reused, not copied. Families: inside run, outside run, QB sneak, each pass leaf (short, intermediate, deep, screen, play action), kneel, spike, two-point run, two-point pass. Pass type and depth are only known 2022 on (FTN) and from `air_yards`; dropbacks with unknown depth (sacks, scrambles, throwaways) must still land in a pass leaf, or sack and scramble rates per leaf are wrong. How unknown-depth dropbacks are assigned (proposed: in proportion to the cell's depth mix, the same assumption step 2 made) is the engineer's call and goes in DECISIONS.md, but the per-leaf sack and scramble rates it produces are reported.

**Outcome classes (designed).** Every pooled play falls in exactly one class of its family. Proposed partition, in config.json:

- Run: fumble, loss or no gain (yards <= 0), 1-3, 4-9, 10-19, 20+.
- Pass: sack, scramble, interception, incomplete, fumble after catch, completion <= 0, 1-9, 10-19, 20+.
- Fumble classes cover every fumble; who recovered stays as it was in the real play.

Matchup and rating multipliers act only on class probabilities. Within a class, the real play is drawn with its season weight, untouched. That keeps every joint detail of the real play (yards, return, out of bounds, fumble recovery, defense possession) coherent, and keeps tail shapes real.

**Bins and backoff.** Step 2's situation dimensions, reused from data/caller/config.json. Proposed chain for scrimmage families: (leaf, formation, down, dist5, zone6, score3, time2), then drop formation, then (leaf, down, dist3, zone6), (leaf, dist3, zone3), (leaf, zone3), (leaf), family global. Field zone is kept long because yards near the goal line are compressed. Proposed N = 300 plays per stored cell (higher than step 2's 150 because a cell is now a whole distribution with tails); Joseph confirms before the first run.

**Field position.** A sampled play's yards are applied at the current spot. Yards that reach the goal line are a touchdown; a loss into the offense's own end zone is a safety by impetus. Returns on turnovers are applied from the turnover spot in the same way.

**Formation.** Formation gets a visible consequence only through the fitted conditioning above (for example under-center runs vs shotgun runs) and through which players are on the field. Formation coding changed in 2023 (only SHOTGUN, UNDER CENTER, PISTOL from 2023; DECISIONS.md), so Empty and Heavy cells come only from 2016-2022. If formation shows no measurable effect in any cell, the report says so and formation is a cut candidate (step 2's fun rule).

**Clock used (mixed).** pbp has no play-duration column: `game_seconds_remaining` at the next snap minus this snap includes pre-snap run-off whenever the clock kept running. To verify against the data dictionary, not assume. Proposed: fit play duration from the clean subsample, plays after which the clock was stopped before the next snap (incomplete, out of bounds where the clock waits for the snap, a timeout recorded before the next snap, scores, two-minute warning, change of possession), as a distribution given family and yards class, and draw it with the sampled play. The selection of that subsample is designed and its bias is reported (open question 4). Pre-snap run-off stays step 5's.

**Special teams (fitted, except kickoffs).**

- Punts: whole real punts by yard line bin (2016-2023): gross distance, block, touchback, fair catch, downed, out of bounds, muff and recovery, return yards, return touchdown. Mapped onto PuntPlay fields.
- Field goals: make probability as a function of kick distance, plus block rate and blocked-kick recovery and return. Seasons 2016-2023 with a shorter half-life than the rest (proposed 1 season, anchored at 2023), because accuracy has risen. Method (binned with minimum count, or a smooth fit in distance) is the engineer's call; the report shows the fitted curve against each training season. Expected: 2024-2025 accuracy, especially 50+, is above the curve. That miss is pre-registered here, not fixed after the fact. The kick spot (distance behind the line) is measured from `kick_distance` and `yardline_100` and stored as data.
- Extra points: success and block rate, 2016-2023 (the kick moved back in 2015).
- Two-point tries: whole real two-point plays by run or pass leaf, backing off to scrimmage plays snapped at the 2 when a cell is under N.
- Kneels and spikes: real yards and duration, small pools, no classes or multipliers.

**Kickoffs (designed).** data/engine/kickoff.json holds outcome rates and spot distributions: touchback in the end zone, touchback after the landing zone, short, out of bounds, fair catch, returned (return yards distribution), muff and recovery, return touchdown, and onside recovery. Tuned by hand until simulated kickoffs match 2025 (DATA.md: touchback 20.9%, return 74.2%, mean start 30.72). The tuning check runs against 2025 and is labeled as confirming the tuning, not a prediction.

Effect of the 2026 changes on the tuning, to state in MODEL.md:

- Touchback at the 20 for any kick from the 50 (6-1-5) changes nothing tuned. The machine only kicks from the 50 after enforced fouls move the kickoff there, which is near unreachable. If it happens, the machine applies the spot; the engine's kick distribution is the same.
- Onside kicks any time (6-1-6) change when teams attempt them, which is a calling decision (step 5 or M3), not an outcome rate. An onside kick must still be declared, so there is no surprise onside and the recovery rate of a declared onside kick is unchanged in kind. Proposed recovery rate: 2025 declared onside kicks, few in number, so it is designed and the report shows the 2025 count and its interval.
- Safety kicks (from the 20) are rare; their outcomes are designed and marked so.

### Matchup table (designed; participation-informed cells mixed)

- Cells: 8 scrimmage leaves (3 run, 5 pass) x 13 presets x outcome class. Two-point tries use the same table. Kicks, kneels and spikes have no matchup.
- Raw multipliers in matchup.json. Each notable cell (any multiplier outside 0.9-1.1) has a label (`designed` or `mixed`) and a one-line football reason, for example "Screen vs Dime Cover 0 Blitz: rushers run past the screen, more 10+ gains." Proposed bounds 0.5 to 2.0 per multiplier, in the schema.
- **Centering.** The engine reads matchup.centered.json, generated from the raw table by a normalization step. Constraint: for each offense leaf, over the 2016-2023 training situations weighted as in the baseline, with each preset weighted by the step 2 defense caller's shares in that situation, the class probabilities after multipliers equal the baseline class probabilities. Because multipliers are renormalized within a family, plain scaling is not exact; the method (an iterative per-leaf, per-class correction, or a per-situation-cell correction) is the engineer's call. The normalization is the only writer of the centered file, and the raw file is never touched.
- What centering means for play: a human who picks the right defense beats the average, and the average AI defense gives real NFL numbers.
- Where participation data could inform cells, each labeled mixed:
  - Yards per attempt, completion and interception rate against man vs zone, by pass depth, from 2018-2023 participation joined to pbp (coverage is charted on about 89% of dropbacks before 2023 and nearly all from 2023).
  - Sack and pressure rate by rusher count (`number_of_pass_rushers`, `was_pressure`) for blitz vs non-blitz presets.
  - Inside and outside run yards against 8+ in the box (`defenders_in_box`, 2016 on).
  - Shell (Cover 0 to 4) against depth, where `defense_coverage_type` is charted.
  These are confounded: defenses choose coverage in response to the situation and the offense's look. Any informed cell is compared within the same situation bins, uses training seasons only, records the comparison in MODEL.md, and is still a design choice about how much of the measured difference to keep.

### Players and ratings

**Schema (packages/shared, type-only; zod schema alongside the others).** A player has: id, name, position, `ratings` (Speed, Strength, Agility, Awareness), `skills` (position skills), integers 0-99, and `schemaVersion`. Unit ratings and effects are computed, never stored. M5 adds optional fields (age, potential, history) under a new `schemaVersion` with a migration test; nothing in M1 depends on their absence. A player pool per team lists players per position slot; M1 needs no depth chart.

**Rating list (proposed, Joseph confirms):**

| Position | Position skills | Base ratings with an engine effect |
| --- | --- | --- |
| QB | Throw Power, Accuracy | Speed, Agility (scramble and sack escape), Awareness (interceptions, sacks taken) |
| RB | Ball Security, Elusiveness | Speed (20+ runs), Strength (short yardage), Agility (stuffs avoided), Awareness (blitz pickup: sacks) |
| WR | Hands, Route Running | Speed (deep and 20+), Agility (yards after catch class), Strength (contested: interceptions), Awareness (penalties) |
| TE | Hands, Route Running, Run Block | as WR, plus Strength in the run unit |
| OL | Pass Block, Run Block | Strength, Agility (into both units), Awareness (false starts, holding) |
| DL / EDGE | Pass Rush, Run Stop | Speed, Strength (into both units), Awareness (offside, encroachment) |
| LB | Tackling, Coverage | Speed (outside runs, screens), Strength (inside runs), Awareness (play action) |
| CB / S | Coverage, Ball Skills | Speed (deep), Agility (short), Strength (tackling: 20+ runs), Awareness (pass interference) |
| K | Kick Power, Kick Accuracy | none (open question 9) |
| P | Kick Power, Kick Accuracy (hang and placement) | none (open question 9) |

TE has three skills because it both catches and blocks. Every cell in the right column must map to a named class or penalty multiplier in ratings.json, and a test enforces it (criterion D6).

**Grounding (mixed: measured inputs, designed mapping).**

- Speed: 40-yard dash. Strength: bench press reps, with weight as a secondary input (open question 10). Agility: 3-cone and short shuttle. Percentile within position, mapped to 0-99 by a designed curve in ratings.json.
- Awareness and every position skill have no measured input. Their distributions are designed and say so.
- Combine has missing drills that are not random: top prospects often skip the 40 and the bench. The report shows per-position drill coverage, and the percentile is computed over players with the drill, with the bias noted.
- Population: combine participants are prospects, not players who take snaps. Proposed: weight each combine row by the player's 2016-2023 snaps, by joining combine to rosters (pfr_id to gsis_id) and participation. Only per-position percentile tables ship; no player row, name or id.
- `load_combine` is not in the step 1 survey and its license is unchecked (nflverse combine data comes from Pro Football Reference). It must be surveyed in DATA.md and its license checked before anything derived from it is committed (CLAUDE.md boundary). Open question 8.

**Unit ratings (designed).** Pass block, pass rush, run block, run defense, coverage, plus QB passing and ball-carrier units, each a weighted aggregate of the on-field players' ratings with weights in ratings.json (for example pass block leans on the weakest lineman). The **edge** a play uses is the unit rating minus the league-average unit rating for the same personnel slots. This keeps structural effects (Dime is light against the run) in the matchup table only, so they are not counted twice.

**Effects (designed, centered).** Each effect is a multiplier on a named class (or a penalty rate), a function of an edge with value exactly 1 at edge 0, with slope and bounds in ratings.json. Effects compose multiplicatively with the matchup multipliers on class probabilities, then renormalize within the family.

**Generator (M1).** `generateTeam(rng, data)` returns a pool large enough for every grouping in personnel.json, plus a K and a P, with ratings drawn from data/players/distributions.json and names from names.json. Same seed, same team. Names are fictional: the pipeline checks every first-last combination in names.json against nflverse rosters 1999 to now and fails the build with the count of collisions (no names printed or stored). Real rosters never enter the repo.

### Penalties (fitted rates, designed pairing)

- Rates per snap by play family and coarse situation, 2016-2023, for each penalty id in data/rules/nfl-2026.json, mapped from pbp `penalty_type`. Accepted and declined fouls both count (the machine decides acceptance).
- The step 3 rule set supports 12 ids. Real fouls outside that list (for example offensive pass interference, illegal contact, face mask, illegal block in the back) are not emitted. The report gives the rate and yards of unsupported fouls, so the gap in step 5's penalty yards is visible. Adding ids is allowed (step 3: a data edit plus a RULES.md row with a primary source) and is open question 5.
- Pairing (designed, in config.json): each penalty says what physical play goes with it. Pre-snap fouls produce `noPlay`. Defensive pass interference pairs with an incompletion on a pass leaf, with its spot from the fitted DPI spot distribution. Intentional grounding pairs with an incompletion at the passer's spot. Holding, roughing and the others pair with a play sampled normally. Fouls on plays with a change of possession, and fouls on kicks, are emitted by one team only; fouls by both teams are emitted only on scrimmage plays without a change of possession, at their fitted joint rate.
- Penalty pools: plays nullified by a foul (`no_play` rows) have no structured physical result, so the outcome pools are built from plays without accepted fouls, and fouls are drawn separately. The resulting bias (for example holding is called more on long runs) is noted in MODEL.md.
- Rating effect: Awareness scales the offending side's penalty rate through a centered effect.

### Fluke flag and the "why" sentence (designed)

- The trace is a structured list recorded during resolution: the cell and backoff level used, the class drawn, the matchup multiplier on that class, each rating edge and its effect on that class, the penalty drawn, the special-teams event, and `fluke: true` when the drawn class had baseline probability below a threshold in config.json or the play's yards sit beyond a tail percentile of its cell (proposed: class probability under 5%, or yards above the cell's 97.5th percentile).
- The dominant factor is the trace entry with the largest absolute log multiplier on the class that happened; ties go by a fixed order in why.json.
- Templates in why.json have slots that bind only to trace fields. Rendering fails, rather than falling back to free text, if a slot has no value.

### Validation (component checks, no full game)

Run by one pipeline command (Python sim of the same logic is not required: the report may drive the TypeScript engine through a small Node script, engineer's call). For every real 2024-2025 regular-season play in scope: take the real situation and the real offense leaf (step 2 mapping), the defense preset from the step 2 defense caller's shares, and generated league-average teams, and resolve it K times (proposed K = 4) with a fixed seed. Compare to what happened.

Metrics and proposed tolerances (absolute; Joseph confirms before the first run):

| Metric | Scope | Tolerance | Min n |
| --- | --- | --- | --- |
| Mean yards per play | each scrimmage leaf | 0.4 yd | 1,000 |
| Yards class shares | each scrimmage leaf, each class | 2.0 pp | 1,000 |
| 20+ yard play rate | run, pass | 0.75 pp | |
| Completion rate | pass attempts, overall and per pass leaf | 2.0 pp | 1,000 |
| Sack rate | dropbacks | 0.75 pp | |
| Interception rate | attempts | 0.5 pp | |
| Fumble rate, fumble lost rate | runs, completions | 0.4 pp each | |
| Field goal make rate | bands under 30, 30-39, 40-49, 50+ | 3, 3, 4, 6 pp | 100 |
| Extra point rate | tries | 1.5 pp | |
| Two-point success | tries | 8 pp | |
| Punt gross and net | punts | 1.5 yd each | |
| Punt touchback, fair catch, return rate | punts | 3 pp each | |
| Penalty rate per snap | each supported id | 0.3 pp | |
| Kickoff tuning check (not a prediction) | 2025 kickoffs | 3 pp rates, 1.5 yd mean start | |

The report also shows each actual rate's 95% interval, an in-sample run on 2016-2023 first (which should match by construction and so tests the machinery), and the unsupported-penalty gap. Pre-registration, hashes, the CI summary test and `known_deviations` work exactly as in step 2: tolerances.json is committed before the first run and never changed after; only Joseph-approved entries mark a failure accepted; the engineer never adds one.

## Milestones

Each ships on its own and goes through code-reviewer and test-writer. A and B can run in parallel; C needs B; D needs A and C; E needs D; F needs all.

### A: players, ratings, generator

| # | Criterion | How it fails |
| --- | --- | --- |
| A1 | DATA.md surveys `load_combine` like the other tables (rows per season, columns, null rates per drill and position) and records its license from a primary source. Nothing derived from it is committed until the license is recorded. | Missing survey or license, or a derived file committed first. |
| A2 | The player schema parses with zod; bad fixtures are rejected: a rating of 100 or -1, a non-integer, a missing base rating, a skill not listed for the position, an unknown `schemaVersion`. | A bad fixture passes. |
| A3 | distributions.json is rebuilt by one command, byte-identical on a second run, holds only per-position percentile tables (pytest scans it for names and ids), and records which ratings are measured and which designed. | Diff on rerun, a name or id present, or an unlabeled rating. |
| A4 | Speed and Strength percentiles follow the measurements: within each position, a faster 40 never gives lower Speed, more bench reps never gives lower Strength (test on the mapping). | Inverted mapping. |
| A5 | `generateTeam`: same seed gives deep-equal teams; different seeds differ; the pool fills every slot in personnel.json for every formation and preset; every rating is an integer 0-99. | Any failure. |
| A6 | Over 10,000 generated teams, each rating's per-position mean and 10th/50th/90th percentiles match distributions.json within 1 point. | Outside. |
| A7 | The name check runs in the pipeline against nflverse rosters and reports zero collisions; a pytest with a fixture roster shows a collision fails the build. No real name is written anywhere. | A collision passes, or a real name in the repo. |
| A8 | DECISIONS.md and MODEL.md record the rating list, the percentile curve, the unit weights and which parts are measured, designed or mixed. | Missing or mislabeled. |

### B: baseline tables (pipeline)

| # | Criterion | How it fails |
| --- | --- | --- |
| B1 | One command rebuilds every baseline file and the report from the cache, byte-identical on rerun. | Any diff. |
| B2 | No 2024, 2025 or 2026 row reaches any pool, rate or curve: table metadata lists seasons, and a pytest feeds those seasons in a fixture and shows they never land. | A holdout row used. |
| B3 | pytest on hand-made frames: each family and class mapping; every pooled play lands in exactly one class; unknown-depth dropbacks follow the documented rule. | Wrong or double class. |
| B4 | Backoff: a cell under N is absent and lookup lands on its parent; a cell at exactly N is stored (pytest and a TypeScript test on fixture tables). | Off by one. |
| B5 | Season weights match hand-computed values for both half-lives (general and field goal). | Wrong weight. |
| B6 | The play-duration fit uses only the documented clean subsample; the report shows its size per family and how its yards mix differs from all plays. | Unclean plays used, or the bias not shown. |
| B7 | The report shows the field goal curve against each training season's make rate by band, and FG make rate by season 2016-2023 (the drift). | Missing. |
| B8 | Penalty rates exist for every supported id; every real `penalty_type` value in 2016-2025 is in a mapping table (to an id or to "unsupported"); an unmapped value fails the build with its name and count. | Silent drop. |
| B9 | No player names or ids in any generated file. | Present. |
| B10 | Generated engine and player tables total at most the budget (proposed 2 MB) as written; a test measures it. | Over. |

### C: engine core at neutral settings

Matchup multipliers and rating edges forced to 1 and 0. Kickoffs from kickoff.json.

| # | Criterion | How it fails |
| --- | --- | --- |
| C1 | Contract: on 100,000 states from step 3's random-game generator (all downs, tries, kickoffs, safety kicks, both halves' final 2:00, overtime), with calls from the step 2 callers and random legal calls, every PlayResult is accepted by `applyPlay` with no error. | Any `GameRuleError`. |
| C2 | Every PlayResult kind and every kickoff and punt end state is produced at least once in C1, and no foul combination step 3 forbids is ever produced (a counting test). | A kind never reached, or a forbidden combination. |
| C3 | Determinism: same state, calls, players, data and seed give deep-equal results over 10,000 plays; a different seed changes at least one. | Any difference. |
| C4 | Phase errors: a call that does not fit the phase (punt on a try, kickoff call in scrimmage, missing defense call on a run) throws a typed error; inputs are never mutated. | Accepted or mutated. |
| C5 | Bootstrap fidelity: from a fixed cell, 100,000 draws give class shares within 0.3 pp of the cell's stored shares and within-class yards matching the stored pool (two-sample check at a pre-set threshold). | Outside. |
| C6 | No flattening: in the same draws, the share of 20+ and 40+ yard plays and of turnovers equals the stored pool's within sampling error; the maximum draw is a real pool value. | Tail shrunk. |
| C7 | Field position: a sampled gain past the goal line is a touchdown at the right spot; a loss into the own end zone with offense impetus is a safety (both through `applyPlay`). | Wrong result. |
| C8 | Purity: the existing purity and import tests cover the engine; the engine imports no zod; no caller module imports the engine; `resolvePlay` is the only exported function that takes both calls (type-level test). | A violation passes. |
| C9 | Speed: mean `resolvePlay` time over 160,000 plays from C1 is recorded in PERF.md with machine and command. Gate: at most 100 microseconds per play mean on Joseph's machine (25 ms per game at about 160 plays, leaving room for the callers and the machine at about 1 ms per game). CI runs the same check with a 3x allowance. | Over budget. |

### D: matchup table and rating effects

| # | Criterion | How it fails |
| --- | --- | --- |
| D1 | matchup.json parses; it has a value for every leaf x preset x class or a documented default of 1; every multiplier is within bounds; every notable cell has a label and a reason. | Missing reason or label, or out of bounds. |
| D2 | The normalization is the only writer of matchup.centered.json, is deterministic, and leaves matchup.json byte-identical. | Raw file changed, or a diff on rerun. |
| D3 | Centering test: over the training situations, with the step 2 defense caller's shares, each leaf's class probabilities after centered multipliers equal the baseline's within 0.1 pp; with the raw table the test detects the shift (a fixture raw table with a large tilt fails the check before normalization). | Off by more, or the check cannot fail. |
| D4 | A matchup has a visible effect: for at least one documented cell per leaf, the class it names moves in the documented direction by at least the documented amount against the leaf's average (simulated, fixed seed). | No effect or wrong direction. |
| D5 | Rating centering: at edge 0 every effect is exactly 1 (unit test); across 1,000 pairs of generated league-average teams, league class rates match the baseline within 0.2 pp. | Off. |
| D6 | Fun rule: for every rating listed for every position, raising that player from the 10th to the 90th position percentile, all else equal, changes at least one named class or penalty rate by at least a minimum effect in ratings.json (simulated, fixed seed). A rating that fails is cut from the schema, not left in. | A rating with no visible effect. |
| D7 | No double counting: swapping Base for Dime personnel with league-average players gives zero rating edge; the run-defense difference comes from the matchup table alone. | A nonzero edge. |
| D8 | MODEL.md: matchup table section marked designed, every mixed cell marked mixed with its data source and training seasons, a reason per notable cell, and the centering method; never called fitted or data-derived. | Mislabeled. |

### E: why sentence

| # | Criterion | How it fails |
| --- | --- | --- |
| E1 | Every resolved play has `detail.trace` and a one-line `detail.why`. | Missing. |
| E2 | Over 10,000 C1 plays, every factor a sentence mentions (each slot and each fixed factor phrase, tagged in why.json) is present in that play's trace with the value shown. | A sentence naming an absent factor. |
| E3 | A template with an unbound slot fails to render with a typed error, never a fallback; why.json slots reference only known trace fields (schema test). | Fallback text, or an unknown field accepted. |
| E4 | The fluke flag is set exactly when the documented threshold is met (unit tests on both sides of each threshold), and a fluke sentence says so. | Wrong flag. |
| E5 | The dominant factor rule picks the largest absolute log multiplier on the drawn class, ties by the fixed order (unit tests). | Wrong pick. |

### F: validation, report, docs

| # | Criterion | How it fails |
| --- | --- | --- |
| F1 | tolerances.json is committed before the first 2024-2025 run; its hash is in the report and in validation.json, and DECISIONS.md records the commit before the run. | Edited after a result. |
| F2 | The report has every metric above with predicted, actual, n, 95% interval of actual, tolerance and pass, fail, accepted or not gated, plus the in-sample run and the unsupported-penalty gap. | Missing. |
| F3 | The command exits non-zero on any gated failure after writing the report; a CI test recomputes every status from validation.json and the committed hashes of tables, config and code, as step 2. | CI green with a failure, or stale tables passing. |
| F4 | Any failure goes to Joseph with numbers before the step is called done; tolerances unchanged in the diff. | Tolerances edited with a failing result. |
| F5 | MODEL.md sections Play outcome models (fitted), Special teams (fitted, kickoffs designed, the 2026 note), Penalties (fitted rates, designed pairing), Ratings (mixed), Matchup table (designed, mixed cells) are filled; DECISIONS.md has an entry per designed choice in this spec; PERF.md has C9. | Missing or mislabeled. |
| F6 | CLAUDE.md's `resolvePlay` line matches the shipped signature (after open question 1). | Drift. |

## Edge cases that are reachable

- A 60-yard sampled gain from the opponent's 30: touchdown, 30 yards credited.
- A sack or a loss from the own 1: safety. A fumble recovered by the defense in the offense's end zone: defensive touchdown.
- An interception returned for a touchdown, and an interception fumbled back to the offense (`defensePossessedDuringPlay`).
- A field goal attempt from beyond any training attempt (the caller can kick from own territory late): the curve's extrapolation rule in config.json decides; never NaN, never above the longest training band's rate (open question 6).
- A blocked field goal returned for a touchdown; a blocked punt behind the line recovered by the kicking team short of the line to gain.
- A two-point try with a cell under N: backs off to scrimmage plays at the 2.
- A defensive foul on the last play of a half (untimed down) and on a try.
- A kickoff after a safety (from the 20), and an onside kick when trailing and when leading (legal in 2026).
- A defense call of Goal Line against a deep pass at midfield, and Prevent on 1st and 10: the matchup table covers every pair, no missing cell.
- Kneel and spike: no defense call used, no matchup, no penalty other than pre-snap.
- A play in overtime: binned as the second half, as step 2.
- A personnel grouping (Heavy, Empty, Goal Line, Dime) whose slots must all be filled from the generated pool.

## Dependencies and sequencing

- A and B first, in parallel. B's real build runs on Joseph's machine with the warm cache; CI runs fixture tests and the committed-summary check.
- C needs B's table format (can start on fixture tables). D needs A and C. E needs D's trace. F needs all.
- After F, playtester runs a headless check of matchups and ratings (CLAUDE.md: playtester after any sim or balance change). Step 5 then runs full games.
- Joseph confirms N, half-lives, classes, tolerances, the rating list and the penalty list before F's first run.

## Locked vs likely to change

Locked: the decisions at the top; multipliers act on class probabilities and never on the real play within a class; edges are relative to same-slot league average; designed files never written by the pipeline; no holdout season in any fitted table; the why sentence only from the trace.

Likely to change: classes and bins after the first report; N and half-lives; matchup values after playtests (always re-centered); rating list and effect sizes after D6 and playtests; the penalty list; the play-duration method; kickoff tuning if 2026 completes and differs from 2025.

## Open questions

1. Open: signature. CLAUDE.md says `resolvePlay(state, offenseCall, defenseCall, rng)`; the brief adds `players`; the sim cannot read files, so the tables also have to come in. Proposed: a sixth `data` argument (or a `createEngine(data)` that returns a five-argument `resolvePlay`). Either way CLAUDE.md's line needs updating. Joseph decides.
2. Open: the player schema and personnel table are new schemas (CLAUDE.md: ask first). Approving this spec is that ask, or a separate sign-off?
3. Open: defense call on punts and field goals. Step 2 has no defense caller for kicks, so the engine ignores the defense call there. Fine for M1, or should a preset (for example Goal Line) affect block rates?
4. Open: play duration. pbp seems to have no direct duration, so "sample clock used from the real play" cannot be fully joint. The clean-subsample model above is mixed and biased toward plays that end with the clock stopped. Acceptable, or is there a better source (for example a clock-time field I have not found)? This feeds step 5's plays-per-game calibration directly.
5. Open: penalty coverage. The 12 supported ids leave out common real fouls (offensive pass interference, illegal contact, face mask, illegal block in the back, illegal formation, neutral zone infraction). Without them step 5's penalty yards per game will run low. Add the most common ones now (each a rule set edit plus a cited RULES.md row), or accept the gap for M1?
6. Open: field goals beyond the training range. Proposed: cap make probability at the curve's value at the longest distance with N attempts, falling to 0 at a designed maximum (for example 70 yards). Designed; confirm.
7. Open: size budget. Whole-play pools are much larger than caller tables (step 2: 300 KB). Proposed 2 MB for all generated engine and player tables, with pools stored as deduplicated outcome tuples with integer weights. Joseph confirms, or names a different budget for the browser build.
8. Open: combine license. nflverse's combine data comes from Pro Football Reference; its terms are not yet checked. If they forbid redistributing derived percentiles, Speed and Strength need another grounding (or become designed). Blocks milestone A's committed outputs, not the rest.
9. Open: K and P base ratings. The brief says every player has Speed, Strength, Agility and Awareness, but none of them has an engine effect for a kicker or punter, so the fun rule would cut them. Proposed: K and P carry only Kick Power and Kick Accuracy in M1, and the schema allows base ratings to be absent by position. Or keep them with no effect until M5 (fake play speed, tackling on returns)?
10. Open: Strength from bench press alone is weak (many skill players skip it, and it ignores body mass). Proposed: bench reps percentile with weight as a secondary input, both within position. Designed either way.
11. Open: combine population. Weight combine rows by 2016-2023 snaps (needs a roster join, local only), or use all combine participants? Snap weighting makes "league average" mean the players who actually play. Also: combine classes after 2023 are not outcome data, but excluding them keeps the holdout rule simple. Proposed: draft classes through 2023.
12. Open: formation. If the fitted conditioning shows little effect, formation is a cut candidate under step 2's rule. Alternatively a small designed formation x package layer in the matchup table (centered the same way). Decide after B's report.
13. Open: unknown-depth dropbacks (sacks, scrambles) and pass leaf. Proposed: split them across pass leaves by the cell's depth mix, which gives every pass leaf the same sack rate before matchups. Real deep shots likely take more sacks. Accept, or let the matchup and rating layers carry that difference (designed)?
14. Open: N = 300, half-lives (2 seasons general, 1 for field goals), K = 4 simulations per validation play and the tolerances above are proposals. Joseph confirms before the first run.

## Resolved open questions (lead, 2026-11-11)

These override anything above that conflicts. Record each one in docs/DECISIONS.md.

1. **Signature.** Use a factory: `createEngine(data)` returns `resolvePlay(state, offenseCall, defenseCall, players, rng)`, keeping the brief's shape. Update the resolvePlay line in CLAUDE.md "Conventions" to match.
2. **New schemas.** Joseph delegated technical calls, so approving this spec counts as "ask first" for the new player, rating and personnel schemas. Version them (schemaVersion field) so M5 and saves can migrate.
3. **Kicks vs defense call.** The defense call does not affect punts or field goals in M1. Block rates are the fitted baseline only.
4. **Play duration.**
   - First check the nflverse pbp data dictionary and columns for any play-duration or clock field. Use it if one exists.
   - Otherwise use the clean-subsample model and record its bias in MODEL.md.
   - Step 5's plays-per-game and time-of-possession checks will show whether it holds.
5. **Penalties.**
   - Add defensive pass interference (spot foul), offensive pass interference, illegal contact, roughing the passer and unnecessary roughness (live ball) now.
   - Extend the step 3 rule set and enforcement for them, with citations from the 2026 rulebook in RULES.md, plus tests.
   - Penalty yards matter for calibration. Report the remaining gap.
6. **Long field goals.** Accept the proposed cap, falling to 0 at about 70 yards.
7. **Size budget.** Accept 2 MB for generated tables.
8. **Combine license.**
   - Check the license from nflverse's own repo or docs (primary source).
   - Whatever it says, ship only per-position summary parameters (percentile cut points per drill), never player rows.
   - If the terms forbid even that, stop and report before committing.
   - Record the finding in DATA.md.
9. **K and P.** Keep Speed, Strength, Agility and Awareness for kickers and punters too. Joseph asked for speed and strength bars on every player. Give them a small designed effect so the fun rule holds: the kicker's or punter's tackling on returns, which slightly lowers return touchdown chance. Kick Power and Kick Accuracy drive the kicks.
10. **Strength.** Accept bench press plus weight.
11. **Combine population.** No snap weighting. Use drafted players' combine results, draft classes 2010-2023.
12. **Formation.**
    - Keep formation with a small designed formation-by-package layer:
      - Heavy helps short-yardage runs.
      - Shotgun and Empty help quick passes and cost run efficiency.
      - Empty raises sack and blitz exposure.
    - The layer is centered like the matchup table and labeled designed.
    - If D6 shows no visible effect, report it and Joseph decides whether to cut it.
13. **Sacks and scrambles.** Assign dropbacks with unknown depth to pass leaves by the situation's depth distribution, as in step 2.
14. **Validation settings.** Accept N = 300, the proposed half-lives, K = 4 sims per validation play, and the proposed tolerances. Commit them before the first validation run and never change them after.
