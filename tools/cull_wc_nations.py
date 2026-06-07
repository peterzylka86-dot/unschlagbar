#!/usr/bin/env python3
"""
cull_wc_nations.py — drop World Cup nations with ≤2 participations.

User's instinct: too many small nations clutter the WC wheel — Dutch East
Indies (1938 only), Iraq (1986 only), Iceland (2018 only), etc. — drown out
the meaningful historical drafting puzzle.

This implements Option B from the discussion: keep only nations that have
participated in 3+ World Cups across history. Maps directly off jfjelstul's
squad data (every entry is a confirmed WC squad selection).

Effects:
  - Drops ~25-30 single/double-appearance nations
  - Removes their players from worldcup/players.json
  - Removes their entries from worldcup/clubs.json
  - 85 → ~60 nations target

Run from repo root:    python3 tools/cull_wc_nations.py
Use --dry-run to preview without writing.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WC_CLUBS = REPO / "src" / "data" / "worldcup" / "clubs.json"
WC_PLAYERS = REPO / "src" / "data" / "worldcup" / "players.json"
SQUAD_CSV = REPO / "tools" / ".wc_cache" / "squads.csv"

MIN_APPEARANCES = 3

# Even with <3 WC appearances, keep these if they have famous players or
# notable WC moments (clean exception list — defends the heart of football
# fandom against pure numeric cull).
FORCE_KEEP = {
    "wales",          # Bale era, plus 1958 quarter-final run
    "turkey",         # 2002 3rd place (Şükür, Rüştü, Emre Belözoğlu)
    "canada",         # 1986 + 2022 (Davies, Larin — and host in 2026)
    "slovenia",       # Handanović, Birsa era
    "ukraine",        # Shevchenko led 2006 QF run
    "north korea",    # 1966 quarter-final, iconic Cinderella
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--min", type=int, default=MIN_APPEARANCES,
                    help=f"minimum WC appearances to keep (default: {MIN_APPEARANCES})")
    args = ap.parse_args()

    # Count appearances per nation from jfjelstul source-of-truth
    with open(SQUAD_CSV) as f:
        rows = [r for r in csv.DictReader(f) if "Men's" in r["tournament_name"]]
    nation_tournaments: dict[str, set[str]] = defaultdict(set)
    for r in rows:
        nation_tournaments[r["team_name"]].add(r["tournament_id"])

    # Set of nation-name → count
    appearances = {name: len(t) for name, t in nation_tournaments.items()}

    # Map: norm(name) → count, plus accept overrides for renamed nations
    norm_to_count = {norm(name): cnt for name, cnt in appearances.items()}

    # Special-case mappings: some unschlagbar club names don't match jfjelstul.
    # If a nation was renamed (e.g., Yugoslavia → Serbia/Croatia), keep the
    # renamed successors but combine old+new for the appearance count.
    NAME_ALIASES = {
        # unschlagbar name (as in clubs.json) → jfjelstul name
        "korea republic": "south korea",
        "ivory coast": "ivory coast",       # same
        "iran (islamic republic)": "iran",
        # Some unschlagbar nations exist as combined entries — leave them be
    }

    clubs = json.loads(WC_CLUBS.read_text())
    players = json.loads(WC_PLAYERS.read_text())

    keep_clubs = []
    drop_clubs = []
    for c in clubs:
        n = norm(c["name"])
        # Try direct match, then alias
        cnt = norm_to_count.get(n)
        if cnt is None:
            aliased = NAME_ALIASES.get(c["name"].lower())
            if aliased:
                cnt = norm_to_count.get(norm(aliased))
        if cnt is None:
            # Unknown — keep by default (safer than dropping)
            cnt = -1
        force_keep = c["id"].lower() in FORCE_KEEP or c["name"].lower() in FORCE_KEEP
        if cnt == -1 or cnt >= args.min or force_keep:
            keep_clubs.append((c, cnt))
        else:
            drop_clubs.append((c, cnt))

    print(f"=== WC nation cull (min {args.min} appearances to keep) ===\n")
    print(f"Keep: {len(keep_clubs)}")
    print(f"Drop: {len(drop_clubs)}")

    if drop_clubs:
        print("\nNations being dropped:")
        for c, cnt in sorted(drop_clubs, key=lambda x: x[0]["name"]):
            n_players = sum(1 for p in players if p["club"] == c["id"])
            print(f"  {c['name']:30}  appearances: {cnt}  ({n_players} players)")

    if not drop_clubs:
        print("\nNothing to drop — bailing.")
        return 0

    drop_ids = {c["id"] for c, _ in drop_clubs}
    new_players = [p for p in players if p["club"] not in drop_ids]
    new_clubs = [c for c, _ in keep_clubs]

    print(f"\nResulting WC:")
    print(f"  Nations: {len(clubs)} → {len(new_clubs)}")
    print(f"  Players: {len(players)} → {len(new_players)}")

    if args.dry_run:
        print("\n--dry-run, not writing.")
        return 0

    WC_PLAYERS.write_text(json.dumps(new_players, indent=2, ensure_ascii=False) + "\n")
    WC_CLUBS.write_text(json.dumps(new_clubs, indent=2, ensure_ascii=False) + "\n")
    print(f"\nWrote {len(new_clubs)} clubs and {len(new_players)} players.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
