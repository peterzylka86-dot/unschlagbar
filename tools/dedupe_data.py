#!/usr/bin/env python3
"""
dedupe_data.py — remove duplicate player records.

Two duplicate classes addressed here. Cross-club dupes (Sergio Ramos at
Sevilla AND Real Madrid in same league with overlapping years) are NOT
touched — most are real transfers and need human judgment. That stays
in audit_data.py as a manual review queue.

CLASS A — EXACT DUPLICATES
  Same (norm-name, position, club) appearing twice or more within one
  league. Clear data-entry bug. Keep the FIRST occurrence; drop the rest.

CLASS B — NAME-VARIANT DUPLICATES (the Mendieta case)
  Within ONE club ONE league, two records like "Mendieta" + "Gaizka
  Mendieta" — different spelling, same human. Detection rule:

    Two records A, B at the same (league, club) are flagged as variants if:
      • Same nationality
      • Career years overlap (or are identical)
      • Norm-name of one is a contiguous suffix of the other's tokens
        (e.g. ["mendieta"] is a suffix of ["gaizka", "mendieta"])
      • Same simplified position bucket (G/D/M/F) — guards against
        unrelated single-name brothers / father-son.

  When flagged, KEEP the longer-name record (more specific is more
  helpful in UI). Tie-break: higher prime_rating wins. If ratings tie
  too, keep the first.

Usage:
    python3 tools/dedupe_data.py           # dry run, prints report
    python3 tools/dedupe_data.py --apply   # rewrites *.json files
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

# Simplified position bucket for the variant check — guards against
# flagging an unrelated player who happens to share a last name.
POS_BUCKET = {
    "GK": "G",
    "CB": "D", "LB": "D", "RB": "D",
    "CDM": "M", "CM": "M", "CAM": "M",
    "LW": "F", "RW": "F", "ST": "F",
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]+", " ", s).strip()


def tokens(s: str) -> list[str]:
    return [t for t in norm(s).split() if t]


def parse_years(s: str) -> tuple[int, int] | None:
    if not s:
        return None
    m = re.match(r"(\d{4})\s*[–\-—‐‑‒]?\s*(\d{4})?", s)
    if not m:
        return None
    a = int(m.group(1))
    b = int(m.group(2)) if m.group(2) else a
    return (min(a, b), max(a, b))


def overlap(a: tuple[int, int] | None, b: tuple[int, int] | None) -> bool:
    if a is None or b is None:
        return True  # missing data = don't rule out, conservative
    return not (a[1] < b[0] or b[1] < a[0])


def is_name_suffix(short_tokens: list[str], long_tokens: list[str]) -> bool:
    """Is `short_tokens` a contiguous tail of `long_tokens`?"""
    n = len(short_tokens)
    if n == 0 or n >= len(long_tokens):
        return False
    return long_tokens[-n:] == short_tokens


def dedupe_league(league: str) -> tuple[list[dict], list[dict], list[dict]]:
    """Returns (kept, dropped_exact, dropped_variant)."""
    path = DATA / league / "players.json"
    if not path.exists():
        return [], [], []
    players: list[dict] = json.loads(path.read_text())

    # Pass 1 — exact duplicates by (norm-name, position, club).
    # Keep first seen; everything after is a dupe.
    seen_exact: set[tuple[str, str, str]] = set()
    after_exact: list[dict] = []
    dropped_exact: list[dict] = []
    for p in players:
        key = (norm(p.get("name", "")), p.get("position", ""), p.get("club", ""))
        if key in seen_exact:
            dropped_exact.append(p)
            continue
        seen_exact.add(key)
        after_exact.append(p)

    # Pass 2 — name-variant duplicates within (club, position-bucket).
    # Group by (club, position-bucket) then compare every pair.
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for p in after_exact:
        bucket = POS_BUCKET.get(p.get("position", ""), "?")
        groups[(p.get("club", ""), bucket)].append(p)

    drop_indices: set[int] = set()  # indices INTO after_exact to drop
    # Reverse map for index lookup
    idx_of = {id(p): i for i, p in enumerate(after_exact)}
    pairs_flagged: list[tuple[dict, dict, str]] = []

    for (club, bucket), entries in groups.items():
        if len(entries) < 2:
            continue
        for i in range(len(entries)):
            a = entries[i]
            if idx_of[id(a)] in drop_indices:
                continue
            for j in range(len(entries)):
                if i == j:
                    continue
                b = entries[j]
                if idx_of[id(b)] in drop_indices:
                    continue
                if a.get("nationality") != b.get("nationality"):
                    continue
                ay = parse_years(a.get("career_years", ""))
                by = parse_years(b.get("career_years", ""))
                if not overlap(ay, by):
                    continue
                at = tokens(a.get("name", ""))
                bt = tokens(b.get("name", ""))
                # Identical token sets: already caught by exact pass.
                if at == bt:
                    continue
                # Order so `short` is suffix of `long`.
                if is_name_suffix(at, bt):
                    short, long_, short_p, long_p = at, bt, a, b
                elif is_name_suffix(bt, at):
                    short, long_, short_p, long_p = bt, at, b, a
                else:
                    continue
                # Keep the one with the LONGER name (more specific).
                # Tie-break by higher rating (already differs by name here
                # so we won't ever hit the tie).
                keep = long_p
                drop = short_p
                # If short-name has a clearly higher rating, prefer it as
                # the canonical one (its variant is the "real" record).
                sp = short_p.get("prime_rating", 0) or 0
                lp = long_p.get("prime_rating", 0) or 0
                if sp > lp + 2:  # 2-point band tolerates noise
                    keep, drop = short_p, long_p
                drop_idx = idx_of[id(drop)]
                if drop_idx not in drop_indices:
                    drop_indices.add(drop_idx)
                    pairs_flagged.append((keep, drop, club))

    dropped_variant = [after_exact[i] for i in sorted(drop_indices)]
    kept = [p for i, p in enumerate(after_exact) if i not in drop_indices]
    return kept, dropped_exact, dropped_variant


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="rewrite JSON files")
    parser.add_argument("--league", help="limit to one league")
    args = parser.parse_args()

    leagues = [args.league] if args.league else LEAGUES
    grand_exact = 0
    grand_variant = 0
    grand_total = 0

    for league in leagues:
        kept, dropped_exact, dropped_variant = dedupe_league(league)
        total_before = len(kept) + len(dropped_exact) + len(dropped_variant)
        grand_exact += len(dropped_exact)
        grand_variant += len(dropped_variant)
        grand_total += total_before
        if not (dropped_exact or dropped_variant):
            print(f"{league:<14} ✓ clean ({total_before} players)")
            continue
        print(
            f"\n{league:<14} {total_before} → {len(kept)} "
            f"(−{len(dropped_exact)} exact, −{len(dropped_variant)} variant)"
        )
        for p in dropped_exact[:10]:
            print(f"   exact drop: {p.get('name'):<28} {p.get('position'):<4} @ {p.get('club')}")
        if len(dropped_exact) > 10:
            print(f"   ... and {len(dropped_exact)-10} more exact")
        for p in dropped_variant[:10]:
            print(
                f"   variant drop: {p.get('name'):<28} {p.get('position'):<4} "
                f"@ {p.get('club'):<14} years={p.get('career_years')}"
            )
        if len(dropped_variant) > 10:
            print(f"   ... and {len(dropped_variant)-10} more variant")

        if args.apply:
            path = DATA / league / "players.json"
            path.write_text(json.dumps(kept, ensure_ascii=False, indent=2) + "\n")

    print(f"\n{'='*60}")
    print(f"TOTAL: {grand_total} players · drop {grand_exact} exact · drop {grand_variant} variant")
    if not args.apply:
        print("(dry run — re-run with --apply to write changes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
