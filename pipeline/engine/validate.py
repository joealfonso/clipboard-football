"""Component validation of the play engine against real plays (no full game).

For every real play in scope, the TypeScript engine (scripts/engine/validate.ts, run with Node)
resolves the real situation with the real offense leaf (step 2 mapping; formation real when
known, else drawn from the step 2 caller), a defensive preset drawn from the step 2 defense
caller's shares, and generated league-average teams, K times with a fixed seed. Predicted =
mean over those resolutions; actual = what happened. Penalty rates use the engine's exact
foul probabilities per snap (detail.foulRates), averaged over the K resolutions.

Tolerances are pre-registered in data/engine/tolerances.json and never changed after a run.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import polars as pl

from pipeline.caller.validate import wilson

PASS_LEAVES = ("shortPass", "intermediatePass", "deepPass", "screenPass", "playAction")
RUN_LEAVES = ("insideRun", "outsideRun", "qbSneak")
ATTEMPT_EXCLUDES = ("sack", "scramble")
COMPLETIONS = ("fumbleCatch", "c0", "c1_9", "c10_19", "c20")
PUNT_RETURNS = ("returnedShort", "returnedLong", "returnTD")
PUNT_FAIR = ("fairCatchShort", "fairCatchLong")
UNREGISTERED = "check (no pre-registered tolerance)"


@dataclass
class Metric:
    id: str
    group: str
    label: str
    unit: str
    tolerance: float
    min_n: int
    kind: str
    n: float = 0.0
    plays: int = 0
    w2: float = 0.0
    pred: float = 0.0
    act: float = 0.0
    hits: float = 0.0
    sq: float = 0.0
    status: str = ""
    note: str = ""

    def add(self, predicted: float, actual: float, w: float = 1.0) -> None:
        self.n += w
        self.plays += 1
        self.w2 += w * w
        self.pred += w * predicted
        self.act += w * actual
        self.sq += w * actual * actual

    @property
    def predicted(self) -> float | None:
        return self.pred / self.n if self.n else None

    @property
    def actual(self) -> float | None:
        return self.act / self.n if self.n else None

    @property
    def n_eff(self) -> float:
        """Effective sample size of the weighted actual, (sum w)^2 / sum w^2 (Kish)."""
        return self.n * self.n / self.w2 if self.w2 else 0.0

    def ci(self) -> tuple[float, float] | None:
        """95% interval of the actual value, on the effective n (not the weighted n)."""
        if not self.n:
            return None
        ne = self.n_eff
        mean = self.act / self.n
        if self.unit == "pp":
            return wilson(int(round(mean * ne)), int(round(ne)))
        var = max(0.0, self.sq / self.n - mean * mean)
        half = 1.959963984540054 * math.sqrt(var / ne)
        return (mean - half, mean + half)

    def diff(self) -> float:
        d = (self.predicted or 0.0) - (self.actual or 0.0)
        return d * 100 if self.unit == "pp" else d


@dataclass
class Validation:
    label: str
    metrics: dict[str, Metric] = field(default_factory=dict)

    @property
    def gated_failures(self) -> list[Metric]:
        return [m for m in self.metrics.values() if m.status == "fail"]


def _sit(row: dict[str, Any], phase: str) -> dict[str, Any]:
    q = int(row["qtr"])
    clock = int(row["game_seconds_remaining"] - (4 - q) * 900) if q <= 4 else int(row["game_seconds_remaining"])
    return {
        "phase": phase,
        "q": q,
        "clock": max(0, clock),
        "spot": int(100 - row["yardline_100"]),
        "down": int(row["down"]) if row["down"] is not None else 0,
        "dist": int(row["ydstogo"]) if row["ydstogo"] is not None else 0,
        "diff": int(row["score_differential"]) if row["score_differential"] is not None else 0,
        "ot": int(row["offense_timeouts"]) if row["offense_timeouts"] is not None else 3,
        "dt": int(row["defense_timeouts"]) if row["defense_timeouts"] is not None else 3,
    }


SIT_COLS = ["qtr", "game_seconds_remaining", "yardline_100", "down", "ydstogo", "score_differential", "offense_timeouts", "defense_timeouts"]


def requests(
    plays: pl.DataFrame, snaps: pl.DataFrame, kickoffs: pl.DataFrame | None, pass_share: float, season_weights: dict[int, float] | None = None
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Engine requests, and for each its metadata for scoring (actual outcome, weight). With
    `season_weights` (the in-sample run) each scrimmage play also carries its season's fitting
    weight, so the in-sample comparison weights seasons the way the tables were fitted."""
    reqs: list[dict[str, Any]] = []
    meta: list[dict[str, Any]] = []

    def push(req: dict[str, Any], m: dict[str, Any]) -> None:
        req["i"] = len(reqs)
        reqs.append(req)
        meta.append(m)

    scrim = plays.filter(
        (pl.col("phase") == "scrimmage") & pl.col("family").is_not_null() & pl.col("leaf").is_not_null() & pl.col("cls").is_not_null()
        & ~pl.col("has_accepted_foul").fill_null(False)
    )
    for r in scrim.select(*SIT_COLS, "leaf", "formation", "family", "cls", "y", "flags", "frac", "season").iter_rows(named=True):
        sw = 1.0 if season_weights is None else season_weights[r["season"]]
        push({"t": "scrim", **_sit(r, "scrimmage"), "call": r["leaf"], "formation": r["formation"]},
             {"leaf": r["leaf"], "family": r["family"], "cls": r["cls"], "y": r["y"], "lost": int((r["flags"] or 0) & 8 != 0), "w": r["frac"] * sw})
    fg = plays.filter((pl.col("call") == "fieldGoal") & ~pl.col("has_accepted_foul").fill_null(False) & pl.col("kick_distance").is_not_null())
    for r in fg.select(*SIT_COLS, "kick_distance", "field_goal_result").iter_rows(named=True):
        push({"t": "fg", **_sit(r, "scrimmage"), "call": "fieldGoal", "formation": None},
             {"dist": int(r["kick_distance"]), "good": r["field_goal_result"] == "made"})
    xp = plays.filter((pl.col("phase") == "try") & (pl.col("extra_point_attempt") == 1) & ~pl.col("has_accepted_foul").fill_null(False)
                      & pl.col("extra_point_result").is_in(["good", "failed", "blocked"]))
    for r in xp.select(*SIT_COLS, "extra_point_result").iter_rows(named=True):
        req = {"t": "xp", **_sit(r, "try"), "call": "extraPoint", "formation": None}
        req["spot"] = 98
        push(req, {"good": r["extra_point_result"] == "good"})
    tp = plays.filter((pl.col("phase") == "try") & (pl.col("try_call") == "goForTwo") & pl.col("leaf").is_not_null()
                      & ~pl.col("has_accepted_foul").fill_null(False) & pl.col("two_point_conv_result").is_not_null())
    for r in tp.select(*SIT_COLS, "leaf", "formation", "two_point_conv_result", "frac").iter_rows(named=True):
        req = {"t": "tp", **_sit(r, "try"), "call": "goForTwo", "two": r["leaf"], "formation": r["formation"]}
        req["spot"] = 98
        push(req, {"good": r["two_point_conv_result"] == "success", "w": r["frac"]})
    pu = plays.filter((pl.col("call") == "punt") & ~pl.col("has_accepted_foul").fill_null(False))
    for r in pu.select(*SIT_COLS, "kick_distance", "return_yards", "touchback", "punt_fair_catch", "punt_blocked", "pcls").iter_rows(named=True):
        gross = 0 if (r["punt_blocked"] or 0) == 1 else int(r["kick_distance"] or 0)
        push({"t": "punt", **_sit(r, "scrimmage"), "call": "punt", "formation": None},
             {"gross": gross, "ret": int(r["return_yards"] or 0), "cls": r["pcls"]})
    # Penalties: every snap. A pre-snap row whose family is unknown is split between run and pass.
    for r in snaps.filter(pl.col("snap")).select(*[c for c in SIT_COLS if c in snaps.columns], "pfamily", "season", "snap_id").iter_rows(named=True):
        fam = r["pfamily"]
        targets = {"run": [("insideRun", 1.0)], "pass": [("shortPass", 1.0)], "scrimmage": [("shortPass", pass_share), ("insideRun", 1 - pass_share)],
                   "punt": [("punt", 1.0)], "fieldGoal": [("fieldGoal", 1.0)], "extraPoint": [("extraPoint", 1.0)],
                   "kneel": [("kneel", 1.0)], "spike": [("spike", 1.0)], "twoPoint": [("goForTwo", 1.0)]}[fam]
        for call, w in targets:
            phase = "try" if call in ("extraPoint", "goForTwo") else "scrimmage"
            sit = _sit({**r, "down": r["down"] if phase == "scrimmage" and r["down"] is not None else (1 if phase == "scrimmage" else None),
                        "ydstogo": r["ydstogo"] if phase == "scrimmage" and r["ydstogo"] is not None and r["ydstogo"] > 0 else 10}, phase)
            if phase == "try":
                sit["spot"] = 98
            sit["spot"] = min(99, max(1, sit["spot"]))
            if phase == "scrimmage":
                sit["dist"] = max(1, min(sit["dist"], 100 - sit["spot"]))
            sw = 1.0 if season_weights is None else season_weights[r["season"]]
            push({"t": "pen", **sit, "call": call, "formation": "shotgun" if call in ("shortPass", "insideRun") else None, "two": "shortPass"},
                 {"key": (r["season"], r["snap_id"]), "w": w, "sw": sw})
    if kickoffs is not None:
        for r in kickoffs.filter(~pl.col("onside")).iter_rows(named=True):
            push({"t": "ko", "phase": "kickoff", "q": 1, "clock": 900, "spot": 35, "down": 0, "dist": 0, "diff": 0, "ot": 3, "dt": 3, "call": "kickoff", "formation": None}, dict(r))
    return reqs, meta


def run_engine(reqs: list[dict[str, Any]], root: Path, seed: int, k: int, teams: str | None = None) -> list[dict[str, Any]]:
    """`teams`: None for the pre-registered run, else a team seed or "flat" (sensitivity checks)."""
    with tempfile.TemporaryDirectory() as tmp:
        inp = Path(tmp) / "in.jsonl"
        out = Path(tmp) / "out.jsonl"
        inp.write_text("".join(json.dumps(r, separators=(",", ":")) + "\n" for r in reqs), encoding="utf-8")
        cmd = ["node", "--import", "./scripts/engine/register.mjs", "scripts/engine/validate.ts", str(inp), str(out), str(seed), str(k), *([] if teams is None else [teams])]
        subprocess.run(cmd, cwd=root, check=True, env={**os.environ, "NODE_NO_WARNINGS": "1"})
        lines = out.read_text(encoding="utf-8").splitlines()
    res = [json.loads(line) for line in lines if line]
    if len(res) != len(reqs):
        raise RuntimeError(f"engine returned {len(res)} results for {len(reqs)} requests")
    return res


def score(label: str, reqs: list[dict[str, Any]], meta: list[dict[str, Any]], res: list[dict[str, Any]], snaps: pl.DataFrame,
          tolerances: dict[str, Any], rules_ids: list[str], families: dict[str, Any], punt_classes: list[str], kickoff_classes: list[str],
          fg_bands: list[dict[str, Any]], include_kickoff: bool) -> Validation:
    tol = {m["id"]: m for m in tolerances["metrics"]}
    v = Validation(label)

    def metric(mid: str, group: str, lbl: str) -> Metric:
        if mid not in v.metrics:
            t = tol.get(group)
            if t is None:
                # A check added after the tolerances were pre-registered: reported, never gated.
                v.metrics[mid] = Metric(mid, group, lbl, "pp", 0.0, 0, UNREGISTERED)
            else:
                v.metrics[mid] = Metric(mid, group, lbl, t["unit"], float(t["tolerance"]), int(t["minN"]), t["kind"])
        return v.metrics[mid]

    classes = {leaf: f["classes"] for f in families.values() for leaf in f["leaves"]}
    pen_pred: dict[tuple[int, int], dict[str, float]] = {}
    pen_w: dict[tuple[int, int], float] = {}
    for req, m, r in zip(reqs, meta, res):
        t = req["t"]
        if t == "scrim":
            sims = [x for x in r["r"] if x is not None]
            if not sims:
                continue
            w = m["w"]
            leaf, fam, cls, y = m["leaf"], m["family"], m["cls"], m["y"]
            ps = {c: sum(1 for s in sims if s[0] == c) / len(sims) for c in classes[leaf]}
            py = sum(s[1] for s in sims) / len(sims)
            metric(f"meanYards.{leaf}", "meanYards", f"Mean yards, {leaf}").add(py, y, w)
            for c in classes[leaf]:
                metric(f"classShare.{leaf}.{c}", "classShare", f"{leaf}: {c} share").add(ps[c], 1.0 if cls == c else 0.0, w)
            big = sum(1 for s in sims if s[1] >= 20) / len(sims)
            metric(f"bigPlay.{fam}", "bigPlay", f"20+ yard rate, {'runs' if fam == 'run' else 'dropbacks'}").add(big, 1.0 if y >= 20 else 0.0, w)
            if fam == "run":
                metric("fumble.run", "fumble", "Fumble rate, runs").add(ps["fumble"], 1.0 if cls == "fumble" else 0.0, w)
                lost = sum(s[2] for s in sims) / len(sims)
                metric("fumbleLost.run", "fumble", "Fumble lost rate, runs").add(lost, float(m["lost"]), w)
                continue
            metric("sackRate", "sackRate", "Sack rate, dropbacks").add(ps["sack"], 1.0 if cls == "sack" else 0.0, w)
            att = [s for s in sims if s[0] not in ATTEMPT_EXCLUDES]
            if cls not in ATTEMPT_EXCLUDES and att:
                comp = sum(1 for s in att if s[0] in COMPLETIONS) / len(att)
                hit = 1.0 if cls in COMPLETIONS else 0.0
                metric("completion.all", "completion", "Completion rate, all attempts").add(comp, hit, w)
                metric(f"completion.{leaf}", "completion", f"Completion rate, {leaf}").add(comp, hit, w)
                metric("intRate", "intRate", "Interception rate, attempts").add(sum(1 for s in att if s[0] == "int") / len(att), 1.0 if cls == "int" else 0.0, w)
            comps = [s for s in sims if s[0] in COMPLETIONS]
            if cls in COMPLETIONS and comps:
                metric("fumble.completion", "fumble", "Fumble rate, completions").add(sum(1 for s in comps if s[0] == "fumbleCatch") / len(comps), 1.0 if cls == "fumbleCatch" else 0.0, w)
                metric("fumbleLost.completion", "fumble", "Fumble lost rate, completions").add(sum(s[2] for s in comps) / len(comps), float(m["lost"]), w)
        elif t == "fg":
            sims = [x for x in r["r"] if x is not None]
            if not sims:
                continue
            band = next(b["label"] for b in fg_bands if b["min"] <= m["dist"] <= b["max"])
            metric(f"fieldGoal.{band}", f"fieldGoal.{band}", f"Field goal make rate, {band}").add(sum(1 for s in sims if s == "good") / len(sims), 1.0 if m["good"] else 0.0)
        elif t == "xp":
            sims = [x for x in r["r"] if x is not None]
            if sims:
                metric("extraPoint", "extraPoint", "Extra point success").add(sum(1 for s in sims if s == "good") / len(sims), 1.0 if m["good"] else 0.0)
        elif t == "tp":
            sims = [x for x in r["r"] if x is not None]
            if sims:
                metric("twoPoint", "twoPoint", "Two-point success").add(sum(sims) / len(sims), 1.0 if m["good"] else 0.0, m["w"])
        elif t == "punt":
            sims = [x for x in r["r"] if x is not None]
            if not sims:
                continue
            pc = [punt_classes[s[0]] for s in sims]
            gross = sum(s[1] for s in sims) / len(sims)
            net = sum(s[1] - (s[2] if punt_classes[s[0]] in PUNT_RETURNS else 0) - (20 if punt_classes[s[0]] == "touchback" else 0) for s in sims) / len(sims)
            acls = m["cls"]
            a_net = m["gross"] - (m["ret"] if acls in PUNT_RETURNS else 0) - (20 if acls == "touchback" else 0)
            metric("puntGross", "puntGross", "Punt gross yards").add(gross, m["gross"])
            metric("puntNet", "puntNet", "Punt net yards").add(net, a_net)
            metric("punt.touchback", "puntRate", "Punt touchback rate").add(pc.count("touchback") / len(pc), 1.0 if acls == "touchback" else 0.0)
            metric("punt.fairCatch", "puntRate", "Punt fair catch rate").add(sum(1 for c in pc if c in PUNT_FAIR) / len(pc), 1.0 if acls in PUNT_FAIR else 0.0)
            metric("punt.return", "puntRate", "Punt return rate").add(sum(1 for c in pc if c in PUNT_RETURNS) / len(pc), 1.0 if acls in PUNT_RETURNS else 0.0)
        elif t == "pen":
            acc = pen_pred.setdefault(m["key"], {})
            pen_w[m["key"]] = m.get("sw", 1.0)
            for pid, rate in r["rates"].items():
                acc[pid] = acc.get(pid, 0.0) + m["w"] * rate
        elif t == "ko" and include_kickoff:
            sims = r["r"]
            kc = [kickoff_classes[s[0]] for s in sims]
            starts = [s[1] for s in sims if s[1] is not None]
            tb = sum(1 for c in kc if c.startswith("touchback")) / len(kc)
            ret = sum(1 for c in kc if c in ("returned", "returnTD")) / len(kc)
            oob = kc.count("outOfBounds") / len(kc)
            metric("kickoff.touchback", "kickoffRate", "Kickoff touchback rate (2025, tuning)").add(tb, 1.0 if m["touchback"] else 0.0)
            metric("kickoff.return", "kickoffRate", "Kickoff return rate (2025, tuning)").add(ret, 1.0 if m["returned"] else 0.0)
            metric("kickoff.outOfBounds", "kickoffRate", "Kickoff out-of-bounds rate (2025, tuning)").add(oob, 1.0 if m["out_of_bounds"] else 0.0)
            if starts and m["start"] is not None:
                metric("kickoff.meanStart", "kickoffStart", "Kickoff mean start (2025, tuning)").add(sum(starts) / len(starts), float(m["start"]))
    # Penalties: actual fouls per snap of each id.
    if pen_pred:
        act: dict[tuple[int, int], dict[str, int]] = {}
        for season, sid, pid in snaps.filter(pl.col("pid").is_not_null() & (pl.col("pid") != "unsupported")).select("season", "snap_id", "pid").iter_rows():
            d = act.setdefault((season, sid), {})
            d[pid] = d.get(pid, 0) + 1
        sides: dict[tuple[int, int], set[str]] = {}
        for season, sid, side in snaps.filter(pl.col("pid").is_not_null() & (pl.col("pid") != "unsupported")).select("season", "snap_id", "side").iter_rows():
            sides.setdefault((season, sid), set()).add(side or "unknown")
        for key, pred in pen_pred.items():
            a = act.get(key, {})
            sw = pen_w.get(key, 1.0)
            for pid in rules_ids:
                metric(f"penalty.{pid}", "penalty", f"Penalty rate per snap, {pid}").add(pred.get(pid, 0.0), float(a.get(pid, 0)), sw)
            n_act = sum(a.values())
            sd = sides.get(key, set())
            metric("flags.any", "penaltyFlags", "Snaps with at least one supported flag").add(pred.get("anyFlag", 0.0), 1.0 if n_act >= 1 else 0.0, sw)
            metric("flags.bothTeams", "penaltyFlags", "Snaps with supported flags on both teams").add(pred.get("twoFlags", 0.0), 1.0 if {"offense", "defense"} <= sd else 0.0, sw)
            metric("flags.twoOrMore", "penaltyFlags", "Snaps with two or more supported flags").add(pred.get("twoFlags", 0.0), 1.0 if n_act >= 2 else 0.0, sw)
    approved = {d["metric"] for d in tolerances.get("known_deviations", []) if d.get("approved_by") == "Joseph"}
    for m in v.metrics.values():
        if m.kind == UNREGISTERED:
            m.status, m.note = "not gated", "no pre-registered tolerance"
        elif m.n < m.min_n:
            m.status, m.note = "not gated", f"n below {m.min_n}"
        elif abs(m.diff()) <= m.tolerance + 1e-12:
            m.status = "pass"
        elif m.id in approved:
            m.status, m.note = "accepted", "known deviation approved by Joseph"
        else:
            m.status = "fail"
    return v


def summary(v: Validation, hashes: dict[str, str], seasons: list[int]) -> dict[str, Any]:
    def r6(x: float | None) -> float | None:
        return None if x is None else round(x, 6)

    rows = []
    for m in v.metrics.values():
        ci = m.ci()
        rows.append({
            "id": m.id, "group": m.group, "label": m.label, "unit": m.unit, "kind": m.kind, "n": round(m.n, 3),
            "plays": m.plays, "nEff": round(m.n_eff, 1),
            "predicted": r6(m.predicted), "actual": r6(m.actual), "ci95": None if ci is None else [r6(ci[0]), r6(ci[1])],
            "tolerance": m.tolerance, "minN": m.min_n, "status": m.status,
        })
    return {
        "generated": True,
        **hashes,
        "validationSeasons": seasons,
        "passed": not v.gated_failures,
        "gatedFailures": [m.id for m in v.gated_failures],
        "metrics": rows,
    }
