# M4: franchise core (league, fantasy draft, season, playoffs, trades, save)

Status: draft, 2026-11-23. Revised 2026-11-24. Owner: Joseph. Screens are specified separately in docs/specs/m4-franchise-screens.md (designer). This spec covers the pure sim and data side and the API the screens call. No layout here.

## Revision 2026-11-24

Why: the built two-tier pool only passes A5 with a cliff (depth curve 26 to 38), and a league of identical AI teams drafts 32 near-identical rosters. The text below is already revised. This is the delta to apply to the build of A and B. Every new number is a designed starting value. Figures marked "arithmetic" come from the rating curve and the normal approximation and are not measurements.

**Changes**

| What | From | To |
| --- | --- | --- |
| pool.json | `depthCurve` | Deleted. New `adjust` (position, rating: `scale`, `offset`), `floor`, `standoutCentering`, and a `tuning` record |
| draft-ai.json | `need` {starter, starterShare, depth}, `noise` | Deleted. New `slotNeed`, `evaluation`, `styles`, `autoPick`. `positionValue` stays |
| Pool | Two tiers per position | One distribution per position (Player pool) |
| AI score | Noise redrawn each pick, one policy for all | A per-team profile (style and evaluation error), fixed for the draft |
| `needBonus` | From min, target and three weights | `slotNeed[position][count]` |
| `STREAMS` | `draftAi` 4 used | 4 retired and not reused, 6 `draftProfile` and 7 `draftEvaluation` added. No other id changes |
| Franchise kit | Not built | `franchiseKit`: the same data with the franchise's own standout centering (Player pool) |
| A5 | Uniform mean over projected starters, 200 leagues | Deployed mean, 800 leagues. Tolerance still 0.5 |
| A6 | Waits for C and E | A6 stays, and a pre-check A6a runs now on random pairings |
| New criteria | | A6a, E9, A10 spread and standouts, A11 playable bench, B11, B12, B13 no one-position rounds, B14 team spread, B15 profiles, B16 auto-pick strength |
| Reworded criteria | | A4, B6, B7, D1, F5, G1, G3, G4, G8, H1, H3, I5 |
| Targets | A drafted target leaves the list; auto-pick takes the highest score | He stays in the list (views filter); auto-pick takes the highest overall, ties by id. `setTarget` on a drafted player is still an error |
| Draft view | | Adds `depthRank`. `user.targets` is the full list, `user.targetsAvailable` the rest |
| `runDraft` | `maxPicks` | Adds `through` (Running). `maxPicks` stays |
| Later milestones | | Both teams' `TeamBox` per game, seeds and bracket at any point, streak, games back, round names, `gameInProgress`, trade summaries, M3 switches in settings |

Tests that must change because the rule they check changed, and no others: a-data (the two data shapes), a-league-pool (the tier test), b-draft (noise), b-targets (drafted targets, several targets, the noise and need asserts), spec-determinism, spec-support, franchise.heavy (A5), tolerances.ts (new constants only, committed before the first run on the new data). The existing constants in tolerances.ts keep their values except `A5_LEAGUES`.

**Stays**: stable ids, unique names, pool size and positions, roster.json, the legality rules, must-fill and use labels, `autoPickPreview` (also off the clock, as built), its reason codes, jersey numbers, `leagueTeams`, `picksForSlot`, B1 to B5, B8, B9, B10 at 250 ms, A6's tolerances, Locked 1 to 8, no pinned file edited.

**Ruling, 2026-11-24 (lead, after the rebuild).** Legal picks gain rule (4): after the pick, a completion must exist, meaning every team can still fill its owned slots from the pool with every position inside its minimum and maximum. Rules 1 to 3 stay and are named first when they block. Rule 4 is exact and is checked for every team, not only the one on the clock. It makes `noLegalPick` unreachable for any data on which a full draft exists at all, and the loader rejects data on which none exists. B3 and B4 also run at surplus 0 with need weights 0. B10's 250 ms still holds.

**Kickers and punters, 2026-11-25 (Joseph: "special kickers can go earlier").** A kicker or punter's draft value rises steeply with overall, so a standout can go early and an ordinary one waits. B17 becomes: no kicker or punter in rounds 1 and 2; one with an overall under 90 goes before round 12 in at most 1% of leagues; a team ends with a second kicker or punter in at most 1% of leagues; and the best kicker in a pool, when he is 90 or more, is drafted by round 8 in at least half of leagues. The 90 and the rounds are designed starting values, pre-registered before the run, tuned on the tuning seeds and reported on a fresh range.

One ruling for the lead: the reconciliation file's preview text has codes `target`, `need`, `value` and null off the clock. The build has `target`, `needStarter`, `needDepth`, `bestAvailable` and previews the next pick. I kept the build, since it carries strictly more.

## Goal

Add a Franchise mode behind the playable game: a 32-team fictional league whose rosters are built by a league-wide snake draft, then one NFL-shaped season (17 games in 18 weeks, 14-team playoffs, a title game) with standings, tiebreakers and player-for-player trades, all seeded and deterministic, with a versioned save.

For: Joseph, who asked for it on 2026-11-23 ("franchise mode: there is a global draft to create teams. snake format. the ui should track your positions, their ratings, how many are still needed. the avg rating. other team's ratings if needed. use madden and other games as examples. allow trading. model everything off of the nfl with amount of games and playoffs"), and the engineer, test-writer, designer and playtester building M4.

In plain words: every player in the league goes into one pool. Thirty-two teams take turns picking, first to last and then last to first, until every roster is full. You run one team and can pick by hand or let the computer pick for you. Then the league plays a season laid out like the NFL's. You play your game each week and the computer plays the other fifteen. Standings, playoff seeds and the bracket follow from the scores. Until the trade deadline you can offer player swaps to the other teams, and each one says yes or no and why.

## Non-goals (out of scope)

- Screens, layout, copy (designer's spec). The rule of at most seven choices per screen is met there; this API returns full lists and the screen filters.
- Contracts, salary cap, free agency, injuries, fatigue, depth chart editing, progression, aging, rookie draft, scouting, coaches (M5 to M8 in docs/ROADMAP.md).
- Trading draft slots during the fantasy draft (deferred to M7 with pick trades; the state keeps an explicit slot list so it can be added without a new save version, see B).
- Trades with picks, three-team trades, AI-to-AI trades, AI-initiated offers, uneven trades (2 for 1). Those need free agents and pick values (M6, M7).
- Season player stats, league leaders and the news feed (ROADMAP M4 additions). They get their own spec; this one stores only what standings and tiebreakers need.
- A second season. One franchise is one draft and one season through the title game (open question 6).
- Practice squad, game-day inactives, injured reserve. Every rostered player is available every game.
- Any edit to files in the calibration import graph (listed under Locked 2). A need to edit one is a FLAG back to the lead, not a quiet change.
- Copying another game's named systems, look or branding (ROADMAP rule). "Madden and other games" are examples of what a draft board shows, nothing more.

## Dependencies allowed

Nothing new. TypeScript, zod in packages/shared only, vitest, the existing Node type-stripping hook for scripts. If the engineer wants a pipeline number from nflverse (I5's comparison figure), it uses `load_schedules`, already surveyed in docs/DATA.md.

## What the code does today (checked 2026-11-23)

- **Roster.** `generateTeam` (packages/sim/src/engine/players.ts) makes exactly the players needed to fill every formation, package, kick unit and return unit: 33 per team (QB 1, RB 1, WR 4, TE 3, OL 6, DL 5, LB 4, CB 4, S 3, K 1, P 1, from `slotNeeds` over data/engine/personnel.json and participants.json `returnUnits`). There are no backups.
- **Who plays.** No depth chart. `onField` takes the first n players of a position in pool order. So the order of `TeamPool.players` decides the starters.
- **Player shape.** `Player` (packages/shared/src/engine.ts, schema version 2) has id, name, position, a jersey number unique within the team, four base ratings and the position's skills, all integers 0 to 99. Ids embed the team name (`<team>-QB1`). `UnnumberedPlayer`, `assignNumbers`, `numberStream` and `curveAt` are exported and reusable.
- **Ratings.** Every rating is an independent draw from one designed curve (data/players/ratings.json `curve`: percentile 0, 10, 50, 90, 100 to rating 30, 48, 65, 82, 99). Rating effects multiply rates by the on-field average's distance from the position's league mean (`leagueMeans`, from data/players/distributions.json). A league whose starters average above that mean would shift league totals.
- **League.** `generateLeague` (loop/league.ts) makes 32 such teams with names from data/teams/names.json (36 fictional place plus nickname pairs) and gives each a designed strength shift (data/game/league.json `teamStrength.sd` 1.2 rating points on every player, tuned to 2016-2023 margin SD). There are no conferences, divisions or schedule: `setupGame` draws a random pairing per seed.
- **Overall.** Computed only in the app: `overallRating` in packages/app/src/ui/ratings.ts, a rounded weighted mean of a player's card ratings with per-position weights from data/ui/templates.json `overallWeights`. Display only. The sim has no overall.
- **Playing a game.** `GameSetup` is game type, seed, league seed, and home and away `TeamSetup` (name, pool, coach). `playGame(setup, kit, rng)` plays a whole game headless and returns a `GameRecord`. `startSession`, `answerSession` and `replaySession` (loop/session.ts) play it step-wise with one human seat, as plain JSON. `gamePlayers` applies home field from `kit.data.league.homeField` to whoever is `home`. There is no neutral-site flag. Game types are `regularSeason` and `postseason` (no ties in the postseason).
- **Coaches.** Every team uses `averageCoachFor(data)`. Policies are passed per team. M3 (coach styles) is not built.
- **Box score.** `boxScore` gives team totals. `TeamBox` has points but no touchdown count.
- **App.** The worker (packages/app/src/engine) holds one game `Session`. A single-game save is seed plus answer log and resumes only when `dataHash` and `codeHash` both match the build. `codeHash` covers every file under packages/sim/src and packages/shared/src, so any new sim file makes old single-game saves read as "older".
- **Speed.** docs/PERF.md, 2026-11-21: 7.4 ms per full game, headless, Apple M4, Node 25.6.0 (calibration run, invariant checker on). Standout plays add about 0.37 ms (2026-11-14). No measurement exists for the browser Web Worker: the "Sim throughput" section of PERF.md is empty.

## Locked

1. The franchise layer is pure and lives in new files under `packages/sim/src/franchise/`: no DOM, no Node API, no `Math.random`, no clock, no zod. Every random choice comes from a generator derived from the franchise seed. Same seed, same data and same user decisions give the same franchise, byte for byte. The seed is in the state and in every game result.
2. No edit to any file in the calibration import graph (`codeFiles()` in scripts/game/calibrate.ts): packages/sim/src/caller, engine, game, loop (except session.ts and player-box.ts, which are also left alone), rng.ts, splitmix64.ts, packages/shared/src/{caller,catalog,engine,engine-schema,game,game-schema,play,rules,rules-schema,schema,situation,types}.ts, and scripts/game/{calibrate,data,metrics,report,checks5c-rules,checks5d-rules}.ts. New shared types go in new files (`packages/shared/src/franchise.ts` types only, `franchise-schema.ts` zod) and are not re-exported through types.ts. `GameData` gains no field: franchise data is its own bundle, `FranchiseData`.
3. `resolvePlay` still decides every outcome. The franchise layer builds `GameSetup`s and reads `GameRecord`s. It never builds or alters a play result, a score or a game state.
4. All balance and tuning is in JSON under `data/franchise/`, validated with zod, never in code. Each file says designed or fitted. Nothing here is fitted: every number in this spec is designed unless it cites a source. docs/MODEL.md gets a "Franchise" section labeling each part.
5. Variance is not flattened. No rule evens out rosters, schedules or results. Team strength differences come from the draft and trades only: the `teamStrength` shift in data/game/league.json is not applied in a franchise (a hidden shift would make the ratings on the draft board lie). The pool's `adjust` is not a hidden shift: it makes the ratings once, the same for every player at a position, and the board shows the numbers the engine uses.
6. No NFL trademark or real name in shipped data: no real conference, division, team, title game or trophy name, and no real player name. The pipeline name check (pipeline/game/real_names.py, never shipped) is extended to cover data/franchise.
7. NFL facts in data/franchise carry a citation. The engineer copies the Sources section below into docs/RULES.md with the status of each row (`confirmed`, `unconfirmed`, `designed`).
8. A user action that is not allowed returns a typed error and leaves the state unchanged. It never throws and never half-applies.

## Design

### Data files (all new, under data/franchise/, zod schemas in packages/shared/src/franchise-schema.ts)

| File | Holds | Label |
| --- | --- | --- |
| league.json | Two conference names, four division names per conference, the title game name, how the 32 teams are placed (seeded shuffle) | designed |
| roster.json | `rosterSize`, and per position `target` and `max`. Position minimums are not stored: they are `slotNeeds` from the engine's personnel data, so the two can't drift | size cited, rest designed |
| pool.json | Surplus share, `adjust` (scale and offset per position and rating), `floor`, `standoutCentering`, name uniqueness rule, tuning record | designed, tuned on simulated leagues |
| overall.json or a pointer | The overall weights (see Overall) | designed |
| draft-ai.json | `positionValue`, `slotNeed`, `evaluation`, `styles`, `autoPick` | designed |
| schedule.json | Weeks, games per team, bye window, the three rotation tables, the 17th-game host rule, solver limits | counts cited, tables designed |
| playoffs.json | Field size, seeds, byes, round pairings, hosting, the tiebreaker step lists, a name per round | cited, round names and hosting of the title game designed |
| trade-ai.json | Value curve, position weights, need factor, required margin, max players per side, deadline week | deadline cited, rest designed |

Starting values proposed here are starting values. The playtester tunes them in data, on simulated leagues only.

### League structure (A)

32 teams, two conferences of four divisions of four. Names (designed, settled, question 1): Founders Conference and Frontier Conference, each with North, South, East and West divisions, and the title game is the Clipboard Cup. Team names are 32 of the 36 in data/teams/names.json, picked and placed into divisions by a seeded shuffle. Teams get stable ids `T00` to `T31`. The user picks one team to control before the draft. `leagueTeams(data, seed)` returns the 32 identities before any franchise exists, so the screens can redraw the seed (the reconciliation file calls it `leagueStructure`). The seed is called the franchise seed in the API and the save.

### Player pool (A)

Roster size is 53 (NFL Active/Inactive List limit, source 5). Proposed targets, summing to 53 (designed): QB 3, RB 4, WR 6, TE 4, OL 9, DL 8, LB 7, CB 6, S 4, K 1, P 1. Proposed maximums: QB 4, RB 6, WR 8, TE 5, OL 11, DL 10, LB 9, CB 8, S 6, K 2, P 2. Minimums are today's 33 slot needs.

The pool is larger than 32 full rosters, so the last rounds still have choices: per position, `ceil(32 x target x (1 + surplus))` players, surplus 0.10 proposed (about 1,871 players). Undrafted players stay in the state as free agents and are not used in v1.

Ratings (designed): one distribution per position, no tiers. With `x` a draw from the engine's curve (as `generateTeam` draws it) and `m` the engine's league mean for that position and rating, the rating is `clamp(round(m + scale x (x - m) + offset), floor, 99)`. `scale` and `offset` come from `adjust`, the same for every player at the position. Only ratings that the position's overall weights may have an entry. Any other rating is the plain draw (scale 1, offset 0): choosing starters by overall does not select on it, so it needs no correction, and correcting it is what pulled the tiered pool off center. `floor` 20.

Why this and not an unshifted pool with recomputed means. Checked in code: `resolve.ts` is the only reader of `distributions` in a game (the other, `ratingFromMeasurements`, maps combine drills and is not used here), and an effect's edge is linear in the distance from the mean, with a second-order correction and clamps, so replaced means would keep average rates centered. But two other rules read absolute ratings: standouts fire at 90 and participant tilts center on 65. A moved mean would need both moved too, a 65 would mean something different in a franchise and in quick play, and means taken from one draft go stale at the first trade. With the offset, 65 is the average player on the field in both modes, and after trades. A trade can promote a bench player and move the league's average a little; G8 reports it. Effects depend on spread only through the clamps and cross terms between effects, which is why A10 holds the spread too.

**Center on who plays, not on who is listed.** The roster is handed over best first and the common formations field one or two of three tight ends, three of four receivers, two or three of four corners. The best slots play more, so a uniform mean over the top `min` understates the field and would run the league hot. The deployed mean of a rating at a position is the average, over run and pass snaps with that position on the field, of the mean over its on-field players, taken from card ratings (no home field). Because the fill is by slot, it is a weighted mean over depth slots, with weights computed by a fixed-seed helper from 500 quick-play games' on-field lists (no NFL data, not stored in a data file). K and P are slot 1.

**Spread and standouts.** Taking the top of one distribution narrows it: 32 quarterbacks start out of 106, so without a correction their overall SD falls to about half of quick play's and the SD of accuracy by about a fifth (arithmetic). A constant offset alone would also leave a starting quarterback or running back no way to reach 90 in his main skills. `scale` restores the SD of each weighted rating and the 90 and up tail. The spread of starters' *overall* stays narrower than quick play's at the positions that select hardest (QB and RB, arithmetic: about 5 against about 8 for QB), because all starters passed the same cut. That is expected and reported, not corrected. The best receiver taking the first slot also raises how often an elite player is the target, so the franchise carries its own `standoutCentering`. `franchiseKit` puts it in the copy of the data the kit is made from, so no pinned file or data/engine file changes, and quick play is untouched.

**Tuning** (`scripts/franchise/tune-pool.ts`, simulated leagues only, seeds 100001 to 100800, disjoint from every test seed; start at scale 1, offset 0). Each pass runs all-AI drafts, sets `offset += m - deployed mean` and multiplies `scale` by quick play's deployed SD over the franchise's, for weighted ratings only. Stop when every one is inside half its tolerance, then compute `standoutCentering`, and write the file once with the record. Changing draft-ai.json requires a re-tune. The old depth curve's history is in DECISIONS.md, not in the data file.

Pool players have no team and no number. They get stable ids (`P0001`...) that never change when they move. Full names are unique within a pool (redraw on a collision): 88 first names by 103 last names give 9,064 pairs, so about 1,871 independent draws would repeat many names on one draft board.

### Overall (A)

The draft board ranks by overall, the AI drafts by it and the trade model values by it, so the sim needs it. `overall(player, weights)` in the franchise layer uses the same formula as the app's `overallRating`. The weights have one home. Proposed: they stay in data/ui/templates.json `overallWeights` and the loader passes them into `FranchiseData`, and a test proves the sim and app functions agree on every player of a generated pool. Moving the weights to data/franchise is the engineer's call if both readers still share one file. Overall is designed and display-and-AI only: the engine never reads it.

### Team views (A, used by every screen)

`teamSummary(state, data, teamId)` returns, for one team: per position the players (id, name, number once assigned, overall, every rating and skill), `count`, `min`, `target`, `max`, `neededToStart = max(0, min - count)`, `neededToTarget = max(0, target - count)`, and the average overall of the projected starters; unit averages for offense (QB, RB, WR, TE, OL), defense (DL, LB, CB, S) and special teams (K, P); team overall; full-roster average; and the team's rank among the 32 on each average. `leagueSummaries` returns all 32, so the user can compare any team with theirs.

Designed definitions: projected starters at a position are its top `min` players by overall, ties by id. Averages are unweighted means of overall over projected starters, one decimal, null when empty. The team average is over every projected starter, unit averages use the same rule within the unit, and the full-roster average is a separate field. Minimums are the engine's slot needs, so "starter" includes the fourth receiver, third tight end and sixth lineman. A player's number is null until the draft ends. The same order (overall descending, ties by id) is the pool order handed to the engine, so the projected starters are the players who play.

### Draft (B)

- **Order.** Round 1 order is a seeded shuffle of the 32 teams. The user may instead choose a slot from 1 to 32; the other 31 are then shuffled by seed. Snake: odd rounds run 1 to 32, even rounds 32 to 1. 53 rounds, 1,696 picks. The state stores the owner of every slot as an explicit list built from that rule.
- **Legal picks.** A team on the clock may take any pool player such that afterwards (1) its count at that position is at most `max`, (2) it still has enough picks left to reach every position minimum, and (3) the pool still holds enough players at every position to cover every team's unfilled minimums. `legalPicks` returns the legal set with, for an illegal player, which rule blocks him.
- **AI policy (designed, draft-ai.json).** Among legal players the AI takes the highest score, ties by player id. With `v = positionValue[position] x style value[position]` (1 where the style lists none): score = `v x overall` + `style need x slotNeed[position][count]` + `v x error`. The three parts are `value`, `need` and `noise` in `DraftChoice`, so score is still their sum.
  - **Slot need.** `slotNeed[position]` lists one bonus per roster slot up to the target, never rising, 0 from the target on. It replaces the rule that every open starting slot outranks every depth slot, which put 33 starters in 33 rounds and then a run on quarterbacks. Legality still guarantees the minimums. Start: QB 14, 4, 1; RB 10, 5, 3, 1; WR 10, 10, 9, 8, 4, 2; TE 9, 6, 5, 2; OL 11, 11, 11, 10, 10, 7, 4, 3, 2; DL 11, 11, 10, 10, 7, 4, 3, 2; LB 10, 10, 9, 7, 4, 3, 2; CB 11, 11, 9, 7, 4, 2; S 9, 9, 7, 2; K 6; P 6.
  - **Evaluation error.** Each AI team draws `errorSd` uniformly from `evaluation.errorSdMin` to `errorSdMax` (start 1 to 7, the schema caps the maximum at 8). Its `error` for a player is `errorSd` x a seeded normal. It depends only on the franchise seed, the team and the player, so it is fixed for the draft and does not change with the pick, the board or a reload. It is a misreading of the public board, never a look at a hidden rating.
  - **Styles.** Each AI team draws one named style by `weight`. Start (weight; value; need 1 unless stated): `balanced` (3); `trenches` (2; OL, DL 1.05); `passingGame` (2; QB, WR 1.05, CB 1.02); `groundGame` (2; RB 1.05, TE 1.04, OL 1.03); `defenseFirst` (2; DL, LB, CB, S 1.04); `bestPlayer` (2; need 0.5). Not shown on a screen in v1.
  - Profiles are derived from the seed and never stored. The AI reads the draft view, its own profile and nothing else: no ratings beyond overall and no user targets.
- **User.** On the clock the user can pick a legal player, auto-pick this one pick, or turn on auto-draft, which makes every remaining user pick by the same rule until turned off or the draft ends. It can be switched at any time. Auto-pick and auto-draft take the user's highest-overall target (ties by id) that is legal and whose `use` is `starter` or `depth`. With no such target they pick by the AI policy with the `autoPick` profile (start: style `balanced`, `errorSd` 0, so it reads the board as shown, open question 13).
- **Targets.** `setTarget(state, playerId, on)` marks or unmarks any undrafted pool player; an unknown or drafted player is a typed error with the state unchanged. Targets are ids in the state in the order marked. A drafted target stays in the list, so the screen can say which were taken. AI teams never read it.
- **Use.** For the user's team each available player carries `use`: `starter` when the team's count at his position is under `min`, `depth` from `min` to under `target`, `extra` from `target`. He also carries `depthRank`, his place in the team's depth order if drafted (overall descending, ties by id).
- **Must fill.** `mustFill` lists the positions and counts still short of `min`, and `everyPickMustFill` is true when picks left equal them. A screen showing the reconciliation's "must fill" list shows it only then.
- **Auto-pick preview.** `autoPickPreview` returns the player auto-pick would take at the user's current or next pick, with one reason code and its numbers from the factors the pick used and nothing else. Codes: `target`, `needStarter` or `needDepth` (the need bonus was above zero), `bestAvailable` (it was zero). Null when the user has no pick left or no legal pick. With no per-pick randomness the preview holds until the board or the roster changes.
- **Running.** `runDraft(state, data, { through, maxPicks })` makes picks and returns them in order. With auto-draft off it stops at the user's turn. With auto-draft on, `through: "end"` (the default, as built) runs out the draft, and `"nextUserPick"` makes the user's pick if he is on the clock, then AI picks, and stops when he is on the clock again. That is how the app drives a stoppable reveal.
- **End.** After pick 1,696 every roster has 53 players inside min and max at every position. Jersey numbers are then assigned per team from a seeded stream, the schedule is generated, and the phase moves to the regular season.
- **Draft view.** `draftView(state, data)` returns: round, pick in round, overall pick, team on the clock, whether the user is on the clock, picks until the user's next turn, the slot list, picks so far (slot, team, player, who picked: user, auto or AI), the available players with overall, ratings and rank at position, the legal set, and `leagueSummaries`. Also `totalPicks`, `done`, `userPicksMade`, `userPicksTotal`, `userNextPick` (overall pick, round, pick in round and picks away, after the current pick, null when none), the full `targets`, `targetsAvailable` and `mustFill`. `autoPickPreview` is its own call. `picksForSlot` gives the overall picks a slot owns and works before a franchise exists.

**Team spread: what 1.2 means, and the target.** The 1.2 in data/game/league.json is the SD of a whole-team shift. It is not the SD of team overall: quick-play teams also differ by sampling, and 33 starters with independent ratings give an SD of about 1.36, so the total is about 1.8 (arithmetic: the two combined, plus rounding). Point for point they also differ, since the shift moves every rating, and a draft mostly moves the ratings overall weighs. So B14 measures one quantity the same way on both: the SD across 32 teams of the mean overall (unrounded mean) of the 33 projected starters, averaged over 200 leagues, for drafted leagues and for `generateLeague`. Margin SD under the same kit, from A6a, is the second reading.

Pre-registered, reported and not gated: the drafted SD is 75% to 125% of the quick-play SD measured in the same run. The built all-AI draft measured 0.32 (lead's report). Evaluation error, its range and the styles are tuned toward this on simulated leagues only. If no setting within the error cap reaches it, that is the report (question 12). It is never closed with a rating shift.

### Schedule (C)

NFL shape (sources 1 to 3): each team plays 17 games in 18 weeks with one bye, 272 games. Per team:

1. Six games: home and away against its three division rivals.
2. Four games against one other division of its conference, on a three-year rotation, two home and two away.
3. Four games against one division of the other conference, on a four-year rotation, two home and two away.
4. Two games against the teams that finished in the same place in the two remaining divisions of its conference, one home and one away.
5. One game against the same-place team of a division in the other conference that it does not otherwise play, on a four-year rotation. One conference hosts all sixteen of these in a season and the host conference rotates.

The rotation tables for the fictional divisions are designed (schedule.json), indexed by season number, and must give the property the NFL states: every team plays each of the other 31 at least once in four seasons. A new franchise has no last season, so the prior-year division places for rules 4 and 5 are a seeded shuffle of 1 to 4 within each division (designed). `generateSchedule(structure, priorRanks, seasonIndex, rng)` takes them as inputs so a later rollover can pass real ones.

Weeks: every team plays once in each week except its bye. Byes fall in weeks 5 to 14 (source 3, the 2026 window). How many teams rest in a given week is designed (an even number, at most 6 proposed). Games are placed into weeks by a seeded search that either returns a valid schedule or a typed error; C5 requires it never fails. Not in v1, because no primary source was read for them and each adds a constraint to the search: a final week of division games only, limits on consecutive road games, spacing of division rematches.

### Standings and tiebreakers (D)

Standings are a pure function of the results: wins, losses, ties, win percentage, points for and against, division and conference records, games back and the current streak (from the results in week order). A tie counts as half a win and half a loss (source 8, unconfirmed). At any point `standings(state, data)` returns division order, conference order and current playoff seeds, from the tiebreakers applied to the results so far. No clinched or eliminated flags in v1.

All twelve division steps and all eleven wild-card steps from the NFL procedure (source 4) are in v1, because every one can be computed from stored scores and touchdown counts:

- Division, two clubs: head-to-head; division record; common games; conference record; strength of victory; strength of schedule; combined rank in the conference in points scored and points allowed; the same rank among all teams; net points in common games; net points in all games; net touchdowns in all games; coin toss.
- Wild card, two clubs (clubs from one division use the division steps): head-to-head if they met; conference record; common games, minimum of four; strength of victory; strength of schedule; the two combined ranks; net points in conference games; net points in all games; net touchdowns; coin toss.
- Three or more clubs: the same lists, with head-to-head applying only as a sweep in the wild-card case, and the NFL's restart rule: when a step separates one club, the remaining clubs start again at step 1 of the format that applies. Before a wild-card tie between divisions is broken, each division's clubs are reduced to its highest-ranked one by the division steps. Only one club advances per pass.
- Coin toss: one draw from a generator derived from the franchise seed, the season and the sorted ids of the tied clubs, so it does not depend on the order the question is asked.

Nothing is deferred from the list. What is deferred: the draft-order tiebreakers on the same NFL page (no rookie draft yet).

### Playing the season (E)

- **Game seeds.** Each scheduled game's seed is a pure function of the franchise seed, the season and the game id. It does not depend on the order games are played.
- **Team pools.** For a game, each team's `TeamPool` is built from its roster at that moment: players in depth order (position order as in `POSITIONS`, then overall descending, ties by id), with their numbers. Each team gets the average coach, passed per team as today, so M3 can replace it.
- **The user's game.** `userGameSetup` returns the `GameSetup` and the user's side. The app plays it through the unchanged `startSession` and `answerSession`. `completeUserGame(state, data, record)` accepts only a final record whose seed, teams and game type match the scheduled game. The user may instead sim their own game headless.
- **Other games.** `simGame` and `simWeek` play each with `playGame` and the same kit settings as the user's game (standout plays and close calls on or off for all 32 teams alike). A week's results do not depend on the order its games are played, or on whether the user's game went first.
- **What is kept per game.** Game id, seed, both scores, both touchdown counts, overtime flag, who played it (user or sim), both teams' `TeamBox` (which has `byPeriod`, so the line score comes with it) and a digest of the record. No player lines and no game log. A game is not re-simulated to show a box score: rosters and builds change, so it could disagree with the stored score. Touchdowns are counted from the record's events in the franchise layer, since `TeamBox` has no touchdown field. The full event log is not kept (non-goals: stats).
- **Weeks.** A week is open until all its games are final. The next week opens then. Each result is committed as its game finishes: after a sim error the finished games stay final and sim resumes the rest. After week 18 the playoff field is set.
- **Speed.** At the PERF.md figure a week of 15 other games is about 0.11 s and a whole 272-game season about 2 s in Node on Joseph's machine. That is fast enough that one week needs no progress bar. The worker figure is unmeasured, so E7 sets a budget and requires the measurement. `simWeek` and `simTo` report after each game anyway (the callback costs nothing), which gives "sim to the end of the season" its progress and lets the worker stop between games.

### Playoffs (F)

Sources 3, 4 and 8. Seven teams per conference: the four division winners seeded 1 to 4 by record, then the three best other records seeded 5 to 7, ties by the procedures in D (division winners against each other use the wild-card steps). Seed 1 has a bye. First round: 2 hosts 7, 3 hosts 6, 4 hosts 5. Second round: seed 1 hosts the lowest remaining seed and the other two winners meet at the higher seed (unconfirmed, source 8). Conference final at the higher seed (unconfirmed). The two conference champions meet in the title game at a neutral site: no home-field edge for either team. Thirteen games, all game type `postseason`, so none ends tied. Round names (designed, playoffs.json): First round, Second round, Conference final, then the title game's name. `bracket` works in any week: before week 18 ends it is the provisional bracket from current seeds, marked provisional.

Neutral site without touching the loop: `gamePlayers` reads home field from the kit's data, so the title game can use a kit prepared from the same data with `homeField` zeroed. Any other way that leaves the pinned files alone is fine. Which finalist is listed as home in the title game is designed: the Founders champion in even seasons, the Frontier champion in odd.

### Trades (G)

- **When.** From the end of the draft until the deadline, and only while the current week has no final game and the user has no game in progress (a resumed game rebuilds its pools from the rosters, so a trade mid-game would replay a different game). The NFL deadline in 2026 is the Tuesday after Week 9 (source 5; the week is derived from the dates). In the game: trading is open through the gap after week 9 and closes for good when the first week 10 game is final. `tradeDeadline.afterWeek` is 9 in trade-ai.json.
- **What.** The user offers 1 to 3 of their players for the same number from one AI team (max per side designed). Equal counts keep both rosters at 53. The offer is valid only if both rosters stay inside min and max at every position.
- **AI answer (designed, trade-ai.json, no randomness).** A player's value is position weight x a convex curve of overall, so one star is worth more than two average players. To a given team it is scaled by a need factor: more if he would start for them, less if he would sit. The AI accepts when what it gets, valued for its own roster after the trade, beats what it gives by at least the required margin. The same offer in the same state always gets the same answer.
- **Reason.** Every answer carries one code and the numbers behind it, and only factors the model used: `accepted`, `valueTooLow` (their value in, value out, the gap), `createsNeed` (the position where their projected starters get worse and nothing coming back covers it), `invalidRoster` (team, position, count against min or max), `windowClosed`, `gameInProgress`, `notYourPlayer`. The screen writes the sentence.
- **Preview.** `evaluateTrade` returns the answer, both sides' values and both teams' `teamSummary` after the trade, without changing anything. The screens show the values, the summaries and legality, and the answer only after Propose. Repeat offers are not limited: the answer is deterministic, so probing is accepted. `proposeTrade` applies an accepted offer and logs it with the week.
- **Numbers.** A traded player keeps his jersey number if it is free and legal on the new team. Otherwise he gets a seeded draw from the free legal numbers. A roster always has unique legal numbers and numbering never throws.

### State, save and worker API (H)

`FranchiseState` is plain JSON and is the save. Joseph approved this schema and its shared types on 2026-11-24 (question 8).

Stored (anything a later code or data change could otherwise alter):

- `schemaVersion` (1), franchise seed, the settings (user team, chosen draft slot, standout plays and close calls on or off, the M3 playbook switch and the coach styles flag, both off for a franchise created before they exist), and the data and code hashes at creation (for information).
- League: the 32 teams with id, place, nickname, conference, division.
- Every pool player in full (id, name, position, ratings, skills), drafted or not.
- Rosters (team to player ids) and jersey numbers.
- Draft: the slot list, every pick (slot, player, who picked), the auto-draft flag, the user's targets.
- Season: index, prior ranks, the schedule (id, week, home, away, kind), results as in E.
- Playoff games and results.
- Trades in order, each with its week and the answer given.
- The phase (`draft`, `regularSeason`, `playoffs`, `complete`) and the open week.
- The user's game in progress, if any: game id plus the existing answer log.

Re-derived on load, never stored: standings, tiebreak order, playoff seeds, the bracket, team summaries and averages, trade values, game seeds, team pools, AI draft profiles. There is no clock and no "results seen" flag: the written-at time and status line live in the app's storage wrapper, and there is no `startSeason` or `advanceWeek` command. No generator state is stored: every stream is derived from the seed and a counter already in the state.

Hash rule: a franchise loads under any later build whose schema version it matches. Only the in-progress user game is tied to `dataHash` and `codeHash`; on a mismatch the franchise loads and that one game restarts from kickoff, and the load result says so. A change to a file under data/franchise must not change the `dataHash` that single-game saves pin. Expected size is well under 1 MB (about 1,871 players); H5 measures it.

Worker: the app's worker gains franchise messages that map one to one onto the functions above (create, draft view, pick, auto-pick, auto-draft, run draft, team and league summaries, season view, start or resume the user's game, sim game, sim week, sim to a week, standings, bracket, evaluate and propose trade, save, load). Message names are the engineer's and designer's call. The draft messages (create, draft view, pick, auto-pick, auto-draft, targets, preview, run draft, summaries, save, load) may ship right after B. Every incoming message is validated before use, as today. The franchise save lives in its own IndexedDB record, apart from the single-game autosave.

## Milestones

Each ships on its own and goes through code-reviewer and test-writer. A first. B, C and D can run in parallel after A (D on hand-made result fixtures). E needs B, C and D. F needs D and E. G needs B and E. H's types start with A and its save and worker parts close after G. I needs all.

### A: data, league structure, pool, overall, team views

Adds: data/franchise/{league,roster,pool}.json, packages/shared/src/franchise.ts and franchise-schema.ts, packages/sim/src/franchise/{league,pool,overall,summary,kit,errors,index}.ts, scripts/franchise/tune-pool.ts.

Every tolerance below is designed and committed before its first run. Test seeds are never tuning seeds. A5, A6a, A10 and A11 are checked after B, since they need drafted rosters.

| # | Criterion | How it fails |
| --- | --- | --- |
| A1 | Each data file parses with its zod schema; a fixture with a wrong shape fails. roster.json: targets sum to `rosterSize`, and `min <= target <= max` for every position against `slotNeeds`. | Bad file passes, or targets that cannot fill a roster. |
| A2 | `createFranchise` is deterministic by seed and differs across seeds: 32 teams, two conferences, four divisions of four each, unique names and ids. | Any failure. |
| A3 | The name check covers data/franchise and fails a fixture containing a real conference, division, team or title game name. No real name is written to the repo. | A real name passes. |
| A4 | The pool has exactly the configured count per position, unique ids, unique full names, every rating an integer 0 to 99, and every player the right skills for his position. `adjust` names only ratings in the position's `overallWeights` (schema); a rating with no entry equals the plain curve draw, and no player is in a tier. | Any failure. |
| A5 | Centering: over 800 seeded leagues (seeds 1 to 800) drafted with auto-draft on, the deployed mean of each of the 67 position ratings is within 0.5 points of `leagueMeans`. 800 rather than 200 so sampling error (about 0.18 at a one-player position over 200, arithmetic) cannot fail it. The uniform mean over projected starters is reported beside it. Nothing here limits how good a backup may be. | The field above or below the engine's center. |
| A6a | Pre-check, run now: 20 drafted leagues, 272 games each between randomly paired teams under `franchiseKit`, against 5,440 `generateLeague` games under the same kit settings. Same tolerances as A6, with standouts off and with standouts on. Reports margin SD for both. | Scoring off the baseline. |
| A6 | League totals: 20 all-AI franchise regular seasons against 5,440 games between `generateLeague` teams under the same kit settings. Points per team-game differ by at most 1.0 and turnovers per team-game by at most 0.15 (the step 5 tolerances). Report both sets of figures. This is the real gate for the pool; it needs C and E. | A franchise league that scores off the baseline. |
| A7 | `overall` equals the app's `overallRating` for every player of a generated pool, from one weights file. | Two formulas or two files. |
| A8 | `teamSummary` on hand-made rosters: counts, both needed figures, projected starters, each average and each rank match hand-computed values, including an empty position (null average). | Wrong value. |
| A9 | `codeFiles()` returns the same list, and `git diff` shows no change to any file in it. The purity and import tests cover franchise/; the only test edit is adding `franchise.ts` to the allowed shared files in packages/sim/test/imports.test.ts, flagged to the lead. | A pinned file changed, or zod reachable from the sim. |
| A10 | Spread and standouts, on A5's leagues: the deployed SD of each of the 67 ratings (players weighted by the deployment weights) is within 15% of quick play's, computed the same way. With standouts on over A6a's franchise games, each kind's mean applied factor is 1 within 0.02 (`observeStandouts`). Reported: the SD of projected starters' overall and the share of deployed players at 90 and up per standout rating, both modes. | A flat or inflated field, elites missing or doubled. |
| A11 | Playable bench, on A5's leagues, for each position with target above min: (1) mean projected-starter overall minus mean first-backup overall (depth slot min + 1) is at least 2 and at most 15; (2) mean overall at the target slot is at least 40; (3) at least 5% of first backups have an overall at or above the 10th percentile of that position's projected starters, league-wide. Designed bounds. Arithmetic puts the gaps at about 5 to 10, not measured. | A cliff, unplayable depth, or no overlap. |

### B: draft

Adds: data/franchise/draft-ai.json, packages/sim/src/franchise/{draft,draft-ai,numbers}.ts.

| # | Criterion | How it fails |
| --- | --- | --- |
| B1 | Order: seeded shuffle; with a chosen slot the user is at that slot; odd rounds ascend and even rounds descend; 1,696 slots, each team owns 53. | Wrong order. |
| B2 | Legality: fixtures for each of the three rules show the blocked pick, the rule named, and the state unchanged. A pick out of turn, a drafted player and an unknown id return typed errors. | Illegal pick applied, or a throw. |
| B3 | An all-AI draft from any of 1,000 seeds ends with 32 rosters of 53 inside min and max at every position, no player on two teams, and no team ever left without a legal pick. | Any failure. |
| B4 | The same holds for 1,000 drafts where a scripted user picks uniformly at random among legal picks, and for 100 where the user always takes the position it already has most of. | A reachable dead end. |
| B5 | Determinism: same seed and same user picks give deep-equal states; a different user pick changes later picks; a state saved to JSON mid-draft and resumed ends identically. | Any difference. |
| B6 | With no usable target, auto-pick equals what the AI policy with the `autoPick` profile would pick for that team. With one, it takes the highest-overall usable target. Auto-draft follows the same rule. `runDraft` with auto-draft on and `through: "end"` runs to the end with no user turn; `"nextUserPick"` stops at the user's next turn after making his current pick; both give the same picks in the end. Switching auto-draft off stops at the user's next turn. | Mismatch. |
| B7 | The AI's input is a narrowing of the draft view (board id, position, overall and its own roster counts) plus its own profile. Type-level, and a test: changing any player's ratings or skills while his overall is unchanged leaves every AI pick unchanged. | Hidden input. |
| B8 | `draftView` has every field listed under Draft, and its summaries equal `leagueSummaries` after each pick. | Missing or stale field. |
| B9 | Numbers: after the draft every roster has unique numbers legal for each position; 10,000 seeded rosters never throw. | A clash or a throw. |
| B10 | A full all-AI draft takes at most 250 ms on Joseph's machine (designed budget), recorded in PERF.md. | Over budget. |
| B11 | Targets round-trip through JSON mid-draft, a drafted target stays in the list and out of `targetsAvailable`, and every AI team's picks are identical with and without user targets when the user's own picks are the same. | AI reads targets, or a target is lost. |
| B12 | Over 200 seeded states with the user on the clock, `autoPickPreview` names the player auto-pick then drafts, its reason code matches the branch taken, and its value, need and noise sum to its score. | Wrong or invented reason. |
| B13 | No one-position rounds, over seeds 1 to 200 drafted with auto-draft on: averaged by round, no position is over 50% of a round's 32 picks; no single round of any draft is over 75% one position; at least 10% of the picks in rounds 1 to 33 are `depth` or `extra` when made. Designed bounds. | A run like round 34's quarterbacks, or starters first and then depth. |
| B14 | Team spread, reported, not gated: the same-ruler figures under "Team spread" for drafted and generated leagues (seeds 1 to 200) and their ratio against the 75% to 125% target, plus the best and worst team's average per league. | Missing, or measured two ways. |
| B15 | Profiles: the same seed gives the same style and `errorSd` per team, and a team's error for a player is the same before and after other picks, after a JSON round trip, and whichever team the user controls. With `errorSdMin` and `Max` 0 and one style, all AI teams score a board alike. Schema fixtures: an `errorSdMax` over 8, a `slotNeed` list that rises or whose length is not the target, a style naming no known position, an `autoPick.style` that does not exist. | Drifting errors or a bad file accepted. |
| B16 | Reported: over 200 leagues, the mean rank among 32 and the mean team average of the auto-drafted user team, against the AI teams. | Missing. |

### C: schedule

Adds: data/franchise/schedule.json, packages/sim/src/franchise/schedule.ts.

| # | Criterion | How it fails |
| --- | --- | --- |
| C1 | Every team has 17 games: 6 division (each rival home and away), 4 against the rotation division in its conference (2 home, 2 away), 4 against the other-conference rotation division (2 home, 2 away), 2 same-place games (1 home, 1 away), 1 extra game against the same-place team of an other-conference division it does not otherwise play. 272 games. | Any count off. |
| C2 | One conference hosts all 16 extra games, so its teams have 9 home games and the others 8; the host conference alternates with the season index. | Wrong split. |
| C3 | Over season indexes 0 to 3 every pair of teams meets at least once, and each rotation table returns to its start after its cycle (3, 4, 4). | A pair that never meets. |
| C4 | Weeks: 18 weeks; each team plays at most once a week and has exactly one bye, in weeks 5 to 14; weeks 1 to 4 and 15 to 18 have 16 games; teams on bye per week are even and at most the configured cap. | Any violation. |
| C5 | 1,000 seeds: every schedule valid, none hits the typed "no schedule" error, deterministic by seed. Time per schedule recorded in PERF.md, at most 1 s (designed budget). | A failure, or over budget. |
| C6 | Prior ranks and season index are inputs; the same inputs give the same schedule; first-season ranks are a seeded permutation of 1 to 4 per division. | Hidden state. |

### D: standings and tiebreakers

Adds: data/franchise/playoffs.json (step lists), packages/sim/src/franchise/{standings,tiebreak}.ts.

| # | Criterion | How it fails |
| --- | --- | --- |
| D1 | Records, percentage (tie as half), points, division and conference records, games back and streak, at the end and mid-season, with the current seeds, match hand-computed values on a fixture season that includes a tie. | Wrong value. |
| D2 | One hand-made fixture per step of the two-club division list and the two-club wild-card list, each built so that step decides and all earlier steps are level. The result names the step that decided. | Wrong winner or wrong step. |
| D3 | Three-club fixtures: a step that separates one club restarts the other two at step 1; a wild-card tie across divisions first reduces each division to its top club; head-to-head applies only as a sweep; "minimum of four" common games is enforced. | NFL procedure not followed. |
| D4 | The step lists are data: reordering two steps in a fixture file changes the outcome of a fixture built for it. | Order hard-coded. |
| D5 | Coin toss: same seed and same tied clubs give the same winner whatever the input order; a different seed can differ. | Order-dependent. |
| D6 | Over 200 simulated seasons the ordering is total and stable: shuffling the input order of teams and results never changes a division order or a seed. | Unstable order. |
| D7 | The report of 200 seasons lists how often each step decided a division title or a wild-card spot. | Missing. |

### E: season weeks

Adds: packages/sim/src/franchise/{season,games}.ts.

| # | Criterion | How it fails |
| --- | --- | --- |
| E1 | Game seeds depend only on franchise seed, season and game id. Playing a week's games in any order, with the user's game first or last, gives identical results. | Order-dependent. |
| E2 | A spy on the kit shows every game goes through `playGame` or the session functions, and the franchise layer writes no score it did not read from a record. | A made-up result. |
| E3 | The pool given to the engine for a team is its roster in depth order with its numbers; the players in the record's on-field lists at each position are that team's top players by overall. | Wrong starters. |
| E4 | `completeUserGame` rejects, with a typed error and no change: a record that is not final, a wrong seed, wrong teams, wrong game type, a game already final. | Accepted. |
| E5 | The user's game played to the end through `startSession` and `answerSession` by a scripted seat, and the same game simmed headless, both leave a valid state. Replaying the stored answer log gives the same result. | Divergence. |
| E6 | Every team in the league plays under the same standout and close-call settings as the user's game. | Mixed settings. |
| E7 | Speed: one week's 15 or 16 headless games, mean and p95 in Node and in the app's worker in Chromium on Joseph's machine, recorded in PERF.md with machine and command. Budget (designed): p95 at most 500 ms in the worker. A progress callback fires once per finished game, and `simTo` can be stopped between games with the state consistent. | Unmeasured, over budget, or a stop that corrupts state. |
| E8 | After week 18: 272 results, every team 17 games, league wins equal league losses, and every tie is counted once for each of its two teams. | Bad totals. |
| E9 | Both teams' stored `TeamBox` equals `boxScore` of the record, for a simmed and a user game, and its points equal the stored score. An error in one game of `simWeek` keeps the finished games final, and a second call plays only the rest. | Wrong or missing box, or a week half rolled back. |

### F: playoffs

Adds: packages/sim/src/franchise/playoffs.ts.

| # | Criterion | How it fails |
| --- | --- | --- |
| F1 | Seeding on fixtures: four division winners 1 to 4, three wild cards 5 to 7, a division winner with a worse record still seeds above a wild card, ties by D. | Wrong seed. |
| F2 | Round 1 pairs 2 with 7, 3 with 6, 4 with 5 at the higher seed; seed 1 does not play. Round 2 on every combination of round 1 winners: seed 1 hosts the lowest remaining seed, the other two meet at the higher seed. Round 3 at the higher seed. | Wrong pairing or host. |
| F3 | The title game applies no home-field edge: over 4,000 title games between identical rosters the listed home team's win rate is 50% within sampling error, while the same test with home field on is not. | Home edge in the title game. |
| F4 | All 13 games are `postseason` and none is tied over 1,000 simulated playoffs; each produces one champion and moves the phase to `complete`. | A tie or no champion. |
| F5 | `bracket` shows round names, seeds, pairings, hosts and results for finished and coming rounds, and matches the stored results. In weeks 1 to 18 it is marked provisional and equals the bracket of `standings`' current seeds. | Stale bracket. |

### G: trades

Adds: data/franchise/trade-ai.json, packages/sim/src/franchise/{trade,trade-ai}.ts.

| # | Criterion | How it fails |
| --- | --- | --- |
| G1 | Window: open after the draft and through the gap after week 9; closed while a week has a final game and not all; closed with `gameInProgress` while the user's game is in progress; closed for good once a week 10 game is final and in the playoffs. Fixtures at each boundary. | Wrong at a boundary. |
| G2 | Validity: unequal counts, more than the cap per side, a player not on the stated team, the user's own team as partner, and any roster outside min or max afterwards all return the matching code with the state unchanged. | Applied, or wrong code. |
| G3 | Fixtures for each AI reason code; the numbers in the answer equal the model's own values; no code or number comes from a factor the model did not use. | Invented reason. |
| G4 | `evaluateTrade` changes nothing and equals the answer `proposeTrade` then gives, and its two summaries equal `teamSummary` after an accepted trade. The same offer in the same state always gets the same answer. | Mismatch. |
| G5 | No free value: over 1,000 seeded random valid offers, the AI never accepts one that lowers its own model value, and with a positive margin an accepted trade's exact reverse is rejected right after. | A value pump. |
| G6 | After any accepted trade both rosters have 53 players inside min and max, unique legal numbers, and the players' ids are unchanged. 10,000 seeded trades never throw. | Broken roster. |
| G7 | A trade changes later games only: results already stored are untouched, and the next game uses the new rosters. | History rewritten. |
| G8 | The acceptance rate of random offers, by rating gap, and the change in the league's deployed means after a season's accepted trades, are in the playtest report (not gated). | Missing. |

### H: save shape and worker API

Adds: `franchiseSaveSchema` in franchise-schema.ts, packages/sim/src/franchise/save.ts, packages/app/src/engine/franchise.ts and its protocol and message checks, a franchise record in packages/app/src/ui/storage.ts. The schema is signed off (question 8).

| # | Criterion | How it fails |
| --- | --- | --- |
| H1 | The state round-trips through JSON at every phase (mid-draft with targets, between weeks, mid-week, user game in progress, playoffs, complete) and continues to the same champion as an unsaved run. | Any difference. |
| H2 | The zod schema rejects a damaged save and an unknown `schemaVersion` with a typed reason; nothing is silently dropped or defaulted. | Bad save loads. |
| H3 | Nothing derived is stored: the saved JSON has no standings, playoff seeds, summaries, game seeds, AI draft profiles, wall-clock time or generator state, and the schema is strict, so an extra key fails to parse. | Stored derived data. |
| H4 | A save written under one code hash loads under another with the franchise intact; an in-progress user game restarts from kickoff and the load result says so. Changing a data/franchise file does not change the single-game `dataHash`. | Franchise lost to a code change. |
| H5 | Save size after a full season is recorded in PERF.md and is at most 2 MB (designed budget). | Unmeasured or over. |
| H6 | Each worker message is validated; a malformed one is dropped with a warning as today; driving the worker's handler in Node plays a whole franchise (draft, season, playoffs, one trade) through messages only. | Unvalidated input, or a gap in the API. |
| H7 | The franchise save and the single-game autosave do not overwrite each other. | One clobbers the other. |

### I: headless season, soak, docs, playtest gate

Adds: scripts/franchise/{data,season}.ts, a `sim:season` script in package.json, docs updates.

| # | Criterion | How it fails |
| --- | --- | --- |
| I1 | `pnpm sim:season -- --seed <n>` prints the seed, the draft's first round and each team's summary, final standings by division, seeds, the bracket with scores and the champion. Same seed twice is byte-identical. | Diff, or seed missing. |
| I2 | Soak (heavy project): 100 all-AI franchises from draft to champion with no error, every schedule valid, every invariant from A to G holding. CI runs a fixed slice of 3 and matches committed digests. | Any violation or digest mismatch. |
| I3 | The existing calibration is untouched: `pnpm test`, `pnpm test:heavy`, lint and typecheck pass with no pin refreshed and no tolerance or existing test edited. | A stale or edited pin. |
| I4 | docs/MODEL.md has a "Franchise" section marking every part designed (or cited); docs/RULES.md has the Sources rows with status; docs/DECISIONS.md has an entry per designed choice here; CLAUDE.md Run has the command. | Missing or mislabeled. |
| I5 | The soak report gives, over the 100 seasons: SD of team win percentage, margin SD, the spread of team overall after the draft (B14's measure), how often the top seed won the title. The NFL figure for SD of team win percentage is [gap: to be computed by the pipeline from nflverse schedules, 2016-2023 only]. Reported, not gated, and not tuned toward. | Missing, or a parameter tuned to close the gap. |
| I6 | playtester runs the M4 gate: the soak, three seasons read end to end from the CLI, and at least 30 hand-made trade offers, and reports anything no general manager would do (a team drafting four kickers, a star swapped for a backup, a 0-17 team). | Not run. |

## Edge cases that are reachable

- The user turns auto-draft on before pick 1, or mid-round while it is another team's turn.
- Every target the user marked has been drafted: auto-pick falls back to the AI policy.
- An AI team's misreading makes it pass a better player: the user sees a bargain on the board.
- A trade is proposed while the user's game is in progress: `gameInProgress`.
- The user holds two picks in a row at a snake turn (slots 32 and 33).
- A position's pool runs low late: rule 3 blocks a pick that would leave another team unable to field a unit.
- The user's team has its bye: the week has only other games.
- The user quits mid-game: the answer log is in the save; after a build change that game restarts.
- A regular-season game ends tied: counted as half, and it can decide a tiebreaker.
- Two clubs level through every step: the seeded coin toss.
- Three clubs tied for two wild-card spots, two of them from one division.
- A division winner with a losing record hosts a wild card with a better one.
- A trade offered on deadline day (after week 9, before week 10), and one offered a game too late.
- A traded player's number is taken on his new team.
- A trade for the player who would become the other team's only quarterback: blocked by the position minimum.
- The title game listed "home" team gets no edge.
- Loading a save from a newer schema version: refused with a reason, the file left as it was.

## Dependencies and sequencing

- Does not wait for M3. Every team uses the average coach, passed per team.
- Builds on the M2 step-wise session unchanged. If the designer's screens need something the session cannot give, that is a separate change with its own pin refresh, decided by the lead.
- Questions 1, 2 and 8 are settled. The rest have defaults the build can start on.
- Order for this revision: data shapes and tolerances committed first, then the AI profiles, then draft-ai.json tuned to B13 and B14, then pool.json tuned, then A5, A6a, A10 and A11 run once on test seeds. A failed A5, A6a, A10, A11 or B13 is fixed in data on tuning seeds, never by moving a bound.
- Tolerances in A5 and A6 are committed before their first run.
- The designer's spec reads the Team views, Draft view, trade answer and bracket shapes from here. A field the screens need and this spec lacks comes back as a FLAG.

## Locked vs likely to change

Locked: purity and seeding; no pinned file edited; `resolvePlay` decides; NFL season shape (17 games, 18 weeks, 14 playoff teams, the tiebreaker order); stored facts versus derived views; reasons only from the model.

Likely to change: every number in data/franchise after the first playtest (targets, surplus, pool adjust, AI slot needs, styles and errors, trade margin); the rotation tables; the bye cap; the search limits; message names; the fictional names.

## Sources

Read 2026-11-23. Primary sources first. The engineer copies these to docs/RULES.md and re-reads each page when doing so, since the pages were read through a summarizing fetch tool and the wording below is paraphrase unless quoted.

1. NFL Football Operations, "Creating the NFL Schedule", https://operations.nfl.com/gameday/nfl-schedule/creating-the-nfl-schedule/ : "Each NFL team plays 17 games over the 18-week season", one bye per team, 272 games, 32 teams in two conferences of four divisions of four; the five-part formula (six division games; four against a division in its conference, two home and two away; four against a division in the other conference, two home and two away; two against the two remaining divisions of its conference by the previous season's division ranking, one home and one away; a 17th game against a non-conference opponent from a division the team is not scheduled to play); every team plays each of the other 31 at least once in four years; teams alternate between nine and eight home games.
2. NFL.com, "2026 NFL season: Team-by-team opponents for every game", https://www.nfl.com/news/2026-nfl-season-team-by-team-opponents-for-every-game : the intraconference rotation is a three-year cycle, the interconference rotation a four-year cycle, the 17th game "based on the prior year's standings on a rotating four-year cycle", and "The home conference for this game will rotate."
3. NFL Communications, "2026 NFL Schedule Announced", https://media.nfl.com/football-information/2026/news/2026-nfl-schedule-announced : 18 weeks, 272 games; "Byes will begin in Week 5 and end in Week 14"; the 17th game pairs teams that finished in the same standing; 14 playoff teams, seven per conference; the No. 1 seed in each conference has a bye; the other division champions are seeded 2, 3 and 4 and the next three best records 5, 6 and 7; the 2 seed hosts the 7, the 3 hosts the 6, the 4 hosts the 5; the title game is at a site chosen in advance (2026 season: SoFi Stadium).
4. NFL.com, "NFL Tiebreaking Procedures", https://www.nfl.com/standings/tie-breaking-procedures : the division and wild-card step lists as given under Standings and tiebreakers, the three-or-more-club restart rule, one club advancing per step, common games compared by winning percentage, home-field priority among division winners by the wild-card steps, and combined rank as the sum of ranks in points scored and points allowed with the lowest total winning.
5. NFL.com, "2026-27 National Football League important dates", https://www.nfl.com/news/2026-27-national-football-league-important-dates : November 10, 2026, "All trading ends for 2026 at 4:00 p.m., New York time"; August 30, clubs "must reduce rosters to a maximum of 53 players on the Active/Inactive List"; a practice squad of 17 players including one international player (not used in v1); Kickoff Weekend September 9-10 and 13-14; Week 18 January 9-10. Derived, not stated on the page: Week 1's Sunday is September 13, so Week 9's is November 8 and the deadline falls after Week 9 and before Week 10.
6. NFL Football Operations, "NFL important dates", https://operations.nfl.com/calendar-events/nfl-important-dates : the same postseason dates.
7. Not a primary source and not used in v1: the game-day active list of 48 (47 with fewer than eight offensive linemen active) was found only in the CBA text hosted at overthecap.com (Article 25). Recorded so a later milestone knows where to look.
8. Not confirmed from a primary source in this pass, to be marked `unconfirmed` in RULES.md until read on an NFL page: (a) in the second round the top seed hosts the lowest remaining seed and the other two winners meet at the higher seed (seen in a search summary of an nfl.com article on the 2025 postseason and in NBC and Fox explainers); (b) the higher seed hosts the conference final; (c) a tie counts as half a win and half a loss in the standings. I could not find these on operations.nfl.com or in the pages above.

The operations.nfl.com tiebreaker address (operations.nfl.com/the-rules/nfl-tie-breaking-procedures/) now serves the site's front page, so source 4 is the nfl.com copy.

## Open questions for Joseph

Each has a default so the build is not blocked.

1. Settled (Joseph, 2026-11-24): Founders Conference and Frontier Conference, divisions North, South, East and West in each, the title game is the Clipboard Cup, and rounds are First round, Second round, Conference final.
2. Settled (Joseph, 2026-11-24): 53, the NFL limit, with the targets listed under Player pool. That means 53 draft rounds, and until M5 brings injuries, fatigue and a depth chart, the 20 backups never take the field. They still count for trades.
3. Open: who starts. Default: the best overall at each position starts, for the user's team too. Choosing your own starters waits for the M5 depth chart.
4. Open: trade size. Default: equal swaps of 1 to 3 players per side. Uneven trades wait for free agents in M6.
5. Open: should the AI ever offer the user a trade, or trade with each other? Default: no, not in v1.
6. Open: after the title game. Default: the franchise is complete and you start a new one. The schedule already takes last season's places and a season number, so "play another season with the same rosters" is a small later addition, but without aging or a rookie draft it is the same league again.
7. Open: draft slot. Default: random by seed, with the option to choose any slot from 1 to 32 before the draft.
8. Settled (Joseph, 2026-11-24, with the reconciliation's additions): the franchise save schema and shared types under State, save and worker API (saved targets, both teams' `TeamBox` per game and the two M3 switches included), the eight data files under data/franchise and the worker messages. Schema version 1. The `sim:season` script and the one allow-list line go with it.
9. Open: how fair should the first-season schedule be? Default: the "last season's places" that set three of the 17 games are random for a new league, as there is no last season.
10. Open: the tolerances and budgets proposed here (A5 0.5 points, A6 1.0 points and 0.15 turnovers, B10 250 ms, C5 1 s, E7 500 ms, H5 2 MB) are designed proposals. Default: accepted as written and committed before their first run.
11. Replaced by 12.
12. Open: should AI teams draft differently, with some judging players worse than others (evaluation error SD from 1 to 7 points, capped at 8) and named styles, so leagues have strong and weak teams? Default: yes, aiming at 75% to 125% of quick play's team spread, reported in B14. If the draft cannot reach that within the cap, the choice comes back to you: accept the flatter league, or raise the cap. No hidden rating shift, ever.
13. Open: auto-pick reads the board exactly, while AI teams misjudge players. That is clear to a new player but may make an auto-drafted team better than average. Default: exact, with the edge reported (B16). The other choice is giving auto-pick an average team's error, which would sometimes take a visibly lower-rated player.
14. Open: data/franchise/pool.json and draft-ai.json change shape (they are unreleased and stay at schema version 1; the save does not change). CLAUDE.md says ask first for schema changes. Default: covered by question 8.
