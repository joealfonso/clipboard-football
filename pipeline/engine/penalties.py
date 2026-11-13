"""Penalty rates per snap (fitted) for every penalty id the rule set supports, and the gap left
by the real fouls it does not support.

Every foul named in a play description counts once, accepted, declined or offsetting (the
machine decides acceptance). The mapping from pbp's penalty type text to a rule set id is
designed (data/engine/config.json penalties.mapping); a type missing from it fails the build
with its name and count, never silently dropped.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

import polars as pl

from pipeline.caller.bins import bin_situation
from pipeline.engine.fit import check_holdout, histogram

KICK_FAMILIES = ("punt", "fieldGoal", "extraPoint")
SCRIMMAGE = ("run", "pass")


class UnmappedPenalties(Exception):
    def __init__(self, missing: Counter[str]) -> None:
        self.missing = missing
        lines = [f"{k!r} ({n} fouls)" for k, n in sorted(missing.items(), key=lambda kv: (-kv[1], kv[0]))]
        super().__init__("Unmapped penalty types, add them to data/engine/config.json penalties.mapping:\n  " + "\n  ".join(lines))


def check_mapping(counts: Counter[str], cfg: dict[str, Any]) -> None:
    mapping = cfg["penalties"]["mapping"]
    missing = Counter({k: n for k, n in counts.items() if k not in mapping})
    if missing:
        raise UnmappedPenalties(missing)


def foul_id_expr(cfg: dict[str, Any]) -> pl.Expr:
    """pbp type -> rule set id, with the designed split of Unnecessary Roughness."""
    pc = cfg["penalties"]
    base = pl.col("ptype").replace_strict(pc["mapping"], default=None, return_dtype=pl.String)
    out = base
    for pid, split in pc["splitByPlay"].items():
        out = pl.when(base == pid).then(
            pl.when(pl.col("no_play")).then(pl.lit(split["noPlay"])).otherwise(pl.lit(split["playStands"]))
        ).otherwise(out)
    for ptype, rule in pc["byFamily"].items():
        hit = (pl.col("ptype") == ptype) & pl.col("pfamily").is_in(rule["families"]) & (pl.col("side") == rule["side"])
        out = pl.when(hit).then(pl.lit(rule["id"])).otherwise(out)
    return out


def labelled(snaps: pl.DataFrame, dims: dict[str, Any]) -> pl.DataFrame:
    """Adds b_down and b_dist3 (the step 2 bins) to each snap."""
    uniq = snaps.select("down", "ydstogo").unique()
    down, dist = [], []
    for d, ytg in uniq.iter_rows():
        if d is None or ytg is None or ytg < 1:
            down.append(None)
            dist.append(None)
            continue
        sit = {"phase": "scrimmage", "down": int(d), "yardsToGo": int(ytg)}
        lab = bin_situation(sit, {"down": dims["down"], "dist3": dims["dist3"]})
        down.append(lab["down"])
        dist.append(lab["dist3"])
    lab = uniq.with_columns(b_down=pl.Series(down, dtype=pl.String), b_dist3=pl.Series(dist, dtype=pl.String))
    return snaps.join(lab, on=["down", "ydstogo"], how="left", nulls_equal=True)


def pre_snap_ids(rules: dict[str, Any]) -> list[str]:
    return [k for k, v in rules["penalties"].items() if v["timing"] == "preSnap"]


def fit_penalties(snaps: pl.DataFrame, cfg: dict[str, Any], rules: dict[str, Any], dims: dict[str, Any], never_from: int) -> dict[str, Any]:
    """Rates per 1,000,000 snaps per cell, for every supported id. `snaps` has one row per
    foul (plus one per clean snap) with `w` set. Each snap counts once, in one category: no
    supported foul; fouls by both teams (run and pass snaps only, the separate both-teams rate);
    or a one-team foul, named by its first supported foul. So the engine's one-draw-per-snap
    emission reproduces the share of snaps with a flag. Pre-snap fouls on a run or pass snap are
    fitted on run and pass snaps together (a pre-snap foul has no play to classify) and stored
    under both. Kneels and spikes take the run and pass pre-snap rates."""
    check_holdout(snaps, never_from)
    pc = cfg["penalties"]
    ids = list(rules["penalties"])
    pre = set(pre_snap_ids(rules))
    s = labelled(snaps.with_row_index("_row"), dims).with_columns(pid=foul_id_expr(cfg))
    foul_rows = s
    # Scrimmage-group rows: run, pass, and pre-snap rows whose family is unknown.
    s = s.with_columns(
        group=pl.when(pl.col("pfamily").is_in(["run", "pass", "scrimmage", "twoPoint", "kneel", "spike"]))
        .then(pl.lit("scrimmage"))
        .otherwise(pl.col("pfamily"))
    )
    levels = pc["levels"]
    cats = snap_categories(s)
    s = s.filter(pl.col("snap")).join(cats, on=["season", "snap_id"], how="left")

    def rates_for(frame: pl.DataFrame, fam_value: str, keep: set[str] | None) -> list[dict[str, list[int]]]:
        out: list[dict[str, list[int]]] = []
        for level in levels:
            dims_ = [d for d in level["dims"] if d != "pfamily"]
            parts = [pl.lit(fam_value)] + [pl.col(f"b_{d}") for d in dims_]
            k = frame.with_columns(_key=pl.concat_str(parts, separator="|")).filter(pl.col("_key").is_not_null())
            snaps_w = k.group_by("_key").agg(w=pl.col("w").sum(), n=pl.len())
            fouls_w = k.filter(pl.col("cat").is_not_null() & (pl.col("cat") != "double")).group_by("_key", "cat").agg(w=pl.col("w").sum())
            fw: dict[tuple[str, str], float] = {(a, b): c for a, b, c in fouls_w.iter_rows()}
            cells: dict[str, list[int]] = {}
            for key, w, n in sorted(snaps_w.iter_rows()):
                if n < pc["minSnaps"]:
                    continue
                cells[key] = [
                    int(round(1_000_000 * fw.get((key, pid), 0.0) / w)) if (keep is None or pid in keep) else 0
                    for pid in ids
                ]
            out.append(cells)
        return out

    by_family: dict[str, list[dict[str, list[int]]]] = {}
    scrim = s.filter(pl.col("group") == "scrimmage")
    pre_cells = rates_for(scrim, "scrimmage", pre)
    for fam in SCRIMMAGE:
        live = rates_for(scrim.filter(pl.col("pfamily") == fam), fam, set(ids) - pre)
        merged: list[dict[str, list[int]]] = []
        # A cell is stored where either part has enough snaps: the live part from the family's
        # own cell or its family-level cell, the pre-snap part from the scrimmage-group cell or
        # its group-level cell. (Before post-validation revision 7, a pre-snap cell was dropped
        # whenever the family's live cell was missing, which under-predicted pre-snap fouls in
        # 3rd-and-long and 4th-down cells.)
        live_top = live[-1][fam]
        pre_top = pre_cells[-1]["scrimmage"]
        for lc, pcells in zip(live, pre_cells):
            cells: dict[str, list[int]] = {}
            keys = set(lc) | {fam + k[len("scrimmage"):] for k in pcells}
            for key in sorted(keys):
                pkey = "scrimmage" + key[len(fam):]
                lv_vals = lc.get(key) or live_top
                pv = pcells.get(pkey) or pre_top
                cells[key] = [a + b for a, b in zip(lv_vals, pv)]
            merged.append(cells)
        by_family[fam] = merged
    for fam in KICK_FAMILIES:
        by_family[fam] = rates_for(s.filter(pl.col("pfamily") == fam), fam, None)
    # Kneels and spikes: the run and pass pre-snap rates, at the family level only.
    by_family["clock"] = [*[{} for _ in levels[:-1]], {"clock": pre_cells[-1]["scrimmage"]}]
    # Fouls by both teams on one run or pass snap (supported fouls, any status), per 1,000,000 snaps.
    rp = s.filter(pl.col("pfamily").is_in(list(SCRIMMAGE)))
    total_w = rp["w"].sum()
    double_w = rp.filter(pl.col("cat") == "double")["w"].sum()
    share: dict[str, int] = {}
    for pid in ids:
        if rules["penalties"][pid]["committedBy"] != "either":
            continue
        sub = foul_rows.filter((pl.col("pid") == pid) & pl.col("side").is_in(["offense", "defense"]))
        den = sub["w"].sum()
        share[pid] = int(round(10000 * sub.filter(pl.col("side") == "offense")["w"].sum() / den)) if den else 5000
    return {
        "ids": ids,
        "levels": levels,
        "offenseSharePer10000": share,
        "families": {k: v for k, v in by_family.items()},
        "doublePer1000000": int(round(1_000_000 * double_w / total_w)) if total_w else 0,
        "snaps": snaps.filter(pl.col("snap")).height,
    }


def snap_categories(s: pl.DataFrame) -> pl.DataFrame:
    """(season, snap_id, cat): cat is "double" for supported fouls by both teams on a run or
    pass snap, else the snap's first supported foul (row order is the description's order),
    null for a snap with none."""
    if "_row" not in s.columns:
        s = s.with_row_index("_row")
    sup = s.filter(pl.col("pid").is_not_null() & (pl.col("pid") != "unsupported"))
    g = sup.sort("_row").group_by("season", "snap_id", maintain_order=True).agg(
        first=pl.col("pid").first(),
        sides=pl.col("side").drop_nulls().unique(),
        fam=pl.col("pfamily").first(),
    )
    both = pl.col("sides").list.contains("offense") & pl.col("sides").list.contains("defense") & pl.col("fam").is_in(list(SCRIMMAGE))
    return g.select("season", "snap_id", cat=pl.when(both).then(pl.lit("double")).otherwise(pl.col("first")))


def dpi_yards(snaps_desc: pl.DataFrame, lo: int, hi: int) -> list[int]:
    """Histogram of enforced defensive pass interference yards (yards from the line to the
    spot of the foul), lo..hi."""
    ys = snaps_desc["yards"].to_list()
    ws = snaps_desc["w"].to_list()
    return histogram([int(y) for y in ys], ws, lo, hi)


YARDS_RX = re.compile(r"(\d+) yards?")


def gap_report(snaps: pl.DataFrame, cfg: dict[str, Any], games: int) -> dict[str, Any]:
    """Fouls the rule set does not support, by type: count, enforced count, enforced yards and
    rates per snap and per game, plus the same totals for supported fouls."""
    s = snaps.with_columns(pid=foul_id_expr(cfg))
    n_snaps = s.filter(pl.col("snap")).height
    by = (
        s.filter(pl.col("pid").is_not_null())
        .with_columns(sup=pl.col("pid") != "unsupported")
        .group_by("sup", "ptype")
        .agg(n=pl.len(), enforced=(pl.col("status") == "enforced").sum(), yards=pl.col("yards").sum())
        .sort(["sup", "n"], descending=[False, True])
    )
    rows = [
        {"type": t, "supported": bool(sup), "fouls": int(n), "enforced": int(e), "yards": int(y),
         "perSnap": n / n_snaps if n_snaps else 0.0, "yardsPerGame": y / games if games else 0.0}
        for sup, t, n, e, y in by.iter_rows()
    ]
    def total(flag: bool, key: str) -> float:
        return sum(r[key] for r in rows if r["supported"] == flag)
    return {
        "snaps": n_snaps,
        "games": games,
        "rows": rows,
        "unsupportedYardsPerGame": total(False, "yardsPerGame"),
        "supportedYardsPerGame": total(True, "yardsPerGame"),
    }
