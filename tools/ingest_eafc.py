#!/usr/bin/env python3
"""
Ingest the EA FC 26 (25/26 season) player database into GOLAZO "Real mode"
data: real club + player JSON the game draws from when a career is started
in Real mode.

Source: data-src/eafc.csv (sofifa-schema dump, gitignored — see README).
Output: src/data/real/clubs.json, src/data/real/players.json

Why this fixes the position problem for free: the source carries
`player_positions` (e.g. "LW, ST, CAM"), so each player arrives with a
primary + real alt positions — no heuristic broadening needed in Real mode.

Leagues are selected by league_id (NOT name — "Bundesliga" collides between
Germany and Austria, "Super League" between Switzerland/Greece/China/India).
"""
import csv
import json
import os
import re
import unicodedata
from collections import defaultdict

SRC = os.path.join(os.path.dirname(__file__), "..", "data-src", "eafc.csv")
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "real")

# league_id -> (slug, display, country). Top flights + the big 2nd divisions.
LEAGUES = {
    "53.0": ("es1", "La Liga", "Spain"),
    "54.0": ("es2", "La Liga 2", "Spain"),
    "19.0": ("de1", "Bundesliga", "Germany"),
    "20.0": ("de2", "2. Bundesliga", "Germany"),
    "31.0": ("it1", "Serie A", "Italy"),
    "32.0": ("it2", "Serie B", "Italy"),
    "13.0": ("en1", "Premier League", "England"),
    "16.0": ("fr1", "Ligue 1", "France"),
    "10.0": ("nl1", "Eredivisie", "Netherlands"),
    "308.0": ("pt1", "Primeira Liga", "Portugal"),
    "189.0": ("ch1", "Super League", "Switzerland"),
}

# sofifa positions -> our 10-position set.
POS_MAP = {
    "GK": "GK", "CB": "CB", "LB": "LB", "LWB": "LB", "RB": "RB", "RWB": "RB",
    "CDM": "CDM", "CM": "CM", "CAM": "CAM", "LM": "LW", "RM": "RW",
    "LW": "LW", "RW": "RW", "CF": "ST", "ST": "ST",
}

PREFIX_TOKENS = {"fc", "sc", "sv", "vfl", "vfb", "ssc", "as", "ac", "us", "cd",
                 "rc", "ud", "sd", "cf", "afc", "bsc", "tsg", "rb", "fsv", "sk",
                 "fk", "ssd", "calcio", "1", "1899", "1846", "1902", "04", "05"}


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()


def short_code(name):
    toks = [t for t in re.sub(r"[^A-Za-z ]", "", name).split() if t.lower() not in PREFIX_TOKENS]
    base = "".join(toks) if toks else re.sub(r"[^A-Za-z]", "", name)
    return (base[:3] or "CLB").upper()


def hsl_hex(name):
    h = 0
    for ch in name:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    hue = h % 360
    # HSL(hue, 62%, 48%) -> hex
    import colorsys
    r, g, b = colorsys.hls_to_rgb(hue / 360, 0.48, 0.62)
    return "#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255))


def map_positions(raw):
    out = []
    for p in (raw or "").split(","):
        p = p.strip().upper()
        m = POS_MAP.get(p)
        if m and m not in out:
            out.append(m)
    return out or ["CM"]  # fallback for the rare blank


def main():
    by_club = defaultdict(list)   # club_name -> list of player rows
    club_league = {}              # club_name -> league_id
    with open(SRC, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            lid = row.get("league_id")
            if lid not in LEAGUES:
                continue
            by_club[row["club_name"]].append(row)
            club_league[row["club_name"]] = lid

    clubs = []
    players = []
    seen_ids = set()
    for club_name, rows in sorted(by_club.items()):
        cid = slug(club_name)
        if cid in seen_ids:
            cid = f"{cid}-{slug(club_league[club_name])}"
        seen_ids.add(cid)
        lid = club_league[club_name]
        league_slug, league_name, country = LEAGUES[lid]

        overalls = sorted((int(r["overall"]) for r in rows), reverse=True)
        top = overalls[:18] if len(overalls) >= 18 else overalls
        strength = round(sum(top) / len(top))

        clubs.append({
            "id": cid,
            "name": club_name,
            "short": short_code(club_name),
            "city": "",
            "color": hsl_hex(club_name),
            "founded": 1900,
            "strength": strength,
            "era": "current",
            "era_tier": "current",
            "league": league_slug,
            "leagueName": league_name,
            "country": country,
        })

        for r in rows:
            positions = map_positions(r.get("player_positions"))
            # short_name is FIFA's concise display form ("K. Mbappé",
            # "Vini Jr.") — matches the game's existing naming style.
            name = (r.get("short_name") or r.get("long_name") or "").strip()
            if not name:
                continue
            p = {
                "name": name,
                "position": positions[0],
                "prime_rating": int(r["overall"]),
                "career_years": "2025-2026",
                "nationality": r.get("nationality_name") or "",
                "club": cid,
                "verified": True,
            }
            if r.get("age"):
                p["age"] = int(r["age"])
            if len(positions) > 1:
                p["altPositions"] = positions[1:]
            pot = r.get("potential")
            if pot and int(pot) > int(r["overall"]):
                p["potential"] = int(pot)
            players.append(p)

    os.makedirs(OUT, exist_ok=True)
    json.dump(clubs, open(os.path.join(OUT, "clubs.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    json.dump(players, open(os.path.join(OUT, "players.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)

    print(f"clubs: {len(clubs)}  players: {len(players)}")
    per = defaultdict(int)
    for c in clubs:
        per[c["league"]] += 1
    for lg in sorted(per):
        print(f"  {lg}: {per[lg]} clubs")


if __name__ == "__main__":
    main()
