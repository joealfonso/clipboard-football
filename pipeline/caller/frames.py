"""Situations, bin labels and the training frame for each factor."""

from __future__ import annotations

from typing import Any

import polars as pl

from pipeline.caller.bins import bin_situation
from pipeline.caller.fit import any_seasons, in_seasons, label_col

# Bin label columns are prefixed (fit.label_col) so they never collide with pbp columns.
# pbp column -> Situation field.
SITUATION_COLUMNS = {
    "phase": "phase",
    "down": "down",
    "ydstogo": "yardsToGo",
    "yardline_100": "yardLine100",
    "score_differential": "scoreDiff",
    "qtr": "quarter",
    "half_seconds_remaining": "secondsLeftInHalf",
    "game_seconds_remaining": "secondsLeftInGame",
    "offense_timeouts": "offenseTimeouts",
    "defense_timeouts": "defenseTimeouts",
}


def situation_of(row: dict[str, Any]) -> dict[str, Any]:
    sit: dict[str, Any] = {}
    for col, name in SITUATION_COLUMNS.items():
        v = row[col]
        sit[name] = v if (v is None or isinstance(v, str)) else (int(v) if float(v).is_integer() else v)
    return sit


def add_labels(plays: pl.DataFrame, dims: dict[str, Any]) -> pl.DataFrame:
    """Adds one string column per configured dimension (null where it does not apply)."""
    cols = list(SITUATION_COLUMNS)
    uniq = plays.select(cols).unique(maintain_order=True)
    out: dict[str, list[str | None]] = {d: [] for d in dims}
    for row in uniq.iter_rows(named=True):
        labels = bin_situation(situation_of(row), dims)
        for d in dims:
            out[d].append(labels[d])
    labelled = uniq.with_columns([pl.Series(label_col(d), out[d], dtype=pl.String) for d in dims])
    return plays.join(labelled, on=cols, how="left", nulls_equal=True)


def add_try_call(plays: pl.DataFrame) -> pl.DataFrame:
    return plays.with_columns(
        try_call=pl.when(pl.col("phase") != "try")
        .then(None)
        .when(pl.col("two_point_attempt") == 1)
        .then(pl.lit("goForTwo"))
        .when(pl.col("extra_point_attempt") == 1)
        .then(pl.lit("extraPoint"))
        .otherwise(None)
    )


def factor_frames(plays: pl.DataFrame, config: dict[str, Any]) -> dict[str, pl.DataFrame]:
    """One training frame per factor: season, target, tag, and every label column.
    Season ranges come from each factor's config; holdout seasons never pass."""
    f = config["factors"]
    gl = config["tags"]["gl"]
    scrim = pl.col("phase") == "scrimmage"
    two = (pl.col("phase") == "try") & (pl.col("try_call") == "goForTwo")
    at_gl = scrim & (pl.col(label_col(gl["dimension"])) == gl["label"])
    runpass = pl.col("call").is_in(["run", "pass"])

    def make(fid: str, cond: pl.Expr, target: pl.Expr, tag: pl.Expr | None = None) -> pl.DataFrame:
        df = plays.filter(cond.fill_null(False) & any_seasons(f[fid]).fill_null(False))
        df = df.with_columns(target=target, tag=tag if tag is not None else pl.lit(None, dtype=pl.String))
        return df.filter(pl.col("target").is_not_null())

    def tagged(fid: str, try_cond: pl.Expr, gl_cond: pl.Expr, target: pl.Expr) -> pl.DataFrame:
        tag = pl.when(two).then(pl.lit("try")).otherwise(pl.lit("gl"))
        return make(fid, (two & try_cond) | (at_gl & gl_cond), target, tag)

    return {
        "oTop": make("oTop", scrim, pl.col("call")),
        "o4Top": make(
            "o4Top", scrim, pl.when(pl.col("call").is_in(["punt", "fieldGoal"])).then(pl.lit("kick")).otherwise(pl.col("call"))
        ),
        "o4Kick": make("o4Kick", scrim & pl.col("call").is_in(["punt", "fieldGoal"]), pl.col("call")),
        "oRun": make("oRun", scrim, pl.col("run_type")),
        "oPassType": make("oPassType", scrim, pl.col("pass_type")),
        "oDepth": make("oDepth", scrim, pl.col("depth")),
        "oFormation": make("oFormation", scrim & pl.col("leaf").is_not_null(), pl.col("formation")),
        "oTry": make("oTry", pl.col("phase") == "try", pl.col("try_call")),
        "tpTop": make("tpTop", two & runpass, pl.col("call"), pl.lit("try")),
        "tpRun": tagged("tpRun", pl.lit(True), pl.lit(True), pl.col("run_type")),
        "tpPassType": tagged("tpPassType", pl.lit(True), pl.lit(True), pl.col("pass_type")),
        "tpDepth": tagged("tpDepth", pl.lit(True), pl.lit(True), pl.col("depth")),
        "dFront": make("dFront", scrim & runpass, pl.col("front")),
        "dCoverage": make("dCoverage", scrim & runpass & pl.col("front").is_not_null(), pl.col("coverage")),
        "dTry": tagged("dTry", runpass, runpass, pl.col("preset")),
    }
