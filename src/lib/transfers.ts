/**
 * Transfer realism — signing a player isn't just "spend money". Two gates,
 * both driven by REPUTATION:
 *
 *   1. The selling club sets an asking price. A star at an elite club is
 *      near-priceless (Real won't sell Mbappé cheap); a squad player is cheap.
 *   2. The player must AGREE — which depends on your club's reputation vs his
 *      current club's. No Haaland will drop to Thun, no matter the money —
 *      until you've won the league + done damage in Europe and your
 *      reputation has climbed. A big club signs names easily but on a tighter
 *      budget.
 *
 * Pure + deterministic. Reputation grows with trophies, so small clubs have a
 * real progression: win, build prestige, attract better players.
 */
import { playerFee } from "./market";

/** Club reputation (~40–110): squad strength plus a bonus for silverware. */
export function clubReputation(
  clubStrength: number,
  leagueTitles: number,
  euroTitles: number,
): number {
  return Math.round(clubStrength + leagueTitles * 2 + euroTitles * 4);
}

/**
 * What the selling club demands. Base market fee, multiplied up steeply for
 * a strong player at a strong club (prising a star from an elite side costs
 * a fortune); ordinary players stay near their market value.
 */
export function askingPrice(rating: number, age: number, sellingClubStrength: number): number {
  const base = playerFee(rating, age);
  const premium =
    1 + Math.max(0, rating - 80) * 0.15 + Math.max(0, sellingClubStrength - 78) * 0.06;
  return Math.round(base * Math.min(5, premium));
}

/**
 * Will the player agree to join YOUR club? Stars demand near-equal prestige;
 * squad players are flexible. Your reputation must reach his demand (a step
 * down of ~6 is tolerated). Money can't fix a reputation gap for a star.
 */
export function playerWillJoin(
  yourReputation: number,
  sellingClubStrength: number,
  rating: number,
): boolean {
  const demand = sellingClubStrength + Math.max(0, rating - 80) * 0.6 - 6;
  return yourReputation >= demand;
}

export type SignStatus = "ok" | "cant-afford" | "wont-join" | "limit";

/** Combined verdict for a target: affordability + willingness + window cap. */
export function signStatus(opts: {
  rating: number;
  age: number;
  sellingClubStrength: number;
  yourReputation: number;
  remainingBudget: number;
  signingsLeft: number;
}): { status: SignStatus; price: number } {
  const price = askingPrice(opts.rating, opts.age, opts.sellingClubStrength);
  if (opts.signingsLeft <= 0) return { status: "limit", price };
  if (!playerWillJoin(opts.yourReputation, opts.sellingClubStrength, opts.rating))
    return { status: "wont-join", price };
  if (price > opts.remainingBudget) return { status: "cant-afford", price };
  return { status: "ok", price };
}

/** Signings allowed per transfer window. */
export const MAX_SIGNINGS_PER_WINDOW = 4;
