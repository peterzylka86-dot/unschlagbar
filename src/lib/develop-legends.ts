/**
 * "Develop the legends" — an opt-in flavour of the all-time-greats career.
 *
 * Normally a drafted legend arrives at his peak rating, frozen forever. With
 * this on, every legend you (and your rivals) draft instead joins as the
 * GREAT TALENT he once was: a teenager rated well below his peak, with that
 * peak as his growth ceiling. The season ageing system (which reads `age` +
 * `targetRating`/`potential`) then develops him toward it over the years —
 * play him and he blooms; bench him and he stalls. Raise a young Pelé into
 * the real thing.
 *
 * Pure + deterministic (seeded by name) — no Math.random / Date.
 */
import type { Player } from "./game-types";

/** How far below his peak a young legend starts. */
export const LEGEND_TALENT_DROP = 14;
/** No prospect starts below this — even a modest legend is a "great talent". */
export const LEGEND_TALENT_FLOOR = 70;

function fnv(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Turn a peak-rated legend into his developing-talent self. A no-op for a
 * player who already carries an `age` (a wonderkid, a carried-over prospect,
 * or a real player) — so it only ever fires on a freshly drafted timeless
 * legend, and re-running it across seasons never re-youths anyone.
 */
export function youthifyLegend(player: Player): Player {
  if (player.age != null) return player; // already young / aged / real — leave alone
  const peak = player.prime_rating;
  const start = Math.max(LEGEND_TALENT_FLOOR, Math.min(peak, peak - LEGEND_TALENT_DROP));
  const age = 16 + (fnv(`yl-${player.club}:${player.name}`) % 4); // 16..19
  return {
    ...player,
    prime_rating: start,
    age,
    targetRating: peak, // growth ceiling = his legendary peak
    potential: peak, // also drives the ↑ growth arrow in the squad UI
    career_years: "prospect",
  };
}
