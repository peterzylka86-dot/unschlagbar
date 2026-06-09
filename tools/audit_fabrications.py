#!/usr/bin/env python3
"""
audit_fabrications.py — surface high-risk fabricated/misassigned entries.

After prior passes (exact dupes, name-variants, cross-club dupes, era
mismatches) the next class of bad data is LLM-fabricated names: players
who sound plausible (Germanic surname, era-appropriate career years)
but don't actually exist. These can't be detected by similarity to
other records — they're internally consistent. Detection requires
external signal:

  • OBSCURITY      — name appears in exactly one record across all
                     8 leagues (real legends usually appear in 2+)
  • RATING OUTLIER — player rating is significantly above their club's
                     median (the "legend at a small club" pattern,
                     which is real for genuine legends but also the
                     pattern hallucinations adopt)
  • LONE-CLUB      — small/low-strength club's roster has a few 80+
                     ratings nobody recognizes

This script does NOT auto-delete. It outputs a per-club report sorted
by suspicion score, and the user reviews each cluster.

Usage:
  python3 tools/audit_fabrications.py [--league NAME] [--threshold 78]
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import unicodedata
import re
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "src" / "data"
LEAGUES = [
    "bundesliga", "laliga", "seriea", "swiss",
    "ucl", "worldcup", "worldcup2026", "womens",
]


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]+", " ", s).strip()


def load_all() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for league in LEAGUES:
        path = DATA / league / "players.json"
        if path.exists():
            out[league] = json.loads(path.read_text())
    return out


def build_name_index(all_data: dict[str, list[dict]]) -> dict[str, list[tuple[str, dict]]]:
    """Map normalized name → list of (league, player_record)."""
    idx: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for league, players in all_data.items():
        for p in players:
            key = norm(p.get("name", ""))
            if key:
                idx[key].append((league, p))
    return idx


def audit_league(
    league: str,
    players: list[dict],
    name_idx: dict[str, list[tuple[str, dict]]],
    threshold: int,
) -> None:
    print(f"\n{'='*70}\n{league.upper():<14} fabrication audit (rating ≥ {threshold})\n{'='*70}")

    # Group by club, compute median rating per club
    by_club: dict[str, list[dict]] = defaultdict(list)
    for p in players:
        by_club[p.get("club", "")].append(p)

    # Suspicious entries — sorted by club, then suspicion within club
    suspect_clubs: list[tuple[str, list[tuple[int, dict]]]] = []
    for club, roster in by_club.items():
        if len(roster) < 5:
            continue
        ratings = [p.get("prime_rating") or 0 for p in roster]
        median = statistics.median(ratings)
        flagged: list[tuple[int, dict]] = []
        for p in roster:
            r = p.get("prime_rating") or 0
            if r < threshold:
                continue
            # Suspicion score components
            rating_gap = max(0, r - median)
            key = norm(p.get("name", ""))
            occurrences = len(name_idx.get(key, []))
            # Lower occurrences = more suspicious (real legends appear in
            # multiple leagues; obscure or fabricated names appear once)
            obscurity = 3 if occurrences == 1 else 1 if occurrences == 2 else 0
            # Final score
            score = int(rating_gap) + 5 * obscurity
            if score >= 10:
                flagged.append((score, p))
        if flagged:
            flagged.sort(key=lambda x: -x[0])
            suspect_clubs.append((club, flagged))

    suspect_clubs.sort(key=lambda x: -max(s for s, _ in x[1]))
    for club, flagged in suspect_clubs[:20]:
        roster = by_club[club]
        median = statistics.median([p.get("prime_rating") or 0 for p in roster])
        print(f"\n  📍 {club} (median {median:.0f}, {len(roster)} players)")
        for score, p in flagged[:8]:
            key = norm(p.get("name", ""))
            occ = len(name_idx.get(key, []))
            print(
                f"    [score={score:>3}] {p.get('name'):<28} "
                f"{p.get('position'):<4} OVR={p.get('prime_rating'):<3} "
                f"({p.get('career_years')})  appears in {occ} record(s) "
                f"across all leagues"
            )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--league", help="limit to one league")
    parser.add_argument("--threshold", type=int, default=78, help="rating threshold (default 78)")
    args = parser.parse_args()

    all_data = load_all()
    name_idx = build_name_index(all_data)
    leagues = [args.league] if args.league else LEAGUES
    for league in leagues:
        if league in all_data:
            audit_league(league, all_data[league], name_idx, args.threshold)
    print(f"\n{'='*70}\nReview each cluster. Higher score = more suspicious.")
    print("Cross-reference real player history via Wikipedia / Transfermarkt.")
    print("No auto-delete — surfaced for manual review only.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
