"""A fake nflverse server behind nflreadpy's real downloader and cache.

Patches requests.Session.get, so nflreadpy's own cache code (expiry, file paths,
writes) runs for real while no socket is opened.
"""

import io
import os
import re
import time
from pathlib import Path

import polars as pl
import pytest
import requests


def frame_for(url: str) -> pl.DataFrame:
    match = re.search(r"_(\d{4})\.parquet$", url)
    season = int(match.group(1)) if match else 2024
    return pl.DataFrame(
        {
            "season": [season, season],
            "game_id": [f"{season}_01_A_B"] * 2,
            "nflverse_game_id": [f"{season}_01_A_B"] * 2,
            "play_id": [1.0, 2.0],
            "nflverse_play_id": [1, 2],
            "play_type": ["kickoff", "run"],
            "posteam": ["A", "A"],
            "yardline_100": [35.0, 75.0],
            "touchback": [1.0, 0.0],
            "kickoff_fair_catch": [0.0, 0.0],
            "kickoff_returner_player_id": pl.Series([None, None], dtype=pl.String),
        }
    )


class FakeResponse:
    def __init__(self, url: str, status: int, content: bytes = b"") -> None:
        self.url = url
        self.status_code = status
        self.headers: dict[str, str] = {}
        self.content = content

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} for {self.url}", response=self)  # type: ignore[arg-type]


class FakeNetwork:
    """online=False makes every request fail the way a dropped connection does."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, not_found: set[str] = frozenset()) -> None:
        self.online = True
        self.not_found = not_found
        self.requests: list[str] = []
        self.payload_version = 1
        # Answer every request with this HTTP status instead of data, or with bytes
        # that are not parquet.
        self.status: int | None = None
        self.corrupt = False
        network = self

        def get(session: requests.Session, url: str, **kwargs: object) -> FakeResponse:
            network.requests.append(url)
            if not network.online:
                raise requests.ConnectionError(f"offline: {url}")
            if any(part in url for part in network.not_found):
                return FakeResponse(url, 404)
            if network.status is not None:
                return FakeResponse(url, network.status)
            if network.corrupt:
                return FakeResponse(url, 200, b"not a parquet file")
            df = frame_for(url).with_columns(pl.lit(network.payload_version).alias("version"))
            buf = io.BytesIO()
            df.write_parquet(buf)
            return FakeResponse(url, 200, buf.getvalue())

        monkeypatch.setattr(requests.Session, "get", get)


def age_everything(root: Path, seconds: float) -> None:
    then = time.time() - seconds
    for path in root.rglob("*"):
        if path.is_file():
            os.utime(path, (then, then))
