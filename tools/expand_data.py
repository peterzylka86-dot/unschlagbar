#!/usr/bin/env python3
"""
expand_data.py — pull additional players into UCL and World Cup rosters from
the existing big-league datasets (bundesliga, laliga, seriea, swiss).

Zero fabrication: every added player is already in one of the source league
files. We just surface them in the additional contexts (UCL by club, WC by
nationality) where they belong.

Run from repo root:    python3 tools/expand_data.py
Run with --dry-run to see counts without writing.

The script is idempotent: deduplication is by normalized name + position +
target club/nation. Re-running won't add duplicates.
"""
from __future__ import annotations

import argparse
import json
import sys
import unicodedata
import re
from pathlib import Path
from typing import Iterable

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "src" / "data"

SOURCE_LEAGUES = ["bundesliga", "laliga", "seriea", "swiss"]

# UCL club id -> source (league, club_id). Built primarily by exact id match,
# with one manual override for the rbleipzig/leipzig mismatch.
UCL_CLUB_OVERRIDES = {
    "rbleipzig": ("bundesliga", "leipzig"),
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def load_json(path: Path):
    return json.loads(path.read_text())


def save_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def player_key(p: dict, target_club: str) -> tuple[str, str, str]:
    """Key used for deduplication within a target club/nation."""
    return (norm(p["name"]), p["position"], target_club)


def build_source_index() -> dict[tuple[str, str], list[dict]]:
    """Index source players by (league, club_id) for quick lookup."""
    out: dict[tuple[str, str], list[dict]] = {}
    for league in SOURCE_LEAGUES:
        players = load_json(DATA / league / "players.json")
        for p in players:
            out.setdefault((league, p["club"]), []).append(p)
    return out


def expand_ucl(source_idx, dry_run: bool) -> tuple[int, int, list[str]]:
    """Expand UCL by pulling players for each UCL club from the source league
    where that club exists. Returns (new_count, total_after, club_report)."""
    ucl_clubs = load_json(DATA / "ucl" / "clubs.json")
    ucl_players = load_json(DATA / "ucl" / "players.json")

    # Build set of (norm-name, pos, club) keys already in UCL
    existing_keys = {player_key(p, p["club"]) for p in ucl_players}

    # Build UCL club -> (source league, source club id) map
    # First, look in each source league for an exact id match
    ucl_id_to_src: dict[str, tuple[str, str]] = {}
    for c in ucl_clubs:
        if c["id"] in UCL_CLUB_OVERRIDES:
            ucl_id_to_src[c["id"]] = UCL_CLUB_OVERRIDES[c["id"]]
            continue
        for league in SOURCE_LEAGUES:
            try:
                src_clubs = load_json(DATA / league / "clubs.json")
            except FileNotFoundError:
                continue
            if any(sc["id"] == c["id"] for sc in src_clubs):
                ucl_id_to_src[c["id"]] = (league, c["id"])
                break

    to_add: list[dict] = []
    club_report: list[str] = []
    for c in ucl_clubs:
        if c["id"] not in ucl_id_to_src:
            continue
        league, src_id = ucl_id_to_src[c["id"]]
        candidates = source_idx.get((league, src_id), [])
        new_for_club = []
        for p in candidates:
            key = (norm(p["name"]), p["position"], c["id"])
            if key in existing_keys:
                continue
            # Build new UCL entry, retargeted to the UCL club id
            new_p = dict(p)
            new_p["club"] = c["id"]
            new_for_club.append(new_p)
            existing_keys.add(key)
        to_add.extend(new_for_club)
        club_report.append(
            f"  {c['name']:25}  +{len(new_for_club):3d} (from {league})"
        )

    if not dry_run:
        merged = ucl_players + to_add
        save_json(DATA / "ucl" / "players.json", merged)

    return len(to_add), len(ucl_players) + len(to_add), club_report


WC_MIN_RATING = 80
"""WC = national team. Only pull source-league players rated >= this. Filters
out journeymen / second-tier players who would never represent a nation."""


def expand_worldcup(source_idx, dry_run: bool) -> tuple[int, int, list[str]]:
    """Expand World Cup by pulling players from all source leagues where
    nationality matches a WC nation. Quality-gated by WC_MIN_RATING."""
    wc_clubs = load_json(DATA / "worldcup" / "clubs.json")
    wc_players = load_json(DATA / "worldcup" / "players.json")

    # Build map: normalized nation name / id -> WC club id
    wc_nation_map: dict[str, str] = {}
    for c in wc_clubs:
        # In WC, club.name is typically the country name (e.g. "Brazil")
        wc_nation_map[norm(c["name"])] = c["id"]
        wc_nation_map[norm(c["id"])] = c["id"]

    existing_keys = {player_key(p, p["club"]) for p in wc_players}

    to_add: list[dict] = []
    per_nation: dict[str, int] = {}
    for (_league, _src), players in source_idx.items():
        for p in players:
            nat = p.get("nationality")
            if not nat:
                continue
            if p.get("prime_rating", 0) < WC_MIN_RATING:
                continue
            wc_id = wc_nation_map.get(norm(nat))
            if not wc_id:
                continue
            key = (norm(p["name"]), p["position"], wc_id)
            if key in existing_keys:
                continue
            new_p = dict(p)
            new_p["club"] = wc_id
            to_add.append(new_p)
            existing_keys.add(key)
            per_nation[wc_id] = per_nation.get(wc_id, 0) + 1

    if not dry_run:
        merged = wc_players + to_add
        save_json(DATA / "worldcup" / "players.json", merged)

    # Report sorted by count desc, top 15 only
    name_lookup = {c["id"]: c["name"] for c in wc_clubs}
    report = []
    for wc_id, count in sorted(per_nation.items(), key=lambda kv: -kv[1])[:15]:
        report.append(f"  {name_lookup.get(wc_id, wc_id):20}  +{count}")
    return len(to_add), len(wc_players) + len(to_add), report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="don't write files")
    ap.add_argument("--only", choices=["ucl", "worldcup"], help="only run one target")
    args = ap.parse_args()

    print(f"Repo root: {REPO}")
    print(f"Dry run: {args.dry_run}")
    print()

    idx = build_source_index()
    print(
        f"Loaded {sum(len(v) for v in idx.values())} source players across "
        f"{len(idx)} (league, club) buckets"
    )
    print()

    if args.only != "worldcup":
        print("=== UCL expansion ===")
        added, total, report = expand_ucl(idx, args.dry_run)
        for line in report:
            print(line)
        print(f"  → +{added} players, new UCL total: {total}")
        print()

    if args.only != "ucl":
        print("=== World Cup expansion ===")
        added, total, report = expand_worldcup(idx, args.dry_run)
        print("Top nations by additions:")
        for line in report:
            print(line)
        print(f"  → +{added} players, new WC total: {total}")
        print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
