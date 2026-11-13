"""Caller shares in Python, for validation and the golden file.

Mirrors packages/sim/src/caller (offense.ts, defense.ts, lookup.ts) step for step, with
the same float operations in the same order, so data/caller/golden.json can pin the two.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pipeline.caller.bins import Labels, bin_situation, level_key
from pipeline.caller.config import FORMATION_PLAYS
from pipeline.caller.mapping import preset_for
from pipeline.caller.rules import Availability

TOP_ALWAYS_AVAILABLE = ("run", "pass")


@dataclass(frozen=True)
class Lookup:
    level: int
    key: str
    weights: tuple[int, ...]
    total: int


def lookup(
    table: dict[str, Any], labels: Labels, context: dict[str, str] | None = None, mask: list[bool] | None = None
) -> Lookup | None:
    for i, level in enumerate(table["levels"]):
        key = level_key(level, labels, context)
        if key is None:
            continue
        cell = table["cells"][i].get(key)
        if cell is None:
            continue
        weights = tuple(0 if mask is not None and not mask[j] else w for j, w in enumerate(cell))
        total = sum(weights)
        if total > 0:
            return Lookup(i, key, weights, total)
    return None


def require(name: str, table: dict[str, Any], labels: Labels, context: dict[str, str] | None = None) -> Lookup:
    found = lookup(table, labels, context)
    if found is None:
        raise ValueError(f"factor {name} has no usable cell")
    return found


def _w(lk: Lookup, i: int) -> float:
    return lk.weights[i] / lk.total


def _play_leaves(p_run: float, p_pass: float, run: Lookup, pt: Lookup, dp: Lookup) -> list[float]:
    p_plain = p_pass * _w(pt, 2)
    return [
        p_run * _w(run, 0),
        p_run * _w(run, 1),
        p_run * _w(run, 2),
        p_plain * _w(dp, 0),
        p_plain * _w(dp, 1),
        p_plain * _w(dp, 2),
        p_pass * _w(pt, 0),
        p_pass * _w(pt, 1),
    ]


class Caller:
    def __init__(self, catalog: dict[str, Any], config: dict[str, Any], offense: dict[str, Any], defense: dict[str, Any]) -> None:
        self.config = config
        self.dims = config["dimensions"]
        self.off = offense["factors"]
        self.de = defense["factors"]
        self.avail = Availability(catalog)

    def labels(self, sit: dict[str, Any]) -> Labels:
        return bin_situation(sit, self.dims)

    def offense(self, sit: dict[str, Any], labels: Labels | None = None) -> tuple[list[dict[str, Any]], dict[str, Lookup]]:
        lab = labels if labels is not None else self.labels(sit)
        f = self.off
        if sit["phase"] == "try":
            tc = self._try_chart(lab) or require("oTry", f["oTry"], lab)
            top = require("tpTop", f["tpTop"], lab)
            run = require("tpRun", f["tpRun"], lab)
            pt = require("tpPassType", f["tpPassType"], lab)
            dp = require("tpDepth", f["tpDepth"], lab)
            p_two = _w(tc, 1)
            plays = _play_leaves(p_two * _w(top, 0), p_two * _w(top, 1), run, pt, dp)
            leaves = [{"call": "extraPoint", "p": _w(tc, 0)}] + [
                {"call": "goForTwo", "twoPointPlay": play, "p": plays[i]} for i, play in enumerate(FORMATION_PLAYS)
            ]
            return leaves, {"oTry": tc, "tpTop": top, "tpRun": run, "tpPassType": pt, "tpDepth": dp}
        table = f["oTop"]
        trace: dict[str, Lookup] = {}
        fourth = f.get("o4Top")
        if fourth is not None and sit["down"] in fourth.get("downs", []):
            go = self._masked(fourth, lab, sit)
            kick = require("o4Kick", f["o4Kick"], lab)
            trace["o4Top"] = go
            trace["o4Kick"] = kick
            p_kick = _w(go, 2)
            top = [_w(go, 0), _w(go, 1), p_kick * _w(kick, 0), p_kick * _w(kick, 1), _w(go, 3), _w(go, 4)]
        else:
            t = self._masked(table, lab, sit)
            trace["oTop"] = t
            top = [_w(t, i) for i in range(len(table["targets"]))]
        run = require("oRun", f["oRun"], lab)
        pt = require("oPassType", f["oPassType"], lab)
        dp = require("oDepth", f["oDepth"], lab)
        plays = _play_leaves(top[0], top[1], run, pt, dp)
        leaves = [{"call": play, "p": plays[i]} for i, play in enumerate(FORMATION_PLAYS)]
        for i in range(2, len(table["targets"])):
            leaves.append({"call": table["targets"][i], "p": top[i]})
        trace.update({"oRun": run, "oPassType": pt, "oDepth": dp})
        return leaves, trace

    def _try_chart(self, lab: Labels) -> Lookup | None:
        """Step 5c milestone C: the designed late try chart (config `tryChart`) decides a charted
        cell outright; level -2 marks it in the trace. Mirrors offense.ts tryChartLookup."""
        chart = self.config.get("tryChart")
        if chart is None:
            return None
        w, sc = lab.get(chart["window"]), lab.get(chart["score"])
        if w is None or sc is None:
            return None
        choice = chart["cells"].get(f"{w}|{sc}")
        if choice is None:
            return None
        return Lookup(-2, f"chart|{w}|{sc}", (0, 1) if choice == "goForTwo" else (1, 0), 1)

    def _masked(self, table: dict[str, Any], lab: Labels, sit: dict[str, Any]) -> Lookup:
        mask = [self.avail.is_available(t, sit) for t in table["targets"]]
        found = lookup(table, lab, None, mask)
        if found is None:
            w = tuple(1 if t in TOP_ALWAYS_AVAILABLE else 0 for t in table["targets"])
            found = Lookup(-1, "", w, len(TOP_ALWAYS_AVAILABLE))
        return found

    def formation(self, sit: dict[str, Any], play: str, labels: Labels | None = None) -> Lookup:
        lab = labels if labels is not None else self.labels(sit)
        return require("oFormation", self.off["oFormation"], lab, {"leaf": play})

    def defense(self, sit: dict[str, Any], labels: Labels | None = None) -> tuple[list[dict[str, Any]], dict[str, Lookup], dict[str, float]]:
        """Preset shares, the trace, and diagnostics used only by validation: the predicted
        man share and 5+ rusher share (both from the coverage factor)."""
        lab = labels if labels is not None else self.labels(sit)
        f = self.de
        presets: list[str] = f["dTry"]["targets"]
        if sit["phase"] == "try":
            t = require("dTry", f["dTry"], lab)
            return [{"call": c, "p": _w(t, i)} for i, c in enumerate(presets)], {"dTry": t}, {}
        front = require("dFront", f["dFront"], lab)
        cov_targets: list[str] = f["dCoverage"]["targets"]
        p = [0.0] * len(presets)
        trace: dict[str, Lookup] = {"dFront": front}
        man = 0.0
        blitz = 0.0
        for i, front_id in enumerate(f["dFront"]["targets"]):
            fw = front.weights[i]
            if fw == 0:
                continue
            pf = fw / front.total
            cov = require("dCoverage", f["dCoverage"], lab, {"front": front_id})
            trace[f"dCoverage:{front_id}"] = cov
            for j, cid in enumerate(cov_targets):
                cw = cov.weights[j]
                if cw == 0:
                    continue
                k = presets.index(preset_for(front_id, cid, self.config["defenseMapping"]))
                share = pf * (cw / cov.total)
                p[k] = p[k] + share
                _, mz, rush = cid.split(".")
                if mz == "man":
                    man += share
                if rush == "ge5":
                    blitz += share
        return [{"call": c, "p": p[i]} for i, c in enumerate(presets)], trace, {"man": man, "blitz": blitz}
