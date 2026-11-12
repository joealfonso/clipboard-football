# M1 step 5: full game and calibration

Status: draft, 2026-11-11. Owner: Joseph.

## Goal

Tie the step 2 callers, the step 3 state machine and the step 4 play engine into a seeded full-game loop with the missing coach decisions, print one game as text, and pass a pre-registered 10,000-game calibration test against 2024-2025.

For: Joseph, who will run the CLI to watch a game and judge whether it feels like football, and the agents closing M1. This is the M1 gate (CLAUDE.md): "10,000 games pass the calibration test."

In plain words: two computer coaches play a whole game. Each snap they decide whether to call a timeout and how long to let the clock run, then call plays from the same odds as real NFL coaches; the engine says what happened, the rules machine keeps score. Run that 10,000 times and the games should look like 2024 and 2025 NFL games: same points, same margins, same number of drives and how they end.

## Non-goals (out of scope)

- UI, animation, menus on screen (M2). The CLI is a test tool, not the game.
- Seasons, schedules, standings (M4). The calibration uses generated pairings only.
- AI personalities and tilted shares (M3). Every decision here is the average coach.
- Injuries, fatigue, depth charts, player growth (M5). Per-player box score lines (open question 12).
- Challenges and replay review, beyond the decision below (open issue 3).
- Any change to step 2 shares, step 4 tables, the matchup table or the step 3 rules, except where an open question below is resolved that way. A calibration miss is reported, not patched in the component.
- Weather, surface, neutral-site games in the sim.

## Dependencies allowed

Nothing new. The CLI and the calibration driver run on Node with the existing type-stripping hook (scripts/engine/register.mjs). Pipeline: polars and nflreadpy as before. If a team-name check needs nflverse `load_teams`, it is surveyed in DATA.md and its license recorded first, as combine was.

## Locked (from the brief, CLAUDE.md and earlier steps)

1. The loop is pure and lives in packages/sim: no DOM, no Node APIs, no `Math.random`, one seeded Rng passed in. Same seed and inputs give the same game. The seed is logged with every game.
2. `resolvePlay` decides every outcome. The loop and the decision policies decide only coach choices; they never draw an outcome.
3. Decision policies see only what both sidelines see (scoreboard, clock, timeouts, down and distance, spot). They never see the other side's call, and the defense never sees the offense's formation.
4. Balance lives in data files. Every new number (bins, run-off tables, timeout rates, onside rates, home-field size) is in a data file, marked fitted, designed or mixed in MODEL.md.
5. Fitted means 2016-2023 regular season, never 2024, 2025 or 2026. Kickoffs stay the one exception (tuned to 2025).
6. Variance is not flattened. No decision or parameter is tuned to narrow margins or points.
7. The "why" line for each play comes only from the engine's trace. Lines for loop events (timeouts, run-off, two-minute warning, end of quarter) state the event and nothing invented.
8. Tolerances are committed before the first 2024-2025 run and never changed after. `known_deviations` entries are Joseph's only.

## Design

### The loop

`playGame(setup, data, rng)` (name is the engineer's call) returns a game record: the final GameState, an ordered event log, the seed, rule set id and hash, data hashes and team names. Order of inputs per dead ball, designed and recorded in DECISIONS.md:

1. Phase `overtimeToss`: `startOvertime` with the designed toss default.
2. Phase `kickoff`: kicking team's kickoff policy picks `kickoff` or `onsideKick`; `resolvePlay`; penalty choice; `applyPlay`.
3. Phase `try`: offense caller picks extra point or two (step 2 O-try, as is); defense caller on a two-point try; `resolvePlay`; `applyPlay`.
4. Phase `scrimmage`: timeout policy, offense then defense (at most one each per dead ball, per the rule set); tempo policy gives pre-snap run-off when the clock is running (`runPreSnap`); if the period ended, loop. Then offense and defense calls (step 2, as is, including 4th-down go, punt or field goal, spike and kneel), `resolvePlay`, penalty choice, `applyPlay`.
5. Stop at `final`. A hard cap on inputs per game (in config) throws a typed error if reached; it must never be reached.

### Coach decisions

| Decision | Source | Label |
| --- | --- | --- |
| Run, pass, punt, field goal, spike, kneel; 4th-down go or kick | step 2 caller (o4Top, o4Kick, oTop), unchanged | fitted (mixed per MODEL.md) |
| Extra point or two-point; the two-point play | step 2 O-try, O-twopoint, unchanged | fitted |
| Defense preset | step 2 defense caller, unchanged | mixed |
| Pre-snap run-off (tempo: hurry-up, normal, run the clock, kneel run-off) | new, fitted (below) | mixed |
| Timeouts, both teams | new, fitted (below) | mixed |
| Onside or regular kickoff | new, fitted (below) | mixed |
| Penalty accept or decline | step 3 designed default, unchanged | designed |
| Timeout instead of a ten-second run-off | new designed rule: take it when trailing or tied in the final 2:00 of a half with a timeout left, else the step 3 default | designed |
| Toss, receive or defer, overtime choice, untimed down, clock on snap | step 3 designed defaults | designed |

The decision policies need clock state the step 2 Situation does not carry (clock running, play clock). Proposed: a new type-only `CoachView` in packages/shared that is Situation plus those fields, built by the machine like `toSituation`. Situation itself is not changed.

**Tempo (mixed).** pbp has `play_clock` (null only in 1999-2000 per DATA.md). Verify against the nflverse data dictionary what it holds (play clock at the snap is expected). If it is the snap reading, run-off = the play clock that applied minus `play_clock`, fitted 2016-2023 on snaps where the game clock was running. If not, use the step 4 duration field (`end_clock_time` minus `time_of_day`, 2022-2023) and the game clock change, with the measurement error reported. Stored as an empirical distribution of whole seconds per cell. Designed bins: score3, time5 with the final-2:00 clock and timeouts detail, offense timeouts, and whether the previous snap was a kneel. Draws above the current play clock are clipped to it and the clip rate is reported. Backoff as in step 2, N in config.

**Timeouts (mixed).** Fitted from pbp `timeout` and `timeout_team`, 2016-2023: probability that a team calls a timeout in a dead ball, from its own side (offense or defense), by designed bins: half, time5 with final-2:00 detail, score3 from that team's view, clock running or stopped, its timeouts left, down 4 or not. Masked to zero when the team has none or the rules forbid one. Timeouts before a two-point try, after a two-minute warning, and around challenges are counted in the report; challenge-related timeouts are excluded from the fit.

**Onside (mixed).** Fitted attempt rate per kickoff by designed bins (score diff from the kicker's view, quarter, seconds left), 2016-2023. The data has no onside flag that DATA.md lists; the engineer finds how nflverse marks onside attempts (kick type in `desc`, kick distance, or a column), documents the rule and its agreement on a hand-checked sample. Under 2026 rules an onside kick may be declared at any time; the fit reflects the older eras, where it was a trailing-late play. Recovery rates stay the step 4 designed values.

### Teams and league

- `generateLeague(rng, data, n)` returns n step 4 team pools from the step 4 generator with designed fictional team names (data/teams/names.json: place plus nickname). No real NFL team nickname, current or historical, and no real player name (the step 4 check). The name check source is open question 9.
- Calibration uses several league seeds, so the team-draw noise step 4 found (up to about 2 pp on some class shares) averages out and its size is reported (proposed: 10 leagues of 32 teams, 1,000 games each, pairings drawn by seed).
- Each game's seed comes from the run seed through `Rng.fork`, logged per game.

### Home field (designed, tuned on training seasons only)

Step 4 has no home field. Proposal in open issue 2 below.

### Drives and box score (designed definitions)

A drive starts when a team gains possession by kickoff, punt, turnover, or the start of a period that begins a half, and ends with a score, a turnover, a punt, downs, or the end of a half or game. Outcomes map to nflverse `fixed_drive_result` (Touchdown, Field goal, Missed field goal, Punt, Turnover, Turnover on downs, End of half, Safety, Opp touchdown); the engineer verifies those values against the data and the mapping table goes in config. The box score is computed from the event log only and decides nothing.

### CLI

`pnpm sim:game -- --seed <n> [--league-seed <n>] [--format text|json]` (exact flags are the engineer's call). Text output:

- Header: seed, league seed, rule set id and hash, data hashes, both team names, home and away.
- One line per event: quarter and clock, down and distance, ball on ("own 25", "opp 40"), offense call and formation, defense preset, result in plain words, score, and the engine's `detail.why`. Separate lines for timeouts (team, timeouts left), run-off seconds, two-minute warning, penalties with accept or decline, end of quarter, overtime toss.
- Box score: score by quarter, first downs, total, rushing and passing yards, completions and attempts, sacks, turnovers, penalties and yards, 3rd and 4th down conversions, time of possession, punts, field goals made and attempted, drive summary.

The command is added to CLAUDE.md "Run" by the engineer.

### Calibration (game level)

Comparison data: 2024-2025 regular-season games from schedules and pbp, computed by the pipeline. Home-field metrics exclude neutral-site games (`location`). The sim: 10,000 regular-season games under the 2026 rule set. Before the holdout run, an in-sample run against 2016-2023 game aggregates is reported (2020 flagged for home field), as in steps 2 and 4. Every metric shows predicted, actual, n, the actual's 95% interval, tolerance and status.

Proposed tolerances (absolute; n is about 544 games, 1,088 team-games):

| Metric | Tolerance | Note |
| --- | --- | --- |
| Points per team-game, mean | 1.0 pt | |
| Points per team-game, SD | 1.0 pt | variance check |
| Points per team-game, share in 0-9, 10-16, 17-23, 24-30, 31-37, 38+ | 3 pp each | tails |
| Total points per game, mean and SD | 1.5 pt each | |
| Home margin, mean | 1.5 pt | home field gate |
| Margin SD; share of games by absolute margin 0, 1-3, 4-7, 8-14, 15-21, 22+ | 1.5 pt; 3 pp each | variance check |
| Home win rate, ties as half | 4 pp | home field gate |
| Drives per team-game | 0.4 | |
| Mean drive start, yards from own goal | 1.5 yd | kickoff part confirms 2025 tuning |
| Drive outcome shares: TD, FG, missed FG, punt, turnover, downs, end of half, safety | 2 pp each | |
| Scrimmage plays per game (run, pass, sack, scramble, kneel, spike; no `noPlay`) | 3.0 | |
| Accepted penalties per game, supported ids | 0.8 | expected low, see below |
| Enforced penalty yards per game, supported ids | 7 yd | |
| Accepted penalties and yards, all fouls | not gated | known gap, about 18.7 yd/game unsupported |
| Turnovers per team-game; interceptions; fumbles lost | 0.15; 0.10; 0.10 | |
| Sacks per team-game | 0.25 | |
| Time of possession: SD of team TOP; winning team's mean TOP | 45 s each | |
| Mean drive duration | 10 s | |
| Overtime rate | 2 pp | |
| Tie rate | 0.75 pp | |
| Timeouts used per team-game | 0.3 | |
| 4th-down go attempts per game; punts per game; FG attempts per game | 0.4; 0.4; 0.3 | |
| Two-point tries per game | 0.1 | |
| Onside attempts per game | 0.05, min n 30 attempts | |

Expected misses stated before the run, not fixed after it:

- Supported flags per snap: the engine gives 6.70% against 7.32% actual in 2024-2025 (ENGINE_REPORT.md, not gated in step 4). At about 150 snaps per game that is roughly one flag per game low, so the supported-penalties-per-game metric may fail.
- Step 4's 4 holdout misses (inside-run 1-3 share, play-action scrambles, short completion rate, extra point rate) and step 2's 5 approved deviations (midfield 4th downs, coverage shares) flow into game totals. Extra points and completions both run low, so points may run slightly low.
- Team quality spread: generated teams are league-average with only per-player sampling spread. Real margins include real differences between teams, so margin SD may run low (open question 6).

## Milestones

Each ships on its own and goes through code-reviewer and test-writer. A and B in parallel; C needs A; D needs A and B; E needs A and B; F needs A to D; G needs all.

### A: game loop with designed placeholder decisions

Placeholders until C: no timeouts, zero run-off, never onside. Labeled placeholder in code and DECISIONS.md, removed in C.

| # | Criterion | How it fails |
| --- | --- | --- |
| A1 | A game from any seed reaches `final` with a result and reason; the record has the seed, rule set id and hash, data hashes and both team names. | A game that does not end, or a missing field. |
| A2 | Every input goes through the step 3 machine and every play through `resolvePlay`; a test with a spy engine shows the loop never builds a PlayResult itself. | The loop decides an outcome. |
| A3 | The loop follows the designed input order; a test on a scripted state checks each phase (kickoff, try, scrimmage, overtimeToss) calls the right policy and caller. | Wrong order or wrong policy. |
| A4 | Decision policies take only the CoachView (type-level test): no call, formation, ratings or GameState of the other side reachable. | Other side's call reachable. |
| A5 | Purity: the existing purity and import tests cover the loop; it imports no zod and no Node API. | A violation passes. |
| A6 | The input cap throws a typed error on a fixture that cannot end; the real data never hits it in F. | Silent loop or cap hit. |

### B: teams and league

| # | Criterion | How it fails |
| --- | --- | --- |
| B1 | `generateLeague` is deterministic by seed; different seeds differ; every team fills every personnel slot (reuses step 4 A5). | Any failure. |
| B2 | data/teams/names.json parses with a zod schema; names are unique within a league. | Bad fixture passes, duplicate name. |
| B3 | The team-name check runs against its source and reports zero matches with real NFL nicknames; a fixture with a real nickname fails it. No real name written to the repo. | A match passes. |
| B4 | DECISIONS.md and MODEL.md record the league size, pairing rule and that teams are league-average (designed). | Missing. |

### C: fitted coach decisions (pipeline and runtime)

| # | Criterion | How it fails |
| --- | --- | --- |
| C1 | DECISIONS.md records what `play_clock` holds, checked against the nflverse data dictionary and a few hand-checked plays, and which tempo method that led to. | Assumed, not checked. |
| C2 | One command rebuilds the tempo, timeout and onside tables and their report section, byte-identical on rerun. | Any diff. |
| C3 | No 2024, 2025 or 2026 row reaches any table (metadata and a pytest feeding those seasons). | A holdout row used. |
| C4 | pytest on hand-made frames: run-off measurement, timeout attribution to offense or defense, onside detection rule, backoff at N and N-1. | Wrong value or off by one. |
| C5 | Runtime: share or distribution functions take no Rng; sampling uses one draw per decision; same seed same decisions over 10,000 calls; a golden file pins TypeScript to the pipeline for at least 100 views per table. | Mismatch or nondeterminism. |
| C6 | Masking: no timeout is ever returned for a team with none or in a phase the rules forbid; run-off never exceeds the play clock; onside only when the rule set allows it. | An illegal decision reaches the machine. |
| C7 | Component validation against 2024-2025 with tolerances pre-registered in data/game/tolerances.json: mean run-off per time5 bucket with clock running (2.0 s); timeouts per team-game (0.3); timeout rate per dead ball in each final-2:00 bucket by side (2 pp); onside attempt rate per kickoff when trailing in Q4 (5 pp, min n 100). Report as step 4 F2. | Missing metric or tolerance edited after a run. |
| C8 | MODEL.md "Clock and tempo" replaces "not built yet" with the tempo, timeout and onside models, marked mixed, with the designed ten-second run-off rule. | Mislabeled. |

### D: home field

| # | Criterion | How it fails |
| --- | --- | --- |
| D1 | The home-field parameters live in a designed data file; at size 0 the sim's home win rate over 10,000 games is 50% within its sampling error (ties half). | Home edge with the parameter at 0. |
| D2 | Centered: with home field on, league-wide class and penalty rates over home and away together match the size-0 run within 0.2 pp. | League totals shift. |
| D3 | Tuned only on 2016-2023 non-neutral games (2020 handled per the resolution of open issue 2); a test reads the tuning record and fails if a 2024 or 2025 game is in it. | Holdout used to tune. |
| D4 | MODEL.md "Home field" section marked designed, with the tuning target and its seasons. | Missing or called fitted. |

### E: CLI text game

| # | Criterion | How it fails |
| --- | --- | --- |
| E1 | The command prints a full game for a given seed: header, one line per event, box score, as listed above. Snapshot test on a fixed seed. | Missing part. |
| E2 | Same seed twice gives byte-identical output; the seed and league seed are in the first lines. | Diff, or seed missing. |
| E3 | Every play line's why text equals that play's `detail.why`; loop event lines contain no why text. | Why text from anywhere else. |
| E4 | The box score totals match totals recomputed from the event log (score equals final state score; yards, turnovers, penalties sum). | Mismatch. |
| E5 | `--format json` writes the game record; parsing it and re-running the box score gives the same box score. | Diff. |
| E6 | CLAUDE.md "Run" has the command; Joseph can run it from the repo root after `pnpm install`. | Missing or wrong. |

### F: soak, determinism, performance

| # | Criterion | How it fails |
| --- | --- | --- |
| F1 | Over all 10,000 calibration games, the step 3 invariant checker runs after every transition with zero violations, plus loop invariants: every game ends, no input cap hit, no postseason tie in a 1,000-game postseason soak, timeouts never below 0, scrimmage snaps per game under a sanity bound in config. | Any violation. |
| F2 | Determinism: re-running any game from its logged seed gives a deep-equal record; a different seed changes it; a mid-game state plus saved Rng state, serialized to JSON and resumed, ends in the same record. | Any difference. |
| F3 | Each game's record has a digest; the committed calibration summary holds the digests for a fixed slice of games (open issue 1), and CI re-simulates that slice and matches them. | Digest mismatch, or CI passes with stale data. |
| F4 | Speed: mean full-game time (loop, callers, policies, engine, machine) over the 10,000 games at most 25 ms on Joseph's machine (the step 4 budget), recorded in PERF.md with machine and command; CI uses a 3x allowance. Total wall clock for the 10,000-game run recorded. | Over budget. |

### G: calibration, report, docs

| # | Criterion | How it fails |
| --- | --- | --- |
| G1 | data/game/tolerances.json (game-level metrics above) is committed before the first 2024-2025 game-level run; its hash is in DECISIONS.md, the report and data/game/calibration.json. | Edited after a result. |
| G2 | The in-sample run against 2016-2023 is reported first; any designed parameter (home field, team spread if open question 6 allows one) is tuned only there. | Tuned on holdout. |
| G3 | The report (docs/GAME_REPORT.md, generated) has every metric with predicted, actual, n, 95% interval of actual, tolerance and status, plus the spread across league seeds per metric and the expected-miss list above with outcome. | Missing. |
| G4 | The command exits non-zero on any gated failure after writing the report; a CI test recomputes every status from calibration.json and the hashes of tables, config and code (import graph, as step 4 F3). | CI green with a failure or stale summary. |
| G5 | Any failure goes to Joseph with numbers before M1 is called done; tolerances unchanged in the diff; only Joseph adds `known_deviations`. | Tolerances edited with a failing result. |
| G6 | CLAUDE.md: the three open issues marked settled with pointers to DECISIONS.md; M1 status updated; Run and Test lines current. DECISIONS.md has an entry per designed choice here. | Still open, or drift. |
| G7 | playtester runs the M1 playtest gate: the 10,000-game soak plus reading at least 3 CLI games, and reports anything no coach would do. | Not run. |

## Edge cases that are reachable

- A touchdown on the last play of regulation that wins the game: try per the rule set; drive outcome Touchdown.
- Leading late with the opponent out of timeouts: kneel, full run-off, game ends on a kneel. Opponent holding timeouts: defense timeouts between kneels.
- Trailing in the final 2:00 with no timeouts: spike, short run-off; a ten-second run-off that ends the half.
- Two-minute warning reached during run-off.
- 4th down in own territory trailing late: go, from the fitted o4Top.
- Onside kick after a safety (safety kick), and an onside attempt while leading (legal in 2026, rare in the fit).
- Defensive touchdown and safety: drive outcome Turnover or Safety for the offense; the scoring team's next kickoff.
- A drive in progress at halftime or end of regulation: End of half.
- Regular-season overtime: both possessions guaranteed (2026 rule set), sudden death after, tie at 0:00.
- A defensive foul on the final snap of a half: untimed down.
- A timeout request in a dead ball where the team already took one: masked, never sent.

## Dependencies and sequencing

- Step 4 committed and its 4 holdout misses decided by Joseph before G's holdout run (open question 4).
- A and B first, in parallel. C needs A. D needs A and B. E can start after A with placeholder decisions. F needs A to D. G needs all.
- Real fits and the calibration run on Joseph's machine with the warm cache; CI runs fixtures, the slice check and the summary check.
- Joseph confirms tolerances, bins, N, league seeds and the open-issue proposals before C7 and G1.

## Locked vs likely to change

Locked: the loop decides no outcome; policies see only the CoachView; fitted decisions use 2016-2023 only; tolerances fixed once committed; the why line only from the engine.

Likely to change: tempo and timeout bins after the first report; home-field mechanism after D; league size and seeds; the drive outcome mapping once nflverse values are checked; the CLI layout after Joseph reads a few games.

## Proposals for the three open issues (CLAUDE.md)

1. **CI sample size.** The full 10,000 games run locally as one command and write data/game/calibration.json with per-game digests and hashes. CI: (a) recomputes every status from the committed summary and hashes; (b) re-simulates a fixed slice of 1,000 games and requires exact digests, which proves the summary is current and the sim deterministic; (c) runs the invariants and the 3x speed check on that slice. Runtime budget: 10,000 games at most 250 s locally (25 ms each), CI slice at most 60 s. If the measured full run is under 60 s on CI, CI runs all 10,000 instead, and (b) becomes the whole set. Never a smaller sample with loosened tolerances.
2. **Home field.** Designed, symmetric and centered: the home team gets +e on every rating edge and the away team -e, plus a designed multiplier on away pre-snap offensive fouls (crowd noise), so league totals are unchanged (D2). e and the multiplier are tuned on 2016-2023 non-neutral games to the training home margin, season-weighted like the other fits, with 2020 (limited or no crowds) excluded. Gated by home win rate (4 pp) and mean home margin (1.5 pt) against 2024-2025. If home advantage keeps shrinking after 2023, this misses high and the miss is reported.
3. **Challenges.** Defer to M2, when a human coach can throw the flag. In M1 no one challenges. pbp plays are recorded as finally ruled, so overturned calls are already in the fitted outcomes and calibration is not biased by the omission. Minimal design for M2, not built now: a challenge is a dead-ball decision after `applyPlay` and before the next snap; the engine would emit an alternative PlayResult in `detail` when a reviewable call could have gone the other way, and the machine would need one-step undo (state history, kept out of scope in step 3). Rules for challenges and replay are looked up from the 2026 rulebook when built, not written from memory.

## Open questions

1. Open: CI sample size, proposal 1 above. Joseph confirms, or names a CI time limit.
2. Open: home field, proposal 2 above, including excluding 2020 and whether home field also touches special teams.
3. Open: challenges deferred to M2 with the minimal design above. Confirm.
4. Open: step 4's 4 holdout misses are pending. Decide (accept as known deviations or fix) before the step 5 holdout run, since a step 4 fix after it would make the game-level holdout post hoc.
5. Open: flags per snap run low (6.70% vs 7.32%). Fix in step 4 before calibration, or run as is and expect the supported-penalties-per-game metric to fail?
6. Open: team quality spread. If the in-sample run shows margin SD low, is a designed team-strength spread in the generator (tuned on 2016-2023 only) allowed in M1, or is the miss reported and left for M4 or M5?
7. Open: onside fit seasons. 2016-2023 attempts come from older kickoff rules and the 2026 rule allows a declared onside kick at any time. Fit on 2016-2023 and report, or make the policy designed (trailing by more than one score in the final minutes)?
8. Open: tempo source. If `play_clock` is not the snap reading, the fallback uses the duration field, which starts in 2022, so tempo would be fitted on 2022-2023 only. Accept?
9. Open: team-name check. nflverse `load_teams` (needs a DATA.md survey and license), or a designed list of real nicknames kept in the pipeline and never shipped?
10. Open: penalty accept or decline stays the step 3 designed default for both AI teams. Confirm, rather than fitting it.
11. Open: tolerances, league seeds (10 x 1,000 games), N for the new tables and the input cap are proposals. Joseph confirms before C7 and G1.
12. Open: per-player box score lines need the engine to name players on each play, which it does not. Leave the box score team-level for M1?
13. Open: CoachView is a new type-only shared type (Situation plus clock running and play clock). Counts as the ask-first for a schema change, or a separate sign-off?

## Resolved open questions (lead, 2026-11-11)

Joseph delegated technical calls to the lead. Question 4 is his and stays open until he answers.

1. CI sample size: proposal 1 accepted as written.
2. Home field: proposal 2 accepted, 2020 excluded, special teams untouched in M1.
3. Challenges: deferred to M2 with the minimal design above. This settles the CLAUDE.md open issue.
4. Still open, Joseph's call. Since the live-foul draw fix in step 4 (revision 6), 3 gates fail, not 4: insideRun r1_3, playAction scramble, extraPoint. No step 5 holdout run (G) until he decides.
5. Before C7, investigate why in-sample `flags.any` is 6.75% against 6.96% actual on 2016-2023, where it should match by construction. If it is a machinery or fitting bug, fix it in the step 4 code and log it as a post-validation revision. Do not tune penalty rates to the holdout. If no bug is found, run as is and report the expected penalties-per-game miss.
6. Team quality spread: allowed. A designed team-strength spread in the generator, tuned to the 2016-2023 margin SD only, set and committed before the holdout run. Real leagues have strong and weak teams, so this restores variance rather than inventing it.
7. Onside: fit the attempt decision on 2016-2023 where n is at least N, else back off to the designed rule (trailing by more than one score in the final minutes). Outcomes stay the step 4 designed kickoff model.
8. Tempo: check what `play_clock` means against the data dictionary and a sample of plays first. If it is not the snap reading, fit on 2022-2023 only and say so in MODEL.md.
9. Team names: a designed, hand-kept list of real NFL nicknames and cities in the pipeline, used only to reject collisions and never shipped. No new data source.
10. Penalty accept or decline stays the step 3 designed default.
11. Tolerances, 10 leagues x 1,000 games, N and the input cap accepted as proposed. Commit tolerances and record their sha256 in DECISIONS.md before the first holdout run.
12. Box score is team-level for M1. Per-player game stats come later.
13. CoachView is type-only and covered by this spec's approval. Give it a schemaVersion if it is ever serialized.
14. Coaches (Joseph, 2026-11-11: teams will have coaches who change how plays are called, and the player can hire, fire and trade coaches and players). Not built in M1. The only M1 requirement: each team's decision policies are passed in per team (not module globals), so a later coach layer can wrap the average coach with designed, centered tendencies without changing the loop.
