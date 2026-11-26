# PERF.md

Performance budgets and measurements. Each measurement records the date, machine, command, and result.

## Budgets

Targets for sim speed, frame time, load time and pipeline runtime, with why each was chosen.

- Step-wise loop (M2 E9): from a human's answer to the next request, p99 at most 10 ms over the CI slice played with a scripted human seat, leaving room in the design's 100 ms snap budget.
- Play engine (M1 step 4, C9): at most 100 microseconds per `resolvePlay` call on average, so a full game of about 160 plays stays under 25 ms with room for the callers and the state machine (about 1 ms per game). CI runs the same check with a 3x allowance.
- Field timeline (M2 M11, revision 2026-11-14 R-C15): `timeline()` at most 20 ms per play, median and p95 over 1,000 games' plays, inside the 100 ms snap budget (M2 design C1).

## Sim throughput

Games simulated per second, headless and in the Web Worker.

## Rendering

Frame time for play animation on the target devices.

## Pipeline

Runtime and peak memory of each pipeline command, cold and warm cache.

## Measurements log

Dated results, newest first.

- 2026-11-21, M2 strip-sack yards, pins only, step 5b game holdout run 20. Apple M4 (darwin arm64), Node 25.6.0. Command: `node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --target holdout`. 7.4 ms per game (7.37), 76.3 s wall clock, on a quiet machine (load averages 1.42 / 1.81 / 2.22 at the start); the in-sample run just before: 7.439 ms per game, 76.9 s (load 1.28 / 1.91 / 2.30 at its start). Under the 25 ms gate. Run 19, which it supersedes (2026-11-20, 15-minute load under 3): 7.413 ms per game, 76.7 s; the in-sample run before it: 7.356 ms, 76.2 s.
- 2026-11-15, kickoff return pass (docs/specs/m2-play-calling-and-motion.md, KR1 to KR9), budget R-C15 (`timeline()` at most 20 ms per play, median and p95). Apple Silicon Mac (darwin arm64), Node 25.6.0, measured while other sessions were running tests on the same machine (load average 5.85, so the numbers run high). Per-return build time, natural motion on, mean of 10 builds after 3 warm-ups (an engineer's probe, not in the repo): KICKOFF_RETURN 22.5 ms, KR_TD 26.2 ms, KR_LONG 24.9 ms, KR_FUMBLE 19.2 ms. Each return is a plan-only pass (the blocks, then the cut chosen from them) plus one build that reuses the blocks; a second or third build only when the drawn cut reads against the blocks (KR_DRAWS = 3). Earlier the same evening, before the leaders ran `follow` up to four times and with the machine less loaded, the same fixtures measured 16.8, 21.3, 19.0 and 16.7 ms (from 34.1, 46.4, 90.7 and 35.3 ms before the plan-only pass). A kickoff return is over the 20 ms per-play budget on its own; the budget's median and p95 over all plays were not re-measured (test/game/timeline-perf.heavy.test.ts not run). KR heavy sweep, `./node_modules/.bin/vitest run --config vitest.heavy.config.ts test/game/kickoff-return.heavy.test.ts --silent=false`, 1,000 returns from 111 games: KR1 0.0% (kicker OK1 over N1 at 150 ms on every kickoff, older than this pass); KR2 100%; KR3 100%; KR4 100%; KR5 917 of 929 (98.7%); KR6 929 of 929 (100%); KR9 100%; KR7 toward the blocks on 978 of 1000 (97.8%), cuts left 466 and right 463 of 929 (50.2% / 49.8%), 144 ties (15.5%), no leaks before the catch, return-team variants none. Gate (each KR criterion on at least 95% of returns, each cut direction at least 30%): met except KR1.

- 2026-11-15, kick trails' frame cost (docs/specs/m2-calling-screen-pass.md, Q4; code review N2). Apple M4 (darwin arm64), Chromium in the Claude Browser pane against the Vite dev build, an OffscreenCanvas of 1280x656 (the play canvas at 1280x720), `drawField` plus `drawFrame` per frame every 16 ms of timeline from the snap to the whistle, three passes, fixtures KICKOFF_RETURN, PUNT_RETURNED and COMPLETE. No frame budget is set in this file; a 60 fps frame is 16.7 ms.
  - Trail pieces per frame: up to 2,082 on the kickoff, 1,638 on the punt (cut every 25 ms and at each key, `TRAIL_STEP_MS`); 22 drawn paths without trails.
  - One stroke per piece, as first built: kickoff median 5.4 ms, p95 7.2 (2.5 and 3.3 without trails); punt 7.7 and 9.3 (3.7 and 4.2).
  - Batched, one path per side and alpha step (`TRAIL_ALPHA_STEPS` 10, packages/app/src/ui/field.ts): kickoff median 4.4 ms, p95 6.4 (3.1 and 4.4 without trails in the same run); punt 5.1 and 7.3 (3.8 and 4.6). The rest of the cost is building the pieces. COMPLETE (no trail) 4.0 and 4.7 either way.
  - The machine was loaded (other sessions' test runs), so the absolute figures run high; the with and without pairs were measured back to back.
- 2026-11-15, the calling screen's heights (docs/specs/m2-calling-screen-pass.md, Open O7), measured by the engineer in the Vite dev build (Chromium in the Claude Browser pane, viewport emulated), 100% text. Cards row = the situation plate's bottom + 16 to the legend's top - 16.
  - 1280x720: cards row 430 px (spec estimate 429). Legend 74 px (estimate about 75). Situation plate 96 px. A full Last play card with a two-line result 203 px, which left the board 210 px in state 1, so the board shows there in state 1 (the spec's table guessed none at 1280x720; its pixel rule decides, and a longer card hides it).
  - 1024x600: cards row 310 px (estimate 309). A full card with a two-line result 255 px: no board in state 1. The compact card (state 2) 110 px with a two-line first sentence, leaving the board 183 px, so the board shows.
  - The compact card is not the spec's "about 64 px": as first built (label, result, hint on three lines, the card's 20 px padding) it measured about 155 px at 1024x600 and the board never fitted. It now puts the label and the D hint on one line with 12 px padding: 110 px with two result lines. `COMPACT_CARD_PX` (packages/app/src/ui/board.ts) is only the pre-measure guess; the board's fit uses the measured card.
  - The call card (final review, same day): at 1280x720 the call column is 576 px and holds 3 cards of 170 px. A card is 163 px with 119 px art (a run play), a formation card 67 px plus its art; a text row is 48 px with 6 px gaps (42 and 4 tight). Two rows of formation or pass cards ran past the legend ("Esc Back" under it), and so did 6 text rows by 5 px. Now the art shrinks to fit (57 px on Formation, 61 on Pass plays; `callCardFit`, `CARD_ART_MIN` 56) and text rows take the tight spacing when needed: every 1280x720 call screen measured ends above the legend with no scroll.
  - 1024x600 still runs past: the cards row is 310 px and 6 or 7 text rows need about 320 to 360 even tight (Play type ends 59 px past, Formation and Pass plays 11 px). Meeting K5 there needs a design change (row height or the legend's two lines).
  - Not measured: 1440x900, 1920x1080, text above 100%. Other sessions' edits reloaded the dev server several times during the session, so each figure is from one game.
- 2026-11-15 (later), the same amendment after the deepPass throw hold (`throwHold.leafMaxMs` deepPass 1700, Joseph approved), the miss whistle timing (`rollMs` 300 + `restMs` 400), the R-C20 fix and the clear check on drawn marks. Apple M4 (darwin arm64), Node 25.6.0, machine loaded. `test/game/routes-pace.heavy.test.ts` over the same 1,000 games, natural motion on.
  - R-C16, gap at the arrival, 17,675 incompletions with a known target (128 had none): all p10 1.00, p50 1.00, p90 3.50, min 1.00 yd. Break-up (10,621) 1.00 / 1.00 / 1.00, min 1.00 (bound 1.0, no margin: the break-up P is built at exactly `gapYards` and the reach takes `reachYards`). Overthrow (3,613) 3.50 / 3.50 / 3.50, min 2.50. Behind (2,773) and short (668) 2.50 at p10, p50 and p90, min 2.50. 100% within the bounds. The first run of this build had 3 overthrows at 2.49 to 2.50 yd, clamped at the end line (`outYards`); a miss point must now be at least the smallest miss distance off him, else another kind is drawn.
  - R-C17: 10,621 break-ups, 0 bad (breaker within `handYards` + 0.2, nearer than the target, an eligible CB, S or LB, at most 1.15 x top). 7,054 other misses, 0 with a defender within `clearYards` of P. The first run of this build had 1 (seed 171, an LB 1.86 yd from P): the redraw now also counts a defender where an earlier drawing showed him.
  - R-C21: WR 1,063 of 1,063, TE 381 of 381, RB 122 of 122.
  - R-C22, peak at most 1.15 x top: all completions 98.4% of 30,136. deepPass to WRs 96.7% of 1,063, to TEs 94.5% of 381, to RBs 88.5% of 122 (38.5% before the hold). TE and RB miss the 95% bound: a FLAG for route data (spec R-C22), not met. Worst first-over examples: pistol RB1 13.1 and 12.9 yd/s, empty TE1 11.1, shotgun TE1 10.7.
  - 2026-11-16, after the deepPass RB and TE routes settle deep (DECISIONS.md, "Deep completions are caught deep", revised 2026-11-16). Same heavy sweep, load average about 5.2, with another session's timeline.ts and QB drop edits in the tree (motion.json `throwHold.leafMaxMs.deepPass` was still 1700 when the run read it). R-C22: all completions 98.5% of 30,136; deepPass to TEs 98.2% of 381, to RBs 95.1% of 122 (at the bound), to WRs 96.4% of 1,063. R-C21: WR 1,063, TE 381 and RB 122 of their totals. R-C16: 17,675 incompletions, all within bounds (p10 1.00, p50 1.00, p90 3.50, min 1.00). R-C17: 10,841 break-ups and 6,834 other misses, 0 bad. R-C15 failed on that loaded machine: timeline() median 4.09 ms, p95 22.97 ms.
  - R-C24, break-up / overthrow / behind / short: shortPass (5,680) 62.6 / 17.0 / 17.4 / 3.0%; intermediatePass (3,988) 54.4 / 16.7 / 24.4 / 4.5%; deepPass (3,222) 65.4 / 33.1 / 1.4 / 0.1%; screenPass (1,169) 34.8 / 29.3 / 32.1 / 3.8%; playAction (3,616) 65.8 / 15.9 / 10.8 / 7.5%.
  - Correction to the entry below: its "no defender within `clearYards` of P on any other miss" came from the engineer's scratch sweep, which read the predicted positions. The drawn marks did break it: the spec tests found LBs 1.68 to 1.98 yd from P on built plays. The clear check now reads the drawn marks (DECISIONS.md, "Incompletions drawn as misses", revised).
- 2026-11-15, the amendment "misses that read as misses, deep catches that read deep" (docs/specs/m2-play-calling-and-motion.md, R-C16 to R-C24). Apple M4 (darwin arm64), Node 25.6.0, load average about 4. The same 1,000 games as the heavy sweeps (seeds 1 to 1,000, the app's worker Session, scripted human seat), 49,209 pass plays, measured by the engineer's scratch sweep (not in the repo; test-writer's R-C16 to R-C24 tests replace it).
  - R-C16, ball-to-target gap at the arrival, 17,675 incompletions with a known target (128 had none): all p10 1.00, p50 1.00, p90 2.50 yd. Break-up 1.00 / 1.00 / 1.00 (bound 1.0). Overthrow 3.50 / 3.50 / 3.50, min 2.50 (clamped at the end line). Behind and short 2.50 / 2.50 / 2.50 (bound 2.5). 100% within the bounds. Before the change: 0.0 yd at p10, p50 and p90.
  - R-C17: every breaker within `handYards` + 0.2 of the ball, nearer than the target, a CB, S or LB, and at most 1.15 x top from the snap to the arrival (peak p50 0.79 x top, p90 1.00). No defender within `clearYards` of P on any other miss.
  - R-C24, shares of break-up / overthrow / behind / short: shortPass (5,680) 64.5 / 1.6 / 31.5 / 2.4%; intermediatePass (3,988) 53.2 / 0.0 / 38.2 / 8.6%; deepPass (3,222) 65.5 / 32.4 / 2.0 / 0.1%; screenPass (1,169) 34.8 / 5.4 / 55.0 / 4.8%; playAction (3,616) 67.8 / 5.6 / 18.5 / 8.1%; all 60.8 / 7.9 / 26.5 / 4.7%.
  - R-C21: every deepPass completion with no air yards caught at least min(20, gain) past the line and no further than the dead spot: WR 1,063 of 1,063, TE 381 of 381, RB 122 of 122.
  - R-C22, peak at most 1.15 x top: all completions 98.8% of 30,136; deepPass to TEs 96.3% of 381; deepPass to RBs 38.5% of 122 (criterion 95%: not met); deepPass to WRs 97.2% of 1,063. With the spec's starting routes the RB share was 4.1%.
  - R-C23, line at midfield: every WR and TE deepPass track reaches 20 yd in the R8 window, and so does the shotgun back. Backs lined up 7 yd deep (underCenter, pistol, heavy) peak at 17.2 yd in the window and reach 20 yd at 3,525 ms (not met). The next lever is a deepPass throwHold (spec Open item 2).
  - Test-writer's heavy sweep, same day and machine (`./node_modules/.bin/vitest run --config vitest.heavy.config.ts test/game/routes-pace.heavy.test.ts --silent=false`): R-C7 98.8% of 30,136 completions (WR 99.5%, TE 97.3%, RB 98.7%); `timeline()` over 178,005 plays median 0.74 ms, p95 2.09 ms, max 12.5 ms (R-C15 passes).
- 2026-11-15, after the fumble-recoverer converge, the backfield-routes amendment and the catch window limited to points a throw can time within the hold. Test-writer's sweep (`./node_modules/.bin/vitest run --config vitest.heavy.config.ts test/game/routes-pace.heavy.test.ts --silent=false`, 1,000 games, 30,136 completions): R-C7 99.1% within 1.15 x top to the catch (criterion 95%: passes); `timeline()` median 0.66 ms, p95 2.02 ms, max 16 ms (R-C15 passes). By class and position (`TIMELINE_PERF_GAMES=1000 ... test/game/timeline-perf.heavy.test.ts`, peak over the whole play, 98.4% overall): WR 99.1%, TE 96.7%, RB 98.6%; shortPass RB 99.4% of 2,490, intermediatePass RB 99.1% of 336, deepPass TE 95.3% of 381, playAction TE 92.1% of 1,978, deepPass RB 83.6% of 122.
- 2026-11-15, after the screen floor (screenFloorYards -8), the ring-adjusted R8 track, the re-acceleration and stalk fixes. Test-writer's sweep (`./node_modules/.bin/vitest run --config vitest.heavy.config.ts test/game/routes-pace.heavy.test.ts --silent=false`, 1,000 games, 30,136 completions): R-C7 85.2% within 1.15 x top to the catch (criterion 95%: not met); `timeline()` median 0.78 ms, p95 2.37 ms, max 62 ms (R-C15 passes). By position group (`TIMELINE_PERF_GAMES=1000 ... test/game/timeline-perf.heavy.test.ts`, peak over the whole play, 84.7% overall): WR 95.5% of 15,999, TE 80.5% of 7,464, RB 63.7% of 6,673.
- 2026-11-15, after the amended neutral catch depth (the depth follows the target's route when it never reaches the class depth), the continue finish's acceleration and the leave-point fix. Command: `./node_modules/.bin/vitest run --config vitest.heavy.config.ts test/game/routes-pace.heavy.test.ts --silent=false` (test-writer's sweep, 1,000 games, 30,136 completions). `timeline()` median 0.67 ms, p95 2.03 ms, max 123 ms: passes the 20 ms budget (R-C15). R-C7: the target's peak speed to the catch was at most 1.15 x his top on 80.6% (criterion 95%: not met). The worst cases are backs and tight ends near the QB: the 1.5 yd clearance ring around the ball pushes their drawn path off their template before the throw, while the catch point and R8's throw time are planned on the template, so they make up the difference during the flight.
- 2026-11-15, after the catch on the target's route (docs/DECISIONS.md, "Neutral catch x on the target's route"), the sacker fixes and the pocket. Same machine, `TIMELINE_PERF_GAMES=1000` (178,005 plays, 223 s; load average 3.9 at the end). `timeline()` median 0.76 ms, p95 2.23 ms, max 41 ms: passes the 20 ms budget. R-C7: the target's peak speed was at most 1.15 x his top on 85.8% of 30,136 completions (criterion 95%: not met). What is left: routes that never reach the catch depth (screen backs and stalking receivers, the catch at the depth band's edge), and throws held to throwHold.maxMs. This run predates the two template additions that silence the console warnings (routes.kick RB and WR, linemen named as tacklers); a 60-game rerun after them gave 83.9% and no warnings.
- 2026-11-15, after the code review fix that the target leaves his route only at or after the throw (decision 9, P3). Same machine, `TIMELINE_PERF_GAMES=100` (100 games, 17,926 plays; load average about 7 to 15 from another session). `timeline()` median 2.13 ms, p95 12.33 ms: under the 20 ms budget, not a clean reading. R-C7: the target's peak speed was at most 1.15 x his top on 1.6% of 2,953 completions. The 98.2% below was reached by bending toward the catch before the throw, which showed who the target was. The catch x is the engine's passLocation third (10, 26.65 or 43.3 yd), often across the field from the target's route, so he has to cover that distance during the flight. Open: the lead's call on the catch point's x.
- 2026-11-15, M2 revision 2026-11-14, R-C15 and R-C7 after the neutral catch depth (docs/DECISIONS.md, 2026-11-15) and the R-C10 data fixes. Same machine and command as the entry below. 178,005 plays, 461 s wall clock: `timeline()` median 1.01 ms, p95 4.37 ms, max 295 ms (load average 19.6 at the start, 6.9 at the end, from another session: not a clean reading). Passes the 20 ms budget. R-C7: the target's peak speed was at most 1.15 x his top speed on 98.2% of 30,136 completions (criterion: 95%).
- 2026-11-15, M2 revision 2026-11-14 (real routes and slower pace), R-C15 and R-C7. Apple M4 (darwin arm64), Node 25.6.0. Command: `TIMELINE_PERF_GAMES=1000 ./node_modules/.bin/vitest run --config vitest.heavy.config.ts test/game/timeline-perf.heavy.test.ts --silent=false` (1,000 games through the app's worker Session with the scripted human seat, seeds 1 to 1,000). 178,005 plays, 554 s wall clock including the games: `timeline()` median 0.98 ms, p95 6.78 ms, max 503 ms (one outlier, taken while another session loaded the machine: load average 14.8 at the start, 17.2 at the end, so not a clean reading). Passes the 20 ms budget. R-C7: on 30,136 completions the target's peak speed was at most 1.15 x his top speed on 67.8%, short of the criterion's 95%. Cause: the engine sends no `airYards`, so the timeline's catch point is the dead spot (neutral), and on longer gains the target must cover the whole gain before the catch inside the 1,200 ms throw hold.
- 2026-11-14, M2 G review fixes, pins only, step 5b game holdout run 18. Apple M4 (darwin arm64), Node 25.6.0. Command: `node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --target holdout`. 7.5 ms per game (7.468), 77.4 s wall clock, on a quiet machine (15-minute load average 3.98 at the start of the sequence); the in-sample run just before: 7.566 ms per game, 78.4 s. Under the 25 ms gate.
- 2026-11-14, M2 F and G pins only, step 5b game holdout run 17. Apple M4 (darwin arm64), Node 25.6.0. Command: `node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --target holdout`. 7.6 ms per game (7.601), 78.8 s wall clock, on a quiet machine (15-minute load average 3.97 at the start of the sequence); the in-sample run just before: 7.607 ms per game, 78.9 s. Under the 25 ms gate.
- 2026-11-14, M2 F, the cost of standout plays. Apple M4 (darwin arm64), Node 25.6.0. Command: `node --import ./scripts/engine/register.mjs scripts/game/standout-perf.ts` (the first in-sample league's 1,000 games, standouts off and on in alternating blocks of 100 after a warm-up), on a quiet machine (5-minute load average under 4). Off 7.758 ms per game, on 8.126 ms: +0.37 ms (+4.7%). The 11.2 ms in-sample reading in docs/GAME_REPORT.md at the F commit was load; the in-sample summary rerun right after this one measured standouts off.
- 2026-11-14, M2 pins only, step 5b game holdout run 16. Apple M4 (darwin arm64), Node 25.6.0. Command: `node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --target holdout`. 7.36 ms per game, 76.3 s wall clock, on a quiet machine (15-minute load average 3.94 at the start of the sequence); the in-sample run just before: 7.55 ms per game, 78.2 s. Under the 25 ms gate.
- 2026-11-14, M2 A-E pins only, step 5b game holdout run 15. Apple M4 (darwin arm64), Node 25.6.0. Command: `node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --target holdout`. 7.66 ms per game, 79.3 s wall clock, on a quiet machine (15-minute load average under 4); the in-sample run just before: 7.47 ms per game, 77.5 s. Under the 25 ms gate.
- 2026-11-14, M2 milestone E (E9), gate p99 at most 10 ms from an answer to the next request. Apple M4 (darwin arm64), Node 25.6.0. Command: `node --import ./scripts/engine/register.mjs scripts/game/session-perf.ts 1000` (the in-sample CI slice, 1,000 games, a scripted human seat answering every request with a seeded random legal path). 191,694 answers, 30.5 s: p50 0.128 ms, p99 1.021 ms, max 26.2 ms. Not a clean reading: the load average was 14 to 21 from other work on the host. Passes the gate. The in-sample calibration run just before it measured 11.5 ms per game under the same load (it was 7.4 to 9.2 ms in the quieter M2 A to D runs).
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

- 2026-11-14, M1 step 5 full game, step 5d game holdout run 14 (the committed summary; approvals, report fix and pins only). Apple M4 (darwin arm64), Node 25.6.0. Command: `node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --target holdout`. 8.3 ms per game, 85.8 s wall clock, started with the 15-minute load average at 1.4 (a clean reading); the in-sample run just before: 7.4 ms per game, 76.1 s. Under the 25 ms gate.
- 2026-11-13, M1 step 5 full game, step 5d game holdout run 13 (the committed summary). Apple M4 (darwin arm64), Node 25.6.0. Command: `node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --target holdout`. 15.3 ms per game, 157.5 s wall clock (in-sample run just before: 14.2 ms per game). The 1-minute load average was under 4 at the start, but the 15-minute average was still 10-13 after the engine validation run, so this is not a clean reading; it is under the 25 ms gate. Run 11's 8.3 ms per game remains the last clean one.
- 2026-11-13, M1 step 5 full game, step 5d game holdout run 12 (the committed summary; approvals and pins only). Apple M4 (darwin arm64), Node 25.6.0. Command: `node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --target holdout`. 49.7 ms per game, 511.3 s wall clock, on a loaded machine (load average 22 to 48 from other work on the host). Not a usable speed reading: the metrics match run 11 exactly, and run 11 below (8.3 ms per game) is the last clean measurement, under the 25 ms gate.
- 2026-11-13, M1 step 5 full game, step 5d game holdout run 11 (the committed summary). Apple M4 (darwin arm64), Node 25.6.0. Command: `node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --target holdout`. 10,000 regular-season games: 8.3 ms per game mean, 85.6 s wall clock including the 1,000-game postseason soak, the record digests and the report; the in-sample run just before it took 7.1 ms per game (73.6 s). Under the 25 ms gate.
- 2026-11-11, M1 step 5 full game (F4), gate 25 ms per game (CI 3x). Apple M4 (darwin arm64), Node 25.6.0. Command: `node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --target holdout` (and `--target insample`). 10,000 regular-season games (loop, callers, coach policies, engine, machine with the invariant checker on every transition, box score): 6.1 ms per game mean (5.0 ms on a second run), 64 s wall clock for the whole run including a 1,000-game postseason soak, the record digests and the report (51.5 s on the second run). Passes. CI re-simulates the 1,000-game slice in test/game/calibration.heavy.test.ts (about 6 s), in the heavy project (`pnpm test:heavy`).

- 2026-11-11, M1 step 4 play engine speed (C9), gate 100 us per play. Apple M-series Mac (arm64), Node 25.6.0. Command: `./node_modules/.bin/vitest run packages/sim/test/engine/purity-speed.test.ts -t speed --silent=false`. 160,000 `resolvePlay` calls on states from step 3's random-game generator with the step 2 callers' calls, generated league-average teams, after 5,000 warm-up calls: 9.4 microseconds per play mean, about 1.5 ms of engine time per 160-play game. Passes.
- 2026-11-11, M1 step 4 engine pipeline, no gate. Same machine. `uv run --project pipeline python -m pipeline.engine` with a warm cache: about 2 minutes wall clock (20 s to load and fit 2016-2025, then the in-sample run on 2016-2023 and the 2024-2025 validation through Node, about 3.7 million engine calls).

- 2026-11-11, M1 step 3 soak (E4), no gate. Apple Silicon Mac (arm64), Node 25.6.0. Command: `./node_modules/.bin/vitest run packages/sim/test/game/determinism-soak.test.ts -t soak`. 1,000 complete games (500 regular season, 500 postseason) from the test-side random generator, real rule set, invariant checker on after every transition: 425,134 inputs, 1,044 ms wall clock (about 1 ms per game; rerun after the step 3 review fixes, first run 1,248 ms). The generator plays random, unbalanced outcomes, so this measures the state machine, not a realistic game.

## Player reactions, slice 1 (docs/specs/m2-player-reactions.md), 2026-11-23 and 24

This section is the first build. The section after it, "round 2", has the figures for the build as it stands.

Measured by the engineer with `packages/app/test/zz-react-probe.test.ts` (`./node_modules/.bin/vitest run packages/app/test/zz-react-probe.test.ts --reporter=verbose --disable-console-intercept`). Sample S: `simGame` seeds 1 to 6, every run and pass (571 plays), drawn at 1x with the app's ratings. "Before" is a copy of the tree the build started from (timeline.ts sha256 f8474557..., motion.json version 4), run with the same probe. On that tree there is no `nat.react`, so a defender's pursuit start is what that code schedules, `tl.read + nat.reactionMs`. Designed, display only: none of this is fitted, and no primary source for reaction times was checked.

Counted defenders (PR-C2): side X, not DL, not named by the play, not the tackler. All 571 plays have 4 or more.

| Measure | Before | After |
|---|---|---|
| Range of pursuit starts among counted defenders, per play (ms): p10 / p50 / p90 | 72 / 120 / 160 | 208 / 326 / 447 |
| Share of counted defenders within 100 ms of the median, per play: p10 / p50 / p90 | 0.83 / 1.00 / 1.00 | 0.33 / 0.57 / 0.83 |
| Plays on which that share is 1.00 | 76.0% | 4.0% |
| `readMs` LB, p10 / p50 / p90 (ms) | 101 / 147 / 213 | 118 / 280 / 453 |
| `readMs` CB, p10 / p50 / p90 (ms) | 140 / 203 / 252 | 108 / 295 / 485 |
| `readMs` S, p10 / p50 / p90 (ms) | 153 / 199 / 242 | 156 / 315 / 453 |
| The first probe's measure (dep + reactionMs / k), range per play, p50 (ms) | 130 | 383 |
| First movement after the snap, p10 to p90 range across the 22, p50 (ms) | 145 | 145 |

PR-C2's floors (median range at least 250 ms, median share at most 0.75, share 1.00 on at most 10% of plays) are met at the starting values. Awareness of the non-DL defenders on the field: p10 47, p50 62, p90 82.

`timeline()` time per play over S (R-C15's bound is 20 ms, median), Node 25.6.0, darwin arm64, three runs of each tree taken in turn at a load average near 5:

| | p10 | p50 | p90 | max |
|---|---|---|---|---|
| Before (ms) | 1.87 to 1.89 | 3.23 to 3.27 | 6.00 to 6.09 | 27.6 to 27.8 |
| After (ms) | 1.99 to 2.02 | 3.42 | 6.08 to 6.25 | 28.0 to 28.6 |

Three more pairs taken at a load average of 22 to 24 read 8.1 to 9.9 ms (before) and 8.6 to 10.2 ms (after) at the median. Those are not speed measurements.

The tackler (PR6), 392 tackles in S, all rated:

| | Tackles |
|---|---|
| Leaves at his own read (delay = `readMs`) | 139 |
| Leaves between the read and his own read (delay below `readMs`, above 0) | 41 |
| Leaves at the read, as before the build (delay 0) | 212 |
| of those: his leg from the read is anchor-demanded, as before | 144 |
| With a delay: leg anchor-demanded / over N1's limit on the leg | 0 / 0 |
| Left more than 25 ms before his own read, and runs under 0.7 x his top (PR-C7's floor) | 7 of 242 |
| Differs from a build naming another tackler, up to 25 ms before he leaves | 0 of 180 compared |
| Not at the ball at the whistle | 0 |

Why a delay is refused (383 plain tacklers whose read is above 0): his own read is accepted on 139; refused for a leg mean above 1.15 x top on 130 (126 end at delay 0); for a peak above 1.15 x top on 64 (34 find a lower delay); for less than `convergeMs` left on 47 (46 end at delay 0); for a peak as drawn on 2; for the unnamed self's settle having begun on 1.

Standing checks on S with the app's ratings, plays with at least one mark failing, by the test-writer's ports in `packages/app/test/player-reactions.checks.ts` (the bar is the count before the build):

| Check | Before | After | Newly failing / newly passing plays | After, with the DL's own release delay switched off (an experiment on a scratch copy, not shipped) |
|---|---|---|---|---|
| N1 | 547 | 550 | 8 / 5 | 547 |
| N3 | 54 | 28 | 5 / 31 | 45 |
| N4 | 77 | 82 | 15 / 10 | 83 |
| N5, moving | 369 | 368 | 25 / 26 | 363 |
| N5, engaged, and M6 (with the raw build for "nobody wins") | 402 | 395 | 34 / 41 | not taken |
| N5, engaged, and M6 (without it) | 379 | 388 | 35 / 26 | 381 |
| N6, settle | 334 | 324 | 34 / 44 | 324 |
| N6, anchors exact | 1 | 1 | 0 / 0 | 1 |
| A3, ring | 2 | 1 | 0 / 1 | 0 |
| R-C5, nobody frozen | 7 | 7 | 0 / 0 | 7 |
| M5 | 2 | 1 | 0 / 1 | 1 |

The standing spec test counts N5 engaged and M6 at 384 before and 392 after. On the fixtures with the test's rating table one pair newly fails: N6's settle on INCOMPLETE (OL4 and OL5, speed rising by up to 0.07 yd/s a key at about 0.25 yd/s, against a limit of 0.05). It passes with the DL's own release delay switched off.

The heavy run (`./node_modules/.bin/vitest run --config vitest.heavy.config.ts test/game/player-reactions.heavy.test.ts`), 1,000 run, pass and sack plays of 10 simulated games (seeds 101 on), 1x, share of plays on which no mark breaks the check, with ratings / with none: N1 3.2% / 5.0%, N3 94.5% / 87.3%, N4 89.3% / 90.0%, N5 moving 36.4% / 39.0%, N5 engaged, M6 and nobody wins 33.3% / 32.8%, A3 ring 100.0% / 100.0%. It reports only.

## Player reactions, slice 1, round 2 (2026-11-24)

The build after the lead's rulings of 2026-11-24: the floor applied after the variation (PR3), a rated DL released no later than the ball's ring reaches him, a rated tackler drawn as his unnamed self until he leaves, also when he leaves at the read (PR6), and the peak of his run measured from his departure. Same probe, same sample S (571 plays), same "before" tree. Designed, display only.

| Measure | Before | After, round 2 |
|---|---|---|
| Range of pursuit starts among counted defenders, per play (ms): p10 / p50 / p90 | 72 / 120 / 160 | 208 / 321 / 440 |
| Share of counted defenders within 100 ms of the median, per play: p10 / p50 / p90 | 0.83 / 1.00 / 1.00 | 0.33 / 0.57 / 0.83 |
| Plays on which that share is 1.00 | 76.0% | 4.0% |
| `readMs` LB, p10 / p50 / p90 (ms) | 101 / 147 / 213 | 118 / 280 / 453 |
| `readMs` CB, p10 / p50 / p90 (ms) | 140 / 203 / 252 | 104 / 295 / 485 |
| `readMs` S, p10 / p50 / p90 (ms) | 153 / 199 / 242 | 156 / 315 / 453 |
| The first probe's measure (dep + reactionMs / k), range per play, p50 (ms) | 130 | 380 |

`timeline()` per play over S, three runs of each tree taken in turn at a load average of 6 to 8: before p50 3.27 to 3.32 ms, p90 5.97 to 6.08, max 27.3 to 31.7; after p50 3.38 to 3.41 ms, p90 5.89 to 6.00, max 28.1 to 28.4. R-C15's bound is 20 ms at the median.

Standing checks on S with the app's ratings, plays with at least one mark failing, as `packages/app/test/player-reactions-standing.spec.test.ts` counts them:

| Check | Bar (before the build) | First build | Round 2 | Newly failing / newly passing against before (my count) |
|---|---|---|---|---|
| N1 | 547 | 550 | 547 | 5 / 5 |
| N3 | 54 | 28 | 45 | 4 / 13 |
| N4 | 77, allowed to 88 | 82 | 83 | 16 / 10 |
| N5, moving | 369 | 368 | 366 | 10 / 13 |
| N5, engaged, and M6 | 384 | 392 | 384 | 1 / 1 |
| N6, settle | 334 | 324 | 321 | 7 / 20 |
| N6, anchors exact | 1 | 1 | 1 | 0 / 0 |
| A3, ring | 2 | 1 | 0 | 0 / 2 |
| R-C5, nobody frozen | 7 | 7 | 7 | 0 / 0 |
| M5 | 2 | 1 | 1 | 0 / 1 |
| M7 | 4 | not taken | 4 | not taken (3 of the 4 plays are not the ones that failed before) |

On the fixtures with the test's rating table, every (check, fixture) pair that passed before the build passes: N1 18 red before and after, N3 2, N4 5, N5 moving 8, N5 engaged 12, N6 settle 11 (INCOMPLETE passes again).

The DL release: 2,187 unnamed DL marks in S. The ring rule releases 263 of them (on 242 plays) before their own read, by 117 ms at the median and 235 ms at p90. The hold after the line's release is 0 / 99 / 237 ms at p10 / p50 / p90. 300 never release before the whistle. The pair's hand fight ends at the line's release as before the build, so a blocker's keys do not depend on his DL's rating.

N4: the 16 newly failing plays are 9 offensive marks (6 of them a WR on a run) and 7 defenders. I looked at six (four WRs on runs, a safety, a linebacker). The four WRs are stalkers shadowing a defender, with no pursuit of their own. On all six the cruise wobble is present: the built speed varies by 3.6% to 8% of top across the failing 500 ms window and the wobble happens to cancel it, leaving 1.5% to 1.9% against the 2% the check asks. Nothing was changed for N4.

The tackler (PR6), 392 tackles in S:

| | Tackles |
|---|---|
| Leaves at his own read | 140 |
| Leaves between the read and his own read | 41 |
| Leaves at the read | 211 |
| of those: a leg mean above 1.15 x top at every delay, down to 25 ms | 118 |
| of those: a peak above 1.15 x top at the lowest delay (48 on the built keys, 6 as drawn) | 54 |
| of those: less than `convergeMs` left at every delay | 30 |
| of those: his own read is 0 (a DL) | 5 |
| of those: fact legs of his own (a QB), departs as before | 4 |
| With a delay: leg anchor-demanded / over N1's limit on the leg | 0 / 0 |
| Differs from a build naming another tackler up to 25 ms before he leaves: with a delay | 0 of 181 |
| Differs, leaving at the read | 3 of 211, all QBs with fact legs of their own |

The first section's "144 anchor-demanded, 46 too little time, 30 over the peak" did not sum to 212 because they came from two tallies: 144 counted the tacklers whose drawn leg from the read is in `nat.demanded`, the other two counted why his own read, the first candidate, was refused. The rows above are one tally, by why the lowest candidate was refused, and they sum to 211.

The heavy run (same command as above), share of plays on which no mark breaks the check, with ratings / with none: N1 3.8% / 5.0%, N3 92.4% / 87.3%, N4 89.3% / 90.0%, N5 moving 37.4% / 39.0%, N5 engaged, M6 and nobody wins 33.8% / 32.8%, A3 ring 100.0% / 100.0%. It reports only.

## Player reactions, slice 1, round 3 (2026-11-24)

Two changes after round 2: a rated tackler leaves before the ball's ring would throw him off, and a DL's release is non-increasing in awareness. Sample S (571 plays), the first probe (the three base ratings): range of pursuit starts p10 / p50 / p90 208 / 320 / 440 ms, share of counted defenders within 100 ms of the median 0.33 / 0.57 / 0.83, share 1.00 on 4.0% of plays. The review found two defects in it, fixed in the next section.

## Player reactions, two slice 1 fixes (2026-11-24)

`selfTackle`: a tackler starts his run where his unnamed self is at his departure, and up to it he is drawn from that self's own keys. `releaseWith`: the DL's hold is built as far as the last key it tests. Fixes 1 and 2 alone on the slice 1 tree, then with slice 2. Full card ratings, S.

| Measure | Slice 1 round 3 | The fixes on slice 1 | With slice 2 |
|---|---|---|---|
| Tacklers off their unnamed self by over 1e-6 yd up to 25 ms before they leave (1 ms steps), of 387 | 2 | 0 | 0 |
| Off it by over 0.1 yd at any time until they leave | 5 | 0 | 0 |
| Worst gap in the last key (yd) | 0.675 | 0.034 | 0.047 |
| DL sets released later at a higher awareness (40 to 90 by 2), of 554 | 3 | 0 | 0 |
| Tacklers who go toward the ball, away and toward it again, of 392 (bar 23) | 26 | 27 | 29 (28 with slice 2 and no fix) |
| Of those, within 4 yd of the ball at the read (2 before the build) | 2 | 3 | 3 |

The third one is seed 3 play 5. The standing counts on S are the same with the fixes as without them.

## Player reactions, slice 2 (2026-11-24)

PR7 and PR8: man lag and cushion, stalk lag, play-action bite, break pace. Sample S, the app's ratings and skills. Designed, display only. Nothing was tuned.

Standing checks on S, plays failing: N1 546 (bar 547), N3 45 (54), N4 80 (88), N5 moving 368 (369), N5 engaged and M6 380 (384), N6 settle 323 (334), N6 anchors 1 (1), A3 ring 0 (2), R-C5 2 (7), M5 2 (2), M7 5 (4, over). On the fixtures one pair newly fails: N6 settle on INCOMPLETE (OL4). With `breakPaceShare` at [0, 0] M7 is 3 and INCOMPLETE passes; with the man, stalk or bite bands at 0 instead M7 is 6, 5 and 4 and INCOMPLETE still fails.

| Effect at rating 40 against 90 | Result | Floor |
|---|---|---|
| PR-C11 coverage, separation gained, median: all man pairs (70) / coverage presets (10) / their corners (5) / run fronts (60) | 0.17 / 0.29 / 0.72 / 0.16 yd | 0.6 |
| PR-C11 routeRunning, the same sets (51 / 6 / 2 / 45) | 0.02 / 0.06 / 0.06 / 0.02 yd | 0.3 |
| PR-C12 (a) bite, coverage drop sets | every pair over 0.8 yd | 0.8 |
| PR-C12 (a) bite, 4 of the run-front pairs (runStuff, goalLine) under the floor | 0.35 to 0.61 yd | 0.8 |
| PR-C12 (a) bite, all 27 pairs, median | 1.08 yd | |
| PR-C12 (b) stalk lag | 230 ms | 150 |
| PR-C12 (c) apex speed over top, 16 breaks, min / median | 0.095 / 0.179 | 0.08 |

Why PR-C11 is small, over every S play (290 pairs, one lag band moved). The 240 ms moves the trailed point 1.83 yd at the median, but the cushion cancels much of it (the point goes from ahead of the receiver to behind him): a defender standing exactly on the trailed point would gain 0.38 yd (0.91 on coverage presets, 1.13 for their corners). What is drawn is 0.05, 0.32 and 0.58. Without the held depth (a man holds his depth until the receiver gets to it) it is 0.02, 0.53 and 0.84. The rest is his acceleration and top speed: in a 680 ms median window, 32% of it is spent over 3 yd from the trailed point.

R-C8's hold with each WR's own lag in B, windows missed: slice 1 (lag 150 for everyone) table 2 of 83, awareness 40 2 of 81, awareness 90 6 of 87; slice 2 table 0 of 97, 40 0 of 104, 90 5 of 63.

PR-C9 (b), the shipped build against every `ratings.scrimmage` pair at [0, 0]: 296 runs, 0 moved. 187 completions and interceptions, a fact moved on 145 (ball at the whistle p50 0.01, p90 0.57, max 1.35 yd). 88 incompletions, the throw moved on 58. Over 275 thrown passes the throw moved on 144, by 17 ms at the median and 101 ms at p90 (131 ms at most), never outside R8's window.

`timeline()` per play over S, three passes a run, two runs each: slice 1 p50 3.12 to 3.39 ms, p90 5.47 to 6.14; after p50 3.29 to 3.46, p90 5.64 to 6.04. The heavy run was not repeated.

## Player reactions, slice 2, second round (2026-11-24)

A capped settle gets a key at the whistle for a rated mark on a scrimmage play (`settleWarp`). M7 on S goes from 5 to 0; every other standing count on S and on the fixtures is unchanged, play for play.

Measured only, with in-memory copies of the data, nothing changed in it. PR-C11 over all of S, coverage presets (no run fronts), median over pairs at rating 40 against 90: the criterion's absolute distance, and how far the defender is behind his receiver along the receiver's own path (yd). Every setting keeps every standing bar on S.

| Setting | Corners: distance / behind, median difference | All man pairs: distance / behind, median difference |
|---|---|---|
| `man.lagMs` [150, -90] (shipped) | 0.58 / 0.86 (42 pairs) | 0.32 / 0.59 (70) |
| [225, -110] | 0.80 / 1.08 | 0.40 / 0.80 |
| [300, -110] | 0.89 / 1.15 | 0.43 / 0.88 |
| [150, -90], `cushionYards` [0, 0] | 0.60 / 0.71 | 0.36 / 0.57 |
| [225, -110], `cushionYards` [0, 0] | 0.76 / 0.91 | 0.46 / 0.76 |
| [300, -110], `cushionYards` [0, 0] | 0.85 / 0.99 | 0.52 / 0.88 |
| `man.receiverLagMs` [-40, 100] (shipped) | 0.46 / 0.50 (27) | 0.20 / 0.33 (52) |
| [-80, 180] | 0.81 / 0.84 | 0.33 / 0.54 |
| [-120, 250] | 1.06 / 1.17 | 0.43 / 0.74 |

`stalk.lagMs`, R-C8 windows missed at the table / every WR at 40 / every WR at 90: [150, -80] (shipped) 0 of 97 / 0 of 104 / 5 of 63; [150, -40] 0 of 99 / 0 of 104 / 0 of 79; [150, 0] 0 of 102 / 0 of 104 / 3 of 85.

## Player reactions, slice 2, third round (2026-11-24)

Joseph's decisions of 2026-11-24: a rated tackler may leave his unnamed self's path in the last 50 ms before he departs (`OWN_PATH_MS`); `man.lagMs` [300, -110], `man.receiverLagMs` [-80, 180], `stalk.lagMs` [150, -40]. And one recovery fix: a linebacker whose own bite already took him as far as his drop goes straight on to his assignment.

Tackler, 387 compared: 0 differ from the unnamed self up to 50 ms before departure at 1 ms steps (4 are over 0.1 yd inside it, worst 0.836). Tacklers drawn away from the ball over their top within 3.5 yd: 9 before this round, 3 after (seed 2 play 31, seed 4 play 46, seed 5 play 27, 1.07 to 1.09 x). DL releases 0 of 554 wrong.

The three data pairs together on S, plays failing (bar): N1 547 (547), N3 46 (54), N4 77 (88), N5 moving 367 (369), N5 engaged 380 (384), N6 settle 323 (334), N6 anchors 1 (1), A3 0 (2), R-C5 2 (7), M5 2 (2), M7 0 (4). R-C8 windows missed: table 0 of 99, awareness 40 0 of 104, 90 0 of 79. Corners of coverage presets, behind the receiver, median difference 40 against 90: coverage 1.01 yd (42 pairs), routeRunning 0.67 yd (27). Bite in run fronts 1.10 to 1.73 yd at 40 less at 90 (was 0.75 to 1.07 for the pairs measured).

## Player reactions, slice 2, fourth round (2026-11-24)

After the cold review and the dragged-blocker report. Fixes: a rated stalker lets go of a named man when that man leaves, never moves faster than his own top while engaged, and engages no sooner than a better blocker; the ring moves a rated offensive pursuer at most his top speed a key; a scaled bite keeps its break's kind and its plant's start; the settle key and every rating read need an actual number.

S, plays failing (bar): N1 541 (547), N3 46 (54), N4 70 (88), N5 moving 367 (369), N5 engaged 380 (384), N6 settle 324 (334), N6 anchors 1 (1), A3 0 (2), R-C5 2 (7), M5 2 (2), M7 0 (4). R-C8 windows missed: table 0 of 100, awareness 40 0 of 104, 65 0 of 94, 90 0 of 91.

Stalk, 638 WR pairs that engage at 40, 65 and 90: median 1350 / 1250 / 1150 ms (time after the snap), a lower rating earlier on 0. Afterwards (from 1.7 s) the mean velocity difference from his man is 1.64 / 1.20 / 0.70 yd/s and the mean gap 2.42 / 1.75 / 1.47 yd. Bite, 89 linebackers in coverage sets, awareness 40 to 90 by 2: deeper at a higher rating by over 0.02 yd on 0 (before 40, worst 0.45); run fronts 5 of 46, worst 0.035.

Peak speed against the same mark before the build, seeds 1 to 12 (1,174 plays), bar 1.5 x top or 1.10 x his own pre-build peak: marks over, offense / defense / tackler: slice 1 42 / 140 / 2, slice 2b 119 / 193 / 15, now 88 / 193 / 16 (the test file's bar data rounds a few differently). Sum of peaks over 1.5 x: pre-build 8,424, slice 1 8,248, slice 2b 7,859, now 7,698 (offense 1,349 to 1,180, defense 5,872 to 5,321, tackler 1,204 to 1,197). Unnamed offense over 1.5 x: 915, 919, 914, now 873.

Anchor-demanded legs new against slice 1 on S, at shipped / old / [225, -110] with [-80, 180]: 4, 5, 5 new legs, worst 1.44, 1.26, 1.31 x top, over 1.3 x on 2, 0, 1.

## Player reactions, slice 2, fifth round (2026-11-24)

Joseph's approval of 2026-11-24: a rated defender caught in the carrier's lane gets out of it at his own top speed instead of in one key. And, from the review of slice 2c: a rated blocker is backed off at contact distance (1.4 yd) when his man runs at him, at his own top speed or less; and `nat.react.delayMs` of a blocker whose man leaves early is the delay applied (0 when that man leaves before the read).

S, plays failing (bar): N1 540 (547), N3 46 (54), N4 69 (88), N5 moving 367 (369), N5 engaged 380 (384), N6 settle 333 (334), N6 anchors 1 (1), A3 0 (2), R-C5 2 (7), M5 2 (2), M7 0 (4). N6 settle was 324 before the back-off. R-C8 windows missed: 0 at the table, 40, 65 and 90.

Lane, seeds 1 to 12, 7,468 unnamed defenders off the line (leaving out 128 drawn within 1.5 yd of the ball before and after alike, all passes): drawn in the lane after pursuit starts 55 before, 223 now; longest spell p50 / p90 / max 25 / 50 / 225 ms before, 125 / 175 / 225 now; depth (of 2 yd) 0.19 / 0.46 / 1.88 before, 1.01 / 1.62 / 1.94 now; own step deeper on 3 marks before (0.034 yd a key at most), 2 now (0.021). Nearest to the ball 2.5 yd before and now; nobody newly within 1.5 yd. Unnamed defense over 3 x top 630 to 455, over 1.5 x 1,006 to 804; over the per-mark bar 193 to 103 (offense 88, tacklers 16 unchanged). Sum of peaks over 1.5 x: pre-build 8,424, slice 2c 7,698, now 6,368.

Overlap, 631 WR stalks on runs of S, the nearest to his man, drawn: WR at 40 under 0.5 / 1.0 / 1.2 yd 0 / 0 / 1; at 90 0 / 0 / 8; own ratings 0 / 0 / 4; no ratings 0 / 0 / 0. Better blocker over 0.1 yd farther at 1,500 ms: 59 of 666 on outside runs, 81 of 900 on all (85 and 111 before).

`timeline()` per play over S on one machine, one after the other at a load average of 7 to 13: now p50 6.2 to 6.7 ms, slice 1 6.5 to 6.7.

## Player reactions, slice 2, sixth round (2026-11-24)

The review of slice 2d: the back-off put a blocker on his old position's side of his man, so he lost his man's motion across him and stopped dead, and the stored offset was not updated. Now the spot he would have reached is moved straight out from his man, only when it is more than 0.2 yd inside contact distance (`CLEAR_SLACK`), and his offset follows.

631 WR stalks on unnamed men, runs of S, drawn keys: dead stops (over 5 to under 1.5 yd/s within 100 ms, his man within 1.7 yd and over 4 yd/s), own ratings / WR at 40 / WR at 90: slice 2c 3 / 15 / 0, slice 2d 63 / 37 / 39 by this probe, now 3 / 14 / 0. Alternation (3 or more flips of over 1 yd/s): slice 2c 1 / 0 / 0 marks, slice 2d 4 / 3 / 0, now 0 / 0 / 0. Gap under 1.0 yd: slice 2c 13 / 37 / 2, slice 2d 0 / 0 / 0, now 0 / 1 / 0 (0.94). Seeds 7 to 12 (635 stalks, not used to choose the slack): dead stops 2c 4 / 16 / 0, 2d 55 / 35 / 50, now 4 / 13 / 0; gap under 1.0 11 / 38 / 4, 0 / 1 / 0, now 0 / 1 / 0.

S, plays failing (bar): N1 540 (547), N3 46 (54), N4 71 (88), N5 moving 366 (369), N5 engaged 380 (384), N6 settle 324 (334, was 333), N6 anchors 1 (1), A3 0 (2), R-C5 2 (7), M5 2 (2), M7 0 (4). R-C8 windows missed: 0 at the table, 40, 65 and 90.

Version 6 (2026-11-24): the 0.2 yd slack is now `ratings.scrimmage.stalk.clearYards` 1.2 in `motion.json`, with every drawn key identical to slice 2e (every play of seeds 1 to 12, kicks included, rated and unrated, natural and raw, and the fixtures unrated).
