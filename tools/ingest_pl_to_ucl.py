#!/usr/bin/env python3
"""
ingest_pl_to_ucl.py — pull Premier League players from the iammubix FIFA17-23
mirror and add them as UCL squad members for the 8 English UCL clubs.

Why: unschlagbar's UCL roster has Liverpool/City/Chelsea/Arsenal/etc. but with
very thin squads (~9-22 players each) because no source league in the repo
covers the Premier League. This script fills that gap by ingesting FIFA's own
player data with original positions preserved (FIFA's 'Best Position' field
covers all 10 of unschlagbar's positions; the existing GOLAZO pl.json had them
bucket-simplified to GK/DEF/MID/FWD, which doesn't work for position-aware
drafting).

Output: appends to src/data/ucl/players.json (idempotent — dedups by
normalized name + position + club).

Run from repo root:    python3 tools/ingest_pl_to_ucl.py
Use --dry-run to preview without writing.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
RAW_DIR = REPO / "tools" / ".fifa_cache"
UCL_PLAYERS_PATH = REPO / "src" / "data" / "ucl" / "players.json"

RAW_DIR.mkdir(parents=True, exist_ok=True)

SEASONS = {17: "2016/17", 18: "2017/18", 19: "2018/19", 20: "2019/20",
           21: "2020/21", 22: "2021/22", 23: "2022/23"}

# Premier League club name (as found in FIFA CSV) -> UCL club id (target)
PL_CLUB_TO_UCL: dict[str, str] = {
    "Liverpool":                "liverpool",
    "Manchester City":          "manchestercity",
    "Chelsea":                  "chelsea",
    "Arsenal":                  "arsenal",
    "Manchester United":        "manchesterunited",
    "Tottenham Hotspur":        "tottenham",
    "Nottingham Forest":        "nottinghamforest",
    "Aston Villa":              "astonvilla",
}

# FIFA "Best Position" -> unschlagbar Position
# (10 buckets: GK, CB, LB, RB, CDM, CM, CAM, RW, LW, ST)
POS_MAP = {
    "GK":  "GK",
    "CB":  "CB", "LCB": "CB", "RCB": "CB",
    "LB":  "LB", "LWB": "LB",
    "RB":  "RB", "RWB": "RB",
    "CDM": "CDM", "LDM": "CDM", "RDM": "CDM",
    "CM":  "CM",  "LCM": "CM",  "RCM": "CM",  "LM": "CM",  "RM": "CM",
    "CAM": "CAM", "LAM": "CAM", "RAM": "CAM",
    "LW":  "LW", "LF": "LW",
    "RW":  "RW", "RF": "RW",
    "ST":  "ST", "CF": "ST", "LS": "ST", "RS": "ST",
}

# Minimum overall to ingest. UCL is elite — 78+ keeps it tight.
MIN_OVR = 78


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def to_int(s, default=50) -> int:
    if s is None or s == "" or s == "nan":
        return default
    try:
        return int(float(s))
    except (TypeError, ValueError):
        return default


def download_year(year: int) -> Path:
    """Download one year's FIFA CSV. Cached after first run."""
    path = RAW_DIR / f"FIFA{year}_official_data.csv"
    if path.exists() and path.stat().st_size > 1_000_000:
        return path
    url = f"https://raw.githubusercontent.com/iammubix/Fifa-Dataset/main/FIFA{year}_official_data.csv"
    print(f"  ↓ Downloading FIFA{year}")
    subprocess.run(["curl", "-sSL", "--fail", url, "-o", str(path)], check=True)
    return path


def process_year(year: int, accum: dict[tuple[str, str], dict]) -> int:
    """Read one year's CSV. Accumulator key = (normalized name, ucl club id),
    value = best entry seen so far (highest overall)."""
    path = download_year(year)
    season = SEASONS[year]
    added = 0
    with open(path, "r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            club = (row.get("Club") or "").strip()
            ucl_club_id = PL_CLUB_TO_UCL.get(club)
            if not ucl_club_id:
                continue
            best_pos = (row.get("Best Position") or "").strip()
            pos = POS_MAP.get(best_pos)
            if not pos:
                continue
            ovr = to_int(row.get("Overall"))
            if ovr < MIN_OVR:
                continue
            name = (row.get("Name") or "").strip()
            if not name:
                continue
            nationality = (row.get("Nationality") or "").strip()

            key = (norm(name), ucl_club_id)
            existing = accum.get(key)
            if existing is None or ovr > existing["prime_rating"]:
                accum[key] = {
                    "name": name,
                    "position": pos,
                    "prime_rating": ovr,
                    # career_years initially this season; we'll widen below
                    "_first_year": int(season.split("/")[0]),
                    "_last_year": int("20" + season.split("/")[1]),
                    "nationality": nationality,
                    "club": ucl_club_id,
                }
                added += 1
            else:
                # widen career years if same player appears in different seasons
                fy = int(season.split("/")[0])
                ly = int("20" + season.split("/")[1])
                existing["_first_year"] = min(existing["_first_year"], fy)
                existing["_last_year"] = max(existing["_last_year"], ly)
    return added


def finalize(accum: dict[tuple[str, str], dict]) -> list[dict]:
    out = []
    for v in accum.values():
        fy = v.pop("_first_year")
        ly = v.pop("_last_year")
        v["career_years"] = f"{fy}-{ly}"
        out.append(v)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="don't write files")
    ap.add_argument("--years", type=str, default="17,18,19,20,21,22,23",
                    help="comma-separated FIFA editions (e.g. 19,20)")
    args = ap.parse_args()

    years = [int(y) for y in args.years.split(",")]
    print(f"Repo: {REPO}")
    print(f"Years: FIFA{years}")
    print(f"Min OVR: {MIN_OVR}")
    print()

    accum: dict[tuple[str, str], dict] = {}
    for y in years:
        print(f"FIFA{y} ({SEASONS[y]})…")
        n = process_year(y, accum)
        print(f"  → seen so far: {len(accum)} unique players")
    print()

    pl_players = finalize(accum)
    print(f"Total unique PL players (above OVR {MIN_OVR}): {len(pl_players)}")

    # Dedup against existing UCL roster
    existing = json.loads(UCL_PLAYERS_PATH.read_text())
    existing_keys = {(norm(p["name"]), p["position"], p["club"]) for p in existing}
    to_add = [p for p in pl_players
              if (norm(p["name"]), p["position"], p["club"]) not in existing_keys]
    print(f"  → already in UCL: {len(pl_players) - len(to_add)}")
    print(f"  → new for UCL:    {len(to_add)}")
    print()

    # Per-club breakdown
    by_club: dict[str, int] = defaultdict(int)
    for p in to_add:
        by_club[p["club"]] += 1
    print("Per-club additions:")
    for club_id in sorted(by_club, key=lambda k: -by_club[k]):
        print(f"  {club_id:25} +{by_club[club_id]}")

    if args.dry_run:
        print("\n--dry-run, not writing.")
        return 0

    merged = existing + to_add
    UCL_PLAYERS_PATH.write_text(
        json.dumps(merged, indent=2, ensure_ascii=False) + "\n"
    )
    print(f"\nWrote {len(merged)} total players to {UCL_PLAYERS_PATH.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
