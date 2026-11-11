# DECISIONS.md

One entry per decision: date, decision, why, and what would change it. Newest entries go at the bottom of their section.

## M1 step 1: scaffold and data survey

### RNG algorithm

- Date: 2026-11-11
- Decision: xoshiro128** 1.1 (Blackman and Vigna) in `packages/sim/src/rng.ts`. Floats are `uint32 / 2^32`, so they lie in [0, 1) with 32-bit resolution.
- Why: it needs only 32-bit integer math, which JS does natively with `Math.imul` and bit operators, so no BigInt on the hot path. PCG32 needs 64-bit multiplies, which in JS means BigInt or hand-split 32-bit halves. xoshiro128** also has a published `jump()` for independent streams, and published reference output to test against (rand_xoshiro's vectors from the authors' C code).
- What would change it: a measured need for more than 32 bits of float resolution (switch `nextFloat` to two draws for 53 bits), or profiling that shows RNG cost matters.

### Seeding

- Date: 2026-11-11
- Decision: `Rng.fromSeed(seed)` takes a non-negative safe integer and expands it to the 128-bit state with SplitMix64, as the xoshiro authors recommend. SplitMix64 uses BigInt, once per seed.
- Why: a game seed must be loggable and typed back in exactly, so a plain integer. SplitMix64's output step is a bijection, so two consecutive outputs are never both zero and the state is never all zero.
- What would change it: wanting seeds larger than 2^53 (accept a bigint or string).

### Fork

- Date: 2026-11-11
- Decision: fork exists. `fork()` returns a child that continues the parent's sequence from the current point, then moves the parent 2^64 draws ahead with the reference `jump()`. No reseeding from a draw.
- Why: jump is cheap (128 steps) and gives streams that cannot overlap for 2^64 draws. Jumping the parent rather than the child means successive forks give distinct children. Forking does change the parent's next outputs; drawing from the child never does.
- What would change it: the engine needing a fork that leaves the parent's sequence untouched, which would need a different scheme (for example a long-jump child per fork with a counter).

### RNG state save and restore

- Date: 2026-11-11
- Decision: `getState()` returns four uint32 words; `Rng.fromState()` validates and restores them.
- Why: later save work needs to resume a game mid-sequence; four numbers serialize trivially.
- What would change it: the save format needing a versioned envelope, which belongs in the save code, not the RNG.

### Node version

- Date: 2026-11-11
- Decision (proposed, Joseph to confirm, spec open question 3): Node 24 LTS in `.nvmrc` and CI. `engines.node` is `>=22`.
- Why: 24 is the active LTS line. The local machine runs Node 25 (not LTS), which `>=22` allows. Vitest 5.1.0 supports `^22.12.0 || ^24.0.0 || >=26.0.0`, so 25 is outside its stated range even though the suite passes on it locally.
- What would change it: Node 26 becoming LTS, or a dependency dropping 22.

### Package manager and TypeScript versions

- Date: 2026-11-11
- Decision: pnpm 10.34.9 via the `packageManager` field (latest 10.x; pnpm 12 is current but 10.x was the requested line). TypeScript 6.0.3, ESLint 10.14.0, typescript-eslint 8.72.2, Vitest 5.1.0, @types/node 24.x. Exact versions, lockfile committed.
- Why: TypeScript 7.0.2 is the latest release, but typescript-eslint 8.72.2 declares support only for `>=4.8.4 <6.1.0`, so 6.0.3 is the newest pairing that is supported. @types/node follows the Node 24 LTS line. pnpm is not installed globally here; `npx -y pnpm@10.34.9` runs it.
- What would change it: typescript-eslint supporting TypeScript 7, or a move to pnpm 11 or 12.

### Typecheck layout

- Date: 2026-11-11
- Decision: `pnpm typecheck` runs `tsc -p` once per tsconfig (shared, sim, sim tests, tooling) with `noEmit`, not project references.
- Why: nothing is built or published yet, so no declaration output is needed, and separate configs let the sim keep `lib: ["ES2022"]` and `types: []` while its tests get Node types.
- What would change it: a package that other packages import as built output.

### nflreadpy version

- Date: 2026-11-11
- Decision: nflreadpy 0.1.5, pinned exactly, with polars 2.1.0. pytest 9.2.0 as a dev group.
- Why: latest releases. nflreadpy 0.1.5 has loaders for 10 of the 11 tables. It has no loader for draft pick values, and the nflverse-data releases have no draft values file either. The nflverse/nfldata GitHub repo has `data/draft_values.csv`, which is a candidate source outside nflreadpy (spec open question 1, Joseph decides).
- What would change it: a newer nflreadpy that adds tables or fixes data issues.

### 404 detection uses requests directly

- Date: 2026-11-11
- Decision: `pipeline/sources.py` imports `requests` to tell an HTTP 404 (season not published) from other download failures. It is a dependency of nflreadpy, not a direct one in pyproject.
- Why: nflreadpy wraps the requests error; the cause is the only place the status code lives. Adding requests as a direct dependency would need approval.
- What would change it: nflreadpy changing its exception wrapping, or Joseph approving requests as a direct dependency.

### Cache location

- Date: 2026-11-11
- Decision: raw downloads cache in `~/.cache/clipboard-football`, overridable with `CLIPBOARD_FOOTBALL_CACHE`. nflreadpy's own filesystem cache is pointed at `<cache>/nflreadpy` with its expiry set to never.
  - Completed seasons are never refetched.
  - Volatile files are the in-progress season, each table's latest season, and the whole-table files (schedules, draft picks, contracts), which hold current-season rows. When the cached copy is more than 24 hours old, the pipeline hides it from nflreadpy so it downloads again. If that download fails for any reason, the untouched old copy is loaded instead and the fallback is logged to stderr.
  - Cache writes go through a temp file and an atomic rename, so a crash cannot truncate a good copy.
  - Only network failures fall back to the cached copy: no connection, timeouts and HTTP 5xx. A download that fails to parse, or another 4xx, is reported as a failure. A failed cache write (full disk) is logged and the load still succeeds, as in nflreadpy.
  - An HTTP 404 writes a marker in `<cache>/unavailable`. One written for a completed season is permanent. One written while the season was volatile records that, and is rechecked once older than 24 hours even after the season completes: a new 404 refreshes it, a successful download removes it, a network failure keeps reporting the 404, and any other error is reported as a failure.
- Why: nflreadpy 0.1.5 deletes a cached file the moment it is older than its expiry, before trying the network, so using its expiry for volatile files would destroy good data on any offline run or network drop. With this scheme an offline rerun against a cache of any age produces the same DATA.md as the last successful online run (C2, C3). Fetched-vs-cached per load is kept out of DATA.md because it depends on timing.
- Implementation note: the age check wraps the `get` and `set` methods of nflreadpy's cache manager for the length of one load and uses its private `_get_cache_key` and `_get_file_path`. That is safe only because nflreadpy is pinned exactly; recheck on any upgrade.
- Remaining difference between online and offline: none for a warm cache. A volatile season that was never fetched (cold cache) still fails offline.
- What would change it: wanting a different refresh window.

### Season range

- Date: 2026-11-11
- Decision: each per-season table is requested from its loader's documented first season to the last season nflreadpy allows on the run date (`get_current_season`, or the roster year for rosters and depth charts, or roster year minus one for participation, matching nflreadpy's own caps).
- Why: asking for seasons nflreadpy rejects only produces errors. The range depends on the date, so DATA.md is reproducible for a given cache and season calendar, not across a season boundary.
- What would change it: pinning an explicit last season in the pipeline.

### pbp survey strategy

- Date: 2026-11-11
- Decision: play-by-play, participation and FTN are loaded one season at a time. Each season is reduced to row count, per-column dtype and null count, kickoff aggregates, and (2016 on) the set of `(game_id, play_id)` keys, then the frame is dropped.
- Why: so live data is one pbp season instead of all 28.
- Peak memory observed: see the next entry. The full cold run took under two minutes, so every season of every table is surveyed; no subset was skipped.
- What would change it: needing per-play joins across seasons in the survey.

### Peak memory of the full inventory run

- Date: 2026-11-11
- Decision: record only.
- Result: peak resident set size 1,479 MB on a cold-cache run (108 s wall clock, downloads included; `/usr/bin/time -l` reported 1,551,106,048 bytes max RSS) and 1,848 MB on a warm-cache rerun, Apple Silicon Mac, Python 3.12.12, polars 2.1.0. Loading pbp seasons one at a time on their own, the high-water mark was 318 MB after 2021 and 682 MB after 2025, so it climbs as seasons are loaded even though each frame is dropped. Not verified whether that climb is allocator retention or live memory.
- What would change it: rerun after any change to what is loaded per season.

### Dependabot ecosystems

- Date: 2026-11-11
- Decision: `npm` at `/` (covers pnpm) and `uv` at `/pipeline`.
- Why: GitHub's Dependabot options reference (checked 2026-11-11, docs.github.com, "Dependabot options reference") lists `uv` as a supported `package-ecosystem` value and pnpm under `npm`. The same page lists uv v0.11 as the supported version, while the lockfile here was written by uv 0.13.2. Not yet verified on GitHub: confirm the repo's Dependabot tab shows no config error (criterion B5).
- What would change it: Dependabot failing to parse `uv.lock`, in which case switch to `pip` against `pipeline/pyproject.toml`.

### Secret scanning

- Date: 2026-11-11
- Decision: `gitleaks/gitleaks-action@v3` in CI, PR comments off, `pull-requests: read`.
- Why: free for personal-account repos. Comments would need write access; the failing job is enough signal.
- What would change it: moving the repo to an organization, which needs a `GITLEAKS_LICENSE` secret, or switching to the gitleaks CLI.

### Kickoffs are designed, tuned to 2025

- Date: 2026-11-11
- Decision: the kickoff model is designed, not fitted. Its outcome rates (touchback, fair catch, return, starting field position, return yards) are set by hand in a data file and tuned until simulated kickoffs match the 2025 season.
- Why: docs/DATA.md shows the kickoff format changed three times in three seasons. 2023: touchback 73.2%, return 21.7%. 2024: mean start moved up about 4.5 yards. 2025: touchback 20.9%, return 74.2%. No training season matches the current rules, and 2025, the only full season under them, is a holdout season. Fitting on older seasons would guarantee a failed calibration check.
- Cost: tuning to 2025 means the kickoff numbers are not checked against unseen data. The calibration test still compares kickoffs to 2025, but for kickoffs that check confirms the tuning, not a prediction. Every other part of the engine keeps the strict holdout.
- What would change it: once the 2026 season completes, if the rules are unchanged, 2026 becomes a true out-of-sample check for the kickoff numbers. A rule change in 2026 or later means retuning to the newest season.

## M1 step 2: call menus and baseline play caller

The first eleven entries record the lead's resolutions of the spec's open questions (2026-11-11). The rest are the designed choices the spec asks to be logged (E4).

### Defensive preset set (spec open question 1)

- Date: 2026-11-11
- Decision: drop Base Cover 1, add Nickel Cover 1 (four-man rush), keep Nickel Cover 1 Blitz. The 12 presets are Base Cover 3, Base Cover 2, Run Stuff, Nickel Cover 3, Nickel Cover 4, Nickel 2-Man, Nickel Cover 1, Nickel Cover 1 Blitz, Dime Cover 4, Dime Cover 0 Blitz, Goal Line, Prevent. Screens: Base 3, Nickel 5, Dime 2, Specials 2.
- Consequence for the mapping: a base-personnel Cover 1 with seven or fewer in the box no longer has its own preset. It maps to Run Stuff (the base preset with a Cover 1 man shell), and the box mismatch is counted. Dime Cover 1 maps to Nickel Cover 1 or Nickel Cover 1 Blitz by rush count.
- Result: the most common real call with no preset was Nickel Cover 2 (five DBs, Cover 2 zone, four or fewer rushers), which mapped to Nickel Cover 4: 8.7% of mapped snaps in 2018-2023 and 13.8% in 2024-2025. Added as a 13th preset in Post-validation revision 1.
- What would change it: Joseph adding a Nickel Cover 2 preset, which would need another slot.

### QB sneak source (spec open question 2)

- Date: 2026-11-11
- Decision: FTN `is_qb_sneak` for 2022 on (training 2022-2023, and the 2024-2025 validation plays); the inferred rule only for 2016-2021. A 2022+ run with no FTN row has unknown run type: it counts as Run at the top level and is left out of the run-type factor.
- Agreement on 2022-2023 runs with an FTN row (26,217 runs): flag 580, rule 595, both 530, flag only 50, rule only 65. The rule finds 91.4% of flagged sneaks; 89.1% of its sneaks are flagged.
- What would change it: nothing planned; the inferred rule stops mattering as old seasons lose weight.

### Pass depth seasons (spec open question 3)

- Date: 2026-11-11
- Decision: O-depth is fitted on 2022-2023 plain dropbacks only (neither screen nor play action, air yards present), with backoff. No k-factor correction.
- Result: depth mix passed validation (short 65.7 predicted vs 65.2 actual, intermediate 22.1 vs 22.5, deep 12.2 vs 12.4).
- What would change it: a depth metric failing in a later season.

### Defense never sees offensive formation or personnel (spec open question 4)

- Date: 2026-11-11
- Decision: `chooseDefenseCall(situation, data, rng)` takes only the shared Situation. A type-level test pins the signature.
- What would change it: a design decision that substitutions in response to offensive personnel are not "reading the player's call".

### No guard rails on fitted shares (spec open question 5)

- Date: 2026-11-11
- Decision: none added. The validation report lists odd calls instead.
- Result (after Post-validation revision 1): in 1,138 of the 2024-2025 situations trailing in the final 2:00 of the game, the caller gives kneel a nonzero share (mean 1.50%, max 7.88%). Real teams knelt on 1.2% of those plays and the caller predicts 0.7% overall, so the share comes from the data, not from a bug. Whether to forbid it is the open guard-rail question. Spike on 4th down: no situation with a nonzero share.
- What would change it: playtests showing these calls feel wrong.

### Regular season only (spec open question 6)

- Date: 2026-11-11
- Decision: `season_type == "REG"` for training and validation. Postseason rows are counted as excluded in the report.

### Overtime (spec open question 7)

- Date: 2026-11-11
- Decision: excluded from fitting and validation (counted as excluded). At runtime quarter 5 is binned as the second half, with seconds left in the period passed as seconds left in the game (and in the half).
- What would change it: overtime rules landing in RULES.md.

### Data licenses (spec open question 8)

- Date: 2026-11-11
- Decision: generated tables stay committed; the repo is private. Findings are in DATA.md, Licenses section, from nflverse's own repositories: play-by-play is CC-BY 4.0 (LICENSE.md in nflverse/nflverse-data and nflverse/nflverse-pbp); participation is CC-BY-SA 4.0 with attribution to "NFL NextGenStats via nflverse" (2022 and earlier) or "FTN Data via nflverse" (2023 on) (nflverse/nflreadr, R/load_participation.R); FTN charting is CC-BY-SA 4.0 with attribution to "FTN Data via nflverse" (nflverse/nflreadr, R/load_ftn_charting.R).
- Finding: none of these forbids redistributing derived aggregates, so the step did not stop. CC-BY-SA requires attribution and, for adapted material, share-alike licensing. The caller tables aggregate participation and FTN fields, so a public build must carry the attributions and may have to offer those tables under CC-BY-SA 4.0. Not checked: the NFL's own terms for the NGS-sourced rows.
- What would change it: making the repo or a build public (needs a decision on attribution text and the share-alike question).

### Accepted validation failures (spec open question 9)

- Date: 2026-11-11
- Decision: data/caller/tolerances.json has a `known_deviations` list (metric, observed, target, reason, date, approved_by). The pipeline marks a failing metric "accepted" only when an entry for it has `approved_by: "Joseph"`, and the CI test (test/validation-summary.test.ts) recomputes every status the same way. The engineer never adds an entry. Entries are written only after Joseph approves them in conversation; see "Five caller validation misses accepted as known deviations" (2026-11-11), which lists the five current entries. The lead wrote them after Joseph's "Accept them".

### Play first, then formation (spec open question 10)

- Date: 2026-11-11
- Decision: the caller samples the leaf play, then the formation given that play (two draws). MENUS.md lists the formation screen before the play screens, as the brief has it; designer confirms the human order.

### N, half-life and tolerances (spec open question 11)

- Date: 2026-11-11
- Decision: N = 150 plays per stored cell for every factor, half-life 2 seasons anchored at 2023 (weight `0.5 ^ ((2023 - season) / 2)`), tolerances as proposed in the spec.
- Pre-registration: config.json, catalog.json and tolerances.json were final before the first validation run at 14:31 on 2026-11-11. Config hash (catalog + config) `84ff130def851c953f60d39f851f122a3079d6b2a78881945d1e9a3143c12c16`, tolerances hash `404552d0cece11f0162334683a77c32c3c5b1886f2179ddf66f98a9f1863fe65`. Neither file changed after the run. The repo commit is the lead's to make.

### Situation bins

- Date: 2026-11-11
- Decision: as the spec's bin table (data/caller/config.json `dimensions`), with one change: the coarse distance buckets are 1-3, 4-6, 7+, not the spec's 1-2, 3-6, 7+. The spec's own rule (coarse buckets must be unions of fine buckets, criterion A7) rules out 1-2 because the fine bucket 2-3 would straddle it.
- End-state detail (clock 40 s or less vs 41-120, offense timeouts 0 vs 1+, defense timeouts 0, 1, 2+) applies only in the two final-2:00 buckets; elsewhere it is "-".
- Tries: only score, exact score difference (clipped to plus or minus 21), try time (first three quarters, Q4 over 5:00, Q4 final 5:00) and the formation zone apply; down, distance and the scrimmage time bins do not.
- What would change it: the backoff report showing too many sparse cells.

### Backoff chains

- Date: 2026-11-11
- Decision: O-top and D-front use the spec's L0 to L6 chain. Other factors: O-run (down, distance, zone) then coarse then down then global; O-passtype (down, dist3, zone3, score3, time2) then (down, dist3, zone3) then down then global; O-depth (down, dist5, zone6, score3, time2), coarse, (down, dist3, zone3), down, global; O-formation (play, down, dist3, formation zone), (play, formation zone), play, global; O-try (exact diff, try time), (score7, try time), try time, global; D-coverage (front, down, dist3, zone3, score3, time2), (front, down), front, global.
- Two-point tries: tagged levels. The run type, pass type and depth on a two-point try, and the defense preset on a two-point try, use a "try" cell fitted from two-point tries, then a "gl" cell fitted from scrimmage plays at the goal line (yard line 1-5), then the global cell. With N = 150 every two-point cell except run-vs-pass backs off to the goal-line cell.
- Result that matters: 4th downs are fitted on three seasons, so most 4th-down cells only exist at L3 or L4, where the field zone has three buckets (21 to 50 yards out is one, mixing field goal range and punt range), or at the down-only level. That is the main cause of the 4th-down validation failures.
- What would change it: Joseph's decision on the 4th-down failures.

### Offense mapping

- Date: 2026-11-11
- Decision: as the spec's table, applied in priority order spike, kneel, punt, field goal, pass, run. Pass = `play_type == "pass"` or a dropback on a run play (scrambles). Run = `play_type == "run"`, not a scramble. A pass with no FTN row has unknown type (left out of pass type and depth). The inferred sneak's distance is `ydstogo` on scrimmage plays and the yard line on a two-point try, where nflverse records `ydstogo` as 0.
- Formation value table: SHOTGUN Shotgun, PISTOL Pistol, EMPTY Empty, SINGLEBACK, I_FORM and UNDER CENTER Under center, JUMBO Heavy, and WILDCAT Shotgun (proposed: a direct snap from a shotgun-depth alignment; Joseph confirms). Heavy also whenever the personnel has 6+ OL or 3+ TE. Formation is only mapped on run and pass plays; the formation factor additionally needs a known play.
- Personnel: position tokens map to groups (C, G, T, OL to OL; TE; CB, DB, FS, S, SS to DB; DE, DL, DT, NT to DL; ILB, LB, MLB, OLB to LB; QB, RB, FB, WR, K, P, LS to other). An empty personnel string is treated as not recorded.
- Data change found: from 2023, `offense_formation` has only SHOTGUN, UNDER CENTER and PISTOL. EMPTY, JUMBO, SINGLEBACK, I_FORM and WILDCAT stop. The caller's Empty share (3.3% predicted) has no 2024-2025 counterpart (0.0% actual); it still passed the 4-point tolerance.

### Defense mapping

- Date: 2026-11-11
- Decision: coverage value table COVER_0, COVER_1, COVER_2, 2_MAN, COVER_3 to their own shells; COVER_4, COVER_6 and COVER_9 to Cover 4 (quarters family; COVER_9 is new in 2023 and the target is a guess for Joseph to confirm); PREVENT to Prevent; COMBO and BLOWN to "not charted" (no single shell; counted in the report, left out of coverage fitting and preset mapping). `defense_man_zone_type` "" (empty string, used from 2023 where coverage is not charted) is not charted.
- Groups by DB count: 3 or fewer Goal Line, 4 Base, 5 Nickel, 6 Dime, 7+ Prevent. Box 8+ is heavy. Rushers: 5+ is a blitz; 0 or null means not charted (nflverse records 0 on most non-dropbacks).
- A real play gets a preset only when personnel, box and coverage are all charted, which in practice means dropbacks.
- Mismatch shares of mapped snaps (2018-2023 / 2024-2025): personnel group 13.7 / 11.1%, box 3.0 / 5.0%, shell 18.8 / 23.2%, man/zone 2.7 / 1.4%, rush 12.2 / 12.2%, any component 43.5 / 46.5%.
- Data change found: PREVENT coverage is never charted from 2023 on.

### Defense missingness handling

- Date: 2026-11-11
- Decision: as the spec. D-front (personnel group plus box flag) is fitted on every run and pass play with personnel and box charted, 2018-2023. D-coverage (shell, man or zone, rush bucket) is fitted given the front on plays with coverage charted. Preset share = sum over fronts of P(front) x P(coverage | front), mapped through the preset table. D-try is fitted directly on preset shares of two-point tries with a mapped preset, backing off to goal-line plays.
- Checked: coverage is charted on 89% of dropbacks in 2018-2022 and 99.6-99.9% from 2023, and on 0.0-0.2% of runs. So the coverage factor is a dropback model applied to every play.
- The planned diagnostic did not work: FTN `n_blitzers` is 0 on all 26,217 runs in 2022-2023 (25.5% of dropbacks have a blitzer), so FTN does not chart blitzes on runs and the run-vs-dropback comparison cannot test the assumption.
- What would change it: a data source that charts coverage on runs.

### Timeouts remaining in pbp

- Date: 2026-11-11
- Decision: `posteam_timeouts_remaining` and `defteam_timeouts_remaining` are read as the count after the row's own timeout. The situation at the snap adds 1 back when the row has `timeout == 1` by that team.
- Checked on known plays: 2023 ARI at WAS, play 3676 (WAS pass, timeout by WAS recorded on the row): WAS shows 2, the play before shows 3. 2023 CAR at ATL, play 1046 (timeout by CAR on an ATL pass): CAR shows 1, the play before 2. 2023 GB at CHI, play 4083 (timeout by CHI on a CHI pass): CHI shows 1, the play before 2. Standalone timeout rows have both fields null and the next snap shows the reduced count.

### Sampling

- Date: 2026-11-11
- Decision: share functions return floats (products of integer weights over cell totals). `sampleIndex` draws one `rng.nextFloat()` per step and walks the weights in catalog order. Offense: one draw for the leaf call (on a try, extra point or a two-point play), one for the formation from that play's integer weights. Defense: one draw from the preset distribution. If availability masks every level of the top-level offense factor (never with the real tables), Run and Pass split evenly.
- Why: the M3 personalities tilt the float distribution before the draw, and a single walk works for integer and float weights alike.

### Table format and golden file

- Date: 2026-11-11
- Decision: two generated files, data/caller/offense.table.json (82,159 bytes) and defense.table.json (87,522 bytes), 169,681 bytes in total against the 300 KB budget (after Post-validation revision 1; 184,474 before it). Each records `generated`, the config hash, the half-life, and per factor its seasons, season weights, play count, minimum count and one cell map per level. data/caller/golden.json holds 260 situations from a fixed grid, chosen to cover every reachable backoff level; TypeScript must match every lookup and every share within 1e-9.
- Global levels: dCoverage does fall to its global cell. front.dimeHeavy has no stored cell at any level, so every dime-heavy coverage lookup lands on the global cell. That is 7.8% of 2024-2025 validation dCoverage lookups, and 166 golden situations cover that path. Unreachable with the real tables (never hit by any situation): the global level of every other factor, the try-tagged level of the two-point run, pass type, depth and defense factors (no cell reaches 150 tries), and a top-level lookup pushed past a stored cell by masking. The runtime tests cover those with fixture tables.

### zod

- Date: 2026-11-11
- Decision: zod 4.6.7, pinned exactly, in packages/shared only. packages/sim imports only the type-only shared files (`types.ts`, `situation.ts`, `catalog.ts`, `caller.ts`); a test walks its imports.

### First validation run: gate failed

- Date: 2026-11-11
- Result: 59 metrics, 45 pass, 11 fail, 3 not gated (below minimum n). Failures: 4th-down field goal and punt in the fringe zone (opponent 21-35), go and punt at the goal line, go, punt and field goal at midfield (36-50), field goal and punt in the red zone, kneel rate when leading in the game's final 2:00 (42.8 predicted vs 49.0 actual), and man share (35.4 vs 39.6). Numbers in CALLER_REPORT.md section 9. Reported to Joseph; nothing loosened. Fixing it is his decision.

### Post-validation revision 1

- Date: 2026-11-11
- Status: made after viewing the 2024-2025 validation results of the first run, on the coordinator's instruction. It is a structural change to the model, not a tolerance change. data/caller/tolerances.json is byte-identical to the first run (hash `404552d0…63fe65`) and `known_deviations` is still empty. Validation was re-run exactly once after the changes. Config hash for the revised run: `24600cf51672874c2d058d34e6b84ab07dbd3ff13b8095579638e7231b8d38cd` (was `84ff130d…c12c16`).

What changed:

1. 4th down split out of oTop. oTop now covers downs 1-3 only. 4th down uses two new factors:
   - o4Top: run, pass, kick, spike or kneel. Fitted on 2021-2023 for go-rate drift. The chain drops score and time first, then distance, and keeps the fine field zone (6 buckets) until the global level: (dist5, zone6, score7, time5, end state), (dist5, zone6, score7, time5), (dist5, zone6, score3, time5), (dist5, zone6, score3, time2), (dist5, zone6), (dist3, zone6), (zone6), global.
   - o4Kick: punt or field goal given a kick, fitted on 2016-2023 4th downs: (zone6, time2), (zone6), global.
   - The shares compose as P(punt) = P(kick) x P(punt | kick), and the same for field goals.
   - Why: the old chain merged 21 to 50 yards out into one zone (field goal range with punt range) and fell back to the down-only level, so it predicted 18-34% punts in the red zone and fringe.
2. The downs 1-3 chain keeps the end-of-half and end-of-game clock state longer: (down, dist5, zone6, score7, time5, end), (down, dist3, zone3, score7, time5, end), (down, dist3, zone3, score3, time5, end), (down, score3, time5, end), (down, score3, time5, clock), (down, dist3, zone3, score3, time2), (down), global. A new dimension `clock` (40 s or less vs 41-120, final 2:00 buckets only) is the clock part of the end state without the timeouts.
   - Why: on training data alone, kneel when leading in the game's final 2:00 was predicted at 42.7% against 49.0% actual (2016-2023). The finest level, the one with clock and timeouts, was never used; sparse end states fell back to a level that merges the end of the half with the end of the game. For example, 40 s or less with the defense holding 2+ timeouts was predicted at 20.7% against 83.7% actual. After the change: 48.9% predicted against 49.0% actual in-sample.
3. A 13th preset, Nickel Cover 2 (5 DBs, Cover 2 zone, 4 or fewer rushers), on the Nickel screen. The order is now Cover 3, Cover 4, Cover 2, 2-Man, Cover 1, Cover 1 Blitz. A nickel-personnel Cover 2 maps to it instead of to Nickel Cover 4. Dime Cover 2 still maps to Dime Cover 4.

Training-data check, before the holdout run (in-sample, CALLER_REPORT.md section 8b):

- Punt share of 4th downs. Fringe: 0.6% predicted vs 0.9% actual (2016-2023), 0.6% vs 0.5% (2021-2023). Red zone: 0.0% vs 0.0%. Goal line: 0.0% vs 0.0%.
- Field goal share of 4th downs. Fringe: 72.9% vs 75.4%. Red zone: 77.9% vs 81.4%. Midfield: 10.3% vs 9.0%.
- Known in-sample bias left in: 4th down at the goal line, go rate 60.2% predicted vs 49.7% actual (2021-2023). 4th-and-4-to-6 at the goal line has only 131 plays, under N = 150, so it falls back to the goal-line cell, where 4th-and-1 dominates. It is predicted 49% go against 11% actual. A cell there needs either a lower N or dropping the fine zone before distance, which the revision rules out.

Investigated, not changed:

- Man share (35.4% predicted, 39.6% actual). Man or zone is fully determined by the shell in every training season (Cover 0, Cover 1 and 2-Man are 100% man; the rest are 100% zone). So fitting man/zone given the shell on 2023 rows changes nothing.
- The pre-2023 charting gap is real but nearly unbiased for this metric. About 11% of dropbacks are uncharted, and 97.5% of those are sacks or plays without air yards. In 2023, where they are charted, their man share is 42.2% against 41.1% for the rest. Weighting by completeness cannot move the prediction by more than a few tenths of a point.
- The miss comes from the shell mix moving by season: man share 28.7% in 2022, 41.2% in 2023, 49% in 2024, 32% in 2025. Participation moved from NFL NGS to FTN in 2023 (nflreadr docs), which fits a charting change, but the training data cannot separate that from real change. An option for Joseph: fit the coverage factor on 2023 only, the one FTN-charted training season. Not done.

Result of the single revised run: 60 metrics, 52 pass, 5 fail, 3 not gated.

- Midfield 4th down, field goal: 10.1% predicted vs 17.0% actual. Fail.
- Midfield 4th down, punt: 52.4% vs 46.9%. Fail.
- Man share: 35.4% vs 39.6%. Fail, unchanged.
- Nickel Cover 2: 9.6% vs 15.3%. Fail, new metric.
- Nickel Cover 4: 14.6% vs 9.9%. Fail; it passed before the split.
- Kneel when leading late now passes: 49.2% vs 49.0%.
- Every other 4th-down metric now passes.

On midfield kicks, the field goal share of 4th-down kicks from 36-50 yards out rose every few seasons: about 8-10% in 2016-2019, 13-17% in 2020-2022, 19.9% in 2023, 24.7% in 2024 and 28.4% in 2025. Kicking-range behavior is not stable there, so fitting o4Kick on 2016-2023 under-predicts it. On the coverage presets, splitting Cover 2 out of Nickel Cover 4 exposes the 2024-2025 shift toward Cover 2 charting (Cover 2 rows: about 2,500 a season to 2022, 3,517 in 2023, 4,527 and 5,004 in 2024-2025). Fixing these is Joseph's decision.

New table sizes: offense 82,159 bytes, defense 87,522, total 169,681.

### Five caller validation misses accepted as known deviations

- Date: 2026-11-11
- Decision: Joseph approved the five remaining 2024-2025 validation misses as known deviations: midfield 4th-down field goal and punt, man share, Nickel Cover 2 and Nickel Cover 4. They are listed in `data/caller/tolerances.json` under `known_deviations` with approved_by "Joseph". No tolerance value changed.
- Why: each miss is a real league trend that continued after the 2016-2023 training years, not a model bug, and none changes how the game plays in a way a player would notice. A second post-validation refit would further weaken 2024-2025 as an honest holdout.
- What would change it: playtesting showing the AI defense or midfield 4th downs feel wrong, or a decision to refit on the newest training seasons.

### Amendment to locked decision 7: o4Kick seasons

- Date: 2026-11-11
- Decision: spec locked decision 7 says "4th-down decisions 2021 to 2023 only". Post-validation revision 1 (the lead's call) fits punt vs field goal given a kick (o4Kick) on 2016-2023; only go vs kick (o4Top) keeps 2021-2023. The spec records this under "Resolved open questions" as "Amended in Post-validation revision 1".
- Why: the lead judged kicking-range behavior stable enough to use more seasons.
- Cost: that premise does not hold at midfield. The field goal share of midfield 4th-down kicks rose from 8-10% (2016-2019) to 19.9% (2023), 24.7% (2024) and 28.4% (2025). The longer window is the cause of the two midfield misses: 4th-down field goal (10.1% predicted vs 17.0% actual) and punt (52.4% vs 46.9%). Joseph approved both as known deviations in data/caller/tolerances.json.
- What would change it: refitting o4Kick on 2021-2023, or a trend term.

### Validation summary tied to code and files

- Date: 2026-11-11
- Decision: data/caller/validation.json records the sha256 of the exact bytes of offense.table.json, defense.table.json and golden.json that were validated. It also records a code hash over pipeline/caller/*.py (sorted by name; name, NUL, bytes, NUL), alongside the config and tolerances hashes. test/validation-summary.test.ts recomputes all of them from the committed files and fails on any mismatch. `--skip-validation` deletes any existing validation.json, so CI fails until a full run writes a summary for the new tables.
- Why: a summary from older tables or older code must not keep CI green.

### Validation report states the post-hoc revision

- Date: 2026-11-11
- Decision: CALLER_REPORT.md section 9 says plainly that the model was restructured once after the first 2024-2025 run. It marks each metric "revised after holdout" or not, and lists the approved deviations with their reasons. The affected groups are pass rate overall and by down, 4th down, kneel and spike (top-level call chain), formation (it moves through the play mix) and every preset share (Nickel Cover 2 was chosen from the 2024-2025 mismatch table). Their passes are not out-of-sample evidence.
