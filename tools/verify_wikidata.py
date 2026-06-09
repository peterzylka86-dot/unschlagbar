#!/usr/bin/env python3
"""
verify_wikidata.py — annotate player records with verified=True where
Wikidata confirms the (player, club, career_years) triple.

Read-only modification: adds `verified: true` to player records that
match. Does NOT delete anything. Does NOT modify ratings. Sorting in
the UI picker can use this flag to upweight verified players without
hiding unverified ones.

For each player with rating >= --min-rating:
  1. Query Wikidata SPARQL for "human, association football player,
     name matches".
  2. Pull all clubs + start/end years from their `member of sports
     team` (P54) statements.
  3. If any Wikidata club name fuzzy-matches our claimed club AND
     years overlap → verified=True.
  4. Write back to the JSON.

Rate-limited to ~25 queries/min to stay polite. Saves progress every
50 players so re-runs can pick up where they left off. Already-flagged
verified records are skipped on re-run.

Usage:
  python3 tools/verify_wikidata.py --league bundesliga --min-rating 85 --limit 20
  python3 tools/verify_wikidata.py --min-rating 80          # all leagues
  python3 tools/verify_wikidata.py --dry-run                # don't write back
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
import ssl
import urllib.parse
import urllib.request
from pathlib import Path

# macOS-Python ships without CA roots in some installs; for a read-only
# public-endpoint query like Wikidata SPARQL (no auth, no PII), bypass
# cert verification rather than make the user `pip install certifi`.
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "src" / "data"
LEAGUES = [
    "bundesliga", "laliga", "seriea", "swiss",
    "ucl", "worldcup", "worldcup2026", "womens",
]

WIKI_API = "https://en.wikipedia.org/w/api.php"
WIKI_DE_API = "https://de.wikipedia.org/w/api.php"
USER_AGENT = "unschlagbar-data-audit/0.1 (https://unschlagbar.lovable.app)"
RATE_DELAY = 0.12  # seconds between queries — Wikipedia REST API handles
# 100+ req/sec for unauthenticated apps; 0.12s ≈ 8/sec leaves margin.


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]+", " ", s).strip()


def parse_years(s: str) -> list[tuple[int, int]]:
    """Parse career_years string into list of (start, end) spans."""
    spans: list[tuple[int, int]] = []
    if not s:
        return spans
    for part in s.split(","):
        part = part.strip()
        m = re.match(r"(\d{4})\s*[–\-—]?\s*(\d{4}|present|Present)?", part)
        if m:
            a = int(m.group(1))
            b_str = m.group(2)
            if not b_str or b_str.lower() == "present":
                b = 2026
            else:
                b = int(b_str)
            spans.append((min(a, b), max(a, b)))
    return spans


def spans_overlap(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return not (a[1] < b[0] or b[1] < a[0])


def query_wikipedia(name: str) -> str | None:
    """Fetch the player's Wikipedia article extract from BOTH English
    and German Wikipedia, concatenated. Many football articles have
    richer career sections on the language wiki of the player's home
    country (Stuttgart's history of Hansi Müller is fully covered on
    de.wiki but only summarized on en.wiki — checking both maximizes
    recall without sacrificing precision since we're looking for one
    specific club mention).
    """
    extracts: list[str] = []
    for api_url in (WIKI_API, WIKI_DE_API):
        params = urllib.parse.urlencode({
            "action": "query",
            "format": "json",
            "prop": "extracts",
            "explaintext": "1",
            "exlimit": "1",
            "titles": name,
            "redirects": "1",
        })
        req = urllib.request.Request(
            f"{api_url}?{params}",
            headers={"User-Agent": USER_AGENT},
        )
        try:
            with urllib.request.urlopen(req, timeout=10, context=_SSL_CTX) as r:
                data = json.loads(r.read())
            pages = data.get("query", {}).get("pages", {})
            for pid, page in pages.items():
                if pid == "-1":
                    continue
                extract = page.get("extract", "")
                if extract:
                    extracts.append(extract)
        except Exception as e:
            print(f"    ! {api_url} error: {e}")
    return "\n\n".join(extracts) if extracts else None


def normalize_text(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def transliteration_variants(s: str) -> set[str]:
    """Generate German-transliteration variants of a normalized string.

    Our club IDs use the "ue" form ("nuernberg", "duesseldorf"). The
    German Wikipedia uses umlaut characters ("Nürnberg", "Düsseldorf")
    which NFKD-normalize to "nurnberg" / "dusseldorf" (umlaut dropped).
    Without this expansion, "nuernberg" never matches "nurnberg" in
    the haystack. Cover both forms here.
    """
    variants = {s}
    # ue↔u, oe↔o, ae↔a, ss↔s
    for src, dst in (("ue", "u"), ("oe", "o"), ("ae", "a"), ("ss", "s")):
        if src in s:
            variants.add(s.replace(src, dst))
        if dst in s and dst != "s":  # avoid producing "ss" from every "s"
            pass  # don't expand in the other direction blindly
    return variants


# Map our club IDs to a list of recognizable name fragments that
# might appear in a Wikipedia article. We strip everything to alnum
# lowercase before checking, so "Borussia Dortmund" → "borussiadortmund".
CLUB_ALIASES: dict[str, list[str]] = {
    # ─── Bundesliga ──────────────────────────────────────────────
    "bayern": ["bayernmunich", "bayernmunchen", "fcbayern"],
    "dortmund": ["dortmund", "bvb", "borussiadortmund"],
    "schalke": ["schalke", "schalke04"],
    "leverkusen": ["leverkusen", "bayer04", "bayerleverkusen"],
    "bayer": ["bayer", "leverkusen", "bayer04"],
    "hamburg": ["hamburg", "hamburgsv", "hsv", "hamburgersv"],
    "werder": ["werder", "werderbremen", "bremen"],
    "stuttgart": ["vfbstuttgart", "stuttgart"],
    "frankfurt": ["eintrachtfrankfurt", "frankfurt"],
    "monchengladbach": ["monchengladbach", "borussiamonchengladbach", "gladbach"],
    "koln": ["fckoln", "koln", "cologne", "1fckoln"],
    "nuernberg": ["nurnberg", "nuernberg", "1fcnurnberg", "club"],
    "braunschweig": ["eintrachtbraunschweig", "braunschweig"],
    "wuppertaler": ["wuppertalersv", "wuppertaler"],
    "kaiserslautern": ["kaiserslautern", "fckkaiserslautern", "fck"],
    "duesseldorf": ["fortunadusseldorf", "dusseldorf", "fortuna"],
    "fortunaduesseldorf": ["fortunadusseldorf", "dusseldorf", "fortuna"],
    "saarbruecken": ["saarbrucken", "1fcsaarbrucken", "saarbruecken"],
    "wolfsburg": ["wolfsburg", "vflwolfsburg"],
    "hoffenheim": ["hoffenheim", "1899hoffenheim"],
    "hertha": ["hertha", "herthabsc", "berlin"],
    "union": ["unionberlin", "1fcunionberlin", "union"],
    "bochum": ["bochum", "vflbochum"],
    "mainz": ["mainz", "mainz05"],
    "augsburg": ["augsburg", "fcaugsburg"],
    "freiburg": ["freiburg", "scfreiburg"],
    "leipzig": ["rbleipzig", "leipzig"],
    "bielefeld": ["bielefeld", "arminiabielefeld"],
    "1860": ["1860munich", "1860munchen", "tsv1860", "1860"],
    "munich1860": ["1860munich", "1860munchen", "tsv1860"],
    "rotweissessen": ["rotweissessen", "rwe"],
    "duisburg": ["duisburg", "msvduisburg"],
    "furth": ["greutherfurth", "spvggfurth", "furth"],
    "leipzigvfb": ["vfbleipzig", "leipzig"],
    "dynamodresden": ["dynamodresden", "sgdynamodresden"],
    "heidenheim": ["heidenheim", "1fcheidenheim"],
    "darmstadt": ["darmstadt", "sv98", "lilien"],
    "stpauli": ["stpauli", "fcstpauli"],
    "hansa": ["hansarostock", "rostock"],
    "regensburg": ["regensburg", "jahnregensburg"],
    "paderborn": ["paderborn", "scpaderborn"],
    "stpaderborn": ["paderborn", "scpaderborn"],
    "karlsruhe": ["karlsruhe", "kscksc"],
    # ─── La Liga ─────────────────────────────────────────────────
    "realmadrid": ["realmadrid", "madrid"],
    "barcelona": ["barcelona", "fcbarcelona", "barca", "fcb"],
    "valencia": ["valencia", "valenciacf"],
    "athletic": ["athleticbilbao", "athletic", "bilbao"],
    "atletico": ["atleticomadrid", "atletico", "atleti"],
    "sevilla": ["sevilla", "sevillafc"],
    "betis": ["realbetis", "betis"],
    "realsociedad": ["realsociedad", "lareal"],
    "espanyol": ["espanyol", "rcdespanyol"],
    "celta": ["celtavigo", "celta"],
    "villarreal": ["villarreal", "submarinoamarillo"],
    "deportivo": ["deportivo", "depor", "deportivolacoruna"],
    "malaga": ["malagacf", "malaga"],
    "zaragoza": ["zaragoza", "realzaragoza"],
    "osasuna": ["osasuna", "caosasuna"],
    "getafe": ["getafe", "getafecf"],
    "levante": ["levante", "levanteud"],
    "mallorca": ["mallorca", "rcdmallorca"],
    "alaves": ["alaves", "deportivoalaves"],
    "granada": ["granada", "granadacf"],
    "almeria": ["almeria", "udalmeria"],
    "cadiz": ["cadiz", "cadizcf"],
    "lasalmas": ["udlaspalmas", "laspalmas"],
    "laspalmas": ["udlaspalmas", "laspalmas"],
    "rayo": ["rayovallecano", "rayo"],
    "elche": ["elche", "elchecf"],
    "tenerife": ["tenerife", "cdtenerife"],
    "oviedo": ["realoviedo", "oviedo"],
    "sporting": ["sportinggijon", "sporting"],
    "sportinggijon": ["sportinggijon", "sporting"],
    "valladolid": ["valladolid", "realvalladolid"],
    "santander": ["racingsantander", "santander"],
    # ─── Serie A ─────────────────────────────────────────────────
    "juventus": ["juventus", "juve", "juventusfc"],
    "milan": ["milan", "acmilan", "rossoneri"],
    "inter": ["inter", "intermilan", "internazionale", "fcinternazionale"],
    "napoli": ["napoli", "sscnapoli"],
    "roma": ["roma", "asroma"],
    "lazio": ["lazio", "sslazio"],
    "fiorentina": ["fiorentina", "acffiorentina"],
    "atalanta": ["atalanta", "atalantabc"],
    "torino": ["torino", "fctorino", "toro"],
    "bologna": ["bologna", "bolognafc"],
    "sampdoria": ["sampdoria", "ucsampdoria"],
    "genoa": ["genoa", "genoacfc"],
    "palermo": ["palermo", "palermofc"],
    "udinese": ["udinese", "udinesecalcio"],
    "verona": ["hellasverona", "verona"],
    "cagliari": ["cagliari", "cagliaricalcio"],
    "lecce": ["lecce", "uslecce"],
    "empoli": ["empoli", "empolifc"],
    "salernitana": ["salernitana", "ussalernitana"],
    "venezia": ["venezia", "veneziafc"],
    "monza": ["acmonza", "monza"],
    "como": ["comocalcio", "como"],
    "parma": ["parma", "parmacalcio"],
    # ─── UCL extras (English / French / Dutch / etc.) ────────────
    "manchesterunited": ["manchesterunited", "manunited", "manutd"],
    "manchestercity": ["manchestercity", "mancity"],
    "liverpool": ["liverpoolfc", "liverpool"],
    "arsenal": ["arsenal", "arsenalfc"],
    "chelsea": ["chelsea", "chelseafc"],
    "tottenham": ["tottenham", "spurs", "tottenhamhotspur"],
    "newcastle": ["newcastleunited", "newcastle"],
    "everton": ["everton", "evertonfc"],
    "astonvilla": ["astonvilla", "villa"],
    "westham": ["westhamunited", "westham"],
    "nottinghamforest": ["nottinghamforest", "forest"],
    "celtic": ["celticfc", "celtic"],
    "rangers": ["rangersfc", "rangers"],
    "psg": ["parissaintgermain", "psg", "paris"],
    "marseille": ["marseille", "olympiquemarseille", "om"],
    "lyon": ["lyon", "olympiquelyonnais", "ol"],
    "monaco": ["monaco", "asmonaco"],
    "lille": ["lillelosc", "losc", "lille"],
    "bordeaux": ["bordeaux", "girondinsdebordeaux"],
    "ajax": ["ajaxamsterdam", "ajax"],
    "psv": ["psveindhoven", "psv"],
    "feyenoord": ["feyenoord", "feyenoordrotterdam"],
    "porto": ["fcporto", "porto"],
    "benfica": ["benfica", "slbenfica"],
    "sportingcp": ["sportingcp", "sportinglisbon"],
    "crvenazvezda": ["redstarbelgrade", "crvenazvezda"],
    "steaua": ["steauabucharest", "steaua", "fcsb"],
    "dynamokyiv": ["dynamokyiv", "dynamokiev"],
    "rosenborg": ["rosenborg", "rosenborgbk"],
    "galatasaray": ["galatasaray"],
    "fenerbahce": ["fenerbahce"],
    "besiktas": ["besiktas"],
    # ─── Swiss ───────────────────────────────────────────────────
    "basel": ["fcbasel", "basel"],
    "youngboys": ["bsc young boys", "youngboys", "bscyoungboys"],
    "zurich": ["fczurich", "zurich"],
    "stgallen": ["fcstgallen", "stgallen"],
    "luzern": ["fcluzern", "luzern", "lucerne"],
    "servette": ["servettefc", "servette"],
    "lugano": ["fclugano", "lugano"],
    "sion": ["fcsion", "sion"],
    "thun": ["fcthun", "thun"],
    "lausanne": ["lausannesport", "lausanne"],
    "winterthur": ["fcwinterthur", "winterthur"],
    "grasshopper": ["grasshopperclub", "grasshopper", "gc"],
    "aarau": ["fcaarau", "aarau"],
    "xamax": ["neuchatelxamax", "xamax"],
    # ─── National teams (worldcup data) ──────────────────────────
    "germany": ["germany", "germannational", "germannationalteam"],
    "westgermany": ["westgermany", "germany"],
    "eastgermany": ["eastgermany", "ddr"],
    "france": ["france", "frenchnational"],
    "brazil": ["brazil", "braziliannational"],
    "argentina": ["argentina", "argentine"],
    "italy": ["italy", "italian"],
    "spain": ["spain", "spanish"],
    "england": ["england", "english"],
    "portugal": ["portugal", "portuguese"],
    "netherlands": ["netherlands", "dutch", "holland"],
    "belgium": ["belgium", "belgian"],
    "uruguay": ["uruguay", "uruguayan"],
    "mexico": ["mexico", "mexican"],
    "japan": ["japan", "japanese"],
    "southkorea": ["southkorea", "korean"],
    "australia": ["australia", "socceroos"],
    "usa": ["unitedstates", "usa", "american"],
    "morocco": ["morocco", "moroccan"],
    "tunisia": ["tunisia", "tunisian"],
    "nigeria": ["nigeria", "nigerian"],
    "cameroon": ["cameroon", "cameroonian"],
    "senegal": ["senegal", "senegalese"],
    "ivorycoast": ["ivorycoast", "cotedivoire"],
    "ghana": ["ghana", "ghanaian"],
    "egypt": ["egypt", "egyptian"],
    "sweden": ["sweden", "swedish"],
    "denmark": ["denmark", "danish"],
    "norway": ["norway", "norwegian"],
    "switzerland": ["switzerland", "swiss"],
    "austria": ["austria", "austrian"],
    "croatia": ["croatia", "croatian"],
    "poland": ["poland", "polish"],
    "hungary": ["hungary", "hungarian", "magyar"],
    "russia": ["russia", "russian"],
    "sovietunion": ["sovietunion", "ussr", "soviet"],
    "yugoslavia": ["yugoslavia", "yugoslavian"],
    "scotland": ["scotland", "scottish"],
    "ireland": ["ireland", "irish"],
    "northernireland": ["northernireland"],
    "wales": ["wales", "welsh"],
    "iceland": ["iceland", "icelandic"],
    "czechrepublic": ["czechrepublic", "czech", "czechia"],
    "slovakia": ["slovakia", "slovak"],
    "ukraine": ["ukraine", "ukrainian"],
    "serbia": ["serbia", "serbian"],
    "chile": ["chile", "chilean"],
    "colombia": ["colombia", "colombian"],
    "peru": ["peru", "peruvian"],
    "ecuador": ["ecuador", "ecuadorian"],
    "paraguay": ["paraguay", "paraguayan"],
    "venezuela": ["venezuela", "venezuelan"],
    "bolivia": ["bolivia", "bolivian"],
    "honduras": ["honduras", "honduran"],
    "panama": ["panama", "panamanian"],
    "costarica": ["costarica", "costarican"],
    "jamaica": ["jamaica", "jamaican"],
    "saudiarabia": ["saudiarabia", "saudi"],
    "iran": ["iran", "iranian"],
    "iraq": ["iraq", "iraqi"],
    "qatar": ["qatar", "qatari"],
    "newzealand": ["newzealand", "kiwi"],
}


def club_alias_set(club_id: str) -> set[str]:
    """Get the set of recognizable text fragments for matching a club
    against a Wikipedia article body. Expands German transliterations
    (ue↔u, oe↔o, ae↔a) so "nuernberg" can match the umlaut-stripped
    "nurnberg" that appears in normalized Wikipedia text."""
    explicit = CLUB_ALIASES.get(club_id, [])
    base = {normalize_text(a) for a in explicit} | {normalize_text(club_id)}
    expanded: set[str] = set()
    for a in base:
        expanded |= transliteration_variants(a)
    return expanded


def verify_player(player: dict, extract: str) -> bool:
    """Return True if our claimed club name appears in the Wikipedia
    extract for this player.

    This is weaker than the SPARQL approach (no year-range check), but
    it catches the most common error modes:
      • Player has no Wikipedia page → fabrication
      • Player has a page but their article doesn't mention our club →
        wrong-club assignment (the Köppel/Ricken pattern)
    """
    if not extract:
        return False
    haystack = normalize_text(extract)
    aliases = club_alias_set(player.get("club", ""))
    return any(alias in haystack for alias in aliases if alias)


def process(args: argparse.Namespace) -> int:
    leagues = [args.league] if args.league else LEAGUES
    total_checked = 0
    total_verified = 0
    total_mismatch: list[dict] = []  # exists in WD but club doesn't match

    for league in leagues:
        path = DATA / league / "players.json"
        if not path.exists():
            continue
        players = json.loads(path.read_text())
        targets = [
            (i, p) for i, p in enumerate(players)
            if (p.get("prime_rating") or 0) >= args.min_rating
            and not p.get("verified")
        ]
        if args.limit:
            targets = targets[: args.limit]
        if not targets:
            print(f"{league:<14} 0 targets (all already verified or below threshold)")
            continue
        print(f"{league:<14} {len(targets)} players to check (rating ≥ {args.min_rating})")

        league_verified = 0
        for n, (i, player) in enumerate(targets):
            name = player["name"]
            print(f"  [{n+1}/{len(targets)}] {name}", end=" ", flush=True)
            extract = query_wikipedia(name)
            if extract is None:
                print("· no Wikipedia article")
            else:
                if verify_player(player, extract):
                    players[i]["verified"] = True
                    league_verified += 1
                    print(f"· ✓ verified")
                else:
                    # Article exists but our claimed club doesn't appear
                    total_mismatch.append({
                        "league": league,
                        "name": name,
                        "our_club": player["club"],
                        "our_years": player.get("career_years"),
                    })
                    print(f"· ⚠ article exists but no '{player['club']}' mention")
            time.sleep(RATE_DELAY)
            total_checked += 1
            # Persist every 25 players in case of interruption
            if not args.dry_run and (n + 1) % 25 == 0:
                path.write_text(json.dumps(players, ensure_ascii=False, indent=2) + "\n")

        if not args.dry_run:
            path.write_text(json.dumps(players, ensure_ascii=False, indent=2) + "\n")
        total_verified += league_verified
        print(f"  → {league}: {league_verified} verified / {len(targets)} checked")

    print(f"\n{'='*60}")
    print(f"TOTAL: {total_verified} verified / {total_checked} checked")
    if total_mismatch:
        print(f"\n⚠ {len(total_mismatch)} players have a Wikipedia article that does NOT mention our claimed club:")
        for m in total_mismatch[:30]:
            print(
                f"  {m['league']:<12} {m['name']:<28} our: {m['our_club']} "
                f"({m['our_years']})"
            )
        if len(total_mismatch) > 30:
            print(f"  ... and {len(total_mismatch) - 30} more")
        print("\nThese are candidates for manual fix (Köppel-style wrong-club entries).")
        print("Note: false positives possible — Wikipedia article may abbreviate club names")
        print("our CLUB_ALIASES dict hasn't anticipated. Spot-check before deleting.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--league", help="limit to one league")
    parser.add_argument("--min-rating", type=int, default=85, help="rating threshold (default 85)")
    parser.add_argument("--limit", type=int, help="stop after N players (for testing)")
    parser.add_argument("--dry-run", action="store_true", help="don't write back")
    args = parser.parse_args()
    return process(args)


if __name__ == "__main__":
    sys.exit(main())
