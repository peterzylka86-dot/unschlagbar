/**
 * Pure draft-time helpers — extracted from the React draft route so they
 * can be unit-tested without rendering. The React layer wraps these with
 * useEffect + Zustand store dispatches.
 */
import type { Player, Position, Slot } from "./game-types";

/** Default position compatibility — same-slot-position-as-player. The
 *  draft route allows callers to inject a custom check, but the natural
 *  default for unschlagbar is strict equality. */
export function isPositionMatch(slotPos: Position, playerPos: Position): boolean {
  return slotPos === playerPos;
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
  isCompatible: (slotPos: Position, playerPos: Position) => boolean = isPositionMatch,
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
    s => !s.player && isCompatible(s.position, foundingPlayer.position),
  );
  if (idx === -1) {
    return {
      slots,
      placedSlotId: null,
      placedPlayerKey: null,
      placedClubId: null,
    };
  }
  const newSlots = slots.map((s, i) =>
    i === idx ? { ...s, player: foundingPlayer } : s,
  );
  return {
    slots: newSlots,
    placedSlotId: slots[idx].id,
    placedPlayerKey: `${foundingPlayer.club}:${foundingPlayer.name}`,
    placedClubId: foundingPlayer.club,
  };
}
