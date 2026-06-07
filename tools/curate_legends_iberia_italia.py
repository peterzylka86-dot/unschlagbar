#!/usr/bin/env python3
"""
curate_legends_iberia_italia.py — pre-2016 legends pass for La Liga + Serie A.

The FIFA17-23 ingest gave us 2016-2023 stars but missed the long history
of Iberian and Italian football. This adds back the iconic pre-FIFA era
players whose absence from the rosters the user noticed.

Mirrors the pattern of tools/curate_ucl_legends.py: a per-club Python dict
of additions, idempotent dedup by (name, position, club).

Calibration anchored against existing 96-tier (Beckenbauer / Gerd Müller):
  96 = all-time icon (Di Stéfano, Cruyff at Barça)
  94-95 = decade legend (Maradona at Napoli, Platini at Juve, Maldini)
  92-93 = world-class era star (Stoichkov, Baggio, Totti, Zico)
  90-91 = elite first-choice (Hierro, Albertini, Veron)
  88-89 = solid starter at a top club
  ≤87 = squad depth (used sparingly here)

Run from repo root:    python3 tools/curate_legends_iberia_italia.py
Use --dry-run to preview.
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
LALIGA = REPO / "src" / "data" / "laliga" / "players.json"
SERIEA = REPO / "src" / "data" / "seriea" / "players.json"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


# Per-league per-club additions. Each entry: (name, position, prime_rating,
# career_years_at_this_club, nationality)
LALIGA_ADDITIONS: dict[str, list[tuple[str, str, int, str, str]]] = {
    "realmadrid": [
        ("Alfredo Di Stéfano",     "ST",  96, "1953-1964", "Argentina"),
        ("Ferenc Puskás",          "ST",  95, "1958-1966", "Hungary"),
        ("Francisco Gento",        "LW",  93, "1953-1971", "Spain"),
        ("Raymond Kopa",           "RW",  92, "1956-1959", "France"),
        ("Hugo Sánchez",           "ST",  93, "1985-1992", "Mexico"),
        ("Emilio Butragueño",      "ST",  91, "1984-1995", "Spain"),
        ("Míchel",                 "RW",  89, "1982-1996", "Spain"),
        ("Manolo Sanchís",         "CB",  88, "1983-2001", "Spain"),
        ("Chendo",                 "RB",  86, "1982-1998", "Spain"),
        ("Fernando Hierro",        "CB",  91, "1989-2003", "Spain"),
        ("Raúl González",          "ST",  92, "1994-2010", "Spain"),
        ("Iván Zamorano",          "ST",  88, "1992-1996", "Chile"),
        ("Davor Šuker",            "ST",  88, "1996-1999", "Croatia"),
        ("Predrag Mijatović",      "ST",  87, "1996-1999", "Montenegro"),
        ("Roberto Carlos",         "LB",  92, "1996-2007", "Brazil"),
        ("Luís Figo",              "RW",  92, "2000-2005", "Portugal"),
        ("Zinedine Zidane",        "CAM", 95, "2001-2006", "France"),
        ("Ronaldo Nazário",        "ST",  94, "2002-2007", "Brazil"),
        ("Michael Owen",           "ST",  86, "2004-2005", "England"),
        ("Iván Helguera",          "CDM", 86, "1999-2007", "Spain"),
        ("Claude Makélélé",        "CDM", 89, "2000-2003", "France"),
        ("Steve McManaman",        "RW",  86, "1999-2003", "England"),
        ("Wesley Sneijder",        "CAM", 87, "2007-2009", "Netherlands"),
        ("Mesut Özil",             "CAM", 89, "2010-2013", "Germany"),
        ("Xabi Alonso",            "CDM", 89, "2009-2014", "Spain"),
        ("Ángel Di María",         "RW",  88, "2010-2014", "Argentina"),
        ("Gareth Bale",            "RW",  90, "2013-2022", "Wales"),
        ("James Rodríguez",        "CAM", 86, "2014-2017", "Colombia"),
    ],
    "barcelona": [
        ("Johan Cruyff",           "CAM", 96, "1973-1978", "Netherlands"),
        ("Diego Maradona",         "CAM", 94, "1982-1984", "Argentina"),
        ("Bernd Schuster",         "CAM", 89, "1980-1988", "Germany"),
        ("Carles Rexach",          "RW",  86, "1965-1981", "Spain"),
        ("Julio Salinas",          "ST",  85, "1988-1994", "Spain"),
        ("Michael Laudrup",        "CAM", 92, "1989-1994", "Denmark"),
        ("Hristo Stoichkov",       "ST",  93, "1990-1995", "Bulgaria"),
        ("Ronald Koeman",          "CB",  91, "1989-1995", "Netherlands"),
        ("Romário",                "ST",  93, "1993-1995", "Brazil"),
        ("Pep Guardiola",          "CDM", 88, "1990-2001", "Spain"),
        ("Luís Figo",              "RW",  91, "1995-2000", "Portugal"),
        ("Ronaldo Nazário",        "ST",  93, "1996-1997", "Brazil"),
        ("Rivaldo",                "CAM", 93, "1997-2002", "Brazil"),
        ("Patrick Kluivert",       "ST",  90, "1998-2004", "Netherlands"),
        ("Frank de Boer",          "CB",  88, "1998-2003", "Netherlands"),
        ("Ronaldinho",             "CAM", 94, "2003-2008", "Brazil"),
        ("Deco",                   "CAM", 90, "2004-2008", "Portugal"),
        ("Samuel Eto'o",           "ST",  91, "2004-2009", "Cameroon"),
        ("Lilian Thuram",          "RB",  87, "2006-2008", "France"),
        ("Andrés Iniesta",         "CM",  93, "2002-2018", "Spain"),
        ("Xavi Hernández",         "CM",  93, "1998-2015", "Spain"),
        ("Carles Puyol",           "CB",  90, "1999-2014", "Spain"),
        ("Víctor Valdés",          "GK",  88, "2002-2014", "Spain"),
        ("Sergio Busquets",        "CDM", 90, "2008-2023", "Spain"),
        ("Dani Alves",             "RB",  89, "2008-2016", "Brazil"),
        ("David Villa",            "ST",  90, "2010-2013", "Spain"),
        ("Neymar",                 "LW",  92, "2013-2017", "Brazil"),
        ("Luis Suárez",            "ST",  92, "2014-2020", "Uruguay"),
        ("Andoni Zubizarreta",     "GK",  88, "1986-1994", "Spain"),
    ],
    "atletico": [
        ("Adelardo",               "CM",  87, "1959-1975", "Spain"),
        ("Luiz Pereira",           "CB",  86, "1975-1980", "Brazil"),
        ("Hugo Sánchez",           "ST",  89, "1981-1985", "Mexico"),
        ("Paulo Futre",            "LW",  91, "1987-1993", "Portugal"),
        ("Manolo",                 "ST",  87, "1988-1994", "Spain"),
        ("Tomás Reñones",          "RB",  85, "1985-1994", "Spain"),
        ("Bernd Schuster",         "CAM", 88, "1988-1990", "Germany"),
        ("Diego Simeone",          "CDM", 88, "1994-1997", "Argentina"),
        ("José Luis Caminero",     "CAM", 86, "1993-1998", "Spain"),
        ("Kiko",                   "ST",  86, "1993-2001", "Spain"),
        ("Christian Vieri",        "ST",  89, "1997-1998", "Italy"),
        ("Juninho Paulista",       "CAM", 86, "1997-2000", "Brazil"),
        ("Fernando Torres",        "ST",  91, "2001-2007", "Spain"),
        ("Sergio Agüero",          "ST",  90, "2006-2011", "Argentina"),
        ("Diego Forlán",           "ST",  89, "2007-2011", "Uruguay"),
        ("Diego Godín",            "CB",  90, "2010-2019", "Uruguay"),
        ("Filipe Luís",            "LB",  87, "2010-2019", "Brazil"),
        ("Tiago",                  "CDM", 85, "2010-2017", "Portugal"),
        ("Arda Turan",             "CAM", 87, "2011-2015", "Turkey"),
        ("Radamel Falcao",         "ST",  90, "2011-2013", "Colombia"),
    ],
    "valencia": [
        ("Mario Kempes",           "ST",  92, "1976-1981", "Argentina"),
        ("Fernando Gómez Colomer", "CAM", 87, "1983-1998", "Spain"),
        ("Predrag Mijatović",      "ST",  88, "1993-1996", "Montenegro"),
        ("Adrian Ilie",            "ST",  86, "1998-2001", "Romania"),
        ("Claudio López",          "ST",  88, "1996-2000", "Argentina"),
        ("Gaizka Mendieta",        "CAM", 91, "1992-2001", "Spain"),
        ("Santiago Cañizares",     "GK",  89, "1998-2008", "Spain"),
        ("Roberto Ayala",          "CB",  89, "2000-2007", "Argentina"),
        ("David Albelda",          "CDM", 87, "1995-2013", "Spain"),
        ("Rubén Baraja",           "CDM", 87, "2000-2010", "Spain"),
        ("Pablo Aimar",            "CAM", 89, "2001-2006", "Argentina"),
        ("Mista",                  "ST",  87, "2001-2005", "Spain"),
        ("Vicente Rodríguez",      "LW",  87, "2000-2010", "Spain"),
        ("David Villa",            "ST",  91, "2005-2010", "Spain"),
        ("David Silva",            "CAM", 89, "2004-2010", "Spain"),
        ("Juan Mata",               "CAM", 87, "2007-2011", "Spain"),
        ("Carlos Marchena",         "CB",  85, "2001-2010", "Spain"),
    ],
    "athletic": [
        ("Telmo Zarra",            "ST",  92, "1940-1955", "Spain"),
        ("José Ángel Iribar",      "GK",  90, "1962-1980", "Spain"),
        ("Andoni Goikoetxea",       "CB",  87, "1974-1987", "Spain"),
        ("Andoni Zubizarreta",     "GK",  87, "1981-1986", "Spain"),
        ("Manuel Sarabia",         "CAM", 87, "1976-1988", "Spain"),
        ("Dani",                   "ST",  86, "1975-1987", "Spain"),
        ("Julen Guerrero",         "CAM", 88, "1991-2005", "Spain"),
        ("Iribar (return)",        "GK",  86, "1973-1980", "Spain"),
        ("Joseba Etxeberria",      "RW",  87, "1995-2010", "Spain"),
        ("Iker Muniain",           "LW",  86, "2009-2024", "Spain"),
        ("Aritz Aduriz",           "ST",  87, "2012-2020", "Spain"),
    ],
    "sevilla": [
        ("Diego Maradona",         "CAM", 88, "1992-1993", "Argentina"),
        ("Davor Šuker",            "ST",  87, "1991-1996", "Croatia"),
        ("Julio Cardeñosa",        "CM",  84, "1976-1986", "Spain"),
        ("Jesús Navas",            "RW",  88, "2003-2013", "Spain"),
        ("Sergio Ramos",           "CB",  87, "2004-2005", "Spain"),
        ("Dani Alves",             "RB",  88, "2003-2008", "Brazil"),
        ("Frédéric Kanouté",       "ST",  88, "2005-2012", "Mali"),
        ("Adriano Correia",        "LB",  85, "2004-2010", "Brazil"),
        ("Andrés Palop",           "GK",  85, "2005-2013", "Spain"),
        ("Ivica Olić",             "ST",  84, "2013-2014", "Croatia"),
        ("Carlos Bacca",           "ST",  85, "2013-2015", "Colombia"),
        ("Éver Banega",            "CM",  86, "2014-2020", "Argentina"),
    ],
    "betis": [
        ("Julio Cardeñosa",        "CM",  84, "1976-1989", "Spain"),
        ("Gordillo",               "LB",  87, "1976-1987", "Spain"),
        ("Hipólito Rincón",        "ST",  85, "1980-1987", "Spain"),
        ("Denilson",                "LW",  87, "1998-2005", "Brazil"),
        ("Joaquín Sánchez",        "RW",  90, "2000-2006", "Spain"),
        ("Dani",                   "ST",  85, "1998-2003", "Spain"),
        ("Robert Jarni",           "LB",  87, "1996-1998", "Croatia"),
        ("Alfonso Pérez",          "ST",  86, "2000-2003", "Spain"),
        ("Capi",                   "CM",  84, "1998-2010", "Spain"),
        ("Assunção",               "CM",  85, "2001-2010", "Brazil"),
    ],
    "realsociedad": [
        ("Jesús María Satrústegui","ST",  87, "1974-1986", "Spain"),
        ("Roberto López Ufarte",   "LW",  88, "1976-1987", "Spain"),
        ("Genar Andrinúa",         "CB",  85, "1986-1995", "Spain"),
        ("José Mari Bakero",       "CM",  88, "1980-1988", "Spain"),
        ("Txiki Begiristain",      "RW",  87, "1985-1988", "Spain"),
        ("Loren",                  "ST",  86, "1986-1996", "Spain"),
        ("John Aldridge",          "ST",  85, "1989-1991", "Ireland"),
        ("Mikel Aramburu",         "CDM", 84, "1993-2003", "Spain"),
        ("Xabi Alonso",            "CM",  89, "1999-2004", "Spain"),
        ("Antoine Griezmann",      "CAM", 89, "2009-2014", "France"),
    ],
}


SERIEA_ADDITIONS: dict[str, list[tuple[str, str, int, str, str]]] = {
    "juventus": [
        ("Giampiero Boniperti",    "ST",  92, "1946-1961", "Italy"),
        ("John Charles",           "ST",  91, "1957-1962", "Wales"),
        ("Omar Sívori",            "CAM", 92, "1957-1965", "Argentina"),
        ("Dino Zoff",              "GK",  93, "1972-1983", "Italy"),
        ("Gaetano Scirea",         "CB",  93, "1974-1988", "Italy"),
        ("Marco Tardelli",         "CM",  91, "1975-1985", "Italy"),
        ("Antonio Cabrini",        "LB",  90, "1976-1989", "Italy"),
        ("Claudio Gentile",        "CB",  89, "1973-1984", "Italy"),
        ("Roberto Bettega",        "ST",  90, "1970-1983", "Italy"),
        ("Paolo Rossi",            "ST",  91, "1981-1985", "Italy"),
        ("Michel Platini",         "CAM", 95, "1982-1987", "France"),
        ("Zbigniew Boniek",        "RW",  90, "1982-1985", "Poland"),
        ("Roberto Baggio",         "CAM", 94, "1990-1995", "Italy"),
        ("Andreas Möller",         "CAM", 88, "1992-1994", "Germany"),
        ("Gianluca Vialli",        "ST",  92, "1992-1996", "Italy"),
        ("Fabrizio Ravanelli",     "ST",  89, "1992-1996", "Italy"),
        ("Antonio Conte",          "CM",  89, "1991-2004", "Italy"),
        ("Didier Deschamps",       "CDM", 89, "1994-1999", "France"),
        ("Alessandro Del Piero",   "CAM", 92, "1993-2012", "Italy"),
        ("Filippo Inzaghi",        "ST",  90, "1997-2001", "Italy"),
        ("Zinedine Zidane",        "CAM", 94, "1996-2001", "France"),
        ("Edgar Davids",           "CDM", 89, "1996-2004", "Netherlands"),
        ("Pavel Nedvěd",           "CAM", 92, "2001-2009", "Czech Republic"),
        ("David Trezeguet",        "ST",  90, "2000-2010", "France"),
        ("Lilian Thuram",          "RB",  90, "2001-2006", "France"),
        ("Gianluca Zambrotta",     "RB",  88, "1999-2006", "Italy"),
        ("Mauro Camoranesi",        "RW",  87, "2002-2010", "Italy"),
        ("Andrea Pirlo",            "CM",  92, "2011-2015", "Italy"),
        ("Carlos Tévez",            "ST",  90, "2013-2015", "Argentina"),
        ("Arturo Vidal",            "CM",  88, "2011-2015", "Chile"),
        ("Paul Pogba",              "CM",  90, "2012-2016", "France"),
        ("Gianluigi Buffon",        "GK",  93, "2001-2018", "Italy"),
    ],
    "milan": [
        ("Gianni Rivera",          "CAM", 94, "1960-1979", "Italy"),
        ("Cesare Maldini",         "CB",  88, "1954-1966", "Italy"),
        ("Franco Baresi",          "CB",  95, "1977-1997", "Italy"),
        ("Paolo Maldini",          "LB",  95, "1985-2009", "Italy"),
        ("Mauro Tassotti",         "RB",  87, "1980-1997", "Italy"),
        ("Alessandro Costacurta",  "CB",  88, "1986-2007", "Italy"),
        ("Carlo Ancelotti",        "CM",  87, "1987-1992", "Italy"),
        ("Frank Rijkaard",         "CDM", 91, "1988-1993", "Netherlands"),
        ("Marco van Basten",       "ST",  95, "1987-1995", "Netherlands"),
        ("Ruud Gullit",            "CAM", 93, "1987-1993", "Netherlands"),
        ("Roberto Donadoni",       "RW",  89, "1986-1996", "Italy"),
        ("Demetrio Albertini",     "CM",  90, "1988-2002", "Italy"),
        ("Dejan Savićević",        "CAM", 90, "1992-1998", "Montenegro"),
        ("Zvonimir Boban",         "CAM", 89, "1991-2001", "Croatia"),
        ("George Weah",            "ST",  93, "1995-2000", "Liberia"),
        ("Christian Panucci",      "RB",  87, "1993-1997", "Italy"),
        ("Andriy Shevchenko",      "ST",  93, "1999-2006", "Ukraine"),
        ("Filippo Inzaghi",        "ST",  90, "2001-2012", "Italy"),
        ("Andrea Pirlo",           "CM",  92, "2001-2011", "Italy"),
        ("Gennaro Gattuso",        "CDM", 89, "1999-2012", "Italy"),
        ("Clarence Seedorf",       "CM",  89, "2002-2012", "Netherlands"),
        ("Kaká",                   "CAM", 93, "2003-2009", "Brazil"),
        ("Cafu",                   "RB",  90, "2003-2008", "Brazil"),
        ("Alessandro Nesta",       "CB",  92, "2002-2012", "Italy"),
        ("Ronaldinho",             "CAM", 89, "2008-2011", "Brazil"),
        ("Zlatan Ibrahimović",     "ST",  92, "2010-2012", "Sweden"),
        ("Massimo Ambrosini",       "CM",  87, "1995-2013", "Italy"),
    ],
    "inter": [
        ("Sandro Mazzola",         "CAM", 92, "1960-1977", "Italy"),
        ("Giacinto Facchetti",     "LB",  93, "1960-1978", "Italy"),
        ("Luis Suárez Miramontes", "CM",  92, "1961-1973", "Spain"),
        ("Helmut Haller",          "CAM", 88, "1968-1973", "Germany"),
        ("Giuseppe Bergomi",       "CB",  90, "1980-1999", "Italy"),
        ("Walter Zenga",           "GK",  90, "1982-1994", "Italy"),
        ("Alessandro Altobelli",   "ST",  88, "1977-1988", "Italy"),
        ("Andreas Brehme",         "LB",  89, "1988-1992", "Germany"),
        ("Lothar Matthäus",        "CM",  93, "1988-1992", "Germany"),
        ("Jürgen Klinsmann",       "ST",  90, "1989-1992", "Germany"),
        ("Dennis Bergkamp",        "CAM", 90, "1993-1995", "Netherlands"),
        ("Roberto Carlos",         "LB",  87, "1995-1996", "Brazil"),
        ("Paul Ince",              "CM",  86, "1995-1997", "England"),
        ("Diego Simeone",          "CDM", 87, "1997-1999", "Argentina"),
        ("Ronaldo Nazário",        "ST",  94, "1997-2002", "Brazil"),
        ("Iván Zamorano",          "ST",  88, "1996-2001", "Chile"),
        ("Christian Vieri",        "ST",  91, "1999-2005", "Italy"),
        ("Álvaro Recoba",          "CAM", 88, "1997-2008", "Uruguay"),
        ("Hernán Crespo",          "ST",  89, "2002-2003", "Argentina"),
        ("Adriano",                "ST",  90, "2004-2009", "Brazil"),
        ("Javier Zanetti",         "RB",  91, "1995-2014", "Argentina"),
        ("Marco Materazzi",         "CB",  88, "2001-2011", "Italy"),
        ("Esteban Cambiasso",       "CDM", 88, "2004-2014", "Argentina"),
        ("Maicon",                  "RB",  89, "2006-2012", "Brazil"),
        ("Wesley Sneijder",         "CAM", 90, "2009-2013", "Netherlands"),
        ("Samuel Eto'o",            "ST",  91, "2009-2011", "Cameroon"),
        ("Diego Milito",            "ST",  88, "2009-2014", "Argentina"),
        ("Walter Samuel",           "CB",  88, "2005-2014", "Argentina"),
        ("Javier Mascherano",       "CDM", 87, "2003-2005", "Argentina"),
    ],
    "napoli": [
        ("Diego Maradona",         "CAM", 96, "1984-1991", "Argentina"),
        ("Careca",                 "ST",  92, "1987-1993", "Brazil"),
        ("Alemão",                 "CM",  88, "1988-1992", "Brazil"),
        ("Salvatore Bagni",        "CM",  87, "1984-1988", "Italy"),
        ("Antonio Careca",         "ST",  90, "1987-1993", "Brazil"),
        ("Ciro Ferrara",           "CB",  88, "1984-1994", "Italy"),
        ("Bruno Giordano",         "ST",  87, "1985-1988", "Italy"),
        ("Andrea Carnevale",       "ST",  86, "1986-1990", "Italy"),
        ("Daniel Bertoni",         "RW",  86, "1980-1983", "Argentina"),
        ("Roberto Bordin",         "CM",  84, "1989-1994", "Italy"),
        ("Gianfranco Zola",        "CAM", 90, "1989-1993", "Italy"),
        ("Daniel Fonseca",         "ST",  87, "1991-1994", "Uruguay"),
        ("Ezequiel Lavezzi",       "LW",  87, "2007-2012", "Argentina"),
        ("Marek Hamšík",           "CAM", 90, "2007-2019", "Slovakia"),
        ("Edinson Cavani",         "ST",  91, "2010-2013", "Uruguay"),
        ("Pepe Reina",             "GK",  87, "2013-2015", "Spain"),
        ("Gonzalo Higuaín",        "ST",  90, "2013-2016", "Argentina"),
        ("Lorenzo Insigne",        "LW",  89, "2010-2022", "Italy"),
    ],
    "roma": [
        ("Bruno Conti",            "RW",  91, "1973-1991", "Italy"),
        ("Falcão",                 "CM",  92, "1980-1985", "Brazil"),
        ("Toninho Cerezo",         "CDM", 89, "1983-1986", "Brazil"),
        ("Roberto Pruzzo",         "ST",  89, "1978-1988", "Italy"),
        ("Carlo Ancelotti",        "CM",  87, "1979-1987", "Italy"),
        ("Rudi Völler",            "ST",  90, "1987-1992", "Germany"),
        ("Aldair",                 "CB",  88, "1990-2003", "Brazil"),
        ("Giuseppe Giannini",      "CAM", 88, "1981-1996", "Italy"),
        ("Daniel Fonseca",         "ST",  86, "1994-1997", "Uruguay"),
        ("Francesco Totti",        "CAM", 94, "1992-2017", "Italy"),
        ("Vincent Candela",        "LB",  86, "1997-2005", "France"),
        ("Cafu",                   "RB",  91, "1997-2003", "Brazil"),
        ("Gabriel Batistuta",      "ST",  92, "2000-2003", "Argentina"),
        ("Daniele De Rossi",       "CDM", 91, "2001-2019", "Italy"),
        ("Walter Samuel",          "CB",  87, "2000-2004", "Argentina"),
        ("Christian Panucci",      "RB",  87, "2001-2009", "Italy"),
        ("Mirko Vučinić",          "ST",  87, "2006-2011", "Montenegro"),
        ("Marco Borriello",        "ST",  85, "2010-2012", "Italy"),
        ("Miralem Pjanić",         "CAM", 88, "2011-2016", "Bosnia and Herzegovina"),
        ("Mohamed Salah",          "RW",  87, "2015-2017", "Egypt"),
    ],
    "lazio": [
        ("Giorgio Chinaglia",      "ST",  92, "1969-1976", "Italy"),
        ("Vincenzo D'Amico",       "CAM", 86, "1975-1990", "Italy"),
        ("Bruno Giordano",         "ST",  88, "1976-1985", "Italy"),
        ("Aron Winter",            "CM",  87, "1992-1996", "Netherlands"),
        ("Pierluigi Casiraghi",    "ST",  86, "1989-1998", "Italy"),
        ("Beppe Signori",          "ST",  90, "1992-1997", "Italy"),
        ("Roberto Mancini",        "CAM", 89, "1997-2001", "Italy"),
        ("Pavel Nedvěd",           "CAM", 90, "1996-2001", "Czech Republic"),
        ("Christian Vieri",        "ST",  89, "1998-1999", "Italy"),
        ("Juan Sebastián Verón",   "CM",  90, "1999-2001", "Argentina"),
        ("Alessandro Nesta",       "CB",  90, "1993-2002", "Italy"),
        ("Hernán Crespo",          "ST",  89, "2000-2002", "Argentina"),
        ("Marcelo Salas",          "ST",  88, "1998-2001", "Chile"),
        ("Diego Simeone",          "CDM", 86, "1999-2003", "Argentina"),
        ("Siniša Mihajlović",      "LB",  87, "1998-2004", "Serbia"),
        ("Miroslav Klose",         "ST",  87, "2011-2016", "Germany"),
        ("Hernanes",               "CAM", 88, "2010-2013", "Brazil"),
        ("Stefan Radu",            "CB",  85, "2008-2024", "Romania"),
    ],
    "fiorentina": [
        ("Giancarlo Antognoni",    "CAM", 91, "1972-1987", "Italy"),
        ("Daniel Passarella",      "CB",  89, "1982-1986", "Argentina"),
        ("Daniel Bertoni",         "RW",  87, "1980-1984", "Argentina"),
        ("Roberto Baggio",         "CAM", 93, "1985-1990", "Italy"),
        ("Stefano Borgonovo",      "ST",  86, "1988-1992", "Italy"),
        ("Gabriel Batistuta",      "ST",  94, "1991-2000", "Argentina"),
        ("Rui Costa",              "CAM", 91, "1994-2001", "Portugal"),
        ("Francesco Toldo",        "GK",  89, "1993-2001", "Italy"),
        ("Edmundo",                "ST",  87, "1998-2000", "Brazil"),
        ("Adrian Mutu",            "ST",  88, "2006-2011", "Romania"),
        ("Stevan Jovetić",         "CAM", 87, "2008-2013", "Montenegro"),
        ("Riccardo Montolivo",     "CM",  86, "2005-2012", "Italy"),
        ("Alberto Gilardino",      "ST",  86, "2008-2012", "Italy"),
        ("Mario Gómez",            "ST",  85, "2013-2016", "Germany"),
    ],
}


def apply_curation(path: Path, additions: dict, label: str, dry_run: bool):
    existing = json.loads(path.read_text())
    existing_keys = {(norm(p["name"]), p["position"], p["club"]) for p in existing}

    flat = []
    for club_id, entries in additions.items():
        for name, pos, ovr, years, nat in entries:
            flat.append({
                "name": name, "position": pos,
                "prime_rating": ovr, "career_years": years,
                "nationality": nat, "club": club_id,
            })
    to_add = [p for p in flat
              if (norm(p["name"]), p["position"], p["club"]) not in existing_keys]
    dropped = len(flat) - len(to_add)

    print(f"\n=== {label} ===")
    print(f"  Curated entries: {len(flat)}")
    print(f"  Already in roster (dedup): {dropped}")
    print(f"  NEW additions: {len(to_add)}")
    by_club = Counter(p["club"] for p in to_add)
    for cid, n in sorted(by_club.items(), key=lambda kv: -kv[1]):
        print(f"    {cid:20} +{n}")

    if not dry_run and to_add:
        merged = existing + to_add
        path.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n")
        print(f"  → wrote {len(merged)} total")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    apply_curation(LALIGA, LALIGA_ADDITIONS, "La Liga", args.dry_run)
    apply_curation(SERIEA, SERIEA_ADDITIONS, "Serie A", args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
