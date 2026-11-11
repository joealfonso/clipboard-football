from pathlib import Path

import polars as pl
import pytest

from pipeline.inventory import build_report, run
from pipeline.tables import TABLES
from pipeline.tests.stubs import PLAYER_ID, PLAYER_NAME, StubSource, participation, unavailable


def read_run(tmp_path: Path, source: StubSource) -> tuple[int, str]:
    out = tmp_path / "docs" / "DATA.md"
    code = run(out, source)
    return code, out.read_text(encoding="utf-8")


def section(text: str, title: str) -> str:
    start = text.index(f". {title}\n", text.index("## Tables"))
    end = text.find("\n### ", start)
    return text[start : end if end != -1 else None]


def test_every_table_is_reported(tmp_path: Path) -> None:
    code, text = read_run(tmp_path, StubSource())
    assert code == 0
    for spec in TABLES:
        assert f". {spec.title}\n" in text


def test_loader_that_raises_is_reported_and_run_exits_zero(tmp_path: Path) -> None:
    def boom() -> pl.DataFrame:
        raise ValueError("Failed to parse data from https://example.invalid/x.parquet")

    code, text = read_run(tmp_path, StubSource(whole={"contracts": boom}))
    assert code == 0
    body = section(text, "Contracts")
    assert "Status: failed. ValueError: Failed to parse data" in body


def test_one_failing_season_is_reported_and_others_survive(tmp_path: Path) -> None:
    def flaky(season: int) -> pl.DataFrame:
        if season == 2024:
            raise ConnectionError("Failed to download: connection reset")
        return participation(season)

    code, text = read_run(tmp_path, StubSource(per_season={"participation": flaky}))
    assert code == 0
    body = section(text, "Participation")
    assert "| 2024 | ConnectionError: Failed to download: connection reset |" in body
    assert "| 2025 | 2 |" in body
    assert "Participation 2024: failed: ConnectionError" in text


def test_missing_loader_and_empty_result(tmp_path: Path) -> None:
    source = StubSource(whole={"draft_picks": lambda: pl.DataFrame({"season": []})})
    del source.per_season["injuries"]
    code, text = read_run(tmp_path, source)
    assert code == 0
    assert "Status: failed. no loader in nflreadpy 9.9.9" in section(text, "Injuries")
    assert "Status: failed. EmptyResult" in section(text, "Draft picks")
    assert "no loader in nflreadpy 9.9.9" in section(text, "Draft pick values")


def test_unpublished_season_is_reported(tmp_path: Path) -> None:
    def ftn_or_404(season: int) -> pl.DataFrame:
        if season == 2025:
            return unavailable(season)
        from pipeline.tests.stubs import ftn

        return ftn(season)

    code, text = read_run(tmp_path, StubSource(per_season={"ftn_charting": ftn_or_404}))
    assert code == 0
    assert "FTN charting 2025: no file published (HTTP 404)." in text


def test_table_without_season_column_reports_totals(tmp_path: Path) -> None:
    _, text = read_run(tmp_path, StubSource())
    assert "no season column, so totals only" in section(text, "Contracts")


def test_answers_are_computed(tmp_path: Path) -> None:
    report = build_report(StubSource())
    assert report.kickoffs[2024].kickoffs == 1
    cov = report.coverage["participation"][2024]
    # pbp has 3 rows with a play_type; participation matches plays 1 and 2.
    assert (cov.rows, cov.pbp_plays) == (2, 3)
    assert cov.key_coverage == pytest.approx(200 / 3)
    _, text = read_run(tmp_path, StubSource())
    assert "`defense_coverage_type`" in text
    assert "`n_blitzers`" in text


def test_no_player_names_or_ids(tmp_path: Path) -> None:
    _, text = read_run(tmp_path, StubSource())
    assert PLAYER_NAME not in text
    assert PLAYER_ID not in text


def test_write_failure_exits_non_zero(tmp_path: Path) -> None:
    blocker = tmp_path / "docs"
    blocker.write_text("a file where the docs directory should be")
    assert run(blocker / "DATA.md", StubSource()) == 1


def test_bad_charting_keys_are_reported_and_run_continues(tmp_path: Path) -> None:
    def bad_ids(season: int) -> pl.DataFrame:
        return pl.DataFrame(
            {"nflverse_game_id": [f"{season}_01_A_B"], "play_id": ["not-a-number"]}
        )

    code, text = read_run(tmp_path, StubSource(per_season={"participation": bad_ids}))
    assert code == 0
    assert "Errors computing participation coverage:" in text
    assert "InvalidOperationError" in text
    assert "| 2024 | 1 | 3 | 33.33 | n/a | key join failed, see errors below |" in text
    # FTN, surveyed after participation, still ran.
    assert "FTN charting 2024: present" in text
