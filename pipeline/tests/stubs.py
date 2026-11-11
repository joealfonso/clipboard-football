"""A fake nflreadpy source for running the whole inventory offline."""

from collections.abc import Callable

import polars as pl

from pipeline.survey import SeasonUnavailable
from pipeline.tables import TableSpec

PLAYER_NAME = "Zebulon Quarterback"
PLAYER_ID = "00-0099999"


def pbp(season: int) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "game_id": [f"{season}_01_A_B"] * 4,
            "play_id": [1.0, 2.0, 3.0, 4.0],
            "season": [season] * 4,
            "play_type": ["kickoff", "run", "pass", None],
            "posteam": ["A", "A", "A", None],
            "yardline_100": [35.0, 75.0, 70.0, None],
            "touchback": [1.0, 0.0, 0.0, None],
            "kickoff_returner_player_id": [None, None, None, None],
            "passer_player_name": [None, None, PLAYER_NAME, None],
            "passer_player_id": [None, None, PLAYER_ID, None],
        }
    )


def participation(season: int) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "nflverse_game_id": [f"{season}_01_A_B"] * 2,
            "play_id": [1, 2],
            "defense_coverage_type": ["COVER_3", None],
            "offense_names": [PLAYER_NAME, PLAYER_NAME],
        }
    )


def ftn(season: int) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "nflverse_game_id": [f"{season}_01_A_B"],
            "nflverse_play_id": [3],
            "n_blitzers": [2],
        }
    )


def simple(season: int) -> pl.DataFrame:
    return pl.DataFrame({"season": [season], "team": ["A"], "full_name": [PLAYER_NAME]})


class StubSource:
    version = "9.9.9"

    def __init__(
        self,
        per_season: dict[str, Callable[[int], pl.DataFrame]] | None = None,
        whole: dict[str, Callable[[], pl.DataFrame]] | None = None,
        seasons: dict[str, list[int]] | None = None,
    ) -> None:
        self.per_season = {
            "pbp": pbp,
            "rosters": simple,
            "player_stats": simple,
            "depth_charts": simple,
            "injuries": simple,
            "participation": participation,
            "ftn_charting": ftn,
        } | (per_season or {})
        self.whole = {
            "schedules": lambda: pl.DataFrame({"season": [2024, 2025], "game_id": ["a", "b"]}),
            "draft_picks": lambda: pl.DataFrame({"season": [2024], "pfr_player_name": [PLAYER_NAME]}),
            "contracts": lambda: pl.DataFrame({"player": [PLAYER_NAME], "value": [1.0]}),
        } | (whole or {})
        self.season_lists = {
            "pbp": [2023, 2024, 2025],
            "participation": [2023, 2024, 2025],
            "ftn_charting": [2023, 2024, 2025],
        } | (seasons or {})

    def seasons(self, spec: TableSpec) -> list[int]:
        return self.season_lists.get(spec.key, [2024, 2025])

    def volatile_seasons(self, spec: TableSpec) -> list[int]:
        return [max(self.seasons(spec))]

    def has_loader(self, spec: TableSpec) -> bool:
        return spec.key in self.per_season or spec.key in self.whole

    def load_season(self, spec: TableSpec, season: int) -> pl.DataFrame:
        return self.per_season[spec.key](season)

    def load_whole(self, spec: TableSpec) -> pl.DataFrame:
        return self.whole[spec.key]()


def unavailable(season: int) -> pl.DataFrame:
    raise SeasonUnavailable(season)
