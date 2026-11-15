# M2 addendum: team select and compare

Status: draft, revision 1, 2026-11-14. Owner: Joseph. Author: designer. Branch: m2/playable.

Amends docs/specs/m2-playable-game-design.md (called "the M2 design" below) where they conflict. Every conflict is listed in "Amendments". Where this file says nothing, the M2 design and docs/specs/m2-play-calling-and-motion.md stand.

Final means decided here, change only with a reason. Open means waiting on Joseph, the lead, art-director or a measurement in the build.

## Problem

Joseph: "have team select be a list of team i can scroll and compare with".

Today New game draws one random seed, and the seed's pairing decides both teams (`drawPairing` in packages/sim/src/loop/league.ts). The pregame screen shows that one matchup with unit bars and offers "New matchup", which rerolls blind. So the player can't choose who he coaches, can't see the other 30 teams, and can't tell why one team is better than another except by opening two rosters one at a time.

## User

No personas exist (docs/research/personas/ is missing). Same working assumption as the M2 design: Joseph and players like him, keyboard first, landscape laptop, know football.

Assumptions that carry decisions:

1. **He picks his team first, then shops for an opponent against it.** That is why the compare is "your team vs the highlighted one" and not a free compare of any two teams. Test: in the first playtest, ask whether he wanted to compare two teams before picking his own. If yes, add a pin-to-compare action to step 1 (it fits under the cap).
2. **The unit averages are close across the league.** Team strength is a shift of sd 1.2 rating points (data/game/league.json) on teams drawn from the same curve, so I expect the 32 offense averages to span only a few points. This is an estimate, not a measurement. It drives two choices: ranks sit beside every average, and the position-group detail (where real gaps live) is one key away. Test: the build computes the min, max and spread of each unit average for league seed 2026 and writes them in the PR. If a unit's range is under 3 points, switch the averages to one decimal (Open 3).

## What the data really has (and nothing else is shown)

Per team, from the worker: name (place and nickname), the pool (every player's id, name, position, jersey number, four base ratings and position skills, 0 to 99, after the team-strength shift and before home field), and pool order, which is the order the engine fills slots (`onField`, first n per position; there is no depth chart). From data: personnel.json slots per formation, package and kick unit; league.json home field (`ratingEdge`, `crowdNoise`). Every team uses the same play caller in M2 (`averageCoachFor`).

Not available, so never shown: win-loss records, any overall player rating, win probability or a favourite (M2 decision 14), coach differences, injuries, snap counts.

Derived numbers, each labelled with how it is made:

- **Unit average**: today's `unitAverage`, the mean of every base rating and position skill of every player in the unit (Offense: QB RB WR TE OL; Defense: DL LB CB S; Special teams: K and P), rounded. Labelled "Average of the players' ratings".
- **League rank of a unit average**: 1 to 32 by the unrounded mean, ties broken by team name. Shown as "4th of 32".
- **Position group average**: the mean of one rating over every player at that position on the team, with its league rank of 32.
- **Lines up in**: for the k-th player at a position in pool order, the number of formations (offense), packages (defense) or kick units (K, P) whose slots for that position are k or more. Example: the 4th WR "lines up in 1 of 5 formations" (Empty only).

## Decisions

1. **Two steps: "Pick your team", then "Pick an opponent", then Pregame.** Why: it matches assumption 1, and each step is one decision, so each screen stays well under the cap. Rejected: one screen with two lists side by side, which doubles the actionable list and splits focus. Final.
2. **The list is the comparison.** Every row shows the team's name and its three unit averages in fixed mono columns, so scrolling the list compares all 32 at a glance. Why: that is the literal ask, and it works with no side pane at 200% text. Rejected: a names-only list with stats only in a pane, which makes comparing a memory test. Final.
3. **Sort is one row that cycles: Name (A to Z), Offense, Defense, Special teams (highest first).** The highlight stays on the same team after a sort, not the same row index. Why: one choice instead of four; keeping the team stops a sort from losing your place. Rejected: clickable column headers as separate buttons (four choices, and mouse-first). Final.
4. **A compare pane beside the list.** Step 1 shows the highlighted team; step 2 shows your team and the highlighted team side by side. Headline only: three unit averages with rank and a `card.ratingBar`, the QB (accuracy, throw power), the K (kick accuracy, kick power). QB and K are chosen because each is the one player at his position on the field for every snap of his unit (personnel.json), so his ratings are the team's at that job. The higher number in each row is bold, and screen readers hear "higher"; equal reads "level". Colour never carries it. Rejected: a difference column ("+3"), which reads as a prediction of margin; bars stretched to the league's min and max, which would turn a 2-point gap into a full bar. Final.
5. **Detail is one key away: "Compare in detail".** A scrollable table, by unit (cycle with 1, like the roster), with your team and the opponent side by side. Each position gets a group line (each rating's group average with league rank of 32), then its players in pool order: order label ("1st WR"), number, name, "lines up in n of m", position skills, then the four base ratings. Enter opens that player's card (existing, with league ranks from `ratingRanks`). Why: headline first, real gaps (a position group) one key down, single players one more. Final.
6. **Your team stays in the step 2 list, marked "Your team", and can't be picked.** Pressing Enter on it repeats the reason in the status line. Why: same order and ranks as step 1, and off rows stay visible with a reason (M2 decision 9). Final.
7. **Home or away is a Pregame row, default "You're home".** Why: home field is real (`ratingEdge` 0.69 points for every home player, crowd noise changes pre-snap foul rates by 3.1%), so it belongs beside the matchup, with those values read from league.json and said in plain words. Default home keeps today's default. Cheap to change. Final.
8. **A chosen pairing becomes a seed, never a new save field.** The worker draws a random start seed and searches upward for the first seed whose `drawPairing` gives the chosen home and away teams (the same search Rematch already does). Why: the game stays "league seed plus seed", so the save, the "log the seed" rule and `pnpm sim:game -- --seed n` all reproduce the same game with no schema change. With 32 teams about 1 seed in 992 matches, so the search is short; it is capped at 1,000,000 seeds. Rejected: storing home and away team indices in the save and in `GameSetup` (a save schema change and a second way to define a game). Final, subject to the lead on Open 2.
9. **"Random matchup" stays, as a row on step 1.** It draws a seed and goes straight to Pregame with that seed's own pairing, which is today's behaviour. Why: players who don't care keep a fast path (3 keys from the title to the kickoff, one more than today). Final.
10. **No team colour in the list, pane or detail.** The Pregame matchup line keeps its swatch beside the name as today. Why: colours are placeholders waiting on Joseph, art-director already flagged a red and a green team in one game, and 32 swatches in a list would make that louder. Names and the "You" and "Them" column headers carry identity. When colours are approved, swatches may go beside list names under the existing rule. Final.
11. **Team strength is not shown as its own number.** Why: it is already inside every rating shown, and a separate "+2" invites the player to count it twice. Cheap to reverse. Final.
12. **Before kickoff the panel takes the full window; there is no field column.** Why: there is no play to show, and a side-by-side compare at 200% text doesn't fit in 560 px. Content stays at most 1,040 px wide (two 500 px columns plus a gap). Rejected: keeping the 560 px panel and stacking the teams, which loses side by side. Needs art-director (Open 1), because DESIGN.md's layout is written for the play screen.

## Screens

What the eye reads first is listed first, in the order it should be read.

| Screen | Reads first, and why | Choices (count) |
|---|---|---|
| Pick your team | Title "Pick your team", then "32 teams, sorted by [sort]", then the highlighted row, then the pane. The highlight is the thing being decided; the sort line tells you what the order means | The list (Up/Down, Enter picks), 1 Sort (note: current sort), 2 Random matchup, 3 Your roster of the highlighted team, Esc Back (5) |
| Pick an opponent | Title "Pick an opponent for the [Place Nickname]", then the highlighted row, then the pane's You vs Them columns, because the comparison is the reason for the screen | The list (Enter picks), 1 Sort, 2 Random opponent, 3 Compare in detail, 4 Their roster, Esc Back to step 1 (6) |
| Pregame (amended) | The matchup line "You: [Team] (home) vs [Team] (away)", then the headline compare, then one plain line on home field | 1 Start, 2 Home or away (note: "You're home"), 3 Compare in detail, 4 Your roster, 5 Their roster, Esc Back to step 2 (6) |
| Compare in detail | The two team names as column headers, then the unit shown, then the table | 1 Unit (note: current unit), the table (Enter opens the player card), Esc Back (3) |

The list counts as one choice (lead's rule: a scrollable table is one choice). Accelerators that don't count again: Home, End, Page Up, Page Down, and a letter key, which jumps to the next team whose place starts with that letter. No screen here uses T, D or S, so letters are free.

Rows layout at 100% text, 1280x720: list on the left (about 45% of content width, about 14 rows visible), pane on the right, menu rows under the pane. List row: place and nickname on one line, then Off, Def, ST in mono columns with a header row that stays put while the list scrolls.

At 150% text and above: the pane is hidden, the list takes the full content width, the place and nickname wrap onto two lines, and the numbers stay on one line. The compare is still there in the rows, and in full through "Compare in detail" (step 2) and Pregame. In Compare in detail at 150% and above, the two teams stack within each position group (yours, then theirs) instead of sitting side by side.

Flow: Title, 1 New game, Pick your team, Pick an opponent, Pregame, Coin toss (unchanged after that). Continue on the title skips team select. The step 1 highlight opens on the team you last coached (remembered in local settings), else the first row.

## Keyboard and mouse

Keyboard first: Up and Down move the highlight and the pane follows on the next frame; Enter picks; number keys pick menu rows from anywhere on the screen; Tab moves between the list and the menu rows; Esc goes back one step. Mouse: hover highlights a row and updates the pane, click picks it, the wheel scrolls the list, every menu row is a button.

## States

| State | What the player sees | Final or open |
|---|---|---|
| Loading teams | List area reads "Loading teams..." Random matchup stays on (it doesn't need the list). Sort and Your roster are off with "teams still loading" | Final |
| Worker or data error | The existing sim error or data-failed screens. No partial list | Final |
| League with fewer than two teams | Can't come from validated data; config validation rejects it, and the data-failed screen shows | Final |
| Your team highlighted in step 2 | Row reads "Your team" in `color.inkSoft`; Enter puts "That's your team. Pick an opponent." in the status line and does nothing else | Final |
| Setting up the game (seed search) | Nothing unless it takes over 300 ms, then "Working..." (existing rule) | Final |
| Seed search hits the cap | Stays on step 2. Status line: "Couldn't set up that game. Pick again or press 2 for a random opponent." Logged with the league seed, pair and start seed | Final |
| Storage blocked | Last team isn't remembered; the highlight opens on the first row. The existing storage line covers it | Final |
| Text at 150% and above | Pane hidden, two-line names, stacked detail (above) | Final |
| Window below 1024x600 | Existing "Make the window larger to play" | Final |
| Reduced motion | List scrolling jumps, never animates | Final |
| Sort changed | Order changes, the highlight keeps its team and is scrolled into view; announced | Final |
| Rematch (end screen) | Same pairing, same home and away, next seed (unchanged) | Final |
| Permission-denied | Not applicable: no accounts or permissions in the game | Final |

## Accessibility (baseline)

- The list is a listbox. Each option's accessible name carries the whole row: "Cobalt Bay Herons. Offense 66, 9th of 32. Defense 64, 20th. Special teams 71, 5th." In step 2 it adds yours: "Your offense 68." So a screen reader user compares by scrolling, the same as a sighted one. Pane changes are not announced on every arrow (the option name already says it).
- Sort changes go to the polite live region: "Sorted by defense, highest first."
- Higher and lower are bold weight plus "higher" or "level" in text for screen readers. No colour cue. Every screen passes the grayscale check.
- Text at 100, 125, 150 and 200%: nothing truncates at 1280x720; layouts as above.
- Focus ring: 2 px `color.ink` outline on the highlighted row and focused menu row (existing). Off rows use `color.inkSoft` plus a reason in words.
- Contrast from DESIGN.md token pairs only (ink and inkSoft on paper, paperShade for the highlighted row).

## Model output: uncertainty, wrong results, correction

- **Uncertainty.** The numbers here are summaries of ratings, not the engine's verdict on a team. Labels say how each is made, and nothing predicts a result. Close teams look close.
- **Wrong.** If a team that looks strong plays weak, the detail view and player cards show the real ratings behind the summary, and the seed reproduces the game for a report.
- **Correction.** Esc back to either list at any time before Start. After Start, Rematch or New opponent from the end screen.

## Needs from the worker (no change to the save, team data or shared types)

1. A league message: ask with the league seed, get every team's `TeamSummary` (all 32, in league index order).
2. A pairing message: ask with the league seed, home index and away index, get a `Matchup` from the seed search (decision 8), or a "not found" reply.
3. personnel.json slots in `UiData` (for "lines up in") and league.json `homeField` values (for the Pregame line). Additive.
4. The pure view model (unit averages, ranks, group averages, lines-up-in, higher or level) lives in a UI module with no DOM, so tests can check every number.

These are app-internal messages in packages/app/src/engine/protocol.ts. Whether that counts as an ask-first schema change is Open 2.

## Amendments to the M2 design

| Where | Was | Now |
|---|---|---|
| Screen flow | Title, Pregame | Title, Pick your team, Pick an opponent, Pregame |
| Pregame row | 2 Coach the other team, 3 New matchup | 2 Home or away, 3 Compare in detail. Picking replaces "coach the other team"; Esc back to the lists replaces "New matchup" |
| End of game row | 3 New matchup | 3 New opponent: opens Pick an opponent with your team kept; Esc from there goes to Pick your team |
| Layout | Field column and panel on every screen | Before kickoff, full-width panel, content at most 1,040 px (decision 12) |
| Team swatch | Used in the pregame matchup | Still in the Pregame matchup line only; not in the list, pane or detail |

## Acceptance criteria

| # | Criterion | How it fails |
|---|---|---|
| TS1 | Every team in the league appears in the list exactly once (32 for league seed 2026), sorted by name by default. | A missing or repeated team. |
| TS2 | Each sort orders the rows correctly (name A to Z; unit averages highest first, ties by name) and the highlight keeps its team. | Wrong order or a lost highlight. |
| TS3 | Picking team A then team B and pressing Start gives a game whose `Matchup` has A as yours and B as theirs, at the home or away chosen. | Any other team or side. |
| TS4 | The started game's seed, run through `matchupOf` (and `pnpm sim:game -- --seed n --league-seed 2026`), gives the same home and away teams. | A seed that doesn't reproduce the pairing. |
| TS5 | A game from a picked pairing saves and resumes with the same teams; the save schema version is unchanged. | Different teams after resume, or a bumped schema. |
| TS6 | Every number in the list, pane, Pregame and detail equals a recomputation from the pools, personnel.json or league.json. No other number appears. | An invented or mismatched number. |
| TS7 | Your team in step 2 can't be picked and shows its reason. | It can be picked, or fails silently. |
| TS8 | Random matchup gives exactly the drawn seed's own pairing (today's behaviour). | A different pairing. |
| TS9 | No screen here shows more than 7 choices; each has unique keys. | 8 or more. |
| TS10 | Keyboard alone and mouse alone each get from the title to the coin toss through a picked matchup. | Either device needed. |
| TS11 | Option names carry the row in words (and yours in step 2); sort changes are announced; the automated WCAG 2.2 AA check passes on all four screens; at 200% text at 1280x720 nothing truncates. | A failure. |
| TS12 | No team colour in the list, pane or detail (extends H3). | A swatch or team colour there. |
| TS13 | Joseph picks a matchup in the playtest and says whether the list and compare helped him choose. Notes in the playtest log, with assumption 1's question asked. | Not run. |

## Tests to add or change

None is weakened.

| Test | What it checks | Criterion |
|---|---|---|
| layout.test.ts, screen cap | Adds the step 1, step 2 and Compare in detail screen models to the every-screen list (at most 7, unique keys). The pregame row test changes to the new rows (still 6) because the rows moved, not the rule. | TS9 |
| New `teamselect.test.ts` | List holds the league's teams once each; each sort's order; highlight kept across sorts; your team off in step 2 with its reason. | TS1, TS2, TS7 |
| New `compare.test.ts` (view model) | Unit averages, ranks 1 to 32 with no repeats, group averages, lines-up-in against personnel.json, higher or level, the home field line against league.json. Every number in the model traces to a source. | TS6 |
| session.test.ts | Pairing message: for all 992 ordered pairs in league 2026, the returned seed's `drawPairing` and `matchupOf` give that pair. With a tiny injected cap, the "not found" reply. Same start seed, same result. Random matchup equals the seed's own pairing. | TS3, TS4, TS8 |
| session.test.ts, resume | Start from a picked pairing, save, resume: same teams, same rest of game for the same inputs, schema version unchanged. | TS5 |
| messages.test.ts | The two new messages validate; malformed ones (indices out of range, home equals away, non-integer seed) are rejected. | Needs 1, 2 |
| art.test.ts or a view test | No team colour token in the list, pane or detail output. | TS12 |
| Scripted UI playthrough (F1) | Keyboard-only and mouse-only paths through both steps to the coin toss. | TS10 |
| Accessibility check (X3) | All four screens, plus option names and the sort announcement. | TS11 |

## Art slots for docs/ASSETS.md ("Planned slots")

New:

| slot | added because |
|---|---|
| `select.teamRow` | A team row in the list: name, three unit averages in mono columns |
| `select.teamRow.selected` | Highlighted row: `color.paperShade` fill plus the 2 px ink focus outline |
| `select.teamRow.unavailable` | Your team in step 2: `color.inkSoft` text plus "Your team" in words |
| `select.columnHeader` | The sticky Off, Def, ST header and the "sorted by" line |
| `compare.panel` | The pane and the detail table: You and Them columns on paper |
| `compare.higher` | The higher number's cue: bold weight only, no colour |

Reused, no change: `card.ratingBar` (unit bars in the pane), `card.panel` (player card from detail), `hud.playMenu`, `hud.playMenu.selected`, `hud.playMenu.disabled` (menu rows), `hud.teamSwatch` (Pregame matchup line only).

## Open

1. **Full-width panel before kickoff** (decision 12): art-director, against DESIGN.md's layout.
2. **Are the two new worker messages an ask-first schema change?** They are app-internal and change no save, team data or shared type. Lead's call.
3. **One decimal on unit averages**, if the build's measured spread of a unit across the 32 teams is under 3 points (assumption 2). Lead or Joseph, after the number is in the PR.

Everything else in this file is final.

## Resolved (lead, 2026-11-14)

1. The full-window pregame panel goes to art-director at the review of this build.
2. The two new worker messages are app-internal. They change no save, team data or shared type, so they aren't an ask-first schema change.
3. The build measures the spread of the 32 unit averages for league seed 2026, logs it in DECISIONS, and switches to one decimal for any unit whose range is under 3 points, as written.
4. The order is your team first, then the opponent, as designed. The playtest asks Joseph whether he wants pin-to-compare.
