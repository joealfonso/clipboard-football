# M2 addendum: game entry and the coin toss

Status: draft, revision 1, 2026-11-15. Owner: Joseph. Author: designer. Branch: m2/playable.

Amends docs/specs/m2-screen-switch.md, DESIGN.md (Play screen rail, Motion), docs/specs/m2-playable-game-design.md (Coin toss and Overtime toss rows) and docs/specs/m2-main-menu.md (decision 10, the cut). Every conflict is listed in "Amendments". Where this file says nothing, those specs stand.

Final means decided here, change only with a reason. Open means waiting on Joseph, the lead, art-director or a measurement in the build.

## Problem

Joseph: "the whole flow into the game is too fast and gets overwhelming. slow the pace. simulate a coin toss".

What happens today (lead's walk-through in the browser, 2026-11-15, and the code):

1. Pregame, Start. The cut to game mode lands on the calling screen (m2-screen-switch.md): no field, a "Last play: No plays yet." card, and on the right "Coin toss: you won" with 1 Receive, 2 Defer, Esc Menu. If the AI won, a `continue` request with `about.what: "tossResult"` shows instead.
2. After the pick, the next step's events hold the toss (`t: "toss"`, `events[0]`), and its only trace is one event line under Last play ("Coin toss: the Rattlers win and choose to receive. The Rattlers receive."). The panel is already on "Kickoff" with Continue, Timeout, Menu.
3. Continue: the stage is blank for about a second, then the field appears and the kickoff runs.

So the first decision of the game comes before the player has seen the field, the teams or the toss, and the toss itself is a menu title. Three screens change in under ten seconds of keypresses.

## User

No personas exist (docs/research/personas/ is missing). Same working assumption as the other M2 specs: Joseph and players like him, keyboard first, landscape laptop, know football. Two groups inside that: the first game (needs to be oriented) and the tenth game (wants to get to the snap).

Assumptions that carry decisions:

1. **"Too fast" is about being asked before being shown, not about total time.** That is why every beat before the first decision is something to look at, and the one wait before the flip is a single key, not a choice. Test: at the next playtest, Joseph starts a new game cold; note whether he presses anything before the coin flips and whether he says it still feels rushed.
2. **Repeat players will press Space through it.** That is why Space jumps to the next point that waits on you, and the speed setting compresses it. Test: count Space presses in the ceremony in the playtest log over three games.

## Decisions

1. **A third game screen: the toss stage.** From the cut into game mode until the snap of the opening kickoff, the screen is the play screen's layout (DESIGN.md Play screen): the field column, and a ceremony card where the rail goes. The same holds from an overtime toss request to the snap of that overtime's kickoff. Every other moment of the game keeps the calling and play screens as built. Why: the complaint is "no field, decisions before oriented"; keeping the field up from the first frame to the first snap answers both, and it removes two screen switches from the first ten seconds. Rejected: keeping the toss choice on the calling screen and only adding a flip on the field (three switches: field, calling, field, which is the "too fast" again). Rejected: a full-window broadcast card over a hidden field (it repeats today's problem with nicer type). Final, needs art-director (Open A1): the rail holds rows on this screen only.

2. **The ceremony card holds the toss decision and the opening kickoff decision.** Both are short (at most 4 rows). This is the only place the rail slot holds rows. Later kickoffs keep the calling screen. Why: the opening kickoff is part of the entry; moving it to the calling screen would bring back the switch Decision 1 removes. The inconsistency with later kickoffs is accepted: those come after a play the player has just watched, so he is oriented. Final.

3. **Beats, in order.** Each is either a wait (nothing happens until a key) or auto (runs for its time and moves on). Durations are at 1x and live in `data/ui/motion.json` under `entry` (Decision 8).

   | # | Beat | Kind | 1x time | Field | Card |
   |---|---|---|---|---|---|
   | E1 | Matchup | wait | until Space | Midfield, empty turf, no marks, no line of scrimmage, no first-down line | Matchup, who calls the toss, "Space Toss the coin" |
   | E2 | The call | auto | `callMs` 1200 | The coin appears resting at the ball spot on the 50 | Adds the call line |
   | E3 | The flip | auto | `flipMs` 1800 | The coin flips (Decision 5) and lands on its result face | Adds "The coin is in the air." |
   | E4 | The result | auto | `resultMs` 1400 | Coin resting, face up, with a face tag | Replaces E3's line with the result |
   | E5 | The choice | wait | until a pick | Unchanged | You won: the choice rows. They won: their choice in words and Space Continue |
   | E6 | Choice said | auto, you won only | `choiceMs` 1200 | Unchanged | Your choice in words |
   | E7 | Kickoff setup | auto | `panMs` 900, then `motion.preSnap.lineUpMs` | The coin leaves, the camera pans to the kickoff spot, both units line up (`kickoffFrame`, U8) | "Opening kickoff" and the kickoff request's text |
   | E8 | Kickoff call | wait | until a pick | Both units lined up | The kickoff request's rows |

   At the snap of the kickoff the card becomes the normal play rail ("This play"), and the game carries on as built. Time from Space on E1 to the choice at 1x: 4.4 s. Why E1 waits: it is the one moment the player is told what is about to happen, and a wait lets him read it at his pace (assumption 1). Why the flip is auto: it is the show, and asking for a key mid-flip would be a decision with no content. Final. Open J2 asks Joseph whether he wants E1 hands-free instead.

4. **The call and the coin face are presentation, derived from the engine's winner.** The engine draws only the winner (DECISIONS.md "Coin toss draw"). The UI never draws a random number. The visiting team calls (NFL Football Operations, "NFL Overtime Rules": the visiting team captain calls the toss; the opening toss's caller is to be confirmed from the 2026 rulebook PDF and cited in docs/RULES.md, Open A3). The call is `tossCall(seed, period)`, a pure function of the matchup seed and the toss period in `ceremony.ts` (for example the low bit of `seed ^ period`), so the same game always shows the same call. The landed face is the call if the visitor won, else the other face. So the face always agrees with the winner the engine drew, and with `peekToss`. Why a call at all: heads or tails is the real procedure and costs one line; a coin with team faces would be invented. Rejected: letting the human call heads or tails in the UI only, which would be a choice that changes nothing (Open J1 asks whether it should become a real sim input). Final.

5. **The coin (`fx.coin`, new slot).** A disc 2 yards across (about 27 px at 1280x720, never under 20 px), `color.line` fill, `color.outlineDark` 1.5 px ring, `shadow.mark`, drawn at the ball spot on the 50. Faces are told apart by a glyph (art-director's call, Open A2) and always by a tag in words beside it ("Heads", "Tails", `field.huddleLabel` style). The flip: the coin rises up to `flipRiseYards` 3 yards up the screen and comes back down on a symmetric arc, while its vertical scale follows `|cos|` through `flipHalfTurns` 7 half turns, so it lands on the result face. Ease only at the start and the end, like marks. No bounce or wobble at the landing, no sparkle, no slow-motion. It is field motion (a game object, like the ball), not UI motion. Final except the look (Open A2).

6. **The matchup beat shows names and sides, not numbers.** Card: section label, the two teams, who calls, the row. No unit bars or averages: Pregame showed them one screen ago, and team strength is never shown as its own number (m2-team-select.md decision 11). No records: none exist. Why: E1's job is "who is playing whom, and where you are", in one look. Rejected: a broadcast "tale of the tape" with three unit averages per team (more numbers on the first game screen, the ask is less). Final.

7. **Keys during the ceremony.**
   - Wait beats (E1, E5, E8): the rows' keys as built (numbers, Space, T where offered, Up, Down, Enter, Esc Menu, click to pick).
   - Auto beats (E2, E3, E4, E6, E7): treated as animating. Space or Enter jumps to the next wait beat, with the field and card in that beat's final state (coin resting on its face, units lined up). S cycles the speed (1x, 2x, skip), saved, as during a play. Every other key does nothing and nothing is buffered. A held key's repeat never skips (existing rule).
   - Speed 2x: every auto beat's time is halved. Speed skip: auto beats take 0 ms; the player sees E1, then E5 with the call and result lines already shown and the coin resting on its face, then E8 with the units lined up. So a repeat player on skip reaches the toss choice in one key.
   - Esc on an auto beat does nothing; Esc Menu is on every wait beat.
   Why Space jumps to the next wait and not one beat: one meaning for Space across the game ("get me to my next decision"), as during a play. Final.

8. **Timings are data.** A new `entry` block in `data/ui/motion.json`, validated by `parseMotion` with the rest of the file (version 3): `callMs` 1200, `flipMs` 1800, `flipHalfTurns` 7, `flipRiseYards` 3, `resultMs` 1400, `choiceMs` 1200, `panMs` 900, `coinYards` 2. Designed values, tuned in playtest, none fitted. No duration in `ceremony.ts`, `app.ts` or `animator.ts` for the ceremony is a literal; the fades use `dur.base` and `dur.screen` tokens. Whether adding a block to this app-internal file is an ask-first schema change is the lead's call (Open A4). Final.

9. **The sim does not change.** No new request kind, no new input, no new event. E1, E2 to E4, E6 and E7 are UI-only holds around requests the session already sends (`toss`, `continue` with `tossResult`, `overtimeToss`, then `kickoff` or `continue` with `theyKickOff`). The worker's reply to the toss answer can arrive during E6; E7 starts when both E6 has run and the step has arrived (if the step is slow, the existing "Working..." line after 300 ms). The input log, the record and every digest are byte-identical with and without the ceremony. Final.

10. **Overtime gets the same ceremony, with its own first beat.** When an `overtimeToss` request or a `continue` with `tossResult` arrives with `state.phase === "overtimeToss"`: the field cuts to midfield (pan with motion on), the last play's marks and paths fade out over `dur.base`, and E1 reads the tie instead of the matchup. E2 to E8 as above, with the overtime options (Receive, Kick) and "Overtime kickoff". The postseason re-toss after the fourth overtime period runs it again. Final.

11. **The blank stage before the opening kickoff goes away.** The canvas is sized and the field painted before the first frame of game mode (main menu spec MM3 already requires the size). There is no frame, from the cut to the end of the game, in which the toss stage or the play screen shows the stage with no field painted. The cause of today's blank second isn't known; if it isn't obvious, debugger finds it first (CLAUDE.md). Final.

12. **The toss line stays in the record and the Last play card.** The existing event line ("Coin toss: the Rattlers win and choose to receive. The Rattlers receive.") still lands in the Last play card on the first calling screen, so the toss stays findable after the ceremony. The ceremony's lines must agree with it (TC6). Final.

## Copy

Exact strings. `[Away]`, `[Home]`, `[Winner]`, `[Loser]` are nicknames, `[Away place]` the place and nickname. No em dashes anywhere.

E1, opening:
- Section label: "Matchup"
- Title (`type.screenTitle`): "[Away] at [Home]"
- Two team lines, away first: swatch (`hud.teamSwatch`, 12 px square with its ring), "[Away place]" then note "Away"; "[Home place]" then note "Home". The human's line adds the "You" tag (pill, as in the score bug).
- Line (`type.body` `chalkSoft`): visitor is the AI: "The [Away] are the visitors, so they call the toss." Visitor is you: "You're the visitors, so your captain calls the toss."
- Rows: "Space Toss the coin", "Esc Menu" (2).

E1, overtime:
- Section label: "Overtime"
- Title: "Tied at [n]" (the score, both sides equal).
- Line: "Regulation is over. The [Away] are the visitors, so they call the toss." or "Regulation is over. You're the visitors, so your captain calls the toss." A later postseason re-toss: "Still tied after [k] overtime periods." in place of "Regulation is over."
- Rows as the opening.

E2: section label "Coin toss" (replaces "Matchup"; the title and team lines stay). Line: "The [Away] call heads." or "Your captain calls heads." (tails likewise).

E3: adds the line "The coin is in the air."

E4: E3's line is replaced by "It's tails. You win the toss." or "It's heads. The [Winner] win the toss."

E5, you won (opening): section label "Your choice". Rows: "1 Receive" note "you get the ball first"; "2 Defer" note "you get the ball to start the second half"; "Esc Menu" (3).

E5, you won (overtime): rows "1 Receive" note "you get the ball first"; "2 Kick" note "they get the ball first"; "Esc Menu" (3).

E5, they won: line by `about.choice`: defer: "The [Winner] defer. You receive the opening kickoff."; receive: "The [Winner] choose to receive. You kick off."; kick: "The [Winner] choose to kick. You receive the overtime kickoff." (In overtime, "opening" reads "overtime".) Rows: "Space Continue", "Esc Menu" (2).

E6: receive: "You chose to receive. The [Loser] kick off."; defer: "You deferred. You kick off now and receive to start the second half."; kick: "You chose to kick. You kick off."

E7 and E8: section label "Opening kickoff" or "Overtime kickoff". Then the request's own text and rows as built: receiving, `continueText` `theyKickOff` ("The [Kicker] kick off.") with Space Continue, T Timeout if offered, Esc Menu; kicking, the kickoff rows (1 Kickoff, 2 Onside kick, T Timeout, Esc Menu, at most 4).

Live region (polite), one announcement per beat, the card's new line: E1 the title and line together; E2 the call; E4 the result; E5 their choice (they won); E6 your choice; E8 the kickoff text. E3 and E7 announce nothing (no new fact).

Top bar: the game cell says "Coin toss" from the cut until the toss settles (as built), then the normal clock. Its key hints: Space Skip and S Speed (value) on auto beats when there is no rail; Esc Menu on wait beats.

## What the eye reads first

On E1: the title "[Away] at [Home]" (largest text on the card and the only new thing), then the team lines with the "You" tag (where you are), then the Space row (what to do), then the field (the setting, in peripheral vision, which is why it carries nothing yet). On E3: the coin, the only moving thing on screen, then the card line. On E5: the gold selected row, as on every decision screen. Nothing on the field competes with the card on a wait beat: no marks, no lines, no tags but the coin's.

## Layout

- With a rail (`playStage(...).rail` not null): the ceremony card fills the rail slot, top aligned, the rail's width; `color.surface`, `blur.glass`, 1 px `color.hairline`, `radius.lg`, padding 16 px 18 px, `shadow.2`, the rows inside as `hud.playMenu` cards. The keys card (Space, S, M) stays pinned at the rail bottom on auto beats and hides on wait beats (the rows show their own keys).
- No rail (for example 800x528, or 1024x600 at 125% text): the card sits at the bottom of the field column, centered, width `min(420px * text scale, column width - 32px)`, 16 px from the bottom. The coin at the 50 stays in the upper half of the view (the camera puts the 50 at 40% from the top on the toss stage), so the card never covers it.
- If that card would be taller than 45% of the column (for example 800x528 at 200% text), the toss stage falls back to the calling screen layout: field hidden, the ceremony card as the call card, the beats and copy unchanged, the coin replaced by its words. Why: text never clips, and the facts are all in the card.
- Text size scales the card and the coin's tag; the coin itself scales with px per yard, like marks.

## States

| State | What the player sees | Final or open |
|---|---|---|
| Waiting for the first step after Start | Menu mode, "Working..." after 300 ms (main menu spec decision 10) | Final |
| E1 to E8, you won | As the beats table | Final |
| E1 to E8, they won | E6 skipped; E5 shows their choice with Space Continue | Final |
| Worker reply slow after your pick | E6 ends, the card keeps E6's line, "Working..." after 300 ms, E7 starts on the step | Final |
| `answerError` on the toss pick | Existing: the same request's rows come back, status "That choice wasn't accepted (...)." The coin stays on its face | Final |
| Sim error during the ceremony | Existing sim error screen | Final |
| Pause (Esc Menu) from a wait beat, then back | The same beat, same frame; nothing replays | Final |
| Quit to main menu during the ceremony, then Continue | The save holds the toss request; the ceremony starts again at E1 | Final |
| Resume of a save past the toss | No ceremony; the game resumes as built | Final |
| Overtime toss | Decision 10 | Final |
| Speed 2x | Auto beats halved | Final |
| Speed skip | Auto beats 0 ms (Decision 7) | Final |
| Reduced motion (setting on, or system with the setting on system) | No flip: E3 holds its line for `flipMs` with the coin not drawn; at E4 the coin appears resting on its face (a cut). E7: the camera cuts, marks appear lined up with no glide, the coin is removed with no fade. Holds are reading time, so they stay | Final |
| Window too small | Existing too-small screen over everything | Final |
| No rail | Bottom card (Layout) | Final |
| Card too tall for the column | Calling-screen fallback (Layout) | Final |
| Storage blocked | No change: the ceremony needs no storage. The speed set with S lasts for the page (existing) | Final |
| Data error in `motion.json` `entry` | Existing data-failed screen naming data/ui/motion.json | Final |
| Permission-denied beyond storage | Not applicable: no accounts | Final |

## Accessibility (baseline)

- Every fact is text in the card and in the live region (Copy). The coin canvas is `aria-hidden`, like the field.
- Not color alone: the coin's face is a word tag, the "You" tag is a word, sides are words ("Away", "Home").
- Focus sits on the highlighted row on every wait beat (the Space row on E1). On auto beats focus stays on the card, which has `aria-busy="true"` until the next wait beat.
- Reduced motion as in States. Nothing flashes; the flip's scale change is well under three flashes a second of luminance change (about 3.9 half turns per second at 1x is a shape change on a light disc, not a flash; art-director checks it at 2x in Open A2).
- Contrast: card text uses existing pairs (`chalk` 13.92 and `chalkSoft` 7.30 on glass). The coin's `color.outlineDark` ring on turf is 3.33 or better, its tag 14.8 (DESIGN.md Contrast).
- Text at 100% to 200%: the card wraps, never clips; the fallback in Layout covers the smallest window.

## Model output: uncertainty, wrong results, correction

The only engine output in the ceremony is who won the toss (and the AI's choice). It comes from the request (`toss` means you won; `tossResult` names the winner and choice) and the record's toss event, never from the UI. The call and face are derived from it (Decision 4), so the coin can't disagree with the engine. If the request and the later toss event ever disagree, the event wins in the Last play card, the mismatch is logged with the seed, and TC6 catches it in tests. A toss can't be corrected; it is a fact of the seed, reproducible with `pnpm sim:game -- --seed n`.

## Code contract (for engineer and test-writer)

Likely touched:

- New `packages/app/src/ui/ceremony.ts`, no DOM: `tossCall(seed, period)`, `landedFace(call, visitorWon)`, `ceremonyBeats({ kind: "opening" | "overtime", humanWon, human, visitor, winner, choice?, scoreTied?, otPeriodsPlayed? }, entry)` returning the beat list with kind, duration and copy, and `beatsAt(speed)` applying 1x, 2x and skip. All copy functions here or in `text.ts`.
- `data/ui/motion.json` and `packages/app/src/ui/motion.ts`: the `entry` block, version 3, `parseMotion` validates it.
- `packages/app/src/ui/overlay.ts`: `GameScreen` gains `"toss"`; `gameScreen` returns it while a ceremony is active.
- `packages/app/src/ui/layout.ts`: `ceremonyCard(layout, textScale)` returns the rail slot, the bottom card, or the fallback (pure).
- `packages/app/src/ui/app.ts`: `onStep` starts the ceremony on a `toss`, `overtimeToss` or `tossResult` request and keeps the toss stage through the next kickoff request; `onKey` treats auto beats as animating (Decision 7); the card renders rows with the existing `rowButton`; the top bar key hints.
- `packages/app/src/ui/animator.ts`: a coin timeline (or `coin(scene, coinState)`) through the existing frame loop, the midfield idle scene, the pan to the kickoff spot with the existing camera rule (cut with reduced motion), then `kickoffFrame`.
- `packages/app/src/ui/field.ts` or `art.ts`: draws `fx.coin` and its tag.
- `packages/app/src/ui/menu.ts`: notes for Receive, Defer and Kick on the `toss` and `overtimeToss` screens.
- docs/ASSETS.md: planned slot `fx.coin`. docs/RULES.md: the toss caller row with its source (Open A3).
- Not touched: packages/sim, packages/shared, the save, the protocol.

## Amendments to earlier specs

| Where | Was | Now |
|---|---|---|
| m2-screen-switch.md, "What changes" | Coin toss is on the calling screen | From the cut (or an overtime toss) to the snap of the kickoff that follows, the toss stage: field column plus the ceremony card |
| DESIGN.md, Play screen rail | Read only, no choices | On the toss stage only, the rail slot holds the ceremony card with at most 4 rows (Open A1) |
| m2-playable-game-design.md, Coin toss row | "Who won, in one sentence" then the choice | The beats E1 to E8 and their copy |
| m2-playable-game-design.md, Overtime toss row | "As the coin toss" | Decision 10 |
| m2-main-menu.md, decision 10 | The cut lands on the game panel's highlighted row | The cut lands on the toss stage at E1, focus on the Space row, field painted on the first frame |
| menu.ts TITLES `toss`, `overtimeToss` | "Coin toss: you won" | Not shown on the toss stage (the card says it); kept for the fallback layout's heading |

## Acceptance criteria

| # | Criterion | How it fails |
|---|---|---|
| TC1 | A new game's first frame in game mode shows the field painted at midfield (canvas sized to `layoutFor`, non-empty pixels in the column), no marks, the ceremony card at E1 with focus on "Space Toss the coin". | Blank stage, the calling screen, or focus lost. |
| TC2 | No frame from the cut to the opening kickoff's snap hides the field (toss stage, rail or bottom layouts); the field is hidden only in the Layout fallback. | The calling screen appears in the entry. |
| TC3 | The beat order is E1, E2, E3, E4, E5, (E6 if you won), E7, E8, and E1, E5, E8 wait with no timeout (no change after 60 s idle). | Wrong order, an auto wait beat, or a timed-out wait. |
| TC4 | Each auto beat lasts its `motion.json` `entry` value at 1x (within one frame), half at 2x, 0 at skip; changing a value in a test fixture changes the beat; no ceremony duration is a literal in app code (a test greps `ceremony.ts` for numeric ms literals). | A hard-coded or ignored timing. |
| TC5 | `tossCall` is a pure function of seed and period (same inputs, same call; `Math.random` spied, never called in the ceremony). | A random or unstable call. |
| TC6 | For 2,000 seeds, both human sides, opening and overtime: the winner the card names equals the request's (or `peekToss`'s) and the record's toss event's winner; the landed face equals the call iff the visitor won; the AI's choice in the card equals `about.choice`. | Any disagreement. |
| TC7 | The session's input log, record and the outcome digests are identical with the ceremony on, skipped with Space, and at speed skip; packages/sim and the save schema are unchanged. | A new input or a byte difference. |
| TC8 | Space or Enter on an auto beat jumps to the next wait beat with its final frame (coin on its face; units lined up); S cycles and saves the speed; other keys do nothing; a key repeat never skips. | A beat skipped by a repeat, or a buffered key acting later. |
| TC9 | Reduced motion: no frame draws the coin mid-flip, the camera cuts, marks appear with no glide; holds keep their times. | Any motion with reduced motion on. |
| TC10 | Every string in Copy appears exactly as written for its case; no em dash in any ceremony string. | Different text. |
| TC11 | Every wait beat has at most 7 choices (E1 2, E5 at most 3, E8 at most 4), unique keys; it is in the every-screen cap test. | Over 7, or a repeated key. |
| TC12 | Overtime: an `overtimeToss` or overtime `tossResult` request runs E1 (overtime copy) to E8 with Receive and Kick; a postseason re-toss runs it again with "Still tied after [k] overtime periods." | Overtime on the calling screen, or opening copy. |
| TC13 | Layout: rail slot when `playStage` has a rail; bottom card otherwise; the calling fallback when the card would pass 45% of the column; nothing clips at 200% text at 1280x720 and 800x528. | Wrong placement or a clip. |
| TC14 | Quit to main menu at E1 or E5, then Continue: the ceremony starts at E1 and the toss outcome is the same. | A different winner or a skipped ceremony. |
| TC15 | The toss event line is in the Last play card on the first calling screen after the opening kickoff. | The toss leaves no trace. |
| TC16 | The live region gets one announcement per beat as listed in Copy, none on E3 and E7. | Missing or repeated announcements. |
| TC17 | The automated WCAG 2.2 AA check passes on E1, E5 (both cases) and E8 in all three layouts; grayscale screenshot of E4 shows the face tag. | A failure. |
| TC18 | Manual: engineer screenshots of E1, E3 mid-flip, E4 and E8 at 1280x720 and 800x528, reviewed by art-director (Open A2). | Not reviewed. |
| TC19 | Playtest: Joseph starts two new games cold; note whether it still feels "too fast" and how many Space presses he uses (assumptions 1 and 2). In the playtest log. | Not run. |

## Tests to add or change

None is weakened.

| Test | What it checks | Criterion |
|---|---|---|
| New `ceremony.test.ts` (pure) | Beat order both cases and overtime, speeds, `tossCall` determinism, landed face, copy strings | TC3 to TC6, TC10, TC12 |
| New `toss-stage.test.ts` (DOM, jsdom) | First frame, focus, no calling screen in the entry, keys on auto and wait beats, reduced motion, layouts, live region, resume | TC1, TC2, TC8, TC9, TC13, TC14, TC16 |
| session.test.ts | Same record and digests with the ceremony skipped and played | TC7 |
| layout.test.ts, screen cap | Adds E1, E5 and E8 card models | TC11 |
| screen-switch.test.ts | Acceptance 1 now excludes the toss stage; the rule changed, not the check, so the test gains the toss-stage case rather than losing one | TC2 |
| motion.test.ts | `entry` block validates; a missing field fails `parseMotion` | TC4 |
| Scripted UI playthrough (F1) | Both toss outcomes and an overtime toss reach the kickoff snap through the toss stage | TC3, TC12 |
| Accessibility check (X3) | The three wait beats in three layouts | TC17 |

## Art slots for docs/ASSETS.md ("Planned slots")

| slot | added because |
|---|---|
| `fx.coin` | The coin on the field during the toss, its two faces and its flip |
| `hud.ceremonyCard` | The card in the rail slot (or bottom of the column) on the toss stage |

Reused: `hud.teamSwatch`, the "You" tag, `hud.playMenu` and its states, `hud.keyHint`, `field.huddleLabel` (the face tag), every `field.*` slot, `mark.*` for the kickoff lineup.

## Open

For Joseph (only these two need his call):

- **J1. Do you want to call heads or tails yourself when you're the visitor?** It adds one choice before the flip. To be honest it must be a real input the sim records (a new request kind and a record change, so ask-first and its own spec), not a UI-only choice that changes nothing. This build: your captain calls, in words.
- **J2. Should the toss start on its own instead of waiting for Space on the matchup card?** This build waits, so nothing happens until you're ready. Hands-free would be E1 as a 3-second auto beat.

For the lead and art-director (not Joseph):

- **A1 (art-director).** Rows in the rail slot on the toss stage only (Decision 1), against DESIGN.md "the rail holds no menu".
- **A2 (art-director).** The coin's look: face glyphs, size, the flip's half turns and rise, the landing; checked at 1x and 2x for flashing.
- **A3 (lead or engineer).** Cite the opening toss caller (visiting captain) from the 2026 NFL rulebook PDF in docs/RULES.md; the overtime caller is cited from NFL Football Operations, "NFL Overtime Rules" (operations.nfl.com/the-rules/nfl-overtime-rules). If the rulebook says otherwise, Decision 4's caller changes, nothing else.
- **A4 (lead).** Is the `entry` block in data/ui/motion.json an ask-first schema change? It is app-internal, additive, and changes no save, team data or shared type.

Everything else in this file is final.
