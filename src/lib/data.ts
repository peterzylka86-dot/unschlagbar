import { z } from "zod";
import type { Club, Player } from "./game-types";
import type { LeagueId } from "./leagues";

import bundesligaClubs from "@/data/bundesliga/clubs.json";
import bundesligaPlayers from "@/data/bundesliga/players.json";
import laligaClubs from "@/data/laliga/clubs.json";
import laligaPlayers from "@/data/laliga/players.json";
import serieaClubs from "@/data/seriea/clubs.json";
import serieaPlayers from "@/data/seriea/players.json";
import swissClubs from "@/data/swiss/clubs.json";
import swissPlayers from "@/data/swiss/players.json";
import uclClubs from "@/data/ucl/clubs.json";
import uclPlayers from "@/data/ucl/players.json";
import wcClubs from "@/data/worldcup/clubs.json";
import wcPlayers from "@/data/worldcup/players.json";
import wc2026Clubs from "@/data/worldcup2026/clubs.json";
import wc2026Players from "@/data/worldcup2026/players.json";
import womensClubs from "@/data/womens/clubs.json";
import womensPlayers from "@/data/womens/players.json";

// ─── Runtime schemas ────────────────────────────────────────────────────────
// Validate at load time so a malformed commit fails loudly instead of
// surfacing as an empty draft list or a NaN season result. In dev/test the
// validation throws; in prod we log and continue (a broken roster is worse
// than a degraded one for users).

const VALID_POSITIONS = ["GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "LW", "RW", "ST"] as const;

const playerSchema = z.object({
  name: z.string().min(1),
  position: z.enum(VALID_POSITIONS),
  prime_rating: z.number().int().min(40).max(99),
  career_years: z.string().min(1),
  nationality: z.string().min(1),
  club: z.string().min(1),
});

const clubSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    short: z.string().min(1),
    city: z.string().min(1),
    color: z.string().regex(/^#?[0-9a-fA-F]{3,8}$/, "expected hex color"),
    founded: z.number().int().min(1800).max(2030),
    strength: z.number().int().min(50).max(100),
  })
  .passthrough(); // tolerate extra optional fields (era, era_tier, era_tiers, etc.)

function validateLeague(
  league: string,
  rawClubs: unknown[],
  rawPlayers: unknown[],
): { clubs: Club[]; players: Player[] } {
  const clubResult = z.array(clubSchema).safeParse(rawClubs);
  const playerResult = z.array(playerSchema).safeParse(rawPlayers);
  if (!clubResult.success || !playerResult.success) {
    const issues = [
      ...(clubResult.success
        ? []
        : clubResult.error.issues
            .slice(0, 3)
            .map((i) => `clubs[${i.path.join(".")}]: ${i.message}`)),
      ...(playerResult.success
        ? []
        : playerResult.error.issues
            .slice(0, 3)
            .map((i) => `players[${i.path.join(".")}]: ${i.message}`)),
    ].join("\n  ");
    const msg = `[data] Validation failed for league '${league}':\n  ${issues}`;
    // In dev/test: throw so the regression is impossible to miss.
    // In prod: log + fall back to the raw data so users still play.
    if (import.meta.env?.DEV || import.meta.env?.MODE === "test") {
      throw new Error(msg);
    } else {
      console.error(msg);
    }
  }
  // Cross-club ref check: every player's club id should exist in clubs.json
  const clubIds = new Set((rawClubs as Club[]).map((c) => c.id));
  const orphans = (rawPlayers as Player[]).filter((p) => !clubIds.has(p.club));
  if (orphans.length > 0) {
    const sample = orphans
      .slice(0, 3)
      .map((o) => `${o.name} @ ${o.club}`)
      .join(", ");
    const msg = `[data] ${league}: ${orphans.length} players reference unknown club ids (e.g. ${sample})`;
    if (import.meta.env?.DEV || import.meta.env?.MODE === "test") {
      throw new Error(msg);
    } else {
      console.warn(msg);
    }
  }
  return { clubs: rawClubs as Club[], players: rawPlayers as Player[] };
}

const DATA: Record<LeagueId, { clubs: Club[]; players: Player[] }> = {
  bundesliga: validateLeague("bundesliga", bundesligaClubs, bundesligaPlayers),
  laliga: validateLeague("laliga", laligaClubs, laligaPlayers),
  seriea: validateLeague("seriea", serieaClubs, serieaPlayers),
  swiss: validateLeague("swiss", swissClubs, swissPlayers),
  ucl: validateLeague("ucl", uclClubs, uclPlayers),
  worldcup: validateLeague("worldcup", wcClubs, wcPlayers),
  worldcup2026: validateLeague("worldcup2026", wc2026Clubs, wc2026Players),
  womens: validateLeague("womens", womensClubs, womensPlayers),
};

export function getClubs(league: LeagueId): Club[] {
  return DATA[league].clubs;
}
export function getPlayers(league: LeagueId): Player[] {
  return DATA[league].players;
}
export function getLeagueData(league: LeagueId) {
  return DATA[league];
}

/**
 * Leagues that participate in the GOLAZO Career "super league" pool.
 *
 * Career mode treats the founding club as an *identity anchor* — what
 * shapes who you are. Everything downstream (the draft, AI rivals,
 * transfers) draws from the COMBINED pool of all top-tier club football
 * across these leagues. Picking GC doesn't trap you with only Swiss
 * players — the super-league fantasy says you can still build a dream
 * squad of global legends.
 *
 * `worldcup` / `worldcup2026` / `womens` are competition-specific (national
 * teams, not clubs) and stay out of the career meta-pool.
 */
export const CAREER_POOL_LEAGUES: LeagueId[] = ["ucl", "bundesliga", "laliga", "seriea", "swiss"];

let _careerClubsCache: Club[] | null = null;
let _careerPlayersCache: Player[] | null = null;

/** All clubs across CAREER_POOL_LEAGUES, deduped by club.id. Cached. */
export function getCareerClubs(): Club[] {
  if (_careerClubsCache) return _careerClubsCache;
  const seen = new Map<string, Club>();
  for (const lg of CAREER_POOL_LEAGUES) {
    for (const c of DATA[lg].clubs) {
      if (!seen.has(c.id)) seen.set(c.id, c);
    }
  }
  _careerClubsCache = Array.from(seen.values());
  return _careerClubsCache;
}

/** All players across CAREER_POOL_LEAGUES, deduped by `${club}:${name}`.
 *  Cached so the heavy concat-and-dedupe runs once per session. */
export function getCareerPlayers(): Player[] {
  if (_careerPlayersCache) return _careerPlayersCache;
  const seen = new Map<string, Player>();
  for (const lg of CAREER_POOL_LEAGUES) {
    for (const p of DATA[lg].players) {
      const k = `${p.club}:${p.name}`;
      if (!seen.has(k)) seen.set(k, p);
    }
  }
  _careerPlayersCache = Array.from(seen.values());
  return _careerPlayersCache;
}

// Exposed for tests
export const _schemas = { playerSchema, clubSchema };
