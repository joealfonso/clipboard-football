"""The fitted coach decisions of M1 step 5: pre-snap run-off (tempo), timeouts and onside kicks.

Everything that decides what is fitted is designed (data/game/config.json): the dead-ball
reading of pbp, the clock-running rule, the bins, the backoff levels and minimum counts. The
numbers in the cells are fitted, season-weighted, from 2016-2023 (tempo 2022-2023, the seasons
with play timestamps). The share functions here are mirrored exactly by
packages/sim/src/game/coach.ts; data/game/golden.json pins the two together.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

import polars as pl

KICK_TYPES = ("kickoff", "extra_point", "punt", "field_goal")
SNAP_TYPES = ("run", "pass", "punt", "field_goal", "qb_kneel", "qb_spike")
PER_MILLION = 1_000_000


class HoldoutLeak(Exception):
    pass


def check_holdout(seasons: set[int], never_from: int) -> None:
    if seasons and max(seasons) >= never_from:
        raise HoldoutLeak(f"season {max(seasons)} reached a coach decision fit")


# ---------------------------------------------------------------- bins (mirrored in TS)


def _cond(view: dict[str, float], c: dict[str, Any]) -> bool:
    v = view[c["field"]]
    return ("min" not in c or v >= c["min"]) and ("max" not in c or v <= c["max"])


def label_of(view: dict[str, float], dim: dict[str, Any], name: str) -> str | None:
    """A bucket whose label is null means the dimension does not apply (step 5b): a level using
    it is skipped, in fitting and in lookup."""
    if "exact" in dim:
        v = view[dim["exact"]]
        return str(int(v))
    for b in dim["buckets"]:
        if all(_cond(view, c) for c in b["if"]):
            return b["label"]
    raise ValueError(f"{name}: no bucket for {view}")


def labels_of(view: dict[str, float], dims: dict[str, Any], levels: list[dict[str, Any]]) -> dict[str, str | None]:
    """Labels for the dimensions a table's levels use (context dimensions such as side excepted)."""
    names = sorted({d for lv in levels for d in lv["dims"] if d in dims})
    return {name: label_of(view, dims[name], name) for name in names}


def level_key(level: dict[str, Any], labels: dict[str, str | None], context: dict[str, str] | None = None) -> str | None:
    """None when a dimension of the level does not apply (null label)."""
    ctx = context or {}
    parts = [ctx[d] if d in ctx else labels[d] for d in level["dims"]]
    return None if any(p is None for p in parts) else "|".join(parts)  # type: ignore[arg-type]


# ---------------------------------------------------------------- reading pbp


def window(qtr: int, half_sec: float, game_sec: float) -> bool:
    """Rule 4-3-2 snap-start windows, as the 2026 rule set has them (last 2:00 of the 2nd
    quarter, last 5:00 of the 4th and of overtime)."""
    return (qtr == 2 and half_sec <= 120) or (qtr >= 4 and game_sec <= 300)


def crossed_warning(prev: dict[str, Any], cur: dict[str, Any]) -> bool:
    """pbp has no two-minute-warning row, so the warning is read from the clock: the previous
    play started before 2:00 of the 2nd or 4th quarter and this snap comes after it."""
    return cur["qtr"] in (2, 4) and prev["qtr"] == cur["qtr"] and (prev["half_seconds_remaining"] or 0) > 120 >= (cur["half_seconds_remaining"] or 0)


def clock_running(prev: dict[str, Any] | None, cur: dict[str, Any], two_min: bool) -> int:
    """Designed reading of whether the game clock ran before this snap, from the previous play."""
    if prev is None or prev["qtr"] != cur["qtr"] or two_min or crossed_warning(prev, cur):
        return 0
    if prev["play_type"] in KICK_TYPES or prev["is_try"] or prev["posteam"] != cur["posteam"]:
        return 0
    f = lambda c: (prev[c] or 0) == 1  # noqa: E731
    if f("incomplete_pass") or f("qb_spike") or f("interception") or f("fumble_lost"):
        return 0
    win = window(int(prev["qtr"]), prev["half_seconds_remaining"] or 0, prev["game_seconds_remaining"] or 0)
    if f("penalty") or f("out_of_bounds"):
        return 0 if win else 1
    return 1


@dataclass
class DeadBalls:
    snaps: list[dict[str, Any]] = field(default_factory=list)
    # Dead balls before a try or a kickoff: (season, role, called, own timeouts left before).
    special: list[tuple[int, str, int, int]] = field(default_factory=list)
    kickoffs: list[dict[str, Any]] = field(default_factory=list)
    timeouts_before_try: int = 0
    timeouts_before_kickoff: int = 0
    challenge_timeouts: int = 0
    timeouts_after_warning: int = 0
    team_games: int = 0
    # Step 5c: (season, quarter, "kickoff" or "try", timeouts called in the dead ball before it).
    special_timeouts: list[tuple[int, int, str, int]] = field(default_factory=list)
    # Step 5c milestone D: the kick view (kick_view fields) of each `special` entry, same order.
    special_views: list[dict[str, Any]] = field(default_factory=list)


ROW_COLS = ["season", "game_id", "qtr", "down", "ydstogo", "yardline_100", "game_seconds_remaining", "half_seconds_remaining",
            "posteam", "defteam", "play_type", "timeout_team", "is_timeout", "challenge", "two_min", "is_try", "incomplete_pass",
            "qb_spike", "qb_kneel", "interception", "fumble_lost", "penalty", "out_of_bounds", "score_differential",
            "posteam_timeouts_remaining", "defteam_timeouts_remaining", "duration", "onside"]
# Read when present (step 5c revision 1); hand-made frames without them keep row order.
CLOCK_COLS = ["quarter_seconds_remaining", "timeout_clock", "tod"]
# Read when present (step 5d milestone A): each snap carries its play_id, so the caller pipeline
# can take the same clock reading per play (pipeline/caller/load.py).
ID_COLS = ["play_id"]


def _precedes(t: dict[str, Any], p: dict[str, Any], n: dict[str, Any] | None) -> bool:
    """Whether timeout row `t`, listed after play `p` (and before play `n`), was really called in
    the dead ball before `p`. Designed, step 5c revision 1. A team timeout stops the clock until
    the next snap, so it carries the game clock of the snap it precedes. In 2022-2023 nflverse
    often lists it after that snap (96% of final-2:00 timeout dead balls with a 35 s gap or more),
    so row order put it one dead ball late. The game-clock stamp decides when it can: equal to
    p's snap clock and not to n's means before p; equal to n's means before n. When the two
    clocks agree (a play that used no clock) or the stamp matches neither, the wall-clock time
    of day decides where both rows have one. Otherwise row order stands."""
    if p.get("qtr") != t.get("qtr"):
        return False
    tc = t.get("timeout_clock")
    pc = p.get("quarter_seconds_remaining")
    nc = n.get("quarter_seconds_remaining") if n is not None and n.get("qtr") == t.get("qtr") else None
    if tc is not None and pc is not None:
        if int(tc) == int(pc) and (nc is None or int(nc) != int(tc)):
            return True
        if nc is not None and int(nc) == int(tc) and int(pc) != int(tc):
            return False
    tt, pt = t.get("tod"), p.get("tod")
    return tt is not None and pt is not None and tt < pt


def clock_order(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rows in play order, except that a timeout row is moved before the play it was called
    before (`_precedes`). Every other row keeps its place."""
    out: list[dict[str, Any]] = []
    i = 0
    while i < len(rows):
        game = rows[i]["game_id"]
        j = i
        while j < len(rows) and rows[j]["game_id"] == game:
            j += 1
        g = rows[i:j]
        res: list[dict[str, Any]] = []
        last = -1  # index in res of the last play row (a row with a play type that is not a timeout)
        for k, r in enumerate(g):
            if r["is_timeout"]:
                n = next((x for x in g[k + 1:] if x["play_type"] is not None and not x["is_timeout"]), None)
                if last >= 0 and _precedes(r, res[last], n):
                    res.insert(last, r)
                    last += 1
                    continue
            res.append(r)
            if r["play_type"] is not None and not r["is_timeout"]:
                last = len(res) - 1
        out.extend(res)
        i = j
    return out


def dead_balls(rows: pl.DataFrame, max_seconds: int) -> DeadBalls:
    """Every scrimmage snap's dead ball (with the timeouts called in it and the run-off before
    the snap) and every kickoff, in play order."""
    out = DeadBalls()
    games = 0
    prev: dict[str, Any] | None = None
    game = None
    pending: list[tuple[str, bool]] = []
    pending_qtr = None
    two_min = False
    warned = {2: False, 4: False}
    cols = ROW_COLS + [c for c in CLOCK_COLS + ID_COLS if c in rows.columns]
    for r in clock_order(list(rows.select(cols).iter_rows(named=True))):
        if r["game_id"] != game:
            game, prev, pending, two_min, warned = r["game_id"], None, [], False, {2: False, 4: False}
            games += 1
        # Step 5c revision 1: a timeout never carries across a period end.
        if pending and r["qtr"] != pending_qtr:
            pending = []
        if r["is_timeout"]:
            pending.append((r["timeout_team"], bool(r["challenge"])))
            pending_qtr = r["qtr"]
            continue
        if r["play_type"] is None:
            if r["two_min"]:
                two_min = True
                if r["qtr"] in warned:
                    warned[int(r["qtr"])] = True
            continue
        legit = [t for t, ch in pending if not ch]
        out.challenge_timeouts += sum(1 for _, ch in pending if ch)
        if r["qtr"] in warned and prev is not None and crossed_warning(prev, r):
            warned[int(r["qtr"])] = True
        if r["qtr"] in warned and warned[int(r["qtr"])]:
            out.timeouts_after_warning += len(legit)
        if r["play_type"] == "kickoff" or r["is_try"]:
            # posteam is the receiving team on a kickoff, the scoring team on a try.
            roles = ("kickReceiver", "kickKicker") if r["play_type"] == "kickoff" else ("tryOffense", "tryDefense")
            for role, team_, left in ((roles[0], r["posteam"], r["posteam_timeouts_remaining"]), (roles[1], r["defteam"], r["defteam_timeouts_remaining"])):
                called = sum(1 for t in legit if t == team_)
                out.special.append((r["season"], role, 1 if called else 0, int(left or 0) + called))
                out.special_views.append({"quarter": int(r["qtr"]), "secondsLeftInGame": r["game_seconds_remaining"],
                                          "secondsLeftInHalf": r["half_seconds_remaining"], "scoreDiff": 0})
        if r["play_type"] == "kickoff" or r["is_try"]:
            out.special_timeouts.append((r["season"], int(r["qtr"]), "kickoff" if r["play_type"] == "kickoff" else "try", len(legit)))
        if r["play_type"] == "kickoff":
            out.timeouts_before_kickoff += len(legit)
            out.kickoffs.append({
                "season": r["season"], "quarter": int(r["qtr"]), "secondsLeftInGame": r["game_seconds_remaining"],
                "secondsLeftInHalf": r["half_seconds_remaining"], "scoreDiff": -(r["score_differential"] or 0), "onside": bool(r["onside"]),
            })
        elif r["is_try"]:
            out.timeouts_before_try += len(legit)
        elif (r["play_type"] in SNAP_TYPES or r["play_type"] == "no_play") and r["down"] is not None and r["posteam"] is not None:
            off = sum(1 for t in legit if t == r["posteam"])
            dfn = sum(1 for t in legit if t == r["defteam"])
            running = clock_running(prev, r, two_min)
            runoff = None
            # A timeout in this dead ball: the run-off is the time that ran before it (revision 2).
            if running and len(legit) == len(pending) and prev is not None and prev["duration"] is not None and prev["qtr"] == r["qtr"]:
                x = prev["game_seconds_remaining"] - prev["duration"] - r["game_seconds_remaining"]
                if -1.5 <= x <= max_seconds + 5:
                    runoff = int(math.floor(min(max(x, 0.0), float(max_seconds)) + 0.5))
            o_to = (r["posteam_timeouts_remaining"] if r["posteam_timeouts_remaining"] is not None else 0) + off
            d_to = (r["defteam_timeouts_remaining"] if r["defteam_timeouts_remaining"] is not None else 0) + dfn
            base = {"quarter": int(r["qtr"]), "secondsLeftInHalf": r["half_seconds_remaining"], "secondsLeftInGame": r["game_seconds_remaining"],
                    "down": int(r["down"]), "clockRunning": running}
            out.snaps.append({
                "season": r["season"], "base": base, "scoreDiff": r["score_differential"] or 0,
                "offenseTimeouts": min(3, max(0, int(o_to))), "defenseTimeouts": min(3, max(0, int(d_to))),
                "restart": 0 if prev is None or prev["qtr"] != r["qtr"] or prev["posteam"] != r["posteam"] else 2 if (prev["penalty"] or 0) == 1 or prev["play_type"] == "no_play" else 1 if (prev["out_of_bounds"] or 0) == 1 else 0,
                "timeoutCalled": 1 if legit else 0,
                "prevKneel": 1 if (prev is not None and prev["qtr"] == r["qtr"] and (prev["qb_kneel"] or 0) == 1 and prev["posteam"] == r["posteam"]) else 0,
                "offenseTimeout": 1 if off > 0 else 0, "defenseTimeout": 1 if dfn > 0 else 0, "runoff": runoff,
                "playType": r["play_type"],
                **({"gameId": r["game_id"], "playId": r["play_id"]} if "play_id" in r else {}),
            })
        prev, pending, two_min = r, [], False
    out.team_games = 2 * games
    return out


def tempo_view(s: dict[str, Any]) -> dict[str, float]:
    return {**s["base"], "scoreDiff": s["scoreDiff"], "ownTimeouts": s["offenseTimeouts"], "previousSnapKneel": s["prevKneel"], "clockRestarted": s["restart"], "timeoutCalled": s["timeoutCalled"]}


def side_view(s: dict[str, Any], side: str) -> dict[str, float]:
    own = s["offenseTimeouts"] if side == "offense" else s["defenseTimeouts"]
    diff = s["scoreDiff"] if side == "offense" else -s["scoreDiff"]
    return {**s["base"], "scoreDiff": diff, "ownTimeouts": own, "previousSnapKneel": s["prevKneel"], "clockRestarted": s["restart"], "timeoutCalled": s["timeoutCalled"]}


def kick_view(k: dict[str, Any]) -> dict[str, float]:
    return {"quarter": k["quarter"], "secondsLeftInGame": k["secondsLeftInGame"], "secondsLeftInHalf": k["secondsLeftInHalf"], "scoreDiff": k["scoreDiff"]}


# ---------------------------------------------------------------- fitting


def largest_remainder(ws: list[float], total: int) -> list[int]:
    s = sum(ws)
    raw = [w * total / s for w in ws]
    base = [int(math.floor(x)) for x in raw]
    left = total - sum(base)
    order = sorted(range(len(ws)), key=lambda i: (-(raw[i] - base[i]), i))
    for i in order[:left]:
        base[i] += 1
    return base


def fit_rate(obs: list[tuple[dict[str, str], dict[str, str], int, float]], levels: list[dict[str, Any]], min_n: int) -> list[dict[str, list[int]]]:
    """obs: (labels, context, y, weight). Cell value: [rate per 1,000,000, n]."""
    cells: list[dict[str, list[int]]] = []
    for lv in levels:
        acc: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
        for labels, ctx, y, w in obs:
            k = level_key(lv, labels, ctx)
            if k is None:
                continue
            a = acc[k]
            a[0] += w * y
            a[1] += w
            a[2] += 1
        cells.append({k: [int(round(PER_MILLION * a[0] / a[1])), int(a[2])] for k, a in sorted(acc.items()) if a[2] >= min_n and a[1] > 0})
    return cells


def fit_hist(obs: list[tuple[dict[str, str], int, float]], levels: list[dict[str, Any]], min_n: int, max_s: int, total: int) -> list[dict[str, list[int]]]:
    cells: list[dict[str, list[int]]] = []
    for lv in levels:
        acc: dict[str, list[float]] = defaultdict(lambda: [0.0] * (max_s + 2))
        for labels, y, w in obs:
            k = level_key(lv, labels)
            if k is None:
                continue
            a = acc[k]
            a[y] += w
            a[max_s + 1] += 1
        cells.append({k: largest_remainder(a[: max_s + 1], total) for k, a in sorted(acc.items()) if a[max_s + 1] >= min_n})
    return cells


def build_tables(db: DeadBalls, cfg: dict[str, Any], weights: dict[int, float], tempo_weights: dict[int, float]) -> dict[str, Any]:
    s = cfg["seasons"]
    dims = cfg["dimensions"]
    t = cfg["tempo"]
    train = [x for x in db.snaps if s["from"] <= x["season"] <= s["to"]]
    tempo_obs = [(labels_of(tempo_view(x), dims, t["levels"]), x["runoff"], tempo_weights[x["season"]]) for x in train
                 if x["runoff"] is not None and x["season"] in tempo_weights]
    check_holdout({x["season"] for x in train}, s["neverTrainFrom"])
    tempo = {"generated": True, "seasons": sorted(tempo_weights), "levels": t["levels"], "minN": t["minN"], "maxSeconds": t["maxSeconds"],
             "cellTotal": t["cellTotal"], "snaps": len(tempo_obs),
             "cells": fit_hist(tempo_obs, t["levels"], t["minN"], t["maxSeconds"], t["cellTotal"])}
    to_obs: list[tuple[dict[str, str], dict[str, str], int, float]] = []
    for x in train:
        for side in ("offense", "defense"):
            v = side_view(x, side)
            if v["ownTimeouts"] <= 0:
                continue
            to_obs.append((labels_of(v, dims, cfg["timeouts"]["levels"]), {"side": side}, x[f"{side}Timeout"], weights[x["season"]]))
    special: dict[str, list[float]] = {}
    sp_cfg = cfg.get("specialTimeouts")
    sp_obs: list[tuple[dict[str, str], dict[str, str], int, float]] = []
    views = db.special_views if len(db.special_views) == len(db.special) else [None] * len(db.special)
    for (season, role, called, left), kv in zip(db.special, views):
        if not (s["from"] <= season <= s["to"]) or left <= 0:
            continue
        a = special.setdefault(role, [0.0, 0.0, 0.0])
        a[0] += weights[season] * called
        a[1] += weights[season]
        a[2] += 1
        if sp_cfg is not None and kv is not None:
            sp_obs.append((labels_of(kv, dims, sp_cfg["levels"]), {"role": role}, called, weights[season]))
    timeouts = {"generated": True, "seasons": sorted(weights), "levels": cfg["timeouts"]["levels"], "minN": cfg["timeouts"]["minN"],
                "deadBalls": len(train), "cells": fit_rate(to_obs, cfg["timeouts"]["levels"], cfg["timeouts"]["minN"]),
                "beforeKickoffOrTry": {k: [int(round(PER_MILLION * a[0] / a[1])), int(a[2])] for k, a in sorted(special.items())}}
    if sp_cfg is not None:
        # Step 5c milestone D: fitted rates in designed time bins, backing off to the role's rate.
        timeouts["special"] = {"levels": sp_cfg["levels"], "minN": sp_cfg["minN"], "cells": fit_rate(sp_obs, sp_cfg["levels"], sp_cfg["minN"])}
    ko = [k for k in db.kickoffs if s["from"] <= k["season"] <= s["to"]]
    check_holdout({k["season"] for k in ko}, s["neverTrainFrom"])
    on_obs = [(labels_of(kick_view(k), dims, cfg["onside"]["levels"]), {}, 1 if k["onside"] else 0, weights[k["season"]]) for k in ko]
    onside = {"generated": True, "seasons": sorted(weights), "levels": cfg["onside"]["levels"], "minN": cfg["onside"]["minN"],
              "kickoffs": len(ko), "attempts": sum(1 for k in ko if k["onside"]),
              "designedRule": cfg["onside"]["designedRule"], "cells": fit_rate(on_obs, cfg["onside"]["levels"], cfg["onside"]["minN"])}
    return {"tempo": tempo, "timeouts": timeouts, "onside": onside}


# ---------------------------------------------------------------- share functions (mirrored in TS)


def tempo_lookup(view: dict[str, float], table: dict[str, Any], dims: dict[str, Any]) -> tuple[int, str, list[int]]:
    labels = labels_of(view, dims, table["levels"])
    for i, lv in enumerate(table["levels"]):
        k = level_key(lv, labels)
        if k in table["cells"][i]:
            return i, k, table["cells"][i][k]
    raise ValueError("no tempo cell")


def tempo_mean(view: dict[str, float], table: dict[str, Any], dims: dict[str, Any], play_clock: int) -> float:
    _, _, w = tempo_lookup(view, table, dims)
    return sum(min(s, play_clock) * x for s, x in enumerate(w)) / sum(w)


def timeout_rate(view: dict[str, float], side: str, table: dict[str, Any], dims: dict[str, Any]) -> tuple[int, str, float]:
    if view["ownTimeouts"] <= 0:
        return -1, "", 0.0
    labels = labels_of(view, dims, table["levels"])
    for i, lv in enumerate(table["levels"]):
        k = level_key(lv, labels, {"side": side})
        if k in table["cells"][i]:
            return i, k, table["cells"][i][k][0] / PER_MILLION
    raise ValueError("no timeout cell")


def special_timeout_rate(view: dict[str, float] | None, role: str, table: dict[str, Any], dims: dict[str, Any]) -> tuple[int, str, float]:
    """Step 5c milestone D: the rate before a kickoff or a try from the time-binned cells, else the
    role's pooled rate (also used when no view is given)."""
    sp = table.get("special")
    if sp is not None and view is not None:
        labels = labels_of(view, dims, sp["levels"])
        for i, lv in enumerate(sp["levels"]):
            k = level_key(lv, labels, {"role": role})
            if k is not None and k in sp["cells"][i]:
                return i, k, sp["cells"][i][k][0] / PER_MILLION
    return -1, role, table["beforeKickoffOrTry"][role][0] / PER_MILLION


def onside_rate(view: dict[str, float], table: dict[str, Any], dims: dict[str, Any]) -> tuple[int, str, float]:
    labels = labels_of(view, dims, table["levels"])
    for i, lv in enumerate(table["levels"]):
        k = level_key(lv, labels)
        if k in table["cells"][i]:
            return i, k, table["cells"][i][k][0] / PER_MILLION
    r = table["designedRule"]
    hit = view["quarter"] >= r["quarterMin"] and view["secondsLeftInGame"] <= r["secondsLeftInGame"] and view["scoreDiff"] <= -r["trailingBy"]
    return -1, "designed", 1.0 if hit else 0.0
