# DESIGN.md: Clipboard Football

Status: DRAFT, partly approved. Approved by Joseph on 2026-11-12: the paper field, team colors as HUD swatches only, the portrait field. Everything else is a draft until he signs off. Field sign-off also needs his look at a rendered screenshot (see "Still open").

## Vision

A coach's clipboard come to life: ink X's and O's on a paper field, clean enough to read in a glance, nerdy enough to argue over on Monday. Detailed to the point of a sim without being one: every mark is a real player you can name, and nothing on screen is there for show.

## Palette

Flat colors only. Every color in the game comes from these tokens. Contrast ratios are WCAG 2.x, computed from the hex values.

| Token | Hex | Use |
|---|---|---|
| `color.paper` | #F5F2E8 | Field surface, side column, menu and card backgrounds |
| `color.paperShade` | #E6E0CF | End zones, selected or hovered menu row, rating bar track |
| `color.ink` | #22272B | Main text, field boundary, goal lines, goal posts, scrimmage and first-down lines, ball-carrier ring, outline of signal markers on paper |
| `color.inkSoft` | #5C6368 | Secondary text, labels, dimmed menu rows, calls line, rating bar fill |
| `color.line` | #7E837A | Yard lines, yard numbers |
| `color.hash` | #B9B5A8 | Hash marks only (not text) |
| `color.offense` | #005A96 | Offense marks, their jersey numbers, routes |
| `color.defense` | #A84300 | Defense marks, their jersey numbers, paths |
| `color.ball` | #7A4A1E | Ball and ball path |
| `color.panel` | #1F2A30 | Top bar |
| `color.chalk` | #F5F2E8 | Text on panel |
| `color.chalkSoft` | #A9B3B8 | Secondary text on panel, swatch outline |
| `color.signal` | #F2B33D | Key state: possession dot, clock under 2:00, flag and challenge markers |

Offense vs defense pair: blue and orange-brown, darkened from the Okabe-Ito colorblind-safe set (blue #0072B2, vermillion #D55E00). Their luminance is close (1.19:1), so color is never the only cue: offense is always O, defense is always X. A grayscale screenshot must still read.

Offense blue and defense orange-brown are the same for both teams, every game, on every screen. Team colors never touch marks, paths, the field or end zones (see HUD, team swatches).

Contrast checks (text needs 4.5:1, large text and non-text marks and lines need 3:1):

- ink on paper 13.5, on end zone 11.4. inkSoft on paper 5.5, on end zone 4.6.
- offense on paper 6.5, on end zone 5.5. defense on paper 5.4, on end zone 4.6.
- ball on paper 6.6. line on paper 3.5: passes as a line, and yard numbers pass only because they are large text (24 px or more, see Field).
- chalk on panel 13.1, chalkSoft on panel 6.9, signal on panel 7.9.
- signal on paper 1.7: FAILS 3:1. So any `color.signal` marker on the field or a paper panel gets a 2 px `color.ink` outline (ink against signal 8.1) and a text label. Signal is never used as text on paper.

### Colorblind simulation (done 2026-11-12)

Method:

1. Convert each sRGB hex to linear RGB: c = v/255, then c/12.92 if c <= 0.04045, else ((c + 0.055)/1.055)^2.4.
2. Multiply by the Machado, Oliveira and Fernandes (2009) matrix at severity 1.0 for protanopia, deuteranopia and tritanopia. Clamp to 0..1.
3. Relative luminance L = 0.2126 R + 0.7152 G + 0.0722 B (linear). Contrast = (L1 + 0.05)/(L2 + 0.05).
4. Back to sRGB for the hex: 12.92 c if c <= 0.0031308, else 1.055 c^(1/2.4) - 0.055.

The paper is simulated too, so each ratio is mark against simulated paper. Computed by hand (no script runtime was available), so the hex values may be off by one step per channel. The M2 build adds a unit test that recomputes this table, so the figures are checked by code before field sign-off.

| Vision | Paper | O (offense) | X (defense) | O on paper | X on paper | O vs X |
|---|---|---|---|---|---|---|
| Typical | #F5F2E8 | #005A96 blue | #A84300 orange-brown | 6.46 | 5.41 | 1.19 |
| Deuteranopia | #F5F2E8 | #255195 blue | #796B00 olive | 6.96 | 4.79 | 1.45 |
| Protanopia | #F4F1E7 | #3C5D98 blue | #615400 dark olive | 5.77 | 6.71 | 1.16 |
| Tritanopia | #F7F0EF | #006970 teal | #B92839 red | 5.78 | 5.44 | 1.06 |

Result: PASS for the field. Every mark stays above 4.5:1 on paper under all three simulations, so marks and jersey numbers stay readable. In the end zone (about 0.85 of paper luminance) the lowest is X under deuteranopia, about 4.1:1, above the 3:1 mark rule. The pair keeps a hue split in every case (blue against olive or red). Their lightness is close under protanopia and tritanopia (1.16 and 1.06), which is why shape stays the main cue: this confirms the O and X rule, it doesn't change it.

## Field

The field runs up and down the screen. The team with the ball always attacks up. On a change of possession the view flips, so the team with the ball is always the O's, always moving up.

- Surface: `color.paper`, flat. The playing field is 53.3 yards wide and 120 yards long including end zones, drawn to scale, with a 1.35-yard paper margin outside each sideline so out-of-bounds plays have room to end.
- Boundary: sidelines and end lines in `color.ink`, 2 px.
- Yard lines: horizontal `color.line` strokes, 1 px, every 5 yards, sideline to sideline. Goal lines in `color.ink`, 2 px.
- Yard numbers: every 10 yards (10 to 50 to 10), in `font.mono`, `color.line`, at least 24 px tall at 100% so they count as large text. Upright for the viewer, not turned sideways as on a real field, so they read without tilting your head. One number near each sideline, inset 4 yards, centered on its yard line, with the line broken behind the digits. No arrows.
- Hash marks: short horizontal `color.hash` ticks, 1 yard wide, at every yard between the 5-yard lines, in two columns at the NFL hash positions (70 ft 9 in from each sideline). Job: count single yards of gain at a glance.
- End zones: top and bottom, 10 yards deep, `color.paperShade`. The defending team's name in the end zone in `color.inkSoft`, plain caps, horizontal and upright (the portrait field gives it room).
- Goal posts (`field.goalPost`): on each end line, seen from above. A 2 px `color.ink` crossbar 18 ft 6 in wide centered on the end line, with a 4 px filled `color.ink` dot at each end for the uprights. Job: the target for every kick arc.
- Line of scrimmage: solid `color.ink`, 2 px, horizontal. First-down line: dashed `color.ink`, 2 px.
- Ball spot: the ball sits on the center line of the field unless the PlayResult gives a side. Never imply a hash the engine didn't decide.
- No clipboard frame, clip, wood board or paper texture around the field. The clipboard feel is the paper, the ink and the diagram layout.

### Camera

- The full width, sideline to sideline plus margins, is always visible. The camera pans only up and down.
- Scale is set by the window height: at least 60 yards of field length show. At 1280x720 that is about 11.3 px per yard, and the field column is about 630 px wide.
- The line of scrimmage sits about 65% of the way down the field view, so about 40 yards ahead of the ball and 20 behind are visible at the snap.
- It pans only when the ball would leave the view. With reduced motion it cuts.

## Shapes

- O (offense): circle, 2 px stroke, no fill, 14 px diameter at 100% (minimum 12 px on small windows). Marks are sized in pixels, not yards, so they stay legible on every window.
- X (defense): two crossed strokes, same size and stroke as the O.
- Ball: small filled ellipse in `color.ball`, 7 by 5 px, long axis pointing up the field. No laces, no stitching.
- Jersey number (`mark.number`): every mark carries its player's number. Job: tie the mark to the name in the result line and the player card. `font.mono`, 12 px at 100%, weight 600, in the mark's side color (offense 6.5:1, defense 5.4:1 on paper). It sits on the side of the mark away from the line of scrimmage: under an O, above an X. 2 px gap from the mark.
- Mark label setting: each mark carries one label only. Default is the jersey number. The "Position labels on marks" setting swaps it for the position letters. Never both, never a label over a path.
- Ball-carrier ring (`mark.ballCarrier`): a 2 px `color.ink` ring, 6 px outside the mark.
- Play-path lines: offense routes solid in `color.offense` with an arrowhead. Defense paths dashed in `color.defense`. Blocks end in a short perpendicular tick. The ball path is a dotted `color.ball` line.

### Spacing (settles mark size against lineman spacing)

The line is drawn as a playbook diagram, not to yard scale. Marks never overlap at the snap.

- Center to center along the line: at least the wider of the mark and its jersey number (two digits are about 15 px at 12 px mono) plus a 4 px gap. At 100% that is 19 px, about 1.7 yards at 1280x720.
- Templates in `data/ui/` place players in yards. When the line comes out tighter than the minimum, the renderer spreads it evenly out from the center. Depths (yards off the ball) are never changed, because they are what the player reads.
- Stacked players (backfield, safeties): at least mark + number + 6 px apart up and down. If a template can't fit that, the number moves to the right of the mark.
- During the live play, only the numbers of players the PlayResult names (passer, target, carrier, tackler, sacker, interceptor, recoverer, kicker, returner, fouling player) stay drawn. The rest return at the whistle. When two numbers would collide at the whistle, the named player's number is drawn and the other is hidden. Marks themselves are never hidden.
- With the text-size setting above 100%, numbers scale with it and the spacing rule above widens the line to match.

## Shading

Flat. One rule only: no gradients, no shadows, no textures, no lighting. Depth comes from layer order (field, paths, marks, numbers, ball, markers). The DOM column and top bar sit beside the field, never over it.

## Typography

- UI, the result line and the why line: Atkinson Hyperlegible, SIL Open Font License 1.1.
- Scoreboard digits, clock, down and distance, yard numbers and jersey numbers: IBM Plex Mono, SIL Open Font License 1.1.
- Two families maximum. Sentence case for UI text. No handwriting fonts, the clipboard feel comes from layout, not fake handwriting.
- Verify each font's license file at intake and log it in docs/ASSETS.md.

## Layout (laptop landscape window, 1280x720 reference)

```
+-----------------------------------------------------------------+
| Top bar, full width, color.panel                                |
+---------------------------+-------------------------------------+
| Field column              | Play report (fixed height)          |
| portrait field, paper     |   result line, why line,            |
| about 630 px wide         |   calls line, event lines           |
| 60+ yards of length       +-------------------------------------+
| offense attacks up        | Call panel                          |
|                           |   header: down and distance         |
|                           |   "You're on offense / defense"     |
|                           |   menu rows (at most 7)             |
|                           |   status line                       |
+---------------------------+-------------------------------------+
```

- Field column on the left, side column on the right. The side column takes the width the field doesn't need (at least 400 px, at most 560 px). Extra width on bigger windows goes to the field until 60 yards are shown, then to even margins.
- Side column order is the reading order after a play: what happened, why, then the next call. The play report block has a fixed height so the menu rows never move (muscle memory for number keys). At 200% text size the side column scrolls before it truncates.
- Nothing covers the field. The line of scrimmage and the ball are never under the HUD, because the HUD is never over the field.

## HUD

- Top bar (`hud.scoreboard`, `color.panel`), left to right: away abbreviation with team swatch, score, timeout pips, challenge pips; then home, the same; possession as a `color.signal` dot plus the word "ball"; quarter, game clock and the clock state in words ("running" or "stopped"); tempo when not Normal ("Hurry-up", "Run the clock").
- Timeout pips are small filled circles, challenge pips small filled squares, so the two read apart in grayscale. Each pip group also has a text count for screen readers.
- No play clock. The game is turn-based, so the play-clock run-off shows as the game clock counting down in the pre-snap beat.
- Under 2:00 the clock turns `color.signal` and also shows the text "2:00".
- Team swatch (`hud.teamSwatch`): a 10 px square of `team.<id>.color` with a 1 px `color.chalkSoft` outline (so dark team colors still read on the panel), right before the team name or abbreviation. Used in the top bar, box score headers and the pregame matchup only. The name is always there, so the swatch is never the only team cue.
- Call panel header (`hud.downDistance`): "3rd & 4 at OPP 38" in `font.mono`, 24 px at 100%, the largest text on screen while calling. "You're on offense" or "You're on defense" under it in `font.ui`.
- Play menu (`hud.playMenu`): at most seven rows, each with its key ("1 Inside run"). Number keys first, mouse second. Selected or hovered row (`hud.playMenu.selected`) has a `color.paperShade` fill and a 2 px `color.ink` focus outline when focused by keyboard.
- Off rows (`hud.playMenu.disabled`): `color.inkSoft` text plus the reason in words, "3 Kick (4th down or last 2:00 only)". Never opacity alone.
- Result line (`hud.resultLine`): `font.ui`, 20 px, `color.ink`. What happened, with names.
- Why line (`hud.whyLine`): `font.ui`, 18 px, `color.ink`. Only factors the engine used. Stays until the next snap.
- Calls line (`hud.callsLine`): `font.ui`, 16 px, `color.inkSoft`. "You: Shotgun, Short pass. They: Nickel Cover 1 Blitz."

## Player card

- `card.panel`: `color.paper` with a 1 px `color.ink` border, name, jersey number in `font.mono`, position.
- `card.ratingBar`: flat bar, `color.inkSoft` fill on a `color.paperShade` track, with the number beside it in `font.mono`. The bar never carries the value alone. Bars never use offense or defense colors, because those mean O and X.

## Motion (play animation)

- The animation reads the PlayResult. It never decides anything.
- Pre-snap: marks set, routes drawn faint (40% opacity) for under a second, then the snap.
- During the play, marks move along straight segments with easing only at start and stop. No squash, no bounce, no camera shake.
- The ball is always visible and always on top of marks and numbers.
- Default play length on screen: target 2 to 4 seconds. Speed toggle on S (1x, 2x, skip), live during the animation. Space skips to the end.
- Key moments (catch, tackle, turnover, score) hold for a short beat so they read at game speed.
- Flag (`fx.flag`): a small `color.signal` square with a 2 px `color.ink` outline at the foul spot, plus the text "Flag". Not a full-screen effect, not a red cloth.
- Challenge (`fx.challenge`): the same marker shape at the spot in doubt, plus the text "Challenge". Not a red TV flag.
- Standout (`fx.standout`): the ball-carrier ring plus the text "Standout" by the mark, held 0.8 s. No glow, no burst.
- Score and turnover (`fx.score`, `fx.turnover`): text on the field ("Touchdown", "Interception") in `font.ui`, `color.ink`. A turnover always shows text as well as the change of marks.
- After the whistle the paths stay drawn until the next snap, so the player can read what happened.
- Reduced-motion setting: skip to the final frame with paths drawn.

## Art slots for future skins

Code draws through these named slots. A skin replaces a slot's drawing or values, never the game logic. Slot ids are stable once approved.

- `field.surface`, `field.endzone.home`, `field.endzone.away`, `field.yardLine`, `field.yardNumber`, `field.hash`, `field.goalPost`, `field.scrimmageLine`, `field.firstDownLine`
- `mark.offense`, `mark.defense`, `mark.number`, `mark.label`, `mark.ballCarrier`, `ball`
- `path.offenseRoute`, `path.defenseRoute`, `path.block`, `path.ball`
- `hud.scoreboard`, `hud.teamSwatch`, `hud.downDistance`, `hud.clock`, `hud.clockState`, `hud.tempo`, `hud.timeouts`, `hud.challenges`, `hud.possession`, `hud.playMenu`, `hud.playMenu.selected`, `hud.playMenu.disabled`, `hud.resultLine`, `hud.whyLine`, `hud.callsLine`
- `card.panel`, `card.ratingBar`
- `fx.flag`, `fx.challenge`, `fx.standout`, `fx.score`, `fx.turnover`
- `team.<id>.name`, `team.<id>.abbrev`, `team.<id>.color` (team colors are for HUD swatches only, never for marks)
- `font.ui`, `font.mono`

## Do

- Big calm field, few focused details. Every detail has a job you can say in one sentence.
- Keep offense O and defense X everywhere, including menus and play diagrams.
- Give every mark a real player: a number that leads to a name, a name that leads to a card.
- Test every screen at gameplay distance and gameplay speed, in grayscale too.
- Use plain words: "Inside run", not jargon the player has to look up.

## Do not

- Do not add decoration with no job (crowds, stadium lights, grass texture, logos on the field, a drawn clipboard or clip).
- Do not use color alone to carry meaning.
- Do not put team colors on marks, paths, the field or end zones.
- Do not put more than seven choices on a screen.
- Do not let animation show anything the engine did not decide.
- Do not put HUD or menus over the field.

## Banned looks

Any of these is a reject:

- Anything that copies NFL Challenge (XOR, 1985) or any other game: its screens, layout, names, fonts or art.
- Real NFL team names, logos, marks, uniforms, or player likenesses. Fictional teams only.
- TV broadcast look: glossy score bugs, lens flares, 3D chrome text.
- Gradients, drop shadows, bevels, glows, photo textures, fake paper grain.
- Handwriting or "marker" fonts, sketchy wobble lines.
- Generic AI art tells: gibberish text, melted shapes, extra limbs, inconsistent stroke weights.
- Rendered players or helmets in place of X's and O's in the base game.

## Asset intake checklist

An asset enters the build only when every box is checked:

1. It fills a named slot from the list above.
2. It uses only palette tokens, or a skin's declared tokens.
3. It reads at gameplay distance and speed, next to the reference X and O, and in grayscale.
4. It breaks no banned look.
5. docs/ASSETS.md has a row for it: source, license, AI use (none, or tool and how it was used), date, notes.
6. The license allows shipping in a public build. Fonts include their license file.
7. No real team, league or player names or marks, and no text that is not real words.
8. art-director has marked it ACCEPT.

## Decisions

### 2026-11-12, Joseph

1. Field: paper, cream and ink. Settles paper vs green. Why: every contrast and colorblind figure holds on paper, and it is the clipboard vision.
2. Team colors: a small swatch beside team names only. O and X stay offense blue and defense orange-brown everywhere. Why: color on the field means side, never team.
3. Orientation: portrait field, the team with the ball attacks up. Why: a play reads like a playbook page, one direction, every time. This replaces the spec's "attacks to the right".

### 2026-11-12, art-director, resolving the six conflicts from docs/specs/m2-playable-game-design.md

1. Play clock: dropped from the HUD, slot `hud.playClock` removed. Why: nothing is timed while the player decides, so a play clock would show a number that never matters. The run-off shows on the game clock instead.
2. Speed toggle: S, live during the animation. Why: number keys are menu rows, and the spec ignores number keys during animation so no call is buffered.
3. Menus: in the right-hand side column. Why: with a portrait field, width beside the field is free and height is the field's, so a bottom panel would cost yards of view.
4. Down and distance: in the call panel header, 24 px mono. Why: the eye is on the menu while calling, and it is the one fact every call depends on.
5. Mark size against lineman spacing: marks in pixels (14 px), line spacing as a diagram rule (19 px center to center at 100%), depths kept to template yards. Why: one-third of a 5-yard gap made marks wider than the line, and jersey numbers need room. A playbook diagram is not to scale across the line either.
6. Missing slots: added `field.goalPost`, `card.ratingBar`, `card.panel`, `fx.standout`, `fx.challenge`, `hud.challenges`, `hud.clockState`, `hud.tempo`, `hud.playMenu.disabled`, `hud.resultLine`, `hud.callsLine`. I also added `mark.number` (jersey numbers, Joseph's request) and `hud.teamSwatch` (decision 2). All logged as planned in docs/ASSETS.md.

### 2026-11-12, art-director, other changes in this revision

- Result, why and calls lines move from under the field to the top of the side column. Why: under a portrait field they would cost field length. The spec still says "under the field" and needs to follow.
- Yard numbers set at 24 px or more. Why: `color.line` is 3.5:1 on paper, which passes only as large text.
- Flag and challenge markers on paper get an ink outline. Why: signal on paper is 1.7:1.
- Mark labels: one per mark, jersey number by default, position letters as a setting.
- Banned looks: the copy rule now covers any other game, not only NFL Challenge.

## Still open

- Joseph's look at a rendered field screenshot (normal, grayscale, and the three simulations) before field sign-off. The computed pass is necessary, not sufficient.
- Jersey numbers on marks need jersey numbers in the player data. That is a schema change, which needs Joseph's go-ahead.
- The 19 px line spacing and 14 px marks are a first guess. Check them at gameplay speed with a 5-man line and a goal-line formation.
