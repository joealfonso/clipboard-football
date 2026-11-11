from pathlib import Path

import pytest

from pipeline import cache


def test_env_var_overrides_default(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv(cache.ENV_VAR, str(tmp_path / "c"))
    assert cache.cache_dir() == tmp_path / "c"


def test_default_is_outside_the_repo(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(cache.ENV_VAR, raising=False)
    assert cache.cache_dir() == Path.home() / ".cache" / "clipboard-football"


def test_unwritable_dir_names_path_and_env_var(tmp_path: Path) -> None:
    blocker = tmp_path / "file"
    blocker.write_text("not a directory")
    with pytest.raises(cache.CacheNotWritable) as info:
        cache.prepare(blocker / "cache")
    assert str(blocker / "cache") in str(info.value)
    assert cache.ENV_VAR in str(info.value)


def test_unavailable_markers_round_trip(tmp_path: Path) -> None:
    assert not cache.is_marked_unavailable(tmp_path, "ftn_charting", 2026)
    cache.mark_unavailable(tmp_path, "ftn_charting", 2026, volatile=True)
    cache.mark_unavailable(tmp_path, "ftn_charting", 2023, volatile=False)
    assert cache.is_marked_unavailable(tmp_path, "ftn_charting", 2026)
    assert not cache.is_marked_unavailable(tmp_path, "ftn_charting", 2025)
    assert cache.marker_is_volatile(tmp_path, "ftn_charting", 2026)
    assert not cache.marker_is_volatile(tmp_path, "ftn_charting", 2023)


def test_main_exits_non_zero_when_cache_unwritable(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    from pipeline import inventory

    blocker = tmp_path / "file"
    blocker.write_text("x")
    monkeypatch.setenv(cache.ENV_VAR, str(blocker / "cache"))
    assert inventory.main() == 2
    assert cache.ENV_VAR in capsys.readouterr().err
