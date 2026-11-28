# Roadmap

Status: open questions settled by Joseph on 2026-11-11. Each milestone still gets its own spec and sign-off before it is built.

Note, 2026-11-23: Joseph asked for four features: a franchise mode, better and more plays with recommendations, custom drawn routes on offense and defense, and better visuals and feel. Work on them is planned and has started ahead of the old M3 to M8 order. See "Request of 2026-11-23" below for where each one sits, what it pulls forward and what waits on him.

The milestones M1 to M9 come from the original brief. This file places everything Joseph asked for since then. Each feature goes in the earliest milestone that already builds what it depends on, so nothing gets built ahead. The 2026-11-23 request is the one exception: it pulls named parts forward on purpose, and only those parts.

Rules that still apply to every new feature:
- Depth target (Joseph, 2026-11-11): detailed to the point of a sim without being one, and approachable. When in doubt, more detail. Leave out layers that only repeat the same decision, and put full detail one click behind the headline numbers. The depth goes mainly into year-to-year change: players growing and aging, rosters turning over, contracts, drafts, coaching changes and the team's history across seasons, rather than micro-management inside one week.
- At most seven choices on a screen. Each management screen gets at most five decisions.
- Balance lives in data. Designed layers (coach styles, stamina, standout plays) are centered, so the league as a whole still matches real NFL totals and only individual teams and players differ.
- Borrow general ideas only. Never copy another game's named systems, look or branding.

## Where everything goes

| Milestone | From the brief | Added on request |
|---|---|---|
| M1 (in progress) | Pipeline, play engine, one full game as text, 10,000-game calibration | Done: ratings 0-99 for every player (Speed, Strength, Agility, Awareness plus position skills). In step 5: room left for stamina and coaches |
| M2 | Play calling UI, X's and O's animation, one quick game | Rating bars on player cards. The engine names which player made each play (needed for the animation anyway). Standout plays. Per-player game stats in the box score. 2026-11-23: the visual and feel pass continues this polish |
| M3 | AI coordinators with personalities, win probability decisions, hints | Coaches change how a team calls plays: each coordinator's style shifts run/pass, aggression on fourth down, blitz rate and tempo. 2026-11-23: recommendations before every call, a bigger playbook of named plays, and custom drawn routes. Started early |
| M4 | 32 teams, schedule, standings, playoffs, season sim, box scores | News feed (approved). Season player stats and leaders. 2026-11-23: the league, schedule, standings and playoffs are pulled forward as franchise mode, with a start-of-franchise fantasy draft. Started early |
| M5 | Roster, depth chart, injuries, progression and aging | Stamina and in-game fatigue. RPG growth and decline (approved). Weekly training focus (approved) |
| M6 | Contracts, cap, free agency, trades | Trades of players and draft picks, including trades with three or more teams. Morale and re-signing (approved). Team money: ticket prices and revenue. 2026-11-23: player-for-player trades with AI teams are pulled forward into franchise mode. The rest stays here |
| M7 | Draft and scouting | Each prospect shows college stats and one set of combine results inside scouting, with no extra rounds of workouts or reports (Joseph: depth, not extreme depth). Trading picks during the draft |
| M8 | Coaching staff, job security, multi-season saves | Hire, fire, manage and trade coaches. Staff budgets. Stadium upgrades in the off-season. Records, retirements and Hall of Fame (approved) |
| M10 (new, after the franchise game) | | Built-in fantasy football. Sportsbook with odds and spreads, play money only |
| M9 (stretch) | Historical dream matchups | |

Reinstated by Joseph on 2026-11-11: ticket prices, revenue and off-season stadium upgrades. Still cut: relocation.

## Request of 2026-11-23: four features pulled forward

Six specs were written that day, in parallel. docs/specs/m3-m4-reconciliation.md lists where they disagree, the fix for each and one list of decisions for Joseph. Nothing below is finished or tested.

### Where each feature sits

- **Franchise mode.** Specs: docs/specs/m4-franchise-core.md (systems) and docs/specs/m4-franchise-screens.md (screens).
  - Pulls forward from M4: the 32-team league with conferences and divisions, the NFL-shaped schedule (17 games in 18 weeks), standings with the full tiebreakers, and the 14-team playoffs.
  - Pulls forward from M6: player-for-player trades with AI teams, equal swaps of 1 to 3 players, up to the trade deadline.
  - New: a league-wide snake draft at the start of a franchise that builds all 32 rosters from one pool. This is not M7's rookie draft, which stays in M7 with scouting and pick trades.
  - Also new, and smaller than it sounds: rosters of 53 in a franchise, with a read-only roster in depth order. Quick play keeps its 33 players. The backups do not take the field until M5 brings the depth chart, injuries and fatigue.
  - One franchise is one draft and one season through the title game. Every team uses the average coach until M3's coordinators are in.
- **Recommendations and coordinator styles.** Spec: docs/specs/m3-recommendations.md. This is M3 as the brief had it (hints and AI coordinators), built early. It uses expected points, not win probability, which keeps its own later M3 spec. Each team gets an offensive and a defensive coordinator with ratings and a style. Hiring, firing and paying them stays in M8.
- **Bigger playbook and drawn routes.** Specs: docs/specs/m3-playbook-and-custom-routes.md (play model, classifier, engine contract) and docs/specs/m3-calling-screen-playbook-and-routes.md (the in-game flow for the playbook, the coordinator's picks and route drawing). New M3 work, not in the brief: about 147 named play designs that each change what happens, and one player's assignment redrawn per snap on either side of the ball.
- **Visuals and feel.** Spec: docs/specs/m3-visual-and-feel-pass.md. Continues M2's polish. Its first job is to build the DESIGN.md revision the code is still behind, then motion, the camera, impact at the catch and the tackle, and sound if Joseph says yes.

### What stays where it was

- M5: depth chart editing, injuries, progression and aging, stamina and fatigue, weekly training.
- M6: contracts, the cap, free agency, trades with picks or more than two teams, uneven trades, morale and re-signing, tickets and revenue.
- M7: the rookie draft, scouting, trading picks and draft slots.
- M8: hiring, firing and trading coaches, staff budgets, stadium upgrades, job security, a second season and multi-season saves, records and the Hall of Fame.
- M4, with its own spec still to write: season player stats and leaders, and the news feed.
- M10 and M9: unchanged.

### Being built now

Both are in progress. Both are new files only, and engine output is unchanged.

- Franchise core milestones A and B: league structure, the player pool, overall, team views, and the draft. They include the additions the screens asked for (saved draft targets, an auto-pick preview with its reason, a starter, depth or extra label, a must-fill list, the user's next pick).
- Playbook milestones A and B: the catalog data and its schema, and the path classifier.

### Build order

What can run side by side, and what has to wait.

1. Now, in parallel, no answer from Joseph needed:
   - Franchise core A and B (in progress), then C (schedule) and D (standings and tiebreakers), which only need A.
   - Playbook A and B (in progress).
   - Recommendations A to E (coordinators, lineups and values, opponent belief, play and decision advice), as pure sim in new files that stay out of the calibration import graph.
   - The parts of the visual pass that wait on nobody: field paint on today's greens, removing the boxes and glass, type sizes, the two-column bottom edge, the main menu's art.
2. After Joseph signs off the schema changes (one sign-off covers all of them):
   - Franchise core E (season weeks), F (playoffs), G (trades), H (save and worker messages), I (headless season, soak and the playtest gate).
   - Playbook C (designs and drawings travel in the calls), D (design effects), E (drawings change the play), with F (animation) beside D and E.
   - Recommendations F (worker message), G (headless check and playtest gate), H (AI teams call through their coordinators).
3. Screens, in this order, because each is drawn with tokens and data the step before provides:
   - Visual pass selection, chrome, type and chalk cards first. Both new sets of screens are specified on those tokens.
   - Franchise screens: setup and the draft room (needs core A and B plus the draft's worker messages), then the hub, league, roster and week results (needs C to F), then trades (needs G).
   - Calling screen: Home and the Why sheet (needs recommendations F), then playbook browsing and design cards (needs playbook C and D), then the line and route drawing (needs playbook E and F).
4. Last: playbook G turns designs on, with the playtest and calibration. Every M3 edit to a pinned file is re-pinned once there, with one counted holdout run, if Joseph agrees.

Each milestone still ends with code-reviewer and test-writer, and a playtest gate where the spec names one.

### Waiting on Joseph

The full list, with a default for each and what it blocks, is at the end of docs/specs/m3-m4-reconciliation.md. The ones that hold up the most work:

1. Schema changes, as one sign-off: the franchise save and worker messages, designs and drawings in the calls and the game record, the recommendations message, and one app save version bump.
2. Roster size in a franchise: 53 or 33. The build in progress uses 53.
3. The four open DESIGN.md items (turf, stage, white line of scrimmage, the smaller gold highlight).
4. Stop at the line on every call, which reverses the M2 decision that the last key snaps.
5. Playbook browse order, which reverses the formation-first decision of 2026-11-14.
6. M3 scope: AI coach styles in, injuries left in M5.

Also his, and blocking less: names, sound, the longer whistle hold, designs in the calibrated baseline with one counted holdout run, and the threshold for a drawing exploit.

## The new features in a line or two each

- **Standout plays (M2).** Elite players, around 90 and up, get a higher chance of a standout play, like a long run, a one-handed catch or a strip sack. Average players are unchanged, so league totals hold. The why line names it. It needs the engine to know which player made the play, which M2 adds.
- **Coaches change play calling (M3).** Each coordinator is a designed style layered on the fitted average coach. An aggressive coach goes for it more on fourth down, and a pass-first coach throws more. Step 5 already gives each team its own play caller, so a coach slots in without rewriting the game.
- **Fantasy football (M10).** Placed after the franchise game (Joseph, 2026-11-11). It needs a season and per-player stats. Proposal: your own fantasy league against AI managers, drawn from the sim's players. One draft screen, then one weekly lineup screen with at most five decisions, plus waivers and trades between fantasy managers. Scoring is configurable in data.
- **Sportsbook (M10).** Bet on any sim game with play money: moneyline odds, point spreads and over/unders. Lines come from the sim's own win probability and score projections (M3, M4), with a designed bookmaker margin. Results settle from the simulated game, never the other way round: a bet can't change an outcome. One betting screen with at most five decisions. No real money, no purchases, nothing that converts to cash.
- **Stamina (M5).** A 0-99 rating for every player. Players tire over long drives and late in games, and recover some between drives and at halftime. Tired players play a little below their ratings. It lands with the depth chart, because fatigue only matters once you can rotate players.
- **Trades with picks and several teams (M6, M7).** Any trade can include players and draft picks, current or future, and can involve three or more teams. AI teams value picks with a draft value chart from nflverse (license checked before use). One trade screen: pick partners, add assets, and see each side's value before you propose.
- **Tickets and revenue (M6).** Each team earns money from tickets and other designed revenue. You set ticket prices. Higher prices bring in more money but lower attendance, and a thinner crowd shrinks home-field advantage. Winning, star players and the stadium raise demand.
- **Staff budget (M8).** Revenue pays for coaches and staff. A bigger staff budget buys better coordinators, trainers (faster injury recovery) and scouts (sharper draft grades). The owner sets a limit, and overspending hurts job security.
- **Stadium upgrades (M8, off-season).** Spend money between seasons on upgrades that matter on the field or in the budget, for example more seats, a louder crowd (home-field edge) or a better training facility (player growth). One off-season screen with at most five choices.
- **Hire, fire, manage and trade coaches (M8).** Coaches have ratings, a style, a contract and job security. You can hire, fire, extend or trade them. Coach trades follow how NFL teams trade for coaches under contract, looked up and cited when built, not written from memory.

## Questions Joseph settled

1. Settled 2026-11-11: fantasy football and a play-money sportsbook come after the franchise game, as M10.
2. Settled 2026-11-11: tickets, revenue, staff budgets and off-season stadium upgrades are in (M6 and M8). Every money decision has to change something on the field or in the budget you can see.
3. Settled 2026-11-11: stamina comes in M5 with the depth chart.
4. Settled 2026-11-11: standout plays are player moments only. Team momentum is a possible future feature, not scheduled, and would need its own calibration.

## Possible future features (not scheduled)

- Team momentum swings within a game.
