"""B1 to B4: mapping real plays to calls, sneaks, presets, and unmapped values."""

from collections import Counter

import polars as pl
import pytest

from pipeline.caller.mapping import (
    UnmappedValues,
    add_mapped_columns,
    check_unmapped,
    parse_personnel,
    preset_for,
)
from pipeline.tests.caller_fixtures import config, frame

CFG = config()


def mapped(*rows: dict) -> list[dict]:
    return add_mapped_columns(frame(*rows), CFG).to_dicts()


# ------------------------------------------------------------------ B1 offense


@pytest.mark.parametrize(
    ("row", "call"),
    [
        ({"play_type": "qb_spike", "qb_spike": 1.0}, "spike"),
        ({"play_type": "qb_kneel", "qb_kneel": 1.0}, "kneel"),
        ({"play_type": "punt"}, "punt"),
        ({"play_type": "field_goal"}, "fieldGoal"),
        ({"play_type": "pass", "qb_dropback": 1.0}, "pass"),
        ({"play_type": "run", "qb_dropback": 1.0, "qb_scramble": 1.0}, "pass"),  # scramble
        ({"play_type": "run"}, "run"),
        # Priority: spike over pass, kneel over run.
        ({"play_type": "pass", "qb_dropback": 1.0, "qb_spike": 1.0}, "spike"),
        ({"play_type": "run", "qb_kneel": 1.0}, "kneel"),
        # Fakes go by play_type: a fake punt run is a Run, a fake field goal pass is a Pass.
        ({"play_type": "run", "offense_formation": None}, "run"),
        ({"play_type": "pass", "qb_dropback": 0.0}, "pass"),
        ({"play_type": "kickoff"}, None),
    ],
)
def test_top_level_call(row: dict, call: str | None) -> None:
    assert mapped(row)[0]["call"] == call


def test_screen_beats_play_action_and_plain_needs_ftn() -> None:
    base = {"play_type": "pass", "qb_dropback": 1.0, "ftn_present": True, "air_yards": 5.0}
    rows = mapped(
        {**base, "is_screen_pass": True, "is_play_action": True},
        {**base, "is_screen_pass": False, "is_play_action": True},
        {**base, "is_screen_pass": False, "is_play_action": False},
        {**base, "ftn_present": False},
    )
    assert [r["pass_type"] for r in rows] == ["screenPass", "playAction", "plain", None]
    assert [r["depth"] for r in rows] == [None, None, "shortPass", None]


@pytest.mark.parametrize(("air", "depth"), [(-3.0, "shortPass"), (9.9, "shortPass"), (10.0, "intermediatePass"), (19.0, "intermediatePass"), (19.5, "intermediatePass"), (20.0, "deepPass")])
def test_depth_edges(air: float, depth: str) -> None:
    row = {"play_type": "pass", "qb_dropback": 1.0, "ftn_present": True, "is_screen_pass": False, "is_play_action": False, "air_yards": air}
    assert mapped(row)[0]["depth"] == depth


def test_unknown_depth_counts_as_pass_but_has_no_depth() -> None:
    r = mapped({"play_type": "pass", "qb_dropback": 1.0, "ftn_present": True, "is_screen_pass": False, "is_play_action": False, "air_yards": None})[0]
    assert (r["call"], r["pass_type"], r["depth"], r["leaf"]) == ("pass", "plain", None, None)


@pytest.mark.parametrize(
    ("loc", "gap", "run_type"),
    [
        ("middle", None, "insideRun"),
        ("left", "guard", "insideRun"),
        ("right", "tackle", "outsideRun"),
        ("left", "end", "outsideRun"),
        ("left", None, None),
        (None, None, None),
    ],
)
def test_run_direction(loc: str | None, gap: str | None, run_type: str | None) -> None:
    r = mapped({"run_location": loc, "run_gap": gap})[0]
    assert r["call"] == "run"  # unknown direction still counts as Run at the top level
    assert r["run_type"] == run_type


def test_formation_table_and_heavy_override() -> None:
    rows = mapped(
        {"offense_formation": "SHOTGUN"},
        {"offense_formation": "UNDER CENTER"},
        {"offense_formation": "I_FORM"},
        {"offense_formation": "JUMBO"},
        {"offense_formation": "WILDCAT"},
        {"offense_formation": "SHOTGUN", "off_ol": 6},
        {"offense_formation": "SHOTGUN", "off_te": 3},
        {"offense_formation": None},
        {"offense_formation": "SHOTGUN", "play_type": "punt"},
    )
    assert [r["formation"] for r in rows] == [
        "shotgun", "underCenter", "underCenter", "heavy", "shotgun", "heavy", "heavy", None, None,
    ]


def test_personnel_parsing_old_and_new_formats() -> None:
    tokens = CFG["offenseMapping"]["personnelTokens"]
    assert parse_personnel("4 DL, 2 LB, 5 DB", tokens) == {"DL": 4, "LB": 2, "DB": 5}
    assert parse_personnel("3 CB, 2 DE, 2 DT, 1 FS, 2 ILB, 1 SS", tokens)["DB"] == 5
    assert parse_personnel("1 C, 2 G, 1 QB, 1 RB, 2 T, 3 TE", tokens)["OL"] == 5
    with pytest.raises(KeyError):
        parse_personnel("1 XX, 4 DB", tokens)


# ------------------------------------------------------------------ B2 QB sneak


SNEAK = {"season": 2019, "play_type": "run", "ydstogo": 1.0, "run_location": "middle", "run_gap": None, "rusher_threw": True}


def test_inferred_sneak_fires_when_every_condition_holds() -> None:
    assert mapped(SNEAK)[0]["run_type"] == "qbSneak"
    assert mapped({**SNEAK, "ydstogo": 2.0, "run_location": "left", "run_gap": "guard"})[0]["run_type"] == "qbSneak"


@pytest.mark.parametrize(
    "negative",
    [
        {"play_type": "pass", "qb_dropback": 1.0},  # not a run
        {"qb_dropback": 1.0, "qb_scramble": 1.0},  # a scramble
        {"ydstogo": 3.0},  # too far
        {"run_location": "left", "run_gap": "tackle"},  # not middle or guard
        {"rusher_threw": False},  # the rusher threw no pass for this team in this game
    ],
)
def test_inferred_sneak_negatives(negative: dict) -> None:
    assert mapped({**SNEAK, **negative})[0]["run_type"] != "qbSneak"


def test_ftn_flag_replaces_the_rule_from_2022() -> None:
    r = {**SNEAK, "season": 2022, "ftn_present": True}
    assert mapped({**r, "is_qb_sneak": False})[0]["run_type"] == "insideRun"
    assert mapped({**r, "is_qb_sneak": True, "ydstogo": 5.0, "rusher_threw": False})[0]["run_type"] == "qbSneak"
    # No FTN row in a flag season: run type unknown, still a Run at the top level.
    nf = mapped({**r, "ftn_present": False})[0]
    assert (nf["call"], nf["run_type"]) == ("run", None)


# ------------------------------------------------------------------ B3 defense


MAP = CFG["defenseMapping"]
TABLE = {
    # (front, shell, rush) -> preset, every cell of the designed table.
    ("front.baseLight", "cover0", "le4"): "runStuff",
    ("front.baseLight", "cover1", "le4"): "runStuff",
    ("front.baseHeavy", "cover1", "ge5"): "runStuff",
    ("front.baseLight", "cover2", "le4"): "baseCover2",
    ("front.baseLight", "twoMan", "le4"): "baseCover2",
    ("front.baseLight", "cover3", "le4"): "baseCover3",
    ("front.baseHeavy", "cover3", "le4"): "runStuff",
    ("front.baseLight", "cover4", "le4"): "baseCover2",
    ("front.nickelLight", "cover0", "ge5"): "dimeCover0Blitz",
    ("front.nickelLight", "cover1", "le4"): "nickelCover1",
    ("front.nickelHeavy", "cover1", "ge5"): "nickelCover1Blitz",
    ("front.nickelLight", "cover2", "le4"): "nickelCover2",
    ("front.nickelLight", "cover2", "ge5"): "nickelCover2",
    ("front.nickelLight", "twoMan", "le4"): "nickel2Man",
    ("front.nickelLight", "cover3", "ge5"): "nickelCover3",
    ("front.nickelLight", "cover4", "le4"): "nickelCover4",
    ("front.dimeLight", "cover0", "ge5"): "dimeCover0Blitz",
    ("front.dimeLight", "cover1", "le4"): "nickelCover1",
    ("front.dimeLight", "cover1", "ge5"): "nickelCover1Blitz",
    ("front.dimeLight", "cover2", "le4"): "dimeCover4",
    ("front.dimeLight", "twoMan", "le4"): "nickel2Man",
    ("front.dimeLight", "cover3", "le4"): "nickelCover3",
    ("front.dimeHeavy", "cover4", "le4"): "dimeCover4",
    # Goal Line first, then Prevent by personnel or shell.
    ("front.goalLine", "prevent", "le4"): "goalLine",
    ("front.goalLine", "cover1", "ge5"): "goalLine",
    ("front.prevent", "cover1", "ge5"): "prevent",
    ("front.nickelLight", "prevent", "le4"): "prevent",
}


@pytest.mark.parametrize(("key", "preset"), list(TABLE.items()))
def test_preset_table(key: tuple[str, str, str], preset: str) -> None:
    front, shell, rush = key
    assert preset_for(front, f"{shell}.zone.{rush}", MAP) == preset


@pytest.mark.parametrize(
    ("row", "front", "preset"),
    [
        ({"def_db": 3, "defense_coverage_type": "PREVENT"}, "front.goalLine", "goalLine"),  # rule 1 before rule 2
        ({"def_db": 7, "defense_coverage_type": "COVER_1"}, "front.prevent", "prevent"),
        ({"def_db": 5, "defense_coverage_type": "PREVENT"}, "front.nickelLight", "prevent"),
        ({"def_db": 4, "defenders_in_box": 8.0, "defense_coverage_type": "COVER_3"}, "front.baseHeavy", "runStuff"),
        ({"def_db": 5, "defense_coverage_type": "COVER_6", "number_of_pass_rushers": 4.0}, "front.nickelLight", "nickelCover4"),
        ({"def_db": 5, "defense_coverage_type": "COVER_1", "defense_man_zone_type": "MAN_COVERAGE", "number_of_pass_rushers": 5.0}, "front.nickelLight", "nickelCover1Blitz"),
        ({"def_db": 5, "defense_coverage_type": "COMBO"}, "front.nickelLight", None),  # treated as not charted
        ({"def_db": 5, "number_of_pass_rushers": 0.0}, "front.nickelLight", None),  # rushers not charted
        ({"def_db": None}, None, None),
    ],
)
def test_defense_mapping_on_rows(row: dict, front: str | None, preset: str | None) -> None:
    r = mapped({"play_type": "pass", "qb_dropback": 1.0, **row})[0]
    assert (r["front"], r["preset"]) == (front, preset)


# ------------------------------------------------------------------ B4 unmapped


def test_unmapped_values_fail_with_name_and_count() -> None:
    observed = {
        "offense_formation": Counter({"SHOTGUN": 10, "MYSTERY": 3}),
        "defense_coverage_type": Counter({"COVER_3": 5, "COVER_11": 2}),
        "defense_man_zone_type": Counter({"MAN_COVERAGE": 1}),
        "personnel token": Counter({"CB": 4, "XX": 1}),
    }
    with pytest.raises(UnmappedValues) as e:
        check_unmapped(observed, CFG)
    text = str(e.value)
    for needle in ("'MYSTERY' (3 rows)", "'COVER_11' (2 rows)", "'XX' (1 rows)"):
        assert needle in text
    assert "SHOTGUN" not in text


def test_every_value_in_the_tables_passes() -> None:
    observed = {
        "offense_formation": Counter(dict.fromkeys(CFG["offenseMapping"]["formation"], 1)),
        "defense_coverage_type": Counter(dict.fromkeys(CFG["defenseMapping"]["coverage"], 1)),
        "defense_man_zone_type": Counter(dict.fromkeys(CFG["defenseMapping"]["manZone"], 1)),
        "personnel token": Counter(dict.fromkeys(CFG["offenseMapping"]["personnelTokens"], 1)),
    }
    check_unmapped(observed, CFG)


def test_mapping_never_needs_a_value_outside_the_tables() -> None:
    df = add_mapped_columns(frame({"offense_formation": "SOMETHING_NEW"}), CFG)
    # replace_strict with default None: an unknown value is null here, which is why the
    # build runs check_unmapped over every observed value before mapping.
    assert df["formation"].to_list() == [None]
    assert isinstance(df, pl.DataFrame)
