"""License findings for the nflverse tables the game derives data from.

Checked by hand on 11 November 2026 against nflverse's own repositories (primary sources), not
fetched at run time. Rendered into docs/DATA.md. Not legal advice.
"""

from dataclasses import dataclass

# Written out in words: DATA.md must not contain anything that looks like a run timestamp.
CHECKED = "11 November 2026"


@dataclass(frozen=True)
class LicenseFinding:
    table: str
    license: str
    attribution: str
    source: str


FINDINGS: tuple[LicenseFinding, ...] = (
    LicenseFinding(
        "Play-by-play",
        "CC-BY 4.0",
        "Credit nflverse.",
        "LICENSE.md in github.com/nflverse/nflverse-data (the release repo the file is downloaded from) "
        "and in github.com/nflverse/nflverse-pbp: Creative Commons Attribution 4.0 International.",
    ),
    LicenseFinding(
        "Participation",
        "CC-BY-SA 4.0",
        "\"NFL NextGenStats via nflverse\" for 2022 and earlier; \"FTN Data via nflverse\" from 2023.",
        "Roxygen docs of load_participation() in github.com/nflverse/nflreadr, R/load_participation.R: "
        "data before 2023 is from NFL NGS, from 2023 courtesy of FTN, released under CC-BY-SA 4.0.",
    ),
    LicenseFinding(
        "Combine",
        "CC-BY 4.0 (the nflverse-data release repo's license); upstream source Pro Football Reference, whose terms of use "
        "(sports-reference.com/termsofuse.html, updated 19 May 2023) allow reuse with credit, forbid building a competing "
        "database (5.10) and forbid using their data to train, prompt or instruct AI (5.11)",
        "Combine data courtesy of Pro Football Reference, via nflverse.",
        "LICENSE.md in github.com/nflverse/nflverse-data (Creative Commons Attribution 4.0 International), the repo whose "
        "`combine` release the file is downloaded from; that release's notes say \"NFL Combine Data courtesy of PFR\"; "
        "roxygen docs of load_combine() in github.com/nflverse/nflreadr, R/load_combine.R: \"Loads combine data since 2000 "
        "courtesy of PFR\". Pro Football Reference's terms: sports-reference.com/termsofuse.html. What ships: only "
        "per-position percentile cut points per drill (data/players/distributions.json), never a player row, name or id. "
        "Cut points are at 5% to 95% only (no minimum or maximum), each the mean of the five results nearest its rank, and a "
        "drill is tabled for a position only with at least 20 players, so no cut point is one player's measurement. Joseph's "
        "call on 5.10 and 5.11 (12 November 2026): the file is published under his judgment as a hobby project, to be revisited "
        "if the project goes beyond that (docs/DECISIONS.md, the \"Public repo\" entry).",
    ),
    LicenseFinding(
        "FTN charting",
        "CC-BY-SA 4.0",
        "\"FTN Data via nflverse\" (the loader's own message asks for \"ftndata.com via nflverse\").",
        "Roxygen docs of load_ftn_charting() in github.com/nflverse/nflreadr, R/load_ftn_charting.R.",
    ),
)

SUMMARY = (
    "None of the nflverse terms forbids redistributing derived aggregates. CC-BY-SA 4.0 (participation and FTN) "
    "requires attribution and, for adapted material, sharing under the same license. The baked caller tables "
    "in data/caller/ aggregate participation and FTN fields, so if they count as adapted material they must "
    "carry these attributions and be offered under CC-BY-SA 4.0. Pro Football Reference's terms for the combine rows "
    "(Combine row) add two limits: no competing database (5.10) and no use to train, prompt or instruct AI (5.11); "
    "the engine's player tables (data/players/distributions.json) hold only per-position percentile cut points derived "
    "from the combine, published under Joseph's call on 5.11 as a hobby project, to be revisited if the project goes beyond "
    "that (docs/DECISIONS.md, the \"Public repo\" entry). Not checked: the NFL's own terms for the NGS-sourced "
    "participation rows (nflverse publishes them under CC-BY-SA 4.0), and every other table in this file. The nflreadpy "
    "package itself is MIT, which covers its code, not the data."
)

LOCAL_ONLY = (
    "Local-only file: pipeline/game/real_names.py, a hand-kept list of real NFL nicknames and cities used only to reject "
    "collisions with the designed fictional team names (data/teams/names.json, M1 step 5). It is gitignored, never shipped and "
    "never committed; the collision check runs locally, and CI skips it when the file is absent."
)
