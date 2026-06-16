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

/**
 * Starting bank for a new Real-mode career. STEEP by club size so the gap is
 * realistic: a 2.-Bundesliga side (≈70) starts with low-double-digit millions
 * — nowhere near a superstar fee — while an elite club (≈92) has nine figures.
 * A small club must shop for POTENTIAL, not finished stars.
 *   strength 65 → ~€2M · 70 → ~€13M · 80 → ~€60M · 90 → ~€146M · 94 → ~€198M
 */
export function startingBalance(clubStrength: number): number {
  return Math.max(3, Math.round(Math.pow(Math.max(0, clubStrength - 60), 2.2) / 12));
}

/**
 * Prize money banked at a season's end. Deliberately MODEST — a TV share that
 * scales with club size (small clubs earn little), plus place money and
 * trophy bonuses. Tuned so a season's reward buys a prospect or two, never a
 * finished superstar — the bank should feel tight for a small club.
 */
export function prizeMoney(opts: {
  finishPosition: number;
  leagueSize: number;
  champion: boolean;
  cupResult: "champion" | "runner-up" | "semi-final" | "quarter-final" | "did-not-qualify";
  /** Club tier proxy — bigger clubs draw bigger TV money. Default mid. */
  clubStrength?: number;
}): number {
  const tv = Math.max(2, Math.round(((opts.clubStrength ?? 72) - 58) * 0.7));
  const place = Math.round(Math.max(0, opts.leagueSize - opts.finishPosition) * 0.6);
  const title = opts.champion ? 10 : 0;
  const cup =
    opts.cupResult === "champion"
      ? 12
      : opts.cupResult === "runner-up"
        ? 6
        : opts.cupResult === "semi-final"
          ? 3
          : opts.cupResult === "quarter-final"
            ? 1
            : 0;
  return tv + place + title + cup;
}
