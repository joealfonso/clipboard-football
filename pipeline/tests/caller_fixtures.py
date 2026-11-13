"""Hand-made frames and a stub source for the caller pipeline tests."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import polars as pl

from pipeline.caller.config import REPO
from pipeline.tables import TableSpec

PLAYER_ID = "00-0099999"
PLAYER_NAME = "Zebulon Quarterback"

# One mapped-play row with every column add_mapped_columns reads, set to a plain 1st-and-10
# handoff. Tests override what they need.
BASE_ROW: dict[str, Any] = {
    "season": 2020,
    "phase": "scrimmage",
    "play_type": "run",
    "down": 1.0,
    "ydstogo": 10.0,
    "yardline_100": 75.0,
    "qb_dropback": 0.0,
    "qb_scramble": 0.0,
    "qb_spike": 0.0,
    "qb_kneel": 0.0,
    "air_yards": None,
    "run_location": "left",
    "run_gap": "tackle",
    "rusher_threw": False,
    "ftn_present": False,
    "is_screen_pass": None,
    "is_play_action": None,
    "is_qb_sneak": None,
    "offense_formation": "SINGLEBACK",
    "off_ol": 5,
    "off_te": 1,
    "def_db": 4,
    "defenders_in_box": 7.0,
    "number_of_pass_rushers": 4.0,
    "defense_coverage_type": "COVER_3",
    "defense_man_zone_type": "ZONE_COVERAGE",
}

SCHEMA = {
    "season": pl.Int64, "phase": pl.String, "play_type": pl.String, "down": pl.Float64,
    "ydstogo": pl.Float64, "yardline_100": pl.Float64, "qb_dropback": pl.Float64,
    "qb_scramble": pl.Float64, "qb_spike": pl.Float64, "qb_kneel": pl.Float64,
    "air_yards": pl.Float64, "run_location": pl.String, "run_gap": pl.String,
    "rusher_threw": pl.Boolean, "ftn_present": pl.Boolean, "is_screen_pass": pl.Boolean,
    "is_play_action": pl.Boolean, "is_qb_sneak": pl.Boolean, "offense_formation": pl.String,
    "off_ol": pl.Int64, "off_te": pl.Int64, "def_db": pl.Int64, "defenders_in_box": pl.Float64,
    "number_of_pass_rushers": pl.Float64, "defense_coverage_type": pl.String,
    "defense_man_zone_type": pl.String,
}


def frame(*overrides: dict[str, Any]) -> pl.DataFrame:
    return pl.DataFrame([{**BASE_ROW, **o} for o in overrides], schema=SCHEMA)


def raw_config() -> dict[str, Any]:
    return json.loads((REPO / "data/caller/config.json").read_text())


def config() -> dict[str, Any]:
    """The real config as every loader sees it: with the rule set's play clock (step 5b)."""
    from pipeline.caller.config import rules_json, with_rule_play_clock

    return with_rule_play_clock(raw_config(), rules_json())


# ------------------------------------------------------------------ stub source


def _seasonal_rows(season: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Synthetic pbp, participation and FTN rows covering every mapping path."""
    pbp: list[dict[str, Any]] = []
    part: list[dict[str, Any]] = []
    ftn: list[dict[str, Any]] = []
    game = f"{season}_01_AAA_BBB"
    kinds = ["run", "pass", "pass", "run", "punt", "field_goal", "qb_kneel", "qb_spike", "scramble", "pass"]
    old = season < 2023
    for i in range(120):
        kind = kinds[i % len(kinds)]
        qtr = 1 + (i // 7) % 4
        half = (1500, 100, 30)[i % 3]
        down = 4 if kind in ("punt", "field_goal") else 1 + i % 3
        play_type = {"scramble": "run"}.get(kind, kind)
        row = {
            "game_id": game, "play_id": float(10 + i * 10), "season": season, "season_type": "REG",
            "play_type": play_type, "down": float(down), "ydstogo": float((1, 2, 5, 10, 15)[i % 5]),
            "yardline_100": float((3, 15, 30, 45, 70, 95)[i % 6]),
            "score_differential": float((-20, -5, 0, 5, 20)[(i // 3) % 5]), "qtr": float(qtr),
            "half_seconds_remaining": float(half), "game_seconds_remaining": float(half + (1800 if qtr <= 2 else 0)),
            "posteam": "AAA", "defteam": "BBB", "posteam_timeouts_remaining": float(i % 4),
            "defteam_timeouts_remaining": float((i + 1) % 4), "timeout": 0.0, "timeout_team": None,
            "qb_dropback": 1.0 if kind in ("pass", "scramble") else 0.0,
            "qb_scramble": 1.0 if kind == "scramble" else 0.0,
            "qb_spike": 1.0 if kind == "qb_spike" else 0.0, "qb_kneel": 1.0 if kind == "qb_kneel" else 0.0,
            "air_yards": float((3, 12, 25)[i % 3]) if kind == "pass" else None,
            "run_location": ("middle", "left", "right")[i % 3] if kind == "run" else None,
            "run_gap": (None, "guard", "end")[i % 3] if kind == "run" else None,
            "extra_point_attempt": 0.0, "two_point_attempt": 0.0, "aborted_play": 0.0,
            "passer_player_id": PLAYER_ID if kind == "pass" else None,
            "rusher_player_id": PLAYER_ID if kind == "run" and i % 2 == 0 else ("00-0011111" if kind == "run" else None),
            "passer_player_name": PLAYER_NAME if kind == "pass" else None,
        }
        pbp.append(row)
        part.append({
            "nflverse_game_id": game, "play_id": 10 + i * 10,
            "offense_formation": (("SHOTGUN", "SINGLEBACK", "EMPTY", "I_FORM", "PISTOL") if old else ("SHOTGUN", "UNDER CENTER", "PISTOL"))[i % (5 if old else 3)],
            "offense_personnel": ("1 RB, 1 TE, 3 WR" if old else "1 C, 2 G, 1 QB, 1 RB, 2 T, 1 TE, 3 WR") if i % 9 else ("6 OL, 1 RB, 2 TE, 1 WR" if old else "1 C, 2 G, 1 QB, 1 RB, 2 T, 3 TE"),
            "defense_personnel": ("4 DL, 2 LB, 5 DB", "4 DL, 3 LB, 4 DB", "3 DL, 2 LB, 6 DB", "5 DL, 3 LB, 3 DB", "2 DL, 2 LB, 7 DB")[i % 5] if old else ("3 CB, 2 DE, 2 DT, 1 FS, 2 ILB, 1 SS", "2 CB, 2 DE, 2 DT, 1 FS, 3 ILB, 1 SS")[i % 2],
            "defenders_in_box": (6, 7, 8)[i % 3], "number_of_pass_rushers": (4, 5, 6)[i % 3] if kind == "pass" else 0,
            "defense_coverage_type": ("COVER_1", "COVER_3", "COVER_2", "2_MAN", "COVER_4", "COVER_0", "COVER_6")[i % 7] if kind == "pass" else None,
            "defense_man_zone_type": ("MAN_COVERAGE", "ZONE_COVERAGE")[i % 2] if kind == "pass" else ("" if not old else None),
            "offense_names": PLAYER_NAME,
        })
        if season >= 2022:
            ftn.append({
                "nflverse_game_id": game, "nflverse_play_id": 10 + i * 10,
                "is_screen_pass": i % 11 == 0, "is_play_action": i % 7 == 0,
                "is_qb_sneak": kind == "run" and i % 13 == 0, "n_blitzers": i % 2,
            })
    # Tries: extra points and two-point runs and passes, plus one of each exclusion.
    for j in range(24):
        pid = 5000.0 + j * 10
        two = j % 3 == 0
        kind = ("run", "pass")[j % 2] if two else "extra_point"
        pbp.append({
            "game_id": game, "play_id": pid, "season": season, "season_type": "REG", "play_type": kind,
            "down": None, "ydstogo": 0.0, "yardline_100": 2.0 if two else 15.0,
            "score_differential": float((-8, -1, 0, 6, 13)[j % 5]), "qtr": float(1 + j % 4),
            "half_seconds_remaining": 600.0, "game_seconds_remaining": 600.0 + (1800 if j % 4 < 2 else 0),
            "posteam": "AAA", "defteam": "BBB", "posteam_timeouts_remaining": 2.0, "defteam_timeouts_remaining": 2.0,
            "timeout": 0.0, "timeout_team": None, "qb_dropback": 1.0 if kind == "pass" else 0.0, "qb_scramble": 0.0,
            "qb_spike": 0.0, "qb_kneel": 0.0, "air_yards": 4.0 if kind == "pass" else None,
            "run_location": "middle" if kind == "run" else None, "run_gap": None,
            "extra_point_attempt": 0.0 if two else 1.0, "two_point_attempt": 1.0 if two else 0.0, "aborted_play": 0.0,
            "passer_player_id": None, "rusher_player_id": None, "passer_player_name": None,
        })
    for reason, extra in (("post", {"season_type": "POST"}), ("ot", {"qtr": 5.0}), ("np", {"play_type": "no_play"}), ("ab", {"aborted_play": 1.0})):
        pbp.append({**pbp[0], "play_id": 9000.0 + len(reason) + len(pbp), **extra})
    return pbp, part, ftn


class CallerStubSource:
    def __init__(self, extra_formation: str | None = None) -> None:
        self.extra_formation = extra_formation

    def load_season(self, spec: TableSpec, season: int) -> pl.DataFrame:
        pbp, part, ftn = _seasonal_rows(season)
        if spec.key == "pbp":
            return pl.DataFrame(pbp, infer_schema_length=None)
        if spec.key == "participation":
            if self.extra_formation and season == 2019:
                part[0]["offense_formation"] = self.extra_formation
            return pl.DataFrame(part, infer_schema_length=None)
        return pl.DataFrame(ftn, infer_schema_length=None)


def make_root(tmp: Path, *, min_plays: int = 1, tolerance: float | None = None) -> Path:
    """A repo-shaped temp root with the real catalog and config, minPlays lowered so the
    tiny stub data fills every factor."""
    (tmp / "data/calls").mkdir(parents=True)
    (tmp / "data/caller").mkdir(parents=True)
    (tmp / "docs").mkdir()
    (tmp / "data/rules").mkdir(parents=True)
    shutil.copy(REPO / "data/calls/catalog.json", tmp / "data/calls/catalog.json")
    shutil.copy(REPO / "data/rules/nfl-2026.json", tmp / "data/rules/nfl-2026.json")
    cfg = raw_config()
    for f in cfg["factors"].values():
        f["minPlays"] = min_plays
    (tmp / "data/caller/config.json").write_text(json.dumps(cfg, indent=2))
    tol = json.loads((REPO / "data/caller/tolerances.json").read_text())
    if tolerance is not None:
        for m in tol["metrics"]:
            m["tolerance"] = tolerance
            m["minN"] = 0
    (tmp / "data/caller/tolerances.json").write_text(json.dumps(tol, indent=2))
    return tmp
