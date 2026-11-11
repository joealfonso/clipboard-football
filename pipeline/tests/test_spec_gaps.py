"""Tests written from docs/specs/m1-step1-scaffold-and-data-survey.md for criteria and
edge cases the first round of tests did not pin down (C2, C3, C4, C11, C12, B4, and the
"Edge cases and reachable states" list). All offline: stub sources only."""

import re
import socket
from pathlib import Path

import polars as pl
import pytest
import requests

from pipeline import cache, inventory
from pipeline.inventory import run
from pipeline.survey import SeasonUnavailable
from pipeline.tables import TABLES
from pipeline.tests.stubs import PLAYER_ID, PLAYER_NAME, StubSource, pbp

REPO_ROOT = Path(__file__).resolve().parents[2]
# nflverse GSIS player IDs look like 00-0012345.
GSIS_ID = re.compile(r"\b\d{2}-\d{7}\b")


def render_to_text(tmp_path: Path, source: StubSource, name: str = "DATA.md") -> str:
    out = tmp_path / name
    assert run(out, source) == 0
    return out.read_text(encoding="utf-8")


def section(text: str, title: str) -> str:
    start = text.index(f". {title}\n", text.index("## Tables"))
    end = text.find("\n### ", start)
    return text[start : end if end != -1 else None]


def pbp_games(season: int, games: int) -> pl.DataFrame:
    frames = []
    for g in range(games):
        df = pbp(season).with_columns(pl.lit(f"{season}_01_{g:02d}").alias("game_id"))
        frames.append(df)
    return pl.concat(frames)


# C2: two runs against the same data give byte-identical DATA.md.


def test_full_run_twice_is_byte_identical(tmp_path: Path) -> None:
    first = (tmp_path / "a.md")
    second = (tmp_path / "b.md")
    assert run(first, StubSource()) == 0
    assert run(second, StubSource()) == 0
    assert first.read_bytes() == second.read_bytes()


def test_full_run_ignores_column_order_from_the_source(tmp_path: Path) -> None:
    def reversed_pbp(season: int) -> pl.DataFrame:
        df = pbp(season)
        return df.select(list(reversed(df.columns)))

    normal = render_to_text(tmp_path, StubSource(), "a.md")
    flipped = render_to_text(tmp_path, StubSource(per_season={"pbp": reversed_pbp}), "b.md")
    assert normal == flipped


def test_no_timestamps_in_output(tmp_path: Path) -> None:
    text = render_to_text(tmp_path, StubSource())
    assert not re.search(r"\d{4}-\d{2}-\d{2}", text)
    assert not re.search(r"\b\d{1,2}:\d{2}(:\d{2})?\b", text)


def test_tables_appear_in_fixed_order(tmp_path: Path) -> None:
    text = render_to_text(tmp_path, StubSource())
    tables_part = text[text.index("## Tables") :]
    positions = [tables_part.index(f". {spec.title}\n") for spec in TABLES]
    assert positions == sorted(positions)


# C11: the three answers, each with numbers and the column or query it used.


def test_kickoff_answer_covers_2018_to_latest_with_source_columns(tmp_path: Path) -> None:
    seasons = list(range(2016, 2026))
    source = StubSource(seasons={"pbp": seasons})
    text = render_to_text(tmp_path, source)
    answer = text[text.index("### 1. Kickoff format") : text.index("### 2. Holdout coverage")]
    for col in ("touchback", "kickoff_returner_player_id", "yardline_100", "play_type"):
        assert re.search(rf"\b{col}\b", answer), col
    for season in range(2018, 2026):
        assert re.search(rf"^\| {season} \| \d+ \|", answer, re.MULTILINE), season


def test_holdout_answer_names_both_tables_both_seasons_with_ratio(tmp_path: Path) -> None:
    text = render_to_text(tmp_path, StubSource())
    answer = text[text.index("### 2. Holdout coverage") : text.index("### 3. Defensive")]
    for table in ("Participation", "FTN charting"):
        for season in (2024, 2025):
            line = next(
                (ln for ln in answer.splitlines() if ln.startswith(f"- {table} {season}:")), None
            )
            assert line is not None, (table, season)
            assert re.search(r"\d+ rows", line), line
            assert "%" in line, line
    # Source columns for the join are named.
    assert "`play_type`" in answer
    assert "nflverse_game_id" in answer


def test_holdout_answer_reports_a_missing_season_instead_of_omitting_it(tmp_path: Path) -> None:
    def part(season: int) -> pl.DataFrame:
        if season == 2025:
            raise SeasonUnavailable(season)
        from pipeline.tests.stubs import participation

        return participation(season)

    text = render_to_text(tmp_path, StubSource(per_season={"participation": part}))
    answer = text[text.index("### 2. Holdout coverage") : text.index("### 3. Defensive")]
    assert any(ln.startswith("- Participation 2025:") for ln in answer.splitlines())


def test_defensive_answer_lists_patterns_and_per_season_null_rates(tmp_path: Path) -> None:
    from pipeline.stats import CANDIDATE_PATTERNS

    text = render_to_text(tmp_path, StubSource())
    answer = text[text.index("### 3. Defensive") : text.index("## Tables")]
    for pattern in CANDIDATE_PATTERNS:
        assert f"`{pattern}`" in answer, pattern
    # defense_coverage_type is null in 1 of 2 participation rows each season.
    row = next(ln for ln in answer.splitlines() if ln.startswith("| `defense_coverage_type`"))
    assert row.count("50.00") == 3


# C12: no player names or IDs, wherever they come from.


def test_no_names_or_ids_from_any_table(tmp_path: Path) -> None:
    other_id = "00-0088888"
    other_name = "Quincy Linebacker"

    def roster(season: int) -> pl.DataFrame:
        return pl.DataFrame(
            {
                "season": [season],
                "gsis_id": [other_id],
                "first_name": ["Quincy"],
                "last_name": ["Linebacker"],
                "full_name": [other_name],
            }
        )

    source = StubSource(
        per_season={"rosters": roster, "depth_charts": roster},
        whole={
            "contracts": lambda: pl.DataFrame({"player": [other_name], "gsis_id": [other_id]}),
        },
    )
    text = render_to_text(tmp_path, source)
    for value in (PLAYER_NAME, PLAYER_ID, other_id, other_name, "Quincy", "Linebacker"):
        assert value not in text, value
    assert not GSIS_ID.search(text)


def test_committed_data_md_has_no_player_ids() -> None:
    data_md = REPO_ROOT / "docs" / "DATA.md"
    if not data_md.exists():
        pytest.skip("docs/DATA.md not generated yet")
    found = GSIS_ID.findall(data_md.read_text(encoding="utf-8"))
    assert found == []


# Edge cases from the spec.


def test_partial_latest_season_is_flagged(tmp_path: Path) -> None:
    def games(season: int) -> pl.DataFrame:
        return pbp_games(season, 2 if season == 2025 else 10)

    text = render_to_text(tmp_path, StubSource(per_season={"pbp": games}))
    snapshot = next(ln for ln in text.splitlines() if ln.startswith("Data snapshot:"))
    assert "2025" in snapshot
    assert "partial" in snapshot
    assert "2024" not in snapshot.split("partial", 1)[1]


def test_full_season_is_not_flagged_partial(tmp_path: Path) -> None:
    text = render_to_text(tmp_path, StubSource())
    snapshot = next(ln for ln in text.splitlines() if ln.startswith("Data snapshot:"))
    assert "partial" not in snapshot


def test_dtype_change_across_seasons_is_reported_with_seasons(tmp_path: Path) -> None:
    def drifting(season: int) -> pl.DataFrame:
        df = pbp(season)
        if season == 2025:
            df = df.with_columns(pl.col("play_id").cast(pl.Int64))
        return df

    text = render_to_text(tmp_path, StubSource(per_season={"pbp": drifting}))
    body = section(text, "Play-by-play")
    note = next(ln for ln in body.splitlines() if "`play_id`" in ln and "dtype" in ln)
    assert "Float64 in 2023-2024" in note
    assert "Int64 in 2025" in note


def test_season_missing_in_the_middle_is_reported(tmp_path: Path) -> None:
    def holey(season: int) -> pl.DataFrame:
        if season == 2024:
            raise SeasonUnavailable(season)
        return pbp(season)

    text = render_to_text(tmp_path, StubSource(per_season={"pbp": holey}))
    body = section(text, "Play-by-play")
    assert "missing between: 2024" in body


def test_cache_unwritable_writes_no_data_md(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    blocker = tmp_path / "file"
    blocker.write_text("x")
    out = tmp_path / "DATA.md"
    monkeypatch.setenv(cache.ENV_VAR, str(blocker / "cache"))
    monkeypatch.setattr(inventory, "DATA_MD", out)
    assert inventory.main() != 0
    assert not out.exists()


# C4: the env var decides where downloads go.


def test_main_hands_the_env_var_cache_dir_to_the_source(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    import pipeline.sources

    seen: list[Path] = []

    def fake_source(path: Path) -> StubSource:
        seen.append(path)
        return StubSource()

    cache_path = tmp_path / "cache"
    out = tmp_path / "docs" / "DATA.md"
    monkeypatch.setenv(cache.ENV_VAR, str(cache_path))
    monkeypatch.setattr(pipeline.sources, "NflreadpySource", fake_source)
    monkeypatch.setattr(inventory, "DATA_MD", out)
    assert inventory.main() == 0
    assert seen == [cache_path]
    assert out.exists()


@pytest.fixture
def restore_nflreadpy_config():
    from nflreadpy.config import reset_config

    yield
    reset_config()


def test_nflreadpy_writes_to_disk_under_the_given_cache_dir(
    tmp_path: Path, restore_nflreadpy_config: None
) -> None:
    from nflreadpy.config import CacheMode, get_config

    cache.configure_nflreadpy(tmp_path)
    cfg = get_config()
    assert cfg.cache_mode == CacheMode.FILESYSTEM
    assert Path(cfg.cache_dir).resolve().is_relative_to(tmp_path.resolve())
    assert not Path(cfg.cache_dir).resolve().is_relative_to(REPO_ROOT)
    # C3: a warm cache must still be used on a later offline run, so it must not expire
    # within any realistic gap between runs.
    assert cfg.cache_duration >= 365 * 24 * 3600


def test_day_old_volatile_file_survives_an_offline_load(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, restore_nflreadpy_config: None
) -> None:
    # C3 for files the pipeline does refresh: a volatile file older than the refresh
    # window, with the network down, must still load and must not be deleted. The check
    # above only covers nflreadpy's setting, not what happens on a refresh attempt.
    import nflreadpy
    from nflreadpy.config import get_config

    from pipeline.sources import NflreadpySource
    from pipeline.tests.fake_network import FakeNetwork, age_everything

    pbp_spec = next(t for t in TABLES if t.key == "pbp")
    season = nflreadpy.get_current_season()
    net = FakeNetwork(monkeypatch)
    NflreadpySource(tmp_path).load_season(pbp_spec, season)
    files = sorted((tmp_path / "nflreadpy").iterdir())
    assert len(files) == 1

    age_everything(tmp_path, 2 * 24 * 3600)
    net.online = False
    df = NflreadpySource(tmp_path).load_season(pbp_spec, season)

    assert df.height > 0
    assert sorted((tmp_path / "nflreadpy").iterdir()) == files
    assert files[0].exists()
    assert get_config().cache_duration >= 365 * 24 * 3600


# C3: a season known to be unpublished is answered from the cache, not the network.


class FakeNfl:
    def __init__(self, error: BaseException | None = None) -> None:
        self.calls: list[int] = []
        self.error = error

    def get_current_season(self, roster: bool = False) -> int:
        return 2026

    def load_ftn_charting(self, season: int) -> pl.DataFrame:
        self.calls.append(season)
        if self.error is not None:
            raise self.error
        return pl.DataFrame({"x": [1]})


def http_error(status: int) -> ConnectionError:
    response = requests.Response()
    response.status_code = status
    try:
        raise requests.HTTPError(response=response)
    except requests.HTTPError as cause:
        try:
            raise ConnectionError("Failed to download") from cause
        except ConnectionError as e:
            return e


def make_source(tmp_path: Path, fake: FakeNfl):
    from pipeline.sources import NflreadpySource

    src = NflreadpySource(tmp_path)
    src._nfl = fake  # type: ignore[assignment]
    return src


FTN = next(t for t in TABLES if t.key == "ftn_charting")


def test_404_is_remembered_and_rerun_skips_the_loader(
    tmp_path: Path, restore_nflreadpy_config: None
) -> None:
    # A completed season. The in-progress season (2026 here) is deliberately not
    # remembered, since it may be published later; see test_sources.py.
    first = FakeNfl(error=http_error(404))
    with pytest.raises(SeasonUnavailable):
        make_source(tmp_path, first).load_season(FTN, 2023)
    assert first.calls == [2023]

    second = FakeNfl()
    with pytest.raises(SeasonUnavailable):
        make_source(tmp_path, second).load_season(FTN, 2023)
    assert second.calls == []


def test_other_download_errors_are_not_remembered(
    tmp_path: Path, restore_nflreadpy_config: None
) -> None:
    first = FakeNfl(error=http_error(503))
    with pytest.raises(ConnectionError):
        make_source(tmp_path, first).load_season(FTN, 2025)

    second = FakeNfl()
    df = make_source(tmp_path, second).load_season(FTN, 2025)
    assert second.calls == [2025]
    assert df.height == 1


# B4: the guard that keeps pipeline tests offline actually blocks connections.


def test_network_is_blocked_in_tests() -> None:
    with pytest.raises(RuntimeError, match="network access is blocked"):
        socket.create_connection(("example.com", 80), timeout=1)
    s = socket.socket()
    try:
        with pytest.raises(RuntimeError, match="network access is blocked"):
            s.connect(("93.184.215.14", 80))
    finally:
        s.close()
