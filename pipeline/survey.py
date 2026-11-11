"""Surveys one table through a loader, turning every failure into a reportable row."""

import re
from collections.abc import Callable
from dataclasses import dataclass, field

import polars as pl

from pipeline.stats import SeasonStats, season_stats
from pipeline.tables import TableSpec

MAX_ERROR_CHARS = 300


class SeasonUnavailable(Exception):
    """The source has no file for this season (HTTP 404)."""


@dataclass
class TableSurvey:
    spec: TableSpec
    requested: list[int] = field(default_factory=list)
    per_season: dict[int, SeasonStats] = field(default_factory=dict)
    unavailable: list[int] = field(default_factory=list)
    failed: dict[int, str] = field(default_factory=dict)
    # Whole-table failure: no loader, the loader raised, or it returned nothing.
    error: str | None = None
    # Set only for a table with no season column.
    total: SeasonStats | None = None
    # Rows of a whole table whose season is null, so they fit no season.
    null_season_rows: int = 0


def describe_error(e: BaseException) -> str:
    """Class and message, with memory addresses removed so reruns produce the same text."""
    message = re.sub(r" at 0x[0-9a-fA-F]+", "", str(e)).strip()
    message = " ".join(message.split())
    if len(message) > MAX_ERROR_CHARS:
        message = message[:MAX_ERROR_CHARS] + "..."
    return f"{type(e).__name__}: {message}" if message else type(e).__name__


EMPTY_RESULT = "EmptyResult: loader returned no rows"

OnFrame = Callable[[int, pl.DataFrame], None]


def survey_per_season(
    spec: TableSpec,
    seasons: list[int],
    load: Callable[[int], pl.DataFrame],
    on_frame: OnFrame | None = None,
) -> TableSurvey:
    survey = TableSurvey(spec=spec, requested=list(seasons))
    for season in seasons:
        try:
            df = load(season)
        except SeasonUnavailable:
            survey.unavailable.append(season)
            continue
        except Exception as e:  # noqa: BLE001 - any loader failure is data for the report
            survey.failed[season] = describe_error(e)
            continue
        if df.height == 0:
            survey.failed[season] = EMPTY_RESULT
            continue
        survey.per_season[season] = season_stats(df)
        if on_frame is not None:
            on_frame(season, df)
        del df
    return survey


def survey_whole(
    spec: TableSpec,
    load: Callable[[], pl.DataFrame],
) -> TableSurvey:
    survey = TableSurvey(spec=spec)
    try:
        df = load()
    except Exception as e:  # noqa: BLE001 - any loader failure is data for the report
        survey.error = describe_error(e)
        return survey
    if df.height == 0:
        survey.error = EMPTY_RESULT
        return survey
    if "season" not in df.columns:
        survey.total = season_stats(df)
        return survey
    for (season,), part in df.partition_by("season", as_dict=True, maintain_order=False).items():
        if season is None:
            survey.null_season_rows = part.height
            continue
        survey.per_season[int(season)] = season_stats(part)
    survey.requested = sorted(survey.per_season)
    return survey
