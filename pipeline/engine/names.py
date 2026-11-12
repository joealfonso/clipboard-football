"""A7: every first-last combination in data/players/names.json must not be a real player's name
in any nflverse roster from 1999 on. The check reports only a count, never a name, and real
rosters are read from the cache and never written anywhere.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import polars as pl

FIRST_ROSTER_SEASON = 1999


class NameCollision(Exception):
    def __init__(self, count: int) -> None:
        self.count = count
        super().__init__(f"{count} generated name combinations match a real player in nflverse rosters; edit data/players/names.json")


def real_names(rosters: Iterable[pl.DataFrame]) -> set[str]:
    out: set[str] = set()
    for r in rosters:
        if "full_name" in r.columns:
            out |= {x.strip().lower() for x in r["full_name"].drop_nulls().to_list()}
        if "first_name" in r.columns and "last_name" in r.columns:
            out |= {
                f"{a} {b}".strip().lower()
                for a, b in zip(r["first_name"].fill_null("").to_list(), r["last_name"].fill_null("").to_list())
            }
    return out


def collisions(names: dict[str, Any], real: set[str]) -> int:
    return sum(1 for f in names["first"] for last in names["last"] if f"{f} {last}".lower() in real)


def check(names: dict[str, Any], rosters: Iterable[pl.DataFrame]) -> int:
    """Number of combinations checked. Raises NameCollision on any match."""
    n = collisions(names, real_names(rosters))
    if n:
        raise NameCollision(n)
    return len(names["first"]) * len(names["last"])
