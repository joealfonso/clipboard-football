# DESIGN.md: Clipboard Football

Status: DRAFT. Revision "Broadcast" (art-director, 2026-11-15, from Joseph's 2026-11-15 decision, see Decisions). It replaces the flat-only look of "Stadium grass" on every screen. Kept from Stadium grass: the turf base color, the team color table with its two outline tiers, the end zone colors, shape as the side cue, the navy and gold family. Still approved from 2026-11-12: the portrait field. The whole direction stays a draft until Joseph has looked at a rendered screenshot of it (normal, grayscale and the three colorblind simulations, see Still open).

Superseded by this revision (kept here so nobody rebuilds them): "flat but bold", "no gradients anywhere, not even subtle ones", "no drop shadows, no glows, no lighting", "depth comes from layer order only", the gold rule under the scoreboard, boxed key chips in menu rows, the paper-slab selected row, IBM Plex Mono, Atkinson Hyperlegible, hollow outlined O marks, stroked text labels on the field, the flush-left field during the play.

## Vision

Game-day football with a coach's eye, presented like a current sports app: a deep navy stage, a glassy score bug, softly lit turf, and X's and O's as clean team-colored chips you can read in a glance and argue over on Monday. Detailed to the point of a sim without being one: every mark is a real player you can name, and nothing on screen is there for show.

Three words to check work against: calm, crisp, lit. Calm: big quiet surfaces and one accent. Crisp: anti-aliased shapes, exact type, tabular numbers. Lit: soft depth (gradient, shadow, blur) that separates layers, never decoration.

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

### Color: text and accent (unchanged values, new rules)

| Token | Hex | Use |
|---|---|---|
| `color.chalk` | #F5F2E8 | Strong text on dark surfaces, keyboard focus ring |
| `color.chalkSoft` | #A9B3B8 | Secondary text on dark surfaces: notes, reasons, section labels, key hint numbers, clock state |
| `color.gold` | #FFCB3D | The selection accent and only that off the field: selected row accent bar and ring, selected key hint fill, highlighted play-card ring, the main menu accent bar (`menu.rule`). Nothing decorative is gold |
| `color.signal` | #FFCB3D | Key state: possession glyph, clock under 2:00, first-down line, flag and challenge markers, the accent on score and turnover toasts. Same hex as gold, its own token for its role |
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
| `color.outlineDark` | #0A0D0B | Unchanged. Line of scrimmage, the dark ring of light-tier marks, the first-down line casing, flag marker outline |
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
| `gradient.teamTint` | `linear-gradient(90deg, <team fill at 0.14 alpha> 0%, transparent 70%)` over `color.surfaceRaised` in a scoreboard team cell |
| `gradient.turfLight` (canvas) | radial, centered on the field column's center and the view's vertical center, inner radius 0, outer radius `0.6 * hypot(columnWidth, viewHeight)`; stops 0: `color.turfLight`, 1: rgba(255, 255, 255, 0). Painted over the turf and stripes, under all field paint. No darkening at the edges: darker edges would push the dark ring under 3:1 (see Contrast) |

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
| `shadow.toast` | rgba(0, 0, 0, 0.40) | 12 px | 0, 4 px |
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
| `dur.screen` | 240 ms (calling and play screens crossfade) |
| `ease.standard` | `cubic-bezier(0.2, 0, 0, 1)` (anything that moves and stays) |
| `ease.out` | `cubic-bezier(0, 0, 0.2, 1)` (things arriving) |

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
- `font.display`: Barlow Condensed, 600 and 700, SIL Open Font License 1.1. Block caps only. Used for: team names and score digits in the score bug, down and distance in the score bug, the main menu wordmark, yard numbers, end zone names, score and turnover toasts. Use tabular figures for score digits if the font has them (check at intake); if not, each score sits in a fixed-width box (`min-width: 2ch`, right aligned) so the bug never shifts.
- `font.mono`: retired. IBM Plex Mono is not shipped. Tabular Inter does every job mono did.
- Why Inter: it is the face current product and sports apps are built on, so it reads as modern at once; one variable file gives the whole weight range for hierarchy (Atkinson Hyperlegible's original release has 400 and 700 only); its tabular figures let it replace mono, which was the loudest retro cue on screen; and its tall x-height holds up at 12 to 13 px on the field. Why Barlow Condensed stays: narrow block caps are what a score bug and painted field lettering need, and it is already approved and wired as one variable.
- Variables: `--font-ui: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;` and `--font-display: "Barlow Condensed", "Inter", system-ui, sans-serif;`. Every use reads the variable. TS mirrors them as `FONT_UI` and `FONT_DISPLAY`.
- Bundled locally (intake done 2026-11-15, docs/ASSETS.md "Bundled fonts"): woff2 files and each family's OFL license file in the repo, loaded by `@font-face` with `font-display: swap`. No CDN, no `@import`, no Google Fonts link, no substitute condensed face (Impact, Arial Narrow, Oswald or the like). Canvas waits for `document.fonts.load()` of the faces it uses and redraws when `document.fonts.ready` resolves.
- Sentence case for UI text. Block caps only in `font.display`. No handwriting, marker or pixel fonts.

Type scale (CSS sizes are times `var(--text-scale)`; canvas sizes are times the text scale):

| Token | Face | Weight | Size / line height | Notes |
|---|---|---|---|---|
| `type.wordmark` | display | 700 | 56 / 1.0 | caps, letter-spacing 0.01em |
| `type.screenTitle` | ui | 700 | 28 / 1.2 | letter-spacing -0.01em |
| `type.callHeader` (`hud.downDistance` in the call card) | ui | 700 | 28 / 1.2 | tabular, letter-spacing -0.01em |
| `type.result` | ui | 600 | 20 / 1.35 | |
| `type.body` (why line, tagline at 18) | ui | 400 | 17 / 1.45 | |
| `type.row` | ui | 500, 600 when selected | 17 / 1.3 | |
| `type.note` (row notes, reasons, calls line, side line) | ui | 400 | 15 / 1.4 | `chalkSoft` |
| `type.label` (section labels like "Play type") | ui | 600 | 13 / 1.2 | `chalkSoft`, letter-spacing 0.02em, sentence case |
| `type.key` (key hints, legend keys) | ui | 600 | 13 / 1 | tabular |
| `type.small` (clock state, legend labels, "You" tag) | ui | 500 | 12 / 1.2 | |
| `type.bugName` | display | 600 | 20 / 1 | caps, letter-spacing 0.02em |
| `type.bugScore` | display | 700 | 34 / 1 | tabular |
| `type.bugClock` | ui | 700 | 22 / 1 | tabular |
| `type.bugDown` | display | 700 | 22 / 1 | caps |
| Canvas `field.yardNumber` | display | 700 | 26 px, never under 24 | |
| Canvas `field.endzone` names | display | 700 | 32 px, never under 28 | caps, letter-spacing 0.06em |
| Canvas `mark.label` | ui | 600 | 12 px | |
| Canvas tags (Huddle, Flag, Challenge, Standout) | ui | 600 | 14 px | |
| Canvas toast (`fx.score`, `fx.turnover`) | display | 700 | 22 px | caps |

## Field

The field runs up and down the screen. The team with the ball always attacks up. On a change of possession the view flips, so the team with the ball is always the O's, always moving up. Anti-aliased everywhere; 1 px lines snap to half pixels so they stay sharp.

- Surface: mowing stripes in 5-yard bands, goal line to goal line, alternating `color.turf` and `color.turfStripe`, starting with `turf` at each goal line. Bands are fixed to the field and pan with it. Job: 5-yard chunks readable at a glance. The playing field is 53.3 yards wide and 120 long including end zones, drawn to scale, with a 1.35-yard `color.sideline` margin outside each sideline.
- Turf light (`field.light`): `gradient.turfLight` over turf, stripes and end zones, under all paint. Fixed to the view, not the field, so it does not pan.
- Boundary: sidelines and end lines `color.line`, 3 px, full opacity.
- Yard lines: `color.line` at 0.8 alpha, 1 px, every 5 yards. Goal lines `color.line`, 3 px, full opacity. Job of the softer yard lines: the field reads as calm turf with lines on it, and the goal lines stand out from the rest.
- Yard numbers: every 10 yards, `type` per the scale, `color.line` full opacity, upright, inset 4 yards, the line broken behind the digits (skip the segment, no box). No arrows.
- Hash marks: `color.hash` ticks, 1 yard wide, every yard between the 5-yard lines, at the NFL hash positions (70 ft 9 in from each sideline). Job: count single yards of gain.
- End zones: flat `team.<id>.endZone`, 10 yards deep, the defending team's name in `color.line`, display 700 caps, upright. No logos, no stripes, no outline on the letters.
- Goal posts (`field.goalPost`): on each end line, from above. A 2 px `color.line` crossbar 18 ft 6 in wide with round caps and a 4 px filled `color.line` dot at each upright.
- Line of scrimmage: solid `color.outlineDark`, 3 px, round caps.
- First-down line: solid `color.signal` 3 px with a 1 px `color.outlineDark` casing on each side (5 px total), round caps. Was dashed; solid with a casing reads as the line to gain the way a broadcast shows it, and the casing keeps 3:1 in every simulation. In grayscale it is light with dark edges, the line of scrimmage is all dark, so they read apart.
- Ball spot: the ball sits on the center line of the field unless the PlayResult gives a side.
- Pre-snap preview art (coverage zones and depth bands): fills `color.line` at 10% times the route opacity, zone edges dashed (4, 3) in the defense team's fill over its ring color, round caps. Tethers in the defense fill, the generic offense circle in the offense fill, both ringed.
- Field shadow (`field.shadow`): on the play screen, `shadow.field` cast by the field column onto the stage, left and right. Drawn only when the view is wider than the column. Not on the splash (the splash card has its own `shadow.2`).
- Outside the column, the canvas is transparent (`clearRect`), and the stage gradient shows from CSS. The canvas never paints the stage.
- No grass blades, noise, photo texture, logos at midfield, crowds or stadium.

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
- Paths: team fill 2.5 px over the ring color 5 px, round caps and joins. Offense routes solid with an arrowhead (two 7 px strokes, round caps). Defense paths dashed (6, 4), the outline dashed to match. Blocks end in a 10 px perpendicular tick, same two strokes. The ball path is dotted `color.line`, 2 px (dot 2, gap 5), round caps, above routes. Solid, dashed and dotted keep the three apart in grayscale.
- On-field tags (`field.huddleLabel`, the Flag, Challenge and Standout words): the same `color.tag` pill, Inter 600 14 px `color.line`, 18 px tall, 6 px horizontal padding.

### Spacing (unchanged rules)

The line is drawn as a playbook diagram, not to yard scale. Marks never overlap at the snap, rings included.

- Center to center along the line: at least the wider of the mark and its label plus a 4 px gap. Templates in `data/ui/` place players in yards; when the line comes out tighter, the renderer spreads it out from the center. Depths are never changed.
- Stacked players: at least mark + label + 6 px apart up and down; if a template can't fit that, the label moves to the right of the mark.
- During the live play only the labels of players the PlayResult names stay drawn; the rest return at the whistle. When two labels would collide, the named player's is drawn and the other hidden. Marks are never hidden.
- Labels scale with the text-size setting, and the spacing rule widens the line to match.

## Layout

Three screens. Menu mode is every screen before a game exists. In a game the calling screen and the play screen switch at the snap and at the end of the whistle hold (docs/specs/m2-screen-switch.md, Joseph 2026-11-15). Nothing ever covers the field during the play except the player card, which pauses the play.

Window minimum: 800x528 (`MIN_HEIGHT` raised from 520 because the top bar grows 8 px; this keeps the floor at 9.44 px per yard, the scale every spacing test was checked at).

### Top bar (both game screens)

56 px tall (`TOP_BAR` from 48). See HUD: score bug.

### Calling screen

```
+--------------------------------------------------------------------+
| score bug (glass)                                      key hints   |
+--------------------------------------------------------------------+
|        stage gradient                                              |
|   +-----------------------+  +----------------------------------+  |
|   | Last play (card)      |  | Your call (card)                 |  |
|   | result line           |  | 1st & 10 at OPP 39               |  |
|   | why line              |  | You're on offense                |  |
|   | calls line, events    |  | Play type                        |  |
|   |                       |  | [1] Formation       (row cards)  |  |
|   |                       |  | [2] Kick (reason)                |  |
|   +-----------------------+  | ...  at most 7 rows              |  |
|                              | status line                      |  |
|                              +----------------------------------+  |
|   legend: Arrows Move  Enter Pick  D Details  M Player cards      |
+--------------------------------------------------------------------+
```

- Content width at most 1160 px, centered, side padding `max(24px, (100% - 1160px) / 2)` as built. 24 px top padding under the bar.
- At 760 px of content width and up: two cards in a grid, `minmax(260px, 5fr) 7fr`, gap 24, top aligned. Below 760: one column, the last-play card above the call card, gap 16. The last-play card has a fixed minimum height (four lines of `type.result`) in one column, so the rows never move.
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
- Otherwise (for example 800x528, or 1024x600 at 125% text): no rail, the column is centered alone, and the rail's key hints go back into the top bar as today.
- The column runs the full height under the top bar, with `shadow.field` left and right.
- Rail (`hud.playRail`): read only, no choices. Top 16 px, bottom 16 px. Cards stacked with 12 px gaps, each `color.surface`, `blur.glass`, 1 px `color.hairline`, `radius.lg`, padding 16 px 18 px, `shadow.2`.
  1. This play (from the snap): `type.label` "This play", then the calls line in `type.note` `chalk`: "You: Shotgun, Short pass." and "They: Nickel Cover 1 Blitz." on two lines. Job: what you are watching, while you watch it.
  2. Keys, pinned to the bottom: Space Skip, S Speed (value), M Player card, as key hints. Job: the controls that work right now.
- No result card in the rail (dropped 2026-11-15). At 1x the play screen holds only about 400 ms after the whistle (800 ms on a score), and the calling screen's Last play card shows the same result a moment later. The whistle hold is pacing, tuned in data, and stays as it is; the on-field toasts and labels carry the key moment.
- Player card on the play screen: with a rail, it opens over the rail (top aligned with it, the rail's width), covering nothing on the field. With no rail (for example 1200x800 with the field's margins under 280 px, or 800x528): width `min(280px, fieldWidth - 16px)`, 8 px from the window edge, 8 px under the top bar, on the half of the window away from the player's mark, over the field. This is the one thing allowed over the field, because opening it pauses the play.
- This amends docs/specs/m2-screen-switch.md, "the field alone, no panel", for windows with room for the rail. The rail holds no menu, covers nothing and decides nothing.

## HUD

### Score bug (`hud.scoreboard`)

The top bar is a glass strip: `gradient.topBar`, `blur.glass`, 1 px `color.hairline` bottom border, `shadow.2`. No gold rule. Inside it, left to right from 12 px in, grouped cells 44 px tall, `radius.md`, `color.surfaceRaised`, padding 0 12 px, gap 6 px:

1. Away team cell, then home team cell (`hud.team`): `gradient.teamTint` fill. Grid: team chip | name over timeouts | score | possession.
   - Team chip (`hud.teamSwatch` in the bug): 6 by 28 px bar, `radius.sm` 3 px, team fill, 1 px inset ring rgba(255, 255, 255, 0.55) on dark-tier fills and rgba(255, 255, 255, 0.35) on light-tier fills (Contrast checks).
   - Name: `type.bugName`, `chalk`. The human's team adds a "You" tag after the name: pill, rgba(255, 255, 255, 0.10) fill, `type.small` `chalkSoft`, padding 1 px 6 px.
   - Timeouts (`hud.timeouts`): bars under the name, 14 by 4 px, `radius` 2 px, gap 3 px. Left: `chalk`. Spent: rgba(255, 255, 255, 0.18). Text count for screen readers as built.
   - Challenges (`hud.challenges`, when built): 6 by 6 px squares, `radius` 1 px, same colors, after the timeout bars. Bars and squares read apart in grayscale.
   - Score: `type.bugScore`, `chalk`, `min-width: 2ch`, right aligned. The largest text in the bar.
   - Possession (`hud.possession`): a 10 by 6 px `color.signal` ellipse right of the score of the team with the ball. The word "ball" stays in the DOM, visually hidden, so screen readers get it.
2. Game cell (`hud.clock`, `hud.clockState`): period in `type.small` `chalkSoft` ("1st", "Final"), clock in `type.bugClock` `chalk`, clock state under or beside it in `type.small` `chalkSoft` ("Running", "Stopped"). Under 2:00 of a half: the clock turns `color.signal` and an "Under 2:00" tag appears (pill, rgba(255, 203, 61, 0.16) fill, `type.small` 600 `signal`).
3. Situation cell (`hud.downDistance` in the bug): "1ST & 10" in `type.bugDown` `chalk`, "at OPP 39" in `type.small` `chalkSoft` beside it. Hidden at Final.
4. Tempo (`hud.tempo`) when not Normal: a tag like the Under 2:00 tag, in `chalkSoft` on `surfaceRaised` ("Hurry-up", "Run the clock").
5. Right edge: key hints for what works now (Esc Menu while calling; Space, S, M during the play when there is no rail).

Bar type scale: every font size in the bar uses `--bar-scale: min(var(--text-scale), 1.25)` instead of `--text-scale`. Why: at 200% the score clipped the 56 px bar; at 125% the score is already 42.5 px, and the call card's down and distance follows the full text scale.

When the bar is too narrow, apply these fit steps in order, stopping at the first that fits:

1. Hide the key hint labels.
2. Hide the clock state word.
3. Hide the key hints.
4. Hide the tempo tag.
5. Hide the Under 2:00 tag (the clock stays `signal`).
6. Visually hide the "You" tag (screen readers still read it).
7. Bar type at 100% (`--bar-scale: min(var(--text-scale), 1)`).
8. Bar type at 85% (`--bar-scale: 0.85`), cell padding 0 8 px.
9. Team names at `calc(16px * var(--bar-scale))`.

Score, clock, down and distance and the team names are never dropped, cut or hidden (U5). A cut name ("Outri") is not a real word (Asset intake 7), and a hidden name leaves the chip's color as the only team cue (Do not). If the bar still overflows after step 9 at 800 px wide with the longest nickname at 125% text, report the width to art-director rather than add a step.

- No play clock. Turn-based, so the run-off shows on the game clock in the pre-snap beat.
- Team swatch elsewhere (box score, pregame matchup): 12 px rounded square, `radius` 3 px, same inset ring, the name always beside it. Swatches stay squares; pips are bars and possession is an ellipse.

### Rows (`hud.playMenu`, every menu in both modes)

Rows are clickable cards. At most seven per screen.

- Rest: `color.rowRest` fill, `radius.md`, min height 48 px, padding 10 px 14 px, gap 12 px inside, 6 px between rows. Label `type.row` `chalk`, note `type.note` `chalkSoft`.
- Key hint (`hud.keyHint`): replaces the boxed key chip. 24 by 24 px minimum (wider for "Esc"), `radius.sm`, `color.surfaceRaised` fill, no border, `type.key` `chalkSoft`. Job: every row shows its key at all times, quietly, so number keys stay discoverable without a box in front of every line.
- Selected or hovered (`hud.playMenu.selected`; hover moves the selection, as built): `gradient.select` fill, `shadow.select`, label weight 600, a 3 px `color.gold` accent bar on the left edge inset 8 px top and bottom with `radius` 2 px, key hint filled `color.gold` with `ink` text. Selection is never color alone: the bar, the ring and the weight all change. The bar grows in (scaleY 0 to 1, `dur.base`, `ease.standard`); fill and shadow transition over `dur.base` with `ease.standard`.
- Keyboard focus: 2 px `color.chalk` outline, offset 2 px, following the row's radius.
- Pressed: `transform: scale(0.99)` for `dur.fast`.
- Off (`hud.playMenu.disabled`): no fill, label and key hint number `chalkSoft`, key hint with no fill, the reason in words in `type.note` ("Kick (4th down or last 2:00 only)"). Selected while off: a 1 px dashed rgba(169, 179, 184, 0.6) outline inset 2 px, no gold anywhere. Never opacity alone.
- Status line under the rows: `type.note` `chalkSoft`.
- Section label ("Play type"): `type.label`, 16 px above the first row.

### Report text

- Result line (`hud.resultLine`): `type.result`, `chalk`. What happened, with names.
- Why line (`hud.whyLine`): `type.body`, `chalk`. Only factors the engine used. Stays until the next snap.
- Calls line (`hud.callsLine`): `type.note`, `chalkSoft`. "You: Shotgun, Short pass. They: Nickel Cover 1 Blitz."
- Call card header: `type.callHeader` "1st & 10 at OPP 39", then "You're on offense" in `type.note` `chalkSoft`. Sentence case, Inter, not mono.

## Play cards and the player card

- Play cards (`card.play`): `color.paper` tiles, `radius.md`, `shadow.1`, padding 6 px, diagrams in `color.ink` for both sides (O and X carry the side, defense paths dashed), zones and bands `color.paperShade` with dashed `color.inkSoft` edges. Job: a printed playbook card, the same for every team. Highlighted: 2 px `color.gold` outline at 2 px offset, `translateY(-2px)`, `shadow.2`, over `dur.base` `ease.standard`; the label strip turns `paperShade`. Off: `paperShade` tile, `inkSoft` label with the reason in words, art at half opacity.
- Player card (`card.panel`): `radius.xl`, `shadow.3`, 1 px `color.hairlineStrong`, no ink border. Header band in the team fill (top corners rounded with the card) with name, jersey number and position in the slot's outline color, Inter 700 18 px, tabular number. Body `color.paper`, `ink` text, 16 px padding.
- Rating bars (`card.ratingBar`): 8 px tall, `radius` 4 px, `inkSoft` fill on a `paperShade` track, value beside in Inter 600 tabular. Never team colors.
- Bars on dark surfaces: `color.track` track, `chalkSoft` fill, same radius, value printed.

## Main menu (menu mode)

- `menu.frame`: the full window on `gradient.stage`. Content frame centered, width `min(1040px, 100vw - 64px)`, padding 32 px, as built.
- `menu.wordmark`: `type.wordmark`, `chalk`, left aligned, wraps rather than clips. Live text.
- `menu.rule`: now an accent bar, 48 px wide, 3 px tall, `radius` 2 px, `color.gold`, 14 px under the wordmark. Job: ends the header and repeats the selection accent, so the first gold you see is the one that means "this".
- Other menu screens (Settings, Controls, Pregame, rosters, error screens): title in `type.screenTitle`, `chalk`, then 16 px of space, no accent bar. Content in one glass card per group.
- `menu.splashArt`: amended 2026-11-15 (Joseph): no turf. Only the marks, running the play on a loop with dotted `color.line` trails behind them; a still finished frame under reduced motion (docs/specs/m2-main-menu.md, Splash composition). Was: the static play diagram, drawn with the field's own code (new turf, light, marks, rings and round caps), inside a card: `radius.lg`, `overflow: hidden`, 1 px `color.hairline`, `shadow.2`. Marks and paths for both sides in `color.line` fill with an `outlineDark` ring (no team implied). No end zone, no first-down line, no labels, no zones, no text. Ratio 0.68. Hidden when its column is under 360 px, at text size 150% or more, or without Canvas 2D.
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
- Score and turnover (`fx.score`, `fx.turnover`): a toast above the spot. `color.surfaceSolid` at 0.92, `radius.md`, 1 px `color.hairlineStrong`, `shadow.toast`, a 3 px `color.signal` accent bar inside the left edge, text display 700 22 px caps `chalk`, padding 6 px 12 px. It fades and rises in 6 px over `dur.slow` with `ease.out`. A turnover always shows text as well as the change of marks.
- After the whistle the paths stay drawn until the next snap.
- Reduced motion: skip to the final frame with paths drawn; toasts appear with no transition.

UI transitions (the outgoing screen leaves at once; there is no fade-out, so the calling panel never lingers over the play):

- Calling to play (at the snap): the calling content is hidden in the same frame, then the field and rail fade in over `dur.screen` (`ease.out`). The timeline starts at the snap as now; the fade never delays or pauses it.
- Play to calling (end of the whistle hold): the field is hidden in the same frame, and the calling cards fade in and rise 8 px over `dur.screen` (`ease.out`).
- Selection, hover, press and card lift: the durations and curves in Rows and Play cards. Nothing else animates in the UI. No swooshes, wipes, staggered entrances or looping motion.

## Art slots for future skins

Code draws through these named slots. A skin replaces a slot's drawing or values, never the game logic. Slot ids are stable once approved.

- `field.surface`, `field.turfStripe`, `field.sideline`, `field.light` (new 2026-11-15, Broadcast), `field.shadow` (new 2026-11-15, Broadcast), `field.endzone.home`, `field.endzone.away`, `field.yardLine`, `field.yardNumber`, `field.hash`, `field.goalPost`, `field.scrimmageLine`, `field.firstDownLine`, `field.huddleLabel`
- `mark.offense`, `mark.defense`, `mark.number`, `mark.label`, `mark.ballCarrier`, `ball`
- `path.offenseRoute`, `path.defenseRoute`, `path.block`, `path.ball`
- `hud.scoreboard`, `hud.team` (new), `hud.teamSwatch`, `hud.downDistance`, `hud.clock`, `hud.clockState`, `hud.tempo`, `hud.timeouts`, `hud.challenges`, `hud.possession`, `hud.playMenu`, `hud.playMenu.selected`, `hud.playMenu.disabled`, `hud.keyHint` (new), `hud.legend` (new), `hud.playRail` (new), `hud.resultLine`, `hud.whyLine`, `hud.callsLine`
- `card.panel`, `card.ratingBar`, `card.play`
- `fx.flag`, `fx.challenge`, `fx.standout`, `fx.score`, `fx.turnover`
- `team.<id>.name`, `team.<id>.abbrev`, `team.<id>.color`, `team.<id>.outline`, `team.<id>.endZone`
- `font.ui`, `font.display` (`font.mono` retired 2026-11-15)
- `menu.frame`, `menu.wordmark`, `menu.rule`, `menu.splashArt`
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

## Do not

- Do not add decoration with no job (crowds, stadium, lights, grass blades or noise, logos on the field, midfield art, background art behind menus).
- Do not use color alone to carry meaning. Team color is never the side cue; gold is never the only selection cue.
- Do not draw a mark or path on grass without its ring, or small text on grass without its tag.
- Do not darken the turf: no edge vignette on the field, no shadow wider than `shadow.mark` on grass.
- Do not use gold for anything but selection off the field and `color.signal` on it.
- Do not put more than seven choices on a screen.
- Do not let animation show anything the engine did not decide.
- Do not put HUD or menus over the field during the play.
- Do not use a literal color, shadow, radius or duration in code: tokens only.

## Banned looks

Any of these is a reject:

- Anything that copies NFL Challenge (XOR, 1985) or any other game, or a real broadcast's graphics package: its screens, layout, names, fonts or art.
- Real NFL team names, logos, marks, uniforms, or player likenesses. Fictional teams only.
- Retro and 8-bit tells: pixel fonts, monospace headings, boxed keycap chips in front of menu rows, hard 1 px black or cream borders around selected items, solid inverted slabs as the selection, hollow hard-edged marks with butt caps.
- Gloss and chrome: specular glass streaks, lens flares, bevels, 3D chrome or extruded text, metallic gradients.
- Gradients across hues (rainbow, neon, duotone), and any glow other than the two listed in How depth works.
- Animated swooshes, wipes, bounces, overshoots, staggered or looping UI motion.
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
- Label pills are 2 to 3 px wider than the stroked labels were. Check line spacing and label collisions at 800x528 with a 5-man line and a goal-line formation.
- Mark shadows at 60 fps: if they cost frames, cache sprites (Shadows).
