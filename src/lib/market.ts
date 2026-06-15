/**
 * Real-mode transfer market economics — fees, sell values, and the
 * window budget. Pure + deterministic so the same player always costs the
 * same and a window can be reasoned about/tested without rendering.
 *
 * Fees are in abstract "M" (millions). The curve is steep at the top end
 * (a 90 costs many multiples of a 75) and pays a youth premium, so signing
 * a peak superstar genuinely strains a budget while squad players are cheap.
 */

/** Transfer fee to BUY a player, from rating + age. */
export function playerFee(rating: number, age: number): number {
  const base = Math.pow(Math.max(0.5, (rating - 58) / 4), 2.4);
  const ageMult = age <= 23 ? 1.2 : age <= 29 ? 1.0 : age <= 32 ? 0.6 : 0.35;
  return Math.max(1, Math.round(base * ageMult));
}

/** What you receive SELLING one of yours — a notch under market. */
export function sellValue(rating: number, age: number): number {
  return Math.max(1, Math.round(playerFee(rating, age) * 0.9));
}

/**
 * The window's transfer budget: club wealth (bigger clubs are richer) plus
 * prize money for the league finish. Fresh each window — no banking, to
 * keep the decision contained.
 */
export function seasonTransferBudget(
  clubStrength: number,
  leagueSize: number,
  finishPosition: number,
): number {
  const wealth = Math.max(10, Math.round((clubStrength - 58) * 6));
  const prize = Math.max(0, (leagueSize - Math.max(1, finishPosition)) * 4);
  return wealth + prize;
}

/** Short "€42M" style label. */
export function feeLabel(m: number): string {
  return `€${m}M`;
}
