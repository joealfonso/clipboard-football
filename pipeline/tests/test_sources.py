"""Cache rules in NflreadpySource, run through nflreadpy's real downloader and cache."""

from pathlib import Path

import nflreadpy
import pytest
from nflreadpy.cache import get_cache_manager
from nflreadpy.config import DataFormat, get_config, reset_config
from nflreadpy.downloader import get_downloader

from pipeline import cache
from pipeline.inventory import run
from pipeline.sources import NflreadpySource
from pipeline.survey import SeasonUnavailable
from pipeline.tables import TABLES
from pipeline.tests.fake_network import FakeNetwork, age_everything

PBP = next(t for t in TABLES if t.key == "pbp")
FTN = next(t for t in TABLES if t.key == "ftn_charting")
SCHEDULES = next(t for t in TABLES if t.key == "schedules")
CURRENT = nflreadpy.get_current_season()
COMPLETED = 2020
TWO_DAYS = 2 * 24 * 3600


@pytest.fixture(autouse=True)
def restore_config():
    yield
    reset_config()


def pbp_file(season: int) -> Path:
    url = get_downloader()._build_url("nflverse-data", f"pbp/play_by_play_{season}", DataFormat.PARQUET)
    mgr = get_cache_manager()
    return mgr._get_file_path(mgr._get_cache_key(url, season=season))


@pytest.mark.parametrize(
    ("season", "current", "last", "volatile"),
    [
        (2024, 2026, 2026, False),
        (2026, 2026, 2026, True),
        (2025, 2026, 2025, True),  # latest season of a table capped below current
        (None, 2026, 2026, True),
    ],
)
def test_is_volatile(season: int | None, current: int, last: int, volatile: bool) -> None:
    assert cache.is_volatile(season, current, last) is volatile


def test_volatile_seasons_are_current_and_latest(tmp_path: Path) -> None:
    assert NflreadpySource(tmp_path).volatile_seasons(PBP) == [CURRENT]


def test_fresh_volatile_file_is_read_from_cache(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    net = FakeNetwork(monkeypatch)
    src = NflreadpySource(tmp_path)
    src.load_season(PBP, CURRENT)
    net.online = False
    assert src.load_season(PBP, CURRENT)["version"][0] == 1
    assert len(net.requests) == 1


def test_stale_volatile_file_is_refetched_when_online(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    net = FakeNetwork(monkeypatch)
    src = NflreadpySource(tmp_path)
    src.load_season(PBP, CURRENT)
    age_everything(tmp_path, TWO_DAYS)
    net.payload_version = 2
    assert src.load_season(PBP, CURRENT)["version"][0] == 2
    assert not cache.is_stale(pbp_file(CURRENT))


def test_stale_volatile_file_survives_a_failed_refetch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    net = FakeNetwork(monkeypatch)
    src = NflreadpySource(tmp_path)
    src.load_season(PBP, CURRENT)
    age_everything(tmp_path, TWO_DAYS)
    net.online = False
    df = src.load_season(PBP, CURRENT)
    assert df["version"][0] == 1
    assert pbp_file(CURRENT).exists()
    assert len(net.requests) == 2  # it did try the network
    assert "using the stale cached copy" in capsys.readouterr().err
    assert get_config().cache_duration == cache.NEVER_EXPIRE_SECONDS


def test_stale_whole_table_survives_a_failed_refetch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    net = FakeNetwork(monkeypatch)
    src = NflreadpySource(tmp_path)
    src.load_whole(SCHEDULES)
    age_everything(tmp_path, TWO_DAYS)
    net.online = False
    assert src.load_whole(SCHEDULES).height > 0


def test_completed_season_is_never_refetched(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    net = FakeNetwork(monkeypatch)
    src = NflreadpySource(tmp_path)
    src.load_season(PBP, COMPLETED)
    age_everything(tmp_path, 400 * 24 * 3600)
    net.online = False
    assert src.load_season(PBP, COMPLETED).height > 0
    assert len(net.requests) == 1


def test_404_on_a_completed_season_is_remembered(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    net = FakeNetwork(monkeypatch, not_found={f"play_by_play_{COMPLETED}"})
    src = NflreadpySource(tmp_path)
    with pytest.raises(SeasonUnavailable):
        src.load_season(PBP, COMPLETED)
    age_everything(tmp_path, TWO_DAYS)
    with pytest.raises(SeasonUnavailable):
        src.load_season(PBP, COMPLETED)
    assert len(net.requests) == 1


def test_volatile_404_is_rechecked_after_a_day_and_kept_when_offline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    net = FakeNetwork(monkeypatch, not_found={f"ftn_charting_{CURRENT}"})
    src = NflreadpySource(tmp_path)
    with pytest.raises(SeasonUnavailable):
        src.load_season(FTN, CURRENT)
    # Fresh marker: no recheck.
    with pytest.raises(SeasonUnavailable):
        src.load_season(FTN, CURRENT)
    assert len(net.requests) == 1
    # Stale marker and no network: still reported as unpublished, not failed.
    age_everything(tmp_path, TWO_DAYS)
    net.online = False
    with pytest.raises(SeasonUnavailable):
        src.load_season(FTN, CURRENT)
    assert len(net.requests) == 2


def test_volatile_season_published_later_clears_its_marker(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    net = FakeNetwork(monkeypatch, not_found={f"ftn_charting_{CURRENT}"})
    src = NflreadpySource(tmp_path)
    with pytest.raises(SeasonUnavailable):
        src.load_season(FTN, CURRENT)
    age_everything(tmp_path, TWO_DAYS)
    net.not_found = set()
    assert src.load_season(FTN, CURRENT).height > 0
    assert not cache.is_marked_unavailable(tmp_path, "ftn_charting", CURRENT)


def test_fetches_are_logged_but_cache_reads_are_not(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    FakeNetwork(monkeypatch)
    src = NflreadpySource(tmp_path)
    src.load_season(PBP, COMPLETED)
    src.load_season(PBP, COMPLETED)
    assert src.fetched == [f"pbp {COMPLETED}"]


def test_cache_writes_leave_no_temp_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    FakeNetwork(monkeypatch)
    NflreadpySource(tmp_path).load_season(PBP, COMPLETED)
    names = [p.name for p in (tmp_path / "nflreadpy").iterdir()]
    assert names == [pbp_file(COMPLETED).name]


def test_offline_rerun_with_a_day_old_cache_matches_the_online_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """C2 and C3 together: online, then offline with every file aged past a day.

    Includes a volatile season that 404s (FTN, current season) and a completed one
    (injuries 2010).
    """
    net = FakeNetwork(
        monkeypatch, not_found={f"ftn_charting_{CURRENT}", "injuries_2010"}
    )
    cache_dir = tmp_path / "cache"
    online, offline = tmp_path / "online.md", tmp_path / "offline.md"

    assert run(online, NflreadpySource(cache_dir)) == 0
    files_after_online = sorted(p.name for p in (cache_dir / "nflreadpy").iterdir())

    age_everything(cache_dir, TWO_DAYS)
    net.online = False
    assert run(offline, NflreadpySource(cache_dir)) == 0

    assert offline.read_bytes() == online.read_bytes()
    assert sorted(p.name for p in (cache_dir / "nflreadpy").iterdir()) == files_after_online
    text = online.read_text(encoding="utf-8")
    assert f"Seasons requested with no file published (HTTP 404): {CURRENT}." in text
    assert "Seasons requested with no file published (HTTP 404): 2010." in text
    assert "failed" not in text.split("## Contents")[1].split("## Answers")[0].replace(
        "Draft pick values (failed)", ""
    )


def stale_current_pbp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[NflreadpySource, FakeNetwork]:
    net = FakeNetwork(monkeypatch)
    src = NflreadpySource(tmp_path)
    src.load_season(PBP, CURRENT)
    age_everything(tmp_path, TWO_DAYS)
    return src, net


@pytest.mark.parametrize("status", [500, 503])
def test_server_error_on_refetch_serves_the_stale_copy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    src, net = stale_current_pbp(tmp_path, monkeypatch)
    net.status = status
    assert src.load_season(PBP, CURRENT)["version"][0] == 1


def test_bad_download_is_a_failure_not_a_stale_fallback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    src, net = stale_current_pbp(tmp_path, monkeypatch)
    net.corrupt = True
    with pytest.raises(ValueError, match="Failed to parse"):
        src.load_season(PBP, CURRENT)


def test_client_error_other_than_404_is_a_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    src, net = stale_current_pbp(tmp_path, monkeypatch)
    net.status = 403
    with pytest.raises(ConnectionError):
        src.load_season(PBP, CURRENT)


def test_cache_write_failure_is_logged_and_the_load_succeeds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    FakeNetwork(monkeypatch)

    def full_disk(df: object, path: Path) -> None:
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(cache, "write_parquet_atomic", full_disk)
    df = NflreadpySource(tmp_path).load_season(PBP, COMPLETED)
    assert df.height > 0
    assert "could not write cache file" in capsys.readouterr().err


def test_volatile_404_is_still_rechecked_after_the_season_completes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    net = FakeNetwork(monkeypatch, not_found={f"play_by_play_{CURRENT}"})
    src = NflreadpySource(tmp_path)
    with pytest.raises(SeasonUnavailable):
        src.load_season(PBP, CURRENT)
    assert cache.marker_is_volatile(tmp_path, "pbp", CURRENT)

    # The calendar rolls over: CURRENT is now a completed season.
    monkeypatch.setattr(nflreadpy, "get_current_season", lambda roster=False: CURRENT + 1)
    assert not cache.is_volatile(CURRENT, CURRENT + 1, CURRENT + 1)

    # Fresh marker: no recheck yet.
    with pytest.raises(SeasonUnavailable):
        src.load_season(PBP, CURRENT)
    assert len(net.requests) == 1

    # A day later it is rechecked; still 404 keeps it volatile-written.
    age_everything(tmp_path, TWO_DAYS)
    with pytest.raises(SeasonUnavailable):
        src.load_season(PBP, CURRENT)
    assert len(net.requests) == 2
    assert cache.marker_is_volatile(tmp_path, "pbp", CURRENT)

    # Published since: the next recheck loads it and clears the marker.
    age_everything(tmp_path, TWO_DAYS)
    net.not_found = set()
    assert src.load_season(PBP, CURRENT).height > 0
    assert not cache.is_marked_unavailable(tmp_path, "pbp", CURRENT)


def test_failed_recheck_with_a_bad_download_is_reported_as_failed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    net = FakeNetwork(monkeypatch, not_found={f"ftn_charting_{CURRENT}"})
    src = NflreadpySource(tmp_path)
    with pytest.raises(SeasonUnavailable):
        src.load_season(FTN, CURRENT)
    age_everything(tmp_path, TWO_DAYS)
    net.not_found = set()
    net.corrupt = True
    with pytest.raises(ValueError):
        src.load_season(FTN, CURRENT)
