"""Fitting factor tables: weighted shares per cell, backoff by minimum count, integer weights.

share(c) = sum(w_i * m_i(c)) / sum(w_i), w_i = 0.5 ** ((anchor - season_i) / half_life).
A cell is stored only when its unweighted play count is at least minPlays. Shares are
stored as integers summing to exactly CELL_TOTAL (largest remainder, ties by target order).
"""

from __future__ import annotations

import math
from typing import Any

import polars as pl

from pipeline.caller.config import season_weight

LABEL_PREFIX = "b_"
CONTEXT_DIMS = ("leaf", "front")


def label_col(dim: str) -> str:
    """Bin label columns carry a prefix; context dimensions (leaf, front) do not."""
    return dim if dim in CONTEXT_DIMS else LABEL_PREFIX + dim

CELL_TOTAL = 10000


class HoldoutLeak(Exception):
    pass


def round_to_total(shares: list[float], total: int = CELL_TOTAL) -> list[int]:
    """Largest-remainder rounding. Zero shares stay zero; ties go to the earlier target."""
    raw = [s * total for s in shares]
    floors = [math.floor(r) for r in raw]
    deficit = total - sum(floors)
    candidates = sorted((i for i, r in enumerate(raw) if r > 0), key=lambda i: (-(raw[i] - floors[i]), i))
    if deficit < 0 or deficit > len(candidates):
        raise ValueError(f"cannot round {shares} to {total}")
    for i in candidates[:deficit]:
        floors[i] += 1
    return floors


def weighted_shares(counts: dict[int, list[int]], weights: dict[int, float]) -> list[float]:
    """counts: season -> per-target play counts. Sums seasons in ascending order so the
    result never depends on row order."""
    n = len(next(iter(counts.values())))
    num = [0.0] * n
    den = 0.0
    for season in sorted(counts):
        w = weights[season]
        row = counts[season]
        for j in range(n):
            num[j] += w * row[j]
        den += w * sum(row)
    return [x / den for x in num]


def level_key_expr(level: dict[str, Any]) -> pl.Expr:
    """Same key as bins.level_key: tag first, then the dimension labels, joined by "|".
    Null when any dimension is null (the level does not apply)."""
    parts: list[pl.Expr] = []
    if "tag" in level:
        parts.append(pl.lit(level["tag"]))
    parts += [pl.col(label_col(d)) for d in level["dims"]]
    if not parts:
        return pl.lit("")
    if "tag" in level:
        # A tagged level only takes rows carrying that tag.
        return pl.when(pl.col("tag") == level["tag"]).then(pl.concat_str(parts, separator="|")).otherwise(None)
    return pl.concat_str(parts, separator="|")


def fit_factor(
    frame: pl.DataFrame,
    factor: dict[str, Any],
    anchor: int,
    half_life: float,
    never_train_from: int,
) -> dict[str, Any]:
    """frame: one row per training play with `season`, `target` and every dimension label
    the factor's levels name (plus `tag` for tagged levels)."""
    if frame.height and frame["season"].max() >= never_train_from:  # type: ignore[operator]
        raise HoldoutLeak(f"season {frame['season'].max()} reached fit_factor")
    targets: list[str] = factor["targets"]
    unknown = set(frame["target"].unique().to_list()) - set(targets)
    if unknown:
        raise ValueError(f"targets not in the factor's list: {sorted(unknown)}")
    seasons = sorted(frame["season"].unique().to_list())
    weights = {s: season_weight(s, anchor, half_life) for s in seasons}
    target_index = {t: i for i, t in enumerate(targets)}
    cells: list[dict[str, list[int]]] = []
    for level in factor["levels"]:
        keyed = frame.with_columns(_key=level_key_expr(level)).filter(pl.col("_key").is_not_null())
        grouped = keyed.group_by(["_key", "season", "target"]).len().sort(["_key", "season", "target"])
        by_key: dict[str, dict[int, list[int]]] = {}
        for key, season, target, n in grouped.iter_rows():
            row = by_key.setdefault(key, {}).setdefault(season, [0] * len(targets))
            row[target_index[target]] += n
        level_cells: dict[str, list[int]] = {}
        for key in sorted(by_key):
            counts = by_key[key]
            if sum(sum(r) for r in counts.values()) < factor["minPlays"]:
                continue
            level_cells[key] = round_to_total(weighted_shares(counts, weights))
        cells.append(level_cells)
    out: dict[str, Any] = {
        "targets": targets,
        "levels": factor["levels"],
        "minPlays": factor["minPlays"],
        "seasons": seasons,
        "seasonWeights": {str(s): weights[s] for s in seasons},
        "plays": frame.height,
        "cells": cells,
    }
    if "byDown" in factor["seasons"]:
        out["byDown"] = factor["seasons"]["byDown"]
    if "downs" in factor:
        out["downs"] = factor["downs"]
    return out


def in_seasons(factor: dict[str, Any]) -> pl.Expr:
    """Row filter for a factor's season range, including per-down overrides."""
    s = factor["seasons"]
    expr = pl.col("season").is_between(s["from"], s["to"])
    if "downs" in factor:
        expr = expr & pl.col("down").is_in([float(d) for d in factor["downs"]])
    for down, r in s.get("byDown", {}).items():
        expr = (
            pl.when(pl.col("down") == float(down))
            .then(pl.col("season").is_between(r["from"], r["to"]))
            .otherwise(expr)
        )
    return expr
