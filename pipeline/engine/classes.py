"""Play families, outcome classes and the outcome tuple every pooled play is stored as.

Designed rules (data/engine/config.json "classRules"): every pooled play lands in exactly one
class of its family. The tuple keeps what the engine needs to rebuild the real play at a new
spot: yards, flags, the turnover spot offset and the return yards.
"""

from __future__ import annotations

from typing import Any

import polars as pl

from pipeline.caller.frames import situation_of
from pipeline.caller.shares import Caller

# Outcome tuple flags (packages/sim/src/engine/pools.ts reads the same bits).
OB = 1  # runner (or receiver) went out of bounds
TD = 2  # the offense scored on the play
INT = 4  # intercepted
FUM_LOST = 8  # fumble recovered by the defense
DEF_TD = 16  # the defense scored on the return
FUM_OOB = 32  # a fumble went out of bounds
REGAINED = 64  # the defense had the ball during the down, the offense got it back

DEPTH_LEAVES = ("shortPass", "intermediatePass", "deepPass")


def _f(c: str) -> pl.Expr:
    return pl.col(c).cast(pl.Float64).fill_null(0) == 1


def family_expr(cfg: dict[str, Any]) -> pl.Expr:
    fam = cfg["families"]
    return (
        pl.when((pl.col("call") == "run") & pl.col("leaf").is_in(fam["run"]["leaves"]))
        .then(pl.lit("run"))
        .when(pl.col("call") == "pass")
        .then(pl.lit("pass"))
        .otherwise(None)
    )


def yards_expr() -> pl.Expr:
    """Yards for the class and the tuple. On a two-point try nflverse records 2 for a success
    and 0 otherwise, so a success is the distance to the goal line."""
    y = pl.col("yards_gained").fill_null(0)
    two = pl.col("two_point_conv_result")
    return (
        pl.when(pl.col("phase") == "try")
        .then(pl.when(two == "success").then(pl.col("yardline_100")).otherwise(pl.min_horizontal(y, pl.col("yardline_100") - 1)))
        .otherwise(y)
        .cast(pl.Int64)
    )


def run_class() -> pl.Expr:
    y = pl.col("y")
    return (
        pl.when(_f("fumble")).then(pl.lit("fumble"))
        .when(y <= 0).then(pl.lit("loss"))
        .when(y <= 3).then(pl.lit("r1_3"))
        .when(y <= 9).then(pl.lit("r4_9"))
        .when(y <= 19).then(pl.lit("r10_19"))
        .otherwise(pl.lit("r20"))
    )


def pass_class() -> pl.Expr:
    y = pl.col("y")
    try_ = pl.col("phase") == "try"
    sack = _f("sack") | (try_ & pl.col("desc_sacked").fill_null(False))
    inter = _f("interception") | (try_ & pl.col("desc_intercepted").fill_null(False))
    inc = _f("incomplete_pass") | (try_ & pl.col("desc_incomplete").fill_null(False) & ~inter)
    complete = _f("complete_pass") | (try_ & ~sack & ~inter & ~inc & ~_f("qb_scramble"))
    return (
        pl.when(sack).then(pl.lit("sack"))
        .when(_f("qb_scramble")).then(pl.lit("scramble"))
        .when(inter).then(pl.lit("int"))
        .when(inc).then(pl.lit("inc"))
        .when(complete & _f("fumble")).then(pl.lit("fumbleCatch"))
        .when(complete & (y <= 0)).then(pl.lit("c0"))
        .when(complete & (y <= 9)).then(pl.lit("c1_9"))
        .when(complete & (y <= 19)).then(pl.lit("c10_19"))
        .when(complete).then(pl.lit("c20"))
        .otherwise(None)
    )


def add_outcomes(plays: pl.DataFrame, cfg: dict[str, Any]) -> pl.DataFrame:
    """Adds family, y, cls, flags, ty, ry and kind to run and pass plays (null elsewhere)."""
    df = plays.with_columns(family=family_expr(cfg)).with_columns(y=yards_expr())
    df = df.with_columns(
        cls=pl.when(pl.col("family") == "run").then(run_class()).when(pl.col("family") == "pass").then(pass_class()).otherwise(None)
    )
    inter = pl.col("cls") == "int"
    lost = _f("fumble_lost") & ~pl.col("recovered_by_offense").fill_null(False) & ~inter
    regained = inter & _f("fumble") & pl.col("recovered_by_offense").fill_null(False)
    def_td = (pl.col("td_defense").fill_null(False) | _f("return_touchdown")) & (inter | lost) & ~regained
    off_td = pl.col("td_offense").fill_null(False) & ~inter & ~lost
    flags = (
        pl.when(_f("out_of_bounds")).then(OB).otherwise(0)
        + pl.when(off_td).then(TD).otherwise(0)
        + pl.when(inter & ~regained).then(INT).otherwise(0)
        + pl.when(lost).then(FUM_LOST).otherwise(0)
        + pl.when(def_td).then(DEF_TD).otherwise(0)
        + pl.when(_f("fumble_out_of_bounds")).then(FUM_OOB).otherwise(0)
        + pl.when(regained).then(REGAINED).otherwise(0)
    )
    ty = (
        pl.when(inter).then(pl.col("air_yards").fill_null(0))
        .when(lost).then(pl.col("yards_gained").fill_null(0))
        .otherwise(0)
        .cast(pl.Int64)
    )
    ry = (
        pl.when(inter).then(pl.col("return_yards").fill_null(0))
        .when(lost).then(pl.col("fumble_recovery_1_yards").fill_null(0))
        .otherwise(0)
        .cast(pl.Int64)
    )
    # A safety the yards do not show (the runner was downed on the goal line).
    own_spot = (100 - pl.col("yardline_100")).cast(pl.Int64)
    y_fixed = pl.when(_f("safety") & (own_spot + pl.col("y") > 0)).then(-own_spot).otherwise(pl.col("y"))
    y_fixed = pl.when(inter | lost).then(0).otherwise(y_fixed)
    y_fixed = pl.when(off_td).then(pl.max_horizontal(y_fixed, pl.col("yardline_100").cast(pl.Int64))).otherwise(y_fixed)
    kind = (
        pl.when(pl.col("family") == "run").then(pl.lit("run"))
        .when(pl.col("cls") == "sack").then(pl.lit("sack"))
        .when(pl.col("cls") == "scramble").then(pl.lit("scramble"))
        .when(pl.col("family") == "pass").then(pl.lit("pass"))
        .otherwise(None)
    )
    return df.with_columns(
        flags=pl.when(pl.col("family").is_not_null()).then(flags).otherwise(None).cast(pl.Int64),
        ty=ty,
        ry=ry,
        kind=kind,
    ).with_columns(y=y_fixed)


def split_unknown_depth(plays: pl.DataFrame, caller: Caller) -> pl.DataFrame:
    """Plain dropbacks without air yards (sacks, scrambles, most throwaways) get no depth leaf
    from the step 2 mapping. Each becomes three rows, one per depth leaf, with `frac` set to the
    step 2 caller's depth share in that play's situation (spec resolved question 13). Every
    other play keeps frac 1."""
    base = plays.with_columns(frac=pl.lit(1.0))
    unknown = (pl.col("family") == "pass") & (pl.col("pass_type") == "plain") & pl.col("depth").is_null()
    keep = base.filter(~unknown.fill_null(False))
    todo = base.filter(unknown.fill_null(False))
    if todo.height == 0:
        return keep
    cache: dict[tuple[Any, ...], tuple[float, float, float]] = {}
    cols = ["phase", "down", "ydstogo", "yardline_100", "score_differential", "qtr", "half_seconds_remaining",
            "game_seconds_remaining", "offense_timeouts", "defense_timeouts"]
    shares: list[tuple[float, float, float]] = []
    for row in todo.select(cols).iter_rows(named=True):
        key = tuple(row[c] for c in cols)
        got = cache.get(key)
        if got is None:
            sit = situation_of(row)
            _, trace = caller.offense(sit)
            dp = trace["oDepth" if sit["phase"] == "scrimmage" else "tpDepth"]
            got = (dp.weights[0] / dp.total, dp.weights[1] / dp.total, dp.weights[2] / dp.total)
            cache[key] = got
        shares.append(got)
    parts = []
    for i, leaf in enumerate(DEPTH_LEAVES):
        parts.append(
            todo.with_columns(
                leaf=pl.lit(leaf), frac=pl.Series([s[i] for s in shares], dtype=pl.Float64), depth_split=pl.lit(True)
            )
        )
    keep = keep.with_columns(depth_split=pl.lit(False))
    return pl.concat([keep, *parts], how="diagonal_relaxed").filter(pl.col("frac") > 0)
