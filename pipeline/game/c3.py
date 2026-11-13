"""Step 5b C3 (in-sample only): real timeouts per team-game in the last 5:00 of Q4, by side x
score3 (the calling team's view) x window (G5, GF), 2016-2023, season-weighted like the fits.

Reads only the training seasons and writes data/game/c3.real.json, which docs/COACH_REPORT.md
renders next to the sim loop's rows (`diag.timeoutsPerTeamGame` in data/game/calibration.insample.json).
Counted from the same dead-ball reading as the timeout fit (pipeline/game/decisions.py): a timeout
in the dead ball before a Q4 scrimmage snap with 5:00 or less left.

    uv run --project pipeline python -m pipeline.game.c3
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from typing import Any

from pipeline.caller.config import REPO
from pipeline.game import decisions as dec
from pipeline.game.build import GAME_DIR, read_json, weights_for
from pipeline.game.load import Source, load_rows


def measure(db: Any, team_games: dict[int, int], weights: dict[int, float]) -> dict[str, Any]:
    num: dict[str, float] = defaultdict(float)
    n: dict[str, int] = defaultdict(int)
    for x in db.snaps:
        if x["season"] not in weights or x["base"]["quarter"] != 4 or x["base"]["secondsLeftInGame"] > 300:
            continue
        win = "GF" if x["base"]["secondsLeftInGame"] <= 120 else "G5"
        for side in ("offense", "defense"):
            diff = x["scoreDiff"] if side == "offense" else -x["scoreDiff"]
            s3 = "T" if diff < 0 else "0" if diff == 0 else "L"
            if x[f"{side}Timeout"]:
                k = f"{side}.{s3}.{win}"
                num[k] += weights[x["season"]]
                n[k] += 1
    denom = sum(weights[s] * team_games[s] for s in weights)
    keys = [f"{side}.{s3}.{win}" for side in ("offense", "defense") for s3 in ("T", "0", "L") for win in ("G5", "GF")]
    return {k: {"perTeamGame": num[k] / denom, "timeouts": n[k]} for k in keys}


def build(source: Source) -> dict[str, Any]:
    cfg = read_json(REPO, GAME_DIR / "config.json")
    s = cfg["seasons"]
    train = list(range(s["from"], s["to"] + 1))
    rows = load_rows(source, train)
    team_games = {season: 2 * rows.filter(rows["season"] == season)["game_id"].n_unique() for season in train}
    db = dec.dead_balls(rows, cfg["tempo"]["maxSeconds"])
    weights = weights_for(train, s["weightAnchor"], s["halfLifeSeasons"])
    return {"generated": True, "seasons": train, "weighted": True, "teamGames": sum(team_games.values()), "rows": measure(db, team_games, weights)}


def main() -> int:
    from pipeline import cache
    from pipeline.sources import NflreadpySource

    path = cache.cache_dir()
    try:
        cache.prepare(path)
    except cache.CacheNotWritable as e:
        print(str(e), file=sys.stderr)
        return 2
    out = build(NflreadpySource(path))
    (REPO / GAME_DIR / "c3.real.json").write_text(json.dumps(out, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote data/game/c3.real.json ({out['teamGames']} team-games)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
