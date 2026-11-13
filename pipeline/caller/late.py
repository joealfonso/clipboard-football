"""Step 5a: late-game score bins for the offense caller. Counts of the late-window cells (A5)
and the in-sample late-game checks (B5, B6), also shown not gated on 2024-2025 (C3).

Late window = time5 G5 or GF (the last 5:00 of the game; overtime is binned as the second
half). Thresholds: data/caller/latechecks.json (designed, committed before the first fit).
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

import polars as pl

from pipeline.caller.fit import label_col, level_key_expr
from pipeline.caller.frames import situation_columns, situation_of
from pipeline.caller.config import PASS_PLAYS
from pipeline.caller.shares import Caller

LATE = ("G5", "GF")
# The finest late-window level each changed factor gains (A5 counts these cells).
PLANNED = {
    "oTop": {"dims": ["down", "dist5", "zone6", "scoreLateOnly", "time5", "end"]},
    "o4Top": {"dims": ["dist5", "zone6", "scoreLateOnly", "time5", "end"]},
    "o4Kick": {"dims": ["zone6", "time2", "scoreLateOnly"]},
}
FOURTH_GROUPS = (("trailing 4-8", -8, -4), ("trailing 1-3", -3, -1), ("tied", 0, 0), ("leading 1-3", 1, 3), ("leading 4-8", 4, 8))


# Step 5b (B1): candidate late levels, counted before the fit (overtime rows included).
CANDIDATES_5B = {
    "oTop": [["down", "kneelOut", "scoreLate5Only", "lateTime"], ["down", "kneelOut", "lateTime"], ["down", "zoneK", "scoreLateOnly", "lateTime", "end"],
             ["down", "zoneK", "scoreLate5Only", "lateTime"], ["zoneK", "scoreLate5Only", "lateTime"], ["fieldHalf", "scoreLate5Only", "lateTime"]],
    "o4Top": [["zoneK", "scoreLate5Only", "lateTime"], ["fieldHalf", "scoreLate5Only", "lateTime"]],
}


def candidate_counts(frames: dict[str, pl.DataFrame], min_plays: int) -> dict[str, Any]:
    """B1: unweighted plays per candidate late cell, 2016-2023 and 2021-2023."""
    out: dict[str, Any] = {}
    for fid, levels in CANDIDATES_5B.items():
        for dims in levels:
            level = {"dims": dims}
            k = frames[fid].with_columns(_key=level_key_expr(level)).filter(pl.col("_key").is_not_null())
            g = k.group_by("_key").agg(all=pl.len(), recent=pl.col("season").is_between(2021, 2023).sum()).sort("_key")
            rows = [{"key": a, "n2016": int(b), "n2021": int(c)} for a, b, c in g.iter_rows()]
            out[f"{fid}: {', '.join(dims)}"] = {"level": dims, "cells": rows, "atLeastN2016": sum(1 for r in rows if r["n2016"] >= min_plays),
                                                 "atLeastN2021": sum(1 for r in rows if r["n2021"] >= min_plays)}
    return out


def late_counts(frames: dict[str, pl.DataFrame], min_plays: int) -> dict[str, Any]:
    """Unweighted plays per planned late cell, 2016-2023 and 2021-2023."""
    out: dict[str, Any] = {}
    for fid, level in PLANNED.items():
        f = frames[fid].filter(pl.col(label_col("time5")).is_in(list(LATE)))
        k = f.with_columns(_key=level_key_expr(level)).filter(pl.col("_key").is_not_null())
        g = k.group_by("_key").agg(all=pl.len(), recent=pl.col("season").is_between(2021, 2023).sum()).sort("_key")
        rows = [{"key": a, "n2016": int(b), "n2021": int(c)} for a, b, c in g.iter_rows()]
        out[fid] = {"level": level["dims"], "cells": rows, "atLeastN2016": sum(1 for r in rows if r["n2016"] >= min_plays),
                    "atLeastN2021": sum(1 for r in rows if r["n2021"] >= min_plays)}
    return out


def _late_bucket(diff: float) -> str:
    for lab, lo, hi in (("<=-17", None, -17), ("-16..-9", -16, -9), ("-8..-4", -8, -4), ("-3..-1", -3, -1), ("0", 0, 0),
                        ("1..3", 1, 3), ("4..8", 4, 8), ("9..16", 9, 16), (">=17", 17, None)):
        if (lo is None or diff >= lo) and (hi is None or diff <= hi):
            return lab
    raise ValueError(diff)


def late_checks(plays: pl.DataFrame, caller: Caller, thr: dict[str, Any], gate: bool, fourth_gate_seasons: tuple[int, int] | None,
                approved: frozenset[str] | set[str] = frozenset()) -> list[dict[str, Any]]:
    """B5 (4th downs, Q4 last 5:00, inside the 37, by score) and B6 (downs 1-3 in the late
    windows: pass and kneel rate by late bucket). Predicted = mean predicted probability."""
    acc: dict[str, list[float]] = defaultdict(lambda: [0, 0.0, 0.0])
    labels_of: dict[str, str] = {}
    cache: dict[tuple[Any, ...], dict[str, float]] = {}
    sit_cols = situation_columns(plays.columns)
    sc = plays.filter((pl.col("phase") == "scrimmage") & pl.col("call").is_not_null())
    if fourth_gate_seasons is not None:
        sc = sc.with_columns(_recent=pl.col("season").is_between(*fourth_gate_seasons))
    else:
        sc = sc.with_columns(_recent=pl.lit(True))
    for row in sc.select(sit_cols + ["call", "b_time5", "_recent"]).iter_rows(named=True):
        down = int(row["down"])
        diff = row["score_differential"] or 0
        b5 = down == 4 and row["qtr"] == 4 and row["game_seconds_remaining"] <= 300 and row["yardline_100"] <= 37
        b6 = down <= 3 and row["b_time5"] in LATE
        if not (b5 or b6):
            continue
        key = tuple(row[c] for c in sit_cols)
        pm = cache.get(key)
        if pm is None:
            sit = situation_of(row)
            leaves, _ = caller.offense(sit, caller.labels(sit))
            pm = {lf["call"]: lf["p"] for lf in leaves}
            cache[key] = pm
        call = row["call"]

        def add(mid: str, label: str, p: float, hit: bool) -> None:
            a = acc[mid]
            a[0] += 1
            a[1] += p
            a[2] += 1.0 if hit else 0.0
            labels_of[mid] = label

        if b5:
            g = next((name for name, lo, hi in FOURTH_GROUPS if lo <= diff <= hi), None)
            if g is not None:
                p_go = sum(pm[c] for c in PASS_PLAYS) + pm["insideRun"] + pm["outsideRun"] + pm["qbSneak"]
                for scope, ok in (("all", True), ("recent", row["_recent"])):
                    if not ok:
                        continue
                    add(f"late4th.{g}.fieldGoal.{scope}", f"4th down, last 5:00, inside the 37, {g}: field goal", pm["fieldGoal"], call == "fieldGoal")
                    add(f"late4th.{g}.go.{scope}", f"4th down, last 5:00, inside the 37, {g}: go", p_go, call in ("run", "pass"))
                    add(f"late4th.{g}.punt.{scope}", f"4th down, last 5:00, inside the 37, {g}: punt", pm["punt"], call == "punt")
        if b6:
            b = _late_bucket(diff)
            add(f"lateDowns.{b}.pass", f"Downs 1-3, last 5:00, score {b}: pass rate", sum(pm[c] for c in PASS_PLAYS), call == "pass")
            add(f"lateDowns.{b}.kneel", f"Downs 1-3, last 5:00, score {b}: kneel rate", pm["kneel"], call == "kneel")
    rows: list[dict[str, Any]] = []
    for mid in sorted(acc):
        n, p, h = acc[mid]
        pred, act = p / n, h / n
        gated_metric = gate and (mid.endswith(".fieldGoal.recent") or mid.startswith("lateDowns."))
        tol = thr["fourthDownFieldGoalPp"] if mid.startswith("late4th") else thr["lateDownsPp"]
        if not gated_metric:
            status = "not gated"
        elif n < thr["minN"]:
            status = "not gated (n below minN)"
        else:
            status = "pass" if abs(100 * (pred - act)) <= tol + 1e-9 else "fail"
            if status == "fail" and mid in approved:
                status = "accepted"  # known deviation approved by Joseph (in-sample scope)
        rows.append({"id": mid, "label": labels_of[mid], "n": int(n), "predicted": pred, "actual": act, "tolerancePp": tol, "status": status})
    return rows


def checks_5b(plays: pl.DataFrame, ot: pl.DataFrame | None, caller: Caller, thr: dict[str, Any]) -> list[dict[str, Any]]:
    """Step 5b B9: (a) tied, final 2:00, inside the 37, 3rd down: field goal and pass rate;
    (b) trailing 1-8, final 2:00, K75 and K99 (own half), 4th down: punt and go rate; (c) leading,
    final 2:00, downs 1-3, by kneelOut: kneel rate. Gated on 2016-2023 regulation where n >= minN;
    the same rows in overtime are shown, not gated."""
    acc: dict[str, list[float]] = defaultdict(lambda: [0, 0.0, 0.0])
    labels_of: dict[str, str] = {}
    sit_cols = situation_columns(plays.columns)
    frames = [("", plays)] + ([("OT", ot)] if ot is not None else [])
    for tag, f in frames:
        sc = f.filter((pl.col("phase") == "scrimmage") & pl.col("call").is_not_null() & pl.col("season").is_between(2016, 2023))
        for row in sc.select(sit_cols + ["call"]).iter_rows(named=True):
            down = int(row["down"])
            diff = row["score_differential"] or 0
            late = row["game_seconds_remaining"] <= 120 if tag == "" else True
            if not late or (tag == "" and row["qtr"] != 4):
                continue
            yl = row["yardline_100"]
            sit = situation_of(row)
            labels = caller.labels(sit)
            keys: list[tuple[str, str, str]] = []
            if diff == 0 and yl <= 37 and down == 3:
                keys += [("a.fieldGoal", "tied, 3rd down, inside the 37: field goal", "fieldGoal"), ("a.pass", "tied, 3rd down, inside the 37: pass", "pass")]
            if -8 <= diff <= -1 and yl >= 51 and down == 4:
                keys += [("b.punt", "trailing 1-8, 4th down, own half: punt", "punt"), ("b.go", "trailing 1-8, 4th down, own half: go", "go")]
            ko = labels.get("kneelOut")
            if diff > 0 and down <= 3 and ko is not None:
                keys += [(f"c.kneel.{ko}", f"leading, downs 1-3, kneelOut {ko}: kneel", "kneel")]
            if not keys:
                continue
            leaves, _ = caller.offense(sit, labels)
            pm = {lf["call"]: lf["p"] for lf in leaves}
            p_pass = sum(pm[c] for c in PASS_PLAYS)
            p_go = p_pass + pm["insideRun"] + pm["outsideRun"] + pm["qbSneak"]
            for k, label, what in keys:
                mid = f"b9.{k}" + (".OT" if tag else "")
                p = {"fieldGoal": pm["fieldGoal"], "pass": p_pass, "punt": pm["punt"], "go": p_go, "kneel": pm["kneel"]}[what]
                hit = row["call"] in ("run", "pass") if what == "go" else row["call"] == what
                a = acc[mid]
                a[0] += 1
                a[1] += p
                a[2] += 1.0 if hit else 0.0
                labels_of[mid] = ("overtime, " if tag else "final 2:00, ") + label
    rows = []
    for mid in sorted(acc):
        n, p, h = acc[mid]
        pred, act = p / n, h / n
        if mid.endswith(".OT"):
            status = "not gated"
        elif n < thr["minN"]:
            status = "not gated (n below minN)"
        else:
            status = "pass" if abs(100 * (pred - act)) <= thr["lateDownsPp"] + 1e-9 else "fail"
        rows.append({"id": mid, "label": labels_of[mid], "n": int(n), "predicted": pred, "actual": act, "tolerancePp": thr["lateDownsPp"], "status": status})
    return rows
