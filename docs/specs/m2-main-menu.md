# M2 addendum: main menu

Status: draft, revision 1, 2026-11-15. Owner: Joseph. Author: designer. Branch: m2/playable.

Amends docs/specs/m2-playable-game-design.md ("the M2 design"), docs/specs/m2-usability-pass.md ("the usability pass") and, where it touches the same screens, the parked docs/specs/m2-team-select.md. Every conflict is listed in "Amendments". Where this file says nothing, those specs stand.

Final means decided here, change only with a reason. Open means waiting on Joseph, the lead, art-director or a measurement in the build.

## Problem

Joseph: "there's always too much going on at once. create a real main menu for the game which is what we first see. a splash page with options. this sets the tone of the game, provides options, and enable any settings to be changed".

What the first screen is today, from the code (working tree, 2026-11-15):

1. `index.html` puts `#top-bar`, `#layout` (the `#field` canvas, `#panel`, `#mark-card`) on screen from the first frame. `#panel` reads "Loading...".
2. After the worker's `ready`, the stack is `[{ id: "title" }]`. The title is one more panel in the game's side column. `renderTopBar` with no game draws only the word "Clipboard Football" in the bar, and `render` draws an idle empty field with the ball at the 25 (`animator.idle(this.sceneFor("home", 25, null), ...)`). So the first thing on screen is three regions (bar, field, panel) and two of them have nothing to do.
3. `titleScreen` has 3 rows: 1 New game (note "replaces your saved game" when a save exists), 2 Continue (off with "no saved game" or "saves aren't available in this browser window"), 3 Settings. The highlight starts on row 1, so Enter on the title starts a new game even when a save exists.
4. `settingsScreen` has Text size, Reduced motion, Mark labels, Mark label shows, Esc Back. `Settings.speed` exists in `storage.ts` but is set only from the pause menu (row 4, "Animation speed") and the S key during a play. So "every setting from the menu" is not true today.
5. Paths back to the title exist: pause row 7 "Quit to title" (save kept), end screen "Esc Title", sim error "Esc Title", pregame "Esc Back" (pops to the title). The title itself ignores Esc.
6. With storage blocked, the line "This game can't be saved in this browser window." shows twice on the title: once in the body (`screenBody`) and once in the status line (`storageWarning`).
7. `hasSave` is false until `storageAvailable()` and `readSave()` resolve, so for that moment Continue is off with "no saved game" even when a save exists.
8. An unsupported browser (`main.ts` `missingFeatures`) writes its message into `#panel`, beside the scoreboard and field.

## User

No personas exist (docs/research/personas/ is missing). Same working assumption as the other M2 specs: Joseph and players like him, keyboard first, landscape laptop, know football.

Assumptions that carry decisions:

1. **"Too much going on" at the start means the HUD shown before a game exists.** That is why the scoreboard and field are hidden until the coin toss, not restyled. Test: at the next playtest, Joseph opens the game cold and says what he looks at first. If he still says "too much", the next suspect is the pregame screen's unit bars, not the splash.
2. **Returning players are the common case** (the M2 design already says so for the title). That is why the highlight opens on Continue when a save exists. Cheap and reversible, so no test needed beyond the playtest.

## Decisions

1. **Two modes, decided by one fact: menu mode while there is no game, game mode once there is one.** Menu mode is `game === null` in `app.ts`: loading, data error, unsupported browser, the main menu, Settings, Controls, Pregame and its rosters and player cards, and the saved-game error screens. In menu mode `#top-bar` and `#layout` are hidden and a new `#main-menu` section fills the window. Game mode starts when the first `step` of a new or resumed game arrives (the coin toss, or wherever the save resumes) and is exactly today's screen. Why: one rule a test can check, and it matches Joseph's "hidden until a game is actually starting". Pregame is still choosing a game, so it is menu mode. Rejected: hiding only on the title screen, which brings the empty field and the brand-only bar back on Pregame, the second screen anyone sees. Final.

2. **The first paint is already the splash.** `index.html` ships `#top-bar` and `#layout` with the `hidden` attribute, and `#main-menu` with the wordmark and "Loading..." as static HTML. Why: no flash of the HUD before JavaScript runs. Final.

3. **The main menu rows are 1 New game, 2 Continue, 3 Settings, 4 Controls.** Four choices, cap is seven. Controls is added because its content already exists (`controlsScreen`, today reachable only from pause), and a keyboard-first game should show its keys before the first snap. Rejected, never in the Final set: Quit (a page can't reliably close its own tab, so it would point at nothing), Season, Franchise, Online, Load slot (none exist). "How to play" and "Credits" are Open 1 and 2. Final.

4. **The highlight opens on Continue when Continue is on, else on New game.** It is set when the save check resolves, and only if the player hasn't moved the highlight yet. Why: Enter is the cheapest key, and it should never be the one that replaces a save. New game keeps its note "(replaces your saved game)" when a save exists and storage works. Rejected: a confirm step on New game (the usability pass U9 already rejected it: one fact, one time). Final.

5. **While the save check runs, Continue is off with the reason "checking for a saved game".** Why: today it says "no saved game" for that moment, which is false when a save exists. Final.

6. **Settings from the menu reaches every user setting: add row 5 "Animation speed"** (note 1x, 2x or skip), the same cycle and storage as the pause menu row. Rows become Text size, Reduced motion, Mark labels, Mark label shows, Animation speed, Esc Back (6). The pause menu keeps its own speed row, because changing speed mid-game shouldn't take two screens. Why: "any settings" means every field of `Settings`. A test ties the two together (MM10), so a future setting can't be added without a row. Final.

7. **Settings preview live, in place.** Each change saves and applies on the keypress, as today, and the screen shows the effect:
   - Text size: the whole menu, including the wordmark and rows, re-lays out at the new size on the same frame. This is the preview.
   - Reduced motion: the note says what it resolves to now: "Follow the system (now: on)" or "(now: off)", from `prefers-reduced-motion`.
   - Mark labels, Mark label shows, Animation speed: these only show during a play, so the preview is in words. A description line under the rows names what the highlighted row changes (table below), and the footer legend ("Mark labels: overall ratings") updates on the keypress, as today.
   - The current body line "Mark labels: [value]." is removed: it repeats the row 3 note.

   | Highlighted row | Description line |
   |---|---|
   | Text size | Changes every screen, including this one. |
   | Reduced motion | On: plays jump to their last frame and the camera cuts instead of panning. |
   | Mark labels | Which marks keep their label while a play runs. Every mark gets its label back at the whistle. |
   | Mark label shows | What the number beside each mark is: the player's overall rating or his jersey number. |
   | Animation speed | How fast plays run: 1x, 2x, or skip to the result. S changes it during a play. |

   Rejected: a drawn sample mark with a label in Settings. Its number would belong to no player, and DESIGN.md says every mark is a real player. A visual preview using a real team's players is Open 4. Final.

8. **Settings and Controls opened from the main menu render in the menu frame; opened from pause they render in the game panel, as today.** Same screen model, two places. Why: entering Settings must not bring the HUD back. Final.

9. **Going back to the main menu.** Every existing path lands there, and the labels say "Main menu" instead of "title":
   - Pause row 7: "Quit to main menu" (note "save kept").
   - End of game: "Esc Main menu".
   - Sim error: "Esc Main menu".
   - Pregame: Esc Back, which already pops to the main menu. Final, and it is the right target: Pregame is one step from the menu, so Back means the menu.
   - Esc on the main menu does nothing and announces nothing. There is no deeper back.

   On arrival from a game, the polite live region says "Main menu. Your game is saved." when the save was written, "Main menu." otherwise. Screen ids stay `title` in code, so only labels change. Final.

10. **Into a game: a cut, never a transition.** Start on Pregame (or Continue on the menu) keeps menu mode up. After 300 ms with no reply, the status line says "Working..." (existing rule). When the first `step` arrives, `#main-menu` hides and `#top-bar` and `#layout` show on the same frame, the canvas is sized before its first draw, and focus goes to the highlighted row of the game panel. Why: DESIGN.md bans swooshes and wipes, the usability pass rules out animated transitions, and a cut works the same with reduced motion on or off. Final.

11. **The storage-blocked line shows once on the main menu,** as the body line under the tagline. The status line leaves out `storageWarning` in menu mode. Final.

12. **Settings that can't be stored say so.** `saveSettings` returns whether it stored. If not, the Settings screen shows "Settings last until you close this page." in `color.chalkSoft` under the rows. Final.

13. **The splash shows no model output.** The drawn play is a designed illustration from play-card templates: no ball path, no result, no player labels, no team names (Decision 15). Final.

### Splash composition (main menu screen only)

What the eye reads first, in order, and why:

1. The wordmark, top left, the largest text and the strongest contrast on screen. It is the one thing a first screen must say.
2. The tagline, which says in one line what the game is.
3. The highlighted row, a gold bar, the strongest fill on screen after the wordmark. It is the decision.
4. The other rows.
5. The play diagram, to the right. It is the tone, so it sits in peripheral vision, beside the decision and never above it. A green block on navy pulls the eye, which is why it goes right of the rows and below the wordmark, not top left.
6. The footer keys.

Built on the window, not on the game layout. All sizes are `calc(N px * var(--text-scale))` unless marked fixed.

| Element | Spec |
|---|---|
| Window | `color.panel`, flat, full window. No top bar, no gold scoreboard rule |
| Content frame | Centered both ways. Width `min(1040px, 100vw - 64px)` (fixed px), padding 32 px. Scrolls vertically if it doesn't fit; never horizontally |
| Wordmark (`menu.wordmark`) | The text "Clipboard Football" in an `h1`, shown in block caps by CSS `text-transform: uppercase` (the DOM keeps sentence case, so screen readers read words). `font.display` 700, 56 px, `color.chalk` (14.72:1 on panel). Left aligned. Wraps to two lines rather than clip. The text is one constant: the name is a working title |
| Rule (`menu.rule`) | 2 px `color.gold`, the full frame width, 12 px under the wordmark. Same job as the scoreboard rule: it ends the header. Decorative |
| Left column | 440 px (scales), 24 px under the rule. Tagline "Call the plays. The X's and O's run them." (existing copy) in `font.ui` 18 px `color.chalkSoft` (7.72:1). Then the storage line if any (Decision 11). Then the rows (`hud.playMenu` styles as DESIGN.md defines them at build time: 40 px min height, key chip, gold highlighted row with `color.ink` text). Then the status line. Footer pinned at the bottom of the frame: `[Arrows] Move  [Enter] Pick` |
| Right column (`menu.splashArt`) | The rest of the frame width, 48 px gap. A `<canvas id="menu-art" aria-hidden="true">`, width the column, height 0.68 times the width (fixed ratio, about 38 yards of field at full width). Flat edges, no border, no frame |

The play diagram, drawn on `#menu-art` with the field's own drawing code (`field.ts` field painting, `art.ts` `offenseArt` and `defenseArt`, the mark and path strokes), so nothing new is drawn by hand:

- Field: the DESIGN.md surface at full width, sideline to sideline plus margins: turf stripes, yard lines, hash marks, yard numbers, sidelines. Offense attacks up. Ball on the field's center line at OWN 35. Line of scrimmage 62% down the box. First-down line (dashed `color.signal`) at OWN 45. That window runs from about OWN 21 to OWN 59, so no end zone and no team name is in view.
- Offense: Shotgun, Play action (`offenseArt("shotgun", "playAction", slotsFromCounts(<shotgun personnel>), ...)`), routes solid with arrowheads, blocks with ticks.
- Defense: Nickel, Nickel Cover 3 (`defenseArt("nickel", "nickelCover3", ...)`), paths dashed. No zones or depth bands (less on screen, the ask).
- Marks: 11 O's and 11 X's, generic slot ids, no labels. Proposed colors: `color.line` fill over a `color.outlineDark` outline for both sides and their paths, the light-tier outline rule. Shape and line style carry the side. Needs art-director (Open 3): there is no game, so no team colors apply.
- No ball path, ball-carrier ring, labels, flags or text.
- Static. Drawn once when shown, again on resize and on a text-size change. No animation loop while the menu is up, so reduced motion has nothing to change here.
- Why this play: shotgun play action against nickel Cover 3 is an everyday NFL snap that uses every kind of line DESIGN.md defines (route, block, defense drop) in one picture, which is the coach's eye in one image.
- Rejected: an animated looping play (motion beside a decision pulls the eye off the rows and costs a frame loop on the menu); a drawn clipboard or paper card object (decoration with no job, and close to the banned fake paper look); real team colors on the diagram (it would imply a matchup that doesn't exist).

The art is hidden, and the left column takes the frame width at most 640 px, when any of these holds:

- text size is 150% or more (same threshold as the compact rule, `textSize >= 150`);
- the frame is narrower than 880 px;
- Canvas 2D is missing (unsupported browser).

During loading the art box draws the turf with no marks (the field needs no league data), and the marks appear when the templates arrive. This keeps the layout from jumping from one column to two.

### Other menu-mode screens

Settings, Controls, Pregame, rosters, player cards, the saved-game error screens and the data error use the same window and content frame, without the wordmark, rule or art. Each has its screen title as the `h1` at 28 px `color.chalk`, a 2 px `color.gold` rule under it, then today's body, rows, status line and footer. Width: rows-only screens (Settings, Controls, save errors) at most 640 px; Pregame, rosters and cards up to the 1,040 px frame. Why: the splash sets the tone once; repeating the art on every menu screen is the "too much" again.

## Screens

| Screen | Reads first, and why | Choices (count) |
|---|---|---|
| Main menu | Wordmark, tagline, highlighted row (above) | 1 New game (note when a save exists), 2 Continue (off with a reason), 3 Settings, 4 Controls (4) |
| Settings (from the menu or pause) | Title, the highlighted row, its description line | 1 Text size, 2 Reduced motion, 3 Mark labels, 4 Mark label shows, 5 Animation speed, Esc Back (6) |
| Controls (from the menu or pause) | Title, the key table | Esc Back (1) |
| Pregame | Unchanged content, now in the menu frame | Unchanged (6) |

Flow: Main menu, 1 New game, Pregame, Start, coin toss (game mode). Main menu, 2 Continue, the resumed game (game mode), or the saved-game error screen (menu mode). Game, Esc, Pause, 7 Quit to main menu.

## Keyboard and mouse

Keyboard first, as today: number keys pick rows from anywhere on the screen, Up and Down move the highlight, Enter picks it, Esc and Backspace go back one screen (nothing on the main menu). Mouse: every row is a button; the pointer handlers that pick rows (`click.ts`, today bound to `#panel`) also bind to `#main-menu`. Focus sits on the highlighted row whenever a menu-mode screen is shown (existing `render` behavior, applied to the new container).

## States

| State | What the player sees | Final or open |
|---|---|---|
| First paint, before JavaScript | `#main-menu` with the wordmark and "Loading..." on navy. `#top-bar` and `#layout` hidden | Final |
| Loading league data | Splash composition. Where the rows go: "Loading league data", the progress bar (track `color.panelRaise`, fill `color.chalkSoft`, value in words beside it) and "N of M files". Art box shows turf with no marks. Keys ignored (existing) | Final |
| Browser unsupported (`main.ts`) | Wordmark, then "This browser can't run Clipboard Football." and "It needs [features]." in the rows area of `#main-menu`, not `#panel`. No rows, no art | Final |
| Data error (fatal) | Menu frame, `h1` title, message in `color.chalkSoft`. No rows | Final |
| Checking for a save | Continue off: "checking for a saved game". Highlight on New game until the check resolves | Final |
| No save | Continue off: "no saved game", dashed chip. Highlight on New game | Final |
| Save exists | "New game (replaces your saved game)", Continue on and highlighted | Final |
| Storage blocked (permission denied) | Continue off: "saves aren't available in this browser window". The body line "This game can't be saved in this browser window." once. Play still works | Final |
| Settings can't be stored | Settings shows "Settings last until you close this page." | Final |
| Continue on a damaged or older save | Existing save error screen, in the menu frame | Final |
| Continue on a finished game's save | Whatever resume does today (I didn't confirm it opens the Final screen). Open 6 | Open |
| Setting up a game (after Start or Continue) | Menu mode stays. "Working..." after 300 ms. Cut to game mode on the first step | Final |
| Back from a game | Main menu, Continue highlighted if the save was written, live region "Main menu. Your game is saved." | Final |
| Window too small (`layoutFor(...).tooSmall`, today below 800x520) | Existing "Make the window larger to play.", restyled to `color.panel` with `color.chalk` text, over either mode. Keys ignored. Threshold mismatch is Open 5 | Final (style), Open (threshold) |
| Text at 125% | Two columns, art shown | Final |
| Text at 150% and 200% | Art hidden, one column at most 640 px. The wordmark wraps to two lines before it clips. Frame scrolls vertically, footer stays pinned. At 1280x720 and 200% the main menu fits without scrolling (estimate: about 650 px of 720); at 800x520 it scrolls | Final |
| Reduced motion | Nothing on the menu animates in either setting | Final |
| Sim error | In game mode if a game exists (today), else in the menu frame. "Esc Main menu" | Final |
| Permission-denied beyond storage | Not applicable: no accounts | Final |

## Accessibility (baseline)

- One `h1` per screen: the wordmark on the main menu, the screen title elsewhere. `#main-menu` is a `section` with `aria-label="Main menu"`; hidden regions use the `hidden` attribute, so they leave the accessibility tree.
- The wordmark is live text, not an image; its block caps are CSS only. `#menu-art` is `aria-hidden`: it carries no information a player needs.
- Contrast, all from DESIGN.md token pairs: `chalk` on panel 14.72, `chalkSoft` on panel 7.72, `ink` on gold 9.95, `inkSoft` on gold 4.93. The gold rule is decorative. Figures are DESIGN.md's hand-computed ones; the usability-pass contrast test recomputes them (MM22).
- Not color alone: off rows keep the dashed chip and the reason in words; the highlighted row is fill plus focus ring.
- Every size in `#main-menu` uses `var(--text-scale)`, so the text-size setting applies to the menu itself; nothing clips horizontally at 200%.
- Focus is always on the highlighted row; a cut into game mode moves focus to the game panel's highlighted row.
- Live region announcements: arrival on the main menu from a game (Decision 9). Settings changes are announced through the row's new note, which the focused button already reads.

## Model output: uncertainty, wrong results, correction

The main menu shows no engine output. The diagram is a designed template drawing, labelled nowhere as a real play, with no result, no ball path and no player numbers, so it can't mislead. The only uncertain fact on the screen is whether a save exists, and Decision 5 says "checking" until it is known instead of guessing.

## DOM and code contract (for engineer and test-writer)

- `index.html`: `#top-bar hidden`, `#layout hidden`, new `<section id="main-menu" class="main-menu" aria-label="Main menu">` holding `<h1 class="wordmark">Clipboard Football</h1>`, `<p>Loading...</p>` and later `<canvas id="menu-art" aria-hidden="true">`.
- `app.ts`: one function decides the mode (`game === null`) and sets `hidden` on `#main-menu`, `#top-bar` and `#layout` together. Menu-mode screens render into `#main-menu`; the idle field draw (`animator.idle` under the title today) does not run in menu mode.
- `screens.ts`: `titleScreen` takes `{ hasSave, storage, checking }` and returns the four rows; `settingsScreen` takes `speed` and returns six rows; `pauseScreen`, `endScreen`, `simErrorScreen` labels change (Decision 9).
- `storage.ts`: `saveSettings` returns `boolean`.
- `main.ts`: the unsupported message goes into `#main-menu`.
- `styles.css`: `.main-menu` frame, `.wordmark`, the rule, the two columns, `.too-small` on panel colors. Tokens by DESIGN.md name only; `styles.css` and `tokens.ts` still carry the pre-"Stadium grass" hexes, so the menu follows whatever the tokens are when it builds.

## Amendments to earlier specs

| Where | Was | Now |
|---|---|---|
| M2 design, Screens, Title | 1 New game, 2 Continue, 3 Settings (3) | 1 New game, 2 Continue, 3 Settings, 4 Controls (4); highlight on Continue when on |
| M2 design, Layout | Top bar, field and panel on every screen | Menu mode (no game): full-window navy frame, no top bar, no field. Game mode from the first step: unchanged |
| M2 design, States, Loading | "Loading league data" in the panel | Same content, in the splash composition |
| M2 design, labels | "Quit to title", "Esc Title" | "Quit to main menu", "Esc Main menu" |
| Usability pass, States, Loading | Dark side column, field column empty paper | Splash, no field column |
| Usability pass, States, Title | Three rows | Four rows, plus the checking state |
| Usability pass, AC 9 | `settingsScreen` still has 5 rows | 6 rows (Animation speed added). The rows changed, not the rule |
| Usability pass, Window too small | Unchanged (paper) | `color.panel` and `color.chalk` |
| Team select (parked), decision 12 | Full-window pregame, needs art-director | Pregame is in the menu frame now, for a different reason (menu mode). If team select is built, its two lists live in the same frame |

## Acceptance criteria

| # | Criterion | How it fails |
|---|---|---|
| MM1 | In `index.html` as served, `#top-bar` and `#layout` have the `hidden` attribute and `#main-menu` contains an `h1` "Clipboard Football" and the text "Loading...". | The HUD is in the first paint. |
| MM2 | Whenever `game === null` (loading, data error, main menu, Settings, Controls, Pregame, rosters, cards, save errors): `#top-bar.hidden`, `#layout.hidden` are true and `#main-menu.hidden` is false. | Any of the three wrong in any of those screens. |
| MM3 | When the first `step` of a new or resumed game arrives: `#main-menu` hidden, `#top-bar` and `#layout` shown in the same render, the canvas backing size matches `layoutFor(window)` before its first draw, focus is on a row in `#panel`. | HUD missing, a zero-size canvas, or focus lost. |
| MM4 | Pause, 7 Quit to main menu: mode is menu, the top screen is `title`, Continue is on and highlighted once the save is written, the live region reads "Main menu. Your game is saved.". | Any difference. |
| MM5 | `titleScreen` returns exactly New game (1), Continue (2), Settings (3), Controls (4); every row's `action` is one `act` handles; keys unique. | A fifth row, an unhandled action, a repeated key. |
| MM6 | Continue reasons: `storage: false` gives "saves aren't available in this browser window"; `checking: true` gives "checking for a saved game"; no save gives "no saved game". | Wrong or missing reason. |
| MM7 | New game has the note "replaces your saved game" iff `hasSave && storage`. | Note shown with no save, or missing with one. |
| MM8 | The opening highlight is Continue when it is on, else New game; if the player moved the highlight before the save check resolved, it stays where he put it. | Enter starts a new game over a save on the first keypress. |
| MM9 | `settingsScreen` rows are Text size, Reduced motion, Mark labels, Mark label shows, Animation speed, Esc Back; the speed row cycles 1x, 2x, skip, saves, and matches the pause row and the top bar chip. | Missing row or diverging values. |
| MM10 | For every key of `DEFAULT_SETTINGS`, `settingsScreen` has a row whose action changes that key. | A setting with no row. |
| MM11 | Pressing 1 on Settings in menu mode sets `--text-scale` on the same render; a row's computed font size in `#main-menu` at 200% is twice that at 100%, and the wordmark's too. | The menu doesn't scale. |
| MM12 | `#menu-art` is shown at 1280x720 with text 100% and 125%, hidden at 150% and 200%, hidden when the frame is under 880 px, and hidden when Canvas 2D is missing. | Art shown or hidden in the wrong case. |
| MM13 | At 1280x720 and at 800x520, text 200%, on the main menu and Settings: no element in `#main-menu` has `scrollWidth > clientWidth`, every row button is reachable by Tab, the footer is visible. | Horizontal clip or an unreachable row. |
| MM14 | Below `MIN_WIDTH` x `MIN_HEIGHT`, `#too-small` shows in either mode on `color.panel` with `color.chalk` text; number keys do nothing. | Paper styling, or keys acting. |
| MM15 | With `missingFeatures()` non-empty, the message is inside `#main-menu`, `#panel` is untouched, `#top-bar` and `#layout` stay hidden. | Message in the HUD. |
| MM16 | The diagram's frame has 11 O and 11 X marks from `offenseArt("shotgun", "playAction", ...)` and `defenseArt("nickel", "nickelCover3", ...)`, no mark labels, no ball path, no zones. | Any extra element, or a label. |
| MM17 | While the main menu is up, no animation frame loop runs: a `requestAnimationFrame` spy counts no calls over 1 s without input. | A loop on the menu. |
| MM18 | Esc on the main menu leaves the stack and status unchanged; Esc on Pregame lands on the main menu. | Stack change or a missing path. |
| MM19 | Labels: pause row 7 "Quit to main menu", end screen Esc "Main menu", sim error Esc "Main menu". | "title" in any label. |
| MM20 | With storage blocked, "This game can't be saved in this browser window." occurs exactly once in `#main-menu`'s text. | Zero or two. |
| MM21 | A pointer down and up on a row in `#main-menu` picks it, by the same `click.ts` rule as `#panel`. | Mouse can't pick on the menu. |
| MM22 | The automated WCAG 2.2 AA check passes on the main menu (each Continue state), Settings and Controls in menu mode, and Pregame; the contrast test recomputes every figure quoted here. | A failure. |
| MM23 | The every-screen cap test includes the main menu (4) and Settings (6); all at most 7. | A screen over 7. |
| MM24 | Manual, engineer screenshots reviewed by art-director: main menu at 1280x720 at 100% and 200%, at 800x520, in grayscale. | Not reviewed. |
| MM25 | Playtest: Joseph opens the game cold; note what he looks at first and whether "too much going on" still applies (assumption 1). In the playtest log. | Not run. |

## Tests to add or change

None is weakened.

| Test | Change | Criterion |
|---|---|---|
| layout.test.ts, screen cap | Title now 4 rows, Settings 6. Updated because the rows changed, not the rule | MM23 |
| layout.test.ts line asserting 5 settings rows (usability pass AC 9) | 6 rows | MM9 |
| New `mainmenu.test.ts` (DOM, jsdom) | Mode switch, first paint, back paths, highlight default, reasons, storage line once, no frame loop, art visibility rules | MM1 to MM8, MM12, MM17, MM18, MM20 |
| screens tests | Title rows, settings rows, label renames, every `DEFAULT_SETTINGS` key covered | MM5, MM9, MM10, MM19 |
| storage tests | `saveSettings` returns false when `localStorage.setItem` throws | Decision 12 |
| art test | The splash diagram's mark count and the absence of labels and ball path | MM16 |
| Scripted UI playthrough (F1) | Starts from the main menu in menu mode, reaches the coin toss in game mode, quits back | MM2 to MM4 |
| Accessibility check (X3) | Adds the four menu-mode screens | MM22 |

## Art slots for docs/ASSETS.md ("Planned slots")

| slot | added because |
|---|---|
| `menu.frame` | The full-window navy menu frame and its content width |
| `menu.wordmark` | The game name in `font.display` caps on the main menu |
| `menu.rule` | The gold rule under the wordmark and menu screen titles |
| `menu.splashArt` | The static play diagram on the main menu |

Reused: `hud.playMenu`, `hud.playMenu.selected`, `hud.playMenu.disabled`, `hud.teamSwatch` (Pregame), every `field.*`, `mark.offense`, `mark.defense`, `path.*` slot the diagram draws through.

## Open

1. **Credits row (Joseph, lead).** docs/DATA.md lists play-by-play as CC-BY 4.0 ("Credit nflverse") and participation and FTN charting as CC-BY-SA 4.0 with named attribution. Nothing in packages/app credits them today. If the shipped fitted files need attribution in the build, a Credits screen (data sources from DATA.md, fonts from ASSETS.md) stops being optional and takes row 5. The content exists in docs, not in the app, so it is Open, not Final.
2. **How to play (Joseph).** No content exists beyond Controls and the tagline. Worth it only if a newcomer can't get from kickoff to a first down without asking. Test: one playtester who hasn't seen the game.
3. **Art-director sign-off:** `font.display` used for the wordmark (DESIGN.md limits it to scoreboard, end zone and field lettering); the gold rule used outside the scoreboard; white-on-dark-outline marks and paths for the diagram, with no team color; the 0.68 art ratio and the play chosen; the too-small screen on navy; the wordmark's fallback face until Barlow Condensed passes intake (CSS fallback to the UI font at 700, uppercase).
4. **Visual mark-label preview in Settings (Joseph).** Drawing real players' labels on the diagram needs a team's pool on the menu (a `matchup` request for a fixed seed). Words cover it in this build.
5. **Minimum window (lead).** The M2 design says 1024x600; `layout.ts` says 800x520 (`MIN_WIDTH`, `MIN_HEIGHT`). This spec uses whatever `layoutFor` says. One of the two should be corrected.
6. **A finished game's save (engineer to verify, then Joseph).** I didn't find where a save is cleared at the final whistle. If Continue resumes a finished game, either Continue says "(final)" in its note or the save is kept but not offered. Verify first.
7. **Continue note naming the save (Joseph, later).** "Continue (Herons at Comets, 3rd quarter)" needs reading the save's matchup on the menu. Useful, not asked for, so not in this build.

Everything else in this file is final.
