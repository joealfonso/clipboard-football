"""M1 step 5d spec checks (test-writer), on hand-made nflverse rows.

- Milestone A3 (docs/specs/m1-step5d-clock-fixes.md): pipeline.caller.load.clock_flags and
  ot_both_possessed, one positive and one negative case per rule of each column.
- Train/serve parity: the shared scenarios in test/fixtures/step5d-flag-parity.json go through
  clock_flags here and through the sim's machine and toSituation in
  packages/sim/test/game/step5d-flags.spec-check.test.ts. Both sides must give the fixture's values.
- Milestone 0.2: the real side of every step 5d check (pipeline/game/checks5d.py) has one positive
  and one negative case, and a 2024+ row raises.
- D3: the K0c and K0x timeout splits are read from data/caller/config.json by bins.py.
- D5: every designed late-kneel mask state has 0 kneels in 2016-2023 and its neighbours have some,
  recounted from the local nflverse cache (skipped where the cache is cold, as in CI).

Rows are raw pbp rows (the columns pipeline.game.load reads) passed through season_rows, as the
pipelines read them. No row is a snap that carries its own timeout flag: that case (lost-challenge
timeouts charged after the play) is an open issue and is not pinned here.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import polars as pl
import pytest

from pipeline.caller.bins import bin_situation
from pipeline.caller.config import rules_json, with_rule_play_clock
from pipeline.caller.load import clock_flags, ot_both_possessed
from pipeline.game import checks5d
from pipeline.game import decisions as dec
from pipeline.game.load import COLS as RAW_COLS
from pipeline.game.load import season_rows

REPO = Path(__file__).resolve().parents[2]
STR = {"game_id", "season_type", "posteam", "defteam", "home_team", "away_team", "location", "play_type", "desc",
       "timeout_team", "time_of_day", "end_clock_time", "fixed_drive_result", "drive_time_of_possession"}


def clocks(qtr: int, clock: float) -> dict[str, float]:
    """quarter, half and game seconds left for `clock` seconds left in the quarter (overtime: period)."""
    if qtr >= 5:
        return {"quarter_seconds_remaining": clock, "half_seconds_remaining": clock, "game_seconds_remaining": clock}
    return {"quarter_seconds_remaining": clock, "half_seconds_remaining": clock + (900 if qtr in (1, 3) else 0),
            "game_seconds_remaining": clock + (4 - qtr) * 900}


class Game:
    """Raw pbp rows of one game, in play order, play_id 1, 2, ..."""

    def __init__(self, game_id: str = "2023_01_A_B", season: int = 2023) -> None:
        self.game_id, self.season, self.rows = game_id, season, []

    def add(self, **kw: Any) -> float:
        pid = float(len(self.rows) + 1)
        base: dict[str, Any] = {c: None for c in RAW_COLS}
        base.update(game_id=self.game_id, play_id=pid, season=self.season, season_type="REG", home_team="A", away_team="B",
                    timeout=0, incomplete_pass=0, out_of_bounds=0, penalty=0, touchdown=0, interception=0, fumble_lost=0,
                    qb_kneel=0, qb_spike=0, extra_point_attempt=0, two_point_attempt=0, kickoff_attempt=0, desc="",
                    score_differential=0, posteam_timeouts_remaining=3, defteam_timeouts_remaining=3, fixed_drive=1, result=0)
        base.update(kw)
        self.rows.append(base)
        return pid

    def snap(self, team: str, qtr: int, clock: float, play_type: str = "run", **kw: Any) -> float:
        other = "B" if team == "A" else "A"
        fields: dict[str, Any] = {"down": 1, "ydstogo": 10, "yardline_100": 60, **kw}
        return self.add(posteam=team, defteam=other, qtr=qtr, play_type=play_type, **clocks(qtr, clock), **fields)

    def timeout(self, team: str, qtr: int, clock: float) -> float:
        m, s = divmod(int(clock), 60)
        return self.add(qtr=qtr, timeout=1, timeout_team=team, play_type="no_play", desc=f"Timeout #1 by {(team * 3)[:3]} at {m:02d}:{s:02d}.", **clocks(qtr, clock))

    def kickoff(self, kicker: str, qtr: int, clock: float) -> float:
        receiver = "B" if kicker == "A" else "A"
        return self.add(posteam=receiver, defteam=kicker, qtr=qtr, play_type="kickoff", kickoff_attempt=1, **clocks(qtr, clock))

    def try_(self, team: str, qtr: int, clock: float) -> float:
        other = "B" if team == "A" else "A"
        return self.add(posteam=team, defteam=other, qtr=qtr, play_type="extra_point", extra_point_attempt=1, **clocks(qtr, clock))


def raw(*games: Game) -> pl.DataFrame:
    rows = [r for g in games for r in g.rows]
    return pl.DataFrame(rows, schema={c: (pl.String if c in STR else pl.Float64) for c in RAW_COLS})


def flags_of(*games: Game) -> dict[tuple[str, float], tuple[int, int]]:
    f = clock_flags(raw(*games))
    return {(r["game_id"], r["play_id"]): (r["clock_running"], r["ot_both_possessed"]) for r in f.iter_rows(named=True)}


# ---------------------------------------------------------------- train/serve parity (shared fixture)

PARITY = json.loads((REPO / "test/fixtures/step5d-flag-parity.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("sc", PARITY["scenarios"], ids=[s["id"] for s in PARITY["scenarios"]])
def test_parity_scenario_through_clock_flags(sc: dict[str, Any]) -> None:
    g = Game()
    names = {"home": "A", "away": "B", "first": "A", "second": "B"}
    want: list[tuple[float, dict[str, int], str]] = []
    qtr, clock = (5, 600) if sc["start"] == "overtime" else (sc["start"]["period"], 900)
    for st in sc["steps"]:
        if "timeout" in st:
            g.timeout(names[st["timeout"]], qtr, clock)
            continue
        if "kickoff" in st:
            g.kickoff(names[st["kickoff"]], qtr, clock)
            continue
        if "try" in st:
            want.append((g.try_(names[st["try"]], qtr, clock), st["expect"], json.dumps(st)))
            continue
        qtr, clock = st["qtr"], st["clock"]
        kind = st["play"]
        extra: dict[str, Any] = {
            "run": {"play_type": "run"},
            "runOOB": {"play_type": "run", "out_of_bounds": 1},
            "incomplete": {"play_type": "pass", "incomplete_pass": 1},
            "punt": {"play_type": "punt", "punt_attempt": 1},
            "td": {"play_type": "run", "touchdown": 1},
        }[kind]
        want.append((g.snap(names[st["snap"]], qtr, clock, **extra), st["expect"], json.dumps(st)))
        # The play's own duration: the next row is a few seconds later (unless the scenario says).
        clock = max(clock - 5, 0)
    got = flags_of(g)
    for pid, exp, tag in want:
        assert got[(g.game_id, pid)] == (exp["clockRunning"], exp["otBothPossessed"]), tag


# ---------------------------------------------------------------- A3: clock_running, rule by rule


def test_clock_running_in_bounds_run_then_snap_is_1_incompletion_is_0():
    g = Game()
    g.snap("A", 3, 600)
    pos = g.snap("A", 3, 570)  # after an in-bounds run
    g.snap("A", 3, 540, play_type="pass", incomplete_pass=1)
    neg = g.snap("A", 3, 535)  # after an incompletion
    f = flags_of(g)
    assert f[(g.game_id, pos)][0] == 1
    assert f[(g.game_id, neg)][0] == 0


def test_clock_running_timeout_in_the_dead_ball_makes_0():
    g = Game()
    g.snap("A", 3, 600)
    g.timeout("B", 3, 570)
    neg = g.snap("A", 3, 570)
    g.snap("A", 3, 540)
    pos = g.snap("A", 3, 510)  # same reading without the timeout
    f = flags_of(g)
    assert f[(g.game_id, neg)][0] == 0
    assert f[(g.game_id, pos)][0] == 1


def test_clock_running_timeout_listed_after_its_snap_is_read_in_clock_order():
    # Revision 1's clock order: the timeout stamped with the snap's clock (0:50) belongs before it,
    # even though nflverse lists it after.
    g = Game()
    g.snap("A", 4, 80)
    neg = g.snap("A", 4, 50)
    g.timeout("B", 4, 50)
    g.snap("A", 4, 40)
    f = flags_of(g)
    assert f[(g.game_id, neg)][0] == 0


def test_clock_running_is_0_on_a_try_and_on_a_kickoff():
    g = Game()
    g.snap("A", 3, 600)
    g.snap("A", 3, 570, touchdown=1)
    t = g.try_("A", 3, 565)
    k = g.kickoff("A", 3, 565)
    s = g.snap("B", 3, 560)
    g.snap("B", 3, 530)
    pos = g.snap("B", 3, 500)
    f = flags_of(g)
    assert f[(g.game_id, t)][0] == 0
    assert f[(g.game_id, k)][0] == 0
    assert f[(g.game_id, s)][0] == 0
    assert f[(g.game_id, pos)][0] == 1


def test_clock_running_period_start_and_two_minute_warning_make_0():
    g = Game()
    g.snap("A", 1, 30)
    g.snap("A", 1, 3)
    start = g.snap("A", 2, 900)
    g.snap("A", 2, 124)
    warned = g.snap("A", 2, 115)
    g.snap("A", 2, 100)
    pos = g.snap("A", 2, 90)  # in-bounds run inside the 2:00 window: still running
    f = flags_of(g)
    assert f[(g.game_id, start)][0] == 0
    assert f[(g.game_id, warned)][0] == 0
    assert f[(g.game_id, pos)][0] == 1


def test_clock_running_out_of_bounds_restarts_only_outside_the_windows():
    g = Game()
    g.snap("A", 4, 600)
    g.snap("A", 4, 570, out_of_bounds=1)
    outside = g.snap("A", 4, 540)
    g.snap("A", 4, 200, out_of_bounds=1)
    inside = g.snap("A", 4, 180)
    f = flags_of(g)
    assert f[(g.game_id, outside)][0] == 1
    assert f[(g.game_id, inside)][0] == 0


def test_clock_running_change_of_possession_and_turnovers_make_0():
    g = Game()
    g.snap("A", 3, 600)
    g.snap("A", 3, 570, play_type="pass", interception=1)
    neg = g.snap("B", 3, 560)
    g.snap("B", 3, 530, play_type="qb_spike", qb_spike=1)
    spike = g.snap("B", 3, 528)
    f = flags_of(g)
    assert f[(g.game_id, neg)][0] == 0
    assert f[(g.game_id, spike)][0] == 0


def test_clock_flags_reads_regular_season_rows_only():
    g = Game()
    g.snap("A", 3, 600)
    g.snap("A", 3, 570)
    post = Game("2023_19_A_B")
    post.snap("A", 3, 600)
    post.snap("A", 3, 570)
    for r in post.rows:
        r["season_type"] = "POST"
    f = clock_flags(raw(g, post))
    assert set(f["game_id"].to_list()) == {g.game_id}


# ---------------------------------------------------------------- A3: ot_both_possessed, rule by rule


def ot_rows(spec: list[tuple[int, str | None, str | None, str | None]], game: str = "g") -> list[dict[str, Any]]:
    return [{"game_id": game, "qtr": q, "posteam": p, "defteam": d, "play_type": t} for q, p, d, t in spec]


def test_ot_flag_regulation_rows_are_0_even_after_both_teams_had_the_ball():
    rows = ot_rows([(1, "A", "B", "run"), (2, "B", "A", "run"), (4, "A", "B", "pass")])
    assert ot_both_possessed(rows) == [0, 0, 0]


def test_ot_flag_first_team_snaps_0_second_team_first_snap_1_and_it_stays():
    rows = ot_rows([
        (4, "B", "A", "run"),
        (5, "A", "B", "kickoff"),  # nflverse: posteam is the receiver, A is the first team
        (5, "A", "B", "run"),
        (5, "A", "B", "pass"),
        (5, "A", "B", "field_goal"),
        (5, "B", "A", "kickoff"),  # A kicks to B: on after this row
        (5, "B", "A", "run"),
        (5, "A", "B", "run"),
    ])
    assert ot_both_possessed(rows) == [0, 0, 0, 0, 0, 0, 1, 1]


def test_ot_flag_second_team_try_after_its_touchdown_is_1():
    rows = ot_rows([
        (5, "A", "B", "kickoff"),
        (5, "A", "B", "run"),
        (5, "A", "B", "extra_point"),  # the first team's try: 0
        (5, "B", "A", "kickoff"),
        (5, "B", "A", "run"),
        (5, "B", "A", "extra_point"),
    ])
    assert ot_both_possessed(rows) == [0, 0, 0, 0, 1, 1]


def test_ot_flag_a_first_team_punt_turns_it_on_for_the_rows_after():
    rows = ot_rows([(5, "A", "B", "kickoff"), (5, "A", "B", "run"), (5, "A", "B", "punt"), (5, "B", "A", "run")])
    assert ot_both_possessed(rows) == [0, 0, 0, 1]
    # A punt the first team recovers (muffed): the second team had its opportunity, so the first
    # team's next snap is 1 (spec A: the flag turns on when the other team "receives a kick from the first
    # team"). Without the punt it stays 0.
    rows = ot_rows([(5, "A", "B", "kickoff"), (5, "A", "B", "punt"), (5, "A", "B", "run")])
    assert ot_both_possessed(rows) == [0, 0, 1]
    rows = ot_rows([(5, "A", "B", "kickoff"), (5, "A", "B", "pass"), (5, "A", "B", "run")])
    assert ot_both_possessed(rows) == [0, 0, 0]


def test_ot_flag_onside_kick_recovered_by_the_first_team_is_the_second_teams_opportunity():
    # The first team kicks (nflverse posteam: the receiving team B); the first team recovers and snaps.
    rows = ot_rows([(5, "A", "B", "kickoff"), (5, "A", "B", "run"), (5, "B", "A", "kickoff"), (5, "A", "B", "run")])
    assert ot_both_possessed(rows) == [0, 0, 0, 1]
    # Negative: a second-team kickoff (to the first team) is not the second team's opportunity.
    rows = ot_rows([(5, "A", "B", "kickoff"), (5, "A", "B", "run")])
    assert ot_both_possessed(rows) == [0, 0]


def test_ot_flag_stays_on_through_later_postseason_periods_and_resets_per_game():
    rows = ot_rows([(5, "A", "B", "kickoff"), (5, "A", "B", "punt"), (5, "B", "A", "run"), (6, "B", "A", "run"), (7, "A", "B", "kickoff"), (7, "A", "B", "run"), (9, "B", "A", "run")])
    rows += ot_rows([(5, "A", "B", "kickoff"), (5, "A", "B", "run")], game="h")
    assert ot_both_possessed(rows) == [0, 0, 1, 1, 1, 1, 1, 0, 0]


def test_ot_flag_rows_without_a_team_do_not_turn_it_on():
    rows = ot_rows([(5, "A", "B", "kickoff"), (5, None, None, None), (5, "A", "B", "run")])
    assert ot_both_possessed(rows) == [0, 0, 0]


# ---------------------------------------------------------------- 0.2: checks5d measures


def measure(*games: Game) -> dict[str, int]:
    return checks5d.measure(season_rows(raw(*games)))


def test_a_2024_row_raises():
    g = Game()
    g.snap("A", 1, 600)
    h = Game("2024_01_A_B", season=2024)
    h.snap("A", 1, 600)
    with pytest.raises(dec.HoldoutLeak):
        measure(g, h)
    ok = Game("2023_02_A_B")
    ok.snap("A", 1, 600)
    measure(g, ok)  # 2016-2023 only: no raise


def trailer_0to(**kw: Any) -> dict[str, Any]:
    return {"score_differential": -4, "posteam_timeouts_remaining": 0, **kw}


def test_spike_trail0to():
    pos = Game()
    pos.snap("A", 4, 30, play_type="qb_spike", qb_spike=1, **trailer_0to())
    assert measure(pos)["spike.trail0TO"] == 1
    for kw in ({"score_differential": -9}, {"posteam_timeouts_remaining": 1}, {"score_differential": 0}):
        neg = Game()
        neg.snap("A", 4, 30, play_type="qb_spike", qb_spike=1, **{**trailer_0to(), **kw})
        assert measure(neg).get("spike.trail0TO", 0) == 0, kw
    q3 = Game()
    q3.snap("A", 3, 30, play_type="qb_spike", qb_spike=1, **trailer_0to())
    assert measure(q3).get("spike.trail0TO", 0) == 0
    assert measure(q3)["spike.all"] == 1


def test_spike_running_and_stopped_0to():
    g = Game()
    g.snap("A", 4, 90, **trailer_0to())
    g.snap("A", 4, 70, play_type="qb_spike", qb_spike=1, **trailer_0to())  # after an in-bounds run: running
    g.snap("A", 4, 69, play_type="qb_spike", qb_spike=1, **trailer_0to())  # after a spike: stopped
    c = measure(g)
    assert (c["spike.running0TO.snaps"], c["spike.running0TO.spikes"]) == (1, 1)
    assert (c["spike.stopped0TO.snaps"], c["spike.stopped0TO.spikes"]) == (2, 1)
    # A defensive timeout in the dead ball stops the clock: the same spike is a stopped-clock snap.
    t = Game("2023_03_A_B")
    t.snap("A", 4, 90, **trailer_0to())
    t.timeout("B", 4, 70)
    t.snap("A", 4, 70, play_type="qb_spike", qb_spike=1, **trailer_0to())
    c = measure(t)
    assert c.get("spike.running0TO.snaps", 0) == 0
    assert (c["spike.stopped0TO.snaps"], c["spike.stopped0TO.spikes"]) == (2, 1)
    # Negative: outside the final 2:00, or 4th down, or a timeout left: not counted.
    for kw, clock in (({}, 200), ({"down": 4}, 70), ({"posteam_timeouts_remaining": 1}, 70)):
        n = Game()
        n.snap("A", 4, clock + 20, **trailer_0to())
        n.snap("A", 4, clock, play_type="qb_spike", qb_spike=1, **{**trailer_0to(), **kw})
        c = measure(n)
        assert c.get("spike.running0TO.spikes", 0) == 0, kw
        assert c.get("spike.stopped0TO.spikes", 0) == 0, kw


def test_gap_trail0to():
    pos = Game()
    pos.snap("A", 4, 55, **trailer_0to())
    pos.snap("A", 4, 38, **trailer_0to())  # 17 s: a long gap
    pos.snap("A", 4, 30, **trailer_0to())  # 8 s: short
    c = measure(pos)
    assert (c["gap.trail0TO.gaps"], c["gap.trail0TO.hits"]) == (2, 1)
    neg = Game()
    neg.snap("A", 4, 55, **trailer_0to(posteam_timeouts_remaining=1))
    neg.snap("A", 4, 38, **trailer_0to())
    early = Game("2023_02_A_B")
    early.snap("A", 4, 80, **trailer_0to())  # first snap before 1:00: only the 2:00 version counts it
    early.snap("A", 4, 62, **trailer_0to())
    c = measure(neg, early)
    assert c.get("gap.trail0TO.gaps", 0) == 0
    assert (c["gap.trail0TO.final2.gaps"], c["gap.trail0TO.final2.hits"]) == (1, 1)


def test_kneel_not_leading():
    pos = Game()
    pos.snap("A", 4, 60, play_type="qb_kneel", qb_kneel=1, score_differential=0)
    pos.snap("A", 4, 50, play_type="qb_kneel", qb_kneel=1, score_differential=-2)
    c = measure(pos)
    assert (c["kneel.notLeading"], c["kneel.notLeading.tied"], c["kneel.notLeading.trail1to8"]) == (2, 1, 1)
    neg = Game()
    neg.snap("A", 4, 47, play_type="qb_kneel", qb_kneel=1, score_differential=0)  # 0:47: not more than 47 s
    neg.snap("A", 4, 100, play_type="qb_kneel", qb_kneel=1, score_differential=3)  # leading
    neg.snap("A", 3, 100, play_type="qb_kneel", qb_kneel=1, score_differential=-3)  # Q3
    assert measure(neg).get("kneel.notLeading", 0) == 0


def test_kneel_then_play_by_bucket():
    g = Game()
    for lead, drive in ((4, 1), (12, 2), (0, 3), (8, 4), (9, 5), (-3, 6)):
        g.snap("A", 4, 100 - drive, play_type="qb_kneel", qb_kneel=1, score_differential=lead, fixed_drive=drive)
        g.snap("A", 4, 90 - drive, play_type="pass", score_differential=lead, fixed_drive=drive)
        g.snap("A", 4, 80 - drive, play_type="run", score_differential=lead, fixed_drive=drive)  # counted once per possession
    c = measure(g)
    assert (c["kneel.thenPlay.lead1to8"], c["kneel.thenPlay.lead9"], c["kneel.thenPlay.notLeading"]) == (2, 2, 2)
    neg = Game()
    neg.snap("A", 4, 100, play_type="qb_kneel", qb_kneel=1, score_differential=4, fixed_drive=1)
    neg.snap("A", 4, 60, play_type="qb_kneel", qb_kneel=1, score_differential=4, fixed_drive=1)
    neg.snap("A", 4, 50, play_type="run", score_differential=4, fixed_drive=2)  # another possession
    assert measure(neg).get("kneel.thenPlay.lead1to8", 0) == 0


def test_kneel_4th_late():
    pos = Game()
    pos.snap("A", 4, 30, play_type="qb_kneel", qb_kneel=1, down=4, score_differential=3)
    assert measure(pos)["kneel.4thLate"] == 1
    neg = Game()
    neg.snap("A", 4, 10, play_type="qb_kneel", qb_kneel=1, down=4, score_differential=3)  # 10 s: not more than 10
    neg.snap("A", 4, 30, play_type="qb_kneel", qb_kneel=1, down=3, score_differential=3)
    assert measure(neg).get("kneel.4thLate", 0) == 0


def test_try_ot_down2():
    def game(two: bool, flag_on: bool, diff: float) -> Game:
        g = Game()
        g.kickoff("B", 5, 600)
        g.snap("A", 5, 600)
        if flag_on:
            g.snap("A", 5, 570, play_type="punt")
            g.snap("B", 5, 560, touchdown=1, score_differential=diff + 6)
        g.add(posteam="B" if flag_on else "A", defteam="A" if flag_on else "B", qtr=5, play_type="pass" if two else "extra_point",
              two_point_attempt=1 if two else 0, extra_point_attempt=0 if two else 1, score_differential=diff, **clocks(5, 550))
        return g
    c = measure(game(True, True, -2))
    assert (c["try.otDown2.tries"], c["try.otDown2.two"]) == (1, 1)
    c = measure(game(False, True, -2))
    assert (c["try.otDown2.tries"], c.get("try.otDown2.two", 0)) == (1, 0)
    assert measure(game(True, True, -1)).get("try.otDown2.tries", 0) == 0
    assert measure(game(True, False, -2)).get("try.otDown2.tries", 0) == 0


def test_real_side_file_is_2016_2023_and_has_every_key_the_checks_read():
    real = json.loads((REPO / "data/game/checks5d.real.json").read_text(encoding="utf-8"))
    assert real["seasons"] == list(range(2016, 2024))
    for k in ("games", "spike.trail0TO", "spike.running0TO.snaps", "spike.running0TO.spikes", "spike.stopped0TO.snaps",
              "gap.trail0TO.gaps", "gap.trail0TO.hits", "kneel.notLeading", "kneel.thenPlay.lead1to8", "kneel.thenPlay.lead9",
              "kneel.4thLate"):
        assert k in real["counts"], k


# ---------------------------------------------------------------- D3: the K0c and K0x splits live in data (bins.py)

CALLER_CFG = with_rule_play_clock(json.loads((REPO / "data/caller/config.json").read_text(encoding="utf-8")), rules_json())


def kneel_gap(sit: dict[str, Any], **patch: int) -> str | None:
    dims = {**CALLER_CFG["dimensions"], "kneelGap": {**CALLER_CFG["dimensions"]["kneelGap"], **patch}}
    return bin_situation(sit, dims)["kneelGap"]


def caller_sit(**kw: Any) -> dict[str, Any]:
    base = {"phase": "scrimmage", "down": 1, "yardsToGo": 10, "yardLine100": 50, "scoreDiff": 2, "quarter": 4, "secondsLeftInHalf": 80,
            "secondsLeftInGame": 80, "offenseTimeouts": 1, "defenseTimeouts": 2, "clockRunning": 0, "otBothPossessed": 0}
    return {**base, **kw}


def test_d3_concede_split_in_data_moves_the_bin():
    assert CALLER_CFG["dimensions"]["kneelGap"]["concedeSplit"] == 2
    s = caller_sit()
    assert kneel_gap(s) == "K0c.d23"
    assert kneel_gap(s, concedeSplit=3) == "K0c.d012"
    # 1:40, defense 1 timeout: three kneels (122 s) run it out only if the defense concedes: K0c.
    assert kneel_gap(caller_sit(defenseTimeouts=1, secondsLeftInGame=100, secondsLeftInHalf=100)) == "K0c.d01"


def test_d3_k0x_split_in_data_moves_the_bin():
    # 2nd down at 1:50: two kneels (82 s) cannot run it out even if the defense concedes: K0x.
    s = caller_sit(down=2, secondsLeftInGame=110, secondsLeftInHalf=110, defenseTimeouts=1)
    assert CALLER_CFG["dimensions"]["kneelGap"]["k0xSplit"] == 1
    assert kneel_gap(s) == "K0x.d123"
    assert kneel_gap(s, k0xSplit=2) == "K0x.d01"
    assert kneel_gap({**s, "defenseTimeouts": 0}) == "K0x.d0"


# ---------------------------------------------------------------- D5: the masked states have 0 real kneels


def _real_rows() -> pl.DataFrame:
    """2016-2023 regular-season rows from the local nflverse cache; skipped where the cache is cold (CI)."""
    from pipeline import cache
    from pipeline.game.load import load_rows
    from pipeline.sources import NflreadpySource

    try:
        return load_rows(NflreadpySource(cache.cache_dir()), list(range(2016, 2024)))
    except Exception as e:  # noqa: BLE001 - a cold cache tries the (blocked) network
        pytest.skip(f"no warm nflverse cache: {e}")


def test_d5_every_masked_late_state_has_0_real_kneels_and_its_neighbours_have_some():
    rows = _real_rows()
    snaps = rows.filter((pl.col("qtr") >= 4) & pl.col("down").is_not_null() & ~pl.col("is_try")
                        & pl.col("play_type").is_in(["run", "pass", "punt", "field_goal", "qb_kneel", "qb_spike"]))
    assert snaps["season"].max() <= 2023
    d, secs, yl = pl.col("score_differential"), pl.col("game_seconds_remaining"), pl.col("yardline_100")
    kneel = pl.col("play_type") == "qb_kneel"
    mask = json.loads((REPO / "data/game/config.json").read_text(encoding="utf-8"))["clockRules"]["callerMasks"]["lateKneel"]
    assert mask["quarterMin"] == 4 and len(mask["states"]) == 3
    for st in mask["states"]:
        c = pl.lit(True)
        if "scoreMin" in st:
            c = c & (d >= st["scoreMin"])
        if "scoreMax" in st:
            c = c & (d <= st["scoreMax"])
        if "secondsAbove" in st:
            c = c & (secs > st["secondsAbove"])
        if "yardLine100Above" in st:
            c = c & (yl > st["yardLine100Above"])
        s = snaps.filter(c)
        assert s.height > 1000, st
        assert s.filter(kneel).height == 0, st
        assert st["realKneels"] == 0
        # The engineer's snap count used the caller's rows; it is within 1% of this reading.
        assert abs(s.height - st["realSnaps"]) <= 0.01 * st["realSnaps"], (st, s.height)
    # Neighbouring states (DECISIONS.md, milestone D): real kneels, so not masked.
    for c, at_least in (((d <= -9) & (secs <= 47), 30), ((d >= -2) & (d <= -1) & (yl <= 20), 30), ((d == 0) & (secs > 47), 15)):
        assert snaps.filter(c & kneel).height >= at_least
