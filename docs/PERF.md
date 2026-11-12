# PERF.md

Performance budgets and measurements. Each measurement records the date, machine, command, and result.

## Budgets

Targets for sim speed, frame time, load time and pipeline runtime, with why each was chosen.

## Sim throughput

Games simulated per second, headless and in the Web Worker.

## Rendering

Frame time for play animation on the target devices.

## Pipeline

Runtime and peak memory of each pipeline command, cold and warm cache.

## Measurements log

Dated results, newest first.

- 2026-11-11, M1 step 3 soak (E4), no gate. Apple Silicon Mac (arm64), Node 25.6.0. Command: `./node_modules/.bin/vitest run packages/sim/test/game/determinism-soak.test.ts -t soak`. 1,000 complete games (500 regular season, 500 postseason) from the test-side random generator, real rule set, invariant checker on after every transition: 425,134 inputs, 1,044 ms wall clock (about 1 ms per game; rerun after the step 3 review fixes, first run 1,248 ms). The generator plays random, unbalanced outcomes, so this measures the state machine, not a realistic game.
