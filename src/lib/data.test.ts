/**
 * Tests for data loading + Zod schema validation.
 *
 * The IMPORTANT test here is the implicit one: just importing src/lib/data.ts
 * runs validateLeague() on all 7 leagues at module load. If any of the
 * shipped JSON files have a bad row, this test file refuses to even import,
 * and the suite fails. That's the safety net.
 */
import { describe, it, expect } from "vitest";
import { getClubs, getPlayers, _schemas } from "./data";
import type { LeagueId } from "./leagues";
import { LEAGUE_IDS } from "./leagues";

describe("data module loads cleanly", () => {
  it("imports without throwing (= all 7 leagues pass schema validation)", () => {
    // The very fact that this file runs means data.ts loaded without
    // validateLeague() throwing. This is the guard.
    expect(true).toBe(true);
  });

  describe.each(LEAGUE_IDS as LeagueId[])("league %s", (league) => {
    it("has clubs", () => {
      expect(getClubs(league).length).toBeGreaterThan(0);
    });
    it("has players", () => {
      expect(getPlayers(league).length).toBeGreaterThan(0);
    });
    it("every player's club id exists in clubs", () => {
      const clubIds = new Set(getClubs(league).map(c => c.id));
      const orphans = getPlayers(league).filter(p => !clubIds.has(p.club));
      expect(orphans).toEqual([]);
    });
  });
});

describe("playerSchema", () => {
  it("accepts a well-formed player", () => {
    const ok = _schemas.playerSchema.safeParse({
      name: "Ada Lovelace",
      position: "CAM",
      prime_rating: 90,
      career_years: "2020-2026",
      nationality: "England",
      club: "test",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects an invalid position", () => {
    const bad = _schemas.playerSchema.safeParse({
      name: "Test",
      position: "LM", // LM is no longer in the valid set
      prime_rating: 80,
      career_years: "2020-2026",
      nationality: "Test",
      club: "test",
    });
    expect(bad.success).toBe(false);
  });

  it("rejects an out-of-range rating", () => {
    const bad = _schemas.playerSchema.safeParse({
      name: "Test",
      position: "ST",
      prime_rating: 120,
      career_years: "2020-2026",
      nationality: "Test",
      club: "test",
    });
    expect(bad.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const bad = _schemas.playerSchema.safeParse({
      name: "Test",
      position: "ST",
      // missing prime_rating, career_years, nationality, club
    });
    expect(bad.success).toBe(false);
  });
});

describe("clubSchema", () => {
  it("accepts a well-formed club", () => {
    const ok = _schemas.clubSchema.safeParse({
      id: "test-fc",
      name: "Test FC",
      short: "TFC",
      city: "Testville",
      color: "#1a2b3c",
      founded: 1900,
      strength: 80,
    });
    expect(ok.success).toBe(true);
  });

  it("tolerates extra fields (era, era_tier, era_tiers)", () => {
    const ok = _schemas.clubSchema.safeParse({
      id: "test-fc",
      name: "Test FC",
      short: "TFC",
      city: "Testville",
      color: "#1a2b3c",
      founded: 1900,
      strength: 80,
      era: "current",
      era_tier: "current",
      era_tiers: ["current", "00s"],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects unrealistic founding year", () => {
    const bad = _schemas.clubSchema.safeParse({
      id: "x", name: "X", short: "X", city: "X",
      color: "#000", founded: 1500, strength: 80,
    });
    expect(bad.success).toBe(false);
  });
});
