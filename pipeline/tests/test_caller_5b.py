"""M1 step 5b, milestone B: late time state, five-bucket late score and can-kneel-out
(B2, B3), version check against the real v2 build (B5), overtime rows only in overtime cells
and no holdout rows (B6), and backoff at N-1 and N on each new level (B7)."""

from __future__ import annotations

import hashlib
import json

import polars as pl
import pytest

from pipeline.caller.bins import bin_situation, level_key
from pipeline.caller.config import REPO, TablesConfigMismatch, check_tables, rules_json, with_rule_play_clock
from pipeline.caller.fit import HoldoutLeak, fit_factor, label_col

CFG = with_rule_play_clock(json.loads((REPO / "data/caller/config.json").read_text()), rules_json())
DIMS = CFG["dimensions"]
FIXTURE = json.loads((REPO / "test/fixtures/caller-5b-bins.json").read_text())


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["name"])
def test_5b_binning_fixture(case: dict) -> None:
    labels = bin_situation(case["situation"], DIMS)
    assert {k: labels[k] for k in case["bins"]} == case["bins"]


def test_kneel_out_needs_the_rule_set_play_clock() -> None:
    raw = json.loads((REPO / "data/caller/config.json").read_text())
    sit = FIXTURE["cases"][-1]["situation"] | {"quarter": 4, "secondsLeftInGame": 30, "secondsLeftInHalf": 30, "scoreDiff": 3, "down": 1}
    with pytest.raises(ValueError, match="play clock"):
        bin_situation(sit, raw["dimensions"])
    assert CFG["dimensions"]["kneelOut"]["playClock"] == rules_json()["clock"]["playClockAfterPlay"]


def _late(diff: int) -> dict[str, str | None]:
    sit = {"phase": "scrimmage", "down": 1, "yardsToGo": 10, "yardLine100": 50, "scoreDiff": diff, "quarter": 4,
           "secondsLeftInHalf": 100, "secondsLeftInGame": 100, "offenseTimeouts": 1, "defenseTimeouts": 1}
    return bin_situation(sit, DIMS)


def test_score_late5_is_a_union_of_5a_buckets_inside_score3() -> None:
    labels = {d: _late(d) for d in range(-40, 41)}
    for d, a in labels.items():
        for e, b in labels.items():
            if a["scoreLateOnly"] == b["scoreLateOnly"]:
                assert a["scoreLate5Only"] == b["scoreLate5Only"], (d, e)
            if a["scoreLate5Only"] == b["scoreLate5Only"]:
                assert a["score3"] == b["score3"], (d, e)


def test_v2_tables_and_v3_config_are_refused_both_ways() -> None:
    """The real v2 build (test/fixtures/caller-v2: offense table and the config it was built from)."""
    v2_table = json.loads((REPO / "test/fixtures/caller-v2/offense.table.json").read_text())
    v2_cfg = json.loads((REPO / "test/fixtures/caller-v2/config.json").read_text())
    cat = (REPO / "data/calls/catalog.json").read_bytes()
    sha = lambda b: hashlib.sha256(cat + b"\0" + b + b"\0").hexdigest()  # noqa: E731
    v2_hash = sha((REPO / "test/fixtures/caller-v2/config.json").read_bytes())
    v3_hash = sha((REPO / "data/caller/config.json").read_bytes())
    assert v2_table["configVersion"] == 2 and v2_cfg["version"] == 2 and v2_table["configHash"] == v2_hash
    assert CFG["version"] == 3
    with pytest.raises(TablesConfigMismatch, match=f"version 2 \\(sha256 {v2_hash}\\).*version 3 \\(sha256 {v3_hash}\\)"):
        check_tables(CFG, v3_hash, [v2_table])
    v3_table = json.loads((REPO / "data/caller/offense.table.json").read_text())
    with pytest.raises(TablesConfigMismatch, match=f"version 3 \\(sha256 {v3_hash}\\).*version 2 \\(sha256 {v2_hash}\\)"):
        check_tables(v2_cfg, v2_hash, [v3_table])
    check_tables(v2_cfg, v2_hash, [v2_table])


# ----------------------------------------------------------------- fitting (B6, B7)

TOP = CFG["factors"]["oTop"]
FOUR = CFG["factors"]["o4Top"]
LATE_DIMS = ["down", "kneelOut", "scoreLate5Only", "lateTime", "lateClock", "zoneK", "fieldHalf", "time5R", "time2R", "scoreLateOnlyR", "dist5", "dist3", "zone6",
             "zone3", "scoreLate", "scoreLateOnly", "score3", "time5", "time2", "end", "clock"]


def _rows(situations: list[tuple[dict, int, str, bool]]) -> pl.DataFrame:
    """(situation, season, target, is_ot) -> a frame with every label column the factors use."""
    out: dict[str, list] = {label_col(d): [] for d in LATE_DIMS}
    out |= {"season": [], "target": [], "down": [], "is_ot": [], "tag": []}
    for sit, season, target, ot in situations:
        lab = bin_situation(sit, DIMS)
        for d in LATE_DIMS:
            out[label_col(d)].append(lab[d])
        out["season"].append(season)
        out["target"].append(target)
        out["down"].append(float(sit["down"]))
        out["is_ot"].append(ot)
        out["tag"].append(None)
    return pl.DataFrame(out, schema_overrides={label_col(d): pl.String for d in LATE_DIMS} | {"tag": pl.String})


def _sit(down: int, diff: int, q: int, secs: int, yl: int = 60, t: int = 0) -> dict:
    return {"phase": "scrimmage", "down": down, "yardsToGo": 10, "yardLine100": yl, "scoreDiff": diff, "quarter": q,
            "secondsLeftInHalf": secs, "secondsLeftInGame": secs, "offenseTimeouts": 1, "defenseTimeouts": t}


def _top(rows: pl.DataFrame, n: int = 150) -> dict:
    return fit_factor(rows, TOP | {"minPlays": n}, 2023, 2, 2024)


def test_overtime_rows_change_no_non_overtime_cell() -> None:
    reg = [(_sit(1 + i % 3, (i % 21) - 10, 4 if i % 2 else 2, 60 + i % 400, 20 + i % 70), 2016 + i % 8, ["run", "pass", "kneel"][i % 3], False) for i in range(3000)]
    ot = [(_sit(1 + i % 3, (i % 13) - 6, 5, 30 + i % 570, 20 + i % 70), 2016 + i % 8, ["pass", "kneel"][i % 2], True) for i in range(1500)]
    without = _top(_rows(reg))
    with_ot = _top(_rows(reg + ot))
    ot_cells = 0
    for level, (a, b) in enumerate(zip(without["cells"], with_ot["cells"])):
        for key, w in b.items():
            if "OT" in key.split("|"):
                ot_cells += 1
                assert "lateTime" in TOP["levels"][level]["dims"], (level, key)
            else:
                assert a.get(key) == w, (level, key)
        assert set(a) <= set(b)
    assert ot_cells > 0  # not vacuous: the overtime rows did reach overtime cells
    assert without["plays"] == with_ot["plays"]  # the factor's play count excludes overtime


def test_holdout_rows_never_reach_a_late_cell() -> None:
    rows = _rows([(_sit(1, 3, 5, 100), 2024, "kneel", True)] * 200)
    with pytest.raises(HoldoutLeak):
        _top(rows)


def _key(level: dict, sit: dict) -> str | None:
    return level_key(level, bin_situation(sit, DIMS))


@pytest.mark.parametrize(
    ("factor", "sit", "level", "parent", "spill"),
    [
        # Leading by 4, final 2:00, 1st down, can kneel out: level 0 -> [down,kneelOut,lateTime].
        ("oTop", _sit(1, 4, 4, 90), 0, 1, _sit(1, 12, 4, 90)),
        # [down,kneelOut,lateTime] -> the first regulation level.
        ("oTop", _sit(1, 4, 4, 90), 1, 2, None),
        # Overtime, tied, 3rd down at the 30: [down,zoneK,scoreLate5,lateTime] -> [zoneK,scoreLate5,lateTime].
        ("oTop", _sit(3, 0, 5, 400, 30, 2), 5, 6, _sit(1, 0, 5, 400, 30, 2)),
        # [zoneK,scoreLate5,lateTime] -> [fieldHalf,scoreLate5,lateTime].
        ("oTop", _sit(3, 0, 5, 400, 30, 2), 6, 7, _sit(3, 0, 5, 400, 45, 2)),
        # Overtime with no overtime cell -> the G5 cell (resolved question 2), fitted on regulation only.
        ("oTop", _sit(1, -3, 5, 400, 60, 2), 7, 8, None),
    ],
)
def test_otop_backoff_at_n_minus_1_and_n(factor: str, sit: dict, level: int, parent: int, spill: dict | None) -> None:
    levels = TOP["levels"]
    assert _key(levels[level], sit) is not None and _key(levels[parent], sit) is not None
    for i in range(level + 1, parent):
        assert _key(levels[i], sit) is None
    # N plays in the cell: stored at `level`.
    at_n = _top(_rows([(sit, 2022, "kneel", False)] * 150))
    assert _key(levels[level], sit) in at_n["cells"][level]
    # N-1 in the cell, topped up from a sibling that shares only the parent's key: not stored
    # at `level`, stored at the parent.
    filler = [(spill, 2022, "run", False)] * 10 if spill is not None else []
    if spill is not None:
        assert _key(levels[parent], spill) == _key(levels[parent], sit) and _key(levels[level], spill) != _key(levels[level], sit)
    below = _top(_rows([(sit, 2022, "kneel", False)] * 149 + filler))
    assert _key(levels[level], sit) not in below["cells"][level]
    if spill is not None:
        assert _key(levels[parent], sit) in below["cells"][parent]


def test_late_clock_levels_take_no_overtime_rows_and_match_the_g5_gf_cells() -> None:
    reg = [(_sit(1, -3, 4, 200, 60, 2), 2016 + i % 8, "pass", False) for i in range(200)]
    ot = [(_sit(1, -3, 5, 400, 60, 2), 2016 + i % 8, "kneel", True) for i in range(200)]
    fit = _top(_rows(reg + ot))
    lv = TOP["levels"]
    lc = next(i for i, l in enumerate(lv) if l["dims"] == ["down", "zoneK", "scoreLate5Only", "lateClock"])
    lt = next(i for i, l in enumerate(lv) if l["dims"] == ["down", "zoneK", "scoreLate5Only", "lateTime"])
    assert _key(lv[lc], ot[0][0]) == _key(lv[lc], reg[0][0]) == "1|K75|-8..-1|G5"
    assert fit["cells"][lc] == {k: v for k, v in fit["cells"][lt].items() if not k.endswith("|OT")}
    assert fit["cells"][lc]["1|K75|-8..-1|G5"][TOP["targets"].index("kneel")] == 0
    assert "1|K75|-8..-1|OT" in fit["cells"][lt]


def test_o4top_late_zone_level_twin_and_field_half_parent() -> None:
    """o4Top, overtime, trailing 3 at the 40: the 2021-2023 zoneK late level, its 2016-2023 twin,
    then fieldHalf (and its twin)."""
    sit = _sit(4, -3, 5, 300, 40, 2)
    levels = FOUR["levels"]
    idx = [i for i, lv in enumerate(levels) if "lateTime" in lv["dims"]]
    assert [levels[i]["dims"] for i in idx] == [["zoneK", "scoreLate5Only", "lateTime"]] * 2 + [["fieldHalf", "scoreLate5Only", "lateTime"]] * 2
    fit = lambda rows: fit_factor(_rows(rows), FOUR, 2023, 2, 2024)  # noqa: E731
    zk, zk_twin, fh, fh_twin = idx
    key = _key(levels[zk], sit)
    # 150 recent plays: stored at the 2021-2023 level.
    assert key in fit([(sit, 2022, "kick", True)] * 150)["cells"][zk]
    # 149 recent plus 10 from 2018: not at 2021-2023, stored at the twin.
    below = fit([(sit, 2022, "kick", True)] * 149 + [(sit, 2018, "run", True)] * 10)
    assert key not in below["cells"][zk] and key in below["cells"][zk_twin]
    # 149 at the 40 (K50) plus 10 at the 30 (K37, same half): only the fieldHalf twin reaches N.
    near = _sit(4, -3, 5, 300, 30, 2)
    assert _key(levels[zk], near) != key and _key(levels[fh], near) == _key(levels[fh], sit)
    split = fit([(sit, 2018, "kick", True)] * 149 + [(near, 2018, "run", True)] * 10)
    assert key not in split["cells"][zk_twin] and _key(levels[fh_twin], sit) in split["cells"][fh_twin]
