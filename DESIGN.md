# DESIGN.md: Clipboard Football

Status: DRAFT. Revision "Prime Time" (art-director, 2026-11-15, from Joseph's 2026-11-15 feedback on the Broadcast build, see Decisions). It builds on "Broadcast": the stage, glass, elevation, rows, marks, Inter and Barlow Condensed all stay. What it adds: a TV-style score bug, a situation plate with a drive tracker on the calling screen, broadcast field paint (blue line of scrimmage, midfield and end zone wordmarks), routes without the candy cane, a ball-carrier trail, named motion "moments", screen transitions, and a hero treatment for the main menu and pregame. One part needs Joseph before it is built: the pre-snap board on the calling screen (Layout, Calling screen), because it brings the field back to a screen he chose to keep field-free on 2026-11-15. Still approved from 2026-11-12: the portrait field. The whole direction stays a draft until Joseph has looked at a rendered screenshot of it (normal, grayscale and the three colorblind simulations, see Still open).

Superseded by Prime Time (kept here so nobody rebuilds them): the 56 px top bar (now 64 px) and `MIN_HEIGHT` 528 (now 536); the score bug's separate pill cells, 6 by 28 px team chip and 34 px score; the down and distance as an Inter header in the call card (now the situation plate, in display caps); the all-dark line of scrimmage (now a cased blue line); "no logos at midfield" (one painted home wordmark is now allowed, nothing else); dashed defense paths and "solid, dashed and dotted keep the three apart" (now weight and end cap); full routes drawn ahead of the runners during the live play (now they draw on behind them); the score and turnover toasts (now moment banners in the same slots); "no swooshes, wipes, staggered entrances" and "nothing else animates in the UI" (now the named moments and transitions in Motion, and nothing outside that list); "nothing covers the field during the play except the player card" (now: during live action; after the whistle a moment banner may cross the half of the field away from the ball); the chalk focus ring on a selected row (now gold).

Superseded by Broadcast (still retired): "flat but bold", "no gradients anywhere, not even subtle ones", "no drop shadows, no glows, no lighting", "depth comes from layer order only", the gold rule under the scoreboard, boxed key chips in menu rows, the paper-slab selected row, IBM Plex Mono, Atkinson Hyperlegible, hollow outlined O marks, stroked text labels on the field, the flush-left field during the play.

## Vision

Game-day football with a coach's eye, presented like a current sports app: a deep navy stage, a glassy score bug, softly lit turf, and X's and O's as clean team-colored chips you can read in a glance and argue over on Monday. Detailed to the point of a sim without being one: every mark is a real player you can name, and nothing on screen is there for show.

Three words to check work against: calm, crisp, lit. Calm: big quiet surfaces and one accent. Crisp: anti-aliased shapes, exact type, tabular numbers. Lit: soft depth (gradient, shadow, blur) that separates layers, never decoration.

Prime Time adds a fourth: live. The screen should feel like a game broadcast between snaps, not a settings page: the situation is always on screen in big condensed numerals, team color sits in big blocks where a TV package puts it (score bug, banners, end zones, the face-off), and the game's big moments get a short, sharp motion graphic. Football fans read these conventions without being taught: the score bug, the yellow line to gain, the blue line of scrimmage, the down and distance plate, the drive tracker, the touchdown banner. The appeal comes from those conventions, never from a real league's marks or a real network's graphics package.

The rule that keeps "live" from turning into noise: motion only ever marks a change the engine made (a score, a down, a possession, a period), or moves you between screens. Nothing loops in a game screen, nothing moves while you are reading a menu, and every moment is skippable and has a still version.

## How depth works

Depth is allowed now, and every effect has one job. Nothing outside this list.

| Effect | Where | Job |
|---|---|---|
| Stage gradient | Behind everything, every screen | Gives the dark background a lit center so it reads as a space, not an empty void |
| Glass (translucent surface plus backdrop blur) | Top bar, cards, rail, sheets | Says "this sits above the stage" while keeping the stage's light |
| Elevation shadows (3 levels) | Cards, selected row, player card, toasts | Orders layers: the higher the layer, the softer and longer the shadow |
| Turf light | Field column | Puts the eye on the middle of the field, where the play is |
| Field shadow | Left and right edges of the field column on the play screen | Lifts the field off the stage so it reads as the main object |
| Mark shadow | Under every mark and the ball | Lifts players off the grass so the eye finds them before the paint |
| Glow | Selected row and the ball-carrier ring only | Marks the one thing you are choosing or the one player with the ball |
| Team block (NEW, Prime Time) | Score bug name plates, moment banners, pregame face-off halves, drive tracker end zones | Puts a team's color where the eye already looks for "who": a solid block, never a tint you have to squint at |
| Carrier trail (NEW, Prime Time) | Behind the ball carrier during the live play | Shows where the ball is heading at speed, so the eye finds it first |

Limits: a gradient stays inside one hue (navy to navy, white to transparent, gold tint to lighter gold tint). No multi-hue or rainbow gradients. Every contrast figure in this file is taken at the worst pixel of any gradient or translucency under it.

## Tokens

Every color, size and timing the app uses comes from here. TS values live in `packages/app/src/ui/tokens.ts`, CSS custom properties in `:root` of `packages/app/src/styles.css`, mirrored. CSS names are the token name in kebab case (`color.surfaceRaised` is `--surface-raised`). Canvas code reads the TS tokens, never a literal.

### Color: stage and surfaces (new)

| Token | Value | Use |
|---|---|---|
| `color.bg` | #0A1428 | Stage base, sticky footer backing (at 0.85 alpha with glass blur) |
| `color.bgTop` | #13264A | Stage gradient light center |
| `color.bgBottom` | #070E1C | Stage gradient far edge |
| `color.panel` | #0F1E3D | Kept. Opaque surface where glass can't be used (menu-mode sheets placed by `placeOverlay`) |
| `color.surface` | rgba(18, 34, 63, 0.72) | Glass cards: calling-screen cards, rail cards, splash art card, top bar body |
| `color.surfaceSolid` | #12223F | `color.surface` where `backdrop-filter` is unsupported, and canvas toasts (at 0.92 alpha) |
| `color.surfaceRaised` | rgba(255, 255, 255, 0.06) | Scoreboard cells, key hints, chips in legends |
| `color.rowRest` | rgba(255, 255, 255, 0.035) | Menu row card at rest |
| `color.hairline` | rgba(255, 255, 255, 0.08) | 1 px card borders, dividers |
| `color.hairlineStrong` | rgba(255, 255, 255, 0.14) | 1 px border on floating sheets, toasts and the player card |
| `color.selectTint` | gradient, see Gradients | Selected row fill |
| `color.selectRing` | rgba(255, 203, 61, 0.40) | 1 px inset ring on the selected row |
| `color.track` | `color.panelRaise` #1B3260 | Rating and progress bar tracks on dark surfaces. Decorative, the value is always printed |

`color.panelRaise` (#1B3260) stays only as the bar track. Its divider job goes to `color.hairline`.

### Color: Prime Time additions

| Token | Value | Use |
|---|---|---|
| `color.scoreBox` | #07101F | Opaque dark box behind each score in the bug, the "You" tag in a name plate, the face-off VS disc. Job: the biggest numbers on screen sit on the darkest, calmest surface |
| `color.los` | #3D8BFF | Line of scrimmage core, on the field, the pre-snap board and the drive tracker. Always cased in `color.outlineDark` (see Field) |
| `color.midfieldPaint` | rgba(245, 247, 242, 0.18) | Midfield home wordmark (`field.midfield`). Never higher: see Contrast |
| `color.trail` | rgba(245, 247, 242, 0.45) | Head stop of the carrier trail (`fx.carrierTrail`); tail stop is the same at 0 |
| `color.bannerStrip` | `color.surfaceSolid` #12223F at 0.96 | Sub line strip under a moment banner |
| `color.driveBand` | team fill of the team with the ball at 0.40 | Drive tracker: the band from where this drive started to the ball. Decorative backing for the ball and lines, which carry the facts |

Team fills, outlines and end zone colors are used as solid blocks in Prime Time (score bug name plates, moment banners, face-off halves, tracker end zones). Text on a team block is always in the slot's outline color (`color.line` on dark tier, `color.outlineDark` on light tier), the pair already checked in the "fill vs outline" column (5.06 or better). A team block next to navy always carries the inset ring from Contrast checks (0.55 white on dark tier, 0.35 on light tier), because black and purple fills vanish against navy without it.

### Color: text and accent (unchanged values, new rules)

| Token | Hex | Use |
|---|---|---|
| `color.chalk` | #F5F2E8 | Strong text on dark surfaces, keyboard focus ring |
| `color.chalkSoft` | #A9B3B8 | Secondary text on dark surfaces: notes, reasons, section labels, key hint numbers, clock state |
| `color.gold` | #FFCB3D | The selection accent and only that off the field: selected row accent bar and ring, selected key hint fill, highlighted play-card ring, the main menu accent bar (`menu.rule`). Nothing decorative is gold |
| `color.signal` | #FFCB3D | Key state: possession glyph, clock under 2:00, first-down line (field, board and drive tracker), flag and challenge markers, the first-down flash in the bug's down block and the "First down" chip (Prime Time, both with `ink` text), the big-play yardage chip's accent bar. Same hex as gold, its own token for its role. Never a moment banner's fill: banners are team color |
| `color.paper` | #F5F2E8 | Light surfaces: player card body, play-card tiles |
| `color.paperShade` | #E6E0CF | Play-card label strip when off, play-card zones and bands, rating bar track on paper |
| `color.ink` | #22272B | Text on paper and on gold |
| `color.inkSoft` | #4F565B | Secondary text on paper, rating bar fill |

### Color: field

| Token | Value | Use |
|---|---|---|
| `color.turf` | #2F7237 | Unchanged. Dark mowing stripe, the bands starting at each goal line |
| `color.turfStripe` | #327739 | CHANGED from #347A3C. Light mowing stripe. Stripe against turf is now 1.07 (was 1.12), so the bands whisper instead of shout |
| `color.sideline` | #2F7237 | Unchanged. Out-of-bounds margin |
| `color.line` | #F5F7F2 | Unchanged. All white field paint, the ball outline, the white ring of dark-tier marks, text on tags |
| `color.hash` | #D5E0D2 | Unchanged. Hash marks |
| `color.outlineDark` | #0A0D0B | Unchanged value. Line of scrimmage casing (was the whole line; the core is now `color.los`), the dark ring of light-tier marks, the first-down line casing, flag marker outline, "First down" chip outline |
| `color.ball` | #7A4A1E | Unchanged |
| `color.tag` | rgba(7, 12, 22, 0.78) | NEW. Pill behind every piece of on-field text except yard numbers and end zone names |
| `color.turfLight` | rgba(255, 255, 255, 0.05) | NEW. Center stop of the turf light |

Retired: `color.offense` (#005A96) and `color.defense` (#A84300). Delete them when team colors reach the field (they still draw the marks in the build today).

### Gradients

| Token | Value |
|---|---|
| `gradient.stage` | `radial-gradient(120% 90% at 50% 0%, #13264A 0%, #0A1428 55%, #070E1C 100%)` on the full window, every screen, both modes |
| `gradient.topBar` | `linear-gradient(180deg, rgba(19, 38, 74, 0.90) 0%, rgba(10, 20, 40, 0.90) 100%)` |
| `gradient.sheen` | `linear-gradient(180deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0) 40%)` layered over `color.surface` on cards. Job: the top edge of a card catches the light, so stacked cards separate |
| `gradient.select` | `linear-gradient(90deg, rgba(255, 203, 61, 0.18) 0%, rgba(255, 203, 61, 0.06) 100%)` selected row fill |
| `gradient.teamTint` | `linear-gradient(90deg, <team fill at 0.14 alpha> 0%, transparent 70%)` over `color.surface`. Prime Time: no longer in the bug (name plates are solid team blocks); now behind the situation plate's down block, tinted by the team with the ball |
| `gradient.teamBlock` (NEW) | `gradient.sheen` over a solid team fill. Moment banners and face-off halves. Job: the block catches the same light as the cards, so it sits in the same world. Worst-pixel contrast in Contrast checks |
| `gradient.trail` (NEW, canvas) | linear along the trail, `color.trail` at the carrier to rgba(245, 247, 242, 0) at the tail. Same hue, white to transparent || `gradient.turfLight` (canvas) | radial, centered on the field column's center and the view's vertical center, inner radius 0, outer radius `0.6 * hypot(columnWidth, viewHeight)`; stops 0: `color.turfLight`, 1: rgba(255, 255, 255, 0). Painted over the turf and stripes, under all field paint. No darkening at the edges: darker edges would push the dark ring under 3:1 (see Contrast) |

### Elevation

| Token | CSS `box-shadow` |
|---|---|
| `shadow.1` | `0 1px 2px rgba(0, 0, 0, 0.24)` |
| `shadow.2` | `0 4px 12px rgba(0, 0, 0, 0.28), 0 1px 3px rgba(0, 0, 0, 0.20)` |
| `shadow.3` | `0 16px 40px rgba(0, 0, 0, 0.45), 0 4px 12px rgba(0, 0, 0, 0.25)` |
| `shadow.select` | `inset 0 0 0 1px rgba(255, 203, 61, 0.40), 0 6px 20px rgba(0, 0, 0, 0.30), 0 0 24px rgba(255, 203, 61, 0.10)` |

Canvas shadows (set `shadowColor`, `shadowBlur`, `shadowOffsetY`, then reset to transparent and 0 before the next draw):

| Token | Color | Blur | Offset |
|---|---|---|---|
| `shadow.mark` | rgba(0, 0, 0, 0.28) | 4 px | 0, 1 px |
| `shadow.field` | rgba(0, 0, 0, 0.50) | 40 px | 0, 0 |
| `shadow.toast` | rgba(0, 0, 0, 0.40) | 12 px | 0, 4 px. Prime Time: also under the "First down" and big-play chips and the moment banner |
| `glow.carrier` | rgba(245, 247, 242, 0.55) | 8 px | 0, 0 |

Canvas shadows are drawn on the mark's outline pass only, never on labels. If 22 shadowed marks cost frames at 60 fps, cache each mark (team, side, size) as an offscreen sprite; the look must not change.

### Radii, blur, spacing

- Radii: `radius.sm` 6 px (key hints, chips), `radius.md` 10 px (rows, scoreboard cells, play cards, toasts), `radius.lg` 14 px (cards, rail cards, splash art card, sheets), `radius.xl` 20 px (player card), `radius.pill` 999 px (tags, "You" tag).
- Blur: `blur.glass` = `backdrop-filter: blur(18px) saturate(140%)` with `-webkit-` prefix. Under `@supports not (backdrop-filter: blur(1px))`, glass surfaces use `color.surfaceSolid` opaque.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48 px. No other gaps or paddings.

### Motion (UI)

| Token | Value |
|---|---|
| `dur.fast` | 120 ms (press, key hint color) |
| `dur.base` | 180 ms (selection move, hover, card lift) |
| `dur.slow` | 260 ms (toasts in) |
| `dur.screen` | 240 ms (calling and play screens crossfade, menu screen push) |
| `dur.tick` | 360 ms (NEW: score odometer, down block swap, possession glyph slide) |
| `dur.snap` | 320 ms (NEW: board-to-field transition at the snap, field-to-board at the end of the hold) |
| `dur.wipe` | 220 ms (NEW: a team block wiping in or out in a moment) |
| `ease.standard` | `cubic-bezier(0.2, 0, 0, 1)` (anything that moves and stays) |
| `ease.out` | `cubic-bezier(0, 0, 0.2, 1)` (things arriving) |
| `ease.slam` | `cubic-bezier(0.05, 0.7, 0.1, 1)` (NEW: moment text arriving; fast in, hard stop, no overshoot) |
| `ease.exit` | `cubic-bezier(0.4, 0, 1, 1)` (NEW: a moment banner leaving. Only moments leave with motion; screens still hide in one frame) |

Moment durations (how long each moment holds the screen) are pacing, not style: they live in `data/ui/motion.json` under `moments`, with the values in Motion as the designed defaults. CSS and TS read the tokens above for how things move; the data file says for how long.

No bounce, overshoot or spring curves. With reduced motion every UI transition is 0 ms (the existing `prefers-reduced-motion` rule stays, and the in-game reduced-motion setting does the same).

## Team colors

Unchanged from Stadium grass. Each team slot has a fill, an outline and an end zone color. Slots are by league index mod 8, in `packages/app/src/ui/tokens.ts` (`SWATCHES` holds the fills; add parallel `TEAM_OUTLINE` and `TEAM_END_ZONE` arrays and replace the old placeholder fills, which still include a green family). No schema change.

Two tiers. Dark-tier fills take a `color.line` (white) ring, light-tier fills a `color.outlineDark` ring. Text on a team fill (player card header) uses the slot's outline color.

| Slot | Team it was picked for | Fill | Family | Tier | Outline | End zone | Fill L | Fill vs outline | Fill vs turf (light / dark stripe) | Swatch on panel | White name or white outline on end zone | Dark outline on end zone |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Harborview Lanterns (lantern flame) | #F29A2E | orange | light | outlineDark | #B85A1E | 0.422 | 8.78 | 2.36 / 2.63 | 7.41 | 4.31 | 4.20 |
| 1 | Red Mesa Comets | #C62F2F | red | dark | line | #CC4A3C | 0.142 | 5.06 | 1.04 / 1.07 | 3.02 | 4.22 | 4.29 |
| 2 | Cobalt Bay Herons | #3263D2 | blue | dark | line | #3263D2 | 0.143 | 5.06 | 1.04 / 1.07 | 3.02 | 5.06 | 3.58 |
| 3 | Saltmarsh Otters (wet silver) | #C3CCD3 | neutral | light | outlineDark | #5E6B78 | 0.595 | 11.99 | 3.23 / 3.60 | 10.13 | 5.06 | 3.58 |
| 4 | Iron Hollow Smelters (black iron) | #1D1E22 | neutral | dark | line | #62666C | 0.013 | 15.44 | 3.17 / 2.84 | 1.01 | 5.35 | 3.38 |
| 5 | Northgate Sentinels (royal purple) | #7A4EBA | purple | dark | line | #7A4EBA | 0.131 | 5.37 | 1.10 / 1.01 | 2.85 | 5.37 | 3.37 |
| 6 | Lake Verity Loons (dusk lilac) | #B99BE8 | purple | light | outlineDark | #7656B0 | 0.396 | 8.29 | 2.23 / 2.49 | 7.00 | 5.22 | 3.47 |
| 7 | Brightwater Kingfishers (kingfisher blue) | #45A8E6 | blue | light | outlineDark | #1F6FA8 | 0.350 | 7.44 | 2.00 / 2.23 | 6.28 | 5.00 | 3.62 |

The "fill vs turf" column was computed against the old light stripe (#347A3C); against #327739 every figure sits between its two old values. It is information only: the ring carries every mark.

Matchup rule (unchanged in code): a matchup never pairs two slots from the same family or with a fill luminance ratio under 1.4 (`SWATCH_MIN_RATIO`, `matchupSwatches`). `matchupSwatches` must resolve the field colors, not only the swatches: the marks, paths and end zones of a game use the two slots it returns. There is no green family, because a green team would vanish on grass.

## Contrast checks

WCAG 2.x. Text needs 4.5:1, large text (24 px, or 18.66 px bold) and non-text marks and lines need 3:1. Hand-computed 2026-11-15 by art-director with the formula in Colorblind simulation; may be off by a few hundredths. Translucent values were blended in sRGB over the worst pixel under them.

Dark surfaces:

- Stage: `chalk` 13.36 and `chalkSoft` 7.00 at the lightest stage pixel (#13264A); higher everywhere else (16.39 and 8.60 on #0A1428).
- Glass card (`color.surface` over #13264A): `chalk` 13.92, `chalkSoft` 7.30. Opaque fallback `surfaceSolid`: 14.13 and 7.41.
- Row at rest, and anything on `surfaceRaised`: `chalk` 11.72 or better, `chalkSoft` 6.15 or better.
- Key hint (raised over a row): `chalkSoft` number 5.50.
- Selected row, at the gradient's gold end (0.18): `chalk` 9.20, `chalkSoft` notes 4.83. Gold accent bar against that fill 6.8. Selected key hint: `ink` on gold 9.95.
- Scoreboard team cell, at the team tint's strongest pixel (top bar top stop over #13264A, then `surfaceRaised`, then the team fill at 0.14): `chalk` 8.15 or better (silver 8.15, lilac 8.78, azure 8.93, orange 8.98). Corrected 2026-11-15 from test-writer's recompute in packages/app/test/broadcast.spec.test.ts; the first figures left out `surfaceRaised`.
- Team chip on the bug: black (1.01) and purple (2.85) fall under 3:1 on navy, so every chip and swatch has a 1 px inset ring. Dark-tier fills (red, cobalt, black, purple): rgba(255, 255, 255, 0.55). Light-tier fills (orange, silver, lilac, azure): rgba(255, 255, 255, 0.35). Black, the worst case, is 4.65 against its own tinted cell (it was 2.53 at 0.35, a fail). The team name is always beside the chip, so color is never the only team cue.
- `signal` clock in the game cell 8.30. Under-2:00 tag (`signal` text on gold at 0.16 over the cell) 5.81. Corrected 2026-11-15 from test-writer's recompute (were 9.87 and 6.9).
- Paper surfaces unchanged: `ink` on paper 13.46, `inkSoft` on paper 6.66, `inkSoft` on paperShade 5.66.
- Score and turnover toast: `chalk` on `surfaceSolid` 14.13 (13 or better at 0.92 over turf).

Field:

- Field paint: `line` on turf 5.43 (dark stripe), 5.07 (light stripe), 4.58 at the turf light's center on the light stripe (the worst pixel). Yard numbers and end zone names are large text, so they pass with room. No normal-size text sits on bare turf: it is all on tags.
- Yard lines at 0.8 alpha: 4.12 on the dark stripe, 3.55 at the lit light stripe.
- `hash` on turf 4.30, light stripe 4.02, lit light stripe 3.62.
- `outlineDark` (line of scrimmage, dark rings, first-down casing): 3.33 on the dark stripe, 3.56 on the light stripe. The turf light only raises this.
- `signal` first-down core alone: 3.87 dark stripe, 3.61 light stripe, 3.26 at the lit light stripe. The `outlineDark` casing carries the line in every case (see Colorblind).
- Tag pills: `line` text on `color.tag` 14.8 at the lit light stripe, 13 or better over any end zone.
- Mark ring vs turf: white ring 4.58 or better, dark ring 3.33 or better. Fill vs ring 5.06 or better (the "fill vs outline" column). The mark shadow darkens the turf just under a mark's bottom edge; the 3:1 ring check is taken on the top edge, away from the shadow, and the fill-to-ring band reads on every side.
- End zones: unchanged figures. The turf light can fall over an end zone; at 0.05 it keeps white names and white rings above 3.9 (red end zone, the lowest) and lifts dark rings.

Prime Time additions (hand-computed 2026-11-15 by art-director, same method; to be rechecked in code like the rest):

- Score box: `chalk` on `color.scoreBox` 17.0. `signal` possession glyph on it 12.6. "You" tag (`chalk` on `scoreBox`) 17.0.
- Name plate (solid team fill): name and timeout bars in the slot's outline color, 5.06 or better (red and cobalt lowest, the "fill vs outline" column). Spent timeout bars are the outline color at 0.30 on purpose: they should read as gone. The count is in the DOM for screen readers as built.
- Name plate edge against the bar: the chip inset ring rule (0.55 white on dark tier, 0.35 on light tier). Black, the worst, keeps 4.65 or better against the bar.
- Down block first-down flash: `ink` on `signal` 9.95.
- Situation plate: `chalk` on `gradient.teamTint` over glass 8.15 or better (the Broadcast bug-cell figure is the worst case, since glass over the stage is darker than the top bar's top stop plus `surfaceRaised`). `chalkSoft` 4.83 or better.
- Moment banner, `gradient.teamBlock`, text in the outline color at the sheen's brightest pixel: red 4.74 (lowest), cobalt 4.74, purple about 5.0, black 15 or better; light-tier fills get lighter under the sheen, so their dark text only gains (azure 7.44 or better). Banner words are display 700 at 56 px and up, large text, needing 3:1. Sub line: `chalk` on `color.bannerStrip` 14 or better over any turf.
- "First down" chip: `ink` on `signal` 9.95. Its edge on turf is the 1.5 px `outlineDark` outline, 3.33 or better, because gold alone falls to 2.85 under protanopia at the lit center.
- Big-play chip: `chalk` on `color.tag` 14.8.
- Line of scrimmage: `color.los` core against its `outlineDark` casing 5.89. Core alone on turf 1.77 (dark stripe), 1.65 (light), 1.49 (lit): the casing carries the line at 3.33 or better, exactly as the first-down line's casing does.
- Line of scrimmage against the first-down line (both cores): 2.19 typical, 1.76 protanopia, 2.51 deuteranopia, 2.07 tritanopia. They are also told apart without color: the ball sits on the line of scrimmage, the pre-snap down tag sits on it, and in grayscale the blue core is mid-gray against the gold's near-white.
- Midfield paint (`color.midfieldPaint` over turf): the paint itself is 1.41 against turf at most, quiet on purpose. A white mark ring over it: 3.78 (dark stripe), 3.60 (light), 3.34 (lit, the worst); 3.17 or better under protanopia. A dark ring or any casing over it: 4.78 or better. Do not raise the paint above 0.18: at 0.22 the lit white ring drops to 3.04.
- Pregame face-off: text on `gradient.teamBlock` as the banner (4.74 or better, large text). VS: `chalk` on `scoreBox` 17.0. Tale-of-the-tape values: leading side `chalk` 13.92, trailing side `chalkSoft` 7.30 on glass. Tape bars in team fills carry the inset ring; the value is always printed.
- Gold focus ring on the selected row (Rows): `gold` against the stage behind it 9.87 or better.
- Carrier trail, drive band: decorative backing, no figure needed. The trail is drawn under every mark and never over the ball; the drive band sits under the ball, the lines and the end zones of the tracker.

### Colorblind simulation (redone 2026-11-15 for the Broadcast revision)

Method:

1. Convert each sRGB hex to linear RGB: c = v/255, then c/12.92 if c <= 0.04045, else ((c + 0.055)/1.055)^2.4.
2. Multiply by the Machado, Oliveira and Fernandes (2009) matrix at severity 1.0 for protanopia, deuteranopia and tritanopia. Clamp to 0..1.
3. Relative luminance L = 0.2126 R + 0.7152 G + 0.0722 B (linear). Contrast = (L1 + 0.05)/(L2 + 0.05).
4. Back to sRGB for the hex: 12.92 c if c <= 0.0031308, else 1.055 c^(1/2.4) - 0.055.

The hand figures fold steps 2 and 3 into one weight row per simulation (protanopia 0.1140 R + 0.7827 G + 0.1034 B, deuteranopia 0.2776 R + 0.6670 G + 0.0554 B, tritanopia 0.2112 R + 0.6993 G + 0.0895 B, linear), which skips the clamp. The code test does the full method.

What changed since Stadium grass: the light stripe moved to #327739, the turf light lifts the center by up to 5% white, marks are filled discs and rounded X's with the same ring colors, and the first-down line gained a dark casing. Team fills, rings and end zones did not change, so the team-against-team and end zone figures stand.

"Lit" is the light stripe under the turf light's center, the worst pixel for white and for gold.

| Vision | Turf L (light / dark / lit light) | White ring on turf (light / dark / lit) | Dark ring and first-down casing (light / dark) | Gold first-down core alone (light / dark / lit) | Lowest fill vs ring | Lowest allowed matchup |
|---|---|---|---|---|---|---|
| Typical | 0.142 / 0.129 / 0.162 | 5.07 / 5.43 / 4.58 | 3.56 / 3.33 | 3.61 / 3.87 / 3.26 | 5.06 (red, cobalt) | silver vs lilac 1.45 |
| Protanopia | 0.152 / 0.139 / 0.174 | 4.81 / 5.15 / 4.35 | 3.77 / 3.52 | 3.15 / 3.37 / 2.85 | 4.47 (cobalt) | silver vs lilac 1.46 |
| Deuteranopia | 0.134 / 0.122 / 0.154 | 5.28 / 5.65 / 4.76 | 3.43 / 3.21 | 3.96 / 4.23 / 3.56 | 4.28 (red) | silver vs lilac 1.43 |
| Tritanopia | 0.139 / 0.127 / 0.160 | 5.14 / 5.50 / 4.63 | 3.53 / 3.29 | 3.61 / 3.86 / 3.26 | 5.17 (purple) | silver vs lilac 1.42 |

Result: PASS by hand. The gold core alone drops to 2.85 under protanopia at the lit center, which is why the first-down line is always cased: the casing is the 3:1 cue (3.21 or better in every simulation) and the gold is the "this is the line to gain" cue. The tightest remaining figure is the dark ring on the dark stripe under deuteranopia (3.21). Do not darken the turf anywhere (no edge vignette on the turf, no shadow wider than `shadow.mark`). Shape (disc or X) carries the side and the ring carries the mark, so a team pair that loses its hue under simulation still reads.

## Typography

Two families. The third slot is left empty on purpose.

- `font.ui`: Inter (variable, weights 400 to 700 used), SIL Open Font License 1.1. Every UI word, every number off the field (clock, scores in tables, ratings), mark labels and on-field tags. Numbers that line up or tick (clock, scores, ratings, box score columns, the down and distance) use `font-variant-numeric: tabular-nums`. Turn on Inter's tailed lowercase l and seriffed capital I (`font-feature-settings: "cv05" 1, "cv08" 1` in Inter 4.x; confirm the feature tags in the shipped version at intake) so l, I and 1 read apart, the job Atkinson Hyperlegible did.
- `font.display`: Barlow Condensed, 600 and 700, SIL Open Font License 1.1. Block caps only. Used for: team names, score digits, period and down and distance in the score bug; the situation plate's down, distance and spot; screen titles; the main menu wordmark; yard numbers, end zone names and the midfield wordmark; the down tag; moment words and chips; face-off names and scores; the line score. Use tabular figures for score digits if the font has them (check at intake); if not, each score sits in a fixed-width box (`min-width: 2ch`, right aligned) so the bug never shifts.
- `font.mono`: retired. IBM Plex Mono is not shipped. Tabular Inter does every job mono did.
- Why Inter: it is the face current product and sports apps are built on, so it reads as modern at once; one variable file gives the whole weight range for hierarchy (Atkinson Hyperlegible's original release has 400 and 700 only); its tabular figures let it replace mono, which was the loudest retro cue on screen; and its tall x-height holds up at 12 to 13 px on the field. Why Barlow Condensed stays: narrow block caps are what a score bug and painted field lettering need, and it is already approved and wired as one variable.
- Variables: `--font-ui: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;` and `--font-display: "Barlow Condensed", "Inter", system-ui, sans-serif;`. Every use reads the variable. TS mirrors them as `FONT_UI` and `FONT_DISPLAY`.
- Bundled locally (intake done 2026-11-15, docs/ASSETS.md "Bundled fonts"): woff2 files and each family's OFL license file in the repo, loaded by `@font-face` with `font-display: swap`. No CDN, no `@import`, no Google Fonts link, no substitute condensed face (Impact, Arial Narrow, Oswald or the like). Canvas waits for `document.fonts.load()` of the faces it uses and redraws when `document.fonts.ready` resolves.
- Sentence case for UI text. Block caps only in `font.display`. No handwriting, marker or pixel fonts.
- Prime Time: the display face works harder. Every number that tells the game state at a glance (scores, down and distance, the spot, yardage in moments, quarter scores in the line score, face-off scores) and every screen header is Barlow Condensed caps. Inter keeps sentences, rows, notes, the clock and tables. Why the clock stays Inter: it ticks during the run-off, and Inter's tabular figures are confirmed while Barlow's are not (Still open). The two faces meet in the bug the way a TV bug pairs a condensed display face with a plain text face. Only roman 600 and 700 are bundled: no italic or slanted display type, no faux italic (`font-style: oblique` or a skew transform on text).

Type scale (CSS sizes are times `var(--text-scale)`; canvas sizes are times the text scale; every `type.bug*` size uses `--bar-scale` as before):

| Token | Face | Weight | Size / line height | Notes |
|---|---|---|---|---|
| `type.hero` (NEW) | display | 700 | 88 / 0.92 | Main menu wordmark. caps, letter-spacing 0.005em. Replaces `type.wordmark` 56 on the main menu |
| `type.wordmark` | display | 700 | 56 / 1.0 | caps, letter-spacing 0.01em. Kept for the window-too-small screen and narrow menu frames (under 720 px) |
| `type.screenTitle` | display | 700 | 40 / 1.0 | CHANGED from Inter 28: caps, letter-spacing 0.01em ("PREGAME", "SETTINGS", "HALFTIME") |
| `type.plateDown` (NEW) | display | 700 | 52 / 0.95 | Situation plate down and distance, "3RD & 4". tabular figures if the font has them, else fixed digit boxes as the score |
| `type.plateSpot` (NEW) | display | 600 | 28 / 1 | Situation plate spot, "OPP 38", caps |
| `type.momentWord` (NEW) | display | 700 | 72 / 0.95 | Moment banner word, "TOUCHDOWN"; 56 when the column is under 600 px, never under 48. caps, letter-spacing 0.02em |
| `type.momentSub` (NEW) | ui | 600 | 18 / 1.2 | Banner sub line, tabular |
| `type.chip` (NEW) | display | 700 | 24 / 1 | "FIRST DOWN" chip, big-play yardage "+34", caps, tabular |
| `type.faceoffName` (NEW) | display | 700 | 64 / 0.95 | Pregame, halftime and end-of-game nickname, caps; 48 under 900 px content |
| `type.faceoffScore` (NEW) | display | 700 | 96 / 0.9 | Halftime and end-of-game scores, tabular |
| `type.callHeader` | ui | 700 | 28 / 1.2 | RETIRED from the call card when the situation plate ships; the card's header becomes the `type.label` breadcrumb ("Play type", "Pass, Shotgun") |
| `type.result` | ui | 600 | 20 / 1.35 | |
| `type.body` (why line, tagline at 18) | ui | 400 | 17 / 1.45 | |
| `type.row` | ui | 500, 600 when selected | 17 / 1.3 | |
| `type.note` (row notes, reasons, calls line, side line) | ui | 400 | 15 / 1.4 | `chalkSoft` |
| `type.label` (section labels like "Play type") | ui | 600 | 13 / 1.2 | `chalkSoft`, letter-spacing 0.02em, sentence case |
| `type.key` (key hints, legend keys) | ui | 600 | 13 / 1 | tabular |
| `type.small` (clock state, legend labels, "You" tag) | ui | 500 | 12 / 1.2 | |
| `type.bugName` | display | 700 | 22 / 1 | CHANGED from 600 20. caps, letter-spacing 0.03em |
| `type.bugScore` | display | 700 | 44 / 1 | CHANGED from 34. tabular |
| `type.bugClock` | ui | 700 | 24 / 1 | CHANGED from 22. tabular |
| `type.bugPeriod` (NEW) | display | 700 | 16 / 1 | "1ST", "HALF", "FINAL", caps |
| `type.bugDown` | display | 700 | 26 / 1 | CHANGED from 22. caps |
| Canvas `field.yardNumber` | display | 700 | 26 px, never under 24 | |
| Canvas `field.endzone` names | display | 700 | sized to the end zone, see Field; never under 28 px | caps, letter-spacing 0.06em |
| Canvas `field.midfield` (NEW) | display | 700 | cap height 3 yards, see Field | caps, letter-spacing 0.04em |
| Canvas `mark.label` | ui | 600 | 12 px | |
| Canvas tags (Huddle, Flag, Challenge, Standout, down tag) | ui | 600 | 14 px | the down tag is display 700 16 px caps |
| Canvas toast (`fx.score`, `fx.turnover`) | display | 700 | 22 px | RETIRED: these slots now draw moment banners (`type.momentWord`) |

## Field

The field runs up and down the screen. The team with the ball always attacks up. On a change of possession the view flips, so the team with the ball is always the O's, always moving up. Anti-aliased everywhere; 1 px lines snap to half pixels so they stay sharp.

- Surface: mowing stripes in 5-yard bands, goal line to goal line, alternating `color.turf` and `color.turfStripe`, starting with `turf` at each goal line. Bands are fixed to the field and pan with it. Job: 5-yard chunks readable at a glance. The playing field is 53.3 yards wide and 120 long including end zones, drawn to scale, with a 1.35-yard `color.sideline` margin outside each sideline.
- Turf light (`field.light`): `gradient.turfLight` over turf, stripes and end zones, under all paint. Fixed to the view, not the field, so it does not pan.
- Boundary: sidelines and end lines `color.line`, 3 px, full opacity.
- Yard lines: `color.line` at 0.8 alpha, 1 px, every 5 yards. Goal lines `color.line`, 3 px, full opacity. Job of the softer yard lines: the field reads as calm turf with lines on it, and the goal lines stand out from the rest.
- Yard numbers: every 10 yards, `type` per the scale, `color.line` full opacity, upright, inset 4 yards, the line broken behind the digits (skip the segment, no box). No arrows.
- Hash marks: `color.hash` ticks, 1 yard wide, every yard between the 5-yard lines, at the NFL hash positions (70 ft 9 in from each sideline). Job: count single yards of gain.
- End zones: flat `team.<id>.endZone`, 10 yards deep, the defending team's name in `color.line`, display 700 caps, upright. No logos, no stripes, no outline on the letters. Prime Time sizing: the name fills the end zone the way painted end zones do. Font size is the smaller of (a) a cap height of 5 yards (`5 * s / 0.70`, Barlow's cap height is about 0.70 em; measure it at intake) and (b) the size at which `measureText` gives a width of 0.8 times 53.3 yards; never under 28 px. Centered in the end zone, letter-spacing 0.06em. Job: says whose end zone it is from across the screen, and makes reaching it feel like reaching their ground.
- Midfield wordmark (`field.midfield`, NEW): the home team's name (`team.<id>.abbrev`, today the nickname in caps) centered on the 50-yard line and the field's center line, upright, display 700, cap height 3 yards, shrunk to fit if wider than 30 yards, in `color.midfieldPaint` (white at 0.18). No ring, no disc, no outline, no second color. Paint order: turf, stripes, turf light, midfield wordmark, then every line and number, so the 50-yard line and hash marks run over it. Job: marks the middle of the field and names the home team, whose home field the engine credits. It is the only painted art on the field.
- Goal posts (`field.goalPost`): on each end line, from above. A 2 px `color.line` crossbar 18 ft 6 in wide with round caps and a 4 px filled `color.line` dot at each upright.
- Line of scrimmage (`field.scrimmageLine`): CHANGED. Solid `color.los` 3 px core with a 1 px `color.outlineDark` casing on each side (5 px total), round caps, sideline to sideline. Was all `outlineDark`, which read as one more painted line. Blue for the line of scrimmage and yellow for the line to gain is the convention every football viewer already reads; the casing keeps it at 3:1 on turf, as it does for the first-down line.
- First-down line (`field.firstDownLine`): solid `color.signal` 3 px with a 1 px `color.outlineDark` casing on each side (5 px total), round caps. Unchanged. When the line to gain is the goal line, no first-down line is drawn (the goal line already is it). In grayscale the first-down core is near white and the line of scrimmage core mid-gray, both with dark edges; the ball and the down tag sit on the line of scrimmage only.
- Down tag (`field.downTag`, NEW): on the pre-snap board and in the play's set phase only. A `color.tag` pill, `radius.pill`, 22 px tall, 8 px horizontal padding, display 700 16 px caps `color.line`, the same text as the bug's down block ("3RD & 4", "1ST & GOAL"). It sits 4 px above the line of scrimmage, its left edge 1 yard inside the left sideline; if it would overlap a yard number it moves right until it clears. It fades out over `dur.base` at the snap. Job: names the line of scrimmage for anyone who can't tell blue from gold, and puts the down where the eye already is.
- Lines during the play: the line of scrimmage and first-down line stay drawn through the live play and after the whistle, as now, under every mark and path.
- Ball spot: the ball sits on the center line of the field unless the PlayResult gives a side.
- Pre-snap preview art (coverage zones and depth bands): fills `color.line` at 10% times the route opacity, zone edges solid (CHANGED from dashed, the same candy-cane problem as the paths), 1.5 px in the defense team's fill over 3 px of its ring color, round caps and joins. Tethers in the defense fill, the generic offense circle in the offense fill, both ringed.
- Field shadow (`field.shadow`): on the play screen, `shadow.field` cast by the field column onto the stage, left and right. Drawn only when the view is wider than the column. Not on the splash (the splash card has its own `shadow.2`).
- Outside the column, the canvas is transparent (`clearRect`), and the stage gradient shows from CSS. The canvas never paints the stage.
- No grass blades, noise, photo texture, logos (the midfield wordmark is a name in the display face, not a logo), crowds or stadium.

### Camera

- The full width, sideline to sideline plus margins, is always visible. The camera pans only up and down.
- At least 50 yards of field length show (`VISIBLE_YARDS`). At 1280x720 that is about 13.3 px per yard and a 734 px column.
- The line of scrimmage sits about 70% of the way down the view at the snap.
- It pans only when the ball would leave the view. With reduced motion it cuts.

## Marks

Shape is the side cue: a disc is offense, an X is defense, on every screen, for both teams. Color is the team cue. Color never says the side on its own. Mark size `markPx` stays as built: 1.4 yards, never under 14 px. The drawn footprint, ring included, is `markPx` across, so the spacing rules and tests stand.

- O (`mark.offense`): a filled disc. Fill: team fill. Ring: 1.5 px in the team's ring color (white for dark tier, `color.outlineDark` for light tier), stroked on a circle of radius `markPx / 2 - 0.75`, so its outer edge sits at `markPx / 2`. `shadow.mark` on the disc. Job of the fill: the team reads as a solid chip at any speed, where a thin hollow ring went to mush.
- X (`mark.defense`): two crossed strokes corner to corner in the same box as today (half-diagonal `(markPx / 2 - 1) * 0.707 * 1.2`), round caps. Drawn twice: first 6 px in the ring color, then 3.5 px in the team fill. `shadow.mark` on the first pass only.
- Ball (`ball`): filled ellipse in `color.ball`, 5 by 7 px at scale 1, long axis up the field, 1.5 px `color.line` outline, `shadow.mark`. No laces.
- Mark label (`mark.label`, `mark.number`): one label per mark, the overall by default, the jersey number by setting (Joseph, 2026-11-14). Never both, never over a path. Drawn as a tag: `color.tag` pill, `radius.pill`, 14 px tall, 2 px horizontal padding, text Inter 600 12 px `color.line`, centered. Under an O, above an X, 2 px off the mark (outside the ring when ringed). Width for placement: `measureText` plus 4 px; until that lands, `labelWidth` keeps its 0.62 em per character estimate plus 4 px, an upper bound for Inter digits. Job of the pill: the number is crisp on any stripe or end zone without the heavy stroked outline.
- Ball-carrier ring (`mark.ballCarrier`): 2 px `color.line` ring, 6 px outside the mark, with `glow.carrier`. The player-card focus ring is the same ring without the glow.
- Paths: CHANGED in Prime Time. The candy cane came from dashing both strokes of a team-fill-over-white path, which turned every defender's drop into a red-and-white barber pole. Now every path is solid, and side is told by weight and end cap (and, always, by the mark it leaves from):
  - Offense routes (`path.offenseRoute`): team fill 3 px over the ring color 5.5 px, round caps and joins, ending in an arrowhead (two 8 px strokes at 30 degrees, same two passes).
  - Defense paths (`path.defenseRoute`): team fill 2 px over the ring color 4 px, round caps and joins, ending in a filled dot 6 px across in the team fill with a 1.5 px ring. No dashes. A zone drop ends on its dot; a blitz path ends on its dot at the point of attack.
  - Blocks (`path.block`): the offense weight, ending in a 10 px perpendicular tick.
  - Ball path (`path.ball`): dotted `color.line`, 2 px (dot 2, gap 5), round caps, above routes. The only dotted line on the field.
  - In grayscale: thick with an arrow (offense), thin with a dot (defense), dotted (ball).
  - Draw-on: pre-snap, routes show faint (40%) in full as now. At the snap the faint preview fades out over `dur.base`, and each path then draws on behind its mark as the mark runs: the drawn length is the mark's progress along it, so a path never runs ahead of its player. After the whistle every path is drawn in full and stays until the next snap. Reduced motion and Skip: full paths, final frame, as now. Job: during the live play the eye reads movement instead of a web of lines; after the whistle the full diagram is there to argue over.
- Carrier trail (`fx.carrierTrail`, NEW): behind the player with the ball (and the ball in flight, from the passer's release to the catch or the incompletion), a tapered streak along the last 0.5 s of travel at the current speed setting, at most 8 yards long. Width from `markPx * 0.45` at the mark to 0 at the tail, filled with `gradient.trail`. Drawn above paths and below every mark, label and the ball. It shrinks to nothing over `dur.base` when the carrier stops and is gone at the whistle. Not drawn under reduced motion or Skip. Job: shows where the ball is going at speed, so the eye finds it before it finds anything else.
- On-field tags (`field.huddleLabel`, the Flag, Challenge and Standout words): the same `color.tag` pill, Inter 600 14 px `color.line`, 18 px tall, 6 px horizontal padding.

### Spacing (unchanged rules)

The line is drawn as a playbook diagram, not to yard scale. Marks never overlap at the snap, rings included.

- Center to center along the line: at least the wider of the mark and its label plus a 4 px gap. Templates in `data/ui/` place players in yards; when the line comes out tighter, the renderer spreads it out from the center. Depths are never changed.
- Stacked players: at least mark + label + 6 px apart up and down; if a template can't fit that, the label moves to the right of the mark.
- During the live play only the labels of players the PlayResult names stay drawn; the rest return at the whistle. When two labels would collide, the named player's is drawn and the other hidden. Marks are never hidden.
- Labels scale with the text-size setting, and the spacing rule widens the line to match.

## Layout

Three screens. Menu mode is every screen before a game exists. In a game the calling screen and the play screen switch at the snap and at the end of the whistle hold (docs/specs/m2-screen-switch.md, Joseph 2026-11-15). Nothing ever covers the field during live action except the player card, which pauses the play. After the whistle, during the hold, a moment banner (Motion) may cross the half of the field away from the ball's final spot; it never covers the ball, the carrier or the tackler.

Window minimum: 800x536 (CHANGED from 528: the top bar grows 8 px again, and this keeps the floor at 9.44 px per yard, the scale every spacing test was checked at).

### Top bar (both game screens)

64 px tall (`TOP_BAR` CHANGED from 56). Why: a 44 px score sits in it with 10 px above and below, the size at which the score reads from across a room the way a TV bug does. See HUD: score bug.

### Calling screen

What made it rusty (checked against the 1440x900 screenshots): two short glass cards at the top of an 836 px stage, the rest empty navy; the down and distance set as an Inter header inside a card, like a form title; no team color below the bar; nothing football-shaped on screen between snaps, where the player spends most of a game (about 150 dead balls). Prime Time fixes it in two steps. Step A needs no new decision. Step B brings part of the field back and needs Joseph first (see "Pre-snap board").

Step A: situation plate (build now)

```
+------------------------------------------------------------------------------+
| SCORE BUG (64 px)                                              Esc Menu      |
+------------------------------------------------------------------------------+
| +--------------------------------------------------------------------------+ |
| |# 1ST & 10  | OWN 32              | [EZ|====drive====|ball|  yellow |  EZ] | |
| |#           | You're on offense   |  Drive: 3 plays, 22 yds               | |
| +--------------------------------------------------------------------------+ |
| +------------------------+  +------------------------------------------+     |
| | Last play              |  | Play type                                |     |
| | result line            |  | [1] Formation                            |     |
| | why line               |  | [2] Kick (4th down or last 2:00 only)    |     |
| | calls line, events     |  | ...  at most 7 rows                      |     |
| +------------------------+  | status line                              |     |
|                             +------------------------------------------+     |
| legend                                                                       |
+------------------------------------------------------------------------------+
```

- Content width at most 1160 px, centered, side padding `max(24px, (100% - 1160px) / 2)` as built. 24 px top padding under the bar.
- Situation plate (`hud.situation`, NEW): full content width, 96 px tall (grows with text scale, never clips), a glass card (`color.surface`, `gradient.sheen`, `blur.glass`, 1 px `color.hairline`, `radius.lg`, `shadow.2`), padding 16 px 24 px. Reading order left to right: down, spot, field position. Job: the situation, readable from across the room before anything else on screen.
  - Team edge: a 6 px solid bar in the fill of the team with the ball, inside the plate's left edge, full height, left corners rounded with the plate, with the inset ring. `gradient.teamTint` (that team's fill) behind the down block.
  - Down block: `type.plateDown` `chalk`, the same string the bug's down block shows ("1ST & 10", "3RD & GOAL", "KICKOFF", "EXTRA POINT"). Then a 1 px `color.hairline` divider, 48 px tall, 24 px on each side.
  - Spot block: `type.plateSpot` `chalk` ("OWN 32", "OPP 4", "50"), and under it "You're on offense" or "You're on defense" (or "You're kicking off", "You're receiving") in `type.note` `chalkSoft`. This line moves here from the call card.
  - Drive tracker (`hud.driveTracker`, NEW): the rest of the width, at least 280 px, else hidden (the plate keeps down and spot). A horizontal mini field 44 px tall, `radius.sm`, 1 px `color.hairlineStrong` ring, in the field's frame turned on its side: whatever goes up the field goes right in the tracker (the team with the ball attacks right; kickoffs go right, as kicks go up). Contents, back to front: end zones (each 10/120 of the width, the left one in the end zone color of the team attacking right, the right one in its opponent's) on flat `color.turf` (no stripes, no light); yard lines every 10 yards `color.line` at 0.35, 1 px, and the 50 at 0.6; the drive band (`color.driveBand`) from this drive's starting spot to the ball, full height; the first-down line (signal core 3 px, 1 px `outlineDark` casing, full height; not drawn when goal to go); the line of scrimmage (`color.los` core 3 px, same casing); the ball, an 8 by 5 px `color.ball` ellipse with a 1.5 px `color.line` outline and `shadow.mark`, on the line of scrimmage, centered. No text inside the tracker. Under it, 4 px down, "Drive: 3 plays, 22 yds" in `type.small` `chalkSoft`, from the event log (the same source as the box score's Drives tab); hidden on the first play of a drive and whenever the log does not give it. Job: where on the whole field the ball is, how far the drive has come and how far is left, in one look.
  - When the plate updates after a play: the down block swaps (Motion, down block), the ball, both lines and the drive band slide from their old spots to the new ones over `dur.tick` `ease.standard`. On a change of possession the tracker is redrawn in the new frame with a `dur.base` crossfade, never a flip or slide (the field's rule: no rotation).
- Cards under the plate, 16 px below it: at 760 px of content width and up, two cards in a grid, `minmax(260px, 5fr) 7fr`, gap 24, top aligned. Below 760: one column, the last-play card above the call card, gap 16. The last-play card has a fixed minimum height (four lines of `type.result`) in one column, so the rows never move.
- Call card header: the down and distance and "You're on..." leave the card (they are in the plate). The card opens with the breadcrumb in `type.label` ("Play type", "Pass, Shotgun", "Defense: Nickel"), then the rows. What the menus contain does not change, and no screen gains a choice: the plate and the tracker are read only.
- At 200% text: the plate wraps to two rows (down block, then spot), the tracker drops when it is under 280 px, nothing truncates.

Step B: pre-snap board (needs Joseph, see Decisions and Still open)

```
+------------------------------------------------------------------------------+
| SCORE BUG                                                                    |
+------------------------------------------------------------------------------+
| SITUATION PLATE (as Step A)                                                  |
| +---------------------------+  +-------------------------------------------+ |
| |  ~~~ end zone if in view  |  | Last play (card, compact)                 | |
| |  turf, yard lines, 50     |  +-------------------------------------------+ |
| |  ======== yellow ======== |  | Play type                                 | |
| |                           |  | [1] Formation  (focus previews on board)  | |
| | [1ST & 10]                |  | [2] Kick (reason)                         | |
| |  ====== blue LOS ======== |  | ...  at most 7 rows                       | |
| |    your formation, faint  |  | status line                               | |
| |    routes at 40%          |  +-------------------------------------------+ |
| +---------------------------+                                                |
| legend                                                                       |
+------------------------------------------------------------------------------+
```

- Pre-snap board (`calling.board`, NEW): the field itself, drawn by the field code with the play screen's camera rule (line of scrimmage 70% of the way down), docked left under the plate. Width `boardW` = 532 px (56 yards at 9.5 px per yard, above the 9.44 floor every spacing test uses). Height: from 16 px under the plate to 16 px above the legend; it shows as many yards as fit. `radius.lg`, `overflow: hidden`, 1 px `color.hairline`, `shadow.2` (no `shadow.field`). The right column (`C - 532 - 24` wide) holds the last-play card, then the call card, gap 16, so the reading order stays situation, what happened, your options.
- What it draws: turf, paint, midfield wordmark and end zones as in Field; the line of scrimmage, first-down line and down tag; your unit lined up in the focused formation or package (both units before a kickoff, as U8 had it), with the focused play's routes or coverage faint at 40%; marks with labels. Never the opponent's call or alignment before the snap (F5): on defense the offense is not drawn. Moving the row focus updates it with a `dur.fast` crossfade, so arrowing through Formation previews each one. Read only: nothing on the board is a choice and it adds nothing to the seven.
- Shown only when all hold: `C - 556 >= 420 * textScale`, text scale at most 125%, and a board height of at least 300 px. That is every target window from 1024x600 up at 100% text. Otherwise Step A's layout.
- Snap transition (with the board): see Motion, "Calling to play". The board becomes the play field instead of the screen cutting to it, which is the single biggest "broadcast, not form" change on the screen.
- Why it needs Joseph: on 2026-11-15 he chose "the play-calling menu takes over the screen, then gives way to a full-field play", and docs/specs/m2-screen-switch.md records "The field is not shown" while calling. The board reverses that. The spec itself names "a small field diagram inside the calling screen" as the follow-up if he wants the lineup back. My recommendation is yes: the menu still owns the right of the screen and every key, and the field it gives way to at the snap is the same field, growing.
- Cards: `color.surface` with `gradient.sheen`, `blur.glass`, 1 px `color.hairline` border, `radius.lg`, padding 20 px 24 px, `shadow.2`.
- The panel element itself has no background on this screen (the stage shows through). `overlayBackground()` stays for menu-mode placements.
- Legend (`hud.legend`): sticky at the bottom of the content, `color.bg` at 0.85 with `blur.glass`, 1 px `color.hairline` top border, padding 10 px 0. Key hints in the legend use the key hint style below at `type.key`, labels `type.small` `chalkSoft`.

### Play screen

```
+--------------------------------------------------------------------+
| score bug (glass)                                                  |
+--------------------------------------------------------------------+
|  stage   +-------------------------+   +--------------------+      |
|          |                         |   | This play (card)   |      |
|          |   portrait field        |   | You: Shotgun, ...  |      |
|          |   column, shadowed      |   | They: Nickel ...   |      |
|          |   offense attacks up    |   +--------------------+      |
|          |                         |                              |
|          |                         |                              |
|          |                         |   +--------------------+      |
|          |                         |   | Space Skip         |      |
|          |                         |   | S Speed 1x  M Card |      |
|          +-------------------------+   +--------------------+      |
+--------------------------------------------------------------------+
```

The field stays portrait (Joseph, 2026-11-12). What fixes the empty right side: the field column and a play rail sit together, centered on the stage, instead of the column flush left with dead space beside it.

- Rail width `railW = clamp(300px, 340px * textScale, 420px)`, gap 24 px, stage padding 24 px.
- If `columnWidth + 24 + railW <= windowWidth - 48`: the group is centered. `column.left = floor((windowWidth - (columnWidth + 24 + railW)) / 2)`, rail left = column right + 24. At 1280x720 that is a 734 px column at x 91 and a 340 px rail; at 1024x600, 601 px and 340 px; at 1920x1080, 1132 px and 340 px.
- Prime Time: the 64 px top bar takes 8 px more height from the column, so the column widths above shrink by a few pixels; `playStage` and its tests recompute them, and the rule does not change.
- Otherwise (for example 800x536, or 1024x600 at 125% text): no rail, the column is centered alone, and the rail's key hints go back into the top bar as today.
- The column runs the full height under the top bar, with `shadow.field` left and right.
- Rail (`hud.playRail`): read only, no choices. Top 16 px, bottom 16 px. Cards stacked with 12 px gaps, each `color.surface`, `blur.glass`, 1 px `color.hairline`, `radius.lg`, padding 16 px 18 px, `shadow.2`.
  1. This play (from the snap): `type.label` "This play", then the calls line in `type.note` `chalk`: "You: Shotgun, Short pass." and "They: Nickel Cover 1 Blitz." on two lines. Job: what you are watching, while you watch it.
  2. Keys, pinned to the bottom: Space Skip, S Speed (value), M Player card, as key hints. Job: the controls that work right now.
- No result card in the rail (dropped 2026-11-15). At 1x the play screen holds only about 400 ms after the whistle (800 ms on a score), and the calling screen's Last play card shows the same result a moment later. The whistle hold is pacing, tuned in data; Prime Time's moments (Motion) carry the key moment, and a moment may lengthen the hold to its own minimum (a data value, Space skips it).
- Player card on the play screen: with a rail, it opens over the rail (top aligned with it, the rail's width), covering nothing on the field. With no rail (for example 1200x800 with the field's margins under 280 px, or 800x536): width `min(280px, fieldWidth - 16px)`, 8 px from the window edge, 8 px under the top bar, on the half of the window away from the player's mark, over the field. This is the one thing allowed over the field, because opening it pauses the play.
- This amends docs/specs/m2-screen-switch.md, "the field alone, no panel", for windows with room for the rail. The rail holds no menu, covers nothing and decides nothing.

## HUD

### Score bug (`hud.scoreboard`)

REDESIGNED in Prime Time. What was rusty in the Broadcast bug: five separate translucent pills with gaps between them, a 6 px chip as the only team color, a 34 px score and the down and distance at the same weight as everything else. It read as a toolbar. A TV bug is one fused unit, team color in solid blocks, the scores the biggest and darkest-backed thing in it.

```
+----------+------+----------+------+---------------+-------------+
| CRANES   |  •7  | OUTRIDERS|  10  | 2ND  14:53    | 3RD & 4     |
| ▬ ▬ ▬    |      | YOU ▬ ▬  |      |      Stopped  | OPP 38      |
+----------+------+----------+------+---------------+-------------+
  plate     score   plate     score   game segment    down segment
 (away fill)(dark) (home fill)(dark)
```

The top bar is a glass strip as before: `gradient.topBar`, `blur.glass`, 1 px `color.hairline` bottom border, `shadow.2`, 64 px. No gold rule. Inside it, 16 px from the left edge and vertically centered, the bug: one fused unit 48 px tall, `radius.md` on its outer corners only, `overflow: hidden`, 1 px `color.hairlineStrong` ring, `shadow.2`. Its segments sit flush, separated by 1 px `color.hairline` dividers, no gaps. Left to right:

1. Away team, then home team (`hud.team`), each in two parts. Away is left, home is right, the broadcast order.
   - Name plate (`hud.teamSwatch` in the bug, now the plate itself): solid team fill, the tier's inset ring, padding 0 14 px. Name in `type.bugName`, in the slot's outline color (white on dark tier, `outlineDark` on light tier). Under it, 4 px down, the timeout bars (`hud.timeouts`): 14 by 4 px, `radius` 2 px, gap 3 px, left ones in the outline color, spent ones in the outline color at 0.30; the text count stays for screen readers as built. Challenges (`hud.challenges`, when built): 6 by 6 px squares, `radius` 1 px, same colors, after the bars. The human's team carries a "You" tag after the timeout bars: pill, `color.scoreBox` fill, `type.small` 600 `chalk`, sentence case "You", padding 1 px 6 px.
   - Score box (`hud.score`, NEW slot): `color.scoreBox`, min-width 64 px, padding 0 12 px. Score in `type.bugScore` `chalk`, in a `min-width: 2ch` right-aligned box. The biggest text in the bar, on its darkest surface.
   - Possession (`hud.possession`): a 12 by 7 px `color.signal` ellipse inside the score box of the team with the ball, 6 px left of the digits, vertically centered. The word "ball" stays in the DOM, visually hidden.
2. Game segment (`hud.clock`, `hud.clockState`): `color.surfaceRaised`, padding 0 14 px. One line: the period in `type.bugPeriod` `chalkSoft` ("1ST", "2ND", "HALF", "OT", "FINAL"), 6 px gap, the clock in `type.bugClock` `chalk`, baselines aligned; under it, right aligned, the clock state in `type.small` `chalkSoft` ("Running", "Stopped"). Under 2:00 of a half: the clock turns `color.signal` and the "Under 2:00" tag appears as before (pill, rgba(255, 203, 61, 0.16), `type.small` 600 `signal`), now outside the bug, 8 px to its right.
3. Down segment (`hud.downDistance`): `color.surfaceRaised`, padding 0 14 px. "3RD & 4" in `type.bugDown` `chalk`, the spot under it in `type.small` 600 `chalkSoft` ("OPP 38"). Hidden at Final; the bug ends at the game segment. On the calling screen the situation plate repeats this in large type. Both stay: the bug never changes shape between screens, and the plate is the version you read from across the room.
4. Tempo (`hud.tempo`) when not Normal: a tag outside the bug, 8 px right of it (after the Under 2:00 tag if both), in `chalkSoft` on `surfaceRaised` ("Hurry-up", "Run the clock").
5. Right edge of the bar: key hints for what works now (Esc Menu while calling; Space, S, M during the play when there is no rail).

How the bug moves (all `prefers-reduced-motion` and the in-game setting: the new value appears at once, no slide or roll; the first-down fill still shows, as a state, without its fades):

- Score change (`hud.score`): odometer. Inside the score box (clip), the old number slides up and out (translateY 0 to -100%) while the new one slides up into place (100% to 0), `dur.tick` `ease.standard`. With it, the score box background goes from `scoreBox` to the scoring team's fill at 0.35 over `dur.fast` and back over 480 ms `ease.standard`. When a moment banner shows the new score, the bug changes on the same frame the banner's sub line appears, so the two never disagree.
- Down change (`hud.downDistance`): the old text moves up 8 px and fades over `dur.fast`; the new text comes from 8 px below and fades in over `dur.base` `ease.out`. The spot does the same with it.
- First down (`fx.firstDown` in the bug): when the play's result is a new first down for the same team, after the swap the down segment fills `color.signal` with `ink` text (fade in `dur.fast`), holds, and fades back over `dur.base`; 900 ms in total (data). One flash, never repeated.
- Possession change (`hud.possession`): the glyph slides from one score box to the other along the bug, above the plates, `dur.tick` `ease.standard`. Then the down segment swaps as above.
- Timeout used (`hud.timeouts`): the rightmost lit bar dims to spent over `dur.slow`.
- Period change: the period word swaps as the down does. The clock resets without motion.
- The clock itself never animates: it ticks during the run-off, one value per frame of the existing count.

Bar type scale: every font size in the bar uses `--bar-scale: min(var(--text-scale), 1.25)` instead of `--text-scale`, except the score, which never goes above 44 px (it is already the largest text on any game screen, and 55 px would clip the 48 px bug). At 125% every other line still fits 48 px: name plus bars 35 px, clock line plus state 47 px, down plus spot 48 px. The situation plate follows the full text scale.

When the bar is too narrow, apply these fit steps in order, stopping at the first that fits:

1. Hide the key hint labels.
2. Hide the clock state word.
3. Hide the key hints.
4. Hide the tempo tag.
5. Hide the Under 2:00 tag (the clock stays `signal`).
6. Visually hide the "You" tag (screen readers still read it).
7. Bar type at 100% (`--bar-scale: min(var(--text-scale), 1)`).
8. Bar type at 85% (`--bar-scale: 0.85`), segment padding 0 8 px, score box min-width 52 px.
9. Team names at `calc(16px * var(--bar-scale))`.

Score, clock, down and distance and the team names are never dropped, cut or hidden (U5). A cut name ("Outri") is not a real word (Asset intake 7), and a hidden name leaves the plate's color as the only team cue (Do not). If the bar still overflows after step 9 at 800 px wide with the longest nickname at 125% text, report the width to art-director rather than add a step. Prime Time estimate at 800 px and 100%: about 780 px for the bug with the "You" tag, so steps 1 to 3 will run at the minimum window; check it in the build.

- No play clock. Turn-based, so the run-off shows on the game clock in the pre-snap beat. Kept in Prime Time on purpose: a TV bug has one, but decision 2 of docs/specs/m2-playable-game-design.md (final) rules out a ticking clock while you decide, and a play clock that never ticks would be a fake.
- Team swatch elsewhere (box score, pregame matchup): 12 px rounded square, `radius` 3 px, same inset ring, the name always beside it. Swatches stay squares; pips are bars and possession is an ellipse.

### Rows (`hud.playMenu`, every menu in both modes)

Rows are clickable cards. At most seven per screen.

- Rest: `color.rowRest` fill, `radius.md`, min height 48 px, padding 10 px 14 px, gap 12 px inside, 6 px between rows. Label `type.row` `chalk`, note `type.note` `chalkSoft`.
- Key hint (`hud.keyHint`): replaces the boxed key chip. 24 by 24 px minimum (wider for "Esc"), `radius.sm`, `color.surfaceRaised` fill, no border, `type.key` `chalkSoft`. Job: every row shows its key at all times, quietly, so number keys stay discoverable without a box in front of every line.
- Selected or hovered (`hud.playMenu.selected`; hover moves the selection, as built): `gradient.select` fill, `shadow.select`, label weight 600, a 3 px `color.gold` accent bar on the left edge inset 8 px top and bottom with `radius` 2 px, key hint filled `color.gold` with `ink` text. Selection is never color alone: the bar, the ring and the weight all change. The bar grows in (scaleY 0 to 1, `dur.base`, `ease.standard`); fill and shadow transition over `dur.base` with `ease.standard`.
- Selection travel (NEW, Prime Time): the fill, ring, shadow and accent bar are one highlight element per menu that slides to the newly selected row (translateY and height, `dur.base`, `ease.standard`) instead of fading out on one row and in on the next. The label weight and the gold key hint switch on the row the highlight arrives at, at the end of the slide. Job: the eye follows one moving object instead of hunting for which row lit up. Reduced motion: it jumps.
- Keyboard focus: CHANGED. On a row, the focus ring is 2 px `color.gold`, offset 2 px, following the row's radius, drawn only for `:focus-visible`. The Broadcast chalk ring sat around the gold selection and read as a hard cream border around the selected item, a banned look (seen on the kickoff and 1st and 10 screens of the 2026-11-15 build). Every other focusable keeps the 2 px `color.chalk` ring.
- Pressed: `transform: scale(0.98)` for `dur.fast`, and the key hint goes from gold to `chalk` with `ink` text for the same `dur.fast`. Job: the key you hit answers.
- Menu change (NEW): when a pick opens the next menu, the new rows enter from 12 px to the right and fade in, `dur.base`, `ease.out`, each row 24 ms after the one above (seven rows finish within 330 ms). Esc and Back enter from 12 px to the left. The highlight starts on its row with no slide. Keys work from the first frame: input never waits for an entrance, so the 100 ms snap budget (C1) and typed-ahead calls are unaffected. Reduced motion: no offset, no fade, no stagger.
- Off (`hud.playMenu.disabled`): no fill, label and key hint number `chalkSoft`, key hint with no fill, the reason in words in `type.note` ("Kick (4th down or last 2:00 only)"). Selected while off: a 1 px dashed rgba(169, 179, 184, 0.6) outline inset 2 px, no gold anywhere. Never opacity alone.
- Status line under the rows: `type.note` `chalkSoft`.
- Section label ("Play type"): `type.label`, 16 px above the first row.

### Report text

- Result line (`hud.resultLine`): `type.result`, `chalk`. What happened, with names.
- Why line (`hud.whyLine`): `type.body`, `chalk`. Only factors the engine used. Stays until the next snap.
- Calls line (`hud.callsLine`): `type.note`, `chalkSoft`. "You: Shotgun, Short pass. They: Nickel Cover 1 Blitz."
- Call card header: CHANGED. The down and distance and "You're on offense" move to the situation plate (Calling screen); the card opens with the breadcrumb in `type.label`. Until the plate ships, the Broadcast header (`type.callHeader`) stays.

## Play cards and the player card

- Play cards (`card.play`): `color.paper` tiles, `radius.md`, `shadow.1`, padding 6 px, diagrams in `color.ink` for both sides (O and X carry the side, defense paths dashed), zones and bands `color.paperShade` with dashed `color.inkSoft` edges. Job: a printed playbook card, the same for every team. Highlighted: 2 px `color.gold` outline at 2 px offset, `translateY(-2px)`, `shadow.2`, over `dur.base` `ease.standard`; the label strip turns `paperShade`. Off: `paperShade` tile, `inkSoft` label with the reason in words, art at half opacity.
- Player card (`card.panel`): `radius.xl`, `shadow.3`, 1 px `color.hairlineStrong`, no ink border. Header band in the team fill (top corners rounded with the card) with name, jersey number and position in the slot's outline color, Inter 700 18 px, tabular number. Body `color.paper`, `ink` text, 16 px padding.
- Rating bars (`card.ratingBar`): 8 px tall, `radius` 4 px, `inkSoft` fill on a `paperShade` track, value beside in Inter 600 tabular. Never team colors.
- Bars on dark surfaces: `color.track` track, `chalkSoft` fill, same radius, value printed.

## Main menu (menu mode)

- `menu.frame`: the full window on `gradient.stage`. Content frame centered, width `min(1040px, 100vw - 64px)`, padding 32 px, as built.
- `menu.wordmark` (`menu.hero` treatment, Prime Time): `type.hero` (88 px) `chalk`, set on two lines, "CLIPBOARD" over "FOOTBALL", left aligned; `type.wordmark` (56 px, may wrap) when the frame is under 720 px wide or the text scale is 150% or more. Live text. Job: the first screen says "football game" in the same face as the score bug and the end zones, at hero size.
- `menu.rule`: the accent bar, now 64 px wide and 4 px tall, `radius` 2 px, `color.gold`, 16 px under the wordmark. Same job.
- Continue row: when the save already records the score, teams and clock (no schema change; if it does not, the note stays as built), its note reads like a mini bug: two 12 px team swatches with the nicknames and scores, then the period and clock, "Cranes 7, Outriders 10, 2nd 14:53", in `type.note`. Job: says which game Continue resumes before you press it.
- Entrance (`menu.enter`, NEW): on the first show after the app loads only, the wordmark fades in and rises 12 px over 400 ms `ease.out`; the accent bar grows from 0 to 64 px wide over `dur.base`, starting at 200 ms; the rows enter as in Rows, "Menu change", starting at 240 ms. Returning from Settings or Controls uses the screen push instead. Keys work from the first frame. Reduced motion: all of it shows at once.
- Other menu screens (Settings, Controls, rosters, error screens): title in `type.screenTitle` (now display 700 40 px caps), `chalk`, then 16 px of space, no accent bar. Content in one glass card per group. Pregame, halftime and the end of the game have their own layout below.

### Pregame: the face-off (`pregame.faceoff`, NEW)

What was rusty: a form. "You: [swatch] Sundown Gulch Outriders (home) vs [swatch] Glass Lake Cranes (away)" as one sentence, two lists of bars, then six rows. The matchup is the most "game night" moment in the app and it had no team color bigger than 12 px.

```
+------------------------------------------------------------------------+
| Pregame (type.label)                                                   |
| +--------------------------------/-----------------------------------+ |
| | AWAY                          /                         HOME  You  | |
| | Glass Lake                   / (VS)                Sundown Gulch   | |
| | CRANES                      /                         OUTRIDERS    | |
| +--------------------------/-----------------------------------------+ |
|   67  ==========[        Offense        ]==========  66                |
|   69  ==========[        Defense        ]==========  68                |
|   69  ==========[     Special teams     ]==========  67                |
|                                                                        |
|  [1] Start   [2] Coach the other team ... (rows as built)              |
+------------------------------------------------------------------------+
```

- The screen title shrinks to a `type.label` "Pregame" line: the face-off is the title.
- Face-off band: the content card's full width, 200 px tall (160 under 900 px of content), `radius.lg`, `overflow: hidden`, `shadow.3`. Away half on the left, home half on the right, the broadcast order. Each half is `gradient.teamBlock` in its team's fill with the tier's inset ring on its outer edges. The seam between them is a straight 12-degree slant through the center (left half `clip-path: polygon(0 0, calc(50% + 21px) 0, calc(50% - 21px) 100%, 0 100%)` at 200 px, the right half its mirror; scale the 21 px with the height). Each half, aligned to its outer edge, 32 px padding, all in the slot's outline color: "Away" or "Home" in `type.label`, with the "You" tag (`scoreBox` pill, `chalk`) on the human's side; the city in Inter 600 18 px; the nickname in `type.faceoffName`. Center: the VS disc, 64 px, `color.scoreBox`, 1 px `color.hairlineStrong`, `shadow.3`, "VS" in display 700 28 px `chalk`, on the seam. Job: who is playing whom, in their colors, from across the room.
- Tale of the tape: under the band, 24 px down, one row per unit (Offense, Defense, Special teams), 40 px apart. The unit name centered in `type.label` `chalkSoft`. The away value at the far left and the home value at the far right in display 700 28 px tabular; the higher value in `chalk`, the lower in `chalkSoft`, both `chalk` on a tie. Between each value and the label, a bar growing outward from the center (away to the left, home to the right): 8 px tall, `radius` 4 px, `color.track` track, fill in that team's fill with the tier's inset ring, length `value / 100` of the space. The values are printed, so the bars never carry the number alone. Job: who is the underdog, unit by unit (the job the pregame spec gave the bars).
- Rows: as built, under the tape. No new choices: the screen keeps its six.
- Status text on this screen is in words only. The current "The old save is kept aside as set-aside-2026-11-16T01:58:25.211Z." shows a raw storage key, which is not real words (Asset intake 7); it should read "Your old save is kept." with the key in the log only.

### Halftime and end of game (`menu.scoreHero`, NEW)

- The same face-off band, with each half's score in `type.faceoffScore` in the outline color beside the nickname, and "HALFTIME" or "FINAL" (or "FINAL, OT") in `type.screenTitle` `chalk` above the band.
- Line score (`hud.lineScore`, NEW) under the band: a two-row table, team swatch and nickname, then one column per quarter (and OT when played), then the total. Display 700 22 px tabular; quarters `chalkSoft`, totals `chalk`. Job: how the game got here, the broadcast way.
- Then the screen's existing content (team stats, top players, rows) unchanged.
- `menu.splashArt`: amended 2026-11-15 (Joseph): no turf. Only the marks, playing out a newly generated play each loop with dotted `color.line` trails behind them and the ball; a still finished frame under reduced motion (docs/specs/m2-main-menu.md, Splash composition). Was: the static play diagram, drawn with the field's own code (new turf, light, marks, rings and round caps), inside a card: `radius.lg`, `overflow: hidden`, 1 px `color.hairline`, `shadow.2`. Marks and paths for both sides in `color.line` fill with an `outlineDark` ring (no team implied). No end zone, no first-down line, no labels, no zones, no text. Ratio 0.68. Hidden when its column is under 360 px, at text size 150% or more, or without Canvas 2D.
- Rows: the row cards above. Tagline in `type.body` at 18 px, `chalkSoft`.
- Window too small: `gradient.stage` with `chalk` text, either mode.

## Motion

Play animation:

- The animation reads the PlayResult. It never decides anything.
- Pre-snap: marks set, routes drawn faint (40% opacity, ring included) for under a second, then the snap.
- During the play, marks move along straight segments with easing only at start and stop. No squash, no bounce, no camera shake.
- The ball is always visible and on top of marks and labels.
- Default play length on screen 2 to 4 seconds. Speed toggle on S (1x, 2x, skip), live. Space skips to the end.
- Key moments (catch, tackle, turnover, score) hold for a short beat.
- Flag (`fx.flag`): a 12 px `color.signal` square, `radius` 3 px, 2 px `color.outlineDark` outline, at the foul spot, plus a "Flag" tag.
- Challenge (`fx.challenge`): the same marker at the spot in doubt plus a "Challenge" tag.
- Standout (`fx.standout`): the ball-carrier ring with `glow.carrier` plus a "Standout" tag by the mark, held 0.8 s.
- Score and turnover (`fx.score`, `fx.turnover`): CHANGED. The slots now draw the touchdown, field goal, safety, two-point and turnover moment banners below. The Broadcast toast is retired. A turnover always shows text as well as the change of marks.
- Paths draw on behind their marks and the carrier trail follows the ball (Marks).
- After the whistle the paths stay drawn until the next snap.
- Reduced motion: skip to the final frame with paths drawn; moments appear in their end state with no motion and add no hold.

### Moments (NEW, Prime Time)

A moment is a short motion graphic that marks a change the engine made. Rules for all of them:

- Each fires only from a field of the committed PlayResult or a loop event (the "Fires on" column). A moment never says anything the result line does not.
- At most one banner per play, by priority: touchdown, safety, turnover, field goal, two-point try. A banner suppresses the chips; a scoring turnover (a pick six) shows the touchdown banner, and the turnover reads in the result line and the possession glyph's slide.
- Timing: each moment has a minimum hold at 1x (`data/ui/motion.json`, `moments.<id>.minHoldMs`, defaults below). The whistle hold becomes the larger of its own value and the moment's. At 2x every figure halves. Space ends the hold at once, as now; Skip speed shows the end state and keeps the minimum hold only for banners. The sim is never waited on: moments start after the whistle, from data already committed.
- Banners never cover the ball, the carrier or the tackler: a banner sits in the half of the field column away from the ball's final screen spot (its center at 30% of the column height from the top when the ball is in the lower half, at 70% otherwise).
- Nothing flashes more than once, and nothing more than 3 times a second.
- Reduced motion: every moment shows its end state at once and adds no hold. The result text carries the moment either way.

Banner anatomy (`moment.banner`, drawn through `fx.score` and `fx.turnover`):

- Team block: width `min(columnWidth - 48, 720)` px, 112 px tall (88 when the column is under 600 px), centered on the column, `gradient.teamBlock` in the team's fill, `radius.md` top corners, the tier's inset ring, 1 px `color.hairlineStrong`, `shadow.toast`. The word in `type.momentWord`, in the slot's outline color, centered.
- Sub strip: attached under the block, same width, 36 px, `radius.md` bottom corners, `color.bannerStrip`, the sub line in `type.momentSub` `chalk`, centered.
- In: the block wipes in from the left (`clip-path: inset(0 100% 0 0)` to `inset(0 0 0 0)`), `dur.wipe`, `ease.out`. At 120 ms the word slams in: opacity 0 to 1 and scale 1.15 to 1.0 over 200 ms, `ease.slam` (it settles, it never overshoots). At 320 ms the sub strip drops in from 8 px above with a fade, `dur.base` `ease.out`, and the bug's score or possession changes on that frame.
- Out: in the last `dur.wipe` of the hold the whole banner wipes out to the right (`inset(0 0 0 100%)`), `ease.exit`.

| Moment | Fires on | Where | What you see | Min hold at 1x |
|---|---|---|---|---|
| Touchdown (`moment.touchdown`) | a touchdown in the result | Banner, scoring team's fill | "TOUCHDOWN"; sub "Outriders 13, Cranes 7" (scoring team first) | 1800 ms |
| Field goal (`moment.fieldGoal`) | a made field goal | Banner, kicking team | "FIELD GOAL"; sub "47 yds. Outriders 10, Cranes 7" | 1400 ms |
| Safety (`moment.safety`) | a safety | Banner, scoring team | "SAFETY"; sub with the score | 1400 ms |
| Two-point try (`moment.twoPoint`) | a successful two-point try | Banner, scoring team | "TWO-POINT GOOD"; sub with the score | 1200 ms |
| Turnover (`moment.turnover`) | a change of possession the result marks as a turnover (`defensePossessedDuringPlay`, `end.possession`), or a turnover on downs | Banner, the team that gains the ball | "INTERCEPTION", "FUMBLE" or "TURNOVER ON DOWNS" when the result names the kind, else "TURNOVER" (never a guessed kind); sub "Cranes ball at OPP 41" | 1400 ms |
| Big play (`moment.bigPlay`, `fx.bigPlay` NEW) | a gain from scrimmage at or over `moments.bigPlay.minYards` (designed, default 20) that did not score | Chip 8 px right of the ball's final spot (left if it would leave the column) | `color.tag` pill with a 3 px `signal` accent bar on its left edge, `type.chip` `chalk`, counting from "+0" to the gain ("+34") over 500 ms `ease.out` | 900 ms |
| First down (`moment.firstDown`, `fx.firstDown` NEW) | a new first down for the same team, not a score, not by penalty alone | Chip beside the ball as above, and the bug's down flash (HUD) | "FIRST DOWN" in `type.chip` `ink` on a `signal` pill with a 1.5 px `outlineDark` outline; pops in (scale 0.92 to 1 with a fade, `dur.base` `ease.out`) | none: it fits the normal hold, and the bug flash carries on into the calling screen |
| Missed kick, extra point | as now | Tag | The existing "No good" and "Good" tags; no banner | as now |
| Quarter end (`moment.periodEnd`) | end of the 1st and 3rd quarters (the half and the game have their own screens) | Bug and situation plate | The bug's period word swaps to "END 1ST"; on the calling screen the plate shows the line score (`hud.lineScore`) in place of the drive tracker until the next snap, wiping in over `dur.wipe` | none: the calling screen waits on you |
| Two-minute warning (`moment.twoMinute`) | the two-minute warning event | Bug | The clock turns `signal` over `dur.base`; the "Under 2:00" tag comes in from 8 px left with a fade | none |
| Matchup intro (`moment.matchupIntro`) | Start on the pregame screen | Full window | See below | 2400 ms, any key skips |

Matchup intro, at 1x (skippable by any key or click, which jumps to the coin toss with the bug in place):

1. 0 to 300 ms: on the stage, a face-off band 240 px tall across the full window width, vertically centered: the away half wipes in from the left edge and the home half from the right, meeting at the slanted seam, `ease.out`.
2. 200 to 420 ms: both nicknames slam in (opacity and scale 1.12 to 1.0, `ease.slam`); cities and "Away" and "Home" fade in with them.
3. 500 ms: the VS disc fades in, scaling 0.8 to 1.0 over `dur.base` `ease.out`.
4. 700 to 1900 ms: hold.
5. 1900 to 2300 ms: each half shrinks into its name plate in the score bug (translate and scale to the plate's rect, `ease.standard`), while the rest of the bug fades in. This is where the bug "comes from" for the whole game.
6. 2300 ms on: the coin toss rows enter as in Rows, "Menu change".

Reduced motion: no intro; the coin toss screen appears with the bug.

Halftime and end of game: the face-off band's halves slide in 40 px from their outer edges with a fade over `dur.screen` `ease.out`, and the scores count up from 0 to their values over 600 ms `ease.out`, tabular so nothing shifts. Reduced motion: static.

### Screen transitions

The outgoing screen still hides in one frame (Broadcast rule); only incoming content moves. Moment banners are the one thing that leaves with motion.

- Calling to play (at the snap):
  - With the pre-snap board: the board becomes the play field. The play canvas starts at the board's rect and grows to the column's rect over `dur.snap` `ease.standard`: a uniform scale from the width ratio, plus a vertical clip that opens from the board's height to the column's, anchored so the line of scrimmage stays at 70% and never jumps. The plate, cards and legend hide in the same frame; the rail fades in over `dur.screen` once the growth ends. The set phase runs during the growth; if the set phase is shorter than `dur.snap`, the growth shortens to match. It never delays or pauses the timeline. If the growth misses the PERF.md frame budget on Joseph's machine, fall back to the crossfade below.
  - Without the board: the field and rail fade in over `dur.screen` `ease.out`, the field scaling from 0.985 to 1.
- Play to calling (end of the whistle hold): with the board, the field shrinks back into the board's rect over `dur.snap`, then the plate and cards fade in and rise 8 px over `dur.screen` `ease.out`, the plate first, the last-play card 40 ms later, the call card 40 ms after that. Without the board, the same fade, rise and 40 ms stagger with the field hidden in one frame.
- Possession flip: the 200 ms crossfade in the M2 spec, unchanged. Never a rotation.
- Menu mode (title, settings, controls, pregame, rosters): the incoming screen enters from 24 px to the right with a fade over `dur.screen` `ease.out`; Back enters from 24 px to the left.
- Sheets (pause, details, box score, player card): rise 12 px and fade in over `dur.slow` `ease.out`; hide in one frame.
- Selection, hover, press, menu change and card lift: Rows and Play cards.

Nothing else animates in the UI: only what this section, Moments and Rows list. No bounce, overshoot, spring, shake, parallax, particles or confetti, 3D flips, motion blur on text, or looping motion on a game screen. Reduced motion turns every item here into an instant change.

## Art slots for future skins

Code draws through these named slots. A skin replaces a slot's drawing or values, never the game logic. Slot ids are stable once approved.

- `field.surface`, `field.turfStripe`, `field.sideline`, `field.light` (new 2026-11-15, Broadcast), `field.shadow` (new 2026-11-15, Broadcast), `field.endzone.home`, `field.endzone.away`, `field.yardLine`, `field.yardNumber`, `field.hash`, `field.goalPost`, `field.scrimmageLine`, `field.firstDownLine`, `field.huddleLabel`, `field.midfield` (new, Prime Time), `field.downTag` (new, Prime Time)
- `mark.offense`, `mark.defense`, `mark.number`, `mark.label`, `mark.ballCarrier`, `ball`
- `path.offenseRoute`, `path.defenseRoute`, `path.block`, `path.ball`
- `hud.scoreboard`, `hud.team` (new), `hud.teamSwatch`, `hud.score` (new, Prime Time), `hud.downDistance`, `hud.clock`, `hud.clockState`, `hud.tempo`, `hud.timeouts`, `hud.challenges`, `hud.possession`, `hud.playMenu`, `hud.playMenu.selected`, `hud.playMenu.disabled`, `hud.keyHint` (new), `hud.legend` (new), `hud.playRail` (new), `hud.resultLine`, `hud.whyLine`, `hud.callsLine`, `hud.situation` (new, Prime Time), `hud.driveTracker` (new, Prime Time), `hud.lineScore` (new, Prime Time)
- `calling.board` (new, Prime Time, pending Joseph)
- `card.panel`, `card.ratingBar`, `card.play`
- `fx.flag`, `fx.challenge`, `fx.standout`, `fx.score`, `fx.turnover` (both now draw moment banners), `fx.carrierTrail`, `fx.firstDown`, `fx.bigPlay` (new, Prime Time)
- `moment.banner`, `moment.touchdown`, `moment.fieldGoal`, `moment.safety`, `moment.twoPoint`, `moment.turnover`, `moment.bigPlay`, `moment.firstDown`, `moment.periodEnd`, `moment.twoMinute`, `moment.matchupIntro` (new, Prime Time)
- `team.<id>.name`, `team.<id>.abbrev`, `team.<id>.color`, `team.<id>.outline`, `team.<id>.endZone`
- `font.ui`, `font.display` (`font.mono` retired 2026-11-15)
- `menu.frame`, `menu.wordmark`, `menu.rule`, `menu.splashArt`, `menu.enter` (new, Prime Time), `menu.scoreHero` (new, Prime Time), `pregame.faceoff` (new, Prime Time)
- `stage.background` (new, `gradient.stage`)

## Do

- Big calm surfaces, few focused details. Every detail has a job you can say in one sentence.
- Keep O (disc) for offense and X for defense everywhere, including menus and play diagrams. Shape says the side, color says the team.
- Ring every mark and path on grass; put every small on-field word on a tag.
- Use depth to order layers: stage, then field or cards, then selection, then sheets and toasts.
- Use tabular figures for every number that ticks or lines up.
- Give every mark a real player: a label that leads to a name, a name that leads to a card.
- Test every screen at gameplay distance and speed, in grayscale and the three simulations.
- Use plain words: "Inside run", not jargon.
- Put team color in solid blocks where a broadcast puts it (bug plates, banners, end zones, the face-off), with the slot's outline color for any text on it.
- Set every game-state number (score, down, distance, spot, yardage) in the display face, big, on a calm surface.
- Tie every motion to a change the engine made or a move between screens, and give it a still version.

## Do not

- Do not add decoration with no job (crowds, stadium, lights, grass blades or noise, logos on the field, background art behind menus). The midfield home wordmark is the one painted mark allowed on the field (Prime Time); nothing else goes at midfield.
- Do not use color alone to carry meaning. Team color is never the side cue; gold is never the only selection cue.
- Do not draw a mark or path on grass without its ring, or small text on grass without its tag.
- Do not darken the turf: no edge vignette on the field, no shadow wider than `shadow.mark` on grass.
- Do not use gold for anything but selection off the field and `color.signal` on it.
- Do not put more than seven choices on a screen.
- Do not let animation show anything the engine did not decide.
- Do not put HUD or menus over the field during live action. After the whistle only a moment banner may cross it, away from the ball.
- Do not animate anything that is not listed in Motion or Rows, and never make input wait for an animation.
- Do not use a literal color, shadow, radius or duration in code: tokens only.

## Banned looks

Any of these is a reject:

- Anything that copies NFL Challenge (XOR, 1985) or any other game, or a real broadcast's graphics package: its screens, layout, names, fonts or art. Shared conventions (a score bug, a yellow line to gain, a blue line of scrimmage, a down and distance plate, a drive tracker, a team-colored touchdown banner) are fine; a specific network's bug shape, typeface, color scheme, sound or stinger is not.
- Real NFL team names, logos, marks, uniforms, or player likenesses, the NFL shield or any league or network mark. Fictional teams only.
- Retro and 8-bit tells: pixel fonts, monospace headings, boxed keycap chips in front of menu rows, hard 1 px black or cream borders around selected items, solid inverted slabs as the selection, hollow hard-edged marks with butt caps.
- Gloss and chrome: specular glass streaks, lens flares, bevels, 3D chrome or extruded text, metallic gradients.
- Gradients across hues (rainbow, neon, duotone), and any glow other than the two listed in How depth works.
- Animated swooshes, bounces, overshoots, springs, shakes, particles or confetti, lens-flare light sweeps, and looping UI motion on a game screen. CHANGED in Prime Time: wipes and staggers are allowed only where Motion and Rows name them (moment banners, the matchup intro, menu change, the calling screen's return), with the durations given there. Any other wipe or stagger is still a reject.
- Slanted, skewed or faux-italic type (only the face-off seam is slanted, and the type on it is upright).
- Photo textures, grass texture beyond the two stripes and the light, fake paper grain, noise.
- Handwriting or marker fonts, sketchy wobble lines.
- Generic AI art tells: gibberish text, melted shapes, extra limbs, inconsistent stroke weights.
- Rendered players or helmets in place of X's and O's in the base game.

## Asset intake checklist

An asset enters the build only when every box is checked:

1. It fills a named slot from the list above.
2. It uses only tokens and team colors, or a skin's declared tokens.
3. It reads at gameplay distance and speed, next to the reference disc and X, on both turf stripes, under the turf light and in an end zone, in grayscale and the three simulations.
4. It breaks no banned look.
5. docs/ASSETS.md has a row for it: source, license, AI use (none, or tool and how it was used), date, notes.
6. The license allows shipping in a public build. Fonts ship as local woff2 with their license file in the repo; nothing loads from a CDN.
7. No real team, league or player names or marks, and no text that is not real words.
8. art-director has marked it ACCEPT.

## Decisions

### 2026-11-15, Joseph: "it still feels rusty"

Joseph said, on the Broadcast build: "the aesthetic is better but it needs to be better. it still feels rusty. it needs to leverage modern trends, animations, and also appeal to nfl and football fans". Standing wishes that still hold: modern and sleek, not retro or 8-bit; broadcast polish over flat minimalism; approachable, near-sim detail.

### 2026-11-15, art-director: the Prime Time revision

Checked against the six 1440x900 screenshots (main menu, pregame, kickoff call, two kickoff play frames, 1st and 10 call) and this file. The lead's five-point read holds, with corrections:

1. Calling screens are a form floating in a void: confirmed. The two cards fill about the top third of an 836 px stage, and the only football on screen is the bug's "1ST & 10".
2. The bug is small and flat: confirmed. Five separate pills, a 6 px team chip, a 34 px score; it reads as a toolbar.
3. The field is flat: confirmed, but three of the causes were rules in this file, not build bugs: "no logos at midfield", the all-dark line of scrimmage, and dashed defense paths with a dashed ring, which is exactly the candy cane in the kickoff frames.
4. No moments: confirmed, and again this file's own doing: "No swooshes, wipes, staggered entrances" and "nothing else animates in the UI". The toasts were the only moment, and they were small.
5. Menu and pregame are plain lists: confirmed. The pregame matchup is one sentence with 12 px swatches.

Two things the read missed: the chalk keyboard focus ring drawn around the gold selected row reads as a hard cream border around the selected item, a banned look (kickoff and 1st and 10 screens); and the pregame status line prints a raw storage key, which is not real words.

Changes and why:

1. Score bug rebuilt as one fused unit with solid team name plates, dark score boxes and a 44 px score; the top bar grows to 64 px and `MIN_HEIGHT` to 536 to keep the 9.44 px per yard floor. Why: the bug is on screen the whole game; this is the single largest "TV, not toolbar" change per line of code.
2. Situation plate with a drive tracker on the calling screen. Why: it fills the void with the two things a fan reads first (down and distance, field position), in broadcast form, without bringing the field back and without adding a choice.
3. Pre-snap board, proposed, pending Joseph (see below).
4. Field: blue cased line of scrimmage plus a down tag, end zone names sized to fill, one midfield home wordmark at 0.18 white, solid paths told apart by weight and end cap, routes that draw on behind their runners, a ball-carrier trail. Why: these are the conventions every football viewer reads, and they remove the candy cane and the mid-play web of lines.
5. Moments: banners for touchdown, field goal, safety, two-point and turnover; chips for first down and big play; bug motion for score, down, possession and period; the matchup intro. Each fires only from the committed result, has a minimum hold in data, is skippable, and has a still version. Why: Joseph asked for animation; tying every motion to an engine change keeps it honest (the animation never shows what the engine did not decide).
6. Main menu hero wordmark and entrance; pregame face-off with a tale of the tape; halftime and final score hero with a line score. Why: the first and last screens of a game should feel like game night.
7. Display type pushed: every game-state number and every screen title in Barlow Condensed. Inter keeps sentences, rows and the clock. No italics (only roman 600 and 700 are bundled, and a third style is not worth a new font intake).
8. Row motion: one highlight that travels, a gold focus ring on rows, a press response, a staggered menu change that never delays input.

Rules superseded: listed at the top of this file under "Superseded by Prime Time". The Broadcast decisions below still stand except where that list names them.

Not taken, and why:

- A play clock in the bug: decision 2 of docs/specs/m2-playable-game-design.md is final, and a play clock that never ticks would be a fake.
- Team logos anywhere: there are no logo assets, and making 32 fictional logos is an asset job with its own intake, not a style change. The name in the display face does the job.
- Team color for the selection or rows: gold stays the one selection accent.
- Sound stingers: not asked for, and they need assets and a mute setting.
- A landscape field: still Joseph's 2026-11-12 decision.

Needs Joseph:

1. The pre-snap board (Layout, Calling screen, Step B) brings the field back onto the calling screen, which reverses his 2026-11-15 "the play-calling menu takes over the screen, then gives way to a full-field play" (docs/specs/m2-screen-switch.md). My recommendation is yes, with the board growing into the play field at the snap. Until he answers, Step A ships alone. If yes, the screen-switch spec needs an amendment (not made here).
2. Moments lengthen the whistle hold: about 1 s more on a touchdown, 0.6 s on a field goal, 1 s on a turnover, 0.5 s on a big play, at 1x. My estimate, not measured: on the order of 10 to 20 s over a full game. Space still skips every one. The values are in `data/ui/motion.json`, so he can tune them.
3. The matchup intro adds 2.4 s once per game, skippable.

### 2026-11-15, Joseph: modernize the design

Joseph said: "modernize the design. it almost seem like an 8bit game at this point. the UI should be modern and sleek."

This supersedes the parts of Stadium grass that caused the retro read. It does not touch the portrait field, the team colors or shape as the side cue.

### 2026-11-15, art-director: Broadcast build review (figures from test-writer, additions from engineer)

1. Team cell contrast corrected to 8.15 to 8.98 (silver lowest). My figures left out `surfaceRaised` under the tint. Still passes 4.5.
2. Game cell figures corrected: `signal` clock 8.30, Under 2:00 tag 5.81. Still pass.
3. Black chip ring failed (2.53). Fix: the inset ring is rgba(255, 255, 255, 0.55) on dark-tier fills, 0.35 stays on light-tier fills. Black is now 4.65 against its tinted cell. The same tier rule applies to every `hud.teamSwatch`.
4. Engineer's bar additions: `--bar-scale` capped at 125% accepted. Fit steps 4 (tempo), 5 (Under 2:00 tag), 6 (You tag visually hidden), 8 (type at 100%) and 9 (85%, 8 px padding) accepted, renumbered 4 to 8. Rejected: names cut to 5 characters (makes non-words, Asset intake 7) and names visually hidden (leaves color as the only team cue, Do not). Replaced by step 9, names at 16 px times the bar scale.
5. Rail result card dropped. The whistle hold is pacing in data/ui/templates.json, not a visual call, and the Last play card already shows the result. The rail keeps the This play and Keys cards.
6. Outgoing fade dropped. The outgoing screen hides in the same frame; only the incoming screen fades in. `ease.in` removed from the tokens.
7. Player card with no rail: confirmed over the field on the half away from the player, `min(280px, fieldWidth - 16px)` wide, because opening it pauses the play.

### 2026-11-15, art-director: building Joseph's decision into the Broadcast revision

What made it read 8-bit, checked against the three screenshots and the code: every fill was one flat color with hard edges (styles.css and field.ts both say so, by this file's old rule); the down and distance, scores and clock were set in a monospace stack (`.mono` on `bar-dd`, `score`, `clock`), and since no font is bundled they fall back to the system mono; every row had a bordered key box (`.row .key`); the selected row was an inverted `paper` slab with the 2 px chalk focus ring around it, which reads as a cream block with a dark border (this file said gold; the code drew paper); marks were 2 px strokes over 5 px white strokes with butt caps, still in the retired offense blue and defense brown; the top bar was one line of text; and during the play the column sat flush left (`layoutFor` puts it there whenever 300 px or more are spare, a rule made for the side column the screen switch removed), leaving about 40% of a 1280 px window empty navy.

Changes and why:

1. Depth allowed, with a job per effect (How depth works). Why: Joseph asked for modern and sleek; soft depth is the most direct signal of it, and listing each effect with its job keeps it from turning into decoration.
2. Fonts: Inter replaces Atkinson Hyperlegible and IBM Plex Mono; Barlow Condensed stays for display. Two families. Why: see Typography. Mono was the loudest retro cue, and tabular Inter does its job.
3. Rows: soft key hints instead of boxed chips; the selection is a gold-tinted card with an accent bar, ring and glow instead of a paper slab. Why: the boxes and the slab are the 8-bit tells Joseph saw; the new selection still changes shape, weight and ring, not only color.
4. Score bug: grouped glass cells with team chips, tinted cells, bars for timeouts and an ellipse for possession, no gold rule. Why: Joseph asked for a real scoreboard; the shadow and hairline now do the gold rule's job of ending the bar.
5. Play screen: the field column and a read-only rail centered together. Portrait kept. Why: it fills the empty side with what you are watching and what happened, with no choices and nothing over the field. A landscape field would use a wide window best, but it would undo Joseph's 2026-11-12 orientation decision and most of the motion and spacing work, so it is not taken.
6. Marks: filled discs and rounded X's with a 1.5 px ring and a soft shadow; labels on tag pills. Why: a solid team chip reads faster than a thin hollow ring, and pills read crisper than stroked text. The footprint stays `markPx`, so spacing holds.
7. Turf: lighter stripe contrast (#327739), a center light, softer yard lines, a cased solid first-down line. Why: the turf reads as lit and calm; the casing keeps the line to gain at 3:1 in every simulation now that the center is lifted.
8. Top bar 56 px and minimum window 800x528. Why: room for a two-line team cell; the minimum moves so the floor scale stays 9.44 px per yard.
9. Main menu: stage gradient, the splash art in a card, `menu.rule` becomes a short gold accent bar. Why: same language as the game screens.

Rules retired or reversed: "flat but bold"; the gradient, shadow, glow and lighting bans; "depth from layer order only"; the gold scoreboard rule; `font.mono`; the 2026-11-15 main menu decision 2 (full-width 2 px gold rule, now a 48 px accent bar); dashed first-down line; stroked on-field text; "The DOM column and top bar sit beside the field" (the top bar sits above it; the rail sits beside it).

### 2026-11-15, art-director, main menu (docs/specs/m2-main-menu.md, Open 3)

Goal from Joseph: the first screen is a real main menu that sets the tone without too much going on at once.

1. `font.display` for the wordmark: approved. Still holds.
2. Gold rule under the main menu wordmark only. SUPERSEDED 2026-11-15 (Broadcast): `menu.rule` is a 48 px accent bar; still main menu only.
3. Diagram marks and paths in `color.line` over `color.outlineDark`, no team color, both sides: approved. Still holds, drawn in the new mark style.
4. Diagram first-down line: not drawn on the splash. Still holds.
5. Art ratio 0.68, hidden under a 360 px art column: approved. Still holds.
6. Play: Shotgun play action against Nickel Cover 3. Still holds.
7. Window too small on the dark background: approved. Still holds, now on `gradient.stage`.
8. One `--font-display` variable for every display use, no web font before intake. Still holds; the fallback after Barlow is now Inter.
9. Slots `menu.frame`, `menu.wordmark`, `menu.rule`, `menu.splashArt`: approved. Still hold.

### 2026-11-14, Joseph (supersedes his 2026-11-12 decisions 1 and 2)

Joseph looked at the running game and said the style should match what is expected of a football game, the colors needed rework, and it was too plain. He chose:

1. Field: "Stadium grass". Deep green turf with alternating mowing stripes every 5 yards, white yard lines and numbers, end zones in team colors with the team name in white block caps, a navy scoreboard-style top bar with gold accents and big score digits, dark navy menu panels with a gold highlighted row, outlined O's and X's. The palette, end zones and team colors still hold; the flat-only treatment is superseded by Broadcast (2026-11-15).
2. Marks take team colors (home vs away). Shape stays the side cue. Still holds.

### 2026-11-15, art-director, building the 2026-11-14 decisions into this file

- Paper field, "no team colors on marks", side colors on play cards and rating bars: removed. Still removed.
- Gradients banned everywhere, including subtle ones. SUPERSEDED 2026-11-15 by Broadcast.
- Outlines on every mark, path and the ball. Still holds as rings.
- Mark labels white with a dark stroke. SUPERSEDED 2026-11-15: white on a dark tag pill.
- End zone colors per slot in one luminance band; line of scrimmage near-black; gold as signal; ink on paper play cards. Still hold.
- Three families with Barlow Condensed for display. SUPERSEDED 2026-11-15: two families, Inter and Barlow Condensed.
- `inkSoft` #4F565B, `signal` #FFCB3D, navy `panel` and `panelRaise`. Still hold.

### 2026-11-12, Joseph

1. Field: paper, cream and ink. SUPERSEDED 2026-11-14.
2. Team colors as a small swatch only. SUPERSEDED 2026-11-14.
3. Orientation: portrait field, the team with the ball attacks up. Why: a play reads like a playbook page, one direction, every time. Still holds.

### 2026-11-12, art-director, resolving the six conflicts from docs/specs/m2-playable-game-design.md

1. Play clock dropped from the HUD. Still holds.
2. Speed toggle on S, live during the animation. Still holds.
3. Menus in a right-hand side column. SUPERSEDED 2026-11-15 by the screen switch (calling screen) and the play rail.
4. Down and distance in the call panel header, 24 px mono. SUPERSEDED 2026-11-15: 28 px Inter in the call card, and display caps in the score bug.
5. Marks in pixels, line spacing as a diagram rule, depths kept to template yards. Still holds.
6. Missing slots added. Still holds.

## Still open

- Joseph's look at a rendered screenshot of Broadcast: calling screen, play screen with the rail, main menu, and a goal-line play in a red end zone with an orange-against-red matchup, in normal, grayscale and the three simulations, before this revision leaves DRAFT.
- Code check of every hand-computed figure here (the usability-pass contrast test and the colorblind test). Watch: dark ring on the dark stripe under deuteranopia (3.21), white ring at the lit center under protanopia (4.35), silver against lilac (1.42 under tritanopia), selected-row notes (4.83).
- Font intake: Inter and Barlow Condensed woff2 plus OFL files, Inter's l and I feature tags, Barlow's tabular figures (docs/ASSETS.md).
- Team colors must reach the field before the new marks can be judged: the build still draws the retired offense and defense colors and the old placeholder swatches.
- The play rail amends docs/specs/m2-screen-switch.md ("the field alone"); the spec should record it.
- Eight color slots for 32 teams: teams 8 to 31 reuse a slot by index mod 8. One color per team needs 32 entries in tokens.ts or a color field in data/teams/names.json (a schema change, needs Joseph).
- Jersey numbers on marks need jersey numbers in the player data (a schema change, needs Joseph).
- Label pills are 2 to 3 px wider than the stroked labels were. Check line spacing and label collisions at 800x536 with a 5-man line and a goal-line formation.
- Mark shadows at 60 fps: if they cost frames, cache sprites (Shadows).
- Prime Time, Joseph: the pre-snap board (yes or no), the longer holds on moments, the matchup intro (Decisions, "Needs Joseph").
- Prime Time, code check: every new figure in Contrast checks, "Prime Time additions". Watch the midfield wordmark under a white ring at the lit center (3.34; 3.17 under protanopia) and banner text on red and cobalt under the sheen (4.74).
- Prime Time, font check: Barlow Condensed's cap height (0.70 em is assumed for end zone sizing) and tabular figures (the plate and the bug score keep fixed digit boxes until confirmed).
- Prime Time, data: the drive line under the tracker ("Drive: 3 plays, 22 yds") and the Continue row's mini score depend on the event log and the save already holding those values; neither may add a schema change. If they are missing, those two lines are hidden, not faked.
- Team colors on the field: the 2026-11-15 kickoff screenshots show team-colored marks (orange O's, red X's), so the "team colors must reach the field" item above looks done; engineer to confirm `color.offense` and `color.defense` are deleted, then close it.
- Bar width at 800 px with the fused bug: estimated about 780 px with the "You" tag; confirm in the build which fit steps run.

## Build order (Prime Time)

Ranked by how much of the rusty feel each chunk removes per unit of work. Each chunk ships on its own, passes the tests, and gets an art-director review on screenshots at 1440x900 and 1024x600, in grayscale and the three simulations, before the next starts.

1. Score bug, situation plate, rows (DOM and CSS, no canvas, no decision needed). The fused bug with team plates, score boxes and its motion (odometer, down swap, first-down flash, possession slide); top bar 64 px and `MIN_HEIGHT` 536 with their layout tests; display type for the bug, plate and screen titles; the situation plate with the drive tracker; the call card's breadcrumb header; the gold focus ring on rows, highlight travel, press and menu change. Why first: the calling screen and the bug are on screen for about 150 dead balls a game, and this removes the "settings form" read with CSS and one small SVG or canvas strip.
2. Field paint (canvas, the field drawing code only). Cased blue line of scrimmage and the down tag; end zone names sized to fill; the midfield wordmark; solid paths by weight and end cap and solid zone edges (the candy cane goes); paths that draw on behind their runners; the carrier trail. Why second: the play screen is the other half of every snap, the changes are local to drawing code and existing slots, and the spacing and contrast tests already cover the field.
3. Moments (play screen overlay plus timeline holds). The banner, the five banner moments through `fx.score` and `fx.turnover`, the first-down and big-play chips, the quarter-end line score in the plate, the two-minute bug change, the `moments` block in `data/ui/motion.json` and the hold rule. Depends on chunk 1 (the bug's score and possession motion syncs to the banner). Why third: the biggest "feel" gain left, but it touches the timeline's hold and needs the bug first.
4. Front door (menu mode). Main menu hero and entrance and the Continue mini score; screen push transitions; the pregame face-off and tale of the tape; the matchup intro into the bug; halftime and final score hero with the line score; the pregame status copy in words. Why fourth: high first impression, but seen a few times per game, not 150.
5. Pre-snap board and the snap growth (only after Joseph says yes). The board on the calling screen with focus previews, the board-to-field growth at the snap and the shrink back, and the amendment to docs/specs/m2-screen-switch.md. Why last: the most work and the only chunk that reverses a decision of Joseph's. If he says yes early, it can move up to third, since it reuses chunk 2's field paint.
