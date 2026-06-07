#!/usr/bin/env python3
"""
build_wc2026.py — assemble the LIVE 2026 World Cup league from announced squads.

Input:  tools/.wikipedia_cache/wc2026_squads.json (1,244 real player entries
        from the Wikipedia parse-API run by tools/parse_wc2026_wikitext.py).

Output: src/data/worldcup2026/{clubs,players}.json

Cross-references ratings against existing data (FIFA17-23 cache + the other
unschlagbar league rosters) so when the wheel lands on Spain you see Yamal
at OVR 90, not OVR 75. Falls back to a club-strength-tier baseline for
players we don't have FIFA data on.

Run from repo root:    python3 tools/build_wc2026.py
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
SQUADS = REPO / "tools" / ".wikipedia_cache" / "wc2026_squads.json"
FIFA_CACHE = REPO / "tools" / ".fifa_cache"
OUT_DIR = REPO / "src" / "data" / "worldcup2026"
OUT_PLAYERS = OUT_DIR / "players.json"
OUT_CLUBS = OUT_DIR / "clubs.json"

# Wikipedia 4-bucket → unschlagbar 10-bucket (coarse mapping, like jfjelstul WC)
POS_MAP = {"GK": "GK", "DF": "CB", "MF": "CM", "FW": "ST"}

# Per-nation strength estimate (FIFA-ranking-ish, rough). Used both for the
# club.strength attribute and as a fallback rating tier for unrated players.
NATION_STRENGTH = {
    "spain": 96, "france": 95, "argentina": 95, "brazil": 94, "england": 94,
    "portugal": 93, "germany": 93, "netherlands": 92, "italy": 91, "belgium": 90,
    "croatia": 88, "uruguay": 88, "morocco": 87, "colombia": 86, "mexico": 84,
    "switzerland": 84, "japan": 84, "denmark": 84, "senegal": 83, "usa": 82,
    "ecuador": 81, "south korea": 81, "australia": 80, "sweden": 80, "norway": 86,
    "ivorycoast": 81, "ghana": 80, "iran": 79, "drcongo": 78, "egypt": 80,
    "tunisia": 78, "algeria": 80, "scotland": 80, "austria": 81, "turkey": 81,
    "canada": 78, "saudiarabia": 77, "qatar": 75, "newzealand": 73, "panama": 73,
    "iraq": 72, "paraguay": 75, "uzbekistan": 73, "jordan": 72, "haiti": 71,
    "southafrica": 75, "capeverde": 72, "curacao": 70, "czechrepublic": 81,
    "bosniaandherzegovina": 80,
}

# Nation display names + flags + cities (for the new clubs.json)
NATION_META = {
    "argentina":         ("Argentina",          "ARG", "Buenos Aires", "#75aadb"),
    "brazil":            ("Brazil",             "BRA", "Brasília",     "#009b3a"),
    "france":            ("France",             "FRA", "Paris",        "#0055a4"),
    "germany":           ("Germany",            "GER", "Berlin",       "#000000"),
    "england":           ("England",            "ENG", "London",       "#ce1124"),
    "spain":             ("Spain",              "ESP", "Madrid",       "#aa151b"),
    "portugal":          ("Portugal",           "POR", "Lisbon",       "#006600"),
    "netherlands":       ("Netherlands",        "NED", "Amsterdam",    "#ff5b00"),
    "belgium":           ("Belgium",            "BEL", "Brussels",     "#fcd116"),
    "croatia":           ("Croatia",            "CRO", "Zagreb",       "#ff0000"),
    "uruguay":           ("Uruguay",            "URU", "Montevideo",   "#7b96d4"),
    "mexico":            ("Mexico",             "MEX", "Mexico City",  "#006847"),
    "usa":               ("United States",      "USA", "Washington",   "#bf0a30"),
    "unitedstates":      ("United States",      "USA", "Washington",   "#bf0a30"),
    "canada":            ("Canada",             "CAN", "Ottawa",       "#d52b1e"),
    "japan":             ("Japan",              "JPN", "Tokyo",        "#bc002d"),
    "southkorea":        ("South Korea",        "KOR", "Seoul",        "#cd2e3a"),
    "australia":         ("Australia",          "AUS", "Canberra",     "#00843d"),
    "morocco":           ("Morocco",            "MAR", "Rabat",        "#c1272d"),
    "senegal":           ("Senegal",            "SEN", "Dakar",        "#00853f"),
    "ghana":             ("Ghana",              "GHA", "Accra",        "#006b3f"),
    "ivorycoast":        ("Ivory Coast",        "CIV", "Yamoussoukro", "#f77f00"),
    "drcongo":           ("DR Congo",           "COD", "Kinshasa",     "#007fff"),
    "egypt":             ("Egypt",              "EGY", "Cairo",        "#ce1126"),
    "tunisia":           ("Tunisia",            "TUN", "Tunis",        "#e70013"),
    "algeria":           ("Algeria",            "ALG", "Algiers",      "#006233"),
    "southafrica":       ("South Africa",       "RSA", "Pretoria",     "#007749"),
    "capeverde":         ("Cape Verde",         "CPV", "Praia",        "#003893"),
    "iran":              ("Iran",               "IRN", "Tehran",       "#239f40"),
    "saudiarabia":       ("Saudi Arabia",       "KSA", "Riyadh",       "#006c35"),
    "iraq":              ("Iraq",               "IRQ", "Baghdad",      "#ce1126"),
    "jordan":            ("Jordan",             "JOR", "Amman",        "#000000"),
    "qatar":             ("Qatar",              "QAT", "Doha",         "#8a1538"),
    "paraguay":          ("Paraguay",           "PAR", "Asunción",     "#d52b1e"),
    "ecuador":           ("Ecuador",            "ECU", "Quito",        "#fcd116"),
    "colombia":          ("Colombia",           "COL", "Bogotá",       "#fcd116"),
    "czechrepublic":     ("Czech Republic",     "CZE", "Prague",       "#11457e"),
    "scotland":          ("Scotland",           "SCO", "Glasgow",      "#0065bd"),
    "switzerland":       ("Switzerland",        "SUI", "Bern",         "#ff0000"),
    "austria":           ("Austria",            "AUT", "Vienna",       "#ed2939"),
    "norway":            ("Norway",             "NOR", "Oslo",         "#ba0c2f"),
    "sweden":            ("Sweden",             "SWE", "Stockholm",    "#005f9f"),
    "panama":            ("Panama",             "PAN", "Panama City",  "#005293"),
    "haiti":             ("Haiti",              "HAI", "Port-au-Prince", "#00209f"),
    "curacao":           ("Curaçao",            "CUW", "Willemstad",   "#002b7f"),
    "newzealand":        ("New Zealand",        "NZL", "Wellington",   "#000000"),
    "uzbekistan":        ("Uzbekistan",         "UZB", "Tashkent",     "#1eb53a"),
    "turkey":            ("Turkey",             "TUR", "Ankara",       "#e30a17"),
    "bosniaandherzegovina": ("Bosnia and Herzegovina", "BIH", "Sarajevo", "#002395"),
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def to_int(s, default=50):
    try: return int(float(s))
    except (TypeError, ValueError): return default


def load_fifa_index() -> dict[str, int]:
    """Build a name → max-overall index across all FIFA editions.
    Uses surname / first-initial-surname / full-name keys for fuzzy match."""
    idx: dict[str, int] = {}
    if not FIFA_CACHE.exists():
        return idx
    for csv_path in sorted(FIFA_CACHE.glob("FIFA*_official_data.csv")):
        with open(csv_path) as f:
            for row in csv.DictReader(f):
                name = (row.get("Name") or "").strip()
                if not name:
                    continue
                ovr = to_int(row.get("Overall"))
                if ovr < 60:
                    continue
                full = norm(name)
                idx[full] = max(idx.get(full, 0), ovr)
                tokens = full.split()
                if not tokens:
                    continue
                if len(tokens[-1]) >= 4:
                    sur = tokens[-1]
                    idx[sur] = max(idx.get(sur, 0), ovr)
                if len(tokens) >= 2:
                    init = tokens[0][0] + " " + tokens[-1]
                    idx[init] = max(idx.get(init, 0), ovr)
    return idx


def load_existing_player_index() -> dict[str, int]:
    """Pull ratings from already-shipped leagues so cross-ref hits curated stars."""
    idx: dict[str, int] = {}
    for L in ("bundesliga", "laliga", "seriea", "swiss", "ucl", "worldcup", "womens"):
        path = REPO / "src" / "data" / L / "players.json"
        if not path.exists(): continue
        try:
            players = json.loads(path.read_text())
        except Exception:
            continue
        for p in players:
            name = p.get("name", "")
            rating = p.get("prime_rating", 0)
            if not name or rating < 60:
                continue
            full = norm(name)
            idx[full] = max(idx.get(full, 0), rating)
            tokens = full.split()
            if len(tokens) >= 2 and len(tokens[-1]) >= 4:
                init = tokens[0][0] + " " + tokens[-1]
                idx[init] = max(idx.get(init, 0), rating)
                idx[tokens[-1]] = max(idx.get(tokens[-1], 0), rating)
    return idx


def lookup_rating(name: str, *indexes: dict[str, int]) -> int | None:
    """Try multiple name-shapes against each index in order."""
    n = norm(name)
    tokens = n.split()
    candidates = [n]
    if len(tokens) >= 2:
        candidates.append(tokens[0][0] + " " + tokens[-1])
    if tokens and len(tokens[-1]) >= 5:
        candidates.append(tokens[-1])
    for idx in indexes:
        for c in candidates:
            if c in idx:
                return idx[c]
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    raw = json.loads(SQUADS.read_text())
    meta = raw.pop("_meta", {})
    print(f"Source: {meta.get('source','unknown')}")
    print(f"Fetched: {meta.get('fetched_via','direct API')}")
    print()

    fifa_idx = load_fifa_index()
    print(f"FIFA17-23 rating index: {len(fifa_idx):,} keys")
    existing_idx = load_existing_player_index()
    print(f"Existing-league rating index: {len(existing_idx):,} keys")
    print()

    # Build clubs.json — one entry per nation
    clubs = []
    for cid in raw.keys():
        meta_entry = NATION_META.get(cid)
        if not meta_entry:
            print(f"  ! no NATION_META for {cid!r} — using defaults")
            display = cid.title()
            short = cid[:3].upper()
            city = "—"
            color = "#666666"
        else:
            display, short, city, color = meta_entry
        clubs.append({
            "id": cid,
            "name": display,
            "short": short,
            "city": city,
            "color": color,
            "founded": 1900,
            "strength": NATION_STRENGTH.get(cid, 75),
            "era": "current",
            "era_tier": "current",
            "era_tiers": ["current"],
        })

    # Build players.json — every squad entry, cross-referenced for rating
    players_out = []
    fifa_hits = 0
    existing_hits = 0
    baseline_hits = 0
    for cid, squad in raw.items():
        nation_strength = NATION_STRENGTH.get(cid, 75)
        # Baseline rating: scale down from nation strength a bit so the WHOLE
        # squad isn't at the nation's peak.
        baseline = max(72, nation_strength - 6)
        nation_display = NATION_META.get(cid, (cid.title(),))[0]
        for p in squad:
            rating = lookup_rating(p["name"], existing_idx, fifa_idx)
            if rating is not None:
                if norm(p["name"]) in existing_idx or (
                    len(p["name"].split()) >= 2 and
                    (p["name"].split()[0][0] + " " + p["name"].split()[-1]).lower() in existing_idx
                ):
                    existing_hits += 1
                else:
                    fifa_hits += 1
            else:
                rating = baseline
                baseline_hits += 1
            players_out.append({
                "name": p["name"],
                "position": POS_MAP.get(p["position"], "CM"),
                "prime_rating": int(rating),
                "career_years": "2026",
                "nationality": nation_display,
                "club": cid,
            })

    # Sort: by nation, then rating desc
    players_out.sort(key=lambda x: (x["club"], -x["prime_rating"], x["name"]))

    print(f"Built {len(players_out)} player entries across {len(clubs)} nations")
    print(f"  Existing-league rating match: {existing_hits}")
    print(f"  FIFA17-23 rating match:       {fifa_hits}")
    print(f"  Heuristic baseline:           {baseline_hits}")
    print()

    # Spot the top 12 to verify
    print("Top 12 rated players (sanity check):")
    for p in sorted(players_out, key=lambda x: -x["prime_rating"])[:12]:
        print(f"  {p['name']:25} {p['position']:3} OVR={p['prime_rating']:>2} → {p['nationality']}")

    if args.dry_run:
        print("\n--dry-run, not writing.")
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_CLUBS.write_text(json.dumps(clubs, indent=2, ensure_ascii=False) + "\n")
    OUT_PLAYERS.write_text(json.dumps(players_out, indent=2, ensure_ascii=False) + "\n")
    print(f"\nWrote {len(clubs)} clubs to {OUT_CLUBS.relative_to(REPO)}")
    print(f"Wrote {len(players_out)} players to {OUT_PLAYERS.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
