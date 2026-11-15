# M2 usability pass: colors, menus, quality of life

Status: draft, revision 1, 2026-11-14. Owner: Joseph. Author: designer. Branch: m2/playable.

Scope: a polish pass over the screens that already exist. No new game systems, no new engine data, no schema change. Baseline is the working tree on 2026-11-14, including the uncommitted player card ratings table and the overall shown beside each jersey number.

P1 means it ships in this pass, and the P1 set is sized for one engineer sitting. P2 is nice to have and can wait. Final means decided here. Open means waiting on Joseph, art-director or the debugger.

## Problem

Joseph played from the main menu to the first snap at 1280x720 and couldn't read the game at a glance. Here is what he saw and what causes it in the code:

1. The two team swatches in the top bar and on pregame were the same dark red-brown. Cause: `tokens.ts` `swatchFor(index)` takes one of 8 placeholder colors by league index, with no check against the opponent. Five of the 8 are dark reds or dark slates, so near-matches are common.
2. Before the snap, the opponent is a ring of X's around the ball. That ring is the huddle (`art.ts` `huddleSpots`), which Joseph chose on 2026-11-14: they stay in the huddle until your last key. At 1280x720 it is a 6-yard circle centered 6 yards past the ball. Nothing labels it, and it sits where linebackers line up, so it reads as a broken formation.
3. Marks show labels like "36 65": the jersey number and the overall, same font, same color, one space apart (`marks.ts` `placeNumbers`). Nothing says which number is which, and the 5-character label crowds along the line.
4. Menu headings repeat themselves: "Offense: Formation: Formation", "Offense: Run: Formation, Shotgun, Run". Cause: `app.ts` `gamePanel` prints `title(m)` and then `breadcrumb(m)`, and the breadcrumb includes navigation picks ("formation", "run") that the title already names.
5. The kickoff ran with nothing visible on the field, then the report said there was a return. Confirmed by reading the code: (a) no screen before a kickoff draws either unit, because `updatePreview` only runs for `offenseCall`, `try` and `defenseCall`; (b) after any change of possession, `idleField` calls `animator.idle(scene, false, ...)`, which drops the whistle frame. Not confirmed: why the live kick itself showed nothing. Templates and `onField` exist for kickoffs, so this goes to the debugger (see U8).
6. The whole look is low contrast. The field, the overlay and the side margin are all `color.paper`, so the menu is a paper box on a paper field. Text is gray on cream. Selected, off and important items differ by one fill step (`paper` to `paperShade`, 1.15:1). The top bar has a 22 px score and lots of empty space.
7. The panel at 1280x720 is a small box at the top of a 537 px empty paper margin (`overlay.ts` side placement grows only to fit its content). Base text is 16 px.
8. Off rows differ from on rows only by text color (ink 13.5:1 against inkSoft 5.5:1, both dark on cream).
9. During the play the only help is "Space: skip. S: speed (1x)." in chalkSoft at the far right of the top bar.

Other gaps I found in the code:

10. `styles.css` defines `.card` twice: once for the player card (line 321) and once for play cards (line 382). The second wins, so the roster player card gets the play-card button styles.
11. "New game" on the title screen overwrites an existing autosave at the first step (`persist`) without saying so.
12. The Controls screen leaves out M (player cards) and the arrow keys on card grids.
13. Suspected, not confirmed: after a change of possession, `restoreLast` can redraw the previous play's frame in the old orientation, because `last` survives `idle()`. Goes to the debugger with item 5.
14. Out-of-date copy. The box score says "Challenges aren't in the game yet." M2 G built challenges. Halftime and the box score say "the engine doesn't name the players in each play yet." M2 B names them.

Already fine, no work: settings (text size, motion, labels, speed) persist in localStorage (`storage.ts`), and keyboard focus follows the highlighted row (`render`).

## User

There is no `docs/research/personas/` folder, so I can't point to a persona. I'm using the same assumption as the M2 design: Joseph and players like him. They know football, play on a landscape laptop, use the keyboard first, and play about 150 dead balls a game.

Assumption that carries decisions: **at gameplay speed the player reads the field and the panel in under a second, and doesn't study them.** Every choice below favors something you can spot at a glance (value contrast, size, position) over something you have to read (a word, a hue). Test: at the next playtest, Joseph plays 20 dead balls, and I note each time he asks "which one is selected", "is that off" or "which team is that". The pass works if he asks none of them.

## What the viewer reads first

- **While calling:** (1) the scoreboard: score and clock, the largest text in the top bar; (2) the result and why lines at the top of the panel, which say what just happened; (3) down and distance, the largest text in the panel, which every call depends on; (4) the menu heading, then the highlighted row, which is an inverted paper bar on the dark panel and the strongest contrast in the panel.
  - Why this order: DESIGN.md Layout already says "what happened, why, then the next call". Today's `gamePanel` puts down and distance above the result, which breaks that order. U5 puts it back.
- **During the play:** the field, then down and distance and the clock in the top bar, then the key chips. The chips are the smallest and are read once, then remembered.
- **Pregame and other screens:** the screen title, then the body, then the rows.

## Decisions

Each item gives what to build, why, what I rejected, and the files.

### U1. The side column and every menu overlay become the dark board (P1)

- **What:**
  - The panel's surface changes from translucent paper to opaque `color.panel` (#1F2A30), with `color.chalk` text. The top bar already uses these colors.
  - In side mode (`layout.side !== null`, which includes 1280x720), the panel fills the whole side column: `left = side.left`, `top = field.top`, `width = side.width`, `height = field.height`. It has no margin and no border.
  - In floating mode (narrow windows), the panel keeps today's placement rules, with a 1 px `color.chalkSoft` border.
  - The canvas paints everything outside the field column (`column.left` to `column.left + column.width`) in `color.panel`. So during the live play, when the panel is hidden, the side column stays dark instead of flashing to empty paper.
  - Paper stays for the things that are cards: the player card over a mark (`.mark-card`), the play-card tiles and the roster player card. They read as paper sheets on the board.
- **Why:**
  - The field is approved paper and can't change. So the UI has to separate itself from the field by value.
  - The dark board uses the existing `panel` and `chalk` tokens, gives chalk text 13.1:1, and makes selection an inversion (see U2), which is the clearest flat cue there is.
  - It also turns the top bar and side column into one frame around the field.
- **Rejected:**
  - Keeping a paper panel with a stronger border: the 537 px side column stays a cream block the same value as the field, and selection still relies on a 1.15:1 fill step.
  - A translucent dark panel: nothing to gain over opaque, and harder to keep 4.5:1.
  - A light/dark theme setting: a feature, not polish.
- **Files:**
  - `styles.css`: the panel, rows, tables, bars and `.soft`.
  - `overlay.ts`: `overlayBackground()` returns `COLOR.panel` and `OVERLAY_ALPHA = 1`. `placeOverlay` side branch: full bleed, plus a new `fill: true` field on `Placement` so the app sets `height`, not only `max-height`.
  - `app.ts` `position()`: sets the background on the panel only. The mark card keeps its CSS paper.
  - `field.ts` `drawField`: fill paper only across the column, panel color outside it.
  - `layout.test.ts`: the contrast check becomes chalk and chalkSoft on panel.
- **Sign-off:** the "full-screen field" amendment text says the overlay "is translucent paper over the field". See "Needs Joseph's sign-off", item 2.

Styles on the panel (all sizes are `calc(N px * var(--text-scale))`):

| Element | Style |
|---|---|
| Panel base text | 17 px, `chalk`, line-height 1.4, padding 16px 20px |
| `.soft`, `.calls`, `.event`, `.status`, `.hint` | `chalkSoft` |
| `h1` (screen title) | 24 px, 700 |
| `h2` (menu step heading, U3) | 18 px, 700, margin 14px 0 4px |
| `.so-far` (U3) | 15 px, `chalkSoft` |
| Divider between the report and the call section | 1 px `color.panelRaise` (new token), margin 12px 0 |
| Tables (box score, roster) | `chalk` text. Header row `chalkSoft` 14 px 600. Selected roster row: `paper` fill, `ink` text (same as U2) |
| Bars on panel (pregame units, loading) | track `panelRaise`, fill `chalkSoft`, value always printed beside the bar |
| Swatch outline on panel | 1 px `chalkSoft` everywhere (delete the `.matchup .swatch`, `.box .swatch`, `.panel .swatch` inkSoft override) |
| Footer (`.panel-foot`, U7) | pinned at the bottom of the side column (`margin-top: auto` in a flex column), 1 px `panelRaise` top border, 14 px |

Fix item 10 here: rename the play-card class to `.play-card` (with `.play-card-label`, `.play-card-art`, `.play-card-personnel`) in `styles.css` and `app.ts` `cardGrid`. `.card` stays for the player card: `paper` background, 1 px `ink` border, `ink` text.

### U2. Menu rows: selected, off and focus that read at a glance (P1)

Each row has a key chip and a label.

| State | Row | Key chip | Note and reason text |
|---|---|---|---|
| On | transparent, `chalk` 18 px | 1 px solid `chalkSoft` border, radius 3 px, `chalk` mono 600 15 px, min-width 2.6em, centered | `chalkSoft` |
| Highlighted (keyboard highlight or hover, which share one state) | `paper` fill, `ink` text, label weight 700 | border `ink`, text `ink` | `inkSoft` |
| Focus-visible | as highlighted, plus a 2 px `chalk` outline at 2 px offset (a ring of panel shows between the fill and the outline) | | |
| Off | transparent, `chalkSoft` text, `cursor: not-allowed` | 1 px dashed `chalkSoft` border, `chalkSoft` text | reason in `chalkSoft`, as today: "(4th down or last 2:00 only)" |
| Off and highlighted | no fill, 2 px dashed `chalkSoft` outline at -2 px offset; the reason also shows in the status line | dashed | `chalkSoft` |

Row box: `min-height: 40px`, padding 8px 10px, gap 12px, radius 3 px. Seven rows at 100% take about 300 px.

Play-card tiles (the `.play-card` grid):

- On: `paper` tile with a 1 px `paperShade` border.
- Highlighted or focused: a 3 px `chalk` outline at 2 px offset, and the label strip filled `paperShade`.
- Off: the tile is filled `paperShade`, the label is `inkSoft` and the reason is in words, and the art draws at 50% opacity. Opacity is never the only cue, because the fill and the words are there too.

- **Why:**
  - Highlighted against on goes from 1.15:1 (paperShade against paper) to an inversion: the row becomes a paper bar, 13.1:1 against the panel.
  - Off rows now differ three ways: lighter text, a dashed chip and the reason in words. That holds in grayscale and for color-blind players.
  - An off row that is highlighted never gets the paper fill, so "selected but off" can't pass for "selected".
- **Rejected:**
  - Hiding off rows: design decision 9 keeps the numbers fixed.
  - Strikethrough on off rows: it makes the reason, which teaches the rule, harder to read.
  - A signal-colored focus ring: `signal` means game state (possession, the 2:00 clock, flags). Using it for focus would weaken that meaning.
- **Files:** `styles.css` (`.row*`, `.play-card*`), `app.ts` `rowButton` (no markup change beyond the chip classes; `aria-disabled` stays).

### U3. Menu headings: the step name, plus "So far" only when it adds something (P1)

- **What:**
  - The `h2` shows only the step name, from a new `TITLES` map in `menu.ts`. "You're on offense" already sits right above it, so the "Offense:" prefix goes.
  - A separate line under the heading, `So far: <picks>`, shows only the picks made on `offense.formation` and `offense.try`. It is left out when empty.
  - `breadcrumb()` keeps `picks[i]` only where `screens[i]` is one of those two screens. `picks[i]` is the pick made on `screens[i]`.

| Screen id | Heading |
|---|---|
| `offense.playType` | Play type |
| `offense.playType.try` | Two-point try: play type |
| `offense.formation` | Formation |
| `offense.playClass` | Run or pass |
| `offense.run` | Run plays |
| `offense.pass` | Pass plays |
| `offense.kick` | Kick |
| `offense.clock` | Clock and tempo |
| `offense.try` | After the touchdown |
| `kickoff` | Kickoff |
| `defense.package` | Defensive package |
| `defense.base` / `.nickel` / `.dime` | Base plays / Nickel plays / Dime plays |
| `defense.specials` | Specials |
| `continue`, `penalty`, `runoff`, `challenge`, `toss`, `overtimeToss` | unchanged |

Examples: "Run plays" with "So far: Shotgun". "Pass plays" with "So far: Go for two, Shotgun". "Nickel plays" with no So far line. "Formation" with no So far line.

- **Why:** each heading answers one question, "what am I picking now". The one earlier pick that changes the meaning of the rows (which formation) shows once, labeled.
- **Rejected:** a full breadcrumb trail with separators. It adds characters to read on every one of about 150 calls, and the trail is already one Esc away.
- **Files:** `menu.ts` (`TITLES`, `breadcrumb`), `app.ts` `gamePanel` (render `h2` and `p.so-far` separately). `menu.test.ts` needs updating.

### U4. Team swatches always differ within a matchup (P1)

- **What:**
  - Replace `SWATCHES` with 8 placeholders in two lightness tiers and five hue families (below).
  - Add `matchupSwatches(awayIndex, homeIndex): { away: string; home: string }`:
    - away = `SWATCHES[awayIndex mod 8]`;
    - home = the first `SWATCHES[(homeIndex + k) mod 8]`, for k = 0 to 7, that is in a different family from away and has a luminance ratio of at least 1.4 against it (computed with `overlay.ts` `contrast()`).
  - Every call site (`app.ts` lines near 1285, 1294, 1453, 1567, 1575) uses the pair, not `swatchFor`.
  - The swatch grows from 10 px to 14 px.

| Slot | Hex | Family | Tier | On panel (hand-computed) |
|---|---|---|---|---|
| 0 | #D9443A red | red | mid | 3.39 |
| 1 | #6FA8E8 sky | blue | light | 5.92 |
| 2 | #3A9A4A green | green | mid | 4.14 |
| 3 | #C9CED2 silver | neutral | light | 9.28 |
| 4 | #9A5CC8 purple | purple | mid | 3.32 |
| 5 | #8CC85A lime | green | light | 7.38 |
| 6 | #279490 teal | blue | mid | 4.01 |
| 7 | #F59A8C salmon | red | light | 6.93 |

The lowest pair across tiers that passes the rule is sky against green, 1.43. Red against green fails at 1.22, so the rule never pairs the two colors most often confused under red-green color blindness. No swatch is amber or orange-brown, so none can be mistaken for `signal` or `defense`.

- **Why:** a swatch exists to tell the two teams apart at a glance. Hue alone fails for color-blind players, and lightness alone fails for everyone else. Requiring both a different family and a lightness gap holds in grayscale too. The name is always shown, so the swatch is never the only cue.
- **Rejected:**
  - Hand-assigning one color per team in data: that is art-director's real team-color job, and it still needs a clash rule.
  - Mixing the hash of the two names: not reproducible by eye and still collides.
- **Cost:** a team's swatch can change with its opponent. That's acceptable for placeholders. Art-director sets real team colors later, with a primary and an alternate.
- **Files:** `tokens.ts`, `app.ts`, `styles.css` (`.swatch` 14 px). DESIGN.md is updated in this revision.

### U5. The top bar is the scoreboard (P1)

- **What:** the bar stays 48 px high (`layout.ts` `TOP_BAR` doesn't change, so the 800x520 layout tests hold). Contents, left to right:

1. Away team: swatch (14 px), nickname in sentence case 16 px 700 (no longer uppercase: shorter, so it fits), "(you)" in `chalkSoft` 14 px when it applies, score in mono 28 px 700, timeout pips, then the possession dot and "ball".
2. Home team: the same.
3. Divider (1 px `panelRaise`, 24 px tall).
4. Period 16 px 600, clock in mono 24 px 700 (`signal` plus "under 2:00" late in a half, as today), clock state in `chalkSoft` 14 px, tempo when not Normal.
5. Divider.
6. Down and distance: `situationText(hudState)` in mono 18 px 700 `chalk` ("3rd & 4 at OPP 38", "Kickoff", "Try"). Hidden at Final.
7. Right-aligned (`margin-left: auto`):
   - while calling: `[Esc] Menu`;
   - during the play: `[Space] Skip  [S] Speed 1x  [M] Player card`.
   - Key chips are `<kbd>`: 1 px `chalkSoft` border, radius 3 px, mono 13 px, padding 0 5px, label `chalk` 14 px.

- **Overflow rule:** the bar never clips a score, the clock or down and distance. When the content is wider than the window, drop parts in this order:
  1. the chip labels ("Skip", "Speed", "Player card"; the keys stay);
  2. the clock state word;
  3. the word "ball" (the dot stays, and the possession dot gets `aria-label="has the ball"`).
- **Why:**
  - Score, clock and down and distance are what Joseph said he couldn't find.
  - During the play the panel is hidden, so before this the bar was the only place left for game state, and it didn't show down and distance.
  - Down and distance in both the bar and the panel header is on purpose: the bar shows it in every phase, and the panel shows it larger where the call is made.
- **Rejected:** a taller bar (it costs field length and breaks the minimum-window tests); moving down and distance out of the panel (art-director decision 4 keeps it where the eye is while calling).
- **Files:** `app.ts` `renderTopBar`, `styles.css` `.top-bar*`, `text.ts` (no change, reuse `situationText`).
- **Panel order fix (same item):** `gamePanel` renders the report first (result, why with the D hint, calls, events), then the divider, then the situation header (down and distance at 26 px mono 700, side text in `chalkSoft`), then the menu. This matches DESIGN.md Layout.

### U6. The huddle reads as a huddle (P1)

What the screen shows before your last key, with the opponent's call unknown:

- **Your side:** lined up for the focused formation or package, as today.
- **Their side:** a horseshoe huddle well clear of the line, labeled "Huddle".

Geometry, in `art.ts` `huddleSpots`:

- Compute the ring for `count + 1` places, with the same chord rule as today: (markPx + markGapPx) / pxPerYard.
- Leave empty the one place that points straight at the line of scrimmage. The opening faces the ball.
- The angle of place i is θ0 + 2πi/(count + 1), with θ0 chosen so that place 0 points at the line, and place 0 is skipped.
- Centers move in `data/ui/motion.json`: `huddle.offenseBehind` 7 to 9, `huddle.defensePast` 6 to 10. These are designed values, tuned in playtest. The end-line clamp stays.
- At 1280x720 that is 11 marks on a 3.3-yard radius. The nearest X is about 7 yards past the line.

Label, in `field.ts` `drawFrame`:

- The text "Huddle", in `font.ui` 600 at 14 px x textScale, color `inkSoft` (5.5:1 on paper). It goes 1 yard right of the horseshoe's right edge, vertically centered on it. Amended 2026-11-14 (playtest: at 1st & 10 the defense huddle's center sits on the line to gain, and the label overlapped the dashed line): the label never sits on the line of scrimmage, the line to gain, a goal line or a mark. If the first spot is taken it steps up or down by one label height, then tries the left side, then above or below the horseshoe (`marks.ts` `placeHuddleLabel`); with no free spot it isn't drawn.
- New slot `field.huddleLabel`.
- It is drawn only in still Calling frames (`tl.setAt === Infinity`) when the frame has huddle marks. In a timeline the huddle breaks within 450 ms, so it needs no label there.

- **Why:**
  - A ring around the ball reads as an alignment. A horseshoe opening toward the ball, set back past linebacker depth, is the shape football players know as a huddle.
  - The word removes the remaining doubt for anyone who doesn't know the shape.
  - Nothing here depends on their call, so the "no leak before the snap" test (P1 in the play-calling spec) still passes unchanged.
- **Rejected:**
  - Hiding their marks until the snap: 11 marks appearing from nowhere breaks the "live" reading Joseph asked for.
  - A neutral generic defense: it implies an alignment the engine didn't decide.
  - Drawing the huddle at reduced opacity: it reads as disabled, not as waiting.
- **Files:** `art.ts`, `data/ui/motion.json`, `field.ts`, `templates.ts` only if the motion schema validates value ranges. `art.test.ts` (huddle at 1024x600 without overlap) must still pass.

### U7. Mark labels: one number per mark, the overall by default (P1, final)

Decided by Joseph, 2026-11-14: each mark shows one label, the player's overall. The setting switches it to the jersey number. The "both" mode in revision 1 (number plus a small gray rating) is removed.

- **What:**
  - Replace the `ratingLabels: boolean` setting with `labelContent: "rating" | "number"`, default "rating". Migrate in `loadSettings`: a saved `labelContent` of "both" becomes "rating"; legacy `ratingLabels: true` becomes "rating" and `false` becomes "number"; anything missing gets the default.
  - Settings row 4 becomes "Mark label shows", with the note "Overall rating" or "Jersey number". The row toggles between the two.
  - Drawing, in `marks.ts` `placeNumbers` and `field.ts`: one label per mark, in the mark's side color, mono 600 12 px (the jersey number's size, weight and place). `rating` draws the overall there; `number` draws the jersey number. `NumberBox` carries `number: string`, the label as drawn.
  - Legend: the panel footer (U9) always carries a line saying what the labels are: "Mark labels: overall ratings" or "Mark labels: jersey numbers".
  - The player card keeps the jersey number in its header, so a mark still ties to the name in the result line ("#9 I. Whitlock") through the card (hover or M).
- **Why:**
  - Joseph wants the overall on the field by default.
  - One label per mark is DESIGN.md's rule, and two same-style numbers side by side can't be told apart without a key.
  - The legend names which number is shown.
- **Rejected:**
  - Number and rating together ("both", revision 1): two numbers per mark crowd the line and need size and color to tell apart.
  - A "#" prefix on numbers: costs a character per mark.
- **Files:** `storage.ts`, `screens.ts` `settingsScreen`, `app.ts` (`frameOpts`, `act` case), `field.ts`, `marks.ts`. Update `layout.test.ts` line 241.

### U8. Kickoffs are visible from the lineup to the whistle (P1)

What the screen must show:

1. **Before the kick:** both units lined up, from the moment the dead ball before a kickoff shows. That covers the "They kick off" screen (`continue` with `theyKickOff`) and your own Kickoff screen.
   - Kicking team (O's, attacking up) from `templates.kick.kickoff`, return unit (X's) from `templates.returnUnits.kickoff`, at the kickoff spot, with the camera at the usual line position.
   - Display only: the slots come from the template keys (K1, LB1 and so on) with generic ids (`own:` and `huddle:` prefixes, so no numbers show and hover skips them).
   - It needs no engine data: kickoff units are public before every kick, and the alignment says nothing about the result.
   - Build it as a `kickoffFrame()` next to `callingFrame` in `presnap.ts`, and show it from `updatePreview` for these two request kinds.
   - Because the live timeline lines up the real players on the same template spots, the cut from still frame to animation doesn't move any mark.
2. **The kick:** the kicker's approach, the ball's dotted flight with the camera following it (the existing `panCamera`), the returner moving to the catch, then the return, the tackle and the whistle frame with the existing labels (Touchback, Fair catch, Out of bounds).
3. **After the whistle:** the whistle frame holds for the timeline's hold, then crossfades to the new possession's frame. Once the possession has flipped, the old frame never comes back (item 13).

For the debugger, before anything is built: find why the live kickoff showed nothing at 1280x720 (seed in the game log). Candidates I couldn't rule out from the code:

- (a) a Space key repeat from the Continue press reaching `animator.skip()`;
- (b) the camera start for a kickoff spot;
- (c) `onField` slot positions not matching the kick templates.

Also confirm or rule out item 13 (`restoreLast` after a flip).

- **Why:** the first live play of every game is a kickoff. If it shows nothing, the new player's first impression is a broken field.
- **Rejected:** a text-only kickoff ("Kickoff, returned to the 28") with no animation. That gives up the clipboard picture for the play that opens every game and half.
- **Files:** `presnap.ts`, `app.ts` `updatePreview`, `animator.ts` (`restoreLast` and `idle` clear `last` when the possession frame changes), plus whatever fix the debugger finds.
- **Open:** whether the engine should put the real kickoff lineups in the request, so the pre-kick marks carry jersey numbers. That is a shared type change and needs Joseph's go-ahead. It is not in this pass.

### U9. Keys you can see, and two small safety fixes (P1)

- **Panel footer** (`.panel-foot`), on game screens: `[Arrows] Move  [Enter] Pick  [D] Details  [M] Player cards`, then the label legend from U7.
  - On card grids, "Arrows" covers the grid. The footer isn't made of choices. Its keys are field and accelerator keys, so the 7-choice count doesn't change (same reasoning as the D hint in the M2 design).
  - On other screens the footer shows only `[Esc] Back` and `[Enter] Pick`.
- **Controls screen** (`app.ts` `screenBody` "controls"): add rows for "M: player card for each mark in turn; Esc or Enter closes it", "Arrows: on play cards, move across and down the grid", and "Space: continue a dead ball".
- **New game with a save:** when `hasSave`, the title row reads "1 New game (replaces your saved game)", as a note. It is not a confirm step: it is one fact, one time, and a confirm would cost a key on every new game.
- **Out-of-date copy (item 14):**
  - Delete "Challenges aren't in the game yet." If `TeamBox` has no challenge counts, drop the "Challenges won-lost" row, and don't show a dash for data that exists elsewhere.
  - Change "No player stats yet: the engine doesn't name the players in each play yet." to "No player stats yet."
- **Files:** `app.ts`, `screens.ts`, `styles.css`.

### P2 (nice to have, not in this pass)

- **P2-1 Replay the last play, key R.** Replays `animator.last` in its own frame, then goes back to the current frame with no crossfade. It never touches the clock override, the state or the live region, and it is off when no play exists. The key goes in Controls and the footer.
- **P2-2 Key L toggles mark labels** between number and rating on the field, and persists like a setting.
- **P2-3 Live content in the side column during the play** (side mode only, where it covers no field): "Your call: Shotgun, Short pass" plus the key chips. This needs `overlaysShown` to take the layout mode. The no-overlay-over-the-field rule still holds.
- **P2-4 Fixed report height** (DESIGN.md Layout already asks for it), so rows don't move between plays: min-height of 5 lines at the current text scale.
- **P2-5 Keyboard focus on a card or row shows its description in the status line,** as hover already does for cards.
- **P2-6 S works on call screens too** (cycles the saved speed, with a status line).
- **P2-7 "Delete save" asks once:** the row label becomes "Press 2 again to delete", for 3 seconds.
- **P2-8 Public lineups for their punt and field goal** on the `theyLineUp` continue screens, built like U8.
- **P2-9 Returned kicks get a whistle label at the dead spot,** "Returned to OWN 28", from `play.end` only.

## States

| State | What shows | Status |
|---|---|---|
| Loading data | Dark side column with "Loading league data", a progress bar (track `panelRaise`, fill `chalkSoft`) and "N of M files". The field column is empty paper. | Final |
| Data error (fatal) | Dark column, `h1` title, message in `chalkSoft`. No rows. | Final |
| Title, no save | Rows: New game, Continue (off: "no saved game", dashed chip), Settings | Final |
| Title, save exists | "New game (replaces your saved game)" | Final |
| Storage blocked (permission denied) | Continue off with "saves aren't available in this browser window"; the status line says the game can't be saved. Play continues. | Final (unchanged) |
| Pregame, matchup loading | "Drawing a matchup..." in `chalkSoft` | Final |
| Pregame, matchup ready | Two teams with different swatches (U4); unit bars on the dark panel | Final |
| First call of the game | Empty field, ball on the spot. Your lineup once armed. Their horseshoe huddle labeled "Huddle". Report says "No plays yet." | Final |
| Calling, highlighted row on | Paper bar, ink text | Final |
| Calling, highlighted row off | Dashed outline, no fill, the reason in the status line | Final |
| Before a kickoff (theirs or yours) | Both kickoff units lined up, no numbers | Final, pending the debugger's finding |
| Live play | Panel hidden; side column dark (canvas); top bar shows down and distance plus the Skip, Speed and Player card chips | Final |
| Player card open during play | Paper card in the side column, animation paused, top bar chips unchanged | Final (unchanged) |
| Whistle after a change of possession | Whistle frame for the hold, crossfade to the new frame, and the old frame never redrawn | Final |
| Sim error | Dark column, copy, restart and title rows | Final (unchanged) |
| Window too small | Unchanged | Final |
| Text at 200% | Side column scrolls. The footer stays pinned (sticky bottom). The top bar applies the overflow rule. | Final |
| Reduced motion | Huddle and lineups cut, no crossfade. Same as today. | Final |

## Accessibility baseline

- **Contrast** (WCAG 2.x, hand-computed from the hex values with the method in DESIGN.md, then rechecked by a test, AC 1 to 3):
  - chalk on panel 13.1; chalkSoft on panel 6.9 (off rows, reasons, secondary text); ink on paper 13.5 (highlighted row); inkSoft on paper 5.5 (notes on the highlighted row, the Huddle label); inkSoft on paperShade 4.6 (off card labels).
  - The chalk focus ring on panel is 13.1. chalkSoft bar fill against the panelRaise track is 5.4. Swatches on panel are 3.31 to 9.25, all at least 3:1.
  - panelRaise dividers on panel are 1.28. They are decorative and never the only separation.
- **Not color alone:** selected is an inverted fill plus a focus ring. Off is a dashed chip plus words. Teams are swatch plus name. What a mark's number means is in the footer legend. The huddle is shape plus a word.
- **Keyboard:** no new key is required to play. Focus stays on the highlighted row (today's `render` behavior). Footer keys are visible text, so screen readers read them.
- **Screen readers:**
  - The possession dot keeps "ball" or gets `aria-label="has the ball"` when the word is dropped.
  - Pip groups keep their counts.
  - `<kbd>` chips are plain text inside the footer.
  - The live region is unchanged, and the huddle label isn't announced (the canvas is `aria-hidden`).
- **Text scale:** every new size uses `var(--text-scale)`. The top bar overflow rule and the side column scroll keep 200% readable.
- **Motion:** nothing new animates.

## Model output: the why line and the engine's text

Nothing in this pass changes what the engine says or adds anything it didn't decide. "No explanation for this play." stays the fallback when the engine has no headline. The kickoff lineup (U8) and the huddle (U6) are template drawings that carry no information about the result. Their marks carry no numbers, so they can't imply who made the play. If the engine's text is wrong, the player still has D (the trace) and "Copy details" for a bug report, as today.

## Acceptance criteria

Unit-testable (test-writer):

1. A test recomputes every contrast figure quoted in this spec and in DESIGN.md's updated contrast checks from the hex values, using `overlay.ts` `contrast()`, to within ±0.05.
2. `layout.test.ts`: chalk and chalkSoft on `overlayBackground()` are at least 4.5:1, and `overlayBackground()` equals `COLOR.panel` with alpha 1.
3. `matchupSwatches` gives different families and a luminance ratio of at least 1.4 for all 64 pairs (away and home index 0 to 7). Every `SWATCHES` entry is at least 3.0:1 on `COLOR.panel`. `app.ts` no longer calls `swatchFor` directly.
4. `menu.ts` `title()` returns the headings in U3 for every listed screen id. No heading contains "Offense:" or "Defense:".
5. `breadcrumb()` returns only the picks made on `offense.formation` and `offense.try`. Path playType > Formation > Shotgun > Run gives "Shotgun". Path try > Go for two > playType > Formation > Shotgun > Pass gives "Go for two, Shotgun". A defense path gives "".
6. `placeOverlay` in side mode returns `left = side.left`, `top = field.top`, `width = side.width`, `maxHeight = field.height`, `fill = true`. Floating mode is unchanged.
7. `huddleSpots(n, ...)` returns n points. Adjacent spacing is at least (markPx + markGapPx) / pxPerYard - 1e-6. No point lies within half a chord of the opening place (the place pointing at the line). For X at 1280x720 scale, every point is at least 6 yards past the line.
8. The P1 leak test from the play-calling spec still passes unchanged.
9. `loadSettings` maps stored `labelContent: "both"` to `"rating"`, legacy `ratingLabels: true` to `"rating"` and `false` to `"number"`, and missing to the default. The default `labelContent` is "rating" (Joseph, 2026-11-14). `settingsScreen` still has 5 rows.
10. `placeNumbers` returns one label per shown mark (`number`, the label as drawn), in the overall or the jersey number as the setting says; no box carries a second value.
11. `kickoffFrame()` returns 22 marks (11 O, 11 X) on the `templates.kick.kickoff` and `templates.returnUnits.kickoff` spots. No mark id resolves to a jersey number. It reads no field of the PlayResult.
12. After a play whose `before.possession` differs from the frame's current possession, `restoreLast` draws the idle scene, not that play's frame.
13. Every screen model still has at most 7 rows (existing F3 test), and the footer adds no `button`.

Manual checks (engineer screenshots at 1280x720 and 1024x600, reviewed by test-writer and art-director):

14. From title to pregame: the two swatches differ, and in grayscale too.
15. On the first call: the panel fills the side column from the top bar to the window bottom. The footer sits at the bottom. No paper shows right of the field column.
16. Arrow onto an off row: dashed outline, no paper fill, the reason in the status line. Arrow onto an on row: paper bar.
17. The horseshoe huddle is labeled "Huddle" with the opening toward the ball, and doesn't overlap your lineup or the overlay guard lines.
18. The opening kickoff: both units are visible before the kick, the ball and the returner are visible throughout at 1x, the whistle frame holds, then the view flips.
19. During any play: the top bar shows the score at 28 px, the clock, down and distance, and the three key chips. With the two longest nicknames in `data/teams/names.json` at 1280 wide, the top bar's `scrollWidth` is at most its `clientWidth`.
20. The roster player card has the paper card style with an ink border, not the play-card button style.
21. At 200% text: nothing is clipped. The side column scrolls and the footer stays visible.
22. The tests pass: `pnpm test && pnpm lint && pnpm typecheck`.

## Needs Joseph's sign-off

1. **Mark label default** (U7). Decided by Joseph, 2026-11-14: one label per mark, the overall by default, and the setting switches to the jersey number. "Both" is removed.
2. **The overlay is dark board, not translucent paper** (U1). The full-screen-field amendment says the overlay "is translucent paper over the field". The field stays paper. Only the menu surface changes.
   - Fallback if you say no: a paper panel with a 2 px ink border, and the side margin painted `paperShade`.
3. Nothing in this pass changes the three approved parts of DESIGN.md: the paper field (the field column stays paper; only the canvas outside it changes), team colors as HUD swatches only (U4 changes the colors, not where they go), and the portrait field.

For art-director review (not Joseph): the placeholder swatch set, the new `panelRaise` token, the `field.huddleLabel` slot, and down and distance also in the top bar (art-director decision 4 put it in the panel header, which stays).

## Open questions

- **Debugger:** the cause of the empty live kickoff (U8), and whether item 13 is real.
- **Joseph:** the two sign-off items above.
- **Engine, later:** real kickoff lineups in the request, so pre-kick marks carry numbers. That is a shared type change and isn't asked for in this pass.
- **Playtest:** the 20-dead-ball check under "User", the huddle depths (9 and 10 yards), and the 40 px row height at 125% text.

## Not doing, and why

- Not changing the field's colors, line weights or yard numbers: the paper field is approved, and the separation problem is solved off the field.
- No confirm step for calls: design decision 7 still holds.
- No tooltips, animated transitions, shadows or gradients: DESIGN.md bans the effects, and tooltips hide information behind hover on a keyboard-first game.
- No new screens or settings beyond reshaping the rating-label setting.
- Not rewriting MENUS.md here. It still describes play type before formation and needs its own update with the catalog.
