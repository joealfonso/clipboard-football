"""The caller's own calibration against every in-scope 2024 and 2025 play. No engine.

Predicted rate of a metric = mean of the caller's predicted probability over the plays in
the metric's scope. Actual rate = share of those plays whose mapped call matches.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import polars as pl

from pipeline.caller.config import FORMATION_PLAYS, PASS_PLAYS
from pipeline.caller.frames import situation_of
from pipeline.caller.shares import Caller


@dataclass
class Metric:
    id: str
    group: str
    label: str
    tolerance: float
    min_n: int
    n: int = 0
    pred_sum: float = 0.0
    hits: int = 0
    status: str = ""
    note: str = ""

    @property
    def predicted(self) -> float | None:
        return self.pred_sum / self.n if self.n else None

    @property
    def actual(self) -> float | None:
        return self.hits / self.n if self.n else None

    def add(self, predicted: float, hit: bool) -> None:
        self.n += 1
        self.pred_sum += predicted
        self.hits += 1 if hit else 0


def wilson(hits: int, n: int, z: float = 1.959963984540054) -> tuple[float, float] | None:
    if n == 0:
        return None
    p = hits / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


@dataclass
class Validation:
    metrics: list[Metric] = field(default_factory=list)
    # Backoff: factor -> level -> plays that landed there.
    backoff: dict[str, dict[int, int]] = field(default_factory=dict)
    # Odd calls the fitted caller can make (spec resolved question 5).
    oddities: dict[str, dict[str, float]] = field(default_factory=dict)
    # 4th down: zone -> (predicted go, actual go) for the drift direction.
    drift: dict[str, tuple[float, float]] = field(default_factory=dict)

    @property
    def gated_failures(self) -> list[Metric]:
        return [m for m in self.metrics if m.status == "fail"]


def _approved(tolerances: dict[str, Any], scope: str = "holdout") -> set[str]:
    """Metrics Joseph accepted for one sample (code review, 2026-11-12). An entry applies only to
    its own scope; an entry without a scope applies to the holdout validation only, as before."""
    return {
        d["metric"]
        for d in tolerances.get("known_deviations", [])
        if d.get("approved_by") == "Joseph" and d.get("scope", "holdout") == scope
    }


def run_validation(plays: pl.DataFrame, caller: Caller, tolerances: dict[str, Any], scope: str = "holdout") -> Validation:
    tol = {m["id"]: m for m in tolerances["metrics"]}
    metrics: dict[str, Metric] = {}

    def metric(mid: str, group: str, label: str) -> Metric:
        if mid not in metrics:
            t = tol[group]
            metrics[mid] = Metric(mid, group, label, float(t["tolerance"]), int(t["minN"]))
        return metrics[mid]

    v = Validation()
    oddities = {
        "kneel while trailing, final 2:00 of the game": [0, 0.0, 0.0],
        "spike on 4th down": [0, 0.0, 0.0],
    }
    cache: dict[tuple[Any, ...], dict[str, Any]] = {}
    sit_cols = ["phase", "down", "ydstogo", "yardline_100", "score_differential", "qtr",
                "half_seconds_remaining", "game_seconds_remaining", "offense_timeouts", "defense_timeouts"]
    cols = sit_cols + ["call", "try_call", "depth", "pass_type", "run_type", "formation", "rush",
                       "man_zone", "preset", "b_zone6", "b_time5", "b_score3"]
    for row in plays.select(cols).iter_rows(named=True):
        key = tuple(row[c] for c in sit_cols)
        pred = cache.get(key)
        if pred is None:
            sit = situation_of(row)
            labels = caller.labels(sit)
            leaves, trace = caller.offense(sit, labels)
            presets, dtrace, diag = caller.defense(sit, labels)
            pred = {"sit": sit, "labels": labels, "leaves": leaves, "trace": trace,
                    "presets": presets, "dtrace": dtrace, "diag": diag}
            if sit["phase"] == "scrimmage":
                pmap = {lf["call"]: lf["p"] for lf in leaves}
                plays_p = [pmap[pl_] for pl_ in FORMATION_PLAYS]
                tot = sum(plays_p)
                form = [0.0] * 5
                for i, play in enumerate(FORMATION_PLAYS):
                    lk = caller.formation(sit, play, labels)
                    for j in range(5):
                        form[j] += plays_p[i] * (lk.weights[j] / lk.total)
                pred["formation"] = [x / tot for x in form] if tot > 0 else [0.0] * 5
            cache[key] = pred
        for fid, lk in {**pred["trace"], **pred["dtrace"]}.items():
            name = fid.split(":")[0]
            v.backoff.setdefault(name, {}).setdefault(lk.level, 0)
            v.backoff[name][lk.level] += 1

        if row["phase"] == "try":
            if row["try_call"] is not None:
                p_two = 1.0 - pred["leaves"][0]["p"]
                metric("goForTwo", "goForTwo", "Go for two rate, all tries").add(p_two, row["try_call"] == "goForTwo")
            continue

        call = row["call"]
        if call is None:
            continue
        pmap = {lf["call"]: lf["p"] for lf in pred["leaves"]}
        p_pass = sum(pmap[c] for c in PASS_PLAYS)
        p_run = pmap["insideRun"] + pmap["outsideRun"] + pmap["qbSneak"]
        down = int(row["down"])
        metric("passRate", "passRate", "Pass rate, all scrimmage downs").add(p_pass, call == "pass")
        metric(f"passRateByDown.{down}", "passRateByDown", f"Pass rate, down {down}").add(p_pass, call == "pass")
        if down == 4:
            zone = row["b_zone6"]
            metric(f"fourthDown.{zone}.go", "fourthDown", f"4th down go, zone {zone}").add(
                p_run + p_pass, call in ("run", "pass"))
            metric(f"fourthDown.{zone}.punt", "fourthDown", f"4th down punt, zone {zone}").add(pmap["punt"], call == "punt")
            metric(f"fourthDown.{zone}.fieldGoal", "fourthDown", f"4th down field goal, zone {zone}").add(
                pmap["fieldGoal"], call == "fieldGoal")
            if pmap["spike"] > 0:
                o = oddities["spike on 4th down"]
                o[0] += 1
                o[1] += pmap["spike"]
                o[2] = max(o[2], pmap["spike"])
        t5 = row["b_time5"]
        if t5 in ("H1F", "GF"):
            half = "half" if t5 == "H1F" else "game"
            s3 = row["b_score3"]
            sname = {"T": "trailing", "0": "tied", "L": "leading"}[s3]
            metric(f"kneel.{t5}.{s3}", "kneel", f"Kneel, final 2:00 of the {half}, {sname}").add(pmap["kneel"], call == "kneel")
            metric(f"spike.{t5}", "spike", f"Spike, final 2:00 of the {half}").add(pmap["spike"], call == "spike")
            if t5 == "GF" and s3 == "T" and pmap["kneel"] > 0:
                o = oddities["kneel while trailing, final 2:00 of the game"]
                o[0] += 1
                o[1] += pmap["kneel"]
                o[2] = max(o[2], pmap["kneel"])

        if call == "pass":
            trace = pred["trace"]
            if row["pass_type"] is not None:
                pt = trace["oPassType"]
                metric("passType.screenPass", "passType", "Screen share of dropbacks").add(
                    pt.weights[0] / pt.total, row["pass_type"] == "screenPass")
                metric("passType.playAction", "passType", "Play action share of dropbacks").add(
                    pt.weights[1] / pt.total, row["pass_type"] == "playAction")
            if row["depth"] is not None:
                dp = trace["oDepth"]
                for i, (d, lbl) in enumerate((("shortPass", "Short"), ("intermediatePass", "Intermediate"), ("deepPass", "Deep"))):
                    metric(f"depth.{d}", "depth", f"{lbl} share of plain dropbacks").add(dp.weights[i] / dp.total, row["depth"] == d)
            if row["rush"] is not None:
                metric("blitz", "blitz", "Blitz rate (5+ rushers), dropbacks").add(pred["diag"]["blitz"], row["rush"] == "ge5")
        if call == "run" and row["run_type"] is not None:
            rn = pred["trace"]["oRun"]
            for i, (r, lbl) in enumerate((("insideRun", "Inside"), ("outsideRun", "Outside"), ("qbSneak", "QB sneak"))):
                metric(f"runType.{r}", "runType", f"{lbl} share of runs").add(rn.weights[i] / rn.total, row["run_type"] == r)
        if call in ("run", "pass"):
            if row["formation"] is not None:
                for i, (fm, lbl) in enumerate((("shotgun", "Shotgun"), ("underCenter", "Under center"), ("pistol", "Pistol"), ("empty", "Empty"), ("heavy", "Heavy"))):
                    metric(f"formation.{fm}", "formation", f"{lbl} share of run and pass plays").add(pred["formation"][i], row["formation"] == fm)
            if row["man_zone"] is not None:
                metric("man", "man", "Man share").add(pred["diag"]["man"], row["man_zone"] == "man")
            if row["preset"] is not None:
                for pr in pred["presets"]:
                    metric(f"preset.{pr['call']}", "preset", f"Preset {pr['call']}").add(pr["p"], row["preset"] == pr["call"])

    approved = _approved(tolerances, scope)
    for m in metrics.values():
        if m.n < m.min_n:
            m.status = "not gated"
            m.note = f"n below {m.min_n}"
        elif m.n == 0:
            m.status = "not gated"
        elif abs((m.predicted or 0.0) - (m.actual or 0.0)) * 100 <= m.tolerance + 1e-12:
            m.status = "pass"
        elif m.id in approved:
            m.status = "accepted"
            m.note = "known deviation approved by Joseph"
        else:
            m.status = "fail"
    order = [t["id"] for t in tolerances["metrics"]]
    v.metrics = sorted(metrics.values(), key=lambda m: (order.index(m.group), m.id))
    for m in v.metrics:
        if m.group == "fourthDown" and m.id.endswith(".go") and m.n:
            v.drift[m.id.split(".")[1]] = (m.predicted or 0.0, m.actual or 0.0)
    v.oddities = {k: {"situations": o[0], "mean": (o[1] / o[0] if o[0] else 0.0), "max": o[2]} for k, o in oddities.items()}
    return v


def summary(
    v: Validation,
    config_hash: str,
    tolerances_hash: str,
    seasons: list[int],
    code_hash: str = "",
    file_hashes: dict[str, str] | None = None,
    config_version: int | None = None,
) -> dict[str, Any]:
    def r(x: float | None) -> float | None:
        return None if x is None else round(x, 6)

    rows = []
    for m in v.metrics:
        ci = wilson(m.hits, m.n)
        rows.append({
            "id": m.id,
            "group": m.group,
            "label": m.label,
            "n": m.n,
            "predicted": r(m.predicted),
            "actual": r(m.actual),
            "ci95": None if ci is None else [r(ci[0]), r(ci[1])],
            "tolerance": m.tolerance,
            "minN": m.min_n,
            "status": m.status,
        })
    return {
        "generated": True,
        **({} if config_version is None else {"configVersion": config_version}),
        "configHash": config_hash,
        "tolerancesHash": tolerances_hash,
        # The code and the exact generated files this summary validated (sha256).
        "codeHash": code_hash,
        "fileHashes": dict(sorted((file_hashes or {}).items())),
        "validationSeasons": seasons,
        "passed": not v.gated_failures,
        "gatedFailures": [m.id for m in v.gated_failures],
        "metrics": rows,
    }
