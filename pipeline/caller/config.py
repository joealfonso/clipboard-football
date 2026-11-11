"""Designed inputs: the catalog, the caller config and the tolerances. Read-only here."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
CATALOG_PATH = Path("data/calls/catalog.json")
CONFIG_PATH = Path("data/caller/config.json")
TOLERANCES_PATH = Path("data/caller/tolerances.json")
OUT_DIR = Path("data/caller")
REPORT_PATH = Path("docs/CALLER_REPORT.md")
OFFENSE_TABLE = "offense.table.json"
DEFENSE_TABLE = "defense.table.json"
GOLDEN = "golden.json"
VALIDATION = "validation.json"

OFFENSE_FACTORS = ("oTop", "o4Top", "o4Kick", "oRun", "oPassType", "oDepth", "oFormation", "oTry",
                   "tpTop", "tpRun", "tpPassType", "tpDepth")
DEFENSE_FACTORS = ("dFront", "dCoverage", "dTry")
FORMATION_PLAYS = ("insideRun", "outsideRun", "qbSneak", "shortPass", "intermediatePass",
                   "deepPass", "screenPass", "playAction")
RUN_PLAYS = FORMATION_PLAYS[:3]
PASS_PLAYS = FORMATION_PLAYS[3:]


@dataclass(frozen=True)
class Inputs:
    catalog: dict[str, Any]
    config: dict[str, Any]
    tolerances: dict[str, Any]
    # sha256 of catalog.json and config.json bytes: everything the tables depend on.
    config_hash: str
    tolerances_hash: str


def _sha(*parts: bytes) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p)
        h.update(b"\0")
    return h.hexdigest()


CODE_DIR = Path("pipeline/caller")


def file_sha(data: bytes) -> str:
    """Plain sha256 of a file's exact bytes."""
    return hashlib.sha256(data).hexdigest()


def code_hash(root: Path = REPO) -> str:
    """sha256 over every pipeline/caller/*.py file, sorted by name: name, NUL, bytes, NUL.
    Any code change to the caller pipeline changes it. test/validation-summary.test.ts
    recomputes it the same way."""
    parts: list[bytes] = []
    for path in sorted((root / CODE_DIR).glob("*.py"), key=lambda p: p.name):
        parts += [path.name.encode(), path.read_bytes()]
    return _sha(*parts)


def load_inputs(root: Path = REPO) -> Inputs:
    cat = (root / CATALOG_PATH).read_bytes()
    cfg = (root / CONFIG_PATH).read_bytes()
    tol = (root / TOLERANCES_PATH).read_bytes()
    return Inputs(
        catalog=json.loads(cat),
        config=json.loads(cfg),
        tolerances=json.loads(tol),
        config_hash=_sha(cat, cfg),
        tolerances_hash=_sha(tol),
    )


def catalog_order(catalog: dict[str, Any]) -> list[str]:
    """Choice ids in catalog order: screens in file order, choices by key."""
    return [c["id"] for s in catalog["screens"] for c in s["choices"]]


def season_weight(season: int, anchor: int, half_life: float) -> float:
    return 0.5 ** ((anchor - season) / half_life)
