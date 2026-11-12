# M2: playable game, UI and flow design

Status: draft, revision 2, 2026-11-12. Owner: Joseph. Author: designer. Revision 2 applies Joseph's and the lead's answers (see "Resolved open questions (2026-11-12)" at the end).

Scope: screens, flow, controls, HUD, how the animation reads a PlayResult, states, accessibility. The engine and loop work this needs (players named per play, standout plays, per-player stats, challenges, jersey numbers, a step-wise loop) gets its own engine spec. This file only says what the UI needs from it ("Needs from the engine", below).

Final means: decided here, change only with a reason. Open means: waiting on the engine spec, a rule lookup, art-director or playtest.

## Problem

Today the game is a CLI text log. Nobody can coach it. M2 has to let one person coach one full game against the AI and want to keep going for an hour (the gate).

The core loop is: read the situation, call a play, watch it, understand why it went that way, adjust. The biggest risk to "fun" is not looks. It is a result that feels random because the player cannot connect their call to what happened. So every screen decision below favors three things: the situation is readable before the call, the result is readable after it, and the reason is one key away.

## User

There are no personas in docs/research/personas/ (the folder does not exist). Working assumption: the M2 player is Joseph and people like him. They know football well enough to have opinions about 4th down, they don't need "Cover 2" explained but are glad of the one-line description, they play in a landscape laptop browser window with a keyboard, and they play a full game in one sitting.

Assumption that carries decisions: the player wants speed of calling over guidance. It drives the no-confirm design and "Same call". Test: in the first playtest, count misfires (calls the player says they didn't mean), Esc back-outs and Same call use. If misfires are more than rare, add a confirm setting, not a default confirm.

## How the gate is tested

"Fun for an hour against the AI" is judged by Joseph in a playtest, not by a metric. To support the judgment the build logs locally (never sent anywhere): games started and finished, time per dead ball, details-panel opens, challenges thrown, Same call use, Esc back-outs. Targets for those are not set here. I have no data to set them from.

Estimate, to be checked in playtest: a full game is about 150 dead balls that need the player. At 6 to 15 seconds each (calling, animation, reading) that is roughly 15 to 40 minutes. So one hour is one to two full games.

## Decisions

Each one: what, why, and what I chose not to do.

1. **Field on canvas, everything with text in the DOM.** Menus, HUD, result and why lines, box score and player cards are HTML over the canvas. Why: screen readers, browser text scaling, real focus order and selectable text come free. Rejected: an all-canvas UI, which gives one render path but loses all of that. Final.
2. **Turn-based clock. Nothing is timed while you decide.** The game clock moves only by the sim (run-off before the snap, play seconds). Why: the game is about decisions, and a real-time play clock punishes reading the menus and fails WCAG 2.2.1 (timing). Rejected: a ticking play clock. The run-off is shown instead, as the game clock counting down in the pre-snap beat. Final for M2.
3. **Tempo is a player choice.** On offense, the Clock menu sets the tempo for the drive: Hurry-up, Normal, Run the clock. It resets to Normal at each new drive. Why: without it the player can't run a two-minute drill or bleed a lead except with timeouts and kneels. Resetting each drive stops a forgotten Hurry-up from costing a game. Rejected: a tempo key on the first screen (it breaks the 7-choice cap). The run-off each mode draws belongs to the loop spec. Final (lead).
4. **Portrait field: it runs up and down the screen, and the team with the ball always attacks up.** The view flips at the first dead ball after a change of possession. Why: Joseph's choice. It reads like a coach's clipboard, every play reads the same way, and "left" in the engine's data is the offense's left on screen. Rejected: a side-to-side field, which suits a wide window better but isn't the clipboard. Final (Joseph).
5. **Layout: a tall field column on the left, the panel on the right, the scoreboard across the top.** The panel holds the situation, the last result, the why line and the menu. Why: on a landscape laptop, a portrait field leaves a wide strip beside it, and the menus and text go there instead of under the field. Field left, panel right: the field is the thing looked at most over a game, and the panel is read top to bottom in a fixed order. Rejected: field centered with HUD panels on both sides, which splits the reading order and moves the eye across the field to reach the menu. Final; exact sizes are in "Layout".
6. **Formation before play**, in the brief's order: Play type, then Formation, then the play. Why: it matches how a call is spoken and is what the brief and MENUS.md say. Either order costs the same keystrokes. Rejected: play first. Final unless Joseph says otherwise.
7. **No confirm step. The last key snaps.** Esc or Backspace goes back one menu before that. Why: a confirm costs a keystroke on about 150 calls a game. Rejected: confirm by default. Final.
8. **Keys pressed during the animation are not buffered.** Only Space (skip) and S (speed) work then. Why: a turnover can flip you from offense to defense, and a typed-ahead call would land on the wrong menu. Final.
9. **Off choices stay on screen, dimmed, with the reason.** Example: "3 Kick (4th down or last 2:00 only)". Pressing one does nothing and repeats the reason in the status line. Why: the numbers never shift (MENUS.md), so muscle memory holds, and the reason teaches the rule. Rejected: hiding them. This settles MENUS.md's "hidden or greyed out" question. Final.
10. **"Same call", one key, on the first screen of each side.** Shown as a row with the call spelled out: "5 Same call: Shotgun, Short pass" or "5 Same call: Nickel Cover 3". It repeats this side's last call in this game and snaps at once. It is off, with a reason, when there is no earlier call or the last call isn't legal now (a field goal on 1st down, a Clock call on a try). It doesn't change the tempo. Why: the lead's call, and it makes an established tendency one keystroke. Rejected: Enter as a hidden repeat, which is easy to trigger by accident and invisible to new players. Final (lead).
11. **Timeout is offered only on the first screen of a call.** Why: deeper screens (Nickel has 6 plays plus Back) would go over 7. Call your timeout, then your play. Final.
12. **After the snap, both calls are shown.** Example: "You: Shotgun, Short pass. They: Nickel Cover 1 Blitz." Why: the matchup table is the heart of the sim, and the player can only learn it by seeing what they ran into. The opponent's call is never shown before the snap. Final.
13. **The why line is a plain-words headline. The multipliers, probabilities, cell and rating edges are in the details view, one key (D) away.** Why: the roadmap's depth target, with full detail one click behind the headline. Today's templates put "x1.34" in the sentence, so the engine spec must add a headline variant (Needs, item 7). Final (lead).
14. **No odds and no advice before the call.** Hints and win probability are M3. After the play, the details view shows the probabilities the engine used for that play, because that explains the result rather than predicting the next one. Final for M2.
15. **Full 15:00 quarters only.** Why: the clock, tempo, timeout and late-game caller tables are fitted to 15-minute quarters, and a full game fits the hour. Rejected: a quarter-length setting. Final for M2.
16. **Autosave after every dead ball (IndexedDB).** "Continue" on the title screen resumes where you were. Final.
17. **Dead balls with no call for you still wait for Space** ("They line up to punt"). Why: you may want a timeout there, and nothing should happen without you. Rejected: auto-advance, which would need a timed window. Final.
18. **Jersey numbers on players, marks, cards and the result line.** Why: the lead's call, and the depth target. A number links a mark on the field to a name in the text and the box score. Labels on marks follow the setting in "Players". Final (lead).
19. **The challenge flag appears only on close calls the engine marks, and the computer coach challenges too.** Why: Joseph's choice. A challenge on a blind guess is not a decision, and the AI having the same tool keeps it fair. Final (Joseph). The rules are not written here (see "Challenges").

**What counts as a choice for the 7 cap.** A choice is an action that changes the game or moves to another screen, including Back, Timeout and Same call. A table you scroll through (roster, box score rows) counts as one choice: open the selected row (resolved, lead). An accelerator key for a choice that lives on another screen doesn't count again. D is the only one: it opens "Last play details" from the pause menu, and the call screens show it as a non-button hint after the why line. If the lead reads that hint as an eighth choice, the hint goes and D is listed only in the pause menu and Controls.

## Layout

Target window: 1280x720 CSS pixels (a typical laptop browser window). Minimum: 1024x600. Below the minimum the game shows "Make the window larger to play" and pauses (state table).

- **Top bar**, full width, 48 px, `color.panel`: the scoreboard (HUD below).
- **Field column**, left. Width = the smaller of 50% of the window width and 0.95 x the column height, so the field keeps roughly the same shape on any screen. Scale s = column width / 55.3 yards (53.3 yards sideline to sideline plus 1 yard of margin each side).

  | Window | Column | s (px per yard) | Length visible |
  |---|---|---|---|
  | 1024x600 | 512 px | 9.3 | about 59 yd |
  | 1280x720 | 638 px | 11.5 | about 58 yd |
  | 1440x900 | 720 px | 13.0 | about 65 yd |
  | 1920x1080 | 980 px | 17.7 | about 58 yd |

- **Panel**, right, the rest of the width; content at most 560 px wide so lines stay readable. Top to bottom, in reading order:
  1. Situation header: down and distance in mono, the largest text on screen ("3rd & 4 at OPP 38"), with "You're on offense" or "You're on defense" under it.
  2. Result line, calls line and event lines from the last play (HUD).
  3. Why line, then the hint "D: details".
  4. The menu (rows prefixed with their key, "1 Inside run").
  5. Status line: the reasons for off choices, "Working...", save warnings.

  Why this order: while calling, the player needs the situation first, then what just happened, then the options. After a play the eye moves from the field to the result line, which sits high in the panel.

**Marks and lineman spacing.** DESIGN.md's mark size (one-third of a 5-yard gap, about 1.7 yards) is too wide for the interior line in this layout. Proposal, for art-director:

- Mark diameter 1.4 yards, never under 14 px (16 px at 1280x720, the 14 px floor at 1024x600).
- The interior line (the five offensive linemen and the defensive linemen over them) is drawn at diagram spacing: 2 yards between centers, which leaves at least 4 px between marks at the minimum window. Everyone else is drawn at the template's true lateral position in yards.
- Depth (up and down) is always true yards. Only the interior line's sideways spacing is diagrammatic.
- An engine run gap maps to the space between the matching line marks, not to a yard position.

## Screen flow

```
Title -> Pregame -> Coin toss -> Kickoff -> [ Dead ball loop ] -> Halftime -> Kickoff -> [ loop ] -> (Overtime toss -> loop) -> End of game -> Box score
Dead ball loop:
  result shown -> (review: challenge by you, by the AI, or as the rules require) -> (penalty choice) -> (ten-second run-off prompt)
  -> next input: try choice | kickoff choice | offense call | defense call | "They line up..." (Space)
  -> snap -> animation -> result shown
```

Order after a play: review first, then the penalty choice. Why: the player should know the ruled play before deciding to accept yardage against it. Whether the rules and the machine allow that order is for the rule lookup and the engine spec. Open.

Each screen: what the eye reads first, the choices (with count), and the keys.

| Screen | Reads first, and why | Choices (count) |
|---|---|---|
| Title | Game name, then Continue if a save exists, because returning players are the common case | 1 New game, 2 Continue (off if no save), 3 Settings (3) |
| Pregame | The matchup, "You: [swatch] [Team] (home) vs [swatch] [Team]", then each team's unit bars (Offense, Defense, Special teams, averages of player ratings) so the player knows if they're the underdog | 1 Start, 2 Coach the other team, 3 New matchup, 4 Your roster, 5 Their roster, Esc Back (6) |
| Roster | Unit tabs, then a scrollable table: number, name, position, four base bars. Enter opens the card | Unit tab, the table (one choice), Esc (3) |
| Coin toss | Who won, in one sentence. If you won: | 1 Receive, 2 Defer (2). If the AI won: "They defer. You receive." Space (1) |
| Kickoff, you kick | Score and time, which decide onside | 1 Kickoff, 2 Onside kick, T Timeout, Esc Menu (4) |
| Kickoff, they kick | "They kick off." If declared: "They declare an onside kick." (2026 rule 6-1-6, RULES.md: onside is declared) | Space, T, Esc (3) |
| Offense: Play type | Down and distance, then the clock, then the menu | 1 Run, 2 Pass, 3 Kick, 4 Clock, 5 Same call, T, Esc (7) |
| Formation | The play type you chose, as a breadcrumb | 1 Shotgun ... 5 Heavy, Esc Back (6) |
| Run / Pass | Breadcrumb "Pass, Shotgun" | Run 1-3 or Pass 1-5, Esc (4 or 6) |
| Kick | Field goal distance as a fact: "2 Field goal (47 yd)". No make chance (M3) | 1 Punt, 2 Field goal, Esc (3) |
| Clock | Clock state "running" or "stopped", then the current tempo | 1 Spike, 2 Kneel, 3 Hurry-up, 4 Normal, 5 Run the clock, Esc (6). 3 to 5 set the tempo and return to Play type |
| Try (your TD) | Score after the TD, because that's what decides one or two | 1 Kick extra point, 2 Go for two, T, Esc (4). Two goes to Play type with only Run, Pass and Same call (if the last call was a run or pass) on |
| Defense: Package | Down and distance; "You're on defense" | 1 Base, 2 Nickel, 3 Dime, 4 Specials, 5 Same call, T, Esc (7) |
| Defense plays | Breadcrumb | Base 3, Nickel 6, Dime 2, Specials 2, plus Esc (at most 7) |
| They kick or kneel | "They line up to punt" (or field goal, extra point, kneel, spike). No defense call, because the engine ignores it there | Space, T, Esc (3) |
| Penalty choice (you were fouled) | The foul in words, then each option with the state it leaves: "1 Accept: 1st & 10 at OPP 33", "2 Decline: 3rd & 2 at OPP 48". No recommended option (M3) | One row per acceptable foul plus Decline (at most 3), Esc (at most 4) |
| Challenge prompt (you) | What is in doubt: "Close call: was he down before the ball came out?" Then what you risk, in words taken from the rule set data | 1 Throw the flag, 2 Let it stand, Esc (3) |
| Under review | "Under review: [the question]", and who asked for it (you, them, or the review the rules call for). Held about 1 s at 1x; Space skips | Space (1) |
| Review result | "Ruling stands" or "Ruling reversed", the new result line, and what it cost (a timeout, a challenge) | Space (1) |
| Ten-second run-off (your offense) | "Ten-second run-off: 0:09 left becomes 0:00." | 1 Take the run-off, 2 Use a timeout (n left), Esc (3) |
| Overtime toss | As the coin toss. The options are whatever the 2026 rule set offers | at most 3, plus Esc |
| Halftime | Score, three headline team stats (total yards, turnovers, 3rd down), top three players, who receives | 1 Continue, 2 Box score, Esc (3) |
| End of game | Final score and result, top performers and standout plays | 1 Box score, 2 Rematch, 3 New matchup, Esc Title (4) |
| Box score | Score by quarter always on top, then the tab | 1 Team, 2 Offense players, 3 Defense players, 4 Kicking, 5 Drives (with play-by-play), Esc (6) |
| Player card | Number, name, position, then bars | Left and right for previous or next player, 1 Rating detail, Esc (4) |
| Rating detail | Each rating's league-wide rank at the position | Esc (1) |
| Last play details | The why headline again, then the trace in plain labels, with multipliers and probabilities | 1 Copy details, Esc (2) |
| Pause menu (Esc on a first screen) | | 1 Resume, 2 Last play details (D), 3 Box score, 4 Animation speed, 5 Settings, 6 Controls, 7 Quit to title (save kept) (7) |
| Settings | | 1 Text size, 2 Reduced motion, 3 Mark labels, Esc (4) |

Events with no choice show as a line in the panel and need no key: timeouts by either team, the two-minute warning, end of quarter, the untimed down, the run-off before the snap, and "They throw the challenge flag". The untimed down is always taken and the clock-on-snap option is never asked. Both keep the step 3 designed defaults, because neither is a decision a player would want to make.

## Controls

| Key | Does |
|---|---|
| 1-7 | Pick the numbered row |
| Esc, Backspace | Back one menu; on a first screen, open the pause menu |
| T | Timeout (first screen only; dimmed with "No timeouts left" when none) |
| D | Last play details (accelerator for the pause menu item) |
| Space, Enter | Continue on a one-action screen; during animation, skip to the end |
| S | Cycle animation speed 1x, 2x, skip (during animation) |
| Arrows | Move the highlight; Enter picks it. Left and right page player cards |

Mouse: every row and key hint is a button. Hover highlights the row (`color.paperShade`), click picks it. After the play, click a mark, or a name in the result line, to open that player's card. No right-click, no drag. Touch and gamepad are out of M2.

Speed: Same call takes 1 key. Otherwise a run or pass takes 3 keys, and a kick, defense call or kneel 2. Requirements: the next menu draws on the next frame after a key, and the snap starts within 100 ms of the last key. With that, an experienced player calls a new run or pass in under 2 seconds, and a repeated one at once. The 2-second figure is a design target, to be measured in playtest.

## HUD

Top bar (`color.panel`), left to right, in reading order:

- Away team: swatch, abbreviation, score, timeout pips, challenge pips. Then home, the same.
  - The team color appears only as a small square swatch beside the name, never alone and never on the field (Joseph). It also appears in the box score headers and the pregame matchup.
  - Possession is a `color.signal` dot plus the word "ball", never only color.
- Quarter, game clock, and the clock state in words: "running" or "stopped". Under 2:00 the clock is `color.signal`.
- Tempo, when it isn't Normal: "Hurry-up" or "Run the clock".
- No play clock (decision 2).

Panel text, in reading order (panel items 1 to 3 in "Layout"):

1. **Situation header** (above).
2. **Result line**, larger: what happened, with numbers and names: "#12 J. Pratt to #81 D. Okafor for 7. 2nd & 3 at OPP 41." It is read first after a play, because it is what changed.
3. **Calls line**, small, `color.inkSoft`: "You: Shotgun, Short pass. They: Nickel Cover 1 Blitz."
4. **Event lines**, if any: "Timeout, Harbor City (2 left)." "Clock ran 31 s before the snap."
5. **Why line**: the engine's plain headline (decision 13), then the hint "D: details". It is read last of the play text because it explains the line above it.

All of it stays until the next snap. Nothing on the field column is ever covered by the HUD.

## Field and animation

### Coordinates

The field frame is the PlayResult frame, so there is no conversion per possession:

- y is yards from the goal line of the team that snapped or kicked: 0 is its own goal line, 100 the other goal line, and -10 and 110 are the end lines. y grows up the screen.
- x is yards from that team's left sideline as it faces up the screen, 0 to 53.3. "Left" in the engine's data (pass location, run location) is screen left.
- On screen, X = columnLeft + (1 + x) x s and Y = columnTop + (cameraY - y) x s, where cameraY is the y at the top edge of the column.
- One play stays in one frame from snap to whistle. An interception return runs down the screen. The view flips to the new offense at the next dead ball, with a 200 ms crossfade (a cut under reduced motion). Rejected: a 180-degree rotation, which is the motion that most disorients and tells the player nothing.
- Kickoffs and punts are drawn in the kicking team's frame, so the kick goes up the screen.

### Camera and field drawing

- The camera puts the line of scrimmage 70% of the way down the column. That shows about 17 yards of backfield and about 41 yards ahead at 1280x720, which holds a deep pass.
- It pans only up or down, and only when the ball comes within 5 yards of an edge. Under reduced motion it cuts.
- Yard lines run across the column. Numbers sit upright along both sidelines. Hash marks are two columns of ticks. End zone team names are horizontal and in `color.inkSoft`.

### Rule for what may be drawn

The animation is a pure function, `timeline(event, preSnapState, calls, templates)`, that returns keyframes. It has no RNG and no outcome logic: same event, same animation.

- **Facts** come only from the PlayResult and its `detail`: where the ball went, who had it, where it died, who tackled, who scored, flags, reviews.
- **Diagram** comes from designed templates keyed by the calls only, in `data/ui/` (designed, kept in data): alignments, routes of players who never touch the ball, defenders' drops. Diagram movement never touches the ball and never ends at a spot that suggests a different result. Only the engine's tackler arrives at the tackle.
- **Unknown facts are drawn neutral and never named.** If the engine doesn't say which side a missed field goal went, the ball reaches the posts and the text says "No good", not "wide left". If the pass side is unknown, the catch is drawn in the middle.

### Timeline at 1x

All timing values are designed and live in a UI data file.

1. **Run-off.** The game clock counts down by the run-off seconds over at most 0.6 s. The field is still.
2. **Set.** Marks at the formation and preset alignment, on the new line. Routes faint (40%) for under 1 s (DESIGN.md).
3. **Live.** The play's `seconds`, scaled into a 2 to 4 s window. Straight segments, easing only at start and stop.
4. **Holds.** Catch, turnover, tackle: 0.4 s. Score or standout play: 0.8 s, with the text "Touchdown", "Field goal good", "Safety" or "Standout".
5. **Whistle.** Everything stops, paths stay drawn, and the panel text updates.

At 2x everything is halved. Skip and reduced motion go straight to the final frame with paths drawn. When a review reverses a ruling, the field redraws the final frame of the new result with its paths. It doesn't animate again.

### What each play kind reads

Fields marked * are new, from the engine spec.

| Kind | Ball path | Ball carrier and tackle |
|---|---|---|
| Pass, complete | Passer* to the catch point at line + air yards*, side from pass location* | Receiver* runs the yards after the catch* up the screen to `end.spot`; the tackler* meets him there |
| Pass, incomplete | To the target* at the target point; falls | "Incomplete" at the spot |
| Interception | To the interceptor* at the catch point | The interceptor's X carries the ball down the screen to `end.spot`, with "Interception" |
| Sack | Stays with the QB | The sacker* reaches the QB at `end.spot` |
| Scramble, run | Handoff, or the QB keeps it | Carrier* through the run gap* to `end.spot`. To the sideline if `outOfBounds`: the side* if given, else the near sideline of the diagram, never named in text |
| Fumble | Comes loose at the fumble spot* | The recoverer* (`defensePossessedDuringPlay`, `end.possession`) carries it to `end.spot`, with "Fumble, recovered by #nn" |
| Punt, kickoff, onside | Dotted arc up the screen from the kick spot to the landing spot* | The returner* to `end.spot`, or the labels "Fair catch", "Touchback", "Downed", "Out of bounds", "Muffed" from the result |
| Field goal, extra point | Arc from `kickSpot` to the posts at the top | "Good" or "No good"; a blocked kick stops behind the line |
| Kneel, spike | QB only | "Kneel" or "Spike" |
| No play (pre-snap foul) | No snap | Flag marker at the line, the fouling player's mark ringed* with his number |
| Live foul | The play runs as sampled | Flag marker (`fx.flag`, `color.signal`, plus the text "Flag") at `Foul.spot`, or at the line if none, shown at the whistle |

A turnover always shows text as well as the change of mark, so it reads without color.

## Players, standout plays, box score

- **Numbers and names.** The result line names the players in the play from engine fields only, as "#81 D. Okafor". With no player for a role, it leaves that role out and never makes one up.
- **Mark labels** (Settings, Mark labels):
  - Default, "Players in the play": at the whistle, the numbers of the players in the play (passer, carrier, target, tackler, interceptor, fouling player) appear beside their marks.
  - "All": every mark's number, inside the mark when it is at least 20 px, else beside it.
  - "None".
  - Labels are at least 12 px at 100% text size and scale with it, never covering a path, the ball or the line.
- **Player card.** Number, name, position, the four base ratings (Speed, Strength, Agility, Awareness) and the position skills as horizontal bars, each with its number beside it, so the bar never carries the value alone.
  - Bars compare within the position (lead), labeled "Compared with other [position]s".
  - Below the bars: today's stat line.
  - Rating detail (1): each rating's league-wide rank at the position across the generated league, for example "Speed 88: 4th of 71 WRs".
  - Read-only, no decisions.
- **Standout plays.** When the trace has a standout entry, the result line starts with "Standout:", the player's mark gets the `mark.ballCarrier` ring, and the hold is 0.8 s. The why line names the player and the rating, for example "Standout: #22 R. Vance's speed (94) broke it for 48." That template belongs to the engine spec and binds only to trace fields. The end screen lists the game's standout plays.
- **Box score.**
  - Team tab: as in step 5 (score by quarter, first downs, yards, completions, sacks, turnovers, penalties, 3rd and 4th downs, time of possession, punts, field goals), plus challenges won and lost.
  - Player tabs, with numbers:
    - passing: C/A, yards, TD, INT, sacked
    - rushing: attempts, yards, TD, long
    - receiving: targets, catches, yards, TD, long
    - defense: tackles, sacks, INT, forced fumbles, recoveries
    - kicking: FG made/attempted, long, XP, punts, average
  - Drives tab: a row per drive with its outcome, expanding to its plays.
  - Everything comes from the event log. Headline numbers first, rows one click deeper.

## Challenges

Decided (Joseph): the challenge prompt appears only after a play the engine marks as a close call that went against you, and only when the rules let you challenge it then. The computer coach challenges too, by a policy the engine spec defines, with the same eligibility. Reviews that the rules start without a coach's challenge use the same "Under review" and "Review result" screens.

**Gap. The 2026 challenge and replay rules are not looked up yet.** I could not reach the 2026 Official Playing Rules from this session. RULES.md says challenges and replay are not modeled, and there is no copy of the rulebook in the repo. Nothing below is written from memory.

Before the engine spec is approved, these must be looked up in the 2026 rulebook on operations.nfl.com, cited in RULES.md and put in the rule set data:

- challenges per team per game, and any extra challenge
- what a failed challenge costs, and whether a team with no timeouts may challenge
- when coaches may not challenge (by period and clock)
- which plays and rulings are reviewable
- which reviews start without a coach's challenge
- whether a review can take place after a penalty choice, which settles the order in "Screen flow"

The UI hard-codes none of these. Pips, the challenge prompt's eligibility and the risk text all read the rule set.

## States and errors

| State | What the player sees |
|---|---|
| Loading | "Loading league data" with a per-file progress bar. Fonts load in parallel and the UI waits on both |
| Data failed validation | "Game data failed its check: [file]. This build can't run." No play possible |
| Unsupported browser (no Worker, Canvas or ES2022) | One plain screen naming what's missing |
| Window below 1024x600 | "Make the window larger to play." The game pauses and resumes when the window is large enough |
| Storage blocked or unavailable (private window, permission denied) | The game plays. A persistent status line says "This game can't be saved in this browser window." Continue is off on the title screen |
| Save failed (quota) | Same line, retried at the next dead ball. Never blocks play |
| Save from an older build (data or rule set hash differs) | "This save is from an older version and can't be resumed." 1 Delete save, Esc Back |
| Save corrupt | As above, with "is damaged" |
| Sim error (`GameRuleError`, `GameLoopError`, worker crash) | Play stops. "Something went wrong in the game engine." Shows the seed and play number. 1 Copy details, 2 Restart from last save, Esc Title. Never silently continues |
| Why line failed to render | The result line shows. The why line reads "No explanation for this play." Seed and event index are logged. Never fallback text |
| No plays yet | The box score before the first snap shows the teams and "No plays yet". Player rows with no stat show a dash, not 0 |
| Off choice pressed (including Same call) | The status line repeats the reason; nothing else happens |
| No timeouts or no challenges left | T dimmed with "No timeouts left"; the challenge prompt never appears |
| Worker slow | If a response takes over 300 ms, "Working..." in the status line. No fake delays anywhere, including AI calls |

Feature-specific states: two-minute warning (event line, clock "stopped"), end of quarter, halftime, overtime, a tie (the end screen says "Tie"), a game ending on a kneel (the end screen right after the kneel), safety kick, untimed down ("The half is extended for one untimed down."), offsetting fouls ("Offsetting fouls, replay the down"), a score wiped by a penalty (the result line says it doesn't count, and why), under review, ruling stands, ruling reversed, an AI challenge.

## Accessibility (baseline, not optional)

- **O and X by shape, always.** O stays `color.offense` blue and X `color.defense` orange-brown (Joseph). Color is the second cue. The ball-carrier ring is a shape. Every screen passes a grayscale check. DESIGN.md's deuteranopia and protanopia simulation of the pair is not done yet and blocks sign-off of the field.
- **Text size.** Settings at 100, 125, 150 and 200%. At 100%: body text at least 16 px, why line 18 px, down and distance 24 px, mark labels 12 px. At 200% at 1280x720 the panel scrolls before it truncates, and nothing covers the field column.
- **Reduced motion.** It follows `prefers-reduced-motion` by default, with an in-game override. It means: the final frame with paths, no camera pans, a cut instead of the possession crossfade, and no holds.
- **Keyboard.** Fully playable by keyboard, with a visible focus ring (2 px `color.ink` outline, not fill alone) and a logical focus order: panel header, play text, menu.
- **Screen reader.** Menus are real buttons in a labeled group. The result, calls, event and why lines go to a polite live region. A blind player can play the whole game from text, because the field adds no fact the text lacks.
- **Contrast.** Text uses DESIGN.md's token pairs on the approved paper field. Dimmed rows use `color.inkSoft` (5.5:1) plus a text reason, never opacity alone.
- **No timing anywhere** (decision 2). Review beats can be skipped and aren't required. Nothing flashes more than 3 times a second.

## Model output: uncertainty, wrong results, correction

The "model" is the engine. Its results are draws, not verdicts, and the UI has to say so without lecturing.

- **Uncertainty.** The why headline says how common the result was ("a common result in this situation", "a fluke"). The details view shows the exact probabilities and multipliers the engine used, after the play only.
- **No answer.** If the why sentence can't render, the UI says so (see States). It never writes its own.
- **Wrong, in the game.** The challenge, on close calls the engine marked. The same tool is open to the AI.
- **Wrong, as a bug.** "Copy details" in the details view copies the seed, play number and trace, so Joseph can replay the exact play. The same goes for an AI call no coach would make (step 2 noted kneels when trailing late): it shows plainly in the calls line and can be copied and reported.

## Needs from the engine (for its own spec)

1. **Step-wise loop.** Each decision point is a request with its kind, the legal options and a reason code for each option that is off. Kinds: toss, overtime choice, kickoff type, try, offense call, defense call, Same call legality, timeout (both sides), tempo, penalty choice with a preview of the state each option leaves (step 5 revision 11 already computes these), ten-second run-off, challenge. The AI's call is never sent to the UI before the snap.
2. **Participants per play** in `detail`, as player ids: passer, target, receiver, ball carrier, tackler, sacker, interceptor, fumble forcer and recoverer, kicker, punter, returner, and the fouling player.
3. **Geometry from the sampled real play,** where pbp has it: pass location, air yards, yards after catch, run location and gap, kick landing spot, fumble spot. Missing stays missing.
4. **On-field personnel** for both sides with slot positions, so marks are the right players.
5. **Standout entry** in the trace: the player, the rating and its value.
6. **Challenges and reviews.** The rules from the 2026 rulebook, looked up and cited (see "Challenges"). A close-call flag with a question key for the prompt, the alternative result, the AI challenge policy, and the cost in rule set data.
7. **Why headline variant (required, lead).** Every why template gets a plain-words headline with no multipliers or raw factors, still bound only to trace fields and covered by the step 4 E2 test. The multipliers move to the details view, which renders the trace.
8. **Per-player box score** from the event log, including challenges.
9. **Tempo modes** for the human offense: the run-off each one draws.
10. **Jersey numbers** in the team pool schema (a schema change, approved by the lead for M2): unique within a team, valid for the position under the 2026 rules (looked up, not from memory), generated by seed.
11. **League-wide rating ranks** by position across the generated league, for the rating detail view.

## DESIGN.md: settled choices and remaining conflicts

Settled by Joseph:

- **Paper clipboard field.** DESIGN.md's contrast figures, all computed on paper, stand.
- **Team colors as a swatch beside team names only.** They appear in the scoreboard, box score headers and the pregame matchup, never alone and never on marks. O stays blue and X orange-brown. With the offense always O (decision 4), color can't show "my team" on the field, so the panel's "You're on offense or defense" does that job.

Still blocking field sign-off: the deuteranopia and protanopia simulation.

Conflicts with the DESIGN.md draft, for art-director:

1. **Orientation.** DESIGN.md is written for a side-to-side field. Portrait needs: yard lines across the column, upright numbers along both sidelines, hash marks as two columns, end zone names horizontal at top and bottom.
2. **Play menu as a bottom panel, why line under the field.** Both move to the right-hand panel (decision 5).
3. **Down and distance beside the scoreboard.** It moves to the panel header.
4. **Play clock in the HUD.** Proposal: drop `hud.playClock` and show the run-off.
5. **Speed toggle "on a number key".** Number keys are menu rows. Proposal: S, during the animation.
6. **Mark size.** 1.4 yards with a 14 px floor and diagram spacing for the interior line, in place of one-third of a 5-yard gap.
7. **Missing slots:**
   - field: `field.goalPost`
   - card: `card.panel`, `card.ratingBar`
   - effects: `fx.standout`, `fx.challenge` (a `color.signal` marker plus text, not a red TV flag), `fx.review`
   - HUD: `hud.challenges`, `hud.clockState`, `hud.tempo`, `hud.teamSwatch`, `hud.playMenu.disabled`, `hud.resultLine`, `hud.callsLine`, `hud.situation`
   - marks: `mark.number`

## Acceptance criteria

| # | Criterion | How it fails |
|---|---|---|
| F1 | A full game from title to box score is playable with the keyboard alone, and with the mouse alone. | Any step needs the other device. |
| F2 | Every screen in the flow table is reached in a scripted playthrough covering: both toss outcomes, onside both ways, 4th down go, punt and field goal, a two-point try both ways, the penalty choice, a challenge by you and by the AI (stands and reversed), the ten-second run-off prompt, Same call on and off, halftime, overtime, a tie and an end on a kneel. | A screen unreachable or missing. |
| F3 | No screen shows more than 7 choices under the definition above. A test counts the interactive elements in every screen state. | 8 or more. |
| F4 | Off choices keep their number, show a reason, and do nothing when pressed. Kick is off outside 4th down and the last 2:00 of a half; Kick and Clock are off on a two-point try; Same call is off with no legal earlier call. | A shifted number or a silent off row. |
| F5 | The opponent's call never reaches the UI thread before the snap. A test inspects the worker messages. | Leaked. |
| F6 | Same call submits exactly this side's last call in this game, and it leaves the tempo unchanged. | A different call or a changed tempo. |
| C1 | Same call takes 1 key, a new run or pass 3, a kick or defense call 2. The next menu renders on the next frame, and the snap starts within 100 ms of the last key on Joseph's machine (recorded in PERF.md). | More keys, or over budget. |
| C2 | Number keys during the animation do nothing; Space skips; S cycles speed. | A buffered call. |
| L1 | At 1024x600, 1280x720, 1440x900 and 1920x1080: the field column follows the width rule, marks are at least 14 px, the interior line's marks don't overlap, and the panel never covers the field column. Below 1024x600, the "make the window larger" state appears. | Overlap, undersized marks, or a missing state. |
| A1 | `timeline` is pure: the same event gives a deep-equal timeline, and it imports no RNG. | Nondeterministic. |
| A2 | Over every play of 1,000 simulated games: the ball's final screen y equals the mapping of `end.spot`; at the set phase every offense mark is below the line of scrimmage (offense attacks up); the mark holding the ball at the end is the engine's player with the ball; the mark at the tackle is the engine's tackler; every text label on the field maps to a result field. | Any mismatch. |
| A3 | No diagram mark touches the ball. A fact the engine leaves out is drawn neutral, and no text names it. | An invented fact. |
| A4 | At 1x, snap to whistle takes 2 to 4 s for every play (holds and run-off excluded); at 2x it is half; skip and reduced motion show only the final frame with paths. | Out of range. |
| A5 | After a change of possession, the next dead ball shows the new offense attacking up, with a crossfade (a cut under reduced motion) and no rotation. | Wrong direction or a rotation. |
| H1 | The why line equals the engine's headline variant for every play, and the details view shows the multipliers from the trace. Event lines never appear in the why line. | Text from anywhere else. |
| H2 | The result line names only players, with numbers, that are present in `detail`. | A made-up name, number or role. |
| H3 | Team color appears only as a swatch beside a team name. No mark, path or field element uses a team color. | Team color elsewhere. |
| R1 | Challenge eligibility, count and cost come from the rule set data, which cites RULES.md. A test with a fixture rule set shows the UI follows the data. | Hard-coded rules. |
| P1 | The player card shows within-position bars with their values; the rating detail shows each league-wide rank by position, and it matches a rank recomputed from the league. | Missing or wrong rank. |
| S1 | Every state in the states table is reachable in a test and shows the specified text. | Missing or different. |
| S2 | Resuming a save mid-game gives the same rest of the game as not quitting, for the same inputs. | Divergence. |
| X1 | Grayscale screenshots of the field mid-play and at the whistle: O, X, ball, flag and turnover read correctly (art-director check). | Unreadable. |
| X2 | At 200% text size at 1280x720: no truncated text, and nothing over the field column. | Overlap or truncation. |
| X3 | An automated accessibility check on every screen passes WCAG 2.2 AA for contrast, names and focus. The live region announces the result, calls, event and why lines. | A failure. |
| X4 | With `prefers-reduced-motion` set, nothing moves anywhere. | Any tween. |
| G1 | Joseph plays at least one full game and says whether it was fun for an hour. The notes go in a playtest log. | Not run. |

## Final and open

Final: decisions 1 to 5 and 7 to 19, the layout rule, the screen flow, the controls, the states, the accessibility baseline, and the animation rule (facts from the result, diagram from the calls, unknowns neutral).

Open:

- Decision 6 (formation before play), unless Joseph wants it changed.
- The 2026 challenge and replay rules (a gap, see "Challenges"), and with them the review-then-penalty order.
- Whether the "D: details" hint counts as a choice (lead).
- Every UI timing value and the lineman spacing (playtest, art-director).
- The DESIGN.md conflicts above (art-director).
- The colorblind simulation.

## Resolved open questions (2026-11-12)

From Joseph:

1. **Field look:** a paper clipboard field. DESIGN.md's paper contrast figures stand.
2. **Team colors:** only as a swatch beside team names. O and X keep offense blue and defense orange-brown. Applied in HUD, H3 and the DESIGN.md section.
3. **Challenges:** the flag appears only on close calls, and the computer coach challenges too. The 2026 challenge and replay rules must be looked up, not written from memory. I could not reach the rulebook from this session, so they are a marked gap in "Challenges" and engine need 6. Applied in decision 19, the flow, the states and R1.
4. **Field orientation:** portrait. The field runs up and down the screen, and the team with the ball always attacks up. Applied in decisions 4 and 5, "Layout" (field column, panel, HUD and why line placement, mark size and lineman spacing), "Coordinates", the animation table, L1, A2 and A5.

From the lead:

5. **Tempo:** the player chooses it, and it resets to Normal each drive (decision 3).
6. **Jersey numbers:** on players and marks (decision 18, "Players", engine need 10).
7. **Rating bars:** compared within the position, with the league-wide rank in the detail view ("Players", engine need 11, P1).
8. **Seven-choice rule:** a scrollable list such as a roster counts as one choice ("What counts as a choice").
9. **Same call:** a one-key "same call again" is added (decision 10, F6, C1). To keep the first screens at 7, details moved from its own row to the D accelerator and the pause menu.
10. **Why line:** a plain-words headline, with the multipliers in the one-key detail view. Recorded as a requirement for the engine spec (decision 13, engine need 7, H1).

## Lead decision (2026-11-12)

- The "D: details" hint under the why line is a key hint, not a menu choice, so it doesn't count toward the 7-choice limit. It stays.
- Jersey numbers in the team schema are approved as part of the M2 engine spec, which handles them as the ask-first schema change.
- The 2026 challenge and replay rules are a marked gap until the M2 engine spec looks them up and cites them in docs/RULES.md.
