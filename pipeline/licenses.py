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
        "FTN charting",
        "CC-BY-SA 4.0",
        "\"FTN Data via nflverse\" (the loader's own message asks for \"ftndata.com via nflverse\").",
        "Roxygen docs of load_ftn_charting() in github.com/nflverse/nflreadr, R/load_ftn_charting.R.",
    ),
)

SUMMARY = (
    "None of these terms forbids redistributing derived aggregates. CC-BY-SA 4.0 (participation and FTN) "
    "requires attribution and, for adapted material, sharing under the same license. The baked caller tables "
    "in data/caller/ aggregate participation and FTN fields, so if they count as adapted material they must "
    "carry these attributions and be offered under CC-BY-SA 4.0. Not checked: the NFL's own terms for the "
    "NGS-sourced participation rows (nflverse publishes them under CC-BY-SA 4.0), and every other table in "
    "this file. The nflreadpy package itself is MIT, which covers its code, not the data."
)
