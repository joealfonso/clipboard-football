"""One command rebuilds the step 5 coach decision tables, their golden file, the real-game
aggregates the calibration compares with, and docs/COACH_REPORT.md.

    uv run --project pipeline python -m pipeline.game [--in-sample-only]

Writes data/game/tempo.json, timeouts.json, onside.json, golden.json, actuals.json,
coach.validation.json and docs/COACH_REPORT.md. `--in-sample-only` reads 2016-2023 only (no
2024-2025 row is loaded), for the in-sample run that comes before the holdout. Exits 1 when a
gated component metric (C7) fails on 2024-2025, after writing everything; 2 when the cache is
not usable; 4 when a team name matches a real NFL nickname or city; 5 when a designed late-kneel
mask state has a real kneel in 2016-2023 (the counts are rewritten into data/game/config.json first).
"""

from __future__ import annotations

import hashlib
import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import polars as pl

from pipeline.caller.build import dumps, write_atomic
from pipeline.caller.config import REPO, season_weight
from pipeline.game import actuals as actuals_mod
from pipeline.game import decisions as dec
from pipeline.game.ep import fit_ep
from pipeline.game.load import Source, load_rows
from pipeline.game.report import render

GAME_DIR = Path("data/game")
FIRST, LAST = 2016, 2025
GOLDEN_VIEWS = 150


def _log(message: str) -> None:
    print(f"[game] {message}", file=sys.stderr, flush=True)


def read_json(root: Path, p: Path | str) -> Any:
    import json

    return json.loads((root / p).read_text(encoding="utf-8"))


def file_sha(root: Path, p: Path | str) -> str:
    return hashlib.sha256((root / p).read_bytes()).hexdigest()


def weights_for(seasons: list[int], anchor: int, half_life: float) -> dict[int, float]:
    return {s: season_weight(s, anchor, half_life) for s in seasons}


def golden(db: dec.DeadBalls, tables: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    dims = cfg["dimensions"]
    train = [x for x in db.snaps if cfg["seasons"]["from"] <= x["season"] <= cfg["seasons"]["to"]]
    step = max(1, len(train) // GOLDEN_VIEWS)
    picked = train[::step][:GOLDEN_VIEWS]
    # Add the rare clock states the even sample misses: final 2:00, kneels, no timeouts.
    rare = [x for x in train if x["base"]["secondsLeftInGame"] <= 120 or x["prevKneel"] == 1 or x["offenseTimeouts"] == 0]
    picked += rare[:: max(1, len(rare) // 60)][:60]
    out: dict[str, Any] = {"tempo": [], "timeouts": [], "onside": [], "specialTimeouts": []}
    for x in picked:
        v = dec.tempo_view(x)
        lvl, key, w = dec.tempo_lookup(v, tables["tempo"], dims)
        out["tempo"].append({"view": v, "level": lvl, "key": key, "weights": w})
        for side in ("offense", "defense"):
            sv = dec.side_view(x, side)
            lvl, key, p = dec.timeout_rate(sv, side, tables["timeouts"], dims)
            out["timeouts"].append({"view": sv, "side": side, "level": lvl, "key": key, "p": p})
    # Step 5c milestone D: every role in every time bin, from real dead balls before kicks and tries.
    sp = [(x, v) for x, v in zip(db.special, db.special_views) if cfg["seasons"]["from"] <= x[0] <= cfg["seasons"]["to"]]
    early = [p for p in sp if p[1]["quarter"] <= 3]
    late_sp = [p for p in sp if p[1]["quarter"] >= 4]
    for (_, role, _, _), v in early[:: max(1, len(early) // 40)][:40] + late_sp[:: max(1, len(late_sp) // 80)][:80]:
        lvl, key, p = dec.special_timeout_rate(v, role, tables["timeouts"], dims)
        out["specialTimeouts"].append({"view": v, "role": role, "level": lvl, "key": key, "p": p})
    ko = [k for k in db.kickoffs if cfg["seasons"]["from"] <= k["season"] <= cfg["seasons"]["to"]]
    late = [k for k in ko if k["quarter"] >= 4]
    for k in ko[:: max(1, len(ko) // 100)][:100] + late[:: max(1, len(late) // 60)][:60]:
        v = dec.kick_view(k)
        lvl, key, p = dec.onside_rate(v, tables["onside"], dims)
        out["onside"].append({"view": v, "level": lvl, "key": key, "p": p})
    return out


def component(label: str, db: dec.DeadBalls, seasons: list[int], weights: dict[int, float], tables: dict[str, Any],
              cfg: dict[str, Any], tol: dict[str, Any], *, scope: str) -> dict[str, Any]:
    dims = cfg["dimensions"]
    snaps = [x for x in db.snaps if x["season"] in seasons]
    kicks = [k for k in db.kickoffs if k["season"] in seasons]
    acc: dict[str, actuals_mod.Acc] = {}
    pred: dict[str, list[tuple[float, float]]] = {}

    def add(mid: str, p: float, a: float, w: float, kind: str = "mean") -> None:
        acc.setdefault(mid, actuals_mod.Acc(kind)).add(a, w)
        pred.setdefault(mid, []).append((p, w))

    team_pred = 0.0
    team_act = 0.0
    for x in snaps:
        w = weights[x["season"]]
        tv = dec.tempo_view(x)
        labels = dec.labels_of(tv, dims, [{"dims": ["time5"]}])
        if x["runoff"] is not None:
            add(f"coach.tempo.meanRunoff.{labels['time5']}", dec.tempo_mean(tv, tables["tempo"], dims, cfg["tempo"]["maxSeconds"]), x["runoff"], w)
        for side in ("offense", "defense"):
            sv = dec.side_view(x, side)
            _, _, p = dec.timeout_rate(sv, side, tables["timeouts"], dims)
            team_pred += w * p
            team_act += w * x[f"{side}Timeout"]
            fin = dec.labels_of(sv, dims, [{"dims": ["final"]}])["final"]
            if fin != "-":
                add(f"coach.timeouts.rate.{side}.{fin}", p, x[f"{side}Timeout"], w, "share")
    team_games_w = sum(weights[s] * n for s, n in db_team_games(seasons).items())
    for k in kicks:
        if k["quarter"] == 4 and k["scoreDiff"] < 0:
            _, _, p = dec.onside_rate(dec.kick_view(k), tables["onside"], dims)
            add("coach.onside.rate.trailingQ4", p, 1.0 if k["onside"] else 0.0, weights[k["season"]], "share")
    tmap = {m["id"]: m for m in tol["metrics"]}
    rows = []
    for mid, a in sorted(acc.items()):
        r = a.result()
        pw = pred[mid]
        p = sum(v * w for v, w in pw) / sum(w for _, w in pw)
        rows.append(_row(mid, p, r, tmap))
    tpg_p = team_pred / team_games_w
    tpg_a = team_act / team_games_w
    rows.append(_row("coach.timeouts.perTeamGame", tpg_p, {"value": tpg_a, "n": sum(db_team_games(seasons).values()), "count": 0, "lo": tpg_a, "hi": tpg_a}, tmap))
    # Scoped (code review, 2026-11-12): an entry applies only to its own sample; no scope means holdout.
    # The scope is passed explicitly (final review), never read from the label.
    if scope not in ("insample", "holdout"):
        raise ValueError(f"unknown scope {scope!r}")
    approved = {d["metric"] for d in tol.get("known_deviations", []) if d.get("approved_by") == "Joseph" and d.get("scope", "holdout") == scope}
    for r in rows:
        if r["status"] == "fail" and r["id"] in approved:
            r["status"] = "accepted"
    return {"label": label, "seasons": seasons, "metrics": sorted(rows, key=lambda r: r["id"])}


# Team-games per season in the loaded rows, filled by build().
TEAM_GAMES: dict[int, int] = {}


def db_team_games(seasons: list[int]) -> dict[int, int]:
    return {s: TEAM_GAMES.get(s, 0) for s in seasons}


def _row(mid: str, p: float, r: dict[str, float], tmap: dict[str, Any]) -> dict[str, Any]:
    t = tmap.get(mid)
    unit = t["unit"] if t else ""
    scale = 100.0 if unit == "pp" else 1.0
    out = {"id": mid, "label": t["label"] if t else mid, "unit": unit, "predicted": p * scale, "actual": r["value"] * scale,
           "n": r["n"], "lo": r["lo"] * scale, "hi": r["hi"] * scale}
    if t is None or not t.get("gated", True):
        out.update(tolerance=None, status="not gated")
    elif r["n"] < t["minN"]:
        out.update(tolerance=t["tolerance"], status="not gated (n below minN)")
    else:
        out.update(tolerance=t["tolerance"], status="pass" if abs(out["predicted"] - out["actual"]) <= t["tolerance"] + 1e-9 else "fail")
    return out


def onside_check(rows: pl.DataFrame) -> dict[str, Any]:
    k = rows.filter(pl.col("play_type") == "kickoff")
    flagged = k.filter(pl.col("onside"))
    short = k.filter(~pl.col("onside") & (pl.col("kick_distance") <= 15))
    return {
        "kickoffs": k.height,
        "flagged": flagged.height,
        "flaggedWithin20Yards": flagged.filter(pl.col("kick_distance") <= 20).height,
        "flaggedNoDistance": flagged.filter(pl.col("kick_distance").is_null()).height,
        "unflaggedUnder15Yards": short.height,
    }


def build(source: Source, root: Path = REPO, *, in_sample_only: bool = False, log: Callable[[str], None] = _log) -> int:
    # The real-name list is local only (gitignored, docs/DATA.md); without it the check is skipped.
    try:
        from pipeline.game import real_names
    except ImportError:
        log("team-name check skipped: pipeline/game/real_names.py is local only and not present")
        clash: list[str] = []
    else:
        clash = real_names.check_file(root / "data/teams/names.json")
    if clash:
        print("data/teams/names.json matches real NFL names: " + ", ".join(clash), file=sys.stderr)
        return 4
    cfg = read_json(root, GAME_DIR / "config.json")
    engine_cfg = read_json(root, "data/engine/config.json")
    tol = read_json(root, GAME_DIR / "tolerances.json")
    s = cfg["seasons"]
    train = list(range(s["from"], s["to"] + 1))
    holdout = list(s["holdout"])
    seasons = train if in_sample_only else list(range(FIRST, LAST + 1))
    rows = load_rows(source, seasons, log)
    # Step 5d (code review): the designed late-kneel masks hold only where 2016-2023 has 0 kneels. The
    # counts are written into the config from the data on every build, and the build fails if any is not 0.
    mask = cfg.get("clockRules", {}).get("callerMasks", {}).get("lateKneel")
    if mask is not None:
        train_rows = rows.filter(pl.col("season").is_between(s["from"], s["to"]))
        dec.check_holdout(set(train_rows["season"].unique().to_list()), s["neverTrainFrom"])
        counts = dec.late_kneel_counts(train_rows, mask)
        for st, (k, n) in zip(mask["states"], counts):
            st["realKneels"], st["realSnaps"] = k, n
        write_atomic(root / GAME_DIR / "config.json", json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
        bad = [(st, k) for st, (k, _) in zip(mask["states"], counts) if k != 0]
        if bad:
            print(f"lateKneel mask states with real kneels (each must be 0): {bad}", file=sys.stderr)
            return 5
        log(f"late-kneel masks: 0 kneels in {', '.join(f'{n:,}' for _, n in counts)} snaps")
    for season in seasons:
        TEAM_GAMES[season] = 2 * rows.filter(pl.col("season") == season)["game_id"].n_unique()
    log("reading dead balls")
    db = dec.dead_balls(rows, cfg["tempo"]["maxSeconds"])
    weights = weights_for(train, s["weightAnchor"], s["halfLifeSeasons"])
    tempo_w = weights_for(list(range(s["tempoFrom"], s["to"] + 1)), s["weightAnchor"], s["halfLifeSeasons"])
    log("fitting tempo, timeouts and onside")
    tables = dec.build_tables(db, cfg, weights, tempo_w)
    for name in ("tempo", "timeouts", "onside"):
        tables[name]["configHash"] = file_sha(root, GAME_DIR / "config.json")
        write_atomic(root / GAME_DIR / f"{name}.json", dumps(tables[name]))
    ep_table = fit_ep(rows, cfg, weights)
    ep_table["configHash"] = file_sha(root, GAME_DIR / "config.json")
    write_atomic(root / GAME_DIR / "ep.json", dumps(ep_table))
    write_atomic(root / GAME_DIR / "golden.json", dumps(golden(db, tables, cfg)))

    log("real-game aggregates")
    exclude = set(s["homeFieldExclude"])
    diag_acc: dict[str, actuals_mod.Acc] = {}
    train_rows = rows.filter(pl.col("season").is_between(s["from"], s["to"]))
    actual: dict[str, Any] = {
        "generated": True,
        "inSample": {"seasons": train, "weighted": True, "metrics": actuals_mod.game_metrics(train_rows, cfg, engine_cfg, weights, exclude)},
        "training": {
            "seasons": [x for x in train if x not in exclude],
            **actuals_mod.home_field_targets(train_rows, engine_cfg, weights, exclude),
        },
    }
    # Step 5b (C3) diagnostics, not gated: timeout rate per dead ball by side x score3 (the
    # calling team's view) x G5/GF, real 2016-2023, season-weighted.
    for x in db.snaps:
        if not (s["from"] <= x["season"] <= s["to"]) or x["base"]["quarter"] != 4 or x["base"]["secondsLeftInGame"] > 300:
            continue
        win = "GF" if x["base"]["secondsLeftInGame"] <= 120 else "G5"
        for side in ("offense", "defense"):
            diff = x["scoreDiff"] if side == "offense" else -x["scoreDiff"]
            s3 = "T" if diff < 0 else "0" if diff == 0 else "L"
            diag_acc.setdefault(f"diag.timeoutRate.{side}.{s3}.{win}", actuals_mod.Acc("share")).add(float(x[f"{side}Timeout"]), weights[x["season"]])
    actual["inSample"]["metrics"].update({k: v.result() for k, v in sorted(diag_acc.items())})
    comp = {"generated": True, "tolerancesSha256": file_sha(root, GAME_DIR / "tolerances.json"),
            "inSample": component("in-sample 2016-2023", db, train, weights, tables, cfg, tol, scope="insample")}
    if not in_sample_only:
        hw = {x: 1.0 for x in holdout}
        ho_rows = rows.filter(pl.col("season").is_in(holdout))
        actual["holdout"] = {"seasons": holdout, "weighted": False, "metrics": actuals_mod.game_metrics(ho_rows, cfg, engine_cfg, hw, set())}
        comp["holdout"] = component("validation 2024-2025", db, holdout, hw, tables, cfg, tol, scope="holdout")
    actual["onsideCheck"] = onside_check(train_rows)
    actual["timeoutCounts"] = {
        "challengeExcluded": db.challenge_timeouts, "beforeTry": db.timeouts_before_try,
        "beforeKickoff": db.timeouts_before_kickoff, "afterTwoMinuteWarning": db.timeouts_after_warning,
        "note": "All seasons loaded in this run. Timeouts before tries and kickoffs are not in the fit (the loop asks only before scrimmage snaps); challenge-related ones are excluded everywhere.",
    }
    write_atomic(root / GAME_DIR / "actuals.json", dumps(actual))
    write_atomic(root / GAME_DIR / "coach.validation.json", dumps(comp))
    write_atomic(root / "docs/COACH_REPORT.md", render(tables, comp, actual, cfg, root))
    log("wrote data/game/ and docs/COACH_REPORT.md")
    failed = [m for m in comp.get("holdout", {"metrics": []})["metrics"] if m["status"] == "fail"]
    return 1 if failed else 0


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

    return build(NflreadpySource(path), in_sample_only="--in-sample-only" in args)
