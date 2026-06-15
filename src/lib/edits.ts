/**
 * User rating overrides — house-rule any player's overall. Edits live in the
 * career store (ratingEdits: playerKey → new overall) and are overlaid at
 * read time, so a tweaked rating shows up everywhere (squad, sim, market).
 * For aged (real) players the season-end tick bakes the edit into the
 * stored rating and clears it, keeping ageing consistent.
 */
import type { Player } from "./game-types";

/** Overlay rating edits onto a player list (returns new objects only where
 *  an edit exists; otherwise the original reference). */
export function applyRatingEdits(
  players: Player[],
  edits: Record<string, number>,
): Player[] {
  if (!edits || Object.keys(edits).length === 0) return players;
  return players.map((p) => {
    const e = edits[`${p.club}:${p.name}`];
    return e != null ? { ...p, prime_rating: e } : p;
  });
}

/** The effective overall for a single player after any edit. */
export function editedRating(p: Player, edits: Record<string, number>): number {
  return edits[`${p.club}:${p.name}`] ?? p.prime_rating;
}
