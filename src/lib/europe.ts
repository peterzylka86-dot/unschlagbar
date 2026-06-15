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
  ucl: { id: "ucl", name: "Champions League", short: "UCL", icon: "🏆", field: 16 },
  el: { id: "el", name: "Europa League", short: "UEL", icon: "🌟", field: 16 },
  ecl: { id: "ecl", name: "Conference League", short: "UECL", icon: "🛡️", field: 8 },
};

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
