"""Game-level aggregates of real regular-season games, for the step 5 calibration, with the
same metric ids and definitions the sim side computes (scripts/game/metrics.ts). Every
definition here is designed and listed in docs/MODEL.md (Calibration, full games).

Units: a metric is a mean over observations (team-games, games, drives or dead balls), a
standard deviation of one, or a share (0 to 1). Each observation carries its season's weight
(1 for the holdout, the fitting weight in-sample), so `n` is the effective n.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

import polars as pl

from pipeline.engine.load import fouls_of

POINT_BINS = [("0-9", 0, 9), ("10-16", 10, 16), ("17-23", 17, 23), ("24-30", 24, 30), ("31-37", 31, 37), ("38+", 38, 10_000)]
MARGIN_BINS = [("0", 0, 0), ("1-3", 1, 3), ("4-7", 4, 7), ("8-14", 8, 14), ("15-21", 15, 21), ("22+", 22, 10_000)]
DRIVE_KEYS = ["touchdown", "fieldGoal", "missedFieldGoal", "punt", "turnover", "downs", "endOfHalf", "safety"]
SCRIMMAGE_TYPES = ("run", "pass", "qb_kneel", "qb_spike")
DRIVE_SNAP_TYPES = ("run", "pass", "punt", "field_goal", "qb_kneel", "qb_spike", "no_play")
KICKOFF_RECEIVING = {"Offensive Holding", "Illegal Block Above the Waist", "Illegal Double-Team Block", "Defensive Holding"}
KICKOFF_KICKING = {"Illegal Formation"}


@dataclass
class Acc:
    kind: str  # mean, sd or share
    xs: list[tuple[float, float]] = field(default_factory=list)

    def add(self, x: float, w: float) -> None:
        self.xs.append((x, w))

    def result(self) -> dict[str, float]:
        sw = sum(w for _, w in self.xs)
        sw2 = sum(w * w for _, w in self.xs)
        n_eff = sw * sw / sw2 if sw2 > 0 else 0.0
        if sw == 0:
            return {"value": 0.0, "n": 0.0, "count": 0, "lo": 0.0, "hi": 0.0}
        mean = sum(x * w for x, w in self.xs) / sw
        var = sum(w * (x - mean) ** 2 for x, w in self.xs) / sw
        sd = math.sqrt(var)
        if self.kind == "sd":
            se = 1.96 / math.sqrt(max(1.0, 2 * (n_eff - 1)))
            return {"value": sd, "n": n_eff, "count": len(self.xs), "lo": sd * (1 - se), "hi": sd * (1 + se)}
        if self.kind == "share":
            z = 1.96
            c = (mean + z * z / (2 * n_eff)) / (1 + z * z / n_eff)
            h = z * math.sqrt(mean * (1 - mean) / n_eff + z * z / (4 * n_eff * n_eff)) / (1 + z * z / n_eff)
            return {"value": mean, "n": n_eff, "count": len(self.xs), "lo": c - h, "hi": c + h}
        h = 1.96 * sd / math.sqrt(n_eff) if n_eff > 0 else 0.0
        return {"value": mean, "n": n_eff, "count": len(self.xs), "lo": mean - h, "hi": mean + h}


def _f(v: Any) -> bool:
    return v is not None and float(v) == 1.0


def _mmss(t: Any) -> float | None:
    if t is None:
        return None
    try:
        m, s = str(t).split(":")
        return int(m) * 60 + int(s)
    except ValueError:
        return None


def supported_id(ptype: str, side: str, play_type: str | None, cfg: dict[str, Any]) -> str | None:
    """Rule set id of an enforced foul, or None when the rule set does not support it. Mirrors
    pipeline.engine.penalties.foul_id_expr; on kickoffs only the designed kickoff fouls count
    (receiving-team holding and illegal blocks as the return-team illegal block, kicking-team
    illegal formation), because the engine draws only those there."""
    pc = cfg["penalties"]
    if play_type == "kickoff":
        if side == "offense" and ptype in KICKOFF_RECEIVING:
            return "returnTeamIllegalBlock"
        if side == "defense" and ptype in KICKOFF_KICKING:
            return "kickoffIllegalFormation"
        return None
    pid = pc["mapping"].get(ptype)
    for p, split in pc["splitByPlay"].items():
        if pid == p:
            pid = split["noPlay"] if play_type == "no_play" else split["playStands"]
    fam = {"punt": "punt", "field_goal": "fieldGoal", "extra_point": "extraPoint"}.get(play_type or "", "scrimmage")
    rule = pc["byFamily"].get(ptype)
    if rule is not None and fam in rule["families"] and side == rule["side"]:
        pid = rule["id"]
    return None if pid in (None, "unsupported") else pid


GAME_COLS = ["season", "game_id", "play_id", "qtr", "down", "yardline_100", "posteam", "defteam", "home_team", "away_team", "location",
             "play_type", "is_try", "is_timeout", "timeout_team", "challenge", "onside", "two_point_attempt", "sack", "interception",
             "fumble_lost", "fumbled_1_team", "home_score", "away_score", "fixed_drive", "fixed_drive_result", "drive_time_of_possession", "fouls",
             "score_differential", "game_seconds_remaining"]

# Step 5a (D2) diagnostics, not gated: late 4th-down field goal rate and final-2:00 field goal
# attempts per game, by the offense's score.
LATE_GROUPS = (("trailing4-8", -8, -4), ("trailing1-3", -3, -1), ("tied", 0, 0), ("leading1-3", 1, 3), ("leading4-8", 4, 8))


def late_group(diff: float) -> str | None:
    return next((g for g, lo, hi in LATE_GROUPS if lo <= diff <= hi), None)


def game_metrics(rows: pl.DataFrame, cfg: dict[str, Any], engine_cfg: dict[str, Any], weights: dict[int, float],
                 exclude_home: set[int]) -> dict[str, dict[str, float]]:
    """Every game-level metric over the games in `rows`, weighted by season. Home-field metrics
    leave out neutral-site games and the seasons in `exclude_home`."""
    acc: dict[str, Acc] = {}

    def m(mid: str, kind: str) -> Acc:
        if mid not in acc:
            acc[mid] = Acc(kind)
        return acc[mid]

    drive_map = {v: k for k, vs in cfg["driveResults"].items() if k != "note" for v in vs}
    games: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows.select(GAME_COLS).iter_rows(named=True):
        games[r["game_id"]].append(r)
    for gid in sorted(games):
        g = games[gid]
        first = g[0]
        w = weights[first["season"]]
        home, away = first["home_team"], first["away_team"]
        hs, as_ = int(first["home_score"]), int(first["away_score"])
        margin = hs - as_
        neutral = first["location"] == "Neutral"
        for pts in (hs, as_):
            m("points.mean", "mean").add(pts, w)
            m("points.sd", "sd").add(pts, w)
            for lab, lo, hi in POINT_BINS:
                m(f"points.share.{lab}", "share").add(1.0 if lo <= pts <= hi else 0.0, w)
        m("total.mean", "mean").add(hs + as_, w)
        m("total.sd", "sd").add(hs + as_, w)
        m("margin.sd", "sd").add(margin, w)
        for lab, lo, hi in MARGIN_BINS:
            m(f"absMargin.share.{lab}", "share").add(1.0 if lo <= abs(margin) <= hi else 0.0, w)
        if not neutral and first["season"] not in exclude_home:
            m("homeMargin.mean", "mean").add(margin, w)
            m("homeWin.rate", "share").add(1.0 if margin > 0 else 0.5 if margin == 0 else 0.0, w)
        ot = any((r["qtr"] or 0) >= 5 for r in g)
        m("overtime.rate", "share").add(1.0 if ot else 0.0, w)
        m("tie.rate", "share").add(1.0 if margin == 0 else 0.0, w)
        per_team: dict[str, dict[str, float]] = {t: defaultdict(float) for t in (home, away)}
        cnt: dict[str, float] = defaultdict(float)
        drives: dict[Any, dict[str, Any]] = {}
        final_fga: dict[str, float] = defaultdict(float)
        for r in g:
            pt = r["play_type"]
            pos = r["posteam"]
            if pt in ("run", "pass", "punt", "field_goal") and r["down"] == 4 and r["qtr"] == 4 and not r["is_try"] \
                    and (r["game_seconds_remaining"] or 9999) <= 300 and (r["yardline_100"] or 99) <= 37:
                lg = late_group(r["score_differential"] or 0)
                if lg is not None:
                    m(f"diag.late4thFieldGoal.{lg}", "share").add(1.0 if pt == "field_goal" else 0.0, w)
            if pt == "field_goal" and r["qtr"] == 4 and (r["game_seconds_remaining"] or 9999) <= 120:
                lg = late_group(r["score_differential"] or 0)
                if lg is not None:
                    final_fga[lg] += 1
            if r["is_timeout"] and not r["challenge"] and r["timeout_team"] in per_team:
                per_team[r["timeout_team"]]["timeouts"] += 1
            for ptype, side, status, yards in fouls_of(r["fouls"] or [], pos, r["defteam"]):
                if status != "enforced":
                    continue
                cnt["pen.all"] += 1
                cnt["penYds.all"] += yards
                if supported_id(ptype, side, pt, engine_cfg) is not None:
                    cnt["pen.sup"] += 1
                    cnt["penYds.sup"] += yards
            if pt == "kickoff" and r["onside"]:
                cnt["onside"] += 1
            if pt is None or pos not in per_team:
                continue
            if r["is_try"]:
                if _f(r["two_point_attempt"]) and pt in ("run", "pass"):
                    cnt["twoPoint"] += 1
                continue
            if pt in SCRIMMAGE_TYPES and r["down"] is not None:
                cnt["scrimmage"] += 1
                if r["down"] == 4 and pt in ("run", "pass"):
                    cnt["go4"] += 1
                if pt == "pass" and _f(r["sack"]):
                    per_team[pos]["sacks"] += 1
                if pt == "pass" and _f(r["interception"]):
                    per_team[pos]["ints"] += 1
                if pt in ("run", "pass") and _f(r["fumble_lost"]) and r["fumbled_1_team"] == pos:
                    per_team[pos]["fumbles"] += 1
            if pt == "punt":
                cnt["punts"] += 1
            if pt == "field_goal":
                cnt["fga"] += 1
            if pt in DRIVE_SNAP_TYPES and r["down"] is not None and r["fixed_drive"] is not None:
                key = r["fixed_drive"]
                if key not in drives:
                    drives[key] = {"team": pos, "start": 100 - (r["yardline_100"] or 0), "result": r["fixed_drive_result"],
                                   "top": _mmss(r["drive_time_of_possession"])}
        for lg, _, _ in LATE_GROUPS:
            m(f"diag.final2FieldGoalAttempts.{lg}", "mean").add(final_fga[lg], w)
        m("scrimmagePlays.perGame", "mean").add(cnt["scrimmage"], w)
        m("penalties.supported.perGame", "mean").add(cnt["pen.sup"], w)
        m("penaltyYards.supported.perGame", "mean").add(cnt["penYds.sup"], w)
        m("penalties.all.perGame", "mean").add(cnt["pen.all"], w)
        m("penaltyYards.all.perGame", "mean").add(cnt["penYds.all"], w)
        m("fourthDownGo.perGame", "mean").add(cnt["go4"], w)
        m("punts.perGame", "mean").add(cnt["punts"], w)
        m("fieldGoalAttempts.perGame", "mean").add(cnt["fga"], w)
        m("twoPointTries.perGame", "mean").add(cnt["twoPoint"], w)
        m("onside.perGame", "mean").add(cnt["onside"], w)
        top: dict[str, float] = defaultdict(float)
        nd: dict[str, int] = defaultdict(int)
        for d in drives.values():
            if d["team"] not in per_team:
                continue
            nd[d["team"]] += 1
            m("driveStart.mean", "mean").add(d["start"], w)
            res = drive_map.get(d["result"])
            if res is not None:
                for k in DRIVE_KEYS:
                    m(f"driveResult.share.{k}", "share").add(1.0 if k == res else 0.0, w)
            if d["top"] is not None:
                top[d["team"]] += d["top"]
                m("driveDuration.mean", "mean").add(d["top"], w)
        for t in (home, away):
            pt_ = per_team[t]
            m("drives.perTeamGame", "mean").add(nd[t], w)
            m("turnovers.perTeamGame", "mean").add(pt_["ints"] + pt_["fumbles"], w)
            m("interceptions.perTeamGame", "mean").add(pt_["ints"], w)
            m("fumblesLost.perTeamGame", "mean").add(pt_["fumbles"], w)
            m("sacks.perTeamGame", "mean").add(pt_["sacks"], w)
            m("timeouts.perTeamGame", "mean").add(pt_["timeouts"], w)
            m("top.sd", "sd").add(top[t], w)
        if margin != 0:
            winner = home if margin > 0 else away
            m("top.winnerMean", "mean").add(top[winner], w)
    return {k: v.result() for k, v in sorted(acc.items())}


def home_field_targets(rows: pl.DataFrame, engine_cfg: dict[str, Any], weights: dict[int, float], exclude: set[int]) -> dict[str, float]:
    """Training targets for the designed home field: the season-weighted share of offensive
    pre-snap fouls (false start, delay of game) per snap by the home and the away offense,
    non-neutral games outside `exclude`."""
    snaps = {"home": 0.0, "away": 0.0}
    fouls = {"home": 0.0, "away": 0.0}
    pre = {"falseStart", "delayOfGame"}
    for r in rows.select("season", "home_team", "location", "posteam", "defteam", "play_type", "down", "is_try", "fouls").iter_rows(named=True):
        if r["location"] == "Neutral" or r["season"] in exclude or r["posteam"] is None or r["is_try"] or r["down"] is None:
            continue
        if r["play_type"] not in ("run", "pass", "punt", "field_goal", "qb_kneel", "qb_spike", "no_play"):
            continue
        side = "home" if r["posteam"] == r["home_team"] else "away"
        w = weights[r["season"]]
        snaps[side] += w
        for ptype, fside, _status, _y in fouls_of(r["fouls"] or [], r["posteam"], r["defteam"]):
            if fside == "offense" and supported_id(ptype, fside, r["play_type"], engine_cfg) in pre:
                fouls[side] += w
                break
    rh, ra = fouls["home"] / snaps["home"], fouls["away"] / snaps["away"]
    return {"homeOffensePreSnapRate": rh, "awayOffensePreSnapRate": ra, "crowdNoise": (ra - rh) / (ra + rh)}
