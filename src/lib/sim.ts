import type { Club, MatchResult, Slot } from "./game-types";

export function squadRating(slots: Slot[]): number {
  const rated = slots.filter(s => s.player);
  if (!rated.length) return 0;
  // weight rated players, penalise empty slots
  const sum = rated.reduce((acc, s) => acc + (s.player?.prime_rating ?? 0), 0);
  const filled = rated.length;
  const penalty = (slots.length - filled) * 60;
  return Math.round((sum + penalty) / slots.length);
}

function rand(seed: { v: number }) {
  // xorshift
  let x = seed.v | 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  seed.v = x;
  return ((x >>> 0) % 10000) / 10000;
}

export function simulateSeason(opponents: Club[], ourRating: number, seedNum: number, difficulty: "easy"|"normal"|"hard" = "normal"): MatchResult[] {
  const seed = { v: seedNum || 12345 };
  const matches: MatchResult[] = [];
  const order: Array<{ opp: Club; home: boolean }> = [];
  opponents.forEach(o => order.push({ opp: o, home: true }));
  opponents.forEach(o => order.push({ opp: o, home: false }));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand(seed) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const varianceMul = difficulty === "easy" ? 0.7 : difficulty === "hard" ? 1.3 : 1.0;
  order.forEach((m, idx) => {
    const homeBoost = m.home ? 4 : -1;
    const diff = (ourRating + homeBoost) - m.opp.strength;
    const ourXG = Math.max(0.2, 1.2 + diff * 0.08 + (rand(seed) - 0.5) * 1.0 * varianceMul);
    const theirXG = Math.max(0.1, 1.1 - diff * 0.06 + (rand(seed) - 0.5) * 0.9 * varianceMul);
    const ourScore = poisson(ourXG, seed);
    const theirScore = poisson(theirXG, seed);
    let outcome: "W"|"D"|"L" = "D";
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
  let k = 0, p = 1;
  do { k++; p *= rand(seed); } while (p > L && k < 9);
  return k - 1;
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

// Estimates a final 18-team table: opponents derive points from their strength,
// our row uses the actual simulated matches.
export function computeLeagueTable(
  matches: MatchResult[],
  opponents: Club[],
  ourRating: number,
): { table: TableRow[]; ourPosition: number } {
  const ourW = matches.filter(m => m.outcome === "W").length;
  const ourD = matches.filter(m => m.outcome === "D").length;
  const ourL = matches.filter(m => m.outcome === "L").length;
  const ourGF = matches.reduce((a, m) => a + m.ourScore, 0);
  const ourGA = matches.reduce((a, m) => a + m.theirScore, 0);

  const us: TableRow = {
    name: "Your XI",
    short: "YOU",
    color: "#facc15",
    played: matches.length,
    w: ourW, d: ourD, l: ourL,
    gf: ourGF, ga: ourGA,
    pts: ourW * 3 + ourD,
    isUs: true,
  };

  // Seeded pseudo-random so the table is stable per render.
  const seed = { v: (ourRating * 9301 + matches.length * 1337) | 0 || 42 };
  const rows: TableRow[] = opponents.map(o => {
    // base points from strength (70→26pts, 80→48pts, 92→74pts)
    const base = Math.round((o.strength - 60) * 2.2);
    const jitter = Math.round((rand(seed) - 0.5) * 10);
    const pts = Math.max(8, Math.min(86, base + jitter));
    // back out a plausible W/D/L for 34 games
    const w = Math.max(0, Math.min(34, Math.round(pts / 3.1)));
    const d = Math.max(0, Math.min(34 - w, pts - w * 3));
    const l = 34 - w - d;
    const gdBase = (o.strength - 75) * 1.6 + (rand(seed) - 0.5) * 12;
    const gf = Math.max(15, Math.round(38 + (o.strength - 75) * 1.2 + (rand(seed) - 0.5) * 10));
    const ga = Math.max(15, Math.round(gf - gdBase));
    return {
      name: o.name,
      short: o.short,
      color: o.color,
      played: 34,
      w, d, l, gf, ga, pts,
    };
  });

  const table = [...rows, us].sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    const gdA = a.gf - a.ga, gdB = b.gf - b.ga;
    if (gdB !== gdA) return gdB - gdA;
    return b.gf - a.gf;
  });
  const ourPosition = table.findIndex(r => r.isUs) + 1;
  return { table, ourPosition };
}
