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

/** Coarse position area for the random draw, so a "surprise me" never hands
 *  you three of the same. */
function legendArea(position: string): string {
  const p = position.toUpperCase();
  if (p === "GK") return "GK";
  if (p === "CB" || p === "LB" || p === "RB" || p === "LWB" || p === "RWB") return "DEF";
  if (p === "CDM" || p === "DM" || p === "CM" || p === "LM" || p === "RM") return "MID";
  return "ATT"; // CAM / wingers / strikers
}

/**
 * Draw 3 legends for the Real-mode reinforcement "Surprise me" — one each
 * from 3 distinct position areas (so never a useless trio), randomly which
 * legend and which areas, but biased toward genuine greats (drawn from each
 * area's top tier). Deterministic by `seed`, so a reroll = a new seed and a
 * replay reproduces the same draw. Returns up to 3 players.
 */
export function pickRandomLegends(pool: Player[], seed: string, count = 3): Player[] {
  const byArea = new Map<string, Player[]>();
  for (const p of pool) {
    const a = legendArea(p.position);
    (byArea.get(a) ?? byArea.set(a, []).get(a)!).push(p);
  }
  // Seeded-shuffle the available areas, then take the first `count`.
  const areas = [...byArea.keys()].sort(
    (a, b) => (fnv(`area-${seed}-${a}`) % 1000) - (fnv(`area-${seed}-${b}`) % 1000),
  );
  const picked: Player[] = [];
  for (const area of areas) {
    if (picked.length >= count) break;
    const tier = [...byArea.get(area)!]
      .sort((a, b) => b.prime_rating - a.prime_rating)
      .slice(0, 24); // the area's elite — the fun is landing a real great
    if (tier.length === 0) continue;
    const idx = fnv(`leg-${seed}-${area}`) % tier.length;
    picked.push(tier[idx]);
  }
  return picked;
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
