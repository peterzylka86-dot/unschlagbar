#!/usr/bin/env python3
"""
curate_ucl_legends.py — hand-curated UCL roster expansion.

Two passes in one file:

  A) Pre-2016 Premier League legends. The FIFA17-23 ingest covers recent
     stars but misses Henry, Gerrard, Drogba, Lampard, Cantona, Vieira,
     Bergkamp, Charlton, Best, Dalglish, Rush, etc. — the names that
     define each club's UCL history.

  B) Other thin UCL clubs (no source-league coverage). PSG, Ajax, PSV,
     Benfica, Porto, Celtic, Marseille, Monaco, Bayer Leverkusen, plus
     the historic European-Cup winners Steaua / Crvena Zvezda / Dynamo
     Kyiv / Galatasaray / Rosenborg.

Rating calibration (anchored against the existing 96-tier — Beckenbauer,
Gerd Müller, Maradona-era greats):
  96       : Maradona-tier, all-time icon
  94-95    : decade-defining legend (Henry, Cantona, Cruyff, Best, Charlton)
  92-93    : world-class, top-3 at position in their era
  90-91    : world-class first-choice
  88-89    : very good first-choice
  86-87    : solid starter
  ≤85      : squad depth (used sparingly here — this is a legends pass)

Positions follow unschlagbar's 10-bucket taxonomy. Players are listed at
their iconic peak club; a few appear at multiple clubs (Henry at Arsenal
AND Monaco, Mbappé at Monaco AND PSG, etc.) which is intentional — those
are separate entries with separate ratings and eras.

Run from repo root:    python3 tools/curate_ucl_legends.py
Use --dry-run to preview without writing.
Idempotent: dedups by (normalized name, position, club).
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
OUT = REPO / "src" / "data" / "ucl" / "players.json"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


# (name, position, prime_rating, career_years_at_this_club, nationality)
ADDITIONS: dict[str, list[tuple[str, str, int, str, str]]] = {

    # ─────── A) Premier League legends pre-2016 ───────

    "arsenal": [
        ("Thierry Henry",           "ST",  96, "1999-2007", "France"),
        ("Dennis Bergkamp",         "CAM", 93, "1995-2006", "Netherlands"),
        ("Patrick Vieira",          "CM",  92, "1996-2005", "France"),
        ("Robert Pirès",            "LW",  91, "2000-2006", "France"),
        ("Tony Adams",              "CB",  91, "1983-2002", "England"),
        ("Sol Campbell",            "CB",  89, "2001-2006", "England"),
        ("Ashley Cole",             "LB",  90, "1999-2006", "England"),
        ("Robert Pirès",            "CAM", 89, "2000-2006", "France"),
        ("Freddie Ljungberg",       "RW",  87, "1998-2007", "Sweden"),
        ("David Seaman",            "GK",  91, "1990-2003", "England"),
        ("Ian Wright",              "ST",  90, "1991-1998", "England"),
        ("Marc Overmars",           "LW",  88, "1997-2000", "Netherlands"),
        ("Emmanuel Petit",          "CM",  88, "1997-2000", "France"),
        ("Cesc Fàbregas",           "CM",  90, "2003-2011", "Spain"),
        ("Robin van Persie",        "ST",  90, "2004-2012", "Netherlands"),
        ("Gilberto Silva",          "CDM", 87, "2002-2008", "Brazil"),
    ],
    "liverpool": [
        ("Steven Gerrard",          "CM",  95, "1998-2015", "England"),
        ("Kenny Dalglish",          "ST",  94, "1977-1990", "Scotland"),
        ("Ian Rush",                "ST",  93, "1980-1996", "Wales"),
        ("John Barnes",             "LW",  90, "1987-1997", "England"),
        ("Jamie Carragher",         "CB",  88, "1996-2013", "England"),
        ("Robbie Fowler",           "ST",  90, "1993-2007", "England"),
        ("Michael Owen",            "ST",  91, "1996-2004", "England"),
        ("Sami Hyypiä",             "CB",  88, "1999-2009", "Finland"),
        ("Xabi Alonso",             "CM",  89, "2004-2009", "Spain"),
        ("Fernando Torres",         "ST",  91, "2007-2011", "Spain"),
        ("Luis Suárez",             "ST",  92, "2011-2014", "Uruguay"),
        ("Graeme Souness",          "CDM", 91, "1978-1984", "Scotland"),
        ("Alan Hansen",             "CB",  91, "1977-1991", "Scotland"),
        ("Ray Clemence",            "GK",  92, "1967-1981", "England"),
        ("John Aldridge",           "ST",  86, "1987-1989", "Ireland"),
        ("Pepe Reina",              "GK",  87, "2005-2014", "Spain"),
    ],
    "manchesterunited": [
        ("Bobby Charlton",          "CAM", 96, "1956-1973", "England"),
        ("George Best",             "RW",  95, "1963-1974", "Northern Ireland"),
        ("Denis Law",               "ST",  93, "1962-1973", "Scotland"),
        ("Eric Cantona",            "CAM", 93, "1992-1997", "France"),
        ("Roy Keane",               "CM",  92, "1993-2005", "Ireland"),
        ("Paul Scholes",            "CM",  91, "1993-2013", "England"),
        ("Ryan Giggs",              "LW",  92, "1990-2014", "Wales"),
        ("David Beckham",           "RW",  91, "1992-2003", "England"),
        ("Cristiano Ronaldo",       "RW",  94, "2003-2009", "Portugal"),
        ("Wayne Rooney",            "ST",  92, "2004-2017", "England"),
        ("Rio Ferdinand",           "CB",  91, "2002-2014", "England"),
        ("Nemanja Vidić",           "CB",  90, "2006-2014", "Serbia"),
        ("Peter Schmeichel",        "GK",  93, "1991-1999", "Denmark"),
        ("Edwin van der Sar",       "GK",  89, "2005-2011", "Netherlands"),
        ("Gary Neville",            "RB",  88, "1992-2011", "England"),
        ("Andy Cole",               "ST",  88, "1995-2001", "England"),
        ("Dwight Yorke",            "ST",  88, "1998-2002", "Trinidad and Tobago"),
        ("Teddy Sheringham",        "ST",  87, "1997-2001", "England"),
    ],
    "chelsea": [
        ("Didier Drogba",           "ST",  94, "2004-2012", "Ivory Coast"),
        ("Frank Lampard",           "CM",  94, "2001-2014", "England"),
        ("John Terry",              "CB",  92, "1998-2017", "England"),
        ("Gianfranco Zola",         "CAM", 91, "1996-2003", "Italy"),
        ("Petr Čech",               "GK",  93, "2004-2015", "Czech Republic"),
        ("Eden Hazard",             "LW",  93, "2012-2019", "Belgium"),
        ("Ashley Cole",             "LB",  90, "2006-2014", "England"),
        ("Michael Essien",          "CDM", 90, "2005-2014", "Ghana"),
        ("Ricardo Carvalho",        "CB",  89, "2004-2010", "Portugal"),
        ("Claude Makélélé",         "CDM", 90, "2003-2008", "France"),
        ("Marcel Desailly",         "CB",  90, "1998-2004", "France"),
        ("Gianluca Vialli",         "ST",  88, "1996-1999", "Italy"),
        ("Dennis Wise",             "CM",  86, "1990-2001", "England"),
        ("Roberto Di Matteo",       "CM",  85, "1996-2002", "Italy"),
        ("Diego Costa",              "ST",  89, "2014-2017", "Spain"),
    ],
    "tottenham": [
        ("Glenn Hoddle",            "CAM", 91, "1975-1987", "England"),
        ("Gary Lineker",            "ST",  92, "1989-1992", "England"),
        ("Jimmy Greaves",           "ST",  94, "1961-1970", "England"),
        ("Paul Gascoigne",          "CAM", 92, "1988-1992", "England"),
        ("Jürgen Klinsmann",        "ST",  90, "1994-1995", "Germany"),
        ("David Ginola",            "LW",  89, "1997-2000", "France"),
        ("Robbie Keane",            "ST",  88, "2002-2011", "Ireland"),
        ("Dimitar Berbatov",        "ST",  89, "2006-2008", "Bulgaria"),
        ("Luka Modrić",             "CM",  91, "2008-2012", "Croatia"),
        ("Gareth Bale",             "LW",  92, "2007-2013", "Wales"),
        ("Ledley King",             "CB",  87, "1999-2012", "England"),
        ("Teddy Sheringham",        "ST",  88, "1992-1997", "England"),
        ("Pat Jennings",            "GK",  90, "1964-1977", "Northern Ireland"),
        ("Ossie Ardiles",           "CAM", 87, "1978-1988", "Argentina"),
    ],
    "manchestercity": [
        ("Sergio Agüero",           "ST",  93, "2011-2021", "Argentina"),
        ("Yaya Touré",               "CM",  92, "2010-2018", "Ivory Coast"),
        ("Vincent Kompany",         "CB",  90, "2008-2019", "Belgium"),
        ("David Silva",             "CAM", 92, "2010-2020", "Spain"),
        ("Pablo Zabaleta",          "RB",  87, "2008-2017", "Argentina"),
        ("Joe Hart",                "GK",  87, "2006-2016", "England"),
        ("Mario Balotelli",         "ST",  86, "2010-2013", "Italy"),
        ("Carlos Tévez",            "ST",  88, "2009-2013", "Argentina"),
        ("Edin Džeko",              "ST",  87, "2011-2015", "Bosnia and Herzegovina"),
        ("Samir Nasri",             "CAM", 85, "2011-2017", "France"),
        ("Colin Bell",              "CM",  92, "1966-1979", "England"),
        ("Francis Lee",             "ST",  88, "1967-1974", "England"),
        ("Mike Summerbee",          "RW",  87, "1965-1975", "England"),
    ],
    "astonvilla": [
        ("Peter Withe",             "ST",  84, "1980-1985", "England"),
        ("Gordon Cowans",           "CM",  85, "1976-1995", "England"),
        ("Dennis Mortimer",         "CM",  85, "1975-1985", "England"),
        ("Tony Morley",             "LW",  84, "1979-1983", "England"),
        ("Paul McGrath",            "CB",  90, "1989-1996", "Ireland"),
        ("Dean Saunders",           "ST",  85, "1992-1995", "Wales"),
        ("Dwight Yorke",            "ST",  88, "1989-1998", "Trinidad and Tobago"),
        ("David Platt",             "CM",  87, "1988-1991", "England"),
        ("Ugo Ehiogu",              "CB",  85, "1991-2000", "England"),
        ("Gareth Southgate",        "CB",  85, "1995-2001", "England"),
        ("Stiliyan Petrov",         "CM",  84, "2006-2013", "Bulgaria"),
        ("Gabriel Agbonlahor",      "ST",  82, "2006-2018", "England"),
    ],
    "nottinghamforest": [
        ("Trevor Francis",          "ST",  88, "1979-1981", "England"),
        ("John Robertson",          "LW",  88, "1970-1983", "Scotland"),
        ("Kenny Burns",             "CB",  86, "1977-1981", "Scotland"),
        ("Peter Shilton",           "GK",  93, "1977-1982", "England"),
        ("Martin O'Neill",          "CM",  85, "1971-1981", "Northern Ireland"),
        ("Tony Woodcock",           "ST",  85, "1974-1979", "England"),
        ("Larry Lloyd",             "CB",  84, "1976-1981", "England"),
        ("Frank Clark",             "LB",  83, "1975-1979", "England"),
        ("Stuart Pearce",           "LB",  88, "1985-1997", "England"),
        ("Roy Keane",               "CM",  86, "1990-1993", "Ireland"),
        ("Des Walker",              "CB",  86, "1984-1992", "England"),
        ("Nigel Clough",            "CAM", 84, "1984-1993", "England"),
        ("Pierre van Hooijdonk",    "ST",  85, "1997-1999", "Netherlands"),
    ],

    # ─────── B) Other thin UCL clubs ───────

    "psg": [
        ("Zlatan Ibrahimović",      "ST",  93, "2012-2016", "Sweden"),
        ("Edinson Cavani",          "ST",  90, "2013-2020", "Uruguay"),
        ("Thiago Silva",            "CB",  92, "2012-2020", "Brazil"),
        ("Marquinhos",              "CB",  90, "2013-2026", "Brazil"),
        ("Marco Verratti",          "CM",  90, "2012-2023", "Italy"),
        ("Kylian Mbappé",           "ST",  95, "2018-2024", "France"),
        ("Neymar",                  "LW",  94, "2017-2023", "Brazil"),
        ("Achraf Hakimi",           "RB",  88, "2021-2026", "Morocco"),
        ("Gianluigi Donnarumma",    "GK",  88, "2021-2026", "Italy"),
        ("Ángel Di María",          "RW",  89, "2015-2022", "Argentina"),
        ("Javier Pastore",          "CAM", 86, "2011-2018", "Argentina"),
        ("George Weah",             "ST",  92, "1992-1995", "Liberia"),
        ("Raí",                     "CAM", 89, "1993-1998", "Brazil"),
        ("Ronaldinho",              "CAM", 90, "2001-2003", "Brazil"),
        ("Pauleta",                 "ST",  86, "2003-2008", "Portugal"),
        ("David Beckham",           "RW",  82, "2013-2013", "England"),
        ("Lionel Messi",            "RW",  93, "2021-2023", "Argentina"),
    ],
    "ajax": [
        ("Johan Cruyff",            "CAM", 96, "1964-1973", "Netherlands"),
        ("Marco van Basten",        "ST",  94, "1981-1987", "Netherlands"),
        ("Dennis Bergkamp",         "CAM", 90, "1986-1993", "Netherlands"),
        ("Frank Rijkaard",          "CDM", 91, "1980-1987", "Netherlands"),
        ("Patrick Kluivert",        "ST",  89, "1994-1997", "Netherlands"),
        ("Edgar Davids",            "CDM", 89, "1991-1996", "Netherlands"),
        ("Clarence Seedorf",        "CM",  90, "1992-1995", "Netherlands"),
        ("Frank de Boer",           "CB",  88, "1988-1999", "Netherlands"),
        ("Edwin van der Sar",       "GK",  90, "1990-1999", "Netherlands"),
        ("Jari Litmanen",           "CAM", 89, "1992-1999", "Finland"),
        ("Wesley Sneijder",         "CAM", 88, "2002-2007", "Netherlands"),
        ("Christian Eriksen",       "CAM", 86, "2010-2013", "Denmark"),
        ("Frenkie de Jong",         "CM",  87, "2015-2019", "Netherlands"),
        ("Matthijs de Ligt",        "CB",  87, "2016-2019", "Netherlands"),
        ("André Onana",             "GK",  85, "2018-2022", "Cameroon"),
        ("Dušan Tadić",             "CAM", 87, "2018-2023", "Serbia"),
        ("Antony",                  "RW",  84, "2020-2022", "Brazil"),
        ("Ruud Krol",               "LB",  88, "1968-1980", "Netherlands"),
    ],
    "psv": [
        ("Ronaldo",                 "ST",  93, "1994-1996", "Brazil"),
        ("Romário",                 "ST",  93, "1988-1993", "Brazil"),
        ("Ruud van Nistelrooy",     "ST",  92, "1998-2001", "Netherlands"),
        ("Ronald Koeman",           "CB",  90, "1986-1989", "Netherlands"),
        ("Arjen Robben",            "LW",  88, "2002-2004", "Netherlands"),
        ("Park Ji-sung",            "CM",  85, "2003-2005", "South Korea"),
        ("Mark van Bommel",         "CDM", 88, "1999-2005", "Netherlands"),
        ("Phillip Cocu",            "CM",  87, "1995-1998", "Netherlands"),
        ("Jaap Stam",               "CB",  88, "1996-1998", "Netherlands"),
        ("Memphis Depay",           "LW",  85, "2011-2015", "Netherlands"),
        ("Hirving Lozano",          "LW",  84, "2017-2019", "Mexico"),
        ("Cody Gakpo",              "LW",  87, "2018-2023", "Netherlands"),
        ("Mateja Kežman",           "ST",  85, "2000-2004", "Serbia"),
        ("Willy van der Kerkhof",   "CM",  86, "1973-1988", "Netherlands"),
    ],
    "benfica": [
        ("Eusébio",                 "ST",  95, "1961-1975", "Portugal"),
        ("Mário Coluna",            "CM",  91, "1954-1970", "Portugal"),
        ("Rui Costa",               "CAM", 90, "1990-1994", "Portugal"),
        ("Nuno Gomes",              "ST",  86, "1997-2002", "Portugal"),
        ("Simão Sabrosa",           "LW",  86, "2002-2007", "Portugal"),
        ("Ángel Di María",          "RW",  86, "2007-2010", "Argentina"),
        ("David Luiz",              "CB",  85, "2007-2011", "Brazil"),
        ("Pablo Aimar",             "CAM", 86, "2008-2013", "Argentina"),
        ("Javi García",             "CDM", 84, "2009-2012", "Spain"),
        ("Nicolás Otamendi",        "CB",  85, "2020-2026", "Argentina"),
        ("Bernardo Silva",          "CAM", 85, "2014-2015", "Portugal"),
        ("Renato Sanches",          "CM",  84, "2014-2016", "Portugal"),
        ("João Félix",              "CAM", 86, "2018-2019", "Portugal"),
        ("Rafa Silva",              "RW",  84, "2016-2024", "Portugal"),
        ("Darwin Núñez",            "ST",  85, "2020-2022", "Uruguay"),
        ("Jonas",                   "ST",  86, "2014-2019", "Brazil"),
        ("Anderson Talisca",        "CAM", 84, "2014-2016", "Brazil"),
    ],
    "porto": [
        ("Deco",                    "CAM", 91, "1999-2004", "Portugal"),
        ("Ricardo Carvalho",        "CB",  90, "2003-2004", "Portugal"),
        ("Maniche",                 "CM",  86, "2000-2005", "Portugal"),
        ("Hulk",                    "RW",  88, "2008-2012", "Brazil"),
        ("Falcao",                  "ST",  90, "2009-2011", "Colombia"),
        ("James Rodríguez",         "CAM", 87, "2010-2013", "Colombia"),
        ("João Moutinho",           "CM",  87, "2010-2013", "Portugal"),
        ("Pepe",                    "CB",  88, "2004-2007", "Portugal"),
        ("Iker Casillas",           "GK",  88, "2015-2020", "Spain"),
        ("Vítor Baía",              "GK",  88, "1988-2006", "Portugal"),
        ("Costinha",                "CDM", 84, "2001-2005", "Portugal"),
        ("Jackson Martínez",        "ST",  87, "2012-2015", "Colombia"),
        ("Lucho González",          "CAM", 85, "2005-2009", "Argentina"),
        ("Fernando Gomes",          "ST",  88, "1979-1989", "Portugal"),
        ("Mario Jardel",            "ST",  88, "1996-2000", "Brazil"),
        ("Anderson Talisca",        "CAM", 84, "2014-2014", "Brazil"),
    ],
    "celtic": [
        ("Henrik Larsson",          "ST",  92, "1997-2004", "Sweden"),
        ("Kenny Dalglish",          "ST",  90, "1971-1977", "Scotland"),
        ("Jimmy Johnstone",         "RW",  91, "1962-1975", "Scotland"),
        ("Lubo Moravčík",           "CAM", 86, "1998-2002", "Slovakia"),
        ("Paul McStay",             "CM",  86, "1981-1997", "Scotland"),
        ("Billy McNeill",           "CB",  90, "1957-1975", "Scotland"),
        ("Bobby Murdoch",           "CM",  88, "1959-1973", "Scotland"),
        ("Bobby Lennox",            "ST",  86, "1961-1980", "Scotland"),
        ("Tom Boyd",                "LB",  82, "1992-2003", "Scotland"),
        ("Scott Brown",             "CDM", 85, "2007-2021", "Scotland"),
        ("Kyogo Furuhashi",         "ST",  84, "2021-2025", "Japan"),
        ("Stiliyan Petrov",         "CM",  84, "1999-2006", "Bulgaria"),
        ("Aiden McGeady",           "RW",  82, "2004-2010", "Ireland"),
    ],
    "marseille": [
        ("Didier Drogba",           "ST",  90, "2003-2004", "Ivory Coast"),
        ("Jean-Pierre Papin",       "ST",  93, "1986-1992", "France"),
        ("Chris Waddle",            "LW",  88, "1989-1992", "England"),
        ("Marcel Desailly",         "CB",  88, "1992-1993", "France"),
        ("Didier Deschamps",        "CDM", 89, "1989-1994", "France"),
        ("Basile Boli",             "CB",  87, "1990-1994", "France"),
        ("Rudi Völler",             "ST",  88, "1992-1994", "Germany"),
        ("Eric Cantona",            "ST",  90, "1988-1991", "France"),
        ("Abedi Pelé",              "CAM", 89, "1987-1993", "Ghana"),
        ("Dimitri Payet",           "CAM", 87, "2013-2021", "France"),
        ("Florian Thauvin",         "RW",  85, "2013-2021", "France"),
        ("Mathieu Valbuena",        "CAM", 85, "2006-2014", "France"),
        ("Mamadou Niang",           "ST",  84, "2005-2010", "Senegal"),
        ("Steve Mandanda",          "GK",  87, "2007-2022", "France"),
    ],
    "monaco": [
        ("Thierry Henry",           "LW",  88, "1994-1999", "France"),
        ("Kylian Mbappé",           "ST",  88, "2015-2017", "France"),
        ("Falcao",                  "ST",  88, "2013-2019", "Colombia"),
        ("David Trezeguet",         "ST",  88, "1995-2000", "France"),
        ("Fabien Barthez",          "GK",  88, "1995-2000", "France"),
        ("James Rodríguez",         "CAM", 86, "2013-2014", "Colombia"),
        ("Bernardo Silva",          "CAM", 86, "2014-2017", "Portugal"),
        ("Fabinho",                 "CDM", 86, "2013-2018", "Brazil"),
        ("Tiémoué Bakayoko",        "CDM", 84, "2014-2017", "France"),
        ("Benjamin Mendy",          "LB",  85, "2013-2017", "France"),
        ("Emmanuel Petit",          "CM",  85, "1988-1997", "France"),
        ("Jürgen Klinsmann",        "ST",  87, "1992-1994", "Germany"),
        ("Marcelo Gallardo",        "CAM", 86, "1999-2003", "Argentina"),
        ("Lilian Thuram",           "RB",  88, "1996-2001", "France"),
    ],
    "bayer": [
        ("Michael Ballack",         "CM",  91, "1999-2002", "Germany"),
        ("Bernd Schneider",         "RW",  88, "1999-2009", "Germany"),
        ("Lúcio",                   "CB",  88, "2001-2004", "Brazil"),
        ("Ze Roberto",              "LM",  85, "1998-2002", "Brazil"),
        ("Yıldıray Baştürk",        "CAM", 85, "1999-2002", "Turkey"),
        ("Stefan Kießling",         "ST",  86, "2006-2018", "Germany"),
        ("Arturo Vidal",            "CM",  87, "2007-2011", "Chile"),
        ("Hakan Çalhanoğlu",        "CAM", 85, "2014-2017", "Turkey"),
        ("Julian Brandt",           "LW",  85, "2014-2019", "Germany"),
        ("Kai Havertz",             "CAM", 87, "2016-2020", "Germany"),
        ("Florian Wirtz",           "CAM", 90, "2020-2026", "Germany"),
        ("Granit Xhaka",            "CDM", 86, "2023-2026", "Switzerland"),
        ("Jonas Hofmann",           "RW",  84, "2023-2026", "Germany"),
        ("Dimitar Berbatov",        "ST",  86, "2001-2006", "Bulgaria"),
        ("Jorginho",                "GK",  84, "2003-2007", "Brazil"),
        ("Rudi Völler",             "ST",  87, "1982-1987", "Germany"),
    ],
    "galatasaray": [
        ("Hakan Şükür",             "ST",  90, "1992-2003", "Turkey"),
        ("Gheorghe Hagi",           "CAM", 92, "1996-2001", "Romania"),
        ("Gheorghe Popescu",        "CB",  87, "1997-2001", "Romania"),
        ("Cláudio Taffarel",        "GK",  88, "1998-2001", "Brazil"),
        ("Mário Jardel",            "ST",  87, "2000-2003", "Brazil"),
        ("Didier Drogba",           "ST",  88, "2013-2014", "Ivory Coast"),
        ("Wesley Sneijder",         "CAM", 86, "2013-2017", "Netherlands"),
        ("Falcao",                  "ST",  85, "2019-2021", "Colombia"),
        ("Mauro Icardi",            "ST",  85, "2022-2026", "Argentina"),
        ("Fernando Muslera",        "GK",  87, "2011-2024", "Uruguay"),
        ("Wilfried Zaha",           "LW",  84, "2023-2025", "Ivory Coast"),
        ("Felipe Melo",             "CDM", 84, "2011-2015", "Brazil"),
        ("Burak Yılmaz",            "ST",  84, "2010-2018", "Turkey"),
    ],
    "rosenborg": [
        ("Roar Strand",             "CM",  84, "1989-2010", "Norway"),
        ("Bent Skammelsrud",        "CAM", 83, "1989-1999", "Norway"),
        ("Ola By Rise",             "GK",  82, "1983-1995", "Norway"),
        ("Steffen Iversen",         "ST",  84, "1994-1996", "Norway"),
        ("Jahn Ivar Jakobsen",      "ST",  84, "1991-2002", "Norway"),
        ("Stig Inge Bjørnebye",     "LB",  84, "1989-1992", "Norway"),
        ("John Carew",              "ST",  85, "1996-1999", "Norway"),
        ("Harald Brattbakk",        "ST",  84, "1992-1997", "Norway"),
        ("Mike Jensen",             "CM",  83, "2014-2018", "Denmark"),
        ("Pål Lydersen",            "CB",  82, "1987-1991", "Norway"),
        ("Bjørn Maars Johnsen",     "ST",  82, "2016-2018", "Norway"),
        ("Nicki Bille Nielsen",     "ST",  82, "2012-2013", "Denmark"),
    ],
    "steaua": [
        ("Helmuth Duckadam",        "GK",  88, "1982-1988", "Romania"),
        ("Marius Lăcătuș",          "RW",  87, "1983-1990", "Romania"),
        ("Tudorel Stoica",          "CM",  85, "1979-1989", "Romania"),
        ("Miodrag Belodedici",      "CB",  86, "1982-1988", "Romania"),
        ("Adrian Bumbescu",         "CB",  84, "1980-1992", "Romania"),
        ("Iosif Rotariu",           "RB",  83, "1985-1991", "Romania"),
        ("Anghel Iordănescu",       "ST",  84, "1968-1982", "Romania"),
        ("Gheorghe Hagi",           "CAM", 90, "1987-1990", "Romania"),
        ("Dorinel Munteanu",        "CM",  84, "1996-1998", "Romania"),
        ("Florin Răducioiu",        "ST",  84, "1988-1991", "Romania"),
        ("Constantin Gâlcă",        "CDM", 83, "1990-1996", "Romania"),
        ("Lăcătuș (return)",        "RW",  82, "1996-2000", "Romania"),
    ],
    "crvenazvezda": [
        ("Robert Prosinečki",       "CAM", 91, "1987-1991", "Croatia"),
        ("Dejan Savićević",         "CAM", 91, "1988-1992", "Montenegro"),
        ("Darko Pančev",            "ST",  90, "1988-1992", "Macedonia"),
        ("Vladimir Jugović",        "CM",  86, "1989-1992", "Serbia"),
        ("Refik Šabanadžović",      "CDM", 85, "1985-1991", "Bosnia and Herzegovina"),
        ("Stevan Stojanović",       "GK",  85, "1984-1991", "Serbia"),
        ("Siniša Mihajlović",       "LB",  88, "1990-1992", "Serbia"),
        ("Dragan Stojković",        "CAM", 92, "1986-1990", "Serbia"),
        ("Dragoslav Šekularac",     "CAM", 88, "1955-1966", "Serbia"),
        ("Dragan Džajić",           "LW",  92, "1963-1975", "Serbia"),
        ("Dušan Savić",             "ST",  84, "1974-1980", "Serbia"),
        ("Vladica Popović",         "CAM", 84, "1955-1965", "Serbia"),
        ("Nemanja Vidić",           "CB",  86, "2004-2006", "Serbia"),
    ],
    "dynamokyiv": [
        ("Oleg Blokhin",            "LW",  94, "1969-1988", "Ukraine"),
        ("Igor Belanov",            "ST",  90, "1985-1989", "Ukraine"),
        ("Andriy Shevchenko",       "ST",  92, "1994-1999", "Ukraine"),
        ("Sergei Rebrov",           "ST",  88, "1992-2000", "Ukraine"),
        ("Oleksandr Zavarov",       "CAM", 88, "1983-1988", "Ukraine"),
        ("Anatoliy Demyanenko",     "LB",  87, "1979-1990", "Ukraine"),
        ("Anatoly Byshovets",       "ST",  86, "1963-1973", "Ukraine"),
        ("Volodymyr Bezsonov",      "CM",  87, "1976-1990", "Ukraine"),
        ("Olexiy Mykhaylychenko",   "CM",  86, "1983-1990", "Ukraine"),
        ("Viktor Kolotov",          "CM",  86, "1971-1981", "Ukraine"),
        ("Andriy Yarmolenko",       "RW",  85, "2008-2017", "Ukraine"),
        ("Andriy Pyatov",           "GK",  82, "2007-2014", "Ukraine"),
        ("Vitaliy Mykolenko",       "LB",  82, "2017-2022", "Ukraine"),
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
    print(f"Curated: {len(flat)} entries across {len(ADDITIONS)} clubs")
    print(f"  → already in UCL roster: {dropped}")
    print(f"  → new: {len(to_add)}")
    print()
    print("Per-club additions (this pass only):")
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
