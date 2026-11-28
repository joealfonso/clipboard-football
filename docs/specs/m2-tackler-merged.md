# M2: the tackler, merged rule

Status: 2026-11-24. The scrimmage rule is settled (Joseph's choices (a) and (b), and his answers in section 5). Kick returns (TM10) are not buildable yet: K1 is answered, K3 and K4 are open and block the kick step, K2 is open and blocks slice 5's part (section 5). Everything else is quoted from one of the two specs, a lead ruling, or marked open. Owner: Joseph. Author: spec-writer.

Joins docs/specs/m2-plausible-tackler.md ("MPT", approved 2026-11-16) and PR6 of docs/specs/m2-player-reactions.md ("MPR", approved 2026-11-23). Neither file is edited. For the engine's named tackler, where this file and either of them differ, this file holds. Where it says nothing, both stand. Designed, display only. I ran no code: counts are quoted, and unmeasured things are marked [gap]. MPT's line numbers predate slices 1 and 2, so this file names functions.

## Goal and user

Goal: the engine's tackler leaves at a believable moment set by his own awareness, gets to the ball no faster than he can run, and the play lasts as long as that takes. For Joseph and players like him watching the all-22 view at 1x.

**Joseph, 2026-11-24, question dialog, as relayed by the lead:**
- (a) Order: MPR slice 2 finishes, then the MPT session builds in timeline.ts and motion.ts, then MPR slices 3 to 5 on top.
- (b) Departure, "Theirs, plus awareness": the named tackler leaves at the throw (completions, two-point passes, interceptions) or the handoff (runs; on sneaks and scrambles the time MPT uses) plus his awareness delay, bounded by his own top speed, and the play is lengthened to fit. PR6's fallback, that he leaves at the read when an anchor demands it, is dropped.
- (c) Later the same day: yes to Opens 1 to 5, 7 and 8, and on kicks "Cover in the air", against the recommendation (section 5).
- (d) Later the same day, in chat: "Yes, lengthen a little" (K1).

## Non-goals

- MPT's non-goals stand: no outcome, credit, box score, play clock or why-line change from the timeline half. The interceptor, the break-up defender, the sacker and the fumble forcer and recoverers keep their own rules. The interceptor and the break-up defender keep PR9's min(`airMs`, S) in slice 3, because their anchor, the arrival, may not move.
- `plan.read` and every other mark's pursuit start do not move (MPT, "Only the tackler's departure moves"). On kicks TM10 changes the coverage men's run in the air, not `plan.read`.
- No new key in `motion.json`, so no schema change. Fixing the red standing checks stays out of scope.

## 1. The merged rule

**TM1. The event E.** Screen times, after scaling by k.

| Play | E |
|---|---|
| Completion, two-point pass, interception | The throw, when the ball leaves the QB. Not `plan.read`, which is the catch |
| Run, two-point run, with a handoff | The handoff |
| Sneak, scramble | `plan.read`, as MPT says ("On a sneak or scramble it is the `plan.read` the timeline already uses") |
| Kickoff or punt return | `plan.read`, the landing (MPT), after TM10's run in the air. No search (TM3). The whistle is extended only by the time he is short after that run (TM6, K1) |
| Return of a fumble lost on a run or a catch | The event of the play itself (MPT, "The same rule"). Strip-sack: today's `plan.read`, the drop end (Joseph, Open 5) |

**TM2. The departure.** D = E + d. d is PR3's `readMs` with its floor last, his NM4 spread and his play variation included. It is added to E, never to `plan.read`, and it is screen ms, not scaled by k (PR13).
- A DL tackler's `readMs` is his release value, max(0, `read.releaseMs` band + variation). It is added to E, as PR6 adds it to the read today, not to the line's release.
- No awareness rating, or any kick: d = 0, so he leaves at E. Kicks from slice 5: TM10.
- **From slice 3, on passes** (Joseph, Open 2): for a rated, non-rushing LB, CB or S, d is his `airMs` (PR9, `manExtraMs` included), not `readMs`. DL, rushing LBs and offensive return tacklers keep `readMs`. Runs keep `readMs`.
- D is never before his own start + 25 ms.

**TM3. No search.** The 25 ms candidate grid, S, the fallback to 0, the `convergeMs` refusal and the settle guard no longer choose a tackler's departure. Where one of them would have moved him earlier, the whistle moves later (TM6).

**TM4. The ring rule, carried over from E** (Joseph, Open 3). He departs no later than the key before the ring would first push his unnamed self at or after E, and never before E. A self the ring already holds off at E leaves at E. It is the only thing left that makes him earlier than E + d. It is not an anchor demand: it keeps Joseph's Settled 9 (no tackler thrown off the ball). On runs E is today's read, so it binds as now. On passes it is read from the throw, and D often falls before the catch, where the push was. How often it still binds: [gap].

**TM5. The 50 ms exception, clipped at E.** A rated tackler may differ from his unnamed self only in the last 50 ms before D, and never before E. Why: Settled 10 permits a difference before the read, but MPT locks "Pre-read frames are unchanged" and its 2.6 has R-C9 passing unchanged. Everyone with `readMs` 80 or more is clear of E. A DL with `readMs` under 50, or a TM4 departure, would otherwise differ before the throw or the handoff, which R-C9 forbids. An unrated tackler departing exactly at E is held to the same: R-C9 has no tolerance, and smoothing reached about 20 ms back once before (DECISIONS.md, QD4).

**TM6. Top speed and the whistle (MPT, kept).** From D to `liveEnd` his drawn speed is at most 1.15 x his own top / k. `plan.whistle` is extended, never shortened, only as far as that needs, with his own speed-up and stop. Places never move: the dead spot (x and y), the catch, the pick-up. No anchor up to and including the catch moves in time on an unclamped play. What moves: the whistle, the time the ball reaches the dead spot, the end of the holder's hold, and labels, settle and holds timed to the whistle. The carrier's path points are unchanged and his carry is re-timed, never faster. On a sneak or scramble his carry starts before E, so it is re-timed from E on only. A catch at the dead spot holds there.

**TM7. Own legs.** A tackler with fact or converge legs departs at the later of E and the end of the last one, with no delay added (PR6, "departs as today"; MPT, "whichever is later"). The cut at `liveEnd` - `convergeMs` no longer truncates his leg: the whistle extends. The sacker who is also the tackler: no change (both specs).

**TM8. The record.** `react.delayMs` is D - E (today it is counted from `plan.read`). `pursueAt` is D. So E = `pursueAt` - `delayMs`. `delayMs` equals d (`readMs`, or `airMs` by TM2) for a rated plain tackler unless TM4 bound him, and 0 for TM7, unrated and pre-slice-5 kick tacklers. `nat.reactionMs` is unchanged.

**TM9. Off the catch point until the ball is there** (Joseph, Open 8). From D to the arrival (the catch, or the pick), the tackler keeps 2.5 yd from the catch point, rated or not, and on an interception the return tackler too. Then he closes. If that costs time, the whistle takes it (TM6). One already inside 2.5 yd at D (a corner trailing the receiver): lead item 4.

**TM10. Cover in the air** (Joseph, 2026-11-24; kickoffs and punts only, designed). While a kick is in the air, the kicking team's coverage men, the named tackler included, run toward the landing point at their own top speed. Not settled in full: K2 to K4.
- **Who.** Side O, every mark but the kicker, the punter and anyone else with fact legs of his own. Punt-team linemen: K3.
- **When.** From the kick (the kickoff's kick time, the punt's `kickT`) to the landing. Before the kick they run their lanes as today. At the landing each does what he does today, pursuing on a punt and steering for his contain point on a kickoff return (KR9), and the tackler leaves for the dead spot (E). He is never sent to the dead spot before the landing.
- **No tell.** The run reads only the landing point, the calls, ids and ratings. So the tackler runs exactly as he would unnamed until the landing, and the rule applies whatever the result: on every kickoff that is not onside and every punt that is not blocked, since a fair catch and a return can share a landing point.
- **Off the ball.** No coverage man is within 2.5 yd of the landing point before the ball lands.
- **Unchanged.** The kick time, the hang, the landing time and place, the returner to the catch, the engine's dead spot (y), the outcome, and every label's text. At k = 1 the times up to the landing too. The dead spot's x follows the returner's cut, and the cut follows the blocks (KR7), so different coverage tracks can send the cut the other way. That is a drawn choice by KR7's own rule, and it is listed (TM-C16).
- **Lengthen a little** (Joseph, K1). On a return that ends in a tackle, the whistle is extended by only the time the tackler is short after the run in the air, by TM6: 1.15 x his own top from the landing, path points unchanged, the returner's carry re-timed and never faster, no extra wait at the landing. Kickoffs and punts with no tackler are not lengthened.
- **Ratings.** Until slice 5 only top speed and acceleration differ, as today. From slice 5 the awareness delay is added. My reading of where, K2: each man turns for the landing at the kick + his `readMs`. PR18 then still applies at the landing.

| Play | What changes |
|---|---|
| Kickoff or punt return | All of it. |
| Return touchdown | The same run in the air. No tackler. |
| Fair catch, touchback, short kickoff, downed or muffed punt | The same run to the landing, then today's 300 ms. Label, holder and whistle unchanged. |
| Out of bounds | They run toward the landing, which is on the sideline, and stay inside `sidelineMarginYards`. |
| Onside kick, blocked punt, field goal, extra point, no play | Nothing. |

**What TM10 cannot do, by arithmetic (not measured).** Coverage men already run through the hang, not wait: the `cover` routes send LB, S, CB and TE 20 to 24 yd straight ahead at `routePace` 0.9, and the hang is at most 1,500 ms. So the rule gains about a tenth of the run plus a better angle, about 1 to 3 yd, 0.1 to 0.4 s. A kickoff LB is about 11 yd down at the landing. On a 45 yd punt returned 8, an LB is about 26 yd from the dead spot at the landing (2.7 s at his top, without his stop) and the return takes about 1.3 s. So on most punts and on short kickoff returns "at the ball at the whistle", "no faster than 1.15 x his top" and "no lengthening" cannot all hold. Today the speed gives. By K1 the length gives.

**Confirming measure, reported by the MPT session** (punts and kickoffs, 1,000 games, HEAD credits; not re-run by me): tacklers are a median 32 yd from the dead spot at the landing. Whether that is today's drawing or with TM10's run was not relayed: [gap]. At the speeds in motion.json (9.5 to 10.5 yd/s) 32 yd is 3.0 to 3.4 s of running, without his start and stop. So "a little" is a rule about waiting, not a promise of a small number: the size after TM10's run is [gap], measured before 5k is accepted (TM-C16).

**Measured costs, reported by the MPT session** (1,000 games on the credits at HEAD, a straight-run estimate, no awareness delay; not re-run by me). Waiting for the landing and lengthening (not what is built) would cost, in seconds:

| Kind | Median | p95 | Max |
|---|---|---|---|
| Punts | 2.4 | 4.9 | 13.2 |
| Kickoffs | 0.3 | 2.6 | 6.3 |
| Interception returns (lengthening stays in) | 0.4 | 5.3 | not given |

MPT's 2.5 proposes 0.15 / 0.8 / 3.0. Interception returns alone are over it at the median and p95 before any delay (Open 7).

### What it supersedes in MPR

For the tackler only, but for the kick rows.

| Where | Quoted | Now |
|---|---|---|
| PR6 | "leaves his unnamed track at the read + min(his `readMs`, S)" through "If no delay qualifies, S is 0 and he leaves at the read exactly as today." | TM2, TM3, TM6 |
| PR6 | "So a slow-reacting tackler who is far from the play is drawn leaving early because the engine says he made the tackle." | He leaves late and the play lasts longer |
| PR6 as built | "The candidates for his delay are ...", "A candidate qualifies when ...", "One guard: he never departs after his unnamed self starts slowing for the whistle", "With less than `convergeMs` + 25 ms between the read and the whistle, S is 0." | Dropped (TM3). He slows with that self if D falls after its settle begins, as built today |
| PR6 round 2 | "A delay of 0 is the fallback and is never tested." | No fallback |
| PR6 round 3 | "departs no later than the key before the ring would first push his unnamed self after the read, and never before the read" | The same, from E (TM4) |
| PR6, slice 2 | "a rated tackler may differ from his unnamed self in the last 50 ms before he departs, which is before the read when he leaves at it or less than 50 ms after it" | Never before E (TM5) |
| PR12 | "The exceptions, each with its bound, are listed in PR-C9 (b)" | One more exception, in the PR-C9 (b) row. PR12's engine facts all stand |
| PR15 | `delayMs`: "at most that for a named one (PR6)" | TM8 |
| PR-C7 | "When `delayMs` < `readMs` - 25, he left as late as the anchor allowed", with (a), (b), (c) | Dropped. (d) and (e) stay as the only reasons to be early |
| PR-C7 | "Up to 50 ms before his departure (the read + `delayMs`)" | E + `delayMs`, with the whistle held (TM-C3) |
| PR-C8 | "a rated tackler's drawn keys in the last 50 ms before he departs (PR6). R-C7 and R-C9 read him with that exception too." | R-C9 needs no exception |
| PR-C9 (b) | "every anchor's time and the handoff time on runs are equal" and "Runs have no exception in any slice." | Exception (4): on a play with a tackler, the whistle and every anchor time from the start of the carry on may move. On an unclamped play the snap, throw, handoff and catch times are equal. On a play clamped in either build k moves, so screen times do too. Places stay equal as PR-C9 says |
| PR-C1, PR1 | "With no ratings the Timeline is today's, key for key." | "Today's" is the tree after the MPT session (section 3). The drawing with no ratings changes on plays with a tackler |
| Superseded 4 | "Now the read plus his applied delay (PR6)" | E plus his applied delay |
| PR17 | "PR1 holds on every kick: with no ratings passed, every kick Timeline is today's, key for key. The KR8 baseline file ... stays untouched." | Contradicted by TM10, which changes unrated kickoffs and punts. Not amended by Joseph in so many words (K4) |
| PR18 | "he leaves his lane at the read + his `readMs`" | His lane becomes the run to the landing. The delay at the landing stays, and from slice 5 one at the kick is added (K2) |
| PR19 | The wall | Unchanged. Its blocks are planned on new coverage tracks, so pairs and contact times move. KR5 is the risk |
| PR20 | "he leaves at the catch + min(his `readMs`, S)" | His `readMs` is spent at the kick, in the air, not after the catch, so he leaves at the landing. S has no use (K2) |
| PR21 | The cut | Its pace and radius stand. Its side may change through the blocks |
| PR22 | "punt-team linemen stay engaged as today" | K3 |
| PR-C1, PR-C16 | "every kick play gives its baseline digest too"; "`kr8-baseline.json` is untouched" | After the kick step "today's" is that tree, for kickoffs (not onside) and punts (not blocked). The second half: K4 |
| PR-C19 | "Every other mark's keys are identical from the snap to the catch." | Stands. From slice 5 his own run in the air may differ with his awareness |

Kept: "Until he departs he is his unnamed self (NM2)", PR-C7's "Not thrown off the ball" and reversal checks, PR2 for d on kicks through slice 4.

### What changes in MPT

| Where | Quoted | Now |
|---|---|---|
| M2, Departure | "The named tackler departs at the R-C9 read" | ... plus d (TM2) |
| M2, Departure | "A tackler with his own fact or converge legs departs when the last of them ends, or at the read, whichever is later." | Unchanged, no d |
| Locked | "The departure at the R-C9 read." | The departure at E + d |
| Whistle | "the tackler's run from departure to the ball fits within his own top speed" | Unchanged. Departure is D, so the awareness delay lengthens plays too. MPT's 2.5 bounds were proposed without it (Open 7) |
| 2.1 | "CB1 departs at the throw" | Built with no ratings as written. With the test's rating table, at the throw + his `readMs` |
| 2.5, 2.7 | "without this change" | Needs a test hook that turns the extension off, or sets the raw whistle (a `TimelineCtx` field like `forceMiss`, engineer's name) |
| Edge cases | "The return tackler departs at the throw. Open 3 covers the possible tell." | At the throw + d. Open 3 is closed (Joseph, Open 4), looked at again at G6 |
| M2, Departure | "On kickoffs and punts the coverage tackler departs at the kick's `plan.read`, the landing." | Stands, after TM10's run in the air |
| Whistle | "`plan.whistle` is extended" | Kick returns too, after TM10's run (K1) |
| 2.4, 2.5 | "in every kind with 30 or more such plays" | 2.4 gates the kick kinds from 5k. Their extensions are reported until Joseph sets bounds (Open 7) |
| Amends, NM2 | "'the read for the tackler' becomes the R-C9 read as defined here" | E + d |

## 2. Leak check

**What the motion spec forbids.** R9: "Before the read, nothing in the defense depends on the target, the catch point or the result". R-C9 measures "from the snap to the read (the throw, or the handoff; not `plan.read`)". R-C20: "identical frames, all 22 marks and the ball, at every t up to the throw". R-C7 is about the target. NM2: result anchors "may only be looked ahead to from keys at or after the departure".

**Verdict on the criteria: no violation, and no exception needed, given TM5.** D is never before E, and E is R-C9's read. Without TM5 a DL with a short `readMs` would break R-C9 on passes and on runs. NM2's words "the read for the tackler" are already amended by MPT, approved.

**Verdict on what a viewer sees: there is a tell, and the criteria do not measure it.**
- Today the flight already tells the result: on an incompletion unnamed defenders break from the throw plus their reaction, on a completion they wait for the catch. PR9 names this.
- Before slice 3 the merged rule adds a sharper one. On a completion, one man leaves his coverage in the air, heading for the dead spot, while every other unnamed defender waits for the catch. He shows that it will be caught, who tackles, and roughly where.
- Slice 3's break makes the **departure** unremarkable for a rated, non-rushing LB, CB or S. It does not hide the **heading** (the dead spot, not the ball). It hides the **time** only because d becomes `airMs` then (Open 2, yes).
- Slice 3 covers none of these tacklers: a DL or a rushing LB (PR9 leaves them out, and a DL tackler leaves before the line's release, which is 400 ms after the throw), an offensive player on an interception or fumble return, anyone unrated.
- A tackler arriving at the catch point before the ball would be one more. TM9 stops it.
- On kicks TM10 adds no tell in the air: every coverage man runs to the landing. At the landing the tackler leaves for the dead spot, as today.
- On runs there is no new tell: the tackler leaves at the handoff plus d, when an unnamed LB, CB or S with his ratings would. A DL tackler still leaves before the line, as today.

**Does it need slice 3 first?** Not to satisfy any written rule. To be unremarkable, yes, and then only for the first group. Joseph accepts the interim tell (2026-11-24, Open 1, yes).

**Already approved.** 2026-11-16: departure at the throw, locked in MPT, with the interception tell left as its Open 3 for after G6. 2026-11-23: the break on the ball, on completions too (MPR Settled 3). 2026-11-24: departure at the throw plus awareness, interceptions included, and the order that puts slice 3 after the timeline half. Later the same day, by name: the interim tell (Open 1), `airMs` once slice 3 is built (Open 2), the interception return tackler at the throw (Open 4) and the 2.5 yd at the catch point (Open 8).

## 3. Order, files, recaptures, tests

| Step | Session | Builds | Files |
|---|---|---|---|
| 1 | MPR | Slice 2 finishes, checked clean | timeline.ts, motion.ts, app.ts, templates.ts, motion.json |
| 2 | MPT | Milestone 0, the sweep, on today's credits | test/game/, docs/PERF.md |
| 3 | MPT | Milestone 1, the engine half | participants.ts, its schema in packages/shared/src/engine-schema.ts and engine.ts, participants.json, MODEL.md |
| 4 | test-writer | The recapture (below) | packages/app/test |
| 5 | MPT | Milestone 2 as merged here, scrimmage plays only: TM1 to TM9, the awareness delay included. Slices 1 and 2 already hold `readMs`. Kicks are drawn as before | timeline.ts (`selfTackle`, the tackler branches, `tacklerRun`, `carry`, the catch at the dead spot, `looseBall`, the interception return), motion.ts |
| 5k | MPT | The kick step, TM10, a separate commit. **Waits** for K3 and K4 and the recapture they allow. Nothing else waits for it, but slice 5 | timeline.ts (`unnamedTrack` and `trackOf` on kicks, the tackler branches, `planKickReturn` and `tacklerAts`, `leadersOn`) |
| 6 | MPR | Slices 3, 4, 5 on that tree. Slice 3 also sets TM2's `airMs`. Slice 5 adds TM10's delay, so it needs 5k first, or ships without it | As MPR lists |

- One session at a time in timeline.ts and motion.ts. Step 5 starts only when step 1 is clean.
- timeline.ts, `packages/shared` and several test files have uncommitted work from other sessions. The lead names the commit each step starts from.
- Step 3 changes files in the calibration import graph (participants.ts, engine-schema.ts, engine.ts). The committed pins' code hashes go stale, so it needs the usual pins-only runs. docs/specs/m4-franchise-core.md A9 holds those files unchanged by the franchise build: step 3 is not part of that diff, and the franchise session must know.

**Recaptured once, after step 3 lands and before step 5 starts.** Outcomes do not change, so S stays the same 571 plays, but the named tacklers and with them the event records do. Today's files then compare different games ("the inputs").

| What | Why | How |
|---|---|---|
| pr-baseline.json | `inputs` hashes cover the events, and no-ratings keys follow the credited names | From the step 3 tree, new meta block |
| pr-peaks.json | Its `inputs` hashes, and bars by play and mark | Against the **pre-build drawing** (timeline.ts f8474557..., the copy it was first captured from) on the new games. From the slice 2 tree, slices 1 and 2's own worsening would become the bar |
| The S counts (`S_BAR`, `S_RED_BEFORE`, `FIXTURES_RED_BEFORE` for the new fixture) | Same events | Same copy. N4 keeps Settled 8's allowance, the new pre-build count + 11 |
| PR-C7's constants (`REVERSAL`, `AWAY.before`) | They name plays and a count of 392 tacklers | Same copy. The three held plays may drop out. None may be added without a pre-build measurement |

- **The pre-build copy f8474557 exists** (lead ruling: the scratchpad, and _archive/player-reactions-snapshots/before.tar.gz).
- **pr-baseline.json (lead ruling): captured once after the engine half, then only the tackler plays are replaced at the timeline half.** Step 5 replaces scrimmage plays with a tackler, and no other entry.
- **kr8-baseline.json is untouched through step 5.** Its test is already red. Step 3 changes its punt entries that have a tackler (another man is named). The lead records the list. An entry with no tackler that newly fails at step 3 is a defect, and any that newly fails at step 5 is one.

**The kick step and the baselines, plainly.** TM10 changes unrated keys on every kickoff that is not onside and every punt that is not blocked, returns or not (the no-tell rule). Those are the plays KR8 holds "identical" (touchbacks, fair catches, out of bounds, every punt) and PR17 holds "key for key".
- It is the MPT build's change, not slice 5's: it is unrated, and it is how the kick tackler gets there. Slice 5 only adds the delay.
- It cannot ship with kr8-baseline.json untouched and KR8 meaningful. All of those entries would fail, and a real defect would hide among them. The file is "recaptured only by a person who has checked that a change to punts, touchbacks, fair catches, kicks out of bounds or onside kicks was intended" (kr8-digest.ts). So 5k waits for that (K4). If allowed, only non-onside kickoff and non-blocked punt entries are replaced, once, after 5k is accepted. Onside entries and blocked punts stay, and must not change.
- pr-baseline.json: its kick entries for the same plays are replaced at 5k, in both sections. That is beyond the lead's ruling ("only tackler plays"), so it needs its own.
- What TM10 needs to be checked before any recapture is TM-C14 to C17, which compare hook-on with hook-off builds and need no baseline.

**Tests that change. None is weakened, and no floor is edited by its own builder.**

| Test | Change |
|---|---|
| player-reactions.spec, PR-C7 | Departure is E + `delayMs`, with E from `flightOf` or `tl.read`. Clauses (a) to (c) go. The "leave at the read" floor of 20 goes, because nobody falls back. The naming-another build is drawn at the same raw whistle (the hook), or most pairs would be skipped for a different `liveEnd`. The 1 ms sweep starts 200 ms before E. TM4 reads the same ring push from E |
| player-reactions.spec, away and reversal | Window kept around `tl.read`, and a second one around E on passes |
| player-reactions-standing.spec, PR-C9 (b) | Exception (4) |
| player-reactions-standing.spec, PR-C8, R-C9 | Rows unchanged, no exception read |
| player-reactions-legacy.spec | Recaptured file, FAR_TACKLER in the names |
| natural-motion.spec N1 | Unchanged. N1-T and N1-cap are new `it` blocks (MPT 2.2, 2.3). Run N1-T with the rating table too |
| MPT 0.1 to 2.9 | Not built yet (I found no `FAR_TACKLER` in the tests). Written once, with the changes above |
| fumble-carry.spec, strip-sack-ball.spec | Return time formulas (LC-C4, LC-C5 b) are `nat.top` exact, and a return with a tackler may now be longer. A failure there is a FLAG to the lead: reword for plays with a tackler only |
| MPR slice 3, PR-C13 | Counted defenders only, so unchanged. It gains TM-C9's report |
| MPR slice 5, PR-C20 | "PR-C7 holds for the tackler of every kick return": with E the landing and d 0 there. His delay is checked at the kick (TM-C17) |
| kickoff-return.spec KR8, kr8-digest.ts | None until K4. KR1 to KR7 and KR9 run unchanged, with no ratings (5k) and with (slice 5) |

## 4. Acceptance criteria

Headless, at 1x. S, Fixtures and the rating table as MPR defines them. Floors are test constants. Unclamped means k = 1 in every build compared.

| # | Criterion | How it fails |
|---|---|---|
| TM-C1 | **Own top speed.** On the fixtures (no ratings and the rating table) and on S: from D to `liveEnd`, N1's v_i is at most 1.15 x his own top / k at every key, and his leg is not in `nat.demanded`. Exception, the only one both specs list: the sacker who is also the tackler. Over MPT's 1,000 games, 2.4 as written (95% overall and by kind, 1.5 x on 100%). Kick returns are reported until 5k and gated the same from it. | A key over, a demanded leg, or 2.4 missed. |
| TM-C2 | **When he leaves.** Every rated plain tackler of S and the fixtures (scrimmage): `delayMs` = d within 1e-6 (`readMs`; from slice 3 `airMs` by TM2), unless the ring rule bound him (PR-C7 (e), each listed and counted in PERF.md) or he has legs of his own (TM7). `pursueAt` - `delayMs` is the throw or handoff (TM1) within 1e-6. Unrated: `delayMs` 0. | Anyone early for another reason, or a delay counted from the catch. |
| TM-C3 | **His unnamed self.** Against a build naming another tackler at the same raw whistle, he is identical (1e-6 yd) to the later of E and D - 50 ms, on the 25 ms grid from the start and at 1 ms steps from 200 ms before E. At least 100 pairs on S. A copy whose departure is 100 ms early is caught. | He shows before he departs, or a check that cannot fail. |
| TM-C4 | **No early tell.** R-C9, R-C20, R-C7, R-C19 and N7 pass with ratings and with none, with no tolerance and no exception. Two events that differ only in the named tackler, unclamped, give identical keys for all 22 marks and the ball up to E. With the raw whistle held, every mark but the two tacklers (and a blocker stalking either) is identical up to the earlier D, less 50 ms, and never less than to E. | A pre-throw difference, or a bystander who reacts to who was named. |
| TM-C5 | **Awareness, monotonic.** For every rated plain tackler on the fixtures and every 11th play of S whom the ring rule does not bind, built at awareness 40, 55, 70, 85 and 90: `delayMs` never rises as awareness rises. From 40 to 85 it falls by at least 200 ms for an LB, CB or S, and at least 100 ms for a DL or an offensive player (arithmetic at the worst variation: 225, 110 and 144). TM-C1 holds in all five. From slice 3, a pass tackler on `airMs` is swept on the rating PR9 reads (`coverage` for an LB, `ballSkills` for a CB or S), with PR-C13's floor: at least 200 ms from 40 to 90. | A sharper tackler leaves later, or a slow one is sped up to arrive. |
| TM-C6 | **Places and facts.** Across those five builds, unclamped: throw, handoff and catch times equal, catch place and the ball's place at the whistle equal (1e-6 yd), and the carrier's path points identical. The ball is at the dead spot, and the holder and the tackler at the ball, at `liveEnd`. PR-C9 (a) holds, and (b) with exception (4). N6's exact anchors fail on no more plays of S than their bar. | A rating that moves a catch or a spot, or a missed ball. |
| TM-C7 | **The whistle.** It is never earlier than with the extension off, and equals it (within one key) on every play where TM-C1 would hold without it. The carrier's peak during his carry is at most what it was with the extension off + 0.05 yd/s. R-C12's live range holds. MPT 2.5's bounds: not set. They are measured with d in, by kind, after the engine half, and set by Joseph then (Open 7). Until then reported. On kick returns, from 5k: TM-C16. | A shortened or needlessly long play, or a faster carrier. |
| TM-C8 | **Clamped plays.** Reported in PERF.md: plays at the 1.8 s floor and the 14 s cap, with the extension on and off, rated and unrated. The share clamped at `live.maxMs` rises by at most 1 point (MPT 2.5). TM-C1 is read against top / k. d is not scaled (PR13). On an unclamped play, frames up to E equal the extension-off build's, on sneaks and scrambles the carrier's included. | A play pushed over the cap past the bound, or a pre-E frame moved at k = 1. |
| TM-C9 | **The tell, reported, not gated.** Over S, for each class of completion: the share of tacklers who leave before the catch, and the count of other non-rushing defenders who have left their track by then. Taken after step 5 and after slice 3. Also the return tacklers who leave before the pick. | Not reported. |
| TM-C10 | **Peaks.** The pr-peaks rule on the recaptured file: every unnamed mark and every tackler at most 1.5 x his top, or 1.10 x the same mark's earlier peak. Seeds 1 to 3 in the suite, 1 to 12 heavy. | A mark worse than before. |
| TM-C11 | **No regression.** Each standing check fails on no more plays of S than its recaptured bar. Every fixture pair that passed still passes. KR1 to KR9 as MPR's standing rule holds them. R-C15 (20 ms median, MPT 2.8) holds, the extension's own redraws included. | A check worse than before, or over budget. |
| TM-C12 | **Legacy, step 5.** With no ratings, step 5 changes only scrimmage plays with a tackler: every other play of the recaptured pr-baseline.json is key for key. With ratings, every kick, kneel, spike and no play is key for key. | A play with no tackler, or a kick, changed. |
| TM-C13 | **Not thrown off the ball.** PR-C7's away check (3.5 yd, his own top, the recaptured constants) and the near-reversal check hold. | The ring shove is back. |
| TM-C18 | **Off the catch point (TM9).** On S and the fixtures, on every completion and interception, the tackler is at least 2.5 yd from the catch point at every key from D to the arrival, unless he was inside it at D (listed). | A defender waiting where the ball arrives. |

Kick step (5k), held until K3 and K4 are answered. Sample: the return, touchback, fair catch, out-of-bounds, short and onside fixtures, PUNT_RETURNED, FAIR_CATCH and every kickoff and punt of `simGame` seeds 1 to 6. "Off" is the same build with TM10's run and the extension off (test hooks, each on its own).

| # | Criterion | How it fails |
|---|---|---|
| TM-C14 | **They run.** With TM10 on, no coverage man is farther from the landing point at the landing than with it off, and the median man is at least 0.6 yd nearer (about half of the smallest arithmetic gain, 1.3). Each holds 1.15 x his own top / k from the kick to the landing. | Nobody runs, or one sprints. |
| TM-C15 | **No tell.** Two events with the same landing point and k that differ only in the tackler, the dead spot or the result (a fair catch against a return included) give identical keys for every kicking-team mark from the snap to the landing. The tackler equals the build naming another man, to the landing (1e-6 yd, 1 ms steps over the last 200 ms). A copy that sends only the tackler is caught. | A coverage man who knows the result. |
| TM-C16 | **Nothing else moves.** On against off: kick and landing times (raw clock), landing place, returner's keys to the catch, the ball's y at the whistle, holder, tackler, label and flag texts equal. The whistle: equal with no tackler. On a return with one, never earlier, equal (one key) where TM-C1 holds without the extension, and otherwise no later than one key past the earliest whistle at which TM-C1 holds (a test scan in 25 ms steps). The returner's carry peak is at most the off build's + 0.05 yd/s, path points equal where the cut is. The extensions by kind (median, p95, max, and plays at the 14 s cap) go in PERF.md. The ball's x at the whistle is equal, or the cut side differs and KR7's check reads that side from the drawn blocks. Those plays are listed. Onside kicks, blocked punts, field goals and extra points key for key. | A moved fact, or a cut KR7 does not explain. |
| TM-C17 | **What holds.** No coverage man within 2.5 yd of the landing point before the landing. The ball's ring as today. KR1 to KR7 and KR9 at their own bars (100% of fixtures, 95% of 1,000 returns), by MPR's standing rule. From slice 5: each man turns for the landing at the kick + `readMs`, never later as awareness rises, by at least 100 ms from 40 to 85 (K2). | A coverage man on the ball, a lost block, or one delay for all. |

Gate: G6 (MPT) after step 5, with "does one man give the catch away?" added. Asked again after slice 3 at G-PR.

### States and edge cases that can happen

| State | Behavior |
|---|---|
| Catch at the dead spot (play 97) | The hold lasts until he arrives. |
| D after the catch (a short pass, a slow reader) | He waits out `readMs` from the throw. The play lasts longer. |
| D would fall after the old whistle (a sneak, a 1 yd run) | The whistle extends past D. Today he would have left early. |
| D after his unnamed self began to slow | He slows with it until D, as built, and the lag eases out. |
| Play at the 1.8 s floor | Extending the raw whistle uses up the stretch first, so k falls toward 1 and the throw or handoff moves on screen. Allowed (MPT, "on unclamped plays"). |
| Play at the 14 s cap | Scaled. d is not, so he has slightly less raw time, and the fit must hold after scaling. |
| Rated blocker stalking the tackler (screens, outside runs) | Today he lets go when the tackler departs. On a screen that is now in the air. MPT's "everyone else's pursuit start stay as they are" holds him to `plan.read`. Who he shadows from D until then: for the lead, item 4. |
| Two sessions' other rules on `looseBall` (fitted returns, not approved) | Unchanged. The whistle extension applies to a return that ends in a tackle. |
| Tackler also the QB or the kicker (own legs) | TM7. |
| Incompletion, touchdown, out of bounds, kneel, spike, no play | No tackler. Unchanged. |
| Kickoff or punt with no tackler | TM10's table. |
| A short punt, coverage already near the landing | He holds 2.5 yd off until it lands. |
| `ctx.natural` false, 2x, skip, reduced motion | As both specs. Reduced motion shows the final frame, which differs only by where others end. |
| Loading, permission, network | Not applicable, a pure function. |

## Milestones

1. **Engine half** (steps 2 to 4). Shippable alone: MPT Milestones 0 and 1, and the recapture. Nothing drawn changes but who is named.
2. **Timeline half** (step 5). Shippable alone, with the interim tell Joseph accepted: TM1 to TM9, TM-C1 to C13 and C18, MPT Milestone 2 on scrimmage plays, G6.
3. **Kick step** (5k). Shippable alone once K3 and K4 are answered: TM10, TM-C14 to C17. Gate: Joseph watches 5 or more punts and 5 or more kickoff returns.
4. **Slices 3 to 5** (MPR), with TM2's `airMs` in slice 3 and TM10's delay in slice 5. TM-C9 again after slice 3.

## Locked, and likely to change

Locked: Joseph's (a) to (d), places never move, the whistle only grows, 1.15 x on scrimmage plays and, from 5k, kick returns, d on E and unscaled, R-C9 and R-C20 without exception, kr8-baseline.json untouched through step 5. Likely to change: MPT 2.5's bounds (Open 7), everything about kicks under K2 to K4, how the carrier fills the time (after G6).

## 5. Open questions for Joseph

Yes or no. My recommendation comes first.

**The kick step: K1 answered, K2 to K4 open.** K3 and K4 block step 5k. K2 blocks only slice 5's part. Nothing on scrimmage plays waits for them.
- **K1. Answered: "Yes, lengthen a little"** (Joseph, in chat, 2026-11-24, as relayed by the lead). It was asked twice. The second time a longer hang was also offered (the MPT session's idea; the hang is capped at 1,500 ms in `motion.json`), and Joseph still chose lengthening. **Considered, not chosen:** the longer hang. As asked: After covering in the air, may a kick return still be lengthened by only the time the tackler is then short, with no extra wait? By the arithmetic in TM10, covering in the air saves about 0.1 to 0.4 s, and waiting and lengthening would have cost punts 2.4 s at the median. No means one of two other things: the tackler stays over his top speed on kicks, as today, and kicks are exempt from the 1.15 x and 1.5 x limits; or the ball hangs longer (a `motion.json` value change, and the landing time moves).
- **K2. Recommend yes.** From slice 5, does the awareness delay come at the kick (he turns for the landing at the kick + his delay), so the tackler leaves at the landing with no second delay?
- **K3. Recommend yes.** Do punt-team linemen also leave their blocks at the kick and run to the landing? Reverses PR22. No means a lineman who makes the tackle (3 of the 74 position shares present on a punt unit in participants.json, about 4%) either leaves alone, which gives him away, or cannot get there.
- **K4. Recommend yes.** Do PR17's "key for key" and KR8's "identical" stop holding for kickoffs that are not onside and punts that are not blocked, and may those entries of kr8-baseline.json and pr-baseline.json be replaced once, after the kick step is accepted? No means the kick step is not built.

**Answered (Joseph, 2026-11-24, question dialog, as relayed by the lead).** Opens 1 to 5, 7 and 8: **yes**, as recommended. Open 6: **"Cover in the air"**, against the recommendation: coverage players, the named tackler included, run toward the landing while the ball is in the air, so waiting and lengthening is not used (TM10; K1 then allowed lengthening by what is still short). As asked:

1. **Recommend yes.** May the timeline half ship before slice 3, knowing that until slice 3 the tackler is the one defender who breaks off his coverage for the tackle while a completed pass is in the air? No means the timeline half waits for slice 3, which reverses the order you chose.
2. **Recommend yes.** Once slice 3 is built, should a rated, non-rushing LB, CB or S who makes the tackle on a pass leave at the throw + his `airMs` (the moment he would leave on an incompletion) instead of the throw + his awareness delay? No keeps your choice as made, and his timing can give him away.
3. **Recommend yes.** Keep the ring rule: he may leave earlier than his awareness delay, never before the throw or the handoff, when waiting would have the ball's ring throw him off first?
4. **Recommend yes.** On an interception, does your choice close the older open question, so that the offensive player who makes the return tackle leaves at the throw + his awareness delay, with another look at G6? Slice 3 will not hide him.
5. **Recommend yes.** On a fumble return, keep the play's own moment (the throw, the handoff, or the end of the drop on a strip-sack) plus his awareness delay, as the older spec's "same rule" and today's drawing have it?
6. **Recommend yes.** On kickoff and punt returns, leave at the landing with no awareness delay until slice 5, then the landing + his awareness delay with the play lengthened, in place of PR20's leaving early?
7. **Recommend yes.** Set the limits on how much longer plays get (150 ms median, 800 ms at the 95th percentile, 3,000 ms at most are only proposed) after the engine half is measured with the awareness delay in, instead of confirming them now?
8. **Recommend yes.** Keep the tackler 2.5 yd from the catch point until the ball arrives, as every unnamed defender is in slice 3?

**For the lead, not Joseph:**
1. Ruled (2026-11-24): pr-baseline.json is captured once after the engine half, then only tackler plays are replaced at the timeline half. Open: the kick entries at 5k, which include plays with no tackler.
2. Ruled (2026-11-24): the pre-build copy f8474557 exists (scratchpad and _archive/player-reactions-snapshots/before.tar.gz).
3. KR8's wording against MPT on punts with a tackler at step 3. At 5k it is K4.
4. The stalking blocker of a tackler on a screen, between D and the catch. And TM9 for a tackler already inside 2.5 yd of the catch point at D.
5. Whether MPT 2.3 (N1-cap) exempts a fitted fumble return (the motion spec's LR Open 6, still open).
6. TM-C1 holds S to 100% where MPT 2.4 asks 95% of 1,000 games. A miss on S comes back as a FLAG with the plays.
7. Who builds slice 5's delay if K3 or K4 is no: slice 5 then keeps PR18 and PR20 as written.
8. Conflicts K1 leaves, all on kicks: (a) at the 1.8 s floor and the 14 s cap the extension changes k, so the landing moves on screen and a fair catch and a lengthened return no longer share a clock before the landing. TM-C15 compares at equal k only, so it does not see that. Waiting and lengthening peaked at 13.2 s on punts, so some plays can reach the cap. (b) A short return is drawn much slower than the returner's top. KR4 to KR6 were tuned on a carry at about top speed, and the cut's radius estimates it, so a miss is a FLAG, never a looser bar. (c) No bound exists for kick extensions, and MPT 2.5's proposed ones would likely fail (Open 7).
