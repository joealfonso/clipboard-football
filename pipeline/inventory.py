"""Survey every nflverse table the brief names and write docs/DATA.md.

Run from the repo root:  uv run --project pipeline python -m pipeline.inventory
"""

import os
import resource
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import polars as pl

from pipeline import cache
from pipeline.render import render
from pipeline.stats import KickoffSummary, key_coverage, kickoff_summary, play_keys
from pipeline.survey import TableSurvey, describe_error, survey_per_season, survey_whole
from pipeline.tables import TABLES, TableSpec

DATA_MD = Path(__file__).resolve().parent.parent / "docs" / "DATA.md"

# Charting tables and the columns that join them to pbp's (game_id, play_id).
CHARTING_KEYS: dict[str, tuple[str, str]] = {
    "participation": ("nflverse_game_id", "play_id"),
    "ftn_charting": ("nflverse_game_id", "nflverse_play_id"),
}
FIRST_CHARTING_SEASON = 2016


class Source(Protocol):
    version: str

    def seasons(self, spec: TableSpec) -> list[int]: ...
    def volatile_seasons(self, spec: TableSpec) -> list[int]: ...
    def has_loader(self, spec: TableSpec) -> bool: ...
    def load_season(self, spec: TableSpec, season: int) -> pl.DataFrame: ...
    def load_whole(self, spec: TableSpec) -> pl.DataFrame: ...


@dataclass(frozen=True)
class Coverage:
    rows: int
    pbp_plays: int | None
    key_coverage: float | None
    note: str = ""


@dataclass
class Report:
    nflreadpy_version: str
    surveys: list[TableSurvey] = field(default_factory=list)
    kickoffs: dict[int, KickoffSummary] = field(default_factory=dict)
    pbp_games: dict[int, int] = field(default_factory=dict)
    coverage: dict[str, dict[int, Coverage]] = field(default_factory=dict)
    # Per-season tables: seasons cached with a short expiry. Whole tables are always short.
    volatile: dict[str, list[int]] = field(default_factory=dict)
    # Per-season errors from the extra pbp and charting calculations, keyed by label.
    extra_errors: dict[str, dict[int, str]] = field(default_factory=dict)


def _progress(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def build_report(source: Source) -> Report:
    report = Report(nflreadpy_version=source.version)
    keys_by_season: dict[int, pl.DataFrame] = {}

    def record_error(label: str, season: int, e: Exception) -> None:
        report.extra_errors.setdefault(label, {})[season] = describe_error(e)

    def on_pbp(season: int, df: pl.DataFrame) -> None:
        report.pbp_games[season] = df["game_id"].n_unique() if "game_id" in df.columns else 0
        try:
            report.kickoffs[season] = kickoff_summary(df)
        except Exception as e:  # noqa: BLE001 - a missing column is reported, not fatal
            record_error("kickoff", season, e)
        if season >= FIRST_CHARTING_SEASON:
            try:
                keys_by_season[season] = play_keys(df)
            except Exception as e:  # noqa: BLE001
                record_error("pbp play keys", season, e)

    def on_charting(key: str):
        game_col, play_col = CHARTING_KEYS[key]

        def handle(season: int, df: pl.DataFrame) -> None:
            plays = keys_by_season.get(season)
            if plays is None:
                cov = Coverage(df.height, None, None, "no pbp for this season")
            elif game_col not in df.columns or play_col not in df.columns:
                cov = Coverage(df.height, plays.height, None, f"no {game_col}/{play_col}")
            else:
                try:
                    matched = key_coverage(plays, df, game_col, play_col)
                except Exception as e:  # noqa: BLE001 - bad keys are reported, not fatal
                    record_error(f"{key} coverage", season, e)
                    matched, note = None, "key join failed, see errors below"
                else:
                    note = ""
                cov = Coverage(df.height, plays.height, matched, note)
            report.coverage.setdefault(key, {})[season] = cov

        return handle

    for spec in TABLES:
        _progress(f"[inventory] {spec.key}")
        if spec.mode == "none" or not source.has_loader(spec):
            survey = TableSurvey(spec=spec)
            survey.error = f"no loader in nflreadpy {source.version}"
            report.surveys.append(survey)
            continue
        if spec.mode == "whole":
            report.surveys.append(survey_whole(spec, lambda spec=spec: source.load_whole(spec)))
            continue

        on_frame = None
        if spec.key == "pbp":
            on_frame = on_pbp
        elif spec.key in CHARTING_KEYS:
            on_frame = on_charting(spec.key)

        def load(season: int, spec: TableSpec = spec):
            _progress(f"[inventory] {spec.key} {season}")
            return source.load_season(spec, season)

        try:
            seasons = source.seasons(spec)
            report.volatile[spec.key] = source.volatile_seasons(spec)
        except Exception as e:  # noqa: BLE001
            survey = TableSurvey(spec=spec)
            survey.error = describe_error(e)
            report.surveys.append(survey)
            continue
        report.surveys.append(survey_per_season(spec, seasons, load, on_frame))
    return report


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".DATA.md.")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def run(out_path: Path, source: Source) -> int:
    """Exit code: 0 whenever DATA.md was written, even if some tables failed."""
    report = build_report(source)
    try:
        write_atomic(out_path, render(report))
    except OSError as e:
        print(f"Could not write {out_path}: {e}", file=sys.stderr)
        return 1
    return 0


def peak_memory_mb() -> float:
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # macOS reports bytes, Linux reports kilobytes.
    return peak / (1024 * 1024) if sys.platform == "darwin" else peak / 1024


def main() -> int:
    path = cache.cache_dir()
    try:
        cache.prepare(path)
    except cache.CacheNotWritable as e:
        print(str(e), file=sys.stderr)
        return 2

    from pipeline.sources import NflreadpySource

    code = run(DATA_MD, NflreadpySource(path))
    _progress(f"[inventory] wrote {DATA_MD} (cache {path})")
    _progress(f"[inventory] peak memory {peak_memory_mb():.0f} MB")
    return code


if __name__ == "__main__":
    sys.exit(main())
