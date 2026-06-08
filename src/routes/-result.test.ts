/**
 * Pure-function tests for /result helpers.
 *
 * The helpers (computeStarPerformers, getResultTagline) get exported
 * from result.tsx alongside the route component so we can pin their
 * logic without mounting React.
 */
import { describe, it, expect } from "vitest";
import { computeStarPerformers, getResultTagline } from "./result";
import { LEAGUES } from "@/lib/leagues";
import type { MatchResult, Club } from "@/lib/game-types";

function mockOpponent(id: string, strength = 75): Club {
  return {
    id,
    name: id,
    short: id.slice(0, 3).toUpperCase(),
    city: "x",
    color: "#000",
    founded: 1900,
    strength,
    era: "current",
    era_tier: "current",
  };
}

function match(
  i: number,
  outcome: "W" | "D" | "L",
  opts: { round?: string; eliminates?: boolean; opponent?: Club } = {},
): MatchResult {
  return {
    matchday: i,
    opponent: opts.opponent ?? mockOpponent(`c${i}`),
    home: i % 2 === 0,
    ourScore: outcome === "W" ? 2 : outcome === "D" ? 1 : 0,
    theirScore: outcome === "W" ? 0 : outcome === "D" ? 1 : 2,
    outcome,
    round: opts.round,
    eliminates: opts.eliminates,
  };
}

describe("computeStarPerformers", () => {
  it("returns nulls when no scorer data is attached", () => {
    const r = computeStarPerformers([match(1, "W"), match(2, "W")]);
    expect(r.topScorer).toBeNull();
    expect(r.topAssister).toBeNull();
  });

  it("picks the most-goals scorer", () => {
    const matches: MatchResult[] = [
      { ...match(1, "W"), scorers: [{ name: "A" }, { name: "A" }, { name: "B" }] },
      { ...match(2, "W"), scorers: [{ name: "A" }] },
    ];
    expect(computeStarPerformers(matches).topScorer).toEqual({ name: "A", goals: 3 });
  });

  it("picks the most-assists playmaker (skipping unassisted goals)", () => {
    const matches: MatchResult[] = [
      {
        ...match(1, "W"),
        scorers: [
          { name: "Striker", assister: "Mid" },
          { name: "Striker" }, // unassisted
          { name: "Forward", assister: "Mid" },
        ],
      },
    ];
    expect(computeStarPerformers(matches).topAssister).toEqual({ name: "Mid", assists: 2 });
  });
});

describe("getResultTagline — knockout mode (UCL)", () => {
  const UCL = LEAGUES.ucl;

  it("won the final → win tone, brand label", () => {
    const matches: MatchResult[] = [
      match(1, "W", { round: "Group" }),
      match(2, "W", { round: "Final" }),
    ];
    const r = getResultTagline(UCL, matches, 0, 0);
    expect(r.tone).toBe("win");
    expect(r.line).toContain(UCL.unbeatenLabel);
  });

  it("eliminated in group → loss tone, GROUP STAGE EXIT", () => {
    const matches: MatchResult[] = [
      match(1, "L", { round: "Group" }),
      match(2, "L", { round: "Group", eliminates: true }),
    ];
    const r = getResultTagline(UCL, matches, 0, 0);
    expect(r.tone).toBe("loss");
    expect(r.line).toBe("GROUP STAGE EXIT");
  });

  it("eliminated in Round of 16 → loss tone, ELIMINATED · ROUND OF 16", () => {
    const matches: MatchResult[] = [
      match(1, "W", { round: "Group" }),
      match(2, "L", { round: "Round of 16", eliminates: true }),
    ];
    const r = getResultTagline(UCL, matches, 0, 0);
    expect(r.tone).toBe("loss");
    expect(r.line).toContain("ELIMINATED");
    expect(r.line).toContain("Round of 16");
  });

  it("regression: NOT-won knockout never emits the league tagline", () => {
    // The bug we fixed: "INVINCIBLE EUROPE" was showing on losing UCL runs.
    const matches: MatchResult[] = [
      match(1, "L", { round: "Round of 16", eliminates: true }),
    ];
    const r = getResultTagline(UCL, matches, 0, 0);
    expect(r.line).not.toBe("INVINCIBLE EUROPE");
  });
});

describe("getResultTagline — league mode (Bundesliga)", () => {
  const BL = LEAGUES.bundesliga;

  it("unbeaten → win tone, INVINCIBLE", () => {
    const matches = Array.from({ length: 34 }, (_, i) => match(i + 1, "W"));
    const r = getResultTagline(BL, matches, 1, 18);
    expect(r.tone).toBe("win");
    expect(r.line).toContain(BL.unbeatenLabel);
  });

  it("won the league but with a loss → win tone, LEAGUE CHAMPIONS", () => {
    const matches: MatchResult[] = [
      ...Array.from({ length: 33 }, (_, i) => match(i + 1, "W")),
      match(34, "L"),
    ];
    const r = getResultTagline(BL, matches, 1, 18);
    expect(r.tone).toBe("win");
    expect(r.line).toBe("LEAGUE CHAMPIONS");
  });

  it("relegated (bottom 3 of 18) → loss tone, RELEGATED", () => {
    const matches: MatchResult[] = Array.from({ length: 34 }, (_, i) =>
      match(i + 1, i < 5 ? "W" : "L"),
    );
    const r = getResultTagline(BL, matches, 17, 18);
    expect(r.tone).toBe("loss");
    expect(r.line).toBe("RELEGATED");
  });

  it("mid-table → neutral tone, ordinal place", () => {
    const matches: MatchResult[] = Array.from({ length: 34 }, (_, i) =>
      match(i + 1, i < 14 ? "W" : "L"),
    );
    const r = getResultTagline(BL, matches, 7, 18);
    expect(r.tone).toBe("neutral");
    expect(r.line).toContain("PLACE");
    expect(r.line).toContain("7"); // "7TH PLACE"
  });

  it("regression: losing league run never emits the league tagline", () => {
    const matches = Array.from({ length: 34 }, (_, i) => match(i + 1, "L"));
    const r = getResultTagline(BL, matches, 18, 18);
    expect(r.line).not.toBe("INVINCIBLE");
  });
});

describe("getResultTagline — empty/edge cases", () => {
  it("no matches → falls back to league tagline (neutral)", () => {
    const r = getResultTagline(LEAGUES.ucl, [], 0, 0);
    expect(r.line).toBe(LEAGUES.ucl.tagline);
    expect(r.tone).toBe("neutral");
  });
});
