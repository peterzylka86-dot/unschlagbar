/**
 * Squad unrest & departures — the winter-window decision. Two triggers,
 * both reading the morale system that's already in:
 *
 *   • UNHAPPY  — a player whose morale has sunk (benched, sulking, a
 *                conversation gone wrong) wants out.
 *   • AMBITION — a star whose level outgrows the club agitates for a move
 *                to a bigger stage (his rating is well above your reputation).
 *
 * Pure + deterministic. At the winter window you decide per player: cash in
 * (a fee to the bank) or hold and hope the sulk passes.
 */
import { playerFee } from "./market";

export type UnrestReason = "unhappy" | "ambition";

/** Why a player wants out (or null if settled). Morale-driven unhappiness
 *  takes priority; otherwise a star above the club's level gets ambitious. */
export function unrestReason(
  rating: number,
  morale: number,
  yourReputation: number,
): UnrestReason | null {
  if (morale <= 28) return "unhappy";
  if (rating >= 86 && yourReputation < rating - 4) return "ambition";
  return null;
}

/** What a sale brings in. A coveted star (ambition) draws a premium offer
 *  from the bigger clubs chasing him; an unhappy player goes for market. */
export function departureFee(rating: number, age: number, reason: UnrestReason): number {
  const base = playerFee(rating, age);
  return Math.round(base * (reason === "ambition" ? 1.3 : 1.0));
}

export const UNREST_LABEL: Record<UnrestReason, string> = {
  unhappy: "Unhappy — wants away",
  ambition: "Wants a bigger stage",
};
