# Roadmap

Status: open questions settled by Joseph on 2026-11-11. Each milestone still gets its own spec and sign-off before it is built.

The milestones M1 to M9 come from the original brief. This file places everything Joseph asked for since then. Each feature goes in the earliest milestone that already builds what it depends on, so nothing gets built ahead.

Rules that still apply to every new feature:
- Depth target (Joseph, 2026-11-11): detailed to the point of a sim without being one, and approachable. When in doubt, more detail. Leave out layers that only repeat the same decision, and put full detail one click behind the headline numbers. The depth goes mainly into year-to-year change: players growing and aging, rosters turning over, contracts, drafts, coaching changes and the team's history across seasons, rather than micro-management inside one week.
- At most seven choices on a screen. Each management screen gets at most five decisions.
- Balance lives in data. Designed layers (coach styles, stamina, standout plays) are centered, so the league as a whole still matches real NFL totals and only individual teams and players differ.
- Borrow general ideas only. Never copy another game's named systems, look or branding.

## Where everything goes

| Milestone | From the brief | Added on request |
|---|---|---|
| M1 (in progress) | Pipeline, play engine, one full game as text, 10,000-game calibration | Done: ratings 0-99 for every player (Speed, Strength, Agility, Awareness plus position skills). In step 5: room left for stamina and coaches |
| M2 | Play calling UI, X's and O's animation, one quick game | Rating bars on player cards. The engine names which player made each play (needed for the animation anyway). Standout plays. Per-player game stats in the box score |
| M3 | AI coordinators with personalities, win probability decisions, hints | Coaches change how a team calls plays: each coordinator's style shifts run/pass, aggression on fourth down, blitz rate and tempo |
| M4 | 32 teams, schedule, standings, playoffs, season sim, box scores | News feed (approved). Season player stats and leaders |
| M5 | Roster, depth chart, injuries, progression and aging | Stamina and in-game fatigue. RPG growth and decline (approved). Weekly training focus (approved) |
| M6 | Contracts, cap, free agency, trades | Trades of players and draft picks, including trades with three or more teams. Morale and re-signing (approved). Team money: ticket prices and revenue |
| M7 | Draft and scouting | Each prospect shows college stats and one set of combine results inside scouting, with no extra rounds of workouts or reports (Joseph: depth, not extreme depth). Trading picks during the draft |
| M8 | Coaching staff, job security, multi-season saves | Hire, fire, manage and trade coaches. Staff budgets. Stadium upgrades in the off-season. Records, retirements and Hall of Fame (approved) |
| M10 (new, after the franchise game) | | Built-in fantasy football. Sportsbook with odds and spreads, play money only |
| M9 (stretch) | Historical dream matchups | |

Reinstated by Joseph on 2026-11-11: ticket prices, revenue and off-season stadium upgrades. Still cut: relocation.

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
