"""M1 step 5c milestone 0.2: the real 2016-2023 side of the 17 pre-registered checks
(data/game/step5c-checks.json). scripts/game/checks5c.ts computes the same counts on the sim's
in-sample games and scripts/game/report.ts renders both, with each check's pass rule.

    uv run --project pipeline python -m pipeline.game.checks5c

Writes data/game/checks5c.real.json. Regular season 2016-2023 only (a 2024+ row raises),
unweighted counts per game. Every measure is designed and computed the same way on both sides:

- A scrimmage snap is a row of play type run, pass, punt, field_goal, qb_kneel or qb_spike that
  is not a try (sim:
  a scrimmage play that is not a pre-snap foul). Timeouts are read in clock order
  (decisions.clock_order, step 5c revision 1) and never carry across a period end.
- A gap is the game-clock seconds from one snap to the next snap of the same drive (same
  period, same offense, same nflverse fixed_drive; sim: the first play kept the ball), with no
  row between them (no timeout, period end, two-minute warning or no-play row; sim: nothing but
  a run-off). Its view (score, timeouts) is the first snap's, which must start in the 4th
  quarter with 2:00 or less left.
- trail.lastSnap: the last 4th-quarter snap is by an offense trailing by 1-8 with 1 or more
  timeouts and 15 s or more on the clock at the snap. Share of games.
- trail.longGap: offense trailing by 1-8 with 1 or more timeouts: gaps of 35 s or more.
- spike.stopped: spikes with the clock stopped at the snap: a timeout in the dead ball, or the
  designed clock reading (decisions.clock_running) says it was stopped. Per game.
- kneel.ballBack: of games with a 4th-quarter kneel by a leading offense, those where the other
  team snaps later in the 4th quarter.
- kneel.shortGap0TO: leading offense, defense with 0 timeouts: gaps of 15 s or less.
- kneel.early: kneels in Q1, Q3, or Q2 with more than 1:00 left. Per game.
- fg.*: field goal tries by kick distance, every period. Per game.
- try.down2GF, try.tiedG5: tries in the 4th quarter (2:00 or less; 5:00 or less) with the
  scoring team trailing by 2 (tied) after the touchdown; the two-point (extra-point) count.
- to.*: timeouts (challenges excluded) in the dead ball before a kickoff or a try. Per game.
- rough.scramble: accepted (enforced) roughing the passer by the defense on a QB scramble.
- trail.endsOnRunoff (reported, not gated): real pbp has no run-off row, so it is sim only.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from typing import Any

import polars as pl

from pipeline.caller.config import REPO
from pipeline.engine.load import fouls_of
from pipeline.game import decisions as dec
from pipeline.game.load import Source, load_rows

SEASONS = list(range(2016, 2024))
NEVER_FROM = 2024
SNAP_TYPES = ("run", "pass", "punt", "field_goal", "qb_kneel", "qb_spike")
OUT = "data/game/checks5c.real.json"
COLS = ["season", "game_id", "qtr", "posteam", "defteam", "play_type", "is_timeout", "game_seconds_remaining",
        "quarter_seconds_remaining", "score_differential", "posteam_timeouts_remaining", "defteam_timeouts_remaining",
        "fixed_drive", "field_goal_attempt", "kick_distance", "extra_point_attempt", "two_point_attempt", "qb_scramble",
        "fouls", "timeout_clock", "tod", "is_try"]


def _f(v: Any) -> float:
    return 0.0 if v is None else float(v)


def measure(rows: pl.DataFrame) -> dict[str, int]:
    """Counts with the same keys as scripts/game/checks5c.ts (games included)."""
    seasons = set(rows["season"].unique().to_list())
    dec.check_holdout(seasons, NEVER_FROM)
    c: dict[str, int] = defaultdict(int)
    c["games"] = rows["game_id"].n_unique()
    db = dec.dead_balls(rows, 40)
    for _, q, kind, n in db.special_timeouts:
        if kind == "kickoff":
            c["to.kickoffAll"] += n
            if q <= 3:
                c["to.kickoffQ13"] += n
        elif q <= 3:
            c["to.tryQ13"] += n
    for x in db.snaps:
        if x["playType"] == "qb_spike" and (x["base"]["clockRunning"] == 0 or x["timeoutCalled"] == 1):
            c["spike.stopped"] += 1
    cols = [k for k in COLS if k in rows.columns]
    ordered = dec.clock_order(list(rows.select(cols).iter_rows(named=True)))
    by_game: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in ordered:
        by_game[r["game_id"]].append(r)
    for gid in sorted(by_game):
        g = by_game[gid]
        last_q4: dict[str, Any] | None = None
        kneel_team: str | None = None
        ball_back = False
        prev: dict[str, Any] | None = None  # the previous row was a snap (else None)
        for r in g:
            pt = r["play_type"]
            if r["is_timeout"] or pt not in SNAP_TYPES or r.get("is_try"):
                prev = None
                if (r.get("extra_point_attempt") or 0) == 1 or (r.get("two_point_attempt") or 0) == 1:
                    if r["qtr"] == 4:
                        d = _f(r["score_differential"])
                        two = (r.get("two_point_attempt") or 0) == 1
                        if d == -2 and _f(r["game_seconds_remaining"]) <= 120:
                            c["try.down2GF.tries"] += 1
                            c["try.down2GF.two"] += 1 if two else 0
                        if d == 0 and _f(r["game_seconds_remaining"]) <= 300:
                            c["try.tiedG5.tries"] += 1
                            c["try.tiedG5.kick"] += 0 if two else 1
                continue
            if prev is not None and prev["qtr"] == r["qtr"] == 4 and prev["posteam"] == r["posteam"] and prev["fixed_drive"] == r["fixed_drive"] \
                    and _f(prev["game_seconds_remaining"]) <= 120:
                gap = _f(prev["game_seconds_remaining"]) - _f(r["game_seconds_remaining"])
                d = _f(prev["score_differential"])
                if -8 <= d <= -1 and _f(prev["posteam_timeouts_remaining"]) >= 1:
                    c["trail.longGap.gaps"] += 1
                    c["trail.longGap.hits"] += 1 if gap >= 35 else 0
                if d >= 1 and _f(prev["defteam_timeouts_remaining"]) == 0:
                    c["kneel.shortGap0TO.gaps"] += 1
                    c["kneel.shortGap0TO.hits"] += 1 if gap <= 15 else 0
            prev = r
            q = int(r["qtr"])
            if q == 4:
                last_q4 = r
            if pt == "qb_kneel":
                if q in (1, 3) or (q == 2 and _f(r["quarter_seconds_remaining"]) > 60):
                    c["kneel.early"] += 1
                if q == 4 and kneel_team is None and _f(r["score_differential"]) >= 1:
                    kneel_team = r["posteam"]
                    continue
            if kneel_team is not None and q == 4 and r["posteam"] != kneel_team:
                ball_back = True
            if (r.get("field_goal_attempt") or 0) == 1 and r.get("kick_distance") is not None:
                dist = _f(r["kick_distance"])
                c["fg.60"] += 1 if dist >= 60 else 0
                c["fg.63"] += 1 if dist >= 63 else 0
                c["fg.70"] += 1 if dist >= 70 else 0
                c["fg.50to59"] += 1 if 50 <= dist <= 59 else 0
            if (r.get("qb_scramble") or 0) == 1:
                for ptype, side, status, _ in fouls_of(r.get("fouls") or [], r["posteam"], r["defteam"]):
                    if ptype.lower() == "roughing the passer" and side == "defense" and status == "enforced":
                        c["rough.scramble"] += 1
        if last_q4 is not None:
            d = _f(last_q4["score_differential"])
            if -8 <= d <= -1 and _f(last_q4["posteam_timeouts_remaining"]) >= 1 and _f(last_q4["game_seconds_remaining"]) >= 15:
                c["trail.lastSnap"] += 1
        if kneel_team is not None:
            c["kneel.games"] += 1
            c["kneel.ballBack"] += 1 if ball_back else 0
    return dict(sorted(c.items()))


def margins(rows: pl.DataFrame) -> dict[str, int]:
    """Reported, not gated: final margins (the step 5 margin bins), the exact-3 share and overtime."""
    bins = [("0", 0, 0), ("1-3", 1, 3), ("4-7", 4, 7), ("8-14", 8, 14), ("15-21", 15, 21), ("22+", 22, 10**9)]
    c: dict[str, int] = defaultdict(int)
    last = rows.group_by("game_id").agg(pl.col("result").last(), pl.col("qtr").max())
    for r in last.iter_rows(named=True):
        if r["result"] is None:
            continue
        m = abs(int(r["result"]))
        for lab, lo, hi in bins:
            if lo <= m <= hi:
                c[f"margin.{lab}"] += 1
        c["margin.exact3"] += 1 if m == 3 else 0
        if int(r["qtr"]) > 4:
            c["ot.games"] += 1
            c["ot.endsOn3"] += 1 if m == 3 else 0
    return dict(sorted(c.items()))


def build(source: Source) -> dict[str, Any]:
    rows = load_rows(source, SEASONS)
    return {"generated": True, "seasons": SEASONS, "counts": {**measure(rows), **margins(rows)}}


def main() -> int:
    from pipeline import cache
    from pipeline.sources import NflreadpySource

    path = cache.cache_dir()
    try:
        cache.prepare(path)
    except cache.CacheNotWritable as e:
        print(str(e), file=sys.stderr)
        return 2
    out = build(NflreadpySource(path))
    (REPO / OUT).write_text(json.dumps(out, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({out['counts']['games']} games)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
