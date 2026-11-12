"""One command rebuilds every generated engine and player file and docs/ENGINE_REPORT.md from
the cache.

    uv run --project pipeline python -m pipeline.engine [--skip-validation]

Writes data/engine/baseline.*.json, data/engine/matchup.centered.json,
data/players/distributions.json, data/engine/validation.json and docs/ENGINE_REPORT.md.
Exits 1 when a gated validation metric fails (after writing everything), 2 when the cache is
not usable, 3 on an unmapped value, 4 when a generated name matches a real player.
"""

from __future__ import annotations

import sys
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any

import polars as pl

from pipeline.caller.build import dumps, prepare_plays, write_atomic
from pipeline.caller.config import REPO
from pipeline.caller.frames import add_labels
from pipeline.caller.mapping import UnmappedValues, check_unmapped
from pipeline.caller.shares import Caller
from pipeline.engine import center, combine, duration, names, penalties, special
from pipeline.engine import report as report_mod
from pipeline.engine import validate as validate_mod
from pipeline.engine.classes import add_outcomes, split_unknown_depth
from pipeline.engine.config import (
    BASELINE_FILES,
    DESIGNED_FILES,
    DISTRIBUTIONS_PATH,
    ENGINE_DIR,
    GENERATED_FILES,
    MATCHUP_CENTERED_PATH,
    REPORT_PATH,
    SIZE_BUDGET_BYTES,
    VALIDATION_PATH,
    Inputs,
    code_hash,
    file_sha,
    load_inputs,
    read_json,
    weights_for,
)
from pipeline.engine.fit import fit_cells, fit_pools
from pipeline.engine.load import EngineSeason, Source, load_all

FIRST_SEASON = 2016
LAST_SEASON = 2025
LAST_ROSTER_SEASON = 2026
POSITION_SKILLS = {
    "QB": ("throwPower", "accuracy"), "RB": ("ballSecurity", "elusiveness"), "WR": ("hands", "routeRunning"),
    "TE": ("hands", "routeRunning", "runBlock"), "OL": ("passBlock", "runBlock"), "DL": ("passRush", "runStop"),
    "LB": ("tackling", "coverage"), "CB": ("coverage", "ballSkills"), "S": ("coverage", "ballSkills"),
    "K": ("kickPower", "kickAccuracy"), "P": ("kickPower", "kickAccuracy"),
}
POOL_FIELDS = ["y", "flags", "ty", "ry"]


def _log(message: str) -> None:
    print(f"[engine] {message}", file=sys.stderr, flush=True)


def with_weights(frame: pl.DataFrame, seasons: list[int], anchor: int, half_life: float) -> pl.DataFrame:
    w = weights_for(seasons, anchor, half_life)
    return frame.with_columns(w=pl.col("season").replace_strict(w, default=0.0, return_dtype=pl.Float64))


def training_scrimmage(plays: pl.DataFrame, cfg: dict[str, Any]) -> pl.DataFrame:
    """Run and pass plays that feed the class cells and pools: training seasons, no accepted
    foul, a known leaf (pass leaves from passLeavesFrom only)."""
    s = cfg["seasons"]
    return plays.filter(
        (pl.col("phase") == "scrimmage")
        & pl.col("family").is_not_null()
        & pl.col("leaf").is_not_null()
        & pl.col("cls").is_not_null()
        & ~pl.col("has_accepted_foul").fill_null(False)
        & pl.col("season").is_between(s["from"], s["to"])
        & ((pl.col("family") == "run") | (pl.col("season") >= s["passLeavesFrom"]))
    )


def prepare(seasons_data: list[EngineSeason], inputs: Inputs, caller: Caller) -> pl.DataFrame:
    plays = prepare_plays([sd.caller for sd in seasons_data], inputs.caller_config)
    plays = add_labels(plays, inputs.config["dimensions"])
    plays = add_outcomes(plays, inputs.config)
    return split_unknown_depth(plays, caller)


def build_scrimmage(train: pl.DataFrame, plays: pl.DataFrame, cfg: dict[str, Any], weights: dict[int, float]) -> dict[str, Any]:
    s = cfg["seasons"]
    never = s["neverTrainFrom"]
    out_cells: list[dict[str, list[int]]] = [dict() for _ in cfg["levels"]]
    out_pools: list[dict[str, list[int]]] = [dict() for _ in cfg["poolLevels"]]
    for fam, fdef in cfg["families"].items():
        f = train.filter(pl.col("family") == fam)
        cells = fit_cells(f, cfg["levels"], fdef["classes"], cfg["minPlays"], never, quantile=cfg["fluke"]["yardsPercentile"])
        pools = fit_pools(f, cfg["poolLevels"], POOL_FIELDS, cfg["minPoolPlays"], never)
        for i, c in enumerate(cells):
            out_cells[i].update(c)
        for i, p in enumerate(pools):
            out_pools[i].update(p)
    durations = {fam: duration.fit_group(train.filter(pl.col("family") == fam), cfg, fdef["classes"]) for fam, fdef in cfg["families"].items()}
    clock_frame = plays.filter(pl.col("season").is_between(s["from"], s["to"]) & ~pl.col("has_accepted_foul").fill_null(False))
    clock = special.fit_clock_plays(clock_frame, never)
    for call in ("kneel", "spike"):
        f = with_weights(clock_frame.filter(pl.col("call") == call), list(weights), s["weightAnchor"], s["halfLifeSeasons"])
        durations[call] = duration.fit_group(f.with_columns(cls=pl.lit(call), frac=pl.lit(1.0)), cfg, [call])
    two = special.fit_two_point(
        plays.filter(pl.col("season").is_between(s["from"], s["to"]) & pl.col("w").is_not_null()), cfg, never
    )
    return {
        "generated": True,
        "families": cfg["families"],
        "levels": cfg["levels"],
        "cells": [dict(sorted(c.items())) for c in out_cells],
        "poolLevels": cfg["poolLevels"],
        "poolFields": POOL_FIELDS,
        "pools": [dict(sorted(p.items())) for p in out_pools],
        "durations": durations,
        "twoPoint": two,
        "clock": clock,
    }


def games_in(seasons_data: list[EngineSeason], seasons: list[int]) -> int:
    """Regular-season games in those seasons, from the snaps' (season, game) count."""
    return sum(sd.games for sd in seasons_data if sd.season in seasons)


def share_of_pass(snaps: pl.DataFrame) -> float:
    s = snaps.filter(pl.col("snap") & pl.col("pfamily").is_in(["run", "pass"]))
    return float((s["pfamily"] == "pass").mean() or 0.5)


def leaf_rates(train: pl.DataFrame, cfg: dict[str, Any]) -> dict[str, dict[str, float]]:
    """Training share of each class per leaf (season weight x frac): the per-leaf sack and
    scramble rates the unknown-depth split produces (spec resolved question 13)."""
    out: dict[str, dict[str, float]] = {}
    for fam in cfg["families"].values():
        for leaf in fam["leaves"]:
            f = train.filter(pl.col("leaf") == leaf).with_columns(ww=pl.col("w") * pl.col("frac"))
            tot = f["ww"].sum()
            out[leaf] = {c: float(f.filter(pl.col("cls") == c)["ww"].sum() / tot) if tot else 0.0 for c in fam["classes"]}
            out[leaf]["plays"] = float(f["frac"].sum())
    return out


SENSITIVITY_TEAMS = ("7", "99", "12345", "flat")


def team_sensitivity(v: Any, reqs: list[dict[str, Any]], meta: list[dict[str, Any]], snaps: pl.DataFrame, tol: dict[str, Any],
                     common: dict[str, Any], root: Path, seed: int, k: int) -> dict[str, Any]:
    """Predicted value per team draw for every gated failure and every gate within 0.5 of its
    tolerance (pp or yd). Every draw except the teams keeps the validation seed."""
    watch = [m for m in v.metrics.values() if m.status == "fail" or (m.status == "pass" and abs(m.diff()) >= m.tolerance - 0.5)]
    rows = {m.id: {"actual": m.actual, "unit": m.unit, "tolerance": m.tolerance, "status": m.status, "pre": m.predicted, "by": {}} for m in watch}
    for teams in SENSITIVITY_TEAMS:
        res = validate_mod.run_engine(reqs, root, seed, k, teams)
        alt = validate_mod.score("sensitivity", reqs, meta, res, snaps, tol, include_kickoff=True, **common)
        for mid in rows:
            rows[mid]["by"][teams] = alt.metrics[mid].predicted
    return {"teams": list(SENSITIVITY_TEAMS), "rows": rows}


def sneak_sensitivity(reqs: list[dict[str, Any]], meta: list[dict[str, Any]], root: Path, seed: int, k: int) -> dict[str, Any]:
    """In-sample qbSneak 1-3 yard share (season-weighted), exact engine probability, per team draw."""
    w = sum(m["w"] for m in meta)
    actual = sum(m["w"] for m in meta if m["cls"] == "r1_3") / w
    out: dict[str, Any] = {"actual": actual, "plays": len(meta), "by": {}}
    for teams in (None, *SENSITIVITY_TEAMS):
        res = validate_mod.run_engine(reqs, root, seed, k, teams)
        out["by"][teams or "validation"] = sum(m["w"] * r["p"].get("r1_3", 0.0) for m, r in zip(meta, res)) / w
    return out


def kickoff_counts(seasons_data: list[EngineSeason]) -> dict[str, Any]:
    kf = next((sd.kickoff_frame for sd in seasons_data if sd.season == 2025), None)
    if kf is None:
        return {}
    on = kf.filter(pl.col("onside"))
    rec = int(on["recovered_by_kickers"].sum())
    from pipeline.caller.validate import wilson

    ci = wilson(rec, on.height)
    return {"onside": on.height, "recovered": rec, "ci95": ci, "kickoffs": kf.filter(~pl.col("onside")).height}


def build(
    source: Source,
    root: Path = REPO,
    *,
    validate: bool = True,
    in_sample_only: bool = False,
    nflreadpy_version: str = "?",
    log: Callable[[str], None] = _log,
) -> int:
    inputs = load_inputs(root)
    cfg = inputs.config
    s = cfg["seasons"]
    caller_tables = {side: read_json(root, Path(f"data/caller/{side}.table.json")) for side in ("offense", "defense")}
    caller = Caller(inputs.catalog, inputs.caller_config, caller_tables["offense"], caller_tables["defense"])
    rules = read_json(root, Path("data/rules/nfl-2026.json"))

    seasons_data = load_all(source, list(range(FIRST_SEASON, LAST_SEASON + 1)), log)
    observed: dict[str, Counter[str]] = {k: Counter() for k in ("offense_formation", "defense_coverage_type", "defense_man_zone_type", "personnel token")}
    ptypes: Counter[str] = Counter()
    for sd in seasons_data:
        observed["offense_formation"].update(sd.caller.formation_values)
        observed["defense_coverage_type"].update(sd.caller.coverage_values)
        observed["defense_man_zone_type"].update(sd.caller.man_zone_values)
        observed["personnel token"].update(sd.caller.personnel_tokens)
        ptypes.update(sd.ptypes)
    try:
        check_unmapped(observed, inputs.caller_config)
        penalties.check_mapping(ptypes, cfg)
    except (UnmappedValues, penalties.UnmappedPenalties) as e:
        print(str(e), file=sys.stderr)
        return 3

    log("mapping, binning and classing")
    train_seasons = list(range(s["from"], s["to"] + 1))
    plays = prepare(seasons_data, inputs, caller)
    plays = with_weights(plays, train_seasons, s["weightAnchor"], s["halfLifeSeasons"])
    weights = weights_for(train_seasons, s["weightAnchor"], s["halfLifeSeasons"])
    train = training_scrimmage(plays, cfg)

    log("fitting scrimmage cells and pools")
    scrimmage = build_scrimmage(train, plays, cfg, weights)
    scrimmage.update(
        configHash=inputs.config_hash,
        seasons=train_seasons,
        passSeasons=list(range(s["passLeavesFrom"], s["to"] + 1)),
        seasonWeights={str(k): v for k, v in weights.items()},
        weightAnchor=s["weightAnchor"],
        halfLifeSeasons=s["halfLifeSeasons"],
    )
    scrimmage = {"generated": True, "configHash": inputs.config_hash, **{k: v for k, v in scrimmage.items() if k not in ("generated", "configHash")}}

    log("fitting special teams")
    never = s["neverTrainFrom"]
    in_train = pl.col("season").is_between(s["from"], s["to"])
    punts_f = special.punt_frame(plays.filter(in_train), cfg).with_columns(frac=pl.lit(1.0))
    punts = special.fit_punts(punts_f, cfg, never)
    punts["durations"] = duration.fit_group(punts_f, cfg, cfg["punts"]["classes"])
    fg_f = with_weights(special.fg_frame(plays.filter(in_train)), train_seasons, s["weightAnchor"], s["fieldGoalHalfLifeSeasons"])
    fg = special.fit_field_goals(fg_f, cfg)
    fg_dur = fg_f.with_columns(
        cls=pl.when(pl.col("made")).then(pl.lit("good")).when(pl.col("blocked")).then(pl.lit("blocked")).otherwise(pl.lit("miss")),
        frac=pl.lit(1.0),
    )
    fg["durations"] = duration.fit_group(fg_dur, cfg, ["good", "miss", "blocked"])
    xp = special.fit_extra_points(special.xp_frame(plays.filter(in_train)), never)
    special_out = {
        "generated": True,
        "configHash": inputs.config_hash,
        "seasons": train_seasons,
        "fieldGoalHalfLifeSeasons": s["fieldGoalHalfLifeSeasons"],
        "punts": punts,
        "fieldGoals": fg,
        "extraPoints": xp,
    }

    log("fitting penalty rates")
    snaps_all = pl.concat([sd.snaps for sd in seasons_data])
    snaps_train = with_weights(snaps_all.filter(in_train), train_seasons, s["weightAnchor"], s["halfLifeSeasons"])
    pen = penalties.fit_penalties(snaps_train, cfg, rules, inputs.caller_config["dimensions"], never)
    dpi = snaps_train.filter((pl.col("ptype") == "Defensive Pass Interference") & (pl.col("status") == "enforced") & (pl.col("yards") > 0))
    pen["dpiYards"] = {"min": 1, "max": 60, "weights": penalties.dpi_yards(dpi, 1, 60)}
    pen_out = {"generated": True, "configHash": inputs.config_hash, "seasons": train_seasons, **pen}

    log("centering the matchup table")
    presets = caller_tables["defense"]["factors"]["dTry"]["targets"]
    groups = center.groups_for(train, scrimmage["cells"], cfg["levels"], cfg["families"], caller)
    centered, check = center.center(inputs.matchup, groups, cfg["families"], inputs.personnel, presets)
    centered_out = {
        "generated": True,
        "matchupHash": inputs.matchup_hash,
        "configHash": inputs.config_hash,
        "method": "Per leaf: an iterative per-class correction (proportional fitting) of the formation layer alone, then of the matchup table with the centered formation layer applied, over the training plays (season weight x frac), presets weighted by the step 2 defense caller's shares.",
        **centered,
        "check": check,
    }

    log("player distributions and the name check")
    from pipeline.caller.load import spec as table_spec

    combine_df = source.load_whole(table_spec("combine"))  # type: ignore[attr-defined]
    ratings_bytes = (root / "data/players/ratings.json").read_bytes()
    skills = {p: list(v) for p, v in POSITION_SKILLS.items()}
    dist, coverage = combine.build_distributions(combine_df, inputs.ratings, ratings_bytes, skills)
    names_cfg = read_json(root, Path("data/players/names.json"))
    rosters = []
    for season in range(names.FIRST_ROSTER_SEASON, LAST_ROSTER_SEASON + 1):
        try:
            rosters.append(source.load_season(table_spec("rosters"), season))
        except Exception as e:  # noqa: BLE001 - a missing roster season is reported, not fatal
            log(f"rosters {season}: {type(e).__name__}")
    try:
        combos = names.check(names_cfg, rosters)
    except names.NameCollision as e:
        print(str(e), file=sys.stderr)
        return 4
    del rosters

    texts = {
        "baseline.scrimmage.json": dumps(scrimmage),
        "baseline.special.json": dumps(special_out),
        "baseline.penalties.json": dumps(pen_out),
    }
    for name, text in texts.items():
        write_atomic(root / ENGINE_DIR / name, text)
    assert set(texts) == set(BASELINE_FILES)
    write_atomic(root / MATCHUP_CENTERED_PATH, dumps(centered_out))
    write_atomic(root / DISTRIBUTIONS_PATH, dumps(dist))
    sizes = {str(p): (root / p).stat().st_size for p in GENERATED_FILES}
    for name, n in sizes.items():
        log(f"{name}: {n:,} bytes")

    report: dict[str, Any] = {
        "configHash": inputs.config_hash,
        "matchupHash": inputs.matchup_hash,
        "tolerancesHash": inputs.tolerances_hash,
        "codeHash": code_hash(root),
        "nflreadpy": nflreadpy_version,
        "sizes": sizes,
        "budget": SIZE_BUDGET_BYTES,
        "durationChecks": {sd.season: sd.duration_check for sd in seasons_data if sd.duration_check is not None},
        "durationSubsample": [duration.subsample_report(train.filter(pl.col("family") == fam), cfg, fam) for fam in cfg["families"]],
        "scrimmage": scrimmage,
        "fgBySeason": special.fg_by_season(fg_f, cfg, fg["beta"]),
        "fieldGoals": fg,
        "punts": {"plays": punts["plays"]},
        "penalties": pen_out,
        "gap": penalties.gap_report(snaps_all.filter(in_train), cfg, games_in(seasons_data, train_seasons)),
        "gapHoldout": penalties.gap_report(snaps_all.filter(pl.col("season").is_in(s["holdout"])), cfg, games_in(seasons_data, s["holdout"])),
        "combine": {"coverage": coverage, "combos": combos, "draftClasses": dist["draftClasses"]},
        "centering": check,
        "leafRates": leaf_rates(train, cfg),
        "kickoffs2025": kickoff_counts(seasons_data),
        "validation": None,
        "inSample": None,
    }

    code = 0
    out_dir = root / ENGINE_DIR
    if not validate:
        stale = root / VALIDATION_PATH
        if stale.exists():
            stale.unlink()
            log(f"removed {VALIDATION_PATH}: the new tables are not validated")
    elif inputs.tolerances is None:
        print("data/engine/tolerances.json is missing: pre-register tolerances before validating", file=sys.stderr)
        return 3
    else:
        tol = inputs.tolerances
        seed, k = int(tol["seed"]), int(tol["simulationsPerPlay"])
        plays_v = plays.with_columns(pcls=special.punt_class(cfg["punts"]["longGrossFrom"]))
        snaps_v = snaps_all.with_columns(pid=penalties.foul_id_expr(cfg))
        pass_share = share_of_pass(snaps_v.filter(in_train))
        common = dict(rules_ids=list(rules["penalties"]), families=cfg["families"], punt_classes=cfg["punts"]["classes"],
                      kickoff_classes=read_json(root, Path("data/engine/kickoff.json"))["kickoff"]["classes"], fg_bands=cfg["fieldGoals"]["bands"])
        lo, hi = tol["inSampleSeasons"]
        log(f"in-sample run, {lo}-{hi}")
        ins = plays_v.filter(pl.col("season").is_between(lo, hi))
        ins_snaps = snaps_v.filter(pl.col("season").is_between(lo, hi))
        reqs, meta = validate_mod.requests(ins, ins_snaps, None, pass_share, weights)
        res = validate_mod.run_engine(reqs, root, seed, k)
        v_in = validate_mod.score(f"in-sample {lo}-{hi}", reqs, meta, res, ins_snaps, tol, include_kickoff=False, **common)
        if in_sample_only:
            report["inSample"] = validate_mod.summary(v_in, {}, list(range(lo, hi + 1)))
            write_atomic(root / REPORT_PATH, report_mod.render(report))
            stale = root / VALIDATION_PATH
            if stale.exists():
                stale.unlink()
            log("in-sample only: no holdout run, no validation summary")
            return 0
        hold = tol["validationSeasons"]
        log(f"validation run, {hold}")
        ho = plays_v.filter(pl.col("season").is_in(hold))
        ho_snaps = snaps_v.filter(pl.col("season").is_in(hold))
        ko25 = next((sd.kickoff_frame for sd in seasons_data if sd.season == 2025), None)
        reqs, meta = validate_mod.requests(ho, ho_snaps, ko25, pass_share)
        res = validate_mod.run_engine(reqs, root, seed, k)
        v = validate_mod.score(f"validation {hold[0]}-{hold[-1]}", reqs, meta, res, ho_snaps, tol, include_kickoff=True, **common)
        hashes = {
            "configHash": inputs.config_hash,
            "matchupHash": inputs.matchup_hash,
            "tolerancesHash": inputs.tolerances_hash,
            "codeHash": code_hash(root),
            "fileHashes": {str(p): file_sha((root / p).read_bytes()) for p in sorted(GENERATED_FILES + DESIGNED_FILES)},
            "seed": seed,
            "simulationsPerPlay": k,
        }
        summary = validate_mod.summary(v, hashes, hold)
        summary["inSample"] = validate_mod.summary(v_in, {}, list(range(lo, hi + 1)))
        write_atomic(root / VALIDATION_PATH, dumps(summary))
        report["validation"] = summary
        report["inSample"] = summary["inSample"]
        if v.gated_failures:
            code = 1
            log(f"gate FAILED: {', '.join(m.id for m in v.gated_failures)}")
        # Sensitivity check, report only: the same holdout with the 32 teams drawn from other
        # seeds, and with league-average teams. The gated run above is unchanged.
        log("sensitivity check: team draw")
        report["sensitivity"] = team_sensitivity(v, reqs, meta, ho_snaps, tol, common, root, seed, k)
        sneak = ins.filter(pl.col("leaf") == "qbSneak")
        sreqs, smeta = validate_mod.requests(sneak, ins_snaps.head(0), None, pass_share, weights)
        keep = [i for i, r in enumerate(sreqs) if r["t"] == "scrim"]
        sreqs = [dict(sreqs[i], i=j) for j, i in enumerate(keep)]
        smeta = [smeta[i] for i in keep]
        report["sneakSensitivity"] = sneak_sensitivity(sreqs, smeta, root, seed, k)
    write_atomic(root / REPORT_PATH, report_mod.render(report))
    log(f"wrote {ENGINE_DIR}/, {DISTRIBUTIONS_PATH} and {REPORT_PATH}")
    del out_dir
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
    return build(
        source,
        validate="--skip-validation" not in args,
        in_sample_only="--in-sample-only" in args,
        nflreadpy_version=source.version,
    )
