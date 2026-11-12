"""The tables the brief names, in the order DATA.md reports them."""

from dataclasses import dataclass
from typing import Literal

# How a table is fetched:
#   per_season: one nflreadpy call per season, so pbp memory stays bounded by one season.
#   whole: one call returns every season (or the table has no seasons).
#   none: nflreadpy has no loader.
Mode = Literal["per_season", "whole", "none"]

# Which nflreadpy calendar sets the last season to ask for:
#   season: get_current_season() (flips the Thursday after Labor Day)
#   roster: get_current_season(roster=True) (flips on March 15)
#   roster_prev: one before the roster year, nflreadpy's own cap for participation
LastSeason = Literal["season", "roster", "roster_prev"]


@dataclass(frozen=True)
class TableSpec:
    key: str
    title: str
    mode: Mode
    loader: str = ""
    first_season: int = 0
    last_season: LastSeason = "season"
    # Per-season null rates in DATA.md. Only where the holdout and coverage questions
    # need them (spec open question 4 default); every other table gets overall rates.
    detail: bool = False
    note: str = ""


TABLES: tuple[TableSpec, ...] = (
    TableSpec("pbp", "Play-by-play", "per_season", "load_pbp", 1999, "season", detail=True),
    TableSpec("schedules", "Schedules", "whole", "load_schedules"),
    TableSpec("rosters", "Rosters", "per_season", "load_rosters", 1920, "roster"),
    TableSpec(
        "player_stats",
        "Player stats (weekly)",
        "per_season",
        "load_player_stats",
        1999,
        "season",
    ),
    TableSpec("depth_charts", "Depth charts", "per_season", "load_depth_charts", 2001, "roster"),
    TableSpec("injuries", "Injuries", "per_season", "load_injuries", 2009, "season"),
    TableSpec("draft_picks", "Draft picks", "whole", "load_draft_picks"),
    TableSpec(
        "draft_pick_values",
        "Draft pick values",
        "none",
        note=(
            "Not in the nflverse-data releases either. A candidate source outside nflreadpy "
            "is data/draft_values.csv in the nflverse/nfldata GitHub repo; this tool does "
            "not read it."
        ),
    ),
    TableSpec("contracts", "Contracts", "whole", "load_contracts"),
    TableSpec(
        "participation",
        "Participation",
        "per_season",
        "load_participation",
        2016,
        "roster_prev",
        detail=True,
    ),
    TableSpec(
        "ftn_charting",
        "FTN charting",
        "per_season",
        "load_ftn_charting",
        2022,
        "season",
        detail=True,
    ),
    TableSpec("combine", "Combine", "whole", "load_combine"),
)
