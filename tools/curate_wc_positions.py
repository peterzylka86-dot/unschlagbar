#!/usr/bin/env python3
"""
Curated position corrections for famous World Cup players.

User feedback: "some players have several positions they can play...
Mbappe for example can play LW and ST. then others need fixing....
Sorloth is only ST."

After our automatic redistribution (CB→CB/LB/RB, ST→ST/LW/RW, CM→
CM/CAM/CDM), some real-world specialists ended up on the wrong primary
position (Sørloth got LW instead of ST), and versatile players have no
alt-position metadata.

This script applies hand-curated corrections for the top ~3-5 stars per
major nation in both worldcup2026 and worldcup leagues. Two effects:

  1. Fix primary position where redistribution got it wrong
     (Sørloth ST, not LW; Hakimi RB, not CB; Lukaku ST, not LW; ...).

  2. Add altPositions for genuinely versatile players
     (Mbappé LW/[ST]; Bellingham CAM/[CM]; Saka RW/[LW]; ...).

Players not in the curation map keep their existing redistribution.
Re-run safe: applies corrections idempotently.
"""
import json
from pathlib import Path

# Map: "Display Name" → (primary_pos, [alts])
# Names match the `name` field in players.json exactly.
# Only includes players I'm confident about — better to have NO alts
# than wrong ones.
CURATION = {
    # ─── France ───────────────────────────────────────────────────────
    "Kylian Mbappé": ("LW", ["ST"]),
    "N'Golo Kanté": ("CDM", ["CM"]),
    "Aurélien Tchouaméni": ("CDM", ["CM"]),
    "Antoine Griezmann": ("CAM", ["ST"]),
    "Ousmane Dembélé": ("RW", ["LW"]),
    "Eduardo Camavinga": ("CM", ["CDM"]),
    "Bradley Barcola": ("LW", ["RW"]),
    "William Saliba": ("CB", []),
    "Jules Koundé": ("RB", ["CB"]),
    "Theo Hernández": ("LB", []),
    "Dayot Upamecano": ("CB", []),
    "Mike Maignan": ("GK", []),
    "Karim Benzema": ("ST", ["CAM"]),
    "Zinedine Zidane": ("CAM", ["CM"]),
    "Thierry Henry": ("ST", ["LW"]),
    "Michel Platini": ("CAM", ["CM"]),
    "Patrick Vieira": ("CM", ["CDM"]),
    "Marcel Desailly": ("CB", ["CDM"]),
    "Lilian Thuram": ("CB", ["RB"]),

    # ─── England ──────────────────────────────────────────────────────
    "Harry Kane": ("ST", []),
    "Jude Bellingham": ("CAM", ["CM"]),
    "Bukayo Saka": ("RW", ["LW"]),
    "Phil Foden": ("CAM", ["RW", "CM"]),
    "Cole Palmer": ("CAM", ["RW"]),
    "Declan Rice": ("CDM", ["CM"]),
    "John Stones": ("CB", []),
    "Marc Guéhi": ("CB", []),
    "Reece James": ("RB", []),
    "Kyle Walker": ("RB", []),
    "Trent Alexander-Arnold": ("RB", []),
    "Jordan Pickford": ("GK", []),
    "Bobby Charlton": ("CAM", ["CM"]),
    "Bobby Moore": ("CB", []),
    "Gordon Banks": ("GK", []),
    "Steven Gerrard": ("CM", ["CAM", "CDM"]),
    "Frank Lampard": ("CM", ["CAM"]),
    "Paul Scholes": ("CM", ["CAM"]),
    "Wayne Rooney": ("ST", ["CAM"]),
    "Alan Shearer": ("ST", []),
    "Gary Lineker": ("ST", []),
    "Peter Shilton": ("GK", []),
    "Paul Gascoigne": ("CAM", ["CM"]),

    # ─── Spain ────────────────────────────────────────────────────────
    "Rodri": ("CDM", ["CM"]),
    "Pedri": ("CM", ["CAM"]),
    "Gavi": ("CM", ["CAM"]),
    "Lamine Yamal": ("RW", []),
    "Nico Williams": ("LW", []),
    "Dani Olmo": ("CAM", ["LW"]),
    "Fabián Ruiz": ("CM", ["CDM"]),
    "Marc Cucurella": ("LB", []),
    "Marc Pubill": ("RB", []),
    "Aymeric Laporte": ("CB", []),
    "Robin Le Normand": ("CB", []),
    "Unai Simón": ("GK", []),
    "Álvaro Morata": ("ST", []),
    "Ferran Torres": ("LW", ["ST"]),
    "Mikel Oyarzabal": ("LW", ["ST"]),
    # Historic Spain
    "Ferenc Puskás": ("ST", []),
    "Alfredo Di Stéfano": ("ST", ["CAM"]),
    "Andrés Iniesta": ("CM", ["CAM"]),
    "Xavi": ("CM", ["CAM"]),
    "Iker Casillas": ("GK", []),
    "Sergio Ramos": ("CB", []),
    "Carles Puyol": ("CB", []),
    "Xabi Alonso": ("CDM", ["CM"]),
    "Sergio Busquets": ("CDM", []),
    "David Villa": ("ST", ["LW"]),
    "Fernando Torres": ("ST", []),
    "Raúl": ("ST", ["LW"]),

    # ─── Argentina ────────────────────────────────────────────────────
    "Lionel Messi": ("RW", ["CAM", "ST"]),
    "Julián Álvarez": ("ST", ["CAM"]),
    "Lautaro Martínez": ("ST", []),
    "Alexis Mac Allister": ("CM", ["CAM"]),
    "Enzo Fernández": ("CM", ["CDM"]),
    "Rodrigo De Paul": ("CM", ["CDM"]),
    "Cristian Romero": ("CB", []),
    "Nicolás Otamendi": ("CB", []),
    "Nahuel Molina": ("RB", []),
    "Nicolás Tagliafico": ("LB", []),
    "Giuliano Simeone": ("RW", ["LW"]),
    "Emiliano Martínez": ("GK", []),
    # Historic
    "Diego Maradona": ("CAM", ["ST"]),
    "Gabriel Batistuta": ("ST", []),
    "Mario Kempes": ("ST", ["LW"]),
    "Juan Román Riquelme": ("CAM", []),
    "Daniel Passarella": ("CB", []),
    "Sergio Agüero": ("ST", []),
    "Javier Mascherano": ("CDM", ["CB"]),

    # ─── Brazil ───────────────────────────────────────────────────────
    "Neymar": ("LW", ["CAM"]),
    "Vinícius Júnior": ("LW", ["ST"]),
    "Rodrygo": ("RW", ["ST", "LW"]),
    "Raphinha": ("RW", ["LW"]),
    "Casemiro": ("CDM", []),
    "Bruno Guimarães": ("CDM", ["CM"]),
    "Lucas Paquetá": ("CAM", ["CM"]),
    "Alisson": ("GK", []),
    "Ederson": ("GK", []),
    "Marquinhos": ("CB", []),
    "Eder Militão": ("CB", []),
    "Danilo": ("RB", ["CB"]),
    # Historic
    "Pelé": ("ST", ["CAM"]),
    "Ronaldo": ("ST", ["LW"]),  # The Brazilian R9
    "Garrincha": ("RW", []),
    "Romário": ("ST", []),
    "Ronaldinho": ("CAM", ["LW"]),
    "Kaká": ("CAM", []),
    "Rivaldo": ("CAM", ["LW", "ST"]),
    "Roberto Carlos": ("LB", []),
    "Cafu": ("RB", []),
    "Zico": ("CAM", []),

    # ─── Portugal ─────────────────────────────────────────────────────
    "Cristiano Ronaldo": ("ST", ["LW", "RW"]),
    "Bernardo Silva": ("CAM", ["RW", "CM"]),
    "Bruno Fernandes": ("CAM", ["CM"]),
    "Rúben Dias": ("CB", []),
    "João Cancelo": ("RB", ["LB"]),
    "Nuno Mendes": ("LB", []),
    "Rafael Leão": ("LW", ["ST"]),
    "Diogo Jota": ("ST", ["LW"]),
    "Vitinha": ("CM", ["CDM"]),
    "João Neves": ("CM", ["CDM"]),
    "Diogo Costa": ("GK", []),
    # Historic
    "Eusébio": ("ST", []),
    "Luís Figo": ("RW", []),
    "Rui Costa": ("CAM", []),
    "Deco": ("CAM", ["CM"]),
    "Pepe": ("CB", []),

    # ─── Germany ──────────────────────────────────────────────────────
    "Manuel Neuer": ("GK", []),
    "Florian Wirtz": ("CAM", ["LW", "CM"]),
    "Jamal Musiala": ("CAM", ["LW", "CM"]),
    "Kai Havertz": ("ST", ["CAM"]),
    "Joshua Kimmich": ("CDM", ["CM", "RB"]),
    "Toni Kroos": ("CM", ["CDM"]),
    "Ilkay Gündoğan": ("CM", ["CAM"]),
    "Antonio Rüdiger": ("CB", []),
    "Jonathan Tah": ("CB", []),
    "Nico Schlotterbeck": ("CB", []),
    "Leroy Sané": ("RW", ["LW"]),
    "Serge Gnabry": ("RW", ["LW"]),
    # Historic
    "Franz Beckenbauer": ("CB", ["CDM"]),
    "Gerd Müller": ("ST", []),
    "Lothar Matthäus": ("CM", ["CDM"]),
    "Oliver Kahn": ("GK", []),
    "Jürgen Klinsmann": ("ST", []),
    "Philipp Lahm": ("RB", ["LB", "CDM"]),
    "Bastian Schweinsteiger": ("CDM", ["CM"]),
    "Mesut Özil": ("CAM", []),
    "Thomas Müller": ("CAM", ["RW", "ST"]),
    "Miroslav Klose": ("ST", []),

    # ─── Netherlands ──────────────────────────────────────────────────
    "Virgil van Dijk": ("CB", []),
    "Frenkie de Jong": ("CM", ["CDM"]),
    "Nathan Aké": ("CB", ["LB"]),
    "Tijjani Reijnders": ("CM", ["CAM"]),
    "Cody Gakpo": ("LW", ["ST", "CAM"]),
    "Memphis Depay": ("ST", ["CAM"]),
    "Xavi Simons": ("CAM", ["RW"]),
    "Denzel Dumfries": ("RB", []),
    "Bart Verbruggen": ("GK", []),
    # Historic
    "Johan Cruyff": ("CAM", ["ST"]),
    "Marco van Basten": ("ST", []),
    "Ruud Gullit": ("CAM", ["ST"]),
    "Dennis Bergkamp": ("CAM", ["ST"]),
    "Robin van Persie": ("ST", []),
    "Arjen Robben": ("RW", ["LW"]),
    "Wesley Sneijder": ("CAM", []),
    "Edwin van der Sar": ("GK", []),

    # ─── Norway ───────────────────────────────────────────────────────
    "Erling Haaland": ("ST", []),
    "Alexander Sørloth": ("ST", []),  # fix: redistribution wrongly put him at LW
    "Martin Ødegaard": ("CAM", ["CM"]),
    "Julian Ryerson": ("RB", []),
    "Antonio Nusa": ("LW", ["RW"]),  # versatile winger
    "Jørgen Strand Larsen": ("ST", ["LW"]),  # primary ST, has played LW

    # ─── Belgium ──────────────────────────────────────────────────────
    "Kevin De Bruyne": ("CAM", ["CM"]),
    "Thibaut Courtois": ("GK", []),
    "Romelu Lukaku": ("ST", []),  # fix: redistribution wrongly put him at LW
    "Jérémy Doku": ("LW", ["RW"]),  # fix: not ST
    "Leandro Trossard": ("LW", ["RW"]),
    "Youri Tielemans": ("CM", ["CAM"]),
    "Amadou Onana": ("CDM", []),
    "Eden Hazard": ("LW", ["CAM"]),

    # ─── Italy ────────────────────────────────────────────────────────
    "Gianluigi Donnarumma": ("GK", []),
    "Nicolò Barella": ("CM", ["CAM"]),
    "Sandro Tonali": ("CM", ["CDM"]),
    "Federico Chiesa": ("RW", ["LW"]),
    "Lorenzo Pellegrini": ("CAM", []),
    "Alessandro Bastoni": ("CB", []),
    "Giovanni Di Lorenzo": ("RB", []),
    # Historic
    "Roberto Baggio": ("CAM", ["ST"]),
    "Franco Baresi": ("CB", []),
    "Paolo Maldini": ("LB", ["CB"]),
    "Gianluigi Buffon": ("GK", []),
    "Andrea Pirlo": ("CDM", ["CM"]),
    "Francesco Totti": ("CAM", ["ST"]),
    "Alessandro Del Piero": ("CAM", ["ST"]),
    "Filippo Inzaghi": ("ST", []),
    "Marco Verratti": ("CM", ["CDM"]),
    "Fabio Cannavaro": ("CB", []),

    # ─── Croatia ──────────────────────────────────────────────────────
    "Luka Modrić": ("CM", ["CAM"]),
    "Joško Gvardiol": ("CB", ["LB"]),
    "Mateo Kovačić": ("CM", ["CDM"]),
    "Ivan Perišić": ("LW", ["RW"]),
    "Marcelo Brozović": ("CDM", []),
    "Robert Prosinečki": ("CAM", []),
    "Davor Šuker": ("ST", []),

    # ─── Uruguay ──────────────────────────────────────────────────────
    "Federico Valverde": ("CM", ["RW", "CDM"]),
    "Ronald Araújo": ("CB", []),
    "José Giménez": ("CB", []),
    "Darwin Núñez": ("ST", []),
    "Luis Suárez": ("ST", []),
    "Diego Forlán": ("ST", []),
    "Diego Godín": ("CB", []),
    "Edinson Cavani": ("ST", []),
    "Diego Maradona Sev": ("CAM", ["ST"]),  # Maradona historic record

    # ─── Senegal ──────────────────────────────────────────────────────
    "Sadio Mané": ("LW", ["ST", "RW"]),
    "Kalidou Koulibaly": ("CB", []),
    "Édouard Mendy": ("GK", []),
    "Idrissa Gueye": ("CDM", []),
    "Nicolas Jackson": ("ST", []),  # fix: not LW

    # ─── Colombia ─────────────────────────────────────────────────────
    "James Rodríguez": ("CAM", ["LW"]),
    "Luis Díaz": ("LW", ["ST"]),
    "Davinson Sánchez": ("CB", []),
    "Carlos Valderrama": ("CAM", []),
    "Faustino Asprilla": ("ST", []),

    # ─── Morocco ──────────────────────────────────────────────────────
    "Achraf Hakimi": ("RB", []),  # fix: not CB
    "Hakim Ziyech": ("CAM", ["RW"]),
    "Yassine Bounou": ("GK", []),
    "Sofyan Amrabat": ("CDM", []),
    "Brahim Díaz": ("CAM", ["RW"]),  # fix: not ST

    # ─── Japan ────────────────────────────────────────────────────────
    "Takefusa Kubo": ("RW", ["CAM"]),
    "Daichi Kamada": ("CAM", []),
    "Wataru Endo": ("CDM", []),
    "Kaoru Mitoma": ("LW", []),
    "Hidetoshi Nakata": ("CAM", []),
    "Keisuke Honda": ("CAM", []),
    "Shunsuke Nakamura": ("CAM", []),
    "Shinji Kagawa": ("CAM", []),

    # ─── USA ──────────────────────────────────────────────────────────
    "Christian Pulisic": ("LW", ["RW", "CAM"]),
    "Weston McKennie": ("CM", ["CDM"]),
    "Tyler Adams": ("CDM", []),
    "Tim Ream": ("CB", []),
    "Sergiño Dest": ("RB", ["LB"]),
    "Matt Turner": ("GK", []),
    "Folarin Balogun": ("ST", []),
    "Tab Ramos": ("CM", ["CAM"]),

    # ─── A few more globally famous ──────────────────────────────────
    # Ghana
    "Mohammed Kudus": ("CAM", ["RW"]),
    "Thomas Partey": ("CDM", []),
    # Egypt
    "Mohamed Salah": ("RW", ["ST"]),
    # Korea
    "Heung-min Son": ("LW", ["ST"]),
    "Hwang Hee-chan": ("ST", ["LW"]),
    # Mexico
    "Hirving Lozano": ("LW", ["RW"]),
    "Edson Álvarez": ("CDM", []),
    "Raúl Jiménez": ("ST", []),
    # Poland (historic)
    "Robert Lewandowski": ("ST", []),
    "Zbigniew Boniek": ("ST", ["RW"]),
    # Sweden
    "Zlatan Ibrahimović": ("ST", []),
    # Czech
    "Pavel Nedvěd": ("CM", ["CAM"]),
    "Petr Čech": ("GK", []),
    # Russia / USSR (historic)
    "Lev Yashin": ("GK", []),
    "Andriy Shevchenko": ("ST", []),
    "Andriy Yarmolenko": ("RW", []),
    # Hungary (historic — Puskás handled above)
    "Sándor Kocsis": ("ST", []),
    # Bulgaria (historic)
    "Hristo Stoichkov": ("LW", ["ST"]),
    # Romania (historic)
    "Gheorghe Hagi": ("CAM", []),
    # Denmark
    "Christian Eriksen": ("CAM", ["CM"]),
    "Pierre-Emile Højbjerg": ("CDM", ["CM"]),
    "Kasper Schmeichel": ("GK", []),
}


def apply_curation(path: Path) -> tuple[int, int]:
    """Returns (matched_count, total_curation_entries_seen)."""
    with path.open() as f:
        players = json.load(f)
    matched = 0
    for p in players:
        if p["name"] in CURATION:
            primary, alts = CURATION[p["name"]]
            p["position"] = primary
            if alts:
                p["altPositions"] = alts
            else:
                # Explicitly drop any stale alts for known specialists
                p.pop("altPositions", None)
            matched += 1
    with path.open("w", encoding="utf-8") as f:
        json.dump(players, f, ensure_ascii=False, indent=2)
    return matched, len(CURATION)


if __name__ == "__main__":
    repo_root = Path(__file__).parent.parent
    total = 0
    for lg in ["worldcup2026", "worldcup"]:
        path = repo_root / "src" / "data" / lg / "players.json"
        m, t = apply_curation(path)
        print(f"  {lg}: matched {m} of {t} curated names")
        total += m
    print(f"\nTotal players corrected: {total}")
