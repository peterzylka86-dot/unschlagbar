#!/usr/bin/env python3
"""
verify_wc_year.py — diff a specific FIFA World Cup year's squads
against the historical `worldcup` dataset.

Adapts verify_wc26_squads.py to handle ANY year. Key difference: the
`worldcup` league dataset spans 1954-present, so for any given year
we filter our roster to players whose career_years includes that year
before diffing.

Usage:
    python3 tools/verify_wc_year.py --year 2022
    python3 tools/verify_wc_year.py --year 2018 --nation Brazil
"""
from __future__ import annotations

import argparse
import json
import re
import ssl
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "src" / "data" / "worldcup" / "players.json"

WIKI_API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = "unschlagbar-data-audit/0.1 (https://unschlagbar.lovable.app)"

_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


WIKI_POS_BUCKET = {"GK": "G", "DF": "D", "MF": "M", "FW": "F"}
OUR_POS_BUCKET = {
    "GK": "G",
    "CB": "D", "LB": "D", "RB": "D",
    "CDM": "M", "CM": "M", "CAM": "M",
    "LW": "F", "RW": "F", "ST": "F",
}

# Wikipedia English nation name → our club ID
NATION_NAME_MAP = {
    "United States": "usa",
    "Saudi Arabia": "saudiarabia",
    "South Korea": "southkorea",
    "Republic of Korea": "southkorea",
    "Costa Rica": "costarica",
    "Ivory Coast": "ivorycoast",
    "Côte d'Ivoire": "ivorycoast",
    "Czech Republic": "czechrepublic",
    "Czechia": "czechrepublic",
    "Bosnia and Herzegovina": "bosniaandherzegovina",
    "West Germany": "westgermany",
    "East Germany": "eastgermany",
    "Soviet Union": "sovietunion",
    "Yugoslavia": "yugoslavia",
    "Serbia and Montenegro": "serbia",
    "Northern Ireland": "northernireland",
    "Trinidad and Tobago": "trinidadandtobago",
    "Cape Verde": "capeverde",
    "New Zealand": "newzealand",
    "South Africa": "southafrica",
}


def fetch_article(year: int) -> str:
    params = urllib.parse.urlencode({
        "action": "query",
        "format": "json",
        "prop": "revisions",
        "rvprop": "content",
        "rvslots": "main",
        "titles": f"{year}_FIFA_World_Cup_squads",
    })
    req = urllib.request.Request(
        f"{WIKI_API}?{params}", headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(req, timeout=30, context=_SSL_CTX) as r:
        data = json.loads(r.read())
    pages = data["query"]["pages"]
    page = list(pages.values())[0]
    if "revisions" not in page:
        raise RuntimeError(f"Article for {year} not found on Wikipedia")
    return page["revisions"][0]["slots"]["main"]["*"]


def extract_balanced_template(text: str, start_token: str) -> list[str]:
    bodies: list[str] = []
    pos = 0
    needle = "{{" + start_token
    while True:
        i = text.find(needle, pos)
        if i == -1:
            break
        j = i + len(needle)
        depth = 1
        body_start = j
        while j < len(text) and depth > 0:
            if text[j : j + 2] == "{{":
                depth += 1
                j += 2
            elif text[j : j + 2] == "}}":
                depth -= 1
                if depth == 0:
                    bodies.append(text[body_start:j])
                    j += 2
                    break
                j += 2
            else:
                j += 1
        pos = j
    return bodies


def parse_template_field(s: str, key: str) -> str | None:
    pattern = rf"\|\s*{key}\s*=\s*"
    m = re.search(pattern, s)
    if not m:
        return None
    j = m.end()
    out: list[str] = []
    dl = dt = 0
    while j < len(s):
        if s[j : j + 2] == "[[":
            dl += 1
            out.append(s[j : j + 2]); j += 2; continue
        if s[j : j + 2] == "]]":
            dl = max(0, dl - 1)
            out.append(s[j : j + 2]); j += 2; continue
        if s[j : j + 2] == "{{":
            dt += 1
            out.append(s[j : j + 2]); j += 2; continue
        if s[j : j + 2] == "}}":
            dt = max(0, dt - 1)
            out.append(s[j : j + 2]); j += 2; continue
        if s[j] == "|" and dl == 0 and dt == 0:
            break
        out.append(s[j]); j += 1
    return "".join(out).strip() or None


def strip_wiki_link(s: str) -> str:
    s = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", s)
    s = re.sub(r"\[\[([^\]]+)\]\]", r"\1", s)
    return s.strip()


def parse_squads(wikitext: str) -> dict[str, list[dict]]:
    """Same approach as wc26 — section headers + {{nat fs g player}} blocks.
    Older WC articles also use {{nat fs r player}} (without 'g' for 'group'),
    so accept both."""
    squads: dict[str, list[dict]] = {}
    headers = list(re.finditer(r"^={2,4}\s*(.+?)\s*={2,4}\s*$", wikitext, re.MULTILINE))
    for i, h in enumerate(headers):
        start = h.end()
        end = headers[i + 1].start() if i + 1 < len(headers) else len(wikitext)
        title = h.group(1)
        block = wikitext[start:end]
        if any(x in title for x in ("Group", "Squad", "Source", "References", "Note")):
            continue
        players: list[dict] = []
        for tmpl in ("nat fs g player", "nat fs r player", "nat fs player"):
            for body in extract_balanced_template(block, tmpl):
                name = parse_template_field(body, "name")
                pos = parse_template_field(body, "pos")
                club = parse_template_field(body, "club")
                if not (name and pos and club):
                    continue
                players.append({
                    "name": strip_wiki_link(name),
                    "pos": pos.strip().upper(),
                    "club": strip_wiki_link(club),
                })
        if players:
            squads[title] = players
    return squads


def our_nation_id(wikipedia_name: str) -> str:
    if wikipedia_name in NATION_NAME_MAP:
        return NATION_NAME_MAP[wikipedia_name]
    return norm(wikipedia_name)


def filter_roster_for_year(roster: list[dict], year: int) -> list[dict]:
    """Return players whose career_years string contains the given year
    (e.g. '2014-2022', '2022', '2018-2022, 2024')."""
    out = []
    year_str = str(year)
    for p in roster:
        cy = p.get("career_years", "")
        if year_str in cy:
            out.append(p)
            continue
        # Range like "2018-2022" — already matched above. But also catch
        # "2018-Present"-style if the year is in the implied range.
        m = re.match(r"(\d{4})\s*[–\-—]\s*(\d{4}|Present|present)", cy)
        if m:
            start = int(m.group(1))
            end = 2026 if m.group(2).lower() == "present" else int(m.group(2))
            if start <= year <= end:
                out.append(p)
    return out


def diff_nation(nation_name: str, wiki_squad: list[dict], our_roster: list[dict]) -> dict:
    our_by_name = {norm(p["name"]): p for p in our_roster}
    wiki_by_name = {norm(p["name"]): p for p in wiki_squad}
    missing_in_ours = []
    extra_in_ours = []
    pos_mismatch = []
    for wn, wp in wiki_by_name.items():
        op = our_by_name.get(wn)
        if op is None:
            missing_in_ours.append(wp)
        else:
            wb = WIKI_POS_BUCKET.get(wp["pos"])
            our_pos = op.get("position", "")
            alts = op.get("altPositions", []) or []
            our_bs = {OUR_POS_BUCKET.get(p) for p in [our_pos, *alts]}
            if wb and wb not in our_bs:
                pos_mismatch.append((wp, op))
    for on, op in our_by_name.items():
        if on not in wiki_by_name:
            extra_in_ours.append(op)
    return {
        "nation": nation_name,
        "wiki_size": len(wiki_squad),
        "our_size": len(our_roster),
        "missing_in_ours": missing_in_ours,
        "extra_in_ours": extra_in_ours,
        "pos_mismatch": pos_mismatch,
    }


def write_report(diff: dict, out_path: Path, year: int) -> None:
    lines = [f"# WC{year} squad diff — {diff['nation']}", ""]
    lines.append(f"Wikipedia squad: **{diff['wiki_size']}** · "
                 f"Our {year}-era roster: **{diff['our_size']}**")
    lines.append("")
    if diff["missing_in_ours"]:
        lines.append(f"## Missing — {len(diff['missing_in_ours'])} (ADD candidates)")
        lines.append("\n| Name | Pos | Club |\n|---|---|---|")
        for p in diff["missing_in_ours"]:
            lines.append(f"| {p['name']} | {p['pos']} | {p['club']} |")
        lines.append("")
    if diff["extra_in_ours"]:
        lines.append(f"## Extra — {len(diff['extra_in_ours'])} (in roster, not in real squad)")
        lines.append("\n| Name | Pos | Rating | Career |\n|---|---|---|---|")
        for p in diff["extra_in_ours"]:
            lines.append(f"| {p['name']} | {p['position']} | {p.get('prime_rating','?')} | {p.get('career_years','?')} |")
        lines.append("")
    if diff["pos_mismatch"]:
        lines.append(f"## Position-bucket mismatches — {len(diff['pos_mismatch'])}")
        lines.append("\n| Name | Our pos | Wiki pos | Wiki club |\n|---|---|---|---|")
        for wp, op in diff["pos_mismatch"]:
            lines.append(f"| {op['name']} | {op['position']} | {wp['pos']} | {wp['club']} |")
        lines.append("")
    if not (diff["missing_in_ours"] or diff["extra_in_ours"] or diff["pos_mismatch"]):
        lines.append("## ✓ Clean")
    out_path.write_text("\n".join(lines))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--nation", help="limit to one nation")
    args = parser.parse_args()

    report_dir = REPO / "tools" / "reports" / f"wc{args.year}"
    report_dir.mkdir(parents=True, exist_ok=True)
    print(f"Fetching {args.year} FIFA World Cup squads article…")
    wikitext = fetch_article(args.year)
    print(f"Article: {len(wikitext)} chars")
    squads = parse_squads(wikitext)
    print(f"Parsed {len(squads)} nation squads\n")

    our_players = json.loads(DATA.read_text())
    by_club: dict[str, list[dict]] = {}
    for p in our_players:
        by_club.setdefault(p["club"], []).append(p)

    summary_rows = []
    nations = [args.nation] if args.nation else list(squads.keys())
    for nation in nations:
        wiki_squad = squads.get(nation)
        if not wiki_squad:
            continue
        our_id = our_nation_id(nation)
        full_roster = by_club.get(our_id, [])
        era_roster = filter_roster_for_year(full_roster, args.year)
        diff = diff_nation(nation, wiki_squad, era_roster)
        write_report(diff, report_dir / f"{our_id}.md", args.year)
        summary_rows.append((
            nation, diff["wiki_size"], diff["our_size"],
            len(diff["missing_in_ours"]),
            len(diff["extra_in_ours"]),
            len(diff["pos_mismatch"]),
        ))
        flag = "" if not (diff["missing_in_ours"] or diff["extra_in_ours"] or diff["pos_mismatch"]) else " ⚠"
        print(
            f"  {nation:<26} wiki={diff['wiki_size']:<2} ours={diff['our_size']:<2} "
            f"missing={len(diff['missing_in_ours']):<2} extra={len(diff['extra_in_ours']):<2} "
            f"pos-mismatch={len(diff['pos_mismatch'])}{flag}"
        )

    lines = [f"# WC{args.year} Squad Reconciliation — Summary", ""]
    lines.append(f"Compared {len(summary_rows)} nations.\n")
    lines.append("| Nation | Wiki | Ours | Missing | Extra | Pos-mismatch |")
    lines.append("|---|---|---|---|---|---|")
    for n, ws, os_, mi, ex, pm in sorted(summary_rows):
        lines.append(f"| {n} | {ws} | {os_} | {mi} | {ex} | {pm} |")
    (report_dir / "SUMMARY.md").write_text("\n".join(lines))
    print(f"\nReports: {report_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
