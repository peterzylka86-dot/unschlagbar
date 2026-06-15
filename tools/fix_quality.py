#!/usr/bin/env python3
"""
Fix the data-quality issues found by audit_quality.py:
  1. Deduplicate club:name entries (keep the higher prime_rating; ties → first).
  2. Strip a player's primary position from its altPositions.
Applies to every legends league + the real universe. Idempotent.
"""
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), "..", "src", "data")
VALID_POS = {"GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "LW", "RW", "ST"}
FILES = [
    "ucl/players.json",
    "bundesliga/players.json",
    "laliga/players.json",
    "seriea/players.json",
    "swiss/players.json",
    "worldcup/players.json",
    "worldcup2026/players.json",
    "womens/players.json",
    "real/players.json",
]


def main():
    total_dups = 0
    total_alts = 0
    for rel in FILES:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            continue
        players = json.load(open(path, encoding="utf-8"))
        best = {}  # key -> player (highest rating)
        order = []  # preserve first-seen order
        dups = 0
        for p in players:
            key = f"{p.get('club')}:{p.get('name')}"
            # Clean self-referential altPositions.
            if p.get("altPositions"):
                cleaned = [a for a in p["altPositions"] if a != p.get("position") and a in VALID_POS]
                if cleaned != p["altPositions"]:
                    total_alts += 1
                if cleaned:
                    p["altPositions"] = cleaned
                else:
                    p.pop("altPositions", None)
            if key in best:
                dups += 1
                if p.get("prime_rating", 0) > best[key].get("prime_rating", 0):
                    best[key] = p  # keep the stronger duplicate
            else:
                best[key] = p
                order.append(key)
        if dups:
            total_dups += dups
        deduped = [best[k] for k in order]
        json.dump(deduped, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"{rel}: -{dups} dups → {len(deduped)} players")

    print(f"\nTotal duplicates removed: {total_dups} · alt-position cleanups: {total_alts}")


if __name__ == "__main__":
    main()
