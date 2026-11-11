import polars as pl
import pytest

from pipeline.stats import (
    SeasonStats,
    all_null_seasons,
    column_presence,
    dtype_seasons,
    key_coverage,
    kickoff_summary,
    match_candidate_columns,
    missing_between,
    null_rates,
    play_keys,
    season_stats,
)


class TestNullRates:
    def test_known_rates(self) -> None:
        df = pl.DataFrame(
            {
                "full": [1, 2, 3, 4],
                "half": [1, None, 3, None],
                "quarter": ["a", None, "c", "d"],
                "empty": pl.Series([None, None, None, None], dtype=pl.Float64),
            }
        )
        assert null_rates(df) == {"full": 0.0, "half": 50.0, "quarter": 25.0, "empty": 100.0}

    def test_empty_frame_is_defined(self) -> None:
        df = pl.DataFrame({"a": pl.Series([], dtype=pl.Int64), "b": pl.Series([], dtype=pl.String)})
        assert null_rates(df) == {"a": None, "b": None}

    def test_frame_without_columns(self) -> None:
        assert null_rates(pl.DataFrame()) == {}


class TestMissingBetween:
    def test_reports_gap(self) -> None:
        assert missing_between([1999, 2000, 2002]) == [2001]

    def test_order_and_duplicates_do_not_matter(self) -> None:
        assert missing_between([2002, 1999, 2000, 2000]) == [2001]

    def test_no_gap_and_empty(self) -> None:
        assert missing_between([2020, 2021]) == []
        assert missing_between([]) == []


class TestAcrossSeasons:
    per_season = {
        2020: season_stats(pl.DataFrame({"a": [1, 2], "b": [None, None]}, schema={"a": pl.Int64, "b": pl.Float64})),
        2021: season_stats(pl.DataFrame({"a": [1.0, None], "c": ["x", "y"]})),
    }

    def test_presence(self) -> None:
        assert column_presence(self.per_season) == {"a": [2020, 2021], "b": [2020], "c": [2021]}

    def test_all_null(self) -> None:
        assert all_null_seasons(self.per_season) == {"b": [2020]}

    def test_dtype_changes(self) -> None:
        assert dtype_seasons(self.per_season)["a"] == {"Int64": [2020], "Float64": [2021]}

    def test_zero_row_season_is_not_called_all_null(self) -> None:
        assert all_null_seasons({2020: SeasonStats(rows=0, columns={})}) == {}


def pbp_frame() -> pl.DataFrame:
    # One game, four kickoffs:
    #  play 10: touchback, receiving team A starts at its 25 (yardline_100 75)
    #  play 30: returned, receiving team B starts at its 40 (yardline_100 60)
    #  play 50: returned for a touchdown, next play is an extra point, so no start
    #  play 70: fair catch. nflverse still names the returner, so it must not count as a
    #           return. Receiving team A, next play no_play at its 30.
    rows = [
        # play_id, play_type, posteam, yardline_100, touchback, fair_catch, returner
        (10, "kickoff", "A", 35.0, 1.0, 0.0, None),
        (11, "run", "A", 75.0, 0.0, 0.0, None),
        (20, None, None, None, None, None, None),
        (30, "kickoff", "B", 35.0, 0.0, 0.0, "00-1"),
        (31, "pass", "B", 60.0, 0.0, 0.0, None),
        (50, "kickoff", "A", 35.0, 0.0, 0.0, "00-2"),
        (51, "extra_point", "A", 15.0, 0.0, 0.0, None),
        (70, "kickoff", "A", 35.0, 0.0, 1.0, "00-3"),
        (71, "no_play", "A", 70.0, 0.0, 0.0, None),
    ]
    return pl.DataFrame(
        {
            "game_id": ["2024_01_A_B"] * len(rows),
            "play_id": [float(r[0]) for r in rows],
            "play_type": [r[1] for r in rows],
            "posteam": [r[2] for r in rows],
            "yardline_100": [r[3] for r in rows],
            "touchback": [r[4] for r in rows],
            "kickoff_fair_catch": [r[5] for r in rows],
            "kickoff_returner_player_id": [r[6] for r in rows],
        }
    )


class TestKickoffSummary:
    def test_known_values(self) -> None:
        k = kickoff_summary(pbp_frame())
        assert k.kickoffs == 4
        assert k.touchback_rate == pytest.approx(25.0)
        assert k.fair_catch_rate == pytest.approx(25.0)
        assert k.return_rate == pytest.approx(50.0)
        assert k.start_sample == 3
        assert k.mean_start_yard_line == pytest.approx((25 + 40 + 30) / 3)

    def test_order_of_rows_does_not_matter(self) -> None:
        shuffled = pbp_frame().sample(fraction=1.0, shuffle=True, seed=3)
        assert kickoff_summary(shuffled) == kickoff_summary(pbp_frame())

    def test_onside_recovery_by_kicking_team_has_no_start(self) -> None:
        df = pl.DataFrame(
            {
                "game_id": ["g", "g"],
                "play_id": [1.0, 2.0],
                "play_type": ["kickoff", "run"],
                "posteam": ["B", "A"],
                "yardline_100": [35.0, 50.0],
                "touchback": [0.0, 0.0],
                "kickoff_returner_player_id": [None, None],
            }
        )
        k = kickoff_summary(df)
        assert (k.kickoffs, k.start_sample, k.mean_start_yard_line) == (1, 0, None)

    def test_no_kickoffs(self) -> None:
        k = kickoff_summary(pbp_frame().filter(pl.col("play_type") != "kickoff"))
        assert (k.kickoffs, k.touchback_rate, k.fair_catch_rate, k.return_rate) == (0, None, None, None)
        assert k.mean_start_yard_line is None

    def test_seasons_without_fair_catch_column(self) -> None:
        k = kickoff_summary(pbp_frame().drop("kickoff_fair_catch"))
        assert k.fair_catch_rate is None
        assert k.return_rate == pytest.approx(75.0)


class TestCandidateColumns:
    def test_matches_every_pattern_and_nothing_else(self) -> None:
        columns = [
            "defense_coverage_type",
            "defense_man_zone_type",
            "defenders_in_box",
            "n_blitzers",
            "number_of_pass_rushers",
            "was_pressure",
            "DEFENSIVE_FRONT",
            "n_defense_box",
            # should not match
            "yardline_100",
            "posteam",
            "defteam",
            "offense_formation",
            "defensive_two_point_attempt",
        ]
        assert match_candidate_columns(columns) == sorted(
            [
                "defense_coverage_type",
                "defense_man_zone_type",
                "defenders_in_box",
                "n_blitzers",
                "number_of_pass_rushers",
                "was_pressure",
                "DEFENSIVE_FRONT",
                "n_defense_box",
            ]
        )

    def test_custom_patterns(self) -> None:
        assert match_candidate_columns(["a_cov", "b"], ("cov",)) == ["a_cov"]


class TestKeyCoverage:
    def test_share_of_plays_with_a_row(self) -> None:
        plays = play_keys(pbp_frame())
        assert plays.height == 8  # every row with a play_type
        charting = pl.DataFrame({"gid": ["2024_01_A_B"] * 3, "pid": [10, 11, 999]})
        assert key_coverage(plays, charting, "gid", "pid") == pytest.approx(25.0)

    def test_no_plays(self) -> None:
        plays = play_keys(pbp_frame().head(0))
        assert key_coverage(plays, pl.DataFrame({"g": ["x"], "p": [1]}), "g", "p") is None
