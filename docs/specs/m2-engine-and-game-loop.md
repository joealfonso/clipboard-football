# M2: engine and game loop for the playable game

Status: revision 2, 2026-11-12. Owner: Joseph. Author: spec-writer. Revision 2 applies the lead's decisions on all 15 open questions (see "Resolved (lead, 2026-11-12)" at the end). The UI side is docs/specs/m2-playable-game-design.md ("the design spec"); this file is the sim side behind its "Needs from the engine" list, limited to the seven items the lead scoped.

## Goal

Give the M2 browser game what it needs from the sim: the engine names who made each play, players carry jersey numbers, the game keeps per-player stats, elite players make standout plays, the why line has a plain-words headline, coaches can challenge close calls, and the loop pauses for every decision a human makes, all without moving league totals.

For: Joseph, who coaches a full game in the browser (the M2 gate), and the engineer and test-writer building and checking it. Depth target (ROADMAP.md): close to a sim, approachable, full detail one click behind the headline.

## Non-goals

- Anything on screen: menus, animation, HUD, saves in IndexedDB, the worker wrapper itself. Those are the design spec's.
- Play geometry the design spec asks for in need 3 (pass location, air yards, yards after catch, run gap, kick landing spot, fumble spot). Today's pools hold only yards, flags, turnover yards and return yards (`poolFields` in baseline.scrimmage.json). A future pipeline milestone adds it (resolved 11); until then the animation draws those facts neutral (design A3).
- Depth charts, injuries, fatigue, rotation (M5). "Depth chart" here means pool order within a position, as in M1.
- AI personalities or tilted coaches (M3). Every AI decision stays the average coach.
- Any change to fitted tables, the matchup table, the step 2 callers or the step 3 rules, except the rule set additions for challenges and jersey numbers.
- The holdout (2024-2025) run. Every check here is in-sample or exact.

## Dependencies allowed

Nothing new. Pipeline: polars and nflreadpy as before, for the challenge rates (milestone G) only.

## Locked

From CLAUDE.md, the step 4 and 5 specs and the design spec. Not reopened here.

1. `createEngine(data)` returns `resolvePlay(state, offenseCall, defenseCall, players, rng)`, and it decides every outcome, including who made the play, whether a call was close, and what a review would find. The loop and coach policies decide only coach choices. Animation and UI read results and decide nothing.
2. The sim is pure: no DOM, no Node API, no `Math.random`, one seeded Rng. Same seed and same inputs give the same game.
3. Multipliers act only on class probabilities, never on the real play drawn within a class (step 4). A standout can make a class more likely; it cannot edit a sampled play's yards.
4. Every designed layer is centered: league totals over the calibration leagues stay where step 5 left them.
5. The why line and its headline bind only to trace fields. Rendering fails with a typed error rather than fall back to free text.
6. Challenge and replay rules, and jersey number rules, come from the 2026 rulebook, cited in RULES.md. Nothing from memory.
7. Coach policies, AI and human alike, see only the CoachView (both sidelines' information). The AI never sees the human's call, and the opponent's call never reaches the UI before the snap.
8. At most seven choices per screen (design spec's count rule). Every decision request carries at most seven options, counting Back.
9. Tolerances for every calibration run are committed before the run and never changed after. Only Joseph adds `known_deviations`.

## Status of each part

| Part | Label | Why |
|---|---|---|
| Who made the play: role shares by leaf and slot, rating tilts, return units, fouling-player eligibility | designed | No shipped per-player data; real 2016-2023 position shares reported next to them (B6, not gated) |
| Jersey numbers: validity per position | cited rule | 2026 rulebook, as recorded in RULES.md by the research agent |
| Jersey numbers: which number a player gets | designed | Seeded draw among valid numbers |
| Per-player stat definitions | cited where a primary source exists, else designed | Official NFL statistics conventions where cited in RULES.md; each other definition marked designed in MODEL.md; one tackler per play (designed) |
| League-wide rating ranks | computed | Pure function of the generated league; decides nothing |
| Standout plays | designed, centered | Threshold, kinds and sizes in data; centering like the matchup table |
| Why headline templates | designed | Bound to trace fields |
| Challenge and review rules | cited rule | 2026 rulebook (gap) |
| Close-call rates and reversal rates | mixed | Kinds and alternatives designed. Fitted part: nflverse pbp `replay_or_challenge` and `replay_or_challenge_result`, regular seasons 2016-2023 only, for kinds that can be read reliably from the play; each other kind designed and labeled so |
| AI challenge policy | mixed | Designed rule over fitted expected points (data/game/ep.json) |
| Human tempo modes | mixed | Designed mapping onto the fitted tempo table |
| Step-wise loop | designed | Order of inputs as step 5 |

## Design

### Who made the play (needs 2 and 4)

Every PlayResult's `detail` gains a `participants` record of player ids by role: passer, target, receiver, ballCarrier, tackler, sacker, interceptor, fumbleForcer, fumbleRecoverer, kicker, punter, returner, foulers (one per foul). A role that didn't happen is absent, never filled with a guess. It also gains `onField`: both sides' players by slot for that play, so the UI's marks are real players.

Rule, behavior only (method is the engineer's call):

- The outcome is drawn first, exactly as today. Participants are then credited by a designed rule in a data file: each eligible on-field player's base share for the role by leaf (for example, a deep pass favors WRs, a screen favors the RB), tilted by the rating that fits the drawn class (a 20+ completion leans to Speed, an incompletion leans away from Hands, a sack leans to Pass Rush). Weights with no RNG are allowed; any draw comes from a stream that leaves the outcome stream untouched.
- So, with standouts off, adding participants changes no outcome for any seed. That is the calibration proof for this layer: exact, not a tolerance.
- Kick returns: personnel.json gains designed return units (kickoff return, punt return) and a designed returner rule, so every play names all 22 players. This is a schema change to personnel.json, approved under this spec (resolved 7). The units must be fillable from the players the generator already makes, so no generated team changes.
- Fouling player: chosen from the fouling side's on-field players at positions a designed table allows for that penalty id (false start: offensive linemen, tight ends, receivers; defensive pass interference: defensive backs and linebackers).
- Fallbacks are designed and listed in data: a run from Empty (no RB on the field) credits the QB; a pass from Heavy (no WR) targets TEs and the RB.

### Jersey numbers (need 10)

Player schema version 2 adds `number`, an integer, unique within a team, valid for the position under the 2026 numbering rule as recorded in RULES.md (values in the rule set data; this spec holds no rule text). Version 1 pools migrate by assigning numbers by seed. The generator assigns numbers without changing any other field it produced for the same seed (names, ratings, ids), so every existing league, game and digest is unchanged. Lead approved this schema change under this spec (design spec, lead decision 2026-11-12).

### Per-player stats and box score (need 8)

Computed from the event log only, decides nothing, like the step 5 box score. Lines per the design spec: passing (C/A, yards, TD, INT, sacked), rushing (attempts, yards, TD, long), receiving (targets, catches, yards, TD, long), defense (tackles, sacks, INT, forced fumbles, recoveries), kicking (FG made/attempted, long, XP, punts, average), plus team challenges won and lost. Only plays that stand count (step 5 `playStands`, `kickStands`). Definitions follow the official NFL statistics conventions where a primary source is cited in RULES.md; every other definition is designed, and MODEL.md says which is which. One tackler per play (designed), so tackles run below real counts that include assists (resolved 9).

League-wide rating ranks by position (design need 11): a pure helper over the generated league, built in milestone C (resolved 12).

### Standout plays

A designed list of standout kinds in a data file, each with: the role, the positions, the rating that drives it, the class it boosts, a threshold of 90 on the card rating (resolved 8) and a multiplier. The five kinds, all on class probabilities only (locked 3):

| Kind | Player | Rating | Class boosted |
|---|---|---|---|
| Breakaway run | ball carrier (RB, QB) | Speed or Elusiveness | run 20+ |
| Big catch | target (WR, TE, RB) | Speed or Hands | completion 20+ |
| Sack | rusher (DL, LB) | Pass Rush | sack |
| Pick | cover player (CB, S) | Ball Skills | interception |
| Long kick | kicker | Kick Power | field goal good, 50+ yards |

No strip sack kind. A standout can only raise a class probability, and the pass family has no sack-fumble class: whether a sack ends in a fumble comes from the real play drawn inside the sack class, which no multiplier may touch (locked 3). Adding a class would change the fitted tables, which is out of scope. A standout sack can still turn out to be a strip sack when the drawn real play has one.

Behavior:

- When an eligible elite player is on the field for a play his kind applies to, his multiplier on that class enters the class draw, weighted by his share of the role, and the whole layer is centered so league class rates match the standouts-off run.
- A play is a standout only when that multiplier was applied, the boosted class was drawn and that player is the one credited with the role. The trace then has a `standout` entry: player id, number, rating name, rating value, kind, multiplier.
- The rating shown is the card rating (the pool after the league's team-strength shift, before the home-field shift), so "speed (94)" in the why line matches the player card.
- A standout on a play wiped out by an accepted foul is not a standout in the box score or the end-of-game list.

### Why headline (need 7)

Every template in why.json gets a `headline` variant: plain words, no multipliers, no raw factor names, no percentages. It may say how common the result was ("a common result here", "a fluke") from the class probability and fluke flag, and may name players by number and name from `participants` and `standout`. The existing sentence stays as the detail line; the trace carries the numbers for the details view. `participants` and `standout` fields join TRACE_FIELDS so the step 4 E2 test covers the headline.

### Challenges and reviews (need 6)

**Rules come from RULES.md.** A separate research agent is looking up the 2026 challenge and replay rules from primary sources and writing them, with citations, into RULES.md. This spec holds no rule text. G1 reads RULES.md and puts the values in data/rules/nfl-2026.json. It must cover:

- challenges per team per game, and any extra challenge and what earns it
- the cost of a failed challenge, and whether a team with no timeouts may challenge
- periods and clock windows when coaches may not challenge
- which plays and rulings are reviewable
- which reviews start without a coach (booth or replay official)
- the order of review and penalty enforcement, which settles the design spec's "review first, then the penalty choice"

Everything below reads those values; nothing is hard-coded.

Mechanism (resolved 3, 4 and 5):

- `resolvePlay` may mark a play as a close call: `detail.closeCall` with a kind, a question key for the prompt ("was he down before the ball came out?"), the alternative PlayResult, and the review verdict (stands or reversed) drawn at resolve time. The loop never draws it.
- The sampled play is the ruling on the field. With no review, it stands, so a game nobody challenges is today's calibrated engine.
- The alternative is a deterministic edit of the sampled play and the state, never a new outcome draw. The five kinds, and only these: completion ruled, really incomplete; fumble lost ruled, really down by contact at the fumble spot; interception ruled, really incomplete; touchdown ruled, really down at the 1; spot within a yard of the line to gain (both ways).
- Close-call rates per kind and reversal rates are mixed: fitted from nflverse pbp `replay_or_challenge` and `replay_or_challenge_result`, regular seasons 2016-2023 only, where the kind can be read from the play; designed and labeled so for any kind that can't. How the kind is read from pbp is checked against a hand sample and recorded in DECISIONS.md.
- A reversal gives exactly the state that applying the alternative to the pre-play state gives. No undo in the machine is needed if the loop holds the pre-play state until the review window closes (engineer's call).
- Who may challenge: the team the ruling went against, judged by lead plus expected points of the next snap (the step 5 penalty-choice value). The human is asked only then and only when the rules allow it. The AI challenges by a designed rule: expected gain from the fitted reversal rate for that kind times the value swing, minus the cost from the rule set, above a designed threshold. The AI sees the close call's kind and question, never the verdict or which result is true.
- Rule-required reviews use the same verdict, with no coach decision.

### The step-wise loop (need 1, need 9)

Today `stepGame` runs both coaches. M2 adds a seat for one human team (either team, chosen at setup; "Coach the other team" swaps it). At each human decision the loop stops and returns a request; the caller answers; the loop goes on to the next request or `final`.

- Request kinds: coin toss, overtime choice, kickoff type, try (extra point or two), offense call (including 4th down, kneel, spike), defense call, tempo, timeout, penalty choice (with the state each option leaves), ten-second run-off, challenge, and "continue" for dead balls with nothing to call (design decision 17).
- Each request lists the legal options, and every off option with a reason code (design decision 9). "Same call" legality is a flag on the offense and defense call requests.
- Every request has at most seven options counting Back, matching the design spec's screens.
- The AI's call for the play is drawn only after the human's answer and is never in a request. A request carries no field the opponent's call can be read from.
- Order of inputs per dead ball is step 5's, with the human answering where the AI policy would. AI timeouts keep their fitted points in that order.
- Tempo (human offense only; design decision 3): Hurry-up, Normal, Run the clock, reset to Normal at each new drive. Normal draws from the fitted tempo table exactly as the average coach does. Hurry-up draws from the fitted cells for trailing in the final 2:00, and Run the clock from the cells for leading in the final 5:00, whatever the real situation (resolved 13). A human timeout with the clock running takes the fitted run-off before a called timeout (step 5 `toCalled` cells), as the AI does, shown as an event (resolved 14).
- State (game state, Rng state, pending request, input log) is plain JSON with no functions or class instances, so it crosses a Web Worker boundary and saves to IndexedDB. Seed plus input log replays the game exactly.

## Milestones

Each ships on its own and goes through code-reviewer and test-writer. A, B and E can start in parallel. C and D need B. F needs B and D. G needs B, E and the rule lookup.

Calibration runs use the step 5 in-sample run (`scripts/game/calibrate.ts --target insample`, 10 leagues x 1,000 games), paired by seed against the committed post-5b baseline. "Outcome digest" means the step 5 per-game digest over the step 5 record fields, leaving out fields this spec adds.

### A: jersey numbers (designed, cited rule)

| # | Criterion | How it fails |
|---|---|---|
| A1 | Lookup step: the numbering values the research agent cited in RULES.md are in the rule set data, one leaf per RULES.md row (the existing rule set test). A does not merge before this. | A value with no cited row, or a cited row with no value. |
| A2 | Player schema version 2 parses; bad fixtures are rejected: a duplicate number in a team, a number outside 0-99, a number the rule set forbids for the position, a non-integer. | A bad fixture passes. |
| A3 | A version 1 pool migrates to version 2 deterministically by seed and passes A2. | Different numbers for the same seed, or an invalid result. |
| A4 | For every league seed in the calibration run, each generated player is deep-equal to before except `number`, and every in-sample outcome digest is identical. | Any other field or digest changes. |

### B: who made the play (designed)

| # | Criterion | How it fails |
|---|---|---|
| B1 | Over the step 4 C1 contract states (100,000), every PlayResult has `participants` and `onField`; every id is a player on the field for that play's side and role; each role present matches the result (a sack has a sacker, a completion a receiver, an interception an interceptor, an incomplete pass a target but no tackler, a touchdown no tackler, a kneel only a QB, a touchback no returner, a noPlay only foulers). | A missing, impossible or extra role. |
| B2 | Every in-sample outcome digest is identical to the baseline with participants on (exact equality, no tolerance). | Any digest changes. |
| B3 | Return units fill from the players the generator already makes; generated teams are unchanged (A4's check). | A team changes, or a slot can't be filled. |
| B4 | Every foul's fouling player is on the field for the fouling side and at a position the designed table allows for that penalty id. | A disallowed position. |
| B5 | Tilts go the documented way: over the in-sample run, among WRs on the field, a player's share of 20+ completions rises with Speed and his share of incompletions falls with Hands; same checks for RB carries and Speed, DL sacks and Pass Rush, CB/S interceptions and Ball Skills. | A flat or reversed relation. |
| B6 | Report, not gated: targets and carries by position (WR, TE, RB, QB) against 2016-2023 pbp shares by position, in docs/GAME_REPORT.md or a new report. | Missing. |
| B7 | Determinism: same seed, same participants (10,000 games); participant crediting never reads the outcome stream (a test swaps its stream and B2 still holds). | Any difference. |

### C: per-player stats and box score (designed definitions)

| # | Criterion | How it fails |
|---|---|---|
| C1 | For every game in the CI slice, player lines sum to the team box: passing yards, rushing yards, receiving yards and catches, TDs, INTs thrown equal INTs made, sacks taken equal sacks made, FG and XP counts. | A sum mismatch. |
| C2 | Plays that don't stand (wiped by an accepted foul, replayed down) add no player stat; a test with a scripted log covers each. | A stat from a wiped play. |
| C3 | The box score is built from the event log alone; re-running it from a parsed JSON record gives the same box (step 5 E5). | Diff. |
| C4 | A player with no stat in a category has no value (the UI shows a dash), distinct from 0. | 0 for a player with no attempt. |
| C5 | MODEL.md documents each stat definition, marked either "NFL convention" with its RULES.md citation or "designed", and the one-tackler rule as designed. | Missing, or a convention claimed without a citation. |
| C6 | Rating ranks: for every player in a generated league, each rating's rank within his position matches a rank recomputed independently, ties broken by a documented rule. | Wrong rank. |

### D: why headline (designed)

| # | Criterion | How it fails |
|---|---|---|
| D1 | Every template has a headline; a schema test fails a template without one. | Missing headline accepted. |
| D2 | Over 10,000 C1 plays, every headline renders, and every factor and player it names is in that play's trace with the value shown (step 4 E2, extended to participants and standouts). | A named factor or player not in the trace. |
| D3 | No headline contains a multiplier, a percentage or a raw factor id (pattern test over the 10,000 plays). | One does. |
| D4 | An unbound headline slot throws a typed error; no fallback text. | Fallback text. |
| D5 | The existing `detail.why` is unchanged for every play (step 5 E3 still passes). | It changed. |

### E: step-wise loop (designed; tempo mixed)

| # | Criterion | How it fails |
|---|---|---|
| E1 | With no human seat, the step-wise loop's record is deep-equal to `playGame` for every game in the CI slice. | Any difference. |
| E2 | With a human seat and a scripted input log, the same seed and log give a deep-equal record; a different answer at one request changes it. Inputs are replayed from the log alone. | Divergence. |
| E3 | Save and resume: at every request of a scripted game, the run is serialized with JSON and with `structuredClone`, resumed, and finishes deep-equal to the uninterrupted run (design S2). | Divergence or a non-cloneable value. |
| E4 | Every request kind in the design spec is reached in a scripted game: both toss outcomes, onside both ways, 4th down go, punt, field goal, two-point try both ways, penalty choice, ten-second run-off, tempo, timeouts by both sides, overtime, a tie, a game ending on a kneel. | A kind never reached. |
| E5 | Every request lists only legal options; every off option has a reason code; no request has more than seven options counting Back. Submitting an off or unknown option returns a typed error and leaves the run unchanged. | An illegal option accepted, a missing reason, or eight options. |
| E6 | No request, and nothing reachable from it, holds the opponent's call before the snap (test walks every request object in E4's game). The AI policy is type-tested as in step 5 A4. | Leaked. |
| E7 | Tempo: Normal draws are the average coach's draws (same cell, same distribution); Hurry-up's mean run-off is below Normal's and Run the clock's above it in every time5 bucket; tempo resets to Normal at each new drive. | Wrong cell, order or reset. |
| E8 | Purity: the loop passes the existing purity and import tests (no DOM, no Node API, no zod). | A violation. |
| E9 | Speed: from an answer to the next request, p99 at most 10 ms on Joseph's machine over the CI slice played with a scripted human seat, recorded in PERF.md. Leaves room in the design spec's 100 ms snap budget. | Over budget. |

### F: standout plays (designed, centered)

Tolerances are pre-registered before the first run, in a designed tolerances file whose sha256 the lead records in DECISIONS.md. Values below are proposals the lead confirms. The same applies to G7.

| # | Criterion | How it fails |
|---|---|---|
| F1 | Calibration: in-sample run with standouts on vs off, same seeds. Every scrimmage class share within 0.2 pp; points per team-game mean within 0.3 pt and SD within 0.3 pt; turnovers per team-game within 0.05; FG make rate 50+ within 1 pp; no in-sample gated step 5 metric changes from pass to fail. | Outside, or a status flips. |
| F2 | Visible effect: per kind, a player at the threshold makes the boosted class more often than the same slot with a league-average player by at least a designed minimum (fixed seed, as step 4 D6). | No effect. |
| F3 | Tagging: every `standout` trace entry has the multiplier applied, the boosted class drawn, and the same player credited in `participants`; no play without all three has one (10,000 games). | A standout the engine didn't cause, or a missing one. |
| F4 | The rating value in the standout entry equals the player's card rating (before the home-field shift). | Mismatch. |
| F5 | Below the threshold the player's multiplier is exactly 1 before centering (unit test). | Nonzero effect. |
| F6 | Report: standouts per game (mean, distribution) and per kind, from the in-sample run. Joseph judges the rate in the playtest; no target is set here. | Missing. |
| F7 | MODEL.md "Standout plays" section, marked designed, with threshold, kinds, sizes and the centering method. | Missing or mislabeled. |

### G: challenges and reviews (cited rules, mixed rates, designed policy)

Blocked until the research agent's challenge and replay rules are in RULES.md.

| # | Criterion | How it fails |
|---|---|---|
| G1 | Lookup step: every challenge and replay value the research agent cited in RULES.md is in the rule set data, one leaf per row (the existing rule set test), including the review and penalty order. | A value with no cited row, or a cited row with no value. |
| G2 | Fit: one command rebuilds the close-call and reversal rates from nflverse pbp regular seasons 2016-2023, byte-identical on rerun; a pytest shows 2024-2026 rows never land; the hand-checked sample for reading the kind from pbp is in DECISIONS.md. | A holdout row, a diff, or no sample. |
| G3 | Every close call's alternative is accepted by `applyPlay`, differs from the ruled result only in the way its kind names, and uses no extra outcome draw (the outcome stream is identical with close calls on or off). | Rejected, wider edit, or a stream change. |
| G4 | A reversal leaves exactly the state that applying the alternative to the pre-play state leaves; "stands" leaves the ruled state. Cost and count are charged per the rule set. | State mismatch or wrong charge. |
| G5 | Eligibility comes only from rule set data: a fixture rule set with different counts, windows and costs changes when requests appear and what they cost (design R1). | Hard-coded behavior. |
| G6 | Neither the AI policy nor any request sees the verdict before a review (type test plus a walk of request objects). | Verdict reachable. |
| G7 | Calibration, AI on both sides, in-sample, pre-registered (proposals): challenges per team-game and reversal share within tolerances set from the 2016-2023 actuals' intervals before the run; scrimmage class shares within 0.2 pp of the no-challenge run; points per team-game mean within 0.3 pt; turnovers per team-game within 0.05; no in-sample gated metric flips to fail. | Outside, or a flip. |
| G8 | Reachability: a scripted game reaches a human challenge that stands and one that's reversed, an AI challenge both ways, and a rule-required review. | One unreachable. |

## Edge cases that are reachable

- Touchdown run or catch: carrier credited, no tackler. Safety: tackler is the defender at the spot.
- Incomplete pass: target, no receiver, no tackler. Intentional grounding: passer and fouler only, no target.
- Sack fumble recovered by the offense; interception fumbled back to the offense (`defensePossessedDuringPlay`): interceptor, then a recoverer from the offense.
- Interception returned for a touchdown: the return runs in the same frame; no tackler.
- Kickoff touchback: kicker only. Fair catch: returner, no tackler. Onside recovered by either side: recoverer.
- Blocked punt or field goal recovered behind the line by the kicking team.
- Pre-snap foul (noPlay): fouler only. Offsetting fouls: one fouler per foul.
- Run from Empty, pass from Heavy (designed fallbacks).
- A standout breakaway wiped by holding: not a standout in the box or end list.
- An elite home player whose card rating is 89 and whose home-field-shifted rating is 90: not elite (card rating rules).
- A close call on the last play of a half, then an untimed down after a reversal that leaves a defensive foul standing.
- A challenge with no timeouts left (whatever the rules say, from data).
- Save taken while a challenge, penalty or run-off request is pending; resumed exactly.
- Human on defense when the AI kicks: a "continue" request, timeout still offered.
- Tempo set to Hurry-up, then a turnover: the next human drive starts at Normal.

## Dependencies and sequencing

- Milestones A, B, C, D and E change no outcome; they start once step 5 is committed. F and G change outcomes; they wait for the committed post-5b in-sample baseline, and their tolerances are pre-registered (sha256 recorded by the lead in DECISIONS.md) before the first run (resolved 15).
- A1 and G1 read the rules the research agent writes into RULES.md. A doesn't merge and G isn't built until those are there.
- The design spec's UI work reads B (participants), C (box), D (headline), E (requests) and later F and G; the UI can start against E with fixtures.
- playtester runs after F and after G (CLAUDE.md: after any sim or balance change), then Joseph's M2 gate playtest.

## Locked vs likely to change

Locked: outcome first, then crediting, with no outcome change from B, C, D or E; standouts and challenges centered and gated before merge; rules from the rulebook; no AI or UI access to the opponent's call or a review verdict; seven-option cap per request; card ratings in the why line.

Locked by the lead's decisions: the five close-call kinds, ruled-on-field first, threshold 90, the five standout kinds, no strip sack kind, 2016-2023 as the only training seasons.

Likely to change: role shares and rating tilts after B6 and the playtest; standout sizes after F6 and Joseph's playtest; close-call rates after G's first report; the AI challenge threshold; tempo mode cells; request payload shapes once the UI is built against them.

## Open questions

None left open. Still pending, not questions: the research agent's rule entries in RULES.md (A1, G1), the lead's confirmation of the F and G tolerances, and Joseph's playtest judgment of the standout rate (F6).

## Resolved (lead, 2026-11-12)

1. **Challenge and replay rules.** A separate research agent looks them up from primary sources and writes them, with citations, into RULES.md. G1 is a lookup step that reads RULES.md; no rule text in this spec.
2. **Jersey numbering rules.** Same research agent, same place. A1 is a lookup step that reads RULES.md.
3. **Ruling on the field first.** Accepted. The sampled play is the ruling on the field and stands unless reviewed; G7 measures drift. Known risk: the fitted pools already hold real final rulings, so sim reversals are a second layer.
4. **Close-call kinds.** Accepted. Only the five edit kinds that need no new draw. "Incomplete ruled, really a catch" is out, because it would need new yards.
5. **Close-call and reversal rates.** Accepted, mixed. Fitted part: nflverse pbp `replay_or_challenge` and `replay_or_challenge_result`, regular seasons 2016-2023 only. Kinds that can't be read reliably are designed and labeled.
6. **Role shares.** Accepted, designed, with real 2016-2023 position shares reported next to them (B6).
7. **Return units.** Accepted. Adding kickoff-return and punt-return units to personnel.json is a schema change approved under this spec. They fit current slot needs, so no generated team changes.
8. **Standouts.** Accepted: threshold 90 on the card rating, the five kinds. No strip sack kind, because sack fumbles live inside the real play drawn within the sack class, and multipliers act only on class probabilities.
9. **One tackler per play.** Accepted.
10. **Stat definitions.** Official NFL statistics conventions where a primary source exists (the research agent may add some to RULES.md); otherwise designed. MODEL.md says which (C5).
11. **Play geometry.** Accepted as out of scope. Listed as a future pipeline milestone.
12. **Rating ranks.** Accepted. A pure helper, built in C (C6).
13. **Tempo mode sources.** Accepted: Hurry-up from the fitted trailing-final-2:00 cells, Run the clock from the leading-final-5:00 cells.
14. **Run-off before a human timeout.** Accepted: the fitted `toCalled` run-off, as for the AI.
15. **Sequencing.** Accepted. A to E start once step 5 is committed. F and G wait for the committed post-5b baseline, with tolerances pre-registered before the first run; the lead records their sha256 in DECISIONS.md.
