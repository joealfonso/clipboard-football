"""M4 milestone A, criterion A3 (docs/specs/m4-franchise-core.md): the real-name check covers
data/franchise and fails a fixture containing a real conference, division, team or title game name.

The real-name list is local only (gitignored), so CI skips these tests. Real names are read from
the local-only list itself, so none is written in this repo. Every fixture is a shipped file with
string values replaced, so it keeps the shape the strict schema accepts."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
FRANCHISE = REPO / "data/franchise"


def _file(name: str) -> dict:
    return json.loads((FRANCHISE / name).read_text(encoding="utf-8"))


def _conference_name(league: dict, text: str) -> None:
    league["conferences"][0]["name"] = text


def _conference_id(league: dict, text: str) -> None:
    league["conferences"][1]["id"] = text


def _division(league: dict, text: str) -> None:
    league["divisions"][0] = text


def _title_game(league: dict, text: str) -> None:
    league["titleGame"] = text


# Every name the league file ships is one of these.
PLACES = [_conference_name, _conference_id, _division, _title_game]


def _shape(value: object) -> object:
    if isinstance(value, dict):
        return {k: _shape(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_shape(v) for v in value]
    return type(value).__name__


def _fixtures(text: str) -> list[dict]:
    out = []
    for put in PLACES:
        league = _file("league.json")
        put(league, text)
        assert _shape(league) == _shape(_file("league.json"))
        out.append(league)
    return out


def _spellings(name: str) -> list[str]:
    """The ways a real name could sit in a longer fictional one."""
    title = name.title()
    return [
        name, title, name.upper(), f"The {title}", f"{title} Conference", f"{title} Founders Conference", f"{title} Frontier North", f"Founders {title}",
        f"{title} Cup", f"{title} Division", title[:-1] if title.endswith("s") else f"{title}s", title.replace(" ", ""), title.replace(" ", "-"), title.replace(" ", "_").lower(),
    ]


def test_franchise_data_has_no_real_name():
    real_names = pytest.importorskip("pipeline.game.real_names")
    assert real_names.check_franchise_dir(FRANCHISE) == []
    for f in FRANCHISE.glob("*.json"):
        assert real_names.franchise_collisions(_file(f.name)) == [], f.name


@pytest.mark.parametrize("group", ["LEAGUES", "CONFERENCES", "DIVISIONS", "DIVISION_WORDS", "TITLE_GAMES", "NICKNAMES", "CITIES"])
def test_a_real_name_inside_any_shipped_name_fails(group):
    real_names = pytest.importorskip("pipeline.game.real_names")
    for name in sorted(getattr(real_names, group)):
        for text in _spellings(name):
            for league in _fixtures(text):
                assert real_names.franchise_collisions(league), text


def test_a_real_place_and_nickname_together_fail():
    real_names = pytest.importorskip("pipeline.game.real_names")
    for place in sorted(real_names.CITIES)[:20]:
        for nickname in sorted(real_names.NICKNAMES)[:20]:
            for league in _fixtures(f"{place.title()} {nickname.title()}"):
                assert len(real_names.franchise_collisions(league)) >= 2


def test_a_real_name_fails_through_the_directory_check(tmp_path):
    real_names = pytest.importorskip("pipeline.game.real_names")
    for name in ("league.json", "roster.json", "pool.json", "draft-ai.json"):
        (tmp_path / name).write_text(json.dumps(_file(name)), encoding="utf-8")
    assert real_names.check_franchise_dir(tmp_path) == []
    league = _file("league.json")
    _title_game(league, f"{sorted(real_names.TITLE_GAMES)[0].title()} Trophy")
    (tmp_path / "league.json").write_text(json.dumps(league), encoding="utf-8")
    assert [c.split(":")[0] for c in real_names.check_franchise_dir(tmp_path)]


def test_every_file_is_read_keys_included():
    real_names = pytest.importorskip("pipeline.game.real_names")
    nickname = sorted(n for n in real_names.NICKNAMES if n.isalpha() and n.endswith("s"))[0]
    ai = _file("draft-ai.json")
    ai["styles"][f"{nickname}Style"] = copy.deepcopy(next(iter(ai["styles"].values())))
    assert real_names.franchise_collisions(ai)
    pool = _file("pool.json")
    pool["tuning"]["command"] = f"tune {nickname}"
    assert real_names.franchise_collisions(pool)


def test_a_citation_may_name_the_league():
    real_names = pytest.importorskip("pipeline.game.real_names")
    mark = sorted(real_names.LEAGUES)[0].upper()
    for name, key in (("league.json", "note"), ("roster.json", "note"), ("roster.json", "rosterSizeSource"), ("pool.json", "note")):
        data = _file(name)
        data[key] = f"{mark} source"
        assert real_names.franchise_collisions(data) == [], (name, key)
    pool = _file("pool.json")
    pool["tuning"]["note"] = f"{mark} source"
    assert real_names.franchise_collisions(pool) == []


def test_compass_and_fictional_names_pass():
    real_names = pytest.importorskip("pipeline.game.real_names")
    for text in ("North", "South", "East", "West", "Central", "Founders Conference", "Frontier Conference", "Clipboard Cup", "Harborview Lanterns"):
        for league in _fixtures(text):
            assert real_names.franchise_collisions(league) == [], text
