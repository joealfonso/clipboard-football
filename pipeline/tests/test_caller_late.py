"""M1 step 5a: late-game score bins (A1, B2, B3)."""

from __future__ import annotations

import json

import polars as pl
import pytest

from pipeline.caller.bins import bin_situation, level_key
from pipeline.caller.config import REPO, TablesConfigMismatch, check_tables, rules_json, with_rule_play_clock
from pipeline.caller.fit import HoldoutLeak, fit_factor, label_col

# Amended by step 5b: loaded with the rule set's play clock, as every loader does (kneelOut needs it).
CFG = with_rule_play_clock(json.loads((REPO / "data/caller/config.json").read_text()), rules_json())
FIXTURE = json.loads((REPO / "test/fixtures/caller-late-bins.json").read_text())


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["name"])
def test_late_binning_fixture(case: dict) -> None:
    labels = bin_situation(case["situation"], CFG["dimensions"])
    assert {k: labels[k] for k in case["bins"]} == case["bins"]


def _frame(rows: list[tuple[int, str, str, str]]) -> pl.DataFrame:
    """(season, zoneK, scoreLateOnly, target)."""
    return pl.DataFrame({"season": [r[0] for r in rows], label_col("zoneK"): [r[1] for r in rows],
                         label_col("scoreLateOnly"): [r[2] for r in rows], "target": [r[3] for r in rows],
                         "down": [4.0] * len(rows), "tag": [None] * len(rows)}, schema_overrides={"tag": pl.String})


FACTOR = {"targets": ["run", "pass", "kick"], "minPlays": 150, "downs": [4], "seasons": {"from": 2021, "to": 2023},
          "levels": [{"dims": ["zoneK", "scoreLateOnly"]}, {"dims": ["zoneK", "scoreLateOnly"], "seasons": {"from": 2016, "to": 2023}}, {"dims": []}]}


def test_late_cell_at_n_and_n_minus_1_and_the_2016_parent() -> None:
    # 150 recent plays: stored at the 2021-2023 level.
    at_n = fit_factor(_frame([(2022, "K37", "-3..-1", "kick")] * 150), FACTOR, 2023, 2, 2024)
    assert "K37|-3..-1" in at_n["cells"][0]
    # 149 recent plays plus 10 from 2018: not stored at 2021-2023, stored at the 2016-2023 twin.
    rows = [(2022, "K37", "-3..-1", "kick")] * 149 + [(2018, "K37", "-3..-1", "run")] * 10
    below = fit_factor(_frame(rows), FACTOR, 2023, 2, 2024)
    assert "K37|-3..-1" not in below["cells"][0]
    assert "K37|-3..-1" in below["cells"][1]
    # The 2018 rows never reach the 2021-2023 levels: the global level has only the 149 recent
    # plays, under N, so it stores nothing.
    assert "" not in below["cells"][2]
    assert level_key(FACTOR["levels"][1], {"zoneK": "K37", "scoreLateOnly": "-3..-1"}) == "K37|-3..-1"


def test_holdout_rows_never_reach_a_late_cell() -> None:
    with pytest.raises(HoldoutLeak):
        fit_factor(_frame([(2024, "K37", "-3..-1", "kick")] * 200), FACTOR, 2023, 2, 2024)


def test_tables_from_another_config_are_refused() -> None:
    t = {"side": "offense", "configVersion": 1, "configHash": "a" * 64}
    # Amended by step 5b: the current config is version 3 (was 2).
    with pytest.raises(TablesConfigMismatch, match=f"version 1.*version {CFG['version']}"):
        check_tables(CFG, "a" * 64, [t])
    with pytest.raises(TablesConfigMismatch, match="b" * 64):
        check_tables(CFG, "b" * 64, [{**t, "configVersion": 2}])


def test_o4top_late_levels_seasons_are_pinned() -> None:
    """Review fix: only the 2016-2023 twins carry their own seasons; every other o4Top level,
    late or not, is fitted on the factor's 2021-2023, and each twin follows the level it backs."""
    f = CFG["factors"]["o4Top"]
    assert f["seasons"] == {"from": 2021, "to": 2023}
    levels = f["levels"]
    twins = 0
    for i, lv in enumerate(levels):
        late = any(d in ("scoreLate", "scoreLateOnly", "score3LateOnly", "scoreLate5Only", "scoreLateOnlyR") for d in lv["dims"])
        if "seasons" in lv:
            twins += 1
            assert lv["seasons"] == {"from": 2016, "to": 2023}, lv
            # Amended by step 5b: the late zoneK and fieldHalf levels have twins too (scoreLate5Only).
            assert any(d in lv["dims"] for d in ("scoreLateOnly", "scoreLateOnlyR", "scoreLate5Only")), lv
            prev = levels[i - 1]
            assert "seasons" not in prev and [("scoreLateOnly" if d == "scoreLate" else d) for d in prev["dims"]] == lv["dims"], (prev, lv)
        elif late:
            assert "seasons" not in lv
    # Amended 2026-11-13 (M1 step 5d milestone D): plus the c40-banded late zoneK and fieldHalf twins.
    assert twins == 10  # Amended by step 5b: 4 in 5a, plus the late zoneK and fieldHalf twins (lateTime and lateClock).
    # Fitting reads those ranges: a non-twin late level takes only 2021-2023 rows.
    from pipeline.caller.fit import level_seasons
    frame = pl.DataFrame({"season": [2018, 2022], "down": [4.0, 4.0]})
    for lv in levels:
        kept = frame.filter(level_seasons(f, lv))["season"].to_list()
        assert kept == ([2018, 2022] if "seasons" in lv else [2022]), lv
