"""M1 step 5c spec checks (test-writer), on hand-made frames.

- Milestone 0.2 (docs/specs/m1-step5c-playtest-fixes.md): the real side of every pre-registered
  check (pipeline/game/checks5c.py) has one positive and one negative case, and a 2024+ row raises.
- Revision 1 (docs/DECISIONS.md, "Revision 1 (lead, 2026-11-12): timeout rows matched to the snap
  they precede"): decisions.clock_order / _precedes and the period-end clearing of pending
  timeouts in decisions.dead_balls.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import polars as pl
import pytest

from pipeline.game import checks5c
from pipeline.game import decisions as dec

STR = ("game_id", "posteam", "defteam", "play_type", "timeout_team")
BOOL = ("is_timeout", "challenge", "two_min", "is_try", "onside")
INT = ("timeout_clock",)
COLS = list(dict.fromkeys(dec.ROW_COLS + checks5c.COLS + dec.CLOCK_COLS))


def row(**kw):
    base = {c: None for c in COLS}
    base.update(season=2023, game_id="g1", qtr=4, down=1, ydstogo=10, yardline_100=60, game_seconds_remaining=100,
                half_seconds_remaining=100, quarter_seconds_remaining=100, posteam="A", defteam="B", play_type="run",
                is_timeout=False, challenge=False, two_min=False, is_try=False, onside=False, incomplete_pass=0, qb_spike=0,
                qb_kneel=0, interception=0, fumble_lost=0, penalty=0, out_of_bounds=0, score_differential=0,
                posteam_timeouts_remaining=3, defteam_timeouts_remaining=3, duration=5.0, fixed_drive=1, fouls=[])
    base.update(kw)
    # Keep the three clocks consistent unless a test sets them apart (Q4: half = game = quarter).
    if "game_seconds_remaining" in kw and "quarter_seconds_remaining" not in kw and base["qtr"] == 4:
        base["quarter_seconds_remaining"] = kw["game_seconds_remaining"]
    if "game_seconds_remaining" in kw and "half_seconds_remaining" not in kw and base["qtr"] == 4:
        base["half_seconds_remaining"] = kw["game_seconds_remaining"]
    return base


def frame(rows):
    def typ(c):
        if c in STR:
            return pl.String
        if c in BOOL:
            return pl.Boolean
        if c in INT:
            return pl.Int64
        if c == "fouls":
            return pl.List(pl.String)
        if c == "tod":
            return pl.Datetime(time_zone="UTC")
        return pl.Float64
    return pl.DataFrame(rows, schema={c: typ(c) for c in COLS})


def timeout(team="B", **kw):
    return row(play_type=None, is_timeout=True, timeout_team=team, posteam=None, defteam=None, down=None, **kw)


def m(rows):
    return checks5c.measure(frame(rows))


# ---------------------------------------------------------------- 0.2: holdout guard


def test_a_2024_row_raises():
    with pytest.raises(dec.HoldoutLeak):
        m([row(), row(season=2024, game_id="g2")])
    m([row(), row(season=2023, game_id="g2")])  # 2016-2023 only: no raise


# ---------------------------------------------------------------- 0.2: one positive, one negative per measure


def test_trail_last_snap():
    # The last Q4 snap: trailing by 4, 1 timeout, 0:20 on the clock -> counted.
    pos = [row(game_seconds_remaining=60), row(game_seconds_remaining=20, score_differential=-4, posteam_timeouts_remaining=1)]
    assert m(pos).get("trail.lastSnap", 0) == 1
    # Same but 0:14 left (under 15 s), or no timeouts, or trailing by 9: not counted.
    for over in ({"game_seconds_remaining": 14}, {"posteam_timeouts_remaining": 0}, {"score_differential": -9}):
        neg = [row(game_seconds_remaining=60), row(**{"game_seconds_remaining": 20, "score_differential": -4, "posteam_timeouts_remaining": 1, **over})]
        assert m(neg).get("trail.lastSnap", 0) == 0, over
    # Only the last Q4 snap counts: a later snap by a leader clears it.
    later = pos + [row(game_seconds_remaining=10, posteam="B", defteam="A", score_differential=4, fixed_drive=2)]
    assert m(later).get("trail.lastSnap", 0) == 0


def test_trail_long_gap():
    base = dict(score_differential=-3, posteam_timeouts_remaining=2)
    pos = m([row(game_seconds_remaining=110, **base), row(game_seconds_remaining=70, **base)])  # 40 s gap
    assert (pos.get("trail.longGap.gaps", 0), pos.get("trail.longGap.hits", 0)) == (1, 1)
    short = m([row(game_seconds_remaining=110, **base), row(game_seconds_remaining=80, **base)])  # 30 s gap
    assert (short.get("trail.longGap.gaps", 0), short.get("trail.longGap.hits", 0)) == (1, 0)
    for gap, hit in ((35, 1), (34, 0)):  # 35 s or more
        c = m([row(game_seconds_remaining=110, **base), row(game_seconds_remaining=110 - gap, **base)])
        assert c.get("trail.longGap.hits", 0) == hit, gap
    # A timeout between the snaps: not a gap. Before the final 2:00: not a gap.
    to = m([row(game_seconds_remaining=110, **base), timeout("A"), row(game_seconds_remaining=70, **base)])
    assert to.get("trail.longGap.gaps", 0) == 0
    early = m([row(game_seconds_remaining=160, **base), row(game_seconds_remaining=120, **base)])
    assert early.get("trail.longGap.gaps", 0) == 0
    # Another drive is not a gap.
    other = m([row(game_seconds_remaining=110, **base), row(game_seconds_remaining=70, fixed_drive=2, **base)])
    assert other.get("trail.longGap.gaps", 0) == 0


def test_spike_stopped():
    # A spike after an incompletion (clock stopped) counts; a spike after an in-bounds run does not.
    stopped = m([row(game_seconds_remaining=60, incomplete_pass=1), row(game_seconds_remaining=55, play_type="pass", qb_spike=1)])
    assert stopped.get("spike.stopped", 0) == 0  # play_type must be qb_spike
    stopped = m([row(game_seconds_remaining=60, incomplete_pass=1), row(game_seconds_remaining=55, play_type="qb_spike", qb_spike=1)])
    assert stopped.get("spike.stopped", 0) == 1
    running = m([row(game_seconds_remaining=60), row(game_seconds_remaining=40, play_type="qb_spike", qb_spike=1)])
    assert running.get("spike.stopped", 0) == 0
    # A timeout in the dead ball stops the clock.
    to = m([row(game_seconds_remaining=60), timeout("A"), row(game_seconds_remaining=40, play_type="qb_spike", qb_spike=1)])
    assert to.get("spike.stopped", 0) == 1


def test_kneel_ball_back():
    kneel = row(game_seconds_remaining=90, play_type="qb_kneel", qb_kneel=1, score_differential=7)
    back = m([kneel, row(game_seconds_remaining=30, posteam="B", defteam="A", score_differential=-7, fixed_drive=2)])
    assert (back.get("kneel.games", 0), back.get("kneel.ballBack", 0)) == (1, 1)
    out = m([kneel, row(game_seconds_remaining=50, play_type="qb_kneel", qb_kneel=1, score_differential=7)])
    assert (out.get("kneel.games", 0), out.get("kneel.ballBack", 0)) == (1, 0)
    # A trailing team's kneel is not a leader's kneel.
    trail = m([row(game_seconds_remaining=90, play_type="qb_kneel", qb_kneel=1, score_differential=-7),
               row(game_seconds_remaining=30, posteam="B", defteam="A", fixed_drive=2)])
    assert trail.get("kneel.games", 0) == 0


def test_kneel_short_gap_0to():
    base = dict(score_differential=5, defteam_timeouts_remaining=0)
    pos = m([row(game_seconds_remaining=100, **base), row(game_seconds_remaining=88, **base)])  # 12 s
    assert (pos.get("kneel.shortGap0TO.gaps", 0), pos.get("kneel.shortGap0TO.hits", 0)) == (1, 1)
    neg = m([row(game_seconds_remaining=100, **base), row(game_seconds_remaining=60, **base)])  # 40 s
    assert (neg.get("kneel.shortGap0TO.gaps", 0), neg.get("kneel.shortGap0TO.hits", 0)) == (1, 0)
    # The pass rule's edge: 15 s or less.
    for gap, hit in ((15, 1), (16, 0)):
        c = m([row(game_seconds_remaining=100, **base), row(game_seconds_remaining=100 - gap, **base)])
        assert c.get("kneel.shortGap0TO.hits", 0) == hit, gap
    # The defense holding a timeout: not in this measure.
    held = m([row(game_seconds_remaining=100, score_differential=5, defteam_timeouts_remaining=1), row(game_seconds_remaining=88, score_differential=5)])
    assert held.get("kneel.shortGap0TO.gaps", 0) == 0


def test_kneel_early():
    k = dict(play_type="qb_kneel", qb_kneel=1)
    assert m([row(qtr=1, game_seconds_remaining=3000, quarter_seconds_remaining=300, **k)]).get("kneel.early", 0) == 1
    assert m([row(qtr=3, game_seconds_remaining=1500, quarter_seconds_remaining=600, **k)]).get("kneel.early", 0) == 1
    assert m([row(qtr=2, game_seconds_remaining=1900, quarter_seconds_remaining=100, **k)]).get("kneel.early", 0) == 1
    assert m([row(qtr=2, game_seconds_remaining=1840, quarter_seconds_remaining=40, **k)]).get("kneel.early", 0) == 0
    assert m([row(qtr=4, game_seconds_remaining=40, **k)]).get("kneel.early", 0) == 0


@pytest.mark.parametrize("dist,hits", [(70, {"fg.60", "fg.63", "fg.70"}), (63, {"fg.60", "fg.63"}), (60, {"fg.60"}),
                                       (59, {"fg.50to59"}), (50, {"fg.50to59"}), (49, set())])
def test_field_goal_distance_bins(dist, hits):
    c = m([row(qtr=1, game_seconds_remaining=3000, play_type="field_goal", field_goal_attempt=1, kick_distance=dist, down=4)])
    for k in ("fg.60", "fg.63", "fg.70", "fg.50to59"):
        assert c.get(k, 0) == (1 if k in hits else 0), (dist, k)


def test_try_down2_gf_and_tied_g5():
    two = dict(play_type="pass", is_try=True, two_point_attempt=1, down=None)
    xp = dict(play_type="extra_point", is_try=True, extra_point_attempt=1, down=None)
    c = m([row(game_seconds_remaining=60, score_differential=-2, **two)])
    assert (c.get("try.down2GF.tries", 0), c.get("try.down2GF.two", 0)) == (1, 1)
    c = m([row(game_seconds_remaining=60, score_differential=-2, **xp)])
    assert (c.get("try.down2GF.tries", 0), c.get("try.down2GF.two", 0)) == (1, 0)
    c = m([row(game_seconds_remaining=130, score_differential=-2, **two)])  # outside the final 2:00
    assert c.get("try.down2GF.tries", 0) == 0
    c = m([row(game_seconds_remaining=250, score_differential=0, **xp)])
    assert (c.get("try.tiedG5.tries", 0), c.get("try.tiedG5.kick", 0)) == (1, 1)
    c = m([row(game_seconds_remaining=250, score_differential=0, **two)])
    assert (c.get("try.tiedG5.tries", 0), c.get("try.tiedG5.kick", 0)) == (1, 0)
    c = m([row(game_seconds_remaining=310, score_differential=0, **xp)])  # outside the final 5:00
    assert c.get("try.tiedG5.tries", 0) == 0


def test_kickoff_and_try_timeouts_by_period():
    ko = dict(play_type="kickoff", down=None)
    q1 = m([row(qtr=1, game_seconds_remaining=3000), timeout("B", qtr=1), row(qtr=1, game_seconds_remaining=2990, **ko)])
    assert (q1.get("to.kickoffQ13", 0), q1.get("to.kickoffAll", 0), q1.get("to.tryQ13", 0)) == (1, 1, 0)
    q4 = m([row(game_seconds_remaining=200), timeout("B"), row(game_seconds_remaining=190, **ko)])
    assert (q4.get("to.kickoffQ13", 0), q4.get("to.kickoffAll", 0)) == (0, 1)
    none = m([row(qtr=1, game_seconds_remaining=3000), row(qtr=1, game_seconds_remaining=2990, **ko)])
    assert none.get("to.kickoffAll", 0) == 0
    tr = m([row(qtr=2, game_seconds_remaining=2000), timeout("A", qtr=2),
            row(qtr=2, game_seconds_remaining=1990, play_type="extra_point", is_try=True, extra_point_attempt=1, down=None)])
    assert tr.get("to.tryQ13", 0) == 1
    # A challenge is not a timeout.
    ch = m([row(qtr=1, game_seconds_remaining=3000), timeout("B", qtr=1, challenge=True), row(qtr=1, game_seconds_remaining=2990, **ko)])
    assert ch.get("to.kickoffAll", 0) == 0


def test_rough_scramble():
    # nflverse team codes are 2-3 letters (the description regex needs them).
    t = dict(qtr=1, game_seconds_remaining=3000, posteam="KC", defteam="NYG")
    foul = ["PENALTY on NYG-J.Doe, Roughing the Passer, 15 yards"]
    assert m([row(qb_scramble=1, fouls=foul, **t)]).get("rough.scramble", 0) == 1
    assert m([row(qb_scramble=0, fouls=foul, **t)]).get("rough.scramble", 0) == 0
    declined = ["PENALTY on NYG-J.Doe, Roughing the Passer, declined"]
    assert m([row(qb_scramble=1, fouls=declined, **t)]).get("rough.scramble", 0) == 0
    offense = ["PENALTY on KC-J.Doe, Roughing the Passer, 15 yards"]
    assert m([row(qb_scramble=1, fouls=offense, **t)]).get("rough.scramble", 0) == 0


# ---------------------------------------------------------------- Revision 1: clock_order


T0 = datetime(2023, 10, 1, 18, 0, tzinfo=timezone.utc)


def play(name, qsr, qtr=4, tod=None, game="g1"):
    return {"name": name, "game_id": game, "qtr": qtr, "play_type": "run", "is_timeout": False,
            "quarter_seconds_remaining": qsr, "timeout_clock": None, "tod": tod}


def to(name, stamp, qtr=4, tod=None, game="g1"):
    return {"name": name, "game_id": game, "qtr": qtr, "play_type": None, "is_timeout": True,
            "quarter_seconds_remaining": None, "timeout_clock": stamp, "tod": tod}


def names(rows):
    return [r["name"] for r in dec.clock_order(rows)]


def test_clock_order_timeout_listed_late_moves_before_the_play_it_preceded():
    # P snapped at 1:43 and used clock (N at 1:35). The timeout is stamped 1:43: it was called before P.
    rows = [play("A", 150), play("P", 103), to("T", 103), play("N", 95)]
    assert names(rows) == ["A", "T", "P", "N"]


def test_clock_order_timeout_listed_after_its_play_stays():
    # Stamped with N's clock: it was called after P, before N, as listed.
    rows = [play("A", 150), play("P", 103), to("T", 95), play("N", 95)]
    assert names(rows) == ["A", "P", "T", "N"]


def test_clock_order_timeouts_sharing_a_stamp_move_together_in_order():
    rows = [play("A", 150), play("P", 103), to("T1", 103), to("T2", 103), play("N", 95)]
    assert names(rows) == ["A", "T1", "T2", "P", "N"]


def test_clock_order_no_clock_change_and_no_time_of_day_keeps_row_order():
    # P used no clock (P and N both at 1:43) and no row has a time of day: row order stands.
    rows = [play("A", 150), play("P", 103), to("T", 103), play("N", 103)]
    assert names(rows) == ["A", "P", "T", "N"]
    # With a time of day on both rows, it decides (the timeout came before P on the wall clock).
    rows = [play("A", 150, tod=T0), play("P", 103, tod=T0 + timedelta(seconds=90)), to("T", 103, tod=T0 + timedelta(seconds=30)),
            play("N", 103, tod=T0 + timedelta(seconds=120))]
    assert names(rows) == ["A", "T", "P", "N"]
    rows[2] = to("T", 103, tod=T0 + timedelta(seconds=100))
    assert names(rows) == ["A", "P", "T", "N"]


def test_clock_order_no_move_crosses_a_quarter_or_a_game():
    # P is the last play of Q3 at 0:05; a Q4 timeout row stamped 0:05 never moves into Q3.
    rows = [play("A", 40, qtr=3), play("P", 5, qtr=3), to("T", 5, qtr=4), play("N", 900, qtr=4)]
    assert names(rows) == ["A", "P", "T", "N"]
    # Nor into another game.
    rows = [play("A", 40, game="g1"), play("P", 5, game="g1"), to("T", 5, game="g2"), play("N", 900, game="g2")]
    assert names(rows) == ["A", "P", "T", "N"]


def test_dead_balls_pending_timeouts_clear_at_period_ends():
    # A Q1 timeout row with no stamp after the last Q1 snap: it is not given to the first Q2 snap.
    rows = [row(qtr=1, game_seconds_remaining=1805, half_seconds_remaining=5, quarter_seconds_remaining=5),
            timeout("B", qtr=1),
            row(qtr=2, game_seconds_remaining=1800, half_seconds_remaining=900, quarter_seconds_remaining=900)]
    db = dec.dead_balls(frame(rows), 40)
    assert db.snaps[1]["timeoutCalled"] == 0
    # Control: inside one quarter the same timeout belongs to the next snap.
    rows[2] = row(qtr=1, game_seconds_remaining=1800, half_seconds_remaining=0, quarter_seconds_remaining=0)
    db = dec.dead_balls(frame(rows), 40)
    assert db.snaps[1]["timeoutCalled"] == 1 and db.snaps[1]["defenseTimeout"] == 1
    # A timeout at the end of Q2 does not reach the Q3 kickoff.
    rows = [row(qtr=2, game_seconds_remaining=1805, half_seconds_remaining=5, quarter_seconds_remaining=5), timeout("B", qtr=2),
            row(qtr=3, game_seconds_remaining=1800, half_seconds_remaining=1800, quarter_seconds_remaining=900, play_type="kickoff", down=None)]
    c = m(rows)
    assert c.get("to.kickoffAll", 0) == 0


def test_dead_balls_read_the_moved_timeout_before_its_snap():
    # End to end: a late-listed defense timeout stamped with P's clock is P's dead ball, not N's.
    rows = [row(game_seconds_remaining=150, quarter_seconds_remaining=150), row(game_seconds_remaining=103, quarter_seconds_remaining=103),
            timeout("B", timeout_clock=103), row(game_seconds_remaining=95, quarter_seconds_remaining=95)]
    db = dec.dead_balls(frame(rows), 40)
    assert [s["timeoutCalled"] for s in db.snaps] == [0, 1, 0]
