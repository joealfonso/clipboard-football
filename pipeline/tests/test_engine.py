"""M1 step 4 pipeline: classes, backoff, weights, holdout, penalties, centering, players."""

from __future__ import annotations

import copy
import json
import re
from collections import Counter
from typing import Any

import polars as pl
import pytest

from pipeline.caller.config import REPO
from pipeline.caller.fit import HoldoutLeak
from pipeline.caller.shares import Caller
from pipeline.engine import center, combine, duration, names, penalties
from pipeline.engine.classes import FUM_LOST, INT, TD, add_outcomes, split_unknown_depth
from pipeline.engine.config import GENERATED_FILES, SIZE_BUDGET_BYTES, weights_for
from pipeline.engine.fit import fit_cells, fit_pools


def cfg() -> dict[str, Any]:
    return json.loads((REPO / "data/engine/config.json").read_text())


ROW: dict[str, Any] = {
    "season": 2020, "phase": "scrimmage", "call": "run", "leaf": "insideRun", "yardline_100": 60.0,
    "yards_gained": 4.0, "complete_pass": 0.0, "incomplete_pass": 0.0, "interception": 0.0, "sack": 0.0,
    "qb_scramble": 0.0, "fumble": 0.0, "fumble_lost": 0.0, "fumble_out_of_bounds": 0.0, "fumble_recovery_1_yards": 0.0,
    "return_yards": 0.0, "return_touchdown": 0.0, "safety": 0.0, "out_of_bounds": 0.0, "air_yards": None,
    "two_point_conv_result": None, "td_offense": False, "td_defense": False, "recovered_by_offense": False,
    "desc_sacked": False, "desc_intercepted": False, "desc_incomplete": False,
}


def frame(*rows: dict[str, Any]) -> pl.DataFrame:
    return pl.DataFrame([{**ROW, **r} for r in rows], infer_schema_length=None)


# ---------------------------------------------------------------- B3: classes


@pytest.mark.parametrize(
    ("over", "cls"),
    [
        ({"yards_gained": -2.0}, "loss"), ({"yards_gained": 0.0}, "loss"), ({"yards_gained": 1.0}, "r1_3"),
        ({"yards_gained": 3.0}, "r1_3"), ({"yards_gained": 4.0}, "r4_9"), ({"yards_gained": 9.0}, "r4_9"),
        ({"yards_gained": 10.0}, "r10_19"), ({"yards_gained": 19.0}, "r10_19"), ({"yards_gained": 20.0}, "r20"),
        ({"yards_gained": 30.0, "fumble": 1.0}, "fumble"),
    ],
)
def test_run_classes(over: dict[str, Any], cls: str) -> None:
    out = add_outcomes(frame(over), cfg())
    assert out["cls"].to_list() == [cls]


@pytest.mark.parametrize(
    ("over", "cls"),
    [
        ({"sack": 1.0, "fumble": 1.0, "yards_gained": -7.0}, "sack"),
        ({"qb_scramble": 1.0, "yards_gained": 8.0}, "scramble"),
        ({"interception": 1.0, "air_yards": 15.0}, "int"),
        ({"incomplete_pass": 1.0, "yards_gained": 0.0}, "inc"),
        ({"complete_pass": 1.0, "fumble": 1.0, "yards_gained": 12.0}, "fumbleCatch"),
        ({"complete_pass": 1.0, "yards_gained": -1.0}, "c0"),
        ({"complete_pass": 1.0, "yards_gained": 9.0}, "c1_9"),
        ({"complete_pass": 1.0, "yards_gained": 10.0}, "c10_19"),
        ({"complete_pass": 1.0, "yards_gained": 25.0}, "c20"),
    ],
)
def test_pass_classes(over: dict[str, Any], cls: str) -> None:
    out = add_outcomes(frame({"call": "pass", "leaf": "shortPass", **over}), cfg())
    assert out["cls"].to_list() == [cls]


def test_every_pooled_play_lands_in_exactly_one_class() -> None:
    rows = [{"yards_gained": float(y), "fumble": float(f)} for y in range(-5, 40) for f in (0, 1)]
    rows += [{"call": "pass", "leaf": "deepPass", "complete_pass": 1.0, "yards_gained": float(y)} for y in range(-3, 60)]
    out = add_outcomes(frame(*rows), cfg())
    assert out["cls"].null_count() == 0
    fams = cfg()["families"]
    for fam, cls in out.select("family", "cls").iter_rows():
        assert cls in fams[fam]["classes"]


def test_turnover_tuple_fields() -> None:
    out = add_outcomes(frame(
        {"call": "pass", "leaf": "deepPass", "interception": 1.0, "air_yards": 30.0, "return_yards": 12.0},
        {"fumble": 1.0, "fumble_lost": 1.0, "yards_gained": 3.0, "fumble_recovery_1_yards": 5.0},
        {"yards_gained": 40.0, "td_offense": True, "yardline_100": 40.0},
    ), cfg())
    rows = out.select("flags", "ty", "ry", "y").rows()
    assert rows[0][0] & INT and rows[0][1:3] == (30, 12)
    assert rows[1][0] & FUM_LOST and rows[1][1:3] == (3, 5)
    assert rows[2][0] & TD and rows[2][3] == 40


def caller() -> Caller:
    t = {s: json.loads((REPO / f"data/caller/{s}.table.json").read_text()) for s in ("offense", "defense")}
    return Caller(json.loads((REPO / "data/calls/catalog.json").read_text()), json.loads((REPO / "data/caller/config.json").read_text()), t["offense"], t["defense"])


def test_unknown_depth_dropbacks_split_by_the_callers_depth_shares() -> None:
    sit = {"down": 1.0, "ydstogo": 10.0, "score_differential": 0.0, "qtr": 1.0, "half_seconds_remaining": 1500.0,
           "game_seconds_remaining": 3300.0, "offense_timeouts": 3.0, "defense_timeouts": 3.0}
    f = add_outcomes(frame({"call": "pass", "leaf": None, "pass_type": "plain", "depth": None, "sack": 1.0, "yards_gained": -6.0, **sit},
                           {"call": "pass", "leaf": "screenPass", "pass_type": "screenPass", "depth": None, "sack": 1.0, **sit}), cfg())
    out = split_unknown_depth(f, caller())
    split = out.filter(pl.col("depth_split"))
    assert sorted(split["leaf"].to_list()) == ["deepPass", "intermediatePass", "shortPass"]
    assert abs(split["frac"].sum() - 1.0) < 1e-12
    assert out.filter(pl.col("leaf") == "screenPass")["frac"].to_list() == [1.0]


# ---------------------------------------------------------------- B4, B5, B2: fitting


def cells_frame(n: int, key: str = "a", season: int = 2023) -> pl.DataFrame:
    return pl.DataFrame({"season": [season] * n, "cls": ["x"] * n, "b_d": [key] * n, "w": [1.0] * n, "frac": [1.0] * n, "y": [1] * n})


def test_backoff_cell_at_exactly_n_is_stored_under_n_is_absent() -> None:
    levels = [{"dims": ["d"]}, {"dims": []}]
    f = pl.concat([cells_frame(300, "a"), cells_frame(299, "b")])
    cells = fit_cells(f, levels, ["x", "y"], 300, 2024)
    assert "a" in cells[0] and "b" not in cells[0]
    assert "" in cells[1]


def test_last_pool_level_keeps_small_pools() -> None:
    f = cells_frame(3).with_columns(flags=pl.lit(0), ty=pl.lit(0), ry=pl.lit(0))
    pools = fit_pools(f, [{"dims": ["d"]}, {"dims": []}], ["y", "flags", "ty", "ry"], 100, 2024)
    assert pools[0] == {} and pools[1][""] == [1, 0, 0, 0, 30000]


def test_season_weights_match_hand_computed_values() -> None:
    assert weights_for([2023, 2021, 2019], 2023, 2) == {2023: 1.0, 2021: 0.5, 2019: 0.25}
    assert weights_for([2023, 2022, 2020], 2023, 1) == {2023: 1.0, 2022: 0.5, 2020: 0.125}


@pytest.mark.parametrize("season", [2024, 2025, 2026])
def test_holdout_rows_never_reach_a_fit(season: int) -> None:
    f = pl.concat([cells_frame(400), cells_frame(1, season=season)])
    with pytest.raises(HoldoutLeak):
        fit_cells(f, [{"dims": []}], ["x"], 1, 2024)
    with pytest.raises(HoldoutLeak):
        fit_pools(f.with_columns(flags=pl.lit(0), ty=pl.lit(0), ry=pl.lit(0)), [{"dims": []}], ["y"], 1, 2024)


def test_training_frame_drops_holdout_seasons() -> None:
    from pipeline.engine.build import training_scrimmage

    f = add_outcomes(frame({"season": 2023, "has_accepted_foul": False}, {"season": 2024, "has_accepted_foul": False}, {"season": 2025, "has_accepted_foul": False}), cfg())
    assert training_scrimmage(f, cfg())["season"].to_list() == [2023]


# ---------------------------------------------------------------- B6: duration


def test_duration_fit_uses_only_measured_plays_in_the_duration_seasons() -> None:
    c = cfg()
    f = pl.DataFrame({
        "season": [2021, 2022, 2022, 2023, 2023], "duration": [5.0, None, 4.2, 40.0, 6.6],
        "cls": ["r4_9"] * 5, "w": [1.0] * 5, "frac": [1.0] * 5,
    })
    m = duration.measured(f, c)
    assert m["sec"].to_list() == [4, 7]


# ---------------------------------------------------------------- B8: penalty mapping


def test_unmapped_penalty_type_fails_with_its_name_and_count() -> None:
    with pytest.raises(penalties.UnmappedPenalties) as e:
        penalties.check_mapping(Counter({"Offensive Holding": 10, "Spearing": 3}), cfg())
    assert "Spearing" in str(e.value) and "3" in str(e.value) and "Offensive Holding" not in str(e.value)


def test_every_supported_id_is_a_mapping_target_or_designed() -> None:
    rules = json.loads((REPO / "data/rules/nfl-2026.json").read_text())
    c = cfg()["penalties"]
    targets = set(c["mapping"].values()) | {s["playStands"] for s in c["splitByPlay"].values()} | {r["id"] for r in c["byFamily"].values()}
    designed_kickoff = {"kickoffIllegalFormation"}
    assert set(rules["penalties"]) - targets - designed_kickoff == set()


# ---------------------------------------------------------------- B9, B10: generated files


def test_generated_files_hold_no_player_names_or_ids() -> None:
    name = re.compile(r"\b[A-Z][a-z]+ [A-Z][a-z]+\b")
    gsis = re.compile(r"\b\d{2}-\d{7}\b")
    for p in GENERATED_FILES:
        text = (REPO / p).read_text()
        assert not gsis.search(text), p
        assert "player" not in text.lower() or p.name == "distributions.json", p
        for s in re.findall(r'"([^"]*)"', text):
            assert not name.search(s), (p, s)


def test_generated_tables_fit_the_size_budget() -> None:
    assert sum((REPO / p).stat().st_size for p in GENERATED_FILES) <= SIZE_BUDGET_BYTES


# ---------------------------------------------------------------- D1-D3: matchup table


def families() -> dict[str, Any]:
    return cfg()["families"]


def presets() -> list[str]:
    return json.loads((REPO / "data/caller/defense.table.json").read_text())["factors"]["dTry"]["targets"]


def personnel() -> dict[str, Any]:
    return json.loads((REPO / "data/engine/personnel.json").read_text())


def raw() -> dict[str, Any]:
    return json.loads((REPO / "data/engine/matchup.json").read_text())


def test_the_real_raw_table_parses() -> None:
    mat, form = center.expand_raw(raw(), families(), presets(), personnel())
    assert set(mat) == {leaf for f in families().values() for leaf in f["leaves"]}
    for leaf, ps in mat.items():
        assert set(ps) == set(presets())


@pytest.mark.parametrize(
    "edit",
    [
        lambda r: r["matchup"][0].update(m=2.5),
        lambda r: r["matchup"][0].update(reason=""),
        lambda r: r["matchup"][0].pop("label"),
        lambda r: r["matchup"].append(copy.deepcopy(r["matchup"][0])),
        lambda r: r["matchup"][0].update(presets=["zoneBlitz"]),
        lambda r: r["matchup"][0].update({"label": "mixed"}),
    ],
)
def test_bad_raw_cells_are_rejected(edit: Any) -> None:
    r = raw()
    edit(r)
    with pytest.raises(center.MatchupError):
        center.expand_raw(r, families(), presets(), personnel())


def fixture_groups() -> dict[str, list[center.Group]]:
    p = presets()
    shares = [1.0 / len(p)] * len(p)
    out: dict[str, list[center.Group]] = {}
    for fam in families().values():
        n = len(fam["classes"])
        for leaf in fam["leaves"]:
            out[leaf] = [
                center.Group(2.0, [1.0 / n] * n, [2.0 * s for s in shares], "shotgun"),
                center.Group(1.0, [(i + 1) / (n * (n + 1) / 2) for i in range(n)], [s for s in shares], "underCenter"),
            ]
    return out


def tilted() -> dict[str, Any]:
    p = presets()
    return {"version": 1, "designed": True, "bounds": {"min": 0.5, "max": 2.0}, "notable": {"below": 0.9, "above": 1.1},
            "matchup": [{"leaves": ["insideRun"], "presets": p, "class": "loss", "m": 1.8, "label": "designed", "reason": "Test tilt."}],
            "formation": []}


def test_centering_check_detects_a_tilt_and_the_normalization_removes_it() -> None:
    g = fixture_groups()
    out, check = center.center(tilted(), g, families(), personnel(), presets())
    ck = check["insideRun"]
    assert max(abs(a - b) for a, b in zip(ck["baseline"], ck["raw"])) * 100 > 0.1
    assert max(abs(a - b) for a, b in zip(ck["baseline"], ck["centered"])) * 100 <= 0.1


def test_normalization_is_deterministic_and_leaves_the_raw_table_untouched() -> None:
    r = tilted()
    before = json.dumps(r, sort_keys=True)
    a = center.center(r, fixture_groups(), families(), personnel(), presets())
    b = center.center(r, fixture_groups(), families(), personnel(), presets())
    assert a == b
    assert json.dumps(r, sort_keys=True) == before


def test_only_the_build_writes_the_centered_file_and_nothing_writes_the_raw_one() -> None:
    writers = []
    for p in (REPO / "pipeline/engine").glob("*.py"):
        text = p.read_text()
        if "MATCHUP_CENTERED_PATH" in text and "write_atomic" in text:
            writers.append(p.name)
        assert not re.search(r"write\w*\([^)]*MATCHUP_PATH", text), p.name
    assert writers == ["build.py"]


# ---------------------------------------------------------------- A3, A7: players


def combine_fixture() -> pl.DataFrame:
    rows = []
    for i in range(60):
        rows.append({"season": 2015 + i % 9, "draft_ovr": float(i + 1), "pos": ["WR", "OT", "QB"][i % 3], "player_name": f"Real Person{i}",
                     "pfr_id": f"PersRe{i:02d}", "forty": 4.3 + (i % 20) * 0.02, "bench": float(10 + i % 15), "wt": 200.0 + i,
                     "cone": 6.8 + (i % 10) * 0.03, "shuttle": 4.1 + (i % 10) * 0.02})
    rows.append({"season": 2024, "draft_ovr": 3.0, "pos": "WR", "player_name": "Holdout Person", "pfr_id": "HoldPe00", "forty": 4.2, "bench": 20.0, "wt": 190.0, "cone": 6.5, "shuttle": 4.0})
    return pl.DataFrame(rows)


def ratings_cfg() -> tuple[dict[str, Any], bytes]:
    b = (REPO / "data/players/ratings.json").read_bytes()
    return json.loads(b), b


SKILLS = {"QB": ["throwPower", "accuracy"], "WR": ["hands", "routeRunning"], "OL": ["passBlock", "runBlock"]}


def test_distributions_rebuild_identically_and_hold_only_summary_tables() -> None:
    r, b = ratings_cfg()
    a, _ = combine.build_distributions(combine_fixture(), r, b, SKILLS)
    c, _ = combine.build_distributions(combine_fixture(), r, b, SKILLS)
    assert json.dumps(a) == json.dumps(c)
    text = json.dumps(a)
    assert "Person" not in text and "PersRe" not in text and "HoldPe" not in text
    for pos, rs in a["ratings"].items():
        for rating, d in rs.items():
            assert d["source"] in ("measured", "designed"), (pos, rating)
    assert a["ratings"]["QB"]["awareness"]["source"] == "designed"


def test_draft_classes_after_2023_are_left_out() -> None:
    pop = combine.population(combine_fixture())
    assert pop.height == 60


def test_a_name_collision_fails_the_build_with_only_a_count() -> None:
    roster = pl.DataFrame({"full_name": ["Abel Ashgrove", "Someone Else"]})
    with pytest.raises(names.NameCollision) as e:
        names.check({"first": ["Abel", "Bram"], "last": ["Ashgrove", "Quill"]}, [roster])
    assert e.value.count == 1
    assert "Abel" not in str(e.value) and "Ashgrove" not in str(e.value)


def test_no_collision_passes_and_counts_combinations() -> None:
    roster = pl.DataFrame({"first_name": ["Some"], "last_name": ["One"]})
    assert names.check({"first": ["Abel", "Bram"], "last": ["Ashgrove", "Quill"]}, [roster]) == 4
