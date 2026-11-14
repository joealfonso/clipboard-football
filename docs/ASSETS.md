# ASSETS.md

Every asset in the build has a row here. A missing row is a reject. See the asset intake checklist in DESIGN.md.

AI use: write "none", or name the tool and say what it did.

| asset | source | license | AI use | date | notes |
|---|---|---|---|---|---|

## Planned slots (not built)

Slots added to DESIGN.md on 2026-11-12 with no asset yet. Nothing here is in the build. When an asset fills a slot, it moves to the table above with its real source, license and AI use, and passes the intake checklist.

| slot | added because | source | license | AI use | date |
|---|---|---|---|---|---|
| `field.goalPost` | Target for field goal and extra point arcs | not built | to log at intake | to log at intake | 2026-11-12 |
| `card.panel` | Player card background and header | not built | to log at intake | to log at intake | 2026-11-12 |
| `card.ratingBar` | Rating bars on the player card | not built | to log at intake | to log at intake | 2026-11-12 |
| `fx.standout` | Marks a standout play | not built | to log at intake | to log at intake | 2026-11-12 |
| `fx.challenge` | Marks the spot in doubt on a challenge | not built | to log at intake | to log at intake | 2026-11-12 |
| `hud.challenges` | Challenge pips in the top bar | not built | to log at intake | to log at intake | 2026-11-12 |
| `hud.clockState` | "running" or "stopped" beside the clock | not built | to log at intake | to log at intake | 2026-11-12 |
| `hud.tempo` | Tempo when not Normal | not built | to log at intake | to log at intake | 2026-11-12 |
| `hud.playMenu.disabled` | Off menu rows with their reason | not built | to log at intake | to log at intake | 2026-11-12 |
| `hud.resultLine` | What happened on the play | not built | to log at intake | to log at intake | 2026-11-12 |
| `hud.callsLine` | Both calls, after the snap | not built | to log at intake | to log at intake | 2026-11-12 |
| `mark.number` | Jersey number on each mark (Joseph, 2026-11-12) | not built | to log at intake | to log at intake | 2026-11-12 |
| `hud.teamSwatch` | Team color swatch beside team names (Joseph, 2026-11-12) | not built | to log at intake | to log at intake | 2026-11-12 |

Removed 2026-11-12: `hud.playClock` (no play clock in a turn-based game).

Planned for intake (proposed 2026-11-14, art-director):

| slot | proposed asset | source to fetch | license | AI use | date |
|---|---|---|---|---|---|
| `font.ui` | Atkinson Hyperlegible, 400 and 700, regular and italic, self-hosted woff2 | Braille Institute's release (brailleinstitute.org), or its Google Fonts copy; confirm the primary source at intake | SIL OFL 1.1, to verify from the shipped license file | to log at intake | 2026-11-14 |
| `font.mono` | IBM Plex Mono, 400, 500 and 600, self-hosted woff2 | IBM release (github.com/IBM/plex) | SIL OFL 1.1, to verify from the shipped license file | to log at intake | 2026-11-14 |
| `team.<id>.color` | one swatch color per team in the team data | designed in-repo | n/a until made | to log at intake | 2026-11-14 |

## Reviews

### 2026-11-14, art-director: first build of the play screen (branch m2/playable)

Reviewed from four screenshots at about 800x600 (after a kickoff, an incomplete intermediate pass, an outside run, the run in grayscale) plus packages/app/src/ui/field.ts, layout.ts, tokens.ts, styles.css and data/ui/templates.json. The screenshots look scaled down by about 0.77 (the 48 px top bar measures about 37 px), so pixel sizes are estimates. No goal-line screenshot was available: the goal-line spacing check below is computed from the templates at 1024x600 (9.26 px per yard, 14 px marks) and 1280x720 (11.5 px per yard, 16 px marks).

Intake status: every slot the build draws is REJECT at intake until it has a row in the table at the top (source file, license, AI use, date). That is paperwork, not drawing. The verdicts below are on the drawing.

| slot | verdict | note (DESIGN.md rule) |
|---|---|---|
| `field.surface`, `field.endzone.*`, `field.yardLine`, `field.yardNumber`, `field.hash`, `field.scrimmageLine`, `field.firstDownLine` | ACCEPT | Matches Field. Line of scrimmage and line to gain checked at OWN 27/37 and OWN 37/47, both on the right yard. Field sign-off still needs Joseph (Still open). |
| `field.goalPost` | not reviewed | Not in any screenshot. |
| `mark.offense`, `mark.defense` | REVISE | 1. Paths are drawn to the mark's center, so a line runs through every moved O and the O reads as a pin (Shapes: O is an empty circle; Do: keep O and X everywhere; grayscale check). End each path at the mark's edge. |
| `mark.number` | REVISE | 1. Numbers must show on every mark at the set and return at the whistle; only live play hides the unnamed ones (Spacing). The build shows only named players at the whistle, and none at all on the incomplete pass. 2. The carrier's number is drawn inside the ball-carrier ring; place it below the ring. 3. Add the whistle collision rule (Spacing). |
| `mark.ballCarrier` | ACCEPT | Reads in color and grayscale. |
| `ball`, `path.ball` | ACCEPT | |
| `path.offenseRoute` | REVISE | 1. The arrowhead is drawn at the mark's center, under the mark, so it never shows (Shapes: routes end in an arrowhead). Put the tip at the mark's edge. |
| `path.defenseRoute` | ACCEPT | Dashed pattern carries the side in grayscale. |
| `path.block` | REVISE | 1. Not built: linemen get routes with arrowheads instead of the perpendicular tick (Shapes). 2. On the run, OL move up 2 yd and DL down 3 yd, so every X ends behind the O he faced, which shows four beaten blocks on a 4-yard gain (Do not let animation show anything the engine did not decide). Linemen stop at contact. |
| templates `underCenter`, `heavy` | REVISE | QB at depth 1.5 sits 0.5 yd behind the center at depth 1: 4.6 px apart with 14 px marks, so they overlap at the snap (Spacing: marks never overlap at the snap). In `heavy` the QB is 10.4 px from each guard. Need about 2.2 yd of gap with the number moved right (mark + 6 px), so QB depth about 3.25. |
| templates `defense.goalLine` | REVISE | LBs at depth 3.5 are 2.5 yd (23 px at 1024x600, 29 px at 1280x720) behind DL at depth 1. Stacking needs mark + number + 6 px, about 32 to 34 px (Spacing). LB1 and LB3 also sit 1 yd off DL2 and DL4 and overlap their numbers. LBs to depth 4.5, S1 to 8. CBs and DL spacing (3 yd) pass. |
| `hud.scoreboard`, `hud.clock`, `hud.clockState`, `hud.timeouts`, `hud.possession` | ACCEPT | `hud.challenges` waits for challenges. |
| `hud.teamSwatch` | REVISE | Placeholder colors cycle by league index and gave a red and a green team in one game. Needs the team color approach below. |
| `hud.downDistance`, `hud.playMenu`, `hud.playMenu.selected`, `hud.playMenu.disabled` | ACCEPT | Largest text on screen, keys first, off rows give the reason in words. |
| `hud.resultLine` | REVISE | 1. "Pass incomplete." has no names (HUD: what happened, with names). The play's participants seem to be missing passer and target. 2. "kickoff, a return, returned by" is machine wording (Do: plain words). |
| `hud.whyLine` | REVISE | 1. "(x1.17)" is a multiplier in the headline (Do: plain words; the spec moves multipliers to the details view). 2. "D: details" wraps across two lines; keep it on one. |
| `hud.callsLine` | ACCEPT | Build order is result, calls, why; DESIGN.md Layout lists result, why, calls. Follow DESIGN.md. |
| `fx.turnover` / field labels ("Incomplete") | ACCEPT | |

Team color approach (proposed, needs Joseph): each fictional team gets one designed color in the team data (a schema change, so ask first). Rules: flat; relative luminance between about 0.17 and 0.26, so the swatch is 3:1 or better on both `color.panel` and `color.paper` even without its outline; never the blue or orange-brown hue family of `color.offense` and `color.defense`, so a swatch never reads as a side; checked by the same unit test as the palette. Swatches stay squares (pips and marks are circles).

Also open from this review: DESIGN.md says the M2 build adds a unit test that recomputes the colorblind table. It isn't in packages/ yet. It blocks field sign-off, not the first playtest.
