"""data/caller/golden.json: the pipeline's shares for a fixed set of situations.

The TypeScript caller must reproduce every lookup (level, key, masked integer weights) and
every combined share within 1e-9. Situations come from a deterministic grid, chosen so
that every reachable backoff level of every factor appears, plus tries and situations
where availability masking pushes the top-level lookup past a stored cell.
"""

from __future__ import annotations

import itertools
from typing import Any

from pipeline.caller.config import FORMATION_PLAYS
from pipeline.caller.shares import Caller, Lookup, lookup

TARGET_SIZE = 260


def _sit(phase: str, down: int, ytg: int, yl: int, sd: int, q: int, h: int, g: int, ot: int, dt: int) -> dict[str, Any]:
    return {
        "phase": phase, "down": down, "yardsToGo": ytg, "yardLine100": yl, "scoreDiff": sd, "quarter": q,
        "secondsLeftInHalf": h, "secondsLeftInGame": g, "offenseTimeouts": ot, "defenseTimeouts": dt,
    }


def grid() -> list[dict[str, Any]]:
    times = [(1, 800, 2600), (2, 90, 1890), (2, 30, 1830), (3, 800, 1700), (4, 200, 200), (4, 90, 90), (4, 20, 20), (5, 400, 400)]
    timeouts = [(3, 3), (0, 1), (1, 0), (2, 2)]
    out = []
    for down, ytg, yl, sd, (q, h, g), (ot, dt) in itertools.product(
        (1, 2, 3, 4), (1, 2, 3, 5, 8, 10, 15), (1, 3, 5, 8, 15, 25, 40, 55, 75, 95),
        (-20, -12, -4, 0, 4, 12, 20), times, timeouts,
    ):
        if ytg > yl:
            continue
        out.append(_sit("scrimmage", down, ytg, yl, sd, q, h, g, ot, dt))
    # Step 5a: the last 5:00 of the game, every late score bucket and both sides of its edges.
    for down, ytg, yl, sd, (q, h, g), (ot, dt) in itertools.product(
        (1, 3, 4), (1, 5, 10), (8, 25, 37, 60), (-17, -12, -8, -4, -3, -1, 0, 1, 3, 4, 8, 12, 17),
        [(4, 300, 300), (4, 121, 121), (4, 120, 120), (4, 40, 40), (5, 250, 250)], [(3, 3), (0, 2)],
    ):
        if ytg > yl:
            continue
        out.append(_sit("scrimmage", down, ytg, yl, sd, q, h, g, ot, dt))
    # Step 5a (B4): a broad last-5:00 sweep so every backoff level late situations reach is offered.
    for down, ytg, yl, sd, secs, (ot, dt) in itertools.product(
        (1, 2, 3, 4), (1, 3, 7, 10, 15), (2, 8, 20, 30, 37, 45, 60, 80, 95), (-20, -12, -6, -2, 0, 2, 6, 12, 20), (290, 150, 100, 30), [(0, 0), (3, 3), (1, 0)],
    ):
        out.append(_sit("scrimmage", down, min(ytg, yl), yl, sd, 4, secs, secs, ot, dt))
    for sd, (q, g) in itertools.product(list(range(-21, 22)) + [-30, 30], [(1, 3000), (4, 600), (4, 200), (4, 100), (5, 300)]):
        out.append(_sit("try", 1, 2, 2, sd, q, g, g, 2, 2))
    return out


def _lk(lk: Lookup, with_weights: bool) -> dict[str, Any]:
    d: dict[str, Any] = {"level": lk.level, "key": lk.key}
    if with_weights:
        d["weights"] = list(lk.weights)
    return d


def evaluate(caller: Caller, sit: dict[str, Any]) -> dict[str, Any]:
    labels = caller.labels(sit)
    leaves, trace = caller.offense(sit, labels)
    plays = FORMATION_PLAYS
    formations = {p: _lk(caller.formation(sit, p, labels), False) for p in plays}
    presets, dtrace, _ = caller.defense(sit, labels)
    return {
        "situation": sit,
        "offense": {
            "leaves": leaves,
            "trace": {k: _lk(v, k in ("oTop", "o4Top")) for k, v in trace.items()},
            "formations": formations,
        },
        "defense": {"presets": presets, "trace": {k: _lk(v, False) for k, v in dtrace.items()}},
    }


def _hits(caller: Caller, sit: dict[str, Any], entry: dict[str, Any]) -> set[str]:
    hits = set()
    for k, v in entry["offense"]["trace"].items():
        hits.add(f"{k}@{v['level']}")
    for p, v in entry["offense"]["formations"].items():
        hits.add(f"oFormation@{v['level']}")
        hits.add(f"oFormation:{p}@{v['level']}")
    for k, v in entry["defense"]["trace"].items():
        hits.add(f"{k.split(':')[0]}@{v['level']}")
    if sit["phase"] == "scrimmage":
        fid = "oTop" if "oTop" in entry["offense"]["trace"] else "o4Top"
        unmasked = lookup(caller.off[fid], caller.labels(sit))
        top = entry["offense"]["trace"][fid]
        if unmasked is not None and unmasked.level != top["level"]:
            hits.add("masked-fallthrough")
        if any(not caller.avail.is_available(t, sit) for t in caller.off[fid]["targets"]):
            hits.add("masked")
        late = caller.labels(sit).get("scoreLateOnly")
        if late is not None:
            hits.add(f"late:{late}")
            # Every (factor, level) a late situation reaches, for the late-window factors.
            for k, v in entry["offense"]["trace"].items():
                if k in ("oTop", "o4Top", "o4Kick"):
                    hits.add(f"late:{k}@{v['level']}")
    else:
        hits.add("try")
    return hits


def build_golden(caller: Caller) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Returns the chosen entries and how many cover each (factor@level) tag."""
    candidates = grid()
    evaluated = [(s, evaluate(caller, s)) for s in candidates]
    hit_sets = [_hits(caller, s, e) for s, e in evaluated]
    chosen: list[int] = []
    covered: dict[str, int] = {}
    # First pass: one situation per new tag, up to three per tag for the special ones.
    want = {"masked-fallthrough": 10, "masked": 10, "try": 20}
    # Step 5a (B4): at least 6 late-window situations per late score bucket (9 buckets).
    want.update({f"late:{b}": 6 for b in ("<=-17", "-16..-9", "-8..-4", "-3..-1", "0", "1..3", "4..8", "9..16", ">=17")})
    for i, hits in enumerate(hit_sets):
        new = [h for h in hits if covered.get(h, 0) < want.get(h, 1)]
        if new:
            chosen.append(i)
            for h in hits:
                covered[h] = covered.get(h, 0) + 1
    # Fill to TARGET_SIZE with an even stride over the rest of the grid.
    rest = [i for i in range(len(candidates)) if i not in set(chosen)]
    need = max(0, TARGET_SIZE - len(chosen))
    if need and rest:
        step = max(1, len(rest) // need)
        for i in rest[::step][:need]:
            chosen.append(i)
            for h in hit_sets[i]:
                covered[h] = covered.get(h, 0) + 1
    chosen.sort()
    return [evaluated[i][1] for i in chosen], dict(sorted(covered.items()))
