"""Pure helpers that turn polars frames into small aggregates. No network, no files."""

from dataclasses import dataclass, field

import polars as pl

# Name fragments that suggest a column describes defensive coverage, the defensive
# call, or the front. Matching is case-insensitive substring. Every match is reported;
# nothing is filtered by hand. Expect this list to change once real names are known.
CANDIDATE_PATTERNS: tuple[str, ...] = (
    "coverage",
    "man_zone",
    "defense_",
    "defenders",
    "blitz",
    "box",
    "rush",
    "pressure",
    "front",
)

# Plays that follow a kickoff and show where the receiving team started. Extra points,
# two-point tries and kickoffs are excluded because they follow a return touchdown or
# a score, not a normal start.
START_PLAY_TYPES: tuple[str, ...] = (
    "run",
    "pass",
    "punt",
    "field_goal",
    "qb_kneel",
    "qb_spike",
    "no_play",
)


@dataclass(frozen=True)
class ColumnSeason:
    dtype: str
    nulls: int


@dataclass(frozen=True)
class SeasonStats:
    rows: int
    columns: dict[str, ColumnSeason] = field(default_factory=dict)


@dataclass(frozen=True)
class KickoffSummary:
    kickoffs: int
    touchback_rate: float | None
    fair_catch_rate: float | None
    return_rate: float | None
    mean_start_yard_line: float | None
    start_sample: int


def null_rate(nulls: int, rows: int) -> float | None:
    """Percent of rows that are null. None for zero rows, where a rate means nothing."""
    if rows == 0:
        return None
    return 100.0 * nulls / rows


def null_rates(df: pl.DataFrame) -> dict[str, float | None]:
    counts = df.null_count().row(0, named=True) if df.width else {}
    return {name: null_rate(counts[name], df.height) for name in df.columns}


def season_stats(df: pl.DataFrame) -> SeasonStats:
    counts = df.null_count().row(0, named=True) if df.width else {}
    return SeasonStats(
        rows=df.height,
        columns={
            name: ColumnSeason(dtype=str(dtype), nulls=counts[name])
            for name, dtype in df.schema.items()
        },
    )


def missing_between(seasons: list[int]) -> list[int]:
    """Seasons absent between the first and last season present."""
    if not seasons:
        return []
    present = set(seasons)
    return [s for s in range(min(present), max(present) + 1) if s not in present]


def column_presence(per_season: dict[int, SeasonStats]) -> dict[str, list[int]]:
    """For each column, the seasons whose frame has it."""
    presence: dict[str, list[int]] = {}
    for season in sorted(per_season):
        for name in per_season[season].columns:
            presence.setdefault(name, []).append(season)
    return presence


def all_null_seasons(per_season: dict[int, SeasonStats]) -> dict[str, list[int]]:
    """For each column, the seasons where it is present, has rows, and every row is null."""
    result: dict[str, list[int]] = {}
    for season in sorted(per_season):
        stats = per_season[season]
        if stats.rows == 0:
            continue
        for name, col in stats.columns.items():
            if col.nulls == stats.rows:
                result.setdefault(name, []).append(season)
    return result


def dtype_seasons(per_season: dict[int, SeasonStats]) -> dict[str, dict[str, list[int]]]:
    """For each column, each dtype seen and the seasons it was seen in."""
    result: dict[str, dict[str, list[int]]] = {}
    for season in sorted(per_season):
        for name, col in per_season[season].columns.items():
            result.setdefault(name, {}).setdefault(col.dtype, []).append(season)
    return result


def match_candidate_columns(
    columns: list[str], patterns: tuple[str, ...] = CANDIDATE_PATTERNS
) -> list[str]:
    lowered = [p.lower() for p in patterns]
    return sorted(c for c in columns if any(p in c.lower() for p in lowered))


def kickoff_summary(pbp: pl.DataFrame) -> KickoffSummary:
    """Kickoff outcomes for one season of play-by-play.

    Kickoffs are rows with play_type == "kickoff". Touchback uses the `touchback` flag.
    A fair catch uses `kickoff_fair_catch`. A return is a kickoff with a named returner
    (`kickoff_returner_player_id` not null) that is neither a touchback nor a fair catch:
    nflverse names the returner on fair catches too. Start yard line is the receiving team's own yard line on
    the next play in the same game (by play_id) that has a play_type, measured as
    100 - yardline_100, kept only when that next play is a scrimmage-type play by the
    team that received (pbp sets posteam on a kickoff to the receiving team).
    """
    plays = (
        pbp.filter(pl.col("play_type").is_not_null())
        .sort(["game_id", "play_id"])
        .with_columns(
            pl.col("play_type").shift(-1).over("game_id").alias("next_play_type"),
            pl.col("posteam").shift(-1).over("game_id").alias("next_posteam"),
            pl.col("yardline_100").shift(-1).over("game_id").alias("next_yardline_100"),
        )
    )
    kicks = plays.filter(pl.col("play_type") == "kickoff")
    n = kicks.height
    if n == 0:
        return KickoffSummary(0, None, None, None, None, 0)

    touchback = pl.col("touchback").fill_null(0) == 1
    # Without the column the fair-catch share is unknown, not zero.
    has_fair_catch = "kickoff_fair_catch" in kicks.columns
    fair_catch = (
        pl.col("kickoff_fair_catch").fill_null(0) == 1 if has_fair_catch else pl.lit(False)
    )
    touchbacks = kicks.filter(touchback).height
    fair_catches = kicks.filter(fair_catch).height if has_fair_catch else None
    returns = kicks.filter(
        pl.col("kickoff_returner_player_id").is_not_null() & ~touchback & ~fair_catch
    ).height
    starts = kicks.filter(
        pl.col("next_play_type").is_in(list(START_PLAY_TYPES))
        & (pl.col("next_posteam") == pl.col("posteam"))
        & pl.col("next_yardline_100").is_not_null()
    ).select((100 - pl.col("next_yardline_100")).alias("start"))
    mean_start = starts["start"].mean() if starts.height else None

    return KickoffSummary(
        kickoffs=n,
        touchback_rate=100.0 * touchbacks / n,
        fair_catch_rate=None if fair_catches is None else 100.0 * fair_catches / n,
        return_rate=100.0 * returns / n,
        mean_start_yard_line=float(mean_start) if mean_start is not None else None,
        start_sample=starts.height,
    )


def play_keys(pbp: pl.DataFrame) -> pl.DataFrame:
    """(game_id, play_id) for rows with a play_type, the plays a charting row could match."""
    return (
        pbp.filter(pl.col("play_type").is_not_null())
        .select(pl.col("game_id").cast(pl.String), pl.col("play_id").cast(pl.Int64))
        .unique()
    )


def key_coverage(
    plays: pl.DataFrame, other: pl.DataFrame, game_col: str, play_col: str
) -> float | None:
    """Percent of pbp plays that have at least one row in `other` with the same keys."""
    if plays.height == 0:
        return None
    keys = other.select(
        pl.col(game_col).cast(pl.String).alias("game_id"),
        pl.col(play_col).cast(pl.Int64).alias("play_id"),
    ).unique()
    matched = plays.join(keys, on=["game_id", "play_id"], how="semi").height
    return 100.0 * matched / plays.height
