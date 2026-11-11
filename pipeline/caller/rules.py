"""Catalog availability rules. Mirrors packages/sim/src/caller/availability.ts."""

from __future__ import annotations

from typing import Any


def eval_rule(rule: dict[str, Any], sit: dict[str, Any]) -> bool:
    if "all" in rule:
        return all(eval_rule(r, sit) for r in rule["all"])
    if "any" in rule:
        return any(eval_rule(r, sit) for r in rule["any"])
    if "not" in rule:
        return not eval_rule(rule["not"], sit)
    a, op, b = sit[rule["field"]], rule["op"], rule["value"]
    return {
        "eq": lambda: a == b,
        "ne": lambda: a != b,
        "lt": lambda: a < b,
        "lte": lambda: a <= b,
        "gt": lambda: a > b,
        "gte": lambda: a >= b,
    }[op]()


class Availability:
    def __init__(self, catalog: dict[str, Any]) -> None:
        self._roots = set(catalog["roots"])
        self._choice: dict[str, tuple[dict[str, Any] | None, str]] = {}
        self._opener: dict[str, str] = {}
        for s in catalog["screens"]:
            for c in s["choices"]:
                self._choice[c["id"]] = (c.get("availableWhen"), s["id"])
                if "opens" in c and c["opens"] not in self._opener:
                    self._opener[c["opens"]] = c["id"]

    def is_available(self, choice_id: str, sit: dict[str, Any]) -> bool:
        rule, screen = self._choice[choice_id]
        if rule is not None and not eval_rule(rule, sit):
            return False
        if screen in self._roots:
            return True
        parent = self._opener.get(screen)
        return True if parent is None else self.is_available(parent, sit)
