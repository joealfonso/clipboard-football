"""Final review (2026-11-12): known deviations apply only to their own sample, in the engine
validation as in the caller and game paths. An unscoped entry (every step 4 entry) is a holdout
entry and never marks an in-sample miss accepted."""

from __future__ import annotations

import inspect
import json

import pytest

from pipeline.caller.config import REPO
from pipeline.engine import validate as engine_validate
from pipeline.game import build as game_build


def _tol(*entries: dict) -> dict:
    return {"metrics": [], "known_deviations": list(entries)}


def test_unscoped_entry_does_not_accept_an_in_sample_miss() -> None:
    tol = _tol({"metric": "extraPoint", "approved_by": "Joseph"})
    assert "extraPoint" not in engine_validate.approved_for(tol, "insample")
    assert "extraPoint" in engine_validate.approved_for(tol, "holdout")


def test_scoped_entries_apply_only_to_their_own_scope_and_only_from_joseph() -> None:
    tol = _tol(
        {"metric": "a", "approved_by": "Joseph", "scope": "insample"},
        {"metric": "b", "approved_by": "Joseph", "scope": "holdout"},
        {"metric": "c", "approved_by": "someone else", "scope": "insample"},
    )
    assert engine_validate.approved_for(tol, "insample") == {"a"}
    assert engine_validate.approved_for(tol, "holdout") == {"b"}
    with pytest.raises(ValueError):
        engine_validate.approved_for(tol, "validation")


def test_committed_engine_entries_never_reach_the_in_sample_run() -> None:
    tol = json.loads((REPO / "data/engine/tolerances.json").read_text())
    assert tol["known_deviations"], "step 4 entries expected"
    assert all("scope" not in d for d in tol["known_deviations"])
    assert engine_validate.approved_for(tol, "insample") == set()


def test_score_and_component_take_the_scope_explicitly() -> None:
    for fn in (engine_validate.score, game_build.component):
        p = inspect.signature(fn).parameters["scope"]
        assert p.kind is inspect.Parameter.KEYWORD_ONLY and p.default is inspect.Parameter.empty, fn.__name__
