#!/usr/bin/env python3
"""
cleanup_gcz.py — remove players incorrectly assigned to Grasshopper Club Zürich.

The Swiss league dataset was AI-generated and 12 entries at 'grasshopper'
appear to have never played for the club at the listed era. This script
removes 11 of them outright and corrects the era on the 12th (Chapuisat,
who DID play at GCZ — but late career 1999-2005, not 1989-1991).

For each removed entry, the player's real iconic Swiss club is noted in
the REMOVAL_REASON dict — useful as a checklist if we later want to do
a relocation pass that adds them to the correct club instead of just
deleting them. This script does NOT do that relocation; it only removes
from GCZ.

Run from repo root:    python3 tools/cleanup_gcz.py
Use --dry-run to preview without writing.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PLAYERS = REPO / "src" / "data" / "swiss" / "players.json"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


# name -> real Swiss club they actually played at (for future re-add reference)
REMOVAL_REASON = {
    "Andy Egli":           "Wettingen / Dortmund / Servette / Xamax / Aarau — never GCZ",
    "Adrian Knup":         "Aarau / Lucerne / Stuttgart / Galatasaray — no clear GCZ stint",
    "Marc Hottiger":       "Sion / Lausanne / Newcastle / Everton",
    "Marco Pascolo":       "Xamax / Cagliari",
    "Christophe Ohrel":    "Servette / Rennes",
    "Eric Hassli":         "FC Zürich (2007-2009 was at FCZ, not GCZ)",
    "Mehmet Yılmaz":       "FC Zürich",
    "Stephane Grichting":  "Sion / Auxerre / Bellinzona",
    "Almen Abdi":          "Le Mont / Watford / Sheff Wed (no Swiss top-flight stint at this rating)",
    "Davide Chiumiento":   "Juventus academy / Lugano / Vancouver",
    "Erich Burgener":      "Lausanne / Servette",
}

# Era correction: Chapuisat DID play at GCZ but only late career.
ERA_CORRECTIONS = {
    "Stéphane Chapuisat": ("1989-1991", "1999-2005"),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    players = json.loads(PLAYERS.read_text())
    removal_norms = {norm(n) for n in REMOVAL_REASON}
    correction_norms = {norm(n): v for n, v in ERA_CORRECTIONS.items()}

    kept: list[dict] = []
    removed: list[dict] = []
    corrected: list[tuple[dict, str, str]] = []

    for p in players:
        if p["club"] != "grasshopper":
            kept.append(p)
            continue
        np = norm(p["name"])
        if np in removal_norms:
            removed.append(p)
            continue
        if np in correction_norms:
            old_years, new_years = correction_norms[np]
            if p.get("career_years") == old_years:
                corrected.append((p, old_years, new_years))
                p = dict(p)
                p["career_years"] = new_years
        kept.append(p)

    print(f"Total before: {len(players)}")
    print(f"Total after:  {len(kept)} (-{len(removed)})")
    print()
    print("Removed (these belong elsewhere — see REMOVAL_REASON):")
    for p in removed:
        reason = REMOVAL_REASON.get(p["name"], "")
        print(f"  - {p['name']:28} {p['career_years']:12}  →  {reason}")
    print()
    print("Era-corrected:")
    for p, old, new in corrected:
        print(f"  ~ {p['name']:28} {old} → {new}")

    if args.dry_run:
        print("\n--dry-run, not writing.")
        return 0

    PLAYERS.write_text(json.dumps(kept, indent=2, ensure_ascii=False) + "\n")
    print(f"\nWrote {len(kept)} players to {PLAYERS.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
