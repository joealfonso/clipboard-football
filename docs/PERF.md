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

- 2026-11-11, M1 step 4 play engine speed (C9), gate 100 us per play. Apple M-series Mac (arm64), Node 25.6.0. Command: `./node_modules/.bin/vitest run packages/sim/test/engine/purity-speed.test.ts -t speed --silent=false`. 160,000 `resolvePlay` calls on states from step 3's random-game generator with the step 2 callers' calls, generated league-average teams, after 5,000 warm-up calls: 9.4 microseconds per play mean, about 1.5 ms of engine time per 160-play game. Passes.
- 2026-11-11, M1 step 4 engine pipeline, no gate. Same machine. `uv run --project pipeline python -m pipeline.engine` with a warm cache: about 2 minutes wall clock (20 s to load and fit 2016-2025, then the in-sample run on 2016-2023 and the 2024-2025 validation through Node, about 3.7 million engine calls).

- 2026-11-11, M1 step 3 soak (E4), no gate. Apple Silicon Mac (arm64), Node 25.6.0. Command: `./node_modules/.bin/vitest run packages/sim/test/game/determinism-soak.test.ts -t soak`. 1,000 complete games (500 regular season, 500 postseason) from the test-side random generator, real rule set, invariant checker on after every transition: 425,134 inputs, 1,044 ms wall clock (about 1 ms per game; rerun after the step 3 review fixes, first run 1,248 ms). The generator plays random, unbalanced outcomes, so this measures the state machine, not a realistic game.
