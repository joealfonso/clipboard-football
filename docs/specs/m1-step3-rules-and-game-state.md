# M1 step 3: rules and game state

Status: draft, 2026-11-11. Owner: Joseph.

## Goal

Build a pure game state machine in packages/sim that takes the result of each play and returns the next game state under current NFL rules, with every rule number kept in a validated data file and every rule cited from the official NFL rulebook.

For: Joseph, and the agents building step 4 (`resolvePlay`, which produces PlayResults) and step 5 (the full-game loop, soak and calibration). Step 5 needs a machine it can trust to keep score, run the clock and end the game, so that any calibration miss is the play engine's fault and not the bookkeeping's.

In plain words: the play engine says what happened on a play (gained 7, ran out of bounds, 6 seconds used). This step works out what that means: new down and distance, where the ball is, whether the clock keeps running, whether someone scored, who kicks off, whether the half or game is over.

## Non-goals (out of scope)

- Play outcome models, the matchup table, `resolvePlay`. Step 4.
- Which penalties occur and how often. Step 4. This step only enforces a penalty that a PlayResult reports.
- Kickoff, punt and field goal outcome rates (touchback rate, return yards, make rate). Kickoff rates are designed and tuned to 2025 in step 4 (DECISIONS.md, "Kickoffs are designed, tuned to 2025"). This step only defines the legal mechanics and the spots.
- Injuries, including injury timeouts and injury clock run-off.
- Challenges and replay review. Noted for later: the CLAUDE.md open issue "challenges as a second interruption" stays open and is not touched here.
- AI decisions: when to call a timeout, hurry-up or slow tempo, onside or not, receive or defer, accept or decline a penalty (beyond the placeholder default below). Step 5 or M3. This step provides only the legal mechanics and the inputs those decisions will feed.
- UI, the season, standings and tiebreakers (M4), playoff seeding.
- The full-game loop that calls the callers and `resolvePlay` in turn, and calibration. Step 5. This step's tests drive the machine with hand-written and randomly generated PlayResults.
- Home field effects.
- Any change to the step 2 Situation type beyond what is needed to fill it. If a field is missing, raise it; do not reshape it.

## Dependencies allowed

Nothing new. zod (already in packages/shared) validates the rule set. packages/sim still imports no zod and has no runtime dependencies; it receives an already-validated rule set, as in step 2. A property-testing library (for example fast-check) is a new dependency and needs Joseph's approval first (open question 6). Without it, tests generate random PlayResults with the project's own Rng.

## Locked decisions

1. The machine is pure. Same rule set, same seed and the same sequence of inputs give deep-equal states. No DOM, no `Math.random`, no clock reads, no imports outside sim and the type-only shared files. The existing purity and import tests cover the new files.
2. The only randomness is the coin toss (opening and each overtime period), drawn from the seeded Rng passed to the new-game and overtime transitions. Every other transition takes no Rng. The game's seed is stored in the state, so it is logged with every game.
3. `resolvePlay` decides what physically happened. The machine applies rules to it and decides nothing about outcomes. It never draws a random number to settle a play.
4. Every rule number lives in the rule set file (below). Code holds no rule numbers: no 900, 120, 3, 35, 25, 10, 15, 2 or 6 as rule values. A rule change is a data edit.
5. GameState is plain JSON-serializable data (no classes, functions, Maps or Dates), so a later save can store it and resume.
6. The machine produces the step 2 `Situation` itself. Callers never see GameState.
7. Rules come only from primary sources: the current official NFL rulebook on operations.nfl.com (2026 season if published, otherwise 2025) and NFL Football Operations rule-change announcements. Not memory, not Wikipedia, not news sites.

## Rule set (data)

### File and schema

- One file per rule edition, for example `data/rules/nfl-2026.json`, validated by a zod schema in packages/shared. It records the season it applies to and the rulebook edition it was checked against.
- The machine takes the parsed rule set as an argument. GameState records the rule set's id and a hash of its bytes, so a saved game knows which rules it ran under.
- Fixture rule sets for tests live with the tests. They change values (quarter length, touchback spots, timeouts, overtime format) to prove behavior follows the data.

### What it must hold

The schema covers at least the groups below. Exact keys are the engineer's call. No value is listed here on purpose: the engineer looks every one up.

| Group | Contents |
| --- | --- |
| Game structure | Quarter length, number of regulation quarters, which quarters end a half, halftime handling (possession resets to a kickoff). |
| Downs | Downs per series, yards for a first down. |
| Scoring | Points for touchdown, field goal, safety, extra point kick, two-point conversion, and a defensive score on a try. |
| Tries | Spot for an extra point kick, spot for a two-point try, whether the try is skipped when a touchdown ends regulation or overtime (and under what condition), what happens after a try (who kicks off). |
| Kickoffs | Kickoff spot, kickoff spot after a safety (and whether a punt is allowed on that free kick), landing zone bounds, the spot for each kickoff end state (touchback from the end zone, ball that lands in the landing zone then reaches the end zone, kick short of the landing zone, out of bounds), whether fair catch is allowed and where it puts the ball, and the onside kick rules (when an onside kick is legal, whether it must be declared, any limit on how many). Must match the dynamic kickoff (2024) as amended in 2025 and any 2026 change. |
| Punts | Touchback spot, what a punt that goes out of bounds or is downed means, fair catch. |
| Field goals | Spot after a missed field goal (spot of kick or a minimum spot), touchback rules for a miss into the end zone. |
| Turnovers and touchbacks | Touchback spot after an interception or fumble downed in or out of the defense's own end zone, and the safety and touchback rules for a ball dead in an end zone. |
| Clock | Which events stop the game clock, and when a stopped clock restarts (on the snap or on the ready-for-play signal), including the out-of-bounds rule and the time windows where it differs (for example late in each half). Play clock lengths, and which one applies after which kind of stop, only as far as they bound pre-snap run-off. Two-minute warning (time and which periods). Ten-second run-off: which fouls or stoppages trigger it, in which windows, and how a timeout avoids it. Untimed down: when a period cannot end on a play (for example an accepted defensive foul). |
| Timeouts | Per team per half, per overtime period or overtime, whether unused ones carry over, any limit on consecutive timeouts. |
| Overtime | Regular season and postseason each: period length, number of periods (or unlimited), timeouts, two-minute warning, coin toss, which scores end the game on the first possession (offensive touchdown, field goal, defensive score), whether both teams are guaranteed a possession, sudden death after that, whether the game can end tied, and what counts as a possession. |
| Penalties | The penalty table (below). |

### Penalty table

Each entry: id, yards, enforcement spot (previous spot, spot of foul, end of run, succeeding spot, dead-ball), automatic first down, loss of down, whether it can be declined, whether half-the-distance applies, whether it triggers the ten-second run-off, and which side can commit it. The table holds enough real penalties to exercise every mechanic in milestone D (at least: false start, offside or encroachment, offensive holding, defensive holding, defensive pass interference, intentional grounding, roughing the passer, delay of game, a dead-ball personal foul, a foul by the return team on a kick). Step 4 may add penalties; each new one is a data edit plus a RULES.md row.

### Citations (docs/RULES.md)

RULES.md gets one row for every leaf value in the rule set file: key path, value, the rule in plain words, rule and section number (for example "Rule 4, Section 3, Article 2"), source URL, season, date checked, and status.

Status is one of:

- `confirmed`: read on operations.nfl.com in the current rulebook or an NFL Football Operations rule-change page, with the exact rule and section.
- `unconfirmed`: no primary source found yet. The value is used but flagged, and listed in the report back to Joseph.
- `designed`: a deliberate simplification the game makes (listed under "Designed simplifications" below). Never presented as an NFL rule.

The engineer fetches each source and cites it. Any value from memory, Wikipedia, a news site or a secondary summary is `unconfirmed`, whatever the engineer believes. If the 2026 rulebook is not published on operations.nfl.com, use 2025 plus the 2026 rule-change announcements, and say so at the top of RULES.md.

## Designed simplifications (proposed, Joseph confirms)

Each goes in RULES.md with status `designed` and in DECISIONS.md.

1. Whole yards. Every spot is an integer number of yards. Half-the-distance from inside the 2 rounds so the ball never reaches the goal line (proposed: half the distance rounded down, minimum 1 yard from the goal). Open question 2.
2. No momentum exception and no inadvertent whistle. A PlayResult states which team gave the ball its impetus into an end zone; the machine applies the touchback or safety rule from that.
3. Offsetting fouls replay the down. Fouls by both teams with a change of possession, and fouls on both sides of a kick, are not supported: the machine rejects them with a typed error, and step 4 must not produce them. Open question 4.
4. Penalty accept or decline is an input. When none is given, a placeholder default decides (open question 3). It is designed, not an AI.
5. Receive or defer, and the overtime choice, are inputs. When none is given, the toss winner defers in regulation and receives in overtime (placeholder, open question 3).
6. No fair catch kick, no free kick after a fair catch.

## State and inputs

### Coordinates

The ball spot is yards from the possessing team's own goal line, 0 to 100. Situation's `yardLine100` is 100 minus the spot. A scrimmage spot between plays is 1 to 99. A PlayResult reports the dead-ball spot in the same frame, where values below 0 or above 100 mean an end zone. Teams are `home` and `away`. Field direction (which end) is not tracked; quarters change ends without changing any field of the state that the machine reads.

### GameState must expose

Field names are the engineer's call. A reader must be able to get: rule set id and hash; seed; game type (regular season or postseason); period (1 to 4, then overtime periods); seconds left in the period; whether the clock is running; phase (`kickoff`, `scrimmage`, `try`, `final`, plus anything else the engineer needs, such as `halftime` or `overtimeToss`); possession; spot; down, distance and goal-to-go; score per team; timeouts per team; whether the two-minute warning has happened in this half or period; overtime bookkeeping (who received, possessions completed, whether sudden death applies); which team receives the second-half kickoff; play count; and why the game ended.

### Inputs

| Input | Meaning |
| --- | --- |
| New game | Rule set, game type, seed, Rng, optional toss choice. Draws the toss, sets up the opening kickoff. |
| Pre-snap run-off | Seconds the offense lets run before the snap (tempo). Runs off the game clock only when it is running. Bounded by the play clock that applies; more than that is rejected (a delay of game is a PlayResult penalty, not a long run-off). Stops at the two-minute warning or 0:00. If the period ends, no play follows. |
| Timeout | A team calls a timeout during a dead ball. Rejected if the team has none left, the game is not in a live phase, or the rules forbid it there. Stops the clock. |
| Play | A PlayResult (below). |
| Penalty choice | Accept or decline for each penalty that can be declined, when the caller supplies it. |
| Overtime toss | Rng and optional choice, when the game enters overtime. |

Each input returns the next state, or a typed error that names the reason. An error never leaves a half-changed state behind.

### PlayResult (the contract with step 4)

Defined in this step as a type in packages/shared (type-only, so sim can import it). Step 4 fills it. The machine must be able to apply every legal play from these facts alone. The engineer settles the exact shape; it must carry at least:

- Kind: scrimmage play (run, pass, sack, scramble, kneel, spike), punt, field goal, extra point kick, two-point try, kickoff, onside kick.
- Seconds of game clock the play took.
- Dead-ball spot and who has the ball when it ends, including in an end zone, plus which team's impetus put it there.
- Incomplete pass, ended out of bounds (and where relative to the line), turnover (interception, fumble lost) with the return, fumble recovered by the offense, touchdown by either side.
- Kicks: blocked, where a kickoff landed (short of the landing zone, in it, in the end zone, out of bounds), touchback taken or downed, fair catch, returned to which spot, muffed and recovered by whom; for an onside kick, which team recovered and where. For a field goal or extra point, good or not.
- Penalties: a list of penalty ids from the rule set, each with the team that committed it and, where the enforcement needs it, the spot of the foul.
- Room for fields the machine ignores (for example the "why" factors for the one-line explanation, animation detail).

The machine rejects a PlayResult that does not fit the state (a punt during a try, a kickoff when the phase is scrimmage, an onside kick when the rule set does not allow one now, a spot outside the field and both end zones) or that contradicts itself (incomplete and out of bounds at a spot downfield, a touchdown with a dead-ball spot short of the goal line).

## Milestones

Each is shippable on its own branch and goes through code-reviewer and test-writer. A comes first; B to D build on each other; E needs all of them.

### A: rule set, schema, RULES.md

| # | Criterion | How it fails |
| --- | --- | --- |
| A1 | The rule set file parses with its zod schema in CI. Bad fixtures are rejected: a negative quarter length, a touchback spot outside 1 to 99, a landing zone whose start is past its end, a penalty with an unknown enforcement spot, an overtime format missing a field. | A bad fixture passes. |
| A2 | Every leaf key path in the rule set file has exactly one row in RULES.md, and every RULES.md row names a key path that exists. A test checks both directions. | Drift either way. |
| A3 | Every RULES.md row has a status of `confirmed`, `unconfirmed` or `designed`. Every `confirmed` row has a rule and section reference, a season, a date checked, and a URL whose host is operations.nfl.com or another nfl.com host that serves the official rulebook or NFL Football Operations announcements. A test checks this. | A confirmed row with a missing reference, or a URL on any other host (Wikipedia, news, blogs). |
| A4 | RULES.md states at the top which rulebook edition was used (2026, or 2025 plus named 2026 announcements) and lists every `unconfirmed` value in one place. | Missing, or an unconfirmed value not in the list. |
| A5 | The kickoff section of RULES.md covers the dynamic kickoff as adopted in 2024, the 2025 amendments and any 2026 change: kickoff spot, landing zone, each touchback spot, short-kick spot, out-of-bounds spot, fair catch, onside eligibility and declaration. Each from a primary source or flagged. | Any of these missing or uncited and unflagged. |
| A6 | Overtime: separate regular-season and postseason entries, each with every field of the overtime group, cited. | Missing either format. |
| A7 | A grep test finds no rule-number literals in the machine's source outside the rule set loader (a list of banned literals in context, for example `900`, `120`, `35` used as spots or times). Reviewer confirms. | A rule value hard-coded. |

### B: state, downs, scoring, kicks, possession (regulation, simple clock)

Clock in this milestone: each play subtracts its seconds; a period ends at 0:00. Run-off rules, the two-minute warning, timeouts and overtime come in C.

| # | Criterion | How it fails |
| --- | --- | --- |
| B1 | New game: the toss uses exactly one Rng draw; the same seed gives the same toss; the toss winner and choice decide the opening kicker and the second-half receiver. The seed is in the state. | Different toss for the same seed, more than one draw, wrong second-half receiver. |
| B2 | Downs: a gain short of the line to gain increments the down and cuts the distance; reaching it gives 1st and the rule set's first-down distance; a gain that puts the line to gain at or past the goal line makes it goal-to-go with distance equal to the yards to the goal. A loss adds to the distance. | Wrong down, distance or goal-to-go flag. |
| B3 | Turnover on downs: failing on the last down gives the other team the ball at the dead-ball spot, flipped to its frame, 1st and 10 (or goal-to-go). | Wrong team, spot or down. |
| B4 | Touchdown: the scoring team gets the rule set's points and the phase becomes `try` for that team. Both offensive and defensive touchdowns (interception or fumble return) work, and so do return touchdowns on kickoffs and punts. | Wrong points, wrong team on the try. |
| B5 | Try: an extra point kick and a two-point try start from their rule set spots. Success adds the right points, failure adds none, and a defensive return on a try adds the rule set's points to the defense. After any try the scoring team kicks off. A try takes no game clock. | Wrong spot, points, kicker, or clock changes. |
| B6 | Field goal good: points, then the scoring team kicks off. Missed: the other team takes over at the rule set's spot (spot of kick, or the minimum spot when the kick was inside it). Blocked and recovered: by the dead-ball spot and possession in the PlayResult. | Wrong spot or team. |
| B7 | Safety: a ball dead in the offense's own end zone with the offense's impetus scores for the defense, and the team scored on free-kicks from the rule set's safety spot. A ball dead in an end zone with the other team's impetus is a touchback at the rule set's spot. | Safety and touchback swapped, wrong points or spot. |
| B8 | Kickoff: each end state (touchback from the end zone, landing-zone ball into the end zone, short of the landing zone, out of bounds, fair catch if the rules allow it, returned, muffed and recovered by either team, return touchdown) gives the possession, spot and down that the rule set says. One test per end state, using values read from the rule set. | Any end state wrong. |
| B9 | Onside kick: legal only when the rule set allows it in that state (score, quarter, declaration); otherwise rejected with a typed error. Recovery by either team gives possession at the recovery spot. | An illegal onside accepted, or wrong possession. |
| B10 | Punt: touchback, fair catch, downed, out of bounds, returned, blocked, muffed and recovered by either team, return touchdown. Each gives the possession and spot the rules say. | Any wrong. |
| B11 | Turnovers: interception and fumble lost flip possession at the return's end spot, 1st and 10; an interception or recovery in the defense's own end zone downed there is a touchback; a return touchdown scores. | Wrong team, spot, score. |
| B12 | Rejected inputs: each malformed or out-of-phase PlayResult listed under "PlayResult" gets a typed error, and the state passed in is unchanged. | Accepted, thrown untyped, or input mutated. |
| B13 | Invariant checker (exported, pure, returns a list of violations) runs after every transition, and a violation throws a typed error naming it. It checks at least: down 1 to 4 in scrimmage; distance at least 1, and equal to yards to goal when goal-to-go, never more than yards to goal; scrimmage spot 1 to 99 and every spot 0 to 100; clock between 0 and the period length, never negative, never rising within a period; each score never decreasing and changing by only a legal amount, by at most one team per transition; timeouts between 0 and the rule set maximum, never rising within a half except at a reset; phase consistent with the other fields (no down on a try or kickoff); the final state is absorbing (any input to it is rejected). Each check has a test that builds a bad state and sees it flagged. | A bad state not flagged, or a good state flagged. |
| B14 | The end of regulation with a score difference ends the game: phase `final`, reason recorded. | Game continues, or ends without a reason. |

### C: clock, two-minute warning, timeouts, halves, overtime

| # | Criterion | How it fails |
| --- | --- | --- |
| C1 | After each play the clock is running or stopped as the rule set says, for each kind of event: in-bounds play, incomplete pass, out of bounds (inside and outside the windows where it differs), score, change of possession, penalty, timeout, two-minute warning, end of period. Where the rule set says the clock restarts on the ready-for-play signal, pre-snap run-off applies; where it says on the snap, it does not. One test per event and window. | Clock running when it should be stopped or the reverse. |
| C2 | Pre-snap run-off longer than the applicable play clock is rejected. Run-off that reaches 0:00 ends the period with no play. | Accepted, or a play applied after 0:00. |
| C3 | Two-minute warning: in each period the rule set names, the clock stops when it reaches the warning time, whether during pre-snap run-off (stops exactly at the warning time) or during a play (stops after the play, at whatever time is left). It happens once per half or period. Not in a period the rule set does not name. | Missed, doubled, or wrong time. |
| C4 | Timeouts: each team has the rule set's count per half; a timeout stops the clock and decrements the count; a team with none is rejected; counts reset at halftime and for overtime per the rule set; unused timeouts do not carry over unless the rule set says so. | Wrong count, reset, or an illegal timeout accepted. |
| C5 | Ten-second run-off: a qualifying foul or stoppage in the rule set's window runs off the set time; a team with a timeout can use one to avoid it if the rule set allows; when the run-off takes the clock to 0:00 the period ends. | Run-off missing, wrong amount, or applied outside the window. |
| C6 | Untimed down: when time expires on a play with an accepted foul that the rule set says extends the period, one more untimed play is allowed. A touchdown on the last play still gets its try. | Period ends early, or the try is skipped when it should not be. |
| C7 | Quarters 1 to 2 and 3 to 4 carry possession, down, distance and spot over. Halftime resets to a kickoff by the right team, with timeouts reset. | Lost possession or down, wrong kicker. |
| C8 | Regular-season overtime under the current rule set: toss, the scores that end it on the first possession and those that do not, the guaranteed-possession rule, sudden death after, end at 0:00 as a tie if still level and the rules allow a tie. One test per path. | Any path wrong. |
| C9 | Postseason overtime: as C8, plus further periods until there is a winner, with timeouts, two-minute warning and halftime-like breaks as the rule set says. A postseason game never ends tied. | A tie, or wrong period handling. |
| C10 | Rule changes are data edits: with fixture rule sets that change quarter length, timeouts per half, the two-minute warning time, every kickoff and touchback spot, and the overtime format (for example the older modified sudden death, where a first-possession field goal does not end the game but a touchdown does), the machine follows each fixture with no code change. | Behavior ignores the fixture. |
| C11 | The game ends in exactly the right state for every way it can end: regulation with a leader, overtime score, overtime expiry (tie or next period). | Ends early, late, or not at all. |

### D: penalty enforcement

| # | Criterion | How it fails |
| --- | --- | --- |
| D1 | Each enforcement spot in the schema (previous spot, spot of foul, succeeding spot, dead-ball) moves the ball the rule set's yards from the right spot, toward the right goal. One test per spot type, using a real penalty from the table. | Wrong spot or direction. |
| D2 | Half-the-distance: when the yards would move the ball more than half the way to the offending team's goal, it moves half the distance instead, using the designed rounding (simplification 1). Tested from the 1, 2, 3 and 10 for both sides. | Ball at or behind a goal line, or full yardage applied. |
| D3 | Automatic first down, loss of down, and replay of the down each work as the table says. A defensive foul whose yards reach the line to gain gives a first down even without the automatic flag. | Wrong down or distance. |
| D4 | Accept or decline: the machine lists the legal outcomes for the offended team (accept, or decline and keep the play's result). A supplied choice is applied. With no choice, the placeholder default decides deterministically. A penalty the table marks as not declinable cannot be declined. | Wrong outcome list, choice ignored, nondeterministic default. |
| D5 | Offsetting fouls replay the down from the previous spot with the down and distance unchanged. Unsupported combinations (designed simplification 3) are rejected with a typed error. | Wrong replay, or an unsupported combination silently applied. |
| D6 | Penalties on a try, on a kickoff and on a punt enforce from the spots the rule set gives, including a foul by the return team. | Wrong spot. |
| D7 | A pre-snap foul (false start, delay of game) is a dead-ball result: no play yards, no play time, clock and run-off as the rule set says. | Play yards or time applied. |

### E: Situation, callers, determinism, soak-ready checks, docs

| # | Criterion | How it fails |
| --- | --- | --- |
| E1 | The machine exports one function that returns the step 2 `Situation` for any state in phase `scrimmage` or `try`, and says plainly that no Situation exists in other phases (kickoff, final and so on). Fields: offense's view of the score; `yardLine100` 1 to 99; quarter 1 to 4 and 5 for any overtime period; `secondsLeftInHalf` and `secondsLeftInGame` as step 2 defines them (in overtime, both are seconds left in the period); timeouts for offense and defense. On a try: `phase: "try"`, down 1, and `yardsToGo` equal to `yardLine100` equal to the two-point spot from the rule set, matching the try situations in data/caller/golden.json. Score difference on a try is after the touchdown. | Any field wrong at a boundary (first second of each quarter, 2:00 exactly, overtime, a try). |
| E2 | No adapter drift: the Situation object has exactly the keys in `SITUATION_FIELDS`, a type-level test ties the adapter's return type to `Situation`, and a test runs `chooseOffenseCall` and `chooseDefenseCall` with the real caller data on at least 1,000 states produced by the machine (from random games, covering all four downs, tries, both halves' final 2:00 and overtime) without an error, with every returned call available in that situation per the catalog. | A missing or extra key, a caller error, or an unavailable call returned. |
| E3 | Determinism: a test generates 200 random legal games (a test-side generator of legal PlayResults, pre-snap run-offs, timeouts and penalty choices, driven by a seeded Rng). Replaying each input sequence from the same seed gives deep-equal states at every step. Serializing a mid-game state to JSON, parsing it, and continuing with the same inputs gives the same final state. | Any difference. |
| E4 | Soak-ready: the same generator plays 1,000 complete games (regular season and postseason, real rule set) with the invariant checker on after every transition. Every game reaches `final`, no invariant fails, and no postseason game ends tied. The generator is exported from a test-support module so step 5's soak test can reuse it. Wall-clock time for the 1,000 games is recorded in docs/PERF.md; no gate. | A violation, a game that never ends, or a postseason tie. |
| E5 | Purity: the existing purity and import tests include the new files. The machine does not import zod. | A violation passes. |
| E6 | Docs: RULES.md complete per milestone A; DECISIONS.md has an entry for each designed simplification, the coordinate frame, the coin toss draw and the placeholder defaults; MODEL.md "Clock and tempo" says clock and run-off come from cited rules (not fitted, not designed) and that tempo and timeout decisions are not built yet. | Missing entry, or the rules section called fitted or designed. |
| E7 | CLAUDE.md's "Run" and "Test" lines are unchanged unless the commands changed; the challenges open issue is still listed as open. | Changed without reason, or challenges marked settled. |

## Edge cases that are reachable

- A touchdown on the last play of the half or of regulation: the try still happens (unless the rule set says it is skipped in that case), and the clock stays at 0:00.
- A two-minute warning reached during pre-snap run-off with the play clock still running.
- A 4th-down incomplete pass in the final 2:00 with the trailing team holding no timeouts.
- An interception in the end zone, downed: touchback. Returned out and then fumbled back into the end zone: governed by impetus as reported.
- A safety on a kickoff return or a punt return (the returner downed in his own end zone after carrying it in).
- A missed field goal from inside the minimum spot.
- A punt blocked behind the line and recovered by the kicking team short of the line to gain: other team's ball (turnover on downs) per the rules, or kicking team's first down if the rules say so. The engineer cites which.
- Half-the-distance from the 1 for both teams, and a defensive foul at the 1 on goal-to-go.
- A defensive foul on the last play of the half (untimed down), and an offensive foul on it (no untimed down).
- A ten-second run-off that ends the half.
- A team calling a timeout with none left; a timeout during a try.
- An onside kick attempted when the rules do not allow it.
- Overtime: a first-possession field goal, a first-possession touchdown, a safety or defensive touchdown on the first possession, a turnover on the first play, the second team scoring a touchdown, the period ending tied (regular season and postseason).
- A two-point try returned by the defense for its points.

## Dependencies and sequencing

- A first. Primary-source research takes time and every value in B to D depends on it. B can start on fixture rule sets while A is in progress, but B is not done until it runs on the real file.
- B before C before D (D's enforcement needs the clock rules for run-off and untimed downs). E needs all.
- Step 4 depends on the PlayResult type from B. Step 4's spec-writer reads it from this step's code, not from this spec.
- After this step, playtester runs the E4 soak once on the merged branch (CLAUDE.md: playtester after any game-rule change).

## Locked vs likely to change

Locked: the locked decisions above; rules as data with citations; the coordinate frame; the machine never decides an outcome; Situation unchanged.

Likely to change: the PlayResult shape, once step 4 builds `resolvePlay` against it (changes are a schema change and need Joseph's approval); the penalty table (step 4 adds entries); the placeholder defaults (replaced by AI decisions in step 5 or M3); the designed simplifications if playtests show they matter; the rule set when the NFL changes rules.

## Open questions

1. Open: which edition. If the 2026 rulebook is on operations.nfl.com, use it. If only the 2025 rulebook plus 2026 announcements exist, is that acceptable for M1, with every 2026 change cited from its announcement?
2. Open: whole-yard spots. Half-the-distance from the 1 is half a yard in the real rules. Proposed: round down, never closer than 1 yard to the goal, marked designed. Alternative: allow half-yard spots everywhere, which affects Situation bins and the caller tables (they use whole yards). Joseph decides.
3. Open: placeholder defaults until step 5 or M3. Proposed: the toss winner defers in regulation and receives in overtime; the offended team accepts a penalty unless declining leaves it with a score, possession, or a better down and distance (compared by down first, then distance, then spot). Fine as placeholders, or should the step require every choice to be passed in?
4. Open: unsupported foul combinations. Fouls by both teams with a change of possession, and fouls on both sides of a kick, are rejected. Step 4 must then never produce them. Acceptable, or should this step enforce them too?
5. Open: a 2026 kickoff change. DECISIONS.md tunes kickoff rates to 2025. If 2026 changed the kickoff rules (touchback spot, landing zone, onside eligibility), the 2025 tuning in step 4 no longer matches the rules the game runs, and the kickoff decision's "what would change it" applies. Who decides: run 2026 rules with 2025-tuned rates, or retune later?
6. Open: fast-check (or another property-testing library) for E3 and E4. It is a new dev dependency and needs approval. Without it, the generator is hand-written on the project Rng.
7. Open: preseason. Out of scope by default (no preseason games planned). Confirm.
8. Open: challenges. Still unresolved as a second interruption (CLAUDE.md). Nothing in this step depends on it, but if challenges come later, the state machine will need a way to undo or replace the last transition. Keep GameState history out of scope until then?

## Resolved open questions (lead, 2026-11-11)

These override anything above that conflicts. Record each in docs/DECISIONS.md.

1. Use the 2026 rulebook if operations.nfl.com publishes it. Otherwise use the 2025 rulebook plus the cited 2026 rule-change announcements. Record which in RULES.md.
2. Whole-yard spots. Half-the-distance rounds down with a minimum of 1 yard from the goal. Mark it designed.
3. The defaults are designed default policies, not placeholders. The toss winner defers in regulation and receives in overtime. The offended team accepts unless declining is better, by the stated rule. Every choice can also be passed in explicitly. The player's UI (M2) and the AI coaches (M3) will pass choices in. Document the defaults in MODEL.md as designed.
4. Accepted. Two-team fouls with a change of possession, or on both sides of a kick, are rejected. Step 4 must never produce them. Note the constraint in the PlayResult contract.
5. Run the current-season rules. If 2026 changed kickoff mechanics from 2025, say so plainly in RULES.md and in the report back. Step 4 decides how that affects the kickoff tuning.
6. No fast-check. Use a hand-written random-game generator on the project Rng.
7. Preseason is out of scope.
8. State history stays out of scope until challenges are decided.
