"""The normalization that writes data/engine/matchup.centered.json from the designed raw table
data/engine/matchup.json. It is the only writer of the centered file and never writes the raw
one.

Constraint (spec, Matchup table): for each offense leaf, over the training plays weighted as
in the baseline, with each preset weighted by the step 2 defense caller's shares in that
play's situation, the class probabilities after the multipliers equal the baseline class
probabilities. The engine applies multipliers to a cell's class probabilities and
renormalizes within the family, so plain scaling is not exact. Method: an iterative per-leaf,
per-class correction factor (proportional fitting), first for the formation layer alone, then
for the matchup table with the centered formation layer applied, until every class is within
1e-9 of its target. The correction is folded into the centered multipliers.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import polars as pl

from pipeline.caller.frames import situation_columns, situation_of
from pipeline.caller.shares import Caller
from pipeline.engine.fit import key_expr

TOLERANCE = 1e-9
MAX_ITER = 500


class MatchupError(ValueError):
    pass


def expand_raw(raw: dict[str, Any], families: dict[str, Any], presets: list[str], personnel: dict[str, Any]) -> tuple[dict[str, dict[str, list[float]]], dict[str, dict[str, dict[str, list[float]]]]]:
    """Raw multipliers for every leaf x preset x class (default 1), and every leaf x formation x
    package x class. Rejects an unknown leaf, preset, class, formation or package, a value out of
    bounds, a cell listed twice, and a notable cell without a label and a reason (D1)."""
    lo, hi = raw["bounds"]["min"], raw["bounds"]["max"]
    below, above = raw["notable"]["below"], raw["notable"]["above"]
    leaf_classes = {leaf: f["classes"] for f in families.values() for leaf in f["leaves"]}
    formations = list(personnel["offense"])
    packages = list(personnel["packages"])
    mat = {leaf: {p: [1.0] * len(cl) for p in presets} for leaf, cl in leaf_classes.items()}
    form = {leaf: {f: {k: [1.0] * len(cl) for k in packages} for f in formations} for leaf, cl in leaf_classes.items()}
    seen: set[tuple[str, ...]] = set()

    def check(e: dict[str, Any]) -> None:
        if not lo <= e["m"] <= hi:
            raise MatchupError(f"multiplier {e['m']} outside [{lo}, {hi}]: {e}")
        if (e["m"] < below or e["m"] > above) and (e.get("label") not in ("designed", "mixed") or not e.get("reason")):
            raise MatchupError(f"notable cell without a label and a reason: {e}")
        if e.get("label") == "mixed" and not e.get("source"):
            raise MatchupError(f"mixed cell without a data source: {e}")

    for e in raw["matchup"]:
        check(e)
        for leaf in e["leaves"]:
            if leaf not in leaf_classes:
                raise MatchupError(f"unknown leaf {leaf}")
            if e["class"] not in leaf_classes[leaf]:
                raise MatchupError(f"class {e['class']} is not a {leaf} class")
            for p in e["presets"]:
                if p not in presets:
                    raise MatchupError(f"unknown preset {p}")
                key = ("m", leaf, p, e["class"])
                if key in seen:
                    raise MatchupError(f"cell listed twice: {key}")
                seen.add(key)
                mat[leaf][p][leaf_classes[leaf].index(e["class"])] = float(e["m"])
    for e in raw["formation"]:
        check(e)
        for leaf in e["leaves"]:
            if leaf not in leaf_classes or e["class"] not in leaf_classes[leaf]:
                raise MatchupError(f"bad leaf or class in formation cell {e}")
            for f in e["formations"]:
                for k in e["packages"]:
                    if f not in formations or k not in packages:
                        raise MatchupError(f"unknown formation or package in {e}")
                    key = ("f", leaf, f, k, e["class"])
                    if key in seen:
                        raise MatchupError(f"cell listed twice: {key}")
                    seen.add(key)
                    form[leaf][f][k][leaf_classes[leaf].index(e["class"])] = float(e["m"])
    return mat, form


@dataclass
class Group:
    """Training plays of one leaf that use the same baseline cell and formation. `presets` is
    the sum over those plays of weight x the caller's preset share, so `weight` is its sum."""

    weight: float
    base: list[float]
    presets: list[float]
    formation: str


def apply(base: list[float], mult: list[float]) -> list[float]:
    raw = [b * m for b, m in zip(base, mult)]
    t = sum(raw)
    return [x / t for x in raw]


def aggregate(groups: list[Group], presets: list[str], pkg_of: dict[str, str], mat: dict[str, list[float]] | None, form: dict[str, dict[str, list[float]]] | None, corr: list[float]) -> list[float]:
    n = len(corr)
    acc = [0.0] * n
    tot = 0.0
    for g in groups:
        for j, p in enumerate(presets):
            w = g.presets[j]
            if w == 0:
                continue
            mult = list(corr)
            if mat is not None:
                mult = [a * b for a, b in zip(mult, mat[p])]
            if form is not None:
                mult = [a * b for a, b in zip(mult, form[g.formation][pkg_of[p]])]
            q = apply(g.base, mult)
            for k in range(n):
                acc[k] += w * q[k]
            tot += w
    return [a / tot for a in acc]


def target(groups: list[Group], n: int) -> list[float]:
    acc = [0.0] * n
    tot = 0.0
    for g in groups:
        for k in range(n):
            acc[k] += g.weight * g.base[k]
        tot += g.weight
    return [a / tot for a in acc]


def solve(groups: list[Group], presets: list[str], pkg_of: dict[str, str], mat: dict[str, list[float]] | None, form: dict[str, dict[str, list[float]]] | None) -> list[float]:
    n = len(groups[0].base)
    t = target(groups, n)
    corr = [1.0] * n
    for _ in range(MAX_ITER):
        cur = aggregate(groups, presets, pkg_of, mat, form, corr)
        err = max(abs(a - b) for a, b in zip(cur, t))
        if err < TOLERANCE:
            return corr
        corr = [c * (tt / cc if cc > 0 else 1.0) for c, tt, cc in zip(corr, t, cur)]
        s = sum(corr) / n
        corr = [c / s for c in corr]
    raise MatchupError(f"centering did not converge (error {err})")


def groups_for(train: pl.DataFrame, cells: list[dict[str, list[int]]], levels: list[dict[str, Any]], families: dict[str, Any], caller: Caller) -> dict[str, list[Group]]:
    """Per leaf, the training plays grouped by situation and formation, with each group's
    baseline class probabilities (the same backoff lookup as the engine), the caller's preset
    shares and the summed weight (season weight x frac). A play without a formation is spread
    over the caller's formation shares for its leaf."""
    sit_cols = situation_columns(train.columns)
    df = train.with_columns(ww=pl.col("w") * pl.col("frac"))
    g = df.group_by([*sit_cols, "family", "leaf", "formation", *[c for c in df.columns if c.startswith("b_")]]).agg(pl.col("ww").sum())
    acc: dict[tuple[str, int, str, str], Group] = {}
    pcache: dict[tuple[Any, ...], list[float]] = {}
    fcache: dict[tuple[Any, ...], list[tuple[str, float]]] = {}
    formation_targets = caller.off["oFormation"]["targets"]
    for row in g.iter_rows(named=True):
        sit_key = tuple(row[c] for c in sit_cols)
        sit = situation_of(row)
        shares = pcache.get(sit_key)
        if shares is None:
            presets, _, _ = caller.defense(sit)
            shares = [p["p"] for p in presets]
            pcache[sit_key] = shares
        forms: list[tuple[str, float]]
        if row["formation"] is not None:
            forms = [(row["formation"], 1.0)]
        else:
            fk = (*sit_key, row["leaf"])
            got = fcache.get(fk)
            if got is None:
                lk = caller.formation(sit, row["leaf"])
                got = [(formation_targets[i], w / lk.total) for i, w in enumerate(lk.weights) if w > 0]
                fcache[fk] = got
            forms = got
        for form, share in forms:
            ctx = {**row, "formation": form}
            base = None
            where = None
            for i, level in enumerate(levels):
                parts = []
                ok = True
                for d in level["dims"]:
                    v = ctx.get(d if d in ("leaf", "formation", "family") else f"b_{d}")
                    if v is None:
                        ok = False
                        break
                    parts.append(str(v))
                if not ok:
                    continue
                key = "|".join(parts)
                cell = cells[i].get(key)
                if cell is not None:
                    ncls = len(families[row["family"]]["classes"])
                    w = cell[:ncls]
                    base = [x / sum(w) for x in w]
                    where = (row["leaf"], i, key, form)
                    break
            if base is None or where is None:
                raise MatchupError(f"no baseline cell for {row['leaf']}")
            weight = row["ww"] * share
            grp = acc.get(where)
            if grp is None:
                grp = Group(0.0, base, [0.0] * len(shares), form)
                acc[where] = grp
            grp.weight += weight
            grp.presets = [a + weight * b for a, b in zip(grp.presets, shares)]
    out: dict[str, list[Group]] = {}
    for where in sorted(acc):
        out.setdefault(where[0], []).append(acc[where])
    return out


def center(raw: dict[str, Any], groups: dict[str, list[Group]], families: dict[str, Any], personnel: dict[str, Any], presets: list[str]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Centered multipliers and the check numbers per leaf (baseline, raw applied, centered)."""
    mat, form = expand_raw(raw, families, presets, personnel)
    pkg_of = personnel["presetPackage"]
    out_m: dict[str, dict[str, list[float]]] = {}
    out_f: dict[str, dict[str, dict[str, list[float]]]] = {}
    check: dict[str, Any] = {}
    for fam in families.values():
        for leaf in fam["leaves"]:
            gs = groups[leaf]
            n = len(fam["classes"])
            cf = solve(gs, presets, pkg_of, None, form[leaf])
            f_c = {f: {k: [round(v * c, 9) for v, c in zip(vals, cf)] for k, vals in pk.items()} for f, pk in form[leaf].items()}
            cm = solve(gs, presets, pkg_of, mat[leaf], f_c)
            m_c = {p: [round(v * c, 9) for v, c in zip(vals, cm)] for p, vals in mat[leaf].items()}
            out_m[leaf] = m_c
            out_f[leaf] = f_c
            check[leaf] = {
                "classes": fam["classes"],
                "baseline": [round(x, 9) for x in target(gs, n)],
                "raw": [round(x, 9) for x in aggregate(gs, presets, pkg_of, mat[leaf], form[leaf], [1.0] * n)],
                "centered": [round(x, 9) for x in aggregate(gs, presets, pkg_of, m_c, f_c, [1.0] * n)],
                "groups": len(gs),
            }
    return {"matchup": out_m, "formation": out_f}, check


__all__ = ["Group", "MatchupError", "aggregate", "apply", "center", "expand_raw", "groups_for", "key_expr", "solve", "target"]
