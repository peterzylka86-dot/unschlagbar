#!/usr/bin/env python3
"""
parse_wc2026_wikitext.py — extract all 48 WC 2026 squads from Wikipedia
raw wikitext.

We bypass WebFetch's summarizer (which truncates large pages and risks
hallucinating data when content is missing) and pull the wikitext directly
from Wikipedia's parse API. Each nation's squad is rendered via the
{{nat fs g start}} / {{nat fs g player}} template pair, so parsing is
deterministic — no LLM in the loop.

Run from repo root:    python3 tools/parse_wc2026_wikitext.py
Outputs: tools/.wikipedia_cache/wc2026_squads.json
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "tools" / ".wikipedia_cache" / "wc2026_squads.json"
WIKITEXT_CACHE = REPO / "tools" / ".wikipedia_cache" / "wc2026_raw_wikitext.json"
API_URL = "https://en.wikipedia.org/w/api.php?action=parse&page=2026_FIFA_World_Cup_squads&format=json&prop=wikitext&formatversion=2"

# Position codes Wikipedia uses (numeric)
POS_NUM_TO_CODE = {
    "1": "GK",
    "2": "DF",
    "3": "MF",
    "4": "FW",
}


def fetch_wikitext() -> str:
    """Fetch via curl (system OpenSSL has the right cert chain — Python on
    macOS often doesn't). Cache the JSON response for re-runs."""
    if WIKITEXT_CACHE.exists() and WIKITEXT_CACHE.stat().st_size > 50_000:
        print(f"Using cached wikitext at {WIKITEXT_CACHE.relative_to(REPO)}")
    else:
        print(f"Fetching {API_URL}")
        WIKITEXT_CACHE.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["curl", "-sSL", "-A", "unschlagbar-data-build/1.0", API_URL, "-o", str(WIKITEXT_CACHE)],
            check=True,
        )
    body = json.loads(WIKITEXT_CACHE.read_text())
    if "error" in body:
        raise RuntimeError(f"API error: {body['error']}")
    wt = body["parse"]["wikitext"]
    print(f"  {len(wt):,} chars wikitext loaded")
    return wt


def split_sections_by_heading(wt: str) -> dict[str, str]:
    """The page is organized with == Group A == / === Country === headings.
    Each section between === === belongs to one nation. Return mapping of
    nation name → its section wikitext."""
    sections: dict[str, str] = {}
    # Match level-3 headings: === Nation Name ===
    # Then capture everything until the next == or === heading
    pattern = re.compile(r"^===\s*([^=]+?)\s*===\s*\n", re.MULTILINE)
    matches = list(pattern.finditer(wt))
    for i, m in enumerate(matches):
        name = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(wt)
        sections[name] = wt[start:end]
    return sections


def parse_squad_section(section: str, nationality: str) -> list[dict]:
    """Extract all {{nat fs g player ...}} entries from a section."""
    players = []
    # The template: {{nat fs g player|no=1|pos=GK|name=...|age=...|caps=...|goals=...|club=...|clubnat=...}}
    # Also old form: {{nat fs g player|no=1|pos=1|...}} where pos is numeric
    # Players are wrapped in player entries. Use balanced-brace finding.
    i = 0
    while True:
        idx = section.find("{{nat fs g player", i)
        if idx == -1:
            break
        # Find the matching closing braces
        depth = 0
        j = idx
        while j < len(section):
            if section[j:j+2] == "{{":
                depth += 1
                j += 2
            elif section[j:j+2] == "}}":
                depth -= 1
                j += 2
                if depth == 0:
                    break
            else:
                j += 1
        tpl = section[idx:j]
        i = j

        # Parse template params
        params = parse_template_params(tpl)
        no = params.get("no", "").strip()
        try:
            shirt = int(no) if no else None
        except ValueError:
            shirt = None
        pos = params.get("pos", "").strip().upper()
        pos = POS_NUM_TO_CODE.get(pos, pos)
        if pos not in ("GK", "DF", "MF", "FW"):
            continue
        name = strip_wiki_markup(params.get("name", "").strip())
        club = strip_wiki_markup(params.get("club", "").strip())
        if not name:
            continue
        players.append({
            "shirt": shirt,
            "position": pos,
            "name": name,
            "club": club,
            "nationality": nationality,
        })
    return players


def parse_template_params(tpl: str) -> dict[str, str]:
    """Crude template-arg splitter. Handles | inside [[ links ]] by tracking
    depth of [[ ]] braces. Does NOT handle nested templates inside params."""
    # Strip outer {{ }} and template name
    inner = tpl.strip()
    if inner.startswith("{{"):
        inner = inner[2:]
    if inner.endswith("}}"):
        inner = inner[:-2]
    # First |-separated chunk is the template name
    # Split on | but not inside [[ ]] or {{ }}
    parts = []
    buf = []
    depth_bracket = 0
    depth_brace = 0
    for ch in inner:
        if ch == "[" and buf and buf[-1] == "[":
            depth_bracket += 1
        elif ch == "]" and buf and buf[-1] == "]":
            depth_bracket -= 1
        elif ch == "{" and buf and buf[-1] == "{":
            depth_brace += 1
        elif ch == "}" and buf and buf[-1] == "}":
            depth_brace -= 1
        if ch == "|" and depth_bracket == 0 and depth_brace == 0:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append("".join(buf))
    # First part is template name, rest are key=value
    out: dict[str, str] = {}
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            out[k.strip()] = v
    return out


def strip_wiki_markup(s: str) -> str:
    """Remove [[ ]] links and {{ }} templates, keeping display text."""
    s = s.strip()
    # [[Link|Display]] → Display, [[Link]] → Link
    s = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", s)
    s = re.sub(r"\[\[([^\]]+)\]\]", r"\1", s)
    # {{flagicon|...}} or {{flag|...}} → empty
    s = re.sub(r"\{\{flagicon\|[^}]*\}\}", "", s)
    s = re.sub(r"\{\{flag\|([^}|]*)[^}]*\}\}", r"\1", s)
    s = re.sub(r"\{\{(?:fb|country)\|([^}|]*)[^}]*\}\}", r"\1", s)
    # Generic template → empty (last resort)
    s = re.sub(r"\{\{[^}]*\}\}", "", s)
    # HTML entities and refs
    s = re.sub(r"<ref[^/]*/>", "", s)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.DOTALL)
    s = re.sub(r"<!--.*?-->", "", s, flags=re.DOTALL)
    s = re.sub(r"\s+", " ", s).strip()
    return s


# Country name slugifier — must match other tools/ scripts
def slugify(name: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", name).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    wt = fetch_wikitext()
    sections = split_sections_by_heading(wt)
    print(f"Found {len(sections)} === sections in wikitext")
    print()

    squads: dict[str, list[dict]] = {}
    nation_count = 0
    total_players = 0
    skipped = []

    for raw_name, section in sections.items():
        # Skip non-nation sections (e.g. Notes, References)
        if raw_name.lower() in ("notes", "references", "external links"):
            continue
        # Skip section headings that aren't a country (often will have no
        # {{nat fs g player template})
        players = parse_squad_section(section, raw_name)
        if not players:
            skipped.append(raw_name)
            continue
        cid = slugify(raw_name)
        squads[cid] = players
        nation_count += 1
        total_players += len(players)

    # Sort per-nation by shirt number
    for cid, players in squads.items():
        players.sort(key=lambda p: (p["shirt"] is None, p["shirt"] or 99))

    meta = {
        "source": "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_squads",
        "fetched_via": "Wikipedia parse API (action=parse&prop=wikitext)",
        "tournament_start": "2026-06-11",
        "total_nations": nation_count,
        "total_players": total_players,
    }
    out = {"_meta": meta, **squads}

    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {OUT.relative_to(REPO)}")
    print(f"  Nations: {nation_count}")
    print(f"  Total players: {total_players}")
    print()
    print("Per-nation counts (sorted by size):")
    for cid, players in sorted(squads.items(), key=lambda kv: -len(kv[1])):
        # Find original name from sections
        orig = next((k for k in sections if slugify(k) == cid), cid)
        print(f"  {orig:30}  {len(players):2d}")
    if skipped:
        print()
        print(f"Skipped {len(skipped)} sections without player templates (probably notes/headers):")
        for s in skipped[:10]:
            print(f"  {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
