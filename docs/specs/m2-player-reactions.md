# M2: player reactions follow each player's ratings

Status: slices 1 to 4 approved for build (Joseph, 2026-11-23, see "Settled"). Slice 5, kicks, was added the same day at his request, and its two more keys (PR-Open 7) were approved on 2026-11-24 (Settled 7, amended 2026-11-24). The design of slices 1 to 4 is unchanged by that revision. Slice 1 was built on 2026-11-24, and the lead's rulings on the engineer's flags are written in where they apply, each marked "(amended 2026-11-24, slice 1 build)". Round 2 of slice 1 met every bar by the engineer's run, and what was built is recorded as "(amended 2026-11-24, slice 1 round 2)". The independent test run confirmed round 2 (173 of 173, every S count) and the second review found nothing blocking. Their corrections, and two fixes (PR6's ring rule for the tackler, PR3's DL release order), are marked "(amended 2026-11-24, slice 1 round 3)". Round 3 is built, and its review found two defects that are being fixed (PR3 and PR6). Those, and Joseph's three answers of 2026-11-24 (Settled 7 to 9), are marked "(amended 2026-11-24)". Joseph's four selections in the question dialog of 2026-11-24 (Settled 10 to 13) and the lead's slice 2 rulings are marked "(amended 2026-11-24, slice 2)". Joseph accepted slice 2 on 2026-11-24 with 7 known red tests, none loosened, and the record of that is marked "(amended 2026-11-24, slice 2 accepted)" ("Slice 2 accepted" below, Settled 14 to 17). Slice 5 is now `motion.json` version 7. Owner: Joseph. Author: spec-writer. Branch: m2/playable.

Adds to docs/specs/m2-play-calling-and-motion.md ("the motion spec"). Where the two conflict, the conflicts are listed under "Superseded". Where this file says nothing, the motion spec stands. Everything here is **designed, display only**. Nothing is fitted and nothing may be called data-derived. No primary source for reaction, get-off or break times was checked in this session, so every number is a designed starting value: [gap: primary source for defender reaction time to a handoff or a throw, if one exists].

## Goal and user

Goal: on scrimmage plays, and from slice 5 on kickoffs and punts, every player's drawn timing and behavior visibly follow from his own ratings, on both sides of the ball, so a play reads as 22 different people, while the engine still decides everything that happens.

User: Joseph and players like him, watching the field at 1x. Assumption that carries this spec: **a difference under about 150 ms between two marks is not seen at 1x, a difference of 250 ms or more is.** Designed, no source checked. Test: the playtest gate G-PR.

## Problem

Joseph, 2026-11-23, after watching plays in the app: "all players still seem to react all the same way at the same time. this should vary by stats such as awareness. all player behavior should be influenced by their individual stats so the perceived experience is like a real play".

Two complaints, same time and same way. Measured by the lead on 2026-11-23 (`packages/app/test/zz-react-probe.test.ts`; app games seeds 1 to 6 from `simGame`, 571 run and pass plays, drawn with the app's ratings):

| Measure | Today |
|---|---|
| First movement after the snap, p10 to p90 range across the 22 marks | 145 ms on the median play (130 at p10 of plays, 150 at p90) |
| Non-DL defenders whose pursuit starts within 100 ms of the median defender | 100% on the median play, 90% on the p10 play |
| Range of pursuit starts among non-DL defenders | 130 ms on the median play |
| `reactionMs` as drawn, p10 / p50 / p90 | LB 101 / 147 / 213, CB 140 / 203 / 252, S 153 / 199 / 242 |
| Awareness of the non-DL defenders on the field | p10 47, p50 62, p90 82, max 95 |

What I confirmed in the code (working tree of 2026-11-23, line numbers will drift):

1. **Same time.** Awareness moves `reactionMs` by +60 to -60 ms over the 40 to 90 band (`motion.json` `ratings.default`, timeline.ts 599 to 602). The p10 and p90 defender are 35 points apart, so 84 ms. That is 5 frames.
2. **Same way.** Every unnamed non-DL defender leaves his track at `read + reactOf(id)` (timeline.ts 1772, 2317, 2986) and then runs the same `pursue()` with one `pursuit.leadMs` 400 and one `turnDegPerS` 180. Every DL releases at one `releaseT`. Man trails use one `man.lagMs`, stalk blocks one `stalk.lagMs`, breaks one `fillet` set.
3. **The offense does not react at all.** An unnamed offensive mark turns to the ball at the read with a delay of 0 (timeline.ts 1772, `side === "X" ? reactOf : 0`), all on the same key.
4. **The tackler reacts in 0 ms** (timeline.ts 2395, he leaves at the read). On every play with a tackle, the man who makes it is the first defender to leave his track.
5. Only speed, agility and awareness reach the timeline (`motionRatings()`, app.ts 503). Strength and the position skills (`packages/shared/src/engine.ts`, `POSITION_SKILLS`) do not.

## Non-goals

- No change to `packages/sim`, `packages/shared`, `data/engine`, `data/players`, the PlayResult or any engine type. No new dependency. No new UI, setting or text.
- Field goals, extra points, kneels and spikes. Kickoffs, onside kicks and punts are slice 5 (PR17).
- Making the standing motion checks green. N1, N3, N4, both N5 checks, N6's settle, M5 and M7 were already red before this build, and N6's anchors, A3's ring and R-C5 were red on a few plays (the baseline is under "Acceptance criteria"). Fixing them is out of scope here. It is a separate piece of work for Joseph to schedule. This spec only promises not to make them worse (PR-C10).
- A strength effect at the line. Joseph, 2026-11-23: it is a follow-up spec of its own. Deferred, not designed here (PR11).
- A punt return design (a wall, blocks, a cut, punt-team linemen covering). Slice 5 gives punts reactions only (PR22). Deferred.
- The carrier's path, the QB's drop, the throw and catch rules, the miss rules (A1 to A5), the main menu's toy simulation.
- The why line. It still comes only from factors the engine used. Nothing drawn here is a reason for a result.

## Decisions

PR1. **Every rating effect is an added term that is zero when the rating is missing. With no ratings the Timeline is today's, key for key.** A player with no entry in `ctx.ratings`, or without the rating an effect reads, moves exactly as he does today for that effect. Motion reads card ratings (the pool's, before the home-field shift), as the mark labels do. Why: almost every existing motion test builds with no ratings, so the whole suite becomes a regression guard for this build (PR-C1), and the existing `rated()` helper already works this way. Rejected: an unrated player moves like a 65. It re-baselines every fixture test and loses the guard, for a state the app never reaches. Final.

PR2. **Scrimmage plays only.** Runs, passes, sacks, scrambles and tries from scrimmage. Every kick play is drawn exactly as today, with or without ratings: the existing `ratings.default.reactionMs` and `startMs` bands keep applying there. Why: KR1 to KR9 were tuned on today's reaction values and KR8 holds a key-for-key baseline. Rejected: kicks now. Amended 2026-11-23 (Joseph: "Include kicks"): this holds for slices 1 to 4, where every kick play stays exactly as today. Slice 5 then brings kickoffs and punts in (PR17 to PR22).

PR3. **The reaction to the read is large enough to see, and both sides have one.** On scrimmage plays a mark's reaction to the read is `readMs` = max(`read.minMs`, position table + his awareness band + his NM4 spread + his play variation (PR4)). The band replaces `ratings.default.reactionMs` on scrimmage plays. Defense: +320 ms at awareness 40 to -100 ms at 90. Offense (unnamed marks that turn to the ball at the read): +350 to +80, added to today's 0. An unnamed DL releases at today's `releaseT` plus +250 to 0 by awareness, plus his variation, or at the first key at which the ball's ring would push him, whichever comes first.

**The floor goes last (amended 2026-11-24, slice 1 build).** The first wording was max(`read.minMs`, table + band + spread) + variation. That is not monotonic where the floor binds: at v = -1 an LB above about awareness 82 could read up to 18 ms later at 90 than at 82. With the floor applied after the variation, and the `varyMs` span rule, `readMs` never rises as the rating rises, for every v. The same order holds wherever a floor or a cap meets a variation: `leadMs` is clamped to `leadMinMs` and `leadMaxMs` after its variation (PR5, as already written), `airMs` = max(`air.minMs`, `air.baseMs` + band + variation) + `manExtraMs` (PR9), `driveMs` = max(0, band + variation) (PR10), and `wallMs` = max(`read.minMs`, table + spread + `wallReadShare` × (band + variation)) (PR19). Those formulas replace the ones written in PR9, PR10 and PR19. One cost, stated plainly: the floor now also cuts the variation, so by the arithmetic an LB at about awareness 86 reads at `read.minMs` on about half his snaps, and one at 90 on most of them. `read.minMs` is the lever if Joseph sees the best linebackers move as one.

**A DL releases no later than the ring reaches him (amended 2026-11-24, slice 1 build).** As first built, a DL held engaged by his own `read.releaseMs` after the rest of the line had released took the sideways ring push when the ball passed him. (Amended 2026-11-24, slice 1 round 3: the first account of why N1 read 550, which stood here, is struck. The corrected account is under the baseline table, "Slice 1 against the baseline".) Rule: a rated DL releases at the earlier of his own release time and the first key at which the ring would push him. It is drawn from the ball's place after the read, as the ring itself is, and it decides nothing. The counts with the rule in place are to be measured when it is built.

**The DL release as built (amended 2026-11-24, slice 1 round 2; accepted by the lead).**
- The pair's hand fight ends at the line's release, as before the build, not at the DL's own release. A rated DL then holds his spot (the fight fades over 150 ms, then the idle sway) until he goes. So a blocker's keys never depend on his DL's rating. Tying the fight to his own release had left N1 at 550 and INCOMPLETE failing.
- He releases the key before the ring would push him, never before the line's release. This corrects "at the first key" above: at that key he already takes the push (8.08 yd/s seen on seed 1 plays 39 and 96). On S the rule releases 263 of 2,187 unnamed DL marks early (242 plays), by 117 ms at the median.
- With both in place N1 is back at 547 and N5 engaged at 384 (the baseline table).
- Amended 2026-11-24, slice 1 round 3: a DL's release never comes later as his awareness rises. Round 2 could release a DL up to 25 ms later at a higher rating on 8 of 729 A/B sets, from a loop bound. Amended 2026-11-24: scope, this holds for an unnamed DL, not a tackling DL (whose departure is PR6's). The round 3 review found it still broken over a 1 to 4 point awareness band on three marks (seed 2 play 59 DL1, seed 5 play 71 DL4, seed 1 play 94 DL4). That is being fixed, and PR-C3's check now sweeps 40 to 90 by 2.

Why awareness: the read is recognition, and it is the rating Joseph named. Why not centred on 65: a band centred on today's table puts every LB above 73 on the floor, which flattens the good players. So today's table value becomes about a 78-awareness defender, and the median rated defender starts about 135 ms later than today (Settled 5: the lead's default, Joseph to confirm at G-PR). Rejected: doubling today's band (240 ms end to end, 170 ms between the p10 and p90 defender, still near the limit of what is seen). Rejected: moving the position table (breaks PR1). Final in structure, values open.

PR4. **The same player differs from play to play, less when his awareness is high. No RNG.** v = 2 × `hashUnit(playerId, salt)` - 1 (natural.ts), with salt = `<kind>|<period>|<clock>|<spot>|<down>|<distance>|<score.home>|<score.away>` read from `event.before`. Those fields exist on every play event (`Snapshot`, packages/sim/src/loop/play.ts 63 to 76; `before` on the play event, line 89). `kind` is `vary:read`, `vary:lead`, `vary:air` or `vary:drive`, so one player is not early at everything on one snap. The variation added is his `varyMs` band value × v: ±140 ms at awareness 40, ±30 at 90. Nothing from `play`, `after`, the calls or the participants enters the salt. A down replayed with the clock unchanged draws the same values, which is accepted. Rejected: a seeded RNG (contract 4, and tests could not reproduce it). Rejected: a fixed per-player offset only, which is what NM4 already is and is the complaint. Final.

PR5. **Pursuit is per player, in angle and in turn, not only in start time.** `leadMs` = 400 + his awareness band (-250 to +250) + `leadVaryMs` × v, kept between `leadMinMs` and `leadMaxMs`. A sharp defender runs to where the ball is going, a poor one chases where it is. His lateral acceleration limit and `turnDegPerS` are × (1 + his agility band, -0.25 to +0.25), so an agile player comes out of his pedal and redirects sooner. Applies wherever a mark pursues the ball on a scrimmage play, on both sides, including a named player before his departure. The 2.5 yd ring, the flight ring and the carrier corridor are untouched. Rejected: pursuit speed by awareness (speed belongs to the speed rating). Rejected: a wrong-way first step in pursuit for low awareness, because it reads as a missed tackle the engine did not decide. Final in structure, values open.

**Scope as built (amended 2026-11-24, slice 1 build).** Two motions keep the shared lead, turn and lateral values: a fact mark's drift toward the ball after his last leg (`idleUntil`), and the target's bend from his route to the catch. Both are out of slice 1, and no later slice takes them. The bend is tied to the catch anchor and to R-C7's speed share, so a per-player limit there would move what a named player can reach. The drift is a jog at reduced pace by a player whose part in the play is over, with the eye on the ball. Revisit only if Joseph names either at G-PR.

PR6. **A named player is bounded by his anchor, never the reverse.** The engine's tackler leaves his unnamed track at the read + min(his `readMs`, S). S is the largest delay on the 25 ms grid at which his run to the tackle, as drawn, still meets N1 and N2 and is not anchor-demanded (NM3), with at least `convergeMs` left. If no delay qualifies, S is 0 and he leaves at the read exactly as today. So a slow-reacting tackler who is far from the play is drawn leaving early because the engine says he made the tackle. That is drawn from the anchor. It is not a decision, and it changes nothing before the read. Until he departs he is his unnamed self (NM2). One explicit exception to those two sentences (amended 2026-11-24, slice 2; Joseph, Settled 10): a rated tackler may differ from his unnamed self in the last 50 ms before he departs, which is before the read when he leaves at it or less than 50 ms after it. The sacker, a fumble recoverer, the carrier, the QB and the target (who leaves at the throw, R7) depart as today. Rejected: keeping the 0 ms tackler (Problem 4). Rejected: letting a late tackler sprint, which makes N1's anchor-demanded speed a result of a rating. Final.

**PR6 as built (amended 2026-11-24, slice 1 build).** This replaces "still meets N1 and N2 and is not anchor-demanded" above with what the engineer built and the lead accepted:
- The candidates for his delay are his `readMs` first, then the 25 ms grid below it, down to 0. The largest candidate that qualifies is used.
- A candidate qualifies when his leg from that departure to the tackle has a mean speed and a peak speed both at or under 1.15 × his own top, on the built keys and on the keys as natural motion draws them.
- One guard: he never departs after his unnamed self starts slowing for the whistle. So he and his unnamed self stay identical until he leaves, but for the last 50 ms (amended 2026-11-24, slice 2, PR6's exception).
- With less than `convergeMs` + 25 ms between the read and the whistle, S is 0. A tackler with fact legs of his own before the tackle (a QB, a kicker) departs as today.

**PR6, round 2 (amended 2026-11-24, slice 1 round 2; accepted by the lead).**
- The candidate grid stops at 25 ms. A delay of 0 is the fallback and is never tested. This corrects "down to 0" above.
- Every rated plain tackler is built from his unnamed self up to his departure, the ones who leave at the read included. Before, 48 of 201 at-read tacklers on S differed from their unnamed self before the read, all on passes, a leak that predates this spec. Now 0 of 383 compared do, on a 25 ms grid only (amended 2026-11-24, see the round 3 note below). Unrated tacklers take today's path (PR1).
- On 5 plays (a tackle within 300 ms of the catch) the unnamed self starts slowing for the whistle up to 90 ms before the read. The tackler slows with it, and the lag, at most 0.03 yd, eases out over his run.
- On the rated path the tackler's run starts at no more than his top speed, and the peak check measures from the cut, so a candidate is not refused for his unnamed self's ring pop.

**The tackler leaves before the ring would throw him off (amended 2026-11-24, slice 1 round 3; the lead's ruling on the reviewer's finding, built in round 3).** A rated tackler departs no later than the key before the ring would first push his unnamed self after the read, and never before the read. Why: built from his unnamed self, a tackler near the catch was pushed off the ball by the ring and then reversed into the tackle. The rule has the shape of the DL ring rule in PR3: it reads only the ball after the read, and it decides nothing. By review, on S and the fixtures it changes the delay on two plays: seed 2 play 56 XCB2 (442.5 to 125 ms) and seed 6 play 151 (25 to 0) (amended 2026-11-24).

**Reversals, and why the count is no longer the test (amended 2026-11-24; Joseph, Settled 9).** The figures that stood here (18 before the build, 24 after round 2, and 5 of the 13 tacklers within 4 yd reversing where none did before) came from a different measure that was not reproduced, and they are struck. By the test's own function (`tacklerReversal` in player-reactions.checks.ts: toward the ball, away, then toward it again, from 60 ms before the read to 600 ms after), tacklers of S who reverse: 23 pre-build, 28 after round 2, 26 after round 3 (8 new, 5 gone). The 8 new are steps of 0.01 to 0.36 yd by defenders waiting longer for their read. No tackler within 4 yd of the ball at the read newly reverses (pre-build the function reads 14 within 4 yd, 2 of them reversing, by the test's constant). The fastest away speed is 3.8 yd/s, read on 25 ms steps, which halve a short shove (amended 2026-11-24, slice 2). The bar of at most 23 was the lead's own, not the defect, so PR-C7 now checks the defect itself. The check is proven to fail with the ring cap off: seed 3 play 5 at 5.77 x his top, seed 6 play 151 at 4.94 x, seed 5 play 7 at 2.76 x, seed 1 play 172 at 1.26 x (amended 2026-11-24, slice 2; this closes the gap noted here).

**Two review findings on round 3 (amended 2026-11-24, being fixed).** The first is the DL release (PR3). The second: before the read, on 5 of 385 tacklers, the tackler could differ from his unnamed self inside the last key by up to 0.675 yd (earliest 38.7 ms before the read). "0 of 383" held only on a 25 ms grid. PR-C7's comparison is now at 1 ms steps.

**No visible shove (amended 2026-11-24, slice 2; Joseph, Settled 10).** The one-key comparison and its 0.146 yd limit are replaced: a rated tackler may differ from his unnamed self only in the last 50 ms before he departs, and is exact before that. Why: on 5 of about 390 tackles, at the catch, exact identity draws the ring's push (up to 71 yd/s), and the difference cannot be seen without comparing two versions of the play.

Tackler tally on S after round 2, not recounted for round 3's two changed delays (amended 2026-11-24). It replaces the earlier 212 = 144 + 46 + 30, which came from two overlapping tallies. 392 tackles: 140 leave at their `readMs`, 41 at a lower delay, 211 at the read. Of the 211: leg mean above 1.15 × top at every delay 118, peak above 1.15 × top 54 (48 on the built keys, 6 as drawn), under `convergeMs` left at every delay 30, his own read is 0 (a DL) 5, fact legs of his own (a QB) 4.

PR7. **Coverage and blocks before the read follow ratings, from ids, ratings and calls only.**
- Man trail lag = `man.lagMs` + the defender's `coverage` band (+300 to -110, was +150 to -90) + his receiver's `routeRunning` band (-80 to +180, was -40 to +100), at least `minLagMs`. A good route runner against a poor cover man gets open. Widened by Joseph, "Stronger" (amended 2026-11-24, slice 2, Settled 11). Sweep on S, corners in coverage presets, yards behind the receiver, 40 against 90: lag [150, -90] 0.86, [225, -110] 1.08, [300, -110] 1.15; receiver lag [-40, 100] 0.50, [-80, 180] 0.84, [-120, 250] 1.17. Zeroing the cushion does not help. Each alone kept every bar. The two together keep every standing bar on S; corners 1.01 yd (42 pairs) for lag and 0.67 yd (27) for receiver lag (docs/PERF.md, third round) (amended 2026-11-24, slice 2 accepted).
- Man cushion = today's + the defender's `speed` band (+1.0 to -0.5 yd). A slow defender gives ground.
- Stalk lag = `stalk.lagMs` + the blocker's band (+150 to -40, was -80; Joseph, Settled 13, amended 2026-11-24, slice 2): `runBlock` for a TE, awareness for a WR, who has no blocking skill. At awareness 90, R-C8 goes from 5 of 63 windows missed to 0 of 79. The stalk lock-on uses the larger of his own lag and `stalk.lagMs` (the lead's ruling). A rated blocker whose man comes inside `stalk.clearYards` 1.2 yd is backed off at his own top speed or less. Two more lead's rulings: a blocker who releases because his man leaves takes the tackler's exception, the last 50 ms before the read (up to 0.065 yd, 42 ms); and a blocker lets go of an interceptor at the throw (drawn in-flight difference up to 4.2 yd, was 14.5) (amended 2026-11-24, slice 2 accepted).
- Play-action bite: the offsets of a defender's `readStep.playAction` waypoints are × (1 + his awareness band, +0.6 to -0.6). A poor linebacker bites 2.4 yd, a sharp one 0.6. Recovery is his drop, at his own speed, from where the bite left him.

Rejected: a cushion relative to the receiver's speed (a second two-player band for a small visual gain). Rejected: a per-QB `fakeMs` (one player per play, and his drop end is fixed either way). Rejected: zone drift pace by rating, because PR9 is the zone defender's rating-driven behavior. Final in structure, values open.

PR8. **Break pace follows the player. Route shapes do not change.** At every designed break arc, `fillet.sharpPace` and `roundPace` are × (1 + his band, -0.25 to +0.25): `routeRunning` for a WR or TE, agility for everyone else, defenders coming out of a pedal included. Linemen's contact steps are left alone (amended 2026-11-24, slice 2, the lead's ruling). Waypoints, cards and the set preview are untouched (decision 3, R1, R-C11). Final in structure.

PR9. **Defenders break on the ball while it is in the air (approved, Joseph, 2026-11-23).** On every pass, an unnamed non-rushing LB, CB or S with the rating leaves his coverage at the throw + `airMs` and pursues the ball. `airMs` = max(`air.minMs`, `air.baseMs` + his band, +250 to -150, + his variation) + `manExtraMs` for a man defender, whose eyes are on his receiver (order amended 2026-11-24, slice 1 build: the floor goes last, PR3). The rating is `ballSkills` for a CB or S and `coverage` for an LB, so the players who read a handoff first are not always the ones who break first. The rule is the same for a completion, an incompletion and an interception, which removes a tell that exists today (pursuit starts after the throw on an incompletion and after the catch on a completion). Never implying a different result: from his break until the ball arrives he stays outside the held-ball ring (2.5 yd) of the catch point, and A3's clear check keeps applying on an incompletion. With PR9 the interceptor and the break-up defender depart at the throw + min(`airMs`, S), by PR6's rule. Rejected: zone defenders only (man defenders would stay frozen to their receivers through a 1.5 s flight). Final in structure, values open.

PR10. **Get-off: a first step inside 150 ms, then the drive (approved, Joseph, 2026-11-23).** `maxStartMs` 150, the `startMs` table and Joseph's "all 22 move from the snap" all stand: every mark's first movement stays where it is today. New: from his first movement until his drive time, `driveMs` later, an unnamed track is played at no more than `getOff.stepPace` × the pace it asks for. Then he drives normally. `driveMs` = max(0, his awareness band + `varyMs` × v) (the floor at 0 written out, amended 2026-11-24, slice 1 build, PR3). Offense +80 to 0, because it knows the count. Defense +240 to +40, because it reacts to the ball. The QB, the snapper and fact legs (a carrier to the mesh) are exempt. A linebacker's or defensive back's read step is already slow, and this makes it slower for longer, which is his diagnosis. Rejected: raising `maxStartMs` (it contradicts the amendment, and `parseMotion` refuses it). Rejected: no get-off difference (the snap stays uniform). Final in structure, values open.

PR11. **Nobody is drawn winning a block. Strength drives nothing in this spec.** The hand fight stays the same offset for both men of a pair (NM7, N5). What reads as strength is net push, and a dented pocket implies pressure the engine did not decide. Linemen differ by get-off (PR10), release (PR3), pursuit (PR5) and the existing speed and acceleration bands. Final for this spec. Joseph, 2026-11-23: a small strength effect is a follow-up spec of its own. It is deferred and not designed here.

PR12. **What a rating never changes, and what this spec's bands never change (amended 2026-11-23, pre-build baseline).** The decision is the same. The wording now separates what was always true from what was never true.
- **No rating, old band or new, changes an engine fact:** who carries, throws, catches, tackles, sacks, intercepts or recovers, the result, the yards, the dead spot's yard line (the ball's y at the whistle), the count and order of a named player's anchors, any label or flag text, any frame before the snap (P1, P3), any card or preview. The 2.5 yd ring, the flight ring and the carrier corridor (contract 3) are rules of the drawing that no rating relaxes, with one exception, approved by Joseph on 2026-11-24 (Settled 15): the push out of the corridor is eased (amended 2026-11-24, slice 2 accepted).
- **The eased lane push** (amended 2026-11-24, slice 2 accepted). On scrimmage plays only, a rated defender caught in the carrier's lane gets out of it at no more than his own top speed, where before he was moved out in one key. The 2.5 yd ring is not eased. Measured: unnamed defense over 3 x top 630 to 455; 223 defenders briefly in the lane against 55, longest 225 ms; nobody nearer the ball than 2.5 yd. Unrated players and kicks are as before (PR1).
- **The drawing's own choices between facts already move with today's speed and agility bands,** and this spec does not undo that: the lateral place of a catch and of the dead spot, the screen time of the handoff on a play scaled by k, and the break-up defender on an incompletion. Measured by the lead on S before the build, the app's ratings against none: the ball's x at the whistle differs on 129 plays (25 by more than 0.5 yd), a fact anchor's place on all 571 (96 by more than 0.1 yd, 13 by more than 1 yd), the handoff time on 127 of 280 runs, the fact-mark set on 6 incompletions.
- **What this spec promises is narrower: the `ratings.scrimmage` block moves none of those,** except through a rule that already reads a mark's own values. The exceptions, each with its bound, are listed in PR-C9 (b): the drawn miss on an incompletion, R8's wait for the target inside `throwHold` once his own break pace and get-off exist (slices 2 and 4), and the sack time from the sacker's arrival (slice 4).

Variance is never flattened to look fair: a 45 is late, and stays late. Final.

PR13. **Times are screen-clock ms and do not scale with k,** as `reactionMs`, the start times and `leadMs` do not today. Speeds and accelerations keep dividing by k. Final.

PR14. **Tuning in data, floors in tests.** Every new value is in `data/ui/motion.json` under `ratings.scrimmage`, validated by `parseMotion`. No existing key changes value except `version`, so the only pinned test value that moves is the version (see "Existing tests"). The floors in the criteria are test constants, so the data cannot loosen its own test. Final.

PR15. **A test record per mark.** `MarkNat` gains `react`, on scrimmage plays, for tests and playtest only, never shown:

| Field | Meaning |
|---|---|
| `readMs` | His scheduled reaction to the read (PR3), all terms included. For a rated mark `nat.reactionMs` holds the same number. Amended 2026-11-24, slice 1 build: for an unrated offensive mark `nat.reactionMs` keeps today's value, which nothing uses, while `react.readMs` is 0, the delay applied. So "`reactionMs` equals `readMs`" is a test for rated marks. |
| `delayMs` | The delay applied (amended 2026-11-24, slice 1 round 3). Equal to `readMs` (or `airMs` under PR9) for an unnamed mark that is not a DL, and at most that for a named one (PR6). For a DL it is his release minus the line's. The ring can release him early (PR3), so it may be below his `readMs` and is never above it: 263 of 2,187 unnamed DL marks on S are below, none above. |
| `pursueAt` | Screen time he leaves his track for the ball, scheduled, so it may be past `liveEnd`. `null` for a mark that never pursues: an OL, a stalker holding his block, and a converge-branch mark whose unnamed pursuit never starts before his own departure, whose `delayMs` is 0 (amended 2026-11-24, slice 1 round 3). |
| `vary` | His v for `vary:read`, in [-1, 1]. |
| `leadMs`, `turnShare`, `lateralAccel` | His pursuit values (PR5). `lateralAccel` is his own limit in yd/s². |
| `manLagMs`, `cushionYards`, `stalkLagMs`, `biteShare`, `breakPaceShare` | Slice 2, present when they apply to him. A blitz LB with a man target carries `manLagMs` (amended 2026-11-24, slice 2, the lead's ruling). |
| `stalkOf` | Slice 2 (added 2026-11-23, the lead's ruling): the id of the defender a stalking receiver shadows, `null` otherwise. It makes PR-C3's exception exact. |
| `airMs` | Slice 3. |
| `driveMs` | Slice 4. |

PR16. **A defender's dashed path ends at his own departure** (decision 13 kept: the drop is the call). Final.

### Designed values at a glance (arithmetic from the bands, with the slice 1 measurements beside it)

Amended 2026-11-24, slice 1 round 2. Measured by the engineer on S (seeds 1 to 6, 571 plays, the app's ratings), before the build and after round 2 (the independent test run was still in progress when this was written):

| Measure on S | Before | After slice 1, round 2 |
|---|---|---|
| Range of pursuit starts among counted non-DL defenders, p10 / p50 / p90 of plays | 72 / 120 / 160 ms | 208 / 321 / 440 ms |
| Share within 100 ms of the median defender, p10 / p50 / p90 of plays | median 1.00 | 0.33 / 0.57 / 0.83 |
| Plays where that share is 1.00 | 76.0% | 4.0% |
| `readMs` as drawn, LB, p10 / p50 / p90 | 101 / 147 / 213 | 118 / 280 / 453 |
| `readMs` as drawn, CB, p10 / p50 / p90 | 140 / 203 / 252 | 104 / 295 / 485 |
| `readMs` as drawn, S, p10 / p50 / p90 | 153 / 199 / 242 | 156 / 315 / 453 |
| `timeline()` per play, p50 / p90 | not recorded here | 3.4 / 6.0 ms |

Those meet PR-C2's floors (median range at least 250, median share at most 0.75, share 1.00 on at most 10% of plays).

The arithmetic table. The columns are the measured p10, p50 and p90 of awareness among non-DL defenders on the field. The same three values are used for the skill rows only to show the band. Skill percentiles were not measured. In the `readMs` row the measured figure beside each arithmetic one is the matching percentile of `readMs` as drawn, which includes spread and variation: a low rating is a late read, so rating 47 sits beside the measured p90 and rating 82 beside the measured p10. Rows with no measurement are slices 2 to 4 and are still arithmetic only.

| Value | Rating 47 | 62 | 82 |
|---|---|---|---|
| `readMs` LB, arithmetic before spread and variation (measured) | 411 (p90 453) | 285 (p50 280) | 117 (p10 118) |
| `readMs` CB, S, arithmetic (measured CB, S) | 461 (p90 485, 453) | 335 (p50 295, 315) | 167 (p10 104, 156) |
| Play variation on `readMs` | ±125 | ±92 | ±48 |
| Offense `readMs` | 312 | 231 | 123 |
| `leadMs` | 220 | 370 | 570 |
| Man lag against a 62 route runner (amended 2026-11-24, slice 2; was 288, 216, 120) | 427 | 304 | 140 |
| `airMs` (zone defender) | 444 | 324 | 164 |
| `driveMs` defense / offense | 212 / 69 | 152 / 45 | 72 / 13 |

By the arithmetic the p10 and p90 defender on the field start pursuit about 294 ms apart before variation, against 84 ms before the build. Measured, the range of pursuit starts on the median play went from 120 ms to 321 ms.

## Slice 5: kickoffs and punts (added 2026-11-23, Joseph: "Include kicks")

Designed, display only, like the rest. I read KR1 to KR9 and the `kickReturn` note in `motion.json`, the kick plans and the return plan in timeline.ts (1252 to 1401, 1863 to 2145), `kr8-digest.ts` and `kr8-baseline.json`. Nothing in this section changes slices 1 to 4.

What the code does today:

1. On a kickoff return every unblocked coverage man leaves his lane for the returner on the same key, the catch. The kicking team is side O, and side O has no reaction (timeline.ts 1772, 2086).
2. A return blocker's setup ends, and his block or lead starts, at the catch + `reactOf` (timeline.ts 1922): his table value and today's ±60 ms awareness band.
3. The tackler leaves at the catch, in 0 ms (timeline.ts 1975).
4. Every returner cuts at one `kickReturn.cutPace` and one `cutLateralAccel`.
5. On a punt the returner runs straight. The punt team's non-linemen pursue the ball from the landing with no reaction, its linemen stay engaged to the whistle, and the return unit's non-linemen pursue at the landing + `reactOf`. There is no wall, no block and no cut: the kickoff return pass left punts as they were.

PR17. **Kickoffs, onside kicks and punts are in scope, as slice 5, built last (amends PR2).** Through slice 4 every kick is drawn as today, with or without ratings. From slice 5 these plays read ratings as below. Field goals, extra points, kneels and spikes stay as today at any ratings: nothing on them reacts to a read, and the rush against the protection is the hand fight (PR11). **PR1 holds on every kick: with no ratings passed, every kick Timeline is today's, key for key. The KR8 baseline file (`kr8-baseline.json`, built with no ratings) stays untouched.** Corrected 2026-11-24, slice 1 round 2: this sentence first said the KR8 baseline "must keep passing". KR8, and KR1 on 13 fixtures, in kickoff-return.spec.test.ts were already red on the pre-build tree. So the bar for slice 5 is no change to their failures with no ratings, which PR-C1's digest already guarantees for the no-ratings kick keys. Fixing them is part of the separate standing-checks work (Non-goals). Rejected: a separate set of kick bands. The read, the lead and the turn are the same behaviors, so they share one tuning. Final.

PR18. **The scrimmage rules apply on kicks by side: PR3 (the read), PR4 (variation), PR5 (pursuit), PR10 (get-off).** The read on a kick is the code's `plan.read`: the landing or the catch, and the kick itself on a blocked punt.
- Kicking team (side O), every unnamed man but the kicker or punter: he leaves his lane at the read + his `readMs`, with `read.offenseMs` added to today's 0. On a kickoff return he then steers for his contain point as today (KR9). On a punt he pursues the ball as today. His get-off uses `getOff.offenseMs`, because he goes on the kicker's approach or the snap count.
- Receiving team (side X): `read.defenseMs` on his table value, and `getOff.defenseMs`, because he reacts to the kick. A punt-return DL releases at today's release + `read.releaseMs`.
- The kicker, the punter, the snapper and the returner run fact legs and are exempt, as PR10 already says.

PR7, PR8 and PR9 do not apply on kicks: there is no coverage call, no break and no pass. Why by side: it is the plumbing slices 1 and 4 build, and it needs no new band. Final in structure, values shared with scrimmage.

PR19. **The wall is set as today. The rating moves when a blocker leaves it.** On a kickoff return each blocker's lane, depth and row are unchanged and still come from the lineup alone (KR7). He leaves the wall for his block or his lead at the catch + `wallMs`, where `wallMs` = max(`read.minMs`, table + NM4 spread + `wallReadShare` × (his band + his variation)) (order amended 2026-11-24, slice 1 build: the floor goes last, PR3). His setup ends at the catch + min(`wallMs`, table + NM4 spread), so the wall at the catch is today's or a little earlier (KR2, KR3). Between the two he holds his wall spot and is never still for more than 300 ms (KR2's rule). Why a share of the band and not all of it: half a second at the wall on a 16 yd return leaves no time to reach a block, and KR5 needs half the blockers engaged. Which man he blocks is today's rule (the earliest contact that works, never the tackler). Ratings reach it only through when he leaves and how fast he runs. Nobody is drawn winning a block (KR5, PR11). Rejected: blocks picked by rating, a choice the geometry could contradict. Rejected: a blocking-skill band, because only the TE has a blocking skill among the return unit's positions. Final in structure.

PR20. **Coverage pursuit is per player, and the tackler is bounded by his anchor.** PR5's lead and turn apply to every coverage man's pursuit. The contain point, `containYards`, the corridor (KR9) and the ring are untouched. The engine's tackler follows PR6: he leaves at the catch + min(his `readMs`, S). The block plan keeps reading the tackler as he is drawn, so nobody blocks him (KR5). A tackler with fact legs of his own (the kicker) departs as today. Final.

PR21. **The returner's cut follows his rating. Its side and its place do not.** On kickoff returns of `cutMinReturnYards` or more, `kickReturn.cutPace` is × (1 + his `breakPaceShare` band) and `kickReturn.cutLateralAccel` is × (1 + his `pursuit.turnShare` band), both read through a new `by.cut`: `elusiveness` for an RB, agility for anyone else. An elusive returner keeps his speed through a tighter cut. A poor one slows and rounds it. The side (toward the blocks, the id hash on a tie), where he cuts (`cutLagsMs`), `cutYards` and `cutDepthYards` are unchanged (KR6, KR7). His carry is timed so he stays inside N1 at his own cut pace, so the whistle may move by that much, by the rule that already times the carry from his own speed (PR12). Rejected: a cut side or an extra cut by rating. That is a decision made by a rating, and it would read as elusiveness beating a tackler the engine named. Fallback: if the engineer finds the pace cannot move without breaking KR6 or KR7, the cut keeps `cutPace` and only the radius follows the rating. That is a FLAG to the lead, not a silent change. Final in structure.

PR22. **Punts get reactions, not a return design.** PR18 and PR20 apply: the punt team's non-linemen, the return unit, the DL release, the tackler. The punt returner still runs straight. There is no wall, no block and no cut, and punt-team linemen stay engaged as today. A punt return pass is its own spec (Non-goals). Final for this spec.

**What stays fixed on every kick.** The engine's dead spot, returner, tackler, kicker and outcome. The kick time, the hang, the landing time and place. Every label. KR1 to KR9, at their own pass bars. The 2.5 yd ring and the KR9 corridor. The wall's geometry and the rule that pairs blocks. Any frame before the snap.

| Play | With no ratings | With ratings, from slice 5 |
|---|---|---|
| Kickoff with a return | Today's keys | PR18 to PR21. |
| Kickoff touchback, fair catch, out of bounds | Today's keys (KR8 baseline) | The get-off and the run down the lanes by PR18. The play ends 300 ms after the landing, so most reactions to it fall after the whistle and are not seen. Landing, label and whistle unchanged. |
| Onside kick | Today's keys (KR8 baseline) | The same as a touchback. The recoverer's leg is unchanged. |
| Punt with a return | Today's keys (KR8 baseline) | PR22. |
| Punt fair catch, downed, out of bounds, touchback, blocked | Today's keys (KR8 baseline) | Get-off and reactions by PR18. Nothing else. |
| Field goal, extra point, kneel, spike | Today's keys | Today's keys. |

Designed values on a kick, by the same arithmetic (rating 47 / 62 / 82): a coverage man's `readMs` 312 / 231 / 123 before variation, a blocker's `wallMs` 307 / 231 / 130 at an LB, RB, WR or TE table value and 50 more for a CB or S, the returner's cut pace 0.62 / 0.73 / 0.88 of his top.

`MarkNat.react` is filled on kickoffs and punts from slice 5. For a blocker `readMs` holds his `wallMs` and `pursueAt` is when he leaves the wall. For a coverage man `pursueAt` is when he leaves his lane. A cutting returner gets `cutPaceShare`.

## `data/ui/motion.json`: schema change, version 4 to 5 (approved, Joseph, 2026-11-23), then 6 (approved, Joseph, 2026-11-24)

Version 6 adds one key, `ratings.scrimmage.stalk.clearYards` 1.2 (Settled 14), and nothing else (amended 2026-11-24, slice 2 accepted).

One new block, `ratings.scrimmage`. Every other key keeps its value and meaning, with one narrowing: on scrimmage plays `ratings.default.reactionMs` is replaced by `scrimmage.read`. `ratings.note` is reworded to say so. A pair is [value at `ratings.lo`, value at `ratings.hi`], linear between, as today.

| Key under `ratings.scrimmage` | Starting value | Read by | Decision |
|---|---|---|---|
| `by.read`, `by.lead`, `by.bite`, `by.getOff` | `{ "default": "awareness" }` each | which rating drives the effect, by position | PR3, PR5, PR7, PR10 |
| `by.turn` | `{ "default": "agility" }` | | PR5 |
| `by.manLag` | `{ "default": "coverage" }` | | PR7 |
| `by.receiverLag` | `{ "default": "routeRunning" }` | | PR7 |
| `by.cushion` | `{ "default": "speed" }` | | PR7 |
| `by.stalkLag` | `{ "default": "awareness", "TE": "runBlock" }` | | PR7 |
| `by.breakPace` | `{ "default": "agility", "WR": "routeRunning", "TE": "routeRunning" }` | | PR8 |
| `by.air` | `{ "default": "coverage", "CB": "ballSkills", "S": "ballSkills" }` | | PR9 |
| `read.minMs` | 80 | floor before variation | PR3 |
| `read.defenseMs` | [320, -100] | added to `reactionMs[position]` | PR3 |
| `read.offenseMs` | [350, 80] | added to today's 0 | PR3 |
| `read.releaseMs` | [250, 0] | added to the DL release | PR3 |
| `read.varyMs` | [140, 30] | × v | PR4 |
| `pursuit.leadMs` | [-250, 250] | added to `pursuit.leadMs` 400 | PR5 |
| `pursuit.leadVaryMs` | [120, 20] | × v | PR5 |
| `pursuit.leadMinMs`, `pursuit.leadMaxMs` | 50, 800 | clamp | PR5 |
| `pursuit.turnShare` | [-0.25, 0.25] | × lateral limit and `turnDegPerS` | PR5 |
| `man.lagMs` | [300, -110] (was [150, -90]; amended 2026-11-24, slice 2, Settled 11) | added to `man.lagMs` 150 | PR7 |
| `man.receiverLagMs` | [-80, 180] (was [-40, 100]; amended 2026-11-24, slice 2, Settled 11) | added, from the receiver | PR7 |
| `man.minLagMs` | 40 | floor | PR7 |
| `man.cushionYards` | [1.0, -0.5] | added to the cushion in use | PR7 |
| `stalk.lagMs` | [150, -40] (was [150, -80]; amended 2026-11-24, slice 2, Settled 13) | added to `stalk.lagMs` 150 | PR7 |
| `stalk.clearYards` | 1.2 (version 6; added 2026-11-24, slice 2 accepted, Settled 14) | how near a man running at a rated blocker comes before the blocker is backed off, at most `stalk.contactYards` | PR7 |
| `biteShare` | [0.6, -0.6] | × `readStep.playAction` offsets | PR7 |
| `breakPaceShare` | [-0.25, 0.25] | × `fillet.sharpPace`, `roundPace` | PR8 |
| `air.baseMs`, `air.minMs`, `air.manExtraMs` | 250, 80, 150 | | PR9 |
| `air.ms` | [250, -150] | added to `air.baseMs` | PR9 |
| `air.varyMs` | [120, 30] | × v | PR9 |
| `getOff.stepPace` | 0.35 | share of the track's pace | PR10 |
| `getOff.offenseMs`, `getOff.defenseMs` | [80, 0], [240, 40] | | PR10 |
| `getOff.varyMs` | [60, 10] | × v | PR10 |

`parseMotion` refuses: a missing key; a `by` rating that is neither a base rating nor a skill of that position; a `varyMs` pair that breaks the span rule below; `turnShare` or `breakPaceShare` outside ±0.3; `biteShare` outside ±0.8; `stepPace` outside (0, 1]; a `getOff` value above 400; `pursuit.leadMinMs` above `pursuit.leadMaxMs` (amended 2026-11-24, slice 1 build); a negative `read.minMs` (amended 2026-11-24, slice 1 round 2); a `stalk.clearYards` that is not above 0 or is above `stalk.contactYards` (amended 2026-11-24, slice 2 accepted). Those limits are in code because they protect acceptance tests, not balance.

**The `varyMs` span rule (stated exactly, 2026-11-23).** The span of a pair [a, b] is |a - b|. For each variation pair V and every band pair B it is added to, span(V) < span(B). So a variation pair's span must be smaller than the smallest span among its bands. That is what makes a higher rating never later for any v in [-1, 1] (PR-C3). The pairings, with the starting values:

| Variation pair | Bands it is added to | Check |
|---|---|---|
| `read.varyMs` [140, 30], span 110 | `read.defenseMs` (420), `read.offenseMs` (270), `read.releaseMs` (250) | 110 < 250 |
| `pursuit.leadVaryMs` [120, 20], span 100 | `pursuit.leadMs` (500) | 100 < 500 |
| `air.varyMs` [120, 30], span 90 | `air.ms` (400) | 90 < 400 |
| `getOff.varyMs` [60, 10], span 50 | `getOff.offenseMs` (80), `getOff.defenseMs` (200) | 50 < 80 |

Every starting value passes. The slice 2 values of 2026-11-24 change no row: no variation pair is added to a man or stalk band (amended 2026-11-24, slice 2). `ratings.kick.wallReadShare` scales a band and its variation by the same share, so it cannot break the rule.

One interface change that is not game data: `TimelineCtx.ratings` (timeline.ts 245) accepts `strength` and the position skills as well, and `motionRatings()` (app.ts 503) passes them. Slice 2 needs it.

If the engineer wants a different key shape, it goes back to Joseph before the build: his approval covers this list.

### Added for slice 5 (PR-Open 7; approved, Joseph, 2026-11-24, Settled 7; amended 2026-11-24)

Version 6 to 7, at slice 5 only (was 5 to 6; version 6 is now slice 2's) (amended 2026-11-24, slice 2 accepted). One new block, `ratings.kick`. Slices 1 to 4 do not read it and must not depend on it: until slice 5, `parseMotion` takes version 6 with no `ratings.kick`.

| Key under `ratings.kick` | Starting value | Read by | Decision |
|---|---|---|---|
| `by.cut` | `{ "default": "agility", "RB": "elusiveness" }` | which rating drives the returner's cut | PR21 |
| `wallReadShare` | 0.6 | share of the `read.defenseMs` band and of `read.varyMs` applied to a return blocker leaving the wall | PR19 |

Everything else slice 5 uses is already approved and shared with scrimmage: `read.minMs`, `read.offenseMs`, `read.defenseMs`, `read.releaseMs`, `read.varyMs`, every `pursuit` key, every `getOff` key, `breakPaceShare`, and `by.read`, `by.lead`, `by.turn`, `by.getOff`. On kickoffs and punts `scrimmage.read` replaces `ratings.default.reactionMs`, which then applies to field goals and extra points only. `parseMotion` refuses a missing key, a `by.cut` rating that is neither a base rating nor a skill of that position, and a `wallReadShare` outside (0, 1].

## States and edge cases

| State | Behavior |
|---|---|
| No `ctx.ratings`, or a player not in it | Today's motion for him, key for key (PR1). |
| A player lacks one rating an effect reads (an RB has no `routeRunning`) | That effect adds 0 for him. |
| Rating below 40 or above 90 | Clamped to the band end, as today. A 92 and a 99 share the band value and differ by spread and variation. Accepted, the same `lo` and `hi` already govern speed. |
| Named player whose `readMs` is longer than his anchor allows | He leaves earlier, by PR6. `delayMs` < `readMs`. |
| Named player who is already anchor-demanded with no delay | `delayMs` 0, drawn as today. |
| `pursueAt` within 75 ms of the whistle or after it (a slow reader on a short play) | He never pursues. He runs his track to the whistle and settles. The measures use his scheduled `pursueAt`. |
| Live time stretched to the 1.8 s floor (k > 1) or compressed at the 14 s cap (k < 1) | Delays, lags and leads are not scaled (PR13). Speeds are, as today. |
| Sack, scramble | The read is the code's `plan.read` for that play. PR3 to PR6 apply. The sacker departs as today. |
| Fumble | A recoverer is his unnamed self, own reaction and pursuit included, until his read, then as today. |
| Play action | PR7's bite. Everything else as on any pass. |
| Incompletion | A3's breaker choice reads the drawn defenders, who now differ by rating. That is geometry, as designed. R-C16 to R-C20 stand. |
| Kneel, spike, no play, field goal, extra point | Unchanged at any ratings. |
| Kickoff, onside kick, punt | Unchanged through slice 4 (PR2). From slice 5, the table under "Slice 5". |
| Return blocker whose `wallMs` is shorter than his table reaction (a sharp one) | His setup ends at the catch + `wallMs` and he leaves at once. No hold. |
| Return blocker still holding the wall when the returner reaches it | Reachable on a short return with a slow reader. KR4 still applies: he is not behind the carrier by more than the tolerance. A miss is a FLAG to tune `wallReadShare`, never the KR bar. |
| Kick tackler whose `readMs` is longer than his anchor allows | He leaves earlier, by PR6, as on a scrimmage play. |
| 2x | The same keys at double rate. A 300 ms spread reads as 150 ms. Floors are measured at 1x. Accepted. |
| Reduced motion, skip | The final post-settle frame only. Where marks end differs by rating. No new information is carried by motion alone. |
| Hover card open | The animation pauses, as today. |
| `motion.json` invalid | The existing "Game data failed its check: data/ui/motion.json". |
| Loading, permission denied | Not applicable: a pure function with no I/O. |

## Superseded in the motion spec

Quoted text, and what replaces it. Nothing else is superseded: decision 10, R-C7, R-C9, R-C19, R-C20, NM2, P1, P3, A1 to A3, N1 to N7, KR1 to KR9 and the 14 s cap all stand.

1. Motion, "Defenders reacting and pursuing": "plus a reaction delay (150 ms for LB, 200 ms for DB, 250 ms for DL)" and "each diagram defender steers toward the point where the ball will be 400 ms ahead. It turns at most 180 degrees per second". These become the values of a player with no ratings (PR3, PR5).
2. Same section: "DL stay engaged until the carrier is 3 yd past the line, or 400 ms after the throw." Plus each DL's own release delay (PR3).
3. NM4: "The variation comes only from the id and the on-field set, both known before the snap, never from calls, target or result." It now also comes from ratings and the pre-snap game state. Still never the target or the result (PR4).
4. NM2: "the read for the tackler". Now the read plus his applied delay (PR6), with the last 50 ms before he departs excepted for a rated tackler (amended 2026-11-24, slice 2), and under PR9 the throw plus his applied delay for the interceptor.
5. R9: "He trails that receiver's *template* route `man.lagMs` behind, with `man.cushionYards` of cushion". R10: "`stalk.lagMs` behind his motion". Each mark's own values (PR7). R-C8's bound B reads his own lag.
6. R-C6's apex bound reads the mark's own break pace (`nat.react`), by the rule NM4 already set for top speed and `accelMs`. Corrected 2026-11-23: N2 has no test as built ("N2 was dropped with the governor", natural-motion.spec.test.ts line 2), so there is no N2 lateral bound to re-read. The mark's own lateral limit is checked only by PR-C6's record bound.
7. R-C10 (b), the rotation timing bullets at snap + 2,000 and + 2,300 ms: checked with no ratings only. They test the template. A low-awareness safety arriving late is the point of this spec. The direction check holds at any rating.
8. Decision 13 and M10: "up to the read moment". Up to his own departure (PR16).
9. R-Open 7 (closed 2026-11-15): "`plan.read` stays as the catch on completions and interceptions". PR9 is approved (Joseph, 2026-11-23), so rated non-rushing LB, CB and S leave at the throw plus `airMs` instead. `plan.read` and its other uses stay.
10. `motion.json` `ratings.note`: "65 ... maps to about the middle". Not on scrimmage reactions (PR3).

From slice 5, for kicks:

11. KR8: "For touchbacks, fair catches, kicks out of bounds, onside kicks and every punt, keys are identical to the build before this pass." With no ratings this spec changes no kick key (PR-C1's digest), which is how the baseline was built. The KR8 test itself was already red before this build (PR17, corrected 2026-11-24). With ratings those plays follow PR18 and PR22.
12. The kickoff return amendment, "Overrides, for kickoffs only": "Punts, onside kicks, touchbacks, fair catches and kicks out of bounds are unchanged." With ratings they get reactions by side (PR18, PR22). Punts still get no wall, block or cut.
13. The `kickReturn` note in `motion.json`: "From the catch he meets a coverage man at blockPace". From the catch + his own `wallMs` (PR19). And "its corners run at cutPace and rounded so the turn's lateral acceleration is cutLateralAccel": at his own share of each (PR21).
14. PR2 of this spec, and PR-C1's sentence on kick plays with ratings: see PR17 and PR-C16.

From slice 2 (amended 2026-11-24, slice 2 accepted):

15. Contract 3, the lane rule: "They also stay out of a 2 yd half-width corridor along the carrier's next 1.0 s of path." A rated defender on a scrimmage play who is caught in it leaves at his own top speed, so he may be inside it briefly (PR12). The ring in the same sentence stands.

KR1 to KR9 themselves are not superseded. They must pass with ratings at their own bars (PR-C17).

Addressed and kept, not superseded: the 2026-11-14 amendment, "Staggered starts mean reaction time only, at most 150 ms after the snap for any player", and "all 22 move from the snap". PR10 reads the 150 ms as a bound on first movement and keeps it. Joseph approved that reading on 2026-11-23 ("Slow first step at the snap").

## Acceptance criteria

Headless, on the Timeline from `timeline()` at 1x.

**Sample S:** `simGame(seed)` for seeds 1 to 6 (packages/app/test/sim-games.ts), every play whose `play.kind` is `run` or `pass` (571 today), built with `{ event, runoffSeconds: 0, human: null, ownStart: "lined" }` and every player's card ratings and skills in `ctx.ratings`. **Fixtures:** COMPLETE, RUN, SACK and ALL_FIXTURES, with a fixed rating table the test supplies, covering 40 to 90. **Counted defenders:** side X, position not DL, not in `tl.involved`, not `tl.tackler`, `pursueAt` not null. **A/B method:** the same event built twice with one rating of one unnamed player set to 40 and to 90, in a test copy of the motion data that zeroes every other band reading that rating (`ctx.motion` is an input, as motion.test.ts already overrides it). Pairs are (play, player) over the fixtures and every 5th play of S.

I could not run code in this session. Floors on behavior that does not exist yet are set at about half of the arithmetic expectation shown. Slice 1 starts with the engineer's probe run, and the real values go in docs/PERF.md. A floor missed for want of tuning is fixed in data. A floor that cannot be met for a reason in the geometry comes back to the lead as a FLAG with the measurement. Nobody edits a floor in a test.

### Standing checks: the pre-build baseline (added 2026-11-23, the lead's ruling)

The test-writer found, and the lead verified on a copy of the pre-build tree (timeline.ts sha256 f8474557..., the same at HEAD 59e1f6f), that several checks from earlier specs were red before this build. These checks were red before this spec. Fixing them is out of scope here (Non-goals). So wherever a criterion below says a check from an earlier spec passes or holds (PR-C8, C10, C12 to C14, C17, C20, C22), the bar is **no regression, not green**:

- On S with the app's ratings, the number of plays failing each check after the build is at most its count in the table below. The counts are test constants.
- With no ratings the failures are exactly today's, because the keys are (PR-C1).
- On the fixtures, every (check, fixture) pair that passes before the build still passes: with no ratings by PR-C1, and with the test's rating table against a run of the pre-build tree with the same table.
- A standing check that is not in the table is expected green. If one is found red on the pre-build tree, the lead adds it here with its count. It is never dropped or loosened in a test.
- For slice 5 the same rule applies to the kick checks (KR1 to KR9 and the checks KR1 names), against counts the test-writer takes with ratings from the tree slice 5 starts from.

### Slice 2 accepted (amended 2026-11-24, slice 2 accepted)

Joseph accepted slice 2 on 2026-11-24 with these 7 red tests listed. None is loosened:

1. The per-mark test, unnamed marks: 88 offense and 99 defense over their bar in 12 games, on the heavy test.
2. The per-mark test, tacklers: 16.
3. The shove test (PR-C7): seed 2 play 31, seed 4 play 46, seed 5 play 27.
4. Recovery (PR-C12 a): seed 2 play 79.
5. The stalk lock: seed 1 play 155 (the test says WR3).
6. N4 on the FUMBLE_LOST fixture.
7. N6's settle on the INCOMPLETE fixture.

**The stalk lock test is a test choice (the lead's ruling).** It reads "the better blocker over 1.0 yd/s off his man at the worse one's lock". No criterion here sets that number.

**The plays-counted bars missed regressions.** A standing check that counts plays failing cannot see one more player failing on a play that already failed, and most plays already failed N1. So the bars in this section stayed green while players got worse against their own pre-build peaks: 183 marks over in slice 1, 325 at worst in slice 2, 203 now (88 + 99 + 16), against 0 before. Over the same span total excess fell from 8,424 to 6,369, by the engineer's sum. Both are true: the total is better and 203 individual marks are worse. **Per-mark is the measure from now on**. The plays-counted bars stay as they are. The bar for a mark is 1.5 x his top or 1.10 x his own pre-build peak (docs/PERF.md, slice 2, fourth round).

Amended 2026-11-24, slice 1 round 2: the "after slice 1" column (the engineer's run), M7's counts, and the fixture pairs the test-writer captured on the pre-build tree with the test's rating table. There are 18 live fixtures. Every (check, fixture) pair not listed passed before the build and must still pass.

| Check | S with the app's ratings: plays failing before the build (the bar) | After slice 1, round 2 | S with no ratings | Fixtures red before the build, with the test's rating table |
|---|---|---|---|---|
| N1 | 547 | 547 | 545 | all 18 |
| N3 | 54 | 45 | 73 | FIELD_GOAL_MISS, KNEEL |
| N4 | 77 (the bar is 88, by the allowance below) | 83 | 64 | INCOMPLETE, INTERCEPTION, TOUCHDOWN, KICKOFF_RETURN, STANDOUT_RUN |
| N5, moving | 369 | 366 | 333 | COMPLETE, INCOMPLETE, INTERCEPTION, RUN, SACK, FAIR_CATCH, FIELD_GOAL_GOOD, UNNAMED_COMPLETE |
| N5, engaged, and M6 | 384 | 384 | 382 | INCOMPLETE, RUN, TOUCHDOWN, SACK, FUMBLE_LOST, PUNT_RETURNED, FAIR_CATCH, FIELD_GOAL_GOOD, FIELD_GOAL_MISS, HOLDING_ON_RUN, UNNAMED_COMPLETE, STANDOUT_RUN |
| N6, settle | 334 | 321 | 316 | INTERCEPTION, RUN_OUT_OF_BOUNDS, TOUCHDOWN, SACK, FUMBLE_LOST, PUNT_RETURNED, FIELD_GOAL_GOOD, FIELD_GOAL_MISS, HOLDING_ON_RUN, UNNAMED_COMPLETE, STANDOUT_RUN |
| N6, anchors exact | 1 (seed 4 play 124) | 1 | red on the same play | none |
| A3, ring | 2 (seed 5 plays 70 and 77) | 0 | not counted | none |
| R-C5, nobody frozen | 7 (play-action plays in seeds 2 and 5) | 7 | not counted | none |
| M5 | 2 (seed 3 play 116, seed 5 play 158) | 1 | not counted | none |
| M7 | 4 (seed 3 play 141, seed 4 play 67, seed 5 play 137, seed 6 play 40) | 4 | 2 | none |

M7 in slice 2 (amended 2026-11-24, slice 2): it read 5 plays on S against its bar of 4, and the rated settle now inserts a key at the whistle, which takes it to 0.

Every check is at or under its bar after round 2. A3's corridor and N2 have no existing check on scrimmage plays, and this spec adds none. The heavy run reports only, by design: it has no bar.

**The N4 allowance (amended 2026-11-24, slice 1 build; the lead's ruling, approved by Joseph on 2026-11-24, Settled 8).** This is an allowance on one check that was already red before this spec. N4 (no cruise plateau) went from 77 failing plays to 82 on S after slice 1, with churn: 15 plays newly failing and 10 newly passing. It reads 83 with the DL release delay off, so the DL rule is not the cause. The engineer's finding: a later read leaves a mark at a steady pace for longer, which is the existing N4 defect seen for longer, and it cannot be fixed inside this spec without changing unrated keys, which PR1 forbids. So N4's bar on S is 88: the pre-build 77 plus 11, which is 2% of the 571 plays. Every other check in the table keeps its pre-build count as the bar. The allowance is not a fix. The fix belongs to the separate work on the standing checks (Non-goals).

**N4 after round 2 (amended 2026-11-24, slice 1 round 2).** Looked at and left: 83 on S against the allowance of 88. Of the 16 newly failing plays, 9 are offensive marks (6 of them a WR on a run, a stalker shadowing a defender whose motion changed) and 7 are defenders. The wobble is present but happens to cancel the built speed variation (1.5% to 1.9% against the 2% N4 asks), so adding wobble does not help.

**Slice 1 against the baseline (amended 2026-11-24, slice 1 round 2).** As first built, N1 was 550 against 547 and N5 engaged 392 against 384, and N6's settle newly failed on the INCOMPLETE fixture (OL4, OL5). The first account put all of it on the DL release delay. The engineer's corrected account of N1's 8 newly failing plays: 4 a DL near the line popped in the settle when an incompletion's ball respots, 3 a DL still stepping to contact with the fight on, 2 an offensive WR's ring pop. Round 2 removed the second group (the fight now ends at the line's release, PR3). The first group is still there, and N1 now has 5 plays newly failing against 5 newly passing, so it stands at 547. Amended 2026-11-24, slice 1 round 3: the three groups count 9 marks on 8 plays, because seed 2 play 151 had both a DL mark and a WR mark.

| # | Slice | Criterion | How it fails |
|---|---|---|---|
| PR-C1 | all | **Legacy, key for key.** With no `ctx.ratings`: every fixture and every play of sim games seeds 1 to 4 gives the same digest (every mark's keys, the ball, ball scale, paths, `liveEnd`, `total`) as a baseline captured from the commit this build starts from, in the manner of `kr8-digest.ts`. With the app's ratings: every kick play gives its baseline digest too (through slice 4; from slice 5 PR-C16 replaces this sentence). The baseline is recaptured only by a person who has checked a change was intended. | Any changed key. |
| PR-C2 | 1 | **Perceptibility, measured as the probe does.** Per play of S with 4 or more counted defenders: start_i = `pursueAt` - `snapAt`, range = max - min, share = the fraction within 100 ms of the median. Over S: median range at least 250 ms (today 130 by the probe, which divides the reaction by k where the code at timeline.ts 1772 does not, so today's figure by this measure is a little higher on plays stretched to the 1.8 s floor). Median share at most 0.75 (today 1.00). Share equal to 1.00 on at most 10% of plays. | Everyone still goes together. |
| PR-C3 | 1 | **Monotonic, and nobody else moves (amended 2026-11-23, pre-build baseline).** For COMPLETE, RUN and every 11th play of S, each counted defender D is built at awareness 40, 55, 70, 85 and 90 with the shipped data (90 added, amended 2026-11-24, slice 1 build: it is where the floor binds, PR3). D's `readMs` and `pursueAt` never rise as awareness rises, and fall by at least 200 ms from 40 to 85. Every other mark's keys are identical across the five builds, with two exceptions. On an incompletion every mark may differ from the throw on (A3 reads the drawn defenders). And a stalking receiver may differ: in slice 1 the stalk pairing cannot be read from the Timeline, so any offensive WR or TE mark may differ. From slice 2 `nat.react.stalkOf` exposes the pairing, and the exception narrows to the receiver whose `stalkOf` is D. **The DL release (amended 2026-11-24).** For each unnamed DL, not a tackling DL, on every 55th play of S and on seed 2 play 59, seed 5 play 71 and seed 1 play 94, built at awareness 40 to 90 by 2: his `delayMs` and his `pursueAt` - `tl.read` never rise as awareness rises. The heavy suite runs it on every 4th play. | A sharper player is later, a sharper DL releases later, or one player's rating moves another. |
| PR-C4 | 1 | **Play to play.** Over S, for each player with 15 or more snaps as a counted defender: his `vary` values span at least 0.8, and no two consecutive snaps share one. The median standard deviation of `readMs` among the bottom third by awareness is at least 1.5 × that of the top third. `vary` is identical for two events that differ only in `play` or `after`, and differs for at least half the marks when `before.clock` changes by 1. | The same player identical every snap, steady players as erratic as poor ones, or variation that knows the result. |
| PR-C5 | 1 | **Angle by awareness (A/B on `pursuit.leadMs`).** `nat.react.leadMs` at 90 exceeds that at 40 by at least 300. Lead angle θ(t): from the bearing to the ball at t to his heading (p(t+25) - p(t-25)), positive toward the ball's heading. Keys count from `pursueAt` + 300 to `liveEnd` - 400 where his speed is at least half his own top / k, the ball's is at least 3 yd/s and he is 6 yd or more away. A pair needs 8 counted keys in both builds. Mean θ at 90 minus mean θ at 40: median over pairs at least 4 degrees, and above -1 degree on at least 85% of pairs. | Everyone runs at the ball the same way. |
| PR-C6 | 1 | **Turn by agility (A/B on `pursuit.turnShare`).** For pairs whose heading at `pursueAt` is 60 degrees or more off the bearing to the ball: the time until it is within 20 degrees is no longer at 90 than at 40 on at least 90% of pairs, with a median gain of at least 50 ms. `nat.react.lateralAccel` is within 0.7 to 1.3 × `natural.lateralAccel`. | Agility changes nothing in a turn. |
| PR-C7 | 1 | **Named players (amended 2026-11-24, slice 1 build).** For every tackler in S and the fixtures: `delayMs` ≤ `readMs`. When `delayMs` > 0, his leg to the tackle is not in `nat.demanded`. When `delayMs` < `readMs` - 25, he left as late as the anchor allowed, which means at least one of these holds: (a) that leg's mean speed is at least 0.7 × his own top / k; (b) that leg's drawn peak speed is at least 1.0 × his own top / k, so the peak bound of PR6 is what stopped a later departure; (c) the read is less than `convergeMs` + 25 ms before the whistle, so S is 0 by rule; (d) he has fact legs of his own before the tackle, so he departs as today under PR6; (e) PR6's ring rule bound his departure, meaning his unnamed self (the build naming another tackler) is first pushed by the ring within one 25 ms key after his departure (amended 2026-11-24, the lead's ruling, confirmed by review). Two readings, as the test has them (amended 2026-11-24, slice 1 round 2): the peak speed in (b) is his fastest 25 ms step from his departure to the whistle, and "fact legs of his own" in (d) means he has another role besides tackler or a fact anchor besides the tackle. Such a tackler is also left out of the unnamed-self comparison below. The first wording had (a) alone, and it failed on 6 tacklers for reasons that are the rule working: short bowed legs whose peak is 1.5 to 2.7 times their mean, too little time, and a QB tackler. **His unnamed self (amended 2026-11-24, slice 2; Joseph, Settled 10; this replaces the one-key comparison and the 0.146 yd limit).** Up to 50 ms before his departure (the read + `delayMs`), he equals (1e-6 yd) a build of the same event in which another defender is named as the tackler, read on the 25 ms grid from the start and at 1 ms steps from 200 ms before the read. In the last 50 ms he may differ. **Not thrown off the ball (amended 2026-11-24; Joseph, Settled 9, replacing the test's count of at most 23 tacklers who reverse).** Around the read (60 ms before it to 600 ms after, or the whistle if sooner), no rated tackler is drawn moving away from the ball faster than his own top speed / k. Amended 2026-11-24, slice 2 (the lead's ruling): it is read on the drawn keys at their own times, not on 25 ms steps, and only for steps that start within 3.5 yd of the ball. Away speed is his step's component away from the ball's place at the start of the step (`tacklerAway`). Three plays over his top before the build are held to their own pre-build share of it: seed 2 play 162 at 1.264, seed 4 play 46 at 1.072, seed 6 play 70 at 1.269. And on S, no tackler within 4 yd of the ball at the read reverses who did not before the build (unchanged). `tl.tackler` ends at the ball at the whistle. | A tackler who still reacts in 0 ms with time to spare, a sprint caused by a rating, a tackler thrown off the ball, one who shows before he departs, or a missed anchor. |
| PR-C8 | all | **No leak (amended 2026-11-23, pre-build baseline).** R-C7, R-C9, R-C19, R-C20, P3 and N7 pass with ratings on (the standing-checks rule applies). Across events that differ only in target, result or end spot, every `nat.react` field is identical, with two provisos. `pursueAt` is a screen time after the read, and the read moves with the target and the result, so it is compared as `pursueAt` - `tl.read` (from slice 3, as `pursueAt` minus the throw time for a mark that breaks on the throw). And `delayMs` and `pursueAt` of a named player are left out, because his anchor bounds them (PR6). Amended 2026-11-24, slice 1 round 3: an unnamed DL's `delayMs` and `pursueAt` are left out too, because his ring release follows the ball after the read (PR3). Everything before the read is still identical, with one explicit exception (amended 2026-11-24, slice 2; Joseph, Settled 10): a rated tackler's drawn keys in the last 50 ms before he departs (PR6). R-C7 and R-C9 read him with that exception too. Two more from the lead's rulings (amended 2026-11-24, slice 2 accepted): a released blocker takes the same 50 ms before the read, and the blocker of an interceptor differs from the throw on (PR7). | A pre-read difference outside the exception. |
| PR-C9 | all | **Outcomes and anchors (amended 2026-11-23, pre-build baseline).** Two comparisons. **(a) Engine facts, with the app's ratings against none, held:** the same `tl.holder`, `tl.tackler` and `tl.involved`, the same label and flag texts and sources, the same y for the ball at the whistle (1e-6 yd), and for every player in `tl.involved` the same number of fact anchors in the same time order. **(b) What the old bands already move, compared A/B instead:** the shipped build with the app's ratings against the same build with every band pair in `ratings.scrimmage` set to [0, 0]. Between those two the ball's place at the whistle and every fact anchor's place are equal (1e-6 yd), every anchor's time and the handoff time on runs are equal, and the set of fact marks is equal. So the claim is that the new block does not move them. The exceptions, each through a rule that already reads a mark's own values (PR12): (1) on an incompletion, every slice: the drawn miss reads the drawn defenders (A3), so the miss point, its kind and the break-up defender may differ, and the two fact-mark sets may differ by that one defender. In slice 1 every mark and the ball are still identical up to the throw. From slice 2 (amended 2026-11-24, slice 2, the lead's ruling) that holds, up to the earlier of the two throws, for the ball and for every mark with no slice 2 effect of his own, and it excuses a mark whose own track or R9 landmark follows a moved receiver. (2) On a pass, from slice 2 (his own break pace) and slice 4 (his own get-off): R8 may move the throw, and with it the catch time, the whistle, k on a clamped play, the neutral catch x and the dead spot x that follows the carrier. Bound: the throw stays inside R8's window, from the drop end plus the hitch to the drop end plus the class's `throwHold`, and the count and size of the moves are reported in PERF.md. (3) On a sack, from slice 4: the sack time, through the sacker's arrival, never before the drop end + `sack.minDelayMs`. In slice 1 only exception (1) applies. Runs have no exception in any slice. N6's exact-anchor check is in PR-C10. | A rating decided something, or the new block moved a place or a time it has no rule for. |
| PR-C10 | all | **No regression in what stands (amended 2026-11-23, pre-build baseline).** With ratings, on S and on the fixtures, by the standing-checks rule above: N1, N3, N4, both N5 checks with M6, N6's settle, N6's exact anchors, A3's ring and flight ring, R-C5 "nobody frozen" and M5 (its window read from the marks' own `readMs` and `accelMs`) each fail on no more plays of S than their baseline count, and every fixture that passes them today still passes. **N4 only has a stated allowance (amended 2026-11-24, slice 1 build): its bar on S is 88, the pre-build 77 plus 11 (2% of S). Every other check keeps its pre-build count as the bar.** Each mark's own values are used, as NM4 set. A1, A2, the 14 s cap and R-C15 (`timeline()` 20 ms or less, median) are not in the baseline and are expected green. The heavy suite runs N1, N3 to N5 and A3 over 1,000 simulated plays with ratings and reports to PERF.md. It reports only, by design. | More failing plays than before the build, a fixture that newly fails, a slow build. |
| PR-C11 | 2 | **Man coverage (A/B on `man.lagMs` and `man.receiverLagMs`; corners in coverage presets, over all of S; amended 2026-11-24, slice 2; Joseph, "Measure corners", Settled 12).** Coverage presets are the man presets that are not run fronts (runStuff, goalLine). Why: 60 of the old 70 pairs were run fronts, where nothing shows, and the cushion cancels lag in plain distance. The window runs from the first key at which his receiver's template is within 2 yd of the defender's depth (the trail has begun, he is no longer holding his depth) to the throw. Pairs with under 300 ms of window are skipped. The corner's mean signed distance behind his receiver, along the receiver's own path, over the window is larger at coverage 40 than at 90: median over pairs at least 0.6 yd (arithmetic: up to 410 ms at about 9 yd/s is 3.7 yd at full speed, less through the plants and where `minLagMs` binds). Raising the receiver's `routeRunning` from 40 to 90 raises it too, median at least 0.3 yd. | One lag for everybody. |
| PR-C12 | 2 | **Bite, stalk and breaks (A/B).** (a) Play action, non-rushing LB: his greatest displacement along his bite in the first 900 ms is larger at awareness 40 than at 90 by at least 0.8 yd on every pair (arithmetic 1.8). In a run drop set (runStuff, goalLine), whose drop is downhill too, the measure is instead the largest difference between the 40 and 90 builds along his bite over the first 900 ms, floor 0.8 (amended 2026-11-24, slice 2, the lead's ruling). The two goalLine LB1 pairs read 0.75 and were red; run fronts read 1.10 to 1.73 after the third round (docs/PERF.md) (amended 2026-11-24, slice 2 accepted). At the throw he has recovered or is recovering: he is within 3 yd of his assignment point (his zone landmark, or his receiver's template trail point, as R-C10 (b) defines it), or his motion over the last 200 ms has a positive component toward it. (b) Stalk: `stalkLagMs` at 40 exceeds that at 90 by at least 150 (190 by the amended band, amended 2026-11-24, slice 2), and R-C8's hold and approach checks pass with his own lag in B. (c) First sharp break of a WR: apex speed over his own top is higher at `routeRunning` 90 than at 40 by at least 0.08 (arithmetic 0.20), and the two paths are the same polyline within 0.1 yd. R-C6 passes with his own pace. | Same bite, same break, or a changed route shape. |
| PR-C13 | 3 | **Ball in the air.** For a completion and its incompletion variant (same calls, same target), every counted non-rushing defender has the same `airMs` and leaves at the same time. A/B on `air.ms`: `pursueAt` at 40 is at least 200 ms after that at 90. From the throw to the catch, no unnamed defender is inside 2.5 yd of the catch point on a completion or interception. N1 holds in the 300 ms after every catch. R-C16 and R-C17 pass on S. | A tell in flight, a defender waiting where the ball arrives, a pop at the catch. |
| PR-C14 | 4 | **Get-off.** With ratings, every mark is off its set spot by `snapAt` + `maxStartMs` + 25 ms (the motion.test.ts check, unchanged). A/B on `getOff.defenseMs` for a DL: the time he first passes half his own top / k is at least 100 ms later at awareness 40 than at 90 (arithmetic 200). From his first movement to `driveMs` after it, his speed stays at or under 1.1 × `stepPace` × his own top / k. M6 contact holds from each pair's own engage end. R-C7's 95% speed share holds on S with ratings. | A frozen mark at the snap, no visible get-off, a block that floats. |
| PR-C15 | all | **(amended 2026-11-23, pre-build baseline)** `motion.json` is version 6 (5 in slice 1) (amended 2026-11-24, slice 2 accepted) with every key in the table at its starting value. `parseMotion` refuses each malformed case listed, the `varyMs` span rule included, pair by pair as its table states. The build's own diff touches nothing under `packages/sim`, `packages/shared` or `data/engine` (R-C14's wording). That is checked on the engineer's list of changed files for the slice, not on `git status` of this shared checkout, where other sessions have uncommitted sim work. | Missing validation, or an engine change made by this build. |
| PR-C16 | 5 | **Legacy on kicks, and what replaces "kicks unchanged with ratings".** With no ratings: `kr8-baseline.json` is untouched (it is not recaptured for this slice), the KR8 and KR1 tests fail exactly where they failed before the build and nowhere new (corrected 2026-11-24, slice 1 round 2: both were already red on the pre-build tree, so "passes" was wrong), and PR-C1's no-ratings digest holds on every kick play, returns included. With the app's ratings: every field goal, extra point, kneel and spike still gives its PR-C1 baseline digest. Kickoffs, onside kicks and punts with ratings are no longer compared to a digest. PR-C17 to C22 cover them. | A changed key with no ratings, a recaptured baseline, or a changed field goal. |
| PR-C17 | 5 | **KR1 to KR9 with ratings, at their own bars.** Each passes on 100% of the return fixtures (`RETURNS` in kickoff-return.spec.test.ts) with the test's rating table, and on at least 95% of the 1,000 simulated returns of the heavy suite with the app's ratings. Shares go to PERF.md. KR7's clause holds with ratings: returner and blocker positions from the kick to the catch are identical across events that differ only in dead spot, tackler or result. A miss is a FLAG to tune data (`wallReadShare` first), never a looser bar. | A blocker behind the returner, too few blocks, a wall that knows the result. |
| PR-C18 | 5 | **Perceptibility on kickoff returns.** Sample K: every kickoff with a return in `simGame` seeds 1 to 6, with the app's ratings (the engineer's probe reports the count and today's values before slice 5 starts; I measured neither). Per return, depart_i = `pursueAt` - the catch, over `tl.kickReturn.coverage` and over `tl.kickReturn.blockers`. Median over K of the coverage range: at least 120 ms (today 0 by the code, every unblocked coverage man leaves on the catch key; arithmetic 190 before variation). Median of the blockers' range: at least 180 ms (today not measured, about 130 by the same arithmetic as the scrimmage probe; expected about 230). | Coverage that still turns as one, blockers that still leave as one. |
| PR-C19 | 5 | **Monotonic on kicks.** On the return fixtures, PUNT_RETURNED and every 3rd kickoff and punt of seeds 1 to 6, each unnamed coverage man, blocker and punt-unit non-lineman is built at awareness 40, 55, 70 and 85 with the shipped data. His `pursueAt` never rises as awareness rises, and falls by at least 100 ms from 40 to 85 (arithmetic: 144 for coverage, 167 for a blocker). Every other mark's keys are identical from the snap to the catch. After the catch the block plan reads everyone's tracks, so they may differ. | A sharper player is later, or a rating moves the wall. |
| PR-C20 | 5 | **Pursuit and the tackler on kicks.** A/B on an unblocked coverage man of KR_LONG and KR_TD and a punt coverage man of PUNT_RETURNED: `nat.react.leadMs` at awareness 90 exceeds that at 40 by at least 300, his drawn path after `pursueAt` differs between the two builds by at least 0.5 yd at some key, and KR9 holds in both. PR-C7 holds for the tackler of every kick return and punt return in the fixtures and K. No blocker is engaged with the tackler (KR5), and only the tackler comes to the ball (KR9). | One pursuit for all, a blocked tackler, a 0 ms tackler. |
| PR-C21 | 5 | **The cut (A/B on the returner's `by.cut` rating, 40 against 90, on the cutting return fixtures).** His lowest speed inside the flagged cut arcs, over his own top / k, is higher at 90 by at least 0.1 (arithmetic 0.37). KR6 and KR7 hold in both builds, and in each the cut goes to the side KR7 defines. All 22 marks are identical from the kick to the catch. | Every returner cuts alike, or a rating picks the side. |
| PR-C22 | 5 | **Facts and the plays with no return.** On the no-return kickoff fixtures, the punt fixtures and every kick of seeds 1 to 6, PR-C9 holds as amended 2026-11-23: (a) with ratings against none, the same holder, tackler, involved players, label texts and ball y at the whistle, and (b) the shipped build against the same build with every band pair in `ratings.scrimmage` set to [0, 0] (which zeroes the kick effects too, since `ratings.kick` only scales those bands), the same kick time, landing time and place and ball place at the whistle. The one exception is PR21: his own cut pace may move a kickoff return's whistle, and with it k. Every mark is off its set spot by `snapAt` + `maxStartMs` + 25 ms. A1, A3, N1 to N6 with own values, the 14 s cap and R-C15 hold with ratings. | A rating decided something on a kick, a frozen mark, a pop. |
| PR-C23 | 5 | `motion.json` is version 7 with `ratings.kick` at its starting values. `parseMotion` refuses each malformed case listed. A slice 2 to 4 build parses version 6 with no `ratings.kick` (a slice 1 build, version 5) (amended 2026-11-24, slice 2 accepted). | Missing validation, or an earlier slice that needs the kick keys. |
| G-PR | 1, then each slice | The playtest gate below. | Not run. |

## Milestones

Each slice ships alone and ends with code-reviewer on the diff, test-writer against its criteria, then the gate. Line numbers are the working tree of 2026-11-23.

1. **Reactions and pursuit (what Joseph sees most).** PR1 to PR6, PR12 to PR16. Needs only the three ratings already passed. Files: `data/ui/motion.json` (the whole block lands here, so the schema changes once), `packages/app/src/ui/templates.ts` (`Motion` type near 314, `parseMotion` near 526), `packages/app/src/ui/timeline.ts` (own values 558 to 610, `unnamedTrack` 1771 to 1814, the converge branch 2308 to 2347, the tackler 2390 to 2399, the DL release 2401 to 2417, `predictAt` 2979 to 2999, `MarkNat` 64 to 80 and 3282 to 3294), `packages/app/src/ui/motion.ts` only if `pursue()` needs it (it already takes `leadMs`, `turnDegPerS` and `lateral`). Criteria: PR-C1 to C10, C15.
2. **Coverage, blocks and breaks before the read.** PR7, PR8. Files: `packages/app/src/ui/app.ts` (`motionRatings`, 503), `timeline.ts` (`TimelineCtx.ratings` 245, `trackOf` 822 to 855, `defenseTrack` 2521 to 2573), `motion.ts` (`runRoute`, if the fillet pace needs to be per mark), `templates.ts`. Criteria: PR-C11, C12, and C1, C8 to C10 again.
3. **The ball in the air.** PR9, approved 2026-11-23. Files: `timeline.ts` (`unnamedTrack`, the interceptor's converge, `predictAt` and the miss resolution so the clear check reads the same departure, the breaker's run), `templates.ts`. Criteria: PR-C13, and C1, C8 to C10 again. The riskiest slice for N1 and the ring.
4. **Get-off.** PR10, approved 2026-11-23. Files: `timeline.ts` (`trackOf`, `defenseTrack`, `lineStep` 2446 to 2459), `motion.ts` (`runRoute`), `templates.ts`. Criteria: PR-C14, and C1, C8 to C10 again. After slices 1 to 3 because the 150 ms rule keeps it the least visible on scrimmage plays and it touches every track.
5. **Kickoffs and punts.** PR17 to PR22. Built last. Adds the two `ratings.kick` keys, version 7 (approved, Settled 7; number changed, amended 2026-11-24, slice 2 accepted). Needs slices 1 and 4, whose read, pursuit and get-off it reuses by side. Files: `data/ui/motion.json`, `templates.ts` (`Motion` type, `parseMotion`, the version check at 434), `timeline.ts` (the scrimmage-only gate on the own values, the kick plans 1252 to 1401 for the cut pace and radius, `unnamedTrack` for coverage, `planKickReturn` 1863 to 2090 for the setup end, the wall hold, the departure and `tacklerAts`, which must draw the tackler as `build()` does, `leadersOn` 2097 to 2145, the tackler branch, the punt DL release). Criteria: PR-C16 to C23, and C8 to C10 again. The riskiest parts are KR5 with late blockers and the cut pace against KR6 and KR7.

Docs the build updates (this spec edits none of them): docs/DECISIONS.md (one entry per settled open item), docs/PERF.md (the probe values and the heavy-suite report), a pointer line in the motion spec.

## Existing tests

One pinned value changes: the file version (corrected 2026-11-23, I missed it in the first draft). No other pinned value moves, because every new key is in a new block and unrated motion is unchanged. I searched `packages/app/test` for `reactionMs`, `maxStartMs`, `startMs`, `ratings`, `version`, `natural-motion` and `routes-pace`.

| Test | What it pins | Change |
|---|---|---|
| kickoff-return.spec.test.ts 39 and 66, with `parseMotion`'s check at templates.ts 434 | `motion.json` version is 4, and version 3 is refused | Slice 1: the expected version becomes 5 and the refused case becomes 4, following the approved schema change. Slice 2: 6 and 5. Slice 5: 7 and 6 (approved, Settled 7 and 14, amended 2026-11-24, slice 2 accepted). The rest of that test (the `kickReturn` block, `kickoff` unchanged) stays as written. |
| layout.test.ts 288 to 290 | `maxStartMs` at most 150, 151 refused | None. Its "malformed file" case gains the `ratings.scrimmage` cases (PR-C15). |
| routes-pace.spec.test.ts 1752 to 1754, 1762 to 1763 | `motion.man`, `zoneDrift`, `stalk`, `startMs` deep-equal, `maxStartMs` 150 | None. They are why the new keys are not in `man` or `stalk`. |
| motion.test.ts 44 to 91 | First movement within 150 ms, at a 40 ms cap, 4 distinct starts | None. PR-C14 runs the same check with ratings. |
| motion.test.ts 136 to 144 (M10) | `pathEnd` ≤ max(`read` + 300, `snapAt` + 600) | None without ratings. The new file checks PR16 with ratings: `pathEnd` equals his own departure. |
| motion.test.ts 146 on (M5) | Window from `motion.reactionMs` + `accelMs` | None without ratings. PR-C10 runs it with own values. |
| natural-motion.spec.test.ts 302 to 312 (N7) | NM4 values unchanged across result variants | Extended to the `nat.react` fields (PR-C8). |
| natural-motion.spec.test.ts 340 to 390 (N8) | Higher rating gives a higher top, shorter `accelMs` and `reactionMs`, exact anchors | Must still pass as written. `nat.reactionMs` stays his scheduled reaction, on both sides. |
| natural-motion.spec.test.ts N1, N3, N4, N5, N6 and motion.test.ts M5, M7 | The natural-motion and motion criteria | Already red before this build (the baseline under "Acceptance criteria"). Not edited and not weakened. PR-C10 holds them to no regression. There is no N2 test as built, and none is added. |
| routes-pace.spec.test.ts 623 to 646 (R-C5) | Nobody frozen from start to the read | None. PR-C10 and C14 run it with ratings. |
| fumble-carry.spec.test.ts 965, 980 and strip-sack-ball.spec.test.ts 406, 432 | Their criteria on sim games "with the app's ratings" (speed, agility, awareness) | Re-run after every slice. They see the new awareness reactions. A failure is a FLAG for the engineer, and no expected value is edited unless a rule in this spec moved it. |
| kr8-digest.ts and `kr8-baseline.json` (KR8, kickoff-return.spec.test.ts 232 to 247) | Kick plays with no return, key for key, built with no ratings | None, in any slice. The file is not recaptured for slice 5 (PR17, PR-C16). Corrected 2026-11-24, slice 1 round 2: KR8, and KR1 on 13 fixtures, were already red before this build. The bar is no change to their failures with no ratings. |
| kickoff-return.spec.test.ts KR1 to KR9 and kickoff-return.checks.ts | The KR criteria on the return fixtures, built with no ratings | None. Slice 5 runs the same checks again with ratings (PR-C17). The test floors in the checks file stay as they are. |
| kickoff-return-crew.test.ts | The hang setup comes from the lineup alone (KR7) | None with no ratings. Slice 5 runs it with ratings too (PR-C17, PR-C19). |
| test/game/kickoff-return.heavy.test.ts | KR1 to KR9 on 1,000 simulated returns, at least 95% | None with no ratings. Slice 5 adds a run with the app's ratings at the same bar (PR-C17). |
| zz-react-probe.test.ts | The lead's probe, no assertions | Replaced by `packages/app/test/player-reactions.spec.test.ts`. Not shipped. |

## Dependencies and sequencing

- Slices 1 to 4 are cleared to build: Joseph settled the schema, the get-off and the break on the ball on 2026-11-23. Slice 5's two keys were approved on 2026-11-24 (Settled 7), so it waits only on its order (amended 2026-11-24).
- Order (Joseph, 2026-11-24, Settled 16): slices 3 to 5 come after the tackler build (docs/specs/m2-tackler-merged.md) and the sideline build (docs/specs/m2-sideline-run.md), with one recapture (amended 2026-11-24, slice 2 accepted).
- Slice 5 needs slices 1 and 4 built (it reuses their read, pursuit and get-off by side) and is built last.
- `packages/app/src/ui/timeline.ts` and the motion spec have uncommitted work from other sessions in this checkout. The lead decides the commit the engineer starts from. The PR-C1 baseline is captured from that commit, before the first change.
- Slice 2 needs the wider `ctx.ratings`. Slices 2 to 4 each need slice 1's own-values plumbing and `nat.react`.
- No engine, sim, pipeline or shared-type work. No new dependency.

## Locked, and likely to change

Locked: PR1, PR2 as amended by PR17, PR4's salt, PR6, PR12, PR13, the criteria's floors, KR1 to KR9 and their bars, the KR8 baseline file, and everything the motion spec calls Final that is not listed under Superseded. Likely to change after G-PR: every value in `ratings.scrimmage`, most of all `read.defenseMs`, `read.varyMs` and `pursuit.leadMs`, and on kicks `wallReadShare`. The 150 ms and 250 ms assumption under "Goal and user" is a guess until Joseph watches.

## Settled (Joseph, 2026-11-23 and 2026-11-24)

Items 1 to 6 were answered on 2026-11-23 through the question dialog, as relayed by the lead. Each question is as it was asked. Items 7 to 9 were answered in chat on 2026-11-24, "yes to all three", as relayed by the lead (amended 2026-11-24). Items 10 to 13 are selections in a question dialog on 2026-11-24, as relayed by the lead. Their wording is not in this file (amended 2026-11-24, slice 2).

1. **Schema.** Approve `motion.json` version 5 with the `ratings.scrimmage` block as listed? I recommend yes. Without it nothing here can live in data.
   **Joseph: "Approve".** Version 5 with the `ratings.scrimmage` block as listed is approved.
2. **Get-off.** May a player take a slow first step inside 150 ms and reach his full drive later, at most 300 ms after it? I recommend yes. First movement stays inside 150 ms, so "all 22 move from the snap" stays true. No means slice 4 is dropped and the snap stays as it is.
   **Joseph: yes, "Slow first step at the snap".** Slice 4 is in.
3. **Break on the ball.** Should rated defenders leave their coverage while the pass is in the air, on completions as well as incompletions? I recommend yes. It replaces the 2026-11-15 ruling that pursuit waits for the catch on a completion. No means slice 3 is dropped.
   **Joseph: yes, "Break on the ball in the air", on completions too.** Slice 3 is in and PR9 is final in structure.
4. **The line.** Keep "nobody is drawn winning a block", so strength changes nothing a viewer sees? I recommend yes. No opens a later spec in which a strong rusher dents the pocket by a set small amount.
   **Joseph: "Follow-up spec".** This pass keeps the line neutral and PR11 stands. A small strength effect is a later spec of its own. It is deferred and not designed here.
5. **A slower average.** The median rated defender will start pursuit about 135 ms later than today, the best near today's pace, the worst near half a second after the read. Start there and tune at the gate? I recommend yes.
   **Not asked separately. The lead's default: start there and tune at the gate. This is not Joseph's answer. Joseph to confirm at G-PR.**
6. **Kicks.** Leave kickoffs and punts as they are for now? I recommend yes, and ask again after G-PR.
   **Joseph: "Include kicks", against the recommendation.** PR2 is amended: kickoffs and punts are in scope as slice 5, built last (PR17 to PR22).
7. **Two more keys for slice 5 (PR-Open 7).** Approve `motion.json` version 6 with the `ratings.kick` block, `by.cut` and `wallReadShare`, as listed under "Added for slice 5"? I recommend yes. It is needed before slice 5 is built and by no earlier slice. Without `by.cut` the returner's cut reads agility for everyone. Without `wallReadShare` the blockers use the full scrimmage band, which puts KR5 at risk on short returns (my reading of the block plan, not measured).
   **Joseph, 2026-11-24: yes.** Version 6 with `ratings.kick.by.cut` { "default": "agility", "RB": "elusiveness" } and `ratings.kick.wallReadShare` 0.6 is approved, built at slice 5 (amended 2026-11-24). The number is now 7: version 6 went to slice 2 (Settled 14) (amended 2026-11-24, slice 2 accepted).
8. **The N4 allowance (PR-Open 8, added 2026-11-24).** Accept that one already-red check, N4 "no cruise plateau", may fail on up to 88 plays of the 571 instead of its pre-build 77, because later reads show the existing plateau for longer? The lead ruled yes for the build, and I recommend yes. No means slice 1 cannot pass PR-C10 until the plateau itself is fixed, which is the separate work on the standing checks and changes unrated motion.
   **Joseph, 2026-11-24: yes.** The bar is 88 on S (amended 2026-11-24).
9. **The reversal test.** The question's wording is not in this file. The change: replace the count of at most 23 tacklers who reverse with a check for the defect itself, as PR-C7 now states.
   **Joseph, 2026-11-24: yes.** The record is under PR6, "Reversals" (amended 2026-11-24).
10. **The tackler.** **Joseph: "No visible shove".** The last 50 ms before he departs are excepted (PR6, PR-C7, PR-C8; amended 2026-11-24, slice 2).
11. **Coverage.** **Joseph: "Stronger".** `man.lagMs` [300, -110] and `man.receiverLagMs` [-80, 180] (PR7, the schema table; amended 2026-11-24, slice 2).
12. **PR-C11.** **Joseph: "Measure corners".** Floors stay 0.6 and 0.3 (PR-C11; amended 2026-11-24, slice 2).
13. **The stalk.** **Joseph: "Change to -40".** `stalk.lagMs` [150, -40] (PR7, the schema table; amended 2026-11-24, slice 2).

Items 14 to 17 are from question dialogs on 2026-11-24, as relayed by the lead. Their wording is not in this file (amended 2026-11-24, slice 2 accepted).

14. **Version 6.** Approved: `ratings.scrimmage.stalk.clearYards` 1.2. Slice 5 is therefore version 7.
15. **The lane push.** Approved: eased to the defender's own top, rated players on scrimmage only (PR12, Superseded 15).
16. **Order.** Slices 3 to 5 after the tackler build and the sideline build, with one recapture.
17. **Slice 2.** Accepted with its 7 known red tests listed, none loosened ("Slice 2 accepted").

## Open items for Joseph

None open (amended 2026-11-24). Still to confirm at G-PR: Settled 5.

Nothing is open with the lead from slice 2: the two man bands were measured together, and run-front bites now pass (docs/PERF.md, third round) (amended 2026-11-24, slice 2 accepted).

## Playtest gate G-PR

After slice 1, Joseph watches 20 or more scrimmage plays at 1x (runs, each pass class, one sack), some with mark labels set to ratings so he can find a 45 and an 85 on the same defense, and says:

1. Do the defenders still react at the same time?
2. With labels back on numbers, can he pick the sharp defender from the slow one by how they move?
3. Does the defense as a whole now look slow? This is Settled 5, the lead's default, and Joseph confirms or changes it here.

After slice 2: does man coverage look tighter on a good corner, and does a poor linebacker bite on play action? After slice 3: do defenders play the ball in the air without looking like they should have had it? After slice 4: does the snap read as a snap, with nobody standing? After slice 5, on 10 or more kickoffs (at least 5 returns, one long) and 5 or more punts: does the coverage still turn on the returner as one, do the blockers still leave the wall as one, do the blockers still lead the return (KR4), and does a good returner's cut look different from a poor one's? Every named player and moment goes in the playtest log. If he says "same" again, ask which players and which moment.
