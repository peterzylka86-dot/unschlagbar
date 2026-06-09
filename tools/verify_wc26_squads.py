#!/usr/bin/env python3
"""
verify_wc26_squads.py — diff our worldcup2026 dataset against the
official Wikipedia "2026 FIFA World Cup squads" page.

Wikipedia publishes the canonical squads in a single article using
templates of the form:

  {{nat fs g player|no=N|pos=POS|name=[[Player Name]]|...|club=[[Club]]|clubnat=NAT}}

Each nation has a `=== Nation ===` section preceding its players.
Position codes (Wikipedia uses 4-bucket GK/DF/MF/FW) get mapped to
our finer-grained scheme for comparison.

Output: one markdown report per nation in tools/reports/wc26/,
documenting:
  • players in real squad but missing from our roster (ADD candidates)
  • players in our roster but not in real squad (REMOVE candidates)
  • position bucket mismatches (FIX candidates)

Does NOT auto-apply any changes — output is for human review.

Usage:
  python3 tools/verify_wc26_squads.py                # all 48 nations
  python3 tools/verify_wc26_squads.py --nation algeria
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
DATA = REPO / "src" / "data" / "worldcup2026" / "players.json"
REPORT_DIR = REPO / "tools" / "reports" / "wc26"

WIKI_API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = "unschlagbar-data-audit/0.1 (https://unschlagbar.lovable.app)"

_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


# Map Wikipedia's GK/DF/MF/FW into our scheme. Compare at BUCKET level
# so a Wikipedia "DF" matches any of {CB, LB, RB} in ours.
WIKI_POS_BUCKET = {"GK": "G", "DF": "D", "MF": "M", "FW": "F"}
OUR_POS_BUCKET = {
    "GK": "G",
    "CB": "D", "LB": "D", "RB": "D",
    "CDM": "M", "CM": "M", "CAM": "M",
    "LW": "F", "RW": "F", "ST": "F",
}

# Map nation names from Wikipedia (English) to our IDs.
# Most are direct: "Algeria" → "algeria". Exceptions below.
NATION_NAME_MAP = {
    "United States": "unitedstates",
    "Saudi Arabia": "saudiarabia",
    "South Korea": "southkorea",
    "Republic of Korea": "southkorea",
    "South Africa": "southafrica",
    "Ivory Coast": "ivorycoast",
    "Côte d'Ivoire": "ivorycoast",
    "Cape Verde": "capeverde",
    "Costa Rica": "costarica",
    "Czech Republic": "czechrepublic",
    "Czechia": "czechrepublic",
    "New Zealand": "newzealand",
    "Bosnia and Herzegovina": "bosniaandherzegovina",
}


def fetch_article() -> str:
    params = urllib.parse.urlencode({
        "action": "query",
        "format": "json",
        "prop": "revisions",
        "rvprop": "content",
        "rvslots": "main",
        "titles": "2026_FIFA_World_Cup_squads",
    })
    req = urllib.request.Request(
        f"{WIKI_API}?{params}",
        headers={"User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(req, timeout=30, context=_SSL_CTX) as r:
        data = json.loads(r.read())
    pages = data["query"]["pages"]
    return list(pages.values())[0]["revisions"][0]["slots"]["main"]["*"]


def parse_template_field(s: str, key: str) -> str | None:
    """Pull `|key=value` from a wikitext template body. Properly handles
    `[[Article|Display]]` and `{{nested|template|args}}` whose `|`
    separators are NOT field delimiters.

    Algorithm: find the `key=` start, then scan forward emitting chars
    into the result while tracking bracket depth. Stop on a `|` only
    when depth == 0 (i.e., outside any link or nested template)."""
    pattern = rf"\|\s*{key}\s*=\s*"
    m = re.search(pattern, s)
    if not m:
        return None
    j = m.end()
    out: list[str] = []
    depth_link = 0  # [[ ... ]]
    depth_tmpl = 0  # {{ ... }}
    while j < len(s):
        if s[j : j + 2] == "[[":
            depth_link += 1
            out.append(s[j : j + 2])
            j += 2
            continue
        if s[j : j + 2] == "]]":
            depth_link = max(0, depth_link - 1)
            out.append(s[j : j + 2])
            j += 2
            continue
        if s[j : j + 2] == "{{":
            depth_tmpl += 1
            out.append(s[j : j + 2])
            j += 2
            continue
        if s[j : j + 2] == "}}":
            depth_tmpl = max(0, depth_tmpl - 1)
            out.append(s[j : j + 2])
            j += 2
            continue
        if s[j] == "|" and depth_link == 0 and depth_tmpl == 0:
            break
        out.append(s[j])
        j += 1
    return "".join(out).strip() or None


def strip_wiki_link(s: str) -> str:
    """[[Article|Display]] → Display, [[Article]] → Article."""
    s = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", s)
    s = re.sub(r"\[\[([^\]]+)\]\]", r"\1", s)
    return s.strip()


def extract_balanced_template(text: str, start_token: str) -> list[str]:
    """Find each `{{start_token...}}` template in `text`, properly handling
    nested `{{...}}` so the outer template body is captured even when
    inner templates like `{{birth date and age2|...}}` appear inside.

    Returns a list of template BODIES (text after the start_token up to
    but not including the closing `}}`).
    """
    bodies: list[str] = []
    pos = 0
    needle = "{{" + start_token
    while True:
        i = text.find(needle, pos)
        if i == -1:
            break
        # Cursor sits right after `{{start_token`
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


def parse_squads(wikitext: str) -> dict[str, list[dict]]:
    """Return {nation_name: [{name, pos, club}, ...]}."""
    squads: dict[str, list[dict]] = {}

    # Find all section headers + their byte ranges
    headers = list(re.finditer(r"^={2,4}\s*(.+?)\s*={2,4}\s*$", wikitext, re.MULTILINE))

    for i, h in enumerate(headers):
        # Block of text this header introduces
        start = h.end()
        end = headers[i + 1].start() if i + 1 < len(headers) else len(wikitext)
        title = h.group(1)
        block = wikitext[start:end]

        # Skip non-nation headers (group stages, source notes)
        if "Group" in title or "Squad" in title or "Source" in title or title in ("Notes",):
            continue

        players: list[dict] = []
        # Brace-balanced template extraction handles the nested
        # `{{birth date and age2|...}}` inside each player row.
        for body in extract_balanced_template(block, "nat fs g player"):
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
    """Map 'Algeria' → 'algeria', 'United States' → 'usa', etc."""
    if wikipedia_name in NATION_NAME_MAP:
        return NATION_NAME_MAP[wikipedia_name]
    return norm(wikipedia_name)


def diff_nation(
    nation_name: str,
    wiki_squad: list[dict],
    our_roster: list[dict],
) -> dict:
    """Compare one nation's Wikipedia squad against our dataset roster."""
    our_by_name = {norm(p["name"]): p for p in our_roster}
    wiki_by_name = {norm(p["name"]): p for p in wiki_squad}

    missing_in_ours: list[dict] = []
    extra_in_ours: list[dict] = []
    pos_mismatch: list[tuple[dict, dict]] = []

    for wn, wp in wiki_by_name.items():
        op = our_by_name.get(wn)
        if op is None:
            missing_in_ours.append(wp)
        else:
            wiki_bucket = WIKI_POS_BUCKET.get(wp["pos"])
            our_pos = op.get("position", "")
            alt_positions = op.get("altPositions", []) or []
            our_buckets = {OUR_POS_BUCKET.get(p) for p in [our_pos, *alt_positions]}
            if wiki_bucket and wiki_bucket not in our_buckets:
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


def write_report(diff: dict, out_path: Path) -> None:
    n = diff["nation"]
    lines = [f"# WC26 squad diff — {n}", ""]
    lines.append(f"Wikipedia squad: **{diff['wiki_size']} players** · "
                 f"Our roster: **{diff['our_size']} players**")
    lines.append("")

    if diff["missing_in_ours"]:
        lines.append(f"## Missing from our dataset — {len(diff['missing_in_ours'])} players (ADD candidates)")
        lines.append("")
        lines.append("| Name | Pos | Club |")
        lines.append("|---|---|---|")
        for p in diff["missing_in_ours"]:
            lines.append(f"| {p['name']} | {p['pos']} | {p['club']} |")
        lines.append("")

    if diff["extra_in_ours"]:
        lines.append(f"## In our roster but NOT in real squad — {len(diff['extra_in_ours'])} players")
        lines.append("")
        lines.append("(May be older squad members, fabrications, or transfers since.)")
        lines.append("")
        lines.append("| Name | Pos | Rating | Club |")
        lines.append("|---|---|---|---|")
        for p in diff["extra_in_ours"]:
            lines.append(f"| {p['name']} | {p['position']} | {p.get('prime_rating','?')} | {p.get('club','?')} |")
        lines.append("")

    if diff["pos_mismatch"]:
        lines.append(f"## Position-bucket mismatches — {len(diff['pos_mismatch'])} players")
        lines.append("")
        lines.append("Wikipedia bucket (GK/DF/MF/FW) vs our position. Real position likely differs.")
        lines.append("")
        lines.append("| Name | Our pos | Wikipedia pos | Wikipedia club |")
        lines.append("|---|---|---|---|")
        for wp, op in diff["pos_mismatch"]:
            lines.append(f"| {op['name']} | {op['position']} | {wp['pos']} | {wp['club']} |")
        lines.append("")

    if not (diff["missing_in_ours"] or diff["extra_in_ours"] or diff["pos_mismatch"]):
        lines.append("## ✓ Clean — no discrepancies")
        lines.append("")
        lines.append("Our roster matches the Wikipedia squad.")

    out_path.write_text("\n".join(lines))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--nation", help="limit to one nation (Wikipedia name, e.g. 'Algeria')")
    args = parser.parse_args()

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    print("Fetching 2026 FIFA World Cup squads article…")
    wikitext = fetch_article()
    print(f"Article: {len(wikitext)} chars")
    squads = parse_squads(wikitext)
    print(f"Parsed {len(squads)} nation squads from Wikipedia")
    print()

    our_players = json.loads(DATA.read_text())
    by_club: dict[str, list[dict]] = {}
    for p in our_players:
        by_club.setdefault(p["club"], []).append(p)

    summary_rows: list[tuple[str, int, int, int, int, int]] = []
    matched = 0
    skipped = 0
    nations = [args.nation] if args.nation else list(squads.keys())
    for nation in nations:
        wiki_squad = squads.get(nation)
        if not wiki_squad:
            print(f"  ? {nation}: not found in Wikipedia article")
            skipped += 1
            continue
        our_id = our_nation_id(nation)
        our_roster = by_club.get(our_id)
        if not our_roster:
            print(f"  ⚠ {nation} (our id: {our_id}): no matching roster in dataset")
            skipped += 1
            continue
        diff = diff_nation(nation, wiki_squad, our_roster)
        report_path = REPORT_DIR / f"{our_id}.md"
        write_report(diff, report_path)
        matched += 1
        summary_rows.append((
            nation, diff["wiki_size"], diff["our_size"],
            len(diff["missing_in_ours"]), len(diff["extra_in_ours"]),
            len(diff["pos_mismatch"]),
        ))
        bullet = (
            f"  ✓ {nation}: wiki={diff['wiki_size']} ours={diff['our_size']} "
            f"missing={len(diff['missing_in_ours'])} extra={len(diff['extra_in_ours'])} "
            f"pos-mismatch={len(diff['pos_mismatch'])}"
        )
        print(bullet)

    # Aggregate summary
    summary_path = REPORT_DIR / "SUMMARY.md"
    lines = [
        f"# WC26 Squad Reconciliation — Summary",
        "",
        f"Compared {matched} nations; {skipped} skipped (article missing or no matching dataset roster).",
        "",
        "| Nation | Wiki size | Our size | Missing | Extra | Pos-mismatch |",
        "|---|---|---|---|---|---|",
    ]
    for nation, ws, os_, mi, ex, pm in sorted(summary_rows):
        lines.append(f"| {nation} | {ws} | {os_} | {mi} | {ex} | {pm} |")
    summary_path.write_text("\n".join(lines))
    print(f"\nReports written to {REPORT_DIR}")
    print(f"Summary: {summary_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
