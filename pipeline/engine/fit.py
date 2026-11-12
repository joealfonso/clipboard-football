"""Fitting engine tables: class shares per situation cell, whole-play pools per class, and
histograms, all season-weighted and with backoff by a minimum count.

Rows carry `w` (the season weight) and `frac` (1, or a depth share for a split dropback).
A cell or pool is stored only when its unweighted count, the sum of `frac`, is at least the
minimum. Shares are integers summing to CELL_TOTAL (pipeline.caller.fit.round_to_total).
"""

from __future__ import annotations

import math
from typing import Any

import polars as pl

from pipeline.caller.fit import CELL_TOTAL, HoldoutLeak, round_to_total

# Context dimensions read from play columns, not from the step 2 bin labels.
CONTEXT = {"leaf": "leaf", "formation": "formation", "family": "family", "class": "cls", "pfamily": "pfamily"}
POOL_WEIGHT_SCALE = 10000


def col_for(dim: str) -> str:
    return CONTEXT.get(dim, f"b_{dim}")


def key_expr(level: dict[str, Any], tag: str | None = None) -> pl.Expr:
    """The same key as packages/sim's levelKey: dimension labels joined by "|", null when one is
    null. A tagged level prefixes its tag. The global level's key is ""."""
    parts: list[pl.Expr] = []
    if tag is not None:
        parts.append(pl.lit(tag))
    parts += [pl.col(col_for(d)).cast(pl.String) for d in level["dims"]]
    if not parts:
        return pl.lit("")
    return pl.concat_str(parts, separator="|")


def check_holdout(frame: pl.DataFrame, never_from: int) -> None:
    if frame.height and frame["season"].max() >= never_from:  # type: ignore[operator]
        raise HoldoutLeak(f"season {frame['season'].max()} reached an engine fit")


def weighted_quantile(values: list[float], weights: list[float], q: float) -> float:
    """Smallest value whose cumulative weight reaches q of the total."""
    pairs = sorted(zip(values, weights))
    total = sum(w for _, w in pairs)
    acc = 0.0
    for v, w in pairs:
        acc += w
        if acc >= q * total - 1e-12:
            return v
    return pairs[-1][0]


def fit_cells(
    frame: pl.DataFrame,
    levels: list[dict[str, Any]],
    classes: list[str],
    min_n: float,
    never_from: int,
    quantile: float | None = None,
    tag: str | None = None,
) -> list[dict[str, list[int]]]:
    """One map per level: key -> integer class weights summing to CELL_TOTAL, then (when
    `quantile` is set) the cell's weighted yards quantile as one extra integer."""
    check_holdout(frame, never_from)
    index = {c: i for i, c in enumerate(classes)}
    unknown = set(frame["cls"].drop_nulls().unique().to_list()) - set(classes)
    if unknown:
        raise ValueError(f"classes not in the family's list: {sorted(unknown)}")
    out: list[dict[str, list[int]]] = []
    for level in levels:
        keyed = frame.with_columns(_key=key_expr(level, tag)).filter(pl.col("_key").is_not_null())
        g = (
            keyed.group_by(["_key", "season", "cls"])
            .agg(n=pl.col("frac").sum(), wn=(pl.col("frac") * pl.col("w")).sum())
            .sort(["_key", "season", "cls"])
        )
        by_key: dict[str, dict[int, list[float]]] = {}
        counts: dict[str, float] = {}
        for key, season, cls, n, wn in g.iter_rows():
            row = by_key.setdefault(key, {}).setdefault(season, [0.0] * len(classes))
            row[index[cls]] += wn
            counts[key] = counts.get(key, 0.0) + n
        quant: dict[str, int] = {}
        if quantile is not None:
            yq = keyed.group_by("_key").agg(pl.col("y"), (pl.col("frac") * pl.col("w")).alias("ww"))
            for key, ys, ws in yq.iter_rows():
                quant[key] = int(weighted_quantile([float(v) for v in ys], list(ws), quantile))
        cells: dict[str, list[int]] = {}
        for key in sorted(by_key):
            if counts[key] + 1e-9 < min_n:
                continue
            num = [0.0] * len(classes)
            for season in sorted(by_key[key]):
                for j, v in enumerate(by_key[key][season]):
                    num[j] += v
            den = sum(num)
            weights = round_to_total([x / den for x in num])
            cells[key] = weights + ([quant[key]] if quantile is not None else [])
        out.append(cells)
    return out


def fit_pools(
    frame: pl.DataFrame,
    levels: list[dict[str, Any]],
    fields: list[str],
    min_n: float,
    never_from: int,
    tag: str | None = None,
) -> list[dict[str, list[int]]]:
    """One map per level: key -> flat integer array, `fields` then the weight, per distinct
    outcome tuple, sorted by the tuple. Weights are season weight x frac x POOL_WEIGHT_SCALE,
    rounded, at least 1. The last level is the fallback and keeps every pool, however small."""
    check_holdout(frame, never_from)
    out: list[dict[str, list[int]]] = []
    for li, level in enumerate(levels):
        min_level = 0.0 if li == len(levels) - 1 else min_n
        keyed = frame.with_columns(_key=key_expr(level, tag)).filter(pl.col("_key").is_not_null())
        n = keyed.group_by("_key").agg(n=pl.col("frac").sum())
        ok = n.filter(pl.col("n") + 1e-9 >= min_level)["_key"].to_list()
        g = (
            keyed.filter(pl.col("_key").is_in(ok))
            .group_by(["_key", *fields])
            .agg(ww=(pl.col("frac") * pl.col("w")).sum())
            .sort(["_key", *fields])
        )
        pools: dict[str, list[int]] = {}
        for row in g.iter_rows():
            key = row[0]
            vals = [int(v) for v in row[1:-1]]
            weight = max(1, int(round(row[-1] * POOL_WEIGHT_SCALE)))
            pools.setdefault(key, []).extend([*vals, weight])
        out.append(dict(sorted(pools.items())))
    return out


def histogram(values: list[int], weights: list[float], lo: int, hi: int) -> list[int]:
    """Weights per whole value lo..hi (clipped), scaled to integers summing to CELL_TOTAL."""
    raw = [0.0] * (hi - lo + 1)
    for v, w in zip(values, weights):
        raw[min(hi, max(lo, v)) - lo] += w
    total = sum(raw)
    if total <= 0:
        raise ValueError("empty histogram")
    return round_to_total([x / total for x in raw])


def share(num: float, den: float) -> float:
    return num / den if den > 0 else math.nan


__all__ = ["CELL_TOTAL", "fit_cells", "fit_pools", "histogram", "key_expr", "weighted_quantile"]
