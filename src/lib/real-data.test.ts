import { describe, it, expect } from "vitest";
import {
  REAL_CLUBS,
  REAL_PLAYERS,
  realLeagues,
  realLeagueName,
  realClubRoster,
  realLeagueOf,
} from "./real-data";

describe("real-mode data (EA FC 25/26 ingest)", () => {
  it("has the expected leagues with correct top-flight sizes", () => {
    const by = new Map(realLeagues().map((l) => [l.slug, l]));
    // Real division sizes — guards against a bad re-ingest merging leagues.
    expect(by.get("es1")?.clubs.length).toBe(20); // La Liga
    expect(by.get("de1")?.clubs.length).toBe(18); // Bundesliga
    expect(by.get("it1")?.clubs.length).toBe(20); // Serie A
    expect(by.get("en1")?.clubs.length).toBe(20); // Premier League
    expect(by.get("ch1")?.clubs.length).toBe(12); // Swiss Super League
    // Second divisions present too.
    expect(by.get("de2")).toBeTruthy();
    expect(by.get("it2")).toBeTruthy();
  });

  it("clubs carry a sane strength + color + league", () => {
    for (const c of REAL_CLUBS) {
      expect(c.strength).toBeGreaterThan(40);
      expect(c.strength).toBeLessThanOrEqual(99);
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.league.length).toBeGreaterThan(0);
    }
  });

  it("players carry ratings, ages and native multi-positions", () => {
    expect(REAL_PLAYERS.length).toBeGreaterThan(2000);
    const withAge = REAL_PLAYERS.filter((p) => typeof p.age === "number");
    expect(withAge.length).toBeGreaterThan(REAL_PLAYERS.length * 0.9);
    const withAlts = REAL_PLAYERS.filter((p) => (p.altPositions?.length ?? 0) > 0);
    expect(withAlts.length).toBeGreaterThan(500);
    const withPotential = REAL_PLAYERS.filter((p) => typeof p.potential === "number");
    expect(withPotential.length).toBeGreaterThan(100); // young players with headroom
  });

  it("realLeagueName resolves a slug", () => {
    expect(realLeagueName("es1")).toBe("La Liga");
    expect(realLeagueName("nope")).toBeUndefined();
  });

  it("seeds a full real roster + the real league for Real-mode careers", () => {
    // Real Madrid is in La Liga (20 clubs) and carries a deep squad.
    const roster = realClubRoster("real-madrid");
    expect(roster.length).toBeGreaterThan(18); // full club squad, not a 14-draft
    expect(roster.every((p) => p.club === "real-madrid")).toBe(true);
    const league = realLeagueOf("real-madrid");
    expect(league?.slug).toBe("es1");
    expect(league?.clubs.length).toBe(20); // the actual league to play
  });

  it("applies the summer-2026 transfer overlay", () => {
    const at = (name: string) => REAL_PLAYERS.find((p) => p.name === name)?.club;
    // Marquee confirmed moves should be reflected in the live pool.
    expect(at("A. Gordon")).toBe("fc-barcelona");
    expect(at("Marc Cucurella")).toBe("real-madrid");
    // And they're no longer at their old clubs.
    expect(REAL_PLAYERS.some((p) => p.name === "A. Gordon" && p.club === "newcastle-united")).toBe(false);
  });
});
