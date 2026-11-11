# DESIGN.md: Clipboard Football

Status: DRAFT, awaiting owner approval. Nothing here is final until the owner signs off.

## Vision

A coach's clipboard come to life: ink X's and O's on a paper field, clean enough to read in a glance, nerdy enough to argue over on Monday.

## Palette

Flat colors only. Every color in the game comes from these tokens. Contrast ratios are WCAG 2.x, computed from the hex values.

| Token | Hex | Use |
|---|---|---|
| `color.paper` | #F5F2E8 | Field surface, menu backgrounds |
| `color.paperShade` | #E6E0CF | End zones, selected menu row |
| `color.ink` | #22272B | Main text, field boundary, goal lines |
| `color.inkSoft` | #5C6368 | Secondary text, labels |
| `color.line` | #7E837A | Yard lines, numbers on field |
| `color.hash` | #B9B5A8 | Hash marks only (decoration, not text) |
| `color.offense` | #005A96 | Offense marks and routes |
| `color.defense` | #A84300 | Defense marks and paths |
| `color.ball` | #7A4A1E | Ball |
| `color.panel` | #1F2A30 | Scoreboard and HUD bar |
| `color.chalk` | #F5F2E8 | Text on panel |
| `color.chalkSoft` | #A9B3B8 | Secondary text on panel |
| `color.signal` | #F2B33D | Key state on panel: possession, clock under 2:00, flags |

Offense vs defense pair: blue and orange-brown, darkened from the Okabe-Ito colorblind-safe set (blue #0072B2, vermillion #D55E00). Their luminance is close (1.19:1), so color is never the only cue: offense is always O, defense is always X. A grayscale screenshot must still read.

Contrast checks (text needs 4.5:1, marks and lines need 3:1):

- ink on paper 13.5, on end zone 11.4. inkSoft on paper 5.5, on end zone 4.6.
- offense on paper 6.5, on end zone 5.5. defense on paper 5.4, on end zone 4.6.
- ball on paper 6.6. line on paper 3.5 (non-text, passes 3:1).
- chalk on panel 13.1, chalkSoft on panel 6.9, signal on panel 7.9.
- Not checked yet: a deuteranopia and protanopia simulation pass on the darkened pair. Run it before approval.

## Shapes

- O (offense): circle, stroke 2px at 1x, no fill. Diameter one-third of a yard-line gap at default zoom.
- X (defense): two crossed strokes, same size and stroke as the O.
- Ball: small filled ellipse in `color.ball`, about half the mark size. No laces, no stitching.
- Yard lines: thin `color.line` strokes every 5 yards. Numbers every 10 yards, upright, no arrows.
- Hash marks: short `color.hash` ticks each yard, two rows.
- End zones: `color.paperShade` fill, goal line in `color.ink`. Team name in the end zone in `color.inkSoft`, plain caps.
- Line of scrimmage: solid `color.ink`. First-down line: dashed `color.ink`.
- Play-path lines: offense routes solid in `color.offense` with an arrowhead. Defense paths dashed in `color.defense`. Blocks end in a short perpendicular tick. The ball path is a dotted `color.ball` line.
- Mark labels (position letters) are optional, set in the UI font, inside or beside the mark, never over a path.

## Shading

Flat. One rule only: no gradients, no shadows, no textures, no lighting. Depth comes from layer order (field, paths, marks, ball, HUD).

## Typography

- UI and the why-sentence: Atkinson Hyperlegible, SIL Open Font License 1.1.
- Scoreboard digits, clock, down and distance: IBM Plex Mono, SIL Open Font License 1.1.
- Two fonts maximum. Sentence case for UI text. No handwriting fonts, the clipboard feel comes from layout, not fake handwriting.
- Verify each font's license file at intake and log it in docs/ASSETS.md.

## HUD

- Scoreboard (top bar, `color.panel`): both team names, scores, quarter, game clock, play clock, timeouts as small pips. Possession shown by a `color.signal` dot, not by color of the team name.
- Down and distance: "3rd & 4 at OPP 38", mono font, next to the scoreboard.
- Play menu (bottom panel): at most seven options, each prefixed with its number key ("1 Inside run"). Number keys first, mouse second. The selected row uses `color.paperShade`.
- Why-sentence line: one plain sentence under the field after each play, in `color.ink` on `color.paper`. It shows only factors the engine used. It stays until the next snap.
- Nothing in the HUD covers the line of scrimmage or the ball.

## Motion (play animation)

- The animation reads the PlayResult. It never decides anything.
- Pre-snap: marks set, routes drawn faint (40% opacity) for under a second, then the snap.
- During the play, marks move along straight segments with easing only at start and stop. No squash, no bounce, no camera shake.
- The ball is always visible and always on top of marks.
- Default play length on screen: target 2 to 4 seconds. Speed toggle (1x, 2x, skip) on a number key.
- Key moments (catch, tackle, turnover, score) hold for a short beat so they read at game speed. A flag is a `color.signal` marker, not a full-screen effect.
- After the whistle the paths stay drawn until the next snap, so the player can read what happened.
- Reduced-motion setting: skip to the final frame with paths drawn.

## Art slots for future skins

Code draws through these named slots. A skin replaces a slot's drawing or values, never the game logic. Slot ids are stable once approved.

- `field.surface`, `field.endzone.home`, `field.endzone.away`, `field.yardLine`, `field.yardNumber`, `field.hash`, `field.scrimmageLine`, `field.firstDownLine`
- `mark.offense`, `mark.defense`, `mark.label`, `mark.ballCarrier` (highlight ring), `ball`
- `path.offenseRoute`, `path.defenseRoute`, `path.block`, `path.ball`
- `hud.scoreboard`, `hud.downDistance`, `hud.clock`, `hud.playClock`, `hud.timeouts`, `hud.possession`, `hud.playMenu`, `hud.playMenu.selected`, `hud.whyLine`
- `fx.flag`, `fx.score`, `fx.turnover`
- `team.<id>.name`, `team.<id>.abbrev`, `team.<id>.color` (team colors are for HUD only, never for marks)
- `font.ui`, `font.mono`

## Do

- Big calm field, few focused details. Every detail has a job you can say in one sentence.
- Keep offense O and defense X everywhere, including menus and play diagrams.
- Test every screen at gameplay distance and gameplay speed, in grayscale too.
- Use plain words: "Inside run", not jargon the player has to look up.

## Do not

- Do not add decoration with no job (crowds, stadium lights, grass texture, logos on the field).
- Do not use color alone to carry meaning.
- Do not put more than seven choices on a screen.
- Do not let animation show anything the engine did not decide.

## Banned looks

Any of these is a reject:

- Anything that copies NFL Challenge (XOR, 1985): its screens, layout, names, fonts or art.
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
