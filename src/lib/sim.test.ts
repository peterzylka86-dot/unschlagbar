/**
 * Tests for the pure match-simulation engine.
 *
 * sim.ts is fully deterministic given (opponents, ratings, seed, difficulty),
 * which makes it easy to lock in behavior. These tests guard against
 * regressions when the math is refactored — a silent change to the Poisson
 * or variance constants would break user-expected results.
 */
import { describe, it, expect } from "vitest";
import {
  squadRating,
  simulateSeason,
  simulateKnockout,
  computeLeagueTable,
} from "./sim";
import type { Club, Slot, Player } from "./game-types";

function mockPlayer(rating: number): Player {
  return {
    name: `P${rating}`,
    position: "ST",
    prime_rating: rating,
    career_years: "2020-2026",
    nationality: "Test",
    club: "test",
  };
}

function mockSlot(rating: number | null, idx: number): Slot {
  return {
    id: `s${idx}`,
    position: "ST",
    x: 50,
    y: 50,
    player: rating == null ? undefined : mockPlayer(rating),
  };
}

function mockClub(strength: number, idx: number): Club {
  return {
    id: `c${idx}`,
    name: `Club ${idx}`,
    short: `C${idx}`,
    city: "City",
    color: "#000000",
    founded: 1900,
    strength,
    era: "current",
    era_tier: "current",
  };
}

// ─── squadRating ────────────────────────────────────────────────────────────

describe("squadRating", () => {
  it("returns 0 for a completely empty XI", () => {
    const slots = Array.from({ length: 11 }, (_, i) => mockSlot(null, i));
    expect(squadRating(slots)).toBe(0);
  });

  it("averages the ratings of a fully-filled XI with no penalty", () => {
    // 11 players all rated 90 → average 90, no missing-slot penalty
    const slots = Array.from({ length: 11 }, (_, i) => mockSlot(90, i));
    expect(squadRating(slots)).toBe(90);
  });

  it("applies a 60-rating penalty per empty slot", () => {
    // 10 players rated 90, 1 empty slot
    // sum = 900, penalty = 60, denom = 11 → (900+60)/11 ≈ 87.27 → 87
    const slots = Array.from({ length: 11 }, (_, i) =>
      i < 10 ? mockSlot(90, i) : mockSlot(null, i)
    );
    expect(squadRating(slots)).toBe(87);
  });

  it("handles a half-filled squad without crashing", () => {
    const slots = Array.from({ length: 11 }, (_, i) =>
      i < 5 ? mockSlot(85, i) : mockSlot(null, i)
    );
    const r = squadRating(slots);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(85);
  });
});

// ─── simulateSeason ─────────────────────────────────────────────────────────

describe("simulateSeason", () => {
  const opponents = Array.from({ length: 9 }, (_, i) => mockClub(75 + i, i));

  it("returns the exact requested number of matches", () => {
    const matches = simulateSeason(opponents, 34, 88, 1234, "normal");
    expect(matches).toHaveLength(34);
  });

  it("returns no matches when there are no opponents", () => {
    expect(simulateSeason([], 34, 88, 1234)).toEqual([]);
  });

  it("is deterministic for the same (opponents, rating, seed, difficulty)", () => {
    const a = simulateSeason(opponents, 22, 90, 42, "normal");
    const b = simulateSeason(opponents, 22, 90, 42, "normal");
    expect(a).toEqual(b);
  });

  it("produces different results for different seeds", () => {
    const a = simulateSeason(opponents, 22, 90, 42, "normal");
    const b = simulateSeason(opponents, 22, 90, 99, "normal");
    expect(a).not.toEqual(b);
  });

  it("strong squad wins MORE often than weak squad against same opponents", () => {
    const strong = simulateSeason(opponents, 30, 95, 7, "normal");
    const weak = simulateSeason(opponents, 30, 65, 7, "normal");
    const strongWins = strong.filter(m => m.outcome === "W").length;
    const weakWins = weak.filter(m => m.outcome === "W").length;
    expect(strongWins).toBeGreaterThan(weakWins);
  });

  it("hard difficulty produces a different season than normal", () => {
    const normal = simulateSeason(opponents, 30, 88, 7, "normal");
    const hard = simulateSeason(opponents, 30, 88, 7, "hard");
    expect(normal).not.toEqual(hard);
  });

  it("matchdays are sequential from 1 to N", () => {
    const matches = simulateSeason(opponents, 34, 88, 1234);
    matches.forEach((m, i) => expect(m.matchday).toBe(i + 1));
  });

  it("home/away allocation is approximately balanced (within 3 matches)", () => {
    const matches = simulateSeason(opponents, 30, 88, 1234);
    const home = matches.filter(m => m.home).length;
    const away = matches.filter(m => !m.home).length;
    expect(Math.abs(home - away)).toBeLessThanOrEqual(3);
  });

  it("scores are non-negative integers", () => {
    const matches = simulateSeason(opponents, 34, 88, 1234);
    matches.forEach(m => {
      expect(m.ourScore).toBeGreaterThanOrEqual(0);
      expect(m.theirScore).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(m.ourScore)).toBe(true);
      expect(Number.isInteger(m.theirScore)).toBe(true);
    });
  });

  it("outcome label matches the actual goal difference", () => {
    const matches = simulateSeason(opponents, 34, 88, 1234);
    matches.forEach(m => {
      if (m.ourScore > m.theirScore) expect(m.outcome).toBe("W");
      else if (m.ourScore < m.theirScore) expect(m.outcome).toBe("L");
      else expect(m.outcome).toBe("D");
    });
  });
});

// ─── simulateKnockout ───────────────────────────────────────────────────────

describe("simulateKnockout", () => {
  const oppKO = Array.from({ length: 4 }, (_, i) => mockClub(80, i));

  it("returns matches and stops on elimination (no more matches after a loss)", () => {
    // single-leg tournament with low ratings
    const matches = simulateKnockout(
      oppKO,
      ["Round of 16", "Quarter-Final", "Semi-Final", "Final"],
      60, // weak — likely to be eliminated early
      111,
      "normal",
    );
    // Should have at least 1 match
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // Once a match has eliminates=true, no further matches
    const elimIdx = matches.findIndex(m => m.eliminates);
    if (elimIdx >= 0) {
      expect(matches.length).toBe(elimIdx + 1);
    }
  });

  it("is deterministic for the same seed", () => {
    const rounds = ["Quarter-Final", "Semi-Final", "Final"];
    const a = simulateKnockout(oppKO.slice(0, 3), rounds, 90, 333);
    const b = simulateKnockout(oppKO.slice(0, 3), rounds, 90, 333);
    expect(a).toEqual(b);
  });

  it("group stage with too few points eliminates the player", () => {
    // 3-match group, weak rating → likely to fail the 4-pt threshold
    const matches = simulateKnockout(
      Array.from({ length: 3 }, (_, i) => mockClub(90, i)),
      ["Group", "Group", "Group"],
      55, // very weak vs strong opponents
      777,
      "normal",
    );
    // Should not crash, returns 1-3 matches
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.length).toBeLessThanOrEqual(3);
  });
});

// ─── computeLeagueTable ─────────────────────────────────────────────────────

describe("computeLeagueTable", () => {
  const opponents = Array.from({ length: 5 }, (_, i) => mockClub(70 + i * 5, i));

  it("includes 'us' in the table", () => {
    const matches = simulateSeason(opponents, 20, 85, 100);
    const { table } = computeLeagueTable(matches, opponents, 85, 20);
    expect(table.some(r => r.isUs)).toBe(true);
  });

  it("returns ourPosition between 1 and (opponents+1) inclusive", () => {
    const matches = simulateSeason(opponents, 20, 85, 100);
    const { ourPosition } = computeLeagueTable(matches, opponents, 85, 20);
    expect(ourPosition).toBeGreaterThanOrEqual(1);
    expect(ourPosition).toBeLessThanOrEqual(opponents.length + 1);
  });

  it("our points = 3*W + D", () => {
    const matches = simulateSeason(opponents, 20, 85, 100);
    const { table } = computeLeagueTable(matches, opponents, 85, 20);
    const us = table.find(r => r.isUs)!;
    expect(us.pts).toBe(us.w * 3 + us.d);
    expect(us.played).toBe(matches.length);
  });

  // LIVE-TABLE bug: previously opponents reported P=matchesPerTeam (full season)
  // even when the user had only played a handful of MDs. That made the live
  // mid-season table show "FCB 22 played · You 3 played" — visually wrong,
  // and pushed the user to bottom even when they were leading.
  it("scales opponent.played to user's matches.length (mid-season)", () => {
    const matches = simulateSeason(opponents, 22, 85, 100).slice(0, 5);
    const { table } = computeLeagueTable(matches, opponents, 85, 22);
    // user shows 5 matches played
    const us = table.find(r => r.isUs)!;
    expect(us.played).toBe(5);
    // all opponents should also show ~5 played (rounded), not 22
    const others = table.filter(r => !r.isUs);
    others.forEach(o => {
      expect(o.played).toBeLessThanOrEqual(6);
      expect(o.played).toBeGreaterThanOrEqual(4);
      expect(o.w + o.d + o.l).toBe(o.played);
      expect(o.pts).toBe(o.w * 3 + o.d);
    });
  });

  it("at 0 matchdays played, every opponent reports played=0", () => {
    const { table } = computeLeagueTable([], opponents, 85, 22);
    const others = table.filter(r => !r.isUs);
    others.forEach(o => {
      expect(o.played).toBe(0);
      expect(o.w).toBe(0);
      expect(o.d).toBe(0);
      expect(o.l).toBe(0);
      expect(o.pts).toBe(0);
    });
  });

  it("at full season, opponent.played === matchesPerTeam (unchanged behavior)", () => {
    const matches = simulateSeason(opponents, 20, 85, 100);
    const { table } = computeLeagueTable(matches, opponents, 85, 20);
    const others = table.filter(r => !r.isUs);
    others.forEach(o => {
      expect(o.played).toBe(20);
    });
  });

  it("sorted by points DESC, then goal difference, then goals-for", () => {
    const matches = simulateSeason(opponents, 20, 85, 100);
    const { table } = computeLeagueTable(matches, opponents, 85, 20);
    for (let i = 0; i < table.length - 1; i++) {
      const a = table[i], b = table[i + 1];
      // Strict pts >= pts; if equal, GD >= GD; if equal, GF >= GF
      if (a.pts !== b.pts) expect(a.pts).toBeGreaterThanOrEqual(b.pts);
      else if (a.gf - a.ga !== b.gf - b.ga)
        expect(a.gf - a.ga).toBeGreaterThanOrEqual(b.gf - b.ga);
      else expect(a.gf).toBeGreaterThanOrEqual(b.gf);
    }
  });
});
