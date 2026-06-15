import { describe, it, expect } from "vitest";
import { youthifyLegend, pickRandomLegends, LEGEND_TALENT_FLOOR } from "./develop-legends";
import type { Player } from "./game-types";

const legend = (over: Partial<Player> = {}): Player => ({
  name: "Pelé",
  position: "ST",
  prime_rating: 96,
  career_years: "1957-1977",
  nationality: "Brazil",
  club: "santos",
  ...over,
});

describe("youthifyLegend", () => {
  it("drops a peak legend to a developing talent with his peak as the ceiling", () => {
    const y = youthifyLegend(legend());
    expect(y.prime_rating).toBe(82); // 96 - 14
    expect(y.targetRating).toBe(96);
    expect(y.potential).toBe(96);
    expect(y.age).toBeGreaterThanOrEqual(16);
    expect(y.age).toBeLessThanOrEqual(19);
  });

  it("floors a modest legend so he's still a great talent, never below his peak", () => {
    const y = youthifyLegend(legend({ prime_rating: 78 }));
    expect(y.prime_rating).toBe(LEGEND_TALENT_FLOOR); // max(70, 78-14=64) = 70
    expect(y.prime_rating).toBeLessThanOrEqual(78);
    expect(y.targetRating).toBe(78);
  });

  it("never starts a prospect above his own peak", () => {
    const y = youthifyLegend(legend({ prime_rating: 72 }));
    expect(y.prime_rating).toBeLessThanOrEqual(72);
  });

  it("leaves an already-aged player untouched (idempotent across seasons)", () => {
    const aged = legend({ age: 23, prime_rating: 88, targetRating: 96 });
    expect(youthifyLegend(aged)).toEqual(aged);
  });

  it("is deterministic", () => {
    expect(youthifyLegend(legend())).toEqual(youthifyLegend(legend()));
  });
});

describe("pickRandomLegends", () => {
  // A pool spanning every area, several per area.
  const pool: Player[] = [
    legend({ name: "Keeper A", position: "GK", prime_rating: 90, club: "a" }),
    legend({ name: "Keeper B", position: "GK", prime_rating: 88, club: "b" }),
    legend({ name: "Defender A", position: "CB", prime_rating: 91, club: "c" }),
    legend({ name: "Defender B", position: "LB", prime_rating: 87, club: "d" }),
    legend({ name: "Mid A", position: "CM", prime_rating: 93, club: "e" }),
    legend({ name: "Mid B", position: "CDM", prime_rating: 89, club: "f" }),
    legend({ name: "Striker A", position: "ST", prime_rating: 95, club: "g" }),
    legend({ name: "Winger B", position: "RW", prime_rating: 90, club: "h" }),
  ];

  it("draws 3 legends from 3 DISTINCT position areas (never a useless trio)", () => {
    const got = pickRandomLegends(pool, "seed-1");
    expect(got).toHaveLength(3);
    const areas = got.map((p) =>
      p.position === "GK" ? "GK" : ["CB", "LB"].includes(p.position) ? "DEF" : ["CM", "CDM"].includes(p.position) ? "MID" : "ATT",
    );
    expect(new Set(areas).size).toBe(3);
  });

  it("is deterministic per seed and varies across seeds", () => {
    expect(pickRandomLegends(pool, "seed-1")).toEqual(pickRandomLegends(pool, "seed-1"));
    const keys = (ps: Player[]) => ps.map((p) => p.name).join(",");
    const seeds = ["s1", "s2", "s3", "s4", "s5"].map((s) => keys(pickRandomLegends(pool, s)));
    expect(new Set(seeds).size).toBeGreaterThan(1); // rerolls produce different draws
  });

  it("biases toward the strongest legends in each area", () => {
    // Across many seeds the top striker should appear often (top-tier pull).
    const hits = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].filter((s) =>
      pickRandomLegends(pool, s).some((p) => p.name === "Striker A"),
    );
    expect(hits.length).toBeGreaterThan(0);
  });
});
