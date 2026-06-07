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

  // CRITICAL: the RNG seed MUST NOT depend on matches.length. The earlier
  // version was `(ourRating * 9301 + matches.length * 1337)` — every
  // matchday the user revealed, every opponent's projected fullPts
  // RE-RANDOMIZED. Real Madrid could project for 60 pts at MD5 and 75
  // pts at MD6 → after scaling, Madrid would leap past the user in one
  // matchday even when the user GAINED points. The user reported exactly
  // this: "had 5 points on Real Madrid…drew the next game…suddenly
  // Madrid was ahead of me."
  //
  // Seed is now stable across matchdays — same career, same league,
  // same projected end-of-season stats whether you're at MD3 or MD22.
  const seed = { v: (ourRating * 9301) | 0 || 42 };
  const maxPts = matchesPerTeam * 3;
  const userPlayed = matches.length;
  const ratio = Math.max(0, Math.min(1, userPlayed / matchesPerTeam));

  const rows: TableRow[] = opponents.map((o) => {
    const base = Math.round((o.strength - 60) * (matchesPerTeam / 15.5));
    const jitter = Math.round((rand(seed) - 0.5) * 10);
    const fullPts = Math.max(8, Math.min(maxPts - 8, base + jitter));
    const fullW = Math.max(0, Math.min(matchesPerTeam, Math.round(fullPts / 3.1)));
    const gdBase = (o.strength - 75) * 1.6 + (rand(seed) - 0.5) * 12;
    const fullGF = Math.max(
      15,
      Math.round(matchesPerTeam * 1.12 + (o.strength - 75) * 1.2 + (rand(seed) - 0.5) * 10),
    );
    const fullGA = Math.max(15, Math.round(fullGF - gdBase));

    // Smooth points scaling: target_pts ≈ fullPts * ratio. Then derive
    // a CONSISTENT (W, D, L) such that W*3 + D == pts and W+D+L == played.
    // Previously we rounded W and D independently — meant a high-fullW
    // opponent could "gain" a full win (+3 pts) in one user matchday
    // while the user only gained 1 (a draw). With this approach the
    // opponent's pts grow smoothly at ~fullPts/matchesPerTeam per matchday.
    const played = Math.round(matchesPerTeam * ratio);
    const targetPts = Math.min(played * 3, Math.round(fullPts * ratio));
    let w = Math.max(0, Math.min(played, Math.round(fullW * ratio)));
    while (w * 3 > targetPts) w--;
    let d = targetPts - w * 3;
    if (w + d > played) d = played - w;
    const l = Math.max(0, played - w - d);
    const pts = w * 3 + d;

    const gf = Math.round(fullGF * ratio);
    const ga = Math.round(fullGA * ratio);
    return {
      name: o.name,
      short: o.short,
      color: o.color,
      played,
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
