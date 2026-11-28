# M4: Franchise screens

Status: draft, revision 1, 2026-11-23. Owner: Joseph. Author: designer. Branch: m2/playable.

Companion to docs/specs/m4-franchise-core.md ("the core"), which owns the systems: the league, the pool, the draft rules, the AI, trades, the schedule, standings and playoffs. This file owns flows, screens, states and interaction. Each screen ends with a "Needs from the sim" list so the two specs can be reconciled. Where the two disagree on a number or a rule, the core wins and this file is corrected.

Final means decided here, change only with a reason. Open means waiting on Joseph, the lead, art-director, the core or a measurement in the build.

## Problem

Joseph, 2026-11-23: "franchise mode: there is a global draft to create teams. snake format. the ui should track your positions, their ratings, how many are still needed. the avg rating. other team's ratings if needed. use madden and other games as examples. allow trading. model everything off of the nfl with amount of games and playoffs".

What exists today, from the code: the main menu has Quick play, Continue, Settings, Controls (`titleScreen` in packages/app/src/ui/screens.ts). A game is one random matchup. There is a read-only roster screen by unit (`rosterScreen`), a player card overlay with rating bars (`card.panel`, `bar` in dom.ts), a face-off band, a box score and a line score. There is no league screen, no table denser than the roster, no draft, no trade and no season.

The hard part is the draft. If the roster is 53 players, the draft is 53 rounds and 1,696 picks, of which the user makes 53. The user has to answer the same question 53 times ("who do I take now?") without losing track of what the team still lacks, and without the screen turning into a spreadsheet.

Two things in this request pull work forward from later milestones in docs/ROADMAP.md: a read-only roster with depth (M5) and player-for-player trades (M6). The roadmap should be updated by the lead; this file does not edit it.

## User

No personas exist (docs/research/personas/ is missing). Same working assumption as the M2 specs: Joseph and players like him. Keyboard first, landscape laptop, knows football, has played management games in the genre.

Assumptions that carry decisions, each with its test:

1. **He drafts the early rounds by hand and wants to hand off the tail.** This is why Auto-pick shows its pick before you press it, why targets exist, and why "Auto-draft the rest" is two keys away at every pick. Test: the playtest log records the round of his first auto-pick, the round where he hands off (if he does) and the wall-clock time of the draft. If he hand-picks more than 30 rounds and says it dragged, the next step is a bigger batch tool, not a faster reveal.
2. **He chooses by overall first and by need second.** This is why the board opens sorted by overall across all positions, and need shows as a word on each row instead of as the sort. Test: count position-tab changes per pick in the playtest. If he filters on most picks, the board should open on his thinnest starting position.
3. **After a snake draft the 32 team averages sit close together.** A snake is built to even teams out. This is why every average carries a league rank and one decimal. This is an estimate, not a measurement. Test: the build logs the min, max and spread of team and unit averages for league seed 2026 after an all-AI draft, in the PR. If the spread of a number is over 5 points, drop its decimal.
4. **A wrong pick is rare and cheap enough that a confirm on every pick costs more than it saves.** 53 confirms to stop a handful of slips. This is why Enter drafts at once, with a guard only on unusual picks (Decision 6). Test: ask in the playtest whether he ever drafted the wrong player. If yes, see Open 3.

## Decisions

1. **Franchise screens are menu mode, in a wider frame.** They run while `game === null`, so the score bug and the field stay hidden, as the main menu spec decided. Why: there is no play to show. The draft room, trade and league screens need more width than the 1,040 px menu frame, so they use a dashboard frame (Proposed DESIGN.md additions, A1). Rejected: reusing the game layout with the field column empty, which the main menu spec already removed once. Final.

2. **One sheet per screen still holds.** In the draft room the board (the list you choose from) is the sheet. The roster tracker and the player detail sit on the stage as type, with no surface. Why: DESIGN.md principle 6, and the banned "stacks of same-weight rounded boxes". Three cards side by side would make the three regions equal, and they are not: one is the decision, two are reference. Rejected: a tiled dashboard of cards, the common pattern in the genre and in docs/research/2026-11-15-dribbble-ui-trends.md, because the design language spends surfaces on the one place you choose. Final.

3. **The draft has two beats, like the game's calling and play screens.** "Your pick": the board is live and the draft waits on you with no pick clock. "Picks in": the picks made since yours are revealed in the sheet, newest on top, and you watch or skip. Why: DESIGN.md principle 9 says nothing moves while you read a menu, so the pool must not reshuffle under the cursor. The game already teaches this rhythm (choose, watch or skip, choose). Rejected: one screen where AI picks roll while the board stays live, which needs pause, skip, filter, sort, target and compare all at once (over the seven) and moves rows while you read them. Rejected: a countdown pick clock. The draft is turn-based, so a clock that pressures nothing is a fake, the same reason DESIGN.md has no play clock. Final.

4. **The reveal is bounded and follows the existing Animation speed setting.** At 1x each pick in the gap shows for `draft.revealMs` (designed default 200 ms), and the whole beat never runs longer than `draft.revealMaxMs` (designed default 6000 ms): the per-pick time shrinks to fit. At 2x both halve. At Skip, or with reduced motion, there is no beat: you land on your next pick with the digest line. Both values live in data/ui/motion.json. Why: no new control on the screen, and a draft of 53 rounds is never slower than the player chose. Rejected: a separate draft-speed control (an eighth choice in the room). Final. The two defaults are Open for the playtest.

5. **Targets, not an ordered queue.** T marks or unmarks the highlighted player as a target. A target shows a filled diamond and the word "Target" in its row, the Targets tab lists only targets, the digest says which targets were taken, and Auto-pick takes your best available target that the roster can use before it looks at the rest of the pool. Why: it lets you decide once and act with one key later, which is what speed over 53 rounds needs. Rejected: an ordered queue with move up and move down. That is two more controls and a second ranking to maintain beside the sort, a layer that repeats the same decision. Final.

6. **Enter drafts at once. Only an unusual pick asks twice.** If the pick is at a position that is already at its target count, the first Enter writes the reason in the status line ("You have 3 of 3 quarterbacks. Enter again to draft a 4th.") and the second Enter drafts. A pick the core says is not legal (for example, the picks left are all needed for required positions) is off with its reason and cannot be drafted. A held key never drafts: `event.repeat` is ignored, so a back-to-back pick at the snake turn cannot be taken by a bounced key. Why: assumption 4. Final. Undo is Open 3.

7. **Need is words and shape, never a hue.** DESIGN.md gives every color one job: gold is the cursor, every other hue is a team, and there is no green or red to spend. So a filled roster slot is the player's overall as a number, an open slot is a hollow pip, an open starting slot is a heavier hollow pip, and each board row says "Starter", "Depth" or "Extra" in words. Final.

8. **Ranks, not grades.** The recap and every team summary show an average and its rank of 32 ("4th of 32"). Why: a rank is a fact computed from the ratings. A letter grade is a judgment nothing in the sim makes. Same rule as the team select spec: nothing here predicts a result. Rejected: letter grades, a projected record, a win probability. Final.

9. **The detail pane is the player card.** In the draft room the highlighted player's full ratings are always on screen, on the stage, in the card's layout. There is no "open card" step and no extra key. Elsewhere (roster, trade) Enter opens the existing `card.panel` overlay. Why: "key numbers up front, full detail one click away" is met with zero clicks where the decision is made 53 times. Final.

10. **Comparing teams is one overlay, the same component as the league's Teams view.** C opens it over the draft room. Final.

11. **New franchise over an existing one asks once.** Quick play replaces its save with a note and no confirm (usability pass U9). A franchise is hours of choices, so replacing it gets its own two-row screen. One franchise at a time in this slice (Open 6). Final.

12. **No team color in dense tables beyond the 12 px swatch, and the name is always beside it.** Eight color slots serve 32 teams (DESIGN.md, Still open), so in a league table color cannot identify a team. Names do. Team blocks (flat fill, inset ring) appear only where one or two teams are the subject: the draft bug's plate, the hub's face-off band, a roster header, the champion block. Final.

## Flow

```
Main menu
  3 Franchise
      no franchise ......... New franchise setup -> Pick your team (list) -> back to setup -> Start the draft
      franchise exists ..... Franchise entry: 1 Continue, 2 New franchise (asks once)
Draft room  <->  Picks in beat  ... 53 rounds ...  -> Draft recap -> Hub
Hub
  1 Play this game -> Pregame (existing face-off) -> the game (existing UI) -> Final -> Week results -> Hub
  2 Sim this week  -> Week results (fills in as games finish) -> Hub
  3 Roster         -> player card
  4 League         -> Standings | Schedule | Bracket | Teams -> a team's roster, a box score
  5 Trades         -> pick a partner -> Trade screen
  Esc Franchise menu (Settings, Controls, Save and exit)
Playoffs: same hub, the next game is the round. Title game -> Champion -> Hub (season complete).
```

Continue on the Franchise entry screen returns to wherever the franchise is: the draft room at the current pick, a game in progress, week results not yet dismissed, or the hub.

## Screen list and the choice count

House counting, as in screens.ts: every key-bound row counts, Esc counts, a scrollable list counts once, a control that cycles or a tab strip that sets one value counts once. Home, End, Page Up, Page Down and pointer shortcuts to a counted control do not count again. A decision changes the franchise save. Browse changes only what you are looking at.

| # | Screen | Choices | Of which decisions |
|---|---|---|---|
| F1 | Main menu (amended) | Quick play, Continue, Franchise, Settings, Controls (5) | n/a |
| F2 | Franchise entry | Continue, New franchise, Esc (3) | 2 |
| F3 | New franchise setup | Your team, Draft position, Seed, Start the draft, Esc (5) | 4 |
| F4 | Pick your team | The list, Esc (2) | 1 |
| F5 | Draft room, your pick | The board (Enter drafts), Target, Auto-pick, Position, Sort, Compare teams, Esc Draft menu (7) | 3: draft, target, auto-pick |
| F5b | Draft room, picks in | Skip to my pick, Pause, Esc Draft menu (3) | 1 |
| F5c | Draft menu | Resume, Auto-draft the rest, Draft log, Settings, Save and exit (5) | 1 |
| F5d | Compare teams (overlay) | The list, Sort, Enter Roster, Esc (4) | 0 |
| F6 | Draft recap | Start the season, Roster, League, Esc Franchise menu (4) | 1 |
| F7 | Hub | Play, Sim, Roster, League, Trades, Esc Franchise menu (6) | 3: play, sim, trades |
| F8 | League (four tabs) | Tab strip, View, the list (Enter opens), Week left and right on Schedule only, Esc (at most 5) | 0 |
| F9 | Roster | Unit, the list (Enter opens the card), Esc (3) | 0 |
| F10 | Trade | Partner, Your players, Their players, Propose, Unit, Esc (6) | 4 |
| F11 | Week results | Continue, the list (Enter opens a box score), Standings, Esc Franchise menu (4) | 1 |
| F12 | Champion | Continue, Bracket (2) | 0 |

If the lead counts each tab of a strip as its own choice, as the box score screen does, F8 is 4 tabs plus View, the list and Esc, which is 7, and F5's Position strip breaks the cap. See Open 2.

## F1. Main menu (amended)

Purpose: the front door gains one row. Question it answers: "what do I want to play?"

Rows: 1 Quick play, 2 Continue, 3 Franchise, 4 Settings, 5 Controls. Franchise goes third so the three play rows sit together and Settings and Controls keep their order.

- Franchise row note, `type.note`: with no franchise, none. With one, where it stands in words: "Herons, draft, round 12", "Herons, week 5, 3-1", "Herons, [round name]", "Herons, season complete".
- Continue stays the quick game's save. Its note already names the game (DESIGN.md, Continue row), so the two rows can't be confused.
- Opening highlight: the row of whichever save was written last, Continue or Franchise. Neither: Quick play. If the player moved the highlight before the save check resolved, it stays (MM8).
- States: checking for saves ("checking for a saved franchise", row stays on, since it can always start a new one, but the note waits); storage blocked (the row stays on, and F3 carries the warning).

Needs from the sim: none. From storage: whether a franchise save exists, its one-line status and its last-written time.

## F2. Franchise entry

Shown only when a franchise exists. Otherwise the Franchise row opens F3 directly: a screen with one live row is a wasted step.

```
FRANCHISE
+----------------------------------------------------------+
| [1] Continue        Cobalt Bay Herons, week 5, 3-1       |
| [2] New franchise   (replaces the Herons franchise)      |
| [Esc] Back                                               |
+----------------------------------------------------------+
League seed 2026.
```

- 2 New franchise opens a confirm screen: title "Replace the Herons franchise?", one body line with what is lost ("Week 5, 3-1. This can't be undone."), rows 1 Replace and start new, Esc Back. The highlight opens on Esc Back.
- States: damaged or older franchise save: the existing save error screen, with "1 New franchise" and "Esc Main menu". Loading the save: "Working..." after 300 ms (existing rule).

Needs from the sim: none. From storage: the status line and the league seed.

## F3. New franchise setup

Purpose: three facts, then the draft. Question: "who am I, and when do I pick?"

Reads first: the title, then the highlighted row and its note, then the preview line under the rows. The preview is the one place the snake is explained before it matters.

```
NEW FRANCHISE
+------------------------------------------------------------------------+
| [1] Your team        [sw] Cobalt Bay Herons, [conference], [division]  |
| [2] Draft position   Random                                            |
| [3] Seed             2026   (Enter draws a new one)                    |
| [4] Start the draft                                                    |
| [Esc] Back                                                             |
+------------------------------------------------------------------------+
Snake draft: 32 teams, 53 rounds. The order reverses every round.
With a random position you find out when the draft opens.
The seed sets the player pool, a random draft order and the schedule.
```

- 1 Your team opens F4 and returns here with the choice. It opens on the last team coached in a franchise, else the first team.
- 2 Draft position: Left and Right (or Enter to cycle) step through Random, 1, 2 ... 32. With a number chosen the preview reads "You pick 7th in round 1, 58th overall in round 2, 71st in round 3." (computed from the snake rule by the core, never by the UI).
- 3 Seed: shown always. Enter draws a new random seed. Typing a seed is Open 5.
- 4 Start the draft: builds the franchise and cuts to the draft room. "Building the player pool..." replaces the status line after 300 ms.
- Rounds and teams in the copy come from the core's numbers, never literals.
- States: storage blocked: a body line once, "This franchise can't be saved in this browser window. It lasts until you close the page.", and Start stays on. Build error: stay here, status line "Couldn't build the league. Try another seed.", logged with the seed.
- Decision vs browse: all four rows are decisions. Nothing is saved until Start.
- Responsive: rows-only screen, at most 640 px wide, as Settings.

Needs from the sim: the 32 team identities (place, nickname, conference, division, color slot); the snake pick numbers for a slot (`picksForSlot(slot)`, at least the first three); rounds and team count; `createFranchise({ leagueSeed, userTeam, draftSlot | "random" })`.

## F4. Pick your team

Purpose: choose an identity. Every roster is empty, so there is nothing to compare: this is a name, a color and a division. Question: "which team is mine?"

- One list of 32, grouped under eight `type.label` division headings inside one sheet, dense rows (A2): swatch, place and nickname. The right side of the stage shows the highlighted team as a flat team block (place in `type.row` 600, nickname in `type.faceoffName`, in the outline color) and under it its three division rivals as names.
- Up and Down move, a letter jumps to the next place starting with it, Enter picks and returns to F3, Esc returns without changing.
- States: long names never truncate here (the list column is as wide as the longest name at the current text scale). At 150% text and above the team block hides and the list takes the width.

Needs from the sim: the team identities with conference and division.

## F5. The draft room

Purpose: make 53 picks with the needs of the roster in view. Question, on every pick: "who is the best player I can use right now?"

### What you read first, and why

1. The draft bug, top left: the round, the pick, and your plate with "ON THE CLOCK". It is the state of the draft, and it sits where the score bug sits in a game.
2. The highlighted row on the board: the gold bar, the only gold on screen. It is the decision.
3. The detail pane to its right: that player's name and overall, then his bars. It answers "how good, at what".
4. The tracker to the left: your team average, then the position rows. It answers "do I need him". It is left of the board because need is read before a pick and the eye returns left after each one.
5. The digest and ticker lines under the bug: what changed since you last looked.
6. The legend.

### Layout at 1280x720, 100% text

```
+------------------------------------------------------------------------------------------------------+
| [ RD 3 | PICK 71 of 1,696 | HERONS  You   ON THE CLOCK | NEXT: PICK 122, RD 4 ]            Esc Menu  |
| Since your last pick: 12 picks. Targets taken: WR D. Hale (Comets).                                   |
| 70 Comets WR D. Hale 86 . 69 Loons OL R. Baptiste 85 . 68 Otters CB K. Vance 85 . 67 Smelters ...     |
|                                                                                                      |
| Your team             +--------------------------------------------------------+   Wide receiver     |
| HERONS                | [All] Targets QB RB WR TE OL DL LB CB S K P            |   JALEN SMITH       |
| 86.5  9th of 32       | Sorted by Overall                      1,625 available |   84  Overall       |
| Off 87.0 6th          |  #   Name               Pos OVR SPD STR AGI AWR  Use   |   4th of 212 WR left|
| Def 86.0 14th         | >1  <>J. Smith          WR   84  91  62  88  79 Starter|                     |
| ST  none yet          |  2   T. Reyes           CB   84  89  60  86  80 Starter|   Speed     ====== 91|
| 2 of 53 picks         |  3   M. Okafor          DL   83  70  90  74  78 Starter|   Strength  ===    62|
| Starters open: 22     |  4   A. Cole            RB   83  90  71  87  72 Depth  |   Agility   ====== 88|
| ----------------------|  ... 11 rows at this size                              |   Awareness =====  79|
| QB 1/3  88 o o     88 |                                                        |   Route run ====== 85|
| RB 1/4  85 o o o   85 |                                                        |   Hands     =====  81|
| WR 0/6  O O O|o o o   | Auto-pick would take CB T. Reyes, 84: best player      |   Release   =====  77|
| TE 0/3  O|o o         | at an open starting spot.                              |                     |
| OL 0/9  O O O O O|o.. +--------------------------------------------------------+   Would be your 1st |
| DL ...  (11 rows)                                                                  WR. Lines up in 4 |
|                                                                                    of 5 formations.  |
| Enter Draft   T Target   A Auto-pick   Left Right Position   S Sort   C Compare teams                 |
+------------------------------------------------------------------------------------------------------+
```

`o` is an open depth slot, `O` an open starting slot, `|` the line between starters and depth, `<>` the target diamond. Figures are placeholders.

Frame: the dashboard frame (A1), `min(1400px, 100vw - 48px)`. Three columns, gap 24: tracker 320 px, board the rest (584 px at 1280, never under 520), detail 280 px.

### Regions

**Draft bug (`draft.bug`, A6).** In the 64 px top band, built like the score bug: one fused 48 px unit, segments flush. Segments: round ("RD 3", `type.bugPeriod` label with the number in `type.bugDown`); pick ("PICK 71", "of 1,696" in bug small); the plate of the team on the clock in its flat fill with the inset ring, nickname in `type.bugName`, the "You" tag when it is yours, and "ON THE CLOCK" in bug small 600 in the outline color; your next pick after this one ("NEXT: PICK 122, RD 4", and "50 picks away" under it in bug small). When you are on the clock twice in a row the last segment reads "NEXT: PICK 72, you pick again". Esc Menu key hint at the right edge of the band. Not focusable. Its change is announced (Accessibility).

**Digest line.** On the stage, `type.note`, `chalk`. What happened since your last pick, in one sentence, built only from the pick log: "Since your last pick: 12 picks. Targets taken: WR D. Hale (Comets)." or "No targets taken." At your first pick: "The draft is open. You pick 7th." If more than three targets went: the first three and "and 2 more".

**Ticker (`draft.ticker`).** On the stage under the digest, one line, `type.small`: the most recent picks, newest at the left, each "70 Comets WR D. Hale 86" with the team's 12 px swatch before the nickname. It shows as many whole entries as fit and never cuts one. Your picks carry the "You" tag. Read only. The full history is the Draft log in the draft menu.

**Tracker (`draft.tracker`).** On the stage, no surface. Read only for the keyboard: it is a table, not a control. Top to bottom:

- `type.label` "Your team", then the nickname in `type.cardName`.
- Team average in display 44 with one decimal, then "9th of 32" in `type.note`. Labelled for screen readers and in the legend's help as the core defines it (Reconcile 3).
- Unit lines in `type.note`: "Off 87.0 6th", "Def 86.0 14th", "ST none yet" until a kicker or punter is drafted.
- "2 of 53 picks", then "Starters open: 22" (the count of open starting slots), which becomes "Starters open: OL 2, CB 1, K" in words once five or fewer positions have one.
- A hairline, then 11 position rows, 28 px each, in the fixed order QB RB WR TE OL, DL LB CB S, K P, with 8 px of space between the three units. Each row: the position (`type.small` 600); the count "1/3", filled of target (tabular); the slot strip; the position average (tabular, blank until one player is in).
- The slot strip (`roster.slotStrip`, A4): one cell per target slot, in depth order. A filled cell is the player's overall in Inter 600 13 px tabular. An open cell is a hollow pip. A thin divider follows the last starting slot. A player past the target count is drawn after the strip with a "+" before his number.
- The row of the position the board is filtered to carries `color.select` and weight 600, so the tracker and the tab strip always agree. No gold: the cursor is on the board.
- Pointer: clicking a position row sets the board's Position to it. This is a shortcut to the tab strip, not a new control.

**Board (`draft.board`).** The one sheet. `color.surface`, `radius.lg`, padding 20 px 16 px.

- Position tab strip (A3): All, Targets, then the 11 positions. One control with 13 values. Each tab shows a count only when it is useful: Targets shows its number ("Targets 4").
- Sort line: "Sorted by Overall" in `type.small`, and "1,625 available" at the right.
- The table (dense table, A2), 32 px rows, at least 10 visible at 1280x720. Columns: rank in the current sort; the target diamond; name (first initial and last name); Pos; OVR; rating columns; Use.
- Rating columns: with All or Targets, the four base ratings (SPD, STR, AGI, AWR). With a position tab, the Pos column drops and that position's skills come first (up to three, in the order of their weight in `overallWeights`), then the base ratings as far as the width allows, dropping from the right. The sorted column is never dropped. Every rating is always in the detail pane.
- Use column, in words: "Starter" (he would take an open starting slot), "Depth" (an open slot behind the starters), "Extra" (the position is at its target), or the core's reason when the pick is not legal ("Roster needs a K").
- The selected line follows DESIGN.md Rows, "A selected line in a table": `color.select` across the line, the 3 px gold bar, weight 600. The highlight slides between rows over `dur.base`.
- Status line at the bottom of the sheet, `type.note`: by default the Auto-pick preview, "Auto-pick would take CB T. Reyes, 84: best player at an open starting spot." It is replaced, until the next key, by a guard message (Decision 6), an off row's reason, or "You drafted WR J. Smith, 84, with pick 71."

**Detail pane (`draft.detail`).** On the stage, no surface, the player card's content without its overlay: the position in words in `type.label`; the name in `type.cardName`, wrapping to two lines before it shrinks; the overall in display 44 with "Overall" in `type.note`; his rank among the players left at his position; rating rows (`card.ratingBar`, value printed): four base ratings, a hairline, then his position skills; then the fit lines in `type.note` `chalk`: "Would be your 1st WR." and "Lines up in 4 of 5 formations." (from personnel.json, as the team select spec defines). For a target: "Target" with the diamond under the name.

**Legend (`hud.legend`).** On the stage at the bottom: Enter Draft, T Target, A Auto-pick, Left Right Position, S Sort, C Compare teams. Each is also a button for the pointer, 32 px tall at least.

### Your pick: keys and pointer

| Input | Does | Kind |
|---|---|---|
| Up, Down, Page Up, Page Down, Home, End | Move the highlight. The detail pane follows on the next frame | Browse |
| Enter, or double-click a row | Draft the highlighted player (Decision 6) | Decision |
| T | Mark or unmark the highlighted player as a target | Decision (saved) |
| A | Auto-pick: draft the player the status line names | Decision |
| Left, Right, or click a tab or a tracker row | Position: previous or next tab. The highlight goes to the first row | Browse |
| S, Shift+S, or click a column heading | Sort: next or previous. Overall, the visible skill columns, then the base ratings, highest first | Browse |
| C | Compare teams overlay (F5d) | Browse |
| Esc | Draft menu (F5c) | n/a |
| Hover a row | Moves the highlight, as in Rows | Browse |

A pick by need is Left or Right to the position, then Enter. One key takes the recommended pick: A. Two keys a round is the floor for a hand draft at 1x: Enter, then Space to skip the reveal.

After Enter or A: the row leaves the board, the tracker cell fills with his overall (the pip is replaced over `dur.base`), the averages update with no motion, the status line confirms, and the Picks in beat starts, unless you are on the clock again, in which case the bug's last segment says so and the board stays live. Position and Sort keep their values between picks. The highlight returns to the first row.

### F5b. Picks in

```
| [ RD 3 | PICK 84 of 1,696 | LOONS   ON THE CLOCK | YOUR PICK: 122, 38 away ]             Esc Menu  |
|                                                                                                    |
| Your team             +--------------------------------------------------------+                   |
| (tracker, unchanged)  | Picks since yours                             13 of 50 |                   |
|                       |  83  [sw] Sentinels    LB  O. Marsh            82      |   (last pick's    |
|                       |  82  [sw] Kingfishers  WR  D. Hale  <> Target  86      |    detail)        |
|                       |  81  [sw] Otters       QB  P. Lindqvist        85      |                   |
|                       |  ... newest on top                                     |                   |
|                       +--------------------------------------------------------+                   |
| Space Skip to my pick   P Pause                                                                    |
```

- The sheet's content switches from the pool to the feed in one frame. Each pick enters at the top and the rows below move down over `dur.base`. A pick of one of your targets carries the diamond and "Target". The bug's plate changes with each pick.
- Timing: Decision 4. The beat ends by itself at your next pick and cuts back to the board with the digest written.
- Space: skip to my pick. Every remaining pick is applied at once. P: pause and resume ("Paused" in the sheet's header, and the P hint reads Resume). Esc: the draft menu, which also pauses.
- The feed is read only. Nothing in it is a choice.
- No beat at Skip speed or with reduced motion.

Auto-draft running (after F5c, row 2) uses the same beat with the header "Auto-drafting your picks too". Your picks carry the "You" tag and fill the tracker as they land. Space reads "Stop at my next pick" and hands control back there. P pauses. At Skip speed or with reduced motion the rest of the draft is applied at once and the recap opens.

### F5c. Draft menu (Esc)

An overlay. Rows: 1 Resume, 2 Auto-draft the rest (note: "your 41 picks left are made for you"), 3 Draft log, 4 Settings, 5 Save and exit to main menu (note: "saved after every pick"). The league seed line shows under the rows, as in the pause menu.

- 2 opens one confirm screen: "Auto-draft your 41 remaining picks?", a body line "Targets are taken first when the roster can use them. Space stops it at your next pick." (the second sentence is left out at Skip speed and with reduced motion, where it reads "The draft will finish at once."), rows 1 Auto-draft, Esc Back.
- 3 Draft log: an overlay table of every pick so far, by round, newest round first: pick, team, position, player, overall. Rows: the list, 1 Show (All picks, My picks), Esc.

### F5d. Compare teams (overlay)

```
+--------------------------------------------------------------------------------------------+
| COMPARE TEAMS                                              Sorted by Team average          |
|  #  Team              Picks  Avg   Off   Def   ST   |        You: Herons    Comets          |
|  1  [sw] Loons          3   87.3  88.0  86.0   -    |  Avg   86.5  9th      87.0  4th       |
| >2  [sw] Comets         3   87.0  87.0  87.0   -    |  QB    1/3   88       0/3             |
|  3  ...                                             |  RB    1/4   85       1/4   87        |
|  9  [sw] Herons  You    2   86.5  87.0  86.0   -    |  WR    0/6            2/6   86.5      |
|  ... 32 rows, scrolls                               |  ... 11 positions                     |
| S Sort   Enter Roster   Esc Close                                                          |
+--------------------------------------------------------------------------------------------+
```

- `color.overlay`, `shadow.3`, width `min(1100px, 100vw - 96px)`. Left: all 32 teams in a dense table. Right: your team and the highlighted team side by side, one line per position: count of target and position average. The higher average in each line is weight 600 and screen readers hear "higher" or "level". No difference column, for the reason the team select spec gives: "+3" reads as a predicted margin.
- Your row carries the "You" tag. With your own row highlighted the right side shows your column alone.
- S cycles the sort: Team average, Offense, Defense, Special teams, Name. The highlight keeps its team. Enter opens that team's roster (F9) over the overlay; Esc there returns here.
- Mid-round, teams have different pick counts, so the Picks column is always shown, and averages of teams one pick apart are not strictly like for like. The header carries the note "Averages are of the players drafted so far." in `type.small`.

### States

| State | What the player sees |
|---|---|
| Building the pool | The frame with the bug's segments empty, "Building the player pool..." where the board goes, a progress bar with the value in words. Keys ignored |
| Not your pick yet at the open | The Picks in beat for the picks before yours, or at Skip speed the board with "The draft is open. 6 picks were made before yours." |
| Your first pick | Tracker all hollow, averages read "none yet", ticker shows the picks before yours or "No picks yet" |
| Board empty under a tab | "No quarterbacks left." in the table area. Targets tab with none: "No targets yet. Press T on a player to mark him." Enter and T do nothing and say so in the status line |
| Position at its target | Rows there read "Extra". Enter asks twice (Decision 6) |
| Pick not legal | The row is off as in Rows: `chalkSoft` label, the reason in the Use column, a dashed outline when highlighted. Enter repeats the reason |
| Picks left equal required slots left | Digest line adds "Every pick left must fill a need: K, P, OL 2." Rows that don't are off. Auto-pick obeys the same rule |
| Target taken by another team | He leaves the Targets tab. The digest names him |
| Auto-pick has no preview | Status line "Auto-pick isn't available." and A is off with the reason. Should never happen while a legal player exists; logged |
| Worker slow | "Working..." in the status line after 300 ms. The highlight still moves. Enter and A are ignored until the reply and the status line says "Still drafting J. Smith..." |
| Worker or draft error | The existing sim error screen, "Esc Franchise menu". The save holds the last committed pick, so Continue returns there |
| Save failed | Status line "Couldn't save this pick. The last saved point is pick 70." Drafting continues |
| Long names | In the table, first initial and last name. If still wider than the name column, it ends in an ellipsis: allowed only here, because the highlighted row's full name is always in the detail pane and in the row's accessible name. The pane, the ticker, the feed and the log never cut a name: the pane wraps, the others show fewer columns or entries |
| Roster full (your 53rd pick made) | Status "Your roster is full." The rest of the league's picks are applied (the beat, or at once), then the recap |
| Draft complete | Cut to F6 |
| Resume mid-draft | The draft room at the current pick, the digest computed from your last pick, targets as saved |

### Responsive

Fit steps, applied in order, stopping at the first that fits:

1. The detail pane shows only while the board is at least 520 px wide. When it hides, the highlighted player's position skills print in the status line's place when the Auto-pick preview is not needed ("Route running 85, Hands 81, Release 77"), and the base ratings are already in the row. This is the case at 1280 px wide with 125% text.
2. The tracker's header collapses to two lines (nickname with average and rank; units) when the 11 rows would not fit the column height.
3. Under 960 px of frame, or at 150% text and above: one column. The tracker becomes one needs line above the board in `type.note` ("Open: QB 2, RB 3, WR 6 ... Starters open: 22"), the ticker hides, the digest stays. The full tracker is the first thing in Compare teams, with your row highlighted on open.
4. Under 10 visible board rows at 100% text the ticker hides before the board loses another row.

At 1440x900 the board is about 700 px wide and shows 15 or more rows, and with a position tab all of that position's skills fit.

Nothing truncates at 200% text at 1280x720 except the table name rule above. The page never scrolls as a whole: only the board's rows scroll, inside the sheet, with the heading row fixed.

### Needs from the sim

1. Draft status: round, pick in round, overall pick, total picks, team on the clock, whether it is the user's, the user's next pick after this one (overall, round, picks away), user picks made and total, done.
2. The available pool: id, name, position, overall, the four base ratings, position skills. Count available. A stable order per sort (ties broken by the core) so rank numbers never flicker.
3. Per team: roster by position in depth order (id, name, overall); per position filled, target, starting-slot count and position average; unit averages and team average; league rank of each average. For the user's team after every pick, for all teams on request (Compare).
4. Per pool player for the user's team: the Use value (starter, depth, extra) and whether the pick is legal, with a reason code when not. Or the per-position rule that gives both.
5. The list of positions that must still be filled when picks left equal required slots left.
6. Auto-pick preview: the player Auto-pick would take now, given the saved targets, and a one-line reason built only from factors the pick used (the why-line rule).
7. Commands: draft(player), autoPick(), advanceToUserPick() returning the picks made in order, autoDraftRest() returning picks in order and stoppable at the user's next pick. Each commits and saves per pick.
8. The pick log: overall pick, round, team, player, position, overall. Query "since pick n".
9. Targets: a list of player ids in the franchise save, read by Auto-pick and auto-draft.
10. A player's rank among available players at his position (or enough to compute it).

## F6. Draft recap

Purpose: see what you built against the league before the season starts. Question: "where am I strong, where am I thin?"

Reads first: the title, then your team average and rank (the largest number), then the three unit rows, then the position table.

```
DRAFT COMPLETE
[ HERONS team block ]   78.4   Team average, 6th of 32

  Offense         80.1   4th of 32   =================
  Defense         76.0  11th of 32   ===============
  Special teams   71.0  20th of 32   ==============
+------------------------------------------------------------------------------------+
| Pos   Starters              Avg    Rank       Depth                                |
| QB    88                    88.0   3rd        74 70                                |
| WR    84 82 79 77           80.5   9th        72 70                                |
| OL    81 80 78 77 75 74     77.5   22nd       70 69 66                             |
| ... 11 rows                                                                        |
+------------------------------------------------------------------------------------+
Strongest: QB, 3rd of 32.   Thinnest: OL, 22nd of 32.
[1] Start the season   [2] Roster   [3] League   [Esc] Franchise menu
```

- The team block and the average sit on the stage. Unit rows reuse the tale of the tape's parts on one side only: value in display 28, rank in `type.note`, a `card.ratingBar` (never team color). The position table is the one sheet (dense table). Rank is of the starters' average at that position, as the core defines it.
- "Strongest" and "Thinnest" are the best and worst position ranks, stated as ranks, with ties broken by the fixed position order. No adjectives, no grade.
- 2 Roster opens F9. 3 League opens F8 on the Teams tab. 1 Start the season builds the schedule if the core hasn't and cuts to the hub.
- States: a draft finished by auto-draft adds one line, "38 of your picks were auto-drafted." Loading: "Working..." after 300 ms. Text 150% and above: the bars hide and the depth column wraps under the row.
- This screen stays reachable after the season starts as the Roster screen's content. It is not a separate archive.

Needs from the sim: the user's team and unit averages with ranks; per position starters and depth overalls, starters' average and its rank; how many user picks were auto-drafted; `startSeason()`.

## F7. Franchise hub

Purpose: the home of the season. Question: "what's next, and how am I doing?"

Reads first: the face-off band (who you play next, in team colors, the largest thing on screen), then your record in the header line, then the highlighted row, then the division table.

```
+--------------------------------------------------------------------------------------------+
| HERONS  3-1   2nd in the [division]                                       Week 5 of 18     |
| +----------------------------------------/-----------------------------------------------+ |
| | AWAY                                  /                                   HOME   You   | |
| | Red Mesa  2-2                        / (VS)                    Cobalt Bay  3-1         | |
| | COMETS                              /                                      HERONS      | |
| +----------------------------------/-----------------------------------------------------+ |
|                                                                                            |
| [1] Play this game                      +---- [division] -----------------------------+   |
| [2] Sim this week                       |    Team            W  L  T   PF   PA  Strk  |   |
| [3] Roster                              | 1  [sw] Loons      4  0  0  112   70  W4    |   |
| [4] League    Standings, schedule       | 2  [sw] Herons You 3  1  0   98   81  W2    |   |
| [5] Trades    Open until week 9         | 3  [sw] Otters     2  2  0   ...            |   |
| [Esc] Franchise menu                    | 4  [sw] Smelters   0  4  0   ...            |   |
|                                         +---------------------------------------------+   |
|                                         Last week: Herons 24, Otters 17.                   |
|                                         If the season ended today: 5th seed.               |
+--------------------------------------------------------------------------------------------+
```

- Header line on the stage: nickname and record in `type.screenTitle`, division place in `type.note`, the week at the right in `type.plateSpot`.
- The band is `pregame.faceoff` at 160 px with each team's record after the city. No tale of the tape here: it is on Pregame, one key away, after 1 Play.
- Rows on the stage. The division table is the one sheet (dense table). The two lines under it are words on the stage.
- 1 Play this game: Pregame as built, with rows 1 Start, 2 Your roster, 3 Their roster, Esc Back. "Coach the other team" and "New matchup" are not offered in a franchise. With a game in progress the row reads "Resume the game" with the mini-bug note.
- 2 Sim this week: sims your game and every other game, then opens F11. No confirm: it is the normal way to advance, the note says what it does ("your game is simmed too"), and the box score is there after.
- 5 Trades: the note carries the deadline in words. Off with a reason after the deadline, during the playoffs and when the season is complete.
- Choices: 6. Decisions: Play, Sim, Trades. Room is left for one more row before the cap.

States:

| State | What the player sees |
|---|---|
| Bye week | No band. A stage line in `type.result`: "Bye week." Row 1 is off: "no game this week". Row 2 reads "Sim the week" |
| Game in progress | Row 1 "Resume the game", note "Comets 7, Herons 10, 2nd 14:53". Row 2 is off: "finish or quit your game first" (Open 7) |
| Playoffs, you are in | The week reads the round's name. The band carries each seed before the city. The standings sheet becomes your conference's seeds |
| Playoffs, you are out | A stage line: "Your season is over. 9-8, 3rd in the [division]." Row 1 off: "your season is over". Row 2 "Sim the round" |
| You have a first-round bye | As Bye week, with "First-round bye." |
| Season complete | The band is replaced by the champion's block and "[title game name] champions". Rows 1, 2 and 5 are off with "the season is complete". Roster and League stay. A stage line: "More seasons come with a later update." (Open 9) |
| Loading | Header and rows at once; the band and table fill when the worker replies. "Working..." after 300 ms |
| Error | The sim error screen, "Esc Main menu". The save is untouched |
| Long names | The band shrinks the nickname to fit and never wraps (existing rule). The table shows nicknames only |

Responsive: under 900 px of content the band is 160 px and the table drops PF, PA and Strk. At 150% text and above: one column, rows first, then the table. The band stays.

Needs from the sim: phase (regular season week n of m, playoff round, complete); the user's record and division place; the next game (week or round, opponent, home or away, both records, seeds in the playoffs) or bye; the division's standing rows; last result; the seed the user would hold today or "outside the playoffs"; an in-progress game's summary; the trade deadline and whether trading is open, with a reason when not; `simWeek()`; `startUserGame()`.

## F8. League: standings, schedule, bracket, teams

Purpose: everything about the other 31 teams, read only. One screen with a tab strip (A3), keys 1 to 4. It opens on Standings in the regular season and on Bracket in the playoffs.

Shared: title "LEAGUE" in `type.screenTitle`, the tab strip under it, one sheet with a dense table (or the bracket on the stage), a status line, the legend. V cycles the tab's view. Enter opens the highlighted line. Esc returns to the hub. Your team's line always carries the "You" tag and weight 600.

### Standings (1)

Question: "where does everyone stand, and am I in?"

- V cycles Division (default), Conference, Playoff picture.
- Division: eight groups of four under `type.label` headings in one scrolling table, your division first. Columns: place, swatch and nickname, W, L, T, Pct, PF, PA, Div, Conf, Strk.
- Conference: two groups of 16 in order.
- Playoff picture: per conference, the seeds in order with what each holds in words ("1st seed, first-round bye", "5th seed"), a hairline labelled "Playoff line" in `type.label`, then the teams outside with games behind in words ("1 game back"). Clinched and eliminated are shown as the words "Clinched" and "Out" only if the core computes them. If it doesn't, the column is absent. Nothing is inferred by the UI.
- Enter opens that team's roster (F9).
- Before week 1: every record 0-0, order by the core's rule, and a status line "No games played yet."

### Schedule (2)

Question: "who do I play, and what happened around the league?"

- V cycles My team (default), By week.
- My team: one line per week: week, "at" or "vs", swatch and opponent, their record, then the result ("W 24-17", "L 13-20", "T 20-20") or "Bye", or blank when unplayed. The current week's line is where the highlight opens.
- By week: Left and Right change the week (the header reads "Week 5 of 18"). One line per game: away, score, home, score. The winner is weight 600. Unplayed: no scores.
- Enter on a played game opens its box score (existing box score sheet; tabs depend on what the core stores, see Needs). Enter on an unplayed game says "Not played yet." in the status line.

### Bracket (3)

Question: "what's the road to the title?"

```
[conference A]                               [title game name]                      [conference B]
Wild card        Divisional     Conf.                                Conf.     Divisional        Wild card
                 1 Loons  bye                                                  bye  1 Comets
2 Herons   24 -+                                                                             +- 13 Otters   2
7 Smelters 10 -+- Herons   17 -+                                             +-  ...        -+- 20 Cranes   7
3 ...          -+             -+- ...  --+        [ champion ]         +-- ...
6 ...          -+- ...                   +---  ...   vs   ...  --------+
4 ...          -+- ...        -+- ...  --+
5 ...          -+
```

- Drawn on the stage, no sheet (`league.bracket`, A5). One conference flows in from the left, the other from the right, the title game in the middle.
- If the core reseeds after a round, pairings that are not yet decided are not connected: the slot reads "Lowest seed left" or "Winner, [game]" in `type.note` `chalkSoft`, and connectors are drawn only once a pairing exists.
- Before the playoffs: the bracket is drawn from the seeds as they stand, under the heading "If the season ended today". No scores.
- Up, Down, Left, Right move between games. Enter opens a played game's box score.
- Under 1100 px of frame, or at 150% text and above: the bracket becomes a dense table, one group per round, the same data.

### Teams (4)

The Compare teams component (F5d) as a full screen, with records added after the draft: all 32 teams with record, team average, Offense, Defense, Special teams. On this tab V cycles the sort and its label reads "Sort". Enter opens the roster. This is the "league view".

States for all tabs: loading ("Working..." after 300 ms, the previous tab's content never lingers); error (the sim error screen); long names (nicknames in tables, the full name in the roster header).

Needs from the sim: standings rows with every listed column, ordered with tiebreaks applied; conference seeds; the playoff line; clinched and eliminated flags if they exist; the schedule by team and by week with byes and results; per game an id for the box score; the bracket (rounds with names, games with seeds, teams, scores and status, byes, the reseeding rule, the title game's name, the champion); the 32 team summaries with ranks.

## F9. Roster (yours and any team's)

Purpose: who is on the team, in depth order, with ratings. Read only in this slice. Question: "who plays, and how good are they?"

```
[ HERONS team block: Cobalt Bay HERONS  3-1 ]     78.4  Team average, 6th of 32
[Offense 80.1, 4th]  Defense 76.0, 11th   Special teams 71.0, 20th
+--------------------------------------------------------------------------------------+
| Pos  Depth    #   Name              OVR  SPD  STR  AGI  AWR   Skills                 |
| QB   Starter  12  M. Alvarez         88   70   64   72   90   Accuracy 91, Power 86  |
| QB   2nd      7   D. Pruitt          74   ...                                        |
| RB   Starter  ...                                                                    |
+--------------------------------------------------------------------------------------+
1 Unit   Enter Player card   Esc Back
```

- The existing `rosterScreen`, with a header (team block, average, the three units as a tab strip with average and rank on each tab) and the dense table. 1 or Left and Right change the unit.
- Depth reads "Starter" for the starting slots and "2nd", "3rd" behind them, from the core's depth order.
- Enter opens the existing player card overlay (`card.panel`), with Left and Right for the previous and next player.
- Reached from the hub (yours), from League, from Compare teams and from Pregame.
- States: before the draft ends, a team's roster shows what it has, and "Roster: 12 of 53" in the header. An empty unit: "No players in this unit yet." and Enter is off ("no players"). Long names: first initial and last name in the table, the full name on the card.
- Room left: the table's right side takes more columns later (age, contract, status) at 1440 px and up, and the header has space for a fourth tab.
- Responsive: under 1100 px the Skills column drops (it is on the card). At 150% text and above SPD, STR, AGI and AWR drop too, leaving Pos, Depth, Name, OVR.

Needs from the sim: a team's roster by unit and position in depth order with all ratings and jersey numbers; starting-slot counts per position; unit and team averages with ranks; the record.

## F10. Trade

Purpose: swap players with one AI team. Question: "is this deal good for me, and will they take it?"

Reads first: the answer line when there is one (it is the news), otherwise the offer (what you give and get, with the two values), then the highlighted roster line.

```
+------------------------------------------------------------------------------------------------+
| TRADE                                                  Trading closes after week 9             |
| With: [sw] Red Mesa Comets, 2-2                                                                |
|                                                                                                |
|  You give                         Trade value                     You get                      |
|  WR J. Smith  84            61  =========[  ]============  74      CB T. Reyes  88             |
|  RB A. Cole   77                 You get more value, by 13.                                    |
|                                                                                                |
|  After the trade, you:  WR 5/6, CB 6/5.  Offense 80.1 to 79.2.  Defense 76.0 to 77.4.          |
|  After the trade, they: WR 6/6, RB 5/4, CB 4/5.                                                |
| +---------------------------------------------+----------------------------------------------+ |
| | Your roster: Offense                        | Comets roster: Defense                       | |
| | > WR  Starter  J. Smith   84   In the offer |   CB  Starter  T. Reyes  88   In the offer   | |
| |   WR  Starter  L. Banks   82                |   CB  Starter  ...                           | |
| +---------------------------------------------+----------------------------------------------+ |
| Enter Add or remove   Tab Other side   U Unit   P Partner   Space Propose   Esc Back           |
+------------------------------------------------------------------------------------------------+
```

- One sheet holding the two rosters, divided by a hairline. Everything above it is words and a meter on the stage.
- Opening the screen with no partner opens the partner list first: an overlay with the Teams table (record, averages, and "Needs" in words if the core gives team needs). Enter picks. P reopens it. Changing partner clears their side of the offer and says so.
- Enter on a roster line adds the player to the offer or removes him. A line in the offer carries the words "In the offer" and weight 600. Tab, or Left and Right, moves between the two rosters. U changes the unit shown on the focused side.
- Trade value (`trade.valueMeter`, A7): each side's total as the AI rates it, printed in display 28, with two bars growing from the center on `color.track`, filled `chalkSoft`. Under it, in words: "You get more value, by 13.", "They get more value, by 6." or "Even." The heading reads "Trade value", and the legend's help line says "How the other team rates each side."
- Need impact, both teams, in words: only the positions the offer changes, as count of target, then the unit averages that move, before and after. A position that would fall under its starting slots adds "short a starter".
- Space Propose. Off, with the core's reason, while the offer is empty or not legal ("Add a player from each side.", "Rosters must stay at 53: trade the same number of players.", "Trading is closed."). A note beside it: "If they accept, the trade is made."
- The answer replaces the "After the trade" lines until the offer next changes:
  - Accepted: `type.result` "The Comets accept." then their reason in `type.body`. Both rosters update, the offer empties, the highlight returns to your roster. Polite live region reads both lines.
  - Rejected: `type.result` "The Comets say no." then the reason. The offer stays as built so you can change it and propose again.
- Choices: Partner, Your players, Their players, Propose, Unit, Esc (6). Decisions: 4. Rejected: a Clear row (an offer holds a few players, Enter removes each, and changing partner clears the far side); a "what would they accept" helper (it turns Propose into a formality and is a system nobody asked for).

States:

| State | What the player sees |
|---|---|
| Empty offer | "Add players from each roster." where the offer goes. No meter. Propose off |
| One side empty | The meter shows the one value. Propose off with the reason |
| Not legal | Propose off, the core's reason in the status line and beside the row |
| Waiting for the answer | "Waiting for the Comets..." after 300 ms. Keys ignored |
| Answer missing or error | "No answer came back. Nothing changed. Try again." The offer stays. Logged |
| Deadline passed while here | Propose off: "Trading is closed." The rosters stay browsable |
| Player in the offer no longer on the roster | Removed from the offer with a status line. Can't happen in this slice (one trade at a time); stated so the next slice inherits it |
| Long names | First initial and last name in the roster lines, full names in the offer |

Responsive: under 1100 px of frame, or at 150% text and above, one roster shows at a time (Tab switches), and the offer's two sides stack. The meter keeps both printed values.

Room left: the offer area has a third line per side for picks later, and the partner list can take a second partner. Neither is drawn now.

Needs from the sim: trade partners with record, averages and needs; both rosters; each player's trade value as the AI rates it; for a draft offer, `evaluate(offer)` giving each side's total, legal or not with a reason, and each team's changed position counts and unit averages; `propose(offer)` giving accepted or rejected and a one-line reason built only from factors the AI used; the deadline, and whether trading is open with a reason when not; any cap on players per side.

## F11. Week results

Purpose: what happened this week. Question: "did I win, and what did everyone else do?"

Reads first: your game (the band with the score, the largest numbers), then the list of other finals, then Continue.

```
WEEK 5 RESULTS                                                    Simulating: 9 of 16 games
+------------------------------------/---------------------------------------------+
| AWAY  Red Mesa COMETS   17        / FINAL         24   Cobalt Bay HERONS  You    |
+------------------------------------------------------------------------------------+
+------------------------------------------------------------------------------------+
| [sw] Loons        31    [sw] Otters        14     Final                            |
| [sw] Sentinels    20    [sw] Kingfishers   23     Final, OT                        |
| [sw] Smelters      -    [sw] Cranes         -     Simulating...                    |
| ... 16 lines, your game first                                                      |
+------------------------------------------------------------------------------------+
Space Continue   Enter Box score   2 Standings   Esc Franchise menu
```

- Your game: `menu.scoreHero` at 120 px (scores in display 72 instead of 96), with "FINAL" over the seam. On a bye: a stage line "Bye week." instead.
- The other games: the one sheet, dense table, one line per game: away swatch, nickname and score, home swatch, nickname and score, status. The winner's name and score are weight 600; a tie reads "Tie". Division games of yours are not marked: the standings tab does that job.
- While simulating: the header shows "Simulating: 9 of 16 games" with a progress bar (value in words). Lines fill in as each game finishes, in schedule order, with no motion beyond the text appearing. The list can be browsed and finished games opened while the rest run. Continue is off until all are final: "games still running".
- When you played your game: the existing Final screen comes first, with rows 1 Box score, 2 Continue (Rematch and New matchup are not offered in a franchise). Continue lands here, with the other games simulating.
- Enter opens the box score for the highlighted game. Your game is also the first line of the table, with the "You" tag, and the highlight opens there, so the keyboard has one list and one path. The band is read only; clicking it is a pointer shortcut to the same box score. Rejected: making the band itself selectable, which needs a cursor rule for team blocks that DESIGN.md does not have.
- 2 Standings opens League on the Standings tab; Esc there returns here.
- Space Continue returns to the hub with the week advanced. In the playoffs the title reads the round's name, and after the title game Continue opens F12.
- States: a game errors (the sim error screen, the week is not committed, the hub shows the same week again); storage full on save (status line, the results stay on screen); reduced motion (no change, nothing here animates).

F12 Champion: the stage, the champion's flat team block full width at 200 px with the nickname in `type.faceoffName` and "[title game name] CHAMPIONS" in `type.screenTitle` above it, the final score line under it in display 28, then rows 1 Continue (to the hub, season complete) and 2 Bracket. If it is your team the "You" tag sits on the block. The block wipes in as a moment banner does (`dur.wipe`, `ease.out`), once; static with reduced motion. No confetti, no particles (DESIGN.md Banned looks).

Needs from the sim: the week's games with status as each completes, scores, overtime flag; the user's game result; per game the stored record for the box score (at least the team box and the line score; player lines if the core keeps them for simmed games, else the box score shows the Team tab and Game log is absent, never empty tabs); progress count; `advanceWeek()`; the champion and the title game's name.

## Proposed DESIGN.md additions

Not applied. Each is for art-director to accept, change or reject. Nothing here adds a color, a font size, a radius or a shadow.

- **A1. Dashboard frame (`franchise.frame`).** Menu mode, content width `min(1400px, 100vw - 48px)`, for screens whose subject is a table: the draft room, League, Roster, Trade, Week results. A 64 px top band may hold one fused unit built like the score bug. Read-only columns may sit on the stage beside the one sheet, headed by a `type.label`, with no fill, border or shadow. Rule to add to principle 6: "On a dashboard screen the sheet is the table you act on; reference columns are type on the stage."
- **A2. Dense table (`table.dense`).** For any list longer than seven that is browsed, not a menu. Row height 32 px (28 px in a read-only stage column). Cells `type.note` (15 px), numbers tabular and right aligned, names left. Heading row `type.small` `chalkSoft`, fixed while the body scrolls, on the sheet's own color. No zebra, no cell borders; a 1 px `hairline` only between groups. The selected line is DESIGN.md's "selected line in a table". An off line follows Rows, Off. Group headings inside a table are `type.label`. The whole line is the pointer target. Row height does not scale below 32 px; it grows with the text scale.
- **A3. Tab strip (`hud.tabs`).** One control that sets one value. Tabs are `type.small` at 600, `chalk`, 28 px tall, padding 0 10 px, `radius.sm`, 4 px apart. The selected tab has the `color.select` fill and weight 700; the others no fill. No gold: gold stays the one cursor. Left and Right change it from anywhere on the screen unless the screen says otherwise. `role="tablist"`, one tab stop.
- **A4. Slot strip (`roster.slotStrip`).** One cell per roster slot at a position, 20 px wide. Filled: the overall, Inter 600 13 px tabular, `chalk`. Open depth slot: a hollow 10 px rounded square, 1 px `chalkSoft`. Open starting slot: the same with a 2 px `chalk` outline. A 1 px `hairlineStrong` divider, 16 px tall, after the last starting slot. The count is always printed beside the strip, so the strip never carries a number alone.
- **A5. Bracket (`league.bracket`).** On the stage. A game is two lines, 24 px each: seed (`type.small` `chalkSoft`), 12 px swatch, nickname (`type.note`), score (display 22, tabular). The winner's name and score are weight 600 `chalk`, the loser's `chalkSoft` (the tale of the tape's rule for the trailing side), and screen readers hear "won". Connectors are 1 px `hairlineStrong` with square corners, drawn only for decided pairings. The champion is a flat team block.
- **A6. Draft bug (`draft.bug`).** The score bug's construction (48 px, fused segments, `hairlineStrong` ring, `--bar-scale`) with the segments named in F5. Its fit steps when narrow, in order: hide "of 1,696"; hide "50 picks away"; team name at 16 px. Round, pick and the team on the clock are never dropped.
- **A7. Trade value meter (`trade.valueMeter`).** The tale of the tape's center-out bars on `color.track`, filled `chalkSoft` (not team fills: value is not a team), the two totals in display 28 at the ends, the difference in words under it.
- **A8. Target mark (`draft.target`).** A 10 px filled diamond in `chalk`, always with the word "Target" in the same row or line.
- **A9. Motion.** Add to data/ui/motion.json: `draft.revealMs` 200 and `draft.revealMaxMs` 6000 (designed). Add to Motion's list of what may animate: the feed's rows moving down by one over `dur.base` in the Picks in beat; a slot strip cell changing from pip to number over `dur.base`; the champion block's one wipe. All are instant with reduced motion.
- **A10. Menu mode list.** Layout says "Three screens". Add the franchise screens to the menu-mode list, and "Franchise" to the main menu rows.

## Accessibility (baseline)

- **Not color alone.** Need: a count, a pip's shape and weight, and the words Starter, Depth, Extra. Target: a diamond and the word. Winner, higher average, in the offer: weight and a word. Team: the name beside every swatch. Every screen must pass the grayscale check.
- **Focus order, draft room:** Position tab strip, Sort, the board (one tab stop, arrow keys inside, `aria-activedescendant`), then the legend's buttons in the order drawn, then Esc Menu. The tracker, ticker, digest and detail pane are not in the tab order: they are read-only tables and text with headings. In the Picks in beat: Skip, Pause, Esc Menu.
- **Focus order, trade:** Partner, your roster, their roster, Unit, Propose, Esc. Hub and every rows-only screen: the rows top to bottom.
- **Names.** A board row's accessible name carries the row: "Jalen Smith, wide receiver, overall 84, speed 91, strength 62, agility 88, awareness 79. Starter. Target." A tracker row: "Wide receiver, 0 of 6, 3 starting spots open." Positions are spoken in full.
- **Live region (polite).** Your turn: "Pick 71. You're on the clock. 12 picks since your last. Targets taken: D. Hale." After your pick: "You drafted Jalen Smith, wide receiver, 84." Sort and Position changes: "Wide receivers, sorted by speed, 212 available." The Picks in feed is not announced pick by pick; the digest covers it. Trade answers and week progress ("All 16 games are final.") are announced.
- **Targets.** Every pointer target is at least 24 by 24 px (WCAG 2.2 AA): table lines 32 px tall and full width, tabs 28 px tall and at least 28 wide, legend buttons 32 px, tracker rows 28 px.
- **Text.** The smallest text is 13 px, used for headings, the ticker and slot numbers; every sentence is 15 px or larger. All sizes scale with `--text-scale`; layouts at 125, 150 and 200% are given per screen.
- **Contrast.** Only token pairs DESIGN.md already checks: `chalk` and `chalkSoft` on stage, sheet and overlay; `chalk` on `color.select`; text on team blocks in the outline color with the inset ring. The 1 px `chalkSoft` pip outline on the stage is 8.61 or better. No new figure is introduced.
- **Timing.** Nothing times out. The draft waits on the player. The reveal is skippable, pausable and absent with reduced motion.
- **Keyboard and pointer** each complete every flow alone.

## Model output: uncertainty, wrong results, correction

Four things on these screens come from the AI or the sim.

| Output | Uncertainty | When it is wrong or missing | Correction |
|---|---|---|---|
| Auto-pick's choice | Shown before you commit, with its reason from the factors it used. It is a rule of thumb, labelled "Auto-pick would take", never "best pick" | No preview: A is off with a reason, hand picks still work | Don't press A. Pick by hand. Targets steer it. Auto-draft can be stopped at your next pick |
| AI draft picks | None shown as a judgment. They are facts once made | A pick that looks odd is explained by Compare teams (that team's needs) | Nothing to correct: they are the other teams' picks |
| Trade answer | You see both values before proposing, described as how the other team rates them, not as the truth | No answer: nothing changes, the offer stays, try again | A rejection keeps the offer for editing. An accepted trade is final and the note says so before you propose |
| Averages, ranks, seeds "if the season ended today" | Labelled with how each is made. Ranks beside close averages. No projection, grade, favourite or win probability anywhere | A team that ranks high and plays badly: the roster and cards show the ratings behind the number, the box score shows the game | The seed and the picks reproduce the franchise for a report |

## Reconcile with the core

1. Roster size and rounds (53 assumed), and so total picks (1,696 assumed). Copy uses the core's numbers.
2. Per position: target count, starting-slot count, and any required minimum. The tracker, the Use column and the guard all hang on these three numbers.
3. What "team average" and "unit average" are averages of (every player, or starters). The label follows the core. My recommendation is starters for the headline, because 30 depth players pull every team to the same number.
4. Whether pool order after the draft is depth order. The engine fills slots from the pool in order, so the roster's "Starter" must be the player the engine will play.
5. Whether the AI's trade rule is a pure function of the two values. If it is, repeated proposals are a probe; the core may want a limit, and the screen has room for "They won't hear another offer this week."
6. Whether simmed games keep player lines for the box score.
7. Whether playoff brackets reseed, the number of seeds and byes, the round names and the title game's name.
8. Where targets live (the franchise save) and that Auto-pick and auto-draft read them.
9. Whether a franchise game in progress saves inside the franchise save, separate from the quick game's save.
10. Bye weeks, and ties in the standings.

## Acceptance criteria

| # | Criterion | How it fails |
|---|---|---|
| FR1 | Every screen model in the "Screen list" table has at most 7 rows with unique keys, and at most 5 rows that change the franchise save. The cap test includes them all, in each state listed. | A screen over either cap. |
| FR2 | Main menu rows are Quick play, Continue, Franchise, Settings, Controls. The highlight opens on the row of the most recently written save. | Wrong rows or highlight. |
| FR3 | New franchise over an existing one always passes the confirm screen, which opens on Esc Back. | A franchise replaced in one key. |
| FR4 | At 1280x720 and 100% text the draft room shows, without the page scrolling: the bug with round, pick, team on the clock and the user's next pick; at least 10 board rows; the detail pane with every rating of the highlighted player; all 11 tracker rows with count, strip and average; the team and unit averages with ranks; the digest and at least 3 ticker entries. | Any of them clipped or missing. |
| FR5 | Every number in the tracker, board, detail pane, Compare, recap, hub, standings and trade equals the worker's value for it. No other number appears. | An invented or mismatched number. |
| FR6 | Enter drafts the highlighted player in one press when the Use is Starter or Depth; takes two presses with the reason shown when Extra; never drafts a not-legal row; never drafts on `event.repeat`. | Any difference. |
| FR7 | The status line's Auto-pick preview names the player A then drafts, for 200 seeded states. | A mismatch. |
| FR8 | T toggles a target; the Targets tab lists exactly the saved targets still available; the digest names targets taken since the user's last pick; targets survive save and resume. | Any difference. |
| FR9 | The Picks in beat lasts at most `draft.revealMaxMs` at 1x and half that at 2x; Space ends it within one frame; it does not run at Skip speed or with reduced motion; the pool table is never shown while it runs. | Over the limit, or the board moving under the cursor. |
| FR10 | Auto-draft the rest passes its confirm screen; while it runs, Space stops it at the user's next pick with the board live. | Can't be stopped, or no confirm. |
| FR11 | In grayscale screenshots of the draft room, trade and standings, a reviewer can name: which positions need a starter, which rows are targets, which side of a trade has more value, which team won. | Any carried by hue alone. |
| FR12 | Keyboard alone and pointer alone each go from the main menu through a full draft (with auto-draft), one played or simmed week, one proposed trade, and the bracket. | Either device needed. |
| FR13 | Propose is off with the core's reason for an empty or not-legal offer. A rejection leaves the offer unchanged. An acceptance updates both rosters on screen and in the save. | Any difference. |
| FR14 | Week results lines appear only as the worker reports each game; Continue is off until all are final. | A score shown early, or the week advanced with games running. |
| FR15 | No real team, league or trophy name appears; the title game's name comes from data. | A literal in the UI. |
| FR16 | The automated WCAG 2.2 AA check passes on every screen here; at 200% text at 1280x720 nothing truncates except table names under the stated rule; every pointer target is at least 24 by 24 px. | A failure. |
| FR17 | No color, size, radius, shadow or duration literal in the new code: tokens and data/ui/motion.json only. | A literal. |
| FR18 | Playtest: Joseph drafts a team. The log records draft time, the round of his first auto-pick, tab changes per pick, any wrong pick, and whether he could say what his team needed at round 10 without leaving the room. | Not run. |

## Art slots for docs/ASSETS.md ("Planned slots")

New: `franchise.frame`, `table.dense`, `hud.tabs`, `draft.bug`, `draft.ticker`, `draft.tracker`, `draft.board`, `draft.detail`, `draft.target`, `roster.slotStrip`, `league.bracket`, `trade.valueMeter`.

Reused, no change: `hud.playMenu` and its states, `hud.keyHint`, `hud.legend`, `hud.teamSwatch`, `hud.lineScore`, `card.panel`, `card.ratingBar`, `pregame.faceoff`, `menu.scoreHero`, `menu.frame`, `moment.banner` (the champion block's wipe only).

## Open questions for Joseph

Each has my recommended default, which is what the build does unless he says otherwise.

1. **Reveal pace.** After each of your picks, the other teams' picks play in for up to 6 seconds at 1x, and Space skips. Default: as written (200 ms a pick, 6 s at most, tied to the Animation speed setting). Tune after the first playtest.
2. **How tab strips count toward the seven.** I count a strip as one choice because it sets one value, like the Sort row. The box score counts each tab. Default: one choice. If each tab counts, the draft room's Position strip (13 values) has to become a cycling row with no visible tabs, which hides the list of positions.
3. **Undo a pick.** Not offered: once other teams have picked, undoing would let you see who is taken and then choose again. Default: no undo, the two-press guard on unusual picks, and the held-key rule. If the playtest shows wrong picks, add "Undo" that works only until the next pick by any team is applied, which means the Picks in beat would wait for one key after your pick.
4. **Team average: all 53 or starters.** Default: starters for the headline average and ranks, since depth players flatten every team to the same number. This is the core's call; the screens follow.
5. **Typing a seed.** Default: no. The seed is shown and Enter draws a new one. Typing needs a text field, the first in the game.
6. **One franchise at a time.** Default: yes, one slot, with the confirm before replacing. More slots mean a slot screen and a storage change.
7. **Sim your game when you quit it midway.** Default: no. Sim this week is off while your game is in progress; you resume it. Letting the sim finish a half-played game is a core feature nobody asked for.
8. **Sim more than one week.** Default: no, one week per press. A full season is 18 presses plus results. If that drags in the playtest, add "Sim to the end of the regular season" as a second option on the Sim row.
9. **After the champion.** Default: the franchise reads "season complete" and stays browsable. A second season needs aging, progression and a rookie draft, which are later milestones.
10. **Trades opened from a team's roster.** Default: no. Trades start from the hub. A "Trade with this team" row on another team's roster is cheap to add later and the roster screen has room.
11. **Ranks instead of letter grades on the recap.** You asked for "grades or ranks". Default: ranks, because nothing in the sim grades a team and a rank is a fact.
12. **Dense layout sign-off.** The draft room is the densest screen in the game: three columns, 15 px table text, 13 px slot numbers. Default: build it as specified and review screenshots at 1280x720 and 1440x900 with art-director before the rest of the franchise screens are built, since every other table reuses its rules.
