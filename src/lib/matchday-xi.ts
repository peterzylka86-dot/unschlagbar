/**
 * Matchday XI selection — squad-of-14 benching for GOLAZO Career.
 *
 * Design: the squad carries up to 14 players; exactly 11 start each
 * matchday in the career formation. Selection is stored as player KEYS
 * (`club:name`) so it survives squad-array reordering from swaps.
 *
 * Auto-pick: greedy formation fill by effective rating (prime + form),
 * strict position compatibility (same rules as the recap pitch — no
 * "ST in an LB slot" inventions). If the squad can't fill a slot, it
 * stays empty and squadRating's missing-player penalty applies — the
 * honest picture.
 *
 * Form is the strategic layer: a 🔥 hot bench player can out-rate a
 * ❄️ cold starter, so rotation becomes a real decision, not busywork.
 */
import type { Player, Slot } from "./game-types";
import { FORMATIONS } from "./formations";
import type { FormationKey } from "./game-types";
import { playerFitsSlot } from "./draft-helpers";
import { normalizeName } from "./career-core";

export const MATCHDAY_XI_SIZE = 11;

export function playerKey(p: Player): string {
  return `${p.club}:${p.name}`;
}

/** Form lookup key used by the career form map (club:normalized-name). */
export function formKey(p: Player): string {
  return `${p.club}:${normalizeName(p.name)}`;
}

/** Effective rating for selection purposes: prime rating + form (±2). */
export function effectiveRating(p: Player, form: Record<string, number>): number {
  return p.prime_rating + (form[formKey(p)] ?? 0);
}

/** Greedy auto-pick: fill the formation's slots best-effective-rating
 *  first, strict position compatibility. Returns the selected keys in
 *  squad order (NOT slot order — the caller maps to slots for display). */
export function autoPickXI(
  squad: Player[],
  formation: FormationKey,
  form: Record<string, number> = {},
  /** Optional selection strategy — score each player; highest fills slots
   *  first. Defaults to effective rating ("best XI"). Drives Rotate / Youth. */
  scoreFn?: (p: Player) => number,
): string[] {
  const score = scoreFn ?? ((p: Player) => effectiveRating(p, form));
  const slots = FORMATIONS[formation].slots.map((s) => ({ ...s }));
  const assigned: (Player | null)[] = slots.map(() => null);
  const sorted = [...squad].sort((a, b) => score(b) - score(a));
  for (const p of sorted) {
    for (let i = 0; i < slots.length; i++) {
      if (assigned[i]) continue;
      if (playerFitsSlot(slots[i].position, p)) {
        assigned[i] = p;
        break;
      }
    }
  }
  return assigned.filter((p): p is Player => p !== null).map(playerKey);
}

/** Resolve a stored XI-key selection against the live squad. Drops keys
 *  whose player left (swaps), fills gaps via auto-pick on the remaining
 *  bench. Always returns ≤ 11 valid keys. */
export function resolveXI(
  squad: Player[],
  storedKeys: string[] | null | undefined,
  formation: FormationKey,
  form: Record<string, number> = {},
): string[] {
  const squadKeys = new Set(squad.map(playerKey));
  const valid = (storedKeys ?? []).filter((k) => squadKeys.has(k));
  if (valid.length >= Math.min(MATCHDAY_XI_SIZE, squad.length)) {
    return valid.slice(0, MATCHDAY_XI_SIZE);
  }
  // Holes — refill. Keep the still-valid picks; auto-pick the rest from
  // players not already selected.
  const selectedSet = new Set(valid);
  const bench = squad.filter((p) => !selectedSet.has(playerKey(p)));
  const need = Math.min(MATCHDAY_XI_SIZE, squad.length) - valid.length;
  // Which formation slots are still open? Re-derive by assigning current
  // picks to slots first, then auto-pick fills what's left.
  const slots = FORMATIONS[formation].slots.map((s) => ({ ...s }));
  const taken: boolean[] = slots.map(() => false);
  const byKey = new Map(squad.map((p) => [playerKey(p), p]));
  for (const k of valid) {
    const p = byKey.get(k);
    if (!p) continue;
    for (let i = 0; i < slots.length; i++) {
      if (taken[i]) continue;
      if (playerFitsSlot(slots[i].position, p)) {
        taken[i] = true;
        break;
      }
    }
  }
  const sortedBench = [...bench].sort(
    (a, b) => effectiveRating(b, form) - effectiveRating(a, form),
  );
  const fills: string[] = [];
  for (const p of sortedBench) {
    if (fills.length >= need) break;
    for (let i = 0; i < slots.length; i++) {
      if (taken[i]) continue;
      if (playerFitsSlot(slots[i].position, p)) {
        taken[i] = true;
        fills.push(playerKey(p));
        break;
      }
    }
  }
  return [...valid, ...fills];
}

/** Can `incoming` (bench) replace `outgoing` (starter) given the
 *  formation? True if the XI-minus-outgoing-plus-incoming can still
 *  fill at least as many formation slots. Cheap check: incoming must
 *  fit SOME slot that the rest of the XI (minus outgoing) leaves open. */
export function canSwapIntoXI(
  squad: Player[],
  xiKeys: string[],
  outgoingKey: string,
  incomingKey: string,
  formation: FormationKey,
): boolean {
  if (!xiKeys.includes(outgoingKey)) return false;
  if (xiKeys.includes(incomingKey)) return false;
  const byKey = new Map(squad.map((p) => [playerKey(p), p]));
  const incoming = byKey.get(incomingKey);
  if (!incoming) return false;
  const nextKeys = xiKeys.filter((k) => k !== outgoingKey).concat(incomingKey);
  // Greedy-assign the candidate XI to formation slots; valid if we can
  // place everyone (i.e., no one is left slotless).
  const slots = FORMATIONS[formation].slots.map((s) => ({ ...s }));
  const players = nextKeys
    .map((k) => byKey.get(k))
    .filter((p): p is Player => !!p)
    // Most-constrained first: players with the fewest compatible slots
    // get placed before flexible ones, avoiding false negatives.
    .sort(
      (a, b) =>
        slots.filter((s) => playerFitsSlot(s.position, a)).length -
        slots.filter((s) => playerFitsSlot(s.position, b)).length,
    );
  const taken: boolean[] = slots.map(() => false);
  for (const p of players) {
    let placed = false;
    for (let i = 0; i < slots.length; i++) {
      if (taken[i]) continue;
      if (playerFitsSlot(slots[i].position, p)) {
        taken[i] = true;
        placed = true;
        break;
      }
    }
    if (!placed) return false;
  }
  return true;
}

/** XI as Slot[] for squadRating + scorer picking. Slot-assigns the
 *  selected players to the formation (strict), leaving incompatible
 *  overflow OUT (squadRating then penalizes the empty slots). */
export function xiToSlots(
  squad: Player[],
  xiKeys: string[],
  formation: FormationKey,
): Slot[] {
  const byKey = new Map(squad.map((p) => [playerKey(p), p]));
  const slots = FORMATIONS[formation].slots.map((s) => ({ ...s }));
  const players = xiKeys
    .map((k) => byKey.get(k))
    .filter((p): p is Player => !!p)
    .sort(
      (a, b) =>
        slots.filter((s) => playerFitsSlot(s.position, a)).length -
        slots.filter((s) => playerFitsSlot(s.position, b)).length,
    );
  const assigned: (Player | undefined)[] = slots.map(() => undefined);
  for (const p of players) {
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
