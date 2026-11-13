"""Test-writer spec checks for M1 step 5 milestone C (docs/specs/m1-step5-full-game-and-calibration.md):
C2 (byte-identical rebuild), C3 (no 2024, 2025 or 2026 row in any table) and C4 (tempo backoff at N
and N - 1), on hand-made dead balls. The real rebuild needs the warm nflverse cache and is not run here."""

from __future__ import annotations

import json

import pytest

from pipeline.caller.build import dumps
from pipeline.caller.config import REPO
from pipeline.game import decisions as dec

CFG = json.loads((REPO / "data/game/config.json").read_text())
S = CFG["seasons"]
TRAIN_W = {s: 1.0 for s in range(S["from"], S["to"] + 1)}
TEMPO_W = {s: 1.0 for s in range(S["tempoFrom"], S["to"] + 1)}


def snap(season: int, i: int, *, runoff: int | None = 30, off_to: int = 0, def_to: int = 0) -> dict:
    left = 3000 - 37 * i
    return {"season": season, "base": {"quarter": 1 if left > 2700 else 2 if left > 1800 else 3, "secondsLeftInHalf": left - 1800 if left > 1800 else left,
                                       "secondsLeftInGame": left, "down": 1 + i % 4, "clockRunning": 1},
            "scoreDiff": (i % 15) - 7, "offenseTimeouts": 1 + i % 3, "defenseTimeouts": 1 + (i + 1) % 3, "prevKneel": 0, "restart": i % 3,
            "timeoutCalled": 0, "offenseTimeout": off_to, "defenseTimeout": def_to, "runoff": runoff}


def kickoff(season: int, i: int, onside: bool) -> dict:
    return {"season": season, "quarter": 4, "secondsLeftInGame": 100 + i, "secondsLeftInHalf": 100 + i, "scoreDiff": -10, "onside": onside}


def dead_balls(seasons: range, n: int) -> dec.DeadBalls:
    snaps = [snap(s, i, runoff=(i * 7) % 41, off_to=int(i % 11 == 0), def_to=int(i % 13 == 0)) for s in seasons for i in range(n)]
    kicks = [kickoff(s, i, i % 5 == 0) for s in seasons for i in range(n)]
    special = [(s, role, int(i % 9 == 0), 3) for s in seasons for i in range(n) for role in ("kickKicker", "kickReceiver", "tryOffense", "tryDefense")]
    return dec.DeadBalls(snaps=snaps, kickoffs=kicks, special=special)


def test_c2_tables_are_byte_identical_on_rerun():
    a = dec.build_tables(dead_balls(range(2016, 2024), 200), CFG, TRAIN_W, TEMPO_W)
    b = dec.build_tables(dead_balls(range(2016, 2024), 200), CFG, TRAIN_W, TEMPO_W)
    for name in ("tempo", "timeouts", "onside"):
        assert dumps(a[name]) == dumps(b[name])
        assert a[name]["cells"], name


@pytest.mark.parametrize("season", [2024, 2025, 2026])
def test_c3_a_holdout_season_never_reaches_a_table(season: int):
    with pytest.raises(dec.HoldoutLeak):
        dec.check_holdout({2023, season}, S["neverTrainFrom"])
    clean = dec.build_tables(dead_balls(range(2016, 2024), 200), CFG, TRAIN_W, TEMPO_W)
    mixed_db = dead_balls(range(2016, 2024), 200)
    leak = dead_balls(range(season, season + 1), 400)
    mixed_db.snaps += leak.snaps
    mixed_db.kickoffs += leak.kickoffs
    mixed_db.special += leak.special
    mixed = dec.build_tables(mixed_db, CFG, TRAIN_W, TEMPO_W)
    # Adding holdout rows changes nothing in any table: counts, cells or the per-role rates.
    for name in ("tempo", "timeouts", "onside"):
        assert dumps(mixed[name]) == dumps(clean[name]), name
        assert all(s < 2024 for s in mixed[name]["seasons"]), name


def test_c4_tempo_backoff_stores_a_cell_at_n_and_not_at_n_minus_1():
    levels = [{"dims": ["score3"]}, {"dims": []}]
    obs = [({"score3": "T"}, 10, 1.0)] * 5 + [({"score3": "L"}, 20, 1.0)] * 4
    cells = dec.fit_hist(obs, levels, 5, 40, 10_000)
    assert "T" in cells[0] and "L" not in cells[0]
    assert cells[0]["T"][10] == 10_000 and sum(cells[0]["T"]) == 10_000
    # The parent pools all nine plays: 5 at 10 s, 4 at 20 s, integer weights summing to 10,000.
    assert cells[1][""][10] == 5556 and cells[1][""][20] == 4444


def test_c4_tempo_is_fitted_on_the_timestamp_seasons_only():
    # tempoFrom 2022: a 2016 run-off never reaches the tempo table, while the timeout table uses it.
    only_old = dec.DeadBalls(snaps=[snap(2016, i) for i in range(400)])
    t = dec.build_tables(only_old, CFG, TRAIN_W, TEMPO_W)
    assert t["tempo"]["snaps"] == 0
    assert t["tempo"]["seasons"] == [2022, 2023]
    assert t["timeouts"]["deadBalls"] == 400
