# M3: playbook and custom routes

Status: draft, 2026-11-23. Owner: Joseph. Author: spec-writer. Nothing here is built.

Companion specs, not written yet: docs/specs/m3-recommendations.md (play recommendations) and docs/specs/m3-calling-screen-playbook-and-routes.md (the designer's screens and the drawing interaction). This file owns the play model, the data, the engine contract and the animation contract. It designs no screens.

## Revision 2026-11-24 (lead's rulings after the A and B code review)

Where these differ from the text below, these win. All are designed.

- **R1, catch depth.** A route gets one more feature, `catchDepth`: the end point's y for a route that ends heading vertical or on a deep diagonal (go, post, corner, wheel), else the break depth. `breakDepth` keeps its meaning for every family, the last break, and is the end point's y only when there is no break. The depth bucket, the `depth` tag and the depth rule in D read `catchDepth`. Reason: reading a post by its break made a post shallower than a dig.
- **R2, no-break strokes.** A route with no break is read by its heading and end depth: vertical is go, diagonal toward the middle is slant when it ends under 10 yards and post otherwise, diagonal away is flat when it ends under 10 and corner otherwise, sideways is drag or flat. The 10 is the pass leaves' edge, from the same place as the buckets.
- **R3, spy and base paths.** A drawn path whose features equal the slot's base assignment resolves to the base assignment, whatever its kind. A spy is a net move under the spy radius by a defender aligned inside the core box in config.json. Outside the box a short move is a zone. Every catalog assignment, zones included, must round-trip to itself. A short move that ends near the base landmark is the base assignment. A tap with no real move, inside the core box, is a spy. Callers that need this use `resolveDrawing`, which C and E must call.
- **R4, back checkdown.** Family `swing`, not `screen`.
- **R5, defaults.** F2 is amended: a default design draws today's diagram except for the calls listed in data/plays/config.json `defaultDeviations`, each with a one-line reason. A deviation must be forced by the play's name (outside runs to one side, deep passes named for their routes). A deviation forced by the preset's definition or by R7 is also allowed (Run Stuff, Nickel 2-Man, Dime Cover 0 Blitz, Goal Line). Back Screens, Empty Bubble and inside-run tracks go back to today's diagram.
- **R6, blockers.** A lead or pulling blocker's path ends at the design's hole or ahead of the runner on his side, derived from the alignment, never a fixed sideways distance. A test checks it for every run design with a lead or puller.
- **R7, man coverage.** A man defender's role must resolve to a real offensive slot in every formation, or name a fallback (rush, spy or a zone).
- **R8, field and eligibility.** data/plays/config.json stores the width as 160 feet (RULES.md, "Field dimensions") and derives yards. Barring the quarterback from a drawn route is a designed restriction, stricter than the rule (RULES.md, "Eligible pass receivers"), and is labeled so. Both statuses then read confirmed, and the test lines that assert "unconfirmed" change with them.
- **R9, untrusted input.** Slot lookups use own keys only, and `quantizePath` rejects any input whose result is not finite.
- **R10, distinct designs.** Two designs in a group must differ in the features the engine reads, not only in paths. Traits and situation tags are checked by a committed test against the rules in config.json, now, not in D.

- **R11, slant against post.** With or without a break, a path that ends on a diagonal toward the middle is a slant when its break depth is 0 to 9 and its end depth is under 10, and a post otherwise. A deep crosser (`route.over`) that breaks short and ends deep reads as a post only if it ends on a deep diagonal. If it ends nearly sideways it is an `in`. The library declares what the rule gives, never the reverse.
- **R12, depth frame.** `breakDepth` and `catchDepth` are measured from the line of scrimmage, not from the player's own alignment, so a back and a receiver compare alike.
- **R13, edges.** A defensive path ending exactly on the line is a blitz. The under and deep zone edge is the caller's 10-yard edge, read from one place. A back's short path that ends level and behind the line is a swing unless the design is a screen.
- **R14, keep-in backs.** A design's own assignment is always legal to redraw as itself. A faking back may be drawn to stay in and block on a play-action pass, which keeps the fake. `breaksConcept` is only for a route that removes the fake or the screen.
- **R15, screens.** Whether a screen keeps a route behind the line is judged by where the route ends, never by its declared family.

- **R16, redraw at the goal line.** Features equal to the base assignment resolve to the base before the bounds check, so R14 holds at every spot. Any other path must stay in bounds, as B6 says.
- **R17, whole yards.** Break depth and end depth are rounded to whole yards once, before the family table and the bucket read them, so a family and its bucket cannot disagree at an edge.
- **R18, deviations are per path.** A default that deviates does so only on the paths its reason forces. Every other slot draws today's diagram.
- **R19, declared fields are checked.** parsePlaybook rejects a declared run gap, lane, family, counter or misdirection flag that the paths do not bear out, any landmark or path outside the field or the point and length limits, and an index past the end, as listed issues, never a throw.

- **R21, unreferenced entries.** R19's checks also run on library entries no design uses. A `timing` row reads the drop and the routes, as its note says, never the concept alone.
- **R20, deep alignment near the goal line (build with C, before any drawing reaches a game).** An alignment past the end line is moved up to the end line before the bounds check, for defense and offense alike, so a safety can still be drawn coming up at the 99. Half yards round up (R17).

## Goal

Give the coach a real playbook: about 147 named play designs on offense and defense, each of which changes what happens, and let him redraw one player's assignment before any snap, with the engine deciding the result from a small set of features of that drawing.

For: Joseph, who asked on 2026-11-23 for "better plays and a larger variety" and "custom routes for a player each play. on offense and defense. you can select someone and draw out a route." Also for the engineer and test-writer who build and check it, and the designer and the recommendations spec-writer, who build on its data.

In plain words: today a call is a formation and a concept ("Shotgun, Short pass"). After this, a call is a named play ("Shotgun, Mesh") that still uses the same real NFL numbers for a short pass from shotgun, plus small designed pushes that depend on what the play is and what the defense is doing. A drawn route swaps one player's job in that play for one snap. Averaged over a league of computer coaches, the numbers stay where they are today.

## Non-goals

- Screens, cards, the drawing gesture, feedback while drawing. Designer.
- Recommendations. This spec only supplies the tags and the pure functions that spec reads.
- Coach personalities. AI teams pick designs by designed weights that do not read the situation.
- Audibles, hot routes after seeing the defense, pre-snap motion, formation flips, shifts.
- New engine calls. No new formation, concept, package or coverage, so no fitted table is rebuilt and `data/calls/catalog.json` and `data/caller/*` do not change.
- More than one custom assignment per side per snap. Custom assignments for the quarterback, on kicks, kneels, spikes or QB sneaks.
- Plays that need a ball carrier or passer the engine cannot credit today (receiver runs, option pitches, trick passes).
- Fitting anything. Every number this spec adds is designed.
- Standout plays: their factors keep reading the base role shares.

## Where things stand (checked in code, 2026-11-23)

- `resolvePlay(state, offenseCall, defenseCall, players, rng)` in packages/sim/src/engine/resolve.ts. `OffenseCall` is `{ call, twoPointPlay?, formation? }` (packages/sim/src/caller/offense.ts, mirrored by `OffenseCallChoice` in packages/shared/src/game.ts). The defense call is a bare preset id, `string | null`.
- An engine call is what the fitted tables know: on offense a formation and a leaf (5 formations x 8 run and pass leaves = 40 pairs), on defense one of 13 presets. Class weights are baseline x matchup x formation x rating x standout, then one draw (`drawClass`).
- The AI defense is called with `(situation, rng)` only, after the offense's call, and cannot reach it (packages/sim/src/loop/play.ts, coach.ts).
- Play events store the calls: `{ t: "play", offense: OffenseCall, defense: string | null, ... }`. `RECORD_SCHEMA_VERSION` is 2, `SESSION_SCHEMA_VERSION` 1, the app's `SAVE_SCHEMA_VERSION` 6. A human answer is `{ seq, path }`, a list of option ids. Request screens are already formation first (docs/DECISIONS.md, "Play calling: formation-first request screens").
- Who made the play is credited after the outcome from a separate stream (data/engine/participants.json). The engine sets no `runLocation` or `airYards` today, the app treats both as optional.
- Alignments, routes and drops for drawing live in data/ui/templates.json, a UI file the sim does not read. Routes are keyed by concept and receiver role, the same for every formation.
- The calibration summaries pin a code hash over every file in the import graph of scripts/game/calibrate.ts (`codeFiles()`), plus data file hashes. Any edit to a file in that graph stales the pins even when no outcome changes. Last runs: engine 15, step 5 game 20 (docs/DECISIONS.md run table).
- docs/specs/m2-play-calling-and-motion.md decision 3 rejected named plays "as cosmetic variants of one class". That reason ends when designs change outcomes (milestone D). Until D is in, designs are not offered to the human.

## Locked decisions (from the lead, 2026-11-23)

1. One model. A play design is a named play: a formation (or defense package and coverage) plus one assignment per player. A custom assignment overrides one player's assignment in the chosen design for one snap. Offense and defense work the same way.
2. Every design maps to exactly one engine call. The fitted baselines keep their meaning. Whatever a design or a custom assignment adds is a designed, centered modifier. Never call it data-derived. Never flatten variance.
3. The engine never sees pixels. A pure, deterministic classifier turns a path in field yards into a few features. The path is kept for the animation.
4. A custom assignment can only act through factors the engine uses, stored in data. The why line cites only factors the engine used.
5. The AI never sees the human's design or drawing before the snap. AI teams use catalog designs only, never custom assignments.
6. Designs and custom assignments travel inside the offense and defense call given to `resolvePlay`. This is a schema change and needs Joseph's sign-off (Open question 1).
7. At most seven choices on a screen. The catalog carries the keys that keep it browsable.

## Status of each part

| Part | Label | Why |
|---|---|---|
| Baseline class weights and pools per engine call | fitted, unchanged | No table is rebuilt. |
| Matchup and formation tables | designed, centered, unchanged | |
| Catalog: designs, assignment library, alignments, tags, AI weights | designed | Hand-written. No shipped data names a concept. |
| Mapping a design to its engine call | designed | It decides which fitted numbers a design starts from. |
| Design effects (rule tables, bounds) | designed, centered | Centered inside each engine call pair. |
| Classifier and validity rules | designed, plus one cited rule (who is eligible) | Thresholds in data. |
| Custom assignment effects | designed | Same rule tables as designs. |
| Crediting by assignment | designed | Credit stream only. |
| AI design choice | designed | Fixed weights per design. |

## Design

### Terms

- Engine call: (formation, leaf) on offense, a preset on defense.
- Play design: an id, a label, one engine call, assignments, tags.
- Slot: a position and its 1-based place in on-field order, `WR2`, `OL3`, `LB1`. These are the keys data/ui/templates.json already uses and the order of `OnFieldSide`.
- Assignment: what one slot does. Kinds below.
- Profile: the engine-facing summary of a play, computed by a pure function from the alignment and the assignments. The engine reads profiles, never ids or paths.

### Assignment kinds

| Kind | Who | Features the engine reads | Can be drawn |
|---|---|---|---|
| `route` | WR, TE, RB | family, break depth (whole yards), depth bucket, direction (in, out, vertical, back), end side (left, middle, right), crosses the middle (yes or no) | yes |
| `block` | OL always. RB, TE by choice | pass or run block. Only OL, RB and TE count as protectors | yes for RB and TE (a path shorter than the minimum route) |
| `runPath` | the design's ball carrier (RB or QB) | gap (A, B, C, edge), side | yes, inside the concept's gaps |
| `qb` | QB | drop, rollout side, fake, handoff, keep | no |
| `rush` | DL by default | lane (inside, edge), side | no |
| `blitz` | any defender | lane, side | yes |
| `zone` | any defender | level (under, deep), third (left, middle, right) | yes |
| `man` | any defender | the offense slot role he covers | no |
| `spy` | any defender | none | yes |
| `stunt` | DL pairs | which two exchange lanes | no |

Route families, a closed list of 12 in generic terms: flat, swing, screen, drag, slant, hitch (curl and comeback included), out, in, corner, post, go (fade and seam included), wheel. Depth buckets use the pass leaves' edges (docs/MENUS.md): behind the line, short 0 to 9, intermediate 10 to 19, deep 20 and more.

### Data files (all new, suggested names)

Designed files are hand-edited and never written by a script. Generated files carry `"generated": true` and the hashes of their inputs.

| File | Kind | Contents |
|---|---|---|
| `data/plays/alignments.json` | designed | Alignment per formation, package and preset, in yards from the middle of the field and off the ball. The values now in templates.json `offense`, `defense`, `presetAlignment`. The sim needs them for bounds, sides and crossing. |
| `data/plays/library.json` | designed | Named assignments: routes as waypoints with their declared family, blocks, run paths, QB actions, rushes, drops. A design refers to these by id, so a design is short. |
| `data/plays/offense.json`, `defense.json` | designed | The designs. |
| `data/plays/config.json` | designed | Closed lists (families, traits, tags, reason codes), tag definitions, classifier thresholds and decision table, target weights. |
| `data/plays/modifiers.json` | designed | Bounds, class valence, the rule tables. Every cell that is not 1 is labeled `designed` with a one-line football reason, as in data/engine/matchup.json. |
| `data/plays/modifiers.centered.json` | generated | One centering factor per (formation, leaf, preset, class). The engine reads only this for centering. |
| `data/plays/tolerances.json` | designed, pre-registered | The D7 tolerances, the D6 minimum effect, the E9 threshold once Joseph sets it. |
| `docs/PLAYBOOK.md` | checked by a test | Every design by group, with its one-line description and tags. |
| `docs/PLAYBOOK_REPORT.md` | generated | D7, D6, E8, E9 and G results. |

One offense design, as data: `id`, `label`, `description` (one plain line), `formation`, `concept` (the leaf), `side` (strong, weak or none), `assignments` (slot to a library id with optional depth and `primary`), `carrier` (run designs), `tags`, `traits` (the author's expectation, checked against the derived ones), `aiWeight`, `default`. OL slots take the concept's default block unless listed. A defense design has `package`, `coverage` (the preset), optional alignment overrides, and the same rest.

Each engine call has exactly one `default` design. It reproduces today's diagram for that call and is the reference for the depth rule below.

### The catalog (proposed: 147 designs, 107 offense and 40 defense)

Counts are designs per formation. No group is larger than 5, so every group fits a seven-choice screen with Back. Names are generic football terms. No team, city, coach or product names, and no other game's playbook names, art or organization.

| Concept | Shotgun | Under center | Pistol | Empty | Heavy | Total |
|---|---|---|---|---|---|---|
| Inside run | Inside Zone, Draw, Power | Inside Zone, Power, Lead, Trap | Inside Zone, Dive, Power | QB Draw, QB Power | Dive, Power, Lead | 15 |
| Outside run | Outside Zone, Sweep, Counter | Outside Zone, Toss, Counter | Outside Zone, Toss, Sweep | QB Sweep | Toss, Off Tackle | 12 |
| QB sneak | Sneak | Sneak, Wedge | Sneak | Sneak | Sneak, Wedge | 7 |
| Short pass | Slant Flat, Stick, Curl Flat, Mesh, Quick Outs | Slant Flat, Curl Flat, Hitches | Stick, Slant Flat, Quick Outs | Mesh, Stick, Spacing, Hitches | Stick, Slant Flat | 17 |
| Intermediate pass | Smash, Flood, Drive, Levels, Dagger | Flood, Dig, Curls | Smash, Drive, Deep Cross | Levels, Smash, Dagger | Corner Flat, Deep Cross | 16 |
| Deep pass | Four Verticals, Post Wheel, Post Dig, Fades | Post Dig, Post Corner, Fades | Four Verticals, Post Wheel, Double Post | Four Verticals, Double Post, Fades | Seams, Post | 15 |
| Screen | Back Screen, Bubble Screen, Tunnel Screen | Back Screen, Tight End Screen | Back Screen, Bubble Screen | Bubble Screen, Tunnel Screen | Back Screen, Tight End Screen | 11 |
| Play action | PA Crossers, PA Post, PA Flood | Bootleg, PA Post, PA Crossers, PA Flood | Bootleg, PA Post, PA Dig | PA Seam | Bootleg, PA Seam, PA Post | 14 |

| Preset | Designs | Count |
|---|---|---|
| Base Cover 3 | Cover 3 Sky, Cover 3 Buzz, Cover 3 Twist | 3 |
| Base Cover 2 | Cover 2, Cover 2 Middle Deep, Cover 2 Exchange | 3 |
| Run Stuff | Eight in the Box, Strong Run Blitz, Pinch | 3 |
| Nickel Cover 3 | Cover 3 Sky, Cover 3 Buzz, Cover 3 Twist, Cover 3 Exchange | 4 |
| Nickel Cover 4 | Quarters, Quarter Quarter Half, Quarters Twist | 3 |
| Nickel Cover 2 | Cover 2, Cover 2 Middle Deep, Cover 2 Trap | 3 |
| Nickel 2-Man | 2-Man, 2-Man Bracket, 2-Man Spy | 3 |
| Nickel Cover 1 | Cover 1 Robber, Cover 1 Spy, Cover 1 Press, Cover 1 Twist | 4 |
| Nickel Cover 1 Blitz | Middle Blitz, Slot Blitz, Double A Gap, Safety Blitz | 4 |
| Dime Cover 4 | Quarters, Drop Eight, Quarters Twist | 3 |
| Dime Cover 0 Blitz | All Out, Corner Blitz, Overload | 3 |
| Goal Line | Goal Line, Goal Line Pinch | 2 |
| Prevent | Prevent, Prevent Spy | 2 |

A defense design must stay inside its preset's definition in data/caller/config.json (`defenseMapping.presets`): the package's players, the shell, man or zone, and the rush bucket. "Exchange" is a lineman dropping while a linebacker rushes, still four rushers. A design that needs five rushers behind a four-rush preset is not allowed.

### Tags and grouping keys (for the designer and the recommendations spec)

Every design carries:

- `formation` and `concept` on offense, `package` and `coverage` on defense. These are the primary groups, each at most 6 designs.
- `depth`: behind, short, intermediate, deep. Pass designs only.
- `timing`: quick, standard, slow, how long the play takes to develop. This is the "tempo" tag the lead asked for, renamed so it can't be confused with the clock `Tempo` type.
- `pressure` on defense: none, exchange, blitz.
- `situations`: any of shortYardage, redZone, goalLine, twoMinute, longYardage, backedUp, runClock. Each has a designed definition in `config.json` written in Situation fields with the caller's bin edges, and a pure `tagApplies(tag, situation)`.
- `traits`: see below.

Tags have no engine effect. They are browse keys and inputs to recommendations. Groups by situation tag are not size-limited, so a screen built on one must page or split (designer).

### The classifier (designed, pure)

`classifyPath(path, context, config)` and `quantizePath(rawYards, config)`, pure, no RNG, usable by the engine and by the UI thread with the same result.

- Frame: a path is a list of `[x, y]` in yards relative to the player's alignment, x toward the offense's right, y upfield for the offense. Same frame for defenders, so a blitz has falling y.
- Canonical form, the only form the engine accepts: first point `[0, 0]`, every coordinate a multiple of the quantum, consecutive points distinct, point count and total length within limits. Proposed designed values in `config.json`: quantum 0.5 yd, at most 12 points, at most 60 yd, minimum route 2 yd, a break is a turn of 30 degrees or more, at most 3 breaks. `quantizePath` simplifies and snaps any finite list to canonical form or returns a reason.
- Context: side, slot, position, alignment, the engine call, the design, `state.spot`. The sim has no lateral ball spot, so the ball is taken at the middle of the field, which is what alignments assume.
- Result: `{ ok: true, features }` with one assignment kind and its features from the table above, or `{ ok: false, reason }`.
- Offense: break depth is the y of the last break, or of the end point when there is no break. The family comes from a first-match decision table in data keyed by break count, break depth and the final heading relative to the middle of the field. Its last row catches everything, so every valid path gets exactly one family. In words: go has no break or ends vertical. Slant, post and corner end on a diagonal (in short, in deep, out deep). In, out, drag and flat end sideways (in deep, out deep, in short, out short). Hitch ends heading back to the line. Wheel goes out then up. Screen and swing end at or behind the line. An RB or TE path under the minimum route means stay in and block.
- Defense: a path that ends behind the offense's line is a blitz (lane and side from where it crosses). A path that ends on the defense's side is a zone drop (level by depth, third by x). A net move under the spy radius is a spy.
- Validity, a closed list of reason codes: `noSuchSlot`, `ineligible` (OL and QB), `notOnThisCall` (kicks, kneel, spike, QB sneak, and anyone but the ball carrier on a run), `notCanonical`, `tooShort` (a WR path under the minimum), `tooLong`, `tooManyBreaks`, `outOfBounds` (any point outside the sidelines or end lines for this spot), `wrongGap` (a drawn run path outside the concept's gaps: A and B for an inside run, C and edge for an outside run), `breaksConcept` (a screen must keep one route behind the line, play action keeps its faking back).
- A custom assignment never changes the engine call. A deep route drawn on a short pass is still a short pass, pushed a little by the depth rule.

### Profiles and traits

`profile(alignment, assignments)` is pure. Offense pass: protectors, the list of route features with target weights, traits. Offense run: scheme, gap, side, lead blockers. Defense: rushers, deep defenders, under defenders, man defenders, uncovered receivers, vacated zones, box count, line movement side, traits.

Traits are derived by rules in `config.json`, from closed lists. Proposed:

- Pass: quick, crossers, highLow, flood, verticals, levels, isolation, screenBack, screenWide, boot.
- Run: zone, gap, misdirection, perimeter, lead, wedge.
- Defense: singleHigh, twoHigh, fourDeep, noDeep, man, zone, pressure, overload, exchange, stunt, spy, press, robber, bracket, loadedBox, lightBox, pinch.

Each design's authored `traits` must equal the derived ones, so the catalog and the rules cannot drift.

### Design effects (designed, centered)

With designs on, `drawClass` multiplies each class weight by one more factor, D, the product of the rule groups below, then normalizes as today. Nothing else in the draw changes. Inside the drawn class a whole real play is still drawn from the pool, untouched.

| Rule group | Reads | Moves | Shape |
|---|---|---|---|
| Concept vs coverage | offense traits x defense traits | any pass class | Sparse table, default 1. Examples of direction: crossers help against man, verticals help against one deep safety and hurt against four deep, quick throws and screens help against pressure. |
| Protection | protectors minus rushers, and routes out | sack, incompletion | Monotone: sacks never fall as the margin falls, incompletions never fall as routes fall. |
| Depth | target-weighted mean break depth minus the default design's, scaled and clipped to -1..1 | pass classes | Deeper: 20+ and 10 to 19 completions up, 1 to 9 down, incompletions, sacks and interceptions up. Shallower: the reverse. |
| Run fit | run scheme, gap and side x box count, line movement, run blitz | run classes | Sparse table, default 1. |
| Coverage holes | uncovered receivers, vacated zones, spy, against the preset's own default design | completion classes, scramble | A defender taken out of coverage raises completions. A spy lowers scrambles. |

Bounds, proposed designed values the lead confirms before the first run: each group's multiplier within 0.85 to 1.20, the product within 0.75 to 1.35. Narrower than the matchup table's 0.5 to 2.0, so the coverage call still matters most.

Centering. For every (formation, leaf, preset) and class, the factor is divided by its mean over catalog designs on both sides, weighted by the AI's design shares. So inside each engine call pair the average AI design is exactly neutral, and the matchup table's meaning does not move. This is first-order: after normalizing, league class shares can still drift by a second-order amount. D7 measures that drift and G gates it. A human's choices and custom assignments are not in the centering sample, which is the point: picking well beats the average.

A call that names no design gets D = 1 exactly.

### What a custom assignment changes, and what stops exploits

It replaces one slot's assignment and the profile is rebuilt. That is the only path into the engine. So it can:

- Move the target: the redrawn player's target weight follows his new route (crediting, below).
- Move depth: the depth rule shifts with his break depth.
- Change the matchup tested: traits are derived, so a redrawn route can add or remove one (a Mesh with one drag turned into a go is no longer crossers).
- Change protection: sending a blocking back or tight end out lowers the margin and raises sacks. Keeping one in does the reverse and costs a route.
- On defense: a blitz adds a rusher and leaves his man or zone open. A zone drop moves coverage. A spy takes him out of the rush or coverage.

Guards:

- X1. Same features, same tables, same bounds as catalog designs. The engine has no input a drawing can reach and a catalog design cannot.
- X2. No dominance. Class valence (good or bad for the offense) is in `modifiers.json`. A play dominates another against a defense when it is no worse on every class and better on one. No custom play may dominate its base design against every catalog defense design, and the mirror holds for defense. Checked by enumeration (E8).
- X3. A drawing whose features equal the base assignment's changes nothing (E2).
- X4. The AI defense never adapts to the drawing, so a soak compares a greedy drawing bot with a catalog bot (E9).

### Crediting by assignment (designed, credit stream only)

With a design: the target is drawn only from players running a route, weighted by designed weights per family and bucket, the design's `primary` mark and a class fit (a 20+ completion leans to deeper routes), times today's tilts. The ball carrier is the design's carrier. The sacker comes from rushers, blitzers and spies. The interceptor comes from coverage players. Scrambles and everything else are as today. No outcome draw moves.

### Calls, requests, records (schema change, Open question 1)

```ts
type PathPoint = readonly [number, number];
interface CustomAssignment { readonly slot: string; readonly path: readonly PathPoint[] }

interface OffenseCall { call: string; twoPointPlay?: string; formation?: string; design?: string; custom?: CustomAssignment }
type DefenseCall = string | { readonly preset: string; readonly design?: string; readonly custom?: CustomAssignment };
// resolvePlay(state, offenseCall: OffenseCall, defenseCall: DefenseCall | null, players, rng)

interface DecisionAnswer { seq: number; path: readonly string[]; design?: string; custom?: CustomAssignment }
```

- Every new field is optional. A defense call with no design and no custom is written as the bare string everywhere, so a game without designs produces the same bytes as today.
- The engine classifies the path itself. It never trusts features from the caller. `custom` needs a `design`.
- New typed errors: engine `badDesign`, `badCustom` (with the reason code). Session `illegalDesign`, `illegalCustom`.
- `PlayResult.detail` gains `designs: { offense?, defense? }` and `custom?: { side, slot, player, features, path }[]`. Both are public after the snap, like the calls.
- Same call repeats the design. A custom assignment comes only from the answer in hand.
- Old records stay readable: `RECORD_SCHEMA_VERSION` becomes 3, a version 2 record parses with the new reader and means "no designs", and a call with no design resolves exactly as it does today, forever (C4). An old session log replays to the same record. The app's save version moves up and an older save reads as older, as now.
- AI design choice: `designShares(engineCall, playbook)` returns the distribution with no RNG (the hook for personalities and recommendations). `chooseDesign` draws from a side stream forked from the outcome stream without advancing it, as the credit stream is.
- One switch, off by default, in the same place standouts and close calls are switched. Off: no AI design, no effect, `createEngine(data)` and the calibrated baseline are as today. On: AI teams pick designs, the engine validates, records, credits and (from D) applies effects.

### What the UI needs from the model

- Static playbook data for labels, descriptions, tags and art. The request does not list design screens. The designer builds browsing from the primary groups (at most 6 each) under the seven-choice rule.
- Slots map to the human's own players through the existing `lineups`. Drawable players: at most 5 on any offense formation. All 11 on defense, so that pick needs grouping (designer).
- `quantizePath` and `classifyPath` on the UI thread for live feedback. What it shows before the snap equals `detail.custom.features` after it (B1, E1).
- The reason codes, for wording.
- Nothing about the opponent's design or drawing exists in any request before the snap (C6).

### Animation contract

The animation reads the calls and the PlayResult and decides nothing.

- Art for a design comes from its assignments through the same geometry function for cards, the field preview and the live play. A call with no design draws exactly as today.
- Before the read, every unnamed mark follows its assignment. The redrawn player follows his drawn path. If the engine names him the target, he follows it to its last break, then bends to the catch as targets do now. If he is the sacker, he follows it, then the sack arc.
- Fact anchors do not move (m2 motion spec, decision 10). The 2.5 yd ring and "only named players touch the ball" still hold.
- A run design draws to its own side. Amends m2 decision 4 ("outside-run art forks to both edges") for calls with a design.
- Pre-snap drawing is built from the human's own call only, his drawing included.
- The app reads alignments from `data/plays/alignments.json`. The three alignment blocks leave templates.json (its version moves to 3). This is the single alignment file left open in docs/DECISIONS.md ("Plausible tackler", open items) and is part of Open question 1.

## Milestones

In dependency order. Each goes through code-reviewer and test-writer. "Outcome digest" is the step 5 per-game digest with the fields this spec adds left out, checked by scripts/game/outcome-digests.ts against a new baseline `test/fixtures/m3-baseline-digests.json` written on the last commit before C. "Existing call" means an offense call with no `design` and no `custom` and a defense call given as a bare preset string.

### A: playbook data and schema (designed)

Files: `data/plays/alignments.json`, `library.json`, `offense.json`, `defense.json`, `config.json`; `packages/shared/src/playbook.ts`, `playbook-schema.ts`; `docs/PLAYBOOK.md`; tests.
Engine output for existing calls: byte-identical. No file under packages/sim changes. Pins go stale only if a file in the calibration import graph is edited (for example a re-export in packages/shared/src/types.ts), so avoid that here.

| # | Criterion | How it fails |
|---|---|---|
| A1 | Every playbook file parses with its zod schema. Bad fixtures are rejected: unknown slot, unknown library id, unknown concept or preset, a missing assignment, a duplicate id. | A bad fixture passes. |
| A2 | Every design maps to exactly one engine call that exists in data/engine/personnel.json. Each of the 40 offense pairs and 13 presets has at least one design and exactly one `default`. | An orphan design, an empty engine call, zero or two defaults. |
| A3 | After defaults, every on-field slot of the design's formation or package has exactly one assignment and no other slot has one. | A missing or extra slot. |
| A4 | Offense legality: OL only block, a run has exactly one carrier who is an RB or QB, a pass has a QB action and at least one route, a screen has a route behind the line, play action has a fake. | An illegal design passes. |
| A5 | Defense legality: each design's rushers, deep defenders and man or zone match its preset's definition in data/caller/config.json, and a man design covers every eligible receiver spot of every formation. | A design outside its preset. |
| A6 | No (formation, concept) group and no preset group has more than 6 designs. A 7-design fixture is rejected. | 7 accepted. |
| A7 | The catalog matches the tables above: 107 and 40, the same names per group, labels unique within a group. A change to the list is a docs/DECISIONS.md entry. | Drift from the spec. |
| A8 | Every design has every tag from the closed lists. `tagApplies` returns the expected value on a fixture with each bin edge. | A missing tag or a wrong edge. |
| A9 | `alignments.json` deep-equals templates.json `offense`, `defense` and `presetAlignment` until F removes them. | Drift. |
| A10 | docs/PLAYBOOK.md lists every design with description and tags, and a test fails on drift. | Drift. |
| A11 | Reviewer check: no label or description uses a team, city, coach or product name. | One does. |

### B: assignment classifier (designed, one cited rule)

Files: `packages/sim/src/playbook/classify.ts` (not imported by the engine yet), `data/plays/config.json`, `docs/RULES.md`, tests.
Engine output for existing calls: byte-identical. New files only.

| # | Criterion | How it fails |
|---|---|---|
| B0 | Lookup step: the rule for who may go out for a pass, and the field's width, are cited in docs/RULES.md from the current rulebook and read from data. B does not merge before this. | A rule written from memory. |
| B1 | Same path, context and config give the same result. No RNG, no DOM (the purity test covers the file). | Any difference. |
| B2 | Total: over 100,000 seeded random canonical paths and every slot, the result is one kind with its features or one reason from the closed list. | A throw, two kinds, or an unknown reason. |
| B3 | Library agreement: every library route, sampled as a canonical path at every slot that uses it, classifies to its declared family, bucket and direction. | A mismatch. |
| B4 | Mirror: mirroring the path and the alignment in x gives the same family, bucket, break depth and direction, with the end side flipped. | Any other change. |
| B5 | Adding collinear points, or quantizing an already canonical path, changes nothing. | A changed feature. |
| B6 | One fixture per reason code, including an out-of-bounds deep route near the goal line and at each sideline. | A wrong or missing reason. |
| B7 | Defense: blitz, zone (each level and third) and spy, with a fixture on each side of every threshold. | A wrong kind at a boundary. |
| B8 | Depth buckets read the same edges as the pass leaves from one place. | Two sets of edges. |
| B9 | `quantizePath` is idempotent, and on any finite input it returns a canonical path or a reason. | A non-canonical output. |
| B10 | Speed: p99 at most 1 ms per call on Joseph's machine, recorded in docs/PERF.md (designed budget, for live feedback). | Over budget. |

### C: designs and custom assignments travel in the calls (schema change)

Blocked on Open question 1. Files: `packages/sim/src/caller/offense.ts`, `engine/resolve.ts`, `engine/participants.ts`, `engine/errors.ts`, `loop/coach.ts`, `loop/play.ts`, `loop/requests.ts`, `loop/session.ts`, new `packages/sim/src/playbook/choose.ts`; `packages/shared/src/game.ts`, `play.ts`, `m2-schema.ts`, `engine.ts`; `scripts/game/outcome-digests.ts`; `test/fixtures/m3-baseline-digests.json`.
Engine output for existing calls: byte-identical, switch on or off. With the switch on, AI calls gain a design and credits follow assignments, and every outcome digest is still identical. Pins go stale (code hash, and data hashes once the playbook files join `dataHashes`, which happens here, once).

| # | Criterion | How it fails |
|---|---|---|
| C0 | Joseph's sign-off on the schema change is a docs/DECISIONS.md entry before merge. | Merged without it. |
| C1 | The types are as written above. A defense call with neither design nor custom is a bare string in every event and request. | An object where a string is due. |
| C2 | A design that does not belong to the call's engine call throws `badDesign`. A custom assignment that fails B, or comes with no design, throws `badCustom` with the reason. | Accepted, or untyped. |
| C3 | `detail.designs` and `detail.custom` are set exactly when the call carried them, with the features the classifier returned and the player on the field at that slot. | Missing, extra, or a different player. |
| C4 | Byte-identity: (a) switch off, all 10,000 in-sample outcome digests equal the baseline; (b) switch on, the same after dropping the new keys and credits; (c) 60 scripted human games with legacy answers (test/m2 bot) digest as before. | Any digest changes. |
| C5 | `designShares` takes no RNG and sums to 1 over the engine call's designs in proportion to `aiWeight`. Swapping the design stream changes designs and no outcome digest. | A share off, or an outcome moves. |
| C6 | The AI's call and design functions take nothing from which the other side's call, design or drawing can be reached (type-level test, as M2 E6). No request in a scripted game holds the opponent's design or drawing before the snap. No AI call in 10,000 games has `custom`. | A leak, or an AI drawing. |
| C7 | An answer with a design and a custom assignment becomes that call. An illegal one returns `illegalDesign` or `illegalCustom` and leaves the session unchanged. Replay from the input log gives a deep-equal record, and save and resume round-trips (M2 E2, E3) with paths in the log. | Divergence. |
| C8 | Same call repeats the design and never the custom assignment. | A drawing repeats. |
| C9 | A version 2 record parses with the version 3 reader. A legacy session log replays to a deep-equal record. | An old record or log breaks. |
| C10 | Crediting: with a design, over the step 4 contract states, the target runs a route, the ball carrier is the design's carrier, the sacker rushes, blitzes or spies, the interceptor is in coverage. Over the in-sample run, 20+ completions go to intermediate and deep routes more often than those routes' share of all targets. | A blocker catches a pass, or a flat relation. |
| C11 | Purity: no DOM, no zod, no `Math.random` in the new sim files. | A violation. |
| C12 | Speed with the switch on: the 25 ms per game gate and the 10 ms answer-to-request p99 (docs/PERF.md) still pass. | Over budget. |

### D: design effects, centered (designed)

Files: `data/plays/modifiers.json`, `modifiers.centered.json`, `tolerances.json`; `packages/sim/src/playbook/profile.ts`, `modifiers.ts`; `engine/resolve.ts`, `engine/why.ts`; `data/engine/why.json`; `packages/shared/src/engine.ts` (`TRACE_FIELDS`, `EngineData`); `scripts/plays/center.ts`, `scripts/plays/report.ts`; `docs/PLAYBOOK_REPORT.md`, `docs/MODEL.md`.
Engine output: switch off, byte-identical for every call. Switch on, an existing call is still byte-identical, and every call that names a design can change. This is the first milestone that changes outcomes.

Calibration plan: `data/plays/tolerances.json` and the bounds are committed alone before any D code or run, and the lead records the sha256 in docs/DECISIONS.md. D runs in-sample only (`calibrate.ts --target insample`, 10 leagues x 1,000 games, on against off, same seeds). No holdout computation in D.

| # | Criterion | How it fails |
|---|---|---|
| D1 | `modifiers.json` validates. Every group multiplier is inside the group bound. Every cell that is not 1 has `designed` and a reason. The protection tables are monotone. Nothing in the file or in MODEL.md calls it fitted or data-derived. | Out of bounds, unlabeled, or mislabeled. |
| D2 | `profile` is pure, and each of the 147 designs' derived traits equal its authored traits. | A mismatch. |
| D3 | Centering: for every (formation, leaf, preset) and class, the AI-share-weighted mean of the centered factor is 1 within 1e-9. Running the script twice gives identical bytes. A CI test fails when the file's input hashes are stale. | Off-center, nondeterministic, or stale. |
| D4 | Switch off: all in-sample outcome digests equal the baseline. Switch on: over the step 4 contract states, an existing call's PlayResult deep-equals the switch-off result. | Any difference. |
| D5 | For every catalog pair in every engine call pair, the product before centering is inside the total bound and class probabilities sum to 1. | Outside. |
| D6 | Every design matters: in each group, any two designs differ, against at least one catalog defense design, by at least the pre-registered minimum relative effect on some class (proposed 0.05; step 4 D6 uses 0.02, standouts 0.10), and no design is dominated by a sibling against every catalog defense design. Same for defense groups. | A cosmetic or dead design. |
| D7 | In-sample, on against off: every scrimmage class share within 0.2 pp, points per team-game mean and SD within 0.3, turnovers per team-game within 0.05, and no gated step 5 metric goes from pass to fail. These are the M2 F1 values, as proposals the lead confirms. | Outside, or a status flips. |
| D8 | Variance is kept: the design factor touches class weights only. Per leaf and class, mean yards on against off are within the engine's `meanYards` tolerance (0.4 yd), and the points SD is inside D7. | The pool draw changed, or spread shrank. |
| D9 | Why: one trace entry (`design`) per applied rule that moved the enforced class, with the rule, both design labels, the class and the multiplier. Over 10,000 plays, every design or rule a why line or headline names is in that play's trace with the value shown, and no rule with factor 1 on the class is cited. An unbound slot still throws. | A cited factor the engine did not use. |
| D10 | Two-point tries use designs with the same factors. MODEL.md says they are close to centered, not exact, as for the matchup table. | Missing or overclaimed. |
| D11 | Speed: the 25 ms per game gate passes with the switch on, recorded in docs/PERF.md. | Over budget. |
| D12 | MODEL.md gains "Playbook and play designs" with each part labeled as in "Status of each part". | Missing or mislabeled. |

### E: custom assignments change the play (designed)

Files: `packages/sim/src/playbook/profile.ts`, `modifiers.ts`; `engine/resolve.ts`, `engine/why.ts`; `data/engine/why.json`; `scripts/plays/report.ts`; tests.
Engine output: switch off, byte-identical. Switch on, every call without a custom assignment deep-equals its result after D. Only calls with a custom assignment change, and the AI never makes one, so league totals do not move.

Calibration plan: none at league level (E12 proves it). The exploit soak (E9) runs on in-sample leagues only.

| # | Criterion | How it fails |
|---|---|---|
| E1 | The play's profile is the base design's with that slot's assignment replaced by the classified features, and nothing else. `detail.custom.features` equals what `classifyPath` returns for the same input. | Any other input reaches the engine. |
| E2 | A drawing whose features equal the base assignment's gives class probabilities identical to the base design. | A free change. |
| E3 | Sending a blocking RB or TE out never lowers the sack probability against any catalog defense design, and raises it wherever the bound is not reached. Keeping a route runner in never raises sacks and never lowers incompletions. | A reversed or flat relation. |
| E4 | Same slot, same family, deeper break: the 20+ completion, incompletion, sack and interception probabilities never fall. | A reversed relation. |
| E5 | Three named fixtures show a trait gained or lost by a drawing, and the trait's rule appears in or leaves the trace. | The matchup did not change. |
| E6 | Defense: a blitz never lowers sacks and never lowers completions; a spy never raises scrambles; a zone drop moves the vacated and covered zones as drawn. One fixture per kind per preset family (man, zone). | A wrong direction. |
| E7 | X1: over every design x drawable slot x classifier output x catalog opposing design, the product before centering stays inside the total bound. | Outside. |
| E8 | X2: over the same enumeration, no custom play dominates its base design against every catalog opposing design. Counts in docs/PLAYBOOK_REPORT.md. | One dominating drawing. |
| E9 | Soak, report only until Joseph sets a threshold (Open question 4): 1,000 games each for a bot that plays catalog designs at the AI's shares and a bot that also makes, every pass snap, the drawing that scores best on valence against the AI's average design mix. Points per game, yards per play, sack and turnover rates, side by side. | Missing. |
| E10 | Why: a `custom` trace entry holds the player (number, name), the classified label, the class and the ratio of the design factor with and without the drawing. It is cited only when that ratio is not 1. Headline in plain words, no multipliers. | A drawing credited for nothing, or a silent effect. |
| E11 | Every reason code is reachable through `resolvePlay` as `badCustom` and through `answerSession` as `illegalCustom`, with the session unchanged. | An untyped failure. |
| E12 | With the switch on, all 10,000 AI against AI in-sample digests are identical before and after E. | Any digest changes. |
| E13 | A pre-snap foul on a snap with a drawing: `noPlay`, the drawing recorded, no `custom` factor in the trace. | A factor on a play that never ran. |

### F: animation follows designs and drawn paths (app, designed)

Files: `packages/app/src/ui/art.ts`, `timeline.ts`, `templates.ts`, `motion.ts`, `packages/app/src/engine/types.ts`, `data.ts`; `data/ui/templates.json` (version 3), `data/ui/motion.json` (one new key, `followTolYards`); app tests.
Engine output for existing calls: byte-identical. No sim file changes. Can start once C is in.

| # | Criterion | How it fails |
|---|---|---|
| F1 | A call with no design draws exactly as before: the existing art and timeline tests pass unmodified. | An old test changes. |
| F2 | Each engine call's default design draws the same paths as the legacy template for that call, within 0.01 yd. | A visible jump for default plays. |
| F3 | Card, field preview and live play use one geometry function per design. | Two drawings of one design. |
| F4 | Before the read, each unnamed mark stays within `followTolYards` of its assignment's path, on the timeline keys (so what was picked is what is seen). | A mark off its route. |
| F5 | The redrawn player stays within the same tolerance of his drawn path until the read. As target he leaves it only after its last break, and the catch anchor's time and place are the facts'. | He ignores the drawing, or an anchor moves. |
| F6 | The M2 motion contract tests (anchors fixed, the 2.5 yd ring, only named players touch the ball) pass over at least 1,000 seeded design plays, half with a drawing (heavy). | A contract break. |
| F7 | No leak: the pre-snap states are the same bytes whatever the opponent's design or drawing is. | They differ. |
| F8 | A run design draws to its own side when the engine gives no `runLocation`. | Art and motion disagree. |
| F9 | Reduced motion and skip show the drawn path on the final frame. | Missing. |
| F10 | `timeline()` stays inside its docs/PERF.md budget (target 20 ms) on design plays. | Over budget. |
| F11 | No shipped design lacks art (the "No diagram for this call" state stays unreachable in shipped data). | A design without art. |
| F12 | The app reads alignments from `data/plays/alignments.json` and templates.json has no alignment blocks. | Two sources. |

### G: turn it on, playtest and calibrate

Files: the switch; `packages/app/src/engine/session.ts` (save version); `data/game/calibration.insample.json`, `calibration.json`, `data/engine/validation.json`; `docs/GAME_REPORT.md`, `ENGINE_REPORT.md`, `PLAYBOOK_REPORT.md`, `DECISIONS.md`, `MODEL.md`, `MENUS.md` (a pointer to PLAYBOOK.md), `CLAUDE.md` (project notes).
Engine output: an existing call is still byte-identical. Every AI game changes, because AI teams now call designs. This is the only milestone that moves the calibrated baseline, and only if Joseph says yes to Open question 2.

Calibration plan, in pin-safe order, on a quiet machine:

1. In-sample first, switch on: the step 5 in-sample summary must show no gated metric going from pass to fail against the committed one, and D7 must still hold.
2. Engine validation, pins only (engine run 16): it plays calls without designs, so every metric must equal run 15.
3. One game holdout run, switch on, counted as step 5 game run 21 in the run table and labeled with what changed. Tolerances in data/game/tolerances.json are not touched.
4. Stop rule: a new gated failure in step 1 or 3 stops the milestone. The numbers go to Joseph. Nothing is tuned on a holdout number. The fallback is the standouts precedent: baseline stays switch-off, the app plays switch-on, and D7 is the on-against-off evidence.

| # | Criterion | How it fails |
|---|---|---|
| G1 | The app plays with the switch on. An older save reads as older. | A stale save loads. |
| G2 | Step 1 passes. | A status flips in-sample. |
| G3 | Step 3 shows 0 new gated failures, or the stop rule is followed and the fallback recorded. | Tolerances or data edited after a failing run. |
| G4 | Step 2: every engine metric identical to run 15. | A metric moves. |
| G5 | Playtest gate: the playtester soaks 1,000 human-seat games with random valid drawings on both sides (no error, no invariant violation), Joseph has the E9 report, and Joseph plays a game from the designer's screens. | Skipped. |
| G6 | Every run is a row in the docs/DECISIONS.md run table, and MODEL.md, PLAYBOOK.md and CLAUDE.md are current. | Missing. |

## Edge cases and reachable states

- Empty has no back: its runs are QB designs and its screens go to receivers. Heavy has no wide receivers: its passes go to tight ends and the back.
- A rare engine call from the AI (a deep pass from Heavy, a sneak from Shotgun) still has a design, because every pair has a default.
- A drawing on a two-point try: allowed. Deep paths are out of bounds there (the end line is 12 yards from the 2), so they are rejected, not clipped.
- A catalog route deeper than the field allows near the goal line is still legal. The engine does not read it for bounds and the app clamps the drawing, as it does now.
- A drawing on a snap with a pre-snap foul: recorded, no effect (E13).
- A foul paired with an incompletion replaces the play: the trace cites design and custom factors on the incompletion class, as it does for the matchup.
- A drawn slot that is not on the field in this formation, a lineman, the quarterback: rejected with a reason.
- A tap or a tiny path: block for an RB or TE, spy for a defender, `tooShort` for a wide receiver.
- The redrawn player was the design's `primary`: the mark goes with the slot, his weight follows his new route.
- A defender redrawn out of man coverage leaves his receiver uncovered. Redrawn out of the only deep zone, the play has no deep defender for that snap.
- Same call after a drawn snap: the design repeats, the drawing does not.
- A call with no design in a switch-on game (tests, old logs): resolves as today and draws the legacy template.
- A playbook or centering file that fails validation: the existing "Game data failed its check" state, naming the file.

## Dependencies and sequencing

- No new package. zod only, in packages/shared. The sim still imports no zod.
- A first. B needs A. C needs A and B and Joseph's sign-off. D needs C. E needs B, C and D. F needs A and C and can run beside D and E. G needs everything and the designer's screens.
- The recommendations spec can start on A (tags, `tagApplies`) and C5 (`designShares`). Anything it computes before the snap must use the AI's average mix, never the opponent's call.
- Pins. C, D, E and G edit files in the calibration import graph, so each stales the code hash. Re-pinning recomputes 2024-2025 and is a counted run. I recommend the lead land C, D and E on one branch and re-pin once, in G's runs, as with "Pins-only reruns after M2 A-E".
- The eligibility and field width lookups (B0) are research work before B merges.

## Locked and likely to change

Locked: the seven lead decisions; no new engine calls; the engine reads features, never paths or pixels; the classifier is pure and the engine runs it itself; one alignment source; existing calls resolve byte-identically; centering is inside each engine call pair; nothing is fitted and no holdout number tunes anything; tolerances are committed before the first run.

Likely to change: the catalog list and counts after playtest; trait lists, thresholds and every number in `modifiers.json` (inside the bounds, each change logged); the bounds themselves, before the first run only; one custom assignment per side; Same call not repeating a drawing; tags, once recommendations uses them; AI design weights, once coaches have personalities; whether standout shares follow the design.

## Open questions for Joseph

1. Open: the schema change. `OffenseCall` and the defense call gain `design` and `custom`, `DecisionAnswer` gains the same, the game record moves to version 3, `EngineData` gains the playbook, and alignments move out of data/ui/templates.json. Default: approve as written. Nothing in C or F merges before the DECISIONS.md entry. A and B can go ahead.
2. Open: does the calibrated 10,000-game baseline play with designs on? Default: yes, at G, in-sample first and then exactly one counted holdout run. If it fails, fall back to the standouts precedent.
3. Open: the catalog, 147 designs as listed. Default: build the list as written and change it after the playtest.
4. Open: the E9 threshold, how much better than a catalog-only coach a drawing bot may score before it counts as an exploit. Default: none set. E9 reports, and you set a number before G. Unknown until the first report.
5. Open: a flat cost for any drawn route (for example a slightly higher incompletion rate). Default: none. The trade-offs in the rules are the cost, and E9 says whether that is enough.
6. Open: drawing the ball carrier's path on a run. Default: yes, the carrier only, inside the concept's gaps.
7. Open: the bounds (0.85 to 1.20 per rule group, 0.75 to 1.35 in total), the D6 minimum effect (0.05) and the D7 tolerances (the M2 standout values). Default: as proposed, committed before the first run.
8. Open: should Same call repeat the drawing? Default: no.
9. Open: nflverse participation has a `route` column (docs/DATA.md). Should AI design or target shares ever be fitted from it? Default: no in M3. A fitted version would need its own spec, a license check and the holdout rule.
10. Open: should a design's target shares feed the standout factors? Default: no, standouts keep the base shares.
