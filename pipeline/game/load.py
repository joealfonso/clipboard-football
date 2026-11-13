"""Loads the regular-season pbp rows the step 5 game pipeline reads: every row of every game,
in play order, with the columns the coach decisions, the game aggregates and the home-field
measurements need. Team abbreviations are used only to tell sides apart and never leave the
pipeline; descriptions are parsed here (fouls, timeouts, onside kicks) and dropped.
"""

from __future__ import annotations

from typing import Any

import polars as pl

from pipeline.caller.load import Source, spec
from pipeline.engine.load import FOUL_RX, duration_expr, fouls_of

COLS = [
    "game_id", "play_id", "season", "season_type", "week", "qtr", "down", "ydstogo", "yardline_100",
    "game_seconds_remaining", "half_seconds_remaining", "posteam", "defteam", "home_team", "away_team",
    "location", "play_type", "desc", "timeout", "timeout_team", "incomplete_pass", "out_of_bounds", "penalty",
    "touchdown", "interception", "fumble_lost", "fumbled_1_team", "sack", "qb_kneel", "qb_spike", "punt_attempt",
    "field_goal_attempt", "extra_point_attempt", "two_point_attempt", "kickoff_attempt", "safety",
    "score_differential", "posteam_timeouts_remaining", "defteam_timeouts_remaining", "time_of_day",
    "end_clock_time", "home_score", "away_score", "result", "fixed_drive", "fixed_drive_result",
    "drive_time_of_possession", "kick_distance", "posteam_score_post", "defteam_score_post", "ep",
]

SNAP_TYPES = ("run", "pass", "punt", "field_goal", "qb_kneel", "qb_spike")


def _flag(c: str) -> pl.Expr:
    return pl.col(c).cast(pl.Float64).fill_null(0) == 1


def season_rows(pbp: pl.DataFrame) -> pl.DataFrame:
    """Regular-season rows in play order with derived flags."""
    df = pbp.select([pl.col(c) if c in pbp.columns else pl.lit(None).alias(c) for c in COLS])
    df = df.filter(pl.col("season_type") == "REG").sort(["game_id", "play_id"])
    desc = pl.col("desc").cast(pl.String).fill_null("")
    return df.with_columns(
        duration=duration_expr(),
        is_timeout=_flag("timeout") & pl.col("timeout_team").is_not_null(),
        challenge=desc.str.contains(r"(?i)challenge|replay"),
        two_min=desc.str.contains(r"(?i)two-minute warning"),
        onside=(pl.col("play_type") == "kickoff") & desc.str.contains(r"(?i)\bonside\b"),
        fouls=desc.str.extract_all(FOUL_RX),
        is_try=_flag("two_point_attempt") | _flag("extra_point_attempt") | (pl.col("play_type") == "extra_point"),
    ).drop("desc")


def load_rows(source: Source, seasons: list[int], log: Any = None) -> pl.DataFrame:
    frames = []
    for s in seasons:
        if log:
            log(f"loading {s}")
        frames.append(season_rows(source.load_season(spec("pbp"), s)))
    return pl.concat(frames, how="vertical_relaxed")


def foul_rows(rows: pl.DataFrame) -> pl.DataFrame:
    """One row per foul named in a play's description: game, season, the fouling side relative
    to the row's posteam, the pbp type, its status and enforced yards, the row's play type."""
    out: list[dict[str, Any]] = []
    for r in rows.select("season", "game_id", "play_id", "posteam", "defteam", "play_type", "fouls").iter_rows(named=True):
        for ptype, side, status, yards in fouls_of(r["fouls"] or [], r["posteam"], r["defteam"]):
            out.append({"season": r["season"], "game_id": r["game_id"], "play_id": r["play_id"], "play_type": r["play_type"],
                        "ptype": ptype, "side": side, "status": status, "yards": yards,
                        "team": r["posteam"] if side == "offense" else r["defteam"] if side == "defense" else None})
    schema = {"season": pl.Int64, "game_id": pl.String, "play_id": pl.Float64, "play_type": pl.String, "ptype": pl.String,
              "side": pl.String, "status": pl.String, "yards": pl.Int64, "team": pl.String}
    return pl.DataFrame(out, schema=schema)
