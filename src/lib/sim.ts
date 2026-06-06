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

export function simulateSeason(opponents: Club[], ourRating: number, seedNum: number): MatchResult[] {
  const seed = { v: seedNum || 12345 };
  const matches: MatchResult[] = [];
  // home + away vs each opponent
  const order: Array<{ opp: Club; home: boolean }> = [];
  opponents.forEach(o => order.push({ opp: o, home: true }));
  opponents.forEach(o => order.push({ opp: o, home: false }));
  // shuffle
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand(seed) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.forEach((m, idx) => {
    const homeBoost = m.home ? 3 : -1;
    const diff = (ourRating + homeBoost) - m.opp.strength;
    // base xG approx
    const ourXG = Math.max(0.2, 1.2 + diff * 0.08 + (rand(seed) - 0.5) * 1.4);
    const theirXG = Math.max(0.1, 1.1 - diff * 0.06 + (rand(seed) - 0.5) * 1.2);
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
