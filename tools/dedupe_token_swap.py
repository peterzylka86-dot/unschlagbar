#!/usr/bin/env python3
"""
dedupe_token_swap.py — catch duplicate records with token-order swaps.

User reported "Mainka Patrick" + "Patrick Mainka" at the same club —
same player, two records, family-name-first vs given-name-first.
The prior dedupe (`dedupe_data.py`) used a suffix-match heuristic, which
misses this case because neither name is a suffix of the other.

This pass:
  - Groups records by (club, position-bucket)
  - For each pair, checks if their name TOKEN SETS are identical
  - If yes → same human, two records → drop the lower-rated one

Same nationality + overlapping career years are NOT required (a true
last-first swap will pass both anyway, and these are stronger evidence
on their own).

Usage:
  python3 tools/dedupe_token_swap.py           # dry run
  python3 tools/dedupe_token_swap.py --apply   # rewrite JSON
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "src" / "data"
LEAGUES = [
    "bundesliga", "laliga", "seriea", "swiss",
    "ucl", "worldcup", "worldcup2026", "womens",
]

POS_BUCKET = {
    "GK": "G",
    "CB": "D", "LB": "D", "RB": "D",
    "CDM": "M", "CM": "M", "CAM": "M",
    "LW": "F", "RW": "F", "ST": "F",
}


def norm_tokens(s: str) -> frozenset[str]:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return frozenset(t for t in re.findall(r"[a-z]+", s) if t)


def audit_league(league: str) -> tuple[list[dict], list[tuple[dict, dict]]]:
    path = DATA / league / "players.json"
    if not path.exists():
        return [], []
    players: list[dict] = json.loads(path.read_text())

    # Group by (club, position-bucket)
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for p in players:
        bucket = POS_BUCKET.get(p.get("position", ""), "?")
        groups[(p.get("club", ""), bucket)].append(p)

    drop_ids: set[int] = set()
    pairs_flagged: list[tuple[dict, dict]] = []
    for (_, _), roster in groups.items():
        if len(roster) < 2:
            continue
        # Group within roster by token-set
        by_tokens: dict[frozenset[str], list[dict]] = defaultdict(list)
        for p in roster:
            tokens = norm_tokens(p.get("name", ""))
            if len(tokens) >= 2:  # only consider multi-token names
                by_tokens[tokens].append(p)
        for tokens, dupes in by_tokens.items():
            if len(dupes) < 2:
                continue
            # Pick the canonical one (highest rating, then first-seen)
            dupes.sort(key=lambda p: (-(p.get("prime_rating") or 0), 0))
            keep = dupes[0]
            for drop in dupes[1:]:
                drop_ids.add(id(drop))
                pairs_flagged.append((keep, drop))

    kept = [p for p in players if id(p) not in drop_ids]
    return kept, pairs_flagged


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    grand = 0
    for league in LEAGUES:
        kept, flagged = audit_league(league)
        if not flagged:
            print(f"{league:<14} ✓ clean")
            continue
        before = len(kept) + len(flagged)
        grand += len(flagged)
        print(f"\n{league:<14} {before} → {len(kept)} (−{len(flagged)} token-swap dupes)")
        for keep, drop in flagged[:12]:
            print(
                f"   keep '{keep.get('name'):<26}' {keep.get('position'):<3} OVR={keep.get('prime_rating')}"
            )
            print(
                f"   drop '{drop.get('name'):<26}' {drop.get('position'):<3} OVR={drop.get('prime_rating')} @ {drop.get('club')}"
            )
        if len(flagged) > 12:
            print(f"   ... and {len(flagged)-12} more")
        if args.apply:
            (DATA / league / "players.json").write_text(
                json.dumps(kept, ensure_ascii=False, indent=2) + "\n"
            )
    print(f"\nTOTAL: {grand} token-swap dupes")
    if not args.apply:
        print("(dry run — re-run with --apply)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
