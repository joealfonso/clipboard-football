"""Step 5b milestone E (report only): real 2016-2023 side of the late-game investigations.

Writes data/game/investigations.real.json; scripts/game/investigate.ts computes the same
measures on the sim's in-sample games and scripts/game/report.ts renders both in GAME_REPORT.md.
Changes no table, config or sim code (E3). Regular season, regulation snaps only; every
measure is a designed proxy computed the same way on both sides:

- E1 safeties per game by cause (sack; run, which includes scrambles and kneels; other) and by
  snap spot (own 1-5, own 6-10, elsewhere); snaps from the own 1-5 per game, and their call mix
  on downs 1-3 (the oTop targets).
- E2 dropback share (pass, sack or scramble) and incompletion share (incomplete passes and
  spikes) per run or pass snap, by score3 x time5 from the offense's view; and, for the last
  5:00 of Q4 (G5, GF), the share of snaps that end by incompletion, out of bounds, a timeout
  before the next snap, or other (score, change of possession, or a penalty), in that order.

    uv run --project pipeline python -m pipeline.game.investigate
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from typing import Any

import polars as pl

from pipeline.caller.load import Source, spec
from pipeline.caller.config import REPO

SEASONS = list(range(2016, 2024))
COLS = ["game_id", "play_id", "season", "season_type", "qtr", "down", "yardline_100", "posteam", "play_type", "pass", "qb_scramble",
        "sack", "safety", "incomplete_pass", "out_of_bounds", "timeout", "timeout_team", "touchdown", "interception", "fumble_lost",
        "penalty", "qb_kneel", "qb_spike", "score_differential", "game_seconds_remaining", "half_seconds_remaining"]


def score3(d: float) -> str:
    return "T" if d < 0 else "0" if d == 0 else "L"


def time5(q: int, half: float, game: float) -> str:
    if q <= 2:
        return "H1F" if q == 2 and half <= 120 else "H1"
    return "GF" if game <= 120 else "G5" if game <= 300 else "H2"


def spot_group(yl: float) -> str:
    return "own1-5" if yl >= 95 else "own6-10" if yl >= 90 else "other"


def flag(r: dict[str, Any], c: str) -> bool:
    v = r.get(c)
    return v is not None and float(v) == 1.0


def call_of(r: dict[str, Any]) -> str | None:
    pt = r["play_type"]
    if flag(r, "qb_kneel") or pt == "qb_kneel":
        return "kneel"
    if flag(r, "qb_spike") or pt == "qb_spike":
        return "spike"
    if pt == "pass" or flag(r, "qb_scramble"):
        return "pass"
    return {"run": "run", "punt": "punt", "field_goal": "fieldGoal"}.get(pt)


def measure(rows: pl.DataFrame) -> dict[str, Any]:
    count: dict[str, float] = defaultdict(float)
    games = rows["game_id"].n_unique()
    by_game: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows.select(COLS).iter_rows(named=True):
        by_game[r["game_id"]].append(r)
    for gid in sorted(by_game):
        plays = by_game[gid]
        for i, r in enumerate(plays):
            q = int(r["qtr"] or 0)
            call = call_of(r)
            if q > 4 or call is None or r["down"] is None or r["posteam"] is None:
                continue
            yl = float(r["yardline_100"])
            if flag(r, "safety"):
                cause = "sack" if flag(r, "sack") else "run" if call in ("run", "kneel") or flag(r, "qb_scramble") else "other"
                count[f"safety.cause.{cause}"] += 1
                count[f"safety.spot.{spot_group(yl)}"] += 1
            if yl >= 95:
                count["own1-5.snaps"] += 1
                if int(r["down"]) <= 3:
                    count["own1-5.calls"] += 1
                    count[f"own1-5.call.{call}"] += 1
            if call not in ("run", "pass", "spike"):
                continue
            s3 = score3(float(r["score_differential"] or 0))
            t5 = time5(q, float(r["half_seconds_remaining"]), float(r["game_seconds_remaining"]))
            cell = f"{s3}.{t5}"
            count[f"snaps.{cell}"] += 1
            if call == "pass" and not flag(r, "qb_spike"):
                count[f"dropback.{cell}"] += 1
            incomplete = flag(r, "incomplete_pass") or call == "spike"
            if incomplete:
                count[f"incompletion.{cell}"] += 1
            if t5 in ("G5", "GF"):
                timeout_after = False
                for p in plays[i + 1:]:
                    if flag(p, "timeout"):
                        timeout_after = True
                        break
                    if call_of(p) is not None or p["play_type"] in ("kickoff", "extra_point"):
                        break
                if incomplete:
                    why = "incompletion"
                elif flag(r, "out_of_bounds"):
                    why = "outOfBounds"
                elif timeout_after:
                    why = "timeout"
                elif flag(r, "touchdown") or flag(r, "interception") or flag(r, "fumble_lost") or flag(r, "penalty") or flag(r, "safety"):
                    why = "other"
                else:
                    why = "none"
                count[f"stop.{s3}.{t5}.{why}"] += 1
                count[f"stop.{s3}.{t5}.snaps"] += 1
    return {"games": games, "counts": dict(sorted(count.items()))}


def build(source: Source) -> dict[str, Any]:
    frames = []
    for s in SEASONS:
        pbp = source.load_season(spec("pbp"), s)
        df = pbp.select([pl.col(c) if c in pbp.columns else pl.lit(None).alias(c) for c in COLS])
        frames.append(df.filter(pl.col("season_type") == "REG").sort(["game_id", "play_id"]))
    rows = pl.concat(frames, how="vertical_relaxed")
    return {"generated": True, "seasons": SEASONS, **measure(rows)}


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
    (REPO / "data/game/investigations.real.json").write_text(json.dumps(out, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote data/game/investigations.real.json ({out['games']} games)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
