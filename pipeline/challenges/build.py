"""M2 milestone G2: close-call and reversal rates for the five close-call kinds, fitted from
nflverse pbp `replay_or_challenge` and `replay_or_challenge_result`, regular seasons 2016-2023
only (data/game/config.json seasons.from..to; 2024 on is never loaded or kept).

    uv run --project pipeline python -m pipeline.challenges

Writes data/game/challenges.json (byte-identical on rerun). The kind is read from the review
sentence in the play description ("<who> reviewed|challenged the <ruling> ruling, and the play
was REVERSED|Upheld"); how each ruling phrase maps to a kind is designed and hand-checked
(docs/DECISIONS.md, M2 G2). Descriptions are parsed here and dropped; nothing from them ships.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Callable

import polars as pl

from pipeline.caller.load import Source, spec

REPO = Path(__file__).resolve().parents[2]
OUT = Path("data/game/challenges.json")

# Ruling phrase -> close-call kind (designed reading, hand-checked). Every other phrase is a
# review of something the game does not model and counts in no kind.
PHRASES: dict[str, str] = {
    "pass completion": "completionToIncomplete",
    "fumble": "fumbleToDown",
    "runner was not down by contact": "fumbleToDown",
    "interception": "interceptionToIncomplete",
    "pass interception": "interceptionToIncomplete",
    "runner broke the plane": "touchdownToShort",
    "first down": "spotLineToGain",
    "short of the line to gain": "spotLineToGain",
}
KINDS = ["completionToIncomplete", "fumbleToDown", "interceptionToIncomplete", "touchdownToShort", "spotLineToGain"]
REVIEW_RX = r"(?i)(The Replay Official reviewed|The Replay Assistant reviewed|(?:[A-Z][A-Za-z.]+ ?)+ challenged) the (.+?) ruling, and the play was (REVERSED|Upheld)"
COLS = ["game_id", "play_id", "season", "season_type", "posteam", "defteam", "play_type", "desc", "replay_or_challenge",
        "replay_or_challenge_result", "complete_pass", "interception", "fumble_lost", "touchdown", "td_team", "yards_gained", "ydstogo"]
PER_MILLION = 1_000_000
SHARE = 10_000


def seasons_of(root: Path) -> list[int]:
    cfg = json.loads((root / "data/game/config.json").read_text(encoding="utf-8"))["seasons"]
    out = list(range(cfg["from"], cfg["to"] + 1))
    check_holdout(out, cfg["neverTrainFrom"])
    return out


def check_holdout(seasons: list[int] | set[int], never_from: int) -> None:
    bad = sorted(s for s in seasons if s >= never_from)
    if bad:
        raise ValueError(f"holdout seasons {bad} reached the challenge fit")


def _f(c: str) -> pl.Expr:
    return pl.col(c).cast(pl.Float64).fill_null(0) == 1


def season_rows(pbp: pl.DataFrame, never_from: int) -> pl.DataFrame:
    """Regular-season scrimmage rows with the review read: kind (or null), initiator, reversed, and
    the ruled-on-field flags each kind's denominator needs. 2024-on rows are dropped here too."""
    df = pbp.select([pl.col(c) if c in pbp.columns else pl.lit(None).alias(c) for c in COLS])
    df = df.filter((pl.col("season_type") == "REG") & (pl.col("season") < never_from))
    desc = pl.col("desc").cast(pl.String).fill_null("")
    reviewed = _f("replay_or_challenge")
    phrase = desc.str.extract(REVIEW_RX, 2).str.to_lowercase()
    who = desc.str.extract(REVIEW_RX, 1)
    ruled = desc.str.split(" The Replay ").list.first().str.split(" challenged the ").list.first()
    df = df.with_columns(
        reviewed=reviewed,
        phrase=pl.when(reviewed).then(phrase),
        coach=pl.when(reviewed).then(~who.str.contains("(?i)replay")),
        reversed=reviewed & (pl.col("replay_or_challenge_result") == "reversed"),
        # The ruling on the field: a fumble recovered by the defense ("RECOVERED by <defteam>-").
        ruled_fumble_lost=ruled.str.contains("FUMBLES") & ruled.str.contains(pl.lit("RECOVERED by ") + pl.col("defteam").cast(pl.String).fill_null("?") + pl.lit("-")),
        scrimmage=pl.col("play_type").is_in(["run", "pass"]),
    )
    kind = pl.col("phrase").replace_strict(PHRASES, default=None, return_dtype=pl.String)
    ruled_td = ruled.str.contains("TOUCHDOWN") & ~ruled.str.contains("FUMBLES")
    # Hand-check fixes (DECISIONS, M2 G2): "runner was not down by contact" on a ruled touchdown is
    # the touchdown kind; a fumble ruling counts only when the ruled fumble was lost; only run and
    # pass plays count (a kick return fumble is not a modeled close call).
    kind = (
        pl.when(~pl.col("scrimmage")).then(None)
        .when((pl.col("phrase") == "runner was not down by contact") & ruled_td).then(pl.lit("touchdownToShort"))
        .when((kind == "fumbleToDown") & ~pl.col("ruled_fumble_lost")).then(None)
        .otherwise(kind)
    )
    return df.with_columns(kind=kind).drop("desc")


def load(source: Source, seasons: list[int], never_from: int, log: Callable[[str], None]) -> pl.DataFrame:
    frames = []
    for s in seasons:
        log(f"loading {s}")
        frames.append(season_rows(source.load_season(spec("pbp"), s), never_from))
    df = pl.concat(frames, how="vertical_relaxed")
    check_holdout(set(df["season"].unique().to_list()), never_from)
    return df


def denominators(df: pl.DataFrame) -> dict[str, int]:
    """Plays ruled each way on the field: the unreviewed plays of that result plus the reviews of
    that ruling (a reviewed play's final columns are the corrected play, not the ruling)."""
    un = df.filter(~pl.col("reviewed") & pl.col("scrimmage"))
    near = (pl.col("yards_gained").cast(pl.Float64) - pl.col("ydstogo").cast(pl.Float64)).abs() <= 1
    base = {
        "completionToIncomplete": un.filter(_f("complete_pass")).height,
        "fumbleToDown": un.filter(_f("fumble_lost")).height,
        "interceptionToIncomplete": un.filter(_f("interception")).height,
        "touchdownToShort": un.filter(_f("touchdown") & (pl.col("td_team") == pl.col("posteam"))).height,
        "spotLineToGain": un.filter(near & ~_f("touchdown") & ~_f("interception") & ~_f("fumble_lost")).height,
    }
    rev = df.filter(pl.col("kind").is_not_null()).group_by("kind").len()
    for k, n in rev.iter_rows():
        base[k] += n
    return base


def interval(values: list[float]) -> dict[str, float]:
    return {"lo": round(min(values), 6), "hi": round(max(values), 6)}


def fit(df: pl.DataFrame, seasons: list[int]) -> dict[str, Any]:
    den = denominators(df)
    kinds: dict[str, Any] = {}
    for k in KINDS:
        r = df.filter(pl.col("kind") == k)
        n = r.height
        rev = int(r["reversed"].sum())
        coach = int(r["coach"].sum())
        kinds[k] = {
            "reviews": n, "reversed": rev, "coachChallenges": coach, "officialReviews": n - coach, "ruledPlays": den[k],
            "reviewPer1000000": round(n * PER_MILLION / den[k]) if den[k] else 0,
            "reversalPer10000": round(rev * SHARE / n) if n else 0,
        }
    games = df.group_by("season").agg(pl.col("game_id").n_unique().alias("games"))
    team_games = {int(s): int(g) * 2 for s, g in games.iter_rows()}
    modeled = df.filter(pl.col("kind").is_not_null())
    ch = modeled.filter(pl.col("coach") == True)  # noqa: E712
    per_season = []
    for s in seasons:
        c = ch.filter(pl.col("season") == s)
        tg = team_games.get(s, 0)
        per_season.append({"season": s, "teamGames": tg, "coachChallenges": c.height, "reversed": int(c["reversed"].sum()),
                           "perTeamGame": round(c.height / tg, 6) if tg else 0.0, "reversalShare": round(float(c["reversed"].mean() or 0), 6)})
    tg_all = sum(team_games.values())
    actuals = {
        "note": "Coach's challenges of the five modeled kinds only (the game marks no other close call). Intervals are the range of the 2016-2023 season values.",
        "challenges.perTeamGame": {"value": round(ch.height / tg_all, 6), "n": tg_all, **interval([x["perTeamGame"] for x in per_season])},
        "challenges.reversalShare": {"value": round(float(ch["reversed"].mean() or 0), 6), "n": ch.height, **interval([x["reversalShare"] for x in per_season])},
        "perSeason": per_season,
    }
    return {"kinds": kinds, "actuals": actuals}


def build(source: Source, root: Path = REPO, log: Callable[[str], None] = lambda m: print(f"[challenges] {m}", file=sys.stderr)) -> dict[str, Any]:
    seasons = seasons_of(root)
    cfg = json.loads((root / "data/game/config.json").read_text(encoding="utf-8"))["seasons"]
    df = load(source, seasons, cfg["neverTrainFrom"], log)
    out = {
        "generated": True,
        "note": "M2 milestone G2 (fitted): per close-call kind, how often plays ruled that way on the field were reviewed (reviewPer1000000 of ruledPlays) and how often a review reversed them (reversalPer10000), nflverse pbp regular seasons 2016-2023. Built by pipeline/challenges/build.py; the kind reading is in docs/DECISIONS.md (M2 G2).",
        "seasons": seasons,
        "phrases": PHRASES,
        **fit(df, seasons),
    }
    (root / OUT).write_text(json.dumps(out, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    log(f"wrote {OUT}")
    return out


def main(argv: list[str] | None = None) -> int:
    from pipeline import cache
    from pipeline.sources import NflreadpySource

    path = cache.cache_dir()
    try:
        cache.prepare(path)
    except cache.CacheNotWritable as e:
        print(str(e), file=sys.stderr)
        return 2
    build(NflreadpySource(path))
    return 0
