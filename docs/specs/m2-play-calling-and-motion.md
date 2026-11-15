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
| `dropMs` short, intermediate, deep, screen, play action | 450, 700, 900, 800, 950 | 600, 950, 1250, 1100, 1400 |
| `handoffMs` | 380 | 550 |
| `flight` baseMs, perYardMs, minMs, maxMs | 220, 14, 300, 1000 | 250, 22, 350, 1500 |
| `live` minMs, maxMs | 1500, 4000 | 1800, 7000 |
| `startMs`, `maxStartMs` 150, `snapMs`, kicks, `preSnap`, `settleMs`, holds | | unchanged |

New keys:
- `routePace` 0.9, `continuePace` 0.75
- `fillet.roundPace` 0.8, `fillet.sharpPace` 0.45, `fillet.plantYards` 1.2, `fillet.reaccelYards` 2.0
- `sit` {pace 0.25, maxYards 1.0}
- `throwHold.maxMs` 1200
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
| Sack, intermediate | 950 + 600 + 300 = 1850 |
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
| R-C13 | `motion.json` holds the values in the Pace table. `parseMotion` and `parseTemplates` reject a malformed route object, waypoint object, `readStep`, `mesh` or any new motion key (extends the layout.test "malformed file" case). | Missing validation. |
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
