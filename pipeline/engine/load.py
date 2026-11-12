"""Loads every season the engine needs: the step 2 play frame (call, leaf, formation, bins)
with the outcome columns added, every snap with its fouls for the penalty rates, and the
kickoffs for the designed kickoff's tuning check.

The step 2 frame is built by pipeline.caller.load.build_season itself, so the call and leaf
mapping is the caller's code, not a copy. That function keeps a fixed column list, so the
engine passes its extra columns through it by extending the two module-level lists for the
duration of the call (see `caller_columns`). Team and player columns are turned into flags
first and never leave this module; the description text is parsed here and dropped.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import polars as pl

from pipeline.caller import load as caller_load
from pipeline.caller.load import Source, spec
from pipeline.stats import START_PLAY_TYPES, KickoffSummary, kickoff_summary

# Raw pbp columns the engine reads, beyond the caller's.
RAW_COLS = [
    "game_id", "play_id", "season", "season_type", "qtr", "down", "ydstogo", "yardline_100", "play_type", "desc",
    "posteam", "defteam", "yards_gained", "complete_pass", "incomplete_pass", "interception", "sack",
    "qb_scramble", "fumble", "fumble_lost", "fumble_out_of_bounds", "fumble_recovery_1_team",
    "fumble_recovery_1_yards", "return_yards", "return_touchdown", "td_team", "safety",
    "out_of_bounds", "penalty", "pass", "rush", "kick_distance", "field_goal_result", "extra_point_result",
    "two_point_conv_result", "punt_blocked", "touchback", "punt_fair_catch", "punt_downed",
    "punt_out_of_bounds", "time_of_day", "end_clock_time", "air_yards", "two_point_attempt",
    "extra_point_attempt", "aborted_play", "defensive_two_point_conv", "game_seconds_remaining",
    "score_differential", "posteam_timeouts_remaining", "defteam_timeouts_remaining",
]

# Outcome columns carried through the caller's build_season (all numeric or boolean flags).
EXTRA_COLS = [
    "yards_gained", "complete_pass", "incomplete_pass", "interception", "sack", "fumble", "fumble_lost",
    "fumble_out_of_bounds", "fumble_recovery_1_yards", "return_yards", "return_touchdown", "safety",
    "out_of_bounds", "penalty", "kick_distance", "field_goal_result", "extra_point_result",
    "two_point_conv_result", "punt_blocked", "touchback", "punt_fair_catch", "punt_downed",
    "punt_out_of_bounds", "defensive_two_point_conv",
    # Derived below from team columns or the description.
    "td_offense", "td_defense", "recovered_by_offense", "duration", "has_accepted_foul",
    "desc_sacked", "desc_intercepted", "desc_incomplete", "desc_touchdown", "desc_safety",
    "desc_recovered_by_kicking", "desc_muff",
]

# "PENALTY on NE-55-J.Doe, Offensive Holding, 10 yards, enforced ..." or "..., declined." Team
# first, then the type, then the yards or the word that says it was not enforced.
FOUL_RX = r"(?i)penalty on ([A-Z]{2,3})(?:-[^,]*)?, ([A-Za-z0-9 /().'\-]+?), (\d+ yards?|declined|offsetting|0 yards)"
FOUL_TEAM_RX = re.compile(FOUL_RX)


@contextmanager
def caller_columns(extra: list[str]) -> Iterator[None]:
    """Lets the caller's build_season carry `extra` columns, and keeps game_id and play_id."""
    old_pbp, old_ids = caller_load.PBP_COLS, caller_load.ID_COLS
    caller_load.PBP_COLS = [*old_pbp, *[c for c in extra if c not in old_pbp]]
    caller_load.ID_COLS = [c for c in old_ids if c not in ("game_id", "play_id")]
    try:
        yield
    finally:
        caller_load.PBP_COLS, caller_load.ID_COLS = old_pbp, old_ids


def _flag(c: str) -> pl.Expr:
    return pl.col(c).cast(pl.Float64).fill_null(0) == 1


def duration_expr() -> pl.Expr:
    """Wall-clock seconds from the snap (time_of_day) to the end of the play (end_clock_time).
    Both are ISO timestamps from 2022 on; earlier seasons have neither or a different format,
    which parses to null."""
    t0 = pl.col("time_of_day").cast(pl.String).str.to_datetime(strict=False, time_zone="UTC")
    t1 = pl.col("end_clock_time").cast(pl.String).str.to_datetime(strict=False, time_zone="UTC")
    return ((t1 - t0).dt.total_milliseconds() / 1000.0).alias("duration")


def derive(pbp: pl.DataFrame) -> pl.DataFrame:
    """Adds the derived flags. Needs RAW_COLS; missing columns are null."""
    df = pbp.select([pl.col(c) if c in pbp.columns else pl.lit(None).alias(c) for c in RAW_COLS])
    desc = pl.col("desc").cast(pl.String).fill_null("")
    rec_team = desc.str.extract(r"(?i)recovered by ([A-Z]{2,3})-", 1)
    return df.with_columns(
        td_offense=(pl.col("td_team") == pl.col("posteam")).fill_null(False),
        td_defense=(pl.col("td_team") == pl.col("defteam")).fill_null(False),
        recovered_by_offense=(pl.col("fumble_recovery_1_team") == pl.col("posteam")).fill_null(False),
        has_accepted_foul=_flag("penalty"),
        desc_sacked=desc.str.contains(r"(?i)\bsacked\b"),
        desc_intercepted=desc.str.contains(r"INTERCEPTED"),
        desc_incomplete=desc.str.contains(r"(?i)\bincomplete\b"),
        desc_touchdown=desc.str.contains(r"TOUCHDOWN"),
        desc_safety=desc.str.contains(r"SAFETY"),
        desc_recovered_by_kicking=(rec_team == pl.col("posteam")).fill_null(False),
        desc_muff=desc.str.contains(r"MUFFS"),
        duration=duration_expr(),
        fouls=desc.str.extract_all(FOUL_RX),
    )


def fouls_of(desc_matches: list[str], posteam: str | None, defteam: str | None) -> list[tuple[str, str, str, int]]:
    """(pbp penalty type, side, status, yards) per foul named in the description. side is
    offense, defense or unknown; status is enforced, declined or offsetting; yards are the
    enforced yards the description states (0 unless enforced)."""
    out: list[tuple[str, str, str, int]] = []
    for text in desc_matches:
        m = FOUL_TEAM_RX.search(text)
        if m is None:
            continue
        team, ptype, tail = m.group(1), m.group(2).strip(), m.group(3).lower()
        side = "offense" if team == posteam else "defense" if team == defteam else "unknown"
        status = "declined" if tail == "declined" else "offsetting" if tail == "offsetting" else "enforced"
        yards = int(tail.split()[0]) if status == "enforced" else 0
        out.append((ptype, side, status, yards))
    return out


SNAP_TYPES = ("run", "pass", "punt", "field_goal", "extra_point", "qb_kneel", "qb_spike")


def snaps_frame(raw: pl.DataFrame) -> pl.DataFrame:
    """Every regular-season, regulation snap with its fouls, for the penalty rates. A snap is a
    play of a snap type, or a no_play row that names at least one foul (pre-snap fouls and
    plays wiped out by an accepted foul). One row per foul (null type for a clean snap)."""
    df = raw.filter((pl.col("season_type") == "REG") & (pl.col("qtr") < 5) & ~_flag("aborted_play"))
    df = df.filter(
        pl.col("play_type").is_in(SNAP_TYPES)
        | ((pl.col("play_type") == "no_play") & (pl.col("fouls").list.len() > 0))
    )
    desc = pl.col("desc").cast(pl.String).fill_null("")
    two = _flag("two_point_attempt")
    pfam = (
        pl.when(pl.col("play_type") == "punt").then(pl.lit("punt"))
        .when(pl.col("play_type") == "field_goal").then(pl.lit("fieldGoal"))
        .when(pl.col("play_type") == "extra_point").then(pl.lit("extraPoint"))
        .when(pl.col("play_type") == "qb_kneel").then(pl.lit("kneel"))
        .when(pl.col("play_type") == "qb_spike").then(pl.lit("spike"))
        .when(two).then(pl.lit("twoPoint"))
        .when(pl.col("play_type") == "pass").then(pl.lit("pass"))
        .when((pl.col("play_type") == "run") & _flag("qb_scramble")).then(pl.lit("pass"))
        .when(pl.col("play_type") == "run").then(pl.lit("run"))
        # no_play rows
        .when(desc.str.contains(r"\(Punt formation\)")).then(pl.lit("punt"))
        .when(desc.str.contains(r"\(Field Goal formation\)")).then(pl.lit("fieldGoal"))
        .when(_flag("pass")).then(pl.lit("pass"))
        .when(_flag("rush")).then(pl.lit("run"))
        .otherwise(pl.lit("scrimmage"))
    )
    df = df.with_columns(pfamily=pfam, no_play=pl.col("play_type") == "no_play")
    rows: list[dict[str, Any]] = []
    df = df.with_columns(
        offense_timeouts=pl.col("posteam_timeouts_remaining").cast(pl.Float64),
        defense_timeouts=pl.col("defteam_timeouts_remaining").cast(pl.Float64),
    )
    keep = ("season", "down", "ydstogo", "yardline_100", "pfamily", "no_play", "qtr", "game_seconds_remaining",
            "score_differential", "offense_timeouts", "defense_timeouts")
    for snap_id, r in enumerate(df.select(*keep, "fouls", "posteam", "defteam").iter_rows(named=True)):
        fl = fouls_of(r["fouls"] or [], r["posteam"], r["defteam"])
        base = {k: r[k] for k in keep}
        base["snap"] = True
        base["snap_id"] = snap_id
        if not fl:
            rows.append({**base, "ptype": None, "side": None, "status": None, "yards": 0})
            continue
        for i, (ptype, side, status, yards) in enumerate(fl):
            # Only the first row of a snap counts as the snap; the rest carry extra fouls.
            rows.append({**base, "snap": i == 0, "ptype": ptype, "side": side, "status": status, "yards": yards})
    schema = {
        "season": pl.Int64, "down": pl.Float64, "ydstogo": pl.Float64, "yardline_100": pl.Float64,
        "qtr": pl.Float64, "game_seconds_remaining": pl.Float64, "score_differential": pl.Float64,
        "offense_timeouts": pl.Float64, "defense_timeouts": pl.Float64,
        "pfamily": pl.String, "no_play": pl.Boolean, "snap": pl.Boolean, "snap_id": pl.Int64, "ptype": pl.String,
        "side": pl.String, "status": pl.String, "yards": pl.Int64,
    }
    return pl.DataFrame(rows, schema=schema)


def duration_check(raw: pl.DataFrame) -> dict[str, float] | None:
    """Measured duration vs the game clock change to the next snap, on incompletions without a
    foul followed by a snap in the same quarter: there the clock stops at the end of the play
    and starts on the snap, so the two should agree."""
    d = raw.sort(["game_id", "play_id"]).with_columns(
        nxt=pl.col("game_seconds_remaining").shift(-1).over("game_id"),
        nq=pl.col("qtr").shift(-1).over("game_id"),
    )
    d = d.filter(
        _flag("incomplete_pass") & ~_flag("penalty") & (pl.col("nq") == pl.col("qtr")) & pl.col("duration").is_not_null()
        & (pl.col("season_type") == "REG")
    ).with_columns(err=(pl.col("game_seconds_remaining") - pl.col("nxt")) - pl.col("duration"))
    if d.height == 0:
        return None
    return {
        "n": float(d.height),
        "medianError": float(d["err"].median() or 0.0),
        "within1_5": float((d["err"].abs() <= 1.5).mean() or 0.0),
    }


@dataclass
class EngineSeason:
    season: int
    caller: Any  # pipeline.caller.load.SeasonData with the extra columns
    snaps: pl.DataFrame
    kickoffs: KickoffSummary | None
    kickoff_frame: pl.DataFrame | None
    ptypes: dict[str, int]
    duration_check: dict[str, float] | None
    games: int


def kickoff_frame(raw_full: pl.DataFrame) -> pl.DataFrame:
    """Regular-season kickoffs with what the tuning check reads, the same definitions as
    pipeline.stats.kickoff_summary (docs/DATA.md): touchback from `touchback`, fair catch from
    `kickoff_fair_catch`, a return is a named returner that is neither, and the start is the
    receiving team's own yard line on the next play when that team has the ball. Onside kicks
    are named in the description ("kicks onside")."""
    df = (
        raw_full.filter(pl.col("play_type").is_not_null())
        .sort(["game_id", "play_id"])
        .with_columns(
            next_play_type=pl.col("play_type").shift(-1).over("game_id"),
            next_posteam=pl.col("posteam").shift(-1).over("game_id"),
            next_yardline_100=pl.col("yardline_100").shift(-1).over("game_id"),
        )
    )
    k = df.filter((pl.col("season_type") == "REG") & (pl.col("play_type") == "kickoff"))
    desc = pl.col("desc").cast(pl.String).fill_null("")
    tb = _flag("touchback")
    fc = _flag("kickoff_fair_catch") if "kickoff_fair_catch" in k.columns else pl.lit(False)
    start_ok = pl.col("next_play_type").is_in(list(START_PLAY_TYPES)) & (pl.col("next_posteam") == pl.col("posteam"))
    return k.select(
        onside=desc.str.contains(r"(?i)onside"),
        recovered_by_kickers=_flag("own_kickoff_recovery") if "own_kickoff_recovery" in k.columns else pl.lit(False),
        touchback=tb,
        fair_catch=fc,
        returned=pl.col("kickoff_returner_player_id").is_not_null() & ~tb & ~fc,
        out_of_bounds=_flag("kickoff_out_of_bounds") if "kickoff_out_of_bounds" in k.columns else pl.lit(False),
        return_td=_flag("return_touchdown"),
        start=pl.when(start_ok).then(100 - pl.col("next_yardline_100")).otherwise(None),
    )


def load_season(source: Source, season: int, with_kickoffs: bool) -> EngineSeason:
    pbp = source.load_season(spec("pbp"), season)
    part = source.load_season(spec("participation"), season) if season >= caller_load.FIRST_PARTICIPATION else None
    ftn = source.load_season(spec("ftn_charting"), season) if season >= caller_load.FIRST_FTN else None
    raw = derive(pbp)
    snaps = snaps_frame(raw)
    ptypes = {t: n for t, n in snaps.filter(pl.col("ptype").is_not_null()).group_by("ptype").len().iter_rows()}
    # The caller frame: pbp with the derived columns joined back by (game_id, play_id).
    derived = raw.select("game_id", "play_id", *[c for c in EXTRA_COLS if c in raw.columns and c not in pbp.columns])
    joined = pbp.join(derived, on=["game_id", "play_id"], how="left")
    with caller_columns(EXTRA_COLS):
        sd = caller_load.build_season(season, joined, part, ftn)
    ko = kickoff_summary(pbp.filter(pl.col("season_type") == "REG")) if with_kickoffs else None
    kf = kickoff_frame(pbp) if with_kickoffs else None
    games = raw.filter(pl.col("season_type") == "REG")["game_id"].n_unique()
    return EngineSeason(season, sd, snaps, ko, kf, ptypes, duration_check(raw), games)


def load_all(source: Source, seasons: list[int], log: Any = None) -> list[EngineSeason]:
    out: list[EngineSeason] = []
    for s in seasons:
        if log:
            log(f"loading {s}")
        out.append(load_season(source, s, with_kickoffs=s >= 2024))
    return out
