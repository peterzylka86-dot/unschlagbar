#!/usr/bin/env python3
"""
audit_outliers.py — surface rating + roster-balance oddities for review.

REPORT ONLY. No auto-deletes. These are signals where human judgment
catches issues heuristics can't.

PASS B — rating outliers:
  - LEGEND-AT-WEAK-CLUB: player rated 90+ at a club whose median rating
    is under 70. Almost always a mis-assigned legend.
  - LOW-AT-TOP-CLUB:     player rated under 60 at a club whose top 3
    rating is 88+. Usually a youth-team filler that shouldn't headline
    the wheel.

PASS C — roster balance (per club, per league):
  - THIN-CLUB:        clubs with <8 players (wheel feels empty).
  - POSITION-GAP:     clubs missing required positions entirely (no GK,
    no ST). Wheel can land but draft has nowhere to put them.
  - ERA-SKEW:         per-era buckets <12 players in a league (wheel
    keeps recycling same few clubs in that tier).

Usage: python3 tools/audit_outliers.py [--league NAME]
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "src" / "data"
LEAGUES = [
    "bundesliga", "laliga", "seriea", "swiss",
    "ucl", "worldcup", "worldcup2026", "womens",
]
REQUIRED_POSITIONS = {"GK", "ST"}  # bare minimum a club needs to fill its share
THIN_CLUB = 8
ERA_SKEW = 12


def load(path: Path) -> list[dict]:
    return json.loads(path.read_text()) if path.exists() else []


def audit_league(league: str) -> None:
    pl_path = DATA / league / "players.json"
    cl_path = DATA / league / "clubs.json"
    players = load(pl_path)
    clubs = load(cl_path)
    if not players:
        return
    print(f"\n{'='*70}\n{league.upper():<14} {len(players)} players · {len(clubs)} clubs\n{'='*70}")

    # By-club aggregates
    by_club: dict[str, list[dict]] = defaultdict(list)
    for p in players:
        by_club[p.get("club", "")].append(p)

    # ── Pass B: rating outliers ──────────────────────────────────────
    legend_at_weak: list[tuple[dict, float]] = []
    low_at_top: list[tuple[dict, float]] = []
    for club_id, roster in by_club.items():
        if len(roster) < 5:
            continue
        ratings = [p.get("prime_rating") or 0 for p in roster]
        median = statistics.median(ratings)
        top3 = sorted(ratings, reverse=True)[:3]
        top3_med = statistics.median(top3) if top3 else 0
        for p in roster:
            r = p.get("prime_rating") or 0
            if r >= 90 and median < 70:
                legend_at_weak.append((p, median))
            if r < 60 and top3_med >= 88:
                low_at_top.append((p, top3_med))

    if legend_at_weak:
        print(f"\n[LEGEND-AT-WEAK-CLUB] {len(legend_at_weak)} suspect entries:")
        for p, med in sorted(legend_at_weak, key=lambda x: -(x[0].get("prime_rating") or 0))[:20]:
            print(
                f"  {p.get('name'):<28} {p.get('position'):<4} OVR={p.get('prime_rating')} "
                f"@ {p.get('club'):<14} (club median {med:.0f})"
            )
        if len(legend_at_weak) > 20:
            print(f"  ... and {len(legend_at_weak)-20} more")

    if low_at_top:
        print(f"\n[LOW-AT-TOP-CLUB] {len(low_at_top)} suspect entries:")
        for p, top in sorted(low_at_top, key=lambda x: (x[0].get("prime_rating") or 0))[:20]:
            print(
                f"  {p.get('name'):<28} {p.get('position'):<4} OVR={p.get('prime_rating')} "
                f"@ {p.get('club'):<14} (club top3 {top:.0f})"
            )
        if len(low_at_top) > 20:
            print(f"  ... and {len(low_at_top)-20} more")

    # ── Pass C: roster balance ───────────────────────────────────────
    thin: list[tuple[str, int]] = []
    pos_gaps: list[tuple[str, set[str]]] = []
    for c in clubs:
        cid = c.get("id", "")
        roster = by_club.get(cid, [])
        if len(roster) < THIN_CLUB:
            thin.append((c.get("short", cid), len(roster)))
        present = {p.get("position") for p in roster}
        # Treat any CB/LB/RB as DEF; CDM/CM/CAM as MID etc. — just check
        # for explicit GK and ST since those are formation-critical.
        missing = {pos for pos in REQUIRED_POSITIONS if pos not in present}
        if missing and roster:
            pos_gaps.append((c.get("short", cid), missing))

    if thin:
        print(f"\n[THIN-CLUB] {len(thin)} clubs with <{THIN_CLUB} players:")
        for name, n in sorted(thin, key=lambda x: x[1])[:20]:
            print(f"  {name:<24}  {n} players")
        if len(thin) > 20:
            print(f"  ... and {len(thin)-20} more")

    if pos_gaps:
        print(f"\n[POSITION-GAP] {len(pos_gaps)} clubs missing GK or ST:")
        for name, missing in pos_gaps[:15]:
            print(f"  {name:<24}  missing: {', '.join(sorted(missing))}")
        if len(pos_gaps) > 15:
            print(f"  ... and {len(pos_gaps)-15} more")

    # Era buckets
    era_counts: dict[str, int] = defaultdict(int)
    for c in clubs:
        for t in c.get("era_tiers", [c.get("era_tier")]):
            if not t:
                continue
            n = len(by_club.get(c.get("id", ""), []))
            era_counts[t] += n
    sparse_eras = [(t, n) for t, n in era_counts.items() if n < ERA_SKEW]
    if sparse_eras:
        print(f"\n[ERA-SKEW] sparse tiers in this league (< {ERA_SKEW} players):")
        for t, n in sorted(sparse_eras, key=lambda x: x[1]):
            print(f"  {t:<10}  {n} players")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--league", help="limit to one league")
    args = parser.parse_args()
    leagues = [args.league] if args.league else LEAGUES
    for league in leagues:
        audit_league(league)
    return 0


if __name__ == "__main__":
    sys.exit(main())
