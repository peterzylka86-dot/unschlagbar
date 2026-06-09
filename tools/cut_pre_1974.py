#!/usr/bin/env python3
"""
cut_pre_1974.py — remove players whose entire career ended before 1974,
keeping a curated list of universal-recognition pre-1974 legends.

Rule:
  Cut if (career_years' END YEAR < 1974) AND (name NOT in PRESERVE).

  Players who played in 1974 or later (including the 1974 World Cup
  squads) are KEPT regardless — the cut is "ended before 1974,"
  strictly less-than.

Rationale (from user):
  > Can we simply remove all pre 1974 stars? Or rather just keep
  > like the superstars? Pele and so on?

  Most pre-1974 records in the dataset are obscure 1920s-1960s
  players (especially in worldcup which has 1247 such records). The
  LLM that generated the dataset hallucinated more in the long tail.
  Cutting the obscure pre-1974 tail while preserving the recognized
  legends improves data quality without sacrificing the "60 years of
  legends" claim.

Safety:
  The wheel's pre-spin filter (clubHasCompatible) already skips clubs
  with no compatible players for the user's open slots, so any
  position-coverage gaps caused by the cut degrade gracefully — the
  wheel just doesn't land on that club for that slot type.

Usage:
  python3 tools/cut_pre_1974.py            # dry run, report
  python3 tools/cut_pre_1974.py --apply    # rewrite JSON
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "src" / "data"
LEAGUES = [
    "bundesliga", "laliga", "seriea", "swiss",
    "ucl", "worldcup", "worldcup2026", "womens",
]

CUTOFF = 1974

# Hand-curated list of universal-recognition pre-1974 legends that
# MUST be preserved even if their career_years end before 1974.
# These are the "if I cut Pelé it would be wrong" set.
PRESERVE: set[str] = {
    # All-time top tier
    "Pelé", "Alfredo Di Stéfano", "Ferenc Puskás", "Johan Cruyff",
    "Bobby Charlton", "Bobby Moore", "Stanley Matthews",
    "Lev Yashin", "Garrincha", "Eusébio", "Just Fontaine",
    # English greats
    "Gordon Banks", "Jimmy Greaves", "Denis Law", "Geoff Hurst",
    "Tom Finney", "Nat Lofthouse",
    # German greats whose careers ended pre-1974
    "Uwe Seeler", "Helmut Rahn", "Fritz Walter", "Hans Schäfer",
    "Helmut Haller", "Lothar Emmerich", "Wolfgang Weber",
    "Karl-Heinz Schnellinger", "Werner Liebrich", "Hans Tilkowski",
    "Max Morlock", "Helmut Haller",
    # Italian greats
    "Sandro Mazzola", "Gianni Rivera", "Giacinto Facchetti",
    "Luis Suárez Miramontes", "Giampiero Boniperti",
    "Omar Sívori", "Cesare Maldini", "John Charles",
    "Giuseppe Meazza", "Silvio Piola", "Valentino Mazzola",
    "Gianni Brera",
    # Spanish greats
    "Telmo Zarra", "Francisco Gento", "Ladislao Kubala",
    # French greats
    "Raymond Kopa",
    # Portuguese
    "Mário Coluna",
    # Hungarian "Magnificent Magyars"
    "Nándor Hidegkuti", "Sándor Kocsis",
    # Brazilian
    "Vavá", "Didi", "Tostão", "Gérson",
    # Scandinavian / other
    "Gunnar Nordahl",
}


def end_year(s: str | None) -> int | None:
    if not s:
        return None
    if "present" in s.lower():
        return 2026
    matches = re.findall(r"\d{4}", s)
    return int(matches[-1]) if matches else None


def process(args: argparse.Namespace) -> int:
    grand_before = 0
    grand_after = 0
    grand_cut = 0
    grand_preserved_legends = 0

    for league in LEAGUES:
        path = DATA / league / "players.json"
        if not path.exists():
            continue
        d = json.loads(path.read_text())
        before = len(d)
        cut: list[dict] = []
        preserved: list[dict] = []
        kept: list[dict] = []
        for p in d:
            ey = end_year(p.get("career_years"))
            if ey is None or ey >= CUTOFF:
                kept.append(p)
                continue
            # Career ended pre-1974
            if p.get("name") in PRESERVE:
                preserved.append(p)
                kept.append(p)  # legends survive the cut
            else:
                cut.append(p)
        after = len(kept)
        grand_before += before
        grand_after += after
        grand_cut += len(cut)
        grand_preserved_legends += len(preserved)
        print(f"{league:<14} {before:>5} → {after:>5}  (cut {len(cut):>4}, preserved {len(preserved)} legends)")
        if preserved:
            for p in preserved[:5]:
                print(f"    legend kept: {p['name']:<28} @ {p['club']:<15} ({p.get('career_years')})")
            if len(preserved) > 5:
                print(f"    ... and {len(preserved) - 5} more")
        if args.apply:
            path.write_text(json.dumps(kept, ensure_ascii=False, indent=2) + "\n")

    print(f"\n{'='*60}")
    print(f"TOTAL: {grand_before} → {grand_after}  (cut {grand_cut} records, preserved {grand_preserved_legends} legends)")
    if not args.apply:
        print("(dry run — re-run with --apply to commit the cut)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    return process(args)


if __name__ == "__main__":
    sys.exit(main())
