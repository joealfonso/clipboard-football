# Clipboard Football (working title)

A single-player American football coach and GM game in the browser. You call plays from menus and X's and O's animate the result. Inspired by NFL Challenge (XOR, 1985).

## Stack and commands

Nothing is built yet. This is the planned stack, to confirm when the scaffold lands.

- Stack: TypeScript, Vite, Canvas 2D, no engine. Sim runs in a Web Worker. Saves in IndexedDB. Config in JSON validated with zod. Data pipeline in Python 3.12 with uv, reading nflverse through `nflreadpy` (not `nfl_data_py`, it is deprecated).
- Run: <fill in once scaffolded>
- Test: <fill in once scaffolded>

## Key directories

- `pipeline/`: rebuilds every shipped data file from nflverse in one command. Raw downloads are cached outside the repo.
- `docs/`: DECISIONS.md, DATA.md, MODEL.md, RULES.md, PERF.md, ASSETS.md. Keep them current.
- `DESIGN.md` at the root: visual direction for art-director and artist.

## How to work here

The main session plans, delegates and reviews. Subagents can't spawn other subagents, so all delegation happens from here.

- Small change (one file, obvious fix, no new behavior): do it directly, then run the tests. No chain.
- Anything bigger runs in this order:
  1. Spec. UI or flow work: designer. Everything else (sim, pipeline, models, game systems): spec-writer, with acceptance criteria.
  2. Build: engineer, from the spec. If the cause of a bug isn't obvious, debugger finds it first.
  3. Check: code-reviewer on the diff and test-writer against the spec, in parallel. engineer never reviews its own work.
  4. FLAGS from either go back to engineer, then check again. Done when both are clean and the tests pass.
- playtester after any game-rule, sim or balance change: headless matches, soak runs, calibration.
- art-director and artist for visuals, working from DESIGN.md and logging in docs/ASSETS.md.
- To review as a persona, say "review this as the burned-out engineer" (review-as skill).

## Conventions that cause bugs if missed

- The sim is pure: no DOM imports, one seeded RNG passed in, same seed and calls give the same game. Log the seed with every game.
- `resolvePlay(state, offenseCall, defenseCall, rng)` decides every outcome. Animation reads the PlayResult and never decides anything.
- The one-line "why" after each play comes only from factors the engine used.
- Balance lives in data files, never in code. Never flatten variance to make results look fair.
- The offense vs defense matchup table is designed, not fitted. Never call it data-derived. docs/MODEL.md marks each part fitted, designed, or mixed.
- Hold out the two most recent completed seasons for validation. Never train on them.
- Look up current NFL rules, don't write them from memory. Cite the source in docs/RULES.md.
- At most seven choices on a screen. Each management screen gets at most five decisions.

## Boundaries

- Always: run the tests before calling work done. Never weaken or delete a test to make it pass. Each milestone ends with a playtest gate.
- Ask first: schema changes, new dependencies, anything that deploys, any paid data source (give price, license and the test that would show the gain).
- Never: commit secrets, commit straight to `main` (branch first), ship vendor data without checking its license, put real nflverse rosters in a public build (local-only and gitignored).
- Do only the milestone named. No features that weren't asked for.

## Project notes

- Milestones M1 to M9 are in the original brief. M1: pipeline plus a headless engine that sims one game as text. Gate: 10,000 games pass the calibration test.
- Open issues to settle before M1 code (raised 2026-11-11): kickoff training data vs the 2024 and 2025 holdout, a fitted baseline play caller for M1 calibration, the 10-item offense menu vs the seven-choice rule, CI sample size for calibration, home field tolerance, challenges as a second interruption.
