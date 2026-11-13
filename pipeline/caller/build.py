"""One command rebuilds every generated caller file and docs/CALLER_REPORT.md from the cache.

    uv run --project pipeline python -m pipeline.caller [--skip-validation]

Writes data/caller/offense.table.json, defense.table.json, golden.json, validation.json and
docs/CALLER_REPORT.md. Exits 1 when a gated validation metric fails (after writing
everything), 2 when the cache is not usable, 3 on an unmapped value.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any

import polars as pl

from pipeline.caller import diagnostics as diag
from pipeline.caller.config import (
    DEFENSE_FACTORS,
    DEFENSE_TABLE,
    GOLDEN,
    OFFENSE_FACTORS,
    OFFENSE_TABLE,
    OUT_DIR,
    REPO,
    REPORT_PATH,
    VALIDATION,
    code_hash,
    file_sha,
    load_inputs,
)
from pipeline.caller.fit import fit_factor
from pipeline.caller.frames import add_labels, add_try_call, factor_frames
from pipeline.caller.golden import build_golden
from pipeline.caller.load import EXCLUSION_REASONS, Source, load_all
from pipeline.caller.mapping import (
    UnmappedValues,
    add_mapped_columns,
    check_unmapped,
    parse_personnel,
    personnel_frame,
    personnel_pattern,
)
from pipeline.caller.report import render
from pipeline.caller.shares import Caller
from pipeline.caller.validate import run_validation, summary

FIRST_SEASON = 2016
LAST_SEASON = 2025


def _log(message: str) -> None:
    print(f"[caller] {message}", file=sys.stderr, flush=True)


def dumps(obj: Any) -> str:
    """Indented JSON with arrays of scalars kept on one line. Deterministic."""
    text = json.dumps(obj, indent=2, ensure_ascii=False)
    text = re.sub(r"\[\s*([^\[\]{}]*?)\s*\]", lambda m: "[" + re.sub(r",\s+", ",", m.group(1)) + "]", text)
    return text + "\n"


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def prepare_ot_plays(seasons_data: list[Any], cfg: dict[str, Any]) -> pl.DataFrame | None:
    """Step 5b: overtime scrimmage plays, prepared exactly like the rest, for oTop and o4Top's
    lateTime levels only."""
    frames = [sd.ot_plays for sd in seasons_data if getattr(sd, "ot_plays", None) is not None and sd.ot_plays.height]
    if not frames:
        return None
    return prepare_plays(seasons_data, cfg, frames)


def prepare_plays(seasons_data: list[Any], cfg: dict[str, Any], frames: list[pl.DataFrame] | None = None) -> pl.DataFrame:
    plays = pl.concat(frames if frames is not None else [sd.plays for sd in seasons_data], how="diagonal_relaxed")
    off = personnel_frame(plays["offense_personnel"], cfg, "off")
    de = personnel_frame(plays["defense_personnel"], cfg, "def")
    plays = plays.join(off, on="offense_personnel", how="left").join(de, on="defense_personnel", how="left")
    plays = add_labels(plays, cfg["dimensions"])
    plays = add_try_call(add_mapped_columns(plays, cfg))
    return plays


def observed_values(seasons_data: list[Any]) -> dict[str, Counter[str]]:
    out: dict[str, Counter[str]] = {
        "offense_formation": Counter(),
        "defense_coverage_type": Counter(),
        "defense_man_zone_type": Counter(),
        "personnel token": Counter(),
    }
    for sd in seasons_data:
        out["offense_formation"].update(sd.formation_values)
        out["defense_coverage_type"].update(sd.coverage_values)
        out["defense_man_zone_type"].update(sd.man_zone_values)
        out["personnel token"].update(sd.personnel_tokens)
    return out


def fit_all(plays: pl.DataFrame, cfg: dict[str, Any], ot: pl.DataFrame | None = None) -> dict[str, dict[str, Any]]:
    s = cfg["seasons"]
    frames = factor_frames(plays, cfg)
    if ot is not None:
        # Overtime rows join oTop and o4Top only; fit_factor lets them into lateTime levels only.
        ot_frames = factor_frames(ot, cfg)
        for fid in ("oTop", "o4Top"):
            frames[fid] = pl.concat([frames[fid].with_columns(is_ot=pl.lit(False)), ot_frames[fid].with_columns(is_ot=pl.lit(True))], how="diagonal_relaxed")
    return {
        fid: fit_factor(frames[fid], cfg["factors"][fid], s["weightAnchor"], s["halfLifeSeasons"], s["neverTrainFrom"])
        for fid in cfg["factors"]
    }


def tables_for(side: str, factors: tuple[str, ...], fitted: dict[str, Any], cfg: dict[str, Any], config_hash: str) -> dict[str, Any]:
    return {
        "generated": True,
        "side": side,
        "configVersion": cfg["version"],
        "configHash": config_hash,
        "halfLifeSeasons": cfg["seasons"]["halfLifeSeasons"],
        "weightAnchor": cfg["seasons"]["weightAnchor"],
        "factors": {fid: fitted[fid] for fid in factors},
    }


def build(
    source: Source,
    root: Path = REPO,
    *,
    validate: bool = True,
    nflreadpy_version: str = "?",
    log: Callable[[str], None] = _log,
) -> int:
    inputs = load_inputs(root)
    cfg = inputs.config
    seasons_data = load_all(source, list(range(FIRST_SEASON, LAST_SEASON + 1)), log)
    try:
        check_unmapped(observed_values(seasons_data), cfg)
    except UnmappedValues as e:
        print(str(e), file=sys.stderr)
        return 3
    log("mapping and binning")
    plays = prepare_plays(seasons_data, cfg)
    ot_plays = prepare_ot_plays(seasons_data, cfg)
    log("fitting")
    fitted = fit_all(plays, cfg, ot_plays)
    offense = tables_for("offense", OFFENSE_FACTORS, fitted, cfg, inputs.config_hash)
    defense = tables_for("defense", DEFENSE_FACTORS, fitted, cfg, inputs.config_hash)
    out_dir = root / OUT_DIR
    texts = {OFFENSE_TABLE: dumps(offense), DEFENSE_TABLE: dumps(defense)}
    for name, text in texts.items():
        write_atomic(out_dir / name, text)

    caller = Caller(inputs.catalog, cfg, offense, defense)
    log("golden file")
    golden, coverage = build_golden(caller)
    write_atomic(
        out_dir / GOLDEN,
        '{\n  "generated": true,\n  "configVersion": ' + str(cfg["version"]) + ',\n  "configHash": "' + inputs.config_hash + '",\n  "situations": [\n'
        + ",\n".join("    " + json.dumps(g, separators=(",", ":")) for g in golden)
        + "\n  ]\n}\n",
    )

    log("diagnostics")
    tokens = cfg["offenseMapping"]["personnelTokens"]
    groups = cfg["defenseMapping"]["groups"]

    def def_target(text: str) -> str:
        db = parse_personnel(text, tokens).get("DB", 0)
        if db <= groups["goalLineMaxDB"]:
            return "Goal Line group"
        if db >= groups["preventMinDB"]:
            return "Prevent group"
        return {groups["base"]: "Base", groups["nickel"]: "Nickel", groups["dime"]: "Dime"}[db]

    def off_pattern(text: str) -> str:
        c = parse_personnel(text, tokens)
        return f"OL{c.get('OL', 0)} TE{c.get('TE', 0)}"

    def off_target(text: str) -> str:
        c = parse_personnel(text, tokens)
        h = cfg["offenseMapping"]["heavyPersonnel"]
        return "Heavy" if c.get("OL", 0) >= h["minOL"] or c.get("TE", 0) >= h["minTE"] else "by alignment"

    part_seasons = [sd for sd in seasons_data if sd.formation_values]
    cov_seasons = [sd for sd in part_seasons if sd.season >= 2018]
    scrim = pl.col("phase") == "scrimmage"
    runpass = pl.col("call").is_in(["run", "pass"])
    report: dict[str, Any] = {
        "configHash": inputs.config_hash,
        "tolerancesHash": inputs.tolerances_hash,
        "codeHash": code_hash(),
        "tolerances": inputs.tolerances,
        "nflreadpy": nflreadpy_version,
        "seasonsLoaded": f"{FIRST_SEASON}-{LAST_SEASON}",
        "exclusionReasons": list(EXCLUSION_REASONS),
        "exclusions": {sd.season: sd.exclusions for sd in seasons_data},
        "inScope": {
            s: {"scrimmage": int(n_s), "try": int(n_t)}
            for s, n_s, n_t in plays.group_by("season")
            .agg(n_s=(pl.col("phase") == "scrimmage").sum(), n_t=(pl.col("phase") == "try").sum())
            .sort("season")
            .iter_rows()
        },
        "values": {
            "formation": diag.value_table(part_seasons, "formation_values", cfg["offenseMapping"]["formation"]),
            "coverage": diag.value_table(cov_seasons, "coverage_values", cfg["defenseMapping"]["coverage"]),
            "manZone": diag.value_table(cov_seasons, "man_zone_values", cfg["defenseMapping"]["manZone"]),
            "tokens": diag.value_table(part_seasons, "personnel_tokens", tokens),
            "defensePatterns": diag.personnel_patterns(
                part_seasons, "defense_personnel", lambda t: personnel_pattern(parse_personnel(t, tokens)), def_target
            ),
            "offensePatterns": diag.personnel_patterns(part_seasons, "offense_personnel", off_pattern, off_target),
        },
        "coveragePresence": diag.coverage_presence(plays),
        "blitz": diag.blitz_runs_vs_dropbacks(plays),
        "sneak": diag.sneak_agreement(plays, cfg),
        "mismatch": diag.defense_mismatch(plays, cfg),
        "mixes": {
            "Offense formation, run and pass plays (%)": diag.mix_by_season(plays, "formation", scrim & runpass),
            "Defense preset, mapped run and pass plays, 2018-2025 (%)": diag.mix_by_season(
                plays.filter(pl.col("season") >= 2018), "preset", scrim & runpass
            ),
            "Defense front, run and pass plays, 2018-2025 (%)": diag.mix_by_season(
                plays.filter(pl.col("season") >= 2018), "front", scrim & runpass
            ),
        },
        "fit": {
            fid: {
                "seasons": t["seasons"],
                "plays": t["plays"],
                "minPlays": t["minPlays"],
                "cells": [len(c) for c in t["cells"]],
            }
            for fid, t in fitted.items()
        },
        "weights": {
            s: w for s, w in sorted(fitted["oTop"]["seasonWeights"].items())
        },
        "anchor": cfg["seasons"]["weightAnchor"],
        "halfLife": cfg["seasons"]["halfLifeSeasons"],
        "tableSizes": {k: len(v.encode("utf-8")) for k, v in texts.items()},
        "tableBytes": sum(len(v.encode("utf-8")) for v in texts.values()),
        "golden": {"n": len(golden), "coverage": coverage},
        "backoff": {},
    }

    # Step 5a: late-window cell counts (A5) and the in-sample late-game checks (B5, B6).
    from pipeline.caller.frames import factor_frames
    from pipeline.caller.late import late_checks, late_counts

    late_path = root / "data/caller/latechecks.json"
    late_thr = json.loads(late_path.read_text(encoding="utf-8")) if late_path.exists() else None
    if late_thr is not None and "scoreLateOnly" in cfg["dimensions"]:
        report["lateCounts"] = late_counts(factor_frames(plays, cfg), cfg["factors"]["o4Top"]["minPlays"])
        if "lateTime" in cfg["dimensions"]:
            from pipeline.caller.late import candidate_counts

            frames_all = factor_frames(plays if ot_plays is None else pl.concat([plays, ot_plays], how="diagonal_relaxed"), cfg)
            report["candidateCounts"] = candidate_counts(frames_all, cfg["factors"]["o4Top"]["minPlays"])
        from pipeline.caller.validate import _approved

        report["lateChecks"] = late_checks(plays.filter(pl.col("season").is_between(2016, 2023)), caller, late_thr, True, (2021, 2023),
                                           _approved(inputs.tolerances, "insample"))
        if "kneelOut" in cfg["dimensions"]:
            # Step 5b B9, appended after the 5a rows.
            from pipeline.caller.late import checks_5b

            report["lateChecks5b"] = checks_5b(plays, ot_plays, caller, late_thr)

    # In-sample check on training seasons only, available before any holdout run.
    log("training-data check")
    report["trainingCheck"] = {
        label: run_validation(
            plays.filter(pl.col("season").is_between(lo, hi) & (pl.col("phase") == "scrimmage")), caller, inputs.tolerances, "insample"
        )
        for label, lo, hi in (("2016-2023", 2016, 2023), ("2021-2023", 2021, 2023))
    }

    code = 0
    if not validate:
        # The tables just changed and were not validated: never leave a summary behind that
        # describes other tables. CI fails until a full run writes a new one.
        stale = out_dir / VALIDATION
        if stale.exists():
            stale.unlink()
            log(f"removed {OUT_DIR}/{VALIDATION}: the new tables are not validated")
    if validate:
        log("validation")
        holdout = cfg["seasons"]["holdout"]
        v = run_validation(plays.filter(pl.col("season").is_in(holdout)), caller, inputs.tolerances)
        report["validation"] = v
        report["backoff"] = v.backoff
        if late_thr is not None and "scoreLateOnly" in cfg["dimensions"]:
            report["lateHoldout"] = late_checks(plays.filter(pl.col("season").is_in(holdout)), caller, late_thr, False, None)
        hashes = {name: file_sha((out_dir / name).read_bytes()) for name in (OFFENSE_TABLE, DEFENSE_TABLE, GOLDEN)}
        write_atomic(
            out_dir / VALIDATION,
            dumps(summary(v, inputs.config_hash, inputs.tolerances_hash, holdout, code_hash(), hashes, cfg["version"])),
        )
        if v.gated_failures:
            code = 1
            log(f"gate FAILED: {', '.join(m.id for m in v.gated_failures)}")
    write_atomic(root / REPORT_PATH, render(report))
    log(f"wrote {OUT_DIR}/ and {REPORT_PATH}")
    return code


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    from pipeline import cache

    path = cache.cache_dir()
    try:
        cache.prepare(path)
    except cache.CacheNotWritable as e:
        print(str(e), file=sys.stderr)
        return 2
    from pipeline.sources import NflreadpySource

    source = NflreadpySource(path)
    return build(source, validate="--skip-validation" not in args, nflreadpy_version=source.version)
