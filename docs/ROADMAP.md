# Roadmap

Status: proposal, waiting for Joseph's sign-off. Drafted 2026-11-11.

The milestones M1 to M9 come from the original brief. This file places everything Joseph asked for since then. Each feature goes in the earliest milestone that already builds what it depends on, so nothing gets built ahead.

Rules that still apply to every new feature:
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
| M4b (new) | | Built-in fantasy football (see below) |
| M5 | Roster, depth chart, injuries, progression and aging | Stamina and in-game fatigue. RPG growth and decline (approved). Weekly training focus (approved) |
| M6 | Contracts, cap, free agency, trades | Trade players. Morale and re-signing (approved). Team money (see open question 2) |
| M7 | Draft and scouting | Combine and pro day results inside scouting (approved) |
| M8 | Coaching staff, job security, multi-season saves | Hire, fire, manage and trade coaches. Coach salaries paid from the team budget. Records, retirements and Hall of Fame (approved) |
| M9 (stretch) | Historical dream matchups | |

Cut earlier and still cut: stadium upgrades, ticket prices, relocation.

## The new features in a line or two each

- **Standout plays (M2).** Elite players, around 90 and up, get a higher chance of a standout play, like a long run, a one-handed catch or a strip sack. Average players are unchanged, so league totals hold. The why line names it. It needs the engine to know which player made the play, which M2 adds.
- **Coaches change play calling (M3).** Each coordinator is a designed style layered on the fitted average coach. An aggressive coach goes for it more on fourth down, and a pass-first coach throws more. Step 5 already gives each team its own play caller, so a coach slots in without rewriting the game.
- **Fantasy football (M4b).** It needs a season and per-player stats, which arrive in M4. Proposal: your own fantasy league against AI managers, drawn from the sim's players. One draft screen, then one weekly lineup screen with at most five decisions, plus waivers and trades between fantasy managers. Scoring is configurable in data.
- **Stamina (M5).** A 0-99 rating for every player. Players tire over long drives and late in games, and recover some between drives and at halftime. Tired players play a little below their ratings. It lands with the depth chart, because fatigue only matters once you can rotate players.
- **Hire, fire, manage and trade coaches (M8).** Coaches have ratings, a style, a contract and job security. You can hire, fire, extend or trade them. Coach trades follow how NFL teams trade for coaches under contract, looked up and cited when built, not written from memory.

## Open questions for Joseph

1. Fantasy football placement: M4b right after the league exists (my pick), or after M8 once the franchise game is done?
2. Team money: should franchises have revenue and a budget beyond the salary cap, for example a staff budget the owner sets? If yes, where does the money come from, given ticket prices and stadiums are cut? My pick: a simple designed owner budget for staff, with no revenue screen.
3. Stamina in M5 with the depth chart (my pick), or a simple version earlier in M2 so you feel it in the first playable game?
4. Standout plays: player-specific moments only (my pick), or also team "momentum" swings? Momentum would need its own calibration.
