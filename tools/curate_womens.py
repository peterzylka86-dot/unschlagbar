#!/usr/bin/env python3
"""
curate_womens.py — hand-curated expansion of the women's-football roster.

No public FIFA mirror has women's player data (iammubix only has men's
FIFA17-23), so this expansion is hand-curated rather than ingested. Source
of truth for each entry is current top-flight women's football roster
knowledge (UWCL, NWSL, national-team selections as of 2024-2025).

Schema matches src/data/womens/players.json:
  name, position, prime_rating, career_years, nationality, club

Ratings are calibrated against the existing women's records (top stars at
the time of curation were 88-92; first-team starters at top clubs were
84-87; squad depth was 80-84). I've stayed conservative — better to under-
rate a star than over-rate a journeyman.

Run from repo root:    python3 tools/curate_womens.py
Use --dry-run to preview without writing.
Idempotent: dedups by (normalized name, position, club).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "src" / "data" / "womens" / "players.json"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


# Per-club additions. Each entry: (name, position, prime_rating, career_years, nationality)
# Conservative coverage — only players I'm confident about. Ratings calibrated against
# existing women's-roster baseline (88-92 = elite, 84-87 = starter, 80-83 = depth).
ADDITIONS: dict[str, list[tuple[str, str, int, str, str]]] = {
    "barcelonafem": [
        ("Aitana Bonmatí",          "CM",  93, "2016-2026", "Spain"),
        ("Alexia Putellas",         "CAM", 92, "2012-2026", "Spain"),
        ("Patri Guijarro",          "CDM", 89, "2015-2026", "Spain"),
        ("Salma Paralluelo",        "LW",  88, "2022-2026", "Spain"),
        ("Mariona Caldentey",       "CAM", 88, "2014-2024", "Spain"),
        ("Caroline Graham Hansen",  "RW",  91, "2019-2026", "Norway"),
        ("Asisat Oshoala",          "ST",  88, "2019-2024", "Nigeria"),
        ("Sandra Paños",            "GK",  87, "2015-2023", "Spain"),
        ("Jennifer Hermoso",        "CAM", 89, "2013-2023", "Spain"),
        ("Esmee Brugts",            "LW",  84, "2023-2026", "Netherlands"),
    ],
    "lyonfem": [
        ("Eugénie Le Sommer",       "ST",  91, "2010-2026", "France"),
        ("Amel Majri",              "LB",  87, "2012-2026", "France"),
        ("Sara Däbritz",            "CM",  86, "2022-2026", "Germany"),
        ("Lindsey Horan",           "CM",  90, "2022-2026", "USA"),
        ("Damaris Egurrola",        "CDM", 86, "2022-2026", "Netherlands"),
        ("Sarah Bouhaddi",          "GK",  90, "2008-2023", "France"),
        ("Kadeisha Buchanan",       "CB",  88, "2017-2022", "Canada"),
        ("Saki Kumagai",            "CDM", 88, "2013-2021", "Japan"),
        ("Selma Bacha",             "LB",  86, "2019-2026", "France"),
        ("Vanessa Gilles",          "CB",  85, "2022-2026", "Canada"),
        ("Delphine Cascarino",      "RW",  86, "2016-2024", "France"),
    ],
    "chelseafem": [
        ("Sam Kerr",                "ST",  93, "2020-2026", "Australia"),
        ("Lauren James",            "CAM", 88, "2021-2026", "England"),
        ("Pernille Harder",         "CAM", 91, "2020-2023", "Denmark"),
        ("Magdalena Eriksson",      "CB",  88, "2017-2023", "Sweden"),
        ("Millie Bright",           "CB",  88, "2014-2026", "England"),
        ("Erin Cuthbert",           "CM",  86, "2017-2026", "Scotland"),
        ("Ji So-yun",               "CAM", 89, "2014-2022", "South Korea"),
        ("Fran Kirby",              "CAM", 88, "2015-2024", "England"),
        ("Mayra Ramírez",           "ST",  85, "2024-2026", "Colombia"),
        ("Hannah Hampton",          "GK",  85, "2023-2026", "England"),
        ("Niamh Charles",           "LB",  83, "2020-2026", "England"),
    ],
    "arsenalfem": [
        ("Beth Mead",               "RW",  89, "2017-2026", "England"),
        ("Vivianne Miedema",        "ST",  92, "2017-2024", "Netherlands"),
        ("Leah Williamson",         "CB",  89, "2014-2026", "England"),
        ("Caitlin Foord",           "ST",  86, "2020-2026", "Australia"),
        ("Kim Little",              "CAM", 89, "2008-2026", "Scotland"),
        ("Lia Wälti",               "CDM", 86, "2018-2026", "Switzerland"),
        ("Frida Maanum",            "CM",  85, "2021-2026", "Norway"),
        ("Stina Blackstenius",      "ST",  85, "2022-2026", "Sweden"),
        ("Manuela Zinsberger",      "GK",  87, "2019-2026", "Austria"),
        ("Steph Catley",            "LB",  86, "2020-2026", "Australia"),
        ("Katie McCabe",            "LB",  88, "2015-2026", "Ireland"),
    ],
    "bayernfem": [
        ("Lea Schüller",            "ST",  89, "2020-2026", "Germany"),
        ("Klara Bühl",              "LW",  88, "2020-2026", "Germany"),
        ("Lina Magull",             "CAM", 86, "2016-2024", "Germany"),
        ("Linda Dallmann",          "CAM", 85, "2019-2026", "Germany"),
        ("Sydney Lohmann",          "CM",  85, "2018-2026", "Germany"),
        ("Sarah Zadrazil",          "CM",  84, "2020-2026", "Austria"),
        ("Glódis Viggósdóttir",     "CB",  86, "2021-2026", "Iceland"),
        ("Mala Grohs",              "GK",  84, "2022-2026", "Germany"),
        ("Georgia Stanway",         "CM",  87, "2022-2026", "England"),
        ("Pernille Harder",         "CAM", 90, "2024-2026", "Denmark"),
    ],
    "wolfsburgfem": [
        ("Alexandra Popp",          "ST",  91, "2012-2026", "Germany"),
        ("Lena Oberdorf",           "CDM", 90, "2020-2024", "Germany"),
        ("Svenja Huth",             "RW",  87, "2018-2026", "Germany"),
        ("Ewa Pajor",               "ST",  89, "2015-2024", "Poland"),
        ("Almuth Schult",           "GK",  90, "2012-2022", "Germany"),
        ("Dominique Janssen",       "CB",  85, "2019-2026", "Netherlands"),
        ("Kathrin Hendrich",        "CB",  85, "2018-2026", "Germany"),
        ("Tabea Waßmuth",           "RW",  84, "2021-2026", "Germany"),
        ("Felicitas Rauch",         "LB",  84, "2019-2026", "Germany"),
        ("Jule Brand",              "RW",  85, "2022-2026", "Germany"),
        ("Marina Hegering",         "CB",  86, "2021-2024", "Germany"),
    ],
    "psgfem": [
        ("Marie-Antoinette Katoto", "ST",  91, "2018-2026", "France"),
        ("Kadidiatou Diani",        "RW",  88, "2018-2023", "France"),
        ("Grace Geyoro",            "CM",  88, "2014-2026", "France"),
        ("Sakina Karchaoui",        "LB",  86, "2020-2026", "France"),
        ("Tabitha Chawinga",        "ST",  87, "2024-2026", "Malawi"),
        ("Constance Picaud",        "GK",  82, "2022-2026", "France"),
        ("Sandy Baltimore",         "LW",  85, "2019-2024", "France"),
        ("Ramona Bachmann",         "ST",  85, "2018-2020", "Switzerland"),
        ("Christiane Endler",       "GK",  90, "2017-2021", "Chile"),
    ],
    "realmadridfem": [
        ("Caroline Weir",           "CAM", 87, "2022-2026", "Scotland"),
        ("Olga Carmona",            "LB",  87, "2019-2026", "Spain"),
        ("Linda Caicedo",           "RW",  86, "2023-2026", "Colombia"),
        ("Athenea del Castillo",    "RW",  85, "2021-2026", "Spain"),
        ("Misa Rodríguez",          "GK",  85, "2020-2026", "Spain"),
        ("Sandie Toletti",          "CM",  84, "2022-2026", "France"),
        ("Teresa Abelleira",        "CDM", 85, "2021-2026", "Spain"),
        ("Maëlle Lakrar",           "CB",  84, "2024-2026", "France"),
        ("Naomie Feller",           "ST",  82, "2022-2026", "France"),
    ],
    "manchestercityfem": [
        ("Lauren Hemp",             "LW",  90, "2018-2026", "England"),
        ("Khadija Shaw",            "ST",  90, "2022-2026", "Jamaica"),
        ("Alex Greenwood",          "CB",  88, "2020-2026", "England"),
        ("Chloe Kelly",             "RW",  86, "2020-2024", "England"),
        ("Ellie Roebuck",           "GK",  85, "2017-2024", "England"),
        ("Mary Fowler",             "CAM", 85, "2022-2026", "Australia"),
        ("Yui Hasegawa",            "CM",  87, "2022-2026", "Japan"),
        ("Jess Park",               "CAM", 83, "2022-2026", "England"),
        ("Filippa Angeldal",        "CM",  84, "2023-2026", "Sweden"),
        ("Kerstin Casparij",        "RB",  84, "2022-2026", "Netherlands"),
    ],
    "manchesterunitedfem": [
        ("Mary Earps",              "GK",  91, "2019-2024", "England"),
        ("Ella Toone",              "CAM", 88, "2018-2026", "England"),
        ("Maya Le Tissier",         "CB",  85, "2022-2026", "England"),
        ("Leah Galton",             "LW",  86, "2018-2026", "England"),
        ("Lucía García",            "ST",  85, "2023-2026", "Spain"),
        ("Hinata Miyazawa",         "CM",  86, "2024-2026", "Japan"),
        ("Geyse",                   "RW",  84, "2023-2025", "Brazil"),
        ("Rachel Williams",         "ST",  82, "2022-2024", "England"),
        ("Aoife Mannion",           "CB",  83, "2021-2026", "Ireland"),
        ("Phallon Tullis-Joyce",    "GK",  84, "2024-2026", "USA"),
    ],
    "juventusfem": [
        ("Cristiana Girelli",       "ST",  88, "2018-2026", "Italy"),
        ("Barbara Bonansea",        "LW",  86, "2017-2026", "Italy"),
        ("Lineth Beerensteyn",      "RW",  85, "2022-2026", "Netherlands"),
        ("Sara Gama",               "CB",  86, "2017-2024", "Italy"),
        ("Cecilia Salvai",          "CB",  84, "2017-2026", "Italy"),
        ("Sofie Pedersen",          "CDM", 83, "2022-2026", "Denmark"),
        ("Lina Hurtig",             "ST",  84, "2019-2022", "Sweden"),
        ("Lisa Boattin",            "LB",  85, "2018-2026", "Italy"),
        ("Pauline Peyraud-Magnin",  "GK",  85, "2021-2026", "France"),
        ("Arianna Caruso",          "CM",  85, "2018-2026", "Italy"),
    ],
    "romafem": [
        ("Manuela Giugliano",       "CAM", 87, "2019-2026", "Italy"),
        ("Valentina Giacinti",      "ST",  86, "2022-2026", "Italy"),
        ("Annamaria Serturini",     "RW",  84, "2019-2026", "Italy"),
        ("Evelyne Viens",           "ST",  83, "2022-2024", "Canada"),
        ("Andressa Alves",          "RW",  83, "2018-2024", "Brazil"),
        ("Camelia Ceasar",          "GK",  84, "2019-2026", "Romania"),
        ("Saki Kumagai",            "CDM", 87, "2021-2024", "Japan"),
        ("Emilie Haavi",            "LW",  84, "2022-2026", "Norway"),
        ("Elena Linari",            "CB",  84, "2020-2026", "Italy"),
        ("Benedetta Glionna",       "ST",  82, "2022-2026", "Italy"),
    ],
    "kchiefs": [
        ("Debinha",                 "CAM", 89, "2023-2026", "Brazil"),
        ("Temwa Chawinga",          "ST",  89, "2024-2026", "Malawi"),
        ("Lo'eau LaBonta",          "CM",  85, "2021-2026", "USA"),
        ("Vanessa DiBernardo",      "CM",  83, "2022-2026", "USA"),
        ("AD Franch",               "GK",  86, "2022-2026", "USA"),
        ("Hailie Mace",             "LB",  84, "2022-2026", "USA"),
        ("Michelle Cooper",         "ST",  83, "2023-2026", "USA"),
        ("Lorena",                  "CB",  83, "2024-2026", "Brazil"),
        ("Adriana",                 "RW",  83, "2023-2025", "Brazil"),
    ],
    "portland": [
        ("Sophia Smith",            "ST",  91, "2020-2026", "USA"),
        ("Crystal Dunn",            "LB",  88, "2021-2024", "USA"),
        ("Sam Coffey",              "CDM", 87, "2022-2026", "USA"),
        ("Christine Sinclair",      "ST",  91, "2013-2023", "Canada"),
        ("Becky Sauerbrunn",        "CB",  90, "2016-2022", "USA"),
        ("Janine Beckie",           "RW",  84, "2022-2024", "Canada"),
        ("Bella Bixby",             "GK",  84, "2020-2026", "USA"),
        ("Olivia Moultrie",         "CAM", 83, "2021-2026", "USA"),
        ("Reyna Reyes",             "LB",  82, "2023-2026", "USA"),
    ],
    "orlando": [
        ("Marta",                   "CAM", 94, "2017-2026", "Brazil"),
        ("Barbra Banda",            "ST",  90, "2024-2026", "Zambia"),
        ("Adriana",                 "RW",  84, "2022-2024", "Brazil"),
        ("Anna Moorhouse",          "GK",  85, "2022-2026", "England"),
        ("Kerry Abello",            "LW",  82, "2024-2026", "USA"),
        ("Angelina",                "CM",  83, "2022-2024", "Brazil"),
        ("Brittany Wilson",         "CB",  82, "2024-2026", "USA"),
        ("Haley McCutcheon",        "CDM", 81, "2023-2026", "USA"),
        ("Carrie Lawrence",         "CM",  81, "2023-2026", "USA"),
        ("Ally Watt",               "ST",  81, "2022-2025", "USA"),
    ],
    "ngsuper": [
        ("Esther González",         "ST",  88, "2023-2026", "Spain"),
        ("Lynn Williams",           "ST",  86, "2022-2026", "USA"),
        ("Midge Purce",             "RW",  85, "2020-2026", "USA"),
        ("Mandy Freeman",           "CB",  82, "2019-2024", "USA"),
        ("Jaedyn Shaw",             "CAM", 86, "2023-2026", "USA"),
        ("Yuki Nagasato",           "ST",  82, "2020-2023", "Japan"),
        ("Mandy Haught",            "GK",  82, "2023-2026", "USA"),
        ("Tierna Davidson",         "CB",  85, "2023-2026", "USA"),
        ("Crystal Dunn",            "LB",  88, "2024-2026", "USA"),
    ],
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    existing = json.loads(OUT.read_text())
    existing_keys = {(norm(p["name"]), p["position"], p["club"]) for p in existing}

    flat = []
    for club_id, players in ADDITIONS.items():
        for name, pos, ovr, years, nat in players:
            flat.append({
                "name": name,
                "position": pos,
                "prime_rating": ovr,
                "career_years": years,
                "nationality": nat,
                "club": club_id,
            })

    to_add = [p for p in flat
              if (norm(p["name"]), p["position"], p["club"]) not in existing_keys]
    dropped = len(flat) - len(to_add)
    print(f"Curated: {len(flat)} entries")
    print(f"  → already in roster: {dropped}")
    print(f"  → new: {len(to_add)}")
    print()
    print("Per-club additions:")
    from collections import Counter
    by_club = Counter(p["club"] for p in to_add)
    for c, n in sorted(by_club.items(), key=lambda kv: -kv[1]):
        print(f"  {c:25} +{n}")

    if args.dry_run:
        print("\n--dry-run, not writing.")
        return 0

    merged = existing + to_add
    OUT.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n")
    print(f"\nWrote {len(merged)} total players to {OUT.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
