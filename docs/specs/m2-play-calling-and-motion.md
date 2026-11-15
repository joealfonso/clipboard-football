# M2 revision: visual play calling, pre-snap, and live motion

Status: draft, revision 1, 2026-11-14. Owner: Joseph. Author: designer. Branch: m2/playable.

Amends docs/specs/m2-playable-game-design.md (called "the M2 design" below) where they conflict. Every conflict is listed in "Amendments". Where this file says nothing, the M2 design stands.

Final means decided here, change only with a reason. Open means waiting on Joseph, the lead, art-director or playtest. Every number in "Motion" is a designed starting value that lives in data and is tuned in playtest. None is fitted.

## Problem

Joseph played the M2 build and said: "it seems like a simulation. the x's and o's move awkwardly, like it's not live. also show formation and have play selection like madden".

Three problems, in the order they cost the game:

1. **The play doesn't read as football happening.** Every mark moves on straight segments at constant speed. All 22 start on the same frame and stop on the same frame. Defenders run their drops whether or not anyone has the ball. The ball slides along the ground. The current motion is a diagram that slides. Nothing reacts, so nothing feels caused. That is what "like a simulation" means here, and it hurts the core loop, because the player is supposed to connect a call to what happened.
2. **The call is words, not football.** Formation and play are text rows. The player picks "Shotgun" without seeing it and never sees his formation on the field until the snap. A coach thinks in pictures, and the game is called Clipboard Football.
3. **A leak I found while reading the code.** At the set, the faint route preview is drawn only for marks that are not engine facts (field.ts skips `m.fact` in the preview). The engine's target has a fact-driven path, so his preview route is missing. A sharp player can see who gets the ball before the snap. The fix is in decision 9 and criterion P3.

## User

There are no personas in docs/research/personas/ (the folder doesn't exist). I'm working from the same assumption as the M2 design: Joseph and players like him. They know football, they play on a landscape laptop with a keyboard first, and they have played modern console football, so they expect to pick formation and play from pictures and to see the play line up.

Assumption that carries decisions: **"live" means cause and effect you can see (reaction, pursuit, contact, a thrown ball), not realism of bodies.** It drives the motion design. It rules out rendered players, which DESIGN.md bans anyway. Test: in the next playtest, Joseph watches 20 plays at 1x and says whether it still reads like a simulation. If he does, ask him which moment, and log the answer in the playtest log.

Assumption that carries decisions: **speed of calling still matters more than a confirm step** (M2 design decision 7). Visual cards must not add keystrokes. Test: same as the M2 design (misfires, Esc back-outs).

## Decisions

1. **Cards are a rendering of the same menu rows, not a new menu.** The engine's DecisionRequest screens, the option order, the keys and `menu.ts` are unchanged. Four screen types draw their rows as cards with play art: Formation, Run or Pass play, Defense package, Defense play. Why: no engine change, no change to keystroke counts (C1), the 7-choice count and the off-row rules carry over as they are, and existing menu tests keep testing the logic. Rejected: a new card-first menu tree, which would need new request screens from the engine. Final.

2. **Order stays Run or Pass, then Formation, then play.** Why: the engine's request already asks it that way (`offense.playType` opens `offense.formation.run` or `.pass`), it fits 7 choices on every screen, and it keeps a run or pass at 3 keys. Rejected: formation first, then every play for it on one screen, the way console games do it. That is 3 runs plus 5 passes plus Back, 9 choices, so it needs two pages or a Run and Pass split anyway, plus new engine screens. It is a question for Joseph only if he wants the formation-first feel badly enough to pay a page step (Open decisions, item 3). Final unless he says otherwise.

3. **A card is the play art of a class in a formation, drawn from designed templates.** The engine resolves by formation and class. So "Shotgun, Short pass" is one card whose art is the Shotgun alignment plus the short-pass route template. Card labels are our call names from the catalog ("Short pass", "Nickel Cover 1"). Why: that is exactly the call the engine resolves, so the card promises nothing it can't keep. Rejected: named plays ("Slant Flat", "HB Dive") as cosmetic variants of one class. They would suggest choices that change nothing, which is dishonest in a game about decisions. Final.

4. **Card art never shows the ball, a target, a hole or a result.** No ball, no ball path, no highlighted receiver, no yardage. Pass cards show every eligible receiver's route and a shaded depth band for the class (short 0 to 9 yd past the line, intermediate 10 to 19, deep 20 and more, screen behind the line, play action like intermediate). That band is the class definition from MENUS.md, not a prediction. Outside-run art forks to both edges, because the engine picks the side. Why: the engine decides target, side and outcome. The card is the call, not the result. Final.

5. **Card art and the field are the same drawing.** One pure geometry function makes the art for a (formation, class) or a defense preset. The card draws it small. The field preview draws it on your lineup. The live play runs it for every player the engine doesn't name. Why: what you picked is what you see on the field, which is how a player learns the matchup table. Rejected: separate card art, which drifts. Final.

6. **Your formation lines up on the field as soon as you start your next call, and stays lined up through the snap.** Focus or hover a formation card and your 11 line up on the ball. Focus or hover a play card and its art is drawn faint (40%) on that lineup. After the last key, the lineup stays. Why: Joseph asked for it, and it is the clipboard: a play drawn on your own players. Final.

7. **The opponent stays in a huddle until the snap (my recommendation; Open decision 1).** Before your last key, the other side's 11 marks sit in a huddle ring off the ball, with no numbers. After your last key, they break the huddle and move to their real alignment (450 ms), then everyone is set (300 ms), then the snap. Why: it shows nothing about their call, so E6 holds by construction and gameplay is unchanged. It is also true to football: before you call, they haven't lined up. Breaking the huddle gives the pre-snap moment real motion. Rejected: a neutral base look (a fixed 4-3 two-high or a fixed offense set). It looks like a real alignment, so players would read it as their call and be misled every down. Rejected for M2 without Joseph: their real alignment before you call (Open decision 1), because it changes gameplay.

8. **Motion is built in the timeline as dense keys, not eased in the animator.** `timeline()` stays pure and outputs keys every 25 ms that already carry acceleration, curves, reaction and settle. `at()` stays linear between them, and the animator stays dumb. Why: every frame that is drawn is a frame the tests can check. Ball at the engine's spot, no diagram mark touching the ball, the tackler at the tackle: all of it is checked on the same data that is drawn. Rejected: a tweening layer in the animator. It is easier, but what's drawn would no longer be what's tested, and A2 and A3 would turn into claims about data rather than about the screen. Final.

9. **The set-phase preview is drawn from the calls, never from the result.** The faint art at the set comes from the play-art function for your call, for every player, fact or not. Why: it fixes the target leak (Problem 3). Final.

10. **Fact anchors are fixed. Motion only shapes what lies between them.** Anchors: snap, handoff, throw, catch, interception, fumble spot, sack, kick, landing, end spot at the whistle, tackler at the ball. They keep the time and place the engine's facts give them. Curves, easing, reaction and pursuit change only the path and speed between anchors. Why: this is how "live" and "the engine decides" coexist. Final.

11. **Screen length comes from geometry, not from `play.seconds`.** Live time is the sum of the phase budgets below, built from distances and speeds, clamped to 1.5 to 4.0 s at 1x. Why: mapping the engine's clock seconds into 2 to 4 s made a 2-yard run last as long as a 30-yard gain, which reads as slow motion. Speed has to look the same on every play to look live. The clock seconds still show on the game clock, where they belong. Rejected: keeping the `play.seconds` mapping. Final, with the values open to playtest.

12. **Player ratings don't change how fast a mark moves in M2.** Speeds are by position group. Why: a fast receiver drawn visibly faster who is then caught from behind (because the engine says so) implies a result the engine didn't explain. Ratings show on the card and in the why line. Rejected for now: rating-scaled speed, which is worth trying once the why line can name the reason. Final for M2.

13. **Pursuit is drawn as motion, not as a path.** After the whistle, a defender's dashed path shows his drop or rush up to the read moment (the handoff or the throw), not his pursuit. Named players (tackler, interceptor, sacker, recoverer) keep their whole path. Why: the drop is the call, which is what the player learns from. Eleven pursuit squiggles would bury the routes. Final.

## Play calling with cards

### Which screens use cards

| Screen (engine id) | Cards (count) | Other rows | Total choices |
|---|---|---|---|
| Offense: Formation (`offense.formation.run`, `.pass`) | Shotgun, Under center, Pistol, Empty, Heavy (5) | Esc Back | 6 |
| Offense: Run (`offense.run`) | Inside run, Outside run, QB sneak (3) | Esc Back | 4 |
| Offense: Pass (`offense.pass`) | Short pass, Intermediate pass, Deep pass, Screen, Play action (5) | Esc Back | 6 |
| Defense: Package (`defense.package`, a first screen) | Base, Nickel, Dime, Specials (4) | 5 Same call, T Timeout, Esc Menu | 7 |
| Defense: Base, Nickel, Dime, Specials | 3, 6, 2, 2 cards | Esc Back | 4, 7, 3, 3 |

Every other screen keeps text rows: Play type, Kick, Clock, Try, Kickoff, penalty, review and the rest. Why: their choices have no alignment worth a picture, or a picture would add nothing to the words. Kick and Kickoff rows still trigger the field preview of their unit on focus (see "Pre-snap").

No screen needs pages. Nickel is the largest at 6 cards plus Back, which makes 7. If a future catalog change pushes a card screen past 7, the screen splits into steps, each with its own Back. A "More" card would count as a choice, so it is not allowed as a way around the cap.

### Card anatomy (`card.formation`, `card.play`, `card.package`, `card.coverage`)

Top to bottom, which is also the reading order:

1. **Key and label**, one line: the key in `font.mono` ("1"), then the catalog label in `font.ui` 16 px `color.ink` ("Short pass"). Read first, because the key is how you pick it and the label is what the engine resolves.
2. **Art**, 4:3 portrait-to-field orientation (up is upfield, as on the field). Line of scrimmage as a 1 px `color.ink` line. Marks at 8 px, 1.5 px stroke, O in `color.offense`, X in `color.defense`, with no numbers. Card marks are a thumbnail slot, not the field's 14 px marks.
3. **Personnel line** on formation and package cards only, `font.ui` 16 px `color.inkSoft`: "1 RB, 3 WR, 1 TE" or "4 DL, 2 LB, 5 DB", from personnel.json. Why: personnel is the one fact a coach reads off a formation, and the engine uses it.

What the art draws:

- **Formation card:** the formation's alignment only.
- **Offense play card:** the alignment plus the class template.
  - Routes: solid `color.offense` with arrowheads and rounded breaks, the same shape as on the field.
  - Blocks: OL short strokes ending in the `path.block` tick.
  - Run path: solid from the backfield spot through the class's gap zone. Inside run goes between the guards. Outside run forks to both edges. QB sneak goes straight behind the center.
  - Play action: a short fake arrow from the QB toward the back, then the drop.
  - Pass classes: the depth band (decision 4), a `color.paperShade` band across the art with no border.
- **Package card:** the package's base alignment. Specials shows Goal line on the left half and Prevent on the right, each labelled underneath in 16 px text ("Goal line", "Prevent").
- **Coverage card:** the preset's alignment.
  - Rush arrows: dashed `color.defense` lines toward the backfield.
  - Zones: `art.zone` shapes, a `color.paperShade` fill with a 1.5 px dashed `color.defense` outline, deep zones taller than under zones.
  - Man coverage: `art.manTether`, a short solid `color.defense` line from the defender to a small `color.offense` O at a generic receiver spot.

Card art is a visual aid. Every fact on it is also in the label, the personnel line or the catalog description (see Accessibility).

### Layout of cards in the panel

- The cards sit in the menu slot of the side column, where the rows are now. Above them stay the situation header, result, calls and why lines, so the play report block keeps its fixed height and the cards never move.
- Grid: 3 columns, in key order, left to right and then top to bottom. The Esc row, plus Same call and T on the package screen, sit under the grid as text rows, as today.
- Size at 1280x720: art about 160 by 120 px. At 1024x600, the art shrinks to fit the height left, with a floor of 120 by 72 px.
- **Compact fallback (a state):** below the floor, or at 150% text size and above when the grid would push the Esc row off screen, cards drop the art and render as today's text rows with the personnel line as the row note. The field preview still works. Why: the cards must never make the panel scroll on a call screen at 100%.
- At 200% text size the grid is 2 columns and the panel scrolls before it truncates (M2 design X2).

### Keyboard and mouse

| Input | Does |
|---|---|
| 1 to 7 | Picks that card or row, exactly as today. The last key snaps; no confirm (M2 design decision 7). |
| Arrows | Move focus across the grid in reading order. Left and right wrap across rows. Up and down move within a column, and Down from the bottom row goes to the rows under the grid. Focus drives the field preview. |
| Enter | Picks the focused card. |
| Esc, Backspace | Back one screen, or the pause menu on a first screen, as today. |
| Tab | Moves through cards in key order, then the rows. |
| Mouse hover | Focus and preview the card. Leaving the grid returns the preview to the committed state (decision 6, "Pre-snap"). |
| Mouse click | Picks the card. |

Default focus when a card screen opens: card 1 on a second or third screen, which starts the preview at once. On the defense package screen, which is a first screen, the focus outline sits on card 1 but the preview waits for the first input (see "Pre-snap", state 1).

Focus style: 2 px `color.ink` outline around the whole card, plus a `color.paperShade` fill on the label line only, never on the art. Why: zones use paperShade, so a full-card fill would wipe them out.

## Pre-snap

### Field states in a dead ball, in order

| # | State | Your side | Their side | Ends when |
|---|---|---|---|---|
| 1 | **Last play** | The last play's whistle frame with paths and numbers | Same | Your first input of the new call: an arrow key, a hover, or a key that opens a deeper screen. Esc back to the first screen returns to this state. |
| 2 | **Calling** | Lined up in the focused or picked formation, with numbers. The focused play card's art at 40%. Moving focus between cards glides marks to the new spots over 150 ms (cut under reduced motion). | Huddle ring, no numbers (decision 7) | Your last key |
| 3 | **Line-up** | Holds the lineup, with the art at 40% | Breaks the huddle to their real alignment, 450 ms. The run-off clock counts down at the same time (at most 600 ms, M2 design). Phase length is the longer of the two. | Phase time |
| 4 | **Set** | Still, art at 40% | Still, now with numbers. Their art is not drawn: it adds clutter, and the calls line shows their call after the snap. | 300 ms |
| 5 | **Snap**, then the live play, the settle and the hold | See "Motion" | | |

Details:

- **Huddle ring** (`field.huddle`):
  - Offense huddle: centred 7 yd behind the line. Defense huddle: 6 yd past it.
  - Radius: the smallest radius that keeps 14 px marks at least 4 px apart, so about 3 yd at 1280x720 and 3.5 yd at 1024x600.
  - Clamped inside the end lines. Never overlaps your lineup, because the two are on opposite sides of the line.
  - Positions come from a fixed template and the layout only, never from the opponent's call. Criterion P1 tests this.
- **Same call** snaps with no Calling state. In that case your side also starts in a huddle and breaks it in the Line-up phase alongside theirs. `timeline` takes an input flag, `ownStart: "lined" | "huddle"`, so it stays pure.
- **Public line-ups skip the huddle.** On kickoffs, AI punts, field goals, kneels and spikes (`continue` with `theyLineUp`), both units are lined up from state 2 on, because the request already makes the unit public. Your Kick and Kickoff rows preview your unit on focus.
- **Your lineup's players.** The numbers in state 2 need the players the engine will put on the field for that formation or package. See "Needs from the engine and loop". Until that exists, the marks show without numbers in state 2, and the numbers appear at the Set.
- **Crossfade.** A possession flip is a crossfade at the start of the dead ball (M2 design A5), before state 1. Nothing about it changes.

### Why the opponent's real look waits for the snap

The AI never sees your call (m2 engine spec, item 7). If you saw its alignment before calling, you would have information it doesn't have, and in real football that information comes with audibles, which M2 doesn't have. So showing it changes the game, and that call belongs to Joseph (Open decision 1).

## Motion

### Contract

1. Anchors from facts are fixed in time and place (decision 10). The ball is at `end.spot` at the whistle. The engine's holder has the ball. The engine's tackler is at the ball. Only named players touch the ball.
2. Every other mark's motion is diagram plus reaction. It is drawn from the calls and from the ball's anchored path, never from the outcome's cause.
3. **Diagram defenders keep 2.5 yd from the ball at all times** (`clearOfBallYards`, now a hard rule rather than a soft push). They also stay out of a 2 yd half-width corridor along the carrier's next 1.0 s of path. Why: a defender standing in a lane the carrier then runs through implies a missed tackle the engine didn't decide.
4. No randomness. Stagger and variety come from tables and from a fixed per-slot offset (slot index mod 3 times 15 ms).

### Elements

**Acceleration and deceleration.**
- Every mark starts from rest and ends at rest, with no instant starts or stops. A linear ramp over `accelMs` brings it to top speed, and a ramp over `decelMs` brings it to a stop.
- Speeds are in yards per second of screen time at 1x, about 1.5 times real speed, so plays fit the budget:

  | Group | Top speed | Accel |
  |---|---|---|
  | WR, RB, CB, S | 15 | 300 ms |
  | TE, LB | 13 | 300 ms |
  | QB | 11 | 250 ms |
  | OL, DL | 6 | 150 ms |
  | K, P | 10 | 250 ms |

- Decel to stop: 250 ms.
- When an anchor needs more speed than the top speed, the speed rises with no cap. When it needs less, the mark jogs at a lower cruise speed and never parks and waits, except a sacked QB and blockers.

**The snap and staggered starts.**
- The ball moves from the center to the QB: 80 ms under center, 140 ms pistol, 160 ms shotgun, 200 ms field goal or extra point, 300 ms punt.
- Starts, in ms after the snap, plus the per-slot offset:

  | OL | QB | TE | WR | RB | DL | CB | LB | S | K, P |
  |---|---|---|---|---|---|---|---|---|---|
  | 0 | 0 | 20 | 30 | 60 | 60 | 120 | 140 | 200 | by kick |

- Why the order: the offense knows the count and the defense reacts, and the order is what makes a snap read as a snap.

**Curved route stems and breaks.**
- Routes are the template waypoints joined with circular fillets.
- A round break (60 degrees or less) gets a 2.0 yd radius and drops to 85% speed.
- A sharp break (over 60 degrees) gets a 0.6 yd radius and drops to 55% speed before re-accelerating.
- Stems have a slight release: the first 1 yd bends 0.3 yd away from the nearest defender's alignment, a fixed offset from the template.
- The **target's** route follows his template until its last break, then bends to the catch point and arrives exactly at catch time.

**Defenders reacting and pursuing.**
- Before the read, defenders run their preset's drop: zone defenders go to their zone landmark (the center of their `art.zone`), man defenders mirror their generic receiver spot, and rushers rush.
- The **read** is the handoff, the throw or the QB crossing the line on a scramble, plus a reaction delay: 150 ms for LB, 200 ms for DB, 250 ms for DL.
- After the read, each diagram defender steers toward the point where the ball will be 400 ms ahead. It turns at most 180 degrees per second and slows as it nears the 2.5 yd ring (contract 3).
- DL stay engaged until the carrier is 3 yd past the line, or 400 ms after the throw. Then they disengage upfield and pursue at lineman speed. They never pass below the OL they faced (existing block rule).

**Ball flight arc and a timed throw.**
- The throw is released when the QB's drop ends, plus an 80 ms hitch. Drop times from the snap:

  | Short | Intermediate | Deep | Screen | Play action |
  |---|---|---|---|---|
  | 450 | 700 | 900 | 800 | 950, with the fake at 350 |

- Flight time is 220 ms plus 14 ms per yard, clamped between 300 and 1000 ms. Ground speed is constant along a straight ground track, which is true from above.
- Height shows as ball size only: scale 1 at release, rising on a parabola to the apex scale at mid-flight, and back to 1 at the catch. Apex scale is 1 + air yards / 50, capped at 1.6.
- No shadow. DESIGN.md bans shadows, and size alone reads.
- Incomplete: the ball reaches the target point, then over 300 ms slides 1.5 yd and shrinks to 0.8 scale. At the whistle it jumps to the respot, as today.

**The carrier's cuts.**
- From the mesh point to the line: through the gap the engine gives (`runLocation`), or the middle when it isn't given.
- If the end spot's x is more than 2 yd from his line, he cuts 1.5 to 3 yd past the line. He slows to 70% over 120 ms, turns on a 1.5 yd radius, and re-accelerates over 200 ms.
- An outside run first stretches sideways, then turns upfield on a 2 yd radius.
- At most two cuts per carry, and the last one points at the end spot.
- A carrier stopped behind the line doesn't cut.

**Blocks engaging and holding.**
- OL step 0.3 yd and DL step -0.3 yd, and they meet by 200 ms after the snap.
- On runs, engaged pairs drift together up to 0.6 yd toward the run side over the play.
- On passes, the OL set back 1.5 yd over 600 ms with the DL pressed against them.
- Nobody is drawn winning a block (existing rule).

**Tackles converging.**
- In the last 300 ms, the carrier decelerates and the engine's tackler arrives on a pursuit curve. They meet at the ball at the whistle, both at rest.
- Up to 2 more diagram defenders, the nearest ones, close to the 2.5 yd ring. Never closer.
- On a touchdown the carrier decelerates to rest at `end.spot`. Out of bounds, he runs to the sideline spot and stops on it.

**Sacks.**
- The sacker's rush curves around the OL marks, never through them, and reaches the QB at the drop end plus 600 ms. The QB may step up 0.5 yd in that window.
- Fumbles: the ball pops 1 to 2 yd at 0.8 scale (it is low) and the recoverer arrives, as the timeline does now.

**Kicks.**
- Punt: the snap takes 300 ms, the kick comes 450 ms later, and hang time is 900 ms plus 8 ms per gross yard, capped at 1500. Apex scale 1.8.
- Kickoff: a 400 ms approach, then hang time of 1000 ms plus 6 ms per yard, capped at 1500. Apex scale 2.0. Onside: 600 ms, two low bounces at scale 1.15.
- Field goal or extra point: the hold at 200 ms, the kick at 450 ms, then flight of 600 ms plus 6 ms per yard, capped at 1100. Scale rises to 1.5 and ends at 1.25 at the posts, so it reads as high over the bar.
- Returns use the carrier rules.

**The settle at the whistle.**
- The settle is the first 300 ms after the whistle. The ball, the holder and the tackler don't move.
- Every other mark eases to rest within 1.5 yd of where it was at the whistle. Defenders drift toward the ball but stop at the 2.5 yd ring.
- The settle runs inside the hold. When a play has no hold, it adds 300 ms.

**No play (pre-snap foul).** Nobody moves. The flag drops at the snap time and the fouler is ringed, as today. Rejected: animating a false start, because the engine records the foul, not the motion.

**Camera.** It starts still and follows the ball after the snap with a critically damped follow (time constant 250 ms). It moves only when the ball comes within 5 yd of an edge (unchanged). It cuts under reduced motion.

### Timing budgets at 1x

Pre-snap phases are not counted in live time.

| Phase | Budget |
|---|---|
| Calling preview glide | 150 ms, not scaled by speed (it answers a key) |
| Line-up: huddle break, with the run-off clock running at the same time | max(450, run-off up to 600) ms |
| Set | 300 ms |
| Live | sum of the phases below, clamped to 1500 to 4000 ms |
| Settle | 300 ms, inside the hold |
| Hold | 400 ms for a catch, tackle or turnover; 800 ms for a score or standout (unchanged) |

Live phase sums, worked examples for the engineer's sanity check:

| Play | Phases | Live |
|---|---|---|
| Inside run, under center, +4 | snap 80, handoff 380, carry 8 yd about 650, converge 300 | about 1400, floored to 1500 |
| Short pass, shotgun, 6 air + 4 after the catch | throw 530, flight 330, run after the catch 350, converge 300 | about 1510 |
| Deep pass, 32 air + 5 after the catch | throw 980, flight 720, run after the catch 400, converge 300 | about 2400 |
| Sack | drop 700, plus 600, contact 300 | about 1760 |
| Punt, 45 gross, 8-yard return | 300 + 450 + 1260 + 600 + 300 | about 2900 |
| 60-yard touchdown run | over 4000 | compressed to 4000 |

Rules:

- **Under the floor:** scale every live phase up uniformly to 1500.
- **Over the cap:** compress every live phase uniformly, so everyone moves faster and anchors keep their order.
- **Fixed lengths:** kneel 900 ms and spike 700 ms are exempt from the clamp, and no-play has no live phase.

Why the floor drops from 2.0 to 1.5 s: with real acceleration a short run reads at 1.5 s, and stretching it to 2.0 s looks like slow motion, which is the complaint.

### 2x

Every timed phase is halved: line-up, run-off, set, live, settle and hold. Curves and easing shapes are identical, because 2x is the same timeline played at double rate (the animator already does this). The preview glide is not halved. S still cycles 1x, 2x, skip during the play.

### Reduced motion (and skip)

Nothing tweens anywhere:

- The preview lineup and focus changes cut.
- The huddle is shown in states 1 to 2, and their alignment appears at the Set with no break motion.
- The play jumps to the final frame, which is the post-settle positions, with paths drawn and the ball at scale 1.
- The camera cuts. There are no holds (M2 design, unchanged).

The field still reads: the paths show what happened and the panel text says it. Skip shows the same final frame.

### Data and modules (for the engineer; no code here)

- **`data/ui/motion.json`** (new, zod-validated, designed): every number in this section.
- **`data/ui/templates.json`** gains:
  - `huddle`: offense and defense ring centres.
  - `presetAlignment`: per-preset overrides of the package alignment. Cover 2 is two-high at 12 yd, Cover 3 and Cover 1 are single-high with a rotated safety, Cover 0 has no deep safety, and Cover 4 is two-high deeper.
  - `zones`: per preset, rectangles in yards marked deep or under.
  - `manTargets`: generic receiver spots.
  - `playArt.overrides`: per formation and class, for example runs from Empty start from the QB.
  - `depthBands`.
  - Drops for zone presets go to their zone centres.
- **A pure `playArt(...)`** returns primitives (marks, paths, zones, bands) for a call. Both the card renderer (inline SVG recommended: crisp at any device pixel ratio, scales with text size, aria-hidden) and the field preview draw from it.
- **A pure motion builder** turns waypoints plus anchors into 25 ms keys (fillets, speed profile, reaction, pursuit with the clearance ring and corridor). `timeline()` calls it. `at()` doesn't change.
- **Performance:** `timeline()` on Joseph's machine must stay inside the 100 ms snap budget (M2 design C1). Target 20 ms, recorded in PERF.md.

## Needs from the engine and loop

1. **Your lineups before the snap** (additive, own side only). `offenseCall`, `try` and `defenseCall` requests carry the human team's on-field slots for each formation or package on offer (`lineups: Record<id, OnFieldSlot[]>`). The players must be the ones `onField()` will choose at the snap. Nothing about the opponent goes in. This is a change to a shared type, so it is ask-first (Open decision 4).
   - Fallback if it's declined: the UI shows state-2 marks without numbers, and nothing duplicates the engine's slot filling.
2. Nothing else. No change to `resolvePlay`, the caller, the catalog or the PlayResult.

## States

| State | What shows |
|---|---|
| First call of the game (no last play) | State 1 is an empty field with the ball on the spot, and both huddles. |
| Calling, nothing focused yet (defense first screen) | The last play's whistle frame. |
| Calling, card focused | Your lineup plus faint art; their huddle. |
| Calling, formation picked, focus on the Back row | The picked formation, no art. |
| Mouse leaves the grid | Back to the committed state: the picked formation, or the last play if nothing is picked yet. |
| Esc back to a first screen | The last play's whistle frame again. |
| Same call | No Calling state. Both sides break the huddle in Line-up. |
| Public line-up (kickoff, their punt, field goal, kneel, spike) | Both units lined up, no huddle. |
| Lineups missing from the request | Your marks without numbers until the Set. Nothing in the status line, because it isn't an error the player can act on. |
| Card art missing for a (formation, class) pair | The card shows its label and "No diagram for this call", still pickable. The field preview shows the formation only. A test makes this unreachable in shipped data (K2). |
| Compact fallback (small height or large text) | Text rows with personnel notes; the field preview unchanged. |
| Window resized during a preview or a play | Redraw at the same t. Cards reflow. |
| Templates or motion data fail validation | The existing "Game data failed its check: [file]" state, naming the file. |
| Sim error during Line-up | The existing sim error state. Line-up is aborted and nothing is drawn as if snapped. |
| Reduced motion, 2x, skip | As in "Motion". |
| Loading | No new state. Card art is drawn synchronously from data that loads at startup. |
| Permission denied | Not applicable: this feature needs no permission. Storage states are unchanged. |
| Feature-specific | Goal-to-go near the end zone: the defense huddle clamps inside the end line. Their offense at its own 1: the huddle sits in the end zone, above the end line. Two-point try: lined up at the try spot. A turnover play: the settle and the hold as usual, then the possession crossfade at the next dead ball. |

## Accessibility

- **Cards are real buttons** in the labelled menu group.
  - Accessible name: "1, Short pass". For formation and package cards, the personnel follows: "1, Shotgun, 1 RB, 3 WR, 1 TE".
  - Accessible description: the catalog description, which is also shown in the status line for the focused card.
  - The art is aria-hidden, because every fact it carries is in that text.
- **The field preview adds no fact.** It shows your own call and their huddle. The live region doesn't announce the preview, to avoid chatter on every arrow key.
- **Focus:** a 2 px `color.ink` outline, never fill alone. Arrow and Tab orders are as specified. Every card is far larger than 44 by 44 px.
- **Contrast:**
  - Card art: offense 6.5:1 and defense 5.4:1 on paper; defense on paperShade (zones) 4.6:1. All of these pass the 3:1 mark rule.
  - Depth bands and zone fills are not the only cue: zones also have a dashed outline, and bands are named by the card label.
  - Grayscale check on every card type (art-director, X1).
- **Shape before color:** O and X on cards as on the field. Zones are dashed and routes solid.
- **Motion:** reduced motion as specified, following `prefers-reduced-motion` with the in-game override. Nothing flashes. The ball's size change is a slow change, not a flash.
- **Text size:** card labels and personnel lines scale. Compact fallback and the 2-column grid behave as specified.

## Model output: uncertainty, wrong results, correction

- **Cards are intent, not prediction.** No card shows odds, a target, a hole or a result. Pre-snap odds stay out of M2 (M2 design decision 14).
- **When motion and the result disagree, the result wins.** The panel text comes from the engine. If the field ever implies something different (a defender seeming to make a tackle the engine gave to someone else, a ball path toward the wrong receiver), that is a bug, not ambiguity. "Copy details" adds the timeline version hash next to the seed and play number, so the exact play can be replayed and fixed.
- **No answer from the engine:** when a fact is missing (no side, no catch point, no tackler), motion is neutral, as the M2 design says. A carrier with no named tackler decelerates alone. Nobody arrives to "make" the tackle.

## Amendments to the M2 design (docs/specs/m2-playable-game-design.md)

| Where | Was | Now |
|---|---|---|
| Decision 6 | Open: formation before play | Stays, after Run or Pass (decision 2 here). Final unless Joseph changes it. |
| Layout, panel item 4 | "The menu (rows prefixed with their key)" | Rows, or a card grid on the four screen types in "Which screens use cards". Same keys and order. |
| "What counts as a choice" | Rows | A card counts exactly like the row it replaces. |
| Timeline at 1x, 2. Set | Routes faint for under 1 s | Calling preview (state 2), Line-up 450 to 600 ms with the run-off, Set 300 ms. The set art comes from the calls (decision 9). |
| Timeline at 1x, 1. Run-off | The field is still for up to 0.6 s | Runs during the huddle break. |
| Timeline at 1x, 3. Live | `play.seconds` scaled into 2 to 4 s; straight segments, easing at start and stop only | Geometry phase budgets clamped to 1.5 to 4.0 s; curves, acceleration, reaction, pursuit, arcs, cuts, blocks, convergence (decisions 8, 10, 11). |
| Timeline at 1x, 4. Holds | Holds only | The 300 ms settle runs inside the hold. |
| Rule for what may be drawn | Facts and diagram | Adds reaction (pursuit, convergence, settle) as diagram, bound by the 2.5 yd ring and the carrier corridor (Motion, contract 3). |
| Reduced motion (Accessibility) | Final frame, no pans, no holds | Also: preview and huddle break cut, and the final frame shows post-settle positions. |
| A4 | Snap to whistle 2 to 4 s | 1.5 to 4 s for scrimmage plays and kicks; kneel 900 ms and spike 700 ms fixed. |
| DESIGN.md Motion, for art-director | "Pre-snap: routes faint under a second"; "straight segments with easing only at start and stop"; "paths stay drawn until the next snap" | Pre-snap states 1 to 4; motion as in this file; paths stay until the Calling state starts. Defender paths drawn only to the read, except named players (decision 13). |
| DESIGN.md Shapes, path lines, for art-director | Implicitly straight | Routes have rounded breaks (fillets); the ball's size grows with height in flight. |

## Art slots for art-director (to log in docs/ASSETS.md, "Planned slots")

New:

| slot | added because |
|---|---|
| `card.formation` | Formation diagram card: alignment, line of scrimmage, personnel line |
| `card.play` | Offense play-art card: routes, run paths, blocks, depth band; no ball |
| `card.package` | Defense package card: base alignment and personnel line; split art for Specials |
| `card.coverage` | Defense play card: alignment, zones, rush arrows, man tethers |
| `card.focus` | Focused or hovered card: 2 px ink outline plus a shaded label line only |
| `card.mark` | 8 px card-thumbnail O and X, 1.5 px stroke, no numbers |
| `art.zone` | Zone shape on coverage cards (paperShade fill, dashed defense outline) |
| `art.depthBand` | Throw depth band on pass cards |
| `art.manTether` | Man-coverage line from a defender to a generic receiver O |
| `field.huddle` | Opponent huddle ring before the snap, no numbers |
| `path.preview` | Your play art at 40% on your lineup (states 2 to 4) |

Revise:

| slot | change |
|---|---|
| `ball` | Scale with height in flight (apex values in Motion); scale 1 at rest |
| `path.offenseRoute` | Rounded breaks; dense polyline from keys; arrowhead at the mark's edge, as now |
| `path.defenseRoute` | Drawn only to the read, except named players |
| `hud.playMenu`, `hud.playMenu.selected` | Card grid on four screen types; text rows elsewhere and in compact fallback |

Checks for art-director at review:
- every card type in grayscale and the three simulations;
- the huddle at 1024x600 with no mark overlap;
- the depth band against zones on the same card style (both use paperShade, so they must stay on different card types).

## Existing tests that change

None is weakened. Each change follows a rule that moved.

| Test | Change | Why |
|---|---|---|
| timeline.test.ts, `checkPlay` A4 | The bounds read the new `liveMinMs` 1500 and `liveMaxMs` 4000 from data. Kneel and spike are checked against their fixed lengths. | Decision 11 |
| timeline.test.ts, A3 "diagram marks touching the ball" | Threshold from 1 yd to the 2.5 yd ring, and the corridor check added | Contract 3 is stronger |
| timeline.test.ts, A1 purity | Unchanged. It now also covers the motion builder and `playArt` (no Rng, no DOM, no `Math.random`). | |
| art.test.ts, "the line is at least 19 px" | Samples at `tl.snapAt`, not `t = 0`, because the opponent starts in the huddle. | State 2 |
| art.test.ts, "OL use the block tick" (a regex on field.ts source) | Becomes a behaviour test on the drawn primitives: OL path ends are `block`, others `arrow`. | The source regex breaks on any refactor and tests text, not drawing. |
| art.test.ts, `numberShown` | Adds the `lineup` phase: opponent numbers hidden in the huddle, shown from the Set. | State 2 |
| art.test.ts, "paths end at the mark's edge" | Unchanged on dense keys. | |
| layout.test.ts, `parseTemplates` "malformed file" | Extended to the new template keys and to motion.json. | New data |
| layout.test.ts, "every preset has a drop" | Also: every zone preset has zones and every man preset has man targets. | New data |
| menu.test.ts | Unchanged: the menu state machine doesn't change (decision 1). | |
| messages.test.ts (F5) | Also asserts `lineups` holds only the human team's players. | Need 1 |

## Acceptance criteria

These add to the M2 design's criteria. A2, A3 and A4 are amended as above.

| # | Criterion | How it fails |
|---|---|---|
| K1 | The Formation, Run, Pass, Package and the four defense play screens render as cards with art. Keys, order, off-row behaviour and keystroke counts match today's rows (menu.test.ts passes unchanged). | Different keys or counts. |
| K2 | `playArt` returns art for every formation and class in the catalog and every defense preset. Shipped data never hits "No diagram". | A missing pair. |
| K3 | Card art primitives never include a ball, a ball path or a highlighted player. Pass cards' depth band matches the class definition in MENUS.md. Outside run forks to both edges. | A ball, a target, or a wrong band. |
| K4 | Arrows, Enter, Tab and mouse hover and click work as in the input table. Focus moves the field preview on the next frame. | Missing or late. |
| K5 | At 1024x600 and 1280x720 at 100% text, no call screen scrolls. At 150% or more, compact fallback or the 2-column grid applies, and nothing truncates. | Scroll at 100%, or truncation. |
| P1 | **No leak before the snap.** For one human call, building frames with every possible opponent call gives identical opponent positions for every t before Line-up starts. Their positions until then come only from the huddle template and the layout. | Any dependence on their call. |
| P2 | The Calling-state lineup positions equal the timeline's set positions for the same formation. When `lineups` is present, the player ids equal the engine's `onField` at the snap, over every call of 12 simulated games. | Mismatch. |
| P3 | **No result leak at the set.** Two events with the same calls and different results draw identical frames for every t before the snap. | Different preview. |
| M1 | Anchors: the ball is at `end.spot` at the whistle; the holder and the tackler are at the ball at the whistle; the ball leaves the QB at the throw time; the receiver or interceptor is within 0.5 yd of the ball at catch time. These hold over every play of 1,000 simulated games (extends A2). | Any miss. |
| M2 | Easing: every mark starts and ends at rest. Between consecutive 25 ms keys, the speed change stays within the group's top speed divided by its accel time (with 10% tolerance), except at the snap, the catch and contact, where the motion builder lists the events. | A jump. |
| M3 | Stagger: on every scrimmage play, mark start times follow the reaction table plus offsets, and there are at least 4 distinct start times. | All start together. |
| M4 | Breaks: at over 50% of top speed, no mark turns more than the turn rate between keys. Sharp breaks happen at 55% speed or less. | A hard corner at speed. |
| M5 | Pursuit: no diagram defender comes within 2.5 yd of the ball, or into the carrier corridor, at any time after the snap window. After the read, at least half of the diagram defenders end the play closer to the ball than they were at the read. | Touching, blocking a lane, or ignoring the ball. |
| M6 | Blocks: engaged OL-DL pairs stay within contact distance from 200 ms after the snap until release. No DL ends behind the OL he faced (existing test). | A beaten or floating block. |
| M7 | Settle: from the whistle to 300 ms after, the ball, holder and tackler don't move. Every other mark's speed falls monotonically to 0, and it moves at most 1.5 yd. | A move after the whistle. |
| M8 | Ball scale is 1 at rest, peaks at mid-flight no higher than the table, and changes only during flight, fumbles and kicks. | Scale outside flight. |
| M9 | Live time is 1.5 to 4.0 s at 1x (kneel and spike fixed). At 2x every phase is half, including line-up, set, settle and hold. Under skip and reduced motion, only the final post-settle frame shows, and preview glides and the huddle break cut (extends A4 and X4). | Out of range, or any tween under reduced motion. |
| M10 | Defender paths drawn after the whistle end at the read, except for named players. Their paths are complete. | Pursuit drawn, or a named path cut short. |
| M11 | `timeline()` takes 20 ms or less per play on Joseph's machine, with the median and p95 over 1,000 plays recorded in PERF.md. The snap still starts within 100 ms of the last key (C1). | Over budget. |
| G2 | Joseph plays at least 20 plays at 1x and 2x and says whether it still reads like a simulation. If it does, the moment is logged in the playtest log. | Not run. |

## Open decisions for Joseph

1. **Their pre-snap look.** My recommendation is (a): they stay in the huddle until after your call, then line up and snap.
   - Option (b): their real alignment shows before you call.
   - (b) changes gameplay. You would read their front and coverage, which the AI can't do to you, and the natural next step would be audibles (not in M2).
   - (b) also needs the AI to commit its call before yours and relaxes engine criterion E6.
2. **A snap step.** Today the last key snaps. A console-style "at the line, press Space to snap" step adds a key to every play.
   - It only earns that key if you pick 1(b), because there would be something new to read at the line. With (a) I recommend no snap step.
3. **Formation first.** Keep Run or Pass, then Formation, then play (recommended, same keys as today). The alternative is formation first, then a Runs page and a Passes page, which is the console order at the cost of one extra step on some calls.
4. **Ask-first approval: your lineups in the call request** (Need 1). This is a small additive change to a shared type, so your numbered players can line up before the snap. Without it, your marks show no numbers until the Set.

## Final and open

Final: decisions 1 to 13, the card screens and inputs, pre-snap states 1 to 5 with the huddle (pending Open decision 1), the motion contract, the 2x and reduced-motion rules, the states, the accessibility baseline, and the test changes.

Open:
- The four decisions above (Joseph).
- Every number in "Motion" and the card sizes (playtest, art-director).
- The new and revised art slots (art-director review against DESIGN.md).

## Resolved (Joseph, question dialog, 2026-11-14)

1. Pre-snap look: the opponent stays in the huddle until the player's last key, then lines up in its real alignment and snaps. This is the designer's recommendation. E6 holds, and there is no Space-to-snap step (open decision 2 lapses).
2. Call order: formation first. Offense picks a formation card, then a play card from that formation, with run and pass plays on one play screen or split by the 7-choice rule. Defense picks its front, then its play. This replaces "the order stays Run or Pass, then Formation, then play". The builder amends the engine's request screens so the order is formation first. Outcomes stay byte-identical: only the order the same final call is assembled in changes.
3. Lineups in the call request: approved, as a shared type change. The request carries the human side's own lineup only, never the opponent's.

Lead: the set-preview leak the designer found (field.ts skips the preview for the mark the result names) is fixed as part of this build (P3).
