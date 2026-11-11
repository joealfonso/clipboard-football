"""Where raw downloads live, and how nflreadpy is pointed at it."""

import os
import tempfile
import time
from pathlib import Path

import polars as pl

ENV_VAR = "CLIPBOARD_FOOTBALL_CACHE"
DEFAULT_DIR = Path("~/.cache/clipboard-football")

# nflreadpy deletes a cached file as soon as it is older than cache_duration, before it
# tries the network, so a failed refetch would lose good data. Its expiry is therefore
# always "never", and the pipeline does its own age check for volatile files (the
# in-progress season, each table's latest season, and whole-table files that include
# them): older than a day means try to refetch, and keep the old copy if that fails.
# Completed seasons are never refetched. To refresh everything, delete the cache dir.
NEVER_EXPIRE_SECONDS = 100 * 365 * 24 * 3600
VOLATILE_EXPIRE_SECONDS = 24 * 3600


def is_volatile(season: int | None, current_season: int, last_season: int) -> bool:
    """None means a whole-table file, which holds the current season's rows."""
    return season is None or season >= current_season or season >= last_season


def is_stale(path: Path, now: float | None = None) -> bool:
    age = (time.time() if now is None else now) - path.stat().st_mtime
    return age >= VOLATILE_EXPIRE_SECONDS


def write_parquet_atomic(df: pl.DataFrame, path: Path) -> None:
    """A crash mid-write must not leave a truncated file where a good one was."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    os.close(fd)
    try:
        df.write_parquet(tmp)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


class CacheNotWritable(Exception):
    pass


def cache_dir() -> Path:
    raw = os.environ.get(ENV_VAR)
    return Path(raw).expanduser() if raw else DEFAULT_DIR.expanduser()


def prepare(path: Path) -> None:
    """Create the cache directory and prove it is writable."""
    try:
        path.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path, prefix=".probe-"):
            pass
    except OSError as e:
        raise CacheNotWritable(
            f"Cache directory {path} is not writable ({e.strerror or e}). "
            f"Fix its permissions or set {ENV_VAR} to a writable directory."
        ) from e


def configure_nflreadpy(path: Path) -> None:
    from nflreadpy.config import CacheMode, update_config

    update_config(
        cache_mode=CacheMode.FILESYSTEM,
        cache_dir=path / "nflreadpy",
        cache_duration=NEVER_EXPIRE_SECONDS,
        verbose=False,
    )


def _unavailable_marker(path: Path, table: str, season: int) -> Path:
    return path / "unavailable" / f"{table}_{season}"


def is_marked_unavailable(path: Path, table: str, season: int) -> bool:
    return _unavailable_marker(path, table, season).exists()


VOLATILE_MARKER = "volatile"


def mark_unavailable(path: Path, table: str, season: int, volatile: bool) -> None:
    """Remember a 404 so a later offline run reports the same thing without the network.

    A marker written while the season was volatile says so, and stays rechecked after
    the season completes, until a successful load clears it. Rewriting refreshes its age.
    """
    marker = _unavailable_marker(path, table, season)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(VOLATILE_MARKER if volatile else "", encoding="utf-8")


def marker_is_volatile(path: Path, table: str, season: int) -> bool:
    marker = _unavailable_marker(path, table, season)
    return marker.exists() and marker.read_text(encoding="utf-8") == VOLATILE_MARKER


def unavailable_marker_is_stale(path: Path, table: str, season: int) -> bool:
    return is_stale(_unavailable_marker(path, table, season))


def clear_unavailable(path: Path, table: str, season: int) -> None:
    """A volatile season that was missing has now been published."""
    _unavailable_marker(path, table, season).unlink(missing_ok=True)
