"""M2 G2: the challenge fit reads only 2016-2023 regular seasons and the kind from the review sentence."""

from pathlib import Path

import polars as pl
import pytest

from pipeline.challenges import build as ch

ROOT = Path(__file__).resolve().parents[2]


def frame(season: int, desc: str, result: str | None = "reversed", play_type: str = "pass", season_type: str = "REG") -> pl.DataFrame:
    return pl.DataFrame({
        "game_id": [f"{season}_01_A_B"], "play_id": [1.0], "season": [season], "season_type": [season_type], "posteam": ["A"], "defteam": ["B"],
        "play_type": [play_type], "desc": [desc], "replay_or_challenge": [1.0 if result else 0.0], "replay_or_challenge_result": [result],
        "complete_pass": [0.0], "interception": [0.0], "fumble_lost": [0.0], "touchdown": [0.0], "td_team": [None], "yards_gained": [0.0], "ydstogo": [10.0],
    })


def test_training_seasons_stop_before_the_holdout():
    seasons = ch.seasons_of(ROOT)
    assert seasons == list(range(2016, 2024))
    with pytest.raises(ValueError):
        ch.check_holdout([2023, 2024], 2024)


def test_holdout_and_postseason_rows_never_land():
    review = "QB pass short to WR for 9 yards. Bravo challenged the pass completion ruling, and the play was REVERSED. QB pass incomplete short to WR."
    for season in (2024, 2025, 2026):
        assert ch.season_rows(frame(season, review), 2024).height == 0
    assert ch.season_rows(frame(2023, review, season_type="POST"), 2024).height == 0
    assert ch.season_rows(frame(2023, review), 2024).height == 1


class OneSeason:
    def load_season(self, spec, season):
        return pl.concat([frame(2023, "x"), frame(2024, "QB pass short to WR. Bravo challenged the pass completion ruling, and the play was Upheld.", "upheld")])


def test_load_drops_a_holdout_row_a_source_returns():
    df = ch.load(OneSeason(), [2023], 2024, lambda m: None)
    assert df["season"].to_list() == [2023]


@pytest.mark.parametrize(
    ("desc", "play_type", "kind"),
    [
        ("QB pass short to WR for 9 yards. Bravo challenged the pass completion ruling, and the play was REVERSED. QB pass incomplete.", "pass", "completionToIncomplete"),
        ("RB right end for 4 yards. FUMBLES, RECOVERED by B-91 at A 30. The Replay Official reviewed the fumble ruling, and the play was REVERSED. RB right end for 4 yards.", "run", "fumbleToDown"),
        ("RB right end for 4 yards. FUMBLES, RECOVERED by A-70 at A 30. The Replay Official reviewed the fumble ruling, and the play was Upheld.", "run", None),
        ("QB pass INTERCEPTED by B-24. The Replay Official reviewed the interception ruling, and the play was REVERSED. QB pass incomplete.", "pass", "interceptionToIncomplete"),
        ("QB pass to WR for 20 yards, TOUCHDOWN. The Replay Official reviewed the runner broke the plane ruling, and the play was REVERSED. QB pass to WR to B 1.", "pass", "touchdownToShort"),
        ("QB pass to RB for 7 yards, TOUCHDOWN. The Replay Official reviewed the runner was not down by contact ruling, and the play was REVERSED. QB pass to RB to B 1.", "pass", "touchdownToShort"),
        ("QB pass to WR for 4 yards. Bravo challenged the first down ruling, and the play was REVERSED. QB pass to WR for 3 yards.", "pass", "spotLineToGain"),
        ("QB pass incomplete. Alpha challenged the incomplete pass ruling, and the play was Upheld.", "pass", None),
        ("K kicks. RET for 30 yards. FUMBLES, RECOVERED by B-33. The Replay Official reviewed the fumble ruling, and the play was REVERSED.", "kickoff", None),
    ],
)
def test_the_kind_comes_from_the_review_sentence(desc, play_type, kind):
    r = ch.season_rows(frame(2020, desc, play_type=play_type), 2024)
    assert r["kind"].to_list() == [kind]
