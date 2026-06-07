#!/usr/bin/env python3
"""
audit_data.py — heuristic audit across all 7 league datasets.

Flags entries likely to be wrong WITHOUT trying to verify every player by
hand. Categories of suspicion:

  1. SCHEMA — missing/empty required fields, malformed career_years
  2. DUPES — exact duplicates (same name+pos+club appearing twice)
  3. CROSS-CLUB DUPES — same player at multiple clubs in the SAME league at
     overlapping years (real transfers would have non-overlapping spans)
  4. IMPOSSIBLE CAREER — career_years spanning >35 years (no human plays
     that long; usually a year-extraction bug)
  5. RATING/CLUB OUTLIER — player rated 90+ at a club whose strongest
     squad-mate is <80 (signals a mis-assigned legend or fabricated star)
  6. UNUSUAL NAME PATTERNS — names with no vowels, single-character
     surnames, etc. Crude but catches some hallucinations.

Output is a structured report. The user / I review the flagged entries
manually before any deletions — heuristics are signals, not verdicts.

Run from repo root:    python3 tools/audit_data.py
Use --league LEAGUE to scope to one league (e.g. --league swiss).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "src" / "data"

LEAGUES = ["bundesliga", "laliga", "seriea", "swiss", "ucl", "worldcup", "womens"]
REQUIRED_FIELDS = {"name", "position", "prime_rating", "career_years", "nationality", "club"}
VALID_POSITIONS = {"GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "LW", "RW", "ST"}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def parse_career_years(s: str) -> tuple[int, int] | None:
    """Return (first_year, last_year) or None if unparseable."""
    if not s:
        return None
    years = re.findall(r"(?:19|20)\d{2}", s)
    if not years:
        return None
    nums = [int(y) for y in years]
    # 'Present' tokens sometimes appear; assume "to now" = 2026
    if "present" in s.lower() or "now" in s.lower():
        nums.append(2026)
    return (min(nums), max(nums))


def audit_league(league: str) -> dict:
    players = json.loads((DATA / league / "players.json").read_text())
    clubs = json.loads((DATA / league / "clubs.json").read_text())
    club_ids = {c["id"] for c in clubs}
    club_names = {c["id"]: c["name"] for c in clubs}

    schema_errors: list[tuple[dict, str]] = []
    dupes: list[tuple[str, str, str, int]] = []
    cross_club_dupes: list[tuple[str, list[dict]]] = []
    impossible_career: list[dict] = []
    rating_outliers: list[tuple[dict, int]] = []
    weird_names: list[dict] = []

    # Schema check
    for p in players:
        missing = REQUIRED_FIELDS - p.keys()
        if missing:
            schema_errors.append((p, f"missing: {missing}"))
        elif p["position"] not in VALID_POSITIONS:
            schema_errors.append((p, f"bad position: {p['position']!r}"))
        elif p["club"] not in club_ids:
            schema_errors.append((p, f"unknown club: {p['club']!r}"))
        elif not isinstance(p["prime_rating"], int) or not (40 <= p["prime_rating"] <= 99):
            schema_errors.append((p, f"bad rating: {p['prime_rating']!r}"))

    # Exact dupes: (norm_name, position, club) appearing >1 time
    counts = Counter((norm(p["name"]), p["position"], p["club"]) for p in players)
    for (n, pos, c), cnt in counts.items():
        if cnt > 1:
            # find original name
            real = next(p["name"] for p in players if norm(p["name"]) == n and p["position"] == pos and p["club"] == c)
            dupes.append((real, pos, c, cnt))

    # Cross-club dupes within the same league
    by_player = defaultdict(list)
    for p in players:
        by_player[norm(p["name"])].append(p)
    for n, entries in by_player.items():
        clubs_for = {e["club"] for e in entries}
        if len(clubs_for) > 1:
            # Check for overlapping career_years
            spans = [parse_career_years(e["career_years"]) for e in entries]
            valid = [(e, s) for e, s in zip(entries, spans) if s]
            if len(valid) >= 2:
                overlapping = False
                for i in range(len(valid)):
                    for j in range(i+1, len(valid)):
                        e1, (s1a, s1b) = valid[i]
                        e2, (s2a, s2b) = valid[j]
                        if e1["club"] != e2["club"] and s1a <= s2b and s2a <= s1b:
                            overlapping = True
                            break
                    if overlapping:
                        break
                if overlapping:
                    cross_club_dupes.append((entries[0]["name"], entries))

    # Impossible careers: span > 35 years (no real career is that long)
    for p in players:
        span = parse_career_years(p["career_years"])
        if span and span[1] - span[0] > 35:
            impossible_career.append(p)

    # Rating outliers: player rated 88+ at a club whose 2nd-strongest is <78
    by_club = defaultdict(list)
    for p in players:
        by_club[p["club"]].append(p)
    for club_id, ps in by_club.items():
        ps.sort(key=lambda x: -x.get("prime_rating", 0))
        if len(ps) < 2:
            continue
        top, second = ps[0], ps[1]
        # Star at a club where the rest of the roster is weak = suspicious
        if top["prime_rating"] >= 88 and second["prime_rating"] < 78:
            rating_outliers.append((top, top["prime_rating"] - second["prime_rating"]))

    # Weird names: extremely short, or containing characters that suggest fabrication
    for p in players:
        n = p["name"]
        if len(n) < 4:
            weird_names.append(p)
        elif n.count(" ") == 0 and len(n) > 25:  # single-token but absurdly long
            weird_names.append(p)
        elif re.search(r"[0-9]", n):  # digits in a name
            weird_names.append(p)

    return {
        "league": league,
        "total_players": len(players),
        "total_clubs": len(clubs),
        "schema_errors": schema_errors,
        "dupes": dupes,
        "cross_club_dupes": cross_club_dupes,
        "impossible_career": impossible_career,
        "rating_outliers": rating_outliers,
        "weird_names": weird_names,
        "club_names": club_names,
    }


def print_report(r: dict) -> None:
    L = r["league"]
    print(f"\n{'='*70}\n{L.upper()} ({r['total_players']} players / {r['total_clubs']} clubs)\n{'='*70}")

    if r["schema_errors"]:
        print(f"\n[SCHEMA] {len(r['schema_errors'])} entries with schema issues:")
        for p, why in r["schema_errors"][:20]:
            print(f"  {p.get('name', '<?>')!r:25} club={p.get('club')!r:20} {why}")
        if len(r["schema_errors"]) > 20:
            print(f"  ... and {len(r['schema_errors'])-20} more")
    else:
        print("\n[SCHEMA] ✓ clean")

    if r["dupes"]:
        print(f"\n[DUPES] {len(r['dupes'])} exact duplicates (same name+position+club twice):")
        for name, pos, club, cnt in r["dupes"][:15]:
            print(f"  {name:25} {pos:4} {club:20} (×{cnt})")
        if len(r["dupes"]) > 15:
            print(f"  ... and {len(r['dupes'])-15} more")
    else:
        print("[DUPES] ✓ no exact duplicates")

    if r["cross_club_dupes"]:
        print(f"\n[CROSS-CLUB] {len(r['cross_club_dupes'])} players at multiple clubs with OVERLAPPING years (means at least one is wrong):")
        for name, entries in r["cross_club_dupes"][:15]:
            print(f"  {name!r}")
            for e in entries:
                print(f"    @ {e['club']:25} {e['career_years']:15} pos={e['position']:4} OVR={e['prime_rating']}")
        if len(r["cross_club_dupes"]) > 15:
            print(f"  ... and {len(r['cross_club_dupes'])-15} more")
    else:
        print("[CROSS-CLUB] ✓ no overlapping-club placements")

    if r["impossible_career"]:
        print(f"\n[IMPOSSIBLE-SPAN] {len(r['impossible_career'])} career spans > 35 years (likely year-extraction bug):")
        for p in r["impossible_career"][:10]:
            print(f"  {p['name']:25} {p['career_years']:20} club={p['club']}")
        if len(r["impossible_career"]) > 10:
            print(f"  ... and {len(r['impossible_career'])-10} more")
    else:
        print("[IMPOSSIBLE-SPAN] ✓ none")

    if r["rating_outliers"]:
        print(f"\n[STAR-AT-WEAK-CLUB] {len(r['rating_outliers'])} elite players at clubs with weak rest-of-squad (≥10 OVR gap to #2):")
        for p, gap in r["rating_outliers"][:10]:
            club_name = r["club_names"].get(p["club"], p["club"])
            print(f"  {p['name']:25} {p['position']:4} OVR={p['prime_rating']} @ {club_name:20} (gap to #2: {gap})")
        if len(r["rating_outliers"]) > 10:
            print(f"  ... and {len(r['rating_outliers'])-10} more")
    else:
        print("[STAR-AT-WEAK-CLUB] ✓ none flagged")

    if r["weird_names"]:
        print(f"\n[WEIRD-NAMES] {len(r['weird_names'])}:")
        for p in r["weird_names"][:10]:
            print(f"  {p['name']!r:25} club={p['club']}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", choices=LEAGUES + ["all"], default="all")
    args = ap.parse_args()

    leagues = [args.league] if args.league != "all" else LEAGUES
    totals = {"schema": 0, "dupes": 0, "cross_club": 0, "impossible": 0,
              "outliers": 0, "weird": 0}
    for L in leagues:
        r = audit_league(L)
        print_report(r)
        totals["schema"]      += len(r["schema_errors"])
        totals["dupes"]       += len(r["dupes"])
        totals["cross_club"]  += len(r["cross_club_dupes"])
        totals["impossible"]  += len(r["impossible_career"])
        totals["outliers"]    += len(r["rating_outliers"])
        totals["weird"]       += len(r["weird_names"])

    print(f"\n\n{'='*70}\nGRAND TOTALS\n{'='*70}")
    for k, v in totals.items():
        print(f"  {k:15} {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
