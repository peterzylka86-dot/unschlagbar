/**
 * Tests for Dynasty Objectives — pure derivation over seasonHistory.
 */
import { describe, it, expect } from "vitest";
import { dynastyStatus, newlyUnlocked, DYNASTY_OBJECTIVES } from "./dynasty";
import type { SeasonRecord } from "./career-store";

function season(overrides: Partial<SeasonRecord> = {}): SeasonRecord {
  return {
    season: 1,
    leagueId: "ucl",
    foundingClubId: "bayern",
    formation: "4-3-3",
    finalPosition: 5,
    totalLeagueClubs: 12,
    wins: 10,
    draws: 6,
    losses: 6,
    goalsFor: 30,
    goalsAgainst: 25,
    cupResult: "did-not-qualify",
    relegated: false,
    trophies: [],
    endedAt: "2026-06-12T00:00:00Z",
    ...overrides,
  };
}

describe("dynastyStatus", () => {
  it("empty history → all locked, decade/centurion at 0 progress", () => {
    const all = dynastyStatus([]);
    expect(all.every((s) => !s.unlocked)).toBe(true);
    expect(all.find((s) => s.objective.id === "the-decade")?.progress).toBe(0);
  });

  it("first-silverware unlocks on league title", () => {
    const all = dynastyStatus([season({ finalPosition: 1 })]);
    expect(all.find((s) => s.objective.id === "first-silverware")?.unlocked).toBe(true);
  });

  it("first-silverware unlocks on cup win even without league title", () => {
    const all = dynastyStatus([season({ finalPosition: 4, cupResult: "champion" })]);
    expect(all.find((s) => s.objective.id === "first-silverware")?.unlocked).toBe(true);
  });

  it("the-double requires BOTH in the SAME season", () => {
    // League S1, cup S2 — no double
    const split = dynastyStatus([
      season({ season: 1, finalPosition: 1 }),
      season({ season: 2, finalPosition: 3, cupResult: "champion" }),
    ]);
    expect(split.find((s) => s.objective.id === "the-double")?.unlocked).toBe(false);
    // Both same season — double
    const both = dynastyStatus([season({ finalPosition: 1, cupResult: "champion" })]);
    expect(both.find((s) => s.objective.id === "the-double")?.unlocked).toBe(true);
  });

  it("invincible-season needs 0 losses AND at least 1 win (empty seasons don't count)", () => {
    const zeroLoss = dynastyStatus([season({ wins: 18, draws: 4, losses: 0 })]);
    expect(zeroLoss.find((s) => s.objective.id === "invincible-season")?.unlocked).toBe(true);
    const empty = dynastyStatus([season({ wins: 0, draws: 0, losses: 0 })]);
    expect(empty.find((s) => s.objective.id === "invincible-season")?.unlocked).toBe(false);
  });

  it("back-to-back: consecutive titles only", () => {
    // Titles in S1 and S3 (broken streak) — half progress, not unlocked
    const broken = dynastyStatus([
      season({ season: 1, finalPosition: 1 }),
      season({ season: 2, finalPosition: 2 }),
      season({ season: 3, finalPosition: 1 }),
    ]);
    const b2b = broken.find((s) => s.objective.id === "back-to-back");
    expect(b2b?.unlocked).toBe(false);
    expect(b2b?.progress).toBe(0.5);
    // Consecutive S1+S2 — unlocked
    const consecutive = dynastyStatus([
      season({ season: 1, finalPosition: 1 }),
      season({ season: 2, finalPosition: 1 }),
    ]);
    expect(consecutive.find((s) => s.objective.id === "back-to-back")?.unlocked).toBe(true);
  });

  it("dynasty needs 3 in a row", () => {
    const three = dynastyStatus([
      season({ season: 1, finalPosition: 1 }),
      season({ season: 2, finalPosition: 1 }),
      season({ season: 3, finalPosition: 1 }),
    ]);
    expect(three.find((s) => s.objective.id === "dynasty")?.unlocked).toBe(true);
  });

  it("survivor: relegation resets the streak", () => {
    const h = [
      season({ season: 1 }),
      season({ season: 2 }),
      season({ season: 3, relegated: true }),
      season({ season: 4 }),
      season({ season: 5 }),
    ];
    const s = dynastyStatus(h).find((x) => x.objective.id === "survivor");
    // Longest non-relegated streak = 2 → progress 2/5
    expect(s?.unlocked).toBe(false);
    expect(s?.progress).toBeCloseTo(2 / 5);
  });

  it("centurion accumulates across seasons", () => {
    const h = [
      season({ season: 1, goalsFor: 40 }),
      season({ season: 2, goalsFor: 40 }),
    ];
    const s = dynastyStatus(h).find((x) => x.objective.id === "centurion");
    expect(s?.progress).toBeCloseTo(0.8);
    const h3 = [...h, season({ season: 3, goalsFor: 40 })];
    expect(dynastyStatus(h3).find((x) => x.objective.id === "centurion")?.unlocked).toBe(true);
  });

  it("the-decade unlocks at 10 seasons", () => {
    const h = Array.from({ length: 10 }, (_, i) => season({ season: i + 1 }));
    expect(dynastyStatus(h).find((s) => s.objective.id === "the-decade")?.unlocked).toBe(true);
  });
});

describe("newlyUnlocked", () => {
  it("empty history → nothing", () => {
    expect(newlyUnlocked([])).toEqual([]);
  });

  it("detects an objective that unlocked with the LATEST season only", () => {
    const h = [
      season({ season: 1, finalPosition: 3 }),
      season({ season: 2, finalPosition: 1 }), // first title → first-silverware
    ];
    const fresh = newlyUnlocked(h);
    expect(fresh.map((s) => s.objective.id)).toContain("first-silverware");
  });

  it("does NOT re-report objectives unlocked in earlier seasons", () => {
    const h = [
      season({ season: 1, finalPosition: 1 }), // silverware unlocked here
      season({ season: 2, finalPosition: 5 }),
    ];
    const fresh = newlyUnlocked(h);
    expect(fresh.map((s) => s.objective.id)).not.toContain("first-silverware");
  });
});

describe("objective registry", () => {
  it("ids are unique", () => {
    const ids = DYNASTY_OBJECTIVES.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
