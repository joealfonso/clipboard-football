# M1 step 1: scaffold and data survey

Status: draft, 2026-11-11. Owner: Joseph.

## Goal

Set up the project skeleton (TypeScript workspace with a pure, seeded sim package, a Python data pipeline, CI) and survey what the nflverse data actually holds, so the M1 play engine and calibration work is designed against real coverage, not assumptions.

For: Joseph (solo developer) and the agents building the rest of M1.

## Non-goals (out of scope)

- No play engine, `resolvePlay`, PlayResult, game state, play menus or matchup table.
- No fitted models, calibration test, or holdout split code. The survey only reports which seasons exist.
- No Vite app, Canvas, Web Worker, IndexedDB, UI or assets (M2 and later). Do not touch DESIGN.md or docs/ASSETS.md.
- No shipped data files. The pipeline in this step writes docs/DATA.md only.
- No zod (nothing to validate yet).
- No CI step that hits the network for nflverse data.
- No deploy, release or publish workflow.
- No resolution of the open issues listed in CLAUDE.md (kickoff training data vs holdout, baseline play caller, menu size, CI sample size, home field tolerance, challenges). The survey supplies facts for them; it does not decide them.

## Dependencies allowed

Exact versions are the engineer's call; pin them (lockfiles committed). Anything not on this list needs Joseph's approval first.

| Dependency | Where | Why |
| --- | --- | --- |
| pnpm (via `packageManager` field) | root | Workspace manager the brief names. |
| typescript | root dev | Strict typecheck across packages. |
| vitest | root dev | Unit tests for shared and sim. |
| eslint, typescript-eslint | root dev | Lint, and the rule that bans `Math.random` in packages/sim. |
| @types/node | root dev, only if needed | Only for config or test files that need Node types. Must not leak into packages/sim's compile lib. |
| nflreadpy (pinned exact) | pipeline | The nflverse loader. Not `nfl_data_py`, which is deprecated. |
| polars | pipeline | What nflreadpy returns; used for counts, dtypes and null rates. |
| pytest | pipeline dev | Tests for pure pipeline helpers. |

Python 3.12, managed with uv (`pyproject.toml` plus `uv.lock` committed).

## Milestones

Each milestone is shippable on its own, on its own branch (never straight to `main`).

### Milestone A: TypeScript workspace and seeded RNG

Layout: pnpm workspace with `packages/shared` and `packages/sim`. TypeScript strict in all packages. Root scripts `test`, `lint`, `typecheck`.

- `packages/shared`: shared types needed now, which may be none beyond what the RNG API exports. Do not add game types speculatively.
- `packages/sim`: pure TypeScript, no DOM. Contains a seeded RNG, xoshiro128** or PCG32 (engineer's call, recorded in DECISIONS.md).

RNG behavior the tests pin down (API names are the engineer's call):

- Construct from a seed. Draw a uint32. Draw a float in [0, 1).
- Fork an independent stream, if the chosen algorithm makes it cheap (PCG32 stream id, or xoshiro jump). If it is not cheap, record that in DECISIONS.md and skip it; do not fake it by reseeding from one draw without saying so.
- State can be read out and restored, so a game can be resumed from the same point. (Needed by later save work; cheap now.)

Acceptance criteria:

| # | Criterion | How it fails |
| --- | --- | --- |
| A1 | `pnpm install && pnpm test && pnpm lint && pnpm typecheck` all exit 0 on a clean clone. | Any non-zero exit. |
| A2 | Two RNGs built from the same seed produce identical sequences for at least 10,000 uint32 draws. | Any mismatch. |
| A3 | Different seeds (test at least two pairs, including seeds that differ in one bit) produce different first 16 outputs. | Identical prefixes. |
| A4 | Known-answer test: the first N outputs for a given seed match published reference output for the chosen algorithm (the authors' reference implementation or test vectors). The test file cites the source URL of the vectors. | Any output differs, or no citation in the test. |
| A5 | Float draws are always >= 0 and < 1 across at least 1,000,000 draws, and the test also checks the edge: a uint32 of 0xFFFFFFFF maps to a value below 1. | A draw equal to 1, a negative draw, or NaN. |
| A6 | Float draws are roughly uniform: over 1,000,000 draws, each of 10 equal bins holds 10% plus or minus 0.5 percentage points. | A bin outside tolerance (catches a wrong shift or scale). |
| A7 | If fork exists: a forked stream's first 1,000 outputs differ from the parent's next 1,000, forking is deterministic (same parent state and fork call give the same child), and drawing from the child does not change the parent's sequence. | Overlap, nondeterminism, or the parent sequence shifting. |
| A8 | Save and restore: restore state mid-sequence and the next 1,000 draws match the original run. | Mismatch. |
| A9 | `Math.random` is banned in packages/sim by an ESLint rule (for example `no-restricted-properties`). A fixture or test proves the rule fires: lint run on a file in packages/sim containing `Math.random()` exits non-zero. | Lint passes with `Math.random` present. |
| A10 | packages/sim tsconfig `lib` contains no `DOM` or `DOM.Iterable` entries and no DOM types are pulled in through `types`. Referencing `document` or `window` in sim source fails `pnpm typecheck`. | Typecheck passes with a `window` reference. |
| A11 | packages/sim has no runtime dependencies in its package.json. | Any entry in `dependencies`. |

### Milestone B: CI and docs skeletons

Files:

- `.github/workflows/ci.yml`: on push and pull_request. Jobs: lint, typecheck, test (TypeScript); pytest of pipeline helpers (Python, via uv, offline); gitleaks secret scan.
- `.github/dependabot.yml`: npm ecosystem at the root, and the Python ecosystem for `pipeline/`. Whether Dependabot reads `uv.lock` directly is an open question (see below); the engineer picks the ecosystem value that works and records it in DECISIONS.md.
- `docs/DECISIONS.md`: records the step 1 decisions (RNG choice and why, fork yes or no, pnpm and Node versions, nflreadpy version, cache location, pbp survey strategy, Dependabot ecosystem). One entry each: date, decision, why, what would change it.
- `docs/MODEL.md`, `docs/RULES.md`, `docs/PERF.md`: headings plus one line per heading on what goes there. MODEL.md must include the rule that each part is marked fitted, designed or mixed, and that the matchup table is designed. RULES.md must say each rule cites a current source. No invented content, numbers or rules.
- CLAUDE.md: replace the `Run:` and `Test:` placeholder lines with the real commands (TypeScript and pipeline). Change nothing else in CLAUDE.md beyond the "Nothing is built yet" line if it is now false.

Acceptance criteria:

| # | Criterion | How it fails |
| --- | --- | --- |
| B1 | CI runs on a PR and all jobs pass on the branch. | Red job, or workflow does not trigger on PR. |
| B2 | A PR that adds `Math.random()` to packages/sim fails the lint job. (Verify once by hand on a throwaway branch; A9 covers it in tests.) | CI green. |
| B3 | The gitleaks job fails on a commit containing a fake secret in gitleaks' default rule format. (Verify once on a throwaway branch, then delete the branch.) | Job green. |
| B4 | No CI job downloads nflverse data. The pytest job passes with the network disabled (for example, run locally with networking off, or the tests mock all loaders). | Any test that calls nflreadpy for real. |
| B5 | dependabot.yml parses (GitHub shows no config error) and lists both ecosystems. | Config error in the repo's Dependabot tab, or an ecosystem missing. |
| B6 | Each docs skeleton exists, has headings with one line each, and contains no numbers, results or rules presented as settled. | A reviewer finds invented content. |
| B7 | CLAUDE.md Run and Test lines are commands that work when pasted on a clean clone. | Command fails. |

### Milestone C: pipeline inventory and docs/DATA.md

`pipeline/` is a uv project (Python 3.12). One command, for example `uv run python -m pipeline.inventory`, run from the repo root, surveys every table below and writes `docs/DATA.md`.

Tables the brief names (loader names to confirm against the pinned nflreadpy version):

play-by-play (1999 to latest), schedules, rosters, player stats, depth charts, injuries, draft picks, draft pick values, contracts, participation, FTN charting.

For each table, DATA.md reports:

- Loader used and nflreadpy version, or "no loader in nflreadpy <version>" if none exists.
- Seasons available (first, last, and any missing seasons in between).
- Row count per season (or total, for tables without a season column, such as contracts or draft values, with a note saying so).
- Column list: name, dtype, null rate (percent, fixed decimals). Sorted by column name.
- Gap notes: seasons missing, columns that are entirely null in some seasons (list the seasons), columns that appear or disappear across seasons.

DATA.md also answers these questions, each computed from the data with the query or column it used stated next to the answer:

1. Kickoff format. Per season from at least 2018 to latest: kickoff count, touchback rate, return rate, and mean starting yard line after kickoff. A short statement of which seasons show the shift that matches the 2024 rule change, based on these numbers. The tool reports the numbers; whether the shift is visible is read from them, not hardcoded.
2. Holdout coverage. Whether participation and FTN charting have rows for 2024 and 2025, with row counts, and whether those counts look complete relative to pbp plays in the same season (ratio reported).
3. Defensive coverage or call. Whether pbp, participation or FTN charting has any column that identifies defensive coverage, man or zone, or defensive call or front, and for which seasons it is non-null (with the null rate per season). The tool finds candidate columns by a documented name pattern list (for example containing `coverage`, `man_zone`, `defense_`, `blitz`, `box`, `rush`) and reports every match; it does not decide by hand which columns count.

Other behavior:

- Cache: raw downloads are cached outside the repo, default `~/.cache/clipboard-football`, overridable by an env var (name is the engineer's call, documented in DATA.md header and CLAUDE.md). Nothing is written inside the repo except docs/DATA.md.
- Memory: pbp may be surveyed one season at a time and aggregated, so peak memory stays bounded by one season. The engineer records peak memory observed in DECISIONS.md.
- Determinism: DATA.md is sorted (tables in a fixed order, seasons ascending, columns by name), with fixed number formatting, and has no timestamps except one data-snapshot line (nflreadpy version plus the latest season and, if available, the nflverse release date or file timestamp of what was read). Two runs against the same cache produce byte-identical files.
- Failure handling: a table whose loader is missing, raises, or returns empty is reported in DATA.md with the error class and message, and the run continues. The command exits 0 if DATA.md was written, even with failed tables. It exits non-zero only if DATA.md cannot be written.
- Rosters and player names are never written to DATA.md. Only aggregates and column metadata. (Public builds must not contain real rosters; DATA.md is committed.)
- Pure helpers (null rate, season gap detection, column presence across seasons, kickoff aggregates on a frame, candidate column matching, markdown rendering) are separated from network loading so pytest can test them on small hand-made polars frames.

Acceptance criteria:

| # | Criterion | How it fails |
| --- | --- | --- |
| C1 | `uv sync` then the inventory command runs to completion on Joseph's machine and writes docs/DATA.md covering all 11 tables (each present with data or with a reported failure). | Crash, or a table missing from the file. |
| C2 | Running the command twice against a warm cache gives byte-identical DATA.md (`git diff --exit-code` after the second run). | Any diff. |
| C3 | Second run makes no network requests for data already cached (verify with networking off: it still completes). | Run fails offline with a warm cache. |
| C4 | With the cache env var set to a temp dir, downloads land there and nowhere under the repo (`git status` clean apart from DATA.md). | Files appear in the repo or in the default cache. |
| C5 | pytest: a loader stub that raises produces a DATA.md section naming the table and error, and the run returns exit 0. | Crash or silent omission. |
| C6 | pytest: null-rate helper on a hand-made frame returns the known rates, including an all-null column (100%) and an empty frame (defined, not a divide-by-zero error). | Wrong value or exception. |
| C7 | pytest: season gap helper on seasons [1999, 2000, 2002] reports 2001 missing. | 2001 not reported. |
| C8 | pytest: kickoff aggregate helper on a hand-made frame of kickoff plays returns the known touchback rate, return rate and mean start yard line. | Wrong values. |
| C9 | pytest: candidate column matcher finds every column matching the documented patterns in a hand-made frame and nothing else. | Miss or false match. |
| C10 | pytest: rendering the same inputs twice gives identical strings, and columns render sorted by name regardless of input order. | Order or content differs. |
| C11 | DATA.md contains the three answers (kickoff, holdout coverage, defensive coverage) with numbers and the column or query used for each. | Any answer missing or stated without its source column. |
| C12 | DATA.md contains no player names or player IDs. A pytest on the renderer, plus a reviewer check of the committed file. | Names or IDs present. |
| C13 | Peak memory of the full run is recorded in DECISIONS.md. | Missing. |

## Edge cases and reachable states

- nflreadpy has no loader for a named table (draft pick values is the likeliest). Reported, not crashed.
- A table exists but has no season column (contracts, draft values). Report totals and say "no season column".
- The latest season is in progress or just finished, so counts are partial. The snapshot line names the latest season; the inventory flags any season whose pbp game count is well below the prior season's.
- A column changes dtype across seasons when loaded season by season. Report each dtype seen with the seasons.
- Download fails mid-run (network drop). That table is reported as failed; the cache does not keep a partial file that a later run treats as complete.
- Cache directory not writable. Fail with a clear message naming the path and the env var; this is the one case where exiting non-zero before writing DATA.md is acceptable.
- Pinned nflreadpy version behind the data (new columns or seasons). The survey reports what it got; the version is in the snapshot line.

## Dependencies and sequencing

- A first (everything else assumes the workspace exists). B and C can run in parallel after A.
- B's CI pytest job needs C's helpers to exist; until C lands, the job runs an empty or placeholder test that passes. Remove the placeholder when C lands.
- C needs network access and Joseph's machine for the real run. Agents can build and test the helpers offline.
- Per CLAUDE.md, each milestone goes through code-reviewer and test-writer before it counts as done.

## Locked vs likely to change

Locked for step 1:

- pnpm workspace, TypeScript strict, Vitest, ESLint with typescript-eslint.
- Sim package pure: no DOM lib, no `Math.random`, no runtime dependencies.
- Seeded RNG is xoshiro128** or PCG32.
- nflreadpy, not nfl_data_py. Python 3.12 with uv.
- Cache outside the repo. Network not in CI. DATA.md deterministic.

Likely to change:

- The RNG API surface, once the engine uses it.
- The tables surveyed and the questions DATA.md answers, as M1 design surfaces new needs.
- packages/shared contents (mostly empty now).
- Candidate column patterns for defensive coverage, after the first run shows real names.

## Open questions

1. Open: does nflreadpy at the pinned version expose a loader for draft pick values? If not, is there an nflverse release file to read directly, or is that table dropped for M1? Decide after C1 reports.
2. Open: does Dependabot support `uv.lock` for the Python ecosystem at the time of building, or does it need `pip` against `pyproject.toml`? Engineer checks GitHub's current docs.
3. Open: Node version to pin (`.nvmrc` or `engines`). Engineer proposes, Joseph confirms.
4. Open: should DATA.md include per-column null rate per season for every table (long), or only for pbp, participation and FTN where it matters for the holdout and coverage questions? Default in this spec: per season only for those three; overall for the rest.
5. Open: license terms for each nflverse table (FTN charting in particular) before any derived data ships. The survey should record the license or source note each table reports, if nflreadpy exposes it; otherwise this needs a manual check before M1 ships data.
