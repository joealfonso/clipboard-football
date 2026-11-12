"""Special teams and the small play families: punts, field goals, extra points, two-point
tries, kneels and spikes. Kickoffs are designed (data/engine/kickoff.json), not fitted here.
"""

from __future__ import annotations

import math
from typing import Any

import polars as pl

from pipeline.engine.fit import fit_cells, fit_pools

# Punt tuple flags (packages/sim/src/engine/kicks.ts).
P_KICKERS_RECOVER = 1  # the kicking team recovered (a muff, or a blocked punt)
P_DEF_TD = 2  # the receivers scored
P_SAFETY = 4  # a blocked punt went out of the kicking team's end zone

# Blocked field goal tuple flags.
B_KICKERS_RECOVER = 1
B_DEF_TD = 2


def _f(c: str) -> pl.Expr:
    return pl.col(c).cast(pl.Float64).fill_null(0) == 1


def no_foul() -> pl.Expr:
    return ~pl.col("has_accepted_foul").fill_null(False)


# ---------------------------------------------------------------- punts


def punt_class(long_from: int) -> pl.Expr:
    gross = pl.col("kick_distance").fill_null(0)
    band = pl.when(gross >= long_from).then(pl.lit("Long")).otherwise(pl.lit("Short"))
    return (
        pl.when(_f("punt_blocked")).then(pl.lit("blocked"))
        .when(pl.col("desc_muff").fill_null(False)).then(pl.lit("muffed"))
        .when(_f("return_touchdown") & pl.col("td_defense").fill_null(False)).then(pl.lit("returnTD"))
        .when(_f("touchback")).then(pl.lit("touchback"))
        .when(_f("punt_fair_catch")).then(pl.lit("fairCatch") + band)
        .when(_f("punt_downed")).then(pl.lit("downed") + band)
        .when(_f("punt_out_of_bounds")).then(pl.lit("outOfBounds") + band)
        .otherwise(pl.lit("returned") + band)
    )


def punt_frame(plays: pl.DataFrame, cfg: dict[str, Any]) -> pl.DataFrame:
    p = plays.filter((pl.col("call") == "punt") & no_foul())
    p = p.with_columns(cls=punt_class(cfg["punts"]["longGrossFrom"]))
    kickers = (
        (pl.col("cls") == "muffed") & pl.col("recovered_by_offense").fill_null(False)
    ) | ((pl.col("cls") == "blocked") & pl.col("desc_recovered_by_kicking").fill_null(False))
    flags = (
        pl.when(kickers).then(P_KICKERS_RECOVER).otherwise(0)
        + pl.when(pl.col("td_defense").fill_null(False) | (pl.col("cls") == "returnTD")).then(P_DEF_TD).otherwise(0)
        + pl.when((pl.col("cls") == "blocked") & (_f("safety") | pl.col("desc_safety").fill_null(False))).then(P_SAFETY).otherwise(0)
    )
    return p.with_columns(
        gross=pl.when(pl.col("cls") == "blocked").then(0).otherwise(pl.col("kick_distance").fill_null(0)).cast(pl.Int64),
        ret=pl.col("return_yards").fill_null(0).cast(pl.Int64),
        pflags=flags.cast(pl.Int64),
    )


def fit_punts(frame: pl.DataFrame, cfg: dict[str, Any], never_from: int) -> dict[str, Any]:
    pc = cfg["punts"]
    cells = fit_cells(frame, pc["levels"], pc["classes"], cfg["minPlays"], never_from)
    pools = fit_pools(frame, pc["poolLevels"], ["gross", "ret", "pflags"], cfg["minPoolPlays"], never_from)
    return {
        "classes": pc["classes"],
        "levels": pc["levels"],
        "poolLevels": pc["poolLevels"],
        "fields": ["gross", "ret", "flags"],
        "cells": cells,
        "pools": pools,
        "plays": frame.height,
    }


# ---------------------------------------------------------------- field goals


def logistic_fit(x: list[float], y: list[float], w: list[float], iters: int = 50) -> list[float]:
    """Weighted logistic regression of y on [1, d, d^2] by Newton's method, d centered at 40
    and scaled by 10 so the 3x3 system stays well conditioned. Returns [b0, b1, b2]."""
    beta = [2.0, -0.5, 0.0]
    for _ in range(iters):
        g = [0.0, 0.0, 0.0]
        h = [[0.0] * 3 for _ in range(3)]
        for xi, yi, wi in zip(x, y, w):
            d = (xi - 40.0) / 10.0
            f = [1.0, d, d * d]
            z = sum(b * v for b, v in zip(beta, f))
            p = 1.0 / (1.0 + math.exp(-z))
            for a in range(3):
                g[a] += wi * (yi - p) * f[a]
                for b in range(3):
                    h[a][b] += wi * p * (1 - p) * f[a] * f[b]
        step = solve3(h, g)
        beta = [b + s for b, s in zip(beta, step)]
        if max(abs(s) for s in step) < 1e-10:
            break
    return beta


def solve3(a: list[list[float]], b: list[float]) -> list[float]:
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(3):
        piv = max(range(c, 3), key=lambda r: abs(m[r][c]))
        m[c], m[piv] = m[piv], m[c]
        for r in range(3):
            if r != c:
                f = m[r][c] / m[c][c]
                for k in range(c, 4):
                    m[r][k] -= f * m[c][k]
    return [m[i][3] / m[i][i] for i in range(3)]


def curve_value(beta: list[float], dist: float) -> float:
    d = (dist - 40.0) / 10.0
    return 1.0 / (1.0 + math.exp(-(beta[0] + beta[1] * d + beta[2] * d * d)))


def fg_frame(plays: pl.DataFrame) -> pl.DataFrame:
    fg = plays.filter((pl.col("call") == "fieldGoal") & no_foul() & pl.col("kick_distance").is_not_null())
    return fg.with_columns(
        dist=pl.col("kick_distance").cast(pl.Int64),
        made=pl.col("field_goal_result") == "made",
        blocked=pl.col("field_goal_result") == "blocked",
        depth=(pl.col("kick_distance") - pl.col("yardline_100") - 10).cast(pl.Int64),
        bflags=(
            pl.when(pl.col("desc_recovered_by_kicking").fill_null(False)).then(B_KICKERS_RECOVER).otherwise(0)
            + pl.when(pl.col("td_defense").fill_null(False) | (pl.col("desc_touchdown").fill_null(False) & ~pl.col("desc_recovered_by_kicking").fill_null(False))).then(B_DEF_TD).otherwise(0)
        ).cast(pl.Int64),
        ret=pl.col("return_yards").fill_null(0).cast(pl.Int64),
    )


def fit_field_goals(frame: pl.DataFrame, cfg: dict[str, Any]) -> dict[str, Any]:
    """`frame` carries `w` from the field goal half-life."""
    fc = cfg["fieldGoals"]
    nb = frame.filter(~pl.col("blocked"))
    beta = logistic_fit(nb["dist"].cast(pl.Float64).to_list(), nb["made"].cast(pl.Float64).to_list(), nb["w"].to_list())
    lo, hi = fc["minDistance"], fc["maxDistance"]
    counts = {d: n for d, n in nb.group_by("dist").len().iter_rows()}
    cap_at = max((d for d, n in counts.items() if n >= fc["capMinAttempts"]), default=lo)
    cap = curve_value(beta, cap_at)
    make: list[int] = []
    for d in range(lo, hi + 1):
        if d <= cap_at:
            p = curve_value(beta, d)
        else:
            p = cap * (hi - d) / (hi - cap_at)
        make.append(int(round(max(0.0, min(1.0, p)) * 10000)))
    # Block rate by band, among all attempts.
    blocks = []
    for b in fc["bands"]:
        sub = frame.filter(pl.col("dist").is_between(b["min"], b["max"]))
        den = sub["w"].sum()
        blocks.append(int(round(10000 * (sub.filter(pl.col("blocked"))["w"].sum() / den if den else 0.0))))
    depth_counts = frame.group_by("depth").agg(pl.col("w").sum()).sort("depth")
    depth = int(max(depth_counts.iter_rows(), key=lambda r: (r[1], -r[0]))[0])
    blocked = frame.filter(pl.col("blocked")).with_columns(frac=pl.lit(1.0))
    pool = fit_pools(blocked, [{"dims": []}], ["ret", "bflags"], 1, 10**9)[0].get("", [])
    return {
        "beta": beta,
        "minDistance": lo,
        "maxDistance": hi,
        "capAt": cap_at,
        "makePer10000": make,
        "bands": fc["bands"],
        "blockPer10000": blocks,
        "kickDepth": depth,
        "blockedPool": {"fields": ["ret", "flags"], "tuples": pool},
        "attempts": frame.height,
    }


def fg_by_season(frame: pl.DataFrame, cfg: dict[str, Any], beta: list[float]) -> list[dict[str, Any]]:
    """B7: each training season's make rate by band, with the curve's mean prediction there."""
    out = []
    for season in sorted(frame["season"].unique().to_list()):
        s = frame.filter((pl.col("season") == season) & ~pl.col("blocked"))
        row: dict[str, Any] = {"season": season, "attempts": s.height, "made": float(s["made"].mean() or 0)}
        for b in cfg["fieldGoals"]["bands"]:
            sub = s.filter(pl.col("dist").is_between(b["min"], b["max"]))
            row[b["label"]] = {
                "n": sub.height,
                "actual": float(sub["made"].mean()) if sub.height else None,
                "curve": (sum(curve_value(beta, d) for d in sub["dist"].to_list()) / sub.height) if sub.height else None,
            }
        out.append(row)
    return out


# ---------------------------------------------------------------- extra points


def xp_frame(plays: pl.DataFrame) -> pl.DataFrame:
    x = plays.filter((pl.col("phase") == "try") & (pl.col("extra_point_attempt") == 1) & no_foul())
    r = pl.col("extra_point_result")
    return x.filter(r.is_in(["good", "failed", "blocked"])).with_columns(
        cls=pl.when(r == "good").then(pl.lit("good")).when(r == "blocked").then(pl.lit("blocked")).otherwise(pl.lit("miss"))
    )


def fit_extra_points(frame: pl.DataFrame, never_from: int) -> dict[str, Any]:
    cells = fit_cells(frame.with_columns(frac=pl.lit(1.0)), [{"dims": []}], ["good", "miss", "blocked"], 1, never_from)
    return {"classes": ["good", "miss", "blocked"], "weights": cells[0][""], "attempts": frame.height}


# ---------------------------------------------------------------- two-point tries


def two_point_frames(plays: pl.DataFrame) -> dict[str, pl.DataFrame]:
    """Backoff sources for a two-point leaf, in order (config twoPoint.levels)."""
    base = plays.filter(pl.col("family").is_not_null() & pl.col("leaf").is_not_null() & no_foul())
    try_ = base.filter((pl.col("phase") == "try") & (pl.col("try_call") == "goForTwo"))
    scrim = base.filter(pl.col("phase") == "scrimmage")
    return {
        "try": try_,
        "at2": scrim.filter(pl.col("yardline_100") == 2),
        "goalLine": scrim.filter(pl.col("b_zone6") == "GL"),
        "tryFamily": try_,
    }


def fit_two_point(plays: pl.DataFrame, cfg: dict[str, Any], never_from: int) -> dict[str, Any]:
    """Per leaf, the first source with at least minPlays plays: class shares and one pool per
    class (no further backoff inside a source)."""
    frames = two_point_frames(plays)
    out: dict[str, Any] = {}
    for fam, fdef in cfg["families"].items():
        for leaf in fdef["leaves"]:
            chosen = None
            for src in cfg["twoPoint"]["levels"]:
                f = frames[src]
                f = f.filter(pl.col("family") == fam) if src == "tryFamily" else f.filter(pl.col("leaf") == leaf)
                if f["frac"].sum() + 1e-9 >= cfg["minPlays"] or src == "tryFamily":
                    chosen = (src, f)
                    break
            assert chosen is not None
            src, f = chosen
            cells = fit_cells(f, [{"dims": []}], fdef["classes"], 1, never_from)
            pools = fit_pools(f, [{"dims": ["class"]}], ["y", "flags", "ty", "ry"], 1, never_from)
            out[leaf] = {"source": src, "plays": round(float(f["frac"].sum()), 3), "weights": cells[0][""], "pools": pools[0]}
    return out


# ---------------------------------------------------------------- kneels and spikes


def fit_clock_plays(plays: pl.DataFrame, never_from: int) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for call in ("kneel", "spike"):
        f = plays.filter((pl.col("call") == call) & no_foul()).with_columns(
            frac=pl.lit(1.0), y=pl.col("yards_gained").fill_null(0).cast(pl.Int64), flags=pl.lit(0, dtype=pl.Int64)
        )
        pool = fit_pools(f, [{"dims": []}], ["y"], 1, never_from)[0].get("", [])
        out[call] = {"fields": ["y"], "tuples": pool, "plays": f.height}
    return out
