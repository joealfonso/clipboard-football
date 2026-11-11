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
