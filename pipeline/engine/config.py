"""Paths, designed inputs and hashes for the play engine pipeline. Read-only here."""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pipeline.caller.config import REPO, season_weight

ENGINE_DIR = Path("data/engine")
PLAYERS_DIR = Path("data/players")
CONFIG_PATH = ENGINE_DIR / "config.json"
TOLERANCES_PATH = ENGINE_DIR / "tolerances.json"
MATCHUP_PATH = ENGINE_DIR / "matchup.json"
MATCHUP_CENTERED_PATH = ENGINE_DIR / "matchup.centered.json"
KICKOFF_PATH = ENGINE_DIR / "kickoff.json"
PERSONNEL_PATH = ENGINE_DIR / "personnel.json"
WHY_PATH = ENGINE_DIR / "why.json"
RATINGS_PATH = PLAYERS_DIR / "ratings.json"
NAMES_PATH = PLAYERS_DIR / "names.json"
DISTRIBUTIONS_PATH = PLAYERS_DIR / "distributions.json"
REPORT_PATH = Path("docs/ENGINE_REPORT.md")
VALIDATION_PATH = ENGINE_DIR / "validation.json"

# Generated files written only by this pipeline. Their total size is the size budget (B10).
BASELINE_FILES = ("baseline.scrimmage.json", "baseline.special.json", "baseline.penalties.json")
GENERATED_FILES = (
    *(ENGINE_DIR / f for f in BASELINE_FILES),
    MATCHUP_CENTERED_PATH,
    DISTRIBUTIONS_PATH,
)
SIZE_BUDGET_BYTES = 2_000_000
# Designed engine and player files the validation summary pins by hash.
DESIGNED_FILES = (
    CONFIG_PATH,
    MATCHUP_PATH,
    KICKOFF_PATH,
    PERSONNEL_PATH,
    WHY_PATH,
    RATINGS_PATH,
    NAMES_PATH,
    TOLERANCES_PATH,
    Path("data/rules/nfl-2026.json"),
    # The step 2 caller the validation draws presets and formations from, and the centering uses.
    Path("data/calls/catalog.json"),
    Path("data/caller/config.json"),
    Path("data/caller/offense.table.json"),
    Path("data/caller/defense.table.json"),
)

CODE_DIR = Path("pipeline/engine")


def sha(*parts: bytes) -> str:
    """sha256 over each part followed by a NUL, the same as pipeline/caller/config.py."""
    h = hashlib.sha256()
    for p in parts:
        h.update(p)
        h.update(b"\0")
    return h.hexdigest()


def file_sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


TS_IMPORT = re.compile(r'(?:import|export)\s[^;]*?from\s*"(\.{1,2}/[^"]+)"|import\s*"(\.{1,2}/[^"]+)"')
PY_IMPORT = re.compile(r"^\s*from\s+(pipeline[\w.]*)\s+import\s+(\([^)]*\)|[^\n]+)|^\s*import\s+(pipeline[\w.]*)", re.M)
CODE_ROOTS_TS = (Path("scripts/engine/validate.ts"),)


def _ts_target(src: Path, spec: str) -> Path:
    t = (src.parent / spec)
    return t if t.suffix in (".ts", ".mjs", ".js") else t.with_name(t.name + ".ts")


def _py_module(root: Path, mod: str) -> list[Path]:
    base = Path(*mod.split("."))
    if (root / base).is_dir():
        return [base / "__init__.py"] if (root / base / "__init__.py").exists() else []
    f = base.with_suffix(".py")
    return [f] if (root / f).exists() else []


def code_files(root: Path = REPO) -> list[Path]:
    """Every source the validation and the centering depend on, from the import graph: the
    TypeScript files scripts/engine/validate.ts imports (transitively), the Node hooks in
    scripts/engine, and the pipeline modules pipeline/engine/*.py import (transitively).
    test/engine-validation-summary.test.ts walks the same graph."""
    seen: set[Path] = set()
    stack = [*CODE_ROOTS_TS, *sorted(p.relative_to(root) for p in (root / "scripts/engine").glob("*.mjs"))]
    while stack:
        f = stack.pop()
        if f in seen:
            continue
        seen.add(f)
        if f.suffix != ".ts":
            continue
        for m in TS_IMPORT.finditer((root / f).read_text(encoding="utf-8")):
            spec = m.group(1) or m.group(2)
            t = _ts_target(f, spec)
            stack.append(Path(os.path.normpath(t)))
    pstack = sorted(p.relative_to(root) for p in (root / CODE_DIR).glob("*.py"))
    while pstack:
        f = pstack.pop()
        if f in seen:
            continue
        seen.add(f)
        for m in PY_IMPORT.finditer((root / f).read_text(encoding="utf-8")):
            if m.group(3):
                pstack += _py_module(root, m.group(3))
                continue
            mod, names = m.group(1), m.group(2)
            pstack += _py_module(root, mod)
            for name in re.findall(r"\w+", names.split("#")[0]):
                sub = f"{mod}.{name}"
                if (root / Path(*sub.split("."))).with_suffix(".py").exists() or (root / Path(*sub.split("."))).is_dir():
                    pstack += _py_module(root, sub)
    return sorted(seen, key=lambda p: p.as_posix())


def code_hash(root: Path = REPO) -> str:
    """sha256 over code_files: each file's repo path, NUL, bytes, NUL, sorted by path."""
    parts: list[bytes] = []
    for path in code_files(root):
        parts += [path.as_posix().encode(), (root / path).read_bytes()]
    return sha(*parts)


@dataclass(frozen=True)
class Inputs:
    config: dict[str, Any]
    caller_config: dict[str, Any]
    catalog: dict[str, Any]
    matchup: dict[str, Any]
    personnel: dict[str, Any]
    ratings: dict[str, Any]
    tolerances: dict[str, Any] | None
    # sha256 over catalog, caller config and engine config bytes: what the baseline tables depend on.
    config_hash: str
    matchup_hash: str
    tolerances_hash: str | None


def read_json(root: Path, path: Path) -> Any:
    return json.loads((root / path).read_bytes())


def load_inputs(root: Path = REPO) -> Inputs:
    cat = (root / "data/calls/catalog.json").read_bytes()
    ccfg = (root / "data/caller/config.json").read_bytes()
    ecfg = (root / CONFIG_PATH).read_bytes()
    mat = (root / MATCHUP_PATH).read_bytes()
    tol_path = root / TOLERANCES_PATH
    tol = tol_path.read_bytes() if tol_path.exists() else None
    return Inputs(
        config=json.loads(ecfg),
        caller_config=_caller_cfg(json.loads(ccfg), root),
        catalog=json.loads(cat),
        matchup=json.loads(mat),
        personnel=read_json(root, PERSONNEL_PATH),
        ratings=read_json(root, RATINGS_PATH),
        tolerances=None if tol is None else json.loads(tol),
        config_hash=sha(cat, ccfg, ecfg),
        matchup_hash=sha(mat, (root / PERSONNEL_PATH).read_bytes()),
        tolerances_hash=None if tol is None else sha(tol),
    )


def weights_for(seasons: list[int], anchor: int, half_life: float) -> dict[int, float]:
    return {s: season_weight(s, anchor, half_life) for s in seasons}


def _caller_cfg(cfg: dict[str, Any], root: Path) -> dict[str, Any]:
    from pipeline.caller.config import rules_json, with_rule_play_clock

    return with_rule_play_clock(cfg, rules_json(root))
