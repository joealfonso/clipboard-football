# M2: a tackler who can get there

Status: ready for build. Approved by Joseph 2026-11-16 ("Engine + timeline"), including the schema change to `data/engine/participants.json` and to the engine's credit input (`CreditInput`, packages/sim/src/engine/participants.ts:17). Logged in docs/DECISIONS.md, "Plausible tackler".

## Goal

The engine names a tackler who lined up where the ball went, and the animation shows him getting there no faster than his own top speed, without moving the dead spot. For Joseph and players like him watching the all-22 view at 1x.

The user's report: a defender shoots in one straight line clear across the field.

## Cause (debugger, confirmed)

- The engine draws the tackler from position and slot weights only (participants.ts:170, 206, 223, 247; shares in participants.json `roles.tackler`). It doesn't know where anyone lines up or where the ball goes. Among bad pass plays, 319 of 484 tacklers lined up on the opposite half of the field from the catch.
- The timeline lets the named tackler leave his unnamed track only at `plan.read` (timeline.ts:1407). On a completion that is the catch (1168), and on an interception it is also the catch (1113). `tacklerRun` (3006-3010) then drives him to the ball by `liveEnd` with no speed cap. The converge and fact branches do the same over the last `convergeMs` (2268-2271, 2303-2310). The kick-return branches do the same at 1894 and 1904.
- The whistle comes from the carrier alone: the carry's slack (719-720), or the catch plus `convergeMs` for a catch at the dead spot (1178). So the tackler's speed is distance / (whistle − read), with no bound.
- Size (30 games): the tackler peaks above 1.15 × top on 1,187 of 2,374 plays with a tackler, above 2× on 604, and the worst is about 26×. By kind: completions 508/647, runs 480/1340, punts 39/44, kickoffs 131/289, scrambles 26/48.
- Repro: game seed 1, default league seed, play 97. A 1 yd completion. CB1 is at x ≈ 5 and runs to x 46.3 between 1482 and 1800 ms.
- Test hole: N1 (docs/specs/m2-play-calling-and-motion.md:1065, test at packages/app/test/natural-motion.spec.test.ts:76-85) allows 1.25 × the required mean on "anchor-demanded" legs. The bookkeeping (timeline.ts:3171-3186) marks any leg whose mean is above 1.15 × top as demanded, so any speed passes. The 1,000-play N1 to N5 heavy sweep (motion spec :1073) was never built.
- A display-only fix fails. Starting the run at the throw fixes only 56 of the 484. The rest need plays about 1.2 s longer (median). Drawing a different defender making the tackle would contradict the box score credit (packages/sim/src/loop/player-box.ts:106-169).

## Non-goals

- No outcome change. Yards, class, clock, dead spot, turnovers and the why line stay exactly as they are for every seed.
- Out of scope: the pass breakup "breaker" (the app picks him by geometry, timeline.ts:2763-2793, and he is never credited), the sacker (already gated by R-C30), and the fumble forcer and recoverers (the forcer isn't drawn as a mark, and the recoverer has his own timing in `recover()`). There is no "assist" role: the rule is one tackler per play (docs/specs/m2-engine-and-game-loop.md, decision 9).
- No fix for the interceptor's own run. It is reported only (Open 2).
- No fix for the known fixture failures or the ring pops (Known issues).
- No new UI, no new menu, no change to the play clock.

## Terms

- **Lateral x**: yards from the middle of the field, in the offense's frame (the frame timeline.ts and art.ts `alignment()` use, art.ts:59-70). Negative is the offense's left.
- **Alignment**: a slot's [x, depth] at the set. data/ui/templates.json `offense`, `defense` (with `presetAlignment` overrides), `kick` and `returnUnits`. Slot `CB1` is `onField.defense.CB[0]` (packages/app/src/engine/types.ts:120). The engine's slot order is the same list.
- **Ball point**: where the timeline puts the ball for the play.
  - Completion: the catch point from `onRoute` (timeline.ts:1046-1066, 1146-1159). In simulated games the engine sends no `passLocation` or `airYards`, so this is the target's template track at the class depth.
  - Run: the gap. insideRun, qbSneak and scramble are in the middle. outsideRun is the strong side at 9 yd (timeline.ts:892, 932). The strong side comes from `receiverRoles` on the formation (art.ts:130-141), because the engine sends no `runLocation` (timeline.ts:546).
  - Interception: the middle at the class depth (timeline.ts:1100-1102).
  - Kickoff and punt return: the landing x, which is the middle (timeline.ts:1278-1282).
- **Departure**: the time the named tackler leaves his unnamed track (NM2).
- **The R-C9 read**: the throw on passes and the handoff on handoff runs (motion spec :759). On a sneak or scramble it is the `plan.read` the timeline already uses (timeline.ts:904, 909).

## Milestone 0: baseline sweep, report only

The harness exists before anything changes, so every later gate is measured against the same games.

| # | Criterion | How it fails |
|---|---|---|
| 0.1 | A heavy test (`pnpm test:heavy`, under test/game/) sims game seeds 1 to 1,000 on league seed 2026 and builds every live play's timeline at 1x. For each play with a tackler it records: the kind (run, completion, scramble, sack-fumble, interception return, kickoff, punt, two-point); the tackler's departure; his peak speed from departure to `liveEnd` and his peak over the whole play, both as × his own top (top / k, the N1 measure); the leg's required mean; the whistle (raw ms); and whether the live time was clamped. | Missing kind, field or seed range. |
| 0.2 | The same run records the credits: the share of tackles by position, split into runs (inside and outside separately), completions and kick coverage; the share of completion tacklers whose alignment x is on the other side of the middle from the ball point (both \|x\| ≥ 4 yd); and the interceptor's peak × top. | Missing. |
| 0.3 | The numbers go into docs/PERF.md under "Tackler reach, baseline", with the commit. No gate. | Not reported. |

Perf: R-C7 already does a 1,000-game timeline run (test/game/routes-pace.heavy.test.ts). This sweep may share that run.

## Milestone 1: the engine credits where the ball goes

The tackler-type roles are drawn with a designed weight that falls with the lateral distance from the player's alignment to the ball point. The roles are `tackler`, `returnTackler` and `coverageTackler`. Everything else about crediting stays as it is: the class shares, the slot weights, the tilts, the standout boost and the credit stream.

**Locked:**
- The weights live in participants.json. Code holds no distance constant. The new keys are validated by the participants schema, and a malformed value fails loading with the file named.
- The engine reads the same alignment numbers the animation draws. The approved schema change keeps them in participants.json, with a test that proves they match templates.json (1.4). Moving alignment into one file both packages read would change templates.json too, which is not approved (Open 4).
- The ball point the engine uses is the timeline's, for each kind in Terms. For completions it is a designed table keyed by formation, pass leaf and target slot, recomputed from templates.json by the check in 1.5.
- `CreditInput` gains what the draw needs: the offense formation and the defense call or return unit. The draw stays in `credit()`, which still runs after the outcome is final.
- RNG: every draw stays on the per-play credit stream (participants.ts:43-52), which never advances the outcome stream. The number and order of credit draws may change, and so may the participants for a given seed. Outcomes may not.

| # | Criterion | How it fails |
|---|---|---|
| 1.1 | **Outcomes unchanged.** B2 holds: every in-sample outcome digest equals the baseline exactly. The F3 calibration slice (`pnpm test:heavy`) and `scripts/game/calibrate.ts --target insample` pass with unchanged results. The CLI golden changes only in its data-hash line and the credited names. | Any digest or calibration number changes. |
| 1.2 | **Deterministic.** B7 holds: the same seed gives the same participants twice over 10,000 games. Swapping the credit stream leaves the digests unchanged. | Any difference. |
| 1.3 | **Roles still match the result.** B1 holds over the C1 states. Every credited id is on the field, for the right side and role. | A missing or impossible role. |
| 1.4 | **Alignment agrees.** For every defense package × preset, kick unit, return unit and offense formation, the engine's x for every slot equals art.ts `alignment()` from templates.json, before line spacing, within 1e-9. The test reads both files. | Any slot differs, or a slot is missing on either side. |
| 1.5 | **Ball point agrees.** For runs: the strong side the engine uses for each formation equals `receiverRoles(...).strong`. For completions, over the Milestone 0 games: the timeline's catch x is within 8 yd of the engine's ball x on at least 90% of completions, and the worst 20 are listed. | Wrong strong side, or under 90%. |
| 1.6 | **Weights go the right way.** In a unit test with a fixed unit and class, moving the ball point toward a defender's alignment never lowers his share, and the share is the same for mirrored alignments with a mirrored ball. | A share rising as the ball moves away, or a mirror asymmetry. |
| 1.7 | **Far tacklers get rare.** Over the same 1,000 games, the share of completion tacklers aligned on the other side of the middle (0.2's measure) is at most one third of the Milestone 0 share. | Above one third. |
| 1.8 | **Credit stays realistic.** Against the Milestone 0 shares, by position (DL, LB, CB, S on defense; the coverage positions on kicks): each share moves by at most 5 points within runs, within completions and within kick coverage.<br>- CBs still tackle on outside throws: on completions whose ball point has \|x\| ≥ 12, the CB share is at least the Milestone 0 CB share of all completions.<br>- DL tackle less on outside runs: their share on outsideRun is below their share on insideRun.<br>- Safeties keep the long ones: the S share on c20 stays at least 40%. | Any bound missed. |
| 1.9 | **Standouts unchanged in kind.** The F standout checks (DECISIONS.md, "Standout tolerances pre-registered") pass. When a boosted elite is also far from the ball, the boost and the distance weight multiply, and neither replaces the other. | An F check fails, or the boost is dropped. |
| 1.10 | **Box score.** The player box tests pass. Total tackles per team per game are unchanged (the set of plays with a tackler doesn't change). | A test fails, or the totals move. |
| 1.11 | **Docs.** MODEL.md "Who made the play" describes the distance weight and marks it **designed**, not fitted. DECISIONS.md records the values. GAME_REPORT or PERF.md reports 1.7 and 1.8. | Missing, or called data-derived. |

Shippable alone: credits get plausible and nothing else changes. The animation still has the speed bug, but for fewer plays.

## Milestone 2: the timeline fits the tackler's run

**Locked:**
- **Departure.** The named tackler departs at the R-C9 read: the throw on completions, two-point passes and interceptions, and the handoff or `plan.read` on runs, sneaks and scrambles. A tackler with his own fact or converge legs departs when the last of them ends, or at the read, whichever is later. On kickoffs and punts the coverage tackler departs at the kick's `plan.read`, the landing. Only the tackler's departure moves. `plan.read` and everyone else's pursuit start stay as they are.
- **Whistle.** `plan.whistle` is extended, never shortened, so that the tackler's run from departure to the ball fits within his own top speed with his own speed-up and stop. The engineer picks the formula. 2.2 is the test.
- **The facts don't move** (decision 10). The ball ends at the dead spot at the whistle, the carrier holds it, and the tackler is at the ball. The tackler is never capped so that he misses the ball.
- **The carrier fills the time.** His path's points are unchanged and his carry is re-timed to end at the new whistle. He is never faster than before. A catch at the dead spot holds there until the whistle.
- **Pre-read frames are unchanged** on unclamped plays (R-C9, R-C20, NM2).

| # | Criterion | How it fails |
|---|---|---|
| 2.1 | **Fixture: seed 1, play 97.** The event is captured as it is today (CB1 credited, x ≈ 5, 1 yd completion) and added to ALL_FIXTURES as `FAR_TACKLER`, frozen, so Milestone 1 can't change it. Its timeline: CB1 departs at the throw, peaks at no more than 1.15 × his top from departure to `liveEnd`, and is at the ball at `liveEnd` within 1e-6 yd. The ball is at the dead spot. | Faster than 1.15 × top, departs at the catch, or misses the ball. |
| 2.2 | **N1-T, the tackler is never demanded (fixtures).** For every fixture with a tackler, from his departure to `liveEnd`: v ≤ 1.15 × top at every key, with no anchor-demanded exemption. His departure-to-whistle leg isn't listed as demanded. A new `it` block. | Any key over. |
| 2.3 | **N1-cap, the exemption has a ceiling (fixtures).** On any anchor-demanded leg of any mark, v ≤ 1.5 × top, as well as the existing 1.25 × the leg's mean. A new `it` block. Why 1.5: it is the motion spec's existing allowance for demanded legs (N2, ×1.5), so no new constant is invented. A CB at 1.5 × 10.5 = 15.75 yd/s already reads as a pop at 13.3 px/yd. | A demanded leg over 1.5 × top. |
| 2.4 | **Heavy gate: tackler reach.** Over the Milestone 0 games with Milestone 1 crediting, the tackler's peak from departure to `liveEnd` is ≤ 1.15 × top on at least 95% of tackler plays overall, and in every kind with 30 or more such plays. It is ≤ 1.5 × top on 100% of them, with any exception listed by seed and play. Shares by kind go in PERF.md. | Under 95% overall or in a kind, or any play over 1.5×. |
| 2.5 | **Heavy gate: plays don't get absurdly long.** Extension = new whistle − the whistle without this change (raw ms), on tackler plays. Starting gates (proposed, Open 1): median ≤ 150 ms, p95 ≤ 800 ms, max ≤ 3,000 ms. The share of plays clamped at `live.maxMs` rises by at most 1 point. All of it is reported by kind in PERF.md. | Any bound missed. |
| 2.6 | **Facts and no-leak hold.** N6's anchors stay exact on every fixture, `FAR_TACKLER` included. R-C7, R-C9, R-C19, R-C20 and R-C30 pass unchanged. R-C12's live range holds. | A moved anchor, a leak, or out of range. |
| 2.7 | **The carrier is never sped up.** On every fixture and every play in the sweep, the carrier's peak speed during his carry is at most what it was without this change (+0.05 yd/s), and his path's points are identical. | A faster carrier or a changed path. |
| 2.8 | **Budget.** R-C15 holds: `timeline()` takes 20 ms or less, median and p95 over 1,000 plays, in PERF.md. | Over budget. |
| 2.9 | **The interceptor is reported.** The interceptor's peak × top, as in 0.2, goes in PERF.md. No gate (Open 2). | Not reported. |

Playtest gate **G6**: Joseph watches at least 20 plays at 1x, including play 97, outside throws, outside runs, a punt and a kickoff return. He says whether anyone still crosses the field too fast, and whether the stretched carries (a carrier slowing, or a catch held at the spot while the tackler arrives) read well. Each named moment goes in the playtest log.

## Edge cases that can happen

| Case | Behaviour |
|---|---|
| Catch exactly at the dead spot (play 97's shape) | The receiver holds the ball at the spot until the tackler arrives (timeline.ts:1171-1178, extended). |
| Live time clamped at `live.maxMs` | Uniform scaling as today. Speeds are measured against top / k, so 2.4 still applies. R-C9 doesn't apply to clamped plays, which is why 2.5 limits how many become clamped. |
| Fumble, recovered by the defense, with a `returnTackler` | The same rule. The whistle bound counts from his departure to the final ball. |
| Tackler is also the sacker (SACK fixture) | No change. The sacker stays on the QB (timeline.ts:2311-2314). |
| Interception return | The return tackler departs at the throw. Open 3 covers the possible tell. |
| Kickoff or punt return with a cut | The cut side stays the timeline's choice. The engine's ball point is the landing x, and the whistle bound covers the cut. |
| Touchdown, out of bounds, touchback, fair catch | No tackler, so nothing changes. |
| Two-point run or pass | The same as a run or a completion. |
| A fixture event hand-built with a tackler the engine would rarely pick now | The timeline must still draw him within 2.2. Milestone 2 doesn't depend on Milestone 1. |
| Unknown formation, package or slot in the engine's alignment table | Fails loading with participants.json named (1.4 keeps the shipped data complete). |

## Dependencies and sequencing

- Milestone 0 first, so the baseline is measured on today's credits.
- Milestone 1 before Milestone 2's gate run. 2.4 and 2.5 are measured on Milestone 1 credits, and 2.5's bounds assume the engine has already cut the far tacklers. Milestone 2's code and fixture tests (2.1 to 2.3) can be built in parallel.
- Amends docs/specs/m2-play-calling-and-motion.md where they conflict:
  - R-C14 ("no diff under packages/sim or data/engine") doesn't apply to this change.
  - NM2's "the read for the tackler" becomes the R-C9 read as defined here.
  - N1 gains N1-T and N1-cap.
  - The "1,000-play N1 to N5 sweep" (:1073) is partly delivered by 0.1 and 2.4, for the tackler. The other marks stay report-only.
- Run playtester after Milestone 2 (sim and balance change), with G6.

## Known issues, not fixed here

- **Fixtures already failing N1, N3, N4, N5 and N6** in the working tree, including COMPLETE CB2 at 13.95 against 11.77 and INCOMPLETE OL2 at 9.21 against 5.75. The existing N1 `it` block stays as it is, still failing, and isn't loosened or allow-listed. The new checks are separate `it` blocks, so their pass or fail shows on its own.
  - Collision: on the COMPLETE fixture, CB2 **is** the credited tackler (packages/app/test/fixtures.ts:70). N1-T covers him, so that failure is likely this bug. If N1-T passes and the old N1 still flags CB2, the remaining key is outside his departure window and goes to debugger, not into an exemption.
  - INCOMPLETE OL2 has no tackler role and isn't touched by N1-T or 2.4. N1-cap only applies on anchor-demanded legs. If OL2's pop is on such a leg, N1-cap fails too, which is correct, since it is a real pop.
- **Short 1 to 2 yd single-key pops on non-tacklers near the ball** (the ring or corridor push). They don't reach 2.4, which measures only the tackler and only from his departure. Before his departure he is his unnamed self (R-C9), so a pre-departure ring pop on him shows in his whole-play peak, which is reported, not gated. They reach N1-cap only if they fall on a demanded leg, where they should fail.

## Locked and likely to change

Locked:
- Facts never move.
- Weights in data, designed.
- Credit stream only, outcomes unchanged.
- The engine and the animation share the alignment numbers, test-enforced.
- The departure at the R-C9 read.
- The whistle can only grow.
- The 1.15 × top tackler bound with no exemption.
- The 1.5 × top ceiling on demanded legs.

Likely to change:
- The distance-weight values and their form.
- The 2.5 extension bounds.
- 1.5's 8 yd and 90%, and 1.7's one third.
- How the carrier fills the extra time (after G6).

## Open questions

1. **Extension bounds (Joseph).** Median 150 ms, p95 800 ms, max 3,000 ms, and +1 point clamped are proposed starting gates. They are not measured: today's distribution exists only for the display-only variant (about 1.2 s median on the affected plays). Confirm them, or set them after Milestone 1's numbers are in.
2. **The interceptor (Joseph).** Every interception is drawn in the middle of the field (timeline.ts:1100-1102). An interceptor weighted by distance to that point would move interceptions from CBs to safeties and LBs, which isn't realistic. Not weighting him leaves CBs converging across the field during the ball's flight. Fixing it means drawing the interception on the target's route, as completions are, which is a display change. Reported by 2.9 only, until Joseph decides.
3. **The return tackler on interceptions departs at the throw.** Per the brief, but an offensive player turning toward the pick spot while the ball is in the air hints at the interception before it happens. The alternative is departing at the interception, with a longer whistle. Joseph's call after G6.
4. **One alignment file.** The alignment numbers are kept in two files with an equality test (1.4). Moving them to one file that the sim and the app both read is cleaner, but it is a schema change to templates.json and needs approval.
5. **A primary source for the speeds.** 1.15 × and 1.5 × are test constants, as in the motion spec. No primary source for NFL top speed or acceleration is cited [gap].
6. **Real tackle shares.** 1.8 compares against today's designed shares, not real data. A report against nflverse tackle credits by position (like B6) would need a pipeline step. Not in scope unless Joseph asks.
