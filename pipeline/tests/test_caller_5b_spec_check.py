"""Test-writer spec checks for M1 step 5b, milestone B (docs/specs/m1-step5b-late-game-and-clock-control.md),
from the spec text rather than the implementation:

- B2: can-kneel-out from the spec's formula (4 - d) x P + k - P x min(t, 4 - d) >= secondsLeft with P
  from the rule set, over the whole grid, so Python and TypeScript (late5b.spec-check.test.ts) agree
  with the same formula; window edges and score buckets.
- B6: no 2024-2026 row reaches any cell, regulation or overtime; dropping every overtime row changes no
  non-overtime o4Top cell (the engineer's test covers oTop only).
"""

from __future__ import annotations

import json

import polars as pl
import pytest

from pipeline.caller.bins import bin_situation
from pipeline.caller.config import REPO, rules_json, with_rule_play_clock
from pipeline.caller.fit import HoldoutLeak, fit_factor, label_col

CFG = with_rule_play_clock(json.loads((REPO / "data/caller/config.json").read_text()), rules_json())
DIMS = CFG["dimensions"]
P = rules_json()["clock"]["playClockAfterPlay"]
K = CFG["dimensions"]["kneelOut"]["kneelSeconds"]
FOUR = CFG["factors"]["o4Top"]
TOP = CFG["factors"]["oTop"]


def sit(**o: int) -> dict:
    base = {"phase": "scrimmage", "down": 1, "yardsToGo": 10, "yardLine100": 50, "scoreDiff": 0, "quarter": 4,
            "secondsLeftInHalf": 100, "secondsLeftInGame": 100, "offenseTimeouts": 2, "defenseTimeouts": 2}
    base.update(o)
    if "secondsLeftInGame" in o and "secondsLeftInHalf" not in o:
        base["secondsLeftInHalf"] = o["secondsLeftInGame"]
    return base


def test_b2_kneel_out_matches_the_spec_formula_over_the_grid() -> None:
    assert P == 40
    bad = []
    for quarter, max_secs in ((4, 120), (5, 600)):
        for secs in range(1, max_secs + 1):
            for down in (1, 2, 3):
                for t in range(4):
                    for diff in (1, 8, 9):
                        want = "K1" if (4 - down) * P + K - P * min(t, 4 - down) >= secs else "K0"
                        got = bin_situation(sit(quarter=quarter, secondsLeftInGame=secs, down=down, defenseTimeouts=t, scoreDiff=diff), DIMS)["kneelOut"]
                        if got != want:
                            bad.append((quarter, secs, down, t, diff, got, want))
    assert bad[:10] == []


def test_b2_spec_edge_case_leading_by_4_at_1_50() -> None:
    assert bin_situation(sit(scoreDiff=4, secondsLeftInGame=110, defenseTimeouts=0), DIMS)["kneelOut"] == "K1"
    assert bin_situation(sit(scoreDiff=4, secondsLeftInGame=110, defenseTimeouts=1), DIMS)["kneelOut"] == "K0"


@pytest.mark.parametrize(
    "s",
    [sit(scoreDiff=0, secondsLeftInGame=10, defenseTimeouts=0), sit(scoreDiff=-3, secondsLeftInGame=10, defenseTimeouts=0),
     sit(scoreDiff=4, down=4, secondsLeftInGame=10, defenseTimeouts=0), sit(scoreDiff=4, secondsLeftInGame=121, defenseTimeouts=0),
     sit(scoreDiff=4, quarter=2, secondsLeftInGame=1810, secondsLeftInHalf=10, defenseTimeouts=0)],
)
def test_b2_no_kneel_out_bin_when_not_leading_on_4th_in_g5_or_h1f(s: dict) -> None:
    assert bin_situation(s, DIMS)["kneelOut"] is None


def test_b2_window_edges_in_q4_and_overtime() -> None:
    for secs, label in ((301, "-"), (300, "G5"), (121, "G5"), (120, "GF")):
        assert bin_situation(sit(secondsLeftInGame=secs), DIMS)["lateTime"] == label, secs
        assert bin_situation(sit(quarter=5, secondsLeftInGame=secs), DIMS)["lateTime"] == "OT", secs
    want = {-9: "<=-9", -8: "-8..-1", -1: "-8..-1", 0: "0", 1: "1..8", 8: "1..8", 9: ">=9"}
    for d, label in want.items():
        assert bin_situation(sit(scoreDiff=d, secondsLeftInGame=200), DIMS)["scoreLate5Only"] == label
        assert bin_situation(sit(scoreDiff=d, quarter=5, secondsLeftInGame=500), DIMS)["scoreLate5Only"] == label
        assert bin_situation(sit(scoreDiff=d, secondsLeftInGame=301), DIMS)["scoreLate5Only"] is None
    h1f = bin_situation(sit(quarter=2, scoreDiff=3, secondsLeftInGame=1860, secondsLeftInHalf=60), DIMS)
    assert h1f["lateTime"] == "-" and h1f["scoreLate5Only"] is None


# ---------------------------------------------------------------- B6

def _dims_of(factor: dict) -> list[str]:
    return sorted({d for lv in factor["levels"] for d in lv["dims"]})


def _rows(factor: dict, items: list[tuple[dict, int, str, bool]]) -> pl.DataFrame:
    dims = _dims_of(factor)
    out: dict[str, list] = {label_col(d): [] for d in dims}
    out |= {"season": [], "target": [], "down": [], "is_ot": [], "tag": []}
    for s, season, target, ot in items:
        lab = bin_situation(s, DIMS)
        for d in dims:
            out[label_col(d)].append(lab[d])
        out["season"].append(season)
        out["target"].append(target)
        out["down"].append(float(s["down"]))
        out["is_ot"].append(ot)
        out["tag"].append(None)
    return pl.DataFrame(out, schema_overrides={label_col(d): pl.String for d in dims} | {"tag": pl.String})


@pytest.mark.parametrize("season", [2024, 2025, 2026])
@pytest.mark.parametrize("ot", [False, True])
def test_b6_a_holdout_row_never_reaches_a_late_cell(season: int, ot: bool) -> None:
    q, secs = (5, 300) if ot else (4, 100)
    clean = [(sit(down=1 + i % 3, scoreDiff=3, quarter=q, secondsLeftInGame=secs, defenseTimeouts=0), 2016 + i % 8, "kneel", ot) for i in range(300)]
    leak = [(sit(down=1, scoreDiff=3, quarter=q, secondsLeftInGame=secs, defenseTimeouts=0), season, "kneel", ot)]
    fit_factor(_rows(TOP, clean), TOP, 2023, 2, 2024)
    with pytest.raises(HoldoutLeak):
        fit_factor(_rows(TOP, clean + leak), TOP, 2023, 2, 2024)


def test_b6_dropping_overtime_rows_changes_no_non_overtime_o4top_cell() -> None:
    targets = FOUR["targets"]
    reg = [(sit(down=4, yardsToGo=1 + i % 12, yardLine100=5 + i % 90, scoreDiff=(i % 21) - 10, quarter=4 if i % 2 else 2,
                secondsLeftInGame=30 + i % 280), 2016 + i % 8, targets[i % len(targets)], False) for i in range(6000)]
    ot = [(sit(down=4, yardsToGo=1 + i % 12, yardLine100=5 + i % 90, scoreDiff=(i % 7) - 3, quarter=5,
               secondsLeftInGame=30 + i % 570), 2016 + i % 8, targets[(i + 1) % len(targets)], True) for i in range(3000)]
    fit = lambda rows: fit_factor(_rows(FOUR, rows), FOUR, 2023, 2, 2024)  # noqa: E731
    without = fit(reg)
    with_ot = fit(reg + ot)
    ot_cells = 0
    for level, (a, b) in enumerate(zip(without["cells"], with_ot["cells"], strict=True)):
        for key, w in b.items():
            if "OT" in key.split("|"):
                ot_cells += 1
                assert "lateTime" in FOUR["levels"][level]["dims"], (level, key)
            else:
                assert a.get(key) == w, (level, FOUR["levels"][level]["dims"], key)
        assert set(a) <= set(b), level
    assert ot_cells > 0
