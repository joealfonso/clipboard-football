"""Spec checks for M1 step 4 (docs/specs/m1-step4-play-engine.md) on the committed files.

Written by test-writer from the spec, for criteria the existing pipeline tests cover only on
fixtures: A3 (the committed distributions.json labels every rating, measured only where a
drill backs it), B2 (every generated table's metadata lists only training seasons), B8 (the
committed penalty table has a rate for every supported id), and resolved question 5 (the five
added penalties are in the rule set).
"""

from __future__ import annotations

import json
from typing import Any

from pipeline.caller.config import REPO
from pipeline.engine.config import GENERATED_FILES

HOLDOUT = {2024, 2025, 2026}


def load(path: str) -> Any:
    return json.loads((REPO / path).read_text())


# ---------------------------------------------------------------- A3


def test_committed_distributions_label_every_rating_and_measure_only_where_a_drill_exists() -> None:
    d = load("data/players/distributions.json")
    r = load("data/players/ratings.json")
    assert d["generated"] is True
    measured = r["measured"]
    for pos, ratings in d["ratings"].items():
        drills = set(d["drills"].get(pos, {}))
        for rating, dist in ratings.items():
            assert dist["source"] in ("measured", "designed"), (pos, rating)
            inputs = set(measured.get(rating, {}).get("drills", []))
            backed = bool(inputs & drills)
            assert (dist["source"] == "measured") == backed, (pos, rating, dist["source"], sorted(inputs & drills))


def test_awareness_and_every_position_skill_are_designed() -> None:
    d = load("data/players/distributions.json")
    for pos, ratings in d["ratings"].items():
        for rating, dist in ratings.items():
            if rating not in ("speed", "strength", "agility"):
                assert dist["source"] == "designed", (pos, rating)


def test_committed_distributions_hold_only_summary_tables() -> None:
    d = load("data/players/distributions.json")
    assert set(d) <= {"generated", "schemaVersion", "ratingsHash", "draftClasses", "percentiles", "ratings", "drills"}
    for pos, drills in d["drills"].items():
        for drill, t in drills.items():
            assert set(t) == {"cuts", "n"}, (pos, drill)
            assert all(isinstance(x, (int, float)) for x in t["cuts"]), (pos, drill)
            assert t["cuts"] == sorted(t["cuts"]), (pos, drill)
    assert d["draftClasses"]["to"] <= 2023


# ---------------------------------------------------------------- B2


def test_every_generated_table_lists_only_training_seasons() -> None:
    for p in GENERATED_FILES:
        meta = json.loads((REPO / p).read_text())
        for key in ("seasons", "passSeasons"):
            if key in meta:
                assert not set(meta[key]) & HOLDOUT, (p.name, key, meta[key])
                assert min(meta[key]) >= 2016, (p.name, key)
        if "seasonWeights" in meta:
            assert not {int(s) for s in meta["seasonWeights"]} & HOLDOUT, p.name


# ---------------------------------------------------------------- B8


def test_committed_penalty_table_covers_every_supported_id() -> None:
    rules = load("data/rules/nfl-2026.json")
    p = load("data/engine/baseline.penalties.json")
    assert list(p["ids"]) == list(rules["penalties"]) or set(p["ids"]) == set(rules["penalties"])
    designed_kickoff = {"kickoffIllegalFormation"}  # kickoff fouls are designed (kickoff.json)
    k = load("data/engine/kickoff.json")
    for pid in p["ids"]:
        if pid in designed_kickoff:
            assert pid in json.dumps(k), pid
            continue
        total = 0
        for levels in p["families"].values():
            for cells in levels:
                for xs in cells.values():
                    total += xs[p["ids"].index(pid)]
        assert total > 0, f"{pid} has no rate in any family"


# ---------------------------------------------------------------- resolved question 5


def test_the_five_added_penalties_are_in_the_rule_set_with_a_cited_rules_row() -> None:
    rules = load("data/rules/nfl-2026.json")
    doc = (REPO / "docs/RULES.md").read_text()
    for pid in ("defensivePassInterference", "offensivePassInterference", "illegalContact", "roughingThePasser", "unnecessaryRoughness"):
        assert pid in rules["penalties"], pid
        rows = [ln for ln in doc.splitlines() if ln.startswith(f"| `penalties.{pid}.")]
        assert rows, pid
        assert all("Rule " in ln and "http" in ln for ln in rows), pid


# ---------------------------------------------------------------- A3 / resolved question 8: cut points


def test_committed_cut_points_skip_0_and_100_and_need_20_players() -> None:
    from pipeline.engine import combine

    d = load("data/players/distributions.json")
    ps = d["percentiles"]
    assert 0.0 not in ps and 1.0 not in ps
    assert min(ps) >= 0.05 and max(ps) <= 0.95
    for pos, drills in d["drills"].items():
        for drill, t in drills.items():
            assert t["n"] >= 20, (pos, drill, t["n"])
            assert t["n"] >= combine.CUT_PLAYERS >= 5
            assert len(t["cuts"]) == len(ps), (pos, drill)


def test_no_cut_point_is_a_single_players_value() -> None:
    """Nudge any one player's value by delta: every cut moves by 0 or delta / CUT_PLAYERS, never
    by delta, so no cut is one player's measurement. The minimum and maximum never surface."""
    from pipeline.engine import combine

    base = [4.3 + 0.1 * i + 0.003 * (i % 7) for i in range(41)]
    cuts = combine.cut_points(base)
    assert min(cuts) > min(base) and max(cuts) < max(base)
    delta = 0.05  # under the 0.082 minimum gap, so ranks never change
    step = delta / combine.CUT_PLAYERS
    moved_any = 0
    for i in range(len(base)):
        moved = list(base)
        moved[i] += delta
        for a, b in zip(cuts, combine.cut_points(moved)):
            shift = b - a
            assert abs(shift) <= 0.0011 or abs(shift - step) <= 0.0011, (i, a, b)
            moved_any += abs(shift - step) <= 0.0011
    assert moved_any >= len(cuts)  # every cut is moved by some player, by a fifth of the nudge


def test_a_drill_with_19_players_is_not_shipped() -> None:
    import polars as pl

    from pipeline.engine import combine

    r, b = ratings_cfg_local()
    rows = [{"season": 2015, "draft_ovr": float(i + 1), "pos": "WR", "player_name": f"X{i}", "pfr_id": f"x{i}",
             "forty": 4.4 + i * 0.01, "bench": float(10 + i) if i < 19 else None, "wt": 190.0 + i,
             "cone": 6.8 + i * 0.01, "shuttle": 4.1 + i * 0.01} for i in range(25)]
    out, _ = combine.build_distributions(pl.DataFrame(rows), r, b, {"WR": ["hands", "routeRunning"]})
    assert "bench" not in out["drills"]["WR"] and "forty" in out["drills"]["WR"]


def ratings_cfg_local() -> tuple[dict[str, Any], bytes]:
    b = (REPO / "data/players/ratings.json").read_bytes()
    return json.loads(b), b
