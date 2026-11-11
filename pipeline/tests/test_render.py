import polars as pl

from pipeline.inventory import Report
from pipeline.render import format_seasons, render
from pipeline.stats import season_stats
from pipeline.survey import TableSurvey
from pipeline.tables import TABLES

SCHEDULES = next(t for t in TABLES if t.key == "schedules")
PBP = next(t for t in TABLES if t.key == "pbp")


def report_with(df_2024: pl.DataFrame, df_2025: pl.DataFrame) -> Report:
    survey = TableSurvey(spec=SCHEDULES, requested=[2024, 2025])
    survey.per_season = {2024: season_stats(df_2024), 2025: season_stats(df_2025)}
    return Report(nflreadpy_version="9.9.9", surveys=[survey])


def test_same_input_renders_identically() -> None:
    df = pl.DataFrame({"b": [1, None], "a": ["x", "y"]})
    assert render(report_with(df, df)) == render(report_with(df, df))


def test_columns_render_sorted_regardless_of_input_order() -> None:
    forward = pl.DataFrame({"alpha": [1], "mid": [2], "zulu": [3]})
    backward = forward.select(["zulu", "mid", "alpha"])
    text_f = render(report_with(forward, forward))
    text_b = render(report_with(backward, backward))
    assert text_f == text_b
    assert text_f.index("`alpha`") < text_f.index("`mid`") < text_f.index("`zulu`")


def test_detail_tables_show_each_season_and_absent_columns() -> None:
    survey = TableSurvey(spec=PBP, requested=[2024, 2025])
    survey.per_season = {
        2024: season_stats(pl.DataFrame({"a": [1, None, 3, 4]})),
        2025: season_stats(pl.DataFrame({"a": [1, 2], "new": [None, None]})),
    }
    text = render(Report(nflreadpy_version="9.9.9", surveys=[survey]))
    assert "| `a` | Int64 | 16.67 | 25.00 | 0.00 |" in text
    assert "| `new` | Null | 100.00 | - | 100.00 |" in text
    assert "`new` is present only in: 2025." in text
    assert "`new` is entirely null in: 2025." in text


def test_format_seasons() -> None:
    assert format_seasons([2005, 1999, 2000, 2001]) == "1999-2001, 2005"
    assert format_seasons([]) == "none"


def test_kickoff_shift_is_read_from_the_numbers() -> None:
    from pipeline.stats import KickoffSummary

    report = Report(nflreadpy_version="9.9.9")
    report.kickoffs = {
        2022: KickoffSummary(100, 60.0, 2.0, 38.0, 25.5, 100),
        2023: KickoffSummary(100, 61.0, 2.0, 37.0, 25.4, 100),
        2024: KickoffSummary(100, 62.0, 2.0, 36.0, 29.9, 100),
    }
    text = render(report)
    assert "from the prior season: 2024 (touchbacks 61.0% to 62.0%" in text
    assert "2023 (touchbacks" not in text


def test_snapshot_lists_volatile_seasons() -> None:
    survey = TableSurvey(spec=PBP, requested=[2025, 2026])
    report = Report(nflreadpy_version="9.9.9", surveys=[survey], volatile={"pbp": [2026]})
    text = render(report)
    assert "more than 24 hours old: Play-by-play 2026. If a refetch fails" in text
