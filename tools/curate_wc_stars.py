#!/usr/bin/env python3
"""
curate_wc_stars.py — refine positions + ratings for famous WC players.

The jfjelstul ingest gave us real WC participants, but with two coarseness
issues:
  1. Positions are 4-bucket (GK/DF/MF/FW) → mapped naïvely to GK/CB/CM/ST.
     So Cafu shows as CB instead of RB. Maradona as CM instead of CAM.
     Position accuracy matters because unschlagbar's draft is position-aware.
  2. Pre-FIFA-era players sit at the 75 baseline — Bulgaria '94 squad (Stoichkov
     94 Ballon d'Or!), Romania '94 (Hagi), Croatia '98 (Šuker, Boban, Bilić),
     Cameroon '90 (Roger Milla), USA '94 (Eric Wynalda, John Harkes) — all
     flat-rated until this pass.

This script applies a per-player override table to the WC players.json.
Run AFTER build_wc_squads.py.

Run from repo root:    python3 tools/curate_wc_stars.py
Use --dry-run to preview without writing.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WC_PLAYERS = REPO / "src" / "data" / "worldcup" / "players.json"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ASCII", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]+", "", s).strip()


# (position, rating) per normalized player name.
# Only entries where my training-data confidence is high. Rating calibrated
# against the existing 96-tier (Pelé, Maradona): 96=GOAT, 94-95=decade legend,
# 92-93=top-3 of era at position, 90-91=elite first-choice, 88-89=very good
# tournament player, ≤87 left to heuristic.
OVERRIDES: dict[str, tuple[str, int]] = {
    # ─── Brazil ───
    "pele":                    ("ST",  96),
    "garrincha":               ("RW",  94),
    "didi":                    ("CAM", 90),
    "vava":                    ("ST",  89),
    "zagallo":                 ("LW",  87),
    "gerson":                  ("CM",  89),
    "rivellino":               ("CAM", 91),
    "jairzinho":               ("RW",  92),
    "tostao":                  ("ST",  91),
    "carlos alberto torres":   ("RB",  92),
    "clodoaldo":               ("CDM", 88),
    "socrates":                ("CAM", 92),
    "zico":                    ("CAM", 93),
    "junior":                  ("LB",  88),
    "falcao":                  ("CM",  89),
    "careca":                  ("ST",  89),
    "branco":                  ("LB",  86),
    "dunga":                   ("CDM", 89),
    "bebeto":                  ("ST",  90),
    "romario de souza faria":  ("ST",  93),
    "romario":                 ("ST",  93),
    "rai":                     ("CAM", 89),
    "cafu":                    ("RB",  92),
    "roberto carlos da silva": ("LB",  92),
    "roberto carlos":          ("LB",  92),
    "ronaldo luis nazario de lima": ("ST", 96),
    "ronaldo nazario":         ("ST",  96),
    "ronaldo":                 ("ST",  96),
    "rivaldo vitor borba ferreira": ("CAM", 92),
    "rivaldo":                 ("CAM", 92),
    "ronaldinho gaucho":       ("CAM", 93),
    "ronaldinho":              ("CAM", 93),
    "kaka":                    ("CAM", 92),
    "ricardo izecson dos santos leite": ("CAM", 92),
    "lucio":                   ("CB",  90),
    "juan":                    ("CB",  87),
    "maicon":                  ("RB",  89),
    "dani alves":              ("RB",  90),
    "daniel alves da silva":   ("RB",  90),
    "thiago silva":            ("CB",  91),
    "marcelo":                 ("LB",  89),
    "fernandinho":             ("CDM", 87),
    "casemiro":                ("CDM", 89),
    "fred":                    ("ST",  84),
    "neymar":                  ("LW",  93),
    "neymar jr":               ("LW",  93),
    "neymar da silva santos junior": ("LW", 93),
    "philippe coutinho":       ("CAM", 88),
    "gabriel jesus":           ("ST",  86),
    "richarlison":             ("ST",  85),
    "alisson becker":          ("GK",  91),
    "alisson":                 ("GK",  91),
    "vinicius junior":         ("LW",  91),
    "vinicius jr":             ("LW",  91),

    # ─── Argentina ───
    "diego maradona":          ("CAM", 96),
    "mario kempes":             ("ST",  92),
    "daniel passarella":        ("CB",  91),
    "ubaldo fillol":            ("GK",  89),
    "osvaldo ardiles":          ("CM",  88),
    "claudio caniggia":         ("ST",  88),
    "gabriel batistuta":        ("ST",  94),
    "ariel ortega":             ("CAM", 88),
    "juan roman riquelme":      ("CAM", 91),
    "juan sebastian veron":     ("CM",  89),
    "hernan crespo":            ("ST",  89),
    "javier zanetti":           ("RB",  90),
    "diego simeone":            ("CDM", 87),
    "lionel messi":             ("RW",  96),
    "leo messi":                ("RW",  96),
    "sergio aguero":            ("ST",  90),
    "kun aguero":               ("ST",  90),
    "javier mascherano":        ("CDM", 88),
    "angel di maria":           ("RW",  89),
    "lautaro martinez":         ("ST",  87),
    "rodrigo de paul":          ("CM",  85),
    "emiliano martinez":        ("GK",  86),
    "nahuel molina":            ("RB",  82),
    "nicolas otamendi":         ("CB",  85),
    "cristian romero":          ("CB",  85),

    # ─── Germany / West Germany ───
    "franz beckenbauer":        ("CB",  96),
    "sepp maier":               ("GK",  90),
    "gerd muller":              ("ST",  95),
    "uwe seeler":               ("ST",  90),
    "wolfgang overath":         ("CM",  88),
    "berti vogts":              ("RB",  87),
    "paul breitner":            ("LB",  89),
    "rainer bonhof":            ("CM",  86),
    "karl-heinz rummenigge":    ("ST",  93),
    "klaus allofs":             ("ST",  86),
    "harald schumacher":        ("GK",  88),
    "andreas brehme":           ("LB",  89),
    "lothar matthaus":          ("CM",  93),
    "rudi voller":              ("ST",  90),
    "jurgen klinsmann":         ("ST",  92),
    "jurgen kohler":             ("CB",  88),
    "thomas hassler":            ("CAM", 87),
    "stefan effenberg":          ("CM",  89),
    "oliver kahn":               ("GK",  93),
    "michael ballack":           ("CAM", 91),
    "miroslav klose":            ("ST",  90),
    "philipp lahm":              ("RB",  92),
    "bastian schweinsteiger":   ("CM",  91),
    "lukas podolski":            ("LW",  86),
    "manuel neuer":              ("GK",  93),
    "mesut ozil":                ("CAM", 89),
    "toni kroos":                ("CM",  91),
    "thomas muller":             ("CAM", 89),
    "mats hummels":              ("CB",  88),
    "jerome boateng":            ("CB",  88),
    "andre schurrle":            ("LW",  84),
    "marco reus":                ("CAM", 87),
    "kai havertz":               ("CAM", 86),
    "joshua kimmich":            ("CDM", 89),
    "leon goretzka":             ("CM",  85),

    # ─── Italy ───
    "dino zoff":                ("GK",  92),
    "claudio gentile":           ("CB",  88),
    "marco tardelli":            ("CM",  90),
    "paolo rossi":               ("ST",  91),
    "bruno conti":               ("RW",  89),
    "alessandro altobelli":     ("ST",  87),
    "giuseppe bergomi":          ("CB",  89),
    "giancarlo antognoni":       ("CAM", 88),
    "franco baresi":             ("CB",  94),
    "paolo maldini":             ("LB",  94),
    "roberto baggio":            ("CAM", 95),
    "salvatore schillaci":      ("ST",  88),
    "walter zenga":              ("GK",  89),
    "alessandro del piero":     ("CAM", 91),
    "christian vieri":           ("ST",  89),
    "filippo inzaghi":           ("ST",  88),
    "gianluca zambrotta":       ("RB",  87),
    "fabio cannavaro":           ("CB",  92),
    "alessandro nesta":          ("CB",  92),
    "andrea pirlo":              ("CM",  92),
    "gennaro gattuso":           ("CDM", 87),
    "francesco totti":           ("CAM", 92),
    "luca toni":                 ("ST",  86),
    "gianluigi buffon":          ("GK",  93),
    "leonardo bonucci":          ("CB",  88),
    "giorgio chiellini":         ("CB",  89),

    # ─── Spain ───
    "luis arconada":             ("GK",  87),
    "rafael gordillo":           ("LB",  86),
    "andoni zubizarreta":        ("GK",  89),
    "fernando hierro":           ("CB",  90),
    "raul gonzalez":             ("ST",  92),
    "raul":                      ("ST",  92),
    "iker casillas":             ("GK",  92),
    "carles puyol":              ("CB",  90),
    "xavi hernandez":            ("CM",  93),
    "xavi":                      ("CM",  93),
    "andres iniesta":            ("CM",  93),
    "sergio busquets":           ("CDM", 89),
    "david villa":               ("ST",  90),
    "fernando torres":           ("ST",  90),
    "sergio ramos":              ("CB",  91),
    "gerard pique":              ("CB",  89),
    "jordi alba":                ("LB",  87),
    "david silva":               ("CAM", 89),
    "cesc fabregas":             ("CM",  88),
    "alvaro morata":             ("ST",  85),
    "thiago alcantara":          ("CM",  86),
    "diego costa":                ("ST",  87),

    # ─── France ───
    "michel platini":            ("CAM", 95),
    "alain giresse":             ("CM",  89),
    "jean tigana":                ("CM",  89),
    "luis fernandez":             ("CDM", 86),
    "marius tresor":              ("CB",  86),
    "didier deschamps":           ("CDM", 89),
    "marcel desailly":            ("CB",  91),
    "laurent blanc":              ("CB",  89),
    "lilian thuram":              ("RB",  90),
    "fabien barthez":             ("GK",  89),
    "youri djorkaeff":            ("CAM", 88),
    "zinedine zidane":            ("CAM", 95),
    "thierry henry":              ("ST",  94),
    "patrick vieira":             ("CM",  91),
    "robert pires":               ("LW",  89),
    "david trezeguet":            ("ST",  88),
    "claude makelele":            ("CDM", 89),
    "franck ribery":              ("LW",  89),
    "karim benzema":              ("ST",  91),
    "hugo lloris":                ("GK",  88),
    "raphael varane":              ("CB",  89),
    "paul pogba":                 ("CM",  89),
    "ngolo kante":                ("CDM", 89),
    "blaise matuidi":              ("CM",  85),
    "antoine griezmann":           ("CAM", 91),
    "kylian mbappe":               ("ST",  95),
    "olivier giroud":              ("ST",  87),
    "ousmane dembele":             ("RW",  86),

    # ─── England ───
    "bobby moore":                 ("CB",  94),
    "bobby charlton":              ("CAM", 94),
    "gordon banks":                ("GK",  93),
    "geoff hurst":                 ("ST",  91),
    "alan ball":                   ("CM",  88),
    "nobby stiles":                ("CDM", 86),
    "kevin keegan":                ("ST",  90),
    "peter shilton":               ("GK",  91),
    "bryan robson":                ("CM",  89),
    "gary lineker":                ("ST",  91),
    "paul gascoigne":              ("CAM", 90),
    "stuart pearce":               ("LB",  87),
    "david seaman":                ("GK",  89),
    "alan shearer":                ("ST",  91),
    "tony adams":                  ("CB",  88),
    "david beckham":               ("RW",  91),
    "michael owen":                ("ST",  90),
    "steven gerrard":              ("CM",  92),
    "frank lampard":               ("CM",  91),
    "wayne rooney":                ("ST",  91),
    "rio ferdinand":                ("CB",  90),
    "john terry":                  ("CB",  90),
    "harry kane":                  ("ST",  91),
    "raheem sterling":              ("LW",  87),
    "jordan henderson":             ("CM",  84),
    "kyle walker":                  ("RB",  85),
    "jude bellingham":              ("CM",  90),
    "phil foden":                   ("CAM", 87),
    "bukayo saka":                  ("RW",  88),
    "marcus rashford":              ("LW",  86),

    # ─── Netherlands ───
    "ruud krol":                    ("LB",  89),
    "johan cruyff":                  ("CAM", 96),
    "johan neeskens":                ("CM",  91),
    "johnny rep":                    ("RW",  88),
    "rob rensenbrink":               ("LW",  89),
    "wim suurbier":                  ("RB",  85),
    "rudi krol":                     ("LB",  88),  # alt spelling
    "ruud gullit":                   ("CAM", 93),
    "marco van basten":              ("ST",  95),
    "frank rijkaard":                ("CDM", 91),
    "ronald koeman":                 ("CB",  90),
    "dennis bergkamp":               ("CAM", 92),
    "frank de boer":                 ("CB",  88),
    "ronald de boer":                ("CAM", 86),
    "patrick kluivert":              ("ST",  89),
    "edgar davids":                  ("CDM", 88),
    "clarence seedorf":              ("CM",  89),
    "edwin van der sar":             ("GK",  90),
    "ruud van nistelrooy":           ("ST",  91),
    "arjen robben":                  ("RW",  91),
    "wesley sneijder":               ("CAM", 89),
    "robin van persie":              ("ST",  91),
    "rafael van der vaart":          ("CAM", 87),
    "memphis depay":                 ("LW",  85),
    "virgil van dijk":               ("CB",  91),
    "frenkie de jong":               ("CM",  88),
    "matthijs de ligt":              ("CB",  86),
    "georginio wijnaldum":           ("CM",  86),

    # ─── Other notable WC stars ───
    "ferenc puskas":                 ("ST",  95),
    "nandor hidegkuti":              ("CAM", 91),
    "florian albert":                ("ST",  88),
    "lev yashin":                    ("GK",  94),
    "eusebio":                       ("ST",  94),
    "mario coluna":                  ("CM",  89),
    "george best":                   ("RW",  92),
    "pat jennings":                  ("GK",  89),
    "kenny dalglish":                ("ST",  90),
    "graeme souness":                ("CDM", 89),
    "dragan dzajic":                 ("LW",  90),
    "dragan stojkovic":              ("CAM", 91),
    "robert prosinecki":             ("CAM", 91),
    "dejan savicevic":               ("CAM", 90),
    "davor suker":                   ("ST",  90),
    "zvonimir boban":                ("CM",  89),
    "slaven bilic":                  ("CB",  86),
    "luka modric":                   ("CM",  92),
    "ivan rakitic":                  ("CM",  88),
    "mario mandzukic":               ("ST",  88),
    "ivan perisic":                  ("LW",  87),
    "marcelo brozovic":              ("CDM", 86),
    "dejan lovren":                  ("CB",  84),
    "domagoj vida":                  ("CB",  82),
    "hristo stoichkov":              ("ST",  94),
    "krasimir balakov":              ("CAM", 89),
    "yordan letchkov":               ("CAM", 88),
    "trifon ivanov":                 ("CB",  85),
    "gheorghe hagi":                 ("CAM", 93),
    "gheorghe popescu":              ("CB",  87),
    "florin raducioiu":              ("ST",  86),
    "marius lacatus":                ("RW",  87),
    "andrei medar":                  ("ST",  82),
    "andoni goikoetxea":             ("CB",  85),
    "michael laudrup":               ("CAM", 92),
    "brian laudrup":                 ("LW",  91),
    "peter schmeichel":              ("GK",  93),
    "rene higuita":                  ("GK",  86),
    "carlos valderrama":             ("CAM", 90),
    "freddy rincon":                 ("CM",  87),
    "faustino asprilla":             ("ST",  88),
    "ivan zamorano":                 ("ST",  90),
    "marcelo salas":                 ("ST",  89),
    "alexis sanchez":                ("RW",  88),
    "arturo vidal":                  ("CM",  88),
    "claudio bravo":                 ("GK",  86),
    "gary medel":                    ("CDM", 84),
    "diego forlan":                  ("ST",  89),
    "luis suarez":                   ("ST",  92),
    "edinson cavani":                ("ST",  89),
    "fernando muslera":              ("GK",  85),
    "diego godin":                   ("CB",  89),
    "luis figo":                     ("RW",  92),
    "rui costa":                     ("CAM", 90),
    "joao pinto":                    ("CAM", 86),
    "cristiano ronaldo":             ("RW",  95),
    "deco":                          ("CAM", 89),
    "ricardo carvalho":              ("CB",  88),
    "pepe":                          ("CB",  86),
    "joao felix":                    ("CAM", 84),
    "bernardo silva":                ("CAM", 88),
    "ruben dias":                    ("CB",  87),
    "bruno fernandes":               ("CAM", 88),
    "joao moutinho":                 ("CM",  85),
    "diogo jota":                    ("ST",  86),
    "didier drogba":                 ("ST",  90),
    "yaya toure":                    ("CM",  91),
    "kolo toure":                    ("CB",  85),
    "samuel etoo":                   ("ST",  91),
    "rigobert song":                 ("CB",  84),
    "geremi":                        ("CM",  82),
    "marc-vivien foe":               ("CDM", 84),
    "roger milla":                   ("ST",  88),
    "jay-jay okocha":                ("CAM", 90),
    "nwankwo kanu":                  ("ST",  87),
    "rashidi yekini":                ("ST",  85),
    "sunday oliseh":                 ("CDM", 84),
    "stephen keshi":                 ("CB",  84),
    "daniel amokachi":                ("ST",  83),
    "abedi pele":                    ("CAM", 91),
    "michael essien":                ("CM",  88),
    "stephen appiah":                ("CM",  85),
    "asamoah gyan":                  ("ST",  85),
    "sadio mane":                    ("LW",  91),
    "mohamed salah":                 ("RW",  91),
    "kalidou koulibaly":             ("CB",  87),
    "edouard mendy":                 ("GK",  84),
    "achraf hakimi":                 ("RB",  87),
    "youssef en-nesyri":             ("ST",  82),
    "hakim ziyech":                  ("CAM", 84),
    "yassine bounou":                ("GK",  83),
    "hugo sanchez":                  ("ST",  92),
    "rafael marquez":                ("CB",  88),
    "guillermo ochoa":               ("GK",  85),
    "javier hernandez":              ("ST",  84),
    "chicharito":                    ("ST",  84),
    "hirving lozano":                ("LW",  83),
    "tim cahill":                    ("CAM", 84),
    "mark schwarzer":                ("GK",  85),
    "harry kewell":                  ("LW",  85),
    "park ji-sung":                  ("CM",  86),
    "son heung-min":                 ("LW",  90),
    "ki sung-yueng":                 ("CM",  82),
    "cha bum-kun":                   ("RW",  87),
    "shinji kagawa":                 ("CAM", 84),
    "keisuke honda":                 ("CAM", 85),
    "shunsuke nakamura":             ("CAM", 85),
    "hidetoshi nakata":              ("CAM", 86),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    players = json.loads(WC_PLAYERS.read_text())
    print(f"Loaded {len(players)} WC players")
    print(f"Override table: {len(OVERRIDES)} entries")

    pos_changed, rating_changed, not_found = 0, 0, []
    applied = set()
    for p in players:
        key = norm(p["name"])
        if key not in OVERRIDES:
            continue
        applied.add(key)
        new_pos, new_rating = OVERRIDES[key]
        if p["position"] != new_pos:
            p["position"] = new_pos
            pos_changed += 1
        if p["prime_rating"] != new_rating:
            p["prime_rating"] = new_rating
            rating_changed += 1
    not_found = [k for k in OVERRIDES if k not in applied]

    print(f"\n  Position overrides applied: {pos_changed}")
    print(f"  Rating overrides applied:    {rating_changed}")
    print(f"  Entries in override table not found in WC roster: {len(not_found)}")
    if not_found:
        print("  (first 10):")
        for k in not_found[:10]:
            print(f"    {k}")

    if args.dry_run:
        print("\n--dry-run, not writing.")
        return 0

    WC_PLAYERS.write_text(json.dumps(players, indent=2, ensure_ascii=False) + "\n")
    print(f"\nWrote {len(players)} players to {WC_PLAYERS.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
