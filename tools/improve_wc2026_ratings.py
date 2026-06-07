#!/usr/bin/env python3
"""
improve_wc2026_ratings.py — fix the 72-baseline cluster in WC 2026 data.

The original build_wc2026.py used nation-strength to set a baseline rating
for players we couldn't find in FIFA17-23 cache or existing rosters. Result:
11 nations had 100% of their squad at OVR 72, even when those players play
at top European clubs (Khusanov at Man City, Akanji at City, etc.).

Fix: each player's CURRENT CLUB is the strongest signal. Build a global
club-tier table covering the top 300 clubs worldwide; for each WC 2026
player, set rating = max(existing_rating, club_tier_baseline). Players
at Man City start at 85; at Al-Hilal start at 80; at Pakhtakor at 73.

Run from repo root:    python3 tools/improve_wc2026_ratings.py
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "src" / "data" / "worldcup2026" / "players.json"
RAW = REPO / "tools" / ".wikipedia_cache" / "wc2026_squads.json"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


# Club-tier baseline ratings. Generally: club_strength → typical player rating
# floor. Top players within the club still get FIFA-cache / curated ratings.
#
# Tier groupings (rough):
#   90+ : Real Madrid / Barça / Man City / Bayern / PSG / Liverpool tier
#   85-89 : top-flight regulars (Inter, Milan, Atlético, Arsenal, Dortmund …)
#   80-84 : solid Euro / strong Saudi / top MLS
#   76-79 : mid-Euro / mid-Saudi / mid-MLS
#   72-75 : lower-Euro / domestic Asian / African PSL
CLUB_TIER: dict[str, int] = {
    # Tier 90+ (super-elite)
    "real madrid": 89, "fc barcelona": 89, "manchester city": 89,
    "bayern munich": 88, "paris saint-germain": 87, "liverpool": 88,
    "barcelona": 89,

    # Tier 85-89 (elite Euro)
    "inter milan": 86, "ac milan": 85, "atlético madrid": 86,
    "atletico madrid": 86, "arsenal": 87, "chelsea": 85,
    "manchester united": 84, "tottenham hotspur": 84,
    "borussia dortmund": 85, "bayer leverkusen": 84,
    "juventus": 85, "napoli": 84, "as roma": 83, "lazio": 82,
    "newcastle united": 84, "aston villa": 83,
    "real betis": 80, "athletic club": 80, "athletic bilbao": 80,
    "valencia": 79, "valencia cf": 79,
    "fiorentina": 79, "atalanta": 81,
    "rb leipzig": 83, "vfb stuttgart": 80, "eintracht frankfurt": 80,
    "borussia mönchengladbach": 78, "borussia monchengladbach": 78,
    "vfl wolfsburg": 77, "werder bremen": 76,
    "real sociedad": 81, "sevilla": 80, "villarreal": 81,
    "girona": 78,
    "olympique de marseille": 82, "marseille": 82, "olympique marseille": 82,
    "olympique lyonnais": 80, "lyon": 80, "monaco": 81, "lille": 79,
    "stade brestois": 76, "nice": 78, "rennes": 78, "lens": 78,
    "stade rennais": 78, "ogc nice": 78, "rc strasbourg": 76,
    "benfica": 84, "sporting cp": 83, "porto": 83, "sporting": 83,
    "celtic": 79, "rangers": 79, "rangers fc": 79,
    "ajax": 81, "psv eindhoven": 80, "feyenoord": 80, "az alkmaar": 76,

    # Tier 80-84 (Saudi top + others)
    "al-nassr": 81, "al nassr": 81, "al-hilal": 82, "al hilal": 82,
    "al-ittihad": 80, "al ittihad": 80, "al-ahli": 79, "al ahli": 79,
    "al-shabab": 76, "al-qadsiah": 77,
    "fenerbahçe": 79, "fenerbahce": 79, "galatasaray": 80, "beşiktaş": 78, "besiktas": 78,

    # MLS (76-82 range, Messi/etc. handled separately)
    "inter miami cf": 78, "inter miami": 78, "los angeles fc": 78, "lafc": 78,
    "fc cincinnati": 77, "new york city fc": 76, "atlanta united fc": 76,
    "philadelphia union": 76, "seattle sounders fc": 76, "lafc": 78,
    "vancouver whitecaps fc": 75, "toronto fc": 75, "cf montréal": 74,
    "houston dynamo fc": 75, "houston dynamo": 75,
    "minnesota united fc": 74, "portland timbers": 75, "real salt lake": 74,
    "new york red bulls": 75, "columbus crew": 76, "orlando city sc": 75,
    "chicago fire fc": 75,

    # Bundesliga lower / Premier League mid-low / Serie A mid-low
    "burnley": 76, "norwich city": 73, "middlesbrough": 73, "leicester city": 77,
    "leeds united": 76, "southampton": 76, "fulham": 78, "brighton": 80,
    "brentford": 78, "crystal palace": 78, "west ham": 80, "everton": 76,
    "wolverhampton wanderers": 77, "nottingham forest": 78,
    "bournemouth": 77, "afc bournemouth": 77,
    "hannover 96": 72, "schalke": 73, "schalke 04": 73, "hertha bsc": 73,
    "fc augsburg": 75, "tsg hoffenheim": 76, "1. fc heidenheim": 73,
    "1. fc union berlin": 76, "vfl bochum": 73, "1. fc köln": 74,
    "1. fc koln": 74, "sc freiburg": 78, "fsv mainz 05": 75,
    "udinese": 75, "torino": 75, "bologna": 79, "empoli": 73,
    "verona": 73, "hellas verona": 73, "genoa": 74, "cagliari": 73,
    "como": 74, "spezia": 72, "monza": 74, "salernitana": 73,
    "lecce": 73, "frosinone": 73, "sassuolo": 75,
    "real valladolid": 73, "celta vigo": 76, "rc celta": 76, "rcd mallorca": 75,
    "ca osasuna": 75, "deportivo alavés": 73, "deportivo alaves": 73,
    "getafe": 75, "rayo vallecano": 76, "ud las palmas": 73,
    "leganés": 73, "espanyol": 75,

    # Belgium / Eredivisie second tier
    "anderlecht": 76, "club brugge": 78, "kaa gent": 75, "royal antwerp": 75,
    "union saint-gilloise": 76,
    "twente": 75, "fc twente": 75, "vitesse": 73, "utrecht": 73, "fc utrecht": 73,

    # Top Asian / Australian
    "yokohama f. marinos": 73, "kashima antlers": 73, "urawa red diamonds": 73,
    "kawasaki frontale": 74, "gamba osaka": 73, "vissel kobe": 74,
    "sanfrecce hiroshima": 73, "fc tokyo": 73, "shanghai port": 73,
    "ulsan hyundai": 73, "jeonbuk hyundai motors": 73,
    "guangzhou": 72, "shanghai shenhua": 73,
    "melbourne city": 73, "western sydney wanderers": 72, "sydney fc": 73,
    "wellington phoenix": 72, "auckland fc": 72,

    # African PSL / Asian domestic
    "mamelodi sundowns": 74, "orlando pirates": 73, "kaizer chiefs": 73,
    "supersport united": 71, "stellenbosch fc": 71,

    # Saudi/Qatar mid-tier
    "al-duhail": 73, "al duhail": 73, "al-rayyan": 72, "al rayyan": 72,
    "al-sadd": 74, "al sadd": 74, "al-wakrah": 72, "al-gharafa": 72,
    "al-arabi": 72, "qatar sc": 71, "al-shamal": 70,

    # Iraqi top flight
    "al-shorta": 70, "al-talaba": 69, "al-zawraa": 69, "al-karma": 69,
    "al-quwa al-jawiya": 71,

    # Uzbek top flight
    "pakhtakor": 72, "nasaf": 71, "neftchi fergana": 71, "agmk": 70,
    "bunyodkor": 70, "navbahor": 70, "andijan": 69, "lokomotiv tashkent": 71,

    # Iranian top flight
    "persepolis": 74, "esteghlal": 74, "sepahan": 73, "tractor": 72,
    "foolad": 72,

    # Mexican / South American top
    "monterrey": 78, "cf monterrey": 78, "club américa": 78, "club america": 78,
    "guadalajara": 75, "chivas guadalajara": 75, "tigres uanl": 78,
    "club león": 75, "club leon": 75, "puebla": 73, "necaxa": 73,
    "boca juniors": 79, "river plate": 80, "racing club": 76, "independiente": 75,
    "san lorenzo": 74, "vélez sarsfield": 75, "estudiantes": 75,
    "flamengo": 81, "palmeiras": 81, "são paulo": 78, "sao paulo": 78,
    "corinthians": 78, "fluminense": 77, "santos": 77, "internacional": 78,
    "grêmio": 78, "gremio": 78, "atlético mineiro": 79, "atletico mineiro": 79,
    "vasco da gama": 75, "botafogo": 78, "cruzeiro": 76,
    "lanús": 73, "lanus": 73, "talleres": 73, "argentinos juniors": 73,

    # Various others
    "shakhtar donetsk": 78, "dynamo kyiv": 75,
    "olympiacos": 76, "paok": 75, "panathinaikos": 75, "aek athens": 73,
    "salzburg": 76, "rb salzburg": 76, "rapid wien": 73, "sturm graz": 75,
    "young boys": 76, "bsc young boys": 76, "fc basel": 75, "fc basel 1893": 75,
    "fc lugano": 73, "lugano": 73,
    "estoril": 73, "vitória sc": 73, "vitoria sc": 73, "famalicão": 73,
    "braga": 76, "sc braga": 76,
}


def lookup_club_tier(club_name: str) -> int | None:
    if not club_name:
        return None
    key = norm(club_name)
    # exact match first
    for canon, rating in CLUB_TIER.items():
        if norm(canon) == key:
            return rating
    # substring match (handles "Vancouver Whitecaps FC" vs "Vancouver Whitecaps")
    for canon, rating in CLUB_TIER.items():
        ck = norm(canon)
        if ck in key or key in ck:
            if abs(len(ck) - len(key)) <= 6:
                return rating
    return None


# Specific player overrides — known international stars whose ratings the
# heuristic underestimates. Calibrated against my training-data knowledge
# of 2025-26 form.
PLAYER_OVERRIDES = {
    # Uzbekistan — strong recent risers
    "abdukodir khusanov":     85,  # Man City CB, transferred 2025
    "eldor shomurodov":       80,  # Roma ST
    "abbosbek fayzullaev":    78,  # CSKA Moscow CM
    "jasurbek yakhshiboev":   76,
    "khojimat erkinov":       76,
    # Panama
    "josé luis rodríguez":    87,  # Sporting CP, already had this
    "adalberto carrasquilla": 78,  # Houston Dynamo
    "michael amir murillo":   80,  # Marseille RB
    "anibal godoy":           77,  # San Diego FC
    "césar blackman":         76,
    "iván anderson":          75,
    # Curaçao
    "leandro bacuna":         76,
    "tahith chong":           77,
    "juninho bacuna":         76,
    "kenji gorré":            74,
    "cuco martina":           74,
    # Haiti — most play in MLS / Belgian / French lower
    "duckens nazon":          74,
    "frantzdy pierrot":       76,
    "danley jean jacques":    74,
    # Iraq — mostly domestic
    "ali al-hamadi":          76,  # Ipswich, played PL
    "zidane iqbal":           76,  # Utrecht, ex-Man Utd
    # New Zealand
    "chris wood":             82,  # Nott'm Forest ST
    "marko stamenić":         76,  # Olympiakos
    "matthew garbett":        76,
    "ben waine":              76,
    # Cape Verde
    "ryan mendes":             77,
    "stopira":                 75,
    "logan costa":             80,  # Toulouse CB
    "kenny rocha santos":      76,
    "héldon ramos":            76,
    # South Africa - top players at top SA clubs
    "lyle foster":            77,  # Burnley
    "percy tau":               76,
    "themba zwane":            75,
    "ronwen williams":         77,  # GK at Mamelodi
    "khuliso mudau":           74,
    # Saudi Arabia
    "salem al-dawsari":        82,
    "yasser al-shahrani":      78,
    "feras al-brikan":         76,
    "saud abdulhamid":         78,  # Roma
    "abdulelah al-amri":       76,
    # Qatar
    "akram afif":              79,  # 2023 AFC POTY
    "almoez ali":              77,
    "boualem khoukhi":         75,
    "abdulkarim hassan":       74,
    # Jordan
    "musa al-tamari":          78,  # Montpellier
    "yazan al-arab":           74,
    # Australia
    "harry souttar":           79,
    "mitchell duke":           75,
    "jackson irvine":          77,
    "riley mcgree":            76,
    # Canada
    "jonathan david":          84,  # Lille
    "alphonso davies":         86,  # Bayern
    "stephen eustáquio":       80,  # Porto
    "tajon buchanan":          80,  # Inter Milan
    "ismaël koné":             77,  # Marseille
    "richie laryea":           75,
    # USA
    "christian pulisic":       86,
    "weston mckennie":         82,
    "tyler adams":              80,
    "tim weah":                79,
    "yunus musah":              79,
    "gio reyna":               79,
    "antonee robinson":         81,
    "matt turner":              80,
    "balogun":                 80,  # "Folarin Balogun"
    "folarin balogun":         80,
    # South Korea
    "kim min-jae":             86,  # Bayern CB
    "lee kang-in":              82,  # PSG
    "hwang hee-chan":          81,  # Wolves
    "hwang in-beom":            78,
    "cho gue-sung":             78,
    "kim seung-gyu":            78,
    "kim ji-soo":               76,
    "yang hyun-jun":            76,
    # Japan
    "kaoru mitoma":            83,  # Brighton
    "takefusa kubo":           83,  # Real Sociedad
    "wataru endo":              81,  # Liverpool
    "ko itakura":               79,
    "ritsu doan":               81,
    "ayase ueda":               78,
    "daichi kamada":            80,
    "hidemasa morita":          77,
    "junya ito":                80,
    "kaoru mitoma":             83,
    "takehiro tomiyasu":        81,
    "zion suzuki":              78,
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    players = json.loads(OUT.read_text())
    raw = json.loads(RAW.read_text())

    # Build name → current_club map from raw Wikipedia data
    name_to_club: dict[tuple[str, str], str] = {}
    for cid, squad in raw.items():
        if cid.startswith("_"): continue
        for p in squad:
            name_to_club[(norm(p["name"]), cid)] = p.get("club", "")

    bumped_club_tier = 0
    bumped_override = 0
    unchanged = 0
    for p in players:
        key = (norm(p["name"]), p["club"])
        original = p["prime_rating"]
        new_rating = original

        # Step 1: club-tier baseline
        club = name_to_club.get(key, "")
        tier_rating = lookup_club_tier(club)
        if tier_rating and tier_rating > new_rating:
            new_rating = tier_rating
            bumped_club_tier += 1 if original != new_rating else 0

        # Step 2: explicit player override
        override = PLAYER_OVERRIDES.get(norm(p["name"]))
        if override and override > new_rating:
            if new_rating == p["prime_rating"]:
                bumped_override += 1
            else:
                bumped_override += 1
                bumped_club_tier -= 1  # don't double-count
            new_rating = override

        if new_rating != original:
            p["prime_rating"] = new_rating
        else:
            unchanged += 1

    print(f"Updated {len(players)} WC 2026 players")
    print(f"  Bumped via club tier: {bumped_club_tier}")
    print(f"  Bumped via player override: {bumped_override}")
    print(f"  Unchanged: {unchanged}")
    print()

    # Show new distribution per nation
    clubs = {c["id"]: c["name"] for c in json.load(open(REPO / "src" / "data" / "worldcup2026" / "clubs.json"))}
    from collections import defaultdict
    per_nation_72 = defaultdict(int)
    per_nation_total = defaultdict(int)
    for p in players:
        per_nation_total[p["club"]] += 1
        if p["prime_rating"] == 72:
            per_nation_72[p["club"]] += 1
    print("Nations still 50%+ at OVR 72:")
    for cid, n72 in sorted(per_nation_72.items(), key=lambda kv: -kv[1]):
        tot = per_nation_total[cid]
        if n72 * 2 >= tot:
            print(f"  {clubs.get(cid, cid):25} {n72}/{tot}")

    # Show Uzbekistan + Panama specifically
    print()
    for which in ("uzbekistan", "panama"):
        print(f"=== {clubs.get(which, which)} (after fix) ===")
        squad = [p for p in players if p["club"] == which]
        squad.sort(key=lambda x: -x["prime_rating"])
        for p in squad[:8]:
            print(f"  {p['name']:30} {p['position']:4} OVR={p['prime_rating']}")
        print()

    if args.dry_run:
        print("--dry-run, not writing.")
        return 0

    # Re-sort for stable output
    players.sort(key=lambda x: (x["club"], -x["prime_rating"], x["name"]))
    OUT.write_text(json.dumps(players, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {OUT.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
