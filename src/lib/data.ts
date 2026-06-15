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
  altPositions: z.array(z.enum(VALID_POSITIONS)).optional(),
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

/**
 * Crème-de-la-crème threshold for the GOLAZO super pool.
 *
 * User feedback: "Pro Vercelli...no...but rather super teams." Anyone
 * who joins GOLAZO is here for the elite fantasy — they want to draft
 * Real Madrid · Bayern · Inter, not Frosinone or Pro Vercelli.
 *
 * Strength ≥ 80 keeps every realistic 'super club' across the leagues.
 * Reference points (see data.test.ts):
 *   UCL    — all 34 clubs (min strength 78–94)  → ~all in
 *   La Liga — Real Madrid (93), Barça (92), Atlético (87), Sevilla (82)
 *   Bundesliga — Bayern (92), Dortmund (86), Leipzig (85), Bayer (83)
 *   Serie A — Juventus (90), Milan (90), Inter (88), Roma (88), Napoli, Lazio
 *   Swiss — Basel (83), Young Boys (82)
 *
 * Always include the user's founding club regardless of strength — GC
 * (strength 76) is your identity anchor and round-1 pool, so it has to
 * survive the filter even when it's below the elite cut.
 */
export const SUPER_TEAM_STRENGTH = 80;

const _careerClubsCache = new Map<string, Club[]>(); // keyed by foundingClubId (or "")
const _careerPlayersCache = new Map<string, Player[]>();

/** Build the deduped super-set across CAREER_POOL_LEAGUES, no filter. */
function _allCareerClubs(): Club[] {
  const seen = new Map<string, Club>();
  for (const lg of CAREER_POOL_LEAGUES) {
    for (const c of DATA[lg].clubs) {
      if (!seen.has(c.id)) seen.set(c.id, c);
    }
  }
  return Array.from(seen.values());
}

/** Elite-only career pool clubs. Always includes the user's founding club. */
export function getCareerClubs(foundingClubId?: string | null): Club[] {
  const key = foundingClubId ?? "";
  const hit = _careerClubsCache.get(key);
  if (hit) return hit;
  const all = _allCareerClubs();
  const out = all.filter((c) => c.strength >= SUPER_TEAM_STRENGTH || c.id === foundingClubId);
  _careerClubsCache.set(key, out);
  return out;
}

/** Earliest end-year that counts a player as "current" for Real mode. */
export const CURRENT_MIN_END_YEAR = 2021;

/** True if a player is part of today's game — used by GOLAZO "real" mode.
 *  Reads the end of `career_years` ("2004-2018" → 2018; "2019-present" →
 *  current). Players with no parseable years are treated as not-current. */
export function isCurrentPlayer(p: Player): boolean {
  const s = p.career_years ?? "";
  if (/present|current|active/i.test(s)) return true;
  const years = s.match(/\d{4}/g);
  if (!years) return false;
  return Math.max(...years.map(Number)) >= CURRENT_MIN_END_YEAR;
}

/** Elite-only career pool players. Restricted to players whose club is in
 *  the filtered super-pool. The founding club's full roster stays available.
 *  `mode` "real" filters to today's players; "legends" is the full all-time
 *  pool (default). */
export function getCareerPlayers(
  foundingClubId?: string | null,
  mode: import("./game-types").CareerMode = "legends",
): Player[] {
  const key = `${foundingClubId ?? ""}|${mode}`;
  const hit = _careerPlayersCache.get(key);
  if (hit) return hit;
  const clubIds = new Set(getCareerClubs(foundingClubId).map((c) => c.id));
  const seen = new Map<string, Player>();
  for (const lg of CAREER_POOL_LEAGUES) {
    for (const p of DATA[lg].players) {
      if (!clubIds.has(p.club)) continue;
      if (mode === "real" && !isCurrentPlayer(p)) continue;
      const k = `${p.club}:${p.name}`;
      if (!seen.has(k)) seen.set(k, p);
    }
  }
  const out = Array.from(seen.values());
  _careerPlayersCache.set(key, out);
  return out;
}

// Exposed for tests
export const _schemas = { playerSchema, clubSchema };
