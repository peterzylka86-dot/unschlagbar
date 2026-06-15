/**
 * European competitions — the continental layer for Real mode. Your league
 * finish qualifies you for one of three knockouts against the strongest
 * clubs across ALL leagues, with prize money that feeds the club balance.
 *
 *   Champions League (UCL) — top 4 finish, 16-club field, richest.
 *   Europa League (UEL)    — 5th–6th, 16-club field.
 *   Conference League (UECL) — 7th, 8-club field.
 *
 * Pure + deterministic helpers; the route plays the bracket with the
 * existing match sim. (v1 is a straight knockout — the 36-team UCL
 * "league phase" is a future refinement.)
 */
import type { RealClub } from "./real-data";
import { REAL_CLUBS } from "./real-data";

export type EuroComp = "ucl" | "el" | "ecl";

export interface EuroMeta {
  id: EuroComp;
  name: string;
  short: string;
  icon: string;
  field: number;
}

export const EURO_META: Record<EuroComp, EuroMeta> = {
  // UCL uses the 36-team league phase (then a 16-team knockout); Europa /
  // Conference are straight knockouts.
  ucl: { id: "ucl", name: "Champions League", short: "UCL", icon: "🏆", field: 36 },
  el: { id: "el", name: "Europa League", short: "UEL", icon: "🌟", field: 16 },
  ecl: { id: "ecl", name: "Conference League", short: "UECL", icon: "🛡️", field: 8 },
};

/** UCL league-phase shape: 36 clubs, 8 games each, one combined table. */
export const LEAGUE_PHASE_GAMES = 8;
/** Top 8 go straight to the R16; 9–24 into a knockout playoff; 25+ out. */
export const LEAGUE_PHASE_KNOCKOUT_FIELD = 16;

/** Which European competition a league finish earns (null = none). */
export function qualifyEurope(finishPosition: number): EuroComp | null {
  if (finishPosition <= 4) return "ucl";
  if (finishPosition <= 6) return "el";
  if (finishPosition === 7) return "ecl";
  return null;
}

export type EuroRound = "r16" | "qf" | "sf" | "final" | "champion" | "out";

/** Prize money (€M) for how far you went — scaled by competition prestige
 *  plus a participation fee just for being there. */
export function europePrize(comp: EuroComp, reached: EuroRound): number {
  const mult = comp === "ucl" ? 1 : comp === "el" ? 0.55 : 0.3;
  const ladder: Record<EuroRound, number> = {
    out: 0,
    r16: 20,
    qf: 35,
    sf: 55,
    final: 80,
    champion: 130,
  };
  const participation = comp === "ucl" ? 25 : comp === "el" ? 12 : 6;
  return Math.round(ladder[reached] * mult) + participation;
}

/**
 * The competition field: the strongest clubs across every league, with the
 * user's club guaranteed a place (they qualified). Deterministic.
 */
export function europeField(comp: EuroComp, userClubId: string): RealClub[] {
  const n = EURO_META[comp].field;
  const sorted = [...REAL_CLUBS].sort((a, b) => b.strength - a.strength);
  const field = sorted.slice(0, n);
  if (!field.some((c) => c.id === userClubId)) {
    const user = REAL_CLUBS.find((c) => c.id === userClubId);
    if (user) field[n - 1] = user; // displace the weakest seed
  }
  return field;
}

/** Round labels for a field size (16 → R16…Final; 8 → QF…Final). */
export function euroRounds(field: number): EuroRound[] {
  return field >= 16 ? ["r16", "qf", "sf", "final"] : ["qf", "sf", "final"];
}

export const ROUND_LABEL: Record<EuroRound, string> = {
  r16: "Round of 16",
  qf: "Quarter-final",
  sf: "Semi-final",
  final: "Final",
  champion: "Champions",
  out: "Out",
};

// ─── UCL league phase ───────────────────────────────────────────────────

function lphash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface PhaseRow {
  id: string;
  pts: number;
  gd: number;
  pos: number;
}

/** A non-user club's league-phase points (over 8 games), derived from its
 *  strength + a seeded wobble. Deterministic. */
function clubPhasePoints(strength: number, seed: string): number {
  const base = (strength - 60) * 0.6; // ~3–19 across the strength range
  const jitter = (lphash(`pts-${seed}`) % 7) - 3; // -3..+3
  return Math.max(2, Math.min(22, Math.round(base + jitter)));
}

/**
 * Build the 36-club league-phase table. The user's row uses their real
 * points/GD from their 8 games; every other club is seeded deterministically
 * from strength. Sorted by points then goal difference, with positions.
 */
export function leaguePhaseStandings(
  field: { id: string; strength: number }[],
  userId: string,
  userPts: number,
  userGd: number,
  seedNum: number,
): PhaseRow[] {
  const rows = field.map((c) => {
    if (c.id === userId) return { id: c.id, pts: userPts, gd: userGd, pos: 0 };
    const pts = clubPhasePoints(c.strength, `${seedNum}-${c.id}`);
    const gd = Math.round((pts - 12) * 0.8) + ((lphash(`gd-${seedNum}-${c.id}`) % 5) - 2);
    return { id: c.id, pts, gd, pos: 0 };
  });
  rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || a.id.localeCompare(b.id));
  rows.forEach((r, i) => (r.pos = i + 1));
  return rows;
}

export type UclCut = "r16" | "playoff" | "out";

/** Where a league-phase finish lands you: 1–8 direct R16, 9–24 playoff, out. */
export function uclCut(pos: number): UclCut {
  if (pos <= 8) return "r16";
  if (pos <= 24) return "playoff";
  return "out";
}
