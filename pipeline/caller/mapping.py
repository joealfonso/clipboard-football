"""Designed rules that map real plays to calls, formations, fronts, coverages and presets.

Every function here takes the mapping sections of data/caller/config.json; nothing is
hard-coded except the rule structure the spec fixes. See docs/MODEL.md, "Baseline play
caller", for the rules in plain words.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

import polars as pl

SCRIMMAGE_PLAY_TYPES = ("run", "pass", "punt", "field_goal", "qb_kneel", "qb_spike")
TOKEN = re.compile(r"^\s*(\d+)\s+([A-Za-z]+)\s*$")


class UnmappedValues(Exception):
    """An observed value has no entry in a designed mapping table. Never dropped or guessed."""

    def __init__(self, missing: dict[str, Counter[str]]) -> None:
        self.missing = missing
        lines = [
            f"{table}: {value!r} ({count} rows)"
            for table, values in sorted(missing.items())
            for value, count in sorted(values.items(), key=lambda kv: (-kv[1], kv[0]))
        ]
        super().__init__("Unmapped values, add them to data/caller/config.json:\n  " + "\n  ".join(lines))


def _flag(name: str) -> pl.Expr:
    return pl.col(name).fill_null(0) == 1


# ---------------------------------------------------------------- personnel


def parse_personnel(text: str, tokens: dict[str, str]) -> dict[str, int]:
    """'1 C, 2 G, 1 QB' -> group counts via the token table. Unknown tokens raise KeyError."""
    out: dict[str, int] = {}
    for part in text.split(","):
        if not part.strip():
            continue
        m = TOKEN.match(part)
        if m is None:
            raise ValueError(f"cannot parse personnel part {part!r}")
        group = tokens[m.group(2)]
        out[group] = out.get(group, 0) + int(m.group(1))
    return out


def personnel_tokens(values: pl.Series) -> Counter[str]:
    """Position tokens across a personnel column, weighted by row count."""
    counts: Counter[str] = Counter()
    vc = values.drop_nulls().value_counts()
    for text, n in vc.iter_rows():
        for part in text.split(","):
            m = TOKEN.match(part)
            if m is not None:
                counts[m.group(2)] += n
            elif part.strip():
                counts[part.strip()] += n
    return counts


def personnel_pattern(counts: dict[str, int]) -> str:
    return " ".join(f"{g}{counts[g]}" for g in ("DL", "LB", "DB", "OL", "TE", "other") if counts.get(g))


def check_unmapped(observed: dict[str, Counter[str]], config: dict[str, Any]) -> None:
    """observed: table name -> value counts. Raises UnmappedValues for any value not listed."""
    tables = {
        "offense_formation": config["offenseMapping"]["formation"],
        "defense_coverage_type": config["defenseMapping"]["coverage"],
        "defense_man_zone_type": config["defenseMapping"]["manZone"],
        "personnel token": config["offenseMapping"]["personnelTokens"],
    }
    missing: dict[str, Counter[str]] = {}
    for name, counts in observed.items():
        table = tables[name]
        bad = Counter({v: n for v, n in counts.items() if v not in table})
        if bad:
            missing[name] = bad
    if missing:
        raise UnmappedValues(missing)


# ---------------------------------------------------------------- offense


def offense_call() -> pl.Expr:
    """Top-level call for a scrimmage play or a two-point try. Priority: spike, kneel,
    punt, field goal, pass (dropbacks incl. sacks and scrambles), run. Fakes go by
    play_type."""
    pt = pl.col("play_type")
    return (
        pl.when(_flag("qb_spike"))
        .then(pl.lit("spike"))
        .when(_flag("qb_kneel"))
        .then(pl.lit("kneel"))
        .when(pt == "punt")
        .then(pl.lit("punt"))
        .when(pt == "field_goal")
        .then(pl.lit("fieldGoal"))
        .when((pt == "pass") | ((pt == "run") & _flag("qb_dropback")))
        .then(pl.lit("pass"))
        .when((pt == "run") & ~_flag("qb_scramble"))
        .then(pl.lit("run"))
        .otherwise(None)
    )


def pass_type() -> pl.Expr:
    """Screen over play action over plain. Null when the pass has no FTN row."""
    return (
        pl.when((pl.col("call") != "pass").fill_null(True) | ~pl.col("ftn_present").fill_null(False))
        .then(None)
        .when(pl.col("is_screen_pass").fill_null(False))
        .then(pl.lit("screenPass"))
        .when(pl.col("is_play_action").fill_null(False))
        .then(pl.lit("playAction"))
        .otherwise(pl.lit("plain"))
    )


def depth(cfg: dict[str, Any]) -> pl.Expr:
    d = cfg["offenseMapping"]["depth"]
    ay = pl.col("air_yards")
    return (
        pl.when((pl.col("pass_type") != "plain").fill_null(True) | ay.is_null())
        .then(None)
        .when(ay < d["shortBelow"])
        .then(pl.lit("shortPass"))
        .when(ay < d["deepFrom"])
        .then(pl.lit("intermediatePass"))
        .otherwise(pl.lit("deepPass"))
    )


def inside_expr(cfg: dict[str, Any]) -> pl.Expr:
    r = cfg["offenseMapping"]["insideRun"]
    return pl.col("run_location").is_in(r["runLocation"]).fill_null(False) | pl.col("run_gap").is_in(
        r["runGap"]
    ).fill_null(False)


def outside_expr(cfg: dict[str, Any]) -> pl.Expr:
    return pl.col("run_gap").is_in(cfg["offenseMapping"]["outsideRun"]["runGap"]).fill_null(False)


def sneak_inferred(cfg: dict[str, Any]) -> pl.Expr:
    """Inferred QB sneak (used for seasons before FTN charting). Distance is ydstogo on
    scrimmage plays and the yard line on a two-point try (nflverse gives ydstogo 0 there)."""
    s = cfg["offenseMapping"]["qbSneak"]
    dist = pl.when(pl.col("phase") == "try").then(pl.col("yardline_100")).otherwise(pl.col("ydstogo"))
    return (
        (pl.col("call") == "run")
        & ~_flag("qb_scramble")
        & (dist <= s["maxYardsToGo"]).fill_null(False)
        & inside_expr(cfg)
        & pl.col("rusher_threw").fill_null(False)
    )


def run_type(cfg: dict[str, Any]) -> pl.Expr:
    """Sneak from the FTN flag from ftnFlagFromSeason on (null if the play has no FTN row),
    from the inferred rule before. Then inside, then outside; neither is unknown (null)."""
    s = cfg["offenseMapping"]["qbSneak"]
    use_ftn = pl.col("season") >= s["ftnFlagFromSeason"]
    sneak = pl.when(use_ftn).then(pl.col("is_qb_sneak").fill_null(False)).otherwise(sneak_inferred(cfg))
    return (
        pl.when((pl.col("call") != "run").fill_null(True) | (use_ftn & ~pl.col("ftn_present").fill_null(False)))
        .then(None)
        .when(sneak)
        .then(pl.lit("qbSneak"))
        .when(inside_expr(cfg))
        .then(pl.lit("insideRun"))
        .when(outside_expr(cfg))
        .then(pl.lit("outsideRun"))
        .otherwise(None)
    )


def leaf() -> pl.Expr:
    """The leaf play for the formation factor: run type, screen or play action, or depth."""
    return (
        pl.when(pl.col("call") == "run")
        .then(pl.col("run_type"))
        .when(pl.col("pass_type").is_in(["screenPass", "playAction"]))
        .then(pl.col("pass_type"))
        .when(pl.col("call") == "pass")
        .then(pl.col("depth"))
        .otherwise(None)
    )


def personnel_frame(values: pl.Series, cfg: dict[str, Any], prefix: str) -> pl.DataFrame:
    """One row per distinct personnel string with its group counts."""
    tokens = cfg["offenseMapping"]["personnelTokens"]
    texts = values.drop_nulls().unique().sort().to_list()
    rows = [parse_personnel(t, tokens) for t in texts]
    return pl.DataFrame(
        {
            values.name: texts,
            f"{prefix}_ol": [r.get("OL", 0) for r in rows],
            f"{prefix}_te": [r.get("TE", 0) for r in rows],
            f"{prefix}_db": [r.get("DB", 0) for r in rows],
            f"{prefix}_pattern": [personnel_pattern(r) for r in rows],
        },
        schema={
            values.name: pl.String,
            f"{prefix}_ol": pl.Int64,
            f"{prefix}_te": pl.Int64,
            f"{prefix}_db": pl.Int64,
            f"{prefix}_pattern": pl.String,
        },
    )


def formation(cfg: dict[str, Any]) -> pl.Expr:
    """Value table on offense_formation, then Heavy whatever the alignment when the
    personnel has minOL+ offensive linemen or minTE+ tight ends. Only on run and pass
    plays (the formation factor additionally needs a known leaf play)."""
    m = cfg["offenseMapping"]
    heavy = (pl.col("off_ol") >= m["heavyPersonnel"]["minOL"]) | (pl.col("off_te") >= m["heavyPersonnel"]["minTE"])
    base = pl.col("offense_formation").replace_strict(m["formation"], default=None, return_dtype=pl.String)
    return (
        pl.when(~pl.col("call").is_in(["run", "pass"]).fill_null(False))
        .then(None)
        .when(heavy.fill_null(False))
        .then(pl.lit("heavy"))
        .otherwise(base)
    )


# ---------------------------------------------------------------- defense


def front(cfg: dict[str, Any]) -> pl.Expr:
    """Personnel group by DB count, plus the box flag. Needs personnel and box."""
    g = cfg["defenseMapping"]["groups"]
    db = pl.col("def_db")
    heavy = pl.col("defenders_in_box") >= cfg["defenseMapping"]["boxHeavyMin"]
    box = pl.when(heavy).then(pl.lit("Heavy")).otherwise(pl.lit("Light"))
    return (
        pl.when(db.is_null() | pl.col("defenders_in_box").is_null())
        .then(None)
        .when(db <= g["goalLineMaxDB"])
        .then(pl.lit("front.goalLine"))
        .when(db >= g["preventMinDB"])
        .then(pl.lit("front.prevent"))
        .when(db == g["base"])
        .then(pl.lit("front.base") + box)
        .when(db == g["nickel"])
        .then(pl.lit("front.nickel") + box)
        .when(db == g["dime"])
        .then(pl.lit("front.dime") + box)
        .otherwise(None)
    )


def shell(cfg: dict[str, Any]) -> pl.Expr:
    return pl.col("defense_coverage_type").replace_strict(
        cfg["defenseMapping"]["coverage"], default=None, return_dtype=pl.String
    )


def man_zone(cfg: dict[str, Any]) -> pl.Expr:
    return pl.col("defense_man_zone_type").replace_strict(
        cfg["defenseMapping"]["manZone"], default=None, return_dtype=pl.String
    )


def rush_bucket(cfg: dict[str, Any]) -> pl.Expr:
    """0 or null rushers means not charted (nflverse records 0 on most non-dropbacks)."""
    r = pl.col("number_of_pass_rushers")
    return (
        pl.when(r.is_null() | (r <= 0))
        .then(None)
        .when(r >= cfg["defenseMapping"]["blitzMinRushers"])
        .then(pl.lit("ge5"))
        .otherwise(pl.lit("le4"))
    )


def coverage_target() -> pl.Expr:
    return pl.concat_str([pl.col("shell"), pl.col("man_zone"), pl.col("rush")], separator=".")


FRONT_GROUP = {
    "front.goalLine": ("goalLine", "any"),
    "front.baseLight": ("base", "light"),
    "front.baseHeavy": ("base", "heavy"),
    "front.nickelLight": ("nickel", "light"),
    "front.nickelHeavy": ("nickel", "heavy"),
    "front.dimeLight": ("dime", "light"),
    "front.dimeHeavy": ("dime", "heavy"),
    "front.prevent": ("prevent", "any"),
}


def preset_for(front_id: str, coverage: str, mapping: dict[str, Any]) -> str:
    """Mirrors presetFor in packages/sim/src/caller/defense.ts. First match wins:
    goal-line personnel, then prevent (personnel or shell), then the designed table."""
    group, box = FRONT_GROUP[front_id]
    shell_id, _, rush = coverage.split(".")
    if group == "goalLine":
        return "goalLine"
    if group == "prevent" or shell_id == "prevent":
        return "prevent"
    cell = mapping["presetTable"][group][shell_id]
    if isinstance(cell, str):
        return cell
    yes = box == "heavy" if cell["if"] == "boxHeavy" else rush == "ge5"
    return cell["then"] if yes else cell["else"]


def preset(cfg: dict[str, Any]) -> pl.Expr:
    mapping = cfg["defenseMapping"]
    pairs = {
        f"{f}#{c}": preset_for(f, c, mapping)
        for f in FRONT_GROUP
        for c in (
            f"{s}.{mz}.{r}"
            for s in ("cover0", "cover1", "cover2", "twoMan", "cover3", "cover4", "prevent")
            for mz in ("man", "zone")
            for r in ("le4", "ge5")
        )
    }
    key = pl.concat_str([pl.col("front"), pl.col("coverage")], separator="#")
    return key.replace_strict(pairs, default=None, return_dtype=pl.String)


def component_mismatches(row: dict[str, Any], mapping: dict[str, Any]) -> dict[str, bool]:
    """For a mapped play, which components differ from its preset's designed definition."""
    p = mapping["presets"][row["preset"]]
    g = mapping["groups"]
    db = row["def_db"]
    group = (
        "goalLine"
        if db <= g["goalLineMaxDB"]
        else "base"
        if db == g["base"]
        else "nickel"
        if db == g["nickel"]
        else "dime"
        if db == g["dime"]
        else "prevent"
    )
    if p["group"] == "dime+":
        group_ok = db >= g["dime"]
    else:
        group_ok = p["group"] == group
    box = "heavy" if row["defenders_in_box"] >= mapping["boxHeavyMin"] else "light"
    rushers = row["number_of_pass_rushers"]
    rush_ok = {
        "any": True,
        "le4": rushers <= 4,
        "ge5": rushers >= 5,
        "ge6": rushers >= 6,
    }[p["rush"]]
    return {
        "personnel group": not group_ok,
        "box": p["box"] != "any" and p["box"] != box,
        "shell": p["shell"] != "any" and p["shell"] != row["shell"],
        "man/zone": p["manZone"] != "any" and p["manZone"] != row["man_zone"],
        "rush": not rush_ok,
    }


def add_mapped_columns(df: pl.DataFrame, cfg: dict[str, Any]) -> pl.DataFrame:
    """Adds call, pass_type, depth, run_type, leaf, formation, front, shell, man_zone, rush,
    coverage and preset. Expects the joined play frame built by pipeline.caller.load."""
    return (
        df.with_columns(call=offense_call())
        .with_columns(pass_type=pass_type(), run_type=run_type(cfg))
        .with_columns(depth=depth(cfg))
        .with_columns(leaf=leaf())
        .with_columns(
            formation=formation(cfg),
            front=front(cfg),
            shell=shell(cfg),
            man_zone=man_zone(cfg),
            rush=rush_bucket(cfg),
        )
        .with_columns(coverage=coverage_target())
        .with_columns(preset=preset(cfg))
    )
