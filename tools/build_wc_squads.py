#!/usr/bin/env python3
"""
build_wc_squads.py — rebuild the World Cup roster from real squad data.

The previous src/data/worldcup/players.json was nationality-extracted from
the Bundesliga/La Liga/Serie A/Swiss FIFA datasets — so it included every
domestic-league journeyman with German nationality whether or not they ever
made the national team. The user (correctly) flagged this: World Cup mode
should only contain players who actually played in a World Cup.

Source of truth: jfjelstul/worldcup (GitHub) — squads.csv has every player
in every men's World Cup squad from 1930 to 2022. We aggregate per
(player, nation) so each player appears once with all their WC appearances
folded into career_years.

Rating strategy:
  - Cross-reference player name against the FIFA17-23 cache. If matched,
    use that player's prime FIFA rating.
  - Else baseline 75 + 2 per additional WC appearance (caps at 86).
  - A small hand-curated 'legends' map overrides anything for iconic names
    where neither FIFA cache nor multi-WC heuristic does them justice.

Position mapping (jfjelstul → unschlagbar 10-position):
  GK → GK
  DF → CB (default; LB/RB inference would need shirt-number heuristics)
  MF → CM
  FW → ST

Run from repo root:    python3 tools/build_wc_squads.py
Use --dry-run to preview without writing.
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
WC_CLUBS = REPO / "src" / "data" / "worldcup" / "clubs.json"
WC_PLAYERS = REPO / "src" / "data" / "worldcup" / "players.json"
SQUAD_CSV = REPO / "tools" / ".wc_cache" / "squads.csv"
FIFA_CACHE = REPO / "tools" / ".fifa_cache"

# Position mapping
POS_MAP = {"GK": "GK", "DF": "CB", "MF": "CM", "FW": "ST"}

# Rating constants
BASELINE_RATING = 75
PER_APPEARANCE_BONUS = 2
MAX_HEURISTIC_RATING = 86

# Hand-curated legend ratings (override FIFA + heuristic).
# Only the unambiguous "everyone agrees this is a 92+" tier.
LEGEND_RATINGS = {
    "pele": 96,
    "diego maradona": 96,
    "johan cruyff": 95,
    "franz beckenbauer": 95,
    "alfredo di stefano": 94,  # never played in a WC actually — skip if not in dataset
    "ferenc puskas": 94,
    "garrincha": 93,
    "michel platini": 93,
    "lothar matthaus": 93,
    "zinedine zidane": 95,
    "ronaldo de assis moreira": 92,  # Ronaldinho — depends on how he's named
    "ronaldinho": 92,
    "ronaldo": 95,                    # R9 — same name issue
    "ronaldo nazario": 95,
    "lionel messi": 95,
    "cristiano ronaldo": 94,
    "kylian mbappe": 93,
    "andres iniesta": 92,
    "xavi hernandez": 92,
    "andrea pirlo": 92,
    "paolo maldini": 93,
    "franco baresi": 93,
    "fabio cannavaro": 92,
    "iker casillas": 92,
    "gianluigi buffon": 93,
    "oliver kahn": 93,
    "peter schmeichel": 92,
    "bobby moore": 93,
    "bobby charlton": 94,
    "gordon banks": 93,
    "eusebio": 93,
    "george best": 92,  # never played in a WC actually
    "gerd muller": 95,
    "jurgen klinsmann": 91,
    "rivaldo": 91,
    "romario": 92,
    "kaka": 90,
    "neymar": 92,
    "luka modric": 91,
    "manuel neuer": 92,
    "thomas muller": 89,
    "harry kane": 89,
    "robert lewandowski": 91,
    "luis suarez": 90,
    "edinson cavani": 88,
    "didier drogba": 89,
    "samuel etoo": 90,
    "george weah": 92,  # never in a WC
    "carlos valderrama": 89,
    "rene higuita": 86,
    "hugo sanchez": 89,
    "rafael marquez": 87,
    "rashidi yekini": 86,
    "jay jay okocha": 89,
    "nwankwo kanu": 87,
    "roger milla": 88,
    "abedi pele": 89,
    "michael essien": 88,
    "stephen appiah": 86,
    "alexis sanchez": 87,
    "arturo vidal": 88,
    "javier mascherano": 88,
    "carlos tevez": 88,
    "gabriel batistuta": 92,
    "ariel ortega": 88,
    "juan roman riquelme": 90,
    "diego forlan": 89,
    "luis figo": 92,
    "deco": 89,
    "ruud van nistelrooy": 90,
    "robin van persie": 89,
    "dennis bergkamp": 91,
    "marc overmars": 87,
    "edgar davids": 88,
    "clarence seedorf": 89,
    "patrick kluivert": 88,
    "frank rijkaard": 90,
    "marco van basten": 94,
    "ruud gullit": 92,
    "edwin van der sar": 89,
    "wesley sneijder": 89,
    "arjen robben": 90,
    "robin gosens": 84,
    "thierry henry": 93,
    "zinedine zidane": 95,
    "fabien barthez": 89,
    "lilian thuram": 90,
    "patrick vieira": 91,
    "marcel desailly": 90,
    "claude makelele": 89,
    "didier deschamps": 88,
    "antoine griezmann": 89,
    "n'golo kante": 89,
    "paul pogba": 89,
    "olivier giroud": 86,
    "raphael varane": 89,
    "hugo lloris": 88,
    "karim benzema": 91,
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]+", "", s).strip()


def to_int(s, default=50) -> int:
    try:
        return int(float(s))
    except (TypeError, ValueError):
        return default


def load_fifa_rating_index() -> dict[str, int]:
    """Build a FIFA name → max_overall index with multiple lookup keys per player.

    Each player gets indexed by:
      1. Full normalized name as appears in FIFA
      2. Surname only (last token)
      3. First-initial + surname (e.g. 'l messi')
      4. Surname + first-letter-of-given (alt form)
    """
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
                normalized = norm(name)
                tokens = normalized.split()
                if not tokens:
                    continue
                # 1. Full name
                idx[normalized] = max(idx.get(normalized, 0), ovr)
                # 2. Surname only (last token)
                surname = tokens[-1]
                if len(surname) >= 4:  # avoid matching "de" / "da" / "van"
                    idx[surname] = max(idx.get(surname, 0), ovr)
                # 3. First-initial + surname
                if len(tokens) >= 2:
                    initialed = tokens[0][0] + " " + surname
                    idx[initialed] = max(idx.get(initialed, 0), ovr)
    return idx


def lookup_fifa_rating(name: str, fifa_idx: dict[str, int]) -> int | None:
    """Try multiple shapes against the FIFA index."""
    n = norm(name)
    if n in fifa_idx:
        return fifa_idx[n]
    tokens = n.split()
    if not tokens:
        return None
    # Try first-initial + surname
    if len(tokens) >= 2:
        initialed = tokens[0][0] + " " + tokens[-1]
        if initialed in fifa_idx:
            return fifa_idx[initialed]
    # Try surname only (last token) — risky but useful for iconic mononyms
    surname = tokens[-1]
    if len(surname) >= 5 and surname in fifa_idx:
        return fifa_idx[surname]
    return None


# Manual mapping for non-trivial team-name → unschlagbar-club-id matches.
# (Empty by design — the norm-based match handles all current cases. Add
# entries here if/when a team-name mismatch appears in the dry-run.)
TEAM_NAME_OVERRIDES: dict[str, str] = {}

# Defaults for new nations added to clubs.json.
DEFAULT_FLAG_COLOR = "#666666"
NEW_NATION_DEFAULTS = {
    "Bulgaria":             {"city": "Sofia",      "color": "#009b75", "founded": 1923, "strength": 70},
    "Czechoslovakia":       {"city": "Prague",     "color": "#11457e", "founded": 1922, "strength": 72},
    "Czech Republic":       {"city": "Prague",     "color": "#11457e", "founded": 1993, "strength": 70},
    "Slovakia":             {"city": "Bratislava", "color": "#0b4ea2", "founded": 1993, "strength": 70},
    "Romania":              {"city": "Bucharest",  "color": "#fcd116", "founded": 1909, "strength": 70},
    "Greece":               {"city": "Athens",     "color": "#0d5eaf", "founded": 1926, "strength": 72},
    "Norway":               {"city": "Oslo",       "color": "#ba0c2f", "founded": 1902, "strength": 72},
    "Northern Ireland":     {"city": "Belfast",    "color": "#009a44", "founded": 1880, "strength": 70},
    "Republic of Ireland":  {"city": "Dublin",     "color": "#169b62", "founded": 1921, "strength": 72},
    "Russia":               {"city": "Moscow",     "color": "#d52b1e", "founded": 1912, "strength": 74},
    "Soviet Union":         {"city": "Moscow",     "color": "#cc0000", "founded": 1912, "strength": 78},
    "Yugoslavia":           {"city": "Belgrade",   "color": "#0e3692", "founded": 1919, "strength": 76},
    "Bosnia and Herzegovina": {"city": "Sarajevo", "color": "#002395", "founded": 1992, "strength": 70},
    "China":                {"city": "Beijing",    "color": "#de2910", "founded": 1924, "strength": 67},
    "Cuba":                 {"city": "Havana",     "color": "#002a8f", "founded": 1924, "strength": 65},
    "El Salvador":          {"city": "San Salvador","color": "#0f47af","founded": 1935, "strength": 65},
    "Honduras":             {"city": "Tegucigalpa","color": "#0073cf", "founded": 1951, "strength": 68},
    "Panama":               {"city": "Panama City","color": "#005293", "founded": 1937, "strength": 67},
    "Jamaica":              {"city": "Kingston",   "color": "#fed100", "founded": 1910, "strength": 68},
    "Haiti":                {"city": "Port-au-Prince","color":"#00209f","founded":1904, "strength": 65},
    "Trinidad and Tobago":  {"city": "Port of Spain","color":"#ce1126","founded":1908, "strength": 65},
    "Israel":               {"city": "Tel Aviv",   "color": "#0038b8", "founded": 1928, "strength": 68},
    "Iraq":                 {"city": "Baghdad",    "color": "#ce1126", "founded": 1948, "strength": 67},
    "Kuwait":               {"city": "Kuwait City","color": "#007a3d", "founded": 1952, "strength": 65},
    "Qatar":                {"city": "Doha",       "color": "#8a1538", "founded": 1960, "strength": 70},
    "Angola":               {"city": "Luanda",     "color": "#cc092f", "founded": 1979, "strength": 67},
    "Togo":                 {"city": "Lomé",       "color": "#006a4e", "founded": 1960, "strength": 65},
    "Turkey":               {"city": "Ankara",     "color": "#e30a17", "founded": 1923, "strength": 74},
    "Ukraine":              {"city": "Kyiv",       "color": "#005bbb", "founded": 1991, "strength": 73},
    "Bolivia":              {"city": "La Paz",     "color": "#007934", "founded": 1925, "strength": 65},
    "Indonesia":            {"city": "Jakarta",    "color": "#ce1126", "founded": 1930, "strength": 64},
    "Dutch East Indies":    {"city": "Batavia",    "color": "#ce1126", "founded": 1929, "strength": 64},
    "East Germany":         {"city": "Berlin",     "color": "#ffce00", "founded": 1949, "strength": 74},
    "Yugoslavia FR":        {"city": "Belgrade",   "color": "#0e3692", "founded": 1992, "strength": 73},
    "Serbia and Montenegro":{"city": "Belgrade",   "color": "#0e3692", "founded": 2003, "strength": 73},
    "North Korea":          {"city": "Pyongyang",  "color": "#ed1c27", "founded": 1945, "strength": 65},
    "Wales":                {"city": "Cardiff",    "color": "#d30731", "founded": 1876, "strength": 72},
    "Zaire":                {"city": "Kinshasa",   "color": "#007fff", "founded": 1919, "strength": 65},
    "United Arab Emirates": {"city": "Abu Dhabi",  "color": "#00732f", "founded": 1971, "strength": 65},
}


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def ensure_nations(existing_clubs: list[dict], required_team_names: set[str]) -> list[dict]:
    """Add missing nations to the clubs list."""
    existing_norm = {norm(c["name"]): c["id"] for c in existing_clubs}
    added = []
    for name in required_team_names:
        if norm(name) in existing_norm:
            continue
        if name in TEAM_NAME_OVERRIDES:
            continue  # mapped to an existing club
        defaults = NEW_NATION_DEFAULTS.get(name, {
            "city": "—", "color": DEFAULT_FLAG_COLOR, "founded": 1900, "strength": 65
        })
        new_club = {
            "id": slugify(name),
            "name": name,
            "short": name[:3].upper(),
            "city": defaults["city"],
            "color": defaults["color"],
            "founded": defaults["founded"],
            "strength": defaults["strength"],
            "era": "current",
            "era_tier": "current",
        }
        # Match the existing schema shape (era_tiers exists in some entries)
        if existing_clubs and "era_tiers" in existing_clubs[0]:
            new_club["era_tiers"] = ["current", "00s", "90s", "70s-80s"]
        existing_clubs.append(new_club)
        added.append(name)
    return added


def build_team_id_map(clubs: list[dict]) -> dict[str, str]:
    """team_name → unschlagbar club id."""
    out = {norm(c["name"]): c["id"] for c in clubs}
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    # 1. Load squads
    with open(SQUAD_CSV) as f:
        all_squads = [s for s in csv.DictReader(f) if "Men's" in s["tournament_name"]]
    print(f"Source squads (men's only): {len(all_squads):,} entries")

    # 2. Load clubs + ensure all nations exist
    clubs = json.loads(WC_CLUBS.read_text())
    team_names = sorted({s["team_name"] for s in all_squads})
    added = ensure_nations(clubs, set(team_names))
    print(f"Added {len(added)} new nations: {', '.join(added[:10])}{'...' if len(added) > 10 else ''}")

    # 3. Build team_name → club_id map (incl. overrides)
    name_to_id = build_team_id_map(clubs)
    def team_id_for(team_name: str) -> str | None:
        if team_name in TEAM_NAME_OVERRIDES:
            return TEAM_NAME_OVERRIDES[team_name]
        return name_to_id.get(norm(team_name))

    # 4. Load FIFA rating index (cross-reference for player ratings)
    print("Loading FIFA17-23 rating index...")
    fifa_idx = load_fifa_rating_index()
    print(f"  → {len(fifa_idx):,} player names in FIFA cache")

    # 5. Aggregate squads per (player_id, team_id)
    agg: dict[tuple[str, str], dict] = {}
    for s in all_squads:
        team_id = team_id_for(s["team_name"])
        if team_id is None:
            continue
        key = (s["player_id"], team_id)
        # jfjelstul uses literal 'not applicable' as given_name for mononyms
        # (Pelé, Cafu, Ronaldo, etc.). Strip that so the name reads cleanly.
        given = s["given_name"]
        if given.strip().lower() in ("not applicable", "n/a", ""):
            given = ""
        full_name = (given + " " + s["family_name"]).strip()
        year = int(s["tournament_id"].split("-")[1])
        bucket = POS_MAP.get(s["position_code"], "CM")
        if key not in agg:
            agg[key] = {
                "name": full_name,
                "position_bucket": bucket,
                "club": team_id,
                "nationality": s["team_name"],
                "years": [year],
                "shirt_numbers": [s["shirt_number"]],
            }
        else:
            agg[key]["years"].append(year)
            agg[key]["shirt_numbers"].append(s["shirt_number"])

    # 6. Compute ratings + finalize records
    fifa_hits = 0
    legend_hits = 0
    players_out = []
    for (_pid, _tid), p in agg.items():
        n = norm(p["name"])
        if n in LEGEND_RATINGS:
            rating = LEGEND_RATINGS[n]
            legend_hits += 1
        else:
            fifa_rating = lookup_fifa_rating(p["name"], fifa_idx)
            if fifa_rating is not None:
                rating = fifa_rating
                fifa_hits += 1
            else:
                # Heuristic baseline: 75 + 2 per extra WC appearance, capped
                appearances = len(set(p["years"]))
                rating = min(BASELINE_RATING + (appearances - 1) * PER_APPEARANCE_BONUS, MAX_HEURISTIC_RATING)
        years = sorted(set(p["years"]))
        career_years = f"{years[0]}-{years[-1]}" if len(years) > 1 else str(years[0])
        players_out.append({
            "name": p["name"],
            "position": p["position_bucket"],
            "prime_rating": int(rating),
            "career_years": career_years,
            "nationality": p["nationality"],
            "club": p["club"],
        })

    # Sort within nation by rating desc, then by name for stability
    players_out.sort(key=lambda x: (x["club"], -x["prime_rating"], x["name"]))

    # 7. Stats
    print()
    print(f"Built {len(players_out):,} unique WC player entries")
    print(f"  FIFA rating matches:    {fifa_hits:,}")
    print(f"  Legend overrides:       {legend_hits}")
    print(f"  Heuristic baseline:     {len(players_out) - fifa_hits - legend_hits:,}")
    print()
    rating_dist = defaultdict(int)
    for p in players_out:
        rating_dist[p["prime_rating"]] += 1
    print("Rating distribution:")
    for r in sorted(rating_dist.keys(), reverse=True):
        if r >= 80 or r == BASELINE_RATING:
            bar = "█" * min(50, rating_dist[r] // 30)
            print(f"  OVR {r}: {rating_dist[r]:5d}  {bar}")

    # 8. Per-nation summary
    print()
    print("Top 15 nations by player count:")
    from collections import Counter
    by_nation = Counter(p["club"] for p in players_out)
    for cid, n in by_nation.most_common(15):
        club_name = next((c["name"] for c in clubs if c["id"] == cid), cid)
        print(f"  {club_name:25} {n} players")

    if args.dry_run:
        print("\n--dry-run, not writing.")
        return 0

    WC_PLAYERS.write_text(json.dumps(players_out, indent=2, ensure_ascii=False) + "\n")
    WC_CLUBS.write_text(json.dumps(clubs, indent=2, ensure_ascii=False) + "\n")
    print(f"\nWrote {len(players_out)} players to {WC_PLAYERS.relative_to(REPO)}")
    print(f"Wrote {len(clubs)} clubs to {WC_CLUBS.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
