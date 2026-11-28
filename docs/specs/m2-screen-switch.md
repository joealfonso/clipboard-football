# M2: switch screens between play calling and the play

Status: built 2026-11-15. Source: Joseph, 2026-11-15: "the experience should switch screens.
during play and play calling." Asked to confirm "the play-calling menu takes over the screen, then
gives way to a full-field play", he answered "Yes, that".

## What changes

In a game there are two screens, never both at once:

1. **Calling screen.** Every moment the game waits on you (coin toss, a call, a dead ball's
   Continue, a penalty choice, halftime, the end of the game, and the pause, details and box score
   overlays opened from them): the menu panel fills the whole window under the top bar. The field
   is not shown. The top bar (score, clock, down) stays.
2. **Play screen.** From the snap to the end of the whistle hold: the field alone, full window, no
   panel (as before).

   **Amended 2026-11-15 (DESIGN.md "Broadcast", Play screen):** when the window has room
   (`column + 24 + rail <= width - 48`, rail `clamp(300px, 340px * text scale, 420px)`), the field
   column and a read-only play rail sit centered together on the stage. The rail holds no menu,
   covers nothing on the field and decides nothing: "This play" (the calls line, from the snap),
   the result and why lines (from the whistle, text only from the committed play event), and the
   Space, S and M key hints. Without room it is the field alone, centered, as above. Pure rule:
   `playStage` in `packages/app/src/ui/layout.ts`.

The switch happens at the snap (calling to play) and when the whistle hold ends (play to calling).
Menu mode (title, pregame, settings before a game) is unchanged.

Supersedes for game mode: the side-column placement (usability pass U1) and the over-the-field
placement (Joseph's 2026-11-14 full-screen amendment) while calling. `placeOverlay` stays as the
rule for menu mode and is unchanged.

## Layout of the calling screen

- Panel: opaque `color.panel`, left 0, full window width, from the top bar to the window bottom.
  Amended 2026-11-15 (DESIGN.md "Broadcast", Calling screen): the panel has no background on this
  screen; the stage gradient shows through and the last-play and call sections are glass cards.
- Content centered: side padding `max(24px, (width - 1160px) / 2)`, so rows and cards don't stretch
  across a 1920 px window.
- At 760 px of panel width and up, the two-column layout (play report left, call right), as the
  wide over-field panel already did. Card art from 1024 px windows up, text rows below, as before.
- The player card (M) opens over the panel, top left, as in the side column.

## What is lost, on purpose

The field preview while calling (pre-snap state 2: your lineup for the focused formation, and both
units lined up before a kickoff, U8) is no longer visible, because the field is not shown while
calling. The play card art carries the play instead. If Joseph wants the lineup back, a small field
diagram inside the calling screen is the follow-up; not built here.

## Acceptance

1. In a game and not animating: the panel's placement is the full window under the top bar
   (`where: "screen"`), whatever the window size, and the field canvas is hidden.
2. While animating: the panel is hidden and the canvas shown (unchanged rule, `overlaysShown`).
3. Out of a game (menu mode): placement is `placeOverlay` exactly as before.
4. Keys, Enter and click-to-pick work the same on the calling screen.
5. Tests: `packages/app/test/screen-switch.test.ts`.

## Docs to follow

DESIGN.md Layout and "Still open: Layout" should record this as the game-mode rule. DESIGN.md had
another session's uncommitted edits when this was built, so it was left for art-director.
