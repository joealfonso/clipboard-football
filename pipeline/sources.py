"""The one place that talks to nflreadpy and the network."""

import sys
from collections.abc import Callable
from importlib.metadata import version
from pathlib import Path
from typing import Any

import polars as pl
import requests

from pipeline import cache
from pipeline.survey import SeasonUnavailable
from pipeline.tables import TableSpec


def _is_not_found(e: BaseException) -> bool:
    # nflreadpy wraps requests errors as ConnectionError(...) from the HTTPError.
    cause = e.__cause__
    return (
        isinstance(cause, requests.HTTPError)
        and cause.response is not None
        and cause.response.status_code == 404
    )


def _is_network_error(e: BaseException) -> bool:
    """Worth falling back to a cached copy: no connection, a timeout, or a server error.

    nflreadpy wraps requests errors in a builtin ConnectionError and parse errors in a
    ValueError, so the cause tells them apart.
    """
    cause = e.__cause__ if e.__cause__ is not None else e
    if isinstance(cause, requests.HTTPError):
        return cause.response is not None and cause.response.status_code >= 500
    return isinstance(cause, (requests.RequestException, ConnectionError, TimeoutError))


def _log(message: str) -> None:
    print(f"[inventory] {message}", file=sys.stderr, flush=True)


class NflreadpySource:
    def __init__(self, cache_path: Path) -> None:
        cache.configure_nflreadpy(cache_path)
        import nflreadpy
        from nflreadpy.cache import get_cache_manager

        self._nfl = nflreadpy
        self._cache_manager = get_cache_manager()
        self._cache_path = cache_path
        self.version = version("nflreadpy")
        # "table season" labels, for the progress log only: whether a load hit the
        # network depends on timing, so it stays out of DATA.md.
        self.fetched: list[str] = []

    def last_season(self, spec: TableSpec) -> int:
        if spec.last_season == "season":
            return self._nfl.get_current_season()
        roster_year = self._nfl.get_current_season(roster=True)
        return roster_year - 1 if spec.last_season == "roster_prev" else roster_year

    def seasons(self, spec: TableSpec) -> list[int]:
        return list(range(spec.first_season, self.last_season(spec) + 1))

    def volatile_seasons(self, spec: TableSpec) -> list[int]:
        current = self._nfl.get_current_season()
        last = self.last_season(spec)
        return [s for s in self.seasons(spec) if cache.is_volatile(s, current, last)]

    def has_loader(self, spec: TableSpec) -> bool:
        return bool(spec.loader) and hasattr(self._nfl, spec.loader)

    def _cache_files(self) -> dict[str, float]:
        root = self._cache_path / "nflreadpy"
        if not root.exists():
            return {}
        return {p.name: p.stat().st_mtime for p in root.glob("*.parquet")}

    def _load(self, label: str, volatile: bool, call: Callable[[], pl.DataFrame]) -> pl.DataFrame:
        """Run one nflreadpy load with the pipeline's cache rules.

        nflreadpy's own expiry stays at never. For a volatile load, a cached file older
        than a day is hidden from nflreadpy so it downloads again; if that download fails
        with a network error (connection, timeout, HTTP 5xx), the old file (untouched)
        is served instead. Parse and schema errors still fail the load. Cache writes go
        through a temp file so a crash cannot truncate a good copy.
        """
        mgr = self._cache_manager
        original_get, original_set = mgr.get, mgr.set
        stale: list[Path] = []

        def cache_path_for(url: str, kwargs: dict[str, Any]) -> Path:
            return mgr._get_file_path(mgr._get_cache_key(url, **kwargs))

        def get(url: str, **kwargs: Any) -> pl.DataFrame | None:
            if volatile:
                path = cache_path_for(url, kwargs)
                if path.exists() and cache.is_stale(path):
                    stale.append(path)
                    return None
            return original_get(url, **kwargs)

        def set_(url: str, data: pl.DataFrame, **kwargs: Any) -> None:
            # Like nflreadpy: a failed cache write (full disk) must not fail the load.
            try:
                cache.write_parquet_atomic(data, cache_path_for(url, kwargs))
            except Exception as e:  # noqa: BLE001
                _log(f"{label}: could not write cache file ({type(e).__name__}: {e})")

        before = self._cache_files()
        mgr.get, mgr.set = get, set_  # type: ignore[method-assign]
        try:
            try:
                return call()
            except Exception as e:
                if not stale or not _is_network_error(e):
                    raise
                _log(f"{label}: refetch failed ({type(e).__name__}), using the stale cached copy")
                mgr.get = original_get  # type: ignore[method-assign]
                return call()
        finally:
            mgr.get, mgr.set = original_get, original_set  # type: ignore[method-assign]
            if self._cache_files() != before:
                self.fetched.append(label)
                _log(f"fetched {label} from the network")

    def load_season(self, spec: TableSpec, season: int) -> pl.DataFrame:
        volatile = cache.is_volatile(
            season, self._nfl.get_current_season(), self.last_season(spec)
        )
        marked = cache.is_marked_unavailable(self._cache_path, spec.key, season)
        marked_volatile = marked and cache.marker_is_volatile(self._cache_path, spec.key, season)
        # A 404 seen while the season was volatile is rechecked after a day, even once the
        # season has completed. One seen on a completed season is permanent.
        if marked and not (
            marked_volatile
            and cache.unavailable_marker_is_stale(self._cache_path, spec.key, season)
        ):
            raise SeasonUnavailable(season)
        loader = getattr(self._nfl, spec.loader)
        try:
            df = self._load(f"{spec.key} {season}", volatile, lambda: loader(season))
        except Exception as e:
            if _is_not_found(e):
                cache.mark_unavailable(
                    self._cache_path, spec.key, season, volatile or marked_volatile
                )
                raise SeasonUnavailable(season) from e
            if marked and _is_network_error(e):
                # Can't recheck; report it the way the last successful check did, so
                # offline and online runs agree.
                _log(f"{spec.key} {season}: recheck failed ({type(e).__name__}), keeping 404")
                raise SeasonUnavailable(season) from e
            raise
        if marked:
            cache.clear_unavailable(self._cache_path, spec.key, season)
        return df

    def load_whole(self, spec: TableSpec) -> pl.DataFrame:
        loader = getattr(self._nfl, spec.loader)
        return self._load(spec.key, True, loader)
