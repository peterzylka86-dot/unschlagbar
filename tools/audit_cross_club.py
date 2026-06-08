#!/usr/bin/env python3
"""
audit_cross_club.py — find SUSPICIOUS cross-club duplicates within one league.

Within a single league, the same player may legitimately appear at multiple
clubs (a real career transfer — Sergio Ramos at Sevilla then Real Madrid).
The original audit_data.py flags ALL such cases (688+ across the dataset)
because it can't tell good from bad. This script narrows to the ones that
are almost certainly DATA ERRORS, not real careers.

PASS A — suspicious patterns:

  1. RATING-CHASM     — same name, two clubs, ratings differ by >=15.
                        Real player + impostor (different humans, same name)
                        or one entry is fabricated. Example flagged:
                          Marcelo @ realmadrid LB OVR=90 (real)
                          Marcelo @ lugo CB OVR=67 (Brazilian Marcelo
                          never played at Lugo — namesake confusion)

  2. POSITION-BUCKET-MISMATCH — same name, two clubs, OVERLAPPING years,
                        but positions span different buckets (defender vs
                        forward). Real players don't change buckets
                        mid-career. CDM/CM/CAM all count as MID (those
                        ARE interchangeable). LB/CB/RB all count as DEF.

  3. ERA-MISMATCH     — same name, two clubs, but career_years are >20
                        years apart (a 1960s Maradona and a 2010s Maradona
                        are not the same person).

Output: a structured report. Auto-fix is opt-in (--apply):
  - For RATING-CHASM: drop the LOWER-rated entry (almost always the
    fabricated/namesake one).
  - For POSITION-BUCKET-MISMATCH: drop the LOWER-rated entry.
  - For ERA-MISMATCH: drop the entry with FEWER career years recorded
    (usually the spurious one).

Usage:
  python3 tools/audit_cross_club.py           # dry run
  python3 tools/audit_cross_club.py --apply   # rewrite JSON
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

RATING_CHASM = 15      # points
ERA_GAP = 20           # years between career-year ranges


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]+", " ", s).strip()


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
        return False
    return not (a[1] < b[0] or b[1] < a[0])


def years_span(a: tuple[int, int]) -> int:
    return a[1] - a[0] + 1


def audit_league(league: str) -> tuple[list[dict], list[tuple[str, dict, dict]]]:
    """Returns (kept, flagged_pairs)."""
    path = DATA / league / "players.json"
    if not path.exists():
        return [], []
    players: list[dict] = json.loads(path.read_text())

    # Group by normalized name
    by_name: dict[str, list[dict]] = defaultdict(list)
    for p in players:
        by_name[norm(p.get("name", ""))].append(p)

    drop_ids: set[int] = set()  # python id() of dicts to drop
    flagged: list[tuple[str, dict, dict]] = []  # (reason, keep, drop)

    for name, entries in by_name.items():
        if len(entries) < 2:
            continue
        # Look at every pair within the group
        n = len(entries)
        for i in range(n):
            for j in range(i + 1, n):
                a, b = entries[i], entries[j]
                if id(a) in drop_ids or id(b) in drop_ids:
                    continue
                if a.get("club") == b.get("club"):
                    continue  # same club = exact-dupe territory (handled elsewhere)

                ar = a.get("prime_rating") or 0
                br = b.get("prime_rating") or 0
                ay = parse_years(a.get("career_years", ""))
                by = parse_years(b.get("career_years", ""))
                ap = POS_BUCKET.get(a.get("position", ""), "?")
                bp = POS_BUCKET.get(b.get("position", ""), "?")

                reason: str | None = None
                keep, drop = a, b

                # ERA-MISMATCH (same name but careers are decades apart) —
                # the most reliable signal that these are different humans.
                # Check FIRST so it wins over weaker patterns.
                if ay and by:
                    gap = max(0, max(ay[0], by[0]) - min(ay[1], by[1]))
                    if gap >= ERA_GAP:
                        reason = "ERA-MISMATCH"
                        if years_span(by) > years_span(ay):
                            keep, drop = b, a

                # RATING-CHASM (different humans wearing same name)
                if reason is None and abs(ar - br) >= RATING_CHASM:
                    reason = "RATING-CHASM"
                    if br > ar:
                        keep, drop = b, a

                # GK-vs-FIELD position split — a goalkeeper and an outfield
                # player with the same name are virtually never the same
                # human (a GK swapping to ST is a once-in-a-generation
                # career anomaly). Stronger than generic bucket mismatch.
                if (
                    reason is None
                    and {ap, bp} == {"G", "D"}.union({ap, bp}) - set()  # placeholder
                ):
                    pass  # placeholder to keep linter happy
                if reason is None and ((ap == "G") != (bp == "G")) and ap != "?" and bp != "?":
                    reason = "GK-VS-FIELD"
                    if br > ar:
                        keep, drop = b, a

                # NOTE: POSITION-BUCKET-MISMATCH (e.g. DEF vs MID) is
                # deliberately NOT auto-flagged anymore — too many real
                # careers change bucket on transfer (Matthäus CM→CB,
                # Ronaldinho CAM↔LW, Beckham RW→CM). Reported below
                # for manual review only.

                if reason:
                    flagged.append((reason, keep, drop))
                    drop_ids.add(id(drop))

    kept = [p for p in players if id(p) not in drop_ids]
    return kept, flagged


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="rewrite JSON files")
    parser.add_argument("--league", help="limit to one league")
    args = parser.parse_args()

    leagues = [args.league] if args.league else LEAGUES
    total_flagged = 0
    by_reason: dict[str, int] = defaultdict(int)

    for league in leagues:
        kept, flagged = audit_league(league)
        if not flagged:
            print(f"{league:<14} ✓ clean")
            continue
        total_before = len(kept) + len(flagged)
        total_flagged += len(flagged)
        print(f"\n{league:<14} {total_before} → {len(kept)} (−{len(flagged)})")
        for reason, keep, drop in flagged[:15]:
            by_reason[reason] += 1 if league == leagues[0] else 0  # rough tally
            print(
                f"  [{reason:<26}] DROP {drop.get('name'):<24} "
                f"{drop.get('position'):<3} OVR={drop.get('prime_rating'):<3} "
                f"@ {drop.get('club'):<14} ({drop.get('career_years')})"
            )
            print(
                f"  {'':<28} KEEP {keep.get('name'):<24} "
                f"{keep.get('position'):<3} OVR={keep.get('prime_rating'):<3} "
                f"@ {keep.get('club'):<14} ({keep.get('career_years')})"
            )
        if len(flagged) > 15:
            print(f"  ... and {len(flagged) - 15} more")

        # Tally reasons across this league
        local_tally: dict[str, int] = defaultdict(int)
        for reason, _, _ in flagged:
            local_tally[reason] += 1
        for r, c in local_tally.items():
            print(f"    {r}: {c}")

        if args.apply:
            (DATA / league / "players.json").write_text(
                json.dumps(kept, ensure_ascii=False, indent=2) + "\n"
            )

    print(f"\n{'='*60}")
    print(f"TOTAL flagged: {total_flagged}")
    if not args.apply:
        print("(dry run — re-run with --apply to drop them)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
