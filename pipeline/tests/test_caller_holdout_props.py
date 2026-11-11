"""C2 from the spec: no 2024, 2025 or 2026 play reaches any fitted cell, for every factor.

test_caller_fit.py covers this on scrimmage downs 1-3 only (its fixture rows are 1st downs,
so the 4th-down, try and two-point factors are fitted on empty frames there). These tests
use frames from the stub source, which has 4th downs, tries and two-point plays in every
season, and check that the holdout rows change nothing at all.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import polars as pl
import pytest

from pipeline.caller.build import build, fit_all, prepare_plays
from pipeline.caller.load import load_all
from pipeline.tables import TableSpec
from pipeline.tests.caller_fixtures import CallerStubSource, config, make_root

HOLDOUT = (2024, 2025, 2026)


def quiet(_: str) -> None:
    pass


@pytest.fixture(autouse=True)
def small_golden_grid(monkeypatch: pytest.MonkeyPatch) -> None:
    from pipeline.caller import golden

    full = golden.grid
    monkeypatch.setattr(golden, "grid", lambda: full()[::40])


def low_n_config() -> dict[str, Any]:
    cfg = config()
    for f in cfg["factors"].values():
        f["minPlays"] = 1
    return cfg


def prepared(seasons: list[int], cfg: dict[str, Any]) -> pl.DataFrame:
    return prepare_plays(load_all(CallerStubSource(), seasons), cfg)


def test_holdout_rows_of_every_kind_change_no_fitted_factor() -> None:
    cfg = low_n_config()
    train = prepared(list(range(2016, 2024)), cfg)
    hold = prepared([2024, 2025], cfg)
    # The build never loads 2026 (it is in progress), but a 2026 row must not leak either.
    hold = pl.concat([hold, hold.filter(pl.col("season") == 2025).with_columns(season=pl.lit(2026, dtype=pl.Int64))], how="diagonal_relaxed")
    assert set(hold["season"].unique().to_list()) == set(HOLDOUT)

    # Not vacuous: relabelled as 2023, the same rows do reach every factor.
    from pipeline.caller.frames import factor_frames

    as_2023 = factor_frames(hold.with_columns(season=pl.lit(2023, dtype=pl.Int64)), cfg)
    empty = [fid for fid, fr in as_2023.items() if fr.height == 0]
    assert empty == [], f"holdout fixture rows never reach {empty}"

    combined = pl.concat([train, hold], how="diagonal_relaxed")
    for fid, fr in factor_frames(combined, cfg).items():
        assert fr.filter(pl.col("season") >= 2024).height == 0, fid

    assert fit_all(combined, cfg) == fit_all(train, cfg)


class HoldoutChangedSource(CallerStubSource):
    """The stub source with every 2024+ play rewritten: scrimmage plays become kneels, tries
    become two-point passes, coverage is all Cover 0 man with six rushers, and every FTN pass
    is a screen. Records which seasons were requested."""

    def __init__(self) -> None:
        super().__init__()
        self.requested: set[int] = set()

    def load_season(self, spec: TableSpec, season: int) -> pl.DataFrame:
        self.requested.add(season)
        df = super().load_season(spec, season)
        if season < 2024:
            return df
        if spec.key == "pbp":
            scrim = pl.col("down").is_not_null()
            return df.with_columns(
                play_type=pl.when(scrim).then(pl.lit("qb_kneel")).otherwise(pl.lit("pass")),
                qb_kneel=pl.when(scrim).then(1.0).otherwise(0.0),
                qb_dropback=pl.when(scrim).then(0.0).otherwise(1.0),
                qb_scramble=pl.lit(0.0),
                qb_spike=pl.lit(0.0),
                two_point_attempt=pl.when(scrim).then(0.0).otherwise(1.0),
                extra_point_attempt=pl.lit(0.0),
                yardline_100=pl.when(scrim).then(pl.col("yardline_100")).otherwise(2.0),
            )
        if spec.key == "participation":
            return df.with_columns(
                defense_coverage_type=pl.lit("COVER_0"),
                defense_man_zone_type=pl.lit("MAN_COVERAGE"),
                number_of_pass_rushers=pl.lit(6),
                defenders_in_box=pl.lit(8),
            )
        return df.with_columns(is_screen_pass=pl.lit(True))


def test_full_build_tables_ignore_holdout_content(tmp_path: Path) -> None:
    plain = make_root(tmp_path / "plain", tolerance=100.0)
    changed = make_root(tmp_path / "changed", tolerance=100.0)
    src = HoldoutChangedSource()
    assert build(CallerStubSource(), plain, log=quiet) == 0
    assert build(src, changed, log=quiet) == 0
    assert max(src.requested) == 2025, "2026 must never be loaded"
    assert {2024, 2025} <= src.requested
    for p in ("data/caller/offense.table.json", "data/caller/defense.table.json", "data/caller/golden.json"):
        assert (plain / p).read_bytes() == (changed / p).read_bytes(), p
    # The rewritten rows did reach validation, so the comparison above is not vacuous.
    a = json.loads((plain / "data/caller/validation.json").read_text())
    b = json.loads((changed / "data/caller/validation.json").read_text())
    assert a["metrics"] != b["metrics"]
