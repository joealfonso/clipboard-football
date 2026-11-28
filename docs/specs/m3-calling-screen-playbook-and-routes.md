# M3 calling screen: big playbook, coordinator's picks, custom routes

Status: draft, revision 1, 2026-11-23. Owner: Joseph. Author: designer. Branch: to be cut for M3. Not built.

Source: Joseph, 2026-11-23: "better plays and a larger variety"; "recommendations based on the situation. coach stats can influence this. also have recommendations based on the other team, injured players, good and bad matchups"; "custom routes for a player each play. on offense and defense. you can select someone and draw out a route."

This file owns the flow, the screens, the states and the interaction. Two sister specs own the systems: docs/specs/m3-playbook-and-custom-routes.md (catalog, classifier, engine effect) and docs/specs/m3-recommendations.md (the recommender). Neither existed when I wrote this, so every "Needs from the sim" list below is a request to reconcile, not a settled contract. Where this file says nothing, DESIGN.md, docs/MENUS.md and the M2 specs stand. Conflicts with them are listed in "Amendments and sign-off".

Final means decided here, change only with a reason. Open means waiting on Joseph, a sister spec, art-director or a measurement. Pixel figures marked "estimate" are my reading of DESIGN.md and layout.ts, not measurements.

## Problem

1. The playbook is 8 offense concepts in 5 formations and 13 defense plays. Every menu fits one screen, and the same few calls repeat for 150 dead balls. A catalog several times larger does not fit the current screens, which are already at the cap (the offense first screen and Nickel are both at 7).
2. Nothing on the calling screen helps a player choose. M2 kept advice out on purpose (M2 design decision 14: "Hints and win probability are M3"). A newcomer has no way to learn what fits a situation except trial and the why line afterwards.
3. A call is all or nothing. The player can't change one player's job, so he can't act on something he has noticed ("their corner can't cover my best receiver").

## User

There is no docs/research/personas/ folder, so I can't point to a persona. I work from two groups, both assumptions:

- The caller: Joseph and players like him. Knows football, keyboard first, landscape laptop at 1280x720 or larger, a full game in one sitting, about 150 dead balls. Wants variety and control. Has said "don't require pressing enter to pick an option".
- The newcomer Joseph's standing direction asks for ("approachable, key numbers up front, full detail one click away"). Does not know what beats Cover 2. I have no evidence this player exists in the audience yet. The picks are designed so they cost the caller nothing if he ignores them.

Assumptions that carry decisions, and how to test each:

- A1. Most snaps will come from a pick, Same call or Recent, and a full playbook browse is the minority. It carries the five-key browse path (decision 3). Test: the local play log counts the path of every snap (pick 1, 2, 3, quick snap, browse, recent, same call). If browse is over half of Joseph's snaps in a full game, the browse path is too long and the tree needs a shortcut.
- A2. Players will want to stop at the line often enough that stopping by default is right. It carries decision 5, which reverses a Final M2 decision. I have no evidence. Test: the play log counts stops at the line, custom routes drawn, quick snaps and Esc back-outs from the line. If custom routes are drawn on fewer than 1 snap in 10 and Joseph says the stop drags, flip the default (Open question 1). The behavior is one flag, so the flip is cheap.
- A3. A coarse three-step confidence in words is enough for a player to weigh a pick. Test: at the first playtest, ask Joseph after 20 dead balls what "Leans" and "Likes it" told him, and whether he wanted a number.
- A4. One custom route per snap is enough to act on a read. Test: playtest note of every time Joseph tries to draw a second one.

Cheap, reversible choices (key letters, copy, tag wording) are made here without evidence and tuned in playtest.

## Decisions

1. **The first screen of every call is Home: the coordinator's three picks, then Playbook, Same call, Timeout, Menu.** Why: the picks answer "what fits here" for the newcomer, and the other four rows sit in fixed places so the caller ignores the picks with no extra key. Rejected: picks in a separate overlay (one more key to see them, so the newcomer never does), and picks as a banner above today's menu (the screen is at 7 already). Final.
2. **Picks are opinion, shown as opinion.** The coordinator is named with his rating. Confidence is three steps in words. Facts are numbers, judgments are words. No percentages, no expected yards, no win probability. Why: the recommender is never an oracle, and a number would read as the engine's truth. Final.
3. **The playbook is a tree with meaningful steps, and pages only at the leaves.** Play type, formation, concept, then design pages of five. Every screen holds at most six options plus Esc. Order is fixed by the catalog and never re-sorted by situation. Why: a play always sits at the same key path, which is how a fast player calls without reading, and the picks already do the situational sorting. Rejected: sorting or filtering by situation tags (paths move between snaps), type-to-search (digits and letters are keys here), favorites (not asked for; Open question 5). Final.
4. **A design card shows the whole play: every player's assignment.** Same art function as the board and the field, in chalk. Why: the card must promise exactly what the engine will run (calling spec decisions 3 and 5). Final.
5. **Picking a call takes you to the line. Space snaps. Q snaps the highlighted call at once and skips the line.** At the line the field is large, your unit is lined up with the play drawn, and you can draw one custom route or just press Space. Why: "select someone and draw out a route" needs a moment between choosing and snapping, and the natural one is the line. It also lets the player see a play from a much larger playbook lined up before committing. On Home the highlight starts on the top pick, so Q alone takes the top pick and snaps: one key. Cost, stated plainly: every call that is not quick-snapped costs one more key than in M2. Rejected: picks snap at once and an "R" control arms a stop for the next pick only. It keeps M2 decision 7, but the control is an eighth choice on Home (Same call would have to leave), it is a mode, and a first-time player who clicks a play watches it snap and never finds route drawing. Needs Joseph (Open question 1).
6. **Space never does anything on Home or in the playbook.** Why: Space is the skip key during the play. A player who mashes Space to skip must never call the next play by accident. Q is a letter nobody mashes. Final.
7. **Route drawing happens on the field at the line, in the play screen's stage, with the one sheet in the rail's place.** Why: at 1280x720 the play column is about 13.1 px per yard against the board's 10, marks are 18 px against 14, and 35 yards past the line are in view against about 24. The board growing into the field is a transition DESIGN.md already has. Rejected: drawing on the board (too small for touch, deep routes clip), a separate editor overlay (hides the field the route is drawn on). Final.
8. **One custom route per snap.** Drawing for a second player moves it. Why: one change gives one readable cost line, keeps the new engine effect bounded while it is balanced, and keeps the stop at the line short. A full redraw is a play editor, which is a different feature. Open question 2.
9. **What you see after drawing is the classified route, not your stroke.** The stroke is replaced by the snapped route with its name and depth, and that is what the animation runs. Why: the animation must never show what the engine did not use (DESIGN.md principle 10). Needs the playbook spec to agree (Open question 4).
10. **On defense you pick a unit, then a player.** Why: eleven defenders are eleven choices. Offense has at most five eligible players and needs no extra step. Rejected: any defender directly clickable, which breaks the cap (Open question 3). Final unless Joseph grants the exception.
11. **The opponent's real alignment is still never shown before the snap,** at the line or anywhere. You draw against a huddle. Why: the AI never sees your call or your custom route, and you never see its alignment (calling spec decision 7). Drawing into a visible hole would turn the feature into an exploit. Final.
12. **Nothing in this flow is timed.** See "Time". Final.

## How choices are counted

Counted: every control that answers the call or narrows it. Cards, rows, the page tile, Esc, Timeout, each selectable player or unit, each drawing action, and the field as a drawing surface (one). Not counted, as in M2 (lead ruling 2026-11-12 on "D Details"): keys that open a read-only view (D, L, M, W), and aliases for a choice or sequence already on the screen (Enter for the highlight, Q for "pick the highlight, then Space", a click on a mark for that player's row).

| Screen | Choices | Count |
|---|---|---|
| Home, offense or defense | picks 1, 2, 3; 4 Playbook; 5 Same call; T Timeout; Esc Menu | 7 |
| Home, two-point try | picks 1, 2, 3; 4 Playbook; 5 Same call; Esc Back | 6 |
| Why sheet | pick tabs 1, 2, 3; Enter To the line; Esc Close | 5 |
| After the touchdown | 1 Kick extra point; 2 Go for two; Esc Menu | 3 |
| Play type (offense) | 1 Run; 2 Pass; 3 Kick; 4 Clock; 5 Recent; Esc Back | 6 |
| Package (defense) | 1 Base; 2 Nickel; 3 Dime; 4 Specials; 5 Recent; Esc Back | 6 |
| Formation | at most 6 cards; Esc Back | at most 7 |
| Concept | at most 6 cards; Esc Back | at most 7 |
| Design page | at most 5 design cards; 6 Next page (only when there is more than one page); Esc Back | at most 7 |
| Recent | at most 5 cards; Esc Back | at most 6 |
| Kick, Clock | as today | 3 and 6 |
| At the line, offense | Space Snap; players 1 to 5; Esc Back | at most 7 |
| At the line, defense | Space Snap; units 1 to 4; Esc Back | at most 6 |
| At the line, defense, unit picked | Space Snap; players 1 to 5; Esc Units | at most 7 |
| Drawing | the field; Space Snap; Z Undo; X Back to the design; N Other reading; Esc Players | 6 |

The catalog owns the tree, and a test like today's F3 must fail the build if any screen it generates passes six options.

## The snap, end to end

1. Whistle. Home appears. The player reads the score bug, the situation line, the last play, then the top pick and its one reason.
2. One of:
   - **Q.** The top pick snaps. One key. Go to step 5.
   - **1, 2 or 3.** That pick goes to the line.
   - **4 Playbook,** then play type, formation, concept, design. The design goes to the line.
   - **5 Same call.** It goes to the line.
   - **W.** The Why sheet opens over the call sheet. Enter takes the shown pick to the line.
3. At the line: the field fills the column, your unit is lined up, the play is drawn at full strength. **Space snaps.** Or pick a player (a digit, or click or tap his mark), draw, read what it changes, then Space.
4. Esc at any point goes back one step. Nothing is lost except a custom route when you leave the line, and the status line says so.
5. The line's sheet hides in one frame, the play rail comes in, the huddle breaks, the set, the snap (calling spec states 3 to 5, unchanged). Overlays stay hidden during the play, as today.
6. Whistle. Home again. The last play's calls line names your call, whether it was the coordinator's pick, and any custom route.

Keys per call, counted from Home:

| Call | M2 | M3 |
|---|---|---|
| Coordinator's top pick | none | 1 (Q) |
| Pick 2 or 3 | none | 2 (digit, Space) |
| Same call | 1 | 2 (5, Space), or arrow to it and Q |
| A recent call | 1 (Earlier call, one slot) | 4 (4, 5, digit, Space), five slots |
| Pass from the playbook | 4 | 6 (4, 2, formation, concept, design, Space), 7 with a page turn |
| Defense from the playbook | 2 | 5 or 6 (4, package, concept if any, design, Space) |
| Punt on 4th down | 2 | 1 when it is the top pick (Q), 2 as pick 2 or 3, else 4 |
| Any call with a custom route | not possible | the call's keys, plus a digit and the drawing |

The browse path is two keys longer than M2. That is the price of a tree with four levels and a stop at the line, and A1 and A2 are the bets that make it acceptable.

## Time

The current UI has no play clock (DESIGN.md, HUD: "No play clock. The game is turn-based"). The game clock does not tick on the calling screen. The run-off before a snap is drawn by the engine from the tempo, never from how long the player took. This flow keeps all of that: browsing, reading the Why sheet and drawing take as long as the player likes, in every tempo including hurry-up, and nothing counts down or advances on its own. The local play log's `deadBallSeconds` will rise with drawing, so it gains a separate `drawSeconds` list to keep the two readable.

## Home

**Purpose.** Start every call with the coordinator's view of the situation and the four fixed ways out of it.

**Reads first.** Score bug, situation line, last play (what changed), then the highlighted top pick and the reason line under the cards, then the fixed rows. The reason is under the cards because it explains the card the eye is already on.

**Layout.** The calling screen as built. Only the call sheet's contents change.

```
+------------------------------------------------------------------------------+
| [ SCORE BUG ]                                                     Esc Menu   |
| (O) 2ND & 6   OPP 44               [EZ]====drive===(ball)--|---------[EZ]    |
|               You're on offense    Drive: 5 plays, 31 yds                    |
|                                                                              |
| Last play             D Details  +-----------------------------------------+ |
| #22 R. Vance runs for 4,         | Coordinator's picks              W Why  | |
| tackled by #54 T. Ruiz.          | R. Whitlow, play calling 71             | |
| (O) You: Pistol, Inside zone     | +------------+------------+-----------+ | |
|     (his pick 1).                | |[1] Mesh    |[2] Inside  |[3] Y      | | |
| (X) They: Nickel Cover 3.        | |            |    zone    |    corner | | |
| why line                         | | (diagram)  | (diagram)  | (diagram) | | |
|                                  | | Shotgun,   | Pistol,    | Shotgun,  | | |
| (board: the state 1 frame        | | short pass | inside run | medium    | | |
|  where it fits, as today)        | | Likes it   | Leans      | Leans     | | |
|                                  | +------------+------------+-----------+ | |
|                                  | He likes Mesh: #81 D. Okafor, WR 88,    | |
|                                  | should draw #24 K. Moss, CB 74.         | |
|                                  | [4] Playbook       [5] Same call:       | |
|                                  |                    Pistol, Inside zone  | |
|                                  | [T] Timeout (3 left)   [Esc] Menu       | |
|                                  | status line                             | |
|                                  +-----------------------------------------+ |
| Arrows Move  Enter Pick  Q Snap now  W Why  D Details  L Log  M Player cards |
+------------------------------------------------------------------------------+
```

- Section label: "Coordinator's picks" (`type.label`). Under it the coordinator's name and his play-calling rating in `type.note` `chalk`: a fact, so not `chalkSoft`. The "W Why" key hint sits at the right end of the label line.
- Advice line (only when the coordinator has clock advice, see "Decision advice"): one `type.note` `chalk` line above the cards.
- Pick cards: three `card.play` tiles in a three-column grid, in rank order. Each, top to bottom: key hint and design name (`type.note` 600, two lines reserved so the diagrams line up); the diagram; the meta line, formation and concept in `type.small` `chalkSoft`; the confidence line in `type.small` 600 `chalk` with its three pips.
- Reason line (`hud.reasonLine`, proposed): one sentence in `type.body` `chalk`, at most two lines at 100% text. It gives the reason of the highlighted pick, and the top pick's reason when the highlight is on a fixed row. A matchup reason names both players with position and overall. "Close call between 1 and 2." leads the line when the recommender flags it.
- Fixed rows, as Rows in DESIGN.md: 4 Playbook, 5 Same call, T Timeout, Esc Menu, in two columns when the call column is 520 px or wider, else one column. Labels wrap, nothing truncates.
- The board follows the highlight exactly as today: state 1 until the first input, then the highlighted pick on your lineup at full strength.

**Confidence.** Three steps from the recommender, in words: "Leans", "Likes it", "Strong pick". Three 6 px pips beside the word repeat it (proposed `hud.confidence`); the word is always printed, so the pips carry nothing alone. There is no fourth step and no step that claims certainty.

**Coach quality.** Shown as the rating beside his name, and in the Why sheet as which factors he read at all. A weak coordinator's picks are not dimmed or marked "unsure": the recommender makes them worse, and the UI says who is talking.

**Ignoring the picks.** Keys 4, 5, T and Esc never move. The picks never open a dialog, never need dismissing and never ask "are you sure". A snap that ignores them is not marked as a mistake anywhere.

**Keys and pointer.**

| Input | Does |
|---|---|
| 1, 2, 3 | That pick goes to the line |
| Q | The highlighted call snaps now. The highlight starts on pick 1 |
| 4 | Opens the playbook |
| 5 | Same call goes to the line |
| T | Timeout, as today |
| W | Opens the Why sheet on the highlighted pick, or pick 1 |
| Arrows | Left and right across the picks, down to the rows. The first arrow arms the board preview, as today |
| Enter | Picks the highlight (to the line) |
| Space | Nothing (decision 6) |
| Hover, click, tap | Hover moves the highlight. Click or tap picks, on pointer up, as today |
| D, L, M, Esc | As today |

**States.**

| State | What shows | Status |
|---|---|---|
| Three picks | As drawn | Final |
| One or two picks | The cards that exist, left aligned. Empty slots are not drawn; their digits do nothing | Final |
| No picks (the recommender returned none, or failed) | In place of the cards, one `type.body` line: "No picks for this snap." The fixed rows keep their keys. Q on a fixed row still works; Q with the highlight on nothing does nothing. A failure also logs one console warning. The snap is never blocked | Final |
| Picks not ready yet | Only if the recommender can't ride on the request (see needs). The card area keeps its height and shows "Picks are on the way." in `type.note`. The fixed rows work at once. The cards fill in place and nothing moves. No spinner, nothing loops | Open: I ask for picks on the request so this state is unreachable |
| A pick is not legal by the time it shows | Unreachable by contract. If it happens the card is drawn off with the engine's reason, like any off card | Final |
| Close call | Reason line leads with "Close call between 1 and 2." | Final |
| A pick uses a substitute | Meta line adds "Sub at RB". The reason line or the Why sheet names both players | Final |
| First snap of the game | Picks from situation, matchups, availability and style only. The Why sheet says the tendencies row has nothing yet | Final |
| Same call is a pick too | Both show. They are different questions | Final |
| No same call yet | Row 5 off: "Same call (no earlier call)", as today | Final |
| Long design names | Wrap to the two reserved lines. The catalog caps names at 22 characters (need) | Final |
| Long coordinator or player names | Wrap; the reason line may take a third line and the cards' art shrinks by the existing fit rule | Final |
| Fourth down, two-minute, try | See "Decision advice" | Final |
| Text over 125%, or a short window | Fit steps, in order: art shrinks to the 56 px floor (`CARD_ART_MIN`); the confidence line joins the meta line; the compact fallback, three text rows with the reason as the row note. At 200% the sheet scrolls before anything truncates | Final, figures to measure |
| One-column layout (under 760 px of content) | Compact rows, no board, as today | Final |
| Loading, data error, sim error, storage blocked, window too small | The existing screens | Final |
| Permission denied | Not applicable | Final |

**Responsive, 1280x720 at 100%.** Call column 576 px. My estimate of the height left for the seven choices is about 360 px: cards about 175 (art about 80 tall), reason line about 50, two lines of fixed rows about 102 to 122, gaps 24. That is tight. Engineer measures and records it in PERF.md; the fit steps above are the rule whatever the figures are. The screen must not scroll at 1280x720 and 100% (calling spec K5).

**Needs from the sim.**
- Picks on the `offenseCall`, `defenseCall` and `try` requests, ranked, zero to three. Each: the answer path, the design id, a kind (play, punt, field goal, kneel, spike), the confidence step (1 to 3), the headline reason as a template with typed parts (never a finished English string with numbers baked in that the UI can't check), and the factor list for the Why sheet.
- The coordinator's name and play-calling rating, per side of the ball.
- A `closeCall` flag when the top two are near each other.
- Every pick legal for the request it rides on.
- The same game for the same seed and answers whether or not picks are computed or shown.
- A time budget for the recommender inside the dead-ball budget, recorded in PERF.md.
- Design labels of at most 22 characters and a one-sentence plain description for the status line.

## The Why sheet

**Purpose.** The full factor breakdown for a pick, one key away.

**Layout.** An overlay (`color.overlay`, `hairlineStrong`, `shadow.3`, `radius.lg`) over the call column, in the box the player card uses there (`callingCardBox`). The situation line, the last play and the board stay visible, and the board shows the pick. The call sheet under it is inert while it is open.

```
+-------------------------------------------+
| [1] MESH   [2] Inside zone   [3] Y corner |
| Shotgun, short pass.  Likes it            |
| R. Whitlow, play calling 71               |
|                                           |
| Situation                    Helps, clear |
|  2nd and 6: a short throw keeps 3rd down  |
|  short.                                   |
| Their likely call           Helps, slight |
|  He expects zone behind a four-man rush.  |
| Their tendencies today       Helps, clear |
|  Zone on 9 of 12 pass downs so far.       |
| Likely matchups                           |
|  (O) #81 D. Okafor WR 88  on              |
|  (X) #24 K. Moss  CB 74      Yours by 14  |
|  (O) #74 B. Smith LT 69  on               |
|  (X) #91 L. Ode   DE 90     Theirs by 21  |
| Availability                Costs, slight |
|  Out: #22 R. Vance, RB 85 (ankle).        |
|  In: #34 T. Bell, RB 68.                  |
| His style                   Helps, slight |
|  He calls short passes more than most.    |
|                                           |
| Picks are his opinion. Their call is      |
| hidden from him, as it is from you.       |
| [Enter] To the line        [Esc] Close    |
+-------------------------------------------+
```

- Header: three pick tabs, the shown one in `type.cardName` (display caps), the others in `type.row`. Then formation, concept and the confidence words.
- Factor rows (`hud.factorRow`, proposed), in a fixed order: Situation, Their likely call, Their tendencies today, Likely matchups, Availability, His style. Each: the label in `type.label`; at the right, the direction and strength in words, `type.note` 600 `chalk` ("Helps, clear", "Costs, slight", "Tests"); under it the sentence in `type.note` `chalk`.
- Direction is one of three words: Helps, Costs, Tests. "Tests" means it depends on their call. Strength is one of three words: slight, clear, strong. Never color, never a bare arrow.
- Numbers for facts, words for judgments. Counts from this game ("9 of 12"), ratings and distances are printed as numbers because they are facts. How much a factor moves the play is a word, because it is the coordinator's judgment.
- Matchup rows: each player led by his side glyph at 14 px in his team's colors (disc or X), then "#81 D. Okafor WR 88", tabular. The edge in words: "Yours by 14", "Theirs by 21", "Even". The label says "Likely" because who lines up on whom depends on their call.
- Availability rows: "Out:" and "In:" with number, name, position and overall, the reason in brackets when the sim has one. "Limited:" for a player on the field below his usual rating, with both ratings ("QB 81, usually 88").
- A factor the coordinator did not read: the row stays, with "No read." and the reason in `chalkSoft` ("Too few plays so far: 3." or "He doesn't track this."). This is how a weaker coordinator shows: fewer rows read, not fake doubt.
- Footer, always: "Picks are his opinion. Their call is hidden from him, as it is from you."

**Keys.** W opens and closes. Left, right or 1, 2, 3 change the pick. Enter takes the shown pick to the line. Esc closes. M, D and L do nothing while it is open.

**States.** No picks: W does nothing and the status line says "No picks to explain." A pick with no factors: "He gave no reasons for this one." One or two picks: only those tabs. Long sentences wrap; the sheet scrolls inside its box at large text, like the player card. Opened on a fourth-down, try or clock pick: the same rows, with the decision's own factors (score, time, distance, kicker range) under Situation. Reduced motion: appears at once.

**Needs from the sim.** For each pick, the factors: kind, direction (helps, costs, tests), strength (1 to 3), whether it was read and why not, and typed parts (player ids, counts, distances) so the UI builds the sentence and can check every name against the rosters. The players in a matchup row, both sides. Availability: status (out, limited, in for), the usual and current rating, a reason word.

## Decision advice: fourth down, the try, the clock

- **Fourth down.** Home, with one change: the three picks are the coordinator's ranking of the decision itself. One card per legal kind where it has room: a go-for-it design, Punt, Field goal ("Field goal, 47 yd"). The section label reads "4th down: coordinator's call" and the reason line leads with the decision: "Punt. 4th and 6 from your own 31 is too far to try." Punt and field goal cards show the unit's alignment. Every card goes to the line like any other, and Q snaps the top one.
- **The try.** "After the touchdown" keeps its two rows. The row the coordinator prefers carries the note "coordinator's pick" in `type.note` `chalk`, and the reason line sits under the rows. W opens the Why sheet with one tab. Q takes his pick. Going for two opens Home with picks for the two-point play.
- **Kneel and spike.** They can appear as pick cards on Home when he ranks them in his three. On the Clock screen the row he prefers carries the same note.
- **Timeout and tempo.** Never a pick card, because Q must only ever snap the ball: it must not spend a timeout or change the tempo. They show as the advice line above the cards ("Clock: he'd call timeout first. 0:48 left, 2 timeouts.") and as the "coordinator's pick" note on the T row or the tempo row.
- **States.** No advice: no line and no note. Advice for a row that is off: not shown. The advice line and the row note always agree, because both come from one field.

**Needs from the sim.** On fourth down, picks that cover each legal decision kind. For the try, the preferred option and its factors. Clock advice as its own field: timeout (yes or no) and tempo, each with a one-line reason.

## Playbook: play type, package, formation, concept

**Purpose.** Reach any design in the catalog by fixed steps.

**Offense tree.** Play type (1 Run, 2 Pass, 3 Kick, 4 Clock, 5 Recent), then for Run or Pass: formation, concept, design page. The first four rows of Play type are MENUS.md's, with their numbers. On a two-point try only Run and Pass are on, and the others stay with their reasons.

**Defense tree.** Package (1 Base, 2 Nickel, 3 Dime, 4 Specials, 5 Recent), then concept (for example zone coverage, man coverage, pressure, stunt, from the catalog's concept tag), then design page.

```
+-----------------------------------------+   +-----------------------------------------+
| Playbook                                |   | Playbook: Pass, Shotgun                 |
| [1] Run                                 |   | +-----------+-----------+-----------+   |
| [2] Pass                                |   | |[1] Short  |[2] Inter- |[3] Deep   |   |
| [3] Kick (4th down or last 2:00 only)   |   | |           |  mediate  |           |   |
| [4] Clock                               |   | | (lineup,  | (lineup,  | (lineup,  |   |
| [5] Recent                              |   | |  band)    |  band)    |  band)    |   |
| [Esc] Back                              |   | | 6 plays   | 5 plays   | 4 plays   |   |
| status line                             |   | +-----------+-----------+-----------+   |
+-----------------------------------------+   | |[4] Screen |[5] Play   |               |
                                              | |           |  action   |               |
                                              | | 2 plays   | 3 plays   |               |
                                              | +-----------+-----------+               |
                                              | [Esc] Back                              |
                                              +-----------------------------------------+
```

- Play type and Package: Play type is text rows; Package keeps its cards. Recent is a text row on both.
- Formation: cards as today (alignment and the personnel line).
- Concept: cards. The art is the formation's alignment plus the concept's depth band for a pass, or its lane for a run, and no routes, because a concept is now several designs and one design's routes would misstate the rest. The bottom line is the count: "6 plays".
- Breadcrumb in the section label: "Playbook: Pass, Shotgun". On a design page the page is added.
- Rules that keep every screen legal: at most six options; a level with one child is skipped (a concept with one design goes to the line as that design, and its card shows the design's art and name); a package with six or fewer designs has no concept step; if the catalog ever has more than six formations or six concepts at one level, it must add a named step, never a page.
- The board follows the highlight: a formation card lines your unit up, a concept card shows the lineup and the band.

**Keys.** Digits pick. Arrows move in the grid. Enter picks the highlight. Esc or Backspace goes back one step. Q and Space do nothing on these screens (no full call is highlighted), except Q on a Kick or Clock row that is a full call, and on a one-design concept card.

**States.** A concept with no designs in this formation: its card is off, "no plays from this formation", number kept. Kick off outside 4th down and the last 2:00, as today. Recent off with "(no earlier call)". Compact fallback at small heights or large text: text rows with the count or personnel as the note, as today. Loading: none, the catalog loads at startup. A catalog that fails validation: the existing "Game data failed its check" screen.

**Needs from the sim.** The request's screens generated from the catalog tree with at most six options each, ids stable across snaps. Per concept and formation, the count of designs. Concept labels and one-line descriptions. Reason codes for an off concept or design.

## Design page

**Purpose.** Choose one design from a concept, by its picture.

```
+-------------------------------------------------+
| Playbook: Pass, Shotgun, Short. Page 1 of 2     |
| +--------------+--------------+--------------+  |
| |[1] Mesh      |[2] Stick     |[3] Slant     |  |
| |              |              |    flat      |  |
| | (11 marks,   | (diagram)    | (diagram)    |  |
| |  every job)  |              |              |  |
| | Pick 1       | Short yardage| Red zone     |  |
| +--------------+--------------+--------------+  |
| |[4] Quick     |[5] Spacing   |[6] Next page |  |
| |    outs      |              |              |  |
| | (diagram)    | (diagram)    | Page 1 of 2  |  |
| |              | Sub at RB    |              |  |
| +--------------+--------------+--------------+  |
| [Esc] Back                                      |
| Mesh: two receivers cross under the linebackers.|
+-------------------------------------------------+
```

**Design card anatomy** (`card.play`, extended):

1. Key hint and the design name, `type.note` 600 `chalk`, two lines reserved.
2. The diagram, chalk on the tile, one color: `chalkSoft` at rest, `chalk` when selected. All eleven marks and one path per player:
   - route: a path ending in an arrowhead;
   - block: a short path ending in a tick;
   - run path: a path with an arrowhead from the back through his lane;
   - quarterback drop: a short path with no end cap;
   - fake: the one dashed path;
   - zone drop: a path ending in a dot inside its zone shape;
   - man coverage: a tether to a generic receiver circle;
   - blitz and stunt: a path ending in a dot at the point of attack, a stunt's path curving around its neighbor's;
   - spy: a tether to a generic circle at the quarterback's spot.
   - Pass designs keep the depth band. No ball, no target, no primary read, no result (calling spec decision 4 stands).
3. The meta line, `type.small`: up to two situation tags in words from the catalog ("Short yardage", "Red zone", "Two minute") in `chalkSoft`; "Pick 1" (or 2, 3) in 600 `chalk` when the design is one of the coordinator's picks; "Sub at RB" when the design's lineup includes a substitute. Tags are words only. No chips, because a chip would be a surface inside a tile inside a sheet.

**What the card art system needs.** Today `offenseArt` and `defenseArt` build paths from a formation and a concept template (`cardArt(kind, unit, call, counts, templates)`). For designs it needs:
- an art function keyed by design id that reads the design's per-player assignments from the catalog and returns the same `Art` primitives, used by the card, the board and the field alike;
- two new path ends in `cardSvg`, a dot for defense paths and none for a drop (DESIGN.md already asks for the dot);
- paths with more than two waypoints and round joins for stunts and option routes;
- a tether to the quarterback spot for a spy.
No new colors and no new mark shapes.

**Page tile** (`card.page`, proposed). The sixth grid cell when a concept has more than five designs: a tile with no diagram, key 6, "Next page", and "Page 1 of 2" in `type.small`. It wraps from the last page to the first. Key 6 keeps its place on a short last page. A concept may have at most three pages; past fifteen designs the catalog must split the concept.

**Keys.** 1 to 5 take that design to the line. 6 turns the page; the highlight goes to card 1 of the new page. Q snaps the highlighted design now. Arrows, Enter, hover, click as on every card screen. Esc goes back.

**States.** One page: no tile, up to five cards. A design that is off now: its card is off with the reason in words, its diagram at half opacity, its number kept. Art missing for a design: "No diagram for this play", still pickable, and a test makes it unreachable in shipped data. Long names wrap in the reserved lines. Compact fallback: text rows with the meta line as the note; the board carries the picture. 200% text: two columns, the sheet scrolls.

**Responsive.** At 1280x720 and 100% the grid is three columns of about 168 px tiles with art about 152 by 114 (estimate, today's size). Two rows of tiles plus the Esc row is today's Pass screen, so it fits where that fits.

**Needs from the sim.** Per design: id, label, description, formation, concept, depth, situation tags, the per-player assignments in a form the art function can draw, and legality with a reason code. A stable order within a concept. The lineup (existing `lineups`) for each formation or package, with a mark for a substitute.

## Recent

**Purpose.** Call again something you called earlier this game.

Up to five design cards, newest first, built from your own play events on this side of the ball, distinct, and legal now. Card 1 is the same call as Home's row 5. The meta line says when: "last play", "3 plays ago". It replaces the single Earlier call row (calling screen pass, U5) and gives the defense the same screen, which U5 had no room for. A recent call repeats the design only, never an old custom route.

**States.** None yet: the Recent row is off. Fewer than five: only those. A recent call that is not legal now is left out, not shown off (U5's rule). Built only from your own events, never the opponent's.

**Needs from the sim.** Nothing new: play events already carry your call. They need to carry the design id.

## At the line

**Purpose.** See the chosen call lined up at full size, snap it, or pick one player to redraw.

**Reads first.** The field: your unit and the play's paths. Then the sheet: the play's name, then the Snap row, which is highlighted.

**Layout.** The play screen's stage (DESIGN.md Layout, Play screen): the field column at full height under the top bar, and where the rail sits, the screen's one sheet (`color.surface`, `hairline`, `radius.lg`, padding 20 px 24 px), width `clamp(300px, 340px * textScale, 420px)`, top aligned with the column. The top bar's hint reads "Esc Back".

```
+------------------------------------------------------------------------------+
| [ SCORE BUG ]                                                     Esc Back   |
|      +----------------------------------+  +------------------------------+  |
|      |              [Huddle]            |  | At the line                  |  |
|      |           x x x x                |  | SHOTGUN, MESH                |  |
|      |          x       x               |  | Short pass. Pick 1.          |  |
|      |           x x x x x              |  |                              |  |
|      |    ^                             |  | [Space] Snap                 |  |
|      |    |      <------+   +---->  ^   |  |                              |  |
|      |    |    +------->|   |       |   |  | Custom route, one per play   |  |
|      |====|====|========|===|=======|===|  | [1] #81 D. Okafor            |  |
|      |   (1)   (2) O O O O O   (3)  (4) |  |     WR 88. Shallow cross     |  |
|      |    88    82              79   77 |  | [2] #11 M. Reyes             |  |
|      |              QB   (5)            |  |     WR 82. Shallow cross     |  |
|      |                    68 [Sub]      |  | [3] #86 T. Hall              |  |
|      |                                  |  |     TE 79. Corner            |  |
|      |                                  |  | [4] #15 J. Cole              |  |
|      |                                  |  |     WR 77. Go                |  |
|      |                                  |  | [5] #34 T. Bell              |  |
|      |                                  |  |     RB 68, sub. Pass block   |  |
|      |                                  |  | [Esc] Back                   |  |
|      +----------------------------------+  +------------------------------+  |
+------------------------------------------------------------------------------+
```

- Field: your unit lined up, labels on, the design's paths at full strength (you are still choosing). Their unit stays in its labeled huddle. Line of scrimmage, first-down line and down tag as on the board.
- Sheet, top to bottom: `type.label` "At the line"; the call in `type.cardName` (display caps: formation, design); a `type.note` line with the concept, and "Pick 1" when it was a pick; the Snap row; `type.label` "Custom route, one per play"; one row per player you can draw for; Esc Back.
- Player rows: label "#81 D. Okafor" in `type.row`; note "WR 88. Shallow cross" in `type.note` (position, overall, his job in this design). A substitute's note says "sub"; a limited player's says "limited". Order: left to right as lined up, so row 1 is the leftmost eligible player.
- The digit of each row is also drawn on the field beside that player's mark as a tag (`color.tag` pill, the on-field tag component), so a key and a mark can be matched without reading names.
- Availability on the field: a "Sub" or "Hurt" tag beside the mark, the same tag component. Words, not color.
- Players you can't draw for (linemen, the quarterback) have no row and no digit, and their marks are not targets. Hovering one still opens his player card.
- Kicks, kneels and spikes: the unit lined up as today's public lineups, the sheet with Snap and Back only, and one `type.note` line: "Nothing to draw on this one."

**Defense.** The sheet lists units instead of players: "[1] Line (4)", "[2] Linebackers (2)", "[3] Corners (3)", "[4] Safeties (2)". Picking a unit lists its players, at most five, with Esc back to the units. On the field, hovering any defender highlights his whole unit's rows, and a click picks the unit; a second click picks the player.

**Keys and pointer.**

| Input | Does |
|---|---|
| Space | Snaps |
| Enter | Picks the highlighted row. The highlight starts on Snap |
| 1 to 5 | Selects that player (or unit) and opens Drawing |
| Click or tap an eligible mark | The same as his digit. Pressing on his mark and dragging selects him and starts the stroke in one gesture |
| Up, Down | Move the highlight through the rows |
| M, hover on a mark | Player card, over the sheet, as on the play screen with a rail |
| Esc, Backspace | Back to the screen the call was picked from, its highlight where it was. A custom route is dropped and the status line says "Custom route dropped." |
| T, D, L, W, Q | Nothing. Timeout is on Home only (M2 decision 11) |

**Hit targets.** A mark's target is a circle of radius `max(22 px, markPx / 2 + 8 px)` around its center, so at least 44 px across, on every pointer type. Only eligible marks are targets. Where two targets overlap (a bunch or a stack), the nearer center wins, and the rows are always there as the exact alternative.

**Transitions.** Calling to the line is DESIGN.md's "Calling to play" move: with the board on screen it grows into the column over `dur.snap`, and the sheet fades in over `dur.screen`; without the board, the fade. Keys work from the first frame, so Space during the growth snaps. The line to the play: the field does not move; the sheet hides in one frame, the rail fades in, paths drop to the set phase's 40%. Esc: the reverse of the growth, or a cut. Reduced motion: all cuts.

**States.**

| State | What shows | Status |
|---|---|---|
| A run or pass design | As drawn | Final |
| A defense design | Units, then players | Final |
| A kick, kneel or spike | Snap and Back, "Nothing to draw on this one." | Final |
| Nobody can be drawn for (the sim returns no drawable players) | Snap and Back, "No one to redraw on this play." | Final |
| A custom route is set | That player's row note reads "Custom: out, 8 yd"; the Snap row reads "Snap with #81's out"; the field shows it (see Drawing) | Final |
| Lineups missing from the request | Marks without labels, rows by position only ("WR, left"), drawing still works | Final |
| Reached by Enter twice after a skipped play | Two quick Enters from Home can snap the top pick. Space can't (decision 6). Today four Enters do the same through the menus. Watch in playtest; if it bites, the line's highlight starts on the first player row instead of Snap | Open |
| The engine rejects the snap | Stay at the line; status line "That call isn't allowed now."; one console warning | Final |
| Sim error | The existing sim error screen | Final |
| Window too narrow for the rail (the play screen's own rule) | The calling layout instead: the board is the field and the line's sheet takes the call sheet's place. Drawing works on the board at its scale | Final |
| One-column layout, no board | Snap and Back, and "Make the window wider to draw routes." | Final |
| Short window (1024x600) | Player rows drop to one line; the note moves to the status line for the highlighted row | Final |
| Long names | Rows grow to two or three lines; the sheet scrolls only past that | Final |
| Resumed save | A save never lands at the line. Resume opens Home | Final |

**Responsive, 1280x720 at 100%.** Field about 13.1 px per yard, column about 735 px, marks about 18 px, sheet 340 px, group width about 1099 of the 1232 available. Sheet height for five two-line player rows, my estimate: about 570 of the 624 px available.

**Needs from the sim.** For the chosen design on this snap: the players who can take a custom assignment, each with id, group (for defense: unit) and current assignment in words; for the others, optionally a reason ("lineman"). Units of at most five players each; a unit of six must be split by the catalog (for example ends and tackles on the goal line). The answer for a call must accept an optional custom route.

## Drawing

**Purpose.** Replace one player's assignment for this snap with a path you draw, see how the game read it, and see what it changes.

**Reads first.** The pen on the field, then the route's name on the field where it broke, then the sheet: the name again, then what it changes.

**Layout.** The line's stage. The sheet's content changes to the selected player.

```
+------------------------------------------------------------------------------+
| [ SCORE BUG ]                                                  Esc Players   |
|     +-----------------------------------+  +------------------------------+  |
|  20 |-                                  |  | Drawing for                  |  |
|     |          [Huddle] (faint)         |  | #81 D. OKAFOR                |  |
|  15 |-                                  |  | WR 88. Design: shallow cross |  |
|     |                                   |  |                              |  |
|  10 |-   +------------>  [Out, 8 yd]    |  | YOUR ROUTE                   |  |
|     |    |                              |  | OUT, 8 YD, TO THE SIDELINE   |  |
|   5 |-   |   (the design's paths, 40%)  |  | Could also be: corner.       |  |
|     |    |                              |  |                              |  |
|     |====|==============================|  | What it changes              |  |
|     |  ((1))   O O O O O O     O    O   |  | Tests: #81 D. Okafor, WR 88, |  |
|     |    88        QB                   |  |  alone outside.              |  |
|     |                O                  |  | Costs: no shallow cross, so  |  |
|     |                                   |  |  the mesh has one crosser.   |  |
|     |                                   |  |                              |  |
|     |                                   |  | [Space] Snap with this route |  |
|     |                                   |  | [Z] Undo                     |  |
|     |                                   |  | [X] Back to the design       |  |
|     |                                   |  | [N] Other reading            |  |
|     |                                   |  | [Esc] Players                |  |
|     +-----------------------------------+  +------------------------------+  |
+------------------------------------------------------------------------------+
```

**On the field.**

- The selected player: the player-card focus ring (2 px `color.line`, 6 px outside the mark, no glow), the existing component for "this player".
- The pen stroke while drawing (`draw.pen`, proposed): `color.line` 2 px over `color.outlineDark` 4 px, solid, round caps and joins. White, because it is the game's own graphic, not a player's path yet.
- The pen tag: a `color.tag` pill 12 px above and right of the pen, the `mark.label` type, giving depth from the line of scrimmage: "8 yd", or "3 yd behind".
- The depth ruler (`draw.depthRuler`, proposed): on the left boundary band, a `color.tag` pill every 5 yards from the line of scrimmage ("5", "10", "15", "20", and "5" behind it), in the `mark.label` type, each with a 1 px `color.line` tick cased in `outlineDark` running 2 yards into the field. It measures from the line of scrimmage, which the painted yard lines do not. It stops at the goal line and the top of the view.
- The snapped route: when the classifier answers, the stroke is replaced by the classified route in the standard path style for its kind (`path.offenseRoute` with its arrowhead, `path.block` with its tick, `path.defenseRoute` with its dot) at full strength, starting at the player's mark. A tag at the break names it: "Out, 8 yd". The stroke crossfades to the route over `dur.base`; reduced motion cuts.
- Everything else recedes while you draw: the design's other paths and the selected player's original assignment drop to the 40% preview strength, and the opponent's huddle marks drop to 40% with their "Huddle" tag kept. The custom route, the pen and the tags paint above every mark except the selected player's own. Why: the huddle sits 3 to 9 yards past the ball, exactly where short routes break, and it carries no fact.
- No new color. Custom is told by the tag and the sheet, and by being the one full-strength path.

**Drawing with a pointer (mouse, trackpad, pen, touch).**

- A stroke: press, move, release. The path always starts at the player. A stroke that starts on his mark starts the route over. A stroke that starts anywhere else continues from where the path ends, joined by a straight segment, so a route can be drawn in pieces and a finger never has to cover the mark.
- A click or tap without a drag adds a straight segment to that point. This is the non-drag way to draw (trackpads, switch users, WCAG 2.5.7), and it uses the same rule as a stroke.
- While the pointer hovers with a path started, a faint pen segment (40%) runs from the path's end to the pointer.
- Pointer events with capture; the field has `touch-action: none` while drawing so the page does not scroll or zoom. Only the first pointer draws. A cancelled pointer (a system gesture) discards the stroke in progress.
- The stroke is drawn on its own layer above the field canvas, so moving the pen does not repaint the field.

**Drawing with the keyboard.** The field takes focus. A crosshair pen (`draw.penCursor`, proposed: 12 px, `color.line` cased in `outlineDark`) starts on the player. Arrows move it 1 yard, Shift and an arrow 5 yards. Enter adds a point. Each point is read at once, like a stroke. The live region says where the pen is ("8 yards deep, 5 yards toward the right sideline") and each reading.

**Reading the path.** The classifier runs when a stroke ends or a point is added, never during a stroke. The sheet's "Your route" block gives the name in display caps (family, break depth, direction) and the field tag gives the short form. If the classifier returns more than one reading, the best is shown and the next is offered: "Could also be: corner." N swaps to it.

**What it changes.** Up to three lines in the Why sheet's language: Helps, Costs or Tests, then a sentence built from the sim's typed parts. Examples: "Costs: #34 T. Bell leaves protection. 5 blockers, was 6." "Tests: #81 D. Okafor, WR 88, alone outside." No odds. The engine's actual factors show after the play in the why line and Details, as for any play.

**One per play.** The sheet's label at the line says "Custom route, one per play". Selecting a second player while a custom route exists shows, before any stroke: "Drawing for #11 replaces #81's custom route." The first valid stroke moves it, and #81 goes back to the design.

**Defense.** The same screen. A drawn path is read as a rush across the line (a blitz, named by its gap and side), a drop to a spot (a zone, named by its area and depth), or a spy. The help line under "Drawing for" says how to draw each; its wording follows the classifier's rules and is the playbook spec's to confirm. My draft: "Draw across the line to rush. Draw to a spot and stop to drop there. A short path that stays over the ball spies the quarterback." The route style is `path.defenseRoute`, ending in its dot. The ruler measures from the line on both sides.

**Keys.**

| Input | Does |
|---|---|
| Space | Snaps with the route shown. With no custom route, snaps the design |
| Z | Undo: removes the last stroke or point |
| X | Back to the design: clears the custom route, keeps the player selected |
| N | Other reading. Off when there is one reading |
| Arrows, Shift and arrows, Enter | The keyboard pen |
| Tab | Moves focus from the field to the sheet's rows, which take the standard focus ring |
| Esc | Back to the players. A valid custom route is kept |
| M | Player card |

**States.**

| State | What shows | Status |
|---|---|---|
| Player selected, nothing drawn | "Your route" block: the help line. Snap reads "Snap" and snaps the design. Z, X and N off | Final |
| Stroke in progress | The pen, the pen tag, the ruler. The sheet does not change until release | Final |
| Read, one reading | Name, tag, "What it changes" | Final |
| Read, more than one reading | "Could also be: ..." and N on | Final |
| What it changes, not back yet | "Working out what this changes." in `type.note`. Snap works without waiting | Final |
| What it changes, nothing returned | "No read on what this changes." | Final |
| Path leaves the field | The stroke fades over `dur.base`, the route stays as it was, a tag marks where it left ("Out of bounds"), and the sheet says "That path leaves the field. Keep it between the sidelines." | Final |
| Path runs out the back of the end zone | "That path runs out the back of the end zone." | Final |
| Path too short | "Too short to read. Draw at least 2 yards." (threshold from the classifier) | Final |
| Path the classifier can't read | "Couldn't read that as a route. Try a stem and one break." The route stays as it was | Final |
| Not allowed for this player | Should be unreachable, since linemen and the quarterback are not selectable. If the classifier rejects one anyway: "#74 B. Smith is a lineman. Linemen can't run routes." | Final |
| Any other reason code | The code's text from a table; an unknown code: "That path isn't allowed on this play." | Final |
| Same as the design | "That is his job in the design already." No custom route is set | Final |
| Undo with nothing to undo, X with no custom route | The row is off | Final |
| Near the goal line | The ruler stops at the goal line; depth past the end line is out of bounds | Final |
| The engine rejects the route at the snap | Stay; "That route isn't allowed now. Snap again to run the design." The custom route is cleared | Final |
| Classifier slow | If no answer in 150 ms: "Reading your route." in the block, static. I ask for a synchronous classifier so this is unreachable | Open |
| Reduced motion | The crossfade and the fade are cuts | Final |
| Board fallback (narrow window) | The same rules at the board's scale; targets keep their 44 px | Final |
| Pointer lost, window blurred, resize mid-stroke | The stroke in progress is discarded; the route stays as it was; redraw at the new size | Final |

All errors are text in the sheet and the live region, with a tag on the field at the spot. None relies on color and none blocks: the next stroke clears it.

**Needs from the sim.**
- The classifier as a pure, synchronous function the app can call (no DOM, no RNG): from a player, his spot, the path in field yards and the game spot, to either ranked readings (family, break depth, direction, a label, and the canonical path to draw) or a rejection with a reason code. The worker checks it again at the snap.
- The reason codes: out of bounds, past the end line, too short, unreadable, ineligible, same as the design, and room for more.
- The tradeoff: for a design and one custom assignment, up to three factor rows (direction, strength, typed parts), using the recommender's factor shape.
- The answer carries the custom route: player id, family, break depth, direction.
- The engine's trace names the custom route's effect, so the why line and Details can state it after the play.
- A test that the opponent's call is the same for the same seed with and without a custom route.

## The play screen and after the whistle

- Rail, under "You: Shotgun, Mesh.": one more line in `type.note` `chalk` when there is a custom route: "Custom: #81 D. Okafor, out at 8."
- The custom route draws on behind its player like any path and stays after the whistle. Skip and reduced motion show it in full.
- Last play, calls line: "You: Shotgun, Mesh (his pick 1). Custom: #81 out at 8." The game log carries the same line. "(his pick 1)" is a fact about what you took, and lets a player judge the coordinator over a game without the UI ever calling a pick right or wrong.
- The why line and Details mention the custom route only when the engine's trace does.

## Model output: when the game is unsure, wrong or silent

**The picks.**
- Uncertainty: three confidence words, the coordinator's rating, "Likely" on matchups, "No read." on factors he did not read, the close-call lead, and the standing footer. No odds anywhere before the snap.
- Wrong: a pick that fails is not flagged, and nothing says the coordinator erred. The calls line records that you took it. The player's correction is to stop taking them, which costs no keys.
- No answer: "No picks for this snap.", fixed rows as ever.
- Every name, number and count in a reason comes from typed parts the UI checks against the rosters and the event log. A part that fails the check is left out of the sentence, never guessed, with one console warning (M2 design H2).

**The classifier.**
- Uncertainty: the second reading is offered in words. There is no confidence number.
- Wrong: the name and the redrawn route show at once what the game understood, before anything is committed. N takes the other reading, Z undoes, drawing from the mark starts over, X returns to the design.
- No answer: plain text saying what to try, and the previous route stays.
- The field shows the classified route, so what the player sees is what the engine will use.

**What it changes.** Advice from the same recommender, so the same rules: words, typed parts, "No read" when silent.

## Accessibility

- Every action has a key. Drawing has a keyboard pen and a click-to-place path, so nothing needs a drag (WCAG 2.5.7).
- Targets: marks 44 px, rows 48 px tall, cards far larger (WCAG 2.5.8).
- Nothing is timed (WCAG 2.2.1).
- Color is never the only signal: confidence is a word, direction is a word, custom is a tag, errors are sentences, picks are labeled "Pick 1", availability is "Sub" or "Hurt".
- Names: pick cards "1, Mesh, Shotgun, short pass, coordinator likes it"; player rows "1, number 81, D. Okafor, wide receiver, 88, shallow cross"; the field while drawing is a labeled application region ("Field. Drawing for number 81. Arrows move the pen, Enter adds a point.").
- Live region (polite): the reason line when the highlight changes pick; each reading; each error; "what it changes" when it arrives; the pen's place after each keyboard move.
- Focus: entering the line focuses Snap; selecting a player moves focus to the field; Esc returns it to his row; closing the Why sheet returns it to where it was.
- Card and board art stay `aria-hidden`; every fact in a diagram is in the label, the description or the rows.
- Text scales with the setting everywhere, including the pen tag, ruler and field tags. Reduced motion turns every transition here into a cut.
- No new hue, so the colorblind figures in DESIGN.md stand. The pen is white on turf (8.34 or better). Tags use the existing pill.

## Proposed DESIGN.md additions

For art-director. Nothing here edits DESIGN.md. No new color, radius, shadow, duration or type size.

1. **Layout, a fourth game state, "At the line"**: the play screen's stage with one sheet in the rail's place. Slot `calling.line`.
2. **`hud.reasonLine`**: `type.body` `chalk`, on the call sheet under the pick cards.
3. **`hud.confidence`**: three 6 px squares, `radius` 1 px, filled `chalkSoft` on `color.track`, beside a word that is always printed.
4. **`hud.factorRow`**: label in `type.label`, direction and strength in `type.note` 600 `chalk`, sentence in `type.note` `chalk`; "No read." rows in `chalkSoft`.
5. **`card.play` meta line**: `type.small`, tags as words, no chips. And the two missing path ends on cards: a dot for defense paths, none for a drop.
6. **`card.page`**: a tile with no diagram, key 6, "Next page", "Page 1 of 2".
7. **`draw.pen`**: `color.line` 2 px over `color.outlineDark` 4 px, solid, round. The one white freehand line on the field; it exists only while drawing.
8. **`draw.penCursor`**: 12 px crosshair, same colors. Not gold: gold on the field is the line to gain.
9. **`draw.depthRuler`**: `color.tag` pills at 5-yard steps from the line of scrimmage on the left boundary band, with 2-yard cased ticks.
10. **New on-field tags**, the existing pill: the pen's depth, the route's name at its break, "Custom", "Sub", "Hurt", "Out of bounds", and the player digits at the line.
11. **The selected player** at the line uses the player-card focus ring. One ring on the field at a time.
12. **Preview strength while drawing**: the custom route at full strength; the design's other paths, the replaced assignment and the opponent's huddle marks at 40%.
13. **Paint order while drawing**: the custom route, the pen and their tags above all marks except the selected player's.
14. **Motion, three entries**: the stroke crossfading to the classified route (`dur.base`); a rejected stroke fading out (`dur.base`); calling to the line and back, reusing the "Calling to play" growth (`dur.snap`). Each marks a change the player or the classifier made and has a cut for reduced motion.
15. **Home's fixed rows in two columns** when the call column is 520 px or wider.

## Amendments and sign-off

| Where | Was | Now | Needs |
|---|---|---|---|
| M2 design, decision 7 | No confirm step, the last key snaps | A picked call goes to the line; Space snaps; Q snaps the highlight at once | Joseph (Open question 1) |
| M2 design, decision 14 | No odds and no advice before the call | Advice, in words, from a named coordinator. Still no odds | Joseph asked for it |
| M2 design, decision 10; calling screen pass U5 | Same call snaps in one key; Earlier call on the offense's first screen | Same call goes to the line; Earlier call becomes the Recent screen, five slots, both sides | Joseph (U5 was his approval) |
| Calling screen pass, O4 | No recent call on defense | Recent on defense | Joseph |
| MENUS.md | Play type is the offense's first screen | Home is first; Play type is under Playbook, numbers 1 to 4 kept, 5 Recent added | With the catalog change |
| Calling spec, "Which screens use cards" | "A More card ... is not allowed as a way around the cap" | A page tile is allowed at the leaves only, and is counted | Lead |
| Calling spec, decision 3 | A card is a concept in a formation; no named plays | A card is a named design with its own assignments, so the name now changes what runs | With the catalog change |
| M2 design, mouse | "No drag. Touch is out of M2" | Drag and touch on the field while drawing | Lead |
| DESIGN.md, Layout | Three screens | A fourth state, the line (proposed additions) | art-director |
| Usability pass U6 | The huddle is always drawn at full strength | 40% while drawing only | art-director |
| Play log (`storage.ts`) | | New local counters, default 0: the path of each snap, quick snaps, stops at the line, custom routes, Esc from the line, `drawSeconds` | None, local only |

## Needs from the sim, in one list

Each screen's list above is the detail. In short, as changes to shared types they are ask-first for Joseph:

1. The catalog as designs with tags and per-player assignments, and request screens generated from its tree with at most six options each.
2. Picks, the coordinator, clock advice and factor lists on the call requests, with typed parts.
3. Drawable players and defense units per design.
4. A pure synchronous classifier with ranked readings, canonical paths and reason codes.
5. A tradeoff call for one custom assignment.
6. The answer carrying one optional custom route; the event carrying the design id, the pick rank taken and the custom route; the trace naming the route's effect.
7. Determinism and no-leak tests: same game with or without picks shown; the opponent's call unchanged by a custom route.

## Acceptance criteria

- F1. For every request generated over 200 simulated games, every screen in "How choices are counted" has at most 7 counted choices, and no generated playbook screen has more than 6 options.
- F2. From Home, Q with no other input submits pick 1's path; Space submits nothing on Home or any playbook screen; a held or repeated key never picks.
- F3. Every call picked by digit, Enter, click or tap lands at the line and submits nothing until Space, Enter on Snap or a click on Snap.
- F4. Keys 4, 5, T and Esc on Home do the same thing with zero, one, two or three picks.
- F5. With no picks, Home shows "No picks for this snap." and a full call can still be made by 4 and by 5.
- F6. Every player name, number, rating and count in a reason line, a factor row or a tradeoff line maps to a typed part that matches the rosters or the event log; a part that does not match is left out.
- F7. No screen before the snap shows a percentage, an expected yardage or the opponent's alignment. The no-leak tests of the calling spec (P1, P3) pass with the line's frames.
- F8. A design's card art, board art and field art come from one function and are equal as primitives; every design in the shipped catalog has art for all eleven players.
- F9. A design keeps its key path across 100 snaps of a game (only Recent and the picks reorder).
- F10. At the line, each eligible mark's target is at least 44 px across at 1280x720 and at the board's fallback scale, and no ineligible mark is a target.
- F11. A route can be drawn and snapped with the keyboard alone, with clicks alone (no drag), and with one touch pointer.
- F12. After a valid stroke the field's path equals the classifier's canonical path, and the snap's answer carries exactly that reading. After N it carries the other reading.
- F13. Each rejection reason shows its sentence, leaves the previous route unchanged, and sets no custom route in the answer.
- F14. Drawing for a second player leaves exactly one custom route in the answer.
- F15. Leaving the line clears the custom route and says so; a resumed save opens Home.
- F16. Home, the design page and the line do not scroll at 1280x720 and 100% text; at 200% nothing truncates.
- F17. With reduced motion, no transition in this file runs.
- F18. The rail and the last play's calls line name the custom route and the pick taken exactly when the event carries them.

## Not doing, and why

- Favorites, search, filters, sorting by situation: not asked for, and each moves key paths or adds choices.
- A play editor or saved custom plays: a custom route lasts one snap.
- More than one custom route per snap, custom routes for linemen or the quarterback, pre-snap motion, audibles after seeing the defense.
- Odds, expected yards or win probability before the snap.
- A coordinator track record, or a "what he thinks" view for any playbook design (Open questions 6 and 7).
- A switch to hide the picks (Open question 8). Settings is at seven rows.
- Any change to the play's motion, the score bug, the situation line or the dead-ball screens.
- Touch as a full way to play. Touch works for picking and drawing; the layout floor stays a landscape laptop.

## Open questions for Joseph

Each has my recommended default, which is what gets built if he says nothing.

1. **Stop at the line on every call?** Default: yes. Picking goes to the line, Space snaps, Q skips the line. It costs one key on every call that is not quick-snapped, and reverses M2's "the last key snaps". The alternative: picks snap at once as in M2, and a new R control arms a stop for the next pick; Same call then leaves Home to make room. The behavior is one flag, so it can flip after a playtest.
2. **One custom route per snap?** Default: one. Two or more later, once the engine's balance for one is proven.
3. **Defense: unit first, then player?** Default: yes, it holds the seven rule. The alternative is an exception that lets a click pick any of the eleven defenders directly.
4. **The field shows the classified route, not your exact stroke?** Default: yes, and the animation runs the classified route, so the picture never shows something the engine did not use. The playbook spec must agree.
5. **Favorites?** Default: no. Recent covers repeats, built from the game log at no cost.
6. **A coordinator track record ("you took 9 of his picks; 6 gained 4 or more")?** Default: not in the first build. It needs a definition of a good result that I should not invent.
7. **W on any playbook design, not only the three picks?** Default: not in the first build. It needs the recommender to score any design on demand, and it lets a patient player rank the whole playbook.
8. **A way to turn the picks off?** Default: no. They are three of seven choices and never in the way. If he wants it, it needs a home, because Settings is full.
9. **Design names: football names ("Mesh", "Stick") or plain words?** Default: football names of at most 22 characters, with a plain one-sentence description in the status line. DESIGN.md says plain words, so this is his call and the playbook spec's.
10. **Does Same call repeat a custom route?** Default: no. It repeats the design; the route is drawn again if wanted.
11. **Kicks, kneels and spikes also stop at the line?** Default: yes, one rule for every call ("Space snaps"), with Q for speed. The alternative snaps them on pick as today and saves a key on every extra point, at the cost of two behaviors for cards that sit side by side on fourth down.
