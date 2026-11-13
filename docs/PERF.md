# PERF.md

Performance budgets and measurements. Each measurement records the date, machine, command, and result.

## Budgets

Targets for sim speed, frame time, load time and pipeline runtime, with why each was chosen.

- Play engine (M1 step 4, C9): at most 100 microseconds per `resolvePlay` call on average, so a full game of about 160 plays stays under 25 ms with room for the callers and the state machine (about 1 ms per game). CI runs the same check with a 3x allowance.

## Sim throughput

Games simulated per second, headless and in the Web Worker.

## Rendering

Frame time for play animation on the target devices.

## Pipeline

Runtime and peak memory of each pipeline command, cold and warm cache.

## Measurements log

Dated results, newest first.

- 2026-11-12, M1 step 5c after the code review (game holdout run 10, pins only; every metric identical to run 9), same machine and command, run alone on an idle machine (load average 1.8 to 2.7): 6.3 ms per game (holdout, 65 s wall clock) and 6.3 ms (in-sample, 65.3 s). Passes the 25 ms gate.
- 2026-11-12, M1 step 5c, the committed runs: game holdout run 9 (approvals and timing only; every metric, slice digest and diagnostic identical to run 8), Apple M4 (darwin arm64), Node v25.6.0, command `node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --target holdout`, run alone on an otherwise idle machine (load average 2.8 before, 3.7 after): 6.4 ms per game (holdout, 66.2 s wall clock). The committed in-sample run (`--target insample`): 6.2 ms per game (64 s). Passes the 25 ms gate. Run 8's 28.2 ms was taken while other work loaded the machine and is not a speed measurement.
- 2026-11-12, M1 step 5b, the committed runs (game holdout run 7, layout only; every metric identical to runs 5 and 6), same machine and command, Apple M4, load average about 15-24 from other work: 14.1 ms per game (holdout, 144.6 s wall clock) and 16.9 ms (in-sample, 175.6 s). Passes the 25 ms gate. Run 6 measured 8.4 ms (holdout) at lower load.

- 2026-11-12, M1 step 5b (game holdout run 6, a speed remeasure; every metric identical to run 5), same machine and command, Apple M4, load average 7 to 17 from other work: 8.4 ms per game (holdout, 89.2 s wall clock) and 14.5 ms (in-sample, 149.4 s). Passes the 25 ms gate. Run 5 (95 ms holdout, 66 ms in-sample) ran at load average about 40-60 and is not a speed measurement.

- 2026-11-12, M1 step 5b after the o4Top level reorder (step 5b run 4), same machine and command, Apple M4: 7.7 ms per game (holdout, 80.6 s wall clock) and 9.0 ms (in-sample, 93.4 s, rerun once the load average fell from about 29 to about 3; the first in-sample run after the reorder measured 91.6 ms under that load and is not a speed measurement). Passes the 25 ms gate.

- 2026-11-12, M1 step 5b after the code review fixes (step 5b run 3), same machine and command (`node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --target holdout` and `--target insample`), Apple M4, load average about 3: 7.4 ms per game (holdout, 76.9 s wall clock) and 8.2 ms (in-sample, 85.9 s). Passes the 25 ms gate. Slow tests at this load, run alone: engine C3 determinism (10,000 plays) 0.9 s, caller D1 determinism (10,000 calls) 0.9 s, step 3 soak (1,000 games) 1.1 s, caller golden coverage sweep 1.8 s. Under load average 13-27 they took 5-6 s, past vitest's 5 s default, so each now has an explicit 30 s timeout. Final review: the engine C3 "a different seed changes at least one" test (two 10,000-play runs) took 1.8 s at load average 18 and timed out at 5 s under heavier load; it has the same explicit 30 s timeout.

- 2026-11-12, M1 step 5b (late caller levels, timeout levels), same machine and command, machine under heavy other load (load average 11 to 27 from other work in the working tree): 12.0 ms per game (holdout run, 125 s) and 19.3 ms (in-sample run, 200 s); the recompute after the key-only gate change (the committed runs) measured 14.8 ms per game (holdout) and 25.4 ms (in-sample, over the 25 ms gate at load average 24). The in-sample run was repeated once the load fell to about 8: 8.6 ms per game, 89 s wall clock . Passes the gate. None of the loaded figures is a clean speed measurement; the 5.6-5.8 ms run below is the last one on an idle machine. The step 5b B10 listing (`scripts/game/late-backoff.ts`) and the E investigation (`scripts/game/investigate.ts`) each replay the 10,000 in-sample games, about 110 s under the same load.

- 2026-11-12, after the code review fixes, same machine and command: 5.6 ms per game (holdout, 58 s) and 5.8 ms (in-sample, 61 s). The heavy checks (D1/D2, 2 x 10,000 games, and the F3 slice) now run in their own vitest project without file parallelism (`pnpm test:heavy`, CI job `test-heavy`), so the default `vitest run` stays parallel.

- 2026-11-12, M1 step 5 after revisions 8-13 and the step 5a caller amendment (F4), same machine and command, machine under other load: 10.6 ms per game (holdout run, 110 s) and 12.4 ms (in-sample run, 129 s). Passes the 25 ms gate. One earlier run that shared the CPU with a test suite measured 38.9 ms per game and was discarded and rerun. Under that load, the D1/D2 home-field test (2 x 10,000 games) pushes several 5-second vitest timeouts over the limit when files run in parallel; the suite passes with `--no-file-parallelism`.

- 2026-11-11, M1 step 5 full game after post-validation revisions 1-5 (F4), gate 25 ms per game. Apple M4, Node 25.6.0, same command. 10,000 games: 5.0 ms per game (holdout run), 4.9 ms (in-sample run), 52 s and 50.5 s wall clock. Passes. The D1/D2 home-field check (test/game/home-field.test.ts, 2 x 10,000 games) takes about 170 s.

- 2026-11-11, M1 step 5 full game (F4), gate 25 ms per game (CI 3x). Apple M4 (darwin arm64), Node 25.6.0. Command: `node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --target holdout` (and `--target insample`). 10,000 regular-season games (loop, callers, coach policies, engine, machine with the invariant checker on every transition, box score): 6.1 ms per game mean (5.0 ms on a second run), 64 s wall clock for the whole run including a 1,000-game postseason soak, the record digests and the report (51.5 s on the second run). Passes. CI re-simulates the 1,000-game slice in test/game/calibration.heavy.test.ts (about 6 s), in the heavy project (`pnpm test:heavy`).

- 2026-11-11, M1 step 4 play engine speed (C9), gate 100 us per play. Apple M-series Mac (arm64), Node 25.6.0. Command: `./node_modules/.bin/vitest run packages/sim/test/engine/purity-speed.test.ts -t speed --silent=false`. 160,000 `resolvePlay` calls on states from step 3's random-game generator with the step 2 callers' calls, generated league-average teams, after 5,000 warm-up calls: 9.4 microseconds per play mean, about 1.5 ms of engine time per 160-play game. Passes.
- 2026-11-11, M1 step 4 engine pipeline, no gate. Same machine. `uv run --project pipeline python -m pipeline.engine` with a warm cache: about 2 minutes wall clock (20 s to load and fit 2016-2025, then the in-sample run on 2016-2023 and the 2024-2025 validation through Node, about 3.7 million engine calls).

- 2026-11-11, M1 step 3 soak (E4), no gate. Apple Silicon Mac (arm64), Node 25.6.0. Command: `./node_modules/.bin/vitest run packages/sim/test/game/determinism-soak.test.ts -t soak`. 1,000 complete games (500 regular season, 500 postseason) from the test-side random generator, real rule set, invariant checker on after every transition: 425,134 inputs, 1,044 ms wall clock (about 1 ms per game; rerun after the step 3 review fixes, first run 1,248 ms). The generator plays random, unbalanced outcomes, so this measures the state machine, not a realistic game.
