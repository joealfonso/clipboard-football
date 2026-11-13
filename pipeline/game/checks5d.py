"""M1 step 5d milestone 0.2: the real 2016-2023 side of the pre-registered checks
(data/game/step5d-checks.json). scripts/game/checks5d.ts computes the same counts on the sim's
in-sample games and scripts/game/report.ts renders both, with each check's pass rule.

    uv run --project pipeline python -m pipeline.game.checks5d

Writes data/game/checks5d.real.json. Regular season 2016-2023 only (a 2024+ row raises),
unweighted counts per game. Every measure is designed and computed the same way on both sides:

- A snap is a row of play type run, pass, punt, field_goal, qb_kneel or qb_spike that is not a
  try (sim: a scrimmage play that is not a pre-snap foul). Rows are read in clock order
  (decisions.clock_order, step 5c revision 1).
- Leading, trailing and tied: the offense's score at the snap. Late: the 4th quarter (any time)
  or overtime. "Left": seconds left in the 4th quarter, or in the overtime period.
- Timeouts at the snap: the game pipeline's dead-ball reading (decisions.dead_balls: timeouts
  remaining plus those the team called in the dead ball, less the one it called), else the row's
  timeouts remaining. Clock running at the snap: decisions.clock_running and no timeout in the
  dead ball (the caller's clock_running, step 5d milestone A); a snap the dead-ball reader does
  not list (its row carries a timeout flag) counts as stopped.
- spike.trail0TO: late spikes by an offense trailing by 1-8 with 0 timeouts. Per game.
- spike.<running|stopped>0TO: snaps on downs 1-3 in the 4th quarter's final 2:00 or overtime by an
  offense trailing by 1-8 with 0 timeouts, by clock state: spikes / snaps.
- gap.trail0TO: as c.trail.longGap (step 5c): the gap from one snap to the next snap of the same
  drive with no row between, first snap in the 4th quarter with 1:00 or less left (also reported
  for 2:00), offense trailing by 1-8 with 0 timeouts remaining on the first snap's row: gaps of
  15 s or more / gaps.
- kneel.notLeading: late kneels by a trailing or tied offense with more than 47 s left. Per game;
  also split trailing 1-8, trailing 9+, tied.
- kneel.thenPlay.<lead1to8|lead9|notLeading>: possessions (game and nflverse fixed_drive; sim: the
  offense's run of snaps with no kickoff, try or change of offense between) with a late kneel,
  bucketed by the score at the first late kneel, where the same possession later snaps a run or a
  pass (sim: run, pass, sack, scramble). Per game.
- kneel.4thLate: late kneels on 4th down with more than 10 s left. Per game.
- try.otDown2: overtime tries with the scoring team down 2 after the touchdown and
  ot_both_possessed 1 (pipeline/caller/load.py); 2016-2023 regular-season overtime has no try.
- ottry.<flag>.<score> (E4, reported): every overtime try by ot_both_possessed and score after the
  touchdown, tries and two-point tries.
- Reported: spikes per game (all periods), late spikes by 1-8 trailers holding 1+ timeouts,
  margins (pipeline.game.checks5c.margins).
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from typing import Any

import polars as pl

from pipeline.caller.config import REPO
from pipeline.caller.load import ot_both_possessed
from pipeline.game import decisions as dec
from pipeline.game.checks5c import margins
from pipeline.game.load import Source, load_rows

SEASONS = list(range(2016, 2024))
NEVER_FROM = 2024
SNAP_TYPES = ("run", "pass", "punt", "field_goal", "qb_kneel", "qb_spike")
OUT = "data/game/checks5d.real.json"
COLS = ["season", "game_id", "play_id", "qtr", "down", "posteam", "defteam", "play_type", "is_timeout", "timeout_after_play", "is_try",
        "game_seconds_remaining", "quarter_seconds_remaining", "score_differential", "posteam_timeouts_remaining",
        "defteam_timeouts_remaining", "fixed_drive", "extra_point_attempt", "two_point_attempt", "timeout_clock", "tod"]


def _f(v: Any) -> float:
    return 0.0 if v is None else float(v)


def left(r: dict[str, Any]) -> float:
    """Seconds left in the 4th quarter or the overtime period."""
    return _f(r["quarter_seconds_remaining"]) if r.get("quarter_seconds_remaining") is not None else _f(r["game_seconds_remaining"])


def measure(rows: pl.DataFrame) -> dict[str, int]:
    """Counts with the same keys as scripts/game/checks5d.ts (games included)."""
    dec.check_holdout(set(rows["season"].unique().to_list()), NEVER_FROM)
    c: dict[str, int] = defaultdict(int)
    c["games"] = rows["game_id"].n_unique()
    reading: dict[tuple[Any, Any], tuple[int, int]] = {}
    if "play_id" in rows.columns:
        for x in dec.dead_balls(rows, 40).snaps:
            running = 0 if x["timeoutCalled"] else int(x["base"]["clockRunning"])
            reading[(x["gameId"], x["playId"])] = (running, x["offenseTimeouts"] - x["offenseTimeout"])
    cols = [k for k in COLS if k in rows.columns]
    ordered = dec.clock_order(list(rows.select(cols).iter_rows(named=True)))
    flags = ot_both_possessed(ordered)
    by_game: dict[str, list[tuple[dict[str, Any], int]]] = defaultdict(list)
    for r, fl in zip(ordered, flags):
        by_game[r["game_id"]].append((r, fl))
    for gid in sorted(by_game):
        prev: dict[str, Any] | None = None  # the previous row was a snap (else None)
        kneels: dict[Any, str] = {}  # fixed_drive -> score bucket at its first late kneel
        replayed: set[Any] = set()
        for r, fl in by_game[gid]:
            pt = r["play_type"]
            q = int(r["qtr"] or 0)
            d = _f(r["score_differential"])
            if (r.get("extra_point_attempt") or 0) == 1 or (r.get("two_point_attempt") or 0) == 1:
                if q >= 5:
                    # E4 (reported): every overtime try by otBothPossessed and score after the touchdown.
                    c[f"ottry.{fl}.{int(d)}.tries"] += 1
                    c[f"ottry.{fl}.{int(d)}.two"] += 1 if (r.get("two_point_attempt") or 0) == 1 else 0
                if q >= 5 and d == -2 and fl == 1:
                    c["try.otDown2.tries"] += 1
                    c["try.otDown2.two"] += 1 if (r.get("two_point_attempt") or 0) == 1 else 0
            if dec.timeout_row(r) or pt not in SNAP_TYPES or r.get("is_try") or r["down"] is None:
                prev = None
                continue
            running, to_snap = reading.get((r["game_id"], r.get("play_id")), (0, None))  # type: ignore[assignment]
            own = int(to_snap) if to_snap is not None else int(_f(r["posteam_timeouts_remaining"]))
            late = q >= 4
            secs = left(r)
            down = int(r["down"])
            trail18 = -8 <= d <= -1
            # gaps (as c.trail.longGap): the first snap's view
            if prev is not None and prev["qtr"] == r["qtr"] == 4 and prev["posteam"] == r["posteam"] and prev["fixed_drive"] == r["fixed_drive"]:
                pd = _f(prev["score_differential"])
                if -8 <= pd <= -1 and _f(prev["posteam_timeouts_remaining"]) == 0:
                    gap = _f(prev["game_seconds_remaining"]) - _f(r["game_seconds_remaining"])
                    for w, lim in (("", 60), (".final2", 120)):
                        if _f(prev["game_seconds_remaining"]) <= lim:
                            c[f"gap.trail0TO{w}.gaps"] += 1
                            c[f"gap.trail0TO{w}.hits"] += 1 if gap >= 15 else 0
            prev = r
            if pt == "qb_spike":
                c["spike.all"] += 1
            if not late:
                continue
            if pt == "qb_spike" and trail18:
                c["spike.trail0TO" if own == 0 else "spike.trail1TO"] += 1
            if trail18 and own == 0 and down <= 3 and (q >= 5 or secs <= 120):
                k = "spike.running0TO" if running == 1 else "spike.stopped0TO"
                c[f"{k}.snaps"] += 1
                c[f"{k}.spikes"] += 1 if pt == "qb_spike" else 0
            drive = r["fixed_drive"]
            if pt == "qb_kneel":
                if d <= 0 and secs > 47:
                    c["kneel.notLeading"] += 1
                    c["kneel.notLeading.tied" if d == 0 else "kneel.notLeading.trail1to8" if d >= -8 else "kneel.notLeading.trail9"] += 1
                if down == 4 and secs > 10:
                    c["kneel.4thLate"] += 1
                if drive not in kneels:
                    kneels[drive] = "lead1to8" if 1 <= d <= 8 else "lead9" if d >= 9 else "notLeading"
            elif pt in ("run", "pass") and drive in kneels and drive not in replayed:
                replayed.add(drive)
                c[f"kneel.thenPlay.{kneels[drive]}"] += 1
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
