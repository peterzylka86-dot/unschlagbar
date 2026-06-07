#!/usr/bin/env python3
"""
expand_laliga_seriea.py — broaden La Liga + Serie A to match Bundesliga depth.

Bundesliga has 56 clubs / 1655 players because the original ingest covered
both top tiers + recent relegations. La Liga and Serie A were narrow (30
and 31 clubs respectively) and missed:
  - 2nd-tier (Segunda División / Serie B) clubs that have appeared in
    the top flight over 2016-2023
  - Historic clubs that bounced between tiers

This script:
  1. Adds the missing FIFA-discovered Spanish + Italian clubs to clubs.json
  2. Runs the FIFA17-23 ingest against the broadened club list
  3. Appends to existing players.json (idempotent dedup)

Run from repo root:    python3 tools/expand_laliga_seriea.py
Use --dry-run to preview.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FIFA_CACHE = REPO / "tools" / ".fifa_cache"

SEASONS = {17: "2016/17", 18: "2017/18", 19: "2018/19", 20: "2019/20",
           21: "2020/21", 22: "2021/22", 23: "2022/23"}

POS_MAP = {
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

MIN_OVR = 65  # lower bar than UCL ingest — broader squad depth for league mode

# (FIFA name) → (new id, display name, short, city, color, founded, strength)
NEW_LALIGA_CLUBS = {
    "SD Huesca":             ("huesca", "SD Huesca", "HUE", "Huesca", "#0d3675", 1960, 70),
    "CD Tenerife":           ("tenerife", "CD Tenerife", "TEN", "Santa Cruz", "#0250a4", 1922, 72),
    "Elche CF":              ("elche", "Elche CF", "ELC", "Elche", "#055d28", 1923, 72),
    "Deportivo de La Coruña":("deportivo", "Deportivo La Coruña", "DEP", "La Coruña", "#0c6ec1", 1906, 76),
    "RC Celta":              ("celta", "RC Celta Vigo", "CEL", "Vigo", "#8ac1e7", 1923, 76),
    "RC Celta de Vigo":      ("celta", "RC Celta Vigo", "CEL", "Vigo", "#8ac1e7", 1923, 76),  # alias
    "UD Almería":            ("almeria", "UD Almería", "ALM", "Almería", "#cc0000", 1989, 72),
    "Unión Deportiva Almería":("almeria","UD Almería", "ALM", "Almería", "#cc0000", 1989, 72),  # alias
    "CD Lugo":               ("lugo", "CD Lugo", "LUG", "Lugo", "#820000", 1953, 68),
    "AD Alcorcón":           ("alcorcon", "AD Alcorcón", "ALC", "Alcorcón", "#fef200", 1971, 68),
    "CD Numancia":           ("numancia", "CD Numancia", "NUM", "Soria", "#cb000a", 1945, 68),
    "Gimnàstic de Tarragona":("nastic", "Gimnàstic de Tarragona", "NAS", "Tarragona", "#cf152d", 1886, 67),
    "Levante Unión Deportiva":("levante", "Levante UD", "LEV", "Valencia", "#8a232a", 1909, 73),
    "CF Reus Deportiu":      ("reus", "CF Reus Deportiu", "REU", "Reus", "#cd2729", 1909, 68),
    "Unión Deportiva Las Palmas":("laspalmas","UD Las Palmas", "LPA", "Las Palmas", "#fef200", 1949, 72),
    "CD Mirandés":           ("mirandes", "CD Mirandés", "MIR", "Miranda de Ebro", "#cc0000", 1927, 67),
    "Extremadura UD":        ("extremadura", "Extremadura UD", "EXT", "Almendralejo", "#022a59", 1924, 65),
    "Sevilla Atlético":      ("sevillab", "Sevilla Atlético", "SEB", "Seville", "#cd0000", 1958, 65),
    "FC Cartagena":          ("cartagena", "FC Cartagena", "CAR", "Cartagena", "#000000", 1995, 68),
    "SD Ponferradina":       ("ponferradina", "SD Ponferradina", "PON", "Ponferrada", "#00208a", 1922, 65),
    "Racing Santander":      ("santander", "Racing Santander", "RAC", "Santander", "#108542", 1913, 70),
    "UD Logroñés":           ("logrones", "UD Logroñés", "LOG", "Logroño", "#fef200", 1940, 65),
    "UCAM Murcia CF":        ("murcia", "UCAM Murcia CF", "MUR", "Murcia", "#0c1f8b", 1999, 65),
    "Lorca FC":              ("lorca", "Lorca FC", "LOR", "Lorca", "#ffffff", 1949, 64),
}

NEW_SERIEA_CLUBS = {
    "Sassuolo":              ("sassuolo", "US Sassuolo", "SAS", "Sassuolo", "#0c8245", 1922, 76),
    "SPAL":                  ("spal", "SPAL", "SPL", "Ferrara", "#1b4798", 1907, 70),
    "Frosinone":             ("frosinone", "Frosinone Calcio", "FRO", "Frosinone", "#0c4790", 1928, 72),
    "Spezia":                ("spezia", "Spezia Calcio", "SPE", "La Spezia", "#dbdbdb", 1906, 70),
    "US Salernitana 1919":   ("salernitana", "US Salernitana", "SAL", "Salerno", "#7a132a", 1919, 72),
    "Lecce":                 ("lecce", "US Lecce", "LEC", "Lecce", "#fef200", 1908, 73),
    "Perugia":               ("perugia", "AC Perugia", "PER", "Perugia", "#a02b2f", 1905, 70),
    "Pescara":               ("pescara", "Pescara Calcio", "PSC", "Pescara", "#082a73", 1936, 70),
    "US Cremonese":          ("cremonese", "US Cremonese", "CRE", "Cremona", "#a30025", 1903, 69),
    "Cittadella":            ("cittadella", "AS Cittadella", "CIT", "Cittadella", "#5a1f29", 1973, 68),
    "Pisa":                  ("pisa", "AC Pisa", "PIS", "Pisa", "#0c4790", 1909, 69),
    "Carpi":                 ("carpi", "Carpi FC", "CRP", "Carpi", "#f00", 1909, 67),
    "Cesena":                ("cesena", "Cesena FC", "CES", "Cesena", "#fffd00", 1940, 68),
    "Virtus Entella":        ("entella", "Virtus Entella", "ENT", "Chiavari", "#0c4087", 1914, 65),
    "Ternana":               ("ternana", "Ternana Calcio", "TER", "Terni", "#dc1f1d", 1925, 67),
    "Novara":                ("novara", "Novara Calcio", "NOV", "Novara", "#0c4087", 1908, 67),
    "Livorno":               ("livorno", "AS Livorno", "LIV", "Livorno", "#7a132a", 1915, 67),
    "Pordenone":             ("pordenone", "Pordenone Calcio", "POR", "Pordenone", "#000000", 1920, 65),
    "Vicenza":               ("vicenza", "LR Vicenza", "VIC", "Vicenza", "#cd0000", 1902, 67),
    "Padova":                ("padovacalcio", "Calcio Padova", "PAD", "Padua", "#cd0000", 1910, 66),
    "Trapani":               ("trapani", "Trapani Calcio", "TRA", "Trapani", "#0c4087", 1905, 65),
    "Avellino":              ("avellino", "US Avellino", "AVE", "Avellino", "#1cad19", 1912, 66),
    "FC Pro Vercelli 1892":  ("provercelli", "Pro Vercelli", "PVE", "Vercelli", "#fff", 1892, 65),
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def to_int(s, default=50) -> int:
    if s is None or s == "" or s == "nan": return default
    try: return int(float(s))
    except (TypeError, ValueError): return default


def add_clubs(clubs_path: Path, new_clubs: dict, dry_run: bool) -> dict:
    """Add new clubs to the league's clubs.json. Returns the FIFA-name → unschlagbar-id map."""
    existing = json.loads(clubs_path.read_text())
    existing_ids = {c["id"] for c in existing}
    sample = existing[0] if existing else {}
    fifa_to_id = {}
    added_ids = set()
    for fifa_name, (cid, name, short, city, color, founded, strength) in new_clubs.items():
        fifa_to_id[fifa_name] = cid
        if cid in existing_ids:
            continue
        if cid in added_ids:
            continue
        new_club = {
            "id": cid, "name": name, "short": short, "city": city,
            "color": color, "founded": founded, "strength": strength,
            "era": "current", "era_tier": "current",
        }
        if "era_tiers" in sample:
            new_club["era_tiers"] = ["current"]
        existing.append(new_club)
        added_ids.add(cid)
        existing_ids.add(cid)

    # Also include the EXISTING clubs in the FIFA-name map so the ingest can
    # cover them too (broaden the existing rosters with extra FIFA editions).
    existing_norm_to_id = {}
    for c in existing:
        existing_norm_to_id[norm(c["name"])] = c["id"]

    if not dry_run:
        clubs_path.write_text(json.dumps(existing, indent=2, ensure_ascii=False) + "\n")
    return fifa_to_id, existing_norm_to_id, len(added_ids)


def ingest(fifa_to_id: dict, players_path: Path, dry_run: bool) -> int:
    """Ingest FIFA players for the given (FIFA name → club id) map.
    Append-merge into players_path (idempotent dedup by norm name + position + club)."""
    existing = json.loads(players_path.read_text())
    existing_keys = {(norm(p["name"]), p["position"], p["club"]) for p in existing}

    accum: dict[tuple[str, str], dict] = {}
    for year in sorted(SEASONS.keys()):
        path = FIFA_CACHE / f"FIFA{year}_official_data.csv"
        if not path.exists():
            print(f"  ! missing {path}, skipping")
            continue
        season = SEASONS[year]
        with open(path, "r", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                club = (row.get("Club") or "").strip()
                target = fifa_to_id.get(club)
                if not target:
                    continue
                best_pos = (row.get("Best Position") or "").strip()
                pos = POS_MAP.get(best_pos)
                if not pos: continue
                ovr = to_int(row.get("Overall"))
                if ovr < MIN_OVR: continue
                name = (row.get("Name") or "").strip()
                if not name: continue
                nationality = (row.get("Nationality") or "").strip()
                key = (norm(name), target)
                a = accum.get(key)
                if a is None or ovr > a["prime_rating"]:
                    accum[key] = {
                        "name": name, "position": pos, "prime_rating": ovr,
                        "_first_year": int(season.split("/")[0]),
                        "_last_year": int("20" + season.split("/")[1]),
                        "nationality": nationality, "club": target,
                    }
                else:
                    fy = int(season.split("/")[0])
                    ly = int("20" + season.split("/")[1])
                    a["_first_year"] = min(a["_first_year"], fy)
                    a["_last_year"] = max(a["_last_year"], ly)

    new_players = []
    for v in accum.values():
        fy = v.pop("_first_year"); ly = v.pop("_last_year")
        v["career_years"] = f"{fy}-{ly}"
        key3 = (norm(v["name"]), v["position"], v["club"])
        if key3 in existing_keys:
            continue
        new_players.append(v)
        existing_keys.add(key3)

    if not dry_run and new_players:
        merged = existing + new_players
        players_path.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n")
    return len(new_players)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    for league, new_clubs in [("laliga", NEW_LALIGA_CLUBS), ("seriea", NEW_SERIEA_CLUBS)]:
        clubs_path = REPO / "src" / "data" / league / "clubs.json"
        players_path = REPO / "src" / "data" / league / "players.json"
        print(f"\n=== {league} ===")
        fifa_to_id, _existing_to_id, n_clubs_added = add_clubs(clubs_path, new_clubs, args.dry_run)
        print(f"  Clubs added: {n_clubs_added}")
        n_players = ingest(fifa_to_id, players_path, args.dry_run)
        print(f"  Players added (new entries only): {n_players}")

    if args.dry_run:
        print("\n--dry-run, not writing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
