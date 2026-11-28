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
- The **read**, where pursuit starts, is one of these, plus a reaction delay (150 ms for LB, 200 ms for DB, 250 ms for DL):
  - the handoff on runs;
  - the catch on completions and interceptions;
  - the throw on incompletions;
  - the QB crossing the line on a scramble.

  (Amended 2026-11-15, lead: this matches the code's `plan.read`.)
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
- The sacker's rush curves around the OL marks, never through them, and reaches the QB at max(drop end + `sack.minDelayMs`, the sacker's arrival). `sack.minDelayMs` is a designed value in `data/ui/motion.json`, 600 ms to start. The sacker's arrival is estimated as in docs/DECISIONS.md, "Sack time from the sacker's arrival (lead, 2026-11-15; designed)". The QB may step up 0.5 yd in that window. (Amended 2026-11-15: was "the drop end plus 600 ms".)
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
- The camera cuts. The only hold is the whistle frame, held before a possession flip so it is painted (amended 2026-11-14, docs/specs/m2-usability-pass.md U8).

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
| Reduced motion (Accessibility) | Final frame held for the whistle hold, no pans, no other holds (amended 2026-11-14) | Also: preview and huddle break cut, and the final frame shows post-settle positions. |
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

## Amended (Joseph, 2026-11-14): all 22 players move as in a real play

Joseph: "all players on the field should move at the same time as if a real play". From the snap, every one of the 22 marks moves, and nobody stands still while the play runs:
- The line blocks and rushes.
- Receivers run routes.
- Backs run, block or check down.
- Linebackers read, then flow or drop.
- Defensive backs backpedal, turn and cover.
- Everyone off the ball pursues the ball carrier once the ball is caught or handed off.
Staggered starts mean reaction time only, at most 150 ms after the snap for any player. Unnamed players' motion is drawing only: it still obeys the 2.5-yard ring and lane rule, and never implies a different result. This replaces any reading of "staggered starts" that leaves players idle.

## Amended (Joseph, 2026-11-14): player ratings on the field, hover for detail

Joseph: "each player should have a rating on them that i can hover over to see more stats about that play. same with the defense".
- Every mark on both sides can show the player's key rating for his position, beside his jersey number. Use the rating the position is judged on (for example Speed for a WR, Pass Rush for a DL), from the player's card, before the home-field shift. A field setting turns the rating labels on or off, and they are on by default. The number-collision rule still applies; when space is short, the rating hides before the number does.
- Hovering a mark (mouse), or focusing it (keyboard: a key cycles marks, Enter or Esc closes), opens a card with:
  - the player's name, number and position;
  - every rating on his card, with its league rank where `ratingRanks` provides one;
  - what he did on this play: only roles the engine credited (carrier, passer, target, tackler, sacker, interceptor, fouler and so on), with the yards from the result. A player with no credited role reads "No recorded stat on this play". The card never invents per-play stats the engine didn't decide;
  - his game totals so far, from the player box score.
- This works the same for offense and defense, at the set, during the play (it pauses the animation while the card is open) and at the whistle.
- Accessibility: the card is reachable without a mouse, is announced to screen readers, and stays legible at 200% text.
- Tests: every mark has a reachable card. A card's play section lists exactly the roles in `detail.participants` for that player, and no others. The ratings shown equal the card ratings.

## Amended (Joseph, 2026-11-14): full-screen field, menus over it

Joseph: "the field can be the full screen and the menu can appear over it since they happened at different times".
- The field takes the whole window, under the top bar. There is no fixed side panel any more.
- While you call (formation, play and other decision screens), the menu appears as an overlay panel over part of the field. It is translucent paper over the field, and it never covers the line of scrimmage, the line to gain, or your lineup. Place it on the side away from the ball, or let it collapse, so the pre-snap lineup stays visible.
- When you confirm the last key, the overlay closes and the play runs on the full field.
- At the whistle, the result line, the why line and the next call screen appear in the overlay again. The details view, box score and player cards are overlays too. Esc closes the top overlay.
- The HUD top bar stays.
- The 7-choice limit, the keys and the accessibility rules are unchanged. Overlay text keeps 4.5:1 contrast over the field, so use an opaque enough paper backing. Focus moves into the overlay when it opens and back when it closes.
- At small windows the overlay may cover more of the field, but the "Make the window larger" floor is lowered wherever the field still fits.
- Layout tests change from the two-column table to the overlay rules: the overlay never covers the line of scrimmage, the line to gain or your lineup at the set; no overlay shows during the live play; focus order holds.

## Revision 2026-11-14: real routes and slower pace

Status: draft, for build after Joseph confirms the schema change (R-Open 1). Amends "Motion" and "Data and modules" above where they conflict. Everything else in this file stands. Every template and number in this section is **designed, not fitted**. Nothing here is derived from tracking data, and none of it may be called data-derived.

### Problem

Joseph (playtest, 2026-11-14): "the movement of the players is still odd. everything moves in a linear fashion. it should represent real plays. maybe slow it down a little."

What I verified in the code and data:

1. **Every player of a position runs the same route.** `templates.json` `routes` is keyed by play class and position group, and `waypoints()` (art.ts) mirrors one list toward the middle. On a deep pass every WR runs `[0, 26]`, one straight segment, so the whole field moves in parallel lines. Short and intermediate have two points, but both WRs still make the same break.
2. **One-segment routes have nothing to curve.** `fillet()` (motion.ts) only rounds interior points. `drive()` ramps speed at the two ends only.
3. **Routes are stretched to fill time.** `diagramKeys()` (timeline.ts) runs every unnamed route over `max(read, natural)`. When the route is short and the read is late, he jogs the whole route at one slow, even speed. That even speed is the "linear" look as much as the straight lines are.
4. **Runs are flat too.** `lineContact.run` is `[0, 0.3]` for every OL, with no lateral step. Every WR runs `[1, 4]` and stops. The outside run stretches toward the RB's own side (`rb0.x <= MID_X`, timeline.ts line 381), not toward the engine's `runLocation`, so a shotgun outside run to the right goes left first and then cuts all the way across. That is a bug, and this revision fixes it.
5. **Defense is one straight leg each.** Zone defenders go straight to their zone centre and man defenders go straight to a fixed spot 4 yd off the generic receiver. `drops` are single points. There is no backpedal, no read step, no rotation, and the DL rush straight ahead.
6. **The pace runs faster than real.** Top speeds are 15 yd/s for WR, RB, CB and S, against real top speeds that I believe are about 10 to 11 yd/s. That number is **unverified**: [gap: primary source, NFL Next Gen Stats ball-carrier top speeds, nextgenstats.nfl.com]. I could not open a primary source in this session, so the new speeds below are designed values toward that range, not cited facts. The break slowdowns (0.55 and 0.85) are hard-coded in motion.ts line 90, which breaks the rule that tuning lives in data.

### User and assumption

Same user as above: Joseph and players like him, who know football and have watched real plays from the all-22 or a broadcast. The assumption that carries this revision: **"real" means recognisable concepts (receivers on one play doing different, complementary things, with a plant at each break), not biomechanics.** Test: G3 below. Joseph watches 20 plays at 1x and names any route or movement that still looks wrong. If he says "linear" again, ask which player and which moment.

### Decisions

**Term: "the read" (amended 2026-11-15).** In this revision, "the read" means the **throw** on every pass play (completion, incompletion or interception) and the **handoff** on handoff runs. On a QB sneak it is the code's sneak read (60% of his travel to the line), and on a scramble it is the QB crossing the line. It is never the catch. The code's `plan.read` in timeline.ts is different: it is the throw on incompletions but the **catch** on completions and interceptions (timeline.ts, the complete and interception branches), and pursuit starts there. Every R-C criterion below uses this revision's read (the throw or the handoff), computed from the timeline's throw time and `handoffMs`, not from `plan.read`. M5 and M10 keep `plan.read` unchanged. The lead settled this on 2026-11-15 (R-Open 7, closed): `plan.read` stays as the catch on completions and interceptions, and the "Motion" text now says so.

R1. **Routes are keyed by receiver role, not by position.** The role is the receiver's alignment, numbered the way coaches number them: on each side, eligible receivers (WR and TE) are counted from the sideline in. #1 is the widest. The **strong side** is the side with more receivers. On a tie it is the side with more TEs, and on a second tie it is the offense's right. Roles are `s1`, `s2`, `s3` (strong) and `w1`, `w2`, `w3` (weak). Backs, the QB and linemen keep position keys. Why: this is how a concept gives each receiver a different job, and it mirrors itself to the formation with no per-formation tables. Rejected: hand-written routes per formation and class (25 tables that drift apart). Rejected: picking route variants at random or by seed, because the UI has no randomness (contract 4) and because different art for the same call suggests a choice that changes nothing (decision 3). Final.

Roles in shipped formations (derived by the rule above, and a test asserts them):

| Formation | Strong side | s1 | s2 | s3 | w1 | w2 |
|---|---|---|---|---|---|---|
| shotgun | left (2-2 tie, TE side) | WR1 | TE1 | | WR2 | WR3 |
| underCenter | right (2-2, TE tie, right) | WR2 | TE2 | | WR1 | TE1 |
| pistol | right (2-2 tie, TE side) | WR2 | TE1 | | WR1 | WR3 |
| empty | left (3-2) | WR1 | WR3 | TE1 | WR2 | WR4 |
| heavy | right (2-1) | TE3 | TE2 | | TE1 | |

R2. **One concept per pass class.** Every role gets its own route, with a stem, a break and a finish, and the routes complement each other. The engine still picks the target. The concept never names one, and every route is drawn the same way. Final in structure. Routes are open to playtest.

R3. **Each template states its own mirror axis.** `in` means toward the middle of the field, as today, and is used for receivers and pass-protection linemen. `strong` means toward the strong side, for backs and the QB on passes and for the play-action fake. `play` means toward the run's play side, for run blocking, the run QB carry-out and the defense's run read step. The play side is the side of the engine's `runLocation`. When `runLocation` is middle or missing, it is the strong side. Nothing about the play side is ever taken from the end spot. Final.

R4. **Cards and the set preview draw `play`-axis templates with the lateral part removed.** The play side is the engine's decision, so a card can't know it, the same reason outside-run art forks (decision 4). The card shows each blocker's step up to its contact depth. From the snap, the live play adds the lateral step toward the engine's side. Coverage cards also leave out the defense's read step, which depends on the offense's call. Everything else on a card is the same drawing as the field (decision 5). Rejected: drawing runs to the strong side on cards, because it would promise a side the engine doesn't. Final.

R5. **Routes run at their own pace, then finish.** No unnamed route is stretched to fill time. A receiver runs his route at `routePace` × top speed. After his last waypoint he does what his `finish` says until the read:
- `sit`: settles and drifts at most `sit.maxYards`, at `sit.pace`, so he never stands frozen (Joseph's "all 22 move" amendment);
- `continue`: keeps the last direction at `continuePace`, and turns upfield along the sideline margin if he reaches it;
- `block`: holds his spot in pass protection and shuffles at most 0.5 yd;
- `stalk`: shadows his assigned defender (R9).

After the read, everyone pursues as today. Why: speed that changes, fast stem then plant then finish, is what reads as a person running a route. Final.

R6. **A visible plant at every break.** Before each fillet, speed ramps down over `plantYards` to `sharpPace` (a break over `sharpDeg`) or `roundPace`, holds through the arc, then ramps back up over `reaccelYards`. The numbers move from code into `motion.json`. Final in structure. Values are open to playtest.

R7. **The target leaves his template at the throw, never before** (amended 2026-11-15). The target runs his template exactly until the throw (code review: decision 9 and P3 forbid an earlier departure), then curves to the catch point and arrives at catch time. This replaces both "until its last break" and the first draft of R7 ("the template point nearest the catch point"). Why: on a multi-break route, "the last break" can be a corner pointing away from the ball, and the bend would draw as a hook. Final.

The catch point itself is set by two lead decisions, both designed and display only, both in docs/DECISIONS.md (2026-11-15):
- **"Neutral catch depth when the engine gives no air yards".** With no `airYards`, which is every completion today, the catch is at the class's `passDepth` past the line, capped at the gain and kept between the line and the dead spot.
- **"Neutral catch x inside the engine's pass third".** The catch x is the point of the engine's `passLocation` third nearest the target's template position at the throw, or the third's nearest edge. With no `passLocation`, which is every completion today, it is his x at the throw, inside the sideline margin.

These replace the air-yards catch point that the first draft's worked examples assumed. The worked live times below now use the neutral depth.

R8. **The throw waits for the route, up to a limit.** Throw time = max(drop end + hitch, the target's arrival at natural pace minus flight time), with the wait capped at `throwHold.maxMs` after the drop end. Past the cap the target speeds up, as the existing "speed rises with no cap" rule allows. Why: at real speeds a deep route takes about 3 s, and throwing at the 0.9 s drop end would force the receiver to run 15 yd/s. The engine gives no throw time in ms, so this changes no fact (decision 10). Sacks keep their own timing. Final.

R9. **Defense behaviours, all from the calls only before the read:**
- **Read step.** A non-rushing LB, S or CB first takes a short step from `readStep[offense family]` at a reduced pace (downhill and toward the play side on runs, a short hop then the drop on passes, a bite toward the fake on play action), then runs his drop.
- **Backpedal then break.** Zone and man CBs, and two-high safeties whose landmark is deep, open with a `pace` 0.55 pedal segment, then break at an angle to their landmark at full pace. A safety whose landmark is under (the down safety in a rotation) skips the pedal and goes straight to it.
- **Zone sink.** After reaching his landmark, a zone defender drifts toward the nearest receiver's *template* position, staying inside his zone rect and at most `zoneDrift.maxYards` from the landmark.
- **Man trail.** A man defender is assigned the receiver nearest his `manTargets` spot at the set. He trails that receiver's *template* route `man.lagMs` behind, with `man.cushionYards` of cushion (`pressCushionYards` in blitz presets).
- **Safety rotation.** baseCover3, nickelCover3 and nickelCover1 now align two-high at the set (their S1 and S2 entries in `presetAlignment` are deleted). At the snap, S1 rotates to the deep middle and S2 spins down to his assignment. nickelCover1 gains `zones.nickelCover1.S1 = [-9, 12, 9, 24, "deep"]`, the same deep middle as Cover 3, so its free safety has a landmark to rotate to; today he only backpedals straight. Blitz presets and runStuff keep their current alignment.
- **Edge rush arc.** The outermost DL on each side (`DLE`) rushes on an arc outside the tackle, and the tackle (`OLT`, the outermost OL each side) kick-slides out to meet him. Interior DL rush straight. Blitzing LBs take a slight arc through the gap.
- **Stalk targets.** On runs and screens, a WR's assigned defender is the nearest CB or S at the set on his side. If that defender is a named player, the WR releases and pursues instead, so a block never sits in the tackler's path.

Before the read, nothing in the defense depends on the target, the catch point or the result, only on the two calls and (on runs) the play side. Why: a defender drifting toward the real target before the throw would tell the player who gets the ball. Final.

R10. **Run game:**
- **Line.** OL and TE take a zone step toward the play side: inside run 1.0 yd lateral, outside run 1.8 yd, QB sneak 0. DL mirror the step so the pair stays in contact, and engaged pairs drift together by `runDrift[leaf]`. Nobody is drawn winning a block (unchanged).
- **Mesh.** QB and RB meet at a `mesh` point from data (play side, depth off the ball) at `handoffMs`.
- **QB.** After the handoff he carries out a fake away from the play side.
- **Outside run.** The carrier stretches toward the play side (the bug fix in Problem 4), then turns upfield on the existing 2 yd radius.
- **WRs.** They stalk: a 3 yd release, then they shadow a point at `stalk.contactYards` from their defender, `stalk.lagMs` behind his motion. While the defender runs at top speed the lag opens the gap by about his speed × the lag (1.6 yd at current values), and R-C8 allows for it.

Final in structure. Values are open.

R11. **Slower pace, real-ish speeds.** The new numbers are in the table below. Accel ramps are about twice as long. The live clamp rises to 1.8 to 7.0 s, so long plays are no longer compressed. 2x and skip are unchanged: 2x is the same timeline at double rate, and skip shows the final frame. Kneel 900 ms and spike 700 ms stay fixed. Open to playtest.

Not done, on purpose:
- No rating-scaled speed (decision 12 stands).
- No facing glyph for the backpedal: marks stay O and X, and the backpedal reads as a slow segment followed by an angled break.
- No change to kick coverage or return lanes (R-Open 4): Joseph's note was about scrimmage plays.
- No engine change.

### Route concepts (designed)

Units: `[in, up]` yards from the alignment, where `up` is upfield for the offense and away from the line for the defense. "pause" means a sit of that many ms at that waypoint. "Band" is the class's depth band (decision 4). Sideline and end-line clamps are under States.

| Class (concept) | s1 | s2 | s3 | w1 | w2 | RB (axis strong) | QB (axis strong) |
|---|---|---|---|---|---|---|---|
| shortPass (slant-flat strong, hitch-out weak) | slant `[0,3] [5,8]` continue | flat `[-1,2] [-7,4]` continue | stick `[0,5] [-1,6]` sit | hitch `[0,6] [0.8,5]` sit | speed out `[0,2.5] [-4,3]` continue | swing weak `[-2,-0.5] [-6,1.5] [-8,4]` continue | 3-step `[0,-1.5]` sit |
| intermediatePass (dig-curl strong, comeback-in weak) | dig `[-0.5,4] [0,14] [7,14.5]` continue | curl `[0,11] [0.8,9.5]` sit | shallow `[0,2] [6,4] [14,5]` continue | comeback `[0,13] [-3,11.5]` sit | square-in `[0,10] [6,10.5]` continue | check-release `[1,0.5] pause 600, [-4,2]` sit | `[0,-2]` sit |
| deepPass (go + seam-post strong, Mills weak) | go `[-1,2] [-1.5,30]` continue | seam-post `[0,12] [5,22]` continue (a straight seam stem, then a 27-degree bend to the post; amended 2026-11-15) | hook outlet `[0,10] [0.8,8.5]` sit | post `[0,12] [6,24]` continue | dig `[0,15] [7,15.5]` continue | pass pro `[1,1]` block | `[0,-3] [0,-2.5]` (drop, step up) sit |
| screenPass (RB slow screen strong, clear-outs weak) | stalk `[0,4]` stalk | bubble `[-1,-1] [-4,0]` sit; TE (`s2:TE`) arc block `[-2,2]` stalk | stalk `[-2,3]` stalk | go clear `[-1,2] [-1.5,18]` continue | dig clear `[0,8] [5,9]` continue | screen `[1,0.5] pause 500, [5,-0.5]` sit | drift `[0,-3]` sit |
| playAction (run fake strong, boot weak, flood) | deep over `[0,6] [14,16]` continue | TE leak `[0,1] pause 250, [6,3] [14,5]` continue | dig `[0,10] [6,10.5]` continue | go clear `[-1,2] [-1.5,24]` continue | sail `[0,7] [-5,12]` continue | fake and fill `[2,1.5] [3,3]` block | fake `[1,-0.5] pause 150`, boot `[-5,-3]` sit |

Runs (axis `play` for line, TE and QB, so positive is toward the play side):

| Leaf | OL and TE step (`lineContact[leaf]`) | DL (`lineContact[leaf]`) | TE (`routes[leaf].TE`) | WR | RB not carrying | QB (carry-out from the mesh) | `mesh` [play, depth] |
|---|---|---|---|---|---|---|---|
| insideRun | `[1.0, 0.3]`, drift 1.0 | `[1.0, -0.3]` | `[1.2, 0.8]` block | stalk `[0,3]` stalk | | `[-3.5, -1.5]` sit | `[1.0, 4.5]` |
| outsideRun | `[1.8, 0.2]`, drift 1.5 | `[1.8, -0.2]` | reach `[2, 0.5] [3, 1.5]` block | stalk `[0,3]` stalk | | `[-3.5, -1.5]` sit | `[2.5, 4.5]` |
| qbSneak | `[0, 0.3]`, drift 0 | `[0, -0.3]` | `[0, 0.5]` block | stalk `[0,3]` stalk | push `[0, 1.5]` block | carrier (fact) | none |

Pass line (`lineContact`, axis `in`):
- `pass.OL` stays `[0,-1.5]`. `pass.OLT` kick-slide `[-1.2,-1.8]`. `pass.DL` stays `[0,-2.1]`. `pass.DLE` arc `[-1.5,-0.5] [-1.7,-2.1]`.
- `screenPass.OL`: `[0,-1] pause 400, [4,1.5]` (axis strong; interior linemen release into a convoy). `screenPass.OLT`: `[0,-1.5]` (they stay in).
- `screenPass.DL`: `[0,-2.6] [0,-4]`, to the ring around the QB, never closer.
- `playAction.OL` and `.OLT`: `[0.8,1] [0.8,0.6]` (axis strong, the run fake).

Defense (`readStep`, axis `play` on runs and `strong` on play action; the pedal segments go in `drops`):

| | LB | S | CB |
|---|---|---|---|
| readStep.run | `[0,-0.8]` pace 0.5, `[1.5,-1.5]` pace 0.6 | `[0,-1]` pace 0.5 | `[0,1.5]` pace 0.5 |
| readStep.pass | `[0,-0.5]` pace 0.4 | none | none |
| readStep.playAction | `[0.5,-1.5]` pace 0.6 (bite) | `[0,-1]` pace 0.5 | none |
| drops.zone (before the landmark) | none | two-high: `[0,2]` pace 0.55 | `[0,3]` pace 0.55 |
| drops.man (before the trail) | none | none | `[0,1.5]` pace 0.55 |
| drops.blitz | arc `[0.8,-2] [0.5,-6]` | as today | as today |

### Pace: `data/ui/motion.json` (designed starting values)

| Key | Was | Now |
|---|---|---|
| `speed` WR, CB | 15 | 10.5 |
| `speed` RB, S | 15 | 10 |
| `speed` TE, LB | 13 | 9.5 |
| `speed` QB | 11 | 8.5 |
| `speed` OL, DL | 6 | 5 |
| `speed` K, P | 10 | 8 |
| `accelMs` WR, RB, CB, S | 300 | 650 |
| `accelMs` TE, LB | 300 | 600 |
| `accelMs` QB, K, P | 250 | 450 |
| `accelMs` OL, DL | 150 | 300 |
| `decelMs` | 250 | 350 |
| `dropMs` short, intermediate, deep, screen, play action | 450, 700, 900, 800, 950 | 600, 1250, 1700, 1100, 1400 (intermediate and deep revised 2026-11-16, were 950 and 1250: see "Revision 2026-11-16: deeper drops, shorter holds") |
| `handoffMs` | 380 | 550 |
| `flight` baseMs, perYardMs, minMs, maxMs | 220, 14, 300, 1000 | 250, 22, 350, 1500 |
| `live` minMs, maxMs | 1500, 4000 | 1800, 7000 |
| `startMs`, `maxStartMs` 150, `snapMs`, kicks, `preSnap`, `settleMs`, holds | | unchanged |

New keys:
- `routePace` 0.9, `continuePace` 0.75
- `fillet.roundPace` 0.8, `fillet.sharpPace` 0.45, `fillet.plantYards` 1.2, `fillet.reaccelYards` 2.0
- `sit` {pace 0.25, maxYards 1.0}
- `throwHold.maxMs` 1200, and per class `throwHold.leafMaxMs` {shortPass 600, screenPass 600, playAction 600, intermediatePass 900, deepPass 1250} (revised 2026-11-16, see "Revision 2026-11-16: deeper drops, shorter holds")
- `man` {cushionYards 1.5, pressCushionYards 1.0, lagMs 150}
- `zoneDrift` {maxYards 2.5, pace 0.5}
- `stalk` {contactYards 1.4, lagMs 150}
- `runDrift` {insideRun 1.0, outsideRun 1.5, qbSneak 0}
- `fakeMs` 450 (the play-action fake time, now data)
- `sidelineMarginYards` 1.5

Worked live times at 1x, for the engineer's sanity check:

| Play | Live, about |
|---|---|
| Inside run +4 | 550 handoff + 850 carry + 300 converge = 1700, floored to 1800 |
| Short pass, neutral depth 6 + 4 after the catch | catch at 1250 (slant arrival), + 400 + 300 = 1950 |
| Deep pass, neutral depth 28 + 5 after the catch | throw about 2530 (hold capped), catch about 3400, + 500 + 300 = 4200 |
| Sack, intermediate | 950 + 600 + 300 = 1850 (1250 + 600 + 300 = 2150 after the 2026-11-16 revision) |
| 60-yard touchdown run | about 7100, compressed 2% to 7000 |

### Schema change (ask first: Joseph to confirm)

`data/ui/templates.json`, version 1 to 2:
1. **A route value can be an object** `{ "pts": [...], "finish": "sit"|"continue"|"block"|"stalk", "axis": "in"|"strong"|"play" }`. A bare array still means `{ finish: "sit", axis: "in" }`, so the existing entries stay valid.
2. **A waypoint can be an object** `{ "p": [in, up], "pauseMs"?: n, "pace"?: f }` as well as a pair.
3. **The `routes[class]` lookup chain** is `role:position` (for example `s2:TE`), then the role (`s1` to `w3`), then the position. The shared `routes.run` key splits into `insideRun`, `outsideRun` and `qbSneak`, and `routeKey()` returns the leaf.
4. **`lineContact`** gains per-leaf keys (`insideRun`, `outsideRun`, `qbSneak`, `screenPass`, `playAction`) that fall back to the family keys, plus the `OLT` and `DLE` position keys.
5. **New top-level keys:** `readStep` (by offense family, then position) and `mesh` (by run leaf).
6. **Data removal, not schema:**
   - `routes.*.OL` entries go: they are dead today, since both art.ts and timeline.ts read `lineContact` for linemen.
   - The S1 and S2 `presetAlignment` entries for baseCover3, nickelCover3 and nickelCover1 go (the safety rotation). This replaces "Cover 3 and Cover 1 are single-high with a rotated safety" in "Data and modules".
   - Added: `zones.nickelCover1.S1` deep middle (R9). This is a new entry in an existing map, not a schema change.

`data/ui/motion.json`, version 1 to 2: the new required keys listed above. `parseMotion` validates them.

Possibly: `templates.json` `timing.liveMinMs` and `timing.liveMaxMs` (2000 and 4000) look like leftovers from before `motion.json`. The engineer confirms whether anything still reads them. If nothing does, they are removed in this change, which is also a schema change (R-Open 5).

No change to `packages/sim`, the PlayResult, `data/engine` or any engine type.

### Hard rules kept

- **Fact anchors fixed (decision 10).** Throw time and target path are timeline choices between anchors, never facts. The ball is at `end.spot`, the holder and tackler are at the ball, the catch is at the catch point.
- **No reveal (decisions 4 and 9, P3).** Cards draw every route alike, with no ball, no target and no side (R4). Before the read, defense motion depends on the calls and the run side only (R9, criterion R-C9).
- **Card art equals field routes (decision 5),** except the two documented omissions in R4.
- **Data, not code:** every route, step and speed is in JSON, including the break paces that are hard-coded today.
- **At most seven choices per screen:** this revision touches no menu.
- **No engine changes.**

### States

| State | Behaviour |
|---|---|
| A formation lacks a role (heavy has no w2 or s3) | That role's template is unused. No fallback is needed. |
| A mark resolves no template | Unreachable in shipped data (R-C1). At runtime: the existing check-down default. `timeline()` adds a warning naming the file and key to `tl.warnings`, and the app logs each distinct warning once per session. Nothing appears on screen. |
| A route would cross the sideline | Waypoints clamp to `sidelineMarginYards` inside the line. The break still happens, and a `continue` finish turns upfield along the margin. |
| Goal to go or red zone | Waypoints past the end line minus 1 yd clamp to that depth. A go becomes a fade that sits at the back line. Zones clamp the same way. |
| Run with `runLocation` middle or missing | Play side = strong side. |
| The target is a back in pass pro, or a stalking WR | He leaves his template at the throw (R7), releasing from the block, and arrives at the catch. |
| Screen thrown to the weak side | The convoy has still gone strong, as the call drew it. The ball goes where the engine says. Accepted: the diagram is the call. |
| Stalk defender is named (tackler, interceptor) | The WR releases and pursues instead of shadowing. |
| Sack | Routes run until the sack time, then pursuit as today. |
| Live time clamped (floor or cap) | Uniform scaling as today. R-C9 only applies to unclamped plays. |
| No play, kneel, spike | Unchanged. |
| 2x, skip, reduced motion | Unchanged. The final frame draws the new paths. |
| Template or motion data invalid | The existing "Game data failed its check: [file]" state. |
| Loading, permission denied | Not applicable, as above. |

### Acceptance criteria

These add to K1 to M11. M2, M4 and M9 are amended as noted.

| # | Criterion | How it fails |
|---|---|---|
| R-C1 | For every formation × offense class and every package × preset in the catalog, every mark resolves a template through the lookup chain (extends K2). | A mark with no template. |
| R-C2 | Roles derived by the R1 rule equal the table in R1 for the five shipped formations. Mirroring a formation's alignment left to right swaps the strong side and mirrors every resolved path to within 1e-6 yd. | Wrong role, or asymmetry. |
| R-C3 | In every (formation, pass class) with 2 or more receivers, no two receivers' resolved routes are the same. Compared on a common side, they differ by more than 2 yd at some waypoint, or they have a different waypoint count. | Two identical routes. |
| R-C4 | Every receiver route in short, intermediate, deep and play action has at least 2 waypoints and at least one turn of 20 degrees or more, except a `stalk` or `block` finish. Turns are measured between consecutive segments of the polyline [alignment, waypoint 1, waypoint 2, ...], so the release from the alignment counts. In every (formation, pass class) at least 2 routes reach a point inside the class's depth band. | A one-segment route, or a concept that misses its band. |
| R-C5 (amended 2026-11-15) | **No unnamed receiver's route is stretched.** Split his route at its rests (his start and each `pauseMs` waypoint) into stretches, ending at his last waypoint. Mean speed is not used, because the `accelMs` ramp from rest, the `sharpPace` plant and the `sit` finish pull the mean down on short routes. The bound is on peak speed per stretch, where `top` is his group's `speed`:<br>- stretch polyline 6 yd or longer: peak at least 0.85 × `routePace` × top (8.0 yd/s for a WR at current values);<br>- 2 to 6 yd: peak at least 0.6 × `routePace` × top (5.7 yd/s);<br>- under 2 yd: no bound.<br>**Nobody frozen before the read.** From each mark's start time to the read (the throw or the handoff), every unnamed mark on both sides has speed above 0. `sit` and `block` finishes move at `sit.pace`. The bound applies only in that window. After the read, pursuers may brake to rest at the 2.5 yd ring (contract 3), named players stop at their anchors, and the settle applies (M7). | A jogged route, or a mark frozen before the read. |
| R-C6 (amends M4; amended 2026-11-15) | **Apex.** At each break over `sharpDeg`, speed at the arc apex is at most 1.1 × `sharpPace` × `routePace` × top. Round breaks use `roundPace`.<br>**Plant.** On a long stem (at least L = `plantYards` + 0.5 × `routePace` × top × `accelMs` / 1000 from the previous rest; 4.3 yd for a WR at current values), speed falls monotonically over the `plantYards` before the arc. On a shorter stem he never reaches cruise, so the plant is measured against that stem's own peak: speed at the apex is no higher than the stem's peak, so he never speeds up into the break. That covers the 2.2 yd round-break stem and the 1.4 yd screen stem.<br>**Re-accel.** Speed rises over the `reaccelYards` after the arc, with one exception (lead, 2026-11-15): when the leg after the break is his last one and ends in a `sit` or `block` finish, R5's finish pace wins and the rise isn't required.<br>No pace constant remains in motion.ts. | A corner at speed, a speed-up into a break, or a hard-coded pace. |
| R-C7 (amended 2026-11-15) | Target: from his start to the throw, his path equals his template track (within 0.1 yd). After the throw he reaches the catch point at catch time. The catch point follows the two 2026-11-15 DECISIONS.md entries (neutral catch depth, neutral catch x), not air yards. Throw time follows R8. Over 1,000 simulated games, the target's peak speed is at most 1.15 × top on at least 95% of completions. Report the share in PERF.md. | Hook artefacts, early throws, or sprinting receivers. |
| R-C8 | Runs, at engage end: every OL and inline TE has moved toward the play side by at least 0.7 yd (insideRun) or 1.4 yd (outsideRun), and by at most 0.5 yd on qbSneak. Engaged pairs stay within contact distance (M6). The QB moves at least 2.5 yd away from the play side after the handoff. On an outside run, the carrier's x motion from mesh to line has the sign of the play side. **Stalk (amended 2026-11-15).** Each WR releases at least 2 yd upfield. On plays where his assigned defender is never named, B = `stalk.contactYards` + v × `stalk.lagMs` / 1000 + 0.5 yd, with v the defender's group `speed`: 3.5 yd against a CB at current values. Two checks (amended 2026-11-15):
- **Hold.** The window starts the first time he comes within B and ends at the whistle. In every window of 300 ms or longer, he is within B for at least 60% of it.
- **Approach.** Over all plays with at least 1,000 ms from his release end to the whistle, on at least 80% of them he comes within B before the whistle, or is closer to his defender at the whistle than at his release end.

Why this option: the misses come from how it was measured, not from bad behaviour. The corner starts 7 to 9 yd off and backpedals, and on short runs only about 300 ms are left, so the old window charged the WR for his approach. A window that starts once he has closed tests the stalk itself. The approach check stops a WR who never closes from passing by having no window. Rejected: a new approach phase, which adds code and data for behaviour that the feed-forward in `follow()` already gives. Rejected: dropping short plays alone, because the approach time would still count against him on longer ones. Why B: the 150 ms lag behind a defender at top speed keeps the WR about 1.5 yd back of contact, so contact + 0.3 yd was met only 0 to 21% of the time. If either check misses, that is a FLAG to tune `stalk.lagMs` in data, not to loosen B or the shares. | A flat line, a wrong-way stretch, or a WR who stops or drifts off his man. |
| R-C9 | **No pre-read leak.** Two events with identical calls (and the same play side on runs) but different targets, catch points or results, both unclamped, give identical defender positions at every t from the snap to the read (the throw, or the handoff; not `plan.read`). | Any defender reacting to the target early. |
| R-C10 (amended 2026-11-15) | Defense. "Deep" and "shallow" are yards past the line, and \|x\| is measured from the middle of the field.<br>(a) **Pedal.** Zone and man CBs move at most 0.65 × top over their pedal segment. When the pedal ends before the read, the next segment changes direction by at least 30 degrees. Exempt (lead, 2026-11-15): a man defender trailing a vertical route, meaning one that stays within 15 degrees of straight upfield after its break.<br>(b) **Rotation, pass plays in baseCover3, nickelCover3 and nickelCover1.**<br>- At the set, both safeties are 10 yd or deeper with \|x\| ≥ 7.<br>- At the read (the throw), each safety has moved at least 1 yd from his set spot. His displacement has a positive component toward his assignment point: his zone landmark, or for the man safety, his receiver's template trail point at that time.<br>- On plays whose throw is at least 2,000 ms after the snap, at snap + 2,000 ms the deep-middle safety is 14 yd or deeper with \|x\| ≤ 3. On play action, the check runs at snap + 2,300 ms (and only when the throw is at least that late) instead (lead, 2026-11-15), because his 1 yd bite toward the fake costs time. All other numbers stay the same.<br>- In the two zone presets only, the down safety is also 9 yd or shallower at that time. In nickelCover1 he trails his receiver, who may be deep.<br>Quick reads are covered by the direction check, not by position: on a short pass or a run there isn't time to rotate about 7 yd at 10 yd/s with a 650 ms ramp. Runs are exempt from (b), because the read step and pursuit take over at the handoff.<br>(c) **LB read step.** Each non-rushing LB moves at most 1.5 yd in the 300 ms after his start. On runs he never moves away from the line in that window.<br>(d) **Edge rush.** On pass plays, the outermost DL on each side moves at least 1 yd outward (away from the middle) before contact. | A straight drop, no rotation, or no arc. |
| R-C11 | Cards and the set preview: `play`-axis templates draw with lateral 0. Coverage cards show no read step. P3 still passes. Every other card path equals the field path for that call. | A side on a run card, or card and field drifting apart. |
| R-C12 (amends M9) | Live time is 1.8 to 7.0 s at 1x (from `motion.json`). Kneel and spike are fixed. 2x halves every phase. Skip and reduced motion show only the final post-settle frame. | Out of range. |
| R-C13 (amended 2026-11-16) | `motion.json` holds the values in the Pace table, with the 2026-11-16 values: `dropMs` {shortPass 600, intermediatePass 1250, deepPass 1700, screenPass 1100, playAction 1400} and `throwHold.leafMaxMs` {shortPass 600, screenPass 600, playAction 600, intermediatePass 900, deepPass 1250}, `throwHold.maxMs` 1200. `parseMotion` and `parseTemplates` reject a malformed route object, waypoint object, `readStep`, `mesh` or any new motion key (extends the layout.test "malformed file" case). | Missing validation. |
| R-C14 | No diff under `packages/sim` or `data/engine`. Engine and calibration tests pass unchanged. | Any engine change. |
| R-C15 | M11 still holds: `timeline()` takes 20 ms or less per play (median and p95 over 1,000 plays in PERF.md). | Over budget. |
| G3 | Joseph watches at least 20 plays at 1x (runs, each pass class, at least one Cover 3 and one man look) and says whether they read as real plays and whether the pace is right. Each named problem goes in the playtest log. | Not run. |

Existing tests that change: M2's easing bound reads the new `accelMs`. M4's 55% becomes `fillet.sharpPace`. A4 and M9 read the new `live` bounds. Any test that relies on `routeKey()` returning `"run"`. None is weakened.

Note on M5 (lead, 2026-11-15; designed): the M5 check that "at least half of the diagram defenders end the play closer to the ball than they were at the read" skips plays that end out of bounds. On those plays the carrier runs to the sideline, away from the defenders, after the read. Why: the neutral catch point (DECISIONS.md, 2026-11-15) now puts a real run after the catch. Defenders 10 to 40 yd off can't gain ground in 850 ms on a carrier heading for the sideline at about 10 yd/s. The rest of M5 (the 2.5 yd ring and the corridor) still applies to those plays.

Art-director checks:
- card legibility with five distinct routes at 160 × 120 px and at the 120 × 72 floor;
- the DESIGN.md "Motion" line about straight segments, already marked revised above, now also covers multi-break routes and the plant.

### Open (R-Open)

1. **Schema change approval (Joseph).** Both files go to version 2, as listed above. Without it, none of R1 to R10 can live in data.
2. **Speeds against a primary source.** Check NFL Next Gen Stats top speeds before anyone calls the 10 to 10.5 yd/s values "real". Until then they are designed.
3. **Safety rotation shows two-high at the set for Cover 3 and Cover 1.** No decision falls between the set and the snap, so I recommend it. It does make their look harder to read after the snap.
4. **Kickoff and punt coverage lanes** are still straight lines. They need a later revision if Joseph sees the same problem there.
5. **The legacy `templates.timing.live*` keys:** remove them if nothing reads them.
6. **The 7.0 s cap.** Is a long touchdown at 1x too long? 2x is one key away. Ask after G3.
7. **Closed 2026-11-15 (lead): `plan.read` stays as the catch on completions and interceptions.** The code is unchanged. The "Defenders reacting and pursuing" sentence in "Motion" now says pursuit starts at the handoff on runs, at the catch on completions and interceptions, at the throw on incompletions, and when the QB crosses the line on a scramble. The R-C criteria still measure to the throw or the handoff (see "Term: the read"), and that window ends before or at pursuit start, so no criterion changes.

## Amended (Joseph, 2026-11-15): misses that read as misses, deep catches that read deep

### Problem and user

Joseph played the app: "the deep passes never connect, the plays are thin, it's just really not fun and doesn't seem to work." Same user as above. Two display bugs, both verified in timeline.ts, both approved for a fix:
1. **Every incompletion is drawn as a catch.** The ball flies to a fixed point (`passDepth`, x from `passLocation`) and `plan.target` steers the target onto it. Over 1,542 deep incompletions the ball-to-target gap at arrival is 0.0 yd at p10, p50 and p90, and the nearest defender is 7.2 yd off (median). The player sees a wide-open catch, then "Incomplete". This holds for every pass class.
2. **About 21% of deep completions are drawn short.** The neutral catch point follows the receiver's route. The RB on deepPass is in pass pro, and the empty s3 runs a hook outlet, so every RB deep catch lands about 5.7 yd behind the line and TEs land at about 8.3 yd.

What the viewer reads first, in order: the ball's flight against the target, where it lands relative to him and to the nearest defender, then the "Incomplete" label. The label stays 300 ms after the landing so the motion is read before the text. Hard limits: no engine or record change (R-C14). The engine names no defender on an incompletion and sends no `airYards` or `passLocation`. The drawing may pick a cause, but it must never imply a catch or an interception.

### Decisions (designed, display only)

A1. **The target keeps his template on an incompletion.** `plan.target` is no longer set on incompletions. He runs his template and finish to the whistle. In the last `miss.reachMs` before arrival he may reach toward the ball, at most `miss.reachYards` off his track, and blend back over the same time. Why: steering him onto the ball is the bug. Final.

A2. **The aim point is where a completion to him would be caught.** A = the neutral catch point (DECISIONS.md "Neutral catch depth" and "Neutral catch x", including the deep floor in B1), computed on his template with no gain cap (an incompletion has no dead spot). The top of the band is the class depth, clamped at the end line minus 1 yd. R8 times the throw for A, and catchT = throwT + flight(A). T = his template position at catchT. With no known offensive target, today's fixed point stays as the aim and nobody reaches. Why: the throw time and everything before it are the same for every kind of miss, so the miss kind can't leak before the throw (R9, decision 4, P3). Final.

A3. **The kind of miss is chosen by geometry, never by chance.** In order:
- **Break-up.** P = T + `miss.breakup.gapYards` toward the breaker's position at the throw. The breaker is the non-rushing CB, S or LB (not blitzing in his preset, and unnamed, since no defender is named on an incompletion) who needs the lowest pace to reach within `miss.breakup.handYards` of P by catchT from his drawn spot at the throw. He must need at most `miss.breakup.maxPace` × his top speed, with his `accelMs` ramp. If none qualifies, use the next rule.
- **Overthrow.** He is moving at `miss.movingYps` or faster and within 45 degrees of upfield at catchT. P = T + `miss.overYards` along his travel.
- **Behind.** He is moving at that speed but more across than up. P = T − `miss.behindYards` along his travel.
- **Short.** He is slower than that, or coming back. P = T + `miss.shortYards` toward the passer's release point, into the ground at his feet.
- **Clear check.** If any defender is within `miss.clearYards` of an overthrow, behind or short P at catchT, that defender becomes the breaker and the break-up rule is redrawn with him. An open defender near a loose ball would otherwise read as a dropped interception.
- **Off the field.** P may lie up to `miss.outYards` past a sideline or end line. Past that, it is clamped there.

Why geometry: covered receivers get broken up, open ones get a bad throw, and the cause can be read from the picture. Rejected: a seeded mix hashed from the play record. It is deterministic, but it would sometimes draw a break-up with nobody near or an overthrow on a sitting hitch. The UI has no randomness (contract 4), and R1 already rejected seed-picked variety. Rejected: a drop, because a ball in the target's hands is the bug itself. Final in structure. Values are open to playtest.

A4. **Where the ball ends.** The ball's flight ends at P at catchT, with the flight time from A (the at most 4 yd of difference is under 90 ms and can't be seen). It ends on the ground: `endScale` at most 0.6. On a break-up it then deflects `miss.breakup.deflectYards` away from the midpoint of the target and the breaker in 300 ms, with apex 0.6. Otherwise it rolls `miss.rollYards` on along its flight in 300 ms. No mark holds the ball between the throw and the jump to the spot. The label "Incomplete" sits at the ball's final point at catchT + 300. No text, box score or card credits the breaker. Final.

A5. **The breaker is drawn only after the throw.** He becomes a converge from throwT to his hand point at catchT, then idles. Before the throw he is exactly his unnamed self (R9). Final.

B1. **Deep completions have a catch floor, with two routes made deep enough to meet it.** Rule: on a completion with no `airYards` whose leaf has `catchFloorYards[leaf]` in templates.json (deepPass 20, designed), the catch y is max(the neutral catch y, los + min(floor, gain)). So the catch is at least 20 yd past the line, or at the dead spot when the gain is shorter. The catch x is unchanged. R8 times the throw for the raised point, and R7 bends his path after the throw. Data change, so the bend stays short enough for R-C7:
- deepPass `RB`, from pass pro to check-release seam: `{p:[1,0.5], pauseMs:400}, [-1,4], [-2,26]`, finish continue, axis strong.
- deepPass `s3` (empty TE1), from hook outlet to bender: `[0,8] [5,20]`, finish continue.
- deepPass `w2`, dig deepened: `[0,17] [7,17.5]`.

Why both: the floor alone forces a pass-pro back to cover about 25 yd in one flight (about 27 yd/s, which breaks R-C7). New routes alone don't guarantee the floor on every play. Rejected: a floor for intermediatePass and playAction. Their RB check-release and leak are designed check-downs, and the complaint was about deep shots. Revisit if G4 names them. Rejected: picking a different receiver, because the receiver is the engine's fact. Final in rule. Route values are open.

New data (designed starting values):
- `motion.json` `miss`: `reachMs` 250, `reachYards` 0.5, `movingYps` 3, `overYards` 4, `behindYards` 3, `shortYards` 3, `clearYards` 2, `outYards` 2, `rollYards` 1.5, and `breakup` {`gapYards` 1.5, `handYards` 0.6, `maxPace` 1.0, `deflectYards` 3}.
- `templates.json` `catchFloorYards` {deepPass 20}.
- parseMotion and parseTemplates validate them.

### States

| State | Behaviour |
|---|---|
| Target unknown or not offense | Aim at today's fixed point. The ball lands and rolls. No reach, no breaker. |
| Target is a blocker or stalker | Same rules. He is usually slow at catchT, so the miss is drawn short. |
| No eligible breaker | Overthrow, behind or short (A3). |
| Red zone, sideline | P up to `outYards` out of bounds (A3). The floor stays capped by the gain. |
| Gain under the floor | Caught at the dead spot (B1). |
| Live time clamped, 2x, skip, reduced motion | As today. The final frame shows the ball at the spot. The miss kind is not a fact, so losing it in reduced motion is accepted. |
| Interception, sack, completion with `airYards` | Unchanged. |
| Data invalid | The existing "Game data failed its check: [file]". |

Accessibility: the result text stays "Pass incomplete." and no new information is carried by colour or by motion alone. Model output: the drawn cause is a display guess about a result the engine decided without one. It is never written as text, so it can't be quoted as a fact. A drawing that contradicts the record is a bug, and the record wins.

### Acceptance criteria (add to R-C1 to R-C15)

| # | Criterion | How it fails |
|---|---|---|
| R-C16 | Over 1,000 simulated games, on 100% of incompletions with a known target, the ball at arrival is at least `overYards`/`behindYards`/`shortYards` − `reachYards` (2.5 yd at current values) from the target on a miss, and at least `gapYards` − `reachYards` (1.0 yd) from him on a break-up. Report the p10, p50 and p90 gap in PERF.md. | A ball in his hands. |
| R-C17 | On 100% of break-ups, the breaker is within `handYards` + 0.2 yd of the ball at arrival, nearer to it than the target, is a non-rushing CB, S or LB, and peaks at no more than 1.15 × top. On 100% of other misses, no defender is within `clearYards` of P at arrival. | An implied interception, or a sprinting breaker. |
| R-C18 | From the throw to the whistle, no mark holds the ball. The ball's last flight segment ends at P with `endScale` ≤ 0.6, and the label "Incomplete" is at the final ball point. | An implied catch. |
| R-C19 (amends R-C7 for incompletions) | On incompletions the target is within 0.1 yd of his template track at every t, except in [catchT − `reachMs`, catchT + `reachMs`], where he is within `reachYards` + 0.1. R-C7's catch-point clause applies to completions only. | Steering onto the ball. |
| R-C20 (extends R-C9) | The same incompletion drawn with each miss kind forced (a test hook) gives identical frames, all 22 marks and the ball, at every t up to the throw. The R-C9 leak cases pass unchanged. The same event drawn twice gives an identical timeline. | The miss leaks before the throw, or nondeterminism. |
| R-C21 | Every deepPass completion with no `airYards` has its catch at least min(`catchFloorYards.deepPass`, gain) past the line and no further than the dead spot (100%, over 1,000 games). Report the share by receiver position. | A short deep catch. |
| R-C22 | R-C7's speed bound holds on all completions and separately on deepPass completions to RBs and TEs: at least 95% peak at no more than 1.15 × top. If either misses, that is a FLAG to tune the route data (or Open item 2), never the floor or the bound. | Sprinting deep backs. |
| R-C23 | With the line at midfield, in every formation, every WR, TE and RB deepPass template track reaches 20 yd past the line at a point a throw can time (the R8 window). R-C1 to R-C4 and R-C11 still pass on the new routes. | A deep route that can't get deep. |
| R-C24 | Report the shares of break-up, overthrow, behind and short by class over 1,000 games in PERF.md. There is no target share, because it is a result of the geometry. | Not reported. |
| G4 | Joseph watches 20 or more passes at 1x, including at least 5 deep shots and 5 incompletions, and says whether misses read as misses and deep catches read deep. | Not run. |

Existing tests that change (none weakened):
- routes-pace "an incompletion uses the class's neutral depth" (line 1670). The flight now ends at P, not at `passDepth`. It is rewritten to check A against the neutral rule plus R-C16.
- `expectedCatch` in routes-pace gains the B1 floor.
- Any R-C7 sweep that sets an incompletion's target on the ball (the heavy file) narrows to completions.
- Card art and preview expectations for deepPass RB, s3 and w2 change with the data. R-C11 still requires card = field.
- timeline.test "an incompletion: ... labelled Incomplete" keeps its label and holder checks.

### Open

1. **Schema (ask first).** The new `miss` and `catchFloorYards` keys are additive and validated. Joseph confirms them, and decides whether they bump the version, before the build.
2. If R-C22 or R-C23 misses after route tuning, the next lever is a deepPass-only `throwHold` (about 1700 ms, a new key). Joseph's call. **Settled 2026-11-15 (Joseph approved): built, see "Settled while building" below.**
3. A completion overturned to incomplete on review: the engineer confirms the timeline draws the final ruling, so these rules apply.
4. The real share of break-ups to overthrows is not looked up (no primary source checked). G4 judges it by eye.

### Settled while building (2026-11-15)

Both are designed and display only. Neither changes an engine outcome or the record.

- **A deepPass-only throw hold (Open item 2, Joseph approved).** `motion.json` `throwHold.leafMaxMs` holds `{ "deepPass": 1700 }`. On a pass play with an entry, R8's wait after the drop end is capped at that value instead of `throwHold.maxMs` (1200 ms, unchanged for every other class). The R8 window everywhere (the throw, the neutral catch point and R-C23's timeable point) uses the same hold. Why: a back aligned 7 yd deep (underCenter, pistol, heavy) could not reach 20 yd past the line inside the 1200 ms window at his pace (R-C23 measured 16.5 to 19.4 yd at the deepest timeable point), so the B1 floor forced a sprint after the throw (R-C22). With 1700 ms every WR, TE and RB deepPass track reaches 20 yd in every formation. No route data changed for it. parseMotion validates it: each key must be a pass play in `dropMs` and each value a non-negative number of ms. (Revised 2026-11-16: the deepPass hold is now 1250 after a 1700 ms drop, the same 2950 ms window end. See "Revision 2026-11-16: deeper drops, shorter holds".)
- **The whistle on a miss (A4 timing).** The roll or deflection takes `miss.rollMs` (300), then the ball rests where it stopped for `miss.restMs` (400) before the whistle and the respot. So the "Incomplete" label sits beside the resting ball before the ball jumps to the spot. Every incompletion is 0.4 s longer on screen than the landing plus the roll alone.
- **The clear check reads the drawn marks.** The first drawing estimates where each defender will be at the arrival. When a drawn defender still ends up within `clearYards` of an overthrow, behind or short P, the play is drawn again with what was seen, and A3's rule is applied to him: he becomes the breaker if he is an eligible breaker within the pace limit, otherwise P moves to where the ball reads as a miss (at most 4 redraws, then a warning). Only frames after the throw change, so R-C20 holds. A miss point is also kept at least the smallest miss distance off the target, so a point clamped at an end line can't break R-C16.
- **R-C20 and the first keys after the throw.** For its first two keys the ball flies toward the aim point A, whatever the kind of miss, then on to P. One key was not enough: natural motion reads the ball half a key past the first key after the throw for its line of flight, and frames just before the throw are drawn between keys.

## Revision 2026-11-16: deeper drops, shorter holds

Status: draft, revision dated 2026-11-16, Joseph approved the direction (a longer, deeper drop with a shorter hold after it, the same throw window end). Author: spec-writer. Amends the Pace table, R-C13 and the deepPass hold in "Settled while building" above. Every value here is **designed, not fitted**. None comes from tracking data. Display only: no engine outcome, record or why line changes.

### Problem

After the QB throw pace work (docs/DECISIONS.md, "QB throw pace"), the QB still stands with the ball after his drop: hold p90 about 1,200 ms on intermediatePass and about 1,700 ms on deepPass. The holds could not be cut alone, because R8's window end is the drop end plus the hold. The intermediate window (950 + 1200 = 2150 ms) is what lets an intermediate route reach its 14 yd class depth (routes-pace, "an incompletion is aimed at the class's neutral point"). The deep window (1250 + 1700 = 2950 ms) is what R-C23 needs, because backs aligned 7 yd deep must reach 20 yd. What the viewer reads: the QB drops in about 1 s, then stands still for a beat longer than his drop took. A real drop on a deep shot is longer and deeper, so the throw comes soon after the set.

### Decisions (designed, display only)

QD1. **Longer, deeper drops, the same window end.**

| Class | `dropMs` | QB drop in templates.json | Drop length | `throwHold.leafMaxMs` | Window end (drop + hold) |
|---|---|---|---|---|---|
| intermediatePass | 1250 (was 950) | `[-1.5, -4.7]` (was `[0, -3.5]`) | 4.9 yd (was 3.5) | 900 (was `maxMs` 1200) | 2150 (unchanged) |
| deepPass | 1700 (was 1250) | `[-2, -6.8]` (was `[-2, -4.2]`) | 7.1 yd (was 4.7) | 1250 (was 1700) | 2950 (unchanged) |

The drop is a template displacement from the QB's alignment, so the set point in the drawing, in yards behind the line, is: intermediate 8.0 under center, 8.7 pistol, 9.7 shotgun and empty; deep 10.1 under center, 10.8 pistol, 11.8 shotgun and empty. Why these values:
- **Speed floor.** A longer drop at the same depth would be a slow walk back. A rest-to-rest leg of length L over the drop plus the 80 ms hitch, with the QB's `accelMs` 450 and `decelMs` 350 ramps, cruises at about L / (drop + 80 − 444 ms). Holding 5 yd/s or more over 1,700 ms needs about 7 yd. Drop peak as measured (below): intermediate 5.6 to 5.9 yd/s, deep 5.5 to 6.3 yd/s, against his top of 8.5.
- **Why not a 900 ms deep hold.** With a 2950 ms window end, a 900 ms hold needs a 2050 ms drop, and at 5 yd/s that is about 8.4 yd: a set point 13.4 yd deep in shotgun. A 1800 ms drop to 7.6 yd (hold 1150) was measured too (peak 5.4 yd/s, set 12.3 yd in shotgun). I chose 1700 and 7.1 yd as the deepest set that still reads as a pocket. Joseph can pick 1800 (Open 1).
- **Leans weak, both classes.** Deep keeps its 2 yd weak lean (DECISIONS.md, "QB throw pace": the held ball stays out of the strong-side back's release). Intermediate gains a 1.5 yd weak lean. Straight back 4.9 yd, the QB passes through the 7 yd alignment of the pistol back, and the 1.5 yd ring pushes the back off his route: with the lean, intermediate completions to RBs within R-C7's bound go from 63.1% today (55.1% straight back) to 100% of 336.
- **Unchanged:** shortPass, screenPass and playAction drops, templates and holds (600, 1100, 1400 ms; 600 ms holds), `throwHold.maxMs` 1200, `hitchMs`, `pocket`, `sit`, `flight`, every route.

QD2. **The plant throw.** R8's earliest throw stays the drop end plus the hitch, E = `dropMs` + `hitchMs`, with one exception, on intermediatePass and deepPass only (amended 2026-11-16 after build: on short passes the plant throw came about 290 ms after the snap and broke A2 and R-C31, so shortPass, screenPass and playAction keep E). When the point the ball is thrown to (the catch point on a completion, the aim point A on an incompletion, the interception point) is nearer the line than the target's drawn track at E, the earliest throw is the start of the QB's plant, P = E − RAMP × `decelMs` (about 390 ms before E). The throw is then max(P, min(arrival − flight, `dropMs` + hold)). No new key: P comes from `hitchMs`, `decelMs` and RAMP. Before the throw the QB is on his own drop leg, from the calls only, so R9, R-C9 and R-C20 are untouched. The ball leaves from where he is on that leg, and the flight is measured from there. After a throw in [P, E) he finishes his stop on the same leg to his drop point, then follows through as today. Why: the longer drop delays E by 300 to 450 ms. On a deep completion with a short gain (2 to 5 yd, caught at the dead spot) the target is then several yards past the catch point at the throw and has to sprint back. Measured over 1,000 games: without this rule, deepPass TEs fall from 95.0% to 92.4% within R-C7's bound and WRs from 96.7% to 95.8%. At a 1600 ms drop, 14 of the 17 new misses were short gains thrown at E. With the rule, P at a 1700 ms drop is 1391 ms against today's E of 1330 ms. Three WR short-gain cases stay over the bound, and the WR share (96.4%) is still above the gate. Real QBs throw on the plant of a deep drop when the outlet is early.

QD3. **The sack waits for the QB's own step up.** The sack spot is the engine's dead spot, so a deeper drop means a longer step up to it (from an 11.8 yd shotgun set to a 7 yd sack, about 4.8 yd). Sack time = max(drop end + `sack.minDelayMs`, the sacker's arrival, `dropMs` + `hitchMs` + the QB's walk from his drop point to the sack spot at his own top speed with his `accelMs` and `decelMs`). (Amended 2026-11-16 after build: the walk starts when his drop leg ends, at `dropMs` + `hitchMs`, not at `dropMs`.) This adds a third term to the rule in "Motion" (amended 2026-11-15) and replaces its "may step up 0.5 yd" wherever the dead spot is nearer the line than the drop point. Measured today on 12 games: one intermediate sack draws the QB at 1.26 × top, and 1.46 × top with the deeper drop. This term holds it at his top.

QD4. **A sack releases the line as a throw does** (amended 2026-11-16 after build). With the longer drop, R-C9's "a sack against a completion" case showed DL1 0.0003 yd apart 20 ms before the read (1230 ms, intermediatePass, shotgun). The cause was not a drop-leg mismatch. A sack released the DLs at its read (`releaseAt` = the drop end), and the natural-motion governor's smoothing reached about 20 ms back from a release into frames before the read. The fix as built: a sack releases the line at the drop end + `release.afterThrowMs`, as a throw does, so unnamed DLs hold their blocks 400 ms longer after the read. The named sacker uses his own departure, unchanged. The sack and the pass still draw the QB's drop from the same legs (`dropLegs()`). R-C9 stays exact, with no tolerance.

### What else changes, measured

Measured on a scratch copy of the working tree (2026-11-16, nothing committed). Holds and drop peaks are from playGame seeds 1 to 12. Shares are from 1,000 games of cached engine events. These are a check on the values, not acceptance numbers.

| Measure | Today | With QD1 | With QD1 and QD2 |
|---|---|---|---|
| intermediatePass hold p50 / p90 | 235 / 1197 ms | 97 / 897 ms | not built |
| deepPass hold p50 / p90 | 1635 / 1700 ms | 954 / 1246 ms | not built |
| deepPass snap to throw, median | 2.86 s | 2.65 s (the deeper release lengthens the flight) | |
| Drop peak, intermediate / deep | 5.7 to 6.2 / 5.3 to 6.2 yd/s | 5.6 to 5.9 / 5.5 to 6.3 yd/s | |
| R-C22 deepPass within 1.15 × top: TE / WR / RB | 95.0 / 96.7 / 94.3% | 92.4 / 95.8 / 94.3% | 94.8 / 96.4 / 94.3% (prototype) |
| R-C7, intermediatePass completions: TE / WR / RB | 99.7 / 100.0 / 63.1% | 99.3 / 99.7 / 100.0% | |
| routes-pace neutral point, R-C23, R-C19, timeline A2 to A4 | pass | pass | |

Two gaps stay open (Open 2 and 3). With QD2 prototyped, deepPass TEs are at 94.8%, one play short of the 95% gate. The rest are three long catch-and-runs (gains 51 to 53) at 1.17 to 1.21 × top: the deeper release lengthens the flight by about 40 ms, so the throw comes earlier and the bend is longer. R-C22 already says what to do with such a miss: tune the route data, never the floor or the bound. deepPass RBs are at 94.3% both before and after this revision. That is a known miss today, not something this revision causes.

Pass rush: unnamed rushers keep their tracks, and the QB is deeper, so at the throw they are farther from him. Sacks draw later (deep: 1700 + 600 + 300 = 2600 ms, up from 2150), which is still short of real time to sack. Play action is unchanged.

### Acceptance criteria (add to R-C1 to R-C24)

| # | Criterion | How it fails |
|---|---|---|
| R-C25 | Hold, intermediatePass and deepPass, measured as in qb-throw-pace.checks.ts (drop end = the first 25 ms sample under 1 yd/s after his peak; hold = throw − drop end; natural motion on, 1x). p90 ≤ 900 ms intermediate and ≤ 1250 ms deep, over playGame seeds 1 to 6 (the fast suite) and the heavy sweep. They replace the two `it.todo` A1 rows in qb-throw-pace.spec.test.ts and qb-throw-pace.heavy.test.ts. The short, screen and play action A1 rows (≤ 600 ms) still pass. | The QB still stands with the ball. |
| R-C26 | Drop speed band. On every intermediatePass and deepPass pass and sack, the QB's peak drawn speed from the snap to the drop end is at least 5.0 yd/s and at most his own top (`mark.nat.top`) at 1x. A4 (at most 1.05 × top from the snap to the throw) still passes. | A walk back, or a sprint back. |
| R-C27 | Window end preserved. In data, `dropMs` + `throwHold.leafMaxMs` is at least 2150 for intermediatePass and at least 2950 for deepPass. routes-pace "an incompletion is aimed at the class's neutral point" and R-C23 pass with no change to the tests. | A route that can no longer reach its depth. |
| R-C28 (amended 2026-11-16 after build) | The plant throw (QD2), intermediatePass and deepPass only. (a) On those classes, a completion to a target whose catch point is nearer the line than his drawn track at E is thrown at max(P, min(arrival − flight, `dropMs` + hold)), never before P. (b) Every other pass is thrown no earlier than E, and every shortPass, screenPass and playAction pass is thrown no earlier than E whatever its catch point. (c) Each of these gives frames identical from the snap to the throw: the same play as a completion, an incompletion and a sack, and a plant throw against the same calls with the throw at E (R-C9 and R-C20, no tolerance). (d) From the throw to his follow-through, the QB never moves away from his drop point and back. | An early throw that leaks, or a jerk at the plant. |
| R-C29 | R-C7 and R-C22 pass at their current bounds over 1,000 games. R-C22 is checked separately for deepPass TEs and RBs, and intermediatePass completions to RBs stay at 95% or more. A miss is a FLAG to tune route data, never the bound, the floor or this revision's holds. Report the shares by class and position in PERF.md. | Sprinting receivers come back. |
| R-C30 | Sacks (QD3, QD4). From the snap to the sack time, the QB peaks at no more than his own top on 100% of intermediatePass and deepPass sacks over 1,000 games, fumble legs excluded. R-C9's "a sack against a completion" passes exactly. The sacker check ("at least 95% of sackers peak at no more than 1.15 × top") is no worse than it is today: the share within 1.15 × group top over every sack in 1,000 games is at least 84.4%, the pre-revision baseline (2,918 of 3,457, measured 2026-11-16; 86.3% after the build). The check's own 95% bound already failed before this revision and is a separate open item. (Amended 2026-11-16 after build.) | A QB sprinting into the sack, or a leak at the read. |
| R-C31 | Play action, short and screen are unchanged: their `dropMs`, QB templates and `leafMaxMs` equal the values before this revision, and their qb-throw-pace A1 and A2 rows pass unchanged. | A side effect on other classes. |
| R-C32 | No engine change: R-C14 holds (no diff under `packages/sim` or `data/engine`). The engine and calibration tests pass unchanged. | Any engine change. |
| G7 | Joseph watches at least 10 deep and 10 intermediate passes at 1x, plus 2 sacks, and says whether the drop reads as a real drop and whether the QB still waits too long. | Not run. |

Existing tests that change (none weakened): routes-pace R-C13 "the Pace table's new values" reads the new `dropMs`; any test that pins `throwHold.leafMaxMs`; card art and preview expectations for the intermediate and deep QB drop. The worked live-time table above is a sanity check, not a gate.

### Open (QD-Open)

1. **Deep depth (Joseph).** I recommend 1700 ms to 7.1 yd with a 1250 ms hold. The alternative is 1800 ms to 7.6 yd with a 1150 ms hold, which sets 12.3 yd deep in shotgun. A hold under 1 s on deep shots needs a drop of more than 8 yd, or a shorter window end, which R-C23 rules out until the deep back routes change.
2. **R-C22 for deepPass TEs (engineer, then Joseph if route tuning can't close it).** With QD2 prototyped the share is 94.8% against a 95% gate. The fix R-C22 names is route data.
3. **deepPass RBs at 94.3%** are a miss today, unchanged by this revision. It is listed so nobody charges it to the deeper drop.
4. **Schema:** none. QD1 changes values in existing keys, and QD2 to QD4 add no key.

## Revision 2026-11-15: natural motion

Status: draft, for build after the lead confirms NM-Open 1 and 2. Amends "Motion" (contract 4, "Acceleration and deceleration", "Blocks engaging and holding", "The settle") and the 2026-11-14 revision where they conflict. Every value here is **designed, not fitted**, and none of it is derived from tracking data.

### Problem

Joseph, twice: "make the movement of the players more natural, it's still so stiff."

The lead probed the COMPLETE, RUN and SACK fixtures (speed in yd/s every 50 ms, `packages/app/test/zz-motion-probe.test.ts`). I traced each finding to code:

1. **Clones.** Players at the same position have identical speed curves (RUN: CB1, CB2 and CB3 sample for sample; SACK: LB1 = LB2, DL1 = DL4; OL1 to OL5 nearly identical). Cause: one `speed`, `accelMs` and `reactionMs` per group, and a start offset of `i % 3` × 15 ms that repeats every third slot.
2. **Cruise control.** WR, CB and S hold exactly 10.5 or 10.0 for 2 s or more. Cause: `pursue()` and `follow()` clamp to top speed and hold it, and `cruise()` holds `continuePace` × top.
3. **Pops of 15 to 38 yd/s** for one sample (COMPLETE: LB1 36.3, LB2 38.5, WR3 14.9; RUN: DL3 15.9). Sources I can see in the code, for the engineer or debugger to confirm with the probe before fixing:
   - `drive()` with `restStart: false` starts at the leg's mean speed whatever the incoming speed was (converge run, timeline.ts 1175; `toCatch` bend, 1472; `tacklerRun`, 1629).
   - `ringFix` radial push: a mark inside the ring jumps out to it, turning up to 45 degrees per key. The LB pops on a short pass fit a ball in flight passing over the linebackers.
   - `settle()`: a defender who would end inside the ring is placed on it in one key (motion.ts 366 to 370).
   - `follow()` lock (stalk): on contact he takes the defender's velocity in one key.
4. **Abrupt drops (9 to 3.5, 10 to 1 in 100 ms).** `driftSamples()` is hyperbolic. From v0 = 9.45 yd/s with L = 1 yd its first deceleration is 2·v0²/L, about 180 yd/s². Every `sit` and `block` finish, the end of every pause and the lineman engagement start this way.
5. **Statue line.** The same hyperbola makes engaged linemen creep at 0.1 to 0.3 yd/s, "still" on about 30 of 75 samples on a pass. DL hold a flat 5.0 in pursuit.

### User and what the viewer reads first

Same user: Joseph and players like him, watching the all-22 view at 1x. Assumption that carries this revision: **"stiff" means machine regularity (identical twins, perfect cruise, instant speed changes, frozen linemen), not missing body detail.** Test: G5 below. If Joseph still says "stiff", ask which player and which moment, and log it.

Reading order stays: the ball, then the carrier and the man closing on him, then routes and coverage, then the line. So the new secondary motion (wobble, sway, hand fight) is kept small enough that it never outranks the ball. The sway and push amplitudes (0.2 to 0.3 yd, about 3 to 4 px at 13.3 px per yard) are under the carrier ring's 6 px offset.

### Decisions

NM1. **One motion governor shapes every mark's keys, after the existing builders.** A new pure function in motion.ts takes a mark's raw keys (what timeline builds today), his limits and his anchors. It returns keys on the same 25 ms grid that track the raw path under four limits:
- speed-up at most top / `accelMs`;
- slow-down at most top / `decelMs`;
- lateral acceleration at most `natural.govern.lateralAccel`, raised to `breakLateralAccel` inside designed break and cut arcs (the fillet arcs, flagged by the builder), so plants and cuts keep their shape;
- the change in acceleration spread over at least `jerkMs`, so there is no flip from full speed-up to full braking in one key.

Why: the measured problems sit at about 15 seams across many builders. A single shaping pass fixes all of them and every seam a later builder adds, and its output is what is drawn and tested (decision 8). Rejected: fixing each builder only. Plateaus and clones would remain, and each new builder would bring new seams. Rejected: easing in the animator, because decision 8 forbids it. Rejected: two-sided smoothing (a centered filter over the keys). It moves anchors, and it pulls post-read motion into pre-read frames, which breaks R-C9 and P3. Final.

NM2. **The governor is causal.** Its output at t depends on raw keys up to t + `lookaheadMs` (25 ms, one key) and on anchors, never beyond a mark's **departure**. A mark departs when he leaves his unnamed track: the read plus his reaction for a pursuer, the throw for the target, `conv.read` for a converging defender, the read for the tackler. Call-only anchors (the snap, the mesh, the drop end) may be looked ahead to at any time. Result anchors (catch, tackle, sack, end spot) may only be looked ahead to from keys at or after the departure. Why: a named player is then exactly his unnamed self until he departs, so R-C7, R-C9 and R-C20 hold by construction. Final.

NM3. **Anchors are met by a blend, not a jump (decision 10 kept).** Over the last `anchorBlendMs` before each anchor, the governed offset from raw is blended to zero with smoothstep. The window starts no earlier than the mark's departure. At the anchor, time and place are exact. A leg whose anchors need a mean speed above 1.15 × top is **anchor-demanded**: the speed may rise as far as the anchor needs (the existing "speed rises with no cap" rule), with the limits in N1 and N2. The ball in a hold rides the holder's final keys, so "the engine's holder has the ball" holds on what is drawn. Build order (facts and holders, then the ball, then everyone else) is the engineer's call. Final.

NM4. **Per-player variation, deterministic, from the hash of the player id (amends contract 4).** For each mark, u = FNV-1a 32-bit of `${playerId}|${salt}` divided by 2^32. With no player id, the slot is used. The variation is **stratified within a group**: same side, same position, ranked by u, then r of n maps to −1 + 2r/(n − 1) (2u − 1 when n = 1). So no two marks in a group ever get the same value. It applies to:
- top speed × (1 + `spread.topShare` × s);
- `accelMs` × (1 + `spread.accelShare` × s′);
- `reactionMs` + `spread.reactionMs` × s″;
- start + `spread.startMs` × s‴, clamped to 0 or later, with the QB and the snapper exempt because the snap is an anchor.

Each uses its own salt. The variation comes only from the id and the on-field set, both known before the snap, never from calls, target or result. It never changes a route shape, a choice or a card (decision 3, R1). Everything that reads `speed`, `accelMs` or `reactionMs` (R8's throw timing, the pursuit start, the stalk bound) uses the mark's own value. Why stratified: a plain hash can give two corners nearly the same value by chance, which is a clone again. Rejected: seeded randomness, because contract 4 forbids it and it can't be reproduced in tests. Rejected: rating-scaled speed, because decision 12 stands. ±3% is about 0.3 yd/s, which I assume nobody can rank by eye (NM-Open 3). Final in structure, values open.

NM5. **No cruise plateau.** On cruise stretches only, the governor plays the raw track through a time warp τ′(t) = 1 + `wobble.share` × sin(2πt / P + φ). P is between `periodMinMs` and `periodMaxMs`, and P and φ come from the mark's hash. The path is unchanged (a warp keeps its shape) and the position offset stays under about 0.06 yd. The warp fades to zero inside plants, arcs, re-accelerations and anchor blends, so R-C6's monotone plant still holds. Pursuit and follow run on top of it. Why: speed that breathes reads as a runner. A clamp at exactly top reads as a machine. Rejected: random noise per key, which flickers. Final in structure, values open.

NM6. **Seams carry velocity at the source as well.** The governor must not hide a broken builder, which is why N6 caps its offset from raw. The engineer fixes these sources:
- `drive()` with `restStart: false` starts at the incoming velocity and ramps within limits;
- the `follow()` lock blends to the defender's velocity over `govern.jerkMs`;
- the `ringFix` and `settle` ring pushes become a repulsion that starts at ring + 0.5 yd, applied inside the governor's step, so a mark slides along the ring instead of jumping onto it;
- `driftSamples` is replaced by an eased stop: deceleration within `decelMs`, then the idle sway (NM7).

The contract 3 ring itself stays a hard rule (see NM-Open 1 for the ball in flight). Final.

NM7. **Nobody is a statue, and nobody is drawn winning.**
- **Engaged linemen (amends "Blocks engaging and holding").** The pocket set or run drift is eased (smoothstep over the time it takes at `pocket.pace` or `sit.pace`), not hyperbolic. On top of it, the pair gets a hand fight: a push and give along the pair's axis of amplitude `line.pushYards`, and a lateral shuffle of `line.shuffleYards`. Each is a sum of two sines with periods between `periodMinMs` and `periodMaxMs`, from the OL's hash, ramped in over `rampMs` from contact. Both men in a pair (as M6 pairs them) get the same offset, so contact holds and the fight averages to zero: nobody wins. An unpaired lineman uses his own hash. At the DL release he leaves with his current velocity.
- **Idle sway.** When a sit, block or zone finish, or a pursuer braking at the ring, falls below `idle.minYps`, he sways at `idle.swayYards` over a hash period between `idle.periodMinMs` and `idle.periodMaxMs`. Within ring + 1 yd of the ball he sways along the ring, never into it.

Rejected: a relative push between the OL and the DL, which implies a winner. Rejected: rendering facing ticks, stride bob or limbs. DESIGN.md keeps marks as X's and O's with no bounce, and speed, arcs and timing carry "natural" on their own. Final.

NM8. **The settle eases from the whistle speed.** Speed never rises in the settle and reaches 0.2 yd/s or less at its end. A defender comes to rest on the ring by decelerating into it, not by a placement. The sway amplitude fades to 0 over the settle, so the final frame (reduced motion, skip) is still. Final.

### New `data/ui/motion.json` keys (designed starting values; schema change, NM-Open 2)

```json
"natural": {
  "spread": { "topShare": 0.03, "accelShare": 0.12, "reactionMs": 50, "startMs": 20 },
  "wobble": { "share": 0.04, "periodMinMs": 700, "periodMaxMs": 1100 },
  "govern": { "lateralAccel": 14, "breakLateralAccel": 35, "jerkMs": 100, "lookaheadMs": 25, "maxOffYards": 0.5, "anchorBlendMs": 200 },
  "line": { "pushYards": 0.2, "shuffleYards": 0.25, "periodMinMs": 450, "periodMaxMs": 900, "rampMs": 200 },
  "idle": { "swayYards": 0.3, "minYps": 0.5, "periodMinMs": 900, "periodMaxMs": 1500, "rampMs": 250 },
  "flightRingYards": 1.0
}
```

Units: yd/s² for the accelerations, yards, and ms on the timeline clock. Under uniform live scaling (factor k), speeds and accelerations scale with top / k as today. Wobble and sway periods do not scale. The lateral acceleration values are designed, not looked up: [gap: primary source for NFL player lateral and braking acceleration]. `parseMotion` validates every key, rejects min > max, and rejects shares outside [0, 0.2].

The acceptance multipliers below (1.15, 1.25, 1.5, 0.02, 0.3) are **test constants in this spec, not data**. Why: tuning data must never be able to loosen its own acceptance test.

### States

| State | Behaviour |
|---|---|
| Normal scrimmage play | NM1 to NM8. |
| Kicks and returns | The same. Kick lanes stay straight (R-Open 4), but they breathe and vary. |
| Anchor-demanded leg (a far tackler, a hurried target) | He speeds up as needed, within N1 and N2's exemption. The leg is listed in the test output. |
| Governor can't meet a limit without breaking an anchor | The anchor wins. A warning naming the mark and time goes into `tl.warnings`. The tests fail on any such warning in ALL_FIXTURES. |
| Sacked QB and his sacker after the sack, holder and tackler in the last `convergeMs` | At rest is correct. Exempt from N5. |
| No play, kneel, spike | Nobody sways. Exempt from N4 and N5. |
| 2x | The same keys at double rate (unchanged). |
| Reduced motion, skip | The final post-settle frame, which is still (NM8). |
| Live time clamped | NM rules apply on the scaled clock (see Units). |
| Motion data invalid | The existing "Game data failed its check: data/ui/motion.json". |
| Loading, permission denied | Not applicable: a pure function with no I/O. |
| Test hook `ctx.natural = false` | The raw keys, used only by N6 and for A/B in playtest. |

Model output: the motion between anchors is a display guess. The variation carries no information, since it is independent of calls, target and result (N7). If a drawing contradicts the record, that is a bug and the record wins. Accessibility: nothing new is carried by motion alone, there is no flashing, and reduced motion is unchanged.

### Acceptance criteria (N1 to N7, over every event in ALL_FIXTURES at 1x)

**Measurement, shared by all seven.**
- Sample p_i = at(keys, snapAt + 25i) up to liveEnd + settleMs.
- Speed: v_i = |p_{i+1} − p_{i−1}| / 0.05 s.
- Tangential acceleration: a_i = (v_{i+1} − v_{i−1}) / 0.05 s.
- Lateral acceleration: v_i × the heading change of (p_{i+1} − p_{i−1}) per 0.05 s, measured where v_i ≥ 1 yd/s.
- `top`, `accelMs` and `reactionMs` are the mark's own values (NM4), with top divided by k.
- The ball is not a mark. Pre-snap motion is out of scope.

| # | Criterion | How it fails |
|---|---|---|
| N1 | **No teleports.** For every mark at every key, v_i ≤ 1.15 × top. On an anchor-demanded leg (NM3), v_i ≤ 1.25 × the leg's required mean speed. | A pop (today: LB2 38.5 on COMPLETE). |
| N2 | **Continuous velocity.**<br>- Speed-up: a_i ≤ 1.25 × top / `accelMs`.<br>- Slow-down: −a_i ≤ 1.25 × top / `decelMs`.<br>- Lateral: ≤ 1.25 × `lateralAccel`, or × `breakLateralAccel` inside flagged break and cut arcs.<br>- Jerk: \|a_{i+1} − a_i\| ≤ 2 × (top / `accelMs`) × 25 / `jerkMs`.<br>On anchor-demanded legs every limit is × 1.5. | An abrupt drop (10 to 1 in 100 ms), or a snap turn. |
| N3 | **No clones.** For every pair of marks on one side at one position, over the keys where both have v ≥ 1 yd/s (pairs with under 400 ms in common are skipped), the RMS of their speed difference is at least 0.2 yd/s. | CB1 = CB2 = CB3 on RUN. |
| N4 | **No cruise plateau.** In every 500 ms window where a mark's v stays above 0.5 × top, max v − min v ≥ 0.02 × top. | A flat 10.5 for 2 s. |
| N5 | **Never frozen.**<br>- Every mark not exempt under States has v ≥ 0.3 yd/s on at least 95% of keys from his start to the whistle.<br>- Engaged linemen, from engage end to the release or the whistle: v ≥ 0.4 yd/s on at least 90% of keys, with mean v between 0.8 and 3.0 yd/s.<br>- M6 contact holds.<br>- Each pair's mean offset along its axis is within 0.15 yd of the designed drift, so nobody wins. | Statue OL (30 of 75 still), or a lineman drawn winning. |
| N6 | **Anchors exact, governor honest, settle eased.**<br>- Every fact anchor is at its time and place within 1e-6 yd (decision 10).<br>- At every key, \|governed − raw\| ≤ `maxOffYards`, where raw is from `ctx.natural = false`.<br>- In the settle, v_i ≤ v_{i−1} + 0.05 yd/s, and v ≤ 0.2 yd/s at its end.<br>- Contract 3's ring holds at every key (as amended by NM-Open 1).<br>- No `tl.warnings` entry from the governor. | A missed anchor, a governor masking a broken builder, or a settle jerk. |
| N7 | **Deterministic, no leak, in budget.**<br>- Two runs of the same input give identical keys.<br>- For every mark, the NM4 values are unchanged when only target, result or end spot change.<br>- R-C7, R-C9, R-C19 and R-C20 pass with natural motion on.<br>- R-C15 holds: `timeline()` at 20 ms or less, median and p95 over 1,000 plays, reported in PERF.md. | Nondeterminism, a pre-read leak, or over budget. |

Also run N1 to N5 over 1,000 simulated plays in the heavy suite, and report the worst value and the share of passing marks in PERF.md. No pass bar is set there until the fixtures pass.

Existing tests that change, none weakened:
- Every "top" in M2, R-C5, R-C6, R-C7, R-C8 and R-C10 becomes the mark's own top.
- R-C5's "speed above 0" window is unaffected, because sway only raises speed.
- R-C6 is unchanged, because the wobble fades out in plants (NM5).
- R-C7's "template track" is the governed template track, built through the same pipeline.
- The probe file `zz-motion-probe.test.ts` is replaced by these tests. It is not shipped.

Playtest gate **G5**: Joseph watches 20 or more plays at 1x (runs, each pass class, a sack, a kick), first with `ctx.natural` off and then on, and says whether the stiffness is gone. Every named moment goes in the playtest log.

For art-director: DESIGN.md "Motion" still says "straight segments with easing only at start and stop". It needs a line for breathing speed, the hand fight and the sway. This file doesn't change DESIGN.md.

### Final and open

Final: NM1 to NM3 and NM6 to NM8 in structure. Open for values: everything in `natural`.

NM-Open:
1. **The ring for a ball in flight (lead; this amends contract 3, which is Final).** Physically, a defender can't clear 2.5 yd of a short pass's flight line within his limits when the ball passes him about 150 ms after the throw. My recommendation: while the ball is in the air, the ring is `flightRingYards` (1.0 yd). A pass 1 yd from a linebacker is a tight-window throw, not an implied breakup. Held or loose balls keep 2.5 yd and the carrier's corridor. If rejected, N1 and N2 get an exemption for ring slides during flight, and the count is reported in PERF.md.
2. **Schema change (Joseph, ask first):** `motion.json` gets the required `natural` block, version 2 to 3, and `parseMotion` changes.
3. **The ±3% speed spread against decision 12.** Ask in G5 whether any mark looks faster than its rating would justify. If yes, the next step is `topShare` 0.015, not removing the spread.
4. **Source of the pops.** NM6's list comes from reading the code. The debugger or engineer confirms each one with the probe before the fix, and adds any source I missed to that list.

Settled (Joseph, 2026-11-15; docs/DECISIONS.md, "Natural motion: open items settled"):
1. Approved: while the pass is in the air the ring is `flightRingYards`, 1.0 yd. This amends contract 3 for ball flight only. Held and loose balls keep 2.5 yd and the corridor.
2. Approved: `motion.json` goes to version 3 with the required `natural` block, and `parseMotion` changes with it.
3. The ±3% speed spread stays. Playtest G5 checks it.
4. Each pop source is confirmed with the probe before it is fixed. Engineer's findings, 2026-11-15: confirmed `drive()` with `restStart: false` starting at the leg's mean speed (a receiver who caught the ball standing went from 0 to 9.8 yd/s in one key on COMPLETE), confirmed the ring push with a ball in flight (on COMPLETE the pass passes 0.75 yd from OL5 and 0.23 yd from WR3, and both pop to 20 to 30 yd/s; the linebacker pops on COMPLETE are the same cause), and confirmed the hyperbolic `driftSamples` (the statue line and the abrupt drops). The `settle()` placement and the `follow()` lock were not isolated with the probe. Sources added: the QB's short drop (1.5 yd from rest to rest in 600 ms) is beyond his own limits; a target who sits near the catch point and leaves late needs 0 to 19 yd/s in 300 ms; pursuit's 180 degrees per second turn is about 31 yd/s² of lateral acceleration at 10 yd/s; the tackler's run starts with an instant change of heading; a carry from rest leaves too little time for smooth ramps, so the carrier cruises at 1.14 to 1.22 times his top.

## Amended (Joseph, 2026-11-15): kickoff return pass (KR1 to KR9)

**Problem.** Joseph's playtest: "on the kickoff return the blockers wait and get BEHIND the returner. that's bad. also the returner always goes straight." Today the return unit runs its `drops.return` step, stands through the hang, then pursues the ball like defenders, so it trails the returner. The returner runs one straight line from the landing spot to the dead spot.

**User.** Joseph, and any player watching a kickoff at 1x. What he should see: blockers who set up a wall during the hang and lead the return, and a returner who starts upfield and cuts.

**Overrides, for kickoffs only.** This replaces R-Open 4, the R11 "Not done" line "No change to kick coverage or return lanes", and the natural-motion States row "Kick lanes stay straight". On a kickoff return the return unit are the carrier's teammates, not diagram defenders. Contract 3's corridor does not apply to them. The 2.5 yd ring (and A3's check on side X) still does. Punts, onside kicks, touchbacks, fair catches and kicks out of bounds are unchanged.

**Frame and terms.** Kicking team's frame: the kick goes up the screen, and the return comes back down (decreasing y). *Catch* = `plan.read` (the ball lands with the returner). *Blockers* = unnamed return-unit marks: side X, not the returner, a fouler or a fumble recoverer. *Coverage* = unnamed kicking-team marks, not the kicker or the engine's tackler. *Behind by b* = blocker.y − carrier.y. *Return length* = landing y − dead spot y.

**Decisions (designed, display only).** The engine still decides the dead spot yard line, the returner, the tackler and the outcome. The animation decides only the lateral path, the wall and the blocks. The returner cuts toward the side where more of his blockers are engaged (settled, KR-Open 3). He counts them on the marks' own drawn positions at the moment of the cut. A tie is broken by a hash of ids the timeline already has (as in the NM4 spread). The cut never comes from randomness or from the tackler. On kickoff returns, the kicking team's unnamed coverage also keeps out of the carrier's corridor (settled, KR-Open 2; KR9). New tuning values go in a new `motion.json` block `kickReturn`, not inside `kickoff`, so `routes-pace.spec.test.ts` line 1519 (the `motion.kickoff` deep-equal) stays as it is. Per-slot lane order, if it lives in data, goes in `templates.json`. Both are validated by `parseMotion` and `parseTemplates`. Starting values for the engineer to tune: wall depth, lane spread, engage distance, behind tolerance, whistle window, upfield yards, cut size, cut minimum return.

### Acceptance criteria (KR1 to KR9)

These run headless on the Timeline from `timeline()` at 1x. Fixtures: KICKOFF_RETURN plus new fixtures for a return of 40 yd or more, a return shorter than `kickReturn.cutMinReturnYards`, and a return fumble. The heavy suite also runs 1,000 simulated kickoff returns: each KR criterion must pass on 100% of fixtures and on at least 95% of simulated returns, with the share reported in PERF.md. The test floors named below are test constants, so the data can't loosen its own test (as in NM).

| # | Criterion | How it fails |
|---|---|---|
| KR1 | **Facts unchanged.** A2, A3 (the ring), the anchors (N6: ball at the dead spot y at the whistle, tackler at the ball, returner holding it), `kickoffFrame` = timeline at t = 0 (usability-pass AC 11), A1 determinism, and N1 to N7 all pass on every kickoff fixture. | A moved anchor, a mark at t = 0 off the frame, a pop. |
| KR2 | **Setup during the hang.** From the kick to the catch, every blocker whose set spot is more than `kickReturn.wallDepthYards` short of the landing spot gains at least `kickReturn.setupYards` toward it in y (test floor: 3 yd). No blocker is still (v under 0.3 yd/s) for more than 300 ms of the hang. | Blockers standing through the hang (today). |
| KR3 | **Wall at the catch.** At the catch, no blocker is behind the returner by more than `kickReturn.behindToleranceYards` (test floor: at most 1.0 yd). The blockers' x positions span at least `kickReturn.laneSpreadYards` (test floor: at least 20 yd). | A bunch in the middle, or a blocker behind the returner. |
| KR4 | **Lead the return.** At every 25 ms key from the catch to the whistle minus `kickReturn.whistleWindowMs` (test floor: at most 500 ms), every blocker is either behind the carrier by at most `behindToleranceYards`, or engaged. *Engaged* means within `kickReturn.engageYards` of a coverage mark (test floor: at most 2.0 yd) in a contact that began at a key where he wasn't behind. A block the returner has run past counts; a blocker who chases him from behind doesn't. | A blocker who trails the returner (Joseph's note). |
| KR5 | **Blocks happen.** On returns of at least `cutMinReturnYards`, at least half of the blockers are engaged for 300 ms or more before the whistle, each with a different coverage mark. The engine's tackler is never engaged. While engaged, the pair holds contact and neither is drawn winning (the N5 rule for linemen). | Blockers drifting past coverage, or a block on the tackler that implies a shed. |
| KR6 | **The returner cuts.** On returns of at least `cutMinReturnYards`, the returner runs within 20 degrees of straight upfield for the first `kickReturn.upfieldYards` after the catch, then makes at least one heading change of 25 degrees or more (each heading measured over 300 ms, before and after). His x at some point differs from his catch x by at least `kickReturn.cutYards` (test floor: at least 4 yd). Cut arcs are flagged and meet N2's `breakLateralAccel`. He stays at least `sidelineMarginYards` inside both sidelines unless the engine ends the play out of bounds. | A straight vertical return (today). |
| KR7 | **He cuts toward the blocks, deterministically, with no leak.** Two builds of the same event give identical keys. Two events that differ only in the dead spot, the tackler or the result give identical returner and blocker positions from the kick to the catch. At his first KR6 heading change, the sign of his new heading's x points to the side (left or right of his own x) with more blockers engaged (as KR4 defines it) at that key. On a tie, it points to the id hash's side. Over the simulated returns, each cut direction (left, right) is at least 30% of returns. | A cut away from the blocks, the same side every time, or a pre-catch wall that knows the result. |
| KR8 | **Unchanged where there is no return.** For touchbacks, fair catches, kicks out of bounds, onside kicks and every punt, keys are identical to the build before this pass. A return shorter than `cutMinReturnYards` doesn't need to cut (KR6 is exempt) but keeps KR2 to KR4. A return fumble: KR4 and KR6 run up to the fumble. After it, the existing R9 recovery rules apply. | A changed punt or touchback, or a fumble path broken. |
| KR9 | **Coverage keeps out of the carrier's corridor.** From the catch to the whistle (to the fumble on a return fumble), at every 25 ms key, every coverage mark keeps at least `pursuit.corridorHalfYards` from the carrier's drawn path over [t, t + `pursuit.corridorMs`], cut off at the whistle. Engaged coverage counts too. This is the same corridor side X keeps on scrimmage plays (test floor: at least 2.0 yd and 1,000 ms, the contract 3 values). Only the engine's tackler comes to the ball. | Coverage swarming the returner before the tackler gets there. |

**States that are reachable.**
- A long return or a return touchdown: live time may exceed the 7.0 s cap. Uniform scaling applies as it does today, and KR runs on the scaled clock.
- A foul on the return: the fouler is named and exempt from KR2 to KR5.
- The returner set deep (RB1, WR1 at los + 60) against one set short (S1, as in the fixture): KR2's depth exemption covers the deep men.
- Invalid `kickReturn` data: the existing "Game data failed its check: data/ui/motion.json". R-C13's malformed-file case gains the new keys.

**Existing tests.** No test pins straight kick lanes. I checked `timeline.test.ts`, `routes-pace.spec.test.ts`, `natural-motion.spec.test.ts`, `usability-pass*.spec.test.ts` and `art.test.ts`. Tests that constrain this pass, and that stay unweakened:
- `routes-pace.spec.test.ts` 1519, the `motion.kickoff` deep-equal. It is the reason the new keys get their own block.
- `timeline.test.ts` A3, the ring on side X. It still applies to blockers.
- `usability-pass.spec.test.ts` AC 11, the frame at t = 0.
- N3, no clones. Convoy blockers at one position must still differ.
`zz-nm-dbg7.test.ts` is a probe with no assertions.

**Locked:** the engine facts, KR1, and punts out of scope. **Likely to change:** every `kickReturn` value, and the 25-degree and 300 ms constants in KR6, after playtest.

**Playtest gate G6.** Joseph watches 10 or more kickoff returns at 1x, including one long return, and says whether the blockers lead and the returner cuts.

### KR-Open: resolved (Joseph, 2026-11-15; docs/DECISIONS.md, "Kickoff return pass: open items settled")
1. Schema change approved: `motion.json` goes to version 4 with a required `kickReturn` block, and `parseMotion` validates it. Per-slot lanes in `templates.json`, if used, need the same approval.
2. Yes: on kickoff returns, the kicking team's unnamed coverage keeps out of the same 2 yd carrier corridor that side X keeps on scrimmage plays (KR9).
3. Toward the blocks: the returner cuts to the side with more of his blockers engaged, and the id hash breaks a tie (KR7). Each direction stays at least 30% of returns, because both units line up close to mirrored (the return unit exactly, the kick unit within a slot), so a bias to one side is still a bug.
