# Clipboard Football

A single-player American football coach and GM game for the browser (working title). You call plays from menus and X's and O's animate the result. It's inspired by NFL Challenge (XOR, 1985).

I'm building it in milestones. The engine underneath is fitted to real NFL play-by-play data from nflverse, so a called play turns out the way it tends to in real games, with the variance left in.

## Status

- M1 is built: a data pipeline and a headless engine that sims a full game as text, play by play, with a one-line "why" after each play and a box score. The 10,000-game calibration runs, and its results are in docs/GAME_REPORT.md.
- M2, the playable browser UI, is not built yet. There is nothing to play in a browser today.

## Run

You need Node 22 or later and pnpm. From the repo root:

```sh
pnpm install
pnpm sim:game -- --seed 1
```

That prints one full game play by play with the engine's why line and a team box score. `--league-seed <n>` picks the generated league (default 2026) and `--format json` prints the game record. The seed and league seed are on the first lines, so any game can be replayed.

The data pipelines rebuild every shipped data file from nflverse. They need Python 3.12 and uv:

```sh
uv run --project pipeline python -m pipeline.inventory
uv run --project pipeline python -m pipeline.caller
uv run --project pipeline python -m pipeline.engine
uv run --project pipeline python -m pipeline.game
```

Raw downloads are cached in `~/.cache/clipboard-football`, or in the directory named by `CLIPBOARD_FOOTBALL_CACHE`. The team-name check reads a hand-kept list of real NFL names (`pipeline/game/real_names.py`) that is local only and not in this repo; the check is skipped when the file is absent.

Calibration:

```sh
node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --target insample
node --import ./scripts/engine/register.mjs scripts/game/calibrate.ts --target holdout
```

Without a global pnpm, use `npx -y pnpm@10.34.9` in place of `pnpm`.

## Test

```sh
pnpm install && pnpm test && pnpm lint && pnpm typecheck
uv run --project pipeline pytest pipeline
```

`pnpm test:heavy` runs the heavy simulation checks (home field and a calibration slice).

## Docs

- docs/DECISIONS.md: every design decision, with the date and the reason.
- docs/MODEL.md: what is fitted from data, what is designed, and what is mixed.
- docs/DATA.md: the nflverse tables, their coverage and their licenses.
- docs/RULES.md: the NFL rules the engine follows, with sources.
- DESIGN.md: the visual direction for the UI.

## Data and licensing

The code is under the MIT license (LICENSE). The data files under `data/` that are built from nflverse keep the license and credit of their source: play-by-play is CC-BY 4.0, participation and FTN charting are CC-BY-SA 4.0 (credit "FTN Data via nflverse" and "NFL NextGenStats via nflverse"), and the combine percentiles are credited "courtesy of PFR via nflverse". Designed files hold no nflverse data and are under MIT with the code. DATA_LICENSE.md lists every file with its source, license and credit.

No real player names, ids or rosters ship in this repo. Teams and players in the game are fictional.

This project is not affiliated with, endorsed by or sponsored by the NFL, any NFL team, nflverse, FTN or Pro Football Reference.
