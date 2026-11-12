"""Play duration: seconds of game clock from the snap to the end of the play.

nflverse pbp has no duration column, but from 2022 on `time_of_day` (the snap) and
`end_clock_time` (the end of the play) are both wall-clock timestamps; their difference is
the play's length. During a live ball the game clock runs (Rule 4-3), so that is the clock
the play used. The check in the report compares it with the game clock change on
incompletions, where the clock stops at the end of the play and starts on the next snap.

Fitted: a histogram of whole seconds per (group, class), 2022-2023. Earlier seasons have no
timestamps, so a pooled run from 2016-2021 takes its seconds from the histogram of its class.
"""

from __future__ import annotations

from typing import Any

import polars as pl

from pipeline.engine.fit import histogram


def measured(frame: pl.DataFrame, cfg: dict[str, Any]) -> pl.DataFrame:
    d = cfg["durations"]
    return frame.filter(
        (pl.col("season") >= cfg["seasons"]["durationFrom"])
        & pl.col("duration").is_not_null()
        & (pl.col("duration") > 0)
        & (pl.col("duration") <= d["maxSeconds"])
    ).with_columns(sec=pl.col("duration").round(0).cast(pl.Int64))


def fit_group(frame: pl.DataFrame, cfg: dict[str, Any], classes: list[str]) -> dict[str, list[int]]:
    """class -> weights for seconds minSeconds..maxSeconds. A class with no measured play takes
    the whole group's histogram."""
    d = cfg["durations"]
    lo, hi = d["minSeconds"], d["maxSeconds"]
    m = measured(frame, cfg)
    out: dict[str, list[int]] = {}
    if m.height == 0:
        return out
    weights = (m["w"] * m["frac"]).to_list() if "frac" in m.columns else m["w"].to_list()
    whole = histogram(m["sec"].to_list(), weights, lo, hi)
    for c in classes:
        sub = m.filter(pl.col("cls") == c)
        if sub.height == 0:
            out[c] = whole
            continue
        w = (sub["w"] * sub["frac"]).to_list() if "frac" in sub.columns else sub["w"].to_list()
        out[c] = histogram(sub["sec"].to_list(), w, lo, hi)
    out["*"] = whole
    return out


def subsample_report(frame: pl.DataFrame, cfg: dict[str, Any], group: str) -> dict[str, Any]:
    """B6: size of the measured subsample and how its class mix differs from every pooled play
    of the same group in the duration seasons."""
    window = frame.filter(pl.col("season") >= cfg["seasons"]["durationFrom"])
    m = measured(window, cfg)
    def mix(f: pl.DataFrame) -> dict[str, float]:
        if f.height == 0:
            return {}
        g = f.group_by("cls").len()
        return {c: n / f.height for c, n in g.iter_rows()}
    return {
        "group": group,
        "all": window.height,
        "measured": m.height,
        "mixAll": mix(window),
        "mixMeasured": mix(m),
        "meanSeconds": float(m["sec"].mean()) if m.height else None,
    }
