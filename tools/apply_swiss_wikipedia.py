#!/usr/bin/env python3
"""
apply_swiss_wikipedia.py — replace Swiss roster with FIFA + Wikipedia data.

Previous attempts at Swiss data had errors based on my training data
(Henchoz at Sion, Andy Egli at GCZ, etc.). This script combines two
authoritative sources:

  1. FIFA17-23 ingest (modern 2016-2023 era — verified club roster data)
  2. Wikipedia notable-players (historical — fact-checked by editors)

Merge logic:
  - Same player at same club (by normalized name) → keep Wikipedia entry
    if present (its years are more comprehensive for historical players),
    else FIFA entry.
  - Different clubs → both entries kept (real transfer history).

Run from repo root:    python3 tools/apply_swiss_wikipedia.py
Use --dry-run to preview.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SWISS_CLUBS = REPO / "src" / "data" / "swiss" / "clubs.json"
SWISS_PLAYERS = REPO / "src" / "data" / "swiss" / "players.json"
WIKI_JSON = REPO / "tools" / ".wikipedia_cache" / "swiss_squads.json"
FIFA_CACHE = REPO / "tools" / ".fifa_cache"

SEASONS = {17: "2016/17", 18: "2017/18", 19: "2018/19", 20: "2019/20",
           21: "2020/21", 22: "2021/22", 23: "2022/23"}

FIFA_CLUB_TO_SWISS = {
    "BSC Young Boys":           "youngboys",
    "FC Basel 1893":            "basel",
    "FC Basel":                 "basel",
    "FC Lausanne-Sport":        "lausanne",
    "FC Lugano":                "lugano",
    "FC Luzern":                "luzern",
    "FC Sion":                  "sion",
    "FC St. Gallen 1879":       "stgallen",
    "FC St. Gallen":            "stgallen",
    "FC Thun":                  "thun",
    "FC Winterthur":            "winterthur",
    "FC Zürich":                "zurich",
    "Grasshopper Club Zürich":  "grasshopper",
    "Neuchâtel Xamax":          "xamax",
    "Neuchâtel Xamax FCS":      "xamax",
    "Servette FC":              "servette",
}

POS_MAP_FIFA = {
    "GK": "GK",
    "CB": "CB", "LCB": "CB", "RCB": "CB",
    "LB": "LB", "LWB": "LB",
    "RB": "RB", "RWB": "RB",
    "CDM": "CDM", "LDM": "CDM", "RDM": "CDM",
    "CM": "CM", "LCM": "CM", "RCM": "CM", "LM": "CM", "RM": "CM",
    "CAM": "CAM", "LAM": "CAM", "RAM": "CAM",
    "LW": "LW", "LF": "LW",
    "RW": "RW", "RF": "RW",
    "ST": "ST", "CF": "ST", "LS": "ST", "RS": "ST",
}

VALID_POS = {"GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "LW", "RW", "ST"}
MIN_OVR = 68


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def to_int(s, default=50) -> int:
    if s is None or s == "" or s == "nan": return default
    try: return int(float(s))
    except (TypeError, ValueError): return default


def ingest_fifa() -> dict[tuple[str, str], dict]:
    """Pull modern (2016-2023) Swiss data from FIFA17-23."""
    accum: dict[tuple[str, str], dict] = {}
    for year in sorted(SEASONS.keys()):
        path = FIFA_CACHE / f"FIFA{year}_official_data.csv"
        if not path.exists():
            continue
        season = SEASONS[year]
        with open(path, "r", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                club = (row.get("Club") or "").strip()
                club_id = FIFA_CLUB_TO_SWISS.get(club)
                if not club_id:
                    continue
                pos = POS_MAP_FIFA.get((row.get("Best Position") or "").strip())
                if not pos:
                    continue
                ovr = to_int(row.get("Overall"))
                if ovr < MIN_OVR:
                    continue
                name = (row.get("Name") or "").strip()
                if not name:
                    continue
                nat = (row.get("Nationality") or "").strip()
                key = (norm(name), club_id)
                fy = int(season.split("/")[0])
                ly = int("20" + season.split("/")[1])
                a = accum.get(key)
                if a is None or ovr > a["prime_rating"]:
                    accum[key] = {
                        "name": name, "position": pos, "prime_rating": ovr,
                        "_first_year": fy, "_last_year": ly,
                        "nationality": nat, "club": club_id, "_source": "fifa",
                    }
                else:
                    a["_first_year"] = min(a["_first_year"], fy)
                    a["_last_year"] = max(a["_last_year"], ly)
    return accum


def heuristic_wiki_rating(years_string: str) -> int:
    """Pre-FIFA-era players don't have FIFA ratings. Use a sensible default
    biased by how long their stint was."""
    # Multi-stint or long single stints → likely a legend at that club
    yrs = re.findall(r"(?:19|20)\d{2}", years_string)
    if not yrs:
        return 78
    nums = [int(y) for y in yrs]
    span = max(nums) - min(nums)
    if span >= 12: return 84
    if span >= 6: return 82
    if span >= 3: return 80
    return 78


def load_wiki() -> list[dict]:
    """Read Wikipedia notable-player entries as flat records."""
    data = json.loads(WIKI_JSON.read_text())
    out = []
    for cid, players in data.items():
        if cid.startswith("_"):  # skip meta
            continue
        for p in players:
            pos = p["position"]
            if pos not in VALID_POS:
                # try to map legacy/abbreviation
                upper = pos.upper()
                if upper in VALID_POS:
                    pos = upper
                else:
                    pos = "CM"  # safe default
            out.append({
                "name": p["name"],
                "position": pos,
                "career_years": p["years"],
                "nationality": p["nationality"],
                "club": cid,
                "_source": "wikipedia",
            })
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print("Ingesting FIFA17-23 Swiss clubs...")
    fifa_accum = ingest_fifa()
    print(f"  → {len(fifa_accum)} modern entries")

    print("\nLoading Wikipedia historical entries...")
    wiki = load_wiki()
    print(f"  → {len(wiki)} historical entries")

    # Final accumulator: prefer Wikipedia for historical accuracy when conflict
    final: dict[tuple[str, str], dict] = {}

    # Start with FIFA entries
    for key, v in fifa_accum.items():
        fy = v.pop("_first_year"); ly = v.pop("_last_year")
        v["career_years"] = f"{fy}-{ly}"
        v.pop("_source", None)
        final[key] = v

    # Apply Wikipedia entries (override if same player+club, add if new)
    overrode = 0
    added = 0
    for w in wiki:
        key = (norm(w["name"]), w["club"])
        if key in final:
            # Same player, same club. Wikipedia wins on career_years
            # (Wikipedia covers historical stints FIFA window missed).
            # Keep the FIFA rating as it's more granular.
            final[key]["career_years"] = w["career_years"]
            final[key]["position"] = w["position"]  # Wikipedia position is more canonical
            overrode += 1
        else:
            final[key] = {
                "name": w["name"],
                "position": w["position"],
                "prime_rating": heuristic_wiki_rating(w["career_years"]),
                "career_years": w["career_years"],
                "nationality": w["nationality"],
                "club": w["club"],
            }
            added += 1

    print(f"\nMerge result:")
    print(f"  FIFA entries kept as-is: {len(fifa_accum) - overrode}")
    print(f"  FIFA entries refined by Wikipedia: {overrode}")
    print(f"  New historical entries from Wikipedia: {added}")
    print(f"  Total: {len(final)}")

    # Sort + write
    out = list(final.values())
    out.sort(key=lambda x: (x["club"], -x["prime_rating"], x["name"]))

    from collections import Counter
    counts = Counter(p["club"] for p in out)
    clubs = json.loads(SWISS_CLUBS.read_text())
    print("\nPer-club totals:")
    for c in sorted(clubs, key=lambda x: -counts.get(x["id"], 0)):
        n = counts.get(c["id"], 0)
        print(f"  {c['name']:30} {n:3d}")

    if args.dry_run:
        print("\n--dry-run, not writing.")
        return 0

    SWISS_PLAYERS.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"\nWrote {len(out)} players to {SWISS_PLAYERS.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
