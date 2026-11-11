"""End to end on stub data: C1 determinism, B4 build failure, B5-B9 report contents, E1-E2 gate."""

import json
from pathlib import Path

import pytest

from pipeline.caller.build import build
from pipeline.caller.validate import Metric, run_validation, wilson
from pipeline.tests.caller_fixtures import PLAYER_ID, PLAYER_NAME, CallerStubSource, make_root

GENERATED = [
    "data/caller/offense.table.json",
    "data/caller/defense.table.json",
    "data/caller/golden.json",
    "data/caller/validation.json",
    "docs/CALLER_REPORT.md",
]


def quiet(_: str) -> None:
    pass


@pytest.fixture(autouse=True)
def small_golden_grid(monkeypatch: pytest.MonkeyPatch) -> None:
    """The real golden grid has about 50,000 situations; every 40th keeps these tests fast."""
    from pipeline.caller import golden

    full = golden.grid
    monkeypatch.setattr(golden, "grid", lambda: full()[::40])


def read_all(root: Path) -> dict[str, bytes]:
    return {p: (root / p).read_bytes() for p in GENERATED}


def test_build_is_deterministic_and_has_no_player_data(tmp_path: Path) -> None:
    a = make_root(tmp_path / "a", tolerance=100.0)
    b = make_root(tmp_path / "b", tolerance=100.0)
    assert build(CallerStubSource(), a, log=quiet) == 0
    first = read_all(a)
    assert build(CallerStubSource(), a, log=quiet) == 0
    assert read_all(a) == first  # same root, rerun: byte-identical
    assert build(CallerStubSource(), b, log=quiet) == 0
    assert read_all(b) == first
    for path, data in first.items():
        text = data.decode()
        assert PLAYER_ID not in text and PLAYER_NAME not in text and "00-0011111" not in text, path


def test_report_has_every_section(tmp_path: Path) -> None:
    root = make_root(tmp_path, tolerance=100.0)
    build(CallerStubSource(), root, log=quiet)
    text = (root / "docs/CALLER_REPORT.md").read_text()
    for needle in (
        "## 1. Exclusions", "| postseason | overtime | no_play | aborted |",
        "### offense_formation", "### defense_coverage_type", "### defense_man_zone_type",
        "### Defense personnel patterns", "`EMPTY` | empty", "`2_MAN` | twoMan",
        "## 3. Coverage charting", "By play type:", "By down:", "By distance:", "By field zone:", "By score:", "By time:",
        "## 4. Blitz on runs vs dropbacks", "## 5. QB sneak rule vs FTN flag", "| runs | FTN flag | inferred rule | both | flag only | rule only |",
        "## 6. Defense mapping mismatches", "| 2018-2023 |", "| 2024-2025 |",
        "## 9. Validation", "Config hash", "Gated failures: 0.",
    ):
        assert needle in text, needle
    summary = json.loads((root / "data/caller/validation.json").read_text())
    groups = {m["group"] for m in summary["metrics"]}
    assert groups == {"passRate", "passRateByDown", "fourthDown", "goForTwo", "kneel", "spike", "depth",
                      "passType", "runType", "formation", "blitz", "man", "preset"}
    for m in summary["metrics"]:
        assert set(m) >= {"predicted", "actual", "n", "ci95", "tolerance", "status"}


def test_gate_fails_after_writing_everything(tmp_path: Path) -> None:
    root = make_root(tmp_path, tolerance=0.0)
    assert build(CallerStubSource(), root, log=quiet) == 1
    for p in GENERATED:
        assert (root / p).exists(), p
    summary = json.loads((root / "data/caller/validation.json").read_text())
    assert summary["passed"] is False and summary["gatedFailures"]
    assert "Gated failures: 0." not in (root / "docs/CALLER_REPORT.md").read_text()


def test_unmapped_value_fails_the_build(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    root = make_root(tmp_path, tolerance=100.0)
    assert build(CallerStubSource(extra_formation="SHOTGUN_SPREAD"), root, log=quiet) == 3
    assert "'SHOTGUN_SPREAD' (1 rows)" in capsys.readouterr().err
    assert not (root / "data/caller/offense.table.json").exists()


def test_summary_records_validated_file_and_code_hashes(tmp_path: Path) -> None:
    import hashlib

    from pipeline.caller.config import code_hash

    root = make_root(tmp_path, tolerance=100.0)
    build(CallerStubSource(), root, log=quiet)
    summary = json.loads((root / "data/caller/validation.json").read_text())
    for name in ("offense.table.json", "defense.table.json", "golden.json"):
        assert summary["fileHashes"][name] == hashlib.sha256((root / "data/caller" / name).read_bytes()).hexdigest()
    assert summary["codeHash"] == code_hash() and len(summary["codeHash"]) == 64


def test_code_hash_changes_with_any_caller_source(tmp_path: Path) -> None:
    import shutil

    from pipeline.caller.config import REPO, code_hash

    shutil.copytree(REPO / "pipeline/caller", tmp_path / "pipeline/caller", ignore=shutil.ignore_patterns("__pycache__"))
    before = code_hash(tmp_path)
    assert before == code_hash()
    with (tmp_path / "pipeline/caller/report.py").open("a") as f:
        f.write("\n# edit\n")
    assert code_hash(tmp_path) != before


def test_skip_validation_removes_a_stale_summary(tmp_path: Path) -> None:
    root = make_root(tmp_path, tolerance=100.0)
    build(CallerStubSource(), root, log=quiet)
    assert (root / "data/caller/validation.json").exists()
    assert build(CallerStubSource(), root, validate=False, log=quiet) == 0
    assert not (root / "data/caller/validation.json").exists()


def test_report_flags_post_hoc_revision_and_approved_deviations(tmp_path: Path) -> None:
    root = make_root(tmp_path, tolerance=100.0)
    tol_path = root / "data/caller/tolerances.json"
    tol = json.loads(tol_path.read_text())
    tol["known_deviations"] = [
        {"metric": "man", "observed": 0.4, "target": 0.35, "reason": "a reason", "date": "2026-11-11", "approved_by": "Joseph"},
        {"metric": "blitz", "observed": 0.4, "target": 0.35, "reason": "not approved", "date": "2026-11-11", "approved_by": None},
    ]
    tol_path.write_text(json.dumps(tol))
    build(CallerStubSource(), root, log=quiet)
    text = (root / "docs/CALLER_REPORT.md").read_text()
    assert "This is not a clean holdout test." in text
    assert "Post-validation revision 1" in text and "revised after holdout" in text
    assert "Approved deviations (data/caller/tolerances.json, approved by Joseph): 1." in text
    assert "| man | 40.0 | 35.0 | 2026-11-11 | a reason |" in text
    assert "not approved" not in text


def test_skip_validation_writes_no_summary(tmp_path: Path) -> None:
    root = make_root(tmp_path)
    assert build(CallerStubSource(), root, validate=False, log=quiet) == 0
    assert not (root / "data/caller/validation.json").exists()
    assert "Not run (`--skip-validation`)." in (root / "docs/CALLER_REPORT.md").read_text()


def test_wilson_interval() -> None:
    lo, hi = wilson(50, 100) or (0, 0)
    assert lo == pytest.approx(0.4038, abs=1e-4) and hi == pytest.approx(0.5962, abs=1e-4)
    assert wilson(0, 0) is None


def test_only_deviations_approved_by_joseph_are_honored() -> None:
    import polars as pl

    class Fake:
        def labels(self, sit):  # noqa: ANN001, ANN202
            return {}

        def offense(self, sit, labels=None):  # noqa: ANN001, ANN202
            return [{"call": "extraPoint", "p": 1.0}], {}

        def defense(self, sit, labels=None):  # noqa: ANN001, ANN202
            return [], {}, {}

    plays = pl.DataFrame(
        [{"phase": "try", "down": None, "ydstogo": 0.0, "yardline_100": 2.0, "score_differential": 0.0, "qtr": 1.0,
          "half_seconds_remaining": 600.0, "game_seconds_remaining": 2400.0, "offense_timeouts": 3.0, "defense_timeouts": 3.0,
          "call": None, "try_call": "goForTwo", "depth": None, "pass_type": None, "run_type": None, "formation": None,
          "rush": None, "man_zone": None, "preset": None, "b_zone6": None, "b_time5": None, "b_score3": None}],
        infer_schema_length=None,
    )
    base = {"metrics": [{"id": "goForTwo", "tolerance": 3.0, "minN": 0}]}
    for approver, status in (("Joseph", "accepted"), ("engineer", "fail"), (None, "fail")):
        tol = {**base, "known_deviations": [{"metric": "goForTwo", "approved_by": approver}]}
        v = run_validation(plays, Fake(), tol)  # type: ignore[arg-type]
        assert [m.status for m in v.metrics] == [status]
    m = Metric("x", "passRate", "x", 3.0, 500)
    m.add(0.5, True)
    assert m.predicted == 0.5 and m.actual == 1.0
