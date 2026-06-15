#!/usr/bin/env python3
"""
Data quality audit across every shipped dataset (legends leagues, the EA FC
real universe, and the wonderkid pool). Read-only — reports issues, fixes
nothing. Run: python3 tools/audit_quality.py
"""
import json
import os
import re
from collections import Counter, defaultdict

ROOT = os.path.join(os.path.dirname(__file__), "..", "src", "data")
VALID_POS = {"GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "LW", "RW", "ST"}
LEGENDS_LEAGUES = ["ucl", "bundesliga", "laliga", "seriea", "swiss", "worldcup", "worldcup2026", "womens"]

issues = 0


def warn(msg):
    global issues
    issues += 1
    print("  ⚠️ " + msg)


def audit_players(label, players, require_age=False):
    print(f"\n=== {label}: {len(players)} players ===")
    keys = Counter(f"{p.get('club')}:{p.get('name')}" for p in players)
    dups = [k for k, c in keys.items() if c > 1]
    if dups:
        warn(f"{len(dups)} duplicate club:name keys (e.g. {dups[:5]})")
    bad_pos = [p["name"] for p in players if p.get("position") not in VALID_POS]
    if bad_pos:
        warn(f"{len(bad_pos)} invalid primary positions (e.g. {bad_pos[:5]})")
    bad_alt = [
        p["name"]
        for p in players
        if p.get("altPositions") and any(a not in VALID_POS for a in p["altPositions"])
    ]
    if bad_alt:
        warn(f"{len(bad_alt)} invalid altPositions (e.g. {bad_alt[:5]})")
    bad_rating = [
        f"{p.get('name')}({p.get('prime_rating')})"
        for p in players
        if not isinstance(p.get("prime_rating"), int) or not (40 <= p["prime_rating"] <= 99)
    ]
    if bad_rating:
        warn(f"{len(bad_rating)} out-of-range/non-int ratings (e.g. {bad_rating[:5]})")
    blank = [p for p in players if not p.get("name") or not p.get("club") or not p.get("nationality")]
    if blank:
        warn(f"{len(blank)} players missing name/club/nationality")
    self_alt = [p["name"] for p in players if p.get("position") in (p.get("altPositions") or [])]
    if self_alt:
        warn(f"{len(self_alt)} players list their primary position in altPositions (e.g. {self_alt[:5]})")
    if require_age:
        no_age = [p["name"] for p in players if not isinstance(p.get("age"), int)]
        if no_age:
            warn(f"{len(no_age)} real players missing a numeric age (e.g. {no_age[:5]})")
    if not dups and not bad_pos and not bad_alt and not bad_rating and not blank and not self_alt:
        print("  ✓ clean")


def audit_clubs_can_field(label, players, clubs):
    """Every club should be able to field a back line + a keeper."""
    by_club = defaultdict(Counter)
    for p in players:
        by_club[p["club"]][p["position"]] += 1
    club_ids = {c["id"] for c in clubs}
    orphan = {p["club"] for p in players} - club_ids
    if orphan:
        warn(f"{label}: {len(orphan)} player clubs not in clubs.json (e.g. {list(orphan)[:5]})")
    thin = []
    for c in clubs:
        pc = by_club.get(c["id"], Counter())
        total = sum(pc.values())
        gk = pc.get("GK", 0)
        if total < 11:
            thin.append(f"{c['id']}({total}p)")
        elif gk == 0:
            thin.append(f"{c['id']}(0 GK)")
    if thin:
        warn(f"{label}: {len(thin)} clubs can't field a full XI (e.g. {thin[:8]})")
    else:
        print(f"  ✓ all {len(clubs)} clubs can field an XI")


def main():
    # Legends leagues
    for lg in LEGENDS_LEAGUES:
        f = os.path.join(ROOT, lg, "players.json")
        if not os.path.exists(f):
            continue
        players = json.load(open(f, encoding="utf-8"))
        audit_players(f"legends/{lg}", players)

    # Real universe
    rp = os.path.join(ROOT, "real", "players.json")
    rc = os.path.join(ROOT, "real", "clubs.json")
    if os.path.exists(rp):
        players = json.load(open(rp, encoding="utf-8"))
        clubs = json.load(open(rc, encoding="utf-8"))
        audit_players("real", players, require_age=True)
        print(f"--- real clubs fieldability ({len(clubs)} clubs) ---")
        audit_clubs_can_field("real", players, clubs)

    # Wonderkids
    wk = os.path.join(ROOT, "wonderkids.json")
    if os.path.exists(wk):
        icons = json.load(open(wk, encoding="utf-8"))["icons"]
        print(f"\n=== wonderkids: {len(icons)} icons ===")
        ids = Counter(i["id"] for i in icons)
        d = [k for k, c in ids.items() if c > 1]
        if d:
            warn(f"duplicate icon ids: {d}")
        bp = [i["name"] for i in icons if i["position"] not in VALID_POS]
        if bp:
            warn(f"invalid icon positions: {bp}")
        br = [i["name"] for i in icons if not (85 <= i["prime"] <= 99)]
        if br:
            warn(f"icon primes out of legend range (85-99): {br}")
        if not d and not bp and not br:
            print("  ✓ clean")

    print(f"\n{'='*40}\nTOTAL ISSUES FLAGGED: {issues}")


if __name__ == "__main__":
    main()
