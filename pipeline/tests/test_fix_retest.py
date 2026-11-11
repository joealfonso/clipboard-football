"""Retest after the code-review fixes on M1 step 1: spec behaviors the fixes touched that
the engineer's own tests did not pin down. Offline: fake loaders and stub sources only."""

import re
from pathlib import Path

import polars as pl
import pytest
import requests
from nflreadpy.config import get_config, reset_config

from pipeline import cache
from pipeline.inventory import run
from pipeline.sources import NflreadpySource
from pipeline.stats import kickoff_summary
from pipeline.survey import SeasonUnavailable
from pipeline.tables import TABLES
from pipeline.tests.stubs import StubSource

PBP = next(t for t in TABLES if t.key == "pbp")
SCHEDULES = next(t for t in TABLES if t.key == "schedules")
CURRENT = 2026


@pytest.fixture(autouse=True)
def restore_config():
    yield
    reset_config()


def wrapped(status: int) -> ConnectionError:
    response = requests.Response()
    response.status_code = status
    try:
        raise requests.HTTPError(response=response)
    except requests.HTTPError as cause:
        try:
            raise ConnectionError("Failed to download") from cause
        except ConnectionError as e:
            return e


class RaisingNfl:
    def __init__(self, error: BaseException) -> None:
        self.error = error

    def get_current_season(self, roster: bool = False) -> int:
        return CURRENT

    def load_pbp(self, season: int) -> pl.DataFrame:
        raise self.error

    def load_schedules(self) -> pl.DataFrame:
        raise self.error


def make(tmp_path: Path, nfl: object) -> NflreadpySource:
    src = NflreadpySource(tmp_path)
    src._nfl = nfl  # type: ignore[assignment]
    return src


# Fix 5: a failed volatile load must not leave the 24h expiry in place, or every
# completed season loaded after it would expire too and break the offline rerun (C3).


@pytest.mark.parametrize("status", [404, 503])
def test_expiry_is_restored_after_a_volatile_season_fails(tmp_path: Path, status: int) -> None:
    src = make(tmp_path, RaisingNfl(wrapped(status)))
    with pytest.raises((SeasonUnavailable, ConnectionError)):
        src.load_season(PBP, CURRENT)
    assert get_config().cache_duration == cache.NEVER_EXPIRE_SECONDS


def test_expiry_is_restored_after_a_whole_table_load_fails(tmp_path: Path) -> None:
    src = make(tmp_path, RaisingNfl(ValueError("bad parquet")))
    with pytest.raises(ValueError):
        src.load_whole(SCHEDULES)
    assert get_config().cache_duration == cache.NEVER_EXPIRE_SECONDS


def test_volatile_404_is_reported_as_unavailable_not_failed(tmp_path: Path) -> None:
    # The report must still say "no file published" for an unpublished in-progress season.
    src = make(tmp_path, RaisingNfl(wrapped(404)))
    with pytest.raises(SeasonUnavailable):
        src.load_season(PBP, CURRENT)


# Fix 2: touchback, fair catch and return are separate outcomes.


def kicks(rows: list[tuple[float | None, float | None, str | None]]) -> pl.DataFrame:
    n = len(rows)
    return pl.DataFrame(
        {
            "game_id": [f"g{i}" for i in range(n)],
            "play_id": [1.0] * n,
            "play_type": ["kickoff"] * n,
            "posteam": ["A"] * n,
            "yardline_100": [35.0] * n,
            "touchback": [r[0] for r in rows],
            "kickoff_fair_catch": [r[1] for r in rows],
            "kickoff_returner_player_id": [r[2] for r in rows],
        },
        schema_overrides={"touchback": pl.Float64, "kickoff_fair_catch": pl.Float64},
    )


def test_fair_catch_with_named_returner_is_not_a_return() -> None:
    k = kickoff_summary(kicks([(0.0, 1.0, "00-1"), (0.0, 0.0, "00-2")]))
    assert k.fair_catch_rate == pytest.approx(50.0)
    assert k.return_rate == pytest.approx(50.0)


def test_null_flags_do_not_hide_a_return() -> None:
    k = kickoff_summary(kicks([(None, None, "00-1")]))
    assert (k.touchback_rate, k.fair_catch_rate, k.return_rate) == (0.0, 0.0, 100.0)


def test_outcomes_never_sum_past_100() -> None:
    rows = [
        (1.0, 0.0, "00-1"),
        (0.0, 1.0, "00-2"),
        (0.0, 0.0, "00-3"),
        (0.0, 0.0, None),
        (None, None, None),
    ]
    k = kickoff_summary(kicks(rows))
    assert k.touchback_rate + k.fair_catch_rate + k.return_rate <= 100.0 + 1e-9
    assert (k.touchback_rate, k.fair_catch_rate, k.return_rate) == (20.0, 20.0, 20.0)


def test_fair_catch_column_appears_in_the_kickoff_answer(tmp_path: Path) -> None:
    out = tmp_path / "DATA.md"
    assert run(out, StubSource()) == 0
    text = out.read_text(encoding="utf-8")
    answer = text[text.index("### 1. Kickoff format") : text.index("### 2. Holdout coverage")]
    assert "fair catch %" in answer
    assert "kickoff_fair_catch" in answer


# Fix 5: the "Cache policy" line is deterministic and has no timestamp (C2).


def policy_line(text: str) -> str:
    return next(ln for ln in text.splitlines() if "Cache policy:" in ln)


def test_cache_policy_line_names_volatile_seasons_and_whole_tables(tmp_path: Path) -> None:
    out = tmp_path / "DATA.md"
    assert run(out, StubSource()) == 0
    line = policy_line(out.read_text(encoding="utf-8"))
    assert "Play-by-play 2025" in line
    for spec in TABLES:
        if spec.mode == "whole":
            assert spec.title in line, spec.title
    assert not re.search(r"\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}", line)


def test_cache_policy_line_is_identical_across_runs(tmp_path: Path) -> None:
    a, b = tmp_path / "a.md", tmp_path / "b.md"
    assert run(a, StubSource()) == 0
    assert run(b, StubSource()) == 0
    assert a.read_bytes() == b.read_bytes()
    assert policy_line(a.read_text(encoding="utf-8")) == policy_line(b.read_text(encoding="utf-8"))
