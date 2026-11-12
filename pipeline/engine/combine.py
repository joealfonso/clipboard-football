"""data/players/distributions.json: per-position percentile tables of the combine drills, and
the per-position distribution of every 0-99 rating.

Only summary parameters ship: percentile cut points per drill and position, never a player
row, name or id (docs/DATA.md, Combine license; spec resolved question 8). Population: drafted
players, draft classes 2010-2023 (spec resolved question 11). A drill's percentile is computed
over the players who ran it; coverage per drill is in the report because missing drills are
not random (top prospects often skip the 40 and the bench).

Mapping (designed, data/players/ratings.json): a rating's measured percentile is the weighted
mean of its drills' within-position percentiles, through the designed curve. A drill a
position has fewer than MIN_DRILL players for is left out; a rating with no usable drill for a
position is designed for that position.
"""

from __future__ import annotations

from typing import Any

import polars as pl

from pipeline.engine.config import sha

POSITION_MAP = {
    "QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE",
    "OT": "OL", "OG": "OL", "G": "OL", "C": "OL", "OL": "OL",
    "DT": "DL", "DE": "DL", "DL": "DL", "EDGE": "DL",
    "OLB": "LB", "ILB": "LB", "LB": "LB",
    "CB": "CB", "S": "S", "SAF": "S", "DB": "S",
    "K": "K", "P": "P",
}
DRILLS = ("forty", "bench", "wt", "cone", "shuttle")
# Cut points at 5%, 10%, ..., 95%. No 0% or 100% (the sample minimum and maximum are one player's
# result), and each cut is the mean of the CUT_PLAYERS order statistics nearest its rank, so no
# cut point is a single player's measurement (docs/DATA.md, Combine).
PERCENTILES = [i / 20 for i in range(1, 20)]
CUT_PLAYERS = 5
MIN_DRILL = 20
DRAFT_FROM, DRAFT_TO = 2010, 2023


def population(combine: pl.DataFrame) -> pl.DataFrame:
    """Drafted players of draft classes 2010-2023, with the game position. No name or id kept."""
    return combine.filter(
        pl.col("season").is_between(DRAFT_FROM, DRAFT_TO) & pl.col("draft_ovr").is_not_null() & pl.col("pos").is_in(list(POSITION_MAP))
    ).select(pl.col("pos").replace_strict(POSITION_MAP).alias("position"), *[pl.col(d).cast(pl.Float64) for d in DRILLS])


def cut_points(values: list[float]) -> list[float]:
    """At each percentile in PERCENTILES, the mean of the CUT_PLAYERS order statistics nearest
    rank q x (n - 1). Needs at least CUT_PLAYERS values."""
    xs = sorted(values)
    n = len(xs)
    if n < CUT_PLAYERS:
        raise ValueError(f"need at least {CUT_PLAYERS} values for a cut point, got {n}")
    out = []
    for q in PERCENTILES:
        center = q * (n - 1)
        lo = min(max(0, int(round(center)) - CUT_PLAYERS // 2), n - CUT_PLAYERS)
        out.append(round(sum(xs[lo:lo + CUT_PLAYERS]) / CUT_PLAYERS, 3))
    return out


def curve_at(curve: list[dict[str, float]], p: float) -> float:
    for a, b in zip(curve, curve[1:]):
        if p <= b["p"]:
            t = 0.0 if b["p"] == a["p"] else (p - a["p"]) / (b["p"] - a["p"])
            return a["rating"] + t * (b["rating"] - a["rating"])
    return curve[-1]["rating"]


def rating_distribution(curve: list[dict[str, float]], source: str) -> dict[str, Any]:
    """The generator draws u uniform on [0, 1) and rounds curve(u). Mean over a fine grid."""
    steps = 100000
    vals = [round(curve_at(curve, (i + 0.5) / steps)) for i in range(steps)]
    return {
        "source": source,
        "mean": round(sum(vals) / steps, 3),
        "p10": round(curve_at(curve, 0.1)),
        "p50": round(curve_at(curve, 0.5)),
        "p90": round(curve_at(curve, 0.9)),
    }


def build_distributions(combine: pl.DataFrame, ratings_cfg: dict[str, Any], ratings_bytes: bytes, skills: dict[str, list[str]]) -> tuple[dict[str, Any], dict[str, Any]]:
    """distributions.json and the coverage report (players per position, drill counts)."""
    pop = population(combine)
    drills: dict[str, dict[str, Any]] = {}
    coverage: dict[str, Any] = {}
    for pos in sorted(pop["position"].unique().to_list()):
        sub = pop.filter(pl.col("position") == pos)
        coverage[pos] = {"players": sub.height, **{d: int(sub[d].is_not_null().sum()) for d in DRILLS}}
        drills[pos] = {}
        for d in DRILLS:
            vals = sub[d].drop_nulls().to_list()
            if len(vals) >= MIN_DRILL:
                drills[pos][d] = {"cuts": cut_points(vals), "n": len(vals)}
    curve = ratings_cfg["curve"]
    ratings: dict[str, dict[str, Any]] = {}
    for pos, sk in skills.items():
        ratings[pos] = {}
        for r in ("speed", "strength", "agility", "awareness", *sk):
            m = ratings_cfg["measured"].get(r)
            usable = m is not None and any(d in drills.get(pos, {}) for d in m["drills"])
            ratings[pos][r] = rating_distribution(curve, "measured" if usable else "designed")
    out = {
        "generated": True,
        "schemaVersion": 1,
        "ratingsHash": sha(ratings_bytes),
        "draftClasses": {"from": DRAFT_FROM, "to": DRAFT_TO},
        "percentiles": PERCENTILES,
        "ratings": ratings,
        "drills": drills,
    }
    return out, coverage
