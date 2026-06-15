import type { Club, MatchResult, Slot } from "./game-types";

export function squadRating(slots: Slot[]): number {
  const rated = slots.filter((s) => s.player);
  if (!rated.length) return 0;
  const sum = rated.reduce((acc, s) => acc + (s.player?.prime_rating ?? 0), 0);
  const filled = rated.length;
  const penalty = (slots.length - filled) * 60;
  return Math.round((sum + penalty) / slots.length);
}

function rand(seed: { v: number }) {
  let x = seed.v | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  seed.v = x;
  return ((x >>> 0) % 10000) / 10000;
}

export function simulateSeason(
  opponents: Club[],
  totalMatches: number,
  ourRating: number,
  seedNum: number,
  difficulty: "easy" | "normal" | "hard" = "normal",
): MatchResult[] {
  const seed = { v: seedNum || 12345 };
  const matches: MatchResult[] = [];
  const order: Array<{ opp: Club; home: boolean }> = [];
  if (opponents.length === 0) return matches;
  // build a fixture list of exactly totalMatches, cycling opponents and alternating home/away per pass
  let i = 0;
  while (order.length < totalMatches) {
    const opp = opponents[i % opponents.length];
    const round = Math.floor(i / opponents.length);
    const home = ((i % opponents.length) + round) % 2 === 0;
    order.push({ opp, home });
    i++;
  }
  // shuffle
  for (let k = order.length - 1; k > 0; k--) {
    const j = Math.floor(rand(seed) * (k + 1));
    [order[k], order[j]] = [order[j], order[k]];
  }
  const varianceMul = difficulty === "easy" ? 0.7 : difficulty === "hard" ? 1.3 : 1.0;
  order.forEach((m, idx) => {
    const homeBoost = m.home ? 4 : -1;
    const diff = ourRating + homeBoost - m.opp.strength;
    const ourXG = Math.max(0.2, 1.2 + diff * 0.08 + (rand(seed) - 0.5) * 1.0 * varianceMul);
    const theirXG = Math.max(0.1, 1.1 - diff * 0.06 + (rand(seed) - 0.5) * 0.9 * varianceMul);
    const ourScore = poisson(ourXG, seed);
    const theirScore = poisson(theirXG, seed);
    let outcome: "W" | "D" | "L" = "D";
    if (ourScore > theirScore) outcome = "W";
    else if (ourScore < theirScore) outcome = "L";
    matches.push({
      matchday: idx + 1,
      opponent: m.opp,
      home: m.home,
      ourScore,
      theirScore,
      outcome,
    });
  });
  return matches;
}

function poisson(lambda: number, seed: { v: number }): number {
  const L = Math.exp(-lambda);
  let k = 0,
    p = 1;
  do {
    k++;
    p *= rand(seed);
  } while (p > L && k < 9);
  return k - 1;
}

// ─── Per-matchday simulation (career mode benching) ─────────────────────
//
// Quick Match pre-simulates the whole season in one simulateSeason call —
// that function MUST stay byte-identical (Daily Challenge cohorts share
// seeds). Career mode instead simulates one match at a time so the user's
// CURRENT starting XI (after bench rotations) drives each result. These
// helpers are additive; simulateSeason is untouched.

export interface Fixture {
  opponent: Club;
  home: boolean;
}

/** Build the season fixture list — same cycle + shuffle logic as
 *  simulateSeason so the schedule "feels" identical, but exposed
 *  standalone so career mode can simulate match-by-match. */
export function buildSeasonFixtures(
  opponents: Club[],
  totalMatches: number,
  seedNum: number,
): Fixture[] {
  if (opponents.length === 0) return [];
  const seed = { v: seedNum || 12345 };
  const order: Fixture[] = [];
  let i = 0;
  while (order.length < totalMatches) {
    const opp = opponents[i % opponents.length];
    const round = Math.floor(i / opponents.length);
    const home = ((i % opponents.length) + round) % 2 === 0;
    order.push({ opponent: opp, home });
    i++;
  }
  for (let k = order.length - 1; k > 0; k--) {
    const j = Math.floor(rand(seed) * (k + 1));
    [order[k], order[j]] = [order[j], order[k]];
  }
  return order;
}

/** Simulate ONE match with a per-matchday derived seed. The rating can
 *  differ per matchday (that's the whole point — bench rotation changes
 *  the XI). Deterministic for a given (seedNum, matchday) pair, so
 *  re-rendering or resuming a season never re-rolls played results. */
export function simulateOneMatch(
  fixture: Fixture,
  matchday: number,
  ourRating: number,
  seedNum: number,
  difficulty: "easy" | "normal" | "hard" = "normal",
): MatchResult {
  // Mix the season seed with the matchday for a stable per-match stream.
  // Knuth multiplicative hash on the combination; any well-mixed function
  // works — it just must not collide across matchdays of one season.
  const mixed = (Math.imul(seedNum ^ (matchday * 2654435761), 2246822519) >>> 0) || 12345;
  const seed = { v: mixed };
  const varianceMul = difficulty === "easy" ? 0.7 : difficulty === "hard" ? 1.3 : 1.0;
  const homeBoost = fixture.home ? 4 : -1;
  const diff = ourRating + homeBoost - fixture.opponent.strength;
  const ourXG = Math.max(0.2, 1.2 + diff * 0.08 + (rand(seed) - 0.5) * 1.0 * varianceMul);
  const theirXG = Math.max(0.1, 1.1 - diff * 0.06 + (rand(seed) - 0.5) * 0.9 * varianceMul);
  const ourScore = poisson(ourXG, seed);
  const theirScore = poisson(theirXG, seed);
  let outcome: "W" | "D" | "L" = "D";
  if (ourScore > theirScore) outcome = "W";
  else if (ourScore < theirScore) outcome = "L";
  return {
    matchday,
    opponent: fixture.opponent,
    home: fixture.home,
    ourScore,
    theirScore,
    outcome,
  };
}

/**
 * forecastSeasonPoints — analytic expected league points for the user's XI
 * against a known fixture list. The "what should this squad achieve?" baseline
 * that drives the overperformance score on /result.
 *
 * Uses the SAME xG formula as simulateSeason, but strips the random term
 * (variance contributes zero to E[outcome] over a single match). Per match:
 *
 *   E[points] = 3 · P(win) + 1 · P(draw)
 *
 * where P(win) / P(draw) come from convolving two independent Poissons
 * with means ourXG / theirXG, truncated at 8 goals each (covers >99.99%
 * of mass at the lambdas this sim produces, < 1e-6 truncation error).
 *
 * Fixture order does NOT matter for expected points (linearity of
 * expectation), so we don't need the same shuffle as the live sim.
 *
 * Only meaningful for league competitions — knockout/groupKO uses a
 * different success function (advance vs eliminate, not points).
 */
export function forecastSeasonPoints(
  opponents: Club[],
  totalMatches: number,
  ourRating: number,
): number {
  if (!opponents.length || totalMatches <= 0) return 0;
  let total = 0;
  for (let i = 0; i < totalMatches; i++) {
    const opp = opponents[i % opponents.length]!;
    // Alternate home/away over the season — same pattern as simulateSeason
    // before its shuffle. Shuffle doesn't change E[total], so we don't
    // emulate it here.
    const round = Math.floor(i / opponents.length);
    const home = ((i % opponents.length) + round) % 2 === 0;
    const homeBoost = home ? 4 : -1;
    const diff = ourRating + homeBoost - opp.strength;
    const ourXG = Math.max(0.2, 1.2 + diff * 0.08);
    const theirXG = Math.max(0.1, 1.1 - diff * 0.06);
    total += expectedMatchPoints(ourXG, theirXG);
  }
  return total;
}

/** Per-match E[points] = 3·P(W) + 1·P(D), Poisson model with goals 0..8. */
function expectedMatchPoints(lambdaUs: number, lambdaThem: number): number {
  const MAX_GOALS = 8;
  const pmfUs = poissonPMF(lambdaUs, MAX_GOALS);
  const pmfThem = poissonPMF(lambdaThem, MAX_GOALS);
  let pW = 0,
    pD = 0;
  for (let a = 0; a <= MAX_GOALS; a++) {
    for (let b = 0; b <= MAX_GOALS; b++) {
      const p = pmfUs[a]! * pmfThem[b]!;
      if (a > b) pW += p;
      else if (a === b) pD += p;
    }
  }
  return 3 * pW + pD;
}

/** Poisson PMF for k = 0..maxK at rate lambda. */
function poissonPMF(lambda: number, maxK: number): number[] {
  const out: number[] = new Array(maxK + 1);
  const eMinusL = Math.exp(-lambda);
  let term = eMinusL; // k=0: e^-λ
  out[0] = term;
  for (let k = 1; k <= maxK; k++) {
    term = (term * lambda) / k;
    out[k] = term;
  }
  return out;
}

/**
 * Simulate a knockout (or group+KO) competition with proper two-legged ties.
 * - `rounds[i]` is the round label of match i (e.g. "Group", "Round of 16", "Final").
 * - Consecutive matches in a non-group round vs the SAME opponent are treated as
 *   legs of one tie; aggregate score decides advancement, draw -> rating-biased
 *   coinflip (penalties). Group stage uses a points threshold (>= 7 points from 6
 *   matches, or >= 4 points from 3 matches).
 */
export function simulateKnockout(
  opponents: Club[],
  rounds: string[],
  ourRating: number,
  seedNum: number,
  difficulty: "easy" | "normal" | "hard" = "normal",
): MatchResult[] {
  const seed = { v: seedNum || 12345 };
  const varianceMul = difficulty === "easy" ? 0.7 : difficulty === "hard" ? 1.3 : 1.0;
  const results: MatchResult[] = [];

  const total = Math.min(opponents.length, rounds.length);
  let groupPts = 0;
  let groupMatches = 0;
  let eliminated = false;

  // Tie tracking for two-legged knockouts
  let tieOurGoals = 0;
  let tieTheirGoals = 0;
  let tieStartIdx = -1;
  let tieOppId: string | null = null;
  let tieRound: string | null = null;
  let tieLegCount = 0;

  for (let i = 0; i < total; i++) {
    if (eliminated) break;
    const opp = opponents[i]!;
    const round = rounds[i]!;
    const isGroup = round === "Group";
    const next = i + 1 < total ? { opp: opponents[i + 1]!, round: rounds[i + 1]! } : null;

    // Detect tie state for KO rounds
    const sameTieAsPrev = !isGroup && tieOppId === opp.id && tieRound === round;
    if (!sameTieAsPrev && !isGroup) {
      tieOurGoals = 0;
      tieTheirGoals = 0;
      tieStartIdx = i;
      tieOppId = opp.id;
      tieRound = round;
      tieLegCount = 0;
    }
    if (isGroup) {
      tieOppId = null;
      tieRound = null;
      tieLegCount = 0;
    }

    // Determine home/away for this match
    let home: boolean;
    if (isGroup) {
      // Group: alternate home/away per opponent pairing (idx pairs)
      home = i % 2 === 0;
    } else if (sameTieAsPrev) {
      // 2nd leg flips venue
      home = false;
    } else {
      // 1st leg of a KO tie: home, unless it's the final (single leg, treat as neutral-home)
      home = true;
    }

    const homeBoost = home ? 3 : -1;
    const diff = ourRating + homeBoost - opp.strength;
    const ourXG = Math.max(0.2, 1.15 + diff * 0.08 + (rand(seed) - 0.5) * 1.0 * varianceMul);
    const theirXG = Math.max(0.1, 1.05 - diff * 0.06 + (rand(seed) - 0.5) * 0.9 * varianceMul);
    const ourScore = poisson(ourXG, seed);
    const theirScore = poisson(theirXG, seed);

    const outcome: "W" | "D" | "L" =
      ourScore > theirScore ? "W" : ourScore < theirScore ? "L" : "D";

    let eliminates = false;

    if (isGroup) {
      groupPts += outcome === "W" ? 3 : outcome === "D" ? 1 : 0;
      groupMatches += 1;
      const nextIsKO = next && next.round !== "Group";
      const endOfGroup = !next || nextIsKO;
      if (endOfGroup) {
        const threshold = groupMatches >= 6 ? 7 : 4; // 6-match group needs 7+ pts, 3-match group needs 4+
        if (groupPts < threshold) {
          eliminates = true;
          eliminated = true;
        }
      }
    } else {
      // Aggregate tie tracking
      tieOurGoals += ourScore;
      tieTheirGoals += theirScore;
      tieLegCount += 1;
      const tieEnds = !next || next.opp.id !== opp.id || next.round !== round;
      if (tieEnds) {
        // Resolve tie
        let weAdvance: boolean;
        if (tieOurGoals > tieTheirGoals) weAdvance = true;
        else if (tieOurGoals < tieTheirGoals) weAdvance = false;
        else {
          // Drawn on aggregate after final leg → ET + pens (rating-biased coin flip)
          const edge = 0.5 + Math.max(-0.2, Math.min(0.2, diff * 0.01));
          weAdvance = rand(seed) < edge;
        }
        if (!weAdvance) {
          eliminates = true;
          eliminated = true;
        }
        // For single-leg ties (e.g. Final) the per-match outcome may have been a draw;
        // when penalties decide, retroactively bump the score so W/D/L reflects the outcome.
        if (tieLegCount === 1 && ourScore === theirScore) {
          if (weAdvance) {
            // mark as a win on penalties — bump our score by 1 visually
            results.push({
              matchday: i + 1,
              opponent: opp,
              home,
              ourScore: ourScore + 1,
              theirScore,
              outcome: "W",
              round,
              eliminates,
            });
            continue;
          } else {
            results.push({
              matchday: i + 1,
              opponent: opp,
              home,
              ourScore,
              theirScore: theirScore + 1,
              outcome: "L",
              round,
              eliminates,
            });
            continue;
          }
        }
      }
    }

    results.push({
      matchday: i + 1,
      opponent: opp,
      home,
      ourScore,
      theirScore,
      outcome,
      round,
      eliminates,
    });
  }
  return results;
}

export interface TableRow {
  name: string;
  short: string;
  color: string;
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
  isUs?: boolean;
}

export function computeLeagueTable(
  matches: MatchResult[],
  opponents: Club[],
  ourRating: number,
  matchesPerTeam: number = 34,
): { table: TableRow[]; ourPosition: number } {
  const ourW = matches.filter((m) => m.outcome === "W").length;
  const ourD = matches.filter((m) => m.outcome === "D").length;
  const ourL = matches.filter((m) => m.outcome === "L").length;
  const ourGF = matches.reduce((a, m) => a + m.ourScore, 0);
  const ourGA = matches.reduce((a, m) => a + m.theirScore, 0);

  const us: TableRow = {
    name: "Your XI",
    short: "YOU",
    color: "#facc15",
    played: matches.length,
    w: ourW,
    d: ourD,
    l: ourL,
    gf: ourGF,
    ga: ourGA,
    pts: ourW * 3 + ourD,
    isUs: true,
  };

  // Per-matchday W/D/L SEQUENCE per opponent (not a smooth pts scaling).
  //
  // User reported: "opponents sometimes did 2 points which is not possible
  // as they can only make 0, 1 or 3 points." The old approach scaled fullPts
  // proportionally, which could yield a +2 gain in one matchday — impossible
  // in real football (W=3, D=1, L=0 are the only outcomes).
  //
  // Now: each opponent gets a deterministic 22-match sequence of W/D/L
  // outcomes drawn from a strength-derived (winRate, drawRate, lossRate)
  // distribution. Live stats = count over their first `userPlayed` results.
  // Per-matchday gain is therefore ALWAYS 0, 1, or 3.
  //
  // Seed excludes matches.length so the 22-match sequence is identical at
  // MD3 and MD22 — same career, same projected season.
  const seed = { v: (ourRating * 9301) | 0 || 42 };
  const userPlayed = matches.length;

  // A league is a CLOSED system: across all teams, wins == losses and the
  // average club takes ~1.4 pts/game. So a club's record must come from its
  // strength RELATIVE TO THE LEAGUE, not its absolute rating — otherwise a
  // division of all-lowish-rated clubs (e.g. the Swiss league at ~62-70)
  // shows everyone losing. Centre the field on the mean and spread from there.
  const meanStrength =
    opponents.reduce((a, o) => a + o.strength, 0) / Math.max(1, opponents.length);

  const rows: TableRow[] = opponents.map((o) => {
    const rel = o.strength - meanStrength;
    // ~1.45 pts/game baseline, ±0.06 per strength point vs the league mean.
    const ptsPerMatch = Math.max(0.45, Math.min(2.7, 1.45 + rel * 0.06));
    let drawRate = 0.26;
    let winRate = Math.max(0, (ptsPerMatch - drawRate) / 3);
    if (winRate === 0) drawRate = Math.min(1, ptsPerMatch);
    if (winRate + drawRate > 1) {
      winRate = Math.min(1, winRate);
      drawRate = Math.max(0, 1 - winRate);
    }
    // Small per-opponent jitter for variety run-to-run, doesn't break
    // seed-stability (rand(seed) consumes deterministically per opponent).
    const wAdj = Math.max(0, Math.min(1, winRate + (rand(seed) - 0.5) * 0.06));
    const dAdj = Math.max(0, Math.min(1 - wAdj, drawRate + (rand(seed) - 0.5) * 0.04));

    // Pre-generate the matchesPerTeam-long sequence
    const seq: Array<"W" | "D" | "L"> = [];
    for (let i = 0; i < matchesPerTeam; i++) {
      const r = rand(seed);
      if (r < wAdj) seq.push("W");
      else if (r < wAdj + dAdj) seq.push("D");
      else seq.push("L");
    }

    const slice = seq.slice(0, userPlayed);
    const w = slice.filter((x) => x === "W").length;
    const d = slice.filter((x) => x === "D").length;
    const l = slice.filter((x) => x === "L").length;
    const pts = w * 3 + d;

    // GF/GA also relative to the league: ~1.35 goals/game baseline, goal
    // difference driven by strength vs the mean (so it sums ~0 league-wide).
    const gpg = Math.max(0.4, 1.35 + rel * 0.03);
    const gapg = Math.max(0.4, 1.35 - rel * 0.03);
    const gf = Math.max(0, Math.round(gpg * userPlayed + (rand(seed) - 0.5) * 4));
    const ga = Math.max(0, Math.round(gapg * userPlayed + (rand(seed) - 0.5) * 4));
    return {
      name: o.name,
      short: o.short,
      color: o.color,
      played: userPlayed,
      w,
      d,
      l,
      gf,
      ga,
      pts,
    };
  });

  const table = [...rows, us].sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    const gdA = a.gf - a.ga,
      gdB = b.gf - b.ga;
    if (gdB !== gdA) return gdB - gdA;
    return b.gf - a.gf;
  });
  const ourPosition = table.findIndex((r) => r.isUs) + 1;
  return { table, ourPosition };
}
