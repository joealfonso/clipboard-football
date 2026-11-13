"""A6 (Python side), C2 to C6: binning, fitting, backoff, weights and rounding."""

import json
import math

import polars as pl
import pytest

from pipeline.caller.bins import bin_situation, level_key
from pipeline.caller.config import REPO, load_inputs, season_weight
from pipeline.caller.fit import HoldoutLeak, fit_factor, in_seasons, round_to_total, weighted_shares
from pipeline.caller.frames import factor_frames
from pipeline.caller.shares import lookup
from pipeline.tests.caller_fixtures import config

CFG = config()
FIXTURE = json.loads((REPO / "test/fixtures/caller-bins.json").read_text())


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["name"])
def test_shared_binning_fixture(case: dict) -> None:
    labels = bin_situation(case["situation"], CFG["dimensions"])
    assert {k: labels[k] for k in case["bins"]} == case["bins"]
    # Every level key of every factor is the tag plus the labels, or None when a dim is missing.
    for f in CFG["factors"].values():
        for level in f["levels"]:
            dims = [d for d in level["dims"] if d not in ("leaf", "front")]
            key = level_key(level, labels, {"leaf": "insideRun", "front": "front.nickelLight"})
            if any(labels[d] is None for d in dims):
                assert key is None
            else:
                parts = ([level["tag"]] if "tag" in level else []) + [
                    {"leaf": "insideRun", "front": "front.nickelLight"}.get(d) or labels[d] for d in level["dims"]
                ]
                assert key == "|".join(parts)


def test_out_of_range_value_raises() -> None:
    sit = dict(FIXTURE["cases"][0]["situation"], yardsToGo=0)
    with pytest.raises(ValueError):
        bin_situation(sit, CFG["dimensions"])


# ------------------------------------------------------------------ fitting helpers

FACTOR = {
    "targets": ["a", "b", "c"],
    "minPlays": 4,
    "seasons": {"from": 2022, "to": 2023},
    "levels": [{"dims": ["down"]}, {"dims": []}],
}


def rows(*spec: tuple[int, str, str]) -> pl.DataFrame:
    return pl.DataFrame(
        [{"season": s, "target": t, "b_down": d} for s, t, d in spec],
        schema={"season": pl.Int64, "target": pl.String, "b_down": pl.String},
    )


def test_cell_below_minimum_is_absent_and_lookup_lands_on_parent() -> None:
    df = rows(*[(2023, "a", "1")] * 4, *[(2023, "b", "2")] * 3)
    t = fit_factor(df, FACTOR, 2023, 2, 2024)
    assert t["cells"][0] == {"1": [10000, 0, 0]}  # exactly minPlays: stored
    assert "2" not in t["cells"][0]  # one short: absent
    lk = lookup(t, {"down": "2"})
    assert lk is not None and (lk.level, lk.key) == (1, "")
    assert t["cells"][1][""] == [5714, 4286, 0]


def test_weighted_shares_match_hand_computation() -> None:
    # 2022 weight 0.5 ** (1/2); 2023 weight 1. Two seasons, half-life 2.
    df = rows((2022, "a", "1"), (2022, "a", "1"), (2022, "b", "1"), (2023, "b", "1"), (2023, "c", "1"))
    t = fit_factor(df, {**FACTOR, "minPlays": 1}, 2023, 2, 2024)
    w = math.sqrt(0.5)
    den = 3 * w + 2
    expected = [2 * w / den, (w + 1) / den, 1 / den]
    assert weighted_shares({2022: [2, 1, 0], 2023: [0, 1, 1]}, {2022: w, 2023: 1.0}) == pytest.approx(expected, abs=1e-15)
    assert t["cells"][0]["1"] == round_to_total(expected)
    assert t["seasonWeights"] == {"2022": w, "2023": 1.0}
    assert season_weight(2019, 2023, 2) == 0.25


def test_rounding_sums_to_total_ties_by_order_and_zeros_stay_zero() -> None:
    assert round_to_total([1 / 3, 1 / 3, 1 / 3]) == [3334, 3333, 3333]
    assert round_to_total([0.5, 0.0, 0.5]) == [5000, 0, 5000]
    assert round_to_total([0.00001, 0.99999, 0.0]) == [0, 10000, 0]
    assert round_to_total([1 / 6, 1 / 6, 2 / 3]) == [1667, 1667, 6666]
    for shares in ([0.1234567, 0.4567891, 0.4197542], [1e-9, 1 - 1e-9]):
        assert sum(round_to_total([s / sum(shares) for s in shares])) == 10000


def test_holdout_row_reaching_fit_raises() -> None:
    with pytest.raises(HoldoutLeak):
        fit_factor(rows((2024, "a", "1")), FACTOR, 2023, 2, 2024)


def test_holdout_and_2026_rows_never_reach_a_fitted_cell() -> None:
    """Training rows all Run; 2024-2026 rows all Kneel. No fitted cell may hold kneel."""
    base = {
        "phase": "scrimmage", "down": 1.0, "b_down": "1", "b_dist5": "7-10", "b_dist3": "7+", "b_zone6": "OWN",
        "b_zone3": "OWN", "b_zoneF": "FLD", "b_score7": "0", "b_score3": "0", "b_time5": "H1", "b_time2": "N",
        "b_end": "-", "b_clock": "-", "b_diff": None, "b_time3": None, "try_call": None, "run_type": "insideRun", "pass_type": None,
        # Step 5a (B2): the late-game dimensions, so the new late cells are covered too.
        "b_scoreLate": "0", "b_scoreLateOnly": "0", "b_score3LateOnly": "0", "b_zoneK": "K75",
        # Step 5b: the late time state, five-bucket late score, kneel-out, half and regulation gate.
        "b_lateTime": "GF", "b_scoreLate5Only": "1..8", "b_kneelOut": "K1", "b_fieldHalf": "OWN", "b_lateClock": "GF",
        "b_time5R": "H1", "b_time2R": "N", "b_scoreLateOnlyR": "0",
        "depth": None, "leaf": "insideRun", "formation": "shotgun", "front": "front.nickelLight",
        "coverage": "cover3.zone.le4", "preset": "nickelCover3",
    }
    data = [{**base, "season": s, "call": "run"} for s in range(2016, 2024) for _ in range(3)]
    data += [{**base, "season": s, "call": "kneel", "run_type": "qbSneak", "leaf": "qbSneak", "formation": "heavy",
              "front": "front.goalLine", "coverage": "cover0.man.ge5", "preset": "goalLine"} for s in (2024, 2025, 2026) for _ in range(50)]
    plays = pl.DataFrame(data, infer_schema_length=None)
    cfg = json.loads(json.dumps(CFG))
    for f in cfg["factors"].values():
        f["minPlays"] = 1
    frames = factor_frames(plays, cfg)
    for fid, fr in frames.items():
        assert fr.filter(pl.col("season") >= 2024).height == 0, fid
        if fr.height == 0:
            continue
        t = fit_factor(fr, cfg["factors"][fid], 2023, 2, 2024)
        holdout_targets = {"kneel", "qbSneak", "heavy", "front.goalLine", "cover0.man.ge5", "goalLine"}
        for level in t["cells"]:
            for w in level.values():
                for i, target in enumerate(t["targets"]):
                    if target in holdout_targets:
                        assert w[i] == 0, (fid, target)


def test_season_ranges_by_factor() -> None:
    """C3 on a frame: 4th downs only in o4Top (2021-2023) and o4Kick (2016-2023); oTop is
    downs 1-3 from 2016; pass type 2022-2023; defense 2018-2023."""
    df = pl.DataFrame({"season": list(range(2014, 2027)) * 2, "down": [3.0] * 13 + [4.0] * 13})

    def kept(fid: str, down: float) -> list[int]:
        return sorted(df.filter(in_seasons(CFG["factors"][fid]) & (pl.col("down") == down))["season"].to_list())

    assert kept("oTop", 4.0) == []
    assert kept("oTop", 3.0) == list(range(2016, 2024))
    assert kept("o4Top", 4.0) == [2021, 2022, 2023] and kept("o4Top", 3.0) == []
    assert kept("o4Kick", 4.0) == list(range(2016, 2024))
    assert sorted(set(df.filter(in_seasons(CFG["factors"]["oPassType"]))["season"].to_list())) == [2022, 2023]
    assert sorted(set(df.filter(in_seasons(CFG["factors"]["dFront"]))["season"].to_list())) == list(range(2018, 2024))


def test_fourth_down_chain_drops_fine_zone_last() -> None:
    # Amended by step 5a: the late-window levels may use the designed kick zone (zoneK) and are
    # skipped outside the last 5:00; every level still keeps a field zone, and the chain outside
    # the late windows still ends zone6, then global.
    # Amended by step 5b: the late-only levels may also use zoneK or fieldHalf with scoreLate5Only.
    levels = [lv["dims"] for lv in CFG["factors"]["o4Top"]["levels"]]
    late_zone = lambda d: ("zoneK" in d or "fieldHalf" in d) and any(x in d for x in ("scoreLateOnly", "score3LateOnly", "scoreLate5Only", "scoreLateOnlyR"))  # noqa: E731
    assert all(("zone6" in d) or late_zone(d) for d in levels[:-1]) and levels[-1] == []
    assert levels[-2] == ["zone6"]
    kick = [lv["dims"] for lv in CFG["factors"]["o4Kick"]["levels"]]
    assert kick[-3:] == [["zone6", "time2"], ["zone6"], []]
    assert all("scoreLateOnly" in d or "score3LateOnly" in d for d in kick[:-3])


@pytest.mark.parametrize("name", ["offense.table.json", "defense.table.json"])
def test_committed_tables_use_only_training_seasons(name: str) -> None:
    path = REPO / "data/caller" / name
    if not path.exists():
        pytest.skip("tables not built")
    tables = json.loads(path.read_text())
    assert tables["generated"] is True
    assert tables["configHash"] == load_inputs().config_hash, "tables are stale: rerun the pipeline"
    for fid, t in tables["factors"].items():
        r = CFG["factors"][fid]["seasons"]
        # Step 5a resolved question 1: a level may carry its own (training) seasons.
        lo = min([r["from"]] + [lv["seasons"]["from"] for lv in CFG["factors"][fid]["levels"] if "seasons" in lv])
        hi = max([r["to"]] + [lv["seasons"]["to"] for lv in CFG["factors"][fid]["levels"] if "seasons" in lv])
        assert t["seasons"], fid
        assert min(t["seasons"]) >= lo and max(t["seasons"]) <= hi <= 2023, fid
        assert sorted(t["seasonWeights"]) == [str(s) for s in t["seasons"]]
        for level in t["cells"]:
            for w in level.values():
                assert sum(w) == 10000 and all(isinstance(x, int) and x >= 0 for x in w)
    if name == "offense.table.json":
        assert tables["factors"]["oTop"]["downs"] == [1, 2, 3]
        # 2021-2023, plus 2016-2020 rows for the late-window twin levels only (step 5a).
        assert tables["factors"]["o4Top"]["seasons"] == list(range(2016, 2024))
        assert CFG["factors"]["o4Top"]["seasons"] == {"from": 2021, "to": 2023}
        assert tables["factors"]["o4Kick"]["seasons"] == list(range(2016, 2024))
        assert tables["factors"]["oPassType"]["seasons"] == [2022, 2023]
        assert tables["factors"]["oDepth"]["seasons"] == [2022, 2023]
    else:
        assert all(t["seasons"] == list(range(2018, 2024)) for t in tables["factors"].values())
