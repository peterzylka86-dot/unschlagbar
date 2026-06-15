/**
 * Squad chemistry — a small XI rating bonus that rewards thematic squad-
 * building (a national-team spine, or a galáctico core). Pure + deterministic.
 *
 * It nudges the matchday rating a little, so "build a Brazilian dream team"
 * or "assemble the Galácticos" pays off on the pitch — the deck-building
 * layer for a draft/collection game, without changing the core sim.
 */
import type { Player } from "./game-types";

export interface Chemistry {
  bonus: number; // 0..3 added to the XI rating
  label: string; // short HUD note (empty when no chemistry)
}

/**
 * Chemistry from the starting XI:
 *   • National spine — the most-common nationality: 5+ → +1, 8+ → +2.
 *   • Galáctico core — count of 90+ rated stars: 4+ → +1.
 * Capped at +3 so it flavours, not dominates.
 */
export function squadChemistry(xi: Player[]): Chemistry {
  if (xi.length === 0) return { bonus: 0, label: "" };

  const byNat = new Map<string, number>();
  let galacticos = 0;
  for (const p of xi) {
    if (p.nationality) byNat.set(p.nationality, (byNat.get(p.nationality) ?? 0) + 1);
    if (p.prime_rating >= 90) galacticos++;
  }
  let topNat = "";
  let topCount = 0;
  for (const [nat, c] of byNat) {
    if (c > topCount) {
      topCount = c;
      topNat = nat;
    }
  }

  let bonus = 0;
  const reasons: string[] = [];
  if (topCount >= 8) {
    bonus += 2;
    reasons.push(`${topNat} core`);
  } else if (topCount >= 5) {
    bonus += 1;
    reasons.push(`${topNat} spine`);
  }
  if (galacticos >= 4) {
    bonus += 1;
    reasons.push("galácticos");
  }

  bonus = Math.min(3, bonus);
  return { bonus, label: bonus > 0 ? reasons.join(" · ") : "" };
}
