#!/usr/bin/env python3
"""
build_wwc_squads.py — build the Women's World Cup roster from real squad data.

Sibling to build_wc_squads.py but for the women's tournaments. Creates a
new league 'womenscup' (separate from the existing 'womens' which is
women's CLUB football — Barça Fem / Lyon / Chelsea Fem / etc.).

Source: jfjelstul/worldcup → squads.csv → tournaments tagged "Women's".
Covers 8 WWCs from 1991 to 2019. (2023 WWC isn't in this dataset yet.)

Note: Pre-FIFA-era ratings are sparser for women's football than men's, so
the heuristic baseline (75 + 2 per WWC appearance) dominates more than it
did for the men's pass. A focused legend list adds back the obvious icons
(Marta, Hamm, Sun Wen, Sawa, Wambach, etc).

Run from repo root:    python3 tools/build_wwc_squads.py
Use --dry-run to preview without writing.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA_DIR = REPO / "src" / "data" / "womenscup"
SQUAD_CSV = REPO / "tools" / ".wc_cache" / "squads.csv"

POS_MAP = {"GK": "GK", "DF": "CB", "MF": "CM", "FW": "ST"}
BASELINE_RATING = 75
PER_APPEARANCE_BONUS = 2
MAX_HEURISTIC_RATING = 86

# Hand-curated WWC legend ratings (override FIFA + heuristic where present)
LEGEND_RATINGS = {
    "marta": 96,                # all-time icon, 6 WWCs, 17 WC goals (record)
    "michelle akers": 95,
    "mia hamm": 95,
    "sun wen": 93,
    "homare sawa": 94,           # 2011 winner + Golden Ball + Golden Boot
    "birgit prinz": 93,
    "abby wambach": 93,
    "kristine lilly": 92,        # most caps in football history (354)
    "carli lloyd": 93,           # 2015 final hat-trick
    "alex morgan": 92,
    "megan rapinoe": 92,
    "hope solo": 92,
    "briana scurry": 90,
    "nadine angerer": 90,        # 2007 GK didn't concede a single goal
    "celia sasic": 88,
    "anja mittag": 87,
    "sandra smisek": 87,
    "kim little": 89,
    "lucy bronze": 92,
    "ellen white": 89,
    "steph houghton": 88,
    "fara williams": 87,
    "vivianne miedema": 92,
    "lieke martens": 90,
    "sherida spitse": 86,
    "sari van veenendaal": 88,
    "pernille harder": 91,
    "ada hegerberg": 92,
    "wendie renard": 92,
    "eugenie le sommer": 90,
    "amandine henry": 89,
    "louisa necib": 89,
    "amel majri": 87,
    "elise bussaglia": 86,
    "sarah bouhaddi": 89,
    "sara dabritz": 86,
    "alexandra popp": 90,
    "lena oberdorf": 89,
    "almuth schult": 89,
    "saskia bartusiak": 87,
    "lena goessling": 86,
    "linda bresonik": 86,
    "kelly smith": 91,
    "alex scott": 87,
    "rachel yankey": 86,
    "casey stoney": 86,
    "asisat oshoala": 89,
    "perpetua nkwocha": 88,
    "florence omagbemi": 86,
    "christine sinclair": 92,
    "kara lang": 86,
    "diana matheson": 85,
    "melissa tancredi": 85,
    "sophie schmidt": 86,
    "hedvig lindahl": 88,
    "caroline seger": 88,
    "lotta schelin": 90,
    "kosovare asllani": 88,
    "nilla fischer": 87,
    "lisa dahlkvist": 85,
    "hanna ljungberg": 88,
    "linda sembrant": 86,
    "magdalena eriksson": 88,
    "fridolina rolfo": 88,
    "stina blackstenius": 86,
    "aya miyama": 89,
    "saki kumagai": 88,
    "azusa iwashimizu": 87,
    "mana iwabuchi": 87,
    "rie yamaki": 86,
    "yuki nagasato": 86,
    "ji so-yun": 90,
    "cho so-hyun": 86,
    "li ying": 86,
    "wang shuang": 89,
    "rosana augusto": 87,
    "formiga": 90,                # 7 WWCs!
    "cristiane rozeira": 89,
    "andressa alves": 87,
    "miraildes maciel mota": 90, # Formiga's full name in some sources
    "khadidiatou diani": 89,
    "marie-antoinette katoto": 90,
    "delphine cascarino": 87,
    "kadidiatou diani": 89,
    "tabitha chawinga": 88,
    "barbra banda": 88,
    "thembi kgatlana": 87,
    "rebecca smith": 86,
    "ali riley": 86,
    "abby erceg": 87,
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]+", "", s).strip()


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower())


# Defaults for new WWC nations. Same shape as build_wc_squads.py.
NATION_DEFAULTS = {
    "United States":      {"city": "Washington",  "color": "#bf0a30", "founded": 1913, "strength": 95},
    "Germany":            {"city": "Berlin",      "color": "#000000", "founded": 1900, "strength": 92},
    "Norway":             {"city": "Oslo",        "color": "#ba0c2f", "founded": 1902, "strength": 86},
    "Sweden":             {"city": "Stockholm",   "color": "#005f9f", "founded": 1904, "strength": 88},
    "Brazil":             {"city": "Brasília",    "color": "#009b3a", "founded": 1914, "strength": 88},
    "Japan":              {"city": "Tokyo",       "color": "#bc002d", "founded": 1921, "strength": 88},
    "Nigeria":            {"city": "Abuja",       "color": "#008751", "founded": 1945, "strength": 84},
    "China":              {"city": "Beijing",     "color": "#de2910", "founded": 1924, "strength": 83},
    "Australia":          {"city": "Canberra",    "color": "#00843d", "founded": 1961, "strength": 88},
    "Canada":             {"city": "Ottawa",      "color": "#ff0000", "founded": 1912, "strength": 86},
    "England":            {"city": "London",      "color": "#ce1124", "founded": 1863, "strength": 90},
    "France":             {"city": "Paris",       "color": "#0055a4", "founded": 1919, "strength": 90},
    "Spain":              {"city": "Madrid",      "color": "#aa151b", "founded": 1909, "strength": 92},
    "Netherlands":        {"city": "Amsterdam",   "color": "#ff5b00", "founded": 1889, "strength": 90},
    "Italy":              {"city": "Rome",        "color": "#008c45", "founded": 1898, "strength": 82},
    "Denmark":            {"city": "Copenhagen",  "color": "#c8102e", "founded": 1889, "strength": 82},
    "New Zealand":        {"city": "Wellington",  "color": "#000000", "founded": 1891, "strength": 76},
    "South Korea":        {"city": "Seoul",       "color": "#cd2e3a", "founded": 1928, "strength": 80},
    "North Korea":        {"city": "Pyongyang",   "color": "#ed1c27", "founded": 1945, "strength": 82},
    "Mexico":             {"city": "Mexico City", "color": "#006847", "founded": 1927, "strength": 78},
    "Argentina":          {"city": "Buenos Aires","color": "#75aadb", "founded": 1903, "strength": 80},
    "Colombia":           {"city": "Bogotá",      "color": "#fcd116", "founded": 1924, "strength": 78},
    "Chile":              {"city": "Santiago",    "color": "#d52b1e", "founded": 1895, "strength": 76},
    "Costa Rica":         {"city": "San José",    "color": "#002b7f", "founded": 1921, "strength": 75},
    "Thailand":           {"city": "Bangkok",     "color": "#a51931", "founded": 1916, "strength": 72},
    "Ghana":              {"city": "Accra",       "color": "#006b3f", "founded": 1957, "strength": 78},
    "Cameroon":           {"city": "Yaoundé",     "color": "#007a5e", "founded": 1959, "strength": 78},
    "South Africa":       {"city": "Johannesburg","color": "#007749", "founded": 1991, "strength": 78},
    "Switzerland":        {"city": "Bern",        "color": "#ff0000", "founded": 1895, "strength": 80},
    "Scotland":           {"city": "Glasgow",     "color": "#0065bd", "founded": 1873, "strength": 77},
    "Russia":             {"city": "Moscow",      "color": "#d52b1e", "founded": 1912, "strength": 78},
    "Jamaica":            {"city": "Kingston",    "color": "#fed100", "founded": 1910, "strength": 74},
    "Equatorial Guinea":  {"city": "Malabo",      "color": "#3e9a00", "founded": 1976, "strength": 70},
    "Ivory Coast":        {"city": "Yamoussoukro","color": "#f77f00", "founded": 1960, "strength": 76},
    "Ecuador":            {"city": "Quito",       "color": "#fcd116", "founded": 1925, "strength": 73},
    "Republic of Ireland":{"city": "Dublin",      "color": "#169b62", "founded": 1921, "strength": 79},
}
DEFAULT_NATION = {"city": "—", "color": "#666666", "founded": 1950, "strength": 70}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    # 1. Load women's squads
    with open(SQUAD_CSV) as f:
        squads = [s for s in csv.DictReader(f) if "Women's" in s["tournament_name"]]
    print(f"Source women's WC entries: {len(squads):,}")

    # 2. Build the clubs list (nations as clubs)
    nation_names = sorted({s["team_name"] for s in squads})
    clubs = []
    for name in nation_names:
        d = NATION_DEFAULTS.get(name, DEFAULT_NATION)
        clubs.append({
            "id": slugify(name),
            "name": name,
            "short": name[:3].upper(),
            "city": d["city"],
            "color": d["color"],
            "founded": d["founded"],
            "strength": d["strength"],
            "era": "current",
            "era_tier": "current",
            "era_tiers": ["current", "00s", "90s"],
        })
    name_to_id = {c["name"]: c["id"] for c in clubs}
    print(f"Nations: {len(clubs)}")

    # 3. Aggregate per (player_id, team)
    agg = {}
    for s in squads:
        team_id = name_to_id[s["team_name"]]
        key = (s["player_id"], team_id)
        full_name = (s["given_name"] + " " + s["family_name"]).strip()
        year = int(s["tournament_id"].split("-")[1])
        bucket = POS_MAP.get(s["position_code"], "CM")
        if key not in agg:
            agg[key] = {
                "name": full_name,
                "position": bucket,
                "club": team_id,
                "nationality": s["team_name"],
                "years": [year],
            }
        else:
            agg[key]["years"].append(year)

    # 4. Compute ratings + finalize
    legend_hits = 0
    players_out = []
    for p in agg.values():
        n = norm(p["name"])
        if n in LEGEND_RATINGS:
            rating = LEGEND_RATINGS[n]
            legend_hits += 1
        else:
            appearances = len(set(p["years"]))
            rating = min(BASELINE_RATING + (appearances - 1) * PER_APPEARANCE_BONUS, MAX_HEURISTIC_RATING)
        years = sorted(set(p["years"]))
        career_years = f"{years[0]}-{years[-1]}" if len(years) > 1 else str(years[0])
        players_out.append({
            "name": p["name"],
            "position": p["position"],
            "prime_rating": int(rating),
            "career_years": career_years,
            "nationality": p["nationality"],
            "club": p["club"],
        })
    players_out.sort(key=lambda x: (x["club"], -x["prime_rating"], x["name"]))

    print(f"\nBuilt {len(players_out):,} WWC players")
    print(f"  Legend overrides: {legend_hits}")
    print(f"  Heuristic baseline: {len(players_out) - legend_hits}")
    print("\nTop 10 nations by player count:")
    counts = Counter(p["club"] for p in players_out)
    for cid, n in counts.most_common(10):
        cname = next(c["name"] for c in clubs if c["id"] == cid)
        print(f"  {cname:22} {n} players")

    if args.dry_run:
        print("\n--dry-run, not writing.")
        return 0

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "clubs.json").write_text(
        json.dumps(clubs, indent=2, ensure_ascii=False) + "\n"
    )
    (DATA_DIR / "players.json").write_text(
        json.dumps(players_out, indent=2, ensure_ascii=False) + "\n"
    )
    print(f"\nWrote {len(clubs)} clubs to src/data/womenscup/clubs.json")
    print(f"Wrote {len(players_out)} players to src/data/womenscup/players.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
