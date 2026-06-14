/**
 * Classic Squads — curated historical real-team recreations (Option B).
 *
 * A "classic" is a fixed, hand-curated real squad from a specific past
 * season (Arsenal Invincibles 03-04, Pep's Barça 09-10, Bochum 08-09).
 * Unlike the draft modes, you don't BUILD the XI — you inherit a real
 * one and try to better its real-life achievement.
 *
 * Prototype scope: a classic loads its XI into the single-match game
 * store and runs the existing /season simulation against its mapped
 * league's clubs. No new sim, no new data infra — proves the loop.
 * (Thematic caveat: Arsenal maps to laliga for now since we have no
 * standalone English top-flight; opponents are La Liga all-timers. A
 * real EPL league is a future addition.)
 */
import type { Player, FormationKey, Slot } from "./game-types";
import type { LeagueId } from "./leagues";
import { FORMATIONS } from "./formations";
import { playerFitsSlot } from "./draft-helpers";

import arsenal from "@/data/classics/arsenal-2003-04.json";
import barcelona from "@/data/classics/barcelona-2009-10.json";
import bochum from "@/data/classics/bochum-2008-09.json";

export interface ClassicSquad {
  slug: string;
  name: string;
  club: string;
  season: string;
  league: LeagueId;
  formation: FormationKey;
  manager: string;
  blurb: string;
  accent: string;
  players: Player[];
}

// Order = display order on the picker. Marquee first.
export const CLASSIC_SQUADS: ClassicSquad[] = [
  arsenal as ClassicSquad,
  barcelona as ClassicSquad,
  bochum as ClassicSquad,
];

export function getClassic(slug: string): ClassicSquad | undefined {
  return CLASSIC_SQUADS.find((c) => c.slug === slug);
}

/** Assign a classic squad's players into its formation's 11 slots,
 *  greedily best-rating-first with strict position compatibility (same
 *  rule as the recap pitch — no inventing an ST in an LB slot). Players
 *  beyond the 11 are bench and simply don't appear in the single-match
 *  /season sim. Returns the filled Slot[] ready for useGame.setSlots. */
export function classicToSlots(squad: ClassicSquad): Slot[] {
  const slots = FORMATIONS[squad.formation].slots.map((s) => ({ ...s }));
  const assigned: (Player | undefined)[] = slots.map(() => undefined);
  const sorted = [...squad.players].sort((a, b) => b.prime_rating - a.prime_rating);
  for (const p of sorted) {
    for (let i = 0; i < slots.length; i++) {
      if (assigned[i]) continue;
      if (playerFitsSlot(slots[i].position, p)) {
        assigned[i] = p;
        break;
      }
    }
  }
  return slots.map((s, i) => ({ ...s, player: assigned[i] }));
}
