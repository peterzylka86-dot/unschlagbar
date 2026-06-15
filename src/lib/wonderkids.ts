/**
 * Wonderkid legends — the CM "unearth a gem" loop, recast for our legends
 * roster. You don't gamble on a hidden number; you gamble on HISTORY. A
 * 17-year-old Pelé arrives rated ~61 and, if you actually play him, climbs
 * toward his real 96 prime over ~5 seasons. Miss him in the lottery and a
 * rival may sign him — gone for the rest of the career.
 *
 * Tuning is grounded in CM/FM design wisdom (CA/PA model, age curve,
 * minutes-driven growth, deliberate scarcity) — see the deep-research
 * synthesis. Everything here is PURE + DETERMINISTIC (seeded, no
 * Math.random, no Date), the same contract as sim.ts / management.ts, so a
 * career's lottery and growth replay identically on every render + resume.
 */
import iconsData from "@/data/wonderkids.json";

export interface WonderkidIcon {
  id: string;
  name: string;
  position: string;
  altPositions?: string[];
  nationality: string;
  historicClub: string;
  /** The legend's known peak on our 60-99 scale — the growth ceiling. */
  prime: number;
}

export const WONDERKID_ICONS: WonderkidIcon[] = (iconsData as { icons: WonderkidIcon[] }).icons;

// ─── Tuning constants (from the CM/FM research synthesis) ────────────────

/** A prospect debuts at ~64% of the legend's prime → a felt ~35pt climb. */
export const WK_START_PCT = 0.64;
/** Debut age for a freshly-signed prospect. */
export const WK_START_AGE = 17;
/** First-team minutes are the No.1 lever. Growth per season, by role: */
export const WK_GROWTH_STARTER = 7; // ≥70% of matchdays started
export const WK_GROWTH_ROTATION = 4; // 40–70%
export const WK_GROWTH_BENCH = 1; // <40% — barely develops
/** Decline: legends age slower than generics (elite mentals). */
export const WK_DECLINE_START_AGE = 30;
export const WK_RATING_FLOOR = 70;
/** Per-season lottery: chance an ICON (vs nothing special) surfaces. */
export const WK_ICON_DROP_RATE = 0.1;
/** Chance a rival signs an unclaimed icon in a season you didn't land one. */
export const WK_RIVAL_CLAIM_RATE = 0.33;

/** Starting rating for a freshly-signed prospect. */
export function youngRating(icon: WonderkidIcon): number {
  return Math.round(icon.prime * WK_START_PCT);
}

// ─── Deterministic hash (self-contained; xmur3-style) ────────────────────
function hash(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
/** Deterministic float in [0,1) from a string seed. */
function rand01(seed: string): number {
  return hash(seed) / 4294967296;
}

// ─── Development curve ───────────────────────────────────────────────────

export type GrowthTier = "starter" | "rotation" | "bench";

/** Classify a season's involvement into a growth tier from matchdays started. */
export function growthTier(matchdaysStarted: number, totalMatchdays: number): GrowthTier {
  const frac = totalMatchdays > 0 ? matchdaysStarted / totalMatchdays : 0;
  if (frac >= 0.7) return "starter";
  if (frac >= 0.4) return "rotation";
  return "bench";
}

/**
 * One season of growth for a prospect. Grows by the tier base ±1 (seeded
 * variance so two identical legends don't track identically), never above
 * the legend's prime. `seed` should be unique per (player, season).
 */
export function growStep(current: number, prime: number, tier: GrowthTier, seed: string): number {
  if (current >= prime) return prime;
  const base =
    tier === "starter" ? WK_GROWTH_STARTER : tier === "rotation" ? WK_GROWTH_ROTATION : WK_GROWTH_BENCH;
  const variance = (hash(`grow-${seed}`) % 3) - 1; // -1 | 0 | +1
  const next = current + Math.max(0, base + variance);
  return Math.min(prime, next);
}

/**
 * One season of decline for an ageing player. No drop before 30; −2/yr to
 * 32, −3/yr from 33; floored. `seed` unique per (player, season).
 */
export function declineStep(current: number, age: number, seed: string): number {
  if (age < WK_DECLINE_START_AGE) return current;
  const base = age <= 32 ? 2 : 3;
  const variance = hash(`decl-${seed}`) % 2; // 0 | 1 (occasionally bites harder)
  return Math.max(WK_RATING_FLOOR, current - (base + variance));
}

// ─── Lottery + scarcity (one finite pool, contested by rivals) ───────────

/** Icons still available this career (not yet claimed by you or a rival). */
export function unclaimedIcons(claimedIds: string[]): WonderkidIcon[] {
  const claimed = new Set(claimedIds);
  return WONDERKID_ICONS.filter((i) => !claimed.has(i.id));
}

/**
 * The season's lottery result for the player: an icon surfaces ~10% of
 * seasons (drawn deterministically from the unclaimed pool), else null
 * ("scouts turned up nothing special this window"). Pure in
 * (careerSeed, season, claimedIds).
 */
export function seasonLottery(careerSeed: string, season: number, claimedIds: string[]): WonderkidIcon | null {
  const pool = unclaimedIcons(claimedIds);
  if (pool.length === 0) return null;
  if (rand01(`wk-draw-${careerSeed}-${season}`) >= WK_ICON_DROP_RATE) return null;
  const idx = hash(`wk-pick-${careerSeed}-${season}`) % pool.length;
  return pool[idx];
}

/**
 * A rival's grab: in a season where YOU didn't land an icon, a rival may
 * sign one from the unclaimed pool (~33%), removing it for the rest of the
 * career — the FOMO engine. Pure in (careerSeed, season, claimedIds).
 * `playerGot` = the icon you claimed this season (so we don't double-draw it).
 */
export function rivalClaim(
  careerSeed: string,
  season: number,
  claimedIds: string[],
  playerGot: WonderkidIcon | null,
): WonderkidIcon | null {
  if (playerGot) return null; // you got this season's icon; rivals miss out
  const pool = unclaimedIcons(claimedIds);
  if (pool.length === 0) return null;
  if (rand01(`wk-rival-${careerSeed}-${season}`) >= WK_RIVAL_CLAIM_RATE) return null;
  const idx = hash(`wk-rival-pick-${careerSeed}-${season}`) % pool.length;
  return pool[idx];
}

export function getIcon(id: string): WonderkidIcon | undefined {
  return WONDERKID_ICONS.find((i) => i.id === id);
}
