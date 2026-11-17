# M2 calling screen pass: field board, richer result, clean details, recent calls, quality of life

Status: revision 1, 2026-11-15, open items settled by Joseph the same day (Open items below). Owner: Joseph. Author: designer. Branch: m2/playable. Build: built by engineer 2026-11-15, not yet reviewed (code-reviewer, test-writer).

Source: Joseph approved U1, U2, U3, U5 and Q1 to Q4 on 2026-11-15 after a playtest at 1280x720. This file turns each into decisions, copy, keys, states and tests. Where it says nothing, docs/specs/m2-playable-game-design.md ("the M2 design"), docs/specs/m2-play-calling-and-motion.md ("the calling spec"), docs/specs/m2-screen-switch.md, docs/specs/m2-usability-pass.md and DESIGN.md stand.

Final means decided here. Open means waiting on Joseph, the lead, art-director, the engine or a measurement. Every timing and size marked "designed" lives in data or a token and is tuned in playtest.

## Problem

Between snaps the player spends most of a game on the calling screen (about 150 dead balls). At 1280x720 Joseph found it thin and noisy at once:

1. No field while calling. The screen switch (Joseph, 2026-11-15) removed the pre-snap lineup, so the player picks a formation without seeing it on the ball, the spot or the line to gain.
2. The Last play card says only "Run for 7." The calls line and the why headline that M2 design decisions 12 and 13 promised are gone from it (`app.ts` `gamePanel` dropped them), and no player is named (`text.ts` `playText` names nobody).
3. Last play details (D) reads like debug output: the headline twice (`detailsBody` prints `g.why`, then `detail.why`, which carries "(x1.14)"), raw trace fallbacks ("id Bluehaven Mariners-QB1" is the `fouler` and `standoutCandidate` entries falling to `traceText`'s default branch), the raw cell key ("deepPass|1|7+|OWN") and bare multipliers.
4. A new run or pass is 3 to 4 keys, and only the very last call is one key (Same call).
5. Dead balls with nothing to decide (their extra point, their kickoff) still wait for Space.
6. No drive chart or play-by-play is reachable in one key.
7. The player card (M) opens at the top left of the calling screen, over the situation plate.
8. On kickoffs, 22 drawn paths pile up around the return.

## User

There is no `docs/research/personas/` folder. Same working assumption as the earlier M2 specs: Joseph and players like him. They know football, play on a landscape laptop, keyboard first, a full game in one sitting.

Assumptions that carry decisions:

- **A1. On the first screen of a call the player reads what just happened; after the first key he is building the next call.** It drives the board's two states (U1). Test: at the next playtest, note whether Joseph looks back at the full Last play text after his first key on a call. If he does more than rarely, the compact Last play (U1) is too compact.
- **A2. Repeat calls cluster: the last two distinct calls cover most of the calls a player repeats.** It drives U5's two slots. Test: the local play log counts Same call and Earlier call use (U5); if Earlier call is used under 1 call in 20, the row is not earning its place.
- **A3. Most "nothing to decide" dead balls are skipped on purpose by a player who has seen them many times.** It drives Q1's default (off) and its three values. Test: ask Joseph after a full game with the setting on whether he missed a moment he wanted to see.

## What the viewer reads first (calling screen, after this pass)

1. Score bug (unchanged).
2. Situation plate: down and distance, spot, drive tracker (unchanged).
3. Last play card: the result line with names, then the calls line, then the why headline. Why this order: the result is what changed, the calls are what met, the why connects them (M2 design HUD order).
4. The call card: section label, then the highlighted row.
5. The field board, beside the call card, once the player starts calling. It is read last because it answers "what does the row I'm on look like", which only matters after the eye is on a row.

## Choices per screen (the 7 cap, counted as built today)

| Screen | Today | After this pass | Change |
|---|---|---|---|
| Offense: Play type (`offense.playType`) | 1 Formation, 2 Kick, 3 Clock, 4 Same call, T, Esc = 6 | adds 5 Earlier call = 7 | U5 |
| Defense: Package (`defense.package`) | 1 Base, 2 Nickel, 3 Dime, 4 Specials, 5 Same call, T, Esc = 7 | unchanged = 7 | U5 (no room) |
| Settings | 1 to 5, Esc = 6 | adds 6 Auto-advance = 7 | Q1 |
| Pause | 7 rows | unchanged = 7 (L is an accelerator, as D is) | Q2 |
| Box score | 5 tabs, Esc = 6 | tab 5 renamed "Game log" = 6 (the log only scrolls; no row in it is a choice) | Q2 |
| Last play details | 1 Copy details, Esc = 2 | unchanged = 2 | U3 |
| Calling screen board | none | none: read only; hovering a mark opens its card as on the field today | U1 |
| Player card | unchanged | unchanged | Q3 |

## U1. Field board on the calling screen

**Decision (Final).** A read-only field diagram, the board (`calling.board`), sits in the calling screen's left column, under the Last play card. The call card keeps the right column at full height. The full field still shows only during the play (screen switch stays).

- **What it draws** (the same `field.ts` drawing functions as the play screen, at the board's own scale; it adds no frame logic):
  - Turf, paint, end zones and the midfield wordmark when in view; the line of scrimmage, the first-down line (not drawn when goal to go, or when it falls above the board's top edge) and the down tag.
  - The ball on the spot.
  - Both units, exactly as the calling spec's pre-snap states allow, and nothing more:
    - State 1 (no input yet in this call): the last play's whistle frame with its paths, or, after a change of possession, the idle frame (new offense attacking up, both sides in their huddles). This is the frame `restoreLast` and `idle` already choose.
    - State 2 (after the first input, or on any screen past the first): your unit lined up in the focused or picked formation or package, with the focused play's routes or coverage at 40%; their side in the labeled horseshoe huddle, no numbers, positions from the huddle template only (calling spec P1).
    - Public lineups (their kickoff, punt, field goal, extra point, kneel or spike, and your Kick and Kickoff rows on focus): both units lined up, as U8 and the calling spec already do.
  - New in this pass: focusing **Same call** or **Earlier call** (U5) previews that call, formation lineup plus play art at 40%, drawn from the call only (calling spec decision 9, P3).
  - Marks carry labels by the label setting when the request has `lineups` (approved 2026-11-14); without lineups they show no labels until the set, as the calling spec says.
- **Where it sits.** Two-column calling layout only (content width 760 px and up, as built). Grid columns become `[board column] [call column]`:
  - Board column width `boardW = min(560, floor((content - 24) / 2))`, but never under 529 px (56 yards at 9.44 px per yard, the floor every spacing test runs at). Call column: the rest, minus the 24 px gap.
  - Board scale `sB = boardW / 56` px per yard (53.3 yards plus the 1.35-yard margin each side). Mark size, label size and the spacing rules are the field's own.
  - Board height `boardH` = the cards row's height (plate bottom + 16 to legend top - 16) minus the Last play card's height minus 16. It never adds height to the screen, so it can never make the screen scroll more than the call card already does.
  - Camera: line of scrimmage 70% of the way down (the play screen's rule), moved down only as far as needed to keep your deepest lined-up mark plus 1 yard in view. Marks past the top edge are clipped by the board's rounded edge, as the play screen's camera clips. Pure function `boardCamera` in `layout.ts`.
  - Look: `radius.lg`, `overflow: hidden`, 1 px `color.hairline`, `shadow.2`, as DESIGN.md Step B.
- **Last play card, compact form.** In state 2, the Last play card collapses to the section label, the result line's first sentence and the "D Details" hint (about 64 px at 100% text). The board takes the height freed. Esc back to the first screen returns to state 1 and the full card (calling spec: "Esc back to a first screen returns to this state"). The switch is a `dur.base` crossfade in the left column only; the call card's rows never move. Reduced motion: a cut.
- **When it shows.** All must hold, else the left column is the Last play card alone, as today:
  1. two-column layout;
  2. text scale 125% or less;
  3. the call column, `content - 24 - boardW`, is at least 400 px, so the rows and their reasons fit on one line (content at least 953 px; at 1024x600 the board takes 529 px and the call column 423);
  4. `boardH >= 180` px (about 19 yards at 9.44: your lineup, the line, and the near half of their huddle).

  | Window (100% text) | Content | Board W / sB | Call column | Cards row, my estimate from styles.css | Board H, state 1 / state 2 |
  |---|---|---|---|---|---|
  | 1024x600 | 976 | 529 / 9.45 | 423 (card screens fall to the existing compact text rows) | about 309 | none (under 180) / about 229 |
  | 1280x720 | 1160 | 560 / 10.0 | 576 (3-column card grid as now) | about 429 | none / about 349 |
  | 1440x900 | 1160 | 560 / 10.0 | 576 | about 609 | about 383 / about 529 |
  | 1920x1080 | 1160 | 560 / 10.0 | 576 | about 789 | about 563 / about 709 |

  The heights are my reading of `styles.css` (top bar 64, panel top padding 24, plate 96, two 16 px gaps, legend about 75, a full U2 Last play card about 210). The rule is in pixels, so it holds whatever the real figures are; engineer records the measured ones in PERF.md (Open O7).
- **At 1024x600** the call column is 423 px, under the card grid's 3-column floor, so Formation, Run, Pass, Package and the defense play screens use the existing compact fallback (text rows with personnel notes). The board then carries the picture: arrowing through "1 Shotgun ... 5 Heavy" lines each one up on the ball. Why: two small pictures (card art and a cramped board) read worse than one board at the tested scale.
- **Snap.** Unchanged: the calling screen hides and the play screen fades in (screen-switch spec, DESIGN.md "Without the board"). The board-to-field growth in DESIGN.md Motion is not built in this pass.
- **Hover and M.** Hovering a mark on the board opens its player card, exactly like hovering the field. Huddle marks have generic ids and are skipped, as on the field. M cycles the marks on the board when it shows (else the hidden play canvas's marks, as today).

**Why.**
- The approval asks for the lineup back on the calling screen, and the screen-switch spec named "a small field diagram inside the calling screen" as the follow-up.
- Left column under the Last play card keeps the two tallest blocks apart. The call card at 7 rows is about 450 px on its own; anything stacked with it scrolls at 1280x720.
- Tying the board to state 2 uses the state machine the calling spec already has, so no new mode. A1 is the bet.
- 529 px minimum keeps the board at the spacing floor the art tests already prove, so no mark or label rule needs re-proving at a new scale.

**Rejected.**
- DESIGN.md Step B as drawn (532 px board on the left, Last play card and call card stacked on the right): at 1280x720 the right stack is about 660 px against about 429 available, so every call screen scrolls, which breaks calling spec K5.
- A third column for the board: about 260 px wide is 4.6 px per yard, and 14 px marks overlap on the line.
- Always-compact Last play card: hides the calls and why lines that U2 exists to show.
- The board-to-field growth at the snap: it touches the timeline's start and the PERF budget, and the approval didn't ask for it. Left for art-director's build order chunk 5 (Open O6).
- Drawing their real alignment before the snap: changes gameplay (calling spec, resolved 1).

**Keys.** None new. Arrows, hover, Enter and number keys work as today; moving focus updates the board on the next frame with the existing 150 ms preview glide (`motion.preSnap.glideMs`).

**States.**

| State | Board | Status |
|---|---|---|
| First call of the game | Empty field, ball on the spot, both huddles | Final |
| State 1, room for the board | The last play's whistle frame, or the idle frame after a possession change | Final |
| State 1, no room (1280x720 and smaller) | No board; full Last play card | Final |
| State 2 | Compact Last play; board with your lineup and the focused art; their huddle | Final |
| Focus on Same call or Earlier call | That call drawn on your lineup | Final |
| Focus on Back, Clock, Timeout or an off row | The committed state (picked formation, or state 1's frame) | Final |
| Public lineup (their kick, kneel, spike) | Both units lined up, no input needed; full Last play card, so it shows only where state 1 has room | Final |
| Lineups missing from the request | Your marks without labels | Final |
| Card art missing for a pair | Formation only on the board (calling spec state) | Final |
| Text over 125%, one-column layout, call column under 400 px, or board under 180 px tall | No board | Final |
| Resize | Recompute; the board appears or drops with no other layout change | Final |
| Reduced motion | Focus changes and the compact switch cut | Final |
| Loading, sim error, data error | Unchanged screens; no board | Final |
| Permission denied | Not applicable | Final |

**Accessibility.** The board canvas is `aria-hidden`: it shows your own call (named by the row and its personnel line), the spot (in the plate) and a huddle that carries no fact. The live region does not announce previews (calling spec). Contrast: the field's figures stand, it is the same paint. Shape before color, as on the field.

**Model output.** The board shows calls, never results. In state 1 it shows the engine's committed whistle frame. If it ever disagrees with the Last play text, the text wins and it is a bug; Copy details has the event.

**Acceptance.**
- CB1. `boardLayout(window, textScale, lastPlayHeight)` returns null unless all four show conditions hold, and the widths and scale in the table at 1024x600, 1280x720 and 1920x1080 at 100%. `boardCamera` keeps the deepest lined-up own mark plus 1 yard in view for every formation, the punt and field goal units and the kickoff unit.
- CB2. Over a scripted call (first screen, arrow to Formation, Shotgun, Pass, each pass card, Esc back twice), the board's frame equals the hidden play canvas's preview frame for the same state, and the left column switches full, compact, full at the right inputs.
- CB3. The no-leak test (calling spec P1) and the no-result-leak test (P3) pass with the board's frames: for one human call and every opponent call, board frames before the line-up are identical.
- CB4. At sB 9.44, the art tests' spacing checks (line spacing, label collisions, huddle overlap) pass on the board.
- CB5. The board never increases the calling screen's `scrollHeight` (compare with and without the board at 1024x600 and 1280x720 for every call screen).
- CB6. Focusing Same call or Earlier call draws exactly `playArt` for that call.

**Tests to add.** `packages/app/test/calling-board.spec.test.ts` (CB1, CB2, CB5, CB6, layout and DOM in jsdom); extend `art.test.ts` with CB4 at 9.44; extend the P1 and P3 tests with board frames (CB3).

## U2. Richer Last play card

**Decision (Final).** The Last play card shows, top to bottom:

1. `type.label` "Last play".
2. Result line (`type.result`, `chalk`), naming players with jersey numbers from `detail.participants` only. It drops the "Your ball, 2nd & 3 at OPP 41." tail on this card, because the plate under the bug says it in large type; the live region and the game log keep the score lines and flags.
3. Calls line (`type.note`, `chalkSoft`).
4. Why headline (`type.body`, `chalk`), then the hint "D Details" (a key hint, not a choice, as M2 design decision 13 and the lead's 2026-11-12 ruling).
5. Event lines (`type.note`), as today.
6. After Q1 auto-advanced plays: "Before that:" and one line per auto-advanced play's result (at most 2), then the hint "L Game log".

This reverses two earlier asks, by the approval of U2: Joseph's 2026-11-15 request to drop the why and calls lines from this card (comment in `app.ts` `gamePanel`), and the 2026-11-14 "names don't matter" note in `text.ts` `playText`. Record both in docs/DECISIONS.md (Open O9 is only the record, the approval stands).

**Copy.** A role the event doesn't name is left out of the sentence, never guessed (M2 design H2). `P` is `playerRef` ("#81 D. Okafor"). Spots use `yardLineText` from the human's side.

| Play | With every role present | Roles read |
|---|---|---|
| Run | "#22 R. Vance runs for 7, tackled by #54 T. Ruiz." | ballCarrier, tackler |
| Scramble | "#12 J. Pratt scrambles for 6, tackled by #54 T. Ruiz." | ballCarrier (fallback passer), tackler |
| Sack | "#12 J. Pratt sacked by #91 L. Ode for a loss of 7." | passer, sacker |
| Pass complete | "#12 J. Pratt to #81 D. Okafor for 12, tackled by #24 K. Moss." | passer, receiver (fallback target), tackler |
| Pass incomplete | "#12 J. Pratt incomplete, intended for #81 D. Okafor." | passer, target |
| Interception | "#12 J. Pratt intercepted by #31 C. Hale, returned to OWN 40." Tackler appended when named. | passer, interceptor, tackler; spot from `end.spot` |
| Fumble (any kind) | "... fumble forced by #55 A. Diaz, recovered by #90 M. Cole (Cranes)." | fumbleForcer, fumbleRecoverer; team nickname from the recovering side, as today |
| Kneel, spike | "#12 J. Pratt kneels." / "#12 J. Pratt spikes it, clock stopped." | the role the event names (ballCarrier or passer), else today's words |
| Kickoff, returned | "Kickoff by #3 A. Kerr. #29 P. Lane returns it to OWN 28, tackled by #44 F. Ng." | kicker, returner, tackler; spot from `end.spot` in the receivers' frame |
| Kickoff, other | "Kickoff by #3 A. Kerr, touchback." "... fair catch by #29 P. Lane at OWN 22." "... out of bounds." "... recovered by the Cranes." | kicker, returner |
| Onside kick | "Onside kick by #3 A. Kerr, recovered by the Cranes at OPP 46." | kicker; spot from `end.spot` |
| Punt, returned | "Punt by #8 B. Holt, 45 yards. #23 J. Day returns it 8 yards to OWN 30, tackled by #50 S. Park." | punter, returner, tackler; `detail.gross`, `detail.returnYards` |
| Punt, other | "Punt by #8 B. Holt, 52 yards, fair catch by #23 J. Day at OWN 12." / "..., touchback." / "..., downed at OPP 9." / "..., out of bounds at OPP 15." | punter, returner |
| Field goal, extra point | "47-yard field goal by #3 A. Kerr is good." "Extra point by #3 A. Kerr is no good." | kicker |
| Two-point try | The run or pass sentence, then "Two-point try is good." or "fails." | as run or pass |
| No play | "Flag before the snap: false start on #74 B. Smith (Cranes)." | foulers |
| Penalty sentence | "Flag: holding on #74 B. Smith (Cranes), accepted." Several fouls joined with "and", as today. | foulers, in `fouls` order |
| Standout | "Standout: " before the sentence, as today | |

Rules:
- **Return yards on punts** show only when the spots agree: `before.spot + gross - returnYards == end.spot`. Otherwise (a field clamp moved the end spot) the sentence names the spot only. Why: the engine draws return yards from a pool and then clamps the spot; a number that disagrees with the spot would be a made-up fact.
- **Kickoff return yards are not shown.** The kickoff result has no catch spot or return yards, only where the ball died (`resolve.ts` draws `returnEnd` directly). Open O1.
- **No defender on incompletions.** `PARTICIPANT_ROLES` has no pass defender. Open O2.
- **Calls line** keeps `callsLine`'s text, except when the defense made no call (kicks, kneels, spikes, extra points): only the kicking side's call, "You: Punt." or "They: Kickoff." Today it says "They: no call.", which reads as a missing fact.
- **Why headline** is `whyHeadline` (the engine's plain headline, or the standout's). Never `detail.why`. Missing: "No explanation for this play." (M2 design state).
- New reader field: `readDetail` reads `returnYards` (a detail field the engine already writes for punts; reading it is not a schema change).

**Why.** M2 design decisions 12 and 13 promised both lines; the calls line is how a player learns the matchup table, and a name with a number ties the text to a mark and a card.

**Rejected.**
- A separate players line under the result: one more line to read on 150 plays; the roles read naturally in the sentence.
- Keeping the "Your ball, ..." tail on the card: it repeats the plate.
- Team names on every defender: the role says which side he is on.

**Keys.** None new.

**States.** No plays yet ("No plays yet."); a role missing (left out); a player id not in either pool (role left out, one console warning per id); no headline (fallback text); penalty choice pending (the ruled play and the flag, as `showPending` does now, with names); review reversed (the play as it stands); standout; touchdown, safety, a score wiped by a flag (today's sentences); auto-advanced plays (item 6 above). All Final.

**Accessibility.** The live region keeps announcing the result, calls, event and why lines, now with names. Numbers read as "#81" text; no color carries meaning here.

**Model output.** Every name comes from `participants`, every number from the event. When the engine names nobody, the sentence is shorter, not filled in.

**Acceptance.**
- RL1. Over every play of 200 simulated games: every "#nn Name" in the result line maps to an id in `detail.participants` (or `foulers`) of that event, in the role the sentence gives it (extends M2 design H2).
- RL2. For a fixture of each row in the copy table, with every role present and with each role removed in turn, the sentence matches the table and drops exactly the removed role's phrase.
- RL3. Punt return yards appear only when the spot check holds; a fixture with a clamped spot shows the spot only. No kickoff sentence contains "yards" after "returns it".
- RL4. The card shows the calls line and the why headline for every play; the why text equals `whyHeadline` and never contains "x" followed by a digit.

**Tests to add.** `packages/app/test/result-line.spec.test.ts` (RL1 to RL4). Update `text.test.ts` expectations to the new copy, case for case; no case removed.

## U3. Last play details in plain words

**Decision (Final).** The details sheet (D, or pause row 2) shows, top to bottom:

1. The why headline once (`type.body`). `detail.why` is not shown; it stays in Copy details.
2. Four groups, each an `h3` and a list, in this order. A group with nothing in it is left out.

| Group | Trace entries | Copy |
|---|---|---|
| Situation | `call`; the calls line; `cell`; `fieldGoal`; `special` | "Your call: Shotgun, Short pass." "Calls: You: Shotgun, Short pass. They: Nickel Cover 1." "Situation table: deep pass, level 1 (0 is the most specific)." "Kick distance: 47 yards. Make chance: 78%." "Kick: returned, 45 yards gross." |
| Matchup | `matchup`, `formation` | "Their call, Nickel Cover 1: +14% toward Incomplete." (or "Your call, ..." when the human is on defense) "Shotgun against Nickel: -6% toward Sack." |
| Players | `participants`; `rating`; `standout` or `standoutCandidate`; `fouler` | "Passer #12 J. Pratt. Target #81 D. Okafor. Tackler #24 K. Moss." "Pass rush: +8% toward Sack." "Standout: #22 R. Vance's speed (94) made this result 50% more likely." A candidate with no standout on the event adds "It didn't count: the play didn't stand." "Flag on #74 B. Smith: holding." |
| Outcome | `class`; `fluke`; `penalty`; `review`; anything else | "Result: Incomplete. 31% before the edges, 35% after." "Fluke: a rare long gain (the 97.5th percentile)." "Flag: holding on the offense." "Reviewed: completion to incomplete." Unknown factors: "Other: <factor>: <key> <value>, ..." with any value that is a player id written as "#nn Name". |

3. Under the groups, one `type.note` line: "Edges scale how likely each result was before the engine rebalances; Result shows the final odds."
4. Seed line, as today: "Seed 123, play 45."
5. Rows: 1 Copy details, Esc Back (unchanged). Copy details keeps today's raw JSON (seed, league seed, play number, the whole event), so bug reports keep every raw multiplier and the cell key.

Number rules:
- A multiplier m becomes `+round((m - 1) * 100)%` or `-round((1 - m) * 100)%`, "toward" the class label (`labels[class] ?? class`). Every multiplier the trace has is shown; none is merged or dropped.
- The cell's raw key is not shown on the sheet. The family label (`labels[family] ?? family`) and the level are. Decoding the key's bins into words needs each family's dimension order, which `UiData` doesn't carry (Open O3).
- `fluke.reason` and `review.kind` go through `labels`; with no label, the id is shown as is, inside the Other format, never hidden.

**Why.** Every number the engine used stays, labeled with what it did, grouped the way a coach asks: what was the situation, what did the calls do, who mattered, what came out. The raw form keeps its job (bug reports) behind Copy.

**Rejected.**
- Dropping multipliers for words only ("helped", "hurt"): loses the depth target in M2 design decision 13.
- Showing the whole class probability table (`detail.classProbabilities`): useful, but its shape varies by play kind and isn't read by `readDetail` today. P2, Open O11.

**Keys.** D opens (unchanged); 1 copies; Esc back.

**States.** No play yet: "No plays yet." (unchanged). Empty trace: "The engine recorded no factors for this play." (unchanged). Penalty pending: the ruled play's trace. Unknown factor: Other row. Clipboard blocked: "Couldn't copy: the browser blocked the clipboard." (unchanged). All Final.

**Accessibility.** Real headings and lists, so a screen reader can jump by group. Signs are written "+14%" and "-6%" in text, never by color.

**Acceptance.**
- DT1. For each trace factor the engine emits (`call`, `cell`, `class`, `matchup`, `formation`, `rating`, `penalty`, `fluke`, `special`, `fieldGoal`, `fouler`, `standout`, `standoutCandidate`, `review`), a fixture renders into the group and copy above. No rendered line contains "id ", "|", " x1." or a raw player id.
- DT2. Over 200 simulated games, the count of multipliers on the sheet equals the count of `multiplier` fields in the trace, and each shown percent equals the formula.
- DT3. The headline appears exactly once; `detail.why` text never appears on the sheet; Copy details' JSON equals today's.

**Tests to add.** `packages/app/test/details-sheet.spec.test.ts` (DT1 to DT3).

## U5. Recent calls: Earlier call on the offense's first screen

**Decision.**
- **Offense (Final).** `offense.playType` gains row **5 Earlier call**, after 4 Same call. Same call is unchanged (the engine's option, F6 still holds). Earlier call is the most recent call you made on offense this game that:
  1. is a scrimmage call (a formation play, punt, field goal, kneel or spike; not a tempo change, timeout or try call);
  2. differs from the request's `sameCall` (compared on call and formation);
  3. is legal now: every option on its answer path is on in this request's screens (`["formation", f, "run" | "pass", play]`, `["kick", k]`, `["clock", c]`).

  It snaps at once by submitting that path as the answer, the same path the menus would build, so the engine sees nothing new. It starts both sides in the huddle like Same call (`ownStart: "huddle"`).
- **Defense (Final).** No change. The package screen is at 7 with Timeout. A defense call is already 2 keys, so a second recent row could save one key at most, and making room means removing Timeout from the first screen (M2 design decision 11) or a package. Open O4 only if Joseph wants it anyway.
- **Two-point try screen:** not in this pass (not a first screen).

**Copy.**
- On: "5 Earlier call: Under center, Inside run" (the same `callText` as Same call).
- Off, no call yet this game: "5 Earlier call (no earlier call)". Off, only one distinct call so far, or none of the earlier ones is legal now: "5 Earlier call (no other recent call)". These reasons are UI strings, not engine reason codes.
- Accessible name: "5, Earlier call: Under center, Inside run".

**Keys.** 5. One key, like Same call (C1).

**Why.** It makes the second most common call one key without touching the engine or the defense screen, and keeps every existing number in place (decision 9).

**Rejected.**
- Replacing Same call with three recent rows: the offense screen has room for one more row, not two.
- Showing an illegal earlier call off with its reason: the row would often be a punt that is off on 2nd down, which wastes the slot. The slot shows the most recent one that can be called.
- Enter as a hidden repeat: rejected in decision 10 for the same reasons.

**States.** No calls yet (off); one distinct call (off); earliest calls illegal now (next legal one, or off); after a possession change (calls persist across drives); after resuming a save (rebuilt from the event log, so identical); the engine rejects the path (should be unreachable): status line "That call isn't allowed now.", the menu reopens on the first screen, one console warning. Focus on the row previews the call on the board (U1). All Final.

**Accessibility.** A real button with its key in the name; off reason in words; dashed key hint as every off row.

**Model output.** The list comes from your own play events only. It never reads the opponent's calls (F5).

**Acceptance.**
- RC1. `offense.playType` has 7 choices with Earlier call, every request; the F3 count test passes.
- RC2. Over 100 simulated games with a scripted human offense: Earlier call is on exactly when a call matching rules 1 to 3 exists; when on, its submitted path equals the path of that call and the engine accepts it (no `answerError`); its call never equals `sameCall`.
- RC3. Earlier call is built only from play events where the human was on offense; a fixture with only opponent offense events gives "no earlier call".
- RC4. Keys and numbers of rows 1 to 4 and T are unchanged; Same call's F6 test passes unchanged.
- RC5. The local play log counts Earlier call picks (`earlierCalls`, default 0 for an old log).

**Tests to add.** `packages/app/test/recent-calls.spec.test.ts` (RC1 to RC5); `menu.test.ts` gains the row; F3 updated for the new count.

## Q1. Setting: auto-advance plays with no decision

**Decision (Final).** Settings row **6 Auto-advance** cycles three values. Default Off, so M2 design decision 17 holds by default.

| Value (row note) | Skips |
|---|---|
| Off | Nothing. Every dead ball waits for Space. |
| When there's nothing to decide | Qualifying dead balls when you can't call a timeout there. |
| Also skip my timeout chances | Qualifying dead balls even when you could call a timeout. |

**Qualifying dead balls.** A `continue` request whose `about.what` is:
- `theyKickOff`: their kickoff, onside or not, and their free kick after a safety;
- `theyLineUp` with call `punt`, `fieldGoal`, `extraPoint`, `kneel` or `spike`.

And all of these hold:
- The request's timeout row is absent or off (no timeouts left, one already taken this dead ball, or the rules don't allow one), unless the value is "Also skip my timeout chances". A timeout you can call is a decision.
- The request's `events` hold no two-minute warning and no end of period. Those change the clock state the player plans around.
- It is not the kickoff that follows a coin toss (the opening and overtime kickoffs belong to the coin toss ceremony, docs/specs/m2-game-entry-and-coin-toss.md, beat E8, which waits).
- It is not the first request after resuming a save, so the player always lands on a screen.

Never auto-advanced: the toss result, Under review, Review result, halftime, the end of the game, and every request that is not `continue` (calls, kickoffs you make, tries, penalty choices, the run-off, challenges).

**How it advances.** When a qualifying request arrives, the app answers Continue itself once the previous play's whistle hold has ended, in the frame it would have shown the calling screen. The calling screen is not shown; the next play's line-up starts. No timer, no countdown, no flash of the screen. During the auto-advanced play only Space and S work, as during any play. The play rail's "This play" label reads "This play (auto)".

**Copy.** Settings description: "Plays with nothing for you to choose (their kickoffs, punts, field goals, extra points, kneels and spikes) run without waiting for Space. Off by default. The middle setting still stops when you could call a timeout." Last play card: "Before that:" lines (U2 item 6).

**Keys.** None new. Turning it off is in Settings (pause row 5).

**Why.** The approval asks for it; the default and the timeout rule keep decision 17's reason (you may want a timeout there, and nothing happens without you unless you say so).

**Rejected.**
- Showing the screen for a moment, then advancing: that is the timed window decision 17 rejected, and it fails WCAG 2.2.1 for anyone who reads slowly.
- Auto-advancing the toss result and review results: once a game or rarer, and they carry facts the player must read (who receives, a verdict). Open O10 if Joseph wants them in.

**States.** Off (today); on with a timeout possible (waits, middle value) or skipped (last value); a chain (their touchdown, extra point, kickoff, then your call): the Last play card shows the kickoff and "Before that:" the extra point (the touchdown was shown at its whistle hold, and is in the live region and the log); a sim error during an auto-advanced play (the existing sim error screen); saves (autosave after every dead ball, unchanged); storage blocked (the setting lasts for the page, as other settings). All Final.

**Accessibility.** Nothing is timed for the player. The live region announces every play as it does now. Default off.

**Acceptance.**
- AA1. `settingsScreen` has 7 choices; the value persists; a stored setting without the field loads as Off.
- AA2. With Off, every `continue` request shows and waits (decision 17).
- AA3. With "When there's nothing to decide", over 50 simulated games with a scripted human: exactly the qualifying requests with no legal timeout are answered without a render of the calling screen; every request with a legal timeout waits.
- AA4. With "Also skip my timeout chances", qualifying requests advance whatever the timeout row says; the two-minute warning, toss, review and post-toss kickoff exceptions still wait.
- AA5. The same seed and answers give the same game record with the setting on and off (the setting changes only who presses Continue).
- AA6. The local play log counts auto-advances (`autoAdvanced`, default 0).

**Tests to add.** `packages/app/test/auto-advance.spec.test.ts` (AA1 to AA6). Update the usability pass test that pins Settings at 5 rows (`usability-pass.spec.test.ts`, its criterion 9) to 6 rows: the rule moved, nothing is weakened.

## Q2. Game log, one key away

**Decision (Final).** Key **L** opens the Box score on its fifth tab, renamed **Game log** (it was "Drives", which the M2 design already meant to carry the play-by-play). L works on the calling screen and in the pause menu, as an accelerator like D, so it adds no choice. By mouse: pause, 3 Box score, 5 Game log. L or Esc closes it back to where it was opened. L does nothing during a play (decision 8).

Layout of the tab (under the score by quarter, which stays on top):
- One scrollable list, newest first: the question you open it with is "what just happened, what have I been calling".
- A **drive header** row where each drive starts: team swatch and nickname, "drive, started OWN 25: 6 plays, 42 yds, 3:05. Touchdown." The open drive reads "drive in progress, started OWN 25: 3 plays, 12 yds." Figures come from `box.drives` (the same source as the tracker's drive line).
- A **play row** per play event, four lines: the situation before it and the game clock in `type.label` ("3rd & 4 at OPP 38, 2nd 8:12"); the U2 result line with its score and flag sentences but without the "Your ball, ..." tail (the next row says it); the calls line; the why headline in `type.note`.
- **Event rows** for timeouts, the two-minute warning, ends of quarters, reviews and the toss, one `type.note` line each (`eventLine`).
- Kickoffs and tries are play rows outside any drive, as the box score counts drives.

Grouping: a pure `driveStarts(events)` in `packages/app` that marks where each of `boxScore`'s drives begins (a scrimmage play whose offense differs from the open drive's, or the first scrimmage play after a half). A test pins it equal to `boxScore` (GL2). If the count ever differs from `box.drives`, the tab shows the plays with no drive headers and logs one warning, never a wrong header. Open O5 offers an engine-side alternative.

Pause row 3 gets the note "L". The panel footer adds "L Log". Controls adds "L: game log (drives and plays); L or Esc closes it".

**Why.** The M2 design already put play-by-play under the Drives tab; one key makes it the drive chart Joseph asked for, with no new screen and no new row on the full pause menu.

**Rejected.**
- A separate log overlay: needs a pause row, and the pause menu is at 7.
- Drives that expand to their plays: each expander is a choice and hides plays behind a key.
- Oldest first: the current drive would sit at the bottom of a long list.

**Keys.** L opens and closes. With the list focused: Up and Down scroll by a line, Page Up and Page Down by a screen, Home and End to the newest and oldest. Tab moves to the tab rows. Esc back.

**States.** No plays yet: "No plays yet." Box loading: plays show at once (from the event log), drive headers show "Loading drive totals..." until the box arrives. Grouping mismatch: no headers (above). A resumed game: the whole log (the step's `resumed` events). Overtime and a tie: periods read "OT", as the box score. Very long game: the list is built once per new event, not on every render. Opened from pause: Esc returns to pause. All Final.

**Accessibility.** The list is a focusable region (`tabindex="0"`, `aria-label="Game log, newest first"`) with each drive as a labeled group; on open, focus goes to the list. Text scales; at 200% the rows wrap, nothing truncates.

**Acceptance.**
- GL1. L opens the box score on Game log from the calling screen and the pause menu, and closes it; L does nothing while animating; no screen gains a button (F3).
- GL2. Over 100 simulated games, `driveStarts` gives the same number of drives as `boxScore`, with the same team, start spot and play count for each.
- GL3. The first drive header is the open drive when one is open; the first play row is the last play.
- GL4. Every play event of the game has exactly one play row; every row's result line equals the U2 result line for that event without the next-situation tail.

**Tests to add.** `packages/app/test/game-log.spec.test.ts` (GL1 to GL4).

## Q3. Player card on the calling screen never covers the header

**Decision (Final).** On the calling screen the player card opens over the **call column**, top aligned with the cards row (16 px under the situation plate), width `min(360, call column width)`, max height to the legend's top. In the one-column layout it opens over the call card, under the Last play card. It never covers the plate, the Last play card or the board. While it is open the covered call card is `inert`: number keys, T, Enter-on-a-row and arrows do nothing; M moves to the next player; Esc or Enter closes the card, and focus returns to where it was. The play screen placement is unchanged.

**Why.** The card is read against the plate (the situation), the Last play card (the player's number in the result line) and the board (his mark), so those stay visible. Covering the menu is safe only if the covered rows can't be picked by a stray key, hence `inert`.

**Rejected.** Over the left column: hides the mark or the result line the card is read against. Below the plate at the top left, as today shifted down: on the two-column layout it lands on the board.

**States.** Two-column with or without the board; one column; text at 200% (the card scrolls inside its box); ranks loading ("loading", as today). All Final.

**Amended (code review S4 and N1, 2026-11-15, as built).** The card is at least 240 px tall, kept inside the window, even when that runs it past the legend's top. Why: in the one-column layout at 200% text (1024x600) the call card can start a few pixels above the legend, or below the window once the screen scrolls, and "down to the legend's top" then left a card 0 px tall. The card still never covers the plate, the Last play card or the board; over the legend it covers only key hints, and the covered call card is inert while it is open. When the call card starts below the window, the card's top comes up into the window (never above the top bar); there it can cover the Last play card or the situation plate, the one case where the "never covers" rule gives way, because a card off the screen can't be read at all. `CARD_MIN_HEIGHT` and `callingCardBox` in `packages/app/src/ui/layout.ts`.

**Accessibility.** Unchanged dialog semantics; `inert` also removes the covered rows from the screen reader's reach while the card is open, so nothing hidden is announced as available.

**Acceptance.**
- PC1. At 1024x600, 1280x720 and 1920x1080, at 100% and 200% text, the card's rect never intersects the situation plate's rect or the board's rect.
- PC2. With the card open, pressing 1 to 7, T or Enter changes no menu state and sends no answer; Esc closes the card and restores focus.

**Tests to add.** `packages/app/test/card-anchor.test.ts` (PC1, PC2).

## Q4. Kick plays: trails that fade

**Decision (Final).** On kickoffs, onside kicks and punts, the path of every player the result doesn't name is drawn as a trail: each point of the path fades out linearly over `kickTrail.fadeMs` after the mark passes it, so it is at most about one second long at 1x. At the whistle those paths are not drawn. Named players (kicker, punter, returner, tackler, fumble forcer and recoverer) and the ball's dotted path draw on and stay in full, as now. Scrimmage plays are unchanged.

- Data: `data/ui/motion.json` gains `"kickTrail": { "fadeMs": 1000 }` (designed). The value is timeline ms, so 2x halves it in wall time like everything else.
- Skip and reduced motion: the final frame shows only the named players' paths and the ball path.
- The carrier trail (`fx.carrierTrail`) is unchanged.

**Why.** A kick has nearly every player converging on one spot, and the unnamed paths are diagram, not facts. The named paths plus the ball path tell the whole kick. Scrimmage plays keep full paths because the after-whistle diagram is how a player learns the matchup (DESIGN.md Marks, draw-on).

**Rejected.** Fading on every play: removes the scrimmage diagram players argue over. Fewer players drawn on kicks: every mark is a real player (DESIGN.md Do).

**States.** 1x, 2x, skip, reduced motion (above); a kick with a fumble (forcer and recoverer stay full); a muffed punt; an onside kick; a penalty on the kick (the flag marker, unchanged). All Final.

**Accessibility.** Fewer lines at the return makes the ball and carrier easier to find; nothing flashes, the fade is gradual.

**Acceptance.**
- KT1. For every kick fixture in `ALL_FIXTURES`, at any t, an unnamed player's drawn path covers at most `fadeMs` of his travel, with alpha falling from 1 at the mark to 0 at the tail; at the whistle no unnamed path is drawn.
- KT2. Named players' and the ball's paths at the whistle equal today's.
- KT3. Scrimmage fixtures draw exactly as today (golden primitives).
- KT4. Changing `kickTrail.fadeMs` in a fixture changes the trail length; no literal fade time appears in `marks.ts` or `field.ts`.

**Tests to add.** `packages/app/test/kick-trails.spec.test.ts` (KT1 to KT4); the motion schema test covers the new key.

## Shared states not listed above

Window too small, loading, data error, sim error and storage blocked are unchanged screens; nothing in this pass adds a permission. Every new size reads `var(--text-scale)`.

## Amendments to earlier specs

| Where | Was | Now |
|---|---|---|
| m2-screen-switch.md, Calling screen | "The field is not shown." | The full field is not shown; the board (U1) may show in the left column. |
| m2-screen-switch.md, Calling screen | "The player card (M) opens over the panel, top left" | Over the call column under the plate (Q3). |
| DESIGN.md Layout, Step B | Board docked left full height, Last play and call stacked right | Board under the Last play card in the left column, call card full height on the right (U1). For art-director to record (Open O6). |
| M2 design, decision 17 | Dead balls with no call always wait | Still the default; a setting can skip them (Q1). |
| M2 design, Box score | "5 Drives (with play-by-play)", rows expanding | "5 Game log", one flat list, L accelerator (Q2). |
| Usability pass, criterion 9 | Settings has 5 rows | 6 rows (Q1). |
| `app.ts` `gamePanel` note, 2026-11-15 | Why and calls lines dropped from the Last play card | Both back (U2, approved). |
| `text.ts` `playText` note, 2026-11-14 | Names no players | Names the engine's participants (U2, approved). |

## Engine and schema needs

None is required to build this pass. Everything reads data the event already has (`offense`, `defense`, `participants`, `trace`, `headline`, `gross`, `returnYards`, `end`) or the requests already carry (option legality, `sameCall`, `lineups`, timeout rows). The optional asks are Open O1, O2, O3 and O5. Local-only additions: two settings fields and two play-log counters in `storage.ts`, both defaulting when missing; no game data or save schema changes.

One data file change: the `kickTrail` key in `data/ui/motion.json` and its zod schema (Q4). Joseph's Q4 approval names motion.json as the place; I list it in O8 because an earlier spec treated new motion.json keys as a schema change.

## Open items

Settled by Joseph on 2026-11-15 (recorded in docs/DECISIONS.md, "Calling screen pass: open items settled"): O1, O2 and O3 are not in this pass (no engine or shared schema change); O4 Earlier call is offense only; O5 the UI `driveStarts` approach; O7 measured, in docs/PERF.md; O8 yes, `kickTrail` (fadeMs 1000) in motion.json and its schema; O9 recorded in DECISIONS.md as approved by Joseph on 2026-11-15; O10 auto-advance never skips the toss result or reviews.

- **O1 (engine, optional).** Kickoff return yards. The kickoff result has only the dead spot. Showing "returns it 22 yards" needs the engine to put a catch spot or return yards in `detail` for kickoffs. Until then the sentence names the spot only. Settled: not in this pass.
- **O2 (shared schema, Joseph).** A pass defender on incompletions. `PARTICIPANT_ROLES` has no defender role, and `playParticipantsSchema` is strict, so adding one is a shared schema change. Until then incompletions name the passer and target only. Settled: not in this pass.
- **O3 (engine, optional).** Words for the situation table's bins. The UI has no dimension order for each family, so the sheet shows family and level, not "1st down, 7 or more to go, own half". Needs the engine to send bin labels with the cell trace, or `UiData` to carry the dimension order. Settled: not in this pass.
- **O4 (Joseph).** Earlier call on defense. Needs a slot on a screen that is at 7. My recommendation is no. Settled: offense only; the defense is unchanged.
- **O5 (lead).** Drive boundaries for the log come from a UI function pinned to `boxScore` by a test. The alternative is the engine adding each drive's first event index to `Drive`, a sim type change. I recommend the UI function. Settled: the UI function (`driveSpans`, `driveStarts` in `packages/app/src/ui/gamelog.ts`), pinned by game-log.spec GL2.
- **O6 (art-director).** Record the board's layout in DESIGN.md Step B, and decide when the snap growth ships.
- **O7 (engineer).** Measure the cards row height at 1024x600 and 1280x720 (my estimates: about 309 and 429 px) and the full Last play card's height, and record them in PERF.md. The rules hold whatever the figures are; the table in U1 changes. Settled: measured, see docs/PERF.md (Measurements log, 2026-11-15, calling screen).
- **O8 (Joseph, confirm).** The `kickTrail` key in motion.json's schema, covered by the Q4 approval. Settled: yes (Joseph, 2026-11-15).
- **O9 (record).** Note in docs/DECISIONS.md that U2 supersedes the 2026-11-15 "drop the why and calls lines" ask and the 2026-11-14 "names don't matter" note. Settled: recorded as approved by Joseph on 2026-11-15.
- **O10 (Joseph).** Whether auto-advance should also skip the toss result and review results. Settled: never; both always wait.
- **O11 (P2).** The class probability table on the details sheet.
- **O12 (playtest).** A1 to A3 above; the 180 px board minimum; whether the compact Last play card switch reads as a jump at 1280x720.

## Not doing, and why

- No board-to-field growth at the snap, no new moments, no new motion beyond the board's existing glide and the compact crossfade.
- No change to the play screen, the rail's layout or the score bug.
- No pre-snap odds or advice (M2 design decision 14).
- No Earlier call on the two-point try screen or the defense screen.
- No new player roles, no new engine fields.
