"""Situation binning from config.json. Mirrors packages/sim/src/caller/bins.ts exactly."""

from __future__ import annotations

from typing import Any

Labels = dict[str, str | None]


def _in_range(v: float, b: dict[str, Any]) -> bool:
    return (b["min"] is None or v >= b["min"]) and (b["max"] is None or v <= b["max"])


def _range_label(v: float, buckets: list[dict[str, Any]], what: str) -> str:
    for b in buckets:
        if _in_range(v, b):
            return b["label"]
    raise ValueError(f"{what}: {v} is outside every bucket")


def _int_str(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else str(v)


def bin_situation(sit: dict[str, Any], dims: dict[str, dict[str, Any]]) -> Labels:
    out: Labels = {}

    def visit(name: str) -> str | None:
        if name in out:
            return out[name]
        d = dims[name]
        label: str | None
        if sit["phase"] not in d["phases"]:
            label = None
        elif d["type"] == "exact":
            label = _int_str(sit[d["field"]])
        elif d["type"] == "range":
            label = _range_label(sit[d["field"]], d["buckets"], name)
        elif d["type"] == "clip":
            label = _int_str(min(d["max"], max(d["min"], sit[d["field"]])))
        elif d["type"] == "rules":
            label = None
            for b in d["buckets"]:
                if b["quarterMin"] <= sit["quarter"] <= b["quarterMax"] and _in_range(sit[b["field"]], b):
                    label = b["label"]
                    break
            if label is None:
                raise ValueError(f"{name}: no bucket for this situation")
        elif d["type"] == "group":
            inner = visit(d["of"])
            label = next((g["label"] for g in d["groups"] if inner is not None and inner in g["members"]), None)
        elif d["type"] == "window":
            inner = visit(d["of"])
            if inner is not None and inner in d["members"]:
                label = _range_label(sit[d["field"]], d["buckets"], name)
            else:
                label = None if d["otherwise"] is None else visit(d["otherwise"])
        elif d["type"] == "kneelOut":
            inner = visit(d["of"])
            dn = sit["down"]
            if inner is None or inner not in d["members"] or sit["scoreDiff"] <= 0 or dn < 1 or dn > 3:
                label = None
            else:
                if "playClock" not in d:
                    raise ValueError(f"{name}: no play clock (load the config with the rule set)")
                left = 4 - dn
                p = d["playClock"]
                can = left * p + d["kneelSeconds"] - p * min(sit["defenseTimeouts"], left) >= sit["secondsLeftInGame"]
                label = "K1" if can else "K0"
        elif d["type"] == "endState":
            inner = visit(d["of"])
            if inner is not None and inner in d["appliesTo"]:
                label = ".".join(
                    _range_label(sit[p["field"]], p["buckets"], f"{name}.{p['field']}") for p in d["parts"]
                )
            else:
                label = d["otherwise"]
        else:
            raise ValueError(f"unknown dimension type {d['type']}")
        out[name] = label
        return label

    for name in dims:
        visit(name)
    return out


def level_key(level: dict[str, Any], labels: Labels, context: dict[str, str] | None = None) -> str | None:
    parts: list[str] = []
    if "tag" in level:
        parts.append(level["tag"])
    ctx = context or {}
    for d in level["dims"]:
        v = ctx[d] if d in ctx else labels.get(d)
        if v is None:
            return None
        parts.append(v)
    return "|".join(parts)
