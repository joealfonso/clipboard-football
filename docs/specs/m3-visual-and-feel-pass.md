# M3 visual and feel pass

Status: DRAFT for Joseph and the lead. Written by art-director on 2026-11-23 from Joseph's request that day, "improve visuals and the general feel". This file is a review and a build list. It changes no rule by itself: every rule change is in "Proposed DESIGN.md changes" with its replacement text, and none of it is in DESIGN.md yet.

## What I looked at, and what I could not

- All eight screenshots in docs/screens/ dated 2026-11-20 (menu, calling, formation cards, pass cards, play, kickoff call and its native crop, kickoff play). They are 1440x900. I viewed the JPEGs scaled down, plus the one native crop, so anything I say about a 1 px detail is from the code, not the picture.
- Read in full: DESIGN.md, docs/DESIGN_HISTORY.md, docs/ASSETS.md, docs/research/2026-11-15-dribbble-ui-trends.md, packages/app/src/styles.css, and in packages/app/src/ui: tokens.ts, field.ts, animator.ts, moments.ts, cards.ts, intro.ts. Also data/ui/motion.json and the timing block of data/ui/templates.json, and the docs/DECISIONS.md entries from 2026-11-15 on (QB throw pace, Deeper drops, Plausible tackler, Live cap raised to 14 s).
- Read by search only: layout.ts, splash.ts, app.ts, timeline.ts, marks.ts, motion.ts, overlay.ts, storage.ts. I did not open menu.ts, topbar.ts or art.ts beyond searches.
- I did not run the app. Every statement about motion and timing comes from reading code and data, not from watching a play. Where that matters I say "from the code".
- Not in any screenshot, so not reviewed by eye: pregame face-off, matchup intro, halftime, final, settings, the player card, details, box score, log, pause, every moment banner and chip, a red zone or goal line play, any frame mid-pass.
- No number in this file was measured. Sizes are from tokens and code. The two time costs I give are arithmetic and are marked as estimates.

## The main finding

The build is one full revision behind DESIGN.md.

DESIGN.md is the "Under the Lights" revision (2026-11-20, DRAFT). The code is still "Prime Time". I checked: tokens.ts and the `:root` block of styles.css still carry the mid-green turf (#2F7237), the navy stage (#0A1428), `.glass` with `backdrop-filter`, `--sheen`, `--shadow-select`, the cream `--paper` cards and the blue `--los`. None of the six chunks in DESIGN.md "Build delta" is built. I found no record in docs/DECISIONS.md or docs/DESIGN_HISTORY.md of Joseph answering the four "Needs Joseph" items that two of those chunks wait on.

So most of what looks wrong in the eight screenshots already has a written fix. The first job of this pass is to get those four answers and build that delta. The rest of this file adds what Under the Lights did not cover: motion, the camera, impact at the catch and the tackle, a result you can read on the field, card diagrams you can tell apart, and sound.

One more thing a reader should know before the punch list. This pass adds no color token and no duration token. Everything new is drawn with tokens DESIGN.md already has.

## Does Under the Lights fit Joseph's direction?

His standing direction is modern and sleek, broadcast or premium-app polish, with elevation, soft gradients, rounded corners and smooth motion. Flat-only, hard-edged, monospace and boxed keycaps read as 8-bit to him.

Under the Lights removes glass, sheen and card shadows from the chrome. That could be read as a step back toward flat. My view is that it is not, for three reasons:

1. What read as 8-bit was monospace type, bordered key boxes, hard slabs and hollow butt-capped marks. All of that stays banned.
2. The depth that is left sits where it has a job: the lit field against the dark, shadows under marks, the stage light, overlay shadows, chips that lift off the play. Rounded corners are everywhere.
3. Two dark surfaces can only be about 1.3 to 1 apart (DESIGN_HISTORY, point B), so stacking five glass cards never produced hierarchy. Fewer surfaces does.

The risk is real though: one flat sheet on a near-black stage could read plain once it is built. I do not recommend bringing card shadows back now. I recommend spending the polish he asked for on motion and on the field, which is where this pass puts it, and deciding on chrome depth from the retaken screenshots. That is Open question 6, with a specific fallback.

## Critique, screen by screen

Verdicts are against DESIGN.md as it stands today. Each note names the slot and the rule. "From the code" means the slot is not in a screenshot.

### Main menu (2026-11-20-menu.jpg)

What holds up: the wordmark and the chalk X's and O's are the best things in the build. That was DESIGN_HISTORY's read too and I agree.

What does not:
- The four rows each have a resting fill, so the menu is a stack of four same-weight rounded boxes, and the selected one adds a gold tint, a gold inset ring, a glow and a gold focus outline on top.
- The diagram sits in a bordered, shadowed card. With marks at their 14 px floor in a box about 490 px wide, it reads like an embedded video player with a small picture in it, not like the game's handwriting on the dark.
- Composition: the wordmark is top left, the art is lower right and starts level with the tagline, and nothing lines up between them. At 1440x900 the frame is 1040 px wide, so a fifth of the window on each side is empty.
- The legend is 12 px under a hairline, a third box edge.

| Slot | Verdict | Note |
|---|---|---|
| `menu.wordmark` | REVISE | 1. 88 px, DESIGN.md Typography `type.hero` is 96. |
| `hud.playMenu` | REVISE | 1. Rows carry `--row-rest`; Rows says "Rest: no fill". |
| `hud.playMenu.selected` | REJECT | Banned looks: "A ring, outline or glow around the selected item, in any color, and double rings of any kind." |
| `menu.splashArt` | REVISE | 1. Card, border and `shadow-2` around it; Main menu says "with no card, border or shadow around it". 2. Too small in its column, see A5. |
| `hud.legend` | REVISE | 1. `border-top` and blur; Calling screen, Legend says "No surface, no border". 2. 12 px; `type.small` is 13. |

### Calling screen, play type (2026-11-20-calling.jpg)

- Five boxes at one weight: the glass top bar, the situation plate, the last play card, the call sheet and the legend strip, plus the board. Nothing leads.
- The row list is ragged. Rows that are on have a resting fill and rows that are off do not, so "Formation, Clock, Timeout, Menu" are boxes and "Kick, Same call, Earlier call" are bare text between them. It looks like a rendering fault.
- "Formation" has two concentric gold outlines.
- The drive tracker is a second, small green field with a blue line on it, right above the real one.
- The board is the largest object on the screen and it shows an empty field with a ball. The grass is one flat mid green: I cannot see the mowing stripes at all. Yard lines are thin and gray, the numbers are small labels, and "EMBERS" at midfield is a pale smudge.
- The down and distance is printed three times and the spot four times (already counted in DESIGN_HISTORY).
- The call sheet ends at about 60% of the height and the board runs to 90%, so the two columns have ragged bottoms.

| Slot | Verdict | Note |
|---|---|---|
| top bar | REJECT | Banned looks: the glass dashboard (translucent bar, backdrop blur, drop shadow). Top bar says "no fill, no border and no shadow". |
| `hud.scoreboard` | REVISE | 1. `.bug` carries `shadow-2`; Score bug says "no shadow". 2. Game and down segments use `surfaceRaised`; they are `color.surface`. Otherwise the strongest piece of chrome in the build, see the native crop. |
| `hud.situation` | REJECT | Banned looks: the glass dashboard. Calling screen says "on the stage, no surface". |
| `hud.driveTracker` | REVISE | 1. Green turf fill; Do not: "Do not use green anywhere but grass." 2. Blue line of scrimmage marker; the tracker has a ball and a first-down marker only. 3. 44 px tall; it is 28. |
| last play (`hud.resultLine`, `hud.callsLine`, `hud.whyLine`) | REVISE | 1. Glass card; Principles 6: "Text that can sit on the stage is not boxed." 2. Result line 20 px; `type.result` is 24. |
| call sheet | REVISE | 1. Glass, sheen, blur and `shadow-2`; a sheet is opaque `color.surface`, 1 px `hairline`, no shadow. |
| `hud.playMenu.selected` | REJECT | Banned looks: double rings, as on the menu. |
| `calling.board` | REVISE | 1. `shadow-2`; Calling screen says "no shadow". 2. Field paint, see the play screen below. |

### Calling screen, formation and pass cards (formation-cards.jpg, pass-cards.jpg)

- The cream tiles are the brightest thing on the screen. The eye lands on them before the situation or the field.
- Formation cards cannot be told apart at a glance. Each is a row of dots on one line in the middle of a tall tile that is about 60% blank. Shotgun, Pistol and Empty differ by one or two dots a few pixels apart. The diagram is not doing its job, which is "the play as the coach would draw it".
- Pass cards: the five linemen's block ticks pile into one black blob at the center of every card. That is the "melted shapes" look and it is the most machine-made thing in the build. The depth band is a gray bar across the card that reads as a redaction.
- "Intermediate pass" wraps to two lines and pushes its diagram down, so the three cards in a row do not line up.
- Selected card: a gold outline, a lift and a shaded strip.
- On the board, the azure discs sit on the blue line of scrimmage and merge with it. The routes are washed out at 40%.

| Slot | Verdict | Note |
|---|---|---|
| `card.play` | REJECT | Banned looks: "Cream, paper or any light-colored tile or panel on a game screen." |
| `card.play` selected | REJECT | Banned looks: "A ring, outline or glow around the selected item." Play cards says "No outline, no lift." |
| `card.play` diagram | REVISE | 1. Formation cards waste the tile and do not read apart; Principles 8: "Every detail has a job you can say in one sentence." 2. Lineman ticks merge; Banned looks: "melted shapes, inconsistent stroke weights". 3. Defense paths and zone edges are dashed; Play cards says a fake is "the one dashed path". |
| `field.scrimmageLine` | REVISE | 1. Blue; Do not: "Do not put any hue on the field that is not a team's." Waits on Needs Joseph 3. |
| board preview | REVISE | 1. Routes at 40%; Field, Preview strength says full strength on the board. |

### Play screen (2026-11-20-play.jpg)

- The field is the picture and it is the flattest thing on screen: one green, no visible stripes, gray 1 px lines, 26 px numbers that look like labels, a thin boundary.
- The rail is two glass cards with about 500 px of nothing between them. A third of the screen is dead for the whole play.
- The ball is 5 by 7 px next to 23 px marks. On the quarterback it reads as a pupil in an eye, not as a ball.
- The field column throws a wide soft shadow on the stage.

| Slot | Verdict | Note |
|---|---|---|
| `field.surface`, `field.turfStripe` | REVISE | 1. #2F7237 and #327739; Color: field gives #16461D and #1A5422. Waits on Needs Joseph 1. |
| `field.light` | REVISE | 1. A white center light; Principles 3: "Nothing may lighten the grass." It is a shade now. |
| `field.yardLine`, `field.yardNumber`, boundary | REVISE | 1. Lines at 0.8 alpha and 1 px; Field says full opacity, 2 px from 14 px per yard. 2. Numbers fixed at 26 px; cap height is 2 yards. 3. Boundary a 3 px stroke; it is a band `0.4 * s` wide. None of this waits on Joseph. |
| `field.midfield` | REVISE | 1. Pale fill; it is `color.midfieldPaint`, darker than the grass. |
| pre-snap zones | REVISE | 1. Filled with `color.line` at 10% (field.ts), which lightens the grass; it is `color.zoneFill`. From the code. |
| `mark.offense`, `mark.defense` | ACCEPT | Shape, ring and caps are right. `shadow.mark` takes its new value with the tokens. |
| `ball` | ACCEPT as specified | It matches Marks, Ball. The rule is the problem, see B3. |
| `fx.carrierTrail` | ACCEPT | |
| `hud.playRail` | REJECT | Banned looks: the glass dashboard. Play screen says "no surfaces". |
| field column shadow | REVISE | 1. `SHADOW.field`; Field says "The column casts no shadow". |

### Kickoff (kickoff-call.jpg, kickoff-play.jpg, native crop)

- The "Dead ball" sheet holds three rows and is 40% empty, next to a board twice its height.
- In kickoff-play.jpg the end zone name "EMBERS" is cut in half by the top of the view. From the code this is not a one-off: the camera stops 5 yards past the ball, so any play that ends near a goal line shows half an end zone. That includes every touchdown, which is the frame that matters most.
- In the native crop the short stub of yard line between the sideline and each number reads as a minus sign ("-10"). Recheck after the numbers grow (C1).
- The native crop also shows the bug holds up at full size. It is the one piece I would not touch beyond its shadow and segment fill.

### From the code only

| Slot | Verdict | Note |
|---|---|---|
| `card.panel` (player card) | REJECT | `.mark-card` is `--paper` with ink text. Banned looks: cream panel. |
| `moment.banner`, `pregame.faceoff` | REVISE | 1. A white sheen is drawn over the team fill (field.ts `drawBanner`, `.fo-half`); Do not: "Do not put a gradient, sheen or tint on team color." 2. `.faceoff` carries `shadow-3`; only overlays and the VS disc may. |
| `.game-log:focus-visible` | REVISE | 1. Gold with a literal fallback `#f5c84c`; Rows says every focusable that is not a row takes a 2 px `color.chalk` ring, and Do not bans literal colors. |
| docs/ASSETS.md | REJECT at intake | The main table has no rows. Only the fonts are logged. Every code-drawn slot the build ships (field, marks, bug, cards, moments, splash) needs a row with source, license and AI use. This was already called out in the 2026-11-14 review and is still open. See A7. |

## Feel: what exists today

All from the code.

- Before the snap: the huddle breaks over 450 ms, the set holds 300 ms, then the snap (motion.json `preSnap`). The clock run-off ticks inside that beat.
- The live play runs 1.8 to 14 s at 1x. Marks ease up and down with per-position values and carry a small natural wobble. This had a lot of careful work (natural motion, throw pace, deeper drops, plausible tackler) and I am not proposing to touch any of it.
- The whistle hold is 400 ms (800 on a score), with a 300 ms settle inside it. Banner moments hold 1.2 to 1.8 s.
- Rows: 180 ms hover and travel, a 120 ms press, a 24 ms stagger on menu change. The bug has its odometer, down swap, first-down flash and possession slide. These are built and I have no changes to them.
- Calling to play is a 240 ms fade of the whole field. Play to calling is one 240 ms rise of the whole panel.

What is missing:

1. The snap has no transition of its own. DESIGN.md already specifies the board growing into the field over `dur.snap`. `DUR.snap` and `--dur-snap` are defined and used nowhere. The two screens feel like two apps.
2. The camera is a hard clamp (layout.ts `panCamera`). It does nothing until the ball is 5 yards from an edge, then moves at exactly the ball's speed, then stops dead. On a deep pass the ball is drawn at roughly 30 yards a second, so the pan starts and stops at that speed with no easing.
3. The camera has no idea where the end zones are. It can show half of one, and in the red zone `cameraAt` puts the top of the view well past the end line, which the field code fills with flat turf color. I could not confirm that second part without a red zone screenshot.
4. Nothing marks a catch or a tackle. The ball arrives and the play carries on. The carrier ring only appears at the whistle.
5. The ball in the air grows and shrinks, but its shadow does not move, so height is read from size alone.
6. The result is not on the field. Unless the play was a first down, a 20-yard gain or a score, the play ends, 400 ms pass and you read what happened on the next screen.
7. A pressed row answers only when the screen stays the same. Play cards have no press state at all. Marks give no hover or pointer cue that they open a player card (I found no cursor change in the code).
8. The return to the calling screen is one block rising. DESIGN.md specifies a 40 ms stagger of three parts. Not built.
9. There is no sound of any kind. I searched the app for Audio, AudioContext and audio files and found none. The only bundled assets are the three font files.

## Punch list

Ranked inside each group by impact per unit of work. The top ten across groups is at the end of this section. "UTL" means the item is already specified in DESIGN.md (Under the Lights) and the values there are the source; I repeat the key ones so the engineer has them in one place.

Every item keeps these: the animation reads the PlayResult and decides nothing; the play timing settled in docs/DECISIONS.md (live cap 14 s, QB throw pace, deeper drops, plausible tackler, moment holds) is untouched except for one argued change in D1; text stays readable at 1280x720; nothing but the player card covers the field during live action; no screen gains a choice except Settings in E1.

### A. Quick wins (tokens and CSS only)

**A1. One selection: fill, bar, key.** (UTL chunk 1. Waits on Needs Joseph 4.)
- Problem: double gold rings on every selected row and card; resting fills make every list a stack of boxes.
- Change and values:
  - `--select: rgba(255, 255, 255, 0.10)` (replaces the gold gradient). Delete `--shadow-select`, `--select-ring`, `--row-rest`.
  - `.row { background: transparent }`. `.row.hl, .row:hover, .row-hl { background: var(--select); box-shadow: none }`. Keep the 3 px gold bar, weight 600 and the gold key hint.
  - `.row:focus-visible { outline: none }`, and `.row:focus-visible:not(.hl) { outline: 2px solid var(--chalk); outline-offset: 2px }`.
  - `.play-card.hl, .play-card:hover, .play-card:focus-visible { outline: none; transform: none; box-shadow: none; background: var(--select) }` plus the same 3 px gold bar, inset 8 px.
- Files: styles.css, tokens.ts (`selectRing` and `rowRest` out, `select` in). Tests named in DESIGN.md Build delta 1.
- Asset: none.
- Verify: retake menu.jpg, calling.jpg, formation-cards.jpg. No ring around the selected item at any zoom. Off rows and on rows now look the same at rest except for text color.

**A2. Quiet chrome: the stage, one sheet, no glass.** (UTL chunk 4. The stage hex waits on Needs Joseph 2; the unboxing does not.)
- Problem: five same-weight glass boxes; a toolbar-style top bar; a navy stage that argues with blue teams.
- Change and values:
  - `--bg: #0A0D14`, `--bg-top: #10141E`, `--bg-bottom: #07090E`, `--stage: radial-gradient(120% 90% at 50% 0%, #10141E 0%, #0A0D14 55%, #07090E 100%)`.
  - `--surface: #1E2638` (opaque), new `--overlay: #263046`, `--score-box: #06080D`, `--track: rgba(255, 255, 255, 0.12)`, `--banner-strip: rgba(30, 38, 56, 0.96)`.
  - Delete every `backdrop-filter`, `--sheen`, `--top-bar`, `--shadow-1`, `--shadow-2`, `--panel`, `--panel-raise`, `--surface-solid`, `--radius-xl`.
  - `.top-bar`: no background, border or shadow. `.bug`: `box-shadow: 0 0 0 1px var(--hairline-strong)` only. `.seg`: `var(--surface)`.
  - No surface on the situation line (min height 64, was 96), the last play, the rail blocks, the legend, the splash art. No shadow on the board or the face-off band. `.fo-half` background is the team fill only.
  - Call sheet: `var(--surface)`, 1 px `var(--hairline)`, `radius.lg`, padding 20 px 24 px.
  - Overlays (pause, details, box, log, player card): `var(--overlay)`, 1 px `var(--hairline-strong)`, `--shadow-3`.
  - Drive tracker: 28 px tall in all, an 8 px bar of `--track` with radius 4 px, end caps in the two end zone colors, no green, no line of scrimmage marker.
  - field.ts `drawBanner`: delete the sheen pass.
- Files: styles.css, tokens.ts, overlay.ts (`overlayBackground`), field.ts (banner), layout.ts (`CALLING_ESTIMATE` heights). The tracker may need one wrapper element in app.ts or dom.ts; engineer to confirm.
- Asset: none.
- Verify: retake calling.jpg at 1440x900 and 1280x720. Count surfaces: one sheet, the board, the bug. At 1280x720 the calling screen gains 32 px of height from the shorter situation line; check the tight-rows mode (`.ov-menu.tight`) fires less often.

**A3. Type on the scale.** (UTL chunk 5.)
- Problem: about twenty sizes; the result line, the one sentence that tells the story, is 20 px; small text is 12.
- Values: result 20 to 24 / 1.25; every 12 px outside the bug to 13; tagline 18 to 17; `h2` 18 to 17; `h3` 16 to 15; `.hint` and `.note` 14 to 13 and 15; `.log-event` 14 to 13; face-off city 18 to 17; hero 88 to 96; screen title 40 to 44; plate down 52 to 56; face-off name 64 to 72 (48 to 56 narrow); chip 24 to 28; moment sub 18 to 17; window-too-small 20 to 17.
- Files: styles.css, field.ts (`CHIP.px`), moments.ts (`BANNER.subPx`).
- Verify: grep styles.css for `font-size`; outside the bug only 13, 15, 17, 24 and display 22, 28, 44, 56, 72, 96 remain.

**A4. The sheet and the board share a bottom edge.** (New.)
- Problem: on kickoff-call.jpg and calling.jpg the sheet ends mid-screen and the board runs on, so the two columns look unrelated.
- Change: in the two-column layout the call sheet stretches to the left column's height. Rows stay at the top; the status line sits at the bottom.
- Values: `.panel.wide > .ov-menu { align-self: stretch; display: flex; flex-direction: column }`, `.ov-menu > .status { margin-top: auto }`.
- Files: styles.css. Check the heights pinned by calling-board.spec.test.ts.
- Verify: kickoff-call.jpg retaken: sheet bottom and board bottom on one line, 16 px above the legend.

**A5. Main menu: give the diagram room.** (New.)
- Problem: the best asset in the game is drawn at the 14 px mark floor in a 490 px column, boxed, and out of line with the wordmark.
- Change and values: `--menu-frame-max: 1200px` (was 1040), `--menu-gap: 64px` (was 48), `--menu-left` stays 440 px. The art column becomes about 630 px at 1440 wide, so marks draw at about 16 px. Remove the card (A2). Top-align the art with the wordmark's cap line by moving the wordmark and rule inside the left column of `.menu-cols`.
- Files: styles.css, splash.ts (`SPLASH.frameMax`, `gap` mirror the CSS), the menu markup, main-menu.spec.test.ts.
- Asset: none.
- Verify: menu.jpg retaken at 1440x900 and 1280x720: art top level with "CLIPBOARD", no frame, marks visibly larger. At 1280 the art column is about 568 px (frame 1200, less 64 padding, 440 and 64).

**A6. Focus rings off the cursor color.** (New, small.)
- `.game-log:focus-visible` and the player card's focus outline become `2px solid var(--chalk)`, offset 2 px. No literal fallback color.
- Files: styles.css.

**A7. docs/ASSETS.md rows for what ships.** (Paperwork, blocks every ACCEPT.)
- One row per built slot group (field paint, marks and paths, score bug, rows and key hints, play cards, player card, moments, face-off and intro, splash): source "drawn in code" with the file, license "project code", AI use stated honestly, date. I cannot edit that file in this task. The wording of the AI-use cell is Open question 7.

### B. Motion and feedback

**B1. The snap: the board becomes the field.** (Specified in DESIGN.md, Screen transitions. Not built.)
- Problem: the moment you commit a call is a crossfade between two unrelated layouts.
- Change: at the snap the play canvas starts at the board's rect and grows to the field column's rect. At the end of the whistle hold it shrinks back. Everything else on the calling screen hides in one frame on the way out and comes back with B5 on the way in.
- Values: `dur.snap` 320 ms, `ease.standard`. A uniform scale from the width ratio plus a vertical clip that opens from the board's height to the column's, anchored so the line of scrimmage keeps its 70% position and never jumps. Board routes drop from full strength to 40% over `dur.fast` as the growth starts. The rail fades in over `dur.screen` once the growth ends. If the pre-snap beat (line-up plus set: 750 ms with a huddle, 300 without, halved at 2x) is shorter than 320 ms, the growth shortens to match. It never delays the timeline.
- Build note: interpolate the canvas view (scale, left edge, clip) and redraw each frame, do not CSS-scale a bitmap, so paint stays sharp.
- Reduced motion and Skip: a cut, as today.
- Files: app.ts (`placeOverlays`), animator.ts, layout.ts, board.ts, styles.css.
- Asset: none.
- Verify: a 2 s capture of a snap and of a return at 1x and at 2x, 1440x900 and 1280x720. Frame-step it: the line of scrimmage stays on one screen row, and no frame shows both the board and the field. Log frame times to docs/PERF.md; if frames run over 16.7 ms, fall back to the fade, as DESIGN.md says.

**B2. A camera that eases and knows where the end zones are.** (New. Needs a DESIGN.md change and new keys in data/ui/templates.json, so ask Joseph first.)
- Problem: the pan starts and stops at full ball speed, and it cuts end zone names in half on the plays that matter most.
- Change:
  1. Target: keep the ball at least 12 yards from the top edge and 5 from the bottom (the bottom stays as it is, so a normal dropback does not pull the view down).
  2. Follow: the camera moves toward the target with an exponential follow, time constant 180 ms on the timeline clock. It cannot overshoot. A hard limit keeps the ball at least 3 yards from either edge whatever the follow is doing.
  3. End zones: the view never shows more than the 1.35-yard margin past an end line, at the snap or during the play. When the target would show more than 2 yards of an end zone, the target becomes the whole end zone plus that margin.
- Values: new keys in templates.json `field`: `panSoftTopYards: 12`, `panHardYards: 3`, `panFollowMs: 180`. `panEdgeYards: 5` stays and becomes the bottom margin. Designed, display only.
- What it does not change: where anything is on the field, any timing, the 50 yards shown, the portrait view.
- Reduced motion and Skip: cut to the settled target for the final ball spot.
- Files: layout.ts (`panCamera`, `cameraAt`), animator.ts (both the live loop and `jumpToEnd`), board.ts (`boardCamera` takes the same end-line limit), templates.ts (parse), templates.json, layout tests.
- Asset: none.
- Verify: three captures: a deep completion, a touchdown run from outside the 20, a kickoff into the end zone. The pan has no visible start or stop jerk; the end zone name is whole on the last frame. One still of a snap at the opponent's 10: no bare green above the end line.

**B3. A ball you can follow.** (New. Needs a DESIGN.md change.)
- Problem: 5 by 7 px at every field scale. At 1440x900 that is a quarter of a mark's width.
- Change and values: the ball is `max(5, 0.36 * markPx)` by `max(7, 0.5 * markPx)` px at flight scale 1. That is 5 by 7 at the 14 px mark floor (unchanged), about 6.6 by 9.2 at 1280x720 and about 8.4 by 11.7 at 1440x900. In flight the shadow tells the height: offset `2 + 10 * (scale - 1)` px and blur `6 + 8 * (scale - 1)` px, never less than `shadow.mark`. Below scale 1 it stays at `shadow.mark`.
- Files: field.ts (`drawBall`). The tracker's ball does not change.
- Asset: none.
- Verify: play.jpg retaken, and one frame at the top of a deep pass: the ball reads as a ball on the quarterback, and its shadow sits visibly below it at the apex.

**B4. The catch and the tackle land.** (New slots `fx.catch` and `fx.contact`. Needs a DESIGN.md change.)
- Problem: nothing on the field marks the two moments a fan reacts to.
- `fx.catch`. Fires when the ball passes to a named player after a flight or a loose ball, as the PlayResult gives it: a completion (the target), an interception (the interceptor), a recovery (the fumble recoverer). Never on a snap or a handoff, never on an incompletion. The ball-carrier ring (2 px `color.line`, no glow during live play) draws on that mark, closing from `markPx / 2 + 16` to `markPx / 2 + 6` while fading in over `dur.base` `ease.out`, holds 300 ms, fades over `dur.base`.
- `fx.contact`. Fires at the whistle when the PlayResult names a tackler or a sacker. One ring centered on the ball's final spot, radius from `0.75 * markPx` to `1.75 * markPx`, stroke `color.line` from 2.5 px to 1 px, opacity 0.7 to 0, over `dur.slow` `ease.out`. Drawn above paths and below marks. Once, never repeated.
- Both: wall-clock, like the chips. Not drawn under reduced motion or Skip. No shake, no particles, no squash.
- Considered and dropped: a short freeze at contact. The marks stop at the whistle anyway, so it would only read as a dropped frame.
- Files: field.ts, timeline.ts (expose the times the ball changes hands; display only), marks.ts.
- Asset: none.
- Verify: captures of a completion, an interception and a tackle in traffic at 1x and 2x. The ring never hides a mark or a label, and you can name the receiver without reading the result line.

**B5. The calling screen comes back in three beats.** (Specified in DESIGN.md, Screen transitions. Not built.)
- Values: the situation line, the left column and the call sheet each rise 8 px and fade in over `dur.screen` `ease.out`, 0, 40 and 80 ms after the switch. The panel itself no longer animates. Keys work from the first frame.
- Files: styles.css (`.panel.screen-in`).
- Verify: capture of a return at 1x; the three parts arrive in reading order.

**B6. Press and hover where they are missing.** (New, small.)
- Play cards: `.play-card:active { transform: scale(0.98) }` and the key hint goes `chalk` with `ink` text for `dur.fast`, the same as rows, and the same `.pressed` class for a key press.
- Marks: when the pointer is over a mark that opens a player card, the canvas shows `cursor: pointer` and the mark takes the focus ring (2 px `color.line`, no glow). The ring is already drawn for the open card, so this reuses it.
- Files: styles.css, app.ts (the hover hit test exists as `Animator.marks()`).
- Verify: by hand, mouse and keyboard.

### C. Field and marks

**C1. Field paint.** (UTL chunk 3. The paint half waits on nobody; the greens wait on Needs Joseph 1, the white line on Needs Joseph 3.)
- Ship now, on today's greens:
  - Yard lines `color.line` at full opacity, 1 px under 14 px per yard and 2 px from 14 up. Goal lines 3 px and 4 px.
  - Yard numbers: font size `2 * s / 0.70`, never under 24 px, so they scale with the field.
  - Boundary: a band `max(3, 0.4 * s)` px wide outside the lines, inside the margin.
  - `shadow.mark`: rgba(0, 0, 0, 0.40), blur 6, offset 2. Delete `SHADOW.field`.
  - Board preview routes at full strength; 40% only in the play's set phase.
- Ship on Joseph's yes:
  - `turf` and `sideline` #16461D, `turfStripe` #1A5422.
  - The shade: radial, clear from 0 to 0.4, `rgba(0, 0, 0, 0.30)` at the corner, radius `0.5 * hypot(columnWidth, viewHeight)`, painted under the end zones.
  - `midfieldPaint` rgba(0, 0, 0, 0.28). `zoneFill` rgba(0, 0, 0, 0.22) in place of the white 10% fill.
  - `los` #F5F7F2.
- Files and tests: as listed in DESIGN.md Build delta 3.
- Asset: none.
- Verify: play.jpg and calling.jpg retaken, plus the five views DESIGN.md "Still open" asks for, in normal, grayscale and the three simulations. Squint test: the stripes are the first thing that says grass. Also check the native crop again: if the stub of line between the sideline and a number still reads as a minus sign, move the numbers from 4 to 6 yards inside the sideline (conditional change P9).

**C2. Chalk cards you can tell apart.** (UTL chunk 2, plus three additions.)
- From UTL: tile `surfaceRaised`, `radius.md`, padding 8 px, no shadow; the diagram has no background and one color, `chalkSoft` at rest and `chalk` selected, via `currentColor`; paths 1.5 px, round; defense paths end in a dot and are solid; zones and bands at 10% of the diagram color with a solid 1 px edge. The player card becomes an overlay with a team-fill header.
- Additions:
  1. Formation and package cards show 14 yards behind the line to 4 past it (offense) in a 160 by 84 art box. Play and coverage cards keep their window and 160 by 120. Job: the backfield, which is what tells formations apart, gets the height.
  2. On cards, linemen are marks only. Their block paths are not drawn. Backs and tight ends keep their block tick. Job: removes the blob; the line blocks on every play, so the ticks carried nothing.
  3. Every card label reserves two lines (`min-height: calc(2 * 1.3em)`, `text-wrap: balance`), so diagrams in a row line up.
- Files: cards.ts (`cardSvg`, the view per card kind), styles.css (`.play-card*`, `.mark-card*`, `.card`, the bar rules), tokens.ts (`paper`, `paperShade`, `inkSoft` out). Tests named in DESIGN.md Build delta 2.
- Asset: none.
- Verify: formation-cards.jpg and pass-cards.jpg retaken at 1440x900 and 1280x720. Cover the labels: can you still name Shotgun, Under center and Pistol from the diagrams alone? No two strokes merge at the center of any pass card.

**C3. Side glyph.** (UTL chunk 6.) A 24 px disc or X in your colors leading the situation line, 14 px before each call in the calls line and the rail. Files and tests as in DESIGN.md Build delta 6.

### D. Result moments and the broadcast layer

**D1. Every play ends with its number.** (New slot `fx.gain`. Needs a DESIGN.md change, a data change and Joseph's yes on the hold.)
- Problem: most plays end with no payoff on the field.
- Change: at the whistle a gain tag appears beside the ball's final spot: "+6", "-2", "No gain". From the same value the result line uses (`gainOf`). Shown for a run, a completion, a scramble or a sack that stands. Not shown for an incompletion, kneel, spike or kick (their own tags say it), nor when a banner or the big-play chip is on screen (the count-up is the gain). If the first-down chip shows too, the gain tag stacks above it, 4 px apart.
- Values: `color.tag` pill, `radius.pill`, 30 px tall, 10 px side padding, display 700 22 px tabular `color.line`, `shadow.toast`. 8 px right of the ball, left if it would leave the column. Pops in like the first-down chip (scale 0.92 to 1 with a fade, `dur.base`, `ease.out`). No color for gain or loss: the sign says it.
- The one timing change I am arguing for: `timing.holdMs` in data/ui/templates.json from 400 to 600 ms. Why: 400 ms is too short to register a number that pops in over 180. Cost, an estimate and not measured: with about 150 dead balls a game (the figure in DESIGN_HISTORY), 0.2 s each is about 30 s a game at 1x, half that at 2x, none on Skip. Space still ends the hold. The score hold (800) and every moment hold stay.
- Files: field.ts, moments.ts (the rule for when it shows), templates.json.
- Asset: none.
- Verify: playtester runs one full game at 1x before and after and reports the wall-clock difference. Captures of a 6-yard run, a sack and a first down: the number is readable at 1280x720 without pausing.

**D2. The rail carries the situation.** (A DESIGN.md "Still open" proposal. Needs a designer spec and Joseph, because it adds content to the play screen. It adds no choice.)
- Problem: a third of the play screen is empty for the whole play, and the down and distance is only in the bug's small type.
- Direction for the designer: the top of the rail holds this play's situation, stacked: the side glyph and the down in `type.plateDown`, the spot in `type.plateSpot`, the drive tracker at the rail's width with its drive line. Then "This play" and the calls. Keys stay at the bottom. Words on the stage, no surfaces. The values are the pre-snap ones and hold still through the play and the hold. No result in the rail: with a 600 ms hold nobody can read a sentence there, and the gain tag (D1) and the banners carry it.
- Files: app.ts, dom.ts, styles.css, layout.ts.
- Verify: play.jpg retaken at 1440x900 and 1280x720; at 1024x600 there is no rail and nothing changes.

**D3. The line to gain answers.** (New, small. Needs a DESIGN.md change.)
- On a first down (the same trigger as `moment.firstDown`), at the whistle the first-down line's core goes from 3 px to 6 px and back over `dur.tick` `ease.standard`, once. The casing follows. Not under reduced motion.
- Files: field.ts.
- Verify: capture of a first down; one pulse, in step with the chip.

**D4. The score moment is framed.** No new work: B2 puts the whole end zone in view, A2 removes the sheen from the banner, and the bug's odometer already lands on the banner's sub line. Verify with one touchdown capture after B2 and A2.

Later, with the designer: the touchdown banner's sub line could name the scorer ("Okafor 12-yd catch. Outriders 13, Cranes 7"). The result line already has the names, so it breaks no rule, but it needs a short-form sentence from text.ts. Not in this pass.

### E. New assets or audio

**E1. Sound.** (A new asset pipeline. Needs Joseph's OK before anything is fetched or built. DESIGN_HISTORY lists sound as "not asked for" twice, so this reverses a standing default.)
- Why: every other item here is something you see. A whistle, a thud and a tick do more for "feel" per unit of work than any of them.
- Scope, first pass: eight one-shots. No music, no crowd bed, no voice.

| Slot | Fires on | Character |
|---|---|---|
| `sfx.ui.move` | selection moves | a soft tick, very quiet |
| `sfx.ui.pick` | a pick or Enter | a soft click |
| `sfx.snap` | the snap | a short low thump |
| `sfx.catch` | `fx.catch` (B4) | a short pop |
| `sfx.contact` | `fx.contact` (B4) | a pad thud |
| `sfx.kick` | the foot meets the ball on a punt, kickoff or kick | a deeper thump |
| `sfx.whistle` | the whistle | one referee whistle |
| `sfx.score` | a banner's sub line appears | a short two-note rise, our own, not any network's |

- Rules: each sound fires from a timeline anchor that is an engine fact or from an input, never from guesswork. Nothing is told by sound alone; every one has its picture. At 2x sounds play at normal pitch and the UI and whistle sounds only. On Skip, the whistle only. Reduced motion does not mute. Audio starts after the first key or click, as browsers require.
- Source: recorded sounds under CC0 or a license that allows shipping in a public build, checked one by one, or recorded by Joseph. Not synthesized beeps: a square-wave blip is the audio version of the 8-bit look he rejected. The two UI ticks may be made in code if they are soft (a filtered noise burst under 40 ms).
- Format: mono, 44.1 kHz, each under 40 KB, in `packages/app/src/assets/audio/`, loudness matched (game sounds about 10 dB above the UI ticks). No CDN.
- Settings: one "Sound" row (Off, Low, On; default Low). storage.ts has six settings today, so this is the seventh; the designer confirms the Settings screen stays within seven choices.
- Paperwork: a docs/ASSETS.md row per file (source URL, license, AI use, date, sha256), the license text in the repo where the license asks for it, and art-director ACCEPT on each after hearing it at game speed against the others.
- Files: a new `packages/app/src/ui/sound.ts` (Web Audio), animator.ts (anchors), app.ts (input), storage.ts, the Settings screen.
- Verify: a capture with audio of one drive at 1x and 2x. No sound overlaps itself, none is louder than the whistle, and the game is fully playable muted.

**E2. Nothing else.** I am not proposing team logos (32 fictional marks is its own intake job), an icon set, a third typeface, or any texture. The diagram's own shapes (disc, X, arrow, tick, dot) cover every glyph the new surfaces below need.

### Top ten, in order

1. A1 selection (waits on Needs Joseph 4).
2. C1 field paint: the paint half now, the greens and the white line on Joseph's yes.
3. C2 chalk cards and readable diagrams.
4. A2 quiet chrome and the stage.
5. B1 the board grows into the field at the snap.
6. D1 the gain tag on every play, with the hold at 600 ms.
7. B2 the eased, end-zone-aware camera.
8. B3 and B4 together: the bigger ball with a height shadow, the catch ring and the contact ring.
9. D2 the rail carries the situation (designer first).
10. E1 sound (Joseph first).

After those: A3, A4, A5, B5, B6, C3, D3, A6. A7 is paperwork and should happen alongside item 1.

## What I am not proposing, and why

- Card shadows, glass or sheen back on the chrome: banned looks, and see "Does Under the Lights fit".
- Grass texture, noise or grain: banned, and the two stripes plus the shade do the job once they are built.
- Shake, squash, bounce, particles, confetti, light sweeps: banned. B4 gets impact from one ring.
- More gold, or team color on selection: gold stays the cursor.
- Red and green for gain and loss, good and bad: green is grass only and every other hue is a team.
- Green mini-field play cards, a lighter blue line of scrimmage, a landscape field, a play clock: all already considered and turned down in DESIGN_HISTORY.
- Any change to the live cap, throw pace, drops, tackler rule or moment holds.

## Proposed DESIGN.md changes

Nothing below is in DESIGN.md. Each needs the approval noted. If approved, DESIGN_HISTORY.md gets an entry saying what changed and why.

**P1. Marks, the Ball bullet (for B3).** Replace with:

> - Ball (`ball`): filled ellipse in `color.ball`, `max(5, 0.36 * markPx)` by `max(7, 0.5 * markPx)` px at flight scale 1, long axis up the field, 1.5 px `color.line` outline, `shadow.mark`. In flight its shadow tells the height: offset `2 + 10 * (scale - 1)` px and blur `6 + 8 * (scale - 1)` px, never less than `shadow.mark`. No laces. Always on top of marks and labels.

**P2. Field, Camera, the last two bullets (for B2).** Replace with:

> - The line of scrimmage sits about 70% of the way down the view at the snap, unless that would show more than the 1.35-yard margin past an end line; then the view stops at that margin.
> - It pans only to keep the ball at least `panSoftTopYards` (12) from the top edge and `panEdgeYards` (5) from the bottom. The camera eases toward that target with an exponential follow (`panFollowMs`, 180), so it never overshoots, and the ball is never closer than `panHardYards` (3) to an edge.
> - An end zone is in view whole or not at all: when the target would show more than 2 yards of one, the target shows all 10 yards and the margin behind it.
> - With reduced motion it cuts to the final target.

**P3. Motion, Play animation (for B4).** After "Key moments (catch, tackle, turnover, score) hold for a short beat." add:

> - Catch (`fx.catch`): when the ball passes to a named player after a flight or a loose ball (a completion, an interception, a recovery, as the PlayResult gives it), the ball-carrier ring without its glow closes on him from `markPx / 2 + 16` to `markPx / 2 + 6` while fading in over `dur.base` `ease.out`, holds 300 ms and fades over `dur.base`. Never on a snap, a handoff or an incompletion.
> - Contact (`fx.contact`): at the whistle, when the PlayResult names a tackler or a sacker, one ring at the ball's final spot grows from `0.75 * markPx` to `1.75 * markPx`, `color.line`, 2.5 px to 1 px, opacity 0.7 to 0, over `dur.slow` `ease.out`. Above paths, below marks. Once.
> - Neither is drawn under reduced motion or Skip.

And add `fx.catch`, `fx.contact`, `fx.gain` to the `fx.` line of "Art slots for future skins".

**P4. Motion, Moments table (for D1 and D3).** Add a row:

> | Gain (`fx.gain`) | a run, completion, scramble or sack that stands, with no banner and no big-play chip | Tag 8 px right of the ball's final spot (left if it would leave the column), above the first-down chip when both show | `color.tag` pill, 30 px tall, 10 px side padding, display 700 22 px tabular `color.line`, `shadow.toast`: "+6", "-2", "No gain". Pops in as the first-down chip does. The sign carries gain and loss, never a color | none: it fits the normal hold |

In the First down row, after "pops in (...)" add: "; the first-down line's core goes from 3 px to 6 px and back over `dur.tick` `ease.standard`, once".

In Layout, Play screen, replace "the play screen holds only about 400 ms after the whistle" with "the play screen holds only about 600 ms after the whistle".

**P5. Play cards, the Diagram bullet (for C2).** After "No team color: a card is the same for every team." add:

> Formation and package cards show 14 yards behind the line to 4 past it in a 160 by 84 box, so the backfield has the height; play and coverage cards keep 160 by 120. On a card, linemen are marks with no block path; backs and tight ends keep theirs. Every card label reserves two lines so the diagrams in a row line up.

**P6. Main menu, `menu.frame` (for A5).** Replace "width `min(1040px, 100vw - 64px)`" with "width `min(1200px, 100vw - 64px)`", and in `menu.splashArt` add "Its top lines up with the wordmark's cap line."

**P7. Layout, Calling screen, the Right column bullet (for A4).** After "no shadow." add: "In two columns it is as tall as the left column, so its bottom edge lines up with the board's, and the status line sits at its bottom."

**P8. Layout, Play screen, Rail item 1 (for D2, only after the designer's spec and Joseph's yes).** Replace with:

> 1. Top: this play's situation, stacked: the side glyph and the down in `type.plateDown`, the spot in `type.plateSpot`, the drive tracker at the rail's width with its drive line. The values are the pre-snap ones and do not change during the play or the hold. Then `type.label` "This play" and each team's call as before.

**P9. Field, Yard numbers (conditional, only if the C1 check fails).** Replace "inset 4 yards from each sideline as built" with "inset 6 yards from each sideline".

**P10. A new section "Sound" (for E1, only after Joseph's OK).**

> ## Sound
>
> Eight one-shots, no music, no crowd, no voice: `sfx.ui.move`, `sfx.ui.pick`, `sfx.snap`, `sfx.catch`, `sfx.contact`, `sfx.kick`, `sfx.whistle`, `sfx.score`. Each fires from an input or from a timeline anchor that is an engine fact. Nothing is told by sound alone. Recorded sounds, not synthesized tones; the two UI ticks may be made in code if they are soft. Mono, under 40 KB each, bundled locally. One Sound setting: Off, Low, On. At 2x only the UI sounds and the whistle play; on Skip only the whistle.

With it: the eight slots added to "Art slots for future skins"; in Banned looks, the retro line gains "square-wave or chiptune sound effects"; Asset intake item 3 gains "A sound is checked at game speed, against the other seven, at the Low setting."

**Not a DESIGN.md change:** `timing.holdMs` 400 to 600 (data/ui/templates.json) and the three camera keys (same file) are data. The camera keys are new keys in a validated data file, so they count as a schema change and need Joseph's yes.

## Direction for the surfaces that are coming

For the designers' specs on the draft room, standings, the bracket, the bigger playbook, route drawing and recommendation chips. These are direction, not rules yet. Each becomes a DESIGN.md section when its spec lands. All of them follow the three checks: lit field, loud facts, quiet chrome.

### Dense tables (draft room, standings, rosters, leaders)

- One sheet per table. Rows 36 px (dense) when more than twelve show, else 44 px. Cells in `type.note` (15 px), numbers tabular and right aligned. Header row in `type.small` 600 `chalkSoft`, sentence case, sticky on `color.surface` with a 1 px `hairline` under it.
- Dividers are 1 px `hairline`. No zebra stripes: alternating fills are the stack of boxes again.
- Every value is `chalk`. A stat is a fact, and `chalkSoft` is for help. Hierarchy comes from weight and order: the sorted column at 600, the rest at 400. The sort is shown by a small arrow drawn from the diagram's arrowhead, not by color.
- Up and down, good and bad: a sign and an arrow, never red and green. Ratings may add the existing 8 px `card.ratingBar` in `chalkSoft` beside the number.
- Team cells are the 12 px swatch plus the name. Your team's row carries the "You" pill and weight 600. Gold is still only the cursor: the selected line is `color.select` with the 3 px gold bar.
- At most eight columns at 1280 wide. Anything more is one key behind (D Details), which is the "near-sim but approachable" rule in practice.
- A table's rows are things to browse. The decisions on the screen (at most five) are rows of actions beside or under it.
- Standings: one sheet, divisions as groups under `type.label` headings. The playoff line is a 2 px `chalkSoft` rule with the words "Playoff line" at its right end. Clinch marks are letters in key-hint style with a legend, never colored dots.
- Draft room: the pick on the clock is a fact, so it goes in display caps on the stage above the table ("ROUND 2, PICK 37"), with the team's flat color block beside it. The board of prospects is the table. The prospect's detail opens as an overlay, the same component as the player card.

### Bracket

- Chalk on the stage. No sheet around the whole bracket.
- A matchup is a tile (`surfaceRaised`, `radius.md`, the play-card exception) holding two lines 36 px tall: seed in `type.small` `chalkSoft`, the 12 px swatch, the name in display 700 22 px, the score in display 700 22 px tabular at the right.
- The winner's line is weight 700 with a 3 px bar of the team's fill on its left edge (with the tier's inset ring). The loser's stays `chalk` at 600. Never dim a result to `chalkSoft`.
- Connectors are the diagram's handwriting: 1.5 px `chalkSoft`, round joins, elbows with a 6 px radius. Your team's path so far is 2 px `chalk`.
- Rounds are columns with `type.label` headings. Two conferences mirror toward a center final when the window is at least 1160 px of content; otherwise one conference at a time.
- The selected matchup is `color.select` with the gold bar. The champion gets a flat team block with the name in `type.screenTitle`, in the slot's outline color.
- Nothing about it may follow a real league's or network's bracket graphic.

### Play-diagram cards (the bigger playbook)

- One component, `card.play`, at three sizes. Small (160 px art) on the call sheet. Medium (240 px) in a playbook grid. Large (400 px and up) on a play's detail view.
- Strokes scale with the size and stay uniform inside a card: 1.5, 2 and 2.5 px. Marks 8, 11 and 16 px. Chalk only: `chalkSoft` at rest, `chalk` when selected.
- C2's rules hold at every size: the formation crop, no lineman block paths at the small size (they may return at the large size, where there is room), two reserved label lines.
- At most seven cards on a screen. A bigger playbook pages by family; it does not scroll. The page shows as "2 of 4" in `type.small` with left and right key hints.
- No ball, no target and no result on a card, as today. A card never shows a primary read unless the engine has one before the snap.

### Routes drawn on the field

- A drawn route uses the offense route spec exactly: the team fill 3 px over the ring color 5.5 px, round caps and joins, an arrowhead at the end. On grass it is in your colors; on the play's card it is chalk.
- While drawing: the segment from the last point to the pointer is the same stroke at 60% opacity. Each placed point is a 6 px dot in the fill with a 1.5 px ring. The point being moved takes the focus ring (2 px `color.line`, no glow).
- Points snap to whole yards. Corners are drawn with the same rounding the animation will run (motion.json `fillet`), so the line you draw is the line the mark runs.
- Depth is told in words on a tag by the pointer ("12 yds"), `color.tag` pill, Inter 600 14 px.
- A segment that is not allowed is not drawn. A tag by the pointer says why in words ("Out of bounds"). Never a red line.
- The designer must settle one thing with the engineer before any of this is drawn: whether a drawn route changes what the engine resolves. If it does not, the screen must not suggest that it does.

### Recommendation chips

- A recommendation is not a selection. It must not use gold, a fill on the row, or a bar.
- The chip: a pill at the right end of the row or the top right of a card. 22 px tall, 8 px side padding, `surfaceRaised` fill, 1 px `hairlineStrong`, `type.small` 600 `chalk`. Words, not an icon: "Coach's pick".
- At most one per screen. If a second tier is ever wanted ("Also good"), it is the same chip with no edge, and still at most two chips in all.
- The reason is one step behind and in words: when the recommended row is selected, the status line under the rows gives it, from factors the model used and nothing else. A number shows only if the model produced one ("+3% win chance", tabular, `chalk`).
- It does not move, pulse or glow. It arrives with the rows.

## How to verify the whole pass

- Retake the same eight screenshots at 1440x900 after each chunk, and the calling, cards and play screens at 1280x720.
- Add the views that were missing this time: a snap at the opponent's 10, the last frame of a touchdown with its banner, a first down with its chip, mid-flight on a deep pass, the pregame face-off, halftime, the player card, the details sheet.
- For the field chunk: normal, grayscale and the three simulations, as DESIGN.md "Still open" already asks.
- Short captures (2 to 5 s, 60 fps) for B1, B2, B4, B5, D1 and D3, at 1x and 2x.
- art-director reviews each chunk on those files before the next chunk starts. code-reviewer and test-writer check the code, as CLAUDE.md says.

## Open questions for Joseph

1. **The four "Needs Joseph" items in DESIGN.md** (deeper turf with visible stripes; the near-black stage; a white line of scrimmage instead of blue; a smaller gold highlight with no ring or glow). Nothing is recorded as answered. Default: yes to all four. Until you answer, the paint half of C1 and the unboxing half of A2 go ahead, because neither waits on you.
2. **Sound.** OK to open an audio pipeline? Default: yes, eight recorded one-shots, no music or crowd, a Sound setting that starts on Low.
3. **The whistle hold, 400 to 600 ms**, so the gain tag can be read. Default: yes. My estimate is about 30 s more per game at 1x; the playtester measures it before it is kept.
4. **The rail carries the situation during the play.** Default: yes, and the designer writes the spec first.
5. **Three new camera keys in data/ui/templates.json** (a schema change to a UI data file). Default: yes.
6. **Chrome depth.** Once A2 is built, if the one flat sheet reads plain to you, do you want a soft lift on it? Default: no change now. Decide on the retaken calling screenshot. If yes, the fallback is a single 1 px top edge at rgba(255, 255, 255, 0.10) on the sheet and on overlays, nothing else, and I would write it up as a rule change with its figures.
7. **The AI-use wording in docs/ASSETS.md** for everything drawn in code. Default: "Drawn in code by Claude Code agents from DESIGN.md, reviewed by art-director", on every such row.
8. **The empty board on the Play type screen.** Before you pick a formation the board shows a field and a ball. Default: draw both teams in their huddles there, as the formation screen already does for the other team. It adds no choice; the designer confirms it against the calling-screen spec.
