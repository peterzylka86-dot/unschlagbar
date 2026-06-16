/**
 * Promotion & relegation for Real mode — the German model, applied to every
 * real league that has a tier below it (Germany de1/de2, Italy it1/it2,
 * Spain es1/es2).
 *
 *   • Second tier: top 2 go up automatically; 3rd plays a two-legged playoff
 *     against the team 3rd-from-bottom of the tier above.
 *   • Top tier: bottom 2 go down automatically; 3rd-from-bottom plays that
 *     same playoff to survive.
 *
 * Single-tier real leagues (Premier League, Ligue 1, Eredivisie, Primeira,
 * Super League) have no tier in our data, so nobody moves — outcome "safe".
 *
 * Pure + deterministic (seeded). No Math.random / Date.
 */

export interface TierPair {
  country: string;
  top: string;
  second: string;
}

/** Real leagues that form a promotion ladder in our dataset. */
export const TIER_PAIRS: TierPair[] = [
  { country: "Germany", top: "de1", second: "de2" },
  { country: "Italy", top: "it1", second: "it2" },
  { country: "Spain", top: "es1", second: "es2" },
];

/** The league one tier UP from this slug (only for a second-tier league). */
export function leagueAbove(slug: string | null | undefined): string | null {
  return TIER_PAIRS.find((p) => p.second === slug)?.top ?? null;
}

/** The league one tier DOWN from this slug (only for a top-tier league). */
export function leagueBelow(slug: string | null | undefined): string | null {
  return TIER_PAIRS.find((p) => p.top === slug)?.second ?? null;
}

export type PromotionKind =
  | "promoted" // auto-up (2nd tier, 1st–2nd)
  | "promotion-playoff" // 2nd tier, 3rd — win the playoff to go up
  | "relegation-playoff" // top tier, 3rd-from-bottom — win to stay up
  | "relegated" // auto-down (top tier, bottom 2)
  | "safe";

/**
 * What a final league position means for promotion/relegation, given the
 * league's tier. Only fires when the relevant neighbouring tier exists.
 */
export function promotionOutcome(
  slug: string | null | undefined,
  finishPosition: number,
  leagueSize: number,
): PromotionKind {
  if (leagueAbove(slug)) {
    // Second tier — going up is on the table.
    if (finishPosition <= 2) return "promoted";
    if (finishPosition === 3) return "promotion-playoff";
    return "safe";
  }
  if (leagueBelow(slug)) {
    // Top tier — staying up is on the line.
    if (finishPosition >= leagueSize - 1) return "relegated"; // bottom 2
    if (finishPosition === leagueSize - 2) return "relegation-playoff"; // 3rd-from-bottom
    return "safe";
  }
  return "safe"; // single-tier league
}

/** True when the outcome must be decided by a two-legged playoff. */
export function isPlayoff(kind: PromotionKind): boolean {
  return kind === "promotion-playoff" || kind === "relegation-playoff";
}

// ── Two-legged playoff sim (deterministic) ──────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poisson(lambda: number, rand: () => number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  while (p > L) {
    k++;
    p *= rand();
  }
  return k - 1;
}
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface PlayoffResult {
  /** Leg 1 at home: [your goals, their goals]. */
  leg1: [number, number];
  /** Leg 2 away: [your goals, their goals]. */
  leg2: [number, number];
  aggUs: number;
  aggThem: number;
  /** True if you go up / stay up. */
  won: boolean;
}

/**
 * Two legs (home then away) between your XI and the playoff opponent, decided
 * on aggregate with a seeded coin-flip if level. Deterministic by `seed`.
 */
export function twoLegPlayoff(
  userStrength: number,
  oppStrength: number,
  seed: string,
): PlayoffResult {
  const rand = mulberry32(hashStr(seed));
  const leg = (homeAdv: number): [number, number] => {
    const diff = userStrength + homeAdv - oppStrength;
    const us = poisson(Math.max(0.2, 1.25 + diff * 0.07 + (rand() - 0.5) * 0.8), rand);
    const them = poisson(Math.max(0.15, 1.2 - diff * 0.05 + (rand() - 0.5) * 0.8), rand);
    return [us, them];
  };
  const leg1 = leg(3); // home
  const leg2 = leg(-3); // away
  const aggUs = leg1[0] + leg2[0];
  const aggThem = leg1[1] + leg2[1];
  let won = aggUs > aggThem;
  if (aggUs === aggThem) won = rand() < 0.5 + Math.max(-0.2, Math.min(0.2, (userStrength - oppStrength) * 0.02));
  return { leg1, leg2, aggUs, aggThem, won };
}
