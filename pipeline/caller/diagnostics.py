"""Mapping, missingness and agreement checks for docs/CALLER_REPORT.md. Counts only."""

from __future__ import annotations

from collections import Counter
from typing import Any

import polars as pl

from pipeline.caller.load import SeasonData
from pipeline.caller.mapping import component_mismatches, sneak_inferred

COMPONENTS = ("personnel group", "box", "shell", "man/zone", "rush")
SITUATION_DIMS = ("down", "dist5", "zone6", "score7", "time5")


def value_table(seasons: list[SeasonData], attr: str, mapping: dict[str, Any]) -> dict[str, Any]:
    values: dict[str, dict[int, int]] = {}
    for sd in seasons:
        for v, n in getattr(sd, attr).items():
            values.setdefault(v, {})[sd.season] = n
    return {
        "seasons": [sd.season for sd in seasons],
        "rows": [
            {"value": v, "target": mapping.get(v, "UNMAPPED"), "counts": values[v]}
            for v in sorted(values, key=lambda x: (-sum(values[x].values()), x))
        ],
    }


def personnel_patterns(seasons: list[SeasonData], attr: str, parse: Any, target: Any) -> dict[str, Any]:
    rows: dict[str, dict[int, int]] = {}
    targets: dict[str, str] = {}
    for sd in seasons:
        for text, n in getattr(sd, attr).items():
            pattern = parse(text)
            tgt = target(text)
            rows.setdefault(pattern, {})
            rows[pattern][sd.season] = rows[pattern].get(sd.season, 0) + n
            targets[pattern] = tgt
    return {
        "seasons": [sd.season for sd in seasons],
        "rows": [
            {"value": p, "target": targets[p], "counts": rows[p]}
            for p in sorted(rows, key=lambda x: (-sum(rows[x].values()), x))
        ],
    }


def coverage_presence(plays: pl.DataFrame) -> dict[str, Any]:
    """Share of scrimmage plays with defense_coverage_type charted, by play type and by
    each situation dimension, per season."""
    df = plays.filter((pl.col("phase") == "scrimmage") & (pl.col("season") >= 2018)).with_columns(
        kind=pl.when(pl.col("call") == "pass")
        .then(pl.lit("dropback"))
        .when(pl.col("call") == "run")
        .then(pl.lit("run"))
        .otherwise(pl.lit("other")),
        present=pl.col("defense_coverage_type").is_not_null(),
    )
    out: dict[str, Any] = {}
    for by in ("kind", *SITUATION_DIMS):
        col = by if by == "kind" else "b_" + by
        g = df.group_by([col, "season"]).agg(n=pl.len(), rate=pl.col("present").mean()).sort([col, "season"])
        out[by] = [(str(a), int(s), int(n), float(r)) for a, s, n, r in g.iter_rows()]
    return out


def blitz_runs_vs_dropbacks(plays: pl.DataFrame) -> dict[str, Any]:
    """FTN n_blitzers is charted on runs and dropbacks alike in 2022-2023. Blitz = one or
    more blitzers. Compared within coarse cells (down, dist3, zone3, score3, time2)."""
    df = plays.filter(
        (pl.col("phase") == "scrimmage")
        & pl.col("season").is_between(2022, 2023)
        & pl.col("call").is_in(["run", "pass"])
        & pl.col("n_blitzers").is_not_null()
    ).with_columns(blitz=pl.col("n_blitzers") >= 1)
    by_down = (
        df.group_by(["b_down", "b_dist3", "call"]).agg(n=pl.len(), rate=pl.col("blitz").mean()).sort(["b_down", "b_dist3", "call"])
    )
    overall = df.group_by("call").agg(n=pl.len(), rate=pl.col("blitz").mean()).sort("call")
    cells = (
        df.group_by(["b_down", "b_dist3", "b_zone3", "b_score3", "b_time2", "call"])
        .agg(n=pl.len(), rate=pl.col("blitz").mean())
        .pivot(on="call", index=["b_down", "b_dist3", "b_zone3", "b_score3", "b_time2"], values=["n", "rate"])
        .drop_nulls()
    )
    if cells.height:
        w = cells["n_run"] + cells["n_pass"]
        diff = float(((cells["rate_pass"] - cells["rate_run"]) * w).sum() / w.sum())
    else:
        diff = float("nan")
    return {
        "overall": [(c, int(n), float(r)) for c, n, r in overall.iter_rows()],
        "byDownDist": [(int(d), str(t), c, int(n), float(r)) for d, t, c, n, r in by_down.iter_rows()],
        "cells": cells.height,
        "weightedDiff": diff,
    }


def sneak_agreement(plays: pl.DataFrame, cfg: dict[str, Any]) -> dict[str, int]:
    df = plays.filter(
        (pl.col("phase") == "scrimmage")
        & pl.col("season").is_between(2022, 2023)
        & (pl.col("call") == "run")
        & pl.col("ftn_present")
    ).with_columns(rule=sneak_inferred(cfg).fill_null(False), flag=pl.col("is_qb_sneak").fill_null(False))
    return {
        "runs": df.height,
        "flag": int(df["flag"].sum()),
        "rule": int(df["rule"].sum()),
        "both": int((df["flag"] & df["rule"]).sum()),
        "flagOnly": int((df["flag"] & ~df["rule"]).sum()),
        "ruleOnly": int((~df["flag"] & df["rule"]).sum()),
    }


def defense_mismatch(plays: pl.DataFrame, cfg: dict[str, Any]) -> dict[str, Any]:
    mapping = cfg["defenseMapping"]
    base = plays.filter(
        (pl.col("phase") == "scrimmage") & pl.col("call").is_in(["run", "pass"]) & pl.col("preset").is_not_null()
    )
    out: dict[str, Any] = {}
    for name, lo, hi in (("2018-2023", 2018, 2023), ("2024-2025", 2024, 2025)):
        df = base.filter(pl.col("season").is_between(lo, hi))
        counts = Counter()
        combos: Counter[tuple[str, ...]] = Counter()
        n = 0
        any_bad = 0
        for row in df.select(
            ["preset", "def_db", "defenders_in_box", "number_of_pass_rushers", "shell", "man_zone"]
        ).iter_rows(named=True):
            n += 1
            mm = component_mismatches(row, mapping)
            for comp, bad in mm.items():
                if bad:
                    counts[comp] += 1
            if any(mm.values()):
                any_bad += 1
                rushers = int(row["number_of_pass_rushers"])
                combos[(
                    f"{int(row['def_db'])} DB",
                    "box 8+" if row["defenders_in_box"] >= mapping["boxHeavyMin"] else "box 7-",
                    row["shell"],
                    row["man_zone"],
                    "rush 4-" if rushers <= 4 else ("rush 5" if rushers == 5 else "rush 6+"),
                    row["preset"],
                )] += 1
        out[name] = {
            "n": n,
            "shares": {c: (counts[c] / n if n else 0.0) for c in COMPONENTS},
            "any": any_bad / n if n else 0.0,
            "top": [(list(k), v, v / n) for k, v in combos.most_common(15)],
        }
    return out


def mix_by_season(plays: pl.DataFrame, column: str, scope: pl.Expr) -> dict[str, Any]:
    df = plays.filter(scope.fill_null(False) & pl.col(column).is_not_null())
    g = df.group_by(["season", column]).len().sort(["season", column])
    totals = df.group_by("season").len()
    tot = {s: n for s, n in totals.iter_rows()}
    rows: dict[str, dict[int, float]] = {}
    for s, v, n in g.iter_rows():
        rows.setdefault(v, {})[s] = n / tot[s]
    return {"seasons": sorted(tot), "totals": tot, "rows": rows}
