"""M1 step 5 pipeline: coach decision fits (C3, C4), the team-name check (B3) and the game
aggregates' counting rules, on hand-made frames."""

from __future__ import annotations

import json
from pathlib import Path

import polars as pl
import pytest

from pipeline.caller.config import REPO
from pipeline.game import actuals
from pipeline.game import decisions as dec

CFG = json.loads((REPO / "data/game/config.json").read_text())


def row(**kw):
    base = {c: None for c in dec.ROW_COLS}
    base.update(season=2023, game_id="g1", qtr=1, down=1, ydstogo=10, yardline_100=75, game_seconds_remaining=3000,
                half_seconds_remaining=1200, posteam="A", defteam="B", play_type="run", timeout_team=None, is_timeout=False,
                challenge=False, two_min=False, is_try=False, incomplete_pass=0, qb_spike=0, qb_kneel=0, interception=0,
                fumble_lost=0, penalty=0, out_of_bounds=0, score_differential=0, posteam_timeouts_remaining=3,
                defteam_timeouts_remaining=3, duration=5.0, onside=False)
    base.update(kw)
    return base


def frame(rows):
    return pl.DataFrame(rows, schema={c: (pl.String if c in ("game_id", "posteam", "defteam", "play_type", "timeout_team") else
                                          pl.Boolean if c in ("is_timeout", "challenge", "two_min", "is_try", "onside") else pl.Float64)
                                      for c in dec.ROW_COLS})


def test_runoff_is_clock_change_minus_duration():
    db = dec.dead_balls(frame([row(game_seconds_remaining=3000, duration=5.0), row(game_seconds_remaining=2960)]), 40)
    assert db.snaps[1]["runoff"] == 35
    assert db.snaps[1]["base"]["clockRunning"] == 1


def test_runoff_clipped_not_measured_after_incompletion_and_measured_before_a_timeout():
    rows = [row(game_seconds_remaining=3000, duration=1.0), row(game_seconds_remaining=2956)]
    assert dec.dead_balls(frame(rows), 40).snaps[1]["runoff"] == 40
    # More than 5 s past the play clock is a measurement error, not a run-off: not measured.
    far = [row(game_seconds_remaining=3000, duration=1.0), row(game_seconds_remaining=2950)]
    assert dec.dead_balls(frame(far), 40).snaps[1]["runoff"] is None
    inc = [row(incomplete_pass=1), row(game_seconds_remaining=2994)]
    s = dec.dead_balls(frame(inc), 40).snaps[1]
    assert s["base"]["clockRunning"] == 0 and s["runoff"] is None
    to = [row(), row(play_type=None, is_timeout=True, timeout_team="B", posteam=None), row(game_seconds_remaining=2980, defteam_timeouts_remaining=2)]
    s = dec.dead_balls(frame(to), 40).snaps[1]
    # Step 5 revision 1: with a timeout called, the run-off is the time that ran before it.
    assert s["runoff"] == 15 and s["timeoutCalled"] == 1 and s["defenseTimeout"] == 1 and s["offenseTimeout"] == 0
    # Timeouts left are counted before the timeout.
    assert s["defenseTimeouts"] == 3


def test_timeout_attribution_to_offense_and_challenge_excluded():
    rows = [row(), row(play_type=None, is_timeout=True, timeout_team="A", posteam=None), row(game_seconds_remaining=2990, posteam_timeouts_remaining=2),
            row(play_type=None, is_timeout=True, timeout_team="B", posteam=None, challenge=True), row(game_seconds_remaining=2980)]
    db = dec.dead_balls(frame(rows), 40)
    assert db.snaps[1]["offenseTimeout"] == 1 and db.snaps[1]["defenseTimeout"] == 0
    assert db.snaps[2]["defenseTimeout"] == 0 and db.challenge_timeouts == 1


def test_two_minute_warning_read_from_clock():
    rows = [row(qtr=2, half_seconds_remaining=125, game_seconds_remaining=1925), row(qtr=2, half_seconds_remaining=118, game_seconds_remaining=1918)]
    assert dec.dead_balls(frame(rows), 40).snaps[1]["base"]["clockRunning"] == 0


def test_onside_detection_rule():
    import pipeline.game.load as load

    df = pl.DataFrame({c: [None] for c in load.COLS}).with_columns(
        play_type=pl.lit("kickoff"), desc=pl.lit("1-K.Kicker kicks onside 11 yards from X 35 to X 46."), season_type=pl.lit("REG"),
        game_id=pl.lit("g"), play_id=pl.lit(1.0))
    assert load.season_rows(df)["onside"].to_list() == [True]
    df2 = df.with_columns(desc=pl.lit("1-K.Kicker kicks 65 yards from X 35 to end zone, Touchback."))
    assert load.season_rows(df2)["onside"].to_list() == [False]


def test_backoff_stores_a_cell_at_n_and_not_at_n_minus_1():
    lv = [{"dims": ["score3"]}, {"dims": []}]
    obs = [({"score3": "T"}, {}, 1, 1.0)] * 5 + [({"score3": "L"}, {}, 0, 1.0)] * 4
    cells = dec.fit_rate(obs, lv, 5)
    assert "T" in cells[0] and "L" not in cells[0]
    assert cells[0]["T"] == [1_000_000, 5]
    assert cells[1][""][1] == 9


def test_holdout_seasons_never_reach_a_fit():
    db = dec.DeadBalls(snaps=[{"season": 2024, "base": {"quarter": 1, "secondsLeftInHalf": 1000, "secondsLeftInGame": 2800, "down": 1, "clockRunning": 1},
                               "scoreDiff": 0, "offenseTimeouts": 3, "defenseTimeouts": 3, "prevKneel": 0, "restart": 0, "offenseTimeout": 0,
                               "defenseTimeout": 0, "runoff": 30}], kickoffs=[])
    w = {s: 1.0 for s in range(2016, 2024)}
    # The training filter drops the 2024 row, so nothing is fitted from it ...
    t = dec.build_tables(db, CFG, w, {2022: 1.0, 2023: 1.0})
    assert t["tempo"]["snaps"] == 0
    # ... and a frame that does reach a fit with a holdout season raises.
    with pytest.raises(dec.HoldoutLeak):
        dec.check_holdout({2023, 2024}, CFG["seasons"]["neverTrainFrom"])


# The real-name list is local only (gitignored); CI skips these two tests.
def test_team_names_have_no_real_nfl_name():
    real_names = pytest.importorskip("pipeline.game.real_names")
    assert real_names.check_file(REPO / "data/teams/names.json") == []


def test_a_real_nickname_or_city_fails_the_check():
    # Real names are read from the local-only list itself, so none is written in this repo.
    real_names = pytest.importorskip("pipeline.game.real_names")
    collisions = real_names.collisions
    plural = sorted(n for n in real_names.NICKNAMES if n.isalpha() and n.endswith("s"))[0]
    city = sorted(real_names.CITIES)[0]
    assert collisions([{"place": "Harborview", "nickname": plural.title()}])
    assert collisions([{"place": city.title(), "nickname": "Lanterns"}])
    assert collisions([{"place": "Harborview", "nickname": plural.title()[:-1]}])


def test_kickoff_fouls_count_only_as_the_designed_kickoff_fouls():
    ecfg = json.loads((REPO / "data/engine/config.json").read_text())
    assert actuals.supported_id("Illegal Block Above the Waist", "offense", "kickoff", ecfg) == "returnTeamIllegalBlock"
    assert actuals.supported_id("Offensive Holding", "defense", "kickoff", ecfg) is None
    assert actuals.supported_id("False Start", "offense", "run", ecfg) == "falseStart"


def test_timeouts_before_kickoffs_and_tries_are_attributed_by_role():
    rows = [row(), row(play_type=None, is_timeout=True, timeout_team="B", posteam=None),
            row(play_type="kickoff", posteam="B", defteam="A", down=None, posteam_timeouts_remaining=2)]
    db = dec.dead_balls(frame(rows), 40)
    assert (2023, "kickReceiver", 1, 3) in db.special and (2023, "kickKicker", 0, 3) in db.special
