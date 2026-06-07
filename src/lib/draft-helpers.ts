/**
 * Pure draft-time helpers — extracted from the React draft route so they
 * can be unit-tested without rendering. The React layer wraps these with
 * useEffect + Zustand store dispatches.
 */
import type { Player, Position, Slot } from "./game-types";

/** Strict same-position check. Kept for callers that explicitly want it. */
export function isPositionMatch(slotPos: Position, playerPos: Position): boolean {
  return slotPos === playerPos;
}

/**
 * Position families — positions in the same family share a slot in real
 * football. A CAM player slots into a CM role gracefully; a CDM into CM
 * the same. (Pep Guardiola playing as a CDM is the same player Andrés
 * Iniesta later played as CAM — central midfielders interchange.)
 *
 * Side-specific positions (LB/RB/LW/RW) stay in their own family because
 * playing a left-back at right-back is awkward in a way central-mid swaps
 * aren't.
 *
 * GK / CB / LB / RB / ST each have their own single-position family —
 * intentionally not lumped. A striker is not a wing-forward.
 */
export const POSITION_FAMILIES: ReadonlyArray<ReadonlyArray<Position>> = [
  ["GK"],
  ["CB"],
  ["LB"],
  ["RB"],
  ["CDM", "CM", "CAM"], // central midfielders — the user-requested cluster
  ["LW"],
  ["RW"],
  ["ST"],
];

/**
 * Slot-vs-player compatibility check that honors position families.
 *
 * Returns true if the slot's position is the same as the player's, OR
 * they're in the same family (e.g. CM slot + CAM player → true).
 *
 * Symmetric: isPositionCompatible(a, b) === isPositionCompatible(b, a).
 */
export function isPositionCompatible(slotPos: Position, playerPos: Position): boolean {
  if (slotPos === playerPos) return true;
  return POSITION_FAMILIES.some((family) => family.includes(slotPos) && family.includes(playerPos));
}

/** Result of attempting to place a founding player. */
export interface PlaceFoundingResult {
  /** New slots array (or the same reference if nothing was placed). */
  slots: Slot[];
  /** ID of the slot the player was placed into, or null if not placed. */
  placedSlotId: string | null;
  /** Composite key for the player-used set, or null if not placed.
   *  Format: `${club}:${name}` — matches the format draft.tsx uses for usedPlayers. */
  placedPlayerKey: string | null;
  /** Club id to mark as used so the wheel skips it next, or null. */
  placedClubId: string | null;
}

/**
 * Place the founding player (if any) into the first empty compatible slot.
 *
 * Behavior:
 *   - No founding player → returns input slots unchanged.
 *   - Founding player given but no compatible empty slot in the formation
 *     (e.g. user picked a CAM but the formation is 4-4-2 with no CAM) →
 *     returns input slots unchanged; caller should clear the founding
 *     player from state so it doesn't keep trying.
 *   - Compatible slot found → returns NEW slots array (input untouched)
 *     with the founding player placed in the first matching empty slot.
 *
 * Pure: never mutates the input slots array or its members.
 */
export function placeFoundingPlayer(
  slots: Slot[],
  foundingPlayer: Player | undefined,
  isCompatible: (slotPos: Position, playerPos: Position) => boolean = isPositionCompatible,
): PlaceFoundingResult {
  if (!foundingPlayer) {
    return {
      slots,
      placedSlotId: null,
      placedPlayerKey: null,
      placedClubId: null,
    };
  }
  const idx = slots.findIndex(
    (s) => !s.player && isCompatible(s.position, foundingPlayer.position),
  );
  if (idx === -1) {
    return {
      slots,
      placedSlotId: null,
      placedPlayerKey: null,
      placedClubId: null,
    };
  }
  const newSlots = slots.map((s, i) => (i === idx ? { ...s, player: foundingPlayer } : s));
  return {
    slots: newSlots,
    placedSlotId: slots[idx].id,
    placedPlayerKey: `${foundingPlayer.club}:${foundingPlayer.name}`,
    placedClubId: foundingPlayer.club,
  };
}
