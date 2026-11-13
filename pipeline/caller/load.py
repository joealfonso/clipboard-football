"""Builds one play frame per season from pbp, participation and FTN charting.

Player IDs are used only to decide whether a rusher threw a pass for the same team in the
same game (the inferred QB sneak rule) and are dropped before anything leaves this module.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Protocol

import polars as pl

from pipeline.caller.mapping import SCRIMMAGE_PLAY_TYPES, TOKEN
from pipeline.tables import TABLES, TableSpec

PBP_COLS = [
    "game_id", "play_id", "season", "season_type", "play_type", "down", "ydstogo",
    "yardline_100", "score_differential", "qtr", "half_seconds_remaining",
    "game_seconds_remaining", "posteam", "defteam", "posteam_timeouts_remaining",
    "defteam_timeouts_remaining", "timeout", "timeout_team", "qb_dropback", "qb_scramble",
    "qb_spike", "qb_kneel", "air_yards", "run_location", "run_gap", "extra_point_attempt",
    "two_point_attempt", "aborted_play", "passer_player_id", "rusher_player_id",
]
PART_COLS = [
    "offense_formation", "offense_personnel", "defense_personnel", "defenders_in_box",
    "number_of_pass_rushers", "defense_coverage_type", "defense_man_zone_type",
]
FTN_COLS = ["is_screen_pass", "is_play_action", "is_qb_sneak", "n_blitzers"]
ID_COLS = ["game_id", "play_id", "posteam", "defteam", "passer_player_id", "rusher_player_id", "timeout_team"]

FIRST_PARTICIPATION = 2016
FIRST_FTN = 2022
EXCLUSION_REASONS = ("postseason", "overtime", "no_play", "aborted", "other play type or no down")


class Source(Protocol):
    def load_season(self, spec: TableSpec, season: int) -> pl.DataFrame: ...


def spec(key: str) -> TableSpec:
    return next(t for t in TABLES if t.key == key)


@dataclass
class SeasonData:
    season: int
    plays: pl.DataFrame
    exclusions: dict[str, int] = field(default_factory=dict)
    # Observed values in the whole participation table, for the unmapped check and report.
    formation_values: Counter[str] = field(default_factory=Counter)
    coverage_values: Counter[str] = field(default_factory=Counter)
    man_zone_values: Counter[str] = field(default_factory=Counter)
    personnel_tokens: Counter[str] = field(default_factory=Counter)
    defense_personnel: Counter[str] = field(default_factory=Counter)
    offense_personnel: Counter[str] = field(default_factory=Counter)
    # Step 5b: overtime scrimmage plays, processed like `plays` but kept apart. Only the late-window
    # levels of oTop and o4Top (those keyed by lateTime) ever fit them.
    ot_plays: pl.DataFrame | None = None


def _counts(s: pl.Series) -> Counter[str]:
    return Counter({v: n for v, n in s.drop_nulls().value_counts().iter_rows()})


def _tokens(*series: pl.Series) -> Counter[str]:
    out: Counter[str] = Counter()
    for s in series:
        for text, n in s.drop_nulls().value_counts().iter_rows():
            for part in text.split(","):
                if not part.strip():
                    continue
                m = TOKEN.match(part)
                out[m.group(2) if m else part.strip()] += n
    return out


def _cols(df: pl.DataFrame, cols: list[str]) -> pl.DataFrame:
    """Select columns, adding any a season lacks as nulls so seasons concatenate."""
    return df.select([pl.col(c) if c in df.columns else pl.lit(None).alias(c) for c in cols])


def classify(pbp: pl.DataFrame) -> pl.DataFrame:
    """Adds `scope`: an exclusion reason, "scrimmage", "try", or "other"."""
    pt = pl.col("play_type")
    try_row = (
        (pl.col("extra_point_attempt").fill_null(0) == 1) | (pl.col("two_point_attempt").fill_null(0) == 1)
    ) & pt.is_in(["extra_point", "run", "pass"])
    scrimmage = pl.col("down").is_not_null() & pt.is_in(list(SCRIMMAGE_PLAY_TYPES))
    return pbp.with_columns(
        scope=pl.when(pl.col("season_type") != "REG")
        .then(pl.lit("postseason"))
        .when(pl.col("qtr") == 5)
        .then(pl.lit("overtime"))
        .when(pt == "no_play")
        .then(pl.lit("no_play"))
        .when(pl.col("aborted_play").fill_null(0) == 1)
        .then(pl.lit("aborted"))
        .when(try_row)
        .then(pl.lit("try"))
        .when(scrimmage)
        .then(pl.lit("scrimmage"))
        .otherwise(pl.lit("other play type or no down"))
    )


OT_SCRIMMAGE = ("run", "pass", "punt", "field_goal", "qb_kneel", "qb_spike", "no_play", "extra_point")
CLOCK_FLAG_COLS = ["game_id", "play_id", "clock_running", "ot_both_possessed"]


def ot_both_possessed(rows: list[dict[str, Any]]) -> list[int]:
    """Step 5d milestone A: whether the second overtime team has had its opportunity to possess,
    for each row (rows of one or more games, in play order). A fact about who had the ball, derived
    the same way in every season: 0 on every regulation row. In overtime the first team receives
    OT's first possession (the posteam of the first OT kickoff, which nflverse lists as the
    receiving team; else the first OT row's posteam). The flag turns on at the first OT row where
    the other team has the ball on a scrimmage play or a try (that row is 1), and after a kick by the
    first team: a kickoff to the second team or a punt (the rows after it are 1). It stays on."""
    out: list[int] = []
    game = None
    first: str | None = None
    on = False
    for r in rows:
        if r["game_id"] != game:
            game, first, on = r["game_id"], None, False
        if (r["qtr"] or 0) < 5:
            out.append(0)
            continue
        pos, pt = r["posteam"], r["play_type"]
        if first is None and pos is not None and pt is not None:
            first = pos
        if not on and first is not None and pos is not None and pos != first and pt in OT_SCRIMMAGE:
            on = True
        out.append(1 if on else 0)
        if first is not None and pos is not None and ((pt == "kickoff" and pos != first and r["defteam"] == first) or (pt == "punt" and pos == first)):
            on = True
    return out


def clock_flags(pbp: pl.DataFrame) -> pl.DataFrame:
    """Step 5d milestone A: two Situation fields per regular-season play (game_id, play_id).

    clock_running is designed (nflverse has no clock-state field): the game pipeline's reading,
    decisions.clock_running, and 0 when a team called a timeout in the dead ball before the snap,
    with timeout rows in revision 1's clock order (decisions.clock_order). The same reading the
    game pipeline uses for tempo and `c.spike.stopped`. Rows that are not a scrimmage snap (tries,
    kickoffs) get 0. ot_both_possessed: see ot_both_possessed()."""
    from pipeline.game import decisions as dec
    from pipeline.game.load import season_rows

    rows = season_rows(pbp)
    db = dec.dead_balls(rows, 40)
    snap = {(x["gameId"], x["playId"]): x for x in db.snaps}
    ordered = list(rows.select("game_id", "play_id", "qtr", "posteam", "defteam", "play_type").iter_rows(named=True))
    ot = ot_both_possessed(ordered)
    got = [snap.get((r["game_id"], r["play_id"])) for r in ordered]
    return pl.DataFrame(
        {
            "game_id": [r["game_id"] for r in ordered],
            "play_id": [r["play_id"] for r in ordered],
            "clock_running": [0 if x is None or x["timeoutCalled"] else int(x["base"]["clockRunning"]) for x in got],
            "ot_both_possessed": ot,
            # Step 5d resolution 3: timeouts at the snap in clock order (the dead-ball count less the
            # team's own timeout in that dead ball); null where the dead-ball reader lists no snap.
            "offense_timeouts_clock": [None if x is None else x["offenseTimeouts"] - x["offenseTimeout"] for x in got],
            "defense_timeouts_clock": [None if x is None else x["defenseTimeouts"] - x["defenseTimeout"] for x in got],
        },
        schema={"game_id": pl.String, "play_id": pl.Float64, "clock_running": pl.Int64, "ot_both_possessed": pl.Int64,
                "offense_timeouts_clock": pl.Float64, "defense_timeouts_clock": pl.Float64},
    )


def build_season(
    season: int, pbp: pl.DataFrame, part: pl.DataFrame | None, ftn: pl.DataFrame | None
) -> SeasonData:
    flags = clock_flags(pbp)
    pbp = classify(_cols(pbp, PBP_COLS))
    exclusions = {r: 0 for r in EXCLUSION_REASONS}
    for scope, n in pbp.group_by("scope").len().iter_rows():
        if scope in exclusions:
            exclusions[scope] = n
    passers = (
        pbp.filter(pl.col("passer_player_id").is_not_null())
        .select("game_id", "posteam", pl.col("passer_player_id").alias("rusher_player_id"))
        .unique()
        .with_columns(rusher_threw=pl.lit(True))
    )
    pt = pl.col("play_type")
    ot_scrimmage = (pl.col("scope") == "overtime") & pl.col("down").is_not_null() & pt.is_in(list(SCRIMMAGE_PLAY_TYPES)) \
        & (pl.col("aborted_play").fill_null(0) != 1) & (pl.col("extra_point_attempt").fill_null(0) != 1) & (pl.col("two_point_attempt").fill_null(0) != 1)
    plays = pbp.filter(pl.col("scope").is_in(["scrimmage", "try"]) | ot_scrimmage).with_columns(is_ot=pl.col("scope") == "overtime").join(
        passers, on=["game_id", "posteam", "rusher_player_id"], how="left"
    )
    plays = plays.with_columns(pl.col("play_id").cast(pl.Float64)).join(flags, on=["game_id", "play_id"], how="left").with_columns(
        # A try never has the clock running (the 2026 rule set and the sim agree).
        clock_running=pl.when(pl.col("scope") == "try").then(0).otherwise(pl.col("clock_running").fill_null(0)),
        ot_both_possessed=pl.col("ot_both_possessed").fill_null(0),
    )
    data = SeasonData(season=season, plays=plays, exclusions=exclusions)

    if part is not None:
        p = _cols(part, ["nflverse_game_id", "play_id", *PART_COLS]).with_columns(
            pl.col("play_id").cast(pl.Float64),
            # An empty personnel string means not recorded, the same as null.
            *[
                pl.when(pl.col(c).cast(pl.String).str.strip_chars() == "").then(None).otherwise(pl.col(c)).alias(c)
                for c in ("offense_personnel", "defense_personnel")
            ],
            part_present=pl.lit(True),
        )
        data.formation_values = _counts(p["offense_formation"])
        data.coverage_values = _counts(p["defense_coverage_type"])
        data.man_zone_values = _counts(p["defense_man_zone_type"])
        data.personnel_tokens = _tokens(p["offense_personnel"], p["defense_personnel"])
        data.defense_personnel = _counts(p["defense_personnel"])
        data.offense_personnel = _counts(p["offense_personnel"])
        plays = plays.join(
            p.unique(["nflverse_game_id", "play_id"], keep="first", maintain_order=True),
            left_on=["game_id", "play_id"],
            right_on=["nflverse_game_id", "play_id"],
            how="left",
        )
    else:
        plays = plays.with_columns([pl.lit(None).alias(c) for c in PART_COLS]).with_columns(
            part_present=pl.lit(None, dtype=pl.Boolean)
        )
    if ftn is not None:
        f = _cols(ftn, ["nflverse_game_id", "nflverse_play_id", *FTN_COLS]).with_columns(
            pl.col("nflverse_play_id").cast(pl.Float64), ftn_present=pl.lit(True)
        )
        plays = plays.join(
            f.unique(["nflverse_game_id", "nflverse_play_id"], keep="first", maintain_order=True),
            left_on=["game_id", "play_id"],
            right_on=["nflverse_game_id", "nflverse_play_id"],
            how="left",
        )
    else:
        plays = plays.with_columns([pl.lit(None).alias(c) for c in FTN_COLS]).with_columns(
            ftn_present=pl.lit(None, dtype=pl.Boolean)
        )

    own_timeout = (pl.col("timeout").fill_null(0) == 1) & (pl.col("timeout_team") == pl.col("posteam"))
    def_timeout = (pl.col("timeout").fill_null(0) == 1) & (pl.col("timeout_team") == pl.col("defteam"))
    plays = plays.with_columns(
        season=pl.lit(season, dtype=pl.Int64),
        phase=pl.when(pl.col("scope") == "try").then(pl.lit("try")).otherwise(pl.lit("scrimmage")),
        part_present=pl.col("part_present").fill_null(False),
        ftn_present=pl.col("ftn_present").fill_null(False),
        # nflverse records timeouts remaining after the play's own timeout (checked against
        # known plays, docs/DECISIONS.md); add it back for the count at the snap. Step 5d
        # resolution 3: where the game pipeline reads the snap's dead ball, its clock-order count
        # is used instead (they differ on 23 snaps of 2016-2023, DECISIONS.md).
        offense_timeouts=pl.coalesce(pl.col("offense_timeouts_clock"),
                                     pl.col("posteam_timeouts_remaining") + own_timeout.fill_null(False).cast(pl.Float64)),
        defense_timeouts=pl.coalesce(pl.col("defense_timeouts_clock"),
                                     pl.col("defteam_timeouts_remaining") + def_timeout.fill_null(False).cast(pl.Float64)),
        is_screen_pass=pl.col("is_screen_pass").cast(pl.Boolean),
        is_play_action=pl.col("is_play_action").cast(pl.Boolean),
        is_qb_sneak=pl.col("is_qb_sneak").cast(pl.Boolean),
        defenders_in_box=pl.col("defenders_in_box").cast(pl.Float64),
        number_of_pass_rushers=pl.col("number_of_pass_rushers").cast(pl.Float64),
        offense_formation=pl.col("offense_formation").cast(pl.String),
        offense_personnel=pl.col("offense_personnel").cast(pl.String),
        defense_personnel=pl.col("defense_personnel").cast(pl.String),
        defense_coverage_type=pl.col("defense_coverage_type").cast(pl.String),
        defense_man_zone_type=pl.col("defense_man_zone_type").cast(pl.String),
        n_blitzers=pl.col("n_blitzers").cast(pl.Float64),
    )
    numeric = [
        "down", "ydstogo", "yardline_100", "score_differential", "qtr", "half_seconds_remaining",
        "game_seconds_remaining", "qb_dropback", "qb_scramble", "qb_spike", "qb_kneel", "air_yards",
        "extra_point_attempt", "two_point_attempt", "timeout", "clock_running", "ot_both_possessed",
    ]
    plays = plays.with_columns([pl.col(c).cast(pl.Float64) for c in numeric])
    plays = plays.with_columns(
        rusher_threw=pl.col("rusher_threw").fill_null(False),
        run_location=pl.col("run_location").cast(pl.String),
        run_gap=pl.col("run_gap").cast(pl.String),
    )
    plays = plays.drop([c for c in ID_COLS + ["posteam_timeouts_remaining", "defteam_timeouts_remaining", "offense_timeouts_clock",
                                               "defense_timeouts_clock"] if c in plays.columns])
    data.plays = plays.filter(~pl.col("is_ot")).drop("is_ot")
    data.ot_plays = plays.filter(pl.col("is_ot")).drop("is_ot")
    return data


def load_all(source: Source, seasons: list[int], log: Any = None) -> list[SeasonData]:
    out: list[SeasonData] = []
    for season in seasons:
        if log:
            log(f"loading {season}")
        pbp = source.load_season(spec("pbp"), season)
        part = source.load_season(spec("participation"), season) if season >= FIRST_PARTICIPATION else None
        ftn = source.load_season(spec("ftn_charting"), season) if season >= FIRST_FTN else None
        out.append(build_season(season, pbp, part, ftn))
        del pbp, part, ftn
    return out
