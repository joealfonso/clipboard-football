"""Expected points by down, distance and field position (fitted, M1 step 5 post-validation
revision 11): the season-weighted mean of nflverse `ep` at the snap, 2016-2023 regular-season
scrimmage snaps, with backoff. The penalty accept-or-decline policy compares options with it."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

import polars as pl

from pipeline.game.decisions import check_holdout, labels_of, level_key

SNAPS = ("run", "pass", "qb_kneel", "qb_spike", "punt", "field_goal")
SCALE = 1000


def fit_ep(rows: pl.DataFrame, cfg: dict[str, Any], weights: dict[int, float]) -> dict[str, Any]:
    s = cfg["seasons"]
    e = cfg["expectedPoints"]
    f = rows.filter(pl.col("season").is_between(s["from"], s["to"]) & pl.col("play_type").is_in(list(SNAPS)) & pl.col("down").is_not_null()
                    & pl.col("ep").is_not_null() & ~pl.col("is_try") & (pl.col("ydstogo") >= 1))
    check_holdout(set(f["season"].unique().to_list()), s["neverTrainFrom"])
    agg = f.group_by("season", "down", "ydstogo", "yardline_100").agg(ep=pl.col("ep").sum(), n=pl.len())
    cells: list[dict[str, list[int]]] = []
    for lv in e["levels"]:
        acc: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
        for season, down, ytg, ydl, ep, n in agg.iter_rows():
            view = {"down": down, "distance": ytg, "yardLine100": ydl}
            k = level_key(lv, labels_of(view, cfg["dimensions"], [lv]))
            w = weights[season]
            a = acc[k]
            a[0] += w * ep
            a[1] += w * n
            a[2] += n
        cells.append({k: [int(round(SCALE * a[0] / a[1])), int(a[2])] for k, a in sorted(acc.items()) if a[2] >= e["minN"]})
    return {"generated": True, "seasons": list(range(s["from"], s["to"] + 1)), "scale": SCALE, "levels": e["levels"], "minN": e["minN"], "cells": cells}


def ep_of(view: dict[str, float], table: dict[str, Any], dims: dict[str, Any]) -> float:
    for i, lv in enumerate(table["levels"]):
        k = level_key(lv, labels_of(view, dims, [lv]))
        if k in table["cells"][i]:
            return table["cells"][i][k][0] / table["scale"]
    raise ValueError("no expected-points cell")
