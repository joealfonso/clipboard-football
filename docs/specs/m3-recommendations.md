# M3: recommendations (play calls and game decisions)

Status: draft, 2026-11-23. Owner: Joseph.

## Goal

Before every call the user makes, the game can show a short ranked list of what his coordinator would call and why, built from the situation, the opponent, both teams' players and who is available, with the coordinator's ratings and style shaping the advice.

For: Joseph as the player (he asked on 2026-11-23 for "recommendations based on the situation. coach stats can influence this. also have recommendations based on the other team, injured players, good and bad matchups"), the designer who puts it on the calling screen (docs/specs/m3-calling-screen-playbook-and-routes.md), and the engineer and test-writer who build and check it.

In plain words: the coordinator starts from what real NFL coaches call in this spot (fitted), then leans toward calls that do better against what this opponent is likely to be in, and toward calls that use the players who have the edge today. A better coordinator judges those edges more accurately and picks up the opponent's habits sooner. He never sees the opponent's call for this snap or the dice.

## Non-goals

- The screen. The designer owns how and when recommendations show. This spec fixes what the recommender returns.
- The bigger playbook and custom routes (docs/specs/m3-playbook-and-custom-routes.md). This spec only reads the shared play design contract (below).
- An injury model. Only the availability input is specified. Who gets hurt, for how long, depth charts and playing hurt are M5.
- A win probability model. None exists in the repo (only expected points, data/game/ep.json). See open question 4.
- Hints for penalties, challenges, the coin toss and kickoffs (open question 6).
- The AI reading the human's tendencies. AI callers still see the situation only.
- AI tempo by coach style, and hiring, firing, paying or growing coaches (M8).
- Any change to play outcomes. With recommendations on or off, the same seed and answers give the same game.

## What exists today (checked in the code, 2026-11-23)

| Area | Finding |
| --- | --- |
| Coaches | Only the average coach exists (`averageCoach` in packages/sim/src/loop/coach.ts, `averageCoachFor` in loop/league.ts). No coach has ratings, a style or a name. `CoachPolicies` is already one object per team and `setupGame` takes a `coachFor` function, so a styled coach can slot in without changing the loop. |
| Injuries | None. No availability, stamina or depth chart anywhere in packages/. `onField` (engine/players.ts) fills each unit with the first n players of a position in pool order. `generateTeam` makes exactly enough players for the largest unit, so there is one QB, one K and one P per team and no backup for them. |
| Fitted caller | `offenseShares`, `formationShares` and `defenseShares` (packages/sim/src/caller/) return full distributions with no Rng. This is the hook the step 2 spec left for M3. |
| Expected points | `expectedPoints(down, distance, yardLine100, ...)` in loop/coach.ts reads data/game/ep.json (fitted, 2016 to 2023). It knows nothing about score or clock. |
| Decision policies | Fourth down is inside the fitted caller (`o4Top`, `o4Kick`), tries use `oTry` plus the designed late try chart, timeouts use the fitted `timeoutShare`, the kneel-out test is the caller's `kneelOut` bin, and the masks in `CallerMasks` remove spikes with a stopped clock and field goals out of range. data/game/challenge-policy.json holds the designed challenge rule. |
| Matchup table | data/engine/matchup.json is designed. The engine reads matchup.centered.json: one multiplier per outcome class for each offense leaf x defense preset, plus a formation x package layer. |
| Ratings in the engine | data/players/ratings.json effects compare unit averages by position (for example WR speed and QB throw power against CB and S speed for the "speed on the outside" effect). There is no one-on-one matchup in the engine. Individual players matter beyond the average only through standout plays (rating 90 or more, data/engine/standouts.json). |
| Class probabilities | Computed inside `createEngine` (`drawClass` in engine/resolve.ts) and not exported. Each run or pass play records them in `detail.classProbabilities`, which gives a parity test. |
| Observed calls | Every past play event in the game log carries both teams' calls (`GameEvent` in loop/play.ts). The pending snap's AI call is never in the log or the request. |
| Rng | `Rng.fork()` moves the parent stream 2^64 draws ahead, so calling it on the game stream changes the game. Side streams so far are built with `Rng.fromSeed` or from a copied state (`creditStream`, `numberStream`). |
| Protocol | packages/app/src/engine/protocol.ts has no recommendation message. `TeamSummary` has no coaches. |

## Decisions from the lead (locked)

1. A pure function in packages/sim, in new files, with balance in data/recommend/ validated with zod. It returns a ranked short list (three by default) for offense or defense, each with a score, a one-line reason and the factors used.
2. It never consumes the game Rng and never changes an outcome.
3. Reasons come only from factors the recommender used, the same rule as the engine's why line.
4. Factors: situation, matchup, the other team, personnel, availability, coach. Each is marked fitted, designed or mixed.
5. Fourth down, two-point and clock decisions get a recommendation from the existing policies and expected points.
6. Headline first (top pick, one reason), full factor breakdown one click away.
7. The recommender ranks engine calls first, then picks a play design within the top calls by tag.

## Design

### Shared play design contract

Owned by the playbook spec. The recommender reads only this much of a design: an id, the one engine call it maps to (offense: formation and concept; defense: preset), and a list of tags. If the playbook spec names the fields differently, one adapter in packages/sim/src/recommend/ maps them.

Until designs exist, each engine call stands for itself and options carry no design id. When designs exist, for each recommended call the recommender picks one design that maps to it: first the designs with the most tags matching the current situation, then the one called least often by the user this game, then catalog order. No Rng. Three situation tags are defined here as rules over `Situation` fields, in data, reusing thresholds already in the repo: `shortYardage` (yards to go 2 or less, as in ratings.json), `redZone` (yard line 20 or closer, as in the caller's zones), `twoMinute` (120 seconds or less in the half, as in the catalog's kick rule). Unknown tags are ignored.

### Inputs

The wiring layer builds these from the session. The recommender itself takes plain data only: no Rng, no `CoachPolicies`, no `GameRun`.

| Input | Contents |
| --- | --- |
| Request | The pending `DecisionRequest` (kind, screens, the state it was asked in) and the `Situation` and `CoachView` for that state. |
| My team | Player pool as the engine sees it in this game (`gamePlayers`, home field applied), the card pool for the numbers shown, my staff, my unavailable player ids. |
| Opponent | The same pools, the opponent staff's styles (public; their ratings are not read), their unavailable player ids. |
| Observed | Past scrimmage plays of this game, oldest first: the situation before the snap, which team had the ball, the offense call and the defense preset. Tries, kicks and plays wiped out before the snap (`noPlay`) are left out. Nothing from the pending snap. |
| Game | The game seed, `state.playCount`, and whether standout plays are on in this game. |
| Designs | Optional list of play designs. |

### Output

`null` for request kinds with no recommendation (toss, kickoff, penalty, runoff, challenge, and continue without a legal timeout). Otherwise:

| Field | Contents |
| --- | --- |
| `plays` | Ranked options, best first, at most `listSize` (3). Present for `offenseCall`, `defenseCall` and `try` requests. |
| `decision` | Ranked decision options when a kick is legal on this snap (go, punt, field goal) or on a try (extra point, go for two). Otherwise null. |
| `clock` | At most one clock action advised instead of a normal snap (timeout, spike, kneel, hurry up, run the clock), or null. |
| `coach` | Which coordinator is speaking: role, name, ratings, style. |

Each option has: the engine call, the design id when designs exist, the answer `path` that makes this call on the pending request, a `score`, a one-line `reason`, and `factors`. Each factor entry has an id, its label (fitted, designed or mixed), its contribution to the score as the coordinator perceives it, a text line, and structured details (shares, counts, player ids, names, numbers and ratings). The headline is `plays[0]` (or `decision.options[0]` when a decision is present) with its reason. The breakdown is its `factors`.

### Factors

| Id | Label | What it measures | Source |
| --- | --- | --- | --- |
| `situation` | fitted | How often real coaches make this call here (down, distance, field position, clock, score). | Caller tables through `offenseShares`, `formationShares`, `defenseShares`. |
| `matchup` | designed | How this call does against the mix of calls an average opponent shows in this situation. | matchup.centered.json through the engine's class probabilities. Never described as data-derived. |
| `opponentStyle` | designed | The change when the opponent coordinator's known style is applied to that mix. | Staff styles and the style tilt (milestone A). |
| `opponentTendency` | mixed | The change from what they have called so far this game. | Observed counts (facts) through the designed estimator below. |
| `personnel` | designed | The change from both teams' full-strength on-field ratings, through the rating effects and standout kinds the engine applies to this call. | ratings.json, standouts.json, the engine's unit fill. |
| `availability` | designed | The change from unavailable players on either side, compared with full strength. | The availability input. |
| `coachStyle` | designed | My coordinator's taste among the good options. | Staff styles. |
| `lateChart`, `kneelOut`, `timeoutShare`, `spikeShare`, `tempoWindow` | designed or mixed | Decision and clock rules that already exist (milestone E). | Caller config, coach tables, tempo-modes.json. |

A factor whose contribution is exactly zero for an option is left out of that option's `factors` and can never be its reason.

### Value of a call (mixed)

All value factors are in expected points, from one definition:

- `P(class | call, opposing call, lineups)` is the engine's own class probability for a run or pass: baseline cell, matchup and formation multipliers, rating effects, and standout factors when standouts are on. No draw.
- `V(class | leaf, situation)` is the mean, over the real plays in the pool the engine would draw from for that class here (same pool backoff, pool weights), of what the play leaves the offense: points scored on the play plus the fitted expected points of the next snap, negative when the opponent has the ball. A touchdown counts its points plus the engine's baseline extra point make share. A score adds no term for the kickoff that follows (designed, the same convention as the existing penalty choice value). Fouls and the clock are ignored. On a two-point try, V is the try's points.
- `E0(call)` uses the baseline class shares alone. `edge(call | belief, lineups) = sum over opposing calls of belief x sum over classes of P x V, minus E0`. For a defense call the sign is flipped and the sum runs over the offense calls in the belief.

The value factors telescope, so their sum is the full edge:

```
matchup          = edge(B0, L0)
opponentStyle    = edge(Bs, L0)    - edge(B0, L0)
opponentTendency = edge(Bo, L0)    - edge(Bs, L0)
personnel        = edge(Bo, Lfull) - edge(Bo, L0)
availability     = edge(Bo, L)     - edge(Bo, Lfull)
```

B0 is the fitted share distribution for the situation, Bs is B0 with the opponent's style applied, Bo adds the observed tendency. L0 is league-average players (every rating effect at 1, no elites), Lfull is both teams with everyone available, L is today's lineups.

The base value of a call (E0) is never part of the score. The situation factor already says what is normal here, and adding E0 would recommend passing on almost every down. This keeps the layer centered: against an average opponent with average players and nothing observed, the list is the fitted caller's most common calls, moved only by the designed matchup table.

### The other team: belief (mixed)

Calls are grouped (designed partition in data, every call in exactly one group). Proposed: offense groups inside run, outside run, quick pass (short, screen), downfield (intermediate, deep), play action; defense groups loaded box (Run Stuff, Goal Line), blitz (the two blitz presets), man (Nickel 2-Man, Nickel Cover 1), zone (Base Cover 3, Base Cover 2, Nickel Cover 3, Nickel Cover 4, Nickel Cover 2), deep shell (Dime Cover 4, Prevent). Situations are grouped into three classes (designed): early downs (1st and 2nd), short (3rd or 4th with 3 or less to go), long (3rd or 4th with 4 or more).

For the current class s and each group g:

```
ratio(s, g)  = (n + k) / (e + k)
belief(call) = prior(call) x ratio(s, group of call), renormalized to sum to 1
```

n is how many times the opponent called group g in class s this game. e is how many times the prior said to expect it over those same snaps. k is a pseudo-count that falls as my coordinator's Scouting rises, so a better coordinator moves sooner. The prior is the fitted share with the opponent's style applied at a strength that rises with Scouting (a poor scout under-accounts for a known style and has to learn it from the calls). With nothing observed the ratio is exactly 1.

The reason text quotes n and e ("They have blitzed on 6 of 9 third and longs; an average defense would on about 2").

### Personnel and availability (designed)

Lineups come from one function: the engine's `onField` fill applied to the pool with unavailable players removed, pool order kept. With an empty list it returns exactly what the engine fields. A formation or package that cannot be filled is excluded from the list with the code `cannotFieldUnit`.

The personnel details list each rating effect and standout kind that applies to the call with a multiplier other than 1: the effect's existing label from ratings.json, the class it moves, and for each side the on-field player who contributes most to it (name, number, position, rating name, card value). Because the engine compares unit averages, the text says "your receivers against their corners, led by" a named player. It never claims a one-on-one matchup the engine does not model (open question 2).

Deferred to M5, stated plainly: the injury model itself, a depth chart, the engine fielding the same reduced lineups (M5 must pass the same availability list to `gamePlayers` so the recommender and the engine agree), and roster depth so every unit can be filled. In M3 the game always passes empty lists. Only tests pass anything else.

### Coordinators (designed, small)

Each team has an offensive and a defensive coordinator, generated from the league seed on a stream of its own (`Rng.fromSeed` of a value derived from the league seed, a salt and the team name; the league generator's stream is not read or moved). Names come from data/players/names.json.

| Field | Range | Effect |
| --- | --- | --- |
| Play calling | 0 to 99 | How accurately he sizes up matchup, opponent, personnel and availability edges. |
| Scouting | 0 to 99 | How soon observed tendencies count (k) and how fully he accounts for the opponent's known style. |
| Game management | 0 to 99 | How accurately he sizes up fourth down and try values. |
| Style, offense | -2 to +2 each | `passLean` (run heavy to pass heavy), `fourthDown` (cautious to aggressive), `tempo` (slow to fast). |
| Style, defense | -2 to +2 | `blitzLean` (coverage first to blitz heavy). |

Ratings are drawn from the same designed curve players use (data/players/ratings.json `curve`). Style steps are drawn from a symmetric designed distribution, so the league is centered on 0.

Coordinator error is on the size of real edges, never invented: `perceived = true x exp(sigma x z - sigma^2 / 2)`, one z per option and value factor, sigma falling linearly with the rating to its value at 99 (proposed 0). A perceived edge never changes sign and a zero edge stays zero, so a weak coordinator misjudges how much an edge matters but never reports an edge that is not there. The breakdown shows perceived contributions only. The situation factor carries no error (it is the book).

The z values come from the recommendation stream: `Rng.fromSeed` of a non-negative safe integer mixed from the game seed, `state.playCount`, the request kind and a fixed salt. It never reads, copies, forks or advances the game Rng, so asking again in the same dead ball (after a timeout or a tempo change) or after resuming a save gives the same advice.

`coachStyle` adds a designed bonus per style step to the options on that style's side (pass calls for `passLean`, blitz group presets for `blitzLean`, go for `fourthDown`), only for options whose score before style is within a designed window of the best. Style reorders good options. It cannot lift a poor one to the top.

Never an oracle: the inputs hold nothing about the pending snap's opposing call, and the recommender has no access to the game Rng.

### Score

```
score = wSituation x ln(share / top share)
      + wValue x timeScale x (sum of perceived value factors)
      + coachStyle
```

Candidates are the legal engine calls whose fitted share is at least `minShare`. Ties go to catalog order. The list holds at most `maxPerConcept` options with the same play concept (proposed 1, so three formations of the same pass do not fill the list). `timeScale` is a designed factor per existing time bin (`time5`), below 1 at the end of a half, where expected points ignore the clock and the fitted shares know better. Weights are separate for play calls and for decisions.

### Decisions (mixed)

- Fourth down (and any snap where a kick is legal): options go, punt, field goal. Each has the expected points of what it leaves under the engine's own model with no draw (go: the top recommended play's full value; punt: the punt table's outcome mix; field goal: the engine's make chance with kicker effects), and the fitted share from `o4Top` and `o4Kick`. A field goal the caller's range mask removes is not offered. Ranked by the score formula with the decision weights. `fourthDown` style applies to go.
- Try: extra point (make share x 1) against go for two (2 x the top two-point play's conversion chance), with the fitted `oTry` share. Where the designed late try chart has a cell, its choice ranks first with the factor `lateChart`.
- Clock, from existing policies only, no value model: kneel when the caller's `kneelOut` bin says the clock can be run out and the kneel masks allow it; spike when the fitted spike share, masks applied, is at least a designed threshold; timeout (offense, defense, and continue requests that carry a legal timeout) when the fitted `timeoutShare` is at least a designed threshold; hurry up or run the clock when the situation is in the designed window that tempo mode stands for (tempo-modes.json), widened or narrowed by the `tempo` style. The reason quotes the share.

### AI teams and coach styles: what this spec includes

Included: the staff model, the generator, and the style tilt as a pure function on caller shares (milestone A), because the recommender needs it for the opponent prior. Also included as the last milestone (H): AI teams call through their coordinators' `passLean`, `fourthDown` and `blitzLean`, behind a data flag that is off for the calibrated baseline, centered and gated on the calibration slice.

Why H is here: until AI teams call with a style, every opponent is the average coach, so the two opponent factors have nothing real to find (observed differences are sampling noise, which the estimator shrinks toward zero). H is what makes "based on the other team" true in play. It can be moved to a separate AI coordinators spec without touching A to G.

Left for that later work: AI tempo by style (it moves plays per game, a gated total), per-game game plans, AI reading the human's tendencies, and personalities beyond these three axes.

### Files

| File | Kind | Contents |
| --- | --- | --- |
| `data/coach/staff.json` | designed | Rating names, style axes and step labels, style step weights, tilt per step per axis, `centering`, `enabled` (H). |
| `data/recommend/config.json` | designed | Weights, `listSize`, `maxPerConcept`, `minShare`, style bonus and window, sigma range, k range, style knowledge range, `timeScale`, tendency groups and situation classes, situation tag rules, clock thresholds. |
| `data/recommend/reasons.json` | designed | One reason template per factor id, with named placeholders. |
| `data/recommend/check.json` | designed, pre-registered | Seeds, game counts, the band, parity tolerances, the perf budget. Committed before the first check run. |
| `packages/shared/src/recommend.ts`, `recommend-schema.ts` | new | Types and zod schemas. packages/sim still does not import zod. |
| `packages/sim/src/coach/staff.ts`, `style.ts`, `styled.ts` | new | Generator, share tilts, the styled `CoachPolicies` (H). |
| `packages/sim/src/recommend/` | new | Lineups, odds, values, belief, play and decision recommenders, reasons, stream. |
| `scripts/recommend/check.ts`, `perf.ts`, `center-styles.ts` | new | Headless check, timing, style centering. |
| `docs/RECOMMEND_REPORT.md` | generated | Check results. |

Existing files touched, kept to exports and wiring: packages/sim/src/index.ts, packages/shared/src/index.ts and types.ts, the data loaders (scripts/game/data.ts, packages/app/src/engine/data.ts), and in F and H packages/app/src/engine/protocol.ts and session.ts. If the engineer prefers to export the engine's class probability step from engine/resolve.ts instead of mirroring it, that is a change to an existing file with uncommitted work from other sessions and needs the lead's go-ahead first. Either way B1 and B2 hold.

### Proposed starting values (designed, to be confirmed)

These go in the data files and are labeled designed. They are starting points, not measurements. They are committed before the first check run and changed afterwards only with a DECISIONS.md entry.

| Key | Proposed |
| --- | --- |
| `listSize`, `maxPerConcept`, `minShare` | 3, 1, 0.01 |
| Play weights `wSituation`, `wValue` | 1.0 per ln share, 8.0 per expected point |
| Decision weights `wSituation`, `wValue` | 0.5, 8.0 |
| `timeScale` by `time5` (H1, H1F, H2, G5, GF) | 1, 0.5, 1, 0.5, 0.25 |
| sigma at rating 0 and 99 | 1.0, 0 |
| k at Scouting 0 and 99 | 30, 8 |
| Style knowledge at Scouting 0 and 99 | 0.25, 1.0 |
| `coachStyle` bonus per step, window | 0.15, 0.5 |
| Style step weights (-2 to +2) | 0.1, 0.2, 0.4, 0.2, 0.1 |
| AI tilt per step, log odds (pass, fourth down go, blitz) | 0.10, 0.25, 0.20 |
| Clock thresholds (timeout share, spike share) | 0.5, 0.5 |

## Milestones

Each is shippable on its own branch and goes through code-reviewer and test-writer. A to E are pure sim and data. Nothing the player sees changes until F.

### A: coordinators and style tilts (designed)

| # | Criterion | How it fails |
| --- | --- | --- |
| A1 | data/coach/staff.json parses with its zod schema. Bad fixtures (a style step of 3, a missing axis, step weights that do not sum to 1 or are not symmetric) are rejected. | A bad fixture passes. |
| A2 | `staffFor(leagueSeed, teamName, data)` returns the same staff for the same inputs across 1,000 calls and a fresh process. | Any difference. |
| A3 | `leagueFromSeed` returns byte-identical teams before and after this milestone for league seeds 2026 and 1 to 20, and the existing outcome digests (test/m2/outcome-digests.test.ts) are unchanged. | Any pool or digest change. |
| A4 | Over 2,000 generated staffs, each style axis has mean within 0.05 steps of 0 and each rating has the curve's median within 2 points. | Outside. |
| A5 | The tilt functions take shares and a style and return shares, no Rng. A neutral style returns the input exactly (same numbers, not within a tolerance). Output sums to 1 within 1e-9 and a call with share 0 stays 0. | Neutral changes a share, bad sum, or a masked call gains share. |
| A6 | `passLean` +2 gives a strictly higher pass share than 0, and 0 than -2, on a fixture of at least 50 situations. Punt, field goal, spike and kneel shares are unchanged on downs 1 to 3. The same holds for `blitzLean` on the blitz group and for `fourthDown` on go against kick on 4th down only. | Wrong direction, or a share outside the axis moves. |
| A7 | The purity test covers packages/sim/src/coach/ (no DOM, no `Math.random`, no zod import). | A violation passes. |

### B: lineups, engine odds and call values (designed and mixed)

| # | Criterion | How it fails |
| --- | --- | --- |
| B1 | Parity of odds: over every run and pass play of 200 seeded games (standouts on and off), the recommender's class probabilities for the calls actually made equal the play's `detail.classProbabilities` within 1e-9. | Any class off. |
| B2 | Parity of values: for at least 12 fixture states (each down, short and long distance, own side, red zone, goal line; clock mid-quarter) and several call pairs, the recommender's expected value equals the mean value of 200,000 engine draws that carry no foul, within the tolerance in check.json (proposed 0.03 points). Heavy test. | Outside tolerance. |
| B3 | Lineups: with an empty unavailable list, the lineup for every formation and package equals `onField` for both teams of 20 generated leagues. | Any difference. |
| B4 | With the first WR unavailable, shotgun fields the 2nd to 4th WR in pool order and no other position changes. With the only QB unavailable, every formation is reported `cannotFieldUnit` and nothing throws. An unavailable id that is not on the team throws a RangeError naming it. | Wrong fill, a throw, or a silent ignore. |
| B5 | League-average lineups (L0) give every rating effect a multiplier of exactly 1 and no elites, so the edge equals the one computed with rating effects and standouts switched off, exactly, for every call pair. When today's lineups equal full strength, the availability edge is exactly 0. | Any difference. |
| B6 | Raising one on-field rating that a rating effect reads moves the edge in the effect's direction, for at least one effect per family (run, pass). Raising a rating no effect reads for that call changes nothing. | Wrong sign, or a rating the engine does not use moves the value. |
| B7 | No function in packages/sim/src/recommend/ takes an `Rng` or a `CoachPolicies` parameter (type-level test), except the stream constructor, which takes numbers and returns its own Rng. | Game Rng reachable. |

### C: opponent belief (mixed)

| # | Criterion | How it fails |
| --- | --- | --- |
| C1 | config.json's groups cover every offense leaf and every defense preset in the catalog exactly once, and the situation classes cover every down and distance exactly once. A test fails on a missing or doubled call. | Gap or overlap. |
| C2 | With no observed plays, belief equals the prior exactly. | Any difference. |
| C3 | Belief sums to 1 within 1e-9 and never gives share to a call the prior gives 0. | Bad sum or resurrected call. |
| C4 | Monotone: with k fixed, adding one more observed blitz in the long class never lowers the believed blitz share in that class, checked for 0 to 30 observations. Observations in one class leave the other classes' ratios unchanged. | Decrease, or leakage across classes. |
| C5 | For the same observations, Scouting 95 moves belief at least as far from the prior as Scouting 30, and with a +2 opponent style the Scouting 95 prior is closer to the fully tilted shares than the Scouting 30 prior. | Wrong order. |
| C6 | The observed list built from a game log contains only plays before the pending request, no tries, kicks or `noPlay` plays, and its length equals the count of such play events. | Wrong count, or a pending call present. |
| C7 | The tendency details carry n and e, and n equals the count in the observed list for that class and group. | Mismatch. |

### D: play recommendations, offense and defense

| # | Criterion | How it fails |
| --- | --- | --- |
| D1 | For every `offenseCall`, `defenseCall` and `try` request met in 200 seeded games driven through the session API, `plays` has 1 to `listSize` options in non-increasing score order, no two with the same call, at most `maxPerConcept` per concept. | Wrong size, order or duplicates. |
| D2 | Every option's `path` is accepted by `checkPath` for the pending request, and answering with it produces that engine call. | Illegal or wrong path. |
| D3 | Determinism: the same inputs give a deep-equal result on 1,000 repeat calls and in a fresh process. A golden file of at least 100 recommendations (test/fixtures/recommend-digests.json) pins them. | Any difference. |
| D4 | No oracle: at a human defense request, two setups that differ only in what the AI offense will call on this snap give deep-equal recommendations. The same for a human offense request and the AI defense. | Any difference. |
| D5 | Centered: with league-average lineups (L0) on both sides, neutral styles, nothing observed and play calling 99, the only factors present are `situation` and `matchup`. With `wValue` set to 0 in a fixture config, the list is exactly the fitted caller's top calls in share order (after the `maxPerConcept` rule). | Another factor present, or another order. |
| D6 | Reasons: every placeholder in a rendered reason is bound from one of that option's factor entries, and the reason's factor has the largest positive perceived contribution among the option's factors (the `situation` template when none is positive). A factor with zero contribution never appears in `factors` or a reason. Tested on every option of D1's games. | Unbound placeholder, wrong factor, or a zero factor named. |
| D7 | Named players: every player id in a personnel or availability detail is on the field for that call's unit on the named side, and the rating named is one an applied effect or standout kind reads. | Bench player or unused rating named. |
| D8 | Coordinator error: at play calling 99 with sigma 0 the perceived contributions equal the true ones. At any rating a perceived contribution has the sign of the true one and zero stays zero. Over a fixed set of at least 2,000 requests, the share whose top pick matches the sigma 0 top pick does not fall as play calling rises through 30, 65 and 95. | Sign flip, phantom edge, or wrong order. |
| D9 | Style: with `passLean` +2 the share of top picks that are passes over D8's requests is at least that with 0, and with 0 at least that with -2. An option whose score before style is outside the window never ranks first because of style. | Wrong direction, or a poor option lifted. |
| D10 | Availability: marking a named on-field player unavailable adds an `availability` factor to every option whose unit he was in, with details naming him and his replacement, and to no other option. | Missing or spurious factor. |
| D11 | Play designs: with a fixture list of designs, each option carries a design that maps to its call. A design tagged `shortYardage` is picked over an untagged one on 3rd and 1 and not on 3rd and 8. With no designs, options carry no design id and D1 to D10 hold. | Wrong design, or a call swapped for another. |
| D12 | The check script reports, per factor, the distribution of its contribution over D1's games (mean, 5th and 95th percentile), so the weights are confirmed with the numbers in view before milestone G's band run. | Missing table. |

### E: fourth down, try and clock recommendations

| # | Criterion | How it fails |
| --- | --- | --- |
| E1 | `decision` is present exactly when the request's kick option is legal or the request is a try. Its option ids are a subset of go, punt, field goal (or extra point, go for two), each legal now. | Present when it should not be, or an illegal option. |
| E2 | A field goal the caller's range mask removes is never offered. | Offered. |
| E3 | Value parity: for at least 8 fixture states, the punt and field goal values equal the mean of 200,000 engine draws with no foul, within the check.json tolerance. Heavy test. | Outside. |
| E4 | A fixture of at least 20 fourth-down states (each field zone, short and long distance, leading, tied and trailing, early and late) lists each option's expected points, fitted share and score worked by hand from the formula at game management 99. The recommender's values, shares, scores and order match it within 1e-6, and each reason quotes the expected point gap and the fitted share. | Any mismatch, or a number missing from the reason. |
| E5 | On a try where the late try chart has a cell, the chart's choice ranks first with factor `lateChart`. Elsewhere the order follows the formula. | Chart ignored or used outside its cells. |
| E6 | `fourthDown` style +2 never lowers the rank of go compared with 0 on a fixture of at least 200 fourth downs, and never lifts go from outside the style window. | Wrong direction. |
| E7 | Clock advice is null unless one rule fires. Kneel is advised only when the `kneelOut` bin allows it and no kneel mask applies. Spike is never advised with a stopped clock or on 4th down. Timeout is never advised with none left or one already taken in this dead ball. Each advised action's `path` passes `checkPath`. | Advice against a mask, or an illegal path. |
| E8 | Each clock reason quotes the share or rule it used, and D3, D4 and D6 hold for `decision` and `clock`. | Unbound reason or nondeterminism. |

### F: worker protocol and neutrality

Protocol (locked here because the UI builds against it): `ToWorker` gains `{ t: "recommend", seq }`. `FromWorker` gains `{ t: "recommendation", seq, recommendation }`, where `recommendation` is null when the request has none or `seq` is not the pending request. `TeamSummary` gains `staff` (both coordinators: name, ratings, style). Recommendations are not saved. This is a schema change and needs the lead's go-ahead under CLAUDE.md before it is built.

| # | Criterion | How it fails |
| --- | --- | --- |
| F1 | A `recommend` message for the pending `seq` gets one `recommendation` reply with that `seq`. A stale `seq` or no game gets a reply with null and no `simError`. | No reply, wrong seq, or an error. |
| F2 | Neutrality: for 200 seeds and a fixed answer log each, the game record is byte-identical whether or not `recommend` is sent before every answer, and `session.rng` is identical before and after each `recommend`. | Any difference. |
| F3 | Resume: the recommendation for the pending request after `resume` from a save equals the one before saving. | Any difference. |
| F4 | The recommendation and `TeamSummary.staff` pass their zod schemas before crossing to the UI, like requests do. | Schema rejects. |
| F5 | docs/MODEL.md has a "Recommendations" section and a "Coordinators" section that label each factor fitted, designed or mixed as in this spec and never call the matchup factor data-derived. docs/DECISIONS.md records each designed choice (score formula, value convention, estimator, error model, stream seeding, starting values). A spec-check test reads the labels. | Missing or mislabeled. |
| F6 | CLAUDE.md "Project notes" gains one line pointing to this spec and its DECISIONS.md entries. | Missing. |

### G: headless sanity check and report (playtest gate)

`scripts/recommend/check.ts` drives one human seat through `startSession` and `answerSession` (no loop change). Two bots play the same seeds, teams and side:

- Average bot: answers play calls by sampling the fitted caller with its own seeded stream (never the game's), and decisions with the average coach's rules.
- Recommendation bot: answers every play call, fourth down, try and clock decision with the top recommendation's path, and everything else like the average bot.

Both face the average coach. Staff for the main arm: every rating at the curve's median, neutral styles.

| # | Criterion | How it fails |
| --- | --- | --- |
| G1 | check.json (seeds, game count, band, tolerances) is committed before the first run, and the report prints its hash. A later change is a DECISIONS.md entry naming the result it follows. | Edited with or after a failing run and no entry. |
| G2 | Over the pre-registered paired games (proposed 2,000, half at home), the recommendation bot's mean point margin minus the average bot's is inside the band (proposed -1.0 to +3.0 points a game). The report gives the difference and its standard error. Heavy test. | Outside the band. |
| G3 | Zero rejected answers, zero sim errors and zero `cannotFieldUnit` across all arms. | Any. |
| G4 | Quality: with every rating at 30, 65 and 95 (neutral styles), the mean margin does not fall as the rating rises by more than the slack in check.json (proposed 0.5 points). | A better coordinator does worse beyond the slack. |
| G5 | The report (docs/RECOMMEND_REPORT.md, generated) shows for the recommendation bot's team, next to the average bot's: pass rate by down, 4th down go rate, punts, field goal tries, two-point tries, turnovers, sacks, points, and how often each factor was the headline reason. Shown, not gated. | Missing table. |
| G6 | League totals: with recommendations computed and not followed, the CI calibration slice's records are byte-identical to today's (follows from F2, asserted here on the slice's seeds). | Any difference. |
| G7 | `scripts/recommend/perf.ts` times one recommendation over at least 1,000 requests from seeded games. Median is at or under the budget in check.json (proposed 10 ms in Node on the docs/PERF.md machine), and the numbers go in docs/PERF.md. If it is over, report it. Do not drop a factor to pass. | Over budget and unreported, or a factor cut. |
| G8 | If G2 or G4 fails, the result goes to Joseph with the numbers before the milestone is called done. Weights and the band are unchanged in that diff. | Tuned in the same change as a failing run. |
| G9 | playtester runs the check and at least 20 human-style games reading the headline each snap, and reports any recommendation a football person would call nonsense, with the seed and play count. | No playtest report. |

### H: AI teams call through their coordinators (designed, centered, off in the baseline)

| # | Criterion | How it fails |
| --- | --- | --- |
| H1 | `styledCoach` returns a `CoachPolicies` that samples from the tilted shares with the same number and order of draws as the average coach. With every style at 0, or `enabled` false, game records for 200 seeds are byte-identical to the average coach's. | Any difference. |
| H2 | `scripts/recommend/center-styles.ts` writes `centering` per axis so that, over the in-sample leagues' generated staffs, league pass rate, 4th down go rate and blitz rate with styles on are within the designed tolerance in check.json (proposed 0.5 percentage points) of styles off. | Outside. |
| H3 | With styles on, the calibration slice (`pnpm test:heavy`) has no gated metric failing that passes with styles off. `known_deviations` is unchanged. A new failure is reported to Joseph, not accepted by the engineer. | New failure hidden or tolerances edited. |
| H4 | Visible effect: over the check's games, +2 `passLean` teams pass more than -2 teams, +2 `blitzLean` teams blitz more, and +2 `fourthDown` teams go more, each by at least the minimum in check.json. If an axis shows no visible effect it is reported for cutting (the brief's fun rule). | No visible spread. |
| H5 | The app turns styles on the way it does standouts and close calls: a constant, recorded in the save, and a save resumes only under the same setting. `SAVE_SCHEMA_VERSION` goes up by one. Schema change, lead's go-ahead needed. | A save replays under another setting. |
| H6 | The estimator earns its place: against +2 and -2 `blitzLean` and `passLean` opponents, the mean absolute error of the end-of-game belief against the opponent's true tilted shares is lower than the fitted prior's, for Scouting 65. Reported for 30 and 95. | Belief no better than the prior. |
| H7 | Milestone G's check is rerun with styles on and its report section added. G2's band applies. | Not rerun. |

## Edge cases and reachable states

- First snap, or the opponent has not had the ball yet: nothing observed, belief is the prior, no `opponentTendency` factor.
- Before milestone H every opponent style is 0, so `opponentStyle` never appears.
- Two-point try: offense and defense lists come from the try tables. Tries do not feed tendencies.
- A kick is legal on downs 1 to 3 in the final 2:00 of a half: `decision` is present and the low `timeScale` lets the fitted shares lead.
- Fourth down out of field goal range: the list is go and punt.
- Kneel-out available: `clock` advises the kneel and `plays` is still returned.
- The same request asked again in one dead ball (timeout, tempo change): same play count, same coordinator error. Only what changed in the state can change the advice.
- A replayed down after a pre-snap foul: the wiped-out play is not an observation.
- Overtime: time bins treat it as the second half, as the caller does. Likely to change with the caller.
- Standouts on or off: personnel follows the game's own setting.
- Human on defense while the offense lines up for a kick, kneel or spike (`continue`, `theyLineUp`): only timeout advice.
- Unavailable players and `cannotFieldUnit`: reachable only from tests until M5.
- A top call with no play design: the option has no design id.

## Dependencies and sequencing

- A first. B and C need A's tilt and can run in parallel. D needs B and C. E needs B and D. F needs D and E. G needs F. H needs A and G's script.
- The designer's screen spec can start once the Output and F protocol sections here are accepted.
- The playbook spec and this one meet only at the play design contract. D11 runs on a fixture until real designs exist.
- Sign-off before build: F's protocol and `TeamSummary` change and H's save change (schema changes), and any edit to engine/resolve.ts.
- No new dependencies.
- The heavy checks (B2, E3, G, H) run locally with `pnpm test:heavy`. CI runs the fixture tests, the golden files and a small fixed slice of G, sized by the engineer and recorded in check.json.

## Locked vs likely to change

Locked: the lead's seven decisions; no game Rng and no pending opposing call in any input; reasons only from present factors; perceived edges never flip sign or appear from zero; E0 is not in the score; the centered property D5; the protocol in F; designed numbers live in data and are pre-registered before the check.

Likely to change: every starting value in the table; the tendency groups and situation classes; `timeScale` once a win probability model exists; the reason templates; the clock thresholds; the coordinator rating names; overtime handling; the personnel wording if the engine ever gains one-on-one matchups.

## Open questions for Joseph

1. Open: how much should following the hints help? Recommended default: the band in G2, the recommendation bot beats the average caller by no more than 3.0 points a game and loses by no more than 1.0, with an average coordinator. Hints should help a little, not win the game for you.
2. Open: "my best receiver against their weakest corner". The engine compares position groups (your receivers against their corners and safeties), not one player against one player, and only players rated 90 or more stand out individually. Recommended default: keep the engine as it is and have the reason name the player who drives the group's edge on each side. True one-on-one matchups would be a separate engine change with its own calibration.
3. Open: injuries are M5 and rosters today have no backup QB, kicker or punter, so an in-game injury cannot be fielded honestly yet. Recommended default: ship the availability input now, tested with fixtures, and no injury in play until M5. If you want it visible sooner, the smallest honest version is a designed pre-game "out" list limited to positions with a backup (WR, TE, OL, CB, LB and similar), which also needs the engine to field the reduced lineup. That is extra scope and not in this spec.
4. Open: the roadmap's M3 row says "win probability decisions", and no win probability model exists. This spec uses expected points plus the fitted late-game shares, and turns the expected points weight down at the end of halves. Recommended default: accept that here and give win probability its own M3 spec. The recommender swaps it in through one value function.
5. Open: AI teams calling through coach styles (milestone H) is in this spec for run or pass, fourth down and blitz, and AI tempo is left out because it moves plays per game. Recommended default: as written. Without H the "other team" factors have nothing real to detect.
6. Open: hints for penalties (accept or decline), challenges and onside kicks. The policies exist and you did not ask for these. Recommended default: leave them out of this spec.
7. Open: coordinator ratings are Play calling, Scouting and Game management, with styles for run or pass, fourth down, tempo and blitz, and the opponent's style is public. Recommended default: as proposed. A coordinator with poor Scouting under-accounts for a known style rather than not seeing it.
8. Open: the starting values in the table are proposals, not measurements. Recommended default: build with them, look at D12's contribution table, and confirm or change them once before G's first run.
