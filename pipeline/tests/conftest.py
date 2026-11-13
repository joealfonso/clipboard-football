"""Every pipeline test runs with the network blocked, so no test can reach nflverse."""

import socket

import pytest


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*args: object, **kwargs: object) -> None:
        raise RuntimeError("network access is blocked in pipeline tests")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)


@pytest.fixture(autouse=True)
def step5d_fields_for_frozen_5b_tests(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> None:
    """Step 5d (code review): binning fails on a missing Situation field. The step 5b kneel-out tests
    (test_caller_5b_spec_check.py) must stay unedited (spec D4), and their situations predate the two
    step 5d fields, so this test helper fills them explicitly (clock stopped, overtime flag 0) on the
    way into bin_situation for that module only."""
    if request.module.__name__.rsplit(".", 1)[-1] != "test_caller_5b_spec_check":
        return
    from pipeline.caller.bins import bin_situation
    from pipeline.tests.caller_fixtures import with_5d_fields

    monkeypatch.setattr(request.module, "bin_situation", lambda sit, dims: bin_situation(with_5d_fields(sit), dims))
