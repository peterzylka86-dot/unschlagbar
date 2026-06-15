#!/usr/bin/env python3
"""
Broaden position eligibility by adding footballially-defensible altPositions
to wide players, so the GOLAZO draft can always fill side-specific slots
(LB/RB/LW/RW) — especially in Real mode, where pools are thinner.

The position families in draft-helpers.ts keep LB/RB/LW/RW each STRICT
(playing a left-back at right-back is awkward in a way central-mid swaps
aren't). So the only way a left-back can cover a right-back / left-wing
SLOT is via explicit altPositions. Before this pass, only 1 of 7,454
players had any alts — which is why wing/full-back slots starved.

Rules (add only; never overwrite an existing alt; never touch the primary):
  LW -> RW              (inverted wingers switch flanks)
  RW -> LW
  LB -> RB, LW          (two-sided + attacking wing-backs)
  RB -> LB, RW

Deliberately NOT touched:
  - CB stays pure (a centre-half is not a full-back by default — blanket
    CB->FB would flood the back line unrealistically).
  - GK / ST / central mids (CDM/CM/CAM already interchange via family).

Idempotent: re-running makes no further changes.
"""
import json
import os

ADD = {
    "LW": ["RW"],
    "RW": ["LW"],
    "LB": ["RB", "LW"],
    "RB": ["LB", "RW"],
}

LEAGUES = ["ucl", "bundesliga", "laliga", "seriea", "swiss"]
ROOT = os.path.join(os.path.dirname(__file__), "..", "src", "data")


def main():
    total_changed = 0
    for lg in LEAGUES:
        path = os.path.join(ROOT, lg, "players.json")
        if not os.path.exists(path):
            continue
        players = json.load(open(path, encoding="utf-8"))
        changed = 0
        for p in players:
            pos = p.get("position")
            if pos not in ADD:
                continue
            existing = list(p.get("altPositions") or [])
            merged = list(existing)
            for a in ADD[pos]:
                if a != pos and a not in merged:
                    merged.append(a)
            if merged != existing:
                p["altPositions"] = merged
                changed += 1
        if changed:
            json.dump(players, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
            json.dump  # noqa
        print(f"{lg}: {changed} players gained altPositions")
        total_changed += changed
    print(f"TOTAL changed: {total_changed}")


if __name__ == "__main__":
    main()
