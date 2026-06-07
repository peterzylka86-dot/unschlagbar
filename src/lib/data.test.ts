/**
 * Tests for data loading + Zod schema validation.
 *
 * The IMPORTANT test here is the implicit one: just importing src/lib/data.ts
 * runs validateLeague() on all 7 leagues at module load. If any of the
 * shipped JSON files have a bad row, this test file refuses to even import,
 * and the suite fails. That's the safety net.
 */
import { describe, it, expect } from "vitest";
import {
  getClubs,
  getPlayers,
  getCareerClubs,
  getCareerPlayers,
  CAREER_POOL_LEAGUES,
  SUPER_TEAM_STRENGTH,
  _schemas,
} from "./data";
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
      const clubIds = new Set(getClubs(league).map((c) => c.id));
      const orphans = getPlayers(league).filter((p) => !clubIds.has(p.club));
      expect(orphans).toEqual([]);
    });
  });
});

describe("career super-league pool", () => {
  it("every default-pool club meets the SUPER_TEAM_STRENGTH threshold", () => {
    // Crème-de-la-crème filter: no Pro-Vercelli-tier clubs in the GOLAZO draft.
    const clubs = getCareerClubs();
    clubs.forEach((c) => {
      expect(c.strength).toBeGreaterThanOrEqual(SUPER_TEAM_STRENGTH);
    });
  });

  it("excludes weak clubs from a known source league (regression)", () => {
    // Bundesliga's median is 72 — those clubs MUST NOT show up in the pool.
    const careerIds = new Set(getCareerClubs().map((c) => c.id));
    const weakBundesliga = getClubs("bundesliga").filter((c) => c.strength < SUPER_TEAM_STRENGTH);
    weakBundesliga.forEach((c) => {
      expect(careerIds.has(c.id)).toBe(false);
    });
  });

  it("includes elite clubs from every CAREER_POOL_LEAGUES source", () => {
    const careerClubIds = new Set(getCareerClubs().map((c) => c.id));
    for (const lg of CAREER_POOL_LEAGUES) {
      const eliteSourceIds = getClubs(lg)
        .filter((c) => c.strength >= SUPER_TEAM_STRENGTH)
        .map((c) => c.id);
      if (eliteSourceIds.length === 0) continue; // (no league should hit this)
      const overlap = eliteSourceIds.filter((id) => careerClubIds.has(id));
      expect(overlap.length).toBeGreaterThan(0);
    }
  });

  it("deduplicates players by `${club}:${name}`", () => {
    const players = getCareerPlayers();
    const keys = players.map((p) => `${p.club}:${p.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("always includes the user's founding club, even below threshold (GC case)", () => {
    // GC's strength is 76 — below the 80 threshold. Without the anchor
    // override they'd vanish from the pool and the founding pick would
    // crash with a missing club.
    const clubs = getCareerClubs("grasshopper");
    expect(clubs.some((c) => c.id === "grasshopper")).toBe(true);
    // Real Madrid (elite) must still be in
    expect(clubs.some((c) => c.id === "realmadrid")).toBe(true);
  });

  it("anchor inclusion also brings the anchor club's players in", () => {
    // Without this, GC would be a club with zero players — draft crash.
    const playersForGC = getCareerPlayers("grasshopper");
    expect(playersForGC.some((p) => p.club === "grasshopper")).toBe(true);
  });
});

describe("player name hygiene (regression)", () => {
  // User reported "Diego Forlan VIL" displaying in the recap. Root cause:
  // 86 player records had their club's short attribute appended to the
  // name during data ingestion (Forlán→Vil, Pirlo→Mil, Vieri→Int, etc.).
  // After the cleanup pass, no player name should END with a token that
  // equals their club's short (case-insensitive).
  describe.each(LEAGUE_IDS as LeagueId[])("league %s", (league) => {
    it("no player name ends with their club's short attribute", () => {
      const clubs = getClubs(league);
      const shortById = new Map(clubs.map((c) => [c.id, c.short]));
      const players = getPlayers(league);
      const offenders = players
        .filter((p) => {
          const short = shortById.get(p.club);
          if (!short) return false;
          const parts = p.name.split(/\s+/);
          if (parts.length < 2) return false;
          const last = parts[parts.length - 1];
          return last.toLowerCase() === short.toLowerCase();
        })
        .map((p) => `${p.name} (club=${p.club}, short=${shortById.get(p.club)})`)
        .slice(0, 5);
      expect(offenders).toEqual([]);
    });
  });
});

describe("World Cup squads — per-club position coverage (regression)", () => {
  // User: "There are only GK,CB,CM and ST and once I have filled the
  // slots, I can not fill RB,LB, CW,RW...You need to fix the database."
  //
  // WC source data classified players into broad buckets (GK/CB/CM/ST
  // only). We redistributed CB → CB/LB/RB, CM → CM/CAM/CDM, and
  // ST → ST/LW/RW per national squad so every nation has the full
  // position range, NOT just the four broad buckets.
  //
  // Why scoped to WC: club leagues (UCL, La Liga, Bundesliga, Serie A,
  // Swiss) have richer real position labels in the source data — some
  // lower-tier clubs naturally lack wingers, and the wheel's auto-skip
  // for dead-end clubs handles those gracefully. National squads have
  // a single "club" each, so a gap is a hard block — hence the strict
  // assertion below.
  const REQUIRED = ["GK", "CB", "LB", "RB", "CM", "LW", "RW", "ST"] as const;
  const WC_LEAGUES: LeagueId[] = ["worldcup", "worldcup2026"];
  describe.each(WC_LEAGUES)("league %s", (league) => {
    it("every nation with squad ≥11 has at least 1 player of each draft position", () => {
      const players = getPlayers(league);
      const byClub = new Map<string, typeof players>();
      for (const p of players) {
        const arr = byClub.get(p.club) ?? [];
        arr.push(p);
        byClub.set(p.club, arr);
      }
      const missing: string[] = [];
      for (const [clubId, squad] of byClub) {
        if (squad.length < 11) continue;
        const positions = new Set(squad.map((p) => p.position));
        const gaps = REQUIRED.filter((r) => !positions.has(r));
        if (gaps.length > 0) {
          missing.push(`${clubId} missing [${gaps.join(", ")}]`);
        }
      }
      expect(missing).toEqual([]);
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
      id: "x",
      name: "X",
      short: "X",
      city: "X",
      color: "#000",
      founded: 1500,
      strength: 80,
    });
    expect(bad.success).toBe(false);
  });
});
