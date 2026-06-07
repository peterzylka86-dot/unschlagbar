#!/usr/bin/env python3
"""
clean_data.py — autonomous data-hygiene cleanup across all leagues.

Fixes that need no judgment call (every change is mechanical):

  1. Strip leading shirt-number prefixes like "12\\xa0O. Hargreaves"
     (some FIFA-scrape source included shirt numbers with non-breaking
     spaces).
  2. Strip trailing era suffixes like "Roberto Carlos 90" / "Luís Figo 90s"
     / "Salvatore Bagni 80b" — these were AI-appended era markers that
     should live in career_years, not the name field.
  3. Deduplicate exact duplicates (same normalized name + position + club).
     Keep the entry with the highest prime_rating; merge career_years
     to widest span.
  4. Fix invalid positions LM/RM by mapping to CM (the closest valid).
  5. Add 'tunisia' to WC clubs.json — Tunisia is a real WC nation and
     8 players are orphaned at club id 'tunisia'.

Does NOT touch entries that need judgment (suspect player assignments,
rating calibration, etc.). Those go in a separate review pass.

Run from repo root:    python3 tools/clean_data.py
Use --dry-run to preview.
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


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


# Patterns:
LEADING_NUM_RE = re.compile(r"^\d{1,2}[\s ]+")            # "12\xa0O. Hargreaves"
TRAILING_ERA_RE = re.compile(r"\s+\d{1,2}(?:s|b)?\s*$")        # "Roberto Carlos 90", "Bagni 80b"
TRAILING_PAREN_RE = re.compile(r"\s*\([^)]*\)\s*$")            # "(return)" etc — used sparingly

# Position normalization
POS_FIX = {"LM": "CM", "RM": "CM"}


def clean_name(name: str) -> str:
    s = name.replace(" ", " ")  # collapse non-breaking spaces first
    s = LEADING_NUM_RE.sub("", s)
    s = TRAILING_ERA_RE.sub("", s)
    s = TRAILING_PAREN_RE.sub("", s)
    return s.strip()


def parse_years(s: str) -> tuple[int, int] | None:
    if not s:
        return None
    yrs = re.findall(r"(?:19|20)\d{2}", s)
    if not yrs:
        return None
    nums = [int(y) for y in yrs]
    return (min(nums), max(nums))


def merge_years(a: str, b: str) -> str:
    pa, pb = parse_years(a), parse_years(b)
    if not pa: return b
    if not pb: return a
    return f"{min(pa[0], pb[0])}-{max(pa[1], pb[1])}"


def fix_league(league: str, dry_run: bool) -> dict:
    path = DATA / league / "players.json"
    players = json.loads(path.read_text())
    stats = {"name_stripped": 0, "pos_fixed": 0, "dedup_removed": 0}

    # Pass 1: name + position normalization
    for p in players:
        old = p["name"]
        new = clean_name(old)
        if new != old:
            p["name"] = new
            stats["name_stripped"] += 1
        if p.get("position") in POS_FIX:
            p["position"] = POS_FIX[p["position"]]
            stats["pos_fixed"] += 1

    # Pass 2: dedupe by (normalized_name, position, club). Merge career_years,
    # keep highest prime_rating, prefer entry with longer name (more complete).
    groups: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    for p in players:
        groups[(norm(p["name"]), p["position"], p["club"])].append(p)

    deduped: list[dict] = []
    for key, group in groups.items():
        if len(group) == 1:
            deduped.append(group[0])
            continue
        # Pick best entry
        best = max(group, key=lambda x: (x.get("prime_rating", 0), len(x.get("name", ""))))
        # Merge career_years across all duplicates
        merged_years = best.get("career_years", "")
        for x in group:
            if x is best:
                continue
            merged_years = merge_years(merged_years, x.get("career_years", ""))
        best = dict(best)
        best["career_years"] = merged_years
        deduped.append(best)
        stats["dedup_removed"] += len(group) - 1

    if not dry_run:
        path.write_text(json.dumps(deduped, indent=2, ensure_ascii=False) + "\n")
    stats["final_count"] = len(deduped)
    return stats


def add_tunisia(dry_run: bool) -> dict:
    """Add Tunisia as a WC club if missing."""
    clubs_path = DATA / "worldcup" / "clubs.json"
    clubs = json.loads(clubs_path.read_text())
    if any(c["id"] == "tunisia" for c in clubs):
        return {"added": False, "reason": "already exists"}
    # Build a club entry matching the existing schema (sample from existing entries)
    sample = clubs[0]
    new_club = {
        "id": "tunisia",
        "name": "Tunisia",
        "short": "TUN",
        "city": "Tunis",
        "color": "#e70013",  # Tunisian flag red
        "founded": 1960,
        "strength": 78,
        "era": "current",
        "era_tier": "current",
    }
    # Match schema by including only keys present in sample
    new_club = {k: new_club.get(k) for k in sample.keys() if k in new_club}
    # Add era_tiers if the sample uses it
    if "era_tiers" in sample:
        new_club["era_tiers"] = ["current", "00s", "90s"]
    clubs.append(new_club)
    if not dry_run:
        clubs_path.write_text(json.dumps(clubs, indent=2, ensure_ascii=False) + "\n")
    return {"added": True, "entry": new_club}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print("Adding Tunisia to WC clubs:")
    t = add_tunisia(args.dry_run)
    print(f"  {t}")
    print()

    print(f"{'League':12} {'NameFix':>8} {'PosFix':>8} {'Dedup-':>8} {'Final':>8}")
    print("-" * 60)
    for L in LEAGUES:
        s = fix_league(L, args.dry_run)
        print(f"{L:12} {s['name_stripped']:>8} {s['pos_fixed']:>8} {s['dedup_removed']:>8} {s['final_count']:>8}")

    if args.dry_run:
        print("\n--dry-run, not writing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
